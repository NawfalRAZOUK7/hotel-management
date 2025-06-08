/**
 * BOOKING CONTROLLER - CRUD COMPLET + WORKFLOW COMPLEXE + REAL-TIME NOTIFICATIONS + YIELD MANAGEMENT
 * Gestion des réservations avec workflow métier complet, notifications temps réel et yield management
 *
 * Workflow : PENDING → CONFIRMED → CHECKED_IN → COMPLETED
 *           ↘ REJECTED   ↘ CANCELLED   ↘ NO_SHOW
 *
 * Fonctionnalités :
 * - CRUD réservations avec permissions par rôle
 * - Workflow statuts avec validations business
 * - Calcul prix automatique + availability checking
 * - Gestion extras (mini-bar, services additionnels)
 * - Génération factures PDF
 * - Check-in/Check-out avec attribution chambres
 * - Notifications automatiques TEMPS RÉEL via Socket.io
 * - Support réservations multiples chambres
 * - Real-time availability broadcasting
 * - Instant booking confirmations
 * - Live status updates for all stakeholders
 * - YIELD MANAGEMENT avec pricing dynamique
 * - Optimisation des revenus en temps réel
 * - Analyse de la demande et prévisions
 */

const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');
const mongoose = require('mongoose');

// Socket.io service for real-time notifications
const socketService = require('../services/socketService');

// Email and SMS services
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');

// Real-time services
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const bookingRealtimeService = require('../services/bookingRealtimeService');

// YIELD MANAGEMENT SERVICES
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');

const {
  BOOKING_STATUS,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_SOURCES,
  ROOM_STATUS,
  USER_ROLES,
  CLIENT_TYPES,
  BUSINESS_RULES,
  ERROR_MESSAGES,
  canTransitionBookingStatus,
} = require('../utils/constants');

const {
  calculateBookingPrice,
  validatePrice,
  // NEW: Import yield management functions
  applyPricingRules,
  calculateRevPAR,
  suggestRevenueOptimization,
} = require('../utils/pricing');

const {
  // checkAvailability, // Remove - using availabilityRealtimeService instead
  invalidateHotelCache,
  // updateRoomAvailability, // Remove - using availabilityRealtimeService instead
  // broadcastAvailabilityChanges // Remove - using socketService instead
} = require('../utils/availability');

/**
 * ================================
 * REAL-TIME HELPER FUNCTIONS
 * ================================
 */

/**
 * Broadcast booking event to all relevant parties
 */
const broadcastBookingEvent = async (eventType, booking, additionalData = {}) => {
  try {
    const eventData = {
      eventType,
      bookingId: booking._id,
      hotelId: booking.hotel._id || booking.hotel,
      customerId: booking.customer._id || booking.customer,
      status: booking.status,
      timestamp: new Date(),
      ...additionalData,
    };

    // Send to booking room for real-time tracking
    socketService.sendBookingNotification(booking._id, eventType, eventData);

    // Send to hotel for staff monitoring
    socketService.sendHotelNotification(booking.hotel._id || booking.hotel, eventType, eventData);

    // Send to customer for personal updates
    socketService.sendUserNotification(
      booking.customer._id || booking.customer,
      eventType,
      eventData
    );

    // Send to admins for critical events
    const criticalEvents = [
      'BOOKING_CREATED',
      'BOOKING_CANCELLED',
      'PAYMENT_ISSUE',
      'OVERBOOKING_RISK',
    ];
    if (criticalEvents.includes(eventType)) {
      socketService.sendAdminNotification(eventType, eventData);
    }
  } catch (error) {
    console.error('Error broadcasting booking event:', error);
  }
};

/**
 * ================================
 * CRUD OPERATIONS - CRÉATION WITH YIELD MANAGEMENT
 * ================================
 */

/**
 * @desc    Créer une nouvelle réservation avec yield management
 * @route   POST /api/bookings
 * @access  Client (ses propres réservations) + Receptionist (pour clients) + Admin
 */
const createBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const {
      hotelId,
      checkInDate,
      checkOutDate,
      rooms, // [{ type, quantity }]
      numberOfGuests,
      specialRequests,
      source = BOOKING_SOURCES.WEB,
      customerInfo, // Pour réservations à la réception
      corporateDetails, // Pour entreprises
      currency = 'EUR', // Pour yield management
    } = req.body;

    // ================================
    // VALIDATIONS PRÉLIMINAIRES
    // ================================

    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide',
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (checkIn >= checkOut) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_DATE_RANGE,
      });
    }

    if (checkIn < new Date()) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.DATE_IN_PAST,
      });
    }

    // Validation nombre de nuits
    const nightsCount = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (
      nightsCount < BUSINESS_RULES.MIN_BOOKING_NIGHTS ||
      nightsCount > BUSINESS_RULES.MAX_BOOKING_NIGHTS
    ) {
      return res.status(400).json({
        success: false,
        message: `Durée séjour invalide (${BUSINESS_RULES.MIN_BOOKING_NIGHTS}-${BUSINESS_RULES.MAX_BOOKING_NIGHTS} nuits)`,
      });
    }

    // Validation chambres demandées
    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins une chambre requise',
      });
    }

    const totalRooms = rooms.reduce((sum, room) => sum + (room.quantity || 1), 0);
    if (totalRooms > BUSINESS_RULES.MAX_ROOMS_PER_BOOKING) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${BUSINESS_RULES.MAX_ROOMS_PER_BOOKING} chambres par réservation`,
      });
    }

    // ================================
    // REAL-TIME AVAILABILITY CHECK WITH YIELD PRICING
    // ================================

    // Notify about booking attempt in real-time
    socketService.sendHotelNotification(hotelId, 'BOOKING_ATTEMPT', {
      checkIn,
      checkOut,
      roomsRequested: totalRooms,
      timestamp: new Date(),
    });

    // ================================
    // VÉRIFICATION HÔTEL ET CUSTOMER
    // ================================

    const hotel = await Hotel.findById(hotelId).select('name code category yieldManagement');
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND,
      });
    }

    // Déterminer le customer (réservation personnelle vs à la réception)
    let customerId = req.user.id;
    let clientType = CLIENT_TYPES.INDIVIDUAL;

    if (req.user.role === USER_ROLES.RECEPTIONIST && customerInfo) {
      // Réservation créée par réceptionniste pour un client
      if (customerInfo.existingCustomerId) {
        customerId = customerInfo.existingCustomerId;
      } else {
        // Créer nouveau compte client
        const newCustomer = await createCustomerAccount(customerInfo, session);
        customerId = newCustomer._id;
      }
    }

    // Gérer réservations entreprises
    if (corporateDetails && corporateDetails.siret) {
      clientType = CLIENT_TYPES.CORPORATE;

      // Validation SIRET
      if (corporateDetails.siret.length !== BUSINESS_RULES.SIRET_LENGTH) {
        return res.status(400).json({
          success: false,
          message: 'SIRET invalide (14 chiffres requis)',
        });
      }
    }

    await session.withTransaction(async () => {
      // ================================
      // VÉRIFICATION DISPONIBILITÉ EN TEMPS RÉEL
      // ================================

      const roomsToBook = [];
      let totalPrice = 0;
      let yieldPricingDetails = [];

      // Track availability search session
      availabilityRealtimeService.trackSearchSession(req.user.id, {
        hotelId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        currency: currency || 'EUR',
      });

      for (const roomRequest of rooms) {
        const { type, quantity = 1 } = roomRequest;

        // Validation des paramètres avant l'appel
        if (!hotelId || !checkIn || !checkOut) {
          throw new Error('Paramètres manquants pour vérifier la disponibilité');
        }

        const currency = req.body.currency || 'EUR';
        if (!['EUR', 'USD', 'MAD'].includes(currency)) {
          throw new Error('Currency not supported');
        }

        // Real-time availability check with broadcasting
        const availability = await availabilityRealtimeService.getRealTimeAvailability(
          hotelId,
          checkIn,
          checkOut,
          currency
        );

        if (!availability.rooms[type] || availability.rooms[type].availableRooms < quantity) {
          // Broadcast availability issue
          socketService.sendUserNotification(req.user.id, 'AVAILABILITY_ISSUE', {
            roomType: type,
            requested: quantity,
            available: availability.rooms[type]?.availableRooms || 0,
            suggestion: "Essayez d'autres dates ou types de chambres",
          });

          throw new Error(
            `Pas assez de chambres ${type} disponibles. Demandé: ${quantity}, Disponible: ${availability.rooms[type]?.availableRooms || 0}`
          );
        }

        // ================================
        // YIELD MANAGEMENT PRICING
        // ================================

        let finalPricePerRoom = availability.rooms[type].currentPrice;
        let useYieldManagement = hotel.yieldManagement?.enabled;

        // Check if yield management is properly configured
        if (useYieldManagement && !hotel.yieldManagement?.basePricing?.[type]) {
          console.warn(`No base pricing configured for room type ${type}, using standard pricing`);
          useYieldManagement = false;
        }

        // Apply pricing based on yield management availability
        if (useYieldManagement) {
          try {
            // Get dynamic price from yield manager
            const yieldPricing = await yieldManager.calculateDynamicPrice({
              hotelId,
              roomType: type,
              checkInDate: checkIn,
              checkOutDate: checkOut,
              guestCount: numberOfGuests || totalRooms * 2,
              baseCurrency: currency,
              strategy: hotel.yieldManagement?.strategy || 'MODERATE',
            });

            // Apply pricing rules if any
            const pricingRulesResult = await applyPricingRules(hotelId, {
              roomType: type,
              checkInDate: checkIn,
              checkOutDate: checkOut,
              occupancy: availability.summary.occupancyRate,
              customerSegment: clientType === CLIENT_TYPES.CORPORATE ? 'CORPORATE' : 'INDIVIDUAL',
              basePrice: yieldPricing.basePrice,
            });

            // Final price per room
            finalPricePerRoom = yieldPricing.dynamicPrice * pricingRulesResult.finalMultiplier;
            const roomTotalPrice = finalPricePerRoom * nightsCount * quantity;

            totalPrice += roomTotalPrice;

            // Store yield pricing details for transparency
            yieldPricingDetails.push({
              roomType: type,
              quantity,
              basePrice: yieldPricing.basePrice,
              dynamicPrice: yieldPricing.dynamicPrice,
              finalPrice: finalPricePerRoom,
              factors: yieldPricing.factors,
              appliedRules: pricingRulesResult.appliedRules,
              totalForRoomType: roomTotalPrice,
              yieldManagementUsed: true,
            });
          } catch (yieldError) {
            console.warn('Yield pricing failed, using standard pricing:', yieldError.message);
            // Fallback to standard pricing
            const roomPrice = calculateBookingPrice({
              basePrice: availability.rooms[type].currentPrice,
              roomType: type,
              hotelCategory: hotel.category,
              checkInDate: checkIn,
              checkOutDate: checkOut,
              numberOfRooms: quantity,
            });

            finalPricePerRoom = roomPrice.pricePerRoom;
            const roomTotalPrice = finalPricePerRoom * quantity;
            totalPrice += roomTotalPrice;

            yieldPricingDetails.push({
              roomType: type,
              quantity,
              basePrice: availability.rooms[type].currentPrice,
              dynamicPrice: finalPricePerRoom,
              finalPrice: finalPricePerRoom,
              factors: { error: true },
              appliedRules: [],
              totalForRoomType: roomTotalPrice,
              error: 'Yield management failed - using standard pricing',
              yieldManagementUsed: false,
            });
          }
        } else {
          // Standard pricing when yield management is disabled or not configured
          const roomPrice = calculateBookingPrice({
            basePrice: availability.rooms[type].currentPrice,
            roomType: type,
            hotelCategory: hotel.category,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            numberOfRooms: quantity,
          });

          finalPricePerRoom = roomPrice.pricePerRoom;
          const roomTotalPrice = finalPricePerRoom * quantity;
          totalPrice += roomTotalPrice;

          yieldPricingDetails.push({
            roomType: type,
            quantity,
            basePrice: availability.rooms[type].currentPrice,
            dynamicPrice: finalPricePerRoom,
            finalPrice: finalPricePerRoom,
            factors: null,
            appliedRules: [],
            totalForRoomType: roomTotalPrice,
            yieldManagementUsed: false,
            reason: hotel.yieldManagement?.enabled
              ? 'No base pricing configured'
              : 'Yield management disabled',
          });
        }

        // Préparer les chambres pour la réservation
        for (let i = 0; i < quantity; i++) {
          roomsToBook.push({
            type,
            basePrice: yieldPricing.basePrice,
            calculatedPrice: finalPricePerRoom,
            yieldFactors: yieldPricing.factors,
            room: null, // Sera assigné lors du check-in
            assignedAt: null,
            assignedBy: null,
          });
        }
      }

      // ================================
      // CRÉATION RÉSERVATION AVEC REAL-TIME PROCESSING ET YIELD DATA
      // ================================

      const bookingData = {
        hotel: hotelId,
        customer: customerId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        numberOfNights: nightsCount,
        rooms: roomsToBook,
        numberOfGuests: numberOfGuests || totalRooms,
        totalPrice,
        status: BOOKING_STATUS.PENDING, // Nécessite validation admin
        source,
        clientType,
        specialRequests: specialRequests || '',
        corporateDetails: clientType === CLIENT_TYPES.CORPORATE ? corporateDetails : null,
        createdBy: req.user.id,
        paymentStatus: 'Pending',
        cancellationPolicy: await generateCancellationPolicy(hotel, checkIn),

        // NEW: Yield management data
        yieldManagement: {
          enabled: true,
          pricingDetails: yieldPricingDetails,
          strategy: hotel.yieldManagement?.strategy || 'MODERATE',
          demandLevel: yieldPricing.factors.demandFactor?.level || 'NORMAL',
          recommendations: yieldPricing.recommendations,
          calculatedAt: new Date(),
        },
      };

      // Use real-time booking service for instant processing (with fallback)
      let bookingResult = { booking: null };
      try {
        if (bookingRealtimeService.processBookingCreation) {
          bookingResult = await bookingRealtimeService.processBookingCreation({
            ...bookingData,
            userId: customerId,
            hotelId: hotelId,
          });
        }
      } catch (realtimeError) {
        console.warn('Real-time booking service failed:', realtimeError.message);
        // Continue with standard booking creation
      }

      let savedBooking;
      if (bookingResult.booking) {
        savedBooking = bookingResult.booking;
      } else {
        savedBooking = new Booking(bookingData);
        await savedBooking.save({ session });
      }

      // ================================
      // REAL-TIME NOTIFICATIONS & BROADCASTING WITH YIELD INFO
      // ================================

      // Broadcast new booking to all relevant parties
      const bookingEventData = {
        bookingId: savedBooking._id,
        customerName: `${req.user.firstName} ${req.user.lastName}`,
        hotelName: hotel.name,
        checkIn: checkIn,
        checkOut: checkOut,
        roomCount: totalRooms,
        totalAmount: totalPrice,
        status: BOOKING_STATUS.PENDING,
        source,
        timestamp: new Date(),
        // NEW: Yield pricing info
        dynamicPricing: {
          applied: true,
          averageDiscount: calculateAverageDiscount(yieldPricingDetails),
          demandLevel: yieldPricing.factors.demandFactor?.level || 'NORMAL',
        },
      };

      // Notify customer
      socketService.sendUserNotification(customerId, 'BOOKING_CREATED', {
        ...bookingEventData,
        message: 'Votre réservation a été créée avec succès!',
        nextStep: "En attente de validation par l'administration",
        pricingTransparency: {
          baseTotal: yieldPricingDetails.reduce(
            (sum, d) => sum + d.basePrice * d.quantity * nightsCount,
            0
          ),
          dynamicTotal: totalPrice,
          savings: calculateSavings(yieldPricingDetails, nightsCount),
        },
      });

      // Notify hotel staff with yield insights
      socketService.sendHotelNotification(hotelId, 'NEW_BOOKING', {
        ...bookingEventData,
        requiresValidation: true,
        urgency: checkIn <= new Date(Date.now() + 24 * 60 * 60 * 1000) ? 'HIGH' : 'NORMAL',
        yieldAnalysis: {
          revenueImpact: totalPrice,
          occupancyContribution: (totalRooms / hotel.stats?.totalRooms || 50) * 100,
          recommendedAction: yieldPricing.recommendations[0]?.action || 'VALIDATE',
        },
      });

      // Notify admins
      socketService.sendAdminNotification('NEW_BOOKING_PENDING', {
        ...bookingEventData,
        awaitingValidation: true,
        createdBy: req.user.role,
        yieldManagementApplied: true,
      });

      // Update real-time availability
      await availabilityRealtimeService.updateAvailabilityAfterBooking(
        hotelId,
        {
          checkInDate: checkIn,
          checkOutDate: checkOut,
          rooms: roomsToBook,
        },
        'BOOK'
      );

      // Broadcast availability change to all users
      socketService.broadcastAvailabilityUpdate(hotelId, {
        action: 'ROOMS_BOOKED',
        roomsBooked: totalRooms,
        checkIn: checkIn,
        checkOut: checkOut,
        remainingAvailability: await availabilityRealtimeService.getRealTimeAvailability(
          hotelId,
          checkIn,
          checkOut
        ),
      });

      // ================================
      // SCHEDULE NOTIFICATIONS
      // ================================

      // Schedule reminder notifications
      await scheduleBookingNotifications(savedBooking._id);

      // Send comprehensive notifications
      await sendComprehensiveNotifications(savedBooking, 'CREATED', {
        source,
        roomTypes: [...new Set(roomsToBook.map((r) => r.type))],
        nightsCount,
        yieldPricing: true,
      });

      // ================================
      // ANALYZE BOOKING FOR FUTURE YIELD OPTIMIZATION
      // ================================

      await demandAnalyzer.analyzeDemand(hotelId, checkIn, checkOut, {
        newBooking: true,
        leadTime: Math.ceil((checkIn - new Date()) / (1000 * 60 * 60 * 24)),
        bookingValue: totalPrice,
        roomTypes: roomsToBook.map((r) => r.type),
      });

      // Invalidation cache
      invalidateHotelCache(hotelId);

      // Populer données pour réponse
      const populatedBooking = await Booking.findById(savedBooking._id)
        .populate('hotel', 'name code category')
        .populate('customer', 'firstName lastName email')
        .populate('createdBy', 'firstName lastName role')
        .session(session);

      res.status(201).json({
        success: true,
        message: 'Réservation créée avec succès',
        data: {
          booking: populatedBooking,
          pricing: {
            totalPrice,
            breakdown: `${totalRooms} chambre(s) × ${nightsCount} nuit(s)`,
            currency: currency || 'MAD',
            yieldManagement: {
              applied: true,
              strategy: hotel.yieldManagement?.strategy || 'MODERATE',
              demandLevel: yieldPricing.factors.demandFactor?.level || 'NORMAL',
              priceOptimization: {
                baseTotal: yieldPricingDetails.reduce(
                  (sum, d) => sum + d.basePrice * d.quantity * nightsCount,
                  0
                ),
                optimizedTotal: totalPrice,
                optimization: `${Math.round((totalPrice / yieldPricingDetails.reduce((sum, d) => sum + d.basePrice * d.quantity * nightsCount, 0) - 1) * 100)}%`,
              },
            },
          },
          nextSteps: {
            awaitingValidation: true,
            estimatedValidationTime: '24h',
            cancelBeforeValidation: `/api/bookings/${savedBooking._id}/cancel`,
            trackStatus: `/api/bookings/${savedBooking._id}`,
          },
          realTimeTracking: {
            enabled: true,
            bookingRoom: `booking-${savedBooking._id}`,
            hotelRoom: `hotel-${hotelId}`,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur création réservation:', error);

    // Notify error in real-time
    if (req.user && req.user.id) {
      try {
        socketService.sendUserNotification(req.user.id, 'BOOKING_CREATION_ERROR', {
          message: 'Erreur lors de la création de votre réservation',
          error: error.message,
          timestamp: new Date(),
        });
      } catch (notificationError) {
        console.error('Failed to send error notification:', notificationError);
      }
    }

    if (error.message.includes('disponibles') || error.message.includes('invalide')) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * CRUD OPERATIONS - LECTURE WITH YIELD DATA
 * ================================
 */

/**
 * @desc    Obtenir les réservations selon le rôle utilisateur avec données yield
 * @route   GET /api/bookings
 * @access  Client (ses réservations) + Receptionist (hôtel assigné) + Admin (toutes)
 */
const getBookings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      hotelId,
      checkInDate,
      checkOutDate,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      source,
      clientType,
      realTime = false, // New parameter for real-time updates
      includeYieldData = true, // Include yield management data
    } = req.query;

    // ================================
    // CONSTRUCTION REQUÊTE SELON RÔLE
    // ================================

    const query = {};

    if (req.user.role === USER_ROLES.CLIENT) {
      // Client : uniquement ses réservations
      query.customer = req.user.id;
    } else if (req.user.role === USER_ROLES.RECEPTIONIST) {
      // Receptionist : réservations de son hôtel (TODO: ajouter hotel assignment)
      if (hotelId && mongoose.Types.ObjectId.isValid(hotelId)) {
        query.hotel = hotelId;
      } else {
        return res.status(400).json({
          success: false,
          message: 'ID hôtel requis pour réceptionniste',
        });
      }
    }
    // Admin : toutes les réservations (pas de filtre)

    // ================================
    // FILTRES ADDITIONNELS
    // ================================

    if (status && Object.values(BOOKING_STATUS).includes(status)) {
      query.status = status;
    }

    if (hotelId && req.user.role === USER_ROLES.ADMIN) {
      query.hotel = hotelId;
    }

    if (checkInDate || checkOutDate) {
      query.checkInDate = {};
      if (checkInDate) query.checkInDate.$gte = new Date(checkInDate);
      if (checkOutDate) query.checkInDate.$lte = new Date(checkOutDate);
    }

    if (source && Object.values(BOOKING_SOURCES).includes(source)) {
      query.source = source;
    }

    if (clientType && Object.values(CLIENT_TYPES).includes(clientType)) {
      query.clientType = clientType;
    }

    // ================================
    // PAGINATION ET TRI
    // ================================

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const [bookings, totalCount] = await Promise.all([
      Booking.find(query)
        .populate('hotel', 'name code city category yieldManagement')
        .populate('customer', 'firstName lastName email phone')
        .populate('createdBy', 'firstName lastName role')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('-__v'),
      Booking.countDocuments(query),
    ]);

    // ================================
    // REAL-TIME SUBSCRIPTION (if requested)
    // ================================

    if (realTime === 'true') {
      // Subscribe user to real-time updates for these bookings
      bookings.forEach((booking) => {
        socketService.sendUserNotification(req.user.id, 'SUBSCRIBE_BOOKING', {
          bookingId: booking._id,
          action: 'subscribe',
        });
      });
    }

    // ================================
    // STATISTIQUES RÉSUMÉ WITH YIELD DATA
    // ================================

    const statusStats = await Booking.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
          avgYieldMultiplier: { $avg: '$yieldManagement.averageMultiplier' },
        },
      },
    ]);

    // Calculate RevPAR if admin or receptionist
    let revPARData = null;
    if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role) && hotelId) {
      const startDate = checkInDate
        ? new Date(checkInDate)
        : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const endDate = checkOutDate ? new Date(checkOutDate) : new Date();
      revPARData = await calculateRevPAR(hotelId, startDate, endDate);
    }

    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const totalRevenue = statusStats.reduce((sum, stat) => sum + (stat.totalRevenue || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        bookings: includeYieldData
          ? bookings
          : bookings.map((b) => {
              const booking = b.toObject();
              delete booking.yieldManagement;
              return booking;
            }),
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1,
        },
        statistics: {
          totalBookings: totalCount,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          statusBreakdown: statusStats,
          filters: { status, hotelId, checkInDate, checkOutDate, source, clientType },
          // NEW: Yield management statistics
          yieldManagement: includeYieldData
            ? {
                averageYieldMultiplier: calculateAverageYieldMultiplier(statusStats),
                revPAR: revPARData,
                demandLevel: await getCurrentDemandLevel(hotelId || query.hotel),
              }
            : null,
        },
        userContext: {
          role: req.user.role,
          canValidate: req.user.role === USER_ROLES.ADMIN,
          canCheckIn: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role),
          canViewYieldData: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role),
        },
        realTimeEnabled: realTime === 'true',
      },
    });
  } catch (error) {
    console.error('Erreur récupération réservations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * @desc    Obtenir une réservation par ID avec analyse yield
 * @route   GET /api/bookings/:id
 * @access  Client (sa réservation) + Staff (selon permissions)
 */
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      includeRooms = false,
      includePricing = false,
      includeHistory = false,
      realTime = false,
      includeYieldAnalysis = true, // NEW: Include yield analysis
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    // ================================
    // RÉCUPÉRATION AVEC VÉRIFICATION PERMISSIONS
    // ================================

    const query = { _id: id };

    // Client : seulement ses réservations
    if (req.user.role === USER_ROLES.CLIENT) {
      query.customer = req.user.id;
    }

    const booking = await Booking.findOne(query)
      .populate('hotel', 'name code address city category yieldManagement')
      .populate('customer', 'firstName lastName email phone clientType')
      .populate('createdBy updatedBy', 'firstName lastName role')
      .populate('rooms.room', 'number type floor status');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée ou accès non autorisé',
      });
    }

    // ================================
    // REAL-TIME SUBSCRIPTION
    // ================================

    if (realTime === 'true') {
      // Subscribe to real-time updates for this booking
      socketService.sendUserNotification(req.user.id, 'SUBSCRIBE_BOOKING', {
        bookingId: booking._id,
        action: 'subscribe',
        currentStatus: booking.status,
      });

      // Join booking room for updates
      socketService.sendUserNotification(req.user.id, 'JOIN_BOOKING_ROOM', {
        bookingId: booking._id,
        room: `booking-${booking._id}`,
      });
    }

    const responseData = { booking };

    // ================================
    // DONNÉES ADDITIONNELLES SELON PERMISSIONS
    // ================================

    // Inclure détails chambres si demandé (Staff uniquement)
    if (includeRooms === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      const assignedRooms = booking.rooms.filter((r) => r.room).map((r) => r.room);

      responseData.roomDetails = assignedRooms;
    }

    // Inclure recalcul pricing avec yield (Staff uniquement)
    if (includePricing === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      try {
        // Recalcul avec yield management actuel
        const currentYieldPricing = await yieldManager.calculateDynamicPrice({
          hotelId: booking.hotel._id,
          roomType: booking.rooms[0].type,
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          strategy: booking.hotel.yieldManagement?.strategy || 'MODERATE',
        });

        responseData.pricingAnalysis = {
          originalPrice: booking.totalPrice,
          currentPrice: currentYieldPricing.totalPrice,
          priceDifference: currentYieldPricing.totalPrice - booking.totalPrice,
          priceChanged: Math.abs(currentYieldPricing.totalPrice - booking.totalPrice) > 1,
          breakdown: currentYieldPricing.breakdown,
          yieldFactors: currentYieldPricing.factors,
          recommendations: currentYieldPricing.recommendations,
        };
      } catch (error) {
        responseData.pricingAnalysis = {
          error: 'Impossible de recalculer le prix',
        };
      }
    }

    // Inclure historique modifications (Staff uniquement)
    if (includeHistory === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      responseData.modificationHistory = booking.statusHistory || [];
    }

    // ================================
    // YIELD ANALYSIS (Staff uniquement)
    // ================================

    if (
      includeYieldAnalysis === 'true' &&
      [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role)
    ) {
      try {
        // Analyse de la demande pour cette période
        const demandAnalysis = await demandAnalyzer.analyzeDemand(
          booking.hotel._id,
          booking.checkInDate,
          booking.checkOutDate
        );

        // Suggestions d'optimisation des revenus
        const revenueOptimization = await suggestRevenueOptimization(
          booking.hotel._id,
          booking.rooms[0].type,
          {
            start: booking.checkInDate,
            end: booking.checkOutDate,
          }
        );

        responseData.yieldAnalysis = {
          bookingYieldData: booking.yieldManagement,
          currentDemand: demandAnalysis,
          revenueOptimization,
          performanceMetrics: {
            bookingLeadTime: Math.ceil(
              (booking.checkInDate - booking.createdAt) / (1000 * 60 * 60 * 24)
            ),
            priceElasticity: calculatePriceElasticity(booking),
            contributionToRevPAR: calculateBookingRevPARContribution(booking),
          },
        };
      } catch (error) {
        console.error('Error generating yield analysis:', error);
        responseData.yieldAnalysis = { error: 'Analyse yield non disponible' };
      }
    }

    // ================================
    // ACTIONS DISPONIBLES SELON STATUT ET RÔLE
    // ================================

    const availableActions = getAvailableActions(booking, req.user.role);
    responseData.availableActions = availableActions;

    // ================================
    // REAL-TIME AVAILABILITY INFO WITH YIELD
    // ================================

    if (booking.hotel._id && booking.checkInDate && booking.checkOutDate) {
      try {
        const currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
          booking.hotel._id,
          booking.checkInDate,
          booking.checkOutDate
        );

        responseData.currentAvailability = {
          occupancyRate: currentAvailability.summary.occupancyRate,
          availableRooms: currentAvailability.summary.totalAvailableRooms,
          demandLevel: currentAvailability.summary.demandLevel,
          pricingTrend: determinePricingTrend(currentAvailability.summary.occupancyRate),
        };
      } catch (error) {
        console.error('Error fetching availability:', error);
      }
    }

    res.status(200).json({
      success: true,
      data: responseData,
      realTimeEnabled: realTime === 'true',
    });
  } catch (error) {
    console.error('Erreur récupération réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * ================================
 * WORKFLOW MANAGEMENT - VALIDATION ADMIN WITH YIELD INSIGHTS
 * ================================
 */

/**
 * @desc    Valider ou rejeter une réservation avec analyse yield
 * @route   PUT /api/bookings/:id/validate
 * @access  Admin uniquement
 */
const validateBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { action, reason, modifications, considerYield = true } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action invalide. Utilisez "approve" ou "reject"',
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name yieldManagement')
        .populate('customer', 'firstName lastName email')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      if (booking.status !== BOOKING_STATUS.PENDING) {
        throw new Error(`Impossible de valider une réservation avec statut: ${booking.status}`);
      }

      // ================================
      // YIELD MANAGEMENT ANALYSIS FOR VALIDATION
      // ================================

      let yieldRecommendation = null;
      if (considerYield && booking.hotel.yieldManagement?.enabled) {
        try {
          // Analyser l'impact sur les revenus
          const demandAnalysis = await demandAnalyzer.analyzeDemand(
            booking.hotel._id,
            booking.checkInDate,
            booking.checkOutDate
          );

          // Obtenir une recommandation basée sur le yield
          yieldRecommendation = getYieldValidationRecommendation(
            booking,
            demandAnalysis,
            booking.hotel.yieldManagement.strategy
          );

          // Ajouter la recommandation yield aux données de la réservation
          booking.yieldManagement.validationRecommendation = yieldRecommendation;
        } catch (error) {
          console.error('Error getting yield recommendation:', error);
        }
      }

      // ================================
      // REAL-TIME VALIDATION PROCESS
      // ================================

      const validationResult = await bookingRealtimeService.handleInstantAdminAction(
        booking._id,
        action,
        req.user.id,
        reason
      );

      // Update booking status based on action
      if (action === 'approve') {
        // Re-check availability in real-time with proper error handling
        let currentAvailability = null;
        try {
          if (booking.hotel._id && booking.checkInDate && booking.checkOutDate) {
            currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
              booking.hotel._id,
              booking.checkInDate,
              booking.checkOutDate
            );
          }
        } catch (availabilityError) {
          console.warn('Availability service unavailable:', availabilityError.message);
          // Continue without blocking validation - we'll skip availability check
          currentAvailability = null;
        }

        // Check if still available (only if we successfully got availability data)
        if (currentAvailability && currentAvailability.rooms) {
          for (const roomBooking of booking.rooms) {
            if (
              !currentAvailability.rooms[roomBooking.type] ||
              currentAvailability.rooms[roomBooking.type].availableRooms < 1
            ) {
              throw new Error(`Plus de chambres ${roomBooking.type} disponibles`);
            }
          }
        } else if (currentAvailability === null) {
          // If availability check failed, log warning but don't block validation
          console.warn('Skipping availability re-check due to service unavailability');
        }

        // Apply modifications if requested (including yield-based adjustments)
        if (modifications || yieldRecommendation?.suggestedPriceAdjustment) {
          const newPrice =
            modifications?.newPrice ||
            booking.totalPrice * (1 + (yieldRecommendation?.suggestedPriceAdjustment || 0) / 100);

          if (newPrice && newPrice !== booking.totalPrice) {
            const priceValidation = validatePrice(newPrice);
            if (!priceValidation.valid) {
              throw new Error(`Prix modifié invalide: ${priceValidation.error}`);
            }
            booking.totalPrice = newPrice;
            booking.priceModified = true;
            booking.priceModificationReason =
              modifications?.priceReason ||
              `Ajustement yield: ${yieldRecommendation?.reason || 'Optimisation des revenus'}`;
          }
        }

        booking.status = BOOKING_STATUS.CONFIRMED;
        booking.confirmedAt = new Date();
        booking.confirmedBy = req.user.id;

        // Update yield management data
        if (yieldRecommendation) {
          booking.yieldManagement.validationDecision = {
            followed: yieldRecommendation.recommendation === 'APPROVE',
            reason: reason || 'Validation manuelle admin',
            timestamp: new Date(),
          };
        }
      } else {
        booking.status = BOOKING_STATUS.REJECTED;
        booking.rejectedAt = new Date();
        booking.rejectedBy = req.user.id;
        booking.rejectionReason = reason || 'Rejeté par admin';
      }

      // Add to history
      booking.statusHistory = [
        ...(booking.statusHistory || []),
        {
          previousStatus: BOOKING_STATUS.PENDING,
          newStatus: booking.status,
          reason: reason || `${action === 'approve' ? 'Approuvé' : 'Rejeté'} par admin`,
          changedBy: req.user.id,
          changedAt: new Date(),
          yieldRecommendation: yieldRecommendation?.recommendation,
        },
      ];

      booking.updatedBy = req.user.id;
      booking.updatedAt = new Date();

      await booking.save({ session });

      // ================================
      // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD DATA
      // ================================

      const notificationData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        action,
        status: booking.status,
        adminId: req.user.id,
        timestamp: new Date(),
        modifications: modifications || null,
        yieldAnalysis: yieldRecommendation,
      };

      if (action === 'approve') {
        // Notify customer of approval
        socketService.sendUserNotification(booking.customer._id, 'BOOKING_APPROVED', {
          ...notificationData,
          message: 'Votre réservation a été confirmée!',
          checkIn: booking.checkInDate,
          checkOut: booking.checkOutDate,
          totalAmount: booking.totalPrice,
          priceModified: booking.priceModified || false,
        });

        // Notify hotel staff with yield insights
        socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_CONFIRMED_ADMIN', {
          ...notificationData,
          roomTypes: [...new Set(booking.rooms.map((r) => r.type))],
          roomCount: booking.rooms.length,
          preparation: "Préparer pour l'arrivée du client",
          yieldImpact: {
            revenueContribution: booking.totalPrice,
            demandLevel: yieldRecommendation?.demandLevel || 'NORMAL',
            optimizationApplied: booking.priceModified,
          },
        });

        // Update availability in real-time
        await availabilityRealtimeService.updateAvailabilityAfterBooking(
          booking.hotel._id,
          {
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            rooms: booking.rooms,
          },
          'CONFIRM'
        );

        // Send comprehensive notifications
        await sendComprehensiveNotifications(booking, 'CONFIRMED', {
          adminComment: reason,
          priceModified: booking.priceModified,
          yieldOptimized: !!yieldRecommendation,
        });
      } else {
        // Notify customer of rejection
        socketService.sendUserNotification(booking.customer._id, 'BOOKING_REJECTED', {
          ...notificationData,
          message: 'Votre réservation a été refusée',
          reason: booking.rejectionReason,
          suggestion: "Vous pouvez essayer d'autres dates ou hôtels",
        });

        // Release availability
        await availabilityRealtimeService.updateAvailabilityAfterBooking(
          booking.hotel._id,
          {
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            rooms: booking.rooms,
          },
          'RELEASE'
        );
      }

      // Broadcast to admin dashboard with yield insights
      socketService.sendAdminNotification('BOOKING_VALIDATED', {
        ...notificationData,
        validationTime: new Date() - booking.createdAt,
        impact: action === 'approve' ? 'Revenue confirmed' : 'Availability released',
        yieldAnalysis: {
          followedRecommendation: yieldRecommendation?.recommendation === action.toUpperCase(),
          potentialRevenueLoss: action === 'reject' ? booking.totalPrice : 0,
          demandImpact: yieldRecommendation?.demandLevel,
        },
      });

      // Invalidate cache
      invalidateHotelCache(booking.hotel._id);

      // Schedule follow-up notifications
      if (action === 'approve') {
        await scheduleValidationNotification(booking._id, action);
      }

      res.status(200).json({
        success: true,
        message: `Réservation ${action === 'approve' ? 'approuvée' : 'rejetée'} avec succès`,
        data: {
          booking: {
            id: booking._id,
            status: booking.status,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            hotel: booking.hotel.name,
            checkInDate: booking.checkInDate,
            totalPrice: booking.totalPrice,
          },
          action,
          reason,
          validatedBy: req.user.id,
          validatedAt: new Date(),
          yieldAnalysis: yieldRecommendation,
          realTimeNotifications: {
            customerNotified: true,
            hotelNotified: true,
            availabilityUpdated: true,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur validation réservation:', error);

    // Notify admin of validation error
    socketService.sendAdminNotification('VALIDATION_ERROR', {
      bookingId: id,
      error: error.message,
      adminId: req.user.id,
      timestamp: new Date(),
    });

    if (
      error.message.includes('non trouvée') ||
      error.message.includes('Impossible') ||
      error.message.includes('disponibles')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la validation',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * WORKFLOW MANAGEMENT - CHECK-IN/CHECK-OUT WITH YIELD TRACKING
 * ================================
 */

/**
 * @desc    Effectuer le check-in d'une réservation avec tracking yield
 * @route   PUT /api/bookings/:id/checkin
 * @access  Admin + Receptionist
 */
const checkInBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const {
      actualCheckInTime,
      roomAssignments, // [{ bookingRoomIndex, roomId }]
      guestNotes,
      specialServices,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name yieldManagement')
        .populate('customer', 'firstName lastName email')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      if (booking.status !== BOOKING_STATUS.CONFIRMED) {
        throw new Error(`Check-in impossible. Statut actuel: ${booking.status}`);
      }

      // Check date validity
      const today = new Date();
      const checkInDate = new Date(booking.checkInDate);

      if (today < checkInDate) {
        // Allow early check-in with note
        booking.earlyCheckIn = true;
        booking.earlyCheckInReason = 'Check-in anticipé autorisé par réception';
      }

      // ================================
      // REAL-TIME CHECK-IN PROCESS
      // ================================

      const checkInResult = await bookingRealtimeService.processCheckInRealtime(
        booking._id,
        req.user.id,
        roomAssignments ? roomAssignments.map((a) => a.roomId) : [],
        {
          guestIds: req.body.guestIds,
          specialServices,
        }
      );

      // ================================
      // ROOM ASSIGNMENT
      // ================================

      const assignedRoomNumbers = [];

      if (roomAssignments && roomAssignments.length > 0) {
        // Manual room assignment
        for (const assignment of roomAssignments) {
          const { bookingRoomIndex, roomId } = assignment;

          if (bookingRoomIndex >= booking.rooms.length) {
            throw new Error(`Index chambre invalide: ${bookingRoomIndex}`);
          }

          // Verify room availability
          const room = await Room.findById(roomId).session(session);
          if (!room || room.status !== ROOM_STATUS.AVAILABLE) {
            throw new Error(`Chambre ${room?.number || roomId} non disponible`);
          }

          // Assign room
          booking.rooms[bookingRoomIndex].room = roomId;
          booking.rooms[bookingRoomIndex].assignedAt = new Date();
          booking.rooms[bookingRoomIndex].assignedBy = req.user.id;

          assignedRoomNumbers.push(room.number);

          // Mark room as occupied
          await Room.findByIdAndUpdate(
            roomId,
            {
              status: ROOM_STATUS.OCCUPIED,
              currentBooking: booking._id,
              updatedBy: req.user.id,
              updatedAt: new Date(),
            },
            { session }
          );

          // Real-time room status update
          socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
            roomId,
            roomNumber: room.number,
            newStatus: ROOM_STATUS.OCCUPIED,
            bookingId: booking._id,
            guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
          });
        }
      }

      // ================================
      // UPDATE BOOKING STATUS WITH YIELD TRACKING
      // ================================

      booking.status = BOOKING_STATUS.CHECKED_IN;
      booking.actualCheckInDate = actualCheckInTime ? new Date(actualCheckInTime) : new Date();
      booking.checkedInBy = req.user.id;
      booking.guestNotes = guestNotes || '';
      booking.specialServices = specialServices || [];

      // Track yield management performance
      if (booking.yieldManagement?.enabled) {
        booking.yieldManagement.checkInData = {
          actualCheckInDate: booking.actualCheckInDate,
          leadTime: Math.ceil((booking.checkInDate - booking.createdAt) / (1000 * 60 * 60 * 24)),
          earlyCheckIn: booking.earlyCheckIn || false,
          finalPrice: booking.totalPrice,
          yieldPerformance: calculateYieldPerformance(booking),
        };
      }

      // Update history
      booking.statusHistory = [
        ...(booking.statusHistory || []),
        {
          previousStatus: BOOKING_STATUS.CONFIRMED,
          newStatus: BOOKING_STATUS.CHECKED_IN,
          reason: 'Check-in effectué',
          changedBy: req.user.id,
          changedAt: new Date(),
        },
      ];

      booking.updatedBy = req.user.id;
      booking.updatedAt = new Date();

      await booking.save({ session });

      // ================================
      // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD DATA
      // ================================

      const checkInData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        roomNumbers: assignedRoomNumbers,
        checkInTime: booking.actualCheckInDate,
        checkedInBy: req.user.id,
        earlyCheckIn: booking.earlyCheckIn || false,
        specialServices: specialServices || [],
        yieldData: {
          originalPrice:
            booking.yieldManagement?.pricingDetails?.[0]?.basePrice || booking.totalPrice,
          finalPrice: booking.totalPrice,
          yieldPerformance: booking.yieldManagement?.checkInData?.yieldPerformance,
        },
      };

      // Notify customer
      socketService.sendUserNotification(booking.customer._id, 'CHECK_IN_COMPLETED', {
        ...checkInData,
        message: 'Check-in effectué avec succès!',
        roomInfo:
          assignedRoomNumbers.length > 0
            ? `Chambre(s): ${assignedRoomNumbers.join(', ')}`
            : "Chambres en cours d'attribution",
        hotelServices: {
          wifi: 'Gratuit',
          roomService: '24/7',
          concierge: 'Disponible',
        },
      });

      // Notify hotel staff with yield insights
      socketService.sendHotelNotification(booking.hotel._id, 'GUEST_CHECKED_IN', {
        ...checkInData,
        guestPreferences: booking.specialRequests,
        stayDuration: Math.ceil(
          (new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24)
        ),
        roomsOccupied: booking.rooms.length,
        yieldInsights: {
          bookingValue: booking.totalPrice,
          demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
          revenueContribution: calculateRevenueContribution(booking),
        },
      });

      // Notify housekeeping
      if (assignedRoomNumbers.length > 0) {
        socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
          action: 'ROOMS_OCCUPIED',
          rooms: assignedRoomNumbers,
          guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
          specialRequests: booking.specialRequests,
        });
      }

      // Update real-time occupancy
      const occupancyUpdate = await availabilityRealtimeService.getRealTimeOccupancy(
        booking.hotel._id
      );
      socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
        action: 'OCCUPANCY_CHANGED',
        occupancyRate: occupancyUpdate.occupancyRate,
        roomsOccupied: occupancyUpdate.occupiedRooms,
        timestamp: new Date(),
      });

      // Send comprehensive notifications
      await sendComprehensiveNotifications(booking, 'CHECKED_IN', {
        roomNumbers: assignedRoomNumbers,
        roomNumber: assignedRoomNumbers[0],
        yieldTracking: true,
      });

      // Invalidate cache
      invalidateHotelCache(booking.hotel._id);

      res.status(200).json({
        success: true,
        message: 'Check-in effectué avec succès',
        data: {
          booking: {
            id: booking._id,
            status: booking.status,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            actualCheckInDate: booking.actualCheckInDate,
            assignedRooms: booking.rooms
              .filter((r) => r.room)
              .map((r) => ({ roomId: r.room, assignedAt: r.assignedAt })),
          },
          roomNumbers: assignedRoomNumbers,
          yieldPerformance: booking.yieldManagement?.checkInData?.yieldPerformance,
          nextSteps: {
            addExtras: `/api/bookings/${booking._id}/extras`,
            checkOut: `/api/bookings/${booking._id}/checkout`,
            viewInvoice: `/api/bookings/${booking._id}/invoice`,
          },
          realTimeTracking: {
            guestInHouse: true,
            roomsOccupied: assignedRoomNumbers,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur check-in:', error);

    // Notify error
    socketService.sendHotelNotification(req.body.hotelId || '', 'CHECK_IN_ERROR', {
      bookingId: id,
      error: error.message,
      receptionistId: req.user.id,
      timestamp: new Date(),
    });

    if (
      error.message.includes('non trouvée') ||
      error.message.includes('impossible') ||
      error.message.includes('disponible')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du check-in',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * @desc    Effectuer le check-out d'une réservation avec analyse yield finale
 * @route   PUT /api/bookings/:id/checkout
 * @access  Admin + Receptionist
 */
const checkOutBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const {
      actualCheckOutTime,
      roomCondition, // [{ roomId, condition, notes }]
      finalExtras, // Last-minute extras
      paymentStatus = 'Paid',
      generateInvoice = true,
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name code yieldManagement')
        .populate('customer', 'firstName lastName email')
        .populate('rooms.room', 'number type')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      if (booking.status !== BOOKING_STATUS.CHECKED_IN) {
        throw new Error(`Check-out impossible. Statut actuel: ${booking.status}`);
      }

      // ================================
      // REAL-TIME CHECK-OUT PROCESS
      // ================================

      const checkOutResult = await bookingRealtimeService.processCheckOutRealtime(
        booking._id,
        req.user.id,
        {
          extras: finalExtras,
          paymentMethod: req.body.paymentMethod,
        }
      );

      // ================================
      // ADD FINAL EXTRAS
      // ================================

      let finalExtrasTotal = 0;
      if (finalExtras && finalExtras.length > 0) {
        const extrasTotal = finalExtras.reduce(
          (sum, extra) => sum + extra.price * extra.quantity,
          0
        );

        booking.extras = [
          ...(booking.extras || []),
          ...finalExtras.map((extra) => ({
            ...extra,
            addedAt: new Date(),
            addedBy: req.user.id,
          })),
        ];

        booking.totalPrice += extrasTotal;
        booking.extrasTotal = (booking.extrasTotal || 0) + extrasTotal;
        finalExtrasTotal = extrasTotal;

        // Notify extras added
        socketService.sendUserNotification(booking.customer._id, 'FINAL_EXTRAS_ADDED', {
          bookingId: booking._id,
          extras: finalExtras,
          totalAmount: extrasTotal,
          newTotal: booking.totalPrice,
        });
      }

      // ================================
      // FINAL YIELD PERFORMANCE ANALYSIS
      // ================================

      if (booking.yieldManagement?.enabled) {
        const actualStayDuration = Math.ceil(
          (new Date() - booking.actualCheckInDate) / (1000 * 60 * 60 * 24)
        );

        booking.yieldManagement.checkOutData = {
          actualCheckOutDate: actualCheckOutTime ? new Date(actualCheckOutTime) : new Date(),
          actualStayDuration,
          finalRevenue: booking.totalPrice,
          extrasRevenue: booking.extrasTotal || 0,
          yieldPerformanceScore: calculateFinalYieldScore(booking),
          recommendations: generatePostStayRecommendations(booking),
        };

        // Update room revenue tracking
        for (const roomBooking of booking.rooms) {
          if (roomBooking.room) {
            await Room.findByIdAndUpdate(
              roomBooking.room._id,
              {
                $push: {
                  'revenueTracking.daily': {
                    date: new Date(),
                    revenue: roomBooking.calculatedPrice,
                    bookings: 1,
                    averageRate: roomBooking.calculatedPrice,
                    occupancy: true,
                  },
                },
              },
              { session }
            );
          }
        }
      }

      // ================================
      // RELEASE ROOMS
      // ================================

      const roomsToRelease = booking.rooms.filter((r) => r.room);
      const releasedRoomNumbers = [];

      for (const roomBooking of roomsToRelease) {
        const room = roomBooking.room;

        // Check room condition if provided
        const condition = roomCondition?.find((rc) => rc.roomId.toString() === room._id.toString());

        let newStatus = ROOM_STATUS.AVAILABLE;
        if (condition && condition.condition === 'maintenance_required') {
          newStatus = ROOM_STATUS.MAINTENANCE;
        }

        await Room.findByIdAndUpdate(
          room._id,
          {
            status: newStatus,
            currentBooking: null,
            lastCheckOut: new Date(),
            updatedBy: req.user.id,
            updatedAt: new Date(),
            ...(condition?.notes && {
              maintenanceNotes: condition.notes,
            }),
          },
          { session }
        );

        releasedRoomNumbers.push({
          number: room.number,
          type: room.type,
          newStatus,
          needsMaintenance: newStatus === ROOM_STATUS.MAINTENANCE,
        });

        // Real-time room status update
        socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
          roomId: room._id,
          roomNumber: room.number,
          previousStatus: ROOM_STATUS.OCCUPIED,
          newStatus,
          requiresCleaning: true,
          maintenanceRequired: newStatus === ROOM_STATUS.MAINTENANCE,
        });
      }

      // ================================
      // UPDATE BOOKING STATUS
      // ================================

      booking.status = BOOKING_STATUS.COMPLETED;
      booking.actualCheckOutDate = actualCheckOutTime ? new Date(actualCheckOutTime) : new Date();
      booking.checkedOutBy = req.user.id;
      booking.paymentStatus = paymentStatus;

      // Calculate actual stay duration
      const actualStayDuration = Math.ceil(
        (booking.actualCheckOutDate - booking.actualCheckInDate) / (1000 * 60 * 60 * 24)
      );
      booking.actualStayDuration = actualStayDuration;

      // Update history
      booking.statusHistory = [
        ...(booking.statusHistory || []),
        {
          previousStatus: BOOKING_STATUS.CHECKED_IN,
          newStatus: BOOKING_STATUS.COMPLETED,
          reason: 'Check-out effectué',
          changedBy: req.user.id,
          changedAt: new Date(),
        },
      ];

      booking.updatedBy = req.user.id;
      booking.updatedAt = new Date();

      await booking.save({ session });

      // ================================
      // GENERATE INVOICE WITH YIELD DATA
      // ================================

      let invoiceData = null;
      if (generateInvoice) {
        invoiceData = await generateInvoiceWithYieldData(booking);

        // Notify invoice ready
        socketService.sendUserNotification(booking.customer._id, 'INVOICE_READY', {
          bookingId: booking._id,
          invoiceNumber: invoiceData.invoiceNumber,
          totalAmount: invoiceData.totals.total,
          downloadUrl: `/api/bookings/${booking._id}/invoice`,
        });
      }

      // ================================
      // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD INSIGHTS
      // ================================

      const checkOutData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        checkOutTime: booking.actualCheckOutDate,
        finalAmount: booking.totalPrice,
        stayDuration: actualStayDuration,
        roomsReleased: releasedRoomNumbers.length,
        invoiceGenerated: !!invoiceData,
        yieldPerformance: booking.yieldManagement?.checkOutData,
      };

      // Notify customer
      socketService.sendUserNotification(booking.customer._id, 'CHECK_OUT_COMPLETED', {
        ...checkOutData,
        message: 'Check-out effectué avec succès. Merci de votre visite!',
        invoice: invoiceData
          ? {
              number: invoiceData.invoiceNumber,
              amount: invoiceData.totals.total,
              downloadUrl: `/api/bookings/${booking._id}/invoice`,
            }
          : null,
        feedback: 'Nous espérons vous revoir bientôt!',
      });

      // Notify hotel staff with yield performance
      socketService.sendHotelNotification(booking.hotel._id, 'GUEST_CHECKED_OUT', {
        ...checkOutData,
        roomsToClean: releasedRoomNumbers
          .filter((r) => r.newStatus === ROOM_STATUS.AVAILABLE)
          .map((r) => r.number),
        roomsNeedingMaintenance: releasedRoomNumbers
          .filter((r) => r.needsMaintenance)
          .map((r) => r.number),
        revenue: booking.totalPrice,
        yieldInsights: {
          performanceScore: booking.yieldManagement?.checkOutData?.yieldPerformanceScore,
          revenueMaximized:
            booking.yieldManagement?.checkOutData?.finalRevenue >
            booking.yieldManagement?.pricingDetails?.[0]?.basePrice,
          recommendations: booking.yieldManagement?.checkOutData?.recommendations,
        },
      });

      // Notify housekeeping
      socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
        action: 'ROOMS_NEED_CLEANING',
        rooms: releasedRoomNumbers.map((r) => ({
          number: r.number,
          type: r.type,
          priority: r.needsMaintenance ? 'HIGH' : 'NORMAL',
          notes: roomCondition?.find((rc) => rc.roomNumber === r.number)?.notes,
        })),
        timestamp: new Date(),
      });

      // Update real-time availability
      await availabilityRealtimeService.updateAvailabilityAfterBooking(
        booking.hotel._id,
        {
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          rooms: booking.rooms,
        },
        'RELEASE'
      );

      // Broadcast availability change
      try {
        const currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
          booking.hotel._id,
          new Date(),
          new Date(Date.now() + 24 * 60 * 60 * 1000)
        );

        if (currentAvailability && currentAvailability.summary) {
          socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
            action: 'ROOMS_AVAILABLE',
            roomsReleased: releasedRoomNumbers.length,
            newAvailability: currentAvailability.summary,
            timestamp: new Date(),
          });
        }
      } catch (availabilityError) {
        console.warn('Availability broadcast failed after checkout:', availabilityError.message);
      }

      // Send comprehensive notifications
      await sendComprehensiveNotifications(booking, 'CHECKED_OUT', {
        finalAmount: booking.totalPrice,
        invoiceNumber: invoiceData?.invoiceNumber,
        yieldPerformance: booking.yieldManagement?.checkOutData,
      });

      // Update demand analyzer with completed booking data
      try {
        await demandAnalyzer.analyzeDemand(
          booking.hotel._id,
          booking.checkInDate,
          booking.checkOutDate,
          {
            completedBooking: true,
            actualRevenue: booking.totalPrice,
            actualStayDuration,
            yieldPerformance: booking.yieldManagement?.checkOutData?.yieldPerformanceScore,
          }
        );
      } catch (demandError) {
        console.warn('Demand analysis update failed:', demandError.message);
      }

      // Invalidate cache
      invalidateHotelCache(booking.hotel._id);

      res.status(200).json({
        success: true,
        message: 'Check-out effectué avec succès',
        data: {
          booking: {
            id: booking._id,
            status: booking.status,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            actualCheckOutDate: booking.actualCheckOutDate,
            actualStayDuration,
            finalAmount: booking.totalPrice,
            paymentStatus: booking.paymentStatus,
          },
          releasedRooms: releasedRoomNumbers,
          invoice: invoiceData,
          yieldPerformance: booking.yieldManagement?.checkOutData,
          summary: {
            stayDuration: `${actualStayDuration} nuit(s)`,
            roomsUsed: roomsToRelease.length,
            extrasTotal: booking.extrasTotal || 0,
            finalTotal: booking.totalPrice,
            yieldOptimization: booking.yieldManagement?.checkOutData?.yieldPerformanceScore
              ? `${booking.yieldManagement.checkOutData.yieldPerformanceScore}% efficacité`
              : 'N/A',
          },
          realTimeUpdates: {
            availabilityUpdated: true,
            housekeepingNotified: true,
            invoiceGenerated: !!invoiceData,
            yieldDataRecorded: true,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur check-out:', error);

    // Notify error
    socketService.sendHotelNotification(req.body.hotelId || '', 'CHECK_OUT_ERROR', {
      bookingId: id,
      error: error.message,
      receptionistId: req.user.id,
      timestamp: new Date(),
    });

    if (error.message.includes('non trouvée') || error.message.includes('impossible')) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du check-out',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * GESTION EXTRAS & SERVICES WITH YIELD TRACKING
 * ================================
 */

/**
 * @desc    Ajouter des extras/consommations à une réservation
 * @route   POST /api/bookings/:id/extras
 * @access  Admin + Receptionist
 */
const addBookingExtras = async (req, res) => {
  try {
    const { id } = req.params;
    const { extras } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    if (!extras || !Array.isArray(extras) || extras.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins un extra requis',
      });
    }

    const booking = await Booking.findById(id)
      .populate('hotel', 'name yieldManagement')
      .populate('customer', 'firstName lastName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée',
      });
    }

    if (![BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Extras possibles uniquement après check-in',
      });
    }

    // ================================
    // VALIDATION ET CALCUL EXTRAS AVEC YIELD
    // ================================

    let extrasTotal = 0;
    const validatedExtras = [];

    for (const extra of extras) {
      const { name, category, price, quantity = 1, description } = extra;

      if (!name || !price || price < 0) {
        return res.status(400).json({
          success: false,
          message: 'Nom et prix valides requis pour chaque extra',
        });
      }

      if (quantity < 1 || quantity > 100) {
        return res.status(400).json({
          success: false,
          message: 'Quantité invalide (1-100)',
        });
      }

      // Apply yield pricing to extras if enabled
      let finalPrice = price;
      if (booking.hotel.yieldManagement?.enabled) {
        const demandLevel = await getCurrentDemandLevel(booking.hotel._id);
        if (demandLevel === 'HIGH' || demandLevel === 'VERY_HIGH') {
          finalPrice = price * 1.1; // 10% premium on extras during high demand
        }
      }

      const extraTotal = finalPrice * quantity;
      extrasTotal += extraTotal;

      validatedExtras.push({
        name,
        category: category || 'Divers',
        price: finalPrice,
        quantity,
        description: description || '',
        total: extraTotal,
        addedAt: new Date(),
        addedBy: req.user.id,
        yieldAdjusted: finalPrice !== price,
      });
    }

    // ================================
    // MISE À JOUR RÉSERVATION
    // ================================

    booking.extras = [...(booking.extras || []), ...validatedExtras];
    booking.extrasTotal = (booking.extrasTotal || 0) + extrasTotal;
    booking.totalPrice += extrasTotal;
    booking.updatedBy = req.user.id;
    booking.updatedAt = new Date();

    // Update yield data
    if (booking.yieldManagement) {
      booking.yieldManagement.extrasRevenue = booking.extrasTotal;
      booking.yieldManagement.extrasCount = booking.extras.length;
    }

    await booking.save();

    // ================================
    // REAL-TIME NOTIFICATIONS
    // ================================

    const extrasData = {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      extras: validatedExtras,
      extrasTotal,
      newTotalPrice: booking.totalPrice,
      addedBy: req.user.id,
      timestamp: new Date(),
      yieldAdjustment: validatedExtras.some((e) => e.yieldAdjusted),
    };

    // Notify customer
    socketService.sendUserNotification(booking.customer._id, 'EXTRAS_ADDED', {
      ...extrasData,
      message: `${validatedExtras.length} service(s) ajouté(s) à votre facture`,
      breakdown: validatedExtras.map((e) => ({
        name: e.name,
        quantity: e.quantity,
        price: e.price,
        total: e.total,
        yieldAdjusted: e.yieldAdjusted,
      })),
    });

    // Notify hotel billing
    socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_EXTRAS_ADDED', {
      ...extrasData,
      categories: [...new Set(validatedExtras.map((e) => e.category))],
      impact: {
        revenueIncrease: extrasTotal,
        newTotal: booking.totalPrice,
        yieldOptimized: validatedExtras.some((e) => e.yieldAdjusted),
      },
    });

    // Notify receptionist who added extras
    socketService.sendUserNotification(req.user.id, 'EXTRAS_ADDED_CONFIRMATION', {
      ...extrasData,
      message: 'Extras ajoutés avec succès',
      summary: `${validatedExtras.length} extra(s) pour un total de ${extrasTotal} MAD`,
    });

    // Update booking room for real-time tracking
    socketService.sendBookingNotification(booking._id, 'EXTRAS_UPDATED', {
      ...extrasData,
      action: 'EXTRAS_ADDED',
    });

    res.status(200).json({
      success: true,
      message: `${validatedExtras.length} extra(s) ajouté(s) avec succès`,
      data: {
        booking: {
          id: booking._id,
          customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
          hotel: booking.hotel.name,
        },
        addedExtras: validatedExtras,
        totals: {
          extrasAdded: extrasTotal,
          currentExtrasTotal: booking.extrasTotal,
          newTotalPrice: booking.totalPrice,
        },
        summary: {
          totalExtras: booking.extras.length,
          extrasValue: booking.extrasTotal,
          yieldOptimized: validatedExtras.some((e) => e.yieldAdjusted),
        },
        realTimeUpdate: {
          notified: true,
          timestamp: new Date(),
        },
      },
    });
  } catch (error) {
    console.error('Erreur ajout extras:', error);

    // Notify error
    socketService.sendUserNotification(req.user.id, 'EXTRAS_ERROR', {
      bookingId: id,
      error: error.message,
      timestamp: new Date(),
    });

    res.status(500).json({
      success: false,
      message: "Erreur serveur lors de l'ajout d'extras",
    });
  }
};

/**
 * ================================
 * GESTION ANNULATIONS WITH YIELD IMPACT
 * ================================
 */

/**
 * @desc    Annuler une réservation avec analyse impact yield
 * @route   PUT /api/bookings/:id/cancel
 * @access  Client (ses réservations) + Admin + Receptionist
 */
const cancelBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { reason, refundAmount, refundReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name yieldManagement')
        .populate('customer', 'firstName lastName email')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      // Check permissions
      if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
        throw new Error('Accès non autorisé à cette réservation');
      }

      // Check if cancellable
      const cancellableStatuses = [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED];
      if (!cancellableStatuses.includes(booking.status)) {
        throw new Error(`Impossible d'annuler une réservation avec statut: ${booking.status}`);
      }

      // ================================
      // REAL-TIME CANCELLATION PROCESS
      // ================================

      const cancellationResult = await bookingRealtimeService.handleBookingCancellationRealtime(
        booking._id,
        req.user.id,
        reason
      );

      // ================================
      // CALCULATE CANCELLATION POLICY
      // ================================

      const now = new Date();
      const checkInDate = new Date(booking.checkInDate);
      const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);

      let refundPercentage = 0;
      let cancellationFee = 0;

      if (hoursUntilCheckIn >= BUSINESS_RULES.FREE_CANCELLATION_HOURS) {
        // Free cancellation
        refundPercentage = 100;
      } else if (hoursUntilCheckIn >= 12) {
        // Late cancellation with penalty
        refundPercentage = 50;
        cancellationFee = booking.totalPrice * 0.5;
      } else {
        // Very late cancellation
        refundPercentage = 0;
        cancellationFee = booking.totalPrice;
      }

      // Admin can force specific refund
      if (req.user.role === USER_ROLES.ADMIN && refundAmount !== undefined) {
        const finalRefund = Math.max(0, Math.min(refundAmount, booking.totalPrice));
        refundPercentage = (finalRefund / booking.totalPrice) * 100;
        cancellationFee = booking.totalPrice - finalRefund;
      }

      // ================================
      // YIELD IMPACT ANALYSIS
      // ================================

      let yieldImpact = null;
      if (booking.hotel.yieldManagement?.enabled) {
        // Calculate revenue loss
        const revenueLoss = booking.totalPrice - (booking.totalPrice * refundPercentage) / 100;

        // Analyze rebooking opportunity
        const daysUntilCheckIn = Math.ceil(hoursUntilCheckIn / 24);
        const rebookingProbability = calculateRebookingProbability(daysUntilCheckIn);

        // Get current demand level
        const currentDemand = await getCurrentDemandLevel(booking.hotel._id);

        yieldImpact = {
          revenueLoss,
          daysUntilCheckIn,
          rebookingProbability,
          currentDemand,
          recommendedAction: generateCancellationRecommendation(
            daysUntilCheckIn,
            rebookingProbability,
            currentDemand
          ),
        };

        // Update yield data
        if (booking.yieldManagement) {
          booking.yieldManagement.cancellationData = {
            cancelledAt: now,
            revenueLoss,
            refundAmount: (booking.totalPrice * refundPercentage) / 100,
            rebookingProbability,
            yieldImpact,
          };
        }
      }

      // ================================
      // RELEASE ASSIGNED ROOMS
      // ================================

      const assignedRooms = booking.rooms.filter((r) => r.room);
      if (assignedRooms.length > 0) {
        const roomIds = assignedRooms.map((r) => r.room);
        await Room.updateMany(
          { _id: { $in: roomIds } },
          {
            status: ROOM_STATUS.AVAILABLE,
            currentBooking: null,
            updatedBy: req.user.id,
            updatedAt: new Date(),
          },
          { session }
        );

        // Notify room status changes
        for (const roomId of roomIds) {
          socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
            roomId,
            previousStatus: ROOM_STATUS.OCCUPIED,
            newStatus: ROOM_STATUS.AVAILABLE,
            reason: 'Booking cancelled',
          });
        }
      }

      // ================================
      // UPDATE BOOKING
      // ================================

      booking.status = BOOKING_STATUS.CANCELLED;
      booking.cancelledAt = new Date();
      booking.cancelledBy = req.user.id;
      booking.cancellationReason = reason || 'Annulation demandée';
      booking.refundPercentage = refundPercentage;
      booking.cancellationFee = cancellationFee;
      booking.refundAmount = booking.totalPrice * (refundPercentage / 100);
      booking.refundReason = refundReason || 'Remboursement selon politique';

      // Update history
      booking.statusHistory = [
        ...(booking.statusHistory || []),
        {
          previousStatus: booking.status,
          newStatus: BOOKING_STATUS.CANCELLED,
          reason: reason || 'Annulation demandée',
          changedBy: req.user.id,
          changedAt: new Date(),
        },
      ];

      booking.updatedBy = req.user.id;
      booking.updatedAt = new Date();

      await booking.save({ session });

      // ================================
      // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD IMPACT
      // ================================

      const cancellationData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        cancellationReason: booking.cancellationReason,
        refundAmount: booking.refundAmount,
        refundPercentage,
        cancellationFee,
        cancelledBy: req.user.id,
        userRole: req.user.role,
        hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
        timestamp: new Date(),
        yieldImpact,
      };

      // Notify customer
      socketService.sendUserNotification(booking.customer._id, 'BOOKING_CANCELLED', {
        ...cancellationData,
        message: 'Votre réservation a été annulée',
        refundInfo: {
          amount: booking.refundAmount,
          percentage: refundPercentage,
          processingTime: booking.refundAmount > 0 ? '5-7 jours ouvrés' : null,
        },
      });

      // Notify hotel with yield insights
      socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_CANCELLED_NOTIFICATION', {
        ...cancellationData,
        roomsReleased: assignedRooms.length,
        revenueImpact: -booking.totalPrice,
        availability: 'Rooms now available for rebooking',
        yieldRecommendations: yieldImpact?.recommendedAction,
      });

      // Notify admins for monitoring
      socketService.sendAdminNotification('BOOKING_CANCELLED', {
        ...cancellationData,
        financialImpact: {
          lostRevenue: booking.totalPrice - booking.refundAmount,
          refundAmount: booking.refundAmount,
          yieldImpact: yieldImpact?.revenueLoss,
        },
      });

      // Update real-time availability
      await availabilityRealtimeService.updateAvailabilityAfterBooking(
        booking.hotel._id,
        {
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          rooms: booking.rooms,
        },
        'CANCEL'
      );

      // Broadcast availability change
      socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
        action: 'BOOKING_CANCELLED',
        roomsAvailable: booking.rooms.length,
        dates: {
          checkIn: booking.checkInDate,
          checkOut: booking.checkOutDate,
        },
        timestamp: new Date(),
      });

      // Send comprehensive notifications
      await sendComprehensiveNotifications(booking, 'CANCELLED', {
        reason: booking.cancellationReason,
        refundAmount: booking.refundAmount,
        yieldImpact,
      });

      // Update demand analyzer
      await demandAnalyzer.analyzeDemand(
        booking.hotel._id,
        booking.checkInDate,
        booking.checkOutDate,
        {
          cancellation: true,
          daysBeforeCheckIn: Math.ceil(hoursUntilCheckIn / 24),
          revenue: booking.totalPrice,
          refundAmount: booking.refundAmount,
        }
      );

      // Invalidate cache
      invalidateHotelCache(booking.hotel._id);

      res.status(200).json({
        success: true,
        message: 'Réservation annulée avec succès',
        data: {
          booking: {
            id: booking._id,
            status: booking.status,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            hotel: booking.hotel.name,
            cancelledAt: booking.cancelledAt,
          },
          cancellation: {
            reason: booking.cancellationReason,
            hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
            refundPolicy: {
              originalAmount: booking.totalPrice,
              refundPercentage,
              refundAmount: booking.refundAmount,
              cancellationFee,
            },
          },
          yieldImpact,
          releasedRooms: assignedRooms.length,
          nextSteps: {
            refundProcessing:
              booking.refundAmount > 0
                ? 'Remboursement en cours de traitement'
                : 'Aucun remboursement',
            estimatedRefundTime: booking.refundAmount > 0 ? '5-7 jours ouvrés' : null,
            rebookingOpportunity:
              yieldImpact?.rebookingProbability > 0.5
                ? 'Forte probabilité de nouvelle réservation'
                : 'Promouvoir la disponibilité recommandée',
          },
          realTimeUpdates: {
            availabilityUpdated: true,
            notificationsSent: true,
            yieldAnalysisCompleted: !!yieldImpact,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur annulation réservation:', error);

    // Notify error
    socketService.sendUserNotification(req.user.id, 'CANCELLATION_ERROR', {
      bookingId: id,
      error: error.message,
      timestamp: new Date(),
    });

    if (
      error.message.includes('non trouvée') ||
      error.message.includes('Impossible') ||
      error.message.includes('Accès')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: "Erreur serveur lors de l'annulation",
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * MODIFICATION RÉSERVATIONS WITH YIELD REPRICING
 * ================================
 */

/**
 * @desc    Modifier une réservation avec recalcul yield automatique
 * @route   PUT /api/bookings/:id
 * @access  Client (ses réservations, si PENDING) + Admin + Receptionist
 */
const updateBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const {
      newCheckInDate,
      newCheckOutDate,
      roomModifications, // [{ action: 'add'|'remove', type, quantity }]
      specialRequests,
      guestNotes,
      recalculateYieldPricing = true, // NEW: Option to recalculate with yield
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name category yieldManagement')
        .populate('customer', 'firstName lastName')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      // Check permissions
      if (req.user.role === USER_ROLES.CLIENT) {
        if (booking.customer._id.toString() !== req.user.id) {
          throw new Error('Accès non autorisé à cette réservation');
        }
        if (booking.status !== BOOKING_STATUS.PENDING) {
          throw new Error('Modifications possibles uniquement pour réservations en attente');
        }
      }

      // Save original values for comparison
      const originalData = {
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        totalPrice: booking.totalPrice,
        rooms: [...booking.rooms],
      };

      let recalculatePrice = false;
      const modifications = [];
      let yieldRecalculation = null;

      // ================================
      // REAL-TIME MODIFICATION TRACKING
      // ================================

      socketService.sendBookingNotification(booking._id, 'MODIFICATION_STARTED', {
        bookingId: booking._id,
        modifiedBy: req.user.id,
        timestamp: new Date(),
      });

      // ================================
      // DATE MODIFICATIONS WITH YIELD REPRICING
      // ================================

      if (newCheckInDate || newCheckOutDate) {
        const checkIn = newCheckInDate ? new Date(newCheckInDate) : booking.checkInDate;
        const checkOut = newCheckOutDate ? new Date(newCheckOutDate) : booking.checkOutDate;

        if (checkIn >= checkOut) {
          throw new Error(ERROR_MESSAGES.INVALID_DATE_RANGE);
        }

        if (checkIn < new Date()) {
          throw new Error(ERROR_MESSAGES.DATE_IN_PAST);
        }

        // Check availability for new dates in real-time
        const newAvailability = await availabilityRealtimeService.getRealTimeAvailability(
          booking.hotel._id,
          checkIn,
          checkOut
        );

        for (const roomBooking of booking.rooms) {
          if (
            !newAvailability.rooms[roomBooking.type] ||
            newAvailability.rooms[roomBooking.type].availableRooms < 1
          ) {
            throw new Error(
              `Chambres ${roomBooking.type} non disponibles pour les nouvelles dates`
            );
          }
        }

        booking.checkInDate = checkIn;
        booking.checkOutDate = checkOut;
        recalculatePrice = true;

        if (originalData.checkInDate.getTime() !== checkIn.getTime()) {
          modifications.push(
            `Date arrivée: ${originalData.checkInDate.toLocaleDateString()} → ${checkIn.toLocaleDateString()}`
          );
        }
        if (originalData.checkOutDate.getTime() !== checkOut.getTime()) {
          modifications.push(
            `Date départ: ${originalData.checkOutDate.toLocaleDateString()} → ${checkOut.toLocaleDateString()}`
          );
        }
      }

      // ================================
      // ROOM MODIFICATIONS WITH YIELD ANALYSIS
      // ================================

      if (roomModifications && roomModifications.length > 0) {
        for (const modification of roomModifications) {
          const { action, type, quantity = 1 } = modification;

          if (action === 'add') {
            // Check availability for new rooms in real-time
            const roomAvailability = await availabilityRealtimeService.getRealTimeAvailability(
              booking.hotel._id,
              booking.checkInDate,
              booking.checkOutDate
            );

            if (
              !roomAvailability.rooms[type] ||
              roomAvailability.rooms[type].availableRooms < quantity
            ) {
              throw new Error(`Pas assez de chambres ${type} disponibles`);
            }

            // Add new rooms with yield pricing
            for (let i = 0; i < quantity; i++) {
              booking.rooms.push({
                type,
                basePrice: roomAvailability.rooms[type].currentPrice,
                calculatedPrice: 0, // Will be recalculated
                room: null,
                assignedAt: null,
                assignedBy: null,
              });
            }

            modifications.push(`Ajout: ${quantity} chambre(s) ${type}`);
          } else if (action === 'remove') {
            // Remove rooms of specified type
            const roomsToRemove = booking.rooms.filter((r) => r.type === type);
            const removeCount = Math.min(quantity, roomsToRemove.length);

            for (let i = 0; i < removeCount; i++) {
              const roomIndex = booking.rooms.findIndex((r) => r.type === type);
              if (roomIndex !== -1) {
                // If room assigned, release it
                const roomToRemove = booking.rooms[roomIndex];
                if (roomToRemove.room) {
                  await Room.findByIdAndUpdate(
                    roomToRemove.room,
                    {
                      status: ROOM_STATUS.AVAILABLE,
                      currentBooking: null,
                      updatedBy: req.user.id,
                    },
                    { session }
                  );
                }
                booking.rooms.splice(roomIndex, 1);
              }
            }

            modifications.push(`Suppression: ${removeCount} chambre(s) ${type}`);
          }
        }

        recalculatePrice = true;
      }

      // ================================
      // YIELD MANAGEMENT REPRICING
      // ================================

      if (recalculatePrice && recalculateYieldPricing && booking.hotel.yieldManagement?.enabled) {
        try {
          // Recalculate with current yield management
          const yieldRecalc = await yieldManager.calculateDynamicPrice({
            hotelId: booking.hotel._id,
            roomType: booking.rooms[0].type,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            strategy: booking.hotel.yieldManagement.strategy || 'MODERATE',
          });

          yieldRecalculation = {
            originalPricing: booking.yieldManagement,
            newPricing: yieldRecalc,
            priceChange: yieldRecalc.totalPrice - booking.totalPrice,
            recommendation: yieldRecalc.recommendations[0]?.action || 'APPLY',
          };

          // Update booking with new yield pricing
          for (const roomBooking of booking.rooms) {
            roomBooking.calculatedPrice = yieldRecalc.dynamicPrice;
            roomBooking.yieldFactors = yieldRecalc.factors;
          }

          const nightsCount = Math.ceil(
            (booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24)
          );
          booking.totalPrice = yieldRecalc.dynamicPrice * booking.rooms.length * nightsCount;

          // Update yield management data
          booking.yieldManagement.pricingDetails = [
            {
              roomType: booking.rooms[0].type,
              basePrice: yieldRecalc.basePrice,
              dynamicPrice: yieldRecalc.dynamicPrice,
              factors: yieldRecalc.factors,
              recalculatedAt: new Date(),
            },
          ];

          modifications.push(
            `Prix recalculé avec yield management: ${yieldRecalculation.priceChange > 0 ? '+' : ''}${Math.round(yieldRecalculation.priceChange)} EUR`
          );
        } catch (yieldError) {
          console.error('Yield recalculation failed:', yieldError);
          // Continue with standard pricing
          yieldRecalculation = { error: 'Yield recalculation failed, using standard pricing' };
        }
      }

      // ================================
      // STANDARD PRICE RECALCULATION (if yield failed or disabled)
      // ================================

      if (recalculatePrice && (!yieldRecalculation || yieldRecalculation.error)) {
        let newTotalPrice = 0;

        for (const roomBooking of booking.rooms) {
          const roomPrice = calculateBookingPrice({
            basePrice: roomBooking.basePrice,
            roomType: roomBooking.type,
            hotelCategory: booking.hotel.category,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            numberOfRooms: 1,
          });

          roomBooking.calculatedPrice = roomPrice.totalPrice;
          newTotalPrice += roomPrice.totalPrice;
        }

        booking.totalPrice = newTotalPrice + (booking.extrasTotal || 0);

        if (Math.abs(originalData.totalPrice - booking.totalPrice) > 1) {
          modifications.push(
            `Prix total: ${originalData.totalPrice} EUR → ${booking.totalPrice} EUR`
          );
        }
      }

      // ================================
      // OTHER MODIFICATIONS
      // ================================

      if (specialRequests !== undefined) {
        booking.specialRequests = specialRequests;
        modifications.push('Demandes spéciales mises à jour');
      }

      if (guestNotes !== undefined && req.user.role !== USER_ROLES.CLIENT) {
        booking.guestNotes = guestNotes;
        modifications.push('Notes client mises à jour');
      }

      // ================================
      // SAVE MODIFICATIONS
      // ================================

      booking.statusHistory = [
        ...(booking.statusHistory || []),
        {
          previousStatus: booking.status,
          newStatus: booking.status,
          reason: `Modification: ${modifications.join(', ')}`,
          changedBy: req.user.id,
          changedAt: new Date(),
          yieldRecalculated: !!yieldRecalculation && !yieldRecalculation.error,
        },
      ];

      booking.updatedBy = req.user.id;
      booking.updatedAt = new Date();

      await booking.save({ session });

      // ================================
      // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD DATA
      // ================================

      const modificationData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        modifications,
        modifiedBy: req.user.id,
        userRole: req.user.role,
        priceChanged: recalculatePrice,
        newPrice: booking.totalPrice,
        priceDifference: booking.totalPrice - originalData.totalPrice,
        yieldRecalculation,
        timestamp: new Date(),
      };

      // Notify customer (if not self-modification)
      if (req.user.id !== booking.customer._id.toString()) {
        socketService.sendUserNotification(booking.customer._id, 'BOOKING_MODIFIED', {
          ...modificationData,
          message: 'Votre réservation a été modifiée',
          changes: modifications,
          yieldOptimization:
            yieldRecalculation && !yieldRecalculation.error
              ? {
                  priceChange: yieldRecalculation.priceChange,
                  reason: 'Optimisation automatique des prix',
                  newDemandLevel: yieldRecalculation.newPricing?.factors?.demandFactor?.level,
                }
              : null,
        });
      }

      // Notify hotel with yield insights
      socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_MODIFIED_NOTIFICATION', {
        ...modificationData,
        impact: {
          datesChanged: newCheckInDate || newCheckOutDate,
          roomsChanged: roomModifications && roomModifications.length > 0,
          revenueImpact: booking.totalPrice - originalData.totalPrice,
          yieldOptimized: yieldRecalculation && !yieldRecalculation.error,
        },
      });

      // Notify admins if significant changes
      if (
        Math.abs(booking.totalPrice - originalData.totalPrice) > 500 ||
        newCheckInDate ||
        newCheckOutDate
      ) {
        socketService.sendAdminNotification('SIGNIFICANT_BOOKING_MODIFICATION', {
          ...modificationData,
          requiresReview: booking.status === BOOKING_STATUS.PENDING,
          yieldImpact: yieldRecalculation,
        });
      }

      // Update real-time availability if dates/rooms changed
      if (
        newCheckInDate ||
        newCheckOutDate ||
        (roomModifications && roomModifications.length > 0)
      ) {
        // Release old availability
        await availabilityRealtimeService.updateAvailabilityAfterBooking(
          booking.hotel._id,
          {
            checkInDate: originalData.checkInDate,
            checkOutDate: originalData.checkOutDate,
            rooms: originalData.rooms,
          },
          'RELEASE'
        );

        // Book new availability
        await availabilityRealtimeService.updateAvailabilityAfterBooking(
          booking.hotel._id,
          {
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate,
            rooms: booking.rooms,
          },
          'BOOK'
        );
      }

      // Invalidate cache
      invalidateHotelCache(booking.hotel._id);

      res.status(200).json({
        success: true,
        message: 'Réservation modifiée avec succès',
        data: {
          booking: {
            id: booking._id,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            hotel: booking.hotel.name,
            newCheckInDate: booking.checkInDate,
            newCheckOutDate: booking.checkOutDate,
            newTotalRooms: booking.rooms.length,
            newTotalPrice: booking.totalPrice,
          },
          changes: {
            modifications,
            priceChange: booking.totalPrice - originalData.totalPrice,
            modifiedBy: req.user.id,
            modifiedAt: new Date(),
          },
          yieldManagement: yieldRecalculation,
          requiresRevalidation: booking.status === BOOKING_STATUS.PENDING && recalculatePrice,
          realTimeUpdates: {
            notificationsSent: true,
            availabilityUpdated: true,
            yieldRecalculated: !!yieldRecalculation && !yieldRecalculation.error,
          },
        },
      });
    });
  } catch (error) {
    console.error('Erreur modification réservation:', error);

    // Notify error
    socketService.sendUserNotification(req.user.id, 'MODIFICATION_ERROR', {
      bookingId: id,
      error: error.message,
      timestamp: new Date(),
    });

    if (
      error.message.includes('non trouvée') ||
      error.message.includes('Accès') ||
      error.message.includes('disponibles')
    ) {
      return res.status(400).json({
        success: false,
        message: error.message,
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la modification',
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * GÉNÉRATION FACTURES ET RAPPORTS WITH YIELD DATA
 * ================================
 */

/**
 * @desc    Générer et obtenir la facture d'une réservation avec données yield
 * @route   GET /api/bookings/:id/invoice
 * @access  Client (sa facture) + Staff
 */
const getBookingInvoice = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'json', includeYieldData = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    const booking = await Booking.findById(id)
      .populate('hotel', 'name code address city phone email yieldManagement')
      .populate('customer', 'firstName lastName email phone address')
      .populate('rooms.room', 'number type floor');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée',
      });
    }

    // Check permissions
    if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette facture',
      });
    }

    if (![BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CHECKED_IN].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'Facture disponible uniquement après check-in',
      });
    }

    // ================================
    // GENERATE INVOICE DATA WITH YIELD INFORMATION
    // ================================

    const invoice = await generateInvoiceWithYieldData(booking, includeYieldData === 'true');

    // Notify invoice accessed
    socketService.sendBookingNotification(booking._id, 'INVOICE_ACCESSED', {
      bookingId: booking._id,
      accessedBy: req.user.id,
      format,
      timestamp: new Date(),
    });

    if (format === 'pdf') {
      // TODO: Generate PDF with library like puppeteer or jsPDF
      return res.status(501).json({
        success: false,
        message: "Génération PDF en cours d'implémentation",
        alternative: 'Utilisez format=json pour obtenir les données',
      });
    }

    res.status(200).json({
      success: true,
      data: {
        invoice,
        downloadOptions: {
          pdf: `/api/bookings/${id}/invoice?format=pdf`,
          email: `/api/bookings/${id}/invoice/email`,
        },
        realTimeTracking: {
          accessed: true,
          timestamp: new Date(),
        },
      },
    });
  } catch (error) {
    console.error('Erreur génération facture:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération de facture',
    });
  }
};

/**
 * ================================
 * STATISTIQUES ET RAPPORTS WITH YIELD ANALYTICS
 * ================================
 */

/**
 * @desc    Obtenir statistiques réservations pour dashboard avec données yield
 * @route   GET /api/bookings/stats/dashboard
 * @access  Admin + Receptionist
 */
const getBookingStats = async (req, res) => {
  try {
    const {
      hotelId,
      period = '30d',
      groupBy = 'day',
      realTime = false,
      includeYieldAnalytics = true, // NEW: Include yield management analytics
    } = req.query;

    // Permission check for receptionist
    if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis pour réceptionniste',
      });
    }

    // Calculate period
    const endDate = new Date();
    const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = daysMap[period] || 30;
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

    // Build query
    const query = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (hotelId) {
      query.hotel = new mongoose.Types.ObjectId(hotelId);
    }

    // ================================
    // PARALLEL STATISTICS QUERIES WITH YIELD DATA
    // ================================

    const [statusStats, revenueStats, sourceStats, trendsData, occupancyData, yieldStats] =
      await Promise.all([
        // Status distribution
        Booking.aggregate([
          { $match: query },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
              totalRevenue: { $sum: '$totalPrice' },
              averageValue: { $avg: '$totalPrice' },
            },
          },
        ]),

        // Total revenue and averages
        Booking.aggregate([
          { $match: query },
          {
            $group: {
              _id: null,
              totalBookings: { $sum: 1 },
              totalRevenue: { $sum: '$totalPrice' },
              averageBookingValue: { $avg: '$totalPrice' },
              totalRooms: { $sum: { $size: '$rooms' } },
              averageRoomsPerBooking: { $avg: { $size: '$rooms' } },
            },
          },
        ]),

        // Source distribution
        Booking.aggregate([
          { $match: query },
          {
            $group: {
              _id: '$source',
              count: { $sum: 1 },
              revenue: { $sum: '$totalPrice' },
            },
          },
        ]),

        // Trends by period
        Booking.aggregate([
          { $match: query },
          {
            $group: {
              _id: {
                $dateToString: {
                  format: groupBy === 'day' ? '%Y-%m-%d' : groupBy === 'week' ? '%Y-%U' : '%Y-%m',
                  date: '$createdAt',
                },
              },
              bookings: { $sum: 1 },
              revenue: { $sum: '$totalPrice' },
              rooms: { $sum: { $size: '$rooms' } },
            },
          },
          { $sort: { _id: 1 } },
        ]),

        // Real-time occupancy if hotel specified
        hotelId ? availabilityRealtimeService.getRealTimeOccupancy(hotelId) : null,

        // NEW: Yield management statistics
        includeYieldAnalytics === 'true'
          ? Booking.aggregate([
              { $match: { ...query, 'yieldManagement.enabled': true } },
              {
                $group: {
                  _id: null,
                  totalYieldBookings: { $sum: 1 },
                  averageYieldMultiplier: { $avg: '$yieldManagement.averageMultiplier' },
                  totalYieldRevenue: { $sum: '$totalPrice' },
                  avgBasePrice: {
                    $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.basePrice', 0] },
                  },
                  avgDynamicPrice: {
                    $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.dynamicPrice', 0] },
                  },
                },
              },
            ])
          : Promise.resolve([]),
      ]);

    // ================================
    // PROCESS RESULTS WITH YIELD INSIGHTS
    // ================================

    const totalStats = revenueStats[0] || {
      totalBookings: 0,
      totalRevenue: 0,
      averageBookingValue: 0,
      totalRooms: 0,
      averageRoomsPerBooking: 0,
    };

    const statusBreakdown = {};
    statusStats.forEach((stat) => {
      statusBreakdown[stat._id] = {
        count: stat.count,
        revenue: Math.round(stat.totalRevenue * 100) / 100,
        averageValue: Math.round(stat.averageValue * 100) / 100,
        percentage: Math.round((stat.count / totalStats.totalBookings) * 100),
      };
    });

    const sourceBreakdown = {};
    sourceStats.forEach((stat) => {
      sourceBreakdown[stat._id] = {
        count: stat.count,
        revenue: Math.round(stat.revenue * 100) / 100,
        percentage: Math.round((stat.count / totalStats.totalBookings) * 100),
      };
    });

    // Process yield statistics
    const yieldAnalytics = yieldStats[0]
      ? {
          totalYieldBookings: yieldStats[0].totalYieldBookings,
          yieldAdoptionRate: Math.round(
            (yieldStats[0].totalYieldBookings / totalStats.totalBookings) * 100
          ),
          averageYieldMultiplier:
            Math.round((yieldStats[0].averageYieldMultiplier || 1) * 100) / 100,
          yieldRevenue: Math.round(yieldStats[0].totalYieldRevenue * 100) / 100,
          avgBasePrice: Math.round((yieldStats[0].avgBasePrice || 0) * 100) / 100,
          avgDynamicPrice: Math.round((yieldStats[0].avgDynamicPrice || 0) * 100) / 100,
          revenueOptimization:
            yieldStats[0].avgDynamicPrice > yieldStats[0].avgBasePrice
              ? Math.round((yieldStats[0].avgDynamicPrice / yieldStats[0].avgBasePrice - 1) * 100)
              : 0,
        }
      : null;

    // ================================
    // REAL-TIME DASHBOARD UPDATES WITH YIELD DATA
    // ================================

    if (realTime === 'true') {
      // Subscribe user to real-time dashboard updates
      socketService.sendUserNotification(req.user.id, 'DASHBOARD_SUBSCRIPTION', {
        hotelId: hotelId || 'ALL',
        period,
        subscribedAt: new Date(),
      });

      // Send periodic updates for live dashboard
      const liveMetrics = {
        currentOccupancy: occupancyData ? occupancyData.occupancyRate : null,
        todaysBookings: await Booking.countDocuments({
          ...query,
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lte: new Date(),
          },
        }),
        pendingValidations: await Booking.countDocuments({
          ...query,
          status: BOOKING_STATUS.PENDING,
        }),
        checkinToday: await Booking.countDocuments({
          ...query,
          checkInDate: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lt: new Date(new Date().setHours(23, 59, 59, 999)),
          },
          status: BOOKING_STATUS.CONFIRMED,
        }),
        // NEW: Real-time yield metrics
        currentDemandLevel: hotelId ? await getCurrentDemandLevel(hotelId) : 'NORMAL',
        yieldOptimizationActive: yieldAnalytics ? yieldAnalytics.yieldAdoptionRate > 50 : false,
      };

      // Broadcast live metrics if admin/hotel manager
      if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role)) {
        socketService.sendUserNotification(req.user.id, 'LIVE_DASHBOARD_METRICS', {
          metrics: liveMetrics,
          timestamp: new Date(),
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        period: {
          start: startDate,
          end: endDate,
          days,
          groupBy,
        },
        overview: {
          totalBookings: totalStats.totalBookings,
          totalRevenue: Math.round(totalStats.totalRevenue * 100) / 100,
          averageBookingValue: Math.round(totalStats.averageBookingValue * 100) / 100,
          totalRooms: totalStats.totalRooms,
          averageRoomsPerBooking: Math.round(totalStats.averageRoomsPerBooking * 100) / 100,
        },
        breakdown: {
          byStatus: statusBreakdown,
          bySource: sourceBreakdown,
        },
        trends: trendsData.map((trend) => ({
          period: trend._id,
          bookings: trend.bookings,
          revenue: Math.round(trend.revenue * 100) / 100,
          rooms: trend.rooms,
          averageBookingValue: Math.round((trend.revenue / trend.bookings) * 100) / 100,
        })),
        insights: {
          conversionRate: statusBreakdown[BOOKING_STATUS.CONFIRMED]
            ? Math.round(
                (statusBreakdown[BOOKING_STATUS.CONFIRMED].count / totalStats.totalBookings) * 100
              )
            : 0,
          cancellationRate: statusBreakdown[BOOKING_STATUS.CANCELLED]
            ? Math.round(
                (statusBreakdown[BOOKING_STATUS.CANCELLED].count / totalStats.totalBookings) * 100
              )
            : 0,
          completionRate: statusBreakdown[BOOKING_STATUS.COMPLETED]
            ? Math.round(
                (statusBreakdown[BOOKING_STATUS.COMPLETED].count / totalStats.totalBookings) * 100
              )
            : 0,
        },
        realTimeData: occupancyData
          ? {
              currentOccupancy: occupancyData.occupancyRate,
              roomsOccupied: occupancyData.occupiedRooms,
              roomsAvailable: occupancyData.availableRooms,
              lastUpdated: new Date(),
            }
          : null,

        // NEW: Yield Management Analytics
        yieldManagement: yieldAnalytics,
        realTimeEnabled: realTime === 'true',
      },
    });
  } catch (error) {
    console.error('Erreur statistiques réservations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * ================================
 * NEW: YIELD MANAGEMENT SPECIFIC ENDPOINTS
 * ================================
 */

/**
 * @desc    Get yield optimization recommendations for hotel
 * @route   GET /api/bookings/yield/recommendations
 * @access  Admin + Receptionist
 */
const getYieldRecommendations = async (req, res) => {
  try {
    const { hotelId, period = '7d' } = req.query;

    if (!hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis',
      });
    }

    // Permission check for receptionist
    if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis pour réceptionniste',
      });
    }

    const endDate = new Date();
    const daysMap = { '7d': 7, '14d': 14, '30d': 30 };
    const days = daysMap[period] || 7;
    const startDate = new Date(endDate.getTime() + days * 24 * 60 * 60 * 1000); // Future dates

    // Get revenue optimization recommendations
    const recommendations = await suggestRevenueOptimization(hotelId, 'ALL', {
      start: new Date(),
      end: startDate,
    });

    // Get current demand analysis
    const demandAnalysis = await demandAnalyzer.analyzeDemand(hotelId, new Date(), startDate);

    // Get yield performance for existing bookings
    const currentBookings = await Booking.find({
      hotel: hotelId,
      checkInDate: { $gte: new Date(), $lte: startDate },
      status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.PENDING] },
      'yieldManagement.enabled': true,
    }).populate('hotel', 'name yieldManagement');

    const yieldPerformance = {
      totalBookings: currentBookings.length,
      averageYieldScore:
        currentBookings.reduce((sum, b) => sum + (b.yieldManagement?.performanceScore || 50), 0) /
        Math.max(currentBookings.length, 1),
      revenueOptimized: currentBookings.filter((b) => b.yieldManagement?.revenueOptimized).length,
      potentialRevenue: currentBookings.reduce((sum, b) => sum + b.totalPrice, 0),
    };

    res.status(200).json({
      success: true,
      data: {
        hotelId,
        period: { days, start: new Date(), end: startDate },
        recommendations: recommendations.suggestions || [],
        demandAnalysis,
        yieldPerformance,
        actionItems: generateYieldActionItems(recommendations, demandAnalysis, yieldPerformance),
        lastUpdated: new Date(),
      },
    });
  } catch (error) {
    console.error('Error getting yield recommendations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * @desc    Update booking pricing with yield optimization
 * @route   PUT /api/bookings/:id/yield/optimize
 * @access  Admin + Receptionist
 */
const optimizeBookingYield = async (req, res) => {
  try {
    const { id } = req.params;
    const { strategy = 'MODERATE', forceRecalculation = false } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide',
      });
    }

    const booking = await Booking.findById(id)
      .populate('hotel', 'name code yieldManagement')
      .populate('customer', 'firstName lastName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée',
      });
    }

    if (booking.status !== BOOKING_STATUS.PENDING) {
      return res.status(400).json({
        success: false,
        message: 'Optimisation possible uniquement pour réservations en attente',
      });
    }

    // Calculate optimized pricing
    const optimizedPricing = await yieldManager.calculateDynamicPrice({
      hotelId: booking.hotel._id,
      roomType: booking.rooms[0].type,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      strategy: strategy,
      baseCurrency: 'EUR',
    });

    // Apply pricing rules
    const pricingRules = await applyPricingRules(booking.hotel._id, {
      roomType: booking.rooms[0].type,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      basePrice: optimizedPricing.basePrice,
    });

    const finalOptimizedPrice = optimizedPricing.dynamicPrice * pricingRules.finalMultiplier;
    const priceChange = finalOptimizedPrice - booking.totalPrice;
    const priceChangePercentage = (priceChange / booking.totalPrice) * 100;

    // Update booking if significant improvement or forced
    let updated = false;
    if (Math.abs(priceChangePercentage) > 5 || forceRecalculation) {
      const originalPrice = booking.totalPrice;

      // Update pricing
      booking.totalPrice = finalOptimizedPrice;
      booking.rooms.forEach((room) => {
        room.calculatedPrice = optimizedPricing.dynamicPrice;
        room.yieldFactors = optimizedPricing.factors;
      });

      // Update yield management data
      booking.yieldManagement = {
        ...booking.yieldManagement,
        lastOptimization: {
          optimizedAt: new Date(),
          optimizedBy: req.user.id,
          strategy: strategy,
          originalPrice,
          optimizedPrice: finalOptimizedPrice,
          improvement: priceChangePercentage,
          factors: optimizedPricing.factors,
          appliedRules: pricingRules.appliedRules,
        },
      };

      await booking.save();
      updated = true;

      // Notify stakeholders
      socketService.sendUserNotification(booking.customer._id, 'BOOKING_PRICE_OPTIMIZED', {
        bookingId: booking._id,
        originalPrice,
        newPrice: finalOptimizedPrice,
        savings: priceChange < 0 ? Math.abs(priceChange) : 0,
        increase: priceChange > 0 ? priceChange : 0,
        reason: 'Optimisation automatique des prix',
        timestamp: new Date(),
      });

      socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_YIELD_OPTIMIZED', {
        bookingId: booking._id,
        revenueImpact: priceChange,
        strategy: strategy,
        optimizedBy: req.user.id,
        timestamp: new Date(),
      });
    }

    res.status(200).json({
      success: true,
      message: updated
        ? 'Pricing optimisé avec succès'
        : 'Aucune optimisation significative trouvée',
      data: {
        bookingId: booking._id,
        optimization: {
          strategy,
          originalPrice: booking.totalPrice - (updated ? priceChange : 0),
          optimizedPrice: finalOptimizedPrice,
          priceChange,
          priceChangePercentage: Math.round(priceChangePercentage * 100) / 100,
          updated,
          factors: optimizedPricing.factors,
          appliedRules: pricingRules.appliedRules,
          recommendations: optimizedPricing.recommendations,
        },
        nextSteps: {
          requiresValidation: booking.status === BOOKING_STATUS.PENDING,
          notificationsSent: updated,
        },
      },
    });
  } catch (error) {
    console.error('Error optimizing booking yield:', error);
    res.status(500).json({
      success: false,
      message: "Erreur serveur lors de l'optimisation",
    });
  }
};

/**
 * @desc    Get yield performance analytics for date range
 * @route   GET /api/bookings/yield/performance
 * @access  Admin + Receptionist
 */
const getYieldPerformance = async (req, res) => {
  try {
    const { hotelId, startDate, endDate, roomType = 'ALL', groupBy = 'day' } = req.query;

    if (!hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis',
      });
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();

    // Build query
    const query = {
      hotel: hotelId,
      checkInDate: { $gte: start, $lte: end },
      'yieldManagement.enabled': true,
    };

    if (roomType !== 'ALL') {
      query['rooms.type'] = roomType;
    }

    // Get yield performance data
    const yieldPerformance = await Booking.aggregate([
      { $match: query },
      {
        $group: {
          _id:
            groupBy === 'day'
              ? { $dateToString: { format: '%Y-%m-%d', date: '$checkInDate' } }
              : { $dateToString: { format: '%Y-%m', date: '$checkInDate' } },
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
          avgYieldScore: { $avg: '$yieldManagement.performanceScore' },
          avgBasePrice: {
            $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.basePrice', 0] },
          },
          avgDynamicPrice: {
            $avg: { $arrayElemAt: ['$yieldManagement.pricingDetails.dynamicPrice', 0] },
          },
          optimizedBookings: {
            $sum: { $cond: ['$yieldManagement.revenueOptimized', 1, 0] },
          },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Calculate overall metrics
    const overallMetrics = await Booking.aggregate([
      { $match: query },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' },
          totalBaseRevenue: {
            $sum: {
              $multiply: [
                { $arrayElemAt: ['$yieldManagement.pricingDetails.basePrice', 0] },
                { $size: '$rooms' },
                {
                  $divide: [{ $subtract: ['$checkOutDate', '$checkInDate'] }, 1000 * 60 * 60 * 24],
                },
              ],
            },
          },
          avgYieldScore: { $avg: '$yieldManagement.performanceScore' },
          optimizedBookings: {
            $sum: { $cond: ['$yieldManagement.revenueOptimized', 1, 0] },
          },
        },
      },
    ]);

    const overall = overallMetrics[0] || {};
    const revenueOptimization =
      overall.totalBaseRevenue > 0
        ? ((overall.totalRevenue - overall.totalBaseRevenue) / overall.totalBaseRevenue) * 100
        : 0;

    // Get RevPAR data
    const revPARData = await calculateRevPAR(hotelId, start, end);

    res.status(200).json({
      success: true,
      data: {
        period: { start, end, groupBy },
        hotelId,
        roomType,
        performance: yieldPerformance.map((p) => ({
          period: p._id,
          bookings: p.totalBookings,
          revenue: Math.round(p.totalRevenue * 100) / 100,
          yieldScore: Math.round(p.avgYieldScore * 100) / 100,
          basePrice: Math.round(p.avgBasePrice * 100) / 100,
          dynamicPrice: Math.round(p.avgDynamicPrice * 100) / 100,
          optimizationRate: Math.round((p.optimizedBookings / p.totalBookings) * 100),
          revenuePerBooking: Math.round((p.totalRevenue / p.totalBookings) * 100) / 100,
        })),
        summary: {
          totalBookings: overall.totalBookings || 0,
          totalRevenue: Math.round((overall.totalRevenue || 0) * 100) / 100,
          avgYieldScore: Math.round((overall.avgYieldScore || 0) * 100) / 100,
          optimizationRate:
            overall.totalBookings > 0
              ? Math.round((overall.optimizedBookings / overall.totalBookings) * 100)
              : 0,
          revenueOptimization: Math.round(revenueOptimization * 100) / 100,
          revPAR: revPARData ? Math.round(revPARData.revPAR * 100) / 100 : 0,
        },
        insights: generateYieldInsights(yieldPerformance, overall, revenueOptimization),
      },
    });
  } catch (error) {
    console.error('Error getting yield performance:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * ================================
 * ROUTES SPÉCIALISÉES POUR STAFF - ENHANCED WITH REAL-TIME + YIELD
 * ================================
 */

/**
 * @desc    Obtenir réservations en attente de validation avec priorité yield
 * @route   GET /api/bookings/pending
 * @access  Admin uniquement
 */
const getPendingBookings = async (req, res) => {
  try {
    const {
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'asc',
      realTime = false,
      prioritizeYield = true, // NEW: Prioritize by yield impact
    } = req.query;

    let sortOptions = {};

    if (prioritizeYield === 'true') {
      // Sort by yield impact (revenue potential) first, then by creation date
      sortOptions = {
        totalPrice: -1, // Higher revenue bookings first
        createdAt: sortOrder === 'desc' ? -1 : 1,
      };
    } else {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    const pendingBookings = await Booking.find({
      status: BOOKING_STATUS.PENDING,
    })
      .populate('hotel', 'name code city yieldManagement')
      .populate('customer', 'firstName lastName email phone')
      .sort(sortOptions)
      .limit(parseInt(limit))
      .select('-__v');

    // Calculate processing delays and yield impact
    const bookingsWithAnalysis = pendingBookings.map((booking) => {
      const hoursWaiting = Math.round((Date.now() - booking.createdAt) / (1000 * 60 * 60));
      let priority = hoursWaiting > 48 ? 'high' : hoursWaiting > 24 ? 'medium' : 'normal';

      // Increase priority for high-value bookings
      if (booking.totalPrice > 1000) {
        priority = priority === 'normal' ? 'medium' : priority === 'medium' ? 'high' : 'critical';
      }

      // Add yield analysis
      const yieldImpact = {
        revenueValue: booking.totalPrice,
        demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
        yieldOptimized: booking.yieldManagement?.enabled || false,
        businessImpact: calculateBusinessImpact(booking),
      };

      return {
        ...booking.toObject(),
        waitingTime: {
          hours: hoursWaiting,
          priority,
          urgent: hoursWaiting > 48 || booking.totalPrice > 2000,
        },
        yieldImpact,
      };
    });

    // ================================
    // REAL-TIME PENDING BOOKINGS TRACKING WITH YIELD PRIORITY
    // ================================

    if (realTime === 'true') {
      // Subscribe admin to pending bookings updates
      socketService.sendAdminNotification('PENDING_BOOKINGS_SUBSCRIPTION', {
        adminId: req.user.id,
        totalPending: pendingBookings.length,
        urgentCount: bookingsWithAnalysis.filter((b) => b.waitingTime.urgent).length,
        highValueCount: bookingsWithAnalysis.filter((b) => b.yieldImpact.revenueValue > 1000)
          .length,
        subscribedAt: new Date(),
      });

      // Send real-time alerts for urgent bookings
      const urgentBookings = bookingsWithAnalysis.filter((b) => b.waitingTime.urgent);
      if (urgentBookings.length > 0) {
        socketService.sendAdminNotification('URGENT_VALIDATIONS_REQUIRED', {
          urgentBookings: urgentBookings.map((b) => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            hotel: b.hotel.name,
            waitingHours: b.waitingTime.hours,
            checkInDate: b.checkInDate,
            revenueValue: b.yieldImpact.revenueValue,
            businessImpact: b.yieldImpact.businessImpact,
          })),
          totalUrgent: urgentBookings.length,
          action: 'IMMEDIATE_ATTENTION_REQUIRED',
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        pendingBookings: bookingsWithAnalysis,
        summary: {
          total: pendingBookings.length,
          urgent: bookingsWithAnalysis.filter((b) => b.waitingTime.urgent).length,
          highValue: bookingsWithAnalysis.filter((b) => b.yieldImpact.revenueValue > 1000).length,
          totalPotentialRevenue: bookingsWithAnalysis.reduce(
            (sum, b) => sum + b.yieldImpact.revenueValue,
            0
          ),
          averageWaitTime:
            Math.round(
              bookingsWithAnalysis.reduce((sum, b) => sum + b.waitingTime.hours, 0) /
                bookingsWithAnalysis.length
            ) || 0,
        },
        actions: {
          validateAll: '/api/bookings/bulk-validate',
          autoValidate: '/api/bookings/auto-validate',
          yieldOptimize: '/api/bookings/yield/bulk-optimize',
        },
        realTimeTracking: {
          enabled: realTime === 'true',
          alertsEnabled: true,
          urgentThreshold: '48 hours',
          yieldPrioritized: prioritizeYield === 'true',
        },
      },
    });
  } catch (error) {
    console.error('Erreur réservations en attente:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * @desc    Obtenir réservations pour check-in aujourd'hui avec données yield
 * @route   GET /api/bookings/checkin-today
 * @access  Admin + Receptionist
 */
const getTodayCheckIns = async (req, res) => {
  try {
    const { hotelId, realTime = false, includeYieldData = true } = req.query;

    // Permission check for receptionist
    if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis pour réceptionniste',
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const query = {
      checkInDate: { $gte: today, $lt: tomorrow },
      status: BOOKING_STATUS.CONFIRMED,
    };

    if (hotelId) {
      query.hotel = hotelId;
    }

    const todayCheckIns = await Booking.find(query)
      .populate('hotel', 'name code yieldManagement')
      .populate('customer', 'firstName lastName email phone')
      .populate('rooms.room', 'number type floor')
      .sort({ checkInDate: 1 })
      .select('-__v');

    // Analyze preparation status with yield insights
    const checkInsWithStatus = todayCheckIns.map((booking) => {
      const roomsAssigned = booking.rooms.filter((r) => r.room).length;
      const totalRooms = booking.rooms.length;
      const readyForCheckIn = roomsAssigned === totalRooms;

      // Add yield insights if enabled
      const yieldInsights =
        includeYieldData === 'true' && booking.yieldManagement?.enabled
          ? {
              revenueValue: booking.totalPrice,
              yieldOptimized: booking.yieldManagement?.revenueOptimized || false,
              demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
              priceOptimization: booking.yieldManagement?.lastOptimization?.improvement || 0,
            }
          : null;

      return {
        ...booking.toObject(),
        preparationStatus: {
          roomsAssigned,
          totalRooms,
          readyForCheckIn,
          assignmentPercentage: Math.round((roomsAssigned / totalRooms) * 100),
        },
        yieldInsights,
      };
    });

    // ================================
    // REAL-TIME CHECK-IN TRACKING WITH YIELD DATA
    // ================================

    if (realTime === 'true') {
      // Subscribe to real-time check-in updates
      const subscriptionData = {
        userId: req.user.id,
        hotelId: hotelId || 'ALL',
        date: today,
        totalCheckIns: todayCheckIns.length,
        readyCount: checkInsWithStatus.filter((b) => b.preparationStatus.readyForCheckIn).length,
        totalRevenueToday: checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0),
      };

      if (hotelId) {
        socketService.sendHotelNotification(
          hotelId,
          'CHECKIN_DASHBOARD_SUBSCRIPTION',
          subscriptionData
        );
      } else {
        socketService.sendAdminNotification('CHECKIN_DASHBOARD_SUBSCRIPTION', subscriptionData);
      }

      // Send preparation alerts
      const unpreparedBookings = checkInsWithStatus.filter(
        (b) => !b.preparationStatus.readyForCheckIn
      );
      if (unpreparedBookings.length > 0) {
        const alertData = {
          unpreparedCount: unpreparedBookings.length,
          totalCheckIns: todayCheckIns.length,
          revenueAtRisk: unpreparedBookings.reduce((sum, b) => sum + b.totalPrice, 0),
          urgentPreparations: unpreparedBookings.map((b) => ({
            bookingId: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            roomsNeeded: b.preparationStatus.totalRooms,
            roomsAssigned: b.preparationStatus.roomsAssigned,
            revenueValue: b.totalPrice,
            yieldOptimized: b.yieldInsights?.yieldOptimized,
          })),
          action: 'ROOM_ASSIGNMENT_NEEDED',
        };

        if (hotelId) {
          socketService.sendHotelNotification(hotelId, 'PREPARATION_ALERT', alertData);
        } else {
          socketService.sendAdminNotification('PREPARATION_ALERT', alertData);
        }
      }

      // Real-time occupancy update with revenue impact
      if (hotelId) {
        const currentOccupancy = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);
        const expectedRevenue = checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0);

        socketService.sendHotelNotification(hotelId, 'OCCUPANCY_UPDATE', {
          currentOccupancy: currentOccupancy.occupancyRate,
          expectedOccupancy:
            currentOccupancy.occupancyRate +
            (todayCheckIns.length / currentOccupancy.totalRooms) * 100,
          checkInsRemaining: todayCheckIns.length,
          expectedRevenue,
          yieldOptimizedRevenue: checkInsWithStatus
            .filter((b) => b.yieldInsights?.yieldOptimized)
            .reduce((sum, b) => sum + b.totalPrice, 0),
          timestamp: new Date(),
        });
      }
    }

    res.status(200).json({
      success: true,
      data: {
        date: today,
        checkIns: checkInsWithStatus,
        summary: {
          total: todayCheckIns.length,
          ready: checkInsWithStatus.filter((b) => b.preparationStatus.readyForCheckIn).length,
          pending: checkInsWithStatus.filter((b) => !b.preparationStatus.readyForCheckIn).length,
          totalGuests: todayCheckIns.reduce((sum, b) => sum + b.numberOfGuests, 0),
          totalRooms: todayCheckIns.reduce((sum, b) => sum + b.rooms.length, 0),
          // NEW: Yield management summary
          totalRevenue: checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0),
          yieldOptimizedBookings: checkInsWithStatus.filter((b) => b.yieldInsights?.yieldOptimized)
            .length,
          averageBookingValue:
            todayCheckIns.length > 0
              ? checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0) / todayCheckIns.length
              : 0,
        },
        actions: {
          autoAssignAll: '/api/rooms/bulk-assign',
          massCheckIn: '/api/bookings/bulk-checkin',
          optimizeRemaining: '/api/bookings/yield/optimize-checkins',
        },
        realTimeTracking: {
          enabled: realTime === 'true',
          preparationAlerts: true,
          occupancyTracking: !!hotelId,
          yieldTracking: includeYieldData === 'true',
        },
      },
    });
  } catch (error) {
    console.error('Erreur check-ins du jour:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
    });
  }
};

/**
 * ================================
 * HELPER FUNCTIONS FOR YIELD MANAGEMENT
 * ================================
 */

/**
 * Calculate average yield multiplier from stats
 */
const calculateAverageYieldMultiplier = (statusStats) => {
  const totalBookings = statusStats.reduce((sum, stat) => sum + stat.count, 0);
  if (totalBookings === 0) return 1.0;

  const weightedSum = statusStats.reduce(
    (sum, stat) => sum + (stat.avgYieldMultiplier || 1.0) * stat.count,
    0
  );

  return Math.round((weightedSum / totalBookings) * 100) / 100;
};

/**
 * Get current demand level for hotel
 */
const getCurrentDemandLevel = async (hotelId) => {
  try {
    if (!hotelId) return 'NORMAL';

    const occupancy = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);
    const occupancyRate = occupancy.occupancyRate;

    if (occupancyRate >= 90) return 'VERY_HIGH';
    if (occupancyRate >= 75) return 'HIGH';
    if (occupancyRate >= 50) return 'NORMAL';
    if (occupancyRate >= 25) return 'LOW';
    return 'VERY_LOW';
  } catch (error) {
    console.error('Error getting demand level:', error);
    return 'NORMAL';
  }
};

/**
 * Calculate average discount from yield pricing details
 */
const calculateAverageDiscount = (yieldPricingDetails) => {
  if (!yieldPricingDetails || yieldPricingDetails.length === 0) return 0;

  const totalDiscount = yieldPricingDetails.reduce((sum, detail) => {
    const discount = detail.basePrice - detail.finalPrice;
    return sum + (discount > 0 ? discount : 0);
  }, 0);

  const totalBase = yieldPricingDetails.reduce((sum, detail) => sum + detail.basePrice, 0);

  return totalBase > 0 ? Math.round((totalDiscount / totalBase) * 100) : 0;
};

/**
 * Calculate savings from yield pricing
 */
const calculateSavings = (yieldPricingDetails, nightsCount) => {
  if (!yieldPricingDetails || yieldPricingDetails.length === 0) return 0;

  const baseTotalPrice = yieldPricingDetails.reduce(
    (sum, detail) => sum + detail.basePrice * detail.quantity * nightsCount,
    0
  );

  const finalTotalPrice = yieldPricingDetails.reduce(
    (sum, detail) => sum + detail.finalPrice * detail.quantity * nightsCount,
    0
  );

  return Math.max(0, baseTotalPrice - finalTotalPrice);
};

/**
 * Determine pricing trend based on occupancy
 */
const determinePricingTrend = (occupancyRate) => {
  if (occupancyRate >= 85) return 'INCREASING';
  if (occupancyRate >= 70) return 'STABLE_HIGH';
  if (occupancyRate >= 50) return 'STABLE';
  if (occupancyRate >= 30) return 'STABLE_LOW';
  return 'DECREASING';
};

/**
 * Calculate price elasticity for booking
 */
const calculatePriceElasticity = (booking) => {
  if (!booking.yieldManagement?.pricingDetails) return 1.0;

  const priceDetail = booking.yieldManagement.pricingDetails[0];
  if (!priceDetail || priceDetail.basePrice === priceDetail.dynamicPrice) return 1.0;

  const priceChange = (priceDetail.dynamicPrice - priceDetail.basePrice) / priceDetail.basePrice;
  // Simplified elasticity calculation - would be more complex with demand data
  return Math.abs(priceChange) > 0.1 ? 0.8 : 1.2;
};

/**
 * Calculate booking's contribution to RevPAR
 */
const calculateBookingRevPARContribution = (booking) => {
  const nightsCount = Math.ceil(
    (booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24)
  );
  const roomNights = booking.rooms.length * nightsCount;
  return booking.totalPrice / roomNights;
};

/**
 * Get yield validation recommendation
 */
const getYieldValidationRecommendation = (booking, demandAnalysis, strategy) => {
  const currentDemand = demandAnalysis.currentDemandLevel || 'NORMAL';
  const revenueValue = booking.totalPrice;
  const leadTime = Math.ceil((booking.checkInDate - new Date()) / (1000 * 60 * 60 * 24));

  let recommendation = 'APPROVE';
  let confidence = 70;
  let reason = 'Standard validation';
  let suggestedPriceAdjustment = 0;

  // High-value bookings should be prioritized
  if (revenueValue > 1500) {
    confidence = 90;
    reason = 'High-value booking - prioritize approval';
  }

  // Adjust based on demand and lead time
  if (currentDemand === 'HIGH' || currentDemand === 'VERY_HIGH') {
    if (leadTime <= 7) {
      suggestedPriceAdjustment = 10; // Suggest 10% increase
      reason = 'High demand + short lead time - consider price increase';
    }
    confidence += 10;
  }

  if (currentDemand === 'LOW' || currentDemand === 'VERY_LOW') {
    if (revenueValue < 500) {
      recommendation = 'REVIEW';
      confidence = 50;
      reason = 'Low demand + low value - review necessity';
    }
  }

  return {
    recommendation,
    confidence,
    reason,
    demandLevel: currentDemand,
    suggestedPriceAdjustment,
    factors: {
      revenueValue,
      leadTime,
      currentDemand,
      strategy,
    },
  };
};

/**
 * Calculate yield performance score
 */
const calculateYieldPerformance = (booking) => {
  if (!booking.yieldManagement?.enabled) return 50;

  let score = 50;
  const pricing = booking.yieldManagement.pricingDetails?.[0];

  if (pricing) {
    // Score based on price optimization
    if (pricing.dynamicPrice > pricing.basePrice) {
      score += 20; // Positive for revenue increase
    }

    // Score based on demand alignment
    const demandLevel = booking.yieldManagement.demandLevel;
    if (demandLevel === 'HIGH' || demandLevel === 'VERY_HIGH') {
      score += 15;
    }

    // Score based on booking timing
    const leadTime = Math.ceil((booking.checkInDate - booking.createdAt) / (1000 * 60 * 60 * 24));
    if (leadTime <= 7) score += 10; // Last-minute bookings
    if (leadTime > 30) score += 5; // Early bookings
  }

  return Math.min(100, Math.max(0, score));
};

/**
 * Calculate final yield score after checkout
 */
const calculateFinalYieldScore = (booking) => {
  let score = calculateYieldPerformance(booking);

  // Adjust based on actual performance
  if (booking.actualStayDuration === booking.numberOfNights) {
    score += 5; // No early checkout
  }

  if (booking.extrasTotal > 0) {
    score += 10; // Additional revenue from extras
  }

  return Math.min(100, score);
};

/**
 * Generate post-stay recommendations
 */
const generatePostStayRecommendations = (booking) => {
  const recommendations = [];

  if (!booking.yieldManagement?.enabled) {
    recommendations.push({
      type: 'YIELD_ADOPTION',
      message: 'Consider enabling yield management for this room type',
      priority: 'MEDIUM',
    });
  }

  if (booking.extrasTotal === 0) {
    recommendations.push({
      type: 'UPSELL_OPPORTUNITY',
      message: 'Guest did not purchase extras - review upselling strategies',
      priority: 'LOW',
    });
  }

  const yieldScore = calculateFinalYieldScore(booking);
  if (yieldScore < 60) {
    recommendations.push({
      type: 'YIELD_OPTIMIZATION',
      message: 'Low yield performance - review pricing strategy',
      priority: 'HIGH',
    });
  }

  return recommendations;
};

/**
 * Calculate rebooking probability
 */
const calculateRebookingProbability = (daysUntilCheckIn) => {
  if (daysUntilCheckIn <= 1) return 0.1;
  if (daysUntilCheckIn <= 3) return 0.3;
  if (daysUntilCheckIn <= 7) return 0.6;
  if (daysUntilCheckIn <= 14) return 0.8;
  return 0.9;
};

/**
 * Generate cancellation recommendation
 */
const generateCancellationRecommendation = (
  daysUntilCheckIn,
  rebookingProbability,
  currentDemand
) => {
  if (rebookingProbability > 0.7 && (currentDemand === 'HIGH' || currentDemand === 'VERY_HIGH')) {
    return {
      action: 'PROMOTE_AVAILABILITY',
      reason: 'High rebooking probability with strong demand',
      urgency: 'HIGH',
    };
  }

  if (rebookingProbability < 0.3) {
    return {
      action: 'OFFER_INCENTIVE',
      reason: 'Low rebooking probability - consider promotional pricing',
      urgency: 'MEDIUM',
    };
  }

  return {
    action: 'MONITOR',
    reason: 'Standard rebooking probability',
    urgency: 'LOW',
  };
};

/**
 * Calculate business impact of booking
 */
const calculateBusinessImpact = (booking) => {
  const revenueValue = booking.totalPrice;
  const roomNights =
    booking.rooms.length *
    Math.ceil((booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24));

  if (revenueValue > 2000 || roomNights > 10) return 'HIGH';
  if (revenueValue > 1000 || roomNights > 5) return 'MEDIUM';
  return 'LOW';
};

/**
 * Generate invoice with yield data
 */
const generateInvoiceWithYieldData = async (booking, includeYieldData = false) => {
  const baseInvoice = await generateInvoiceData(booking);

  if (!includeYieldData || !booking.yieldManagement?.enabled) {
    return baseInvoice;
  }

  // Add yield management section
  baseInvoice.yieldManagement = {
    enabled: true,
    strategy: booking.yieldManagement.strategy,
    demandLevel: booking.yieldManagement.demandLevel,
    priceOptimization: {
      basePrice: booking.yieldManagement.pricingDetails?.[0]?.basePrice,
      optimizedPrice: booking.yieldManagement.pricingDetails?.[0]?.dynamicPrice,
      optimization:
        booking.yieldManagement.pricingDetails?.[0]?.dynamicPrice >
        booking.yieldManagement.pricingDetails?.[0]?.basePrice
          ? 'INCREASED'
          : 'STANDARD',
    },
    performanceScore:
      booking.yieldManagement.checkOutData?.yieldPerformanceScore ||
      calculateYieldPerformance(booking),
  };

  return baseInvoice;
};

/**
 * Generate yield action items
 */
const generateYieldActionItems = (recommendations, demandAnalysis, yieldPerformance) => {
  const actionItems = [];

  if (recommendations.suggestions?.length > 0) {
    actionItems.push({
      type: 'PRICING_OPTIMIZATION',
      priority: 'HIGH',
      action: 'Review and apply pricing recommendations',
      impact: 'Revenue increase potential',
    });
  }

  if (demandAnalysis.trend === 'INCREASING') {
    actionItems.push({
      type: 'DEMAND_MONITORING',
      priority: 'MEDIUM',
      action: 'Monitor demand surge and adjust pricing accordingly',
      impact: 'Maximize revenue during high demand',
    });
  }

  if (yieldPerformance.averageYieldScore < 60) {
    actionItems.push({
      type: 'STRATEGY_REVIEW',
      priority: 'HIGH',
      action: 'Review yield management strategy effectiveness',
      impact: 'Improve overall yield performance',
    });
  }

  return actionItems;
};

/**
 * Generate yield insights
 */
const generateYieldInsights = (performanceData, overallMetrics, revenueOptimization) => {
  const insights = [];

  if (revenueOptimization > 10) {
    insights.push({
      type: 'SUCCESS',
      message: `Yield management increased revenue by ${revenueOptimization.toFixed(1)}%`,
      impact: 'HIGH',
    });
  }

  if (overallMetrics.avgYieldScore < 60) {
    insights.push({
      type: 'WARNING',
      message: 'Below-average yield performance detected',
      recommendation: 'Review pricing strategy and demand forecasting',
      impact: 'MEDIUM',
    });
  }

  const optimizationRate =
    overallMetrics.totalBookings > 0
      ? (overallMetrics.optimizedBookings / overallMetrics.totalBookings) * 100
      : 0;

  if (optimizationRate < 50) {
    insights.push({
      type: 'OPPORTUNITY',
      message: `Only ${optimizationRate.toFixed(1)}% of bookings are yield-optimized`,
      recommendation: 'Increase yield management adoption',
      impact: 'HIGH',
    });
  }

  return insights;
};

/**
 * Calculate revenue contribution
 */
const calculateRevenueContribution = (booking) => {
  const nightsCount = Math.ceil(
    (booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24)
  );
  const roomNights = booking.rooms.length * nightsCount;

  return {
    totalRevenue: booking.totalPrice,
    revenuePerNight: booking.totalPrice / nightsCount,
    revenuePerRoom: booking.totalPrice / booking.rooms.length,
    revPARContribution: booking.totalPrice / roomNights,
  };
};

/**
 * ================================
 * KEEP ALL EXISTING HELPER FUNCTIONS FROM ORIGINAL CODE
 * ================================
 */

// [Previous helper functions remain unchanged: createCustomerAccount, generateInvoiceData,
// recalculateBookingPrice, getAvailableActions, generateCancellationPolicy,
// extractSeasonalPeriods, scheduleBookingNotifications, etc.]

/**
 * Crée un compte client pour réservation à la réception
 */
const createCustomerAccount = async (customerInfo, session) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    address,
    temporaryPassword = 'temp123',
  } = customerInfo;

  const User = require('../models/User');

  const newUser = new User({
    firstName,
    lastName,
    email,
    phone,
    address,
    password: temporaryPassword, // Sera hashé par le middleware
    role: USER_ROLES.CLIENT,
    isTemporaryAccount: true,
    mustChangePassword: true,
    createdAt: new Date(),
  });

  return await newUser.save({ session });
};

/**
 * Génère les données structurées de facture
 */
const generateInvoiceData = async (booking) => {
  const nightsCount = Math.ceil(
    (booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24)
  );

  return {
    invoiceNumber: `INV-${booking._id.toString().slice(-8).toUpperCase()}`,
    issueDate: new Date(),

    // Informations hôtel
    hotel: {
      name: booking.hotel.name,
      code: booking.hotel.code,
      address: booking.hotel.address,
      city: booking.hotel.city,
      phone: booking.hotel.phone,
      email: booking.hotel.email,
    },

    // Informations client
    customer: {
      name: `${booking.customer.firstName} ${booking.customer.lastName}`,
      email: booking.customer.email,
      phone: booking.customer.phone,
      address: booking.customer.address,
      clientType: booking.clientType,
    },

    // Détails séjour
    stay: {
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      actualCheckInDate: booking.actualCheckInDate,
      actualCheckOutDate: booking.actualCheckOutDate,
      nightsCount,
      actualStayDuration: booking.actualStayDuration || nightsCount,
      numberOfGuests: booking.numberOfGuests,
    },

    // Détail chambres
    rooms: booking.rooms.map((room) => ({
      type: room.type,
      roomNumber: room.room?.number || 'Non assignée',
      basePrice: room.basePrice,
      calculatedPrice: room.calculatedPrice,
      nights: nightsCount,
      total: room.calculatedPrice,
    })),

    // Extras et services
    extras: (booking.extras || []).map((extra) => ({
      name: extra.name,
      category: extra.category,
      price: extra.price,
      quantity: extra.quantity,
      total: extra.total,
      addedAt: extra.addedAt,
    })),

    // Totaux
    totals: {
      roomsSubtotal: booking.totalPrice - (booking.extrasTotal || 0),
      extrasSubtotal: booking.extrasTotal || 0,
      subtotal: booking.totalPrice,
      taxes: 0, // TODO: Implémenter calcul taxes
      total: booking.totalPrice,
      currency: 'EUR',
    },

    // Informations paiement
    payment: {
      status: booking.paymentStatus,
      method: booking.paymentMethod || 'À définir',
      paidAt: booking.paidAt,
    },

    // Métadonnées
    metadata: {
      bookingId: booking._id,
      source: booking.source,
      generatedAt: new Date(),
      generatedBy: 'Système',
    },
  };
};

// [Continue with remaining helper functions...]

/**
 * Recalcule le prix d'une réservation avec les tarifs actuels
 */
const recalculateBookingPrice = async (booking) => {
  const hotel = await Hotel.findById(booking.hotel).select('category seasonalPricing');

  let newTotalPrice = 0;

  for (const roomBooking of booking.rooms) {
    const roomPrice = calculateBookingPrice({
      basePrice: roomBooking.basePrice,
      roomType: roomBooking.type,
      hotelCategory: hotel.category,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      numberOfRooms: 1,
      customSeasonalPeriods: hotel.seasonalPricing
        ? extractSeasonalPeriods(hotel.seasonalPricing)
        : null,
    });

    newTotalPrice += roomPrice.totalPrice;
  }

  return {
    totalPrice: newTotalPrice + (booking.extrasTotal || 0),
    breakdown: {
      roomsTotal: newTotalPrice,
      extrasTotal: booking.extrasTotal || 0,
      numberOfRooms: booking.rooms.length,
    },
  };
};

/**
 * Détermine les actions disponibles selon le statut et le rôle
 */
const getAvailableActions = (booking, userRole) => {
  const actions = [];

  // Actions communes selon statut
  switch (booking.status) {
    case BOOKING_STATUS.PENDING:
      if (userRole === USER_ROLES.ADMIN) {
        actions.push('validate', 'reject', 'modify', 'yield_optimize');
      }
      if (userRole === USER_ROLES.CLIENT) {
        actions.push('cancel', 'modify');
      }
      break;

    case BOOKING_STATUS.CONFIRMED:
      if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(userRole)) {
        actions.push('checkin', 'cancel', 'yield_analyze');
      }
      if (userRole === USER_ROLES.CLIENT) {
        actions.push('cancel', 'view');
      }
      break;

    case BOOKING_STATUS.CHECKED_IN:
      if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(userRole)) {
        actions.push('checkout', 'add_extras');
      }
      if (userRole === USER_ROLES.CLIENT) {
        actions.push('view', 'request_service');
      }
      break;

    case BOOKING_STATUS.COMPLETED:
      actions.push('view_invoice');
      if (userRole === USER_ROLES.ADMIN) {
        actions.push('refund', 'modify_invoice', 'yield_performance');
      }
      break;

    default:
      actions.push('view');
  }

  return actions;
};

/**
 * Génère une politique d'annulation pour un hôtel/date
 */
const generateCancellationPolicy = async (hotel, checkInDate) => {
  return {
    freeUntil: BUSINESS_RULES.FREE_CANCELLATION_HOURS,
    policies: [
      {
        hoursBeforeCheckIn: BUSINESS_RULES.FREE_CANCELLATION_HOURS,
        refundPercentage: 100,
        description: 'Annulation gratuite',
      },
      {
        hoursBeforeCheckIn: 12,
        refundPercentage: 50,
        description: 'Annulation tardive - 50% remboursé',
      },
      {
        hoursBeforeCheckIn: 0,
        refundPercentage: 0,
        description: 'Annulation le jour même - aucun remboursement',
      },
    ],
  };
};

/**
 * Extrait les périodes saisonnières depuis la config hôtel
 */
const extractSeasonalPeriods = (seasonalPricing) => {
  // TODO: Implémenter logique pour convertir seasonalPricing en périodes
  // Pour l'instant, retourner null pour utiliser les périodes par défaut
  return null;
};

/**
 * Programme les notifications pour une réservation
 */
const scheduleBookingNotifications = async (bookingId) => {
  // TODO: Implémenter système de notifications différées
  console.log(`Notifications programmées pour réservation ${bookingId}`);

  try {
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email phone')
      .populate('hotel', 'name');

    if (booking) {
      // Schedule check-in reminder
      setTimeout(
        async () => {
          const reminderData = {
            bookingId: booking._id,
            customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
            hotelName: booking.hotel.name,
            checkInDate: booking.checkInDate,
            reminderType: 'check-in-24h',
          };

          socketService.sendUserNotification(booking.customer._id, 'CHECK_IN_REMINDER', {
            ...reminderData,
            message: 'Votre check-in est prévu dans 24h!',
            preparationTips: [
              "Préparez vos documents d'identité",
              "Vérifiez votre heure d'arrivée",
              'Contactez-nous pour toute demande spéciale',
            ],
          });

          // Notify hotel staff
          socketService.sendHotelNotification(booking.hotel._id, 'GUEST_ARRIVING_TOMORROW', {
            ...reminderData,
            roomPreparation: 'Préparer les chambres',
            specialRequests: booking.specialRequests,
          });
        },
        Math.max(0, new Date(booking.checkInDate).getTime() - Date.now() - 24 * 60 * 60 * 1000)
      );
    }
  } catch (error) {
    console.error('Error scheduling real-time notifications:', error);
  }
};

/**
 * Programme notification de validation
 */
const scheduleValidationNotification = async (bookingId, action) => {
  console.log(`Notification ${action} programmée pour réservation ${bookingId}`);

  try {
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email phone')
      .populate('hotel', 'name');

    if (booking) {
      const notificationData = {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        action,
        timestamp: new Date(),
      };

      if (action === 'approve') {
        // Send immediate approval notifications
        await Promise.all([
          emailService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          smsService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
        ]);

        socketService.sendUserNotification(booking.customer._id, 'BOOKING_CONFIRMED_IMMEDIATE', {
          ...notificationData,
          message: "Votre réservation vient d'être confirmée!",
          nextSteps: {
            preparation: 'Préparez votre voyage',
            contact: "L'hôtel vous contactera si nécessaire",
            checkIn: `Check-in prévu le ${booking.checkInDate.toLocaleDateString()}`,
          },
        });
      } else {
        await emailService.sendBookingStatusUpdate(
          booking,
          booking.customer,
          booking.hotel,
          'REJECTED'
        );

        socketService.sendUserNotification(booking.customer._id, 'BOOKING_REJECTED_IMMEDIATE', {
          ...notificationData,
          message: 'Votre réservation a été refusée',
          alternatives: "Essayez d'autres dates ou hôtels",
        });
      }
    }
  } catch (error) {
    console.error('Error sending validation notifications:', error);
  }
};

/**
 * Génère la facture complète (PDF + données)
 */
const generateInvoice = async (booking) => {
  const invoiceData = await generateInvoiceData(booking);

  socketService.sendBookingNotification(booking._id, 'INVOICE_GENERATED', {
    bookingId: booking._id,
    invoiceNumber: invoiceData.invoiceNumber,
    totalAmount: invoiceData.totals.total,
    generatedAt: new Date(),
  });

  return {
    ...invoiceData,
    formats: {
      json: invoiceData,
      pdf: null, // TODO: Générer PDF avec puppeteer
      downloadUrl: `/api/bookings/${booking._id}/invoice?format=pdf`,
    },
  };
};

/**
 * Enhanced comprehensive notifications with yield data
 */
const sendComprehensiveNotifications = async (booking, action, context = {}) => {
  try {
    // Prepare enhanced notification data with yield information
    const notificationData = {
      bookingId: booking._id,
      hotelName: booking.hotel.name || 'Hotel',
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      status: booking.status,
      action,
      timestamp: new Date(),
      realTimeTracking: true,
      yieldData: context.yieldTracking
        ? {
            enabled: booking.yieldManagement?.enabled,
            demandLevel: booking.yieldManagement?.demandLevel,
            performanceScore:
              booking.yieldManagement?.checkInData?.yieldPerformanceScore ||
              booking.yieldManagement?.checkOutData?.yieldPerformanceScore,
          }
        : null,
      ...context,
    };

    // Enhanced notification sending based on action
    switch (action) {
      case 'CREATED':
        await Promise.all([
          emailService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          smsService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          broadcastBookingEvent('BOOKING_CREATED', booking, notificationData),
        ]);
        break;

      case 'CONFIRMED':
        await Promise.all([
          emailService.sendBookingStatusUpdate(
            booking,
            booking.customer,
            booking.hotel,
            'CONFIRMED'
          ),
          smsService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'CONFIRMED'),
          broadcastBookingEvent('BOOKING_CONFIRMED', booking, notificationData),
        ]);
        break;

      case 'CHECKED_IN':
        await Promise.all([
          smsService.sendCheckInInstructions(
            booking,
            booking.customer,
            booking.hotel,
            context.roomNumber
          ),
          broadcastBookingEvent('GUEST_CHECKED_IN', booking, notificationData),
        ]);
        break;

      case 'CHECKED_OUT':
        await Promise.all([
          emailService.sendBookingStatusUpdate(
            booking,
            booking.customer,
            booking.hotel,
            'COMPLETED',
            context.reason
          ),
          broadcastBookingEvent('GUEST_CHECKED_OUT', booking, notificationData),
        ]);
        break;

      case 'CANCELLED':
        await Promise.all([
          emailService.sendBookingStatusUpdate(
            booking,
            booking.customer,
            booking.hotel,
            'CANCELLED',
            context.reason
          ),
          broadcastBookingEvent('BOOKING_CANCELLED', booking, notificationData),
        ]);
        break;
    }
  } catch (error) {
    console.error('Error sending comprehensive notifications:', error);
  }
};

/**
 * ================================
 * EXPORTS - ENHANCED WITH YIELD MANAGEMENT
 * ================================
 */
module.exports = {
  // CRUD principal
  createBooking,
  getBookings,
  getBookingById,
  updateBooking,

  // Workflow management
  validateBooking,
  checkInBooking,
  checkOutBooking,
  cancelBooking,

  // Extras et services
  addBookingExtras,

  // Factures et rapports
  getBookingInvoice,

  // Statistiques
  getBookingStats,

  // Routes spécialisées staff
  getPendingBookings,
  getTodayCheckIns,

  // NEW: Yield Management endpoints
  getYieldRecommendations,
  optimizeBookingYield,
  getYieldPerformance,

  // Real-time specific endpoints (existing)
  subscribeToBookingUpdates,
  getLiveAvailabilityForBooking,
  sendInstantBookingNotification,
  getRealTimeBookingAnalytics,
  getRealTimeBookingStatus,
  processBulkBookingAction,

  // Utilitaires (pour tests et intégrations)
  generateInvoiceData,
  generateInvoiceWithYieldData,
  recalculateBookingPrice,
  getAvailableActions,
  createCustomerAccount,
  sendComprehensiveNotifications,

  // Enhanced real-time utilities with yield
  broadcastBookingEvent,
  getBookingProgressPercentage,
  getNextBookingAction,
  calculateAverageProcessingTime,
  getMostActiveStatus,
  calculateConversionRate,
  calculateProjectedOccupancy,

  // NEW: Yield management utilities
  calculateAverageYieldMultiplier,
  getCurrentDemandLevel,
  calculateAverageDiscount,
  calculateSavings,
  determinePricingTrend,
  calculatePriceElasticity,
  calculateBookingRevPARContribution,
  getYieldValidationRecommendation,
  calculateYieldPerformance,
  calculateFinalYieldScore,
  generatePostStayRecommendations,
  calculateRebookingProbability,
  generateCancellationRecommendation,
  calculateBusinessImpact,
  generateYieldActionItems,
  generateYieldInsights,
  calculateRevenueContribution,
};
