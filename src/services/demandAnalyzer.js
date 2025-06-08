/**
 * Advanced Demand Analysis Service
 * Analyzes historical booking data, calculates occupancy rates,
 * and provides demand forecasting for yield management
 */

const moment = require('moment');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const { logger } = require('../utils/logger');

class DemandAnalyzer {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 30 * 60 * 1000; // 30 minutes cache
        this.analysisWeights = {
            historical: 0.4,
            seasonal: 0.3,
            trending: 0.2,
            external: 0.1
        };
        
        // Market patterns and coefficients
        this.patterns = {
            weekdays: [0.7, 0.75, 0.8, 0.85, 0.95, 1.0, 0.9], // Mon-Sun demand multipliers
            months: [0.8, 0.7, 0.9, 1.1, 1.2, 1.3, 1.4, 1.3, 1.1, 1.0, 0.8, 0.9], // Jan-Dec
            leadTime: { // Days before check-in vs demand
                0: 1.5,    // Same day
                1: 1.3,    // 1 day
                3: 1.1,    // 3 days
                7: 1.0,    // 1 week
                14: 0.9,   // 2 weeks
                30: 0.8,   // 1 month
                60: 0.7    // 2 months+
            }
        };
        
        logger.info('Demand Analyzer service initialized');
    }

    /**
     * Comprehensive demand analysis for a hotel
     * @param {String} hotelId - Hotel ID
     * @param {Date} startDate - Analysis start date
     * @param {Date} endDate - Analysis end date
     * @param {Object} options - Analysis options
     */
    async analyzeDemand(hotelId, startDate, endDate, options = {}) {
        const cacheKey = `demand_${hotelId}_${startDate}_${endDate}`;
        const cached = this.getCachedResult(cacheKey);
        
        if (cached) {
            return cached;
        }

        try {
            const analysis = {
                hotelId,
                period: { startDate, endDate },
                timestamp: new Date(),
                historical: await this.analyzeHistoricalData(hotelId, startDate, endDate),
                occupancy: await this.calculateOccupancyRates(hotelId, startDate, endDate),
                seasonal: await this.analyzeSeasonalPatterns(hotelId, startDate, endDate),
                trends: await this.analyzeTrends(hotelId, startDate, endDate),
                forecast: await this.generateDemandForecast(hotelId, startDate, endDate),
                competition: await this.analyzeCompetitivePosition(hotelId),
                recommendations: []
            };

            // Generate actionable recommendations
            analysis.recommendations = this.generateRecommendations(analysis);

            this.setCachedResult(cacheKey, analysis);
            logger.info(`Demand analysis completed for hotel ${hotelId}`);

            return analysis;
        } catch (error) {
            logger.error('Demand analysis failed:', error);
            throw error;
        }
    }

    /**
     * Analyze historical booking data
     */
    async analyzeHistoricalData(hotelId, startDate, endDate) {
        try {
            // Get historical data for the same period in previous years
            const historicalPeriods = [];
            for (let i = 1; i <= 3; i++) {
                const yearBefore = moment(startDate).subtract(i, 'years');
                const yearBeforeEnd = moment(endDate).subtract(i, 'years');
                
                historicalPeriods.push({
                    year: yearBefore.year(),
                    startDate: yearBefore.toDate(),
                    endDate: yearBeforeEnd.toDate()
                });
            }

            const historicalData = await Promise.all(
                historicalPeriods.map(async (period) => {
                    const bookings = await Booking.find({
                        hotel: hotelId,
                        checkInDate: {
                            $gte: period.startDate,
                            $lte: period.endDate
                        },
                        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
                    });

                    return {
                        year: period.year,
                        totalBookings: bookings.length,
                        totalRevenue: bookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0),
                        avgBookingValue: bookings.length > 0 ? 
                            bookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0) / bookings.length : 0,
                        leadTimeDistribution: this.analyzeLeadTimeDistribution(bookings),
                        bookingsByDay: this.groupBookingsByDay(bookings),
                        roomTypeDistribution: this.analyzeRoomTypeDistribution(bookings)
                    };
                })
            );

            // Calculate year-over-year growth
            const yoyGrowth = this.calculateYearOverYearGrowth(historicalData);

            return {
                periods: historicalData,
                averages: this.calculateHistoricalAverages(historicalData),
                growth: yoyGrowth,
                patterns: this.identifyHistoricalPatterns(historicalData)
            };
        } catch (error) {
            logger.error('Historical data analysis failed:', error);
            return null;
        }
    }

    /**
     * Calculate occupancy rates with detailed breakdown
     */
    async calculateOccupancyRates(hotelId, startDate, endDate) {
        try {
            const hotel = await Hotel.findById(hotelId).populate('rooms');
            if (!hotel) throw new Error('Hotel not found');

            const totalRooms = hotel.rooms.length;
            const daysBetween = moment(endDate).diff(moment(startDate), 'days') + 1;
            const totalRoomNights = totalRooms * daysBetween;

            // Get all bookings in the period
            const bookings = await Booking.find({
                hotel: hotelId,
                $or: [
                    {
                        checkInDate: { $gte: startDate, $lte: endDate }
                    },
                    {
                        checkOutDate: { $gte: startDate, $lte: endDate }
                    },
                    {
                        checkInDate: { $lt: startDate },
                        checkOutDate: { $gt: endDate }
                    }
                ],
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            });

            // Calculate occupied room nights
            let occupiedRoomNights = 0;
            const dailyOccupancy = {};

            for (let date = moment(startDate); date.isSameOrBefore(endDate); date.add(1, 'day')) {
                const dateStr = date.format('YYYY-MM-DD');
                let occupiedRooms = 0;

                bookings.forEach(booking => {
                    const checkIn = moment(booking.checkInDate);
                    const checkOut = moment(booking.checkOutDate);
                    
                    if (date.isSameOrAfter(checkIn) && date.isBefore(checkOut)) {
                        occupiedRooms += booking.rooms.reduce((sum, room) => sum + (room.quantity || 1), 0);
                    }
                });

                dailyOccupancy[dateStr] = {
                    occupiedRooms,
                    totalRooms,
                    occupancyRate: totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0
                };

                occupiedRoomNights += occupiedRooms;
            }

            const overallOccupancyRate = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0;

            // Analyze occupancy by room type
            const roomTypeOccupancy = await this.calculateRoomTypeOccupancy(hotelId, startDate, endDate, bookings);

            // Calculate weekly patterns
            const weeklyPatterns = this.analyzeWeeklyOccupancyPatterns(dailyOccupancy);

            return {
                overall: {
                    occupancyRate: overallOccupancyRate,
                    occupiedRoomNights,
                    totalRoomNights,
                    averageDailyRate: this.calculateADR(bookings, occupiedRoomNights),
                    revenuePAR: this.calculateRevPAR(bookings, totalRoomNights)
                },
                daily: dailyOccupancy,
                byRoomType: roomTypeOccupancy,
                patterns: weeklyPatterns,
                performance: this.categorizeOccupancyPerformance(overallOccupancyRate)
            };
        } catch (error) {
            logger.error('Occupancy calculation failed:', error);
            return null;
        }
    }

    /**
     * Analyze seasonal patterns and variations
     */
    async analyzeSeasonalPatterns(hotelId, startDate, endDate) {
        try {
            // Analyze patterns over the last 2 years
            const twoYearsAgo = moment().subtract(2, 'years').toDate();
            const bookings = await Booking.find({
                hotel: hotelId,
                checkInDate: { $gte: twoYearsAgo },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            });

            // Group by month
            const monthlyData = {};
            bookings.forEach(booking => {
                const month = moment(booking.checkInDate).format('MM');
                if (!monthlyData[month]) {
                    monthlyData[month] = {
                        bookings: 0,
                        revenue: 0,
                        averageStay: 0,
                        totalNights: 0
                    };
                }
                
                monthlyData[month].bookings++;
                monthlyData[month].revenue += booking.totalAmount || 0;
                const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
                monthlyData[month].totalNights += nights;
            });

            // Calculate seasonal indices
            const seasonalIndices = this.calculateSeasonalIndices(monthlyData);

            // Identify peak and off-peak periods
            const seasonClassification = this.classifySeasons(seasonalIndices);

            // Weekly pattern analysis
            const weeklyPatterns = this.analyzeWeeklySeasonalPatterns(bookings);

            return {
                monthly: monthlyData,
                indices: seasonalIndices,
                classification: seasonClassification,
                weekly: weeklyPatterns,
                recommendations: this.generateSeasonalRecommendations(seasonalIndices)
            };
        } catch (error) {
            logger.error('Seasonal analysis failed:', error);
            return null;
        }
    }

    /**
     * Analyze demand trends and momentum
     */
    async analyzeTrends(hotelId, startDate, endDate) {
        try {
            // Get data for the last 6 months
            const sixMonthsAgo = moment().subtract(6, 'months').toDate();
            const bookings = await Booking.find({
                hotel: hotelId,
                createdAt: { $gte: sixMonthsAgo },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
            }).sort({ createdAt: 1 });

            // Group by week for trend analysis
            const weeklyTrends = {};
            bookings.forEach(booking => {
                const week = moment(booking.createdAt).format('YYYY-WW');
                if (!weeklyTrends[week]) {
                    weeklyTrends[week] = {
                        bookings: 0,
                        revenue: 0,
                        leadTime: [],
                        startDate: moment(booking.createdAt).startOf('week').toDate()
                    };
                }
                
                weeklyTrends[week].bookings++;
                weeklyTrends[week].revenue += booking.totalAmount || 0;
                const leadTime = moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');
                weeklyTrends[week].leadTime.push(leadTime);
            });

            // Calculate trend direction and momentum
            const trendAnalysis = this.calculateTrendMomentum(weeklyTrends);

            // Analyze booking pace (how far in advance people book)
            const bookingPace = this.analyzeBookingPace(bookings);

            // Demand acceleration/deceleration
            const demandAcceleration = this.calculateDemandAcceleration(weeklyTrends);

            return {
                weekly: weeklyTrends,
                direction: trendAnalysis.direction,
                momentum: trendAnalysis.momentum,
                bookingPace,
                acceleration: demandAcceleration,
                predictions: this.generateTrendPredictions(trendAnalysis, bookingPace)
            };
        } catch (error) {
            logger.error('Trend analysis failed:', error);
            return null;
        }
    }

    /**
     * Generate demand forecast for future periods
     */
    async generateDemandForecast(hotelId, startDate, endDate) {
        try {
            const forecastDays = moment(endDate).diff(moment(startDate), 'days') + 1;
            const forecast = {};

            for (let i = 0; i < forecastDays; i++) {
                const date = moment(startDate).add(i, 'days');
                const dateStr = date.format('YYYY-MM-DD');

                // Base demand from historical patterns
                const baseDemand = this.calculateBaseDemand(date, hotelId);

                // Apply seasonal adjustments
                const seasonalMultiplier = this.getSeasonalMultiplier(date);

                // Apply day-of-week patterns
                const dayOfWeekMultiplier = this.patterns.weekdays[date.day()];

                // Apply lead time factors
                const leadTimeDays = date.diff(moment(), 'days');
                const leadTimeMultiplier = this.getLeadTimeMultiplier(leadTimeDays);

                // Calculate final demand score
                const demandScore = baseDemand * seasonalMultiplier * dayOfWeekMultiplier * leadTimeMultiplier;

                // Convert to occupancy probability
                const occupancyProbability = Math.min(Math.max(demandScore, 0), 1);

                // Calculate recommended pricing adjustment
                const pricingMultiplier = this.calculatePricingMultiplier(occupancyProbability, leadTimeDays);

                forecast[dateStr] = {
                    date: date.toDate(),
                    demandScore: Math.round(demandScore * 100) / 100,
                    occupancyProbability: Math.round(occupancyProbability * 100),
                    pricingMultiplier: Math.round(pricingMultiplier * 100) / 100,
                    factors: {
                        seasonal: seasonalMultiplier,
                        dayOfWeek: dayOfWeekMultiplier,
                        leadTime: leadTimeMultiplier
                    },
                    recommendation: this.generateDayRecommendation(occupancyProbability, leadTimeDays)
                };
            }

            return {
                period: { startDate, endDate },
                daily: forecast,
                summary: this.summarizeForecast(forecast),
                confidence: this.calculateForecastConfidence(hotelId)
            };
        } catch (error) {
            logger.error('Demand forecast failed:', error);
            return null;
        }
    }

    /**
     * Analyze competitive position and market dynamics
     */
    async analyzeCompetitivePosition(hotelId) {
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) throw new Error('Hotel not found');

            // Find similar hotels in the same city
            const competitors = await Hotel.find({
                _id: { $ne: hotelId },
                city: hotel.city,
                stars: { $in: [hotel.stars - 1, hotel.stars, hotel.stars + 1] }
            }).limit(10);

            // Analyze market share and positioning
            const marketAnalysis = await this.analyzeMarketShare(hotel, competitors);

            // Price positioning analysis
            const pricePositioning = await this.analyzePricePositioning(hotel, competitors);

            return {
                hotel: {
                    id: hotel._id,
                    name: hotel.name,
                    stars: hotel.stars,
                    city: hotel.city
                },
                competitors: competitors.map(comp => ({
                    id: comp._id,
                    name: comp.name,
                    stars: comp.stars,
                    distance: this.calculateDistance(hotel, comp)
                })),
                marketShare: marketAnalysis,
                pricePosition: pricePositioning,
                opportunities: this.identifyMarketOpportunities(marketAnalysis, pricePositioning)
            };
        } catch (error) {
            logger.error('Competitive analysis failed:', error);
            return null;
        }
    }

    /**
     * Helper methods for calculations
     */
    analyzeLeadTimeDistribution(bookings) {
        const distribution = { 0: 0, 1: 0, 7: 0, 14: 0, 30: 0, '30+': 0 };
        
        bookings.forEach(booking => {
            const leadTime = moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');
            
            if (leadTime === 0) distribution[0]++;
            else if (leadTime <= 1) distribution[1]++;
            else if (leadTime <= 7) distribution[7]++;
            else if (leadTime <= 14) distribution[14]++;
            else if (leadTime <= 30) distribution[30]++;
            else distribution['30+']++;
        });

        return distribution;
    }

    groupBookingsByDay(bookings) {
        const byDay = {};
        bookings.forEach(booking => {
            const date = moment(booking.checkInDate).format('YYYY-MM-DD');
            byDay[date] = (byDay[date] || 0) + 1;
        });
        return byDay;
    }

    analyzeRoomTypeDistribution(bookings) {
        const distribution = {};
        bookings.forEach(booking => {
            booking.rooms.forEach(room => {
                const type = room.roomType || 'Unknown';
                distribution[type] = (distribution[type] || 0) + (room.quantity || 1);
            });
        });
        return distribution;
    }

    calculateYearOverYearGrowth(historicalData) {
        if (historicalData.length < 2) return null;

        const latest = historicalData[0];
        const previous = historicalData[1];

        if (!previous.totalBookings || !previous.totalRevenue) return null;

        return {
            bookings: ((latest.totalBookings - previous.totalBookings) / previous.totalBookings) * 100,
            revenue: ((latest.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100
        };
    }

    calculateHistoricalAverages(historicalData) {
        if (!historicalData.length) return null;

        const totalBookings = historicalData.reduce((sum, period) => sum + period.totalBookings, 0);
        const totalRevenue = historicalData.reduce((sum, period) => sum + period.totalRevenue, 0);

        return {
            avgBookingsPerPeriod: totalBookings / historicalData.length,
            avgRevenuePerPeriod: totalRevenue / historicalData.length,
            avgBookingValue: totalBookings > 0 ? totalRevenue / totalBookings : 0
        };
    }

    calculateADR(bookings, occupiedRoomNights) {
        if (!occupiedRoomNights) return 0;
        const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0);
        return totalRevenue / occupiedRoomNights;
    }

    calculateRevPAR(bookings, totalRoomNights) {
        if (!totalRoomNights) return 0;
        const totalRevenue = bookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0);
        return totalRevenue / totalRoomNights;
    }

    calculateBaseDemand(date, hotelId) {
        // This would use machine learning or statistical models
        // For now, using simplified calculation based on patterns
        const dayOfWeek = date.day();
        const month = date.month();
        
        return this.patterns.weekdays[dayOfWeek] * this.patterns.months[month] * 0.7; // Base 70% demand
    }

    getSeasonalMultiplier(date) {
        return this.patterns.months[date.month()];
    }

    getLeadTimeMultiplier(leadTimeDays) {
        const leadTimeKeys = Object.keys(this.patterns.leadTime).map(Number).sort((a, b) => a - b);
        
        for (let i = 0; i < leadTimeKeys.length; i++) {
            if (leadTimeDays <= leadTimeKeys[i]) {
                return this.patterns.leadTime[leadTimeKeys[i]];
            }
        }
        
        return this.patterns.leadTime[60]; // Default for very long lead times
    }

    calculatePricingMultiplier(occupancyProbability, leadTimeDays) {
        // Higher demand = higher prices, but consider lead time
        let multiplier = 0.8 + (occupancyProbability * 0.4); // Base range 0.8 - 1.2
        
        // Adjust for urgency (closer dates can charge more)
        if (leadTimeDays <= 3) multiplier *= 1.1;
        else if (leadTimeDays <= 7) multiplier *= 1.05;
        else if (leadTimeDays > 30) multiplier *= 0.95;
        
        return Math.max(0.6, Math.min(1.5, multiplier)); // Cap between 60% and 150%
    }

    generateDayRecommendation(occupancyProbability, leadTimeDays) {
        if (occupancyProbability > 80) {
            return { action: 'INCREASE_PRICE', intensity: 'HIGH', reason: 'High demand expected' };
        } else if (occupancyProbability > 60) {
            return { action: 'INCREASE_PRICE', intensity: 'MEDIUM', reason: 'Moderate demand expected' };
        } else if (occupancyProbability < 30) {
            return { action: 'DECREASE_PRICE', intensity: 'HIGH', reason: 'Low demand expected' };
        } else if (occupancyProbability < 50) {
            return { action: 'DECREASE_PRICE', intensity: 'MEDIUM', reason: 'Below average demand' };
        } else {
            return { action: 'MAINTAIN_PRICE', intensity: 'NONE', reason: 'Normal demand expected' };
        }
    }

    generateRecommendations(analysis) {
        const recommendations = [];

        // Occupancy-based recommendations
        if (analysis.occupancy?.overall?.occupancyRate < 60) {
            recommendations.push({
                type: 'PRICING',
                priority: 'HIGH',
                action: 'Consider reducing prices to increase occupancy',
                impact: 'Revenue optimization through volume'
            });
        } else if (analysis.occupancy?.overall?.occupancyRate > 85) {
            recommendations.push({
                type: 'PRICING',
                priority: 'HIGH',
                action: 'Increase prices to maximize revenue from high demand',
                impact: 'Revenue optimization through pricing'
            });
        }

        // Seasonal recommendations
        if (analysis.seasonal) {
            recommendations.push({
                type: 'SEASONAL',
                priority: 'MEDIUM',
                action: 'Optimize seasonal pricing strategy based on patterns',
                impact: 'Year-round revenue optimization'
            });
        }

        return recommendations;
    }

    summarizeForecast(forecast) {
        const days = Object.values(forecast);
        const avgDemand = days.reduce((sum, day) => sum + day.demandScore, 0) / days.length;
        const avgOccupancy = days.reduce((sum, day) => sum + day.occupancyProbability, 0) / days.length;
        const avgPricing = days.reduce((sum, day) => sum + day.pricingMultiplier, 0) / days.length;

        return {
            averageDemandScore: Math.round(avgDemand * 100) / 100,
            averageOccupancyProbability: Math.round(avgOccupancy),
            averagePricingMultiplier: Math.round(avgPricing * 100) / 100,
            totalDays: days.length,
            highDemandDays: days.filter(d => d.occupancyProbability > 70).length,
            lowDemandDays: days.filter(d => d.occupancyProbability < 40).length
        };
    }

    calculateForecastConfidence(hotelId) {
        // Calculate confidence based on data availability and quality
        // This is a simplified version - in production, this would be more sophisticated
        return {
            overall: 75, // 75% confidence
            factors: {
                dataQuality: 80,
                historicalDepth: 70,
                seasonalConsistency: 75
            }
        };
    }

    getCachedResult(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }
        return null;
    }

    setCachedResult(key, data) {
        this.cache.set(key, { data, timestamp: Date.now() });
    }

    // Additional helper methods would be implemented here...
    // (calculateSeasonalIndices, classifySeasons, etc.)
}

module.exports = new DemandAnalyzer();