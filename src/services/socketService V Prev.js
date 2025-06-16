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
        // NOUVEAU : LOYALTY PROGRAM MAPS
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
        
        logger.info('Socket.io server initialized successfully with Yield Management and Loyalty Program support');
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

                // NOUVEAU : Données loyalty
                socket.loyaltyTier = user.loyalty?.tier || 'BRONZE';
                socket.loyaltyPoints = user.loyalty?.currentPoints || 0;
                socket.isLoyaltyMember = !!user.loyalty?.enrolledAt;

                next();
            } catch (error) {
                logger.error('Socket authentication error:', error);
                next(new Error('Invalid authentication token'));
            }
        });
    }

    /**
     * Setup Socket.io event handlers with Yield Management AND Loyalty events
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
            // YIELD MANAGEMENT SPECIFIC EVENTS (CONSERVÉ)
            // ================================
            
            // Price Broadcasting & Monitoring (CONSERVÉ)
            socket.on('join-pricing-room', (data) => this.joinPricingRoom(socket, data));
            socket.on('leave-pricing-room', (hotelId) => this.leavePricingRoom(socket, hotelId));
            socket.on('subscribe-price-alerts', (data) => this.subscribePriceAlerts(socket, data));
            socket.on('unsubscribe-price-alerts', (data) => this.unsubscribePriceAlerts(socket, data));
            
            // Demand Analysis Subscriptions (CONSERVÉ)
            socket.on('join-demand-monitoring', (hotelId) => this.joinDemandMonitoring(socket, hotelId));
            socket.on('leave-demand-monitoring', (hotelId) => this.leaveDemandMonitoring(socket, hotelId));
            
            // Revenue Monitoring (CONSERVÉ)
            socket.on('join-revenue-monitoring', () => this.joinRevenueMonitoring(socket));
            socket.on('leave-revenue-monitoring', () => this.leaveRevenueMonitoring(socket));
            
            // Yield Admin Dashboard (CONSERVÉ)
            socket.on('join-yield-admin', () => this.joinYieldAdmin(socket));
            socket.on('leave-yield-admin', () => this.leaveYieldAdmin(socket));
            
            // Customer Price Watching (CONSERVÉ)
            socket.on('watch-hotel-prices', (data) => this.watchHotelPrices(socket, data));
            socket.on('unwatch-hotel-prices', (data) => this.unwatchHotelPrices(socket, data));
            
            // Yield Action Events (CONSERVÉ)
            socket.on('trigger-price-update', (data) => this.handleTriggerPriceUpdate(socket, data));
            socket.on('request-yield-analysis', (data) => this.handleYieldAnalysisRequest(socket, data));

            // ================================
            // NOUVEAU : LOYALTY PROGRAM EVENTS
            // ================================
            
            // Abonnements loyalty généraux
            socket.on('join-loyalty-updates', (preferences) => this.joinLoyaltyUpdates(socket, preferences));
            socket.on('leave-loyalty-updates', () => this.leaveLoyaltyUpdates(socket));
            
            // Surveillance niveau et progression
            socket.on('subscribe-tier-updates', (preferences) => this.subscribeTierUpdates(socket, preferences));
            socket.on('unsubscribe-tier-updates', () => this.unsubscribeTierUpdates(socket));
            
            // Alertes expiration points
            socket.on('subscribe-expiry-alerts', (preferences) => this.subscribeExpiryAlerts(socket, preferences));
            socket.on('unsubscribe-expiry-alerts', () => this.unsubscribeExpiryAlerts(socket));
            
            // Campagnes et promotions
            socket.on('join-campaign', (campaignId) => this.joinCampaign(socket, campaignId));
            socket.on('leave-campaign', (campaignId) => this.leaveCampaign(socket, campaignId));
            socket.on('subscribe-promotion-alerts', (filters) => this.subscribePromotionAlerts(socket, filters));
            
            // Dashboard admin loyalty
            socket.on('join-loyalty-admin', () => this.joinLoyaltyAdmin(socket));
            socket.on('leave-loyalty-admin', () => this.leaveLoyaltyAdmin(socket));
            
            // Actions loyalty en temps réel
            socket.on('request-loyalty-status', () => this.handleLoyaltyStatusRequest(socket));
            socket.on('trigger-points-calculation', (bookingId) => this.handlePointsCalculationTrigger(socket, bookingId));
            socket.on('request-redemption-options', (criteria) => this.handleRedemptionOptionsRequest(socket, criteria));
            
            // Notifications loyalty personnalisées
            socket.on('set-loyalty-preferences', (preferences) => this.setLoyaltyPreferences(socket, preferences));
            socket.on('request-loyalty-insights', (period) => this.handleLoyaltyInsightsRequest(socket, period));
            
            // Multi-hotel loyalty tracking
            socket.on('join-chain-loyalty', (chainId) => this.joinChainLoyalty(socket, chainId));
            socket.on('track-cross-hotel-activity', (hotelIds) => this.trackCrossHotelActivity(socket, hotelIds));
            
            // Disconnect handler
            socket.on('disconnect', () => this.handleDisconnection(socket));
        });
    }

    /**
     * Handle new socket connection with yield management AND loyalty setup
     * @param {Object} socket - Socket instance
     */
    handleConnection(socket) {
        const { userId, user, userRole, hotelId, loyaltyTier, loyaltyPoints, isLoyaltyMember } = socket;
        
        // Store connection mapping
        this.connectedUsers.set(userId, socket.id);
        this.userRooms.set(socket.id, []);

        // Join role-specific rooms
        switch (userRole) {
            case 'ADMIN':
                this.adminSockets.add(socket.id);
                socket.join('admins');
                
                // Auto-join yield admin features for admins (CONSERVÉ)
                this.yieldAdminSockets.add(socket.id);
                socket.join('yield-admin');
                socket.join('revenue-monitoring');
                
                // NOUVEAU : Auto-join loyalty admin features
                this.loyaltyAdminSockets.add(socket.id);
                socket.join('loyalty-admin');
                socket.join('loyalty-dashboard');
                break;
                
            case 'RECEPTIONIST':
                if (hotelId) {
                    if (!this.receptionistSockets.has(hotelId)) {
                        this.receptionistSockets.set(hotelId, new Set());
                    }
                    this.receptionistSockets.get(hotelId).add(socket.id);
                    socket.join(`hotel-${hotelId}`);
                    socket.join('receptionists');
                    
                    // Auto-join pricing room for their hotel (CONSERVÉ)
                    socket.join(`pricing-${hotelId}`);
                    if (!this.pricingSubscribers.has(hotelId)) {
                        this.pricingSubscribers.set(hotelId, new Set());
                    }
                    this.pricingSubscribers.get(hotelId).add(socket.id);
                    
                    // NOUVEAU : Auto-join loyalty notifications pour leur hôtel
                    socket.join(`loyalty-hotel-${hotelId}`);
                }
                break;
                
            case 'CLIENT':
                socket.join('clients');
                socket.join(`user-${userId}`);
                
                // NOUVEAU : Auto-join loyalty si membre
                if (isLoyaltyMember) {
                    socket.join('loyalty-members');
                    socket.join(`loyalty-tier-${loyaltyTier}`);
                    this.loyaltySubscribers.add(socket.id);
                    
                    // Joindre room tier-specific
                    this.joinTierSpecificRoom(socket, loyaltyTier);
                }
                break;
        }

        // NOUVEAU : Setup loyalty context
        if (isLoyaltyMember) {
            this.setupLoyaltyContext(socket, user);
        }

        // Send welcome message with yield management AND loyalty capabilities
        socket.emit('connected', {
            message: 'Connected to hotel management system with Yield Management and Loyalty Program',
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
                }
            },
            loyaltyStatus: isLoyaltyMember ? {
                tier: loyaltyTier,
                points: loyaltyPoints,
                tierDisplay: this.getTierDisplayName(loyaltyTier),
                nextTierThreshold: this.getNextTierThreshold(loyaltyTier)
            } : null,
            timestamp: new Date()
        });

        logger.info(`User ${userId} (${userRole}) connected via socket ${socket.id} with yield + loyalty features`);
    }

    /**
     * Handle socket disconnection with yield AND loyalty cleanup
     * @param {Object} socket - Socket instance
     */
    handleDisconnection(socket) {
        const { userId, userRole, hotelId } = socket;

        // Clean up standard mappings (CONSERVÉ)
        this.connectedUsers.delete(userId);
        this.userRooms.delete(socket.id);
        this.adminSockets.delete(socket.id);

        if (hotelId && this.receptionistSockets.has(hotelId)) {
            this.receptionistSockets.get(hotelId).delete(socket.id);
            if (this.receptionistSockets.get(hotelId).size === 0) {
                this.receptionistSockets.delete(hotelId);
            }
        }

        // ================================
        // YIELD MANAGEMENT CLEANUP (CONSERVÉ)
        // ================================
        
        // Clean up yield admin subscriptions
        this.yieldAdminSockets.delete(socket.id);
        this.revenueSubscribers.delete(socket.id);
        
        // Clean up pricing subscriptions
        for (const [hotelId, subscribers] of this.pricingSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.pricingSubscribers.delete(hotelId);
            }
        }
        
        // Clean up demand subscriptions
        for (const [hotelId, subscribers] of this.demandSubscribers) {
            subscribers.delete(socket.id);
            if (subscribers.size === 0) {
                this.demandSubscribers.delete(hotelId);
            }
        }
        
        // Clean up price alert subscriptions
        if (this.priceAlertSubscribers.has(userId)) {
            this.priceAlertSubscribers.delete(userId);
        }
        
        // Clean up customer price watchers
        for (const [hotelId, watchers] of this.customerPriceWatchers) {
            watchers.delete(userId);
            if (watchers.size === 0) {
                this.customerPriceWatchers.delete(hotelId);
            }
        }

        // ================================
        // NOUVEAU : LOYALTY CLEANUP
        // ================================
        
        // Clean up loyalty subscriptions
        this.loyaltySubscribers.delete(socket.id);
        this.loyaltyAdminSockets.delete(socket.id);
        
        // Clean up tier upgrade subscriptions
        this.tierUpgradeSubscribers.delete(userId);
        this.pointsExpirySubscribers.delete(userId);
        
        // Clean up campaign subscriptions
        for (const [campaignId, subscribers] of this.campaignSubscribers) {
            subscribers.delete(userId);
            if (subscribers.size === 0) {
                this.campaignSubscribers.delete(campaignId);
            }
        }
        
        // Clean up loyalty room subscriptions
        this.userLoyaltyRooms.delete(userId);

        logger.info(`User ${userId} (${userRole}) disconnected from socket ${socket.id} - yield + loyalty subscriptions cleaned`);
    }

    // ================================
    // EXISTING STANDARD METHODS (keeping all original functionality) - CONSERVÉ
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
    // YIELD MANAGEMENT SPECIALIZED METHODS (CONSERVÉ INTÉGRALEMENT)
    // ================================

    /**
     * 💰 PRICE BROADCASTING SYSTEM (CONSERVÉ)
     */

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

    /**
     * 📈 DEMAND ANALYSIS & SURGE ALERTS (CONSERVÉ)
     */

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

    /**
     * 💹 REVENUE OPTIMIZATION & MONITORING (CONSERVÉ)
     */

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

    /**
     * 🎛️ YIELD ADMIN DASHBOARD (CONSERVÉ)
     */

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
        socket.join('yield-admin');
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

    sendYieldDashboardUpdateToAdmin(adminId, yieldData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(adminId);
        if (!socketId) {
            logger.warn(`Admin ${adminId} not connected for yield dashboard update`);
            return false;
        }

        const update = {
            type: 'yield_dashboard_personal',
            adminId,
            timestamp: new Date(),
            ...yieldData
        };

        this.io.to(socketId).emit('yield-dashboard-update', update);
        logger.info(`Personal yield dashboard update sent to admin ${adminId}`);
        return true;
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

    broadcastYieldStats(yieldStats) {
        if (!this.io) return;

        const statsUpdate = {
            type: 'yield_stats',
            timestamp: new Date(),
            ...yieldStats,
            socketMetrics: this.getYieldConnectionStats()
        };

        this.io.to('yield-admin').emit('yield-stats', statsUpdate);
        this.io.to('revenue-monitoring').emit('yield-stats', statsUpdate);
        
        logger.info('Yield stats broadcast completed');
    }

    notifyYieldStrategyChange(hotelId, strategy) {
        if (!this.io) return;

        const notification = {
            type: 'yield_strategy_change',
            hotelId,
            timestamp: new Date(),
            ...strategy
        };

        this.io.to(`hotel-${hotelId}`).emit('yield-strategy-changed', notification);
        this.io.to(`pricing-${hotelId}`).emit('yield-strategy-changed', notification);
        this.io.to('yield-admin').emit('yield-strategy-changed', notification);
        
        logger.info(`Yield strategy change notification sent for hotel ${hotelId}: ${strategy.strategyType}`);
    }

    /**
     * 👥 CUSTOMER PRICE WATCHING SYSTEM (CONSERVÉ)
     */

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

    notifyPriceDrop(userId, hotelId, roomType, priceData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            logger.warn(`User ${userId} not connected for price drop notification`);
            return false;
        }

        const notification = {
            type: 'price_drop',
            userId,
            hotelId,
            roomType,
            timestamp: new Date(),
            ...priceData
        };

        this.io.to(socketId).emit('price-drop-alert', notification);
        
        if (this.customerPriceWatchers.has(hotelId) && 
            this.customerPriceWatchers.get(hotelId).has(userId)) {
            const watcher = this.customerPriceWatchers.get(hotelId).get(userId);
            watcher.alertsReceived++;
        }

        logger.info(`Price drop notification sent to user ${userId} for hotel ${hotelId}, room ${roomType}`);
        return true;
    }

    sendPriceIncrease(userId, bookingId, priceChange) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            logger.warn(`User ${userId} not connected for price increase notification`);
            return false;
        }

        const notification = {
            type: 'price_increase',
            userId,
            bookingId,
            timestamp: new Date(),
            ...priceChange
        };

        this.io.to(socketId).emit('price-increase-notification', notification);
        logger.info(`Price increase notification sent to user ${userId} for booking ${bookingId}`);
        return true;
    }

    broadcastPromotionalPricing(hotelId, promotions) {
        if (!this.io) return;

        const promotion = {
            type: 'promotional_pricing',
            hotelId,
            timestamp: new Date(),
            ...promotions
        };

        this.io.to(`pricing-${hotelId}`).emit('promotional-pricing', promotion);
        
        if (this.customerPriceWatchers.has(hotelId)) {
            const watchers = this.customerPriceWatchers.get(hotelId);
            watchers.forEach((watchData, userId) => {
                const socketId = this.connectedUsers.get(userId);
                if (socketId) {
                    this.io.to(socketId).emit('promotional-pricing', {
                        ...promotion,
                        personalAlert: true,
                        watchedRoomTypes: watchData.roomTypes
                    });
                }
            });
        }

        logger.info(`Promotional pricing broadcast for hotel ${hotelId}: ${promotions.promotionType}`);
    }

    /**
     * 🎮 YIELD ACTION HANDLERS (CONSERVÉ)
     */

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
    // NOUVEAU : LOYALTY PROGRAM SPECIALIZED METHODS
    // ================================

    /**
     * Initialiser le système loyalty
     */
    initializeLoyaltySystem() {
        // Reset daily metrics at midnight
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const msUntilMidnight = tomorrow.getTime() - now.getTime();
        
        setTimeout(() => {
            this.resetDailyLoyaltyMetrics();
            // Set daily reset interval
            setInterval(() => this.resetDailyLoyaltyMetrics(), 24 * 60 * 60 * 1000);
        }, msUntilMidnight);
        
        // Start loyalty notification batch processing
        this.startLoyaltyBatchProcessing();
        
        logger.info('Loyalty system initialized with daily metrics reset and batch processing');
    }

    /**
     * Setup loyalty context pour un socket connecté
     */
    async setupLoyaltyContext(socket, user) {
        try {
            // Obtenir les alertes actives
            const activeAlerts = await this.getActiveLoyaltyAlerts(user._id);
            
            // Setup tier-specific subscriptions
            this.setupTierSpecificSubscriptions(socket, user.loyalty.tier);
            
            // Envoyer contexte initial
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

    /**
     * 🎯 ABONNEMENTS LOYALTY GÉNÉRAUX
     */

    joinLoyaltyUpdates(socket, preferences = {}) {
        if (!socket.isLoyaltyMember) {
            socket.emit('error', { message: 'Loyalty membership required' });
            return;
        }

        this.loyaltySubscribers.add(socket.id);
        socket.join('loyalty-updates');
        
        // Store preferences
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

    /**
     * 🏆 SURVEILLANCE NIVEAU ET PROGRESSION
     */

    subscribeTierUpdates(socket, preferences = {}) {
        if (!socket.isLoyaltyMember) {
            socket.emit('error', { message: 'Loyalty membership required' });
            return;
        }

        const userId = socket.userId;
        this.tierUpgradeSubscribers.set(userId, {
            realTimeNotifications: preferences.realTimeNotifications !== false,
            progressAlerts: preferences.progressAlerts || [75, 90, 95], // Pourcentages
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

    /**
     * ⏰ ALERTES EXPIRATION POINTS
     */

    subscribeExpiryAlerts(socket, preferences = {}) {
        if (!socket.isLoyaltyMember) {
            socket.emit('error', { message: 'Loyalty membership required' });
            return;
        }

        const userId = socket.userId;
        this.pointsExpirySubscribers.set(userId, {
            warningDays: preferences.warningDays || [90, 30, 7], // Jours avant expiration
            minimumPoints: preferences.minimumPoints || 100, // Seuil minimum pour alerte
            urgentThreshold: preferences.urgentThreshold || 7, // Jours = urgent
            autoRedemptionSuggestions: preferences.autoRedemptionSuggestions !== false,
            subscribedAt: new Date()
        });

        socket.join('expiry-alerts');
        socket.emit('expiry-alerts-subscribed', {
            preferences,
            currentPoints: socket.loyaltyPoints,
            message: 'Alerts activées pour expiration des points'
        });

        // Envoyer immédiatement status si points expirent bientôt
        this.checkImmediateExpiryAlert(userId);

        logger.info(`User ${userId} subscribed to expiry alerts`);
    }

    unsubscribeExpiryAlerts(socket) {
        this.pointsExpirySubscribers.delete(socket.userId);
        socket.leave('expiry-alerts');
        
        socket.emit('expiry-alerts-unsubscribed');
    }

    /**
     * 🎪 CAMPAGNES ET PROMOTIONS
     */

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
        
        // Store filters for targeted notifications
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

    /**
     * 📊 DASHBOARD ADMIN LOYALTY
     */

    joinLoyaltyAdmin(socket) {
        if (socket.userRole !== 'ADMIN') {
            socket.emit('error', { message: 'Admin access required for loyalty dashboard' });
            return;
        }

        this.loyaltyAdminSockets.add(socket.id);
        socket.join('loyalty-admin');
        socket.join('loyalty-dashboard');

        // Send initial dashboard data
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

    /**
     * 🎯 ACTIONS LOYALTY TEMPS RÉEL
     */

    handleLoyaltyStatusRequest(socket) {
        if (!socket.isLoyaltyMember) {
            socket.emit('loyalty-status-error', { message: 'Not a loyalty member' });
            return;
        }

        // Get cached or fetch fresh status
        const userId = socket.userId;
        const cacheKey = `loyalty_status_${userId}`;
        let status = this.getLoyaltyCache(cacheKey);

        if (!status) {
            // Would trigger async status fetch
            socket.emit('loyalty-status-fetching', {
                message: 'Fetching latest loyalty status...'
            });
            
            // Simulate async fetch (in real implementation, call loyalty service)
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

        // Trigger points calculation (in real implementation, call loyalty service)
        socket.emit('points-calculation-started', {
            bookingId,
            estimatedCompletion: '10-30 seconds',
            tier: socket.loyaltyTier,
            multiplier: this.getTierMultiplier(socket.loyaltyTier)
        });

        // Notify loyalty admins of manual calculation
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

    /**
     * 🔧 PRÉFÉRENCES LOYALTY
     */

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

        // Update subscriptions based on preferences
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

        // Generate insights (in real implementation, call analytics service)
        const insights = this.generateLoyaltyInsights(socket.userId, period);
        
        socket.emit('loyalty-insights-generated', {
            period,
            insights,
            tier: socket.loyaltyTier,
            generatedAt: new Date()
        });
    }

    /**
     * 🏨 MULTI-HOTEL LOYALTY TRACKING
     */

    joinChainLoyalty(socket, chainId) {
        if (!socket.isLoyaltyMember) {
            socket.emit('error', { message: 'Loyalty membership required' });
            return;
        }

        // Only Gold+ members can track chain-wide activity
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
    // NOTIFICATIONS LOYALTY TEMPS RÉEL
    // ================================

    /**
     * 🎉 NOTIFICATION ATTRIBUTION POINTS
     */
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

        // Envoyer notification principale
        this.io.to(socketId).emit('loyalty-points-earned', notification);

        // Notification visuelle si gros gain
        if (pointsData.amount >= 1000) {
            this.io.to(socketId).emit('loyalty-celebration', {
                type: 'big_points_earn',
                amount: pointsData.amount,
                animation: 'golden_shower',
                duration: 3000
            });
        }

        // Mettre à jour métriques temps réel
        this.loyaltyMetrics.dailyActivity.pointsEarned += pointsData.amount;
        this.loyaltyMetrics.totalPointsIssued += pointsData.amount;
        this.loyaltyMetrics.lastLoyaltyActivity = new Date();

        // Notifier dashboard admin
        this.broadcastLoyaltyAdminUpdate('points_earned', {
            userId,
            amount: pointsData.amount,
            booking: pointsData.booking,
            tier: pointsData.tier
        });

        logger.info(`Points earned notification sent to user ${userId}: ${pointsData.amount} points`);
        return true;
    }

    /**
     * 🏆 NOTIFICATION UPGRADE NIVEAU
     */
    sendTierUpgradeNotification(userId, upgradeData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            this.queueLoyaltyNotification('tier_upgrade', userId, upgradeData);
            return false;
        }

        const { oldTier, newTier, bonusPoints, newBenefits } = upgradeData;

        // Notification principale avec célébration
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

        // Animation de célébration selon le niveau
        const celebrationAnimation = this.getTierCelebrationAnimation(newTier);
        this.io.to(socketId).emit('loyalty-celebration', {
            type: 'tier_upgrade',
            animation: celebrationAnimation.animation,
            duration: celebrationAnimation.duration,
            sound: celebrationAnimation.sound,
            message: `Félicitations ! Vous êtes maintenant ${this.getTierDisplayName(newTier)} !`
        });

        // Badge achievement unlock
        this.io.to(socketId).emit('achievement-unlocked', {
            achievementId: `tier_${newTier.toLowerCase()}`,
            title: `Niveau ${this.getTierDisplayName(newTier)}`,
            description: `Vous avez atteint le niveau ${this.getTierDisplayName(newTier)}`,
            rarity: this.getTierRarity(newTier),
            icon: this.getTierIcon(newTier),
            rewards: newBenefits
        });

        // Mettre à jour room tier
        this.io.to(socketId).leave(`loyalty-tier-${oldTier}`);
        this.io.to(socketId).join(`loyalty-tier-${newTier}`);

        // Mettre à jour métriques
        this.loyaltyMetrics.dailyActivity.tierUpgrades++;
        this.loyaltyMetrics.totalTierUpgrades++;
        this.loyaltyMetrics.lastLoyaltyActivity = new Date();

        // Notifier autres membres du même niveau (encouragement)
        this.io.to(`loyalty-tier-${newTier}`).emit('tier-community-welcome', {
            newMember: userId,
            tier: newTier,
            message: `Un nouveau membre a rejoint le niveau ${this.getTierDisplayName(newTier)} !`
        });

        // Notifier dashboard admin
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

    /**
     * ⏰ ALERTES EXPIRATION POINTS
     */
    sendPointsExpiryAlert(userId, expiryData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            this.queueLoyaltyNotification('points_expiry', userId, expiryData);
            return false;
        }

        const { pointsExpiring, daysUntilExpiry, redemptionSuggestions, urgency } = expiryData;

        // Notification d'alerte
        this.io.to(socketId).emit('loyalty-points-expiry-alert', {
            type: 'points_expiry_warning',
            pointsExpiring,
            daysUntilExpiry,
            urgency, // 'low', 'medium', 'high', 'critical'
            redemptionSuggestions,
            estimatedValue: Math.round((pointsExpiring / 100) * 100) / 100,
            message: this.getExpiryMessage(daysUntilExpiry, pointsExpiring),
            timestamp: new Date()
        });

        // Notification push urgente si critique
        if (urgency === 'critical') {
            this.io.to(socketId).emit('loyalty-urgent-alert', {
                type: 'critical_expiry',
                title: '⚠️ Points expirent demain !',
                message: `${pointsExpiring} points expirent dans ${daysUntilExpiry} jour(s)`,
                action: 'Utiliser mes points',
                priority: 'high'
            });
        }

        logger.info(`Points expiry alert sent to user ${userId}: ${pointsExpiring} points in ${daysUntilExpiry} days`);
        return true;
    }

    /**
     * 💰 NOTIFICATION UTILISATION POINTS
     */
    sendPointsRedeemedNotification(userId, redemptionData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            this.queueLoyaltyNotification('points_redeemed', userId, redemptionData);
            return false;
        }

        const { pointsUsed, benefit, value, remainingPoints, type } = redemptionData;

        // Notification principale
        this.io.to(socketId).emit('loyalty-points-redeemed', {
            type: 'points_redeemed',
            pointsUsed,
            benefit,
            value,
            remainingPoints,
            redemptionType: type,
            success: true,
            message: `${pointsUsed} points utilisés pour ${benefit}`,
            timestamp: new Date()
        });

        // Animation de succès
        this.io.to(socketId).emit('loyalty-success-animation', {
            type: 'redemption_success',
            benefit,
            value,
            animation: 'points_flow_out',
            duration: 2000
        });

        // Mettre à jour métriques
        this.loyaltyMetrics.dailyActivity.pointsRedeemed += pointsUsed;
        this.loyaltyMetrics.dailyActivity.redemptions++;
        this.loyaltyMetrics.totalPointsRedeemed += pointsUsed;
        this.loyaltyMetrics.lastLoyaltyActivity = new Date();

        // Notifier dashboard admin
        this.broadcastLoyaltyAdminUpdate('points_redeemed', {
            userId,
            pointsUsed,
            benefit,
            value,
            type
        });

        logger.info(`Points redeemed notification sent to user ${userId}: ${pointsUsed} points for ${benefit}`);
        return true;
    }

    /**
     * 🎪 NOTIFICATIONS CAMPAGNES
     */
    broadcastCampaignNotification(campaignId, campaignData) {
        if (!this.io) return;

        const { name, type, value, eligibleTiers, hotelIds, message } = campaignData;

        // Broadcast to campaign subscribers
        this.io.to(`campaign-${campaignId}`).emit('campaign-update', {
            campaignId,
            name,
            type,
            value,
            message,
            timestamp: new Date()
        });

        // Send to eligible tier rooms
        eligibleTiers.forEach(tier => {
            this.io.to(`loyalty-tier-${tier}`).emit('campaign-opportunity', {
                campaignId,
                name,
                type,
                value,
                tier,
                personalizedMessage: this.getPersonalizedCampaignMessage(tier, campaignData),
                action: 'Voir la campagne'
            });
        });

        // Send to specific hotels if targeted
        if (hotelIds && hotelIds.length > 0) {
            hotelIds.forEach(hotelId => {
                this.io.to(`loyalty-hotel-${hotelId}`).emit('hotel-campaign-notification', {
                    campaignId,
                    hotelId,
                    name,
                    type,
                    value,
                    message
                });
            });
        }

        // Notify loyalty admins
        this.io.to('loyalty-admin').emit('campaign-broadcast-completed', {
            campaignId,
            name,
            eligibleTiers,
            hotelIds,
            broadcastAt: new Date()
        });

        this.loyaltyMetrics.activeCampaigns++;
        logger.info(`Campaign notification broadcast for ${campaignId}: ${name}`);
    }

    sendPersonalizedPromotion(userId, promotionData) {
        if (!this.io) return;

        const socketId = this.connectedUsers.get(userId);
        if (!socketId) {
            this.queueLoyaltyNotification('personalized_promotion', userId, promotionData);
            return false;
        }

        const { title, description, value, validUntil, personalizedReason, tier } = promotionData;

        this.io.to(socketId).emit('loyalty-personalized-promotion', {
            type: 'personalized_promotion',
            title,
            description,
            value,
            validUntil,
            personalizedReason,
            tier,
            exclusive: true,
            message: `Offre exclusive pour les membres ${this.getTierDisplayName(tier)}`,
            timestamp: new Date()
        });

        // Notification avec animation spéciale pour les membres VIP
        if (['PLATINUM', 'DIAMOND'].includes(tier)) {
            this.io.to(socketId).emit('vip-promotion-alert', {
                title,
                value,
                animation: 'vip_glow',
                sound: 'vip_chime',
                duration: 4000
            });
        }

        logger.info(`Personalized promotion sent to user ${userId}: ${title}`);
        return true;
    }

    /**
     * 📊 DASHBOARD ADMIN TEMPS RÉEL
     */
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

    broadcastLoyaltySystemAlert(alertType, alertData) {
        if (!this.io) return;

        const alert = {
            type: 'loyalty_system_alert',
            alertType,
            severity: alertData.severity || 'medium',
            message: alertData.message,
            data: alertData,
            timestamp: new Date(),
            autoResolve: alertData.autoResolve || false
        };

        // Send to loyalty admins
        this.io.to('loyalty-admin').emit('loyalty-system-alert', alert);

        // Send critical alerts to all admins
        if (alertData.severity === 'critical') {
            this.io.to('admins').emit('critical-loyalty-alert', alert);
        }

        logger.warn(`Loyalty system alert: ${alertType} - ${alertData.message}`);
    }

    // ================================
    // EXISTING PUBLIC METHODS (keeping all original functionality) - CONSERVÉ
    // ================================

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
        logger.info(`User notification sent: ${eventType} to user ${userId}`);
        return true;
    }

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
        }

        this.io.to('admins').emit('booking-update', notification);

        logger.info(`Booking notification sent: ${eventType} for booking ${bookingId}`);
    }

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
        logger.info(`Hotel notification sent: ${eventType} for hotel ${hotelId}`);
    }

    sendAdminNotification(eventType, data) {
        if (!this.io) return;

        const notification = {
            type: 'admin',
            eventType,
            data,
            timestamp: new Date()
        };

        this.io.to('admins').emit('admin-notification', notification);
        logger.info(`Admin notification sent: ${eventType}`);
    }

    broadcastAvailabilityUpdate(hotelId, availabilityData) {
        if (!this.io) return;

        const update = {
            type: 'availability',
            hotelId,
            data: availabilityData,
            timestamp: new Date()
        };

        this.io.to(`hotel-${hotelId}`).emit('availability-update', update);
        this.io.to('clients').emit('availability-update', update);
    }

    // ================================
    // MÉTHODES UTILITAIRES LOYALTY
    // ================================

    /**
     * Setup tier-specific room subscriptions
     */
    joinTierSpecificRoom(socket, tier) {
        socket.join(`loyalty-tier-${tier}`);
        
        // Join tier group benefits
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
        // Auto-subscribe to relevant notifications based on tier
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
        // Update room memberships based on preferences
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

    /**
     * Get loyalty features based on tier
     */
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

    /**
     * Get next tier threshold
     */
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

    /**
     * Check campaign eligibility
     */
    checkCampaignEligibility(tier) {
        return {
            eligible: true,
            tier,
            bonusMultiplier: this.getTierMultiplier(tier),
            exclusiveAccess: ['PLATINUM', 'DIAMOND'].includes(tier)
        };
    }

    /**
     * Calculate redemption options
     */
    calculateRedemptionOptions(points, tier, criteria = {}) {
        const options = [];
        
        // Basic discount option
        if (points >= 100) {
            options.push({
                type: 'DISCOUNT',
                pointsRequired: 100,
                value: '1€ de réduction',
                available: true,
                maxPoints: Math.min(points, 5000)
            });
        }
        
        // Upgrade option
        if (points >= 1000) {
            options.push({
                type: 'UPGRADE',
                pointsRequired: 1000,
                value: 'Upgrade chambre',
                available: true,
                tierRequired: 'BRONZE'
            });
        }
        
        // Free night (Gold+)
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

    /**
     * Messages personnalisés
     */
    getExpiryMessage(days, points) {
        if (days <= 1) {
            return `⚠️ ${points} points expirent demain ! Utilisez-les maintenant.`;
        } else if (days <= 7) {
            return `⏰ ${points} points expirent dans ${days} jours. N'oubliez pas de les utiliser !`;
        } else if (days <= 30) {
            return `📅 ${points} points expirent dans ${days} jours. Planifiez leur utilisation.`;
        } else {
            return `ℹ️ ${points} points expirent dans ${days} jours.`;
        }
    }

    getPersonalizedCampaignMessage(tier, campaignData) {
        const tierMessages = {
            'BRONZE': `Découvrez ${campaignData.name} - parfait pour commencer !`,
            'SILVER': `${campaignData.name} avec votre bonus Argent !`,
            'GOLD': `Offre exclusive Or : ${campaignData.name}`,
            'PLATINUM': `VIP Access: ${campaignData.name} - Avantages Premium`,
            'DIAMOND': `Elite Exclusive: ${campaignData.name} - Réservé aux membres Diamant`
        };
        
        return tierMessages[tier] || campaignData.name;
    }

    /**
     * Analytics et métriques temps réel
     */
    async getActiveLoyaltyAlerts(userId) {
        const alerts = [];
        
        // Check expiry alerts
        if (this.pointsExpirySubscribers.has(userId)) {
            // In real implementation, query database for expiring points
            alerts.push({
                type: 'expiry_warning',
                severity: 'medium',
                message: 'Des points expirent bientôt'
            });
        }
        
        return alerts;
    }

    getTodayLoyaltyActivity(userId) {
        // In real implementation, fetch from database
        return {
            pointsEarned: 0,
            pointsRedeemed: 0,
            transactionCount: 0,
            lastActivity: null
        };
    }

    generateLoyaltyInsights(userId, period) {
        // Generate insights based on user activity
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
        
        // System health alerts
        if (this.loyaltyMetrics.systemHealth !== 'operational') {
            alerts.push({
                type: 'system_health',
                severity: 'warning',
                message: 'Loyalty system performance degraded'
            });
        }
        
        // High expiry volume alert
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
        // In real implementation, fetch from database
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
            errorRate: 0, // Would be calculated from error logs
            responseTime: 'normal'
        };
        
        // Determine overall status
        if (health.connectedUsers === 0) {
            health.status = 'warning';
        } else if (health.errorRate > 5) {
            health.status = 'degraded';
        } else {
            health.status = 'operational';
        }
        
        return health;
    }

    /**
     * Queue management pour notifications offline
     */
    queueLoyaltyNotification(type, userId, data) {
        this.loyaltyNotificationQueue.push({
            type,
            userId,
            data,
            queuedAt: new Date(),
            attempts: 0
        });
        
        // Start batch processing if not already running
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
            
            const batch = this.loyaltyNotificationQueue.splice(0, 10); // Process 10 at a time
            
            batch.forEach(notification => {
                const socketId = this.connectedUsers.get(notification.userId);
                if (socketId) {
                    // User is now online, send notification
                    this.sendQueuedLoyaltyNotification(socketId, notification);
                } else if (notification.attempts < 3) {
                    // Retry later
                    notification.attempts++;
                    this.loyaltyNotificationQueue.push(notification);
                }
                // Drop notification after 3 attempts
            });
            
            // Continue processing
            setTimeout(processBatch, 1000); // Process every second
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

    /**
     * Cache management pour données loyalty
     */
    setLoyaltyCache(key, data) {
        this.loyaltyCache.set(key, {
            data,
            timestamp: Date.now()
        });
        
        // Cleanup old cache entries
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

    /**
     * Vérification expiration immédiate
     */
    async checkImmediateExpiryAlert(userId) {
        try {
            // In real implementation, query LoyaltyTransaction model
            // const expiringPoints = await LoyaltyTransaction.find({
            //     user: userId,
            //     pointsAmount: { $gt: 0 },
            //     status: 'COMPLETED',
            //     expiresAt: { $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
            // });
            
            // Simulate immediate expiry check
            const hasExpiringPoints = Math.random() > 0.8; // 20% chance
            
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

    /**
     * Reset daily metrics
     */
    resetDailyLoyaltyMetrics() {
        this.loyaltyMetrics.dailyActivity = {
            pointsEarned: 0,
            pointsRedeemed: 0,
            tierUpgrades: 0,
            newMembers: 0,
            redemptions: 0
        };
        
        // Broadcast reset to admins
        this.io.to('loyalty-admin').emit('daily-metrics-reset', {
            date: new Date().toISOString().slice(0, 10),
            previousMetrics: { ...this.loyaltyMetrics.dailyActivity }
        });
        
        logger.info('Daily loyalty metrics reset');
    }

    // ================================
    // ENHANCED YIELD + LOYALTY STATISTICS
    // ================================

    /**
     * Get yield-specific connection statistics (CONSERVÉ)
     */
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

    /**
     * Get total pricing subscribers across all hotels (CONSERVÉ)
     */
    getTotalPricingSubscribers() {
        let total = 0;
        for (const subscribers of this.pricingSubscribers.values()) {
            total += subscribers.size;
        }
        return total;
    }

    /**
     * Get total demand subscribers across all hotels (CONSERVÉ)
     */
    getTotalDemandSubscribers() {
        let total = 0;
        for (const subscribers of this.demandSubscribers.values()) {
            total += subscribers.size;
        }
        return total;
    }

    /**
     * Get total price watchers across all hotels (CONSERVÉ)
     */
    getTotalPriceWatchers() {
        let total = 0;
        for (const watchers of this.customerPriceWatchers.values()) {
            total += watchers.size;
        }
        return total;
    }

    /**
     * Get enhanced connection statistics including yield management AND loyalty
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
            loyaltyProgram: this.getLoyaltyConnectionStats()
        };
    }

    /**
     * Check if user is connected (CONSERVÉ)
     */
    isUserConnected(userId) {
        return this.connectedUsers.has(userId);
    }

    /**
     * Get all connected users for a hotel (CONSERVÉ)
     */
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

    /**
     * Get yield management health status (CONSERVÉ)
     */
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

    /**
     * NOUVEAU : Get loyalty program health status
     */
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

    /**
     * Get combined system health status
     */
    getSystemHealthStatus() {
        return {
            overall: 'operational',
            components: {
                yield: this.getYieldHealthStatus(),
                loyalty: this.getLoyaltyHealthStatus(),
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
     * Reset yield metrics (for testing or maintenance) (CONSERVÉ)
     */
    resetYieldMetrics() {
        this.yieldMetrics = {
            priceUpdatesCount: 0,
            demandAlertsCount: 0,
            revenueOptimizationsCount: 0,
            lastYieldActivity: null
        };
        
        logger.info('Yield metrics reset');
    }

    /**
     * NOUVEAU : Reset loyalty metrics
     */
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
     * Enhanced graceful shutdown with yield AND loyalty cleanup
     */
    shutdown() {
        if (this.io) {
            // Send shutdown notification to yield admins (CONSERVÉ)
            this.io.to('yield-admin').emit('system-shutdown', {
                message: 'Yield management system shutting down',
                timestamp: new Date(),
                reconnectIn: '30 seconds'
            });

            // Send notification to all pricing subscribers (CONSERVÉ)
            for (const hotelId of this.pricingSubscribers.keys()) {
                this.io.to(`pricing-${hotelId}`).emit('pricing-service-offline', {
                    message: 'Pricing updates temporarily unavailable',
                    timestamp: new Date()
                });
            }

            // NOUVEAU : Send shutdown notification to loyalty users
            this.io.to('loyalty-updates').emit('loyalty-system-shutdown', {
                message: 'Programme fidélité temporairement indisponible',
                timestamp: new Date(),
                reconnectIn: '30 seconds'
            });

            // Send notification to loyalty admins
            this.io.to('loyalty-admin').emit('system-shutdown', {
                message: 'Loyalty system shutting down',
                timestamp: new Date(),
                finalMetrics: this.loyaltyMetrics
            });

            // Close all connections
            this.io.close();
            logger.info('Socket service with yield management and loyalty program shutdown completed');
        }

        // Clear all yield-specific data structures (CONSERVÉ)
        this.pricingSubscribers.clear();
        this.yieldAdminSockets.clear();
        this.demandSubscribers.clear();
        this.revenueSubscribers.clear();
        this.priceAlertSubscribers.clear();
        this.customerPriceWatchers.clear();

        // NOUVEAU : Clear all loyalty-specific data structures
        this.loyaltySubscribers.clear();
        this.loyaltyAdminSockets.clear();
        this.tierUpgradeSubscribers.clear();
        this.pointsExpirySubscribers.clear();
        this.campaignSubscribers.clear();
        this.userLoyaltyRooms.clear();
        this.loyaltyCache.clear();
        this.loyaltyNotificationQueue.length = 0;
    }

    // ================================
    // MÉTHODES PUBLIQUES POUR INTÉGRATION LOYALTY
    // ================================

    /**
     * Interface publique pour attribution de points
     */
    notifyPointsEarned(userId, pointsData) {
        return this.sendPointsEarnedNotification(userId, pointsData);
    }

    /**
     * Interface publique pour upgrade de niveau
     */
    notifyTierUpgrade(userId, upgradeData) {
        return this.sendTierUpgradeNotification(userId, upgradeData);
    }

    /**
     * Interface publique pour expiration de points
     */
    notifyPointsExpiry(userId, expiryData) {
        return this.sendPointsExpiryAlert(userId, expiryData);
    }

    /**
     * Interface publique pour utilisation de points
     */
    notifyPointsRedeemed(userId, redemptionData) {
        return this.sendPointsRedeemedNotification(userId, redemptionData);
    }

    /**
     * Interface publique pour campagnes
     */
    broadcastCampaign(campaignId, campaignData) {
        return this.broadcastCampaignNotification(campaignId, campaignData);
    }

    /**
     * Interface publique pour promotions personnalisées
     */
    sendPersonalPromotion(userId, promotionData) {
        return this.sendPersonalizedPromotion(userId, promotionData);
    }

    /**
     * Interface publique pour alertes système loyalty
     */
    sendLoyaltySystemAlert(alertType, alertData) {
        return this.broadcastLoyaltySystemAlert(alertType, alertData);
    }

    /**
     * Interface publique pour mettre à jour le dashboard admin
     */
    updateLoyaltyAdminDashboard(eventType, eventData) {
        return this.broadcastLoyaltyAdminUpdate(eventType, eventData);
    }

    /**
     * Vérifier si un utilisateur est abonné aux updates loyalty
     */
    isUserSubscribedToLoyalty(userId) {
        const socketId = this.connectedUsers.get(userId);
        return socketId && this.loyaltySubscribers.has(socketId);
    }

    /**
     * Obtenir statistiques loyalty d'un utilisateur connecté
     */
    getUserLoyaltyConnection(userId) {
        const socketId = this.connectedUsers.get(userId);
        if (!socketId) return null;

        return {
            connected: true,
            socketId,
            subscribedToLoyalty: this.loyaltySubscribers.has(socketId),
            subscribedToTierUpdates: this.tierUpgradeSubscribers.has(userId),
            subscribedToExpiryAlerts: this.pointsExpirySubscribers.has(userId),
            loyaltyRoomPreferences: this.userLoyaltyRooms.get(userId)
        };
    }

    /**
     * Forcer une mise à jour du statut loyalty pour un utilisateur
     */
    refreshUserLoyaltyStatus(userId) {
        const socketId = this.connectedUsers.get(userId);
        if (!socketId) return false;

        // Clear cache for this user
        this.loyaltyCache.delete(`loyalty_status_${userId}`);
        this.loyaltyCache.delete(`preferences_${userId}`);

        // Trigger status refresh
        this.io.to(socketId).emit('loyalty-status-refresh-required', {
            timestamp: new Date(),
            reason: 'External update'
        });

        return true;
    }
}

// Create singleton instance
const socketService = new SocketService();

module.exports = socketService;