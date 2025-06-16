const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  // Numéro de référence unique de la réservation
  bookingNumber: {
    type: String,
    unique: true,
    uppercase: true,
    match: [/^BK[0-9]{8}$/, 'Le numéro de réservation doit suivre le format BK12345678']
  },

  // Relations principales
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'L\'utilisateur est requis']
  },

  hotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: [true, 'L\'hôtel est requis']
  },

  // Réservations multiples selon cahier des charges
  rooms: [{
    room: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true
    },
    // Prix de la chambre au moment de la réservation
    pricePerNight: {
      type: Number,
      required: true,
      min: [0, 'Le prix ne peut pas être négatif']
    },
    // Invités assignés à cette chambre
    guests: [{
      firstName: {
        type: String,
        required: true,
        trim: true,
        maxlength: [50, 'Le prénom ne peut pas dépasser 50 caractères']
      },
      lastName: {
        type: String,
        required: true,
        trim: true,
        maxlength: [50, 'Le nom ne peut pas dépasser 50 caractères']
      },
      age: {
        type: Number,
        min: [0, 'L\'âge ne peut pas être négatif'],
        max: [120, 'L\'âge ne peut pas dépasser 120 ans']
      },
      isMainGuest: {
        type: Boolean,
        default: false
      }
    }]
  }],

  // Dates de séjour - gestion par nuitée selon cahier des charges
  checkIn: {
    type: Date,
    required: [true, 'La date d\'arrivée est requise'],
    validate: {
      validator: function(value) {
        return value >= new Date(new Date().setHours(0, 0, 0, 0));
      },
      message: 'La date d\'arrivée ne peut pas être dans le passé'
    }
  },

  checkOut: {
    type: Date,
    required: [true, 'La date de départ est requise'],
    validate: {
      validator: function(value) {
        return value > this.checkIn;
      },
      message: 'La date de départ doit être postérieure à la date d\'arrivée'
    }
  },

  // Informations de séjour
  numberOfNights: {
    type: Number,
    min: [1, 'Le séjour doit être d\'au moins 1 nuit']
  },

  totalGuests: {
    adults: {
      type: Number,
      required: true,
      min: [1, 'Au moins 1 adulte requis'],
      max: [20, 'Maximum 20 adultes']
    },
    children: {
      type: Number,
      default: 0,
      min: [0, 'Le nombre d\'enfants ne peut pas être négatif'],
      max: [10, 'Maximum 10 enfants']
    }
  },

  // Statuts selon le workflow du cahier des charges
  status: {
    type: String,
    enum: {
      values: ['PENDING', 'CONFIRMED', 'CANCELLED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED', 'NO_SHOW'],
      message: 'Statut de réservation invalide'
    },
    default: 'PENDING'
  },

  // Source de réservation selon cahier des charges (statistiques)
  source: {
    type: String,
    enum: ['WEB', 'MOBILE', 'RECEPTION', 'PHONE', 'EMAIL'],
    required: [true, 'La source de réservation est requise']
  },

  // Informations de prix
  pricing: {
    subtotal: {
      type: Number,
      required: true,
      min: [0, 'Le sous-total ne peut pas être négatif']
    },
    taxes: {
      type: Number,
      default: 0,
      min: [0, 'Les taxes ne peuvent pas être négatives']
    },
    fees: {
      type: Number,
      default: 0,
      min: [0, 'Les frais ne peuvent pas être négatifs']
    },
    discount: {
      type: Number,
      default: 0,
      min: [0, 'La réduction ne peut pas être négative']
    },
    totalPrice: {
      type: Number,
      required: true,
      min: [0, 'Le prix total ne peut pas être négatif']
    }
  },

  // Consommations supplémentaires (mini-bar, services additionnels)
  extras: [{
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères']
    },
    description: {
      type: String,
      maxlength: [200, 'La description ne peut pas dépasser 200 caractères']
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'La quantité doit être au moins 1']
    },
    unitPrice: {
      type: Number,
      required: true,
      min: [0, 'Le prix unitaire ne peut pas être négatif']
    },
    totalPrice: {
      type: Number,
      required: true,
      min: [0, 'Le prix total ne peut pas être négatif']
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    addedAt: {
      type: Date,
      default: Date.now
    },
    category: {
      type: String,
      enum: ['MINIBAR', 'RESTAURANT', 'SPA', 'LAUNDRY', 'TRANSPORT', 'OTHER'],
      default: 'OTHER'
    }
  }],

  // Informations de paiement
  payment: {
    method: {
      type: String,
      enum: ['CARD', 'CASH', 'TRANSFER', 'CHECK', 'PENDING'],
      default: 'PENDING'
    },
    status: {
      type: String,
      enum: ['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED'],
      default: 'PENDING'
    },
    amountPaid: {
      type: Number,
      default: 0,
      min: [0, 'Le montant payé ne peut pas être négatif']
    },
    transactionId: {
      type: String,
      trim: true
    },
    paidAt: {
      type: Date
    },
    refundAmount: {
      type: Number,
      default: 0,
      min: [0, 'Le montant du remboursement ne peut pas être négatif']
    },
    refundedAt: {
      type: Date
    }
  },

  // Demandes spéciales
  specialRequests: [{
    type: {
      type: String,
      enum: ['LATE_CHECKIN', 'EARLY_CHECKOUT', 'HIGH_FLOOR', 'QUIET_ROOM', 'ADJOINING_ROOMS', 'ACCESSIBILITY', 'DIETARY', 'OTHER'],
      required: true
    },
    description: {
      type: String,
      required: true,
      maxlength: [300, 'La description ne peut pas dépasser 300 caractères']
    },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'],
      default: 'PENDING'
    },
    handledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    handledAt: {
      type: Date
    },
    notes: {
      type: String,
      maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères']
    }
  }],

  // Historique des changements de statut
  statusHistory: [{
    status: {
      type: String,
      required: true
    },
    changedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    changedAt: {
      type: Date,
      default: Date.now
    },
    reason: {
      type: String,
      maxlength: [200, 'La raison ne peut pas dépasser 200 caractères']
    },
    notes: {
      type: String,
      maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères']
    }
  }],

  // Informations de contact pour cette réservation
  contactInfo: {
    phone: {
      type: String,
      match: [/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide']
    },
    email: {
      type: String,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email invalide']
    },
    emergencyContact: {
      name: {
        type: String,
        trim: true,
        maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères']
      },
      phone: {
        type: String,
        match: [/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide']
      },
      relationship: {
        type: String,
        maxlength: [50, 'La relation ne peut pas dépasser 50 caractères']
      }
    }
  },

  // Dates importantes du workflow
  dates: {
    bookedAt: {
      type: Date,
      default: Date.now
    },
    confirmedAt: {
      type: Date
    },
    checkedInAt: {
      type: Date
    },
    checkedOutAt: {
      type: Date
    },
    cancelledAt: {
      type: Date
    },
    cancellationDeadline: {
      type: Date
    }
  },

  // Informations d'annulation
  cancellation: {
    reason: {
      type: String,
      enum: ['CLIENT_REQUEST', 'NO_SHOW', 'OVERBOOKING', 'FORCE_MAJEURE', 'TECHNICAL_ISSUE'],
    },
    cancelledBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    refundPolicy: {
      type: String,
      enum: ['FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND'],
    },
    refundAmount: {
      type: Number,
      min: [0, 'Le montant du remboursement ne peut pas être négatif']
    },
    notes: {
      type: String,
      maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères']
    }
  },

  // Métadonnées
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Validation par l'administrateur selon cahier des charges
  validation: {
    isValidated: {
      type: Boolean,
      default: false
    },
    validatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    validatedAt: {
      type: Date
    },
    validationNotes: {
      type: String,
      maxlength: [300, 'Les notes ne peuvent pas dépasser 300 caractères']
    }
  },

  // ============================================================================
  // NOUVEAUX CHAMPS POUR REAL-TIME (WEEK 3)
  // ============================================================================
  
  // Real-time session tracking
  realtimeTracking: {
    // Active WebSocket sessions viewing this booking
    activeSessions: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      socketId: {
        type: String
      },
      connectedAt: {
        type: Date,
        default: Date.now
      },
      userRole: {
        type: String,
        enum: ['CLIENT', 'RECEPTIONIST', 'ADMIN']
      }
    }],
    
    // Real-time status updates
    lastBroadcast: {
      eventType: {
        type: String
      },
      broadcastAt: {
        type: Date
      },
      broadcastTo: [{
        type: String // Socket room names
      }]
    },
    
    // Live availability impact tracking
    availabilityImpact: {
      lastCalculated: {
        type: Date
      },
      affectedDates: [{
        type: Date
      }],
      roomsImpacted: [{
        roomId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Room'
        },
        previousAvailability: {
          type: Number
        },
        newAvailability: {
          type: Number
        }
      }]
    },
    
    // Real-time validation tracking
    validationQueue: {
      enteredQueueAt: {
        type: Date
      },
      queuePosition: {
        type: Number
      },
      urgencyScore: {
        type: Number,
        min: [0, 'Score d\'urgence minimum 0'],
        max: [10, 'Score d\'urgence maximum 10']
      },
      assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    }
  },

  // Live update timestamps
  liveUpdates: {
    // Track when booking data changes for real-time sync
    lastModificationBroadcast: {
      type: Date
    },
    // Track price changes for dynamic pricing broadcasts
    lastPriceUpdate: {
      previousPrice: {
        type: Number
      },
      newPrice: {
        type: Number
      },
      updatedAt: {
        type: Date
      },
      broadcastSent: {
        type: Boolean,
        default: false
      }
    },
    // Track status changes for instant notifications
    lastStatusBroadcast: {
      previousStatus: {
        type: String
      },
      newStatus: {
        type: String
      },
      broadcastAt: {
        type: Date
      },
      receivedBy: [{
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        receivedAt: {
          type: Date
        }
      }]
    }
  },

  // Real-time notifications tracking
  realtimeNotifications: {
    // Pending notifications to be sent
    pending: [{
      type: {
        type: String,
        enum: ['STATUS_CHANGE', 'PRICE_UPDATE', 'AVAILABILITY_CHANGE', 'ADMIN_ACTION', 'PAYMENT_UPDATE']
      },
      scheduledFor: {
        type: Date
      },
      retryCount: {
        type: Number,
        default: 0
      },
      lastAttempt: {
        type: Date
      }
    }],
    // Sent notifications log
    sent: [{
      type: {
        type: String
      },
      sentAt: {
        type: Date
      },
      sentTo: [{
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User'
        },
        channel: {
          type: String,
          enum: ['SOCKET', 'EMAIL', 'SMS', 'PUSH']
        },
        delivered: {
          type: Boolean,
          default: false
        }
      }]
    }]
  },

  // Socket room assignments for this booking
  socketRooms: {
    // Booking-specific room
    bookingRoom: {
      type: String // Format: 'booking-{bookingId}'
    },
    // Hotel-specific room
    hotelRoom: {
      type: String // Format: 'hotel-{hotelId}'
    },
    // User-specific rooms
    userRooms: [{
      type: String // Format: 'user-{userId}'
    }],
    // Admin broadcast room
    adminRoom: {
      type: String,
      default: 'admin-notifications'
    }
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE (incluant real-time)
// ============================================================================

bookingSchema.index({ bookingNumber: 1 }, { unique: true });
bookingSchema.index({ user: 1, createdAt: -1 });
bookingSchema.index({ hotel: 1, checkIn: 1 });
bookingSchema.index({ hotel: 1, status: 1 });
bookingSchema.index({ status: 1, checkIn: 1 });
bookingSchema.index({ source: 1 });
bookingSchema.index({ 'rooms.room': 1 });

// Index composé pour recherches complexes
bookingSchema.index({ hotel: 1, checkIn: 1, checkOut: 1 });
bookingSchema.index({ hotel: 1, status: 1, checkIn: 1 });

// Nouveaux indexes pour real-time
bookingSchema.index({ 'realtimeTracking.activeSessions.socketId': 1 });
bookingSchema.index({ 'realtimeTracking.validationQueue.urgencyScore': -1 });
bookingSchema.index({ 'liveUpdates.lastModificationBroadcast': 1 });
bookingSchema.index({ 'socketRooms.bookingRoom': 1 });
bookingSchema.index({ 'socketRooms.hotelRoom': 1 });

// ============================================================================
// VIRTUALS
// ============================================================================

// Nombre total d'invités
bookingSchema.virtual('totalGuestsCount').get(function() {
  return this.totalGuests.adults + this.totalGuests.children;
});

// Nombre total de chambres
bookingSchema.virtual('totalRooms').get(function() {
  return this.rooms.length;
});

// Durée du séjour en nuits
bookingSchema.virtual('stayDuration').get(function() {
  if (!this.checkIn || !this.checkOut) return 0;
  const timeDiff = this.checkOut.getTime() - this.checkIn.getTime();
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
});

// Prix total avec extras
bookingSchema.virtual('finalTotalPrice').get(function() {
  const extrasTotal = this.extras.reduce((sum, extra) => sum + extra.totalPrice, 0);
  return this.pricing.totalPrice + extrasTotal;
});

// Montant restant à payer
bookingSchema.virtual('remainingAmount').get(function() {
  return Math.max(0, this.finalTotalPrice - this.payment.amountPaid);
});

// Vérifier si la réservation est modifiable
bookingSchema.virtual('isModifiable').get(function() {
  const modifiableStatuses = ['PENDING', 'CONFIRMED'];
  const now = new Date();
  const checkInDate = new Date(this.checkIn);
  const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);
  
  return modifiableStatuses.includes(this.status) && hoursUntilCheckIn > 24;
});

// Vérifier si annulation possible
bookingSchema.virtual('isCancellable').get(function() {
  const cancellableStatuses = ['PENDING', 'CONFIRMED'];
  const now = new Date();
  
  return cancellableStatuses.includes(this.status) && 
         (!this.dates.cancellationDeadline || now <= this.dates.cancellationDeadline);
});

// NOUVEAUX VIRTUALS POUR REAL-TIME
bookingSchema.virtual('hasActiveViewers').get(function() {
  return this.realtimeTracking?.activeSessions?.length > 0;
});

bookingSchema.virtual('isInValidationQueue').get(function() {
  return this.status === 'PENDING' && 
         this.realtimeTracking?.validationQueue?.enteredQueueAt != null;
});

bookingSchema.virtual('requiresBroadcast').get(function() {
  const lastBroadcast = this.liveUpdates?.lastModificationBroadcast;
  const lastUpdate = this.updatedAt;
  
  if (!lastBroadcast) return true;
  return lastUpdate > lastBroadcast;
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Générer le numéro de réservation avant sauvegarde
bookingSchema.pre('save', async function(next) {
  if (this.isNew) {
    if (!this.bookingNumber) {
      const count = await this.constructor.countDocuments();
      this.bookingNumber = `BK${String(count + 1).padStart(8, '0')}`;
    }
    
    // Calculer le nombre de nuits
    this.numberOfNights = this.stayDuration;
    
    // Définir la date limite d'annulation (24h avant check-in)
    if (!this.dates.cancellationDeadline) {
      const deadline = new Date(this.checkIn);
      deadline.setHours(deadline.getHours() - 24);
      this.dates.cancellationDeadline = deadline;
    }
    
    // Initialiser les socket rooms
    this.socketRooms = {
      bookingRoom: `booking-${this._id}`,
      hotelRoom: `hotel-${this.hotel}`,
      userRooms: [`user-${this.user}`],
      adminRoom: 'admin-notifications'
    };
  }
  
  // Marquer pour broadcast si modifié
  if (!this.isNew && this.isModified()) {
    this.liveUpdates.lastModificationBroadcast = null; // Force broadcast
  }
  
  next();
});

// Validation cohérence des invités et capacité
bookingSchema.pre('save', function(next) {
  const totalGuestsInRooms = this.rooms.reduce((sum, room) => sum + room.guests.length, 0);
  const totalGuestsCount = this.totalGuests.adults + this.totalGuests.children;
  
  if (totalGuestsInRooms !== totalGuestsCount) {
    return next(new Error('Le nombre d\'invités assignés aux chambres ne correspond pas au total'));
  }
  
  // Vérifier qu'il y a un invité principal par réservation
  const mainGuests = this.rooms.reduce((count, room) => {
    return count + room.guests.filter(guest => guest.isMainGuest).length;
  }, 0);
  
  if (mainGuests !== 1) {
    return next(new Error('Il doit y avoir exactement un invité principal par réservation'));
  }
  
  next();
});

// Validation des extras
bookingSchema.pre('save', function(next) {
  this.extras.forEach(extra => {
    extra.totalPrice = extra.quantity * extra.unitPrice;
  });
  next();
});

// ============================================================================
// MÉTHODES D'INSTANCE (incluant real-time)
// ============================================================================

// Changer le statut avec historique
bookingSchema.methods.changeStatus = function(newStatus, changedBy, reason = '', notes = '') {
  const validTransitions = {
    'PENDING': ['CONFIRMED', 'CANCELLED'],
    'CONFIRMED': ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
    'CHECKED_IN': ['CHECKED_OUT'],
    'CHECKED_OUT': ['COMPLETED'],
    'CANCELLED': [], // Terminal
    'COMPLETED': [], // Terminal
    'NO_SHOW': ['CANCELLED'] // Peut être annulé après no-show
  };
  
  if (!validTransitions[this.status].includes(newStatus)) {
    throw new Error(`Transition de ${this.status} vers ${newStatus} non autorisée`);
  }
  
  // Sauvegarder l'ancien statut pour le broadcast
  const oldStatus = this.status;
  
  // Mettre à jour le statut
  this.status = newStatus;
  
  // Ajouter à l'historique
  this.statusHistory.push({
    status: newStatus,
    changedBy,
    reason,
    notes
  });
  
  // Mettre à jour les dates importantes
  switch (newStatus) {
    case 'CONFIRMED':
      this.dates.confirmedAt = new Date();
      break;
    case 'CHECKED_IN':
      this.dates.checkedInAt = new Date();
      break;
    case 'CHECKED_OUT':
      this.dates.checkedOutAt = new Date();
      break;
    case 'CANCELLED':
      this.dates.cancelledAt = new Date();
      break;
  }
  
  // Préparer pour broadcast real-time
  this.liveUpdates.lastStatusBroadcast = {
    previousStatus: oldStatus,
    newStatus: newStatus,
    broadcastAt: null, // Sera mis à jour lors du broadcast
    receivedBy: []
  };
  
  return this.save();
};

// Ajouter une consommation supplémentaire
bookingSchema.methods.addExtra = function(extraData, addedBy) {
  const extra = {
    ...extraData,
    totalPrice: extraData.quantity * extraData.unitPrice,
    addedBy,
    addedAt: new Date()
  };
  
  this.extras.push(extra);
  return this.save();
};

// Calculer le prix total de la réservation
bookingSchema.methods.calculateTotalPrice = async function() {
  let subtotal = 0;
  
  // Calculer le prix pour chaque chambre
  for (const roomBooking of this.rooms) {
    await roomBooking.room.populate('room');
    const roomPrice = await roomBooking.room.getPriceForDate(this.checkIn);
    roomBooking.pricePerNight = roomPrice;
    subtotal += roomPrice * this.numberOfNights;
  }
  
  // Calculer taxes (10% par exemple)
  const taxes = subtotal * 0.10;
  
  // Prix total
  const totalPrice = subtotal + taxes - this.pricing.discount + this.pricing.fees;
  
  this.pricing.subtotal = subtotal;
  this.pricing.taxes = taxes;
  this.pricing.totalPrice = totalPrice;
  
  // Marquer pour broadcast de changement de prix
  if (this.pricing.totalPrice !== totalPrice) {
    this.liveUpdates.lastPriceUpdate = {
      previousPrice: this.pricing.totalPrice,
      newPrice: totalPrice,
      updatedAt: new Date(),
      broadcastSent: false
    };
  }
  
  return this.save();
};

// Annuler la réservation
bookingSchema.methods.cancel = function(reason, cancelledBy, notes = '') {
  if (!this.isCancellable) {
    throw new Error('Cette réservation ne peut plus être annulée');
  }
  
  // Calculer le remboursement selon la politique
  let refundAmount = 0;
  const now = new Date();
  const hoursUntilCheckIn = (this.checkIn - now) / (1000 * 60 * 60);
  
  if (hoursUntilCheckIn > 48) {
    refundAmount = this.pricing.totalPrice; // Remboursement complet
    this.cancellation.refundPolicy = 'FULL_REFUND';
  } else if (hoursUntilCheckIn > 24) {
    refundAmount = this.pricing.totalPrice * 0.5; // 50% de remboursement
    this.cancellation.refundPolicy = 'PARTIAL_REFUND';
  } else {
    refundAmount = 0; // Pas de remboursement
    this.cancellation.refundPolicy = 'NO_REFUND';
  }
  
  this.cancellation.reason = reason;
  this.cancellation.cancelledBy = cancelledBy;
  this.cancellation.refundAmount = refundAmount;
  this.cancellation.notes = notes;
  
  return this.changeStatus('CANCELLED', cancelledBy, reason, notes);
};

// Valider la réservation (pour l'administrateur)
bookingSchema.methods.validate = function(validatedBy, notes = '') {
  this.validation.isValidated = true;
  this.validation.validatedBy = validatedBy;
  this.validation.validatedAt = new Date();
  this.validation.validationNotes = notes;
  
  // Retirer de la queue de validation
  if (this.realtimeTracking.validationQueue.enteredQueueAt) {
    this.realtimeTracking.validationQueue = {};
  }
  
  return this.changeStatus('CONFIRMED', validatedBy, 'Réservation validée par l\'administrateur', notes);
};

// Générer une facture
bookingSchema.methods.generateInvoice = function() {
  const invoice = {
    bookingNumber: this.bookingNumber,
    guestName: this.rooms[0].guests.find(g => g.isMainGuest)?.firstName + ' ' + 
               this.rooms[0].guests.find(g => g.isMainGuest)?.lastName,
    hotelName: this.hotel.name,
    checkIn: this.checkIn,
    checkOut: this.checkOut,
    numberOfNights: this.numberOfNights,
    rooms: this.rooms.map(r => ({
      roomNumber: r.room.number,
      roomType: r.room.type,
      pricePerNight: r.pricePerNight,
      totalPrice: r.pricePerNight * this.numberOfNights
    })),
    pricing: this.pricing,
    extras: this.extras,
    finalTotal: this.finalTotalPrice,
    generatedAt: new Date()
  };
  
  return invoice;
};

// NOUVELLES MÉTHODES POUR REAL-TIME

// Ajouter une session active
bookingSchema.methods.addActiveSession = function(userId, socketId, userRole) {
  const existingSession = this.realtimeTracking.activeSessions.find(
    session => session.userId.toString() === userId.toString()
  );
  
  if (existingSession) {
    existingSession.socketId = socketId;
    existingSession.connectedAt = new Date();
  } else {
    this.realtimeTracking.activeSessions.push({
      userId,
      socketId,
      connectedAt: new Date(),
      userRole
    });
  }
  
  return this.save();
};

// Retirer une session active
bookingSchema.methods.removeActiveSession = function(socketId) {
  this.realtimeTracking.activeSessions = this.realtimeTracking.activeSessions.filter(
    session => session.socketId !== socketId
  );
  
  return this.save();
};

// Marquer un broadcast comme envoyé
bookingSchema.methods.markBroadcastSent = function(eventType, broadcastTo) {
  this.realtimeTracking.lastBroadcast = {
    eventType,
    broadcastAt: new Date(),
    broadcastTo
  };
  
  this.liveUpdates.lastModificationBroadcast = new Date();
  
  return this.save();
};

// Calculer le score d'urgence pour la validation
bookingSchema.methods.calculateUrgencyScore = function() {
  let score = 5; // Score de base
  
  // Proximité du check-in
  const daysUntilCheckIn = Math.ceil((this.checkIn - new Date()) / (1000 * 60 * 60 * 24));
  if (daysUntilCheckIn <= 1) score += 3;
  else if (daysUntilCheckIn <= 3) score += 2;
  else if (daysUntilCheckIn <= 7) score += 1;
  
  // Montant de la réservation
  if (this.pricing.totalPrice > 1000) score += 2;
  else if (this.pricing.totalPrice > 500) score += 1;
  
  // Nombre de chambres
  if (this.rooms.length > 3) score += 1;
  
  // Client entreprise
  if (this.user.role === 'ENTERPRISE') score += 1;
  
  return Math.min(score, 10);
};

// Entrer dans la queue de validation
bookingSchema.methods.enterValidationQueue = function(position = null) {
  this.realtimeTracking.validationQueue = {
    enteredQueueAt: new Date(),
    queuePosition: position,
    urgencyScore: this.calculateUrgencyScore(),
    assignedTo: null
  };
  
  return this.save();
};

// Assigner à un admin pour validation
bookingSchema.methods.assignToAdmin = function(adminId) {
  if (this.realtimeTracking.validationQueue) {
    this.realtimeTracking.validationQueue.assignedTo = adminId;
  }
  
  return this.save();
};

// Mettre à jour l'impact sur la disponibilité
bookingSchema.methods.updateAvailabilityImpact = function(roomsImpacted) {
  const affectedDates = [];
  const currentDate = new Date(this.checkIn);
  
  while (currentDate < this.checkOut) {
    affectedDates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  this.realtimeTracking.availabilityImpact = {
    lastCalculated: new Date(),
    affectedDates,
    roomsImpacted
  };
  
  return this.save();
};

// Ajouter une notification en attente
bookingSchema.methods.addPendingNotification = function(type, scheduledFor = null) {
  this.realtimeNotifications.pending.push({
    type,
    scheduledFor: scheduledFor || new Date(),
    retryCount: 0,
    lastAttempt: null
  });
  
  return this.save();
};

// Marquer une notification comme envoyée
bookingSchema.methods.markNotificationSent = function(type, sentTo) {
  // Retirer de pending
  this.realtimeNotifications.pending = this.realtimeNotifications.pending.filter(
    n => n.type !== type
  );
  
  // Ajouter à sent
  this.realtimeNotifications.sent.push({
    type,
    sentAt: new Date(),
    sentTo
  });
  
  return this.save();
};

// Obtenir les rooms Socket.io pour broadcast
bookingSchema.methods.getSocketRooms = function() {
  const rooms = [
    this.socketRooms.bookingRoom,
    this.socketRooms.hotelRoom,
    ...this.socketRooms.userRooms
  ];
  
  if (this.status === 'PENDING' && !this.validation.isValidated) {
    rooms.push(this.socketRooms.adminRoom);
  }
  
  return rooms.filter(room => room != null);
};

// ============================================================================
// MÉTHODES STATIQUES (incluant real-time)
// ============================================================================

// Rechercher des réservations avec filtres
bookingSchema.statics.searchBookings = function(filters = {}) {
  const query = {};
  
  if (filters.hotel) query.hotel = filters.hotel;
  if (filters.user) query.user = filters.user;
  if (filters.status) query.status = filters.status;
  if (filters.source) query.source = filters.source;
  
  if (filters.dateFrom && filters.dateTo) {
    query.checkIn = {
      $gte: new Date(filters.dateFrom),
      $lte: new Date(filters.dateTo)
    };
  }
  
  if (filters.bookingNumber) {
    query.bookingNumber = new RegExp(filters.bookingNumber, 'i');
  }
  
  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .populate('rooms.room', 'number type')
    .sort({ createdAt: -1 });
};

// Statistiques des réservations
bookingSchema.statics.getBookingStats = function(hotelId = null, dateFrom, dateTo) {
  const matchStage = {};
  
  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  if (dateFrom && dateTo) {
    matchStage.checkIn = {
      $gte: new Date(dateFrom),
      $lte: new Date(dateTo)
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        totalRevenue: { $sum: '$pricing.totalPrice' },
        avgBookingValue: { $avg: '$pricing.totalPrice' },
        totalNights: { $sum: '$numberOfNights' },
        totalGuests: { $sum: { $add: ['$totalGuests.adults', '$totalGuests.children'] } },
        bookingsByStatus: {
          $push: '$status'
        },
        bookingsBySource: {
          $push: '$source'
        }
      }
    }
  ]);
};

// Réservations en attente de validation
bookingSchema.statics.getPendingValidation = function(hotelId = null) {
  const query = {
    status: 'PENDING',
    'validation.isValidated': false
  };
  
  if (hotelId) query.hotel = hotelId;
  
  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .sort({ createdAt: 1 });
};

// Taux d'occupation pour une période
bookingSchema.statics.getOccupancyRate = async function(hotelId, dateFrom, dateTo) {
  const Room = mongoose.model('Room');
  
  const totalRooms = await Room.countDocuments({ hotel: hotelId, isActive: true });
  
  const bookings = await this.find({
    hotel: hotelId,
    status: { $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'] },
    checkIn: { $lt: new Date(dateTo) },
    checkOut: { $gt: new Date(dateFrom) }
  });
  
  const totalRoomNights = bookings.reduce((sum, booking) => {
    return sum + (booking.rooms.length * booking.numberOfNights);
  }, 0);
  
  const periodDays = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24));
  const maxPossibleRoomNights = totalRooms * periodDays;
  
  return {
    occupancyRate: (totalRoomNights / maxPossibleRoomNights) * 100,
    totalRoomNights,
    maxPossibleRoomNights,
    totalRooms,
    periodDays
  };
};

// NOUVELLES MÉTHODES STATIQUES POUR REAL-TIME

// Obtenir les réservations avec sessions actives
bookingSchema.statics.getBookingsWithActiveViewers = function(hotelId = null) {
  const query = {
    'realtimeTracking.activeSessions.0': { $exists: true }
  };
  
  if (hotelId) query.hotel = hotelId;
  
  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .populate('realtimeTracking.activeSessions.userId', 'firstName lastName role');
};

// Obtenir la queue de validation triée par urgence
bookingSchema.statics.getValidationQueue = function(hotelId = null) {
  const query = {
    status: 'PENDING',
    'validation.isValidated': false,
    'realtimeTracking.validationQueue.enteredQueueAt': { $exists: true }
  };
  
  if (hotelId) query.hotel = hotelId;
  
  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .sort({ 'realtimeTracking.validationQueue.urgencyScore': -1, 'realtimeTracking.validationQueue.enteredQueueAt': 1 });
};

// Obtenir les réservations nécessitant un broadcast
bookingSchema.statics.getBookingsRequiringBroadcast = function(limit = 100) {
  return this.find({
    $or: [
      { 'liveUpdates.lastModificationBroadcast': null },
      { 
        $expr: { 
          $gt: ['$updatedAt', '$liveUpdates.lastModificationBroadcast'] 
        } 
      }
    ]
  })
  .limit(limit)
  .populate('user', 'firstName lastName email')
  .populate('hotel', 'name code');
};

// Obtenir les notifications en attente
bookingSchema.statics.getPendingNotifications = function(type = null) {
  const query = {
    'realtimeNotifications.pending.0': { $exists: true }
  };
  
  if (type) {
    query['realtimeNotifications.pending.type'] = type;
  }
  
  return this.find(query)
    .populate('user', 'firstName lastName email phone')
    .populate('hotel', 'name code');
};

// Nettoyer les sessions expirées
bookingSchema.statics.cleanupExpiredSessions = async function(maxAge = 3600000) { // 1 heure par défaut
  const cutoffTime = new Date(Date.now() - maxAge);
  
  const result = await this.updateMany(
    {
      'realtimeTracking.activeSessions.connectedAt': { $lt: cutoffTime }
    },
    {
      $pull: {
        'realtimeTracking.activeSessions': {
          connectedAt: { $lt: cutoffTime }
        }
      }
    }
  );
  
  return result;
};

// Obtenir les statistiques real-time
bookingSchema.statics.getRealtimeStats = async function(hotelId = null) {
  const matchStage = hotelId ? { hotel: mongoose.Types.ObjectId(hotelId) } : {};
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        activeViewers: {
          $sum: { $size: '$realtimeTracking.activeSessions' }
        },
        pendingValidations: {
          $sum: {
            $cond: [
              { $and: [
                { $eq: ['$status', 'PENDING'] },
                { $eq: ['$validation.isValidated', false] }
              ]},
              1,
              0
            ]
          }
        },
        inValidationQueue: {
          $sum: {
            $cond: [
              { $ne: ['$realtimeTracking.validationQueue.enteredQueueAt', null] },
              1,
              0
            ]
          }
        },
        pendingNotifications: {
          $sum: { $size: '$realtimeNotifications.pending' }
        }
      }
    }
  ]);
  
  return stats[0] || {
    totalBookings: 0,
    activeViewers: 0,
    pendingValidations: 0,
    inValidationQueue: 0,
    pendingNotifications: 0
  };
};

// ============================================================================
// HOOKS POUR REAL-TIME
// ============================================================================

// Après sauvegarde, émettre des événements pour les services real-time
bookingSchema.post('save', async function(doc) {
  // Émettre un événement si le statut a changé
  if (doc.liveUpdates.lastStatusBroadcast && !doc.liveUpdates.lastStatusBroadcast.broadcastAt) {
    // Cet événement sera capturé par bookingRealtimeService
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:status_changed', {
        bookingId: doc._id,
        previousStatus: doc.liveUpdates.lastStatusBroadcast.previousStatus,
        newStatus: doc.liveUpdates.lastStatusBroadcast.newStatus,
        booking: doc
      });
    });
  }
  
  // Émettre un événement si le prix a changé
  if (doc.liveUpdates.lastPriceUpdate && !doc.liveUpdates.lastPriceUpdate.broadcastSent) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:price_updated', {
        bookingId: doc._id,
        previousPrice: doc.liveUpdates.lastPriceUpdate.previousPrice,
        newPrice: doc.liveUpdates.lastPriceUpdate.newPrice,
        booking: doc
      });
    });
  }
});

// ============================================================================
// EXPORT
// ============================================================================

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;