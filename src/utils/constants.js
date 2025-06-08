/**
 * CONSTANTES MÉTIER - SYSTÈME GESTION HÔTELIÈRE + YIELD MANAGEMENT
 * Selon cahier des charges - Types obligatoires et règles business + optimisation revenue
 */

// ================================
// TYPES DE CHAMBRES (4 obligatoires)
// ================================
const ROOM_TYPES = {
  SIMPLE: 'Simple',
  DOUBLE: 'Double', 
  DOUBLE_COMFORT: 'Double Confort',
  SUITE: 'Suite'
};

// Multiplicateurs prix par type de chambre
const ROOM_TYPE_MULTIPLIERS = {
  [ROOM_TYPES.SIMPLE]: 1.0,        // Prix de base
  [ROOM_TYPES.DOUBLE]: 1.4,        // +40%
  [ROOM_TYPES.DOUBLE_COMFORT]: 1.8, // +80%
  [ROOM_TYPES.SUITE]: 2.5          // +150%
};

// Capacité standard par type
const ROOM_CAPACITIES = {
  [ROOM_TYPES.SIMPLE]: 1,
  [ROOM_TYPES.DOUBLE]: 2,
  [ROOM_TYPES.DOUBLE_COMFORT]: 2,
  [ROOM_TYPES.SUITE]: 4
};

// ================================
// STATUTS CHAMBRES
// ================================
const ROOM_STATUS = {
  AVAILABLE: 'Available',      // Disponible à la réservation
  OCCUPIED: 'Occupied',        // Occupée par un client
  MAINTENANCE: 'Maintenance',  // En maintenance
  OUT_OF_ORDER: 'Out of Order' // Hors service
};

// ================================
// WORKFLOW RÉSERVATIONS (Obligatoire cahier charges)
// ================================
const BOOKING_STATUS = {
  PENDING: 'Pending',         // En attente validation admin
  CONFIRMED: 'Confirmed',     // Validée par admin
  CHECKED_IN: 'Checked-in',   // Client arrivé (check-in fait)
  COMPLETED: 'Completed',     // Séjour terminé (check-out fait)
  CANCELLED: 'Cancelled',     // Annulée par client/admin
  REJECTED: 'Rejected',       // Rejetée par admin
  NO_SHOW: 'No-show'         // Client ne s'est pas présenté
};

// Transitions autorisées entre statuts
const BOOKING_STATUS_TRANSITIONS = {
  [BOOKING_STATUS.PENDING]: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.REJECTED, BOOKING_STATUS.CANCELLED],
  [BOOKING_STATUS.CONFIRMED]: [BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.CANCELLED, BOOKING_STATUS.NO_SHOW],
  [BOOKING_STATUS.CHECKED_IN]: [BOOKING_STATUS.COMPLETED],
  [BOOKING_STATUS.COMPLETED]: [], // État final
  [BOOKING_STATUS.CANCELLED]: [], // État final
  [BOOKING_STATUS.REJECTED]: [],  // État final
  [BOOKING_STATUS.NO_SHOW]: []    // État final
};

// ================================
// SOURCES RÉSERVATIONS (Pour statistiques)
// ================================
const BOOKING_SOURCES = {
  WEB: 'Web',           // Site web
  MOBILE: 'Mobile',     // Application mobile
  RECEPTION: 'Reception' // À la réception
};

// ================================
// RÔLES UTILISATEURS
// ================================
const USER_ROLES = {
  CLIENT: 'CLIENT',
  RECEPTIONIST: 'RECEPTIONIST', 
  ADMIN: 'ADMIN'
};

// Permissions par rôle
const ROLE_PERMISSIONS = {
  [USER_ROLES.CLIENT]: [
    'booking:create',      // Créer réservation
    'booking:read:own',    // Voir ses réservations
    'booking:update:own',  // Modifier ses réservations (si PENDING)
    'booking:cancel:own'   // Annuler ses réservations
  ],
  [USER_ROLES.RECEPTIONIST]: [
    'booking:create',           // Créer réservation pour client
    'booking:read:hotel',       // Voir réservations de son hôtel
    'booking:checkin',          // Effectuer check-in
    'booking:checkout',         // Effectuer check-out
    'booking:add-extras',       // Ajouter consommations
    'room:read',               // Consulter chambres
    'room:update:status',      // Changer statut chambre
    'user:create:client',      // Créer compte client
    'yield:read',              // Consulter yield management
    'yield:pricing:view'       // Voir prix dynamiques
  ],
  [USER_ROLES.ADMIN]: [
    'hotel:*',           // Toutes opérations hôtels
    'room:*',            // Toutes opérations chambres
    'booking:*',         // Toutes opérations réservations
    'user:*',            // Toutes opérations utilisateurs
    'stats:read',        // Accès statistiques/dashboard
    'yield:*',           // Toutes opérations yield management
    'analytics:*'        // Toutes opérations analytics
  ]
};

// ================================
// SAISONS & MULTIPLICATEURS PRIX
// ================================
const SEASONS = {
  LOW: 'Low Season',       // Basse saison
  MEDIUM: 'Medium Season', // Moyenne saison
  HIGH: 'High Season',     // Haute saison
  PEAK: 'Peak Season'      // Très haute saison
};

// Multiplicateurs saisonniers par défaut
const SEASONAL_MULTIPLIERS = {
  [SEASONS.LOW]: 0.8,      // -20%
  [SEASONS.MEDIUM]: 1.0,   // Prix de base
  [SEASONS.HIGH]: 1.3,     // +30%
  [SEASONS.PEAK]: 1.6      // +60%
};

// Périodes saisonnières par défaut (Maroc - adaptable)
const DEFAULT_SEASONAL_PERIODS = [
  // Basse saison - Été chaud
  { 
    season: SEASONS.LOW, 
    startMonth: 6, startDay: 15,  // 15 juin
    endMonth: 9, endDay: 15       // 15 septembre
  },
  // Haute saison - Automne/Hiver doux
  {
    season: SEASONS.HIGH,
    startMonth: 10, startDay: 1,  // 1er octobre  
    endMonth: 3, endDay: 31       // 31 mars
  },
  // Très haute saison - Vacances/Fêtes
  {
    season: SEASONS.PEAK,
    startMonth: 12, startDay: 20, // 20 décembre
    endMonth: 1, endDay: 10       // 10 janvier
  }
  // Le reste = MEDIUM par défaut
];

// ================================
// CATÉGORIES HÔTELS
// ================================
const HOTEL_CATEGORIES = {
  ONE_STAR: 1,
  TWO_STAR: 2, 
  THREE_STAR: 3,
  FOUR_STAR: 4,
  FIVE_STAR: 5
};

// Multiplicateurs prix par catégorie hôtel
const HOTEL_CATEGORY_MULTIPLIERS = {
  [HOTEL_CATEGORIES.ONE_STAR]: 0.6,   // -40%
  [HOTEL_CATEGORIES.TWO_STAR]: 0.8,   // -20%
  [HOTEL_CATEGORIES.THREE_STAR]: 1.0, // Base
  [HOTEL_CATEGORIES.FOUR_STAR]: 1.5,  // +50%
  [HOTEL_CATEGORIES.FIVE_STAR]: 2.2   // +120%
};

// ================================
// TYPES CLIENTS (Cahier des charges)
// ================================
const CLIENT_TYPES = {
  INDIVIDUAL: 'Individual',  // Particulier (personne physique)
  CORPORATE: 'Corporate'     // Entreprise (personne morale)
};

// ================================
// 📊 YIELD MANAGEMENT CONSTANTS
// ================================

// Types de règles de pricing
const PRICING_RULE_TYPES = {
  OCCUPANCY_BASED: 'occupancy_based',         // Basé sur taux d'occupation
  DEMAND_BASED: 'demand_based',               // Basé sur la demande
  SEASONAL: 'seasonal',                       // Saisonnier
  DAY_OF_WEEK: 'day_of_week',                // Jour de la semaine
  ADVANCE_BOOKING: 'advance_booking',         // Réservation anticipée
  LAST_MINUTE: 'last_minute',                 // Dernière minute
  LENGTH_OF_STAY: 'length_of_stay',           // Durée de séjour
  COMPETITOR_BASED: 'competitor_based',       // Basé sur concurrence
  EVENT_BASED: 'event_based'                  // Basé sur événements
};

// Actions de pricing
const PRICING_ACTIONS = {
  INCREASE: 'increase',       // Augmenter prix
  DECREASE: 'decrease',       // Diminuer prix
  MULTIPLY: 'multiply',       // Multiplier prix
  SET_FIXED: 'set_fixed',     // Prix fixe
  SET_RANGE: 'set_range'      // Fourchette de prix
};

// Seuils d'occupation pour yield management
const OCCUPANCY_THRESHOLDS = {
  VERY_LOW: 0,      // 0-25%
  LOW: 25,          // 25-50%
  MEDIUM: 50,       // 50-70%
  HIGH: 70,         // 70-85%
  VERY_HIGH: 85,    // 85-95%
  CRITICAL: 95      // 95-100%
};

// Multiplicateurs de prix par seuil d'occupation
const OCCUPANCY_PRICE_MULTIPLIERS = {
  [OCCUPANCY_THRESHOLDS.VERY_LOW]: 0.7,    // -30% (attirer demande)
  [OCCUPANCY_THRESHOLDS.LOW]: 0.85,        // -15%
  [OCCUPANCY_THRESHOLDS.MEDIUM]: 1.0,      // Prix normal
  [OCCUPANCY_THRESHOLDS.HIGH]: 1.15,       // +15%
  [OCCUPANCY_THRESHOLDS.VERY_HIGH]: 1.35,  // +35%
  [OCCUPANCY_THRESHOLDS.CRITICAL]: 1.5     // +50%
};

// Multiplicateurs par jour de la semaine
const DAY_OF_WEEK_MULTIPLIERS = {
  MONDAY: 0.9,      // -10%
  TUESDAY: 0.9,     // -10%
  WEDNESDAY: 0.95,  // -5%
  THURSDAY: 1.0,    // Prix normal
  FRIDAY: 1.15,     // +15%
  SATURDAY: 1.3,    // +30%
  SUNDAY: 1.1       // +10%
};

// Multiplicateurs par période de réservation anticipée
const ADVANCE_BOOKING_MULTIPLIERS = {
  SAME_DAY: 1.2,         // +20% (dernière minute)
  ONE_WEEK: 1.0,         // Prix normal
  TWO_WEEKS: 0.95,       // -5%
  ONE_MONTH: 0.9,        // -10%
  THREE_MONTHS: 0.85,    // -15%
  SIX_MONTHS: 0.8        // -20%
};

// Seuils de demande
const DEMAND_LEVELS = {
  VERY_LOW: 'very_low',    // Demande très faible
  LOW: 'low',              // Demande faible
  NORMAL: 'normal',        // Demande normale
  HIGH: 'high',            // Demande forte
  VERY_HIGH: 'very_high',  // Demande très forte
  SURGE: 'surge'           // Pic de demande
};

// Multiplicateurs par niveau de demande
const DEMAND_PRICE_MULTIPLIERS = {
  [DEMAND_LEVELS.VERY_LOW]: 0.7,     // -30%
  [DEMAND_LEVELS.LOW]: 0.85,         // -15%
  [DEMAND_LEVELS.NORMAL]: 1.0,       // Prix normal
  [DEMAND_LEVELS.HIGH]: 1.2,         // +20%
  [DEMAND_LEVELS.VERY_HIGH]: 1.4,    // +40%
  [DEMAND_LEVELS.SURGE]: 1.6         // +60%
};

// Limites de yield management
const YIELD_LIMITS = {
  MAX_PRICE_INCREASE_PERCENT: 50,     // Maximum +50%
  MIN_PRICE_DECREASE_PERCENT: 30,     // Maximum -30%
  MAX_DAILY_PRICE_CHANGES: 5,        // Maximum 5 changements/jour
  MIN_PRICE_CHANGE_PERCENT: 5,       // Minimum 5% de changement
  PRICE_STABILITY_HOURS: 4           // 4h minimum entre changements
};

// Priorité des règles de pricing (plus haut = priorité)
const RULE_PRIORITIES = {
  [PRICING_RULE_TYPES.EVENT_BASED]: 100,        // Priorité maximale
  [PRICING_RULE_TYPES.OCCUPANCY_BASED]: 90,     // Très haute
  [PRICING_RULE_TYPES.DEMAND_BASED]: 80,        // Haute
  [PRICING_RULE_TYPES.SEASONAL]: 70,            // Élevée
  [PRICING_RULE_TYPES.DAY_OF_WEEK]: 60,         // Moyenne-haute
  [PRICING_RULE_TYPES.LAST_MINUTE]: 50,         // Moyenne
  [PRICING_RULE_TYPES.ADVANCE_BOOKING]: 40,     // Moyenne-basse
  [PRICING_RULE_TYPES.LENGTH_OF_STAY]: 30,      // Basse
  [PRICING_RULE_TYPES.COMPETITOR_BASED]: 20     // Très basse
};

// Segments de clientèle pour yield
const CUSTOMER_SEGMENTS = {
  BUDGET: 'budget',           // Clientèle budget
  STANDARD: 'standard',       // Clientèle standard
  PREMIUM: 'premium',         // Clientèle premium
  LUXURY: 'luxury',           // Clientèle luxe
  BUSINESS: 'business',       // Voyageurs d'affaires
  LEISURE: 'leisure',         // Voyageurs loisir
  GROUP: 'group'              // Groupes
};

// Types d'événements affectant les prix
const EVENT_TYPES = {
  CONFERENCE: 'conference',     // Conférence
  FESTIVAL: 'festival',         // Festival
  SPORT: 'sport',              // Événement sportif
  CONCERT: 'concert',          // Concert
  HOLIDAY: 'holiday',          // Jour férié
  SCHOOL_HOLIDAY: 'school_holiday', // Vacances scolaires
  TRADE_SHOW: 'trade_show',    // Salon professionnel
  WEDDING_SEASON: 'wedding_season' // Saison mariages
};

// ================================
// REVENUE ANALYTICS CONSTANTS
// ================================

// Métriques de performance
const PERFORMANCE_METRICS = {
  OCCUPANCY_RATE: 'occupancy_rate',          // Taux d'occupation
  ADR: 'adr',                                // Average Daily Rate
  REVPAR: 'revpar',                          // Revenue Per Available Room
  TOTAL_REVENUE: 'total_revenue',            // Revenus totaux
  BOOKING_CONVERSION: 'booking_conversion',  // Taux de conversion
  CANCELLATION_RATE: 'cancellation_rate',   // Taux d'annulation
  NO_SHOW_RATE: 'no_show_rate',            // Taux de no-show
  CUSTOMER_SATISFACTION: 'customer_satisfaction' // Satisfaction client
};

// Périodes d'analyse
const ANALYSIS_PERIODS = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  QUARTERLY: 'quarterly',
  YEARLY: 'yearly'
};

// ================================
// CONTRAINTES MÉTIER
// ================================
const BUSINESS_RULES = {
  // Réservation
  MIN_BOOKING_NIGHTS: 1,           // Minimum 1 nuit
  MAX_BOOKING_NIGHTS: 365,         // Maximum 1 an
  MAX_ROOMS_PER_BOOKING: 10,       // Maximum 10 chambres par réservation
  MIN_ADVANCE_BOOKING_HOURS: 1,    // Minimum 1h à l'avance
  MAX_ADVANCE_BOOKING_DAYS: 365,   // Maximum 1 an à l'avance
  
  // Annulation
  FREE_CANCELLATION_HOURS: 24,     // Annulation gratuite 24h avant
  
  // Prix
  MIN_ROOM_PRICE: 50,              // Prix minimum chambre (MAD)
  MAX_ROOM_PRICE: 10000,           // Prix maximum chambre (MAD)
  
  // Images
  MAX_HOTEL_IMAGES: 20,            // Maximum 20 images par hôtel
  MAX_ROOM_IMAGES: 10,             // Maximum 10 images par chambre
  MAX_IMAGE_SIZE_MB: 5,            // Taille max image 5MB
  
  // Validation  
  SIRET_LENGTH: 14,                // Longueur SIRET pour entreprises
  MIN_PASSWORD_LENGTH: 8,          // Minimum mot de passe
  
  // Yield Management
  MIN_OCCUPANCY_FOR_SURGE: 80,     // Minimum 80% pour surge pricing
  MAX_YIELD_PRICE_CHANGES_PER_DAY: 3, // Maximum 3 changements prix/jour
  YIELD_ANALYSIS_MIN_DATA_POINTS: 10   // Minimum 10 points pour analyse
};

// ================================
// FORMATS & VALIDATIONS
// ================================
const VALIDATION_PATTERNS = {
  HOTEL_CODE: /^[A-Z]{3}\d{3}$/,   // Ex: RAB001, CAS002
  PHONE: /^(\+212|0)[5-7]\d{8}$/,  // Téléphone marocain
  SIRET: /^\d{14}$/,               // SIRET entreprise (14 chiffres)
  POSTAL_CODE: /^\d{5}$/           // Code postal (5 chiffres)
};

// ================================
// MESSAGES D'ERREUR STANDARDISÉS
// ================================
const ERROR_MESSAGES = {
  // Authentification
  INVALID_CREDENTIALS: 'Email ou mot de passe incorrect',
  ACCESS_DENIED: 'Accès refusé - permissions insuffisantes',
  TOKEN_EXPIRED: 'Session expirée, veuillez vous reconnecter',
  
  // Validation
  REQUIRED_FIELD: 'Ce champ est obligatoire',
  INVALID_EMAIL: 'Format email invalide',
  INVALID_DATE: 'Format de date invalide',
  DATE_IN_PAST: 'La date ne peut pas être dans le passé',
  
  // Business logic
  ROOM_NOT_AVAILABLE: 'Chambre non disponible pour ces dates',
  INVALID_DATE_RANGE: 'Date de fin doit être après date de début',
  BOOKING_NOT_MODIFIABLE: 'Réservation non modifiable dans cet état',
  INVALID_STATUS_TRANSITION: 'Transition de statut non autorisée',
  
  // Yield Management
  YIELD_DISABLED: 'Yield management désactivé',
  INVALID_PRICING_RULE: 'Règle de pricing invalide',
  PRICE_LIMIT_EXCEEDED: 'Limite de changement de prix dépassée',
  INSUFFICIENT_DATA: 'Données insuffisantes pour analyse yield',
  
  // Ressources
  HOTEL_NOT_FOUND: 'Hôtel non trouvé',
  ROOM_NOT_FOUND: 'Chambre non trouvée', 
  BOOKING_NOT_FOUND: 'Réservation non trouvée',
  USER_NOT_FOUND: 'Utilisateur non trouvé'
};

// ================================
// CONFIGURATION EMAIL/NOTIFICATIONS
// ================================
const NOTIFICATION_TYPES = {
  BOOKING_CONFIRMATION: 'booking_confirmation',
  BOOKING_VALIDATION: 'booking_validation',
  BOOKING_REJECTION: 'booking_rejection',
  BOOKING_REMINDER: 'booking_reminder',
  PAYMENT_CONFIRMATION: 'payment_confirmation',
  PRICE_ALERT: 'price_alert',
  OCCUPANCY_ALERT: 'occupancy_alert',
  REVENUE_ALERT: 'revenue_alert',
  YIELD_OPTIMIZATION: 'yield_optimization'
};

// ================================
// JOB SCHEDULING CONSTANTS
// ================================
const JOB_TYPES = {
  DEMAND_ANALYSIS: 'demand_analysis',
  PRICE_UPDATE: 'price_update',
  OCCUPANCY_ANALYSIS: 'occupancy_analysis',
  REVENUE_OPTIMIZATION: 'revenue_optimization',
  PERFORMANCE_MONITORING: 'performance_monitoring',
  DAILY_REPORT: 'daily_report',
  WEEKLY_FORECAST: 'weekly_forecast'
};

const JOB_FREQUENCIES = {
  [JOB_TYPES.DEMAND_ANALYSIS]: '*/5 * * * *',        // Toutes les 5 minutes
  [JOB_TYPES.PRICE_UPDATE]: '*/10 * * * *',          // Toutes les 10 minutes
  [JOB_TYPES.OCCUPANCY_ANALYSIS]: '*/30 * * * *',    // Toutes les 30 minutes
  [JOB_TYPES.REVENUE_OPTIMIZATION]: '0 * * * *',     // Chaque heure
  [JOB_TYPES.PERFORMANCE_MONITORING]: '0 */2 * * *', // Toutes les 2 heures
  [JOB_TYPES.DAILY_REPORT]: '0 6 * * *',            // 6h chaque jour
  [JOB_TYPES.WEEKLY_FORECAST]: '0 8 * * 0'          // 8h chaque dimanche
};

// ================================
// EXPORTS
// ================================
module.exports = {
  // Types & Statuts
  ROOM_TYPES,
  ROOM_TYPE_MULTIPLIERS,
  ROOM_CAPACITIES,
  ROOM_STATUS,
  BOOKING_STATUS,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_SOURCES,
  
  // Utilisateurs & Permissions
  USER_ROLES,
  ROLE_PERMISSIONS,
  CLIENT_TYPES,
  
  // Pricing & Saisons
  SEASONS,
  SEASONAL_MULTIPLIERS,
  DEFAULT_SEASONAL_PERIODS,
  HOTEL_CATEGORIES,
  HOTEL_CATEGORY_MULTIPLIERS,
  
  // Yield Management
  PRICING_RULE_TYPES,
  PRICING_ACTIONS,
  OCCUPANCY_THRESHOLDS,
  OCCUPANCY_PRICE_MULTIPLIERS,
  DAY_OF_WEEK_MULTIPLIERS,
  ADVANCE_BOOKING_MULTIPLIERS,
  DEMAND_LEVELS,
  DEMAND_PRICE_MULTIPLIERS,
  YIELD_LIMITS,
  RULE_PRIORITIES,
  CUSTOMER_SEGMENTS,
  EVENT_TYPES,
  
  // Analytics
  PERFORMANCE_METRICS,
  ANALYSIS_PERIODS,
  
  // Jobs & Scheduling
  JOB_TYPES,
  JOB_FREQUENCIES,
  
  // Contraintes métier
  BUSINESS_RULES,
  VALIDATION_PATTERNS,
  ERROR_MESSAGES,
  
  // Notifications
  NOTIFICATION_TYPES,
  
  // Helpers pour validation
  isValidRoomType: (type) => Object.values(ROOM_TYPES).includes(type),
  isValidBookingStatus: (status) => Object.values(BOOKING_STATUS).includes(status),
  isValidUserRole: (role) => Object.values(USER_ROLES).includes(role),
  canTransitionBookingStatus: (from, to) => {
    return BOOKING_STATUS_TRANSITIONS[from]?.includes(to) || false;
  },
  
  // Helper permissions
  hasPermission: (userRole, permission) => {
    const permissions = ROLE_PERMISSIONS[userRole] || [];
    return permissions.includes(permission) || permissions.includes('*') || 
           permissions.some(p => p.endsWith(':*') && permission.startsWith(p.split(':')[0] + ':'));
  },
  
  // Yield Management helpers
  getOccupancyLevel: (occupancyPercent) => {
    if (occupancyPercent < OCCUPANCY_THRESHOLDS.LOW) return 'VERY_LOW';
    if (occupancyPercent < OCCUPANCY_THRESHOLDS.MEDIUM) return 'LOW';
    if (occupancyPercent < OCCUPANCY_THRESHOLDS.HIGH) return 'MEDIUM';
    if (occupancyPercent < OCCUPANCY_THRESHOLDS.VERY_HIGH) return 'HIGH';
    if (occupancyPercent < OCCUPANCY_THRESHOLDS.CRITICAL) return 'VERY_HIGH';
    return 'CRITICAL';
  },
  
  getPricingMultiplier: (occupancyPercent) => {
    const level = module.exports.getOccupancyLevel(occupancyPercent);
    const thresholdValue = OCCUPANCY_THRESHOLDS[level] || OCCUPANCY_THRESHOLDS.MEDIUM;
    return OCCUPANCY_PRICE_MULTIPLIERS[thresholdValue] || 1.0;
  },
  
  getDayOfWeekMultiplier: (date) => {
    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const dayName = days[new Date(date).getDay()];
    return DAY_OF_WEEK_MULTIPLIERS[dayName] || 1.0;
  },
  
  getAdvanceBookingMultiplier: (bookingDate, stayDate) => {
    const diffDays = Math.floor((new Date(stayDate) - new Date(bookingDate)) / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return ADVANCE_BOOKING_MULTIPLIERS.SAME_DAY;
    if (diffDays <= 7) return ADVANCE_BOOKING_MULTIPLIERS.ONE_WEEK;
    if (diffDays <= 14) return ADVANCE_BOOKING_MULTIPLIERS.TWO_WEEKS;
    if (diffDays <= 30) return ADVANCE_BOOKING_MULTIPLIERS.ONE_MONTH;
    if (diffDays <= 90) return ADVANCE_BOOKING_MULTIPLIERS.THREE_MONTHS;
    return ADVANCE_BOOKING_MULTIPLIERS.SIX_MONTHS;
  },
  
  isValidPricingRuleType: (type) => Object.values(PRICING_RULE_TYPES).includes(type),
  isValidPricingAction: (action) => Object.values(PRICING_ACTIONS).includes(action),
  isValidDemandLevel: (level) => Object.values(DEMAND_LEVELS).includes(level)
};