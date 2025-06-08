/**
 * ANALYTICS CONTROLLER - ADVANCED HOTEL ANALYTICS WITH YIELD MANAGEMENT
 * Comprehensive analytics system for hotel management with real-time data,
 * yield management insights, revenue optimization, and advanced reporting
 * 
 * Features:
 * - Revenue Analytics (RevPAR, ADR, Occupancy)
 * - Demand Analytics & Forecasting
 * - Yield Performance Analytics
 * - Operational Analytics
 * - Real-time Dashboard Streaming
 * - Advanced Reporting & Export
 * - Market Intelligence
 * - Customer Segment Analytics
 */

const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');
const mongoose = require('mongoose');
const moment = require('moment');

// Services Integration
const yieldManager = require('../services/yieldManager');
const revenueAnalytics = require('../services/revenueAnalytics');
const demandAnalyzer = require('../services/demandAnalyzer');
const socketService = require('../services/socketService');
const currencyService = require('../services/currencyService');

// Utilities
const { logger } = require('../utils/logger');
const {
    BOOKING_STATUS,
    BOOKING_SOURCES,
    ROOM_TYPES,
    CLIENT_TYPES,
    USER_ROLES,
    PERFORMANCE_METRICS,
    ANALYSIS_PERIODS,
    DEMAND_LEVELS
} = require('../utils/constants');

class AnalyticsController {
    constructor() {
        this.cache = new Map();
        this.cacheExpiry = 15 * 60 * 1000; // 15 minutes cache
        this.streamingClients = new Map(); // For real-time dashboard streaming
        
        // Analytics calculation weights
        this.analyticsWeights = {
            revenue: 0.4,
            occupancy: 0.3,
            yield: 0.2,
            customer: 0.1
        };

        // Performance benchmarks
        this.benchmarks = {
            occupancyRate: { poor: 50, average: 70, good: 85, excellent: 95 },
            revPAR: { poor: 50, average: 80, good: 120, excellent: 180 },
            adr: { poor: 100, average: 150, good: 200, excellent: 300 },
            yieldScore: { poor: 60, average: 75, good: 85, excellent: 95 }
        };

        logger.info('Analytics Controller initialized with advanced features');
    }

    /**
     * ================================
     * REVENUE ANALYTICS ENDPOINTS
     * ================================
     */

    /**
     * @desc    Get comprehensive revenue analytics
     * @route   GET /api/analytics/revenue
     * @access  Admin + Receptionist
     */
    async getRevenueAnalytics(req, res) {
        try {
            const {
                period = '30d',
                hotelId,
                roomType,
                currency = 'EUR',
                includeForecasting = true,
                granularity = 'daily',
                realTime = false
            } = req.query;

            const { startDate, endDate } = this.parsePeriod(period);
            const cacheKey = `revenue_${hotelId || 'all'}_${period}_${roomType || 'all'}_${currency}`;
            
            // Check cache first
            const cached = this.getCachedResult(cacheKey);
            if (cached && !realTime) {
                return res.json({ success: true, data: cached, cached: true });
            }

            // Build query filters
            const query = this.buildAnalyticsQuery({ hotelId, roomType, startDate, endDate });

            // Parallel data collection
            const [
                revenueMetrics,
                occupancyData,
                pricingAnalysis,
                segmentAnalysis,
                trendAnalysis,
                forecastData
            ] = await Promise.all([
                this.calculateRevenueMetrics(query, currency, granularity),
                this.calculateOccupancyMetrics(query, granularity),
                this.analyzePricingPerformance(query, currency),
                this.analyzeRevenueSegments(query, currency),
                this.analyzeTrends(query, granularity),
                includeForecasting === 'true' ? this.generateRevenueForecast(hotelId, 30) : null
            ]);

            // Calculate composite scores
            const performanceScore = this.calculateOverallPerformanceScore({
                revenue: revenueMetrics.summary.totalRevenue,
                occupancy: occupancyData.summary.averageOccupancy,
                adr: revenueMetrics.summary.adr,
                revPAR: revenueMetrics.summary.revPAR
            });

            // Generate insights and recommendations
            const insights = this.generateRevenueInsights({
                revenueMetrics,
                occupancyData,
                pricingAnalysis,
                performanceScore
            });

            const analyticsData = {
                metadata: {
                    period: { start: startDate, end: endDate, description: period },
                    filters: { hotelId, roomType, currency },
                    granularity,
                    generatedAt: new Date(),
                    dataPoints: revenueMetrics.summary.totalBookings
                },
                revenue: revenueMetrics,
                occupancy: occupancyData,
                pricing: pricingAnalysis,
                segments: segmentAnalysis,
                trends: trendAnalysis,
                forecast: forecastData,
                performance: {
                    overallScore: performanceScore,
                    ratings: this.ratePerformanceMetrics({
                        occupancy: occupancyData.summary.averageOccupancy,
                        revPAR: revenueMetrics.summary.revPAR,
                        adr: revenueMetrics.summary.adr
                    }),
                    benchmarkComparison: this.compareToBenchmarks({
                        occupancy: occupancyData.summary.averageOccupancy,
                        revPAR: revenueMetrics.summary.revPAR,
                        adr: revenueMetrics.summary.adr
                    })
                },
                insights,
                recommendations: this.generateRevenueRecommendations(insights),
                realTimeEnabled: realTime === 'true'
            };

            // Cache results
            this.setCachedResult(cacheKey, analyticsData);

            // Setup real-time streaming if requested
            if (realTime === 'true') {
                this.setupRealtimeAnalytics(req.user.id, 'revenue', { hotelId, period, currency });
            }

            res.json({
                success: true,
                data: analyticsData
            });

            logger.info(`Revenue analytics generated for ${hotelId || 'all hotels'} - ${period}`);

        } catch (error) {
            logger.error('Error generating revenue analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate revenue analytics',
                error: error.message
            });
        }
    }

    /**
     * @desc    Get demand analytics and forecasting
     * @route   GET /api/analytics/demand
     * @access  Admin + Receptionist
     */
    async getDemandAnalytics(req, res) {
        try {
            const {
                period = '30d',
                hotelId,
                forecastDays = 30,
                includeSeasonality = true,
                includeCompetitor = false,
                granularity = 'daily'
            } = req.query;

            const { startDate, endDate } = this.parsePeriod(period);

            // Parallel demand analysis
            const [
                demandPatterns,
                bookingTrends,
                seasonalAnalysis,
                leadTimeAnalysis,
                marketDemand,
                demandForecast
            ] = await Promise.all([
                this.analyzeDemandPatterns(hotelId, startDate, endDate),
                this.analyzeBookingTrends(hotelId, startDate, endDate, granularity),
                includeSeasonality === 'true' ? this.analyzeSeasonalDemand(hotelId) : null,
                this.analyzeLeadTimePatterns(hotelId, startDate, endDate),
                this.analyzeMarketDemand(hotelId, startDate, endDate),
                this.generateDemandForecast(hotelId, parseInt(forecastDays))
            ]);

            // Calculate demand scores and indicators
            const demandIndicators = this.calculateDemandIndicators({
                patterns: demandPatterns,
                trends: bookingTrends,
                forecast: demandForecast
            });

            const analyticsData = {
                metadata: {
                    period: { start: startDate, end: endDate },
                    hotelId: hotelId || 'all',
                    forecastDays: parseInt(forecastDays),
                    generatedAt: new Date()
                },
                patterns: demandPatterns,
                trends: bookingTrends,
                seasonal: seasonalAnalysis,
                leadTime: leadTimeAnalysis,
                market: marketDemand,
                forecast: demandForecast,
                indicators: demandIndicators,
                insights: this.generateDemandInsights({
                    patterns: demandPatterns,
                    trends: bookingTrends,
                    indicators: demandIndicators
                }),
                recommendations: this.generateDemandRecommendations(demandIndicators)
            };

            res.json({
                success: true,
                data: analyticsData
            });

        } catch (error) {
            logger.error('Error generating demand analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate demand analytics',
                error: error.message
            });
        }
    }

    /**
     * @desc    Get yield management performance analytics
     * @route   GET /api/analytics/yield
     * @access  Admin + Receptionist
     */
    async getYieldAnalytics(req, res) {
        try {
            const {
                period = '30d',
                hotelId,
                strategy = 'all',
                includeOptimization = true,
                includeRuleAnalysis = true
            } = req.query;

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const { startDate, endDate } = this.parsePeriod(period);

            // Comprehensive yield analytics
            const [
                yieldPerformance,
                priceOptimization,
                ruleEffectiveness,
                revenueImpact,
                strategyComparison,
                elasticityAnalysis
            ] = await Promise.all([
                this.analyzeYieldPerformance(hotelId, startDate, endDate),
                includeOptimization === 'true' ? this.analyzePriceOptimization(hotelId, startDate, endDate) : null,
                includeRuleAnalysis === 'true' ? this.analyzeYieldRules(hotelId, startDate, endDate) : null,
                this.calculateYieldRevenueImpact(hotelId, startDate, endDate),
                this.compareYieldStrategies(hotelId, startDate, endDate),
                this.analyzePriceElasticity(hotelId, startDate, endDate)
            ]);

            // Calculate yield effectiveness scores
            const effectivenessScores = this.calculateYieldEffectiveness({
                performance: yieldPerformance,
                optimization: priceOptimization,
                impact: revenueImpact
            });

            const analyticsData = {
                metadata: {
                    period: { start: startDate, end: endDate },
                    hotelId: hotelId || 'all',
                    strategy,
                    generatedAt: new Date()
                },
                performance: yieldPerformance,
                optimization: priceOptimization,
                rules: ruleEffectiveness,
                impact: revenueImpact,
                strategies: strategyComparison,
                elasticity: elasticityAnalysis,
                effectiveness: effectivenessScores,
                insights: this.generateYieldInsights({
                    performance: yieldPerformance,
                    optimization: priceOptimization,
                    effectiveness: effectivenessScores
                }),
                recommendations: this.generateYieldRecommendations(effectivenessScores, yieldPerformance)
            };

            res.json({
                success: true,
                data: analyticsData
            });

        } catch (error) {
            logger.error('Error generating yield analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate yield analytics',
                error: error.message
            });
        }
    }

    /**
     * @desc    Get operational analytics dashboard
     * @route   GET /api/analytics/operational
     * @access  Admin + Receptionist
     */
    async getOperationalAnalytics(req, res) {
        try {
            const {
                period = '7d',
                hotelId,
                includeStaff = false,
                includeEfficiency = true,
                realTime = false
            } = req.query;

            const { startDate, endDate } = this.parsePeriod(period);

            // Operational metrics collection
            const [
                checkInOutMetrics,
                serviceMetrics,
                efficiencyMetrics,
                staffMetrics,
                qualityMetrics,
                channelPerformance
            ] = await Promise.all([
                this.analyzeCheckInOutMetrics(hotelId, startDate, endDate),
                this.analyzeServiceMetrics(hotelId, startDate, endDate),
                includeEfficiency === 'true' ? this.analyzeEfficiencyMetrics(hotelId, startDate, endDate) : null,
                includeStaff === 'true' ? this.analyzeStaffMetrics(hotelId, startDate, endDate) : null,
                this.analyzeQualityMetrics(hotelId, startDate, endDate),
                this.analyzeChannelPerformance(hotelId, startDate, endDate)
            ]);

            // Calculate operational scores
            const operationalScores = this.calculateOperationalScores({
                checkInOut: checkInOutMetrics,
                service: serviceMetrics,
                efficiency: efficiencyMetrics,
                quality: qualityMetrics
            });

            const analyticsData = {
                metadata: {
                    period: { start: startDate, end: endDate },
                    hotelId: hotelId || 'all',
                    generatedAt: new Date()
                },
                checkInOut: checkInOutMetrics,
                service: serviceMetrics,
                efficiency: efficiencyMetrics,
                staff: staffMetrics,
                quality: qualityMetrics,
                channels: channelPerformance,
                scores: operationalScores,
                insights: this.generateOperationalInsights({
                    scores: operationalScores,
                    metrics: { checkInOutMetrics, serviceMetrics, qualityMetrics }
                }),
                recommendations: this.generateOperationalRecommendations(operationalScores)
            };

            // Setup real-time streaming
            if (realTime === 'true') {
                this.setupRealtimeAnalytics(req.user.id, 'operational', { hotelId, period });
            }

            res.json({
                success: true,
                data: analyticsData
            });

        } catch (error) {
            logger.error('Error generating operational analytics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate operational analytics',
                error: error.message
            });
        }
    }

    /**
     * @desc    Get comprehensive analytics dashboard
     * @route   GET /api/analytics/dashboard
     * @access  Admin + Receptionist
     */
    async getAnalyticsDashboard(req, res) {
        try {
            const {
                period = '7d',
                hotelId,
                widgets = 'all',
                realTime = true,
                refreshInterval = 30000
            } = req.query;

            const { startDate, endDate } = this.parsePeriod(period);

            // Dashboard data collection
            const [
                kpiMetrics,
                revenueOverview,
                occupancyOverview,
                demandOverview,
                yieldOverview,
                alerts,
                trends
            ] = await Promise.all([
                this.calculateDashboardKPIs(hotelId, startDate, endDate),
                this.getRevenueOverview(hotelId, startDate, endDate),
                this.getOccupancyOverview(hotelId, startDate, endDate),
                this.getDemandOverview(hotelId, startDate, endDate),
                process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? this.getYieldOverview(hotelId, startDate, endDate) : null,
                this.getAnalyticsAlerts(hotelId),
                this.getTrendsSummary(hotelId, startDate, endDate)
            ]);

            // Real-time metrics if enabled
            let realTimeMetrics = null;
            if (realTime === 'true') {
                realTimeMetrics = await this.getRealTimeMetrics(hotelId);
                this.setupDashboardStreaming(req.user.id, { hotelId, period, refreshInterval });
            }

            const dashboardData = {
                metadata: {
                    period: { start: startDate, end: endDate },
                    hotelId: hotelId || 'all',
                    generatedAt: new Date(),
                    realTimeEnabled: realTime === 'true',
                    refreshInterval: parseInt(refreshInterval)
                },
                kpis: kpiMetrics,
                overview: {
                    revenue: revenueOverview,
                    occupancy: occupancyOverview,
                    demand: demandOverview,
                    yield: yieldOverview
                },
                realTime: realTimeMetrics,
                alerts,
                trends,
                quickStats: this.generateQuickStats({
                    kpis: kpiMetrics,
                    revenue: revenueOverview,
                    occupancy: occupancyOverview
                }),
                performanceIndicators: this.generatePerformanceIndicators({
                    kpis: kpiMetrics,
                    trends
                })
            };

            res.json({
                success: true,
                data: dashboardData
            });

            logger.info(`Analytics dashboard generated for ${hotelId || 'all hotels'}`);

        } catch (error) {
            logger.error('Error generating analytics dashboard:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate analytics dashboard',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * ADVANCED REPORTING ENDPOINTS
     * ================================
     */

    /**
     * @desc    Generate comprehensive analytics report
     * @route   POST /api/analytics/reports/generate
     * @access  Admin + Receptionist
     */
    async generateAnalyticsReport(req, res) {
        try {
            const {
                reportType = 'comprehensive',
                period = '30d',
                hotelId,
                sections = ['revenue', 'occupancy', 'demand', 'yield'],
                format = 'json',
                includeCharts = true,
                includeRecommendations = true,
                customTitle,
                recipients
            } = req.body;

            const { startDate, endDate } = this.parsePeriod(period);
            const reportId = this.generateReportId();

            // Generate report sections based on request
            const reportSections = {};
            
            if (sections.includes('revenue')) {
                reportSections.revenue = await this.generateRevenueSection(hotelId, startDate, endDate);
            }
            
            if (sections.includes('occupancy')) {
                reportSections.occupancy = await this.generateOccupancySection(hotelId, startDate, endDate);
            }
            
            if (sections.includes('demand')) {
                reportSections.demand = await this.generateDemandSection(hotelId, startDate, endDate);
            }
            
            if (sections.includes('yield') && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                reportSections.yield = await this.generateYieldSection(hotelId, startDate, endDate);
            }

            if (sections.includes('operational')) {
                reportSections.operational = await this.generateOperationalSection(hotelId, startDate, endDate);
            }

            // Generate executive summary
            const executiveSummary = this.generateExecutiveSummary(reportSections);

            // Generate recommendations
            const recommendations = includeRecommendations ? 
                this.generateComprehensiveRecommendations(reportSections) : null;

            const report = {
                metadata: {
                    reportId,
                    title: customTitle || `Analytics Report - ${period}`,
                    reportType,
                    period: { start: startDate, end: endDate, description: period },
                    hotelId: hotelId || 'all',
                    sections,
                    generatedAt: new Date(),
                    generatedBy: req.user.id
                },
                executiveSummary,
                sections: reportSections,
                recommendations,
                appendix: {
                    methodology: this.getReportMethodology(),
                    glossary: this.getAnalyticsGlossary(),
                    benchmarks: this.benchmarks
                }
            };

            // Handle different output formats
            if (format === 'pdf') {
                const pdfBuffer = await this.generatePDFReport(report);
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="analytics-report-${reportId}.pdf"`);
                return res.send(pdfBuffer);
            }

            if (format === 'excel') {
                const excelBuffer = await this.generateExcelReport(report);
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="analytics-report-${reportId}.xlsx"`);
                return res.send(excelBuffer);
            }

            // Send report via email if recipients specified
            if (recipients && recipients.length > 0) {
                await this.emailReport(report, recipients, format);
            }

            // Store report for future access
            await this.storeReport(reportId, report);

            res.json({
                success: true,
                data: {
                    report,
                    reportId,
                    downloadUrls: {
                        pdf: `/api/analytics/reports/${reportId}/download?format=pdf`,
                        excel: `/api/analytics/reports/${reportId}/download?format=excel`,
                        json: `/api/analytics/reports/${reportId}/download?format=json`
                    }
                }
            });

            logger.info(`Analytics report generated: ${reportId} for ${hotelId || 'all hotels'}`);

        } catch (error) {
            logger.error('Error generating analytics report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate analytics report',
                error: error.message
            });
        }
    }

    /**
     * @desc    Export analytics data
     * @route   GET /api/analytics/export
     * @access  Admin + Receptionist
     */
    async exportAnalyticsData(req, res) {
        try {
            const {
                dataType = 'revenue',
                period = '30d',
                hotelId,
                format = 'csv',
                includeHeaders = true,
                granularity = 'daily'
            } = req.query;

            const { startDate, endDate } = this.parsePeriod(period);

            // Get data based on type
            let exportData;
            switch (dataType) {
                case 'revenue':
                    exportData = await this.exportRevenueData(hotelId, startDate, endDate, granularity);
                    break;
                case 'occupancy':
                    exportData = await this.exportOccupancyData(hotelId, startDate, endDate, granularity);
                    break;
                case 'bookings':
                    exportData = await this.exportBookingsData(hotelId, startDate, endDate);
                    break;
                case 'yield':
                    exportData = await this.exportYieldData(hotelId, startDate, endDate, granularity);
                    break;
                default:
                    throw new Error('Invalid data type for export');
            }

            // Format data based on requested format
            let responseData, mimeType, filename;

            switch (format.toLowerCase()) {
                case 'csv':
                    responseData = this.convertToCSV(exportData, includeHeaders === 'true');
                    mimeType = 'text/csv';
                    filename = `${dataType}-${period}.csv`;
                    break;
                case 'json':
                    responseData = JSON.stringify(exportData, null, 2);
                    mimeType = 'application/json';
                    filename = `${dataType}-${period}.json`;
                    break;
                case 'excel':
                    responseData = await this.convertToExcel(exportData);
                    mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
                    filename = `${dataType}-${period}.xlsx`;
                    break;
                default:
                    throw new Error('Unsupported export format');
            }

            res.setHeader('Content-Type', mimeType);
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(responseData);

            logger.info(`Analytics data exported: ${dataType} - ${format} for ${hotelId || 'all hotels'}`);

        } catch (error) {
            logger.error('Error exporting analytics data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to export analytics data',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * REAL-TIME ANALYTICS STREAMING
     * ================================
     */

    /**
     * Setup real-time analytics streaming for a user
     */
    async setupRealtimeAnalytics(userId, analyticsType, options = {}) {
        try {
            const streamId = `${userId}_${analyticsType}_${Date.now()}`;
            
            this.streamingClients.set(streamId, {
                userId,
                analyticsType,
                options,
                startedAt: new Date(),
                lastUpdate: new Date()
            });

            // Send initial data
            await this.sendRealtimeUpdate(streamId);

            // Setup periodic updates
            const interval = setInterval(async () => {
                if (!this.streamingClients.has(streamId)) {
                    clearInterval(interval);
                    return;
                }
                
                await this.sendRealtimeUpdate(streamId);
            }, options.refreshInterval || 30000);

            // Cleanup after 1 hour
            setTimeout(() => {
                this.streamingClients.delete(streamId);
                clearInterval(interval);
            }, 60 * 60 * 1000);

            logger.info(`Real-time analytics streaming started: ${streamId}`);

        } catch (error) {
            logger.error('Error setting up real-time analytics:', error);
        }
    }

    /**
     * Send real-time analytics update
     */
    async sendRealtimeUpdate(streamId) {
        try {
            const client = this.streamingClients.get(streamId);
            if (!client) return;

            let updateData;
            const { analyticsType, options, userId } = client;

            switch (analyticsType) {
                case 'revenue':
                    updateData = await this.getRealTimeRevenueUpdate(options);
                    break;
                case 'occupancy':
                    updateData = await this.getRealTimeOccupancyUpdate(options);
                    break;
                case 'demand':
                    updateData = await this.getRealTimeDemandUpdate(options);
                    break;
                case 'operational':
                    updateData = await this.getRealTimeOperationalUpdate(options);
                    break;
                default:
                    return;
            }

            // Send update via Socket.io
            socketService.sendUserNotification(userId, 'analytics-realtime-update', {
                streamId,
                type: analyticsType,
                data: updateData,
                timestamp: new Date()
            });

            // Update last update time
            client.lastUpdate = new Date();

        } catch (error) {
            logger.error('Error sending real-time analytics update:', error);
        }
    }

    /**
     * Setup dashboard streaming
     */
    async setupDashboardStreaming(userId, options = {}) {
        try {
            const streamInterval = options.refreshInterval || 30000;
            
            const sendDashboardUpdate = async () => {
                try {
                    const liveData = await this.getLiveDashboardData(options);
                    
                    socketService.sendUserNotification(userId, 'dashboard-analytics-update', {
                        data: liveData,
                        timestamp: new Date()
                    });
                } catch (error) {
                    logger.error('Error sending dashboard update:', error);
                }
            };

            // Send initial update
            await sendDashboardUpdate();

            // Setup periodic updates
            const interval = setInterval(sendDashboardUpdate, streamInterval);

            // Cleanup after 2 hours
            setTimeout(() => {
                clearInterval(interval);
            }, 2 * 60 * 60 * 1000);

        } catch (error) {
            logger.error('Error setting up dashboard streaming:', error);
        }
    }

    /**
     * ================================
     * ANALYTICS CALCULATION METHODS
     * ================================
     */

    /**
     * Calculate comprehensive revenue metrics
     */
    async calculateRevenueMetrics(query, currency = 'EUR', granularity = 'daily') {
        try {
            const bookings = await Booking.find(query)
                .populate('hotel', 'name totalRooms')
                .populate('rooms.room', 'type');

            if (bookings.length === 0) {
                return this.getEmptyRevenueMetrics();
            }

            // Convert currencies
            const revenueData = await Promise.all(
                bookings.map(async (booking) => {
                    let convertedAmount = booking.totalPrice || 0;
                    
                    if (booking.currency !== currency) {
                        try {
                            const converted = await currencyService.convertCurrency(
                                booking.totalPrice || 0,
                                booking.currency || 'EUR',
                                currency
                            );
                            convertedAmount = converted.convertedAmount;
                        } catch (error) {
                            logger.warn(`Currency conversion failed for booking ${booking._id}`);
                        }
                    }
                    
                    return {
                        ...booking.toObject(),
                        convertedAmount,
                        nights: moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days')
                    };
                })
            );

            // Calculate room nights
            const totalRoomNights = revenueData.reduce((sum, booking) => {
                return sum + (booking.rooms.length * booking.nights);
            }, 0);

            // Calculate total revenue
            const totalRevenue = revenueData.reduce((sum, booking) => sum + booking.convertedAmount, 0);

            // Calculate ADR (Average Daily Rate)
            const adr = totalRoomNights > 0 ? totalRevenue / totalRoomNights : 0;

            // Calculate RevPAR (Revenue Per Available Room)
            const totalAvailableRoomNights = await this.calculateAvailableRoomNights(query);
            const revPAR = totalAvailableRoomNights > 0 ? totalRevenue / totalAvailableRoomNights : 0;

            // Group by time period for trends
            const timeSeriesData = this.groupRevenueByPeriod(revenueData, granularity);

            // Revenue by room type
            const revenueByRoomType = this.calculateRevenueByRoomType(revenueData);

            // Revenue by source
            const revenueBySource = this.calculateRevenueBySource(revenueData);

            return {
                summary: {
                    totalRevenue: Math.round(totalRevenue * 100) / 100,
                    totalBookings: revenueData.length,
                    totalRoomNights,
                    averageBookingValue: revenueData.length > 0 ? totalRevenue / revenueData.length : 0,
                    adr: Math.round(adr * 100) / 100,
                    revPAR: Math.round(revPAR * 100) / 100,
                    currency
                },
                timeSeries: timeSeriesData,
                breakdown: {
                    byRoomType: revenueByRoomType,
                    bySource: revenueBySource,
                    byClientType: this.calculateRevenueByClientType(revenueData)
                },
                growth: await this.calculateRevenueGrowth(query, currency),
                variance: this.calculateRevenueVariance(timeSeriesData)
            };

        } catch (error) {
            logger.error('Error calculating revenue metrics:', error);
            throw error;
        }
    }

    /**
     * Calculate occupancy metrics with detailed breakdown
     */
    async calculateOccupancyMetrics(query, granularity = 'daily') {
        try {
            // Get hotel room inventory
            const hotels = await Hotel.find(query.hotel ? { _id: query.hotel } : {})
                .populate('rooms');

            const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);

            // Get bookings for occupancy calculation
            const bookings = await Booking.find({
                ...query,
                status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED] }
            });

            // Calculate daily occupancy
            const dailyOccupancy = {};
            const startDate = moment(query.checkInDate?.$gte || query.createdAt?.$gte);
            const endDate = moment(query.checkInDate?.$lte || query.createdAt?.$lte);

            for (let date = moment(startDate); date.isSameOrBefore(endDate); date.add(1, 'day')) {
                const dateStr = date.format('YYYY-MM-DD');
                let occupiedRooms = 0;

                bookings.forEach(booking => {
                    const checkIn = moment(booking.checkInDate);
                    const checkOut = moment(booking.checkOutDate);
                    
                    if (date.isSameOrAfter(checkIn) && date.isBefore(checkOut)) {
                        occupiedRooms += booking.rooms.length;
                    }
                });

                const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
                
                dailyOccupancy[dateStr] = {
                    date: date.toDate(),
                    occupiedRooms,
                    totalRooms,
                    occupancyRate: Math.round(occupancyRate * 100) / 100
                };
            }

            // Calculate average occupancy
            const occupancyRates = Object.values(dailyOccupancy).map(day => day.occupancyRate);
            const averageOccupancy = occupancyRates.length > 0 ? 
                occupancyRates.reduce((sum, rate) => sum + rate, 0) / occupancyRates.length : 0;

            // Group by time period
            const timeSeriesData = this.groupOccupancyByPeriod(dailyOccupancy, granularity);

            // Calculate occupancy by room type
            const occupancyByRoomType = await this.calculateOccupancyByRoomType(query, bookings);

            // Weekly patterns
            const weeklyPatterns = this.analyzeWeeklyOccupancyPatterns(dailyOccupancy);

            return {
                summary: {
                    averageOccupancy: Math.round(averageOccupancy * 100) / 100,
                    totalRooms,
                    peakOccupancy: Math.max(...occupancyRates, 0),
                    minimumOccupancy: Math.min(...occupancyRates, 100),
                    occupancyVariance: this.calculateVariance(occupancyRates)
                },
                daily: dailyOccupancy,
                timeSeries: timeSeriesData,
                breakdown: {
                    byRoomType: occupancyByRoomType,
                    weeklyPatterns
                },
                trends: this.calculateOccupancyTrends(timeSeriesData)
            };

        } catch (error) {
            logger.error('Error calculating occupancy metrics:', error);
            throw error;
        }
    }

    /**
     * Analyze pricing performance and elasticity
     */
    async analyzePricingPerformance(query, currency = 'EUR') {
        try {
            const bookings = await Booking.find(query);

            if (bookings.length === 0) {
                return { message: 'No booking data available for pricing analysis' };
            }

            // Price distribution analysis
            const priceRanges = this.analyzePriceDistribution(bookings, currency);

            // Price elasticity calculation
            const elasticity = await this.calculatePriceElasticity(bookings, query);

            // Yield management impact (if enabled)
            let yieldImpact = null;
            if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                yieldImpact = await this.analyzeYieldPricingImpact(bookings);
            }

            // Average pricing by period
            const pricingTrends = this.analyzePricingTrends(bookings, currency);

            // Competitive pricing analysis
            const competitiveAnalysis = await this.analyzeCompetitivePricing(query);

            return {
                distribution: priceRanges,
                elasticity,
                yieldImpact,
                trends: pricingTrends,
                competitive: competitiveAnalysis,
                recommendations: this.generatePricingRecommendations({
                    elasticity,
                    yieldImpact,
                    competitive: competitiveAnalysis
                })
            };

        } catch (error) {
            logger.error('Error analyzing pricing performance:', error);
            throw error;
        }
    }

    /**
     * Analyze revenue segments (customer types, sources, etc.)
     */
    async analyzeRevenueSegments(query, currency = 'EUR') {
        try {
            const bookings = await Booking.find(query)
                .populate('customer', 'clientType')
                .populate('hotel', 'name category');

            const segments = {
                byClientType: {},
                bySource: {},
                byHotelCategory: {},
                byBookingValue: {},
                byStayLength: {}
            };

            for (const booking of bookings) {
                let convertedAmount = booking.totalPrice || 0;
                
                // Convert currency if needed
                if (booking.currency !== currency) {
                    try {
                        const converted = await currencyService.convertCurrency(
                            booking.totalPrice || 0,
                            booking.currency || 'EUR',
                            currency
                        );
                        convertedAmount = converted.convertedAmount;
                    } catch (error) {
                        // Use original amount if conversion fails
                    }
                }

                // Segment by client type
                const clientType = booking.clientType || 'INDIVIDUAL';
                segments.byClientType[clientType] = (segments.byClientType[clientType] || 0) + convertedAmount;

                // Segment by booking source
                const source = booking.source || 'DIRECT';
                segments.bySource[source] = (segments.bySource[source] || 0) + convertedAmount;

                // Segment by hotel category
                const category = booking.hotel?.category || 'STANDARD';
                segments.byHotelCategory[category] = (segments.byHotelCategory[category] || 0) + convertedAmount;

                // Segment by booking value
                const valueSegment = this.categorizeBookingValue(convertedAmount);
                segments.byBookingValue[valueSegment] = (segments.byBookingValue[valueSegment] || 0) + convertedAmount;

                // Segment by stay length
                const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
                const lengthSegment = this.categorizeStayLength(nights);
                segments.byStayLength[lengthSegment] = (segments.byStayLength[lengthSegment] || 0) + convertedAmount;
            }

            // Calculate percentages and insights
            const totalRevenue = Object.values(segments.byClientType).reduce((sum, val) => sum + val, 0);
            
            const segmentAnalysis = {};
            for (const [segmentType, segmentData] of Object.entries(segments)) {
                segmentAnalysis[segmentType] = Object.entries(segmentData).map(([key, value]) => ({
                    segment: key,
                    revenue: Math.round(value * 100) / 100,
                    percentage: totalRevenue > 0 ? Math.round((value / totalRevenue) * 10000) / 100 : 0
                })).sort((a, b) => b.revenue - a.revenue);
            }

            return {
                segments: segmentAnalysis,
                insights: this.generateSegmentInsights(segmentAnalysis),
                opportunities: this.identifySegmentOpportunities(segmentAnalysis)
            };

        } catch (error) {
            logger.error('Error analyzing revenue segments:', error);
            throw error;
        }
    }

    /**
     * Analyze trends across different time periods
     */
    async analyzeTrends(query, granularity = 'daily') {
        try {
            const bookings = await Booking.find(query).sort({ createdAt: 1 });

            if (bookings.length === 0) {
                return { message: 'No data available for trend analysis' };
            }

            // Group data by time period
            const groupedData = this.groupBookingsByPeriod(bookings, granularity);

            // Calculate trend metrics
            const trendMetrics = this.calculateTrendMetrics(groupedData);

            // Identify patterns
            const patterns = this.identifyTrendPatterns(groupedData);

            // Forecast trends
            const forecast = this.forecastTrends(groupedData, 7); // 7 periods ahead

            return {
                data: groupedData,
                metrics: trendMetrics,
                patterns,
                forecast,
                insights: this.generateTrendInsights(trendMetrics, patterns)
            };

        } catch (error) {
            logger.error('Error analyzing trends:', error);
            throw error;
        }
    }

    /**
     * Generate revenue forecast
     */
    async generateRevenueForecast(hotelId, days = 30) {
        try {
            // Use revenue analytics service if available
            if (revenueAnalytics && revenueAnalytics.generateRevenueForecast) {
                return await revenueAnalytics.generateRevenueForecast(hotelId, days);
            }

            // Fallback to simple forecasting
            const historicalData = await this.getHistoricalRevenueData(hotelId, 90);
            return this.simpleRevenueForecast(historicalData, days);

        } catch (error) {
            logger.error('Error generating revenue forecast:', error);
            return { error: 'Forecast generation failed', message: error.message };
        }
    }

    /**
     * ================================
     * YIELD MANAGEMENT ANALYTICS
     * ================================
     */

    /**
     * Analyze yield management performance
     */
    async analyzeYieldPerformance(hotelId, startDate, endDate) {
        try {
            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return { enabled: false, message: 'Yield management is disabled' };
            }

            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            
            // Get yield-optimized bookings
            const yieldBookings = await Booking.find({
                ...query,
                'yieldManagement.enabled': true
            });

            if (yieldBookings.length === 0) {
                return { message: 'No yield-optimized bookings found' };
            }

            // Calculate yield metrics
            const totalOptimizedBookings = yieldBookings.length;
            const totalRevenue = yieldBookings.reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);
            
            // Calculate base revenue (what would have been without yield)
            const totalBaseRevenue = yieldBookings.reduce((sum, booking) => {
                const basePrice = booking.yieldManagement?.pricingDetails?.[0]?.basePrice || booking.totalPrice;
                return sum + basePrice;
            }, 0);

            const revenueImpact = totalBaseRevenue > 0 ? 
                ((totalRevenue - totalBaseRevenue) / totalBaseRevenue) * 100 : 0;

            // Calculate average yield score
            const totalYieldScore = yieldBookings.reduce((sum, booking) => {
                return sum + (booking.yieldManagement?.performanceScore || 50);
            }, 0);
            const averageYieldScore = totalOptimizedBookings > 0 ? totalYieldScore / totalOptimizedBookings : 0;

            // Analyze by strategy
            const strategyPerformance = this.analyzeYieldByStrategy(yieldBookings);

            // Analyze by demand level
            const demandLevelPerformance = this.analyzeYieldByDemandLevel(yieldBookings);

            return {
                enabled: true,
                summary: {
                    totalOptimizedBookings,
                    totalRevenue: Math.round(totalRevenue * 100) / 100,
                    totalBaseRevenue: Math.round(totalBaseRevenue * 100) / 100,
                    revenueImpact: Math.round(revenueImpact * 100) / 100,
                    averageYieldScore: Math.round(averageYieldScore),
                    optimizationRate: 0 // Calculate vs non-yield bookings
                },
                performance: {
                    byStrategy: strategyPerformance,
                    byDemandLevel: demandLevelPerformance
                },
                trends: this.analyzeYieldTrends(yieldBookings)
            };

        } catch (error) {
            logger.error('Error analyzing yield performance:', error);
            throw error;
        }
    }

    /**
     * Analyze price optimization effectiveness
     */
    async analyzePriceOptimization(hotelId, startDate, endDate) {
        try {
            // Get bookings with price adjustments
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const bookingsWithAdjustments = await Booking.find({
                ...query,
                'yieldManagement.priceAdjustment': { $exists: true }
            });

            if (bookingsWithAdjustments.length === 0) {
                return { message: 'No price optimizations found' };
            }

            // Analyze optimization impact
            const optimizations = bookingsWithAdjustments.map(booking => {
                const adjustment = booking.yieldManagement.priceAdjustment;
                return {
                    bookingId: booking._id,
                    originalPrice: adjustment.originalPrice || booking.totalPrice,
                    optimizedPrice: adjustment.newPrice || booking.totalPrice,
                    adjustment: adjustment.adjustment || 0,
                    adjustmentPercentage: adjustment.adjustmentPercentage || 0,
                    reason: adjustment.reason,
                    appliedAt: adjustment.appliedAt
                };
            });

            // Calculate aggregated metrics
            const totalOptimizations = optimizations.length;
            const totalRevenueImpact = optimizations.reduce((sum, opt) => sum + opt.adjustment, 0);
            const averageAdjustment = totalOptimizations > 0 ? totalRevenueImpact / totalOptimizations : 0;
            
            const positiveOptimizations = optimizations.filter(opt => opt.adjustment > 0);
            const negativeOptimizations = optimizations.filter(opt => opt.adjustment < 0);

            return {
                summary: {
                    totalOptimizations,
                    totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
                    averageAdjustment: Math.round(averageAdjustment * 100) / 100,
                    positiveOptimizations: positiveOptimizations.length,
                    negativeOptimizations: negativeOptimizations.length
                },
                distribution: {
                    increases: positiveOptimizations.length,
                    decreases: negativeOptimizations.length,
                    neutral: totalOptimizations - positiveOptimizations.length - negativeOptimizations.length
                },
                impact: {
                    revenueGained: positiveOptimizations.reduce((sum, opt) => sum + opt.adjustment, 0),
                    revenueLost: Math.abs(negativeOptimizations.reduce((sum, opt) => sum + opt.adjustment, 0))
                },
                effectiveness: this.calculateOptimizationEffectiveness(optimizations)
            };

        } catch (error) {
            logger.error('Error analyzing price optimization:', error);
            throw error;
        }
    }

    /**
     * ================================
     * DEMAND ANALYTICS METHODS
     * ================================
     */

    /**
     * Analyze demand patterns
     */
    async analyzeDemandPatterns(hotelId, startDate, endDate) {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const bookings = await Booking.find(query);

            // Analyze booking patterns by day of week
            const dayOfWeekPatterns = this.analyzeDayOfWeekPatterns(bookings);

            // Analyze booking patterns by time of day
            const timeOfDayPatterns = this.analyzeTimeOfDayPatterns(bookings);

            // Analyze lead time patterns
            const leadTimePatterns = this.analyzeLeadTimePatterns(bookings);

            // Analyze seasonal patterns
            const seasonalPatterns = await this.analyzeSeasonalPatterns(hotelId, bookings);

            return {
                dayOfWeek: dayOfWeekPatterns,
                timeOfDay: timeOfDayPatterns,
                leadTime: leadTimePatterns,
                seasonal: seasonalPatterns,
                insights: this.generateDemandPatternInsights({
                    dayOfWeek: dayOfWeekPatterns,
                    leadTime: leadTimePatterns,
                    seasonal: seasonalPatterns
                })
            };

        } catch (error) {
            logger.error('Error analyzing demand patterns:', error);
            throw error;
        }
    }

    /**
     * Analyze booking trends
     */
    async analyzeBookingTrends(hotelId, startDate, endDate, granularity = 'daily') {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const bookings = await Booking.find(query).sort({ createdAt: 1 });

            // Group bookings by time period
            const timeSeriesData = this.groupBookingsByPeriod(bookings, granularity);

            // Calculate trend metrics
            const trendDirection = this.calculateTrendDirection(timeSeriesData);
            const trendStrength = this.calculateTrendStrength(timeSeriesData);
            const momentum = this.calculateTrendMomentum(timeSeriesData);

            // Identify patterns
            const cyclicalPatterns = this.identifyCyclicalPatterns(timeSeriesData);
            const anomalies = this.detectAnomalies(timeSeriesData);

            return {
                timeSeries: timeSeriesData,
                direction: trendDirection,
                strength: trendStrength,
                momentum,
                patterns: cyclicalPatterns,
                anomalies,
                forecast: this.generateTrendForecast(timeSeriesData, 7)
            };

        } catch (error) {
            logger.error('Error analyzing booking trends:', error);
            throw error;
        }
    }

    /**
     * Generate demand forecast
     */
    async generateDemandForecast(hotelId, days = 30) {
        try {
            // Use demand analyzer service if available
            if (demandAnalyzer && demandAnalyzer.generateDemandForecast) {
                return await demandAnalyzer.generateDemandForecast(hotelId, new Date(), 
                    moment().add(days, 'days').toDate());
            }

            // Fallback to simple demand forecasting
            const historicalData = await this.getHistoricalDemandData(hotelId, 90);
            return this.simpleDemandForecast(historicalData, days);

        } catch (error) {
            logger.error('Error generating demand forecast:', error);
            return { error: 'Demand forecast generation failed', message: error.message };
        }
    }

    /**
     * ================================
     * OPERATIONAL ANALYTICS METHODS
     * ================================
     */

    /**
     * Analyze check-in/check-out metrics
     */
    async analyzeCheckInOutMetrics(hotelId, startDate, endDate) {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            
            const [checkedInBookings, checkedOutBookings] = await Promise.all([
                Booking.find({ ...query, status: BOOKING_STATUS.CHECKED_IN }),
                Booking.find({ ...query, status: BOOKING_STATUS.COMPLETED })
            ]);

            // Calculate check-in metrics
            const checkInMetrics = this.calculateCheckInMetrics(checkedInBookings);

            // Calculate check-out metrics
            const checkOutMetrics = this.calculateCheckOutMetrics(checkedOutBookings);

            // Calculate average processing times
            const processingTimes = this.calculateProcessingTimes([...checkedInBookings, ...checkedOutBookings]);

            return {
                checkIn: checkInMetrics,
                checkOut: checkOutMetrics,
                processing: processingTimes,
                efficiency: this.calculateCheckInOutEfficiency(checkInMetrics, checkOutMetrics)
            };

        } catch (error) {
            logger.error('Error analyzing check-in/out metrics:', error);
            throw error;
        }
    }

    /**
     * Analyze service metrics
     */
    async analyzeServiceMetrics(hotelId, startDate, endDate) {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const bookings = await Booking.find(query);

            // Analyze extras/services usage
            const extrasAnalysis = this.analyzeExtrasUsage(bookings);

            // Analyze service quality indicators
            const qualityMetrics = this.analyzeServiceQuality(bookings);

            // Analyze service revenue
            const serviceRevenue = this.analyzeServiceRevenue(bookings);

            return {
                extras: extrasAnalysis,
                quality: qualityMetrics,
                revenue: serviceRevenue,
                insights: this.generateServiceInsights(extrasAnalysis, qualityMetrics)
            };

        } catch (error) {
            logger.error('Error analyzing service metrics:', error);
            throw error;
        }
    }

    /**
     * ================================
     * DASHBOARD AND REAL-TIME METHODS
     * ================================
     */

    /**
     * Calculate dashboard KPIs
     */
    async calculateDashboardKPIs(hotelId, startDate, endDate) {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            
            const [
                totalBookings,
                totalRevenue,
                averageOccupancy,
                averageADR,
                conversionRate,
                cancellationRate
            ] = await Promise.all([
                Booking.countDocuments(query),
                this.calculateTotalRevenue(query),
                this.calculateAverageOccupancy(query),
                this.calculateAverageADR(query),
                this.calculateConversionRate(query),
                this.calculateCancellationRate(query)
            ]);

            // Calculate RevPAR
            const revPAR = averageOccupancy * averageADR / 100;

            // Calculate growth rates (compare with previous period)
            const previousPeriodGrowth = await this.calculatePeriodGrowth(query);

            return {
                summary: {
                    totalBookings,
                    totalRevenue: Math.round(totalRevenue * 100) / 100,
                    averageOccupancy: Math.round(averageOccupancy * 100) / 100,
                    averageADR: Math.round(averageADR * 100) / 100,
                    revPAR: Math.round(revPAR * 100) / 100,
                    conversionRate: Math.round(conversionRate * 100) / 100,
                    cancellationRate: Math.round(cancellationRate * 100) / 100
                },
                growth: previousPeriodGrowth,
                performance: this.rateKPIPerformance({
                    occupancy: averageOccupancy,
                    adr: averageADR,
                    revPAR,
                    conversion: conversionRate
                })
            };

        } catch (error) {
            logger.error('Error calculating dashboard KPIs:', error);
            throw error;
        }
    }

    /**
     * Get real-time metrics
     */
    async getRealTimeMetrics(hotelId) {
        try {
            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

            const [
                todayBookings,
                todayRevenue,
                currentOccupancy,
                pendingBookings,
                todayCheckIns,
                todayCheckOuts
            ] = await Promise.all([
                Booking.countDocuments({
                    ...(hotelId && { hotel: hotelId }),
                    createdAt: { $gte: today, $lt: tomorrow }
                }),
                this.calculateTotalRevenue({
                    ...(hotelId && { hotel: hotelId }),
                    createdAt: { $gte: today, $lt: tomorrow }
                }),
                this.getCurrentOccupancy(hotelId),
                Booking.countDocuments({
                    ...(hotelId && { hotel: hotelId }),
                    status: BOOKING_STATUS.PENDING
                }),
                Booking.countDocuments({
                    ...(hotelId && { hotel: hotelId }),
                    checkInDate: { $gte: today, $lt: tomorrow },
                    status: BOOKING_STATUS.CONFIRMED
                }),
                Booking.countDocuments({
                    ...(hotelId && { hotel: hotelId }),
                    checkOutDate: { $gte: today, $lt: tomorrow },
                    status: BOOKING_STATUS.CHECKED_IN
                })
            ]);

            return {
                timestamp: now,
                today: {
                    bookings: todayBookings,
                    revenue: Math.round(todayRevenue * 100) / 100,
                    checkIns: todayCheckIns,
                    checkOuts: todayCheckOuts
                },
                current: {
                    occupancy: Math.round(currentOccupancy * 100) / 100,
                    pendingBookings
                },
                alerts: await this.getRealtimeAlerts(hotelId)
            };

        } catch (error) {
            logger.error('Error getting real-time metrics:', error);
            throw error;
        }
    }

    /**
     * ================================
     * UTILITY AND HELPER METHODS
     * ================================
     */

    /**
     * Parse period string to dates
     */
    parsePeriod(period) {
        const now = moment();
        let startDate, endDate = now.toDate();

        const periodMatch = period.match(/^(\d+)([dwmy])$/);
        if (periodMatch) {
            const [, amount, unit] = periodMatch;
            const unitMap = { d: 'days', w: 'weeks', m: 'months', y: 'years' };
            startDate = now.subtract(parseInt(amount), unitMap[unit]).toDate();
        } else {
            // Default to 30 days
            startDate = now.subtract(30, 'days').toDate();
        }

        return { startDate, endDate };
    }

    /**
     * Build analytics query with filters
     */
    buildAnalyticsQuery({ hotelId, roomType, startDate, endDate }) {
        const query = {};

        if (hotelId) {
            query.hotel = mongoose.Types.ObjectId(hotelId);
        }

        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = startDate;
            if (endDate) query.createdAt.$lte = endDate;
        }

        if (roomType) {
            query['rooms.type'] = roomType;
        }

        return query;
    }

    /**
     * Cache management
     */
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

    /**
     * Calculate overall performance score
     */
    calculateOverallPerformanceScore(metrics) {
        const { revenue, occupancy, adr, revPAR } = metrics;

        // Normalize metrics to 0-100 scale
        const occupancyScore = Math.min(occupancy, 100);
        const adrScore = Math.min((adr / 200) * 100, 100); // Assuming 200 as good ADR
        const revPARScore = Math.min((revPAR / 150) * 100, 100); // Assuming 150 as good RevPAR
        const revenueScore = Math.min((revenue / 10000) * 100, 100); // Adjust based on scale

        // Weighted combination
        return Math.round(
            occupancyScore * this.analyticsWeights.occupancy +
            adrScore * 0.3 +
            revPARScore * 0.3 +
            revenueScore * this.analyticsWeights.revenue
        );
    }

    /**
     * Rate performance metrics against benchmarks
     */
    ratePerformanceMetrics(metrics) {
        const ratings = {};

        // Rate occupancy
        const { occupancy } = metrics;
        if (occupancy >= this.benchmarks.occupancyRate.excellent) ratings.occupancy = 'EXCELLENT';
        else if (occupancy >= this.benchmarks.occupancyRate.good) ratings.occupancy = 'GOOD';
        else if (occupancy >= this.benchmarks.occupancyRate.average) ratings.occupancy = 'AVERAGE';
        else ratings.occupancy = 'POOR';

        // Rate RevPAR
        const { revPAR } = metrics;
        if (revPAR >= this.benchmarks.revPAR.excellent) ratings.revPAR = 'EXCELLENT';
        else if (revPAR >= this.benchmarks.revPAR.good) ratings.revPAR = 'GOOD';
        else if (revPAR >= this.benchmarks.revPAR.average) ratings.revPAR = 'AVERAGE';
        else ratings.revPAR = 'POOR';

        // Rate ADR
        const { adr } = metrics;
        if (adr >= this.benchmarks.adr.excellent) ratings.adr = 'EXCELLENT';
        else if (adr >= this.benchmarks.adr.good) ratings.adr = 'GOOD';
        else if (adr >= this.benchmarks.adr.average) ratings.adr = 'AVERAGE';
        else ratings.adr = 'POOR';

        return ratings;
    }

    /**
     * Compare metrics to benchmarks
     */
    compareToBenchmarks(metrics) {
        const comparison = {};

        for (const [metric, value] of Object.entries(metrics)) {
            if (this.benchmarks[metric]) {
                const benchmark = this.benchmarks[metric];
                comparison[metric] = {
                    value,
                    benchmark: benchmark.good,
                    performance: value >= benchmark.good ? 'ABOVE' : 'BELOW',
                    percentageOfBenchmark: Math.round((value / benchmark.good) * 100)
                };
            }
        }

        return comparison;
    }

    /**
     * Generate revenue insights
     */
    generateRevenueInsights(data) {
        const insights = [];
        const { revenueMetrics, occupancyData, pricingAnalysis, performanceScore } = data;

        // Revenue performance insight
        if (performanceScore >= 80) {
            insights.push({
                type: 'SUCCESS',
                category: 'REVENUE',
                message: `Excellent revenue performance with score of ${performanceScore}`,
                impact: 'HIGH',
                trend: 'POSITIVE'
            });
        } else if (performanceScore < 60) {
            insights.push({
                type: 'WARNING',
                category: 'REVENUE',
                message: `Revenue performance below expectations (${performanceScore})`,
                impact: 'HIGH',
                trend: 'NEGATIVE'
            });
        }

        // Occupancy insights
        if (occupancyData.summary.averageOccupancy > 85) {
            insights.push({
                type: 'OPPORTUNITY',
                category: 'PRICING',
                message: 'High occupancy rates indicate potential for price increases',
                impact: 'MEDIUM',
                trend: 'POSITIVE'
            });
        } else if (occupancyData.summary.averageOccupancy < 60) {
            insights.push({
                type: 'ALERT',
                category: 'OCCUPANCY',
                message: 'Low occupancy rates require immediate attention',
                impact: 'HIGH',
                trend: 'NEGATIVE'
            });
        }

        // Revenue growth insights
        if (revenueMetrics.growth && revenueMetrics.growth.percentage > 10) {
            insights.push({
                type: 'SUCCESS',
                category: 'GROWTH',
                message: `Strong revenue growth of ${revenueMetrics.growth.percentage.toFixed(1)}%`,
                impact: 'HIGH',
                trend: 'POSITIVE'
            });
        }

        return insights;
    }

    /**
     * Generate revenue recommendations
     */
    generateRevenueRecommendations(insights) {
        const recommendations = [];

        insights.forEach(insight => {
            switch (insight.category) {
                case 'OCCUPANCY':
                    if (insight.type === 'ALERT') {
                        recommendations.push({
                            type: 'MARKETING',
                            priority: 'HIGH',
                            action: 'Implement promotional pricing and marketing campaigns',
                            expectedImpact: 'Increase occupancy by 15-25%',
                            timeframe: '2-4 weeks'
                        });
                    }
                    break;
                case 'PRICING':
                    if (insight.type === 'OPPORTUNITY') {
                        recommendations.push({
                            type: 'PRICING',
                            priority: 'MEDIUM',
                            action: 'Consider strategic price increases during high-demand periods',
                            expectedImpact: 'Increase revenue by 10-15%',
                            timeframe: '1-2 weeks'
                        });
                    }
                    break;
                case 'REVENUE':
                    if (insight.type === 'WARNING') {
                        recommendations.push({
                            type: 'STRATEGY',
                            priority: 'HIGH',
                            action: 'Review and optimize overall revenue strategy',
                            expectedImpact: 'Improve performance by 20-30%',
                            timeframe: '4-8 weeks'
                        });
                    }
                    break;
            }
        });

        return recommendations;
    }

    /**
     * ================================
     * DATA CONVERSION AND EXPORT METHODS
     * ================================
     */

    /**
     * Convert data to CSV format
     */
    convertToCSV(data, includeHeaders = true) {
        try {
            if (!Array.isArray(data) || data.length === 0) {
                return 'No data available';
            }

            const headers = Object.keys(data[0]);
            let csv = '';

            if (includeHeaders) {
                csv += headers.join(',') + '\n';
            }

            data.forEach(row => {
                const values = headers.map(header => {
                    let value = row[header];
                    // Handle special characters and commas
                    if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                        value = `"${value.replace(/"/g, '""')}"`;
                    }
                    return value || '';
                });
                csv += values.join(',') + '\n';
            });

            return csv;

        } catch (error) {
            logger.error('Error converting to CSV:', error);
            throw error;
        }
    }

    /**
     * Convert data to Excel format
     */
    async convertToExcel(data) {
        try {
            // This would use a library like ExcelJS
            // For now, return a placeholder
            return Buffer.from('Excel export not implemented yet');
        } catch (error) {
            logger.error('Error converting to Excel:', error);
            throw error;
        }
    }

    /**
     * Export revenue data
     */
    async exportRevenueData(hotelId, startDate, endDate, granularity) {
        try {
            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const bookings = await Booking.find(query)
                .populate('hotel', 'name')
                .populate('customer', 'firstName lastName');

            return bookings.map(booking => ({
                bookingId: booking._id,
                hotelName: booking.hotel?.name || 'Unknown',
                customerName: `${booking.customer?.firstName || ''} ${booking.customer?.lastName || ''}`,
                checkInDate: booking.checkInDate,
                checkOutDate: booking.checkOutDate,
                nights: moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days'),
                roomCount: booking.rooms.length,
                totalPrice: booking.totalPrice,
                currency: booking.currency || 'EUR',
                source: booking.source,
                status: booking.status,
                createdAt: booking.createdAt
            }));

        } catch (error) {
            logger.error('Error exporting revenue data:', error);
            throw error;
        }
    }

    /**
     * Export occupancy data
     */
    async exportOccupancyData(hotelId, startDate, endDate, granularity) {
        try {
            const occupancyMetrics = await this.calculateOccupancyMetrics(
                this.buildAnalyticsQuery({ hotelId, startDate, endDate }),
                granularity
            );

            return Object.values(occupancyMetrics.daily).map(day => ({
                date: day.date,
                occupiedRooms: day.occupiedRooms,
                totalRooms: day.totalRooms,
                occupancyRate: day.occupancyRate,
                dayOfWeek: moment(day.date).format('dddd')
            }));

        } catch (error) {
            logger.error('Error exporting occupancy data:', error);
            throw error;
        }
    }

    /**
     * Export yield data
     */
    async exportYieldData(hotelId, startDate, endDate, granularity) {
        try {
            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                throw new Error('Yield management is not enabled');
            }

            const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
            const yieldBookings = await Booking.find({
                ...query,
                'yieldManagement.enabled': true
            }).populate('hotel', 'name');

            return yieldBookings.map(booking => ({
                bookingId: booking._id,
                hotelName: booking.hotel?.name || 'Unknown',
                checkInDate: booking.checkInDate,
                basePrice: booking.yieldManagement?.pricingDetails?.[0]?.basePrice || 0,
                dynamicPrice: booking.yieldManagement?.pricingDetails?.[0]?.dynamicPrice || booking.totalPrice,
                yieldScore: booking.yieldManagement?.performanceScore || 0,
                strategy: booking.yieldManagement?.strategy || 'UNKNOWN',
                demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
                priceAdjustment: booking.yieldManagement?.priceAdjustment?.adjustment || 0,
                createdAt: booking.createdAt
            }));

        } catch (error) {
            logger.error('Error exporting yield data:', error);
            throw error;
        }
    }

    /**
     * ================================
     * REPORT GENERATION METHODS
     * ================================
     */

    /**
     * Generate comprehensive report sections
     */
    async generateRevenueSection(hotelId, startDate, endDate) {
        const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
        const revenueMetrics = await this.calculateRevenueMetrics(query);
        
        return {
            title: 'Revenue Analysis',
            summary: revenueMetrics.summary,
            insights: this.generateRevenueInsights({ revenueMetrics }),
            charts: {
                timeSeries: revenueMetrics.timeSeries,
                breakdown: revenueMetrics.breakdown
            }
        };
    }

    async generateOccupancySection(hotelId, startDate, endDate) {
        const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });
        const occupancyMetrics = await this.calculateOccupancyMetrics(query);
        
        return {
            title: 'Occupancy Analysis',
            summary: occupancyMetrics.summary,
            trends: occupancyMetrics.trends,
            charts: {
                timeSeries: occupancyMetrics.timeSeries,
                patterns: occupancyMetrics.breakdown.weeklyPatterns
            }
        };
    }

    async generateDemandSection(hotelId, startDate, endDate) {
        const demandAnalysis = await this.analyzeDemandPatterns(hotelId, startDate, endDate);
        
        return {
            title: 'Demand Analysis',
            patterns: demandAnalysis,
            forecast: await this.generateDemandForecast(hotelId, 30)
        };
    }

    async generateYieldSection(hotelId, startDate, endDate) {
        const yieldPerformance = await this.analyzeYieldPerformance(hotelId, startDate, endDate);
        
        return {
            title: 'Yield Management Performance',
            performance: yieldPerformance,
            optimization: await this.analyzePriceOptimization(hotelId, startDate, endDate)
        };
    }

    async generateOperationalSection(hotelId, startDate, endDate) {
        const [checkInOutMetrics, serviceMetrics] = await Promise.all([
            this.analyzeCheckInOutMetrics(hotelId, startDate, endDate),
            this.analyzeServiceMetrics(hotelId, startDate, endDate)
        ]);
        
        return {
            title: 'Operational Performance',
            checkInOut: checkInOutMetrics,
            service: serviceMetrics
        };
    }

    /**
     * Generate executive summary
     */
    generateExecutiveSummary(sections) {
        const summary = {
            title: 'Executive Summary',
            keyMetrics: {},
            highlights: [],
            concerns: [],
            recommendations: []
        };

        // Extract key metrics from sections
        if (sections.revenue) {
            summary.keyMetrics.totalRevenue = sections.revenue.summary.totalRevenue;
            summary.keyMetrics.revPAR = sections.revenue.summary.revPAR;
        }

        if (sections.occupancy) {
            summary.keyMetrics.occupancy = sections.occupancy.summary.averageOccupancy;
        }

        // Generate highlights and concerns based on performance
        Object.entries(summary.keyMetrics).forEach(([metric, value]) => {
            if (this.isPositiveMetric(metric, value)) {
                summary.highlights.push(`Strong ${metric}: ${value}`);
            } else if (this.isNegativeMetric(metric, value)) {
                summary.concerns.push(`Low ${metric}: ${value}`);
            }
        });

        return summary;
    }

    /**
     * ================================
     * UTILITY HELPER METHODS
     * ================================
     */

    /**
     * Group revenue data by time period
     */
    groupRevenueByPeriod(bookings, granularity) {
        const grouped = {};
        
        bookings.forEach(booking => {
            let key;
            const date = moment(booking.createdAt);
            
            switch (granularity) {
                case 'hourly':
                    key = date.format('YYYY-MM-DD HH');
                    break;
                case 'daily':
                    key = date.format('YYYY-MM-DD');
                    break;
                case 'weekly':
                    key = date.format('YYYY-WW');
                    break;
                case 'monthly':
                    key = date.format('YYYY-MM');
                    break;
                default:
                    key = date.format('YYYY-MM-DD');
            }
            
            if (!grouped[key]) {
                grouped[key] = {
                    period: key,
                    revenue: 0,
                    bookings: 0,
                    roomNights: 0
                };
            }
            
            grouped[key].revenue += booking.convertedAmount || 0;
            grouped[key].bookings += 1;
            grouped[key].roomNights += booking.nights * booking.rooms.length;
        });
        
        return Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period));
    }

    /**
     * Calculate revenue by room type
     */
    calculateRevenueByRoomType(bookings) {
        const revenueByType = {};
        
        bookings.forEach(booking => {
            booking.rooms.forEach(room => {
                const type = room.type || 'Unknown';
                if (!revenueByType[type]) {
                    revenueByType[type] = {
                        type,
                        revenue: 0,
                        bookings: 0,
                        percentage: 0
                    };
                }
                
                revenueByType[type].revenue += (booking.convertedAmount || 0) / booking.rooms.length;
                revenueByType[type].bookings += 1;
            });
        });
        
        const totalRevenue = Object.values(revenueByType).reduce((sum, type) => sum + type.revenue, 0);
        
        return Object.values(revenueByType).map(type => ({
            ...type,
            revenue: Math.round(type.revenue * 100) / 100,
            percentage: totalRevenue > 0 ? Math.round((type.revenue / totalRevenue) * 10000) / 100 : 0
        }));
    }

    /**
     * Calculate revenue by source
     */
    calculateRevenueBySource(bookings) {
        const revenueBySource = {};
        
        bookings.forEach(booking => {
            const source = booking.source || 'DIRECT';
            if (!revenueBySource[source]) {
                revenueBySource[source] = {
                    source,
                    revenue: 0,
                    bookings: 0,
                    percentage: 0
                };
            }
            
            revenueBySource[source].revenue += booking.convertedAmount || 0;
            revenueBySource[source].bookings += 1;
        });
        
        const totalRevenue = Object.values(revenueBySource).reduce((sum, source) => sum + source.revenue, 0);
        
        return Object.values(revenueBySource).map(source => ({
            ...source,
            revenue: Math.round(source.revenue * 100) / 100,
            percentage: totalRevenue > 0 ? Math.round((source.revenue / totalRevenue) * 10000) / 100 : 0
        }));
    }

    /**
     * Generate unique report ID
     */
    generateReportId() {
        return `RPT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    }

    /**
     * Get empty revenue metrics structure
     */
    getEmptyRevenueMetrics() {
        return {
            summary: {
                totalRevenue: 0,
                totalBookings: 0,
                totalRoomNights: 0,
                averageBookingValue: 0,
                adr: 0,
                revPAR: 0,
                currency: 'EUR'
            },
            timeSeries: [],
            breakdown: {
                byRoomType: [],
                bySource: [],
                byClientType: []
            },
            growth: null,
            variance: 0
        };
    }

    /**
     * Calculate available room nights for RevPAR
     */
    async calculateAvailableRoomNights(query) {
        try {
            // Get hotel room counts
            const hotels = await Hotel.find(query.hotel ? { _id: query.hotel } : {})
                .populate('rooms');
            
            const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);
            
            // Calculate days in period
            const startDate = moment(query.createdAt?.$gte || moment().subtract(30, 'days'));
            const endDate = moment(query.createdAt?.$lte || moment());
            const days = endDate.diff(startDate, 'days') + 1;
            
            return totalRooms * days;
        } catch (error) {
            logger.error('Error calculating available room nights:', error);
            return 1; // Avoid division by zero
        }
    }

    /**
     * Calculate variance
     */
    calculateVariance(values) {
        if (values.length === 0) return 0;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
        return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
    }

    /**
     * Check if metric value is positive
     */
    isPositiveMetric(metric, value) {
        const thresholds = {
            totalRevenue: 5000,
            occupancy: 75,
            revPAR: 100,
            adr: 150
        };
        
        return value >= (thresholds[metric] || 0);
    }

    /**
     * Check if metric value is negative
     */
    isNegativeMetric(metric, value) {
        const thresholds = {
            totalRevenue: 1000,
            occupancy: 50,
            revPAR: 50,
            adr: 100
        };
        
        return value < (thresholds[metric] || 0);
    }

    /**
     * Get analytics methodology description
     */
    getReportMethodology() {
        return {
            dataCollection: 'Historical booking and revenue data analysis',
            calculations: 'Standard hotel industry metrics (RevPAR, ADR, Occupancy)',
            benchmarking: 'Industry standard benchmarks and historical performance',
            forecasting: 'Time series analysis and demand pattern recognition',
            yieldManagement: 'Dynamic pricing optimization and revenue management'
        };
    }

    /**
     * Get analytics glossary
     */
    getAnalyticsGlossary() {
        return {
            'RevPAR': 'Revenue Per Available Room - total room revenue divided by available room nights',
            'ADR': 'Average Daily Rate - total room revenue divided by rooms sold',
            'Occupancy Rate': 'Percentage of available rooms that are occupied',
            'Yield Management': 'Revenue optimization through dynamic pricing strategies',
            'Demand Analysis': 'Study of booking patterns and market demand trends',
            'Price Elasticity': 'Measure of demand sensitivity to price changes'
        };
    }
}

module.exports = new AnalyticsController();