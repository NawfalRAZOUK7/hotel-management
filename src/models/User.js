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

// ============================================================================
// EXPORT
// ============================================================================

const User = mongoose.model('User', userSchema);

module.exports = User;