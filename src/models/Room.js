const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
  // ============================================================================
  // EXISTING FIELDS - PRESERVED AS-IS
  // ============================================================================
  
  // Identification unique de la chambre
  number: {
    type: String,
    required: [true, 'Le numéro de chambre est requis'],
    trim: true,
    maxlength: [10, 'Le numéro de chambre ne peut pas dépasser 10 caractères'],
    match: [/^[A-Z0-9-]+$/i, 'Le numéro de chambre ne peut contenir que des lettres, chiffres et tirets']
  },

  // Étage de la chambre
  floor: {
    type: Number,
    required: [true, 'L\'étage est requis'],
    min: [0, 'L\'étage ne peut pas être négatif'],
    max: [50, 'L\'étage ne peut pas dépasser 50']
  },

  // Types de chambres selon le cahier des charges
  type: {
    type: String,
    required: [true, 'Le type de chambre est requis'],
    enum: {
      values: ['Simple', 'Double', 'Double Confort', 'Suite'],
      message: 'Le type de chambre doit être Simple, Double, Double Confort ou Suite'
    }
  },

  // Référence à l'hôtel
  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: [true, 'L\'hôtel de référence est requis']
  },

  // Prix de base de la chambre (avant multiplicateurs saisonniers)
  basePrice: {
    type: Number,
    required: [true, 'Le prix de base est requis'],
    min: [0, 'Le prix ne peut pas être négatif'],
    validate: {
      validator: function(value) {
        return value > 0;
      },
      message: 'Le prix de base doit être supérieur à 0'
    }
  },

  // Capacité selon le type de chambre
  capacity: {
    adults: {
      type: Number,
      required: [true, 'Le nombre d\'adultes est requis'],
      min: [1, 'Au moins 1 adulte'],
      max: [8, 'Maximum 8 adultes']
    },
    children: {
      type: Number,
      default: 0,
      min: [0, 'Le nombre d\'enfants ne peut pas être négatif'],
      max: [4, 'Maximum 4 enfants']
    }
  },

  // Dimensions de la chambre
  area: {
    type: Number,
    min: [10, 'La superficie minimum est de 10m²'],
    max: [200, 'La superficie maximum est de 200m²']
  },

  // Équipements spécifiques de la chambre
  amenities: [{
    type: String,
    enum: [
      // Équipements de base
      'Climatisation', 'Chauffage', 'WiFi gratuit', 'Télévision',
      'Téléphone', 'Coffre-fort', 'Mini-bar', 'Réfrigérateur',
      
      // Salle de bain
      'Salle de bain privée', 'Douche', 'Baignoire', 'Sèche-cheveux',
      'Articles de toilette gratuits',
      
      // Confort
      'Balcon', 'Terrasse', 'Vue sur mer', 'Vue sur montagne', 'Vue sur ville',
      'Insonorisation', 'Moquette', 'Parquet',
      
      // Services
      'Room service', 'Service de ménage quotidien', 'Linge de lit premium',
      'Peignoirs', 'Chaussons',
      
      // Suite spécifique
      'Salon séparé', 'Cuisine équipée', 'Jacuzzi', 'Cheminée'
    ]
  }],

  // Images de la chambre
  images: [{
    url: {
      type: String,
      required: true,
      match: [/^https?:\/\/.+\.(jpg|jpeg|png|webp)$/i, 'URL d\'image invalide']
    },
    alt: {
      type: String,
      default: 'Image de la chambre'
    },
    isPrimary: {
      type: Boolean,
      default: false
    }
  }],

  // Statut de la chambre
  status: {
    type: String,
    enum: {
      values: ['AVAILABLE', 'OCCUPIED', 'MAINTENANCE', 'OUT_OF_ORDER', 'CLEANING'],
      message: 'Statut invalide'
    },
    default: 'AVAILABLE'
  },

  // Informations de maintenance
  maintenance: {
    lastCleaning: {
      type: Date,
      default: Date.now
    },
    lastMaintenance: {
      type: Date
    },
    nextMaintenance: {
      type: Date
    },
    notes: [{
      date: {
        type: Date,
        default: Date.now
      },
      type: {
        type: String,
        enum: ['CLEANING', 'REPAIR', 'INSPECTION', 'UPGRADE'],
        required: true
      },
      description: {
        type: String,
        required: true,
        maxlength: [500, 'La description ne peut pas dépasser 500 caractères']
      },
      technician: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      cost: {
        type: Number,
        min: [0, 'Le coût ne peut pas être négatif']
      },
      completed: {
        type: Boolean,
        default: false
      }
    }]
  },

  // Configuration des tarifs spéciaux pour cette chambre
  specialPricing: [{
    name: {
      type: String,
      required: true,
      maxlength: [50, 'Le nom ne peut pas dépasser 50 caractères']
    },
    startDate: {
      type: Date,
      required: true
    },
    endDate: {
      type: Date,
      required: true
    },
    priceOverride: {
      type: Number,
      min: [0, 'Le prix ne peut pas être négatif']
    },
    multiplier: {
      type: Number,
      min: [0.1, 'Le multiplicateur minimum est 0.1'],
      max: [5.0, 'Le multiplicateur maximum est 5.0']
    },
    reason: {
      type: String,
      enum: ['PROMOTION', 'EVENT', 'RENOVATION', 'VIP'],
      required: true
    }
  }],

  // Statistiques de la chambre
  stats: {
    totalBookings: {
      type: Number,
      default: 0
    },
    totalRevenue: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 0,
      min: [0, 'La note ne peut pas être négative'],
      max: [5, 'La note ne peut pas dépasser 5']
    },
    occupancyRate: {
      type: Number,
      default: 0,
      min: [0, 'Le taux d\'occupation ne peut pas être négatif'],
      max: [100, 'Le taux d\'occupation ne peut pas dépasser 100%']
    }
  },

  // ============================================================================
  // NEW YIELD MANAGEMENT FIELDS - WEEK 3
  // ============================================================================

  // Yield Management Configuration
  yieldManagement: {
    // Enable/disable yield management for this specific room
    enabled: {
      type: Boolean,
      default: false
    },
    
    // Override hotel-level settings
    useHotelSettings: {
      type: Boolean,
      default: true
    },
    
    // Minimum and maximum price constraints for this room
    priceConstraints: {
      minPrice: {
        type: Number,
        min: [0, 'Le prix minimum ne peut pas être négatif']
      },
      maxPrice: {
        type: Number,
        min: [0, 'Le prix maximum ne peut pas être négatif']
      },
      // Prevent price changes beyond these percentages
      maxDailyIncrease: {
        type: Number,
        default: 30, // 30% max increase per day
        min: [0, 'L\'augmentation maximum doit être positive'],
        max: [100, 'L\'augmentation maximum ne peut pas dépasser 100%']
      },
      maxDailyDecrease: {
        type: Number,
        default: 40, // 40% max decrease per day
        min: [0, 'La diminution maximum doit être positive'],
        max: [100, 'La diminution maximum ne peut pas dépasser 100%']
      }
    },
    
    // Room-specific demand factors
    demandFactors: {
      // Premium for specific features
      viewPremium: {
        type: Number,
        default: 0, // Percentage premium for view
        min: [0, 'Le premium ne peut pas être négatif'],
        max: [50, 'Le premium ne peut pas dépasser 50%']
      },
      floorPremium: {
        type: Number,
        default: 0, // Percentage premium per floor
        min: [-10, 'La réduction maximum est -10%'],
        max: [20, 'Le premium ne peut pas dépasser 20%']
      },
      quietnessPremium: {
        type: Number,
        default: 0, // Premium for quiet rooms
        min: [0, 'Le premium ne peut pas être négatif'],
        max: [30, 'Le premium ne peut pas dépasser 30%']
      }
    },
    
    // Performance metrics for yield optimization
    performanceMetrics: {
      averageBookingLeadTime: {
        type: Number,
        default: 0 // Days in advance bookings are made
      },
      priceElasticity: {
        type: Number,
        default: 1.0, // How sensitive demand is to price changes
        min: [0.1, 'L\'élasticité minimum est 0.1'],
        max: [3.0, 'L\'élasticité maximum est 3.0']
      },
      conversionRate: {
        type: Number,
        default: 0, // Percentage of views that convert to bookings
        min: [0, 'Le taux de conversion ne peut pas être négatif'],
        max: [100, 'Le taux de conversion ne peut pas dépasser 100%']
      },
      lastOptimizationScore: {
        type: Number,
        default: 0,
        min: [0, 'Le score ne peut pas être négatif'],
        max: [100, 'Le score ne peut pas dépasser 100']
      }
    },
    
    // Competitor pricing tracking
    competitorTracking: {
      enabled: {
        type: Boolean,
        default: false
      },
      competitorRoomId: {
        type: String // External ID for matching competitor room
      },
      lastCompetitorPrice: {
        type: Number
      },
      lastChecked: {
        type: Date
      },
      pricePosition: {
        type: String,
        enum: ['BELOW', 'MATCH', 'ABOVE'],
        default: 'MATCH'
      }
    }
  },

  // Dynamic Pricing History
  priceHistory: [{
    date: {
      type: Date,
      required: true
    },
    basePrice: {
      type: Number,
      required: true
    },
    dynamicPrice: {
      type: Number,
      required: true
    },
    factors: {
      seasonal: { type: Number, default: 1.0 },
      demand: { type: Number, default: 1.0 },
      dayOfWeek: { type: Number, default: 1.0 },
      leadTime: { type: Number, default: 1.0 },
      event: { type: Number, default: 1.0 },
      competitor: { type: Number, default: 1.0 },
      roomSpecific: { type: Number, default: 1.0 }
    },
    demandLevel: {
      type: String,
      enum: ['VERY_LOW', 'LOW', 'NORMAL', 'HIGH', 'VERY_HIGH', 'PEAK']
    },
    occupancyAtTime: {
      type: Number,
      min: [0, 'L\'occupation ne peut pas être négative'],
      max: [100, 'L\'occupation ne peut pas dépasser 100%']
    },
    source: {
      type: String,
      enum: ['MANUAL', 'AUTOMATED', 'RULE_BASED', 'AI_SUGGESTED'],
      required: true
    },
    appliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: {
      type: String,
      maxlength: [200, 'La raison ne peut pas dépasser 200 caractères']
    }
  }],

  // Current Dynamic Pricing
  currentDynamicPrice: {
    price: {
      type: Number
    },
    validFrom: {
      type: Date
    },
    validUntil: {
      type: Date
    },
    lastCalculated: {
      type: Date
    },
    nextRecalculation: {
      type: Date
    },
    approvalStatus: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_APPROVED'],
      default: 'PENDING'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },

  // Yield Optimization Suggestions
  yieldSuggestions: [{
    suggestedAt: {
      type: Date,
      default: Date.now
    },
    suggestedPrice: {
      type: Number,
      required: true
    },
    currentPrice: {
      type: Number,
      required: true
    },
    changePercentage: {
      type: Number,
      required: true
    },
    reason: {
      type: String,
      required: true
    },
    confidence: {
      type: Number,
      min: [0, 'La confiance ne peut pas être négative'],
      max: [100, 'La confiance ne peut pas dépasser 100%']
    },
    factors: {
      type: Map,
      of: Number
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPLIED', 'REJECTED', 'EXPIRED'],
      default: 'PENDING'
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reviewedAt: {
      type: Date
    },
    reviewNotes: {
      type: String,
      maxlength: [300, 'Les notes ne peuvent pas dépasser 300 caractères']
    }
  }],

  // Revenue Tracking for Yield Analysis
  revenueTracking: {
    daily: [{
      date: {
        type: Date,
        required: true
      },
      revenue: {
        type: Number,
        default: 0
      },
      bookings: {
        type: Number,
        default: 0
      },
      averageRate: {
        type: Number,
        default: 0
      },
      occupancy: {
        type: Boolean,
        default: false
      }
    }],
    
    // Monthly aggregates for trend analysis
    monthly: [{
      month: {
        type: Number,
        required: true,
        min: 1,
        max: 12
      },
      year: {
        type: Number,
        required: true
      },
      totalRevenue: {
        type: Number,
        default: 0
      },
      totalBookings: {
        type: Number,
        default: 0
      },
      averageRate: {
        type: Number,
        default: 0
      },
      occupancyRate: {
        type: Number,
        default: 0
      },
      revPAR: {
        type: Number,
        default: 0
      }
    }]
  },

  // ============================================================================
  // EXISTING FIELDS CONTINUED
  // ============================================================================

  // Métadonnées
  isActive: {
    type: Boolean,
    default: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE (including new yield management indexes)
// ============================================================================

// Existing indexes
roomSchema.index({ hotel: 1, number: 1 }, { unique: true });
roomSchema.index({ hotel: 1, type: 1 });
roomSchema.index({ hotel: 1, status: 1 });
roomSchema.index({ hotel: 1, floor: 1 });
roomSchema.index({ type: 1, basePrice: 1 });
roomSchema.index({ isActive: 1 });
roomSchema.index({ createdAt: -1 });
roomSchema.index({ amenities: 1 });

// New indexes for yield management
roomSchema.index({ 'yieldManagement.enabled': 1 });
roomSchema.index({ 'currentDynamicPrice.validFrom': 1, 'currentDynamicPrice.validUntil': 1 });
roomSchema.index({ 'priceHistory.date': -1 });
roomSchema.index({ 'yieldSuggestions.status': 1, 'yieldSuggestions.suggestedAt': -1 });
roomSchema.index({ 'revenueTracking.daily.date': -1 });

// ============================================================================
// VIRTUALS (existing + new yield management virtuals)
// ============================================================================

// Existing virtuals
roomSchema.virtual('fullName').get(function() {
  return `${this.type} ${this.number}`;
});

roomSchema.virtual('totalCapacity').get(function() {
  return this.capacity.adults + this.capacity.children;
});

roomSchema.virtual('primaryImage').get(function() {
  const primaryImg = this.images.find(img => img.isPrimary);
  return primaryImg || this.images[0] || null;
});

roomSchema.virtual('isInMaintenance').get(function() {
  return ['MAINTENANCE', 'OUT_OF_ORDER', 'CLEANING'].includes(this.status);
});

roomSchema.virtual('maintenanceDue').get(function() {
  if (!this.maintenance.nextMaintenance) return false;
  return new Date() >= this.maintenance.nextMaintenance;
});

roomSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'rooms'
});

// New yield management virtuals
roomSchema.virtual('currentPrice').get(function() {
  if (this.currentDynamicPrice?.price && 
      new Date() >= this.currentDynamicPrice.validFrom && 
      new Date() <= this.currentDynamicPrice.validUntil) {
    return this.currentDynamicPrice.price;
  }
  return this.basePrice;
});

roomSchema.virtual('hasActiveYieldSuggestion').get(function() {
  return this.yieldSuggestions.some(s => s.status === 'PENDING');
});

roomSchema.virtual('priceChangeFromBase').get(function() {
  const current = this.currentPrice;
  const base = this.basePrice;
  return base > 0 ? ((current - base) / base) * 100 : 0;
});

roomSchema.virtual('lastPriceUpdate').get(function() {
  if (this.priceHistory.length === 0) return null;
  return this.priceHistory[this.priceHistory.length - 1];
});

roomSchema.virtual('isYieldOptimized').get(function() {
  return this.yieldManagement?.enabled && 
         this.currentDynamicPrice?.approvalStatus === 'APPROVED' &&
         this.currentDynamicPrice?.validUntil > new Date();
});

// ============================================================================
// MIDDLEWARE (existing + new yield management middleware)
// ============================================================================

// Existing middleware preserved as-is
roomSchema.pre('save', function(next) {
  if (this.isNew || this.isModified('type')) {
    switch (this.type) {
      case 'Simple':
        this.capacity.adults = 1;
        this.capacity.children = 0;
        break;
      case 'Double':
        this.capacity.adults = 2;
        this.capacity.children = 1;
        break;
      case 'Double Confort':
        this.capacity.adults = 2;
        this.capacity.children = 2;
        break;
      case 'Suite':
        this.capacity.adults = 4;
        this.capacity.children = 2;
        break;
    }
  }
  next();
});

roomSchema.pre('save', function(next) {
  const primaryImages = this.images.filter(img => img.isPrimary);
  
  if (primaryImages.length > 1) {
    this.images.forEach((img, index) => {
      if (index > 0) img.isPrimary = false;
    });
  } else if (primaryImages.length === 0 && this.images.length > 0) {
    this.images[0].isPrimary = true;
  }
  
  next();
});

roomSchema.pre('save', function(next) {
  for (const pricing of this.specialPricing) {
    if (pricing.startDate >= pricing.endDate) {
      return next(new Error('La date de début doit être antérieure à la date de fin'));
    }
    
    if (pricing.priceOverride && pricing.multiplier) {
      return next(new Error('Utilisez soit priceOverride soit multiplier, pas les deux'));
    }
    
    if (!pricing.priceOverride && !pricing.multiplier) {
      pricing.multiplier = 1.0;
    }
  }
  next();
});

// New middleware for yield management
roomSchema.pre('save', function(next) {
  // Validate price constraints
  if (this.yieldManagement?.priceConstraints) {
    const constraints = this.yieldManagement.priceConstraints;
    
    if (constraints.minPrice && constraints.maxPrice && constraints.minPrice >= constraints.maxPrice) {
      return next(new Error('Le prix minimum doit être inférieur au prix maximum'));
    }
    
    if (constraints.minPrice && this.basePrice < constraints.minPrice) {
      return next(new Error('Le prix de base ne peut pas être inférieur au prix minimum'));
    }
    
    if (constraints.maxPrice && this.basePrice > constraints.maxPrice) {
      return next(new Error('Le prix de base ne peut pas être supérieur au prix maximum'));
    }
  }
  
  next();
});

// Clean up old price history entries
roomSchema.pre('save', function(next) {
  if (this.priceHistory.length > 365) {
    // Keep only last 365 days
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
    
    this.priceHistory = this.priceHistory.filter(entry => entry.date >= oneYearAgo);
  }
  
  // Similar cleanup for daily revenue tracking
  if (this.revenueTracking?.daily?.length > 90) {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    
    this.revenueTracking.daily = this.revenueTracking.daily.filter(entry => entry.date >= ninetyDaysAgo);
  }
  
  next();
});

// ============================================================================
// METHODS (existing + new yield management methods)
// ============================================================================

// Existing methods preserved as-is
roomSchema.methods.getPriceForDate = async function(date = new Date()) {
  // Check if yield management is enabled
  if (this.yieldManagement?.enabled && this.currentDynamicPrice?.price) {
    const checkDate = new Date(date);
    const validFrom = new Date(this.currentDynamicPrice.validFrom);
    const validUntil = new Date(this.currentDynamicPrice.validUntil);
    
    if (checkDate >= validFrom && checkDate <= validUntil) {
      return this.currentDynamicPrice.price;
    }
  }
  
  // Fall back to existing logic
  let finalPrice = this.basePrice;
  
  const targetDate = new Date(date);
  const specialPricing = this.specialPricing.find(pricing => 
    targetDate >= new Date(pricing.startDate) && 
    targetDate <= new Date(pricing.endDate)
  );
  
  if (specialPricing) {
    if (specialPricing.priceOverride) {
      return specialPricing.priceOverride;
    } else if (specialPricing.multiplier) {
      finalPrice *= specialPricing.multiplier;
    }
  } else {
    await this.populate('hotel');
    const seasonalMultiplier = this.hotel.getPriceMultiplier(date);
    finalPrice *= seasonalMultiplier;
  }
  
  return Math.round(finalPrice * 100) / 100;
};

roomSchema.methods.isAvailableForPeriod = async function(checkIn, checkOut) {
  if (this.status !== 'AVAILABLE') {
    return false;
  }
  
  const Booking = mongoose.model('Booking');
  
  const conflictingBookings = await Booking.countDocuments({
    rooms: this._id,
    status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
    $or: [
      {
        checkIn: { $lt: new Date(checkOut) },
        checkOut: { $gt: new Date(checkIn) }
      }
    ]
  });
  
  return conflictingBookings === 0;
};

roomSchema.methods.addMaintenanceNote = function(type, description, technicianId, cost = 0) {
  this.maintenance.notes.push({
    type,
    description,
    technician: technicianId,
    cost,
    date: new Date()
  });
  
  return this.save();
};

roomSchema.methods.completeMaintenance = function(noteId) {
  const note = this.maintenance.notes.id(noteId);
  if (note) {
    note.completed = true;
    if (note.type === 'CLEANING') {
      this.maintenance.lastCleaning = new Date();
    } else {
      this.maintenance.lastMaintenance = new Date();
    }
    
    const pendingMaintenance = this.maintenance.notes.filter(n => !n.completed);
    if (pendingMaintenance.length === 0 && this.status === 'MAINTENANCE') {
      this.status = 'AVAILABLE';
    }
  }
  
  return this.save();
};

roomSchema.methods.changeStatus = function(newStatus, reason = '') {
  const validTransitions = {
    'AVAILABLE': ['OCCUPIED', 'MAINTENANCE', 'CLEANING'],
    'OCCUPIED': ['AVAILABLE', 'CLEANING'],
    'MAINTENANCE': ['AVAILABLE', 'OUT_OF_ORDER'],
    'OUT_OF_ORDER': ['MAINTENANCE', 'AVAILABLE'],
    'CLEANING': ['AVAILABLE', 'MAINTENANCE']
  };
  
  if (!validTransitions[this.status].includes(newStatus)) {
    throw new Error(`Transition de ${this.status} vers ${newStatus} non autorisée`);
  }
  
  this.status = newStatus;
  
  if (reason) {
    this.addMaintenanceNote('INSPECTION', `Changement de statut: ${reason}`);
  }
  
  return this.save();
};

roomSchema.methods.updateStats = async function() {
  const Booking = mongoose.model('Booking');
  
  const bookings = await Booking.find({
    rooms: this._id,
    status: 'COMPLETED'
  });
  
  this.stats.totalBookings = bookings.length;
  this.stats.totalRevenue = bookings.reduce((sum, booking) => sum + booking.totalPrice, 0);
  
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  
  const recentBookings = await Booking.find({
    rooms: this._id,
    status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
    checkIn: { $gte: thirtyDaysAgo }
  });
  
  const totalNights = recentBookings.reduce((sum, booking) => {
    const nights = Math.ceil((booking.checkOut - booking.checkIn) / (1000 * 60 * 60 * 24));
    return sum + nights;
  }, 0);
  
  this.stats.occupancyRate = Math.round((totalNights / 30) * 100);
  
  return this.save();
};

// New yield management methods

/**
 * Apply dynamic pricing suggestion
 */
roomSchema.methods.applyDynamicPrice = async function(price, validFrom, validUntil, approvedBy, reason = '') {
  // Validate price constraints
  if (this.yieldManagement?.priceConstraints) {
    const { minPrice, maxPrice } = this.yieldManagement.priceConstraints;
    
    if (minPrice && price < minPrice) {
      throw new Error(`Le prix ne peut pas être inférieur à ${minPrice}`);
    }
    
    if (maxPrice && price > maxPrice) {
      throw new Error(`Le prix ne peut pas être supérieur à ${maxPrice}`);
    }
  }
  
  // Add to price history
  this.priceHistory.push({
    date: new Date(),
    basePrice: this.basePrice,
    dynamicPrice: price,
    source: approvedBy ? 'MANUAL' : 'AUTOMATED',
    appliedBy: approvedBy,
    reason,
    occupancyAtTime: this.stats.occupancyRate || 0
  });
  
  // Update current dynamic price
  this.currentDynamicPrice = {
    price,
    validFrom: validFrom || new Date(),
    validUntil: validUntil || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days default
    lastCalculated: new Date(),
    nextRecalculation: new Date(Date.now() + 24 * 60 * 60 * 1000), // Next day
    approvalStatus: approvedBy ? 'APPROVED' : 'AUTO_APPROVED',
    approvedBy
  };
  
  return this.save();
};

/**
 * Add yield optimization suggestion
 */
roomSchema.methods.addYieldSuggestion = function(suggestedPrice, reason, confidence = 50, factors = {}) {
  const currentPrice = this.currentPrice;
  const changePercentage = ((suggestedPrice - currentPrice) / currentPrice) * 100;
  
  // Check daily change limits
  if (this.yieldManagement?.priceConstraints) {
    const { maxDailyIncrease, maxDailyDecrease } = this.yieldManagement.priceConstraints;
    
    if (changePercentage > maxDailyIncrease) {
      throw new Error(`L'augmentation suggérée (${changePercentage.toFixed(1)}%) dépasse la limite quotidienne de ${maxDailyIncrease}%`);
    }
    
    if (changePercentage < -maxDailyDecrease) {
      throw new Error(`La diminution suggérée (${Math.abs(changePercentage).toFixed(1)}%) dépasse la limite quotidienne de ${maxDailyDecrease}%`);
    }
  }
  
  this.yieldSuggestions.push({
    suggestedPrice,
    currentPrice,
    changePercentage,
    reason,
    confidence,
    factors: new Map(Object.entries(factors))
  });
  
  // Keep only last 30 suggestions
  if (this.yieldSuggestions.length > 30) {
    this.yieldSuggestions = this.yieldSuggestions.slice(-30);
  }
  
  return this.save();
};

/**
 * Review yield suggestion
 */
roomSchema.methods.reviewYieldSuggestion = async function(suggestionId, status, reviewedBy, notes = '') {
  const suggestion = this.yieldSuggestions.id(suggestionId);
  
  if (!suggestion) {
    throw new Error('Suggestion non trouvée');
  }
  
  if (suggestion.status !== 'PENDING') {
    throw new Error('Cette suggestion a déjà été traitée');
  }
  
  suggestion.status = status;
  suggestion.reviewedBy = reviewedBy;
  suggestion.reviewedAt = new Date();
  suggestion.reviewNotes = notes;
  
  // If approved, apply the price
  if (status === 'APPLIED') {
    await this.applyDynamicPrice(
      suggestion.suggestedPrice,
      new Date(),
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      reviewedBy,
      suggestion.reason
    );
  }
  
  return this.save();
};

/**
 * Calculate room-specific price premium
 */
roomSchema.methods.calculateRoomPremium = function() {
  if (!this.yieldManagement?.enabled || !this.yieldManagement?.demandFactors) {
    return 1.0;
  }
  
  const { viewPremium, floorPremium, quietnessPremium } = this.yieldManagement.demandFactors;
  let totalPremium = 1.0;
  
  // View premium
  if (viewPremium > 0) {
    const hasGoodView = this.amenities.some(a => 
      ['Vue sur mer', 'Vue sur montagne'].includes(a)
    );
    if (hasGoodView) {
      totalPremium *= (1 + viewPremium / 100);
    }
  }
  
  // Floor premium
  if (floorPremium !== 0) {
    const floorMultiplier = 1 + (this.floor * floorPremium / 100);
    totalPremium *= floorMultiplier;
  }
  
  // Quietness premium
  if (quietnessPremium > 0 && this.amenities.includes('Insonorisation')) {
    totalPremium *= (1 + quietnessPremium / 100);
  }
  
  return totalPremium;
};

/**
 * Track daily revenue
 */
roomSchema.methods.trackDailyRevenue = function(date, revenue, wasOccupied = false) {
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);
  
  // Find or create daily entry
  let dailyEntry = this.revenueTracking.daily.find(d => 
    d.date.toDateString() === dateOnly.toDateString()
  );
  
  if (!dailyEntry) {
    dailyEntry = {
      date: dateOnly,
      revenue: 0,
      bookings: 0,
      averageRate: 0,
      occupancy: false
    };
    this.revenueTracking.daily.push(dailyEntry);
  }
  
  // Update entry
  if (revenue > 0) {
    dailyEntry.revenue += revenue;
    dailyEntry.bookings += 1;
    dailyEntry.averageRate = dailyEntry.revenue / dailyEntry.bookings;
  }
  
  if (wasOccupied) {
    dailyEntry.occupancy = true;
  }
  
  return this.save();
};

/**
 * Update monthly revenue aggregates
 */
roomSchema.methods.updateMonthlyRevenue = async function(month, year) {
  // Calculate from daily data
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0); // Last day of month
  
  const dailyData = this.revenueTracking.daily.filter(d => 
    d.date >= startDate && d.date <= endDate
  );
  
  if (dailyData.length === 0) return;
  
  const totalRevenue = dailyData.reduce((sum, d) => sum + d.revenue, 0);
  const totalBookings = dailyData.reduce((sum, d) => sum + d.bookings, 0);
  const occupiedDays = dailyData.filter(d => d.occupancy).length;
  const totalDays = endDate.getDate();
  
  // Find or create monthly entry
  let monthlyEntry = this.revenueTracking.monthly.find(m => 
    m.month === month && m.year === year
  );
  
  if (!monthlyEntry) {
    monthlyEntry = { month, year };
    this.revenueTracking.monthly.push(monthlyEntry);
  }
  
  // Update aggregates
  monthlyEntry.totalRevenue = totalRevenue;
  monthlyEntry.totalBookings = totalBookings;
  monthlyEntry.averageRate = totalBookings > 0 ? totalRevenue / totalBookings : 0;
  monthlyEntry.occupancyRate = (occupiedDays / totalDays) * 100;
  monthlyEntry.revPAR = totalRevenue / totalDays;
  
  return this.save();
};

/**
 * Get yield performance metrics
 */
roomSchema.methods.getYieldPerformance = function(startDate, endDate) {
  const priceChanges = this.priceHistory.filter(h => 
    h.date >= startDate && h.date <= endDate
  );
  
  const revenueData = this.revenueTracking.daily.filter(d => 
    d.date >= startDate && d.date <= endDate
  );
  
  const totalRevenue = revenueData.reduce((sum, d) => sum + d.revenue, 0);
  const occupiedDays = revenueData.filter(d => d.occupancy).length;
  const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
  
  // Calculate average dynamic price vs base price
  const avgDynamicPrice = priceChanges.length > 0
    ? priceChanges.reduce((sum, p) => sum + p.dynamicPrice, 0) / priceChanges.length
    : this.basePrice;
  
  const priceVariance = ((avgDynamicPrice - this.basePrice) / this.basePrice) * 100;
  
  return {
    period: { startDate, endDate, days: totalDays },
    revenue: {
      total: totalRevenue,
      average: totalDays > 0 ? totalRevenue / totalDays : 0,
      revPAR: totalDays > 0 ? totalRevenue / totalDays : 0
    },
    occupancy: {
      rate: totalDays > 0 ? (occupiedDays / totalDays) * 100 : 0,
      daysOccupied: occupiedDays,
      totalDays
    },
    pricing: {
      basePrice: this.basePrice,
      averageDynamicPrice: avgDynamicPrice,
      priceVariance: priceVariance,
      priceChanges: priceChanges.length
    },
    optimization: {
      suggestionsGenerated: this.yieldSuggestions.length,
      suggestionsApplied: this.yieldSuggestions.filter(s => s.status === 'APPLIED').length,
      lastOptimizationScore: this.yieldManagement?.performanceMetrics?.lastOptimizationScore || 0
    }
  };
};

// ============================================================================
// STATIC METHODS (existing + new yield management methods)
// ============================================================================

// Existing static methods preserved
roomSchema.statics.findAvailableRooms = function(hotelId, checkIn, checkOut, roomType = null, guestCount = 1) {
  const query = {
    hotel: hotelId,
    status: 'AVAILABLE',
    isActive: true,
    'capacity.adults': { $gte: guestCount }
  };
  
  if (roomType) {
    query.type = roomType;
  }
  
  return this.find(query)
    .populate('hotel')
    .then(async rooms => {
      const availableRooms = [];
      for (const room of rooms) {
        const isAvailable = await room.isAvailableForPeriod(checkIn, checkOut);
        if (isAvailable) {
          availableRooms.push(room);
        }
      }
      return availableRooms;
    });
};

roomSchema.statics.getStatsByType = function(hotelId = null) {
  const matchStage = { isActive: true };
  if (hotelId) {
    matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        avgPrice: { $avg: '$basePrice' },
        avgOccupancy: { $avg: '$stats.occupancyRate' },
        totalRevenue: { $sum: '$stats.totalRevenue' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

roomSchema.statics.getRoomsNeedingMaintenance = function(hotelId = null) {
  const matchStage = {
    isActive: true,
    $or: [
      { status: { $in: ['MAINTENANCE', 'OUT_OF_ORDER'] } },
      { 'maintenance.nextMaintenance': { $lte: new Date() } }
    ]
  };
  
  if (hotelId) {
    matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  }
  
  return this.find(matchStage)
    .populate('hotel', 'name code')
    .sort({ 'maintenance.nextMaintenance': 1 });
};

roomSchema.statics.getOccupancyByFloor = function(hotelId) {
  return this.aggregate([
    { $match: { hotel: mongoose.Types.ObjectId(hotelId), isActive: true } },
    {
      $group: {
        _id: '$floor',
        totalRooms: { $sum: 1 },
        availableRooms: {
          $sum: { $cond: [{ $eq: ['$status', 'AVAILABLE'] }, 1, 0] }
        },
        avgOccupancy: { $avg: '$stats.occupancyRate' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

// New yield management static methods

/**
 * Get rooms needing price optimization
 */
roomSchema.statics.getRoomsForYieldOptimization = function(hotelId = null) {
  const matchStage = {
    isActive: true,
    'yieldManagement.enabled': true,
    $or: [
      { 'currentDynamicPrice.validUntil': { $lt: new Date() } },
      { 'currentDynamicPrice.nextRecalculation': { $lte: new Date() } },
      { currentDynamicPrice: { $exists: false } }
    ]
  };
  
  if (hotelId) {
    matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  }
  
  return this.find(matchStage)
    .populate('hotel', 'name code yieldManagement')
    .sort({ 'currentDynamicPrice.lastCalculated': 1 });
};

/**
 * Get yield performance statistics
 */
roomSchema.statics.getYieldPerformanceStats = function(hotelId, startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        hotel: mongoose.Types.ObjectId(hotelId),
        isActive: true,
        'yieldManagement.enabled': true
      }
    },
    {
      $unwind: '$priceHistory'
    },
    {
      $match: {
        'priceHistory.date': { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$type',
        avgBasePrice: { $avg: '$basePrice' },
        avgDynamicPrice: { $avg: '$priceHistory.dynamicPrice' },
        priceChanges: { $sum: 1 },
        maxPrice: { $max: '$priceHistory.dynamicPrice' },
        minPrice: { $min: '$priceHistory.dynamicPrice' },
        avgPriceVariance: {
          $avg: {  
            $multiply: [
              { $divide: [
                { $subtract: ['$priceHistory.dynamicPrice', '$basePrice'] },
                '$basePrice'
              ]},
              100
            ]
          }
        }
      }
    },
    {
      $project: {
        roomType: '$_id',
        avgBasePrice: { $round: ['$avgBasePrice', 2] },
        avgDynamicPrice: { $round: ['$avgDynamicPrice', 2] },
        priceChanges: 1,
        maxPrice: { $round: ['$maxPrice', 2] },
        minPrice: { $round: ['$minPrice', 2] },
        avgPriceVariance: { $round: ['$avgPriceVariance', 2] },
        revenueImpact: {
          $round: [{
            $multiply: [
              { $divide: [
                { $subtract: ['$avgDynamicPrice', '$avgBasePrice'] },
                '$avgBasePrice'
              ]},
              100
            ]
          }, 2]
        }
      }
    },
    { $sort: { roomType: 1 } }
  ]);
};

/**
 * Get rooms with pending yield suggestions
 */
roomSchema.statics.getPendingYieldSuggestions = function(hotelId = null) {
  const matchStage = {
    isActive: true,
    'yieldSuggestions.status': 'PENDING'
  };
  
  if (hotelId) {
    matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  }
  
  return this.aggregate([
    { $match: matchStage },
    { $unwind: '$yieldSuggestions' },
    { $match: { 'yieldSuggestions.status': 'PENDING' } },
    {
      $project: {
        hotel: 1,
        number: 1,
        type: 1,
        basePrice: 1,
        currentPrice: '$currentDynamicPrice.price',
        suggestion: '$yieldSuggestions'
      }
    },
    { $sort: { 'suggestion.confidence': -1, 'suggestion.suggestedAt': -1 } }
  ]);
};

// ============================================================================
// EXPORT
// ============================================================================

const Room = mongoose.model('Room', roomSchema);

module.exports = Room;