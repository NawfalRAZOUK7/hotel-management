/**
 * Advanced Notification Service - FULL INTEGRATION
 * Centralized notification management for hotel management system
 * Supports Email, SMS, Socket.io real-time notifications + Full Yield Management + QR Code + Cache Alerts
 */

const EventEmitter = require('events');
const emailService = require('./emailService');
const smsService = require('./smsService');
const socketService = require('./socketService');
const currencyService = require('./currencyService');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const { logger } = require('../utils/logger');

// Import Yield Management constants
const {
  OCCUPANCY_THRESHOLDS,
  DEMAND_LEVELS,
  DEMAND_PRICE_MULTIPLIERS,
  YIELD_LIMITS,
  PRICING_RULE_TYPES,
  PERFORMANCE_METRICS,
  USER_ROLES,
} = require('../utils/constants');

class NotificationService extends EventEmitter {
  constructor() {
    super();
    this.notificationQueue = [];
    this.retryAttempts = 3;
    this.retryDelay = 5000; // 5 seconds

    // Notification configuration
    this.channels = {
      email: true,
      sms: true,
      socket: true,
      push: false, // Not implemented yet
    };

    // ================================
    // YIELD MANAGEMENT ALERT CONFIG (CONSERVÉ)
    // ================================
    this.yieldAlerts = {
      enabled: process.env.YIELD_ALERTS_ENABLED === 'true',

      thresholds: {
        occupancy: {
          critical: 95,
          high: 85,
          low: 30,
          veryLow: 15,
        },
        priceChange: {
          significant: 15,
          major: 25,
        },
        revenue: {
          target: 100,
          critical: 80,
        },
        demand: {
          surge: 'VERY_HIGH',
          drop: 'VERY_LOW',
        },
      },

      rateLimiting: {
        priceUpdate: 300000, // 5 minutes
        demandSurge: 900000, // 15 minutes
        occupancyCritical: 1800000, // 30 minutes
        revenueAlert: 3600000, // 1 hour
      },

      lastAlerts: new Map(),
    };

    // ================================
    // NOUVEAU : QR CODE ALERT CONFIG
    // ================================
    this.qrAlerts = {
      enabled: process.env.QR_ALERTS_ENABLED !== 'false',

      thresholds: {
        generation: {
          dailyLimit: 1000, // Daily QR generation limit
          userLimit: 50, // Per user daily limit
          bulkWarning: 100, // Bulk operation warning
        },
        usage: {
          failureRate: 10, // % failure rate threshold
          expiryWarning: 24, // Hours before expiry warning
          securityAlert: 5, // Failed validations per hour
        },
        performance: {
          responseTime: 3000, // Max response time in ms
          errorRate: 5, // % error rate threshold
          queueSize: 50, // Max queue size
        },
      },

      rateLimiting: {
        qrGenerated: 60000, // 1 minute between generation alerts
        qrFailure: 300000, // 5 minutes between failure alerts
        securityAlert: 600000, // 10 minutes between security alerts
        performanceAlert: 1800000, // 30 minutes between performance alerts
      },

      lastAlerts: new Map(),
    };

    // ================================
    // NOUVEAU : CACHE ALERT CONFIG
    // ================================
    this.cacheAlerts = {
      enabled: process.env.CACHE_ALERTS_ENABLED !== 'false',

      thresholds: {
        performance: {
          hitRateWarning: 70, // % hit rate warning threshold
          hitRateCritical: 50, // % hit rate critical threshold
          responseTime: 1000, // Max response time in ms
          errorRate: 5, // % error rate threshold
        },
        redis: {
          connectionWarning: 1, // Redis connection issues
          memoryWarning: 80, // % memory usage warning
          memoryCritical: 95, // % memory usage critical
        },
        invalidation: {
          dailyLimit: 1000, // Daily invalidation limit
          bulkWarning: 100, // Bulk invalidation warning
          frequencyAlert: 50, // Invalidations per hour alert
        },
      },
      rateLimiting: {
        performanceAlert: 300000, // 5 minutes between performance alerts
        redisAlert: 600000, // 10 minutes between Redis alerts
        invalidationAlert: 1800000, // 30 minutes between invalidation alerts
      },

      lastAlerts: new Map(),
    };

    // Yield notification templates cache (CONSERVÉ)
    this.yieldTemplates = new Map();

    // NOUVEAU : QR notification templates cache
    this.qrTemplates = new Map();

    // NOUVEAU : Cache notification templates cache
    this.cacheTemplates = new Map();

    // Initialize event listeners (including yield + QR + cache)
    this.setupEventListeners();
    logger.info('Notification Service initialized successfully with Yield + QR + Cache Alerts');
  }

  /**
   * Setup event listeners for automatic notifications + YIELD + QR + CACHE
   */
  setupEventListeners() {
    // ================================
    // EXISTING BOOKING EVENTS (CONSERVÉ)
    // ================================
    this.on('booking:created', this.handleBookingCreated.bind(this));
    this.on('booking:confirmed', this.handleBookingConfirmed.bind(this));
    this.on('booking:rejected', this.handleBookingRejected.bind(this));
    this.on('booking:cancelled', this.handleBookingCancelled.bind(this));
    this.on('booking:checkin', this.handleCheckIn.bind(this));
    this.on('booking:checkout', this.handleCheckOut.bind(this));

    // Payment events
    this.on('payment:received', this.handlePaymentReceived.bind(this));
    this.on('payment:failed', this.handlePaymentFailed.bind(this));
    this.on('payment:reminder', this.handlePaymentReminder.bind(this));
    this.on('invoice:generated', this.handleInvoiceGenerated.bind(this));

    // System events
    this.on('system:alert', this.handleSystemAlert.bind(this));
    this.on('maintenance:scheduled', this.handleMaintenanceNotice.bind(this));

    // Loyalty & Marketing events
    this.on('loyalty:points_earned', this.handleLoyaltyPointsEarned.bind(this));
    this.on('promotion:new', this.handlePromotionalOffer.bind(this));

    // ================================
    // YIELD MANAGEMENT EVENTS (CONSERVÉ)
    // ================================

    // Core Yield Events
    this.on('yield:price_updated', this.handleYieldPriceUpdate.bind(this));
    this.on('yield:demand_surge', this.handleYieldDemandSurge.bind(this));
    this.on('yield:demand_drop', this.handleYieldDemandDrop.bind(this));
    this.on('yield:occupancy_critical', this.handleYieldOccupancyCritical.bind(this));
    this.on('yield:occupancy_low', this.handleYieldOccupancyLow.bind(this));
    this.on('yield:revenue_optimization', this.handleYieldRevenueOptimization.bind(this));
    this.on('yield:performance_alert', this.handleYieldPerformanceAlert.bind(this));

    // Revenue & Performance Events
    this.on('yield:revenue_milestone', this.handleYieldRevenueMilestone.bind(this));
    this.on('yield:revenue_target_missed', this.handleYieldRevenueTargetMissed.bind(this));
    this.on('yield:strategy_effectiveness', this.handleYieldStrategyEffectiveness.bind(this));
    this.on('yield:competitor_alert', this.handleYieldCompetitorAlert.bind(this));

    // Pricing & Rules Events
    this.on('yield:pricing_rule_triggered', this.handleYieldPricingRuleTriggered.bind(this));
    this.on('yield:pricing_recommendation', this.handleYieldPricingRecommendation.bind(this));
    this.on('yield:price_elasticity_change', this.handleYieldPriceElasticityChange.bind(this));

    // Customer-focused Events
    this.on('yield:customer_price_drop', this.handleYieldCustomerPriceDrop.bind(this));
    this.on(
      'yield:customer_savings_opportunity',
      this.handleYieldCustomerSavingsOpportunity.bind(this)
    );
    this.on(
      'yield:dynamic_discount_available',
      this.handleYieldDynamicDiscountAvailable.bind(this)
    );

    // Operational Events
    this.on('yield:forecast_update', this.handleYieldForecastUpdate.bind(this));
    this.on('yield:capacity_optimization', this.handleYieldCapacityOptimization.bind(this));
    this.on('yield:seasonal_adjustment', this.handleYieldSeasonalAdjustment.bind(this));

    // ================================
    // NOUVEAU : QR CODE EVENTS
    // ================================

    // QR Generation Events
    this.on('qr:code_generated', this.handleQRCodeGenerated.bind(this));
    this.on('qr:generation_failed', this.handleQRGenerationFailed.bind(this));
    this.on('qr:bulk_generated', this.handleQRBulkGenerated.bind(this));
    this.on('qr:daily_limit_reached', this.handleQRDailyLimitReached.bind(this));

    // QR Validation Events
    this.on('qr:code_validated', this.handleQRCodeValidated.bind(this));
    this.on('qr:validation_failed', this.handleQRValidationFailed.bind(this));
    this.on('qr:security_alert', this.handleQRSecurityAlert.bind(this));
    this.on('qr:code_expired', this.handleQRCodeExpired.bind(this));

    // QR Check-in Events
    this.on('qr:checkin_started', this.handleQRCheckInStarted.bind(this));
    this.on('qr:checkin_completed', this.handleQRCheckInCompleted.bind(this));
    this.on('qr:checkin_failed', this.handleQRCheckInFailed.bind(this));
    this.on('qr:checkin_cancelled', this.handleQRCheckInCancelled.bind(this));

    // QR Performance Events
    this.on('qr:performance_alert', this.handleQRPerformanceAlert.bind(this));
    this.on('qr:system_health', this.handleQRSystemHealth.bind(this));
    this.on('qr:usage_analytics', this.handleQRUsageAnalytics.bind(this));

    // QR Admin Events
    this.on('qr:code_revoked', this.handleQRCodeRevoked.bind(this));
    this.on('qr:batch_operation', this.handleQRBatchOperation.bind(this));

    // ================================
    // NOUVEAU : CACHE EVENTS
    // ================================

    // Cache Performance Events
    this.on('cache:performance_alert', this.handleCachePerformanceAlert.bind(this));
    this.on('cache:hit_rate_low', this.handleCacheHitRateLow.bind(this));
    this.on('cache:response_time_high', this.handleCacheResponseTimeHigh.bind(this));
    this.on('cache:error_rate_high', this.handleCacheErrorRateHigh.bind(this));

    // Cache Operations Events
    this.on('cache:invalidated', this.handleCacheInvalidated.bind(this));
    this.on('cache:warmed', this.handleCacheWarmed.bind(this));
    this.on('cache:cleared', this.handleCacheCleared.bind(this));
    this.on('cache:bulk_invalidation', this.handleCacheBulkInvalidation.bind(this));

    // Redis Health Events
    this.on('cache:redis_disconnected', this.handleRedisDisconnected.bind(this));
    this.on('cache:redis_reconnected', this.handleRedisReconnected.bind(this));
    this.on('cache:redis_memory_warning', this.handleRedisMemoryWarning.bind(this));
    this.on('cache:redis_memory_critical', this.handleRedisMemoryCritical.bind(this));

    // Cache Analytics Events
    this.on('cache:daily_report', this.handleCacheDailyReport.bind(this));
    this.on('cache:optimization_suggestion', this.handleCacheOptimizationSuggestion.bind(this));
    this.on('cache:capacity_warning', this.handleCacheCapacityWarning.bind(this));

    logger.info('All notification event listeners initialized (Yield + QR + Cache)');
  }

  // ================================
  // EXISTING NOTIFICATION METHODS (CONSERVÉ INTÉGRALEMENT)
  // ================================

  /**
   * Main notification sender - supports multiple channels
   */
  async sendNotification(notificationData) {
    const {
      type,
      userId,
      channels = ['email', 'socket'],
      data = {},
      priority = 'medium',
      scheduleAt = null,
      metadata = {},
    } = notificationData;

    try {
      // Get user details
      const user = await User.findById(userId);
      if (!user) {
        throw new Error(`User not found: ${userId}`);
      }

      // Check user notification preferences
      const userChannels = this.filterChannelsByPreferences(channels, user.notificationPreferences);

      // If scheduled, add to queue
      if (scheduleAt && new Date(scheduleAt) > new Date()) {
        return await this.scheduleNotification({
          type,
          userId,
          channels: userChannels,
          data,
          priority,
          scheduleAt,
          metadata,
        });
      }

      // Send notifications across enabled channels
      const results = await Promise.allSettled(
        [
          // Email notification
          userChannels.includes('email') ? this.sendEmailNotification(type, user, data) : null,

          // SMS notification
          userChannels.includes('sms') && user.phone
            ? this.sendSMSNotification(type, user, data)
            : null,

          // Socket.io real-time notification
          userChannels.includes('socket') ? this.sendSocketNotification(type, user, data) : null,
        ].filter((promise) => promise !== null)
      );

      // Log notification results
      await this.logNotification({
        type,
        userId,
        channels: userChannels,
        results: results.map((result) => ({
          status: result.status,
          value: result.value,
          reason: result.reason,
        })),
        priority,
        metadata,
        timestamp: new Date(),
      });

      return {
        success: true,
        type,
        userId,
        channels: userChannels,
        results,
      };
    } catch (error) {
      logger.error('Notification Service Error:', error);

      // Add to retry queue if not critical failure
      if (this.shouldRetry(error)) {
        await this.addToRetryQueue(notificationData);
      }

      throw error;
    }
  }

  /**
   * Send email notification using specific emailService methods
   */
  async sendEmailNotification(type, user, data) {
    try {
      switch (type) {
        case 'BOOKING_CREATED':
        case 'BOOKING_CONFIRMATION':
          return await emailService.sendBookingConfirmation(data.booking, user, data.hotel);

        case 'BOOKING_CONFIRMED':
          return await emailService.sendBookingStatusUpdate(
            data.booking,
            user,
            data.hotel,
            'CONFIRMED',
            data.adminComment
          );

        case 'BOOKING_REJECTED':
          return await emailService.sendBookingStatusUpdate(
            data.booking,
            user,
            data.hotel,
            'REJECTED',
            data.adminComment
          );

        case 'PAYMENT_REMINDER':
          return await emailService.sendPaymentReminder(
            data.booking,
            user,
            data.hotel,
            data.daysUntilDue
          );

        case 'CHECKIN_REMINDER':
          return await emailService.sendCheckInReminder(data.booking, user, data.hotel);

        case 'INVOICE_GENERATED':
          return await emailService.sendInvoice(data.invoice, user, data.hotel, data.pdfBuffer);

        case 'LOYALTY_POINTS_EARNED':
          return await emailService.sendLoyaltyPointsUpdate(
            user,
            data.pointsEarned,
            data.totalPoints,
            data.booking
          );

        case 'PROMOTIONAL_OFFER':
          return await emailService.sendPromotionalOffer(user, data.promotion, data.hotels);

        case 'ENTERPRISE_WELCOME':
          return await emailService.sendEnterpriseWelcome(data.company, user);

        // ================================
        // YIELD MANAGEMENT EMAIL NOTIFICATIONS (CONSERVÉ)
        // ================================

        case 'YIELD_PRICE_UPDATE':
          return await this.sendYieldPriceUpdateEmail(user, data);

        case 'YIELD_SAVINGS_OPPORTUNITY':
          return await this.sendYieldSavingsOpportunityEmail(user, data);

        case 'YIELD_REVENUE_REPORT':
          return await this.sendYieldRevenueReportEmail(user, data);

        case 'YIELD_PRICING_RECOMMENDATION':
          return await this.sendYieldPricingRecommendationEmail(user, data);

        case 'YIELD_PERFORMANCE_ALERT':
          return await this.sendYieldPerformanceAlertEmail(user, data);

        // ================================
        // NOUVEAU : QR CODE EMAIL NOTIFICATIONS
        // ================================

        case 'QR_CODE_GENERATED':
          return await this.sendQRCodeGeneratedEmail(user, data);

        case 'QR_CHECKIN_READY':
          return await this.sendQRCheckInReadyEmail(user, data);

        case 'QR_CHECKIN_COMPLETED':
          return await this.sendQRCheckInCompletedEmail(user, data);

        case 'QR_SECURITY_ALERT':
          return await this.sendQRSecurityAlertEmail(user, data);

        case 'QR_EXPIRY_WARNING':
          return await this.sendQRExpiryWarningEmail(user, data);

        // ================================
        // NOUVEAU : CACHE EMAIL NOTIFICATIONS
        // ================================

        case 'CACHE_PERFORMANCE_ALERT':
          return await this.sendCachePerformanceAlertEmail(user, data);

        case 'CACHE_SYSTEM_REPORT':
          return await this.sendCacheSystemReportEmail(user, data);

        case 'REDIS_HEALTH_ALERT':
          return await this.sendRedisHealthAlertEmail(user, data);

        default:
          logger.warn(`Unknown email notification type: ${type}`);
          return null;
      }
    } catch (error) {
      logger.error(`Failed to send email notification (${type}):`, error);
      throw error;
    }
  }

  /**
   * Send SMS notification using specific smsService methods
   */
  async sendSMSNotification(type, user, data) {
    try {
      switch (type) {
        case 'BOOKING_CREATED':
        case 'BOOKING_CONFIRMATION':
          return await smsService.sendBookingConfirmation(data.booking, user, data.hotel);

        case 'BOOKING_CONFIRMED':
        case 'BOOKING_REJECTED':
          return await smsService.sendBookingStatusUpdate(
            data.booking,
            user,
            data.hotel,
            data.status,
            data.adminComment
          );

        case 'PAYMENT_REMINDER':
          return await smsService.sendPaymentReminder(
            data.booking,
            user,
            data.hotel,
            data.daysUntilDue
          );

        case 'CHECKIN_REMINDER':
          return await smsService.sendCheckInReminder(data.booking, user, data.hotel);

        case 'CHECKIN_INSTRUCTIONS':
          return await smsService.sendCheckInInstructions(
            data.booking,
            user,
            data.hotel,
            data.roomNumber
          );

        case 'CHECKOUT_CONFIRMATION':
          return await smsService.sendCheckoutConfirmation(
            data.booking,
            user,
            data.hotel,
            data.finalAmount
          );

        case 'LOYALTY_POINTS_EARNED':
          return await smsService.sendLoyaltyPointsUpdate(
            user,
            data.pointsEarned,
            data.totalPoints
          );

        case 'PROMOTIONAL_OFFER':
          return await smsService.sendPromotionalOffer(user, data.promotion, data.hotel);

        case 'URGENT_NOTIFICATION':
          return await smsService.sendUrgentNotification(user, data.message, data.hotel);

        // ================================
        // YIELD MANAGEMENT SMS NOTIFICATIONS (CONSERVÉ)
        // ================================

        case 'YIELD_PRICE_DROP_ALERT':
          return await this.sendYieldPriceDropSMS(user, data);

        case 'YIELD_DEMAND_SURGE_ALERT':
          return await this.sendYieldDemandSurgeSMS(user, data);

        case 'YIELD_LAST_MINUTE_DEAL':
          return await this.sendYieldLastMinuteDealSMS(user, data);

        case 'YIELD_OCCUPANCY_ALERT':
          return await this.sendYieldOccupancyAlertSMS(user, data);

        // ================================
        // NOUVEAU : QR CODE SMS NOTIFICATIONS
        // ================================

        case 'QR_CHECKIN_READY':
          return await this.sendQRCheckInReadySMS(user, data);

        case 'QR_CHECKIN_COMPLETED':
          return await this.sendQRCheckInCompletedSMS(user, data);

        case 'QR_EXPIRY_WARNING':
          return await this.sendQRExpiryWarningSMS(user, data);

        case 'QR_SECURITY_ALERT':
          return await this.sendQRSecurityAlertSMS(user, data);

        // ================================
        // NOUVEAU : CACHE SMS NOTIFICATIONS (ADMIN ONLY)
        // ================================

        case 'CACHE_CRITICAL_ALERT':
          return await this.sendCacheCriticalAlertSMS(user, data);

        case 'REDIS_CONNECTION_LOST':
          return await this.sendRedisConnectionLostSMS(user, data);

        default:
          logger.warn(`Unknown SMS notification type: ${type}`);
          return null;
      }
    } catch (error) {
      logger.error(`Failed to send SMS notification (${type}):`, error);
      throw error;
    }
  }

  /**
   * Send Socket.io real-time notification
   */
  async sendSocketNotification(type, user, data) {
    try {
      const socketData = {
        type,
        title: this.getNotificationTitle(type),
        message: data.message || this.getNotificationMessage(type, data),
        data: data,
        priority: data.priority || 'medium',
        timestamp: new Date(),
      };

      return socketService.sendUserNotification(user._id.toString(), type, socketData);
    } catch (error) {
      logger.error(`Failed to send socket notification (${type}):`, error);
      throw error;
    }
  }

  // ================================
  // EXISTING EVENT HANDLERS (CONSERVÉ INTÉGRALEMENT)
  // ================================

  async handleBookingCreated(bookingData) {
    const { bookingId, userId } = bookingData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');
      const user = await User.findById(userId);

      if (!booking || !user) {
        logger.error('Missing booking or user data for booking created notification');
        return;
      }

      // Notify customer
      await this.sendNotification({
        type: 'BOOKING_CREATED',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          message: `Votre réservation ${booking.confirmationNumber} a été créée avec succès !`,
        },
        priority: 'high',
      });

      // Notify admin users
      const admins = await User.find({ role: 'ADMIN' });
      for (const admin of admins) {
        await this.sendNotification({
          type: 'NEW_BOOKING_ADMIN',
          userId: admin._id,
          channels: ['socket'],
          data: {
            booking,
            customer: user,
            hotel: booking.hotel,
            message: `Nouvelle réservation de ${user.firstName} ${user.lastName}`,
          },
          priority: 'high',
        });
      }

      logger.info(`Booking created notifications sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling booking created event:', error);
    }
  }

  async handleBookingConfirmed(bookingData) {
    const { bookingId, userId, adminComment } = bookingData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');
      const user = await User.findById(userId);

      await this.sendNotification({
        type: 'BOOKING_CONFIRMED',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          status: 'CONFIRMED',
          adminComment,
          message: `Votre réservation ${booking.confirmationNumber} a été confirmée !`,
        },
        priority: 'high',
      });

      logger.info(`Booking confirmed notifications sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling booking confirmed event:', error);
    }
  }

  async handleBookingRejected(bookingData) {
    const { bookingId, userId, reason } = bookingData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');

      await this.sendNotification({
        type: 'BOOKING_REJECTED',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          status: 'REJECTED',
          adminComment: reason,
          message: `Votre réservation ${booking.confirmationNumber} a été refusée`,
        },
        priority: 'high',
      });

      logger.info(`Booking rejected notifications sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling booking rejected event:', error);
    }
  }

  async handleCheckIn(bookingData) {
    const { bookingId, userId, roomNumbers } = bookingData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');

      await this.sendNotification({
        type: 'CHECKIN_INSTRUCTIONS',
        userId: userId,
        channels: ['sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          roomNumber: roomNumbers?.[0],
          message: `Check-in effectué ! Chambre(s): ${roomNumbers?.join(', ')}`,
        },
        priority: 'high',
      });

      logger.info(`Check-in notifications sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling check-in event:', error);
    }
  }

  async handleCheckOut(bookingData) {
    const { bookingId, userId, finalAmount } = bookingData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');

      await this.sendNotification({
        type: 'CHECKOUT_CONFIRMATION',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          finalAmount,
          message: `Check-out effectué avec succès. Merci pour votre séjour !`,
        },
        priority: 'medium',
      });

      logger.info(`Check-out notifications sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling check-out event:', error);
    }
  }

  async handlePaymentReminder(paymentData) {
    const { bookingId, userId, daysUntilDue } = paymentData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');

      await this.sendNotification({
        type: 'PAYMENT_REMINDER',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          daysUntilDue,
          message: `Rappel: Paiement dû dans ${daysUntilDue} jour(s)`,
        },
        priority: 'high',
      });

      logger.info(`Payment reminder sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling payment reminder event:', error);
    }
  }

  async handleInvoiceGenerated(invoiceData) {
    const { bookingId, userId, invoice, pdfBuffer } = invoiceData;

    try {
      const booking = await Booking.findById(bookingId).populate('hotel');

      await this.sendNotification({
        type: 'INVOICE_GENERATED',
        userId: userId,
        channels: ['email', 'socket'],
        data: {
          booking,
          hotel: booking.hotel,
          invoice,
          pdfBuffer,
          message: `Votre facture ${invoice.invoiceNumber} est disponible`,
        },
        priority: 'medium',
      });

      logger.info(`Invoice notification sent for booking ${bookingId}`);
    } catch (error) {
      logger.error('Error handling invoice generated event:', error);
    }
  }

  async handleLoyaltyPointsEarned(loyaltyData) {
    const { userId, pointsEarned, totalPoints, booking } = loyaltyData;

    try {
      await this.sendNotification({
        type: 'LOYALTY_POINTS_EARNED',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          pointsEarned,
          totalPoints,
          booking,
          message: `Vous avez gagné ${pointsEarned} points fidélité !`,
        },
        priority: 'low',
      });

      logger.info(`Loyalty points notification sent to user ${userId}`);
    } catch (error) {
      logger.error('Error handling loyalty points event:', error);
    }
  }

  async handlePromotionalOffer(promoData) {
    const { userIds, promotion, hotels } = promoData;

    try {
      // Send to multiple users
      const notifications = userIds.map((userId) => ({
        type: 'PROMOTIONAL_OFFER',
        userId,
        channels: ['email', 'socket'],
        data: {
          promotion,
          hotels,
          message: `Nouvelle offre: ${promotion.title}`,
        },
        priority: 'low',
      }));

      await this.sendBulkNotifications(notifications);
      logger.info(`Promotional offer sent to ${userIds.length} users`);
    } catch (error) {
      logger.error('Error handling promotional offer event:', error);
    }
  }

  // ================================
  // YIELD MANAGEMENT EVENT HANDLERS (CONSERVÉ INTÉGRALEMENT)
  // ================================

  /**
   * Handle yield price update notifications
   */
  async handleYieldPriceUpdate(yieldData) {
    const { hotelId, roomType, priceChange, demandLevel, strategy, userId } = yieldData;

    try {
      if (!this.yieldAlerts.enabled) {
        logger.debug('Yield alerts disabled, skipping price update notification');
        return;
      }

      // Rate limiting check
      const rateLimitKey = `price_update_${hotelId}_${roomType}`;
      if (this.isRateLimited(rateLimitKey, this.yieldAlerts.rateLimiting.priceUpdate)) {
        logger.debug('Price update notification rate limited');
        return;
      }

      const hotel = await Hotel.findById(hotelId);
      if (!hotel) return;

      const priceChangePercent = Math.abs(priceChange.percentage);

      // Only notify for significant price changes
      if (priceChangePercent < this.yieldAlerts.thresholds.priceChange.significant) {
        return;
      }

      // Notify hotel admins and reception staff
      const hotelStaff = await User.find({
        $or: [{ role: USER_ROLES.ADMIN }, { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }],
      });

      for (const staff of hotelStaff) {
        await this.sendNotification({
          type: 'YIELD_PRICE_UPDATE',
          userId: staff._id,
          channels: ['socket', 'email'],
          data: {
            hotel,
            roomType,
            priceChange,
            demandLevel,
            strategy,
            significance:
              priceChangePercent >= this.yieldAlerts.thresholds.priceChange.major
                ? 'MAJOR'
                : 'SIGNIFICANT',
            message: `Prix ${roomType} ajusté: ${priceChange.percentage > 0 ? '+' : ''}${priceChange.percentage.toFixed(1)}% (${demandLevel} demande)`,
          },
          priority:
            priceChangePercent >= this.yieldAlerts.thresholds.priceChange.major ? 'high' : 'medium',
        });
      }

      // If major price increase, also notify customers who might be interested
      if (priceChange.percentage < -10) {
        // Price drop of 10%+
        await this.notifyCustomersOfPriceDrop(hotelId, roomType, priceChange);
      }

      this.markAlertSent(rateLimitKey);
      logger.info(`Yield price update notifications sent for ${hotel.name} - ${roomType}`);
    } catch (error) {
      logger.error('Error handling yield price update event:', error);
    }
  }

  // ================================
  // NOUVEAU : QR CODE EVENT HANDLERS
  // ================================

  /**
   * Handle QR code generated notification
   */
  async handleQRCodeGenerated(qrData) {
    const { tokenId, type, userId, hotelId, generatedAt, expiresAt, metadata } = qrData;

    try {
      if (!this.qrAlerts.enabled) {
        logger.debug('QR alerts disabled, skipping QR generated notification');
        return;
      }

      // Check daily generation limits
      const dailyCount = await this.getQRDailyCount(userId);
      if ((dailyCount = this.qrAlerts.thresholds.generation.userLimit)) {
        await this.handleQRDailyLimitReached({ userId, dailyCount });
        return;
      }

      const user = await User.findById(userId);
      if (!user) return;

      // Send QR code generated notification to user
      await this.sendNotification({
        type: 'QR_CODE_GENERATED',
        userId: userId,
        channels: ['email', 'socket'],
        data: {
          tokenId,
          type,
          hotelId,
          generatedAt,
          expiresAt,
          metadata,
          message: `QR Code ${type} généré avec succès`,
        },
        priority: 'medium',
      });

      // Notify hotel staff for hotel-specific QR codes
      if (hotelId && ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS'].includes(type)) {
        const hotel = await Hotel.findById(hotelId);
        if (hotel) {
          const hotelStaff = await User.find({
            $or: [{ role: 'ADMIN' }, { role: 'RECEPTIONIST', hotelId: hotelId }],
          });

          for (const staff of hotelStaff) {
            await this.sendNotification({
              type: 'QR_HOTEL_GENERATED',
              userId: staff._id,
              channels: ['socket'],
              data: {
                tokenId,
                type,
                hotel: hotel.name,
                generatedBy: user.firstName + ' ' + user.lastName,
                generatedAt,
                message: `Nouveau QR Code ${type} généré pour ${hotel.name}`,
              },
              priority: 'low',
            });
          }
        }
      }

      // Broadcast to QR admin monitoring
      socketService.notifyQRGenerated({
        tokenId,
        type,
        userId,
        hotelId,
        generatedAt,
        userRole: user.role,
      });

      logger.info(`QR code generated notification sent for ${type} by user ${userId}`);
    } catch (error) {
      logger.error('Error handling QR code generated event:', error);
    }
  }

  /**
   * Handle QR generation failed notification
   */
  async handleQRGenerationFailed(qrData) {
    const { userId, type, error, hotelId, metadata } = qrData;

    try {
      const user = await User.findById(userId);
      if (!user) return;

      // Notify user of generation failure
      await this.sendNotification({
        type: 'QR_GENERATION_FAILED',
        userId: userId,
        channels: ['socket'],
        data: {
          type,
          error,
          hotelId,
          metadata,
          message: `Échec de génération du QR Code ${type}: ${error}`,
        },
        priority: 'medium',
      });

      // If admin, also send to QR admin dashboard
      if (user.role === 'ADMIN') {
        socketService.broadcastQREvent('QR_GENERATION_FAILED', {
          userId,
          type,
          error,
          hotelId,
          failedAt: new Date(),
        });
      }

      logger.info(`QR generation failed notification sent to user ${userId}: ${error}`);
    } catch (error) {
      logger.error('Error handling QR generation failed event:', error);
    }
  }

  /**
   * Handle QR code validated notification
   */
  async handleQRCodeValidated(qrData) {
    const { tokenId, type, userId, hotelId, validatedBy, validatedAt, usageCount } = qrData;

    try {
      const user = await User.findById(userId);
      const validator = await User.findById(validatedBy);

      if (!user || !validator) return;

      // Notify QR code owner of validation
      await this.sendNotification({
        type: 'QR_CODE_VALIDATED',
        userId: userId,
        channels: ['socket'],
        data: {
          tokenId,
          type,
          validatedBy: validator.firstName + ' ' + validator.lastName,
          validatedAt,
          usageCount,
          message: `Votre QR Code ${type} a été validé`,
        },
        priority: 'medium',
      });

      // If check-in QR, prepare for check-in process
      if (type === 'CHECK_IN') {
        await this.prepareQRCheckIn({
          tokenId,
          userId,
          hotelId,
          validatedBy,
          validatedAt,
        });
      }

      // Broadcast to hotel staff
      if (hotelId) {
        socketService.notifyQRScanned({
          tokenId,
          type,
          userId,
          hotelId,
          validatedBy,
          validatedAt,
        });
      }

      logger.info(`QR code validated notification sent for ${type} by user ${validatedBy}`);
    } catch (error) {
      logger.error('Error handling QR code validated event:', error);
    }
  }

  /**
   * Handle QR validation failed notification
   */
  async handleQRValidationFailed(qrData) {
    const { tokenId, error, validatedBy, hotelId, ipAddress, userAgent } = qrData;

    try {
      // Check for security patterns
      const isSecurityThreat = this.analyzeQRSecurityThreat(error, ipAddress, userAgent);

      if (isSecurityThreat) {
        await this.handleQRSecurityAlert({
          type: 'VALIDATION_FAILED',
          tokenId,
          error,
          validatedBy,
          hotelId,
          ipAddress,
          userAgent,
          threatLevel: isSecurityThreat.level,
        });
      }

      // Notify validator
      if (validatedBy) {
        await this.sendNotification({
          type: 'QR_VALIDATION_FAILED',
          userId: validatedBy,
          channels: ['socket'],
          data: {
            tokenId: tokenId ? tokenId.substring(0, 20) + '...' : 'unknown',
            error,
            message: `Échec de validation QR Code: ${error}`,
          },
          priority: 'medium',
        });
      }

      // Log for admin monitoring
      socketService.broadcastQREvent('QR_VALIDATION_FAILED', {
        tokenId: tokenId ? tokenId.substring(0, 20) + '...' : 'unknown',
        error,
        validatedBy,
        hotelId,
        failedAt: new Date(),
        securityThreat: isSecurityThreat,
      });

      logger.warn(`QR validation failed: ${error} by user ${validatedBy}`);
    } catch (error) {
      logger.error('Error handling QR validation failed event:', error);
    }
  }

  /**
   * Handle QR security alert
   */
  async handleQRSecurityAlert(alertData) {
    const { type, tokenId, error, validatedBy, hotelId, ipAddress, threatLevel } = alertData;

    try {
      // Rate limiting for security alerts
      const rateLimitKey = `qr_security_${ipAddress || validatedBy}`;
      if (this.isRateLimited(rateLimitKey, this.qrAlerts.rateLimiting.securityAlert)) {
        return;
      }

      // Notify all admins of security threat
      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'QR_SECURITY_ALERT',
          userId: admin._id,
          channels: ['email', 'sms', 'socket'],
          data: {
            type,
            tokenId: tokenId ? tokenId.substring(0, 20) + '...' : 'unknown',
            error,
            validatedBy,
            hotelId,
            ipAddress,
            threatLevel,
            message: `🚨 Alerte sécurité QR: ${threatLevel} threat détectée`,
          },
          priority: 'high',
        });
      }

      // If hotel-specific, notify hotel staff
      if (hotelId) {
        const hotel = await Hotel.findById(hotelId);
        if (hotel) {
          const hotelStaff = await User.find({
            role: 'RECEPTIONIST',
            hotelId: hotelId,
          });

          for (const staff of hotelStaff) {
            await this.sendNotification({
              type: 'QR_HOTEL_SECURITY_ALERT',
              userId: staff._id,
              channels: ['socket', 'sms'],
              data: {
                hotel: hotel.name,
                threatLevel,
                type,
                message: `⚠️ Alerte sécurité QR détectée à ${hotel.name}`,
              },
              priority: 'high',
            });
          }
        }
      }

      this.markAlertSent(rateLimitKey);
      logger.error(`QR security alert sent: ${threatLevel} threat detected`);
    } catch (error) {
      logger.error('Error handling QR security alert:', error);
    }
  }

  /**
   * Handle QR check-in started notification
   */
  async handleQRCheckInStarted(checkInData) {
    const { sessionId, tokenId, bookingId, userId, hotelId, startedAt } = checkInData;

    try {
      const user = await User.findById(userId);
      const hotel = await Hotel.findById(hotelId);

      if (!user || !hotel) return;

      // Notify customer that check-in is starting
      await this.sendNotification({
        type: 'QR_CHECKIN_STARTED',
        userId: userId,
        channels: ['socket', 'sms'],
        data: {
          sessionId,
          hotel: hotel.name,
          startedAt,
          estimatedDuration: '3-5 minutes',
          message: `Check-in commencé à ${hotel.name}. Veuillez patienter...`,
        },
        priority: 'high',
      });

      // Notify hotel reception staff
      const receptionStaff = await User.find({
        role: 'RECEPTIONIST',
        hotelId: hotelId,
      });

      for (const staff of receptionStaff) {
        await this.sendNotification({
          type: 'QR_CHECKIN_RECEPTION',
          userId: staff._id,
          channels: ['socket'],
          data: {
            sessionId,
            customer: user.firstName + ' ' + user.lastName,
            bookingId,
            startedAt,
            message: `Check-in QR commencé pour ${user.firstName} ${user.lastName}`,
          },
          priority: 'high',
        });
      }

      // Broadcast to QR monitoring
      socketService.broadcastQREvent('QR_CHECKIN_STARTED', {
        sessionId,
        userId,
        hotelId,
        startedAt,
      });

      logger.info(`QR check-in started notification sent for session ${sessionId}`);
    } catch (error) {
      logger.error('Error handling QR check-in started event:', error);
    }
  }

  /**
   * Handle QR check-in completed notification
   */
  async handleQRCheckInCompleted(checkInData) {
    const { sessionId, bookingId, userId, hotelId, roomNumbers, completedAt, duration } =
      checkInData;

    try {
      const user = await User.findById(userId);
      const hotel = await Hotel.findById(hotelId);

      if (!user || !hotel) return;

      // Notify customer of successful check-in
      await this.sendNotification({
        type: 'QR_CHECKIN_COMPLETED',
        userId: userId,
        channels: ['email', 'sms', 'socket'],
        data: {
          sessionId,
          hotel: hotel.name,
          roomNumbers,
          completedAt,
          duration: Math.round(duration / 1000 / 60), // duration in minutes
          message: `✅ Check-in réussi à ${hotel.name}! Chambre(s): ${roomNumbers.join(', ')}`,
        },
        priority: 'high',
      });

      // Send welcome SMS with room details
      if (user.phone) {
        await this.sendNotification({
          type: 'QR_CHECKIN_WELCOME',
          userId: userId,
          channels: ['sms'],
          data: {
            hotel: hotel.name,
            roomNumbers,
            checkInTime: hotel.checkInTime || '15:00',
            checkOutTime: hotel.checkOutTime || '11:00',
            wifiPassword: hotel.wifiPassword || 'Demandez à la réception',
            message: `Bienvenue à ${hotel.name}! Chambres: ${roomNumbers.join(', ')}. WiFi: ${hotel.wifiPassword || 'Voir réception'}`,
          },
          priority: 'medium',
        });
      }

      // Notify hotel staff of completion
      const hotelStaff = await User.find({
        $or: [{ role: 'ADMIN' }, { role: 'RECEPTIONIST', hotelId: hotelId }],
      });

      for (const staff of hotelStaff) {
        await this.sendNotification({
          type: 'QR_CHECKIN_STAFF_COMPLETED',
          userId: staff._id,
          channels: ['socket'],
          data: {
            sessionId,
            customer: user.firstName + ' ' + user.lastName,
            roomNumbers,
            duration: Math.round(duration / 1000 / 60),
            message: `Check-in QR terminé: ${user.firstName} ${user.lastName} - Chambres: ${roomNumbers.join(', ')}`,
          },
          priority: 'medium',
        });
      }

      // Broadcast success to QR monitoring
      socketService.notifyQRCheckIn({
        sessionId,
        userId,
        hotelId,
        roomNumbers,
        completedAt,
        duration,
      });

      logger.info(
        `QR check-in completed notification sent for session ${sessionId}, rooms: ${roomNumbers.join(', ')}`
      );
    } catch (error) {
      logger.error('Error handling QR check-in completed event:', error);
    }
  }

  /**
   * Handle QR check-in failed notification
   */
  async handleQRCheckInFailed(checkInData) {
    const { sessionId, userId, hotelId, error, failedAt, step } = checkInData;

    try {
      const user = await User.findById(userId);
      const hotel = await Hotel.findById(hotelId);

      if (!user || !hotel) return;

      // Notify customer of check-in failure
      await this.sendNotification({
        type: 'QR_CHECKIN_FAILED',
        userId: userId,
        channels: ['socket', 'sms'],
        data: {
          sessionId,
          hotel: hotel.name,
          error,
          step,
          failedAt,
          supportPhone: hotel.phone,
          message: `❌ Échec check-in QR à ${hotel.name}. Contactez la réception: ${hotel.phone}`,
        },
        priority: 'high',
      });

      // Notify hotel staff for assistance
      const receptionStaff = await User.find({
        role: 'RECEPTIONIST',
        hotelId: hotelId,
      });

      for (const staff of receptionStaff) {
        await this.sendNotification({
          type: 'QR_CHECKIN_ASSISTANCE_NEEDED',
          userId: staff._id,
          channels: ['socket', 'sms'],
          data: {
            sessionId,
            customer: user.firstName + ' ' + user.lastName,
            customerPhone: user.phone,
            error,
            step,
            message: `🆘 Assistance check-in QR requise: ${user.firstName} ${user.lastName} - Erreur: ${error}`,
          },
          priority: 'high',
        });
      }

      // Broadcast failure to QR monitoring
      socketService.broadcastQREvent('QR_CHECKIN_FAILED', {
        sessionId,
        userId,
        hotelId,
        error,
        step,
        failedAt,
      });

      logger.error(`QR check-in failed notification sent for session ${sessionId}: ${error}`);
    } catch (error) {
      logger.error('Error handling QR check-in failed event:', error);
    }
  }

  /**
   * Handle QR code expiry warning
   */
  async handleQRCodeExpired(expiryData) {
    const { tokenId, type, userId, hotelId, expiresAt } = expiryData;

    try {
      if (!userId) return;

      const user = await User.findById(userId);
      if (!user) return;

      // Only send expiry warnings for important QR types
      const importantTypes = ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS', 'PAYMENT'];
      if (!importantTypes.includes(type)) return;

      // Check if still within warning period (send warning 2 hours before expiry)
      const warningTime = new Date(expiresAt).getTime() - 2 * 60 * 60 * 1000;
      const now = Date.now();

      if (now < warningTime || now > new Date(expiresAt).getTime()) {
        return; // Too early or already expired
      }

      await this.sendNotification({
        type: 'QR_EXPIRY_WARNING',
        userId: userId,
        channels: ['socket', 'sms'],
        data: {
          tokenId: tokenId.substring(0, 20) + '...',
          type,
          hotelId,
          expiresAt,
          timeRemaining: this.getTimeRemaining(expiresAt),
          message: `⏰ Votre QR Code ${type} expire dans ${this.getTimeRemaining(expiresAt)}`,
        },
        priority: 'medium',
      });

      logger.info(`QR expiry warning sent to user ${userId} for ${type}`);
    } catch (error) {
      logger.error('Error handling QR code expired event:', error);
    }
  }

  /**
   * Handle QR daily limit reached
   */
  async handleQRDailyLimitReached(limitData) {
    const { userId, dailyCount } = limitData;

    try {
      const user = await User.findById(userId);
      if (!user) return;

      await this.sendNotification({
        type: 'QR_DAILY_LIMIT_REACHED',
        userId: userId,
        channels: ['socket', 'email'],
        data: {
          dailyCount,
          limit: this.qrAlerts.thresholds.generation.userLimit,
          resetTime: 'minuit',
          message: `Limite quotidienne de QR Codes atteinte (${dailyCount}/${this.qrAlerts.thresholds.generation.userLimit})`,
        },
        priority: 'medium',
      });

      // Notify admins if user is frequently hitting limits
      if (dailyCount > this.qrAlerts.thresholds.generation.userLimit * 1.5) {
        const admins = await User.find({ role: 'ADMIN' });
        for (const admin of admins) {
          await this.sendNotification({
            type: 'QR_USER_EXCESSIVE_USAGE',
            userId: admin._id,
            channels: ['socket'],
            data: {
              user: user.firstName + ' ' + user.lastName,
              userId,
              dailyCount,
              message: `Utilisation excessive QR détectée: ${user.firstName} ${user.lastName} (${dailyCount} codes)`,
            },
            priority: 'medium',
          });
        }
      }

      logger.warn(`QR daily limit reached for user ${userId}: ${dailyCount} codes`);
    } catch (error) {
      logger.error('Error handling QR daily limit reached event:', error);
    }
  }

  // ================================
  // NOUVEAU : CACHE EVENT HANDLERS
  // ================================

  /**
   * Handle cache performance alert
   */
  async handleCachePerformanceAlert(alertData) {
    const { alertType, hitRate, responseTime, errorRate, severity, hotelId } = alertData;

    try {
      if (!this.cacheAlerts.enabled) {
        logger.debug('Cache alerts disabled, skipping cache performance alert');
        return;
      }

      // Rate limiting check
      const rateLimitKey = `cache_performance_${alertType}`;
      if (this.isRateLimited(rateLimitKey, this.cacheAlerts.rateLimiting.performanceAlert)) {
        return;
      }

      // Notify all admins
      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'CACHE_PERFORMANCE_ALERT',
          userId: admin._id,
          channels: ['socket', 'email'],
          data: {
            alertType,
            hitRate,
            responseTime,
            errorRate,
            severity,
            hotelId,
            thresholds: this.cacheAlerts.thresholds.performance,
            message: `⚠️ Performance cache dégradée: ${alertType} (${severity})`,
          },
          priority: severity === 'critical' ? 'high' : 'medium',
        });
      }

      // If hotel-specific issue, notify hotel staff
      if (hotelId) {
        const hotelStaff = await User.find({
          role: 'RECEPTIONIST',
          hotelId: hotelId,
        });

        for (const staff of hotelStaff) {
          await this.sendNotification({
            type: 'CACHE_HOTEL_PERFORMANCE',
            userId: staff._id,
            channels: ['socket'],
            data: {
              alertType,
              severity,
              impact: 'Possible ralentissement des réservations',
              message: `⚠️ Performance système affectée - Contactez l'IT si problème persistant`,
            },
            priority: 'low',
          });
        }
      }

      // Broadcast to cache monitoring
      socketService.notifyCachePerformance({
        alertType,
        hitRate,
        responseTime,
        errorRate,
        severity,
        hotelId,
        alertedAt: new Date(),
      });

      this.markAlertSent(rateLimitKey);
      logger.warn(`Cache performance alert sent: ${alertType} (${severity})`);
    } catch (error) {
      logger.error('Error handling cache performance alert:', error);
    }
  }

  /**
   * Handle cache hit rate low alert
   */
  async handleCacheHitRateLow(hitRateData) {
    const { hitRate, cacheType, hotelId, trend } = hitRateData;

    try {
      // Only alert if below critical threshold
      if (hitRate > this.cacheAlerts.thresholds.performance.hitRateWarning) {
        return;
      }

      const severity =
        hitRate <= this.cacheAlerts.thresholds.performance.hitRateCritical ? 'critical' : 'warning';

      await this.handleCachePerformanceAlert({
        alertType: 'LOW_HIT_RATE',
        hitRate,
        cacheType,
        hotelId,
        trend,
        severity,
        impact: 'Degraded response times expected',
      });
    } catch (error) {
      logger.error('Error handling cache hit rate low alert:', error);
    }
  }

  /**
   * Handle cache invalidated notification
   */
  async handleCacheInvalidated(invalidationData) {
    const { type, identifier, scope, invalidatedCount, invalidatedBy, hotelId } = invalidationData;

    try {
      // Log significant invalidations
      if (invalidatedCount > this.cacheAlerts.thresholds.invalidation.bulkWarning) {
        const admins = await User.find({ role: 'ADMIN' });

        for (const admin of admins) {
          await this.sendNotification({
            type: 'CACHE_BULK_INVALIDATION',
            userId: admin._id,
            channels: ['socket'],
            data: {
              type,
              identifier,
              scope,
              invalidatedCount,
              invalidatedBy,
              hotelId,
              message: `📊 Cache invalidation massive: ${invalidatedCount} entrées (${type})`,
            },
            priority: 'low',
          });
        }
      }

      // Broadcast to cache monitoring
      socketService.notifyCacheInvalidated({
        type,
        identifier,
        scope,
        invalidatedCount,
        invalidatedBy,
        hotelId,
        invalidatedAt: new Date(),
      });

      logger.info(
        `Cache invalidation notification: ${type}/${identifier} - ${invalidatedCount} entries`
      );
    } catch (error) {
      logger.error('Error handling cache invalidated event:', error);
    }
  }

  /**
   * Handle Redis disconnected alert
   */
  async handleRedisDisconnected(disconnectionData) {
    const { reason, lastConnection, attemptReconnect } = disconnectionData;

    try {
      // Critical alert - notify all admins immediately
      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'REDIS_CONNECTION_LOST',
          userId: admin._id,
          channels: ['email', 'sms', 'socket'],
          data: {
            reason,
            lastConnection,
            attemptReconnect,
            impact: 'Cache système indisponible - Performance dégradée',
            message: `🚨 CRITIQUE: Connexion Redis perdue - ${reason}`,
          },
          priority: 'high',
        });
      }

      // Broadcast to cache monitoring
      socketService.notifyRedisStatus({
        status: 'disconnected',
        reason,
        lastConnection,
        disconnectedAt: new Date(),
      });

      logger.error(`Redis disconnection alert sent: ${reason}`);
    } catch (error) {
      logger.error('Error handling Redis disconnected event:', error);
    }
  }

  /**
   * Handle Redis reconnected notification
   */
  async handleRedisReconnected(reconnectionData) {
    const { downTime, recoveryTime } = reconnectionData;

    try {
      // Notify all admins of recovery
      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'REDIS_CONNECTION_RESTORED',
          userId: admin._id,
          channels: ['socket', 'email'],
          data: {
            downTime,
            recoveryTime,
            message: `✅ Connexion Redis rétablie après ${Math.round(downTime / 1000 / 60)} minutes`,
          },
          priority: 'medium',
        });
      }

      // Broadcast to cache monitoring
      socketService.notifyRedisStatus({
        status: 'connected',
        downTime,
        recoveryTime,
        reconnectedAt: new Date(),
      });

      logger.info(`Redis reconnection notification sent after ${downTime}ms downtime`);
    } catch (error) {
      logger.error('Error handling Redis reconnected event:', error);
    }
  }

  /**
   * Handle Redis memory warning
   */
  async handleRedisMemoryWarning(memoryData) {
    const { usedMemory, maxMemory, usagePercent, severity } = memoryData;

    try {
      // Rate limiting check
      const rateLimitKey = `redis_memory_${severity}`;
      if (this.isRateLimited(rateLimitKey, this.cacheAlerts.rateLimiting.redisAlert)) {
        return;
      }

      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'REDIS_MEMORY_WARNING',
          userId: admin._id,
          channels: severity === 'critical' ? ['email', 'sms', 'socket'] : ['socket', 'email'],
          data: {
            usedMemory: Math.round(usedMemory / 1024 / 1024), // MB
            maxMemory: Math.round(maxMemory / 1024 / 1024), // MB
            usagePercent,
            severity,
            recommendations: this.getRedisMemoryRecommendations(usagePercent),
            message: `⚠️ Mémoire Redis ${severity}: ${usagePercent}% utilisée`,
          },
          priority: severity === 'critical' ? 'high' : 'medium',
        });
      }

      this.markAlertSent(rateLimitKey);
      logger.warn(`Redis memory ${severity} alert sent: ${usagePercent}% usage`);
    } catch (error) {
      logger.error('Error handling Redis memory warning:', error);
    }
  }

  /**
   * Handle cache daily report
   */
  async handleCacheDailyReport(reportData) {
    const { date, stats, performance, recommendations } = reportData;

    try {
      const admins = await User.find({ role: 'ADMIN' });

      for (const admin of admins) {
        await this.sendNotification({
          type: 'CACHE_DAILY_REPORT',
          userId: admin._id,
          channels: ['email'],
          data: {
            date,
            stats,
            performance,
            recommendations,
            message: `📊 Rapport cache quotidien - ${date}`,
          },
          priority: 'low',
        });
      }

      logger.info(`Cache daily report sent for ${date}`);
    } catch (error) {
      logger.error('Error handling cache daily report:', error);
    }
  }

  // ================================
  // UTILITY METHODS (EXISTANTS + NOUVEAUX)
  // ================================

  /**
   * Check if alert is rate limited (EXISTANT)
   */
  isRateLimited(key, limitMs) {
    const lastAlert =
      this.yieldAlerts.lastAlerts.get(key) ||
      this.qrAlerts.lastAlerts.get(key) ||
      this.cacheAlerts.lastAlerts.get(key);
    if (!lastAlert) return false;

    return Date.now() - lastAlert < limitMs;
  }

  /**
   * Mark alert as sent for rate limiting (EXISTANT + ÉTENDU)
   */
  markAlertSent(key) {
    // Determine which alert system this key belongs to
    if (
      key.startsWith('price_update_') ||
      key.startsWith('demand_surge_') ||
      key.startsWith('occupancy_') ||
      key.startsWith('revenue_')
    ) {
      this.yieldAlerts.lastAlerts.set(key, Date.now());
    } else if (key.startsWith('qr_')) {
      this.qrAlerts.lastAlerts.set(key, Date.now());
    } else if (key.startsWith('cache_') || key.startsWith('redis_')) {
      this.cacheAlerts.lastAlerts.set(key, Date.now());
    } else {
      // Default to yield alerts for backward compatibility
      this.yieldAlerts.lastAlerts.set(key, Date.now());
    }
  }

  /**
   * NOUVEAU : Analyze QR security threat
   */
  analyzeQRSecurityThreat(error, ipAddress, userAgent) {
    const threatIndicators = {
      'Invalid token format': { level: 'low', score: 1 },
      'Token has been revoked': { level: 'medium', score: 2 },
      'Token usage limit exceeded': { level: 'medium', score: 2 },
      'Token integrity check failed': { level: 'high', score: 4 },
      'QR Code has expired': { level: 'low', score: 1 },
      'Invalid QR Code': { level: 'high', score: 4 },
    };

    const suspiciousPatterns = [
      /bot|crawler|spider/i,
      /curl|wget|postman/i,
      /python|php|java|script/i,
    ];

    let threatScore = 0;
    let threatLevel = 'low';

    // Check error type
    const errorThreat = threatIndicators[error];
    if (errorThreat) {
      threatScore += errorThreat.score;
      threatLevel = errorThreat.level;
    }

    // Check user agent for suspicious patterns
    if (userAgent) {
      for (const pattern of suspiciousPatterns) {
        if (pattern.test(userAgent)) {
          threatScore += 2;
          threatLevel = threatScore >= 4 ? 'high' : 'medium';
          break;
        }
      }
    }

    // Check for rapid-fire attempts from same IP
    // This would require additional tracking in a real implementation

    if (threatScore >= 3) {
      return {
        level: threatLevel,
        score: threatScore,
        indicators: {
          suspiciousError: !!errorThreat,
          suspiciousUserAgent: suspiciousPatterns.some((p) => userAgent && p.test(userAgent)),
          ipAddress,
        },
      };
    }

    return null; // No significant threat detected
  }

  /**
   * NOUVEAU : Get QR daily count for user
   */
  async getQRDailyCount(userId) {
    // In a real implementation, this would query the database
    // For now, we'll return a simulated count
    const today = new Date().toISOString().split('T')[0];
    const cacheKey = `qr_daily_${userId}_${today}`;

    // This would use your cache service to get/set daily counts
    return Math.floor(Math.random() * 30); // Simulated count
  }

  /**
   * NOUVEAU : Prepare QR check-in process
   */
  async prepareQRCheckIn(checkInData) {
    const { tokenId, userId, hotelId, validatedBy, validatedAt } = checkInData;

    try {
      // This would typically:
      // 1. Validate the booking exists
      // 2. Check room availability
      // 3. Prepare room assignment
      // 4. Generate check-in session

      const sessionId = `checkin_${Date.now()}_${userId}`;

      // Emit check-in started event
      this.emit('qr:checkin_started', {
        sessionId,
        tokenId,
        userId,
        hotelId,
        validatedBy,
        startedAt: new Date(),
      });

      logger.info(`QR check-in preparation started for user ${userId}, session ${sessionId}`);
    } catch (error) {
      logger.error('Error preparing QR check-in:', error);

      // Emit check-in failed event
      this.emit('qr:checkin_failed', {
        userId,
        hotelId,
        error: error.message,
        step: 'preparation',
        failedAt: new Date(),
      });
    }
  }

  /**
   * NOUVEAU : Get Redis memory recommendations
   */
  getRedisMemoryRecommendations(usagePercent) {
    const recommendations = [];

    if (usagePercent >= 95) {
      recommendations.push('URGENT: Increase Redis memory or clear cache immediately');
      recommendations.push('Check for memory leaks or excessive data retention');
      recommendations.push('Consider Redis cluster scaling');
    } else if (usagePercent >= 80) {
      recommendations.push('Monitor memory usage closely');
      recommendations.push('Review cache TTL settings');
      recommendations.push('Plan memory capacity increase');
    } else if (usagePercent >= 70) {
      recommendations.push('Consider cache optimization');
      recommendations.push('Review data retention policies');
    }

    return recommendations;
  }

  /**
   * NOUVEAU : Get time remaining in human readable format
   */
  getTimeRemaining(futureDate) {
    const now = new Date();
    const future = new Date(futureDate);
    const diffMs = future - now;

    if (diffMs <= 0) return 'Expiré';

    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}j ${hours % 24}h`;
    }

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }

    return `${minutes}m`;
  }

  // ================================
  // EMAIL TEMPLATES METHODS (NOUVEAUX QR + CACHE)
  // ================================

  /**
   * NOUVEAU : Send QR code generated email
   */
  async sendQRCodeGeneratedEmail(user, data) {
    const { tokenId, type, hotelId, generatedAt, expiresAt, metadata } = data;

    try {
      const hotel = hotelId ? await Hotel.findById(hotelId) : null;

      const emailData = {
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        qrCode: {
          type,
          tokenId: tokenId.substring(0, 20) + '...',
          generatedAt,
          expiresAt,
          hotelName: hotel?.name || 'N/A',
          validUntil: this.getTimeRemaining(expiresAt),
        },
        metadata,
        year: new Date().getFullYear(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com',
      };

      return await emailService.sendCustomEmail(
        user.email,
        `QR Code ${type} généré`,
        this.generateQRCodeGeneratedEmailContent(emailData)
      );
    } catch (error) {
      logger.error('Failed to send QR code generated email:', error);
      throw error;
    }
  }

  /**
   * NOUVEAU : Send QR check-in ready email
   */
  async sendQRCheckInReadyEmail(user, data) {
    const { sessionId, hotel, estimatedDuration } = data;

    try {
      const emailData = {
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        checkIn: {
          sessionId,
          hotelName: hotel,
          estimatedDuration,
          status: 'READY',
        },
        year: new Date().getFullYear(),
      };

      return await emailService.sendCustomEmail(
        user.email,
        `Check-in QR prêt - ${hotel}`,
        this.generateQRCheckInEmailContent(emailData)
      );
    } catch (error) {
      logger.error('Failed to send QR check-in ready email:', error);
      throw error;
    }
  }

  /**
   * NOUVEAU : Send cache performance alert email
   */
  async sendCachePerformanceAlertEmail(user, data) {
    const { alertType, hitRate, responseTime, errorRate, severity, thresholds } = data;

    try {
      const emailData = {
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
        },
        alert: {
          type: alertType,
          severity,
          hitRate,
          responseTime,
          errorRate,
          thresholds,
          recommendations: this.getCachePerformanceRecommendations(
            alertType,
            hitRate,
            responseTime
          ),
        },
        year: new Date().getFullYear(),
        supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com',
      };

      return await emailService.sendCustomEmail(
        user.email,
        `🚨 Alerte Performance Cache - ${severity.toUpperCase()}`,
        this.generateCachePerformanceAlertEmailContent(emailData)
      );
    } catch (error) {
      logger.error('Failed to send cache performance alert email:', error);
      throw error;
    }
  }

  // ================================
  // SMS TEMPLATES METHODS (NOUVEAUX QR + CACHE)
  // ================================

  /**
   * NOUVEAU : Send QR check-in ready SMS
   */
  async sendQRCheckInReadySMS(user, data) {
    const { hotel, estimatedDuration } = data;

    const message = `🏨 CHECK-IN QR PRÊT ${hotel}
⏱️ Durée estimée: ${estimatedDuration}
📱 Suivez les instructions sur votre écran`;
    return await smsService.sendSMS(user.phone, message);
  }

  /**
   * NOUVEAU : Send QR check-in completed SMS
   */
  async sendQRCheckInCompletedSMS(user, data) {
    const { hotel, roomNumbers } = data;

    const message = `✅ CHECK-IN RÉUSSI! ${hotel}
🏠 Chambre(s): ${roomNumbers.join(', ')}
🎉 Bon séjour!`;
    return await smsService.sendSMS(user.phone, message);
  }

  /**
   * NOUVEAU : Send QR expiry warning SMS
   */
  async sendQRExpiryWarningSMS(user, data) {
    const { type, timeRemaining } = data;

    const message = `⏰ QR CODE EXPIRE BIENTÔT Type: ${type}
⏱️ Temps restant: ${timeRemaining}
📱 Utilisez-le rapidement!`;
    return await smsService.sendSMS(user.phone, message);
  }

  /**
   * NOUVEAU : Send QR security alert SMS
   */
  async sendQRSecurityAlertSMS(user, data) {
    const { threatLevel, type } = data;

    const message = `🚨 ALERTE SÉCURITÉ QR
    Niveau: ${threatLevel.toUpperCase()}
Type: ${type}
📞 Contactez l'IT immédiatement`;
    return await smsService.sendSMS(user.phone, message);
  }

  /**
   * NOUVEAU : Send cache critical alert SMS
   */
  async sendCacheCriticalAlertSMS(user, data) {
    const { alertType, severity } = data;

    const message = `🚨 ALERTE CACHE CRITIQUE
    Type: ${alertType}
Niveau: ${severity.toUpperCase()}
⚡ Action immédiate requise`;
    return await smsService.sendSMS(user.phone, message);
  }

  /**
   * NOUVEAU : Send Redis connection lost SMS
   */
  async sendRedisConnectionLostSMS(user, data) {
    const { reason } = data;

    const message = `🔴 REDIS DÉCONNECTÉ
    Cause: ${reason}
💾 Cache indisponible
🆘 Intervention urgente`;
    return await smsService.sendSMS(user.phone, message);
  }

  // ================================
  // EMAIL CONTENT GENERATORS (NOUVEAUX)
  // ================================

  /**
   * NOUVEAU : Generate QR code generated email content
   */
  generateQRCodeGeneratedEmailContent(data) {
    const { user, qrCode, metadata } = data;

    return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">🔲 QR Code Généré</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px;">${qrCode.type}</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                <h2 style="color: #667eea; margin-top: 0;">Bonjour ${user.firstName},</h2>
                <p>Votre QR Code <strong>${qrCode.type}</strong> a été généré avec succès.</p>
                
                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin: 0 0 15px 0; color: #667eea;">📋 Détails du QR Code</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <strong>Type:</strong> ${qrCode.type}
                        </div>
                        <div>
                            <strong>Hôtel:</strong> ${qrCode.hotelName}
                        </div>
                        <div>
                            <strong>Généré le:</strong> ${new Date(qrCode.generatedAt).toLocaleString()}
                        </div>
                        <div>
                            <strong>Valide jusqu'à:</strong> ${new Date(qrCode.expiresAt).toLocaleString()}
                        </div>
                    </div>
                    
                    <div style="margin-top: 15px; padding: 10px; background: #e3f2fd; border-radius: 5px;">
                        <strong>⏰ Temps restant:</strong> ${qrCode.validUntil}
                    </div>
                </div>
                
                <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="margin: 0 0 10px 0; color: #856404;">⚠️ Important</h4>
                    <ul style="margin: 0; color: #856404;">
                        <li>Gardez ce QR code accessible sur votre téléphone</li>
                        <li>Ne partagez pas ce code avec d'autres personnes</li>
                        <li>Le code expire automatiquement après utilisation ou expiration</li>
                    </ul>
                </div>
            </div>
            
            <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                <p>Support technique: ${data.supportEmail}</p>
                <p>© ${data.year} - Système de gestion hôtelière</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  /**
   * NOUVEAU : Generate cache performance alert email content
   */
  generateCachePerformanceAlertEmailContent(data) {
    const { user, alert } = data;

    const severityColors = {
      warning: '#f39c12',
      critical: '#e74c3c',
    };

    const color = severityColors[alert.severity] || '#f39c12';

    return `
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: linear-gradient(135deg, ${color} 0%, ${color}88 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">⚠️ Alerte Performance Cache</h1>
                <p style="margin: 10px 0 0 0; font-size: 18px;">${alert.severity.toUpperCase()}</p>
            </div>
            
            <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                <h2 style="color: ${color}; margin-top: 0;">Bonjour ${user.firstName},</h2>
                <p>Une alerte de performance cache <strong>${alert.severity}</strong> a été détectée.</p>
                
                <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h3 style="margin: 0 0 15px 0; color: ${color};">📊 Métriques de Performance</h3>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                        <div>
                            <strong>Type d'alerte:</strong> ${alert.type}
                        </div>
                        <div>
                            <strong>Taux de hit:</strong> ${alert.hitRate}%
                        </div>
                        <div>
                            <strong>Temps de réponse:</strong> ${alert.responseTime}ms
                        </div>
                        <div>
                            <strong>Taux d'erreur:</strong> ${alert.errorRate}%
                        </div>
                    </div>
                    
                    <div style="margin-top: 15px; padding: 10px; background: #ffebee; border-radius: 5px;">
                        <strong>🎯 Seuils:</strong> Hit Rate > ${alert.thresholds.hitRateWarning}%, Response Time < ${alert.thresholds.responseTime}ms
                    </div>
                </div>
                
                <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <h4 style="margin: 0 0 15px 0; color: #1976d2;">💡 Recommandations</h4>
                    <ul style="margin: 0; color: #1976d2;">
                        ${alert.recommendations.map((rec) => `<li>${rec}</li>`).join('')}
                    </ul>
                </div>
            </div>
            
            <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                <p>Support technique: ${data.supportEmail}</p>
                <p>© ${data.year} - Monitoring système</p>
            </div>
        </div>
    </body>
    </html>
    `;
  }

  // ================================
  // UTILITY METHODS (NOUVEAUX)
  // ================================

  /**
   * NOUVEAU : Get cache performance recommendations
   */
  getCachePerformanceRecommendations(alertType, hitRate, responseTime) {
    const recommendations = [];

    switch (alertType) {
      case 'LOW_HIT_RATE':
        recommendations.push('Vérifiez les patterns de cache invalidation');
        recommendations.push('Optimisez les clés de cache pour de meilleurs hits');
        recommendations.push('Considérez un cache warming pour les données fréquemment accédées');
        if (hitRate < 50) {
          recommendations.push('URGENT: Examinez la stratégie de mise en cache');
        }
        break;

      case 'HIGH_RESPONSE_TIME':
        recommendations.push('Vérifiez la connectivité Redis');
        recommendations.push('Optimisez les requêtes de cache complexes');
        recommendations.push("Considérez une mise à l'échelle Redis");
        if (responseTime > 2000) {
          recommendations.push('URGENT: Vérifiez les ressources système Redis');
        }
        break;

      case 'HIGH_ERROR_RATE':
        recommendations.push('Examinez les logs Redis pour les erreurs');
        recommendations.push('Vérifiez la stabilité de la connexion');
        recommendations.push("Implémentez un fallback en cas d'échec cache");
        break;

      default:
        recommendations.push('Surveillez les métriques de performance');
        recommendations.push("Contactez l'équipe technique si le problème persiste");
    }

    return recommendations;
  }

  /**
   * Get notification title including new types (EXISTANT + ÉTENDU)
   */
  getNotificationTitle(type) {
    const titles = {
      // Existing titles (CONSERVÉ)
      BOOKING_CREATED: 'Réservation Créée',
      BOOKING_CONFIRMED: 'Réservation Confirmée',
      BOOKING_REJECTED: 'Réservation Refusée',
      CHECKIN_REMINDER: "Rappel d'Arrivée",
      PAYMENT_REMINDER: 'Rappel de Paiement',
      INVOICE_GENERATED: 'Facture Disponible',
      LOYALTY_POINTS_EARNED: 'Points Fidélité',
      PROMOTIONAL_OFFER: 'Offre Spéciale',

      // Yield Management titles (CONSERVÉ)
      YIELD_PRICE_UPDATE: 'Mise à Jour Prix',
      YIELD_DEMAND_SURGE_ALERT: 'Alerte Pic de Demande',
      YIELD_DEMAND_DROP_ALERT: 'Alerte Chute de Demande',
      YIELD_OCCUPANCY_ALERT: 'Alerte Occupation',
      YIELD_REVENUE_OPTIMIZATION: 'Optimisation Revenus',
      YIELD_PERFORMANCE_ALERT: 'Alerte Performance',
      YIELD_PRICING_RECOMMENDATION: 'Recommandation Pricing',
      YIELD_PRICE_DROP_ALERT: 'Prix Baissé',
      YIELD_SAVINGS_OPPORTUNITY: "Opportunité d'Économies",
      YIELD_LAST_MINUTE_DEAL: 'Offre Flash',

      // NOUVEAU : QR Code titles
      QR_CODE_GENERATED: 'QR Code Généré',
      QR_CODE_VALIDATED: 'QR Code Validé',
      QR_CHECKIN_STARTED: 'Check-in QR Commencé',
      QR_CHECKIN_COMPLETED: 'Check-in QR Terminé',
      QR_CHECKIN_FAILED: 'Échec Check-in QR',
      QR_SECURITY_ALERT: 'Alerte Sécurité QR',
      QR_EXPIRY_WARNING: 'QR Code Expire Bientôt',
      QR_DAILY_LIMIT_REACHED: 'Limite QR Atteinte',

      // NOUVEAU : Cache titles
      CACHE_PERFORMANCE_ALERT: 'Alerte Performance Cache',
      CACHE_INVALIDATED: 'Cache Invalidé',
      REDIS_CONNECTION_LOST: 'Connexion Redis Perdue',
      REDIS_CONNECTION_RESTORED: 'Connexion Redis Rétablie',
      REDIS_MEMORY_WARNING: 'Alerte Mémoire Redis',
      CACHE_DAILY_REPORT: 'Rapport Cache Quotidien',
    };
    return titles[type] || 'Notification';
  }

  /**
   * Get notification message including new types (EXISTANT + ÉTENDU)
   */
  getNotificationMessage(type, data) {
    switch (type) {
      // Existing cases (CONSERVÉ)
      case 'BOOKING_CREATED':
        return `Votre réservation ${data.booking?.confirmationNumber} a été créée`;
      case 'BOOKING_CONFIRMED':
        return `Votre réservation ${data.booking?.confirmationNumber} est confirmée`;
      case 'PAYMENT_REMINDER':
        return `Rappel: Paiement dû dans ${data.daysUntilDue} jour(s)`;

      // Yield Management messages (CONSERVÉ)
      case 'YIELD_PRICE_UPDATE':
        return `Prix ${data.roomType} ajusté: ${data.priceChange?.percentage > 0 ? '+' : ''}${data.priceChange?.percentage?.toFixed(1)}%`;
      case 'YIELD_DEMAND_SURGE_ALERT':
        return `Pic de demande détecté - Opportunité: +${data.revenueOpportunity?.toFixed(0)}€`;
      case 'YIELD_PRICE_DROP_ALERT':
        return `Prix baissé: -${Math.abs(data.priceChange?.percentage || 0).toFixed(0)}% sur ${data.roomType}`;

      // NOUVEAU : QR Code messages
      case 'QR_CODE_GENERATED':
        return `QR Code ${data.type} généré avec succès`;
      case 'QR_CODE_VALIDATED':
        return `QR Code ${data.type} validé par ${data.validatedBy}`;
      case 'QR_CHECKIN_STARTED':
        return `Check-in QR commencé à ${data.hotel} - ${data.estimatedDuration}`;
      case 'QR_CHECKIN_COMPLETED':
        return `Check-in réussi! Chambre(s): ${data.roomNumbers?.join(', ')}`;
      case 'QR_CHECKIN_FAILED':
        return `Échec check-in QR: ${data.error}`;
      case 'QR_SECURITY_ALERT':
        return `Alerte sécurité QR: ${data.threatLevel} threat détectée`;
      case 'QR_EXPIRY_WARNING':
        return `QR Code ${data.type} expire dans ${data.timeRemaining}`;
      case 'QR_DAILY_LIMIT_REACHED':
        return `Limite quotidienne QR atteinte: ${data.dailyCount}/${data.limit}`;

      // NOUVEAU : Cache messages
      case 'CACHE_PERFORMANCE_ALERT':
        return `Performance cache dégradée: ${data.alertType} (${data.severity})`;
      case 'CACHE_INVALIDATED':
        return `Cache invalidé: ${data.type}/${data.identifier} - ${data.invalidatedCount} entrées`;
      case 'REDIS_CONNECTION_LOST':
        return `Connexion Redis perdue: ${data.reason}`;
      case 'REDIS_CONNECTION_RESTORED':
        return `Connexion Redis rétablie après ${Math.round(data.downTime / 1000 / 60)} min`;
      case 'REDIS_MEMORY_WARNING':
        return `Mémoire Redis ${data.severity}: ${data.usagePercent}% utilisée`;
      case 'CACHE_DAILY_REPORT':
        return `Rapport cache quotidien disponible pour ${data.date}`;

      default:
        return data.message || 'Nouvelle notification';
    }
  }

  // ================================
  // EXISTING UTILITY METHODS (CONSERVÉ INTÉGRALEMENT)
  // ================================

  /**
   * Send bulk notifications to multiple users
   */
  async sendBulkNotifications(notifications) {
    const results = [];
    const batchSize = 10;

    for (let i = 0; i < notifications.length; i += batchSize) {
      const batch = notifications.slice(i, i + batchSize);

      const batchResults = await Promise.allSettled(
        batch.map((notification) => this.sendNotification(notification))
      );

      results.push(...batchResults);

      // Small delay between batches
      if (i + batchSize < notifications.length) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  /**
   * Schedule reminder notifications
   */
  async scheduleBookingReminders() {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const upcomingBookings = await Booking.find({
        checkInDate: {
          $gte: new Date(tomorrow.setHours(0, 0, 0, 0)),
          $lt: new Date(tomorrow.setHours(23, 59, 59, 999)),
        },
        status: 'CONFIRMED',
      })
        .populate('customer')
        .populate('hotel');

      const notifications = upcomingBookings.map((booking) => ({
        type: 'CHECKIN_REMINDER',
        userId: booking.customer._id,
        channels: ['email', 'sms'],
        data: {
          booking,
          hotel: booking.hotel,
          message: `Rappel: Votre arrivée est prévue demain`,
        },
        priority: 'medium',
      }));

      return await this.sendBulkNotifications(notifications);
    } catch (error) {
      logger.error('Error scheduling booking reminders:', error);
      throw error;
    }
  }

  /**
   * Utility methods
   */
  filterChannelsByPreferences(channels, preferences) {
    if (!preferences) return channels;

    return channels.filter((channel) => {
      return preferences[channel] !== false;
    });
  }

  shouldRetry(error) {
    const retryableErrors = ['NETWORK_ERROR', 'TIMEOUT', 'RATE_LIMIT', 'TEMPORARY_FAILURE'];

    return retryableErrors.some(
      (errorType) => error.message.includes(errorType) || error.code === errorType
    );
  }

  async addToRetryQueue(notificationData) {
    const retryData = {
      ...notificationData,
      retryCount: (notificationData.retryCount || 0) + 1,
      nextRetryAt: new Date(
        Date.now() + this.retryDelay * Math.pow(2, notificationData.retryCount || 0)
      ),
    };
    if (retryData.retryCount <= this.retryAttempts) {
      this.notificationQueue.push(retryData);
    }
  }

  async scheduleNotification(notificationData) {
    const delay = new Date(notificationData.scheduleAt) - new Date();

    setTimeout(async () => {
      const { scheduleAt, ...notification } = notificationData;
      await this.sendNotification(notification);
    }, delay);

    return { scheduled: true, delay };
  }

  async logNotification(logData) {
    logger.info('Notification Log:', {
      timestamp: logData.timestamp,
      type: logData.type,
      userId: logData.userId,
      channels: logData.channels,
      success: logData.results.filter((r) => r.status === 'fulfilled').length,
      failed: logData.results.filter((r) => r.status === 'rejected').length,
    });
  }

  // ================================
  // YIELD MANAGEMENT UTILITY METHODS (CONSERVÉ INTÉGRALEMENT)
  // ================================

  /**
   * Get occupancy recommendations based on level and type
   */
  getOccupancyRecommendations(occupancyRate, alertType) {
    if (alertType === 'HIGH' || occupancyRate >= this.yieldAlerts.thresholds.occupancy.critical) {
      return [
        'Considérer une augmentation des prix',
        'Vérifier les surréservations',
        "Préparer la liste d'attente",
        'Alerter les équipes opérationnelles',
        'Surveiller les annulations',
      ];
    }

    if (alertType === 'LOW' || occupancyRate <= this.yieldAlerts.thresholds.occupancy.low) {
      return [
        'Lancer des promotions ciblées',
        'Réduire temporairement les prix',
        'Contacter les agences de voyage',
        'Promouvoir sur les réseaux sociaux',
        'Analyser la concurrence',
      ];
    }

    return [
      "Surveiller l'évolution",
      'Maintenir la stratégie actuelle',
      'Préparer des ajustements si nécessaire',
    ];
  }

  /**
   * Calculate performance alert severity
   */
  calculatePerformanceAlertSeverity(metrics) {
    let severity = 'LOW';

    // Check various performance indicators
    if (metrics.revPAR && metrics.revPAR.change < -20) severity = 'HIGH';
    if (metrics.occupancyRate && metrics.occupancyRate.current < 40) severity = 'HIGH';
    if (metrics.averageRate && metrics.averageRate.change < -15) severity = 'MEDIUM';

    return severity;
  }

  /**
   * Get price change reason for notifications
   */
  getPriceChangeReason(priceChange, demandLevel) {
    if (priceChange.percentage > 0) {
      return demandLevel === 'VERY_HIGH' ? 'Forte demande détectée' : 'Optimisation des revenus';
    } else {
      return demandLevel === 'LOW' ? 'Stimulation de la demande' : 'Ajustement concurrentiel';
    }
  }

  /**
   * Get price update recommendations
   */
  getPriceUpdateRecommendations(priceChange, demandLevel) {
    const recommendations = [];

    if (priceChange.percentage > 10) {
      recommendations.push("Surveiller l'impact sur les réservations");
      recommendations.push('Communiquer la valeur ajoutée aux clients');
    }

    if (demandLevel === 'VERY_HIGH') {
      recommendations.push('Préparer une capacité supplémentaire si possible');
      recommendations.push("Analyser les opportunités d'upselling");
    }

    if (demandLevel === 'LOW') {
      recommendations.push('Considérer des promotions complémentaires');
      recommendations.push('Réviser la stratégie marketing');
    }

    return recommendations;
  }

  /**
   * Notify customers of price drops for hotels they're interested in
   */
  async notifyCustomersOfPriceDrop(hotelId, roomType, priceChange) {
    try {
      // Find customers who have shown interest in this hotel
      const interestedCustomers = await this.findInterestedCustomers(hotelId, roomType);

      for (const customer of interestedCustomers) {
        // Emit price drop event for each customer
        this.emit('yield:customer_price_drop', {
          userId: customer._id,
          hotelId,
          roomType,
          priceChange,
          validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h validity
          bookingUrl: `${process.env.FRONTEND_URL}/hotels/${hotelId}/book?room=${roomType}`,
        });
      }

      logger.info(`Price drop notifications triggered for ${interestedCustomers.length} customers`);
    } catch (error) {
      logger.error('Error notifying customers of price drop:', error);
    }
  }

  /**
   * Find customers interested in a specific hotel/room type
   */
  async findInterestedCustomers(hotelId, roomType) {
    try {
      // Logic to find interested customers:
      // 1. Past bookings in this hotel
      // 2. Saved/favorited hotels
      // 3. Recent searches
      // 4. Price alerts set up

      const pastBookings = await Booking.find({
        hotel: hotelId,
        'rooms.type': roomType,
        customer: { $exists: true },
        status: { $in: ['COMPLETED', 'CONFIRMED'] },
      })
        .populate('customer')
        .limit(50);

      const interestedCustomers = pastBookings
        .map((booking) => booking.customer)
        .filter((customer) => customer && customer.email)
        .filter(
          (customer, index, self) =>
            index === self.findIndex((c) => c._id.toString() === customer._id.toString())
        ); // Remove duplicates

      return interestedCustomers;
    } catch (error) {
      logger.error('Error finding interested customers:', error);
      return [];
    }
  }

  // ================================
  // ENHANCED STATISTICS & MONITORING
  // ================================

  /**
   * Get comprehensive notification statistics including all systems
   */
  async getNotificationStats(timeframe = '24h') {
    try {
      const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 24;
      const since = new Date(Date.now() - hours * 60 * 60 * 1000);

      const baseStats = {
        sent: 0,
        delivered: 0,
        failed: 0,
        channels: {
          email: 0,
          sms: 0,
          socket: 0,
        },
      };

      // Add yield-specific stats if enabled
      if (this.yieldAlerts.enabled) {
        baseStats.yield = {
          priceUpdateAlerts: 0,
          demandSurgeAlerts: 0,
          occupancyAlerts: 0,
          revenueOptimizationAlerts: 0,
          customerPriceDropAlerts: 0,
          savingsOpportunityAlerts: 0,
          totalYieldNotifications: 0,
          yieldAlertSuccessRate: 0,
        };
      }

      // NOUVEAU : Add QR-specific stats if enabled
      if (this.qrAlerts.enabled) {
        baseStats.qr = {
          generationAlerts: 0,
          validationAlerts: 0,
          securityAlerts: 0,
          checkInAlerts: 0,
          expiryWarnings: 0,
          totalQRNotifications: 0,
          qrAlertSuccessRate: 0,
        };
      }

      // NOUVEAU : Add cache-specific stats if enabled
      if (this.cacheAlerts.enabled) {
        baseStats.cache = {
          performanceAlerts: 0,
          redisAlerts: 0,
          invalidationAlerts: 0,
          memoryWarnings: 0,
          totalCacheNotifications: 0,
          cacheAlertSuccessRate: 0,
        };
      }

      return baseStats;
    } catch (error) {
      logger.error('Error getting notification stats:', error);
      return {
        sent: 0,
        delivered: 0,
        failed: 0,
        channels: { email: 0, sms: 0, socket: 0 },
      };
    }
  }

  /**
   * Get enhanced service status including all alert systems
   */
  getServiceStatus() {
    const baseStatus = {
      emailService: emailService ? 'Connected' : 'Disconnected',
      smsService: smsService ? 'Connected' : 'Disconnected',
      socketService: socketService ? 'Connected' : 'Disconnected',
      queueSize: this.notificationQueue.length,
      channels: this.channels,
    };

    // Add yield management status (CONSERVÉ)
    if (this.yieldAlerts.enabled) {
      baseStatus.yieldManagement = {
        enabled: this.yieldAlerts.enabled,
        alertsConfigured: Object.keys(this.yieldAlerts.thresholds).length,
        rateLimitingActive: this.yieldAlerts.lastAlerts.size > 0,
        lastYieldAlert: this.getLastYieldAlertTime(),
        yieldEventListeners: this.getYieldEventListenerCount(),
      };
    }

    // NOUVEAU : Add QR management status
    if (this.qrAlerts.enabled) {
      baseStatus.qrManagement = {
        enabled: this.qrAlerts.enabled,
        alertsConfigured: Object.keys(this.qrAlerts.thresholds).length,
        rateLimitingActive: this.qrAlerts.lastAlerts.size > 0,
        lastQRAlert: this.getLastQRAlertTime(),
        qrEventListeners: this.getQREventListenerCount(),
      };
    }

    // NOUVEAU : Add cache management status
    if (this.cacheAlerts.enabled) {
      baseStatus.cacheManagement = {
        enabled: this.cacheAlerts.enabled,
        alertsConfigured: Object.keys(this.cacheAlerts.thresholds).length,
        rateLimitingActive: this.cacheAlerts.lastAlerts.size > 0,
        lastCacheAlert: this.getLastCacheAlertTime(),
        cacheEventListeners: this.getCacheEventListenerCount(),
      };
    }

    return baseStatus;
  }

  /**
   * Get last alert times for different systems
   */
  getLastYieldAlertTime() {
    if (this.yieldAlerts.lastAlerts.size === 0) return null;

    let latest = 0;
    for (const timestamp of this.yieldAlerts.lastAlerts.values()) {
      if (timestamp > latest) latest = timestamp;
    }

    return latest > 0 ? new Date(latest) : null;
  }

  /**
   * NOUVEAU : Get last QR alert time
   */
  getLastQRAlertTime() {
    if (this.qrAlerts.lastAlerts.size === 0) return null;

    let latest = 0;
    for (const timestamp of this.qrAlerts.lastAlerts.values()) {
      if (timestamp > latest) latest = timestamp;
    }

    return latest > 0 ? new Date(latest) : null;
  }

  /**
   * NOUVEAU : Get last cache alert time
   */
  getLastCacheAlertTime() {
    if (this.cacheAlerts.lastAlerts.size === 0) return null;

    let latest = 0;
    for (const timestamp of this.cacheAlerts.lastAlerts.values()) {
      if (timestamp > latest) latest = timestamp;
    }

    return latest > 0 ? new Date(latest) : null;
  }

  /**
   * Get count of event listeners for different systems
   */
  getYieldEventListenerCount() {
    const yieldEvents = [
      'yield:price_updated',
      'yield:demand_surge',
      'yield:demand_drop',
      'yield:occupancy_critical',
      'yield:occupancy_low',
      'yield:revenue_optimization',
      'yield:performance_alert',
      'yield:revenue_milestone',
      'yield:revenue_target_missed',
      'yield:pricing_rule_triggered',
      'yield:pricing_recommendation',
      'yield:customer_price_drop',
      'yield:customer_savings_opportunity',
      'yield:dynamic_discount_available',
      'yield:forecast_update',
      'yield:strategy_effectiveness',
    ];

    return yieldEvents.filter((event) => this.listenerCount(event) > 0).length;
  }

  /**
   * NOUVEAU : Get count of QR event listeners
   */
  getQREventListenerCount() {
    const qrEvents = [
      'qr:code_generated',
      'qr:generation_failed',
      'qr:bulk_generated',
      'qr:daily_limit_reached',
      'qr:code_validated',
      'qr:validation_failed',
      'qr:security_alert',
      'qr:code_expired',
      'qr:checkin_started',
      'qr:checkin_completed',
      'qr:checkin_failed',
      'qr:checkin_cancelled',
      'qr:performance_alert',
      'qr:system_health',
      'qr:usage_analytics',
      'qr:code_revoked',
      'qr:batch_operation',
    ];

    return qrEvents.filter((event) => this.listenerCount(event) > 0).length;
  }

  /**
   * NOUVEAU : Get count of cache event listeners
   */
  getCacheEventListenerCount() {
    const cacheEvents = [
      'cache:performance_alert',
      'cache:hit_rate_low',
      'cache:response_time_high',
      'cache:error_rate_high',
      'cache:invalidated',
      'cache:warmed',
      'cache:cleared',
      'cache:bulk_invalidation',
      'cache:redis_disconnected',
      'cache:redis_reconnected',
      'cache:redis_memory_warning',
      'cache:redis_memory_critical',
      'cache:daily_report',
      'cache:optimization_suggestion',
      'cache:capacity_warning',
    ];

    return cacheEvents.filter((event) => this.listenerCount(event) > 0).length;
  }

  // ================================
  // CONFIGURATION MANAGEMENT
  // ================================

  /**
   * Update yield alert configuration (CONSERVÉ)
   */
  updateYieldAlertConfig(newConfig) {
    if (newConfig.enabled !== undefined) {
      this.yieldAlerts.enabled = newConfig.enabled;
    }

    if (newConfig.thresholds) {
      this.yieldAlerts.thresholds = {
        ...this.yieldAlerts.thresholds,
        ...newConfig.thresholds,
      };
    }

    if (newConfig.rateLimiting) {
      this.yieldAlerts.rateLimiting = {
        ...this.yieldAlerts.rateLimiting,
        ...newConfig.rateLimiting,
      };
    }

    logger.info('Yield alert configuration updated', newConfig);
  }

  /**
   * NOUVEAU : Update QR alert configuration
   */
  updateQRAlertConfig(newConfig) {
    if (newConfig.enabled !== undefined) {
      this.qrAlerts.enabled = newConfig.enabled;
    }

    if (newConfig.thresholds) {
      this.qrAlerts.thresholds = {
        ...this.qrAlerts.thresholds,
        ...newConfig.thresholds,
      };
    }

    if (newConfig.rateLimiting) {
      this.qrAlerts.rateLimiting = {
        ...this.qrAlerts.rateLimiting,
        ...newConfig.rateLimiting,
      };
    }

    logger.info('QR alert configuration updated', newConfig);
  }

  /**
   * NOUVEAU : Update cache alert configuration
   */
  updateCacheAlertConfig(newConfig) {
    if (newConfig.enabled !== undefined) {
      this.cacheAlerts.enabled = newConfig.enabled;
    }

    if (newConfig.thresholds) {
      this.cacheAlerts.thresholds = {
        ...this.cacheAlerts.thresholds,
        ...newConfig.thresholds,
      };
    }

    if (newConfig.rateLimiting) {
      this.cacheAlerts.rateLimiting = {
        ...this.cacheAlerts.rateLimiting,
        ...newConfig.rateLimiting,
      };
    }

    logger.info('Cache alert configuration updated', newConfig);
  }

  /**
   * Enable/disable specific alert types
   */
  toggleYieldAlertType(alertType, enabled) {
    logger.info(`Yield alert type ${alertType} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * NOUVEAU : Enable/disable specific QR alert types
   */
  toggleQRAlertType(alertType, enabled) {
    logger.info(`QR alert type ${alertType} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * NOUVEAU : Enable/disable specific cache alert types
   */
  toggleCacheAlertType(alertType, enabled) {
    logger.info(`Cache alert type ${alertType} ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clear alert rate limiting
   */
  clearYieldRateLimiting() {
    this.yieldAlerts.lastAlerts.clear();
    logger.info('Yield alert rate limiting cleared');
  }

  /**
   * NOUVEAU : Clear QR alert rate limiting
   */
  clearQRRateLimiting() {
    this.qrAlerts.lastAlerts.clear();
    logger.info('QR alert rate limiting cleared');
  }

  /**
   * NOUVEAU : Clear cache alert rate limiting
   */
  clearCacheRateLimiting() {
    this.cacheAlerts.lastAlerts.clear();
    logger.info('Cache alert rate limiting cleared');
  }

  // ================================
  // TESTING & DEBUGGING
  // ================================

  /**
   * Test alert system (for development/testing)
   */
  async testYieldAlert(alertType, testData = {}) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Yield alert testing disabled in production');
      return { success: false, reason: 'Testing disabled in production' };
    }

    try {
      logger.info(`Testing yield alert: ${alertType}`);

      // Emit test event
      this.emit(alertType, {
        hotelId: testData.hotelId || '507f1f77bcf86cd799439011', // Test hotel ID
        test: true,
        ...testData,
      });

      return {
        success: true,
        alertType,
        testData,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error testing yield alert:', error);
      return {
        success: false,
        alertType,
        error: error.message,
      };
    }
  }

  /**
   * NOUVEAU : Test QR alert system
   */
  async testQRAlert(alertType, testData = {}) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('QR alert testing disabled in production');
      return { success: false, reason: 'Testing disabled in production' };
    }

    try {
      logger.info(`Testing QR alert: ${alertType}`);

      // Emit test event
      this.emit(alertType, {
        userId: testData.userId || '507f1f77bcf86cd799439011', // Test user ID
        tokenId: testData.tokenId || 'test_token_123',
        test: true,
        ...testData,
      });

      return {
        success: true,
        alertType,
        testData,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error testing QR alert:', error);
      return {
        success: false,
        alertType,
        error: error.message,
      };
    }
  }

  /**
   * NOUVEAU : Test cache alert system
   */
  async testCacheAlert(alertType, testData = {}) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('Cache alert testing disabled in production');
      return { success: false, reason: 'Testing disabled in production' };
    }

    try {
      logger.info(`Testing cache alert: ${alertType}`);

      // Emit test event
      this.emit(alertType, {
        alertType: testData.alertType || 'LOW_HIT_RATE',
        severity: testData.severity || 'warning',
        test: true,
        ...testData,
      });

      return {
        success: true,
        alertType,
        testData,
        timestamp: new Date(),
      };
    } catch (error) {
      logger.error('Error testing cache alert:', error);
      return {
        success: false,
        alertType,
        error: error.message,
      };
    }
  }

  /**
   * Get comprehensive debugging info for all alert systems
   */
  getDebugInfo() {
    return {
      yield: {
        configuration: {
          enabled: this.yieldAlerts.enabled,
          thresholds: this.yieldAlerts.thresholds,
          rateLimiting: this.yieldAlerts.rateLimiting,
        },
        runtime: {
          activeRateLimits: this.yieldAlerts.lastAlerts.size,
          lastAlerts: Array.from(this.yieldAlerts.lastAlerts.entries()).map(([key, timestamp]) => ({
            key,
            timestamp: new Date(timestamp),
            minutesAgo: Math.round((Date.now() - timestamp) / (1000 * 60)),
          })),
        },
        eventListeners: {
          yieldEventsConfigured: this.getYieldEventListenerCount(),
          totalListeners: this.eventNames().filter((name) => name.startsWith('yield:')).length,
        },
      },
      qr: {
        configuration: {
          enabled: this.qrAlerts.enabled,
          thresholds: this.qrAlerts.thresholds,
          rateLimiting: this.qrAlerts.rateLimiting,
        },
        runtime: {
          activeRateLimits: this.qrAlerts.lastAlerts.size,
          lastAlerts: Array.from(this.qrAlerts.lastAlerts.entries()).map(([key, timestamp]) => ({
            key,
            timestamp: new Date(timestamp),
            minutesAgo: Math.round((Date.now() - timestamp) / (1000 * 60)),
          })),
        },
        eventListeners: {
          qrEventsConfigured: this.getQREventListenerCount(),
          totalListeners: this.eventNames().filter((name) => name.startsWith('qr:')).length,
        },
      },
      cache: {
        configuration: {
          enabled: this.cacheAlerts.enabled,
          thresholds: this.cacheAlerts.thresholds,
          rateLimiting: this.cacheAlerts.rateLimiting,
        },
        runtime: {
          activeRateLimits: this.cacheAlerts.lastAlerts.size,
          lastAlerts: Array.from(this.cacheAlerts.lastAlerts.entries()).map(([key, timestamp]) => ({
            key,
            timestamp: new Date(timestamp),
            minutesAgo: Math.round((Date.now() - timestamp) / (1000 * 60)),
          })),
        },
        eventListeners: {
          cacheEventsConfigured: this.getCacheEventListenerCount(),
          totalListeners: this.eventNames().filter((name) => name.startsWith('cache:')).length,
        },
      },
      statistics: {
        notificationQueue: this.notificationQueue.length,
        channels: this.channels,
        serviceStatus: this.getServiceStatus(),
      },
    };
  }

  // ================================
  // GRACEFUL SHUTDOWN WITH FULL CLEANUP
  // ================================

  /**
   * Enhanced graceful shutdown including all alert systems
   */
  async shutdown() {
    logger.info('Shutting down Notification Service with full alert system cleanup...');

    try {
      // Clear all alert rate limiting
      this.clearYieldRateLimiting();
      this.clearQRRateLimiting();
      this.clearCacheRateLimiting();

      // Remove all event listeners
      const allEvents = this.eventNames();
      allEvents.forEach((event) => {
        this.removeAllListeners(event);
      });

      // Process remaining urgent notifications in queue
      if (this.notificationQueue.length > 0) {
        logger.info(`Processing ${this.notificationQueue.length} remaining notifications...`);

        // Process urgent notifications only
        const urgentNotifications = this.notificationQueue.filter((n) => n.priority === 'high');
        for (const notification of urgentNotifications.slice(0, 10)) {
          // Max 10 urgent
          try {
            await this.sendNotification(notification);
          } catch (error) {
            logger.error('Error processing urgent notification during shutdown:', error);
          }
        }
      }

      // Clear notification queue
      this.notificationQueue.length = 0;

      // Clear template caches
      this.yieldTemplates.clear();
      this.qrTemplates.clear();
      this.cacheTemplates.clear();

      logger.info('Notification Service with full alert systems shutdown completed');
    } catch (error) {
      logger.error('Error during notification service shutdown:', error);
    }
  }
}
// Export singleton instance
module.exports = new NotificationService();
