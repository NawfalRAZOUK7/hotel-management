const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
  // ============================================================================
  // EXISTING FIELDS - PRESERVED AS-IS
  // ============================================================================
  
  // Informations de base selon cahier des charges
  code: {
    type: String,
    required: [true, 'Le code de l\'hôtel est requis'],
    unique: true,
    uppercase: true,
    trim: true,
    minlength: [3, 'Le code doit contenir au moins 3 caractères'],
    maxlength: [10, 'Le code ne peut pas dépasser 10 caractères'],
    match: [/^[A-Z0-9]+$/, 'Le code ne peut contenir que des lettres majuscules et des chiffres']
  },

  name: {
    type: String,
    required: [true, 'Le nom de l\'hôtel est requis'],
    trim: true,
    minlength: [2, 'Le nom doit contenir au moins 2 caractères'],
    maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères']
  },

  // Adresse complète
  address: {
    street: {
      type: String,
      required: [true, 'L\'adresse est requise'],
      trim: true,
      maxlength: [200, 'L\'adresse ne peut pas dépasser 200 caractères']
    },
    city: {
      type: String,
      required: [true, 'La ville est requise'],
      trim: true,
      maxlength: [100, 'La ville ne peut pas dépasser 100 caractères']
    },
    postalCode: {
      type: String,
      required: [true, 'Le code postal est requis'],
      trim: true,
      match: [/^[0-9]{5}$/, 'Le code postal doit contenir 5 chiffres']
    },
    country: {
      type: String,
      default: 'France',
      trim: true
    },
    // Géolocalisation pour navigation mobile (cahier des charges)
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'La latitude doit être entre -90 et 90'],
        max: [90, 'La latitude doit être entre -90 et 90']
      },
      longitude: {
        type: Number,
        min: [-180, 'La longitude doit être entre -180 et 180'],
        max: [180, 'La longitude doit être entre -180 et 180']
      }
    }
  },

  // Catégorie d'étoiles selon cahier des charges
  stars: {
    type: Number,
    required: [true, 'La catégorie d\'étoiles est requise'],
    min: [1, 'Un hôtel doit avoir au minimum 1 étoile'],
    max: [5, 'Un hôtel ne peut pas avoir plus de 5 étoiles'],
    validate: {
      validator: Number.isInteger,
      message: 'Le nombre d\'étoiles doit être un entier'
    }
  },

  // Images de l'hôtel
  images: [{
    url: {
      type: String,
      required: true,
      match: [/^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i, 'URL d\'image invalide']
    },
    alt: {
      type: String,
      default: 'Image de l\'hôtel'
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],

  // Informations de contact
  contact: {
    phone: {
      type: String,
      required: [true, 'Le numéro de téléphone est requis'],
      match: [/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide']
    },
    email: {
      type: String,
      required: [true, 'L\'email est requis'],
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email invalide']
    },
    website: {
      type: String,
      match: [/^https?:\/\/.+/, 'URL du site web invalide']
    }
  },

  // Description et services
  description: {
    type: String,
    maxlength: [1000, 'La description ne peut pas dépasser 1000 caractères']
  },

  amenities: [{
    type: String,
    enum: [
      'WiFi gratuit', 'Parking', 'Piscine', 'Spa', 'Salle de sport',
      'Restaurant', 'Bar', 'Room service', 'Climatisation', 'Ascenseur',
      'Coffre-fort', 'Blanchisserie', 'Service de conciergerie', 'Animaux acceptés'
    ]
  }],

  // Politique de l'hôtel
  policies: {
    checkInTime: {
      type: String,
      default: '15:00',
      match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Format d\'heure invalide (HH:MM)']
    },
    checkOutTime: {
      type: String,
      default: '12:00',
      match: [/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/, 'Format d\'heure invalide (HH:MM)']
    },
    cancellationPolicy: {
      type: String,
      enum: ['FLEXIBLE', 'MODERATE', 'STRICT'],
      default: 'MODERATE'
    },
    minimumAge: {
      type: Number,
      default: 18,
      min: [0, 'L\'âge minimum ne peut pas être négatif']
    },
    petsAllowed: {
      type: Boolean,
      default: false
    }
  },

  // Tarification par saison (ENHANCED - kept for backward compatibility)
  seasonalPricing: [{
    name: {
      type: String,
      required: true,
      enum: ['HAUTE_SAISON', 'MOYENNE_SAISON', 'BASSE_SAISON', 'TRES_HAUTE_SAISON']
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    multiplier: {
      type: Number,
      required: true,
      min: [0.5, 'Le multiplicateur ne peut pas être inférieur à 0.5'],
      max: [3.0, 'Le multiplicateur ne peut pas être supérieur à 3.0'],
      default: 1.0
    }
  }],

  // Statut et gestion
  isActive: {
    type: Boolean,
    default: true
  },

  isPublished: {
    type: Boolean,
    default: false
  },

  // Métadonnées de gestion
  manager: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Un responsable doit être assigné à l\'hôtel']
  },

  staff: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    position: {
      type: String,
      enum: ['RECEPTIONIST', 'HOUSEKEEPING', 'MAINTENANCE', 'SECURITY'],
      required: true
    },
    startDate: {
      type: Date,
      default: Date.now
    }
  }],

  // Statistiques
  stats: {
    totalRooms: {
      type: Number,
      default: 0,
      min: [0, 'Le nombre de chambres ne peut pas être négatif']
    },
    totalBookings: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: [0, 'La note ne peut pas être négative'],
      max: [5, 'La note ne peut pas dépasser 5']
    },
    totalReviews: {
      type: Number,
      default: 0
    }
  },

  // ============================================================================
  // NEW YIELD MANAGEMENT FIELDS - WEEK 3
  // ============================================================================

  // Yield Management Configuration
  yieldManagement: {
    // Enable/disable yield management system
    enabled: {
      type: Boolean,
      default: false
    },
    
    // Pricing strategy
    strategy: {
      type: String,
      enum: ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'],
      default: 'MODERATE'
    },
    
    // Base pricing per room type (overrides room-level base prices when yield is enabled)
    basePricing: {
      SIMPLE: {
        type: Number,
        min: [0, 'Le prix ne peut pas être négatif']
      },
      DOUBLE: {
        type: Number,
        min: [0, 'Le prix ne peut pas être négatif']
      },
      DOUBLE_CONFORT: {
        type: Number,
        min: [0, 'Le prix ne peut pas être négatif']
      },
      SUITE: {
        type: Number,
        min: [0, 'Le prix ne peut pas être négatif']
      }
    },
    
    // Minimum and maximum price constraints
    priceConstraints: {
      SIMPLE: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 }
      },
      DOUBLE: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 }
      },
      DOUBLE_CONFORT: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 }
      },
      SUITE: {
        min: { type: Number, min: 0 },
        max: { type: Number, min: 0 }
      }
    },
    
    // Automated pricing rules
    automationSettings: {
      autoApplyRecommendations: {
        type: Boolean,
        default: false
      },
      maxDailyPriceChange: {
        type: Number,
        default: 20, // Percentage
        min: [0, 'Le changement maximum doit être positif'],
        max: [100, 'Le changement maximum ne peut pas dépasser 100%']
      },
      requireApprovalThreshold: {
        type: Number,
        default: 30, // Percentage - require approval for changes above this
        min: [0, 'Le seuil doit être positif'],
        max: [100, 'Le seuil ne peut pas dépasser 100%']
      },
      updateFrequency: {
        type: String,
        enum: ['HOURLY', 'DAILY', 'WEEKLY', 'MANUAL'],
        default: 'DAILY'
      }
    },
    
    // Occupancy thresholds for pricing adjustments
    occupancyThresholds: {
      veryLow: {
        max: { type: Number, default: 30 },
        priceMultiplier: { type: Number, default: 0.7 }
      },
      low: {
        min: { type: Number, default: 30 },
        max: { type: Number, default: 50 },
        priceMultiplier: { type: Number, default: 0.85 }
      },
      moderate: {
        min: { type: Number, default: 50 },
        max: { type: Number, default: 70 },
        priceMultiplier: { type: Number, default: 1.0 }
      },
      high: {
        min: { type: Number, default: 70 },
        max: { type: Number, default: 85 },
        priceMultiplier: { type: Number, default: 1.15 }
      },
      veryHigh: {
        min: { type: Number, default: 85 },
        max: { type: Number, default: 95 },
        priceMultiplier: { type: Number, default: 1.3 }
      },
      critical: {
        min: { type: Number, default: 95 },
        priceMultiplier: { type: Number, default: 1.5 }
      }
    },
    
    // Day of week pricing adjustments
    dayOfWeekMultipliers: {
      monday: { type: Number, default: 0.85 },
      tuesday: { type: Number, default: 0.85 },
      wednesday: { type: Number, default: 0.9 },
      thursday: { type: Number, default: 0.95 },
      friday: { type: Number, default: 1.15 },
      saturday: { type: Number, default: 1.25 },
      sunday: { type: Number, default: 0.9 }
    },
    
    // Lead time pricing (how far in advance booking is made)
    leadTimePricing: [{
      daysInAdvance: {
        type: Number,
        required: true,
        min: [0, 'Les jours à l\'avance doivent être positifs']
      },
      multiplier: {
        type: Number,
        required: true,
        min: [0.1, 'Le multiplicateur minimum est 0.1'],
        max: [3.0, 'Le multiplicateur maximum est 3.0']
      },
      description: {
        type: String,
        enum: ['SAME_DAY', 'LAST_MINUTE', 'SHORT_TERM', 'ADVANCE', 'EARLY_BIRD']
      }
    }],
    
    // Length of stay discounts
    lengthOfStayDiscounts: [{
      minNights: {
        type: Number,
        required: true,
        min: [1, 'Le minimum de nuits doit être au moins 1']
      },
      maxNights: {
        type: Number,
        min: [1, 'Le maximum de nuits doit être au moins 1']
      },
      discountPercentage: {
        type: Number,
        required: true,
        min: [0, 'La réduction ne peut pas être négative'],
        max: [50, 'La réduction ne peut pas dépasser 50%']
      }
    }],
    
    // Competitor pricing configuration
    competitorPricing: {
      enabled: {
        type: Boolean,
        default: false
      },
      competitors: [{
        name: {
          type: String,
          required: true
        },
        hotelId: {
          type: String // External hotel ID or API reference
        },
        stars: {
          type: Number,
          min: 1,
          max: 5
        },
        pricePosition: {
          type: String,
          enum: ['BELOW', 'MATCH', 'ABOVE'],
          default: 'MATCH'
        },
        priceOffset: {
          type: Number,
          default: 0, // Percentage offset from competitor
          min: [-50, 'L\'offset ne peut pas être inférieur à -50%'],
          max: [50, 'L\'offset ne peut pas dépasser 50%']
        }
      }],
      updateFrequency: {
        type: String,
        enum: ['HOURLY', 'DAILY', 'WEEKLY'],
        default: 'DAILY'
      }
    },
    
    // Event-based pricing
    eventPricing: [{
      eventName: {
        type: String,
        required: true
      },
      startDate: {
        type: Date,
        required: true
      },
      endDate: {
        type: Date,
        required: true
      },
      priceMultiplier: {
        type: Number,
        required: true,
        min: [1.0, 'Le multiplicateur d\'événement doit être au moins 1.0'],
        max: [5.0, 'Le multiplicateur d\'événement ne peut pas dépasser 5.0']
      },
      isRecurring: {
        type: Boolean,
        default: false
      },
      recurringPattern: {
        type: String,
        enum: ['YEARLY', 'MONTHLY', 'WEEKLY']
      }
    }],
    
    // Revenue targets
    revenueTargets: {
      daily: {
        type: Number,
        min: [0, 'L\'objectif quotidien ne peut pas être négatif']
      },
      weekly: {
        type: Number,
        min: [0, 'L\'objectif hebdomadaire ne peut pas être négatif']
      },
      monthly: {
        type: Number,
        min: [0, 'L\'objectif mensuel ne peut pas être négatif']
      },
      yearly: {
        type: Number,
        min: [0, 'L\'objectif annuel ne peut pas être négatif']
      }
    },
    
    // Weather impact on pricing
    weatherImpact: {
      enabled: {
        type: Boolean,
        default: false
      },
      goodWeatherMultiplier: {
        type: Number,
        default: 1.1,
        min: [1.0, 'Le multiplicateur doit être au moins 1.0'],
        max: [2.0, 'Le multiplicateur ne peut pas dépasser 2.0']
      },
      badWeatherMultiplier: {
        type: Number,
        default: 0.9,
        min: [0.5, 'Le multiplicateur doit être au moins 0.5'],
        max: [1.0, 'Le multiplicateur ne peut pas dépasser 1.0']
      }
    }
  },

  // Dynamic Pricing Calendar - Stores calculated prices for quick access
  dynamicPricingCalendar: [{
    date: {
      type: Date,
      required: true
    },
    roomType: {
      type: String,
      required: true,
      enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE']
    },
    basePrice: {
      type: Number,
      required: true
    },
    calculatedPrice: {
      type: Number,
      required: true
    },
    factors: {
      occupancy: { type: Number },
      seasonal: { type: Number },
      dayOfWeek: { type: Number },
      event: { type: Number },
      weather: { type: Number },
      competitor: { type: Number },
      total: { type: Number }
    },
    demandLevel: {
      type: String,
      enum: ['VERY_LOW', 'LOW', 'NORMAL', 'HIGH', 'VERY_HIGH', 'PEAK']
    },
    lastCalculated: {
      type: Date,
      default: Date.now
    }
  }],

  // Yield Management Analytics
  yieldAnalytics: {
    lastYieldUpdate: {
      type: Date
    },
    averageOccupancyRate: {
      type: Number,
      min: [0, 'Le taux d\'occupation ne peut pas être négatif'],
      max: [100, 'Le taux d\'occupation ne peut pas dépasser 100%']
    },
    revPAR: { // Revenue per Available Room
      type: Number,
      min: [0, 'Le RevPAR ne peut pas être négatif']
    },
    adr: { // Average Daily Rate
      type: Number,
      min: [0, 'L\'ADR ne peut pas être négatif']
    },
    performanceMetrics: {
      revenueVsTarget: {
        type: Number // Percentage of target achieved
      },
      priceOptimizationScore: {
        type: Number,
        min: [0, 'Le score ne peut pas être négatif'],
        max: [100, 'Le score ne peut pas dépasser 100']
      },
      demandForecastAccuracy: {
        type: Number,
        min: [0, 'La précision ne peut pas être négative'],
        max: [100, 'La précision ne peut pas dépasser 100%']
      }
    }
  },

  // Pricing Rules References (link to PricingRule collection)
  activePricingRules: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PricingRule'
  }],

  // Historical pricing data for analysis
  pricingHistory: [{
    date: {
      type: Date,
      required: true
    },
    roomType: {
      type: String,
      required: true,
      enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE']
    },
    originalPrice: {
      type: Number,
      required: true
    },
    finalPrice: {
      type: Number,
      required: true
    },
    bookingsReceived: {
      type: Number,
      default: 0
    },
    revenue: {
      type: Number,
      default: 0
    },
    occupancyRate: {
      type: Number,
      min: 0,
      max: 100
    }
  }]

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE (including new yield management indexes)
// ============================================================================

hotelSchema.index({ code: 1 }, { unique: true });
hotelSchema.index({ 'address.city': 1 });
hotelSchema.index({ stars: 1 });
hotelSchema.index({ isActive: 1, isPublished: 1 });
hotelSchema.index({ 'address.coordinates.latitude': 1, 'address.coordinates.longitude': 1 });
hotelSchema.index({ createdAt: -1 });

// Index composé pour recherche géographique
hotelSchema.index({ 
  'address.city': 'text', 
  'name': 'text', 
  'description': 'text' 
});

// New indexes for yield management
hotelSchema.index({ 'yieldManagement.enabled': 1 });
hotelSchema.index({ 'dynamicPricingCalendar.date': 1, 'dynamicPricingCalendar.roomType': 1 });
hotelSchema.index({ 'pricingHistory.date': 1 });
hotelSchema.index({ 'yieldAnalytics.lastYieldUpdate': 1 });

// ============================================================================
// VIRTUALS (existing + new yield management virtuals)
// ============================================================================

// Adresse complète formatée
hotelSchema.virtual('fullAddress').get(function() {
  const addr = this.address;
  return `${addr.street}, ${addr.postalCode} ${addr.city}, ${addr.country}`;
});

// URL Google Maps pour navigation
hotelSchema.virtual('googleMapsUrl').get(function() {
  if (this.address.coordinates.latitude && this.address.coordinates.longitude) {
    return `https://maps.google.com/?q=${this.address.coordinates.latitude},${this.address.coordinates.longitude}`;
  }
  return `https://maps.google.com/?q=${encodeURIComponent(this.fullAddress)}`;
});

// Taux d'occupation virtuel (calculé via populate)
hotelSchema.virtual('occupancyRate').get(function() {
  if (this.stats.totalRooms === 0) return 0;
  // Cette valeur sera calculée dynamiquement avec les réservations
  return this.yieldAnalytics?.averageOccupancyRate || 0;
});

// Image principale
hotelSchema.virtual('primaryImage').get(function() {
  const primaryImg = this.images.find(img => img.isPrimary);
  return primaryImg || this.images[0] || null;
});

// Relation virtuelle avec les chambres
hotelSchema.virtual('rooms', {
  ref: 'Room',
  localField: '_id',
  foreignField: 'hotel'
});

// Relation virtuelle avec les réservations
hotelSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'hotel'
});

// NEW YIELD MANAGEMENT VIRTUALS

// Check if yield management is properly configured
hotelSchema.virtual('isYieldManagementReady').get(function() {
  return this.yieldManagement?.enabled && 
         this.yieldManagement?.basePricing?.SIMPLE > 0 &&
         this.yieldManagement?.strategy != null;
});

// Get current demand level based on occupancy
hotelSchema.virtual('currentDemandLevel').get(function() {
  const occupancy = this.yieldAnalytics?.averageOccupancyRate || 0;
  const thresholds = this.yieldManagement?.occupancyThresholds;
  
  if (!thresholds) return 'NORMAL';
  
  if (occupancy >= thresholds.critical.min) return 'CRITICAL';
  if (occupancy >= thresholds.veryHigh.min) return 'VERY_HIGH';
  if (occupancy >= thresholds.high.min) return 'HIGH';
  if (occupancy >= thresholds.moderate.min) return 'MODERATE';
  if (occupancy >= thresholds.low.min) return 'LOW';
  return 'VERY_LOW';
});

// Check if pricing calendar needs update
hotelSchema.virtual('needsPricingUpdate').get(function() {
  if (!this.yieldManagement?.enabled) return false;
  
  const lastUpdate = this.yieldAnalytics?.lastYieldUpdate;
  if (!lastUpdate) return true;
  
  const updateFrequency = this.yieldManagement?.automationSettings?.updateFrequency;
  const now = new Date();
  const hoursSinceUpdate = (now - lastUpdate) / (1000 * 60 * 60);
  
  switch (updateFrequency) {
    case 'HOURLY': return hoursSinceUpdate >= 1;
    case 'DAILY': return hoursSinceUpdate >= 24;
    case 'WEEKLY': return hoursSinceUpdate >= 168;
    default: return false;
  }
});

// ============================================================================
// MIDDLEWARE (existing + new yield management middleware)
// ============================================================================

// Validation d'une seule image primaire
hotelSchema.pre('save', function(next) {
  const primaryImages = this.images.filter(img => img.isPrimary);
  
  if (primaryImages.length > 1) {
    // Garde seulement la première image primaire
    this.images.forEach((img, index) => {
      if (index > 0) img.isPrimary = false;
    });
  } else if (primaryImages.length === 0 && this.images.length > 0) {
    // Si aucune image primaire, définit la première comme primaire
    this.images[0].isPrimary = true;
  }
  
  next();
});

// Validation des dates de saison
hotelSchema.pre('save', function(next) {
  for (const season of this.seasonalPricing) {
    if (season.startDate >= season.endDate) {
      return next(new Error('La date de début de saison doit être antérieure à la date de fin'));
    }
  }
  next();
});

// NEW: Validate yield management configuration
hotelSchema.pre('save', function(next) {
  if (this.yieldManagement?.enabled) {
    // Validate base pricing
    const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];
    for (const type of roomTypes) {
      if (!this.yieldManagement.basePricing[type] || this.yieldManagement.basePricing[type] <= 0) {
        return next(new Error(`Prix de base requis pour le type de chambre ${type} lorsque le yield management est activé`));
      }
      
      // Validate price constraints
      const constraints = this.yieldManagement.priceConstraints[type];
      if (constraints?.min && constraints?.max && constraints.min >= constraints.max) {
        return next(new Error(`Le prix minimum doit être inférieur au prix maximum pour ${type}`));
      }
    }
    
    // Validate lead time pricing
    if (this.yieldManagement.leadTimePricing?.length > 0) {
      this.yieldManagement.leadTimePricing.sort((a, b) => a.daysInAdvance - b.daysInAdvance);
    }
    
    // Validate length of stay discounts
    if (this.yieldManagement.lengthOfStayDiscounts?.length > 0) {
      for (const discount of this.yieldManagement.lengthOfStayDiscounts) {
        if (discount.maxNights && discount.maxNights < discount.minNights) {
          return next(new Error('Le maximum de nuits doit être supérieur au minimum'));
        }
      }
    }
    
    // Validate event pricing dates
    if (this.yieldManagement.eventPricing?.length > 0) {
      for (const event of this.yieldManagement.eventPricing) {
        if (event.startDate >= event.endDate) {
          return next(new Error(`Les dates de l'événement ${event.eventName} sont invalides`));
        }
      }
    }
  }
  
  next();
});

// NEW: Initialize yield analytics if enabling yield management
hotelSchema.pre('save', function(next) {
  if (this.isModified('yieldManagement.enabled') && this.yieldManagement.enabled && !this.yieldAnalytics) {
    this.yieldAnalytics = {
      averageOccupancyRate: 0,
      revPAR: 0,
      adr: 0,
      performanceMetrics: {
        revenueVsTarget: 0,
        priceOptimizationScore: 50,
        demandForecastAccuracy: 70
      }
    };
  }
  next();
});

// ============================================================================
// MÉTHODES D'INSTANCE (existing + new yield management methods)
// ============================================================================

// Obtenir le multiplicateur de prix selon la date (EXISTING - kept for backward compatibility)
hotelSchema.methods.getPriceMultiplier = function(date = new Date()) {
  const targetDate = new Date(date);
  
  for (const season of this.seasonalPricing) {
    const startDate = new Date(season.startDate);
    const endDate = new Date(season.endDate);
    
    // Comparaison par mois/jour pour les saisons récurrentes
    const targetMonth = targetDate.getMonth();
    const targetDay = targetDate.getDate();
    const startMonth = startDate.getMonth();
    const startDay = startDate.getDate();
    const endMonth = endDate.getMonth();
    const endDay = endDate.getDate();
    
    // Gestion des saisons qui chevauchent l'année
    if (startMonth > endMonth || (startMonth === endMonth && startDay > endDay)) {
      // Saison qui traverse l'année (ex: Dec-Jan)
      if (targetMonth > startMonth || targetMonth < endMonth ||
          (targetMonth === startMonth && targetDay >= startDay) ||
          (targetMonth === endMonth && targetDay <= endDay)) {
        return season.multiplier;
      }
    } else {
      // Saison normale dans la même année
      if ((targetMonth > startMonth || (targetMonth === startMonth && targetDay >= startDay)) &&
          (targetMonth < endMonth || (targetMonth === endMonth && targetDay <= endDay))) {
        return season.multiplier;
      }
    }
  }
  
  return 1.0; // Prix normal si aucune saison ne correspond
};

// NEW: Get dynamic price for a room type and date using yield management
hotelSchema.methods.getDynamicPrice = async function(roomType, checkInDate, checkOutDate = null) {
  if (!this.yieldManagement?.enabled) {
    // Fallback to base price with seasonal multiplier
    const basePrice = this.yieldManagement?.basePricing?.[roomType] || 100;
    return basePrice * this.getPriceMultiplier(checkInDate);
  }
  
  try {
    // Check if we have a recent calculation in the calendar
    const calendarEntry = this.dynamicPricingCalendar.find(entry => 
      entry.roomType === roomType && 
      entry.date.toDateString() === checkInDate.toDateString() &&
      (Date.now() - entry.lastCalculated) < 3600000 // 1 hour cache
    );
    
    if (calendarEntry) {
      return calendarEntry.calculatedPrice;
    }
    
    // Calculate new dynamic price
    const basePrice = this.yieldManagement.basePricing[roomType];
    let price = basePrice;
    let factors = {
      occupancy: 1.0,
      seasonal: 1.0,
      dayOfWeek: 1.0,
      event: 1.0,
      weather: 1.0,
      competitor: 1.0,
      leadTime: 1.0,
      lengthOfStay: 1.0
    };
    
    // 1. Occupancy factor
    const occupancyRate = await this.calculateOccupancyForDate(checkInDate);
    factors.occupancy = this.getOccupancyMultiplier(occupancyRate);
    
    // 2. Seasonal factor
    factors.seasonal = this.getPriceMultiplier(checkInDate);
    
    // 3. Day of week factor
    const dayOfWeek = checkInDate.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    factors.dayOfWeek = this.yieldManagement.dayOfWeekMultipliers?.[dayOfWeek] || 1.0;
    
    // 4. Event factor
    factors.event = this.getEventMultiplier(checkInDate);
    
    // 5. Lead time factor
    const daysInAdvance = Math.ceil((checkInDate - new Date()) / (1000 * 60 * 60 * 24));
    factors.leadTime = this.getLeadTimeMultiplier(daysInAdvance);
    
    // 6. Length of stay factor (if checkOutDate provided)
    if (checkOutDate) {
      const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
      factors.lengthOfStay = this.getLengthOfStayMultiplier(nights);
    }
    
    // 7. Weather factor (if enabled)
    if (this.yieldManagement.weatherImpact?.enabled) {
      factors.weather = await this.getWeatherMultiplier(checkInDate);
    }
    
    // 8. Competitor factor (if enabled)
    if (this.yieldManagement.competitorPricing?.enabled) {
      factors.competitor = await this.getCompetitorMultiplier(roomType);
    }
    
    // Apply all factors based on strategy
    factors.total = this.applyPricingStrategy(factors);
    price = basePrice * factors.total;
    
    // Apply constraints
    const constraints = this.yieldManagement.priceConstraints?.[roomType];
    if (constraints) {
      if (constraints.min && price < constraints.min) price = constraints.min;
      if (constraints.max && price > constraints.max) price = constraints.max;
    }
    
    // Determine demand level
    const demandLevel = this.calculateDemandLevel(factors);
    
    // Save to calendar for caching
    this.updateDynamicPricingCalendar(checkInDate, roomType, basePrice, price, factors, demandLevel);
    
    return Math.round(price * 100) / 100;
    
  } catch (error) {
    console.error('Error calculating dynamic price:', error);
    // Fallback to base price
    return this.yieldManagement.basePricing[roomType] || 100;
  }
};

// NEW: Apply pricing strategy to factors
hotelSchema.methods.applyPricingStrategy = function(factors) {
  const strategy = this.yieldManagement.strategy;
  let weights = {};
  
  switch (strategy) {
    case 'CONSERVATIVE':
      weights = {
        occupancy: 0.4,
        seasonal: 0.2,
        dayOfWeek: 0.1,
        event: 0.1,
        leadTime: 0.1,
        competitor: 0.05,
        other: 0.05
      };
      break;
    case 'AGGRESSIVE':
      weights = {
        occupancy: 0.5,
        seasonal: 0.15,
        dayOfWeek: 0.1,
        event: 0.1,
        leadTime: 0.05,
        competitor: 0.05,
        other: 0.05
      };
      break;
    default: // MODERATE
      weights = {
        occupancy: 0.3,
        seasonal: 0.2,
        dayOfWeek: 0.15,
        event: 0.15,
        leadTime: 0.1,
        competitor: 0.05,
        other: 0.05
      };
  }
  
  // Calculate weighted average
  let totalMultiplier = 0;
  totalMultiplier += factors.occupancy * weights.occupancy;
  totalMultiplier += factors.seasonal * weights.seasonal;
  totalMultiplier += factors.dayOfWeek * weights.dayOfWeek;
  totalMultiplier += factors.event * weights.event;
  totalMultiplier += factors.leadTime * weights.leadTime;
  totalMultiplier += factors.competitor * weights.competitor;
  totalMultiplier += ((factors.weather || 1) * (factors.lengthOfStay || 1)) * weights.other;
  
  return totalMultiplier;
};

// NEW: Get occupancy multiplier based on thresholds
hotelSchema.methods.getOccupancyMultiplier = function(occupancyRate) {
  const thresholds = this.yieldManagement.occupancyThresholds;
  
  if (occupancyRate <= thresholds.veryLow.max) {
    return thresholds.veryLow.priceMultiplier;
  } else if (occupancyRate >= thresholds.low.min && occupancyRate <= thresholds.low.max) {
    return thresholds.low.priceMultiplier;
  } else if (occupancyRate >= thresholds.moderate.min && occupancyRate <= thresholds.moderate.max) {
    return thresholds.moderate.priceMultiplier;
  } else if (occupancyRate >= thresholds.high.min && occupancyRate <= thresholds.high.max) {
    return thresholds.high.priceMultiplier;
  } else if (occupancyRate >= thresholds.veryHigh.min && occupancyRate <= thresholds.veryHigh.max) {
    return thresholds.veryHigh.priceMultiplier;
  } else if (occupancyRate >= thresholds.critical.min) {
    return thresholds.critical.priceMultiplier;
  }
  
  return 1.0;
};

// NEW: Get event multiplier
hotelSchema.methods.getEventMultiplier = function(date) {
  if (!this.yieldManagement.eventPricing || this.yieldManagement.eventPricing.length === 0) {
    return 1.0;
  }
  
  for (const event of this.yieldManagement.eventPricing) {
    let startDate = new Date(event.startDate);
    let endDate = new Date(event.endDate);
    
    if (event.isRecurring) {
      // Adjust year for recurring events
      const currentYear = date.getFullYear();
      startDate.setFullYear(currentYear);
      endDate.setFullYear(currentYear);
    }
    
    if (date >= startDate && date <= endDate) {
      return event.priceMultiplier;
    }
  }
  
  return 1.0;
};

// NEW: Get lead time multiplier
hotelSchema.methods.getLeadTimeMultiplier = function(daysInAdvance) {
  if (!this.yieldManagement.leadTimePricing || this.yieldManagement.leadTimePricing.length === 0) {
    return 1.0;
  }
  
  // Find the appropriate lead time tier
  for (let i = this.yieldManagement.leadTimePricing.length - 1; i >= 0; i--) {
    if (daysInAdvance >= this.yieldManagement.leadTimePricing[i].daysInAdvance) {
      return this.yieldManagement.leadTimePricing[i].multiplier;
    }
  }
  
  return 1.0;
};

// NEW: Get length of stay multiplier
hotelSchema.methods.getLengthOfStayMultiplier = function(nights) {
  if (!this.yieldManagement.lengthOfStayDiscounts || this.yieldManagement.lengthOfStayDiscounts.length === 0) {
    return 1.0;
  }
  
  for (const discount of this.yieldManagement.lengthOfStayDiscounts) {
    if (nights >= discount.minNights && (!discount.maxNights || nights <= discount.maxNights)) {
      return 1 - (discount.discountPercentage / 100);
    }
  }
  
  return 1.0;
};

// NEW: Calculate occupancy for a specific date
hotelSchema.methods.calculateOccupancyForDate = async function(date) {
  const Booking = mongoose.model('Booking');
  const Room = mongoose.model('Room');
  
  const totalRooms = await Room.countDocuments({ hotel: this._id, isActive: true });
  
  const bookings = await Booking.countDocuments({
    hotel: this._id,
    status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
    checkIn: { $lte: date },
    checkOut: { $gt: date }
  });
  
  return totalRooms > 0 ? (bookings / totalRooms) * 100 : 0;
};

// NEW: Get weather multiplier (placeholder - integrate with weather API)
hotelSchema.methods.getWeatherMultiplier = async function(date) {
  // This would integrate with a weather API in production
  // For now, return default
  return 1.0;
};

// NEW: Get competitor multiplier (placeholder - integrate with competitor data)
hotelSchema.methods.getCompetitorMultiplier = async function(roomType) {
  // This would integrate with competitor pricing APIs in production
  // For now, return default
  return 1.0;
};

// NEW: Calculate demand level based on factors
hotelSchema.methods.calculateDemandLevel = function(factors) {
  const avgFactor = factors.total || 1.0;
  
  if (avgFactor >= 1.5) return 'PEAK';
  if (avgFactor >= 1.3) return 'VERY_HIGH';
  if (avgFactor >= 1.1) return 'HIGH';
  if (avgFactor >= 0.9) return 'NORMAL';
  if (avgFactor >= 0.7) return 'LOW';
  return 'VERY_LOW';
};

// NEW: Update dynamic pricing calendar
hotelSchema.methods.updateDynamicPricingCalendar = function(date, roomType, basePrice, calculatedPrice, factors, demandLevel) {
  const existingIndex = this.dynamicPricingCalendar.findIndex(entry => 
    entry.date.toDateString() === date.toDateString() && 
    entry.roomType === roomType
  );
  
  const calendarEntry = {
    date,
    roomType,
    basePrice,
    calculatedPrice,
    factors,
    demandLevel,
    lastCalculated: new Date()
  };
  
  if (existingIndex >= 0) {
    this.dynamicPricingCalendar[existingIndex] = calendarEntry;
  } else {
    this.dynamicPricingCalendar.push(calendarEntry);
  }
  
  // Keep only last 90 days of calendar data
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
  this.dynamicPricingCalendar = this.dynamicPricingCalendar.filter(entry => entry.date >= ninetyDaysAgo);
};

// NEW: Update yield analytics
hotelSchema.methods.updateYieldAnalytics = async function() {
  const Booking = mongoose.model('Booking');
  const Room = mongoose.model('Room');
  
  try {
    // Calculate average occupancy rate (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const totalRooms = await Room.countDocuments({ hotel: this._id, isActive: true });
    const totalRoomNights = totalRooms * 30;
    
    const bookings = await Booking.find({
      hotel: this._id,
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      checkIn: { $gte: thirtyDaysAgo }
    });
    
    let occupiedRoomNights = 0;
    let totalRevenue = 0;
    
    bookings.forEach(booking => {
      const nights = Math.ceil((booking.checkOut - booking.checkIn) / (1000 * 60 * 60 * 24));
      occupiedRoomNights += booking.rooms.length * nights;
      totalRevenue += booking.pricing.totalPrice;
    });
    
    // Update analytics
    this.yieldAnalytics.averageOccupancyRate = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0;
    this.yieldAnalytics.revPAR = totalRoomNights > 0 ? totalRevenue / totalRoomNights : 0;
    this.yieldAnalytics.adr = occupiedRoomNights > 0 ? totalRevenue / occupiedRoomNights : 0;
    this.yieldAnalytics.lastYieldUpdate = new Date();
    
    // Update performance metrics
    if (this.yieldManagement.revenueTargets?.monthly) {
      this.yieldAnalytics.performanceMetrics.revenueVsTarget = 
        (totalRevenue / this.yieldManagement.revenueTargets.monthly) * 100;
    }
    
    await this.save();
    
  } catch (error) {
    console.error('Error updating yield analytics:', error);
  }
};

// NEW: Get pricing recommendations
hotelSchema.methods.getPricingRecommendations = async function() {
  const recommendations = [];
  
  if (!this.yieldManagement?.enabled) {
    recommendations.push({
      type: 'ENABLE_YIELD',
      priority: 'HIGH',
      message: 'Activez le yield management pour optimiser vos revenus',
      impact: 'Augmentation potentielle de 15-25% du RevPAR'
    });
    return recommendations;
  }
  
  // Check occupancy levels
  const occupancy = this.yieldAnalytics?.averageOccupancyRate || 0;
  if (occupancy < 50) {
    recommendations.push({
      type: 'LOW_OCCUPANCY',
      priority: 'HIGH',
      message: 'Taux d\'occupation faible détecté',
      action: 'Envisagez des promotions ou réductions de prix',
      impact: 'Augmentation potentielle de l\'occupation de 10-20%'
    });
  } else if (occupancy > 90) {
    recommendations.push({
      type: 'HIGH_OCCUPANCY',
      priority: 'MEDIUM',
      message: 'Taux d\'occupation très élevé',
      action: 'Augmentez les prix pour maximiser les revenus',
      impact: 'Augmentation potentielle du RevPAR de 5-15%'
    });
  }
  
  // Check pricing strategy
  if (this.yieldManagement.strategy === 'CONSERVATIVE' && occupancy > 70) {
    recommendations.push({
      type: 'STRATEGY_ADJUSTMENT',
      priority: 'MEDIUM',
      message: 'Stratégie conservative avec forte demande',
      action: 'Passez à une stratégie MODERATE ou AGGRESSIVE',
      impact: 'Meilleure réactivité aux conditions du marché'
    });
  }
  
  return recommendations;
};

// EXISTING METHODS (kept for backward compatibility)

// Ajouter un membre du personnel
hotelSchema.methods.addStaffMember = function(userId, position) {
  // Vérifier si l'utilisateur n'est pas déjà dans le personnel
  const existingStaff = this.staff.find(s => s.user.toString() === userId.toString());
  if (existingStaff) {
    throw new Error('Cet utilisateur fait déjà partie du personnel');
  }
  
  this.staff.push({
    user: userId,
    position: position,
    startDate: new Date()
  });
  
  return this.save();
};

// Supprimer un membre du personnel
hotelSchema.methods.removeStaffMember = function(userId) {
  this.staff = this.staff.filter(s => s.user.toString() !== userId.toString());
  return this.save();
};

// Mettre à jour les statistiques
hotelSchema.methods.updateStats = async function() {
  const Room = mongoose.model('Room');
  const Booking = mongoose.model('Booking');
  
  // Compter les chambres
  const roomCount = await Room.countDocuments({ hotel: this._id });
  
  // Compter les réservations
  const bookingCount = await Booking.countDocuments({ hotel: this._id });
  
  // Calculer la note moyenne (à implémenter avec le système de reviews)
  // const avgRating = await Review.aggregate([...]);
  
  this.stats.totalRooms = roomCount;
  this.stats.totalBookings = bookingCount;
  
  // Update yield analytics if enabled
  if (this.yieldManagement?.enabled) {
    await this.updateYieldAnalytics();
  }
  
  return this.save();
};

// Vérifier la disponibilité générale
hotelSchema.methods.checkAvailability = async function(checkIn, checkOut, roomType = null) {
  const Room = mongoose.model('Room');
  const Booking = mongoose.model('Booking');
  
  const query = { 
    hotel: this._id,
    status: 'AVAILABLE'
  };
  
  if (roomType) {
    query.type = roomType;
  }
  
  const availableRooms = await Room.find(query);
  
  // Vérifier les conflits de réservation
  const conflictingBookings = await Booking.find({
    hotel: this._id,
    status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
    $or: [
      {
        checkIn: { $lt: new Date(checkOut) },
        checkOut: { $gt: new Date(checkIn) }
      }
    ]
  }).populate('rooms');
  
  // Filtrer les chambres non réservées
  const bookedRoomIds = conflictingBookings.reduce((acc, booking) => {
    booking.rooms.forEach(room => acc.add(room._id.toString()));
    return acc;
  }, new Set());
  
  return availableRooms.filter(room => !bookedRoomIds.has(room._id.toString()));
};

// ============================================================================
// MÉTHODES STATIQUES (existing + new yield management methods)
// ============================================================================

// Recherche d'hôtels avec filtres
hotelSchema.statics.searchHotels = function(filters = {}) {
  const query = { isActive: true, isPublished: true };
  
  if (filters.city) {
    query['address.city'] = new RegExp(filters.city, 'i');
  }
  
  if (filters.stars) {
    query.stars = { $gte: filters.stars };
  }
  
  if (filters.amenities && filters.amenities.length > 0) {
    query.amenities = { $in: filters.amenities };
  }
  
  return this.find(query)
    .populate('manager', 'firstName lastName email')
    .sort({ stars: -1, 'stats.averageRating': -1 });
};

// Statistiques globales des hôtels
hotelSchema.statics.getGlobalStats = function() {
  return this.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: null,
        totalHotels: { $sum: 1 },
        totalRooms: { $sum: '$stats.totalRooms' },
        avgStars: { $avg: '$stars' },
        avgRating: { $avg: '$stats.averageRating' },
        totalBookings: { $sum: '$stats.totalBookings' },
        hotelsWithYield: { 
          $sum: { $cond: ['$yieldManagement.enabled', 1, 0] } 
        }
      }
    }
  ]);
};

// Hôtels par ville
hotelSchema.statics.getHotelsByCity = function() {
  return this.aggregate([
    { $match: { isActive: true, isPublished: true } },
    { 
      $group: { 
        _id: '$address.city', 
        count: { $sum: 1 },
        avgStars: { $avg: '$stars' }
      } 
    },
    { $sort: { count: -1 } }
  ]);
};

// NEW: Get hotels needing yield update
hotelSchema.statics.getHotelsNeedingYieldUpdate = function() {
  const oneHourAgo = new Date(Date.now() - 3600000);
  const oneDayAgo = new Date(Date.now() - 86400000);
  const oneWeekAgo = new Date(Date.now() - 604800000);
  
  return this.find({
    'yieldManagement.enabled': true,
    $or: [
      {
        'yieldManagement.automationSettings.updateFrequency': 'HOURLY',
        'yieldAnalytics.lastYieldUpdate': { $lt: oneHourAgo }
      },
      {
        'yieldManagement.automationSettings.updateFrequency': 'DAILY',
        'yieldAnalytics.lastYieldUpdate': { $lt: oneDayAgo }
      },
      {
        'yieldManagement.automationSettings.updateFrequency': 'WEEKLY',
        'yieldAnalytics.lastYieldUpdate': { $lt: oneWeekAgo }
      },
      {
        'yieldAnalytics.lastYieldUpdate': { $exists: false }
      }
    ]
  });
};

// NEW: Get yield management performance across hotels
hotelSchema.statics.getYieldPerformance = function() {
  return this.aggregate([
    { 
      $match: { 
        isActive: true,
        'yieldManagement.enabled': true 
      } 
    },
    {
      $group: {
        _id: '$yieldManagement.strategy',
        count: { $sum: 1 },
        avgOccupancy: { $avg: '$yieldAnalytics.averageOccupancyRate' },
        avgRevPAR: { $avg: '$yieldAnalytics.revPAR' },
        avgADR: { $avg: '$yieldAnalytics.adr' },
        avgRevenueVsTarget: { $avg: '$yieldAnalytics.performanceMetrics.revenueVsTarget' }
      }
    },
    { $sort: { avgRevPAR: -1 } }
  ]);
};

// NEW: Clean up old pricing history
hotelSchema.statics.cleanupPricingHistory = async function(daysToKeep = 365) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
  
  const result = await this.updateMany(
    {},
    {
      $pull: {
        pricingHistory: {
          date: { $lt: cutoffDate }
        },
        dynamicPricingCalendar: {
          date: { $lt: cutoffDate }
        }
      }
    }
  );
  
  return result;
};

// ============================================================================
// EXPORT
// ============================================================================

const Hotel = mongoose.model('Hotel', hotelSchema);

module.exports = Hotel;