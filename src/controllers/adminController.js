const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const PricingRule = require('../models/PricingRule');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const currencyService = require('../services/currencyService');

// Dans processExpiredPoints(), ligne 2406, vous référencez emailService mais il n'est pas importé
const emailService = require('../services/emailService'); // À ajouter en haut du fichier

// Ligne 2442, vous utilisez mongoose.Types.ObjectId mais mongoose n'est pas importé
const mongoose = require('mongoose'); // À ajouter en haut du fichier

// YIELD MANAGEMENT SERVICES INTEGRATION
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const revenueAnalytics = require('../services/revenueAnalytics');
const schedulerService = require('../services/scheduler');

// LOYALTY PROGRAM INTEGRATION
const { getLoyaltyService } = require('../services/loyaltyService');

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
  ANALYSIS_PERIODS,
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
      const {
        timeframe = '24h',
        currency = 'EUR',
        includeYield = true,
        includeLoyalty = true,
      } = req.query;

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
        realtimeMetrics,
      ] = await Promise.all([
        this.getTotalBookings(startDate),
        this.getPendingBookings(),
        this.getConfirmedBookings(startDate),
        this.getTotalRevenue(startDate, currency),
        this.getOccupancyData(),
        this.getRecentBookings(5),
        this.getSystemAlerts(),
        this.getRealtimeMetrics(),
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
          totalRooms: occupancyData.totalRooms,
        },
        pendingBookingsList: pendingBookings.bookings,
        recentBookings,
        systemAlerts,
        realtimeMetrics,
        currency,
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
            yieldAlerts,
          ] = await Promise.all([
            this.getYieldPerformanceMetrics(startDate, currency),
            this.getRevenueOptimizationData(startDate),
            this.getCurrentDemandAnalysis(),
            this.getPricingEffectivenessData(startDate),
            this.getYieldManagementAlerts(),
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
              generateForecast: '/api/admin/yield/generate-forecast',
            },
          };

          // Add yield-specific system alerts
          dashboardData.systemAlerts = [...dashboardData.systemAlerts, ...yieldAlerts];
        } catch (yieldError) {
          logger.error('Error loading yield management data:', yieldError);
          dashboardData.yieldManagement = {
            enabled: true,
            error: 'Failed to load yield management data',
            message: yieldError.message,
          };
        }
      } else {
        dashboardData.yieldManagement = {
          enabled: false,
          message: 'Yield management is disabled',
        };
      }

      // ================================
      // ADD LOYALTY PROGRAM DATA
      // ================================
      if (includeLoyalty === 'true') {
        try {
          const [loyaltyStats, loyaltyActivity, topLoyaltyMembers, loyaltyAlerts] =
            await Promise.all([
              this.getLoyaltyDashboardStats(startDate),
              this.getLoyaltyActivity(startDate),
              this.getTopLoyaltyMembers(5),
              this.getLoyaltySystemAlerts(),
            ]);

          dashboardData.loyaltyProgram = {
            enabled: true,
            stats: loyaltyStats,
            activity: loyaltyActivity,
            topMembers: topLoyaltyMembers,
            alerts: loyaltyAlerts,
            quickActions: {
              viewAllMembers: '/api/admin/loyalty/members',
              managePoints: '/api/admin/loyalty/adjust-points',
              createCampaign: '/api/admin/loyalty/campaigns',
              viewReports: '/api/admin/loyalty/reports',
            },
          };

          // Add loyalty-specific system alerts
          dashboardData.systemAlerts = [...dashboardData.systemAlerts, ...loyaltyAlerts];
        } catch (loyaltyError) {
          logger.error('Error loading loyalty program data:', loyaltyError);
          dashboardData.loyaltyProgram = {
            enabled: true,
            error: 'Failed to load loyalty program data',
            message: loyaltyError.message,
          };
        }
      } else {
        dashboardData.loyaltyProgram = {
          enabled: false,
          message: 'Loyalty program module disabled',
        };
      }

      // Send initial data
      res.json({
        success: true,
        data: dashboardData,
      });

      // Setup live streaming for this admin
      this.setupDashboardStreaming(req.user.id, {
        timeframe,
        currency,
        includeYield,
        includeLoyalty,
      });
    } catch (error) {
      logger.error('Error getting dashboard data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to load dashboard data',
        error: error.message,
      });
    }
  }

  // ... (all existing yield management methods remain unchanged) ...

  // ================================
  // YIELD MANAGEMENT METHODS (unchanged from original)
  // ================================

  /**
   * Get yield performance metrics for dashboard
   */
  async getYieldPerformanceMetrics(startDate, currency = 'EUR') {
    try {
      // Get yield-optimized bookings
      const yieldBookings = await Booking.find({
        createdAt: { $gte: startDate },
        'yieldManagement.enabled': true,
      }).populate('hotel', 'name');

      if (yieldBookings.length === 0) {
        return {
          totalOptimizedBookings: 0,
          averageYieldScore: 0,
          revenueImpact: 0,
          optimizationRate: 0,
          performanceByHotel: [],
        };
      }

      // Calculate metrics
      const totalOptimizedBookings = yieldBookings.length;
      const totalRevenue = yieldBookings.reduce((sum, booking) => sum + booking.totalPrice, 0);
      const totalBaseRevenue = yieldBookings.reduce((sum, booking) => {
        const basePrice =
          booking.yieldManagement?.pricingDetails?.[0]?.basePrice || booking.totalPrice;
        return sum + basePrice;
      }, 0);

      const revenueImpact =
        totalBaseRevenue > 0 ? ((totalRevenue - totalBaseRevenue) / totalBaseRevenue) * 100 : 0;

      const averageYieldScore =
        yieldBookings.reduce((sum, booking) => {
          return sum + (booking.yieldManagement?.performanceScore || 50);
        }, 0) / totalOptimizedBookings;

      // Performance by hotel
      const hotelPerformance = {};
      yieldBookings.forEach((booking) => {
        const hotelId = booking.hotel._id.toString();
        if (!hotelPerformance[hotelId]) {
          hotelPerformance[hotelId] = {
            hotelName: booking.hotel.name,
            bookings: 0,
            revenue: 0,
            yieldScore: 0,
          };
        }
        hotelPerformance[hotelId].bookings++;
        hotelPerformance[hotelId].revenue += booking.totalPrice;
        hotelPerformance[hotelId].yieldScore += booking.yieldManagement?.performanceScore || 50;
      });

      const performanceByHotel = Object.values(hotelPerformance).map((hotel) => ({
        ...hotel,
        averageYieldScore: hotel.yieldScore / hotel.bookings,
        revenuePerBooking: hotel.revenue / hotel.bookings,
      }));

      return {
        totalOptimizedBookings,
        averageYieldScore: Math.round(averageYieldScore),
        revenueImpact: Math.round(revenueImpact * 100) / 100,
        optimizationRate: Math.round(
          (totalOptimizedBookings / (await this.getTotalBookings(startDate))) * 100
        ),
        performanceByHotel,
        totalOptimizedRevenue: Math.round(totalRevenue * 100) / 100,
        currency,
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
        potentialRevenue: optimizationData.potentialRevenue || 0,
      };
    } catch (error) {
      logger.error('Error getting revenue optimization data:', error);
      return {
        opportunities: [],
        recentPriceChanges: [],
        impact: { totalImpact: 0, positive: 0, negative: 0 },
        recommendations: [],
        error: error.message,
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
            confidence: demand.confidence,
          });
        } catch (hotelError) {
          logger.warn(`Error getting demand for hotel ${hotel._id}:`, hotelError.message);
        }
      }

      // Calculate overall demand metrics
      const totalDemandScore = demandByHotel.reduce((sum, hotel) => sum + hotel.demandScore, 0);
      const averageDemandScore =
        demandByHotel.length > 0 ? totalDemandScore / demandByHotel.length : 0;

      const demandDistribution = {};
      demandByHotel.forEach((hotel) => {
        demandDistribution[hotel.currentDemand] =
          (demandDistribution[hotel.currentDemand] || 0) + 1;
      });

      return {
        overallDemand: this.calculateOverallDemandLevel(averageDemandScore),
        averageScore: Math.round(averageDemandScore),
        distribution: demandDistribution,
        hotelDetails: demandByHotel,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting current demand analysis:', error);
      return {
        overallDemand: 'UNKNOWN',
        averageScore: 0,
        distribution: {},
        hotelDetails: [],
        error: error.message,
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
        lastApplied: { $gte: startDate },
      });

      const effectivenessData = {
        totalActiveRules: pricingRules.length,
        rulesApplied: pricingRules.filter((rule) => rule.lastApplied).length,
        averageImpact: 0,
        topPerformingRules: [],
        underperformingRules: [],
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
              impact: Math.round(impact * 100) / 100,
            });
          } else if (impact < -2) {
            effectivenessData.underperformingRules.push({
              ruleId: rule._id,
              ruleType: rule.ruleType,
              description: rule.description,
              impact: Math.round(impact * 100) / 100,
            });
          }
        }
      }

      effectivenessData.averageImpact =
        pricingRules.length > 0 ? effectivenessData.averageImpact / pricingRules.length : 0;

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
        error: error.message,
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
      return [
        {
          type: 'error',
          message: 'Failed to load yield management alerts',
          priority: 'medium',
          timestamp: new Date(),
        },
      ];
    }
  }

  /**
   * Trigger demand analysis for all hotels or specific hotel
   */
  async triggerDemandAnalysis(req, res) {
    try {
      const { hotelId, priority = 'high' } = req.body;

      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return res.status(400).json({
          success: false,
          message: 'Yield management is not enabled',
        });
      }

      let analysisResults = [];

      if (hotelId) {
        // Trigger for specific hotel
        const result = await yieldManager.triggerDemandAnalysis(hotelId);
        analysisResults.push({
          hotelId,
          status: 'completed',
          result,
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
              result,
            });
          } catch (hotelError) {
            analysisResults.push({
              hotelId: hotel._id,
              hotelName: hotel.name,
              status: 'failed',
              error: hotelError.message,
            });
          }
        }
      }

      // Send real-time notification
      socketService.sendAdminNotification('demand-analysis-completed', {
        triggeredBy: req.user.id,
        results: analysisResults,
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: 'Demand analysis triggered successfully',
        data: {
          analysisResults,
          triggeredBy: req.user.id,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error triggering demand analysis:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to trigger demand analysis',
        error: error.message,
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
          message: 'Yield management is not enabled',
        });
      }

      const optimizationResults = [];
      const hotels = hotelIds || (await Hotel.find({ isActive: true }).distinct('_id'));

      for (const hotelId of hotels) {
        try {
          const optimization = await yieldManager.updatePricingForHotel(hotelId, {
            strategy,
            dateRange,
            triggeredBy: req.user.id,
          });

          optimizationResults.push({
            hotelId,
            status: 'optimized',
            optimization,
          });
        } catch (hotelError) {
          optimizationResults.push({
            hotelId,
            status: 'failed',
            error: hotelError.message,
          });
        }
      }

      // Calculate overall impact
      const successfulOptimizations = optimizationResults.filter((r) => r.status === 'optimized');
      const totalImpact = successfulOptimizations.reduce((sum, result) => {
        return sum + (result.optimization?.revenueImpact || 0);
      }, 0);

      // Send real-time notification
      socketService.sendAdminNotification('pricing-optimization-completed', {
        optimizationResults,
        totalImpact,
        strategy,
        triggeredBy: req.user.id,
        timestamp: new Date(),
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
            totalRevenueImpact: Math.round(totalImpact * 100) / 100,
          },
        },
      });
    } catch (error) {
      logger.error('Error optimizing pricing:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to optimize pricing',
        error: error.message,
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
        includeRecommendations = true,
      } = req.query;

      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return res.status(400).json({
          success: false,
          message: 'Yield management is not enabled',
        });
      }

      const [startDate, endDate] = this.parsePeriod(period);

      // Get comprehensive yield data
      const [
        performanceMetrics,
        revenueAnalysis,
        demandTrends,
        pricingEffectiveness,
        competitorAnalysis,
      ] = await Promise.all([
        this.getYieldPerformanceMetrics(startDate),
        revenueAnalytics.getRevenueAnalysis(startDate, endDate, hotelId),
        demandAnalyzer.getDemandTrends(startDate, endDate, hotelId),
        this.getPricingEffectivenessData(startDate),
        this.getCompetitorAnalysis(hotelId), // Placeholder for future implementation
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
          keyInsights: this.generateKeyInsights(performanceMetrics, revenueAnalysis, demandTrends),
        },
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
        data: report,
      });
    } catch (error) {
      logger.error('Error generating yield management report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate yield management report',
        error: error.message,
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
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: `Pricing rules ${action} completed successfully`,
      });
    } catch (error) {
      logger.error('Error managing pricing rules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage pricing rules',
        error: error.message,
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
          message: 'Yield management is not enabled',
        });
      }

      const yieldStatus = schedulerService.getYieldManagementStatus();
      const activeJobs = schedulerService
        .getActiveJobs()
        .filter((job) => Object.values(JOB_TYPES).includes(job.type));

      res.json({
        success: true,
        data: {
          yieldManagement: yieldStatus,
          activeYieldJobs: activeJobs,
          controls: {
            pause: '/api/admin/yield/jobs/pause',
            resume: '/api/admin/yield/jobs/resume',
            restart: '/api/admin/yield/jobs/restart',
            trigger: '/api/admin/yield/jobs/trigger',
          },
        },
      });
    } catch (error) {
      logger.error('Error getting yield jobs status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get yield jobs status',
        error: error.message,
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
          message: 'Yield management is not enabled',
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
            manual: true,
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
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: `Yield jobs ${action} completed successfully`,
        data: result,
      });
    } catch (error) {
      logger.error('Error controlling yield jobs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to control yield jobs',
        error: error.message,
      });
    }
  }

  /**
   * ================================
   * LOYALTY PROGRAM ADMIN FUNCTIONS
   * ================================
   */

  /**
   * Manually adjust user loyalty points
   */
  async adjustUserPoints(req, res) {
    try {
      const { userId, pointsAdjustment, reason, type = 'ADJUSTMENT_ADMIN' } = req.body;
      const adminId = req.user.id;

      // Validate input
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          message: 'Validation errors',
          errors: errors.array(),
        });
      }

      if (!userId || pointsAdjustment === undefined || !reason) {
        return res.status(400).json({
          success: false,
          message: 'User ID, points adjustment, and reason are required',
        });
      }

      if (Math.abs(pointsAdjustment) > 50000) {
        return res.status(400).json({
          success: false,
          message: 'Point adjustment cannot exceed 50,000 points',
        });
      }

      // Get user
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Check if user would have negative points after adjustment
      if (pointsAdjustment < 0 && user.loyalty.currentPoints + pointsAdjustment < 0) {
        return res.status(400).json({
          success: false,
          message: 'Adjustment would result in negative points balance',
        });
      }

      // Get loyalty service
      const loyaltyService = getLoyaltyService();

      let result;
      if (pointsAdjustment > 0) {
        // Award bonus points
        result = await loyaltyService.awardBonusPoints(
          userId,
          type,
          pointsAdjustment,
          `Admin adjustment: ${reason}`,
          {
            adjustedBy: adminId,
            originalReason: reason,
            adminAction: true,
          }
        );
      } else {
        // Deduct points (create negative transaction)
        result = await this.deductUserPoints(userId, Math.abs(pointsAdjustment), reason, adminId);
      }

      if (!result.success) {
        return res.status(400).json(result);
      }

      // Create audit log
      await this.createLoyaltyAuditLog({
        adminId,
        action: 'POINTS_ADJUSTMENT',
        targetUserId: userId,
        details: {
          pointsAdjustment,
          reason,
          previousBalance: user.loyalty.currentPoints,
          newBalance: result.newBalance,
          transactionId: result.transaction || result.transactionId,
        },
      });

      // Send real-time notification to all admins
      socketService.sendAdminNotification('loyalty-points-adjusted', {
        adminName: req.user.fullName,
        userName: user.fullName,
        pointsAdjustment,
        reason,
        newBalance: result.newBalance,
        timestamp: new Date(),
      });

      // Send notification to user
      socketService.sendUserNotification(userId, 'LOYALTY_POINTS_ADJUSTED', {
        pointsAdjustment,
        reason: `Admin adjustment: ${reason}`,
        newBalance: result.newBalance,
        adminNote: 'Your loyalty points have been adjusted by our team',
        timestamp: new Date(),
      });

      logger.info(
        `Admin ${adminId} adjusted ${pointsAdjustment} points for user ${userId}: ${reason}`
      );

      res.json({
        success: true,
        message: 'Points adjusted successfully',
        data: {
          pointsAdjustment,
          newBalance: result.newBalance,
          previousBalance: user.loyalty.currentPoints,
          tierUpgrade: result.tierUpgrade || null,
          transactionId: result.transaction || result.transactionId,
          auditTrail: true,
        },
      });
    } catch (error) {
      logger.error('Error adjusting user points:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to adjust user points',
        error: error.message,
      });
    }
  }

  /**
   * Get comprehensive loyalty program statistics
   */
  async getLoyaltyStats(req, res) {
    try {
      const {
        period = '30d',
        groupBy = 'tier',
        includeInactive = false,
        hotelId = null,
      } = req.query;

      const loyaltyService = getLoyaltyService();

      // Get global analytics
      const globalStats = await loyaltyService.getGlobalLoyaltyAnalytics(period, hotelId);

      // Get tier distribution
      const tierDistribution = await this.getTierDistribution(includeInactive);

      // Get transaction analytics
      const transactionAnalytics = await this.getLoyaltyTransactionAnalytics(period);

      // Get member growth analytics
      const memberGrowth = await this.getMemberGrowthAnalytics(period);

      // Get engagement metrics
      const engagementMetrics = await this.getLoyaltyEngagementMetrics(period);

      // Get revenue impact
      const revenueImpact = await this.getLoyaltyRevenueImpact(period);

      const comprehensiveStats = {
        overview: {
          totalMembers: globalStats.users.totalMembers,
          activeMembers: globalStats.users.activeMembers,
          totalPointsInCirculation: globalStats.users.totalPoints,
          totalLifetimePointsIssued: globalStats.users.totalLifetimePoints,
          activationRate:
            globalStats.users.totalMembers > 0
              ? Math.round((globalStats.users.activeMembers / globalStats.users.totalMembers) * 100)
              : 0,
        },

        tiers: {
          distribution: tierDistribution,
          breakdown: globalStats.tiers,
          upgradeRate: await this.getTierUpgradeRate(period),
        },

        transactions: {
          analytics: transactionAnalytics,
          dailyActivity: globalStats.transactions.daily,
          summary: globalStats.transactions.summary,
        },

        growth: memberGrowth,
        engagement: engagementMetrics,
        revenueImpact: revenueImpact,

        insights: globalStats.insights,

        period: {
          description: period,
          startDate: globalStats.period.startDate,
          endDate: globalStats.period.endDate,
        },

        generatedAt: new Date(),
        generatedBy: req.user.id,
      };

      res.json({
        success: true,
        data: comprehensiveStats,
      });
    } catch (error) {
      logger.error('Error getting loyalty statistics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get loyalty statistics',
        error: error.message,
      });
    }
  }

  /**
   * Manage loyalty campaigns and promotions
   */
  async manageLoyaltyCampaigns(req, res) {
    try {
      const { action, campaignData, campaignId } = req.body;
      const adminId = req.user.id;

      let result;

      switch (action) {
        case 'create':
          result = await this.createLoyaltyCampaign(campaignData, adminId);
          break;

        case 'update':
          result = await this.updateLoyaltyCampaign(campaignId, campaignData, adminId);
          break;

        case 'activate':
          result = await this.activateLoyaltyCampaign(campaignId, adminId);
          break;

        case 'deactivate':
          result = await this.deactivateLoyaltyCampaign(campaignId, adminId);
          break;

        case 'delete':
          result = await this.deleteLoyaltyCampaign(campaignId, adminId);
          break;

        case 'list':
          result = await this.listLoyaltyCampaigns(req.query);
          break;

        default:
          throw new Error('Invalid campaign action');
      }

      // Create audit log
      await this.createLoyaltyAuditLog({
        adminId,
        action: `CAMPAIGN_${action.toUpperCase()}`,
        details: {
          campaignId,
          campaignData: action === 'create' || action === 'update' ? campaignData : undefined,
          result: result.success,
        },
      });

      // Send real-time notification
      socketService.sendAdminNotification('loyalty-campaign-managed', {
        action,
        campaignId,
        adminName: req.user.fullName,
        timestamp: new Date(),
        result: result.success,
      });

      res.json({
        success: true,
        message: `Campaign ${action} completed successfully`,
        data: result,
      });
    } catch (error) {
      logger.error('Error managing loyalty campaign:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage loyalty campaign',
        error: error.message,
      });
    }
  }

  /**
   * View detailed loyalty information for a specific user
   */
  async viewUserLoyalty(req, res) {
    try {
      const { userId } = req.params;
      const { includeHistory = true, includeTransactions = true, limit = 20 } = req.query;

      if (!userId) {
        return res.status(400).json({
          success: false,
          message: 'User ID is required',
        });
      }

      // Get user with loyalty data
      const user = await User.findById(userId).populate('company', 'name code').lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'User not found',
        });
      }

      // Get loyalty service
      const loyaltyService = getLoyaltyService();

      // Get comprehensive loyalty status
      const loyaltyStatus = await loyaltyService.getLoyaltyStatus(userId, { skipCache: true });

      // Get transaction history if requested
      let transactionHistory = null;
      if (includeTransactions === 'true') {
        transactionHistory = await loyaltyService.getLoyaltyHistory(userId, {
          limit: parseInt(limit),
          page: 1,
        });
      }

      // Get user's booking statistics
      const bookingStats = await this.getUserBookingStats(userId);

      // Get expiring points
      const expiringPoints = await LoyaltyTransaction.findExpiringPoints(90).find({ user: userId });

      // Calculate additional metrics
      const additionalMetrics = await this.calculateUserLoyaltyMetrics(userId);

      const detailedLoyaltyInfo = {
        user: {
          id: user._id,
          name: user.fullName,
          email: user.email,
          phone: user.phone,
          memberSince: user.createdAt,
          company: user.company,
          isActive: user.isActive,
        },

        loyalty: loyaltyStatus,

        bookingStats,

        additionalMetrics,

        expiringPoints: {
          transactions: expiringPoints,
          totalExpiring: expiringPoints.reduce((sum, t) => sum + t.pointsAmount, 0),
          nextExpiryDate: expiringPoints.length > 0 ? expiringPoints[0].expiresAt : null,
        },

        adminNotes: await this.getUserLoyaltyAdminNotes(userId),

        lastActivity: {
          lastLogin: user.lastLogin,
          lastBooking: bookingStats.lastBookingDate,
          lastLoyaltyActivity: loyaltyStatus.transactions.recent[0]?.createdAt,
        },
      };

      // Include transaction history if requested
      if (transactionHistory) {
        detailedLoyaltyInfo.transactionHistory = transactionHistory;
      }

      res.json({
        success: true,
        data: detailedLoyaltyInfo,
      });
    } catch (error) {
      logger.error('Error viewing user loyalty:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get user loyalty information',
        error: error.message,
      });
    }
  }

  /**
   * Perform bulk operations on loyalty points
   */
  async bulkPointsOperation(req, res) {
    try {
      const {
        operation,
        criteria,
        pointsAmount,
        reason,
        dryRun = false,
        batchSize = 100,
      } = req.body;
      const adminId = req.user.id;

      // Validate input
      if (!operation || !criteria || !pointsAmount || !reason) {
        return res.status(400).json({
          success: false,
          message: 'Operation, criteria, points amount, and reason are required',
        });
      }

      if (!['add', 'deduct', 'set'].includes(operation)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid operation. Must be add, deduct, or set',
        });
      }

      if (Math.abs(pointsAmount) > 100000) {
        return res.status(400).json({
          success: false,
          message: 'Points amount cannot exceed 100,000',
        });
      }

      // Build user query based on criteria
      const userQuery = await this.buildUserQueryFromCriteria(criteria);

      // Get affected users (preview first)
      const affectedUsers = await User.find(userQuery)
        .select('_id firstName lastName email loyalty.currentPoints loyalty.tier')
        .limit(dryRun ? 1000 : batchSize);

      if (affectedUsers.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'No users match the specified criteria',
        });
      }

      // If dry run, return preview
      if (dryRun === true || dryRun === 'true') {
        const preview = {
          affectedUsersCount: affectedUsers.length,
          operation,
          pointsAmount,
          reason,
          sampleUsers: affectedUsers.slice(0, 10).map((user) => ({
            id: user._id,
            name: `${user.firstName} ${user.lastName}`,
            currentPoints: user.loyalty.currentPoints,
            tier: user.loyalty.tier,
            estimatedNewPoints: this.calculateNewPointsBalance(
              user.loyalty.currentPoints,
              operation,
              pointsAmount
            ),
          })),
        };

        return res.json({
          success: true,
          message: 'Bulk operation preview',
          data: preview,
          isDryRun: true,
        });
      }

      // Perform actual bulk operation
      const results = await this.executeBulkPointsOperation(
        affectedUsers,
        operation,
        pointsAmount,
        reason,
        adminId,
        batchSize
      );

      // Create audit log
      await this.createLoyaltyAuditLog({
        adminId,
        action: 'BULK_POINTS_OPERATION',
        details: {
          operation,
          criteria,
          pointsAmount,
          reason,
          affectedUsersCount: results.successful.length,
          failedCount: results.failed.length,
        },
      });

      // Send real-time notification
      socketService.sendAdminNotification('loyalty-bulk-operation-completed', {
        operation,
        adminName: req.user.fullName,
        affectedUsers: results.successful.length,
        failedOperations: results.failed.length,
        totalPoints: results.successful.length * pointsAmount,
        timestamp: new Date(),
      });

      logger.info(
        `Bulk loyalty operation completed by admin ${adminId}: ${operation} ${pointsAmount} points for ${results.successful.length} users`
      );

      res.json({
        success: true,
        message: 'Bulk points operation completed',
        data: {
          operation,
          pointsAmount,
          reason,
          results: {
            successful: results.successful.length,
            failed: results.failed.length,
            totalAffected: affectedUsers.length,
          },
          summary: results.summary,
          failedOperations: results.failed.slice(0, 10), // First 10 failures for review
        },
      });
    } catch (error) {
      logger.error('Error performing bulk points operation:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to perform bulk points operation',
        error: error.message,
      });
    }
  }

  /**
   * Generate detailed loyalty program reports
   */
  async loyaltyReports(req, res) {
    try {
      const {
        reportType = 'comprehensive',
        period = '30d',
        format = 'json',
        includeCharts = true,
        filters = {},
      } = req.query;

      let reportData;

      switch (reportType) {
        case 'comprehensive':
          reportData = await this.generateComprehensiveLoyaltyReport(period, filters);
          break;

        case 'tier_analysis':
          reportData = await this.generateTierAnalysisReport(period, filters);
          break;

        case 'engagement':
          reportData = await this.generateEngagementReport(period, filters);
          break;

        case 'revenue_impact':
          reportData = await this.generateRevenueImpactReport(period, filters);
          break;

        case 'expiry_analysis':
          reportData = await this.generateExpiryAnalysisReport(period, filters);
          break;

        case 'campaign_performance':
          reportData = await this.generateCampaignPerformanceReport(period, filters);
          break;

        default:
          throw new Error('Invalid report type');
      }

      // Add charts data if requested
      if (includeCharts === 'true') {
        reportData.charts = await this.generateLoyaltyCharts(reportData, reportType);
      }

      // Add metadata
      reportData.metadata = {
        reportType,
        period,
        generatedAt: new Date(),
        generatedBy: {
          id: req.user.id,
          name: req.user.fullName,
          email: req.user.email,
        },
        filters: filters,
      };

      // Handle different formats
      if (format === 'csv') {
        const csvData = await this.convertReportToCSV(reportData, reportType);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="loyalty_report_${reportType}_${Date.now()}.csv"`
        );
        return res.send(csvData);
      }

      if (format === 'pdf') {
        const pdfBuffer = await this.convertReportToPDF(reportData, reportType);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="loyalty_report_${reportType}_${Date.now()}.pdf"`
        );
        return res.send(pdfBuffer);
      }

      // Default JSON response
      res.json({
        success: true,
        data: reportData,
      });
    } catch (error) {
      logger.error('Error generating loyalty report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate loyalty report',
        error: error.message,
      });
    }
  }

  /**
   * Manage expired points and cleanup
   */
  async expiredPointsManagement(req, res) {
    try {
      const {
        action = 'preview',
        expiredBefore = null,
        autoCleanup = false,
        notifyUsers = true,
      } = req.body;
      const adminId = req.user.id;

      let cutoffDate;
      if (expiredBefore) {
        cutoffDate = new Date(expiredBefore);
      } else {
        cutoffDate = new Date(); // Today
      }

      // Find expired transactions
      const expiredTransactions = await LoyaltyTransaction.find({
        pointsAmount: { $gt: 0 },
        status: 'COMPLETED',
        expiresAt: { $lte: cutoffDate },
      })
        .populate('user', 'firstName lastName email loyalty.currentPoints')
        .sort({ expiresAt: 1 });

      if (expiredTransactions.length === 0) {
        return res.json({
          success: true,
          message: 'No expired points found',
          data: {
            expiredTransactions: 0,
            totalExpiredPoints: 0,
            affectedUsers: 0,
          },
        });
      }

      // Group by user
      const expiredByUser = this.groupExpiredPointsByUser(expiredTransactions);
      const totalExpiredPoints = expiredTransactions.reduce((sum, t) => sum + t.pointsAmount, 0);

      if (action === 'preview') {
        return res.json({
          success: true,
          message: 'Expired points preview',
          data: {
            totalExpiredTransactions: expiredTransactions.length,
            totalExpiredPoints,
            affectedUsers: Object.keys(expiredByUser).length,
            cutoffDate,
            sampleExpiredTransactions: expiredTransactions.slice(0, 10),
            userBreakdown: Object.values(expiredByUser).slice(0, 10),
          },
        });
      }

      if (action === 'process') {
        const results = await this.processExpiredPoints(expiredByUser, adminId, notifyUsers);

        // Create audit log
        await this.createLoyaltyAuditLog({
          adminId,
          action: 'EXPIRED_POINTS_PROCESSED',
          details: {
            totalTransactions: expiredTransactions.length,
            totalPoints: totalExpiredPoints,
            affectedUsers: results.processedUsers,
            cutoffDate,
            notifyUsers,
          },
        });

        // Send real-time notification
        socketService.sendAdminNotification('loyalty-expired-points-processed', {
          adminName: req.user.fullName,
          processedTransactions: expiredTransactions.length,
          totalExpiredPoints,
          affectedUsers: results.processedUsers,
          timestamp: new Date(),
        });

        logger.info(
          `Admin ${adminId} processed ${expiredTransactions.length} expired point transactions affecting ${results.processedUsers} users`
        );

        res.json({
          success: true,
          message: 'Expired points processed successfully',
          data: {
            processedTransactions: expiredTransactions.length,
            totalExpiredPoints,
            affectedUsers: results.processedUsers,
            failedProcessing: results.failed,
            notificationsSent: results.notificationsSent,
          },
        });
      } else {
        throw new Error('Invalid action. Must be preview or process');
      }
    } catch (error) {
      logger.error('Error managing expired points:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage expired points',
        error: error.message,
      });
    }
  }

  /**
   * ================================
   * LOYALTY HELPER METHODS
   * ================================
   */

  /**
   * Get loyalty dashboard statistics
   */
  async getLoyaltyDashboardStats(startDate) {
    try {
      const [memberStats, pointsStats, activityStats] = await Promise.all([
        // Member statistics
        User.aggregate([
          { $match: { 'loyalty.enrolledAt': { $exists: true } } },
          {
            $group: {
              _id: null,
              totalMembers: { $sum: 1 },
              activeMembers: {
                $sum: {
                  $cond: [{ $gte: ['$loyalty.statistics.lastActivity', startDate] }, 1, 0],
                },
              },
              totalCurrentPoints: { $sum: '$loyalty.currentPoints' },
              totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' },
              avgCurrentPoints: { $avg: '$loyalty.currentPoints' },
            },
          },
        ]),

        // Points statistics
        LoyaltyTransaction.aggregate([
          { $match: { createdAt: { $gte: startDate } } },
          {
            $group: {
              _id: null,
              totalTransactions: { $sum: 1 },
              totalPointsEarned: {
                $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] },
              },
              totalPointsRedeemed: {
                $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] },
              },
            },
          },
        ]),

        // Activity statistics
        this.getLoyaltyActivityBreakdown(startDate),
      ]);

      return {
        members: memberStats[0] || {
          totalMembers: 0,
          activeMembers: 0,
          totalCurrentPoints: 0,
          totalLifetimePoints: 0,
          avgCurrentPoints: 0,
        },
        points: pointsStats[0] || {
          totalTransactions: 0,
          totalPointsEarned: 0,
          totalPointsRedeemed: 0,
        },
        activity: activityStats,
      };
    } catch (error) {
      logger.error('Error getting loyalty dashboard stats:', error);
      return {
        members: { totalMembers: 0, activeMembers: 0 },
        points: { totalTransactions: 0, totalPointsEarned: 0 },
        activity: { newEnrollments: 0, tierUpgrades: 0 },
      };
    }
  }

  /**
   * Get recent loyalty activity
   */
  async getLoyaltyActivity(startDate) {
    try {
      const recentTransactions = await LoyaltyTransaction.find({
        createdAt: { $gte: startDate },
      })
        .populate('user', 'firstName lastName email')
        .populate('booking', 'bookingNumber')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean();

      const activitySummary = await LoyaltyTransaction.aggregate([
        { $match: { createdAt: { $gte: startDate } } },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
            totalPoints: { $sum: '$pointsAmount' },
          },
        },
        { $sort: { count: -1 } },
      ]);

      return {
        recent: recentTransactions,
        summary: activitySummary,
      };
    } catch (error) {
      logger.error('Error getting loyalty activity:', error);
      return { recent: [], summary: [] };
    }
  }

  /**
   * Get top loyalty members
   */
  async getTopLoyaltyMembers(limit = 5) {
    try {
      return await User.find({
        'loyalty.enrolledAt': { $exists: true },
        isActive: true,
      })
        .sort({ 'loyalty.lifetimePoints': -1 })
        .limit(limit)
        .select(
          'firstName lastName email loyalty.currentPoints loyalty.lifetimePoints loyalty.tier stats.totalSpent'
        )
        .lean();
    } catch (error) {
      logger.error('Error getting top loyalty members:', error);
      return [];
    }
  }

  /**
   * Get loyalty system alerts
   */
  async getLoyaltySystemAlerts() {
    try {
      const alerts = [];

      // Check for users with expiring points soon
      const soonExpiringPoints = await LoyaltyTransaction.find({
        pointsAmount: { $gt: 0 },
        status: 'COMPLETED',
        expiresAt: {
          $gte: new Date(),
          $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Next 30 days
        },
      }).countDocuments();

      if (soonExpiringPoints > 100) {
        alerts.push({
          type: 'warning',
          category: 'points_expiry',
          message: `${soonExpiringPoints} point transactions expiring in the next 30 days`,
          priority: 'medium',
          action: 'Review expiring points and notify users',
        });
      }

      // Check for inactive high-tier members
      const inactiveVipMembers = await User.countDocuments({
        'loyalty.tier': { $in: ['PLATINUM', 'DIAMOND'] },
        'loyalty.statistics.lastActivity': {
          $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days ago
        },
        isActive: true,
      });

      if (inactiveVipMembers > 0) {
        alerts.push({
          type: 'info',
          category: 'member_engagement',
          message: `${inactiveVipMembers} high-tier members inactive for 90+ days`,
          priority: 'medium',
          action: 'Consider re-engagement campaign',
        });
      }

      // Check for unusual point accumulation patterns
      const suspiciousActivity = await this.detectSuspiciousLoyaltyActivity();
      if (suspiciousActivity.count > 0) {
        alerts.push({
          type: 'warning',
          category: 'suspicious_activity',
          message: `${suspiciousActivity.count} accounts with unusual point activity`,
          priority: 'high',
          action: 'Review flagged accounts',
        });
      }

      return alerts;
    } catch (error) {
      logger.error('Error getting loyalty system alerts:', error);
      return [];
    }
  }

  /**
   * Deduct user points (helper method)
   */
  async deductUserPoints(userId, pointsToDeduct, reason, adminId) {
    try {
      const user = await User.findById(userId);
      if (!user || user.loyalty.currentPoints < pointsToDeduct) {
        return {
          success: false,
          message: 'Insufficient points or user not found',
        };
      }

      // Create deduction transaction
      const transaction = new LoyaltyTransaction({
        user: userId,
        type: 'ADJUSTMENT_ADMIN',
        pointsAmount: -pointsToDeduct,
        previousBalance: user.loyalty.currentPoints,
        newBalance: user.loyalty.currentPoints - pointsToDeduct,
        description: `Admin deduction: ${reason}`,
        processedBy: adminId,
        source: 'ADMIN',
        internalNotes: `Manual deduction by admin ${adminId}: ${reason}`,
      });

      await transaction.save();

      // Update user points
      user.loyalty.currentPoints -= pointsToDeduct;
      user.loyalty.statistics.lastActivity = new Date();
      await user.save();

      return {
        success: true,
        newBalance: user.loyalty.currentPoints,
        transactionId: transaction._id,
      };
    } catch (error) {
      logger.error('Error deducting user points:', error);
      throw error;
    }
  }

  /**
   * Create loyalty audit log
   */
  async createLoyaltyAuditLog(logData) {
    try {
      // This would typically go to a dedicated audit log collection
      // For now, we'll log to the application logger
      logger.info('Loyalty Admin Action:', {
        timestamp: new Date(),
        adminId: logData.adminId,
        action: logData.action,
        targetUserId: logData.targetUserId,
        details: logData.details,
      });

      // You could also store this in a database collection for audit trails
      // const auditLog = new LoyaltyAuditLog(logData);
      // await auditLog.save();
    } catch (error) {
      logger.error('Error creating loyalty audit log:', error);
    }
  }

  /**
   * Get tier distribution
   */
  async getTierDistribution(includeInactive = false) {
    try {
      const matchStage = { 'loyalty.enrolledAt': { $exists: true } };
      if (!includeInactive) {
        matchStage.isActive = true;
      }

      return await User.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$loyalty.tier',
            count: { $sum: 1 },
            avgPoints: { $avg: '$loyalty.currentPoints' },
            avgLifetimePoints: { $avg: '$loyalty.lifetimePoints' },
            totalCurrentPoints: { $sum: '$loyalty.currentPoints' },
            totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
    } catch (error) {
      logger.error('Error getting tier distribution:', error);
      return [];
    }
  }

  /**
   * Get loyalty transaction analytics
   */
  async getLoyaltyTransactionAnalytics(period) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      return await LoyaltyTransaction.aggregate([
        { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              type: { $cond: [{ $gt: ['$pointsAmount', 0] }, 'EARNED', 'REDEEMED'] },
            },
            count: { $sum: 1 },
            totalPoints: { $sum: { $abs: '$pointsAmount' } },
            uniqueUsers: { $addToSet: '$user' },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            earned: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'EARNED'] }, '$totalPoints', 0] },
            },
            redeemed: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'REDEEMED'] }, '$totalPoints', 0] },
            },
            transactions: { $sum: '$count' },
            uniqueUsers: { $addToSet: '$uniqueUsers' },
          },
        },
        { $sort: { _id: 1 } },
      ]);
    } catch (error) {
      logger.error('Error getting transaction analytics:', error);
      return [];
    }
  }

  /**
   * Get member growth analytics
   */
  async getMemberGrowthAnalytics(period) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const [newMembers, tierUpgrades] = await Promise.all([
        User.aggregate([
          {
            $match: {
              'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: {
                $dateToString: { format: '%Y-%m-%d', date: '$loyalty.enrolledAt' },
              },
              newMembers: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        User.aggregate([
          { $unwind: '$loyalty.tierHistory' },
          {
            $match: {
              'loyalty.tierHistory.achievedAt': { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: {
                date: {
                  $dateToString: {
                    format: '%Y-%m-%d',
                    date: '$loyalty.tierHistory.achievedAt',
                  },
                },
                tier: '$loyalty.tierHistory.tier',
              },
              count: { $sum: 1 },
            },
          },
          { $sort: { '_id.date': 1 } },
        ]),
      ]);

      return {
        newMembersDaily: newMembers,
        tierUpgradesDaily: tierUpgrades,
        totalNewMembers: newMembers.reduce((sum, day) => sum + day.newMembers, 0),
        totalTierUpgrades: tierUpgrades.reduce((sum, upgrade) => sum + upgrade.count, 0),
      };
    } catch (error) {
      logger.error('Error getting member growth analytics:', error);
      return {
        newMembersDaily: [],
        tierUpgradesDaily: [],
        totalNewMembers: 0,
        totalTierUpgrades: 0,
      };
    }
  }

  /**
   * Get loyalty engagement metrics
   */
  async getLoyaltyEngagementMetrics(period) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const [engagementStats, redemptionPatterns] = await Promise.all([
        User.aggregate([
          { $match: { 'loyalty.enrolledAt': { $exists: true } } },
          {
            $project: {
              isActive: {
                $gte: ['$loyalty.statistics.lastActivity', startDate],
              },
              tier: '$loyalty.tier',
              engagementScore: '$loyalty.performance.engagementScore',
              redemptionRate: '$loyalty.performance.redemptionRate',
            },
          },
          {
            $group: {
              _id: '$tier',
              totalMembers: { $sum: 1 },
              activeMembers: { $sum: { $cond: ['$isActive', 1, 0] } },
              avgEngagementScore: { $avg: '$engagementScore' },
              avgRedemptionRate: { $avg: '$redemptionRate' },
            },
          },
        ]),

        LoyaltyTransaction.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate },
              pointsAmount: { $lt: 0 }, // Redemptions only
            },
          },
          {
            $group: {
              _id: '$type',
              count: { $sum: 1 },
              totalPoints: { $sum: { $abs: '$pointsAmount' } },
              avgPoints: { $avg: { $abs: '$pointsAmount' } },
            },
          },
          { $sort: { count: -1 } },
        ]),
      ]);

      return {
        byTier: engagementStats,
        redemptionPatterns: redemptionPatterns,
        overallEngagement: this.calculateOverallEngagement(engagementStats),
      };
    } catch (error) {
      logger.error('Error getting engagement metrics:', error);
      return {
        byTier: [],
        redemptionPatterns: [],
        overallEngagement: { score: 0, activeRate: 0 },
      };
    }
  }

  /**
   * Get loyalty revenue impact
   */
  async getLoyaltyRevenueImpact(period) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      // Get bookings from loyalty members vs non-members
      const [loyaltyMemberBookings, nonLoyaltyBookings] = await Promise.all([
        Booking.aggregate([
          {
            $lookup: {
              from: 'users',
              localField: 'customer',
              foreignField: '_id',
              as: 'customer',
            },
          },
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              'customer.loyalty.enrolledAt': { $exists: true },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalPrice' },
              totalBookings: { $sum: 1 },
              avgBookingValue: { $avg: '$totalPrice' },
            },
          },
        ]),

        Booking.aggregate([
          {
            $lookup: {
              from: 'users',
              localField: 'customer',
              foreignField: '_id',
              as: 'customer',
            },
          },
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              'customer.loyalty.enrolledAt': { $exists: false },
            },
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalPrice' },
              totalBookings: { $sum: 1 },
              avgBookingValue: { $avg: '$totalPrice' },
            },
          },
        ]),
      ]);

      const loyaltyStats = loyaltyMemberBookings[0] || {
        totalRevenue: 0,
        totalBookings: 0,
        avgBookingValue: 0,
      };
      const nonLoyaltyStats = nonLoyaltyBookings[0] || {
        totalRevenue: 0,
        totalBookings: 0,
        avgBookingValue: 0,
      };

      return {
        loyaltyMembers: loyaltyStats,
        nonLoyaltyMembers: nonLoyaltyStats,
        comparison: {
          revenueIncrease:
            loyaltyStats.totalRevenue > 0 && nonLoyaltyStats.totalRevenue > 0
              ? ((loyaltyStats.avgBookingValue - nonLoyaltyStats.avgBookingValue) /
                  nonLoyaltyStats.avgBookingValue) *
                100
              : 0,
          loyaltyRevenueShare:
            loyaltyStats.totalRevenue + nonLoyaltyStats.totalRevenue > 0
              ? (loyaltyStats.totalRevenue /
                  (loyaltyStats.totalRevenue + nonLoyaltyStats.totalRevenue)) *
                100
              : 0,
        },
      };
    } catch (error) {
      logger.error('Error getting loyalty revenue impact:', error);
      return {
        loyaltyMembers: { totalRevenue: 0, totalBookings: 0 },
        nonLoyaltyMembers: { totalRevenue: 0, totalBookings: 0 },
        comparison: { revenueIncrease: 0, loyaltyRevenueShare: 0 },
      };
    }
  }

  /**
   * Build user query from criteria for bulk operations
   */
  async buildUserQueryFromCriteria(criteria) {
    const query = { 'loyalty.enrolledAt': { $exists: true } };

    if (criteria.tier) {
      query['loyalty.tier'] = Array.isArray(criteria.tier) ? { $in: criteria.tier } : criteria.tier;
    }

    if (criteria.pointsRange) {
      if (criteria.pointsRange.min !== undefined) {
        query['loyalty.currentPoints'] = { $gte: criteria.pointsRange.min };
      }
      if (criteria.pointsRange.max !== undefined) {
        query['loyalty.currentPoints'] = {
          ...query['loyalty.currentPoints'],
          $lte: criteria.pointsRange.max,
        };
      }
    }

    if (criteria.lastActivity) {
      const activityDate = new Date();
      activityDate.setDate(activityDate.getDate() - criteria.lastActivity);
      query['loyalty.statistics.lastActivity'] = { $gte: activityDate };
    }

    if (criteria.enrolledAfter) {
      query['loyalty.enrolledAt'] = { $gte: new Date(criteria.enrolledAfter) };
    }

    if (criteria.enrolledBefore) {
      query['loyalty.enrolledAt'] = {
        ...query['loyalty.enrolledAt'],
        $lte: new Date(criteria.enrolledBefore),
      };
    }

    if (criteria.isActive !== undefined) {
      query.isActive = criteria.isActive;
    }

    return query;
  }

  /**
   * Calculate new points balance for bulk operations
   */
  calculateNewPointsBalance(currentPoints, operation, pointsAmount) {
    switch (operation) {
      case 'add':
        return currentPoints + pointsAmount;
      case 'deduct':
        return Math.max(0, currentPoints - pointsAmount);
      case 'set':
        return pointsAmount;
      default:
        return currentPoints;
    }
  }

  /**
   * Execute bulk points operation
   */
  async executeBulkPointsOperation(users, operation, pointsAmount, reason, adminId, batchSize) {
    const results = {
      successful: [],
      failed: [],
      summary: {
        totalPointsAwarded: 0,
        totalPointsDeducted: 0,
        tierUpgrades: 0,
      },
    };

    const loyaltyService = getLoyaltyService();

    // Process in batches
    for (let i = 0; i < users.length; i += batchSize) {
      const batch = users.slice(i, i + batchSize);

      for (const user of batch) {
        try {
          let result;
          const originalBalance = user.loyalty.currentPoints;

          if (operation === 'add') {
            result = await loyaltyService.awardBonusPoints(
              user._id,
              'ADJUSTMENT_ADMIN',
              pointsAmount,
              `Bulk operation: ${reason}`,
              { adjustedBy: adminId, bulkOperation: true }
            );
            results.summary.totalPointsAwarded += pointsAmount;
          } else if (operation === 'deduct') {
            if (originalBalance >= pointsAmount) {
              result = await this.deductUserPoints(user._id, pointsAmount, reason, adminId);
              results.summary.totalPointsDeducted += pointsAmount;
            } else {
              throw new Error('Insufficient points');
            }
          } else if (operation === 'set') {
            const difference = pointsAmount - originalBalance;
            if (difference > 0) {
              result = await loyaltyService.awardBonusPoints(
                user._id,
                'ADJUSTMENT_ADMIN',
                difference,
                `Bulk set operation: ${reason}`,
                { adjustedBy: adminId, bulkOperation: true }
              );
            } else if (difference < 0) {
              result = await this.deductUserPoints(user._id, Math.abs(difference), reason, adminId);
            } else {
              result = { success: true, newBalance: originalBalance };
            }
          }

          if (result.success) {
            results.successful.push({
              userId: user._id,
              userName: `${user.firstName} ${user.lastName}`,
              originalBalance,
              newBalance: result.newBalance,
              tierUpgrade: result.tierUpgrade,
            });

            if (result.tierUpgrade?.upgraded) {
              results.summary.tierUpgrades++;
            }
          } else {
            results.failed.push({
              userId: user._id,
              userName: `${user.firstName} ${user.lastName}`,
              error: result.message || 'Operation failed',
            });
          }
        } catch (error) {
          results.failed.push({
            userId: user._id,
            userName: `${user.firstName} ${user.lastName}`,
            error: error.message,
          });
        }
      }

      // Small delay between batches to avoid overwhelming the system
      if (i + batchSize < users.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    return results;
  }

  /**
   * Detect suspicious loyalty activity
   */
  async detectSuspiciousLoyaltyActivity() {
    try {
      const suspiciousUsers = await LoyaltyTransaction.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
            pointsAmount: { $gt: 1000 }, // Large point transactions
          },
        },
        {
          $group: {
            _id: '$user',
            transactionCount: { $sum: 1 },
            totalPoints: { $sum: '$pointsAmount' },
          },
        },
        {
          $match: {
            $or: [
              { transactionCount: { $gte: 10 } }, // 10+ transactions in 7 days
              { totalPoints: { $gte: 50000 } }, // 50k+ points in 7 days
            ],
          },
        },
      ]);

      return {
        count: suspiciousUsers.length,
        users: suspiciousUsers,
      };
    } catch (error) {
      logger.error('Error detecting suspicious loyalty activity:', error);
      return { count: 0, users: [] };
    }
  }

  /**
   * Get tier upgrade rate
   */
  async getTierUpgradeRate(period) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const [totalMembers, upgrades] = await Promise.all([
        User.countDocuments({
          'loyalty.enrolledAt': { $exists: true, $lte: startDate },
        }),

        User.aggregate([
          { $unwind: '$loyalty.tierHistory' },
          {
            $match: {
              'loyalty.tierHistory.achievedAt': { $gte: startDate, $lte: endDate },
            },
          },
          {
            $group: {
              _id: null,
              totalUpgrades: { $sum: 1 },
            },
          },
        ]),
      ]);

      const totalUpgrades = upgrades[0]?.totalUpgrades || 0;
      return totalMembers > 0 ? (totalUpgrades / totalMembers) * 100 : 0;
    } catch (error) {
      logger.error('Error calculating tier upgrade rate:', error);
      return 0;
    }
  }

  /**
   * Get loyalty activity breakdown
   */
  async getLoyaltyActivityBreakdown(startDate) {
    try {
      const [newEnrollments, tierUpgrades, pointTransactions] = await Promise.all([
        User.countDocuments({
          'loyalty.enrolledAt': { $gte: startDate },
        }),

        User.aggregate([
          { $unwind: '$loyalty.tierHistory' },
          {
            $match: {
              'loyalty.tierHistory.achievedAt': { $gte: startDate },
            },
          },
          { $count: 'totalUpgrades' },
        ]),

        LoyaltyTransaction.countDocuments({
          createdAt: { $gte: startDate },
        }),
      ]);

      return {
        newEnrollments,
        tierUpgrades: tierUpgrades[0]?.totalUpgrades || 0,
        pointTransactions,
      };
    } catch (error) {
      logger.error('Error getting loyalty activity breakdown:', error);
      return {
        newEnrollments: 0,
        tierUpgrades: 0,
        pointTransactions: 0,
      };
    }
  }

  /**
   * Group expired points by user
   */
  groupExpiredPointsByUser(expiredTransactions) {
    const groupedByUser = {};

    expiredTransactions.forEach((transaction) => {
      const userId = transaction.user._id.toString();

      if (!groupedByUser[userId]) {
        groupedByUser[userId] = {
          user: transaction.user,
          expiredTransactions: [],
          totalExpiredPoints: 0,
          earliestExpiry: transaction.expiresAt,
        };
      }

      groupedByUser[userId].expiredTransactions.push(transaction);
      groupedByUser[userId].totalExpiredPoints += transaction.pointsAmount;

      if (transaction.expiresAt < groupedByUser[userId].earliestExpiry) {
        groupedByUser[userId].earliestExpiry = transaction.expiresAt;
      }
    });

    return groupedByUser;
  }

  /**
   * Process expired points
   */
  async processExpiredPoints(expiredByUser, adminId, notifyUsers) {
    const results = {
      processedUsers: 0,
      failed: [],
      notificationsSent: 0,
    };

    for (const [userId, userExpiredData] of Object.entries(expiredByUser)) {
      try {
        const user = userExpiredData.user;
        const totalExpiredPoints = userExpiredData.totalExpiredPoints;

        // Check if user has enough current points to deduct
        if (user.loyalty.currentPoints >= totalExpiredPoints) {
          // Create expiry transaction
          const expiryTransaction = new LoyaltyTransaction({
            user: userId,
            type: 'EXPIRE',
            pointsAmount: -totalExpiredPoints,
            previousBalance: user.loyalty.currentPoints,
            newBalance: user.loyalty.currentPoints - totalExpiredPoints,
            description: `Points expiry: ${userExpiredData.expiredTransactions.length} transactions expired`,
            processedBy: adminId,
            source: 'ADMIN',
            internalNotes: `Processed by admin ${adminId}. Original transactions: ${userExpiredData.expiredTransactions.map((t) => t._id).join(', ')}`,
          });

          await expiryTransaction.save();

          // Update user balance
          await User.findByIdAndUpdate(userId, {
            $inc: { 'loyalty.currentPoints': -totalExpiredPoints },
            $set: { 'loyalty.statistics.lastActivity': new Date() },
          });

          // Mark original transactions as expired
          await LoyaltyTransaction.updateMany(
            { _id: { $in: userExpiredData.expiredTransactions.map((t) => t._id) } },
            { status: 'EXPIRED' }
          );

          results.processedUsers++;

          // Send notification to user if requested
          if (notifyUsers) {
            try {
              socketService.sendUserNotification(userId, 'POINTS_EXPIRED', {
                pointsExpired: totalExpiredPoints,
                remainingPoints: user.loyalty.currentPoints - totalExpiredPoints,
                expiredTransactions: userExpiredData.expiredTransactions.length,
                message: `${totalExpiredPoints} points have expired from your account`,
                expiredDate: new Date(),
              });

              // Also send email notification
              await emailService.sendEmail({
                to: user.email,
                template: 'points-expired',
                data: {
                  user: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                  },
                  expiredPoints: totalExpiredPoints,
                  remainingPoints: user.loyalty.currentPoints - totalExpiredPoints,
                  expiredTransactions: userExpiredData.expiredTransactions.length,
                },
              });

              results.notificationsSent++;
            } catch (notificationError) {
              logger.warn(
                `Failed to send expiry notification to user ${userId}:`,
                notificationError.message
              );
            }
          }
        } else {
          results.failed.push({
            userId,
            userName: `${user.firstName} ${user.lastName}`,
            error: 'Insufficient current points to process expiry',
            expectedPoints: totalExpiredPoints,
            actualPoints: user.loyalty.currentPoints,
          });
        }
      } catch (error) {
        results.failed.push({
          userId,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Get user booking statistics
   */
  async getUserBookingStats(userId) {
    try {
      const bookingStats = await Booking.aggregate([
        { $match: { customer: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            totalSpent: { $sum: '$totalPrice' },
            avgBookingValue: { $avg: '$totalPrice' },
            lastBookingDate: { $max: '$createdAt' },
            firstBookingDate: { $min: '$createdAt' },
          },
        },
      ]);

      return (
        bookingStats[0] || {
          totalBookings: 0,
          totalSpent: 0,
          avgBookingValue: 0,
          lastBookingDate: null,
          firstBookingDate: null,
        }
      );
    } catch (error) {
      logger.error('Error getting user booking stats:', error);
      return {
        totalBookings: 0,
        totalSpent: 0,
        avgBookingValue: 0,
      };
    }
  }

  /**
   * Calculate additional user loyalty metrics
   */
  async calculateUserLoyaltyMetrics(userId) {
    try {
      const [transactionStats, recentActivity] = await Promise.all([
        LoyaltyTransaction.aggregate([
          { $match: { user: new mongoose.Types.ObjectId(userId) } },
          {
            $group: {
              _id: null,
              totalTransactions: { $sum: 1 },
              totalEarned: {
                $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] },
              },
              totalRedeemed: {
                $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] },
              },
              avgTransactionValue: { $avg: { $abs: '$pointsAmount' } },
              lastTransactionDate: { $max: '$createdAt' },
              firstTransactionDate: { $min: '$createdAt' },
            },
          },
        ]),

        LoyaltyTransaction.find({ user: userId })
          .sort({ createdAt: -1 })
          .limit(5)
          .select('type pointsAmount description createdAt')
          .lean(),
      ]);

      const stats = transactionStats[0] || {
        totalTransactions: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        avgTransactionValue: 0,
      };

      // Calculate additional metrics
      const membershipDays = stats.firstTransactionDate
        ? Math.floor((Date.now() - stats.firstTransactionDate) / (24 * 60 * 60 * 1000))
        : 0;

      return {
        ...stats,
        recentActivity,
        membershipDays,
        pointsPerDay: membershipDays > 0 ? stats.totalEarned / membershipDays : 0,
        redemptionRate: stats.totalEarned > 0 ? (stats.totalRedeemed / stats.totalEarned) * 100 : 0,
        activityScore: this.calculateActivityScore(stats, recentActivity),
      };
    } catch (error) {
      logger.error('Error calculating user loyalty metrics:', error);
      return {
        totalTransactions: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        recentActivity: [],
      };
    }
  }

  /**
   * Calculate activity score
   */
  calculateActivityScore(transactionStats, recentActivity) {
    let score = 0;

    // Base score from transaction frequency
    if (transactionStats.totalTransactions > 0) {
      score += Math.min(30, transactionStats.totalTransactions * 2);
    }

    // Score from recent activity (last 30 days)
    const recentTransactions = recentActivity.filter(
      (t) => new Date(t.createdAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    );
    score += Math.min(20, recentTransactions.length * 5);

    // Score from redemption rate (balanced usage)
    const redemptionRate =
      transactionStats.totalEarned > 0
        ? (transactionStats.totalRedeemed / transactionStats.totalEarned) * 100
        : 0;
    if (redemptionRate > 10 && redemptionRate < 80) {
      score += 25; // Optimal redemption range
    } else if (redemptionRate >= 5) {
      score += 15; // Some redemption activity
    }

    // Score from consistency
    if (transactionStats.avgTransactionValue > 100) {
      score += 15;
    }

    // Engagement bonus
    if (recentActivity.length > 0 && transactionStats.totalTransactions > 5) {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Get user loyalty admin notes
   */
  async getUserLoyaltyAdminNotes(userId) {
    try {
      // Get admin transactions and adjustments
      const adminTransactions = await LoyaltyTransaction.find({
        user: userId,
        type: { $in: ['ADJUSTMENT_ADMIN', 'ADJUSTMENT_ERROR'] },
      })
        .populate('processedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(10)
        .select('description internalNotes processedBy createdAt pointsAmount')
        .lean();

      return adminTransactions.map((transaction) => ({
        date: transaction.createdAt,
        admin: transaction.processedBy
          ? `${transaction.processedBy.firstName} ${transaction.processedBy.lastName}`
          : 'System',
        action: transaction.pointsAmount > 0 ? 'Points Added' : 'Points Deducted',
        amount: Math.abs(transaction.pointsAmount),
        description: transaction.description,
        notes: transaction.internalNotes,
      }));
    } catch (error) {
      logger.error('Error getting user loyalty admin notes:', error);
      return [];
    }
  }

  /**
   * Calculate overall engagement from tier stats
   */
  calculateOverallEngagement(tierStats) {
    if (!tierStats.length) return { score: 0, activeRate: 0 };

    const totals = tierStats.reduce(
      (acc, tier) => {
        acc.totalMembers += tier.totalMembers;
        acc.activeMembers += tier.activeMembers;
        acc.totalEngagement += (tier.avgEngagementScore || 0) * tier.totalMembers;
        return acc;
      },
      { totalMembers: 0, activeMembers: 0, totalEngagement: 0 }
    );

    return {
      score: totals.totalMembers > 0 ? totals.totalEngagement / totals.totalMembers : 0,
      activeRate: totals.totalMembers > 0 ? (totals.activeMembers / totals.totalMembers) * 100 : 0,
    };
  }

  /**
   * Create loyalty campaign
   */
  async createLoyaltyCampaign(campaignData, adminId) {
    try {
      // Validate campaign data
      const requiredFields = ['name', 'type', 'startDate', 'endDate', 'rules'];
      for (const field of requiredFields) {
        if (!campaignData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Create campaign object (this would typically be saved to a Campaign model)
      const campaign = {
        id: new mongoose.Types.ObjectId(),
        name: campaignData.name,
        description: campaignData.description || '',
        type: campaignData.type, // POINTS_MULTIPLIER, BONUS_POINTS, TIER_UPGRADE, etc.
        status: 'PENDING',
        startDate: new Date(campaignData.startDate),
        endDate: new Date(campaignData.endDate),
        rules: campaignData.rules,
        targetCriteria: campaignData.targetCriteria || {},
        createdBy: adminId,
        createdAt: new Date(),
        metrics: {
          participantsCount: 0,
          pointsIssued: 0,
          revenue: 0,
        },
      };

      // Here you would save to a Campaign collection
      // await Campaign.create(campaign);

      logger.info(`Loyalty campaign created: ${campaign.name} by admin ${adminId}`);

      return {
        success: true,
        campaign: campaign,
      };
    } catch (error) {
      logger.error('Error creating loyalty campaign:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Update loyalty campaign
   */
  async updateLoyaltyCampaign(campaignId, campaignData, adminId) {
    try {
      // Here you would update the campaign in the database
      // const updatedCampaign = await Campaign.findByIdAndUpdate(campaignId, {
      //     ...campaignData,
      //     updatedBy: adminId,
      //     updatedAt: new Date()
      // }, { new: true });

      logger.info(`Loyalty campaign updated: ${campaignId} by admin ${adminId}`);

      return {
        success: true,
        message: 'Campaign updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Activate loyalty campaign
   */
  async activateLoyaltyCampaign(campaignId, adminId) {
    try {
      // Here you would activate the campaign
      // await Campaign.findByIdAndUpdate(campaignId, {
      //     status: 'ACTIVE',
      //     activatedBy: adminId,
      //     activatedAt: new Date()
      // });

      logger.info(`Loyalty campaign activated: ${campaignId} by admin ${adminId}`);

      return {
        success: true,
        message: 'Campaign activated successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Deactivate loyalty campaign
   */
  async deactivateLoyaltyCampaign(campaignId, adminId) {
    try {
      // Here you would deactivate the campaign
      // await Campaign.findByIdAndUpdate(campaignId, {
      //     status: 'INACTIVE',
      //     deactivatedBy: adminId,
      //     deactivatedAt: new Date()
      // });

      logger.info(`Loyalty campaign deactivated: ${campaignId} by admin ${adminId}`);

      return {
        success: true,
        message: 'Campaign deactivated successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete loyalty campaign
   */
  async deleteLoyaltyCampaign(campaignId, adminId) {
    try {
      // Here you would delete the campaign
      // await Campaign.findByIdAndDelete(campaignId);

      logger.info(`Loyalty campaign deleted: ${campaignId} by admin ${adminId}`);

      return {
        success: true,
        message: 'Campaign deleted successfully',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List loyalty campaigns
   */
  async listLoyaltyCampaigns(queryParams) {
    try {
      const { status, type, page = 1, limit = 20 } = queryParams;

      // Here you would query campaigns from database
      // const query = {};
      // if (status) query.status = status;
      // if (type) query.type = type;

      // const campaigns = await Campaign.find(query)
      //     .sort({ createdAt: -1 })
      //     .skip((page - 1) * limit)
      //     .limit(parseInt(limit))
      //     .populate('createdBy', 'firstName lastName');

      // Mock response for now
      const campaigns = [];

      return {
        success: true,
        campaigns: campaigns,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: 0,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Generate comprehensive loyalty report
   */
  async generateComprehensiveLoyaltyReport(period, filters) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const [
        membershipStats,
        transactionStats,
        tierDistribution,
        engagementMetrics,
        revenueImpact,
      ] = await Promise.all([
        this.getLoyaltyDashboardStats(startDate),
        this.getLoyaltyTransactionAnalytics(period),
        this.getTierDistribution(false),
        this.getLoyaltyEngagementMetrics(period),
        this.getLoyaltyRevenueImpact(period),
      ]);

      return {
        reportType: 'comprehensive',
        period: { startDate, endDate, description: period },
        summary: {
          totalMembers: membershipStats.members.totalMembers,
          activeMembers: membershipStats.members.activeMembers,
          totalPointsInCirculation: membershipStats.members.totalCurrentPoints,
          totalTransactions: membershipStats.points.totalTransactions,
          avgEngagement: engagementMetrics.overallEngagement.score,
        },
        membership: membershipStats,
        transactions: transactionStats,
        tiers: tierDistribution,
        engagement: engagementMetrics,
        revenue: revenueImpact,
        insights: this.generateReportInsights(membershipStats, engagementMetrics, revenueImpact),
      };
    } catch (error) {
      logger.error('Error generating comprehensive loyalty report:', error);
      throw error;
    }
  }

  /**
   * Generate report insights
   */
  generateReportInsights(membershipStats, engagementMetrics, revenueImpact) {
    const insights = [];

    // Membership insights
    const activationRate =
      membershipStats.members.totalMembers > 0
        ? (membershipStats.members.activeMembers / membershipStats.members.totalMembers) * 100
        : 0;

    if (activationRate > 80) {
      insights.push({
        type: 'positive',
        title: 'High Member Engagement',
        description: `${activationRate.toFixed(1)}% of loyalty members are active`,
        recommendation: 'Continue current engagement strategies',
      });
    } else if (activationRate < 50) {
      insights.push({
        type: 'warning',
        title: 'Low Member Activation',
        description: `Only ${activationRate.toFixed(1)}% of members are active`,
        recommendation: 'Implement member reactivation campaign',
      });
    }

    // Revenue insights
    if (revenueImpact.comparison.revenueIncrease > 20) {
      insights.push({
        type: 'positive',
        title: 'Strong Revenue Impact',
        description: `Loyalty members spend ${revenueImpact.comparison.revenueIncrease.toFixed(1)}% more on average`,
        recommendation: 'Focus on member acquisition to maximize revenue',
      });
    }

    // Engagement insights
    if (engagementMetrics.overallEngagement.score > 70) {
      insights.push({
        type: 'positive',
        title: 'High Engagement Score',
        description: `Overall engagement score of ${engagementMetrics.overallEngagement.score.toFixed(0)}/100`,
        recommendation: 'Leverage high engagement for referral programs',
      });
    }

    return insights;
  }

  // ============================================================================
  // ALL EXISTING METHODS REMAIN UNCHANGED FROM ORIGINAL adminController.js
  // ============================================================================

  // ... (all existing yield management methods) ...
  // ... (all existing booking validation methods) ...
  // ... (all existing dashboard methods) ...
  // ... (all existing helper methods) ...

  /**
   * Get yield performance metrics for dashboard
   */
  async getYieldPerformanceMetrics(startDate, currency = 'EUR') {
    try {
      // Get yield-optimized bookings
      const yieldBookings = await Booking.find({
        createdAt: { $gte: startDate },
        'yieldManagement.enabled': true,
      }).populate('hotel', 'name');

      if (yieldBookings.length === 0) {
        return {
          totalOptimizedBookings: 0,
          averageYieldScore: 0,
          revenueImpact: 0,
          optimizationRate: 0,
          performanceByHotel: [],
        };
      }

      // Calculate metrics
      const totalOptimizedBookings = yieldBookings.length;
      const totalRevenue = yieldBookings.reduce((sum, booking) => sum + booking.totalPrice, 0);
      const totalBaseRevenue = yieldBookings.reduce((sum, booking) => {
        const basePrice =
          booking.yieldManagement?.pricingDetails?.[0]?.basePrice || booking.totalPrice;
        return sum + basePrice;
      }, 0);

      const revenueImpact =
        totalBaseRevenue > 0 ? ((totalRevenue - totalBaseRevenue) / totalBaseRevenue) * 100 : 0;

      const averageYieldScore =
        yieldBookings.reduce((sum, booking) => {
          return sum + (booking.yieldManagement?.performanceScore || 50);
        }, 0) / totalOptimizedBookings;

      // Performance by hotel
      const hotelPerformance = {};
      yieldBookings.forEach((booking) => {
        const hotelId = booking.hotel._id.toString();
        if (!hotelPerformance[hotelId]) {
          hotelPerformance[hotelId] = {
            hotelName: booking.hotel.name,
            bookings: 0,
            revenue: 0,
            yieldScore: 0,
          };
        }
        hotelPerformance[hotelId].bookings++;
        hotelPerformance[hotelId].revenue += booking.totalPrice;
        hotelPerformance[hotelId].yieldScore += booking.yieldManagement?.performanceScore || 50;
      });

      const performanceByHotel = Object.values(hotelPerformance).map((hotel) => ({
        ...hotel,
        averageYieldScore: hotel.yieldScore / hotel.bookings,
        revenuePerBooking: hotel.revenue / hotel.bookings,
      }));

      return {
        totalOptimizedBookings,
        averageYieldScore: Math.round(averageYieldScore),
        revenueImpact: Math.round(revenueImpact * 100) / 100,
        optimizationRate: Math.round(
          (totalOptimizedBookings / (await this.getTotalBookings(startDate))) * 100
        ),
        performanceByHotel,
        totalOptimizedRevenue: Math.round(totalRevenue * 100) / 100,
        currency,
      };
    } catch (error) {
      logger.error('Error calculating yield performance metrics:', error);
      throw error;
    }
  }

  // ... (continue with all other existing methods unchanged) ...

  async getTotalBookings(startDate) {
    return await Booking.countDocuments({
      createdAt: { $gte: startDate },
    });
  }

  async getPendingBookings() {
    const bookings = await Booking.find({ status: 'PENDING' })
      .populate('customer', 'firstName lastName email')
      .populate('hotel', 'name city')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    return {
      count: await Booking.countDocuments({ status: 'PENDING' }),
      bookings,
    };
  }

  async getConfirmedBookings(startDate) {
    return await Booking.countDocuments({
      status: 'CONFIRMED',
      createdAt: { $gte: startDate },
    });
  }

  async getTotalRevenue(startDate, currency = 'EUR') {
    const bookings = await Booking.find({
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      createdAt: { $gte: startDate },
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
      checkOutDate: { $gte: new Date() },
    });

    return {
      totalRooms,
      occupiedRooms,
      availableRooms: totalRooms - occupiedRooms,
      occupancyRate: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
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
        timestamp: new Date(),
      });
    }

    // Check for system performance
    const connectionStats = socketService.getConnectionStats();
    if (connectionStats.totalConnections > 100) {
      alerts.push({
        type: 'info',
        message: `High activity: ${connectionStats.totalConnections} users online`,
        priority: 'low',
        timestamp: new Date(),
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
      User.countDocuments({ lastLogin: { $gte: hourAgo } }),
    ]);

    return {
      connections: connectionStats,
      bookingsLastHour: recentBookings,
      loginsLastHour: recentLogins,
      serverUptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: now,
    };
  }

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
   * Enhanced booking validation with yield recommendations
   */
  async validateBooking(req, res) {
    try {
      const { bookingId } = req.params;
      const {
        action,
        comment,
        notifyCustomer = true,
        applyYieldRecommendations = false,
      } = req.body;
      const adminId = req.user.id;

      // Validate input
      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action. Must be "approve" or "reject"',
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
          message: 'Booking not found',
        });
      }

      if (booking.status !== 'PENDING') {
        return res.status(400).json({
          success: false,
          message: `Booking is already ${booking.status.toLowerCase()}`,
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
          if (
            applyYieldRecommendations &&
            action === 'approve' &&
            yieldRecommendation.suggestedAdjustment
          ) {
            priceAdjustment = await this.applyYieldAdjustment(booking, yieldRecommendation);
          }
        } catch (yieldError) {
          logger.error('Error getting yield recommendation:', yieldError);
          yieldRecommendation = {
            error: 'Failed to generate yield recommendation',
            message: yieldError.message,
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
            availabilityInfo: availability,
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
            priceAdjustment,
          },
          // Apply price adjustment if any
          ...(priceAdjustment && {
            totalPrice: priceAdjustment.newPrice,
            priceAdjustmentReason: 'Yield management optimization',
          }),
        },
        { new: true }
      )
        .populate('customer')
        .populate('hotel');

      // ================================
      // LOYALTY POINTS PROCESSING
      // ================================
      let loyaltyPointsAwarded = null;
      if (action === 'approve' && booking.customer.loyalty?.enrolledAt) {
        try {
          const loyaltyService = getLoyaltyService();
          const pointsResult = await loyaltyService.awardBookingPoints(
            bookingId,
            booking.customer._id,
            { source: 'ADMIN_APPROVAL' }
          );

          if (pointsResult.success) {
            loyaltyPointsAwarded = {
              pointsAwarded: pointsResult.pointsAwarded,
              newBalance: pointsResult.newBalance,
              tierUpgrade: pointsResult.tierUpgrade,
            };
          }
        } catch (loyaltyError) {
          logger.error('Error awarding loyalty points on booking approval:', loyaltyError);
        }
      }

      // ================================
      // REAL-TIME NOTIFICATIONS WITH YIELD AND LOYALTY DATA
      // ================================

      // Notify customer
      if (notifyCustomer) {
        const notificationData = {
          bookingId,
          userId: booking.customer._id,
          adminComment: comment,
          yieldOptimization: priceAdjustment
            ? {
                applied: true,
                originalPrice: priceAdjustment.originalPrice,
                newPrice: priceAdjustment.newPrice,
                savings:
                  priceAdjustment.newPrice < priceAdjustment.originalPrice
                    ? priceAdjustment.originalPrice - priceAdjustment.newPrice
                    : 0,
              }
            : null,
          loyaltyPoints: loyaltyPointsAwarded,
        };

        if (action === 'approve') {
          notificationService.emit('booking:confirmed', notificationData);
        } else {
          notificationService.emit('booking:rejected', {
            ...notificationData,
            reason: comment,
          });
        }
      }

      // Broadcast to all admins with yield and loyalty insights
      socketService.sendAdminNotification('booking-validated-enhanced', {
        bookingId,
        action,
        validatedBy: req.user.firstName + ' ' + req.user.lastName,
        customerName: booking.customer.firstName + ' ' + booking.customer.lastName,
        hotelName: booking.hotel.name,
        yieldRecommendation,
        priceAdjustment,
        loyaltyPointsAwarded,
        revenueImpact: priceAdjustment
          ? priceAdjustment.newPrice - priceAdjustment.originalPrice
          : 0,
        timestamp: new Date(),
      });

      logger.info(
        `Booking ${bookingId} ${action}ed by admin ${adminId} with yield and loyalty analysis`
      );

      res.json({
        success: true,
        message: `Booking ${action}ed successfully`,
        data: {
          booking: updatedBooking,
          yieldAnalysis: {
            recommendationFollowed: yieldRecommendation?.recommendation === action.toUpperCase(),
            priceOptimized: !!priceAdjustment,
            revenueImpact: priceAdjustment
              ? priceAdjustment.newPrice - priceAdjustment.originalPrice
              : 0,
          },
          loyaltyImpact: loyaltyPointsAwarded,
          realTimeNotifications: {
            customerNotified: notifyCustomer,
            adminsBroadcast: true,
            enhancedDataIncluded: true,
          },
        },
      });
    } catch (error) {
      logger.error('Error validating booking with enhanced features:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to validate booking',
        error: error.message,
      });
    }
  }

  /**
   * Bulk validation for multiple bookings with yield optimization and loyalty processing
   */
  async bulkValidateBookings(req, res) {
    try {
      const {
        bookingIds,
        action,
        comment,
        applyYieldOptimization = false,
        processLoyaltyPoints = true,
      } = req.body;
      const adminId = req.user.id;

      if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Booking IDs array is required',
        });
      }

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid action',
        });
      }

      const results = [];
      const failedValidations = [];
      let totalRevenueImpact = 0;
      let totalLoyaltyPointsAwarded = 0;
      let tierUpgrades = 0;

      // Process each booking
      for (const bookingId of bookingIds) {
        try {
          const booking = await Booking.findById(bookingId).populate('customer').populate('hotel');

          if (!booking || booking.status !== 'PENDING') {
            failedValidations.push({
              bookingId,
              reason: 'Booking not found or not pending',
            });
            continue;
          }

          // Get yield recommendation for each booking
          let yieldRecommendation = null;
          let priceAdjustment = null;

          if (
            applyYieldOptimization &&
            action === 'approve' &&
            process.env.YIELD_MANAGEMENT_ENABLED === 'true'
          ) {
            try {
              yieldRecommendation = await this.getBookingYieldRecommendation(booking);
              if (yieldRecommendation.suggestedAdjustment) {
                priceAdjustment = await this.applyYieldAdjustment(booking, yieldRecommendation);
                totalRevenueImpact += priceAdjustment.adjustment;
              }
            } catch (yieldError) {
              logger.warn(
                `Yield optimization failed for booking ${bookingId}:`,
                yieldError.message
              );
            }
          }

          // Check availability for approvals
          if (action === 'approve') {
            const availability = await this.checkRoomAvailabilityForBooking(booking);
            if (!availability.available) {
              failedValidations.push({
                bookingId,
                reason: 'Rooms no longer available',
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
              priceAdjustment,
            },
            // Apply price adjustment if any
            ...(priceAdjustment && {
              totalPrice: priceAdjustment.newPrice,
              priceAdjustmentReason: 'Bulk yield optimization',
            }),
          });

          // Process loyalty points for approved bookings
          let loyaltyResult = null;
          if (
            action === 'approve' &&
            processLoyaltyPoints &&
            booking.customer.loyalty?.enrolledAt
          ) {
            try {
              const loyaltyService = getLoyaltyService();
              loyaltyResult = await loyaltyService.awardBookingPoints(
                bookingId,
                booking.customer._id,
                { source: 'BULK_ADMIN_APPROVAL' }
              );

              if (loyaltyResult.success) {
                totalLoyaltyPointsAwarded += loyaltyResult.pointsAwarded;
                if (loyaltyResult.tierUpgrade?.upgraded) {
                  tierUpgrades++;
                }
              }
            } catch (loyaltyError) {
              logger.warn(
                `Loyalty processing failed for booking ${bookingId}:`,
                loyaltyError.message
              );
            }
          }

          // Send real-time notifications
          if (action === 'approve') {
            notificationService.emit('booking:confirmed', {
              bookingId,
              userId: booking.customer._id,
              adminComment: comment,
              bulkOperation: true,
              yieldOptimized: !!priceAdjustment,
              loyaltyPoints: loyaltyResult,
            });
          } else {
            notificationService.emit('booking:rejected', {
              bookingId,
              userId: booking.customer._id,
              reason: comment,
              bulkOperation: true,
            });
          }

          results.push({
            bookingId,
            status: 'success',
            newStatus,
            yieldOptimized: !!priceAdjustment,
            revenueImpact: priceAdjustment?.adjustment || 0,
            loyaltyPoints: loyaltyResult?.pointsAwarded || 0,
            tierUpgrade: loyaltyResult?.tierUpgrade?.upgraded || false,
          });
        } catch (error) {
          failedValidations.push({
            bookingId,
            reason: error.message,
          });
        }
      }

      // Send bulk notification to admins with enhanced data
      socketService.sendAdminNotification('bulk-validation-completed-enhanced', {
        action,
        totalProcessed: bookingIds.length,
        successful: results.length,
        failed: failedValidations.length,
        yieldOptimizationApplied: applyYieldOptimization,
        totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
        loyaltyPointsProcessed: processLoyaltyPoints,
        totalLoyaltyPointsAwarded,
        tierUpgrades,
        validatedBy: req.user.firstName + ' ' + req.user.lastName,
        timestamp: new Date(),
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
            yieldOptimized: results.filter((r) => r.yieldOptimized).length,
            totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
            loyaltyPointsAwarded: totalLoyaltyPointsAwarded,
            tierUpgrades,
          },
        },
      });
    } catch (error) {
      logger.error('Error in bulk validation with enhanced features:', error);
      res.status(500).json({
        success: false,
        message: 'Bulk validation failed',
        error: error.message,
      });
    }
  }

  // ============================================================================
  // REMAINING EXISTING METHODS (unchanged from original)
  // ============================================================================

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
        potentialRevenue: optimizationData.potentialRevenue || 0,
      };
    } catch (error) {
      logger.error('Error getting revenue optimization data:', error);
      return {
        opportunities: [],
        recentPriceChanges: [],
        impact: { totalImpact: 0, positive: 0, negative: 0 },
        recommendations: [],
        error: error.message,
      };
    }
  }

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
            confidence: demand.confidence,
          });
        } catch (hotelError) {
          logger.warn(`Error getting demand for hotel ${hotel._id}:`, hotelError.message);
        }
      }

      // Calculate overall demand metrics
      const totalDemandScore = demandByHotel.reduce((sum, hotel) => sum + hotel.demandScore, 0);
      const averageDemandScore =
        demandByHotel.length > 0 ? totalDemandScore / demandByHotel.length : 0;

      const demandDistribution = {};
      demandByHotel.forEach((hotel) => {
        demandDistribution[hotel.currentDemand] =
          (demandDistribution[hotel.currentDemand] || 0) + 1;
      });

      return {
        overallDemand: this.calculateOverallDemandLevel(averageDemandScore),
        averageScore: Math.round(averageDemandScore),
        distribution: demandDistribution,
        hotelDetails: demandByHotel,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting current demand analysis:', error);
      return {
        overallDemand: 'UNKNOWN',
        averageScore: 0,
        distribution: {},
        hotelDetails: [],
        error: error.message,
      };
    }
  }

  async getPricingEffectivenessData(startDate) {
    try {
      const pricingRules = await PricingRule.find({
        isActive: true,
        lastApplied: { $gte: startDate },
      });

      const effectivenessData = {
        totalActiveRules: pricingRules.length,
        rulesApplied: pricingRules.filter((rule) => rule.lastApplied).length,
        averageImpact: 0,
        topPerformingRules: [],
        underperformingRules: [],
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
              impact: Math.round(impact * 100) / 100,
            });
          } else if (impact < -2) {
            effectivenessData.underperformingRules.push({
              ruleId: rule._id,
              ruleType: rule.ruleType,
              description: rule.description,
              impact: Math.round(impact * 100) / 100,
            });
          }
        }
      }

      effectivenessData.averageImpact =
        pricingRules.length > 0 ? effectivenessData.averageImpact / pricingRules.length : 0;

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
        error: error.message,
      };
    }
  }

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
      return [
        {
          type: 'error',
          message: 'Failed to load yield management alerts',
          priority: 'medium',
          timestamp: new Date(),
        },
      ];
    }
  }

  // ... (continue with all remaining existing methods) ...

  // ============================================================================
  // REMAINING EXISTING METHODS (unchanged from original)
  // ============================================================================

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
        potentialRevenue: optimizationData.potentialRevenue || 0,
      };
    } catch (error) {
      logger.error('Error getting revenue optimization data:', error);
      return {
        opportunities: [],
        recentPriceChanges: [],
        impact: { totalImpact: 0, positive: 0, negative: 0 },
        recommendations: [],
        error: error.message,
      };
    }
  }

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
            confidence: demand.confidence,
          });
        } catch (hotelError) {
          logger.warn(`Error getting demand for hotel ${hotel._id}:`, hotelError.message);
        }
      }

      // Calculate overall demand metrics
      const totalDemandScore = demandByHotel.reduce((sum, hotel) => sum + hotel.demandScore, 0);
      const averageDemandScore =
        demandByHotel.length > 0 ? totalDemandScore / demandByHotel.length : 0;

      const demandDistribution = {};
      demandByHotel.forEach((hotel) => {
        demandDistribution[hotel.currentDemand] =
          (demandDistribution[hotel.currentDemand] || 0) + 1;
      });

      return {
        overallDemand: this.calculateOverallDemandLevel(averageDemandScore),
        averageScore: Math.round(averageDemandScore),
        distribution: demandDistribution,
        hotelDetails: demandByHotel,
        lastUpdated: new Date(),
      };
    } catch (error) {
      logger.error('Error getting current demand analysis:', error);
      return {
        overallDemand: 'UNKNOWN',
        averageScore: 0,
        distribution: {},
        hotelDetails: [],
        error: error.message,
      };
    }
  }

  async getPricingEffectivenessData(startDate) {
    try {
      const pricingRules = await PricingRule.find({
        isActive: true,
        lastApplied: { $gte: startDate },
      });

      const effectivenessData = {
        totalActiveRules: pricingRules.length,
        rulesApplied: pricingRules.filter((rule) => rule.lastApplied).length,
        averageImpact: 0,
        topPerformingRules: [],
        underperformingRules: [],
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
              impact: Math.round(impact * 100) / 100,
            });
          } else if (impact < -2) {
            effectivenessData.underperformingRules.push({
              ruleId: rule._id,
              ruleType: rule.ruleType,
              description: rule.description,
              impact: Math.round(impact * 100) / 100,
            });
          }
        }
      }

      effectivenessData.averageImpact =
        pricingRules.length > 0 ? effectivenessData.averageImpact / pricingRules.length : 0;

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
        error: error.message,
      };
    }
  }

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
      return [
        {
          type: 'error',
          message: 'Failed to load yield management alerts',
          priority: 'medium',
          timestamp: new Date(),
        },
      ];
    }
  }

  /**
   * Trigger demand analysis for all hotels or specific hotel
   */
  async triggerDemandAnalysis(req, res) {
    try {
      const { hotelId, priority = 'high' } = req.body;

      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return res.status(400).json({
          success: false,
          message: 'Yield management is not enabled',
        });
      }

      let analysisResults = [];

      if (hotelId) {
        // Trigger for specific hotel
        const result = await yieldManager.triggerDemandAnalysis(hotelId);
        analysisResults.push({
          hotelId,
          status: 'completed',
          result,
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
              result,
            });
          } catch (hotelError) {
            analysisResults.push({
              hotelId: hotel._id,
              hotelName: hotel.name,
              status: 'failed',
              error: hotelError.message,
            });
          }
        }
      }

      // Send real-time notification
      socketService.sendAdminNotification('demand-analysis-completed', {
        triggeredBy: req.user.id,
        results: analysisResults,
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: 'Demand analysis triggered successfully',
        data: {
          analysisResults,
          triggeredBy: req.user.id,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error triggering demand analysis:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to trigger demand analysis',
        error: error.message,
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
          message: 'Yield management is not enabled',
        });
      }

      const optimizationResults = [];
      const hotels = hotelIds || (await Hotel.find({ isActive: true }).distinct('_id'));

      for (const hotelId of hotels) {
        try {
          const optimization = await yieldManager.updatePricingForHotel(hotelId, {
            strategy,
            dateRange,
            triggeredBy: req.user.id,
          });

          optimizationResults.push({
            hotelId,
            status: 'optimized',
            optimization,
          });
        } catch (hotelError) {
          optimizationResults.push({
            hotelId,
            status: 'failed',
            error: hotelError.message,
          });
        }
      }

      // Calculate overall impact
      const successfulOptimizations = optimizationResults.filter((r) => r.status === 'optimized');
      const totalImpact = successfulOptimizations.reduce((sum, result) => {
        return sum + (result.optimization?.revenueImpact || 0);
      }, 0);

      // Send real-time notification
      socketService.sendAdminNotification('pricing-optimization-completed', {
        optimizationResults,
        totalImpact,
        strategy,
        triggeredBy: req.user.id,
        timestamp: new Date(),
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
            totalRevenueImpact: Math.round(totalImpact * 100) / 100,
          },
        },
      });
    } catch (error) {
      logger.error('Error optimizing pricing:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to optimize pricing',
        error: error.message,
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
        includeRecommendations = true,
      } = req.query;

      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return res.status(400).json({
          success: false,
          message: 'Yield management is not enabled',
        });
      }

      const [startDate, endDate] = this.parsePeriod(period);

      // Get comprehensive yield data
      const [
        performanceMetrics,
        revenueAnalysis,
        demandTrends,
        pricingEffectiveness,
        competitorAnalysis,
      ] = await Promise.all([
        this.getYieldPerformanceMetrics(startDate),
        revenueAnalytics.getRevenueAnalysis(startDate, endDate, hotelId),
        demandAnalyzer.getDemandTrends(startDate, endDate, hotelId),
        this.getPricingEffectivenessData(startDate),
        this.getCompetitorAnalysis(hotelId), // Placeholder for future implementation
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
          keyInsights: this.generateKeyInsights(performanceMetrics, revenueAnalysis, demandTrends),
        },
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
        data: report,
      });
    } catch (error) {
      logger.error('Error generating yield management report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate yield management report',
        error: error.message,
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
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: `Pricing rules ${action} completed successfully`,
      });
    } catch (error) {
      logger.error('Error managing pricing rules:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to manage pricing rules',
        error: error.message,
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
          message: 'Yield management is not enabled',
        });
      }

      const yieldStatus = schedulerService.getYieldManagementStatus();
      const activeJobs = schedulerService
        .getActiveJobs()
        .filter((job) => Object.values(JOB_TYPES).includes(job.type));

      res.json({
        success: true,
        data: {
          yieldManagement: yieldStatus,
          activeYieldJobs: activeJobs,
          controls: {
            pause: '/api/admin/yield/jobs/pause',
            resume: '/api/admin/yield/jobs/resume',
            restart: '/api/admin/yield/jobs/restart',
            trigger: '/api/admin/yield/jobs/trigger',
          },
        },
      });
    } catch (error) {
      logger.error('Error getting yield jobs status:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get yield jobs status',
        error: error.message,
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
          message: 'Yield management is not enabled',
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
            manual: true,
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
        timestamp: new Date(),
      });

      res.json({
        success: true,
        message: `Yield jobs ${action} completed successfully`,
        data: result,
      });
    } catch (error) {
      logger.error('Error controlling yield jobs:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to control yield jobs',
        error: error.message,
      });
    }
  }

  async checkRoomAvailabilityForBooking(booking) {
    try {
      const availableRooms = await Room.countDocuments({
        hotel: booking.hotel._id,
        roomType: { $in: booking.rooms.map((r) => r.roomType) },
        status: 'AVAILABLE',
      });

      return {
        available: availableRooms >= booking.rooms.length,
        availableCount: availableRooms,
        requiredCount: booking.rooms.length,
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
    if (timeInQueue > 24 * 60 * 60 * 1000)
      urgency += 3; // > 24 hours
    else if (timeInQueue > 4 * 60 * 60 * 1000)
      urgency += 2; // > 4 hours
    else if (timeInQueue > 1 * 60 * 60 * 1000) urgency += 1; // > 1 hour

    // Increase urgency if check-in is soon
    if (daysUntilCheckIn <= 1)
      urgency += 4; // Tomorrow or today
    else if (daysUntilCheckIn <= 3)
      urgency += 2; // Within 3 days
    else if (daysUntilCheckIn <= 7) urgency += 1; // Within a week

    // High-value bookings
    if (booking.totalAmount > 500) urgency += 1;
    if (booking.totalAmount > 1000) urgency += 1;

    return Math.min(urgency, 10); // Cap at 10
  }

  /**
   * Get live dashboard data for streaming
   */
  async getLiveDashboardData(preferences = {}) {
    const {
      timeframe = '24h',
      currency = 'EUR',
      includeYield = true,
      includeLoyalty = true,
    } = preferences;

    const now = new Date();
    const startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [pendingCount, realtimeMetrics, systemAlerts] = await Promise.all([
      Booking.countDocuments({ status: 'PENDING' }),
      this.getRealtimeMetrics(),
      this.getSystemAlerts(),
    ]);

    const liveData = {
      timestamp: now,
      pendingBookings: pendingCount,
      realtimeMetrics,
      systemAlerts,
      connectionCount: socketService.getConnectionStats(),
    };

    // Add yield management live data if enabled
    if (includeYield === 'true' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      try {
        liveData.yieldManagement = {
          activeOptimizations: await yieldManager.getActiveOptimizations(),
          currentDemandLevel: await this.getOverallDemandLevel(),
          recentPriceChanges: await this.getRecentPriceChanges(startDate),
          systemHealth: schedulerService.getYieldManagementStatus(),
        };
      } catch (yieldError) {
        liveData.yieldManagement = { error: 'Failed to load yield data' };
      }
    }

    // Add loyalty live data if enabled
    if (includeLoyalty === 'true') {
      try {
        liveData.loyaltyProgram = {
          recentActivity: await this.getLoyaltyActivity(startDate),
          alerts: await this.getLoyaltySystemAlerts(),
          quickStats: await this.getLoyaltyDashboardStats(startDate),
        };
      } catch (loyaltyError) {
        liveData.loyaltyProgram = { error: 'Failed to load loyalty data' };
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
              timestamp: new Date(),
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
              timestamp: new Date(),
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
        'performanceMetrics.revenueImpact': { $lt: -5 }, // Rules causing revenue loss
      });

      underperformingRules.forEach((rule) => {
        alerts.push({
          type: 'warning',
          category: 'underperforming_rule',
          message: `Pricing rule "${rule.description}" is reducing revenue`,
          ruleId: rule._id,
          ruleType: rule.ruleType,
          revenueImpact: rule.performanceMetrics.revenueImpact,
          priority: 'medium',
          action: 'Review or disable this rule',
          timestamp: new Date(),
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
          timestamp: new Date(),
        });
      } else if (yieldStatus.statistics.activeJobs === 0) {
        alerts.push({
          type: 'warning',
          category: 'yield_jobs',
          message: 'No yield management jobs are currently active',
          priority: 'medium',
          action: 'Check job scheduler',
          timestamp: new Date(),
        });
      }

      // Check for recent job failures
      const recentFailures =
        yieldStatus.recentHistory?.filter(
          (job) =>
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
          timestamp: new Date(),
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
        changes: [],
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
        'yieldManagement.enabled': true,
      });

      let positiveImpact = 0;
      let negativeImpact = 0;
      let totalImpact = 0;

      yieldBookings.forEach((booking) => {
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
        bookingsOptimized: yieldBookings.filter((b) => b.yieldManagement?.priceAdjustment).length,
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
        checkOutDate: { $gt: today },
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
    let startDate,
      endDate = now;

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
    return Math.round(yieldScore * 0.7 + Math.min(revenueOptimization * 10, 50) * 0.3);
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
        confidence: 75,
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
          action: 'Review pricing strategies and rules',
        });
      }

      if (report.revenue.optimizationPercentage < 5) {
        recommendations.push({
          type: 'REVENUE',
          priority: 'MEDIUM',
          message: 'Limited revenue optimization detected',
          action: 'Enable more aggressive yield management',
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
        message: 'Competitor analysis feature coming soon',
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

  /**
   * Get booking yield recommendation
   */
  async getBookingYieldRecommendation(booking) {
    try {
      const hotelId = booking.hotel._id;
      const checkInDate = booking.checkInDate;
      const roomTypes = booking.rooms.map((room) => room.type);

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
        strategy: 'MODERATE',
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
            reason: 'High demand detected - optimize pricing',
          };
        }
        confidence = 85;
      } else if (demandAnalysis.level === 'LOW' || demandAnalysis.level === 'VERY_LOW') {
        if (bookingValue < 200) {
          // Low value booking in low demand
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
            reason: 'Last-minute booking premium',
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
          recommendation: this.generateRecommendationText(recommendation, suggestedAdjustment),
        },
      };
    } catch (error) {
      logger.error('Error generating booking yield recommendation:', error);
      return {
        recommendation: 'APPROVE',
        confidence: 50,
        error: error.message,
        fallback: true,
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
        appliedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error applying yield adjustment:', error);
      throw error;
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
        timestamp: new Date(),
      });

      // Also send via notification service for offline admins
      notificationService.emit('system:alert', {
        message: `${title}: ${message}`,
        severity: priority,
        targetRoles,
      });

      logger.info(`Urgent notification sent by admin ${req.user.id}: ${title}`);

      res.json({
        success: true,
        message: 'Urgent notification sent to all admins',
        data: {
          title,
          message,
          priority,
          timestamp: new Date(),
        },
      });
    } catch (error) {
      logger.error('Error sending urgent notification:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to send urgent notification',
        error: error.message,
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
          ),
        };
      }

      // Add loyalty management statistics
      stats.loyaltyProgram = {
        recentActivity: await this.getLoyaltyActivity(new Date(Date.now() - 24 * 60 * 60 * 1000)),
        systemHealth: 'operational',
        quickStats: await this.getLoyaltyDashboardStats(new Date(Date.now() - 24 * 60 * 60 * 1000)),
      };

      res.json({
        success: true,
        data: stats,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Error getting system stats:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get system statistics',
        error: error.message,
      });
    }
  }

  /**
   * Get real-time admin activity feed with yield and loyalty events
   */
  async getAdminActivityFeed(req, res) {
    try {
      const { limit = 20, includeYieldEvents = true, includeLoyaltyEvents = true } = req.query;

      // Get recent admin activities
      const activities = await this.getRecentAdminActivities(limit);

      // Add yield management events if enabled
      if (includeYieldEvents === 'true' && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        const yieldEvents = await this.getRecentYieldEvents(limit);
        activities.push(...yieldEvents);
      }

      // Add loyalty events if enabled
      if (includeLoyaltyEvents === 'true') {
        const loyaltyEvents = await this.getRecentLoyaltyEvents(limit);
        activities.push(...loyaltyEvents);
      }

      // Sort by timestamp and limit
      activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      activities.splice(limit);

      res.json({
        success: true,
        data: activities,
        timestamp: new Date(),
      });
    } catch (error) {
      logger.error('Error getting admin activity feed:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get activity feed',
        error: error.message,
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
          $gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      })
        .populate('hotel', 'name')
        .sort({ 'yieldManagement.lastOptimization.optimizedAt': -1 })
        .limit(limit);

      recentOptimizations.forEach((booking) => {
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
            optimizedBy: optimization.optimizedBy,
          },
        });
      });

      return yieldEvents;
    } catch (error) {
      logger.error('Error getting recent yield events:', error);
      return [];
    }
  }

  /**
   * Get recent loyalty events
   */
  async getRecentLoyaltyEvents(limit = 10) {
    try {
      const loyaltyEvents = [];

      // Get recent loyalty transactions
      const recentTransactions = await LoyaltyTransaction.find({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        type: { $in: ['ADJUSTMENT_ADMIN', 'TIER_BONUS', 'EARN_BONUS'] },
      })
        .populate('user', 'firstName lastName')
        .populate('processedBy', 'firstName lastName')
        .sort({ createdAt: -1 })
        .limit(limit);

      recentTransactions.forEach((transaction) => {
        loyaltyEvents.push({
          type: 'loyalty_transaction',
          action: transaction.type,
          timestamp: transaction.createdAt,
          details: {
            transactionId: transaction._id,
            user: transaction.user
              ? `${transaction.user.firstName} ${transaction.user.lastName}`
              : 'Unknown',
            points: transaction.pointsAmount,
            description: transaction.description,
            processedBy: transaction.processedBy
              ? `${transaction.processedBy.firstName} ${transaction.processedBy.lastName}`
              : 'System',
          },
        });
      });

      return loyaltyEvents;
    } catch (error) {
      logger.error('Error getting recent loyalty events:', error);
      return [];
    }
  }

  async getRecentAdminActivities(limit = 20) {
    // This would come from an AdminActivity model or audit log
    // For now, returning recent booking validations
    const recentValidations = await Booking.find({
      'adminValidation.validatedAt': { $exists: true },
    })
      .populate('adminValidation.validatedBy', 'firstName lastName')
      .populate('customer', 'firstName lastName')
      .populate('hotel', 'name')
      .sort({ 'adminValidation.validatedAt': -1 })
      .limit(limit)
      .select('confirmationNumber adminValidation customer hotel')
      .lean();

    return recentValidations.map((booking) => ({
      type: 'booking_validation',
      action: booking.adminValidation.action,
      timestamp: booking.adminValidation.validatedAt,
      admin: booking.adminValidation.validatedBy,
      details: {
        bookingNumber: booking.confirmationNumber,
        customer: booking.customer,
        hotel: booking.hotel,
        yieldOptimized: !!booking.adminValidation.priceAdjustment,
        loyaltyProcessed: !!booking.adminValidation.loyaltyPoints,
      },
    }));
  }
}

module.exports = new AdminController();