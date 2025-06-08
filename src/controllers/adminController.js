const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const PricingRule = require('../models/PricingRule');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const currencyService = require('../services/currencyService');

// YIELD MANAGEMENT SERVICES INTEGRATION
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const revenueAnalytics = require('../services/revenueAnalytics');
const schedulerService = require('../services/scheduler');

const { logger } = require('../utils/logger');
const { validationResult } = require('express-validator');
const moment = require('moment');

// Import constants for yield management
const { 
    YIELD_LIMITS,
    DEMAND_LEVELS,
    PRICING_RULE_TYPES,
    PRICING_ACTIONS,
    JOB_TYPES,
    PERFORMANCE_METRICS,
    ANALYSIS_PERIODS
} = require('../utils/constants');

class AdminController {
    /**
     * ================================
     * ENHANCED DASHBOARD WITH YIELD MANAGEMENT
     * ================================
     */

    /**
     * Get comprehensive dashboard data with yield management metrics
     */
    async getDashboardData(req, res) {
        try {
            const { timeframe = '24h', currency = 'EUR', includeYield = true } = req.query;
            
            // Calculate date range
            const now = new Date();
            let startDate;
            
            switch (timeframe) {
                case '24h':
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                    break;
                case '7d':
                    startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    break;
                case '30d':
                    startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    break;
                default:
                    startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            }

            // Get standard dashboard data
            const [
                totalBookings,
                pendingBookings,
                confirmedBookings,
                totalRevenue,
                occupancyData,
                recentBookings,
                systemAlerts,
                realtimeMetrics
            ] = await Promise.all([
                this.getTotalBookings(startDate),
                this.getPendingBookings(),
                this.getConfirmedBookings(startDate),
                this.getTotalRevenue(startDate, currency),
                this.getOccupancyData(),
                this.getRecentBookings(5),
                this.getSystemAlerts(),
                this.getRealtimeMetrics()
            ]);

            const dashboardData = {
                timeframe,
                lastUpdated: now,
                statistics: {
                    totalBookings,
                    pendingBookings: pendingBookings.count,
                    confirmedBookings,
                    totalRevenue,
                    occupancyRate: occupancyData.occupancyRate,
                    availableRooms: occupancyData.availableRooms,
                    totalRooms: occupancyData.totalRooms
                },
                pendingBookingsList: pendingBookings.bookings,
                recentBookings,
                systemAlerts,
                realtimeMetrics,
                currency
            };

            // ================================
            // ADD YIELD MANAGEMENT DATA
            // ================================
            if (includeYield === 'true' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                try {
                    const [
                        yieldPerformance,
                        revenueOptimization,
                        demandAnalysis,
                        pricingEffectiveness,
                        yieldAlerts
                    ] = await Promise.all([
                        this.getYieldPerformanceMetrics(startDate, currency),
                        this.getRevenueOptimizationData(startDate),
                        this.getCurrentDemandAnalysis(),
                        this.getPricingEffectivenessData(startDate),
                        this.getYieldManagementAlerts()
                    ]);

                    dashboardData.yieldManagement = {
                        enabled: true,
                        performance: yieldPerformance,
                        revenueOptimization,
                        demandAnalysis,
                        pricingEffectiveness,
                        alerts: yieldAlerts,
                        quickActions: {
                            triggerDemandAnalysis: '/api/admin/yield/trigger-demand-analysis',
                            optimizePricing: '/api/admin/yield/optimize-pricing',
                            generateForecast: '/api/admin/yield/generate-forecast'
                        }
                    };

                    // Add yield-specific system alerts
                    dashboardData.systemAlerts = [
                        ...dashboardData.systemAlerts,
                        ...yieldAlerts
                    ];

                } catch (yieldError) {
                    logger.error('Error loading yield management data:', yieldError);
                    dashboardData.yieldManagement = {
                        enabled: true,
                        error: 'Failed to load yield management data',
                        message: yieldError.message
                    };
                }
            } else {
                dashboardData.yieldManagement = {
                    enabled: false,
                    message: 'Yield management is disabled'
                };
            }

            // Send initial data
            res.json({
                success: true,
                data: dashboardData
            });

            // Setup live streaming for this admin
            this.setupDashboardStreaming(req.user.id, { timeframe, currency, includeYield });

        } catch (error) {
            logger.error('Error getting dashboard data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to load dashboard data',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * YIELD MANAGEMENT DASHBOARD METRICS
     * ================================
     */

    /**
     * Get yield performance metrics for dashboard
     */
    async getYieldPerformanceMetrics(startDate, currency = 'EUR') {
        try {
            // Get yield-optimized bookings
            const yieldBookings = await Booking.find({
                createdAt: { $gte: startDate },
                'yieldManagement.enabled': true
            }).populate('hotel', 'name');

            if (yieldBookings.length === 0) {
                return {
                    totalOptimizedBookings: 0,
                    averageYieldScore: 0,
                    revenueImpact: 0,
                    optimizationRate: 0,
                    performanceByHotel: []
                };
            }

            // Calculate metrics
            const totalOptimizedBookings = yieldBookings.length;
            const totalRevenue = yieldBookings.reduce((sum, booking) => sum + booking.totalPrice, 0);
            const totalBaseRevenue = yieldBookings.reduce((sum, booking) => {
                const basePrice = booking.yieldManagement?.pricingDetails?.[0]?.basePrice || booking.totalPrice;
                return sum + basePrice;
            }, 0);

            const revenueImpact = totalBaseRevenue > 0 ? 
                ((totalRevenue - totalBaseRevenue) / totalBaseRevenue) * 100 : 0;

            const averageYieldScore = yieldBookings.reduce((sum, booking) => {
                return sum + (booking.yieldManagement?.performanceScore || 50);
            }, 0) / totalOptimizedBookings;

            // Performance by hotel
            const hotelPerformance = {};
            yieldBookings.forEach(booking => {
                const hotelId = booking.hotel._id.toString();
                if (!hotelPerformance[hotelId]) {
                    hotelPerformance[hotelId] = {
                        hotelName: booking.hotel.name,
                        bookings: 0,
                        revenue: 0,
                        yieldScore: 0
                    };
                }
                hotelPerformance[hotelId].bookings++;
                hotelPerformance[hotelId].revenue += booking.totalPrice;
                hotelPerformance[hotelId].yieldScore += (booking.yieldManagement?.performanceScore || 50);
            });

            const performanceByHotel = Object.values(hotelPerformance).map(hotel => ({
                ...hotel,
                averageYieldScore: hotel.yieldScore / hotel.bookings,
                revenuePerBooking: hotel.revenue / hotel.bookings
            }));

            return {
                totalOptimizedBookings,
                averageYieldScore: Math.round(averageYieldScore),
                revenueImpact: Math.round(revenueImpact * 100) / 100,
                optimizationRate: Math.round((totalOptimizedBookings / await this.getTotalBookings(startDate)) * 100),
                performanceByHotel,
                totalOptimizedRevenue: Math.round(totalRevenue * 100) / 100,
                currency
            };

        } catch (error) {
            logger.error('Error calculating yield performance metrics:', error);
            throw error;
        }
    }

    /**
     * Get revenue optimization data
     */
    async getRevenueOptimizationData(startDate) {
        try {
            // Get optimization opportunities
            const optimizationData = await revenueAnalytics.getOptimizationOpportunities();
            
            // Get recent price changes
            const recentPriceChanges = await this.getRecentPriceChanges(startDate);
            
            // Calculate optimization impact
            const optimizationImpact = await this.calculateOptimizationImpact(startDate);

            return {
                opportunities: optimizationData.opportunities || [],
                recentPriceChanges,
                impact: optimizationImpact,
                recommendations: optimizationData.recommendations || [],
                potentialRevenue: optimizationData.potentialRevenue || 0
            };

        } catch (error) {
            logger.error('Error getting revenue optimization data:', error);
            return {
                opportunities: [],
                recentPriceChanges: [],
                impact: { totalImpact: 0, positive: 0, negative: 0 },
                recommendations: [],
                error: error.message
            };
        }
    }

    /**
     * Get current demand analysis
     */
    async getCurrentDemandAnalysis() {
        try {
            // Get demand levels across all hotels
            const hotels = await Hotel.find({ isActive: true }).select('_id name');
            const demandByHotel = [];

            for (const hotel of hotels) {
                try {
                    const demand = await demandAnalyzer.getCurrentDemandLevel(hotel._id);
                    const forecast = await demandAnalyzer.getDemandForecast(hotel._id, 7); // 7 days

                    demandByHotel.push({
                        hotelId: hotel._id,
                        hotelName: hotel.name,
                        currentDemand: demand.level,
                        demandScore: demand.score,
                        forecast: forecast.trend,
                        confidence: demand.confidence
                    });
                } catch (hotelError) {
                    logger.warn(`Error getting demand for hotel ${hotel._id}:`, hotelError.message);
                }
            }

            // Calculate overall demand metrics
            const totalDemandScore = demandByHotel.reduce((sum, hotel) => sum + hotel.demandScore, 0);
            const averageDemandScore = demandByHotel.length > 0 ? totalDemandScore / demandByHotel.length : 0;
            
            const demandDistribution = {};
            demandByHotel.forEach(hotel => {
                demandDistribution[hotel.currentDemand] = (demandDistribution[hotel.currentDemand] || 0) + 1;
            });

            return {
                overallDemand: this.calculateOverallDemandLevel(averageDemandScore),
                averageScore: Math.round(averageDemandScore),
                distribution: demandDistribution,
                hotelDetails: demandByHotel,
                lastUpdated: new Date()
            };

        } catch (error) {
            logger.error('Error getting current demand analysis:', error);
            return {
                overallDemand: 'UNKNOWN',
                averageScore: 0,
                distribution: {},
                hotelDetails: [],
                error: error.message
            };
        }
    }

    /**
     * Get pricing effectiveness data
     */
    async getPricingEffectivenessData(startDate) {
        try {
            const pricingRules = await PricingRule.find({
                isActive: true,
                lastApplied: { $gte: startDate }
            });

            const effectivenessData = {
                totalActiveRules: pricingRules.length,
                rulesApplied: pricingRules.filter(rule => rule.lastApplied).length,
                averageImpact: 0,
                topPerformingRules: [],
                underperformingRules: []
            };

            // Analyze rule performance
            for (const rule of pricingRules) {
                if (rule.performanceMetrics) {
                    const impact = rule.performanceMetrics.revenueImpact || 0;
                    effectivenessData.averageImpact += impact;

                    if (impact > 5) {
                        effectivenessData.topPerformingRules.push({
                            ruleId: rule._id,
                            ruleType: rule.ruleType,
                            description: rule.description,
                            impact: Math.round(impact * 100) / 100
                        });
                    } else if (impact < -2) {
                        effectivenessData.underperformingRules.push({
                            ruleId: rule._id,
                            ruleType: rule.ruleType,
                            description: rule.description,
                            impact: Math.round(impact * 100) / 100
                        });
                    }
                }
            }

            effectivenessData.averageImpact = pricingRules.length > 0 ? 
                effectivenessData.averageImpact / pricingRules.length : 0;

            // Sort by impact
            effectivenessData.topPerformingRules.sort((a, b) => b.impact - a.impact);
            effectivenessData.underperformingRules.sort((a, b) => a.impact - b.impact);

            return effectivenessData;

        } catch (error) {
            logger.error('Error getting pricing effectiveness data:', error);
            return {
                totalActiveRules: 0,
                rulesApplied: 0,
                averageImpact: 0,
                topPerformingRules: [],
                underperformingRules: [],
                error: error.message
            };
        }
    }

    /**
     * Get yield management alerts
     */
    async getYieldManagementAlerts() {
        try {
            const alerts = [];

            // Check for demand surges
            const demandSurges = await this.checkDemandSurges();
            alerts.push(...demandSurges);

            // Check for pricing opportunities
            const pricingOpportunities = await this.checkPricingOpportunities();
            alerts.push(...pricingOpportunities);

            // Check for underperforming rules
            const underperformingRules = await this.checkUnderperformingRules();
            alerts.push(...underperformingRules);

            // Check yield job status
            const jobAlerts = await this.checkYieldJobStatus();
            alerts.push(...jobAlerts);

            return alerts;

        } catch (error) {
            logger.error('Error getting yield management alerts:', error);
            return [{
                type: 'error',
                message: 'Failed to load yield management alerts',
                priority: 'medium',
                timestamp: new Date()
            }];
        }
    }

    /**
     * ================================
     * YIELD MANAGEMENT ADMIN TOOLS
     * ================================
     */

    /**
     * Trigger demand analysis for all hotels or specific hotel
     */
    async triggerDemandAnalysis(req, res) {
        try {
            const { hotelId, priority = 'high' } = req.body;

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            let analysisResults = [];

            if (hotelId) {
                // Trigger for specific hotel
                const result = await yieldManager.triggerDemandAnalysis(hotelId);
                analysisResults.push({
                    hotelId,
                    status: 'completed',
                    result
                });
            } else {
                // Trigger for all active hotels
                const hotels = await Hotel.find({ isActive: true }).select('_id name');
                
                for (const hotel of hotels) {
                    try {
                        const result = await yieldManager.triggerDemandAnalysis(hotel._id);
                        analysisResults.push({
                            hotelId: hotel._id,
                            hotelName: hotel.name,
                            status: 'completed',
                            result
                        });
                    } catch (hotelError) {
                        analysisResults.push({
                            hotelId: hotel._id,
                            hotelName: hotel.name,
                            status: 'failed',
                            error: hotelError.message
                        });
                    }
                }
            }

            // Send real-time notification
            socketService.sendAdminNotification('demand-analysis-completed', {
                triggeredBy: req.user.id,
                results: analysisResults,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Demand analysis triggered successfully',
                data: {
                    analysisResults,
                    triggeredBy: req.user.id,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('Error triggering demand analysis:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to trigger demand analysis',
                error: error.message
            });
        }
    }

    /**
     * Optimize pricing across hotels
     */
    async optimizePricing(req, res) {
        try {
            const { hotelIds, strategy = 'MODERATE', dateRange } = req.body;

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const optimizationResults = [];
            const hotels = hotelIds || await Hotel.find({ isActive: true }).distinct('_id');

            for (const hotelId of hotels) {
                try {
                    const optimization = await yieldManager.updatePricingForHotel(hotelId, {
                        strategy,
                        dateRange,
                        triggeredBy: req.user.id
                    });

                    optimizationResults.push({
                        hotelId,
                        status: 'optimized',
                        optimization
                    });

                } catch (hotelError) {
                    optimizationResults.push({
                        hotelId,
                        status: 'failed',
                        error: hotelError.message
                    });
                }
            }

            // Calculate overall impact
            const successfulOptimizations = optimizationResults.filter(r => r.status === 'optimized');
            const totalImpact = successfulOptimizations.reduce((sum, result) => {
                return sum + (result.optimization?.revenueImpact || 0);
            }, 0);

            // Send real-time notification
            socketService.sendAdminNotification('pricing-optimization-completed', {
                optimizationResults,
                totalImpact,
                strategy,
                triggeredBy: req.user.id,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Pricing optimization completed',
                data: {
                    results: optimizationResults,
                    summary: {
                        totalHotels: hotels.length,
                        successful: successfulOptimizations.length,
                        failed: optimizationResults.length - successfulOptimizations.length,
                        totalRevenueImpact: Math.round(totalImpact * 100) / 100
                    }
                }
            });

        } catch (error) {
            logger.error('Error optimizing pricing:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to optimize pricing',
                error: error.message
            });
        }
    }

    /**
     * Get comprehensive yield management report
     */
    async getYieldManagementReport(req, res) {
        try {
            const { 
                period = '30d', 
                hotelId, 
                includeForecasts = true,
                includeRecommendations = true 
            } = req.query;

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const [startDate, endDate] = this.parsePeriod(period);

            // Get comprehensive yield data
            const [
                performanceMetrics,
                revenueAnalysis,
                demandTrends,
                pricingEffectiveness,
                competitorAnalysis
            ] = await Promise.all([
                this.getYieldPerformanceMetrics(startDate),
                revenueAnalytics.getRevenueAnalysis(startDate, endDate, hotelId),
                demandAnalyzer.getDemandTrends(startDate, endDate, hotelId),
                this.getPricingEffectivenessData(startDate),
                this.getCompetitorAnalysis(hotelId) // Placeholder for future implementation
            ]);

            const report = {
                period: { start: startDate, end: endDate, description: period },
                hotelId: hotelId || 'ALL',
                generatedAt: new Date(),
                generatedBy: req.user.id,
                
                performance: performanceMetrics,
                revenue: revenueAnalysis,
                demand: demandTrends,
                pricing: pricingEffectiveness,
                
                summary: {
                    overallYieldScore: this.calculateOverallYieldScore(performanceMetrics, revenueAnalysis),
                    revenueOptimization: revenueAnalysis.optimizationPercentage || 0,
                    demandForecast: demandTrends.forecastTrend || 'STABLE',
                    keyInsights: this.generateKeyInsights(performanceMetrics, revenueAnalysis, demandTrends)
                }
            };

            // Add forecasts if requested
            if (includeForecasts === 'true') {
                report.forecasts = await this.generateYieldForecasts(hotelId);
            }

            // Add recommendations if requested
            if (includeRecommendations === 'true') {
                report.recommendations = await this.generateYieldRecommendations(report);
            }

            res.json({
                success: true,
                data: report
            });

        } catch (error) {
            logger.error('Error generating yield management report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate yield management report',
                error: error.message
            });
        }
    }

    /**
     * Manage pricing rules
     */
    async managePricingRules(req, res) {
        try {
            const { action, ruleIds, ruleData } = req.body;

            switch (action) {
                case 'activate':
                    await this.activatePricingRules(ruleIds);
                    break;
                case 'deactivate':
                    await this.deactivatePricingRules(ruleIds);
                    break;
                case 'create':
                    await this.createPricingRule(ruleData);
                    break;
                case 'update':
                    await this.updatePricingRule(ruleData);
                    break;
                case 'delete':
                    await this.deletePricingRules(ruleIds);
                    break;
                default:
                    throw new Error('Invalid action');
            }

            // Send real-time notification
            socketService.sendAdminNotification('pricing-rules-updated', {
                action,
                ruleIds,
                updatedBy: req.user.id,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: `Pricing rules ${action} completed successfully`
            });

        } catch (error) {
            logger.error('Error managing pricing rules:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to manage pricing rules',
                error: error.message
            });
        }
    }

    /**
     * Get yield management job status and control
     */
    async getYieldJobsStatus(req, res) {
        try {
            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const yieldStatus = schedulerService.getYieldManagementStatus();
            const activeJobs = schedulerService.getActiveJobs().filter(job => 
                Object.values(JOB_TYPES).includes(job.type)
            );

            res.json({
                success: true,
                data: {
                    yieldManagement: yieldStatus,
                    activeYieldJobs: activeJobs,
                    controls: {
                        pause: '/api/admin/yield/jobs/pause',
                        resume: '/api/admin/yield/jobs/resume',
                        restart: '/api/admin/yield/jobs/restart',
                        trigger: '/api/admin/yield/jobs/trigger'
                    }
                }
            });

        } catch (error) {
            logger.error('Error getting yield jobs status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield jobs status',
                error: error.message
            });
        }
    }

    /**
     * Control yield management jobs
     */
    async controlYieldJobs(req, res) {
        try {
            const { action, jobType } = req.body;

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            let result;

            switch (action) {
                case 'pause_all':
                    result = schedulerService.pauseYieldJobs();
                    break;
                case 'resume_all':
                    result = schedulerService.resumeYieldJobs();
                    break;
                case 'restart_all':
                    result = await schedulerService.restartYieldJobs();
                    break;
                case 'trigger':
                    if (!jobType || !Object.values(JOB_TYPES).includes(jobType)) {
                        throw new Error('Valid job type required for trigger action');
                    }
                    result = await schedulerService.triggerYieldJob(jobType, {
                        triggeredBy: req.user.id,
                        manual: true
                    });
                    break;
                default:
                    throw new Error('Invalid action');
            }

            // Send real-time notification
            socketService.sendAdminNotification('yield-jobs-controlled', {
                action,
                jobType,
                result,
                controlledBy: req.user.id,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: `Yield jobs ${action} completed successfully`,
                data: result
            });

        } catch (error) {
            logger.error('Error controlling yield jobs:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to control yield jobs',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * ENHANCED BOOKING VALIDATION WITH YIELD
     * ================================
     */

    /**
     * Enhanced booking validation with yield recommendations
     */
    async validateBooking(req, res) {
        try {
            const { bookingId } = req.params;
            const { action, comment, notifyCustomer = true, applyYieldRecommendations = false } = req.body;
            const adminId = req.user.id;

            // Validate input
            if (!['approve', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action. Must be "approve" or "reject"'
                });
            }

            // Get booking with relations
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel')
                .populate('rooms');

            if (!booking) {
                return res.status(404).json({
                    success: false,
                    message: 'Booking not found'
                });
            }

            if (booking.status !== 'PENDING') {
                return res.status(400).json({
                    success: false,
                    message: `Booking is already ${booking.status.toLowerCase()}`
                });
            }

            // ================================
            // YIELD MANAGEMENT ANALYSIS
            // ================================
            let yieldRecommendation = null;
            let priceAdjustment = null;

            if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                try {
                    // Get yield recommendation for this booking
                    yieldRecommendation = await this.getBookingYieldRecommendation(booking);
                    
                    // Apply yield recommendations if requested and action is approve
                    if (applyYieldRecommendations && action === 'approve' && yieldRecommendation.suggestedAdjustment) {
                        priceAdjustment = await this.applyYieldAdjustment(booking, yieldRecommendation);
                    }

                } catch (yieldError) {
                    logger.error('Error getting yield recommendation:', yieldError);
                    yieldRecommendation = {
                        error: 'Failed to generate yield recommendation',
                        message: yieldError.message
                    };
                }
            }

            // Check room availability for approval
            if (action === 'approve') {
                const availability = await this.checkRoomAvailabilityForBooking(booking);
                if (!availability.available) {
                    return res.status(400).json({
                        success: false,
                        message: 'Rooms are no longer available for these dates',
                        availabilityInfo: availability
                    });
                }
            }

            // Update booking status
            const newStatus = action === 'approve' ? 'CONFIRMED' : 'REJECTED';
            const updatedBooking = await Booking.findByIdAndUpdate(
                bookingId,
                {
                    status: newStatus,
                    adminValidation: {
                        validatedBy: adminId,
                        validatedAt: new Date(),
                        action,
                        comment,
                        yieldRecommendation,
                        priceAdjustment
                    },
                    // Apply price adjustment if any
                    ...(priceAdjustment && {
                        totalPrice: priceAdjustment.newPrice,
                        priceAdjustmentReason: 'Yield management optimization'
                    })
                },
                { new: true }
            ).populate('customer').populate('hotel');

            // ================================
            // REAL-TIME NOTIFICATIONS WITH YIELD DATA
            // ================================
            
            // Notify customer
            if (notifyCustomer) {
                const notificationData = {
                    bookingId,
                    userId: booking.customer._id,
                    adminComment: comment,
                    yieldOptimization: priceAdjustment ? {
                        applied: true,
                        originalPrice: priceAdjustment.originalPrice,
                        newPrice: priceAdjustment.newPrice,
                        savings: priceAdjustment.newPrice < priceAdjustment.originalPrice ? 
                            priceAdjustment.originalPrice - priceAdjustment.newPrice : 0
                    } : null
                };

                if (action === 'approve') {
                    notificationService.emit('booking:confirmed', notificationData);
                } else {
                    notificationService.emit('booking:rejected', {
                        ...notificationData,
                        reason: comment
                    });
                }
            }

            // Broadcast to all admins with yield insights
            socketService.sendAdminNotification('booking-validated-with-yield', {
                bookingId,
                action,
                validatedBy: req.user.firstName + ' ' + req.user.lastName,
                customerName: booking.customer.firstName + ' ' + booking.customer.lastName,
                hotelName: booking.hotel.name,
                yieldRecommendation,
                priceAdjustment,
                revenueImpact: priceAdjustment ? 
                    priceAdjustment.newPrice - priceAdjustment.originalPrice : 0,
                timestamp: new Date()
            });

            logger.info(`Booking ${bookingId} ${action}ed by admin ${adminId} with yield analysis`);

            res.json({
                success: true,
                message: `Booking ${action}ed successfully`,
                data: {
                    booking: updatedBooking,
                    yieldAnalysis: {
                        recommendationFollowed: yieldRecommendation?.recommendation === action.toUpperCase(),
                        priceOptimized: !!priceAdjustment,
                        revenueImpact: priceAdjustment ? 
                            priceAdjustment.newPrice - priceAdjustment.originalPrice : 0
                    },
                    realTimeNotifications: {
                        customerNotified: notifyCustomer,
                        adminsBroadcast: true,
                        yieldDataIncluded: true
                    }
                }
            });

        } catch (error) {
            logger.error('Error validating booking with yield:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to validate booking',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * YIELD MANAGEMENT HELPER METHODS
     * ================================
     */

    /**
     * Get booking yield recommendation
     */
    async getBookingYieldRecommendation(booking) {
        try {
            const hotelId = booking.hotel._id;
            const checkInDate = booking.checkInDate;
            const roomTypes = booking.rooms.map(room => room.type);

            // Get current demand analysis
            const demandAnalysis = await demandAnalyzer.analyzeDemand(
                hotelId, 
                checkInDate, 
                booking.checkOutDate
            );

            // Get current pricing for the room types
            const currentPricing = await yieldManager.calculateDynamicPrice({
                hotelId,
                roomType: roomTypes[0], // Use first room type for analysis
                checkInDate,
                checkOutDate: booking.checkOutDate,
                strategy: 'MODERATE'
            });

            // Analyze booking value vs current market conditions
            const bookingValue = booking.totalPrice;
            const marketValue = currentPricing.totalPrice;
            const valueRatio = bookingValue / marketValue;

            let recommendation = 'APPROVE';
            let confidence = 70;
            let suggestedAdjustment = null;

            // Determine recommendation based on yield analysis
            if (demandAnalysis.level === 'HIGH' || demandAnalysis.level === 'VERY_HIGH') {
                if (valueRatio < 0.9) {
                    recommendation = 'APPROVE_WITH_PRICE_INCREASE';
                    suggestedAdjustment = {
                        type: 'INCREASE',
                        percentage: Math.min(15, (0.9 - valueRatio) * 100),
                        reason: 'High demand detected - optimize pricing'
                    };
                }
                confidence = 85;
            } else if (demandAnalysis.level === 'LOW' || demandAnalysis.level === 'VERY_LOW') {
                if (bookingValue < 200) { // Low value booking in low demand
                    recommendation = 'REVIEW';
                    confidence = 50;
                } else {
                    recommendation = 'APPROVE'; // Accept any reasonable booking in low demand
                    confidence = 80;
                }
            }

            // Consider booking timing
            const leadTime = Math.ceil((checkInDate - new Date()) / (1000 * 60 * 60 * 24));
            if (leadTime <= 7 && demandAnalysis.level !== 'LOW') {
                confidence += 10;
                if (!suggestedAdjustment && valueRatio < 1.1) {
                    suggestedAdjustment = {
                        type: 'INCREASE',
                        percentage: 5,
                        reason: 'Last-minute booking premium'
                    };
                }
            }

            return {
                recommendation,
                confidence: Math.min(95, confidence),
                demandLevel: demandAnalysis.level,
                marketValue,
                bookingValue,
                valueRatio: Math.round(valueRatio * 100) / 100,
                suggestedAdjustment,
                leadTime,
                analysis: {
                    demand: demandAnalysis,
                    pricing: currentPricing.factors,
                    recommendation: this.generateRecommendationText(recommendation, suggestedAdjustment)
                }
            };

        } catch (error) {
            logger.error('Error generating booking yield recommendation:', error);
            return {
                recommendation: 'APPROVE',
                confidence: 50,
                error: error.message,
                fallback: true
            };
        }
    }

    /**
     * Apply yield adjustment to booking
     */
    async applyYieldAdjustment(booking, yieldRecommendation) {
        try {
            if (!yieldRecommendation.suggestedAdjustment) {
                return null;
            }

            const { type, percentage } = yieldRecommendation.suggestedAdjustment;
            const originalPrice = booking.totalPrice;
            let newPrice = originalPrice;

            if (type === 'INCREASE') {
                newPrice = originalPrice * (1 + percentage / 100);
            } else if (type === 'DECREASE') {
                newPrice = originalPrice * (1 - percentage / 100);
            }

            // Apply yield limits
            const maxIncrease = originalPrice * (1 + YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT / 100);
            const minDecrease = originalPrice * (1 - YIELD_LIMITS.MIN_PRICE_DECREASE_PERCENT / 100);
            
            newPrice = Math.max(minDecrease, Math.min(maxIncrease, newPrice));
            newPrice = Math.round(newPrice * 100) / 100; // Round to 2 decimals

            return {
                originalPrice,
                newPrice,
                adjustment: newPrice - originalPrice,
                adjustmentPercentage: ((newPrice - originalPrice) / originalPrice) * 100,
                reason: yieldRecommendation.suggestedAdjustment.reason,
                appliedAt: new Date()
            };

        } catch (error) {
            logger.error('Error applying yield adjustment:', error);
            throw error;
        }
    }

    /**
     * Check demand surges across hotels
     */
    async checkDemandSurges() {
        try {
            const alerts = [];
            const hotels = await Hotel.find({ isActive: true }).select('_id name');

            for (const hotel of hotels) {
                try {
                    const demand = await demandAnalyzer.getCurrentDemandLevel(hotel._id);
                    
                    if (demand.level === 'VERY_HIGH' || demand.score > 80) {
                        alerts.push({
                            type: 'warning',
                            category: 'demand_surge',
                            message: `High demand detected at ${hotel.name}`,
                            hotelId: hotel._id,
                            hotelName: hotel.name,
                            demandLevel: demand.level,
                            demandScore: demand.score,
                            priority: 'high',
                            action: 'Consider increasing prices',
                            timestamp: new Date()
                        });
                    }
                } catch (error) {
                    // Skip hotels with demand analysis errors
                    continue;
                }
            }

            return alerts;

        } catch (error) {
            logger.error('Error checking demand surges:', error);
            return [];
        }
    }

    /**
     * Check pricing opportunities
     */
    async checkPricingOpportunities() {
        try {
            const alerts = [];
            
            // Get hotels with low occupancy but stable demand
            const hotels = await Hotel.find({ isActive: true }).select('_id name');
            
            for (const hotel of hotels) {
                try {
                    const occupancy = await this.getHotelOccupancyRate(hotel._id);
                    const demand = await demandAnalyzer.getCurrentDemandLevel(hotel._id);
                    
                    if (occupancy < 60 && demand.level === 'NORMAL') {
                        alerts.push({
                            type: 'info',
                            category: 'pricing_opportunity',
                            message: `Pricing optimization opportunity at ${hotel.name}`,
                            hotelId: hotel._id,
                            hotelName: hotel.name,
                            occupancyRate: occupancy,
                            demandLevel: demand.level,
                            priority: 'medium',
                            action: 'Consider promotional pricing',
                            timestamp: new Date()
                        });
                    }
                } catch (error) {
                    continue;
                }
            }

            return alerts;

        } catch (error) {
            logger.error('Error checking pricing opportunities:', error);
            return [];
        }
    }

    /**
     * Check underperforming pricing rules
     */
    async checkUnderperformingRules() {
        try {
            const alerts = [];
            const cutoffDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days ago

            const underperformingRules = await PricingRule.find({
                isActive: true,
                lastApplied: { $gte: cutoffDate },
                'performanceMetrics.revenueImpact': { $lt: -5 } // Rules causing revenue loss
            });

            underperformingRules.forEach(rule => {
                alerts.push({
                    type: 'warning',
                    category: 'underperforming_rule',
                    message: `Pricing rule "${rule.description}" is reducing revenue`,
                    ruleId: rule._id,
                    ruleType: rule.ruleType,
                    revenueImpact: rule.performanceMetrics.revenueImpact,
                    priority: 'medium',
                    action: 'Review or disable this rule',
                    timestamp: new Date()
                });
            });

            return alerts;

        } catch (error) {
            logger.error('Error checking underperforming rules:', error);
            return [];
        }
    }

    /**
     * Check yield job status for alerts
     */
    async checkYieldJobStatus() {
        try {
            const alerts = [];

            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return alerts;
            }

            const yieldStatus = schedulerService.getYieldManagementStatus();
            
            // Check if yield jobs are running
            if (!yieldStatus.enabled) {
                alerts.push({
                    type: 'error',
                    category: 'yield_system',
                    message: 'Yield management system is disabled',
                    priority: 'high',
                    action: 'Enable yield management',
                    timestamp: new Date()
                });
            } else if (yieldStatus.statistics.activeJobs === 0) {
                alerts.push({
                    type: 'warning',
                    category: 'yield_jobs',
                    message: 'No yield management jobs are currently active',
                    priority: 'medium',
                    action: 'Check job scheduler',
                    timestamp: new Date()
                });
            }

            // Check for recent job failures
            const recentFailures = yieldStatus.recentHistory?.filter(job => 
                job.status === 'failed' && 
                new Date(job.createdAt) > new Date(Date.now() - 60 * 60 * 1000) // Last hour
            ) || [];

            if (recentFailures.length > 2) {
                alerts.push({
                    type: 'error',
                    category: 'yield_job_failures',
                    message: `${recentFailures.length} yield jobs failed in the last hour`,
                    priority: 'high',
                    action: 'Check system logs',
                    timestamp: new Date()
                });
            }

            return alerts;

        } catch (error) {
            logger.error('Error checking yield job status:', error);
            return [];
        }
    }

    /**
     * Get recent price changes
     */
    async getRecentPriceChanges(startDate) {
        try {
            // This would typically come from a price change log
            // For now, return sample structure
            return {
                totalChanges: 0,
                increases: 0,
                decreases: 0,
                averageChange: 0,
                lastUpdate: new Date(),
                changes: []
            };
        } catch (error) {
            logger.error('Error getting recent price changes:', error);
            return { changes: [], totalChanges: 0 };
        }
    }

    /**
     * Calculate optimization impact
     */
    async calculateOptimizationImpact(startDate) {
        try {
            const yieldBookings = await Booking.find({
                createdAt: { $gte: startDate },
                'yieldManagement.enabled': true
            });

            let positiveImpact = 0;
            let negativeImpact = 0;
            let totalImpact = 0;

            yieldBookings.forEach(booking => {
                if (booking.yieldManagement?.priceAdjustment) {
                    const adjustment = booking.yieldManagement.priceAdjustment;
                    totalImpact += adjustment;
                    
                    if (adjustment > 0) {
                        positiveImpact += adjustment;
                    } else {
                        negativeImpact += Math.abs(adjustment);
                    }
                }
            });

            return {
                totalImpact: Math.round(totalImpact * 100) / 100,
                positive: Math.round(positiveImpact * 100) / 100,
                negative: Math.round(negativeImpact * 100) / 100,
                bookingsOptimized: yieldBookings.filter(b => b.yieldManagement?.priceAdjustment).length
            };

        } catch (error) {
            logger.error('Error calculating optimization impact:', error);
            return { totalImpact: 0, positive: 0, negative: 0, bookingsOptimized: 0 };
        }
    }

    /**
     * Calculate overall demand level from average score
     */
    calculateOverallDemandLevel(averageScore) {
        if (averageScore >= 80) return 'VERY_HIGH';
        if (averageScore >= 65) return 'HIGH';
        if (averageScore >= 35) return 'NORMAL';
        if (averageScore >= 20) return 'LOW';
        return 'VERY_LOW';
    }

    /**
     * Generate recommendation text
     */
    generateRecommendationText(recommendation, suggestedAdjustment) {
        switch (recommendation) {
            case 'APPROVE_WITH_PRICE_INCREASE':
                return `Approve with ${suggestedAdjustment?.percentage}% price increase due to ${suggestedAdjustment?.reason}`;
            case 'REVIEW':
                return 'Manual review recommended due to market conditions';
            case 'APPROVE':
            default:
                return 'Approve booking - aligns with current market conditions';
        }
    }

    /**
     * Get hotel occupancy rate
     */
    async getHotelOccupancyRate(hotelId) {
        try {
            const today = new Date();
            const totalRooms = await Room.countDocuments({ hotel: hotelId, isActive: true });
            const occupiedRooms = await Booking.countDocuments({
                hotel: hotelId,
                status: 'CHECKED_IN',
                checkInDate: { $lte: today },
                checkOutDate: { $gt: today }
            });

            return totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;
        } catch (error) {
            logger.error('Error getting hotel occupancy rate:', error);
            return 0;
        }
    }

    /**
     * Parse period string to start and end dates
     */
    parsePeriod(period) {
        const now = new Date();
        let startDate, endDate = now;

        switch (period) {
            case '7d':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case '30d':
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case '90d':
                startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            default:
                startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        return [startDate, endDate];
    }

    /**
     * Calculate overall yield score
     */
    calculateOverallYieldScore(performanceMetrics, revenueAnalysis) {
        const yieldScore = performanceMetrics.averageYieldScore || 50;
        const revenueOptimization = revenueAnalysis.optimizationPercentage || 0;
        
        // Weighted combination of yield score and revenue optimization
        return Math.round((yieldScore * 0.7) + (Math.min(revenueOptimization * 10, 50) * 0.3));
    }

    /**
     * Generate key insights from yield data
     */
    generateKeyInsights(performanceMetrics, revenueAnalysis, demandTrends) {
        const insights = [];

        if (performanceMetrics.revenueImpact > 10) {
            insights.push(`Yield management increased revenue by ${performanceMetrics.revenueImpact}%`);
        }

        if (demandTrends.trend === 'INCREASING') {
            insights.push('Demand is trending upward - consider price optimization');
        }

        if (performanceMetrics.optimizationRate < 50) {
            insights.push('Low yield optimization rate - consider enabling for more bookings');
        }

        return insights;
    }

    /**
     * Generate yield forecasts
     */
    async generateYieldForecasts(hotelId) {
        try {
            // Placeholder for forecast generation
            return {
                demandForecast: 'STABLE',
                revenueForecast: 'GROWTH',
                pricingRecommendations: ['Increase weekend rates', 'Implement last-minute discounts'],
                confidence: 75
            };
        } catch (error) {
            logger.error('Error generating yield forecasts:', error);
            return { error: error.message };
        }
    }

    /**
     * Generate yield recommendations
     */
    async generateYieldRecommendations(report) {
        try {
            const recommendations = [];

            if (report.performance.averageYieldScore < 60) {
                recommendations.push({
                    type: 'PERFORMANCE',
                    priority: 'HIGH',
                    message: 'Overall yield performance is below target',
                    action: 'Review pricing strategies and rules'
                });
            }

            if (report.revenue.optimizationPercentage < 5) {
                recommendations.push({
                    type: 'REVENUE',
                    priority: 'MEDIUM',
                    message: 'Limited revenue optimization detected',
                    action: 'Enable more aggressive yield management'
                });
            }

            return recommendations;
        } catch (error) {
            logger.error('Error generating yield recommendations:', error);
            return [];
        }
    }

    /**
     * Get competitor analysis (placeholder)
     */
    async getCompetitorAnalysis(hotelId) {
        try {
            // Placeholder for competitor analysis
            return {
                available: false,
                message: 'Competitor analysis feature coming soon'
            };
        } catch (error) {
            return { error: error.message };
        }
    }

    /**
     * ================================
     * PRICING RULES MANAGEMENT
     * ================================
     */

    async activatePricingRules(ruleIds) {
        await PricingRule.updateMany(
            { _id: { $in: ruleIds } },
            { isActive: true, updatedAt: new Date() }
        );
    }

    async deactivatePricingRules(ruleIds) {
        await PricingRule.updateMany(
            { _id: { $in: ruleIds } },
            { isActive: false, updatedAt: new Date() }
        );
    }

    async createPricingRule(ruleData) {
        const rule = new PricingRule(ruleData);
        await rule.save();
        return rule;
    }

    async updatePricingRule(ruleData) {
        const { ruleId, ...updateData } = ruleData;
        return await PricingRule.findByIdAndUpdate(
            ruleId,
            { ...updateData, updatedAt: new Date() },
            { new: true }
        );
    }

    async deletePricingRules(ruleIds) {
        await PricingRule.deleteMany({ _id: { $in: ruleIds } });
    }

    // ================================
    // EXISTING METHODS (unchanged)
    // ================================

    /**
     * Setup real-time dashboard streaming for an admin
     */
    async setupDashboardStreaming(adminId, preferences = {}) {
        try {
            // Check if admin is connected via WebSocket
            if (!socketService.isUserConnected(adminId)) {
                logger.info(`Admin ${adminId} not connected for streaming`);
                return;
            }

            // Send real-time updates every 30 seconds
            const streamingInterval = setInterval(async () => {
                try {
                    if (!socketService.isUserConnected(adminId)) {
                        clearInterval(streamingInterval);
                        return;
                    }

                    const liveData = await this.getLiveDashboardData(preferences);
                    socketService.sendUserNotification(adminId, 'dashboard-update', liveData);
                } catch (error) {
                    logger.error('Error in dashboard streaming:', error);
                }
            }, 30000);

            logger.info(`Dashboard streaming started for admin ${adminId}`);
        } catch (error) {
            logger.error('Error setting up dashboard streaming:', error);
        }
    }

    /**
     * Get live dashboard data for streaming
     */
    async getLiveDashboardData(preferences = {}) {
        const { timeframe = '24h', currency = 'EUR', includeYield = true } = preferences;
        
        const now = new Date();
        const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

        const [pendingCount, realtimeMetrics, systemAlerts] = await Promise.all([
            Booking.countDocuments({ status: 'PENDING' }),
            this.getRealtimeMetrics(),
            this.getSystemAlerts()
        ]);

        const liveData = {
            timestamp: now,
            pendingBookings: pendingCount,
            realtimeMetrics,
            systemAlerts,
            connectionCount: socketService.getConnectionStats()
        };

        // Add yield management live data if enabled
        if (includeYield === 'true' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
            try {
                liveData.yieldManagement = {
                    activeOptimizations: await yieldManager.getActiveOptimizations(),
                    currentDemandLevel: await this.getOverallDemandLevel(),
                    recentPriceChanges: await this.getRecentPriceChanges(startDate),
                    systemHealth: schedulerService.getYieldManagementStatus()
                };
            } catch (yieldError) {
                liveData.yieldManagement = { error: 'Failed to load yield data' };
            }
        }

        return liveData;
    }

    async getOverallDemandLevel() {
        try {
            const hotels = await Hotel.find({ isActive: true }).select('_id');
            let totalScore = 0;
            let hotelCount = 0;

            for (const hotel of hotels) {
                try {
                    const demand = await demandAnalyzer.getCurrentDemandLevel(hotel._id);
                    totalScore += demand.score;
                    hotelCount++;
                } catch (error) {
                    continue;
                }
            }

            const averageScore = hotelCount > 0 ? totalScore / hotelCount : 0;
            return this.calculateOverallDemandLevel(averageScore);
        } catch (error) {
            return 'UNKNOWN';
        }
    }

    /**
     * Get all pending bookings requiring admin validation
     */
    async getPendingBookings(req, res) {
        try {
            const { page = 1, limit = 10, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
            
            const skip = (page - 1) * limit;
            const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };

            const [bookings, totalCount] = await Promise.all([
                Booking.find({ status: 'PENDING' })
                    .populate('customer', 'firstName lastName email phone')
                    .populate('hotel', 'name city address')
                    .sort(sort)
                    .skip(skip)
                    .limit(parseInt(limit))
                    .lean(),
                Booking.countDocuments({ status: 'PENDING' })
            ]);

            // Add real-time context to each booking
            const enrichedBookings = await Promise.all(
                bookings.map(async (booking) => {
                    const roomAvailability = await this.checkRoomAvailabilityForBooking(booking);
                    const urgencyScore = this.calculateBookingUrgency(booking);
                    
                    return {
                        ...booking,
                        roomAvailability,
                        urgencyScore,
                        timeInQueue: Date.now() - new Date(booking.createdAt).getTime(),
                        requiresImmediateAction: urgencyScore > 8
                    };
                })
            );

            if (req.path && req.path.includes('/api/')) {
                res.json({
                    success: true,
                    data: {
                        bookings: enrichedBookings,
                        totalCount,
                        currentPage: parseInt(page),
                        totalPages: Math.ceil(totalCount / limit),
                        hasNextPage: page * limit < totalCount,
                        hasPrevPage: page > 1
                    }
                });
            } else {
                return {
                    count: totalCount,
                    bookings: enrichedBookings
                };
            }
        } catch (error) {
            logger.error('Error getting pending bookings:', error);
            if (req.path) {
                res.status(500).json({
                    success: false,
                    message: 'Failed to load pending bookings',
                    error: error.message
                });
            } else {
                throw error;
            }
        }
    }

    // ... (include all other existing methods from original adminController.js)
    // getTotalBookings, getConfirmedBookings, getTotalRevenue, getOccupancyData, etc.

    async getTotalBookings(startDate) {
        return await Booking.countDocuments({
            createdAt: { $gte: startDate }
        });
    }

    async getConfirmedBookings(startDate) {
        return await Booking.countDocuments({
            status: 'CONFIRMED',
            createdAt: { $gte: startDate }
        });
    }

    async getTotalRevenue(startDate, currency = 'EUR') {
        const bookings = await Booking.find({
            status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
            createdAt: { $gte: startDate }
        }).select('totalPrice currency');

        let totalRevenue = 0;
        for (const booking of bookings) {
            if (booking.currency === currency) {
                totalRevenue += booking.totalPrice;
            } else {
                try {
                    const converted = await currencyService.convertCurrency(
                        booking.totalPrice,
                        booking.currency,
                        currency
                    );
                    totalRevenue += converted.convertedAmount;
                } catch (error) {
                    logger.warn(`Failed to convert currency for booking ${booking._id}`);
                    totalRevenue += booking.totalPrice; // Fallback
                }
            }
        }

        return Math.round(totalRevenue * 100) / 100;
    }

    async getOccupancyData() {
        const totalRooms = await Room.countDocuments();
        const occupiedRooms = await Booking.countDocuments({
            status: 'CHECKED_IN',
            checkInDate: { $lte: new Date() },
            checkOutDate: { $gte: new Date() }
        });

        return {
            totalRooms,
            occupiedRooms,
            availableRooms: totalRooms - occupiedRooms,
            occupancyRate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0
        };
    }

    async getRecentBookings(limit = 5) {
        return await Booking.find()
            .populate('customer', 'firstName lastName')
            .populate('hotel', 'name city')
            .sort({ createdAt: -1 })
            .limit(limit)
            .select('confirmationNumber status totalPrice currency createdAt')
            .lean();
    }

    async getSystemAlerts() {
        const alerts = [];
        
        // Check for high pending booking count
        const pendingCount = await Booking.countDocuments({ status: 'PENDING' });
        if (pendingCount > 10) {
            alerts.push({
                type: 'warning',
                message: `${pendingCount} bookings pending validation`,
                priority: 'medium',
                timestamp: new Date()
            });
        }

        // Check for system performance
        const connectionStats = socketService.getConnectionStats();
        if (connectionStats.totalConnections > 100) {
            alerts.push({
                type: 'info',
                message: `High activity: ${connectionStats.totalConnections} users online`,
                priority: 'low',
                timestamp: new Date()
            });
        }

        return alerts;
    }

    async getRealtimeMetrics() {
        const connectionStats = socketService.getConnectionStats();
        const now = new Date();
        const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);

        const [recentBookings, recentLogins] = await Promise.all([
            Booking.countDocuments({ createdAt: { $gte: hourAgo } }),
            User.countDocuments({ lastLogin: { $gte: hourAgo } })
        ]);

        return {
            connections: connectionStats,
            bookingsLastHour: recentBookings,
            loginsLastHour: recentLogins,
            serverUptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            timestamp: now
        };
    }

    async checkRoomAvailabilityForBooking(booking) {
        try {
            const availableRooms = await Room.countDocuments({
                hotel: booking.hotel._id,
                roomType: { $in: booking.rooms.map(r => r.roomType) },
                status: 'AVAILABLE'
            });

            return {
                available: availableRooms >= booking.rooms.length,
                availableCount: availableRooms,
                requiredCount: booking.rooms.length
            };
        } catch (error) {
            logger.error('Error checking room availability:', error);
            return { available: false, error: error.message };
        }
    }

    calculateBookingUrgency(booking) {
        const now = new Date();
        const checkInDate = new Date(booking.checkInDate);
        const timeInQueue = now - new Date(booking.createdAt);
        const daysUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60 * 24);

        let urgency = 5; // Base urgency

        // Increase urgency based on time in queue
        if (timeInQueue > 24 * 60 * 60 * 1000) urgency += 3; // > 24 hours
        else if (timeInQueue > 4 * 60 * 60 * 1000) urgency += 2; // > 4 hours
        else if (timeInQueue > 1 * 60 * 60 * 1000) urgency += 1; // > 1 hour

        // Increase urgency if check-in is soon
        if (daysUntilCheckIn <= 1) urgency += 4; // Tomorrow or today
        else if (daysUntilCheckIn <= 3) urgency += 2; // Within 3 days
        else if (daysUntilCheckIn <= 7) urgency += 1; // Within a week

        // High-value bookings
        if (booking.totalAmount > 500) urgency += 1;
        if (booking.totalAmount > 1000) urgency += 1;

        return Math.min(urgency, 10); // Cap at 10
    }

    /**
     * ================================
     * BULK OPERATIONS WITH YIELD OPTIMIZATION
     * ================================
     */

    /**
     * Bulk validation for multiple bookings with yield optimization
     */
    async bulkValidateBookings(req, res) {
        try {
            const { bookingIds, action, comment, applyYieldOptimization = false } = req.body;
            const adminId = req.user.id;

            if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Booking IDs array is required'
                });
            }

            if (!['approve', 'reject'].includes(action)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid action'
                });
            }

            const results = [];
            const failedValidations = [];
            let totalRevenueImpact = 0;

            // Process each booking
            for (const bookingId of bookingIds) {
                try {
                    const booking = await Booking.findById(bookingId)
                        .populate('customer')
                        .populate('hotel');

                    if (!booking || booking.status !== 'PENDING') {
                        failedValidations.push({
                            bookingId,
                            reason: 'Booking not found or not pending'
                        });
                        continue;
                    }

                    // Get yield recommendation for each booking
                    let yieldRecommendation = null;
                    let priceAdjustment = null;

                    if (applyYieldOptimization && action === 'approve' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                        try {
                            yieldRecommendation = await this.getBookingYieldRecommendation(booking);
                            if (yieldRecommendation.suggestedAdjustment) {
                                priceAdjustment = await this.applyYieldAdjustment(booking, yieldRecommendation);
                                totalRevenueImpact += priceAdjustment.adjustment;
                            }
                        } catch (yieldError) {
                            logger.warn(`Yield optimization failed for booking ${bookingId}:`, yieldError.message);
                        }
                    }

                    // Check availability for approvals
                    if (action === 'approve') {
                        const availability = await this.checkRoomAvailabilityForBooking(booking);
                        if (!availability.available) {
                            failedValidations.push({
                                bookingId,
                                reason: 'Rooms no longer available'
                            });
                            continue;
                        }
                    }

                    // Update booking
                    const newStatus = action === 'approve' ? 'CONFIRMED' : 'REJECTED';
                    await Booking.findByIdAndUpdate(bookingId, {
                        status: newStatus,
                        adminValidation: {
                            validatedBy: adminId,
                            validatedAt: new Date(),
                            action,
                            comment,
                            yieldRecommendation,
                            priceAdjustment
                        },
                        // Apply price adjustment if any
                        ...(priceAdjustment && {
                            totalPrice: priceAdjustment.newPrice,
                            priceAdjustmentReason: 'Bulk yield optimization'
                        })
                    });

                    // Send real-time notifications
                    if (action === 'approve') {
                        notificationService.emit('booking:confirmed', {
                            bookingId,
                            userId: booking.customer._id,
                            adminComment: comment,
                            bulkOperation: true,
                            yieldOptimized: !!priceAdjustment
                        });
                    } else {
                        notificationService.emit('booking:rejected', {
                            bookingId,
                            userId: booking.customer._id,
                            reason: comment,
                            bulkOperation: true
                        });
                    }

                    results.push({
                        bookingId,
                        status: 'success',
                        newStatus,
                        yieldOptimized: !!priceAdjustment,
                        revenueImpact: priceAdjustment?.adjustment || 0
                    });

                } catch (error) {
                    failedValidations.push({
                        bookingId,
                        reason: error.message
                    });
                }
            }

            // Send bulk notification to admins with yield data
            socketService.sendAdminNotification('bulk-validation-completed-with-yield', {
                action,
                totalProcessed: bookingIds.length,
                successful: results.length,
                failed: failedValidations.length,
                yieldOptimizationApplied: applyYieldOptimization,
                totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
                validatedBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: `Bulk validation completed: ${results.length} successful, ${failedValidations.length} failed`,
                data: {
                    successful: results,
                    failed: failedValidations,
                    summary: {
                        total: bookingIds.length,
                        successful: results.length,
                        failed: failedValidations.length,
                        yieldOptimized: results.filter(r => r.yieldOptimized).length,
                        totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100
                    }
                }
            });

        } catch (error) {
            logger.error('Error in bulk validation with yield:', error);
            res.status(500).json({
                success: false,
                message: 'Bulk validation failed',
                error: error.message
            });
        }
    }

    /**
     * ================================
     * ADDITIONAL YIELD MANAGEMENT ENDPOINTS
     * ================================
     */

    /**
     * Get real-time yield management dashboard
     */
    async getYieldDashboard(req, res) {
        try {
            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const { timeframe = '24h', currency = 'EUR' } = req.query;
            const dashboardData = await yieldManager.getDashboardData();

            // Enhance with admin-specific data
            const enhancedData = {
                ...dashboardData,
                adminControls: {
                    triggerDemandAnalysis: '/api/admin/yield/trigger-demand-analysis',
                    optimizePricing: '/api/admin/yield/optimize-pricing',
                    managePricingRules: '/api/admin/yield/pricing-rules',
                    controlJobs: '/api/admin/yield/jobs/control',
                    generateReport: '/api/admin/yield/report'
                },
                systemStatus: {
                    yieldManager: await yieldManager.getHealthStatus(),
                    scheduler: schedulerService.getYieldManagementStatus(),
                    demandAnalyzer: demandAnalyzer.getStatus(),
                    revenueAnalytics: revenueAnalytics.getStatus()
                }
            };

            res.json({
                success: true,
                data: enhancedData
            });

        } catch (error) {
            logger.error('Error getting yield dashboard:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield dashboard',
                error: error.message
            });
        }
    }

    /**
     * Send urgent notification to all connected admins
     */
    async sendUrgentNotification(req, res) {
        try {
            const { title, message, priority = 'high', targetRoles = ['ADMIN'] } = req.body;
            
            // Broadcast urgent notification
            socketService.sendAdminNotification('urgent-notification', {
                title,
                message,
                priority,
                sentBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            // Also send via notification service for offline admins
            notificationService.emit('system:alert', {
                message: `${title}: ${message}`,
                severity: priority,
                targetRoles
            });

            logger.info(`Urgent notification sent by admin ${req.user.id}: ${title}`);

            res.json({
                success: true,
                message: 'Urgent notification sent to all admins',
                data: {
                    title,
                    message,
                    priority,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('Error sending urgent notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send urgent notification',
                error: error.message
            });
        }
    }

    /**
     * Get real-time system statistics with yield metrics
     */
    async getSystemStats(req, res) {
        try {
            const stats = await this.getRealtimeMetrics();
            
            // Add yield management statistics if enabled
            if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                stats.yieldManagement = {
                    systemHealth: await yieldManager.getHealthStatus(),
                    activeOptimizations: await yieldManager.getActiveOptimizations(),
                    jobsStatus: schedulerService.getYieldManagementStatus(),
                    performanceMetrics: await this.getYieldPerformanceMetrics(
                        new Date(Date.now() - 24 * 60 * 60 * 1000)
                    )
                };
            }
            
            res.json({
                success: true,
                data: stats,
                timestamp: new Date()
            });
        } catch (error) {
            logger.error('Error getting system stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get system statistics',
                error: error.message
            });
        }
    }

    /**
     * Get real-time admin activity feed with yield events
     */
    async getAdminActivityFeed(req, res) {
        try {
            const { limit = 20, includeYieldEvents = true } = req.query;
            
            // Get recent admin activities
            const activities = await this.getRecentAdminActivities(limit);
            
            // Add yield management events if enabled
            if (includeYieldEvents === 'true' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                const yieldEvents = await this.getRecentYieldEvents(limit);
                activities.push(...yieldEvents);
                
                // Sort by timestamp
                activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
                activities.splice(limit); // Keep only the requested limit
            }
            
            res.json({
                success: true,
                data: activities,
                timestamp: new Date()
            });
        } catch (error) {
            logger.error('Error getting admin activity feed:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get activity feed',
                error: error.message
            });
        }
    }

    /**
     * Get recent yield management events
     */
    async getRecentYieldEvents(limit = 10) {
        try {
            const yieldEvents = [];
            
            // Get recent price optimizations
            const recentOptimizations = await Booking.find({
                'yieldManagement.lastOptimization': { $exists: true },
                'yieldManagement.lastOptimization.optimizedAt': {
                    $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                }
            })
            .populate('hotel', 'name')
            .sort({ 'yieldManagement.lastOptimization.optimizedAt': -1 })
            .limit(limit);

            recentOptimizations.forEach(booking => {
                const optimization = booking.yieldManagement.lastOptimization;
                yieldEvents.push({
                    type: 'yield_optimization',
                    action: 'price_optimized',
                    timestamp: optimization.optimizedAt,
                    details: {
                        bookingId: booking._id,
                        hotel: booking.hotel.name,
                        strategy: optimization.strategy,
                        improvement: optimization.improvement,
                        optimizedBy: optimization.optimizedBy
                    }
                });
            });

            return yieldEvents;

        } catch (error) {
            logger.error('Error getting recent yield events:', error);
            return [];
        }
    }

    async getRecentAdminActivities(limit = 20) {
        // This would come from an AdminActivity model or audit log
        // For now, returning recent booking validations
        const recentValidations = await Booking.find({
            'adminValidation.validatedAt': { $exists: true }
        })
        .populate('adminValidation.validatedBy', 'firstName lastName')
        .populate('customer', 'firstName lastName')
        .populate('hotel', 'name')
        .sort({ 'adminValidation.validatedAt': -1 })
        .limit(limit)
        .select('confirmationNumber adminValidation customer hotel')
        .lean();

        return recentValidations.map(booking => ({
            type: 'booking_validation',
            action: booking.adminValidation.action,
            timestamp: booking.adminValidation.validatedAt,
            admin: booking.adminValidation.validatedBy,
            details: {
                bookingNumber: booking.confirmationNumber,
                customer: booking.customer,
                hotel: booking.hotel,
                yieldOptimized: !!booking.adminValidation.priceAdjustment
            }
        }));
    }
}

module.exports = new AdminController();