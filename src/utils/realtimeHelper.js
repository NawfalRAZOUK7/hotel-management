/**
 * Real-time Helper Utilities
 * Provides utility functions for real-time features, data formatting, and event broadcasting
 * Week 3 - Hotel Management System
 */

const moment = require('moment');
const { logger } = require('./logger');

class RealtimeHelper {
    constructor() {
        this.eventTypes = {
            // Booking events
            BOOKING_CREATED: 'booking:created',
            BOOKING_UPDATED: 'booking:updated', 
            BOOKING_CONFIRMED: 'booking:confirmed',
            BOOKING_REJECTED: 'booking:rejected',
            BOOKING_CANCELLED: 'booking:cancelled',
            BOOKING_CHECKIN: 'booking:checkin',
            BOOKING_CHECKOUT: 'booking:checkout',

            // Availability events
            AVAILABILITY_UPDATED: 'availability:updated',
            ROOM_STATUS_CHANGED: 'room:status_changed',
            PRICING_UPDATED: 'pricing:updated',

            // Admin events
            ADMIN_ACTION_REQUIRED: 'admin:action_required',
            ADMIN_VALIDATION: 'admin:validation',
            SYSTEM_ALERT: 'system:alert',

            // User events
            USER_CONNECTED: 'user:connected',
            USER_DISCONNECTED: 'user:disconnected',
            USER_TYPING: 'user:typing',

            // Service events
            SERVICE_REQUEST: 'service:request',
            SERVICE_UPDATE: 'service:update',
            MESSAGE_NEW: 'message:new'
        };

        this.priorities = {
            CRITICAL: 'critical',
            HIGH: 'high',
            MEDIUM: 'medium',
            LOW: 'low'
        };

        this.roomStatuses = {
            AVAILABLE: 'available',
            OCCUPIED: 'occupied',
            MAINTENANCE: 'maintenance',
            CLEANING: 'cleaning',
            OUT_OF_ORDER: 'out_of_order'
        };
    }

    // ===============================================
    // DATA FORMATTING HELPERS
    // ===============================================

    /**
     * Format booking data for real-time transmission
     * @param {Object} booking - Booking object
     * @param {Object} options - Formatting options
     * @returns {Object} Formatted booking data
     */
    formatBookingForRealtime(booking, options = {}) {
        const { includeUserDetails = true, includePricing = true, includeRooms = true } = options;

        const formatted = {
            id: booking._id,
            confirmationNumber: booking.confirmationNumber,
            status: booking.status,
            checkInDate: this.formatDate(booking.checkInDate),
            checkOutDate: this.formatDate(booking.checkOutDate),
            numberOfNights: booking.numberOfNights,
            guests: booking.guests,
            hotelId: booking.hotel?._id || booking.hotelId,
            hotelName: booking.hotel?.name,
            source: booking.source || 'WEB',
            createdAt: this.formatTimestamp(booking.createdAt),
            updatedAt: this.formatTimestamp(booking.updatedAt),
            realtime: {
                formatted: true,
                timestamp: new Date().toISOString()
            }
        };

        if (includeUserDetails && booking.customer) {
            formatted.customer = {
                id: booking.customer._id,
                firstName: booking.customer.firstName,
                lastName: booking.customer.lastName,
                email: booking.customer.email,
                phone: booking.customer.phone
            };
        }

        if (includePricing) {
            formatted.pricing = {
                totalAmount: booking.totalAmount,
                currency: booking.currency || 'EUR',
                paidAmount: booking.paidAmount || 0,
                remainingAmount: (booking.totalAmount || 0) - (booking.paidAmount || 0)
            };
        }

        if (includeRooms && booking.rooms) {
            formatted.rooms = booking.rooms.map(room => ({
                roomType: room.roomType,
                quantity: room.quantity,
                pricePerNight: room.pricePerNight,
                roomNumbers: room.roomNumbers || []
            }));
        }

        return formatted;
    }

    /**
     * Format availability data for real-time updates
     * @param {Object} availability - Availability data
     * @param {String} hotelId - Hotel ID
     * @returns {Object} Formatted availability data
     */
    formatAvailabilityForRealtime(availability, hotelId) {
        return {
            hotelId,
            rooms: Object.entries(availability).map(([roomType, data]) => ({
                roomType,
                available: data.available || 0,
                total: data.total || 0,
                occupied: data.occupied || 0,
                maintenance: data.maintenance || 0,
                pricing: {
                    basePrice: data.basePrice || 0,
                    currentPrice: data.currentPrice || 0,
                    currency: data.currency || 'EUR'
                }
            })),
            lastUpdated: new Date().toISOString(),
            realtime: {
                type: 'availability_update',
                source: 'realtime_helper'
            }
        };
    }

    /**
     * Format user data for real-time transmission
     * @param {Object} user - User object
     * @param {Boolean} includePrivate - Include private data
     * @returns {Object} Formatted user data
     */
    formatUserForRealtime(user, includePrivate = false) {
        const formatted = {
            id: user._id,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            status: user.status || 'active',
            lastSeen: this.formatTimestamp(user.lastSeen),
            realtime: {
                connected: true,
                timestamp: new Date().toISOString()
            }
        };

        if (includePrivate) {
            formatted.email = user.email;
            formatted.phone = user.phone;
            formatted.preferences = user.notificationPreferences;
        }

        if (user.role === 'RECEPTIONIST' && user.hotelId) {
            formatted.hotelId = user.hotelId;
        }

        return formatted;
    }

    /**
     * Format admin notification data
     * @param {String} type - Notification type
     * @param {Object} data - Notification data
     * @param {String} priority - Priority level
     * @returns {Object} Formatted admin notification
     */
    formatAdminNotification(type, data, priority = this.priorities.MEDIUM) {
        return {
            id: this.generateId('notif'),
            type,
            priority,
            title: this.getNotificationTitle(type),
            message: this.getNotificationMessage(type, data),
            data,
            timestamp: new Date().toISOString(),
            requiresAction: this.requiresAdminAction(type),
            category: this.getNotificationCategory(type),
            realtime: {
                broadcast: 'admin',
                expires: this.getNotificationExpiry(priority)
            }
        };
    }

    // ===============================================
    // EVENT BROADCASTING UTILITIES
    // ===============================================

    /**
     * Create real-time event payload
     * @param {String} eventType - Type of event
     * @param {Object} data - Event data
     * @param {Object} metadata - Additional metadata
     * @returns {Object} Event payload
     */
    createRealtimeEvent(eventType, data, metadata = {}) {
        return {
            event: eventType,
            data,
            metadata: {
                timestamp: new Date().toISOString(),
                source: 'hotel_management_system',
                version: '1.0',
                ...metadata
            },
            realtime: {
                id: this.generateId('event'),
                priority: metadata.priority || this.priorities.MEDIUM,
                channels: metadata.channels || ['socket'],
                ttl: metadata.ttl || 300000 // 5 minutes default TTL
            }
        };
    }

    /**
     * Create room-specific event
     * @param {String} hotelId - Hotel ID
     * @param {String} roomId - Room ID
     * @param {String} eventType - Event type
     * @param {Object} data - Event data
     * @returns {Object} Room event payload
     */
    createRoomEvent(hotelId, roomId, eventType, data) {
        return this.createRealtimeEvent(eventType, {
            hotelId,
            roomId,
            ...data
        }, {
            channels: ['socket'],
            target: `hotel-${hotelId}`,
            priority: this.priorities.HIGH
        });
    }

    /**
     * Create booking-specific event
     * @param {String} bookingId - Booking ID
     * @param {String} eventType - Event type
     * @param {Object} data - Event data
     * @returns {Object} Booking event payload
     */
    createBookingEvent(bookingId, eventType, data) {
        return this.createRealtimeEvent(eventType, {
            bookingId,
            ...data
        }, {
            channels: ['socket', 'email', 'sms'],
            target: `booking-${bookingId}`,
            priority: this.priorities.HIGH
        });
    }

    /**
     * Create system-wide broadcast event
     * @param {String} eventType - Event type
     * @param {Object} data - Event data
     * @param {String} targetRole - Target user role
     * @returns {Object} Broadcast event payload
     */
    createBroadcastEvent(eventType, data, targetRole = 'all') {
        return this.createRealtimeEvent(eventType, data, {
            channels: ['socket'],
            target: targetRole,
            broadcast: true,
            priority: this.priorities.MEDIUM
        });
    }

    // ===============================================
    // DATA VALIDATION & SANITIZATION
    // ===============================================

    /**
     * Validate real-time event data
     * @param {Object} eventData - Event data to validate
     * @returns {Object} Validation result
     */
    validateRealtimeEvent(eventData) {
        const errors = [];

        if (!eventData.event) {
            errors.push('Event type is required');
        }

        if (!eventData.data) {
            errors.push('Event data is required');
        }

        if (eventData.realtime && !eventData.realtime.id) {
            errors.push('Real-time event ID is required');
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }

    /**
     * Sanitize user data for real-time transmission
     * @param {Object} data - Data to sanitize
     * @param {String} userRole - User role for permission check
     * @returns {Object} Sanitized data
     */
    sanitizeForRole(data, userRole) {
        const sanitized = { ...data };

        // Remove sensitive data based on user role
        if (userRole !== 'ADMIN') {
            delete sanitized.password;
            delete sanitized.paymentInfo;
            delete sanitized.internalNotes;
        }

        if (userRole === 'CLIENT') {
            delete sanitized.adminComments;
            delete sanitized.systemLogs;
        }

        return sanitized;
    }

    // ===============================================
    // TIME & DATE UTILITIES
    // ===============================================

    /**
     * Format date for real-time display
     * @param {Date|String} date - Date to format
     * @param {String} format - Format string
     * @returns {String} Formatted date
     */
    formatDate(date, format = 'DD/MM/YYYY') {
        if (!date) return null;
        return moment(date).format(format);
    }

    /**
     * Format timestamp for real-time display
     * @param {Date|String} timestamp - Timestamp to format
     * @returns {String} Formatted timestamp
     */
    formatTimestamp(timestamp) {
        if (!timestamp) return null;
        return moment(timestamp).format('DD/MM/YYYY HH:mm:ss');
    }

    /**
     * Get relative time for real-time updates
     * @param {Date|String} date - Date to compare
     * @returns {String} Relative time string
     */
    getRelativeTime(date) {
        if (!date) return null;
        return moment(date).fromNow();
    }

    /**
     * Check if event is recent (within last 5 minutes)
     * @param {Date|String} timestamp - Timestamp to check
     * @returns {Boolean} Is recent
     */
    isRecentEvent(timestamp) {
        if (!timestamp) return false;
        return moment().diff(moment(timestamp), 'minutes') <= 5;
    }

    // ===============================================
    // ID GENERATION & UTILITIES
    // ===============================================

    /**
     * Generate unique ID for real-time events
     * @param {String} prefix - ID prefix
     * @returns {String} Generated ID
     */
    generateId(prefix = 'rt') {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 9);
        return `${prefix}_${timestamp}_${random}`;
    }

    /**
     * Generate room key for real-time operations
     * @param {String} hotelId - Hotel ID
     * @param {String} roomType - Room type
     * @returns {String} Room key
     */
    generateRoomKey(hotelId, roomType) {
        return `${hotelId}:${roomType}`.toLowerCase();
    }

    /**
     * Generate user session key
     * @param {String} userId - User ID
     * @param {String} sessionId - Session ID
     * @returns {String} Session key
     */
    generateSessionKey(userId, sessionId) {
        return `user:${userId}:session:${sessionId}`;
    }

    // ===============================================
    // NOTIFICATION HELPERS
    // ===============================================

    /**
     * Get notification title based on type
     * @param {String} type - Notification type
     * @returns {String} Notification title
     */
    getNotificationTitle(type) {
        const titles = {
            [this.eventTypes.BOOKING_CREATED]: 'Nouvelle Réservation',
            [this.eventTypes.BOOKING_CONFIRMED]: 'Réservation Confirmée',
            [this.eventTypes.BOOKING_REJECTED]: 'Réservation Refusée',
            [this.eventTypes.ADMIN_ACTION_REQUIRED]: 'Action Requise',
            [this.eventTypes.AVAILABILITY_UPDATED]: 'Disponibilité Mise à Jour',
            [this.eventTypes.PRICING_UPDATED]: 'Prix Mis à Jour',
            [this.eventTypes.SYSTEM_ALERT]: 'Alerte Système'
        };
        return titles[type] || 'Notification';
    }

    /**
     * Get notification message based on type and data
     * @param {String} type - Notification type
     * @param {Object} data - Notification data
     * @returns {String} Notification message
     */
    getNotificationMessage(type, data) {
        switch (type) {
            case this.eventTypes.BOOKING_CREATED:
                return `Nouvelle réservation ${data.confirmationNumber} de ${data.customerName}`;
            case this.eventTypes.BOOKING_CONFIRMED:
                return `Réservation ${data.confirmationNumber} confirmée`;
            case this.eventTypes.AVAILABILITY_UPDATED:
                return `Disponibilité mise à jour pour ${data.roomType}`;
            case this.eventTypes.PRICING_UPDATED:
                return `Prix mis à jour: ${data.newPrice}€`;
            default:
                return data.message || 'Nouvelle notification';
        }
    }

    /**
     * Check if notification type requires admin action
     * @param {String} type - Notification type
     * @returns {Boolean} Requires action
     */
    requiresAdminAction(type) {
        const actionRequired = [
            this.eventTypes.BOOKING_CREATED,
            this.eventTypes.ADMIN_ACTION_REQUIRED,
            this.eventTypes.SYSTEM_ALERT
        ];
        return actionRequired.includes(type);
    }

    /**
     * Get notification category
     * @param {String} type - Notification type
     * @returns {String} Category
     */
    getNotificationCategory(type) {
        if (type.startsWith('booking:')) return 'booking';
        if (type.startsWith('admin:')) return 'admin';
        if (type.startsWith('system:')) return 'system';
        if (type.startsWith('availability:')) return 'availability';
        return 'general';
    }

    /**
     * Get notification expiry time
     * @param {String} priority - Priority level
     * @returns {Number} Expiry time in milliseconds
     */
    getNotificationExpiry(priority) {
        const expiries = {
            [this.priorities.CRITICAL]: 60 * 60 * 1000, // 1 hour
            [this.priorities.HIGH]: 6 * 60 * 60 * 1000, // 6 hours
            [this.priorities.MEDIUM]: 24 * 60 * 60 * 1000, // 24 hours
            [this.priorities.LOW]: 7 * 24 * 60 * 60 * 1000 // 7 days
        };
        return expiries[priority] || expiries[this.priorities.MEDIUM];
    }

    // ===============================================
    // PERFORMANCE UTILITIES
    // ===============================================

    /**
     * Throttle real-time events to prevent spam
     * @param {Function} func - Function to throttle
     * @param {Number} delay - Throttle delay in ms
     * @returns {Function} Throttled function
     */
    throttle(func, delay) {
        let timeoutId;
        let lastExecTime = 0;
        
        return function (...args) {
            const currentTime = Date.now();
            
            if (currentTime - lastExecTime > delay) {
                func.apply(this, args);
                lastExecTime = currentTime;
            } else {
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    func.apply(this, args);
                    lastExecTime = Date.now();
                }, delay - (currentTime - lastExecTime));
            }
        };
    }

    /**
     * Debounce real-time events
     * @param {Function} func - Function to debounce
     * @param {Number} delay - Debounce delay in ms
     * @returns {Function} Debounced function
     */
    debounce(func, delay) {
        let timeoutId;
        
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }

    /**
     * Rate limit real-time events per user
     * @param {String} userId - User ID
     * @param {Number} maxEvents - Max events per window
     * @param {Number} windowMs - Time window in milliseconds
     * @returns {Boolean} Is allowed
     */
    isRateLimited(userId, maxEvents = 100, windowMs = 60000) {
        const key = `rate_limit:${userId}`;
        const now = Date.now();
        
        if (!this.rateLimitStore) {
            this.rateLimitStore = new Map();
        }
        
        const userEvents = this.rateLimitStore.get(key) || [];
        const recentEvents = userEvents.filter(timestamp => now - timestamp < windowMs);
        
        if (recentEvents.length >= maxEvents) {
            return true; // Rate limited
        }
        
        recentEvents.push(now);
        this.rateLimitStore.set(key, recentEvents);
        
        return false; // Not rate limited
    }

    // ===============================================
    // ERROR HANDLING
    // ===============================================

    /**
     * Handle real-time error with logging
     * @param {Error} error - Error object
     * @param {String} context - Error context
     * @param {Object} metadata - Additional metadata
     */
    handleRealtimeError(error, context, metadata = {}) {
        const errorData = {
            message: error.message,
            stack: error.stack,
            context,
            timestamp: new Date().toISOString(),
            metadata
        };

        logger.error('Real-time error:', errorData);
        
        // Could also send to error tracking service
        return errorData;
    }

    /**
     * Create error response for real-time events
     * @param {String} eventType - Event type
     * @param {Error} error - Error object
     * @returns {Object} Error response
     */
    createErrorResponse(eventType, error) {
        return {
            event: `${eventType}:error`,
            error: {
                message: error.message,
                code: error.code || 'REALTIME_ERROR',
                timestamp: new Date().toISOString()
            },
            realtime: {
                type: 'error',
                retry: error.retryable || false
            }
        };
    }
}

// Create singleton instance
const realtimeHelper = new RealtimeHelper();

module.exports = realtimeHelper;