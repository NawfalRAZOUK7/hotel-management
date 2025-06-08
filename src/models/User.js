const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
  // Informations personnelles
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

  // Système de rôles selon le cahier des charges
  role: {
    type: String,
    enum: {
      values: ['CLIENT', 'RECEPTIONIST', 'ADMIN'],
      message: 'Le rôle doit être CLIENT, RECEPTIONIST ou ADMIN'
    },
    default: 'CLIENT'
  },

  // Informations complémentaires pour les entreprises (personnes morales)
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

  // Statut et sécurité
  isActive: {
    type: Boolean,
    default: true
  },

  isEmailVerified: {
    type: Boolean,
    default: false
  },

  // Suivi des connexions
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

  // Reset password
  resetPasswordToken: String,
  resetPasswordExpires: Date,

  // Email verification
  emailVerificationToken: String,
  emailVerificationExpires: Date,

  // Préférences utilisateur
  preferences: {
    language: {
      type: String,
      enum: ['fr', 'en'],
      default: 'fr'
    },
    notifications: {
      email: {
        type: Boolean,
        default: true
      },
      sms: {
        type: Boolean,
        default: false
      }
    }
  },

  // Métadonnées
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
// INDEXES POUR PERFORMANCE
// ============================================================================

userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ role: 1 });
userSchema.index({ isActive: 1 });
userSchema.index({ createdAt: -1 });

// ============================================================================
// VIRTUALS
// ============================================================================

// Nom complet
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Vérifier si le compte est verrouillé
userSchema.virtual('isLocked').get(function() {
  return !!(this.lockUntil && this.lockUntil > Date.now());
});

// ============================================================================
// MIDDLEWARE PRE-SAVE
// ============================================================================

// Hash du mot de passe avant sauvegarde
userSchema.pre('save', async function(next) {
  // Ne hash que si le password est modifié
  if (!this.isModified('password')) return next();

  try {
    // Hash avec salt rounds élevé pour sécurité
    const salt = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Mise à jour du type de client selon les données
userSchema.pre('save', function(next) {
  if (this.companyName || this.siret) {
    this.clientType = 'COMPANY';
  } else {
    this.clientType = 'INDIVIDUAL';
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

// Générer JWT token
userSchema.methods.generateAuthToken = function() {
  const payload = {
    userId: this._id,
    email: this.email,
    role: this.role,
    fullName: this.fullName
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

// Générer token de reset password
userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');
  
  // Hash du token avant stockage
  this.resetPasswordToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');
    
  // Expiration dans 10 minutes
  this.resetPasswordExpires = Date.now() + 10 * 60 * 1000;
  
  return resetToken; // Retourne le token non-hashé
};

// Générer token de vérification email
userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');
  
  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');
    
  // Expiration dans 24h
  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000;
  
  return verificationToken;
};

// Incrémenter les tentatives de connexion
userSchema.methods.incLoginAttempts = function() {
  // Si on a déjà un verrou et qu'il a expiré, reset
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.updateOne({
      $unset: {
        loginAttempts: 1,
        lockUntil: 1
      }
    });
  }
  
  const updates = { $inc: { loginAttempts: 1 } };
  
  // Verrouiller après 5 tentatives échouées
  if (this.loginAttempts + 1 >= 5 && !this.isLocked) {
    updates.$set = {
      lockUntil: Date.now() + 2 * 60 * 60 * 1000 // 2 heures
    };
  }
  
  return this.updateOne(updates);
};

// Reset des tentatives de connexion
userSchema.methods.resetLoginAttempts = function() {
  return this.updateOne({
    $unset: {
      loginAttempts: 1,
      lockUntil: 1
    }
  });
};

// Mettre à jour la dernière connexion
userSchema.methods.updateLastLogin = function() {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

// ============================================================================
// MÉTHODES STATIQUES
// ============================================================================

// Trouver par email avec gestion du verrouillage
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ 
    email: email.toLowerCase(),
    isActive: true 
  }).select('+password');
};

// Vérifier les permissions
userSchema.statics.checkPermissions = function(userRole, requiredRoles) {
  if (!Array.isArray(requiredRoles)) {
    requiredRoles = [requiredRoles];
  }
  return requiredRoles.includes(userRole);
};

// Statistiques des utilisateurs par rôle
userSchema.statics.getStatsByRole = function() {
  return this.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
};

// ============================================================================
// EXPORT
// ============================================================================

const User = mongoose.model('User', userSchema);

module.exports = User;