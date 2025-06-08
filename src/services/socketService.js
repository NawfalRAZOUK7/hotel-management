const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const { logger } = require('../utils/logger');

class SocketService {
    constructor() {
        this.io = null;
        this.connectedUsers = new Map(); // userId -> socketId mapping
        this.userRooms = new Map(); // socketId -> rooms array
        this.adminSockets = new Set(); // Admin socket IDs
        this.receptionistSockets = new Map(); // hotelId -> Set of socketIds
        
        // ================================
        // YIELD MANAGEMENT SPECIFIC MAPS
        // ================================
        this.pricingSubscribers = new Map(); // hotelId -> Set of socketIds
        this.yieldAdminSockets = new Set(); // Yield-focused admin sockets
        this.demandSubscribers = new Map(); // hotelId -> Set of socketIds
        this.revenueSubscribers = new Set(); // Revenue monitoring sockets
        this.priceAlertSubscribers = new Map(); // userId -> Set of hotelIds for price alerts
        this.customerPriceWatchers = new Map(); // hotelId -> Map(userId -> roomTypes[])
        
        // Yield event tracking
        this.yieldMetrics = {
            priceUpdatesCount: 0,
            demandAlertsCount: 0,
            revenueOptimizationsCount: 0,
            lastYieldActivity: null
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
        
        logger.info('Socket.io server initialized successfully with Yield Management support');
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
                const user = await User.findById(decoded.id).select('-password');
                
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

                next();
            } catch (error) {
                logger.error('Socket authentication error:', error);
                next(new Error('Invalid authentication token'));
            }
        });
    }

    /**
     * Setup Socket.io event handlers with Yield Management events
     */
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            this.handleConnection(socket);
            
            // Standard booking-related events
            socket.on('join-booking-room', (bookingId) => this.joinBookingRoom(socket, bookingId));
            socket.on('leave-booking-room', (bookingId) => this.leaveBookingRoom(socket, bookingId));
            socket.on('join-hotel-room', (hotelId) => this.joinHotelRoom(socket, hotelId));
            socket.on('leave-hotel-room', (hotelId) => this.leaveHotelRoom(socket, hotelId));
            socket.on('join-admin-room', () => this.joinAdminRoom(socket));
            
            // Real-time availability requests
            socket.on('check-availability', (data) => this.handleAvailabilityCheck(socket, data));
            socket.on('service-request', (data) => this.handleServiceRequest(socket, data));
            socket.on('send-message', (data) => this.handleMessage(socket, data));
            socket.on('typing', (data) => this.handleTyping(socket, data));
            
            // ================================
            // YIELD MANAGEMENT SPECIFIC EVENTS
            // ================================
            
            // Price Broadcasting & Monitoring
            socket.on('join-pricing-room', (data) => this.joinPricingRoom(socket, data));
            socket.on('leave-pricing-room', (hotelId) => this.leavePricingRoom(socket, hotelId));
            socket.on('subscribe-price-alerts', (data) => this.subscribePriceAlerts(socket, data));
            socket.on('unsubscribe-price-alerts', (data) => this.unsubscribePriceAlerts(socket, data));
            
            // Demand Analysis Subscriptions
            socket.on('join-demand-monitoring', (hotelId) => this.joinDemandMonitoring(socket, hotelId));
            socket.on('leave-demand-monitoring', (hotelId) => this.leaveDemandMonitoring(socket, hotelId));
            
            // Revenue Monitoring
            socket.on('join-revenue-monitoring', () => this.joinRevenueMonitoring(socket));
            socket.on('leave-revenue-monitoring', () => this.leaveRevenueMonitoring(socket));
            
            // Yield Admin Dashboard
            socket.on('join-yield-admin', () => this.joinYieldAdmin(socket));
            socket.on('leave-yield-admin', () => this.leaveYieldAdmin(socket));
            
            // Customer Price Watching
            socket.on('watch-hotel-prices', (data) => this.watchHotelPrices(socket, data));
            socket.on('unwatch-hotel-prices', (data) => this.unwatchHotelPrices(socket, data));
            
            // Yield Action Events
            socket.on('trigger-price-update', (data) => this.handleTriggerPriceUpdate(socket, data));
            socket.on('request-yield-analysis', (data) => this.handleYieldAnalysisRequest(socket, data));
            
            // Disconnect handler
            socket.on('disconnect', () => this.handleDisconnection(socket));
        });
    }

    /**
     * Handle new socket connection with yield management setup
     * @param {Object} socket - Socket instance
     */
    handleConnection(socket) {
        const { userId, user, userRole, hotelId } = socket;
        
        // Store connection mapping
        this.connectedUsers.set(userId, socket.id);
        this.userRooms.set(socket.id, []);

        // Join role-specific rooms
        switch (userRole) {
            case 'ADMIN':
                this.adminSockets.add(socket.id);
                socket.join('admins');
                
                // Auto-join yield admin features for admins
                this.yieldAdminSockets.add(socket.id);
                socket.join('yield-admin');
                socket.join('revenue-monitoring');
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
                }
                break;
                
            case 'CLIENT':
                socket.join('clients');
                socket.join(`user-${userId}`);
                break;
        }

        // Send welcome message with yield management capabilities
        socket.emit('connected', {
            message: 'Connected to hotel management system with Yield Management',
            userId,
            role: userRole,
            yieldFeatures: {
                pricingAlerts: userRole === 'CLIENT',
                demandAnalysis: ['ADMIN', 'RECEPTIONIST'].includes(userRole),
                revenueMonitoring: userRole === 'ADMIN',
                yieldDashboard: userRole === 'ADMIN'
            },
            timestamp: new Date()
        });

        logger.info(`User ${userId} (${userRole}) connected via socket ${socket.id} with yield features`);
    }

    /**
     * Handle socket disconnection with yield cleanup
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

        // ================================
        // YIELD MANAGEMENT CLEANUP
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

        logger.info(`User ${userId} (${userRole}) disconnected from socket ${socket.id} - yield subscriptions cleaned`);
    }

    // ================================
    // EXISTING STANDARD METHODS (keeping all original functionality)
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
    // YIELD MANAGEMENT SPECIALIZED METHODS
    // ================================

    /**
     * 💰 PRICE BROADCASTING SYSTEM
     */

    /**
     * Join pricing room for real-time price updates
     * @param {Object} socket - Socket instance
     * @param {Object} data - { hotelId, roomTypes? }
     */
    joinPricingRoom(socket, data) {
        const { hotelId, roomTypes = [] } = data;
        
        if (!hotelId) {
            socket.emit('error', { message: 'Hotel ID required for pricing room' });
            return;
        }

        // Authorization check
        if (socket.userRole === 'CLIENT' || 
            (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) ||
            socket.userRole === 'ADMIN') {
            
            const roomName = `pricing-${hotelId}`;
            socket.join(roomName);
            
            // Track subscription
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

    /**
     * Leave pricing room
     * @param {Object} socket - Socket instance
     * @param {String} hotelId - Hotel ID
     */
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

    /**
     * Broadcast dynamic price update to all subscribers
     * @param {String} hotelId - Hotel ID
     * @param {Object} priceData - Price update data
     */
    broadcastPriceUpdate(hotelId, priceData) {
        if (!this.io) return;

        const priceUpdate = {
            type: 'price_update',
            hotelId,
            timestamp: new Date(),
            ...priceData
        };

        // Send to pricing room subscribers
        this.io.to(`pricing-${hotelId}`).emit('price-update', priceUpdate);
        
        // Send to hotel staff
        this.io.to(`hotel-${hotelId}`).emit('hotel-price-update', priceUpdate);
        
        // Update metrics
        this.yieldMetrics.priceUpdatesCount++;
        this.yieldMetrics.lastYieldActivity = new Date();
        
        logger.info(`Price update broadcast for hotel ${hotelId}: ${JSON.stringify(priceData)}`);
    }

    /**
     * Subscribe to price alerts for specific hotels/room types
     * @param {Object} socket - Socket instance
     * @param {Object} data - { hotelIds, roomTypes, alertThreshold }
     */
    subscribePriceAlerts(socket, data) {
        const { hotelIds = [], roomTypes = [], alertThreshold = 10 } = data;
        const userId = socket.userId;
        
        if (!this.priceAlertSubscribers.has(userId)) {
            this.priceAlertSubscribers.set(userId, new Set());
        }
        
        hotelIds.forEach(hotelId => {
            this.priceAlertSubscribers.get(userId).add(hotelId);
            
            // Track customer price watchers
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

    /**
     * Unsubscribe from price alerts
     * @param {Object} socket - Socket instance
     * @param {Object} data - { hotelIds }
     */
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

    /**
     * Send price alert to specific user
     * @param {String} userId - User ID
     * @param {Object} priceAlert - Price alert data
     */
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
     * 📈 DEMAND ANALYSIS & SURGE ALERTS
     */

    /**
     * Join demand monitoring for a hotel
     * @param {Object} socket - Socket instance
     * @param {String} hotelId - Hotel ID
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

    /**
     * Leave demand monitoring
     * @param {Object} socket - Socket instance
     * @param {String} hotelId - Hotel ID
     */
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

    /**
     * Send demand surge alert
     * @param {String} hotelId - Hotel ID
     * @param {Object} demandData - Demand analysis data
     */
    sendDemandSurgeAlert(hotelId, demandData) {
        if (!this.io) return;

        const alert = {
            type: 'demand_surge',
            hotelId,
            severity: demandData.level === 'VERY_HIGH' ? 'critical' : 'warning',
            timestamp: new Date(),
            ...demandData
        };

        // Send to demand monitoring room
        this.io.to(`demand-${hotelId}`).emit('demand-surge-alert', alert);
        
        // Send to hotel staff
        this.io.to(`hotel-${hotelId}`).emit('demand-surge-alert', alert);
        
        // Send to yield admins
        this.io.to('yield-admin').emit('demand-surge-alert', alert);
        
        // Update metrics
        this.yieldMetrics.demandAlertsCount++;
        this.yieldMetrics.lastYieldActivity = new Date();
        
        logger.info(`Demand surge alert sent for hotel ${hotelId}: ${demandData.level}`);
    }

    /**
     * Broadcast demand analysis update
     * @param {String} hotelId - Hotel ID
     * @param {Object} analysisData - Demand analysis data
     */
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
     * 💹 REVENUE OPTIMIZATION & MONITORING
     */

    /**
     * Join revenue monitoring (Admin only)
     * @param {Object} socket - Socket instance
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

    /**
     * Leave revenue monitoring
     * @param {Object} socket - Socket instance
     */
    leaveRevenueMonitoring(socket) {
        socket.leave('revenue-monitoring');
        this.revenueSubscribers.delete(socket.id);
        
        socket.emit('left-revenue-monitoring');
    }

    /**
     * Broadcast revenue optimization results
     * @param {String} hotelId - Hotel ID
     * @param {Object} optimization - Optimization data
     */
    broadcastRevenueOptimization(hotelId, optimization) {
        if (!this.io) return;

        const update = {
            type: 'revenue_optimization',
            hotelId,
            timestamp: new Date(),
            ...optimization
        };

        // Send to revenue monitoring room
        this.io.to('revenue-monitoring').emit('revenue-optimization', update);
        
        // Send to specific hotel
        this.io.to(`hotel-${hotelId}`).emit('revenue-optimization', update);
        
        // Update metrics
        this.yieldMetrics.revenueOptimizationsCount++;
        this.yieldMetrics.lastYieldActivity = new Date();
        
        logger.info(`Revenue optimization broadcast for hotel ${hotelId}: ${optimization.optimizationType}`);
    }

    /**
     * Send revenue goal update
     * @param {String} hotelId - Hotel ID
     * @param {Object} goals - Revenue goals data
     */
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
     * 🎛️ YIELD ADMIN DASHBOARD
     */

    /**
     * Join yield admin room (Admin only)
     * @param {Object} socket - Socket instance
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

    /**
     * Leave yield admin room
     * @param {Object} socket - Socket instance
     */
    leaveYieldAdmin(socket) {
        socket.leave('yield-admin');
        this.yieldAdminSockets.delete(socket.id);
        
        socket.emit('left-yield-admin');
    }

    /**
     * Send yield dashboard update to all yield admins
     * @param {Object} yieldData - Yield management dashboard data
     */
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

    /**
     * Send yield dashboard update to specific admin
     * @param {String} adminId - Admin user ID
     * @param {Object} yieldData - Yield dashboard data
     */
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

    /**
     * Broadcast yield performance metrics to admins
     * @param {Object} metrics - Performance metrics
     */
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

    /**
     * Broadcast yield stats to all relevant users
     * @param {Object} yieldStats - Yield management statistics
     */
    broadcastYieldStats(yieldStats) {
        if (!this.io) return;

        const statsUpdate = {
            type: 'yield_stats',
            timestamp: new Date(),
            ...yieldStats,
            socketMetrics: this.getYieldConnectionStats()
        };

        // Send to yield admins
        this.io.to('yield-admin').emit('yield-stats', statsUpdate);
        
        // Send to revenue monitoring
        this.io.to('revenue-monitoring').emit('yield-stats', statsUpdate);
        
        logger.info('Yield stats broadcast completed');
    }

    /**
     * Notify yield strategy change
     * @param {String} hotelId - Hotel ID
     * @param {Object} strategy - New yield strategy
     */
    notifyYieldStrategyChange(hotelId, strategy) {
        if (!this.io) return;

        const notification = {
            type: 'yield_strategy_change',
            hotelId,
            timestamp: new Date(),
            ...strategy
        };

        // Notify hotel staff
        this.io.to(`hotel-${hotelId}`).emit('yield-strategy-changed', notification);
        
        // Notify pricing subscribers
        this.io.to(`pricing-${hotelId}`).emit('yield-strategy-changed', notification);
        
        // Notify yield admins
        this.io.to('yield-admin').emit('yield-strategy-changed', notification);
        
        logger.info(`Yield strategy change notification sent for hotel ${hotelId}: ${strategy.strategyType}`);
    }

    /**
     * 👥 CUSTOMER PRICE WATCHING SYSTEM
     */

    /**
     * Watch hotel prices for customer notifications
     * @param {Object} socket - Socket instance
     * @param {Object} data - { hotelId, roomTypes, checkIn, checkOut, maxPrice }
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

    /**
     * Stop watching hotel prices
     * @param {Object} socket - Socket instance
     * @param {Object} data - { hotelId }
     */
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

    /**
     * Notify customer of price drop
     * @param {String} userId - User ID
     * @param {String} hotelId - Hotel ID
     * @param {String} roomType - Room type
     * @param {Object} priceData - Price drop data
     */
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
        
        // Update customer's alert count
        if (this.customerPriceWatchers.has(hotelId) && 
            this.customerPriceWatchers.get(hotelId).has(userId)) {
            const watcher = this.customerPriceWatchers.get(hotelId).get(userId);
            watcher.alertsReceived++;
        }

        logger.info(`Price drop notification sent to user ${userId} for hotel ${hotelId}, room ${roomType}`);
        return true;
    }

    /**
     * Send price increase notification (for existing bookings)
     * @param {String} userId - User ID
     * @param {String} bookingId - Booking ID
     * @param {Object} priceChange - Price change data
     */
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

    /**
     * Broadcast promotional pricing
     * @param {String} hotelId - Hotel ID
     * @param {Object} promotions - Promotional pricing data
     */
    broadcastPromotionalPricing(hotelId, promotions) {
        if (!this.io) return;

        const promotion = {
            type: 'promotional_pricing',
            hotelId,
            timestamp: new Date(),
            ...promotions
        };

        // Broadcast to pricing subscribers
        this.io.to(`pricing-${hotelId}`).emit('promotional-pricing', promotion);
        
        // Notify price watchers for this hotel
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
     * 🎮 YIELD ACTION HANDLERS
     */

    /**
     * Handle trigger price update request
     * @param {Object} socket - Socket instance
     * @param {Object} data - Price update trigger data
     */
    handleTriggerPriceUpdate(socket, data) {
        if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
            socket.emit('error', { message: 'Unauthorized: Cannot trigger price updates' });
            return;
        }

        const { hotelId, roomTypes, strategy, reason } = data;
        
        // Validate permissions
        if (socket.userRole === 'RECEPTIONIST' && socket.hotelId !== hotelId) {
            socket.emit('error', { message: 'Unauthorized: Can only trigger updates for your hotel' });
            return;
        }

        // Emit trigger request (would be handled by yield manager)
        socket.emit('price-update-triggered', {
            hotelId,
            roomTypes,
            strategy,
            reason,
            triggeredBy: socket.userId,
            timestamp: new Date(),
            status: 'processing'
        });

        // Notify yield admins
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

    /**
     * Handle yield analysis request
     * @param {Object} socket - Socket instance
     * @param {Object} data - Analysis request data
     */
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

        // Notify other yield admins
        socket.to('yield-admin').emit('yield-analysis-requested', {
            analysisType,
            hotelId,
            requestedBy: socket.userId,
            timestamp: new Date()
        });

        logger.info(`Yield analysis (${analysisType}) requested by admin ${socket.userId} for hotel ${hotelId || 'ALL'}`);
    }

    // ================================
    // EXISTING PUBLIC METHODS (keeping all original functionality)
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
    // ENHANCED YIELD MANAGEMENT STATISTICS
    // ================================

    /**
     * Get yield-specific connection statistics
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
     * Get total pricing subscribers across all hotels
     */
    getTotalPricingSubscribers() {
        let total = 0;
        for (const subscribers of this.pricingSubscribers.values()) {
            total += subscribers.size;
        }
        return total;
    }

    /**
     * Get total demand subscribers across all hotels
     */
    getTotalDemandSubscribers() {
        let total = 0;
        for (const subscribers of this.demandSubscribers.values()) {
            total += subscribers.size;
        }
        return total;
    }

    /**
     * Get total price watchers across all hotels
     */
    getTotalPriceWatchers() {
        let total = 0;
        for (const watchers of this.customerPriceWatchers.values()) {
            total += watchers.size;
        }
        return total;
    }

    /**
     * Get enhanced connection statistics including yield management
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
            yieldManagement: this.getYieldConnectionStats()
        };
    }

    /**
     * Check if user is connected
     */
    isUserConnected(userId) {
        return this.connectedUsers.has(userId);
    }

    /**
     * Get all connected users for a hotel
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
     * Get yield management health status
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
     * Reset yield metrics (for testing or maintenance)
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
     * Enhanced graceful shutdown with yield cleanup
     */
    shutdown() {
        if (this.io) {
            // Send shutdown notification to yield admins
            this.io.to('yield-admin').emit('system-shutdown', {
                message: 'Yield management system shutting down',
                timestamp: new Date(),
                reconnectIn: '30 seconds'
            });

            // Send notification to all pricing subscribers
            for (const hotelId of this.pricingSubscribers.keys()) {
                this.io.to(`pricing-${hotelId}`).emit('pricing-service-offline', {
                    message: 'Pricing updates temporarily unavailable',
                    timestamp: new Date()
                });
            }

            // Close all connections
            this.io.close();
            logger.info('Socket service with yield management shutdown completed');
        }

        // Clear all yield-specific data structures
        this.pricingSubscribers.clear();
        this.yieldAdminSockets.clear();
        this.demandSubscribers.clear();
        this.revenueSubscribers.clear();
        this.priceAlertSubscribers.clear();
        this.customerPriceWatchers.clear();
    }
}

// Create singleton instance
const socketService = new SocketService();

module.exports = socketService;