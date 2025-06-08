/**
 * YIELD MANAGEMENT ROUTES - Week 3 Advanced Features
 * Comprehensive yield management and dynamic pricing system
 * 
 * ✅ CORRECTIONS APPLIQUÉES:
 * - Constants integration fixed (USER_ROLES vs ROLES)
 * - Services method verification and compatibility
 * - Enhanced error handling with Socket.io integration
 * - Real-time notifications and broadcasting
 * - Validation middleware improvements
 * - Models integration verified
 */

const express = require('express');
const router = express.Router();

// Middleware imports
const { protect, authorize } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { rateLimitMiddleware } = require('../middleware/rateLimiting');

// Service imports - VERIFIED INTEGRATION
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const revenueAnalytics = require('../services/revenueAnalytics');
const notificationService = require('../services/notificationService');
const socketService = require('../services/socketService'); // Added for real-time updates

// Model imports
const Hotel = require('../models/Hotel');
const PricingRule = require('../models/PricingRule');
const Booking = require('../models/Booking');

// Utils - FIXED CONSTANTS IMPORT
const { logger } = require('../utils/logger');
const { USER_ROLES } = require('../utils/constants'); // Fixed: USER_ROLES instead of ROLES

/**
 * ================================
 * MIDDLEWARE SETUP
 * ================================
 */

// Apply authentication to all routes
router.use(protect);

// Rate limiting for yield management endpoints
router.use(rateLimitMiddleware({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many yield management requests'
}));

/**
 * ================================
 * REAL-TIME PRICING ENDPOINTS
 * ================================
 */

/**
 * @desc    Get real-time price for specific room and dates
 * @route   POST /api/yield/price/calculate
 * @access  Client, Receptionist, Admin
 */
router.post('/price/calculate', 
  validateRequest({
    hotelId: 'required|string',
    roomType: 'required|string|in:SIMPLE,DOUBLE,DOUBLE_CONFORT,SUITE',
    checkInDate: 'required|date',
    checkOutDate: 'required|date',
    guests: 'integer|min:1|max:10',
    useYieldManagement: 'boolean'
  }),
  async (req, res) => {
    try {
      const { hotelId, roomType, checkInDate, checkOutDate, guests = 2, useYieldManagement = true } = req.body;

      // Permission check for receptionist - FIXED
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // Initialize yield manager if needed
      if (!yieldManager.initialized) {
        await yieldManager.initialize();
      }

      // FIXED: Use correct method name based on yieldManager.js
      const pricingResult = await yieldManager.calculateDynamicPrice({
        hotelId,
        roomType,
        checkInDate: new Date(checkInDate),
        checkOutDate: new Date(checkOutDate),
        guestCount: guests,
        strategy: 'MODERATE',
        baseCurrency: 'EUR'
      });

      // Real-time price broadcasting
      if (socketService.io) {
        socketService.broadcastPriceUpdate(hotelId, {
          roomType,
          newPrice: pricingResult.dynamicPrice,
          factors: pricingResult.factors,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        data: {
          price: pricingResult.dynamicPrice,
          basePrice: pricingResult.basePrice,
          totalPrice: pricingResult.totalPrice,
          factors: pricingResult.factors,
          recommendations: pricingResult.recommendations,
          confidence: pricingResult.confidence,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Error calculating price:', error);
      
      // Real-time error notification
      if (socketService.io && req.user.role === USER_ROLES.ADMIN) {
        socketService.sendAdminNotification('pricing_error', {
          hotelId: req.body.hotelId,
          error: error.message,
          timestamp: new Date()
        });
      }

      res.status(500).json({
        success: false,
        message: 'Erreur lors du calcul du prix',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * @desc    Get price evolution forecast for upcoming period
 * @route   GET /api/yield/price/forecast/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/price/forecast/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST), // Fixed constants
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { roomType = 'DOUBLE', days = 30 } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Check if method exists before calling
      if (!yieldManager.getPriceForecast) {
        throw new Error('Price forecast service not available');
      }

      const forecast = await yieldManager.getPriceForecast({
        hotelId,
        roomType,
        days: parseInt(days),
        includeFactors: true
      });

      res.json({
        success: true,
        data: forecast
      });

    } catch (error) {
      logger.error('Error getting price forecast:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la prévision de prix',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * ================================
 * YIELD MANAGEMENT CONFIGURATION
 * ================================
 */

/**
 * @desc    Get yield management settings for hotel
 * @route   GET /api/yield/settings/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/settings/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      const hotel = await Hotel.findById(hotelId).select('yieldManagement name');
      if (!hotel) {
        return res.status(404).json({
          success: false,
          message: 'Hôtel non trouvé'
        });
      }

      res.json({
        success: true,
        data: {
          hotelId,
          hotelName: hotel.name,
          yieldManagement: hotel.yieldManagement || {
            enabled: false,
            strategy: 'CONSERVATIVE'
          }
        }
      });

    } catch (error) {
      logger.error('Error getting yield settings:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des paramètres'
      });
    }
  }
);

/**
 * @desc    Update yield management settings
 * @route   PUT /api/yield/settings/:hotelId
 * @access  Admin only
 */
router.put('/settings/:hotelId',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    enabled: 'boolean',
    strategy: 'string|in:CONSERVATIVE,MODERATE,AGGRESSIVE',
    basePricing: 'object',
    occupancyThresholds: 'object',
    leadTimePricing: 'array',
    lengthOfStayDiscounts: 'array',
    eventPricing: 'array'
  }),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const yieldSettings = req.body;

      const hotel = await Hotel.findById(hotelId);
      if (!hotel) {
        return res.status(404).json({
          success: false,
          message: 'Hôtel non trouvé'
        });
      }

      // Update yield management settings
      hotel.yieldManagement = {
        ...hotel.yieldManagement,
        ...yieldSettings,
        lastUpdated: new Date(),
        updatedBy: req.user.userId // Fixed: use userId instead of id
      };

      await hotel.save();

      // Log configuration change
      logger.info(`Yield management settings updated for hotel ${hotelId} by user ${req.user.userId}`);

      // Real-time notification to relevant users
      if (socketService.io) {
        socketService.sendAdminNotification('yield_settings_updated', {
          hotelId,
          updatedBy: req.user.userId,
          settings: yieldSettings,
          timestamp: new Date()
        });
      }

      // Notify via notification service
      await notificationService.emit('yield:settings_updated', {
        hotelId,
        updatedBy: req.user.userId,
        settings: yieldSettings
      });

      res.json({
        success: true,
        message: 'Paramètres de yield management mis à jour',
        data: hotel.yieldManagement
      });

    } catch (error) {
      logger.error('Error updating yield settings:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la mise à jour des paramètres'
      });
    }
  }
);

/**
 * ================================
 * PRICING RULES MANAGEMENT
 * ================================
 */

/**
 * @desc    Get all pricing rules for hotel
 * @route   GET /api/yield/rules/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/rules/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { active, type } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Use correct field name from PricingRule model
      const query = { hotelId: hotelId }; // Changed from 'hotel' to 'hotelId'
      if (active !== undefined) query.isActive = active === 'true';
      if (type) query.ruleType = type;

      const rules = await PricingRule.find(query)
        .populate('createdBy', 'firstName lastName')
        .sort({ priority: -1, createdAt: -1 });

      res.json({
        success: true,
        data: rules
      });

    } catch (error) {
      logger.error('Error getting pricing rules:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des règles'
      });
    }
  }
);

/**
 * @desc    Create new pricing rule
 * @route   POST /api/yield/rules/:hotelId
 * @access  Admin only
 */
router.post('/rules/:hotelId',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    name: 'required|string|max:100',
    ruleType: 'required|string|in:OCCUPANCY,LEAD_TIME,SEASONAL,EVENT,DEMAND',
    adjustmentType: 'required|string|in:PERCENTAGE,FIXED_AMOUNT,ABSOLUTE_PRICE,MULTIPLIER',
    adjustmentValue: 'required|number|min:0.1|max:5.0',
    priority: 'integer|min:1|max:100',
    validFrom: 'date',
    validUntil: 'date'
  }),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const ruleData = { 
        ...req.body, 
        hotelId: hotelId, // Fixed: use hotelId instead of hotel
        createdBy: req.user.userId 
      };

      const rule = new PricingRule(ruleData);
      await rule.save();

      await rule.populate('createdBy', 'firstName lastName');

      logger.info(`Pricing rule created for hotel ${hotelId} by user ${req.user.userId}`);

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('pricing_rule_created', {
          hotelId,
          ruleId: rule._id,
          ruleName: rule.name,
          createdBy: req.user.userId,
          timestamp: new Date()
        });
      }

      res.status(201).json({
        success: true,
        message: 'Règle de tarification créée',
        data: rule
      });

    } catch (error) {
      logger.error('Error creating pricing rule:', error);
      res.status(400).json({
        success: false,
        message: 'Erreur lors de la création de la règle',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }
);

/**
 * @desc    Update pricing rule
 * @route   PUT /api/yield/rules/:ruleId
 * @access  Admin only
 */
router.put('/rules/:ruleId',
  authorize(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { ruleId } = req.params;
      const updates = { ...req.body, updatedBy: req.user.userId, updatedAt: new Date() };

      const rule = await PricingRule.findByIdAndUpdate(
        ruleId,
        updates,
        { new: true, runValidators: true }
      ).populate('createdBy updatedBy', 'firstName lastName');

      if (!rule) {
        return res.status(404).json({
          success: false,
          message: 'Règle non trouvée'
        });
      }

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('pricing_rule_updated', {
          hotelId: rule.hotelId,
          ruleId: rule._id,
          ruleName: rule.name,
          updatedBy: req.user.userId,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        message: 'Règle de tarification mise à jour',
        data: rule
      });

    } catch (error) {
      logger.error('Error updating pricing rule:', error);
      res.status(400).json({
        success: false,
        message: 'Erreur lors de la mise à jour de la règle'
      });
    }
  }
);

/**
 * @desc    Delete pricing rule
 * @route   DELETE /api/yield/rules/:ruleId
 * @access  Admin only
 */
router.delete('/rules/:ruleId',
  authorize(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      const { ruleId } = req.params;

      const rule = await PricingRule.findByIdAndDelete(ruleId);
      if (!rule) {
        return res.status(404).json({
          success: false,
          message: 'Règle non trouvée'
        });
      }

      logger.info(`Pricing rule ${ruleId} deleted by user ${req.user.userId}`);

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('pricing_rule_deleted', {
          hotelId: rule.hotelId,
          ruleId: rule._id,
          ruleName: rule.name,
          deletedBy: req.user.userId,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        message: 'Règle de tarification supprimée'
      });

    } catch (error) {
      logger.error('Error deleting pricing rule:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la suppression de la règle'
      });
    }
  }
);

/**
 * ================================
 * ANALYTICS & REPORTING
 * ================================
 */

/**
 * @desc    Get yield management analytics
 * @route   GET /api/yield/analytics/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/analytics/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { period = '30d', roomType, includeForecasting = 'false' } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Check if service method exists
      if (!revenueAnalytics.getYieldAnalytics) {
        // Fallback to dashboard method
        const analytics = await revenueAnalytics.generateRevenueDashboard(hotelId, {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date()
        });
        
        return res.json({
          success: true,
          data: analytics
        });
      }

      const analytics = await revenueAnalytics.getYieldAnalytics({
        hotelId,
        period,
        roomType,
        includeForecasting: includeForecasting === 'true'
      });

      res.json({
        success: true,
        data: analytics
      });

    } catch (error) {
      logger.error('Error getting yield analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des analyses'
      });
    }
  }
);

/**
 * @desc    Get yield performance metrics
 * @route   GET /api/yield/performance/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/performance/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { startDate, endDate, compare = 'previous_period' } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Use available method from revenueAnalytics
      const performance = await revenueAnalytics.calculateKPIMetrics(
        hotelId,
        startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate ? new Date(endDate) : new Date(),
        'EUR'
      );

      res.json({
        success: true,
        data: performance
      });

    } catch (error) {
      logger.error('Error getting yield performance:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des performances'
      });
    }
  }
);

/**
 * @desc    Get demand analysis for hotel
 * @route   GET /api/yield/demand/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/demand/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { forecastDays = 30, includeHistorical = 'true' } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Use correct method from demandAnalyzer
      const startDate = new Date();
      const endDate = new Date(Date.now() + parseInt(forecastDays) * 24 * 60 * 60 * 1000);
      
      const demandAnalysis = await demandAnalyzer.analyzeDemand(
        hotelId,
        startDate,
        endDate,
        { includeHistorical: includeHistorical === 'true' }
      );

      res.json({
        success: true,
        data: demandAnalysis
      });

    } catch (error) {
      logger.error('Error getting demand analysis:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'analyse de la demande'
      });
    }
  }
);

/**
 * @desc    Get yield optimization recommendations
 * @route   GET /api/yield/recommendations/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/recommendations/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { timeHorizon = '7d', includeAutomation = 'false' } = req.query;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // FIXED: Check if method exists, otherwise use hotel method
      let recommendations;
      
      if (yieldManager.getOptimizationRecommendations) {
        recommendations = await yieldManager.getOptimizationRecommendations({
          hotelId,
          timeHorizon,
          includeAutomation: includeAutomation === 'true'
        });
      } else {
        // Fallback to hotel method
        const hotel = await Hotel.findById(hotelId);
        if (hotel && hotel.getPricingRecommendations) {
          recommendations = await hotel.getPricingRecommendations();
        } else {
          recommendations = {
            recommendations: [],
            message: 'Recommendations service not available'
          };
        }
      }

      res.json({
        success: true,
        data: recommendations
      });

    } catch (error) {
      logger.error('Error getting yield recommendations:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des recommandations'
      });
    }
  }
);

/**
 * ================================
 * ADMIN CONTROL ENDPOINTS
 * ================================
 */

/**
 * @desc    Apply manual price adjustment
 * @route   POST /api/yield/adjustment/:hotelId
 * @access  Admin only
 */
router.post('/adjustment/:hotelId',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    roomType: 'required|string|in:SIMPLE,DOUBLE,DOUBLE_CONFORT,SUITE',
    adjustmentType: 'required|string|in:PERCENTAGE,FIXED_AMOUNT,MULTIPLIER',
    adjustmentValue: 'required|number',
    reason: 'required|string|max:255',
    applyImmediately: 'boolean',
    validFrom: 'date',
    validUntil: 'date'
  }),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { roomType, adjustmentType, adjustmentValue, reason, applyImmediately = true, validFrom, validUntil } = req.body;

      // Create pricing rule for manual adjustment
      const adjustmentRule = new PricingRule({
        name: `Manual Adjustment - ${roomType} - ${new Date().toISOString()}`,
        ruleType: 'PROMOTIONAL',
        hotelId: hotelId,
        roomTypes: [roomType],
        adjustmentType,
        adjustmentValue,
        validFrom: validFrom ? new Date(validFrom) : new Date(),
        validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days default
        isActive: applyImmediately,
        priority: 10, // High priority for manual adjustments
        notes: reason,
        createdBy: req.user.userId
      });

      await adjustmentRule.save();

      logger.info(`Manual price adjustment applied for hotel ${hotelId} by user ${req.user.userId}`);

      // Real-time notifications
      if (socketService.io) {
        socketService.broadcastPriceUpdate(hotelId, {
          roomType,
          adjustment: { type: adjustmentType, value: adjustmentValue },
          reason,
          appliedBy: req.user.userId,
          timestamp: new Date()
        });

        socketService.sendAdminNotification('manual_price_adjustment', {
          hotelId,
          roomType,
          adjustmentType,
          adjustmentValue,
          appliedBy: req.user.userId,
          reason,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        message: 'Ajustement de prix appliqué',
        data: {
          ruleId: adjustmentRule._id,
          adjustment: { type: adjustmentType, value: adjustmentValue },
          validFrom: adjustmentRule.validFrom,
          validUntil: adjustmentRule.validUntil,
          active: adjustmentRule.isActive
        }
      });

    } catch (error) {
      logger.error('Error applying price adjustment:', error);
      res.status(400).json({
        success: false,
        message: 'Erreur lors de l\'ajustement de prix'
      });
    }
  }
);

/**
 * @desc    Bulk update pricing across multiple room types
 * @route   POST /api/yield/bulk-update/:hotelId
 * @access  Admin only
 */
router.post('/bulk-update/:hotelId',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    adjustments: 'required|array',
    effectiveDate: 'date',
    reason: 'required|string|max:255'
  }),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { adjustments, effectiveDate, reason } = req.body;

      const results = {
        successful: 0,
        failed: 0,
        details: []
      };

      // Process each adjustment
      for (const adjustment of adjustments) {
        try {
          const adjustmentRule = new PricingRule({
            name: `Bulk Update - ${adjustment.roomType} - ${new Date().toISOString()}`,
            ruleType: 'PROMOTIONAL',
            hotelId: hotelId,
            roomTypes: [adjustment.roomType],
            adjustmentType: adjustment.type,
            adjustmentValue: adjustment.value,
            validFrom: effectiveDate ? new Date(effectiveDate) : new Date(),
            validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days default
            isActive: true,
            priority: 8, // Lower than manual adjustments
            notes: reason,
            createdBy: req.user.userId
          });

          await adjustmentRule.save();
          results.successful++;
          results.details.push({
            roomType: adjustment.roomType,
            status: 'SUCCESS',
            ruleId: adjustmentRule._id
          });

        } catch (adjustmentError) {
          results.failed++;
          results.details.push({
            roomType: adjustment.roomType,
            status: 'FAILED',
            error: adjustmentError.message
          });
        }
      }

      logger.info(`Bulk price adjustments applied for hotel ${hotelId} by user ${req.user.userId}: ${results.successful} successful, ${results.failed} failed`);

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('bulk_price_update', {
          hotelId,
          adjustments: adjustments.length,
          successful: results.successful,
          failed: results.failed,
          appliedBy: req.user.userId,
          reason,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        message: `${results.successful} ajustements appliqués avec succès`,
        data: results
      });

    } catch (error) {
      logger.error('Error applying bulk adjustments:', error);
      res.status(400).json({
        success: false,
        message: 'Erreur lors des ajustements groupés'
      });
    }
  }
);

/**
 * @desc    Override yield management for specific period
 * @route   POST /api/yield/override/:hotelId
 * @access  Admin only
 */
router.post('/override/:hotelId',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    startDate: 'required|date',
    endDate: 'required|date',
    roomTypes: 'array',
    overrideType: 'required|string|in:DISABLE,CUSTOM_MULTIPLIER,FIXED_PRICE',
    overrideValue: 'required|number',
    reason: 'required|string|max:255'
  }),
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { startDate, endDate, roomTypes = [], overrideType, overrideValue, reason } = req.body;

      // Create override rule
      const overrideRule = new PricingRule({
        name: `Override - ${overrideType} - ${new Date().toISOString()}`,
        ruleType: 'PROMOTIONAL',
        hotelId: hotelId,
        roomTypes: roomTypes.length > 0 ? roomTypes : ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'],
        adjustmentType: overrideType === 'FIXED_PRICE' ? 'ABSOLUTE_PRICE' : 'MULTIPLIER',
        adjustmentValue: overrideValue,
        validFrom: new Date(startDate),
        validUntil: new Date(endDate),
        isActive: overrideType !== 'DISABLE',
        priority: 15, // Highest priority for overrides
        notes: `Override: ${reason}`,
        createdBy: req.user.userId
      });

      await overrideRule.save();

      // If disabling yield management, update hotel settings
      if (overrideType === 'DISABLE') {
        await Hotel.findByIdAndUpdate(hotelId, {
          'yieldManagement.overrideActive': true,
          'yieldManagement.overrideUntil': new Date(endDate),
          'yieldManagement.overrideReason': reason
        });
      }

      logger.info(`Yield override created for hotel ${hotelId} by user ${req.user.userId}`);

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('yield_override_created', {
          hotelId,
          overrideType,
          startDate,
          endDate,
          appliedBy: req.user.userId,
          reason,
          timestamp: new Date()
        });
      }

      res.status(201).json({
        success: true,
        message: 'Override yield management créé',
        data: {
          ruleId: overrideRule._id,
          overrideType,
          validFrom: overrideRule.validFrom,
          validUntil: overrideRule.validUntil,
          roomTypes: overrideRule.roomTypes,
          value: overrideValue
        }
      });

    } catch (error) {
      logger.error('Error creating yield override:', error);
      res.status(400).json({
        success: false,
        message: 'Erreur lors de la création de l\'override'
      });
    }
  }
);

/**
 * ================================
 * SYSTEM MONITORING
 * ================================
 */

/**
 * @desc    Get yield management system status
 * @route   GET /api/yield/system/status
 * @access  Admin only
 */
router.get('/system/status',
  authorize(USER_ROLES.ADMIN),
  async (req, res) => {
    try {
      // FIXED: Use available methods from services
      const status = {
        yieldManager: {
          initialized: yieldManager.initialized || false,
          status: 'operational'
        },
        demandAnalyzer: {
          status: 'operational'
        },
        revenueAnalytics: {
          status: 'operational'
        },
        services: {
          socketService: socketService.io ? 'connected' : 'disconnected',
          notificationService: 'operational'
        },
        timestamp: new Date()
      };

      // Get system stats if available
      if (yieldManager.getSystemStats) {
        status.yieldManager.stats = yieldManager.getSystemStats();
      }

      if (revenueAnalytics.getServiceStats) {
        status.revenueAnalytics.stats = revenueAnalytics.getServiceStats();
      }

      res.json({
        success: true,
        data: status
      });

    } catch (error) {
      logger.error('Error getting system status:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du statut système'
      });
    }
  }
);

/**
 * @desc    Trigger manual yield calculations
 * @route   POST /api/yield/system/recalculate
 * @access  Admin only
 */
router.post('/system/recalculate',
  authorize(USER_ROLES.ADMIN),
  validateRequest({
    hotelIds: 'array',
    force: 'boolean'
  }),
  async (req, res) => {
    try {
      const { hotelIds, force = false } = req.body;

      const results = {
        processed: 0,
        successful: 0,
        failed: 0,
        details: []
      };

      // Get hotels to process
      const hotelsToProcess = hotelIds && hotelIds.length > 0 
        ? await Hotel.find({ _id: { $in: hotelIds }, 'yieldManagement.enabled': true })
        : await Hotel.find({ 'yieldManagement.enabled': true });

      for (const hotel of hotelsToProcess) {
        try {
          results.processed++;

          // Update yield analytics
          if (hotel.updateYieldAnalytics) {
            await hotel.updateYieldAnalytics();
          }

          // Trigger price updates if yield manager supports it
          if (yieldManager.updatePricingForHotel) {
            await yieldManager.updatePricingForHotel(hotel._id);
          }

          results.successful++;
          results.details.push({
            hotelId: hotel._id,
            hotelName: hotel.name,
            status: 'SUCCESS'
          });

        } catch (hotelError) {
          results.failed++;
          results.details.push({
            hotelId: hotel._id,
            hotelName: hotel.name,
            status: 'FAILED',
            error: hotelError.message
          });
        }
      }

      logger.info(`Manual yield recalculation triggered by user ${req.user.userId}: ${results.successful}/${results.processed} successful`);

      // Real-time notification
      if (socketService.io) {
        socketService.sendAdminNotification('yield_recalculation_complete', {
          triggeredBy: req.user.userId,
          processed: results.processed,
          successful: results.successful,
          failed: results.failed,
          timestamp: new Date()
        });
      }

      res.json({
        success: true,
        message: 'Recalcul déclenché',
        data: results
      });

    } catch (error) {
      logger.error('Error triggering recalculation:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors du déclenchement du recalcul'
      });
    }
  }
);

/**
 * ================================
 * REAL-TIME INTEGRATION ENDPOINTS
 * ================================
 */

/**
 * @desc    Get real-time yield dashboard data
 * @route   GET /api/yield/realtime/dashboard/:hotelId
 * @access  Admin, Receptionist
 */
router.get('/realtime/dashboard/:hotelId',
  authorize(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { hotelId } = req.params;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // Join real-time yield dashboard room
      if (socketService.io && socketService.isUserConnected && socketService.isUserConnected(req.user.userId)) {
        if (socketService.joinYieldDashboardRoom) {
          socketService.joinYieldDashboardRoom(req.user.userId, hotelId);
        }
      }

      // Get dashboard data
      const dashboardData = {
        hotelId,
        lastUpdate: new Date(),
        occupancy: await getRealtimeOccupancy(hotelId),
        pricing: await getRealtimePricing(hotelId),
        revenue: await getRealtimeRevenue(hotelId),
        alerts: await getYieldAlerts(hotelId)
      };

      res.json({
        success: true,
        data: dashboardData,
        realtime: true
      });

    } catch (error) {
      logger.error('Error getting real-time yield dashboard:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du dashboard en temps réel'
      });
    }
  }
);

/**
 * @desc    Subscribe to real-time price updates
 * @route   POST /api/yield/realtime/subscribe-prices/:hotelId
 * @access  Client, Receptionist, Admin
 */
router.post('/realtime/subscribe-prices/:hotelId',
  async (req, res) => {
    try {
      const { hotelId } = req.params;
      const { roomTypes = [] } = req.body;

      // Permission check for receptionist
      if (req.user.role === USER_ROLES.RECEPTIONIST && req.user.hotelId?.toString() !== hotelId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cet hôtel'
        });
      }

      // Subscribe to price updates via WebSocket
      if (socketService.io && socketService.subscribeToPriceUpdates) {
        socketService.subscribeToPriceUpdates(req.user.userId, hotelId, roomTypes);
      }

      res.json({
        success: true,
        message: 'Abonnement aux mises à jour de prix activé',
        subscription: {
          hotelId,
          roomTypes: roomTypes.length > 0 ? roomTypes : 'ALL',
          userId: req.user.userId,
          timestamp: new Date()
        }
      });

    } catch (error) {
      logger.error('Error subscribing to price updates:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'abonnement aux mises à jour'
      });
    }
  }
);

/**
 * ================================
 * HELPER FUNCTIONS FOR REAL-TIME DATA
 * ================================
 */

async function getRealtimeOccupancy(hotelId) {
  try {
    const today = new Date();
    const hotel = await Hotel.findById(hotelId);
    
    if (hotel && hotel.calculateOccupancyForDate) {
      const occupancy = await hotel.calculateOccupancyForDate(today);
      return {
        current: occupancy,
        trend: 'stable', // Could be calculated from historical data
        lastUpdate: new Date()
      };
    }

    return {
      current: 0,
      trend: 'unknown',
      lastUpdate: new Date()
    };
  } catch (error) {
    logger.error('Error getting realtime occupancy:', error);
    return { current: 0, trend: 'error', lastUpdate: new Date() };
  }
}

async function getRealtimePricing(hotelId) {
  try {
    const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];
    const pricing = {};

    for (const roomType of roomTypes) {
      try {
        if (yieldManager.getDynamicPricing) {
          const price = await yieldManager.getDynamicPricing(hotelId, roomType, new Date());
          pricing[roomType] = {
            current: price.dynamicPrice || price,
            base: price.basePrice || price,
            factor: price.factors?.totalFactor || 1.0,
            lastUpdate: new Date()
          };
        } else {
          // Fallback to hotel method
          const hotel = await Hotel.findById(hotelId);
          if (hotel && hotel.getDynamicPrice) {
            const price = await hotel.getDynamicPrice(roomType, new Date());
            pricing[roomType] = {
              current: price,
              base: price,
              factor: 1.0,
              lastUpdate: new Date()
            };
          }
        }
      } catch (roomError) {
        pricing[roomType] = {
          current: 0,
          base: 0,
          factor: 1.0,
          error: roomError.message,
          lastUpdate: new Date()
        };
      }
    }

    return pricing;
  } catch (error) {
    logger.error('Error getting realtime pricing:', error);
    return {};
  }
}

async function getRealtimeRevenue(hotelId) {
  try {
    const today = new Date();
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const todaysBookings = await Booking.find({
      hotel: hotelId,
      createdAt: { $gte: startOfDay },
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
    });

    const revenue = todaysBookings.reduce((sum, booking) => sum + (booking.totalAmount || 0), 0);

    return {
      today: revenue,
      bookings: todaysBookings.length,
      average: todaysBookings.length > 0 ? revenue / todaysBookings.length : 0,
      lastUpdate: new Date()
    };
  } catch (error) {
    logger.error('Error getting realtime revenue:', error);
    return { today: 0, bookings: 0, average: 0, lastUpdate: new Date() };
  }
}

async function getYieldAlerts(hotelId) {
  try {
    const alerts = [];
    const hotel = await Hotel.findById(hotelId);
    
    if (!hotel) return alerts;

    // Check if yield management is enabled
    if (!hotel.yieldManagement?.enabled) {
      alerts.push({
        type: 'WARNING',
        message: 'Yield management is disabled',
        severity: 'MEDIUM',
        timestamp: new Date()
      });
    }

    // Check for pricing rules expiring soon
    const expiringRules = await PricingRule.find({
      hotelId,
      isActive: true,
      validUntil: { 
        $gte: new Date(), 
        $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // Next 7 days
      }
    });

    if (expiringRules.length > 0) {
      alerts.push({
        type: 'INFO',
        message: `${expiringRules.length} pricing rules expiring soon`,
        severity: 'LOW',
        timestamp: new Date()
      });
    }

    return alerts;
  } catch (error) {
    logger.error('Error getting yield alerts:', error);
    return [];
  }
}

/**
 * ================================
 * ERROR HANDLING
 * ================================
 */

// Global error handler for yield routes with real-time notifications
router.use((error, req, res, next) => {
  logger.error('Yield Management Route Error:', error);

  // Send real-time error notification to admins
  if (socketService.io && req.user?.role === USER_ROLES.ADMIN) {
    socketService.sendAdminNotification('yield_route_error', {
      route: req.originalUrl,
      method: req.method,
      error: error.message,
      userId: req.user.userId,
      timestamp: new Date()
    });
  }

  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Données de validation invalides',
      errors: error.errors
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'ID invalide fourni'
    });
  }

  if (error.code === 11000) {
    return res.status(400).json({
      success: false,
      message: 'Données dupliquées détectées'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Erreur interne du serveur yield management',
    error: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

module.exports = router;