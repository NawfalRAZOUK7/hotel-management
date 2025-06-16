/**
 * Advanced Notification Service - Week 3 + YIELD MANAGEMENT ALERTS INTEGRATION
 * Centralized notification management for hotel management system
 * Supports Email, SMS, Socket.io real-time notifications + Full Yield Management Alerts
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
    USER_ROLES
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
            push: false // Not implemented yet
        };

        // ================================
        // YIELD MANAGEMENT ALERT CONFIG
        // ================================
        this.yieldAlerts = {
            enabled: process.env.YIELD_ALERTS_ENABLED === 'true',
            
            // Alert thresholds
            thresholds: {
                occupancy: {
                    critical: 95,      // 95%+ occupancy
                    high: 85,          // 85%+ occupancy
                    low: 30,           // 30%- occupancy
                    veryLow: 15        // 15%- occupancy
                },
                priceChange: {
                    significant: 15,   // 15%+ price change
                    major: 25          // 25%+ price change
                },
                revenue: {
                    target: 100,       // Daily revenue target %
                    critical: 80       // Critical revenue threshold %
                },
                demand: {
                    surge: 'VERY_HIGH', // Demand surge level
                    drop: 'VERY_LOW'    // Demand drop level
                }
            },
            
            // Alert frequency limits
            rateLimiting: {
                priceUpdate: 300000,        // 5 minutes between price alerts
                demandSurge: 900000,        // 15 minutes between demand alerts
                occupancyCritical: 1800000, // 30 minutes between occupancy alerts
                revenueAlert: 3600000       // 1 hour between revenue alerts
            },
            
            // Last alert timestamps for rate limiting
            lastAlerts: new Map()
        };

        // Yield notification templates cache
        this.yieldTemplates = new Map();

        // Initialize event listeners (including yield)
        this.setupEventListeners();
        logger.info('Notification Service initialized successfully with Yield Management Alerts');
    }

    /**
     * Setup event listeners for automatic notifications + YIELD MANAGEMENT
     */
    setupEventListeners() {
        // ================================
        // EXISTING BOOKING EVENTS
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
        // NEW: YIELD MANAGEMENT EVENTS
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
        this.on('yield:customer_savings_opportunity', this.handleYieldCustomerSavingsOpportunity.bind(this));
        this.on('yield:dynamic_discount_available', this.handleYieldDynamicDiscountAvailable.bind(this));
        
        // Operational Events
        this.on('yield:forecast_update', this.handleYieldForecastUpdate.bind(this));
        this.on('yield:capacity_optimization', this.handleYieldCapacityOptimization.bind(this));
        this.on('yield:seasonal_adjustment', this.handleYieldSeasonalAdjustment.bind(this));
        
        logger.info('All notification event listeners initialized (including Yield Management)');
    }

    // ================================
    // EXISTING NOTIFICATION METHODS (UNCHANGED)
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
            metadata = {}
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
                    metadata
                });
            }

            // Send notifications across enabled channels
            const results = await Promise.allSettled([
                // Email notification
                userChannels.includes('email') ? this.sendEmailNotification(type, user, data) : null,
                
                // SMS notification
                userChannels.includes('sms') && user.phone ? this.sendSMSNotification(type, user, data) : null,
                
                // Socket.io real-time notification
                userChannels.includes('socket') ? this.sendSocketNotification(type, user, data) : null
            ].filter(promise => promise !== null));

            // Log notification results
            await this.logNotification({
                type,
                userId,
                channels: userChannels,
                results: results.map(result => ({
                    status: result.status,
                    value: result.value,
                    reason: result.reason
                })),
                priority,
                metadata,
                timestamp: new Date()
            });

            return {
                success: true,
                type,
                userId,
                channels: userChannels,
                results
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
                    return await emailService.sendBookingStatusUpdate(data.booking, user, data.hotel, 'CONFIRMED', data.adminComment);
                
                case 'BOOKING_REJECTED':
                    return await emailService.sendBookingStatusUpdate(data.booking, user, data.hotel, 'REJECTED', data.adminComment);
                
                case 'PAYMENT_REMINDER':
                    return await emailService.sendPaymentReminder(data.booking, user, data.hotel, data.daysUntilDue);
                
                case 'CHECKIN_REMINDER':
                    return await emailService.sendCheckInReminder(data.booking, user, data.hotel);
                
                case 'INVOICE_GENERATED':
                    return await emailService.sendInvoice(data.invoice, user, data.hotel, data.pdfBuffer);
                
                case 'LOYALTY_POINTS_EARNED':
                    return await emailService.sendLoyaltyPointsUpdate(user, data.pointsEarned, data.totalPoints, data.booking);
                
                case 'PROMOTIONAL_OFFER':
                    return await emailService.sendPromotionalOffer(user, data.promotion, data.hotels);
                
                case 'ENTERPRISE_WELCOME':
                    return await emailService.sendEnterpriseWelcome(data.company, user);

                // ================================
                // NEW: YIELD MANAGEMENT EMAIL NOTIFICATIONS
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
                    return await smsService.sendBookingStatusUpdate(data.booking, user, data.hotel, data.status, data.adminComment);
                
                case 'PAYMENT_REMINDER':
                    return await smsService.sendPaymentReminder(data.booking, user, data.hotel, data.daysUntilDue);
                
                case 'CHECKIN_REMINDER':
                    return await smsService.sendCheckInReminder(data.booking, user, data.hotel);
                
                case 'CHECKIN_INSTRUCTIONS':
                    return await smsService.sendCheckInInstructions(data.booking, user, data.hotel, data.roomNumber);
                
                case 'CHECKOUT_CONFIRMATION':
                    return await smsService.sendCheckoutConfirmation(data.booking, user, data.hotel, data.finalAmount);
                
                case 'LOYALTY_POINTS_EARNED':
                    return await smsService.sendLoyaltyPointsUpdate(user, data.pointsEarned, data.totalPoints);
                
                case 'PROMOTIONAL_OFFER':
                    return await smsService.sendPromotionalOffer(user, data.promotion, data.hotel);
                
                case 'URGENT_NOTIFICATION':
                    return await smsService.sendUrgentNotification(user, data.message, data.hotel);

                // ================================
                // NEW: YIELD MANAGEMENT SMS NOTIFICATIONS
                // ================================
                
                case 'YIELD_PRICE_DROP_ALERT':
                    return await this.sendYieldPriceDropSMS(user, data);
                
                case 'YIELD_DEMAND_SURGE_ALERT':
                    return await this.sendYieldDemandSurgeSMS(user, data);
                
                case 'YIELD_LAST_MINUTE_DEAL':
                    return await this.sendYieldLastMinuteDealSMS(user, data);
                
                case 'YIELD_OCCUPANCY_ALERT':
                    return await this.sendYieldOccupancyAlertSMS(user, data);
                
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
                timestamp: new Date()
            };

            return socketService.sendUserNotification(user._id.toString(), type, socketData);
        } catch (error) {
            logger.error(`Failed to send socket notification (${type}):`, error);
            throw error;
        }
    }

    // ================================
    // EXISTING EVENT HANDLERS (KEEP ALL)
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
                    message: `Votre réservation ${booking.confirmationNumber} a été créée avec succès !`
                },
                priority: 'high'
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
                        message: `Nouvelle réservation de ${user.firstName} ${user.lastName}`
                    },
                    priority: 'high'
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
                    message: `Votre réservation ${booking.confirmationNumber} a été confirmée !`
                },
                priority: 'high'
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
                    message: `Votre réservation ${booking.confirmationNumber} a été refusée`
                },
                priority: 'high'
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
                    message: `Check-in effectué ! Chambre(s): ${roomNumbers?.join(', ')}`
                },
                priority: 'high'
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
                    message: `Check-out effectué avec succès. Merci pour votre séjour !`
                },
                priority: 'medium'
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
                    message: `Rappel: Paiement dû dans ${daysUntilDue} jour(s)`
                },
                priority: 'high'
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
                    message: `Votre facture ${invoice.invoiceNumber} est disponible`
                },
                priority: 'medium'
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
                    message: `Vous avez gagné ${pointsEarned} points fidélité !`
                },
                priority: 'low'
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
            const notifications = userIds.map(userId => ({
                type: 'PROMOTIONAL_OFFER',
                userId,
                channels: ['email', 'socket'],
                data: {
                    promotion,
                    hotels,
                    message: `Nouvelle offre: ${promotion.title}`
                },
                priority: 'low'
            }));

            await this.sendBulkNotifications(notifications);
            logger.info(`Promotional offer sent to ${userIds.length} users`);
        } catch (error) {
            logger.error('Error handling promotional offer event:', error);
        }
    }

    // ================================
    // NEW: YIELD MANAGEMENT EVENT HANDLERS
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
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
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
                        significance: priceChangePercent >= this.yieldAlerts.thresholds.priceChange.major ? 'MAJOR' : 'SIGNIFICANT',
                        message: `Prix ${roomType} ajusté: ${priceChange.percentage > 0 ? '+' : ''}${priceChange.percentage.toFixed(1)}% (${demandLevel} demande)`
                    },
                    priority: priceChangePercent >= this.yieldAlerts.thresholds.priceChange.major ? 'high' : 'medium'
                });
            }

            // If major price increase, also notify customers who might be interested
            if (priceChange.percentage < -10) { // Price drop of 10%+
                await this.notifyCustomersOfPriceDrop(hotelId, roomType, priceChange);
            }

            this.markAlertSent(rateLimitKey);
            logger.info(`Yield price update notifications sent for ${hotel.name} - ${roomType}`);

        } catch (error) {
            logger.error('Error handling yield price update event:', error);
        }
    }

    /**
     * Handle demand surge notifications
     */
    async handleYieldDemandSurge(yieldData) {
        const { hotelId, demandLevel, occupancyRate, bookingTrend, revenueOpportunity } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            // Rate limiting check
            const rateLimitKey = `demand_surge_${hotelId}`;
            if (this.isRateLimited(rateLimitKey, this.yieldAlerts.rateLimiting.demandSurge)) {
                return;
            }

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Only alert for actual surge conditions
            if (demandLevel !== this.yieldAlerts.thresholds.demand.surge) {
                return;
            }

            // Notify hotel management and admins
            const alertRecipients = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const recipient of alertRecipients) {
                await this.sendNotification({
                    type: 'YIELD_DEMAND_SURGE_ALERT',
                    userId: recipient._id,
                    channels: ['socket', 'sms', 'email'],
                    data: {
                        hotel,
                        demandLevel,
                        occupancyRate,
                        bookingTrend,
                        revenueOpportunity,
                        urgency: 'HIGH',
                        recommendations: [
                            'Considérer une augmentation des prix',
                            'Surveiller la concurrence',
                            'Préparer les équipes pour un afflux de clients',
                            'Vérifier la disponibilité des chambres'
                        ],
                        message: `🚨 PIC DE DEMANDE détecté à ${hotel.name}! Opportunité revenue: +${revenueOpportunity.toFixed(0)}€`
                    },
                    priority: 'high'
                });
            }

            // Real-time dashboard alert
            socketService.sendAdminNotification('YIELD_DEMAND_SURGE', {
                hotelId,
                hotelName: hotel.name,
                demandLevel,
                occupancyRate,
                revenueOpportunity,
                timestamp: new Date()
            });

            this.markAlertSent(rateLimitKey);
            logger.info(`Demand surge alert sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling demand surge event:', error);
        }
    }

    /**
     * Handle demand drop notifications
     */
    async handleYieldDemandDrop(yieldData) {
        const { hotelId, demandLevel, occupancyRate, reasonAnalysis, recommendations } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Only alert for significant demand drops
            if (demandLevel !== this.yieldAlerts.thresholds.demand.drop) {
                return;
            }

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_DEMAND_DROP_ALERT',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        demandLevel,
                        occupancyRate,
                        reasonAnalysis,
                        recommendations,
                        message: `⚠️ Chute de demande détectée à ${hotel.name}. Actions recommandées.`
                    },
                    priority: 'medium'
                });
            }

            logger.info(`Demand drop alert sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling demand drop event:', error);
        }
    }

    /**
     * Handle critical occupancy notifications
     */
    async handleYieldOccupancyCritical(yieldData) {
        const { hotelId, occupancyRate, availableRooms, projectedOccupancy, alertType } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            // Rate limiting check
            const rateLimitKey = `occupancy_critical_${hotelId}`;
            if (this.isRateLimited(rateLimitKey, this.yieldAlerts.rateLimiting.occupancyCritical)) {
                return;
            }

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Determine alert urgency based on occupancy level
            let urgency = 'medium';
            let channels = ['socket', 'email'];
            
            if (occupancyRate >= this.yieldAlerts.thresholds.occupancy.critical) {
                urgency = 'high';
                channels = ['socket', 'sms', 'email'];
            }

            // Notify hotel staff
            const hotelStaff = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const staff of hotelStaff) {
                await this.sendNotification({
                    type: 'YIELD_OCCUPANCY_ALERT',
                    userId: staff._id,
                    channels,
                    data: {
                        hotel,
                        occupancyRate,
                        availableRooms,
                        projectedOccupancy,
                        alertType,
                        urgency,
                        recommendations: this.getOccupancyRecommendations(occupancyRate, alertType),
                        message: `${alertType === 'HIGH' ? '🔴' : '🟡'} Occupation ${alertType.toLowerCase()}: ${occupancyRate.toFixed(1)}% (${availableRooms} chambres restantes)`
                    },
                    priority: urgency
                });
            }

            this.markAlertSent(rateLimitKey);
            logger.info(`Occupancy ${alertType.toLowerCase()} alert sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling occupancy critical event:', error);
        }
    }

    /**
     * Handle low occupancy notifications
     */
    async handleYieldOccupancyLow(yieldData) {
        const { hotelId, occupancyRate, emptyRooms, marketAnalysis, actionPlan } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Only alert for very low occupancy
            if (occupancyRate > this.yieldAlerts.thresholds.occupancy.low) {
                return;
            }

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_OCCUPANCY_LOW_ALERT',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        occupancyRate,
                        emptyRooms,
                        marketAnalysis,
                        actionPlan,
                        urgency: occupancyRate <= this.yieldAlerts.thresholds.occupancy.veryLow ? 'HIGH' : 'MEDIUM',
                        message: `📉 Occupation faible: ${occupancyRate.toFixed(1)}% - Actions recommandées pour stimuler la demande`
                    },
                    priority: 'medium'
                });
            }

            logger.info(`Low occupancy alert sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling low occupancy event:', error);
        }
    }

    /**
     * Handle revenue optimization notifications
     */
    async handleYieldRevenueOptimization(yieldData) {
        const { hotelId, optimizationResults, potentialIncrease, recommendations, timeframe } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Only notify for significant optimization opportunities
            if (potentialIncrease < 100) { // Less than 100€ potential
                return;
            }

            // Notify hotel management and admins
            const recipients = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const recipient of recipients) {
                await this.sendNotification({
                    type: 'YIELD_REVENUE_OPTIMIZATION',
                    userId: recipient._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        optimizationResults,
                        potentialIncrease,
                        recommendations,
                        timeframe,
                        priority: potentialIncrease > 500 ? 'HIGH' : 'MEDIUM',
                        message: `💰 Opportunité d'optimisation: +${potentialIncrease.toFixed(0)}€ de revenus potentiels sur ${timeframe}`
                    },
                    priority: potentialIncrease > 500 ? 'high' : 'medium'
                });
            }

            logger.info(`Revenue optimization notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling revenue optimization event:', error);
        }
    }

    /**
     * Handle yield performance alerts
     */
    async handleYieldPerformanceAlert(yieldData) {
        const { hotelId, performanceMetrics, alertType, comparisonPeriod, actionItems } = yieldData;
        
        try {
            if (!this.yieldAlerts.enabled) return;

            // Rate limiting check
            const rateLimitKey = `performance_alert_${hotelId}`;
            if (this.isRateLimited(rateLimitKey, this.yieldAlerts.rateLimiting.revenueAlert)) {
                return;
            }

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify admins and hotel managers
            const recipients = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const recipient of recipients) {
                await this.sendNotification({
                    type: 'YIELD_PERFORMANCE_ALERT',
                    userId: recipient._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        performanceMetrics,
                        alertType,
                        comparisonPeriod,
                        actionItems,
                        severity: this.calculatePerformanceAlertSeverity(performanceMetrics),
                        message: `📊 Alerte performance yield: ${alertType} - Révision de stratégie recommandée`
                    },
                    priority: 'medium'
                });
            }

            this.markAlertSent(rateLimitKey);
            logger.info(`Performance alert sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling performance alert event:', error);
        }
    }

    /**
     * Handle revenue milestone notifications
     */
    async handleYieldRevenueMilestone(yieldData) {
        const { hotelId, milestone, actualRevenue, targetRevenue, achievement, period } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify hotel staff of milestone achievement
            const hotelStaff = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const staff of hotelStaff) {
                await this.sendNotification({
                    type: 'YIELD_REVENUE_MILESTONE',
                    userId: staff._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        milestone,
                        actualRevenue,
                        targetRevenue,
                        achievement,
                        period,
                        celebration: achievement >= 100,
                        message: achievement >= 100 
                            ? `🎉 Objectif de revenus atteint! ${actualRevenue.toFixed(0)}€ (${achievement.toFixed(1)}% de l'objectif)`
                            : `📈 Progression revenus: ${actualRevenue.toFixed(0)}€ (${achievement.toFixed(1)}% de l'objectif)`
                    },
                    priority: achievement >= 100 ? 'high' : 'medium'
                });
            }

            logger.info(`Revenue milestone notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling revenue milestone event:', error);
        }
    }

    /**
     * Handle revenue target missed notifications
     */
    async handleYieldRevenueTargetMissed(yieldData) {
        const { hotelId, targetRevenue, actualRevenue, shortfall, causes, recoveryPlan } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_REVENUE_TARGET_MISSED',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        targetRevenue,
                        actualRevenue,
                        shortfall,
                        shortfallPercent: ((targetRevenue - actualRevenue) / targetRevenue * 100).toFixed(1),
                        causes,
                        recoveryPlan,
                        urgency: shortfall > 1000 ? 'HIGH' : 'MEDIUM',
                        message: `⚠️ Objectif de revenus non atteint: -${shortfall.toFixed(0)}€ par rapport à l'objectif`
                    },
                    priority: shortfall > 1000 ? 'high' : 'medium'
                });
            }

            logger.info(`Revenue target missed notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling revenue target missed event:', error);
        }
    }

    /**
     * Handle pricing rule triggered notifications
     */
    async handleYieldPricingRuleTriggered(yieldData) {
        const { hotelId, ruleId, ruleName, trigger, priceAdjustment, roomsAffected } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify hotel management
            const hotelStaff = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const staff of hotelStaff) {
                await this.sendNotification({
                    type: 'YIELD_PRICING_RULE_TRIGGERED',
                    userId: staff._id,
                    channels: ['socket'],
                    data: {
                        hotel,
                        ruleId,
                        ruleName,
                        trigger,
                        priceAdjustment,
                        roomsAffected,
                        message: `⚙️ Règle de pricing "${ruleName}" activée: ${priceAdjustment > 0 ? '+' : ''}${priceAdjustment.toFixed(1)}% sur ${roomsAffected} chambre(s)`
                    },
                    priority: 'low'
                });
            }

            logger.info(`Pricing rule triggered notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling pricing rule triggered event:', error);
        }
    }

    /**
     * Handle pricing recommendation notifications
     */
    async handleYieldPricingRecommendation(yieldData) {
        const { hotelId, recommendations, confidence, potentialImpact, timeframe } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Only send high-confidence recommendations
            if (confidence < 70) {
                return;
            }

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_PRICING_RECOMMENDATION',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        recommendations,
                        confidence,
                        potentialImpact,
                        timeframe,
                        urgency: confidence > 85 ? 'HIGH' : 'MEDIUM',
                        message: `💡 Recommandation pricing (${confidence}% confiance): Impact potentiel +${potentialImpact.toFixed(0)}€`
                    },
                    priority: confidence > 85 ? 'high' : 'medium'
                });
            }

            logger.info(`Pricing recommendation sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling pricing recommendation event:', error);
        }
    }

    /**
     * Handle customer price drop notifications
     */
    async handleYieldCustomerPriceDrop(yieldData) {
        const { userId, hotelId, roomType, priceChange, validUntil, bookingUrl } = yieldData;
        
        try {
            const user = await User.findById(userId);
            const hotel = await Hotel.findById(hotelId);
            
            if (!user || !hotel) return;

            await this.sendNotification({
                type: 'YIELD_PRICE_DROP_ALERT',
                userId: userId,
                channels: ['sms', 'socket', 'email'],
                data: {
                    hotel,
                    roomType,
                    priceChange,
                    validUntil,
                    bookingUrl,
                    savings: Math.abs(priceChange.amount),
                    urgency: 'HIGH',
                    message: `🎉 Prix baissé! ${hotel.name} - ${roomType}: -${Math.abs(priceChange.percentage).toFixed(0)}% (économisez ${Math.abs(priceChange.amount).toFixed(0)}€)`
                },
                priority: 'high'
            });

            logger.info(`Price drop alert sent to customer ${userId} for ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling customer price drop event:', error);
        }
    }

    /**
     * Handle customer savings opportunity notifications
     */
    async handleYieldCustomerSavingsOpportunity(yieldData) {
        const { userId, opportunities, totalSavings, expiresAt } = yieldData;
        
        try {
            const user = await User.findById(userId);
            if (!user) return;

            await this.sendNotification({
                type: 'YIELD_SAVINGS_OPPORTUNITY',
                userId: userId,
                channels: ['email', 'socket'],
                data: {
                    opportunities,
                    totalSavings,
                    expiresAt,
                    opportunityCount: opportunities.length,
                    message: `💰 ${opportunities.length} opportunité(s) d'économies: jusqu'à ${totalSavings.toFixed(0)}€ d'économies possibles!`
                },
                priority: 'medium'
            });

            logger.info(`Savings opportunity notification sent to customer ${userId}`);

        } catch (error) {
            logger.error('Error handling customer savings opportunity event:', error);
        }
    }

    /**
     * Handle dynamic discount available notifications
     */
    async handleYieldDynamicDiscountAvailable(yieldData) {
        const { userIds, hotelId, discount, conditions, validUntil } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Send to multiple users
            const notifications = userIds.map(userId => ({
                type: 'YIELD_LAST_MINUTE_DEAL',
                userId,
                channels: ['sms', 'socket'],
                data: {
                    hotel,
                    discount,
                    conditions,
                    validUntil,
                    urgency: 'HIGH',
                    message: `⏰ Offre flash ${hotel.name}: -${discount.percentage}% pendant ${this.getTimeRemaining(validUntil)}!`
                },
                priority: 'high'
            }));

            await this.sendBulkNotifications(notifications);
            logger.info(`Dynamic discount notifications sent to ${userIds.length} customers for ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling dynamic discount available event:', error);
        }
    }

    /**
     * Handle forecast update notifications
     */
    async handleYieldForecastUpdate(yieldData) {
        const { hotelId, forecastData, changesSinceLastForecast, keyInsights } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_FORECAST_UPDATE',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        forecastData,
                        changesSinceLastForecast,
                        keyInsights,
                        message: `📊 Nouvelles prévisions disponibles: ${keyInsights.length} insight(s) clé(s) identifié(s)`
                    },
                    priority: 'low'
                });
            }

            logger.info(`Forecast update notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling forecast update event:', error);
        }
    }

    /**
     * Handle strategy effectiveness notifications
     */
    async handleYieldStrategyEffectiveness(yieldData) {
        const { hotelId, strategyName, effectiveness, recommendations, period } = yieldData;
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) return;

            // Notify hotel management
            const hotelManagers = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });

            for (const manager of hotelManagers) {
                await this.sendNotification({
                    type: 'YIELD_STRATEGY_EFFECTIVENESS',
                    userId: manager._id,
                    channels: ['socket', 'email'],
                    data: {
                        hotel,
                        strategyName,
                        effectiveness,
                        recommendations,
                        period,
                        needsReview: effectiveness < 70,
                        message: `📈 Efficacité stratégie "${strategyName}": ${effectiveness.toFixed(1)}% ${effectiveness < 70 ? '- Révision recommandée' : '- Performance satisfaisante'}`
                    },
                    priority: effectiveness < 70 ? 'medium' : 'low'
                });
            }

            logger.info(`Strategy effectiveness notification sent for hotel ${hotel.name}`);

        } catch (error) {
            logger.error('Error handling strategy effectiveness event:', error);
        }
    }

    // ================================
    // YIELD MANAGEMENT EMAIL TEMPLATES
    // ================================

    /**
     * Send yield price update email
     */
    async sendYieldPriceUpdateEmail(user, data) {
        const { hotel, roomType, priceChange, demandLevel, strategy, significance } = data;
        
        const emailData = {
            user: {
                firstName: user.firstName,
                lastName: user.lastName
            },
            hotel: {
                name: hotel.name,
                code: hotel.code
            },
            priceUpdate: {
                roomType,
                priceChange,
                demandLevel,
                strategy,
                significance,
                effectiveDate: new Date(),
                reason: this.getPriceChangeReason(priceChange, demandLevel)
            },
            recommendations: this.getPriceUpdateRecommendations(priceChange, demandLevel),
            year: new Date().getFullYear()
        };

        // Use template or send formatted email
        return await emailService.sendCustomEmail(
            user.email,
            `Mise à jour prix ${roomType} - ${hotel.name}`,
            this.generateYieldPriceUpdateEmailContent(emailData)
        );
    }

    /**
     * Send yield savings opportunity email
     */
    async sendYieldSavingsOpportunityEmail(user, data) {
        const { opportunities, totalSavings, expiresAt } = data;
        
        const emailData = {
            user: {
                firstName: user.firstName,
                lastName: user.lastName
            },
            savings: {
                opportunities,
                totalSavings,
                expiresAt,
                validityHours: Math.ceil((new Date(expiresAt) - new Date()) / (1000 * 60 * 60))
            },
            year: new Date().getFullYear()
        };

        return await emailService.sendCustomEmail(
            user.email,
            `💰 Opportunités d'économies - Jusqu'à ${totalSavings.toFixed(0)}€!`,
            this.generateYieldSavingsEmailContent(emailData)
        );
    }

    /**
     * Send yield revenue report email
     */
    async sendYieldRevenueReportEmail(user, data) {
        const { hotel, reportData, period, keyMetrics } = data;
        
        const emailData = {
            user: {
                firstName: user.firstName,
                lastName: user.lastName
            },
            hotel: {
                name: hotel.name
            },
            report: {
                period,
                keyMetrics,
                reportData,
                generatedAt: new Date()
            },
            year: new Date().getFullYear()
        };

        return await emailService.sendCustomEmail(
            user.email,
            `📊 Rapport Yield Management - ${hotel.name}`,
            this.generateYieldRevenueReportEmailContent(emailData)
        );
    }

    /**
     * Send yield pricing recommendation email
     */
    async sendYieldPricingRecommendationEmail(user, data) {
        const { hotel, recommendations, confidence, potentialImpact } = data;
        
        const emailData = {
            user: {
                firstName: user.firstName,
                lastName: user.lastName
            },
            hotel: {
                name: hotel.name
            },
            recommendations: {
                items: recommendations,
                confidence,
                potentialImpact,
                priority: confidence > 85 ? 'HIGH' : 'MEDIUM'
            },
            year: new Date().getFullYear()
        };

        return await emailService.sendCustomEmail(
            user.email,
            `💡 Recommandations Pricing - ${hotel.name}`,
            this.generateYieldRecommendationEmailContent(emailData)
        );
    }

    /**
     * Send yield performance alert email
     */
    async sendYieldPerformanceAlertEmail(user, data) {
        const { hotel, performanceMetrics, alertType, actionItems } = data;
        
        const emailData = {
            user: {
                firstName: user.firstName,
                lastName: user.lastName
            },
            hotel: {
                name: hotel.name
            },
            performance: {
                metrics: performanceMetrics,
                alertType,
                actionItems,
                severity: this.calculatePerformanceAlertSeverity(performanceMetrics)
            },
            year: new Date().getFullYear()
        };

        return await emailService.sendCustomEmail(
            user.email,
            `⚠️ Alerte Performance Yield - ${hotel.name}`,
            this.generateYieldPerformanceAlertEmailContent(emailData)
        );
    }

    // ================================
    // YIELD MANAGEMENT SMS TEMPLATES
    // ================================

    /**
     * Send yield price drop SMS
     */
    async sendYieldPriceDropSMS(user, data) {
        const { hotel, roomType, priceChange, validUntil } = data;
        
        const message = `🎉 PRIX BAISSÉ!
${hotel.name} - ${roomType}
💰 -${Math.abs(priceChange.percentage).toFixed(0)}% 
⏰ Valable ${this.getTimeRemaining(validUntil)}
📱 Réservez maintenant!`;

        return await smsService.sendSMS(user.phone, message);
    }

    /**
     * Send yield demand surge SMS
     */
    async sendYieldDemandSurgeSMS(user, data) {
        const { hotel, demandLevel, revenueOpportunity } = data;
        
        const message = `🚨 PIC DE DEMANDE
${hotel.name}
📈 Demande: ${demandLevel}
💰 Opportunité: +${revenueOpportunity.toFixed(0)}€
🔧 Action recommandée immédiate`;

        return await smsService.sendSMS(user.phone, message);
    }

    /**
     * Send yield last minute deal SMS
     */
    async sendYieldLastMinuteDealSMS(user, data) {
        const { hotel, discount, validUntil } = data;
        
        const message = `⏰ OFFRE FLASH!
${hotel.name}
🎯 -${discount.percentage}% 
⏰ ${this.getTimeRemaining(validUntil)} restant
📲 Réservez vite!`;

        return await smsService.sendSMS(user.phone, message);
    }

    /**
     * Send yield occupancy alert SMS
     */
    async sendYieldOccupancyAlertSMS(user, data) {
        const { hotel, occupancyRate, alertType, urgency } = data;
        
        const message = `${urgency === 'HIGH' ? '🔴' : '🟡'} OCCUPATION ${alertType}
${hotel.name}
📊 ${occupancyRate.toFixed(1)}%
⚡ Action ${urgency.toLowerCase()} requise`;

        return await smsService.sendSMS(user.phone, message);
    }

    // ================================
    // YIELD MANAGEMENT UTILITY METHODS
    // ================================

    /**
     * Check if alert is rate limited
     */
    isRateLimited(key, limitMs) {
        const lastAlert = this.yieldAlerts.lastAlerts.get(key);
        if (!lastAlert) return false;
        
        return (Date.now() - lastAlert) < limitMs;
    }

    /**
     * Mark alert as sent for rate limiting
     */
    markAlertSent(key) {
        this.yieldAlerts.lastAlerts.set(key, Date.now());
    }

    /**
     * Get occupancy recommendations based on level and type
     */
    getOccupancyRecommendations(occupancyRate, alertType) {
        if (alertType === 'HIGH' || occupancyRate >= this.yieldAlerts.thresholds.occupancy.critical) {
            return [
                'Considérer une augmentation des prix',
                'Vérifier les surréservations',
                'Préparer la liste d\'attente',
                'Alerter les équipes opérationnelles',
                'Surveiller les annulations'
            ];
        }
        
        if (alertType === 'LOW' || occupancyRate <= this.yieldAlerts.thresholds.occupancy.low) {
            return [
                'Lancer des promotions ciblées',
                'Réduire temporairement les prix',
                'Contacter les agences de voyage',
                'Promouvoir sur les réseaux sociaux',
                'Analyser la concurrence'
            ];
        }
        
        return [
            'Surveiller l\'évolution',
            'Maintenir la stratégie actuelle',
            'Préparer des ajustements si nécessaire'
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
            recommendations.push('Surveiller l\'impact sur les réservations');
            recommendations.push('Communiquer la valeur ajoutée aux clients');
        }
        
        if (demandLevel === 'VERY_HIGH') {
            recommendations.push('Préparer une capacité supplémentaire si possible');
            recommendations.push('Analyser les opportunités d\'upselling');
        }
        
        if (demandLevel === 'LOW') {
            recommendations.push('Considérer des promotions complémentaires');
            recommendations.push('Réviser la stratégie marketing');
        }
        
        return recommendations;
    }

    /**
     * Get time remaining in human readable format
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
                    bookingUrl: `${process.env.FRONTEND_URL}/hotels/${hotelId}/book?room=${roomType}`
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
                status: { $in: ['COMPLETED', 'CONFIRMED'] }
            }).populate('customer').limit(50);
            
            const interestedCustomers = pastBookings
                .map(booking => booking.customer)
                .filter(customer => customer && customer.email)
                .filter((customer, index, self) => 
                    index === self.findIndex(c => c._id.toString() === customer._id.toString())
                ); // Remove duplicates
            
            return interestedCustomers;
            
        } catch (error) {
            logger.error('Error finding interested customers:', error);
            return [];
        }
    }

    // ================================
    // EMAIL CONTENT GENERATORS FOR YIELD ALERTS
    // ================================

    /**
     * Generate yield price update email content
     */
    generateYieldPriceUpdateEmailContent(data) {
        const { user, hotel, priceUpdate, recommendations } = data;
        
        return `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">💰 Mise à jour des Prix</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">${hotel.name}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: #667eea; margin-top: 0;">Bonjour ${user.firstName},</h2>
                    <p>Les prix ont été ajustés pour le type de chambre <strong>${priceUpdate.roomType}</strong> :</p>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; border-left: 4px solid ${priceUpdate.priceChange.percentage > 0 ? '#e74c3c' : '#27ae60'};">
                        <h3 style="margin: 0 0 10px 0;">Changement de prix :</h3>
                        <p style="font-size: 24px; font-weight: bold; color: ${priceUpdate.priceChange.percentage > 0 ? '#e74c3c' : '#27ae60'}; margin: 0;">
                            ${priceUpdate.priceChange.percentage > 0 ? '+' : ''}${priceUpdate.priceChange.percentage.toFixed(1)}%
                        </p>
                        <p style="margin: 5px 0 0 0; color: #666;">${priceUpdate.reason}</p>
                    </div>
                    
                    <div style="margin: 20px 0;">
                        <h4>Contexte :</h4>
                        <ul>
                            <li><strong>Niveau de demande :</strong> ${priceUpdate.demandLevel}</li>
                            <li><strong>Stratégie :</strong> ${priceUpdate.strategy}</li>
                            <li><strong>Signification :</strong> ${priceUpdate.significance}</li>
                            <li><strong>Date d'effet :</strong> ${priceUpdate.effectiveDate.toLocaleDateString()}</li>
                        </ul>
                    </div>
                    
                    ${recommendations.length > 0 ? `
                    <div style="background: #e3f2fd; padding: 15px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin: 0 0 10px 0; color: #1976d2;">📋 Recommandations :</h4>
                        <ul style="margin: 0;">
                            ${recommendations.map(rec => `<li>${rec}</li>`).join('')}
                        </ul>
                    </div>
                    ` : ''}
                </div>
                
                <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                    <p>Système de gestion hôtelière avec Yield Management</p>
                    <p>© ${data.year} - Tous droits réservés</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate yield savings email content
     */
    generateYieldSavingsEmailContent(data) {
        const { user, savings } = data;
        
        return `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #28a745 0%, #20c997 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">💰 Opportunités d'Économies</h1>
                    <p style="margin: 10px 0 0 0; font-size: 18px;">Jusqu'à ${savings.totalSavings.toFixed(0)}€ d'économies!</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: #28a745; margin-top: 0;">Bonjour ${user.firstName},</h2>
                    <p>Nous avons identifié ${savings.opportunities.length} opportunité(s) d'économies exceptionnelles pour vous :</p>
                    
                    ${savings.opportunities.map(opp => `
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 15px 0; border-left: 4px solid #28a745;">
                        <h3 style="margin: 0 0 10px 0; color: #333;">${opp.hotelName}</h3>
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <div>
                                <p style="margin: 0; color: #666;">${opp.roomType}</p>
                                <p style="margin: 5px 0 0 0; font-size: 14px; color: #666;">${opp.dates}</p>
                            </div>
                            <div style="text-align: right;">
                                <p style="margin: 0; font-size: 20px; font-weight: bold; color: #28a745;">-${opp.discount}%</p>
                                <p style="margin: 0; font-size: 14px; color: #666;">Économisez ${opp.savings.toFixed(0)}€</p>
                            </div>
                        </div>
                        <div style="margin-top: 15px;">
                            <a href="${opp.bookingUrl}" style="background: #28a745; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
                                Réserver maintenant
                            </a>
                        </div>
                    </div>
                    `).join('')}
                    
                    <div style="background: #fff3cd; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                        <p style="margin: 0; font-weight: bold;">⏰ Offres valides pendant ${savings.validityHours}h seulement!</p>
                        <p style="margin: 5px 0 0 0; font-size: 14px;">Expire le ${new Date(savings.expiresAt).toLocaleString()}</p>
                    </div>
                </div>
                
                <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                    <p>Powered by Yield Management AI</p>
                    <p>© ${data.year} - Tous droits réservés</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate yield revenue report email content
     */
    generateYieldRevenueReportEmailContent(data) {
        const { user, hotel, report } = data;
        
        return `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">📊 Rapport Yield Management</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">${hotel.name} - ${report.period}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: #6c5ce7; margin-top: 0;">Bonjour ${user.firstName},</h2>
                    <p>Voici le rapport de performance Yield Management pour la période ${report.period} :</p>
                    
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin: 20px 0;">
                        ${report.keyMetrics.map(metric => `
                        <div style="background: white; padding: 15px; border-radius: 8px; text-align: center; border: 2px solid #e9ecef;">
                            <h4 style="margin: 0 0 5px 0; color: #6c5ce7;">${metric.label}</h4>
                            <p style="margin: 0; font-size: 24px; font-weight: bold; color: ${metric.trend === 'up' ? '#28a745' : metric.trend === 'down' ? '#e74c3c' : '#333'};">
                                ${metric.value}
                            </p>
                            ${metric.change ? `<p style="margin: 5px 0 0 0; font-size: 12px; color: #666;">${metric.change}</p>` : ''}
                        </div>
                        `).join('')}
                    </div>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                        <h4 style="margin: 0 0 15px 0; color: #6c5ce7;">📈 Insights Clés :</h4>
                        <ul style="margin: 0;">
                            ${report.reportData.insights.map(insight => `<li>${insight}</li>`).join('')}
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin: 25px 0;">
                        <a href="${process.env.FRONTEND_URL}/dashboard/yield" style="background: #6c5ce7; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block;">
                            Voir le rapport détaillé
                        </a>
                    </div>
                </div>
                
                <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                    <p>Rapport généré le ${report.generatedAt.toLocaleString()}</p>
                    <p>© ${data.year} - Système de Yield Management</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate yield recommendation email content
     */
    generateYieldRecommendationEmailContent(data) {
        const { user, hotel, recommendations } = data;
        
        return `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, #fd79a8 0%, #fdcb6e 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">💡 Recommandations Pricing</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">${hotel.name}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: #fd79a8; margin-top: 0;">Bonjour ${user.firstName},</h2>
                    <p>Notre système a identifié des opportunités d'optimisation pour vos prix :</p>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #fd79a8;">
                        <h3 style="margin: 0 0 10px 0;">Impact Potentiel</h3>
                        <p style="font-size: 28px; font-weight: bold; color: #fd79a8; margin: 0;">
                            +${recommendations.potentialImpact.toFixed(0)}€
                        </p>
                        <p style="margin: 5px 0 0 0; color: #666;">Revenus supplémentaires estimés</p>
                        <div style="margin: 15px 0;">
                            <span style="background: #e3f2fd; color: #1976d2; padding: 5px 10px; border-radius: 15px; font-size: 12px; font-weight: bold;">
                                ${recommendations.confidence}% de confiance
                            </span>
                            <span style="background: ${recommendations.priority === 'HIGH' ? '#ffebee' : '#f3e5f5'}; color: ${recommendations.priority === 'HIGH' ? '#c62828' : '#7b1fa2'}; padding: 5px 10px; border-radius: 15px; font-size: 12px; font-weight: bold; margin-left: 10px;">
                                Priorité ${recommendations.priority}
                            </span>
                        </div>
                    </div>
                    
                    <div style="margin: 25px 0;">
                        <h4 style="color: #fd79a8;">📋 Recommandations :</h4>
                        ${recommendations.items.map((rec, index) => `
                        <div style="background: white; padding: 15px; border-radius: 8px; margin: 10px 0; border: 1px solid #e9ecef;">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                <div style="flex: 1;">
                                    <h5 style="margin: 0 0 5px 0; color: #333;">${index + 1}. ${rec.title}</h5>
                                    <p style="margin: 0 0 10px 0; color: #666; font-size: 14px;">${rec.description}</p>
                                    <div style="font-size: 12px; color: #666;">
                                        <span>Type: ${rec.type}</span> • 
                                        <span>Chambres: ${rec.roomTypes.join(', ')}</span>
                                    </div>
                                </div>
                                <div style="text-align: right; margin-left: 15px;">
                                    <p style="margin: 0; font-weight: bold; color: #28a745;">+${rec.expectedImpact.toFixed(0)}€</p>
                                    <p style="margin: 0; font-size: 12px; color: #666;">${rec.timeframe}</p>
                                </div>
                            </div>
                        </div>
                        `).join('')}
                    </div>
                    
                    <div style="text-align: center; margin: 25px 0;">
                        <a href="${process.env.FRONTEND_URL}/dashboard/yield/recommendations" style="background: #fd79a8; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block; margin-right: 10px;">
                            Appliquer les recommandations
                        </a>
                        <a href="${process.env.FRONTEND_URL}/dashboard/yield/analysis" style="background: transparent; color: #fd79a8; padding: 12px 25px; text-decoration: none; border-radius: 6px; border: 2px solid #fd79a8; display: inline-block;">
                            Voir l'analyse détaillée
                        </a>
                    </div>
                </div>
                
                <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                    <p>Recommandations générées par IA - Yield Management</p>
                    <p>© ${data.year} - Tous droits réservés</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    /**
     * Generate yield performance alert email content
     */
    generateYieldPerformanceAlertEmailContent(data) {
        const { user, hotel, performance } = data;
        
        const severityColors = {
            'HIGH': '#e74c3c',
            'MEDIUM': '#f39c12',
            'LOW': '#95a5a6'
        };
        
        return `
        <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
            <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <div style="background: linear-gradient(135deg, ${severityColors[performance.severity]} 0%, ${severityColors[performance.severity]}88 100%); color: white; padding: 30px; border-radius: 10px; text-align: center;">
                    <h1 style="margin: 0; font-size: 28px;">⚠️ Alerte Performance</h1>
                    <p style="margin: 10px 0 0 0; font-size: 16px;">${hotel.name} - ${performance.alertType}</p>
                </div>
                
                <div style="background: #f8f9fa; padding: 25px; border-radius: 10px; margin: 20px 0;">
                    <h2 style="color: ${severityColors[performance.severity]}; margin-top: 0;">Bonjour ${user.firstName},</h2>
                    <p>Une alerte de performance ${performance.severity.toLowerCase()} a été détectée pour votre établissement :</p>
                    
                    <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid ${severityColors[performance.severity]};">
                        <h3 style="margin: 0 0 15px 0;">📊 Métriques de Performance</h3>
                        ${Object.entries(performance.metrics).map(([key, value]) => `
                        <div style="display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #eee;">
                            <span style="font-weight: 500;">${key}:</span>
                            <span style="color: ${value.trend === 'down' ? '#e74c3c' : value.trend === 'up' ? '#27ae60' : '#333'}; font-weight: bold;">
                                ${value.current} ${value.change ? `(${value.change})` : ''}
                            </span>
                        </div>
                        `).join('')}
                    </div>
                    
                    ${performance.actionItems.length > 0 ? `
                    <div style="background: #fff3cd; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #ffc107;">
                        <h4 style="margin: 0 0 15px 0; color: #856404;">🎯 Actions Recommandées</h4>
                        <ol style="margin: 0; color: #856404;">
                            ${performance.actionItems.map(action => `
                            <li style="margin-bottom: 8px;">
                                <strong>${action.title}:</strong> ${action.description}
                                ${action.urgency ? `<span style="background: #dc3545; color: white; padding: 2px 6px; border-radius: 3px; font-size: 11px; margin-left: 8px;">${action.urgency}</span>` : ''}
                            </li>
                            `).join('')}
                        </ol>
                    </div>
                    ` : ''}
                    
                    <div style="text-align: center; margin: 25px 0;">
                        <a href="${process.env.FRONTEND_URL}/dashboard/yield/performance" style="background: ${severityColors[performance.severity]}; color: white; padding: 12px 25px; text-decoration: none; border-radius: 6px; display: inline-block;">
                            Voir le tableau de bord complet
                        </a>
                    </div>
                </div>
                
                <div style="text-align: center; padding: 20px; color: #666; font-size: 14px;">
                    <p>Alerte générée automatiquement par le système de monitoring</p>
                    <p>© ${data.year} - Yield Management System</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    // ================================
    // EXISTING UTILITY METHODS (KEEP ALL)
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
                batch.map(notification => this.sendNotification(notification))
            );

            results.push(...batchResults);

            // Small delay between batches
            if (i + batchSize < notifications.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
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
                    $lt: new Date(tomorrow.setHours(23, 59, 59, 999))
                },
                status: 'CONFIRMED'
            }).populate('customer').populate('hotel');

            const notifications = upcomingBookings.map(booking => ({
                type: 'CHECKIN_REMINDER',
                userId: booking.customer._id,
                channels: ['email', 'sms'],
                data: {
                    booking,
                    hotel: booking.hotel,
                    message: `Rappel: Votre arrivée est prévue demain`
                },
                priority: 'medium'
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
        
        return channels.filter(channel => {
            return preferences[channel] !== false;
        });
    }

    shouldRetry(error) {
        const retryableErrors = [
            'NETWORK_ERROR',
            'TIMEOUT',
            'RATE_LIMIT',
            'TEMPORARY_FAILURE'
        ];
        
        return retryableErrors.some(errorType => 
            error.message.includes(errorType) || error.code === errorType
        );
    }

    async addToRetryQueue(notificationData) {
        const retryData = {
            ...notificationData,
            retryCount: (notificationData.retryCount || 0) + 1,
            nextRetryAt: new Date(Date.now() + this.retryDelay * Math.pow(2, notificationData.retryCount || 0))
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
            success: logData.results.filter(r => r.status === 'fulfilled').length,
            failed: logData.results.filter(r => r.status === 'rejected').length
        });
    }

    getNotificationTitle(type) {
        const titles = {
            // Existing titles
            'BOOKING_CREATED': 'Réservation Créée',
            'BOOKING_CONFIRMED': 'Réservation Confirmée',
            'BOOKING_REJECTED': 'Réservation Refusée',
            'CHECKIN_REMINDER': 'Rappel d\'Arrivée',
            'PAYMENT_REMINDER': 'Rappel de Paiement',
            'INVOICE_GENERATED': 'Facture Disponible',
            'LOYALTY_POINTS_EARNED': 'Points Fidélité',
            'PROMOTIONAL_OFFER': 'Offre Spéciale',
            
            // NEW: Yield Management titles
            'YIELD_PRICE_UPDATE': 'Mise à Jour Prix',
            'YIELD_DEMAND_SURGE_ALERT': 'Alerte Pic de Demande',
            'YIELD_DEMAND_DROP_ALERT': 'Alerte Chute de Demande',
            'YIELD_OCCUPANCY_ALERT': 'Alerte Occupation',
            'YIELD_OCCUPANCY_LOW_ALERT': 'Alerte Occupation Faible',
            'YIELD_REVENUE_OPTIMIZATION': 'Optimisation Revenus',
            'YIELD_PERFORMANCE_ALERT': 'Alerte Performance',
            'YIELD_REVENUE_MILESTONE': 'Objectif Revenus',
            'YIELD_REVENUE_TARGET_MISSED': 'Objectif Non Atteint',
            'YIELD_PRICING_RULE_TRIGGERED': 'Règle Pricing Activée',
            'YIELD_PRICING_RECOMMENDATION': 'Recommandation Pricing',
            'YIELD_PRICE_DROP_ALERT': 'Prix Baissé',
            'YIELD_SAVINGS_OPPORTUNITY': 'Opportunité d\'Économies',
            'YIELD_LAST_MINUTE_DEAL': 'Offre Flash',
            'YIELD_FORECAST_UPDATE': 'Prévisions Mises à Jour',
            'YIELD_STRATEGY_EFFECTIVENESS': 'Efficacité Stratégie'
        };
        return titles[type] || 'Notification';
    }

    getNotificationMessage(type, data) {
        switch (type) {
            // Existing cases
            case 'BOOKING_CREATED':
                return `Votre réservation ${data.booking?.confirmationNumber} a été créée`;
            case 'BOOKING_CONFIRMED':
                return `Votre réservation ${data.booking?.confirmationNumber} est confirmée`;
            case 'PAYMENT_REMINDER':
                return `Rappel: Paiement dû dans ${data.daysUntilDue} jour(s)`;
                
            // NEW: Yield Management messages
            case 'YIELD_PRICE_UPDATE':
                return `Prix ${data.roomType} ajusté: ${data.priceChange?.percentage > 0 ? '+' : ''}${data.priceChange?.percentage?.toFixed(1)}%`;
            case 'YIELD_DEMAND_SURGE_ALERT':
                return `Pic de demande détecté - Opportunité: +${data.revenueOpportunity?.toFixed(0)}€`;
            case 'YIELD_OCCUPANCY_ALERT':
                return `Occupation ${data.alertType?.toLowerCase()}: ${data.occupancyRate?.toFixed(1)}%`;
            case 'YIELD_REVENUE_OPTIMIZATION':
                return `Opportunité d'optimisation: +${data.potentialIncrease?.toFixed(0)}€`;
            case 'YIELD_PRICE_DROP_ALERT':
                return `Prix baissé: -${Math.abs(data.priceChange?.percentage || 0).toFixed(0)}% sur ${data.roomType}`;
            case 'YIELD_SAVINGS_OPPORTUNITY':
                return `${data.opportunityCount} opportunité(s) d'économies disponible(s)`;
            case 'YIELD_LAST_MINUTE_DEAL':
                return `Offre flash: -${data.discount?.percentage}% pendant ${this.getTimeRemaining(data.validUntil)}`;
                
            default:
                return data.message || 'Nouvelle notification';
        }
    }

    // ================================
    // ENHANCED NOTIFICATION STATISTICS WITH YIELD TRACKING
    // ================================

    /**
     * Get notification statistics including yield management metrics
     */
    async getNotificationStats(timeframe = '24h') {
        try {
            const hours = timeframe === '24h' ? 24 : timeframe === '7d' ? 168 : 24;
            const since = new Date(Date.now() - hours * 60 * 60 * 1000);
            
            // This would integrate with a notification logging system
            // For now, return estimated stats structure
            
            const baseStats = {
                sent: 0,
                delivered: 0,
                failed: 0,
                channels: {
                    email: 0,
                    sms: 0,
                    socket: 0
                }
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
                    yieldAlertSuccessRate: 0
                };
            }
            
            return baseStats;
            
        } catch (error) {
            logger.error('Error getting notification stats:', error);
            return {
                sent: 0,
                delivered: 0,
                failed: 0,
                channels: { email: 0, sms: 0, socket: 0 }
            };
        }
    }

    /**
     * Get enhanced service status including yield management
     */
    getServiceStatus() {
        const baseStatus = {
            emailService: emailService ? 'Connected' : 'Disconnected',
            smsService: smsService ? 'Connected' : 'Disconnected',
            socketService: socketService ? 'Connected' : 'Disconnected',
            queueSize: this.notificationQueue.length,
            channels: this.channels
        };
        
        // Add yield management status
        if (this.yieldAlerts.enabled) {
            baseStatus.yieldManagement = {
                enabled: this.yieldAlerts.enabled,
                alertsConfigured: Object.keys(this.yieldAlerts.thresholds).length,
                rateLimitingActive: this.yieldAlerts.lastAlerts.size > 0,
                lastYieldAlert: this.getLastYieldAlertTime(),
                yieldEventListeners: this.getYieldEventListenerCount()
            };
        }
        
        return baseStatus;
    }

    /**
     * Get last yield alert time
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
     * Get count of yield event listeners
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
            'yield:strategy_effectiveness'
        ];
        
        return yieldEvents.filter(event => this.listenerCount(event) > 0).length;
    }

    // ================================
    // YIELD MANAGEMENT CONFIGURATION METHODS
    // ================================

    /**
     * Update yield alert configuration
     */
    updateYieldAlertConfig(newConfig) {
        if (newConfig.enabled !== undefined) {
            this.yieldAlerts.enabled = newConfig.enabled;
        }
        
        if (newConfig.thresholds) {
            this.yieldAlerts.thresholds = {
                ...this.yieldAlerts.thresholds,
                ...newConfig.thresholds
            };
        }
        
        if (newConfig.rateLimiting) {
            this.yieldAlerts.rateLimiting = {
                ...this.yieldAlerts.rateLimiting,
                ...newConfig.rateLimiting
            };
        }
        
        logger.info('Yield alert configuration updated', newConfig);
    }

    /**
     * Enable/disable specific yield alert types
     */
    toggleYieldAlertType(alertType, enabled) {
        // This would integrate with a more sophisticated configuration system
        logger.info(`Yield alert type ${alertType} ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Clear yield alert rate limiting (for testing or forced alerts)
     */
    clearYieldRateLimiting() {
        this.yieldAlerts.lastAlerts.clear();
        logger.info('Yield alert rate limiting cleared');
    }

    // ================================
    // YIELD MANAGEMENT BULK OPERATIONS
    // ================================

    /**
     * Send bulk yield notifications to hotel staff
     */
    async sendBulkYieldNotifications(hotelId, alertType, data) {
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) throw new Error('Hotel not found');
            
            // Get all relevant staff for this hotel
            const staff = await User.find({
                $or: [
                    { role: USER_ROLES.ADMIN },
                    { role: USER_ROLES.RECEPTIONIST, hotelId: hotelId }
                ]
            });
            
            const notifications = staff.map(member => ({
                type: alertType,
                userId: member._id,
                channels: this.getChannelsForYieldAlert(alertType, member.role),
                data: {
                    ...data,
                    hotel,
                    recipientRole: member.role
                },
                priority: this.getYieldAlertPriority(alertType)
            }));
            
            const results = await this.sendBulkNotifications(notifications);
            
            logger.info(`Bulk yield notifications sent for ${alertType} to ${staff.length} staff members at ${hotel.name}`);
            
            return {
                success: true,
                alertType,
                hotelId,
                staffNotified: staff.length,
                results
            };
            
        } catch (error) {
            logger.error('Error sending bulk yield notifications:', error);
            throw error;
        }
    }

    /**
     * Send yield alert to multiple hotels
     */
    async sendMultiHotelYieldAlert(hotelIds, alertType, data) {
        try {
            const results = [];
            
            for (const hotelId of hotelIds) {
                try {
                    const result = await this.sendBulkYieldNotifications(hotelId, alertType, {
                        ...data,
                        multiHotelAlert: true
                    });
                    results.push(result);
                } catch (error) {
                    logger.error(`Failed to send yield alert to hotel ${hotelId}:`, error);
                    results.push({
                        success: false,
                        hotelId,
                        error: error.message
                    });
                }
            }
            
            const successCount = results.filter(r => r.success).length;
            logger.info(`Multi-hotel yield alert completed: ${successCount}/${hotelIds.length} hotels notified`);
            
            return {
                success: true,
                alertType,
                totalHotels: hotelIds.length,
                successfulHotels: successCount,
                results
            };
            
        } catch (error) {
            logger.error('Error sending multi-hotel yield alert:', error);
            throw error;
        }
    }

    /**
     * Get appropriate channels for yield alert based on type and role
     */
    getChannelsForYieldAlert(alertType, userRole) {
        const urgentAlerts = [
            'YIELD_DEMAND_SURGE_ALERT',
            'YIELD_OCCUPANCY_ALERT',
            'YIELD_REVENUE_TARGET_MISSED'
        ];
        
        const adminOnlyAlerts = [
            'YIELD_PERFORMANCE_ALERT',
            'YIELD_STRATEGY_EFFECTIVENESS',
            'YIELD_FORECAST_UPDATE'
        ];
        
        // High priority alerts use all channels
        if (urgentAlerts.includes(alertType)) {
            return userRole === USER_ROLES.ADMIN ? ['email', 'sms', 'socket'] : ['socket', 'email'];
        }
        
        // Admin-only alerts
        if (adminOnlyAlerts.includes(alertType)) {
            return userRole === USER_ROLES.ADMIN ? ['email', 'socket'] : [];
        }
        
        // Standard yield alerts
        return ['socket', 'email'];
    }

    /**
     * Get priority for yield alert type
     */
    getYieldAlertPriority(alertType) {
        const highPriorityAlerts = [
            'YIELD_DEMAND_SURGE_ALERT',
            'YIELD_OCCUPANCY_ALERT',
            'YIELD_REVENUE_TARGET_MISSED'
        ];
        
        const mediumPriorityAlerts = [
            'YIELD_PRICE_UPDATE',
            'YIELD_REVENUE_OPTIMIZATION',
            'YIELD_PERFORMANCE_ALERT'
        ];
        
        if (highPriorityAlerts.includes(alertType)) return 'high';
        if (mediumPriorityAlerts.includes(alertType)) return 'medium';
        return 'low';
    }

    // ================================
    // YIELD MANAGEMENT TESTING & DEBUGGING
    // ================================

    /**
     * Test yield alert system (for development/testing)
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
                ...testData
            });
            
            return {
                success: true,
                alertType,
                testData,
                timestamp: new Date()
            };
            
        } catch (error) {
            logger.error('Error testing yield alert:', error);
            return {
                success: false,
                alertType,
                error: error.message
            };
        }
    }

    /**
     * Get yield alert debugging info
     */
    getYieldAlertDebugInfo() {
        return {
            configuration: {
                enabled: this.yieldAlerts.enabled,
                thresholds: this.yieldAlerts.thresholds,
                rateLimiting: this.yieldAlerts.rateLimiting
            },
            runtime: {
                activeRateLimits: this.yieldAlerts.lastAlerts.size,
                lastAlerts: Array.from(this.yieldAlerts.lastAlerts.entries()).map(([key, timestamp]) => ({
                    key,
                    timestamp: new Date(timestamp),
                    minutesAgo: Math.round((Date.now() - timestamp) / (1000 * 60))
                }))
            },
            eventListeners: {
                yieldEventsConfigured: this.getYieldEventListenerCount(),
                totalListeners: this.eventNames().length
            },
            statistics: {
                notificationQueue: this.notificationQueue.length,
                channels: this.channels,
                serviceStatus: this.getServiceStatus()
            }
        };
    }

    // ================================
    // GRACEFUL SHUTDOWN WITH YIELD CLEANUP
    // ================================

    /**
     * Enhanced graceful shutdown including yield management cleanup
     */
    async shutdown() {
        logger.info('Shutting down Notification Service with Yield Management...');
        
        try {
            // Clear yield alert rate limiting
            this.clearYieldRateLimiting();
            
            // Remove all yield event listeners
            const yieldEvents = this.eventNames().filter(event => event.startsWith('yield:'));
            yieldEvents.forEach(event => {
                this.removeAllListeners(event);
            });
            
            // Process remaining notifications in queue
            if (this.notificationQueue.length > 0) {
                logger.info(`Processing ${this.notificationQueue.length} remaining notifications...`);
                
                // Process urgent notifications only
                const urgentNotifications = this.notificationQueue.filter(n => n.priority === 'high');
                for (const notification of urgentNotifications.slice(0, 10)) { // Max 10 urgent
                    try {
                        await this.sendNotification(notification);
                    } catch (error) {
                        logger.error('Error processing urgent notification during shutdown:', error);
                    }
                }
            }
            
            // Clear notification queue
            this.notificationQueue.length = 0;
            
            // Remove all event listeners
            this.removeAllListeners();
            
            logger.info('Notification Service with Yield Management shutdown completed');
            
        } catch (error) {
            logger.error('Error during notification service shutdown:', error);
        }
    }
}

// Export singleton instance
module.exports = new NotificationService();