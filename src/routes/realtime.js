/**
 * Real-time API Routes
 * Handles WebSocket endpoints, live data routes, and real-time functionality
 * Week 3 - Hotel Management System
 */

const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const bookingRealtimeService = require('../services/bookingRealtimeService');
const adminRealtimeService = require('../services/adminRealtimeService');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const User = require('../models/User');
const { logger } = require('../utils/logger');

// ===========================================
// MIDDLEWARE & VALIDATION
// ===========================================

/**
 * Real-time specific validation middleware
 */
const validateRealTimeRequest = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
    }
    next();
};

/**
 * WebSocket connection status check
 */
const checkSocketConnection = (req, res, next) => {
    if (!socketService.io) {
        return res.status(503).json({
            success: false,
            message: 'Real-time service unavailable'
        });
    }
    next();
};

// ===========================================
// LIVE AVAILABILITY ENDPOINTS
// ===========================================

/**
 * GET /api/realtime/availability/:hotelId/live
 * Get live room availability for a hotel
 */
router.get('/availability/:hotelId/live',
    [
        param('hotelId').isMongoId().withMessage('Invalid hotel ID'),
        query('checkIn').isISO8601().withMessage('Invalid check-in date'),
        query('checkOut').isISO8601().withMessage('Invalid check-out date'),
        query('roomType').optional().isString()
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { checkIn, checkOut, roomType } = req.query;

            // Get live availability data
            const availability = await availabilityRealtimeService.getLiveAvailability({
                hotelId,
                checkIn: new Date(checkIn),
                checkOut: new Date(checkOut),
                roomType
            });

            // Join client to hotel room for live updates
            if (req.user) {
                const userId = req.user.id;
                const socketId = socketService.connectedUsers.get(userId);
                if (socketId) {
                    const socket = socketService.io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`hotel-${hotelId}-availability`);
                    }
                }
            }

            res.json({
                success: true,
                data: {
                    hotelId,
                    checkIn,
                    checkOut,
                    availability,
                    lastUpdated: new Date(),
                    isLive: true
                }
            });

        } catch (error) {
            logger.error('Live availability error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get live availability',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
            });
        }
    }
);

/**
 * POST /api/realtime/availability/subscribe
 * Subscribe to availability updates for specific criteria
 */
router.post('/availability/subscribe',
    [
        auth,
        body('hotelId').isMongoId().withMessage('Invalid hotel ID'),
        body('criteria').isObject().withMessage('Search criteria required'),
        body('criteria.checkIn').isISO8601().withMessage('Invalid check-in date'),
        body('criteria.checkOut').isISO8601().withMessage('Invalid check-out date')
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const { hotelId, criteria } = req.body;
            const userId = req.user.id;

            // Subscribe user to availability updates
            const subscription = await availabilityRealtimeService.subscribeToAvailability(
                userId,
                hotelId,
                criteria
            );

            // Join socket room for updates
            const socketId = socketService.connectedUsers.get(userId);
            if (socketId) {
                const socket = socketService.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`availability-${subscription.id}`);
                }
            }

            res.json({
                success: true,
                data: {
                    subscriptionId: subscription.id,
                    message: 'Subscribed to live availability updates',
                    criteria
                }
            });

        } catch (error) {
            logger.error('Availability subscription error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to subscribe to availability updates'
            });
        }
    }
);

/**
 * DELETE /api/realtime/availability/subscribe/:subscriptionId
 * Unsubscribe from availability updates
 */
router.delete('/availability/subscribe/:subscriptionId',
    [
        auth,
        param('subscriptionId').isString().withMessage('Invalid subscription ID')
    ],
    validateRealTimeRequest,
    async (req, res) => {
        try {
            const { subscriptionId } = req.params;
            const userId = req.user.id;

            await availabilityRealtimeService.unsubscribeFromAvailability(userId, subscriptionId);

            // Leave socket room
            const socketId = socketService.connectedUsers.get(userId);
            if (socketId) {
                const socket = socketService.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.leave(`availability-${subscriptionId}`);
                }
            }

            res.json({
                success: true,
                message: 'Unsubscribed from availability updates'
            });

        } catch (error) {
            logger.error('Availability unsubscribe error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to unsubscribe from availability updates'
            });
        }
    }
);

// ===========================================
// LIVE BOOKING ENDPOINTS
// ===========================================

/**
 * POST /api/realtime/booking/instant
 * Create booking with instant real-time updates
 */
router.post('/booking/instant',
    [
        auth,
        body('hotelId').isMongoId().withMessage('Invalid hotel ID'),
        body('checkIn').isISO8601().withMessage('Invalid check-in date'),
        body('checkOut').isISO8601().withMessage('Invalid check-out date'),
        body('rooms').isArray({ min: 1 }).withMessage('At least one room required'),
        body('guests').isInt({ min: 1 }).withMessage('At least one guest required')
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const bookingData = req.body;
            const userId = req.user.id;

            // Create booking with real-time updates
            const booking = await bookingRealtimeService.createInstantBooking({
                ...bookingData,
                userId
            });

            // Send instant confirmation to user
            socketService.sendUserNotification(userId, 'booking-created', {
                bookingId: booking._id,
                status: 'PENDING',
                message: 'Booking created successfully! Waiting for confirmation.',
                nextStep: 'admin_validation'
            });

            // Notify admins in real-time
            socketService.sendAdminNotification('new-booking', {
                bookingId: booking._id,
                customerId: userId,
                hotelId: bookingData.hotelId,
                totalAmount: booking.totalAmount,
                requiresAction: true
            });

            res.status(201).json({
                success: true,
                data: {
                    booking,
                    message: 'Booking created with real-time tracking',
                    trackingEnabled: true
                }
            });

        } catch (error) {
            logger.error('Instant booking error:', error);
            
            // Send error notification to user
            if (req.user) {
                socketService.sendUserNotification(req.user.id, 'booking-error', {
                    message: 'Booking failed. Please try again.',
                    error: error.message
                });
            }

            res.status(500).json({
                success: false,
                message: 'Failed to create instant booking',
                error: process.env.NODE_ENV === 'development' ? error.message : 'Booking failed'
            });
        }
    }
);

/**
 * GET /api/realtime/booking/:bookingId/status
 * Get live booking status with real-time updates
 */
router.get('/booking/:bookingId/status',
    [
        auth,
        param('bookingId').isMongoId().withMessage('Invalid booking ID')
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const { bookingId } = req.params;
            const userId = req.user.id;

            // Get live booking status
            const bookingStatus = await bookingRealtimeService.getLiveBookingStatus(bookingId, userId);

            // Join booking room for live updates
            const socketId = socketService.connectedUsers.get(userId);
            if (socketId) {
                const socket = socketService.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join(`booking-${bookingId}`);
                }
            }

            res.json({
                success: true,
                data: {
                    bookingId,
                    status: bookingStatus,
                    isLive: true,
                    lastUpdated: new Date()
                }
            });

        } catch (error) {
            logger.error('Live booking status error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get live booking status'
            });
        }
    }
);

/**
 * PUT /api/realtime/booking/:bookingId/track
 * Enable/disable real-time tracking for a booking
 */
router.put('/booking/:bookingId/track',
    [
        auth,
        param('bookingId').isMongoId().withMessage('Invalid booking ID'),
        body('enabled').isBoolean().withMessage('Tracking enabled flag required')
    ],
    validateRealTimeRequest,
    async (req, res) => {
        try {
            const { bookingId } = req.params;
            const { enabled } = req.body;
            const userId = req.user.id;

            if (enabled) {
                // Join booking room
                const socketId = socketService.connectedUsers.get(userId);
                if (socketId) {
                    const socket = socketService.io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.join(`booking-${bookingId}`);
                    }
                }
            } else {
                // Leave booking room
                const socketId = socketService.connectedUsers.get(userId);
                if (socketId) {
                    const socket = socketService.io.sockets.sockets.get(socketId);
                    if (socket) {
                        socket.leave(`booking-${bookingId}`);
                    }
                }
            }

            res.json({
                success: true,
                data: {
                    bookingId,
                    trackingEnabled: enabled,
                    message: enabled ? 'Real-time tracking enabled' : 'Real-time tracking disabled'
                }
            });

        } catch (error) {
            logger.error('Booking tracking error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update booking tracking'
            });
        }
    }
);

// ===========================================
// ADMIN REAL-TIME ENDPOINTS
// ===========================================

/**
 * GET /api/realtime/admin/dashboard
 * Get live admin dashboard data
 */
router.get('/admin/dashboard',
    [auth, roleAuth(['ADMIN'])],
    checkSocketConnection,
    async (req, res) => {
        try {
            const userId = req.user.id;

            // Get live dashboard data
            const dashboardData = await adminRealtimeService.getLiveDashboardData();

            // Join admin notification room
            const socketId = socketService.connectedUsers.get(userId);
            if (socketId) {
                const socket = socketService.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join('admin-dashboard');
                    socket.join('admin-notifications');
                }
            }

            res.json({
                success: true,
                data: {
                    ...dashboardData,
                    isLive: true,
                    lastUpdated: new Date()
                }
            });

        } catch (error) {
            logger.error('Admin dashboard error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get live dashboard data'
            });
        }
    }
);

/**
 * POST /api/realtime/admin/validate/:bookingId
 * Validate booking with instant real-time updates
 */
router.post('/admin/validate/:bookingId',
    [
        auth,
        roleAuth(['ADMIN']),
        param('bookingId').isMongoId().withMessage('Invalid booking ID'),
        body('action').isIn(['approve', 'reject']).withMessage('Invalid action'),
        body('comment').optional().isString().trim()
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const { bookingId } = req.params;
            const { action, comment } = req.body;
            const adminId = req.user.id;

            // Process validation with real-time updates
            const result = await adminRealtimeService.validateBookingInstantly({
                bookingId,
                action,
                comment,
                adminId
            });

            // Send instant notification to customer
            socketService.sendUserNotification(result.booking.customer, 'booking-validated', {
                bookingId,
                action,
                status: action === 'approve' ? 'CONFIRMED' : 'REJECTED',
                comment,
                message: action === 'approve' ? 
                    'Your booking has been confirmed!' : 
                    'Your booking has been rejected.'
            });

            // Update availability in real-time
            if (action === 'approve') {
                await availabilityRealtimeService.updateAvailabilityAfterBooking(result.booking);
            }

            // Notify other admins
            socketService.sendAdminNotification('booking-validated', {
                bookingId,
                action,
                validatedBy: adminId,
                timestamp: new Date()
            });

            res.json({
                success: true,
                data: {
                    bookingId,
                    action,
                    newStatus: result.booking.status,
                    message: `Booking ${action}d successfully`,
                    realTimeUpdated: true
                }
            });

        } catch (error) {
            logger.error('Admin validation error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to validate booking'
            });
        }
    }
);

/**
 * GET /api/realtime/admin/pending
 * Get live pending bookings with real-time updates
 */
router.get('/admin/pending',
    [auth, roleAuth(['ADMIN'])],
    checkSocketConnection,
    async (req, res) => {
        try {
            const userId = req.user.id;

            // Get live pending bookings
            const pendingBookings = await adminRealtimeService.getLivePendingBookings();

            // Join admin pending room for updates
            const socketId = socketService.connectedUsers.get(userId);
            if (socketId) {
                const socket = socketService.io.sockets.sockets.get(socketId);
                if (socket) {
                    socket.join('admin-pending-bookings');
                }
            }

            res.json({
                success: true,
                data: {
                    pendingBookings,
                    count: pendingBookings.length,
                    isLive: true,
                    lastUpdated: new Date()
                }
            });

        } catch (error) {
            logger.error('Admin pending bookings error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get pending bookings'
            });
        }
    }
);

// ===========================================
// REAL-TIME SYSTEM STATUS ENDPOINTS
// ===========================================

/**
 * GET /api/realtime/status
 * Get real-time system status and connection stats
 */
router.get('/status',
    checkSocketConnection,
    async (req, res) => {
        try {
            const connectionStats = socketService.getConnectionStats();
            
            res.json({
                success: true,
                data: {
                    realTimeEnabled: true,
                    socketServer: 'active',
                    connections: connectionStats,
                    services: {
                        availability: await availabilityRealtimeService.getServiceStatus(),
                        booking: await bookingRealtimeService.getServiceStatus(),
                        admin: await adminRealtimeService.getServiceStatus(),
                        notifications: notificationService.getServiceStatus()
                    },
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('Real-time status error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get real-time status'
            });
        }
    }
);

/**
 * POST /api/realtime/broadcast
 * Broadcast message to all connected users (Admin only)
 */
router.post('/broadcast',
    [
        auth,
        roleAuth(['ADMIN']),
        body('message').isString().trim().isLength({ min: 1 }).withMessage('Message required'),
        body('type').isIn(['info', 'warning', 'error', 'maintenance']).withMessage('Invalid message type'),
        body('target').optional().isIn(['all', 'clients', 'receptionists', 'admins']).withMessage('Invalid target')
    ],
    validateRealTimeRequest,
    checkSocketConnection,
    async (req, res) => {
        try {
            const { message, type, target = 'all' } = req.body;
            const adminId = req.user.id;

            const broadcastData = {
                message,
                type,
                from: 'system',
                adminId,
                timestamp: new Date()
            };

            let targetRoom;
            switch (target) {
                case 'clients':
                    targetRoom = 'clients';
                    break;
                case 'receptionists':
                    targetRoom = 'receptionists';
                    break;
                case 'admins':
                    targetRoom = 'admins';
                    break;
                default:
                    targetRoom = null; // Broadcast to all
            }

            if (targetRoom) {
                socketService.io.to(targetRoom).emit('system-broadcast', broadcastData);
            } else {
                socketService.io.emit('system-broadcast', broadcastData);
            }

            logger.info(`System broadcast sent by admin ${adminId} to ${target}`);

            res.json({
                success: true,
                data: {
                    message: 'Broadcast sent successfully',
                    target,
                    recipients: socketService.getConnectionStats().totalConnections,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('Broadcast error:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send broadcast'
            });
        }
    }
);

// ===========================================
// ERROR HANDLING & FALLBACKS
// ===========================================

/**
 * Handle invalid real-time endpoints
 */
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Real-time endpoint not found',
        availableEndpoints: [
            'GET /api/realtime/availability/:hotelId/live',
            'POST /api/realtime/availability/subscribe',
            'POST /api/realtime/booking/instant',
            'GET /api/realtime/booking/:bookingId/status',
            'GET /api/realtime/admin/dashboard',
            'POST /api/realtime/admin/validate/:bookingId',
            'GET /api/realtime/status'
        ]
    });
});

/**
 * Global error handler for real-time routes
 */
router.use((error, req, res, next) => {
    logger.error('Real-time route error:', error);
    
    res.status(500).json({
        success: false,
        message: 'Real-time service error',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date()
    });
});

module.exports = router;