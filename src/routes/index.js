/**
 * Main Routes Index - Complete Integration with Loyalty & Enterprise
 * Centralized route management with WebSocket, real-time endpoints, yield management, loyalty, and enterprise features
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

// Import Week 3 route modules (real-time + yield management)
const realtimeRoutes = require('./realtime');
const yieldRoutes = require('./yield');

// Import NEW route modules (loyalty + enterprise)
const loyaltyRoutes = require('./loyalty');
const enterpriseRoutes = require('./enterprise');

// Import middleware
const auth = require('../middleware/auth');
const roleAuth = require('../middleware/roleAuth');
const rateLimiter = require('../middleware/rateLimiter');
const realtimeAuth = require('../middleware/realtimeAuth');

// Import services for WebSocket, Yield Management, Loyalty, and Enterprise integration
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const yieldManager = require('../services/yieldManager');
const revenueAnalytics = require('../services/revenueAnalytics');
const { getLoyaltyService } = require('../services/loyaltyService');
const approvalService = require('../services/approvalService');
const enterpriseInvoicingService = require('../services/enterpriseInvoicingService');

/**
 * API Routes Registration with Complete Feature Set
 */

// ================================
// PUBLIC ROUTES (No Authentication)
// ================================
router.use('/auth', rateLimiter, authRoutes);

// Health check endpoint with comprehensive status
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
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? 'enabled' : 'disabled',
            loyaltyProgram: 'enabled',
            enterpriseFeatures: 'enabled'
        },
        features: {
            realTimeBooking: true,
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            loyaltyProgram: true,
            enterpriseApprovals: true,
            enterpriseInvoicing: true,
            dynamicPricing: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            webSocketSupport: socketService.io ? true : false
        }
    });
});

// Real-time service status endpoint with loyalty and enterprise metrics
router.get('/realtime/status', (req, res) => {
    res.json({
        socketConnections: socketService.getConnectionStats(),
        notificationService: notificationService.getServiceStatus(),
        yieldManagement: {
            enabled: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            status: process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? 'operational' : 'disabled'
        },
        loyaltyProgram: {
            enabled: true,
            activeMembers: 'available via API',
            pointsIssued: 'available via API'
        },
        enterpriseFeatures: {
            enabled: true,
            activeCompanies: 'available via API',
            pendingApprovals: 'available via API'
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
// LOYALTY PROGRAM ROUTES (NEW)
// ================================
// Complete loyalty program with points, tiers, redemptions, and analytics
router.use('/loyalty', loyaltyRoutes);

// ================================
// ENTERPRISE FEATURES ROUTES (NEW)
// ================================
// Enterprise management with companies, approvals, invoicing, and reporting
router.use('/enterprise', enterpriseRoutes);

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
// ENHANCED REAL-TIME AVAILABILITY WITH YIELD PRICING AND LOYALTY INTEGRATION
// ================================

/**
 * Real-time availability endpoint with dynamic pricing and loyalty benefits
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

        // Add loyalty program benefits if user is enrolled
        if (req.user && req.user.role === 'CLIENT') {
            try {
                const loyaltyService = getLoyaltyService();
                const loyaltyStatus = await loyaltyService.getLoyaltyStatus(req.user.id, { skipCache: true });
                
                if (loyaltyStatus.user.tier) {
                    availability.loyaltyBenefits = {
                        tier: loyaltyStatus.user.tier,
                        pointsMultiplier: loyaltyStatus.benefits.current.pointsMultiplier,
                        availableUpgrades: loyaltyStatus.benefits.active.filter(b => b.type === 'UPGRADE'),
                        pointsEarnable: Math.floor(availability.basePrice * loyaltyStatus.benefits.current.pointsMultiplier),
                        redemptionOptions: loyaltyStatus.redemption.options.slice(0, 3)
                    };
                }
            } catch (loyaltyError) {
                console.error('Error getting loyalty benefits:', loyaltyError);
                availability.loyaltyBenefits = null;
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
            loyaltyIntegrated: !!availability.loyaltyBenefits,
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
 * Real-time dynamic pricing endpoint with loyalty integration
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

        // Add loyalty pricing benefits if applicable
        if (req.user && req.user.role === 'CLIENT') {
            try {
                const loyaltyService = getLoyaltyService();
                const loyaltyStatus = await loyaltyService.getLoyaltyStatus(req.user.id, { skipCache: true });
                
                if (loyaltyStatus.user.tier && ['GOLD', 'PLATINUM', 'DIAMOND'].includes(loyaltyStatus.user.tier)) {
                    const tierDiscounts = {
                        'GOLD': 0.05,     // 5% discount
                        'PLATINUM': 0.10, // 10% discount
                        'DIAMOND': 0.15   // 15% discount
                    };
                    
                    const discount = tierDiscounts[loyaltyStatus.user.tier];
                    pricing.loyaltyDiscount = {
                        tier: loyaltyStatus.user.tier,
                        discountRate: discount,
                        discountAmount: pricing.finalPrice * discount,
                        finalPriceWithLoyalty: pricing.finalPrice * (1 - discount)
                    };
                }
            } catch (loyaltyError) {
                console.error('Error applying loyalty discount:', loyaltyError);
            }
        }

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
 * Real-time booking status endpoint with yield optimization and enterprise approval status
 * GET /api/realtime/booking/:bookingId/status
 */
router.get('/realtime/booking/:bookingId/status', auth, async (req, res) => {
    try {
        const { bookingId } = req.params;
        
        // Get current booking status
        const Booking = require('../models/Booking');
        const booking = await Booking.findById(bookingId)
            .populate('hotel')
            .populate('guestInfo.company')
            .populate('user');

        if (!booking) {
            return res.status(404).json({
                success: false,
                message: 'Booking not found'
            });
        }

        // Check if user has permission to view this booking
        const hasPermission = booking.customer.toString() === req.user.id || 
                             req.user.role === 'ADMIN' || 
                             req.user.role === 'RECEPTIONIST' ||
                             (booking.guestInfo.company && booking.guestInfo.company._id.toString() === req.user.company?.toString());

        if (!hasPermission) {
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

        // Add loyalty points information if applicable
        if (req.user.role === 'CLIENT' && booking.customer.toString() === req.user.id) {
            try {
                const loyaltyService = getLoyaltyService();
                const loyaltyStatus = await loyaltyService.getLoyaltyStatus(req.user.id, { skipCache: true });
                
                if (loyaltyStatus.user.tier) {
                    response.loyaltyInfo = {
                        currentPoints: loyaltyStatus.user.currentPoints,
                        tier: loyaltyStatus.user.tier,
                        pointsEarnable: Math.floor(booking.totalPrice * loyaltyStatus.benefits.current.pointsMultiplier),
                        estimatedValue: Math.floor(booking.totalPrice * loyaltyStatus.benefits.current.pointsMultiplier) / 100
                    };
                }
            } catch (loyaltyError) {
                console.error('Error getting loyalty info:', loyaltyError);
            }
        }

        // Add enterprise approval status if applicable
        if (booking.guestInfo.company && ['ADMIN', 'RECEPTIONIST', 'CLIENT'].includes(req.user.role)) {
            try {
                const ApprovalRequest = require('../models/ApprovalRequest');
                const approvalRequest = await ApprovalRequest.findOne({ booking: bookingId })
                    .populate('approvalChain.approver', 'firstName lastName')
                    .lean();

                if (approvalRequest) {
                    response.enterpriseApproval = {
                        status: approvalRequest.finalStatus,
                        currentLevel: approvalRequest.currentLevel,
                        totalLevels: approvalRequest.approvalChain.length,
                        progress: approvalRequest.progressPercentage,
                        currentApprover: approvalRequest.approvalChain.find(
                            step => step.level === approvalRequest.currentLevel
                        )?.approver,
                        isOverdue: approvalRequest.isOverdue,
                        deadline: approvalRequest.timeline.requiredBy
                    };
                }
            } catch (approvalError) {
                console.error('Error getting approval status:', approvalError);
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
 * Real-time revenue analytics endpoint with loyalty and enterprise metrics (Admin only)
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

        // Add loyalty program metrics
        try {
            const loyaltyService = getLoyaltyService();
            const loyaltyAnalytics = await loyaltyService.getGlobalLoyaltyAnalytics(period, hotelId);
            analytics.loyaltyMetrics = {
                activeMembers: loyaltyAnalytics.users.activeMembers,
                pointsIssued: loyaltyAnalytics.transactions.summary.totalEarned,
                pointsRedeemed: loyaltyAnalytics.transactions.summary.totalRedeemed,
                tierDistribution: loyaltyAnalytics.tiers,
                memberBookingValue: loyaltyAnalytics.users.totalLifetimePoints / 100 // Estimate
            };
        } catch (loyaltyError) {
            console.error('Error getting loyalty analytics:', loyaltyError);
            analytics.loyaltyMetrics = { error: 'Failed to load loyalty metrics' };
        }

        // Add enterprise metrics
        try {
            const Company = require('../models/Company');
            const enterpriseMetrics = await Company.aggregate([
                {
                    $group: {
                        _id: null,
                        totalCompanies: { $sum: 1 },
                        activeContracts: { 
                            $sum: { $cond: [{ $eq: ['$contract.isActive', true] }, 1, 0] }
                        },
                        totalRevenue: { $sum: '$statistics.totalSpent' },
                        averageCompanyValue: { $avg: '$statistics.totalSpent' }
                    }
                }
            ]);

            analytics.enterpriseMetrics = enterpriseMetrics[0] || {
                totalCompanies: 0,
                activeContracts: 0,
                totalRevenue: 0,
                averageCompanyValue: 0
            };
        } catch (enterpriseError) {
            console.error('Error getting enterprise analytics:', enterpriseError);
            analytics.enterpriseMetrics = { error: 'Failed to load enterprise metrics' };
        }

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
 * Trigger real-time notification endpoint with loyalty and enterprise context (Admin only)
 * POST /api/realtime/notify
 */
router.post('/realtime/notify', auth, roleAuth(['ADMIN']), async (req, res) => {
    try {
        const { type, userIds, message, priority = 'medium', context } = req.body;

        // Enhanced notification with context
        const results = await Promise.allSettled(
            userIds.map(userId => 
                notificationService.sendNotification({
                    type: type || 'ADMIN_MESSAGE',
                    userId,
                    channels: ['socket', 'in_app'],
                    data: { 
                        message, 
                        priority,
                        context: context || {},
                        sentBy: `${req.user.firstName} ${req.user.lastName}`,
                        timestamp: new Date()
                    },
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
            },
            context
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
 * WebSocket connection info endpoint with all features
 * GET /api/realtime/connection-info
 */
router.get('/realtime/connection-info', auth, (req, res) => {
    const isConnected = socketService.isUserConnected(req.user.id);
    const stats = socketService.getConnectionStats();

    res.json({
        user: {
            id: req.user.id,
            connected: isConnected,
            role: req.user.role,
            company: req.user.company || null
        },
        server: {
            totalConnections: stats.totalConnections,
            status: 'operational'
        },
        features: {
            // Core features
            liveAvailability: true,
            instantBookings: true,
            realTimeNotifications: true,
            adminValidation: req.user.role === 'ADMIN',
            
            // Yield management features
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            dynamicPricing: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
            revenueOptimization: process.env.YIELD_MANAGEMENT_ENABLED === 'true' && ['ADMIN', 'RECEPTIONIST'].includes(req.user.role),
            
            // Loyalty program features
            loyaltyProgram: true,
            pointsTracking: req.user.role === 'CLIENT',
            tierBenefits: req.user.role === 'CLIENT',
            redemptionOptions: req.user.role === 'CLIENT',
            
            // Enterprise features
            enterpriseFeatures: !!req.user.company,
            approvalWorkflow: !!req.user.company,
            enterpriseReporting: !!req.user.company && ['company_admin', 'manager'].includes(req.user.userType),
            invoiceManagement: !!req.user.company && req.user.userType === 'company_admin'
        }
    });
});

// ================================
// YIELD MANAGEMENT INTEGRATION ENDPOINTS (Enhanced)
// ================================

/**
 * Trigger demand analysis for a hotel with loyalty and enterprise context (Admin only)
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
        const { includeLoyalty = true, includeEnterprise = true } = req.body;
        
        // Trigger immediate demand analysis
        const analysis = await yieldManager.triggerDemandAnalysis(hotelId);

        // Enhance with loyalty data if requested
        if (includeLoyalty) {
            try {
                const loyaltyService = getLoyaltyService();
                const loyaltyAnalytics = await loyaltyService.getGlobalLoyaltyAnalytics('30d', hotelId);
                analysis.loyaltyImpact = {
                    memberBookingRate: loyaltyAnalytics.users.activeMembers / loyaltyAnalytics.users.totalMembers,
                    averageSpendPerMember: loyaltyAnalytics.users.totalLifetimePoints / 100,
                    tierDistribution: loyaltyAnalytics.tiers
                };
            } catch (loyaltyError) {
                console.error('Error getting loyalty impact:', loyaltyError);
            }
        }

        // Enhance with enterprise data if requested
        if (includeEnterprise) {
            try {
                const Booking = require('../models/Booking');
                const enterpriseBookings = await Booking.aggregate([
                    {
                        $match: {
                            hotel: mongoose.Types.ObjectId(hotelId),
                            'guestInfo.company': { $exists: true },
                            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                        }
                    },
                    {
                        $group: {
                            _id: null,
                            totalBookings: { $sum: 1 },
                            totalRevenue: { $sum: '$totalAmount' },
                            averageValue: { $avg: '$totalAmount' }
                        }
                    }
                ]);

                analysis.enterpriseImpact = enterpriseBookings[0] || {
                    totalBookings: 0,
                    totalRevenue: 0,
                    averageValue: 0
                };
            } catch (enterpriseError) {
                console.error('Error getting enterprise impact:', enterpriseError);
            }
        }

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
 * Get comprehensive yield management dashboard data (Admin only)
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

        // Enhance with loyalty program performance
        try {
            const loyaltyService = getLoyaltyService();
            const loyaltyMetrics = await loyaltyService.getGlobalLoyaltyAnalytics('30d');
            dashboardData.loyaltyPerformance = {
                memberConversion: loyaltyMetrics.users.activeMembers / loyaltyMetrics.users.totalMembers,
                pointsUtilization: loyaltyMetrics.transactions.summary.totalRedeemed / loyaltyMetrics.transactions.summary.totalEarned,
                tierUpgrades: loyaltyMetrics.tiers.filter(t => t.count > 0).length,
                memberValue: loyaltyMetrics.users.totalLifetimePoints / loyaltyMetrics.users.totalMembers
            };
        } catch (loyaltyError) {
            console.error('Error getting loyalty performance:', loyaltyError);
        }

        // Enhance with enterprise performance
        try {
            const ApprovalRequest = require('../models/ApprovalRequest');
            const enterpriseMetrics = await ApprovalRequest.aggregate([
                {
                    $match: {
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: '$finalStatus',
                        count: { $sum: 1 },
                        avgProcessingTime: { $avg: '$timeline.processingTime' }
                    }
                }
            ]);

            dashboardData.enterprisePerformance = {
                approvalMetrics: enterpriseMetrics,
                avgApprovalTime: enterpriseMetrics.reduce((sum, m) => sum + (m.avgProcessingTime || 0), 0) / enterpriseMetrics.length || 0
            };
        } catch (enterpriseError) {
            console.error('Error getting enterprise performance:', enterpriseError);
        }

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
// INTEGRATED BOOKING WORKFLOW ENDPOINT
// ================================

/**
 * Complete booking workflow with yield, loyalty, and enterprise integration
 * POST /api/integrated/booking/complete
 */
router.post('/integrated/booking/complete', auth, async (req, res) => {
    try {
        const { 
            hotelId, 
            roomType, 
            checkIn, 
            checkOut, 
            guestInfo,
            usePoints = 0,
            requiresApproval = false
        } = req.body;

        const bookingSession = await mongoose.startSession();
        
        try {
            const result = await bookingSession.withTransaction(async () => {
                // 1. Get dynamic pricing if yield management enabled
                let finalPrice = req.body.basePrice;
                let yieldData = null;
                
                if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                    const pricing = await yieldManager.getDynamicPricing(hotelId, roomType, new Date(checkIn));
                    finalPrice = pricing.finalPrice;
                    yieldData = pricing;
                }

                // 2. Apply loyalty discounts and calculate points
                let loyaltyData = null;
                let pointsDiscount = 0;
                
                if (req.user.role === 'CLIENT') {
                    const loyaltyService = getLoyaltyService();
                    const loyaltyStatus = await loyaltyService.getLoyaltyStatus(req.user.id);
                    
                    if (loyaltyStatus.user.tier) {
                        // Apply tier discount
                        const tierDiscounts = { 'GOLD': 0.05, 'PLATINUM': 0.10, 'DIAMOND': 0.15 };
                        const tierDiscount = tierDiscounts[loyaltyStatus.user.tier] || 0;
                        finalPrice *= (1 - tierDiscount);
                        
                        // Apply points redemption
                        if (usePoints > 0) {
                            const redemptionResult = await loyaltyService.checkDiscountEligibility(req.user.id, usePoints / 100);
                            if (redemptionResult.eligible) {
                                pointsDiscount = usePoints / 100;
                                finalPrice -= pointsDiscount;
                            }
                        }
                        
                        loyaltyData = {
                            tier: loyaltyStatus.user.tier,
                            tierDiscount,
                            pointsUsed: usePoints,
                            pointsDiscount,
                            pointsToEarn: Math.floor(finalPrice * loyaltyStatus.benefits.current.pointsMultiplier)
                        };
                    }
                }

                // 3. Create booking
                const Booking = require('../models/Booking');
                const booking = new Booking({
                    hotel: hotelId,
                    room: req.body.roomId,
                    user: req.user.id,
                    customer: req.user.id,
                    checkInDate: new Date(checkIn),
                    checkOutDate: new Date(checkOut),
                    numberOfNights: Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)),
                    guestInfo,
                    baseAmount: req.body.basePrice,
                    totalPrice: finalPrice,
                    status: requiresApproval ? 'pending_approval' : 'confirmed',
                    metadata: {
                        yieldOptimized: !!yieldData,
                        loyaltyApplied: !!loyaltyData,
                        enterpriseBooking: !!guestInfo.company
                    }
                });

                await booking.save({ session: bookingSession });

                // 4. Handle enterprise approval workflow if needed
                let approvalData = null;
                if (requiresApproval && guestInfo.company) {
                    const approvalResult = await approvalService.createApprovalRequest(
                        {
                            bookingId: booking._id,
                            totalAmount: finalPrice,
                            checkInDate: checkIn,
                            checkOutDate: checkOut,
                            hotelName: req.body.hotelName
                        },
                        req.user.id,
                        req.body.businessJustification || {
                            purpose: 'Business travel',
                            urgencyLevel: 'medium'
                        }
                    );

                    if (approvalResult.requiresApproval) {
                        approvalData = {
                            approvalId: approvalResult.approvalId,
                            estimatedTime: approvalResult.estimatedTime,
                            nextApprovers: approvalResult.nextApprovers,
                            deadline: approvalResult.deadline
                        };
                    }
                }

                // 5. Process loyalty points
                if (loyaltyData && loyaltyData.pointsUsed > 0) {
                    await loyaltyService.redeemPointsForDiscount(
                        req.user.id,
                        loyaltyData.pointsUsed,
                        booking._id
                    );
                }

                return {
                    booking,
                    yieldData,
                    loyaltyData,
                    approvalData,
                    finalPrice
                };
            });

            // 6. Send real-time notifications
            if (result.approvalData) {
                socketService.sendUserNotification(req.user.id, 'BOOKING_PENDING_APPROVAL', {
                    bookingId: result.booking._id,
                    message: 'Votre réservation est en attente d\'approbation',
                    approvalId: result.approvalData.approvalId
                });
            } else {
                socketService.sendUserNotification(req.user.id, 'BOOKING_CONFIRMED', {
                    bookingId: result.booking._id,
                    message: 'Votre réservation a été confirmée',
                    loyaltyPoints: result.loyaltyData?.pointsToEarn || 0
                });

                // Award loyalty points if booking is confirmed
                if (result.loyaltyData && !requiresApproval) {
                    setTimeout(async () => {
                        try {
                            const loyaltyService = getLoyaltyService();
                            await loyaltyService.awardBookingPoints(result.booking._id, req.user.id);
                        } catch (loyaltyError) {
                            console.error('Error awarding loyalty points:', loyaltyError);
                        }
                    }, 1000);
                }
            }

            res.json({
                success: true,
                message: requiresApproval ? 'Booking created - pending approval' : 'Booking confirmed successfully',
                data: {
                    bookingId: result.booking._id,
                    bookingNumber: result.booking.bookingNumber,
                    status: result.booking.status,
                    finalPrice: result.finalPrice,
                    yieldOptimization: result.yieldData,
                    loyaltyBenefits: result.loyaltyData,
                    enterpriseApproval: result.approvalData
                }
            });

        } finally {
            await bookingSession.endSession();
        }

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to complete integrated booking',
            error: error.message
        });
    }
});

// ================================
// COMPREHENSIVE DASHBOARD ENDPOINT
// ================================

/**
 * Get comprehensive dashboard data for all user types
 * GET /api/dashboard/comprehensive
 */
router.get('/dashboard/comprehensive', auth, async (req, res) => {
    try {
        const dashboardData = {
            user: {
                id: req.user.id,
                role: req.user.role,
                userType: req.user.userType,
                company: req.user.company
            },
            timestamp: new Date()
        };

        // Get user-specific data based on role
        switch (req.user.role) {
            case 'CLIENT':
                // Client dashboard with loyalty and booking data
                const Booking = require('../models/Booking');
                const recentBookings = await Booking.find({ 
                    customer: req.user.id 
                })
                .sort({ createdAt: -1 })
                .limit(5)
                .populate('hotel', 'name city');

                dashboardData.client = {
                    recentBookings: recentBookings.map(b => ({
                        id: b._id,
                        hotelName: b.hotel.name,
                        status: b.status,
                        checkIn: b.checkInDate,
                        amount: b.totalPrice
                    })),
                    bookingStats: {
                        total: await Booking.countDocuments({ customer: req.user.id }),
                        thisMonth: await Booking.countDocuments({
                            customer: req.user.id,
                            createdAt: { $gte: new Date(new Date().setDate(1)) }
                        })
                    }
                };

                // Add loyalty data if enrolled
                try {
                    const loyaltyService = getLoyaltyService();
                    const loyaltyStatus = await loyaltyService.getLoyaltyStatus(req.user.id, { skipCache: true });
                    dashboardData.loyalty = {
                        tier: loyaltyStatus.user.tier,
                        currentPoints: loyaltyStatus.user.currentPoints,
                        tierProgress: loyaltyStatus.user.tierProgress,
                        recentTransactions: loyaltyStatus.transactions.recent.slice(0, 3),
                        redemptionOptions: loyaltyStatus.redemption.options.slice(0, 3)
                    };
                } catch (loyaltyError) {
                    console.error('Error getting loyalty data:', loyaltyError);
                }

                // Add enterprise data if applicable
                if (req.user.company) {
                    const ApprovalRequest = require('../models/ApprovalRequest');
                    const pendingApprovals = await ApprovalRequest.countDocuments({
                        requester: req.user.id,
                        finalStatus: 'pending'
                    });

                    dashboardData.enterprise = {
                        pendingApprovals,
                        companyName: req.user.companyName
                    };
                }
                break;

            case 'ADMIN':
                // Admin comprehensive dashboard
                const Hotel = require('../models/Hotel');
                const User = require('../models/User');
                
                const [
                    totalHotels,
                    totalUsers,
                    totalBookings,
                    totalCompanies
                ] = await Promise.all([
                    Hotel.countDocuments({ isActive: true }),
                    User.countDocuments({ isActive: true }),
                    Booking.countDocuments(),
                    mongoose.model('Company').countDocuments({ status: 'active' })
                ]);

                dashboardData.admin = {
                    overview: {
                        totalHotels,
                        totalUsers,
                        totalBookings,
                        totalCompanies
                    }
                };

                // Add yield management data if enabled
                if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                    try {
                        const yieldSummary = await yieldManager.getDashboardData();
                        dashboardData.admin.yieldManagement = yieldSummary;
                    } catch (yieldError) {
                        console.error('Error getting yield data:', yieldError);
                    }
                }

                // Add loyalty program analytics
                try {
                    const loyaltyService = getLoyaltyService();
                    const loyaltyAnalytics = await loyaltyService.getGlobalLoyaltyAnalytics('30d');
                    dashboardData.admin.loyaltyProgram = {
                        totalMembers: loyaltyAnalytics.users.totalMembers,
                        activeMembers: loyaltyAnalytics.users.activeMembers,
                        pointsIssued: loyaltyAnalytics.transactions.summary.totalEarned,
                        tierDistribution: loyaltyAnalytics.tiers
                    };
                } catch (loyaltyError) {
                    console.error('Error getting loyalty analytics:', loyaltyError);
                }

                // Add enterprise analytics
                try {
                    const enterpriseStats = await ApprovalRequest.aggregate([
                        {
                            $group: {
                                _id: '$finalStatus',
                                count: { $sum: 1 }
                            }
                        }
                    ]);

                    dashboardData.admin.enterprise = {
                        totalCompanies,
                        approvalStats: enterpriseStats
                    };
                } catch (enterpriseError) {
                    console.error('Error getting enterprise analytics:', enterpriseError);
                }
                break;

            case 'RECEPTIONIST':
                // Receptionist dashboard with operational data
                const todayBookings = await Booking.find({
                    checkInDate: {
                        $gte: new Date().setHours(0, 0, 0, 0),
                        $lt: new Date().setHours(23, 59, 59, 999)
                    }
                }).populate('hotel user');

                dashboardData.receptionist = {
                    todayCheckIns: todayBookings.filter(b => b.status === 'confirmed').length,
                    pendingApprovals: await ApprovalRequest.countDocuments({
                        finalStatus: 'pending'
                    }),
                    recentBookings: todayBookings.slice(0, 10).map(b => ({
                        id: b._id,
                        guestName: `${b.user.firstName} ${b.user.lastName}`,
                        hotel: b.hotel.name,
                        status: b.status,
                        checkIn: b.checkInDate
                    }))
                };
                break;

            default:
                // Enterprise user dashboard
                if (req.user.company) {
                    const companyBookings = await Booking.find({
                        'guestInfo.company': req.user.company
                    })
                    .sort({ createdAt: -1 })
                    .limit(5)
                    .populate('hotel user');

                    dashboardData.enterprise = {
                        recentBookings: companyBookings.map(b => ({
                            id: b._id,
                            employee: `${b.user.firstName} ${b.user.lastName}`,
                            hotel: b.hotel.name,
                            status: b.status,
                            amount: b.totalPrice
                        })),
                        pendingApprovals: req.user.userType === 'manager' || req.user.userType === 'company_admin' 
                            ? await ApprovalRequest.countDocuments({
                                company: req.user.company,
                                finalStatus: 'pending'
                            })
                            : await ApprovalRequest.countDocuments({
                                requester: req.user.id,
                                finalStatus: 'pending'
                            })
                    };
                }
        }

        res.json({
            success: true,
            data: dashboardData
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to get dashboard data',
            error: error.message
        });
    }
});

// ================================
// ERROR HANDLING ROUTES
// ================================

// Real-time error reporting endpoint
router.post('/realtime/error', auth, (req, res) => {
    const { error, context, timestamp, feature } = req.body;
    
    // Log real-time errors for monitoring with feature context
    console.error('Real-time client error:', {
        userId: req.user.id,
        userRole: req.user.role,
        feature: feature || 'unknown',
        error,
        context,
        timestamp: timestamp || new Date()
    });

    res.status(200).json({ received: true });
});

// API documentation route with complete feature set
router.get('/docs', (req, res) => {
    res.json({
        message: 'Hotel Management API - Complete Integration with Loyalty & Enterprise',
        version: '4.0.0',
        lastUpdated: new Date().toISOString(),
        documentation: {
            swagger: '/api/docs/swagger',
            realtime: '/api/docs/realtime',
            websockets: '/api/docs/websockets',
            yieldManagement: '/api/docs/yield',
            loyaltyProgram: '/api/docs/loyalty',
            enterpriseFeatures: '/api/docs/enterprise'
        },
        endpoints: {
            core: {
                authentication: '/api/auth',
                hotels: '/api/hotels',
                bookings: '/api/bookings',
                users: '/api/users'
            },
            realtime: {
                realtime: '/api/realtime',
                availability: '/api/realtime/availability/:hotelId',
                pricing: '/api/realtime/pricing/:hotelId'
            },
            yieldManagement: {
                yield: '/api/yield',
                dashboard: '/api/yield/dashboard',
                analysis: '/api/yield/trigger/demand-analysis/:hotelId'
            },
            loyaltyProgram: {
                loyalty: '/api/loyalty',
                status: '/api/loyalty/status',
                history: '/api/loyalty/history',
                redeem: '/api/loyalty/redeem/*',
                admin: '/api/loyalty/admin/*'
            },
            enterprise: {
                enterprise: '/api/enterprise',
                dashboard: '/api/enterprise/dashboard/:companyId',
                approvals: '/api/enterprise/approvals/:companyId',
                invoices: '/api/enterprise/invoices/:companyId'
            },
            integrated: {
                booking: '/api/integrated/booking/complete',
                dashboard: '/api/dashboard/comprehensive'
            },
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
                'admin-notification',
                'loyalty-points-earned',
                'approval-request',
                'approval-decision',
                'invoice-generated'
            ]
        },
        features: {
            core: [
                'hotel-management',
                'booking-system',
                'user-management',
                'authentication'
            ],
            realtime: [
                'live-availability',
                'instant-bookings',
                'real-time-notifications',
                'websocket-support'
            ],
            yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true' ? [
                'dynamic-pricing',
                'demand-analysis',
                'revenue-optimization',
                'automated-jobs',
                'performance-monitoring'
            ] : ['disabled'],
            loyaltyProgram: [
                'points-system',
                'tier-management',
                'redemption-options',
                'campaign-management',
                'analytics-reporting'
            ],
            enterprise: [
                'company-management',
                'approval-workflow',
                'automated-invoicing',
                'employee-management',
                'reporting-analytics'
            ],
            integrations: [
                'yield-loyalty-integration',
                'enterprise-approval-workflow',
                'loyalty-enterprise-reporting',
                'real-time-cross-feature-updates'
            ]
        },
        authentication: {
            required: true,
            type: 'Bearer JWT',
            roles: ['CLIENT', 'RECEPTIONIST', 'ADMIN'],
            enterpriseTypes: ['employee', 'manager', 'company_admin']
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
            '/api/loyalty',
            '/api/enterprise',
            '/api/admin',
            '/api/health',
            '/api/docs'
        ],
        features: [
            'Real-time booking system',
            'Yield management with dynamic pricing',
            'Complete loyalty program',
            'Enterprise approval workflow',
            'Automated invoicing',
            'WebSocket real-time updates'
        ]
    });
});

// ================================
// WEBSOCKET & SERVICES INITIALIZATION HELPER
// ================================

/**
 * Initialize WebSocket integration with HTTP server and all services
 * This should be called from app.js after server creation
 */
function initializeWebSocketIntegration(server) {
    // Initialize Socket.io with HTTP server
    socketService.initialize(server);

    // Set up real-time event listeners for all features
    setupRealtimeEventListeners();

    console.log('✅ Complete WebSocket integration initialized successfully');
}

/**
 * Setup real-time event listeners for all integrated features
 */
function setupRealtimeEventListeners() {
    // Core booking events
    notificationService.on('availability:changed', (data) => {
        socketService.broadcastAvailabilityUpdate(data.hotelId, data.availability);
    });

    notificationService.on('booking:status_changed', (data) => {
        socketService.sendBookingNotification(data.bookingId, 'status_changed', data);
    });

    notificationService.on('admin:notification', (data) => {
        socketService.sendAdminNotification(data.type, data);
    });

    // Yield Management real-time events
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        yieldManager.on('price:updated', (data) => {
            socketService.broadcastPriceUpdate(data.hotelId, data);
        });

        yieldManager.on('demand:surge', (data) => {
            socketService.sendAdminNotification('demand_surge', data);
        });

        yieldManager.on('occupancy:critical', (data) => {
            socketService.sendAdminNotification('occupancy_critical', data);
        });

        yieldManager.on('revenue:optimization', (data) => {
            socketService.sendAdminNotification('revenue_optimization', data);
        });
    }

    // Loyalty Program real-time events
    const loyaltyService = getLoyaltyService();
    loyaltyService.on?.('points:earned', (data) => {
        socketService.sendUserNotification(data.userId, 'LOYALTY_POINTS_EARNED', {
            points: data.points,
            tier: data.tier,
            booking: data.booking
        });
    });

    loyaltyService.on?.('tier:upgraded', (data) => {
        socketService.sendUserNotification(data.userId, 'LOYALTY_TIER_UPGRADED', {
            oldTier: data.oldTier,
            newTier: data.newTier,
            bonusPoints: data.bonusPoints
        });
    });

    loyaltyService.on?.('points:redeemed', (data) => {
        socketService.sendUserNotification(data.userId, 'LOYALTY_POINTS_REDEEMED', {
            pointsUsed: data.pointsUsed,
            benefit: data.benefit,
            remainingPoints: data.remainingPoints
        });
    });

    // Enterprise approval workflow events
    approvalService.on?.('approval:requested', (data) => {
        socketService.sendUserNotification(data.approverId, 'APPROVAL_REQUEST', {
            approvalId: data.approvalId,
            requester: data.requester,
            amount: data.amount,
            urgency: data.urgency
        });
    });

    approvalService.on?.('approval:decided', (data) => {
        socketService.sendUserNotification(data.requesterId, 'APPROVAL_DECISION', {
            approvalId: data.approvalId,
            decision: data.decision,
            approver: data.approver,
            comments: data.comments
        });
    });

    approvalService.on?.('approval:escalated', (data) => {
        socketService.sendUserNotification(data.escalatedTo, 'APPROVAL_ESCALATED', {
            approvalId: data.approvalId,
            level: data.level,
            originalApprover: data.originalApprover
        });
    });

    // Enterprise invoicing events
    enterpriseInvoicingService.on?.('invoice:generated', (data) => {
        socketService.sendCompanyNotification(data.companyId, 'INVOICE_GENERATED', {
            invoiceId: data.invoiceId,
            invoiceNumber: data.invoiceNumber,
            amount: data.amount,
            dueDate: data.dueDate
        });
    });

    enterpriseInvoicingService.on?.('payment:received', (data) => {
        socketService.sendCompanyNotification(data.companyId, 'PAYMENT_RECEIVED', {
            invoiceId: data.invoiceId,
            amount: data.amount,
            paymentDate: data.paymentDate
        });
    });

    enterpriseInvoicingService.on?.('invoice:overdue', (data) => {
        socketService.sendCompanyNotification(data.companyId, 'INVOICE_OVERDUE', {
            invoiceId: data.invoiceId,
            amount: data.amount,
            daysOverdue: data.daysOverdue
        });
    });
}

// ================================
// COMPREHENSIVE SYSTEM MONITORING
// ================================

/**
 * Real-time API usage statistics with all features metrics
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

        // Add loyalty program stats
        try {
            const loyaltyService = getLoyaltyService();
            stats.loyaltyProgram = await loyaltyService.getGlobalLoyaltyAnalytics('24h');
        } catch (loyaltyError) {
            console.error('Error getting loyalty stats:', loyaltyError);
            stats.loyaltyProgram = { error: 'Failed to load loyalty stats' };
        }

        // Add enterprise stats
        try {
            const ApprovalRequest = require('../models/ApprovalRequest');
            const Company = require('../models/Company');
            
            const [pendingApprovals, activeCompanies] = await Promise.all([
                ApprovalRequest.countDocuments({ finalStatus: 'pending' }),
                Company.countDocuments({ status: 'active' })
            ]);

            stats.enterprise = {
                pendingApprovals,
                activeCompanies,
                lastInvoicingRun: 'available via enterprise service'
            };
        } catch (enterpriseError) {
            console.error('Error getting enterprise stats:', enterpriseError);
            stats.enterprise = { error: 'Failed to load enterprise stats' };
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