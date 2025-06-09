// models/Company.js - Modèle Entreprise Complet
const mongoose = require('mongoose');

const companySchema = new mongoose.Schema({
  // ===== INFORMATIONS GÉNÉRALES =====
  name: { 
    type: String, 
    required: [true, 'Le nom de l\'entreprise est requis'],
    trim: true,
    maxlength: [100, 'Le nom ne peut excéder 100 caractères']
  },
  
  siret: { 
    type: String, 
    unique: true, 
    required: [true, 'Le numéro SIRET est requis'],
    validate: {
      validator: function(v) {
        return /^\d{14}$/.test(v); // 14 chiffres exactement
      },
      message: 'Le SIRET doit contenir exactement 14 chiffres'
    }
  },
  
  vatNumber: { 
    type: String, 
    required: [true, 'Le numéro de TVA est requis'],
    uppercase: true,
    validate: {
      validator: function(v) {
        return /^FR\d{11}$/.test(v); // Format FR + 11 chiffres
      },
      message: 'Le numéro de TVA doit être au format FR + 11 chiffres'
    }
  },
  
  industry: { 
    type: String, 
    required: [true, 'Le secteur d\'activité est requis'],
    enum: [
      'technology', 'finance', 'healthcare', 'education', 'manufacturing',
      'retail', 'consulting', 'real_estate', 'transportation', 'energy',
      'telecommunications', 'media', 'hospitality', 'agriculture', 'other'
    ]
  },
  
  size: {
    type: String,
    enum: ['startup', 'small', 'medium', 'large', 'enterprise'],
    default: 'medium'
  },
  
  // ===== ADRESSE =====
  address: {
    street: { 
      type: String, 
      required: [true, 'L\'adresse est requise'],
      trim: true 
    },
    city: { 
      type: String, 
      required: [true, 'La ville est requise'],
      trim: true 
    },
    zipCode: { 
      type: String, 
      required: [true, 'Le code postal est requis'],
      validate: {
        validator: function(v) {
          return /^\d{5}$/.test(v); // 5 chiffres pour la France
        },
        message: 'Le code postal doit contenir 5 chiffres'
      }
    },
    country: { 
      type: String, 
      default: 'France',
      enum: ['France', 'Belgium', 'Switzerland', 'Luxembourg', 'Monaco']
    },
    region: String
  },
  
  // ===== CONTACT =====
  contact: {
    email: { 
      type: String, 
      required: [true, 'L\'email de contact est requis'],
      lowercase: true,
      validate: {
        validator: function(v) {
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
        },
        message: 'Format d\'email invalide'
      }
    },
    phone: { 
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^(\+33|0)[1-9](\d{8})$/.test(v.replace(/\s/g, ''));
        },
        message: 'Format de téléphone invalide'
      }
    },
    website: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\..+/.test(v);
        },
        message: 'Format d\'URL invalide'
      }
    },
    contactPerson: {
      firstName: String,
      lastName: String,
      position: String,
      directPhone: String,
      directEmail: String
    }
  },
  
  // ===== FACTURATION =====
  billing: {
    paymentTerms: { 
      type: Number, 
      default: 30,
      min: [0, 'Les délais de paiement ne peuvent être négatifs'],
      max: [90, 'Les délais de paiement ne peuvent excéder 90 jours']
    }, // Jours
    
    creditLimit: { 
      type: Number, 
      default: 50000,
      min: [0, 'La limite de crédit ne peut être négative']
    },
    
    currentCredit: {
      type: Number,
      default: 0,
      min: [0, 'Le crédit actuel ne peut être négatif']
    },
    
    preferredPaymentMethod: { 
      type: String, 
      enum: ['bank_transfer', 'credit_card', 'check', 'direct_debit'], 
      default: 'bank_transfer' 
    },
    
    bankDetails: {
      iban: {
        type: String,
        validate: {
          validator: function(v) {
            return !v || /^FR\d{12}[A-Z0-9]{11}\d{2}$/.test(v.replace(/\s/g, ''));
          },
          message: 'Format IBAN invalide'
        }
      },
      bic: String,
      bankName: String
    },
    
    billingAddress: {
      sameAsCompany: { type: Boolean, default: true },
      street: String,
      city: String,
      zipCode: String,
      country: String
    }
  },
  
  // ===== CONTRAT =====
  contract: {
    contractNumber: {
      type: String,
      unique: true,
      sparse: true // Permet les valeurs null multiples
    },
    
    startDate: {
      type: Date,
      default: Date.now
    },
    
    endDate: Date,
    
    renewalDate: Date,
    
    autoRenewal: {
      type: Boolean,
      default: false
    },
    
    discountRate: { 
      type: Number, 
      default: 0,
      min: [0, 'Le taux de remise ne peut être négatif'],
      max: [50, 'Le taux de remise ne peut excéder 50%']
    }, // Pourcentage
    
    volumeDiscounts: [{
      threshold: Number, // Montant minimum
      discountRate: Number // Pourcentage de remise
    }],
    
    specialConditions: String,
    
    isActive: { 
      type: Boolean, 
      default: true 
    },
    
    contractType: {
      type: String,
      enum: ['standard', 'premium', 'enterprise', 'custom'],
      default: 'standard'
    },
    
    signedBy: {
      companyRepresentative: String,
      hotelChainRepresentative: String,
      signatureDate: Date
    }
  },
  
  // ===== PARAMÈTRES =====
  settings: {
    // Approbations
    requireApproval: { 
      type: Boolean, 
      default: true 
    },
    
    approvalLimit: { 
      type: Number, 
      default: 1000,
      min: [0, 'Le seuil d\'approbation ne peut être négatif']
    }, // Montant au-dessus duquel approbation requise
    
    multiLevelApproval: {
      type: Boolean,
      default: false
    },
    
    approvalLevels: [{
      level: Number,
      threshold: Number,
      requiredRole: String
    }],
    
    // Facturation
    autoInvoicing: { 
      type: Boolean, 
      default: true 
    },
    
    invoicingFrequency: { 
      type: String, 
      enum: ['weekly', 'monthly', 'quarterly', 'yearly'], 
      default: 'monthly' 
    },
    
    invoicingDay: { 
      type: Number, 
      default: 1,
      min: [1, 'Le jour de facturation doit être entre 1 et 31'],
      max: [31, 'Le jour de facturation doit être entre 1 et 31']
    },
    
    // Notifications
    notifications: {
      bookingConfirmation: { type: Boolean, default: true },
      approvalRequests: { type: Boolean, default: true },
      invoiceGeneration: { type: Boolean, default: true },
      paymentReminders: { type: Boolean, default: true },
      contractExpiry: { type: Boolean, default: true }
    },
    
    // Restrictions
    restrictions: {
      maxAdvanceBooking: { type: Number, default: 365 }, // Jours
      allowWeekendBookings: { type: Boolean, default: true },
      allowHolidayBookings: { type: Boolean, default: true },
      restrictedHotels: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' }],
      allowedRoomTypes: [String]
    },
    
    // Préférences
    preferences: {
      currency: { type: String, default: 'EUR' },
      timezone: { type: String, default: 'Europe/Paris' },
      language: { type: String, default: 'fr' },
      dateFormat: { type: String, default: 'DD/MM/YYYY' }
    }
  },
  
  // ===== STATISTIQUES =====
  statistics: {
    totalSpent: { 
      type: Number, 
      default: 0,
      min: [0, 'Le montant total ne peut être négatif']
    },
    
    totalBookings: { 
      type: Number, 
      default: 0,
      min: [0, 'Le nombre de réservations ne peut être négatif']
    },
    
    averageStayValue: { 
      type: Number, 
      default: 0,
      min: [0, 'La valeur moyenne ne peut être négative']
    },
    
    averageStayDuration: {
      type: Number,
      default: 0,
      min: [0, 'La durée moyenne ne peut être négative']
    },
    
    lastBookingDate: Date,
    
    preferredHotels: [{
      hotel: { type: mongoose.Schema.Types.ObjectId, ref: 'Hotel' },
      bookingCount: Number,
      totalSpent: Number
    }],
    
    monthlyStats: [{
      year: Number,
      month: Number,
      bookingCount: Number,
      totalAmount: Number,
      averageValue: Number
    }],
    
    departmentStats: [{
      department: String,
      bookingCount: Number,
      totalSpent: Number,
      employeeCount: Number
    }]
  },
  
  // ===== DOCUMENTS =====
  documents: [{
    type: {
      type: String,
      enum: ['contract', 'invoice', 'kbis', 'insurance', 'other']
    },
    name: String,
    url: String,
    uploadDate: { type: Date, default: Date.now },
    expiryDate: Date,
    size: Number, // en bytes
    mimeType: String
  }],
  
  // ===== NOTES ET HISTORIQUE =====
  notes: [{
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    content: String,
    category: {
      type: String,
      enum: ['general', 'commercial', 'technical', 'billing', 'support']
    },
    isPrivate: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
  }],
  
  // ===== MÉTADONNÉES =====
  status: {
    type: String,
    enum: ['active', 'suspended', 'terminated', 'pending'],
    default: 'active'
  },
  
  tags: [String], // Tags pour classification
  
  source: {
    type: String,
    enum: ['website', 'sales_team', 'referral', 'marketing', 'other'],
    default: 'website'
  },
  
  assignedSalesRep: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  lastActivity: {
    type: Date,
    default: Date.now
  }
  
}, {
  timestamps: true, // Ajoute createdAt et updatedAt automatiquement
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ===== INDEXES =====
companySchema.index({ siret: 1 }, { unique: true });
companySchema.index({ vatNumber: 1 }, { unique: true });
companySchema.index({ 'contact.email': 1 });
companySchema.index({ industry: 1 });
companySchema.index({ status: 1 });
companySchema.index({ 'contract.isActive': 1 });
companySchema.index({ createdAt: -1 });

// Index composé pour recherche
companySchema.index({ 
  name: 'text', 
  'contact.email': 'text',
  industry: 'text'
});

// ===== VIRTUELS =====
companySchema.virtual('employees', {
  ref: 'User',
  localField: '_id',
  foreignField: 'company'
});

companySchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'guestInfo.company'
});

companySchema.virtual('invoices', {
  ref: 'Invoice',
  localField: '_id',
  foreignField: 'company'
});

// Calculer le crédit disponible
companySchema.virtual('availableCredit').get(function() {
  return this.billing.creditLimit - this.billing.currentCredit;
});

// Calculer le statut du contrat
companySchema.virtual('contractStatus').get(function() {
  if (!this.contract.isActive) return 'inactive';
  if (this.contract.endDate && new Date() > this.contract.endDate) return 'expired';
  if (this.contract.endDate) {
    const daysToExpiry = Math.ceil((this.contract.endDate - new Date()) / (1000 * 60 * 60 * 24));
    if (daysToExpiry <= 30) return 'expiring_soon';
  }
  return 'active';
});

// ===== MIDDLEWARE =====

// Pre-save middleware
companySchema.pre('save', function(next) {
  // Générer numéro de contrat automatiquement
  if (this.isNew && !this.contract.contractNumber) {
    this.contract.contractNumber = `HOTEL-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`;
  }
  
  // Mettre à jour lastActivity
  this.lastActivity = new Date();
  
  // Validation des dates de contrat
  if (this.contract.endDate && this.contract.startDate && 
      this.contract.endDate <= this.contract.startDate) {
    return next(new Error('La date de fin doit être postérieure à la date de début'));
  }
  
  next();
});

// Post-save middleware
companySchema.post('save', function(doc) {
  console.log(`Entreprise ${doc.name} sauvegardée avec succès`);
});

// ===== MÉTHODES D'INSTANCE =====

// Vérifier si l'entreprise peut effectuer une réservation
companySchema.methods.canBook = function(amount = 0) {
  if (this.status !== 'active') return { allowed: false, reason: 'Compte suspendu' };
  if (!this.contract.isActive) return { allowed: false, reason: 'Contrat inactif' };
  
  if (amount > 0 && (this.billing.currentCredit + amount) > this.billing.creditLimit) {
    return { 
      allowed: false, 
      reason: 'Limite de crédit dépassée',
      availableCredit: this.availableCredit
    };
  }
  
  return { allowed: true };
};

// Calculer la remise applicable
companySchema.methods.calculateDiscount = function(amount) {
  let discount = this.contract.discountRate || 0;
  
  // Vérifier les remises par volume
  if (this.contract.volumeDiscounts && this.contract.volumeDiscounts.length > 0) {
    const applicableDiscounts = this.contract.volumeDiscounts
      .filter(vd => amount >= vd.threshold)
      .sort((a, b) => b.threshold - a.threshold);
    
    if (applicableDiscounts.length > 0) {
      discount = Math.max(discount, applicableDiscounts[0].discountRate);
    }
  }
  
  return {
    rate: discount,
    amount: (amount * discount) / 100,
    finalAmount: amount - (amount * discount) / 100
  };
};

// Ajouter une note
companySchema.methods.addNote = function(content, category = 'general', author, isPrivate = false) {
  this.notes.push({
    content,
    category,
    author,
    isPrivate,
    createdAt: new Date()
  });
  return this.save();
};

// Mettre à jour les statistiques
companySchema.methods.updateStats = function(bookingAmount, bookingDuration = 1) {
  this.statistics.totalBookings += 1;
  this.statistics.totalSpent += bookingAmount;
  this.statistics.averageStayValue = this.statistics.totalSpent / this.statistics.totalBookings;
  this.statistics.lastBookingDate = new Date();
  
  // Calculer durée moyenne (pondérée)
  const totalNights = (this.statistics.averageStayDuration * (this.statistics.totalBookings - 1)) + bookingDuration;
  this.statistics.averageStayDuration = totalNights / this.statistics.totalBookings;
  
  return this.save();
};

// ===== MÉTHODES STATIQUES =====

// Recherche d'entreprises
companySchema.statics.search = function(query, options = {}) {
  const {
    page = 1,
    limit = 20,
    sortBy = 'name',
    sortOrder = 1,
    status = 'active',
    industry
  } = options;
  
  const searchQuery = {
    $and: [
      { status },
      {
        $or: [
          { name: { $regex: query, $options: 'i' } },
          { 'contact.email': { $regex: query, $options: 'i' } },
          { siret: { $regex: query, $options: 'i' } }
        ]
      }
    ]
  };
  
  if (industry) {
    searchQuery.$and.push({ industry });
  }
  
  return this.find(searchQuery)
    .sort({ [sortBy]: sortOrder })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .populate('assignedSalesRep', 'firstName lastName email');
};

// Statistiques globales
companySchema.statics.getGlobalStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: null,
        totalCompanies: { $sum: 1 },
        activeCompanies: {
          $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
        },
        totalRevenue: { $sum: '$statistics.totalSpent' },
        totalBookings: { $sum: '$statistics.totalBookings' },
        averageCompanyValue: { $avg: '$statistics.totalSpent' }
      }
    }
  ]);
};

module.exports = mongoose.model('Company', companySchema);