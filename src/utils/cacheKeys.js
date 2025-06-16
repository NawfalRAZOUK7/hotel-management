/**
 * CACHE KEYS UTILITIES - CENTRALIZED KEY MANAGEMENT
 * Système centralisé pour la gestion des clés de cache, TTL et patterns
 * 
 * Fonctionnalités :
 * - Key generation patterns standardisés
 * - TTL constants configurables
 * - Cache prefixes organisés
 * - Invalidation patterns intelligents
 * - Key validation et sanitization
 * - Batch key operations
 * - Cache namespace management
 */

const crypto = require('crypto');
const moment = require('moment');

/**
 * ================================
 * TTL CONSTANTS (en secondes)
 * ================================
 */
const TTL = {
  // Core Business Data
  AVAILABILITY: {
    REALTIME: 2 * 60,           // 2 minutes - données temps réel
    SHORT: 5 * 60,              // 5 minutes - disponibilité standard
    MEDIUM: 15 * 60,            // 15 minutes - données agrégées
    LONG: 30 * 60               // 30 minutes - rapports disponibilité
  },
  
  YIELD_PRICING: {
    REALTIME: 5 * 60,           // 5 minutes - prix dynamiques
    CALCULATION: 30 * 60,       // 30 minutes - calculs yield
    STRATEGY: 2 * 60 * 60,      // 2 heures - stratégies pricing
    HISTORICAL: 6 * 60 * 60     // 6 heures - données historiques
  },
  
  ANALYTICS: {
    REALTIME: 1 * 60,           // 1 minute - métriques temps réel
    DASHBOARD: 5 * 60,          // 5 minutes - dashboard data
    REPORTS: 30 * 60,           // 30 minutes - rapports
    STATISTICS: 60 * 60,        // 1 heure - statistiques
    HISTORICAL: 24 * 60 * 60    // 24 heures - données historiques
  },
  
  HOTEL_DATA: {
    BASIC: 30 * 60,             // 30 minutes - infos de base
    FULL: 2 * 60 * 60,          // 2 heures - données complètes
    CONFIGURATION: 6 * 60 * 60, // 6 heures - configuration hôtel
    STATIC: 24 * 60 * 60        // 24 heures - données statiques
  },
  
  BOOKING_DATA: {
    ACTIVE: 5 * 60,             // 5 minutes - réservations actives
    PENDING: 2 * 60,            // 2 minutes - en attente validation
    WORKFLOW: 10 * 60,          // 10 minutes - workflow data
    HISTORY: 60 * 60            // 1 heure - historique
  },
  
  USER_DATA: {
    SESSION: 30 * 60,           // 30 minutes - données session
    PROFILE: 2 * 60 * 60,       // 2 heures - profil utilisateur
    PREFERENCES: 24 * 60 * 60,  // 24 heures - préférences
    PERMISSIONS: 12 * 60 * 60   // 12 heures - permissions
  },
  
  REAL_TIME: {
    NOTIFICATIONS: 30,          // 30 secondes - notifications
    STATUS_UPDATES: 60,         // 1 minute - mises à jour statut
    LIVE_METRICS: 2 * 60,       // 2 minutes - métriques live
    SOCKET_DATA: 5 * 60         // 5 minutes - données WebSocket
  },
  
  SEARCH_RESULTS: {
    QUICK: 5 * 60,              // 5 minutes - recherches rapides
    COMPLEX: 15 * 60,           // 15 minutes - recherches complexes
    POPULAR: 30 * 60,           // 30 minutes - recherches populaires
    GEOGRAPHIC: 60 * 60         // 1 heure - recherches géographiques
  }
};

/**
 * ================================
 * CACHE PREFIXES
 * ================================
 */
const PREFIXES = {
  // Core Business
  AVAILABILITY: 'avail',
  YIELD: 'yield',
  PRICING: 'price',
  ANALYTICS: 'analytics',
  
  // Entities
  HOTEL: 'hotel',
  BOOKING: 'booking',
  ROOM: 'room',
  USER: 'user',
  
  // Features
  SEARCH: 'search',
  NOTIFICATIONS: 'notif',
  REALTIME: 'rt',
  QR_CODES: 'qr',
  
  // Operations
  LOCKS: 'lock',
  SESSIONS: 'session',
  COUNTERS: 'counter',
  FLAGS: 'flag',
  
  // Indexes & References
  INDEX: 'idx',
  REFERENCE: 'ref',
  MAPPING: 'map',
  
  // Monitoring & Stats
  STATS: 'stats',
  METRICS: 'metrics',
  HEALTH: 'health',
  
  // Temporary & Cleanup
  TEMP: 'temp',
  CLEANUP: 'cleanup'
};

/**
 * ================================
 * KEY GENERATION PATTERNS
 * ================================
 */
class CacheKeyGenerator {
  constructor(environment = process.env.NODE_ENV || 'development') {
    this.environment = environment;
    this.appPrefix = process.env.REDIS_KEY_PREFIX || 'hotel';
    this.separator = ':';
    this.maxKeyLength = 250; // Redis key length limit
  }

  /**
   * ================================
   * AVAILABILITY KEYS
   * ================================
   */

  /**
   * Génère une clé pour les données de disponibilité
   * @param {string} hotelId - ID de l'hôtel
   * @param {Date|string} checkIn - Date d'arrivée
   * @param {Date|string} checkOut - Date de départ
   * @param {string} roomType - Type de chambre (optionnel)
   * @param {Object} options - Options additionnelles
   */
  availabilityKey(hotelId, checkIn, checkOut, roomType = null, options = {}) {
    const checkInStr = this.formatDate(checkIn);
    const checkOutStr = this.formatDate(checkOut);
    
    let key = this.buildKey([
      PREFIXES.AVAILABILITY,
      this.sanitizeId(hotelId),
      checkInStr,
      checkOutStr
    ]);
    
    if (roomType) {
      key += `${this.separator}${roomType}`;
    }
    
    if (options.currency) {
      key += `${this.separator}${options.currency}`;
    }
    
    if (options.guestCount) {
      key += `${this.separator}g${options.guestCount}`;
    }
    
    return this.validateKey(key);
  }

  /**
   * Pattern pour invalidation disponibilité
   */
  availabilityPattern(hotelId, date = null) {
    if (date) {
      const dateStr = this.formatDate(date);
      return this.buildKey([PREFIXES.AVAILABILITY, this.sanitizeId(hotelId), dateStr, '*']);
    }
    return this.buildKey([PREFIXES.AVAILABILITY, this.sanitizeId(hotelId), '*']);
  }

  /**
   * Index de disponibilité pour un hôtel
   */
  availabilityIndex(hotelId) {
    return this.buildKey([PREFIXES.INDEX, PREFIXES.AVAILABILITY, this.sanitizeId(hotelId)]);
  }

  /**
   * ================================
   * YIELD PRICING KEYS
   * ================================
   */

  /**
   * Génère une clé pour le yield pricing
   */
  yieldPricingKey(hotelId, roomType, date, strategy = null) {
    const dateStr = this.formatDate(date);
    
    let key = this.buildKey([
      PREFIXES.YIELD,
      this.sanitizeId(hotelId),
      roomType,
      dateStr
    ]);
    
    if (strategy) {
      key += `${this.separator}${strategy.toLowerCase()}`;
    }
    
    return this.validateKey(key);
  }

  /**
   * Pattern pour invalidation yield pricing
   */
  yieldPricingPattern(hotelId, roomType = null, date = null) {
    const parts = [PREFIXES.YIELD, this.sanitizeId(hotelId)];
    
    if (roomType) {
      parts.push(roomType);
      if (date) {
        parts.push(this.formatDate(date));
      } else {
        parts.push('*');
      }
    } else {
      parts.push('*');
    }
    
    return this.buildKey(parts);
  }

  /**
   * Clé pour stratégie yield
   */
  yieldStrategyKey(hotelId, strategy) {
    return this.buildKey([
      PREFIXES.YIELD,
      'strategy',
      this.sanitizeId(hotelId),
      strategy.toLowerCase()
    ]);
  }

  /**
   * ================================
   * ANALYTICS KEYS
   * ================================
   */

  /**
   * Génère une clé pour les analytics
   */
  analyticsKey(type, identifier, period = null, granularity = null) {
    const parts = [PREFIXES.ANALYTICS, type, this.sanitizeId(identifier)];
    
    if (period) {
      parts.push(this.formatPeriod(period));
    }
    
    if (granularity) {
      parts.push(granularity);
    }
    
    return this.buildKey(parts);
  }

  /**
   * Clé pour dashboard analytics
   */
  dashboardKey(userId, hotelId = null, timeframe = 'today') {
    const parts = [PREFIXES.ANALYTICS, 'dashboard', this.sanitizeId(userId)];
    
    if (hotelId) {
      parts.push(this.sanitizeId(hotelId));
    }
    
    parts.push(timeframe);
    
    return this.buildKey(parts);
  }

  /**
   * Clé pour métriques temps réel
   */
  realtimeMetricsKey(hotelId, metricType) {
    return this.buildKey([
      PREFIXES.REALTIME,
      PREFIXES.METRICS,
      this.sanitizeId(hotelId),
      metricType
    ]);
  }

  /**
   * ================================
   * HOTEL DATA KEYS
   * ================================
   */

  /**
   * Génère une clé pour les données hôtel
   */
  hotelDataKey(hotelId, dataType = 'full') {
    return this.buildKey([
      PREFIXES.HOTEL,
      this.sanitizeId(hotelId),
      dataType
    ]);
  }

  /**
   * Clé pour configuration hôtel
   */
  hotelConfigKey(hotelId, configType = 'general') {
    return this.buildKey([
      PREFIXES.HOTEL,
      'config',
      this.sanitizeId(hotelId),
      configType
    ]);
  }

  /**
   * Pattern pour données hôtel
   */
  hotelPattern(hotelId) {
    return this.buildKey([PREFIXES.HOTEL, this.sanitizeId(hotelId), '*']);
  }

  /**
   * ================================
   * BOOKING KEYS
   * ================================
   */

  /**
   * Génère une clé pour les données de réservation
   */
  bookingKey(bookingId, dataType = 'full') {
    return this.buildKey([
      PREFIXES.BOOKING,
      this.sanitizeId(bookingId),
      dataType
    ]);
  }

  /**
   * Clé pour workflow de réservation
   */
  bookingWorkflowKey(bookingId, step) {
    return this.buildKey([
      PREFIXES.BOOKING,
      'workflow',
      this.sanitizeId(bookingId),
      step
    ]);
  }

  /**
   * Clé pour QR code de réservation
   */
  bookingQRKey(bookingId) {
    return this.buildKey([
      PREFIXES.QR_CODES,
      PREFIXES.BOOKING,
      this.sanitizeId(bookingId)
    ]);
  }

  /**
   * ================================
   * USER & SESSION KEYS
   * ================================
   */

  /**
   * Génère une clé pour les données utilisateur
   */
  userDataKey(userId, dataType = 'profile') {
    return this.buildKey([
      PREFIXES.USER,
      this.sanitizeId(userId),
      dataType
    ]);
  }

  /**
   * Clé pour session utilisateur
   */
  userSessionKey(userId, sessionId = null) {
    const parts = [PREFIXES.SESSIONS, this.sanitizeId(userId)];
    
    if (sessionId) {
      parts.push(this.sanitizeId(sessionId));
    }
    
    return this.buildKey(parts);
  }

  /**
   * Clé pour préférences utilisateur
   */
  userPreferencesKey(userId) {
    return this.buildKey([
      PREFIXES.USER,
      'preferences',
      this.sanitizeId(userId)
    ]);
  }

  /**
   * ================================
   * SEARCH KEYS
   * ================================
   */

  /**
   * Génère une clé pour les résultats de recherche
   */
  searchResultsKey(query, filters = {}) {
    const queryHash = this.hashObject({ query, filters });
    
    return this.buildKey([
      PREFIXES.SEARCH,
      'results',
      queryHash
    ]);
  }

  /**
   * Clé pour recherche géographique
   */
  geoSearchKey(lat, lng, radius, filters = {}) {
    const geoHash = this.hashObject({ lat, lng, radius, filters });
    
    return this.buildKey([
      PREFIXES.SEARCH,
      'geo',
      geoHash
    ]);
  }

  /**
   * ================================
   * REAL-TIME & NOTIFICATIONS
   * ================================
   */

  /**
   * Clé pour notification temps réel
   */
  notificationKey(userId, type = 'general') {
    return this.buildKey([
      PREFIXES.NOTIFICATIONS,
      type,
      this.sanitizeId(userId)
    ]);
  }

  /**
   * Clé pour données socket
   */
  socketDataKey(socketId, dataType = 'session') {
    return this.buildKey([
      PREFIXES.REALTIME,
      'socket',
      this.sanitizeId(socketId),
      dataType
    ]);
  }

  /**
   * ================================
   * LOCKS & COUNTERS
   * ================================
   */

  /**
   * Clé pour lock distribué
   */
  lockKey(resource, operation = 'general') {
    return this.buildKey([
      PREFIXES.LOCKS,
      operation,
      this.sanitizeId(resource)
    ]);
  }

  /**
   * Clé pour compteur
   */
  counterKey(type, identifier, period = null) {
    const parts = [PREFIXES.COUNTERS, type, this.sanitizeId(identifier)];
    
    if (period) {
      parts.push(this.formatPeriod(period));
    }
    
    return this.buildKey(parts);
  }

  /**
   * ================================
   * INVALIDATION PATTERNS
   * ================================
   */

  /**
   * Patterns d'invalidation pour un hôtel
   */
  getHotelInvalidationPatterns(hotelId) {
    const id = this.sanitizeId(hotelId);
    
    return [
      // Availability patterns
      this.buildKey([PREFIXES.AVAILABILITY, id, '*']),
      
      // Yield patterns
      this.buildKey([PREFIXES.YIELD, id, '*']),
      
      // Hotel data patterns
      this.buildKey([PREFIXES.HOTEL, id, '*']),
      
      // Analytics patterns
      this.buildKey([PREFIXES.ANALYTICS, 'hotel', id, '*']),
      this.buildKey([PREFIXES.ANALYTICS, '*', id, '*']),
      
      // Real-time patterns
      this.buildKey([PREFIXES.REALTIME, '*', id, '*']),
      
      // Metrics patterns
      this.buildKey([PREFIXES.METRICS, id, '*'])
    ];
  }

  /**
   * Patterns d'invalidation pour une réservation
   */
  getBookingInvalidationPatterns(bookingId, hotelId = null) {
    const id = this.sanitizeId(bookingId);
    const patterns = [
      // Booking patterns
      this.buildKey([PREFIXES.BOOKING, id, '*']),
      
      // QR code patterns
      this.buildKey([PREFIXES.QR_CODES, '*', id, '*']),
      
      // Workflow patterns
      this.buildKey([PREFIXES.BOOKING, 'workflow', id, '*'])
    ];
    
    // Add hotel-related patterns if hotelId provided
    if (hotelId) {
      const hotelPatterns = this.getHotelInvalidationPatterns(hotelId);
      patterns.push(...hotelPatterns);
    }
    
    return patterns;
  }

  /**
   * Patterns d'invalidation pour un utilisateur
   */
  getUserInvalidationPatterns(userId) {
    const id = this.sanitizeId(userId);
    
    return [
      // User data patterns
      this.buildKey([PREFIXES.USER, id, '*']),
      
      // Session patterns
      this.buildKey([PREFIXES.SESSIONS, id, '*']),
      
      // Notification patterns
      this.buildKey([PREFIXES.NOTIFICATIONS, '*', id, '*']),
      
      // Analytics patterns
      this.buildKey([PREFIXES.ANALYTICS, 'user', id, '*'])
    ];
  }

  /**
   * ================================
   * UTILITY METHODS
   * ================================
   */

  /**
   * Construit une clé complète
   */
  buildKey(parts) {
    const fullParts = [this.appPrefix, this.environment, ...parts];
    return fullParts.join(this.separator);
  }

  /**
   * Valide et tronque une clé si nécessaire
   */
  validateKey(key) {
    if (key.length > this.maxKeyLength) {
      // Hash the key if too long
      const hash = crypto.createHash('md5').update(key).digest('hex');
      const prefix = key.substring(0, this.maxKeyLength - 33); // 32 chars for hash + 1 for separator
      return `${prefix}_${hash}`;
    }
    
    return key;
  }

  /**
   * Sanitize un ID pour utilisation dans une clé
   */
  sanitizeId(id) {
    if (!id) return 'null';
    
    return String(id)
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .substring(0, 50); // Limite la longueur
  }

  /**
   * Formate une date pour utilisation dans une clé
   */
  formatDate(date) {
    if (!date) return 'null';
    
    if (typeof date === 'string') {
      date = new Date(date);
    }
    
    return moment(date).format('YYYY-MM-DD');
  }

  /**
   * Formate une période pour utilisation dans une clé
   */
  formatPeriod(period) {
    if (typeof period === 'object' && period.start && period.end) {
      return `${this.formatDate(period.start)}_${this.formatDate(period.end)}`;
    }
    
    return String(period).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Hash un objet pour créer une clé unique
   */
  hashObject(obj) {
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
  }

  /**
   * ================================
   * BATCH OPERATIONS
   * ================================
   */

  /**
   * Génère des clés en lot pour une période
   */
  generateDateRangeKeys(baseKeyGenerator, startDate, endDate, ...args) {
    const keys = [];
    const current = moment(startDate);
    const end = moment(endDate);
    
    while (current.isSameOrBefore(end)) {
      keys.push(baseKeyGenerator(current.toDate(), ...args));
      current.add(1, 'day');
    }
    
    return keys;
  }

  /**
   * Génère des patterns de nettoyage par âge
   */
  getCleanupPatterns(olderThanDays = 7) {
    const cutoffDate = moment().subtract(olderThanDays, 'days').format('YYYY-MM-DD');
    
    return [
      // Temporary data patterns
      this.buildKey([PREFIXES.TEMP, '*']),
      
      // Old search results
      this.buildKey([PREFIXES.SEARCH, 'results', `*_${cutoffDate}_*`]),
      
      // Expired sessions
      this.buildKey([PREFIXES.SESSIONS, '*', `*_${cutoffDate}_*`]),
      
      // Old notifications
      this.buildKey([PREFIXES.NOTIFICATIONS, '*', `*_${cutoffDate}_*`])
    ];
  }

  /**
   * ================================
   * CONFIGURATION HELPERS
   * ================================
   */

  /**
   * Obtient le TTL approprié pour un type de données
   */
  getTTL(category, subcategory = 'MEDIUM') {
    return TTL[category.toUpperCase()]?.[subcategory.toUpperCase()] || TTL.ANALYTICS.REPORTS;
  }

  /**
   * Obtient tous les TTL configurés
   */
  getAllTTL() {
    return TTL;
  }

  /**
   * Obtient tous les préfixes configurés
   */
  getAllPrefixes() {
    return PREFIXES;
  }

  /**
   * Configure l'environnement
   */
  setEnvironment(env) {
    this.environment = env;
    return this;
  }

  /**
   * Configure le préfixe d'application
   */
  setAppPrefix(prefix) {
    this.appPrefix = prefix;
    return this;
  }
}

/**
 * ================================
 * EXPORTS
 * ================================
 */

// Create singleton instance
const cacheKeys = new CacheKeyGenerator();

// Export everything
module.exports = {
  // Main instance
  CacheKeys: cacheKeys,
  
  // Classes for custom instances
  CacheKeyGenerator,
  
  // Constants
  TTL,
  PREFIXES,
  
  // Convenience methods
  generateKey: (...args) => cacheKeys.buildKey(args),
  sanitizeId: (id) => cacheKeys.sanitizeId(id),
  formatDate: (date) => cacheKeys.formatDate(date),
  hashObject: (obj) => cacheKeys.hashObject(obj),
  
  // Key generators (shortcuts)
  availability: (hotelId, checkIn, checkOut, roomType, options) => 
    cacheKeys.availabilityKey(hotelId, checkIn, checkOut, roomType, options),
    
  yieldPricing: (hotelId, roomType, date, strategy) => 
    cacheKeys.yieldPricingKey(hotelId, roomType, date, strategy),
    
  analytics: (type, identifier, period, granularity) => 
    cacheKeys.analyticsKey(type, identifier, period, granularity),
    
  hotelData: (hotelId, dataType) => 
    cacheKeys.hotelDataKey(hotelId, dataType),
    
  bookingData: (bookingId, dataType) => 
    cacheKeys.bookingKey(bookingId, dataType),
    
  userData: (userId, dataType) => 
    cacheKeys.userDataKey(userId, dataType),
    
  // Invalidation helpers
  invalidationPatterns: {
    hotel: (hotelId) => cacheKeys.getHotelInvalidationPatterns(hotelId),
    booking: (bookingId, hotelId) => cacheKeys.getBookingInvalidationPatterns(bookingId, hotelId),
    user: (userId) => cacheKeys.getUserInvalidationPatterns(userId)
  }
};