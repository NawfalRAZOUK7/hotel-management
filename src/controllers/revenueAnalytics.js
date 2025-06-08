/**
 * ANALYTICS CONTROLLER - ENHANCED WITH YIELD MANAGEMENT - Week 3
 * Advanced analytics with yield management, revenue optimization, and pricing performance
 * 
 * Features:
 * - Existing booking analytics (preserved)
 * - NEW: Yield management effectiveness tracking
 * - NEW: Revenue optimization reports  
 * - NEW: Pricing performance metrics
 * - NEW: Advanced forecasting and recommendations
 * - Real-time dashboard updates via Socket.io
 */

const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');
const mongoose = require('mongoose');
const moment = require('moment');

// Advanced analytics services
const revenueAnalyticsService = require('../services/revenueAnalytics');
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const currencyService = require('../services/currencyService');

// Real-time and notification services
const socketService = require('../services/socketService');
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const bookingRealtimeService = require('../services/bookingRealtimeService');

// Utils and constants
const { 
  BOOKING_STATUS, 
  BOOKING_SOURCES, 
  USER_ROLES,
  ROOM_TYPES 
} = require('../utils/constants');
const { logger } = require('../utils/logger');
const { validateDateRange, sanitizeInput } = require('../utils/validation');

/**
 * ================================
 * ENHANCED BOOKING ANALYTICS (EXISTING + YIELD INTEGRATION)
 * ================================
 */

/**
 * Get comprehensive booking analytics with yield management insights
 * Enhanced version of existing endpoint with yield management data
 */
const getBookingAnalytics = async (req, res) => {
  try {
    const { 
      hotelId, 
      startDate, 
      endDate, 
      groupBy = 'day',
      realTime = 'false',
      includeYieldAnalytics = 'true',
      currency = 'EUR'
    } = req.query;

    // Validate inputs
    const period = validateDateRange(startDate, endDate);
    const sanitizedHotelId = sanitizeInput(hotelId);

    // Base query
    let query = {
      createdAt: { $gte: period.start, $lte: period.end },
      status: { $ne: BOOKING_STATUS.CANCELLED }
    };

    if (sanitizedHotelId) {
      query.hotel = new mongoose.Types.ObjectId(sanitizedHotelId);
    }

    // Role-based filtering
    if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId) {
      query.hotel = req.user.hotelId;
    }

    // Execute parallel queries
    const [
      revenueStats,
      statusStats,
      sourceStats,
      trendsData,
      occupancyData,
      yieldStats,
      pricingPerformance
    ] = await Promise.all([
      // Basic revenue statistics
      Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' },
            averageBookingValue: { $avg: '$totalAmount' },
            totalRooms: { $sum: { $size: '$rooms' } },
            averageRoomsPerBooking: { $avg: { $size: '$rooms' } }
          }
        }
      ]),

      // Status breakdown
      Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' },
            averageValue: { $avg: '$totalAmount' }
          }
        }
      ]),

      // Source breakdown
      Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$source',
            count: { $sum: 1 },
            revenue: { $sum: '$totalAmount' }
          }
        }
      ]),

      // Trends data
      Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $dateToString: { 
                format: groupBy === 'day' ? '%Y-%m-%d' : 
                       groupBy === 'week' ? '%Y-%U' : '%Y-%m',
                date: '$createdAt'
              }
            },
            bookings: { $sum: 1 },
            revenue: { $sum: '$totalAmount' },
            rooms: { $sum: { $size: '$rooms' } }
          }
        },
        { $sort: { _id: 1 } }
      ]),

      // Real-time occupancy
      sanitizedHotelId ? availabilityRealtimeService.getRealTimeOccupancy(sanitizedHotelId) : null,

      // NEW: Yield management statistics
      includeYieldAnalytics === 'true' ? Booking.aggregate([
        { 
          $match: { 
            ...query, 
            'yieldManagement.enabled': true 
          } 
        },
        {
          $group: {
            _id: null,
            totalYieldBookings: { $sum: 1 },
            averageYieldMultiplier: { $avg: '$yieldManagement.averageMultiplier' },
            totalYieldRevenue: { $sum: '$totalAmount' },
            avgBasePrice: { $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.basePrice', 0] } },
            avgDynamicPrice: { $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.dynamicPrice', 0] } }
          }
        }
      ]) : Promise.resolve([]),

      // NEW: Pricing performance analysis
      includeYieldAnalytics === 'true' && sanitizedHotelId ? 
        analyzePricingPerformance(sanitizedHotelId, period.start, period.end) : null
    ]);

    // Process results
    const totalStats = revenueStats[0] || {
      totalBookings: 0,
      totalRevenue: 0,
      averageBookingValue: 0,
      totalRooms: 0,
      averageRoomsPerBooking: 0
    };

    // Convert currency if needed
    if (currency !== 'EUR') {
      const conversion = await currencyService.convertCurrency(
        totalStats.totalRevenue, 'EUR', currency
      );
      totalStats.totalRevenue = conversion.convertedAmount;
      totalStats.averageBookingValue = totalStats.totalBookings > 0 ? 
        totalStats.totalRevenue / totalStats.totalBookings : 0;
    }

    const statusBreakdown = {};
    statusStats.forEach(stat => {
      statusBreakdown[stat._id] = {
        count: stat.count,
        revenue: Math.round(stat.totalRevenue * 100) / 100,
        averageValue: Math.round(stat.averageValue * 100) / 100,
        percentage: Math.round((stat.count / totalStats.totalBookings) * 100)
      };
    });

    const sourceBreakdown = {};
    sourceStats.forEach(stat => {
      sourceBreakdown[stat._id] = {
        count: stat.count,
        revenue: Math.round(stat.revenue * 100) / 100,
        percentage: Math.round((stat.count / totalStats.totalBookings) * 100)
      };
    });

    // NEW: Process yield analytics
    const yieldAnalytics = yieldStats[0] ? {
      totalYieldBookings: yieldStats[0].totalYieldBookings,
      yieldAdoptionRate: Math.round((yieldStats[0].totalYieldBookings / totalStats.totalBookings) * 100),
      averageYieldMultiplier: Math.round((yieldStats[0].averageYieldMultiplier || 1) * 100) / 100,
      yieldRevenue: Math.round(yieldStats[0].totalYieldRevenue * 100) / 100,
      avgBasePrice: Math.round((yieldStats[0].avgBasePrice || 0) * 100) / 100,
      avgDynamicPrice: Math.round((yieldStats[0].avgDynamicPrice || 0) * 100) / 100,
      revenueOptimization: yieldStats[0].avgDynamicPrice > yieldStats[0].avgBasePrice ? 
        Math.round(((yieldStats[0].avgDynamicPrice / yieldStats[0].avgBasePrice) - 1) * 100) : 0
    } : null;

    // Real-time dashboard updates
    if (realTime === 'true') {
      const liveMetrics = {
        currentOccupancy: occupancyData ? occupancyData.occupancyRate : null,
        todaysBookings: await Booking.countDocuments({
          ...query,
          createdAt: { 
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lte: new Date()
          }
        }),
        pendingValidations: await Booking.countDocuments({
          ...query,
          status: BOOKING_STATUS.PENDING
        }),
        // NEW: Real-time yield metrics
        currentDemandLevel: sanitizedHotelId ? await getCurrentDemandLevel(sanitizedHotelId) : 'NORMAL',
        yieldOptimizationActive: yieldAnalytics ? yieldAnalytics.yieldAdoptionRate > 50 : false
      };

      socketService.sendUserNotification(req.user.id, 'LIVE_DASHBOARD_METRICS', {
        metrics: liveMetrics,
        timestamp: new Date()
      });
    }

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: period.start,
          end: period.end,
          groupBy
        },
        overview: {
          totalBookings: totalStats.totalBookings,
          totalRevenue: Math.round(totalStats.totalRevenue * 100) / 100,
          averageBookingValue: Math.round(totalStats.averageBookingValue * 100) / 100,
          totalRooms: totalStats.totalRooms,
          averageRoomsPerBooking: Math.round(totalStats.averageRoomsPerBooking * 100) / 100,
          currency
        },
        breakdown: {
          byStatus: statusBreakdown,
          bySource: sourceBreakdown
        },
        trends: trendsData.map(trend => ({
          period: trend._id,
          bookings: trend.bookings,
          revenue: Math.round(trend.revenue * 100) / 100,
          rooms: trend.rooms,
          averageBookingValue: Math.round((trend.revenue / trend.bookings) * 100) / 100
        })),
        insights: {
          conversionRate: statusBreakdown[BOOKING_STATUS.CONFIRMED] ? 
            Math.round((statusBreakdown[BOOKING_STATUS.CONFIRMED].count / totalStats.totalBookings) * 100) : 0,
          cancellationRate: statusBreakdown[BOOKING_STATUS.CANCELLED] ? 
            Math.round((statusBreakdown[BOOKING_STATUS.CANCELLED].count / totalStats.totalBookings) * 100) : 0,
          completionRate: statusBreakdown[BOOKING_STATUS.COMPLETED] ? 
            Math.round((statusBreakdown[BOOKING_STATUS.COMPLETED].count / totalStats.totalBookings) * 100) : 0
        },
        // NEW: Yield management analytics
        yieldManagement: yieldAnalytics,
        pricingPerformance: pricingPerformance,
        realTimeData: occupancyData
      }
    });

  } catch (error) {
    logger.error('Error getting booking analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des analytics',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ================================
 * NEW: YIELD MANAGEMENT ANALYTICS
 * ================================
 */

/**
 * Get comprehensive revenue dashboard with yield management insights
 * NEW endpoint for advanced revenue analytics
 */
const getRevenueDashboard = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { 
      startDate, 
      endDate, 
      currency = 'EUR',
      includeForecasting = 'true'
    } = req.query;

    // Validate hotel access
    if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId.toString() !== hotelId) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cet hôtel'
      });
    }

    const period = validateDateRange(startDate, endDate);
    
    // Generate comprehensive dashboard
    const dashboard = await revenueAnalyticsService.generateRevenueDashboard(
      hotelId,
      { startDate: period.start, endDate: period.end },
      currency
    );

    // Add forecasting if requested
    if (includeForecasting === 'true') {
      dashboard.forecasting = await revenueAnalyticsService.generateRevenueForecast(
        hotelId, 
        30, 
        currency
      );
    }

    // Send real-time update to dashboard subscribers
    socketService.sendHotelNotification(hotelId, 'REVENUE_DASHBOARD_UPDATE', {
      kpiMetrics: dashboard.kpiMetrics,
      timestamp: new Date()
    });

    res.json({
      success: true,
      data: dashboard
    });

  } catch (error) {
    logger.error('Error generating revenue dashboard:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du dashboard',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get yield management performance metrics
 * NEW endpoint for yield-specific analytics
 */
const getYieldPerformance = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { startDate, endDate } = req.query;

    const period = validateDateRange(startDate, endDate);
    
    const yieldPerformance = await revenueAnalyticsService.analyzeYieldPerformance(
      hotelId,
      period.start,
      period.end
    );

    // Get pricing strategy effectiveness
    const pricingStrategies = await analyzePricingStrategies(hotelId, period.start, period.end);
    
    // Calculate ROI for yield management
    const yieldROI = await calculateYieldROI(hotelId, period.start, period.end);

    res.json({
      success: true,
      data: {
        performance: yieldPerformance,
        pricingStrategies,
        roi: yieldROI,
        period: { startDate: period.start, endDate: period.end }
      }
    });

  } catch (error) {
    logger.error('Error getting yield performance:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse yield management',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get pricing optimization recommendations
 * NEW endpoint for AI-driven pricing recommendations
 */
const getPricingRecommendations = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { 
      forecastDays = 30,
      includeCompetitive = 'true',
      urgentOnly = 'false'
    } = req.query;

    // Get current hotel state
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: 'Hôtel non trouvé'
      });
    }

    // Generate comprehensive recommendations
    const [
      demandForecast,
      pricingRecommendations,
      occupancyOptimization,
      revenueOpportunities
    ] = await Promise.all([
      demandAnalyzer.predictDemand(hotelId, null, parseInt(forecastDays)),
      hotel.getPricingRecommendations(),
      analyzeOccupancyOptimization(hotelId),
      identifyRevenueOpportunities(hotelId)
    ]);

    // Filter urgent recommendations if requested
    let recommendations = pricingRecommendations;
    if (urgentOnly === 'true') {
      recommendations = recommendations.filter(rec => 
        rec.priority === 'CRITICAL' || rec.priority === 'HIGH'
      );
    }

    // Add competitive analysis if requested
    let competitiveInsights = null;
    if (includeCompetitive === 'true') {
      competitiveInsights = await analyzeCompetitivePricing(hotelId);
    }

    res.json({
      success: true,
      data: {
        recommendations,
        demandForecast,
        occupancyOptimization,
        revenueOpportunities,
        competitiveInsights,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('Error getting pricing recommendations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération des recommandations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get revenue forecasting with multiple models
 * NEW endpoint for advanced revenue forecasting
 */
const getRevenueForecast = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { 
      days = 30, 
      currency = 'EUR',
      models = 'all',
      confidence = 'true'
    } = req.query;

    const forecastData = await revenueAnalyticsService.generateRevenueForecast(
      hotelId,
      parseInt(days),
      currency
    );

    // Filter models if specific ones requested
    if (models !== 'all') {
      const requestedModels = models.split(',');
      const filteredForecasts = {};
      
      for (const model of requestedModels) {
        if (forecastData.models[model]) {
          filteredForecasts[model] = forecastData.models[model];
        }
      }
      forecastData.models = filteredForecasts;
    }

    // Add scenario analysis
    const scenarios = await generateRevenueScenarios(hotelId, parseInt(days), currency);

    res.json({
      success: true,
      data: {
        ...forecastData,
        scenarios,
        includeConfidence: confidence === 'true'
      }
    });

  } catch (error) {
    logger.error('Error generating revenue forecast:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la prévision des revenus',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ================================
 * NEW: PRICING PERFORMANCE ANALYTICS
 * ================================
 */

/**
 * Get detailed pricing performance metrics
 * NEW endpoint for pricing strategy analysis
 */
const getPricingPerformance = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { startDate, endDate, roomType = 'all' } = req.query;

    const period = validateDateRange(startDate, endDate);
    
    // Get pricing performance data
    const performance = await analyzePricingPerformance(hotelId, period.start, period.end, roomType);
    
    // Calculate pricing elasticity
    const elasticity = await calculatePricingElasticity(hotelId, period.start, period.end);
    
    // Get optimal pricing suggestions
    const optimizationSuggestions = await generateOptimizationSuggestions(hotelId, performance);

    res.json({
      success: true,
      data: {
        performance,
        elasticity,
        optimizationSuggestions,
        period: { startDate: period.start, endDate: period.end }
      }
    });

  } catch (error) {
    logger.error('Error analyzing pricing performance:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des performances tarifaires',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get customer segment revenue analysis
 * NEW endpoint for segment-based analytics
 */
const getSegmentAnalytics = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const { startDate, endDate, currency = 'EUR' } = req.query;

    const period = validateDateRange(startDate, endDate);
    
    const segmentAnalysis = await revenueAnalyticsService.analyzeRevenueSegments(
      hotelId,
      period.start,
      period.end,
      currency
    );

    // Add segment-specific recommendations
    const segmentRecommendations = generateSegmentRecommendations(segmentAnalysis);

    res.json({
      success: true,
      data: {
        ...segmentAnalysis,
        recommendations: segmentRecommendations
      }
    });

  } catch (error) {
    logger.error('Error analyzing revenue segments:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'analyse des segments',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ================================
 * REAL-TIME ANALYTICS ENDPOINTS
 * ================================
 */

/**
 * Get real-time analytics dashboard
 * NEW endpoint for live dashboard updates
 */
const getRealTimeAnalytics = async (req, res) => {
  try {
    const { hotelId } = req.params;

    // Subscribe user to real-time updates
    socketService.sendUserNotification(req.user.id, 'REALTIME_ANALYTICS_SUBSCRIPTION', {
      hotelId,
      subscribedAt: new Date()
    });

    // Get current metrics
    const realTimeMetrics = await generateRealTimeMetrics(hotelId);

    res.json({
      success: true,
      data: realTimeMetrics,
      subscription: {
        active: true,
        updateFrequency: '30s'
      }
    });

  } catch (error) {
    logger.error('Error getting real-time analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors des analytics temps réel',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * ================================
 * HELPER FUNCTIONS
 * ================================
 */

// Analyze pricing performance for a hotel
async function analyzePricingPerformance(hotelId, startDate, endDate, roomType = 'all') {
  try {
    let roomQuery = { hotel: hotelId };
    if (roomType !== 'all') {
      roomQuery.type = roomType;
    }

    const rooms = await Room.find(roomQuery);
    const performance = {};

    for (const room of rooms) {
      const priceHistory = room.priceHistory.filter(entry => 
        entry.date >= startDate && entry.date <= endDate
      );

      if (priceHistory.length > 0) {
        performance[room.type] = {
          totalAdjustments: priceHistory.length,
          averagePriceChange: priceHistory.reduce((sum, entry) => 
            sum + Math.abs(entry.dynamicPrice - entry.basePrice), 0) / priceHistory.length,
          revenueImpact: await calculateRevenueImpact(room._id, priceHistory),
          successRate: calculateAdjustmentSuccessRate(priceHistory)
        };
      }
    }

    return performance;
  } catch (error) {
    logger.error('Error analyzing pricing performance:', error);
    return {};
  }
}

// Calculate current demand level for a hotel
async function getCurrentDemandLevel(hotelId) {
  try {
    const hotel = await Hotel.findById(hotelId);
    if (!hotel || !hotel.yieldManagement?.enabled) {
      return 'NORMAL';
    }

    const occupancyRate = hotel.yieldAnalytics?.averageOccupancyRate || 0;
    const thresholds = hotel.yieldManagement.occupancyThresholds;

    if (occupancyRate >= thresholds.critical.min) return 'CRITICAL';
    if (occupancyRate >= thresholds.veryHigh.min) return 'VERY_HIGH';
    if (occupancyRate >= thresholds.high.min) return 'HIGH';
    if (occupancyRate >= thresholds.moderate.min) return 'MODERATE';
    if (occupancyRate >= thresholds.low.min) return 'LOW';
    
    return 'VERY_LOW';
  } catch (error) {
    logger.error('Error getting current demand level:', error);
    return 'NORMAL';
  }
}

// Generate real-time metrics for dashboard
async function generateRealTimeMetrics(hotelId) {
  const now = new Date();
  const today = new Date(now.setHours(0, 0, 0, 0));
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  return {
    occupancy: await availabilityRealtimeService.getRealTimeOccupancy(hotelId),
    todaysBookings: await Booking.countDocuments({
      hotel: hotelId,
      createdAt: { $gte: today, $lt: tomorrow }
    }),
    pendingApprovals: await Booking.countDocuments({
      hotel: hotelId,
      status: BOOKING_STATUS.PENDING
    }),
    currentDemand: await getCurrentDemandLevel(hotelId),
    timestamp: new Date()
  };
}

// Calculate yield management ROI
async function calculateYieldROI(hotelId, startDate, endDate) {
  // Implementation for yield ROI calculation
  // This would involve complex analysis of revenue before/after yield implementation
  return {
    roi: 15.5, // Placeholder - would be calculated based on actual data
    revenueIncrease: 12300,
    period: 'Last 30 days'
  };
}

// Generate revenue scenarios (optimistic, realistic, pessimistic)
async function generateRevenueScenarios(hotelId, days, currency) {
  const baselineForecast = await revenueAnalyticsService.generateRevenueForecast(hotelId, days, currency);
  
  if (!baselineForecast.ensemble?.forecast) {
    return null;
  }

  return {
    optimistic: baselineForecast.ensemble.forecast.map(day => ({
      ...day,
      predictedRevenue: day.predictedRevenue * 1.15 // 15% higher
    })),
    realistic: baselineForecast.ensemble.forecast,
    pessimistic: baselineForecast.ensemble.forecast.map(day => ({
      ...day,
      predictedRevenue: day.predictedRevenue * 0.85 // 15% lower
    }))
  };
}

/**
 * ================================
 * EXPORTED ROUTES
 * ================================
 */

module.exports = {
  // Enhanced existing endpoints
  getBookingAnalytics,
  
  // NEW: Yield management endpoints
  getRevenueDashboard,
  getYieldPerformance,
  getPricingRecommendations,
  getRevenueForecast,
  
  // NEW: Pricing performance endpoints
  getPricingPerformance,
  getSegmentAnalytics,
  
  // NEW: Real-time analytics
  getRealTimeAnalytics
};