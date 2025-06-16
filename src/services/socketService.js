const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const { logger } = require('../utils/logger');

class SocketService {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId mapping
        this.userRooms = new Map(); // socketId -> rooms array
        this.adminSockets = new Set(); // Admin socket IDs
        this.receptionistSockets = new Map(); // hotelId -> Set of socketIds
        
        // ================================
        // YIELD MANAGEMENT SPECIFIC MAPS (CONSERVÉ)
        // ================================
        this.pricingSubscribers = new Map(); // hotelId -> Set of socketIds
        this.yieldAdminSockets = new Set(); // Yield-focused admin sockets
        this.demandSubscribers = new Map(); // hotelId -> Set of socketIds
        this.revenueSubscribers = new Set(); // Revenue monitoring sockets
        this.priceAlertSubscribers = new Map(); // userId -> Set of hotelIds for price alerts
        this.customerPriceWatchers = new Map(); // hotelId -> Map(userId -> roomTypes[])
        
        // Yield event tracking (CONSERVÉ)
        this.yieldMetrics = {
            priceUpdatesCount: 0,
            demandAlertsCount: 0,
            revenueOptimizationsCount: 0,
            lastYieldActivity: null
        };

        // ================================
        // LOYALTY PROGRAM MAPS (CONSERVÉ)
        // ================================
        this.loyaltySubscribers = new Set(); // Utilisateurs abonnés aux updates loyalty
        this.loyaltyAdminSockets = new Set(); // Admins surveillant le programme loyalty
        this.tierUpgradeSubscribers = new Map(); // userId -> subscription preferences
        this.pointsExpirySubscribers = new Map(); // userId -> expiry alert preferences
        this.campaignSubscribers = new Map(); // campaignId -> Set of userIds
        this.loyaltyDashboardSockets = new Set(); // Admin dashboard loyalty
        this.userLoyaltyRooms = new Map(); // userId -> loyalty room preferences
        
        // Métriques loyalty temps réel
        this.loyaltyMetrics = {
            totalPointsIssued: 0,
            totalPointsRedeemed: 0,
            totalTierUpgrades: 0,
            totalTransactions: 0,
            activeCampaigns: 0,
            dailyActivity: {
                pointsEarned: 0,
                pointsRedeemed: 0,
                tierUpgrades: 0,
                newMembers: 0,
                redemptions: 0
            },
            lastLoyaltyActivity: null,
            systemHealth: 'operational'
        };

        // Cache pour données loyalty fréquemment accédées
        this.loyaltyCache = new Map();
        this.loyaltyCacheExpiry = 2 * 60 * 1000; // 2 minutes
        
        // Notifications en queue pour traitement batch
        this.loyaltyNotificationQueue = [];
        this.loyaltyBatchProcessing = false;

        // ================================
        // NOUVEAU : QR CODE REAL-TIME MAPS
        // ================================
        this.qrSubscribers = new Map(); // userId -> Set of socketIds for QR notifications
        this.qrAdminSockets = new Set(); // Admin sockets monitoring QR activity
        this.hotelQRSubscribers = new Map(); // hotelId -> Set of socketIds for hotel QR events
        this.qrCheckInSessions = new Map(); // sessionId -> QR check-in process data
        this.activeQRCodes = new Map(); // qrTokenId -> metadata for active codes
        
        // QR Metrics temps réel
        this.qrMetrics = {
            totalGenerated: 0,
            totalScanned: 0,
            totalCheckIns: 0,
            successfulCheckIns: 0,
            failedCheckIns: 0,
            expiredCodes: 0,
            dailyActivity: {
                generated: 0,
                scanned: 0,
                checkIns: 0,
                errors: 0
            },
            lastQRActivity: null,
            systemHealth: 'operational'
        };

        // ================================
        // NOUVEAU : CACHE MONITORING MAPS
        // ================================
        this.cacheSubscribers = new Set(); // Sockets monitoring cache performance
        this.cacheAdminSockets = new Set(); // Admin cache monitoring
        this.hotelCacheSubscribers = new Map(); // hotelId -> Set of socketIds for cache events
        this.performanceMonitors = new Set(); // Performance monitoring sockets
        
        // Cache Metrics temps réel
        this.cacheMetrics = {
            totalRequests: 0,
            totalHits: 0,
            totalMisses: 0,
            totalInvalidations: 0,
            avgResponseTime: 0,
            redisConnectionStatus: 'connected',
            dailyActivity: {
                requests: 0,
                hits: 0,
                misses: 0,
                invalidations: 0,
                errors: 0
            },
            lastCacheActivity: null,
            systemHealth: 'operational'
        };
    }

    /**
     * Initialize Socket.io server
     * @param {Object} server - HTTP server instance
     */
    initialize(server) {
        this.io = socketIo(server, {
            cors: {
                origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : ["http://localhost:4200"],
                methods: ["GET", "POST"],
                credentials: true
            },
            transports: ['websocket', 'polling']
        });

        this.setupMiddleware();
        this.setupEventHandlers();
        this.initializeLoyaltySystem();
        this.initializeQRSystem();
        this.initializeCacheMonitoring();
        
        logger.info('Socket.io server initialized successfully with Yield + Loyalty + QR + Cache support');
        return this.io;
    }

    /**
     * Setup authentication middleware for Socket.io
     */
    setupMiddleware() {
        this.io.use(async (socket, next) => {
            try {
                const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.split(' ')[1];
                
                if (!token) {
                    return next(new Error('Authentication token required'));
                }

                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                const user = await User.findById(decoded.id).select('-password').populate('company');
                
                if (!user) {
                    return next(new Error('User not found'));
                }

                socket.userId = user._id.toString();
                socket.user = user;
                socket.userRole = user.role;
                
                // If receptionist, get their hotel
                if (user.role === 'RECEPTIONIST' && user.hotelId) {
                    socket.hotelId = user.hotelId.toString();
                }

                // Données loyalty
                socket.loyaltyTier = user.loyalty?.tier || 'BRONZE';
                socket.loyaltyPoints = user.loyalty?.currentPoints || 0;
                socket.isLoyaltyMember = !!user.loyalty?.enrolledAt;

                // QR permissions
                socket.canGenerateQR = ['ADMIN', 'RECEPTIONIST'].includes(user.role);
                socket.canMonitorQR = user.role === 'ADMIN';

                // Cache permissions
                socket.canMonitorCache = ['ADMIN'].includes(user.role);

                next();
            } catch (error) {
                logger.error('Socket authentication error:', error);
                next(new Error('Invalid authentication token'));
            }
        });
    }

    /**
     * Setup Socket.io event handlers with Yield + Loyalty + QR + Cache events
     */
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
            
            // ================================
            // STANDARD BOOKING-RELATED EVENTS (CONSERVÉ)
            // ================================
            socket.on('join-booking-room', (bookingId) => this.joinBookingRoom(socket, bookingId));
            socket.on('leave-booking-room', (bookingId) => this.leaveBookingRoom(socket, bookingId));
            socket.on('join-hotel-room', (hotelId) => this.joinHotelRoom(socket, hotelId));
            socket.on('leave-hotel-room', (hotelId) => this.leaveHotelRoom(socket, hotelId));
            socket.on('join-admin-room', () => this.joinAdminRoom(socket));
            
            // Real-time availability requests (CONSERVÉ)
            socket.on('check-availability', (data) => this.handleAvailabilityCheck(socket, data));
            socket.on('service-request', (data) => this.handleServiceRequest(socket, data));
            socket.on('send-message', (data) => this.handleMessage(socket, data));
            socket.on('typing', (data) => this.handleTyping(socket, data));
            
            // ================================
            // YIELD MANAGEMENT EVENTS (CONSERVÉ)
            // ================================
            socket.on('join-pricing-room', (data) => this.joinPricingRoom(socket, data));
            socket.on('leave-pricing-room', (hotelId) => this.leavePricingRoom(socket, hotelId));
            socket.on('subscribe-price-alerts', (data) => this.subscribePriceAlerts(socket, data));
            socket.on('unsubscribe-price-alerts', (data) => this.unsubscribePriceAlerts(socket, data));
            socket.on('join-demand-monitoring', (hotelId) => this.joinDemandMonitoring(socket, hotelId));
            socket.on('leave-demand-monitoring', (hotelId) => this.leaveDemandMonitoring(socket, hotelId));
            socket.on('join-revenue-monitoring', () => this.joinRevenueMonitoring(socket));
            socket.on('leave-revenue-monitoring', () => this.leaveRevenueMonitoring(socket));
            socket.on('join-yield-admin', () => this.joinYieldAdmin(socket));
            socket.on('leave-yield-admin', () => this.leaveYieldAdmin(socket));
            socket.on('watch-hotel-prices', (data) => this.watchHotelPrices(socket, data));
            socket.on('unwatch-hotel-prices', (data) => this.unwatchHotelPrices(socket, data));
            socket.on('trigger-price-update', (data) => this.handleTriggerPriceUpdate(socket, data));
            socket.on('request-yield-analysis', (data) => this.handleYieldAnalysisRequest(socket, data));

            // ================================
            // LOYALTY PROGRAM EVENTS (CONSERVÉ)
            // ================================
            socket.on('join-loyalty-updates', (preferences) => this.joinLoyaltyUpdates(socket, preferences));
            socket.on('leave-loyalty-updates', () => this.leaveLoyaltyUpdates(socket));
            socket.on('subscribe-tier-updates', (preferences) => this.subscribeTierUpdates(socket, preferences));
            socket.on('unsubscribe-tier-updates', () => this.unsubscribeTierUpdates(socket));
            socket.on('subscribe-expiry-alerts', (preferences) => this.subscribeExpiryAlerts(socket, preferences));
            socket.on('unsubscribe-expiry-alerts', () => this.unsubscribeExpiryAlerts(socket));
            socket.on('join-campaign', (campaignId) => this.joinCampaign(socket, campaignId));
            socket.on('leave-campaign', (campaignId) => this.leaveCampaign(socket, campaignId));
            socket.on('subscribe-promotion-alerts', (filters) => this.subscribePromotionAlerts(socket, filters));
            socket.on('join-loyalty-admin', () => this.joinLoyaltyAdmin(socket));
            socket.on('leave-loyalty-admin', () => this.leaveLoyaltyAdmin(socket));
            socket.on('request-loyalty-status', () => this.handleLoyaltyStatusRequest(socket));
            socket.on('trigger-points-calculation', (bookingId) => this.handlePointsCalculationTrigger(socket, bookingId));
            socket.on('request-redemption-options', (criteria) => this.handleRedemptionOptionsRequest(socket, criteria));
            socket.on('set-loyalty-preferences', (preferences) => this.setLoyaltyPreferences(socket, preferences));
            socket.on('request-loyalty-insights', (period) => this.handleLoyaltyInsightsRequest(socket, period));
            socket.on('join-chain-loyalty', (chainId) => this.joinChainLoyalty(socket, chainId));
            socket.on('track-cross-hotel-activity', (hotelIds) => this.trackCrossHotelActivity(socket, hotelIds));

            // ================================
            // NOUVEAU : QR CODE EVENTS
            // ================================
            
            // QR Monitoring & Subscriptions
            socket.on('join-qr-updates', (preferences) => this.joinQRUpdates(socket, preferences));
            socket.on('leave-qr-updates', () => this.leaveQRUpdates(socket));
            socket.on('join-qr-admin', () => this.joinQRAdmin(socket));
            socket.on('leave-qr-admin', () => this.leaveQRAdmin(socket));
            socket.on('subscribe-hotel-qr', (hotelId) => this.subscribeHotelQR(socket, hotelId));
            socket.on('unsubscribe-hotel-qr', (hotelId) => this.unsubscribeHotelQR(socket, hotelId));
            
            // QR Operations
            socket.on('generate-qr-code', (qrData) => this.handleQRGeneration(socket, qrData));
            socket.on('validate-qr-code', (qrData) => this.handleQRValidation(socket, qrData));
            socket.on('start-qr-checkin', (qrData) => this.handleQRCheckInStart(socket, qrData));
            socket.on('complete-qr-checkin', (sessionData) => this.handleQRCheckInComplete(socket, sessionData));
            socket.on('cancel-qr-checkin', (sessionId) => this.handleQRCheckInCancel(socket, sessionId));
            
            // QR Status & Monitoring
            socket.on('request-qr-status', (tokenId) => this.handleQRStatusRequest(socket, tokenId));
            socket.on('request-qr-metrics', () => this.handleQRMetricsRequest(socket));
            socket.on('revoke-qr-code', (tokenId) => this.handleQRRevocation(socket, tokenId));
            
            // QR Bulk Operations
            socket.on('generate-bulk-qr', (bulkData) => this.handleBulkQRGeneration(socket, bulkData));
            socket.on('track-qr-usage', (usageData) => this.handleQRUsageTracking(socket, usageData));

            // ================================
            // NOUVEAU : CACHE MONITORING EVENTS  
            // ================================
            
            // Cache Subscriptions
            socket.on('join-cache-monitoring', () => this.joinCacheMonitoring(socket));
            socket.on('leave-cache-monitoring', () => this.leaveCacheMonitoring(socket));
            socket.on('join-cache-admin', () => this.joinCacheAdmin(socket));
            socket.on('leave-cache-admin', () => this.leaveCacheAdmin(socket));
            socket.on('subscribe-hotel-cache', (hotelId) => this.subscribeHotelCache(socket, hotelId));
            socket.on('unsubscribe-hotel-cache', (hotelId) => this.unsubscribeHotelCache(socket, hotelId));
            
            // Cache Operations
            socket.on('invalidate-cache', (cacheData) => this.handleCacheInvalidation(socket, cacheData));
            socket.on('warm-cache', (warmData) => this.handleCacheWarming(socket, warmData));
            socket.on('request-cache-stats', () => this.handleCacheStatsRequest(socket));
            socket.on('request-performance-metrics', () => this.handlePerformanceMetricsRequest(socket));
            
            // Cache Health Monitoring
            socket.on('monitor-redis-health', () => this.handleRedisHealthMonitoring(socket));
            socket.on('request-cache-analytics', (period) => this.handleCacheAnalyticsRequest(socket, period));
            
            // Disconnect handler
            socket.on('disconnect', () => this.handleDisconnection(socket));
        });
    }

    /**
     * Handle new socket connection with yield + loyalty + QR + cache setup
     * @param {Object} socket - Socket instance
     */
    handleConnection(socket) {
        const { userId, user, userRole, hotelId, loyaltyTier, loyaltyPoints, isLoyaltyMember, canGenerateQR, canMonitorQR, canMonitorCache } = socket;
        
        // Store connection mapping
        this.connectedUsers.set(userId, socket.id);
        this.userRooms.set(socket.id, []);

        // Join role-specific rooms
        switch (userRole) {
            case 'ADMIN':
                this.adminSockets.add(socket.id);
                socket.join('admins');
                
                // Auto-join yield admin features
                this.yieldAdminSockets.add(socket.id);
                socket.join('yield-admin');
                socket.join('revenue-monitoring');
                
                // Auto-join loyalty admin features
                this.loyaltyAdminSockets.add(socket.id);
                socket.join('loyalty-admin');
                socket.join('loyalty-dashboard');
                
                // Auto-join QR admin features
                this.qrAdminSockets.add(socket.id);
                socket.join('qr-admin');
                socket.join('qr-monitoring');
                
                // Auto-join cache admin features
                this.cacheAdminSockets.add(socket.id);
                socket.join('cache-admin');
                socket.join('cache-monitoring');
                break;
                
            case 'RECEPTIONIST':
                if (hotelId) {
                    if (!this.receptionistSockets.has(hotelId)) {
                        this.receptionistSockets.set(hotelId, new Set());
                    }
                    this.receptionistSockets.get(hotelId).add(socket.id);
                    socket.join(`hotel-${hotelId}`);
                    socket.join('receptionists');
                    
                    // Auto-join pricing room for their hotel
                    socket.join(`pricing-${hotelId}`);
                    if (!this.pricingSubscribers.has(hotelId)) {
                        this.pricingSubscribers.set(hotelId, new Set());
                    }
                    this.pricingSubscribers.get(hotelId).add(socket.id);
                    
                    // Auto-join loyalty notifications pour leur hôtel
                    socket.join(`loyalty-hotel-${hotelId}`);
                    
                    // Auto-join QR notifications pour leur hôtel
                    socket.join(`qr-hotel-${hotelId}`);
                    if (!this.hotelQRSubscribers.has(hotelId)) {
                        this.hotelQRSubscribers.set(hotelId, new Set());
                    }
                    this.hotelQRSubscribers.get(hotelId).add(socket.id);
                    
                    // Auto-join cache notifications pour leur hôtel
                    socket.join(`cache-hotel-${hotelId}`);
                    if (!this.hotelCacheSubscribers.has(hotelId)) {
                        this.hotelCacheSubscribers.set(hotelId, new Set());
                    }
                    this.hotelCacheSubscribers.get(hotelId).add(socket.id);
                }
                break;
                
            case 'CLIENT':
                socket.join('clients');
                socket.join(`user-${userId}`);
                
                // Auto-join loyalty si membre
                if (isLoyaltyMember) {
                    socket.join('loyalty-members');
                    socket.join(`loyalty-tier-${loyaltyTier}`);
                    this.loyaltySubscribers.add(socket.id);
                    this.joinTierSpecificRoom(socket, loyaltyTier);
                }
                
                // Auto-join QR notifications personnelles
                socket.join(`qr-user-${userId}`);
                if (!this.qrSubscribers.has(userId)) {
                    this.qrSubscribers.set(userId, new Set());
                }
                this.qrSubscribers.get(userId).add(socket.id);
                break;
        }

        // Setup loyalty context si membre
        if (isLoyaltyMember) {
            this.setupLoyaltyContext(socket, user);
        }

        // Setup QR context
        this.setupQRContext(socket, user);

        // Setup cache context pour admins
        if (canMonitorCache) {
            this.setupCacheContext(socket, user);
        }

        // Send welcome message with all capabilities
        socket.emit('connected', {
            message: 'Connected to hotel management system with full real-time capabilities',
            userId,
            role: userRole,
            features: {
                yieldFeatures: {
                    pricingAlerts: userRole === 'CLIENT',
                    demandAnalysis: ['ADMIN', 'RECEPTIONIST'].includes(userRole),
                    revenueMonitoring: userRole === 'ADMIN',
                    yieldDashboard: userRole === 'ADMIN'
                },
                loyaltyFeatures: {
                    pointsTracking: isLoyaltyMember,
                    tierProgression: isLoyaltyMember,
                    redemptionAlerts: isLoyaltyMember,
                    campaignNotifications: isLoyaltyMember,
                    adminDashboard: userRole === 'ADMIN',
                    crossHotelTracking: isLoyaltyMember && loyaltyTier !== 'BRONZE'
                },
                qrFeatures: {
                    generation: canGenerateQR,
                    validation: canGenerateQR,
                    monitoring: canMonitorQR,
                    checkinProcess: true,
                    notifications: true
                },
                cacheFeatures: {
                    monitoring: canMonitorCache,
                    analytics: canMonitorCache,
                    invalidation: canMonitorCache,
                    performanceTracking: canMonitorCache
                }
            },
            loyaltyStatus: isLoyaltyMember ? {
                tier: loyaltyTier,
                points: loyaltyPoints,
                tierDisplay: this.getTierDisplayName(loyaltyTier),
                nextTierThreshold: this.getNextTierThreshold(loyaltyTier)
            } : null,
            qrCapabilities: {
                canGenerate: canGenerateQR,
                canMonitor: canMonitorQR,
                supportedTypes: ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS', 'PAYMENT', 'MENU']
            },
            cacheCapabilities: {
                canMonitor: canMonitorCache,
                realTimeStats: canMonitorCache,
                performanceAlerts: canMonitorCache
            },
            timestamp: new Date()
        });

        logger.info(`User ${userId} (${userRole}) connected via socket ${socket.id} with full real-time features`);
    }

    /**
     * Handle socket disconnection with full cleanup
     * @param {Object} socket - Socket instance
     */
    handleDisconnection(socket) {
        const { userId, userRole, hotelId } = socket;

        // Clean up standard mappings
        this.connectedUsers.delete(userId);
        this.userRooms.delete(socket.id);
        this.adminSockets.delete(socket.id);

        if (hotelId && this.receptionistSockets.has(hotelId)) {
            this.receptionistSockets.get(hotelId).delete(socket.id);
            if (this.receptionistSockets.get(hotelId).size === 0) {
                this.receptionistSockets.delete(hotelId);
            }
        }

        // Yield management cleanup
        this.yieldAdminSockets.delete(socket.id);
        this.revenueSubscribers.delete(socket.id);
        
        for (const [hotelId, subscribers] of this.pricingSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.pricingSubscribers.delete(hotelId);
            }
        }
        
        for (const [hotelId, subscribers] of this.demandSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.demandSubscribers.delete(hotelId);
            }
        }
        
        if (this.priceAlertSubscribers.has(userId)) {
            this.priceAlertSubscribers.delete(userId);
        }
        
        for (const [hotelId, watchers] of this.customerPriceWatchers) {
            watchers.delete(userId);
            if (watchers.size === 0) {
                this.customerPriceWatchers.delete(hotelId);
            }
        }

        // Loyalty cleanup
        this.loyaltySubscribers.delete(socket.id);
        this.loyaltyAdminSockets.delete(socket.id);
        this.tierUpgradeSubscribers.delete(userId);
        this.pointsExpirySubscribers.delete(userId);
        
        for (const [campaignId, subscribers] of this.campaignSubscribers) {
            subscribers.delete(userId);
            if (subscribers.size === 0) {
                this.campaignSubscribers.delete(campaignId);
            }
        }
        
        this.userLoyaltyRooms.delete(userId);

        // ================================
        // NOUVEAU : QR CLEANUP
        // ================================
        this.qrAdminSockets.delete(socket.id);
        
        if (this.qrSubscribers.has(userId)) {
            this.qrSubscribers.get(userId).delete(socket.id);
            if (this.qrSubscribers.get(userId).size === 0) {
                this.qrSubscribers.delete(userId);
            }
        }
        
        for (const [hotelId, subscribers] of this.hotelQRSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.hotelQRSubscribers.delete(hotelId);
            }
        }

        // ================================
        // NOUVEAU : CACHE CLEANUP
        // ================================
        this.cacheSubscribers.delete(socket.id);
        this.cacheAdminSockets.delete(socket.id);
        this.performanceMonitors.delete(socket.id);
        
        for (const [hotelId, subscribers] of this.hotelCacheSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.hotelCacheSubscribers.delete(hotelId);
            }
        }

        logger.info(`User ${userId} (${userRole}) disconnected from socket ${socket.id} - full cleanup completed`);
    }

    // ================================
    // EXISTING STANDARD METHODS (CONSERVÉ INTÉGRALEMENT)
    // ================================

    joinBookingRoom(socket, bookingId) {
        const roomName = `booking-${bookingId}`;
        socket.join(roomName);
        
        const rooms = this.userRooms.get(socket.id) || [];
        rooms.push(roomName);
        this.userRooms.set(socket.id, rooms);
        
        socket.emit('joined-room', { room: roomName, type: 'booking' });
        logger.info(`Socket ${socket.id} joined booking room: ${roomName}`);
    }

    leaveBookingRoom(socket, bookingId) {
        const roomName = `booking-${bookingId}`;
        socket.leave(roomName);
        
        const rooms = this.userRooms.get(socket.id) || [];
        const updatedRooms = rooms.filter(room => room !== roomName);
        this.userRooms.set(socket.id, updatedRooms);
        
        socket.emit('left-room', { room: roomName, type: 'booking' });
    }

    joinHotelRoom(socket, hotelId) {
        const roomName = `hotel-${hotelId}`;
        socket.join(roomName);
        
        const rooms = this.userRooms.get(socket.id) || [];
        rooms.push(roomName);
        this.userRooms.set(socket.id, rooms);
        
        socket.emit('joined-room', { room: roomName, type: 'hotel' });
        logger.info(`Socket ${socket.id} joined hotel room: ${roomName}`);
    }

    leaveHotelRoom(socket, hotelId) {
        const roomName = `hotel-${hotelId}`;
        socket.leave(roomName);
        
        const rooms = this.userRooms.get(socket.id) || [];
        const updatedRooms = rooms.filter(room => room !== roomName);
        this.userRooms.set(socket.id, updatedRooms);
        
        socket.emit('left-room', { room: roomName, type: 'hotel' });
    }

    joinAdminRoom(socket) {
        if (socket.userRole !== 'ADMIN') {
            socket.emit('error', { message: 'Unauthorized: Admin access required' });
            return;
        }
        
        socket.join('admin-notifications');
        socket.emit('joined-room', { room: 'admin-notifications', type: 'admin' });
    }

    async handleAvailabilityCheck(socket, data) {
        try {
            const { hotelId, checkIn, checkOut, roomType } = data;
            
            socket.emit('availability-result', {
                hotelId,
                checkIn,
                checkOut,
                roomType,
                available: true,
                timestamp: new Date()
            });
            
        } catch (error) {
            socket.emit('availability-error', { 
                message: 'Error checking availability',
                error: error.message 
            });
        }
    }

    handleServiceRequest(socket, data) {
        const { hotelId, roomNumber, serviceType, message, priority = 'NORMAL' } = data;
        
        const serviceRequest = {
            id: `req_${Date.now()}`,
            userId: socket.userId,
            hotelId,
            roomNumber,
            serviceType,
            message,
            priority,
            status: 'PENDING',
            timestamp: new Date()
        };

        this.io.to(`hotel-${hotelId}`).emit('new-service-request', serviceRequest);
        this.io.to('admins').emit('new-service-request', serviceRequest);
        socket.emit('service-request-sent', {
        message: 'Service request sent successfully',
        requestId: serviceRequest.id
    });

    logger.info(`Service request from user ${socket.userId} in hotel ${hotelId}`);
}

handleMessage(socket, data) {
    const { recipientId, message, roomId, messageType = 'text' } = data;
    
    const messageData = {
        id: `msg_${Date.now()}`,
        senderId: socket.userId,
        senderName: socket.user.firstName + ' ' + socket.user.lastName,
        recipientId,
        message,
        messageType,
        timestamp: new Date(),
        roomId
    };

    if (recipientId) {
        const recipientSocketId = this.connectedUsers.get(recipientId);
        if (recipientSocketId) {
            this.io.to(recipientSocketId).emit('new-message', messageData);
        }
    }

    if (roomId) {
        socket.to(roomId).emit('new-message', messageData);
    }

    socket.emit('message-sent', { messageId: messageData.id });
}

handleTyping(socket, data) {
    const { recipientId, roomId, isTyping } = data;
    
    const typingData = {
        userId: socket.userId,
        userName: socket.user.firstName + ' ' + socket.user.lastName,
        isTyping,
        timestamp: new Date()
    };

    if (recipientId) {
        const recipientSocketId = this.connectedUsers.get(recipientId);
        if (recipientSocketId) {
            this.io.to(recipientSocketId).emit('user-typing', typingData);
        }
    }

    if (roomId) {
        socket.to(roomId).emit('user-typing', typingData);
    }
}

// ================================
// YIELD MANAGEMENT METHODS (CONSERVÉ INTÉGRALEMENT)
// ================================

joinPricingRoom(socket, data) {
    const { hotelId, roomTypes = [] } = data;
    
    if (!hotelId) {
        socket.emit('error', { message: 'Hotel ID required for pricing room' });
        return;
    }

    if (socket.userRole === 'CLIENT' || 
        (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) ||
        socket.userRole === 'ADMIN') {
        
        const roomName = `pricing-${hotelId}`;
        socket.join(roomName);
        
        if (!this.pricingSubscribers.has(hotelId)) {
            this.pricingSubscribers.set(hotelId, new Set());
        }
        this.pricingSubscribers.get(hotelId).add(socket.id);
        
        const rooms = this.userRooms.get(socket.id) || [];
        rooms.push(roomName);
        this.userRooms.set(socket.id, rooms);
        
        socket.emit('joined-pricing-room', { 
            hotelId,
            roomTypes,
            message: 'Subscribed to real-time pricing updates',
            timestamp: new Date()
        });
        
        logger.info(`Socket ${socket.id} joined pricing room for hotel ${hotelId}`);
    } else {
        socket.emit('error', { message: 'Unauthorized: Cannot access pricing for this hotel' });
    }
}

leavePricingRoom(socket, hotelId) {
    const roomName = `pricing-${hotelId}`;
    socket.leave(roomName);
    
    if (this.pricingSubscribers.has(hotelId)) {
        this.pricingSubscribers.get(hotelId).delete(socket.id);
        if (this.pricingSubscribers.get(hotelId).size === 0) {
            this.pricingSubscribers.delete(hotelId);
        }
    }
    
    const rooms = this.userRooms.get(socket.id) || [];
    const updatedRooms = rooms.filter(room => room !== roomName);
    this.userRooms.set(socket.id, updatedRooms);
    
    socket.emit('left-pricing-room', { hotelId });
}

broadcastPriceUpdate(hotelId, priceData) {
    if (!this.io) return;

    const priceUpdate = {
        type: 'price_update',
        hotelId,
        timestamp: new Date(),
        ...priceData
    };

    this.io.to(`pricing-${hotelId}`).emit('price-update', priceUpdate);
    this.io.to(`hotel-${hotelId}`).emit('hotel-price-update', priceUpdate);
    
    this.yieldMetrics.priceUpdatesCount++;
    this.yieldMetrics.lastYieldActivity = new Date();
    
    logger.info(`Price update broadcast for hotel ${hotelId}: ${JSON.stringify(priceData)}`);
}

subscribePriceAlerts(socket, data) {
    const { hotelIds = [], roomTypes = [], alertThreshold = 10 } = data;
    const userId = socket.userId;
    
    if (!this.priceAlertSubscribers.has(userId)) {
        this.priceAlertSubscribers.set(userId, new Set());
    }
    
    hotelIds.forEach(hotelId => {
        this.priceAlertSubscribers.get(userId).add(hotelId);
        
        if (!this.customerPriceWatchers.has(hotelId)) {
            this.customerPriceWatchers.set(hotelId, new Map());
        }
        this.customerPriceWatchers.get(hotelId).set(userId, {
            roomTypes,
            alertThreshold,
            subscribedAt: new Date()
        });
    });
    
    socket.emit('price-alerts-subscribed', {
        hotelIds,
        roomTypes,
        alertThreshold,
        message: 'Price alert subscriptions activated'
    });
    
    logger.info(`User ${userId} subscribed to price alerts for hotels: ${hotelIds.join(', ')}`);
}

unsubscribePriceAlerts(socket, data) {
    const { hotelIds = [] } = data;
    const userId = socket.userId;
    
    if (this.priceAlertSubscribers.has(userId)) {
        hotelIds.forEach(hotelId => {
            this.priceAlertSubscribers.get(userId).delete(hotelId);
            
            if (this.customerPriceWatchers.has(hotelId)) {
                this.customerPriceWatchers.get(hotelId).delete(userId);
            }
        });
    }
    
    socket.emit('price-alerts-unsubscribed', { hotelIds });
}

sendPriceAlert(userId, priceAlert) {
    if (!this.io) return;

    const socketId = this.connectedUsers.get(userId);
    if (!socketId) {
        logger.warn(`User ${userId} not connected for price alert`);
        return false;
    }

    const alert = {
        type: 'price_alert',
        userId,
        timestamp: new Date(),
        ...priceAlert
    };

    this.io.to(socketId).emit('price-alert', alert);
    logger.info(`Price alert sent to user ${userId}: ${priceAlert.alertType}`);
    return true;
}

joinDemandMonitoring(socket, hotelId) {
    if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
        socket.emit('error', { message: 'Unauthorized: Demand monitoring access denied' });
        return;
    }

    if (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) {
        socket.emit('error', { message: 'Unauthorized: Can only monitor demand for your hotel' });
        return;
    }

    const roomName = `demand-${hotelId}`;
    socket.join(roomName);
    
    if (!this.demandSubscribers.has(hotelId)) {
        this.demandSubscribers.set(hotelId, new Set());
    }
    this.demandSubscribers.get(hotelId).add(socket.id);
    
    socket.emit('joined-demand-monitoring', { 
        hotelId,
        message: 'Subscribed to demand analysis updates'
    });
    
    logger.info(`Socket ${socket.id} joined demand monitoring for hotel ${hotelId}`);
}

leaveDemandMonitoring(socket, hotelId) {
    const roomName = `demand-${hotelId}`;
    socket.leave(roomName);
    
    if (this.demandSubscribers.has(hotelId)) {
        this.demandSubscribers.get(hotelId).delete(socket.id);
        if (this.demandSubscribers.get(hotelId).size === 0) {
            this.demandSubscribers.delete(hotelId);
        }
    }
    
    socket.emit('left-demand-monitoring', { hotelId });
}

sendDemandSurgeAlert(hotelId, demandData) {
    if (!this.io) return;

    const alert = {
        type: 'demand_surge',
        hotelId,
        severity: demandData.level === 'VERY_HIGH' ? 'critical' : 'warning',
        timestamp: new Date(),
        ...demandData
    };

    this.io.to(`demand-${hotelId}`).emit('demand-surge-alert', alert);
    this.io.to(`hotel-${hotelId}`).emit('demand-surge-alert', alert);
    this.io.to('yield-admin').emit('demand-surge-alert', alert);
    
    this.yieldMetrics.demandAlertsCount++;
    this.yieldMetrics.lastYieldActivity = new Date();
    
    logger.info(`Demand surge alert sent for hotel ${hotelId}: ${demandData.level}`);
}

broadcastDemandAnalysis(hotelId, analysisData) {
    if (!this.io) return;

    const update = {
        type: 'demand_analysis',
        hotelId,
        timestamp: new Date(),
        ...analysisData
    };

    this.io.to(`demand-${hotelId}`).emit('demand-analysis-update', update);
    logger.info(`Demand analysis update broadcast for hotel ${hotelId}`);
}

joinRevenueMonitoring(socket) {
    if (socket.userRole !== 'ADMIN') {
        socket.emit('error', { message: 'Unauthorized: Revenue monitoring requires admin access' });
        return;
    }

    socket.join('revenue-monitoring');
    this.revenueSubscribers.add(socket.id);
    
    socket.emit('joined-revenue-monitoring', {
        message: 'Subscribed to revenue optimization updates'
    });
    
    logger.info(`Admin ${socket.userId} joined revenue monitoring`);
}

leaveRevenueMonitoring(socket) {
    socket.leave('revenue-monitoring');
    this.revenueSubscribers.delete(socket.id);
    
    socket.emit('left-revenue-monitoring');
}

broadcastRevenueOptimization(hotelId, optimization) {
    if (!this.io) return;

    const update = {
        type: 'revenue_optimization',
        hotelId,
        timestamp: new Date(),
        ...optimization
    };

    this.io.to('revenue-monitoring').emit('revenue-optimization', update);
    this.io.to(`hotel-${hotelId}`).emit('revenue-optimization', update);
    
    this.yieldMetrics.revenueOptimizationsCount++;
    this.yieldMetrics.lastYieldActivity = new Date();
    
    logger.info(`Revenue optimization broadcast for hotel ${hotelId}: ${optimization.optimizationType}`);
}

sendRevenueGoalUpdate(hotelId, goals) {
    if (!this.io) return;

    const update = {
        type: 'revenue_goals',
        hotelId,
        timestamp: new Date(),
        ...goals
    };

    this.io.to(`hotel-${hotelId}`).emit('revenue-goal-update', update);
    this.io.to('revenue-monitoring').emit('revenue-goal-update', update);
    
    logger.info(`Revenue goal update sent for hotel ${hotelId}`);
}

joinYieldAdmin(socket) {
    if (socket.userRole !== 'ADMIN') {
        socket.emit('error', { message: 'Unauthorized: Yield admin requires admin access' });
        return;
    }

    socket.join('yield-admin');
    this.yieldAdminSockets.add(socket.id);
    
    socket.emit('joined-yield-admin', {
        message: 'Connected to yield management admin dashboard',
        features: [
            'Real-time pricing control',
            'Demand surge monitoring',
            'Revenue optimization tracking',
            'Yield performance analytics'
        ]
    });
    
    logger.info(`Admin ${socket.userId} joined yield admin dashboard`);
}

leaveYieldAdmin(socket) {
    socket.leave('yield-admin');
    this.yieldAdminSockets.delete(socket.id);
    
    socket.emit('left-yield-admin');
}

sendYieldDashboardUpdate(yieldData) {
    if (!this.io) return;

    const update = {
        type: 'yield_dashboard',
        timestamp: new Date(),
        ...yieldData
    };

    this.io.to('yield-admin').emit('yield-dashboard-update', update);
    logger.info('Yield dashboard update sent to all yield admins');
}

sendYieldPerformanceUpdate(metrics) {
    if (!this.io) return;

    const update = {
        type: 'yield_performance',
        timestamp: new Date(),
        metrics: {
            ...metrics,
            systemMetrics: this.yieldMetrics
        }
    };

    this.io.to('yield-admin').emit('yield-performance-update', update);
    logger.info('Yield performance update broadcast to yield admins');
}

watchHotelPrices(socket, data) {
    const { hotelId, roomTypes = [], checkIn, checkOut, maxPrice } = data;
    const userId = socket.userId;

    if (socket.userRole !== 'CLIENT') {
        socket.emit('error', { message: 'Price watching is only available for customers' });
        return;
    }

    if (!this.customerPriceWatchers.has(hotelId)) {
        this.customerPriceWatchers.set(hotelId, new Map());
    }

    this.customerPriceWatchers.get(hotelId).set(userId, {
        roomTypes,
        checkIn: new Date(checkIn),
        checkOut: new Date(checkOut),
        maxPrice,
        watchStarted: new Date(),
        alertsReceived: 0
    });

    socket.emit('price-watching-started', {
        hotelId,
        roomTypes,
        checkIn,
        checkOut,
        maxPrice,
        message: 'You will receive alerts when prices drop below your threshold'
    });

    logger.info(`User ${userId} started watching prices for hotel ${hotelId}`);
}

unwatchHotelPrices(socket, data) {
    const { hotelId } = data;
    const userId = socket.userId;

    if (this.customerPriceWatchers.has(hotelId)) {
        this.customerPriceWatchers.get(hotelId).delete(userId);
        if (this.customerPriceWatchers.get(hotelId).size === 0) {
            this.customerPriceWatchers.delete(hotelId);
        }
    }

    socket.emit('price-watching-stopped', { hotelId });
    logger.info(`User ${userId} stopped watching prices for hotel ${hotelId}`);
}

handleTriggerPriceUpdate(socket, data) {
    if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
        socket.emit('error', { message: 'Unauthorized: Cannot trigger price updates' });
        return;
    }

    const { hotelId, roomTypes, strategy, reason } = data;
    
    if (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) {
        socket.emit('error', { message: 'Unauthorized: Can only trigger updates for your hotel' });
        return;
    }

    socket.emit('price-update-triggered', {
        hotelId,
        roomTypes,
        strategy,
        reason,
        triggeredBy: socket.userId,
        timestamp: new Date(),
        status: 'processing'
    });

    this.io.to('yield-admin').emit('price-update-manually-triggered', {
        hotelId,
        roomTypes,
        strategy,
        triggeredBy: socket.userId,
        userRole: socket.userRole,
        timestamp: new Date()
    });

    logger.info(`Price update triggered by ${socket.userRole} ${socket.userId} for hotel ${hotelId}`);
}

handleYieldAnalysisRequest(socket, data) {
    if (socket.userRole !== 'ADMIN') {
        socket.emit('error', { message: 'Unauthorized: Yield analysis requires admin access' });
        return;
    }

    const { analysisType, hotelId, dateRange, parameters } = data;

    socket.emit('yield-analysis-started', {
        analysisType,
        hotelId,
        dateRange,
        parameters,
        requestedBy: socket.userId,
        timestamp: new Date(),
        estimatedDuration: '2-5 minutes'
    });

    socket.to('yield-admin').emit('yield-analysis-requested', {
        analysisType,
        hotelId,
        requestedBy: socket.userId,
        timestamp: new Date()
    });

    logger.info(`Yield analysis (${analysisType}) requested by admin ${socket.userId} for hotel ${hotelId || 'ALL'}`);
}

// ================================
// LOYALTY METHODS (CONSERVÉ INTÉGRALEMENT)
// ================================

initializeLoyaltySystem() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
        this.resetDailyLoyaltyMetrics();
        setInterval(() => this.resetDailyLoyaltyMetrics(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    
    this.startLoyaltyBatchProcessing();
    logger.info('Loyalty system initialized with daily metrics reset and batch processing');
}

async setupLoyaltyContext(socket, user) {
    try {
        const activeAlerts = await this.getActiveLoyaltyAlerts(user._id);
        this.setupTierSpecificSubscriptions(socket, user.loyalty.tier);
        
        socket.emit('loyalty-context-ready', {
            tier: user.loyalty.tier,
            points: user.loyalty.currentPoints,
            lifetimePoints: user.loyalty.lifetimePoints,
            activeAlerts,
            features: this.getLoyaltyFeatures(user.loyalty.tier),
            nextTierThreshold: this.getNextTierThreshold(user.loyalty.tier),
            memberSince: user.loyalty.enrolledAt
        });
        
    } catch (error) {
        logger.error('Error setting up loyalty context:', error);
    }
}

joinLoyaltyUpdates(socket, preferences = {}) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    this.loyaltySubscribers.add(socket.id);
    socket.join('loyalty-updates');
    
    this.userLoyaltyRooms.set(socket.userId, {
        notifications: preferences.notifications || ['points', 'tier', 'expiry'],
        realTimeUpdates: preferences.realTimeUpdates !== false,
        emailSync: preferences.emailSync || false,
        smsAlerts: preferences.smsAlerts || false
    });

    socket.emit('joined-loyalty-updates', {
        message: 'Subscribed to loyalty program updates',
        preferences,
        tier: socket.loyaltyTier,
        features: this.getLoyaltyFeatures(socket.loyaltyTier)
    });

    logger.info(`User ${socket.userId} joined loyalty updates with preferences`);
}

leaveLoyaltyUpdates(socket) {
    this.loyaltySubscribers.delete(socket.id);
    socket.leave('loyalty-updates');
    this.userLoyaltyRooms.delete(socket.userId);
    
    socket.emit('left-loyalty-updates');
}

subscribeTierUpdates(socket, preferences = {}) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const userId = socket.userId;
    this.tierUpgradeSubscribers.set(userId, {
        realTimeNotifications: preferences.realTimeNotifications !== false,
        progressAlerts: preferences.progressAlerts || [75, 90, 95],
        achievementCelebration: preferences.achievementCelebration !== false,
        nextTierInsights: preferences.nextTierInsights !== false,
        subscribedAt: new Date()
    });

    socket.join('tier-updates');
    socket.emit('tier-updates-subscribed', {
        currentTier: socket.loyaltyTier,
        preferences,
        nextTier: this.getNextTier(socket.loyaltyTier),
        progressTracking: true
    });

    logger.info(`User ${userId} subscribed to tier updates`);
}

unsubscribeTierUpdates(socket) {
    this.tierUpgradeSubscribers.delete(socket.userId);
    socket.leave('tier-updates');
    
    socket.emit('tier-updates-unsubscribed');
}

subscribeExpiryAlerts(socket, preferences = {}) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const userId = socket.userId;
    this.pointsExpirySubscribers.set(userId, {
        warningDays: preferences.warningDays || [90, 30, 7],
        minimumPoints: preferences.minimumPoints || 100,
        urgentThreshold: preferences.urgentThreshold || 7,
        autoRedemptionSuggestions: preferences.autoRedemptionSuggestions !== false,
        subscribedAt: new Date()
    });

    socket.join('expiry-alerts');
    socket.emit('expiry-alerts-subscribed', {
        preferences,
        currentPoints: socket.loyaltyPoints,
        message: 'Alerts activées pour expiration des points'
    });

    this.checkImmediateExpiryAlert(userId);

    logger.info(`User ${userId} subscribed to expiry alerts`);
}

unsubscribeExpiryAlerts(socket) {
    this.pointsExpirySubscribers.delete(socket.userId);
    socket.leave('expiry-alerts');
    
    socket.emit('expiry-alerts-unsubscribed');
}

joinCampaign(socket, campaignId) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required for campaigns' });
        return;
    }

    const userId = socket.userId;
    const roomName = `campaign-${campaignId}`;
    
    socket.join(roomName);
    
    if (!this.campaignSubscribers.has(campaignId)) {
        this.campaignSubscribers.set(campaignId, new Set());
    }
    this.campaignSubscribers.get(campaignId).add(userId);

    socket.emit('campaign-joined', {
        campaignId,
        tier: socket.loyaltyTier,
        eligibility: this.checkCampaignEligibility(socket.loyaltyTier),
        message: 'Subscribed to campaign updates'
    });

    logger.info(`User ${userId} joined campaign ${campaignId}`);
}

leaveCampaign(socket, campaignId) {
    const userId = socket.userId;
    const roomName = `campaign-${campaignId}`;
    
    socket.leave(roomName);
    
    if (this.campaignSubscribers.has(campaignId)) {
        this.campaignSubscribers.get(campaignId).delete(userId);
        if (this.campaignSubscribers.get(campaignId).size === 0) {
            this.campaignSubscribers.delete(campaignId);
        }
    }

    socket.emit('campaign-left', { campaignId });
}

subscribePromotionAlerts(socket, filters = {}) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const userId = socket.userId;
    socket.join('promotion-alerts');
    
    this.setLoyaltyCache(`promotion_filters_${userId}`, {
        tierRestrictions: filters.tierRestrictions || [],
        hotelPreferences: filters.hotelPreferences || [],
        notificationTypes: filters.notificationTypes || ['bonus', 'multiplier', 'special'],
        maxFrequency: filters.maxFrequency || 'daily'
    });

    socket.emit('promotion-alerts-subscribed', {
        filters,
        tier: socket.loyaltyTier,
        message: 'Subscribed to targeted promotion alerts'
    });

    logger.info(`User ${userId} subscribed to promotion alerts with filters`);
}

joinLoyaltyAdmin(socket) {
    if (socket.userRole !== 'ADMIN') {
        socket.emit('error', { message: 'Admin access required for loyalty dashboard' });
        return;
    }

    this.loyaltyAdminSockets.add(socket.id);
    socket.join('loyalty-admin');
    socket.join('loyalty-dashboard');

    this.sendLoyaltyAdminDashboard(socket);

    socket.emit('loyalty-admin-joined', {
        message: 'Connected to loyalty program admin dashboard',
        features: [
            'Real-time member activity',
            'Tier distribution monitoring', 
            'Points flow analytics',
            'Campaign performance tracking',
            'Expiry management',
            'System health monitoring'
        ],
        metrics: this.loyaltyMetrics
    });

    logger.info(`Admin ${socket.userId} joined loyalty admin dashboard`);
}

leaveLoyaltyAdmin(socket) {
    this.loyaltyAdminSockets.delete(socket.id);
    socket.leave('loyalty-admin');
    socket.leave('loyalty-dashboard');
    
    socket.emit('loyalty-admin-left');
}

handleLoyaltyStatusRequest(socket) {
    if (!socket.isLoyaltyMember) {
        socket.emit('loyalty-status-error', { message: 'Not a loyalty member' });
        return;
    }

    const userId = socket.userId;
    const cacheKey = `loyalty_status_${userId}`;
    let status = this.getLoyaltyCache(cacheKey);

    if (!status) {
        socket.emit('loyalty-status-fetching', {
            message: 'Fetching latest loyalty status...'
        });
        
        setTimeout(() => {
            status = {
                tier: socket.loyaltyTier,
                points: socket.loyaltyPoints,
                lastActivity: new Date(),
                todayActivity: this.getTodayLoyaltyActivity(userId),
                alerts: this.getActiveLoyaltyAlerts(userId)
            };
            
            this.setLoyaltyCache(cacheKey, status);
            socket.emit('loyalty-status-updated', status);
        }, 500);
    } else {
        socket.emit('loyalty-status-updated', status);
    }
}

handlePointsCalculationTrigger(socket, bookingId) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    socket.emit('points-calculation-started', {
        bookingId,
        estimatedCompletion: '10-30 seconds',
        tier: socket.loyaltyTier,
        multiplier: this.getTierMultiplier(socket.loyaltyTier)
    });

    this.io.to('loyalty-admin').emit('manual-points-calculation', {
        userId: socket.userId,
        bookingId,
        tier: socket.loyaltyTier,
        triggeredAt: new Date()
    });

    logger.info(`Points calculation triggered by user ${socket.userId} for booking ${bookingId}`);
}

handleRedemptionOptionsRequest(socket, criteria = {}) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const options = this.calculateRedemptionOptions(socket.loyaltyPoints, socket.loyaltyTier, criteria);
    
    socket.emit('redemption-options-updated', {
        currentPoints: socket.loyaltyPoints,
        tier: socket.loyaltyTier,
        options,
        criteria,
        recommendations: this.getRedemptionRecommendations(socket.loyaltyPoints, socket.loyaltyTier),
        timestamp: new Date()
    });
}

setLoyaltyPreferences(socket, preferences) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const userId = socket.userId;
    this.setLoyaltyCache(`preferences_${userId}`, {
        ...preferences,
        updatedAt: new Date()
    });

    this.updateLoyaltySubscriptions(socket, preferences);

    socket.emit('loyalty-preferences-updated', {
        preferences,
        applied: true,
        message: 'Loyalty preferences updated successfully'
    });

    logger.info(`Loyalty preferences updated for user ${userId}`);
}

handleLoyaltyInsightsRequest(socket, period = '30d') {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    const insights = this.generateLoyaltyInsights(socket.userId, period);
    
    socket.emit('loyalty-insights-generated', {
        period,
        insights,
        tier: socket.loyaltyTier,
        generatedAt: new Date()
    });
}

joinChainLoyalty(socket, chainId) {
    if (!socket.isLoyaltyMember) {
        socket.emit('error', { message: 'Loyalty membership required' });
        return;
    }

    if (!['GOLD', 'PLATINUM', 'DIAMOND'].includes(socket.loyaltyTier)) {
        socket.emit('error', { message: 'Gold tier or higher required for chain tracking' });
        return;
    }

    const roomName = `chain-loyalty-${chainId}`;
    socket.join(roomName);

    socket.emit('chain-loyalty-joined', {
        chainId,
        tier: socket.loyaltyTier,
        benefits: ['Cross-hotel points', 'Chain-wide promotions', 'Priority reservations'],
        message: 'Connected to chain-wide loyalty tracking'
    });

    logger.info(`User ${socket.userId} (${socket.loyaltyTier}) joined chain ${chainId} loyalty tracking`);
}

trackCrossHotelActivity(socket, hotelIds) {
    if (!socket.isLoyaltyMember || !['PLATINUM', 'DIAMOND'].includes(socket.loyaltyTier)) {
        socket.emit('error', { message: 'Platinum tier or higher required for cross-hotel tracking' });
        return;
    }

    hotelIds.forEach(hotelId => {
        socket.join(`cross-hotel-${hotelId}`);
    });

    socket.emit('cross-hotel-tracking-started', {
        hotelIds,
        tier: socket.loyaltyTier,
        benefits: ['Activity sync', 'Bonus tracking', 'Elite benefits'],
        message: 'Cross-hotel activity tracking activated'
    });

    logger.info(`User ${socket.userId} started cross-hotel tracking for ${hotelIds.length} hotels`);
}

// ================================
// NOUVEAU : QR CODE REAL-TIME METHODS
// ================================

/**
 * Initialize QR system with metrics reset
 */
initializeQRSystem() {
    // Reset daily QR metrics at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
        this.resetDailyQRMetrics();
        setInterval(() => this.resetDailyQRMetrics(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    
    // Cleanup expired QR codes every 5 minutes
    setInterval(() => {
        this.cleanupExpiredQRCodes();
    }, 5 * 60 * 1000);
    
    logger.info('QR system initialized with daily metrics reset and cleanup');
}

/**
 * Setup QR context for connected user
 */
setupQRContext(socket, user) {
    const qrCapabilities = {
        canGenerate: socket.canGenerateQR,
        canValidate: socket.canGenerateQR,
        canMonitor: socket.canMonitorQR,
        supportedTypes: ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS', 'PAYMENT', 'MENU'],
        maxActiveQRs: socket.userRole === 'ADMIN' ? 100 : socket.userRole === 'RECEPTIONIST' ? 50 : 10
    };

    socket.emit('qr-context-ready', {
        capabilities: qrCapabilities,
        metrics: socket.canMonitorQR ? this.qrMetrics : null,
        userActiveQRs: this.getUserActiveQRCount(user._id),
        systemHealth: this.qrMetrics.systemHealth
    });
}

/**
 * Join QR updates subscription
 */
joinQRUpdates(socket, preferences = {}) {
    const userId = socket.userId;
    
    if (!this.qrSubscribers.has(userId)) {
        this.qrSubscribers.set(userId, new Set());
    }
    this.qrSubscribers.get(userId).add(socket.id);
    
    socket.join('qr-updates');
    socket.join(`qr-user-${userId}`);

    socket.emit('joined-qr-updates', {
        message: 'Subscribed to QR code updates',
        preferences,
        capabilities: {
            generation: socket.canGenerateQR,
            monitoring: socket.canMonitorQR,
            realTimeAlerts: true
        }
    });

    logger.info(`User ${userId} joined QR updates`);
}

/**
 * Leave QR updates subscription
 */
leaveQRUpdates(socket) {
    const userId = socket.userId;
    
    if (this.qrSubscribers.has(userId)) {
        this.qrSubscribers.get(userId).delete(socket.id);
        if (this.qrSubscribers.get(userId).size === 0) {
            this.qrSubscribers.delete(userId);
        }
    }
    
    socket.leave('qr-updates');
    socket.leave(`qr-user-${userId}`);
    
    socket.emit('left-qr-updates');
}

/**
 * Join QR admin monitoring
 */
joinQRAdmin(socket) {
    if (!socket.canMonitorQR) {
        socket.emit('error', { message: 'Unauthorized: QR admin access required' });
        return;
    }

    this.qrAdminSockets.add(socket.id);
    socket.join('qr-admin');
    socket.join('qr-monitoring');

    socket.emit('joined-qr-admin', {
        message: 'Connected to QR code admin dashboard',
        features: [
            'Real-time QR generation monitoring',
            'Check-in process tracking',
            'Usage analytics',
            'Security monitoring',
            'Bulk operations'
        ],
        metrics: this.qrMetrics,
        activeQRs: this.activeQRCodes.size
    });

    logger.info(`Admin ${socket.userId} joined QR admin dashboard`);
}

/**
 * Leave QR admin monitoring
 */
leaveQRAdmin(socket) {
    this.qrAdminSockets.delete(socket.id);
    socket.leave('qr-admin');
    socket.leave('qr-monitoring');
    
    socket.emit('left-qr-admin');
}

/**
 * Subscribe to hotel QR events
 */
subscribeHotelQR(socket, hotelId) {
    if (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) {
        socket.emit('error', { message: 'Unauthorized: Can only monitor QR for your hotel' });
        return;
    }

    if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
        socket.emit('error', { message: 'Unauthorized: Hotel QR monitoring access denied' });
        return;
    }

    if (!this.hotelQRSubscribers.has(hotelId)) {
        this.hotelQRSubscribers.set(hotelId, new Set());
    }
    this.hotelQRSubscribers.get(hotelId).add(socket.id);

    socket.join(`qr-hotel-${hotelId}`);

    socket.emit('subscribed-hotel-qr', {
        hotelId,
        message: 'Subscribed to hotel QR events',
        activeQRsForHotel: this.getHotelActiveQRCount(hotelId)
    });

    logger.info(`User ${socket.userId} subscribed to QR events for hotel ${hotelId}`);
}

/**
 * Unsubscribe from hotel QR events
 */
unsubscribeHotelQR(socket, hotelId) {
    if (this.hotelQRSubscribers.has(hotelId)) {
        this.hotelQRSubscribers.get(hotelId).delete(socket.id);
        if (this.hotelQRSubscribers.get(hotelId).size === 0) {
            this.hotelQRSubscribers.delete(hotelId);
        }
    }

    socket.leave(`qr-hotel-${hotelId}`);
    socket.emit('unsubscribed-hotel-qr', { hotelId });
}

/**
 * Handle QR code generation request
 */
async handleQRGeneration(socket, qrData) {
    if (!socket.canGenerateQR) {
        socket.emit('qr-generation-error', { message: 'Unauthorized: Cannot generate QR codes' });
        return;
    }

    try {
        const { qrCodeService } = require('./qrCodeService');
        
        // Add user context to QR data
        const enhancedQRData = {
            ...qrData,
            generatedBy: socket.userId,
            generatorRole: socket.userRole,
            hotelId: socket.hotelId || qrData.hotelId,
            timestamp: new Date()
        };

        socket.emit('qr-generation-started', {
            message: 'Generating QR code...',
            estimatedTime: '2-5 seconds',
            qrData: enhancedQRData
        });

        // Generate QR code
        const result = await qrCodeService.generateQRCode(enhancedQRData, {
            style: qrData.style || 'hotel',
            expiresIn: qrData.expiresIn || 24 * 60 * 60, // 24 hours default
            maxUsage: qrData.maxUsage || 10,
            deviceInfo: socket.handshake.headers['user-agent'],
            ipAddress: socket.handshake.address
        });

        if (result.success) {
            // Store active QR code
            this.activeQRCodes.set(result.token, {
                tokenId: result.token,
                type: qrData.type,
                userId: socket.userId,
                hotelId: enhancedQRData.hotelId,
                generatedAt: new Date(),
                expiresAt: result.metadata.expiresAt,
                usageCount: 0,
                maxUsage: result.metadata.usageLimit
            });

            // Update metrics
            this.qrMetrics.totalGenerated++;
            this.qrMetrics.dailyActivity.generated++;
            this.qrMetrics.lastQRActivity = new Date();

            // Send success response
            socket.emit('qr-generation-success', {
                qrCode: result.qrCode,
                metadata: result.metadata,
                token: result.token,
                message: 'QR code generated successfully'
            });

            // Broadcast to hotel and admin subscribers
            this.broadcastQREvent('QR_CODE_GENERATED', {
                tokenId: result.token,
                type: qrData.type,
                hotelId: enhancedQRData.hotelId,
                generatedBy: socket.userId,
                generatedAt: new Date()
            });

            logger.info(`QR code generated by user ${socket.userId} for ${qrData.type}`);
        } else {
            socket.emit('qr-generation-error', {
                message: result.error,
                code: result.code
            });

            this.qrMetrics.dailyActivity.errors++;
        }

    } catch (error) {
        logger.error('QR generation error:', error);
        socket.emit('qr-generation-error', {
            message: 'Internal error during QR generation',
            code: 'QR_GENERATION_FAILED'
        });

        this.qrMetrics.dailyActivity.errors++;
    }
}

/**
 * Handle QR code validation request
 */
async handleQRValidation(socket, qrData) {
    if (!socket.canGenerateQR) {
        socket.emit('qr-validation-error', { message: 'Unauthorized: Cannot validate QR codes' });
        return;
    }

    try {
        const { qrCodeService } = require('./qrCodeService');
        const { token } = qrData;

        socket.emit('qr-validation-started', {
            message: 'Validating QR code...',
            token: token.substring(0, 20) + '...'
        });

        // Validate QR code
        const result = await qrCodeService.validateQRCode(token, {
            userId: socket.userId,
            userRole: socket.userRole,
            hotelId: socket.hotelId,
            ipAddress: socket.handshake.address,
            userAgent: socket.handshake.headers['user-agent']
        });

        if (result.success) {
            // Update metrics
            this.qrMetrics.totalScanned++;
            this.qrMetrics.dailyActivity.scanned++;
            this.qrMetrics.lastQRActivity = new Date();

            // Update active QR code usage
            if (this.activeQRCodes.has(result.data.jti)) {
                const qrInfo = this.activeQRCodes.get(result.data.jti);
                qrInfo.usageCount++;
                qrInfo.lastUsed = new Date();
                qrInfo.lastUsedBy = socket.userId;
            }

            socket.emit('qr-validation-success', {
                qrData: result.data,
                metadata: result.metadata,
                message: 'QR code validated successfully'
            });

            // Broadcast validation event
            this.broadcastQREvent('QR_CODE_VALIDATED', {
                tokenId: result.data.jti,
                type: result.data.type,
                hotelId: result.data.hotelId,
                validatedBy: socket.userId,
                validatedAt: new Date(),
                usageCount: result.metadata.usageCount
            });

            logger.info(`QR code validated by user ${socket.userId}`);
        } else {
            socket.emit('qr-validation-error', {
                message: result.error,
                code: result.code
            });

            this.qrMetrics.dailyActivity.errors++;

            // Broadcast validation failure for security monitoring
            this.broadcastQREvent('QR_VALIDATION_FAILED', {
                token: token.substring(0, 20) + '...',
                error: result.error,
                validatedBy: socket.userId,
                validatedAt: new Date()
            });
        }

    } catch (error) {
        logger.error('QR validation error:', error);
        socket.emit('qr-validation-error', {
            message: 'Internal error during QR validation',
            code: 'QR_VALIDATION_FAILED'
        });

        this.qrMetrics.dailyActivity.errors++;
    }
}

/**
 * Handle QR check-in start
 */
async handleQRCheckInStart(socket, qrData) {
    try {
        const { token, bookingId } = qrData;
        const sessionId = `checkin_${Date.now()}_${socket.userId}`;

        // Create check-in session
        this.qrCheckInSessions.set(sessionId, {
            sessionId,
            token,
            bookingId,
            userId: socket.userId,
            hotelId: socket.hotelId,
            startedAt: new Date(),
            status: 'IN_PROGRESS',
            steps: ['qr_validated', 'identity_verified', 'room_assigned', 'keys_issued']
        });

        socket.emit('qr-checkin-started', {
            sessionId,
            message: 'Check-in process started',
            estimatedDuration: '3-5 minutes',
            steps: ['Validation QR', 'Vérification identité', 'Attribution chambre', 'Remise clés']
        });

        // Join check-in room for real-time updates
        socket.join(`checkin-${sessionId}`);

        // Broadcast check-in start
        this.broadcastQREvent('QR_CHECKIN_STARTED', {
            sessionId,
            bookingId,
            userId: socket.userId,
            hotelId: socket.hotelId,
            startedAt: new Date()
        });

        logger.info(`QR check-in started by user ${socket.userId}, session ${sessionId}`);

    } catch (error) {
        logger.error('QR check-in start error:', error);
        socket.emit('qr-checkin-error', {
            message: 'Failed to start check-in process',
            code: 'CHECKIN_START_FAILED'
        });
    }
}

/**
 * Handle QR check-in completion
 */
async handleQRCheckInComplete(socket, sessionData) {
    try {
        const { sessionId, roomNumbers, finalData } = sessionData;

        if (!this.qrCheckInSessions.has(sessionId)) {
            socket.emit('qr-checkin-error', {
                message: 'Check-in session not found',
                code: 'SESSION_NOT_FOUND'
            });
            return;
        }

        const session = this.qrCheckInSessions.get(sessionId);
        session.status = 'COMPLETED';
        session.completedAt = new Date();
        session.roomNumbers = roomNumbers;
        session.finalData = finalData;

        // Update metrics
        this.qrMetrics.totalCheckIns++;
        this.qrMetrics.successfulCheckIns++;
        this.qrMetrics.dailyActivity.checkIns++;
        this.qrMetrics.lastQRActivity = new Date();

        socket.emit('qr-checkin-completed', {
            sessionId,
            roomNumbers,
            message: 'Check-in completed successfully',
            checkInTime: new Date()
        });

        // Broadcast check-in completion
        this.broadcastQREvent('QR_CHECKIN_COMPLETED', {
            sessionId,
            bookingId: session.bookingId,
            userId: session.userId,
            hotelId: session.hotelId,
            roomNumbers,
            completedAt: new Date(),
            duration: new Date() - session.startedAt
        });

        // Clean up session after 5 minutes
        setTimeout(() => {
            this.qrCheckInSessions.delete(sessionId);
            socket.leave(`checkin-${sessionId}`);
        }, 5 * 60 * 1000);

        logger.info(`QR check-in completed for session ${sessionId}, rooms: ${roomNumbers.join(', ')}`);

    } catch (error) {
        logger.error('QR check-in completion error:', error);
        socket.emit('qr-checkin-error', {
            message: 'Failed to complete check-in process',
            code: 'CHECKIN_COMPLETION_FAILED'
        });

        this.qrMetrics.dailyActivity.errors++;
    }
}

/**
 * Handle QR check-in cancellation
 */
handleQRCheckInCancel(socket, sessionId) {
    if (!this.qrCheckInSessions.has(sessionId)) {
        socket.emit('qr-checkin-error', {
            message: 'Check-in session not found',
            code: 'SESSION_NOT_FOUND'
        });
        return;
    }

    const session = this.qrCheckInSessions.get(sessionId);
    session.status = 'CANCELLED';
    session.cancelledAt = new Date();

    socket.emit('qr-checkin-cancelled', {
        sessionId,
        message: 'Check-in process cancelled'
    });

    // Broadcast cancellation
    this.broadcastQREvent('QR_CHECKIN_CANCELLED', {
        sessionId,
        bookingId: session.bookingId,
        userId: session.userId,
        hotelId: session.hotelId,
        cancelledAt: new Date(),
        reason: 'User cancelled'
    });

    // Clean up
    this.qrCheckInSessions.delete(sessionId);
    socket.leave(`checkin-${sessionId}`);

    logger.info(`QR check-in cancelled for session ${sessionId}`);
}

/**
 * Handle QR status request
 */
handleQRStatusRequest(socket, tokenId) {
    if (!this.activeQRCodes.has(tokenId)) {
        socket.emit('qr-status-response', {
            tokenId,
            found: false,
            message: 'QR code not found or expired'
        });
        return;
    }

    const qrInfo = this.activeQRCodes.get(tokenId);
    
    socket.emit('qr-status-response', {
        tokenId,
        found: true,
        status: {
            type: qrInfo.type,
            generatedAt: qrInfo.generatedAt,
            expiresAt: qrInfo.expiresAt,
            usageCount: qrInfo.usageCount,
            maxUsage: qrInfo.maxUsage,
            remainingUsage: qrInfo.maxUsage - qrInfo.usageCount,
            lastUsed: qrInfo.lastUsed,
            isExpired: new Date() > new Date(qrInfo.expiresAt),
            hotelId: qrInfo.hotelId
        }
    });
}

/**
 * Handle QR metrics request
 */
handleQRMetricsRequest(socket) {
    if (!socket.canMonitorQR) {
        socket.emit('qr-metrics-error', { message: 'Unauthorized: Cannot access QR metrics' });
        return;
    }

    const metrics = {
        ...this.qrMetrics,
        activeQRCodes: this.activeQRCodes.size,
        activeCheckInSessions: this.qrCheckInSessions.size,
        connectedQRSubscribers: this.qrSubscribers.size,
        connectedAdmins: this.qrAdminSockets.size,
        systemUptime: process.uptime(),
        lastUpdated: new Date()
    };

    socket.emit('qr-metrics-response', metrics);
}

/**
 * Handle QR revocation
 */
async handleQRRevocation(socket, tokenId) {
    if (!socket.canMonitorQR) {
        socket.emit('qr-revocation-error', { message: 'Unauthorized: Cannot revoke QR codes' });
        return;
    }

    try {
        const { qrCodeService } = require('./qrCodeService');
        
        const result = await qrCodeService.revokeToken(tokenId, 'Manual revocation by admin', {
            userId: socket.userId,
            userRole: socket.userRole,
            timestamp: new Date()
        });

        if (result.success) {
            // Remove from active QR codes
            this.activeQRCodes.delete(tokenId);

            socket.emit('qr-revocation-success', {
                tokenId,
                message: 'QR code revoked successfully'
            });

            // Broadcast revocation
            this.broadcastQREvent('QR_CODE_REVOKED', {
                tokenId,
                revokedBy: socket.userId,
                revokedAt: new Date(),
                reason: 'Manual revocation by admin'
            });

            logger.info(`QR code ${tokenId} revoked by admin ${socket.userId}`);
        } else {
            socket.emit('qr-revocation-error', {
                message: result.error,
                code: 'QR_REVOCATION_FAILED'
            });
        }

    } catch (error) {
        logger.error('QR revocation error:', error);
        socket.emit('qr-revocation-error', {
            message: 'Internal error during QR revocation',
            code: 'QR_REVOCATION_FAILED'
        });
    }
}

/**
 * Handle bulk QR generation
 */
async handleBulkQRGeneration(socket, bulkData) {
    if (!socket.canMonitorQR) {
        socket.emit('bulk-qr-error', { message: 'Unauthorized: Cannot perform bulk QR operations' });
        return;
    }

    try {
        const { qrCodeService } = require('./qrCodeService');
        const { payloads, options } = bulkData;

        socket.emit('bulk-qr-started', {
            message: 'Starting bulk QR generation...',
            totalCount: payloads.length,
            estimatedTime: `${Math.ceil(payloads.length / 10)} minutes`
        });

        // Enhance payloads with generator info
        const enhancedPayloads = payloads.map(payload => ({
            ...payload,
            generatedBy: socket.userId,
            generatorRole: socket.userRole,
            batchId: bulkData.batchId || `batch_${Date.now()}`
        }));

        const result = await qrCodeService.generateBatchQRCodes(enhancedPayloads, {
            ...options,
            batchSize: 25 // Smaller batches for real-time updates
        });

        // Update metrics
        this.qrMetrics.totalGenerated += result.successful;
        this.qrMetrics.dailyActivity.generated += result.successful;
        this.qrMetrics.lastQRActivity = new Date();

        socket.emit('bulk-qr-completed', {
            totalCount: result.total,
            successful: result.successful,
            failed: result.failed,
            results: result.results,
            message: `Bulk generation completed: ${result.successful}/${result.total} successful`
        });

        // Broadcast bulk operation completion
        this.broadcastQREvent('QR_BULK_GENERATED', {
            batchId: bulkData.batchId,
            totalCount: result.total,
            successful: result.successful,
            failed: result.failed,
            generatedBy: socket.userId,
            completedAt: new Date()
        });

        logger.info(`Bulk QR generation completed by admin ${socket.userId}: ${result.successful}/${result.total} successful`);

    } catch (error) {
        logger.error('Bulk QR generation error:', error);
        socket.emit('bulk-qr-error', {
            message: 'Internal error during bulk QR generation',
            code: 'BULK_QR_FAILED'
        });
    }
}

/**
 * Handle QR usage tracking
 */
handleQRUsageTracking(socket, usageData) {
    const { tokenId, action, metadata } = usageData;
    
    if (this.activeQRCodes.has(tokenId)) {
        const qrInfo = this.activeQRCodes.get(tokenId);
        
        // Update usage tracking
        if (!qrInfo.usageHistory) {
            qrInfo.usageHistory = [];
        }
        
        qrInfo.usageHistory.push({
            action,
            timestamp: new Date(),
            userId: socket.userId,
            metadata
        });
        
        // Broadcast usage tracking
        this.broadcastQREvent('QR_USAGE_TRACKED', {
            tokenId,
            action,
            userId: socket.userId,
            timestamp: new Date(),
            metadata
        });
    }

    socket.emit('qr-usage-tracked', {
        tokenId,
        action,
        timestamp: new Date()
    });
}

/**
 * Broadcast QR event to subscribers
 */
broadcastQREvent(eventType, eventData) {
    if (!this.io) return;

    const broadcastData = {
        type: eventType,
        timestamp: new Date(),
        ...eventData
    };

    // Send to QR admin sockets
    this.io.to('qr-admin').emit('qr-event', broadcastData);

    // Send to hotel subscribers if hotelId is present
    if (eventData.hotelId) {
        this.io.to(`qr-hotel-${eventData.hotelId}`).emit('qr-hotel-event', broadcastData);
    }

    // Send to user subscribers if userId is present
    if (eventData.userId) {
        this.io.to(`qr-user-${eventData.userId}`).emit('qr-user-event', broadcastData);
    }

    // Send to general QR subscribers
    this.io.to('qr-updates').emit('qr-update', broadcastData);

    logger.debug(`QR event broadcast: ${eventType}`);
}

// ================================
// NOUVEAU : CACHE MONITORING METHODS
// ================================

/**
 * Initialize cache monitoring system
 */
initializeCacheMonitoring() {
    // Reset daily cache metrics at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    setTimeout(() => {
        this.resetDailyCacheMetrics();
        setInterval(() => this.resetDailyCacheMetrics(), 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
    
    // Performance monitoring every 30 seconds
    setInterval(() => {
        this.updateCachePerformanceMetrics();
    }, 30 * 1000);
    
    logger.info('Cache monitoring system initialized');
}

/**
 * Setup cache context for admin users
 */
setupCacheContext(socket, user) {
    const cacheCapabilities = {
        canMonitor: socket.canMonitorCache,
        canInvalidate: socket.canMonitorCache,
        canAnalyze: socket.canMonitorCache,
        realTimeStats: socket.canMonitorCache,
        performanceAlerts: socket.canMonitorCache
    };

    socket.emit('cache-context-ready', {
        capabilities: cacheCapabilities,
        metrics: socket.canMonitorCache ? this.cacheMetrics : null,
        systemHealth: this.cacheMetrics.systemHealth,
        redisStatus: this.cacheMetrics.redisConnectionStatus
    });
}

/**
 * Join cache monitoring
 */
joinCacheMonitoring(socket) {
    if (!socket.canMonitorCache) {
        socket.emit('error', { message: 'Unauthorized: Cache monitoring requires admin access' });
        return;
    }

    this.cacheSubscribers.add(socket.id);
    socket.join('cache-monitoring');

    socket.emit('joined-cache-monitoring', {
        message: 'Subscribed to cache monitoring updates',
        features: [
            'Real-time performance metrics',
            'Cache hit/miss ratios',
            'Redis health monitoring',
            'Invalidation tracking'
        ]
    });

    logger.info(`Admin ${socket.userId} joined cache monitoring`);
}

/**
 * Leave cache monitoring
 */
leaveCacheMonitoring(socket) {
    this.cacheSubscribers.delete(socket.id);
    socket.leave('cache-monitoring');
    
    socket.emit('left-cache-monitoring');
}

/**
 * Join cache admin dashboard
 */
joinCacheAdmin(socket) {
    if (!socket.canMonitorCache) {
        socket.emit('error', { message: 'Unauthorized: Cache admin access required' });
        return;
    }

    this.cacheAdminSockets.add(socket.id);
    socket.join('cache-admin');
    this.performanceMonitors.add(socket.id);

    socket.emit('joined-cache-admin', {
        message: 'Connected to cache admin dashboard',
        features: [
            'Advanced cache analytics',
            'Performance optimization',
            'Redis cluster monitoring',
            'Cache warming controls',
            'Invalidation management'
        ],
        metrics: this.cacheMetrics
    });

    logger.info(`Admin ${socket.userId} joined cache admin dashboard`);
}

/**
 * Leave cache admin dashboard
 */
leaveCacheAdmin(socket) {
    this.cacheAdminSockets.delete(socket.id);
    this.performanceMonitors.delete(socket.id);
    socket.leave('cache-admin');
    socket.emit('left-cache-admin');
}

/**
 * Subscribe to hotel cache events
 */
subscribeHotelCache(socket, hotelId) {
    if (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) {
        socket.emit('error', { message: 'Unauthorized: Can only monitor cache for your hotel' });
        return;
    }

    if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
        socket.emit('error', { message: 'Unauthorized: Hotel cache monitoring access denied' });
        return;
    }

    if (!this.hotelCacheSubscribers.has(hotelId)) {
        this.hotelCacheSubscribers.set(hotelId, new Set());
    }
    this.hotelCacheSubscribers.get(hotelId).add(socket.id);

    socket.join(`cache-hotel-${hotelId}`);

    socket.emit('subscribed-hotel-cache', {
        hotelId,
        message: 'Subscribed to hotel cache events',
        cacheTypes: ['availability', 'pricing', 'analytics', 'hotel_data']
    });

    logger.info(`User ${socket.userId} subscribed to cache events for hotel ${hotelId}`);
}

/**
 * Unsubscribe from hotel cache events
 */
unsubscribeHotelCache(socket, hotelId) {
    if (this.hotelCacheSubscribers.has(hotelId)) {
        this.hotelCacheSubscribers.get(hotelId).delete(socket.id);
        if (this.hotelCacheSubscribers.get(hotelId).size === 0) {
            this.hotelCacheSubscribers.delete(hotelId);
        }
    }

    socket.leave(`cache-hotel-${hotelId}`);
    socket.emit('unsubscribed-hotel-cache', { hotelId });
}

/**
 * Handle cache invalidation request
 */
async handleCacheInvalidation(socket, cacheData) {
    if (!socket.canMonitorCache) {
        socket.emit('cache-invalidation-error', { message: 'Unauthorized: Cannot invalidate cache' });
        return;
    }

    try {
        const cacheService = require('./cacheService');
        const { type, identifier, scope } = cacheData;

        socket.emit('cache-invalidation-started', {
            message: 'Starting cache invalidation...',
            type,
            identifier,
            scope
        });

        let invalidatedCount = 0;

        switch (type) {
            case 'hotel':
                invalidatedCount = await cacheService.invalidateHotelCache(identifier);
                break;
            case 'availability':
                invalidatedCount = await cacheService.invalidateAvailability(identifier);
                break;
            case 'pricing':
                invalidatedCount = await cacheService.invalidateYieldPricing(identifier);
                break;
            case 'analytics':
                invalidatedCount = await cacheService.invalidateAnalytics(scope, identifier);
                break;
            case 'all':
                if (socket.userRole === 'ADMIN') {
                    await cacheService.clearAllCache();
                    invalidatedCount = 'ALL';
                } else {
                    throw new Error('Only admins can clear all cache');
                }
                break;
            default:
                throw new Error('Invalid cache type');
        }

        // Update metrics
        this.cacheMetrics.totalInvalidations++;
        this.cacheMetrics.dailyActivity.invalidations++;
        this.cacheMetrics.lastCacheActivity = new Date();

        socket.emit('cache-invalidation-success', {
            type,
            identifier,
            invalidatedCount,
            message: `Cache invalidation completed: ${invalidatedCount} entries removed`
        });

        // Broadcast invalidation event
        this.broadcastCacheEvent('CACHE_INVALIDATED', {
            type,
            identifier,
            scope,
            invalidatedCount,
            invalidatedBy: socket.userId,
            invalidatedAt: new Date()
        });

        logger.info(`Cache invalidation by admin ${socket.userId}: ${type}/${identifier} - ${invalidatedCount} entries`);

    } catch (error) {
        logger.error('Cache invalidation error:', error);
        socket.emit('cache-invalidation-error', {
            message: error.message,
            code: 'CACHE_INVALIDATION_FAILED'
        });

        this.cacheMetrics.dailyActivity.errors++;
    }
}

/**
 * Handle cache warming request
 */
async handleCacheWarming(socket, warmData) {
    if (!socket.canMonitorCache) {
        socket.emit('cache-warming-error', { message: 'Unauthorized: Cannot warm cache' });
        return;
    }

    try {
        const cacheService = require('./cacheService');
        const { hotelIds, types } = warmData;

        socket.emit('cache-warming-started', {
            message: 'Starting cache warming...',
            hotelIds,
            types,
            estimatedTime: `${hotelIds.length * 2} minutes`
        });

        // Warm up cache
        await cacheService.warmUpCache(hotelIds);

        socket.emit('cache-warming-success', {
            hotelIds,
            types,
            message: `Cache warming completed for ${hotelIds.length} hotels`
        });

        // Broadcast warming event
        this.broadcastCacheEvent('CACHE_WARMED', {
            hotelIds,
            types,
            warmedBy: socket.userId,
            warmedAt: new Date()
        });

        logger.info(`Cache warming by admin ${socket.userId} for ${hotelIds.length} hotels`);

    } catch (error) {
        logger.error('Cache warming error:', error);
        socket.emit('cache-warming-error', {
            message: 'Cache warming failed',
            code: 'CACHE_WARMING_FAILED'
        });
    }
}

/**
 * Handle cache stats request
 */
async handleCacheStatsRequest(socket) {
    if (!socket.canMonitorCache) {
        socket.emit('cache-stats-error', { message: 'Unauthorized: Cannot access cache stats' });
        return;
    }

    try {
        const cacheService = require('./cacheService');
        const stats = await cacheService.getStats();

        const enhancedStats = {
            ...stats,
            realTimeMetrics: this.cacheMetrics,
            connections: {
                subscribers: this.cacheSubscribers.size,
                admins: this.cacheAdminSockets.size,
                performanceMonitors: this.performanceMonitors.size
            },
            lastUpdated: new Date()
        };

        socket.emit('cache-stats-response', enhancedStats);

    } catch (error) {
        logger.error('Cache stats request error:', error);
        socket.emit('cache-stats-error', {
            message: 'Failed to retrieve cache stats',
            code: 'CACHE_STATS_FAILED'
        });
    }
}

/**
 * Handle performance metrics request
 */
handlePerformanceMetricsRequest(socket) {
    if (!socket.canMonitorCache) {
        socket.emit('performance-metrics-error', { message: 'Unauthorized: Cannot access performance metrics' });
        return;
    }

    const performanceMetrics = {
        cache: this.cacheMetrics,
        qr: this.qrMetrics,
        yield: this.yieldMetrics,
        loyalty: this.loyaltyMetrics,
        system: {
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            cpuUsage: process.cpuUsage(),
            timestamp: new Date()
        },
        connections: {
            total: this.connectedUsers.size,
            admins: this.adminSockets.size,
            receptionists: Array.from(this.receptionistSockets.values()).reduce((sum, set) => sum + set.size, 0),
            clients: this.connectedUsers.size - this.adminSockets.size - Array.from(this.receptionistSockets.values()).reduce((sum, set) => sum + set.size, 0)
        }
    };

    socket.emit('performance-metrics-response', performanceMetrics);
}

/**
 * Handle Redis health monitoring
 */
async handleRedisHealthMonitoring(socket) {
    if (!socket.canMonitorCache) {
        socket.emit('redis-health-error', { message: 'Unauthorized: Cannot monitor Redis health' });
        return;
    }

    try {
        const redisConfig = require('../config/redis');
        const healthInfo = await redisConfig.getHealthInfo();

        const redisHealth = {
            ...healthInfo,
            connectionStatus: this.cacheMetrics.redisConnectionStatus,
            lastActivity: this.cacheMetrics.lastCacheActivity,
            metrics: {
                totalRequests: this.cacheMetrics.totalRequests,
                hitRate: this.cacheMetrics.totalRequests > 0 ? 
                    Math.round((this.cacheMetrics.totalHits / this.cacheMetrics.totalRequests) * 100) : 0,
                avgResponseTime: this.cacheMetrics.avgResponseTime
            },
            timestamp: new Date()
        };

        socket.emit('redis-health-response', redisHealth);

    } catch (error) {
        logger.error('Redis health monitoring error:', error);
        socket.emit('redis-health-error', {
            message: 'Failed to retrieve Redis health info',
            code: 'REDIS_HEALTH_FAILED'
        });
    }
}

/**
 * Handle cache analytics request
 */
handleCacheAnalyticsRequest(socket, period = '24h') {
    if (!socket.canMonitorCache) {
        socket.emit('cache-analytics-error', { message: 'Unauthorized: Cannot access cache analytics' });
        return;
    }

    // Generate analytics based on period
    const analytics = this.generateCacheAnalytics(period);

    socket.emit('cache-analytics-response', {
        period,
        analytics,
        generatedAt: new Date()
    });
}

/**
 * Broadcast cache event to subscribers
 */
broadcastCacheEvent(eventType, eventData) {
    if (!this.io) return;

    const broadcastData = {
        type: eventType,
        timestamp: new Date(),
        ...eventData
    };

    // Send to cache admin sockets
    this.io.to('cache-admin').emit('cache-event', broadcastData);

    // Send to cache monitoring sockets
    this.io.to('cache-monitoring').emit('cache-monitoring-update', broadcastData);

    // Send to hotel subscribers if hotelId is present
    if (eventData.hotelId) {
        this.io.to(`cache-hotel-${eventData.hotelId}`).emit('cache-hotel-event', broadcastData);
    }

    logger.debug(`Cache event broadcast: ${eventType}`);
}

/**
 * Update cache performance metrics
 */
async updateCachePerformanceMetrics() {
    try {
        const cacheService = require('./cacheService');
        const stats = await cacheService.getStats();

        if (stats && stats.cache) {
            // Update real-time metrics
            this.cacheMetrics.totalRequests = stats.cache.totalOperations || 0;
            this.cacheMetrics.totalHits = stats.cache.hits || 0;
            this.cacheMetrics.totalMisses = stats.cache.misses || 0;
            
            // Calculate hit rate
            const hitRate = this.cacheMetrics.totalRequests > 0 ? 
                Math.round((this.cacheMetrics.totalHits / this.cacheMetrics.totalRequests) * 100) : 0;

            // Broadcast performance update to monitoring sockets
            this.io.to('cache-monitoring').emit('cache-performance-update', {
                hitRate,
                totalRequests: this.cacheMetrics.totalRequests,
                redisStatus: this.cacheMetrics.redisConnectionStatus,
                timestamp: new Date()
            });

            // Send alerts if performance is degraded
            if (hitRate < 70 && this.cacheMetrics.totalRequests > 100) {
                this.broadcastCacheEvent('CACHE_PERFORMANCE_ALERT', {
                    alertType: 'LOW_HIT_RATE',
                    hitRate,
                    threshold: 70,
                    severity: 'warning',
                    timestamp: new Date()
                });
            }
        }

    } catch (error) {
        logger.error('Error updating cache performance metrics:', error);
        this.cacheMetrics.systemHealth = 'degraded';
    }
}

/**
 * Generate cache analytics
 */
generateCacheAnalytics(period) {
    const analytics = {
        period,
        summary: {
            totalRequests: this.cacheMetrics.totalRequests,
            hitRate: this.cacheMetrics.totalRequests > 0 ? 
                Math.round((this.cacheMetrics.totalHits / this.cacheMetrics.totalRequests) * 100) : 0,
            missRate: this.cacheMetrics.totalRequests > 0 ? 
                Math.round((this.cacheMetrics.totalMisses / this.cacheMetrics.totalRequests) * 100) : 0,
            invalidations: this.cacheMetrics.totalInvalidations,
            avgResponseTime: this.cacheMetrics.avgResponseTime
        },
        dailyActivity: this.cacheMetrics.dailyActivity,
        trends: {
            performance: this.cacheMetrics.systemHealth,
            redisHealth: this.cacheMetrics.redisConnectionStatus,
            lastActivity: this.cacheMetrics.lastCacheActivity
        },
        recommendations: this.getCacheRecommendations()
    };

    return analytics;
}

/**
 * Get cache performance recommendations
 */
getCacheRecommendations() {
    const recommendations = [];
    
    const hitRate = this.cacheMetrics.totalRequests > 0 ? 
        (this.cacheMetrics.totalHits / this.cacheMetrics.totalRequests) * 100 : 0;

    if (hitRate < 60) {
        recommendations.push({
            type: 'performance',
            priority: 'high',
            message: 'Cache hit rate is low. Consider cache warming or TTL optimization.'
        });
    }

    if (this.cacheMetrics.dailyActivity.errors > 10) {
        recommendations.push({
            type: 'reliability',
            priority: 'medium',
            message: 'High error rate detected. Check Redis connection and configuration.'
        });
    }

    if (this.cacheMetrics.totalInvalidations > 100) {
        recommendations.push({
            type: 'efficiency',
            priority: 'low',
            message: 'High invalidation rate. Review cache invalidation strategies.'
        });
    }

    return recommendations;
}

// ================================
// NOTIFICATION METHODS (LOYALTY CONSERVÉ)
// ================================

sendPointsEarnedNotification(userId, pointsData) {
    if (!this.io) return;

    const socketId = this.connectedUsers.get(userId);
    if (!socketId) {
        this.queueLoyaltyNotification('points_earned', userId, pointsData);
        return false;
    }

    const notification = {
        type: 'loyalty_points_earned',
        userId,
        timestamp: new Date(),
        celebration: pointsData.amount >= 500,
        ...pointsData
    };

    this.io.to(socketId).emit('loyalty-points-earned', notification);

    if (pointsData.amount >= 1000) {
        this.io.to(socketId).emit('loyalty-celebration', {
            type: 'big_points_earn',
            amount: pointsData.amount,
            animation: 'golden_shower',
            duration: 3000
        });
    }

    this.loyaltyMetrics.dailyActivity.pointsEarned += pointsData.amount;
    this.loyaltyMetrics.totalPointsIssued += pointsData.amount;
    this.loyaltyMetrics.lastLoyaltyActivity = new Date();

    this.broadcastLoyaltyAdminUpdate('points_earned', {
        userId,
        amount: pointsData.amount,
        booking: pointsData.booking,
        tier: pointsData.tier
    });

    logger.info(`Points earned notification sent to user ${userId}: ${pointsData.amount} points`);
    return true;
}

sendTierUpgradeNotification(userId, upgradeData) {
    if (!this.io) return;

    const socketId = this.connectedUsers.get(userId);
    if (!socketId) {
        this.queueLoyaltyNotification('tier_upgrade', userId, upgradeData);
        return false;
    }

    const { oldTier, newTier, bonusPoints, newBenefits } = upgradeData;

    this.io.to(socketId).emit('loyalty-tier-upgraded', {
        type: 'tier_upgrade',
        oldTier,
        newTier,
        newTierDisplay: this.getTierDisplayName(newTier),
        bonusPoints,
        newBenefits,
        celebration: true,
        userId,
        timestamp: new Date()
    });

    const celebrationAnimation = this.getTierCelebrationAnimation(newTier);
    this.io.to(socketId).emit('loyalty-celebration', {
        type: 'tier_upgrade',
        animation: celebrationAnimation.animation,
        duration: celebrationAnimation.duration,
        sound: celebrationAnimation.sound,
        message: `Félicitations ! Vous êtes maintenant ${this.getTierDisplayName(newTier)} !`
    });

    this.io.to(socketId).emit('achievement-unlocked', {
        achievementId: `tier_${newTier.toLowerCase()}`,
        title: `Niveau ${this.getTierDisplayName(newTier)}`,
        description: `Vous avez atteint le niveau ${this.getTierDisplayName(newTier)}`,
        rarity: this.getTierRarity(newTier),
        icon: this.getTierIcon(newTier),
        rewards: newBenefits
    });

    this.io.to(socketId).leave(`loyalty-tier-${oldTier}`);
    this.io.to(socketId).join(`loyalty-tier-${newTier}`);

    this.loyaltyMetrics.dailyActivity.tierUpgrades++;
    this.loyaltyMetrics.totalTierUpgrades++;
    this.loyaltyMetrics.lastLoyaltyActivity = new Date();

    this.io.to(`loyalty-tier-${newTier}`).emit('tier-community-welcome', {
        newMember: userId,
        tier: newTier,
        message: `Un nouveau membre a rejoint le niveau ${this.getTierDisplayName(newTier)} !`
    });

    this.broadcastLoyaltyAdminUpdate('tier_upgrade', {
        userId,
        oldTier,
        newTier,
        bonusPoints,
        timestamp: new Date()
    });

    logger.info(`Tier upgrade notification sent to user ${userId}: ${oldTier} -> ${newTier}`);
    return true;
}

broadcastLoyaltyAdminUpdate(eventType, eventData) {
    if (!this.io) return;

    const update = {
        type: 'loyalty_admin_update',
        eventType,
        eventData,
        metrics: this.loyaltyMetrics,
        timestamp: new Date()
    };

    this.io.to('loyalty-admin').emit('loyalty-admin-update', update);
    this.io.to('loyalty-dashboard').emit('loyalty-dashboard-update', update);
}

sendLoyaltyAdminDashboard(socket) {
    if (!socket || socket.userRole !== 'ADMIN') return;

    const dashboardData = {
        metrics: this.loyaltyMetrics,
        realTimeStats: this.getRealTimeLoyaltyStats(),
        connectionStats: this.getLoyaltyConnectionStats(),
        activeAlerts: this.getActiveLoyaltySystemAlerts(),
        topPerformers: this.getTopLoyaltyPerformers(),
        systemHealth: this.getLoyaltySystemHealth()
    };

    socket.emit('loyalty-admin-dashboard', dashboardData);
}

// ================================
// PUBLIC NOTIFICATION INTERFACES
// ================================

/**
 * Send user notification with enhanced routing
 */
sendUserNotification(userId, eventType, data) {
    if (!this.io) {
        logger.warn('Socket.io not initialized');
        return false;
    }

    const socketId = this.connectedUsers.get(userId);
    if (!socketId) {
        logger.warn(`User ${userId} not connected, cannot send real-time notification`);
        return false;
    }

    const notification = {
        type: 'user',
        eventType,
        userId,
        data,
        timestamp: new Date()
    };

    this.io.to(socketId).emit('notification', notification);
    
    // Route to specific feature channels if applicable
    if (eventType.startsWith('QR_')) {
        this.io.to(`qr-user-${userId}`).emit('qr-notification', notification);
    } else if (eventType.startsWith('LOYALTY_')) {
        this.io.to(`loyalty-user-${userId}`).emit('loyalty-notification', notification);
    } else if (eventType.startsWith('CACHE_')) {
        if (this.cacheSubscribers.has(socketId)) {
            this.io.to(socketId).emit('cache-notification', notification);
        }
    }

    logger.info(`User notification sent: ${eventType} to user ${userId}`);
    return true;
}

/**
 * Send booking notification with enhanced routing
 */
sendBookingNotification(bookingId, eventType, data) {
    if (!this.io) return;

    const notification = {
        type: 'booking',
        eventType,
        bookingId,
        data,
        timestamp: new Date()
    };

    this.io.to(`booking-${bookingId}`).emit('booking-update', notification);
    
    if (data.hotelId) {
        this.io.to(`hotel-${data.hotelId}`).emit('booking-update', notification);
        
        // Send to hotel cache subscribers for cache invalidation
        this.io.to(`cache-hotel-${data.hotelId}`).emit('booking-cache-update', {
            ...notification,
            cacheInvalidationRequired: ['availability', 'analytics']
        });
    }

    this.io.to('admins').emit('booking-update', notification);

    logger.info(`Booking notification sent: ${eventType} for booking ${bookingId}`);
}

/**
 * Send hotel notification with enhanced routing
 */
sendHotelNotification(hotelId, eventType, data) {
    if (!this.io) return;

    const notification = {
        type: 'hotel',
        eventType,
        hotelId,
        data,
        timestamp: new Date()
    };

    this.io.to(`hotel-${hotelId}`).emit('hotel-update', notification);
    
    // Route to specific feature channels
    this.io.to(`qr-hotel-${hotelId}`).emit('hotel-qr-update', notification);
    this.io.to(`cache-hotel-${hotelId}`).emit('hotel-cache-update', notification);
    this.io.to(`loyalty-hotel-${hotelId}`).emit('hotel-loyalty-update', notification);
    
    logger.info(`Hotel notification sent: ${eventType} for hotel ${hotelId}`);
}

/**
 * Send admin notification with enhanced routing
 */
sendAdminNotification(eventType, data) {
    if (!this.io) return;

    const notification = {
        type: 'admin',
        eventType,
        data,
        timestamp: new Date()
    };

    this.io.to('admins').emit('admin-notification', notification);
    
    // Route to specific admin channels
    if (eventType.includes('QR')) {
        this.io.to('qr-admin').emit('admin-qr-notification', notification);
    }
    if (eventType.includes('CACHE')) {
        this.io.to('cache-admin').emit('admin-cache-notification', notification);
    }
    if (eventType.includes('LOYALTY')) {
        this.io.to('loyalty-admin').emit('admin-loyalty-notification', notification);
    }
    
    logger.info(`Admin notification sent: ${eventType}`);
}

// ================================
// UTILITY METHODS (CONSERVÉ + NOUVEAUX)
// ================================

/**
 * Reset daily metrics for all systems
 */
resetDailyQRMetrics() {
    this.qrMetrics.dailyActivity = {
        generated: 0,
        scanned: 0,
        checkIns: 0,
        errors: 0
    };
    
    this.broadcastQREvent('QR_DAILY_METRICS_RESET', {
        date: new Date().toISOString().slice(0, 10),
        previousMetrics: { ...this.qrMetrics.dailyActivity }
    });
    
    logger.info('Daily QR metrics reset');
}

resetDailyCacheMetrics() {
    this.cacheMetrics.dailyActivity = {
        requests: 0,
        hits: 0,
        misses: 0,
        invalidations: 0,
        errors: 0
    };
    
    this.broadcastCacheEvent('CACHE_DAILY_METRICS_RESET', {
        date: new Date().toISOString().slice(0, 10),
        previousMetrics: { ...this.cacheMetrics.dailyActivity }
    });
    
    logger.info('Daily cache metrics reset');
}

resetDailyLoyaltyMetrics() {
    this.loyaltyMetrics.dailyActivity = {
        pointsEarned: 0,
        pointsRedeemed: 0,
        tierUpgrades: 0,
        newMembers: 0,
        redemptions: 0
    };
    
    this.io.to('loyalty-admin').emit('daily-metrics-reset', {
        date: new Date().toISOString().slice(0, 10),
        previousMetrics: { ...this.loyaltyMetrics.dailyActivity }
    });
    
    logger.info('Daily loyalty metrics reset');
}

/**
 * Cleanup expired data
 */
cleanupExpiredQRCodes() {
    const now = new Date();
    let expiredCount = 0;
    
    for (const [tokenId, qrInfo] of this.activeQRCodes) {
        if (new Date(qrInfo.expiresAt) < now) {
            this.activeQRCodes.delete(tokenId);
            expiredCount++;
        }
    }
    
    if (expiredCount > 0) {
        this.qrMetrics.expiredCodes += expiredCount;
        this.broadcastQREvent('QR_CODES_EXPIRED', {
            expiredCount,
            cleanupAt: new Date()
        });
        
        logger.info(`Cleaned up ${expiredCount} expired QR codes`);
    }
}

/**
 * Get user active QR count
 */
getUserActiveQRCount(userId) {
    let count = 0;
    for (const qrInfo of this.activeQRCodes.values()) {
        if (qrInfo.userId === userId) {
            count++;
        }
    }
    return count;
}

/**
 * Get hotel active QR count
 */
getHotelActiveQRCount(hotelId) {
    let count = 0;
    for (const qrInfo of this.activeQRCodes.values()) {
        if (qrInfo.hotelId === hotelId) {
            count++;
        }
    }
    return count;
}

/**
 * Get comprehensive connection statistics
 */
getConnectionStats() {
    const baseStats = {
        totalConnections: this.connectedUsers.size,
        adminConnections: this.adminSockets.size,
        receptionistConnections: Array.from(this.receptionistSockets.values()).reduce((sum, set) => sum + set.size, 0),
        clientConnections: this.connectedUsers.size - this.adminSockets.size - Array.from(this.receptionistSockets.values()).reduce((sum, set) => sum + set.size, 0),
        hotelConnections: Object.fromEntries(
            Array.from(this.receptionistSockets.entries()).map(([hotelId, sockets]) => [hotelId, sockets.size])
        )
    };

    return {
        ...baseStats,
        yieldManagement: this.getYieldConnectionStats(),
        loyaltyProgram: this.getLoyaltyConnectionStats(),
        qrManagement: this.getQRConnectionStats(),
        cacheMonitoring: this.getCacheConnectionStats()
    };
}

/**
 * Get QR connection statistics
 */
getQRConnectionStats() {
    return {
        qrSubscribers: this.qrSubscribers.size,
        qrAdminSockets: this.qrAdminSockets.size,
        hotelQRSubscribers: Array.from(this.hotelQRSubscribers.values()).reduce((sum, set) => sum + set.size, 0),
        activeQRCodes: this.activeQRCodes.size,
        activeCheckInSessions: this.qrCheckInSessions.size
    };
}

/**
 * Get cache connection statistics
 */
getCacheConnectionStats() {
    return {
        cacheSubscribers: this.cacheSubscribers.size,
        cacheAdminSockets: this.cacheAdminSockets.size,
        performanceMonitors: this.performanceMonitors.size,
        hotelCacheSubscribers: Array.from(this.hotelCacheSubscribers.values()).reduce((sum, set) => sum + set.size, 0)
    };
}

/**
 * Get system health status for all components
 */
getSystemHealthStatus() {
    return {
        overall: 'operational',
        components: {
            yield: this.getYieldHealthStatus(),
            loyalty: this.getLoyaltyHealthStatus(),
            qr: this.getQRHealthStatus(),
            cache: this.getCacheHealthStatus(),
            booking: {
                enabled: true,
                connections: this.connectedUsers.size,
                status: 'operational'
            }
        },
        uptime: process.uptime(),
        lastUpdated: new Date()
    };
}

/**
 * Get QR health status
 */
getQRHealthStatus() {
    return {
        enabled: true,
        subscribers: this.getQRConnectionStats(),
        metrics: this.qrMetrics,
        lastActivity: this.qrMetrics.lastQRActivity,
        activeQRCodes: this.activeQRCodes.size,
        uptime: process.uptime(),
        status: this.qrMetrics.systemHealth
    };
}

/**
 * Get cache health status
 */
getCacheHealthStatus() {
    return {
        enabled: true,
        subscribers: this.getCacheConnectionStats(),
        metrics: this.cacheMetrics,
        lastActivity: this.cacheMetrics.lastCacheActivity,
        redisStatus: this.cacheMetrics.redisConnectionStatus,
        uptime: process.uptime(),
        status: this.cacheMetrics.systemHealth
    };
}

// ================================
// EXISTING LOYALTY UTILITY METHODS (CONSERVÉ INTÉGRALEMENT)
// ================================

joinTierSpecificRoom(socket, tier) {
    socket.join(`loyalty-tier-${tier}`);
    
    const tierGroups = {
        'BRONZE': ['bronze'],
        'SILVER': ['bronze', 'silver'],
        'GOLD': ['bronze', 'silver', 'gold'],
        'PLATINUM': ['bronze', 'silver', 'gold', 'platinum'],
        'DIAMOND': ['bronze', 'silver', 'gold', 'platinum', 'diamond']
    };
    
    tierGroups[tier]?.forEach(group => {
        socket.join(`tier-benefits-${group}`);
    });
}

setupTierSpecificSubscriptions(socket, tier) {
    const tierSubscriptions = {
        'BRONZE': ['basic_promotions'],
        'SILVER': ['basic_promotions', 'tier_progress'],
        'GOLD': ['basic_promotions', 'tier_progress', 'exclusive_offers'],
        'PLATINUM': ['basic_promotions', 'tier_progress', 'exclusive_offers', 'vip_events'],
        'DIAMOND': ['basic_promotions', 'tier_progress', 'exclusive_offers', 'vip_events', 'concierge_offers']
    };

    const subscriptions = tierSubscriptions[tier] || ['basic_promotions'];
    subscriptions.forEach(sub => socket.join(sub));
}

updateLoyaltySubscriptions(socket, preferences) {
    if (preferences.notifications) {
        if (preferences.notifications.includes('promotions')) {
            socket.join('promotion-alerts');
        } else {
            socket.leave('promotion-alerts');
        }
        
        if (preferences.notifications.includes('tier_progress')) {
            socket.join('tier-updates');
        } else {
            socket.leave('tier-updates');
        }
        
        if (preferences.notifications.includes('expiry')) {
            socket.join('expiry-alerts');
        } else {
            socket.leave('expiry-alerts');
        }
    }
}

getLoyaltyFeatures(tier) {
    const features = {
        'BRONZE': ['points_earning', 'basic_redemption'],
        'SILVER': ['points_earning', 'basic_redemption', 'tier_progress', 'bonus_events'],
        'GOLD': ['points_earning', 'basic_redemption', 'tier_progress', 'bonus_events', 'exclusive_offers', 'priority_support'],
        'PLATINUM': ['points_earning', 'basic_redemption', 'tier_progress', 'bonus_events', 'exclusive_offers', 'priority_support', 'vip_access', 'concierge'],
        'DIAMOND': ['points_earning', 'basic_redemption', 'tier_progress', 'bonus_events', 'exclusive_offers', 'priority_support', 'vip_access', 'concierge', 'personal_manager', 'unlimited_benefits']
    };
    
    return features[tier] || features['BRONZE'];
}

getNextTierThreshold(currentTier) {
    const thresholds = {
        'BRONZE': { next: 'SILVER', points: 1000 },
        'SILVER': { next: 'GOLD', points: 5000 },
        'GOLD': { next: 'PLATINUM', points: 15000 },
        'PLATINUM': { next: 'DIAMOND', points: 50000 },
        'DIAMOND': { next: null, points: null }
    };
    
    return thresholds[currentTier] || thresholds['BRONZE'];
}

getNextTier(currentTier) {
    const progression = {
        'BRONZE': 'SILVER',
        'SILVER': 'GOLD',
        'GOLD': 'PLATINUM',
        'PLATINUM': 'DIAMOND',
        'DIAMOND': null
    };
    
    return progression[currentTier];
}

getTierMultiplier(tier) {
    const multipliers = {
        'BRONZE': 1.0,
        'SILVER': 1.2,
        'GOLD': 1.5,
        'PLATINUM': 2.0,
        'DIAMOND': 2.5
    };
    
    return multipliers[tier] || 1.0;
}

getTierDisplayName(tier) {
    const names = {
        'BRONZE': 'Bronze',
        'SILVER': 'Argent',
        'GOLD': 'Or',
        'PLATINUM': 'Platine',
        'DIAMOND': 'Diamant'
    };
    return names[tier] || 'Bronze';
}

getTierIcon(tier) {
    const icons = {
        'BRONZE': '🥉',
        'SILVER': '🥈',
        'GOLD': '🥇',
        'PLATINUM': '💎',
        'DIAMOND': '💠'
    };
    return icons[tier] || '🥉';
}

getTierRarity(tier) {
    const rarities = {
        'BRONZE': 'common',
        'SILVER': 'uncommon',
        'GOLD': 'rare',
        'PLATINUM': 'epic',
        'DIAMOND': 'legendary'
    };
    return rarities[tier] || 'common';
}

getTierCelebrationAnimation(tier) {
    const animations = {
        'BRONZE': { animation: 'bronze_sparkle', duration: 2000, sound: 'level_up' },
        'SILVER': { animation: 'silver_shine', duration: 3000, sound: 'achievement' },
        'GOLD': { animation: 'golden_burst', duration: 4000, sound: 'triumph' },
        'PLATINUM': { animation: 'platinum_explosion', duration: 5000, sound: 'epic_achievement' },
        'DIAMOND': { animation: 'diamond_constellation', duration: 6000, sound: 'legendary_achievement' }
    };
    return animations[tier] || animations['BRONZE'];
}

checkCampaignEligibility(tier) {
    return {
        eligible: true,
        tier,
        bonusMultiplier: this.getTierMultiplier(tier),
        exclusiveAccess: ['PLATINUM', 'DIAMOND'].includes(tier)
    };
}

calculateRedemptionOptions(points, tier, criteria = {}) {
    const options = [];
    
    if (points >= 100) {
        options.push({
            type: 'DISCOUNT',
            pointsRequired: 100,
            value: '1€ de réduction',
            available: true,
            maxPoints: Math.min(points, 5000)
        });
    }
    
    if (points >= 1000) {
        options.push({
            type: 'UPGRADE',
            pointsRequired: 1000,
            value: 'Upgrade chambre',
            available: true,
            tierRequired: 'BRONZE'
        });
    }
    
    if (points >= 5000 && ['GOLD', 'PLATINUM', 'DIAMOND'].includes(tier)) {
        options.push({
            type: 'FREE_NIGHT',
            pointsRequired: 5000,
            value: 'Nuit gratuite',
            available: true,
            tierRequired: 'GOLD',
            exclusive: true
        });
    }
    
    return options.filter(option => {
        if (criteria.type && option.type !== criteria.type) return false;
        if (criteria.maxPoints && option.pointsRequired > criteria.maxPoints) return false;
        return true;
    });
}

getRedemptionRecommendations(points, tier) {
    const recommendations = [];
    
    if (points >= 5000 && ['GOLD', 'PLATINUM', 'DIAMOND'].includes(tier)) {
        recommendations.push({
            type: 'FREE_NIGHT',
            reason: 'Meilleur rapport qualité/prix',
            priority: 'high'
        });
    } else if (points >= 1000) {
        recommendations.push({
            type: 'UPGRADE',
            reason: 'Améliorez votre prochaine réservation',
            priority: 'medium'
        });
    } else if (points >= 100) {
        recommendations.push({
            type: 'DISCOUNT',
            reason: 'Économisez immédiatement',
            priority: 'low'
        });
    }
    
    return recommendations;
}

async getActiveLoyaltyAlerts(userId) {
    const alerts = [];
    
    if (this.pointsExpirySubscribers.has(userId)) {
        alerts.push({
            type: 'expiry_warning',
            severity: 'medium',
            message: 'Des points expirent bientôt'
        });
    }
    
    return alerts;
}

getTodayLoyaltyActivity(userId) {
    return {
        pointsEarned: 0,
        pointsRedeemed: 0,
        transactionCount: 0,
        lastActivity: null
    };
}

generateLoyaltyInsights(userId, period) {
    return {
        period,
        insights: [
            {
                type: 'earning_trend',
                message: 'Vos gains de points sont en hausse !',
                trend: 'positive'
            },
            {
                type: 'redemption_suggestion',
                message: 'Vous pourriez économiser en utilisant vos points',
                action: 'Voir les options'
            }
        ],
        recommendations: [
            {
                type: 'booking',
                message: 'Réservez maintenant pour gagner plus de points',
                priority: 'medium'
            }
        ]
    };
}

getRealTimeLoyaltyStats() {
    return {
        onlineMembers: this.loyaltySubscribers.size,
        activeCampaigns: this.loyaltyMetrics.activeCampaigns,
        todayActivity: this.loyaltyMetrics.dailyActivity,
        systemHealth: this.loyaltyMetrics.systemHealth
    };
}

getLoyaltyConnectionStats() {
    return {
        totalLoyaltySubscribers: this.loyaltySubscribers.size,
        tierUpgradeSubscribers: this.tierUpgradeSubscribers.size,
        expiryAlertSubscribers: this.pointsExpirySubscribers.size,
        campaignSubscribers: Array.from(this.campaignSubscribers.values()).reduce((sum, set) => sum + set.size, 0),
        loyaltyAdmins: this.loyaltyAdminSockets.size
    };
}

getActiveLoyaltySystemAlerts() {
    const alerts = [];
    
    if (this.loyaltyMetrics.systemHealth !== 'operational') {
        alerts.push({
            type: 'system_health',
            severity: 'warning',
            message: 'Loyalty system performance degraded'
        });
    }
    
    const expirySubscribers = this.pointsExpirySubscribers.size;
    if (expirySubscribers > 100) {
        alerts.push({
            type: 'high_expiry_volume',
            severity: 'medium',
            message: `${expirySubscribers} users have points expiring soon`
        });
    }
    
    return alerts;
}

getTopLoyaltyPerformers() {
    return [
        { userId: 'user1', tier: 'DIAMOND', pointsThisMonth: 5000 },
        { userId: 'user2', tier: 'PLATINUM', pointsThisMonth: 3500 },
        { userId: 'user3', tier: 'GOLD', pointsThisMonth: 2800 }
    ];
}

getLoyaltySystemHealth() {
    const health = {
        status: this.loyaltyMetrics.systemHealth,
        uptime: process.uptime(),
        lastActivity: this.loyaltyMetrics.lastLoyaltyActivity,
        connectedUsers: this.loyaltySubscribers.size,
        errorRate: 0,
        responseTime: 'normal'
    };
    
    if (health.connectedUsers === 0) {
        health.status = 'warning';
    } else if (health.errorRate > 5) {
        health.status = 'degraded';
    } else {
        health.status = 'operational';
    }
    
    return health;
}

queueLoyaltyNotification(type, userId, data) {
    this.loyaltyNotificationQueue.push({
        type,
        userId,
        data,
        queuedAt: new Date(),
        attempts: 0
    });
    
    if (!this.loyaltyBatchProcessing) {
        this.startLoyaltyBatchProcessing();
    }
}

startLoyaltyBatchProcessing() {
    if (this.loyaltyBatchProcessing) return;
    
    this.loyaltyBatchProcessing = true;
    
    const processBatch = () => {
        if (this.loyaltyNotificationQueue.length === 0) {
            this.loyaltyBatchProcessing = false;
            return;
        }
        
        const batch = this.loyaltyNotificationQueue.splice(0, 10);
        
        batch.forEach(notification => {
            const socketId = this.connectedUsers.get(notification.userId);
            if (socketId) {
                this.sendQueuedLoyaltyNotification(socketId, notification);
            } else if (notification.attempts < 3) {
                notification.attempts++;
                this.loyaltyNotificationQueue.push(notification);
            }
        });
        
        setTimeout(processBatch, 1000);
    };
    
    processBatch();
}

sendQueuedLoyaltyNotification(socketId, notification) {
    const { type, data } = notification;
    
    switch (type) {
        case 'points_earned':
            this.io.to(socketId).emit('loyalty-points-earned', {
                type: 'loyalty_points_earned',
                ...data,
                queued: true,
                timestamp: new Date()
            });
            break;
            
        case 'tier_upgrade':
            this.io.to(socketId).emit('loyalty-tier-upgraded', {
                type: 'tier_upgrade',
                ...data,
                queued: true,
                timestamp: new Date()
            });
            break;
            
        case 'points_expiry':
            this.io.to(socketId).emit('loyalty-points-expiry-alert', {
                type: 'points_expiry_warning',
                ...data,
                queued: true,
                timestamp: new Date()
            });
            break;
            
        case 'points_redeemed':
            this.io.to(socketId).emit('loyalty-points-redeemed', {
                type: 'points_redeemed',
                ...data,
                queued: true,
                timestamp: new Date()
            });
            break;
            
        case 'personalized_promotion':
            this.io.to(socketId).emit('loyalty-personalized-promotion', {
                type: 'personalized_promotion',
                ...data,
                queued: true,
                timestamp: new Date()
            });
            break;
    }
    
    logger.info(`Queued loyalty notification sent: ${type} to user ${notification.userId}`);
}

setLoyaltyCache(key, data) {
    this.loyaltyCache.set(key, {
        data,
        timestamp: Date.now()
    });
    
    if (this.loyaltyCache.size > 1000) {
        const oldEntries = Array.from(this.loyaltyCache.entries())
            .filter(([k, v]) => Date.now() - v.timestamp > this.loyaltyCacheExpiry)
            .slice(0, 200);
            
        oldEntries.forEach(([key]) => this.loyaltyCache.delete(key));
    }
}

getLoyaltyCache(key) {
    const cached = this.loyaltyCache.get(key);
    if (!cached) return null;
    
    if (Date.now() - cached.timestamp > this.loyaltyCacheExpiry) {
        this.loyaltyCache.delete(key);
        return null;
    }
    
    return cached.data;
}

async checkImmediateExpiryAlert(userId) {
    try {
        const hasExpiringPoints = Math.random() > 0.8;
        
        if (hasExpiringPoints) {
            this.sendPointsExpiryAlert(userId, {
                pointsExpiring: 500,
                daysUntilExpiry: 3,
                urgency: 'high',
                redemptionSuggestions: ['discount', 'upgrade']
            });
        }
    } catch (error) {
        logger.error('Error checking immediate expiry alert:', error);
    }
}

// ================================
// EXISTING YIELD METHODS (CONSERVÉ INTÉGRALEMENT) 
// ================================

getTotalPricingSubscribers() {
    let total = 0;
    for (const subscribers of this.pricingSubscribers.values()) {
        total += subscribers.size;
    }
    return total;
}

getTotalDemandSubscribers() {
    let total = 0;
    for (const subscribers of this.demandSubscribers.values()) {
        total += subscribers.size;
    }
    return total;
}

getTotalPriceWatchers() {
    let total = 0;
    for (const watchers of this.customerPriceWatchers.values()) {
        total += watchers.size;
    }
    return total;
}

getYieldConnectionStats() {
    return {
        pricingSubscribers: this.getTotalPricingSubscribers(),
        demandSubscribers: this.getTotalDemandSubscribers(),
        yieldAdmins: this.yieldAdminSockets.size,
        revenueMonitors: this.revenueSubscribers.size,
        priceWatchers: this.getTotalPriceWatchers(),
        yieldMetrics: {
            ...this.yieldMetrics,
            uptime: process.uptime()
        }
    };
}

isUserConnected(userId) {
    return this.connectedUsers.has(userId);
}

getHotelConnectedUsers(hotelId) {
    const socketIds = this.receptionistSockets.get(hotelId) || new Set();
    const userIds = [];
    
    for (const [userId, socketId] of this.connectedUsers.entries()) {
        if (socketIds.has(socketId)) {
            userIds.push(userId);
        }
    }
    
    return userIds;
}

getYieldHealthStatus() {
    return {
        enabled: true,
        subscribers: {
            pricing: this.getTotalPricingSubscribers(),
            demand: this.getTotalDemandSubscribers(),
            revenue: this.revenueSubscribers.size,
            yieldAdmins: this.yieldAdminSockets.size,
            priceWatchers: this.getTotalPriceWatchers()
        },
        metrics: this.yieldMetrics,
        lastActivity: this.yieldMetrics.lastYieldActivity,
        uptime: process.uptime(),
        status: 'operational'
    };
}

getLoyaltyHealthStatus() {
    return {
        enabled: true,
        subscribers: this.getLoyaltyConnectionStats(),
        metrics: this.loyaltyMetrics,
        lastActivity: this.loyaltyMetrics.lastLoyaltyActivity,
        queueSize: this.loyaltyNotificationQueue.length,
        cacheSize: this.loyaltyCache.size,
        systemHealth: this.getLoyaltySystemHealth(),
        uptime: process.uptime(),
        status: this.loyaltyMetrics.systemHealth
    };
}

resetYieldMetrics() {
    this.yieldMetrics = {
        priceUpdatesCount: 0,
        demandAlertsCount: 0,
        revenueOptimizationsCount: 0,
        lastYieldActivity: null
    };
    
    logger.info('Yield metrics reset');
}

resetLoyaltyMetrics() {
    this.loyaltyMetrics = {
        totalPointsIssued: 0,
        totalPointsRedeemed: 0,
        totalTierUpgrades: 0,
        totalTransactions: 0,
        activeCampaigns: 0,
        dailyActivity: {
            pointsEarned: 0,
            pointsRedeemed: 0,
            tierUpgrades: 0,
            newMembers: 0,
            redemptions: 0
        },
        lastLoyaltyActivity: null,
        systemHealth: 'operational'
    };
    
    logger.info('Loyalty metrics reset');
}

/**
 * Enhanced graceful shutdown with full cleanup
 */
shutdown() {
    if (this.io) {
        // Send shutdown notification to all admin types
        this.io.to('yield-admin').emit('system-shutdown', {
            message: 'Yield management system shutting down',
            timestamp: new Date(),
            reconnectIn: '30 seconds'
        });

        this.io.to('loyalty-admin').emit('system-shutdown', {
            message: 'Loyalty system shutting down',
            timestamp: new Date(),
            finalMetrics: this.loyaltyMetrics
        });

        this.io.to('qr-admin').emit('system-shutdown', {
            message: 'QR system shutting down',
            timestamp: new Date(),
            activeQRs: this.activeQRCodes.size
        });

        this.io.to('cache-admin').emit('system-shutdown', {
            message: 'Cache monitoring shutting down',
            timestamp: new Date(),
            finalMetrics: this.cacheMetrics
        });

        // Send notifications to all pricing subscribers
        for (const hotelId of this.pricingSubscribers.keys()) {
            this.io.to(`pricing-${hotelId}`).emit('pricing-service-offline', {
                message: 'Pricing updates temporarily unavailable',
                timestamp: new Date()
            });
        }

        this.io.to('loyalty-updates').emit('loyalty-system-shutdown', {
            message: 'Programme fidélité temporairement indisponible',
            timestamp: new Date(),
            reconnectIn: '30 seconds'
        });

        this.io.to('qr-updates').emit('qr-system-shutdown', {
            message: 'Système QR temporairement indisponible',
            timestamp: new Date(),
            reconnectIn: '30 seconds'
        });

        this.io.to('cache-monitoring').emit('cache-system-shutdown', {
            message: 'Monitoring cache temporairement indisponible',
            timestamp: new Date(),
            reconnectIn: '30 seconds'
        });

        this.io.close();
        logger.info('Socket service with full real-time capabilities shutdown completed');
    }

    // Clear all data structures
    this.pricingSubscribers.clear();
    this.yieldAdminSockets.clear();
    this.demandSubscribers.clear();
    this.revenueSubscribers.clear();
    this.priceAlertSubscribers.clear();
    this.customerPriceWatchers.clear();

    this.loyaltySubscribers.clear();
    this.loyaltyAdminSockets.clear();
    this.tierUpgradeSubscribers.clear();
    this.pointsExpirySubscribers.clear();
    this.campaignSubscribers.clear();
    this.userLoyaltyRooms.clear();
    this.loyaltyCache.clear();
    this.loyaltyNotificationQueue.length = 0;

    this.qrSubscribers.clear();
    this.qrAdminSockets.clear();
    this.hotelQRSubscribers.clear();
    this.qrCheckInSessions.clear();
    this.activeQRCodes.clear();

    this.cacheSubscribers.clear();
    this.cacheAdminSockets.clear();
    this.performanceMonitors.clear();
    this.hotelCacheSubscribers.clear();
}

// ================================
// PUBLIC INTERFACES FOR EXTERNAL INTEGRATION
// ================================

/**
 * Interface publique pour QR notifications
 */
notifyQRGenerated(qrData) {
    return this.broadcastQREvent('QR_CODE_GENERATED', qrData);
}

notifyQRScanned(qrData) {
    return this.broadcastQREvent('QR_CODE_SCANNED', qrData);
}

notifyQRCheckIn(checkInData) {
    return this.broadcastQREvent('QR_CHECKIN_COMPLETED', checkInData);
}

/**
 * Interface publique pour cache notifications
 */
notifyCacheInvalidated(cacheData) {
    return this.broadcastCacheEvent('CACHE_INVALIDATED', cacheData);
}

notifyCachePerformance(performanceData) {
    return this.broadcastCacheEvent('CACHE_PERFORMANCE_UPDATE', performanceData);
}

notifyRedisStatus(statusData) {
    return this.broadcastCacheEvent('REDIS_STATUS_UPDATE', statusData);
}

/**
 * Interface publique pour loyalty notifications (CONSERVÉ)
 */
notifyPointsEarned(userId, pointsData) {
    return this.sendPointsEarnedNotification(userId, pointsData);
}

notifyTierUpgrade(userId, upgradeData) {
    return this.sendTierUpgradeNotification(userId, upgradeData);
}

broadcastCampaign(campaignId, campaignData) {
    return this.broadcastCampaignNotification(campaignId, campaignData);
}

/**
 * Obtenir statistiques complètes pour monitoring
 */
getComprehensiveStats() {
    return {
        connections: this.getConnectionStats(),
        health: this.getSystemHealthStatus(),
        yield: this.getYieldHealthStatus(),
        loyalty: this.getLoyaltyHealthStatus(),
        qr: this.getQRHealthStatus(),
        cache: this.getCacheHealthStatus(),
        timestamp: new Date(),
        uptime: process.uptime()
    };
}
}
// Create singleton instance
const socketService = new SocketService();
module.exports = socketService;