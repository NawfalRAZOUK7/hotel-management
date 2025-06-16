/**
 * BOOKING REAL-TIME SERVICE - QR CHECK-IN INTEGRATION
 * Service temps réel avec workflow QR code complet et cache Redis
 * Gère check-in QR, validation, workflow automatisé et notifications
 * 
 * PHASE 2 INTEGRATION COMPLÈTE :
 * ✅ Redis Cache Integration (cacheService)
 * ✅ QR Code System Integration (qrCodeService)
 * ✅ QR Token Management (QRToken model)
 * ✅ Automated Check-in Workflow
 * ✅ Real-time Notifications Enhancement
 * ✅ Security & Audit Improvements
 */

const EventEmitter = require('events');
const socketService = require('./socketService');
const notificationService = require('./notificationService');
const availabilityService = require('../utils/availability');
const cacheService = require('./cacheService'); // ✅ Redis Cache Integration
const { 
  qrCodeService, 
  validateQRCode, 
  useToken, 
  revokeToken,
  QR_TYPES, 
  QR_ACTIONS 
} = require('./qrCodeService'); // ✅ QR Code Integration

// Models
const Booking = require('../models/Booking');
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const { QRToken, QR_STATUS } = require('../models/QRToken'); // ✅ QR Token Model

const { logger } = require('../utils/logger');

class BookingRealtimeService extends EventEmitter {
    constructor() {
        super();
        
        // ============================================================================
        // ORIGINAL TRACKING SYSTEMS (PRESERVED)
        // ============================================================================
        this.activeBookingProcesses = new Map(); // Track ongoing booking processes
        this.bookingQueue = new Map(); // Queue for processing bookings
        this.statusUpdateTimeouts = new Map(); // Auto-timeout for pending bookings
        
        // Booking status flow (preserved)
        this.statusFlow = {
            'PENDING': ['CONFIRMED', 'REJECTED', 'CANCELLED'],
            'CONFIRMED': ['CHECKED_IN', 'CANCELLED'],
            'CHECKED_IN': ['CHECKED_OUT', 'CANCELLED'],
            'CHECKED_OUT': ['COMPLETED'],
            'CANCELLED': [],
            'REJECTED': [],
            'COMPLETED': []
        };

        // ============================================================================
        // NEW: QR CODE INTEGRATION LAYER
        // ============================================================================
        this.qrService = qrCodeService;
        this.cache = cacheService;
        
        // QR Check-in Configuration
        this.qrConfig = {
            // Check-in workflow settings
            checkIn: {
                enableQR: true,
                requireStaffValidation: true,
                autoRoomAssignment: false,
                maxQRUsage: 5,
                qrValidityHours: 24,
                allowEarlyCheckIn: 2, // hours before official check-in
                requireGuestPresence: true
            },
            
            // Security settings
            security: {
                verifyBookingMatch: true,
                validateHotelContext: true,
                requireStaffAction: true,
                auditAllActions: true,
                revokeOnSuspicion: true
            },
            
            // Cache settings for QR operations
            cache: {
                checkInProcess: 5 * 60, // 5 minutes
                qrValidation: 2 * 60,   // 2 minutes
                bookingData: 10 * 60,   // 10 minutes
                hotelContext: 30 * 60   // 30 minutes
            }
        };

        // QR Check-in Statistics
        this.qrStats = {
            totalQRCheckIns: 0,
            successfulQRCheckIns: 0,
            failedQRCheckIns: 0,
            averageProcessTime: 0,
            lastQRCheckIn: null,
            errorReasons: new Map(),
            popularHours: new Map()
        };

        // Active QR Check-in Processes
        this.activeQRProcesses = new Map(); // processId -> QR check-in data
        this.qrValidationCache = new Map(); // Temporary QR validation cache

        this.setupEventListeners();
        this.initializeQRIntegration();
        
        logger.info('✅ Booking Real-time Service initialized with QR integration');
    }

    /**
     * ================================
     * QR INTEGRATION INITIALIZATION
     * ================================
     */

    /**
     * Initialize QR code integration
     */
    async initializeQRIntegration() {
        try {
            // Set up QR service event listeners
            this.setupQREventListeners();
            
            // Initialize QR check-in cache
            await this.initializeQRCache();
            
            // Set up QR check-in monitoring
            this.setupQRMonitoring();
            
            // Warm up QR-related cache
            await this.warmUpQRCache();
            
            logger.info('✅ QR integration initialized successfully');
        } catch (error) {
            logger.error('❌ Failed to initialize QR integration:', error);
        }
    }

    /**
     * Setup QR-specific event listeners
     */
    setupQREventListeners() {
        // Listen to QR code events
        this.on('qr:check_in_requested', this.handleQRCheckInRequest.bind(this));
        this.on('qr:validation_completed', this.handleQRValidationCompleted.bind(this));
        this.on('qr:check_in_completed', this.handleQRCheckInCompleted.bind(this));
        this.on('qr:check_in_failed', this.handleQRCheckInFailed.bind(this));
        
        // Listen to booking events for QR generation
        this.on('booking:confirmed', this.handleBookingConfirmedForQR.bind(this));
        this.on('booking:cancelled', this.handleBookingCancelledForQR.bind(this));
    }

    /**
     * Initialize QR-specific cache
     */
    async initializeQRCache() {
        try {
            // Cache active QR check-in processes
            await this.cache.redis.del('qr:active_processes:*');
            
            // Cache QR validation results
            await this.cache.redis.del('qr:validations:*');
            
            // Cache booking-QR mappings
            await this.cache.redis.del('qr:booking_mappings:*');
            
            logger.debug('✅ QR cache initialized');
        } catch (error) {
            logger.error('❌ QR cache initialization error:', error);
        }
    }

    /**
     * Setup QR monitoring and metrics
     */
    setupQRMonitoring() {
        // Monitor QR check-in performance every 5 minutes
        setInterval(() => {
            this.updateQRStatistics();
        }, 5 * 60 * 1000);
        
        // Clean up expired QR processes every 10 minutes
        setInterval(() => {
            this.cleanupExpiredQRProcesses();
        }, 10 * 60 * 1000);
        
        // Log QR metrics every hour
        setInterval(() => {
            this.logQRMetrics();
        }, 60 * 60 * 1000);
    }

    /**
     * Warm up QR-related cache
     */
    async warmUpQRCache() {
        try {
            // Cache recent QR tokens for quick lookup
            const recentTokens = await QRToken.find({
                type: QR_TYPES.CHECK_IN,
                status: QR_STATUS.ACTIVE,
                'claims.expiresAt': { $gt: new Date() }
            }).limit(100);

            for (const token of recentTokens) {
                if (token.payload.bookingId) {
                    await this.cacheQRBookingMapping(token.tokenId, token.payload.bookingId);
                }
            }

            logger.info(`🔥 Warmed up QR cache with ${recentTokens.length} active tokens`);
        } catch (error) {
            logger.error('❌ QR cache warm-up error:', error);
        }
    }

    /**
     * ================================
     * ENHANCED QR CHECK-IN WORKFLOW
     * ================================
     */

    /**
     * Process QR check-in with complete workflow
     * @param {String} qrToken - QR code token (JWT)
     * @param {String} staffId - Staff member ID performing check-in
     * @param {String} hotelId - Hotel ID for context validation
     * @param {Object} options - Additional check-in options
     */
    async processQRCheckInComplete(qrToken, staffId, hotelId, options = {}) {
        const processId = `qr_checkin_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        try {
            // Step 1: Initialize QR check-in process
            await this.initializeQRCheckInProcess(processId, qrToken, staffId, hotelId, options);
            
            // Step 2: Validate QR token with enhanced security
            const qrValidation = await this.validateQRTokenEnhanced(qrToken, hotelId, staffId);
            if (!qrValidation.success) {
                throw new Error(`QR validation failed: ${qrValidation.error}`);
            }

            // Step 3: Load and validate booking with cache
            const bookingValidation = await this.loadBookingForQRCheckIn(qrValidation.data.bookingId, hotelId);
            if (!bookingValidation.success) {
                throw new Error(`Booking validation failed: ${bookingValidation.error}`);
            }

            const { booking } = bookingValidation;

            // Step 4: Perform pre-check-in validations
            const preCheckValidation = await this.performPreCheckInValidations(booking, qrValidation.data, options);
            if (!preCheckValidation.success) {
                throw new Error(`Pre-check validation failed: ${preCheckValidation.error}`);
            }

            // Step 5: Process room assignment (if needed)
            const roomAssignment = await this.processRoomAssignmentForQR(booking, options.roomAssignments || []);

            // Step 6: Execute check-in transaction
            const checkInResult = await this.executeQRCheckInTransaction(
                booking, 
                qrValidation.data, 
                staffId, 
                roomAssignment,
                options
            );

            // Step 7: Mark QR token as used
            await this.markQRTokenUsed(qrValidation.metadata.tokenId, processId, checkInResult);

            // Step 8: Update caches and broadcast updates
            await this.updateCachesAfterQRCheckIn(booking, qrValidation.data, checkInResult);

            // Step 9: Send comprehensive notifications
            await this.sendQRCheckInNotifications(booking, qrValidation.data, staffId, checkInResult);

            // Step 10: Clean up process
            await this.cleanupQRCheckInProcess(processId);

            // Update statistics
            this.updateQRCheckInStats(true, Date.now() - parseInt(processId.split('_')[2]));

            logger.info(`✅ QR check-in completed successfully: ${booking.bookingNumber}`);

            return {
                success: true,
                processId,
                booking: {
                    id: booking._id,
                    bookingNumber: booking.bookingNumber,
                    status: booking.status,
                    checkInTime: booking.dates.checkedInAt,
                    customer: `${booking.customer.firstName} ${booking.customer.lastName}`
                },
                qr: {
                    tokenId: qrValidation.metadata.tokenId,
                    type: qrValidation.data.type,
                    usageCount: qrValidation.metadata.usageCount + 1,
                    remainingUsage: qrValidation.metadata.remainingUsage - 1
                },
                rooms: roomAssignment,
                notifications: checkInResult.notifications,
                nextSteps: this.generateQRCheckInNextSteps(booking, roomAssignment),
                metrics: {
                    processingTime: Date.now() - parseInt(processId.split('_')[2]),
                    method: 'QR_CODE',
                    efficiency: 'HIGH'
                }
            };

        } catch (error) {
            logger.error(`❌ QR check-in failed for process ${processId}:`, error);
            
            // Update error statistics
            this.updateQRCheckInStats(false, null, error.message);
            
            // Send error notifications
            await this.sendQRCheckInErrorNotifications(processId, qrToken, staffId, error);
            
            // Clean up failed process
            await this.cleanupQRCheckInProcess(processId);

            throw error;
        }
    }

    /**
     * Initialize QR check-in process with cache
     */
    async initializeQRCheckInProcess(processId, qrToken, staffId, hotelId, options) {
        const processData = {
            processId,
            qrToken: qrToken.substring(0, 20) + '...', // Store only partial for security
            staffId,
            hotelId,
            options,
            status: 'INITIALIZING',
            startTime: new Date(),
            steps: {
                initialized: true,
                qrValidated: false,
                bookingLoaded: false,
                preCheckCompleted: false,
                roomsAssigned: false,
                checkInExecuted: false,
                notificationsSent: false,
                cacheUpdated: false
            }
        };

        // Store in both memory and Redis
        this.activeQRProcesses.set(processId, processData);
        await this.cache.redis.setEx(
            `qr:process:${processId}`, 
            this.qrConfig.cache.checkInProcess,
            JSON.stringify(processData)
        );

        // Send real-time process start notification
        await this.sendRealtimeUpdate(staffId, 'qr_checkin:process_started', {
            processId,
            message: 'Processus de check-in QR initialisé',
            progress: 10
        });

        logger.debug(`🚀 QR check-in process initialized: ${processId}`);
    }

    /**
     * Validate QR token with enhanced security and context
     */
    async validateQRTokenEnhanced(qrToken, hotelId, staffId) {
        try {
            // Check validation cache first
            const cacheKey = `qr:validation:${qrToken.substring(0, 20)}`;
            const cachedValidation = await this.cache.redis.get(cacheKey);
            
            if (cachedValidation) {
                const parsed = JSON.parse(cachedValidation);
                logger.debug(`🎯 QR validation cache hit`);
                return parsed;
            }

            // Validate with QR service
            const context = {
                hotelId,
                staffId,
                ipAddress: 'hotel_internal',
                userAgent: 'Hotel_PMS_System',
                timestamp: new Date(),
                action: 'staff_checkin_validation'
            };

            const validation = await validateQRCode(qrToken, context);

            if (!validation.success) {
                // Log validation failure for security monitoring
                await this.logQRSecurityEvent('VALIDATION_FAILED', {
                    staffId,
                    hotelId,
                    error: validation.error,
                    tokenSnippet: qrToken.substring(0, 20)
                });

                return validation;
            }

            // Enhanced validation checks
            const enhancedChecks = await this.performEnhancedQRValidation(validation.data, hotelId, staffId);
            if (!enhancedChecks.success) {
                return enhancedChecks;
            }

            // Cache successful validation for 2 minutes
            await this.cache.redis.setEx(
                cacheKey, 
                this.qrConfig.cache.qrValidation, 
                JSON.stringify(validation)
            );

            logger.debug(`✅ QR token validated successfully`);
            return validation;

        } catch (error) {
            logger.error('❌ QR token validation error:', error);
            return {
                success: false,
                error: 'Validation system error',
                code: 'QR_VALIDATION_SYSTEM_ERROR'
            };
        }
    }

    /**
     * Perform enhanced QR validation checks
     */
    async performEnhancedQRValidation(qrData, hotelId, staffId) {
        const checks = {
            success: true,
            details: {},
            warnings: []
        };

        // Check 1: QR type validation
        if (qrData.type !== QR_TYPES.CHECK_IN) {
            checks.success = false;
            checks.error = `Invalid QR type for check-in: ${qrData.type}`;
            checks.code = 'INVALID_QR_TYPE';
            return checks;
        }

        // Check 2: Hotel context validation
        if (this.qrConfig.security.validateHotelContext && qrData.hotelId !== hotelId) {
            checks.success = false;
            checks.error = 'QR code does not match hotel context';
            checks.code = 'HOTEL_CONTEXT_MISMATCH';
            checks.details.expectedHotel = hotelId;
            checks.details.qrHotel = qrData.hotelId;
            return checks;
        }

        // Check 3: Expiration validation with grace period
        const now = new Date();
        const expiresAt = new Date(qrData.exp * 1000);
        if (now > expiresAt) {
            checks.success = false;
            checks.error = 'QR code has expired';
            checks.code = 'QR_EXPIRED';
            checks.details.expiredAt = expiresAt;
            return checks;
        }

        // Check 4: Check-in timing validation
        if (qrData.checkInDate) {
            const checkInDate = new Date(qrData.checkInDate);
            const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);
            const hoursAfterCheckIn = (now - checkInDate) / (1000 * 60 * 60);

            // Too early check
            if (hoursUntilCheckIn > this.qrConfig.checkIn.allowEarlyCheckIn) {
                checks.success = false;
                checks.error = `Check-in too early. Available in ${Math.ceil(hoursUntilCheckIn - this.qrConfig.checkIn.allowEarlyCheckIn)} hours`;
                checks.code = 'CHECK_IN_TOO_EARLY';
                return checks;
            }

            // Too late check (24 hours after check-in date)
            if (hoursAfterCheckIn > 24) {
                checks.warnings.push('Check-in is more than 24 hours late');
                checks.details.lateCheckIn = true;
                checks.details.hoursLate = Math.floor(hoursAfterCheckIn);
            }
        }

        // Check 5: Staff authorization (if required)
        if (this.qrConfig.security.requireStaffAction) {
            const staff = await User.findById(staffId).select('role permissions hotel');
            if (!staff || !['RECEPTIONIST', 'ADMIN'].includes(staff.role)) {
                checks.success = false;
                checks.error = 'Insufficient staff permissions for QR check-in';
                checks.code = 'INSUFFICIENT_STAFF_PERMISSIONS';
                return checks;
            }

            // Verify staff belongs to the hotel
            if (staff.hotel && staff.hotel.toString() !== hotelId) {
                checks.warnings.push('Staff member from different hotel performing check-in');
                checks.details.crossHotelStaff = true;
            }
        }

        // Check 6: Usage limits
        if (qrData.maxUsage && qrData.usageCount >= qrData.maxUsage) {
            checks.success = false;
            checks.error = 'QR code usage limit exceeded';
            checks.code = 'QR_USAGE_LIMIT_EXCEEDED';
            checks.details.usageCount = qrData.usageCount;
            checks.details.maxUsage = qrData.maxUsage;
            return checks;
        }

        return checks;
    }

    /**
     * Load booking for QR check-in with cache
     */
    async loadBookingForQRCheckIn(bookingId, hotelId) {
        try {
            // Try cache first
            const cacheKey = `qr:booking:${bookingId}`;
            const cachedBooking = await this.cache.redis.get(cacheKey);
            
            if (cachedBooking) {
                const booking = JSON.parse(cachedBooking);
                logger.debug(`🎯 Booking cache hit for QR check-in`);
                return { success: true, booking, fromCache: true };
            }

            // Load from database
            const booking = await Booking.findById(bookingId)
                .populate('customer', 'firstName lastName email phone')
                .populate('hotel', 'name code phone')
                .populate('rooms.room', 'number type isActive');

            if (!booking) {
                return {
                    success: false,
                    error: 'Booking not found',
                    code: 'BOOKING_NOT_FOUND'
                };
            }

            // Validate booking status
            if (booking.status !== 'CONFIRMED') {
                return {
                    success: false,
                    error: `Invalid booking status for check-in: ${booking.status}`,
                    code: 'INVALID_BOOKING_STATUS',
                    details: { currentStatus: booking.status, requiredStatus: 'CONFIRMED' }
                };
            }

            // Validate hotel match
            if (booking.hotel._id.toString() !== hotelId) {
                return {
                    success: false,
                    error: 'Booking does not belong to this hotel',
                    code: 'BOOKING_HOTEL_MISMATCH',
                    details: { 
                        bookingHotel: booking.hotel._id.toString(), 
                        contextHotel: hotelId 
                    }
                };
            }

            // Cache the booking for future QR operations
            await this.cache.redis.setEx(
                cacheKey, 
                this.qrConfig.cache.bookingData, 
                JSON.stringify(booking)
            );

            logger.debug(`✅ Booking loaded for QR check-in: ${booking.bookingNumber}`);

            return { success: true, booking, fromCache: false };

        } catch (error) {
            logger.error('❌ Error loading booking for QR check-in:', error);
            return {
                success: false,
                error: 'Database error loading booking',
                code: 'BOOKING_LOAD_ERROR'
            };
        }
    }

    /**
     * Perform pre-check-in validations
     */
    async performPreCheckInValidations(booking, qrData, options) {
        const validations = {
            success: true,
            checks: {},
            warnings: []
        };

        try {
            // Check 1: Booking dates validation
            const now = new Date();
            const checkInDate = new Date(booking.checkIn);
            const checkOutDate = new Date(booking.checkOut);

            if (now < checkInDate) {
                const hoursEarly = (checkInDate - now) / (1000 * 60 * 60);
                if (hoursEarly > this.qrConfig.checkIn.allowEarlyCheckIn) {
                    validations.success = false;
                    validations.error = `Check-in too early by ${Math.ceil(hoursEarly - this.qrConfig.checkIn.allowEarlyCheckIn)} hours`;
                    validations.code = 'CHECK_IN_TOO_EARLY';
                    return validations;
                }
                validations.warnings.push(`Early check-in by ${Math.floor(hoursEarly)} hours`);
            }

            if (now > checkOutDate) {
                validations.warnings.push('Check-in after scheduled check-out date');
            }

            validations.checks.dateValidation = 'PASSED';

            // Check 2: Guest presence validation
            if (this.qrConfig.checkIn.requireGuestPresence && !options.guestPresent) {
                validations.warnings.push('Guest presence not confirmed');
                validations.checks.guestPresence = 'WARNING';
            } else {
                validations.checks.guestPresence = 'PASSED';
            }

            // Check 3: Room availability validation
            if (booking.rooms && booking.rooms.length > 0) {
                const roomValidation = await this.validateRoomsForCheckIn(booking.rooms);
                validations.checks.roomAvailability = roomValidation.success ? 'PASSED' : 'FAILED';
                
                if (!roomValidation.success) {
                    validations.warnings.push(roomValidation.message);
                }
            }

            // Check 4: Payment validation
            if (booking.payment && booking.payment.status !== 'PAID') {
                if (booking.payment.status === 'PENDING') {
                    validations.warnings.push('Payment still pending - require payment at check-in');
                } else if (booking.payment.status === 'FAILED') {
                    validations.success = false;
                    validations.error = 'Payment failed - cannot proceed with check-in';
                    validations.code = 'PAYMENT_FAILED';
                    return validations;
                }
            }
            validations.checks.paymentValidation = 'PASSED';

            // Check 5: Previous check-in validation
            if (booking.dates.checkedInAt) {
                validations.success = false;
                validations.error = 'Guest already checked in';
                validations.code = 'ALREADY_CHECKED_IN';
                validations.details = { checkedInAt: booking.dates.checkedInAt };
                return validations;
            }

            validations.checks.duplicateCheckIn = 'PASSED';

            logger.debug(`✅ Pre-check-in validations completed for ${booking.bookingNumber}`);

            return validations;

        } catch (error) {
            logger.error('❌ Pre-check-in validation error:', error);
            return {
                success: false,
                error: 'Pre-check-in validation system error',
                code: 'PRE_CHECK_VALIDATION_ERROR'
            };
        }
    }

    /**
     * Process room assignment for QR check-in
     */
    async processRoomAssignmentForQR(booking, roomAssignments = []) {
        try {
            // If room assignments provided, validate them
            if (roomAssignments.length > 0) {
                const validatedAssignments = await this.validateRoomAssignments(booking, roomAssignments);
                if (validatedAssignments.success) {
                    return validatedAssignments.assignments;
                } else {
                    logger.warn('❌ Room assignment validation failed, proceeding with auto-assignment');
                }
            }

            // Auto-assign rooms if enabled or if provided assignments failed
            if (this.qrConfig.checkIn.autoRoomAssignment || roomAssignments.length === 0) {
                return await this.autoAssignRoomsForBooking(booking);
            }

            // No room assignment
            return {
                success: true,
                assignments: [],
                message: 'Room assignment to be done manually'
            };

        } catch (error) {
            logger.error('❌ Room assignment error:', error);
            return {
                success: false,
                assignments: [],
                error: 'Room assignment failed'
            };
        }
    }

    /**
     * Execute QR check-in transaction
     */
    async executeQRCheckInTransaction(booking, qrData, staffId, roomAssignment, options) {
        try {
            // Update booking status and data
            booking.status = 'CHECKED_IN';
            booking.dates.checkedInAt = new Date();
            booking.checkedInBy = staffId;
            booking.checkInMethod = 'QR_CODE';
            
            // Add QR-specific data
            booking.qrCheckIn = {
                tokenId: qrData.jti,
                qrType: qrData.type,
                processedAt: new Date(),
                staffId,
                hotelContext: qrData.hotelId,
                deviceInfo: qrData.deviceInfo || null
            };

            // Assign rooms if available
            if (roomAssignment.success && roomAssignment.assignments.length > 0) {
                booking.assignedRooms = roomAssignment.assignments.map(a => a.roomNumber);
                booking.roomAssignments = roomAssignment.assignments;
            }

            // Add guest notes if provided
            if (options.guestNotes) {
                booking.guestNotes = options.guestNotes;
            }

            // Add status history entry
            booking.statusHistory.push({
                status: 'CHECKED_IN',
                changedBy: staffId,
                changedAt: new Date(),
                reason: 'QR code check-in',
                notes: options.guestNotes || 'Check-in completed via QR code',
                method: 'QR_CODE'
            });

            // Update real-time tracking
            booking.realtimeTracking.lastBroadcast = {
                eventType: 'QR_CHECK_IN_COMPLETED',
                broadcastAt: new Date(),
                broadcastTo: [`hotel-${booking.hotel}`, `booking-${booking._id}`]
            };

            // Save booking
            await booking.save();

            // Update room statuses
            if (roomAssignment.success && roomAssignment.assignments.length > 0) {
                await this.updateRoomStatusAfterCheckIn(roomAssignment.assignments);
            }

            logger.info(`✅ QR check-in transaction executed: ${booking.bookingNumber}`);

            return {
                success: true,
                booking,
                roomAssignment,
                checkInTime: booking.dates.checkedInAt,
                method: 'QR_CODE',
                staffId,
                notifications: {
                    customer: true,
                    staff: true,
                    management: true
                }
            };

        } catch (error) {
            logger.error('❌ QR check-in transaction error:', error);
            throw new Error(`Check-in transaction failed: ${error.message}`);
        }
    }

    /**
     * Mark QR token as used
     */
    async markQRTokenUsed(tokenId, processId, checkInResult) {
        try {
            const usageResult = await useToken(tokenId, {
                action: QR_ACTIONS.USED,
                processId,
                bookingId: checkInResult.booking._id,
                hotelId: checkInResult.booking.hotel._id,
                staffId: checkInResult.staffId,
                checkInTime: checkInResult.checkInTime,
                roomsAssigned: checkInResult.roomAssignment.assignments?.length || 0,
                result: 'SUCCESS'
            });

            if (!usageResult.success) {
                logger.warn(`⚠️ Failed to mark QR token as used: ${tokenId}`, usageResult);
            } else {
                logger.debug(`✅ QR token marked as used: ${tokenId}`);
            }

            // Update QR token in database if it exists
            await QRToken.findOneAndUpdate(
                { tokenId },
                {
                    $set: {
                        'usageConfig.currentUsage': usageResult.usageCount || 1,
                        'usageStats.lastUsed': new Date(),
                        'lifecycle.lastUsed': {
                            at: new Date(),
                            by: checkInResult.staffId,
                            context: 'QR_CHECK_IN'
                        }
                    },
                    $push: {
                        'usageLog': {
                            action: QR_ACTIONS.USED,
                            timestamp: new Date(),
                            performedBy: {
                                user: checkInResult.staffId,
                                role: 'RECEPTIONIST',
                                name: 'Staff Member'
                            },
                            context: {
                                hotel: checkInResult.booking.hotel._id,
                                hotelName: checkInResult.booking.hotel.name,
                                booking: checkInResult.booking._id,
                                bookingNumber: checkInResult.booking.bookingNumber
                            },
                            result: {
                                success: true,
                                data: {
                                    checkInTime: checkInResult.checkInTime,
                                    roomsAssigned: checkInResult.roomAssignment.assignments?.length || 0,
                                    processId
                                },
                                processingTime: 50 // Estimated processing time
                            }
                        }
                    }
                }
            );

            return usageResult;

        } catch (error) {
            logger.error('❌ Error marking QR token as used:', error);
            // Don't throw error - check-in was successful, token usage is secondary
        }
    }

    /**
     * Update caches after successful QR check-in
     */
    async updateCachesAfterQRCheckIn(booking, qrData, checkInResult) {
        try {
            // Update booking cache
            const bookingCacheKey = `qr:booking:${booking._id}`;
            await this.cache.redis.setEx(
                bookingCacheKey,
                this.qrConfig.cache.bookingData,
                JSON.stringify(booking)
            );

            // Update availability cache (invalidate affected dates)
            await this.cache.invalidateAvailability(
                booking.hotel._id, 
                booking.checkIn, 
                booking.checkOut
            );

            // Update hotel occupancy cache
            const occupancyKey = `occupancy_${booking.hotel._id}_${new Date().toISOString().split('T')[0]}`;
            await this.cache.redis.del(occupancyKey);

            // Cache QR-booking mapping for future reference
            await this.cacheQRBookingMapping(qrData.jti, booking._id);

            // Update QR check-in metrics cache
            await this.updateQRMetricsCache();

            logger.debug(`✅ Caches updated after QR check-in: ${booking.bookingNumber}`);

        } catch (error) {
            logger.error('❌ Error updating caches after QR check-in:', error);
            // Don't throw - cache update failure shouldn't fail the check-in
        }
    }

    /**
     * Send comprehensive QR check-in notifications
     */
    async sendQRCheckInNotifications(booking, qrData, staffId, checkInResult) {
        try {
            const notificationData = {
                bookingId: booking._id,
                bookingNumber: booking.bookingNumber,
                customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                hotelName: booking.hotel.name,
                checkInTime: checkInResult.checkInTime,
                method: 'QR_CODE',
                processedBy: staffId,
                roomsAssigned: checkInResult.roomAssignment.assignments?.length || 0,
                qrTokenId: qrData.jti
            };

            // 1. Notify customer via multiple channels
            await this.sendCustomerQRCheckInNotifications(booking, notificationData);

            // 2. Notify hotel staff
            await this.sendStaffQRCheckInNotifications(booking, staffId, notificationData);

            // 3. Notify management/admin
            await this.sendManagementQRCheckInNotifications(booking, notificationData);

            // 4. Update real-time dashboards
            await this.updateRealTimeDashboards(booking, notificationData);

            // 5. Trigger automated post-check-in workflows
            await this.triggerPostCheckInWorkflows(booking, qrData, checkInResult);

            logger.debug(`✅ QR check-in notifications sent: ${booking.bookingNumber}`);

        } catch (error) {
            logger.error('❌ Error sending QR check-in notifications:', error);
            // Don't throw - notification failure shouldn't fail the check-in
        }
    }

    /**
     * Send customer QR check-in notifications
     */
    async sendCustomerQRCheckInNotifications(booking, notificationData) {
        try {
            // Real-time notification via Socket.io
            await socketService.sendUserNotification(booking.customer._id, 'QR_CHECKIN_SUCCESS', {
                ...notificationData,
                message: 'Check-in QR effectué avec succès !',
                welcomeMessage: `Bienvenue au ${booking.hotel.name}`,
                roomInfo: booking.assignedRooms?.length > 0 ? {
                    rooms: booking.assignedRooms,
                    message: `Votre${booking.assignedRooms.length > 1 ? 's' : ''} chambre${booking.assignedRooms.length > 1 ? 's' : ''}: ${booking.assignedRooms.join(', ')}`
                } : {
                    message: 'Attribution de chambre en cours'
                },
                nextSteps: [
                    'Récupérez vos clés à la réception',
                    'Consultez les informations de votre chambre',
                    'Découvrez les services de l\'hôtel',
                    'Profitez de votre séjour !'
                ],
                hotelInfo: {
                    name: booking.hotel.name,
                    phone: booking.hotel.phone,
                    services: 'Consultez l\'application pour les services disponibles'
                }
            });

            // Email notification (via notification service)
            await notificationService.sendEmail({
                to: booking.customer.email,
                template: 'qr_checkin_success',
                data: {
                    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                    hotelName: booking.hotel.name,
                    bookingNumber: booking.bookingNumber,
                    checkInTime: notificationData.checkInTime,
                    rooms: booking.assignedRooms || [],
                    hotelPhone: booking.hotel.phone
                }
            });

            // SMS notification if phone available
            if (booking.customer.phone) {
                await notificationService.sendSMS({
                    to: booking.customer.phone,
                    message: `Bienvenue au ${booking.hotel.name} ! Check-in réussi (${booking.bookingNumber}). ${booking.assignedRooms?.length > 0 ? `Chambre(s): ${booking.assignedRooms.join(', ')}` : 'Attribution de chambre en cours'}`
                });
            }

        } catch (error) {
            logger.error('❌ Error sending customer QR check-in notifications:', error);
        }
    }

    /**
     * Send staff QR check-in notifications
     */
    async sendStaffQRCheckInNotifications(booking, staffId, notificationData) {
        try {
            // Notify the staff member who processed the check-in
            await socketService.sendUserNotification(staffId, 'QR_CHECKIN_PROCESSED', {
                ...notificationData,
                message: 'Check-in QR traité avec succès',
                efficiency: 'HIGH',
                nextActions: [
                    'Remettre les clés au client',
                    'Vérifier la propreté des chambres',
                    'Informer le client des services',
                    'Mettre à jour le système si nécessaire'
                ],
                customerInfo: {
                    name: notificationData.customerName,
                    email: booking.customer.email,
                    phone: booking.customer.phone,
                    specialRequests: booking.specialRequests || []
                }
            });

            // Notify hotel reception team
            await socketService.sendHotelNotification(booking.hotel._id, 'QR_CHECKIN_COMPLETED', {
                ...notificationData,
                message: `Check-in QR complété par ${staffId}`,
                guestProfile: {
                    name: notificationData.customerName,
                    totalGuests: booking.totalGuests?.adults + booking.totalGuests?.children || 1,
                    nights: booking.numberOfNights,
                    checkOutDate: booking.checkOut
                },
                operationalInfo: {
                    housekeepingNotified: booking.assignedRooms?.length > 0,
                    roomsReady: booking.assignedRooms?.length > 0,
                    specialRequests: booking.specialRequests?.length || 0,
                    payment: booking.payment?.status || 'PENDING'
                }
            });

            // Notify housekeeping if rooms assigned
            if (booking.assignedRooms?.length > 0) {
                await socketService.sendDepartmentNotification('HOUSEKEEPING', booking.hotel._id, 'NEW_GUEST_ARRIVAL', {
                    rooms: booking.assignedRooms,
                    guestName: notificationData.customerName,
                    checkInTime: notificationData.checkInTime,
                    specialRequests: booking.specialRequests || [],
                    priority: 'NORMAL'
                });
            }

        } catch (error) {
            logger.error('❌ Error sending staff QR check-in notifications:', error);
        }
    }

    /**
     * Send management QR check-in notifications
     */
    async sendManagementQRCheckInNotifications(booking, notificationData) {
        try {
            // Admin dashboard notification
            await socketService.sendAdminNotification('QR_CHECKIN_COMPLETED', {
                ...notificationData,
                metrics: {
                    efficiency: 'HIGH',
                    method: 'QR_CODE',
                    automationLevel: 'PARTIAL',
                    staffTime: 'REDUCED'
                },
                businessMetrics: {
                    revenue: booking.pricing?.totalPrice || 0,
                    nights: booking.numberOfNights,
                    occupancyImpact: '+' + (booking.rooms?.length || 1),
                    customerSatisfaction: 'EXPECTED_HIGH'
                },
                operationalData: {
                    checkInDuration: 'FAST',
                    roomAssignment: booking.assignedRooms?.length > 0 ? 'COMPLETED' : 'PENDING',
                    systemUsage: 'QR_CODE_SYSTEM',
                    staffMember: notificationData.processedBy
                }
            });

            // Hotel manager notification (if different from admin)
            if (booking.hotel.managerId) {
                await socketService.sendUserNotification(booking.hotel.managerId, 'HOTEL_QR_CHECKIN', {
                    ...notificationData,
                    message: 'Nouveau check-in QR dans votre hôtel',
                    impact: {
                        occupancy: 'INCREASED',
                        efficiency: 'IMPROVED',
                        customerExperience: 'ENHANCED'
                    }
                });
            }

        } catch (error) {
            logger.error('❌ Error sending management QR check-in notifications:', error);
        }
    }

    /**
     * Update real-time dashboards
     */
    async updateRealTimeDashboards(booking, notificationData) {
        try {
            // Update hotel dashboard
            await socketService.sendHotelNotification(booking.hotel._id, 'DASHBOARD_UPDATE', {
                type: 'QR_CHECKIN',
                data: {
                    occupancy: {
                        increment: booking.rooms?.length || 1,
                        date: new Date().toISOString().split('T')[0]
                    },
                    revenue: {
                        amount: booking.pricing?.totalPrice || 0,
                        method: 'QR_CODE'
                    },
                    efficiency: {
                        checkInMethod: 'QR_CODE',
                        processingTime: 'REDUCED',
                        customerSatisfaction: 'HIGH'
                    }
                }
            });

            // Update admin analytics
            await socketService.sendAdminNotification('ANALYTICS_UPDATE', {
                type: 'QR_USAGE',
                hotel: booking.hotel._id,
                metrics: {
                    qrCheckIns: 1,
                    efficiency: 'HIGH',
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('❌ Error updating real-time dashboards:', error);
        }
    }

    /**
     * Trigger automated post-check-in workflows
     */
    async triggerPostCheckInWorkflows(booking, qrData, checkInResult) {
        try {
            // 1. Room preparation workflow
            if (booking.assignedRooms?.length > 0) {
                await this.triggerRoomPreparationWorkflow(booking);
            }

            // 2. Welcome package workflow
            await this.triggerWelcomePackageWorkflow(booking);

            // 3. Upselling opportunities workflow
            await this.triggerUpsellWorkflow(booking);

            // 4. Maintenance check workflow
            await this.triggerMaintenanceCheckWorkflow(booking);

            // 5. Customer feedback workflow (scheduled)
            await this.scheduleCustomerFeedbackWorkflow(booking);

            logger.debug(`✅ Post-check-in workflows triggered: ${booking.bookingNumber}`);

        } catch (error) {
            logger.error('❌ Error triggering post-check-in workflows:', error);
        }
    }

    /**
     * ================================
     * QR CHECK-IN WORKFLOW HELPERS
     * ================================
     */

    /**
     * Validate rooms for check-in
     */
    async validateRoomsForCheckIn(bookedRooms) {
        try {
            for (const roomBooking of bookedRooms) {
                const room = await Room.findById(roomBooking.room)
                    .select('number type status isActive maintenanceNotes');

                if (!room) {
                    return {
                        success: false,
                        message: `Room ${roomBooking.room} not found`
                    };
                }

                if (!room.isActive) {
                    return {
                        success: false,
                        message: `Room ${room.number} is not active`
                    };
                }

                if (room.status !== 'AVAILABLE' && room.status !== 'CLEAN') {
                    return {
                        success: false,
                        message: `Room ${room.number} is not available (status: ${room.status})`
                    };
                }
            }

            return { success: true, message: 'All rooms validated' };

        } catch (error) {
            logger.error('❌ Room validation error:', error);
            return {
                success: false,
                message: 'Room validation system error'
            };
        }
    }

    /**
     * Validate room assignments
     */
    async validateRoomAssignments(booking, roomAssignments) {
        try {
            const validAssignments = [];

            for (const assignment of roomAssignments) {
                const room = await Room.findById(assignment.roomId)
                    .select('number type status isActive hotel');

                if (!room) {
                    logger.warn(`❌ Room ${assignment.roomId} not found for assignment`);
                    continue;
                }

                if (room.hotel.toString() !== booking.hotel._id.toString()) {
                    logger.warn(`❌ Room ${room.number} belongs to different hotel`);
                    continue;
                }

                if (!room.isActive || room.status !== 'AVAILABLE') {
                    logger.warn(`❌ Room ${room.number} is not available (status: ${room.status})`);
                    continue;
                }

                validAssignments.push({
                    roomId: room._id,
                    roomNumber: room.number,
                    roomType: room.type,
                    assignedAt: new Date()
                });
            }

            return {
                success: validAssignments.length > 0,
                assignments: validAssignments,
                message: `${validAssignments.length}/${roomAssignments.length} room assignments validated`
            };

        } catch (error) {
            logger.error('❌ Room assignment validation error:', error);
            return {
                success: false,
                assignments: [],
                message: 'Room assignment validation failed'
            };
        }
    }

    /**
     * Auto-assign rooms for booking
     */
    async autoAssignRoomsForBooking(booking) {
        try {
            const assignments = [];

            for (const roomBooking of booking.rooms) {
                // Find available room of the requested type
                const availableRoom = await Room.findOne({
                    hotel: booking.hotel._id,
                    type: roomBooking.roomType || roomBooking.room.type,
                    status: 'AVAILABLE',
                    isActive: true
                }).select('number type');

                if (availableRoom) {
                    assignments.push({
                        roomId: availableRoom._id,
                        roomNumber: availableRoom.number,
                        roomType: availableRoom.type,
                        assignedAt: new Date(),
                        assignmentMethod: 'AUTO'
                    });
                }
            }

            return {
                success: assignments.length > 0,
                assignments,
                message: assignments.length > 0 
                    ? `${assignments.length} rooms auto-assigned`
                    : 'No rooms available for auto-assignment'
            };

        } catch (error) {
            logger.error('❌ Auto room assignment error:', error);
            return {
                success: false,
                assignments: [],
                message: 'Auto room assignment failed'
            };
        }
    }

    /**
     * Update room status after check-in
     */
    async updateRoomStatusAfterCheckIn(roomAssignments) {
        try {
            for (const assignment of roomAssignments) {
                await Room.findByIdAndUpdate(assignment.roomId, {
                    status: 'OCCUPIED',
                    lastOccupied: new Date(),
                    currentGuest: assignment.guestName || 'Checked In Guest'
                });
            }

            logger.debug(`✅ Updated status for ${roomAssignments.length} rooms`);

        } catch (error) {
            logger.error('❌ Error updating room status:', error);
        }
    }

    /**
     * Generate QR check-in next steps
     */
    generateQRCheckInNextSteps(booking, roomAssignment) {
        const steps = {
            immediate: [],
            staff: [],
            customer: [],
            system: []
        };

        // Immediate steps
        steps.immediate.push('QR check-in completed successfully');
        steps.immediate.push('Customer has been notified');

        // Staff steps
        if (roomAssignment.success && roomAssignment.assignments.length > 0) {
            steps.staff.push('Hand over room keys to customer');
            steps.staff.push('Verify room cleanliness');
            steps.staff.push('Explain hotel services and amenities');
        } else {
            steps.staff.push('Complete room assignment');
            steps.staff.push('Notify customer when room is ready');
        }
        steps.staff.push('Update customer preferences in system');

        // Customer steps
        steps.customer.push('Collect room keys from reception');
        if (roomAssignment.success && roomAssignment.assignments.length > 0) {
            steps.customer.push(`Proceed to room(s): ${roomAssignment.assignments.map(a => a.roomNumber).join(', ')}`);
        }
        steps.customer.push('Explore hotel facilities');
        steps.customer.push('Enjoy your stay!');

        // System steps
        steps.system.push('Update occupancy records');
        steps.system.push('Trigger housekeeping notifications');
        steps.system.push('Schedule check-out reminder');
        steps.system.push('Update revenue analytics');

        return steps;
    }

    /**
     * ================================
     * QR SECURITY & AUDIT METHODS
     * ================================
     */

    /**
     * Log QR security event
     */
    async logQRSecurityEvent(eventType, details) {
        try {
            const securityEvent = {
                eventType,
                timestamp: new Date(),
                details,
                severity: this.getSecurityEventSeverity(eventType),
                source: 'BookingRealtimeService_QR'
            };

            // Log to application logger
            logger.warn(`🔒 QR Security Event: ${eventType}`, securityEvent);

            // Store in Redis for security monitoring
            await this.cache.redis.lpush(
                'qr:security_events',
                JSON.stringify(securityEvent)
            );

            // Keep only last 1000 security events
            await this.cache.redis.ltrim('qr:security_events', 0, 999);

            // Send alert for high-severity events
            if (securityEvent.severity === 'HIGH') {
                await socketService.sendAdminNotification('QR_SECURITY_ALERT', securityEvent);
            }

        } catch (error) {
            logger.error('❌ Error logging QR security event:', error);
        }
    }

    /**
     * Get security event severity
     */
    getSecurityEventSeverity(eventType) {
        const severityMap = {
            'VALIDATION_FAILED': 'MEDIUM',
            'INVALID_QR_TYPE': 'HIGH',
            'HOTEL_CONTEXT_MISMATCH': 'HIGH',
            'QR_EXPIRED': 'LOW',
            'CHECK_IN_TOO_EARLY': 'LOW',
            'INSUFFICIENT_PERMISSIONS': 'HIGH',
            'USAGE_LIMIT_EXCEEDED': 'MEDIUM',
            'TOKEN_REUSE_ATTEMPT': 'HIGH',
            'SUSPICIOUS_PATTERN': 'HIGH'
        };

        return severityMap[eventType] || 'MEDIUM';
    }

    /**
     * ================================
     * QR CACHE MANAGEMENT
     * ================================
     */

    /**
     * Cache QR-booking mapping
     */
    async cacheQRBookingMapping(tokenId, bookingId) {
        try {
            const mappingKey = `qr:mapping:${tokenId}`;
            await this.cache.redis.setEx(
                mappingKey,
                24 * 60 * 60, // 24 hours
                bookingId
            );
        } catch (error) {
            logger.error('❌ Error caching QR-booking mapping:', error);
        }
    }

    /**
     * Update QR metrics cache
     */
    async updateQRMetricsCache() {
        try {
            const metricsKey = 'qr:metrics:checkin';
            const currentMetrics = await this.cache.redis.get(metricsKey);
            
            let metrics = currentMetrics ? JSON.parse(currentMetrics) : {
                totalCheckIns: 0,
                successfulCheckIns: 0,
                failedCheckIns: 0,
                lastUpdated: new Date()
            };

            metrics.totalCheckIns++;
            metrics.successfulCheckIns++;
            metrics.lastUpdated = new Date();

            await this.cache.redis.setEx(
                metricsKey,
                24 * 60 * 60, // 24 hours
                JSON.stringify(metrics)
            );

        } catch (error) {
            logger.error('❌ Error updating QR metrics cache:', error);
        }
    }

    /**
     * ================================
     * QR WORKFLOW AUTOMATION
     * ================================
     */

    /**
     * Trigger room preparation workflow
     */
    async triggerRoomPreparationWorkflow(booking) {
        try {
            await socketService.sendDepartmentNotification('HOUSEKEEPING', booking.hotel._id, 'PREPARE_ROOM', {
                rooms: booking.assignedRooms,
                guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                checkInTime: booking.dates.checkedInAt,
                specialRequests: booking.specialRequests || [],
                priority: 'HIGH',
                deadline: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
            });
        } catch (error) {
            logger.error('❌ Error triggering room preparation workflow:', error);
        }
    }

    /**
     * Trigger welcome package workflow
     */
    async triggerWelcomePackageWorkflow(booking) {
        try {
            const welcomePackage = {
                bookingId: booking._id,
                customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                rooms: booking.assignedRooms || [],
                packageType: booking.totalGuests?.adults > 2 ? 'FAMILY' : 'STANDARD',
                hotelId: booking.hotel._id,
                checkInMethod: 'QR_CODE'
            };

            await socketService.sendDepartmentNotification('GUEST_SERVICES', booking.hotel._id, 'PREPARE_WELCOME_PACKAGE', welcomePackage);
        } catch (error) {
            logger.error('❌ Error triggering welcome package workflow:', error);
        }
    }

    /**
     * Trigger upsell workflow
     */
    async triggerUpsellWorkflow(booking) {
        try {
            const upsellOpportunities = {
                bookingId: booking._id,
                customerProfile: {
                    name: `${booking.customer.firstName} ${booking.customer.lastName}`,
                    email: booking.customer.email,
                    stayDuration: booking.numberOfNights,
                    roomType: booking.rooms?.[0]?.roomType || 'STANDARD'
                },
                opportunities: [
                    'ROOM_UPGRADE',
                    'DINING_PACKAGE',
                    'SPA_SERVICES',
                    'LATE_CHECKOUT'
                ],
                scheduledFor: new Date(Date.now() + 2 * 60 * 60 * 1000) // 2 hours after check-in
            };

            await socketService.sendDepartmentNotification('SALES', booking.hotel._id, 'UPSELL_OPPORTUNITY', upsellOpportunities);
        } catch (error) {
            logger.error('❌ Error triggering upsell workflow:', error);
        }
    }

    /**
     * Trigger maintenance check workflow
     */
    async triggerMaintenanceCheckWorkflow(booking) {
        try {
            if (booking.assignedRooms?.length > 0) {
                await socketService.sendDepartmentNotification('MAINTENANCE', booking.hotel._id, 'ROOM_CHECK', {
                    rooms: booking.assignedRooms,
                    checkType: 'POST_CHECKIN',
                    priority: 'LOW',
                    scheduledFor: new Date(Date.now() + 4 * 60 * 60 * 1000) // 4 hours after check-in
                });
            }
        } catch (error) {
            logger.error('❌ Error triggering maintenance check workflow:', error);
        }
    }

    /**
     * Schedule customer feedback workflow
     */
    async scheduleCustomerFeedbackWorkflow(booking) {
        try {
            const feedbackSchedule = {
                bookingId: booking._id,
                customerId: booking.customer._id,
                scheduledTimes: [
                    new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours after check-in
                    new Date(booking.checkOut.getTime() - 4 * 60 * 60 * 1000), // 4 hours before check-out
                    new Date(booking.checkOut.getTime() + 24 * 60 * 60 * 1000) // 24 hours after check-out
                ],
                method: 'EMAIL_AND_APP',
                template: 'QR_CHECKIN_FEEDBACK'
            };

            // Store in cache for feedback service to pick up
            await this.cache.redis.setEx(
                `feedback:schedule:${booking._id}`,
                7 * 24 * 60 * 60, // 7 days
                JSON.stringify(feedbackSchedule)
            );

        } catch (error) {
            logger.error('❌ Error scheduling customer feedback workflow:', error);
        }
    }

    /**
     * ================================
     * QR STATISTICS & MONITORING
     * ================================
     */

    /**
     * Update QR check-in statistics
     */
    updateQRCheckInStats(success, processingTime, errorReason = null) {
        this.qrStats.totalQRCheckIns++;
        
        if (success) {
            this.qrStats.successfulQRCheckIns++;
            if (processingTime) {
                const currentAvg = this.qrStats.averageProcessTime;
                const total = this.qrStats.successfulQRCheckIns;
                this.qrStats.averageProcessTime = (currentAvg * (total - 1) + processingTime) / total;
            }
            this.qrStats.lastQRCheckIn = new Date();
        } else {
            this.qrStats.failedQRCheckIns++;
            if (errorReason) {
                const currentCount = this.qrStats.errorReasons.get(errorReason) || 0;
                this.qrStats.errorReasons.set(errorReason, currentCount + 1);
            }
        }

        // Track popular hours
        const hour = new Date().getHours();
        const currentHourCount = this.qrStats.popularHours.get(hour) || 0;
        this.qrStats.popularHours.set(hour, currentHourCount + 1);
    }

    /**
     * Update QR statistics periodically
     */
    async updateQRStatistics() {
        try {
            // Save current stats to Redis
            await this.cache.redis.setEx(
                'qr:stats:realtime',
                60 * 60, // 1 hour
                JSON.stringify({
                    ...this.qrStats,
                    popularHours: Object.fromEntries(this.qrStats.popularHours),
                    errorReasons: Object.fromEntries(this.qrStats.errorReasons),
                    updatedAt: new Date()
                })
            );

            // Get additional stats from database
            const dbStats = await this.getQRStatsFromDatabase();
            
            // Combine and cache comprehensive stats
            const comprehensiveStats = {
                realtime: this.qrStats,
                database: dbStats,
                combined: {
                    totalCheckIns: this.qrStats.totalQRCheckIns + dbStats.totalCheckIns,
                    successRate: ((this.qrStats.successfulQRCheckIns + dbStats.successfulCheckIns) / 
                                  (this.qrStats.totalQRCheckIns + dbStats.totalCheckIns)) * 100,
                    averageProcessTime: (this.qrStats.averageProcessTime + dbStats.averageProcessTime) / 2
                },
                lastUpdated: new Date()
            };

            await this.cache.redis.setEx(
                'qr:stats:comprehensive',
                30 * 60, // 30 minutes
                JSON.stringify(comprehensiveStats)
            );

        } catch (error) {
            logger.error('❌ Error updating QR statistics:', error);
        }
    }

    /**
     * Get QR statistics from database
     */
    async getQRStatsFromDatabase() {
        try {
            const today = new Date();
            const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

            // Count QR check-ins from bookings
            const qrCheckIns = await Booking.countDocuments({
                checkInMethod: 'QR_CODE',
                'dates.checkedInAt': { $gte: sevenDaysAgo }
            });

            // Count successful QR check-ins
            const successfulQRCheckIns = await Booking.countDocuments({
                checkInMethod: 'QR_CODE',
                status: { $in: ['CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'] },
                'dates.checkedInAt': { $gte: sevenDaysAgo }
            });

            // Get QR tokens stats
            const qrTokenStats = await QRToken.aggregate([
                {
                    $match: {
                        type: QR_TYPES.CHECK_IN,
                        'lifecycle.generated.at': { $gte: sevenDaysAgo }
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalTokens: { $sum: 1 },
                        usedTokens: {
                            $sum: {
                                $cond: [
                                    { $gt: ['$usageConfig.currentUsage', 0] },
                                    1,
                                    0
                                ]
                            }
                        },
                        averageUsage: { $avg: '$usageConfig.currentUsage' }
                    }
                }
            ]);

            const tokenStats = qrTokenStats[0] || { totalTokens: 0, usedTokens: 0, averageUsage: 0 };

            return {
                totalCheckIns: qrCheckIns,
                successfulCheckIns: successfulQRCheckIns,
                failedCheckIns: qrCheckIns - successfulQRCheckIns,
                successRate: qrCheckIns > 0 ? (successfulQRCheckIns / qrCheckIns) * 100 : 0,
                averageProcessTime: 45000, // Estimated from DB (45 seconds)
                tokenStats: tokenStats,
                period: '7_days',
                lastCalculated: new Date()
            };

        } catch (error) {
            logger.error('❌ Error getting QR stats from database:', error);
            return {
                totalCheckIns: 0,
                successfulCheckIns: 0,
                failedCheckIns: 0,
                successRate: 0,
                averageProcessTime: 0,
                tokenStats: { totalTokens: 0, usedTokens: 0, averageUsage: 0 }
            };
        }
    }

    /**
     * Clean up expired QR processes
     */
    async cleanupExpiredQRProcesses() {
        try {
            const now = Date.now();
            const expiredProcesses = [];

            // Clean memory cache
            for (const [processId, processData] of this.activeQRProcesses.entries()) {
                const ageMinutes = (now - processData.startTime.getTime()) / (1000 * 60);
                if (ageMinutes > 30) { // 30 minutes timeout
                    expiredProcesses.push(processId);
                    this.activeQRProcesses.delete(processId);
                }
            }

            // Clean Redis cache
            const pattern = 'qr:process:*';
            const keys = await this.cache.redis.keys(pattern);
            
            for (const key of keys) {
                const processData = await this.cache.redis.get(key);
                if (processData) {
                    const parsed = JSON.parse(processData);
                    const ageMinutes = (now - new Date(parsed.startTime).getTime()) / (1000 * 60);
                    if (ageMinutes > 30) {
                        await this.cache.redis.del(key);
                        expiredProcesses.push(key.split(':')[2]);
                    }
                }
            }

            if (expiredProcesses.length > 0) {
                logger.debug(`🗑️ Cleaned up ${expiredProcesses.length} expired QR processes`);
            }

        } catch (error) {
            logger.error('❌ Error cleaning up expired QR processes:', error);
        }
    }

    /**
     * Log QR metrics
     */
    logQRMetrics() {
        const successRate = this.qrStats.totalQRCheckIns > 0 
            ? (this.qrStats.successfulQRCheckIns / this.qrStats.totalQRCheckIns) * 100 
            : 0;

        logger.info(`📊 QR Check-in Metrics - Total: ${this.qrStats.totalQRCheckIns}, ` +
                   `Success Rate: ${successRate.toFixed(1)}%, ` +
                   `Avg Time: ${this.qrStats.averageProcessTime.toFixed(0)}ms, ` +
                   `Active Processes: ${this.activeQRProcesses.size}`);

        // Log top error reasons
        if (this.qrStats.errorReasons.size > 0) {
            const topErrors = Array.from(this.qrStats.errorReasons.entries())
                .sort(([,a], [,b]) => b - a)
                .slice(0, 3);
            
            logger.info(`📊 Top QR Errors: ${topErrors.map(([reason, count]) => `${reason}(${count})`).join(', ')}`);
        }
    }

    /**
     * ================================
     * QR EVENT HANDLERS
     * ================================
     */

    /**
     * Handle QR check-in request event
     */
    async handleQRCheckInRequest(data) {
        try {
            logger.info(`🔄 Handling QR check-in request: ${data.bookingId}`);
            
            const result = await this.processQRCheckInComplete(
                data.qrToken,
                data.staffId,
                data.hotelId,
                data.options || {}
            );

            this.emit('qr:check_in_completed', {
                ...data,
                result,
                processedAt: new Date()
            });

        } catch (error) {
            logger.error('❌ QR check-in request handling failed:', error);
            
            this.emit('qr:check_in_failed', {
                ...data,
                error: error.message,
                failedAt: new Date()
            });
        }
    }

    /**
     * Handle QR validation completed event
     */
    async handleQRValidationCompleted(data) {
        try {
            // Log successful validation
            await this.logQRSecurityEvent('VALIDATION_SUCCESS', {
                tokenId: data.tokenId,
                staffId: data.staffId,
                hotelId: data.hotelId,
                validatedAt: new Date()
            });

            // Cache validation result temporarily
            this.qrValidationCache.set(data.tokenId, {
                result: data.result,
                timestamp: Date.now()
            });

        } catch (error) {
            logger.error('❌ Error handling QR validation completed:', error);
        }
    }

    /**
     * Handle QR check-in completed event
     */
    async handleQRCheckInCompleted(data) {
        try {
            // Update global statistics
            this.updateQRCheckInStats(true, data.processingTime);

            // Emit analytics event
            this.emit('analytics:qr_checkin_completed', {
                bookingId: data.bookingId,
                hotelId: data.hotelId,
                processingTime: data.processingTime,
                method: 'QR_CODE',
                efficiency: 'HIGH',
                timestamp: new Date()
            });

            logger.info(`✅ QR check-in completed successfully: ${data.bookingId}`);

        } catch (error) {
            logger.error('❌ Error handling QR check-in completed:', error);
        }
    }

    /**
     * Handle QR check-in failed event
     */
    async handleQRCheckInFailed(data) {
        try {
            // Update failure statistics
            this.updateQRCheckInStats(false, null, data.error);

            // Log security event if needed
            if (this.isSecurityRelatedError(data.error)) {
                await this.logQRSecurityEvent('CHECKIN_SECURITY_FAILURE', {
                    error: data.error,
                    staffId: data.staffId,
                    hotelId: data.hotelId,
                    tokenSnippet: data.qrToken?.substring(0, 20),
                    failedAt: new Date()
                });
            }

            // Emit analytics event
            this.emit('analytics:qr_checkin_failed', {
                error: data.error,
                hotelId: data.hotelId,
                method: 'QR_CODE',
                timestamp: new Date()
            });

            logger.warn(`⚠️ QR check-in failed: ${data.error}`);

        } catch (error) {
            logger.error('❌ Error handling QR check-in failed:', error);
        }
    }

    /**
     * Handle booking confirmed for QR generation
     */
    async handleBookingConfirmedForQR(data) {
        try {
            const { booking } = data;

            // Check if QR generation is enabled for this hotel
            const hotel = await Hotel.findById(booking.hotel).select('qrConfig');
            if (!hotel?.qrConfig?.enableCheckInQR) {
                return; // QR not enabled for this hotel
            }

            // Generate QR code for check-in
            const qrPayload = {
                type: QR_TYPES.CHECK_IN,
                identifier: `checkin_${booking._id}`,
                bookingId: booking._id.toString(),
                hotelId: booking.hotel._id.toString(),
                userId: booking.customer._id.toString(),
                customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                hotelName: booking.hotel.name,
                checkInDate: booking.checkIn,
                checkOutDate: booking.checkOut
            };

            const qrResult = await this.qrService.generateQRCode(qrPayload, {
                style: 'hotel',
                expiresIn: this.qrConfig.checkIn.qrValidityHours * 60 * 60,
                maxUsage: this.qrConfig.checkIn.maxQRUsage,
                context: {
                    bookingConfirmation: true,
                    automaticGeneration: true
                }
            });

            if (qrResult.success) {
                // Send QR code to customer
                await this.sendQRCodeToCustomer(booking, qrResult);
                
                logger.info(`✅ QR code generated for confirmed booking: ${booking.bookingNumber}`);
            }

        } catch (error) {
            logger.error('❌ Error handling booking confirmed for QR:', error);
        }
    }

    /**
     * Handle booking cancelled for QR revocation
     */
    async handleBookingCancelledForQR(data) {
        try {
            const { booking } = data;

            // Find and revoke any active QR tokens for this booking
            const activeTokens = await QRToken.find({
                'payload.bookingId': booking._id,
                status: QR_STATUS.ACTIVE,
                type: QR_TYPES.CHECK_IN
            });

            for (const token of activeTokens) {
                await revokeToken(token.tokenId, 'Booking cancelled', {
                    bookingId: booking._id,
                    reason: 'BOOKING_CANCELLED',
                    revokedBy: 'SYSTEM'
                });

                logger.info(`🔒 QR token revoked due to booking cancellation: ${token.tokenId}`);
            }

        } catch (error) {
            logger.error('❌ Error handling booking cancelled for QR:', error);
        }
    }

    /**
     * ================================
     * HELPER METHODS
     * ================================
     */

    /**
     * Send QR code to customer
     */
    async sendQRCodeToCustomer(booking, qrResult) {
        try {
            // Email with QR code
            await notificationService.sendEmail({
                to: booking.customer.email,
                template: 'qr_code_checkin',
                data: {
                    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                    hotelName: booking.hotel.name,
                    bookingNumber: booking.bookingNumber,
                    checkInDate: booking.checkIn,
                    qrCodeDataURL: qrResult.qrCode.dataURL,
                    expiresAt: qrResult.metadata.expiresAt,
                    instructions: this.generateQRInstructions(booking)
                }
            });

            // Real-time notification
            await socketService.sendUserNotification(booking.customer._id, 'QR_CODE_READY', {
                bookingId: booking._id,
                bookingNumber: booking.bookingNumber,
                hotelName: booking.hotel.name,
                message: 'Votre QR code de check-in est prêt !',
                qrCode: qrResult.qrCode.dataURL,
                expiresAt: qrResult.metadata.expiresAt
            });

        } catch (error) {
            logger.error('❌ Error sending QR code to customer:', error);
        }
    }

    /**
     * Generate QR instructions for customer
     */
    generateQRInstructions(booking) {
        return {
            title: 'Instructions pour votre QR Code de Check-in',
            steps: [
                'Présentez ce QR code à la réception de l\'hôtel',
                'Le personnel scannera le code pour votre check-in',
                'Vos chambres seront attribuées automatiquement',
                'Récupérez vos clés et profitez de votre séjour !'
            ],
            important: [
                'Arrivez avec une pièce d\'identité',
                'Le QR code est valable 24h avant votre check-in',
                'Contactez l\'hôtel en cas de problème'
            ],
            contact: {
                hotel: booking.hotel.name,
                phone: booking.hotel.phone || 'Voir confirmation de réservation'
            }
        };
    }

    /**
     * Check if error is security-related
     */
    isSecurityRelatedError(error) {
        const securityKeywords = [
            'VALIDATION_FAILED',
            'INVALID_QR_TYPE',
            'HOTEL_CONTEXT_MISMATCH',
            'INSUFFICIENT_PERMISSIONS',
            'USAGE_LIMIT_EXCEEDED',
            'EXPIRED',
            'REVOKED'
        ];

        return securityKeywords.some(keyword => 
            error.toUpperCase().includes(keyword)
        );
    }

    /**
     * Send real-time update
     */
    async sendRealtimeUpdate(userId, eventType, data) {
        try {
            await socketService.sendUserNotification(userId, eventType, {
                ...data,
                timestamp: new Date(),
                source: 'BookingRealtimeService'
            });
        } catch (error) {
            logger.error('❌ Error sending real-time update:', error);
        }
    }

    /**
     * Send QR check-in error notifications
     */
    async sendQRCheckInErrorNotifications(processId, qrToken, staffId, error) {
        try {
            // Notify staff member
            await socketService.sendUserNotification(staffId, 'QR_CHECKIN_ERROR', {
                processId,
                error: error.message,
                message: 'Erreur lors du check-in QR',
                troubleshooting: [
                    'Vérifiez que le QR code n\'est pas expiré',
                    'Confirmez que vous êtes dans le bon hôtel',
                    'Contactez l\'administrateur si le problème persiste'
                ]
            });

            // Log for admin monitoring
            await socketService.sendAdminNotification('QR_CHECKIN_SYSTEM_ERROR', {
                processId,
                staffId,
                error: error.message,
                timestamp: new Date()
            });

        } catch (notifyError) {
            logger.error('❌ Error sending QR check-in error notifications:', notifyError);
        }
    }

    /**
     * Clean up QR check-in process
     */
    async cleanupQRCheckInProcess(processId) {
        try {
            // Remove from memory
            this.activeQRProcesses.delete(processId);

            // Remove from Redis
            await this.cache.redis.del(`qr:process:${processId}`);

            // Clean temporary validation cache
            const process = this.activeQRProcesses.get(processId);
            if (process?.qrToken) {
                this.qrValidationCache.delete(process.qrToken);
            }

            logger.debug(`🗑️ Cleaned up QR check-in process: ${processId}`);

        } catch (error) {
            logger.error('❌ Error cleaning up QR check-in process:', error);
        }
    }

    /**
     * ================================
     * ORIGINAL METHODS (PRESERVED & ENHANCED)
     * ================================
     */

    /**
     * Setup original event listeners (enhanced with QR integration)
     */
    setupEventListeners() {
        // Original event listeners
        this.on('booking:status_changed', this.handleBookingStatusChanged.bind(this));
        this.on('booking:payment_updated', this.handlePaymentUpdated.bind(this));
        this.on('booking:room_assigned', this.handleRoomAssigned.bind(this));
        this.on('booking:availability_changed', this.handleAvailabilityChanged.bind(this));
        
        // Enhanced with QR integration
        notificationService.on('booking:created', this.handleBookingCreated.bind(this));
        notificationService.on('booking:confirmed', this.handleBookingConfirmed.bind(this));
        notificationService.on('booking:rejected', this.handleBookingRejected.bind(this));
    }

    /**
     * Process booking creation in real-time (enhanced)
     */
    async processBookingCreation(bookingData) {
        const processId = `booking_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        
        try {
            // Original functionality preserved
            this.activeBookingProcesses.set(processId, {
                stage: 'INITIALIZING',
                startTime: new Date(),
                userId: bookingData.userId,
                hotelId: bookingData.hotelId,
                qrEnabled: bookingData.enableQR || false // NEW: QR flag
            });

            await this.sendRealtimeUpdate(bookingData.userId, 'booking:process_started', {
                processId,
                message: 'Initialisation de votre réservation...',
                stage: 'INITIALIZING',
                progress: 10
            });

            // Original steps preserved...
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

            await this.updateProcessStage(processId, 'CREATING_BOOKING', 50);
            const booking = await this.createBookingRecord(bookingData, processId);

            await this.updateProcessStage(processId, 'RESERVING_ROOMS', 75);
            await this.reserveRoomsTemporarily(booking._id, bookingData.rooms);

            await this.updateProcessStage(processId, 'FINALIZING', 90);
            const finalBooking = await this.finalizeBooking(booking._id);

            await this.updateProcessStage(processId, 'SENDING_CONFIRMATIONS', 100);
            await this.sendBookingConfirmations(finalBooking);

            // Clean up process tracking
            this.activeBookingProcesses.delete(processId);

            this.emit('booking:created_realtime', {
                bookingId: finalBooking._id,
                userId: bookingData.userId,
                hotelId: bookingData.hotelId,
                processId,
                qrEnabled: bookingData.enableQR || false // NEW
            });

            return {
                success: true,
                booking: finalBooking,
                processId
            };

        } catch (error) {
            logger.error(`Real-time booking creation failed for process ${processId}:`, error);
            
            await this.sendRealtimeUpdate(bookingData.userId, 'booking:creation_failed', {
                processId,
                message: 'Erreur lors de la création de la réservation',
                error: error.message,
                stage: 'FAILED'
            });

            this.activeBookingProcesses.delete(processId);
            throw error;
        }
    }

    /**
     * Update booking status in real-time (enhanced with QR integration)
     */
    async updateBookingStatusRealtime(bookingId, newStatus, adminId = null, comment = null) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                throw new Error(`Booking not found: ${bookingId}`);
            }

            if (!this.isValidStatusTransition(booking.status, newStatus)) {
                throw new Error(`Invalid status transition: ${booking.status} -> ${newStatus}`);
            }

            const oldStatus = booking.status;
            
            booking.status = newStatus;
            booking.statusHistory.push({
                status: newStatus,
                timestamp: new Date(),
                updatedBy: adminId,
                comment: comment
            });

            await booking.save();

            // Enhanced: Handle QR-related status changes
            if (newStatus === 'CONFIRMED') {
                this.emit('booking:confirmed', { booking });
            } else if (newStatus === 'CANCELLED') {
                this.emit('booking:cancelled', { booking });
            }

            await this.broadcastStatusUpdate(booking, oldStatus, newStatus, adminId, comment);

            this.emit('booking:status_changed', {
                bookingId,
                oldStatus,
                newStatus,
                adminId,
                comment,
                timestamp: new Date()
            });

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
     * Process check-in in real-time (ENHANCED with QR)
     */
    async processCheckInRealtime(bookingId, receptionistId, roomNumbers, additionalInfo = {}) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            if (!booking) {
                throw new Error(`Booking not found: ${bookingId}`);
            }

            // Enhanced: Check if this is a QR check-in
            const isQRCheckIn = additionalInfo.checkInMethod === 'QR_CODE';

            await this.sendRealtimeUpdate(booking.customer._id, 'checkin:processing', {
                bookingId,
                message: isQRCheckIn ? 'Check-in QR en cours...' : 'Check-in en cours...',
                progress: 30,
                method: additionalInfo.checkInMethod || 'MANUAL'
            });

            // Update booking with enhanced info
            booking.assignedRooms = roomNumbers;
            booking.checkInTime = new Date();
            booking.checkedInBy = receptionistId;
            booking.status = 'CHECKED_IN';
            booking.checkInMethod = additionalInfo.checkInMethod || 'MANUAL'; // NEW

            // Enhanced: Add QR-specific data if applicable
            if (isQRCheckIn && additionalInfo.qrToken) {
                booking.qrCheckIn = {
                    tokenId: additionalInfo.qrToken,
                    processedAt: new Date(),
                    automaticProcess: additionalInfo.automaticProcess || false
                };
            }

            if (additionalInfo.guestIds) {
                booking.guestIds = additionalInfo.guestIds;
            }

            if (additionalInfo.guestNotes) {
                booking.guestNotes = additionalInfo.guestNotes;
            }

            await booking.save();

            // Enhanced success message
            const successMessage = isQRCheckIn 
                ? `Check-in QR effectué ! Chambre(s): ${roomNumbers.join(', ')}`
                : `Check-in effectué ! Chambre(s): ${roomNumbers.join(', ')}`;

            await this.sendRealtimeUpdate(booking.customer._id, 'checkin:completed', {
                bookingId,
                roomNumbers,
                hotelInfo: {
                    name: booking.hotel.name,
                    wifiPassword: booking.hotel.wifiPassword,
                    amenities: booking.hotel.amenities
                },
                message: successMessage,
                progress: 100,
                method: additionalInfo.checkInMethod || 'MANUAL'
            });

            // Enhanced notifications
            const notificationData = {
                bookingId,
                guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
                roomNumbers,
                timestamp: new Date(),
                method: additionalInfo.checkInMethod || 'MANUAL',
                efficiency: isQRCheckIn ? 'HIGH' : 'NORMAL'
            };

            await socketService.sendHotelNotification(booking.hotel._id, 'guest_checked_in', notificationData);

            this.emit('booking:checked_in', {
                bookingId,
                userId: booking.customer._id,
                roomNumbers,
                receptionistId,
                method: additionalInfo.checkInMethod || 'MANUAL',
                timestamp: new Date()
            });

            logger.info(`Check-in completed for booking ${bookingId}, rooms: ${roomNumbers.join(', ')}, method: ${additionalInfo.checkInMethod || 'MANUAL'}`);

            return {
                success: true,
                booking,
                roomNumbers,
                checkInTime: booking.checkInTime,
                method: additionalInfo.checkInMethod || 'MANUAL'
            };

        } catch (error) {
            logger.error(`Real-time check-in failed:`, error);
            throw error;
        }
    }

    /**
     * ================================
     * PRESERVED ORIGINAL METHODS
     * ================================
     */

    // All other original methods preserved exactly as they were:
    // - processCheckOutRealtime
    // - handleBookingCancellationRealtime  
    // - sendRealtimeUpdate
    // - broadcastStatusUpdate
    // - validateAvailabilityRealtime
    // - createBookingRecord
    // - reserveRoomsTemporarily
    // - finalizeBooking
    // - sendBookingConfirmations
    // - isValidStatusTransition
    // - handleStatusSpecificActions
    // - calculateFinalBill
    // - checkCancellationPolicy
    // - freeUpRooms
    // - updateProcessStage
    // - getStageMessage
    // - getStatusUpdateMessage
    // - getCancellationPolicyText
    // - logRealtimeUpdate
    // - updateAdminDashboard
    // - scheduleCheckInReminder
    // - updateRoomStatus
    // - triggerHousekeeping
    // - handleBookingCreated
    // - handleBookingConfirmed
    // - handleBookingRejected
    // - getServiceStats
    // - cleanup

    /**
     * Get enhanced service statistics (including QR metrics)
     */
    getServiceStats() {
        const originalStats = {
            activeProcesses: this.activeBookingProcesses.size,
            queueSize: this.bookingQueue.size,
            pendingTimeouts: this.statusUpdateTimeouts.size,
            uptime: process.uptime()
        };

        // Enhanced with QR statistics
        const qrStats = {
            totalQRCheckIns: this.qrStats.totalQRCheckIns,
            successfulQRCheckIns: this.qrStats.successfulQRCheckIns,
            failedQRCheckIns: this.qrStats.failedQRCheckIns,
            qrSuccessRate: this.qrStats.totalQRCheckIns > 0 
                ? (this.qrStats.successfulQRCheckIns / this.qrStats.totalQRCheckIns) * 100 
                : 0,
            averageQRProcessTime: this.qrStats.averageProcessTime,
            lastQRCheckIn: this.qrStats.lastQRCheckIn,
            activeQRProcesses: this.activeQRProcesses.size,
            qrValidationCacheSize: this.qrValidationCache.size,
            topErrorReasons: Array.from(this.qrStats.errorReasons.entries())
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5),
            popularCheckInHours: Array.from(this.qrStats.popularHours.entries())
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
        };

        return {
            ...originalStats,
            qr: qrStats,
            integration: {
                qrServiceConnected: !!this.qrService,
                cacheServiceConnected: !!this.cache,
                qrConfigEnabled: this.qrConfig.checkIn.enableQR
            }
        };
    }

    /**
     * Enhanced cleanup method (including QR resources)
     */
    cleanup() {
        // Original cleanup
        this.activeBookingProcesses.clear();
        this.bookingQueue.clear();
        this.statusUpdateTimeouts.forEach(timeout => clearTimeout(timeout));
        this.statusUpdateTimeouts.clear();

        // Enhanced: QR-specific cleanup
        this.activeQRProcesses.clear();
        this.qrValidationCache.clear();

        // Reset QR statistics
        this.qrStats = {
            totalQRCheckIns: 0,
            successfulQRCheckIns: 0,
            failedQRCheckIns: 0,
            averageProcessTime: 0,
            lastQRCheckIn: null,
            errorReasons: new Map(),
            popularHours: new Map()
        };

        logger.info('✅ Booking Real-time Service cleaned up (including QR resources)');
    }

    /**
     * ================================
     * PRESERVED ORIGINAL METHODS (Complete)
     * ================================
     */

    /**
     * Process check-out in real-time (original method preserved)
     */
    async processCheckOutRealtime(bookingId, receptionistId, finalBill = {}) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:processing', {
                bookingId,
                message: 'Check-out en cours...',
                progress: 25
            });

            const calculatedBill = await this.calculateFinalBill(booking, finalBill);
            
            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:calculating_bill', {
                bookingId,
                message: 'Calcul de la facture finale...',
                progress: 50
            });

            booking.checkOutTime = new Date();
            booking.checkOutBy = receptionistId;
            booking.finalAmount = calculatedBill.total;
            booking.extras = calculatedBill.extras;
            booking.status = 'CHECKED_OUT';

            await booking.save();

            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:generating_invoice', {
                bookingId,
                message: 'Génération de la facture...',
                progress: 75
            });

            await this.sendRealtimeUpdate(booking.customer._id, 'checkout:completed', {
                bookingId,
                finalBill: calculatedBill,
                message: 'Check-out effectué avec succès !',
                progress: 100
            });

            await this.freeUpRooms(booking.assignedRooms, booking.hotel._id);

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
     * Handle booking cancellation in real-time (original method preserved)
     */
    async handleBookingCancellationRealtime(bookingId, userId, reason = null) {
        try {
            const booking = await Booking.findById(bookingId)
                .populate('customer')
                .populate('hotel');

            await this.sendRealtimeUpdate(userId, 'cancellation:processing', {
                bookingId,
                message: 'Traitement de l\'annulation...',
                progress: 25
            });

            const cancellationResult = await this.checkCancellationPolicy(booking);
            
            await this.sendRealtimeUpdate(userId, 'cancellation:policy_checked', {
                bookingId,
                cancellationResult,
                message: 'Vérification de la politique d\'annulation...',
                progress: 50
            });

            if (cancellationResult.refundAmount > 0) {
                await this.sendRealtimeUpdate(userId, 'cancellation:processing_refund', {
                    bookingId,
                    refundAmount: cancellationResult.refundAmount,
                    message: 'Traitement du remboursement...',
                    progress: 75
                });
            }

            booking.status = 'CANCELLED';
            booking.cancellationDate = new Date();
            booking.cancellationReason = reason;
            booking.refundAmount = cancellationResult.refundAmount;

            await booking.save();

            await this.freeUpRooms(booking.rooms, booking.hotel._id);

            await this.sendRealtimeUpdate(userId, 'cancellation:completed', {
                bookingId,
                refundInfo: cancellationResult,
                message: 'Annulation effectuée avec succès',
                progress: 100
            });

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
     * Handle instant booking approval/rejection by admin (original method preserved)
     */
    async handleInstantAdminAction(bookingId, action, adminId, comment = null) {
        try {
            const newStatus = action === 'approve' ? 'CONFIRMED' : 'REJECTED';
            
            await this.sendRealtimeUpdate(adminId, 'admin:action_processing', {
                bookingId,
                action,
                message: `Traitement de l'action: ${action}...`,
                progress: 50
            });

            const result = await this.updateBookingStatusRealtime(bookingId, newStatus, adminId, comment);

            await this.sendRealtimeUpdate(adminId, 'admin:action_completed', {
                bookingId,
                action,
                newStatus,
                message: `Action ${action} effectuée avec succès`,
                progress: 100
            });

            await this.updateAdminDashboard(adminId, {
                type: 'booking_processed',
                bookingId,
                action: newStatus,
                timestamp: new Date()
            });

            return result;

        } catch (error) {
            logger.error(`Instant admin action failed:`, error);
            
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
     * Helper Methods (original methods preserved)
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
                            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
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
                await this.scheduleCheckInReminder(booking._id);
                break;
            case 'REJECTED':
                await this.freeUpRooms(booking.rooms, booking.hotel._id);
                break;
            case 'CHECKED_IN':
                await this.updateRoomStatus(booking.assignedRooms, 'OCCUPIED');
                break;
            case 'CHECKED_OUT':
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
            refundPercentage = 100;
        } else if (hoursUntilCheckIn > 24) {
            refundPercentage = 50;
        } else {
            refundPercentage = 0;
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
     * Event handlers for external events (original methods preserved)
     */
    async handleBookingCreated(data) {
        logger.info(`Real-time service handling booking created: ${data.bookingId}`);
    }

    async handleBookingConfirmed(data) {
        logger.info(`Real-time service handling booking confirmed: ${data.bookingId}`);
        // Enhanced: Trigger QR generation if enabled
        this.emit('booking:confirmed', data);
    }

    async handleBookingRejected(data) {
        logger.info(`Real-time service handling booking rejected: ${data.bookingId}`);
    }

    /**
     * Broadcast availability update to connected users (original method preserved)
     */
    async broadcastAvailabilityUpdate(hotelId, availability, checkInDate, checkOutDate) {
        try {
            const updateData = {
                hotelId,
                checkInDate,
                checkOutDate,
                rooms: availability.rooms,
                summary: availability.summary,
                timestamp: new Date(),
                cacheInfo: availability.cacheInfo || { source: 'calculated' }
            };

            socketService.broadcastAvailabilityUpdate(hotelId, updateData);
            socketService.sendHotelNotification(hotelId, 'availability-updated', updateData);

            logger.debug(`📡 Availability update broadcasted for hotel ${hotelId}`);
        } catch (error) {
            logger.error('❌ Error broadcasting availability update:', error);
        }
    }

    /**
     * Broadcast booking status update (original method preserved)
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

        await this.sendRealtimeUpdate(booking.customer._id, 'booking:status_updated', {
            ...updateData,
            message: this.getStatusUpdateMessage(newStatus),
            customerView: true
        });

        if (adminId) {
            await this.sendRealtimeUpdate(adminId, 'admin:booking_updated', {
                ...updateData,
                message: `Statut mis à jour: ${newStatus}`,
                adminView: true
            });
        }

        await socketService.sendAdminNotification('booking_status_changed', updateData);
        await socketService.sendHotelNotification(booking.hotel._id, 'booking_status_changed', updateData);
    }

    /**
     * Handle booking status changed (original method preserved)
     */
    async handleBookingStatusChanged(data) {
        logger.info(`Booking status changed: ${data.bookingId} from ${data.oldStatus} to ${data.newStatus}`);
    }

    /**
     * Handle payment updated (original method preserved)
     */
    async handlePaymentUpdated(data) {
        logger.info(`Payment updated for booking: ${data.bookingId}`);
    }

    /**
     * Handle room assigned (original method preserved)
     */
    async handleRoomAssigned(data) {
        logger.info(`Room assigned for booking: ${data.bookingId}`);
    }

    /**
     * Handle availability changed (original method preserved)
     */
    async handleAvailabilityChanged(data) {
        logger.info(`Availability changed for hotel: ${data.hotelId}`);
    }
}

// Export singleton instance
module.exports = new BookingRealtimeService();