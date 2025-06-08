/**
 * Admin Real-time Service - Week 3
 * Handles live admin dashboard data, real-time validation workflow, and admin notifications
 * Integrates with Socket.io for instant updates and notifications
 */

const EventEmitter = require('events');
const socketService = require('./socketService');
const notificationService = require('./notificationService');
const emailService = require('./emailService');
const smsService = require('./smsService');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const { logger } = require('../utils/logger');

class AdminRealtimeService extends EventEmitter {
    constructor() {
        super();
        this.connectedAdmins = new Set();
        this.pendingValidations = new Map(); // bookingId -> validation data
        this.dashboardStats = new Map(); // Real-time dashboard statistics
        this.adminSessions = new Map(); // adminId -> session data
        this.validationQueue = []; // Priority queue for validations
        
        // Dashboard refresh intervals
        this.statsInterval = null;
        this.alertsInterval = null;
        
        this.initializeService();
    }

    /**
     * Initialize admin real-time service
     */
    initializeService() {
        this.setupEventListeners();
        this.startDashboardUpdates();
        logger.info('Admin Real-time Service initialized successfully');
    }

    /**
     * Setup event listeners for real-time updates
     */
    setupEventListeners() {
        // Booking events
        this.on('booking:pending_validation', this.handleBookingPendingValidation.bind(this));
        this.on('booking:validated', this.handleBookingValidated.bind(this));
        this.on('booking:urgent_review', this.handleUrgentBookingReview.bind(this));
        
        // System events
        this.on('system:alert', this.handleSystemAlert.bind(this));
        this.on('system:performance_warning', this.handlePerformanceWarning.bind(this));
        this.on('system:security_alert', this.handleSecurityAlert.bind(this));
        
        // Revenue events
        this.on('revenue:threshold_reached', this.handleRevenueThreshold.bind(this));
        this.on('revenue:anomaly_detected', this.handleRevenueAnomaly.bind(this));
        
        // Hotel events
        this.on('hotel:capacity_warning', this.handleCapacityWarning.bind(this));
        this.on('hotel:maintenance_required', this.handleMaintenanceAlert.bind(this));
    }

    /**
     * Start real-time dashboard updates
     */
    startDashboardUpdates() {
        // Update dashboard stats every 30 seconds
        this.statsInterval = setInterval(async () => {
            await this.updateDashboardStats();
        }, 30000);

        // Check for alerts every 10 seconds
        this.alertsInterval = setInterval(async () => {
            await this.checkAndSendAlerts();
        }, 10000);

        // Initial dashboard data load
        this.updateDashboardStats();
    }

    /**
     * Register admin for real-time updates
     * @param {String} adminId - Admin user ID
     * @param {Object} sessionData - Session information
     */
    async registerAdmin(adminId, sessionData = {}) {
        try {
            const admin = await User.findById(adminId);
            if (!admin || admin.role !== 'ADMIN') {
                throw new Error('Invalid admin user');
            }

            this.connectedAdmins.add(adminId);
            this.adminSessions.set(adminId, {
                ...sessionData,
                connectedAt: new Date(),
                lastActivity: new Date(),
                permissions: admin.permissions || []
            });

            // Send initial dashboard data
            await this.sendInitialDashboardData(adminId);

            // Notify other admins
            this.broadcastToAdmins('admin:user_connected', {
                adminId,
                adminName: `${admin.firstName} ${admin.lastName}`,
                timestamp: new Date()
            }, [adminId]); // Exclude the connecting admin

            logger.info(`Admin ${adminId} registered for real-time updates`);
            return true;
        } catch (error) {
            logger.error(`Failed to register admin ${adminId}:`, error);
            throw error;
        }
    }

    /**
     * Unregister admin from real-time updates
     * @param {String} adminId - Admin user ID
     */
    unregisterAdmin(adminId) {
        this.connectedAdmins.delete(adminId);
        this.adminSessions.delete(adminId);

        // Notify other admins
        this.broadcastToAdmins('admin:user_disconnected', {
            adminId,
            timestamp: new Date()
        });

        logger.info(`Admin ${adminId} unregistered from real-time updates`);
    }

    /**
     * Send initial dashboard data to newly connected admin
     * @param {String} adminId - Admin user ID
     */
    async sendInitialDashboardData(adminId) {
        try {
            const dashboardData = await this.generateDashboardData();
            
            socketService.sendUserNotification(adminId, 'dashboard:initial_data', {
                ...dashboardData,
                timestamp: new Date()
            });

            logger.info(`Initial dashboard data sent to admin ${adminId}`);
        } catch (error) {
            logger.error(`Failed to send initial dashboard data to admin ${adminId}:`, error);
        }
    }

    /**
     * Generate comprehensive dashboard data
     */
    async generateDashboardData() {
        try {
            const now = new Date();
            const todayStart = new Date(now.setHours(0, 0, 0, 0));
            const weekStart = new Date(now.setDate(now.getDate() - 7));

            // Get real-time statistics
            const [
                pendingBookings,
                todayBookings,
                weekBookings,
                totalRevenue,
                occupancyRates,
                systemAlerts,
                recentActivities
            ] = await Promise.all([
                this.getPendingBookingsCount(),
                this.getTodayBookingsCount(),
                this.getWeekBookingsCount(),
                this.getTotalRevenue(),
                this.getOccupancyRates(),
                this.getActiveSystemAlerts(),
                this.getRecentActivities()
            ]);

            return {
                stats: {
                    pendingValidations: pendingBookings,
                    todayBookings: todayBookings,
                    weekBookings: weekBookings,
                    totalRevenue: totalRevenue,
                    occupancyRates: occupancyRates
                },
                alerts: systemAlerts,
                recentActivities: recentActivities,
                validationQueue: this.getValidationQueueSummary(),
                connectedAdmins: this.connectedAdmins.size,
                systemHealth: await this.getSystemHealthStatus()
            };
        } catch (error) {
            logger.error('Failed to generate dashboard data:', error);
            throw error;
        }
    }

    /**
     * Real-time booking validation workflow
     * @param {String} bookingId - Booking ID to validate
     * @param {String} adminId - Admin performing validation
     * @param {String} action - Validation action (approve/reject)
     * @param {String} comment - Admin comment
     */
    async validateBookingRealtime(bookingId, adminId, action, comment = null) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                throw new Error('Booking not found');
            }

            if (booking.status !== 'PENDING') {
                throw new Error('Booking is not pending validation');
            }

            // Update booking status
            const newStatus = action === 'approve' ? 'CONFIRMED' : 'REJECTED';
            booking.status = newStatus;
            booking.adminValidation = {
                adminId,
                action,
                comment,
                timestamp: new Date()
            };

            await booking.save();

            // Real-time notifications to all stakeholders
            await this.notifyBookingValidation(booking, action, comment);

            // Update dashboard stats in real-time
            await this.updateDashboardStatsAfterValidation(action);

            // Remove from pending validations
            this.pendingValidations.delete(bookingId);

            // Broadcast validation to all admins
            this.broadcastToAdmins('booking:validation_completed', {
                bookingId,
                action,
                adminId,
                customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                hotelName: booking.hotel.name,
                amount: booking.totalAmount,
                timestamp: new Date()
            });

            logger.info(`Booking ${bookingId} ${action}d by admin ${adminId} in real-time`);
            return {
                success: true,
                bookingId,
                newStatus,
                action,
                timestamp: new Date()
            };

        } catch (error) {
            logger.error(`Real-time booking validation failed for ${bookingId}:`, error);
            throw error;
        }
    }

    /**
     * Handle new booking pending validation
     * @param {Object} bookingData - Booking data
     */
    async handleBookingPendingValidation(bookingData) {
        try {
            const { bookingId, userId, priority = 'NORMAL' } = bookingData;
            
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                logger.error(`Booking ${bookingId} not found for validation`);
                return;
            }

            // Add to validation queue
            const validationItem = {
                bookingId,
                customerId: userId,
                customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                hotelName: booking.hotel.name,
                checkInDate: booking.checkInDate,
                checkOutDate: booking.checkOutDate,
                totalAmount: booking.totalAmount,
                priority,
                submittedAt: new Date(),
                urgencyScore: this.calculateUrgencyScore(booking)
            };

            this.pendingValidations.set(bookingId, validationItem);
            this.addToValidationQueue(validationItem);

            // Broadcast to all admins
            this.broadcastToAdmins('booking:new_validation_required', {
                ...validationItem,
                message: `New booking validation required from ${validationItem.customerName}`
            });

            // Send urgent notification if high priority
            if (priority === 'HIGH' || validationItem.urgencyScore > 8) {
                await this.sendUrgentValidationAlert(validationItem);
            }

            logger.info(`Booking ${bookingId} added to admin validation queue`);
        } catch (error) {
            logger.error('Failed to handle booking pending validation:', error);
        }
    }

    /**
     * Send urgent validation alert to admins
     * @param {Object} validationItem - Validation item data
     */
    async sendUrgentValidationAlert(validationItem) {
        const alertData = {
            type: 'URGENT_VALIDATION',
            title: 'Urgent Booking Validation Required',
            message: `High-priority booking from ${validationItem.customerName} requires immediate attention`,
            data: validationItem,
            timestamp: new Date()
        };

        // Send real-time alert
        this.broadcastToAdmins('alert:urgent_validation', alertData);

        // Send email to all admins if very urgent
        if (validationItem.urgencyScore > 9) {
            const admins = await User.find({ role: 'ADMIN' });
            for (const admin of admins) {
                await emailService.sendUrgentNotification(admin, alertData.message);
            }
        }
    }

    /**
     * Calculate urgency score for booking validation
     * @param {Object} booking - Booking object
     * @returns {Number} Urgency score (1-10)
     */
    calculateUrgencyScore(booking) {
        let score = 5; // Base score

        // Check-in date proximity
        const daysUntilCheckIn = Math.ceil((booking.checkInDate - new Date()) / (1000 * 60 * 60 * 24));
        if (daysUntilCheckIn <= 1) score += 3;
        else if (daysUntilCheckIn <= 3) score += 2;
        else if (daysUntilCheckIn <= 7) score += 1;

        // Booking amount
        if (booking.totalAmount > 1000) score += 2;
        else if (booking.totalAmount > 500) score += 1;

        // Number of rooms
        if (booking.rooms.length > 3) score += 1;

        // Enterprise customer
        if (booking.customer.role === 'ENTERPRISE') score += 1;

        return Math.min(score, 10);
    }

    /**
     * Add booking to validation queue with priority sorting
     * @param {Object} validationItem - Validation item
     */
    addToValidationQueue(validationItem) {
        this.validationQueue.push(validationItem);
        
        // Sort by urgency score (highest first) and submission time
        this.validationQueue.sort((a, b) => {
            if (a.urgencyScore !== b.urgencyScore) {
                return b.urgencyScore - a.urgencyScore;
            }
            return a.submittedAt - b.submittedAt;
        });

        // Broadcast updated queue to admins
        this.broadcastToAdmins('validation_queue:updated', {
            queueLength: this.validationQueue.length,
            nextItem: this.validationQueue[0] || null,
            timestamp: new Date()
        });
    }

    /**
     * Notify all stakeholders about booking validation
     * @param {Object} booking - Booking object
     * @param {String} action - Validation action
     * @param {String} comment - Admin comment
     */
    async notifyBookingValidation(booking, action, comment) {
        try {
            // Notify customer via notification service
            if (action === 'approve') {
                notificationService.emit('booking:confirmed', {
                    bookingId: booking._id,
                    userId: booking.customer._id,
                    adminComment: comment
                });
            } else {
                notificationService.emit('booking:rejected', {
                    bookingId: booking._id,
                    userId: booking.customer._id,
                    reason: comment
                });
            }

            // Notify hotel staff if receptionist
            if (booking.hotel.receptionists?.length > 0) {
                for (const receptionistId of booking.hotel.receptionists) {
                    socketService.sendUserNotification(receptionistId, 'booking:validation_update', {
                        bookingId: booking._id,
                        action,
                        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                        timestamp: new Date()
                    });
                }
            }

            logger.info(`Validation notifications sent for booking ${booking._id}`);
        } catch (error) {
            logger.error('Failed to notify booking validation:', error);
        }
    }

    /**
     * Update dashboard statistics after validation
     * @param {String} action - Validation action (approve/reject)
     */
    async updateDashboardStatsAfterValidation(action) {
        try {
            const currentStats = this.dashboardStats.get('validation') || {
                todayApproved: 0,
                todayRejected: 0,
                weekApproved: 0,
                weekRejected: 0
            };

            if (action === 'approve') {
                currentStats.todayApproved++;
                currentStats.weekApproved++;
            } else {
                currentStats.todayRejected++;
                currentStats.weekRejected++;
            }

            this.dashboardStats.set('validation', currentStats);

            // Broadcast updated stats to all admins
            this.broadcastToAdmins('dashboard:stats_updated', {
                type: 'validation',
                stats: currentStats,
                timestamp: new Date()
            });

        } catch (error) {
            logger.error('Failed to update dashboard stats after validation:', error);
        }
    }

    /**
     * Update dashboard statistics periodically
     */
    async updateDashboardStats() {
        try {
            const stats = await this.generateDashboardData();
            
            // Store stats locally for quick access
            this.dashboardStats.set('latest', stats);

            // Broadcast to all connected admins
            this.broadcastToAdmins('dashboard:stats_refresh', {
                stats: stats.stats,
                timestamp: new Date()
            });

        } catch (error) {
            logger.error('Failed to update dashboard stats:', error);
        }
    }

    /**
     * Check and send system alerts
     */
    async checkAndSendAlerts() {
        try {
            const alerts = await this.detectSystemAlerts();
            
            if (alerts.length > 0) {
                for (const alert of alerts) {
                    this.broadcastToAdmins('system:alert', alert);
                    
                    // Send critical alerts via email
                    if (alert.level === 'CRITICAL') {
                        const admins = await User.find({ role: 'ADMIN' });
                        for (const admin of admins) {
                            await emailService.sendUrgentNotification(admin, alert.message);
                        }
                    }
                }
            }
        } catch (error) {
            logger.error('Failed to check and send alerts:', error);
        }
    }

    /**
     * Detect system alerts
     */
    async detectSystemAlerts() {
        const alerts = [];

        try {
            // Check booking validation backlog
            if (this.validationQueue.length > 10) {
                alerts.push({
                    id: `validation_backlog_${Date.now()}`,
                    type: 'VALIDATION_BACKLOG',
                    level: 'WARNING',
                    title: 'Validation Backlog Alert',
                    message: `${this.validationQueue.length} bookings pending validation`,
                    timestamp: new Date()
                });
            }

            // Check for urgent validations
            const urgentValidations = this.validationQueue.filter(item => item.urgencyScore > 8);
            if (urgentValidations.length > 0) {
                alerts.push({
                    id: `urgent_validations_${Date.now()}`,
                    type: 'URGENT_VALIDATIONS',
                    level: 'HIGH',
                    title: 'Urgent Validations Required',
                    message: `${urgentValidations.length} urgent bookings require immediate attention`,
                    data: urgentValidations,
                    timestamp: new Date()
                });
            }

            // Check system performance
            const memoryUsage = process.memoryUsage();
            if (memoryUsage.heapUsed > 500 * 1024 * 1024) { // 500MB
                alerts.push({
                    id: `memory_usage_${Date.now()}`,
                    type: 'HIGH_MEMORY_USAGE',
                    level: 'WARNING',
                    title: 'High Memory Usage',
                    message: `System memory usage: ${Math.round(memoryUsage.heapUsed / 1024 / 1024)}MB`,
                    timestamp: new Date()
                });
            }

            return alerts;
        } catch (error) {
            logger.error('Failed to detect system alerts:', error);
            return [];
        }
    }

    /**
     * Broadcast message to all connected admins
     * @param {String} eventType - Event type
     * @param {Object} data - Event data
     * @param {Array} excludeAdmins - Admin IDs to exclude
     */
    broadcastToAdmins(eventType, data, excludeAdmins = []) {
        for (const adminId of this.connectedAdmins) {
            if (!excludeAdmins.includes(adminId)) {
                socketService.sendUserNotification(adminId, eventType, data);
            }
        }
    }

    /**
     * Get validation queue summary
     */
    getValidationQueueSummary() {
        return {
            total: this.validationQueue.length,
            urgent: this.validationQueue.filter(item => item.urgencyScore > 8).length,
            high: this.validationQueue.filter(item => item.urgencyScore > 6).length,
            normal: this.validationQueue.filter(item => item.urgencyScore <= 6).length,
            oldestPending: this.validationQueue.length > 0 ? this.validationQueue[this.validationQueue.length - 1].submittedAt : null
        };
    }

    /**
     * Helper methods for dashboard statistics
     */
    async getPendingBookingsCount() {
        return await Booking.countDocuments({ status: 'PENDING' });
    }

    async getTodayBookingsCount() {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        return await Booking.countDocuments({
            createdAt: { $gte: todayStart },
            status: { $ne: 'CANCELLED' }
        });
    }

    async getWeekBookingsCount() {
        const weekStart = new Date();
        weekStart.setDate(weekStart.getDate() - 7);
        return await Booking.countDocuments({
            createdAt: { $gte: weekStart },
            status: { $ne: 'CANCELLED' }
        });
    }

    async getTotalRevenue() {
        const result = await Booking.aggregate([
            { $match: { status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] } } },
            { $group: { _id: null, total: { $sum: '$totalAmount' } } }
        ]);
        return result[0]?.total || 0;
    }

    async getOccupancyRates() {
        // This would calculate real occupancy rates
        // Placeholder implementation
        return {
            today: 75,
            thisWeek: 68,
            thisMonth: 72
        };
    }

    async getActiveSystemAlerts() {
        return this.detectSystemAlerts();
    }

    async getRecentActivities() {
        const recentBookings = await Booking.find({
            updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
        .populate('customer', 'firstName lastName')
        .populate('hotel', 'name')
        .sort({ updatedAt: -1 })
        .limit(10);

        return recentBookings.map(booking => ({
            type: 'booking',
            action: booking.status,
            description: `${booking.customer.firstName} ${booking.customer.lastName} - ${booking.hotel.name}`,
            timestamp: booking.updatedAt,
            bookingId: booking._id
        }));
    }

    async getSystemHealthStatus() {
        const memoryUsage = process.memoryUsage();
        return {
            status: 'healthy',
            uptime: process.uptime(),
            memoryUsage: Math.round(memoryUsage.heapUsed / 1024 / 1024),
            connectedAdmins: this.connectedAdmins.size,
            pendingValidations: this.validationQueue.length
        };
    }

    /**
     * Event handlers
     */
    async handleSystemAlert(alertData) {
        this.broadcastToAdmins('system:alert', alertData);
    }

    async handlePerformanceWarning(warningData) {
        this.broadcastToAdmins('system:performance_warning', warningData);
    }

    async handleSecurityAlert(securityData) {
        this.broadcastToAdmins('system:security_alert', {
            ...securityData,
            level: 'CRITICAL'
        });
    }

    async handleRevenueThreshold(revenueData) {
        this.broadcastToAdmins('revenue:threshold_reached', revenueData);
    }

    async handleRevenueAnomaly(anomalyData) {
        this.broadcastToAdmins('revenue:anomaly_detected', anomalyData);
    }

    async handleCapacityWarning(capacityData) {
        this.broadcastToAdmins('hotel:capacity_warning', capacityData);
    }

    async handleMaintenanceAlert(maintenanceData) {
        this.broadcastToAdmins('hotel:maintenance_required', maintenanceData);
    }

    /**
     * Get admin service statistics
     */
    getServiceStats() {
        return {
            connectedAdmins: this.connectedAdmins.size,
            pendingValidations: this.pendingValidations.size,
            validationQueueLength: this.validationQueue.length,
            avgValidationTime: this.calculateAverageValidationTime(),
            totalValidationsToday: this.getTotalValidationsToday()
        };
    }

    calculateAverageValidationTime() {
        // This would calculate from historical data
        return 0; // Placeholder
    }

    getTotalValidationsToday() {
        const stats = this.dashboardStats.get('validation') || {};
        return (stats.todayApproved || 0) + (stats.todayRejected || 0);
    }

    /**
     * Cleanup method
     */
    cleanup() {
        if (this.statsInterval) {
            clearInterval(this.statsInterval);
        }
        if (this.alertsInterval) {
            clearInterval(this.alertsInterval);
        }
        this.connectedAdmins.clear();
        this.adminSessions.clear();
        this.pendingValidations.clear();
        this.validationQueue = [];
        logger.info('Admin Real-time Service cleanup completed');
    }
}

// Export singleton instance
module.exports = new AdminRealtimeService();