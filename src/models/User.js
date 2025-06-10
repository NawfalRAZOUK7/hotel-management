const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
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
    select: false // N'inclut pas le password dans les requêtes par défaut
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

  // ===== NOUVEAUX CHAMPS ENTREPRISE =====
  userType: { 
    type: String, 
    enum: ['individual', 'employee', 'manager', 'company_admin'], 
    default: 'individual',
    required: true
  },
  
  // Référence vers l'entreprise
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company',
    required: function() { 
      return this.userType !== 'individual'; 
    },
    validate: {
      validator: function(v) {
        // Si userType n'est pas 'individual', company est requis
        return this.userType === 'individual' || v != null;
      },
      message: 'L\'entreprise est requise pour les utilisateurs non individuels'
    }
  },
  
  // Informations département et poste
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
    maxlength: [20, 'L\'ID employé ne peut pas dépasser 20 caractères'],
    validate: {
      validator: function(v) {
        // Unique par entreprise seulement
        if (!v || this.userType === 'individual') return true;
        return true; // La validation unique sera gérée par un index composé
      }
    }
  },
  
  // ===== HIÉRARCHIE ENTREPRISE =====
  hierarchy: {
    // Manager direct de cet utilisateur
    manager: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      validate: {
        validator: function(v) {
          // Le manager doit appartenir à la même entreprise
          return !v || this.userType === 'individual';
        }
      }
    },
    
    // Peut-il approuver des demandes ?
    canApprove: { 
      type: Boolean, 
      default: false 
    },
    
    // Limite d'approbation en euros
    approvalLimit: { 
      type: Number, 
      default: 0,
      min: [0, 'La limite d\'approbation ne peut être négative'],
      max: [100000, 'La limite d\'approbation ne peut excéder 100 000€']
    },
    
    // Liste des subordonnés directs
    subordinates: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    }],
    
    // Niveau hiérarchique (1 = employé, 2 = manager, 3 = directeur, etc.)
    level: {
      type: Number,
      default: 1,
      min: [1, 'Le niveau hiérarchique minimum est 1'],
      max: [10, 'Le niveau hiérarchique maximum est 10']
    }
  },
  
  // ===== PERMISSIONS DÉTAILLÉES =====
  permissions: {
    // Permissions de base
    canBook: { 
      type: Boolean, 
      default: true 
    },
    
    canApprove: { 
      type: Boolean, 
      default: false 
    },
    
    canViewReports: { 
      type: Boolean, 
      default: false 
    },
    
    canManageTeam: { 
      type: Boolean, 
      default: false 
    },
    
    // Permissions avancées
    canModifyBookings: {
      type: Boolean,
      default: false
    },
    
    canAccessFinancials: {
      type: Boolean,
      default: false
    },
    
    canManageContracts: {
      type: Boolean,
      default: false
    },
    
    // Limites spécifiques
    maxBookingAmount: {
      type: Number,
      default: 5000, // Limite par défaut de 5000€
      min: [0, 'Le montant maximum ne peut être négatif']
    },
    
    maxAdvanceBooking: {
      type: Number,
      default: 90, // Réservation max 90 jours à l'avance
      min: [1, 'La réservation à l\'avance minimum est 1 jour']
    },
    
    allowedHotels: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel'
    }], // Liste des hôtels autorisés (vide = tous autorisés)
    
    restrictedDates: [{
      startDate: Date,
      endDate: Date,
      reason: String
    }] // Périodes où l'utilisateur ne peut pas réserver
  },

  // ===== INFORMATIONS ENTREPRISE (LEGACY - pour compatibilité) =====
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

  // Type de clientèle selon le cahier des charges
  clientType: {
    type: String,
    enum: ['INDIVIDUAL', 'COMPANY'],
    default: 'INDIVIDUAL'
  },

  // ===== PARAMÈTRES UTILISATEUR ENTREPRISE =====
  enterpriseSettings: {
    // Notifications spécifiques entreprise
    notifications: {
      approvalRequests: { type: Boolean, default: true },
      teamBookings: { type: Boolean, default: false },
      budgetAlerts: { type: Boolean, default: true },
      contractUpdates: { type: Boolean, default: true }
    },
    
    // Préférences de réservation
    defaultCostCenter: String,
    defaultProjectCode: String,
    autoApprovalAmount: { 
      type: Number, 
      default: 0 
    }, // Montant en dessous duquel auto-approbation
    
    // Délégations temporaires
    delegations: [{
      delegateTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      startDate: Date,
      endDate: Date,
      permissions: [String], // Liste des permissions déléguées
      isActive: { type: Boolean, default: true }
    }]
  },

  // ===== STATUT ET SÉCURITÉ =====
  isActive: {
    type: Boolean,
    default: true
  },

  isEmailVerified: {
    type: Boolean,
    default: false
  },

  // ===== SUIVI DES CONNEXIONS =====
  lastLogin: {
    type: Date
  },

  loginAttempts: {
    type: Number,
    default: 0
  },

  lockUntil: {
    type: Date
  },

  // ===== RESET PASSWORD =====
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // ===== EMAIL VERIFICATION =====
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // ===== PRÉFÉRENCES UTILISATEUR =====
  preferences: {
    language: {
      type: String,
      enum: ['fr', 'en', 'es', 'de'],
      default: 'fr'
    },
    
    timezone: {
      type: String,
      default: 'Europe/Paris'
    },
    
    currency: {
      type: String,
      enum: ['EUR', 'USD', 'GBP', 'CHF'],
      default: 'EUR'
    },
    
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      },
      inApp: {
        type: Boolean,
        default: true
      }
    },
    
    dashboard: {
      defaultView: {
        type: String,
        enum: ['bookings', 'calendar', 'stats', 'approvals'],
        default: 'bookings'
      },
      showTutorial: {
        type: Boolean,
        default: true
      }
    }
  },

  // ===== STATISTIQUES UTILISATEUR =====
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

  // ===== PROGRAMME DE FIDÉLITÉ =====
  loyalty: {
    // Points actuels disponibles
    currentPoints: {
      type: Number,
      default: 0,
      min: [0, 'Les points ne peuvent pas être négatifs'],
      index: true
    },
    
    // Points totaux accumulés (lifetime)
    lifetimePoints: {
      type: Number,
      default: 0,
      min: [0, 'Les points lifetime ne peuvent pas être négatifs'],
      index: true
    },
    
    // Niveau de fidélité
    tier: {
      type: String,
      enum: {
        values: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
        message: 'Niveau de fidélité invalide'
      },
      default: 'BRONZE',
      index: true
    },
    
    // Date d'adhésion au programme
    enrolledAt: {
      type: Date,
      default: Date.now
    },
    
    // Progression vers niveau suivant
    tierProgress: {
      pointsToNextTier: {
        type: Number,
        default: 1000,
        min: [0, 'Points vers niveau suivant ne peut être négatif']
      },
      nextTier: {
        type: String,
        enum: ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
        default: 'SILVER'
      },
      progressPercentage: {
        type: Number,
        default: 0,
        min: [0, 'Pourcentage minimum 0'],
        max: [100, 'Pourcentage maximum 100']
      }
    },
    
    // Statistiques du programme de fidélité
    statistics: {
      totalBookingsWithPoints: {
        type: Number,
        default: 0
      },
      totalPointsEarned: {
        type: Number,
        default: 0
      },
      totalPointsRedeemed: {
        type: Number,
        default: 0
      },
      totalSpentWithProgram: {
        type: Number,
        default: 0
      },
      favoriteHotelChain: {
        type: String,
        maxlength: [100, 'Nom chaîne hôtel trop long']
      },
      averageBookingValueWithPoints: {
        type: Number,
        default: 0
      },
      lastActivity: {
        type: Date,
        default: Date.now
      },
      joinDate: {
        type: Date,
        default: Date.now
      }
    },
    
    // Préférences du programme de fidélité
    preferences: {
      // Préférences de chambre
      roomType: {
        type: String,
        enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE']
      },
      floorPreference: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH'],
        default: 'MEDIUM'
      },
      viewPreference: {
        type: String,
        enum: ['CITY', 'SEA', 'MOUNTAIN', 'GARDEN', 'ANY'],
        default: 'ANY'
      },
      
      // Équipements préférés
      amenities: [{
        type: String,
        enum: [
          'WiFi', 'Parking', 'Piscine', 'Spa', 'Salle_sport',
          'Restaurant', 'Bar', 'Room_service', 'Climatisation', 
          'Coffre_fort', 'Blanchisserie', 'Conciergerie', 'Animaux'
        ]
      }],
      
      // Services additionnels préférés
      services: [{
        type: String,
        enum: [
          'Petit_dejeuner', 'Diner', 'Transport_aeroport', 
          'Location_voiture', 'Excursions', 'Massage', 'Spa'
        ]
      }],
      
      // Préférences de communication
      communicationPreferences: {
        email: { 
          type: Boolean, 
          default: true 
        },
        sms: { 
          type: Boolean, 
          default: true 
        },
        push: { 
          type: Boolean, 
          default: true 
        },
        newsletter: { 
          type: Boolean, 
          default: true 
        },
        promotions: { 
          type: Boolean, 
          default: true 
        },
        tierUpdates: { 
          type: Boolean, 
          default: true 
        }
      }
    },
    
    // Bénéfices actifs du niveau
    activeBenefits: [{
      type: {
        type: String,
        enum: [
          'DISCOUNT', 'UPGRADE', 'FREE_NIGHT', 'EARLY_CHECKIN', 
          'LATE_CHECKOUT', 'BONUS_POINTS', 'FREE_BREAKFAST',
          'LOUNGE_ACCESS', 'FREE_WIFI', 'ROOM_SERVICE_DISCOUNT',
          'SPA_DISCOUNT', 'PARKING_FREE', 'AIRPORT_TRANSFER'
        ],
        required: true
      },
      value: {
        type: Number, // Pourcentage de réduction ou valeur
        required: true,
        min: [0, 'Valeur du bénéfice ne peut être négative']
      },
      description: {
        type: String,
        required: true,
        maxlength: [200, 'Description du bénéfice trop longue']
      },
      validUntil: {
        type: Date,
        required: true
      },
      usageCount: {
        type: Number,
        default: 0,
        min: [0, 'Usage count ne peut être négatif']
      },
      maxUsage: {
        type: Number,
        default: 1,
        min: [1, 'Usage maximum doit être au moins 1']
      },
      isActive: {
        type: Boolean,
        default: true
      },
      autoRenew: {
        type: Boolean,
        default: false
      }
    }],
    
    // Historique des niveaux
    tierHistory: [{
      tier: {
        type: String,
        enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
        required: true
      },
      achievedAt: {
        type: Date,
        required: true
      },
      pointsAtAchievement: {
        type: Number,
        required: true
      },
      celebrationSent: {
        type: Boolean,
        default: false
      }
    }],
    
    // Objectifs personnalisés
    personalGoals: {
      targetTier: {
        type: String,
        enum: ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']
      },
      targetPoints: {
        type: Number,
        min: [0, 'Points objectif ne peut être négatif']
      },
      targetDate: {
        type: Date
      },
      isActive: {
        type: Boolean,
        default: false
      }
    },
    
    // Métriques de performance
    performance: {
      // Vitesse d'accumulation (points/mois)
      pointsVelocity: {
        type: Number,
        default: 0
      },
      
      // Taux d'utilisation des points
      redemptionRate: {
        type: Number,
        default: 0,
        min: [0, 'Taux utilisation minimum 0'],
        max: [100, 'Taux utilisation maximum 100']
      },
      
      // Engagement score (0-100)
      engagementScore: {
        type: Number,
        default: 50,
        min: [0, 'Score engagement minimum 0'],
        max: [100, 'Score engagement maximum 100']
      },
      
      // Dernière mise à jour des métriques
      lastCalculated: {
        type: Date,
        default: Date.now
      }
    },
    
    // Statut spécial
    specialStatus: {
      isVIP: {
        type: Boolean,
        default: false
      },
      vipSince: {
        type: Date
      },
      isInfluencer: {
        type: Boolean,
        default: false
      },
      specialOffers: [{
        name: String,
        description: String,
        validUntil: Date,
        used: { type: Boolean, default: false }
      }]
    }
  },

  // ===== MÉTADONNÉES =====
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  invitedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  invitationToken: String,
  invitationExpires: Date,
  
  lastActivityDate: {
    type: Date,
    default: Date.now
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
// INDEXES POUR PERFORMANCE
// ============================================================================

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

// ============================================================================
// VIRTUALS
// ============================================================================

// Nom complet
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Nom complet avec titre
userSchema.virtual('fullNameWithTitle').get(function() {
  const name = this.fullName;
  return this.jobTitle ? `${name} (${this.jobTitle})` : name;
});

// Vérifier si le compte est verrouillé
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// Vérifier si c'est un utilisateur entreprise
userSchema.virtual('isEnterpriseUser').get(function() {
  return this.userType !== 'individual';
});

// Obtenir le niveau d'autorité
userSchema.virtual('authorityLevel').get(function() {
  if (this.userType === 'company_admin') return 'admin';
  if (this.userType === 'manager') return 'manager';
  if (this.userType === 'employee') return 'employee';
  return 'individual';
});

// Indiquer si l'utilisateur est inscrit au programme loyalty
userSchema.virtual('isLoyaltyMember').get(function() {
  return this.loyalty && this.loyalty.enrolledAt != null;
});

// Obtenir le nom du niveau en français
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

// Calculer la valeur estimée des points
userSchema.virtual('pointsValue').get(function() {
  // 100 points = 1 euro
  return this.loyalty?.currentPoints ? (this.loyalty.currentPoints / 100) : 0;
});

// Vérifier si proche du niveau suivant
userSchema.virtual('isCloseToNextTier').get(function() {
  return this.loyalty?.tierProgress?.progressPercentage >= 80;
});

// Obtenir les bénéfices actifs non expirés
userSchema.virtual('validBenefits').get(function() {
  if (!this.loyalty?.activeBenefits) return [];
  
  const now = new Date();
  return this.loyalty.activeBenefits.filter(benefit => 
    benefit.isActive && 
    benefit.validUntil > now &&
    benefit.usageCount < benefit.maxUsage
  );
});

// Relations virtuelles
userSchema.virtual('managedEmployees', {
  ref: 'User',
  localField: '_id',
  foreignField: 'hierarchy.manager'
});

userSchema.virtual('companyBookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'user'
});

// ============================================================================
// MIDDLEWARE PRE-SAVE
// ============================================================================

// Hash du mot de passe avant sauvegarde
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

// Mise à jour automatique des champs selon le type d'utilisateur
userSchema.pre('save', function(next) {
  // Mise à jour du clientType pour compatibilité
  if (this.company || this.companyName || this.siret) {
    this.clientType = 'COMPANY';
  } else {
    this.clientType = 'INDIVIDUAL';
  }

  // Ajuster les permissions selon le userType
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
      this.hierarchy.approvalLimit = 5000; // Limite par défaut manager
    }
  }

  // Mettre à jour lastActivityDate
  this.lastActivityDate = new Date();
  
  next();
});

// Valider la hiérarchie avant sauvegarde
userSchema.pre('save', async function(next) {
  if (this.hierarchy.manager && this.isModified('hierarchy.manager')) {
    try {
      const manager = await this.constructor.findById(this.hierarchy.manager);
      
      if (!manager) {
        return next(new Error('Manager introuvable'));
      }
      
      // Vérifier que le manager appartient à la même entreprise
      if (this.company && !manager.company?.equals(this.company)) {
        return next(new Error('Le manager doit appartenir à la même entreprise'));
      }
      
      // Vérifier que le manager a les permissions d'encadrement
      if (!manager.permissions.canManageTeam && manager.userType !== 'manager' && manager.userType !== 'company_admin') {
        return next(new Error('Le manager sélectionné n\'a pas les permissions d\'encadrement'));
      }
      
    } catch (error) {
      return next(error);
    }
  }
  
  next();
});

// ============================================================================
// MÉTHODES D'INSTANCE
// ============================================================================

// Comparer le mot de passe
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!candidatePassword) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Générer JWT token avec informations entreprise
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

// Générer refresh token
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

// Vérifier les permissions pour une action
userSchema.methods.hasPermission = function(permission, amount = 0) {
  // Vérifications de base
  if (!this.isActive) return false;
  if (!this.permissions[permission]) return false;
  
  // Vérifications spécifiques selon le type de permission
  switch (permission) {
    case 'canBook':
      return amount <= this.permissions.maxBookingAmount;
      
    case 'canApprove':
      return this.hierarchy.canApprove && amount <= this.hierarchy.approvalLimit;
      
    default:
      return this.permissions[permission] === true;
  }
};

// Créer une délégation de permissions
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

// Obtenir les permissions effectives (incluant délégations)
userSchema.methods.getEffectivePermissions = async function() {
  let effectivePermissions = { ...this.permissions };
  
  // Ajouter les permissions déléguées actives
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

// Mettre à jour les statistiques utilisateur
userSchema.methods.updateBookingStats = function(bookingAmount) {
  this.stats.totalBookings += 1;
  this.stats.totalSpent += bookingAmount;
  this.stats.averageBookingValue = this.stats.totalSpent / this.stats.totalBookings;
  this.stats.lastBookingDate = new Date();
  
  return this.save({ validateBeforeSave: false });
};

// Calculer et mettre à jour la progression vers le niveau suivant
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
 
 // Déterminer le niveau suivant
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
   // Niveau maximum atteint
   this.loyalty.tierProgress = {
     pointsToNextTier: 0,
     nextTier: 'DIAMOND',
     progressPercentage: 100
   };
 }
 
 return this;
};

// Vérifier et mettre à jour le niveau si nécessaire
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
   
   // Ajouter à l'historique
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

// Ajouter des points au compte
userSchema.methods.addLoyaltyPoints = function(points, description = 'Points ajoutés') {
 this.loyalty.currentPoints += points;
 this.loyalty.lifetimePoints += points;
 this.loyalty.statistics.totalPointsEarned += points;
 this.loyalty.statistics.lastActivity = new Date();
 
 // Mettre à jour progression
 this.updateTierProgress();
 
 // Vérifier upgrade de niveau
 const tierCheck = this.checkTierUpgrade();
 
 return {
   newBalance: this.loyalty.currentPoints,
   lifetimePoints: this.loyalty.lifetimePoints,
   tierUpgrade: tierCheck
 };
};

// Utiliser des points
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

// Obtenir les bénéfices disponibles selon le niveau
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

// Calculer métriques de performance loyalty
userSchema.methods.calculateLoyaltyPerformance = function() {
 const now = new Date();
 const enrolledMonths = Math.max(1, Math.floor((now - this.loyalty.enrolledAt) / (30 * 24 * 60 * 60 * 1000)));
 
 // Vitesse d'accumulation (points/mois)
 const pointsVelocity = this.loyalty.lifetimePoints / enrolledMonths;
 
 // Taux d'utilisation
 const redemptionRate = this.loyalty.lifetimePoints > 0 
   ? (this.loyalty.statistics.totalPointsRedeemed / this.loyalty.lifetimePoints) * 100 
   : 0;
 
 // Score d'engagement (basé sur activité, utilisation, progression)
 const activityScore = this.loyalty.statistics.lastActivity > new Date(now - 30 * 24 * 60 * 60 * 1000) ? 25 : 0;
 const usageScore = redemptionRate > 10 ? 25 : redemptionRate > 5 ? 15 : 10;
 const progressScore = this.loyalty.tierProgress.progressPercentage / 4; // Max 25 points
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

// ===== MÉTHODES HÉRITÉES (inchangées) =====
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
// MÉTHODES STATIQUES ÉTENDUES
// ============================================================================

// Trouver par email avec gestion du verrouillage
userSchema.statics.findByEmail = function(email) {
 return this.findOne({ 
   email: email.toLowerCase(),
   isActive: true 
 }).select('+password').populate('company');
};

// Trouver les employés d'une entreprise
userSchema.statics.findByCompany = function(companyId, filters = {}) {
 return this.find({ 
   company: companyId,
   isActive: true,
   ...filters
 }).populate('hierarchy.manager', 'firstName lastName jobTitle');
};

// Trouver les approbateurs disponibles pour un montant
userSchema.statics.findApproversForAmount = function(companyId, amount) {
 return this.find({
   company: companyId,
   'hierarchy.canApprove': true,
   'hierarchy.approvalLimit': { $gte: amount },
   isActive: true
 }).sort({ 'hierarchy.level': 1 });
};

// Vérifier les permissions
userSchema.statics.checkPermissions = function(userRole, requiredRoles) {
 if (!Array.isArray(requiredRoles)) {
   requiredRoles = [requiredRoles];
 }
 return requiredRoles.includes(userRole);
};

// Statistiques des utilisateurs par rôle et type
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

// Statistiques par entreprise
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

// Obtenir statistiques du programme de fidélité
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

// ============================================================================
// EXPORT
// ============================================================================

const User = mongoose.model('User', userSchema);

module.exports = User;