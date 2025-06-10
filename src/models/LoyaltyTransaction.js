/**
 * LOYALTY TRANSACTION MODEL
 * Modèle pour tracker toutes les transactions de points du programme de fidélité
 * 
 * Fonctionnalités :
 * - Tracking gains/utilisation de points
 * - Historique complet des transactions
 * - Support différents types de transactions
 * - Gestion expiration des points
 * - Intégration avec réservations et hôtels
 * - Audit trail complet
 */

const mongoose = require('mongoose');

const loyaltyTransactionSchema = new mongoose.Schema({
  // ============================================================================
  // RELATIONS PRINCIPALES
  // ============================================================================
  
  // Utilisateur concerné (obligatoire)
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'L\'utilisateur est requis'],
    index: true
  },
  
  // Réservation liée (optionnel - pour gains via réservations)
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    index: true
  },
  
  // Hôtel concerné (optionnel - pour analytics par hôtel)
  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    index: true
  },

  // ============================================================================
  // TRANSACTION DETAILS
  // ============================================================================
  
  // Type de transaction
  type: {
    type: String,
    enum: {
      values: [
        // GAINS DE POINTS
        'EARN_BOOKING',       // Points gagnés lors d'une réservation
        'EARN_REVIEW',        // Points gagnés pour un avis client
        'EARN_REFERRAL',      // Points gagnés pour parrainage d'un ami
        'EARN_BONUS',         // Points bonus (promotions spéciales)
        'EARN_BIRTHDAY',      // Bonus anniversaire
        'EARN_ANNIVERSARY',   // Bonus anniversaire adhésion
        'EARN_SURVEY',        // Points pour sondage/questionnaire
        'EARN_SOCIAL',        // Partage réseaux sociaux
        'EARN_WELCOME',       // Points de bienvenue
        
        // UTILISATION DE POINTS
        'REDEEM_DISCOUNT',    // Utilisation pour réduction
        'REDEEM_UPGRADE',     // Utilisation pour upgrade chambre
        'REDEEM_FREE_NIGHT',  // Utilisation pour nuit gratuite
        'REDEEM_SERVICE',     // Utilisation pour service (spa, restaurant)
        'REDEEM_GIFT',        // Utilisation pour cadeau
        'REDEEM_TRANSFER',    // Transfert vers autre compte
        
        // AJUSTEMENTS SYSTÈME
        'ADJUSTMENT_ADMIN',   // Ajustement manuel admin
        'ADJUSTMENT_ERROR',   // Correction d'erreur
        'TIER_BONUS',         // Bonus promotion de niveau
        'CAMPAIGN_BONUS',     // Bonus campagne marketing
        
        // EXPIRATIONS
        'EXPIRE',             // Expiration automatique de points
        'EXPIRE_MANUAL',      // Expiration manuelle
        
        // ANNULATIONS
        'CANCEL_BOOKING',     // Annulation liée à booking
        'CANCEL_REDEMPTION'   // Annulation d'une utilisation
      ],
      message: 'Type de transaction invalide'
    },
    required: [true, 'Le type de transaction est requis'],
    index: true
  },
  
  // Montant de points (positif pour gains, négatif pour utilisations)
  pointsAmount: {
    type: Number,
    required: [true, 'Le montant de points est requis'],
    validate: {
      validator: function(value) {
        return value !== 0; // Ne peut pas être zéro
      },
      message: 'Le montant de points ne peut pas être zéro'
    }
  },
  
  // Soldes avant/après pour traçabilité complète
  previousBalance: {
    type: Number,
    required: [true, 'Le solde précédent est requis'],
    min: [0, 'Le solde précédent ne peut pas être négatif']
  },
  
  newBalance: {
    type: Number,
    required: [true, 'Le nouveau solde est requis'],
    min: [0, 'Le nouveau solde ne peut pas être négatif']
  },

  // ============================================================================
  // DESCRIPTION ET MÉTADONNÉES
  // ============================================================================
  
  // Description lisible de la transaction
  description: {
    type: String,
    required: [true, 'La description est requise'],
    maxlength: [500, 'La description ne peut pas dépasser 500 caractères'],
    trim: true
  },
  
  // Référence externe (ex: numéro de réservation, code promo)
  externalReference: {
    type: String,
    maxlength: [100, 'La référence externe ne peut pas dépasser 100 caractères'],
    trim: true,
    index: true
  },

  // ============================================================================
  // DONNÉES SPÉCIFIQUES AUX GAINS
  // ============================================================================
  
  earnedFrom: {
    // Montant de la réservation qui a généré les points
    bookingAmount: {
      type: Number,
      min: [0, 'Le montant de réservation ne peut pas être négatif']
    },
    
    // Taux de conversion (ex: 1 point par euro)
    pointsRate: {
      type: Number,
      min: [0, 'Le taux de points ne peut pas être négatif']
    },
    
    // Multiplicateur bonus (niveau fidélité, promotion, etc.)
    bonusMultiplier: {
      type: Number,
      default: 1,
      min: [0.1, 'Le multiplicateur bonus ne peut pas être inférieur à 0.1'],
      max: [10, 'Le multiplicateur bonus ne peut pas dépasser 10']
    },
    
    // Niveau de fidélité au moment du gain
    tierAtEarning: {
      type: String,
      enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']
    },
    
    // Détails du bonus
    bonusDetails: {
      type: String,
      maxlength: [200, 'Les détails bonus ne peuvent pas dépasser 200 caractères']
    }
  },

  // ============================================================================
  // DONNÉES SPÉCIFIQUES AUX UTILISATIONS
  // ============================================================================
  
  redeemedFor: {
    // Montant de la réduction obtenue
    discountAmount: {
      type: Number,
      min: [0, 'Le montant de réduction ne peut pas être négatif']
    },
    
    // Type d'upgrade obtenu
    upgradeType: {
      type: String,
      enum: ['ROOM_CATEGORY', 'FLOOR_HIGH', 'VIEW', 'SUITE', 'PRESIDENTIAL']
    },
    
    // Description du bénéfice obtenu
    benefitDescription: {
      type: String,
      maxlength: [300, 'La description du bénéfice ne peut pas dépasser 300 caractères']
    },
    
    // Valeur monétaire équivalente du bénéfice
    equivalentValue: {
      type: Number,
      min: [0, 'La valeur équivalente ne peut pas être négative']
    },
    
    // Réservation où l'utilisation a été appliquée
    appliedToBooking: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking'
    }
  },

  // ============================================================================
  // STATUT ET VALIDITÉ
  // ============================================================================
  
  // Statut de la transaction
  status: {
    type: String,
    enum: {
      values: ['PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'PROCESSING'],
      message: 'Statut de transaction invalide'
    },
    default: 'COMPLETED',
    index: true
  },
  
  // Date d'expiration des points (pour les gains)
  expiresAt: {
    type: Date,
    index: true,
    validate: {
      validator: function(value) {
        // L'expiration ne s'applique qu'aux gains de points
        if (this.pointsAmount > 0 && !value) {
          return false; // Les gains doivent avoir une date d'expiration
        }
        return true;
      },
      message: 'Les gains de points doivent avoir une date d\'expiration'
    }
  },
  
  // Date effective de traitement
  processedAt: {
    type: Date,
    default: Date.now
  },
  
  // Date d'annulation (si applicable)
  cancelledAt: {
    type: Date
  },

  // ============================================================================
  // TRACKING ET AUDIT
  // ============================================================================
  
  // Source de la transaction
  source: {
    type: String,
    enum: {
      values: ['WEB', 'MOBILE', 'RECEPTION', 'ADMIN', 'SYSTEM', 'API', 'IMPORT'],
      message: 'Source invalide'
    },
    default: 'SYSTEM',
    required: true
  },
  
  // Utilisateur qui a traité la transaction (admin, réceptionniste)
  processedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // IP d'origine de la transaction
  ipAddress: {
    type: String,
    match: [/^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-fA-F:]+$/, 'Format IP invalide']
  },
  
  // User agent (pour transactions web/mobile)
  userAgent: {
    type: String,
    maxlength: [500, 'User agent trop long']
  },

  // ============================================================================
  // CAMPAGNES ET PROMOTIONS
  // ============================================================================
  
  // Informations sur la campagne/promotion liée
  campaign: {
    // Nom de la campagne
    name: {
      type: String,
      maxlength: [100, 'Le nom de campagne ne peut pas dépasser 100 caractères']
    },
    
    // Code de la campagne
    code: {
      type: String,
      maxlength: [50, 'Le code de campagne ne peut pas dépasser 50 caractères'],
      uppercase: true
    },
    
    // Multiplicateur spécial de la campagne
    multiplier: {
      type: Number,
      default: 1,
      min: [0.1, 'Le multiplicateur de campagne ne peut pas être inférieur à 0.1'],
      max: [10, 'Le multiplicateur de campagne ne peut pas dépasser 10']
    },
    
    // Période de validité de la campagne
    validFrom: {
      type: Date
    },
    
    validUntil: {
      type: Date
    }
  },

  // ============================================================================
  // RELATIONS ET LIENS
  // ============================================================================
  
  // Transaction parent (pour annulations/corrections)
  parentTransaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoyaltyTransaction'
  },
  
  // Transactions liées (pour utilisations en lot)
  relatedTransactions: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LoyaltyTransaction'
  }],
  
  // Données de géolocalisation (pour analytics)
  location: {
    country: {
      type: String,
      maxlength: [50, 'Le pays ne peut pas dépasser 50 caractères']
    },
    city: {
      type: String,
      maxlength: [100, 'La ville ne peut pas dépasser 100 caractères']
    },
    coordinates: {
      latitude: {
        type: Number,
        min: [-90, 'Latitude invalide'],
        max: [90, 'Latitude invalide']
      },
      longitude: {
        type: Number,
        min: [-180, 'Longitude invalide'],
        max: [180, 'Longitude invalide']
      }
    }
  },

  // ============================================================================
  // NOTES ET COMMENTAIRES
  // ============================================================================
  
  // Notes internes (visibles admin uniquement)
  internalNotes: {
    type: String,
    maxlength: [1000, 'Les notes internes ne peuvent pas dépasser 1000 caractères']
  },
  
  // Commentaires client (pour feedback)
  customerNotes: {
    type: String,
    maxlength: [500, 'Les commentaires client ne peuvent pas dépasser 500 caractères']
  },
  
  // Tags pour catégorisation
  tags: [{
    type: String,
    maxlength: [50, 'Un tag ne peut pas dépasser 50 caractères']
  }]

}, {
  // Options du schema
  timestamps: true, // Ajoute createdAt et updatedAt automatiquement
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE
// ============================================================================

// Index composés pour requêtes fréquentes
loyaltyTransactionSchema.index({ user: 1, createdAt: -1 }); // Historique utilisateur
loyaltyTransactionSchema.index({ user: 1, type: 1 }); // Transactions par type
loyaltyTransactionSchema.index({ user: 1, status: 1 }); // Transactions par statut
loyaltyTransactionSchema.index({ booking: 1, type: 1 }); // Transactions par réservation
loyaltyTransactionSchema.index({ hotel: 1, createdAt: -1 }); // Analytics par hôtel
loyaltyTransactionSchema.index({ expiresAt: 1, status: 1 }); // Expiration des points
loyaltyTransactionSchema.index({ 'campaign.code': 1 }); // Recherche par campagne
loyaltyTransactionSchema.index({ processedAt: 1 }); // Tri par date de traitement

// Index pour recherche texte
loyaltyTransactionSchema.index({
  description: 'text',
  'campaign.name': 'text',
  internalNotes: 'text'
});

// ============================================================================
// VIRTUALS
// ============================================================================

// Indique si c'est un gain ou une utilisation
loyaltyTransactionSchema.virtual('isEarning').get(function() {
  return this.pointsAmount > 0;
});

// Indique si c'est une utilisation
loyaltyTransactionSchema.virtual('isRedemption').get(function() {
  return this.pointsAmount < 0;
});

// Points absolus (toujours positif)
loyaltyTransactionSchema.virtual('absolutePoints').get(function() {
  return Math.abs(this.pointsAmount);
});

// Indique si la transaction est expirée
loyaltyTransactionSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date() && this.status === 'COMPLETED';
});

// Jours avant expiration
loyaltyTransactionSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.expiresAt || this.pointsAmount <= 0) return null;
  const now = new Date();
  const diffTime = this.expiresAt.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Valeur monétaire équivalente (estimation)
loyaltyTransactionSchema.virtual('estimatedValue').get(function() {
  // 100 points = 1 euro (configurable)
  return Math.abs(this.pointsAmount) / 100;
});

// Type formaté pour affichage
loyaltyTransactionSchema.virtual('typeDisplay').get(function() {
  const typeLabels = {
    'EARN_BOOKING': 'Points de réservation',
    'EARN_REVIEW': 'Points d\'avis',
    'EARN_REFERRAL': 'Points de parrainage',
    'EARN_BONUS': 'Points bonus',
    'EARN_BIRTHDAY': 'Bonus anniversaire',
    'EARN_ANNIVERSARY': 'Bonus fidélité',
    'REDEEM_DISCOUNT': 'Réduction utilisée',
    'REDEEM_UPGRADE': 'Upgrade utilisé',
    'REDEEM_FREE_NIGHT': 'Nuit gratuite',
    'TIER_BONUS': 'Bonus de niveau',
    'EXPIRE': 'Points expirés',
    'ADJUSTMENT_ADMIN': 'Ajustement admin'
  };
  
  return typeLabels[this.type] || this.type;
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Validation avant sauvegarde
loyaltyTransactionSchema.pre('save', function(next) {
  // Vérifier cohérence des soldes
  const expectedBalance = this.previousBalance + this.pointsAmount;
  if (Math.abs(expectedBalance - this.newBalance) > 0.01) {
    return next(new Error('Incohérence dans les soldes de points'));
  }
  
  // Définir expiration pour les gains si pas définie
  if (this.pointsAmount > 0 && !this.expiresAt) {
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 24); // 24 mois par défaut
    this.expiresAt = expiryDate;
  }
  
  // Validation spécifique selon le type
  if (this.type.startsWith('EARN_') && this.pointsAmount <= 0) {
    return next(new Error('Les gains de points doivent être positifs'));
  }
  
  if (this.type.startsWith('REDEEM_') && this.pointsAmount >= 0) {
    return next(new Error('Les utilisations de points doivent être négatives'));
  }
  
  next();
});

// Nettoyage après suppression
loyaltyTransactionSchema.post('remove', async function(doc) {
  try {
    // Supprimer les références dans les transactions liées
    await this.constructor.updateMany(
      { relatedTransactions: doc._id },
      { $pull: { relatedTransactions: doc._id } }
    );
  } catch (error) {
    console.error('Erreur nettoyage transaction supprimée:', error);
  }
});

// ============================================================================
// MÉTHODES D'INSTANCE
// ============================================================================

// Annuler une transaction
loyaltyTransactionSchema.methods.cancel = async function(reason, cancelledBy) {
  if (this.status === 'CANCELLED') {
    throw new Error('Transaction déjà annulée');
  }
  
  this.status = 'CANCELLED';
  this.cancelledAt = new Date();
  this.internalNotes = `${this.internalNotes || ''}\nAnnulée: ${reason}`.trim();
  
  if (cancelledBy) {
    this.processedBy = cancelledBy;
  }
  
  return await this.save();
};

// Marquer comme expirée
loyaltyTransactionSchema.methods.expire = async function() {
  if (this.pointsAmount <= 0) {
    throw new Error('Seuls les gains peuvent expirer');
  }
  
  this.status = 'EXPIRED';
  return await this.save();
};

// Obtenir le résumé de la transaction
loyaltyTransactionSchema.methods.getSummary = function() {
  return {
    id: this._id,
    type: this.typeDisplay,
    points: this.pointsAmount,
    description: this.description,
    date: this.createdAt,
    status: this.status,
    isEarning: this.isEarning,
    estimatedValue: this.estimatedValue,
    expiresAt: this.expiresAt,
    daysUntilExpiry: this.daysUntilExpiry
  };
};

// ============================================================================
// MÉTHODES STATIQUES
// ============================================================================

// Obtenir historique utilisateur avec pagination
loyaltyTransactionSchema.statics.getUserHistory = function(userId, options = {}) {
  const {
    page = 1,
    limit = 20,
    type = null,
    status = null,
    startDate = null,
    endDate = null
  } = options;
  
  const query = { user: userId };
  
  if (type) query.type = type;
  if (status) query.status = status;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit)
    .populate('booking', 'bookingNumber totalPrice checkInDate')
    .populate('hotel', 'name code')
    .populate('processedBy', 'firstName lastName role');
};

// Calculer statistiques utilisateur
loyaltyTransactionSchema.statics.getUserStats = async function(userId) {
  const pipeline = [
    { $match: { user: mongoose.Types.ObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalEarned: {
          $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] }
        },
        totalRedeemed: {
          $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] }
        },
        totalTransactions: { $sum: 1 },
        lastTransaction: { $max: '$createdAt' },
        averageEarning: { $avg: '$pointsAmount' }
      }
    }
  ];
  
  const stats = await this.aggregate(pipeline);
  return stats[0] || {
    totalEarned: 0,
    totalRedeemed: 0,
    totalTransactions: 0,
    lastTransaction: null,
    averageEarning: 0
  };
};

// Trouver points qui expirent bientôt
loyaltyTransactionSchema.statics.findExpiringPoints = function(daysUntilExpiry = 30) {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);
  
  return this.find({
    pointsAmount: { $gt: 0 },
    status: 'COMPLETED',
    expiresAt: { $lte: expiryDate, $gt: new Date() }
  })
  .populate('user', 'firstName lastName email loyalty.currentPoints')
  .sort({ expiresAt: 1 });
};

// Obtenir analytics par période
loyaltyTransactionSchema.statics.getAnalytics = function(startDate, endDate, filters = {}) {
  const matchStage = {
    createdAt: { $gte: startDate, $lte: endDate }
  };
  
  if (filters.hotel) matchStage.hotel = mongoose.Types.ObjectId(filters.hotel);
  if (filters.type) matchStage.type = filters.type;
  if (filters.status) matchStage.status = filters.status;
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          type: '$type'
        },
        count: { $sum: 1 },
        totalPoints: { $sum: '$pointsAmount' },
        uniqueUsers: { $addToSet: '$user' }
      }
    },
    {
      $group: {
        _id: '$_id.date',
        transactions: {
          $push: {
            type: '$_id.type',
            count: '$count',
            totalPoints: '$totalPoints',
            uniqueUsers: { $size: '$uniqueUsers' }
          }
        },
        dailyTotal: { $sum: '$totalPoints' }
      }
    },
    { $sort: { _id: 1 } }
  ]);
};

// ============================================================================
// EXPORT
// ============================================================================

const LoyaltyTransaction = mongoose.model('LoyaltyTransaction', loyaltyTransactionSchema);

module.exports = LoyaltyTransaction;