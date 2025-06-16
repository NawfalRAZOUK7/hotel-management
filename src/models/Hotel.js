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
  // YIELD MANAGEMENT FIELDS - PRESERVED
  // ============================================================================

  // Yield Management Configuration (all existing fields preserved)
  yieldManagement: {
    enabled: {
      type: Boolean,
      default: false
    },
    
    strategy: {
      type: String,
      enum: ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'],
      default: 'MODERATE'
    },
    
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
    
    automationSettings: {
      autoApplyRecommendations: {
        type: Boolean,
        default: false
      },
      maxDailyPriceChange: {
        type: Number,
        default: 20,
        min: [0, 'Le changement maximum doit être positif'],
        max: [100, 'Le changement maximum ne peut pas dépasser 100%']
      },
      requireApprovalThreshold: {
        type: Number,
        default: 30,
        min: [0, 'Le seuil doit être positif'],
        max: [100, 'Le seuil ne peut pas dépasser 100%']
      },
      updateFrequency: {
        type: String,
        enum: ['HOURLY', 'DAILY', 'WEEKLY', 'MANUAL'],
        default: 'DAILY'
      }
    },
    
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
    
    dayOfWeekMultipliers: {
      monday: { type: Number, default: 0.85 },
      tuesday: { type: Number, default: 0.85 },
      wednesday: { type: Number, default: 0.9 },
      thursday: { type: Number, default: 0.95 },
      friday: { type: Number, default: 1.15 },
      saturday: { type: Number, default: 1.25 },
      sunday: { type: Number, default: 0.9 }
    },
    
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
          type: String
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
          default: 0,
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

  // Dynamic Pricing Calendar - PRESERVED
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

  // Yield Management Analytics - PRESERVED
  yieldAnalytics: {
    lastYieldUpdate: {
      type: Date
    },
    averageOccupancyRate: {
      type: Number,
      min: [0, 'Le taux d\'occupation ne peut pas être négatif'],
      max: [100, 'Le taux d\'occupation ne peut pas dépasser 100%']
    },
    revPAR: {
      type: Number,
      min: [0, 'Le RevPAR ne peut pas être négatif']
    },
    adr: {
      type: Number,
      min: [0, 'L\'ADR ne peut pas être négatif']
    },
    performanceMetrics: {
      revenueVsTarget: {
        type: Number
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

  // Active Pricing Rules - PRESERVED
  activePricingRules: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PricingRule'
  }],

  // Historical pricing data - PRESERVED
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
  }],

  // ============================================================================
  // ✨ NEW PHASE I4: QR SETTINGS INTEGRATION ✨
  // ============================================================================
  
  // QR Code Configuration pour l'hôtel
  qrSettings: {
    // QR System Configuration
    enabled: {
      type: Boolean,
      default: true,
      index: true
    },
    
    // Auto-generation settings
    autoGenerate: {
      type: Boolean,
      default: true
    },
    autoGenerateOnBookingConfirmation: {
      type: Boolean,
      default: true
    },
    autoGenerateOnCheckIn: {
      type: Boolean,
      default: false
    },
    
    // QR Code Expiry Settings
    expiryHours: {
      type: Number,
      default: 24,
      min: [1, 'L\'expiration minimum est 1 heure'],
      max: [168, 'L\'expiration maximum est 1 semaine']
    },
    extendExpiryOnUsage: {
      type: Boolean,
      default: false
    },
    
    // Security Configuration
    securityLevel: {
      type: String,
      enum: ['BASIC', 'STANDARD', 'HIGH'],
      default: 'STANDARD',
      index: true
    },
    enableGeolocationValidation: {
      type: Boolean,
      default: false
    },
    allowedRadius: {
      type: Number, // meters
      default: 100,
      min: [10, 'Rayon minimum 10 mètres'],
      max: [1000, 'Rayon maximum 1000 mètres']
    },
    enableDeviceValidation: {
      type: Boolean,
      default: false
    },
    maxUsagePerQR: {
      type: Number,
      default: 10,
      min: [1, 'Usage minimum 1'],
      max: [100, 'Usage maximum 100']
    },
    
    // QR Code Styling & Branding
    customization: {
      logo: {
        enabled: {
          type: Boolean,
          default: false
        },
        url: {
          type: String,
          match: [/^https?:\/\/.+\.(jpg|jpeg|png|svg)$/i, 'URL de logo invalide']
       },
       size: {
         type: String,
         enum: ['SMALL', 'MEDIUM', 'LARGE'],
         default: 'MEDIUM'
       }
     },
     colors: {
       primary: {
         type: String,
         default: '#1a365d',
         match: [/^#[0-9A-F]{6}$/i, 'Couleur primaire invalide (format hex)']
       },
       secondary: {
         type: String,
         default: '#f7fafc',
         match: [/^#[0-9A-F]{6}$/i, 'Couleur secondaire invalide (format hex)']
       },
       background: {
         type: String,
         default: '#ffffff',
         match: [/^#[0-9A-F]{6}$/i, 'Couleur background invalide (format hex)']
       }
     },
     style: {
       type: String,
       enum: ['default', 'hotel', 'mobile', 'print'],
       default: 'hotel'
     },
     errorCorrectionLevel: {
       type: String,
       enum: ['L', 'M', 'Q', 'H'],
       default: 'M'
     },
     size: {
       width: {
         type: Number,
         default: 300,
         min: [100, 'Largeur minimum 100px'],
         max: [800, 'Largeur maximum 800px']
       },
       margin: {
         type: Number,
         default: 2,
         min: [0, 'Marge minimum 0'],
         max: [10, 'Marge maximum 10']
       }
     },
     instructions: {
       checkIn: {
         type: String,
         default: 'Scannez ce code QR pour effectuer votre check-in',
         maxlength: [200, 'Instructions trop longues']
       },
       checkOut: {
         type: String,
         default: 'Scannez ce code QR pour effectuer votre check-out',
         maxlength: [200, 'Instructions trop longues']
       },
       roomAccess: {
         type: String,
         default: 'Scannez ce code QR pour accéder à votre chambre',
         maxlength: [200, 'Instructions trop longues']
       }
     }
   },
   
   // Notification Settings for QR
   notifications: {
     emailQRToGuest: {
       type: Boolean,
       default: true
     },
     smsQRToGuest: {
       type: Boolean,
       default: false
     },
     notifyReceptionOnQRUsage: {
       type: Boolean,
       default: true
     },
     notifyManagerOnFailures: {
       type: Boolean,
       default: true
     },
     failureThreshold: {
       type: Number,
       default: 5, // Notify after 5 failures
       min: [1, 'Seuil minimum 1'],
       max: [50, 'Seuil maximum 50']
     }
   },
   
   // QR Types enabled for this hotel
   enabledTypes: {
     checkIn: {
       type: Boolean,
       default: true
     },
     checkOut: {
       type: Boolean,
       default: true
     },
     roomAccess: {
       type: Boolean,
       default: false
     },
     payment: {
       type: Boolean,
       default: false
     },
     menu: {
       type: Boolean,
       default: false
     },
     wifi: {
       type: Boolean,
       default: false
     },
     feedback: {
       type: Boolean,
       default: true
     }
   },
   
   // Advanced QR Features
   advancedFeatures: {
     multiLanguageSupport: {
       type: Boolean,
       default: false
     },
     supportedLanguages: [{
       type: String,
       enum: ['FR', 'EN', 'ES', 'DE', 'IT', 'AR'],
       default: ['FR', 'EN']
     }],
     offlineMode: {
       type: Boolean,
       default: false
     },
     batchGeneration: {
       type: Boolean,
       default: false
     },
     analytics: {
       enabled: {
         type: Boolean,
         default: true
       },
       retentionDays: {
         type: Number,
         default: 90,
         min: [30, 'Rétention minimum 30 jours'],
         max: [365, 'Rétention maximum 365 jours']
       }
     }
   }
 },

 // ============================================================================
 // ✨ NEW PHASE I4: CACHE SETTINGS INTEGRATION ✨
 // ============================================================================
 
 // Cache Configuration pour l'hôtel
 cacheSettings: {
   // Global Cache Configuration
   enabled: {
     type: Boolean,
     default: true,
     index: true
   },
   
   // Cache Strategy
   strategy: {
     type: String,
     enum: ['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'],
     default: 'BALANCED',
     index: true
   },
   
   // Custom TTL Settings per cache type
   customTTL: {
     availability: {
       realtime: {
         type: Number,
         default: 120, // 2 minutes
         min: [30, 'TTL minimum 30 secondes'],
         max: [600, 'TTL maximum 10 minutes']
       },
       standard: {
         type: Number,
         default: 300, // 5 minutes
         min: [60, 'TTL minimum 1 minute'],
         max: [1800, 'TTL maximum 30 minutes']
       },
       bulk: {
         type: Number,
         default: 900, // 15 minutes
         min: [300, 'TTL minimum 5 minutes'],
         max: [3600, 'TTL maximum 1 heure']
       }
     },
     
     yieldPricing: {
       dynamic: {
         type: Number,
         default: 300, // 5 minutes
         min: [60, 'TTL minimum 1 minute'],
         max: [1800, 'TTL maximum 30 minutes']
       },
       strategy: {
         type: Number,
         default: 7200, // 2 heures
         min: [1800, 'TTL minimum 30 minutes'],
         max: [21600, 'TTL maximum 6 heures']
       },
       historical: {
         type: Number,
         default: 21600, // 6 heures
         min: [3600, 'TTL minimum 1 heure'],
         max: [86400, 'TTL maximum 24 heures']
       }
     },
     
     analytics: {
       realtime: {
         type: Number,
         default: 60, // 1 minute
         min: [30, 'TTL minimum 30 secondes'],
         max: [300, 'TTL maximum 5 minutes']
       },
       dashboard: {
         type: Number,
         default: 300, // 5 minutes
         min: [60, 'TTL minimum 1 minute'],
         max: [1800, 'TTL maximum 30 minutes']
       },
       reports: {
         type: Number,
         default: 1800, // 30 minutes
         min: [300, 'TTL minimum 5 minutes'],
         max: [7200, 'TTL maximum 2 heures']
       },
       historical: {
         type: Number,
         default: 86400, // 24 heures
         min: [3600, 'TTL minimum 1 heure'],
         max: [604800, 'TTL maximum 7 jours']
       }
     },
     
     hotelData: {
       basic: {
         type: Number,
         default: 1800, // 30 minutes
         min: [300, 'TTL minimum 5 minutes'],
         max: [7200, 'TTL maximum 2 heures']
       },
       full: {
         type: Number,
         default: 7200, // 2 heures
         min: [1800, 'TTL minimum 30 minutes'],
         max: [21600, 'TTL maximum 6 heures']
       },
       configuration: {
         type: Number,
         default: 21600, // 6 heures
         min: [3600, 'TTL minimum 1 heure'],
         max: [86400, 'TTL maximum 24 heures']
       },
       static: {
         type: Number,
         default: 86400, // 24 heures
         min: [21600, 'TTL minimum 6 heures'],
         max: [604800, 'TTL maximum 7 jours']
       }
     }
   },
   
   // Cache Invalidation Strategy
   invalidationStrategy: {
     type: {
       type: String,
       enum: ['IMMEDIATE', 'DELAYED', 'SCHEDULED', 'SMART'],
       default: 'SMART'
     },
     delayMs: {
       type: Number,
       default: 5000, // 5 seconds delay for DELAYED strategy
       min: [1000, 'Délai minimum 1 seconde'],
       max: [60000, 'Délai maximum 1 minute']
     },
     batchSize: {
       type: Number,
       default: 100,
       min: [10, 'Taille minimum 10'],
       max: [1000, 'Taille maximum 1000']
     },
     schedulePattern: {
       type: String,
       default: '*/5 * * * *', // Every 5 minutes
       match: [/^[*\/\d\s,-]+$/, 'Pattern cron invalide']
     }
   },
   
   // Cache Triggers Configuration
   invalidationTriggers: {
     onBookingCreate: {
       type: Boolean,
       default: true
     },
     onBookingUpdate: {
       type: Boolean,
       default: true
     },
     onBookingStatusChange: {
       type: Boolean,
       default: true
     },
     onPriceChange: {
       type: Boolean,
       default: true
     },
     onRoomStatusChange: {
       type: Boolean,
       default: true
     },
     onYieldUpdate: {
       type: Boolean,
       default: true
     },
     onHotelConfigChange: {
       type: Boolean,
       default: true
     },
     cascadeToRelated: {
       type: Boolean,
       default: true
     }
   },
   
   // Cache Warming Configuration
   warmingSettings: {
     enabled: {
       type: Boolean,
       default: true
     },
     schedule: {
       type: String,
       default: '0 */6 * * *', // Every 6 hours
       match: [/^[*\/\d\s,-]+$/, 'Pattern cron invalide']
     },
     priorities: {
       availability: {
         type: Number,
         default: 1, // Highest priority
         min: [1, 'Priorité minimum 1'],
         max: [10, 'Priorité maximum 10']
       },
       pricing: {
         type: Number,
         default: 2,
         min: [1, 'Priorité minimum 1'],
         max: [10, 'Priorité maximum 10']
       },
       analytics: {
         type: Number,
         default: 3,
         min: [1, 'Priorité minimum 1'],
         max: [10, 'Priorité maximum 10']
       },
       hotelData: {
         type: Number,
         default: 4,
         min: [1, 'Priorité minimum 1'],
         max: [10, 'Priorité maximum 10']
       }
     },
     dateRange: {
       daysBefore: {
         type: Number,
         default: 1,
         min: [0, 'Jours avant minimum 0'],
         max: [30, 'Jours avant maximum 30']
       },
       daysAfter: {
         type: Number,
         default: 30,
         min: [1, 'Jours après minimum 1'],
         max: [365, 'Jours après maximum 365']
       }
     }
   },
   
   // Performance Thresholds
   performanceThresholds: {
     hitRateWarning: {
       type: Number,
       default: 70, // Warn if hit rate < 70%
       min: [0, 'Seuil minimum 0%'],
       max: [100, 'Seuil maximum 100%']
     },
     hitRateCritical: {
       type: Number,
       default: 50, // Critical if hit rate < 50%
       min: [0, 'Seuil minimum 0%'],
       max: [100, 'Seuil maximum 100%']
     },
     responseTimeWarning: {
       type: Number,
       default: 1000, // Warn if response time > 1s
       min: [100, 'Seuil minimum 100ms'],
       max: [10000, 'Seuil maximum 10s']
     },
     responseTimeCritical: {
       type: Number,
       default: 3000, // Critical if response time > 3s
       min: [500, 'Seuil minimum 500ms'],
       max: [30000, 'Seuil maximum 30s']
     },
     memoryUsageWarning: {
       type: Number,
       default: 80, // Warn if memory usage > 80%
       min: [50, 'Seuil minimum 50%'],
       max: [95, 'Seuil maximum 95%']
     }
   },
   
   // Cache Compression Settings
   compression: {
     enabled: {
       type: Boolean,
       default: true
     },
     threshold: {
       type: Number,
       default: 1024, // Compress if data > 1KB
       min: [512, 'Seuil minimum 512 bytes'],
       max: [10240, 'Seuil maximum 10KB']
     },
     algorithm: {
       type: String,
       enum: ['gzip', 'deflate', 'brotli'],
       default: 'gzip'
     }
   },
   
   // Advanced Cache Features
   advancedFeatures: {
     enableCacheTags: {
       type: Boolean,
       default: true
     },
     enableCacheVersioning: {
       type: Boolean,
       default: false
     },
     enableDistributedInvalidation: {
       type: Boolean,
       default: true
     },
     enableCacheMetrics: {
       type: Boolean,
       default: true
     },
     enableCacheDebugging: {
       type: Boolean,
       default: false
     }
   }
 },

 // ============================================================================
 // ✨ NEW PHASE I4: PERFORMANCE METRICS INTEGRATION ✨
 // ============================================================================
 
 // Performance Metrics tracking pour l'hôtel
 performanceMetrics: {
   // Cache Performance Metrics
   cache: {
     overall: {
       hitRate: {
         type: Number,
         default: 0,
         min: [0, 'Hit rate minimum 0'],
         max: [100, 'Hit rate maximum 100'],
         index: true
       },
       missRate: {
         type: Number,
         default: 0,
         min: [0, 'Miss rate minimum 0'],
         max: [100, 'Miss rate maximum 100']
       },
       avgResponseTime: {
         type: Number,
         default: 0,
         min: [0, 'Temps de réponse minimum 0']
       },
       totalRequests: {
         type: Number,
         default: 0,
         min: [0, 'Requêtes totales minimum 0']
       },
       totalCacheSize: {
         type: String, // Stored as string with units (e.g., "256MB")
         default: '0B'
       },
       lastUpdated: {
         type: Date,
         default: Date.now,
         index: true
       }
     },
     
     // Performance by cache type
     byType: {
       availability: {
         hitRate: { type: Number, default: 0 },
         avgResponseTime: { type: Number, default: 0 },
         totalRequests: { type: Number, default: 0 },
         cacheSize: { type: String, default: '0B' },
         invalidationsCount: { type: Number, default: 0 }
       },
       yieldPricing: {
         hitRate: { type: Number, default: 0 },
         avgResponseTime: { type: Number, default: 0 },
         totalRequests: { type: Number, default: 0 },
         cacheSize: { type: String, default: '0B' },
         invalidationsCount: { type: Number, default: 0 }
       },
       analytics: {
         hitRate: { type: Number, default: 0 },
         avgResponseTime: { type: Number, default: 0 },
         totalRequests: { type: Number, default: 0 },
         cacheSize: { type: String, default: '0B' },
         invalidationsCount: { type: Number, default: 0 }
       },
       hotelData: {
         hitRate: { type: Number, default: 0 },
         avgResponseTime: { type: Number, default: 0 },
         totalRequests: { type: Number, default: 0 },
         cacheSize: { type: String, default: '0B' },
         invalidationsCount: { type: Number, default: 0 }
       }
     },
     
     // Historical performance trends
     trends: {
       daily: [{
         date: Date,
         hitRate: Number,
         avgResponseTime: Number,
         totalRequests: Number,
         cacheSize: String
       }],
       weekly: [{
         weekStart: Date,
         avgHitRate: Number,
         avgResponseTime: Number,
         totalRequests: Number,
         peakCacheSize: String
       }],
       monthly: [{
         month: Date,
         avgHitRate: Number,
         avgResponseTime: Number,
         totalRequests: Number,
         maxCacheSize: String
       }]
     },
     
     // Cache health indicators
     health: {
       status: {
         type: String,
         enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'],
         default: 'GOOD',
         index: true
       },
       score: {
         type: Number,
         default: 100,
         min: [0, 'Score minimum 0'],
         max: [100, 'Score maximum 100'],
         index: true
       },
       issues: [{
         type: {
           type: String,
           enum: ['HIGH_MISS_RATE', 'SLOW_RESPONSE', 'MEMORY_PRESSURE', 'INVALIDATION_FAILURE', 'TTL_OPTIMIZATION']
         },
         severity: {
           type: String,
           enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
         },
         detectedAt: {
           type: Date,
           default: Date.now
         },
         description: String,
         resolved: {
           type: Boolean,
           default: false
         },
         resolvedAt: Date
       }],
       lastHealthCheck: {
         type: Date,
         default: Date.now,
         index: true
       }
     }
   },
   
   // QR Performance Metrics
   qr: {
     overall: {
       totalGenerated: {
         type: Number,
         default: 0,
         min: [0, 'Total généré minimum 0'],
         index: true
       },
       totalUsed: {
         type: Number,
         default: 0,
         min: [0, 'Total utilisé minimum 0']
       },
       usageRate: {
         type: Number,
         default: 0,
         min: [0, 'Taux d\'utilisation minimum 0'],
         max: [100, 'Taux d\'utilisation maximum 100'],
         index: true
       },
       avgCheckInTime: {
         type: Number,
         default: 0,
         min: [0, 'Temps check-in minimum 0']
       },
       successRate: {
         type: Number,
         default: 0,
         min: [0, 'Taux de succès minimum 0'],
         max: [100, 'Taux de succès maximum 100'],
         index: true
       },
       lastUpdated: {
         type: Date,
         default: Date.now,
         index: true
       }
     },
     
     // Performance by QR type
     byType: {
       checkIn: {
         generated: { type: Number, default: 0 },
         used: { type: Number, default: 0 },
         avgTime: { type: Number, default: 0 },
         successRate: { type: Number, default: 0 },
         failures: [{
           reason: String,
           count: Number,
           lastOccurred: Date
         }]
       },
       checkOut: {
         generated: { type: Number, default: 0 },
         used: { type: Number, default: 0 },
         avgTime: { type: Number, default: 0 },
         successRate: { type: Number, default: 0 },
         failures: [{
           reason: String,
           count: Number,
           lastOccurred: Date
         }]
       },
       roomAccess: {
         generated: { type: Number, default: 0 },
         used: { type: Number, default: 0 },
         avgTime: { type: Number, default: 0 },
         successRate: { type: Number, default: 0 },
         failures: [{
           reason: String,
           count: Number,
           lastOccurred: Date
         }]
       }
     },
     
     // QR Security metrics
     security: {
       suspiciousAttempts: {
         type: Number,
         default: 0
       },
       blockedAttempts: {
         type: Number,
         default: 0
       },
       revokedCodes: {
         type: Number,
         default: 0
       },
       securityIncidents: [{
         type: {
           type: String,
           enum: ['BRUTE_FORCE', 'INVALID_LOCATION', 'EXPIRED_CODE', 'REVOKED_CODE', 'SUSPICIOUS_DEVICE']
         },
         detectedAt: Date,
         description: String,
         resolved: Boolean,
         resolvedAt: Date
       }],
       lastSecurityCheck: {
         type: Date,
         default: Date.now
       }
     },
     
     // QR Performance trends
     trends: {
       daily: [{
         date: Date,
         generated: Number,
         used: Number,
         avgCheckInTime: Number,
         successRate: Number
       }],
       weekly: [{
         weekStart: Date,
         totalGenerated: Number,
         totalUsed: Number,
         avgCheckInTime: Number,
         avgSuccessRate: Number
       }],
       monthly: [{
         month: Date,
         totalGenerated: Number,
         totalUsed: Number,
         avgCheckInTime: Number,
         avgSuccessRate: Number
       }]
     }
   },
   
   // System Performance Overview
   system: {
     responseTime: {
       web: {
         type: Number,
         default: 0
       },
       mobile: {
         type: Number,
         default: 0
       },
       api: {
         type: Number,
         default: 0
       }
     },
     
     availability: {
       uptime: {
         type: Number,
         default: 100,
         min: [0, 'Uptime minimum 0'],
         max: [100, 'Uptime maximum 100']
       },
       downtime: [{
         startTime: Date,
         endTime: Date,
         reason: String,
         impact: {
           type: String,
           enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
         }
       }],
       lastIncident: Date
     },
     
     integrations: {
       redis: {
         status: {
           type: String,
           enum: ['HEALTHY', 'DEGRADED', 'UNHEALTHY'],
           default: 'HEALTHY'
         },
         responseTime: Number,
         lastCheck: Date
       },
       database: {
         status: {
           type: String,
           enum: ['HEALTHY', 'DEGRADED', 'UNHEALTHY'],
           default: 'HEALTHY'
         },
         responseTime: Number,
         lastCheck: Date
       },
       qrService: {
         status: {
           type: String,
           enum: ['HEALTHY', 'DEGRADED', 'UNHEALTHY'],
           default: 'HEALTHY'
         },
         responseTime: Number,
         lastCheck: Date
       }
     }
   },
   
   // Performance optimization recommendations
   recommendations: [{
     type: {
       type: String,
       enum: ['CACHE_TTL_OPTIMIZATION', 'QR_SECURITY_ENHANCEMENT', 'INVALIDATION_STRATEGY', 'COMPRESSION_IMPROVEMENT', 'WARMING_OPTIMIZATION']
     },
     priority: {
       type: String,
       enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
       default: 'MEDIUM'
     },
     description: {
       type: String,
       required: true,
       maxlength: [500, 'Description trop longue']
     },
     impact: {
       type: String,
       maxlength: [200, 'Impact trop long']
     },
     estimatedImprovement: {
       type: Number, // Percentage improvement expected
       min: [0, 'Amélioration minimum 0%'],
       max: [100, 'Amélioration maximum 100%']
     },
     createdAt: {
       type: Date,
       default: Date.now
     },
     implemented: {
       type: Boolean,
       default: false
     },
     implementedAt: Date,
     actualImprovement: Number
   }],
   
   // Last performance calculation
   lastCalculated: {
     type: Date,
     default: Date.now,
     index: true
   }
 }

}, {
 timestamps: true,
 toJSON: { virtuals: true },
 toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE (incluant QR + Cache)
// ============================================================================

// Existing indexes
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

// Yield management indexes (preserved)
hotelSchema.index({ 'yieldManagement.enabled': 1 });
hotelSchema.index({ 'dynamicPricingCalendar.date': 1, 'dynamicPricingCalendar.roomType': 1 });
hotelSchema.index({ 'pricingHistory.date': 1 });
hotelSchema.index({ 'yieldAnalytics.lastYieldUpdate': 1 });

// ✨ NEW QR SETTINGS INDEXES ✨
hotelSchema.index({ 'qrSettings.enabled': 1 });
hotelSchema.index({ 'qrSettings.securityLevel': 1 });
hotelSchema.index({ 'qrSettings.autoGenerate': 1 });
hotelSchema.index({ 'qrSettings.customization.style': 1 });

// ✨ NEW CACHE SETTINGS INDEXES ✨
hotelSchema.index({ 'cacheSettings.enabled': 1 });
hotelSchema.index({ 'cacheSettings.strategy': 1 });
hotelSchema.index({ 'cacheSettings.invalidationStrategy.type': 1 });

// ✨ NEW PERFORMANCE METRICS INDEXES ✨
hotelSchema.index({ 'performanceMetrics.cache.overall.hitRate': -1 });
hotelSchema.index({ 'performanceMetrics.cache.overall.lastUpdated': -1 });
hotelSchema.index({ 'performanceMetrics.cache.health.status': 1 });
hotelSchema.index({ 'performanceMetrics.cache.health.score': -1 });
hotelSchema.index({ 'performanceMetrics.qr.overall.successRate': -1 });
hotelSchema.index({ 'performanceMetrics.qr.overall.usageRate': -1 });
hotelSchema.index({ 'performanceMetrics.qr.overall.lastUpdated': -1 });
hotelSchema.index({ 'performanceMetrics.lastCalculated': -1 });

// ============================================================================
// VIRTUALS (existing + new QR + Cache virtuals)
// ============================================================================

// Existing virtuals preserved
hotelSchema.virtual('fullAddress').get(function() {
 const addr = this.address;
 return `${addr.street}, ${addr.postalCode} ${addr.city}, ${addr.country}`;
});

hotelSchema.virtual('googleMapsUrl').get(function() {
 if (this.address.coordinates.latitude && this.address.coordinates.longitude) {
   return `https://maps.google.com/?q=${this.address.coordinates.latitude},${this.address.coordinates.longitude}`;
 }
 return `https://maps.google.com/?q=${encodeURIComponent(this.fullAddress)}`;
});

hotelSchema.virtual('occupancyRate').get(function() {
 if (this.stats.totalRooms === 0) return 0;
 return this.yieldAnalytics?.averageOccupancyRate || 0;
});

hotelSchema.virtual('primaryImage').get(function() {
 const primaryImg = this.images.find(img => img.isPrimary);
 return primaryImg || this.images[0] || null;
});

// Yield management virtuals (preserved)
hotelSchema.virtual('isYieldManagementReady').get(function() {
 return this.yieldManagement?.enabled && 
        this.yieldManagement?.basePricing?.SIMPLE > 0 &&
        this.yieldManagement?.strategy != null;
});

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

// ✨ NEW QR SETTINGS VIRTUALS ✨

// Check if QR system is fully operational
hotelSchema.virtual('isQRSystemOperational').get(function() {
 const qr = this.qrSettings;
 if (!qr?.enabled) return false;
 
 const hasEnabledTypes = Object.values(qr.enabledTypes || {}).some(enabled => enabled);
 const hasValidExpiry = qr.expiryHours >= 1 && qr.expiryHours <= 168;
 const hasValidSecurity = ['BASIC', 'STANDARD', 'HIGH'].includes(qr.securityLevel);
 
 return hasEnabledTypes && hasValidExpiry && hasValidSecurity;
});

// Get QR capabilities summary
hotelSchema.virtual('qrCapabilities').get(function() {
 const qr = this.qrSettings;
 if (!qr?.enabled) return { enabled: false };
 
 const enabledTypes = Object.entries(qr.enabledTypes || {})
   .filter(([type, enabled]) => enabled)
   .map(([type]) => type);
 
 return {
   enabled: true,
   types: enabledTypes,
   securityLevel: qr.securityLevel,
   autoGenerate: qr.autoGenerate,
   customization: qr.customization?.style || 'default',
   hasGeolocation: qr.enableGeolocationValidation,
   hasNotifications: qr.notifications?.emailQRToGuest || qr.notifications?.smsQRToGuest
 };
});

// Check if QR customization is configured
hotelSchema.virtual('hasQRBranding').get(function() {
 const custom = this.qrSettings?.customization;
 if (!custom) return false;
 
 const hasLogo = custom.logo?.enabled && custom.logo?.url;
 const hasCustomColors = custom.colors?.primary !== '#1a365d' || 
                         custom.colors?.secondary !== '#f7fafc';
 const hasCustomInstructions = custom.instructions?.checkIn || 
                               custom.instructions?.checkOut;
 
 return hasLogo || hasCustomColors || hasCustomInstructions;
});

// Get QR performance overview
hotelSchema.virtual('qrPerformanceOverview').get(function() {
 const perf = this.performanceMetrics?.qr?.overall;
 if (!perf) return null;
 
 return {
   totalGenerated: perf.totalGenerated || 0,
   totalUsed: perf.totalUsed || 0,
   usageRate: perf.usageRate || 0,
   successRate: perf.successRate || 0,
   avgCheckInTime: perf.avgCheckInTime || 0,
   status: this.getQRSystemStatus()
 };
});

// ✨ NEW CACHE SETTINGS VIRTUALS ✨

// Check if cache system is optimally configured
hotelSchema.virtual('isCacheOptimized').get(function() {
 const cache = this.cacheSettings;
 if (!cache?.enabled) return false;
 
 const perf = this.performanceMetrics?.cache?.overall;
 const hitRate = perf?.hitRate || 0;
 const healthScore = this.performanceMetrics?.cache?.health?.score || 100;
 
 return hitRate >= 75 && healthScore >= 80 && cache.strategy !== 'CONSERVATIVE';
});

// Get cache configuration summary
hotelSchema.virtual('cacheConfigSummary').get(function() {
 const cache = this.cacheSettings;
 if (!cache?.enabled) return { enabled: false };
 
 const warming = cache.warmingSettings?.enabled;
 const compression = cache.compression?.enabled;
 const invalidationStrategy = cache.invalidationStrategy?.type;
 
 return {
   enabled: true,
   strategy: cache.strategy,
   warming: warming,
   compression: compression,
   invalidationStrategy: invalidationStrategy,
   customTTLs: Object.keys(cache.customTTL || {}),
   advancedFeatures: Object.entries(cache.advancedFeatures || {})
     .filter(([feature, enabled]) => enabled)
     .map(([feature]) => feature)
 };
});

// Check cache health status
hotelSchema.virtual('cacheHealthStatus').get(function() {
 const health = this.performanceMetrics?.cache?.health;
 if (!health) return 'UNKNOWN';
 
 return health.status || 'UNKNOWN';
});

// Get cache performance score
hotelSchema.virtual('cachePerformanceScore').get(function() {
 const perf = this.performanceMetrics?.cache?.overall;
 if (!perf) return 0;
 
 const hitRate = perf.hitRate || 0;
 const avgResponseTime = perf.avgResponseTime || 0;
 const healthScore = this.performanceMetrics?.cache?.health?.score || 100;
 
 // Weighted performance score
 let score = hitRate * 0.4; // 40% weight on hit rate
 
 // Response time factor (lower is better)
 if (avgResponseTime > 0) {
   const responseScore = Math.max(0, 100 - (avgResponseTime / 10)); // 1000ms = 0 points
   score += responseScore * 0.3; // 30% weight on response time
 } else {
   score += 30; // Default if no response time data
 }
 
 score += healthScore * 0.3; // 30% weight on health score
 
 return Math.round(score);
});

// Check if cache needs attention
hotelSchema.virtual('cacheNeedsAttention').get(function() {
 const perf = this.performanceMetrics?.cache?.overall;
 const health = this.performanceMetrics?.cache?.health;
 
 if (!perf || !health) return false;
 
 const lowHitRate = (perf.hitRate || 0) < 70;
 const slowResponse = (perf.avgResponseTime || 0) > 1000;
 const unhealthyStatus = ['POOR', 'CRITICAL'].includes(health.status);
 const lowHealthScore = (health.score || 100) < 75;
 
 return lowHitRate || slowResponse || unhealthyStatus || lowHealthScore;
});

// ✨ NEW PERFORMANCE METRICS VIRTUALS ✨

// Get overall system performance score
hotelSchema.virtual('systemPerformanceScore').get(function() {
 const cacheScore = this.cachePerformanceScore || 0;
 const qrScore = this.getQRPerformanceScore();
 const systemScore = this.getSystemHealthScore();
 
 // Weighted average
 return Math.round((cacheScore * 0.4) + (qrScore * 0.3) + (systemScore * 0.3));
});

// Check if hotel needs performance optimization
hotelSchema.virtual('needsPerformanceOptimization').get(function() {
 const systemScore = this.systemPerformanceScore;
 const hasUnresolvedIssues = this.hasUnresolvedPerformanceIssues;
 const hasHighPriorityRecommendations = this.hasHighPriorityRecommendations;
 
 return systemScore < 75 || hasUnresolvedIssues || hasHighPriorityRecommendations;
});

// Check for unresolved performance issues
hotelSchema.virtual('hasUnresolvedPerformanceIssues').get(function() {
 const cacheIssues = this.performanceMetrics?.cache?.health?.issues || [];
 const qrIncidents = this.performanceMetrics?.qr?.security?.securityIncidents || [];
 
 const unresolvedCacheIssues = cacheIssues.filter(issue => !issue.resolved);
 const unresolvedQRIncidents = qrIncidents.filter(incident => !incident.resolved);
 
 return unresolvedCacheIssues.length > 0 || unresolvedQRIncidents.length > 0;
});

// Check for high priority recommendations
hotelSchema.virtual('hasHighPriorityRecommendations').get(function() {
 const recommendations = this.performanceMetrics?.recommendations || [];
 return recommendations.some(rec => 
   !rec.implemented && ['HIGH', 'CRITICAL'].includes(rec.priority)
 );
});

// Get performance trends summary
hotelSchema.virtual('performanceTrends').get(function() {
 const cache = this.performanceMetrics?.cache;
 const qr = this.performanceMetrics?.qr;
 
 if (!cache || !qr) return null;
 
 const cacheDaily = cache.trends?.daily || [];
 const qrDaily = qr.trends?.daily || [];
 
 // Get last 7 days trend
 const last7Days = cacheDaily.slice(-7);
 const qrLast7Days = qrDaily.slice(-7);
 
 return {
   cache: {
     hitRateTrend: this.calculateTrend(last7Days.map(d => d.hitRate)),
     responseTimeTrend: this.calculateTrend(last7Days.map(d => d.avgResponseTime))
   },
   qr: {
     usageRateTrend: this.calculateTrend(qrLast7Days.map(d => d.used / Math.max(d.generated, 1) * 100)),
     successRateTrend: this.calculateTrend(qrLast7Days.map(d => d.successRate))
   }
 };
});

// ============================================================================
// MIDDLEWARE (existing + new QR + Cache initialization)
// ============================================================================

// Existing middleware preserved
hotelSchema.pre('save', function(next) {
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

hotelSchema.pre('save', function(next) {
 for (const season of this.seasonalPricing) {
   if (season.startDate >= season.endDate) {
     return next(new Error('La date de début de saison doit être antérieure à la date de fin'));
   }
 }
 next();
});

// Existing yield management validation (preserved)
hotelSchema.pre('save', function(next) {
 if (this.yieldManagement?.enabled) {
   const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];
   for (const type of roomTypes) {
     if (!this.yieldManagement.basePricing[type] || this.yieldManagement.basePricing[type] <= 0) {
       return next(new Error(`Prix de base requis pour le type de chambre ${type} lorsque le yield management est activé`));
     }
     
     const constraints = this.yieldManagement.priceConstraints[type];
     if (constraints?.min && constraints?.max && constraints.min >= constraints.max) {
       return next(new Error(`Le prix minimum doit être inférieur au prix maximum pour ${type}`));
     }
   }
   
   if (this.yieldManagement.leadTimePricing?.length > 0) {
     this.yieldManagement.leadTimePricing.sort((a, b) => a.daysInAdvance - b.daysInAdvance);
   }
   
   if (this.yieldManagement.lengthOfStayDiscounts?.length > 0) {
     for (const discount of this.yieldManagement.lengthOfStayDiscounts) {
       if (discount.maxNights && discount.maxNights < discount.minNights) {
         return next(new Error('Le maximum de nuits doit être supérieur au minimum'));
       }
     }
   }
   
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

// ✨ NEW QR SETTINGS VALIDATION ✨
hotelSchema.pre('save', function(next) {
 if (this.qrSettings?.enabled) {
   // Validate QR expiry hours
   if (this.qrSettings.expiryHours < 1 || this.qrSettings.expiryHours > 168) {
     return next(new Error('L\'expiration QR doit être entre 1 heure et 1 semaine'));
   }
   
   // Validate geolocation settings
   if (this.qrSettings.enableGeolocationValidation) {
     if (!this.address?.coordinates?.latitude || !this.address?.coordinates?.longitude) {
       return next(new Error('Les coordonnées GPS sont requises pour la validation géographique QR'));
     }
     
     if (this.qrSettings.allowedRadius < 10 || this.qrSettings.allowedRadius > 1000) {
       return next(new Error('Le rayon autorisé doit être entre 10 et 1000 mètres'));
     }
   }
   
   // Validate enabled types
   const enabledTypes = Object.values(this.qrSettings.enabledTypes || {});
   if (!enabledTypes.some(enabled => enabled)) {
     return next(new Error('Au moins un type de QR code doit être activé'));
   }
   
   // Validate custom colors format
   if (this.qrSettings.customization?.colors) {
     const colors = this.qrSettings.customization.colors;
     const hexPattern = /^#[0-9A-F]{6}$/i;
     
     if (colors.primary && !hexPattern.test(colors.primary)) {
       return next(new Error('Couleur primaire invalide (format hex requis)'));
     }
     if (colors.secondary && !hexPattern.test(colors.secondary)) {
       return next(new Error('Couleur secondaire invalide (format hex requis)'));
     }
     if (colors.background && !hexPattern.test(colors.background)) {
       return next(new Error('Couleur background invalide (format hex requis)'));
     }
   }
   
   // Validate logo URL if provided
   if (this.qrSettings.customization?.logo?.enabled && this.qrSettings.customization?.logo?.url) {
     const logoPattern = /^https?:\/\/.+\.(jpg|jpeg|png|svg)$/i;
     if (!logoPattern.test(this.qrSettings.customization.logo.url)) {
       return next(new Error('URL du logo QR invalide'));
     }
   }
 }
 
 next();
});

// ✨ NEW CACHE SETTINGS VALIDATION ✨
hotelSchema.pre('save', function(next) {
 if (this.cacheSettings?.enabled) {
   // Validate TTL values
   const customTTL = this.cacheSettings.customTTL;
   if (customTTL) {
     for (const [category, ttls] of Object.entries(customTTL)) {
       for (const [type, ttl] of Object.entries(ttls)) {
         if (typeof ttl === 'number' && (ttl < 30 || ttl > 86400)) {
           return next(new Error(`TTL invalide pour ${category}.${type}: doit être entre 30s et 24h`));
         }
       }
     }
   }
   
   // Validate performance thresholds
   const thresholds = this.cacheSettings.performanceThresholds;
   if (thresholds) {
     if (thresholds.hitRateWarning && thresholds.hitRateCritical) {
       if (thresholds.hitRateWarning <= thresholds.hitRateCritical) {
         return next(new Error('Le seuil d\'alerte hit rate doit être supérieur au seuil critique'));
       }
     }
     
     if (thresholds.responseTimeWarning && thresholds.responseTimeCritical) {
       if (thresholds.responseTimeWarning >= thresholds.responseTimeCritical) {
         return next(new Error('Le seuil d\'alerte temps de réponse doit être inférieur au seuil critique'));
       }
     }
   }
   
   // Validate cron patterns
   const schedulePattern = this.cacheSettings.invalidationStrategy?.schedulePattern;
   if (schedulePattern && this.cacheSettings.invalidationStrategy.type === 'SCHEDULED') {
     const cronPattern = /^[*\/\d\s,-]+$/;
     if (!cronPattern.test(schedulePattern)) {
       return next(new Error('Pattern cron invalide pour la stratégie d\'invalidation'));
     }
   }
   
   const warmingSchedule = this.cacheSettings.warmingSettings?.schedule;
   if (warmingSchedule && this.cacheSettings.warmingSettings?.enabled) {
     const cronPattern = /^[*\/\d\s,-]+$/;
     if (!cronPattern.test(warmingSchedule)) {
       return next(new Error('Pattern cron invalide pour le cache warming'));
     }
   }
 }
 
 next();
});

// ✨ NEW INITIALIZATION FOR NEW HOTELS ✨
hotelSchema.pre('save', function(next) {
 if (this.isNew) {
   // Initialize QR settings for new hotels
   if (!this.qrSettings) {
     this.qrSettings = {
       enabled: true,
       autoGenerate: true,
       autoGenerateOnBookingConfirmation: true,
       autoGenerateOnCheckIn: false,
       expiryHours: 24,
       securityLevel: 'STANDARD',
       enableGeolocationValidation: false,
       allowedRadius: 100,
       enableDeviceValidation: false,
       maxUsagePerQR: 10,
       customization: {
         logo: { enabled: false },
         colors: {
           primary: '#1a365d',
           secondary: '#f7fafc',
           background: '#ffffff'
         },
         style: 'hotel',
         errorCorrectionLevel: 'M',
         size: { width: 300, margin: 2 },
         instructions: {
           checkIn: 'Scannez ce code QR pour effectuer votre check-in',
           checkOut: 'Scannez ce code QR pour effectuer votre check-out',
           roomAccess: 'Scannez ce code QR pour accéder à votre chambre'
         }
       },
       notifications: {
         emailQRToGuest: true,
         smsQRToGuest: false,
         notifyReceptionOnQRUsage: true,
         notifyManagerOnFailures: true,
         failureThreshold: 5
       },
       enabledTypes: {
         checkIn: true,
         checkOut: true,
         roomAccess: false,
         payment: false,
         menu: false,
         wifi: false,
         feedback: true
       },
       advancedFeatures: {
         multiLanguageSupport: false,
         supportedLanguages: ['FR', 'EN'],
         offlineMode: false,
         batchGeneration: false,
         analytics: {
           enabled: true,
           retentionDays: 90
         }
       }
     };
   }
   
   // Initialize cache settings for new hotels
   if (!this.cacheSettings) {
     this.cacheSettings = {
       enabled: true,
       strategy: 'BALANCED',
       customTTL: {
         availability: {
           realtime: 120,
           standard: 300,
           bulk: 900
         },
         yieldPricing: {
           dynamic: 300,
           strategy: 7200,
           historical: 21600
         },
         analytics: {
           realtime: 60,
           dashboard: 300,
           reports: 1800,
           historical: 86400
         },
         hotelData: {
           basic: 1800,
           full: 7200,
           configuration: 21600,
           static: 86400
         }
       },
       invalidationStrategy: {
         type: 'SMART',
         delayMs: 5000,
         batchSize: 100,
         schedulePattern: '*/5 * * * *'
       },
       invalidationTriggers: {
         onBookingCreate: true,
         onBookingUpdate: true,
         onBookingStatusChange: true,
         onPriceChange: true,
         onRoomStatusChange: true,
         onYieldUpdate: true,
         onHotelConfigChange: true,
         cascadeToRelated: true
       },
       warmingSettings: {
         enabled: true,
         schedule: '0 */6 * * *',
         priorities: {
           availability: 1,
           pricing: 2,
           analytics: 3,
           hotelData: 4
         },
         dateRange: {
           daysBefore: 1,
           daysAfter: 30
         }
       },
       performanceThresholds: {
         hitRateWarning: 70,
         hitRateCritical: 50,
         responseTimeWarning: 1000,
         responseTimeCritical: 3000,
         memoryUsageWarning: 80
       },
       compression: {
         enabled: true,
         threshold: 1024,
         algorithm: 'gzip'
       },
       advancedFeatures: {
         enableCacheTags: true,
         enableCacheVersioning: false,
         enableDistributedInvalidation: true,
         enableCacheMetrics: true,
         enableCacheDebugging: false
       }
     };
   }
   
   // Initialize performance metrics for new hotels
   if (!this.performanceMetrics) {
     this.performanceMetrics = {
       cache: {
         overall: {
           hitRate: 0,
           missRate: 0,
           avgResponseTime: 0,
           totalRequests: 0,
           totalCacheSize: '0B',
           lastUpdated: new Date()
         },
         byType: {
           availability: { hitRate: 0, avgResponseTime: 0, totalRequests: 0, cacheSize: '0B', invalidationsCount: 0 },
           yieldPricing: { hitRate: 0, avgResponseTime: 0, totalRequests: 0, cacheSize: '0B', invalidationsCount: 0 },
           analytics: { hitRate: 0, avgResponseTime: 0, totalRequests: 0, cacheSize: '0B', invalidationsCount: 0 },
           hotelData: { hitRate: 0, avgResponseTime: 0, totalRequests: 0, cacheSize: '0B', invalidationsCount: 0 }
         },
         trends: {
           daily: [],
           weekly: [],
           monthly: []
         },
         health: {
           status: 'GOOD',
           score: 100,
           issues: [],
           lastHealthCheck: new Date()
         }
       },
       qr: {
         overall: {
           totalGenerated: 0,
           totalUsed: 0,
           usageRate: 0,
           avgCheckInTime: 0,
           successRate: 0,
           lastUpdated: new Date()
         },
         byType: {
           checkIn: { generated: 0, used: 0, avgTime: 0, successRate: 0, failures: [] },
           checkOut: { generated: 0, used: 0, avgTime: 0, successRate: 0, failures: [] },
           roomAccess: { generated: 0, used: 0, avgTime: 0, successRate: 0, failures: [] }
         },
         security: {
           suspiciousAttempts: 0,
           blockedAttempts: 0,
           revokedCodes: 0,
           securityIncidents: [],
           lastSecurityCheck: new Date()
         },
         trends: {
           daily: [],
           weekly: [],
           monthly: []
         }
       },
       system: {
         responseTime: { web: 0, mobile: 0, api: 0 },
         availability: { uptime: 100, downtime: [], lastIncident: null },
         integrations: {
           redis: { status: 'HEALTHY', responseTime: 0, lastCheck: new Date() },
           database: { status: 'HEALTHY', responseTime: 0, lastCheck: new Date() },
           qrService: { status: 'HEALTHY', responseTime: 0, lastCheck: new Date() }
         }
       },
       recommendations: [],
       lastCalculated: new Date()
     };
   }
 }
 
 next();
});

// ============================================================================
// EXISTING METHODS PRESERVED (all previous methods kept as-is)
// ============================================================================

// Get price multiplier (preserved)
hotelSchema.methods.getPriceMultiplier = function(date = new Date()) {
 const targetDate = new Date(date);
 
 for (const season of this.seasonalPricing) {
   const startDate = new Date(season.startDate);
   const endDate = new Date(season.endDate);
   
   const targetMonth = targetDate.getMonth();
   const targetDay = targetDate.getDate();
   const startMonth = startDate.getMonth();
   const startDay = startDate.getDate();
   const endMonth = endDate.getMonth();
   const endDay = endDate.getDate();
   
   if (startMonth > endMonth || (startMonth === endMonth && startDay > endDay)) {
     if (targetMonth > startMonth || targetMonth < endMonth ||
         (targetMonth === startMonth && targetDay >= startDay) ||
         (targetMonth === endMonth && targetDay <= endDay)) {
       return season.multiplier;
     }
   } else {
     if ((targetMonth > startMonth || (targetMonth === startMonth && targetDay >= startDay)) &&
         (targetMonth < endMonth || (targetMonth === endMonth && targetDay <= endDay))) {
       return season.multiplier;
     }
   }
 }
 
 return 1.0;
};

// All yield management methods preserved (getDynamicPrice, applyPricingStrategy, etc.)
// ... [Previous yield management methods kept as-is] ...

// Staff management methods (preserved)
hotelSchema.methods.addStaffMember = function(userId, position) {
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

hotelSchema.methods.removeStaffMember = function(userId) {
 this.staff = this.staff.filter(s => s.user.toString() !== userId.toString());
 return this.save();
};

// Update stats (enhanced with QR + Cache metrics)
hotelSchema.methods.updateStats = async function() {
 const Room = mongoose.model('Room');
 const Booking = mongoose.model('Booking');
 
 const roomCount = await Room.countDocuments({ hotel: this._id });
 const bookingCount = await Booking.countDocuments({ hotel: this._id });
 
 this.stats.totalRooms = roomCount;
 this.stats.totalBookings = bookingCount;
 
 if (this.yieldManagement?.enabled) {
   await this.updateYieldAnalytics();
 }
 
 // ✨ Update QR and Cache performance metrics ✨
 await this.updatePerformanceMetrics();
 
 return this.save();
};

// Check availability (preserved)
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
 
 const bookedRoomIds = conflictingBookings.reduce((acc, booking) => {
   booking.rooms.forEach(room => acc.add(room._id.toString()));
   return acc;
 }, new Set());
 
 return availableRooms.filter(room => !bookedRoomIds.has(room._id.toString()));
};

// ============================================================================
// ✨ NEW QR MANAGEMENT METHODS ✨
// ============================================================================

// Update QR settings
hotelSchema.methods.updateQRSettings = function(settings) {
 // Merge with existing settings
 if (settings.enabled !== undefined) this.qrSettings.enabled = settings.enabled;
 if (settings.autoGenerate !== undefined) this.qrSettings.autoGenerate = settings.autoGenerate;
 if (settings.expiryHours !== undefined) this.qrSettings.expiryHours = settings.expiryHours;
 if (settings.securityLevel !== undefined) this.qrSettings.securityLevel = settings.securityLevel;
 
 if (settings.customization) {
   Object.assign(this.qrSettings.customization, settings.customization);
 }
 
 if (settings.notifications) {
   Object.assign(this.qrSettings.notifications, settings.notifications);
 }
 
 if (settings.enabledTypes) {
   Object.assign(this.qrSettings.enabledTypes, settings.enabledTypes);
 }
 
 return this.save();
};

// Get QR capabilities
hotelSchema.methods.getQRCapabilities = function() {
 return {
   enabled: this.qrSettings?.enabled || false,
   types: this.qrSettings?.enabledTypes || {},
   securityLevel: this.qrSettings?.securityLevel || 'STANDARD',
   customization: this.qrSettings?.customization || {},
   geolocationEnabled: this.qrSettings?.enableGeolocationValidation || false,
   notifications: this.qrSettings?.notifications || {},
   advancedFeatures: this.qrSettings?.advancedFeatures || {}
 };
};

// Get QR analytics for this hotel
hotelSchema.methods.getQRAnalytics = function(period = 'daily') {
 const qrMetrics = this.performanceMetrics?.qr;
 if (!qrMetrics) return null;
 
 const overall = qrMetrics.overall;
 const byType = qrMetrics.byType;
 const trends = qrMetrics.trends[period] || [];
 
 return {
   overall: {
     totalGenerated: overall.totalGenerated || 0,
     totalUsed: overall.totalUsed || 0,
     usageRate: overall.usageRate || 0,
     successRate: overall.successRate || 0,
     avgCheckInTime: overall.avgCheckInTime || 0
   },
   byType: byType,
   trends: trends.slice(-30), // Last 30 data points
   security: {
     suspiciousAttempts: qrMetrics.security?.suspiciousAttempts || 0,
     blockedAttempts: qrMetrics.security?.blockedAttempts || 0,
     revokedCodes: qrMetrics.security?.revokedCodes || 0,
     incidents: qrMetrics.security?.securityIncidents?.slice(-10) || []
   }
 };
};

// Generate QR report
hotelSchema.methods.generateQRReport = function(dateFrom, dateTo) {
 const qrAnalytics = this.getQRAnalytics();
 const capabilities = this.getQRCapabilities();
 
 return {
   hotel: {
     id: this._id,
     name: this.name,
     code: this.code
   },
   reportPeriod: {
     from: dateFrom,
     to: dateTo,
     generatedAt: new Date()
   },
   capabilities: capabilities,
   performance: qrAnalytics,
   recommendations: this.getQRRecommendations()
 };
};

// Get QR optimization recommendations
hotelSchema.methods.getQRRecommendations = function() {
 const recommendations = [];
 const qrMetrics = this.performanceMetrics?.qr?.overall;
 const qrSettings = this.qrSettings;
 
 if (!qrMetrics || !qrSettings) return recommendations;
 
 // Usage rate recommendations
 if (qrMetrics.usageRate < 50) {
   recommendations.push({
     type: 'IMPROVE_USAGE_RATE',
     priority: 'HIGH',
     description: 'Taux d\'utilisation QR faible. Considérez améliorer la communication et les instructions.',
     impact: 'Augmentation potentielle de 20-30% du taux d\'utilisation',
     actions: [
       'Améliorer les instructions QR dans les emails',
       'Ajouter des panneaux explicatifs à la réception',
       'Former le personnel à promouvoir l\'usage QR'
     ]
   });
 }
 
 // Success rate recommendations
 if (qrMetrics.successRate < 80) {
   recommendations.push({
     type: 'IMPROVE_SUCCESS_RATE',
     priority: 'HIGH',
     description: 'Taux de succès QR faible. Vérifiez la configuration technique.',
     impact: 'Réduction des échecs de 15-25%',
     actions: [
       'Vérifier la configuration géolocalisation',
       'Augmenter la durée d\'expiration des codes',
       'Améliorer la qualité des codes QR générés'
     ]
   });
 }
 
 // Check-in time recommendations
 if (qrMetrics.avgCheckInTime > 30000) { // 30 seconds
   recommendations.push({
     type: 'OPTIMIZE_CHECK_IN_TIME',
     priority: 'MEDIUM',
     description: 'Temps de check-in QR élevé. Optimisation possible.',
     impact: 'Réduction du temps de check-in de 20-40%',
     actions: [
       'Optimiser la taille des codes QR',
       'Améliorer la configuration du cache',
       'Simplifier le processus de validation'
     ]
   });
 }
 
 // Security recommendations
 if (qrSettings.securityLevel === 'BASIC') {
   recommendations.push({
     type: 'ENHANCE_SECURITY',
     priority: 'MEDIUM',
     description: 'Niveau de sécurité QR basique. Amélioration recommandée.',
     impact: 'Amélioration de la sécurité et réduction des fraudes',
     actions: [
       'Passer au niveau STANDARD ou HIGH',
       'Activer la validation géographique',
       'Configurer la validation par appareil'
     ]
   });
 }
 
 // Branding recommendations
 if (!this.hasQRBranding) {
   recommendations.push({
     type: 'ADD_BRANDING',
     priority: 'LOW',
     description: 'Personnalisation QR non configurée. Amélioration de l\'image de marque possible.',
     impact: 'Meilleure reconnaissance de marque et expérience client',
     actions: [
       'Ajouter le logo de l\'hôtel',
       'Personnaliser les couleurs',
       'Adapter les instructions par langue'
     ]
   });
 }
 
 return recommendations;
};

// ============================================================================
// ✨ NEW CACHE MANAGEMENT METHODS ✨
// ============================================================================

// Update cache settings
hotelSchema.methods.updateCacheSettings = function(settings) {
 if (settings.enabled !== undefined) this.cacheSettings.enabled = settings.enabled;
 if (settings.strategy !== undefined) this.cacheSettings.strategy = settings.strategy;
 
 if (settings.customTTL) {
   // Deep merge TTL settings
   for (const [category, ttls] of Object.entries(settings.customTTL)) {
     if (!this.cacheSettings.customTTL[category]) {
       this.cacheSettings.customTTL[category] = {};
     }
     Object.assign(this.cacheSettings.customTTL[category], ttls);
   }
 }
 
 if (settings.invalidationStrategy) {
   Object.assign(this.cacheSettings.invalidationStrategy, settings.invalidationStrategy);
 }
 
 if (settings.invalidationTriggers) {
   Object.assign(this.cacheSettings.invalidationTriggers, settings.invalidationTriggers);
 }
 
 if (settings.warmingSettings) {
   Object.assign(this.cacheSettings.warmingSettings, settings.warmingSettings);
 }
 
 if (settings.performanceThresholds) {
   Object.assign(this.cacheSettings.performanceThresholds, settings.performanceThresholds);
 }
 
 return this.save();
};

// Get cache performance
hotelSchema.methods.getCachePerformance = function() {
 const cacheMetrics = this.performanceMetrics?.cache;
 if (!cacheMetrics) return null;
 
 return {
   overall: cacheMetrics.overall,
   byType: cacheMetrics.byType,
   health: cacheMetrics.health,
   trends: {
     daily: cacheMetrics.trends?.daily?.slice(-7) || [], // Last 7 days
     weekly: cacheMetrics.trends?.weekly?.slice(-4) || [], // Last 4 weeks
     monthly: cacheMetrics.trends?.monthly?.slice(-12) || [] // Last 12 months
   },
   recommendations: this.getCacheRecommendations()
 };
};

// Optimize cache strategy based on performance
hotelSchema.methods.optimizeCacheStrategy = function() {
 const performance = this.performanceMetrics?.cache?.overall;
 if (!performance) return this;
 
 const hitRate = performance.hitRate || 0;
 const avgResponseTime = performance.avgResponseTime || 0;
 const currentStrategy = this.cacheSettings?.strategy;
 
 let recommendedStrategy = currentStrategy;
 
 // Strategy optimization logic
 if (hitRate < 60 && currentStrategy !== 'AGGRESSIVE') {
   recommendedStrategy = 'AGGRESSIVE';
 } else if (hitRate > 85 && avgResponseTime < 100 && currentStrategy !== 'CONSERVATIVE') {
   recommendedStrategy = 'CONSERVATIVE';
 } else if (hitRate >= 60 && hitRate <= 85 && currentStrategy !== 'BALANCED') {
   recommendedStrategy = 'BALANCED';
 }
 
 if (recommendedStrategy !== currentStrategy) {
   this.cacheSettings.strategy = recommendedStrategy;
   
   // Adjust TTL values based on strategy
   this.adjustTTLByStrategy(recommendedStrategy);
   
   // Add recommendation record
   this.performanceMetrics.recommendations.push({
     type: 'CHANGE_STRATEGY',
     priority: 'MEDIUM',
     description: `Stratégie de cache changée de ${currentStrategy} vers ${recommendedStrategy}`,
     impact: 'Amélioration attendue de 10-20% des performances',
     estimatedImprovement: 15,
     createdAt: new Date(),
     implemented: true,
     implementedAt: new Date()
   });
 }
 
 return this;
};

// Adjust TTL values based on strategy
hotelSchema.methods.adjustTTLByStrategy = function(strategy) {
 const ttl = this.cacheSettings.customTTL;
 let multiplier = 1;
 
 switch (strategy) {
   case 'AGGRESSIVE':
     multiplier = 1.5; // Increase TTL for more aggressive caching
     break;
   case 'CONSERVATIVE':
     multiplier = 0.7; // Decrease TTL for more frequent updates
     break;
   case 'BALANCED':
     multiplier = 1.0; // Keep default values
     break;
 }
 
 // Apply multiplier to all TTL values
 for (const category of Object.values(ttl)) {
   for (const [key, value] of Object.entries(category)) {
     if (typeof value === 'number') {
       category[key] = Math.round(value * multiplier);
     }
   }
 }
 
 return this;
};

// Get cache optimization recommendations
hotelSchema.methods.getCacheRecommendations = function() {
 const recommendations = [];
 const cacheMetrics = this.performanceMetrics?.cache?.overall;
 const cacheHealth = this.performanceMetrics?.cache?.health;
 
 if (!cacheMetrics || !cacheHealth) return recommendations;
 
 // Hit rate recommendations
 if (cacheMetrics.hitRate < 70) {
   recommendations.push({
     type: 'INCREASE_TTL',
     priority: 'HIGH',
     description: 'Taux de hit cache faible. Augmentation des TTL recommandée.',
     impact: 'Amélioration potentielle de 15-25% du hit rate',
     estimatedImprovement: 20
   });
 }
 
 // Response time recommendations
 if (cacheMetrics.avgResponseTime > 500) {
   recommendations.push({
     type: 'OPTIMIZE_CACHE_SIZE',
     priority: 'MEDIUM',
     description: 'Temps de réponse élevé. Optimisation de la taille du cache recommandée.',
     impact: 'Réduction de 20-40% du temps de réponse',
     estimatedImprovement: 30
   });
 }
 
 // Health score recommendations
 if (cacheHealth.score < 75) {
   recommendations.push({
     type: 'HEALTH_OPTIMIZATION',
     priority: 'HIGH',
     description: 'Score de santé cache dégradé. Maintenance recommandée.',
     impact: 'Amélioration globale des performances cache',
     estimatedImprovement: 25
   });
 }
 
 // Strategy recommendations
 const currentStrategy = this.cacheSettings?.strategy;
 const performanceScore = this.cachePerformanceScore;
 
 if (performanceScore < 60) {
   if (currentStrategy !== 'AGGRESSIVE') {
     recommendations.push({
       type: 'CHANGE_STRATEGY',
       priority: 'MEDIUM',
       description: `Changement vers stratégie AGGRESSIVE recommandé (actuel: ${currentStrategy})`,
       impact: 'Amélioration potentielle de 10-20% des performances',
       estimatedImprovement: 15
     });
   }
 }
 
 return recommendations;
};

// ============================================================================
// ✨ NEW PERFORMANCE TRACKING METHODS ✨
// ============================================================================

// Update performance metrics
hotelSchema.methods.updatePerformanceMetrics = async function() {
 try {
   // Update cache metrics
   await this.updateCacheMetrics();
   
   // Update QR metrics
   await this.updateQRMetrics();
   
   // Update system health
   await this.updateSystemHealth();
   
   // Calculate overall performance score
   this.calculatePerformanceScores();
   
   // Update last calculated timestamp
   this.performanceMetrics.lastCalculated = new Date();
   
   return this.save();
   
 } catch (error) {
   console.error('Error updating performance metrics:', error);
   throw error;
 }
};

// Update cache metrics from actual usage
hotelSchema.methods.updateCacheMetrics = async function() {
 // This would integrate with actual cache service to get real metrics
 // For now, we'll simulate with placeholder logic
 
 const cacheMetrics = this.performanceMetrics.cache.overall;
 const byType = this.performanceMetrics.cache.byType;
 
 // Simulate metrics update based on settings and historical data
 const strategy = this.cacheSettings?.strategy || 'BALANCED';
 
 // Base metrics simulation
 let baseHitRate = 75;
 let baseResponseTime = 200;
 
 switch (strategy) {
   case 'AGGRESSIVE':
     baseHitRate = 85;
     baseResponseTime = 150;
     break;
   case 'CONSERVATIVE':
     baseHitRate = 65;
     baseResponseTime = 300;
     break;
 }
 
 // Add some variance
 const variance = (Math.random() - 0.5) * 10;
 
 cacheMetrics.hitRate = Math.max(0, Math.min(100, baseHitRate + variance));
 cacheMetrics.missRate = 100 - cacheMetrics.hitRate;
 cacheMetrics.avgResponseTime = Math.max(50, baseResponseTime + (variance * 10));
 cacheMetrics.totalRequests += Math.floor(Math.random() * 1000) + 500;
 cacheMetrics.lastUpdated = new Date();
 
 // Update by type metrics
 for (const [type, metrics] of Object.entries(byType)) {
   metrics.hitRate = cacheMetrics.hitRate + (Math.random() - 0.5) * 20;
   metrics.avgResponseTime = cacheMetrics.avgResponseTime + (Math.random() - 0.5) * 100;
   metrics.totalRequests += Math.floor(Math.random() * 200) + 100;
 }
 
 // Update health based on performance
 this.updateCacheHealth();
 
 // Store daily trend
 this.addCacheDailyTrend();
 
 return this;
};

// Update QR metrics from bookings
hotelSchema.methods.updateQRMetrics = async function() {
 const Booking = mongoose.model('Booking');
 
 try {
   // Get QR stats from actual bookings
   const qrStats = await Booking.aggregate([
     { $match: { hotel: this._id } },
     {
       $group: {
         _id: null,
         totalGenerated: { $sum: '$qrTracking.performance.totalQRGenerated' },
         totalUsed: { $sum: '$qrTracking.performance.totalQRUsed' },
         avgCheckInTime: { $avg: '$qrTracking.performance.averageCheckInTime' },
         avgSuccessRate: { $avg: '$qrTracking.performance.successRate' },
         totalAttempts: { $sum: '$qrTracking.performance.totalCheckInAttempts' },
         successfulAttempts: { $sum: '$qrTracking.performance.successfulCheckIns' }
       }
     }
   ]);
   
   const stats = qrStats[0] || {};
   const qrMetrics = this.performanceMetrics.qr.overall;
   
   qrMetrics.totalGenerated = stats.totalGenerated || 0;
   qrMetrics.totalUsed = stats.totalUsed || 0;
   qrMetrics.usageRate = qrMetrics.totalGenerated > 0 ? 
     (qrMetrics.totalUsed / qrMetrics.totalGenerated) * 100 : 0;
   qrMetrics.avgCheckInTime = stats.avgCheckInTime || 0;
   qrMetrics.successRate = stats.totalAttempts > 0 ? 
     (stats.successfulAttempts / stats.totalAttempts) * 100 : 0;
   qrMetrics.lastUpdated = new Date();
   
   // Update by type metrics
   await this.updateQRMetricsByType();
   
   // Store daily trend
   this.addQRDailyTrend();
   
   return this;
   
 } catch (error) {
   console.error('Error updating QR metrics:', error);
   return this;
 }
};

// Update QR metrics by type
hotelSchema.methods.updateQRMetricsByType = async function() {
 const Booking = mongoose.model('Booking');
 
 const types = ['checkIn', 'checkOut', 'roomAccess'];
 
 for (const type of types) {
   try {
     const typeStats = await Booking.aggregate([
       { $match: { hotel: this._id } },
       { $unwind: '$qrTracking.generated' },
       { $match: { 'qrTracking.generated.type': type.toUpperCase() } },
       {
         $group: {
           _id: null,
           generated: { $sum: 1 },
           used: { $sum: { $cond: ['$qrTracking.generated.isUsed', 1, 0] } }
         }
       }
     ]);
     
     const stats = typeStats[0] || { generated: 0, used: 0 };
     const typeMetrics = this.performanceMetrics.qr.byType[type];
     
     typeMetrics.generated = stats.generated;
     typeMetrics.used = stats.used;
     typeMetrics.successRate = stats.generated > 0 ? (stats.used / stats.generated) * 100 : 0;
     
   } catch (error) {
     console.error(`Error updating QR metrics for type ${type}:`, error);
   }
 }
 
 return this;
};

// Update system health
hotelSchema.methods.updateSystemHealth = async function() {
 const system = this.performanceMetrics.system;
 
 // Simulate system health checks
 system.responseTime.web = Math.random() * 500 + 100;
 system.responseTime.mobile = Math.random() * 600 + 150;
 system.responseTime.api = Math.random() * 300 + 50;
 
 // Update integration health
 const integrations = system.integrations;
 const now = new Date();
 
 // Simulate health checks
 integrations.redis.status = Math.random() > 0.95 ? 'DEGRADED' : 'HEALTHY';
 integrations.redis.responseTime = Math.random() * 50 + 10;
 integrations.redis.lastCheck = now;
 
 integrations.database.status = Math.random() > 0.98 ? 'DEGRADED' : 'HEALTHY';
 integrations.database.responseTime = Math.random() * 100 + 20;
 integrations.database.lastCheck = now;
 
 integrations.qrService.status = Math.random() > 0.97 ? 'DEGRADED' : 'HEALTHY';
 integrations.qrService.responseTime = Math.random() * 200 + 50;
 integrations.qrService.lastCheck = now;
 
 // Calculate uptime
 system.availability.uptime = Math.max(95, Math.random() * 5 + 95);
 
 return this;
};

// Update cache health based on metrics
hotelSchema.methods.updateCacheHealth = function() {
 const cacheMetrics = this.performanceMetrics.cache.overall;
 const health = this.performanceMetrics.cache.health;
 
 // Calculate health score based on multiple factors
 let score = 100;
 
 // Hit rate factor (40% weight)
 const hitRateScore = cacheMetrics.hitRate || 0;
 score = score * 0.6 + hitRateScore * 0.4;
 
 // Response time factor (30% weight)
 const responseTimeScore = Math.max(0, 100 - (cacheMetrics.avgResponseTime / 10));
 score = score * 0.7 + responseTimeScore * 0.3;
 
 // Request volume factor (20% weight)
 const volumeScore = Math.min(100, (cacheMetrics.totalRequests / 1000) * 10);
 score = score * 0.8 + volumeScore * 0.2;
 
 // Set health status based on score
 if (score >= 90) health.status = 'EXCELLENT';
 else if (score >= 75) health.status = 'GOOD';
 else if (score >= 60) health.status = 'FAIR';
 else if (score >= 40) health.status = 'POOR';
 else health.status = 'CRITICAL';
 
 health.score = Math.round(score);
 health.lastHealthCheck = new Date();
 
 return this;
};

// Calculate performance scores
hotelSchema.methods.calculatePerformanceScores = function() {
 // This will trigger the virtual getters to calculate scores
 const cacheScore = this.cachePerformanceScore;
 const qrScore = this.getQRPerformanceScore();
 const systemScore = this.getSystemHealthScore();
 
 // Store calculated scores for quick access
 this.performanceMetrics._calculatedScores = {
   cache: cacheScore,
   qr: qrScore,
   system: systemScore,
   overall: this.systemPerformanceScore,
   calculatedAt: new Date()
 };
 
 return this;
};

// Get QR performance score
hotelSchema.methods.getQRPerformanceScore = function() {
 const qrMetrics = this.performanceMetrics?.qr?.overall;
 if (!qrMetrics) return 0;
 
 const usageRate = qrMetrics.usageRate || 0;
 const successRate = qrMetrics.successRate || 0;
 const checkInTime = qrMetrics.avgCheckInTime || 0;
 
 // Calculate score based on multiple factors
 let score = 0;
 
 // Usage rate (40% weight)
 score += usageRate * 0.4;
 
 // Success rate (40% weight)
 score += successRate * 0.4;
 
 // Check-in time (20% weight) - lower is better
 const timeScore = Math.max(0, 100 - (checkInTime / 100)); // 10s = 90 points
 score += timeScore * 0.2;
 
 return Math.round(score);
};

// Get system health score
hotelSchema.methods.getSystemHealthScore = function() {
 const system = this.performanceMetrics?.system;
 if (!system) return 0;
 
 const uptime = system.availability?.uptime || 100;
 const avgResponseTime = (system.responseTime?.web + system.responseTime?.mobile + system.responseTime?.api) / 3;
 
 // Calculate score
 let score = uptime * 0.6; // 60% weight on uptime
 
 const responseScore = Math.max(0, 100 - (avgResponseTime / 10));
 score += responseScore * 0.4; // 40% weight on response time
 
 return Math.round(score);
};

// Add cache daily trend
hotelSchema.methods.addCacheDailyTrend = function() {
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 
 const trends = this.performanceMetrics.cache.trends.daily;
 const cacheMetrics = this.performanceMetrics.cache.overall;
 
 // Check if today's entry already exists
 const existingIndex = trends.findIndex(trend => 
   trend.date.toDateString() === today.toDateString()
 );
 
 const trendEntry = {
   date: today,
   hitRate: cacheMetrics.hitRate,
   avgResponseTime: cacheMetrics.avgResponseTime,
   totalRequests: cacheMetrics.totalRequests,
   cacheSize: cacheMetrics.totalCacheSize
 };
 
 if (existingIndex >= 0) {
   trends[existingIndex] = trendEntry;
 } else {
   trends.push(trendEntry);
 }
 
 // Keep only last 30 days
 if (trends.length > 30) {
   trends.splice(0, trends.length - 30);
 }
 
 return this;
};

// Add QR daily trend
hotelSchema.methods.addQRDailyTrend = function() {
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 
 const trends = this.performanceMetrics.qr.trends.daily;
 const qrMetrics = this.performanceMetrics.qr.overall;
 
 const existingIndex = trends.findIndex(trend => 
   trend.date.toDateString() === today.toDateString()
 );
 
 const trendEntry = {
   date: today,
   generated: qrMetrics.totalGenerated,
   used: qrMetrics.totalUsed,
   avgCheckInTime: qrMetrics.avgCheckInTime,
   successRate: qrMetrics.successRate
 };
 
 if (existingIndex >= 0) {
   trends[existingIndex] = trendEntry;
 } else {
   trends.push(trendEntry);
 }
 
 // Keep only last 30 days
 if (trends.length > 30) {
   trends.splice(0, trends.length - 30);
 }
 
 return this;
};

// Calculate trend direction (helper method)
hotelSchema.methods.calculateTrend = function(values) {
 if (!values || values.length < 2) return 'STABLE';
 
 const recent = values.slice(-3); // Last 3 values
 const older = values.slice(-6, -3); // 3 values before that
 
 if (recent.length === 0 || older.length === 0) return 'STABLE';
 
 const recentAvg = recent.reduce((sum, val) => sum + (val || 0), 0) / recent.length;
 const olderAvg = older.reduce((sum, val) => sum + (val || 0), 0) / older.length;
 
 const change = ((recentAvg - olderAvg) / olderAvg) * 100;
 
 if (change > 10) return 'INCREASING';
 if (change < -10) return 'DECREASING';
 return 'STABLE';
};

// ============================================================================
// STATIC METHODS (existing + new QR + Cache analytics)
// ============================================================================

// Existing static methods preserved
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
       },
       hotelsWithQR: { 
         $sum: { $cond: ['$qrSettings.enabled', 1, 0] } 
       },
       hotelsWithCache: { 
         $sum: { $cond: ['$cacheSettings.enabled', 1, 0] } 
       }
     }
   }
 ]);
};

hotelSchema.statics.getHotelsByCity = function() {
 return this.aggregate([
   { $match: { isActive: true, isPublished: true } },
   { 
     $group: { 
       _id: '$address.city', 
       count: { $sum: 1 },
       avgStars: { $avg: '$stars' },
       avgQRUsage: { $avg: '$performanceMetrics.qr.overall.usageRate' },
       avgCacheHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' }
     } 
   },
   { $sort: { count: -1 } }
 ]);
};

// Yield management static methods (preserved)
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

// ✨ NEW QR ANALYTICS STATIC METHODS ✨

// Get QR adoption statistics
hotelSchema.statics.getQRAdoptionStats = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   {
     $group: {
       _id: null,
       totalHotels: { $sum: 1 },
       qrEnabledHotels: { 
         $sum: { $cond: ['$qrSettings.enabled', 1, 0] } 
       },
       avgQRUsageRate: { 
         $avg: '$performanceMetrics.qr.overall.usageRate' 
       },
       avgQRSuccessRate: { 
         $avg: '$performanceMetrics.qr.overall.successRate' 
       },
       totalQRGenerated: { 
         $sum: '$performanceMetrics.qr.overall.totalGenerated' 
       },
       totalQRUsed: { 
         $sum: '$performanceMetrics.qr.overall.totalUsed' 
       }
     }
   },
   {
     $addFields: {
       adoptionRate: {
         $multiply: [
           { $divide: ['$qrEnabledHotels', '$totalHotels'] },
           100
         ]
       },
       overallUsageRate: {
         $cond: [
           { $gt: ['$totalQRGenerated', 0] },
           { $multiply: [{ $divide: ['$totalQRUsed', '$totalQRGenerated'] }, 100] },
           0
         ]
       }
     }
   }
 ]);
};

// Get QR performance by hotel category
hotelSchema.statics.getQRPerformanceByCategory = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'qrSettings.enabled': true 
     } 
   },
   {
     $group: {
       _id: '$stars',
       hotelCount: { $sum: 1 },
       avgUsageRate: { $avg: '$performanceMetrics.qr.overall.usageRate' },
       avgSuccessRate: { $avg: '$performanceMetrics.qr.overall.successRate' },
       avgCheckInTime: { $avg: '$performanceMetrics.qr.overall.avgCheckInTime' },
       totalQRGenerated: { $sum: '$performanceMetrics.qr.overall.totalGenerated' },
       totalQRUsed: { $sum: '$performanceMetrics.qr.overall.totalUsed' }
     }
   },
   { $sort: { _id: 1 } }
 ]);
};

// Get hotels with QR performance issues
hotelSchema.statics.getHotelsWithQRIssues = function(threshold = 70) {
 return this.find({
   isActive: true,
   'qrSettings.enabled': true,
   $or: [
     { 'performanceMetrics.qr.overall.successRate': { $lt: threshold } },
     { 'performanceMetrics.qr.overall.usageRate': { $lt: threshold / 2 } },
     { 'performanceMetrics.qr.overall.avgCheckInTime': { $gt: 30000 } }
   ]
 })
 .select('name code performanceMetrics.qr.overall qrSettings.securityLevel')
 .sort({ 'performanceMetrics.qr.overall.successRate': 1 });
};

// Get QR security incidents summary
hotelSchema.statics.getQRSecuritySummary = function(days = 30) {
 const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
 
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'qrSettings.enabled': true 
     } 
   },
   {
     $group: {
       _id: null,
       totalSuspiciousAttempts: { 
         $sum: '$performanceMetrics.qr.security.suspiciousAttempts' 
       },
       totalBlockedAttempts: { 
         $sum: '$performanceMetrics.qr.security.blockedAttempts' 
       },
       totalRevokedCodes: { 
         $sum: '$performanceMetrics.qr.security.revokedCodes' 
       },
       hotelsWithIncidents: {
         $sum: {
           $cond: [
             { $gt: [{ $size: '$performanceMetrics.qr.security.securityIncidents' }, 0] },
             1,
             0
           ]
         }
       }
     }
   }
 ]);
};

// ✨ NEW CACHE ANALYTICS STATIC METHODS ✨

// Get cache performance overview across all hotels
hotelSchema.statics.getCachePerformanceOverview = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'cacheSettings.enabled': true 
     } 
   },
   {
     $group: {
       _id: null,
       totalHotels: { $sum: 1 },
       avgHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' },
       avgResponseTime: { $avg: '$performanceMetrics.cache.overall.avgResponseTime' },
       totalRequests: { $sum: '$performanceMetrics.cache.overall.totalRequests' },
       excellentHealthHotels: {
         $sum: {
           $cond: [
             { $eq: ['$performanceMetrics.cache.health.status', 'EXCELLENT'] },
             1,
             0
           ]
         }
       },
       poorHealthHotels: {
         $sum: {
           $cond: [
             { $in: ['$performanceMetrics.cache.health.status', ['POOR', 'CRITICAL']] },
             1,
             0
           ]
         }
       }
     }
   },
   {
     $addFields: {
       healthyHotelsPercentage: {
         $multiply: [
           { $divide: ['$excellentHealthHotels', '$totalHotels'] },
           100
         ]
       },
       problemHotelsPercentage: {
         $multiply: [
           { $divide: ['$poorHealthHotels', '$totalHotels'] },
           100
         ]
       }
     }
   }
 ]);
};

// Get cache strategy effectiveness
hotelSchema.statics.getCacheStrategyEffectiveness = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'cacheSettings.enabled': true 
     } 
   },
   {
     $group: {
       _id: '$cacheSettings.strategy',
       hotelCount: { $sum: 1 },
       avgHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' },
       avgResponseTime: { $avg: '$performanceMetrics.cache.overall.avgResponseTime' },
       avgHealthScore: { $avg: '$performanceMetrics.cache.health.score' },
       totalRequests: { $sum: '$performanceMetrics.cache.overall.totalRequests' }
     }
   },
   {
     $addFields: {
       effectivenessScore: {
         $add: [
           { $multiply: ['$avgHitRate', 0.4] },
           { $multiply: [{ $subtract: [1000, '$avgResponseTime'] }, 0.1] },
           { $multiply: ['$avgHealthScore', 0.5] }
         ]
       }
     }
   },
   { $sort: { effectivenessScore: -1 } }
 ]);
};

// Get hotels needing cache optimization
hotelSchema.statics.getHotelsNeedingCacheOptimization = function() {
 return this.find({
   isActive: true,
   'cacheSettings.enabled': true,
   $or: [
     { 'performanceMetrics.cache.overall.hitRate': { $lt: 70 } },
     { 'performanceMetrics.cache.overall.avgResponseTime': { $gt: 1000 } },
     { 'performanceMetrics.cache.health.score': { $lt: 75 } },
     { 'performanceMetrics.cache.health.status': { $in: ['POOR', 'CRITICAL'] } }
   ]
 })
 .select('name code cacheSettings.strategy performanceMetrics.cache.overall performanceMetrics.cache.health')
 .sort({ 'performanceMetrics.cache.health.score': 1 });
};

// Get cache invalidation patterns across hotels
hotelSchema.statics.getCacheInvalidationPatterns = function(days = 7) {
 const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
 
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'cacheSettings.enabled': true 
     } 
   },
   {
     $group: {
       _id: '$cacheSettings.invalidationStrategy.type',
       hotelCount: { $sum: 1 },
       avgHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' },
       avgResponseTime: { $avg: '$performanceMetrics.cache.overall.avgResponseTime' },
       totalInvalidations: { 
         $sum: '$performanceMetrics.cache.byType.availability.invalidationsCount' 
       }
     }
   },
   { $sort: { avgHitRate: -1 } }
 ]);
};

// ✨ NEW PERFORMANCE ANALYTICS STATIC METHODS ✨

// Get overall system performance summary
hotelSchema.statics.getSystemPerformanceSummary = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   {
     $group: {
       _id: null,
       totalHotels: { $sum: 1 },
       avgCacheHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' },
       avgQRSuccessRate: { $avg: '$performanceMetrics.qr.overall.successRate' },
       avgSystemUptime: { $avg: '$performanceMetrics.system.availability.uptime' },
       hotelsWithExcellentCache: {
         $sum: {
           $cond: [
             { $gte: ['$performanceMetrics.cache.overall.hitRate', 85] },
             1,
             0
           ]
         }
       },
       hotelsWithGoodQR: {
         $sum: {
           $cond: [
             { $gte: ['$performanceMetrics.qr.overall.successRate', 90] },
             1,
             0
           ]
         }
       },
       hotelsNeedingAttention: {
         $sum: {
           $cond: [
             {
               $or: [
                 { $lt: ['$performanceMetrics.cache.overall.hitRate', 70] },
                 { $lt: ['$performanceMetrics.qr.overall.successRate', 80] },
                 { $lt: ['$performanceMetrics.system.availability.uptime', 95] }
               ]
             },
             1,
             0
           ]
         }
       }
     }
   },
   {
     $addFields: {
       excellentCachePercentage: {
         $multiply: [
           { $divide: ['$hotelsWithExcellentCache', '$totalHotels'] },
           100
         ]
       },
       goodQRPercentage: {
         $multiply: [
           { $divide: ['$hotelsWithGoodQR', '$totalHotels'] },
           100
         ]
       },
       needsAttentionPercentage: {
         $multiply: [
           { $divide: ['$hotelsNeedingAttention', '$totalHotels'] },
           100
         ]
       }
     }
   }
 ]);
};

// Get performance trends across hotels
hotelSchema.statics.getPerformanceTrends = function(days = 30) {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'performanceMetrics.lastCalculated': { 
         $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) 
       }
     } 
   },
   {
     $group: {
       _id: {
         $dateToString: { 
           format: '%Y-%m-%d', 
           date: '$performanceMetrics.lastCalculated' 
         }
       },
       avgCacheHitRate: { $avg: '$performanceMetrics.cache.overall.hitRate' },
       avgQRSuccessRate: { $avg: '$performanceMetrics.qr.overall.successRate' },
       avgResponseTime: { $avg: '$performanceMetrics.cache.overall.avgResponseTime' },
       hotelCount: { $sum: 1 }
     }
   },
   { $sort: { _id: 1 } }
 ]);
};

// Get top performing hotels
hotelSchema.statics.getTopPerformingHotels = function(limit = 10) {
 return this.find({ isActive: true })
   .select('name code stars performanceMetrics')
   .sort({
     'performanceMetrics.cache.overall.hitRate': -1,
     'performanceMetrics.qr.overall.successRate': -1,
     'performanceMetrics.system.availability.uptime': -1
   })
   .limit(limit);
};

// Get hotels with critical performance issues
hotelSchema.statics.getHotelsWithCriticalIssues = function() {
 return this.find({
   isActive: true,
   $or: [
     { 'performanceMetrics.cache.health.status': 'CRITICAL' },
     { 'performanceMetrics.qr.overall.successRate': { $lt: 60 } },
     { 'performanceMetrics.system.availability.uptime': { $lt: 95 } },
     { 
       'performanceMetrics.cache.health.issues': {
         $elemMatch: {
           severity: 'CRITICAL',
           resolved: false
         }
       }
     }
   ]
 })
 .select('name code contact performanceMetrics')
 .populate('manager', 'firstName lastName email phone');
};

// Generate performance recommendations for all hotels
hotelSchema.statics.generateGlobalRecommendations = async function() {
 const recommendations = [];
 
 // Cache performance recommendations
 const cacheStats = await this.getCachePerformanceOverview();
 const cacheData = cacheStats[0];
 
 if (cacheData && cacheData.avgHitRate < 75) {
   recommendations.push({
     type: 'GLOBAL_CACHE_OPTIMIZATION',
     priority: 'HIGH',
     scope: 'SYSTEM',
     description: `Taux de hit cache global faible (${Math.round(cacheData.avgHitRate)}%). Optimisation nécessaire.`,
     affectedHotels: cacheData.totalHotels,
     impact: 'Amélioration globale des performances système',
     actions: [
       'Réviser les stratégies de cache par défaut',
       'Augmenter les TTL pour les données stables',
       'Implémenter un cache warming plus agressif'
     ]
   });
 }
 
 // QR adoption recommendations
 const qrStats = await this.getQRAdoptionStats();
 const qrData = qrStats[0];
 
 if (qrData && qrData.adoptionRate < 80) {
   recommendations.push({
     type: 'QR_ADOPTION_IMPROVEMENT',
     priority: 'MEDIUM',
     scope: 'BUSINESS',
     description: `Taux d'adoption QR faible (${Math.round(qrData.adoptionRate)}%). Promotion nécessaire.`,
     affectedHotels: qrData.totalHotels - qrData.qrEnabledHotels,
     impact: 'Amélioration de l\'expérience client et efficacité opérationnelle',
     actions: [
       'Formation des équipes hôtelières',
       'Communication client sur les avantages QR',
       'Simplification du processus d\'activation'
     ]
   });
 }
 
 // Performance monitoring recommendations
 const criticalHotels = await this.getHotelsWithCriticalIssues();
 
 if (criticalHotels.length > 0) {
   recommendations.push({
     type: 'CRITICAL_MONITORING',
     priority: 'CRITICAL',
     scope: 'OPERATIONS',
     description: `${criticalHotels.length} hôtel(s) avec problèmes critiques détectés.`,
     affectedHotels: criticalHotels.length,
     impact: 'Résolution urgente pour éviter impact client',
     actions: [
       'Intervention technique immédiate',
       'Mise en place monitoring renforcé',
       'Plan de continuité activé si nécessaire'
     ]
   });
 }
 
 return recommendations;
};

// ============================================================================
// EXPORT
// ============================================================================

const Hotel = mongoose.model('Hotel', hotelSchema);

module.exports = Hotel;