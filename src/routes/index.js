/**
 * Main Routes Index - Week 3 Real-time + Yield Management Integration
 * Centralized route management with WebSocket, real-time endpoints, and yield management
 */

const express = require('express');
const router = express.Router();

// Import existing route modules
const authRoutes = require('./auth');
const userRoutes = require('./users');
const hotelRoutes = require('./hotels');
const roomRoutes = require('./rooms');
const bookingRoutes = require('./bookings');
const adminRoutes = require('./admin');

// Import Week 3 new route modules
const realtimeRoutes = require('./realtime');
const yieldRoutes = require('./yield');

// Import middleware
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const rateLimiter = require('../middleware/rateLimiter');
const realtimeAuth = require('../middleware/realtimeAuth');

// Import services for WebSocket and Yield Management integration
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const yieldManager = require('../services/yieldManager');
const revenueAnalytics = require('../services/revenueAnalytics');

/**
 * API Routes Registration
 */

// ================================
// PUBLIC ROUTES (No Authentication)
// ================================
router.use('/auth', rateLimiter, authRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.status(200).json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
            database: 'connected',
            email: 'operational',
            sms: 'operational',
            socket: socketService.io ? 'connected' : 'disconnected',
            realtime: 'operational',
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? 'enabled' : 'disabled'
        }
    });
});

// Real-time service status endpoint
router.get('/realtime/status', (req, res) => {
    res.json({
        socketConnections: socketService.getConnectionStats(),
        notificationService: notificationService.getServiceStatus(),
        yieldManagement: {
            enabled: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            status: process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? 'operational' : 'disabled'
        },
        timestamp: new Date()
    });
});

// ================================
// AUTHENTICATED ROUTES
// ================================
router.use('/users', auth, userRoutes);
router.use('/hotels', auth, hotelRoutes);
router.use('/rooms', auth, roomRoutes);
router.use('/bookings', auth, bookingRoutes);

// ================================
// REAL-TIME ROUTES (Week 3)
// ================================
// Real-time availability and booking updates
router.use('/realtime', auth, realtimeAuth, realtimeRoutes);

// ================================
// YIELD MANAGEMENT ROUTES (Week 3)
// ================================
// Yield management routes for dynamic pricing and revenue optimization
router.use('/yield', auth, roleAuth(['ADMIN', 'RECEPTIONIST']), yieldRoutes);

// ================================
// ROLE-BASED ROUTES
// ================================
// Admin-only routes
router.use('/admin', auth, roleAuth(['ADMIN']), adminRoutes);

// Receptionist and Admin routes
router.use('/reception', auth, roleAuth(['RECEPTIONIST', 'ADMIN']), require('./reception'));

// ================================
// ENHANCED REAL-TIME AVAILABILITY WITH YIELD PRICING
// ================================

/**
 * Real-time availability endpoint with dynamic pricing
 * GET /api/realtime/availability/:hotelId
 */
router.get('/realtime/availability/:hotelId', auth, async (req, res) => {
    try {
        const { hotelId } = req.params;
        const { checkIn, checkOut, roomType } = req.query;

        // Get real-time availability
        const availability = await availabilityRealtimeService.getRealtimeAvailability({
            hotelId,
            checkIn: new Date(checkIn),
            checkOut: new Date(checkOut),
            roomType
        });

        // Add dynamic pricing if yield management is enabled
        if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
            try {
                const dynamicPricing = await yieldManager.getDynamicPricing(hotelId, roomType, new Date(checkIn));
                availability.dynamicPricing = dynamicPricing;
                availability.yieldOptimized = true;
            } catch (yieldError) {
                console.error('Error getting dynamic pricing:', yieldError);
                availability.yieldOptimized = false;
            }
        }

        // If user is connected via socket, join availability room for live updates
        if (socketService.isUserConnected(req.user.id)) {
            socketService.joinHotelRoom(req.user.id, hotelId);
        }

        res.json({
            success: true,
            data: availability,
            realtime: true,
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            timestamp: new Date()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get real-time availability',
            error: error.message
        });
    }
});

/**
 * Real-time dynamic pricing endpoint
 * GET /api/realtime/pricing/:hotelId
 */
router.get('/realtime/pricing/:hotelId', auth, async (req, res) => {
    try {
        const { hotelId } = req.params;
        const { roomType, date } = req.query;

        if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
            return res.status(400).json({
                success: false,
                message: 'Yield management is not enabled'
            });
        }

        // Get current dynamic pricing
        const pricing = await yieldManager.getDynamicPricing(
            hotelId, 
            roomType, 
            date ? new Date(date) : new Date()
        );

        // Join pricing update room for real-time price changes
        if (socketService.isUserConnected(req.user.id)) {
            socketService.joinPricingRoom(req.user.id, hotelId);
        }

        res.json({
            success: true,
            data: pricing,
            realtime: true,
            timestamp: new Date()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get dynamic pricing',
            error: error.message
        });
    }
});

/**
 * Real-time booking status endpoint with yield optimization
 * GET /api/realtime/booking/:bookingId/status
 */
router.get('/realtime/booking/:bookingId/status', auth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // Get current booking status
        const Booking = require('../models/Booking');
        const booking = await Booking.findById(bookingId).populate('hotel');

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }

        // Check if user has permission to view this booking
        if (booking.customer.toString() !== req.user.id && req.user.role !== 'ADMIN' && req.user.role !== 'RECEPTIONIST') {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized to view this booking'
            });
        }

        const response = {
            bookingId,
            status: booking.status,
            lastUpdated: booking.updatedAt,
            realtime: true
        };

        // Add yield optimization data if enabled and user is admin/receptionist
        if (process.env.YIELD_MANAGEMENT_ENABLED === 'true' && ['ADMIN', 'RECEPTIONIST'].includes(req.user.role)) {
            try {
                const yieldData = await yieldManager.getBookingYieldData(bookingId);
                response.yieldOptimization = yieldData;
            } catch (yieldError) {
                console.error('Error getting yield data:', yieldError);
            }
        }

        res.json({
            success: true,
            data: response
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get booking status',
            error: error.message
        });
    }
});

/**
 * Real-time revenue analytics endpoint (Admin only)
 * GET /api/realtime/analytics/revenue
 */
router.get('/realtime/analytics/revenue', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
            return res.status(400).json({
                success: false,
                message: 'Yield management analytics not available'
            });
        }

        const { hotelId, period = '24h' } = req.query;

        // Get real-time revenue analytics
        const analytics = await revenueAnalytics.getRealtimeAnalytics(hotelId, period);

        // Join analytics room for live updates
        if (socketService.isUserConnected(req.user.id)) {
            socketService.joinAnalyticsRoom(req.user.id, hotelId || 'all');
        }

        res.json({
            success: true,
            data: analytics,
            realtime: true,
            period,
            timestamp: new Date()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get revenue analytics',
            error: error.message
        });
    }
});

/**
 * Trigger real-time notification endpoint (Admin only)
 * POST /api/realtime/notify
 */
router.post('/realtime/notify', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        const { type, userIds, message, priority = 'medium' } = req.body;

        // Send real-time notification to specified users
        const results = await Promise.allSettled(
            userIds.map(userId => 
                notificationService.sendNotification({
                    type: 'ADMIN_MESSAGE',
                    userId,
                    channels: ['socket'],
                    data: { message, priority },
                    priority
                })
            )
        );

        const successful = results.filter(r => r.status === 'fulfilled').length;
        const failed = results.filter(r => r.status === 'rejected').length;

        res.json({
            success: true,
            message: 'Real-time notifications sent',
            stats: {
                total: userIds.length,
                successful,
                failed
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to send real-time notifications',
            error: error.message
        });
    }
});

/**
 * WebSocket connection info endpoint with yield management features
 * GET /api/realtime/connection-info
 */
router.get('/realtime/connection-info', auth, (req, res) => {
    const isConnected = socketService.isUserConnected(req.user.id);
    const stats = socketService.getConnectionStats();

    res.json({
        user: {
            id: req.user.id,
            connected: isConnected,
            role: req.user.role
        },
        server: {
            totalConnections: stats.totalConnections,
            status: 'operational'
        },
        features: {
            liveAvailability: true,
            instantBookings: true,
            realTimeNotifications: true,
            adminValidation: req.user.role === 'ADMIN',
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            dynamicPricing: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            revenueOptimization: process.env.YIELD_MANAGEMENT_ENABLED === 'true' && ['ADMIN', 'RECEPTIONIST'].includes(req.user.role)
        }
    });
});

// ================================
// YIELD MANAGEMENT INTEGRATION ENDPOINTS
// ================================

/**
 * Trigger demand analysis for a hotel (Admin only)
 * POST /api/yield/trigger/demand-analysis/:hotelId
 */
router.post('/yield/trigger/demand-analysis/:hotelId', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
            return res.status(400).json({
                success: false,
                message: 'Yield management is not enabled'
            });
        }

        const { hotelId } = req.params;
        
        // Trigger immediate demand analysis
        const analysis = await yieldManager.triggerDemandAnalysis(hotelId);

        // Broadcast results to connected admins
        socketService.sendAdminNotification('demand_analysis_complete', {
            hotelId,
            analysis,
            triggeredBy: req.user.id,
            timestamp: new Date()
        });

        res.json({
            success: true,
            message: 'Demand analysis triggered successfully',
            data: analysis
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to trigger demand analysis',
            error: error.message
        });
    }
});

/**
 * Get yield management dashboard data (Admin only)
 * GET /api/yield/dashboard
 */
router.get('/yield/dashboard', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
            return res.status(400).json({
                success: false,
                message: 'Yield management is not enabled'
            });
        }

        // Get comprehensive yield management dashboard data
        const dashboardData = await yieldManager.getDashboardData();

        res.json({
            success: true,
            data: dashboardData,
            timestamp: new Date()
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get yield dashboard data',
            error: error.message
        });
    }
});

// ================================
// ERROR HANDLING ROUTES
// ================================

// Real-time error reporting endpoint
router.post('/realtime/error', auth, (req, res) => {
    const { error, context, timestamp } = req.body;
    
    // Log real-time errors for monitoring
    console.error('Real-time client error:', {
        userId: req.user.id,
        error,
        context,
        timestamp: timestamp || new Date()
    });

    res.status(200).json({ received: true });
});

// API documentation route
router.get('/docs', (req, res) => {
    res.json({
        message: 'Hotel Management API - Week 3 Real-time + Yield Management Features',
        version: '3.0.0',
        documentation: {
            swagger: '/api/docs/swagger',
            realtime: '/api/docs/realtime',
            websockets: '/api/docs/websockets',
            yieldManagement: '/api/docs/yield'
        },
        endpoints: {
            authentication: '/api/auth',
            hotels: '/api/hotels',
            bookings: '/api/bookings',
            realtime: '/api/realtime',
            yieldManagement: '/api/yield',
            admin: '/api/admin'
        },
        websocket: {
            url: `ws://localhost:${process.env.PORT || 5000}`,
            namespace: '/socket.io',
            events: [
                'booking-update',
                'availability-update',
                'price-update',
                'demand-surge',
                'notification',
                'admin-notification'
            ]
        },
        yieldManagement: {
            enabled: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            features: [
                'dynamic-pricing',
                'demand-analysis',
                'revenue-optimization',
                'automated-jobs',
                'performance-monitoring'
            ]
        }
    });
});

// Catch-all route for undefined endpoints
router.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'API endpoint not found',
        path: req.originalUrl,
        method: req.method,
        availableEndpoints: [
            '/api/auth',
            '/api/hotels',
            '/api/bookings',
            '/api/realtime',
            '/api/yield',
            '/api/admin',
            '/api/health'
        ]
    });
});

// ================================
// WEBSOCKET & YIELD MANAGEMENT INITIALIZATION HELPER
// ================================

/**
 * Initialize WebSocket integration with HTTP server and yield management
 * This should be called from app.js after server creation
 */
function initializeWebSocketIntegration(server) {
    // Initialize Socket.io with HTTP server
    socketService.initialize(server);

    // Set up real-time event listeners
    setupRealtimeEventListeners();

    console.log('✅ WebSocket integration initialized successfully');
}

/**
 * Setup real-time event listeners for route-level integrations including yield management
 */
function setupRealtimeEventListeners() {
    // Listen for availability changes and broadcast to connected users
    notificationService.on('availability:changed', (data) => {
        socketService.broadcastAvailabilityUpdate(data.hotelId, data.availability);
    });

    // Listen for booking updates and notify relevant users
    notificationService.on('booking:status_changed', (data) => {
        socketService.sendBookingNotification(data.bookingId, 'status_changed', data);
    });

    // Listen for admin notifications
    notificationService.on('admin:notification', (data) => {
        socketService.sendAdminNotification(data.type, data);
    });

    // Yield Management real-time events
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        // Listen for price updates
        yieldManager.on('price:updated', (data) => {
            socketService.broadcastPriceUpdate(data.hotelId, data);
        });

        // Listen for demand surges
        yieldManager.on('demand:surge', (data) => {
            socketService.sendAdminNotification('demand_surge', data);
        });

        // Listen for occupancy alerts
        yieldManager.on('occupancy:critical', (data) => {
            socketService.sendAdminNotification('occupancy_critical', data);
        });

        // Listen for revenue optimization alerts
        yieldManager.on('revenue:optimization', (data) => {
            socketService.sendAdminNotification('revenue_optimization', data);
        });
    }
}

// ================================
// ROUTE MONITORING & ANALYTICS WITH YIELD DATA
// ================================

/**
 * Real-time API usage statistics with yield management metrics
 * GET /api/realtime/stats
 */
router.get('/realtime/stats', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        const stats = {
            connections: socketService.getConnectionStats(),
            notifications: notificationService.getNotificationStats(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date()
        };

        // Add yield management stats if enabled
        if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
            try {
                stats.yieldManagement = await yieldManager.getSystemStats();
                stats.revenueAnalytics = await revenueAnalytics.getQuickStats();
            } catch (yieldError) {
                console.error('Error getting yield stats:', yieldError);
                stats.yieldManagement = { error: 'Failed to load yield stats' };
            }
        }

        res.json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get system stats',
            error: error.message
        });
    }
});

// Export router and initialization function
module.exports = {
    router,
    initializeWebSocketIntegration
};

// For backward compatibility, also export just the router
module.exports.default = router;