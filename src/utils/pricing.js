/**
 * PRICING LOGIC - CALCUL PRIX DYNAMIQUE SYSTÈME HÔTELIER
 * ENHANCED WITH YIELD MANAGEMENT SYSTEM
 * 
 * Logique métier pour calcul automatique des prix selon :
 * - Type de chambre (Simple, Double, Double Confort, Suite)
 * - Saison (Low, Medium, High, Peak)
 * - Catégorie hôtel (1-5 étoiles)
 * - Nombre de nuits
 * 
 * NOUVEAU - YIELD MANAGEMENT:
 * - Analyse de la demande en temps réel
 * - Pricing dynamique basé sur l'occupation
 * - Prédiction de demande avec historique
 * - Optimisation automatique des revenus
 * - Ajustements basés sur les événements
 */

const {
  ROOM_TYPES,
  ROOM_TYPE_MULTIPLIERS,
  SEASONS,
  SEASONAL_MULTIPLIERS,
  DEFAULT_SEASONAL_PERIODS,
  HOTEL_CATEGORIES,
  HOTEL_CATEGORY_MULTIPLIERS,
  BUSINESS_RULES,
  ERROR_MESSAGES
} = require('./constants');

// Import des services pour yield management
const Booking = require('../models/Booking');
const Room = require('../models/Room');
const PricingRule = require('../models/PricingRule');
const socketService = require('../services/socketService');
const { logger } = require('./logger');

/**
 * ================================
 * YIELD MANAGEMENT CONFIGURATION
 * ================================
 */

const YIELD_MANAGEMENT_CONFIG = {
  // Seuils d'occupation pour ajustement de prix
  OCCUPANCY_THRESHOLDS: {
    VERY_LOW: { min: 0, max: 30, multiplier: 0.85 },      // -15%
    LOW: { min: 30, max: 50, multiplier: 0.95 },          // -5%
    MEDIUM: { min: 50, max: 70, multiplier: 1.0 },        // Prix normal
    HIGH: { min: 70, max: 85, multiplier: 1.15 },         // +15%
    VERY_HIGH: { min: 85, max: 95, multiplier: 1.35 },    // +35%
    CRITICAL: { min: 95, max: 100, multiplier: 1.5 }      // +50%
  },

  // Multiplicateurs par anticipation de réservation
  BOOKING_WINDOW_MULTIPLIERS: {
    LAST_MINUTE: { days: 3, multiplier: 1.25 },           // +25% dernière minute
    SHORT_TERM: { days: 7, multiplier: 1.1 },             // +10%
    MEDIUM_TERM: { days: 30, multiplier: 1.0 },           // Normal
    LONG_TERM: { days: 60, multiplier: 0.9 },             // -10% early bird
    VERY_LONG_TERM: { days: 90, multiplier: 0.85 }        // -15% super early bird
  },

  // Multiplicateurs selon jour de la semaine
  DAY_OF_WEEK_MULTIPLIERS: {
    SUNDAY: 0.9,
    MONDAY: 0.85,
    TUESDAY: 0.85,
    WEDNESDAY: 0.9,
    THURSDAY: 0.95,
    FRIDAY: 1.15,
    SATURDAY: 1.2
  },

  // Multiplicateurs selon durée du séjour
  LENGTH_OF_STAY_MULTIPLIERS: {
    1: 1.1,      // +10% pour 1 nuit
    2: 1.05,     // +5% pour 2 nuits
    3: 1.0,      // Normal pour 3 nuits
    4: 0.98,     // -2% pour 4 nuits
    5: 0.96,     // -4% pour 5 nuits
    6: 0.94,     // -6% pour 6 nuits
    7: 0.92      // -8% pour 7+ nuits
  },

  // Configuration des événements spéciaux
  EVENT_MULTIPLIERS: {
    MAJOR_EVENT: 1.5,       // +50% événement majeur
    CONFERENCE: 1.3,        // +30% conférence
    FESTIVAL: 1.4,          // +40% festival
    HOLIDAY: 1.35,          // +35% jour férié
    LOW_SEASON_EVENT: 1.2   // +20% événement basse saison
  },

  // Paramètres d'apprentissage
  LEARNING_PARAMETERS: {
    HISTORY_WEIGHT: 0.7,           // Poids de l'historique
    CURRENT_DEMAND_WEIGHT: 0.3,    // Poids de la demande actuelle
    COMPETITOR_WEIGHT: 0.2,        // Poids des prix concurrents
    MIN_LEARNING_DAYS: 30,         // Jours minimum pour apprentissage
    FORECAST_HORIZON: 90           // Horizon de prévision en jours
  }
};

/**
 * ================================
 * DÉTERMINATION SAISON (EXISTANT)
 * ================================
 */

const getSeason = (date, customSeasonalPeriods = null) => {
  if (!date || !(date instanceof Date)) {
    throw new Error('Date invalide pour détermination saison');
  }

  const periods = customSeasonalPeriods || DEFAULT_SEASONAL_PERIODS;
  const month = date.getMonth() + 1;
  const day = date.getDate();

  for (const period of periods) {
    if (isDateInPeriod(month, day, period)) {
      return period.season;
    }
  }

  return SEASONS.MEDIUM;
};

const isDateInPeriod = (month, day, period) => {
  const { startMonth, startDay, endMonth, endDay } = period;

  if (startMonth <= endMonth) {
    return (month > startMonth || (month === startMonth && day >= startDay)) &&
           (month < endMonth || (month === endMonth && day <= endDay));
  }
  
  return (month > startMonth || (month === startMonth && day >= startDay)) ||
         (month < endMonth || (month === endMonth && day <= endDay));
};

const getSeasonalMultiplier = (season, customMultipliers = null) => {
  const multipliers = customMultipliers || SEASONAL_MULTIPLIERS;
  return multipliers[season] || SEASONAL_MULTIPLIERS[SEASONS.MEDIUM];
};

/**
 * ================================
 * MULTIPLICATEURS TYPES & CATÉGORIES (EXISTANT)
 * ================================
 */

const getRoomTypeMultiplier = (roomType) => {
  if (!Object.values(ROOM_TYPES).includes(roomType)) {
    throw new Error(`Type de chambre invalide: ${roomType}`);
  }
  return ROOM_TYPE_MULTIPLIERS[roomType] || 1.0;
};

const getHotelCategoryMultiplier = (hotelCategory) => {
  if (!Object.values(HOTEL_CATEGORIES).includes(hotelCategory)) {
    throw new Error(`Catégorie hôtel invalide: ${hotelCategory}`);
  }
  return HOTEL_CATEGORY_MULTIPLIERS[hotelCategory] || 1.0;
};

/**
 * ================================
 * NOUVEAU: YIELD MANAGEMENT FUNCTIONS
 * ================================
 */

/**
 * Calcule le taux d'occupation pour une période donnée
 * @param {string} hotelId - ID de l'hôtel
 * @param {Date} startDate - Date de début
 * @param {Date} endDate - Date de fin
 * @returns {Promise<number>} Taux d'occupation en pourcentage
 */
const calculateOccupancyRate = async (hotelId, startDate, endDate) => {
  try {
    // Compter les chambres totales de l'hôtel
    const totalRooms = await Room.countDocuments({ 
      hotel: hotelId, 
      status: { $ne: 'OUT_OF_ORDER' } 
    });

    if (totalRooms === 0) return 0;

    // Calculer le nombre de nuits
    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    const totalRoomNights = totalRooms * nights;

    // Compter les réservations confirmées pour cette période
    const bookings = await Booking.find({
      hotel: hotelId,
      status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      $or: [
        { checkIn: { $gte: startDate, $lt: endDate } },
        { checkOut: { $gt: startDate, $lte: endDate } },
        { checkIn: { $lt: startDate }, checkOut: { $gt: endDate } }
      ]
    });

    // Calculer les nuits-chambres occupées
    let occupiedRoomNights = 0;
    for (const booking of bookings) {
      const bookingStart = booking.checkIn > startDate ? booking.checkIn : startDate;
      const bookingEnd = booking.checkOut < endDate ? booking.checkOut : endDate;
      const bookingNights = Math.ceil((bookingEnd - bookingStart) / (1000 * 60 * 60 * 24));
      occupiedRoomNights += bookingNights * booking.rooms.length;
    }

    return Math.round((occupiedRoomNights / totalRoomNights) * 100);
  } catch (error) {
    logger.error('Error calculating occupancy rate:', error);
    return 0;
  }
};

/**
 * Obtient le multiplicateur basé sur le taux d'occupation
 * @param {number} occupancyRate - Taux d'occupation en pourcentage
 * @returns {number} Multiplicateur de prix
 */
const getOccupancyMultiplier = (occupancyRate) => {
  for (const [key, threshold] of Object.entries(YIELD_MANAGEMENT_CONFIG.OCCUPANCY_THRESHOLDS)) {
    if (occupancyRate >= threshold.min && occupancyRate < threshold.max) {
      return threshold.multiplier;
    }
  }
  return 1.0;
};

/**
 * Calcule le multiplicateur selon l'anticipation de réservation
 * @param {Date} bookingDate - Date de réservation
 * @param {Date} checkInDate - Date d'arrivée
 * @returns {number} Multiplicateur de prix
 */
const getBookingWindowMultiplier = (bookingDate, checkInDate) => {
  const daysInAdvance = Math.ceil((checkInDate - bookingDate) / (1000 * 60 * 60 * 24));
  
  if (daysInAdvance <= YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.LAST_MINUTE.days) {
    return YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.LAST_MINUTE.multiplier;
  } else if (daysInAdvance <= YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.SHORT_TERM.days) {
    return YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.SHORT_TERM.multiplier;
  } else if (daysInAdvance <= YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.MEDIUM_TERM.days) {
    return YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.MEDIUM_TERM.multiplier;
  } else if (daysInAdvance <= YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.LONG_TERM.days) {
    return YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.LONG_TERM.multiplier;
  } else {
    return YIELD_MANAGEMENT_CONFIG.BOOKING_WINDOW_MULTIPLIERS.VERY_LONG_TERM.multiplier;
  }
};

/**
 * Obtient le multiplicateur selon le jour de la semaine
 * @param {Date} date - Date à vérifier
 * @returns {number} Multiplicateur de prix
 */
const getDayOfWeekMultiplier = (date) => {
  const dayNames = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  const dayName = dayNames[date.getDay()];
  return YIELD_MANAGEMENT_CONFIG.DAY_OF_WEEK_MULTIPLIERS[dayName] || 1.0;
};

/**
 * Obtient le multiplicateur selon la durée du séjour
 * @param {number} nights - Nombre de nuits
 * @returns {number} Multiplicateur de prix
 */
const getLengthOfStayMultiplier = (nights) => {
  if (nights >= 7) return YIELD_MANAGEMENT_CONFIG.LENGTH_OF_STAY_MULTIPLIERS[7];
  return YIELD_MANAGEMENT_CONFIG.LENGTH_OF_STAY_MULTIPLIERS[nights] || 1.0;
};

/**
 * Analyse la demande historique pour prédire la demande future
 * @param {string} hotelId - ID de l'hôtel
 * @param {Date} targetDate - Date cible pour la prédiction
 * @param {string} roomType - Type de chambre
 * @returns {Promise<Object>} Analyse de demande
 */
const analyzeDemandPattern = async (hotelId, targetDate, roomType) => {
  try {
    const dayOfWeek = targetDate.getDay();
    const season = getSeason(targetDate);
    
    // Analyser les 12 dernières semaines pour le même jour de la semaine
    const historicalData = [];
    for (let i = 1; i <= 12; i++) {
      const historicalDate = new Date(targetDate);
      historicalDate.setDate(historicalDate.getDate() - (i * 7));
      
      const occupancy = await calculateOccupancyRate(
        hotelId,
        historicalDate,
        new Date(historicalDate.getTime() + 24 * 60 * 60 * 1000)
      );
      
      historicalData.push({
        date: historicalDate,
        occupancy,
        weeksAgo: i
      });
    }

    // Calculer la moyenne pondérée (plus de poids sur les semaines récentes)
    let weightedSum = 0;
    let weightSum = 0;
    
    historicalData.forEach((data, index) => {
      const weight = 1 / (index + 1); // Plus récent = plus de poids
      weightedSum += data.occupancy * weight;
      weightSum += weight;
    });

    const predictedOccupancy = Math.round(weightedSum / weightSum);

    // Analyser la tendance
    const recentAvg = historicalData.slice(0, 4).reduce((sum, d) => sum + d.occupancy, 0) / 4;
    const olderAvg = historicalData.slice(8, 12).reduce((sum, d) => sum + d.occupancy, 0) / 4;
    const trend = recentAvg > olderAvg ? 'INCREASING' : recentAvg < olderAvg ? 'DECREASING' : 'STABLE';

    return {
      predictedOccupancy,
      trend,
      confidence: calculateConfidence(historicalData),
      historicalAverage: historicalData.reduce((sum, d) => sum + d.occupancy, 0) / historicalData.length,
      dayOfWeek,
      season
    };
  } catch (error) {
    logger.error('Error analyzing demand pattern:', error);
    return {
      predictedOccupancy: 70, // Valeur par défaut
      trend: 'STABLE',
      confidence: 0.5,
      historicalAverage: 70,
      dayOfWeek: targetDate.getDay(),
      season: getSeason(targetDate)
    };
  }
};

/**
 * Calcule le niveau de confiance de la prédiction
 * @param {Array} historicalData - Données historiques
 * @returns {number} Score de confiance entre 0 et 1
 */
const calculateConfidence = (historicalData) => {
  if (historicalData.length < 4) return 0.3;
  
  // Calculer la variance
  const avg = historicalData.reduce((sum, d) => sum + d.occupancy, 0) / historicalData.length;
  const variance = historicalData.reduce((sum, d) => sum + Math.pow(d.occupancy - avg, 2), 0) / historicalData.length;
  const stdDev = Math.sqrt(variance);
  
  // Plus la variance est faible, plus la confiance est élevée
  const confidence = Math.max(0.3, Math.min(0.9, 1 - (stdDev / 50)));
  return Math.round(confidence * 100) / 100;
};

/**
 * Détecte les événements spéciaux qui peuvent affecter les prix
 * @param {string} hotelId - ID de l'hôtel
 * @param {Date} date - Date à vérifier
 * @returns {Promise<Object>} Information sur l'événement
 */
const detectSpecialEvents = async (hotelId, date) => {
  try {
    // Vérifier dans la base de données des événements
    // Pour l'instant, simulation avec des événements codés en dur
    const events = {
      '2025-07-14': { type: 'HOLIDAY', name: 'Fête Nationale', multiplier: 1.35 },
      '2025-08-15': { type: 'HOLIDAY', name: 'Assomption', multiplier: 1.35 },
      '2025-12-25': { type: 'HOLIDAY', name: 'Noël', multiplier: 1.5 },
      '2025-12-31': { type: 'MAJOR_EVENT', name: 'Réveillon', multiplier: 1.8 }
    };

    const dateStr = date.toISOString().split('T')[0];
    if (events[dateStr]) {
      return events[dateStr];
    }

    // Vérifier si c'est un weekend prolongé
    const dayOfWeek = date.getDay();
    const tomorrow = new Date(date);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dayAfter = new Date(tomorrow);
    dayAfter.setDate(dayAfter.getDate() + 1);

    if (dayOfWeek === 5 || dayOfWeek === 6) { // Vendredi ou Samedi
      // Vérifier si lundi est férié
      if (dayAfter.getDay() === 1 && events[dayAfter.toISOString().split('T')[0]]) {
        return {
          type: 'HOLIDAY',
          name: 'Weekend prolongé',
          multiplier: 1.4
        };
      }
    }

    return null;
  } catch (error) {
    logger.error('Error detecting special events:', error);
    return null;
  }
};

/**
 * ================================
 * CALCUL PRIX PRINCIPAL AVEC YIELD MANAGEMENT
 * ================================
 */

/**
 * Calcule le prix total d'une réservation avec yield management
 * @param {Object} params - Paramètres de calcul
 * @returns {Promise<Object>} Détail du calcul de prix
 */
const calculateBookingPrice = async ({
  basePrice,
  roomType,
  hotelCategory,
  hotelId,
  checkInDate,
  checkOutDate,
  numberOfRooms = 1,
  customSeasonalPeriods = null,
  customMultipliers = null,
  enableYieldManagement = true
}) => {
  // ================================
  // VALIDATIONS (EXISTANT)
  // ================================
  if (!basePrice || basePrice < BUSINESS_RULES.MIN_ROOM_PRICE) {
    throw new Error(`Prix de base invalide. Minimum: ${BUSINESS_RULES.MIN_ROOM_PRICE} MAD`);
  }

  if (basePrice > BUSINESS_RULES.MAX_ROOM_PRICE) {
    throw new Error(`Prix de base trop élevé. Maximum: ${BUSINESS_RULES.MAX_ROOM_PRICE} MAD`);
  }

  if (!checkInDate || !checkOutDate || !(checkInDate instanceof Date) || !(checkOutDate instanceof Date)) {
    throw new Error(ERROR_MESSAGES.INVALID_DATE);
  }

  if (checkInDate >= checkOutDate) {
    throw new Error(ERROR_MESSAGES.INVALID_DATE_RANGE);
  }

  if (numberOfRooms < 1 || numberOfRooms > BUSINESS_RULES.MAX_ROOMS_PER_BOOKING) {
    throw new Error(`Nombre de chambres invalide (1-${BUSINESS_RULES.MAX_ROOMS_PER_BOOKING})`);
  }

  // ================================
  // CALCULS DE BASE (EXISTANT)
  // ================================
  
  const nightsCount = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
  
  if (nightsCount < BUSINESS_RULES.MIN_BOOKING_NIGHTS || nightsCount > BUSINESS_RULES.MAX_BOOKING_NIGHTS) {
    throw new Error(`Durée séjour invalide (${BUSINESS_RULES.MIN_BOOKING_NIGHTS}-${BUSINESS_RULES.MAX_BOOKING_NIGHTS} nuits)`);
  }

  // Obtenir les multiplicateurs de base
  const roomTypeMultiplier = getRoomTypeMultiplier(roomType);
  const hotelCategoryMultiplier = getHotelCategoryMultiplier(hotelCategory);

  // Calcul prix par période saisonnière
  const dailyPrices = [];
  let totalBeforeRooms = 0;

  // Parcourir chaque nuit
  for (let i = 0; i < nightsCount; i++) {
    const currentDate = new Date(checkInDate);
    currentDate.setDate(currentDate.getDate() + i);
    
    const season = getSeason(currentDate, customSeasonalPeriods);
    const seasonalMultiplier = getSeasonalMultiplier(season, customMultipliers);
    
    // Prix de base pour cette nuit
    let nightPrice = basePrice * roomTypeMultiplier * hotelCategoryMultiplier * seasonalMultiplier;
    
    // ================================
    // NOUVEAU: YIELD MANAGEMENT
    // ================================
    
    let yieldMultiplier = 1.0;
    let yieldDetails = {};
    
    if (enableYieldManagement && hotelId) {
      // 1. Multiplicateur occupation
      const occupancyRate = await calculateOccupancyRate(
        hotelId,
        currentDate,
        new Date(currentDate.getTime() + 24 * 60 * 60 * 1000)
      );
      const occupancyMultiplier = getOccupancyMultiplier(occupancyRate);
      yieldMultiplier *= occupancyMultiplier;
      yieldDetails.occupancyRate = occupancyRate;
      yieldDetails.occupancyMultiplier = occupancyMultiplier;
      
      // 2. Multiplicateur anticipation
      const bookingWindowMultiplier = getBookingWindowMultiplier(new Date(), currentDate);
      yieldMultiplier *= bookingWindowMultiplier;
      yieldDetails.bookingWindowMultiplier = bookingWindowMultiplier;
      
      // 3. Multiplicateur jour de la semaine
      const dayOfWeekMultiplier = getDayOfWeekMultiplier(currentDate);
      yieldMultiplier *= dayOfWeekMultiplier;
      yieldDetails.dayOfWeekMultiplier = dayOfWeekMultiplier;
      
      // 4. Multiplicateur durée du séjour (appliqué une seule fois)
      if (i === 0) {
        const lengthOfStayMultiplier = getLengthOfStayMultiplier(nightsCount);
        yieldMultiplier *= lengthOfStayMultiplier;
        yieldDetails.lengthOfStayMultiplier = lengthOfStayMultiplier;
      }
      
      // 5. Vérifier les événements spéciaux
      const specialEvent = await detectSpecialEvents(hotelId, currentDate);
      if (specialEvent) {
        yieldMultiplier *= specialEvent.multiplier;
        yieldDetails.specialEvent = specialEvent;
      }
      
      // 6. Analyse prédictive de la demande
      const demandAnalysis = await analyzeDemandPattern(hotelId, currentDate, roomType);
      if (demandAnalysis.predictedOccupancy > 80 && demandAnalysis.confidence > 0.7) {
        yieldMultiplier *= 1.1; // +10% si forte demande prévue
        yieldDetails.demandPrediction = demandAnalysis;
      }
    }
    
    // Appliquer le yield management
    nightPrice *= yieldMultiplier;
    
    dailyPrices.push({
      date: new Date(currentDate),
      season,
      seasonalMultiplier,
      nightPrice: Math.round(nightPrice * 100) / 100,
      yieldMultiplier: Math.round(yieldMultiplier * 100) / 100,
      yieldDetails
    });
    
    totalBeforeRooms += nightPrice;
  }

  // Prix total = (prix par nuit × nombre nuits) × nombre chambres
  const totalPrice = totalBeforeRooms * numberOfRooms;

  // ================================
  // RETOUR DÉTAILLÉ
  // ================================
  return {
    // Résultat final
    totalPrice: Math.round(totalPrice * 100) / 100,
    pricePerRoom: Math.round(totalBeforeRooms * 100) / 100,
    averagePricePerNight: Math.round((totalBeforeRooms / nightsCount) * 100) / 100,
    
    // Détails calcul
    breakdown: {
      basePrice,
      roomType,
      roomTypeMultiplier,
      hotelCategory,
      hotelCategoryMultiplier,
      numberOfRooms,
      nightsCount,
      dailyPrices
    },
    
    // Yield management summary
    yieldManagement: {
      enabled: enableYieldManagement,
      averageYieldMultiplier: calculateAverageYieldMultiplier(dailyPrices),
      priceVariation: calculatePriceVariation(dailyPrices),
      recommendedAction: getRecommendedAction(dailyPrices)
    },
    
    // Métadonnées
    currency: 'MAD',
    calculatedAt: new Date(),
    
    // Résumé saisons
    seasonsSummary: getSeasonsSummary(dailyPrices)
  };
};

/**
 * ================================
 * NOUVEAU: YIELD MANAGEMENT ANALYTICS
 * ================================
 */

/**
 * Calcule le multiplicateur yield moyen
 * @param {Array} dailyPrices - Prix journaliers
 * @returns {number} Multiplicateur moyen
 */
const calculateAverageYieldMultiplier = (dailyPrices) => {
  const validPrices = dailyPrices.filter(p => p.yieldMultiplier);
  if (validPrices.length === 0) return 1.0;
  
  const sum = validPrices.reduce((acc, p) => acc + p.yieldMultiplier, 0);
  return Math.round((sum / validPrices.length) * 100) / 100;
};

/**
 * Calcule la variation de prix
 * @param {Array} dailyPrices - Prix journaliers
 * @returns {Object} Statistiques de variation
 */
const calculatePriceVariation = (dailyPrices) => {
  if (dailyPrices.length === 0) return { min: 0, max: 0, variance: 0 };
  
  const prices = dailyPrices.map(p => p.nightPrice);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const avg = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const variance = prices.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / prices.length;
  
  return {
    min: Math.round(min * 100) / 100,
    max: Math.round(max * 100) / 100,
    average: Math.round(avg * 100) / 100,
    variance: Math.round(variance * 100) / 100,
    standardDeviation: Math.round(Math.sqrt(variance) * 100) / 100
  };
};

/**
 * Obtient une recommandation d'action basée sur l'analyse
 * @param {Array} dailyPrices - Prix journaliers
 * @returns {Object} Recommandation
 */
const getRecommendedAction = (dailyPrices) => {
  if (dailyPrices.length === 0) return { action: 'NONE', reason: 'Pas de données' };
  
  const avgYield = calculateAverageYieldMultiplier(dailyPrices);
  const variation = calculatePriceVariation(dailyPrices);
  
  if (avgYield > 1.3) {
    return {
      action: 'CONSIDER_PRICE_INCREASE',
      reason: 'Forte demande détectée',
      confidence: 'HIGH'
    };
  } else if (avgYield < 0.9) {
    return {
      action: 'CONSIDER_PROMOTION',
      reason: 'Faible demande prévue',
      confidence: 'MEDIUM'
    };
  } else if (variation.standardDeviation > 50) {
    return {
      action: 'STABILIZE_PRICING',
      reason: 'Forte variation de prix détectée',
      confidence: 'MEDIUM'
    };
  }
  
  return {
    action: 'MAINTAIN_CURRENT',
    reason: 'Prix optimal selon les conditions actuelles',
    confidence: 'HIGH'
  };
};

/**
 * ================================
 * NOUVEAU: PRICING RULES ENGINE
 * ================================
 */

/**
 * Applique les règles de pricing personnalisées
 * @param {string} hotelId - ID de l'hôtel
 * @param {Object} context - Contexte de la réservation
 * @returns {Promise<Object>} Règles appliquées et multiplicateur final
 */
const applyPricingRules = async (hotelId, context) => {
  try {
    const { roomType, checkInDate, checkOutDate, occupancy, customerSegment } = context;
    
    // Récupérer les règles actives pour cet hôtel
    const activeRules = await PricingRule.findActiveRulesForHotel(hotelId, checkInDate);
    
    let finalMultiplier = 1.0;
    const appliedRules = [];
    
    for (const rule of activeRules) {
      // Vérifier si la règle s'applique
      if (rule.appliesTo(context)) {
        const adjustment = rule.calculateAdjustment(context.basePrice, context);
        finalMultiplier *= adjustment.multiplier || 1.0;
        
        appliedRules.push({
          ruleName: rule.name,
          ruleType: rule.ruleType,
          multiplier: adjustment.multiplier,
          impact: adjustment.adjustedPrice - context.basePrice
        });
        
        // Mettre à jour les métriques de performance
        await rule.updatePerformance(adjustment.adjustedPrice - context.basePrice);
      }
    }
    
    return {
      finalMultiplier: Math.round(finalMultiplier * 100) / 100,
      appliedRules,
      rulesCount: appliedRules.length
    };
  } catch (error) {
    logger.error('Error applying pricing rules:', error);
    return {
      finalMultiplier: 1.0,
      appliedRules: [],
      rulesCount: 0
    };
  }
};

/**
 * ================================
 * NOUVEAU: REAL-TIME PRICE OPTIMIZATION
 * ================================
 */

/**
 * Optimise les prix en temps réel basé sur les conditions actuelles
 * @param {string} hotelId - ID de l'hôtel
 * @param {string} roomType - Type de chambre
 * @param {Date} targetDate - Date cible
 * @returns {Promise<Object>} Prix optimisé
 */
const optimizePriceRealTime = async (hotelId, roomType, targetDate) => {
  try {
    // Obtenir les données en temps réel
    const [currentOccupancy, demandPattern, competitorPrices] = await Promise.all([
      calculateOccupancyRate(hotelId, targetDate, new Date(targetDate.getTime() + 24 * 60 * 60 * 1000)),
      analyzeDemandPattern(hotelId, targetDate, roomType),
      getCompetitorPrices(hotelId, roomType, targetDate)
    ]);
    
    // Calculer le prix optimal
    const room = await Room.findOne({ hotel: hotelId, type: roomType });
    if (!room) throw new Error('Room type not found');
    
    let optimalPrice = room.basePrice;
    
    // Ajuster selon l'occupation
    const occupancyMultiplier = getOccupancyMultiplier(currentOccupancy);
    optimalPrice *= occupancyMultiplier;
    
    // Ajuster selon la demande prédite
    if (demandPattern.predictedOccupancy > 85) {
      optimalPrice *= 1.15; // +15% si forte demande prévue
    } else if (demandPattern.predictedOccupancy < 40) {
      optimalPrice *= 0.9; // -10% si faible demande prévue
    }
    
    // Ajuster selon la concurrence
    if (competitorPrices.averagePrice > 0) {
      const competitivePosition = optimalPrice / competitorPrices.averagePrice;
      if (competitivePosition > 1.2) {
        optimalPrice *= 0.95; // Réduire si trop cher
      } else if (competitivePosition < 0.8) {
        optimalPrice *= 1.05; // Augmenter si trop bas
      }
    }
    
    // Limites de prix
    optimalPrice = Math.max(room.basePrice * 0.7, optimalPrice);
    optimalPrice = Math.min(room.basePrice * 2.0, optimalPrice);
    
    return {
      optimalPrice: Math.round(optimalPrice * 100) / 100,
      basePrice: room.basePrice,
      adjustmentFactors: {
        occupancy: currentOccupancy,
        occupancyMultiplier,
        predictedDemand: demandPattern.predictedOccupancy,
        competitorAverage: competitorPrices.averagePrice
      },
      confidence: calculateOptimizationConfidence(demandPattern, competitorPrices),
      validUntil: new Date(Date.now() + 60 * 60 * 1000) // Valide 1 heure
    };
  } catch (error) {
    logger.error('Error optimizing price in real-time:', error);
    throw error;
  }
};

/**
 * Obtient les prix des concurrents (simulation)
 * @param {string} hotelId - ID de l'hôtel
 * @param {string} roomType - Type de chambre
 * @param {Date} date - Date
 * @returns {Promise<Object>} Prix concurrents
 */
const getCompetitorPrices = async (hotelId, roomType, date) => {
  try {
    // TODO: Intégrer avec API de scraping ou partenaires
    // Pour l'instant, simulation
    return {
      averagePrice: 450,
      minPrice: 350,
      maxPrice: 600,
      competitorsCount: 5,
      lastUpdated: new Date()
    };
  } catch (error) {
    logger.error('Error getting competitor prices:', error);
    return {
      averagePrice: 0,
      minPrice: 0,
      maxPrice: 0,
      competitorsCount: 0,
      lastUpdated: new Date()
    };
  }
};

/**
 * Calcule la confiance dans l'optimisation
 * @param {Object} demandPattern - Pattern de demande
 * @param {Object} competitorPrices - Prix concurrents
 * @returns {number} Score de confiance
 */
const calculateOptimizationConfidence = (demandPattern, competitorPrices) => {
  let confidence = 0.5;
  
  // Augmenter la confiance si données de demande fiables
  if (demandPattern.confidence > 0.7) {
    confidence += 0.2;
  }
  
  // Augmenter la confiance si données concurrents disponibles
  if (competitorPrices.competitorsCount > 3) {
    confidence += 0.2;
  }
  
  // Augmenter la confiance si tendance stable
  if (demandPattern.trend === 'STABLE') {
    confidence += 0.1;
  }
  
  return Math.min(1.0, confidence);
};

/**
 * ================================
 * NOUVEAU: BROADCAST & NOTIFICATIONS
 * ================================
 */

/**
 * Broadcast les changements de prix en temps réel
 * @param {string} hotelId - ID de l'hôtel
 * @param {Object} priceUpdate - Mise à jour de prix
 */
const broadcastPriceUpdate = async (hotelId, priceUpdate) => {
  try {
    // Broadcast via WebSocket
    socketService.sendHotelNotification(hotelId, 'price-update', {
      ...priceUpdate,
      timestamp: new Date()
    });
    
    // Log pour monitoring
    logger.info(`Price update broadcasted for hotel ${hotelId}`, priceUpdate);
  } catch (error) {
    logger.error('Error broadcasting price update:', error);
  }
};

/**
 * ================================
 * NOUVEAU: REVENUE OPTIMIZATION
 * ================================
 */

/**
 * Calcule le RevPAR (Revenue Per Available Room)
 * @param {string} hotelId - ID de l'hôtel
 * @param {Date} startDate - Date début
 * @param {Date} endDate - Date fin
 * @returns {Promise<Object>} Métriques RevPAR
 */
const calculateRevPAR = async (hotelId, startDate, endDate) => {
  try {
    const totalRooms = await Room.countDocuments({ hotel: hotelId });
    const nights = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 1000));
    const totalRoomNights = totalRooms * nights;
    
    const revenue = await Booking.aggregate([
      {
        $match: {
          hotel: mongoose.Types.ObjectId(hotelId),
          status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
          checkIn: { $gte: startDate, $lt: endDate }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$pricing.totalPrice' }
        }
      }
    ]);
    
    const totalRevenue = revenue[0]?.totalRevenue || 0;
    const revPAR = totalRevenue / totalRoomNights;
    
    return {
      revPAR: Math.round(revPAR * 100) / 100,
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalRoomNights,
      period: { startDate, endDate, nights }
    };
  } catch (error) {
    logger.error('Error calculating RevPAR:', error);
    throw error;
  }
};

/**
 * Suggère des ajustements de prix pour optimiser les revenus
 * @param {string} hotelId - ID de l'hôtel
 * @param {string} roomType - Type de chambre
 * @param {Date} period - Période à analyser
 * @returns {Promise<Object>} Suggestions d'optimisation
 */
const suggestRevenueOptimization = async (hotelId, roomType, period) => {
  try {
    const currentPricing = await Room.findOne({ hotel: hotelId, type: roomType });
    const occupancyRate = await calculateOccupancyRate(hotelId, period.start, period.end);
    const revPAR = await calculateRevPAR(hotelId, period.start, period.end);
    
    const suggestions = [];
    
    // Suggérer selon l'occupation
    if (occupancyRate > 90) {
      suggestions.push({
        action: 'INCREASE_PRICE',
        percentage: 15,
        reason: 'Taux d\'occupation très élevé',
        estimatedRevPARIncrease: revPAR.revPAR * 0.12
      });
    } else if (occupancyRate < 50) {
      suggestions.push({
        action: 'DECREASE_PRICE',
        percentage: 10,
        reason: 'Taux d\'occupation faible',
        estimatedRevPARIncrease: revPAR.revPAR * 0.08
      });
    }
    
    // Suggérer selon le jour de la semaine
    const dayAnalysis = await analyzeDayOfWeekPerformance(hotelId, roomType);
    if (dayAnalysis.weakDays.length > 0) {
      suggestions.push({
        action: 'WEEKDAY_PROMOTION',
        days: dayAnalysis.weakDays,
        percentage: 20,
        reason: 'Performance faible certains jours',
        estimatedRevPARIncrease: revPAR.revPAR * 0.05
      });
    }
    
    return {
      currentMetrics: {
        occupancyRate,
        revPAR: revPAR.revPAR,
        currentPrice: currentPricing.basePrice
      },
      suggestions,
      estimatedTotalRevPARIncrease: suggestions.reduce((sum, s) => sum + (s.estimatedRevPARIncrease || 0), 0)
    };
  } catch (error) {
    logger.error('Error suggesting revenue optimization:', error);
    throw error;
  }
};

/**
 * Analyse la performance par jour de la semaine
 * @param {string} hotelId - ID de l'hôtel
 * @param {string} roomType - Type de chambre
 * @returns {Promise<Object>} Analyse par jour
 */
const analyzeDayOfWeekPerformance = async (hotelId, roomType) => {
  try {
    // Analyser les 30 derniers jours
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const bookings = await Booking.find({
      hotel: hotelId,
      'rooms.room.type': roomType,
      checkIn: { $gte: startDate, $lte: endDate }
    });
    
    // Calculer les performances par jour
    const dayPerformance = {};
    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    for (let i = 0; i < 7; i++) {
      dayPerformance[dayNames[i]] = {
        bookings: 0,
        revenue: 0,
        avgPrice: 0
      };
    }
    
    bookings.forEach(booking => {
      const dayName = dayNames[booking.checkIn.getDay()];
      dayPerformance[dayName].bookings++;
      dayPerformance[dayName].revenue += booking.pricing.totalPrice;
    });
    
    // Calculer les moyennes et identifier les jours faibles
    const avgBookingsPerDay = bookings.length / 30 * 7;
    const weakDays = [];
    
    Object.entries(dayPerformance).forEach(([day, perf]) => {
      perf.avgPrice = perf.bookings > 0 ? perf.revenue / perf.bookings : 0;
      if (perf.bookings < avgBookingsPerDay * 0.7) {
        weakDays.push(day);
      }
    });
    
    return {
      dayPerformance,
      weakDays,
      strongDays: Object.entries(dayPerformance)
        .filter(([day, perf]) => perf.bookings > avgBookingsPerDay * 1.3)
        .map(([day]) => day)
    };
  } catch (error) {
    logger.error('Error analyzing day of week performance:', error);
    return {
      dayPerformance: {},
      weakDays: [],
      strongDays: []
    };
  }
};

/**
 * ================================
 * CALCULS SIMPLIFIÉS (EXISTANT + AMÉLIORÉ)
 * ================================
 */

/**
 * Calcul rapide prix moyen par nuit avec yield management
 */
const calculateAverageNightPrice = async ({
  basePrice,
  roomType,
  hotelCategory,
  hotelId,
  checkInDate,
  checkOutDate,
  customSeasonalPeriods = null,
  customMultipliers = null,
  enableYieldManagement = true
}) => {
  try {
    const fullCalculation = await calculateBookingPrice({
      basePrice,
      roomType,  
      hotelCategory,
      hotelId,
      checkInDate,
      checkOutDate,
      numberOfRooms: 1,
      customSeasonalPeriods,
      customMultipliers,
      enableYieldManagement
    });
    
    return {
      averageNightPrice: fullCalculation.averagePricePerNight,
      totalForPeriod: fullCalculation.pricePerRoom,
      nightsCount: fullCalculation.breakdown.nightsCount,
      dominantSeason: fullCalculation.seasonsSummary[0]?.season || SEASONS.MEDIUM,
      yieldImpact: fullCalculation.yieldManagement.averageYieldMultiplier,
      priceRange: {
        min: Math.min(...fullCalculation.breakdown.dailyPrices.map(p => p.nightPrice)),
        max: Math.max(...fullCalculation.breakdown.dailyPrices.map(p => p.nightPrice))
      }
    };
  } catch (error) {
    throw new Error(`Erreur calcul prix moyen: ${error.message}`);
  }
};

/**
 * Calcule uniquement le prix de base ajusté
 */
const calculateBasePriceWithMultipliers = (basePrice, roomType, hotelCategory, season = SEASONS.MEDIUM) => {
  if (!basePrice || basePrice <= 0) {
    throw new Error('Prix de base requis et positif');
  }

  const roomTypeMultiplier = getRoomTypeMultiplier(roomType);
  const hotelCategoryMultiplier = getHotelCategoryMultiplier(hotelCategory);
  const seasonalMultiplier = getSeasonalMultiplier(season);
  
  const adjustedPrice = basePrice * roomTypeMultiplier * hotelCategoryMultiplier * seasonalMultiplier;
  
  return {
    adjustedPrice: Math.round(adjustedPrice * 100) / 100,
    multipliers: {
      roomType: roomTypeMultiplier,
      hotelCategory: hotelCategoryMultiplier,
      seasonal: seasonalMultiplier,
      total: roomTypeMultiplier * hotelCategoryMultiplier * seasonalMultiplier
    }
  };
};

/**
 * ================================
 * UTILITAIRES PRICING (EXISTANT)
 * ================================
 */

const validatePrice = (price) => {
  if (typeof price !== 'number' || price <= 0) {
    return { valid: false, error: 'Prix doit être un nombre positif' };
  }
  
  if (price < BUSINESS_RULES.MIN_ROOM_PRICE) {
    return { valid: false, error: `Prix minimum: ${BUSINESS_RULES.MIN_ROOM_PRICE} MAD` };
  }
  
  if (price > BUSINESS_RULES.MAX_ROOM_PRICE) {
    return { valid: false, error: `Prix maximum: ${BUSINESS_RULES.MAX_ROOM_PRICE} MAD` };
  }
  
  return { valid: true };
};

const convertCurrency = (amount, fromCurrency = 'MAD', toCurrency = 'EUR') => {
  const mockRates = {
    'MAD_EUR': 0.092,
    'MAD_USD': 0.099,
    'EUR_MAD': 10.87,
    'USD_MAD': 10.12
  };
  
  const rateKey = `${fromCurrency}_${toCurrency}`;
  const rate = mockRates[rateKey];
  
  if (!rate) {
    throw new Error(`Conversion ${fromCurrency} vers ${toCurrency} non supportée`);
  }
  
  return {
    originalAmount: amount,
    convertedAmount: Math.round(amount * rate * 100) / 100,
    fromCurrency,
    toCurrency,
    exchangeRate: rate,
    convertedAt: new Date()
  };
};

const getSeasonsSummary = (dailyPrices) => {
  const seasonsCount = {};
  
  dailyPrices.forEach(day => {
    seasonsCount[day.season] = (seasonsCount[day.season] || 0) + 1;
  });
  
  return Object.entries(seasonsCount).map(([season, nights]) => ({
    season,
    nights,
    percentage: Math.round((nights / dailyPrices.length) * 100)
  }));
};

/**
 * ================================
 * NOUVEAU: MACHINE LEARNING HELPERS
 * ================================
 */

/**
 * Prépare les données pour l'entraînement ML
 * @param {string} hotelId - ID de l'hôtel
 * @param {number} days - Nombre de jours d'historique
 * @returns {Promise<Array>} Dataset pour ML
 */
const prepareMLDataset = async (hotelId, days = 90) => {
  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);
    
    const bookings = await Booking.find({
      hotel: hotelId,
      createdAt: { $gte: startDate, $lte: endDate }
    });
    
    const dataset = [];
    
    for (const booking of bookings) {
      const dayOfWeek = booking.checkIn.getDay();
      const season = getSeason(booking.checkIn);
      const daysInAdvance = Math.ceil((booking.checkIn - booking.createdAt) / (1000 * 60 * 60 * 1000));
      const occupancyRate = await calculateOccupancyRate(hotelId, booking.checkIn, booking.checkOut);
      
      dataset.push({
        features: {
          dayOfWeek,
          season: Object.values(SEASONS).indexOf(season),
          daysInAdvance,
          occupancyRate,
          numberOfRooms: booking.rooms.length,
          lengthOfStay: booking.numberOfNights,
          roomType: booking.rooms[0].room.type,
          hotelCategory: booking.hotel.category
        },
        target: booking.pricing.totalPrice / booking.numberOfNights / booking.rooms.length
      });
    }
    
    return dataset;
  } catch (error) {
    logger.error('Error preparing ML dataset:', error);
    return [];
  }
};

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // Fonctions principales
  calculateBookingPrice,
  calculateAverageNightPrice,
  calculateBasePriceWithMultipliers,
  
  // Utilitaires saisons
  getSeason,
  getSeasonalMultiplier,
  
  // Utilitaires multiplicateurs
  getRoomTypeMultiplier,
  getHotelCategoryMultiplier,
  
  // Validation & conversion
  validatePrice,
  convertCurrency,
  
  // Helpers internes
  isDateInPeriod,
  getSeasonsSummary,
  
  // NOUVEAU: Yield Management
  calculateOccupancyRate,
  getOccupancyMultiplier,
  getBookingWindowMultiplier,
  getDayOfWeekMultiplier,
  getLengthOfStayMultiplier,
  analyzeDemandPattern,
  detectSpecialEvents,
  
  // NOUVEAU: Pricing Rules
  applyPricingRules,
  
  // NOUVEAU: Real-time Optimization
  optimizePriceRealTime,
  broadcastPriceUpdate,
  
  // NOUVEAU: Revenue Management
  calculateRevPAR,
  suggestRevenueOptimization,
  analyzeDayOfWeekPerformance,
  
  // NOUVEAU: ML Helpers
  prepareMLDataset,
  
  // Configuration exportée
  YIELD_MANAGEMENT_CONFIG
};