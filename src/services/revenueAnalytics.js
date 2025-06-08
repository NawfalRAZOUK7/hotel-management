/**
 * Revenue Analytics Service - Week 3
 * Advanced revenue performance tracking, yield management effectiveness analysis,
 * and ROI calculations for pricing strategies in hotel management system
 */

const moment = require('moment');
const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const currencyService = require('./currencyService');
const { logger } = require('../utils/logger');

class RevenueAnalyticsService {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes cache
        
        // KPI thresholds for performance alerts
        this.thresholds = {
            revPAR: {
                excellent: 80,
                good: 60,
                average: 40,
                poor: 20
            },
            occupancyRate: {
                excellent: 85,
                good: 70,
                average: 50,
                poor: 30
            },
            adr: {
                growthTarget: 5, // 5% year-over-year growth
                seasonalVariation: 15 // 15% acceptable seasonal variation
            },
            yieldEffectiveness: {
                excellent: 90,
                good: 80,
                average: 70,
                poor: 60
            }
        };

        // Revenue forecasting models
        this.forecastingModels = {
            linear: this.linearForecast.bind(this),
            seasonal: this.seasonalForecast.bind(this),
            trendAnalysis: this.trendBasedForecast.bind(this)
        };

        logger.info('Revenue Analytics Service initialized');
    }

    /**
     * Generate comprehensive revenue dashboard for a hotel
     * @param {String} hotelId - Hotel ID
     * @param {Object} dateRange - Date range for analysis
     * @param {String} currency - Target currency for reporting
     * @returns {Object} Complete revenue dashboard data
     */
    async generateRevenueDashboard(hotelId, dateRange = {}, currency = 'EUR') {
        const cacheKey = `dashboard_${hotelId}_${JSON.stringify(dateRange)}_${currency}`;
        const cached = this.cache.get(cacheKey);

        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        try {
            const {
                startDate = moment().subtract(30, 'days').toDate(),
                endDate = moment().toDate()
            } = dateRange;

            // Parallel execution of analytics
            const [
                kpiMetrics,
                revenueBreakdown,
                yieldPerformance,
                competitiveAnalysis,
                forecastData,
                trendAnalysis,
                segmentAnalysis
            ] = await Promise.all([
                this.calculateKPIMetrics(hotelId, startDate, endDate, currency),
                this.getRevenueBreakdown(hotelId, startDate, endDate, currency),
                this.analyzeYieldPerformance(hotelId, startDate, endDate),
                this.performCompetitiveAnalysis(hotelId, startDate, endDate),
                this.generateRevenueForecast(hotelId, 30, currency),
                this.analyzeTrends(hotelId, startDate, endDate),
                this.analyzeRevenueSegments(hotelId, startDate, endDate, currency)
            ]);

            const dashboardData = {
                metadata: {
                    hotelId,
                    dateRange: { startDate, endDate },
                    currency,
                    generatedAt: new Date(),
                    dataPoints: await this.getDataPointsCount(hotelId, startDate, endDate)
                },
                kpiMetrics,
                revenueBreakdown,
                yieldPerformance,
                competitiveAnalysis,
                forecastData,
                trendAnalysis,
                segmentAnalysis,
                recommendations: await this.generateRecommendations(hotelId, {
                    kpiMetrics,
                    yieldPerformance,
                    trendAnalysis
                })
            };

            // Cache the results
            this.cache.set(cacheKey, {
                data: dashboardData,
                timestamp: Date.now()
            });

            logger.info(`Generated revenue dashboard for hotel ${hotelId}`);
            return dashboardData;

        } catch (error) {
            logger.error('Error generating revenue dashboard:', error);
            throw error;
        }
    }

    /**
     * Calculate key performance indicator (KPI) metrics
     */
    async calculateKPIMetrics(hotelId, startDate, endDate, currency = 'EUR') {
        try {
            const bookings = await Booking.find({
                hotel: hotelId,
                checkInDate: { $gte: startDate, $lte: endDate },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            }).populate('rooms');

            const hotel = await Hotel.findById(hotelId);
            const totalRooms = await Room.countDocuments({ hotel: hotelId });
            
            // Calculate date range metrics
            const totalDays = moment(endDate).diff(moment(startDate), 'days') + 1;
            const totalRoomNights = totalRooms * totalDays;

            // Calculate occupancy metrics
            const occupiedRoomNights = bookings.reduce((sum, booking) => {
                const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
                return sum + (booking.rooms.length * nights);
            }, 0);

            const occupancyRate = (occupiedRoomNights / totalRoomNights) * 100;

            // Calculate revenue metrics
            let totalRevenue = 0;
            for (const booking of bookings) {
                if (booking.currency !== currency) {
                    const converted = await currencyService.convertCurrency(
                        booking.totalAmount,
                        booking.currency,
                        currency
                    );
                    totalRevenue += converted.convertedAmount;
                } else {
                    totalRevenue += booking.totalAmount;
                }
            }

            const averageDailyRate = occupiedRoomNights > 0 ? totalRevenue / occupiedRoomNights : 0;
            const revPAR = totalRevenue / totalRoomNights;

            // Calculate growth metrics (compare with previous period)
            const previousPeriodStart = moment(startDate).subtract(totalDays, 'days').toDate();
            const previousPeriodEnd = moment(startDate).subtract(1, 'day').toDate();
            
            const previousMetrics = await this.calculateKPIMetrics(
                hotelId, 
                previousPeriodStart, 
                previousPeriodEnd, 
                currency
            );

            const growthMetrics = {
                revenueGrowth: previousMetrics.totalRevenue > 0 ? 
                    ((totalRevenue - previousMetrics.totalRevenue) / previousMetrics.totalRevenue) * 100 : 0,
                occupancyGrowth: previousMetrics.occupancyRate > 0 ? 
                    ((occupancyRate - previousMetrics.occupancyRate) / previousMetrics.occupancyRate) * 100 : 0,
                adrGrowth: previousMetrics.averageDailyRate > 0 ? 
                    ((averageDailyRate - previousMetrics.averageDailyRate) / previousMetrics.averageDailyRate) * 100 : 0,
                revPARGrowth: previousMetrics.revPAR > 0 ? 
                    ((revPAR - previousMetrics.revPAR) / previousMetrics.revPAR) * 100 : 0
            };

            return {
                totalRevenue,
                occupancyRate,
                averageDailyRate,
                revPAR,
                totalBookings: bookings.length,
                totalRoomNights: occupiedRoomNights,
                averageStayLength: bookings.length > 0 ? 
                    occupiedRoomNights / bookings.length : 0,
                growthMetrics,
                performanceRatings: this.ratePerformance({
                    revPAR,
                    occupancyRate,
                    averageDailyRate
                }),
                currency
            };

        } catch (error) {
            logger.error('Error calculating KPI metrics:', error);
            throw error;
        }
    }

    /**
     * Get detailed revenue breakdown by various dimensions
     */
    async getRevenueBreakdown(hotelId, startDate, endDate, currency = 'EUR') {
        try {
            const bookings = await Booking.find({
                hotel: hotelId,
                checkInDate: { $gte: startDate, $lte: endDate },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            }).populate('rooms customer');

            // Revenue by room type
            const roomTypeRevenue = {};
            const roomTypeBookings = {};

            // Revenue by booking source
            const sourceRevenue = {};

            // Revenue by customer type
            const customerTypeRevenue = {};

            // Daily revenue tracking
            const dailyRevenue = {};

            for (const booking of bookings) {
                let convertedAmount = booking.totalAmount;
                
                if (booking.currency !== currency) {
                    const converted = await currencyService.convertCurrency(
                        booking.totalAmount,
                        booking.currency,
                        currency
                    );
                    convertedAmount = converted.convertedAmount;
                }

                // Room type breakdown
                for (const room of booking.rooms) {
                    const roomType = room.roomType;
                    roomTypeRevenue[roomType] = (roomTypeRevenue[roomType] || 0) + (convertedAmount / booking.rooms.length);
                    roomTypeBookings[roomType] = (roomTypeBookings[roomType] || 0) + 1;
                }

                // Source breakdown
                const source = booking.source || 'DIRECT';
                sourceRevenue[source] = (sourceRevenue[source] || 0) + convertedAmount;

                // Customer type breakdown
                const customerType = booking.customerType || 'INDIVIDUAL';
                customerTypeRevenue[customerType] = (customerTypeRevenue[customerType] || 0) + convertedAmount;

                // Daily revenue
                const bookingDate = moment(booking.checkInDate).format('YYYY-MM-DD');
                dailyRevenue[bookingDate] = (dailyRevenue[bookingDate] || 0) + convertedAmount;
            }

            return {
                byRoomType: Object.entries(roomTypeRevenue).map(([type, revenue]) => ({
                    roomType: type,
                    revenue,
                    bookingCount: roomTypeBookings[type] || 0,
                    averageValue: roomTypeBookings[type] > 0 ? revenue / roomTypeBookings[type] : 0,
                    percentage: (revenue / Object.values(roomTypeRevenue).reduce((a, b) => a + b, 0)) * 100
                })),
                bySource: Object.entries(sourceRevenue).map(([source, revenue]) => ({
                    source,
                    revenue,
                    percentage: (revenue / Object.values(sourceRevenue).reduce((a, b) => a + b, 0)) * 100
                })),
                byCustomerType: Object.entries(customerTypeRevenue).map(([type, revenue]) => ({
                    customerType: type,
                    revenue,
                    percentage: (revenue / Object.values(customerTypeRevenue).reduce((a, b) => a + b, 0)) * 100
                })),
                dailyTrend: Object.entries(dailyRevenue)
                    .sort(([a], [b]) => moment(a).diff(moment(b)))
                    .map(([date, revenue]) => ({
                        date,
                        revenue,
                        dayOfWeek: moment(date).format('dddd')
                    })),
                currency
            };

        } catch (error) {
            logger.error('Error generating revenue breakdown:', error);
            throw error;
        }
    }

    /**
     * Analyze yield management performance and effectiveness
     */
    async analyzeYieldPerformance(hotelId, startDate, endDate) {
        try {
            // Get all price changes during the period
            const rooms = await Room.find({ hotel: hotelId });
            const priceAdjustments = [];

            for (const room of rooms) {
                const adjustments = room.priceHistory.filter(entry => 
                    entry.date >= startDate && entry.date <= endDate
                );
                priceAdjustments.push(...adjustments.map(adj => ({
                    ...adj,
                    roomId: room._id,
                    roomType: room.type
                })));
            }

            // Calculate yield effectiveness metrics
            const totalAdjustments = priceAdjustments.length;
            const automatedAdjustments = priceAdjustments.filter(adj => adj.source === 'AUTOMATED').length;
            const manualAdjustments = totalAdjustments - automatedAdjustments;

            // Analyze price change impact
            const priceChangeImpact = await this.analyzePriceChangeImpact(hotelId, priceAdjustments, startDate, endDate);

            // Calculate optimal pricing adherence
            const optimalPricingAdherence = await this.calculateOptimalPricingAdherence(hotelId, startDate, endDate);

            // Revenue attribution to yield management
            const yieldAttributedRevenue = await this.calculateYieldAttributedRevenue(hotelId, priceAdjustments, startDate, endDate);

            return {
                summary: {
                    totalPriceAdjustments: totalAdjustments,
                    automatedAdjustments,
                    manualAdjustments,
                    automationRate: totalAdjustments > 0 ? (automatedAdjustments / totalAdjustments) * 100 : 0,
                    yieldAttributedRevenue,
                    optimalPricingAdherence
                },
                priceChangeImpact,
                adjustmentBreakdown: {
                    bySource: this.groupBySource(priceAdjustments),
                    byRoomType: this.groupByRoomType(priceAdjustments),
                    byDirection: this.groupByPriceDirection(priceAdjustments)
                },
                effectiveness: {
                    revenueImpact: priceChangeImpact.totalRevenueImpact,
                    occupancyImpact: priceChangeImpact.totalOccupancyImpact,
                    averageResponseTime: this.calculateAverageResponseTime(priceAdjustments),
                    successRate: this.calculateYieldSuccessRate(priceChangeImpact)
                }
            };

        } catch (error) {
            logger.error('Error analyzing yield performance:', error);
            throw error;
        }
    }

    /**
     * Perform competitive analysis and market positioning
     */
    async performCompetitiveAnalysis(hotelId, startDate, endDate) {
        try {
            const hotel = await Hotel.findById(hotelId);
            
            // Market benchmark calculation (simplified)
            const marketBenchmarks = await this.calculateMarketBenchmarks(hotel, startDate, endDate);
            
            // Competitive positioning
            const competitivePosition = await this.assessCompetitivePosition(hotel, marketBenchmarks);
            
            // Market share analysis
            const marketShare = await this.estimateMarketShare(hotel, startDate, endDate);

            return {
                marketBenchmarks,
                competitivePosition,
                marketShare,
                recommendations: this.generateCompetitiveRecommendations(competitivePosition, marketBenchmarks)
            };

        } catch (error) {
            logger.error('Error performing competitive analysis:', error);
            return {
                marketBenchmarks: null,
                competitivePosition: 'UNKNOWN',
                marketShare: { estimated: 0, confidence: 'LOW' },
                recommendations: []
            };
        }
    }

    /**
     * Generate revenue forecasts using multiple models
     */
    async generateRevenueForecast(hotelId, forecastDays = 30, currency = 'EUR') {
        try {
            // Get historical data for forecasting
            const historicalData = await this.getHistoricalRevenueData(hotelId, 90, currency);
            
            if (historicalData.length < 14) {
                return {
                    error: 'Insufficient historical data for forecasting',
                    minimumRequired: 14,
                    available: historicalData.length
                };
            }

            // Generate forecasts using different models
            const forecasts = {};
            
            for (const [modelName, modelFunction] of Object.entries(this.forecastingModels)) {
                try {
                    forecasts[modelName] = await modelFunction(historicalData, forecastDays);
                } catch (modelError) {
                    logger.warn(`Forecasting model ${modelName} failed:`, modelError);
                    forecasts[modelName] = { error: modelError.message };
                }
            }

            // Create ensemble forecast (weighted average)
            const ensembleForecast = this.createEnsembleForecast(forecasts, forecastDays);

            // Calculate confidence intervals
            const confidenceIntervals = this.calculateConfidenceIntervals(historicalData, ensembleForecast);

            return {
                historicalDataPoints: historicalData.length,
                forecastPeriod: forecastDays,
                models: forecasts,
                ensemble: ensembleForecast,
                confidenceIntervals,
                currency,
                generatedAt: new Date()
            };

        } catch (error) {
            logger.error('Error generating revenue forecast:', error);
            throw error;
        }
    }

    /**
     * Analyze revenue trends and patterns
     */
    async analyzeTrends(hotelId, startDate, endDate) {
        try {
            const dailyData = await this.getDailyRevenueData(hotelId, startDate, endDate);
            
            // Calculate trend indicators
            const movingAverages = this.calculateMovingAverages(dailyData, [7, 14, 30]);
            const seasonalPatterns = this.identifySeasonalPatterns(dailyData);
            const cyclicalTrends = this.detectCyclicalTrends(dailyData);
            const volatilityMetrics = this.calculateVolatilityMetrics(dailyData);
            
            // Identify significant events and anomalies
            const anomalies = this.detectAnomalies(dailyData);
            const significantEvents = this.identifySignificantEvents(dailyData, anomalies);

            return {
                trendDirection: this.determineTrendDirection(dailyData),
                movingAverages,
                seasonalPatterns,
                cyclicalTrends,
                volatilityMetrics,
                anomalies,
                significantEvents,
                trendStrength: this.calculateTrendStrength(dailyData),
                momentum: this.calculateMomentum(dailyData)
            };

        } catch (error) {
            logger.error('Error analyzing trends:', error);
            throw error;
        }
    }

    /**
     * Analyze revenue by customer segments
     */
    async analyzeRevenueSegments(hotelId, startDate, endDate, currency = 'EUR') {
        try {
            const bookings = await Booking.find({
                hotel: hotelId,
                checkInDate: { $gte: startDate, $lte: endDate },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            }).populate('customer');

            const segments = {
                byLoyalty: {},
                bySpendingTier: {},
                byBookingFrequency: {},
                byLeadTime: {},
                byStayLength: {}
            };

            for (const booking of bookings) {
                let convertedAmount = booking.totalAmount;
                
                if (booking.currency !== currency) {
                    const converted = await currencyService.convertCurrency(
                        booking.totalAmount,
                        booking.currency,
                        currency
                    );
                    convertedAmount = converted.convertedAmount;
                }

                // Analyze by various segmentation criteria
                this.segmentByLoyalty(booking, convertedAmount, segments.byLoyalty);
                this.segmentBySpending(booking, convertedAmount, segments.bySpendingTier);
                this.segmentByFrequency(booking, convertedAmount, segments.byBookingFrequency);
                this.segmentByLeadTime(booking, convertedAmount, segments.byLeadTime);
                this.segmentByStayLength(booking, convertedAmount, segments.byStayLength);
            }

            // Calculate segment performance metrics
            const segmentPerformance = this.calculateSegmentPerformance(segments);

            return {
                segments,
                segmentPerformance,
                insights: this.generateSegmentInsights(segments, segmentPerformance),
                currency
            };

        } catch (error) {
            logger.error('Error analyzing revenue segments:', error);
            throw error;
        }
    }

    /**
     * Calculate ROI for different pricing strategies
     */
    async calculatePricingStrategyROI(hotelId, strategies, timeframe = 90) {
        try {
            const results = {};
            
            for (const strategy of strategies) {
                const strategyROI = await this.calculateSingleStrategyROI(hotelId, strategy, timeframe);
                results[strategy.name] = strategyROI;
            }

            // Compare strategies
            const comparison = this.compareStrategies(results);
            
            // Generate recommendations
            const recommendations = this.generateStrategyRecommendations(results, comparison);

            return {
                strategies: results,
                comparison,
                recommendations,
                calculatedAt: new Date()
            };

        } catch (error) {
            logger.error('Error calculating pricing strategy ROI:', error);
            throw error;
        }
    }

    /**
     * Generate actionable recommendations based on analytics
     */
    async generateRecommendations(hotelId, analyticsData) {
        const recommendations = [];
        
        try {
            const { kpiMetrics, yieldPerformance, trendAnalysis } = analyticsData;

            // Revenue optimization recommendations
            if (kpiMetrics.revPAR < this.thresholds.revPAR.average) {
                recommendations.push({
                    type: 'REVENUE_OPTIMIZATION',
                    priority: 'HIGH',
                    title: 'Low RevPAR Performance',
                    description: `Current RevPAR of ${kpiMetrics.revPAR.toFixed(2)} is below average threshold`,
                    actionItems: [
                        'Review pricing strategy for peak demand periods',
                        'Implement dynamic pricing for low-demand periods',
                        'Analyze competitor pricing in your market'
                    ],
                    expectedImpact: 'Medium',
                    timeframe: '2-4 weeks'
                });
            }

            // Occupancy optimization
            if (kpiMetrics.occupancyRate < this.thresholds.occupancyRate.good) {
                recommendations.push({
                    type: 'OCCUPANCY_OPTIMIZATION',
                    priority: kpiMetrics.occupancyRate < this.thresholds.occupancyRate.poor ? 'CRITICAL' : 'HIGH',
                    title: 'Occupancy Rate Below Target',
                    description: `Current occupancy rate of ${kpiMetrics.occupancyRate.toFixed(1)}% needs improvement`,
                    actionItems: [
                        'Consider promotional pricing for off-peak periods',
                        'Enhance marketing efforts for target segments',
                        'Review room type mix and availability'
                    ],
                    expectedImpact: 'High',
                    timeframe: '1-3 weeks'
                });
            }

            // Yield management recommendations
            if (yieldPerformance && yieldPerformance.summary.automationRate < 70) {
                recommendations.push({
                    type: 'YIELD_AUTOMATION',
                    priority: 'MEDIUM',
                    title: 'Increase Yield Management Automation',
                    description: `Only ${yieldPerformance.summary.automationRate.toFixed(1)}% of price adjustments are automated`,
                    actionItems: [
                        'Enable more automated pricing rules',
                        'Reduce manual intervention in pricing decisions',
                        'Set up occupancy-based pricing triggers'
                    ],
                    expectedImpact: 'Medium',
                    timeframe: '1-2 weeks'
                });
            }

            // Trend-based recommendations
            if (trendAnalysis && trendAnalysis.trendDirection === 'DECLINING') {
                recommendations.push({
                    type: 'TREND_REVERSAL',
                    priority: 'HIGH',
                    title: 'Revenue Trend Declining',
                    description: 'Recent revenue trends show declining performance',
                    actionItems: [
                        'Implement immediate promotional campaigns',
                        'Review and adjust pricing strategy',
                        'Analyze competitive landscape changes'
                    ],
                    expectedImpact: 'High',
                    timeframe: 'Immediate'
                });
            }

            // Growth opportunity recommendations
            if (kpiMetrics.growthMetrics.revenueGrowth < 5) {
                recommendations.push({
                    type: 'GROWTH_OPPORTUNITY',
                    priority: 'MEDIUM',
                    title: 'Revenue Growth Below Target',
                    description: `Revenue growth of ${kpiMetrics.growthMetrics.revenueGrowth.toFixed(1)}% is below 5% target`,
                    actionItems: [
                        'Explore premium service offerings',
                        'Implement upselling strategies',
                        'Consider market expansion opportunities'
                    ],
                    expectedImpact: 'Medium',
                    timeframe: '4-8 weeks'
                });
            }

            return recommendations.sort((a, b) => {
                const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
                return priorityOrder[a.priority] - priorityOrder[b.priority];
            });

        } catch (error) {
            logger.error('Error generating recommendations:', error);
            return [];
        }
    }

    /**
     * Helper methods for calculations and analysis
     */
    ratePerformance(metrics) {
        const ratings = {};
        
        // Rate RevPAR performance
        if (metrics.revPAR >= this.thresholds.revPAR.excellent) ratings.revPAR = 'EXCELLENT';
        else if (metrics.revPAR >= this.thresholds.revPAR.good) ratings.revPAR = 'GOOD';
        else if (metrics.revPAR >= this.thresholds.revPAR.average) ratings.revPAR = 'AVERAGE';
        else ratings.revPAR = 'POOR';

        // Rate occupancy performance
        if (metrics.occupancyRate >= this.thresholds.occupancyRate.excellent) ratings.occupancyRate = 'EXCELLENT';
        else if (metrics.occupancyRate >= this.thresholds.occupancyRate.good) ratings.occupancyRate = 'GOOD';
        else if (metrics.occupancyRate >= this.thresholds.occupancyRate.average) ratings.occupancyRate = 'AVERAGE';
        else ratings.occupancyRate = 'POOR';

        return ratings;
    }

    async getDataPointsCount(hotelId, startDate, endDate) {
        return await Booking.countDocuments({
            hotel: hotelId,
            checkInDate: { $gte: startDate, $lte: endDate },
            status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
        });
    }

    linearForecast(historicalData, forecastDays) {
        // Simple linear regression forecast
        const n = historicalData.length;
        const sumX = historicalData.reduce((sum, _, i) => sum + i, 0);
        const sumY = historicalData.reduce((sum, point) => sum + point.revenue, 0);
        const sumXY = historicalData.reduce((sum, point, i) => sum + (i * point.revenue), 0);
        const sumXX = historicalData.reduce((sum, _, i) => sum + (i * i), 0);

        const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
        const intercept = (sumY - slope * sumX) / n;

        const forecast = [];
        for (let i = 0; i < forecastDays; i++) {
            const futureX = historicalData.length + i;
            const predictedRevenue = slope * futureX + intercept;
            forecast.push({
                date: moment().add(i, 'days').format('YYYY-MM-DD'),
                predictedRevenue: Math.max(0, predictedRevenue)
            });
        }

        return {
            model: 'LINEAR',
            accuracy: this.calculateModelAccuracy(historicalData, slope, intercept),
            forecast
        };
    }

    seasonalForecast(historicalData, forecastDays) {
        // Seasonal decomposition forecast (simplified)
        const seasonalPeriod = 7; // Weekly seasonality
        const seasonalFactors = this.calculateSeasonalFactors(historicalData, seasonalPeriod);
        const trend = this.calculateTrend(historicalData);

        const forecast = [];
        for (let i = 0; i < forecastDays; i++) {
            const seasonalIndex = i % seasonalPeriod;
            const trendValue = trend.intercept + trend.slope * (historicalData.length + i);
            const predictedRevenue = trendValue * seasonalFactors[seasonalIndex];
            
            forecast.push({
                date: moment().add(i, 'days').format('YYYY-MM-DD'),
                predictedRevenue: Math.max(0, predictedRevenue)
            });
        }

        return {
            model: 'SEASONAL',
            seasonalFactors,
            forecast
        };
    }

    trendBasedForecast(historicalData, forecastDays) {
        // Moving average with trend adjustment
        const shortMA = this.calculateMovingAverage(historicalData.slice(-7));
        const longMA = this.calculateMovingAverage(historicalData.slice(-30));
        const trend = shortMA - longMA;

        const forecast = [];
        let lastValue = historicalData[historicalData.length - 1].revenue;

        for (let i = 0; i < forecastDays; i++) {
            const trendAdjustment = trend * (1 + i * 0.1); // Dampening factor
            const predictedRevenue = lastValue + trendAdjustment;
            lastValue = predictedRevenue;
            
            forecast.push({
                date: moment().add(i, 'days').format('YYYY-MM-DD'),
                predictedRevenue: Math.max(0, predictedRevenue)
            });
        }

        return {
            model: 'TREND_BASED',
            trend,
            forecast
        };
    }

    createEnsembleForecast(forecasts, forecastDays) {
        const validForecasts = Object.values(forecasts).filter(f => !f.error && f.forecast);
        
        if (validForecasts.length === 0) {
            return { error: 'No valid forecasts available for ensemble' };
        }

        // Weight models based on their historical accuracy
        const weights = {
            LINEAR: 0.3,
            SEASONAL: 0.4,
            TREND_BASED: 0.3
        };

        const ensemble = [];
        for (let i = 0; i < forecastDays; i++) {
            let weightedSum = 0;
            let totalWeight = 0;

            for (const forecast of validForecasts) {
                const weight = weights[forecast.model] || 0.33;
                if (forecast.forecast[i]) {
                    weightedSum += forecast.forecast[i].predictedRevenue * weight;
                    totalWeight += weight;
                }
            }

            const ensembleValue = totalWeight > 0 ? weightedSum / totalWeight : 0;
            ensemble.push({
                date: moment().add(i, 'days').format('YYYY-MM-DD'),
                predictedRevenue: ensembleValue,
                confidence: this.calculatePredictionConfidence(validForecasts, i)
            });
        }

        return {
            model: 'ENSEMBLE',
            contributingModels: validForecasts.length,
            forecast: ensemble
        };
    }

    calculateConfidenceIntervals(historicalData, forecast) {
        if (!forecast.forecast) return null;

        const historicalVariance = this.calculateVariance(historicalData.map(d => d.revenue));
        const standardError = Math.sqrt(historicalVariance);

        return forecast.forecast.map(point => ({
            date: point.date,
            lower95: point.predictedRevenue - (1.96 * standardError),
            upper95: point.predictedRevenue + (1.96 * standardError),
            lower68: point.predictedRevenue - standardError,
            upper68: point.predictedRevenue + standardError
        }));
    }

    async getHistoricalRevenueData(hotelId, days, currency = 'EUR') {
        const endDate = moment().toDate();
        const startDate = moment().subtract(days, 'days').toDate();

        const dailyData = await Booking.aggregate([
            {
                $match: {
                    hotel: new mongoose.Types.ObjectId(hotelId),
                    checkInDate: { $gte: startDate, $lte: endDate },
                    status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$checkInDate' }
                    },
                    totalRevenue: { $sum: '$totalAmount' },
                    bookingCount: { $sum: 1 }
                }
            },
            {
                $sort: { '_id': 1 }
            }
        ]);

        // Convert currency if needed and fill missing dates
        const result = [];
        let currentDate = moment(startDate);
        const endMoment = moment(endDate);

        while (currentDate.isSameOrBefore(endMoment)) {
            const dateStr = currentDate.format('YYYY-MM-DD');
            const dayData = dailyData.find(d => d._id === dateStr);
            
            result.push({
                date: dateStr,
                revenue: dayData ? dayData.totalRevenue : 0,
                bookingCount: dayData ? dayData.bookingCount : 0
            });
            
            currentDate.add(1, 'day');
        }

        return result;
    }

    async getDailyRevenueData(hotelId, startDate, endDate) {
        return await this.getHistoricalRevenueData(
            hotelId, 
            moment(endDate).diff(moment(startDate), 'days') + 1
        );
    }

    calculateMovingAverages(data, periods) {
        const movingAverages = {};
        
        for (const period of periods) {
            movingAverages[`MA${period}`] = [];
            
            for (let i = period - 1; i < data.length; i++) {
                const slice = data.slice(i - period + 1, i + 1);
                const average = slice.reduce((sum, point) => sum + point.revenue, 0) / period;
                
                movingAverages[`MA${period}`].push({
                    date: data[i].date,
                    value: average
                });
            }
        }
        
        return movingAverages;
    }

    identifySeasonalPatterns(data) {
        const patterns = {
            dayOfWeek: {},
            monthly: {},
            weekly: {}
        };

        for (const point of data) {
            const date = moment(point.date);
            const dayOfWeek = date.format('dddd');
            const month = date.format('MMMM');
            const weekOfYear = date.week();

            // Day of week patterns
            if (!patterns.dayOfWeek[dayOfWeek]) {
                patterns.dayOfWeek[dayOfWeek] = { total: 0, count: 0 };
            }
            patterns.dayOfWeek[dayOfWeek].total += point.revenue;
            patterns.dayOfWeek[dayOfWeek].count += 1;

            // Monthly patterns
            if (!patterns.monthly[month]) {
                patterns.monthly[month] = { total: 0, count: 0 };
            }
            patterns.monthly[month].total += point.revenue;
            patterns.monthly[month].count += 1;
        }

        // Calculate averages
        for (const day in patterns.dayOfWeek) {
            const data = patterns.dayOfWeek[day];
            patterns.dayOfWeek[day].average = data.total / data.count;
        }

        for (const month in patterns.monthly) {
            const data = patterns.monthly[month];
            patterns.monthly[month].average = data.total / data.count;
        }

        return patterns;
    }

    detectCyclicalTrends(data) {
        // Simple cyclical trend detection using autocorrelation
        const revenues = data.map(d => d.revenue);
        const cycles = [];

        // Check for common cycle lengths (7, 14, 30 days)
        for (const cycleLength of [7, 14, 30]) {
            const correlation = this.calculateAutocorrelation(revenues, cycleLength);
            
            if (correlation > 0.5) {
                cycles.push({
                    length: cycleLength,
                    strength: correlation,
                    description: this.describeCycle(cycleLength)
                });
            }
        }

        return cycles;
    }

    calculateVolatilityMetrics(data) {
        const revenues = data.map(d => d.revenue);
        const mean = revenues.reduce((sum, val) => sum + val, 0) / revenues.length;
        const variance = revenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / revenues.length;
        const standardDeviation = Math.sqrt(variance);
        const coefficientOfVariation = mean > 0 ? (standardDeviation / mean) * 100 : 0;

        return {
            mean,
            standardDeviation,
            variance,
            coefficientOfVariation,
            volatilityRating: this.rateVolatility(coefficientOfVariation)
        };
    }

    detectAnomalies(data) {
        const revenues = data.map(d => d.revenue);
        const mean = revenues.reduce((sum, val) => sum + val, 0) / revenues.length;
        const stdDev = Math.sqrt(revenues.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / revenues.length);
        const threshold = 2 * stdDev; // 2 standard deviations

        return data.filter(point => Math.abs(point.revenue - mean) > threshold)
                  .map(point => ({
                      ...point,
                      deviation: point.revenue - mean,
                      severity: Math.abs(point.revenue - mean) > 3 * stdDev ? 'HIGH' : 'MEDIUM'
                  }));
    }

    identifySignificantEvents(data, anomalies) {
        return anomalies.map(anomaly => {
            const date = moment(anomaly.date);
            return {
                date: anomaly.date,
                type: anomaly.deviation > 0 ? 'REVENUE_SPIKE' : 'REVENUE_DROP',
                magnitude: Math.abs(anomaly.deviation),
                severity: anomaly.severity,
                possibleCauses: this.suggestEventCauses(anomaly, date)
            };
        });
    }

    determineTrendDirection(data) {
        if (data.length < 2) return 'INSUFFICIENT_DATA';

        const recentData = data.slice(-14); // Last 14 days
        const olderData = data.slice(-28, -14); // Previous 14 days

        if (recentData.length === 0 || olderData.length === 0) return 'INSUFFICIENT_DATA';

        const recentAvg = recentData.reduce((sum, point) => sum + point.revenue, 0) / recentData.length;
        const olderAvg = olderData.reduce((sum, point) => sum + point.revenue, 0) / olderData.length;

        const change = ((recentAvg - olderAvg) / olderAvg) * 100;

        if (change > 5) return 'GROWING';
        if (change < -5) return 'DECLINING';
        return 'STABLE';
    }

    calculateTrendStrength(data) {
        const revenues = data.map(d => d.revenue);
        const n = revenues.length;
        
        if (n < 2) return 0;

        // Calculate linear regression R-squared
        const xValues = Array.from({ length: n }, (_, i) => i);
        const yValues = revenues;
        
        const correlation = this.calculateCorrelation(xValues, yValues);
        return Math.abs(correlation);
    }

    calculateMomentum(data) {
        if (data.length < 3) return 0;

        const recent = data.slice(-7); // Last week
        const previous = data.slice(-14, -7); // Previous week

        if (recent.length === 0 || previous.length === 0) return 0;

        const recentSum = recent.reduce((sum, point) => sum + point.revenue, 0);
        const previousSum = previous.reduce((sum, point) => sum + point.revenue, 0);

        return previousSum > 0 ? ((recentSum - previousSum) / previousSum) * 100 : 0;
    }

    // Segmentation helper methods
    segmentByLoyalty(booking, amount, segments) {
        // Simplified loyalty segmentation
        const guestBookings = booking.customer?.bookingHistory?.length || 1;
        let tier = 'NEW';
        
        if (guestBookings >= 10) tier = 'PLATINUM';
        else if (guestBookings >= 5) tier = 'GOLD';
        else if (guestBookings >= 2) tier = 'SILVER';

        segments[tier] = (segments[tier] || 0) + amount;
    }

    segmentBySpending(booking, amount, segments) {
        let tier = 'LOW';
        if (amount >= 500) tier = 'HIGH';
        else if (amount >= 200) tier = 'MEDIUM';

        segments[tier] = (segments[tier] || 0) + amount;
    }

    segmentByFrequency(booking, amount, segments) {
        const frequency = booking.customer?.bookingHistory?.length || 1;
        let tier = 'INFREQUENT';
        
        if (frequency >= 6) tier = 'FREQUENT';
        else if (frequency >= 3) tier = 'OCCASIONAL';

        segments[tier] = (segments[tier] || 0) + amount;
    }

    segmentByLeadTime(booking, amount, segments) {
        const leadTime = moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');
        let tier = 'LAST_MINUTE';
        
        if (leadTime >= 30) tier = 'ADVANCE';
        else if (leadTime >= 7) tier = 'EARLY';

        segments[tier] = (segments[tier] || 0) + amount;
    }

    segmentByStayLength(booking, amount, segments) {
        const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
        let tier = 'SHORT';
        
        if (nights >= 7) tier = 'EXTENDED';
        else if (nights >= 3) tier = 'MEDIUM';

        segments[tier] = (segments[tier] || 0) + amount;
    }

    calculateSegmentPerformance(segments) {
        const performance = {};
        
        for (const [segmentType, segmentData] of Object.entries(segments)) {
            const total = Object.values(segmentData).reduce((sum, val) => sum + val, 0);
            
            performance[segmentType] = Object.entries(segmentData).map(([tier, revenue]) => ({
                tier,
                revenue,
                percentage: total > 0 ? (revenue / total) * 100 : 0
            })).sort((a, b) => b.revenue - a.revenue);
        }
        
        return performance;
    }

    generateSegmentInsights(segments, performance) {
        const insights = [];
        
        // Analyze loyalty segments
        const loyaltyPerf = performance.byLoyalty;
        if (loyaltyPerf) {
            const platinumRevenue = loyaltyPerf.find(s => s.tier === 'PLATINUM')?.revenue || 0;
            const totalRevenue = loyaltyPerf.reduce((sum, s) => sum + s.revenue, 0);
            
            if (platinumRevenue / totalRevenue > 0.4) {
                insights.push({
                    type: 'LOYALTY_CONCENTRATION',
                    message: 'High revenue concentration from platinum customers',
                    recommendation: 'Focus on retention programs for top-tier customers'
                });
            }
        }

        return insights;
    }

    // Utility calculation methods
    calculateAutocorrelation(data, lag) {
        if (data.length <= lag) return 0;

        const n = data.length - lag;
        const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
        
        let numerator = 0;
        let denominator = 0;
        
        for (let i = 0; i < n; i++) {
            numerator += (data[i] - mean) * (data[i + lag] - mean);
        }
        
        for (let i = 0; i < data.length; i++) {
            denominator += Math.pow(data[i] - mean, 2);
        }
        
        return denominator > 0 ? numerator / denominator : 0;
    }

    calculateCorrelation(x, y) {
        const n = Math.min(x.length, y.length);
        if (n === 0) return 0;

        const sumX = x.reduce((sum, val) => sum + val, 0);
        const sumY = y.reduce((sum, val) => sum + val, 0);
        const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
        const sumXX = x.reduce((sum, val) => sum + val * val, 0);
        const sumYY = y.reduce((sum, val) => sum + val * val, 0);

        const numerator = n * sumXY - sumX * sumY;
        const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

        return denominator > 0 ? numerator / denominator : 0;
    }

    calculateVariance(data) {
        const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
        return data.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / data.length;
    }

    rateVolatility(coefficientOfVariation) {
        if (coefficientOfVariation < 10) return 'LOW';
        if (coefficientOfVariation < 25) return 'MODERATE';
        if (coefficientOfVariation < 50) return 'HIGH';
        return 'EXTREME';
    }

    describeCycle(length) {
        switch (length) {
            case 7: return 'Weekly cycle (likely day-of-week pattern)';
            case 14: return 'Bi-weekly cycle';
            case 30: return 'Monthly cycle';
            default: return `${length}-day cycle`;
        }
    }

    suggestEventCauses(anomaly, date) {
        const causes = [];
        
        if (date.day() === 0 || date.day() === 6) {
            causes.push('Weekend effect');
        }
        
        if (anomaly.deviation > 0) {
            causes.push('Special event', 'Holiday period', 'Conference/convention', 'Marketing campaign');
        } else {
            causes.push('Cancellations', 'Weather impact', 'Competitive pricing', 'System issues');
        }
        
        return causes;
    }

    calculatePredictionConfidence(forecasts, dayIndex) {
        // Calculate confidence based on model agreement
        const predictions = forecasts.map(f => f.forecast[dayIndex]?.predictedRevenue).filter(p => p !== undefined);
        
        if (predictions.length <= 1) return 0.5;
        
        const mean = predictions.reduce((sum, p) => sum + p, 0) / predictions.length;
        const variance = predictions.reduce((sum, p) => sum + Math.pow(p - mean, 2), 0) / predictions.length;
        const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
        
        // Higher agreement (lower CV) = higher confidence
        return Math.max(0.1, Math.min(0.9, 1 - coefficientOfVariation));
    }

    /**
     * Clear analytics cache
     */
    clearCache() {
        this.cache.clear();
        logger.info('Revenue analytics cache cleared');
    }

    /**
     * Get service statistics
     */
    getServiceStats() {
        return {
            cacheSize: this.cache.size,
            thresholds: this.thresholds,
            availableModels: Object.keys(this.forecastingModels)
        };
    }
}

// Create singleton instance
const revenueAnalyticsService = new RevenueAnalyticsService();

module.exports = revenueAnalyticsService;