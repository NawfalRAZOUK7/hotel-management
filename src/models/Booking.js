const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    // ============================================================================
    // EXISTING FIELDS - PRESERVED AS-IS
    // ============================================================================

    // Numéro de référence unique de la réservation
    bookingNumber: {
      type: String,
      unique: true,
      uppercase: true,
      match: [/^BK[0-9]{8}$/, 'Le numéro de réservation doit suivre le format BK12345678'],
    },

    // Relations principales
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, "L'utilisateur est requis"],
    },

    hotel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      required: [true, "L'hôtel est requis"],
    },

    // Réservations multiples selon cahier des charges
    rooms: [
      {
        room: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Room',
          required: true,
        },
        // Prix de la chambre au moment de la réservation
        pricePerNight: {
          type: Number,
          required: true,
          min: [0, 'Le prix ne peut pas être négatif'],
        },
        // Invités assignés à cette chambre
        guests: [
          {
            firstName: {
              type: String,
              required: true,
              trim: true,
              maxlength: [50, 'Le prénom ne peut pas dépasser 50 caractères'],
            },
            lastName: {
              type: String,
              required: true,
              trim: true,
              maxlength: [50, 'Le nom ne peut pas dépasser 50 caractères'],
            },
            age: {
              type: Number,
              min: [0, "L'âge ne peut pas être négatif"],
              max: [120, "L'âge ne peut pas dépasser 120 ans"],
            },
            isMainGuest: {
              type: Boolean,
              default: false,
            },
          },
        ],
      },
    ],

    // Dates de séjour - gestion par nuitée selon cahier des charges
    checkIn: {
      type: Date,
      required: [true, "La date d'arrivée est requise"],
      validate: {
        validator: function (value) {
          return value >= new Date(new Date().setHours(0, 0, 0, 0));
        },
        message: "La date d'arrivée ne peut pas être dans le passé",
      },
    },

    checkOut: {
      type: Date,
      required: [true, 'La date de départ est requise'],
      validate: {
        validator: function (value) {
          return value > this.checkIn;
        },
        message: "La date de départ doit être postérieure à la date d'arrivée",
      },
    },

    // Informations de séjour
    numberOfNights: {
      type: Number,
      min: [1, "Le séjour doit être d'au moins 1 nuit"],
    },

    totalGuests: {
      adults: {
        type: Number,
        required: true,
        min: [1, 'Au moins 1 adulte requis'],
        max: [20, 'Maximum 20 adultes'],
      },
      children: {
        type: Number,
        default: 0,
        min: [0, "Le nombre d'enfants ne peut pas être négatif"],
        max: [10, 'Maximum 10 enfants'],
      },
    },

    // Statuts selon le workflow du cahier des charges
    status: {
      type: String,
      enum: {
        values: [
          'PENDING',
          'CONFIRMED',
          'CANCELLED',
          'CHECKED_IN',
          'CHECKED_OUT',
          'COMPLETED',
          'NO_SHOW',
        ],
        message: 'Statut de réservation invalide',
      },
      default: 'PENDING',
    },

    // Source de réservation selon cahier des charges (statistiques)
    source: {
      type: String,
      enum: ['WEB', 'MOBILE', 'RECEPTION', 'PHONE', 'EMAIL'],
      required: [true, 'La source de réservation est requise'],
    },

    // Informations de prix
    pricing: {
      subtotal: {
        type: Number,
        required: true,
        min: [0, 'Le sous-total ne peut pas être négatif'],
      },
      taxes: {
        type: Number,
        default: 0,
        min: [0, 'Les taxes ne peuvent pas être négatives'],
      },
      fees: {
        type: Number,
        default: 0,
        min: [0, 'Les frais ne peuvent pas être négatifs'],
      },
      discount: {
        type: Number,
        default: 0,
        min: [0, 'La réduction ne peut pas être négative'],
      },
      totalPrice: {
        type: Number,
        required: true,
        min: [0, 'Le prix total ne peut pas être négatif'],
      },
    },

    // Consommations supplémentaires (mini-bar, services additionnels)
    extras: [
      {
        name: {
          type: String,
          required: true,
          trim: true,
          maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères'],
        },
        description: {
          type: String,
          maxlength: [200, 'La description ne peut pas dépasser 200 caractères'],
        },
        quantity: {
          type: Number,
          required: true,
          min: [1, 'La quantité doit être au moins 1'],
        },
        unitPrice: {
          type: Number,
          required: true,
          min: [0, 'Le prix unitaire ne peut pas être négatif'],
        },
        totalPrice: {
          type: Number,
          required: true,
          min: [0, 'Le prix total ne peut pas être négatif'],
        },
        addedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        addedAt: {
          type: Date,
          default: Date.now,
        },
        category: {
          type: String,
          enum: ['MINIBAR', 'RESTAURANT', 'SPA', 'LAUNDRY', 'TRANSPORT', 'OTHER'],
          default: 'OTHER',
        },
      },
    ],

    // Informations de paiement
    payment: {
      method: {
        type: String,
        enum: ['CARD', 'CASH', 'TRANSFER', 'CHECK', 'PENDING'],
        default: 'PENDING',
      },
      status: {
        type: String,
        enum: ['PENDING', 'PAID', 'PARTIAL', 'REFUNDED', 'FAILED'],
        default: 'PENDING',
      },
      amountPaid: {
        type: Number,
        default: 0,
        min: [0, 'Le montant payé ne peut pas être négatif'],
      },
      transactionId: {
        type: String,
        trim: true,
      },
      paidAt: {
        type: Date,
      },
      refundAmount: {
        type: Number,
        default: 0,
        min: [0, 'Le montant du remboursement ne peut pas être négatif'],
      },
      refundedAt: {
        type: Date,
      },
    },

    // Demandes spéciales
    specialRequests: [
      {
        type: {
          type: String,
          enum: [
            'LATE_CHECKIN',
            'EARLY_CHECKOUT',
            'HIGH_FLOOR',
            'QUIET_ROOM',
            'ADJOINING_ROOMS',
            'ACCESSIBILITY',
            'DIETARY',
            'OTHER',
          ],
          required: true,
        },
        description: {
          type: String,
          required: true,
          maxlength: [300, 'La description ne peut pas dépasser 300 caractères'],
        },
        status: {
          type: String,
          enum: ['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED'],
          default: 'PENDING',
        },
        handledBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        handledAt: {
          type: Date,
        },
        notes: {
          type: String,
          maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères'],
        },
      },
    ],

    // Historique des changements de statut
    statusHistory: [
      {
        status: {
          type: String,
          required: true,
        },
        changedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        reason: {
          type: String,
          maxlength: [200, 'La raison ne peut pas dépasser 200 caractères'],
        },
        notes: {
          type: String,
          maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères'],
        },
      },
    ],

    // Informations de contact pour cette réservation
    contactInfo: {
      phone: {
        type: String,
        match: [/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide'],
      },
      email: {
        type: String,
        lowercase: true,
        match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Email invalide'],
      },
      emergencyContact: {
        name: {
          type: String,
          trim: true,
          maxlength: [100, 'Le nom ne peut pas dépasser 100 caractères'],
        },
        phone: {
          type: String,
          match: [/^(\+33|0)[1-9](\d{8})$/, 'Numéro de téléphone français invalide'],
        },
        relationship: {
          type: String,
          maxlength: [50, 'La relation ne peut pas dépasser 50 caractères'],
        },
      },
    },

    // Dates importantes du workflow
    dates: {
      bookedAt: {
        type: Date,
        default: Date.now,
      },
      confirmedAt: {
        type: Date,
      },
      checkedInAt: {
        type: Date,
      },
      checkedOutAt: {
        type: Date,
      },
      cancelledAt: {
        type: Date,
      },
      cancellationDeadline: {
        type: Date,
      },
    },

    // Informations d'annulation
    cancellation: {
      reason: {
        type: String,
        enum: ['CLIENT_REQUEST', 'NO_SHOW', 'OVERBOOKING', 'FORCE_MAJEURE', 'TECHNICAL_ISSUE'],
      },
      cancelledBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      refundPolicy: {
        type: String,
        enum: ['FULL_REFUND', 'PARTIAL_REFUND', 'NO_REFUND'],
      },
      refundAmount: {
        type: Number,
        min: [0, 'Le montant du remboursement ne peut pas être négatif'],
      },
      notes: {
        type: String,
        maxlength: [500, 'Les notes ne peuvent pas dépasser 500 caractères'],
      },
    },

    // Métadonnées
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    // Validation par l'administrateur selon cahier des charges
    validation: {
      isValidated: {
        type: Boolean,
        default: false,
      },
      validatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      validatedAt: {
        type: Date,
      },
      validationNotes: {
        type: String,
        maxlength: [300, 'Les notes ne peuvent pas dépasser 300 caractères'],
      },
    },

    // ============================================================================
    // REAL-TIME TRACKING (WEEK 3) - PRESERVED
    // ============================================================================

    // Real-time session tracking
    realtimeTracking: {
      // Active WebSocket sessions viewing this booking
      activeSessions: [
        {
          userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
          },
          socketId: {
            type: String,
          },
          connectedAt: {
            type: Date,
            default: Date.now,
          },
          userRole: {
            type: String,
            enum: ['CLIENT', 'RECEPTIONIST', 'ADMIN'],
          },
        },
      ],

      // Real-time status updates
      lastBroadcast: {
        eventType: {
          type: String,
        },
        broadcastAt: {
          type: Date,
        },
        broadcastTo: [
          {
            type: String, // Socket room names
          },
        ],
      },

      // Live availability impact tracking
      availabilityImpact: {
        lastCalculated: {
          type: Date,
        },
        affectedDates: [
          {
            type: Date,
          },
        ],
        roomsImpacted: [
          {
            roomId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'Room',
            },
            previousAvailability: {
              type: Number,
            },
            newAvailability: {
              type: Number,
            },
          },
        ],
      },

      // Real-time validation tracking
      validationQueue: {
        enteredQueueAt: {
          type: Date,
        },
        queuePosition: {
          type: Number,
        },
        urgencyScore: {
          type: Number,
          min: [0, "Score d'urgence minimum 0"],
          max: [10, "Score d'urgence maximum 10"],
        },
        assignedTo: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      },
    },

    // Live update timestamps
    liveUpdates: {
      // Track when booking data changes for real-time sync
      lastModificationBroadcast: {
        type: Date,
      },
      // Track price changes for dynamic pricing broadcasts
      lastPriceUpdate: {
        previousPrice: {
          type: Number,
        },
        newPrice: {
          type: Number,
        },
        updatedAt: {
          type: Date,
        },
        broadcastSent: {
          type: Boolean,
          default: false,
        },
      },
      // Track status changes for instant notifications
      lastStatusBroadcast: {
        previousStatus: {
          type: String,
        },
        newStatus: {
          type: String,
        },
        broadcastAt: {
          type: Date,
        },
        receivedBy: [
          {
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
            },
            receivedAt: {
              type: Date,
            },
          },
        ],
      },
    },

    // Real-time notifications tracking
    realtimeNotifications: {
      // Pending notifications to be sent
      pending: [
        {
          type: {
            type: String,
            enum: [
              'STATUS_CHANGE',
              'PRICE_UPDATE',
              'AVAILABILITY_CHANGE',
              'ADMIN_ACTION',
              'PAYMENT_UPDATE',
            ],
          },
          scheduledFor: {
            type: Date,
          },
          retryCount: {
            type: Number,
            default: 0,
          },
          lastAttempt: {
            type: Date,
          },
        },
      ],
      // Sent notifications log
      sent: [
        {
          type: {
            type: String,
          },
          sentAt: {
            type: Date,
          },
          sentTo: [
            {
              userId: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
              },
              channel: {
                type: String,
                enum: ['SOCKET', 'EMAIL', 'SMS', 'PUSH'],
              },
              delivered: {
                type: Boolean,
                default: false,
              },
            },
          ],
        },
      ],
    },

    // Socket room assignments for this booking
    socketRooms: {
      // Booking-specific room
      bookingRoom: {
        type: String, // Format: 'booking-{bookingId}'
      },
      // Hotel-specific room
      hotelRoom: {
        type: String, // Format: 'hotel-{hotelId}'
      },
      // User-specific rooms
      userRooms: [
        {
          type: String, // Format: 'user-{userId}'
        },
      ],
      // Admin broadcast room
      adminRoom: {
        type: String,
        default: 'admin-notifications',
      },
    },

    // ============================================================================
    // ✨ NEW PHASE I4: QR TRACKING INTEGRATION ✨
    // ============================================================================

    // QR Code Generation & Usage Tracking
    qrTracking: {
      // Historique génération QR par booking
      generated: [
        {
          qrCodeId: {
            type: String,
            required: true,
            index: true,
          },
          token: {
            type: String,
            required: true,
          },
          type: {
            type: String,
            enum: ['CHECK_IN', 'CHECK_OUT', 'ROOM_ACCESS', 'PAYMENT', 'FEEDBACK'],
            required: true,
          },
          generatedAt: {
            type: Date,
            default: Date.now,
            index: true,
          },
          generatedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
          },
          expiresAt: {
            type: Date,
            required: true,
            index: true,
          },
          isUsed: {
            type: Boolean,
            default: false,
            index: true,
          },
          usedAt: {
            type: Date,
          },
          style: {
            type: String,
            enum: ['default', 'hotel', 'mobile', 'print'],
            default: 'default',
          },
          deviceInfo: {
            type: String,
          },
          ipAddress: {
            type: String,
          },
          // Sécurité QR
          securityLevel: {
            type: String,
            enum: ['BASIC', 'STANDARD', 'HIGH'],
            default: 'STANDARD',
          },
          revoked: {
            isRevoked: {
              type: Boolean,
              default: false,
            },
            revokedAt: {
              type: Date,
            },
            revokedBy: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
            },
            reason: {
              type: String,
            },
          },
        },
      ],

      // Tentatives de check-in QR avec analytics
      checkInAttempts: [
        {
          attemptAt: {
            type: Date,
            default: Date.now,
            index: true,
          },
          qrCodeId: {
            type: String,
            required: true,
          },
          qrToken: {
            type: String,
            required: true,
          },
          success: {
            type: Boolean,
            required: true,
            index: true,
          },
          failureReason: {
            type: String,
            enum: [
              'EXPIRED',
              'INVALID',
              'REVOKED',
              'USAGE_EXCEEDED',
              'WRONG_HOTEL',
              'WRONG_BOOKING',
              'TECHNICAL_ERROR',
            ],
          },
          processTimeMs: {
            type: Number, // Temps de traitement en millisecondes
            min: [0, 'Le temps de traitement ne peut être négatif'],
          },
          deviceInfo: {
            userAgent: String,
            platform: String,
            browser: String,
            isMobile: Boolean,
          },
          location: {
            latitude: Number,
            longitude: Number,
            accuracy: Number,
          },
          ipAddress: {
            type: String,
          },
          // Données contextuelles
          context: {
            hotelId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'Hotel',
            },
            receptionistId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
            },
            kiosk: {
              type: Boolean,
              default: false,
            },
            kioskId: String,
          },
        },
      ],

      // Performance Analytics QR
      performance: {
        // Moyennes check-in QR
        averageCheckInTime: {
          type: Number, // Millisecondes
          default: 0,
        },
        medianCheckInTime: {
          type: Number,
          default: 0,
        },
        fastestCheckIn: {
          time: {
            type: Number,
            default: 0,
          },
          achievedAt: Date,
        },
        slowestCheckIn: {
          time: {
            type: Number,
            default: 0,
          },
          occurredAt: Date,
        },

        // Statistiques usage
        totalQRGenerated: {
          type: Number,
          default: 0,
        },
        totalQRUsed: {
          type: Number,
          default: 0,
        },
        totalCheckInAttempts: {
          type: Number,
          default: 0,
        },
        successfulCheckIns: {
          type: Number,
          default: 0,
        },
        successRate: {
          type: Number, // Pourcentage
          default: 0,
          min: [0, 'Taux de succès minimum 0'],
          max: [100, 'Taux de succès maximum 100'],
        },

        // Dernières activités QR
        lastQRGenerated: {
          type: Date,
        },
        lastQRUsed: {
          type: Date,
        },
        lastSuccessfulCheckIn: {
          type: Date,
        },

        // Performance par type QR
        performanceByType: {
          CHECK_IN: {
            generated: { type: Number, default: 0 },
            used: { type: Number, default: 0 },
            avgTime: { type: Number, default: 0 },
            successRate: { type: Number, default: 0 },
          },
          CHECK_OUT: {
            generated: { type: Number, default: 0 },
            used: { type: Number, default: 0 },
            avgTime: { type: Number, default: 0 },
            successRate: { type: Number, default: 0 },
          },
          ROOM_ACCESS: {
            generated: { type: Number, default: 0 },
            used: { type: Number, default: 0 },
            avgTime: { type: Number, default: 0 },
            successRate: { type: Number, default: 0 },
          },
        },
      },

      // QR Configuration pour cette réservation
      configuration: {
        autoGenerate: {
          type: Boolean,
          default: true,
        },
        generateOnConfirmation: {
          type: Boolean,
          default: true,
        },
        generateOnCheckIn: {
          type: Boolean,
          default: false,
        },
        emailQRToGuest: {
          type: Boolean,
          default: true,
        },
        smsQRToGuest: {
          type: Boolean,
          default: false,
        },
        expiryHours: {
          type: Number,
          default: 24,
          min: [1, 'Expiration minimum 1 heure'],
          max: [168, 'Expiration maximum 1 semaine'],
        },
        maxUsageCount: {
          type: Number,
          default: 10,
          min: [1, 'Usage minimum 1'],
          max: [100, 'Usage maximum 100'],
        },
      },
    },

    // ============================================================================
    // ✨ NEW PHASE I4: CACHE TRACKING INTEGRATION ✨
    // ============================================================================

    // Cache Performance & Invalidation Tracking
    cacheTracking: {
      // Invalidation cache tracking
      invalidations: [
        {
          triggeredAt: {
            type: Date,
            default: Date.now,
            index: true,
          },
          triggeredBy: {
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
            },
            action: {
              type: String,
              enum: [
                'CREATE',
                'UPDATE',
                'DELETE',
                'STATUS_CHANGE',
                'PAYMENT_UPDATE',
                'CHECK_IN',
                'CHECK_OUT',
              ],
            },
            source: {
              type: String,
              enum: ['WEB', 'MOBILE', 'API', 'CRON', 'WEBHOOK', 'REALTIME'],
            },
          },
          cacheTypes: [
            {
              type: String,
              enum: [
                'AVAILABILITY',
                'YIELD_PRICING',
                'ANALYTICS',
                'HOTEL_DATA',
                'BOOKING_DATA',
                'USER_DATA',
              ],
              keysInvalidated: [String],
              totalKeysCount: Number,
              invalidationTimeMs: Number,
            },
          ],
          reason: {
            type: String,
            maxlength: [200, 'Raison invalidation trop longue'],
          },
          cascade: {
            hotelCache: Boolean,
            userCache: Boolean,
            analyticsCache: Boolean,
            globalCache: Boolean,
          },
          performance: {
            totalInvalidationTime: Number, // millisecondes
            keysInvalidated: Number,
            errorsCount: Number,
            warningsCount: Number,
          },
        },
      ],

      // Cache Performance Metrics pour cette réservation
      performance: {
        // Hit/Miss rates
        cacheHitRate: {
          type: Number, // Pourcentage
          default: 0,
          min: [0, 'Hit rate minimum 0'],
          max: [100, 'Hit rate maximum 100'],
        },
        cacheMissRate: {
          type: Number,
          default: 0,
          min: [0, 'Miss rate minimum 0'],
          max: [100, 'Miss rate maximum 100'],
        },

        // Response times
        averageResponseTime: {
          withCache: {
            type: Number, // millisecondes
            default: 0,
          },
          withoutCache: {
            type: Number,
            default: 0,
          },
          improvement: {
            type: Number, // pourcentage d'amélioration
            default: 0,
          },
        },

        // Cache operations counting
        operations: {
          reads: {
            total: { type: Number, default: 0 },
            hits: { type: Number, default: 0 },
            misses: { type: Number, default: 0 },
          },
          writes: {
            total: { type: Number, default: 0 },
            successful: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
          },
          invalidations: {
            total: { type: Number, default: 0 },
            successful: { type: Number, default: 0 },
            failed: { type: Number, default: 0 },
          },
        },

        // Dernière activité cache
        lastCacheRead: {
          type: Date,
        },
        lastCacheWrite: {
          type: Date,
        },
        lastInvalidation: {
          type: Date,
        },

        // Cache strategy effectiveness
        strategyEffectiveness: {
          availabilityCache: {
            hitRate: { type: Number, default: 0 },
            avgResponseTime: { type: Number, default: 0 },
            optimalTTL: { type: Number, default: 300 }, // secondes
          },
          pricingCache: {
            hitRate: { type: Number, default: 0 },
            avgResponseTime: { type: Number, default: 0 },
            optimalTTL: { type: Number, default: 1800 },
          },
          analyticsCache: {
            hitRate: { type: Number, default: 0 },
            avgResponseTime: { type: Number, default: 0 },
            optimalTTL: { type: Number, default: 3600 },
          },
        },
      },

      // Cache Preferences pour cette réservation
      preferences: {
        enableCaching: {
          type: Boolean,
          default: true,
        },
        cacheStrategy: {
          type: String,
          enum: ['AGGRESSIVE', 'BALANCED', 'CONSERVATIVE'],
          default: 'BALANCED',
        },
        customTTL: {
          availability: {
            type: Number,
            default: 300, // 5 minutes
            min: [30, 'TTL minimum 30 secondes'],
            max: [3600, 'TTL maximum 1 heure'],
          },
          pricing: {
            type: Number,
            default: 1800, // 30 minutes
            min: [300, 'TTL minimum 5 minutes'],
            max: [7200, 'TTL maximum 2 heures'],
          },
          workflow: {
            type: Number,
            default: 600, // 10 minutes
            min: [60, 'TTL minimum 1 minute'],
            max: [1800, 'TTL maximum 30 minutes'],
          },
        },
        invalidationTriggers: {
          onStatusChange: { type: Boolean, default: true },
          onPriceChange: { type: Boolean, default: true },
          onCheckIn: { type: Boolean, default: true },
          onCheckOut: { type: Boolean, default: true },
          onPayment: { type: Boolean, default: true },
        },
      },

      // Cache Health Monitoring
      health: {
        lastHealthCheck: {
          type: Date,
        },
        healthScore: {
          type: Number, // 0-100
          default: 100,
          min: [0, 'Score santé minimum 0'],
          max: [100, 'Score santé maximum 100'],
        },
        issues: [
          {
            type: {
              type: String,
              enum: [
                'HIGH_MISS_RATE',
                'SLOW_RESPONSE',
                'INVALIDATION_FAILURE',
                'MEMORY_USAGE',
                'TTL_OPTIMIZATION',
              ],
            },
            severity: {
              type: String,
              enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
            },
            detectedAt: {
              type: Date,
              default: Date.now,
            },
            description: String,
            resolved: {
              type: Boolean,
              default: false,
            },
            resolvedAt: Date,
          },
        ],
        recommendations: [
          {
            type: {
              type: String,
              enum: [
                'INCREASE_TTL',
                'DECREASE_TTL',
                'CHANGE_STRATEGY',
                'ADD_WARMUP',
                'OPTIMIZE_KEYS',
              ],
            },
            priority: {
              type: String,
              enum: ['LOW', 'MEDIUM', 'HIGH'],
              default: 'MEDIUM',
            },
            description: String,
            impact: String,
            createdAt: {
              type: Date,
              default: Date.now,
            },
            applied: {
              type: Boolean,
              default: false,
            },
            appliedAt: Date,
          },
        ],
      },
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);
// ============================================================================
// INDEXES POUR PERFORMANCE (incluant QR + Cache tracking)
// ============================================================================
// Existing indexes
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
// Real-time indexes (preserved)
bookingSchema.index({ 'realtimeTracking.activeSessions.socketId': 1 });
bookingSchema.index({ 'realtimeTracking.validationQueue.urgencyScore': -1 });
bookingSchema.index({ 'liveUpdates.lastModificationBroadcast': 1 });
bookingSchema.index({ 'socketRooms.bookingRoom': 1 });
bookingSchema.index({ 'socketRooms.hotelRoom': 1 });
// ✨ NEW QR TRACKING INDEXES ✨
bookingSchema.index({ 'qrTracking.generated.qrCodeId': 1 });
bookingSchema.index({ 'qrTracking.generated.expiresAt': 1 });
bookingSchema.index({ 'qrTracking.generated.isUsed': 1 });
bookingSchema.index({ 'qrTracking.generated.generatedAt': -1 });
bookingSchema.index({ 'qrTracking.checkInAttempts.attemptAt': -1 });
bookingSchema.index({ 'qrTracking.checkInAttempts.success': 1 });
bookingSchema.index({ 'qrTracking.performance.successRate': -1 });
bookingSchema.index({ 'qrTracking.performance.lastQRUsed': -1 });
// ✨ NEW CACHE TRACKING INDEXES ✨
bookingSchema.index({ 'cacheTracking.invalidations.triggeredAt': -1 });
bookingSchema.index({ 'cacheTracking.performance.cacheHitRate': -1 });
bookingSchema.index({ 'cacheTracking.performance.lastInvalidation': -1 });
bookingSchema.index({ 'cacheTracking.health.healthScore': -1 });
bookingSchema.index({ 'cacheTracking.health.lastHealthCheck': -1 });
// ============================================================================
// VIRTUALS (existing + new QR + Cache virtuals)
// ============================================================================
// Existing virtuals preserved
bookingSchema.virtual('totalGuestsCount').get(function () {
  return this.totalGuests.adults + this.totalGuests.children;
});
bookingSchema.virtual('totalRooms').get(function () {
  return this.rooms.length;
});
bookingSchema.virtual('stayDuration').get(function () {
  if (!this.checkIn || !this.checkOut) return 0;
  const timeDiff = this.checkOut.getTime() - this.checkIn.getTime();
  return Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
});
bookingSchema.virtual('finalTotalPrice').get(function () {
  const extrasTotal = this.extras.reduce((sum, extra) => sum + extra.totalPrice, 0);
  return this.pricing.totalPrice + extrasTotal;
});
bookingSchema.virtual('remainingAmount').get(function () {
  return Math.max(0, this.finalTotalPrice - this.payment.amountPaid);
});
bookingSchema.virtual('isModifiable').get(function () {
  const modifiableStatuses = ['PENDING', 'CONFIRMED'];
  const now = new Date();
  const checkInDate = new Date(this.checkIn);
  const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);
  return modifiableStatuses.includes(this.status) && hoursUntilCheckIn > 24;
});
bookingSchema.virtual('isCancellable').get(function () {
  const cancellableStatuses = ['PENDING', 'CONFIRMED'];
  const now = new Date();
  return (
    cancellableStatuses.includes(this.status) &&
    (!this.dates.cancellationDeadline || now <= this.dates.cancellationDeadline)
  );
});
// Real-time virtuals (preserved)
bookingSchema.virtual('hasActiveViewers').get(function () {
  return this.realtimeTracking?.activeSessions?.length > 0;
});
bookingSchema.virtual('isInValidationQueue').get(function () {
  return (
    this.status === 'PENDING' && this.realtimeTracking?.validationQueue?.enteredQueueAt != null
  );
});
bookingSchema.virtual('requiresBroadcast').get(function () {
  const lastBroadcast = this.liveUpdates?.lastModificationBroadcast;
  const lastUpdate = this.updatedAt;
  if (!lastBroadcast) return true;
  return lastUpdate > lastBroadcast;
});
// ✨ NEW QR TRACKING VIRTUALS ✨
// Check if QR codes are active for this booking
bookingSchema.virtual('hasActiveQRCodes').get(function () {
  if (!this.qrTracking?.generated) return false;
  const now = new Date();
  return this.qrTracking.generated.some(
    (qr) => !qr.isUsed && !qr.revoked.isRevoked && qr.expiresAt > now
  );
});
// Get active QR codes count
bookingSchema.virtual('activeQRCodesCount').get(function () {
  if (!this.qrTracking?.generated) return 0;
  const now = new Date();
  return this.qrTracking.generated.filter(
    (qr) => !qr.isUsed && !qr.revoked.isRevoked && qr.expiresAt > now
  ).length;
});
// Check if QR check-in is available
bookingSchema.virtual('isQRCheckInAvailable').get(function () {
  if (this.status !== 'CONFIRMED') return false;
  const now = new Date();
  const checkInDate = new Date(this.checkIn);
  const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);
  // QR check-in available 24h before check-in date
  return hoursUntilCheckIn <= 24 && hoursUntilCheckIn >= -6; // Up to 6h after
});
// Get QR performance summary
bookingSchema.virtual('qrPerformanceSummary').get(function () {
  const perf = this.qrTracking?.performance;
  if (!perf) return null;
  return {
    totalGenerated: perf.totalQRGenerated || 0,
    totalUsed: perf.totalQRUsed || 0,
    successRate: perf.successRate || 0,
    avgCheckInTime: perf.averageCheckInTime || 0,
    usageRate:
      perf.totalQRGenerated > 0 ? Math.round((perf.totalQRUsed / perf.totalQRGenerated) * 100) : 0,
  };
});
// Get latest QR code
bookingSchema.virtual('latestQRCode').get(function () {
  if (!this.qrTracking?.generated?.length) return null;
  return this.qrTracking.generated.sort(
    (a, b) => new Date(b.generatedAt) - new Date(a.generatedAt)
  )[0];
});
// ✨ NEW CACHE TRACKING VIRTUALS ✨
// Check cache health status
bookingSchema.virtual('cacheHealthStatus').get(function () {
  const health = this.cacheTracking?.health;
  if (!health) return 'UNKNOWN';
  const score = health.healthScore || 100;
  if (score >= 90) return 'EXCELLENT';
  if (score >= 75) return 'GOOD';
  if (score >= 50) return 'FAIR';
  if (score >= 25) return 'POOR';
  return 'CRITICAL';
});
// Get cache performance score
bookingSchema.virtual('cachePerformanceScore').get(function () {
  const perf = this.cacheTracking?.performance;
  if (!perf) return 0;
  const hitRate = perf.cacheHitRate || 0;
  const responseTimeImprovement = perf.averageResponseTime?.improvement || 0;
  // Weighted score: 70% hit rate + 30% response time improvement
  return Math.round(hitRate * 0.7 + responseTimeImprovement * 0.3);
});
// Check if cache optimization is needed
bookingSchema.virtual('needsCacheOptimization').get(function () {
  const perf = this.cacheTracking?.performance;
  if (!perf) return false;
  const hitRate = perf.cacheHitRate || 0;
  const health = this.cacheTracking?.health?.healthScore || 100;
  return hitRate < 70 || health < 75;
});
// Get cache strategy recommendation
bookingSchema.virtual('cacheStrategyRecommendation').get(function () {
  const perf = this.cacheTracking?.performance;
  if (!perf) return 'BALANCED';
  const hitRate = perf.cacheHitRate || 0;
  const avgResponseTime = perf.averageResponseTime?.improvement || 0;
  if (hitRate > 90 && avgResponseTime > 50) return 'CURRENT_OPTIMAL';
  if (hitRate < 50) return 'AGGRESSIVE';
  if (avgResponseTime < 20) return 'CONSERVATIVE';
  return 'BALANCED';
});
// Get recent cache issues count
bookingSchema.virtual('recentCacheIssuesCount').get(function () {
  const health = this.cacheTracking?.health;
  if (!health?.issues) return 0;
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return health.issues.filter((issue) => !issue.resolved && new Date(issue.detectedAt) > oneDayAgo)
    .length;
});
// ============================================================================
// MIDDLEWARE PRE-SAVE (existing + new QR + Cache tracking)
// ============================================================================

// Existing middleware preserved
bookingSchema.pre('save', async function (next) {
  if (this.isNew) {
    if (!this.bookingNumber) {
      const count = await this.constructor.countDocuments();
      this.bookingNumber = `BK${String(count + 1).padStart(8, '0')}`;
    }
    this.numberOfNights = this.stayDuration;

    if (!this.dates.cancellationDeadline) {
      const deadline = new Date(this.checkIn);
      deadline.setHours(deadline.getHours() - 24);
      this.dates.cancellationDeadline = deadline;
    }

    // Initialize socket rooms
    this.socketRooms = {
      bookingRoom: `booking-${this._id}`,
      hotelRoom: `hotel-${this.hotel}`,
      userRooms: [`user-${this.user}`],
      adminRoom: 'admin-notifications',
    };

    // ✨ Initialize QR tracking for new bookings ✨
    if (!this.qrTracking) {
      this.qrTracking = {
        generated: [],
        checkInAttempts: [],
        performance: {
          averageCheckInTime: 0,
          medianCheckInTime: 0,
          totalQRGenerated: 0,
          totalQRUsed: 0,
          totalCheckInAttempts: 0,
          successfulCheckIns: 0,
          successRate: 0,
          performanceByType: {
            CHECK_IN: { generated: 0, used: 0, avgTime: 0, successRate: 0 },
            CHECK_OUT: { generated: 0, used: 0, avgTime: 0, successRate: 0 },
            ROOM_ACCESS: { generated: 0, used: 0, avgTime: 0, successRate: 0 },
          },
        },
        configuration: {
          autoGenerate: true,
          generateOnConfirmation: true,
          generateOnCheckIn: false,
          emailQRToGuest: true,
          smsQRToGuest: false,
          expiryHours: 24,
          maxUsageCount: 10,
        },
      };
    }

    // ✨ Initialize cache tracking for new bookings ✨
    if (!this.cacheTracking) {
      this.cacheTracking = {
        invalidations: [],
        performance: {
          cacheHitRate: 0,
          cacheMissRate: 0,
          averageResponseTime: {
            withCache: 0,
            withoutCache: 0,
            improvement: 0,
          },
          operations: {
            reads: { total: 0, hits: 0, misses: 0 },
            writes: { total: 0, successful: 0, failed: 0 },
            invalidations: { total: 0, successful: 0, failed: 0 },
          },
          strategyEffectiveness: {
            availabilityCache: { hitRate: 0, avgResponseTime: 0, optimalTTL: 300 },
            pricingCache: { hitRate: 0, avgResponseTime: 0, optimalTTL: 1800 },
            analyticsCache: { hitRate: 0, avgResponseTime: 0, optimalTTL: 3600 },
          },
        },
        preferences: {
          enableCaching: true,
          cacheStrategy: 'BALANCED',
          customTTL: {
            availability: 300,
            pricing: 1800,
            workflow: 600,
          },
          invalidationTriggers: {
            onStatusChange: true,
            onPriceChange: true,
            onCheckIn: true,
            onCheckOut: true,
            onPayment: true,
          },
        },
        health: {
          healthScore: 100,
          issues: [],
          recommendations: [],
        },
      };
    }
  }
  // Mark for broadcast if modified
  if (!this.isNew && this.isModified()) {
    this.liveUpdates.lastModificationBroadcast = null; // Force broadcast
    // ✨ Track cache invalidation triggers ✨
    const modifiedPaths = this.modifiedPaths();
    let shouldInvalidateCache = false;
    let invalidationReason = '';

    if (modifiedPaths.includes('status')) {
      shouldInvalidateCache = this.cacheTracking?.preferences?.invalidationTriggers?.onStatusChange;
      invalidationReason = 'Status change';
    } else if (modifiedPaths.some((path) => path.startsWith('pricing'))) {
      shouldInvalidateCache = this.cacheTracking?.preferences?.invalidationTriggers?.onPriceChange;
      invalidationReason = 'Price change';
    } else if (modifiedPaths.includes('dates.checkedInAt')) {
      shouldInvalidateCache = this.cacheTracking?.preferences?.invalidationTriggers?.onCheckIn;
      invalidationReason = 'Check-in';
    } else if (modifiedPaths.includes('dates.checkedOutAt')) {
      shouldInvalidateCache = this.cacheTracking?.preferences?.invalidationTriggers?.onCheckOut;
      invalidationReason = 'Check-out';
    } else if (modifiedPaths.some((path) => path.startsWith('payment'))) {
      shouldInvalidateCache = this.cacheTracking?.preferences?.invalidationTriggers?.onPayment;
      invalidationReason = 'Payment update';
    }

    if (shouldInvalidateCache) {
      // Queue cache invalidation
      this._queueCacheInvalidation = {
        reason: invalidationReason,
        modifiedPaths: modifiedPaths,
        triggeredAt: new Date(),
      };
    }
  }
  next();
});
// Existing validation middleware preserved
bookingSchema.pre('save', function (next) {
  const totalGuestsInRooms = this.rooms.reduce((sum, room) => sum + room.guests.length, 0);
  const totalGuestsCount = this.totalGuests.adults + this.totalGuests.children;
  if (totalGuestsInRooms !== totalGuestsCount) {
    return next(new Error("Le nombre d'invités assignés aux chambres ne correspond pas au total"));
  }
  const mainGuests = this.rooms.reduce((count, room) => {
    return count + room.guests.filter((guest) => guest.isMainGuest).length;
  }, 0);
  if (mainGuests !== 1) {
    return next(new Error('Il doit y avoir exactement un invité principal par réservation'));
  }
  next();
});
bookingSchema.pre('save', function (next) {
  this.extras.forEach((extra) => {
    extra.totalPrice = extra.quantity * extra.unitPrice;
  });
  next();
});
// ============================================================================
// MÉTHODES D'INSTANCE (existing + new QR + Cache methods)
// ============================================================================
// ✨ NEW QR TRACKING METHODS ✨
// Add QR generation tracking
bookingSchema.methods.addQRGeneration = function (
  qrCodeId,
  token,
  type,
  expiresAt,
  generatedBy,
  options = {}
) {
  const qrEntry = {
    qrCodeId,
    token,
    type,
    generatedAt: new Date(),
    generatedBy,
    expiresAt,
    isUsed: false,
    style: options.style || 'default',
    deviceInfo: options.deviceInfo,
    ipAddress: options.ipAddress,
    securityLevel: options.securityLevel || 'STANDARD',
    revoked: {
      isRevoked: false,
    },
  };
  this.qrTracking.generated.push(qrEntry);
  this.qrTracking.performance.totalQRGenerated += 1;
  this.qrTracking.performance.lastQRGenerated = new Date();
  // Update performance by type
  if (this.qrTracking.performance.performanceByType[type]) {
    this.qrTracking.performance.performanceByType[type].generated += 1;
  }
  return this.save();
};
// Record QR check-in attempt
bookingSchema.methods.recordQRCheckInAttempt = function (qrCodeId, qrToken, success, options = {}) {
  const attempt = {
    attemptAt: new Date(),
    qrCodeId,
    qrToken,
    success,
    failureReason: options.failureReason,
    processTimeMs: options.processTimeMs || 0,
    deviceInfo: options.deviceInfo,
    location: options.location,
    ipAddress: options.ipAddress,
    context: options.context,
  };
  this.qrTracking.checkInAttempts.push(attempt);
  this.qrTracking.performance.totalCheckInAttempts += 1;
  if (success) {
    this.qrTracking.performance.successfulCheckIns += 1;
    this.qrTracking.performance.lastSuccessfulCheckIn = new Date();

    // Mark QR as used
    const qrCode = this.qrTracking.generated.find((qr) => qr.qrCodeId === qrCodeId);
    if (qrCode) {
      qrCode.isUsed = true;
      qrCode.usedAt = new Date();
      this.qrTracking.performance.totalQRUsed += 1;
      this.qrTracking.performance.lastQRUsed = new Date();
    }
  }
  // Update success rate
  this.qrTracking.performance.successRate =
    (this.qrTracking.performance.successfulCheckIns /
      this.qrTracking.performance.totalCheckInAttempts) *
    100;
  // Update average check-in time
  if (success && options.processTimeMs) {
    this.updateQRPerformanceMetrics();
  }
  return this.save();
};
// Update QR performance metrics
bookingSchema.methods.updateQRPerformanceMetrics = function () {
  const successfulAttempts = this.qrTracking.checkInAttempts.filter(
    (attempt) => attempt.success && attempt.processTimeMs > 0
  );
  if (successfulAttempts.length > 0) {
    const times = successfulAttempts.map((attempt) => attempt.processTimeMs);

    // Calculate average
    this.qrTracking.performance.averageCheckInTime =
      times.reduce((sum, time) => sum + time, 0) / times.length;

    // Calculate median
    const sortedTimes = times.sort((a, b) => a - b);
    const mid = Math.floor(sortedTimes.length / 2);
    this.qrTracking.performance.medianCheckInTime =
      sortedTimes.length % 2 !== 0
        ? sortedTimes[mid]
        : (sortedTimes[mid - 1] + sortedTimes[mid]) / 2;

    // Update fastest and slowest
    const fastest = Math.min(...times);
    const slowest = Math.max(...times);

    if (
      !this.qrTracking.performance.fastestCheckIn.time ||
      fastest < this.qrTracking.performance.fastestCheckIn.time
    ) {
      this.qrTracking.performance.fastestCheckIn = {
        time: fastest,
        achievedAt: new Date(),
      };
    }

    if (
      !this.qrTracking.performance.slowestCheckIn.time ||
      slowest > this.qrTracking.performance.slowestCheckIn.time
    ) {
      this.qrTracking.performance.slowestCheckIn = {
        time: slowest,
        occurredAt: new Date(),
      };
    }
  }
  return this;
};
// Get QR analytics
bookingSchema.methods.getQRAnalytics = function () {
  const perf = this.qrTracking.performance;
  const generated = this.qrTracking.generated;
  const attempts = this.qrTracking.checkInAttempts;
  return {
    generation: {
      total: perf.totalQRGenerated,
      byType: perf.performanceByType,
      latest: generated.length > 0 ? generated[generated.length - 1].generatedAt : null,
    },
    usage: {
      total: perf.totalQRUsed,
      usageRate: perf.totalQRGenerated > 0 ? (perf.totalQRUsed / perf.totalQRGenerated) * 100 : 0,
      latest: perf.lastQRUsed,
    },
    checkIn: {
      attempts: perf.totalCheckInAttempts,
      successful: perf.successfulCheckIns,
      successRate: perf.successRate,
      averageTime: perf.averageCheckInTime,
      medianTime: perf.medianCheckInTime,
      fastest: perf.fastestCheckIn,
      slowest: perf.slowestCheckIn,
    },
    recentAttempts: attempts.slice(-10), // Last 10 attempts
  };
};
// Revoke QR code
bookingSchema.methods.revokeQRCode = function (qrCodeId, revokedBy, reason) {
  const qrCode = this.qrTracking.generated.find((qr) => qr.qrCodeId === qrCodeId);
  if (qrCode) {
    qrCode.revoked = {
      isRevoked: true,
      revokedAt: new Date(),
      revokedBy,
      reason,
    };
  }
  return this.save();
};
// ✨ NEW CACHE TRACKING METHODS ✨
// Record cache invalidation
bookingSchema.methods.recordCacheInvalidation = function (triggeredBy, cacheTypes, options = {}) {
  const invalidation = {
    triggeredAt: new Date(),
    triggeredBy: {
      userId: triggeredBy.userId,
      action: triggeredBy.action,
      source: triggeredBy.source,
    },
    cacheTypes: cacheTypes.map((cache) => ({
      type: cache.type,
      keysInvalidated: cache.keysInvalidated || [],
      totalKeysCount: cache.totalKeysCount || 0,
      invalidationTimeMs: cache.invalidationTimeMs || 0,
    })),
    reason: options.reason,
    cascade: {
      hotelCache: options.cascade?.hotelCache || false,
      userCache: options.cascade?.userCache || false,
      analyticsCache: options.cascade?.analyticsCache || false,
      globalCache: options.cascade?.globalCache || false,
    },
    performance: {
      totalInvalidationTime: options.performance?.totalInvalidationTime || 0,
      keysInvalidated: options.performance?.keysInvalidated || 0,
      errorsCount: options.performance?.errorsCount || 0,
      warningsCount: options.performance?.warningsCount || 0,
    },
  };
  this.cacheTracking.invalidations.push(invalidation);
  this.cacheTracking.performance.operations.invalidations.total += 1;
  if (options.performance?.errorsCount === 0) {
    this.cacheTracking.performance.operations.invalidations.successful += 1;
  } else {
    this.cacheTracking.performance.operations.invalidations.failed += 1;
  }
  this.cacheTracking.performance.lastInvalidation = new Date();
  return this.save();
};
// Update cache metrics
bookingSchema.methods.updateCacheMetrics = function (operation, metrics) {
  const perf = this.cacheTracking.performance;
  switch (operation) {
    case 'READ':
      perf.operations.reads.total += 1;
      if (metrics.hit) {
        perf.operations.reads.hits += 1;
        this.cacheTracking.performance.lastCacheRead = new Date();
      } else {
        perf.operations.reads.misses += 1;
      }
      // Update hit/miss rates
      perf.cacheHitRate = (perf.operations.reads.hits / perf.operations.reads.total) * 100;
      perf.cacheMissRate = (perf.operations.reads.misses / perf.operations.reads.total) * 100;

      // Update response times
      if (metrics.responseTime) {
        if (metrics.hit) {
          perf.averageResponseTime.withCache =
            (perf.averageResponseTime.withCache * (perf.operations.reads.hits - 1) +
              metrics.responseTime) /
            perf.operations.reads.hits;
        } else {
          perf.averageResponseTime.withoutCache =
            (perf.averageResponseTime.withoutCache * (perf.operations.reads.misses - 1) +
              metrics.responseTime) /
            perf.operations.reads.misses;
        }

        // Calculate improvement
        if (perf.averageResponseTime.withoutCache > 0) {
          perf.averageResponseTime.improvement =
            ((perf.averageResponseTime.withoutCache - perf.averageResponseTime.withCache) /
              perf.averageResponseTime.withoutCache) *
            100;
        }
      }
      break;

    case 'write':
      perf.operations.writes.total += 1;
      if (metrics.success) {
        perf.operations.writes.successful += 1;
      } else {
        perf.operations.writes.failed += 1;
      }
      this.cacheTracking.performance.lastCacheWrite = new Date();
      break;
  }
  // Update strategy effectiveness
  if (metrics.cacheType && perf.strategyEffectiveness[metrics.cacheType]) {
    const strategy = perf.strategyEffectiveness[metrics.cacheType];
    if (metrics.hit !== undefined) {
      // Simple moving average for hit rate
      strategy.hitRate = strategy.hitRate * 0.9 + (metrics.hit ? 10 : 0);
    }

    if (metrics.responseTime) {
      strategy.avgResponseTime = strategy.avgResponseTime * 0.9 + metrics.responseTime * 0.1;
    }
  }
  return this.save();
};
// Get cache performance summary
bookingSchema.methods.getCachePerformance = function () {
  const perf = this.cacheTracking.performance;
  return {
    hitRate: perf.cacheHitRate || 0,
    missRate: perf.cacheMissRate || 0,
    responseTime: {
      withCache: perf.averageResponseTime?.withCache || 0,
      withoutCache: perf.averageResponseTime?.withoutCache || 0,
      improvement: perf.averageResponseTime?.improvement || 0,
    },
    operations: {
      totalReads: perf.operations?.reads?.total || 0,
      totalWrites: perf.operations?.writes?.total || 0,
      totalInvalidations: perf.operations?.invalidations?.total || 0,
      successfulOperations:
        (perf.operations?.reads?.hits || 0) +
        (perf.operations?.writes?.successful || 0) +
        (perf.operations?.invalidations?.successful || 0),
    },
    health: {
      score: this.cacheTracking.health?.healthScore || 100,
      status: this.cacheHealthStatus,
      issuesCount: this.recentCacheIssuesCount,
    },
    strategy: {
      current: this.cacheTracking.preferences?.cacheStrategy || 'BALANCED',
      recommended: this.cacheStrategyRecommendation,
      needsOptimization: this.needsCacheOptimization,
    },
  };
};
// Add cache health issue
bookingSchema.methods.addCacheHealthIssue = function (type, severity, description) {
  const issue = {
    type,
    severity,
    detectedAt: new Date(),
    description,
    resolved: false,
  };
  this.cacheTracking.health.issues.push(issue);
  // Update health score based on severity
  let scoreDeduction = 0;
  switch (severity) {
    case 'CRITICAL':
      scoreDeduction = 25;
      break;
    case 'HIGH':
      scoreDeduction = 15;
      break;
    case 'MEDIUM':
      scoreDeduction = 10;
      break;
    case 'LOW':
      scoreDeduction = 5;
      break;
  }

  this.cacheTracking.health.healthScore = Math.max(
    0,
    (this.cacheTracking.health.healthScore || 100) - scoreDeduction
  );

  this.cacheTracking.health.lastHealthCheck = new Date();

  return this.save();
};

// Resolve cache health issue
bookingSchema.methods.resolveCacheHealthIssue = function (issueId) {
  const issue = this.cacheTracking.health.issues.id(issueId);

  if (issue) {
    issue.resolved = true;
    issue.resolvedAt = new Date();

    // Improve health score when resolving issues
    let scoreImprovement = 0;
    switch (issue.severity) {
      case 'CRITICAL':
        scoreImprovement = 20;
        break;
      case 'HIGH':
        scoreImprovement = 12;
        break;
      case 'MEDIUM':
        scoreImprovement = 8;
        break;
      case 'LOW':
        scoreImprovement = 4;
        break;
    }

    this.cacheTracking.health.healthScore = Math.min(
      100,
      (this.cacheTracking.health.healthScore || 0) + scoreImprovement
    );
  }

  return this.save();
};

// Add cache optimization recommendation
bookingSchema.methods.addCacheRecommendation = function (type, priority, description, impact) {
  const recommendation = {
    type,
    priority,
    description,
    impact,
    createdAt: new Date(),
    applied: false,
  };

  this.cacheTracking.health.recommendations.push(recommendation);

  return this.save();
};

// Apply cache recommendation
bookingSchema.methods.applyCacheRecommendation = function (recommendationId) {
  const recommendation = this.cacheTracking.health.recommendations.id(recommendationId);

  if (recommendation) {
    recommendation.applied = true;
    recommendation.appliedAt = new Date();

    // Apply the recommendation based on type
    switch (recommendation.type) {
      case 'INCREASE_TTL':
        // Increase TTL values by 50%
        Object.keys(this.cacheTracking.preferences.customTTL).forEach((key) => {
          this.cacheTracking.preferences.customTTL[key] *= 1.5;
        });
        break;

      case 'DECREASE_TTL':
        // Decrease TTL values by 25%
        Object.keys(this.cacheTracking.preferences.customTTL).forEach((key) => {
          this.cacheTracking.preferences.customTTL[key] *= 0.75;
        });
        break;

      case 'CHANGE_STRATEGY':
        // Change to more aggressive strategy
        if (this.cacheTracking.preferences.cacheStrategy === 'CONSERVATIVE') {
          this.cacheTracking.preferences.cacheStrategy = 'BALANCED';
        } else if (this.cacheTracking.preferences.cacheStrategy === 'BALANCED') {
          this.cacheTracking.preferences.cacheStrategy = 'AGGRESSIVE';
        }
        break;
    }
  }

  return this.save();
};

// ============================================================================
// EXISTING METHODS PRESERVED (all previous methods kept as-is)
// ============================================================================

// Change status with history
bookingSchema.methods.changeStatus = function (newStatus, changedBy, reason = '', notes = '') {
  const validTransitions = {
    PENDING: ['CONFIRMED', 'CANCELLED'],
    CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
    CHECKED_IN: ['CHECKED_OUT'],
    CHECKED_OUT: ['COMPLETED'],
    CANCELLED: [],
    COMPLETED: [],
    NO_SHOW: ['CANCELLED'],
  };

  if (!validTransitions[this.status].includes(newStatus)) {
    throw new Error(`Transition de ${this.status} vers ${newStatus} non autorisée`);
  }

  const oldStatus = this.status;
  this.status = newStatus;

  this.statusHistory.push({
    status: newStatus,
    changedBy,
    reason,
    notes,
  });

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

  this.liveUpdates.lastStatusBroadcast = {
    previousStatus: oldStatus,
    newStatus: newStatus,
    broadcastAt: null,
    receivedBy: [],
  };

  return this.save();
};

// Add extra
bookingSchema.methods.addExtra = function (extraData, addedBy) {
  const extra = {
    ...extraData,
    totalPrice: extraData.quantity * extraData.unitPrice,
    addedBy,
    addedAt: new Date(),
  };

  this.extras.push(extra);
  return this.save();
};

// Calculate total price
bookingSchema.methods.calculateTotalPrice = async function () {
  let subtotal = 0;

  for (const roomBooking of this.rooms) {
    await roomBooking.room.populate('room');
    const roomPrice = await roomBooking.room.getPriceForDate(this.checkIn);
    roomBooking.pricePerNight = roomPrice;
    subtotal += roomPrice * this.numberOfNights;
  }

  const taxes = subtotal * 0.1;
  const totalPrice = subtotal + taxes - this.pricing.discount + this.pricing.fees;

  this.pricing.subtotal = subtotal;
  this.pricing.taxes = taxes;
  this.pricing.totalPrice = totalPrice;

  if (this.pricing.totalPrice !== totalPrice) {
    this.liveUpdates.lastPriceUpdate = {
      previousPrice: this.pricing.totalPrice,
      newPrice: totalPrice,
      updatedAt: new Date(),
      broadcastSent: false,
    };
  }

  return this.save();
};

// Cancel booking
bookingSchema.methods.cancel = function (reason, cancelledBy, notes = '') {
  if (!this.isCancellable) {
    throw new Error('Cette réservation ne peut plus être annulée');
  }

  let refundAmount = 0;
  const now = new Date();
  const hoursUntilCheckIn = (this.checkIn - now) / (1000 * 60 * 60);

  if (hoursUntilCheckIn > 48) {
    refundAmount = this.pricing.totalPrice;
    this.cancellation.refundPolicy = 'FULL_REFUND';
  } else if (hoursUntilCheckIn > 24) {
    refundAmount = this.pricing.totalPrice * 0.5;
    this.cancellation.refundPolicy = 'PARTIAL_REFUND';
  } else {
    refundAmount = 0;
    this.cancellation.refundPolicy = 'NO_REFUND';
  }

  this.cancellation.reason = reason;
  this.cancellation.cancelledBy = cancelledBy;
  this.cancellation.refundAmount = refundAmount;
  this.cancellation.notes = notes;

  return this.changeStatus('CANCELLED', cancelledBy, reason, notes);
};

// Validate booking
bookingSchema.methods.validate = function (validatedBy, notes = '') {
  this.validation.isValidated = true;
  this.validation.validatedBy = validatedBy;
  this.validation.validatedAt = new Date();
  this.validation.validationNotes = notes;

  if (this.realtimeTracking.validationQueue.enteredQueueAt) {
    this.realtimeTracking.validationQueue = {};
  }

  return this.changeStatus(
    'CONFIRMED',
    validatedBy,
    "Réservation validée par l'administrateur",
    notes
  );
};

// Generate invoice
bookingSchema.methods.generateInvoice = function () {
  const invoice = {
    bookingNumber: this.bookingNumber,
    guestName:
      this.rooms[0].guests.find((g) => g.isMainGuest)?.firstName +
      ' ' +
      this.rooms[0].guests.find((g) => g.isMainGuest)?.lastName,
    hotelName: this.hotel.name,
    checkIn: this.checkIn,
    checkOut: this.checkOut,
    numberOfNights: this.numberOfNights,
    rooms: this.rooms.map((r) => ({
      roomNumber: r.room.number,
      roomType: r.room.type,
      pricePerNight: r.pricePerNight,
      totalPrice: r.pricePerNight * this.numberOfNights,
    })),
    pricing: this.pricing,
    extras: this.extras,
    finalTotal: this.finalTotalPrice,
    generatedAt: new Date(),
  };

  return invoice;
};

// Real-time methods (preserved)
bookingSchema.methods.addActiveSession = function (userId, socketId, userRole) {
  const existingSession = this.realtimeTracking.activeSessions.find(
    (session) => session.userId.toString() === userId.toString()
  );

  if (existingSession) {
    existingSession.socketId = socketId;
    existingSession.connectedAt = new Date();
  } else {
    this.realtimeTracking.activeSessions.push({
      userId,
      socketId,
      connectedAt: new Date(),
      userRole,
    });
  }

  return this.save();
};

bookingSchema.methods.removeActiveSession = function (socketId) {
  this.realtimeTracking.activeSessions = this.realtimeTracking.activeSessions.filter(
    (session) => session.socketId !== socketId
  );

  return this.save();
};

bookingSchema.methods.markBroadcastSent = function (eventType, broadcastTo) {
  this.realtimeTracking.lastBroadcast = {
    eventType,
    broadcastAt: new Date(),
    broadcastTo,
  };

  this.liveUpdates.lastModificationBroadcast = new Date();

  return this.save();
};

bookingSchema.methods.calculateUrgencyScore = function () {
  let score = 5;

  const daysUntilCheckIn = Math.ceil((this.checkIn - new Date()) / (1000 * 60 * 60 * 24));
  if (daysUntilCheckIn <= 1) score += 3;
  else if (daysUntilCheckIn <= 3) score += 2;
  else if (daysUntilCheckIn <= 7) score += 1;

  if (this.pricing.totalPrice > 1000) score += 2;
  else if (this.pricing.totalPrice > 500) score += 1;

  if (this.rooms.length > 3) score += 1;

  if (this.user.role === 'ENTERPRISE') score += 1;

  return Math.min(score, 10);
};

bookingSchema.methods.enterValidationQueue = function (position = null) {
  this.realtimeTracking.validationQueue = {
    enteredQueueAt: new Date(),
    queuePosition: position,
    urgencyScore: this.calculateUrgencyScore(),
    assignedTo: null,
  };

  return this.save();
};

bookingSchema.methods.assignToAdmin = function (adminId) {
  if (this.realtimeTracking.validationQueue) {
    this.realtimeTracking.validationQueue.assignedTo = adminId;
  }

  return this.save();
};

bookingSchema.methods.updateAvailabilityImpact = function (roomsImpacted) {
  const affectedDates = [];
  const currentDate = new Date(this.checkIn);

  while (currentDate < this.checkOut) {
    affectedDates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  this.realtimeTracking.availabilityImpact = {
    lastCalculated: new Date(),
    affectedDates,
    roomsImpacted,
  };

  return this.save();
};

bookingSchema.methods.addPendingNotification = function (type, scheduledFor = null) {
  this.realtimeNotifications.pending.push({
    type,
    scheduledFor: scheduledFor || new Date(),
    retryCount: 0,
    lastAttempt: null,
  });

  return this.save();
};

bookingSchema.methods.markNotificationSent = function (type, sentTo) {
  this.realtimeNotifications.pending = this.realtimeNotifications.pending.filter(
    (n) => n.type !== type
  );

  this.realtimeNotifications.sent.push({
    type,
    sentAt: new Date(),
    sentTo,
  });

  return this.save();
};

bookingSchema.methods.getSocketRooms = function () {
  const rooms = [
    this.socketRooms.bookingRoom,
    this.socketRooms.hotelRoom,
    ...this.socketRooms.userRooms,
  ];

  if (this.status === 'PENDING' && !this.validation.isValidated) {
    rooms.push(this.socketRooms.adminRoom);
  }

  return rooms.filter((room) => room != null);
};

// ============================================================================
// STATIC METHODS (existing + new QR + Cache analytics)
// ============================================================================

// Existing static methods preserved
bookingSchema.statics.searchBookings = function (filters = {}) {
  const query = {};

  if (filters.hotel) query.hotel = filters.hotel;
  if (filters.user) query.user = filters.user;
  if (filters.status) query.status = filters.status;
  if (filters.source) query.source = filters.source;

  if (filters.dateFrom && filters.dateTo) {
    query.checkIn = {
      $gte: new Date(filters.dateFrom),
      $lte: new Date(filters.dateTo),
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

bookingSchema.statics.getBookingStats = function (hotelId = null, dateFrom, dateTo) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  if (dateFrom && dateTo) {
    matchStage.checkIn = {
      $gte: new Date(dateFrom),
      $lte: new Date(dateTo),
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
          $push: '$status',
        },
        bookingsBySource: {
          $push: '$source',
        },
      },
    },
  ]);
};

bookingSchema.statics.getPendingValidation = function (hotelId = null) {
  const query = {
    status: 'PENDING',
    'validation.isValidated': false,
  };

  if (hotelId) query.hotel = hotelId;

  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .sort({ createdAt: 1 });
};

bookingSchema.statics.getOccupancyRate = async function (hotelId, dateFrom, dateTo) {
  const Room = mongoose.model('Room');

  const totalRooms = await Room.countDocuments({ hotel: hotelId, isActive: true });

  const bookings = await this.find({
    hotel: hotelId,
    status: { $in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'COMPLETED'] },
    checkIn: { $lt: new Date(dateTo) },
    checkOut: { $gt: new Date(dateFrom) },
  });

  const totalRoomNights = bookings.reduce((sum, booking) => {
    return sum + booking.rooms.length * booking.numberOfNights;
  }, 0);

  const periodDays = Math.ceil((new Date(dateTo) - new Date(dateFrom)) / (1000 * 60 * 60 * 24));
  const maxPossibleRoomNights = totalRooms * periodDays;

  return {
    occupancyRate: (totalRoomNights / maxPossibleRoomNights) * 100,
    totalRoomNights,
    maxPossibleRoomNights,
    totalRooms,
    periodDays,
  };
};

// Real-time static methods (preserved)
bookingSchema.statics.getBookingsWithActiveViewers = function (hotelId = null) {
  const query = {
    'realtimeTracking.activeSessions.0': { $exists: true },
  };

  if (hotelId) query.hotel = hotelId;

  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .populate('realtimeTracking.activeSessions.userId', 'firstName lastName role');
};

bookingSchema.statics.getValidationQueue = function (hotelId = null) {
  const query = {
    status: 'PENDING',
    'validation.isValidated': false,
    'realtimeTracking.validationQueue.enteredQueueAt': { $exists: true },
  };

  if (hotelId) query.hotel = hotelId;

  return this.find(query)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code')
    .sort({
      'realtimeTracking.validationQueue.urgencyScore': -1,
      'realtimeTracking.validationQueue.enteredQueueAt': 1,
    });
};

bookingSchema.statics.getBookingsRequiringBroadcast = function (limit = 100) {
  return this.find({
    $or: [
      { 'liveUpdates.lastModificationBroadcast': null },
      {
        $expr: {
          $gt: ['$updatedAt', '$liveUpdates.lastModificationBroadcast'],
        },
      },
    ],
  })
    .limit(limit)
    .populate('user', 'firstName lastName email')
    .populate('hotel', 'name code');
};

bookingSchema.statics.getPendingNotifications = function (type = null) {
  const query = {
    'realtimeNotifications.pending.0': { $exists: true },
  };

  if (type) {
    query['realtimeNotifications.pending.type'] = type;
  }

  return this.find(query)
    .populate('user', 'firstName lastName email phone')
    .populate('hotel', 'name code');
};

bookingSchema.statics.cleanupExpiredSessions = async function (maxAge = 3600000) {
  const cutoffTime = new Date(Date.now() - maxAge);

  const result = await this.updateMany(
    {
      'realtimeTracking.activeSessions.connectedAt': { $lt: cutoffTime },
    },
    {
      $pull: {
        'realtimeTracking.activeSessions': {
          connectedAt: { $lt: cutoffTime },
        },
      },
    }
  );

  return result;
};

bookingSchema.statics.getRealtimeStats = async function (hotelId = null) {
  const matchStage = hotelId ? { hotel: mongoose.Types.ObjectId(hotelId) } : {};

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        activeViewers: {
          $sum: { $size: '$realtimeTracking.activeSessions' },
        },
        pendingValidations: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', 'PENDING'] },
                  { $eq: ['$validation.isValidated', false] },
                ],
              },
              1,
              0,
            ],
          },
        },
        inValidationQueue: {
          $sum: {
            $cond: [{ $ne: ['$realtimeTracking.validationQueue.enteredQueueAt', null] }, 1, 0],
          },
        },
        pendingNotifications: {
          $sum: { $size: '$realtimeNotifications.pending' },
        },
      },
    },
  ]);

  return (
    stats[0] || {
      totalBookings: 0,
      activeViewers: 0,
      pendingValidations: 0,
      inValidationQueue: 0,
      pendingNotifications: 0,
    }
  );
};

// ✨ NEW QR ANALYTICS STATIC METHODS ✨

// Get QR usage statistics
bookingSchema.statics.getQRUsageStats = function (hotelId = null, dateFrom, dateTo) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);
  if (dateFrom && dateTo) {
    matchStage.checkIn = {
      $gte: new Date(dateFrom),
      $lte: new Date(dateTo),
    };
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        totalQRGenerated: { $sum: '$qrTracking.performance.totalQRGenerated' },
        totalQRUsed: { $sum: '$qrTracking.performance.totalQRUsed' },
        totalCheckInAttempts: { $sum: '$qrTracking.performance.totalCheckInAttempts' },
        successfulCheckIns: { $sum: '$qrTracking.performance.successfulCheckIns' },
        avgCheckInTime: { $avg: '$qrTracking.performance.averageCheckInTime' },
        avgSuccessRate: { $avg: '$qrTracking.performance.successRate' },
      },
    },
    {
      $addFields: {
        overallUsageRate: {
          $cond: [
            { $gt: ['$totalQRGenerated', 0] },
            { $multiply: [{ $divide: ['$totalQRUsed', '$totalQRGenerated'] }, 100] },
            0,
          ],
        },
        overallSuccessRate: {
          $cond: [
            { $gt: ['$totalCheckInAttempts', 0] },
            { $multiply: [{ $divide: ['$successfulCheckIns', '$totalCheckInAttempts'] }, 100] },
            0,
          ],
        },
      },
    },
  ]);
};

// Get QR performance by type
bookingSchema.statics.getQRPerformanceByType = function (hotelId = null) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        checkInPerf: {
          $push: '$qrTracking.performance.performanceByType.CHECK_IN',
        },
        checkOutPerf: {
          $push: '$qrTracking.performance.performanceByType.CHECK_OUT',
        },
        roomAccessPerf: {
          $push: '$qrTracking.performance.performanceByType.ROOM_ACCESS',
        },
      },
    },
    {
      $project: {
        checkIn: {
          totalGenerated: { $sum: '$checkInPerf.generated' },
          totalUsed: { $sum: '$checkInPerf.used' },
          avgTime: { $avg: '$checkInPerf.avgTime' },
          avgSuccessRate: { $avg: '$checkInPerf.successRate' },
        },
        checkOut: {
          totalGenerated: { $sum: '$checkOutPerf.generated' },
          totalUsed: { $sum: '$checkOutPerf.used' },
          avgTime: { $avg: '$checkOutPerf.avgTime' },
          avgSuccessRate: { $avg: '$checkOutPerf.successRate' },
        },
        roomAccess: {
          totalGenerated: { $sum: '$roomAccessPerf.generated' },
          totalUsed: { $sum: '$roomAccessPerf.used' },
          avgTime: { $avg: '$roomAccessPerf.avgTime' },
          avgSuccessRate: { $avg: '$roomAccessPerf.successRate' },
        },
      },
    },
  ]);
};

// Get recent QR failures
bookingSchema.statics.getRecentQRFailures = function (hotelId = null, hours = 24) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  const hoursAgo = new Date(Date.now() - hours * 60 * 60 * 1000);

  return this.find(matchStage)
    .select('bookingNumber hotel user qrTracking.checkInAttempts')
    .populate('hotel', 'name code')
    .populate('user', 'firstName lastName email')
    .then((bookings) => {
      const failures = [];

      bookings.forEach((booking) => {
        if (booking.qrTracking?.checkInAttempts) {
          const recentFailures = booking.qrTracking.checkInAttempts.filter(
            (attempt) => !attempt.success && new Date(attempt.attemptAt) > hoursAgo
          );

          recentFailures.forEach((failure) => {
            failures.push({
              bookingNumber: booking.bookingNumber,
              hotel: booking.hotel,
              user: booking.user,
              attemptAt: failure.attemptAt,
              failureReason: failure.failureReason,
              processTimeMs: failure.processTimeMs,
              deviceInfo: failure.deviceInfo,
            });
          });
        }
      });

      return failures.sort((a, b) => new Date(b.attemptAt) - new Date(a.attemptAt));
    });
};

// ✨ NEW CACHE ANALYTICS STATIC METHODS ✨

// Get cache performance overview
bookingSchema.statics.getCachePerformanceOverview = function (hotelId = null) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalBookings: { $sum: 1 },
        avgHitRate: { $avg: '$cacheTracking.performance.cacheHitRate' },
        avgMissRate: { $avg: '$cacheTracking.performance.cacheMissRate' },
        avgResponseTimeWithCache: {
          $avg: '$cacheTracking.performance.averageResponseTime.withCache',
        },
        avgResponseTimeWithoutCache: {
          $avg: '$cacheTracking.performance.averageResponseTime.withoutCache',
        },
        avgImprovement: { $avg: '$cacheTracking.performance.averageResponseTime.improvement' },
        totalReads: { $sum: '$cacheTracking.performance.operations.reads.total' },
        totalHits: { $sum: '$cacheTracking.performance.operations.reads.hits' },
        totalMisses: { $sum: '$cacheTracking.performance.operations.reads.misses' },
        totalWrites: { $sum: '$cacheTracking.performance.operations.writes.total' },
        totalInvalidations: { $sum: '$cacheTracking.performance.operations.invalidations.total' },
        avgHealthScore: { $avg: '$cacheTracking.health.healthScore' },
      },
    },
    {
      $addFields: {
        overallHitRate: {
          $cond: [
            { $gt: [{ $add: ['$totalHits', '$totalMisses'] }, 0] },
            {
              $multiply: [
                { $divide: ['$totalHits', { $add: ['$totalHits', '$totalMisses'] }] },
                100,
              ],
            },
            0,
          ],
        },
        overallPerformanceImprovement: {
          $cond: [
            { $gt: ['$avgResponseTimeWithoutCache', 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ['$avgResponseTimeWithoutCache', '$avgResponseTimeWithCache'] },
                    '$avgResponseTimeWithoutCache',
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
      },
    },
  ]);
};

// Get cache health issues summary
bookingSchema.statics.getCacheHealthIssues = function (hotelId = null, severity = null) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  return this.find(matchStage)
    .select('bookingNumber hotel cacheTracking.health.issues cacheTracking.health.healthScore')
    .populate('hotel', 'name code')
    .then((bookings) => {
      const issues = [];

      bookings.forEach((booking) => {
        if (booking.cacheTracking?.health?.issues) {
          const filteredIssues = booking.cacheTracking.health.issues.filter((issue) => {
            if (severity && issue.severity !== severity) return false;
            return !issue.resolved;
          });

          filteredIssues.forEach((issue) => {
            issues.push({
              bookingNumber: booking.bookingNumber,
              hotel: booking.hotel,
              healthScore: booking.cacheTracking.health.healthScore,
              issue: {
                type: issue.type,
                severity: issue.severity,
                detectedAt: issue.detectedAt,
                description: issue.description,
              },
            });
          });
        }
      });

      return issues.sort((a, b) => {
        const severityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return severityOrder[b.issue.severity] - severityOrder[a.issue.severity];
      });
    });
};

// Get cache strategy effectiveness
bookingSchema.statics.getCacheStrategyEffectiveness = function (hotelId = null) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$cacheTracking.preferences.cacheStrategy',
        count: { $sum: 1 },
        avgHitRate: { $avg: '$cacheTracking.performance.cacheHitRate' },
        avgResponseTimeImprovement: {
          $avg: '$cacheTracking.performance.averageResponseTime.improvement',
        },
        avgHealthScore: { $avg: '$cacheTracking.health.healthScore' },
        totalOperations: {
          $sum: {
            $add: [
              '$cacheTracking.performance.operations.reads.total',
              '$cacheTracking.performance.operations.writes.total',
              '$cacheTracking.performance.operations.invalidations.total',
            ],
          },
        },
      },
    },
    {
      $addFields: {
        effectivenessScore: {
          $add: [
            { $multiply: ['$avgHitRate', 0.4] },
            { $multiply: ['$avgResponseTimeImprovement', 0.3] },
            { $multiply: ['$avgHealthScore', 0.3] },
          ],
        },
      },
    },
    { $sort: { effectivenessScore: -1 } },
  ]);
};

// Get cache invalidation patterns
bookingSchema.statics.getCacheInvalidationPatterns = function (hotelId = null, days = 7) {
  const matchStage = {};

  if (hotelId) matchStage.hotel = mongoose.Types.ObjectId(hotelId);

  const daysAgo = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  return this.aggregate([
    { $match: matchStage },
    { $unwind: '$cacheTracking.invalidations' },
    {
      $match: {
        'cacheTracking.invalidations.triggeredAt': { $gte: daysAgo },
      },
    },
    {
      $group: {
        _id: {
          action: '$cacheTracking.invalidations.triggeredBy.action',
          source: '$cacheTracking.invalidations.triggeredBy.source',
        },
        count: { $sum: 1 },
        avgInvalidationTime: {
          $avg: '$cacheTracking.invalidations.performance.totalInvalidationTime',
        },
        avgKeysInvalidated: { $avg: '$cacheTracking.invalidations.performance.keysInvalidated' },
        totalErrors: { $sum: '$cacheTracking.invalidations.performance.errorsCount' },
        totalWarnings: { $sum: '$cacheTracking.invalidations.performance.warningsCount' },
      },
    },
    { $sort: { count: -1 } },
  ]);
};

// ============================================================================
// POST-SAVE HOOKS (existing + new QR + Cache events)
// ============================================================================

// Existing post-save hook preserved
bookingSchema.post('save', async function (doc) {
  // Existing real-time events
  if (doc.liveUpdates.lastStatusBroadcast && !doc.liveUpdates.lastStatusBroadcast.broadcastAt) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:status_changed', {
        bookingId: doc._id,
        previousStatus: doc.liveUpdates.lastStatusBroadcast.previousStatus,
        newStatus: doc.liveUpdates.lastStatusBroadcast.newStatus,
        booking: doc,
      });
    });
  }

  if (doc.liveUpdates.lastPriceUpdate && !doc.liveUpdates.lastPriceUpdate.broadcastSent) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:price_updated', {
        bookingId: doc._id,
        previousPrice: doc.liveUpdates.lastPriceUpdate.previousPrice,
        newPrice: doc.liveUpdates.lastPriceUpdate.newPrice,
        booking: doc,
      });
    });
  }

  // ✨ NEW QR EVENTS ✨

  // QR generation event
  if (doc.qrTracking?.generated?.length > 0) {
    const latestQR = doc.qrTracking.generated[doc.qrTracking.generated.length - 1];
    if (latestQR && !latestQR._emitted) {
      process.nextTick(() => {
        const eventEmitter = require('events').EventEmitter;
        const emitter = new eventEmitter();
        emitter.emit('booking:qr_generated', {
          bookingId: doc._id,
          qrCodeId: latestQR.qrCodeId,
          type: latestQR.type,
          expiresAt: latestQR.expiresAt,
          booking: doc,
        });
      });

      // Mark as emitted to avoid duplicate events
      latestQR._emitted = true;
    }
  }

  // QR check-in success event
  if (doc.qrTracking?.checkInAttempts?.length > 0) {
    const latestAttempt = doc.qrTracking.checkInAttempts[doc.qrTracking.checkInAttempts.length - 1];
    if (latestAttempt && latestAttempt.success && !latestAttempt._emitted) {
      process.nextTick(() => {
        const eventEmitter = require('events').EventEmitter;
        const emitter = new eventEmitter();
        emitter.emit('booking:qr_checkin_success', {
          bookingId: doc._id,
          qrCodeId: latestAttempt.qrCodeId,
          processTime: latestAttempt.processTimeMs,
          deviceInfo: latestAttempt.deviceInfo,
          booking: doc,
        });
      });

      latestAttempt._emitted = true;
    }
  }

  // ✨ NEW CACHE EVENTS ✨

  // Cache invalidation queued
  if (doc._queueCacheInvalidation) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:cache_invalidation_needed', {
        bookingId: doc._id,
        reason: doc._queueCacheInvalidation.reason,
        modifiedPaths: doc._queueCacheInvalidation.modifiedPaths,
        booking: doc,
      });
    });

    // Clear the queue flag
    delete doc._queueCacheInvalidation;
  }

  // Cache health deterioration
  if (doc.cacheTracking?.health?.healthScore < 75 && !doc._healthAlertSent) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:cache_health_degraded', {
        bookingId: doc._id,
        healthScore: doc.cacheTracking.health.healthScore,
        issues: doc.cacheTracking.health.issues.filter((issue) => !issue.resolved),
        booking: doc,
      });
    });

    doc._healthAlertSent = true;
  }

  // Cache optimization needed
  if (doc.needsCacheOptimization && !doc._optimizationAlertSent) {
    process.nextTick(() => {
      const eventEmitter = require('events').EventEmitter;
      const emitter = new eventEmitter();
      emitter.emit('booking:cache_optimization_needed', {
        bookingId: doc._id,
        currentStrategy: doc.cacheTracking?.preferences?.cacheStrategy,
        recommendedStrategy: doc.cacheStrategyRecommendation,
        performanceScore: doc.cachePerformanceScore,
        booking: doc,
      });
    });

    doc._optimizationAlertSent = true;
  }
});

// ============================================================================
// EXPORT
// ============================================================================

const Booking = mongoose.model('Booking', bookingSchema);

module.exports = Booking;
