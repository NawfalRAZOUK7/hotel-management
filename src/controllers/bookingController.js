/**
 * BOOKING CONTROLLER - CRUD COMPLET + WORKFLOW COMPLEXE + REAL-TIME NOTIFICATIONS
 * Gestion des réservations avec workflow métier complet et notifications temps réel
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
 */

const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');
const mongoose = require('mongoose');

// Socket.io service for real-time notifications
const socketService = require('../services/socketService'); // ALREADY PRESENT

// Email and SMS services
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');

// Real-time services
const availabilityRealtimeService = require('../services/availabilityRealtimeService');
const bookingRealtimeService = require('../services/bookingRealtimeService');

const {
  BOOKING_STATUS,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_SOURCES,
  ROOM_STATUS,
  USER_ROLES,
  CLIENT_TYPES,
  BUSINESS_RULES,
  ERROR_MESSAGES,
  canTransitionBookingStatus
} = require('../utils/constants');

const { 
  calculateBookingPrice,
  validatePrice 
} = require('../utils/pricing');

const { 
  checkAvailability,
  invalidateHotelCache,
  updateRoomAvailability,
  broadcastAvailabilityChanges
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
      ...additionalData
    };

    // Send to booking room for real-time tracking
    socketService.sendBookingNotification(booking._id, eventType, eventData);

    // Send to hotel for staff monitoring
    socketService.sendHotelNotification(
      booking.hotel._id || booking.hotel, 
      eventType, 
      eventData
    );

    // Send to customer for personal updates
    socketService.sendUserNotification(
      booking.customer._id || booking.customer,
      eventType,
      eventData
    );

    // Send to admins for critical events
    const criticalEvents = ['BOOKING_CREATED', 'BOOKING_CANCELLED', 'PAYMENT_ISSUE', 'OVERBOOKING_RISK'];
    if (criticalEvents.includes(eventType)) {
      socketService.sendAdminNotification(eventType, eventData);
    }

  } catch (error) {
    console.error('Error broadcasting booking event:', error);
  }
};

/**
 * ================================
 * CRUD OPERATIONS - CRÉATION
 * ================================
 */

/**
 * @desc    Créer une nouvelle réservation
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
      corporateDetails // Pour entreprises
    } = req.body;

    // ================================
    // VALIDATIONS PRÉLIMINAIRES
    // ================================
    
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const checkIn = new Date(checkInDate);
    const checkOut = new Date(checkOutDate);

    if (checkIn >= checkOut) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.INVALID_DATE_RANGE
      });
    }

    if (checkIn < new Date()) {
      return res.status(400).json({
        success: false,
        message: ERROR_MESSAGES.DATE_IN_PAST
      });
    }

    // Validation nombre de nuits
    const nightsCount = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));
    if (nightsCount < BUSINESS_RULES.MIN_BOOKING_NIGHTS || nightsCount > BUSINESS_RULES.MAX_BOOKING_NIGHTS) {
      return res.status(400).json({
        success: false,
        message: `Durée séjour invalide (${BUSINESS_RULES.MIN_BOOKING_NIGHTS}-${BUSINESS_RULES.MAX_BOOKING_NIGHTS} nuits)`
      });
    }

    // Validation chambres demandées
    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Au moins une chambre requise'
      });
    }

    const totalRooms = rooms.reduce((sum, room) => sum + (room.quantity || 1), 0);
    if (totalRooms > BUSINESS_RULES.MAX_ROOMS_PER_BOOKING) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${BUSINESS_RULES.MAX_ROOMS_PER_BOOKING} chambres par réservation`
      });
    }

    // ================================
    // REAL-TIME AVAILABILITY CHECK
    // ================================
    
    // Notify about booking attempt in real-time
    socketService.sendHotelNotification(hotelId, 'BOOKING_ATTEMPT', {
      checkIn,
      checkOut,
      roomsRequested: totalRooms,
      timestamp: new Date()
    });

    // ================================
    // VÉRIFICATION HÔTEL ET CUSTOMER
    // ================================
    
    const hotel = await Hotel.findById(hotelId).select('name code category');
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
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
          message: 'SIRET invalide (14 chiffres requis)'
        });
      }
    }

    await session.withTransaction(async () => {
      // ================================
      // VÉRIFICATION DISPONIBILITÉ EN TEMPS RÉEL
      // ================================
      
      const roomsToBook = [];
      let totalPrice = 0;

      // Track availability search session
      availabilityRealtimeService.trackSearchSession(req.user.id, {
        hotelId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        currency: req.body.currency || 'EUR'
      });

      for (const roomRequest of rooms) {
        const { type, quantity = 1 } = roomRequest;

        // Validation des paramètres avant l'appel
        if (!hotelId || !checkIn || !checkOut) {
            throw new Error('Paramètres manquants pour vérifier la disponibilité');
        }

        // Real-time availability check with broadcasting
        const availability = await availabilityRealtimeService.getRealTimeAvailability(
          hotelId,
          checkIn,
          checkOut,
          req.body.currency || 'EUR'
        );

        if (!availability.rooms[type] || availability.rooms[type].availableRooms < quantity) {
          // Broadcast availability issue
          socketService.sendUserNotification(req.user.id, 'AVAILABILITY_ISSUE', {
            roomType: type,
            requested: quantity,
            available: availability.rooms[type]?.availableRooms || 0,
            suggestion: 'Essayez d\'autres dates ou types de chambres'
          });

          throw new Error(`Pas assez de chambres ${type} disponibles. Demandé: ${quantity}, Disponible: ${availability.rooms[type]?.availableRooms || 0}`);
        }

        // Calculer prix pour ce type de chambre
        const roomPrice = calculateBookingPrice({
          basePrice: availability.rooms[type].currentPrice,
          roomType: type,
          hotelCategory: hotel.category,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          numberOfRooms: quantity,
          customSeasonalPeriods: hotel.seasonalPricing ? 
            extractSeasonalPeriods(hotel.seasonalPricing) : null
        });

        totalPrice += roomPrice.totalPrice;

        // Préparer les chambres pour la réservation
        for (let i = 0; i < quantity; i++) {
          roomsToBook.push({
            type,
            basePrice: availability.rooms[type].basePrice,
            calculatedPrice: roomPrice.pricePerRoom,
            room: null, // Sera assigné lors du check-in
            assignedAt: null,
            assignedBy: null
          });
        }
      }

      // ================================
      // CRÉATION RÉSERVATION AVEC REAL-TIME PROCESSING
      // ================================
      
      const bookingData = {
        hotel: hotelId,
        customer: customerId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
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
        cancellationPolicy: await generateCancellationPolicy(hotel, checkIn)
      };

      // Use real-time booking service for instant processing
      const bookingResult = await bookingRealtimeService.processBookingCreation({
        ...bookingData,
        userId: customerId,
        hotelId: hotelId
      });

      const savedBooking = bookingResult.booking || new Booking(bookingData);
      if (!bookingResult.booking) {
        await savedBooking.save({ session });
      }

      // ================================
      // REAL-TIME NOTIFICATIONS & BROADCASTING
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
        timestamp: new Date()
      };

      // Notify customer
      socketService.sendUserNotification(customerId, 'BOOKING_CREATED', {
        ...bookingEventData,
        message: 'Votre réservation a été créée avec succès!',
        nextStep: 'En attente de validation par l\'administration'
      });

      // Notify hotel staff
      socketService.sendHotelNotification(hotelId, 'NEW_BOOKING', {
        ...bookingEventData,
        requiresValidation: true,
        urgency: checkIn <= new Date(Date.now() + 24 * 60 * 60 * 1000) ? 'HIGH' : 'NORMAL'
      });

      // Notify admins
      socketService.sendAdminNotification('NEW_BOOKING_PENDING', {
        ...bookingEventData,
        awaitingValidation: true,
        createdBy: req.user.role
      });

      // Update real-time availability
      await availabilityRealtimeService.updateAvailabilityAfterBooking(
        hotelId,
        {
          checkInDate: checkIn,
          checkOutDate: checkOut,
          rooms: roomsToBook
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
        )
      });

      // ================================
      // SCHEDULE NOTIFICATIONS
      // ================================
      
      // Schedule reminder notifications
      await scheduleBookingNotifications(savedBooking._id);
      
      // Send comprehensive notifications
      await sendComprehensiveNotifications(savedBooking, 'CREATED', {
        source,
        roomTypes: [...new Set(roomsToBook.map(r => r.type))],
        nightsCount
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
            currency: 'MAD'
          },
          nextSteps: {
            awaitingValidation: true,
            estimatedValidationTime: '24h',
            cancelBeforeValidation: `/api/bookings/${savedBooking._id}/cancel`,
            trackStatus: `/api/bookings/${savedBooking._id}`
          },
          realTimeTracking: {
            enabled: true,
            bookingRoom: `booking-${savedBooking._id}`,
            hotelRoom: `hotel-${hotelId}`
          }
        }
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
            timestamp: new Date()
            });
        } catch (notificationError) {
        console.error('Failed to send error notification:', notificationError);
        }
    }
    
    if (error.message.includes('disponibles') || error.message.includes('invalide')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création'
    });
  } finally {
    await session.endSession();
  }
};

/**
 * ================================
 * CRUD OPERATIONS - LECTURE
 * ================================
 */

/**
 * @desc    Obtenir les réservations selon le rôle utilisateur
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
      realTime = false // New parameter for real-time updates
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
          message: 'ID hôtel requis pour réceptionniste'
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
        .populate('hotel', 'name code city category')
        .populate('customer', 'firstName lastName email phone')
        .populate('createdBy', 'firstName lastName role')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('-__v'),
      Booking.countDocuments(query)
    ]);

    // ================================
    // REAL-TIME SUBSCRIPTION (if requested)
    // ================================
    
    if (realTime === 'true') {
      // Subscribe user to real-time updates for these bookings
      bookings.forEach(booking => {
        socketService.sendUserNotification(req.user.id, 'SUBSCRIBE_BOOKING', {
          bookingId: booking._id,
          action: 'subscribe'
        });
      });
    }

    // ================================
    // STATISTIQUES RÉSUMÉ
    // ================================
    
    const statusStats = await Booking.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalRevenue: { $sum: '$totalPrice' }
        }
      }
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));
    const totalRevenue = statusStats.reduce((sum, stat) => sum + (stat.totalRevenue || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        bookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        },
        statistics: {
          totalBookings: totalCount,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          statusBreakdown: statusStats,
          filters: { status, hotelId, checkInDate, checkOutDate, source, clientType }
        },
        userContext: {
          role: req.user.role,
          canValidate: req.user.role === USER_ROLES.ADMIN,
          canCheckIn: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role)
        },
        realTimeEnabled: realTime === 'true'
      }
    });

  } catch (error) {
    console.error('Erreur récupération réservations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Obtenir une réservation par ID
 * @route   GET /api/bookings/:id
 * @access  Client (sa réservation) + Staff (selon permissions)
 */
const getBookingById = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeRooms = false, includePricing = false, includeHistory = false, realTime = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
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
      .populate('hotel', 'name code address city category')
      .populate('customer', 'firstName lastName email phone clientType')
      .populate('createdBy updatedBy', 'firstName lastName role')
      .populate('rooms.room', 'number type floor status');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée ou accès non autorisé'
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
        currentStatus: booking.status
      });

      // Join booking room for updates
      socketService.sendUserNotification(req.user.id, 'JOIN_BOOKING_ROOM', {
        bookingId: booking._id,
        room: `booking-${booking._id}`
      });
    }

    const responseData = { booking };

    // ================================
    // DONNÉES ADDITIONNELLES SELON PERMISSIONS
    // ================================
    
    // Inclure détails chambres si demandé (Staff uniquement)
    if (includeRooms === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      const assignedRooms = booking.rooms
        .filter(r => r.room)
        .map(r => r.room);

      responseData.roomDetails = assignedRooms;
    }

    // Inclure recalcul pricing (Staff uniquement)
    if (includePricing === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      try {
        const currentPricing = await recalculateBookingPrice(booking);
        responseData.pricingAnalysis = {
          originalPrice: booking.totalPrice,
          currentPrice: currentPricing.totalPrice,
          priceDifference: currentPricing.totalPrice - booking.totalPrice,
          priceChanged: Math.abs(currentPricing.totalPrice - booking.totalPrice) > 1,
          breakdown: currentPricing.breakdown
        };
      } catch (error) {
        responseData.pricingAnalysis = {
          error: 'Impossible de recalculer le prix'
        };
      }
    }

    // Inclure historique modifications (Staff uniquement)
    if (includeHistory === 'true' && req.user.role !== USER_ROLES.CLIENT) {
      responseData.modificationHistory = booking.statusHistory || [];
    }

    // ================================
    // ACTIONS DISPONIBLES SELON STATUT ET RÔLE
    // ================================
    
    const availableActions = getAvailableActions(booking, req.user.role);
    responseData.availableActions = availableActions;

    // ================================
    // REAL-TIME AVAILABILITY INFO
    // ================================

    // Validation avant l'appel
    if (!booking.hotel._id || !booking.checkInDate || !booking.checkOutDate) {
        throw new Error('Données de réservation incomplètes pour la validation');
    }
    
    const currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
      booking.hotel._id,
      booking.checkInDate,
      booking.checkOutDate
    );
    
    responseData.currentAvailability = {
      occupancyRate: currentAvailability.summary.occupancyRate,
      availableRooms: currentAvailability.summary.totalAvailableRooms
    };

    res.status(200).json({
      success: true,
      data: responseData,
      realTimeEnabled: realTime === 'true'
    });

  } catch (error) {
    console.error('Erreur récupération réservation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * WORKFLOW MANAGEMENT - VALIDATION ADMIN
 * ================================
 */

/**
 * @desc    Valider ou rejeter une réservation (Admin uniquement)
 * @route   PUT /api/bookings/:id/validate
 * @access  Admin uniquement
 */
const validateBooking = async (req, res) => {
  const session = await mongoose.startSession();

  try {
    const { id } = req.params;
    const { action, reason, modifications } = req.body; // action: 'approve' | 'reject'

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
      });
    }

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Action invalide. Utilisez "approve" ou "reject"'
      });
    }

    await session.withTransaction(async () => {
      const booking = await Booking.findById(id)
        .populate('hotel', 'name')
        .populate('customer', 'firstName lastName email')
        .session(session);

      if (!booking) {
        throw new Error('Réservation non trouvée');
      }

      if (booking.status !== BOOKING_STATUS.PENDING) {
        throw new Error(`Impossible de valider une réservation avec statut: ${booking.status}`);
      }

      // ================================
      // REAL-TIME VALIDATION PROCESS
      // ================================
      
      // Use real-time service for instant validation
      const validationResult = await bookingRealtimeService.handleInstantAdminAction(
        booking._id,
        action,
        req.user.id,
        reason
      );

      // Update booking status based on action
      if (action === 'approve') {
        // Re-check availability in real-time
        let currentAvailability = null;
        try {
            if (booking.hotel._id && booking.checkInDate && booking.checkOutDate) {
                const currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
                    booking.hotel._id,
                    booking.checkInDate,
                    booking.checkOutDate
                );
            }
        } catch (availabilityError) {
            console.warn('Availability service unavailable:', availabilityError.message);
            // Continuer sans bloquer la validation
        }
        
        // Check if still available
       for (const roomBooking of booking.rooms) {
         if (!currentAvailability.rooms[roomBooking.type] || 
             currentAvailability.rooms[roomBooking.type].availableRooms < 1) {
           throw new Error(`Plus de chambres ${roomBooking.type} disponibles`);
         }
       }

       // Apply modifications if requested
       if (modifications) {
         if (modifications.newPrice && modifications.newPrice !== booking.totalPrice) {
           const priceValidation = validatePrice(modifications.newPrice);
           if (!priceValidation.valid) {
             throw new Error(`Prix modifié invalide: ${priceValidation.error}`);
           }
           booking.totalPrice = modifications.newPrice;
           booking.priceModified = true;
           booking.priceModificationReason = modifications.priceReason || 'Ajustement admin';
         }
       }

       booking.status = BOOKING_STATUS.CONFIRMED;
       booking.confirmedAt = new Date();
       booking.confirmedBy = req.user.id;
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
         changedAt: new Date()
       }
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS
     // ================================
     
     const notificationData = {
       bookingId: booking._id,
       customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
       hotelName: booking.hotel.name,
       action,
       status: booking.status,
       adminId: req.user.id,
       timestamp: new Date(),
       modifications: modifications || null
     };

     if (action === 'approve') {
       // Notify customer of approval
       socketService.sendUserNotification(booking.customer._id, 'BOOKING_APPROVED', {
         ...notificationData,
         message: 'Votre réservation a été confirmée!',
         checkIn: booking.checkInDate,
         checkOut: booking.checkOutDate,
         totalAmount: booking.totalPrice,
         priceModified: booking.priceModified || false
       });

       // Notify hotel staff
       socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_CONFIRMED_ADMIN', {
         ...notificationData,
         roomTypes: [...new Set(booking.rooms.map(r => r.type))],
         roomCount: booking.rooms.length,
         preparation: 'Préparer pour l\'arrivée du client'
       });

       // Update availability in real-time
       await availabilityRealtimeService.updateAvailabilityAfterBooking(
         booking.hotel._id,
         {
           checkInDate: booking.checkInDate,
           checkOutDate: booking.checkOutDate,
           rooms: booking.rooms
         },
         'CONFIRM'
       );

       // Send comprehensive notifications
       await sendComprehensiveNotifications(booking, 'CONFIRMED', {
         adminComment: reason,
         priceModified: booking.priceModified
       });

     } else {
       // Notify customer of rejection
       socketService.sendUserNotification(booking.customer._id, 'BOOKING_REJECTED', {
         ...notificationData,
         message: 'Votre réservation a été refusée',
         reason: booking.rejectionReason,
         suggestion: 'Vous pouvez essayer d\'autres dates ou hôtels'
       });

       // Release availability
       await availabilityRealtimeService.updateAvailabilityAfterBooking(
         booking.hotel._id,
         {
           checkInDate: booking.checkInDate,
           checkOutDate: booking.checkOutDate,
           rooms: booking.rooms
         },
         'RELEASE'
       );
     }

     // Broadcast to admin dashboard
     socketService.sendAdminNotification('BOOKING_VALIDATED', {
       ...notificationData,
       validationTime: new Date() - booking.createdAt,
       impact: action === 'approve' ? 'Revenue confirmed' : 'Availability released'
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
           totalPrice: booking.totalPrice
         },
         action,
         reason,
         validatedBy: req.user.id,
         validatedAt: new Date(),
         realTimeNotifications: {
           customerNotified: true,
           hotelNotified: true,
           availabilityUpdated: true
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur validation réservation:', error);
   
   // Notify admin of validation error
   socketService.sendAdminNotification('VALIDATION_ERROR', {
     bookingId: id,
     error: error.message,
     adminId: req.user.id,
     timestamp: new Date()
   });
   
   if (error.message.includes('non trouvée') || error.message.includes('Impossible') || error.message.includes('disponibles')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de la validation'
   });
 } finally {
   await session.endSession();
 }
};

/**
* ================================
* WORKFLOW MANAGEMENT - CHECK-IN/CHECK-OUT
* ================================
*/

/**
* @desc    Effectuer le check-in d'une réservation
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
     specialServices
   } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   await session.withTransaction(async () => {
     const booking = await Booking.findById(id)
       .populate('hotel', 'name')
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
     
     // Use real-time service for instant check-in
     const checkInResult = await bookingRealtimeService.processCheckInRealtime(
       booking._id,
       req.user.id,
       roomAssignments ? roomAssignments.map(a => a.roomId) : [],
       {
         guestIds: req.body.guestIds,
         specialServices
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
             updatedAt: new Date()
           },
           { session }
         );

         // Real-time room status update
         socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
           roomId,
           roomNumber: room.number,
           newStatus: ROOM_STATUS.OCCUPIED,
           bookingId: booking._id,
           guestName: `${booking.customer.firstName} ${booking.customer.lastName}`
         });
       }
     }

     // ================================
     // UPDATE BOOKING STATUS
     // ================================
     
     booking.status = BOOKING_STATUS.CHECKED_IN;
     booking.actualCheckInDate = actualCheckInTime ? new Date(actualCheckInTime) : new Date();
     booking.checkedInBy = req.user.id;
     booking.guestNotes = guestNotes || '';
     booking.specialServices = specialServices || [];

     // Update history
     booking.statusHistory = [
       ...(booking.statusHistory || []),
       {
         previousStatus: BOOKING_STATUS.CONFIRMED,
         newStatus: BOOKING_STATUS.CHECKED_IN,
         reason: 'Check-in effectué',
         changedBy: req.user.id,
         changedAt: new Date()
       }
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS
     // ================================
     
     const checkInData = {
       bookingId: booking._id,
       customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
       hotelName: booking.hotel.name,
       roomNumbers: assignedRoomNumbers,
       checkInTime: booking.actualCheckInDate,
       checkedInBy: req.user.id,
       earlyCheckIn: booking.earlyCheckIn || false,
       specialServices: specialServices || []
     };

     // Notify customer
     socketService.sendUserNotification(booking.customer._id, 'CHECK_IN_COMPLETED', {
       ...checkInData,
       message: 'Check-in effectué avec succès!',
       roomInfo: assignedRoomNumbers.length > 0 ? `Chambre(s): ${assignedRoomNumbers.join(', ')}` : 'Chambres en cours d\'attribution',
       hotelServices: {
         wifi: 'Gratuit',
         roomService: '24/7',
         concierge: 'Disponible'
       }
     });

     // Notify hotel staff
     socketService.sendHotelNotification(booking.hotel._id, 'GUEST_CHECKED_IN', {
       ...checkInData,
       guestPreferences: booking.specialRequests,
       stayDuration: Math.ceil((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24)),
       roomsOccupied: booking.rooms.length
     });

     // Notify housekeeping
     if (assignedRoomNumbers.length > 0) {
       socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
         action: 'ROOMS_OCCUPIED',
         rooms: assignedRoomNumbers,
         guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
         specialRequests: booking.specialRequests
       });
     }

     // Update real-time occupancy
     const occupancyUpdate = await availabilityRealtimeService.getRealTimeOccupancy(booking.hotel._id);
     socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
       action: 'OCCUPANCY_CHANGED',
       occupancyRate: occupancyUpdate.occupancyRate,
       roomsOccupied: occupancyUpdate.occupiedRooms,
       timestamp: new Date()
     });

     // Send comprehensive notifications
     await sendComprehensiveNotifications(booking, 'CHECKED_IN', {
       roomNumbers: assignedRoomNumbers,
       roomNumber: assignedRoomNumbers[0]
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
             .filter(r => r.room)
             .map(r => ({ roomId: r.room, assignedAt: r.assignedAt }))
         },
         roomNumbers: assignedRoomNumbers,
         nextSteps: {
           addExtras: `/api/bookings/${booking._id}/extras`,
           checkOut: `/api/bookings/${booking._id}/checkout`,
           viewInvoice: `/api/bookings/${booking._id}/invoice`
         },
         realTimeTracking: {
           guestInHouse: true,
           roomsOccupied: assignedRoomNumbers
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur check-in:', error);
   
   // Notify error
   socketService.sendHotelNotification(req.body.hotelId || '', 'CHECK_IN_ERROR', {
     bookingId: id,
     error: error.message,
     receptionistId: req.user.id,
     timestamp: new Date()
   });
   
   if (error.message.includes('non trouvée') || error.message.includes('impossible') || error.message.includes('disponible')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors du check-in'
   });
 } finally {
   await session.endSession();
 }
};

/**
* @desc    Effectuer le check-out d'une réservation
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
     generateInvoice = true
   } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   await session.withTransaction(async () => {
     const booking = await Booking.findById(id)
       .populate('hotel', 'name code')
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
     
     // Use real-time service for instant check-out
     const checkOutResult = await bookingRealtimeService.processCheckOutRealtime(
       booking._id,
       req.user.id,
       {
         extras: finalExtras,
         paymentMethod: req.body.paymentMethod
       }
     );

     // ================================
     // ADD FINAL EXTRAS
     // ================================
     
     let finalExtrasTotal = 0;
     if (finalExtras && finalExtras.length > 0) {
       const extrasTotal = finalExtras.reduce((sum, extra) => sum + (extra.price * extra.quantity), 0);
       
       booking.extras = [...(booking.extras || []), ...finalExtras.map(extra => ({
         ...extra,
         addedAt: new Date(),
         addedBy: req.user.id
       }))];
       
       booking.totalPrice += extrasTotal;
       booking.extrasTotal = (booking.extrasTotal || 0) + extrasTotal;
       finalExtrasTotal = extrasTotal;

       // Notify extras added
       socketService.sendUserNotification(booking.customer._id, 'FINAL_EXTRAS_ADDED', {
         bookingId: booking._id,
         extras: finalExtras,
         totalAmount: extrasTotal,
         newTotal: booking.totalPrice
       });
     }

     // ================================
     // RELEASE ROOMS
     // ================================
     
     const roomsToRelease = booking.rooms.filter(r => r.room);
     const releasedRoomNumbers = [];
     
     for (const roomBooking of roomsToRelease) {
       const room = roomBooking.room;
       
       // Check room condition if provided
       const condition = roomCondition?.find(rc => rc.roomId.toString() === room._id.toString());
       
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
             maintenanceNotes: condition.notes
           })
         },
         { session }
       );
       
       releasedRoomNumbers.push({
         number: room.number,
         type: room.type,
         newStatus,
         needsMaintenance: newStatus === ROOM_STATUS.MAINTENANCE
       });

       // Real-time room status update
       socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
         roomId: room._id,
         roomNumber: room.number,
         previousStatus: ROOM_STATUS.OCCUPIED,
         newStatus,
         requiresCleaning: true,
         maintenanceRequired: newStatus === ROOM_STATUS.MAINTENANCE
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
         changedAt: new Date()
       }
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // GENERATE INVOICE
     // ================================
     
     let invoiceData = null;
     if (generateInvoice) {
       invoiceData = await generateInvoice(booking);
       
       // Notify invoice ready
       socketService.sendUserNotification(booking.customer._id, 'INVOICE_READY', {
         bookingId: booking._id,
         invoiceNumber: invoiceData.invoiceNumber,
         totalAmount: invoiceData.totals.total,
         downloadUrl: `/api/bookings/${booking._id}/invoice`
       });
     }

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS
     // ================================
     
     const checkOutData = {
       bookingId: booking._id,
       customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
       hotelName: booking.hotel.name,
       checkOutTime: booking.actualCheckOutDate,
       finalAmount: booking.totalPrice,
       stayDuration: actualStayDuration,
       roomsReleased: releasedRoomNumbers.length,
       invoiceGenerated: !!invoiceData
     };

     // Notify customer
     socketService.sendUserNotification(booking.customer._id, 'CHECK_OUT_COMPLETED', {
       ...checkOutData,
       message: 'Check-out effectué avec succès. Merci de votre visite!',
       invoice: invoiceData ? {
         number: invoiceData.invoiceNumber,
         amount: invoiceData.totals.total,
         downloadUrl: `/api/bookings/${booking._id}/invoice`
       } : null,
       feedback: 'Nous espérons vous revoir bientôt!'
     });

     // Notify hotel staff
     socketService.sendHotelNotification(booking.hotel._id, 'GUEST_CHECKED_OUT', {
       ...checkOutData,
       roomsToClean: releasedRoomNumbers.filter(r => r.newStatus === ROOM_STATUS.AVAILABLE).map(r => r.number),
       roomsNeedingMaintenance: releasedRoomNumbers.filter(r => r.needsMaintenance).map(r => r.number),
       revenue: booking.totalPrice
     });

     // Notify housekeeping
     socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
       action: 'ROOMS_NEED_CLEANING',
       rooms: releasedRoomNumbers.map(r => ({
         number: r.number,
         type: r.type,
         priority: r.needsMaintenance ? 'HIGH' : 'NORMAL',
         notes: roomCondition?.find(rc => rc.roomNumber === r.number)?.notes
       })),
       timestamp: new Date()
     });

     // Update real-time availability
     await availabilityRealtimeService.updateAvailabilityAfterBooking(
       booking.hotel._id,
       {
         checkInDate: booking.checkInDate,
         checkOutDate: booking.checkOutDate,
         rooms: booking.rooms
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
                timestamp: new Date()
            });
        } else {
            // Broadcast simple sans availability data
            socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
                action: 'ROOMS_AVAILABLE',
                roomsReleased: releasedRoomNumbers.length,
                message: `${releasedRoomNumbers.length} chambres libérées`,
                timestamp: new Date()
            });
        }
     } catch (availabilityError) {
         console.warn('Availability broadcast failed after checkout:', availabilityError.message);
         // Continuer sans bloquer le check-out
         socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
            action: 'ROOMS_AVAILABLE',
            roomsReleased: releasedRoomNumbers.length,
            message: `${releasedRoomNumbers.length} chambres libérées (availability update failed)`,
            timestamp: new Date()
         });
     }

     // Send comprehensive notifications
     await sendComprehensiveNotifications(booking, 'CHECKED_OUT', {
       finalAmount: booking.totalPrice,
       invoiceNumber: invoiceData?.invoiceNumber
     });

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
           paymentStatus: booking.paymentStatus
         },
         releasedRooms: releasedRoomNumbers,
         invoice: invoiceData,
         summary: {
           stayDuration: `${actualStayDuration} nuit(s)`,
           roomsUsed: roomsToRelease.length,
           extrasTotal: booking.extrasTotal || 0,
           finalTotal: booking.totalPrice
         },
         realTimeUpdates: {
           availabilityUpdated: true,
           housekeepingNotified: true,
           invoiceGenerated: !!invoiceData
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur check-out:', error);
   
   // Notify error
   socketService.sendHotelNotification(req.body.hotelId || '', 'CHECK_OUT_ERROR', {
     bookingId: id,
     error: error.message,
     receptionistId: req.user.id,
     timestamp: new Date()
   });
   
   if (error.message.includes('non trouvée') || error.message.includes('impossible')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors du check-out'
   });
 } finally {
   await session.endSession();
 }
};

/**
* ================================
* GESTION EXTRAS & SERVICES
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
   const { extras } = req.body; // [{ name, category, price, quantity, description }]

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   if (!extras || !Array.isArray(extras) || extras.length === 0) {
     return res.status(400).json({
       success: false,
       message: 'Au moins un extra requis'
     });
   }

   const booking = await Booking.findById(id)
     .populate('hotel', 'name')
     .populate('customer', 'firstName lastName');

   if (!booking) {
     return res.status(404).json({
       success: false,
       message: 'Réservation non trouvée'
     });
   }

   if (![BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED].includes(booking.status)) {
     return res.status(400).json({
       success: false,
       message: 'Extras possibles uniquement après check-in'
     });
   }

   // ================================
   // VALIDATION ET CALCUL EXTRAS
   // ================================
   
   let extrasTotal = 0;
   const validatedExtras = [];

   for (const extra of extras) {
     const { name, category, price, quantity = 1, description } = extra;

     if (!name || !price || price < 0) {
       return res.status(400).json({
         success: false,
         message: 'Nom et prix valides requis pour chaque extra'
       });
     }

     if (quantity < 1 || quantity > 100) {
       return res.status(400).json({
         success: false,
         message: 'Quantité invalide (1-100)'
       });
     }

     const extraTotal = price * quantity;
     extrasTotal += extraTotal;

     validatedExtras.push({
       name,
       category: category || 'Divers',
       price,
       quantity,
       description: description || '',
       total: extraTotal,
       addedAt: new Date(),
       addedBy: req.user.id
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
     timestamp: new Date()
   };

   // Notify customer
   socketService.sendUserNotification(booking.customer._id, 'EXTRAS_ADDED', {
     ...extrasData,
     message: `${validatedExtras.length} service(s) ajouté(s) à votre facture`,
     breakdown: validatedExtras.map(e => ({
       name: e.name,
       quantity: e.quantity,
       price: e.price,
       total: e.total
     }))
   });

   // Notify hotel billing
   socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_EXTRAS_ADDED', {
     ...extrasData,
     categories: [...new Set(validatedExtras.map(e => e.category))],
     impact: {
       revenueIncrease: extrasTotal,
       newTotal: booking.totalPrice
     }
   });

   // Notify receptionist who added extras
   socketService.sendUserNotification(req.user.id, 'EXTRAS_ADDED_CONFIRMATION', {
     ...extrasData,
     message: 'Extras ajoutés avec succès',
     summary: `${validatedExtras.length} extra(s) pour un total de ${extrasTotal} MAD`
   });

   // Update booking room for real-time tracking
   socketService.sendBookingNotification(booking._id, 'EXTRAS_UPDATED', {
     ...extrasData,
     action: 'EXTRAS_ADDED'
   });

   res.status(200).json({
     success: true,
     message: `${validatedExtras.length} extra(s) ajouté(s) avec succès`,
     data: {
       booking: {
         id: booking._id,
         customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
         hotel: booking.hotel.name
       },
       addedExtras: validatedExtras,
       totals: {
         extrasAdded: extrasTotal,
         currentExtrasTotal: booking.extrasTotal,
         newTotalPrice: booking.totalPrice
       },
       summary: {
         totalExtras: booking.extras.length,
         extrasValue: booking.extrasTotal
       },
       realTimeUpdate: {
         notified: true,
         timestamp: new Date()
       }
     }
   });

 } catch (error) {
   console.error('Erreur ajout extras:', error);
   
   // Notify error
   socketService.sendUserNotification(req.user.id, 'EXTRAS_ERROR', {
     bookingId: id,
     error: error.message,
     timestamp: new Date()
   });
   
   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de l\'ajout d\'extras'
   });
 }
};

/**
* ================================
* GESTION ANNULATIONS
* ================================
*/

/**
* @desc    Annuler une réservation
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
       message: 'ID réservation invalide'
     });
   }

   await session.withTransaction(async () => {
     const booking = await Booking.findById(id)
       .populate('hotel', 'name')
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
     
     // Use real-time service for instant cancellation
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
     // RELEASE ASSIGNED ROOMS
     // ================================
     
     const assignedRooms = booking.rooms.filter(r => r.room);
     if (assignedRooms.length > 0) {
       const roomIds = assignedRooms.map(r => r.room);
       await Room.updateMany(
         { _id: { $in: roomIds } },
         {
           status: ROOM_STATUS.AVAILABLE,
           currentBooking: null,
           updatedBy: req.user.id,
           updatedAt: new Date()
         },
         { session }
       );

       // Notify room status changes
       for (const roomId of roomIds) {
         socketService.sendHotelNotification(booking.hotel._id, 'ROOM_STATUS_CHANGED', {
           roomId,
           previousStatus: ROOM_STATUS.OCCUPIED,
           newStatus: ROOM_STATUS.AVAILABLE,
           reason: 'Booking cancelled'
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
         changedAt: new Date()
       }
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS
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
       timestamp: new Date()
     };

     // Notify customer
     socketService.sendUserNotification(booking.customer._id, 'BOOKING_CANCELLED', {
       ...cancellationData,
       message: 'Votre réservation a été annulée',
       refundInfo: {
         amount: booking.refundAmount,
         percentage: refundPercentage,
         processingTime: booking.refundAmount > 0 ? '5-7 jours ouvrés' : null
       }
     });

     // Notify hotel
     socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_CANCELLED_NOTIFICATION', {
       ...cancellationData,
       roomsReleased: assignedRooms.length,
       revenueImpact: -booking.totalPrice,
       availability: 'Rooms now available for rebooking'
     });

     // Notify admins for monitoring
     socketService.sendAdminNotification('BOOKING_CANCELLED', {
       ...cancellationData,
       financialImpact: {
         lostRevenue: booking.totalPrice - booking.refundAmount,
         refundAmount: booking.refundAmount
       }
     });

     // Update real-time availability
     await availabilityRealtimeService.updateAvailabilityAfterBooking(
       booking.hotel._id,
       {
         checkInDate: booking.checkInDate,
         checkOutDate: booking.checkOutDate,
         rooms: booking.rooms
       },
       'CANCEL'
     );

     // Broadcast availability change
     socketService.broadcastAvailabilityUpdate(booking.hotel._id, {
       action: 'BOOKING_CANCELLED',
       roomsAvailable: booking.rooms.length,
       dates: {
         checkIn: booking.checkInDate,
         checkOut: booking.checkOutDate
       },
       timestamp: new Date()
     });

     // Send comprehensive notifications
     await sendComprehensiveNotifications(booking, 'CANCELLED', {
       reason: booking.cancellationReason,
       refundAmount: booking.refundAmount
     });

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
           cancelledAt: booking.cancelledAt
         },
         cancellation: {
           reason: booking.cancellationReason,
           hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
           refundPolicy: {
             originalAmount: booking.totalPrice,
             refundPercentage,
             refundAmount: booking.refundAmount,
             cancellationFee
           }
         },
         releasedRooms: assignedRooms.length,
         nextSteps: {
           refundProcessing: booking.refundAmount > 0 ? 'Remboursement en cours de traitement' : 'Aucun remboursement',
           estimatedRefundTime: booking.refundAmount > 0 ? '5-7 jours ouvrés' : null
         },
         realTimeUpdates: {
           availabilityUpdated: true,
           notificationsSent: true
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur annulation réservation:', error);
   
   // Notify error
   socketService.sendUserNotification(req.user.id, 'CANCELLATION_ERROR', {
     bookingId: id,
     error: error.message,
     timestamp: new Date()
   });
   
   if (error.message.includes('non trouvée') || error.message.includes('Impossible') || error.message.includes('Accès')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de l\'annulation'
   });
 } finally {
   await session.endSession();
 }
};

/**
* ================================
* MODIFICATION RÉSERVATIONS
* ================================
*/

/**
* @desc    Modifier une réservation (dates, chambres, etc.)
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
     guestNotes
   } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   await session.withTransaction(async () => {
     const booking = await Booking.findById(id)
       .populate('hotel', 'name category')
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
       rooms: [...booking.rooms]
     };

     let recalculatePrice = false;
     const modifications = [];

     // ================================
     // REAL-TIME MODIFICATION TRACKING
     // ================================
     
     // Notify modification started
     socketService.sendBookingNotification(booking._id, 'MODIFICATION_STARTED', {
       bookingId: booking._id,
       modifiedBy: req.user.id,
       timestamp: new Date()
     });

     // ================================
     // DATE MODIFICATIONS
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

       // Validation avant modification
       if (!booking.hotel._id) {
         throw new Error('ID hôtel manquant pour vérifier la disponibilité');
       }
         
       if (!checkIn || !checkOut || checkIn >= checkOut) {
         throw new Error('Dates invalides pour la modification');
       }

       // Check availability for new dates in real-time
       const newAvailability = await availabilityRealtimeService.getRealTimeAvailability(
         booking.hotel._id,
         checkIn,
         checkOut
       );

       for (const roomBooking of booking.rooms) {
         if (!newAvailability.rooms[roomBooking.type] || 
             newAvailability.rooms[roomBooking.type].availableRooms < 1) {
           throw new Error(`Chambres ${roomBooking.type} non disponibles pour les nouvelles dates`);
         }
       }

       booking.checkInDate = checkIn;
       booking.checkOutDate = checkOut;
       recalculatePrice = true;
       
       if (originalData.checkInDate.getTime() !== checkIn.getTime()) {
         modifications.push(`Date arrivée: ${originalData.checkInDate.toLocaleDateString()} → ${checkIn.toLocaleDateString()}`);
       }
       if (originalData.checkOutDate.getTime() !== checkOut.getTime()) {
         modifications.push(`Date départ: ${originalData.checkOutDate.toLocaleDateString()} → ${checkOut.toLocaleDateString()}`);
       }
     }

     // ================================
     // ROOM MODIFICATIONS
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

           if (!roomAvailability.rooms[type] || 
               roomAvailability.rooms[type].availableRooms < quantity) {
             throw new Error(`Pas assez de chambres ${type} disponibles`);
           }

           // Add new rooms
           for (let i = 0; i < quantity; i++) {
             booking.rooms.push({
               type,
               basePrice: roomAvailability.rooms[type].currentPrice,
               calculatedPrice: 0, // Will be recalculated
               room: null,
               assignedAt: null,
               assignedBy: null
             });
           }
           
           modifications.push(`Ajout: ${quantity} chambre(s) ${type}`);

         } else if (action === 'remove') {
           // Remove rooms of specified type
           const roomsToRemove = booking.rooms.filter(r => r.type === type);
           const removeCount = Math.min(quantity, roomsToRemove.length);

           for (let i = 0; i < removeCount; i++) {
             const roomIndex = booking.rooms.findIndex(r => r.type === type);
             if (roomIndex !== -1) {
               // If room assigned, release it
               const roomToRemove = booking.rooms[roomIndex];
               if (roomToRemove.room) {
                 await Room.findByIdAndUpdate(
                   roomToRemove.room,
                   {
                     status: ROOM_STATUS.AVAILABLE,
                     currentBooking: null,
                     updatedBy: req.user.id
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
     // RECALCULATE PRICE IF NEEDED
     // ================================
     
     if (recalculatePrice) {
       let newTotalPrice = 0;

       for (const roomBooking of booking.rooms) {
         const roomPrice = calculateBookingPrice({
           basePrice: roomBooking.basePrice,
           roomType: roomBooking.type,
           hotelCategory: booking.hotel.category,
           checkInDate: booking.checkInDate,
           checkOutDate: booking.checkOutDate,
           numberOfRooms: 1
         });

         roomBooking.calculatedPrice = roomPrice.totalPrice;
         newTotalPrice += roomPrice.totalPrice;
       }

       booking.totalPrice = newTotalPrice + (booking.extrasTotal || 0);
       
       if (Math.abs(originalData.totalPrice - booking.totalPrice) > 1) {
         modifications.push(`Prix total: ${originalData.totalPrice} MAD → ${booking.totalPrice} MAD`);
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
         changedAt: new Date()
       }
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS
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
       timestamp: new Date()
     };

     // Notify customer (if not self-modification)
     if (req.user.id !== booking.customer._id.toString()) {
       socketService.sendUserNotification(booking.customer._id, 'BOOKING_MODIFIED', {
         ...modificationData,
         message: 'Votre réservation a été modifiée',
         changes: modifications
       });
     }

     // Notify hotel
     socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_MODIFIED_NOTIFICATION', {
       ...modificationData,
       impact: {
         datesChanged: newCheckInDate || newCheckOutDate,
         roomsChanged: roomModifications && roomModifications.length > 0,
         revenueImpact: booking.totalPrice - originalData.totalPrice
       }
     });

     // Notify admins if significant changes
     if (Math.abs(booking.totalPrice - originalData.totalPrice) > 500 || 
         (newCheckInDate || newCheckOutDate)) {
       socketService.sendAdminNotification('SIGNIFICANT_BOOKING_MODIFICATION', {
         ...modificationData,
         requiresReview: booking.status === BOOKING_STATUS.PENDING
       });
     }

     // Update real-time availability if dates/rooms changed
     if (newCheckInDate || newCheckOutDate || (roomModifications && roomModifications.length > 0)) {
       // Release old availability
       await availabilityRealtimeService.updateAvailabilityAfterBooking(
         booking.hotel._id,
         {
           checkInDate: originalData.checkInDate,
           checkOutDate: originalData.checkOutDate,
           rooms: originalData.rooms
         },
         'RELEASE'
       );

       // Book new availability
       await availabilityRealtimeService.updateAvailabilityAfterBooking(
         booking.hotel._id,
         {
           checkInDate: booking.checkInDate,
           checkOutDate: booking.checkOutDate,
           rooms: booking.rooms
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
           newTotalPrice: booking.totalPrice
         },
         changes: {
           modifications,
           priceChange: booking.totalPrice - originalData.totalPrice,
           modifiedBy: req.user.id,
           modifiedAt: new Date()
         },
         requiresRevalidation: booking.status === BOOKING_STATUS.PENDING && recalculatePrice,
         realTimeUpdates: {
           notificationsSent: true,
           availabilityUpdated: true
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur modification réservation:', error);
   
   // Notify error
   socketService.sendUserNotification(req.user.id, 'MODIFICATION_ERROR', {
     bookingId: id,
     error: error.message,
     timestamp: new Date()
   });
   
   if (error.message.includes('non trouvée') || error.message.includes('Accès') || error.message.includes('disponibles')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de la modification'
   });
 } finally {
   await session.endSession();
 }
};

/**
* ================================
* GÉNÉRATION FACTURES ET RAPPORTS
* ================================
*/

/**
* @desc    Générer et obtenir la facture d'une réservation
* @route   GET /api/bookings/:id/invoice
* @access  Client (sa facture) + Staff
*/
const getBookingInvoice = async (req, res) => {
 try {
   const { id } = req.params;
   const { format = 'json' } = req.query; // json | pdf

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   const booking = await Booking.findById(id)
     .populate('hotel', 'name code address city phone email')
     .populate('customer', 'firstName lastName email phone address')
     .populate('rooms.room', 'number type floor');

   if (!booking) {
     return res.status(404).json({
       success: false,
       message: 'Réservation non trouvée'
     });
   }

   // Check permissions
   if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
     return res.status(403).json({
       success: false,
       message: 'Accès non autorisé à cette facture'
     });
   }

   if (![BOOKING_STATUS.COMPLETED, BOOKING_STATUS.CHECKED_IN].includes(booking.status)) {
     return res.status(400).json({
       success: false,
       message: 'Facture disponible uniquement après check-in'
     });
   }

   // ================================
   // GENERATE INVOICE DATA
   // ================================
   
   const invoice = await generateInvoiceData(booking);

   // Notify invoice accessed
   socketService.sendBookingNotification(booking._id, 'INVOICE_ACCESSED', {
     bookingId: booking._id,
     accessedBy: req.user.id,
     format,
     timestamp: new Date()
   });

   if (format === 'pdf') {
     // TODO: Generate PDF with library like puppeteer or jsPDF
     return res.status(501).json({
       success: false,
       message: 'Génération PDF en cours d\'implémentation',
       alternative: 'Utilisez format=json pour obtenir les données'
     });
   }

   res.status(200).json({
     success: true,
     data: {
       invoice,
       downloadOptions: {
         pdf: `/api/bookings/${id}/invoice?format=pdf`,
         email: `/api/bookings/${id}/invoice/email`
       },
       realTimeTracking: {
         accessed: true,
         timestamp: new Date()
       }
     }
   });

 } catch (error) {
   console.error('Erreur génération facture:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de la génération de facture'
   });
 }
};

/**
* ================================
* STATISTIQUES ET RAPPORTS
* ================================
*/

/**
* @desc    Obtenir statistiques réservations pour dashboard
* @route   GET /api/bookings/stats/dashboard
* @access  Admin + Receptionist
*/
const getBookingStats = async (req, res) => {
 try {
   const {
     hotelId,
     period = '30d',
     groupBy = 'day',
     realTime = false
   } = req.query;

   // Permission check for receptionist
   if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel requis pour réceptionniste'
     });
   }

   // Calculate period
   const endDate = new Date();
   const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
   const days = daysMap[period] || 30;
   const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

   // Build query
   const query = {
     createdAt: { $gte: startDate, $lte: endDate }
   };

   if (hotelId) {
     query.hotel = new mongoose.Types.ObjectId(hotelId);
   }

   // ================================
   // PARALLEL STATISTICS QUERIES
   // ================================
   
   const [
     statusStats,
     revenueStats,
     sourceStats,
     trendsData,
     occupancyData
   ] = await Promise.all([
     // Status distribution
     Booking.aggregate([
       { $match: query },
       {
         $group: {
           _id: '$status',
           count: { $sum: 1 },
           totalRevenue: { $sum: '$totalPrice' },
           averageValue: { $avg: '$totalPrice' }
         }
       }
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
           averageRoomsPerBooking: { $avg: { $size: '$rooms' } }
         }
       }
     ]),

     // Source distribution
     Booking.aggregate([
       { $match: query },
       {
         $group: {
           _id: '$source',
           count: { $sum: 1 },
           revenue: { $sum: '$totalPrice' }
         }
       }
     ]),

     // Trends by period
     Booking.aggregate([
       { $match: query },
       {
         $group: {
           _id: {
             $dateToString: {
               format: groupBy === 'day' ? '%Y-%m-%d' : 
                       groupBy === 'week' ? '%Y-%U' : '%Y-%m',
               date: '$createdAt'
             }
           },
           bookings: { $sum: 1 },
           revenue: { $sum: '$totalPrice' },
           rooms: { $sum: { $size: '$rooms' } }
         }
       },
       { $sort: { _id: 1 } }
     ]),

     // Real-time occupancy if hotel specified
     hotelId ? availabilityRealtimeService.getRealTimeOccupancy(hotelId) : null
   ]);

   // ================================
  // PROCESS RESULTS
  // ================================
  
  const totalStats = revenueStats[0] || {
    totalBookings: 0,
    totalRevenue: 0,
    averageBookingValue: 0,
    totalRooms: 0,
    averageRoomsPerBooking: 0
  };

  const statusBreakdown = {};
  statusStats.forEach(stat => {
    statusBreakdown[stat._id] = {
      count: stat.count,
      revenue: Math.round(stat.totalRevenue * 100) / 100,
      averageValue: Math.round(stat.averageValue * 100) / 100,
      percentage: Math.round((stat.count / totalStats.totalBookings) * 100)
    };
  });

  const sourceBreakdown = {};
  sourceStats.forEach(stat => {
    sourceBreakdown[stat._id] = {
      count: stat.count,
      revenue: Math.round(stat.revenue * 100) / 100,
      percentage: Math.round((stat.count / totalStats.totalBookings) * 100)
    };
  });

  // ================================
  // REAL-TIME DASHBOARD UPDATES
  // ================================
  
  if (realTime === 'true') {
    // Subscribe user to real-time dashboard updates
    socketService.sendUserNotification(req.user.id, 'DASHBOARD_SUBSCRIPTION', {
      hotelId: hotelId || 'ALL',
      period,
      subscribedAt: new Date()
    });

    // Send periodic updates for live dashboard
    const liveMetrics = {
      currentOccupancy: occupancyData ? occupancyData.occupancyRate : null,
      todaysBookings: await Booking.countDocuments({
        ...query,
        createdAt: { 
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lte: new Date()
        }
      }),
      pendingValidations: await Booking.countDocuments({
        ...query,
        status: BOOKING_STATUS.PENDING
      }),
      checkinToday: await Booking.countDocuments({
        ...query,
        checkInDate: {
          $gte: new Date(new Date().setHours(0, 0, 0, 0)),
          $lt: new Date(new Date().setHours(23, 59, 59, 999))
        },
        status: BOOKING_STATUS.CONFIRMED
      })
    };

    // Broadcast live metrics if admin/hotel manager
    if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role)) {
      socketService.sendUserNotification(req.user.id, 'LIVE_DASHBOARD_METRICS', {
        metrics: liveMetrics,
        timestamp: new Date()
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
        groupBy
      },
      overview: {
        totalBookings: totalStats.totalBookings,
        totalRevenue: Math.round(totalStats.totalRevenue * 100) / 100,
        averageBookingValue: Math.round(totalStats.averageBookingValue * 100) / 100,
        totalRooms: totalStats.totalRooms,
        averageRoomsPerBooking: Math.round(totalStats.averageRoomsPerBooking * 100) / 100
      },
      breakdown: {
        byStatus: statusBreakdown,
        bySource: sourceBreakdown
      },
      trends: trendsData.map(trend => ({
        period: trend._id,
        bookings: trend.bookings,
        revenue: Math.round(trend.revenue * 100) / 100,
        rooms: trend.rooms,
        averageBookingValue: Math.round((trend.revenue / trend.bookings) * 100) / 100
      })),
      insights: {
        conversionRate: statusBreakdown[BOOKING_STATUS.CONFIRMED] ? 
          Math.round((statusBreakdown[BOOKING_STATUS.CONFIRMED].count / totalStats.totalBookings) * 100) : 0,
        cancellationRate: statusBreakdown[BOOKING_STATUS.CANCELLED] ? 
          Math.round((statusBreakdown[BOOKING_STATUS.CANCELLED].count / totalStats.totalBookings) * 100) : 0,
        completionRate: statusBreakdown[BOOKING_STATUS.COMPLETED] ? 
          Math.round((statusBreakdown[BOOKING_STATUS.COMPLETED].count / totalStats.totalBookings) * 100) : 0
      },
      realTimeData: occupancyData ? {
        currentOccupancy: occupancyData.occupancyRate,
        roomsOccupied: occupancyData.occupiedRooms,
        roomsAvailable: occupancyData.availableRooms,
        lastUpdated: new Date()
      } : null,
      realTimeEnabled: realTime === 'true'
    }
  });

} catch (error) {
  console.error('Erreur statistiques réservations:', error);
  res.status(500).json({
    success: false,
    message: 'Erreur serveur'
  });
}
};

/**
* ================================
* ROUTES SPÉCIALISÉES POUR STAFF - ENHANCED WITH REAL-TIME
* ================================
*/

/**
* @desc    Obtenir réservations en attente de validation
* @route   GET /api/bookings/pending
* @access  Admin uniquement
*/
const getPendingBookings = async (req, res) => {
 try {
   const { limit = 20, sortBy = 'createdAt', sortOrder = 'asc', realTime = false } = req.query;

   const sortOptions = {};
   sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

   const pendingBookings = await Booking.find({
     status: BOOKING_STATUS.PENDING
   })
   .populate('hotel', 'name code city')
   .populate('customer', 'firstName lastName email phone')
   .sort(sortOptions)
   .limit(parseInt(limit))
   .select('-__v');

   // Calculate processing delays
   const bookingsWithDelays = pendingBookings.map(booking => {
     const hoursWaiting = Math.round((Date.now() - booking.createdAt) / (1000 * 60 * 60));
     const priority = hoursWaiting > 48 ? 'high' : hoursWaiting > 24 ? 'medium' : 'normal';
     
     return {
       ...booking.toObject(),
       waitingTime: {
         hours: hoursWaiting,
         priority,
         urgent: hoursWaiting > 48
       }
     };
   });

   // ================================
   // REAL-TIME PENDING BOOKINGS TRACKING
   // ================================
   
   if (realTime === 'true') {
     // Subscribe admin to pending bookings updates
     socketService.sendAdminNotification('PENDING_BOOKINGS_SUBSCRIPTION', {
       adminId: req.user.id,
       totalPending: pendingBookings.length,
       urgentCount: bookingsWithDelays.filter(b => b.waitingTime.urgent).length,
       subscribedAt: new Date()
     });

     // Send real-time alerts for urgent bookings
     const urgentBookings = bookingsWithDelays.filter(b => b.waitingTime.urgent);
     if (urgentBookings.length > 0) {
       socketService.sendAdminNotification('URGENT_VALIDATIONS_REQUIRED', {
         urgentBookings: urgentBookings.map(b => ({
           id: b._id,
           customer: `${b.customer.firstName} ${b.customer.lastName}`,
           hotel: b.hotel.name,
           waitingHours: b.waitingTime.hours,
           checkInDate: b.checkInDate
         })),
         totalUrgent: urgentBookings.length,
         action: 'IMMEDIATE_ATTENTION_REQUIRED'
       });
     }
   }

   res.status(200).json({
     success: true,
     data: {
       pendingBookings: bookingsWithDelays,
       summary: {
         total: pendingBookings.length,
         urgent: bookingsWithDelays.filter(b => b.waitingTime.urgent).length,
         averageWaitTime: Math.round(
           bookingsWithDelays.reduce((sum, b) => sum + b.waitingTime.hours, 0) / 
           bookingsWithDelays.length
         ) || 0
       },
       actions: {
         validateAll: '/api/bookings/bulk-validate',
         autoValidate: '/api/bookings/auto-validate'
       },
       realTimeTracking: {
         enabled: realTime === 'true',
         alertsEnabled: true,
         urgentThreshold: '48 hours'
       }
     }
   });

 } catch (error) {
   console.error('Erreur réservations en attente:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Obtenir réservations pour check-in aujourd'hui
* @route   GET /api/bookings/checkin-today
* @access  Admin + Receptionist
*/
const getTodayCheckIns = async (req, res) => {
 try {
   const { hotelId, realTime = false } = req.query;

   // Permission check for receptionist
   if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel requis pour réceptionniste'
     });
   }

   const today = new Date();
   today.setHours(0, 0, 0, 0);
   const tomorrow = new Date(today);
   tomorrow.setDate(tomorrow.getDate() + 1);

   const query = {
     checkInDate: { $gte: today, $lt: tomorrow },
     status: BOOKING_STATUS.CONFIRMED
   };

   if (hotelId) {
     query.hotel = hotelId;
   }

   const todayCheckIns = await Booking.find(query)
     .populate('hotel', 'name code')
     .populate('customer', 'firstName lastName email phone')
     .populate('rooms.room', 'number type floor')
     .sort({ checkInDate: 1 })
     .select('-__v');

   // Analyze preparation status
   const checkInsWithStatus = todayCheckIns.map(booking => {
     const roomsAssigned = booking.rooms.filter(r => r.room).length;
     const totalRooms = booking.rooms.length;
     const readyForCheckIn = roomsAssigned === totalRooms;
     
     return {
       ...booking.toObject(),
       preparationStatus: {
         roomsAssigned,
         totalRooms,
         readyForCheckIn,
         assignmentPercentage: Math.round((roomsAssigned / totalRooms) * 100)
       }
     };
   });

   // ================================
   // REAL-TIME CHECK-IN TRACKING
   // ================================
   
   if (realTime === 'true') {
     // Subscribe to real-time check-in updates
     const subscriptionData = {
       userId: req.user.id,
       hotelId: hotelId || 'ALL',
       date: today,
       totalCheckIns: todayCheckIns.length,
       readyCount: checkInsWithStatus.filter(b => b.preparationStatus.readyForCheckIn).length
     };

     if (hotelId) {
       socketService.sendHotelNotification(hotelId, 'CHECKIN_DASHBOARD_SUBSCRIPTION', subscriptionData);
     } else {
       socketService.sendAdminNotification('CHECKIN_DASHBOARD_SUBSCRIPTION', subscriptionData);
     }

     // Send preparation alerts
     const unpreparedBookings = checkInsWithStatus.filter(b => !b.preparationStatus.readyForCheckIn);
     if (unpreparedBookings.length > 0) {
       const alertData = {
         unpreparedCount: unpreparedBookings.length,
         totalCheckIns: todayCheckIns.length,
         urgentPreparations: unpreparedBookings.map(b => ({
           bookingId: b._id,
           customer: `${b.customer.firstName} ${b.customer.lastName}`,
           roomsNeeded: b.preparationStatus.totalRooms,
           roomsAssigned: b.preparationStatus.roomsAssigned
         })),
         action: 'ROOM_ASSIGNMENT_NEEDED'
       };

       if (hotelId) {
         socketService.sendHotelNotification(hotelId, 'PREPARATION_ALERT', alertData);
       } else {
         socketService.sendAdminNotification('PREPARATION_ALERT', alertData);
       }
     }

     // Real-time occupancy update
     if (hotelId) {
       const currentOccupancy = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);
       socketService.sendHotelNotification(hotelId, 'OCCUPANCY_UPDATE', {
         currentOccupancy: currentOccupancy.occupancyRate,
         expectedOccupancy: currentOccupancy.occupancyRate + (todayCheckIns.length / currentOccupancy.totalRooms * 100),
         checkInsRemaining: todayCheckIns.length,
         timestamp: new Date()
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
         ready: checkInsWithStatus.filter(b => b.preparationStatus.readyForCheckIn).length,
         pending: checkInsWithStatus.filter(b => !b.preparationStatus.readyForCheckIn).length,
         totalGuests: todayCheckIns.reduce((sum, b) => sum + b.numberOfGuests, 0),
         totalRooms: todayCheckIns.reduce((sum, b) => sum + b.rooms.length, 0)
       },
       actions: {
         autoAssignAll: '/api/rooms/bulk-assign',
         massCheckIn: '/api/bookings/bulk-checkin'
       },
       realTimeTracking: {
         enabled: realTime === 'true',
         preparationAlerts: true,
         occupancyTracking: !!hotelId
       }
     }
   });

 } catch (error) {
   console.error('Erreur check-ins du jour:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* ================================
* NEW REAL-TIME ENDPOINTS
* ================================
*/

/**
* @desc    Get real-time booking status for live tracking
* @route   GET /api/bookings/:id/realtime-status
* @access  All authenticated users (with permission check)
*/
const getRealTimeBookingStatus = async (req, res) => {
 try {
   const { id } = req.params;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide'
     });
   }

   const booking = await Booking.findById(id)
     .populate('hotel', 'name')
     .populate('customer', 'firstName lastName')
     .populate('rooms.room', 'number status');

   if (!booking) {
     return res.status(404).json({
       success: false,
       message: 'Réservation non trouvée'
     });
   }

   // Permission check
   if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
     return res.status(403).json({
       success: false,
       message: 'Accès non autorisé'
     });
   }

   // Initialize status details without availability first
   const statusDetails = {
     currentStatus: booking.status,
     lastUpdated: booking.updatedAt,
     progressPercentage: getBookingProgressPercentage(booking.status),
     nextAction: getNextBookingAction(booking.status, req.user.role),
     roomsAssigned: booking.rooms.filter(r => r.room).length,
     totalRooms: booking.rooms.length,
     timeUntilCheckIn: booking.checkInDate > new Date() ? 
       Math.ceil((booking.checkInDate - new Date()) / (1000 * 60 * 60 * 24)) : 0,
     availabilityImpact: {
       hotelOccupancy: 0,
       roomTypeAvailability: [],
       error: null
     }
   };

   // Safe getting real-time availability for the booking dates
   try {
    if (booking.hotel._id && booking.checkInDate && booking.checkOutDate) {
        const currentAvailability = await availabilityRealtimeService.getRealTimeAvailability(
            booking.hotel._id,
            booking.checkInDate,
            booking.checkOutDate
        );

        if (currentAvailability && currentAvailability.summary && currentAvailability.rooms) {
            statusDetails.availabilityImpact = {
                hotelOccupancy: currentAvailability.summary.occupancyRate || 0,
                roomTypeAvailability: booking.rooms.map(r => ({
                    type: r.type,
                    availableRooms: currentAvailability.rooms[r.type]?.availableRooms || 0
                })),
                lastUpdated: new Date(),
                error: null
            };
        } else {
            statusDetails.availabilityImpact.error = 'Availability data incomplete';
        }
    } else {
        statusDetails.availabilityImpact.error = 'Missing booking data for availability check';
    }
   } catch (availabilityError) {
     console.warn('Availability service unavailable for status:', availabilityError);
     statusDetails.availabilityImpact = {
        hotelOccupancy: 0,
        roomTypeAvailability: [],
        error: 'Service temporarily unavailable',
        lastUpdated: new Date()
     };
   }

   // Subscribe to real-time updates
   socketService.sendUserNotification(req.user.id, 'BOOKING_REALTIME_SUBSCRIPTION', {
     bookingId: booking._id,
     status: booking.status,
     subscribedAt: new Date()
   });

   res.status(200).json({
     success: true,
     data: {
       bookingId: booking._id,
       customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
       hotel: booking.hotel.name,
       statusDetails,
       realTimeData: {
         subscribed: true,
         lastSync: new Date(),
         updateFrequency: 'immediate'
       }
     }
   });

 } catch (error) {
   console.error('Erreur statut temps réel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Process bulk booking actions with real-time updates
* @route   POST /api/bookings/bulk-action
* @access  Admin + Receptionist
*/
const processBulkBookingAction = async (req, res) => {
 try {
   const { action, bookingIds, parameters = {} } = req.body;

   if (!action || !bookingIds || !Array.isArray(bookingIds)) {
     return res.status(400).json({
       success: false,
       message: 'Action et IDs réservations requis'
     });
   }

   const allowedActions = ['validate', 'reject', 'assign-rooms', 'send-reminders'];
   if (!allowedActions.includes(action)) {
     return res.status(400).json({
       success: false,
       message: 'Action non autorisée'
     });
   }

   // Process bookings in real-time
   const results = [];
   let processed = 0;
   const total = bookingIds.length;

   // Send initial progress update
   socketService.sendUserNotification(req.user.id, 'BULK_ACTION_STARTED', {
     action,
     total,
     processed: 0,
     startedAt: new Date()
   });

   for (const bookingId of bookingIds) {
     try {
       let result;
       
       switch (action) {
         case 'validate':
           result = await bookingRealtimeService.handleInstantAdminAction(
             bookingId, 
             'approve', 
             req.user.id,
             parameters.reason || 'Validation en lot'
           );
           break;
           
         case 'reject':
           result = await bookingRealtimeService.handleInstantAdminAction(
             bookingId, 
             'reject', 
             req.user.id,
             parameters.reason || 'Rejet en lot'
           );
           break;
           
         case 'assign-rooms':
           // Auto-assign available rooms
           result = await bookingRealtimeService.autoAssignRoomsToBooking(
             bookingId,
             req.user.id
           );
           break;
           
         case 'send-reminders':
           // Send check-in reminders
           const booking = await Booking.findById(bookingId).populate('customer hotel');
           if (booking) {
             await sendComprehensiveNotifications(booking, 'REMINDER', {
               type: 'check-in',
               scheduledBy: req.user.id
             });
             result = { success: true, action: 'reminder_sent' };
           }
           break;
       }

       results.push({
         bookingId,
         success: true,
         result
       });

     } catch (error) {
       results.push({
         bookingId,
         success: false,
         error: error.message
       });
     }

     processed++;
     
     // Send progress update every 5 bookings or at completion
     if (processed % 5 === 0 || processed === total) {
       socketService.sendUserNotification(req.user.id, 'BULK_ACTION_PROGRESS', {
         action,
         total,
         processed,
         progressPercentage: Math.round((processed / total) * 100),
         timestamp: new Date()
       });
     }
   }

   // Send completion notification
   const successCount = results.filter(r => r.success).length;
   const failureCount = results.filter(r => !r.success).length;

   socketService.sendUserNotification(req.user.id, 'BULK_ACTION_COMPLETED', {
     action,
     total,
     successful: successCount,
     failed: failureCount,
     completedAt: new Date()
   });

   // Broadcast to admin dashboard
   socketService.sendAdminNotification('BULK_ACTION_COMPLETED', {
     adminId: req.user.id,
     action,
     total,
     successful: successCount,
     failed: failureCount,
     timestamp: new Date()
   });

   res.status(200).json({
     success: true,
     message: `Action ${action} traitée sur ${bookingIds.length} réservations`,
     data: {
       action,
       summary: {
         total,
         successful: successCount,
         failed: failureCount,
         successRate: Math.round((successCount / total) * 100)
       },
       results,
       realTimeProcessing: {
         completed: true,
         notificationsSent: true
       }
     }
   });

 } catch (error) {
   console.error('Erreur action en lot:', error);
   
   // Notify error
   socketService.sendUserNotification(req.user.id, 'BULK_ACTION_ERROR', {
     action: req.body.action,
     error: error.message,
     timestamp: new Date()
   });
   
   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de l\'action en lot'
   });
 }
};

/**
* ================================
* HELPER FUNCTIONS FOR REAL-TIME FEATURES
* ================================
*/

/**
* Get booking progress percentage based on status
*/
const getBookingProgressPercentage = (status) => {
 const progressMap = {
   [BOOKING_STATUS.PENDING]: 25,
   [BOOKING_STATUS.CONFIRMED]: 50,
   [BOOKING_STATUS.CHECKED_IN]: 75,
   [BOOKING_STATUS.COMPLETED]: 100,
   [BOOKING_STATUS.CANCELLED]: 0,
   [BOOKING_STATUS.REJECTED]: 0
 };
 return progressMap[status] || 0;
};

/**
* Get next action for booking based on status and user role
*/
const getNextBookingAction = (status, userRole) => {
 const actionMap = {
   [BOOKING_STATUS.PENDING]: {
     [USER_ROLES.ADMIN]: 'Validate booking',
     [USER_ROLES.CLIENT]: 'Wait for validation',
     [USER_ROLES.RECEPTIONIST]: 'Prepare for arrival'
   },
   [BOOKING_STATUS.CONFIRMED]: {
     [USER_ROLES.ADMIN]: 'Monitor arrival',
     [USER_ROLES.CLIENT]: 'Prepare for check-in',
     [USER_ROLES.RECEPTIONIST]: 'Assign rooms & prepare check-in'
   },
   [BOOKING_STATUS.CHECKED_IN]: {
     [USER_ROLES.ADMIN]: 'Monitor stay',
     [USER_ROLES.CLIENT]: 'Enjoy your stay',
     [USER_ROLES.RECEPTIONIST]: 'Add services & prepare check-out'
   }
 };
 
 return actionMap[status]?.[userRole] || 'No action required';
};

// ================================
// KEEP ALL EXISTING HELPER FUNCTIONS FROM VERSION 1
// ================================

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
   temporaryPassword = 'temp123' 
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
   createdAt: new Date()
 });

 return await newUser.save({ session });
};

/**
* Génère les données structurées de facture
*/
const generateInvoiceData = async (booking) => {
 const nightsCount = Math.ceil((booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24));
 
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
     email: booking.hotel.email
   },
   
   // Informations client
   customer: {
     name: `${booking.customer.firstName} ${booking.customer.lastName}`,
     email: booking.customer.email,
     phone: booking.customer.phone,
     address: booking.customer.address,
     clientType: booking.clientType
   },
   
   // Détails séjour
   stay: {
     checkInDate: booking.checkInDate,
     checkOutDate: booking.checkOutDate,
     actualCheckInDate: booking.actualCheckInDate,
     actualCheckOutDate: booking.actualCheckOutDate,
     nightsCount,
     actualStayDuration: booking.actualStayDuration || nightsCount,
     numberOfGuests: booking.numberOfGuests
   },
   
   // Détail chambres
   rooms: booking.rooms.map(room => ({
     type: room.type,
     roomNumber: room.room?.number || 'Non assignée',
     basePrice: room.basePrice,
     calculatedPrice: room.calculatedPrice,
     nights: nightsCount,
     total: room.calculatedPrice
   })),
   
   // Extras et services
   extras: (booking.extras || []).map(extra => ({
     name: extra.name,
     category: extra.category,
     price: extra.price,
     quantity: extra.quantity,
     total: extra.total,
     addedAt: extra.addedAt
   })),
   
   // Totaux
   totals: {
     roomsSubtotal: booking.totalPrice - (booking.extrasTotal || 0),
     extrasSubtotal: booking.extrasTotal || 0,
     subtotal: booking.totalPrice,
     taxes: 0, // TODO: Implémenter calcul taxes
     total: booking.totalPrice,
     currency: 'MAD'
   },
   
   // Informations paiement
   payment: {
     status: booking.paymentStatus,
     method: booking.paymentMethod || 'À définir',
     paidAt: booking.paidAt
   },
   
   // Métadonnées
   metadata: {
     bookingId: booking._id,
     source: booking.source,
     generatedAt: new Date(),
     generatedBy: 'Système'
   }
 };
};

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
     customSeasonalPeriods: hotel.seasonalPricing ? 
       extractSeasonalPeriods(hotel.seasonalPricing) : null
   });
   
   newTotalPrice += roomPrice.totalPrice;
 }
 
 return {
   totalPrice: newTotalPrice + (booking.extrasTotal || 0),
   breakdown: {
     roomsTotal: newTotalPrice,
     extrasTotal: booking.extrasTotal || 0,
     numberOfRooms: booking.rooms.length
   }
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
       actions.push('validate', 'reject', 'modify');
     }
     if (userRole === USER_ROLES.CLIENT) {
       actions.push('cancel', 'modify');
     }
     break;
     
   case BOOKING_STATUS.CONFIRMED:
     if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(userRole)) {
       actions.push('checkin', 'cancel');
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
       actions.push('refund', 'modify_invoice');
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
        description: 'Annulation gratuite'
      },
      {
        hoursBeforeCheckIn: 12,
        refundPercentage: 50,
        description: 'Annulation tardive - 50% remboursé'
      },
      {
        hoursBeforeCheckIn: 0,
        refundPercentage: 0,
        description: 'Annulation le jour même - aucun remboursement'
      }
    ]
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
  // - Email confirmation création
  // - Rappel validation admin (après 24h si toujours PENDING)
  // - Rappel check-in (24h avant)
  console.log(`Notifications programmées pour réservation ${bookingId}`);
  
  // REAL-TIME ENHANCEMENT: Schedule immediate notifications
  try {
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email phone')
      .populate('hotel', 'name');
    
    if (booking) {
      // Schedule check-in reminder
      setTimeout(async () => {
        const reminderData = {
          bookingId: booking._id,
          customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
          hotelName: booking.hotel.name,
          checkInDate: booking.checkInDate,
          reminderType: 'check-in-24h'
        };
        
        socketService.sendUserNotification(booking.customer._id, 'CHECK_IN_REMINDER', {
          ...reminderData,
          message: 'Votre check-in est prévu dans 24h!',
          preparationTips: [
            'Préparez vos documents d\'identité',
            'Vérifiez votre heure d\'arrivée',
            'Contactez-nous pour toute demande spéciale'
          ]
        });
        
        // Notify hotel staff
        socketService.sendHotelNotification(booking.hotel._id, 'GUEST_ARRIVING_TOMORROW', {
          ...reminderData,
          roomPreparation: 'Préparer les chambres',
          specialRequests: booking.specialRequests
        });
      }, Math.max(0, new Date(booking.checkInDate).getTime() - Date.now() - 24 * 60 * 60 * 1000));
    }
  } catch (error) {
    console.error('Error scheduling real-time notifications:', error);
  }
};

/**
 * Programme notification de validation
 */
const scheduleValidationNotification = async (bookingId, action) => {
  // TODO: Implémenter notification email/SMS immédiate
  console.log(`Notification ${action} programmée pour réservation ${bookingId}`);
  
  // REAL-TIME ENHANCEMENT: Immediate notification dispatch
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
        timestamp: new Date()
      };
      
      if (action === 'approve') {
        // Send immediate approval notifications
        await Promise.all([
          emailService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          smsService.sendBookingConfirmation(booking, booking.customer, booking.hotel)
        ]);
        
        // Real-time notification
        socketService.sendUserNotification(booking.customer._id, 'BOOKING_CONFIRMED_IMMEDIATE', {
          ...notificationData,
          message: 'Votre réservation vient d\'être confirmée!',
          nextSteps: {
            preparation: 'Préparez votre voyage',
            contact: 'L\'hôtel vous contactera si nécessaire',
            checkIn: `Check-in prévu le ${booking.checkInDate.toLocaleDateString()}`
          }
        });
      } else {
        // Send rejection notifications
        await emailService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'REJECTED');
        
        socketService.sendUserNotification(booking.customer._id, 'BOOKING_REJECTED_IMMEDIATE', {
          ...notificationData,
          message: 'Votre réservation a été refusée',
          alternatives: 'Essayez d\'autres dates ou hôtels'
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
  
  // REAL-TIME ENHANCEMENT: Notify invoice generation
  socketService.sendBookingNotification(booking._id, 'INVOICE_GENERATED', {
    bookingId: booking._id,
    invoiceNumber: invoiceData.invoiceNumber,
    totalAmount: invoiceData.totals.total,
    generatedAt: new Date()
  });
  
  return {
    ...invoiceData,
    formats: {
      json: invoiceData,
      pdf: null, // TODO: Générer PDF avec puppeteer
      downloadUrl: `/api/bookings/${booking._id}/invoice?format=pdf`
    }
  };
};

/**
 * ================================
 * NEW REAL-TIME SPECIFIC ENDPOINTS
 * ================================
 */

/**
 * @desc    Subscribe to real-time booking updates
 * @route   POST /api/bookings/:id/subscribe
 * @access  Client (own booking) + Staff
 */
const subscribeToBookingUpdates = async (req, res) => {
  try {
    const { id } = req.params;
    const { events = [] } = req.body; // Specific events to subscribe to

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
      });
    }

    const booking = await Booking.findById(id)
      .populate('customer', 'firstName lastName')
      .populate('hotel', 'name');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    // Permission check
    if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    // Subscribe to booking room
    const subscriptionData = {
      userId: req.user.id,
      bookingId: booking._id,
      subscribedEvents: events.length > 0 ? events : 'all',
      subscribedAt: new Date(),
      userRole: req.user.role
    };

    socketService.sendBookingNotification(booking._id, 'USER_SUBSCRIBED', subscriptionData);
    
    // Send confirmation to user
    socketService.sendUserNotification(req.user.id, 'SUBSCRIPTION_CONFIRMED', {
      bookingId: booking._id,
      message: 'Vous recevrez maintenant les mises à jour en temps réel',
      currentStatus: booking.status,
      availableEvents: [
        'STATUS_CHANGED',
        'ROOM_ASSIGNED',
        'PRICE_UPDATED',
        'EXTRAS_ADDED',
        'CHECK_IN_READY',
        'INVOICE_READY'
      ]
    });

    res.status(200).json({
      success: true,
      message: 'Abonnement aux mises à jour activé',
      data: {
        bookingId: booking._id,
        subscribedEvents: subscriptionData.subscribedEvents,
        currentStatus: booking.status,
        realTimeEnabled: true
      }
    });

  } catch (error) {
    console.error('Erreur abonnement temps réel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Get live availability for booking modification
 * @route   GET /api/bookings/:id/live-availability
 * @access  Client (own booking) + Staff
 */
const getLiveAvailabilityForBooking = async (req, res) => {
  try {
    const { id } = req.params;
    const { newCheckIn, newCheckOut, roomTypes } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
      });
    }

    const booking = await Booking.findById(id).populate('hotel', 'name');
    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    // Permission check
    if (req.user.role === USER_ROLES.CLIENT && booking.customer.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé'
      });
    }

    const checkIn = newCheckIn ? new Date(newCheckIn) : booking.checkInDate;
    const checkOut = newCheckOut ? new Date(newCheckOut) : booking.checkOutDate;

    if (!booking.hotel._id) {
        return res.status(400).json({
            success: false,
            message: 'ID hôtel manquant'
        });
    }

    if (!checkIn || !checkOut) {
        return res.status(400).json({
            success: false,
            message: 'Dates de séjour requises'
        });
    }

    if (new Date(checkIn) >= new Date(checkOut)) {
        return res.status(400).json({
            success: false,
            message: 'La date d\'arrivée doit être antérieure au départ'
        });
    }

    try {
        // Get real-time availability
        const availability = await availabilityRealtimeService.getRealTimeAvailability(
            booking.hotel._id,
            checkIn,
            checkOut
        );

        if (!availability) {
            throw new Error('Service de disponibilité indisponible pour ces dates');
        }
    } catch (availabilityError) {
        console.error('Erreur disponibilité temps réel:', availabilityError);
        return res.status(503).json({
            success: false,
            message: 'Service de disponibilité temporairement indisponible',
            retry: true
        });
    }

    // Calculate modification impact
    const currentRoomTypes = booking.rooms.map(r => r.type);
    const requestedTypes = roomTypes ? roomTypes.split(',') : currentRoomTypes;
    
    const modificationAnalysis = {
      canModify: true,
      reasons: [],
      alternatives: [],
      priceImpact: 0
    };

    // Check if requested rooms are available
    for (const roomType of requestedTypes) {
      if (!availability.rooms[roomType] || availability.rooms[roomType].availableRooms < 1) {
        modificationAnalysis.canModify = false;
        modificationAnalysis.reasons.push(`Chambre ${roomType} non disponible`);
        
        // Suggest alternatives
        const availableTypes = Object.keys(availability.rooms)
          .filter(type => availability.rooms[type].availableRooms > 0);
        modificationAnalysis.alternatives.push(...availableTypes);
      }
    }

    // Real-time tracking of availability search
    socketService.sendUserNotification(req.user.id, 'AVAILABILITY_SEARCH', {
      bookingId: booking._id,
      searchParams: { checkIn, checkOut, roomTypes: requestedTypes },
      results: modificationAnalysis,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        currentBooking: {
          checkIn: booking.checkInDate,
          checkOut: booking.checkOutDate,
          rooms: currentRoomTypes
        },
        requestedModification: {
          checkIn,
          checkOut,
          roomTypes: requestedTypes
        },
        availability: availability.rooms,
        modificationAnalysis,
        realTimeData: {
          lastUpdated: new Date(),
          occupancyRate: availability.summary.occupancyRate
        }
      }
    });

  } catch (error) {
    console.error('Erreur disponibilité temps réel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Send instant notification to booking stakeholders
 * @route   POST /api/bookings/:id/notify
 * @access  Admin + Receptionist
 */
const sendInstantBookingNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, type, recipients = 'all', urgent = false } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
      });
    }

    const booking = await Booking.findById(id)
      .populate('customer', 'firstName lastName email')
      .populate('hotel', 'name');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    const notificationData = {
      bookingId: booking._id,
      message,
      type,
      urgent,
      sentBy: req.user.id,
      senderRole: req.user.role,
      timestamp: new Date(),
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name
    };

    // Send to specified recipients
    if (recipients === 'all' || recipients.includes('customer')) {
      socketService.sendUserNotification(booking.customer._id, 'INSTANT_BOOKING_MESSAGE', {
        ...notificationData,
        audience: 'customer'
      });
    }

    if (recipients === 'all' || recipients.includes('hotel')) {
      socketService.sendHotelNotification(booking.hotel._id, 'INSTANT_BOOKING_MESSAGE', {
        ...notificationData,
        audience: 'hotel_staff'
      });
    }

    if (recipients === 'all' || recipients.includes('admin')) {
      socketService.sendAdminNotification('INSTANT_BOOKING_MESSAGE', {
        ...notificationData,
        audience: 'admin'
      });
    }

    // Log notification in booking history
    booking.statusHistory = [
      ...(booking.statusHistory || []),
      {
        previousStatus: booking.status,
        newStatus: booking.status,
        reason: `Message instantané: ${message}`,
        changedBy: req.user.id,
        changedAt: new Date()
      }
    ];

    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Notification envoyée avec succès',
      data: {
        bookingId: booking._id,
        sentTo: recipients,
        notificationData,
        timestamp: new Date()
      }
    });

  } catch (error) {
    console.error('Erreur notification instantanée:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Get real-time booking analytics and metrics
 * @route   GET /api/bookings/analytics/realtime
 * @access  Admin + Receptionist
 */
const getRealTimeBookingAnalytics = async (req, res) => {
  try {
    const { hotelId, timeframe = '24h' } = req.query;

    // Permission check for receptionist
    if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis pour réceptionniste'
      });
    }

    const now = new Date();
    let startTime;
    
    switch (timeframe) {
      case '1h':
        startTime = new Date(now.getTime() - 60 * 60 * 1000);
        break;
      case '24h':
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        break;
      case '7d':
        startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      default:
        startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const query = {
      updatedAt: { $gte: startTime }
    };

    if (hotelId) {
      query.hotel = hotelId;
    }

    // Get real-time metrics
    const [
      recentBookings,
      statusChanges,
      revenueMetrics,
      occupancyData
    ] = await Promise.all([
      // Recent booking activities
      Booking.find(query)
        .populate('hotel', 'name')
        .populate('customer', 'firstName lastName')
        .sort({ updatedAt: -1 })
        .limit(50),

      // Status change frequency
      Booking.aggregate([
        { $match: query },
        { $unwind: '$statusHistory' },
        { $match: { 'statusHistory.changedAt': { $gte: startTime } } },
        {
          $group: {
            _id: {
              newStatus: '$statusHistory.newStatus',
              hour: { $hour: '$statusHistory.changedAt' }
            },
            count: { $sum: 1 }
          }
        }
      ]),

      // Revenue flow
      Booking.aggregate([
        { $match: { ...query, status: { $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.COMPLETED] } } },
        {
          $group: {
            _id: { $hour: '$updatedAt' },
            totalRevenue: { $sum: '$totalPrice' },
            bookingCount: { $sum: 1 },
            averageValue: { $avg: '$totalPrice' }
          }
        },
        { $sort: { '_id': 1 } }
      ]),

      // Current occupancy if hotel specified
      hotelId ? availabilityRealtimeService.getRealTimeOccupancy(hotelId) : null
    ]);

    // Calculate trends
    const analytics = {
      timeframe,
      period: { start: startTime, end: now },
      
      bookingActivity: {
        totalBookings: recentBookings.length,
        newBookings: recentBookings.filter(b => b.createdAt >= startTime).length,
        modifications: recentBookings.filter(b => b.updatedAt > b.createdAt).length,
        averageProcessingTime: calculateAverageProcessingTime(recentBookings)
      },

      statusActivity: {
        changes: statusChanges,
        mostActiveStatus: getMostActiveStatus(statusChanges),
        conversionRate: calculateConversionRate(statusChanges)
      },

      revenueMetrics: {
        totalRevenue: revenueMetrics.reduce((sum, metric) => sum + metric.totalRevenue, 0),
        averageBookingValue: revenueMetrics.reduce((sum, metric) => sum + metric.averageValue, 0) / Math.max(revenueMetrics.length, 1),
        hourlyBreakdown: revenueMetrics
      },

      occupancy: occupancyData ? {
        currentRate: occupancyData.occupancyRate,
        occupiedRooms: occupancyData.occupiedRooms,
        availableRooms: occupancyData.availableRooms,
        projectedRate: calculateProjectedOccupancy(occupancyData, recentBookings)
      } : null,

      realTimeMetrics: {
        lastUpdate: now,
        dataFreshness: 'live',
        updateFrequency: '30 seconds'
      }
    };

    // Subscribe to real-time analytics updates
    const subscriptionKey = hotelId ? `hotel-${hotelId}` : 'global';
    socketService.sendUserNotification(req.user.id, 'ANALYTICS_SUBSCRIPTION', {
      subscriptionKey,
      userId: req.user.id,
      timeframe,
      subscribedAt: now
    });

    // Send periodic updates
    setTimeout(() => {
      socketService.sendUserNotification(req.user.id, 'ANALYTICS_UPDATE', {
        subscriptionKey,
        metrics: analytics.realTimeMetrics,
        timestamp: new Date()
      });
    }, 30000);

    res.status(200).json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Erreur analytics temps réel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * HELPER FUNCTIONS FOR REAL-TIME ANALYTICS
 * ================================
 */

const calculateAverageProcessingTime = (bookings) => {
  const processedBookings = bookings.filter(b => 
    b.status !== BOOKING_STATUS.PENDING && b.confirmedAt
  );
  
  if (processedBookings.length === 0) return 0;
  
  const totalTime = processedBookings.reduce((sum, booking) => {
    return sum + (booking.confirmedAt - booking.createdAt);
  }, 0);
  
  return Math.round(totalTime / processedBookings.length / (1000 * 60 * 60)); // Hours
};

const getMostActiveStatus = (statusChanges) => {
  const statusCounts = {};
  statusChanges.forEach(change => {
    const status = change._id.newStatus;
    statusCounts[status] = (statusCounts[status] || 0) + change.count;
  });
  
  return Object.keys(statusCounts).reduce((a, b) => 
    statusCounts[a] > statusCounts[b] ? a : b, 
    Object.keys(statusCounts)[0]
  );
};

const calculateConversionRate = (statusChanges) => {
  const confirmedCount = statusChanges
    .filter(change => change._id.newStatus === BOOKING_STATUS.CONFIRMED)
    .reduce((sum, change) => sum + change.count, 0);
    
  const totalChanges = statusChanges.reduce((sum, change) => sum + change.count, 0);
  
  return totalChanges > 0 ? Math.round((confirmedCount / totalChanges) * 100) : 0;
};

const calculateProjectedOccupancy = (currentOccupancy, recentBookings) => {
  const confirmedBookings = recentBookings.filter(b => b.status === BOOKING_STATUS.CONFIRMED);
  const additionalRooms = confirmedBookings.reduce((sum, booking) => sum + booking.rooms.length, 0);
  
  const projectedOccupied = currentOccupancy.occupiedRooms + additionalRooms;
  const totalRooms = currentOccupancy.totalRooms || (currentOccupancy.occupiedRooms + currentOccupancy.availableRooms);
  
  return Math.min(100, Math.round((projectedOccupied / totalRooms) * 100));
};

/**
 * ================================
 * ENHANCED HELPER FUNCTIONS
 * ================================
 */

/**
 * Send comprehensive real-time notifications with enhanced features
 */
const sendComprehensiveNotifications = async (booking, action, context = {}) => {
  try {
    // Prepare enhanced notification data
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
      ...context
    };

    // Enhanced notification sending based on action
    switch (action) {
      case 'CREATED':
        await Promise.all([
          emailService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          smsService.sendBookingConfirmation(booking, booking.customer, booking.hotel),
          broadcastBookingEvent('BOOKING_CREATED', booking, notificationData)
        ]);
        
        // Schedule follow-up notifications
        setTimeout(() => {
          socketService.sendUserNotification(booking.customer._id, 'BOOKING_FOLLOW_UP', {
            ...notificationData,
            message: 'N\'oubliez pas de vérifier le statut de votre réservation',
            actionUrl: `/bookings/${booking._id}`
          });
        }, 60 * 60 * 1000); // 1 hour later
        break;

      case 'CONFIRMED':
        await Promise.all([
          emailService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'CONFIRMED'),
          smsService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'CONFIRMED'),
          broadcastBookingEvent('BOOKING_CONFIRMED', booking, notificationData)
        ]);
        
        // Send preparation reminders
        const checkInTime = new Date(booking.checkInDate).getTime();
        const reminderTime = checkInTime - (24 * 60 * 60 * 1000); // 24h before
        
        if (reminderTime > Date.now()) {
          setTimeout(async () => {
            socketService.sendUserNotification(booking.customer._id, 'PRE_CHECKIN_REMINDER', {
              ...notificationData,
              message: 'Votre check-in est demain!',
              preparationList: [
                'Vérifiez les horaires de check-in',
                'Préparez vos documents',
                'Consultez les services de l\'hôtel'
              ]
            });
          }, reminderTime - Date.now());
        }
        break;

      case 'CHECKED_IN':
        await Promise.all([
          smsService.sendCheckInInstructions(booking, booking.customer, booking.hotel, context.roomNumber),
          broadcastBookingEvent('GUEST_CHECKED_IN', booking, notificationData)
        ]);
        
        // Send welcome package info
        setTimeout(() => {
          socketService.sendUserNotification(booking.customer._id, 'WELCOME_PACKAGE', {
            ...notificationData,
            message: 'Bienvenue! Voici les informations utiles pour votre séjour',
            services: {
              wifi: 'Gratuit dans tout l\'hôtel',
              breakfast: 'Servi de 7h à 10h',
              roomService: 'Disponible 24h/24',
              concierge: 'Lobby principal'
            },
            localInfo: {
              weather: 'Consultez la météo locale',
              attractions: 'Découvrez les attractions à proximité',
              restaurants: 'Nos recommandations culinaires'
            }
          });
        }, 30 * 60 * 1000); // 30 minutes after check-in
        break;

      case 'CHECKED_OUT':
        await Promise.all([
          emailService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'COMPLETED', context.reason),
          broadcastBookingEvent('GUEST_CHECKED_OUT', booking, notificationData)
        ]);
        
        // Send feedback request
        setTimeout(() => {
          socketService.sendUserNotification(booking.customer._id, 'FEEDBACK_REQUEST', {
            ...notificationData,
            message: 'Comment s\'est passé votre séjour?',
            feedbackUrl: `/bookings/${booking._id}/feedback`,
            incentive: 'Partagez votre expérience et gagnez des points de fidélité!'
          });
        }, 60 * 60 * 1000); // 1 hour after checkout
        break;

      case 'CANCELLED':
        await Promise.all([
          emailService.sendBookingStatusUpdate(booking, booking.customer, booking.hotel, 'CANCELLED', context.reason),
          broadcastBookingEvent('BOOKING_CANCELLED', booking, notificationData)
        ]);
        
        // Send rebooking suggestions
        setTimeout(async () => {
          const suggestions = await availabilityRealtimeService.getSimilarAvailability(
            booking.hotel._id,
            booking.checkInDate,
            booking.checkOutDate,
            booking.rooms.length
          );
          
          socketService.sendUserNotification(booking.customer._id, 'REBOOKING_SUGGESTIONS', {
            ...notificationData,
            message: 'Nous avons trouvé des alternatives pour vous',
            suggestions: suggestions.slice(0, 3),
            rebookingUrl: '/search'
          });
        }, 24 * 60 * 60 * 1000); // 24 hours later
        break;

      case 'REMINDER':
        // Enhanced reminder with personalization
        const reminderContext = {
          ...notificationData,
          personalizedMessage: `Bonjour ${booking.customer.firstName}!`,
          type: context.type || 'general'
        };
        
        switch (context.type) {
          case 'check-in':
            socketService.sendUserNotification(booking.customer._id, 'PERSONALIZED_CHECKIN_REMINDER', {
              ...reminderContext,
              message: 'Votre aventure commence bientôt!',
              checkInInstructions: [
                'Présentez-vous à la réception',
                'Munissez-vous d\'une pièce d\'identité',
                'Votre réservation est confirmée'
              ],
              hotelContact: {
                phone: booking.hotel.phone,
                address: booking.hotel.address
              }
            });
            break;
        }
        break;
    }
  } catch (error) {
    console.error('Error sending comprehensive notifications:', error);
  }
};

/**
 * ================================
 * EXPORTS - ENHANCED WITH REAL-TIME ENDPOINTS
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
  
  // NEW: Real-time specific endpoints
  subscribeToBookingUpdates,
  getLiveAvailabilityForBooking,
  sendInstantBookingNotification,
  getRealTimeBookingAnalytics,
  getRealTimeBookingStatus,
  processBulkBookingAction,
  
  // Utilitaires (pour tests et intégrations)
  generateInvoiceData,
  recalculateBookingPrice,
  getAvailableActions,
  createCustomerAccount,
  sendComprehensiveBookingUpdate,
  notifyAllStakeholders,
  
  // NEW: Enhanced real-time utilities
  broadcastBookingEvent,
  sendComprehensiveNotifications,
  getBookingProgressPercentage,
  getNextBookingAction,
  calculateAverageProcessingTime,
  getMostActiveStatus,
  calculateConversionRate,
  calculateProjectedOccupancy
};