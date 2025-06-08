/**
 * AVAILABILITY LOGIC - VÉRIFICATION DISPONIBILITÉ CHAMBRES TEMPS RÉEL + REAL-TIME NOTIFICATIONS
 * Système critique pour éviter les double-réservations et optimiser l'occupation avec notifications temps réel
 * 
 * Fonctionnalités :
 * - Vérification overlapping bookings
 * - Disponibilité par type de chambre
 * - Gestion statuts chambres (maintenance, hors service)
 * - Optimisation requêtes MongoDB
 * - Cache pour performances
 * - NOTIFICATIONS TEMPS RÉEL via Socket.io pour changements disponibilité
 * - Broadcasting automatique des mises à jour
 * - Alertes de low availability et overbooking
 */

const mongoose = require('mongoose');

// Socket.io service for real-time notifications
const socketService = require('../services/socketService'); // AJOUTÉ

const {
  ROOM_STATUS,
  BOOKING_STATUS,
  ROOM_TYPES,
  BUSINESS_RULES,
  ERROR_MESSAGES
} = require('./constants');

// Cache simple pour optimiser les requêtes fréquentes
const availabilityCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache pour tracking des changements de disponibilité
const lastAvailabilityStates = new Map(); // hotelId -> availability state

/**
 * ================================
 * VÉRIFICATION DISPONIBILITÉ PRINCIPALE
 * ================================
 */

/**
 * Vérifie la disponibilité de chambres pour une période donnée
 * @param {Object} params - Paramètres de recherche
 * @param {string} params.hotelId - ID de l'hôtel
 * @param {string} params.roomType - Type de chambre (optionnel, sinon tous types)
 * @param {Date} params.checkInDate - Date d'arrivée
 * @param {Date} params.checkOutDate - Date de départ
 * @param {number} params.roomsNeeded - Nombre de chambres nécessaires (défaut: 1)
 * @param {string} params.excludeBookingId - ID réservation à exclure (pour modifications)
 * @param {boolean} params.includeUnavailable - Inclure chambres en maintenance (défaut: false)
 * @param {boolean} params.broadcastChanges - Broadcaster les changements (défaut: true)
 * @returns {Object} Résultat détaillé de disponibilité
 */
const checkAvailability = async ({
  hotelId,
  roomType = null,
  checkInDate,
  checkOutDate,
  roomsNeeded = 1,
  excludeBookingId = null,
  includeUnavailable = false,
  broadcastChanges = true // NOUVEAU PARAMÈTRE
}) => {
  // ================================
  // VALIDATIONS
  // ================================
  if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
    throw new Error('ID hôtel invalide');
  }

  if (!checkInDate || !checkOutDate || !(checkInDate instanceof Date) || !(checkOutDate instanceof Date)) {
    throw new Error(ERROR_MESSAGES.INVALID_DATE);
  }

  if (checkInDate >= checkOutDate) {
    throw new Error(ERROR_MESSAGES.INVALID_DATE_RANGE);
  }

  if (checkInDate < new Date()) {
    throw new Error(ERROR_MESSAGES.DATE_IN_PAST);
  }

  if (roomsNeeded < 1 || roomsNeeded > BUSINESS_RULES.MAX_ROOMS_PER_BOOKING) {
    throw new Error(`Nombre de chambres invalide (1-${BUSINESS_RULES.MAX_ROOMS_PER_BOOKING})`);
  }

  if (roomType && !Object.values(ROOM_TYPES).includes(roomType)) {
    throw new Error(`Type de chambre invalide: ${roomType}`);
  }

  // ================================
  // VÉRIFICATION CACHE
  // ================================
  const cacheKey = generateCacheKey({
    hotelId, roomType, checkInDate, checkOutDate, roomsNeeded, excludeBookingId
  });

  const cachedResult = getFromCache(cacheKey);
  if (cachedResult) {
    return { ...cachedResult, fromCache: true };
  }

  try {
    // ================================
    // REQUÊTES PARALLÈLES
    // ================================
    
    // Import des modèles (évite les dépendances circulaires)
    const Room = require('../models/Room');
    const Booking = require('../models/Booking');

    const [
      allRooms,
      conflictingBookings
    ] = await Promise.all([
      // 1. Récupérer toutes les chambres de l'hôtel du type demandé
      getRoomsForHotel(hotelId, roomType, includeUnavailable),
      
      // 2. Trouver les réservations qui chevauchent
      getConflictingBookings(hotelId, roomType, checkInDate, checkOutDate, excludeBookingId)
    ]);

    // ================================
    // TRAITEMENT DISPONIBILITÉ
    // ================================
    
    const availabilityResult = processAvailability({
      allRooms,
      conflictingBookings,
      roomType,
      roomsNeeded,
      checkInDate,
      checkOutDate
    });

    // ================================
    // NOTIFICATIONS TEMPS RÉEL - NOUVEAU
    // ================================
    
    if (broadcastChanges) {
      await handleAvailabilityChanges(hotelId, availabilityResult, {
        checkInDate,
        checkOutDate,
        roomType,
        roomsNeeded,
        excludeBookingId
      });
    }

    // ================================
    // MISE EN CACHE & RETOUR
    // ================================
    
    setCache(cacheKey, availabilityResult);
    
    return {
      ...availabilityResult,
      fromCache: false,
      queriedAt: new Date()
    };

  } catch (error) {
    // Notification d'erreur temps réel
    socketService.sendAdminNotification('AVAILABILITY_CHECK_ERROR', {
      hotelId,
      error: error.message,
      params: { roomType, checkInDate, checkOutDate, roomsNeeded },
      requiresInvestigation: true
    });
    
    throw new Error(`Erreur vérification disponibilité: ${error.message}`);
  }
};

/**
 * ================================
 * GESTION NOTIFICATIONS TEMPS RÉEL - NOUVEAU
 * ================================
 */

/**
 * Gère les notifications de changement de disponibilité
 */
const handleAvailabilityChanges = async (hotelId, currentAvailability, searchParams) => {
  const stateKey = `${hotelId}_${searchParams.roomType || 'all'}`;
  const previousState = lastAvailabilityStates.get(stateKey);
  
  // Stocker l'état actuel
  lastAvailabilityStates.set(stateKey, {
    availability: currentAvailability,
    timestamp: new Date(),
    searchParams
  });

  // Si pas d'état précédent, pas de notifications de changement
  if (!previousState) {
    return;
  }

  const changes = detectAvailabilityChanges(previousState.availability, currentAvailability);
  
  if (changes.hasChanges) {
    await broadcastAvailabilityChanges(hotelId, changes, currentAvailability, searchParams);
  }

  // Vérifier les alertes spéciales
  await checkAvailabilityAlerts(hotelId, currentAvailability, searchParams);
};

/**
 * Détecte les changements entre deux états de disponibilité
 */
const detectAvailabilityChanges = (previousAvailability, currentAvailability) => {
  const changes = {
    hasChanges: false,
    roomsAdded: 0,
    roomsRemoved: 0,
    occupancyChanged: false,
    availabilityChanged: false,
    typeChanges: {}
  };

  // Comparaison globale
  const prevStats = previousAvailability.statistics;
  const currStats = currentAvailability.statistics;

  if (prevStats.totalAvailable !== currStats.totalAvailable) {
    changes.hasChanges = true;
    changes.availabilityChanged = true;
    changes.roomsAdded = Math.max(0, currStats.totalAvailable - prevStats.totalAvailable);
    changes.roomsRemoved = Math.max(0, prevStats.totalAvailable - currStats.totalAvailable);
  }

  if (prevStats.occupancyRate !== currStats.occupancyRate) {
    changes.hasChanges = true;
    changes.occupancyChanged = true;
    changes.occupancyChange = currStats.occupancyRate - prevStats.occupancyRate;
  }

  // Comparaison par type de chambre
  Object.keys(currentAvailability.availabilityByType).forEach(roomType => {
    const prevType = previousAvailability.availabilityByType[roomType];
    const currType = currentAvailability.availabilityByType[roomType];

    if (!prevType || prevType.available !== currType.available) {
      changes.hasChanges = true;
      changes.typeChanges[roomType] = {
        previous: prevType?.available || 0,
        current: currType.available,
        change: currType.available - (prevType?.available || 0)
      };
    }
  });

  return changes;
};

/**
 * Diffuse les changements de disponibilité
 */
const broadcastAvailabilityChanges = async (hotelId, changes, currentAvailability, searchParams) => {
  const changeData = {
    hotelId,
    timestamp: new Date(),
    changes,
    currentStats: currentAvailability.statistics,
    searchPeriod: {
      checkIn: searchParams.checkInDate,
      checkOut: searchParams.checkOutDate,
      roomType: searchParams.roomType
    }
  };

  // ================================
  // BROADCAST GÉNÉRAL
  // ================================
  
  socketService.broadcastAvailabilityUpdate(hotelId, {
    action: 'AVAILABILITY_CHANGED',
    ...changeData,
    message: generateAvailabilityChangeMessage(changes),
    impact: calculateAvailabilityImpact(changes)
  });

  // ================================
  // NOTIFICATIONS CIBLÉES
  // ================================
  
  // Notifier l'équipe de l'hôtel
  socketService.sendHotelNotification(hotelId, 'AVAILABILITY_UPDATE', {
    ...changeData,
    summary: {
      roomsAdded: changes.roomsAdded,
      roomsRemoved: changes.roomsRemoved,
      occupancyChanged: changes.occupancyChanged,
      newOccupancyRate: currentAvailability.statistics.occupancyRate
    },
    actionRequired: changes.roomsRemoved > 5 || currentAvailability.statistics.occupancyRate > 90
  });

  // Notifier les admins pour changements significatifs
  if (changes.roomsRemoved > 10 || changes.roomsAdded > 10 || Math.abs(changes.occupancyChange || 0) > 20) {
    socketService.sendAdminNotification('SIGNIFICANT_AVAILABILITY_CHANGE', {
      ...changeData,
      severity: calculateChangeSeverity(changes),
      requiresAttention: true,
      recommendations: generateRecommendations(changes, currentAvailability)
    });
  }
};

/**
 * Vérifie les alertes de disponibilité
 */
const checkAvailabilityAlerts = async (hotelId, availability, searchParams) => {
  const alerts = [];
  const stats = availability.statistics;

  // ================================
  // ALERTE LOW AVAILABILITY
  // ================================
  
  if (stats.availabilityRate < 10 && stats.totalAvailable > 0) {
    alerts.push({
      type: 'LOW_AVAILABILITY',
      severity: 'HIGH',
      message: `Disponibilité critique: ${stats.availabilityRate}% (${stats.totalAvailable} chambres)`,
      data: {
        availabilityRate: stats.availabilityRate,
        roomsRemaining: stats.totalAvailable,
        occupancyRate: stats.occupancyRate
      }
    });
  }

  // ================================
  // ALERTE FULLY BOOKED
  // ================================
  
  if (stats.totalAvailable === 0 && stats.totalRooms > 0) {
    alerts.push({
      type: 'FULLY_BOOKED',
      severity: 'CRITICAL',
      message: 'Hôtel complet - Aucune chambre disponible',
      data: {
        totalRooms: stats.totalRooms,
        occupancyRate: 100,
        period: {
          checkIn: searchParams.checkInDate,
          checkOut: searchParams.checkOutDate
        }
      }
    });
  }

  // ================================
  // ALERTE HIGH DEMAND
  // ================================
  
  if (stats.occupancyRate > 85 && stats.occupancyRate < 100) {
    alerts.push({
      type: 'HIGH_DEMAND',
      severity: 'MEDIUM',
      message: `Forte demande: ${stats.occupancyRate}% d'occupation`,
      data: {
        occupancyRate: stats.occupancyRate,
        roomsRemaining: stats.totalAvailable,
        opportunityForUpselling: true
      }
    });
  }

  // ================================
  // ALERTE OVERBOOKING RISK
  // ================================
  
  const pendingBookings = await getPendingBookingsCount(hotelId, searchParams.checkInDate, searchParams.checkOutDate);
  if (pendingBookings > stats.totalAvailable) {
    alerts.push({
      type: 'OVERBOOKING_RISK',
      severity: 'CRITICAL',
      message: `Risque de surbooking: ${pendingBookings} réservations en attente vs ${stats.totalAvailable} chambres disponibles`,
      data: {
        pendingBookings,
        availableRooms: stats.totalAvailable,
        overbookingRisk: pendingBookings - stats.totalAvailable
      }
    });
  }

  // ================================
  // ENVOYER ALERTES
  // ================================
  
  for (const alert of alerts) {
    await sendAvailabilityAlert(hotelId, alert, searchParams);
  }
};

/**
 * Envoie une alerte de disponibilité
 */
const sendAvailabilityAlert = async (hotelId, alert, searchParams) => {
  // Notification équipe hôtel
  socketService.sendHotelNotification(hotelId, `AVAILABILITY_ALERT_${alert.type}`, {
    alert: alert.type,
    severity: alert.severity,
    message: alert.message,
    data: alert.data,
    period: {
      checkIn: searchParams.checkInDate,
      checkOut: searchParams.checkOutDate
    },
    actionRequired: ['CRITICAL', 'HIGH'].includes(alert.severity),
    timestamp: new Date()
  });

  // Notification admin pour alertes critiques
  if (['CRITICAL', 'HIGH'].includes(alert.severity)) {
    socketService.sendAdminNotification(`AVAILABILITY_ALERT_${alert.type}`, {
      hotelId,
      alert: alert.type,
      severity: alert.severity,
      message: alert.message,
      data: alert.data,
      requiresImmediateAction: alert.severity === 'CRITICAL',
      recommendations: getAlertRecommendations(alert.type, alert.data)
    });
  }
};

/**
 * ================================
 * FONCTIONS UTILITAIRES NOTIFICATIONS
 * ================================
 */

/**
 * Génère un message descriptif pour les changements
 */
const generateAvailabilityChangeMessage = (changes) => {
  const messages = [];

  if (changes.roomsAdded > 0) {
    messages.push(`${changes.roomsAdded} chambre(s) libérée(s)`);
  }

  if (changes.roomsRemoved > 0) {
    messages.push(`${changes.roomsRemoved} chambre(s) réservée(s)`);
  }

  if (changes.occupancyChanged) {
    const direction = changes.occupancyChange > 0 ? 'augmentation' : 'diminution';
    messages.push(`${direction} du taux d'occupation`);
  }

  return messages.length > 0 ? messages.join(', ') : 'Mise à jour disponibilité';
};

/**
 * Calcule l'impact des changements
 */
const calculateAvailabilityImpact = (changes) => {
  if (changes.roomsRemoved > 10 || Math.abs(changes.occupancyChange || 0) > 25) {
    return 'HIGH';
  } else if (changes.roomsRemoved > 5 || changes.roomsAdded > 5 || Math.abs(changes.occupancyChange || 0) > 10) {
    return 'MEDIUM';
  } else {
    return 'LOW';
  }
};

/**
 * Calcule la sévérité du changement
 */
const calculateChangeSeverity = (changes) => {
  if (changes.roomsRemoved > 20 || Math.abs(changes.occupancyChange || 0) > 30) {
    return 'CRITICAL';
  } else if (changes.roomsRemoved > 10 || Math.abs(changes.occupancyChange || 0) > 20) {
    return 'HIGH';
  } else {
    return 'MEDIUM';
  }
};

/**
 * Génère des recommandations basées sur les changements
 */
const generateRecommendations = (changes, availability) => {
  const recommendations = [];

  if (availability.statistics.occupancyRate > 90) {
    recommendations.push('Considérer augmentation des tarifs (yield management)');
    recommendations.push('Vérifier liste d\'attente pour upselling');
  }

  if (changes.roomsRemoved > 10) {
    recommendations.push('Surveiller risque de surbooking');
    recommendations.push('Préparer protocole de relocation si nécessaire');
  }

  if (availability.statistics.availabilityRate < 5) {
    recommendations.push('Arrêter nouvelles réservations temporairement');
    recommendations.push('Contacter clients pour confirmer arrivées');
  }

  return recommendations;
};

/**
 * Obtient les recommandations pour les alertes
 */
const getAlertRecommendations = (alertType, data) => {
  switch (alertType) {
    case 'LOW_AVAILABILITY':
      return [
        'Vérifier possibilité de libérer chambres en maintenance',
        'Préparer communication "complet" pour nouveaux clients',
        'Activer liste d\'attente'
      ];
    case 'FULLY_BOOKED':
      return [
        'Arrêter toutes nouvelles réservations',
        'Mettre en place système de liste d\'attente',
        'Préparer offres pour dates alternatives'
      ];
    case 'OVERBOOKING_RISK':
      return [
        'Valider urgence réservations en attente',
        'Identifier chambres supplémentaires possibles',
        'Préparer protocole de relocation partenaires'
      ];
    case 'HIGH_DEMAND':
      return [
        'Augmenter tarifs pour maximiser revenus',
        'Proposer upgrades payants',
        'Optimiser services additionnels'
      ];
    default:
      return [];
  }
};

/**
 * Obtient le nombre de réservations en attente
 */
const getPendingBookingsCount = async (hotelId, checkInDate, checkOutDate) => {
  try {
    const Booking = require('../models/Booking');
    
    const count = await Booking.countDocuments({
      hotel: hotelId,
      status: BOOKING_STATUS.PENDING,
      $and: [
        { checkOutDate: { $gt: checkInDate } },
        { checkInDate: { $lt: checkOutDate } }
      ]
    });
    
    return count;
  } catch (error) {
    console.error('Error getting pending bookings count:', error);
    return 0;
  }
};

/**
 * ================================
 * REQUÊTES BASE DE DONNÉES
 * ================================
 */

/**
 * Récupère les chambres d'un hôtel avec filtres
 */
const getRoomsForHotel = async (hotelId, roomType = null, includeUnavailable = false) => {
  const Room = require('../models/Room');
  
  const query = { hotel: hotelId };
  
  // Filtre par type si spécifié
  if (roomType) {
    query.type = roomType;
  }
  
  // Filtre par statut (exclure maintenance/hors service par défaut)
  if (!includeUnavailable) {
    query.status = { $in: [ROOM_STATUS.AVAILABLE, ROOM_STATUS.OCCUPIED] };
  }
  
  return await Room.find(query)
    .select('_id number type status floor basePrice')
    .sort({ floor: 1, number: 1 })
    .lean(); // Optimisation performance
};

/**
 * Trouve les réservations qui chevauchent avec la période demandée
 */
const getConflictingBookings = async (hotelId, roomType, checkInDate, checkOutDate, excludeBookingId) => {
  const Booking = require('../models/Booking');
  
  const query = {
    hotel: hotelId,
    // Statuts qui bloquent les chambres
    status: {
      $in: [
        BOOKING_STATUS.CONFIRMED,
        BOOKING_STATUS.CHECKED_IN,
        BOOKING_STATUS.PENDING // Les pending bloquent aussi (validation admin en attente)
      ]
    },
    // Chevauchement de dates : booking qui se termine après notre début ET commence avant notre fin
    $and: [
      { checkOutDate: { $gt: checkInDate } },   // Leur départ > notre arrivée
      { checkInDate: { $lt: checkOutDate } }    // Leur arrivée < notre départ
    ]
  };
  
  // Exclure une réservation spécifique (pour modifications)
  if (excludeBookingId) {
    query._id = { $ne: excludeBookingId };
  }
  
  // Filtre par type de chambre si spécifié
  if (roomType) {
    query['rooms.type'] = roomType;
  }
  
  return await Booking.find(query)
    .select('_id checkInDate checkOutDate status rooms')
    .populate('rooms.room', 'number type')
    .lean();
};

/**
 * ================================
 * TRAITEMENT LOGIQUE DISPONIBILITÉ
 * ================================
 */

/**
 * Traite les données pour déterminer la disponibilité
 */
const processAvailability = ({
  allRooms,
  conflictingBookings,
  roomType,
  roomsNeeded,
  checkInDate,
  checkOutDate
}) => {
  // ================================
  // IDENTIFICATION CHAMBRES OCCUPÉES
  // ================================
  
  const occupiedRoomIds = new Set();
  
  conflictingBookings.forEach(booking => {
    booking.rooms.forEach(roomBooking => {
      if (!roomType || roomBooking.type === roomType) {
        if (roomBooking.room && roomBooking.room._id) {
          occupiedRoomIds.add(roomBooking.room._id.toString());
        }
      }
    });
  });

  // ================================
  // CALCUL DISPONIBILITÉ PAR TYPE
  // ================================
  
  const availabilityByType = {};
  const availableRooms = [];
  const unavailableRooms = [];
  
  allRooms.forEach(room => {
    const roomId = room._id.toString();
    const isOccupied = occupiedRoomIds.has(roomId);
    const isUnavailable = room.status !== ROOM_STATUS.AVAILABLE;
    
    // Initialiser compteur par type si nécessaire
    if (!availabilityByType[room.type]) {
      availabilityByType[room.type] = {
        total: 0,
        available: 0,
        occupied: 0,
        unavailable: 0,
        availableRooms: [],
        occupiedRooms: [],
        unavailableRooms: []
      };
    }
    
    const typeStats = availabilityByType[room.type];
    typeStats.total++;
    
    if (isUnavailable) {
      // Chambre en maintenance/hors service
      typeStats.unavailable++;
      typeStats.unavailableRooms.push(room);
      unavailableRooms.push(room);
    } else if (isOccupied) {
      // Chambre occupée par réservation
      typeStats.occupied++;
      typeStats.occupiedRooms.push(room);
      unavailableRooms.push(room);
    } else {
      // Chambre disponible
      typeStats.available++;
      typeStats.availableRooms.push(room);
      availableRooms.push(room);
    }
  });

  // ================================
  // VÉRIFICATION BESOIN SPÉCIFIQUE
  // ================================
  
  let canAccommodate = false;
  let recommendedRooms = [];
  
  if (roomType) {
    // Type spécifique demandé
    const typeAvailability = availabilityByType[roomType];
    if (typeAvailability && typeAvailability.available >= roomsNeeded) {
      canAccommodate = true;
      recommendedRooms = typeAvailability.availableRooms.slice(0, roomsNeeded);
    }
  } else {
    // Tous types acceptés - optimiser allocation
    recommendedRooms = optimizeRoomAllocation(availabilityByType, roomsNeeded);
    canAccommodate = recommendedRooms.length >= roomsNeeded;
  }

  // ================================
  // STATISTIQUES GLOBALES
  // ================================
  
  const totalRooms = allRooms.length;
  const totalAvailable = availableRooms.length;
  const totalOccupied = conflictingBookings.reduce((sum, booking) => 
    sum + booking.rooms.filter(r => !roomType || r.type === roomType).length, 0
  );
  const totalUnavailable = unavailableRooms.filter(r => r.status !== ROOM_STATUS.AVAILABLE).length;
  
  const occupancyRate = totalRooms > 0 ? Math.round(((totalOccupied + totalUnavailable) / totalRooms) * 100) : 0;

  // ================================
  // RETOUR STRUCTURÉ
  // ================================
  
  return {
    // Résultat principal
    available: canAccommodate,
    roomsRequested: roomsNeeded,
    roomsFound: recommendedRooms.length,
    
    // Chambres recommandées
    recommendedRooms: recommendedRooms.map(room => ({
      id: room._id,
      number: room.number,
      type: room.type,
      floor: room.floor,
      basePrice: room.basePrice
    })),
    
    // Détail par type
    availabilityByType,
    
    // Statistiques globales
    statistics: {
      totalRooms,
      totalAvailable,
      totalOccupied,
      totalUnavailable,
      occupancyRate,
      availabilityRate: totalRooms > 0 ? Math.round((totalAvailable / totalRooms) * 100) : 0
    },
    
    // Métadonnées
    searchCriteria: {
      hotelId,
      roomType,
      checkInDate,
      checkOutDate,
      roomsNeeded
    },
    
    // Suggestions si pas disponible
    alternatives: canAccommodate ? null : generateAlternatives(availabilityByType, roomsNeeded, roomType)
  };
};

/**
 * ================================
 * OPTIMISATION ALLOCATION CHAMBRES
 * ================================
 */

/**
 * Optimise l'allocation des chambres quand plusieurs types acceptés
 */
const optimizeRoomAllocation = (availabilityByType, roomsNeeded) => {
  const availableRooms = [];
  
  // Trier les types par ordre de préférence/prix (Simple > Double > Double Confort > Suite)
  const typeOrder = [ROOM_TYPES.SIMPLE, ROOM_TYPES.DOUBLE, ROOM_TYPES.DOUBLE_COMFORT, ROOM_TYPES.SUITE];
  
  for (const type of typeOrder) {
    const typeAvailability = availabilityByType[type];
    if (typeAvailability && typeAvailability.available > 0) {
      const roomsToTake = Math.min(typeAvailability.available, roomsNeeded - availableRooms.length);
      availableRooms.push(...typeAvailability.availableRooms.slice(0, roomsToTake));
      
      if (availableRooms.length >= roomsNeeded) {
        break;
      }
    }
  }
  
  return availableRooms;
};

/**
 * Génère des alternatives si la demande exacte n'est pas disponible
 */
const generateAlternatives = (availabilityByType, roomsNeeded, requestedType) => {
  const alternatives = [];
  
  // Alternative 1: Même type, dates différentes (à implémenter avec d'autres dates)
  
  // Alternative 2: Types différents avec même nombre de chambres
  if (requestedType) {
    Object.entries(availabilityByType).forEach(([type, availability]) => {
      if (type !== requestedType && availability.available >= roomsNeeded) {
        alternatives.push({
          type: 'different_room_type',
          suggestion: `${roomsNeeded} chambre(s) ${type} disponible(s)`,
          roomType: type,
          availableCount: availability.available
        });
      }
    });
  }
  
  // Alternative 3: Nombre réduit de chambres
  const totalAvailable = Object.values(availabilityByType).reduce((sum, avail) => sum + avail.available, 0);
  if (totalAvailable > 0 && totalAvailable < roomsNeeded) {
    alternatives.push({
      type: 'reduced_quantity',
      suggestion: `${totalAvailable} chambre(s) disponible(s) au lieu de ${roomsNeeded}`,
      availableCount: totalAvailable
    });
  }
  
  return alternatives.length > 0 ? alternatives : null;
};

/**
 * ================================
 * UTILITAIRES SPÉCIALISÉS AVEC NOTIFICATIONS
 * ================================
 */

/**
 * Vérifie si une chambre spécifique est disponible
 */
const isRoomAvailable = async (roomId, checkInDate, checkOutDate, excludeBookingId = null) => {
  try {
    const Room = require('../models/Room');
    const room = await Room.findById(roomId).select('hotel type status number');
    
    if (!room) {
      throw new Error(ERROR_MESSAGES.ROOM_NOT_FOUND);
    }
    
    if (room.status !== ROOM_STATUS.AVAILABLE) {
      return {
        available: false,
        reason: `Chambre en statut: ${room.status}`,
        roomNumber: room.number,
        roomType: room.type
      };
    }
    
    const availability = await checkAvailability({
      hotelId: room.hotel,
      roomType: room.type,
      checkInDate,
      checkOutDate,
      roomsNeeded: 1,
      excludeBookingId,
      broadcastChanges: false // Pas de broadcast pour vérification individuelle
    });
    
    const isThisRoomAvailable = availability.recommendedRooms.some(r => r.id.toString() === roomId);
    
    const result = {
      available: isThisRoomAvailable,
      reason: isThisRoomAvailable ? null : 'Chambre occupée pour cette période',
      roomNumber: room.number,
      roomType: room.type,
      hotelId: room.hotel
    };

    // Notification temps réel pour requêtes spécifiques importantes
    if (!isThisRoomAvailable) {
      socketService.sendHotelNotification(room.hotel.toString(), 'ROOM_UNAVAILABLE_CHECK', {
        roomId,
        roomNumber: room.number,
        roomType: room.type,
        period: { checkInDate, checkOutDate },
        reason: result.reason,
        checkedAt: new Date()
      });
    }
    
    return result;
    
  } catch (error) {
    // Notification d'erreur
    socketService.sendAdminNotification('ROOM_AVAILABILITY_CHECK_ERROR', {
      roomId,
      error: error.message,
      period: { checkInDate, checkOutDate },
      requiresInvestigation: true
    });
    
    throw new Error(`Erreur vérification chambre: ${error.message}`);
  }
};

/**
 * Obtient le taux d'occupation d'un hôtel pour une période
 */
const getOccupancyRate = async (hotelId, startDate, endDate, broadcastUpdate = true) => {
  try {
    const availability = await checkAvailability({
      hotelId,
      checkInDate: startDate,
      checkOutDate: endDate,
      roomsNeeded: 1,
      includeUnavailable: true,
      broadcastChanges: false // Contrôlé par le paramètre broadcastUpdate
    });
    
    const occupancyData = {
      occupancyRate: availability.statistics.occupancyRate,
      availabilityRate: availability.statistics.availabilityRate,
      totalRooms: availability.statistics.totalRooms,
      totalOccupied: availability.statistics.totalOccupied,
      totalAvailable: availability.statistics.totalAvailable,
      period: { startDate, endDate },
      calculatedAt: new Date()
    };

    // Notification temps réel des métriques d'occupation
    if (broadcastUpdate) {
      socketService.sendHotelNotification(hotelId, 'OCCUPANCY_METRICS_UPDATE', {
        ...occupancyData,
        performance: occupancyData.occupancyRate > 85 ? 'EXCELLENT' : 
                    occupancyData.occupancyRate > 70 ? 'GOOD' : 
                    occupancyData.occupancyRate > 50 ? 'AVERAGE' : 'LOW',
        recommendations: generateOccupancyRecommendations(occupancyData.occupancyRate)
      });

      // Notification admin pour performance exceptionnelle ou problématique
      if (occupancyData.occupancyRate > 95 || occupancyData.occupancyRate < 30) {
        socketService.sendAdminNotification('OCCUPANCY_ALERT', {
          hotelId,
          occupancyRate: occupancyData.occupancyRate,
          severity: occupancyData.occupancyRate > 95 ? 'OVERBOOKING_RISK' : 'LOW_PERFORMANCE',
          period: { startDate, endDate },
          requiresAttention: true
        });
      }
    }
    
    return occupancyData;
    
  } catch (error) {
    throw new Error(`Erreur calcul taux occupation: ${error.message}`);
  }
};

/**
 * Génère des recommandations basées sur le taux d'occupation
 */
const generateOccupancyRecommendations = (occupancyRate) => {
  if (occupancyRate > 90) {
    return [
      'Augmenter les tarifs (yield management)',
      'Proposer des upgrades payants',
      'Surveiller le risque de surbooking'
    ];
  } else if (occupancyRate > 70) {
    return [
      'Optimiser les services additionnels',
      'Promouvoir les offres de dernière minute',
      'Maintenir la qualité de service'
    ];
  } else if (occupancyRate > 50) {
    return [
      'Lancer des campagnes promotionnelles',
      'Revoir la stratégie tarifaire',
      'Améliorer la visibilité marketing'
    ];
  } else {
    return [
      'Revoir urgence la stratégie commerciale',
      'Analyser la concurrence',
      'Considérer des offres agressives'
    ];
  }
};

/**
 * ================================
 * FONCTIONS DE MISE À JOUR TEMPS RÉEL
 * ================================
 */

/**
 * Met à jour la disponibilité après changement de statut de chambre
 */
const updateRoomAvailability = async (hotelId, roomType, dates, operation, userId = null, context = {}) => {
  try {
    // Recalculer disponibilité
    const updatedAvailability = await checkAvailability({
      hotelId,
      roomType,
      checkInDate: dates.checkIn || new Date(),
      checkOutDate: dates.checkOut || new Date(Date.now() + 24 * 60 * 60 * 1000),
      roomsNeeded: 1,
      broadcastChanges: true
    });

    // Notification détaillée de la mise à jour
    socketService.broadcastAvailabilityUpdate(hotelId, {
      action: 'ROOM_AVAILABILITY_UPDATED',
      roomType,
      dates,
      operation, // 'RESERVE', 'RELEASE', 'MAINTENANCE', 'ACTIVATE'
      updatedAvailability: {
        totalAvailable: updatedAvailability.statistics.totalAvailable,
        occupancyRate: updatedAvailability.statistics.occupancyRate,
        availabilityByType: updatedAvailability.availabilityByType
      },
      context,
      updatedBy: userId,
      timestamp: new Date()
    });

    // Invalider le cache
    invalidateHotelCache(hotelId);
    
    return updatedAvailability;
    
  } catch (error) {
    console.error('Error updating room availability:', error);
    
    // Notification d'erreur
    socketService.sendAdminNotification('ROOM_AVAILABILITY_UPDATE_ERROR', {
      hotelId,
      roomType,
      operation,
      error: error.message,
      requiresInvestigation: true
    });
    
    throw error;
  }
};

/**
 * Vérifie la disponibilité en temps réel et diffuse si changement
 */
const checkRealTimeAvailability = async (hotelId, checkIn, checkOut, roomType = null, context = {}) => {
  try {
    const availability = await checkAvailability({
      hotelId,
      roomType,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomsNeeded: 1,
      broadcastChanges: true
    });

    // Log pour monitoring
    console.log(`Real-time availability check: Hotel ${hotelId}, ${checkIn.toISOString()} to ${checkOut.toISOString()}`);

    // Notification temps réel du check
    socketService.sendHotelNotification(hotelId, 'REAL_TIME_AVAILABILITY_CHECK', {
      searchCriteria: {
        checkIn,
        checkOut,
        roomType
      },
      result: {
        available: availability.available,
        roomsFound: availability.roomsFound,
        occupancyRate: availability.statistics.occupancyRate
      },
      context,
      checkedAt: new Date()
    });

    return {
      hotelId,
      checkIn,
      checkOut,
      roomType,
      available: availability.available,
      availableRooms: availability.recommendedRooms,
      prices: availability.statistics,
      lastUpdated: new Date(),
      alternatives: availability.alternatives
    };
    
  } catch (error) {
    console.error('Real-time availability check error:', error);
    throw error;
  }
};

/**
 * Libère une réservation et met à jour la disponibilité
 */
const releaseReservation = async (bookingId, userId = null, reason = 'Booking cancelled') => {
  try {
    const Booking = require('../models/Booking');
    const booking = await Booking.findById(bookingId).populate('hotel', 'name');
    
    if (!booking) {
      throw new Error('Booking not found');
    }

    const roomsReleased = booking.rooms.length;
    const roomTypes = [...new Set(booking.rooms.map(r => r.type))];

    // Recalculer disponibilité
    const updatedAvailability = await checkAvailability({
      hotelId: booking.hotel._id,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      roomsNeeded: 1,
      broadcastChanges: true
    });

    // Notification de libération
    socketService.broadcastAvailabilityUpdate(booking.hotel._id.toString(), {
      action: 'RESERVATION_RELEASED',
      bookingId: booking._id,
      roomsReleased,
      roomTypes,
      checkIn: booking.checkInDate,
      checkOut: booking.checkOutDate,
      reason,
      releasedBy: userId,
      newAvailability: {
        totalAvailable: updatedAvailability.statistics.totalAvailable,
        occupancyRate: updatedAvailability.statistics.occupancyRate
      },
      message: `${roomsReleased} chambre(s) libérée(s) - ${booking.hotel.name}`,
      timestamp: new Date()
    });

    // Invalider cache
    invalidateHotelCache(booking.hotel._id);
    
    return {
      success: true,
      roomsReleased,
      updatedAvailability
    };
    
  } catch (error) {
    console.error('Error releasing reservation:', error);
    
    // Notification d'erreur
    socketService.sendAdminNotification('RESERVATION_RELEASE_ERROR', {
      bookingId,
      error: error.message,
      requiresManualCheck: true
    });
    
    throw error;
  }
};

/**
 * Bloque des chambres pour maintenance ou autres raisons
 */
const blockRooms = async (hotelId, roomNumbers, startDate, endDate, reason, userId) => {
  try {
    const Room = require('../models/Room');
    
    // Bloquer les chambres
    const updateResult = await Room.updateMany(
      { 
        hotel: hotelId, 
        number: { $in: roomNumbers },
        status: ROOM_STATUS.AVAILABLE 
      },
      { 
        status: ROOM_STATUS.MAINTENANCE,
        maintenanceReason: reason,
        maintenanceStart: startDate,
        maintenanceEnd: endDate,
        updatedBy: userId,
        updatedAt: new Date()
      }
    );

    // Recalculer disponibilité
    const updatedAvailability = await checkAvailability({
      hotelId,
      checkInDate: startDate,
      checkOutDate: endDate,
      roomsNeeded: 1,
      includeUnavailable: true,
      broadcastChanges: true
    });

    // Notification de blocage
    socketService.sendHotelNotification(hotelId, 'ROOMS_BLOCKED', {
      roomNumbers,
      roomsBlocked: updateResult.modifiedCount,
      startDate,
      endDate,
      reason,
      blockedBy: userId,
      impact: {
        roomsAffected: updateResult.modifiedCount,
        newAvailability: updatedAvailability.statistics.totalAvailable,
        occupancyIncrease: updateResult.modifiedCount
      },
      message: `${updateResult.modifiedCount} chambre(s) bloquée(s) pour: ${reason}`
    });

    // Notification admin pour blocages importants
    if (updateResult.modifiedCount > 5) {
      socketService.sendAdminNotification('SIGNIFICANT_ROOMS_BLOCKED', {
        hotelId,
        roomsBlocked: updateResult.modifiedCount,
        reason,
        period: `${startDate.toDateString()} - ${endDate.toDateString()}`,
        impactAssessment: 'Revenue impact analysis recommended'
      });
    }

    // Invalider cache
    invalidateHotelCache(hotelId);
    
    return {
      success: true,
      roomsBlocked: updateResult.modifiedCount,
      updatedAvailability
    };
    
  } catch (error) {
    console.error('Error blocking rooms:', error);
    
    // Notification d'erreur
    socketService.sendAdminNotification('ROOMS_BLOCKING_ERROR', {
      hotelId,
      roomNumbers,
      error: error.message,
      requiresManualIntervention: true
    });
    
    throw error;
  }
};

/**
 * ================================
 * MONITORING ET RAPPORTS TEMPS RÉEL
 * ================================
 */

/**
 * Obtient un rapport de disponibilité en temps réel
 */
const getRealTimeAvailabilityReport = async (hotelId, period = '7d') => {
  try {
    const endDate = new Date();
    const daysMap = { '1d': 1, '7d': 7, '30d': 30 };
    const days = daysMap[period] || 7;
    const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

    const dailyReports = [];
    const currentDate = new Date(startDate);

    // Générer rapport jour par jour
    while (currentDate <= endDate) {
      const nextDay = new Date(currentDate);
      nextDay.setDate(nextDay.getDate() + 1);

      try {
        const dailyAvailability = await checkAvailability({
          hotelId,
          checkInDate: currentDate,
          checkOutDate: nextDay,
          roomsNeeded: 1,
          includeUnavailable: true,
          broadcastChanges: false
        });

        dailyReports.push({
          date: new Date(currentDate),
          ...dailyAvailability.statistics,
          forecast: generateDailyForecast(dailyAvailability.statistics)
        });
      } catch (error) {
        console.error(`Error getting availability for ${currentDate}:`, error);
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    const report = {
      hotelId,
      period: { startDate, endDate, days },
      dailyReports,
      summary: {
        averageOccupancy: Math.round(dailyReports.reduce((sum, day) => sum + day.occupancyRate, 0) / dailyReports.length),
        peakOccupancy: Math.max(...dailyReports.map(day => day.occupancyRate)),
        lowestOccupancy: Math.min(...dailyReports.map(day => day.occupancyRate)),
        totalRevenueDays: dailyReports.filter(day => day.occupancyRate > 70).length,
        concernDays: dailyReports.filter(day => day.occupancyRate > 95).length
      },
      generatedAt: new Date()
    };

    // Diffuser le rapport
    socketService.sendHotelNotification(hotelId, 'AVAILABILITY_REPORT_GENERATED', {
      reportPeriod: period,
      summary: report.summary,
      alertDays: report.summary.concernDays,
      performance: report.summary.averageOccupancy > 75 ? 'EXCELLENT' : 
                  report.summary.averageOccupancy > 60 ? 'GOOD' : 'NEEDS_IMPROVEMENT'
    });

    return report;
    
  } catch (error) {
    console.error('Error generating availability report:', error);
    throw error;
  }
};

/**
 * Génère une prévision pour un jour donné
 */
const generateDailyForecast = (dayStats) => {
  if (dayStats.occupancyRate > 90) {
    return {
      status: 'HIGH_DEMAND',
      recommendation: 'Augmenter tarifs',
      riskLevel: 'OVERBOOKING_RISK'
    };
  } else if (dayStats.occupancyRate > 70) {
    return {
      status: 'GOOD_DEMAND',
      recommendation: 'Maintenir tarifs',
      riskLevel: 'LOW'
    };
  } else {
    return {
      status: 'LOW_DEMAND',
      recommendation: 'Promotions recommandées',
      riskLevel: 'REVENUE_LOSS'
    };
  }
};

/**
 * Surveille la disponibilité en continu
 */
const startAvailabilityMonitoring = (hotelId, intervalMinutes = 15) => {
  const monitoringInterval = setInterval(async () => {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);

      // Vérifier disponibilité pour demain
      await checkRealTimeAvailability(hotelId, tomorrow, dayAfter, null, {
        source: 'automated_monitoring',
        interval: intervalMinutes
      });

    } catch (error) {
      console.error(`Availability monitoring error for hotel ${hotelId}:`, error);
      
      socketService.sendAdminNotification('AVAILABILITY_MONITORING_ERROR', {
        hotelId,
        error: error.message,
        monitoringInterval: intervalMinutes,
        requiresInvestigation: true
      });
    }
  }, intervalMinutes * 60 * 1000);

  // Notification de démarrage du monitoring
  socketService.sendHotelNotification(hotelId, 'AVAILABILITY_MONITORING_STARTED', {
    intervalMinutes,
    monitoringId: monitoringInterval,
    message: `Surveillance disponibilité démarrée (vérification toutes les ${intervalMinutes} minutes)`
  });

  return monitoringInterval;
};

/**
 * ================================
 * GESTION CACHE AVEC NOTIFICATIONS
 * ================================
 */

const generateCacheKey = (params) => {
  return `availability_${params.hotelId}_${params.roomType || 'all'}_${params.checkInDate.getTime()}_${params.checkOutDate.getTime()}_${params.roomsNeeded}_${params.excludeBookingId || 'none'}`;
};

const getFromCache = (key) => {
  const cached = availabilityCache.get(key);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
    return cached.data;
  }
  availabilityCache.delete(key);
  return null;
};

const setCache = (key, data) => {
  availabilityCache.set(key, {
    data,
    timestamp: Date.now()
  });
  
  // Nettoyage cache si trop d'entrées
  if (availabilityCache.size > 1000) {
    const oldestKeys = Array.from(availabilityCache.keys()).slice(0, 200);
    oldestKeys.forEach(key => availabilityCache.delete(key));
  }
};

/**
 * Invalide le cache pour un hôtel (après modification/nouvelle réservation)
 */
const invalidateHotelCache = (hotelId) => {
  const keysToDelete = [];
  const beforeCount = availabilityCache.size;
  
  availabilityCache.forEach((value, key) => {
    if (key.includes(`availability_${hotelId}_`)) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => availabilityCache.delete(key));
  
  const deletedCount = keysToDelete.length;
  
  // Notification de cache invalidé pour monitoring
  if (deletedCount > 0) {
    socketService.sendAdminNotification('AVAILABILITY_CACHE_INVALIDATED', {
      hotelId,
      entriesDeleted: deletedCount,
      cacheSize: availabilityCache.size,
      reason: 'Hotel availability changed',
      timestamp: new Date()
    });
  }
  
  console.log(`Cache invalidated for hotel ${hotelId}: ${deletedCount} entries deleted`);
};

/**
 * Obtient les statistiques du cache
 */
const getCacheStats = () => {
  const stats = {
    totalEntries: availabilityCache.size,
    oldestEntry: null,
    newestEntry: null,
    hitRate: 0 // TODO: Implémenter tracking des hits/misses
  };

  let oldestTime = Date.now();
  let newestTime = 0;

  availabilityCache.forEach((value, key) => {
    if (value.timestamp < oldestTime) {
      oldestTime = value.timestamp;
      stats.oldestEntry = key;
    }
    if (value.timestamp > newestTime) {
      newestTime = value.timestamp;
      stats.newestEntry = key;
    }
  });

  return stats;
};

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // Fonction principale
  checkAvailability,
  
  // Utilitaires spécialisés
  isRoomAvailable,
  getOccupancyRate,
  
  // Fonctions de mise à jour temps réel
  updateRoomAvailability,
  checkRealTimeAvailability,
  releaseReservation,
  blockRooms,
  
  // Monitoring et rapports
  getRealTimeAvailabilityReport,
  startAvailabilityMonitoring,
  
  // Gestion cache
  invalidateHotelCache,
  getCacheStats,
  
  // Notifications et alertes
  handleAvailabilityChanges,
  broadcastAvailabilityChanges,
  checkAvailabilityAlerts,
  sendAvailabilityAlert,
  
  // Helpers internes (pour tests)
  processAvailability,
  optimizeRoomAllocation,
  generateAlternatives,
  getRoomsForHotel,
  getConflictingBookings,
  detectAvailabilityChanges,
  generateDailyForecast
};