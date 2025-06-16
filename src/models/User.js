const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  // ============================================================================
  // EXISTING FIELDS - PRESERVED AS-IS (all previous fields kept)
  // ============================================================================
  
  // ===== INFORMATIONS PERSONNELLES =====
  firstName: {
    type: String,
    required: [true, 'Le prénom est requis'],
    trim: true,
    minlength: [2, 'Le prénom doit contenir au moins 2 caractères'],
    maxlength: [50, 'Le prénom ne peut pas dépasser 50 caractères']
  },
  
  lastName: {
    type: String,
    required: [true, 'Le nom est requis'],
    trim: true,
    minlength: [2, 'Le nom doit contenir au moins 2 caractères'],
    maxlength: [50, 'Le nom ne peut pas dépasser 50 caractères']
  },

  email: {
    type: String,
    required: [true, 'L\'email est requis'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Veuillez entrer un email valide'
    ]
  },

  password: {
    type: String,
    required: [true, 'Le mot de passe est requis'],
    minlength: [6, 'Le mot de passe doit contenir au moins 6 caractères'],
    select: false
  },

  phone: {
    type: String,
    required: [true, 'Le numéro de téléphone est requis'],
    trim: true,
    match: [
      /^(\+33|0)[1-9](\d{8})$/,
      'Veuillez entrer un numéro de téléphone français valide'
    ]
  },

  // ===== SYSTÈME DE RÔLES ÉTENDU =====
  role: {
    type: String,
    enum: {
      values: ['CLIENT', 'RECEPTIONIST', 'ADMIN'],
      message: 'Le rôle doit être CLIENT, RECEPTIONIST ou ADMIN'
    },
    default: 'CLIENT'
  },

  // ===== CHAMPS ENTREPRISE (all preserved) =====
  userType: { 
    type: String, 
    enum: ['individual', 'employee', 'manager', 'company_admin'], 
    default: 'individual',
    required: true
  },
  
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company',
    required: function() { 
      return this.userType !== 'individual'; 
    },
    validate: {
      validator: function(v) {
        return this.userType === 'individual' || v != null;
      },
      message: 'L\'entreprise est requise pour les utilisateurs non individuels'
    }
  },
  
  department: {
    type: String,
    trim: true,
    maxlength: [50, 'Le département ne peut pas dépasser 50 caractères'],
    required: function() {
      return ['employee', 'manager', 'company_admin'].includes(this.userType);
    }
  },
  
  jobTitle: {
    type: String,
    trim: true,
    maxlength: [100, 'Le titre du poste ne peut pas dépasser 100 caractères']
  },
  
  employeeId: {
    type: String,
    trim: true,
    maxlength: [20, 'L\'ID employé ne peut pas dépasser 20 caractères']
  },
  
  // ===== HIÉRARCHIE ENTREPRISE (all preserved) =====
  hierarchy: {
    manager: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      validate: {
        validator: function(v) {
          return !v || this.userType === 'individual';
        }
      }
    },
    canApprove: { 
      type: Boolean, 
      default: false 
    },
    approvalLimit: { 
      type: Number, 
      default: 0,
      min: [0, 'La limite d\'approbation ne peut être négative'],
      max: [100000, 'La limite d\'approbation ne peut excéder 100 000€']
    },
    subordinates: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    }],
    level: {
      type: Number,
      default: 1,
      min: [1, 'Le niveau hiérarchique minimum est 1'],
      max: [10, 'Le niveau hiérarchique maximum est 10']
    }
  },
  
  // ===== PERMISSIONS DÉTAILLÉES (all preserved) =====
  permissions: {
    canBook: { type: Boolean, default: true },
    canApprove: { type: Boolean, default: false },
    canViewReports: { type: Boolean, default: false },
    canManageTeam: { type: Boolean, default: false },
    canModifyBookings: { type: Boolean, default: false },
    canAccessFinancials: { type: Boolean, default: false },
    canManageContracts: { type: Boolean, default: false },
    maxBookingAmount: { type: Number, default: 5000, min: [0, 'Le montant maximum ne peut être négatif'] },
    maxAdvanceBooking: { type: Number, default: 90, min: [1, 'La réservation à l\'avance minimum est 1 jour'] },
    allowedHotels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' }],
    restrictedDates: [{
      startDate: Date,
      endDate: Date,
      reason: String
    }]
  },

  // ===== INFORMATIONS ENTREPRISE LEGACY =====
  companyName: {
    type: String,
    trim: true,
    maxlength: [100, 'Le nom de l\'entreprise ne peut pas dépasser 100 caractères']
  },

  siret: {
    type: String,
    trim: true,
    match: [/^\d{14}$/, 'Le numéro SIRET doit contenir 14 chiffres']
  },

  clientType: {
    type: String,
    enum: ['INDIVIDUAL', 'COMPANY'],
    default: 'INDIVIDUAL'
  },

  // ===== PARAMÈTRES UTILISATEUR ENTREPRISE (all preserved) =====
  enterpriseSettings: {
    notifications: {
      approvalRequests: { type: Boolean, default: true },
      teamBookings: { type: Boolean, default: false },
      budgetAlerts: { type: Boolean, default: true },
      contractUpdates: { type: Boolean, default: true }
    },
    defaultCostCenter: String,
    defaultProjectCode: String,
    autoApprovalAmount: { type: Number, default: 0 },
    delegations: [{
      delegateTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      startDate: Date,
      endDate: Date,
      permissions: [String],
      isActive: { type: Boolean, default: true }
    }]
  },

  // ===== STATUT ET SÉCURITÉ (all preserved) =====
  isActive: { type: Boolean, default: true },
  isEmailVerified: { type: Boolean, default: false },
  lastLogin: { type: Date },
  loginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date },
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // ===== PRÉFÉRENCES UTILISATEUR (all preserved) =====
  preferences: {
    language: { type: String, enum: ['fr', 'en', 'es', 'de'], default: 'fr' },
    timezone: { type: String, default: 'Europe/Paris' },
    currency: { type: String, enum: ['EUR', 'USD', 'GBP', 'CHF'], default: 'EUR' },
    notifications: {
      email: { type: Boolean, default: true },
      sms: { type: Boolean, default: false },
      inApp: { type: Boolean, default: true }
    },
    dashboard: {
      defaultView: { type: String, enum: ['bookings', 'calendar', 'stats', 'approvals'], default: 'bookings' },
      showTutorial: { type: Boolean, default: true }
    }
  },

  // ===== STATISTIQUES UTILISATEUR (all preserved) =====
  stats: {
    totalBookings: { type: Number, default: 0 },
    totalSpent: { type: Number, default: 0 },
    averageBookingValue: { type: Number, default: 0 },
    lastBookingDate: Date,
    favoriteHotels: [{
      hotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' },
      bookingCount: Number
    }],
    approvalsGiven: { type: Number, default: 0 },
    approvalsReceived: { type: Number, default: 0 }
  },

  // ===== PROGRAMME DE FIDÉLITÉ (all preserved) =====
  loyalty: {
    currentPoints: { type: Number, default: 0, min: [0, 'Les points ne peuvent pas être négatifs'], index: true },
    lifetimePoints: { type: Number, default: 0, min: [0, 'Les points lifetime ne peuvent pas être négatifs'], index: true },
    tier: { type: String, enum: { values: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'], message: 'Niveau de fidélité invalide' }, default: 'BRONZE', index: true },
    enrolledAt: { type: Date, default: Date.now },
    tierProgress: {
      pointsToNextTier: { type: Number, default: 1000, min: [0, 'Points vers niveau suivant ne peut être négatif'] },
      nextTier: { type: String, enum: ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'], default: 'SILVER' },
      progressPercentage: { type: Number, default: 0, min: [0, 'Pourcentage minimum 0'], max: [100, 'Pourcentage maximum 100'] }
    },
    statistics: {
      totalBookingsWithPoints: { type: Number, default: 0 },
      totalPointsEarned: { type: Number, default: 0 },
      totalPointsRedeemed: { type: Number, default: 0 },
      totalSpentWithProgram: { type: Number, default: 0 },
      favoriteHotelChain: { type: String, maxlength: [100, 'Nom chaîne hôtel trop long'] },
      averageBookingValueWithPoints: { type: Number, default: 0 },
      lastActivity: { type: Date, default: Date.now },
      joinDate: { type: Date, default: Date.now }
    },
    preferences: {
      roomType: { type: String, enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'] },
      floorPreference: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH'], default: 'MEDIUM' },
      viewPreference: { type: String, enum: ['CITY', 'SEA', 'MOUNTAIN', 'GARDEN', 'ANY'], default: 'ANY' },
      amenities: [{ type: String, enum: ['WiFi', 'Parking', 'Piscine', 'Spa', 'Salle_sport', 'Restaurant', 'Bar', 'Room_service', 'Climatisation', 'Coffre_fort', 'Blanchisserie', 'Conciergerie', 'Animaux'] }],
      services: [{ type: String, enum: ['Petit_dejeuner', 'Diner', 'Transport_aeroport', 'Location_voiture', 'Excursions', 'Massage','Spa'] }],
     communicationPreferences: {
       email: { type: Boolean, default: true },
       sms: { type: Boolean, default: true },
       push: { type: Boolean, default: true },
       newsletter: { type: Boolean, default: true },
       promotions: { type: Boolean, default: true },
       tierUpdates: { type: Boolean, default: true }
     }
   },
   activeBenefits: [{
     type: { type: String, enum: ['DISCOUNT', 'UPGRADE', 'FREE_NIGHT', 'EARLY_CHECKIN', 'LATE_CHECKOUT', 'BONUS_POINTS', 'FREE_BREAKFAST', 'LOUNGE_ACCESS', 'FREE_WIFI', 'ROOM_SERVICE_DISCOUNT', 'SPA_DISCOUNT', 'PARKING_FREE', 'AIRPORT_TRANSFER'], required: true },
     value: { type: Number, required: true, min: [0, 'Valeur du bénéfice ne peut être négative'] },
     description: { type: String, required: true, maxlength: [200, 'Description du bénéfice trop longue'] },
     validUntil: { type: Date, required: true },
     usageCount: { type: Number, default: 0, min: [0, 'Usage count ne peut être négatif'] },
     maxUsage: { type: Number, default: 1, min: [1, 'Usage maximum doit être au moins 1'] },
     isActive: { type: Boolean, default: true },
     autoRenew: { type: Boolean, default: false }
   }],
   tierHistory: [{
     tier: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'], required: true },
     achievedAt: { type: Date, required: true },
     pointsAtAchievement: { type: Number, required: true },
     celebrationSent: { type: Boolean, default: false }
   }],
   personalGoals: {
     targetTier: { type: String, enum: ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] },
     targetPoints: { type: Number, min: [0, 'Points objectif ne peut être négatif'] },
     targetDate: { type: Date },
     isActive: { type: Boolean, default: false }
   },
   performance: {
     pointsVelocity: { type: Number, default: 0 },
     redemptionRate: { type: Number, default: 0, min: [0, 'Taux utilisation minimum 0'], max: [100, 'Taux utilisation maximum 100'] },
     engagementScore: { type: Number, default: 50, min: [0, 'Score engagement minimum 0'], max: [100, 'Score engagement maximum 100'] },
     lastCalculated: { type: Date, default: Date.now }
   },
   specialStatus: {
     isVIP: { type: Boolean, default: false },
     vipSince: { type: Date },
     isInfluencer: { type: Boolean, default: false },
     specialOffers: [{
       name: String,
       description: String,
       validUntil: Date,
       used: { type: Boolean, default: false }
     }]
   }
 },

 // ===== MÉTADONNÉES (all preserved) =====
 createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
 invitationToken: String,
 invitationExpires: Date,
 lastActivityDate: { type: Date, default: Date.now },

 // ============================================================================
 // ✨ NEW PHASE I4: QR PREFERENCES INTEGRATION ✨
 // ============================================================================
 
 // QR Code Preferences pour l'utilisateur
 qrPreferences: {
   // QR System Enablement
   enabled: {
     type: Boolean,
     default: true,
     index: true
   },
   
   // Automatic QR Delivery Preferences
   autoEmail: {
     type: Boolean,
     default: true
   },
   autoSMS: {
     type: Boolean,
     default: false
   },
   
   // QR Code Style Preferences
   preferredStyle: {
     type: String,
     enum: ['default', 'hotel', 'mobile', 'print'],
     default: 'mobile'
   },
   preferredSize: {
     type: String,
     enum: ['SMALL', 'MEDIUM', 'LARGE'],
     default: 'MEDIUM'
   },
   
   // Mobile Optimization
   mobileOptimized: {
     type: Boolean,
     default: true
   },
   downloadToGallery: {
     type: Boolean,
     default: false
   },
   
   // Security & Privacy Preferences
   securityNotifications: {
     type: Boolean,
     default: true
   },
   shareUsageAnalytics: {
     type: Boolean,
     default: true
   },
   allowGeolocationValidation: {
     type: Boolean,
     default: true
   },
   allowDeviceValidation: {
     type: Boolean,
     default: false
   },
   
   // QR Types Preferences
   preferredTypes: {
     checkIn: {
       enabled: { type: Boolean, default: true },
       autoGenerate: { type: Boolean, default: true },
       sendReminder: { type: Boolean, default: true },
       reminderHours: { type: Number, default: 24, min: [1, 'Rappel minimum 1h'], max: [168, 'Rappel maximum 1 semaine'] }
     },
     checkOut: {
       enabled: { type: Boolean, default: true },
       autoGenerate: { type: Boolean, default: false },
       sendReminder: { type: Boolean, default: false },
       reminderHours: { type: Number, default: 2, min: [1, 'Rappel minimum 1h'], max: [24, 'Rappel maximum 24h'] }
     },
     roomAccess: {
       enabled: { type: Boolean, default: false },
       autoGenerate: { type: Boolean, default: false },
       sendToGuests: { type: Boolean, default: false }
     },
     payment: {
       enabled: { type: Boolean, default: false },
       autoGenerate: { type: Boolean, default: false },
       requireConfirmation: { type: Boolean, default: true }
     },
     feedback: {
       enabled: { type: Boolean, default: true },
       autoGenerate: { type: Boolean, default: true },
       sendAfterCheckout: { type: Boolean, default: true },
       delayHours: { type: Number, default: 2, min: [0, 'Délai minimum 0h'], max: [72, 'Délai maximum 72h'] }
     }
   },
   
   // Language & Accessibility
   language: {
     type: String,
     enum: ['FR', 'EN', 'ES', 'DE', 'IT', 'AR'],
     default: 'FR'
   },
   accessibilityMode: {
     type: Boolean,
     default: false
   },
   highContrastMode: {
     type: Boolean,
     default: false
   },
   largeQRCodes: {
     type: Boolean,
     default: false
   },
   
   // Advanced Features
   offlineMode: {
     type: Boolean,
     default: false
   },
   bulkDownload: {
     type: Boolean,
     default: false
   },
   shareWithOthers: {
     type: Boolean,
     default: false
   },
   
   // Troubleshooting Preferences
   enableDiagnostics: {
     type: Boolean,
     default: true
   },
   autoRetryFailed: {
     type: Boolean,
     default: true
   },
   maxRetryAttempts: {
     type: Number,
     default: 3,
     min: [1, 'Tentatives minimum 1'],
     max: [10, 'Tentatives maximum 10']
   }
 },

 // QR Usage History pour l'utilisateur
 qrHistory: [{
   // Booking Reference
   bookingId: {
     type: mongoose.Schema.Types.ObjectId,
     ref: 'Booking',
     required: true,
     index: true
   },
   hotelId: {
     type: mongoose.Schema.Types.ObjectId,
     ref: 'Hotel',
     required: true,
     index: true
   },
   
   // QR Details
   qrCodeId: {
     type: String,
     required: true,
     index: true
   },
   qrType: {
     type: String,
     enum: ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS', 'PAYMENT', 'FEEDBACK', 'MENU', 'WIFI'],
     required: true,
     index: true
   },
   
   // Timeline
   generatedAt: {
     type: Date,
     required: true,
     index: true
   },
   usedAt: {
     type: Date,
     index: true
   },
   expiresAt: {
     type: Date,
     required: true
   },
   
   // Performance Data
   checkInTime: {
     type: Number, // millisecondes
     min: [0, 'Temps check-in ne peut être négatif']
   },
   success: {
     type: Boolean,
     required: true,
     index: true
   },
   failureReason: {
     type: String,
     enum: ['EXPIRED', 'INVALID', 'REVOKED', 'WRONG_LOCATION', 'NETWORK_ERROR', 'USER_CANCELLED']
   },
   retryCount: {
     type: Number,
     default: 0,
     min: [0, 'Nombre de tentatives ne peut être négatif']
   },
   
   // Device & Context Information
   device: {
     type: {
       type: String,
       enum: ['MOBILE', 'TABLET', 'DESKTOP', 'KIOSK'],
       default: 'MOBILE'
     },
     platform: {
       type: String,
       enum: ['IOS', 'ANDROID', 'WEB', 'OTHER']
     },
     browser: String,
     userAgent: String,
     screenSize: {
       width: Number,
       height: Number
     }
   },
   
   // Location Data (if permitted)
   location: {
     latitude: {
       type: Number,
       min: [-90, 'Latitude invalide'],
       max: [90, 'Latitude invalide']
     },
     longitude: {
       type: Number,
       min: [-180, 'Longitude invalide'],
       max: [180, 'Longitude invalide']
     },
     accuracy: Number,
     timestamp: Date
   },
   
   // User Experience Feedback
   userRating: {
     type: Number,
     min: [1, 'Note minimum 1'],
     max: [5, 'Note maximum 5']
   },
   userFeedback: {
     type: String,
     maxlength: [500, 'Feedback trop long']
   },
   
   // Technical Details
   processingTime: {
     type: Number, // millisecondes
     min: [0, 'Temps de traitement ne peut être négatif']
   },
   networkLatency: {
     type: Number, // millisecondes
     min: [0, 'Latence réseau ne peut être négative']
   },
   qrStyle: {
     type: String,
     enum: ['default', 'hotel', 'mobile', 'print']
   },
   deliveryMethod: {
     type: String,
     enum: ['EMAIL', 'SMS', 'IN_APP', 'DOWNLOAD', 'PRINT']
   }
 }],

 // ============================================================================
 // ✨ NEW PHASE I4: CACHE PREFERENCES INTEGRATION ✨
 // ============================================================================
 
 // Cache Preferences pour l'utilisateur
 cachePreferences: {
   // Global Cache Enablement
   enablePersonalization: {
     type: Boolean,
     default: true,
     index: true
   },
   
   // Data Freshness Preferences
   dataFreshness: {
     type: String,
     enum: ['REAL_TIME', 'BALANCED', 'PERFORMANCE'],
     default: 'BALANCED',
     index: true
   },
   
   // Specific Cache Settings
   cacheSettings: {
     availability: {
       priority: {
         type: String,
         enum: ['HIGH', 'MEDIUM', 'LOW'],
         default: 'HIGH'
       },
       maxAge: {
         type: Number,
         default: 300, // 5 minutes
         min: [30, 'Âge maximum minimum 30s'],
         max: [3600, 'Âge maximum maximum 1h']
       },
       autoRefresh: {
         type: Boolean,
         default: true
       }
     },
     
     pricing: {
       priority: {
         type: String,
         enum: ['HIGH', 'MEDIUM', 'LOW'],
         default: 'MEDIUM'
       },
       maxAge: {
         type: Number,
         default: 900, // 15 minutes
         min: [300, 'Âge maximum minimum 5min'],
         max: [3600, 'Âge maximum maximum 1h']
       },
       autoRefresh: {
         type: Boolean,
         default: false
       }
     },
     
     bookingHistory: {
       priority: {
         type: String,
         enum: ['HIGH', 'MEDIUM', 'LOW'],
         default: 'LOW'
       },
       maxAge: {
         type: Number,
         default: 1800, // 30 minutes
         min: [600, 'Âge maximum minimum 10min'],
         max: [7200, 'Âge maximum maximum 2h']
       },
       autoRefresh: {
         type: Boolean,
         default: false
       }
     },
     
     hotelDetails: {
       priority: {
         type: String,
         enum: ['HIGH', 'MEDIUM', 'LOW'],
         default: 'LOW'
       },
       maxAge: {
         type: Number,
         default: 3600, // 1 hour
         min: [1800, 'Âge maximum minimum 30min'],
         max: [86400, 'Âge maximum maximum 24h']
       },
       autoRefresh: {
         type: Boolean,
         default: false
       }
     }
   },
   
   // Performance vs Battery Trade-off (mobile)
   performanceMode: {
     type: String,
     enum: ['BATTERY_SAVER', 'BALANCED', 'PERFORMANCE'],
     default: 'BALANCED'
   },
   
   // Data Usage Preferences
   allowCacheOnMobile: {
     type: Boolean,
     default: true
   },
   allowBackgroundRefresh: {
     type: Boolean,
     default: false
   },
   maxCacheSize: {
     type: Number, // MB
     default: 50,
     min: [10, 'Taille cache minimum 10MB'],
     max: [500, 'Taille cache maximum 500MB']
   },
   
   // Privacy & Analytics
   optOutTracking: {
     type: Boolean,
     default: false
   },
   sharePerformanceData: {
     type: Boolean,
     default: true
   },
   allowPersonalization: {
     type: Boolean,
     default: true
   },
   
   // Advanced Features
   prefetchContent: {
     type: Boolean,
     default: true
   },
   intelligentCaching: {
     type: Boolean,
     default: true
   },
   crossDeviceSync: {
     type: Boolean,
     default: false
   },
   
   // Debugging & Diagnostics
   enableCacheDebugging: {
     type: Boolean,
     default: false
   },
   showCacheStatus: {
     type: Boolean,
     default: false
   },
   logCacheOperations: {
     type: Boolean,
     default: false
   }
 },

 // ============================================================================
 // ✨ NEW PHASE I4: PERFORMANCE DATA INTEGRATION ✨
 // ============================================================================
 
 // Performance Data tracking pour l'utilisateur
 performanceData: {
   // Response Time Metrics
   averageResponseTime: {
     type: Number, // millisecondes
     default: 0,
     min: [0, 'Temps de réponse ne peut être négatif']
   },
   
   // Cache Performance
   cacheHitRate: {
     type: Number, // pourcentage
     default: 0,
     min: [0, 'Taux de hit minimum 0'],
     max: [100, 'Taux de hit maximum 100'],
     index: true
   },
   cacheMissRate: {
     type: Number, // pourcentage
     default: 0,
     min: [0, 'Taux de miss minimum 0'],
     max: [100, 'Taux de miss maximum 100']
   },
   
   // QR Performance
   qrUsageCount: {
     type: Number,
     default: 0,
     min: [0, 'Usage QR ne peut être négatif'],
     index: true
   },
   qrSuccessRate: {
     type: Number, // pourcentage
     default: 0,
     min: [0, 'Taux succès minimum 0'],
     max: [100, 'Taux succès maximum 100'],
     index: true
   },
   averageQRTime: {
     type: Number, // millisecondes
     default: 0,
     min: [0, 'Temps QR moyen ne peut être négatif']
   },
   
   // Session Metrics
   sessionCount: {
     type: Number,
     default: 0,
     min: [0, 'Nombre sessions ne peut être négatif']
   },
   averageSessionDuration: {
     type: Number, // secondes
     default: 0,
     min: [0, 'Durée session ne peut être négative']
   },
   totalTimeSpent: {
     type: Number, // secondes
     default: 0,
     min: [0, 'Temps total ne peut être négatif']
   },
   
   // Error Tracking
   errorCount: {
     type: Number,
     default: 0,
     min: [0, 'Nombre erreurs ne peut être négatif']
   },
   errorRate: {
     type: Number, // pourcentage
     default: 0,
     min: [0, 'Taux erreur minimum 0'],
     max: [100, 'Taux erreur maximum 100']
   },
   lastError: {
     type: Date
   },
   
   // Feature Usage
   featuresUsed: [{
     feature: {
       type: String,
       enum: ['QR_CHECKIN', 'QR_CHECKOUT', 'BOOKING_SEARCH', 'PRICE_COMPARISON', 'LOYALTY_REDEMPTION', 'ROOM_UPGRADE'],
       required: true
     },
     usageCount: {
       type: Number,
       default: 0,
       min: [0, 'Usage ne peut être négatif']
     },
     lastUsed: {
       type: Date
     },
     avgTime: {
       type: Number, // millisecondes
       default: 0
     }
   }],
   
   // Device Performance
   devicePerformance: {
     deviceType: {
       type: String,
       enum: ['MOBILE', 'TABLET', 'DESKTOP']
     },
     os: {
       type: String,
       enum: ['IOS', 'ANDROID', 'WINDOWS', 'MACOS', 'LINUX']
     },
     browser: String,
     avgLoadTime: {
       type: Number, // millisecondes
       default: 0
     },
     memoryUsage: {
       type: Number, // MB
       default: 0
     },
     networkType: {
       type: String,
       enum: ['WIFI', '4G', '3G', '2G', 'ETHERNET', 'UNKNOWN']
     },
     networkSpeed: {
       type: Number, // Mbps
       default: 0
     }
   },
   
   // Optimization History
   optimizations: [{
     type: {
       type: String,
       enum: ['CACHE_STRATEGY', 'QR_SETTINGS', 'PREFETCH_RULES', 'COMPRESSION'],
       required: true
     },
     appliedAt: {
       type: Date,
       default: Date.now
     },
     description: String,
     impact: {
       before: Number,
       after: Number,
       improvement: Number // pourcentage
     },
     successful: {
       type: Boolean,
       default: true
     }
   }],
   
   // Last Updates
   lastOptimization: {
     type: Date,
     index: true
   },
   lastPerformanceCheck: {
     type: Date,
     default: Date.now,
     index: true
   },
   
   // Preference Score (satisfaction utilisateur)
   preferenceScore: {
     type: Number, // 0-100
     default: 50,
     min: [0, 'Score préférence minimum 0'],
     max: [100, 'Score préférence maximum 100'],
     index: true
   },
   
   // Performance Trends
   trends: {
     daily: [{
       date: Date,
       responseTime: Number,
       cacheHitRate: Number,
       qrUsage: Number,
       sessionDuration: Number
     }],
     weekly: [{
       weekStart: Date,
       avgResponseTime: Number,
       avgCacheHitRate: Number,
       totalQRUsage: Number,
       avgSessionDuration: Number
     }],
     monthly: [{
       month: Date,
       avgResponseTime: Number,
       avgCacheHitRate: Number,
       totalQRUsage: Number,
       avgSessionDuration: Number,
       featuresDiscovered: Number
     }]
   },
   
   // Recommendations Applied
   recommendationsApplied: [{
     type: String,
     appliedAt: Date,
     impact: Number,
     userSatisfaction: Number
   }]
 }

}, {
 timestamps: true,
 toJSON: { 
   virtuals: true,
   transform: function(doc, ret) {
     delete ret.password;
     delete ret.resetPasswordToken;
     delete ret.emailVerificationToken;
     delete ret.__v;
     return ret;
   }
 },
 toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE (incluant QR + Cache)
// ============================================================================

// Existing indexes
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ userType: 1 });
userSchema.index({ company: 1 });
userSchema.index({ department: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// Index composé pour employeeId unique par entreprise
userSchema.index(
 { company: 1, employeeId: 1 }, 
 { 
   unique: true, 
   sparse: true,
   partialFilterExpression: { 
     employeeId: { $exists: true, $ne: null } 
   }
 }
);

// Index pour la hiérarchie
userSchema.index({ 'hierarchy.manager': 1 });
userSchema.index({ 'hierarchy.canApprove': 1 });

// Index pour le programme de fidélité
userSchema.index({ 'loyalty.tier': 1 });
userSchema.index({ 'loyalty.currentPoints': -1 });
userSchema.index({ 'loyalty.lifetimePoints': -1 });
userSchema.index({ 'loyalty.enrolledAt': 1 });
userSchema.index({ 'loyalty.statistics.lastActivity': -1 });

// ✨ NEW QR PREFERENCES INDEXES ✨
userSchema.index({ 'qrPreferences.enabled': 1 });
userSchema.index({ 'qrPreferences.preferredStyle': 1 });
userSchema.index({ 'qrPreferences.language': 1 });
userSchema.index({ 'qrHistory.generatedAt': -1 });
userSchema.index({ 'qrHistory.qrType': 1 });
userSchema.index({ 'qrHistory.success': 1 });
userSchema.index({ 'qrHistory.bookingId': 1 });
userSchema.index({ 'qrHistory.hotelId': 1 });

// ✨ NEW CACHE PREFERENCES INDEXES ✨
userSchema.index({ 'cachePreferences.enablePersonalization': 1 });
userSchema.index({ 'cachePreferences.dataFreshness': 1 });
userSchema.index({ 'cachePreferences.performanceMode': 1 });

// ✨ NEW PERFORMANCE DATA INDEXES ✨
userSchema.index({ 'performanceData.cacheHitRate': -1 });
userSchema.index({ 'performanceData.qrUsageCount': -1 });
userSchema.index({ 'performanceData.qrSuccessRate': -1 });
userSchema.index({ 'performanceData.preferenceScore': -1 });
userSchema.index({ 'performanceData.lastOptimization': -1 });
userSchema.index({ 'performanceData.lastPerformanceCheck': -1 });

// ============================================================================
// VIRTUALS (existing + new QR + Cache virtuals)
// ============================================================================

// Existing virtuals preserved
userSchema.virtual('fullName').get(function() {
 return `${this.firstName} ${this.lastName}`;
});

userSchema.virtual('fullNameWithTitle').get(function() {
 const name = this.fullName;
 return this.jobTitle ? `${name} (${this.jobTitle})` : name;
});

userSchema.virtual('isLocked').get(function() {
 return !!(this.lockUntil && this.lockUntil > Date.now());
});

userSchema.virtual('isEnterpriseUser').get(function() {
 return this.userType !== 'individual';
});

userSchema.virtual('authorityLevel').get(function() {
 if (this.userType === 'company_admin') return 'admin';
 if (this.userType === 'manager') return 'manager';
 if (this.userType === 'employee') return 'employee';
 return 'individual';
});

// Loyalty virtuals (preserved)
userSchema.virtual('isLoyaltyMember').get(function() {
 return this.loyalty && this.loyalty.enrolledAt != null;
});

userSchema.virtual('loyaltyTierName').get(function() {
 const tierNames = {
   'BRONZE': 'Bronze',
   'SILVER': 'Argent', 
   'GOLD': 'Or',
   'PLATINUM': 'Platine',
   'DIAMOND': 'Diamant'
 };
 return tierNames[this.loyalty?.tier] || 'Bronze';
});

userSchema.virtual('pointsValue').get(function() {
 return this.loyalty?.currentPoints ? (this.loyalty.currentPoints / 100) : 0;
});

userSchema.virtual('isCloseToNextTier').get(function() {
 return this.loyalty?.tierProgress?.progressPercentage >= 80;
});

userSchema.virtual('validBenefits').get(function() {
 if (!this.loyalty?.activeBenefits) return [];
 
 const now = new Date();
 return this.loyalty.activeBenefits.filter(benefit => 
   benefit.isActive && 
   benefit.validUntil > now &&
   benefit.usageCount < benefit.maxUsage
 );
});

// ✨ NEW QR PREFERENCES VIRTUALS ✨

// Check if QR system is enabled and configured
userSchema.virtual('isQREnabled').get(function() {
 return this.qrPreferences?.enabled && 
        Object.values(this.qrPreferences?.preferredTypes || {})
              .some(type => type.enabled);
});

// Get QR preferences summary
userSchema.virtual('qrPreferencesSummary').get(function() {
 const prefs = this.qrPreferences;
 if (!prefs?.enabled) return { enabled: false };
 
 const enabledTypes = Object.entries(prefs.preferredTypes || {})
   .filter(([type, config]) => config.enabled)
   .map(([type]) => type);
 
 return {
   enabled: true,
   types: enabledTypes,
   style: prefs.preferredStyle,
   language: prefs.language,
   notifications: {
     email: prefs.autoEmail,
     sms: prefs.autoSMS,
     security: prefs.securityNotifications
   },
   accessibility: {
     mode: prefs.accessibilityMode,
     highContrast: prefs.highContrastMode,
     largeQR: prefs.largeQRCodes
   }
 };
});

// Get QR usage statistics
userSchema.virtual('qrUsageStats').get(function() {
 const history = this.qrHistory || [];
 const total = history.length;
 
 if (total === 0) return { total: 0, success: 0, successRate: 0 };
 
 const successful = history.filter(entry => entry.success).length;
 const successRate = (successful / total) * 100;
 
 // Calculate average check-in time
 const checkInTimes = history
   .filter(entry => entry.success && entry.checkInTime)
   .map(entry => entry.checkInTime);
 
 const avgCheckInTime = checkInTimes.length > 0 ?
   checkInTimes.reduce((sum, time) => sum + time, 0) / checkInTimes.length : 0;
 
 // Get usage by type
 const byType = history.reduce((acc, entry) => {
   const type = entry.qrType;
   if (!acc[type]) acc[type] = { total: 0, successful: 0 };
   acc[type].total++;
   if (entry.success) acc[type].successful++;
   return acc;
 }, {});
 
 return {
   total,
   successful,
   successRate: Math.round(successRate),
   avgCheckInTime: Math.round(avgCheckInTime),
   byType,
   lastUsed: history.length > 0 ? 
     history.sort((a, b) => new Date(b.usedAt) - new Date(a.usedAt))[0].usedAt : null
 };
});

// Check if user has recent QR issues
userSchema.virtual('hasRecentQRIssues').get(function() {
 const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
 const recentEntries = (this.qrHistory || [])
   .filter(entry => new Date(entry.generatedAt) > oneDayAgo);
 
 if (recentEntries.length === 0) return false;
 
 const recentFailures = recentEntries.filter(entry => !entry.success);
 const failureRate = (recentFailures.length / recentEntries.length) * 100;
 
 return failureRate > 50; // More than 50% failures in last 24h
});

// ✨ NEW CACHE PREFERENCES VIRTUALS ✨

// Check if cache personalization is optimally configured
userSchema.virtual('isCacheOptimized').get(function() {
 const prefs = this.cachePreferences;
 const perf = this.performanceData;
 
 if (!prefs?.enablePersonalization) return false;
 
 const hitRate = perf?.cacheHitRate || 0;
 const responseTime = perf?.averageResponseTime || 0;
 
 return hitRate >= 75 && responseTime <= 500;
});

// Get cache configuration summary
userSchema.virtual('cacheConfigSummary').get(function() {
 const prefs = this.cachePreferences;
 if (!prefs?.enablePersonalization) return { enabled: false };
 
 return {
   enabled: true,
   dataFreshness: prefs.dataFreshness,
   performanceMode: prefs.performanceMode,
   maxCacheSize: prefs.maxCacheSize,
   allowMobile: prefs.allowCacheOnMobile,
   backgroundRefresh: prefs.allowBackgroundRefresh,
   privacy: {
     optOut: prefs.optOutTracking,
     shareData: prefs.sharePerformanceData,
     personalization: prefs.allowPersonalization
   },
   advanced: {
     prefetch: prefs.prefetchContent,
     intelligent: prefs.intelligentCaching,
     crossDevice: prefs.crossDeviceSync
   }
 };
});

// Get cache performance score
userSchema.virtual('cachePerformanceScore').get(function() {
 const perf = this.performanceData;
 if (!perf) return 0;
 
 const hitRate = perf.cacheHitRate || 0;
 const responseTime = perf.averageResponseTime || 0;
 const errorRate = perf.errorRate || 0;
 
 // Calculate weighted score
 let score = hitRate * 0.5; // 50% weight on hit rate
 
 // Response time factor (lower is better)
 const responseScore = Math.max(0, 100 - (responseTime / 10));
 score += responseScore * 0.3; // 30% weight
 
 // Error rate factor (lower is better)
 const errorScore = Math.max(0, 100 - errorRate);
 score += errorScore * 0.2; // 20% weight
 
 return Math.round(score);
});

// Check if cache needs attention
userSchema.virtual('cacheNeedsAttention').get(function() {
 const perf = this.performanceData;
 if (!perf) return false;
 
 const lowHitRate = (perf.cacheHitRate || 0) < 60;
 const slowResponse = (perf.averageResponseTime || 0) > 1000;
 const highErrorRate = (perf.errorRate || 0) > 20;
 
 return lowHitRate || slowResponse || highErrorRate;
});

// ✨ NEW PERFORMANCE DATA VIRTUALS ✨

// Get overall performance score
userSchema.virtual('overallPerformanceScore').get(function() {
 const perf = this.performanceData;
 if (!perf) return 0;
 
 const cacheScore = this.cachePerformanceScore || 0;
 const qrScore = this.getQRPerformanceScore();
 const sessionScore = this.getSessionPerformanceScore();
 
 // Weighted average
 return Math.round((cacheScore * 0.4) + (qrScore * 0.3) + (sessionScore * 0.3));
});

// Check if user needs performance optimization
userSchema.virtual('needsPerformanceOptimization').get(function() {
 const score = this.overallPerformanceScore;
 const hasRecentErrors = this.hasRecentPerformanceIssues;
 const lowSatisfaction = (this.performanceData?.preferenceScore || 50) < 60;
 
 return score < 70 || hasRecentErrors || lowSatisfaction;
});

// Check for recent performance issues
userSchema.virtual('hasRecentPerformanceIssues').get(function() {
 const perf = this.performanceData;
 if (!perf) return false;
 
 const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
 
 // Check if last error was recent
 const recentError = perf.lastError && new Date(perf.lastError) > oneDayAgo;
 
 // Check if error rate is high
 const highErrorRate = (perf.errorRate || 0) > 15;
 
 // Check QR issues
 const qrIssues = this.hasRecentQRIssues;
 
 return recentError || highErrorRate || qrIssues;
});

// Get personalized recommendations count
userSchema.virtual('personalizedRecommendationsCount').get(function() {
 const recommendations = [];
 
 // Cache recommendations
 if (this.cacheNeedsAttention) recommendations.push('CACHE_OPTIMIZATION');
 
 // QR recommendations
 if (this.hasRecentQRIssues) recommendations.push('QR_TROUBLESHOOTING');
 
 // Performance recommendations
 if (this.needsPerformanceOptimization) recommendations.push('PERFORMANCE_TUNING');
 
 // Preference recommendations
 const preferenceScore = this.performanceData?.preferenceScore || 50;
 if (preferenceScore < 70) recommendations.push('PREFERENCE_ADJUSTMENT');
 
 return recommendations.length;
});

// Get feature adoption score
userSchema.virtual('featureAdoptionScore').get(function() {
 const features = this.performanceData?.featuresUsed || [];
 const totalFeatures = 6; // Total available features
 
 const adoptedFeatures = features.filter(f => f.usageCount > 0).length;
 return Math.round((adoptedFeatures / totalFeatures) * 100);
});

// ============================================================================
// MIDDLEWARE PRE-SAVE (existing + new QR + Cache initialization)
// ============================================================================

// Existing middleware preserved
userSchema.pre('save', async function(next) {
 if (!this.isModified('password')) return next();

 try {
   const salt = await bcrypt.genSalt(12);
   this.password = await bcrypt.hash(this.password, salt);
   next();
 } catch (error) {
   next(error);
 }
});

userSchema.pre('save', function(next) {
 if (this.company || this.companyName || this.siret) {
   this.clientType = 'COMPANY';
 } else {
   this.clientType = 'INDIVIDUAL';
 }

 if (this.userType === 'company_admin') {
   this.permissions.canManageTeam = true;
   this.permissions.canViewReports = true;
   this.permissions.canAccessFinancials = true;
 }
 
 if (this.userType === 'manager') {
   this.hierarchy.canApprove = true;
   this.permissions.canApprove = true;
   this.permissions.canViewReports = true;
   if (this.hierarchy.approvalLimit === 0) {
     this.hierarchy.approvalLimit = 5000;
   }
 }

 this.lastActivityDate = new Date();
 
 next();
});

userSchema.pre('save', async function(next) {
 if (this.hierarchy.manager && this.isModified('hierarchy.manager')) {
   try {
     const manager = await this.constructor.findById(this.hierarchy.manager);
     
     if (!manager) {
       return next(new Error('Manager introuvable'));
     }
     
     if (this.company && !manager.company?.equals(this.company)) {
       return next(new Error('Le manager doit appartenir à la même entreprise'));
     }
     
     if (!manager.permissions.canManageTeam && manager.userType !== 'manager' && manager.userType !== 'company_admin') {
       return next(new Error('Le manager sélectionné n\'a pas les permissions d\'encadrement'));
     }
     
   } catch (error) {
     return next(error);
   }
 }
 
 next();
});

// ✨ NEW INITIALIZATION FOR NEW USERS ✨
userSchema.pre('save', function(next) {
 if (this.isNew) {
   // Initialize QR preferences for new users
   if (!this.qrPreferences) {
     this.qrPreferences = {
       enabled: true,
       autoEmail: true,
       autoSMS: false,
       preferredStyle: 'mobile',
       preferredSize: 'MEDIUM',
       mobileOptimized: true,
       downloadToGallery: false,
       securityNotifications: true,
       shareUsageAnalytics: true,
       allowGeolocationValidation: true,
       allowDeviceValidation: false,
       preferredTypes: {
         checkIn: {
           enabled: true,
           autoGenerate: true,
           sendReminder: true,
           reminderHours: 24
         },
         checkOut: {
           enabled: true,
           autoGenerate: false,
           sendReminder: false,
           reminderHours: 2
         },
         roomAccess: {
           enabled: false,
           autoGenerate: false,
           sendToGuests: false
         },
         payment: {
           enabled: false,
           autoGenerate: false,
           requireConfirmation: true
         },
         feedback: {
           enabled: true,
           autoGenerate: true,
           sendAfterCheckout: true,
           delayHours: 2
         }
       },
       language: 'FR',
       accessibilityMode: false,
       highContrastMode: false,
       largeQRCodes: false,
       offlineMode: false,
       bulkDownload: false,
       shareWithOthers: false,
       enableDiagnostics: true,
       autoRetryFailed: true,
       maxRetryAttempts: 3
     };
   }
   
   // Initialize cache preferences for new users
   if (!this.cachePreferences) {
     this.cachePreferences = {
       enablePersonalization: true,
       dataFreshness: 'BALANCED',
       cacheSettings: {
         availability: {
           priority: 'HIGH',
           maxAge: 300,
           autoRefresh: true
         },
         pricing: {
           priority: 'MEDIUM',
           maxAge: 900,
           autoRefresh: false
         },
         bookingHistory: {
           priority: 'LOW',
           maxAge: 1800,
           autoRefresh: false
         },
         hotelDetails: {
           priority: 'LOW',
           maxAge: 3600,
           autoRefresh: false
         }
       },
       performanceMode: 'BALANCED',
       allowCacheOnMobile: true,
       allowBackgroundRefresh: false,
       maxCacheSize: 50,
       optOutTracking: false,
       sharePerformanceData: true,
       allowPersonalization: true,
       prefetchContent: true,
       intelligentCaching: true,
       crossDeviceSync: false,
       enableCacheDebugging: false,
       showCacheStatus: false,
       logCacheOperations: false
     };
   }
   
   // Initialize performance data for new users
   if (!this.performanceData) {
     this.performanceData = {
       averageResponseTime: 0,
       cacheHitRate: 0,
       cacheMissRate: 0,
       qrUsageCount: 0,
       qrSuccessRate: 0,
       averageQRTime: 0,
       sessionCount: 0,
       averageSessionDuration: 0,
       totalTimeSpent: 0,
       errorCount: 0,
       errorRate: 0,
       featuresUsed: [
         { feature: 'QR_CHECKIN', usageCount: 0, avgTime: 0 },
         { feature: 'QR_CHECKOUT', usageCount: 0, avgTime: 0 },
         { feature: 'BOOKING_SEARCH', usageCount: 0, avgTime: 0 },
         { feature: 'PRICE_COMPARISON', usageCount: 0, avgTime: 0 },
         { feature: 'LOYALTY_REDEMPTION', usageCount: 0, avgTime: 0 },
         { feature: 'ROOM_UPGRADE', usageCount: 0, avgTime: 0 }
       ],
       devicePerformance: {
         avgLoadTime: 0,
         memoryUsage: 0,
         networkType: 'UNKNOWN',
         networkSpeed: 0
       },
       optimizations: [],
       lastPerformanceCheck: new Date(),
       preferenceScore: 50,
       trends: {
         daily: [],
         weekly: [],
         monthly: []
       },
       recommendationsApplied: []
     };
   }
   
   // Initialize QR history (empty for new users)
   if (!this.qrHistory) {
     this.qrHistory = [];
   }
 }
 
 next();
});

// ============================================================================
// EXISTING METHODS PRESERVED (all previous methods kept as-is)
// ============================================================================

// Authentication methods (preserved)
userSchema.methods.comparePassword = async function(candidatePassword) {
 if (!candidatePassword) return false;
 return await bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.generateAuthToken = function() {
 const payload = {
   userId: this._id,
   email: this.email,
   role: this.role,
   userType: this.userType,
   fullName: this.fullName,
   company: this.company,
   department: this.department,
   permissions: this.permissions
 };

 return jwt.sign(
   payload,
   process.env.JWT_SECRET,
   { 
     expiresIn: process.env.JWT_EXPIRE || '24h',
     issuer: 'hotel-management-system'
   }
 );
};

userSchema.methods.generateRefreshToken = function() {
 const payload = {
   userId: this._id,
   type: 'refresh'
 };

 return jwt.sign(
   payload,
   process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
   { 
     expiresIn: process.env.JWT_REFRESH_EXPIRE || '7d',
     issuer: 'hotel-management-system'
   }
 );
};

// Permission methods (preserved)
userSchema.methods.hasPermission = function(permission, amount = 0) {
 if (!this.isActive) return false;
 if (!this.permissions[permission]) return false;
 
 switch (permission) {
   case 'canBook':
     return amount <= this.permissions.maxBookingAmount;
   case 'canApprove':
     return this.hierarchy.canApprove && amount <= this.hierarchy.approvalLimit;
   default:
     return this.permissions[permission] === true;
 }
};

userSchema.methods.createDelegation = function(delegateToId, permissions, startDate, endDate) {
 this.enterpriseSettings.delegations.push({
   delegateTo: delegateToId,
   startDate: startDate || new Date(),
   endDate: endDate,
   permissions: permissions,
   isActive: true
 });
 
 return this.save();
};

userSchema.methods.getEffectivePermissions = async function() {
 let effectivePermissions = { ...this.permissions };
 
 const activeDelegations = this.enterpriseSettings.delegations.filter(d => 
   d.isActive && 
   new Date() >= d.startDate && 
   (!d.endDate || new Date() <= d.endDate)
 );
 
 for (const delegation of activeDelegations) {
   for (const permission of delegation.permissions) {
     effectivePermissions[permission] = true;
   }
 }
 
 return effectivePermissions;
};

userSchema.methods.updateBookingStats = function(bookingAmount) {
 this.stats.totalBookings += 1;
 this.stats.totalSpent += bookingAmount;
 this.stats.averageBookingValue = this.stats.totalSpent / this.stats.totalBookings;
 this.stats.lastBookingDate = new Date();
 
 return this.save({ validateBeforeSave: false });
};

// Loyalty methods (all preserved)
userSchema.methods.updateTierProgress = function() {
 const tierThresholds = {
   BRONZE: 0,
   SILVER: 1000,
   GOLD: 5000,
   PLATINUM: 15000,
   DIAMOND: 50000
 };
 
 const currentTier = this.loyalty.tier;
 const lifetimePoints = this.loyalty.lifetimePoints;
 
 const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
 const currentIndex = tiers.indexOf(currentTier);
 
 if (currentIndex < tiers.length - 1) {
   const nextTier = tiers[currentIndex + 1];
   const nextThreshold = tierThresholds[nextTier];
   const currentThreshold = tierThresholds[currentTier];
   
   const pointsToNext = Math.max(0, nextThreshold - lifetimePoints);
   const progressPercentage = Math.min(100, Math.round(
     ((lifetimePoints - currentThreshold) / (nextThreshold - currentThreshold)) * 100
   ));
   
   this.loyalty.tierProgress = {
     pointsToNextTier: pointsToNext,
     nextTier: nextTier,
     progressPercentage: Math.max(0, progressPercentage)
   };
 } else {
   this.loyalty.tierProgress = {
     pointsToNextTier: 0,
     nextTier: 'DIAMOND',
     progressPercentage: 100
   };
 }
 
 return this;
};

userSchema.methods.checkTierUpgrade = function() {
 const tierThresholds = {
   BRONZE: 0,
   SILVER: 1000,
   GOLD: 5000,
   PLATINUM: 15000,
   DIAMOND: 50000
 };
 
 const lifetimePoints = this.loyalty.lifetimePoints;
 let newTier = 'BRONZE';
 
 if (lifetimePoints >= tierThresholds.DIAMOND) newTier = 'DIAMOND';
 else if (lifetimePoints >= tierThresholds.PLATINUM) newTier = 'PLATINUM';
 else if (lifetimePoints >= tierThresholds.GOLD) newTier = 'GOLD';
 else if (lifetimePoints >= tierThresholds.SILVER) newTier = 'SILVER';
 
 if (newTier !== this.loyalty.tier) {
   const oldTier = this.loyalty.tier;
   this.loyalty.tier = newTier;
   
   this.loyalty.tierHistory.push({
     tier: newTier,
     achievedAt: new Date(),
     pointsAtAchievement: lifetimePoints,
     celebrationSent: false
   });
   
   return { upgraded: true, oldTier, newTier };
 }
 
 return { upgraded: false };
};

userSchema.methods.addLoyaltyPoints = function(points, description = 'Points ajoutés') {
 this.loyalty.currentPoints += points;
 this.loyalty.lifetimePoints += points;
 this.loyalty.statistics.totalPointsEarned += points;
 this.loyalty.statistics.lastActivity = new Date();
 
 this.updateTierProgress();
 const tierCheck = this.checkTierUpgrade();
 
 return {
   newBalance: this.loyalty.currentPoints,
   lifetimePoints: this.loyalty.lifetimePoints,
   tierUpgrade: tierCheck
 };
};

userSchema.methods.redeemLoyaltyPoints = function(points, description = 'Points utilisés') {
 if (this.loyalty.currentPoints < points) {
   throw new Error('Points insuffisants');
 }
 
 this.loyalty.currentPoints -= points;
 this.loyalty.statistics.totalPointsRedeemed += points;
 this.loyalty.statistics.lastActivity = new Date();
 
 return {
   newBalance: this.loyalty.currentPoints,
   pointsRedeemed: points
 };
};

userSchema.methods.getAvailableBenefits = function() {
 const tierBenefits = {
   BRONZE: [
     { type: 'BONUS_POINTS', value: 10, description: '10% bonus points sur réservations' }
   ],
   SILVER: [
     { type: 'BONUS_POINTS', value: 20, description: '20% bonus points' },
     { type: 'EARLY_CHECKIN', value: 2, description: 'Check-in 2h plus tôt' },
     { type: 'UPGRADE', value: 1, description: '1 upgrade gratuit par an' }
   ],
   GOLD: [
     { type: 'BONUS_POINTS', value: 50, description: '50% bonus points' },
     { type: 'FREE_BREAKFAST', value: 100, description: 'Petit-déjeuner gratuit' },
     { type: 'LATE_CHECKOUT', value: 2, description: 'Check-out 2h plus tard' },
     { type: 'UPGRADE', value: 2, description: '2 upgrades gratuits par an' }
   ],
   PLATINUM: [
     { type: 'BONUS_POINTS', value: 100, description: 'Double points' },
     { type: 'LOUNGE_ACCESS', value: 100, description: 'Accès salon VIP' },
     { type: 'FREE_NIGHT', value: 1, description: '1 nuit gratuite par an' },
     { type: 'ROOM_SERVICE_DISCOUNT', value: 25, description: '25% réduction room service' }
   ],
   DIAMOND: [
     { type: 'BONUS_POINTS', value: 150, description: '2.5x points' },
     { type: 'UPGRADE', value: 100, description: 'Upgrade automatique vers suite' },
     { type: 'FREE_NIGHT', value: 2, description: '2 nuits gratuites par an' },
     { type: 'AIRPORT_TRANSFER', value: 100, description: 'Transfert aéroport gratuit' }
   ]
 };
 
 return tierBenefits[this.loyalty.tier] || tierBenefits.BRONZE;
};

userSchema.methods.calculateLoyaltyPerformance = function() {
 const now = new Date();
 const enrolledMonths = Math.max(1, Math.floor((now - this.loyalty.enrolledAt) / (30 * 24 * 60 * 60 * 1000)));
 
 const pointsVelocity = this.loyalty.lifetimePoints / enrolledMonths;
 
 const redemptionRate = this.loyalty.lifetimePoints > 0 
   ? (this.loyalty.statistics.totalPointsRedeemed / this.loyalty.lifetimePoints) * 100 
   : 0;
 
 const activityScore = this.loyalty.statistics.lastActivity > new Date(now - 30 * 24 * 60 * 60 * 1000) ? 25 : 0;
 const usageScore = redemptionRate > 10 ? 25 : redemptionRate > 5 ? 15 : 10;
 const progressScore = this.loyalty.tierProgress.progressPercentage / 4;
 const loyaltyScore = this.loyalty.tier === 'DIAMOND' ? 25 : this.loyalty.tier === 'PLATINUM' ? 20 : 15;
 
 const engagementScore = Math.min(100, activityScore + usageScore + progressScore + loyaltyScore);
 
 this.loyalty.performance = {
   pointsVelocity: Math.round(pointsVelocity),
   redemptionRate: Math.round(redemptionRate * 100) / 100,
   engagementScore: Math.round(engagementScore),
   lastCalculated: now
 };
 
 return this.loyalty.performance;
};

// Security methods (preserved)
userSchema.methods.createPasswordResetToken = function() {
 const resetToken = crypto.randomBytes(32).toString('hex');
 
 this.resetPasswordToken = crypto
   .createHash('sha256')
   .update(resetToken)
   .digest('hex');
   
 this.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
 
 return resetToken;
};

userSchema.methods.createEmailVerificationToken = function() {
 const verificationToken = crypto.randomBytes(32).toString('hex');
 
 this.emailVerificationToken = crypto
   .createHash('sha256')
   .update(verificationToken)
   .digest('hex');
   
 this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
 
 return verificationToken;
};

userSchema.methods.incLoginAttempts = function() {
 if (this.lockUntil && this.lockUntil < Date.now()) {
   return this.updateOne({
     $unset: {
       loginAttempts: 1,
       lockUntil: 1
     }
   });
 }
 
 const updates = { $inc: { loginAttempts: 1 } };
 
 if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
   updates.$set = {
     lockUntil: Date.now() + 2 * 60 * 60 * 1000
   };
 }
 
 return this.updateOne(updates);
};

userSchema.methods.resetLoginAttempts = function() {
 return this.updateOne({
   $unset: {
     loginAttempts: 1,
     lockUntil: 1
   }
 });
};

userSchema.methods.updateLastLogin = function() {
 this.lastLogin = new Date();
 this.lastActivityDate = new Date();
 return this.save({ validateBeforeSave: false });
};

// ============================================================================
// ✨ NEW QR PREFERENCE METHODS ✨
// ============================================================================

// Update QR preferences
userSchema.methods.updateQRPreferences = function(preferences) {
 // Merge with existing preferences
 if (preferences.enabled !== undefined) this.qrPreferences.enabled = preferences.enabled;
 if (preferences.autoEmail !== undefined) this.qrPreferences.autoEmail = preferences.autoEmail;
 if (preferences.autoSMS !== undefined) this.qrPreferences.autoSMS = preferences.autoSMS;
 if (preferences.preferredStyle !== undefined) this.qrPreferences.preferredStyle = preferences.preferredStyle;
 if (preferences.language !== undefined) this.qrPreferences.language = preferences.language;
 
 if (preferences.preferredTypes) {
   // Deep merge preferred types
   for (const [type, config] of Object.entries(preferences.preferredTypes)) {
     if (!this.qrPreferences.preferredTypes[type]) {
       this.qrPreferences.preferredTypes[type] = {};
     }
     Object.assign(this.qrPreferences.preferredTypes[type], config);
   }
 }
 
 if (preferences.securityNotifications !== undefined) {
   this.qrPreferences.securityNotifications = preferences.securityNotifications;
 }
 
 if (preferences.allowGeolocationValidation !== undefined) {
   this.qrPreferences.allowGeolocationValidation = preferences.allowGeolocationValidation;
 }
 
 // Update accessibility settings
 if (preferences.accessibilityMode !== undefined) {
   this.qrPreferences.accessibilityMode = preferences.accessibilityMode;
 }
 if (preferences.highContrastMode !== undefined) {
   this.qrPreferences.highContrastMode = preferences.highContrastMode;
 }
 if (preferences.largeQRCodes !== undefined) {
   this.qrPreferences.largeQRCodes = preferences.largeQRCodes;
 }
 
 return this.save();
};

// Add QR usage entry to history
userSchema.methods.addQRUsage = function(qrData) {
 const entry = {
   bookingId: qrData.bookingId,
   hotelId: qrData.hotelId,
   qrCodeId: qrData.qrCodeId,
   qrType: qrData.qrType,
   generatedAt: qrData.generatedAt,
   usedAt: qrData.usedAt,
   expiresAt: qrData.expiresAt,
   checkInTime: qrData.checkInTime,
   success: qrData.success,
   failureReason: qrData.failureReason,
   retryCount: qrData.retryCount || 0,
   device: qrData.device,
   location: qrData.location,
   userRating: qrData.userRating,
   userFeedback: qrData.userFeedback,
   processingTime: qrData.processingTime,
   networkLatency: qrData.networkLatency,
   qrStyle: qrData.qrStyle,
   deliveryMethod: qrData.deliveryMethod
 };
 
 this.qrHistory.push(entry);
 
 // Keep only last 100 entries
 if (this.qrHistory.length > 100) {
   this.qrHistory = this.qrHistory.slice(-100);
 }
 
 // Update performance data
 this.updateQRPerformanceData(qrData);
 
 return this.save();
};

// Get QR usage history with filters
userSchema.methods.getQRHistory = function(limit = 10, filters = {}) {
 let history = [...this.qrHistory];
 
 // Apply filters
 if (filters.qrType) {
   history = history.filter(entry => entry.qrType === filters.qrType);
 }
 
 if (filters.success !== undefined) {
   history = history.filter(entry => entry.success === filters.success);
 }
 
 if (filters.hotelId) {
   history = history.filter(entry => entry.hotelId.toString() === filters.hotelId.toString());
 }
 
 if (filters.dateFrom) {
   history = history.filter(entry => new Date(entry.generatedAt) >= new Date(filters.dateFrom));
 }
 
 if (filters.dateTo) {
   history = history.filter(entry => new Date(entry.generatedAt) <= new Date(filters.dateTo));
 }
 
 // Sort by most recent first
 history.sort((a, b) => new Date(b.generatedAt) - new Date(a.generatedAt));
 
 return history.slice(0, limit);
};

// Get QR usage statistics
userSchema.methods.getQRUsageStats = function() {
 return this.qrUsageStats; // Uses virtual getter
};

// Update QR performance data
userSchema.methods.updateQRPerformanceData = function(qrData) {
 const perf = this.performanceData;
 
 // Update QR usage count
 perf.qrUsageCount++;
 
 // Update success rate
 if (qrData.success) {
   const currentSuccessful = Math.round((perf.qrSuccessRate / 100) * (perf.qrUsageCount - 1));
   perf.qrSuccessRate = ((currentSuccessful + 1) / perf.qrUsageCount) * 100;
   
   // Update average QR time for successful attempts
   if (qrData.checkInTime) {
     const currentAvg = perf.averageQRTime;
     const successfulAttempts = currentSuccessful + 1;
     perf.averageQRTime = ((currentAvg * (successfulAttempts - 1)) + qrData.checkInTime) / successfulAttempts;
   }
 } else {
   const currentSuccessful = Math.round((perf.qrSuccessRate / 100) * (perf.qrUsageCount - 1));
   perf.qrSuccessRate = (currentSuccessful / perf.qrUsageCount) * 100;
   
   // Increment error count
   perf.errorCount++;
   perf.errorRate = (perf.errorCount / perf.qrUsageCount) * 100;
   perf.lastError = new Date();
 }
 
 // Update feature usage
 const qrFeature = qrData.qrType === 'CHECK_IN' ? 'QR_CHECKIN' : 'QR_CHECKOUT';
 const feature = perf.featuresUsed.find(f => f.feature === qrFeature);
 if (feature) {
   feature.usageCount++;
   feature.lastUsed = new Date();
   if (qrData.checkInTime && qrData.success) {
     feature.avgTime = ((feature.avgTime * (feature.usageCount - 1)) + qrData.checkInTime) / feature.usageCount;
   }
 }
 
 return this;
};

// ============================================================================
// ✨ NEW CACHE PREFERENCE METHODS ✨
// ============================================================================

// Update cache preferences
userSchema.methods.updateCachePreferences = function(preferences) {
 // Merge with existing preferences
 if (preferences.enablePersonalization !== undefined) {
   this.cachePreferences.enablePersonalization = preferences.enablePersonalization;
 }
 
 if (preferences.dataFreshness !== undefined) {
   this.cachePreferences.dataFreshness = preferences.dataFreshness;
 }
 
 if (preferences.performanceMode !== undefined) {
   this.cachePreferences.performanceMode = preferences.performanceMode;
 }
 
 if (preferences.cacheSettings) {
   // Deep merge cache settings
   for (const [category, settings] of Object.entries(preferences.cacheSettings)) {
     if (!this.cachePreferences.cacheSettings[category]) {
       this.cachePreferences.cacheSettings[category] = {};
     }
     Object.assign(this.cachePreferences.cacheSettings[category], settings);
   }
 }
 
 // Update mobile and data preferences
 if (preferences.allowCacheOnMobile !== undefined) {
   this.cachePreferences.allowCacheOnMobile = preferences.allowCacheOnMobile;
 }
 
 if (preferences.allowBackgroundRefresh !== undefined) {
   this.cachePreferences.allowBackgroundRefresh = preferences.allowBackgroundRefresh;
 }
 
 if (preferences.maxCacheSize !== undefined) {
   this.cachePreferences.maxCacheSize = preferences.maxCacheSize;
 }
 
 // Update privacy preferences
 if (preferences.optOutTracking !== undefined) {
   this.cachePreferences.optOutTracking = preferences.optOutTracking;
 }
 
 if (preferences.sharePerformanceData !== undefined) {
   this.cachePreferences.sharePerformanceData = preferences.sharePerformanceData;
 }
 
 // Update advanced features
 if (preferences.prefetchContent !== undefined) {
   this.cachePreferences.prefetchContent = preferences.prefetchContent;
 }
 
 if (preferences.intelligentCaching !== undefined) {
   this.cachePreferences.intelligentCaching = preferences.intelligentCaching;
 }
 
 if (preferences.crossDeviceSync !== undefined) {
   this.cachePreferences.crossDeviceSync = preferences.crossDeviceSync;
 }
 
 return this.save();
};

// Get personalized cache settings based on user preferences and performance
userSchema.methods.getPersonalizedCacheSettings = function() {
 const prefs = this.cachePreferences;
 const perf = this.performanceData;
 
 if (!prefs.enablePersonalization) {
   return null; // Use default settings
 }
 
 const settings = { ...prefs.cacheSettings };
 
 // Adjust based on performance mode
 switch (prefs.performanceMode) {
   case 'BATTERY_SAVER':
     // Reduce refresh frequency, longer TTL
     Object.values(settings).forEach(category => {
       category.maxAge *= 1.5;
       category.autoRefresh = false;
     });
     break;
     
   case 'PERFORMANCE':
     // More aggressive caching, shorter TTL
     Object.values(settings).forEach(category => {
       category.maxAge *= 0.7;
       category.autoRefresh = true;
     });
     break;
     
   case 'BALANCED':
   default:
     // Keep default settings
     break;
 }
 
 // Adjust based on data freshness preference
 switch (prefs.dataFreshness) {
   case 'REAL_TIME':
     Object.values(settings).forEach(category => {
       category.maxAge *= 0.5;
       category.priority = 'HIGH';
     });
     break;
     
   case 'PERFORMANCE':
     Object.values(settings).forEach(category => {
       category.maxAge *= 2;
       if (category.priority === 'HIGH') category.priority = 'MEDIUM';
     });
     break;
     
   case 'BALANCED':
   default:
     // Keep settings as is
     break;
 }
 
 // Adjust based on historical performance
 if (perf.cacheHitRate < 60) {
   // Low hit rate, increase TTL
   Object.values(settings).forEach(category => {
     category.maxAge *= 1.3;
   });
 } else if (perf.cacheHitRate > 90) {
   // High hit rate, can be more aggressive
   Object.values(settings).forEach(category => {
     category.maxAge *= 0.8;
   });
 }
 
 return settings;
};

// ============================================================================
// ✨ NEW PERFORMANCE TRACKING METHODS ✨
// ============================================================================

// Update performance metrics
userSchema.methods.updatePerformanceData = function(metrics) {
 const perf = this.performanceData;
 
 // Update basic metrics
 if (metrics.responseTime !== undefined) {
   const totalSessions = perf.sessionCount || 1;
   perf.averageResponseTime = ((perf.averageResponseTime * (totalSessions - 1)) + metrics.responseTime) / totalSessions;
 }
 
 if (metrics.cacheHit !== undefined) {
   // Update cache hit/miss rates
   const totalCacheOps = perf.cacheHitRate + perf.cacheMissRate || 1;
   if (metrics.cacheHit) {
     perf.cacheHitRate = ((perf.cacheHitRate * totalCacheOps) + 100) / (totalCacheOps + 1);
   } else {
     perf.cacheMissRate = ((perf.cacheMissRate * totalCacheOps) + 100) / (totalCacheOps + 1);
   }
   
   // Normalize to maintain percentage
   const total = perf.cacheHitRate + perf.cacheMissRate;
   perf.cacheHitRate = (perf.cacheHitRate / total) * 100;
   perf.cacheMissRate = (perf.cacheMissRate / total) * 100;
 }
 
 // Update session metrics
 if (metrics.sessionDuration !== undefined) {
   perf.sessionCount++;
   perf.averageSessionDuration = ((perf.averageSessionDuration * (perf.sessionCount - 1)) + metrics.sessionDuration) / perf.sessionCount;
   perf.totalTimeSpent += metrics.sessionDuration;
 }
 
 // Update device performance
 if (metrics.deviceInfo) {
   Object.assign(perf.devicePerformance, metrics.deviceInfo);
 }
 
 // Update feature usage
 if (metrics.featureUsed) {
   const feature = perf.featuresUsed.find(f => f.feature === metrics.featureUsed.feature);
   if (feature) {
     feature.usageCount++;
     feature.lastUsed = new Date();
     if (metrics.featureUsed.time) {
       feature.avgTime = ((feature.avgTime * (feature.usageCount - 1)) + metrics.featureUsed.time) / feature.usageCount;
     }
   }
 }
 
 // Record errors
 if (metrics.error) {
   perf.errorCount++;
   perf.lastError = new Date();
   perf.errorRate = (perf.errorCount / Math.max(perf.sessionCount, 1)) * 100;
 }
 
 // Update last performance check
 perf.lastPerformanceCheck = new Date();
 
 // Add to daily trends
 this.addPerformanceDailyTrend();
 
 return this.save();
};

// Calculate user satisfaction score
userSchema.methods.calculateSatisfactionScore = function() {
 const perf = this.performanceData;
 const qrStats = this.qrUsageStats;
 
 let score = 50; // Base score
 
 // Cache performance factor (30% weight)
 const cacheScore = perf.cacheHitRate || 0;
 score += (cacheScore - 50) * 0.3;
 
 // Response time factor (25% weight) - lower is better
 const responseScore = Math.max(0, 100 - (perf.averageResponseTime / 10));
 score += (responseScore - 50) * 0.25;
 
 // QR success rate factor (25% weight)
 const qrScore = qrStats.successRate || 50;
 score += (qrScore - 50) * 0.25;
 
 // Error rate factor (20% weight) - lower is better
 const errorScore = Math.max(0, 100 - perf.errorRate);
 score += (errorScore - 50) * 0.2;
 
 // Normalize score
 score = Math.max(0, Math.min(100, score));
 
 // Update preference score
 perf.preferenceScore = Math.round(score);
 
 return score;
};

// Get QR performance score (helper method for virtual)
userSchema.methods.getQRPerformanceScore = function() {
 const qrStats = this.qrUsageStats;
 const perf = this.performanceData;
 
 if (qrStats.total === 0) return 50; // Default score if no usage
 
 let score = 0;
 
 // Success rate (60% weight)
 score += qrStats.successRate * 0.6;
 
 // Usage frequency (20% weight)
 const usageScore = Math.min(100, (qrStats.total / 10) * 100); // 10 uses = 100%
 score += usageScore * 0.2;
 
 // Average time (20% weight) - faster is better
 const timeScore = Math.max(0, 100 - (qrStats.avgCheckInTime / 100)); // 10s = 90%
 score += timeScore * 0.2;
 
 return Math.round(score);
};

// Get session performance score (helper method for virtual)
userSchema.methods.getSessionPerformanceScore = function() {
 const perf = this.performanceData;
 
 if (perf.sessionCount === 0) return 50;
 
 let score = 0;
 
 // Average session duration (40% weight) - reasonable duration is good
 const idealDuration = 300; // 5 minutes
 const durationScore = Math.max(0, 100 - Math.abs(perf.averageSessionDuration - idealDuration) / 10);
 score += durationScore * 0.4;
 
 // Response time (30% weight) - faster is better
 const responseScore = Math.max(0, 100 - (perf.averageResponseTime / 10));
 score += responseScore * 0.3;
 
 // Error rate (30% weight) - lower is better
 const errorScore = Math.max(0, 100 - perf.errorRate);
 score += errorScore * 0.3;
 
 return Math.round(score);
};

// Add daily performance trend
userSchema.methods.addPerformanceDailyTrend = function() {
 const today = new Date();
 today.setHours(0, 0, 0, 0);
 
 const trends = this.performanceData.trends.daily;
 const perf = this.performanceData;
 
 // Check if today's entry already exists
 const existingIndex = trends.findIndex(trend => 
   trend.date.toDateString() === today.toDateString()
 );
 
 const trendEntry = {
   date: today,
   responseTime: perf.averageResponseTime,
   cacheHitRate: perf.cacheHitRate,
   qrUsage: perf.qrUsageCount,
   sessionDuration: perf.averageSessionDuration
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

// Apply performance optimization
userSchema.methods.applyPerformanceOptimization = function(optimization) {
 const before = this.overallPerformanceScore;
 
 // Apply the optimization
 switch (optimization.type) {
   case 'CACHE_STRATEGY':
     this.updateCachePreferences(optimization.settings);
     break;
     
   case 'QR_SETTINGS':
     this.updateQRPreferences(optimization.settings);
     break;
     
   case 'PREFETCH_RULES':
     this.cachePreferences.prefetchContent = optimization.enabled;
     break;
     
   case 'COMPRESSION':
     // This would be handled at the system level
     break;
 }
 
 // Record the optimization
 this.performanceData.optimizations.push({
   type: optimization.type,
   appliedAt: new Date(),
   description: optimization.description,
   impact: {
     before: before,
     after: null, // Will be calculated later
     improvement: null
   },
   successful: true
 });
 
 this.performanceData.lastOptimization = new Date();
 
 return this.save();
};

// Get personalized recommendations
userSchema.methods.getPersonalizedRecommendations = function() {
 const recommendations = [];
 const perf = this.performanceData;
 const qrStats = this.qrUsageStats;
 const cacheScore = this.cachePerformanceScore;
 
 // Cache optimization recommendations
 if (cacheScore < 70) {
   recommendations.push({
     type: 'CACHE_OPTIMIZATION',
     priority: 'HIGH',
     title: 'Optimiser les performances cache',
     description: `Votre score cache (${cacheScore}%) peut être amélioré`,
     impact: 'Amélioration de 20-30% du temps de réponse',
     actions: [
       'Activer le cache intelligent',
       'Ajuster les préférences de fraîcheur des données',
       'Optimiser la taille du cache mobile'
     ]
   });
 }
 
 // QR usage recommendations
 if (qrStats.total > 0 && qrStats.successRate < 80) {
   recommendations.push({
     type: 'QR_IMPROVEMENT',
     priority: 'MEDIUM',
     title: 'Améliorer l\'expérience QR',
     description: `Taux de succès QR à ${qrStats.successRate}%`,
     impact: 'Réduction des échecs et gain de temps',
     actions: [
       'Vérifier les paramètres de géolocalisation',
       'Mettre à jour les préférences de style QR',
       'Activer les diagnostics automatiques'
     ]
   });
 }
 
 // Performance mode recommendations
 if (perf.averageResponseTime > 1000) {
   recommendations.push({
     type: 'PERFORMANCE_MODE',
     priority: 'MEDIUM',
     title: 'Optimiser le mode performance',
     description: `Temps de réponse moyen élevé (${Math.round(perf.averageResponseTime)}ms)`,
     impact: 'Amélioration de la réactivité',
     actions: [
       'Passer en mode Performance',
       'Activer le préchargement de contenu',
       'Optimiser les paramètres réseau'
     ]
   });
 }
 
 // Feature adoption recommendations
 const featureScore = this.featureAdoptionScore;
 if (featureScore < 50) {
   recommendations.push({
     type: 'FEATURE_ADOPTION',
     priority: 'LOW',
     title: 'Découvrir de nouvelles fonctionnalités',
     description: `Vous utilisez ${featureScore}% des fonctionnalités disponibles`,
     impact: 'Amélioration de l\'expérience utilisateur',
     actions: [
       'Explorer les fonctionnalités de comparaison de prix',
       'Utiliser les points de fidélité',
       'Essayer les upgrades de chambre automatiques'
     ]
   });
 }
 
 return recommendations;
};

// ============================================================================
// STATIC METHODS (existing + new QR + Cache analytics)
// ============================================================================

// Existing static methods preserved
userSchema.statics.findByEmail = function(email) {
 return this.findOne({ 
   email: email.toLowerCase(),
   isActive: true 
 }).select('+password').populate('company');
};

userSchema.statics.findByCompany = function(companyId, filters = {}) {
 return this.find({ 
   company: companyId,
   isActive: true,
   ...filters
 }).populate('hierarchy.manager', 'firstName lastName jobTitle');
};

userSchema.statics.findApproversForAmount = function(companyId, amount) {
 return this.find({
   company: companyId,
   'hierarchy.canApprove': true,
   'hierarchy.approvalLimit': { $gte: amount },
   isActive: true
 }).sort({ 'hierarchy.level': 1 });
};

userSchema.statics.checkPermissions = function(userRole, requiredRoles) {
 if (!Array.isArray(requiredRoles)) {
   requiredRoles = [requiredRoles];
 }
 return requiredRoles.includes(userRole);
};

userSchema.statics.getStatsByRole = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   { 
     $group: { 
       _id: { role: '$role', userType: '$userType' }, 
       count: { $sum: 1 } 
     } 
   },
   { $sort: { '_id.role': 1, '_id.userType': 1 } }
 ]);
};

userSchema.statics.getCompanyStats = function(companyId) {
 return this.aggregate([
   { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
   {
     $group: {
       _id: '$department',
       employeeCount: { $sum: 1 },
       totalSpent: { $sum: '$stats.totalSpent' },
       totalBookings: { $sum: '$stats.totalBookings' },
       managers: { 
         $sum: { $cond: [{ $eq: ['$userType', 'manager'] }, 1, 0] } 
       }
     }
   }
 ]);
};

userSchema.statics.getLoyaltyStats = function() {
 return this.aggregate([
   { $match: { 'loyalty.enrolledAt': { $exists: true } } },
   {
     $group: {
       _id: '$loyalty.tier',
       count: { $sum: 1 },
       totalPoints: { $sum: '$loyalty.currentPoints' },
       avgPoints: { $avg: '$loyalty.currentPoints' },
       totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' }
     }
   },
   { $sort: { '_id': 1 } }
 ]);
};

// ✨ NEW QR ANALYTICS STATIC METHODS ✨

// Get QR adoption statistics
userSchema.statics.getQRAdoptionStats = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   {
     $group: {
       _id: null,
       totalUsers: { $sum: 1 },
       qrEnabledUsers: { 
         $sum: { $cond: ['$qrPreferences.enabled', 1, 0] } 
       },
       avgQRUsage: { 
         $avg: '$performanceData.qrUsageCount' 
       },
       avgQRSuccessRate: { 
         $avg: '$performanceData.qrSuccessRate' 
       },
       totalQRUsages: { 
         $sum: '$performanceData.qrUsageCount' 
       }
     }
   },
   {
     $addFields: {
       adoptionRate: {
         $multiply: [
           { $divide: ['$qrEnabledUsers', '$totalUsers'] },
           100
         ]
       }
     }
   }
 ]);
};

// Get QR preference patterns
userSchema.statics.getQRPreferencePatterns = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'qrPreferences.enabled': true 
     } 
   },
   {
     $group: {
       _id: {
         style: '$qrPreferences.preferredStyle',
         language: '$qrPreferences.language'
       },
       count: { $sum: 1 },
       avgSuccessRate: { $avg: '$performanceData.qrSuccessRate' },
       avgUsageCount: { $avg: '$performanceData.qrUsageCount' }
     }
   },
   { $sort: { count: -1 } }
 ]);
};

// Get users with QR issues
userSchema.statics.getUsersWithQRIssues = function(successRateThreshold = 70) {
 return this.find({
   isActive: true,
   'qrPreferences.enabled': true,
   'performanceData.qrUsageCount': { $gt: 0 },
   'performanceData.qrSuccessRate': { $lt: successRateThreshold }
 })
 .select('firstName lastName email performanceData.qrSuccessRate performanceData.qrUsageCount')
 .sort({ 'performanceData.qrSuccessRate': 1 });
};

// ✨ NEW CACHE ANALYTICS STATIC METHODS ✨

// Get cache performance overview
userSchema.statics.getCachePerformanceOverview = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'cachePreferences.enablePersonalization': true 
     } 
   },
   {
     $group: {
       _id: null,
       totalUsers: { $sum: 1 },
       avgHitRate: { $avg: '$performanceData.cacheHitRate' },
       avgResponseTime: { $avg: '$performanceData.averageResponseTime' },
       excellentCacheUsers: {
         $sum: {
           $cond: [
             { $gte: ['$performanceData.cacheHitRate', 85] },
             1,
             0
           ]
         }
       },
       poorCacheUsers: {
         $sum: {
           $cond: [
             { $lt: ['$performanceData.cacheHitRate', 60] },
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
           { $divide: ['$excellentCacheUsers', '$totalUsers'] },
           100
         ]
       },
       poorCachePercentage: {
         $multiply: [
           { $divide: ['$poorCacheUsers', '$totalUsers'] },
           100
         ]
       }
     }
   }
 ]);
};

// Get cache preference distribution
userSchema.statics.getCachePreferenceDistribution = function() {
 return this.aggregate([
   { 
     $match: { 
       isActive: true,
       'cachePreferences.enablePersonalization': true 
     } 
   },
   {
     $group: {
       _id: {
         dataFreshness: '$cachePreferences.dataFreshness',
         performanceMode: '$cachePreferences.performanceMode'
       },
       count: { $sum: 1 },
       avgHitRate: { $avg: '$performanceData.cacheHitRate' },
       avgResponseTime: { $avg: '$performanceData.averageResponseTime' },
       avgSatisfactionScore: { $avg: '$performanceData.preferenceScore' }
     }
   },
   { $sort: { count: -1 } }
 ]);
};

// ✨ NEW PERFORMANCE ANALYTICS STATIC METHODS ✨

// Get overall user performance summary
userSchema.statics.getUserPerformanceSummary = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   {
     $group: {
       _id: null,
       totalUsers: { $sum: 1 },
       avgCacheHitRate: { $avg: '$performanceData.cacheHitRate' },
       avgQRSuccessRate: { $avg: '$performanceData.qrSuccessRate' },
       avgResponseTime: { $avg: '$performanceData.averageResponseTime' },
       avgSatisfactionScore: { $avg: '$performanceData.preferenceScore' },
       highPerformingUsers: {
         $sum: {
           $cond: [
             { $gte: ['$performanceData.preferenceScore', 80] },
             1,
             0
           ]
         }
       },
       lowPerformingUsers: {
         $sum: {
           $cond: [
             { $lt: ['$performanceData.preferenceScore', 60] },
             1,
             0
           ]
         }
       }
     }
   },
   {
     $addFields: {
       highPerformancePercentage: {
         $multiply: [
           { $divide: ['$highPerformingUsers', '$totalUsers'] },
           100
         ]
       },
       lowPerformancePercentage: {
         $multiply: [
           { $divide: ['$lowPerformingUsers', '$totalUsers'] },
           100
         ]
       }
     }
   }
 ]);
};

// Get users needing optimization
userSchema.statics.getUsersNeedingOptimization = function() {
 return this.find({
   isActive: true,
   $or: [
     { 'performanceData.cacheHitRate': { $lt: 60 } },
     { 'performanceData.qrSuccessRate': { $lt: 70 } },
     { 'performanceData.averageResponseTime': { $gt: 1000 } },
     { 'performanceData.preferenceScore': { $lt: 60 } }
   ]
 })
 .select('firstName lastName email performanceData')
 .sort({ 'performanceData.preferenceScore': 1 });
};

// Get feature adoption statistics
userSchema.statics.getFeatureAdoptionStats = function() {
 return this.aggregate([
   { $match: { isActive: true } },
   { $unwind: '$performanceData.featuresUsed' },
   {
     $group: {
       _id: '$performanceData.featuresUsed.feature',
       totalUsers: { $sum: 1 },
       activeUsers: {
         $sum: {
           $cond: [
             { $gt: ['$performanceData.featuresUsed.usageCount', 0] },
             1,
             0
           ]
         }
       },
       avgUsageCount: { $avg: '$performanceData.featuresUsed.usageCount' },
       avgUsageTime: { $avg: '$performanceData.featuresUsed.avgTime' }
     }
   },
   {
     $addFields: {
       adoptionRate: {
         $multiply: [
           { $divide: ['$activeUsers', '$totalUsers'] },
           100
         ]
       }
     }
   },
   { $sort: { adoptionRate: -1 } }
 ]);
};

// ============================================================================
// EXPORT
// ============================================================================

const User = mongoose.model('User', userSchema);

module.exports = User;