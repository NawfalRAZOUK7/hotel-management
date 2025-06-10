/**
 * BOOKING CONTROLLER - CRUD COMPLET + WORKFLOW COMPLEXE + REAL-TIME NOTIFICATIONS + YIELD MANAGEMENT + LOYALTY PROGRAM
 * Gestion des réservations avec workflow métier complet, notifications temps réel, yield management et programme de fidélité
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
 * - PROGRAMME DE FIDELITE intégré
 * - Attribution automatique de points
 * - Utilisation de points pour réductions
 * - Gestion niveaux et bénéfices
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

// ===== NOUVEAU: LOYALTY PROGRAM SERVICES =====
const { 
  getLoyaltyService, 
  quickAwardPoints, 
  quickRedeemPoints, 
  quickGetStatus,
  checkDiscountEligibility 
} = require('../services/loyaltyService');

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
  invalidateHotelCache,
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
 * LOYALTY HELPER FUNCTIONS - NOUVEAU
 * ================================
 */

/**
 * Gérer l'attribution de points de fidélité de manière sécurisée
 */
const handleLoyaltyPointsAttribution = async (userId, bookingId, stage, options = {}) => {
  try {
    console.log(`🎯 Attribution points fidélité - User: ${userId}, Booking: ${bookingId}, Stage: ${stage}`);
    
    // Vérifier si l'utilisateur est inscrit au programme
    const user = await User.findById(userId).select('loyalty').lean();
    if (!user?.loyalty?.enrolledAt) {
      console.log(`ℹ️ User ${userId} non inscrit au programme de fidélité`);
      return { success: false, reason: 'User not enrolled in loyalty program' };
    }

    // Attribution selon le stage
    let result;
    switch (stage) {
      case 'BOOKING_CREATED':
        // Pas de points à la création, seulement à la confirmation
        console.log(`ℹ️ Stage ${stage} - Pas d'attribution de points`);
        return { success: true, stage, points: 0, reason: 'No points awarded at creation' };

      case 'BOOKING_CONFIRMED':
        // Attribution des points principaux après confirmation admin
        result = await quickAwardPoints(userId, bookingId, {
          source: options.source || 'BOOKING_CONFIRMATION',
          earnedBy: options.confirmedBy
        });
        break;

      case 'BOOKING_COMPLETED':
        // Points bonus de séjour terminé (moins que confirmation)
        const completionBonus = await calculateCompletionBonus(userId, bookingId);
        if (completionBonus > 0) {
          result = await getLoyaltyService().awardBonusPoints(
            userId,
            'EARN_COMPLETION',
            completionBonus,
            'Bonus séjour complété',
            { bookingId, stage: 'COMPLETION' }
          );
        } else {
          return { success: true, stage, points: 0, reason: 'No completion bonus applicable' };
        }
        break;

      default:
        console.log(`⚠️ Stage ${stage} non reconnu pour attribution points`);
        return { success: false, reason: 'Unknown stage for points attribution' };
    }

    if (result?.success) {
      console.log(`✅ Points attribués avec succès: ${result.pointsAwarded} points`);
      
      // Notifications temps réel spécifiques loyalty
      await sendLoyaltyNotifications(userId, result, stage, options);
      
      return {
        success: true,
        stage,
        points: result.pointsAwarded,
        newBalance: result.newBalance,
        tierUpgrade: result.tierUpgrade
      };
    } else {
      console.log(`❌ Erreur attribution points: ${result?.message || 'Unknown error'}`);
      return { success: false, reason: result?.message || 'Points attribution failed' };
    }

  } catch (error) {
    console.error(`❌ Erreur attribution points fidélité (${stage}):`, error.message);
    
    // Ne pas faire échouer le workflow principal
    return { 
      success: false, 
      error: error.message,
      stage 
    };
  }
};

/**
 * Calculer bonus de completion selon critères
 */
const calculateCompletionBonus = async (userId, bookingId) => {
  try {
    const booking = await Booking.findById(bookingId).select('totalPrice numberOfNights').lean();
    if (!booking) return 0;

    // Bonus basé sur la durée du séjour et montant
    let bonus = 0;
    
    // Bonus durée séjour
    if (booking.numberOfNights >= 7) bonus += 100; // Séjour 1 semaine+
    else if (booking.numberOfNights >= 3) bonus += 50; // Séjour 3+ nuits
    else if (booking.numberOfNights >= 2) bonus += 25; // Séjour 2+ nuits

    // Bonus montant (5% des points de base)
    const basePoints = Math.floor(booking.totalPrice);
    bonus += Math.floor(basePoints * 0.05);

    return Math.min(bonus, 200); // Plafonner à 200 points bonus
  } catch (error) {
    console.error('Erreur calcul bonus completion:', error);
    return 0;
  }
};

/**
 * Envoyer notifications spécifiques loyalty
 */
const sendLoyaltyNotifications = async (userId, loyaltyResult, stage, options = {}) => {
  try {
    const user = await User.findById(userId).select('firstName lastName email loyalty').lean();
    if (!user) return;

    // Notification temps réel
    socketService.sendUserNotification(userId, 'LOYALTY_POINTS_EARNED', {
      stage,
      pointsEarned: loyaltyResult.pointsAwarded,
      newBalance: loyaltyResult.newBalance,
      tier: user.loyalty.tier,
      tierUpgrade: loyaltyResult.tierUpgrade,
      message: `🎉 +${loyaltyResult.pointsAwarded} points de fidélité !`,
      estimatedValue: Math.round((loyaltyResult.pointsAwarded / 100) * 100) / 100
    });

    // Notification spéciale pour upgrade de niveau
    if (loyaltyResult.tierUpgrade?.upgraded) {
      socketService.sendUserNotification(userId, 'LOYALTY_TIER_UPGRADED', {
        oldTier: loyaltyResult.tierUpgrade.oldTier,
        newTier: loyaltyResult.tierUpgrade.newTier,
        newBenefits: getLoyaltyService().config.tierBenefits[loyaltyResult.tierUpgrade.newTier].benefits,
        celebrationAnimation: true,
        message: `🎊 Félicitations ! Vous êtes maintenant niveau ${loyaltyResult.tierUpgrade.newTier} !`
      });
    }

  } catch (error) {
    console.error('Erreur notifications loyalty:', error);
  }
};

/**
 * Gérer l'utilisation de points pour réductions
 */
const handleLoyaltyDiscount = async (userId, loyaltyDiscount, bookingData) => {
  try {
    if (!loyaltyDiscount || !loyaltyDiscount.pointsToUse || loyaltyDiscount.pointsToUse <= 0) {
      return { applied: false, reason: 'No loyalty discount requested' };
    }

    console.log(`💳 Application réduction fidélité: ${loyaltyDiscount.pointsToUse} points`);

    // Vérifier éligibilité
    const eligibility = await checkDiscountEligibility(userId, loyaltyDiscount.discountAmount);
    if (!eligibility.eligible) {
      console.log(`❌ Réduction non éligible: ${eligibility.reason}`);
      return { applied: false, reason: eligibility.reason };
    }

    // Calculer la réduction
    const discountAmount = Math.min(
      loyaltyDiscount.discountAmount || (loyaltyDiscount.pointsToUse / 100),
      bookingData.totalPrice * 0.5 // Maximum 50% de réduction
    );

    return {
      applied: true,
      pointsUsed: loyaltyDiscount.pointsToUse,
      discountAmount: discountAmount,
      newTotalPrice: Math.max(0, bookingData.totalPrice - discountAmount),
      eligibility
    };

  } catch (error) {
    console.error('Erreur application réduction loyalty:', error);
    return { applied: false, error: error.message };
  }
};

/**
 * Appliquer effectivement la réduction loyalty après création booking
 */
const applyLoyaltyDiscountToBooking = async (booking, loyaltyDiscount, userId, session) => {
  try {
    if (!loyaltyDiscount?.applied) return { success: false };

    console.log(`💳 Application effective réduction loyalty sur booking ${booking._id}`);

    // Utiliser les points
    const redemption = await quickRedeemPoints(
      userId,
      loyaltyDiscount.pointsUsed,
      booking._id,
      { 
        source: 'BOOKING_CREATION',
        applyImmediately: true,
        session 
      }
    );

    if (!redemption?.success) {
      console.log(`❌ Échec utilisation points: ${redemption?.message}`);
      return { success: false, reason: redemption?.message };
    }

    // Mettre à jour la réservation
    booking.discounts = booking.discounts || [];
    booking.discounts.push({
      type: 'LOYALTY_POINTS',
      amount: loyaltyDiscount.discountAmount,
      description: `Réduction fidélité - ${loyaltyDiscount.pointsUsed} points`,
      pointsUsed: loyaltyDiscount.pointsUsed,
      transactionId: redemption.transactionId,
      appliedAt: new Date()
    });

    booking.totalPrice = loyaltyDiscount.newTotalPrice;
    await booking.save({ session });

    console.log(`✅ Réduction loyalty appliquée: -${loyaltyDiscount.discountAmount}€`);

    return {
      success: true,
      discountAmount: loyaltyDiscount.discountAmount,
      pointsUsed: loyaltyDiscount.pointsUsed,
      transactionId: redemption.transactionId,
      newBalance: redemption.remainingPoints
    };

  } catch (error) {
    console.error('Erreur application réduction effective:', error);
    return { success: false, error: error.message };
  }
};

/**
 * ================================
 * CRUD OPERATIONS - CRÉATION WITH YIELD MANAGEMENT + LOYALTY
 * ================================
 */

/**
 * @desc    Créer une nouvelle réservation avec yield management et loyalty program
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
      // ===== NOUVEAU: LOYALTY FIELDS =====
      loyaltyDiscount, // { pointsToUse, discountAmount }
      applyLoyaltyBenefits = true, // Appliquer bénéfices automatiques selon niveau
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
            basePrice: yieldPricingDetails[yieldPricingDetails.length - 1].basePrice,
            calculatedPrice: finalPricePerRoom,
            yieldFactors: yieldPricingDetails[yieldPricingDetails.length - 1].factors,
            room: null, // Sera assigné lors du check-in
            assignedAt: null,
            assignedBy: null,
          });
        }
      }

      // ================================
      // NOUVEAU: LOYALTY PROGRAM INTEGRATION
      // ================================

      let loyaltyProcessing = { applied: false };
      let loyaltyBenefitsApplied = [];

      // Traiter réduction loyalty si demandée
      if (loyaltyDiscount && loyaltyDiscount.pointsToUse > 0) {
        loyaltyProcessing = await handleLoyaltyDiscount(customerId, loyaltyDiscount, { totalPrice });
        
        if (loyaltyProcessing.applied) {
          totalPrice = loyaltyProcessing.newTotalPrice;
          console.log(`💳 Réduction loyalty appliquée: -${loyaltyProcessing.discountAmount}€`);
        }
      }

      // Appliquer bénéfices automatiques selon niveau
      if (applyLoyaltyBenefits) {
        try {
          const userStatus = await quickGetStatus(customerId, true);
          if (userStatus?.benefits?.active) {
            const applicableBenefits = userStatus.benefits.active.filter(benefit => 
              benefit.type === 'DISCOUNT' && benefit.isActive && 
              benefit.validUntil > new Date() && benefit.usageCount < benefit.maxUsage
            );

            for (const benefit of applicableBenefits) {
              if (benefit.type === 'DISCOUNT' && totalPrice > 100) {
                const benefitDiscount = Math.min(totalPrice * (benefit.value / 100), totalPrice * 0.2);
                totalPrice = Math.max(0, totalPrice - benefitDiscount);
                
                loyaltyBenefitsApplied.push({
                  type: benefit.type,
                  description: benefit.description,
                  discountAmount: benefitDiscount,
                  appliedAt: new Date()
                });

                console.log(`🎁 Bénéfice fidélité appliqué: ${benefit.description} (-${benefitDiscount}€)`);
              }
            }
          }
        } catch (loyaltyError) {
          console.warn('Erreur application bénéfices loyalty:', loyaltyError.message);
          // Ne pas bloquer la réservation
        }
      }

      // ================================
      // CRÉATION RÉSERVATION AVEC REAL-TIME PROCESSING ET YIELD + LOYALTY DATA
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
          demandLevel: yieldPricingDetails[0]?.factors?.demandFactor?.level || 'NORMAL',
          recommendations: yieldPricingDetails[0]?.factors?.recommendations || [],
          calculatedAt: new Date(),
        },

        // ===== NOUVEAU: LOYALTY PROGRAM DATA =====
        loyaltyProgram: {
          discountApplied: loyaltyProcessing.applied,
          pointsUsed: loyaltyProcessing.pointsUsed || 0,
          discountAmount: loyaltyProcessing.discountAmount || 0,
          benefitsApplied: loyaltyBenefitsApplied,
          customerTier: null, // Sera rempli après
          pointsToEarn: Math.floor(totalPrice), // Estimation points à gagner
          transactionId: null // Sera rempli après utilisation effective des points
        }
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
     // NOUVEAU: APPLICATION EFFECTIVE RÉDUCTION LOYALTY
     // ================================

     if (loyaltyProcessing.applied) {
       const loyaltyApplication = await applyLoyaltyDiscountToBooking(
         savedBooking, 
         loyaltyProcessing, 
         customerId, 
         session
       );

       if (loyaltyApplication.success) {
         savedBooking.loyaltyProgram.transactionId = loyaltyApplication.transactionId;
         await savedBooking.save({ session });
         
         console.log(`✅ Réduction loyalty finalisée: Transaction ${loyaltyApplication.transactionId}`);
       } else {
         console.warn(`⚠️ Échec application finale réduction loyalty: ${loyaltyApplication.reason}`);
       }
     }

     // Récupérer le tier du customer pour les données loyalty
     const customerData = await User.findById(customerId).select('loyalty').lean();
     if (customerData?.loyalty) {
       savedBooking.loyaltyProgram.customerTier = customerData.loyalty.tier;
       await savedBooking.save({ session });
     }

     // ================================
     // REAL-TIME NOTIFICATIONS & BROADCASTING WITH YIELD + LOYALTY INFO
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
         demandLevel: yieldPricingDetails[0]?.factors?.demandFactor?.level || 'NORMAL',
       },
       // ===== NOUVEAU: LOYALTY INFO =====
       loyaltyData: {
         discountApplied: loyaltyProcessing.applied,
         pointsUsed: loyaltyProcessing.pointsUsed || 0,
         benefitsUsed: loyaltyBenefitsApplied.length,
         customerTier: customerData?.loyalty?.tier || 'BRONZE',
         pointsToEarn: Math.floor(totalPrice)
       }
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
         loyaltySavings: loyaltyProcessing.discountAmount || 0
       },
       // ===== NOUVEAU: LOYALTY NOTIFICATIONS =====
       loyaltyInfo: loyaltyProcessing.applied ? {
         pointsUsed: loyaltyProcessing.pointsUsed,
         discountObtained: loyaltyProcessing.discountAmount,
         remainingPoints: loyaltyProcessing.eligibility?.remainingAfter,
         message: `💳 ${loyaltyProcessing.pointsUsed} points utilisés pour ${loyaltyProcessing.discountAmount}€ de réduction`
       } : null
     });

     // Notify hotel staff with yield + loyalty insights
     socketService.sendHotelNotification(hotelId, 'NEW_BOOKING', {
       ...bookingEventData,
       requiresValidation: true,
       urgency: checkIn <= new Date(Date.now() + 24 * 60 * 60 * 1000) ? 'HIGH' : 'NORMAL',
       yieldAnalysis: {
         revenueImpact: totalPrice,
         occupancyContribution: (totalRooms / hotel.stats?.totalRooms || 50) * 100,
         recommendedAction: yieldPricingDetails[0]?.factors?.recommendations?.[0]?.action || 'VALIDATE',
       },
       // ===== NOUVEAU: LOYALTY INSIGHTS FOR HOTEL =====
       loyaltyInsights: {
         customerTier: customerData?.loyalty?.tier,
         isLoyalCustomer: customerData?.loyalty?.lifetimePoints > 1000,
         discountUsed: loyaltyProcessing.applied,
         estimatedLoyaltyValue: customerData?.loyalty?.currentPoints ? 
           Math.round(customerData.loyalty.currentPoints / 100) : 0
       }
     });

     // Notify admins
     socketService.sendAdminNotification('NEW_BOOKING_PENDING', {
       ...bookingEventData,
       awaitingValidation: true,
       createdBy: req.user.role,
       yieldManagementApplied: true,
       loyaltyProgramUsed: loyaltyProcessing.applied || loyaltyBenefitsApplied.length > 0
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
       loyaltyUsed: loyaltyProcessing.applied
     });

     // ================================
     // ANALYZE BOOKING FOR FUTURE YIELD OPTIMIZATION
     // ================================

     await demandAnalyzer.analyzeDemand(hotelId, checkIn, checkOut, {
       newBooking: true,
       leadTime: Math.ceil((checkIn - new Date()) / (1000 * 60 * 60 * 24)),
       bookingValue: totalPrice,
       roomTypes: roomsToBook.map((r) => r.type),
       loyaltyCustomer: customerData?.loyalty?.tier !== 'BRONZE'
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
             demandLevel: yieldPricingDetails[0]?.factors?.demandFactor?.level || 'NORMAL',
             priceOptimization: {
               baseTotal: yieldPricingDetails.reduce(
                 (sum, d) => sum + d.basePrice * d.quantity * nightsCount,
                 0
               ),
               optimizedTotal: totalPrice,
               optimization: `${Math.round((totalPrice / yieldPricingDetails.reduce((sum, d) => sum + d.basePrice * d.quantity * nightsCount, 0) - 1) * 100)}%`,
             },
           },
           // ===== NOUVEAU: LOYALTY PRICING INFO =====
           loyaltyProgram: {
             applied: loyaltyProcessing.applied,
             pointsUsed: loyaltyProcessing.pointsUsed || 0,
             discountAmount: loyaltyProcessing.discountAmount || 0,
             benefitsApplied: loyaltyBenefitsApplied,
             customerTier: customerData?.loyalty?.tier || 'Non inscrit',
             estimatedPointsToEarn: Math.floor(totalPrice),
             totalSavings: (loyaltyProcessing.discountAmount || 0) + 
                          loyaltyBenefitsApplied.reduce((sum, b) => sum + b.discountAmount, 0)
           }
         },
         nextSteps: {
           awaitingValidation: true,
           estimatedValidationTime: '24h',
           cancelBeforeValidation: `/api/bookings/${savedBooking._id}/cancel`,
           trackStatus: `/api/bookings/${savedBooking._id}`,
           loyaltyStatus: loyaltyProcessing.applied ? 
             'Points utilisés - remboursement possible si annulation avant validation' : 
             'Points seront attribués après confirmation'
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
* CRUD OPERATIONS - LECTURE WITH YIELD + LOYALTY DATA
* ================================
*/

/**
* @desc    Obtenir les réservations selon le rôle utilisateur avec données yield + loyalty
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
     includeLoyaltyData = true, // ===== NOUVEAU: Include loyalty data =====
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
       .populate('customer', 'firstName lastName email phone loyalty') // ===== NOUVEAU: Include loyalty
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
   // STATISTIQUES RÉSUMÉ WITH YIELD + LOYALTY DATA
   // ================================

   const statusStats = await Booking.aggregate([
     { $match: query },
     {
       $group: {
         _id: '$status',
         count: { $sum: 1 },
         totalRevenue: { $sum: '$totalPrice' },
         avgYieldMultiplier: { $avg: '$yieldManagement.averageMultiplier' },
         // ===== NOUVEAU: LOYALTY STATS =====
         loyaltyBookingsCount: { 
           $sum: { $cond: ['$loyaltyProgram.discountApplied', 1, 0] } 
         },
         totalLoyaltyDiscount: { 
           $sum: { $ifNull: ['$loyaltyProgram.discountAmount', 0] } 
         },
         totalPointsUsed: { 
           $sum: { $ifNull: ['$loyaltyProgram.pointsUsed', 0] } 
         }
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

   // ===== NOUVEAU: LOYALTY STATISTICS =====
   const loyaltyStats = includeLoyaltyData === 'true' ? {
     totalLoyaltyBookings: statusStats.reduce((sum, stat) => sum + (stat.loyaltyBookingsCount || 0), 0),
     totalLoyaltyDiscount: statusStats.reduce((sum, stat) => sum + (stat.totalLoyaltyDiscount || 0), 0),
     totalPointsUsed: statusStats.reduce((sum, stat) => sum + (stat.totalPointsUsed || 0), 0),
     loyaltyAdoptionRate: totalCount > 0 ? 
       Math.round((statusStats.reduce((sum, stat) => sum + (stat.loyaltyBookingsCount || 0), 0) / totalCount) * 100) : 0
   } : null;

   res.status(200).json({
     success: true,
     data: {
       bookings: includeYieldData && includeLoyaltyData
         ? bookings
         : bookings.map((b) => {
             const booking = b.toObject();
             if (includeYieldData !== 'true') delete booking.yieldManagement;
             if (includeLoyaltyData !== 'true') delete booking.loyaltyProgram;
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
         // ===== NOUVEAU: LOYALTY STATISTICS =====
         loyaltyProgram: loyaltyStats
       },
       userContext: {
         role: req.user.role,
         canValidate: req.user.role === USER_ROLES.ADMIN,
         canCheckIn: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role),
         canViewYieldData: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role),
         canViewLoyaltyData: [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role), // ===== NOUVEAU =====
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
* @desc    Obtenir une réservation par ID avec analyse yield + loyalty
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
     includeLoyaltyData = true, // ===== NOUVEAU: Include loyalty data =====
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
     .populate('customer', 'firstName lastName email phone clientType loyalty') // ===== NOUVEAU: Include loyalty
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
   // ===== NOUVEAU: LOYALTY ANALYSIS =====
   // ================================

   if (
     includeLoyaltyData === 'true' &&
     [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST, USER_ROLES.CLIENT].includes(req.user.role)
   ) {
     try {
       // Données loyalty de base depuis la réservation
       const loyaltyBookingData = booking.loyaltyProgram || {};
       
       // Données loyalty du customer
       const customerLoyalty = booking.customer.loyalty || {};
       
       // Transactions loyalty liées à cette réservation
       let loyaltyTransactions = [];
       if ([USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(req.user.role)) {
         const LoyaltyTransaction = require('../models/LoyaltyTransaction');
         loyaltyTransactions = await LoyaltyTransaction.find({
           booking: booking._id
         }).select('type pointsAmount description createdAt status').lean();
       }

       // Calcul points estimés si pas encore attribués
       let estimatedPointsToEarn = 0;
       if (booking.status === BOOKING_STATUS.PENDING || booking.status === BOOKING_STATUS.CONFIRMED) {
         estimatedPointsToEarn = Math.floor(booking.totalPrice);
         
         // Appliquer multiplicateur selon niveau
         const tierMultipliers = {
           'BRONZE': 1.0,
           'SILVER': 1.2,
           'GOLD': 1.5,
           'PLATINUM': 2.0,
           'DIAMOND': 2.5
         };
         
         const multiplier = tierMultipliers[customerLoyalty.tier] || 1.0;
         estimatedPointsToEarn = Math.floor(estimatedPointsToEarn * multiplier);
       }

       responseData.loyaltyAnalysis = {
         bookingLoyaltyData: loyaltyBookingData,
         customerTier: customerLoyalty.tier || 'NON_INSCRIT',
         customerPoints: customerLoyalty.currentPoints || 0,
         customerLifetimePoints: customerLoyalty.lifetimePoints || 0,
         transactions: loyaltyTransactions,
         estimatedPointsToEarn,
         loyaltyValue: {
           pointsUsed: loyaltyBookingData.pointsUsed || 0,
           discountObtained: loyaltyBookingData.discountAmount || 0,
           benefitsApplied: loyaltyBookingData.benefitsApplied || [],
           totalSavings: (loyaltyBookingData.discountAmount || 0) + 
                        (loyaltyBookingData.benefitsApplied || []).reduce((sum, b) => sum + (b.discountAmount || 0), 0)
         },
         futureOpportunities: req.user.role !== USER_ROLES.CLIENT ? null : {
           nextTier: customerLoyalty.tierProgress?.nextTier,
           pointsToNextTier: customerLoyalty.tierProgress?.pointsToNextTier,
           progressPercentage: customerLoyalty.tierProgress?.progressPercentage
         }
       };

     } catch (error) {
       console.error('Error generating loyalty analysis:', error);
       responseData.loyaltyAnalysis = { error: 'Analyse loyalty non disponible' };
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
* WORKFLOW MANAGEMENT - VALIDATION ADMIN WITH YIELD + LOYALTY INSIGHTS
* ================================
*/

/**
* @desc    Valider ou rejeter une réservation avec analyse yield + loyalty
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
       .populate('customer', 'firstName lastName email loyalty') // ===== NOUVEAU: Include loyalty
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

     // ===== NOUVEAU: LOYALTY PROGRAM PROCESSING =====
     let loyaltyProcessingResult = null;

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

       // ===== NOUVEAU: ATTRIBUTION POINTS FIDÉLITÉ APRÈS CONFIRMATION =====
       if (booking.customer?.loyalty?.enrolledAt) {
         try {
           console.log(`🎯 Attribution points après confirmation booking ${booking._id}`);
           
           loyaltyProcessingResult = await handleLoyaltyPointsAttribution(
             booking.customer._id,
             booking._id,
             'BOOKING_CONFIRMED',
             {
               source: 'ADMIN_VALIDATION',
               confirmedBy: req.user.id,
               originalAmount: booking.totalPrice
             }
           );

           if (loyaltyProcessingResult.success) {
             console.log(`✅ Points attribués: ${loyaltyProcessingResult.points} points`);
             
             // Mettre à jour les données loyalty de la réservation
             booking.loyaltyProgram = booking.loyaltyProgram || {};
             booking.loyaltyProgram.pointsEarned = loyaltyProcessingResult.points;
             booking.loyaltyProgram.earnedAt = new Date();
             booking.loyaltyProgram.confirmedBy = req.user.id;
             
             // Gérer upgrade de niveau si applicable
             if (loyaltyProcessingResult.tierUpgrade?.upgraded) {
               booking.loyaltyProgram.tierUpgradeTriggered = {
                 oldTier: loyaltyProcessingResult.tierUpgrade.oldTier,
                 newTier: loyaltyProcessingResult.tierUpgrade.newTier,
                 triggeredAt: new Date()
               };
             }
             
           } else {
             console.warn(`⚠️ Échec attribution points: ${loyaltyProcessingResult.reason}`);
             booking.loyaltyProgram = booking.loyaltyProgram || {};
             booking.loyaltyProgram.pointsAttributionError = loyaltyProcessingResult.reason;
           }
           
         } catch (loyaltyError) {
           console.error('Erreur attribution points après confirmation:', loyaltyError);
           // Ne pas bloquer la validation pour une erreur loyalty
         }
       }

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

       // ===== NOUVEAU: GESTION REJET AVEC LOYALTY =====
       // Si des points ont été utilisés lors de la création, les rembourser
       if (booking.loyaltyProgram?.pointsUsed > 0 && booking.loyaltyProgram?.transactionId) {
         try {
           console.log(`💳 Remboursement points suite au rejet: ${booking.loyaltyProgram.pointsUsed} points`);
           
           const loyaltyService = getLoyaltyService();
           const refundResult = await loyaltyService.awardBonusPoints(
             booking.customer._id,
             'REFUND_REJECTION',
             booking.loyaltyProgram.pointsUsed,
             `Remboursement suite au rejet de la réservation ${booking._id}`,
             { 
               originalTransactionId: booking.loyaltyProgram.transactionId,
               rejectedBy: req.user.id 
             }
           );

           if (refundResult.success) {
             booking.loyaltyProgram.pointsRefunded = true;
             booking.loyaltyProgram.refundedAt = new Date();
             booking.loyaltyProgram.refundTransactionId = refundResult.transactionId;
             
             console.log(`✅ Points remboursés avec succès`);
           }
           
         } catch (refundError) {
           console.error('Erreur remboursement points:', refundError);
           booking.loyaltyProgram.refundError = refundError.message;
         }
       }
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
         loyaltyProcessed: !!loyaltyProcessingResult?.success, // ===== NOUVEAU =====
       },
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD + LOYALTY DATA
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
       // ===== NOUVEAU: LOYALTY DATA =====
       loyaltyData: loyaltyProcessingResult ? {
         pointsProcessed: loyaltyProcessingResult.success,
         pointsEarned: loyaltyProcessingResult.points || 0,
         tierUpgrade: loyaltyProcessingResult.tierUpgrade,
         pointsRefunded: booking.loyaltyProgram?.pointsRefunded || false
       } : null
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
         // ===== NOUVEAU: LOYALTY NOTIFICATIONS =====
         loyaltyInfo: loyaltyProcessingResult?.success ? {
           pointsEarned: loyaltyProcessingResult.points,
           newBalance: loyaltyProcessingResult.newBalance,
           tierUpgrade: loyaltyProcessingResult.tierUpgrade,
           message: `🎉 ${loyaltyProcessingResult.points} points de fidélité crédités !`
         } : null
       });

       // Notify hotel staff with yield + loyalty insights
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
         // ===== NOUVEAU: LOYALTY INSIGHTS FOR HOTEL =====
         loyaltyInsights: {
           customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
           pointsEarned: loyaltyProcessingResult?.points || 0,
           isVIPCustomer: booking.customer.loyalty?.tier && ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier),
           lifetimeValue: booking.customer.loyalty?.lifetimePoints || 0
         }
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
         loyaltyProcessed: loyaltyProcessingResult?.success
       });
     } else {
       // Notify customer of rejection
       socketService.sendUserNotification(booking.customer._id, 'BOOKING_REJECTED', {
         ...notificationData,
         message: 'Votre réservation a été refusée',
         reason: booking.rejectionReason,
         suggestion: "Vous pouvez essayer d'autres dates ou hôtels",
         // ===== NOUVEAU: LOYALTY REFUND INFO =====
         loyaltyRefund: booking.loyaltyProgram?.pointsRefunded ? {
           pointsRefunded: booking.loyaltyProgram.pointsUsed,
           message: `${booking.loyaltyProgram.pointsUsed} points remboursés sur votre compte`
         } : null
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

     // Broadcast to admin dashboard with yield + loyalty insights
     socketService.sendAdminNotification('BOOKING_VALIDATED', {
       ...notificationData,
       validationTime: new Date() - booking.createdAt,
       impact: action === 'approve' ? 'Revenue confirmed' : 'Availability released',
       yieldAnalysis: {
         followedRecommendation: yieldRecommendation?.recommendation === action.toUpperCase(),
         potentialRevenueLoss: action === 'reject' ? booking.totalPrice : 0,
         demandImpact: yieldRecommendation?.demandLevel,
       },
       // ===== NOUVEAU: LOYALTY IMPACT =====
       loyaltyImpact: {
         pointsProcessed: loyaltyProcessingResult?.success || false,
         pointsAmount: loyaltyProcessingResult?.points || 0,
         customerTierAfter: loyaltyProcessingResult?.tierUpgrade?.newTier || booking.customer.loyalty?.tier,
         tierUpgradeTriggered: loyaltyProcessingResult?.tierUpgrade?.upgraded || false
       }
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
         // ===== NOUVEAU: LOYALTY RESULTS =====
         loyaltyResults: loyaltyProcessingResult ? {
           success: loyaltyProcessingResult.success,
           pointsEarned: loyaltyProcessingResult.points || 0,
           pointsRefunded: booking.loyaltyProgram?.pointsRefunded || false,
           newBalance: loyaltyProcessingResult.newBalance,
           tierUpgrade: loyaltyProcessingResult.tierUpgrade
         } : null,
         realTimeNotifications: {
           customerNotified: true,
           hotelNotified: true,
           availabilityUpdated: true,
           loyaltyProcessed: loyaltyProcessingResult?.success || false
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
* WORKFLOW MANAGEMENT - CHECK-IN/CHECK-OUT WITH YIELD + LOYALTY TRACKING
* ================================
*/

/**
* @desc    Effectuer le check-in d'une réservation avec tracking yield + loyalty
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
       .populate('customer', 'firstName lastName email loyalty') // ===== NOUVEAU: Include loyalty
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
     // UPDATE BOOKING STATUS WITH YIELD + LOYALTY TRACKING
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

     // ===== NOUVEAU: LOYALTY CHECK-IN TRACKING =====
     if (booking.customer.loyalty?.enrolledAt) {
       booking.loyaltyProgram = booking.loyaltyProgram || {};
       booking.loyaltyProgram.checkInData = {
         checkedInAt: booking.actualCheckInDate,
         checkedInBy: req.user.id,
         tierAtCheckIn: booking.customer.loyalty.tier,
         pointsBalanceAtCheckIn: booking.customer.loyalty.currentPoints,
         specialServicesOffered: specialServices || [],
         vipTreatment: ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier)
       };

       // Appliquer bénéfices VIP si applicable
       if (['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier)) {
         booking.loyaltyProgram.vipBenefitsApplied = {
           appliedAt: new Date(),
           benefits: ['priority_checkin', 'room_upgrade_if_available', 'welcome_amenities'],
           appliedBy: req.user.id
         };
         
         console.log(`👑 Bénéfices VIP appliqués pour client ${booking.customer.loyalty.tier}`);
       }
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
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD + LOYALTY DATA
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
       // ===== NOUVEAU: LOYALTY CHECK-IN DATA =====
       loyaltyData: {
         customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
         vipTreatment: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
         currentPoints: booking.customer.loyalty?.currentPoints || 0,
         lifetimePoints: booking.customer.loyalty?.lifetimePoints || 0,
         isHighValueCustomer: (booking.customer.loyalty?.lifetimePoints || 0) > 5000
       }
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
       // ===== NOUVEAU: LOYALTY WELCOME MESSAGE =====
       loyaltyWelcome: booking.customer.loyalty?.enrolledAt ? {
         tier: booking.customer.loyalty.tier,
         currentPoints: booking.customer.loyalty.currentPoints,
         vipTreatment: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
         message: booking.loyaltyProgram?.vipBenefitsApplied ? 
           `Bienvenue ${booking.customer.loyalty.tier}! Profitez de vos avantages VIP.` :
           `Bon séjour! Vous gagnerez des points à la fin de votre séjour.`
       } : null
     });

     // Notify hotel staff with yield + loyalty insights
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
       // ===== NOUVEAU: LOYALTY INSIGHTS FOR STAFF =====
       loyaltyInsights: {
         customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
         lifetimeValue: booking.customer.loyalty?.lifetimePoints || 0,
         vipService: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
         specialAttention: ['GOLD', 'PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty?.tier),
         pointsToEarnThisStay: booking.loyaltyProgram?.pointsToEarn || 0
       }
     });

     // Notify housekeeping
     if (assignedRoomNumbers.length > 0) {
       socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
         action: 'ROOMS_OCCUPIED',
         rooms: assignedRoomNumbers,
         guestName: `${booking.customer.firstName} ${booking.customer.lastName}`,
         specialRequests: booking.specialRequests,
         vipGuest: booking.loyaltyProgram?.vipBenefitsApplied ? true : false // ===== NOUVEAU =====
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
       loyaltyTracking: true // ===== NOUVEAU =====
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
         // ===== NOUVEAU: LOYALTY CHECK-IN RESULTS =====
         loyaltyResults: {
           customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
           vipTreatmentApplied: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
           pointsToEarnThisStay: booking.loyaltyProgram?.pointsToEarn || Math.floor(booking.totalPrice),
           currentPointsBalance: booking.customer.loyalty?.currentPoints || 0,
           specialServices: booking.loyaltyProgram?.vipBenefitsApplied?.benefits || []
         },
         nextSteps: {
           addExtras: `/api/bookings/${booking._id}/extras`,
           checkOut: `/api/bookings/${booking._id}/checkout`,
           viewInvoice: `/api/bookings/${booking._id}/invoice`,
           loyaltyStatus: `/api/loyalty/status`
         },
         realTimeTracking: {
           guestInHouse: true,
           roomsOccupied: assignedRoomNumbers,
           loyaltyTracking: booking.customer.loyalty?.enrolledAt ? true : false
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
* @desc    Effectuer le check-out d'une réservation avec analyse yield finale + attribution points completion
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
       .populate('customer', 'firstName lastName email loyalty') // ===== NOUVEAU: Include loyalty
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
     // ===== NOUVEAU: ATTRIBUTION POINTS COMPLETION =====
     // ================================

     let loyaltyCompletionResult = null;
     
     if (booking.customer.loyalty?.enrolledAt) {
       try {
         console.log(`🎯 Attribution points completion pour booking ${booking._id}`);
         
         // Attribution des points de completion (bonus séjour terminé)
         loyaltyCompletionResult = await handleLoyaltyPointsAttribution(
           booking.customer._id,
           booking._id,
           'BOOKING_COMPLETED',
           {
             source: 'CHECKOUT_COMPLETION',
             checkedOutBy: req.user.id,
             finalAmount: booking.totalPrice,
             stayDuration: booking.actualStayDuration,
             extrasAmount: finalExtrasTotal
           }
         );

         if (loyaltyCompletionResult.success) {
           console.log(`✅ Points completion attribués: ${loyaltyCompletionResult.points} points`);
           
           // Mettre à jour les données loyalty de completion
           booking.loyaltyProgram = booking.loyaltyProgram || {};
           booking.loyaltyProgram.completionBonus = {
             pointsEarned: loyaltyCompletionResult.points,
             earnedAt: new Date(),
             checkedOutBy: req.user.id,
             finalAmount: booking.totalPrice,
             tierUpgrade: loyaltyCompletionResult.tierUpgrade
           };
           
         } else {
           console.warn(`⚠️ Échec attribution points completion: ${loyaltyCompletionResult.reason}`);
           booking.loyaltyProgram = booking.loyaltyProgram || {};
           booking.loyaltyProgram.completionError = loyaltyCompletionResult.reason;
         }
         
       } catch (loyaltyError) {
         console.error('Erreur attribution points completion:', loyaltyError);
         // Ne pas bloquer le check-out pour une erreur loyalty
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
         loyaltyBonusAwarded: loyaltyCompletionResult?.success || false // ===== NOUVEAU =====
       },
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // GENERATE INVOICE WITH YIELD + LOYALTY DATA
     // ================================

     let invoiceData = null;
     if (generateInvoice) {
       invoiceData = await generateInvoiceWithYieldData(booking);

       // ===== NOUVEAU: Add loyalty data to invoice =====
       if (booking.loyaltyProgram && Object.keys(booking.loyaltyProgram).length > 0) {
         invoiceData.loyaltyProgram = {
           customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
           pointsUsedForDiscount: booking.loyaltyProgram.pointsUsed || 0,
           discountAmount: booking.loyaltyProgram.discountAmount || 0,
           pointsEarnedThisStay: (booking.loyaltyProgram.pointsEarned || 0) + 
                                (loyaltyCompletionResult?.points || 0),
           newPointsBalance: loyaltyCompletionResult?.newBalance || booking.customer.loyalty?.currentPoints,
           tierUpgradeTriggered: booking.loyaltyProgram.tierUpgradeTriggered || 
                                loyaltyCompletionResult?.tierUpgrade?.upgraded,
           vipTreatmentReceived: booking.loyaltyProgram.vipBenefitsApplied ? true : false
         };
       }

       // Notify invoice ready
       socketService.sendUserNotification(booking.customer._id, 'INVOICE_READY', {
         bookingId: booking._id,
         invoiceNumber: invoiceData.invoiceNumber,
         totalAmount: invoiceData.totals.total,
         downloadUrl: `/api/bookings/${booking._id}/invoice`,
         // ===== NOUVEAU: LOYALTY INVOICE INFO =====
         loyaltyInfo: invoiceData.loyaltyProgram ? {
           pointsEarned: invoiceData.loyaltyProgram.pointsEarnedThisStay,
           discountUsed: invoiceData.loyaltyProgram.discountAmount,
           newBalance: invoiceData.loyaltyProgram.newPointsBalance
         } : null
       });
     }

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD + LOYALTY INSIGHTS
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
       // ===== NOUVEAU: LOYALTY CHECK-OUT DATA =====
       loyaltyData: {
         customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
         completionBonusEarned: loyaltyCompletionResult?.points || 0,
         totalPointsEarnedThisStay: (booking.loyaltyProgram?.pointsEarned || 0) + 
                                   (loyaltyCompletionResult?.points || 0),
         newPointsBalance: loyaltyCompletionResult?.newBalance || booking.customer.loyalty?.currentPoints,
         tierUpgrade: loyaltyCompletionResult?.tierUpgrade
       }
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
       // ===== NOUVEAU: LOYALTY FAREWELL MESSAGE =====
       loyaltyFarewell: booking.customer.loyalty?.enrolledAt ? {
         pointsEarned: checkOutData.loyaltyData.totalPointsEarnedThisStay,
         newBalance: checkOutData.loyaltyData.newPointsBalance,
         tierUpgrade: loyaltyCompletionResult?.tierUpgrade,
         message: loyaltyCompletionResult?.tierUpgrade?.upgraded ? 
           `🎉 Félicitations ! Vous êtes maintenant niveau ${loyaltyCompletionResult.tierUpgrade.newTier} !` :
           `Merci pour votre fidélité ! +${checkOutData.loyaltyData.totalPointsEarnedThisStay} points gagnés.`,
         nextVisitIncentive: 'Revenez bientôt pour profiter de vos points!'
       } : null
     });

     // Notify hotel staff with yield + loyalty performance
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
       // ===== NOUVEAU: LOYALTY INSIGHTS FOR HOTEL =====
       loyaltyInsights: {
         customerTier: booking.customer.loyalty?.tier,
         wasVIPGuest: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
         lifetimeValue: booking.customer.loyalty?.lifetimePoints || 0,
         likelihoodReturn: calculateReturnLikelihood(booking.customer.loyalty),
         pointsAwarded: checkOutData.loyaltyData.totalPointsEarnedThisStay,
         tierUpgradeAchieved: loyaltyCompletionResult?.tierUpgrade?.upgraded || false
       }
     });

     // Notify housekeeping
     socketService.sendHotelNotification(booking.hotel._id, 'HOUSEKEEPING_UPDATE', {
       action: 'ROOMS_NEED_CLEANING',
       rooms: releasedRoomNumbers.map((r) => ({
         number: r.number,
         type: r.type,
         priority: r.needsMaintenance ? 'HIGH' : 'NORMAL',
         notes: roomCondition?.find((rc) => rc.roomNumber === r.number)?.notes,
         wasVIPGuest: booking.loyaltyProgram?.vipBenefitsApplied ? true : false // ===== NOUVEAU =====
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
       loyaltyCompletion: loyaltyCompletionResult // ===== NOUVEAU =====
     });

     // Update demand analyzer with completed booking data + loyalty
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
           loyaltyCustomer: booking.customer.loyalty?.tier !== 'BRONZE', // ===== NOUVEAU =====
           customerLifetimeValue: booking.customer.loyalty?.lifetimePoints || 0 // ===== NOUVEAU =====
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
         // ===== NOUVEAU: LOYALTY RESULTS =====
         loyaltyResults: {
           customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
           completionBonusEarned: loyaltyCompletionResult?.points || 0,
           totalPointsEarnedThisStay: checkOutData.loyaltyData.totalPointsEarnedThisStay,
           newPointsBalance: checkOutData.loyaltyData.newPointsBalance,
           tierUpgrade: loyaltyCompletionResult?.tierUpgrade,
           vipTreatmentReceived: booking.loyaltyProgram?.vipBenefitsApplied ? true : false,
           estimatedValue: Math.round((checkOutData.loyaltyData.totalPointsEarnedThisStay / 100) * 100) / 100
         },
         summary: {
           stayDuration: `${actualStayDuration} nuit(s)`,
           roomsUsed: roomsToRelease.length,
           extrasTotal: booking.extrasTotal || 0,
           finalTotal: booking.totalPrice,
           yieldOptimization: booking.yieldManagement?.checkOutData?.yieldPerformanceScore
             ? `${booking.yieldManagement.checkOutData.yieldPerformanceScore}% efficacité`
             : 'N/A',
           loyaltyValue: checkOutData.loyaltyData.totalPointsEarnedThisStay > 0 ?
             `${checkOutData.loyaltyData.totalPointsEarnedThisStay} points gagnés` : 'Aucun point'
         },
         realTimeUpdates: {
           availabilityUpdated: true,
           housekeepingNotified: true,
           invoiceGenerated: !!invoiceData,
           yieldDataRecorded: true,
           loyaltyPointsAwarded: loyaltyCompletionResult?.success || false // ===== NOUVEAU =====
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
* GESTION EXTRAS & SERVICES WITH YIELD + LOYALTY TRACKING
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
     .populate('customer', 'firstName lastName loyalty'); // ===== NOUVEAU: Include loyalty

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
   // VALIDATION ET CALCUL EXTRAS AVEC YIELD + LOYALTY
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

     // ===== NOUVEAU: APPLY LOYALTY DISCOUNTS ON EXTRAS =====
     let loyaltyDiscount = 0;
     if (booking.customer.loyalty?.tier) {
       const tierDiscounts = {
         'BRONZE': 0,
         'SILVER': 0.05, // 5% sur extras
         'GOLD': 0.10,   // 10% sur extras
         'PLATINUM': 0.15, // 15% sur extras
         'DIAMOND': 0.20   // 20% sur extras
       };
       
       const discountRate = tierDiscounts[booking.customer.loyalty.tier] || 0;
       loyaltyDiscount = finalPrice * discountRate;
       finalPrice = Math.max(0, finalPrice - loyaltyDiscount);
       
       console.log(`🎁 Réduction loyalty ${booking.customer.loyalty.tier} appliquée sur extra: -${loyaltyDiscount}€`);
     }

     const extraTotal = finalPrice * quantity;
     extrasTotal += extraTotal;

     validatedExtras.push({
       name,
       category: category || 'Divers',
       price: finalPrice,
       originalPrice: price, // ===== NOUVEAU: Keep original price =====
       loyaltyDiscount, // ===== NOUVEAU: Track loyalty discount =====
       quantity,
       description: description || '',
       total: extraTotal,
       addedAt: new Date(),
       addedBy: req.user.id,
       yieldAdjusted: finalPrice !== price,
       loyaltyDiscountApplied: loyaltyDiscount > 0 // ===== NOUVEAU =====
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

   // ===== NOUVEAU: Update loyalty data =====
   if (booking.loyaltyProgram) {
     booking.loyaltyProgram.extrasWithLoyaltyDiscount = (booking.loyaltyProgram.extrasWithLoyaltyDiscount || 0) + 
       validatedExtras.filter(e => e.loyaltyDiscountApplied).length;
     booking.loyaltyProgram.totalLoyaltyDiscountOnExtras = (booking.loyaltyProgram.totalLoyaltyDiscountOnExtras || 0) + 
       validatedExtras.reduce((sum, e) => sum + e.loyaltyDiscount, 0);
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
     // ===== NOUVEAU: LOYALTY EXTRAS DATA =====
     loyaltyData: {
       customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
       discountsApplied: validatedExtras.filter(e => e.loyaltyDiscountApplied).length,
       totalDiscount: validatedExtras.reduce((sum, e) => sum + e.loyaltyDiscount, 0),
       extrasWithDiscount: validatedExtras.filter(e => e.loyaltyDiscountApplied).map(e => e.name)
     }
   };

   // Notify customer
   socketService.sendUserNotification(booking.customer._id, 'EXTRAS_ADDED', {
     ...extrasData,
     message: `${validatedExtras.length} service(s) ajouté(s) à votre facture`,
     breakdown: validatedExtras.map((e) => ({
       name: e.name,
       quantity: e.quantity,
       price: e.price,
       originalPrice: e.originalPrice, // ===== NOUVEAU =====
       total: e.total,
       yieldAdjusted: e.yieldAdjusted,
       loyaltyDiscount: e.loyaltyDiscount, // ===== NOUVEAU =====
       savedAmount: e.originalPrice - e.price // ===== NOUVEAU =====
     })),
     // ===== NOUVEAU: LOYALTY EXTRAS MESSAGE =====
     loyaltyMessage: extrasData.loyaltyData.totalDiscount > 0 ? 
       `💳 ${extrasData.loyaltyData.totalDiscount.toFixed(2)}€ d'économies grâce à votre statut ${booking.customer.loyalty.tier}` : null
   });

   // Notify hotel billing
   socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_EXTRAS_ADDED', {
     ...extrasData,
     categories: [...new Set(validatedExtras.map((e) => e.category))],
     impact: {
       revenueIncrease: extrasTotal,
       newTotal: booking.totalPrice,
       yieldOptimized: validatedExtras.some((e) => e.yieldAdjusted),
       loyaltyOptimized: validatedExtras.some((e) => e.loyaltyDiscountApplied), // ===== NOUVEAU =====
     },
   });

   // Notify receptionist who added extras
   socketService.sendUserNotification(req.user.id, 'EXTRAS_ADDED_CONFIRMATION', {
     ...extrasData,
     message: 'Extras ajoutés avec succès',
     summary: `${validatedExtras.length} extra(s) pour un total de ${extrasTotal} EUR`,
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
         loyaltyOptimized: validatedExtras.some((e) => e.loyaltyDiscountApplied), // ===== NOUVEAU =====
       },
       // ===== NOUVEAU: LOYALTY EXTRAS SUMMARY =====
       loyaltySummary: booking.customer.loyalty?.tier ? {
         customerTier: booking.customer.loyalty.tier,
         discountsApplied: validatedExtras.filter(e => e.loyaltyDiscountApplied).length,
         totalSavings: validatedExtras.reduce((sum, e) => sum + e.loyaltyDiscount, 0),
         extrasWithDiscount: validatedExtras.filter(e => e.loyaltyDiscountApplied).map(e => e.name)
       } : null,
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
* GESTION ANNULATIONS WITH YIELD + LOYALTY IMPACT
* ================================
*/

/**
* @desc    Annuler une réservation avec analyse impact yield + loyalty
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
       .populate('customer', 'firstName lastName email loyalty') // ===== NOUVEAU: Include loyalty
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
     // ===== NOUVEAU: LOYALTY CANCELLATION HANDLING =====
     // ================================

     let loyaltyCancellationResult = { pointsRefunded: 0, pointsDeducted: 0 };

     if (booking.customer.loyalty?.enrolledAt) {
       try {
         console.log(`💳 Gestion annulation loyalty pour booking ${booking._id}`);

         // 1. Rembourser points utilisés pour réductions si applicable
         if (booking.loyaltyProgram?.pointsUsed > 0 && booking.loyaltyProgram?.transactionId) {
           const loyaltyService = getLoyaltyService();
           const pointsRefund = await loyaltyService.awardBonusPoints(
             booking.customer._id,
             'REFUND_CANCELLATION',
             booking.loyaltyProgram.pointsUsed,
             `Remboursement points suite annulation réservation ${booking._id}`,
             { 
               originalTransactionId: booking.loyaltyProgram.transactionId,
               cancelledBy: req.user.id,
               refundPolicy: refundPercentage
             }
           );

           if (pointsRefund.success) {
             loyaltyCancellationResult.pointsRefunded = booking.loyaltyProgram.pointsUsed;
             console.log(`✅ Points remboursés: ${booking.loyaltyProgram.pointsUsed} points`);
           }
         }

         // 2. Déduire points déjà attribués si réservation confirmée (penalty)
         if (booking.status === BOOKING_STATUS.CONFIRMED && booking.loyaltyProgram?.pointsEarned > 0) {
           const loyaltyService = getLoyaltyService();
           
           // Calculer pénalité selon timing d'annulation
           let pointsPenalty = booking.loyaltyProgram.pointsEarned;
           if (hoursUntilCheckIn >= 24) {
             pointsPenalty = Math.floor(booking.loyaltyProgram.pointsEarned * 0.5); // 50% penalty
           } else if (hoursUntilCheckIn >= 12) {
             pointsPenalty = Math.floor(booking.loyaltyProgram.pointsEarned * 0.75); // 75% penalty
           }
           // Sinon 100% penalty (pointsPenalty = pointsEarned)

           if (pointsPenalty > 0) {
             try {
               const currentUser = await User.findById(booking.customer._id).select('loyalty').lean();
               if (currentUser.loyalty.currentPoints >= pointsPenalty) {
                 const penaltyResult = await loyaltyService.redeemLoyaltyPoints(
                   booking.customer._id,
                   pointsPenalty,
                   `Pénalité annulation réservation ${booking._id}`
                 );
                 
                 if (penaltyResult.success) {
                   loyaltyCancellationResult.pointsDeducted = pointsPenalty;
                   console.log(`⚠️ Pénalité points appliquée: -${pointsPenalty} points`);
                 }
               } else {
                 console.warn(`⚠️ Solde insuffisant pour pénalité: ${currentUser.loyalty.currentPoints} < ${pointsPenalty}`);
               }
             } catch (penaltyError) {
               console.error('Erreur application pénalité points:', penaltyError);
             }
           }
         }

         // 3. Mettre à jour données loyalty de la réservation
         booking.loyaltyProgram = booking.loyaltyProgram || {};
         booking.loyaltyProgram.cancellationData = {
           cancelledAt: now,
           cancelledBy: req.user.id,
           pointsRefunded: loyaltyCancellationResult.pointsRefunded,
           pointsDeducted: loyaltyCancellationResult.pointsDeducted,
           hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
           refundPolicy: refundPercentage
         };

       } catch (loyaltyError) {
         console.error('Erreur gestion annulation loyalty:', loyaltyError);
         booking.loyaltyProgram = booking.loyaltyProgram || {};
         booking.loyaltyProgram.cancellationError = loyaltyError.message;
       }
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
         loyaltyImpact: loyaltyCancellationResult, // ===== NOUVEAU =====
       },
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD + LOYALTY IMPACT
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
       // ===== NOUVEAU: LOYALTY CANCELLATION DATA =====
       loyaltyImpact: {
         pointsRefunded: loyaltyCancellationResult.pointsRefunded,
         pointsDeducted: loyaltyCancellationResult.pointsDeducted,
         customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
         hadUsedPoints: booking.loyaltyProgram?.pointsUsed > 0,
         hadEarnedPoints: booking.loyaltyProgram?.pointsEarned > 0
       }
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
       // ===== NOUVEAU: LOYALTY CANCELLATION MESSAGE =====
       loyaltyInfo: {
         pointsRefunded: loyaltyCancellationResult.pointsRefunded,
         pointsDeducted: loyaltyCancellationResult.pointsDeducted,
         message: loyaltyCancellationResult.pointsRefunded > 0 ? 
           `💳 ${loyaltyCancellationResult.pointsRefunded} points remboursés sur votre compte` :
           loyaltyCancellationResult.pointsDeducted > 0 ?
           `⚠️ ${loyaltyCancellationResult.pointsDeducted} points déduits (pénalité annulation)` :
           null
       }
     });

     // Notify hotel with yield + loyalty insights
     socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_CANCELLED_NOTIFICATION', {
       ...cancellationData,
       roomsReleased: assignedRooms.length,
       revenueImpact: -booking.totalPrice,
       availability: 'Rooms now available for rebooking',
       yieldRecommendations: yieldImpact?.recommendedAction,
       // ===== NOUVEAU: LOYALTY INSIGHTS FOR HOTEL =====
       loyaltyInsights: {
         customerTier: booking.customer.loyalty?.tier,
         wasLoyalCustomer: booking.customer.loyalty?.lifetimePoints > 1000,
         impactOnCustomerRelation: loyaltyCancellationResult.pointsDeducted > 0 ? 'NEGATIVE' : 'NEUTRAL',
         retentionRisk: loyaltyCancellationResult.pointsDeducted > 0 ? 'MEDIUM' : 'LOW'
       }
     });

     // Notify admins for monitoring
     socketService.sendAdminNotification('BOOKING_CANCELLED', {
       ...cancellationData,
       financialImpact: {
         lostRevenue: booking.totalPrice - booking.refundAmount,
         refundAmount: booking.refundAmount,
         yieldImpact: yieldImpact?.revenueLoss,
       },
       // ===== NOUVEAU: LOYALTY ADMIN INSIGHTS =====
       loyaltyAdminInsights: {
         pointsMovement: {
           refunded: loyaltyCancellationResult.pointsRefunded,
           deducted: loyaltyCancellationResult.pointsDeducted,
           netImpact: loyaltyCancellationResult.pointsRefunded - loyaltyCancellationResult.pointsDeducted
         },
         customerImpact: booking.customer.loyalty?.tier,
         retentionRisk: loyaltyCancellationResult.pointsDeducted > 100 ? 'HIGH' : 'LOW'
       }
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
       loyaltyImpact: loyaltyCancellationResult, // ===== NOUVEAU =====
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
         loyaltyCustomer: booking.customer.loyalty?.tier !== 'BRONZE', // ===== NOUVEAU =====
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
         // ===== NOUVEAU: LOYALTY CANCELLATION RESULTS =====
         loyaltyResults: {
           customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
           pointsRefunded: loyaltyCancellationResult.pointsRefunded,
           pointsDeducted: loyaltyCancellationResult.pointsDeducted,
           netPointsImpact: loyaltyCancellationResult.pointsRefunded - loyaltyCancellationResult.pointsDeducted,
           explanation: loyaltyCancellationResult.pointsRefunded > 0 ? 
             'Points utilisés pour réduction remboursés' :
             loyaltyCancellationResult.pointsDeducted > 0 ?
             'Pénalité appliquée sur points gagnés' :
             'Aucun impact sur les points'
         },
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
           loyaltyNote: loyaltyCancellationResult.pointsDeducted > 0 ?
             'Contact service client pour questions sur points' : null
         },
         realTimeUpdates: {
           availabilityUpdated: true,
           notificationsSent: true,
           yieldAnalysisCompleted: !!yieldImpact,
           loyaltyProcessed: true, // ===== NOUVEAU =====
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
* ===== NOUVEAU: LOYALTY DISCOUNT ENDPOINT =====
* ================================
*/

/**
* @desc    Appliquer une réduction fidélité à une réservation existante
* @route   POST /api/bookings/:id/apply-loyalty-discount
* @access  Client (sa réservation) + Admin + Receptionist
*/
const applyLoyaltyDiscountToExistingBooking = async (req, res) => {
 const session = await mongoose.startSession();

 try {
   const { id } = req.params;
   const { pointsToUse, discountType = 'AMOUNT' } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide',
     });
   }

   if (!pointsToUse || pointsToUse <= 0) {
     return res.status(400).json({
       success: false,
       message: 'Nombre de points invalide',
     });
   }

   await session.withTransaction(async () => {
     const booking = await Booking.findById(id)
       .populate('customer', 'firstName lastName email loyalty')
       .session(session);

     if (!booking) {
       throw new Error('Réservation non trouvée');
     }

     // Check permissions
     if (req.user.role === USER_ROLES.CLIENT && booking.customer._id.toString() !== req.user.id) {
       throw new Error('Accès non autorisé à cette réservation');
     }

     // Check if discount can be applied
     if (![BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(booking.status)) {
       throw new Error('Réduction possible uniquement pour réservations en attente ou confirmées');
     }

     // Check if loyalty discount already applied
     if (booking.loyaltyProgram?.discountApplied) {
       throw new Error('Une réduction fidélité a déjà été appliquée à cette réservation');
     }

     // Verify user has enough points
     const eligibility = await checkDiscountEligibility(booking.customer._id, pointsToUse / 100);
     if (!eligibility.eligible) {
       throw new Error(eligibility.reason);
     }

     // Calculate discount amount
     const discountAmount = Math.min(
       pointsToUse / 100, // 100 points = 1 euro
       booking.totalPrice * 0.5 // Maximum 50% discount
     );

     // Apply the discount
     const redemptionResult = await quickRedeemPoints(
       booking.customer._id,
       pointsToUse,
       booking._id,
       { 
         source: 'BOOKING_DISCOUNT_APPLICATION',
         applyImmediately: true,
         session 
       }
     );

     if (!redemptionResult.success) {
       throw new Error(redemptionResult.message || 'Échec utilisation des points');
     }

     // Update booking
     booking.discounts = booking.discounts || [];
     booking.discounts.push({
       type: 'LOYALTY_POINTS',
       amount: discountAmount,
       description: `Réduction fidélité - ${pointsToUse} points`,
       pointsUsed: pointsToUse,
       transactionId: redemptionResult.transactionId,
       appliedAt: new Date(),
       appliedBy: req.user.id
     });

     booking.totalPrice = Math.max(0, booking.totalPrice - discountAmount);
     
     // Update loyalty program data
     booking.loyaltyProgram = booking.loyaltyProgram || {};
     booking.loyaltyProgram.discountApplied = true;
     booking.loyaltyProgram.pointsUsed = pointsToUse;
     booking.loyaltyProgram.discountAmount = discountAmount;
     booking.loyaltyProgram.transactionId = redemptionResult.transactionId;

     await booking.save({ session });

     // Real-time notifications
     socketService.sendUserNotification(booking.customer._id, 'LOYALTY_DISCOUNT_APPLIED', {
       bookingId: booking._id,
       pointsUsed: pointsToUse,
       discountAmount,
       newTotal: booking.totalPrice,
       remainingPoints: redemptionResult.remainingPoints,
       message: `💳 Réduction de ${discountAmount}€ appliquée avec ${pointsToUse} points`
     });

     // Notify hotel if admin/receptionist applied
     if (req.user.role !== USER_ROLES.CLIENT) {
       socketService.sendHotelNotification(booking.hotel, 'LOYALTY_DISCOUNT_APPLIED_STAFF', {
         bookingId: booking._id,
         customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
         discountAmount,
         appliedBy: req.user.id,
         customerTier: booking.customer.loyalty.tier
       });
     }

     res.status(200).json({
       success: true,
       message: 'Réduction fidélité appliquée avec succès',
       data: {
         booking: {
           id: booking._id,
           newTotal: booking.totalPrice,
           discountApplied: discountAmount
         },
         loyalty: {
           pointsUsed: pointsToUse,
           remainingPoints: redemptionResult.remainingPoints,
           transactionId: redemptionResult.transactionId,
           discountValue: discountAmount
         },
         savings: {
           amount: discountAmount,
           percentage: Math.round((discountAmount / (booking.totalPrice + discountAmount)) * 100),
           pointsRate: '100 points = 1€'
         }
       }
     });
   });

 } catch (error) {
   console.error('Erreur application réduction loyalty:', error);

   if (error.message.includes('non trouvée') || 
       error.message.includes('Accès') || 
       error.message.includes('possible') ||
       error.message.includes('Points')) {
     return res.status(400).json({
       success: false,
       message: error.message,
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors de l\'application de la réduction',
   });
 } finally {
   await session.endSession();
 }
};

/**
* ================================
* ===== NOUVEAU: LOYALTY HELPER UTILITIES =====
* ================================
*/

/**
* Calculer probabilité de retour client selon loyalty
*/
const calculateReturnLikelihood = (customerLoyalty) => {
if (!customerLoyalty || !customerLoyalty.tier) return 'LOW';

const tierLikelihood = {
  'BRONZE': 'MEDIUM',
  'SILVER': 'MEDIUM',
  'GOLD': 'HIGH',
  'PLATINUM': 'VERY_HIGH',
  'DIAMOND': 'VERY_HIGH'
};

return tierLikelihood[customerLoyalty.tier] || 'LOW';
};

/**
* ================================
* MODIFICATION RÉSERVATIONS WITH YIELD REPRICING + LOYALTY RECALCULATION
* ================================
*/

/**
* @desc    Modifier une réservation avec recalcul yield automatique + loyalty
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
     recalculateLoyaltyBenefits = true, // ===== NOUVEAU: Recalculer bénéfices loyalty =====
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
       .populate('customer', 'firstName lastName loyalty') // ===== NOUVEAU: Include loyalty
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
       loyaltyData: { ...booking.loyaltyProgram } // ===== NOUVEAU =====
     };

     let recalculatePrice = false;
     const modifications = [];
     let yieldRecalculation = null;
     let loyaltyRecalculation = null; // ===== NOUVEAU =====

     // ================================
     // REAL-TIME MODIFICATION TRACKING
     // ================================

     socketService.sendBookingNotification(booking._id, 'MODIFICATION_STARTED', {
       bookingId: booking._id,
       modifiedBy: req.user.id,
       timestamp: new Date(),
     });

     // ================================
     // DATE MODIFICATIONS WITH YIELD + LOYALTY REPRICING
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
     // ROOM MODIFICATIONS WITH YIELD + LOYALTY ANALYSIS
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
     // ===== NOUVEAU: LOYALTY BENEFITS RECALCULATION =====
     // ================================

     if (recalculatePrice && recalculateLoyaltyBenefits && booking.customer.loyalty?.enrolledAt) {
       try {
         console.log(`🎯 Recalcul bénéfices loyalty pour modification booking ${booking._id}`);

         // Obtenir le statut loyalty actuel
         const currentLoyaltyStatus = await quickGetStatus(booking.customer._id, true);
         
         loyaltyRecalculation = {
           originalData: originalData.loyaltyData,
           newCustomerTier: currentLoyaltyStatus?.user?.tier || booking.customer.loyalty.tier,
           benefits: {
             added: [],
             removed: [],
             modified: []
           }
         };

         // Recalculer bénéfices automatiques selon nouveau montant/durée
         if (currentLoyaltyStatus?.benefits?.active) {
           const applicableBenefits = currentLoyaltyStatus.benefits.active.filter(benefit => 
             benefit.type === 'DISCOUNT' && benefit.isActive && 
             benefit.validUntil > new Date() && benefit.usageCount < benefit.maxUsage
           );

           let loyaltyBenefitsDiscount = 0;
           for (const benefit of applicableBenefits) {
             if (benefit.type === 'DISCOUNT' && booking.totalPrice > 100) {
               const benefitDiscount = Math.min(
                 booking.totalPrice * (benefit.value / 100), 
                 booking.totalPrice * 0.2
               );
               loyaltyBenefitsDiscount += benefitDiscount;
               
               loyaltyRecalculation.benefits.added.push({
                 type: benefit.type,
                 description: benefit.description,
                 discountAmount: benefitDiscount
               });
             }
           }

           if (loyaltyBenefitsDiscount > 0) {
             booking.totalPrice = Math.max(0, booking.totalPrice - loyaltyBenefitsDiscount);
             
             // Mettre à jour données loyalty
             booking.loyaltyProgram = booking.loyaltyProgram || {};
             booking.loyaltyProgram.benefitsAppliedOnModification = {
               appliedAt: new Date(),
               totalDiscount: loyaltyBenefitsDiscount,
               benefits: loyaltyRecalculation.benefits.added,
               modifiedBy: req.user.id
             };

             modifications.push(
               `Bénéfices loyalty recalculés: -${loyaltyBenefitsDiscount.toFixed(2)}€`
             );

             loyaltyRecalculation.totalSavings = loyaltyBenefitsDiscount;
           }
         }

         // Recalculer points estimés à gagner selon nouveau montant
         const newEstimatedPoints = Math.floor(booking.totalPrice);
         const tierMultipliers = {
           'BRONZE': 1.0,
           'SILVER': 1.2,
           'GOLD': 1.5,
           'PLATINUM': 2.0,
           'DIAMOND': 2.5
         };
         
         const multiplier = tierMultipliers[loyaltyRecalculation.newCustomerTier] || 1.0;
         const finalEstimatedPoints = Math.floor(newEstimatedPoints * multiplier);

         loyaltyRecalculation.pointsToEarn = {
           original: booking.loyaltyProgram?.pointsToEarn || 0,
           new: finalEstimatedPoints,
           change: finalEstimatedPoints - (booking.loyaltyProgram?.pointsToEarn || 0)
         };

         if (booking.loyaltyProgram) {
           booking.loyaltyProgram.pointsToEarn = finalEstimatedPoints;
         }

         console.log(`✅ Recalcul loyalty terminé: ${loyaltyRecalculation.totalSavings || 0}€ d'économies`);

       } catch (loyaltyError) {
         console.error('Loyalty recalculation failed:', loyaltyError);
         loyaltyRecalculation = { error: 'Loyalty recalculation failed' };
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
         loyaltyRecalculated: !!loyaltyRecalculation && !loyaltyRecalculation.error, // ===== NOUVEAU =====
       },
     ];

     booking.updatedBy = req.user.id;
     booking.updatedAt = new Date();

     await booking.save({ session });

     // ================================
     // COMPREHENSIVE REAL-TIME NOTIFICATIONS WITH YIELD + LOYALTY DATA
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
       loyaltyRecalculation, // ===== NOUVEAU =====
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
         // ===== NOUVEAU: LOYALTY OPTIMIZATION NOTIFICATION =====
         loyaltyOptimization:
           loyaltyRecalculation && !loyaltyRecalculation.error
             ? {
                 totalSavings: loyaltyRecalculation.totalSavings || 0,
                 newTier: loyaltyRecalculation.newCustomerTier,
                 pointsToEarn: loyaltyRecalculation.pointsToEarn,
                 benefitsAdded: loyaltyRecalculation.benefits?.added || [],
                 message: loyaltyRecalculation.totalSavings > 0 ?
                   `💳 ${loyaltyRecalculation.totalSavings.toFixed(2)}€ d'économies supplémentaires grâce à votre fidélité` : null
               }
             : null,
       });
     }

     // Notify hotel with yield + loyalty insights
     socketService.sendHotelNotification(booking.hotel._id, 'BOOKING_MODIFIED_NOTIFICATION', {
       ...modificationData,
       impact: {
         datesChanged: newCheckInDate || newCheckOutDate,
         roomsChanged: roomModifications && roomModifications.length > 0,
         revenueImpact: booking.totalPrice - originalData.totalPrice,
         yieldOptimized: yieldRecalculation && !yieldRecalculation.error,
         loyaltyOptimized: loyaltyRecalculation && !loyaltyRecalculation.error, // ===== NOUVEAU =====
       },
       // ===== NOUVEAU: LOYALTY MODIFICATION INSIGHTS =====
       loyaltyInsights: loyaltyRecalculation ? {
         customerTier: loyaltyRecalculation.newCustomerTier,
         benefitsRecalculated: loyaltyRecalculation.benefits?.added?.length > 0,
         additionalSavings: loyaltyRecalculation.totalSavings || 0,
         pointsImpact: loyaltyRecalculation.pointsToEarn?.change || 0
       } : null
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
         loyaltyImpact: loyaltyRecalculation, // ===== NOUVEAU =====
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
         // ===== NOUVEAU: LOYALTY MODIFICATION RESULTS =====
         loyaltyProgram: loyaltyRecalculation ? {
           recalculated: !loyaltyRecalculation.error,
           customerTier: loyaltyRecalculation.newCustomerTier,
           additionalSavings: loyaltyRecalculation.totalSavings || 0,
           pointsToEarn: loyaltyRecalculation.pointsToEarn,
           benefitsApplied: loyaltyRecalculation.benefits?.added || [],
           error: loyaltyRecalculation.error
         } : null,
         requiresRevalidation: booking.status === BOOKING_STATUS.PENDING && recalculatePrice,
         realTimeUpdates: {
           notificationsSent: true,
           availabilityUpdated: true,
           yieldRecalculated: !!yieldRecalculation && !yieldRecalculation.error,
           loyaltyRecalculated: !!loyaltyRecalculation && !loyaltyRecalculation.error, // ===== NOUVEAU =====
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
* GÉNÉRATION FACTURES ET RAPPORTS WITH YIELD + LOYALTY DATA
* ================================
*/

/**
* @desc    Générer et obtenir la facture d'une réservation avec données yield + loyalty
* @route   GET /api/bookings/:id/invoice
* @access  Client (sa facture) + Staff
*/
const getBookingInvoice = async (req, res) => {
 try {
   const { id } = req.params;
   const { 
     format = 'json', 
     includeYieldData = false, 
     includeLoyaltyData = true // ===== NOUVEAU: Include loyalty data =====
   } = req.query;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID réservation invalide',
     });
   }

   const booking = await Booking.findById(id)
     .populate('hotel', 'name code address city phone email yieldManagement')
     .populate('customer', 'firstName lastName email phone address loyalty') // ===== NOUVEAU: Include loyalty
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
   // GENERATE INVOICE DATA WITH YIELD + LOYALTY INFORMATION
   // ================================

   const invoice = await generateInvoiceWithYieldData(booking, includeYieldData === 'true');

   // ===== NOUVEAU: Add comprehensive loyalty data to invoice =====
   if (includeLoyaltyData === 'true' && booking.loyaltyProgram && Object.keys(booking.loyaltyProgram).length > 0) {
     invoice.loyaltyProgram = {
       customerInfo: {
         tier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
         tierDisplay: getLoyaltyService().getTierDisplayName(booking.customer.loyalty?.tier),
         memberSince: booking.customer.loyalty?.enrolledAt,
         lifetimePoints: booking.customer.loyalty?.lifetimePoints || 0,
         currentPointsBeforeStay: booking.loyaltyProgram?.checkInData?.pointsBalanceAtCheckIn || 0
       },
       stayBenefits: {
         pointsUsedForDiscount: booking.loyaltyProgram.pointsUsed || 0,
         discountAmount: booking.loyaltyProgram.discountAmount || 0,
         benefitsApplied: booking.loyaltyProgram.benefitsApplied || [],
         vipTreatmentReceived: booking.loyaltyProgram.vipBenefitsApplied ? true : false,
         extrasDiscounts: booking.loyaltyProgram.totalLoyaltyDiscountOnExtras || 0
       },
       pointsEarned: {
         confirmationPoints: booking.loyaltyProgram.pointsEarned || 0,
         completionBonus: booking.loyaltyProgram.completionBonus?.pointsEarned || 0,
         totalEarnedThisStay: (booking.loyaltyProgram.pointsEarned || 0) + 
                             (booking.loyaltyProgram.completionBonus?.pointsEarned || 0),
         newPointsBalance: booking.loyaltyProgram.completionBonus?.pointsEarned ? 
           booking.loyaltyProgram.completionBonus.newBalance : 
           booking.customer.loyalty?.currentPoints || 0
       },
       tierProgress: {
         tierUpgradeTriggered: booking.loyaltyProgram.tierUpgradeTriggered || 
                              booking.loyaltyProgram.completionBonus?.tierUpgrade?.upgraded || false,
         newTier: booking.loyaltyProgram.tierUpgradeTriggered?.newTier || 
                 booking.loyaltyProgram.completionBonus?.tierUpgrade?.newTier,
         nextTierPoints: booking.customer.loyalty?.tierProgress?.pointsToNextTier || 0
       },
       totalSavings: {
         loyaltyDiscount: booking.loyaltyProgram.discountAmount || 0,
         benefitsDiscount: (booking.loyaltyProgram.benefitsApplied || []).reduce((sum, b) => sum + (b.discountAmount || 0), 0),
         extrasDiscount: booking.loyaltyProgram.totalLoyaltyDiscountOnExtras || 0,
         totalAmount: (booking.loyaltyProgram.discountAmount || 0) + 
                     (booking.loyaltyProgram.benefitsApplied || []).reduce((sum, b) => sum + (b.discountAmount || 0), 0) +
                     (booking.loyaltyProgram.totalLoyaltyDiscountOnExtras || 0)
       }
     };
     
     // Ajouter message de remerciement personnalisé selon niveau
     const tierMessages = {
       'BRONZE': 'Merci pour votre confiance !',
       'SILVER': 'Merci pour votre fidélité !',
       'GOLD': 'Un grand merci pour votre fidélité exceptionnelle !',
       'PLATINUM': 'Nos sincères remerciements pour votre fidélité remarquable !',
       'DIAMOND': 'Nous vous remercions infiniment pour votre fidélité extraordinaire !'
     };
     
     invoice.loyaltyProgram.personalizedMessage = tierMessages[booking.customer.loyalty?.tier] || 
       'Merci pour votre visite !';
   }

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
       // ===== NOUVEAU: LOYALTY INVOICE SUMMARY =====
       loyaltySummary: invoice.loyaltyProgram ? {
         totalSavingsThisStay: invoice.loyaltyProgram.totalSavings.totalAmount,
         pointsEarnedThisStay: invoice.loyaltyProgram.pointsEarned.totalEarnedThisStay,
         newTier: invoice.loyaltyProgram.tierProgress.newTier,
         tierUpgraded: invoice.loyaltyProgram.tierProgress.tierUpgradeTriggered,
         newPointsBalance: invoice.loyaltyProgram.pointsEarned.newPointsBalance,
         estimatedValue: Math.round((invoice.loyaltyProgram.pointsEarned.totalEarnedThisStay / 100) * 100) / 100
       } : null,
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
 * STATISTIQUES ET RAPPORTS WITH YIELD + LOYALTY ANALYTICS
 * ================================
 */

/**
 * @desc    Obtenir statistiques réservations pour dashboard avec données yield + loyalty
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
      includeLoyaltyAnalytics = true, // ===== NOUVEAU: Include loyalty analytics =====
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
    // PARALLEL STATISTICS QUERIES WITH YIELD + LOYALTY DATA
    // ================================

    const [statusStats, revenueStats, sourceStats, trendsData, occupancyData, yieldStats, loyaltyStats] =
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

        // ===== NOUVEAU: LOYALTY PROGRAM STATISTICS =====
        includeLoyaltyAnalytics === 'true'
          ? Booking.aggregate([
              { $match: { ...query, 'loyaltyProgram.discountApplied': true } },
              {
                $group: {
                  _id: null,
                  totalLoyaltyBookings: { $sum: 1 },
                  totalPointsUsed: { $sum: { $ifNull: ['$loyaltyProgram.pointsUsed', 0] } },
                  totalLoyaltyDiscount: { $sum: { $ifNull: ['$loyaltyProgram.discountAmount', 0] } },
                  totalPointsEarned: { $sum: { $ifNull: ['$loyaltyProgram.pointsEarned', 0] } },
                  avgDiscountPerBooking: { $avg: { $ifNull: ['$loyaltyProgram.discountAmount', 0] } },
                  vipTreatmentCount: { 
                    $sum: { $cond: ['$loyaltyProgram.vipBenefitsApplied', 1, 0] } 
                  },
                  tierUpgradesTriggered: { 
                    $sum: { $cond: ['$loyaltyProgram.tierUpgradeTriggered', 1, 0] } 
                  }
                },
              },
            ])
          : Promise.resolve([])
      ]);

    // ================================
    // PROCESS RESULTS WITH YIELD + LOYALTY INSIGHTS
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

    // ===== NOUVEAU: Process loyalty statistics =====
    const loyaltyAnalytics = loyaltyStats[0]
      ? {
          totalLoyaltyBookings: loyaltyStats[0].totalLoyaltyBookings,
          loyaltyAdoptionRate: Math.round(
            (loyaltyStats[0].totalLoyaltyBookings / totalStats.totalBookings) * 100
          ),
          totalPointsUsed: loyaltyStats[0].totalPointsUsed,
          totalLoyaltyDiscount: Math.round(loyaltyStats[0].totalLoyaltyDiscount * 100) / 100,
          totalPointsEarned: loyaltyStats[0].totalPointsEarned,
          avgDiscountPerBooking: Math.round(loyaltyStats[0].avgDiscountPerBooking * 100) / 100,
          vipTreatmentRate: Math.round(
            (loyaltyStats[0].vipTreatmentCount / totalStats.totalBookings) * 100
          ),
          tierUpgradesTriggered: loyaltyStats[0].tierUpgradesTriggered,
          pointsUtilizationRate: loyaltyStats[0].totalPointsEarned > 0 
            ? Math.round((loyaltyStats[0].totalPointsUsed / loyaltyStats[0].totalPointsEarned) * 100)
            : 0,
          avgPointsValueDiscount: loyaltyStats[0].totalPointsUsed > 0 
            ? Math.round((loyaltyStats[0].totalLoyaltyDiscount / (loyaltyStats[0].totalPointsUsed / 100)) * 100) / 100
            : 0
        }
      : null;

    // ================================
    // REAL-TIME DASHBOARD UPDATES WITH YIELD + LOYALTY DATA
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
        // ===== NOUVEAU: Real-time loyalty metrics =====
        loyaltyBookingsToday: await Booking.countDocuments({
          ...query,
          'loyaltyProgram.discountApplied': true,
          createdAt: {
            $gte: new Date(new Date().setHours(0, 0, 0, 0)),
            $lte: new Date(),
          },
        }),
        vipGuestsInHouse: hotelId ? await Booking.countDocuments({
          hotel: hotelId,
          status: BOOKING_STATUS.CHECKED_IN,
          'loyaltyProgram.vipBenefitsApplied': true
        }) : 0
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
        
        // ===== NOUVEAU: Loyalty Program Analytics =====
        loyaltyProgram: loyaltyAnalytics ? {
          ...loyaltyAnalytics,
          insights: {
            customerRetention: loyaltyAnalytics.loyaltyAdoptionRate > 25 ? 'GOOD' : 'NEEDS_IMPROVEMENT',
            revenueImpact: loyaltyAnalytics.totalLoyaltyDiscount > totalStats.totalRevenue * 0.05 ? 'SIGNIFICANT' : 'MODERATE',
            pointsEngagement: loyaltyAnalytics.pointsUtilizationRate > 30 ? 'HIGH' : loyaltyAnalytics.pointsUtilizationRate > 15 ? 'MEDIUM' : 'LOW',
            vipServiceLevel: loyaltyAnalytics.vipTreatmentRate > 10 ? 'EXCELLENT' : loyaltyAnalytics.vipTreatmentRate > 5 ? 'GOOD' : 'BASIC',
            growthPotential: loyaltyAnalytics.tierUpgradesTriggered > 5 ? 'HIGH_GROWTH' : 'STABLE'
          },
          recommendations: generateLoyaltyRecommendations(loyaltyAnalytics, totalStats)
        } : null,
        
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
 * NEW: YIELD MANAGEMENT SPECIFIC ENDPOINTS (UNCHANGED)
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
* ROUTES SPÉCIALISÉES POUR STAFF - ENHANCED WITH REAL-TIME + YIELD + LOYALTY
* ================================
*/

/**
* @desc    Obtenir réservations en attente de validation avec priorité yield + loyalty
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
     prioritizeLoyalty = true, // ===== NOUVEAU: Prioritize by loyalty value =====
   } = req.query;

   let sortOptions = {};

   if (prioritizeYield === 'true' && prioritizeLoyalty === 'true') {
     // Sort by combined yield + loyalty impact
     sortOptions = {
       // High-value loyalty customers first
       'customer.loyalty.tier': -1,
       totalPrice: -1, // Higher revenue bookings
       createdAt: sortOrder === 'desc' ? -1 : 1,
     };
   } else if (prioritizeYield === 'true') {
     // Sort by yield impact (revenue potential) first, then by creation date
     sortOptions = {
       totalPrice: -1, // Higher revenue bookings first
       createdAt: sortOrder === 'desc' ? -1 : 1,
     };
   } else if (prioritizeLoyalty === 'true') {
     // Sort by loyalty value first
     sortOptions = {
       'customer.loyalty.lifetimePoints': -1, // High-value customers first
       createdAt: sortOrder === 'desc' ? -1 : 1,
     };
   } else {
     sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
   }

   const pendingBookings = await Booking.find({
     status: BOOKING_STATUS.PENDING,
   })
     .populate('hotel', 'name code city yieldManagement')
     .populate('customer', 'firstName lastName email phone loyalty') // ===== NOUVEAU: Include loyalty
     .sort(sortOptions)
     .limit(parseInt(limit))
     .select('-__v');

   // Calculate processing delays, yield impact, and loyalty value
   const bookingsWithAnalysis = pendingBookings.map((booking) => {
     const hoursWaiting = Math.round((Date.now() - booking.createdAt) / (1000 * 60 * 60));
     let priority = hoursWaiting > 48 ? 'high' : hoursWaiting > 24 ? 'medium' : 'normal';

     // Increase priority for high-value bookings
     if (booking.totalPrice > 1000) {
       priority = priority === 'normal' ? 'medium' : priority === 'medium' ? 'high' : 'critical';
     }

     // ===== NOUVEAU: Increase priority for loyalty customers =====
     if (booking.customer.loyalty?.tier && ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier)) {
       priority = priority === 'normal' ? 'high' : priority === 'medium' ? 'high' : 'critical';
     }

     // Add yield analysis
     const yieldImpact = {
       revenueValue: booking.totalPrice,
       demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
       yieldOptimized: booking.yieldManagement?.enabled || false,
       businessImpact: calculateBusinessImpact(booking),
     };

     // ===== NOUVEAU: Add loyalty analysis =====
     const loyaltyImpact = {
       customerTier: booking.customer.loyalty?.tier || 'NON_INSCRIT',
       lifetimeValue: booking.customer.loyalty?.lifetimePoints || 0,
       currentPoints: booking.customer.loyalty?.currentPoints || 0,
       isVIPCustomer: ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty?.tier),
       hasUsedPoints: booking.loyaltyProgram?.pointsUsed > 0,
       pointsAtRisk: booking.loyaltyProgram?.pointsUsed || 0, // Points to refund if rejected
       retentionRisk: calculateRetentionRisk(booking.customer.loyalty),
       customerValue: calculateCustomerValue(booking.customer.loyalty, booking.totalPrice)
     };

     return {
       ...booking.toObject(),
       waitingTime: {
         hours: hoursWaiting,
         priority,
         urgent: hoursWaiting > 48 || booking.totalPrice > 2000 || loyaltyImpact.isVIPCustomer,
       },
       yieldImpact,
       loyaltyImpact, // ===== NOUVEAU =====
       combinedPriority: calculateCombinedPriority(yieldImpact, loyaltyImpact, hoursWaiting) // ===== NOUVEAU =====
     };
   });

   // ===== NOUVEAU: Sort by combined priority if both prioritization enabled =====
   if (prioritizeYield === 'true' && prioritizeLoyalty === 'true') {
     bookingsWithAnalysis.sort((a, b) => b.combinedPriority - a.combinedPriority);
   }

   // ================================
   // REAL-TIME PENDING BOOKINGS TRACKING WITH YIELD + LOYALTY PRIORITY
   // ================================

   if (realTime === 'true') {
     // Subscribe admin to pending bookings updates
     socketService.sendAdminNotification('PENDING_BOOKINGS_SUBSCRIPTION', {
       adminId: req.user.id,
       totalPending: pendingBookings.length,
       urgentCount: bookingsWithAnalysis.filter((b) => b.waitingTime.urgent).length,
       highValueCount: bookingsWithAnalysis.filter((b) => b.yieldImpact.revenueValue > 1000)
         .length,
       vipCustomersCount: bookingsWithAnalysis.filter((b) => b.loyaltyImpact.isVIPCustomer).length, // ===== NOUVEAU =====
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
           customerTier: b.loyaltyImpact.customerTier, // ===== NOUVEAU =====
           isVIP: b.loyaltyImpact.isVIPCustomer, // ===== NOUVEAU =====
           retentionRisk: b.loyaltyImpact.retentionRisk // ===== NOUVEAU =====
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
         vipCustomers: bookingsWithAnalysis.filter((b) => b.loyaltyImpact.isVIPCustomer).length, // ===== NOUVEAU =====
         totalPotentialRevenue: bookingsWithAnalysis.reduce(
           (sum, b) => sum + b.yieldImpact.revenueValue,
           0
         ),
         totalLifetimeValue: bookingsWithAnalysis.reduce(
           (sum, b) => sum + b.loyaltyImpact.lifetimeValue,
           0
         ), // ===== NOUVEAU =====
         averageWaitTime:
           Math.round(
             bookingsWithAnalysis.reduce((sum, b) => sum + b.waitingTime.hours, 0) /
               bookingsWithAnalysis.length
           ) || 0,
         pointsAtRisk: bookingsWithAnalysis.reduce(
           (sum, b) => sum + b.loyaltyImpact.pointsAtRisk,
           0
         ), // ===== NOUVEAU =====
       },
       actions: {
         validateAll: '/api/bookings/bulk-validate',
         autoValidate: '/api/bookings/auto-validate',
         yieldOptimize: '/api/bookings/yield/bulk-optimize',
         prioritizeVIP: '/api/bookings/prioritize-vip', // ===== NOUVEAU =====
       },
       realTimeTracking: {
         enabled: realTime === 'true',
         alertsEnabled: true,
         urgentThreshold: '48 hours',
         yieldPrioritized: prioritizeYield === 'true',
         loyaltyPrioritized: prioritizeLoyalty === 'true', // ===== NOUVEAU =====
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
* @desc    Obtenir réservations pour check-in aujourd'hui avec données yield + loyalty
* @route   GET /api/bookings/checkin-today
* @access  Admin + Receptionist
*/
const getTodayCheckIns = async (req, res) => {
 try {
   const { hotelId, realTime = false, includeYieldData = true, includeLoyaltyData = true } = req.query;

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
     .populate('customer', 'firstName lastName email phone loyalty') // ===== NOUVEAU: Include loyalty
     .populate('rooms.room', 'number type floor')
     .sort({ checkInDate: 1 })
     .select('-__v');

   // Analyze preparation status with yield + loyalty insights
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

     // ===== NOUVEAU: Add loyalty insights =====
     const loyaltyInsights =
       includeLoyaltyData === 'true' && booking.customer.loyalty?.enrolledAt
         ? {
             customerTier: booking.customer.loyalty.tier || 'BRONZE',
             lifetimeValue: booking.customer.loyalty.lifetimePoints || 0,
             currentPoints: booking.customer.loyalty.currentPoints || 0,
             isVIPGuest: ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier),
             pointsToEarn: booking.loyaltyProgram?.pointsToEarn || Math.floor(booking.totalPrice),
             hasUsedPoints: booking.loyaltyProgram?.pointsUsed > 0,
             vipTreatmentRequired: ['PLATINUM', 'DIAMOND'].includes(booking.customer.loyalty.tier),
             specialServices: booking.loyaltyProgram?.vipBenefitsApplied?.benefits || [],
             memberSince: booking.customer.loyalty.enrolledAt,
             preferredGuest: (booking.customer.loyalty.lifetimePoints || 0) > 5000
           }
         : null;

     return {
       ...booking.toObject(),
       preparationStatus: {
         roomsAssigned,
         totalRooms,
         readyForCheckIn,
         assignmentPercentage: Math.round((roomsAssigned / totalRooms) * 100),
         vipPriority: loyaltyInsights?.isVIPGuest || false, // ===== NOUVEAU =====
       },
       yieldInsights,
       loyaltyInsights, // ===== NOUVEAU =====
     };
   });

   // ===== NOUVEAU: Sort VIP guests first =====
   if (includeLoyaltyData === 'true') {
     checkInsWithStatus.sort((a, b) => {
       // VIP guests first
       if (a.loyaltyInsights?.isVIPGuest && !b.loyaltyInsights?.isVIPGuest) return -1;
       if (!a.loyaltyInsights?.isVIPGuest && b.loyaltyInsights?.isVIPGuest) return 1;
       
       // Then by preparation status
       if (a.preparationStatus.readyForCheckIn && !b.preparationStatus.readyForCheckIn) return -1;
       if (!a.preparationStatus.readyForCheckIn && b.preparationStatus.readyForCheckIn) return 1;
       
       // Finally by check-in time
       return new Date(a.checkInDate) - new Date(b.checkInDate);
     });
   }

   // ================================
   // REAL-TIME CHECK-IN TRACKING WITH YIELD + LOYALTY DATA
   // ================================

   if (realTime === 'true') {
     // Subscribe to real-time check-in updates
     const subscriptionData = {
       userId: req.user.id,
       hotelId: hotelId || 'ALL',
       date: today,
       totalCheckIns: todayCheckIns.length,
       readyCount: checkInsWithStatus.filter((b) => b.preparationStatus.readyForCheckIn).length,
       vipGuestsCount: checkInsWithStatus.filter((b) => b.loyaltyInsights?.isVIPGuest).length, // ===== NOUVEAU =====
       totalRevenueToday: checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0),
       totalLoyaltyValue: checkInsWithStatus.reduce((sum, b) => sum + (b.loyaltyInsights?.lifetimeValue || 0), 0), // ===== NOUVEAU =====
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
         vipGuestsUnprepared: unpreparedBookings.filter(b => b.loyaltyInsights?.isVIPGuest).length, // ===== NOUVEAU =====
         urgentPreparations: unpreparedBookings.map((b) => ({
           bookingId: b._id,
           customer: `${b.customer.firstName} ${b.customer.lastName}`,
           roomsNeeded: b.preparationStatus.totalRooms,
           roomsAssigned: b.preparationStatus.roomsAssigned,
           revenueValue: b.totalPrice,
           yieldOptimized: b.yieldInsights?.yieldOptimized,
           isVIPGuest: b.loyaltyInsights?.isVIPGuest, // ===== NOUVEAU =====
           customerTier: b.loyaltyInsights?.customerTier, // ===== NOUVEAU =====
           specialRequirements: b.loyaltyInsights?.vipTreatmentRequired // ===== NOUVEAU =====
         })),
         action: 'ROOM_ASSIGNMENT_NEEDED',
       };

       if (hotelId) {
         socketService.sendHotelNotification(hotelId, 'PREPARATION_ALERT', alertData);
       } else {
         socketService.sendAdminNotification('PREPARATION_ALERT', alertData);
       }
     }

     // Real-time occupancy update with revenue + loyalty impact
     if (hotelId) {
       const currentOccupancy = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);
       const expectedRevenue = checkInsWithStatus.reduce((sum, b) => sum + b.totalPrice, 0);
       const vipRevenue = checkInsWithStatus
         .filter(b => b.loyaltyInsights?.isVIPGuest)
         .reduce((sum, b) => sum + b.totalPrice, 0); // ===== NOUVEAU =====

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
         vipGuestsRevenue: vipRevenue, // ===== NOUVEAU =====
         vipGuestsCount: checkInsWithStatus.filter(b => b.loyaltyInsights?.isVIPGuest).length, // ===== NOUVEAU =====
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
         // ===== NOUVEAU: Loyalty management summary =====
         vipGuests: checkInsWithStatus.filter((b) => b.loyaltyInsights?.isVIPGuest).length,
         loyaltyMembers: checkInsWithStatus.filter((b) => b.loyaltyInsights?.customerTier !== 'NON_INSCRIT').length,
         totalLoyaltyValue: checkInsWithStatus.reduce((sum, b) => sum + (b.loyaltyInsights?.lifetimeValue || 0), 0),
         vipRevenue: checkInsWithStatus
           .filter(b => b.loyaltyInsights?.isVIPGuest)
           .reduce((sum, b) => sum + b.totalPrice, 0),
         pointsToBeAwarded: checkInsWithStatus.reduce((sum, b) => sum + (b.loyaltyInsights?.pointsToEarn || 0), 0),
         specialServiceRequired: checkInsWithStatus.filter(b => b.loyaltyInsights?.vipTreatmentRequired).length
       },
       actions: {
         autoAssignAll: '/api/rooms/bulk-assign',
         massCheckIn: '/api/bookings/bulk-checkin',
         optimizeRemaining: '/api/bookings/yield/optimize-checkins',
         prepareVipServices: '/api/bookings/prepare-vip-services', // ===== NOUVEAU =====
         prioritizeVipRooms: '/api/rooms/prioritize-vip', // ===== NOUVEAU =====
       },
       realTimeTracking: {
         enabled: realTime === 'true',
         preparationAlerts: true,
         occupancyTracking: !!hotelId,
         yieldTracking: includeYieldData === 'true',
         loyaltyTracking: includeLoyaltyData === 'true', // ===== NOUVEAU =====
         vipPriorityEnabled: true, // ===== NOUVEAU =====
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
* ===== NOUVEAU: LOYALTY HELPER UTILITIES FUNCTIONS =====
* ================================
*/

/**
* Calculer le risque de rétention selon profil loyalty
*/
const calculateRetentionRisk = (customerLoyalty) => {
 if (!customerLoyalty || !customerLoyalty.tier) return 'LOW';
 
 const tier = customerLoyalty.tier;
 const lifetimePoints = customerLoyalty.lifetimePoints || 0;
 const lastActivity = customerLoyalty.statistics?.lastActivity;
 
 // Clients VIP ont un risque plus élevé s'ils partent
 if (['PLATINUM', 'DIAMOND'].includes(tier)) {
   if (lastActivity && (Date.now() - new Date(lastActivity)) > 90 * 24 * 60 * 60 * 1000) {
     return 'VERY_HIGH'; // Pas d'activité depuis 3 mois
   }
   return 'HIGH'; // VIP toujours à risque élevé
 }
 
 if (tier === 'GOLD' && lifetimePoints > 10000) {
   return 'MEDIUM';
 }
 
 return 'LOW';
};

/**
* Calculer la valeur client combinée
*/
const calculateCustomerValue = (customerLoyalty, currentBookingValue) => {
 if (!customerLoyalty) return currentBookingValue;
 
 const lifetimePoints = customerLoyalty.lifetimePoints || 0;
 const lifetimeValue = lifetimePoints / 100; // Approximation 100 points = 1€ dépensé
 
 // Moyenne pondérée entre valeur historique et réservation actuelle
 return Math.round((lifetimeValue * 0.7 + currentBookingValue * 0.3) * 100) / 100;
};

/**
* Calculer priorité combinée yield + loyalty
*/
const calculateCombinedPriority = (yieldImpact, loyaltyImpact, hoursWaiting) => {
 let score = 0;
 
 // Score yield (0-40 points)
 score += Math.min(yieldImpact.revenueValue / 50, 40); // Max 40 pour 2000€
 
 // Score loyalty (0-40 points)
 const tierScores = { 'BRONZE': 5, 'SILVER': 10, 'GOLD': 20, 'PLATINUM': 35, 'DIAMOND': 40 };
 score += tierScores[loyaltyImpact.customerTier] || 0;
 
 // Score temps d'attente (0-20 points)
 score += Math.min(hoursWaiting / 2.4, 20); // Max 20 pour 48h
 
 return Math.round(score);
};

/**
* Générer recommandations loyalty pour dashboard
*/
const generateLoyaltyRecommendations = (loyaltyAnalytics, totalStats) => {
 const recommendations = [];
 
 if (!loyaltyAnalytics) return recommendations;
 
 // Recommandation adoption
 if (loyaltyAnalytics.loyaltyAdoptionRate < 25) {
   recommendations.push({
     type: 'adoption',
     priority: 'HIGH',
     title: 'Améliorer l\'adoption du programme',
     description: `Seulement ${loyaltyAnalytics.loyaltyAdoptionRate}% des réservations utilisent le programme`,
     actions: ['Promouvoir à l\'accueil', 'Offres d\'inscription', 'Formation staff']
   });
 }
 
 // Recommandation utilisation points
 if (loyaltyAnalytics.pointsUtilizationRate < 20) {
   recommendations.push({
     type: 'engagement',
     priority: 'MEDIUM',
     title: 'Encourager l\'utilisation des points',
     description: `Taux d'utilisation faible: ${loyaltyAnalytics.pointsUtilizationRate}%`,
     actions: ['Rappels d\'expiration', 'Offres spéciales', 'Faciliter utilisation']
   });
 }
 
 // Recommandation VIP
 if (loyaltyAnalytics.vipTreatmentRate < 5) {
   recommendations.push({
     type: 'vip_service',
     priority: 'MEDIUM', 
     title: 'Améliorer le service VIP',
     description: 'Peu de clients reçoivent un traitement VIP',
     actions: ['Identifier clients VIP', 'Former équipes', 'Créer protocoles']
   });
 }
 
 return recommendations;
};

/**
* ================================
* HELPER FUNCTIONS POUR COMPATIBILITY (KEEP ALL EXISTING ONES)
* ================================
*/

// [Toutes les fonctions helper existantes restent inchangées...]
// calculateAverageYieldMultiplier, getCurrentDemandLevel, calculateAverageDiscount, etc.

/**
* Obtenir nom d'affichage du niveau
*/
const getTierDisplayName = (tier) => {
 const names = {
   'BRONZE': 'Bronze',
   'SILVER': 'Argent', 
   'GOLD': 'Or',
   'PLATINUM': 'Platine',
   'DIAMOND': 'Diamant'
 };
 return names[tier] || 'Bronze';
};

/**
* ================================
* KEEP ALL EXISTING HELPER FUNCTIONS UNCHANGED
* ================================
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

const calculateAverageDiscount = (yieldPricingDetails) => {
 if (!yieldPricingDetails || yieldPricingDetails.length === 0) return 0;

 const totalDiscount = yieldPricingDetails.reduce((sum, detail) => {
   const discount = detail.basePrice - detail.finalPrice;
   return sum + (discount > 0 ? discount : 0);
 }, 0);

 const totalBase = yieldPricingDetails.reduce((sum, detail) => sum + detail.basePrice, 0);

 return totalBase > 0 ? Math.round((totalDiscount / totalBase) * 100) : 0;
};

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

const determinePric