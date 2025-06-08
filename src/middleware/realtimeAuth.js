/**
 * Real-time Authentication & Authorization Middleware
 * Handles WebSocket security, user permissions, and socket session management
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Booking = require('../models/Booking');
const { logger } = require('../utils/logger');

class RealtimeAuthMiddleware {
    constructor() {
        this.activeSessions = new Map(); // Track active socket sessions
        this.rateLimitMap = new Map(); // Rate limiting for socket events
        this.suspiciousActivities = new Map(); // Track suspicious activities
    }

    /**
     * Socket.io authentication middleware
     * Validates JWT token and attaches user data to socket
     */
    authenticateSocket() {
        return async (socket, next) => {
            try {
                const token = this.extractToken(socket);
                
                if (!token) {
                    return next(new Error('Authentication token required'));
                }

                // Verify and decode JWT token
                const decoded = await this.verifyToken(token);
                const user = await this.getUserById(decoded.id);

                if (!user) {
                    return next(new Error('User not found or inactive'));
                }

                // Check if user is banned or suspended
                if (user.status === 'SUSPENDED' || user.status === 'BANNED') {
                    return next(new Error('Account suspended or banned'));
                }

                // Attach user data to socket
                socket.userId = user._id.toString();
                socket.user = user;
                socket.userRole = user.role;
                socket.hotelId = user.hotelId?.toString();
                socket.permissions = await this.getUserPermissions(user);
                socket.sessionId = this.generateSessionId();
                socket.connectedAt = new Date();
                socket.lastActivity = new Date();

                // Track active session
                this.trackActiveSession(socket);

                // Rate limiting setup
                this.setupRateLimit(socket);

                logger.info(`Socket authenticated: User ${user._id} (${user.role}) - Session ${socket.sessionId}`);
                next();

            } catch (error) {
                logger.error('Socket authentication error:', error);
                next(new Error('Authentication failed: ' + error.message));
            }
        };
    }

    /**
     * Extract token from socket handshake
     */
    extractToken(socket) {
        // Try multiple sources for the token
        return socket.handshake.auth?.token || 
               socket.handshake.headers?.authorization?.split(' ')[1] ||
               socket.handshake.query?.token ||
               socket.request?.headers?.authorization?.split(' ')[1];
    }

    /**
     * Verify JWT token
     */
    async verifyToken(token) {
        try {
            return jwt.verify(token, process.env.JWT_SECRET);
        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                throw new Error('Token expired');
            } else if (error.name === 'JsonWebTokenError') {
                throw new Error('Invalid token');
            } else {
                throw new Error('Token verification failed');
            }
        }
    }

    /**
     * Get user by ID with caching
     */
    async getUserById(userId) {
        try {
            // Add caching here if needed
            return await User.findById(userId)
                .select('-password')
                .populate('hotelId', 'name code');
        } catch (error) {
            logger.error('Error fetching user:', error);
            return null;
        }
    }

    /**
     * Get user permissions based on role and context
     */
    async getUserPermissions(user) {
        const basePermissions = {
            // Basic permissions for all authenticated users
            'socket:connect': true,
            'socket:disconnect': true,
            'notification:receive': true
        };

        const rolePermissions = {
            CLIENT: {
                'booking:view_own': true,
                'booking:create': true,
                'booking:update_own': true,
                'booking:cancel_own': true,
                'availability:check': true,
                'payment:process_own': true,
                'room:view_available': true,
                'hotel:view_public': true,
                'service:request': true,
                'chat:send_to_reception': true
            },
            RECEPTIONIST: {
                'booking:view_hotel': true,
                'booking:create_for_client': true,
                'booking:update_hotel': true,
                'booking:checkin': true,
                'booking:checkout': true,
                'room:manage_hotel': true,
                'room:update_status': true,
                'availability:manage_hotel': true,
                'guest:communicate': true,
                'service:respond': true,
                'payment:process_hotel': true,
                'chat:receive_from_guests': true,
                'realtime:hotel_updates': true
            },
            ADMIN: {
                'booking:view_all': true,
                'booking:approve': true,
                'booking:reject': true,
                'booking:modify_any': true,
                'hotel:manage_all': true,
                'room:manage_all': true,
                'user:manage': true,
                'analytics:view': true,
                'system:monitor': true,
                'admin:broadcast': true,
                'realtime:admin_updates': true,
                'chat:moderate': true
            }
        };

        return {
            ...basePermissions,
            ...(rolePermissions[user.role] || {})
        };
    }

    /**
     * Permission check middleware for socket events
     */
    requirePermission(permission) {
        return (socket, next) => {
            try {
                if (!socket.permissions || !socket.permissions[permission]) {
                    const error = new Error(`Insufficient permissions: ${permission} required`);
                    error.code = 'PERMISSION_DENIED';
                    return next(error);
                }

                // Update last activity
                socket.lastActivity = new Date();
                next();

            } catch (error) {
                logger.error('Permission check error:', error);
                next(new Error('Permission validation failed'));
            }
        };
    }

    /**
     * Hotel-specific authorization
     */
    requireHotelAccess(hotelId = null) {
        return async (socket, next) => {
            try {
                const targetHotelId = hotelId || socket.handshake.query?.hotelId;
                
                if (!targetHotelId) {
                    return next(new Error('Hotel ID required'));
                }

                // Admin can access all hotels
                if (socket.userRole === 'ADMIN') {
                    socket.authorizedHotelId = targetHotelId;
                    return next();
                }

                // Receptionist can only access their assigned hotel
                if (socket.userRole === 'RECEPTIONIST') {
                    if (socket.hotelId !== targetHotelId) {
                        return next(new Error('Hotel access denied'));
                    }
                    socket.authorizedHotelId = targetHotelId;
                    return next();
                }

                // Clients can access hotels where they have bookings
                if (socket.userRole === 'CLIENT') {
                    const hasBooking = await this.userHasHotelBooking(socket.userId, targetHotelId);
                    if (!hasBooking) {
                        return next(new Error('No booking found for this hotel'));
                    }
                    socket.authorizedHotelId = targetHotelId;
                    return next();
                }

                next(new Error('Unauthorized hotel access'));

            } catch (error) {
                logger.error('Hotel authorization error:', error);
                next(new Error('Hotel authorization failed'));
            }
        };
    }

    /**
     * Booking-specific authorization
     */
    requireBookingAccess() {
        return async (socket, next) => {
            try {
                const bookingId = socket.handshake.query?.bookingId;
                
                if (!bookingId) {
                    return next(new Error('Booking ID required'));
                }

                const booking = await Booking.findById(bookingId).populate('hotel');
                if (!booking) {
                    return next(new Error('Booking not found'));
                }

                // Check access based on role
                const hasAccess = await this.checkBookingAccess(socket, booking);
                if (!hasAccess) {
                    return next(new Error('Booking access denied'));
                }

                socket.authorizedBookingId = bookingId;
                socket.authorizedBooking = booking;
                next();

            } catch (error) {
                logger.error('Booking authorization error:', error);
                next(new Error('Booking authorization failed'));
            }
        };
    }

    /**
     * Rate limiting middleware for socket events
     */
    rateLimit(maxEvents = 100, windowMs = 60000) {
        return (socket, next) => {
            try {
                const key = `${socket.userId}:${socket.sessionId}`;
                const now = Date.now();
                
                if (!this.rateLimitMap.has(key)) {
                    this.rateLimitMap.set(key, {
                        count: 1,
                        resetTime: now + windowMs
                    });
                    return next();
                }

                const limit = this.rateLimitMap.get(key);
                
                // Reset if window expired
                if (now > limit.resetTime) {
                    limit.count = 1;
                    limit.resetTime = now + windowMs;
                    return next();
                }

                // Check if limit exceeded
                if (limit.count >= maxEvents) {
                    const error = new Error('Rate limit exceeded');
                    error.code = 'RATE_LIMIT_EXCEEDED';
                    error.retryAfter = Math.ceil((limit.resetTime - now) / 1000);
                    
                    // Track suspicious activity
                    this.trackSuspiciousActivity(socket, 'RATE_LIMIT_EXCEEDED');
                    
                    return next(error);
                }

                limit.count++;
                next();

            } catch (error) {
                logger.error('Rate limiting error:', error);
                next(error);
            }
        };
    }

    /**
     * Admin-only middleware
     */
    requireAdmin() {
        return (socket, next) => {
            if (socket.userRole !== 'ADMIN') {
                const error = new Error('Admin access required');
                error.code = 'ADMIN_REQUIRED';
                return next(error);
            }
            next();
        };
    }

    /**
     * Staff-only middleware (Admin or Receptionist)
     */
    requireStaff() {
        return (socket, next) => {
            if (!['ADMIN', 'RECEPTIONIST'].includes(socket.userRole)) {
                const error = new Error('Staff access required');
                error.code = 'STAFF_REQUIRED';
                return next(error);
            }
            next();
        };
    }

    /**
     * Session validation middleware
     */
    validateSession() {
        return (socket, next) => {
            try {
                const session = this.activeSessions.get(socket.sessionId);
                
                if (!session) {
                    return next(new Error('Invalid session'));
                }

                // Check session timeout (24 hours)
                const sessionAge = Date.now() - session.createdAt;
                if (sessionAge > 24 * 60 * 60 * 1000) {
                    this.cleanupSession(socket.sessionId);
                    return next(new Error('Session expired'));
                }

                // Check for suspicious activity
                if (session.suspiciousActivity && session.suspiciousActivity.length > 5) {
                    return next(new Error('Session flagged for suspicious activity'));
                }

                session.lastActivity = new Date();
                next();

            } catch (error) {
                logger.error('Session validation error:', error);
                next(new Error('Session validation failed'));
            }
        };
    }

    /**
     * Helper Methods
     */

    async userHasHotelBooking(userId, hotelId) {
        try {
            const booking = await Booking.findOne({
                customer: userId,
                hotel: hotelId,
                status: { $in: ['PENDING', 'CONFIRMED', 'CHECKED_IN'] }
            });
            return !!booking;
        } catch (error) {
            logger.error('Error checking user hotel booking:', error);
            return false;
        }
    }

    async checkBookingAccess(socket, booking) {
        switch (socket.userRole) {
            case 'ADMIN':
                return true;
                
            case 'RECEPTIONIST':
                return socket.hotelId === booking.hotel._id.toString();
                
            case 'CLIENT':
                return socket.userId === booking.customer.toString();
                
            default:
                return false;
        }
    }

    generateSessionId() {
        return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    trackActiveSession(socket) {
        const session = {
            socketId: socket.id,
            userId: socket.userId,
            userRole: socket.userRole,
            hotelId: socket.hotelId,
            createdAt: Date.now(),
            lastActivity: new Date(),
            ipAddress: socket.request.connection.remoteAddress,
            userAgent: socket.request.headers['user-agent'],
            suspiciousActivity: []
        };

        this.activeSessions.set(socket.sessionId, session);

        // Cleanup on disconnect
        socket.on('disconnect', () => {
            this.cleanupSession(socket.sessionId);
        });
    }

    setupRateLimit(socket) {
        const key = `${socket.userId}:${socket.sessionId}`;
        if (!this.rateLimitMap.has(key)) {
            this.rateLimitMap.set(key, {
                count: 0,
                resetTime: Date.now() + 60000 // 1 minute window
            });
        }
    }

    trackSuspiciousActivity(socket, activityType) {
        const session = this.activeSessions.get(socket.sessionId);
        if (session) {
            session.suspiciousActivity.push({
                type: activityType,
                timestamp: new Date(),
                details: {
                    socketId: socket.id,
                    userId: socket.userId,
                    ipAddress: socket.request.connection.remoteAddress
                }
            });

            // Log suspicious activity
            logger.warn(`Suspicious activity detected: ${activityType}`, {
                userId: socket.userId,
                sessionId: socket.sessionId,
                activityType
            });

            // Auto-disconnect after too many suspicious activities
            if (session.suspiciousActivity.length > 10) {
                logger.error(`Disconnecting user ${socket.userId} due to excessive suspicious activity`);
                socket.disconnect(true);
            }
        }
    }

    cleanupSession(sessionId) {
        this.activeSessions.delete(sessionId);
        
        // Cleanup rate limit data for this session
        for (const [key, _] of this.rateLimitMap.entries()) {
            if (key.includes(sessionId)) {
                this.rateLimitMap.delete(key);
            }
        }
    }

    /**
     * Get session statistics
     */
    getSessionStats() {
        const stats = {
            totalActiveSessions: this.activeSessions.size,
            sessionsByRole: {},
            sessionsByHotel: {},
            suspiciousActivities: 0
        };

        for (const session of this.activeSessions.values()) {
            // Count by role
            stats.sessionsByRole[session.userRole] = (stats.sessionsByRole[session.userRole] || 0) + 1;
            
            // Count by hotel
            if (session.hotelId) {
                stats.sessionsByHotel[session.hotelId] = (stats.sessionsByHotel[session.hotelId] || 0) + 1;
            }
            
            // Count suspicious activities
            stats.suspiciousActivities += session.suspiciousActivity.length;
        }

        return stats;
    }

    /**
     * Force disconnect user sessions
     */
    disconnectUser(userId, reason = 'Administrative action') {
        let disconnectedSessions = 0;
        
        for (const [sessionId, session] of this.activeSessions.entries()) {
            if (session.userId === userId) {
                // This would need integration with your socket.io instance
                // You might need to store socket references or emit to specific rooms
                logger.info(`Disconnecting user ${userId} session ${sessionId}: ${reason}`);
                this.cleanupSession(sessionId);
                disconnectedSessions++;
            }
        }
        
        return disconnectedSessions;
    }

    /**
     * Cleanup expired sessions (should be called periodically)
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of this.activeSessions.entries()) {
            const sessionAge = now - session.createdAt;
            const inactiveTime = now - session.lastActivity.getTime();
            
            // Remove sessions older than 24 hours or inactive for 2 hours
            if (sessionAge > 24 * 60 * 60 * 1000 || inactiveTime > 2 * 60 * 60 * 1000) {
                this.cleanupSession(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            logger.info(`Cleaned up ${cleanedCount} expired sessions`);
        }

        return cleanedCount;
    }
}

// Create singleton instance
const realtimeAuthMiddleware = new RealtimeAuthMiddleware();

// Export individual middleware functions for easy use
module.exports = {
    // Main class instance
    realtimeAuthMiddleware,
    
    // Individual middleware functions
    authenticateSocket: () => realtimeAuthMiddleware.authenticateSocket(),
    requirePermission: (permission) => realtimeAuthMiddleware.requirePermission(permission),
    requireHotelAccess: (hotelId) => realtimeAuthMiddleware.requireHotelAccess(hotelId),
    requireBookingAccess: () => realtimeAuthMiddleware.requireBookingAccess(),
    rateLimit: (maxEvents, windowMs) => realtimeAuthMiddleware.rateLimit(maxEvents, windowMs),
    requireAdmin: () => realtimeAuthMiddleware.requireAdmin(),
    requireStaff: () => realtimeAuthMiddleware.requireStaff(),
    validateSession: () => realtimeAuthMiddleware.validateSession(),
    
    // Utility functions
    getSessionStats: () => realtimeAuthMiddleware.getSessionStats(),
    disconnectUser: (userId, reason) => realtimeAuthMiddleware.disconnectUser(userId, reason),
    cleanupExpiredSessions: () => realtimeAuthMiddleware.cleanupExpiredSessions()
};