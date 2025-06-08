/**
 * Booking Real-time Service - Week 3
 * Handles instant booking updates, real-time status changes, and live confirmations
 * Integrates with Socket.io for immediate user feedback
 */

const EventEmitter = require('events');
const socketService = require('./socketService');
const notificationService = require('./notificationService');
const availabilityService = require('../utils/availability');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const { logger } = require('../utils/logger');

class BookingRealtimeService extends EventEmitter {
    constructor() {
        super();
        this.activeBookingProcesses = new Map(); // Track ongoing booking processes
        this.bookingQueue = new Map(); // Queue for processing bookings
        this.statusUpdateTimeouts = new Map(); // Auto-timeout for pending bookings
        
        // Booking status flow
        this.statusFlow = {
            'PENDING': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
            'CONFIRMED': ['CHECKED_IN', 'CANCELLED'],
            'CHECKED_IN': ['CHECKED_OUT', 'CANCELLED'],
            'CHECKED_OUT': ['COMPLETED'],
            'CANCELLED': [],
            'REJECTED': [],
            'COMPLETED': []
        };

        this.setupEventListeners();
        logger.info('Booking Real-time Service initialized');
    }

    /**
     * Setup event listeners for booking events
     */
    setupEventListeners() {
        // Listen to booking workflow events
        this.on('booking:status_changed', this.handleBookingStatusChanged.bind(this));
        this.on('booking:payment_updated', this.handlePaymentUpdated.bind(this));
        this.on('booking:room_assigned', this.handleRoomAssigned.bind(this));
        this.on('booking:availability_changed', this.handleAvailabilityChanged.bind(this));
        
        // Listen to external events
        notificationService.on('booking:created', this.handleBookingCreated.bind(this));
        notificationService.on('booking:confirmed', this.handleBookingConfirmed.bind(this));
        notificationService.on('booking:rejected', this.handleBookingRejected.bind(this));
    }

    /**
     * Process booking creation in real-time
     * @param {Object} bookingData - Booking creation data
     * @returns {Object} Real-time booking result
     */
    async processBookingCreation(bookingData) {
        const processId = `booking_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        try {
            // Track the process
            this.activeBookingProcesses.set(processId, {
                stage: 'INITIALIZING',
                startTime: new Date(),
                userId: bookingData.userId,
                hotelId: bookingData.hotelId
            });

            // Send immediate feedback to user
            await this.sendRealtimeUpdate(bookingData.userId, 'booking:process_started', {
                processId,
                message: 'Initialisation de votre réservation...',
                stage: 'INITIALIZING',
                progress: 10
            });

            // Step 1: Validate availability in real-time
            await this.updateProcessStage(processId, 'CHECKING_AVAILABILITY', 25);
            const availabilityCheck = await this.validateAvailabilityRealtime(bookingData);
            
            if (!availabilityCheck.available) {
                await this.sendRealtimeUpdate(bookingData.userId, 'booking:availability_failed', {
                    processId,
                    message: 'Chambres non disponibles pour les dates sélectionnées',
                    error: availabilityCheck.reason,
                    stage: 'FAILED'
                });
                return { success: false, reason: 'AVAILABILITY_FAILED' };
            }

            // Step 2: Create booking record
            await this.updateProcessStage(processId, 'CREATING_BOOKING', 50);
            const booking = await this.createBookingRecord(bookingData, processId);

            // Step 3: Reserve rooms temporarily
            await this.updateProcessStage(processId, 'RESERVING_ROOMS', 75);
            await this.reserveRoomsTemporarily(booking._id, bookingData.rooms);

            // Step 4: Finalize booking
            await this.updateProcessStage(processId, 'FINALIZING', 90);
            const finalBooking = await this.finalizeBooking(booking._id);

            // Step 5: Send confirmations
            await this.updateProcessStage(processId, 'SENDING_CONFIRMATIONS', 100);
            await this.sendBookingConfirmations(finalBooking);

            // Clean up process tracking
            this.activeBookingProcesses.delete(processId);

            // Emit events for other services
            this.emit('booking:created_realtime', {
                bookingId: finalBooking._id,
                userId: bookingData.userId,
                hotelId: bookingData.hotelId,
                processId
            });

            return {
                success: true,
                booking: finalBooking,
                processId
            };

        } catch (error) {
            logger.error(`Real-time booking creation failed for process ${processId}:`, error);
            
            // Send error update to user
            await this.sendRealtimeUpdate(bookingData.userId, 'booking:creation_failed', {
                processId,
                message: 'Erreur lors de la création de la réservation',
                error: error.message,
                stage: 'FAILED'
            });

            // Clean up
            this.activeBookingProcesses.delete(processId);
            
            throw error;
        }
    }

    /**
     * Update booking status in real-time
     * @param {String} bookingId - Booking ID
     * @param {String} newStatus - New booking status
     * @param {String} adminId - Admin performing the action (optional)
     * @param {String} comment - Admin comment (optional)
     */
    async updateBookingStatusRealtime(bookingId, newStatus, adminId = null, comment = null) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                throw new Error(`Booking not found: ${bookingId}`);
            }

            // Validate status transition
            if (!this.isValidStatusTransition(booking.status, newStatus)) {
                throw new Error(`Invalid status transition: ${booking.status} -> ${newStatus}`);
            }

            const oldStatus = booking.status;
            
            // Update booking status
            booking.status = newStatus;
            booking.statusHistory.push({
                status: newStatus,
                timestamp: new Date(),
                updatedBy: adminId,
                comment: comment
            });

            await booking.save();

            // Send real-time updates to all relevant parties
            await this.broadcastStatusUpdate(booking, oldStatus, newStatus, adminId, comment);

            // Emit event for other services
            this.emit('booking:status_changed', {
                bookingId,
                oldStatus,
                newStatus,
                adminId,
                comment,
                timestamp: new Date()
            });

            // Handle status-specific actions
            await this.handleStatusSpecificActions(booking, newStatus, adminId);

            logger.info(`Booking ${bookingId} status updated from ${oldStatus} to ${newStatus}`);

            return {
                success: true,
                booking,
                oldStatus,
                newStatus
            };

        } catch (error) {
            logger.error(`Failed to update booking status in real-time:`, error);
            throw error;
        }
    }

    /**
     * Handle instant booking approval/rejection by admin
     * @param {String} bookingId - Booking ID
     * @param {String} action - 'approve' or 'reject'
     * @param {String} adminId - Admin ID
     * @param {String} comment - Admin comment
     */
    async handleInstantAdminAction(bookingId, action, adminId, comment = null) {
        try {
            const newStatus = action === 'approve' ? 'CONFIRMED' : 'REJECTED';
            
            // Send immediate feedback to admin
            await this.sendRealtimeUpdate(adminId, 'admin:action_processing', {
                bookingId,
                action,
                message: `Traitement de l'action: ${action}...`,
                progress: 50
            });

            // Update booking status
            const result = await this.updateBookingStatusRealtime(bookingId, newStatus, adminId, comment);

            // Send completion confirmation to admin
            await this.sendRealtimeUpdate(adminId, 'admin:action_completed', {
                bookingId,
                action,
                newStatus,
                message: `Action ${action} effectuée avec succès`,
                progress: 100
            });

            // Update admin dashboard in real-time
            await this.updateAdminDashboard(adminId, {
                type: 'booking_processed',
                bookingId,
                action: newStatus,
                timestamp: new Date()
            });

            return result;

        } catch (error) {
            logger.error(`Instant admin action failed:`, error);
            
            // Send error to admin
            await this.sendRealtimeUpdate(adminId, 'admin:action_failed', {
                bookingId,
                action,
                error: error.message,
                message: `Erreur lors de l'action: ${error.message}`
            });

            throw error;
        }
    }

    /**
     * Process check-in in real-time
     * @param {String} bookingId - Booking ID
     * @param {String} receptionistId - Receptionist ID
     * @param {Array} roomNumbers - Assigned room numbers
     * @param {Object} additionalInfo - Additional check-in info
     */
    async processCheckInRealtime(bookingId, receptionistId, roomNumbers, additionalInfo = {}) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                throw new Error(`Booking not found: ${bookingId}`);
            }

            // Send immediate feedback
            await this.sendRealtimeUpdate(booking.customer._id, 'checkin:processing', {
                bookingId,
                message: 'Check-in en cours...',
                progress: 30
            });

            // Update booking with room assignments
            booking.assignedRooms = roomNumbers;
            booking.checkInTime = new Date();
            booking.checkInBy = receptionistId;
            booking.status = 'CHECKED_IN';

            if (additionalInfo.guestIds) {
                booking.guestIds = additionalInfo.guestIds;
            }

            await booking.save();

            // Send check-in confirmation to guest
            await this.sendRealtimeUpdate(booking.customer._id, 'checkin:completed', {
                bookingId,
                roomNumbers,
                hotelInfo: {
                    name: booking.hotel.name,
                    wifiPassword: booking.hotel.wifiPassword,
                    amenities: booking.hotel.amenities
                },
                message: `Check-in effectué ! Chambre(s): ${roomNumbers.join(', ')}`,
                progress: 100
            });

            // Notify hotel staff
            await socketService.sendHotelNotification(booking.hotel._id, 'guest_checked_in', {
                bookingId,
                guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                roomNumbers,
                timestamp: new Date()
            });

            // Emit events
            this.emit('booking:checked_in', {
                bookingId,
                userId: booking.customer._id,
                roomNumbers,
                receptionistId,
                timestamp: new Date()
            });

            logger.info(`Check-in completed for booking ${bookingId}, rooms: ${roomNumbers.join(', ')}`);

            return {
                success: true,
                booking,
                roomNumbers,
                checkInTime: booking.checkInTime
            };

        } catch (error) {
            logger.error(`Real-time check-in failed:`, error);
            throw error;
        }
    }

    /**
     * Process check-out in real-time
     * @param {String} bookingId - Booking ID
     * @param {String} receptionistId - Receptionist ID
     * @param {Object} finalBill - Final bill details
     */
    async processCheckOutRealtime(bookingId, receptionistId, finalBill = {}) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            // Send processing notification
            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:processing', {
                bookingId,
                message: 'Check-out en cours...',
                progress: 25
            });

            // Calculate final bill
            const calculatedBill = await this.calculateFinalBill(booking, finalBill);
            
            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:calculating_bill', {
                bookingId,
                message: 'Calcul de la facture finale...',
                progress: 50
            });

            // Update booking
            booking.checkOutTime = new Date();
            booking.checkOutBy = receptionistId;
            booking.finalAmount = calculatedBill.total;
            booking.extras = calculatedBill.extras;
            booking.status = 'CHECKED_OUT';

            await booking.save();

            // Generate invoice
            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:generating_invoice', {
                bookingId,
                message: 'Génération de la facture...',
                progress: 75
            });

            // Send completion notification
            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:completed', {
                bookingId,
                finalBill: calculatedBill,
                message: 'Check-out effectué avec succès !',
                progress: 100
            });

            // Free up rooms in real-time
            await this.freeUpRooms(booking.assignedRooms, booking.hotel._id);

            // Emit events
            this.emit('booking:checked_out', {
                bookingId,
                userId: booking.customer._id,
                finalAmount: calculatedBill.total,
                receptionistId,
                timestamp: new Date()
            });

            logger.info(`Check-out completed for booking ${bookingId}`);

            return {
                success: true,
                booking,
                finalBill: calculatedBill
            };

        } catch (error) {
            logger.error(`Real-time check-out failed:`, error);
            throw error;
        }
    }

    /**
     * Handle booking cancellation in real-time
     * @param {String} bookingId - Booking ID
     * @param {String} userId - User requesting cancellation
     * @param {String} reason - Cancellation reason
     */
    async handleBookingCancellationRealtime(bookingId, userId, reason = null) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            // Send immediate feedback
            await this.sendRealtimeUpdate(userId, 'cancellation:processing', {
                bookingId,
                message: 'Traitement de l\'annulation...',
                progress: 25
            });

            // Check cancellation policy
            const cancellationResult = await this.checkCancellationPolicy(booking);
            
            await this.sendRealtimeUpdate(userId, 'cancellation:policy_checked', {
                bookingId,
                cancellationResult,
                message: 'Vérification de la politique d\'annulation...',
                progress: 50
            });

            // Process refund if applicable
            if (cancellationResult.refundAmount > 0) {
                await this.sendRealtimeUpdate(userId, 'cancellation:processing_refund', {
                    bookingId,
                    refundAmount: cancellationResult.refundAmount,
                    message: 'Traitement du remboursement...',
                    progress: 75
                });
            }

            // Update booking status
            booking.status = 'CANCELLED';
            booking.cancellationDate = new Date();
            booking.cancellationReason = reason;
            booking.refundAmount = cancellationResult.refundAmount;

            await booking.save();

            // Free up reserved rooms
            await this.freeUpRooms(booking.rooms, booking.hotel._id);

            // Send completion notification
            await this.sendRealtimeUpdate(userId, 'cancellation:completed', {
                bookingId,
                refundInfo: cancellationResult,
                message: 'Annulation effectuée avec succès',
                progress: 100
            });

            // Emit events
            this.emit('booking:cancelled', {
                bookingId,
                userId,
                reason,
                refundAmount: cancellationResult.refundAmount,
                timestamp: new Date()
            });

            logger.info(`Booking ${bookingId} cancelled by user ${userId}`);

            return {
                success: true,
                booking,
                cancellationResult
            };

        } catch (error) {
            logger.error(`Real-time cancellation failed:`, error);
            
            await this.sendRealtimeUpdate(userId, 'cancellation:failed', {
                bookingId,
                error: error.message,
                message: 'Erreur lors de l\'annulation'
            });

            throw error;
        }
    }

    /**
     * Send real-time update to user via Socket.io
     * @param {String} userId - User ID
     * @param {String} eventType - Event type
     * @param {Object} data - Event data
     */
    async sendRealtimeUpdate(userId, eventType, data) {
        try {
            const updateData = {
                eventType,
                timestamp: new Date(),
                ...data
            };

            // Send via Socket.io
            const socketSent = socketService.sendUserNotification(userId, eventType, updateData);
            
            // If user not connected via socket, log for later retrieval
            if (!socketSent) {
                await this.logRealtimeUpdate(userId, eventType, updateData);
            }

            return socketSent;
        } catch (error) {
            logger.error(`Failed to send real-time update:`, error);
        }
    }

    /**
     * Broadcast booking status update to all relevant parties
     * @param {Object} booking - Booking object
     * @param {String} oldStatus - Previous status
     * @param {String} newStatus - New status
     * @param {String} adminId - Admin ID (optional)
     * @param {String} comment - Comment (optional)
     */
    async broadcastStatusUpdate(booking, oldStatus, newStatus, adminId, comment) {
        const updateData = {
            bookingId: booking._id,
            confirmationNumber: booking.confirmationNumber,
            oldStatus,
            newStatus,
            comment,
            timestamp: new Date(),
            hotel: {
                name: booking.hotel.name,
                id: booking.hotel._id
            }
        };

        // Notify customer
        await this.sendRealtimeUpdate(booking.customer._id, 'booking:status_updated', {
            ...updateData,
            message: this.getStatusUpdateMessage(newStatus),
            customerView: true
        });

        // Notify admin who made the change
        if (adminId) {
            await this.sendRealtimeUpdate(adminId, 'admin:booking_updated', {
                ...updateData,
                message: `Statut mis à jour: ${newStatus}`,
                adminView: true
            });
        }

        // Notify all admins
        await socketService.sendAdminNotification('booking_status_changed', updateData);

        // Notify hotel staff
        await socketService.sendHotelNotification(booking.hotel._id, 'booking_status_changed', updateData);
    }

    /**
     * Helper Methods
     */

    async updateProcessStage(processId, stage, progress) {
        const process = this.activeBookingProcesses.get(processId);
        if (process) {
            process.stage = stage;
            process.progress = progress;
            
            await this.sendRealtimeUpdate(process.userId, 'booking:progress_update', {
                processId,
                stage,
                progress,
                message: this.getStageMessage(stage)
            });
        }
    }

    async validateAvailabilityRealtime(bookingData) {
        // This would integrate with your availability service
        return await availabilityService.checkAvailability(
            bookingData.hotelId,
            bookingData.checkInDate,
            bookingData.checkOutDate,
            bookingData.rooms
        );
    }

    async createBookingRecord(bookingData, processId) {
        const booking = new Booking({
            ...bookingData,
            processId,
            status: 'PENDING',
            createdAt: new Date(),
            statusHistory: [{
                status: 'PENDING',
                timestamp: new Date(),
                comment: 'Booking created via real-time system'
            }]
        });

        return await booking.save();
    }

    async reserveRoomsTemporarily(bookingId, rooms) {
        // Temporarily reserve rooms for 15 minutes
        // This would integrate with your room management system
        for (const room of rooms) {
            await Room.updateMany(
                { 
                    hotel: room.hotelId,
                    roomType: room.type,
                    status: 'AVAILABLE'
                },
                { 
                    $set: { 
                        tempReservation: {
                            bookingId,
                            expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes
                        }
                    }
                },
                { limit: room.quantity }
            );
        }
    }

    async finalizeBooking(bookingId) {
        return await Booking.findByIdAndUpdate(
            bookingId,
            { 
                status: 'PENDING',
                finalizedAt: new Date()
            },
            { new: true }
        ).populate('customer').populate('hotel');
    }

    async sendBookingConfirmations(booking) {
        // Trigger notification service
        notificationService.emit('booking:created', {
            bookingId: booking._id,
            userId: booking.customer._id
        });
    }

    isValidStatusTransition(currentStatus, newStatus) {
        return this.statusFlow[currentStatus]?.includes(newStatus) || false;
    }

    async handleStatusSpecificActions(booking, newStatus, adminId) {
        switch (newStatus) {
            case 'CONFIRMED':
                // Auto-schedule check-in reminder
                await this.scheduleCheckInReminder(booking._id);
                break;
            case 'REJECTED':
                // Free up reserved rooms
                await this.freeUpRooms(booking.rooms, booking.hotel._id);
                break;
            case 'CHECKED_IN':
                // Update room status
                await this.updateRoomStatus(booking.assignedRooms, 'OCCUPIED');
                break;
            case 'CHECKED_OUT':
                // Update room status and trigger housekeeping
                await this.updateRoomStatus(booking.assignedRooms, 'CLEANING');
                await this.triggerHousekeeping(booking.assignedRooms, booking.hotel._id);
                break;
        }
    }

    async calculateFinalBill(booking, additionalCharges = {}) {
        const baseAmount = booking.totalAmount;
        const extras = additionalCharges.extras || [];
        const taxes = additionalCharges.taxes || 0;
        
        const extrasTotal = extras.reduce((sum, extra) => sum + extra.amount, 0);
        const total = baseAmount + extrasTotal + taxes;

        return {
            baseAmount,
            extras,
            extrasTotal,
            taxes,
            total
        };
    }

    async checkCancellationPolicy(booking) {
        const now = new Date();
        const checkInDate = new Date(booking.checkInDate);
        const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);

        let refundPercentage = 0;
        if (hoursUntilCheckIn > 48) {
            refundPercentage = 100; // Full refund
        } else if (hoursUntilCheckIn > 24) {
            refundPercentage = 50; // Partial refund
        } else {
            refundPercentage = 0; // No refund
        }

        const refundAmount = (booking.totalAmount * refundPercentage) / 100;

        return {
            refundPercentage,
            refundAmount,
            hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
            policy: this.getCancellationPolicyText(refundPercentage)
        };
    }

    async freeUpRooms(rooms, hotelId) {
        // Implementation to free up reserved/occupied rooms
        // This would integrate with your room management system
        for (const room of rooms) {
            await Room.updateMany(
                { 
                    hotel: hotelId,
                    roomType: room.type || room.roomType,
                    $or: [
                        { 'tempReservation.bookingId': room.bookingId },
                        { status: 'OCCUPIED' }
                    ]
                },
                { 
                    $unset: { tempReservation: "" },
                    $set: { status: 'AVAILABLE' }
                }
            );
        }
    }

    getStageMessage(stage) {
        const messages = {
            'INITIALIZING': 'Initialisation...',
            'CHECKING_AVAILABILITY': 'Vérification des disponibilités...',
            'CREATING_BOOKING': 'Création de la réservation...',
            'RESERVING_ROOMS': 'Réservation des chambres...',
            'FINALIZING': 'Finalisation...',
            'SENDING_CONFIRMATIONS': 'Envoi des confirmations...'
        };
        return messages[stage] || 'Traitement en cours...';
    }

    getStatusUpdateMessage(status) {
        const messages = {
            'CONFIRMED': 'Votre réservation a été confirmée !',
            'REJECTED': 'Votre réservation a été refusée',
            'CHECKED_IN': 'Check-in effectué avec succès !',
            'CHECKED_OUT': 'Check-out effectué. Merci de votre séjour !',
            'CANCELLED': 'Votre réservation a été annulée'
        };
        return messages[status] || 'Statut de réservation mis à jour';
    }

    getCancellationPolicyText(refundPercentage) {
        if (refundPercentage === 100) return 'Annulation gratuite';
        if (refundPercentage === 50) return 'Annulation avec frais (50% remboursé)';
        return 'Annulation non remboursable';
    }

    async logRealtimeUpdate(userId, eventType, data) {
        // Log for users not connected via socket
        // This could be stored in database for later retrieval
        logger.info(`Real-time update logged for offline user ${userId}:`, {
            eventType,
            data,
            timestamp: new Date()
        });
    }

    async updateAdminDashboard(adminId, dashboardData) {
        await socketService.sendUserNotification(adminId, 'dashboard:update', dashboardData);
    }

    async scheduleCheckInReminder(bookingId) {
        // This would integrate with a job scheduler
        logger.info(`Check-in reminder scheduled for booking ${bookingId}`);
    }

    async updateRoomStatus(roomNumbers, status) {
        await Room.updateMany(
            { roomNumber: { $in: roomNumbers } },
            { $set: { status } }
        );
    }

    async triggerHousekeeping(roomNumbers, hotelId) {
        await socketService.sendHotelNotification(hotelId, 'housekeeping_required', {
            rooms: roomNumbers,
            priority: 'HIGH',
            timestamp: new Date()
        });
    }

    /**
     * Event handlers for external events
     */
    async handleBookingCreated(data) {
        // Handle booking created event from notification service
        logger.info(`Real-time service handling booking created: ${data.bookingId}`);
    }

    async handleBookingConfirmed(data) {
        // Additional real-time actions when booking is confirmed
        logger.info(`Real-time service handling booking confirmed: ${data.bookingId}`);
    }

    async handleBookingRejected(data) {
        // Additional real-time actions when booking is rejected
        logger.info(`Real-time service handling booking rejected: ${data.bookingId}`);
    }

    /**
     * Get service statistics
     */
    getServiceStats() {
        return {
            activeProcesses: this.activeBookingProcesses.size,
            queueSize: this.bookingQueue.size,
            pendingTimeouts: this.statusUpdateTimeouts.size,
            uptime: process.uptime()
        };
    }

    /**
     * Cleanup method
     */
    cleanup() {
        this.activeBookingProcesses.clear();
        this.bookingQueue.clear();
        this.statusUpdateTimeouts.forEach(timeout => clearTimeout(timeout));
        this.statusUpdateTimeouts.clear();
        logger.info('Booking Real-time Service cleaned up');
    }
}

// Export singleton instance
module.exports = new BookingRealtimeService();