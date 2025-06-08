/**
 * BOOKING WORKFLOW - GESTION AVANCÉE DU CYCLE DE VIE RÉSERVATIONS + REAL-TIME NOTIFICATIONS
 * Système complet de gestion des transitions d'état et business rules avec notifications temps réel
 * 
 * Workflow supporté :
 * PENDING → CONFIRMED → CHECKED_IN → COMPLETED
 *        ↘ REJECTED   ↘ CANCELLED   ↘ NO_SHOW
 * 
 * Fonctionnalités :
 * - Validation transitions avec business rules
 * - Actions automatiques selon changements statut
 * - Notifications système et emails + TEMPS RÉEL via Socket.io
 * - Gestion timeouts et escalation
 * - Rollback et compensation en cas d'erreur
 * - Metrics et audit trail complets
 * - Broadcasting real-time updates to all stakeholders
 */

const mongoose = require('mongoose');

// Socket.io service for real-time notifications
const socketService = require('../services/socketService'); // AJOUTÉ

const {
  BOOKING_STATUS,
  BOOKING_STATUS_TRANSITIONS,
  ROOM_STATUS,
  USER_ROLES,
  BUSINESS_RULES,
  ERROR_MESSAGES,
  canTransitionBookingStatus
} = require('./constants');

const { invalidateHotelCache } = require('./availability');

/**
 * ================================
 * CORE WORKFLOW ENGINE
 * ================================
 */

/**
 * Effectue une transition de statut avec toutes les validations et actions
 * @param {string} bookingId - ID de la réservation
 * @param {string} newStatus - Nouveau statut souhaité
 * @param {Object} transitionData - Données de la transition
 * @param {Object} user - Utilisateur effectuant la transition
 * @param {Object} session - Session MongoDB (optionnel)
 * @returns {Object} Résultat de la transition
 */
const executeStatusTransition = async (bookingId, newStatus, transitionData, user, session = null) => {
  const Booking = require('../models/Booking');
  
  try {
    // ================================
    // 1. RÉCUPÉRATION ET VALIDATION INITIALE
    // ================================
    
    const booking = await Booking.findById(bookingId)
      .populate('hotel', 'name code')
      .populate('customer', 'firstName lastName email')
      .session(session);

    if (!booking) {
      throw new WorkflowError('BOOKING_NOT_FOUND', ERROR_MESSAGES.BOOKING_NOT_FOUND);
    }

    const currentStatus = booking.status;

    // Vérifier transition autorisée
    if (!canTransitionBookingStatus(currentStatus, newStatus)) {
      throw new WorkflowError(
        'INVALID_TRANSITION',
        `Transition ${currentStatus} → ${newStatus} non autorisée`
      );
    }

    // ================================
    // 2. VALIDATIONS SPÉCIFIQUES PAR TRANSITION
    // ================================
    
    const validationResult = await validateTransition(booking, newStatus, transitionData, user);
    if (!validationResult.valid) {
      throw new WorkflowError('VALIDATION_FAILED', validationResult.error);
    }

    // ================================
    // 3. NOTIFICATIONS PRÉ-TRANSITION - NOUVEAU
    // ================================
    
    await sendPreTransitionNotifications(booking, currentStatus, newStatus, user, transitionData);

    // ================================
    // 4. ACTIONS PRÉ-TRANSITION
    // ================================
    
    const preTransitionResult = await executePreTransitionActions(
      booking, 
      currentStatus, 
      newStatus, 
      transitionData, 
      user, 
      session
    );

    // ================================
    // 5. MISE À JOUR STATUT
    // ================================
    
    const statusUpdate = {
      status: newStatus,
      updatedBy: user.id,
      updatedAt: new Date(),
      statusHistory: [
        ...(booking.statusHistory || []),
        {
          previousStatus: currentStatus,
          newStatus,
          reason: transitionData.reason || `Transition vers ${newStatus}`,
          changedBy: user.id,
          changedAt: new Date(),
          metadata: transitionData.metadata || {}
        }
      ]
    };

    // Ajouter champs spécifiques selon statut
    Object.assign(statusUpdate, getStatusSpecificFields(newStatus, transitionData, user));

    const updatedBooking = await Booking.findByIdAndUpdate(
      bookingId,
      { $set: statusUpdate },
      { new: true, session }
    ).populate('hotel', 'name code')
     .populate('customer', 'firstName lastName email');

    // ================================
    // 6. ACTIONS POST-TRANSITION
    // ================================
    
    const postTransitionResult = await executePostTransitionActions(
      updatedBooking,
      currentStatus,
      newStatus,
      transitionData,
      user,
      session
    );

    // ================================
    // 7. NOTIFICATIONS TEMPS RÉEL POST-TRANSITION - NOUVEAU
    // ================================
    
    await sendPostTransitionNotifications(
      updatedBooking, 
      currentStatus, 
      newStatus, 
      user, 
      transitionData,
      preTransitionResult,
      postTransitionResult
    );
    
    // Invalidation cache si nécessaire
    if (shouldInvalidateCache(currentStatus, newStatus)) {
      invalidateHotelCache(booking.hotel._id);
      
      // Broadcast availability update en temps réel
      await broadcastAvailabilityChange(updatedBooking, currentStatus, newStatus, postTransitionResult);
    }

    // Notifications traditionnelles (emails, etc.)
    await scheduleTransitionNotifications(updatedBooking, currentStatus, newStatus, user);

    // ================================
    // 8. RETOUR RÉSULTAT
    // ================================
    
    return {
      success: true,
      booking: updatedBooking,
      transition: {
        from: currentStatus,
        to: newStatus,
        executedBy: user.id,
        executedAt: new Date(),
        reason: transitionData.reason
      },
      preTransitionActions: preTransitionResult,
      postTransitionActions: postTransitionResult,
      nextAvailableActions: getAvailableTransitions(newStatus, user.role),
      notifications: {
        realTimeSent: true,
        emailsScheduled: true,
        stakeholdersNotified: true
      }
    };

  } catch (error) {
    // ================================
    // GESTION D'ERREUR AVEC NOTIFICATIONS - NOUVEAU
    // ================================
    
    // Notifier l'erreur en temps réel
    if (booking && booking.customer && booking.hotel) {
      await sendWorkflowErrorNotifications(booking, currentStatus, newStatus, user, error);
    }
    
    // Rollback si session fournie
    if (session) {
      await session.abortTransaction();
    }
    
    if (error instanceof WorkflowError) {
      throw error;
    }
    
    throw new WorkflowError('TRANSITION_FAILED', `Erreur transition: ${error.message}`);
  }
};

/**
 * ================================
 * NOTIFICATIONS TEMPS RÉEL - NOUVEAU
 * ================================
 */

/**
 * Envoie les notifications avant la transition
 */
const sendPreTransitionNotifications = async (booking, fromStatus, toStatus, user, transitionData) => {
  const transitionData_safe = {
    bookingId: booking._id,
    fromStatus,
    toStatus,
    userId: booking.customer._id,
    hotelId: booking.hotel._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    hotelName: booking.hotel.name,
    initiatedBy: user.id,
    userRole: user.role,
    timestamp: new Date()
  };

  // Notification de début de transition
  socketService.sendBookingNotification(booking._id, 'TRANSITION_STARTED', {
    ...transitionData_safe,
    message: `Début transition ${fromStatus} → ${toStatus}`,
    estimated_duration: getEstimatedTransitionTime(fromStatus, toStatus)
  });

  // Notifications spéciales selon le type de transition
  switch (toStatus) {
    case BOOKING_STATUS.CONFIRMED:
      // Notifier l'équipe de l'hôtel qu'une validation est en cours
      socketService.sendHotelNotification(booking.hotel._id.toString(), 'BOOKING_VALIDATION_IN_PROGRESS', {
        bookingId: booking._id,
        customerName: transitionData_safe.customerName,
        validatedBy: user.id,
        message: 'Validation de réservation en cours...'
      });
      break;

    case BOOKING_STATUS.CHECKED_IN:
      // Notifier préparation check-in
      socketService.sendHotelNotification(booking.hotel._id.toString(), 'CHECKIN_PREPARATION', {
        bookingId: booking._id,
        customerName: transitionData_safe.customerName,
        roomAssignments: transitionData.roomAssignments || [],
        message: 'Préparation check-in en cours...'
      });
      break;

    case BOOKING_STATUS.CANCELLED:
      // Pré-notifier annulation pour préparation
      socketService.sendAdminNotification('CANCELLATION_INITIATED', {
        bookingId: booking._id,
        customerName: transitionData_safe.customerName,
        hotelName: booking.hotel.name,
        reason: transitionData.reason || 'Non spécifiée',
        refundEstimated: true
      });
      break;
  }
};

/**
 * Envoie les notifications après la transition réussie
 */
const sendPostTransitionNotifications = async (booking, fromStatus, toStatus, user, transitionData, preActions, postActions) => {
  const baseNotificationData = {
    bookingId: booking._id,
    fromStatus,
    toStatus,
    userId: booking.customer._id,
    hotelId: booking.hotel._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    hotelName: booking.hotel.name,
    transitionBy: user.id,
    userRole: user.role,
    completedAt: new Date(),
    success: true
  };

  // ================================
  // NOTIFICATIONS GÉNÉRALES
  // ================================
  
  // Notification générale de transition complétée
  socketService.sendBookingNotification(booking._id, 'TRANSITION_COMPLETED', {
    ...baseNotificationData,
    message: `Transition ${fromStatus} → ${toStatus} réussie`,
    actions: {
      preTransition: preActions?.length || 0,
      postTransition: postActions?.length || 0
    }
  });

  // ================================
  // NOTIFICATIONS SPÉCIFIQUES PAR STATUT
  // ================================
  
  switch (toStatus) {
    case BOOKING_STATUS.CONFIRMED:
      await sendConfirmationNotifications(booking, user, transitionData, baseNotificationData);
      break;

    case BOOKING_STATUS.REJECTED:
      await sendRejectionNotifications(booking, user, transitionData, baseNotificationData);
      break;

    case BOOKING_STATUS.CHECKED_IN:
      await sendCheckInNotifications(booking, user, transitionData, postActions, baseNotificationData);
      break;

    case BOOKING_STATUS.COMPLETED:
      await sendCheckOutNotifications(booking, user, transitionData, postActions, baseNotificationData);
      break;

    case BOOKING_STATUS.CANCELLED:
      await sendCancellationNotifications(booking, user, transitionData, preActions, baseNotificationData);
      break;
  }
};

/**
 * Notifications spécifiques pour confirmation
 */
const sendConfirmationNotifications = async (booking, user, transitionData, baseData) => {
  // Client notification
  socketService.sendUserNotification(booking.customer._id.toString(), 'BOOKING_CONFIRMED_WORKFLOW', {
    bookingId: booking._id,
    message: `Fantastique! Votre réservation à ${booking.hotel.name} est confirmée!`,
    hotelName: booking.hotel.name,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    totalAmount: booking.totalPrice,
    confirmedBy: user.id,
    priceAdjusted: transitionData.priceModification || false,
    nextSteps: {
      checkIn: 'Présentez-vous à la réception le jour J',
      contact: 'L\'hôtel vous contactera si nécessaire',
      modifications: 'Modifications limitées désormais'
    },
    confirmation: {
      number: `CONF-${booking._id.toString().slice(-8).toUpperCase()}`,
      validUntil: booking.checkInDate
    }
  });

  // Hotel notification
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'NEW_CONFIRMED_BOOKING_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    customerEmail: booking.customer.email,
    checkInDate: booking.checkInDate,
    checkOutDate: booking.checkOutDate,
    roomCount: booking.rooms.length,
    roomTypes: [...new Set(booking.rooms.map(r => r.type))],
    totalAmount: booking.totalPrice,
    confirmedBy: user.id,
    preparation: {
      daysUntilArrival: Math.ceil((new Date(booking.checkInDate) - new Date()) / (1000 * 60 * 60 * 24)),
      roomAssignmentNeeded: true,
      specialRequests: booking.specialRequests || 'Aucune'
    }
  });

  // Admin notification for important bookings
  const bookingValue = booking.totalPrice;
  const isVIPBooking = bookingValue > 5000 || booking.rooms.length > 3;
  
  if (isVIPBooking) {
    socketService.sendAdminNotification('VIP_BOOKING_CONFIRMED', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      value: bookingValue,
      roomCount: booking.rooms.length,
      vipReason: bookingValue > 5000 ? 'High value' : 'Multiple rooms',
      specialAttention: true
    });
  }
};

/**
 * Notifications spécifiques pour rejet
 */
const sendRejectionNotifications = async (booking, user, transitionData, baseData) => {
  // Client notification
  socketService.sendUserNotification(booking.customer._id.toString(), 'BOOKING_REJECTED_WORKFLOW', {
    bookingId: booking._id,
    message: 'Nous sommes désolés, votre réservation a été refusée.',
    hotelName: booking.hotel.name,
    reason: transitionData.reason || booking.rejectionReason,
    rejectedBy: user.id,
    alternatives: {
      newDates: 'Essayez d\'autres dates',
      otherHotels: 'Consultez nos autres établissements',
      contact: 'Contactez notre service client',
      assistance: 'Nous pouvons vous aider à trouver une alternative'
    },
    compensation: {
      noCharges: 'Aucun montant ne sera prélevé',
      priority: 'Vous aurez la priorité pour de futures réservations',
      discount: 'Code promo disponible pour votre prochaine réservation'
    }
  });

  // Hotel notification
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'BOOKING_REJECTED_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    rejectionReason: transitionData.reason,
    rejectedBy: user.id,
    impact: {
      roomsNowAvailable: booking.rooms.length,
      revenueImpact: -booking.totalPrice,
      alternativeBookingPossible: true
    }
  });
};

/**
 * Notifications spécifiques pour check-in
 */
const sendCheckInNotifications = async (booking, user, transitionData, postActions, baseData) => {
  const roomsAssigned = postActions.find(action => action.action === 'update_rooms_status');
  
  // Client notification
  socketService.sendUserNotification(booking.customer._id.toString(), 'CHECKED_IN_WORKFLOW', {
    bookingId: booking._id,
    message: `Bienvenue à ${booking.hotel.name}! Votre check-in est terminé.`,
    hotelName: booking.hotel.name,
    checkInTime: booking.actualCheckInDate,
    roomsAssigned: roomsAssigned?.roomIds || [],
    stayDuration: Math.ceil((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24)),
    services: {
      roomService: 'Service en chambre 24h/24',
      wifi: 'WiFi gratuit',
      concierge: 'Conciergerie à votre disposition',
      extras: 'Services supplémentaires disponibles'
    },
    checkedInBy: user.id,
    welcome: {
      message: `Bon séjour ${booking.customer.firstName}!`,
      checkout: booking.checkOutDate,
      contact: 'Réception disponible 24h/24'
    }
  });

  // Hotel notification
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'GUEST_CHECKED_IN_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    roomsOccupied: roomsAssigned?.roomsUpdated || 0,
    checkedInBy: user.id,
    guestProfile: {
      vip: booking.clientType === 'CORPORATE',
      specialRequests: booking.specialRequests || 'Aucune',
      stayDuration: Math.ceil((new Date(booking.checkOutDate) - new Date(booking.checkInDate)) / (1000 * 60 * 60 * 24)),
      estimatedRevenue: booking.totalPrice
    },
    housekeeping: {
      roomsToMonitor: roomsAssigned?.roomIds || [],
      specialServices: transitionData.specialServices || [],
      checkOutDate: booking.checkOutDate
    }
  });
};

/**
 * Notifications spécifiques pour check-out
 */
const sendCheckOutNotifications = async (booking, user, transitionData, postActions, baseData) => {
  const roomsReleased = postActions.find(action => action.action === 'update_rooms_status');
  const invoiceGenerated = postActions.find(action => action.action === 'generate_invoice');
  
  // Client notification
  socketService.sendUserNotification(booking.customer._id.toString(), 'CHECKED_OUT_WORKFLOW', {
    bookingId: booking._id,
    message: `Check-out terminé. Merci d'avoir choisi ${booking.hotel.name}!`,
    hotelName: booking.hotel.name,
    checkOutTime: booking.actualCheckOutDate,
    stayDuration: booking.actualStayDuration,
    finalAmount: booking.totalPrice,
    invoice: {
      number: invoiceGenerated?.invoiceNumber || 'En génération',
      available: !!invoiceGenerated,
      emailSent: true
    },
    feedback: {
      reviewRequest: 'Votre avis nous intéresse',
      rating: 'Notez votre séjour',
      nextVisit: 'Nous espérons vous revoir bientôt'
    },
    loyalty: {
      pointsEarned: Math.floor(booking.totalPrice / 10),
      nextReward: 'Bientôt éligible pour une nuit gratuite',
      vipStatus: booking.totalPrice > 2000 ? 'VIP' : 'Standard'
    }
  });

  // Hotel notification
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'GUEST_CHECKED_OUT_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    roomsReleased: roomsReleased?.roomsUpdated || 0,
    finalRevenue: booking.totalPrice,
    checkedOutBy: user.id,
    housekeeping: {
      roomsToClean: roomsReleased?.roomIds || [],
      priority: 'Normal',
      nextGuests: 'Vérifier planning arrivées'
    },
    businessImpact: {
      revenueCompleted: booking.totalPrice,
      occupancyUpdate: `${roomsReleased?.roomsUpdated || 0} chambres libérées`,
      averageStay: booking.actualStayDuration
    }
  });
};

/**
 * Notifications spécifiques pour annulation
 */
const sendCancellationNotifications = async (booking, user, transitionData, preActions, baseData) => {
  const refundCalculation = preActions.find(action => action.action === 'calculate_refund');
  
  // Client notification
  socketService.sendUserNotification(booking.customer._id.toString(), 'BOOKING_CANCELLED_WORKFLOW', {
    bookingId: booking._id,
    message: 'Votre réservation a été annulée.',
    hotelName: booking.hotel.name,
    cancelledBy: user.role,
    cancellationReason: transitionData.reason || booking.cancellationReason,
    refund: refundCalculation ? {
      policy: refundCalculation.policy,
      originalAmount: refundCalculation.originalAmount,
      refundAmount: refundCalculation.refundAmount,
      refundPercentage: refundCalculation.refundPercentage,
      processingTime: refundCalculation.refundAmount > 0 ? '5-7 jours ouvrés' : null,
      cancellationFee: refundCalculation.cancellationFee
    } : null,
    alternatives: {
      rebooking: 'Nouvelle réservation possible',
      otherDates: 'Autres dates disponibles',
      assistance: 'Notre équipe peut vous aider',
      priority: 'Priorité pour futures réservations'
    }
  });

  // Hotel notification
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'BOOKING_CANCELLED_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    cancellationImpact: {
      roomsReleased: booking.rooms.length,
      revenueImpact: -booking.totalPrice,
      refundIssued: refundCalculation?.refundAmount || 0,
      timeBeforeArrival: refundCalculation?.hoursUntilCheckIn || 0
    },
    opportunities: {
      roomsNowAvailable: booking.rooms.length,
      rebookingPossible: true,
      waitingListCheck: 'Vérifier liste d\'attente'
    },
    cancelledBy: user.id
  });

  // Admin notification for significant cancellations
  if (booking.totalPrice > 2000 || booking.rooms.length > 2) {
    socketService.sendAdminNotification('SIGNIFICANT_CANCELLATION', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      revenueImpact: booking.totalPrice,
      refundAmount: refundCalculation?.refundAmount || 0,
      reason: transitionData.reason,
      investigation: booking.totalPrice > 5000 ? 'Recommended' : 'Optional'
    });
  }
};

/**
 * Envoie les notifications d'erreur
 */
const sendWorkflowErrorNotifications = async (booking, fromStatus, toStatus, user, error) => {
  const errorData = {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    hotelName: booking.hotel.name,
    attemptedTransition: `${fromStatus} → ${toStatus}`,
    error: error.message,
    errorCode: error.code || 'UNKNOWN',
    attemptedBy: user.id,
    timestamp: new Date()
  };

  // Notifier l'utilisateur qui a tenté l'action
  socketService.sendUserNotification(user.id, 'WORKFLOW_ERROR', {
    ...errorData,
    message: 'Erreur lors de la transition de statut',
    userMessage: 'Une erreur est survenue. Veuillez réessayer ou contacter le support.',
    canRetry: !error.code || !['BOOKING_NOT_FOUND', 'INVALID_TRANSITION'].includes(error.code)
  });

  // Notifier les admins des erreurs critiques
  if (error.code && ['VALIDATION_FAILED', 'TRANSITION_FAILED'].includes(error.code)) {
    socketService.sendAdminNotification('WORKFLOW_ERROR_CRITICAL', {
      ...errorData,
      severity: 'HIGH',
      requiresInvestigation: true,
      affectedSystems: ['booking_workflow', 'room_management']
    });
  }
};

/**
 * Broadcast des changements de disponibilité
 */
const broadcastAvailabilityChange = async (booking, fromStatus, toStatus, postActions) => {
  const roomsAction = postActions.find(action => action.action === 'update_rooms_status');
  
  if (!roomsAction) return;

  let availabilityChangeType = '';
  let message = '';

  switch (toStatus) {
    case BOOKING_STATUS.CONFIRMED:
      availabilityChangeType = 'ROOMS_RESERVED';
      message = `${booking.rooms.length} chambres réservées`;
      break;
    case BOOKING_STATUS.CHECKED_IN:
      availabilityChangeType = 'ROOMS_OCCUPIED';
      message = `${roomsAction.roomsUpdated} chambres maintenant occupées`;
      break;
    case BOOKING_STATUS.COMPLETED:
    case BOOKING_STATUS.CANCELLED:
      availabilityChangeType = 'ROOMS_AVAILABLE';
      message = `${roomsAction.roomsUpdated} chambres maintenant disponibles`;
      break;
  }

  if (availabilityChangeType) {
    socketService.broadcastAvailabilityUpdate(booking.hotel._id.toString(), {
      action: availabilityChangeType,
      bookingId: booking._id,
      roomsAffected: roomsAction.roomsUpdated || booking.rooms.length,
      roomTypes: [...new Set(booking.rooms.map(r => r.type))],
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      message,
      workflow: true,
      status: toStatus
    });
  }
};

/**
 * Estime le temps de transition
 */
const getEstimatedTransitionTime = (fromStatus, toStatus) => {
  const transitionTimes = {
    [`${BOOKING_STATUS.PENDING}-${BOOKING_STATUS.CONFIRMED}`]: '2-5 minutes',
    [`${BOOKING_STATUS.PENDING}-${BOOKING_STATUS.REJECTED}`]: '1-2 minutes',
    [`${BOOKING_STATUS.CONFIRMED}-${BOOKING_STATUS.CHECKED_IN}`]: '5-10 minutes',
    [`${BOOKING_STATUS.CHECKED_IN}-${BOOKING_STATUS.COMPLETED}`]: '3-8 minutes',
    [`${fromStatus}-${BOOKING_STATUS.CANCELLED}`]: '2-5 minutes'
  };

  return transitionTimes[`${fromStatus}-${toStatus}`] || '1-3 minutes';
};

/**
 * ================================
 * VALIDATIONS SPÉCIFIQUES
 * ================================
 */

/**
 * Valide une transition selon les business rules
 */
const validateTransition = async (booking, newStatus, transitionData, user) => {
  switch (newStatus) {
    case BOOKING_STATUS.CONFIRMED:
      return await validateConfirmation(booking, transitionData, user);
      
    case BOOKING_STATUS.CHECKED_IN:
      return await validateCheckIn(booking, transitionData, user);
      
    case BOOKING_STATUS.COMPLETED:
      return await validateCheckOut(booking, transitionData, user);
      
    case BOOKING_STATUS.CANCELLED:
      return await validateCancellation(booking, transitionData, user);
      
    case BOOKING_STATUS.REJECTED:
      return await validateRejection(booking, transitionData, user);
      
    default:
      return { valid: true };
  }
};

/**
 * Validation confirmation réservation
 */
const validateConfirmation = async (booking, transitionData, user) => {
  // Seuls les admins peuvent confirmer
  if (user.role !== USER_ROLES.ADMIN) {
    return { valid: false, error: 'Seuls les admins peuvent confirmer' };
  }

  // Vérifier disponibilité toujours valide
  const { checkAvailability } = require('./availability');
  
  try {
    for (const roomBooking of booking.rooms) {
      const availability = await checkAvailability({
        hotelId: booking.hotel._id,
        roomType: roomBooking.type,
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        roomsNeeded: 1,
        excludeBookingId: booking._id
      });

      if (!availability.available) {
        return { 
          valid: false, 
          error: `Plus de chambres ${roomBooking.type} disponibles` 
        };
      }
    }
  } catch (error) {
    return { valid: false, error: `Erreur vérification disponibilité: ${error.message}` };
  }

  return { valid: true };
};

/**
 * Validation check-in
 */
const validateCheckIn = async (booking, transitionData, user) => {
  // Staff autorisé pour check-in
  if (![USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(user.role)) {
    return { valid: false, error: 'Check-in réservé au staff' };
  }

  // Vérifier date check-in
  const today = new Date();
  const checkInDate = new Date(booking.checkInDate);
  
  // Permettre check-in jusqu'à 1 jour après la date prévue
  const maxCheckInDate = new Date(checkInDate);
  maxCheckInDate.setDate(maxCheckInDate.getDate() + 1);
  
  if (today > maxCheckInDate) {
    return { 
      valid: false, 
      error: 'Date limite de check-in dépassée (1 jour après date prévue)' 
    };
  }

  // Vérifier attribution chambres si fournie
  if (transitionData.roomAssignments) {
    const Room = require('../models/Room');
    
    for (const assignment of transitionData.roomAssignments) {
      const room = await Room.findById(assignment.roomId);
      
      if (!room) {
        return { valid: false, error: `Chambre ${assignment.roomId} non trouvée` };
      }
      
      if (room.status !== ROOM_STATUS.AVAILABLE) {
        return { 
          valid: false, 
          error: `Chambre ${room.number} non disponible (statut: ${room.status})` 
        };
      }
    }
  }

  return { valid: true };
};

/**
 * Validation check-out
 */
const validateCheckOut = async (booking, transitionData, user) => {
  // Staff autorisé pour check-out
  if (![USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(user.role)) {
    return { valid: false, error: 'Check-out réservé au staff' };
  }

  // Vérifier que toutes les chambres sont assignées
  const unassignedRooms = booking.rooms.filter(r => !r.room);
  if (unassignedRooms.length > 0) {
    return { 
      valid: false, 
      error: `${unassignedRooms.length} chambre(s) non assignée(s)` 
    };
  }

  return { valid: true };
};

/**
 * Validation annulation
 */
const validateCancellation = async (booking, transitionData, user) => {
  // Client ne peut annuler que ses propres réservations
  if (user.role === USER_ROLES.CLIENT && booking.customer.toString() !== user.id) {
    return { valid: false, error: 'Accès non autorisé à cette réservation' };
  }

  // Vérifier statuts annulables
  const cancellableStatuses = [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED];
  if (!cancellableStatuses.includes(booking.status)) {
    return { 
      valid: false, 
      error: `Impossible d'annuler une réservation ${booking.status}` 
    };
  }

  return { valid: true };
};

/**
 * Validation rejet
 */
const validateRejection = async (booking, transitionData, user) => {
  // Seuls les admins peuvent rejeter
  if (user.role !== USER_ROLES.ADMIN) {
    return { valid: false, error: 'Seuls les admins peuvent rejeter' };
  }

  // Raison obligatoire pour rejet
  if (!transitionData.reason || transitionData.reason.trim().length < 10) {
    return { 
      valid: false, 
      error: 'Raison de rejet requise (minimum 10 caractères)' 
    };
  }

  return { valid: true };
};

/**
 * ================================
 * ACTIONS PRÉ/POST TRANSITION
 * ================================
 */

/**
 * Execute les actions avant changement de statut
 */
const executePreTransitionActions = async (booking, currentStatus, newStatus, transitionData, user, session) => {
  const actions = [];

  switch (newStatus) {
    case BOOKING_STATUS.CHECKED_IN:
      if (transitionData.roomAssignments) {
        actions.push(await assignRoomsToBooking(booking, transitionData.roomAssignments, user, session));
      }
      break;
      
    case BOOKING_STATUS.CANCELLED:
      actions.push(await calculateCancellationRefund(booking, transitionData, user));
      break;
  }

  return actions;
};

/**
 * Execute les actions après changement de statut
 */
const executePostTransitionActions = async (booking, currentStatus, newStatus, transitionData, user, session) => {
  const actions = [];

  switch (newStatus) {
    case BOOKING_STATUS.CHECKED_IN:
      actions.push(await updateRoomsStatus(booking, ROOM_STATUS.OCCUPIED, user, session));
      break;
      
    case BOOKING_STATUS.COMPLETED:
      actions.push(await updateRoomsStatus(booking, ROOM_STATUS.AVAILABLE, user, session));
      actions.push(await generateFinalInvoice(booking, transitionData, user));
      break;
      
    case BOOKING_STATUS.CANCELLED:
      actions.push(await releaseAssignedRooms(booking, user, session));
      break;
  }

  return actions;
};

/**
 * ================================
 * ACTIONS SPÉCIALISÉES
 * ================================
 */

/**
 * Assigne des chambres à une réservation
 */
const assignRoomsToBooking = async (booking, roomAssignments, user, session) => {
  const Room = require('../models/Room');
  const assignedRooms = [];

  for (const assignment of roomAssignments) {
    const { bookingRoomIndex, roomId } = assignment;
    
    if (bookingRoomIndex >= booking.rooms.length) {
      throw new Error(`Index chambre invalide: ${bookingRoomIndex}`);
    }

    // Assigner la chambre
    booking.rooms[bookingRoomIndex].room = roomId;
    booking.rooms[bookingRoomIndex].assignedAt = new Date();
    booking.rooms[bookingRoomIndex].assignedBy = user.id;

    assignedRooms.push({
      bookingRoomIndex,
      roomId,
      assignedAt: new Date()
    });
  }

  await booking.save({ session });

  // Notification temps réel d'attribution
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'ROOMS_ASSIGNED_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    roomsAssigned: assignedRooms.length,
    assignedBy: user.id,
    roomDetails: assignedRooms
  });

  return {
    action: 'assign_rooms',
    roomsAssigned: assignedRooms.length,
    details: assignedRooms
  };
};

/**
 * Met à jour le statut des chambres assignées
 */
const updateRoomsStatus = async (booking, newRoomStatus, user, session) => {
  const Room = require('../models/Room');
  const roomIds = booking.rooms.filter(r => r.room).map(r => r.room);

  if (roomIds.length === 0) {
    return { action: 'update_rooms_status', roomsUpdated: 0 };
  }

  const updateData = {
    status: newRoomStatus,
    updatedBy: user.id,
    updatedAt: new Date()
  };

  if (newRoomStatus === ROOM_STATUS.OCCUPIED) {
    updateData.currentBooking = booking._id;
  } else if (newRoomStatus === ROOM_STATUS.AVAILABLE) {
    updateData.currentBooking = null;
    updateData.lastCheckOut = new Date();
  }

  const result = await Room.updateMany(
    { _id: { $in: roomIds } },
    { $set: updateData },
    { session }
  );

  // Notification temps réel du changement statut chambres
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'ROOMS_STATUS_UPDATED_WORKFLOW', {
    bookingId: booking._id,
    roomsUpdated: result.modifiedCount,
    newStatus: newRoomStatus,
    roomIds,
    updatedBy: user.id,
    context: newRoomStatus === ROOM_STATUS.OCCUPIED ? 'Guest checked in' : 'Guest checked out'
  });

  return {
    action: 'update_rooms_status',
    newStatus: newRoomStatus,
    roomsUpdated: result.modifiedCount,
    roomIds
  };
};

/**
 * Libère les chambres assignées lors d'annulation
 */
const releaseAssignedRooms = async (booking, user, session) => {
  const assignedRooms = booking.rooms.filter(r => r.room);
  
  if (assignedRooms.length === 0) {
    return { action: 'release_rooms', roomsReleased: 0 };
  }

  const result = await updateRoomsStatus(booking, ROOM_STATUS.AVAILABLE, user, session);
  
  // Notification spécifique de libération
  socketService.sendHotelNotification(booking.hotel._id.toString(), 'ROOMS_RELEASED_WORKFLOW', {
    bookingId: booking._id,
    customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
    roomsReleased: result.roomsUpdated,
    releasedBy: user.id,
    reason: 'Booking cancellation',
    opportunity: 'Rooms now available for new bookings'
  });

  return result;
};

/**
 * Calcule le remboursement pour annulation
 */
const calculateCancellationRefund = async (booking, transitionData, user) => {
  const now = new Date();
  const checkInDate = new Date(booking.checkInDate);
  const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);

  let refundPercentage = 0;
  let cancellationFee = 0;

  // Politique standard
  if (hoursUntilCheckIn >= BUSINESS_RULES.FREE_CANCELLATION_HOURS) {
    refundPercentage = 100; // Gratuit
  } else if (hoursUntilCheckIn >= 12) {
    refundPercentage = 50;  // 50% pénalité
  } else {
    refundPercentage = 0;   // Aucun remboursement
  }

  // Admin peut override
  if (user.role === USER_ROLES.ADMIN && transitionData.customRefundAmount !== undefined) {
    const customRefund = Math.max(0, Math.min(transitionData.customRefundAmount, booking.totalPrice));
    refundPercentage = (customRefund / booking.totalPrice) * 100;
  }

  const refundAmount = booking.totalPrice * (refundPercentage / 100);
  cancellationFee = booking.totalPrice - refundAmount;

  // Notification temps réel du calcul de remboursement
  if (refundAmount > 0) {
    socketService.sendUserNotification(booking.customer._id.toString(), 'REFUND_CALCULATED_WORKFLOW', {
      bookingId: booking._id,
      hotelName: booking.hotel.name,
      refund: {
        originalAmount: booking.totalPrice,
        refundAmount,
        refundPercentage,
        cancellationFee,
        processingTime: '5-7 jours ouvrés',
        method: 'Même méthode de paiement'
      },
      policy: refundPercentage === 100 ? 'Remboursement intégral' : 
              refundPercentage === 50 ? 'Remboursement partiel' : 'Aucun remboursement'
    });
  }

  // Notification admin pour remboursements importants
  if (refundAmount > 1000) {
    socketService.sendAdminNotification('HIGH_VALUE_REFUND_WORKFLOW', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      refundAmount,
      originalAmount: booking.totalPrice,
      approvalRequired: refundAmount > 5000,
      processedBy: user.id
    });
  }

  return {
    action: 'calculate_refund',
    originalAmount: booking.totalPrice,
    refundPercentage,
    refundAmount,
    cancellationFee,
    hoursUntilCheckIn: Math.round(hoursUntilCheckIn),
    policy: refundPercentage === 100 ? 'free' : refundPercentage === 50 ? 'partial' : 'none'
  };
};

/**
 * Génère la facture finale
 */
const generateFinalInvoice = async (booking, transitionData, user) => {
  try {
    // Import dynamique pour éviter les dépendances circulaires
    const { generateInvoiceData } = require('../controllers/bookingController');
    const invoiceData = await generateInvoiceData(booking);
    
    // Notification temps réel de génération de facture
    socketService.sendUserNotification(booking.customer._id.toString(), 'INVOICE_GENERATED_WORKFLOW', {
      bookingId: booking._id,
      invoiceNumber: invoiceData.invoiceNumber,
      totalAmount: invoiceData.totals.total,
      hotelName: booking.hotel.name,
      download: {
        available: true,
        url: `/api/bookings/${booking._id}/invoice`,
        emailSent: true
      },
      payment: {
        status: booking.paymentStatus || 'Completed',
        method: booking.paymentMethod || 'Credit Card'
      }
    });

    // Notification équipe comptabilité
    socketService.sendAdminNotification('INVOICE_GENERATED_WORKFLOW', {
      bookingId: booking._id,
      invoiceNumber: invoiceData.invoiceNumber,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      amount: invoiceData.totals.total,
      generatedBy: user.id,
      accounting: {
        requiresReview: invoiceData.totals.total > 2000,
        paymentStatus: booking.paymentStatus,
        extrasIncluded: (booking.extrasTotal || 0) > 0
      }
    });
    
    return {
      action: 'generate_invoice',
      invoiceNumber: invoiceData.invoiceNumber,
      totalAmount: invoiceData.totals.total,
      generatedAt: new Date(),
      generatedBy: user.id,
      success: true
    };
  } catch (error) {
    // Notification d'erreur de génération
    socketService.sendAdminNotification('INVOICE_GENERATION_ERROR_WORKFLOW', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      error: error.message,
      requiresManualGeneration: true,
      urgency: 'HIGH'
    });

    return {
      action: 'generate_invoice',
      error: error.message,
      fallback: 'Facture générée manuellement requise',
      success: false
    };
  }
};

/**
 * ================================
 * CHAMPS SPÉCIFIQUES PAR STATUT
 * ================================
 */

/**
 * Retourne les champs spécifiques à ajouter selon le nouveau statut
 */
const getStatusSpecificFields = (newStatus, transitionData, user) => {
  const fields = {};

  switch (newStatus) {
    case BOOKING_STATUS.CONFIRMED:
      fields.confirmedAt = new Date();
      fields.confirmedBy = user.id;
      if (transitionData.priceModification) {
        fields.totalPrice = transitionData.newPrice;
        fields.priceModified = true;
        fields.priceModificationReason = transitionData.priceReason;
      }
      break;

    case BOOKING_STATUS.REJECTED:
      fields.rejectedAt = new Date();
      fields.rejectedBy = user.id;
      fields.rejectionReason = transitionData.reason;
      break;

    case BOOKING_STATUS.CHECKED_IN:
      fields.actualCheckInDate = transitionData.actualCheckInTime || new Date();
      fields.checkedInBy = user.id;
      if (transitionData.guestNotes) fields.guestNotes = transitionData.guestNotes;
      if (transitionData.specialServices) fields.specialServices = transitionData.specialServices;
      break;

    case BOOKING_STATUS.COMPLETED:
      fields.actualCheckOutDate = transitionData.actualCheckOutTime || new Date();
      fields.checkedOutBy = user.id;
      if (transitionData.finalExtras) {
        const extrasTotal = transitionData.finalExtras.reduce((sum, extra) => 
          sum + (extra.price * extra.quantity), 0);
        fields.extrasTotal = (fields.extrasTotal || 0) + extrasTotal;
        fields.totalPrice = fields.totalPrice + extrasTotal;
      }
      fields.paymentStatus = transitionData.paymentStatus || 'Pending';
      
      // Calculer durée séjour réelle
      if (fields.actualCheckOutDate && transitionData.actualCheckInTime) {
        const actualStayDuration = Math.ceil(
          (fields.actualCheckOutDate - new Date(transitionData.actualCheckInTime)) / (1000 * 60 * 60 * 24)
        );
        fields.actualStayDuration = actualStayDuration;
      }
      break;

    case BOOKING_STATUS.CANCELLED:
      fields.cancelledAt = new Date();
      fields.cancelledBy = user.id;
      fields.cancellationReason = transitionData.reason;
      if (transitionData.refundCalculation) {
        Object.assign(fields, {
          refundPercentage: transitionData.refundCalculation.refundPercentage,
          refundAmount: transitionData.refundCalculation.refundAmount,
          cancellationFee: transitionData.refundCalculation.cancellationFee
        });
      }
      break;
  }

  return fields;
};

/**
 * ================================
 * NOTIFICATIONS & SIDE EFFECTS
 * ================================
 */

/**
 * Programme les notifications pour une transition (emails, SMS, etc.)
 */
const scheduleTransitionNotifications = async (booking, fromStatus, toStatus, user) => {
  const notifications = [];

  // Email client selon transition
  switch (toStatus) {
    case BOOKING_STATUS.CONFIRMED:
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'booking_confirmed',
        data: { booking, confirmedBy: user },
        priority: 'high',
        sendAt: 'immediate'
      });
      break;

    case BOOKING_STATUS.REJECTED:
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'booking_rejected',
        data: { booking, rejectedBy: user },
        priority: 'high',
        sendAt: 'immediate'
      });
      break;

    case BOOKING_STATUS.CHECKED_IN:
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'welcome_checkin',
        data: { booking, checkedInBy: user },
        priority: 'medium',
        sendAt: 'immediate'
      });
      // SMS de bienvenue
      notifications.push({
        type: 'sms',
        recipient: booking.customer.phone,
        template: 'welcome_sms',
        data: { booking, hotelName: booking.hotel.name },
        priority: 'medium',
        sendAt: 'immediate'
      });
      break;

    case BOOKING_STATUS.COMPLETED:
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'checkout_invoice',
        data: { booking, invoice: true },
        priority: 'high',
        sendAt: 'immediate'
      });
      // Email de satisfaction après 24h
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'satisfaction_survey',
        data: { booking },
        priority: 'low',
        sendAt: 'in 24 hours'
      });
      break;

    case BOOKING_STATUS.CANCELLED:
      notifications.push({
        type: 'email',
        recipient: booking.customer.email,
        template: 'booking_cancelled',
        data: { booking, cancelledBy: user },
        priority: 'high',
        sendAt: 'immediate'
      });
      break;
  }

  // Notifications internes staff
  if ([BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED].includes(toStatus)) {
    notifications.push({
      type: 'internal',
      recipient: 'admin_team',
      message: `Réservation ${booking._id} → ${toStatus}`,
      priority: toStatus === BOOKING_STATUS.PENDING ? 'high' : 'normal',
      data: { booking, user }
    });
  }

  // Notifications hotel staff pour check-in/check-out
  if ([BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED].includes(toStatus)) {
    notifications.push({
      type: 'internal',
      recipient: 'hotel_staff',
      hotelId: booking.hotel._id,
      message: `Guest ${toStatus === BOOKING_STATUS.CHECKED_IN ? 'arrived' : 'departed'}`,
      priority: 'medium',
      data: { booking, user }
    });
  }

  // Programmer les notifications via un système de queue
  for (const notification of notifications) {
    await scheduleNotification(notification);
  }
  
  // Notification temps réel que les emails sont programmés
  socketService.sendUserNotification(booking.customer._id.toString(), 'NOTIFICATIONS_SCHEDULED', {
    bookingId: booking._id,
    emailsScheduled: notifications.filter(n => n.type === 'email').length,
    smsScheduled: notifications.filter(n => n.type === 'sms').length,
    message: 'Notifications programmées avec succès'
  });

  console.log(`Notifications programmées pour transition ${fromStatus} → ${toStatus}:`, notifications.length);
  
  return notifications;
};

/**
 * Programme une notification individuelle
 */
const scheduleNotification = async (notification) => {
  // TODO: Implémenter avec un système de queue comme Bull, Agenda, ou AWS SQS
  // Pour l'instant, juste logger
  console.log('Notification programmée:', {
    type: notification.type,
    recipient: notification.recipient,
    template: notification.template,
    priority: notification.priority,
    sendAt: notification.sendAt || 'immediate'
  });
  
  // Exemple d'implémentation future :
  /*
  const notificationQueue = require('../services/notificationQueue');
  
  if (notification.sendAt === 'immediate') {
    await notificationQueue.add('send-notification', notification, { priority: getPriorityValue(notification.priority) });
  } else {
    const delay = parseDelay(notification.sendAt); // parse "in 24 hours" to milliseconds
    await notificationQueue.add('send-notification', notification, { 
      delay,
      priority: getPriorityValue(notification.priority)
    });
  }
  */
};

/**
 * Détermine si le cache doit être invalidé
 */
const shouldInvalidateCache = (fromStatus, toStatus) => {
  const cacheInvalidatingTransitions = [
    BOOKING_STATUS.CONFIRMED,
    BOOKING_STATUS.CHECKED_IN,
    BOOKING_STATUS.COMPLETED,
    BOOKING_STATUS.CANCELLED
  ];
  
  return cacheInvalidatingTransitions.includes(toStatus);
};

/**
 * ================================
 * UTILITAIRES WORKFLOW
 * ================================
 */

/**
 * Obtient les transitions disponibles depuis un statut pour un rôle
 */
const getAvailableTransitions = (currentStatus, userRole) => {
  const allTransitions = BOOKING_STATUS_TRANSITIONS[currentStatus] || [];
  
  // Filtrer selon permissions rôle
  return allTransitions.filter(targetStatus => {
    switch (targetStatus) {
      case BOOKING_STATUS.CONFIRMED:
      case BOOKING_STATUS.REJECTED:
        return userRole === USER_ROLES.ADMIN;
        
      case BOOKING_STATUS.CHECKED_IN:
      case BOOKING_STATUS.COMPLETED:
        return [USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST].includes(userRole);
        
      case BOOKING_STATUS.CANCELLED:
        return true; // Tous rôles (avec restrictions spécifiques)
        
      default:
        return false;
    }
  });
};

/**
 * Vérifie si une transition est possible pour un utilisateur
 */
const canUserExecuteTransition = (fromStatus, toStatus, userRole, booking, user) => {
  // Vérifier transition généralement autorisée
  if (!canTransitionBookingStatus(fromStatus, toStatus)) {
    return { allowed: false, reason: 'Transition non autorisée' };
  }

  // Vérifier permissions rôle
  const availableTransitions = getAvailableTransitions(fromStatus, userRole);
  if (!availableTransitions.includes(toStatus)) {
    return { allowed: false, reason: 'Permissions insuffisantes' };
  }

  // Vérification spécifique clients
  if (userRole === USER_ROLES.CLIENT) {
    if (booking.customer.toString() !== user.id) {
      return { allowed: false, reason: 'Accès non autorisé à cette réservation' };
    }
    
    if (toStatus === BOOKING_STATUS.CANCELLED) {
      const cancellableStatuses = [BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED];
      if (!cancellableStatuses.includes(fromStatus)) {
        return { allowed: false, reason: 'Annulation non autorisée dans cet état' };
      }
    }
  }

  return { allowed: true };
};

/**
 * Obtient les statistiques de workflow pour monitoring
 */
const getWorkflowStats = async (hotelId = null, period = '30d') => {
  const Booking = require('../models/Booking');
  
  const endDate = new Date();
  const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
  const days = daysMap[period] || 30;
  const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

  const query = {
    updatedAt: { $gte: startDate, $lte: endDate }
  };

  if (hotelId) {
    query.hotel = hotelId;
  }

  const stats = await Booking.aggregate([
    { $match: query },
    { $unwind: '$statusHistory' },
    {
      $group: {
        _id: {
          from: '$statusHistory.previousStatus',
          to: '$statusHistory.newStatus'
        },
        count: { $sum: 1 },
        avgProcessingTime: {
          $avg: {
            $subtract: ['$statusHistory.changedAt', '$createdAt']
          }
        }
      }
    },
    {
      $project: {
        transition: { $concat: ['$_id.from', ' → ', '$_id.to'] },
        count: 1,
        avgProcessingTimeHours: {
          $divide: ['$avgProcessingTime', 1000 * 60 * 60]
        }
      }
    },
    { $sort: { count: -1 } }
  ]);

  return {
    period: { start: startDate, end: endDate, days },
    transitions: stats,
    summary: {
      totalTransitions: stats.reduce((sum, stat) => sum + stat.count, 0),
      mostCommonTransition: stats[0] || null,
      averageProcessingTime: stats.reduce((sum, stat) => sum + stat.avgProcessingTimeHours, 0) / stats.length || 0
    }
  };
};

/**
 * ================================
 * CLASSE D'ERREUR PERSONNALISÉE
 * ================================
 */

class WorkflowError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date();
  }
}

/**
 * ================================
 * WRAPPER FUNCTIONS POUR COMPATIBILITÉ
 * ================================
 */

/**
 * Valide une réservation (wrapper pour executeStatusTransition)
 */
const validateBooking = async (bookingId, action, reason, modifications, user, session = null) => {
  const newStatus = action === 'approve' ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.REJECTED;
  
  const transitionData = {
    reason,
    priceModification: modifications?.newPrice ? true : false,
    newPrice: modifications?.newPrice,
    priceReason: modifications?.priceReason
  };

  return await executeStatusTransition(bookingId, newStatus, transitionData, user, session);
};

/**
 * Traite un paiement avec workflow
 */
const processPayment = async (bookingId, paymentData, user) => {
  try {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(bookingId).populate('customer', 'firstName lastName email');
    
    if (!booking) {
      throw new Error('Booking not found');
    }

    // Simuler traitement paiement
    const paymentResult = {
      success: true,
      transactionId: `TXN_${Date.now()}`,
      amount: paymentData.amount,
      method: paymentData.method || 'CREDIT_CARD',
      processedAt: new Date()
    };

    // Notifications temps réel de paiement
    socketService.sendUserNotification(booking.customer._id.toString(), 'PAYMENT_PROCESSED', {
      bookingId: booking._id,
      amount: paymentData.amount,
      paymentMethod: paymentResult.method,
      transactionId: paymentResult.transactionId,
      message: 'Votre paiement a été traité avec succès!',
      confirmation: {
        number: paymentResult.transactionId,
        receipt: 'Reçu envoyé par email'
      }
    });

    // Notifier les admins du paiement
    socketService.sendAdminNotification('PAYMENT_RECEIVED', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      amount: paymentData.amount,
      transactionId: paymentResult.transactionId,
      hotelId: booking.hotel,
      method: paymentResult.method,
      requiresVerification: paymentData.amount > 5000
    });

    return paymentResult;
    
  } catch (error) {
    // Notification d'erreur de paiement
    socketService.sendAdminNotification('PAYMENT_ERROR', {
      bookingId,
      error: error.message,
      amount: paymentData.amount,
      requiresInvestigation: true,
      urgency: 'HIGH'
    });
    
    throw error;
  }
};

/**
 * Envoie un rappel de réservation
 */
const sendBookingReminder = async (bookingId, reminderType, user) => {
  try {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email')
      .populate('hotel', 'name address phone');
    
    if (!booking) {
      throw new Error('Booking not found');
    }

    let message = '';
    let urgency = 'NORMAL';
    let actionRequired = false;

    switch (reminderType) {
      case 'CHECK_IN_TOMORROW':
        message = `Rappel: Votre check-in à ${booking.hotel.name} est prévu demain.`;
        urgency = 'MEDIUM';
        break;
      case 'CHECK_IN_TODAY':
        message = `Aujourd'hui est le jour J! Votre check-in à ${booking.hotel.name} vous attend.`;
        urgency = 'HIGH';
        actionRequired = true;
        break;
      case 'PAYMENT_DUE':
        message = 'Rappel: Le paiement de votre réservation est requis.';
        urgency = 'HIGH';
        actionRequired = true;
        break;
      case 'VALIDATION_PENDING':
        message = 'Votre réservation est en attente de validation.';
        urgency = 'MEDIUM';
        break;
    }

    // Notification temps réel de rappel
    socketService.sendUserNotification(booking.customer._id.toString(), 'BOOKING_REMINDER', {
      bookingId: booking._id,
      reminderType,
      message,
      hotelName: booking.hotel.name,
      checkIn: booking.checkInDate,
      urgency,
      actionRequired,
      details: {
        hotelAddress: booking.hotel.address,
        hotelPhone: booking.hotel.phone,
        confirmationNumber: `CONF-${booking._id.toString().slice(-8).toUpperCase()}`
      },
      actions: actionRequired ? {
        contact: 'Contactez l\'hôtel si nécessaire',
        modify: booking.status === 'PENDING' ? 'Modifications possibles' : null,
        cancel: booking.status !== 'COMPLETED' ? 'Annulation possible' : null
      } : null
    });

    // Notification staff pour certains rappels
    if (['CHECK_IN_TODAY', 'PAYMENT_DUE'].includes(reminderType)) {
      socketService.sendHotelNotification(booking.hotel._id.toString(), 'GUEST_REMINDER_SENT', {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        reminderType,
        expectingGuest: reminderType === 'CHECK_IN_TODAY',
        paymentPending: reminderType === 'PAYMENT_DUE'
      });
    }

    return {
      success: true,
      reminderType,
      sentAt: new Date(),
      recipient: booking.customer.email
    };
    
  } catch (error) {
    console.error('Error sending booking reminder:', error);
    throw error;
  }
};

/**
 * Ajoute des extras à une réservation avec workflow
 */
const addExtrasToBooking = async (bookingId, extras, addedBy, session = null) => {
  try {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName')
      .populate('hotel', 'name')
      .session(session);

    if (!booking) {
      throw new Error('Booking not found');
    }

    if (![BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED].includes(booking.status)) {
      throw new Error('Extras can only be added after check-in');
    }

    // Calculer total extras
    const totalExtrasAmount = extras.reduce((sum, extra) => sum + (extra.amount * extra.quantity), 0);
    
    // Ajouter extras avec métadonnées
    const processedExtras = extras.map(extra => ({
      ...extra,
      addedAt: new Date(),
      addedBy: addedBy.id,
      addedByRole: addedBy.role
    }));

    booking.extras = [...(booking.extras || []), ...processedExtras];
    booking.extrasTotal = (booking.extrasTotal || 0) + totalExtrasAmount;
    booking.totalPrice += totalExtrasAmount;
    booking.updatedBy = addedBy.id;
    booking.updatedAt = new Date();

    await booking.save({ session });

    // Notifications temps réel d'ajout d'extras
    socketService.sendUserNotification(booking.customer._id.toString(), 'EXTRAS_ADDED_WORKFLOW', {
      bookingId: booking._id,
      hotelName: booking.hotel.name,
      extras: processedExtras.map(e => ({ 
        name: e.name, 
        quantity: e.quantity,
        amount: e.amount,
        total: e.amount * e.quantity 
      })),
      totalExtrasAmount,
      newBookingTotal: booking.totalPrice,
      message: `Services supplémentaires ajoutés pour ${totalExtrasAmount} MAD`,
      addedBy: addedBy.role,
      billing: {
        addedToFinalBill: true,
        payableAtCheckout: booking.status === BOOKING_STATUS.CHECKED_IN
      }
    });
    
    // Notification équipe hôtel
    socketService.sendHotelNotification(booking.hotel._id.toString(), 'EXTRAS_ADDED_TO_BOOKING_WORKFLOW', {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      extrasCount: processedExtras.length,
      extrasValue: totalExtrasAmount,
      addedBy: addedBy.id,
      newBookingTotal: booking.totalPrice,
      categories: [...new Set(processedExtras.map(e => e.category || 'General'))],
      revenue: {
        increase: totalExtrasAmount,
        newTotal: booking.totalPrice
      }
    });

    // Notification admin pour extras importants
    if (totalExtrasAmount > 500) {
      socketService.sendAdminNotification('HIGH_VALUE_EXTRAS_ADDED', {
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotelName: booking.hotel.name,
        extrasValue: totalExtrasAmount,
        addedBy: addedBy.id,
        revenueImpact: totalExtrasAmount
      });
    }

    return {
      success: true,
      extrasAdded: processedExtras.length,
      totalAmount: totalExtrasAmount,
      newBookingTotal: booking.totalPrice,
      booking
    };
    
  } catch (error) {
    console.error('Error adding extras to booking:', error);
    throw error;
  }
};

/**
 * Processus automatique de nettoyage des réservations expirées
 */
const cleanupExpiredBookings = async () => {
  try {
    const Booking = require('../models/Booking');
    
    // Trouver réservations PENDING depuis plus de 7 jours
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    
    const expiredBookings = await Booking.find({
      status: BOOKING_STATUS.PENDING,
      createdAt: { $lt: sevenDaysAgo }
    }).populate('customer', 'firstName lastName email')
      .populate('hotel', 'name');

    const results = {
      processed: 0,
      cancelled: 0,
      errors: 0,
      notifications: 0
    };

    for (const booking of expiredBookings) {
      try {
        // Auto-cancel expired booking
        await executeStatusTransition(
          booking._id,
          BOOKING_STATUS.CANCELLED,
          {
            reason: 'Auto-cancelled: No validation within 7 days',
            automated: true
          },
          { id: 'system', role: 'SYSTEM' }
        );

        // Notification client d'expiration
        socketService.sendUserNotification(booking.customer._id.toString(), 'BOOKING_AUTO_CANCELLED', {
          bookingId: booking._id,
          hotelName: booking.hotel.name,
          reason: 'Expiration - Non validée dans les délais',
          message: 'Votre réservation a été automatiquement annulée car elle n\'a pas été validée dans les 7 jours.',
          alternatives: {
            newBooking: 'Vous pouvez créer une nouvelle réservation',
            contact: 'Contactez-nous pour assistance',
            noCharges: 'Aucun montant n\'a été prélevé'
          }
        });

        results.cancelled++;
        results.notifications++;
        
      } catch (error) {
        console.error(`Error cancelling expired booking ${booking._id}:`, error);
        results.errors++;
      }
      
      results.processed++;
    }

    // Notification admin du nettoyage
    if (results.cancelled > 0) {
      socketService.sendAdminNotification('EXPIRED_BOOKINGS_CLEANUP', {
        processed: results.processed,
        cancelled: results.cancelled,
        errors: results.errors,
        cleanupDate: new Date(),
        automated: true,
        action: results.errors > 0 ? 'Review errors' : 'No action required'
      });
    }

    console.log('Expired bookings cleanup completed:', results);
    return results;
    
  } catch (error) {
    console.error('Error in cleanup process:', error);
    
    // Notification d'erreur critique
    socketService.sendAdminNotification('CLEANUP_PROCESS_ERROR', {
      error: error.message,
      process: 'expired_bookings_cleanup',
      severity: 'CRITICAL',
      requiresInvestigation: true
    });
    
    throw error;
  }
};

/**
 * Obtient le statut détaillé d'une réservation avec contexte workflow
 */
const getBookingWorkflowStatus = async (bookingId) => {
  try {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(bookingId)
      .populate('hotel', 'name')
      .populate('customer', 'firstName lastName')
      .populate('createdBy updatedBy', 'firstName lastName role');

    if (!booking) {
      throw new Error('Booking not found');
    }

    const currentDate = new Date();
    const checkInDate = new Date(booking.checkInDate);
    const checkOutDate = new Date(booking.checkOutDate);

    return {
      booking: {
        id: booking._id,
        status: booking.status,
        customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotel: booking.hotel.name
      },
      timeline: {
        created: booking.createdAt,
        lastUpdated: booking.updatedAt,
        checkIn: booking.checkInDate,
        checkOut: booking.checkOutDate,
        daysUntilCheckIn: Math.ceil((checkInDate - currentDate) / (1000 * 60 * 60 * 24)),
        stayDuration: Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24))
      },
      workflow: {
        currentStatus: booking.status,
        canTransitionTo: getAvailableTransitions(booking.status, 'ADMIN'), // Assuming admin view
        statusHistory: booking.statusHistory || [],
        lastTransition: booking.statusHistory?.[booking.statusHistory.length - 1] || null
      },
      flags: {
        isExpired: booking.status === BOOKING_STATUS.PENDING && 
                  (currentDate - booking.createdAt) > (7 * 24 * 60 * 60 * 1000),
        isLateCheckIn: booking.status === BOOKING_STATUS.CONFIRMED && 
                      currentDate > checkInDate,
        isOverdue: booking.status === BOOKING_STATUS.CHECKED_IN && 
                  currentDate > checkOutDate,
        needsAttention: booking.status === BOOKING_STATUS.PENDING && 
                       (currentDate - booking.createdAt) > (24 * 60 * 60 * 1000)
      },
      metrics: {
        processingTime: booking.confirmedAt ? 
          Math.round((booking.confirmedAt - booking.createdAt) / (1000 * 60 * 60)) : null,
        totalValue: booking.totalPrice,
        extrasValue: booking.extrasTotal || 0,
        roomsCount: booking.rooms.length
      }
    };
    
  } catch (error) {
    console.error('Error getting booking workflow status:', error);
    throw error;
  }
};

/**
 * ================================
 * MONITORING ET MÉTRIQUES
 * ================================
 */

/**
 * Envoie des métriques de workflow en temps réel
 */
const broadcastWorkflowMetrics = async (hotelId = null) => {
  try {
    const stats = await getWorkflowStats(hotelId, '24h');
    
    // Broadcast aux admins
    socketService.sendAdminNotification('WORKFLOW_METRICS_UPDATE', {
      period: '24h',
      hotelId,
      metrics: {
        totalTransitions: stats.summary.totalTransitions,
        averageProcessingTime: Math.round(stats.summary.averageProcessingTime * 100) / 100,
        mostCommonTransition: stats.summary.mostCommonTransition?.transition,
        performance: stats.summary.averageProcessingTime < 2 ? 'EXCELLENT' : 
                    stats.summary.averageProcessingTime < 6 ? 'GOOD' : 'NEEDS_IMPROVEMENT'
      },
      timestamp: new Date()
    });

    // Broadcast aux hôtels spécifiques si demandé
    if (hotelId) {
      socketService.sendHotelNotification(hotelId, 'HOTEL_WORKFLOW_METRICS', {
        period: '24h',
        transitions: stats.summary.totalTransitions,
        avgProcessingTime: Math.round(stats.summary.averageProcessingTime * 100) / 100,
        performance: stats.summary.averageProcessingTime < 2 ? 'Excellent' : 
                    stats.summary.averageProcessingTime < 6 ? 'Bon' : 'À améliorer'
      });
    }

    return stats;
    
  } catch (error) {
    console.error('Error broadcasting workflow metrics:', error);
  }
};

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // Fonction principale
  executeStatusTransition,
  
  // Validations
  validateTransition,
  validateConfirmation,
  validateCheckIn,
  validateCheckOut,
  validateCancellation,
  validateRejection,
  
  // Actions
  executePreTransitionActions,
  executePostTransitionActions,
  assignRoomsToBooking,
  updateRoomsStatus,
  calculateCancellationRefund,
  generateFinalInvoice,
  
  // Notifications temps réel
  sendPreTransitionNotifications,
  sendPostTransitionNotifications,
  sendConfirmationNotifications,
  sendRejectionNotifications,
  sendCheckInNotifications,
  sendCheckOutNotifications,
  sendCancellationNotifications,
  broadcastAvailabilityChange,
  
  // Utilitaires
  getAvailableTransitions,
  canUserExecuteTransition,
  shouldInvalidateCache,
  getWorkflowStats,
  getBookingWorkflowStatus,
  
  // Notifications traditionnelles
  scheduleTransitionNotifications,
  scheduleNotification,
  
  // Fonctions wrapper pour compatibilité
  validateBooking,
  processPayment,
  sendBookingReminder,
  addExtrasToBooking,
  
  // Maintenance et monitoring
  cleanupExpiredBookings,
  broadcastWorkflowMetrics,
  
  // Erreurs
  WorkflowError
};