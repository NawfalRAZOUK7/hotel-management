const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * QR TOKEN MODEL - COMPLETE PERSISTENCE LAYER FOR QR CODES
 * Modèle complet pour la persistance des tokens QR avec tracking et sécurité
 * 
 * Fonctionnalités :
 * - Stockage sécurisé des tokens JWT
 * - Usage tracking complet
 * - Expiry management automatique
 * - Security audit trail
 * - Relations avec Booking/User/Hotel
 * - Validation et middleware
 * - Analytics et reporting
 * - Cleanup automatique
 */

// QR Types enum (sync with service)
const QR_TYPES = {
  CHECK_IN: 'check_in',
  CHECK_OUT: 'check_out',
  ROOM_ACCESS: 'room_access',
  PAYMENT: 'payment',
  MENU: 'menu',
  WIFI: 'wifi',
  FEEDBACK: 'feedback',
  EVENT: 'event',
  LOYALTY: 'loyalty',
  EMERGENCY: 'emergency'
};

// QR Status enum
const QR_STATUS = {
  ACTIVE: 'ACTIVE',
  USED: 'USED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  INVALID: 'INVALID'
};

// QR Actions enum
const QR_ACTIONS = {
  GENERATED: 'GENERATED',
  VALIDATED: 'VALIDATED',
  USED: 'USED',
  REVOKED: 'REVOKED',
  EXPIRED: 'EXPIRED',
  FAILED: 'FAILED'
};

const qrTokenSchema = new mongoose.Schema({
  // ============================================================================
  // CORE TOKEN IDENTIFICATION
  // ============================================================================
  
  // Unique token identifier (matches JWT jti claim)
  tokenId: {
    type: String,
    required: [true, 'L\'ID du token est requis'],
    unique: true,
    index: true
  },
  
  // Public identifier for tracking (user-friendly)
  identifier: {
    type: String,
    required: [true, 'L\'identifiant public est requis'],
    trim: true,
    maxlength: [100, 'L\'identifiant ne peut pas dépasser 100 caractères'],
    index: true
  },
  
  // QR code type
  type: {
    type: String,
    required: [true, 'Le type de QR code est requis'],
    enum: {
      values: Object.values(QR_TYPES),
      message: 'Type de QR code invalide'
    },
    index: true
  },
  
  // Current status
  status: {
    type: String,
    enum: {
      values: Object.values(QR_STATUS),
      message: 'Statut de QR code invalide'
    },
    default: QR_STATUS.ACTIVE,
    index: true
  },
  
  // ============================================================================
  // TOKEN DATA & PAYLOAD
  // ============================================================================
  
  // Encrypted JWT token (for security)
  encryptedToken: {
    type: String,
    required: [true, 'Le token chiffré est requis'],
    select: false // Never include in queries by default
  },
  
  // Token hash for quick validation (non-reversible)
  tokenHash: {
    type: String,
    required: [true, 'Le hash du token est requis'],
    index: true,
    select: false
  },
  
  // Original payload data (sanitized)
  payload: {
    // Core data
    type: {
      type: String,
      required: true
    },
    identifier: {
      type: String,
      required: true
    },
    
    // Type-specific data
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      sparse: true,
      index: true
    },
    
    hotelId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Hotel',
      sparse: true,
      index: true
    },
    
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      sparse: true
    },
    
    guestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      sparse: true
    },
    
    // Payment data (for payment QR codes)
    paymentData: {
      amount: {
        type: Number,
        min: [0, 'Le montant ne peut pas être négatif']
      },
      currency: {
        type: String,
        enum: ['EUR', 'USD', 'GBP', 'CHF'],
        default: 'EUR'
      },
      description: {
        type: String,
        maxlength: [200, 'Description trop longue']
      }
    },
    
    // WiFi data (for WiFi QR codes)
    wifiData: {
      networkName: String,
      networkType: {
        type: String,
        enum: ['WPA', 'WEP', 'nopass']
      },
      hidden: {
        type: Boolean,
        default: false
      }
    },
    
    // Event data (for event QR codes)
    eventData: {
      eventName: String,
      eventDate: Date,
      location: String,
      description: String
    },
    
    // Custom data (flexible field for additional data)
    customData: {
      type: mongoose.Schema.Types.Mixed,
      validate: {
        validator: function(value) {
          // Limit custom data size
          return !value || JSON.stringify(value).length <= 2000;
        },
        message: 'Données personnalisées trop volumineuses (max 2KB)'
      }
    }
  },
  
  // ============================================================================
  // SECURITY & VALIDATION
  // ============================================================================
  
  // JWT claims data
  claims: {
    issuer: {
      type: String,
      default: 'HotelManagement'
    },
    audience: {
      type: String,
      default: 'hotel-app'
    },
    subject: String,
    issuedAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    notBefore: {
      type: Date,
      default: Date.now
    }
  },
  
  // Checksum for data integrity
  checksum: {
    type: String,
    required: [true, 'Checksum requis pour l\'intégrité'],
    validate: {
      validator: function(value) {
        return /^[a-f0-9]{16}$/.test(value);
      },
      message: 'Format de checksum invalide'
    }
  },
  
  // Security metadata
  security: {
    // Generation context
    generatedFrom: {
      ipAddress: {
        type: String,
        match: [/^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^(?:[a-fA-F0-9]{1,4}:){7}[a-fA-F0-9]{1,4}$/, 'Format IP invalide']
      },
      userAgent: {
        type: String,
        maxlength: [500, 'User agent trop long']
      },
      deviceInfo: {
        platform: String,
        mobile: Boolean,
        browser: String
      },
      location: {
        country: String,
        city: String,
        timezone: String
      }
    },
    
    // Risk assessment
    riskScore: {
      type: Number,
      min: [0, 'Score de risque minimum 0'],
      max: [100, 'Score de risque maximum 100'],
      default: 0,
      index: true
    },
    
    // Fraud detection flags
    fraudFlags: [{
      type: {
        type: String,
        enum: ['SUSPICIOUS_IP', 'MULTIPLE_ATTEMPTS', 'UNUSUAL_PATTERN', 'VELOCITY_CHECK', 'LOCATION_MISMATCH']
      },
      severity: {
        type: String,
        enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
        default: 'LOW'
      },
      detectedAt: {
        type: Date,
        default: Date.now
      },
      details: String
    }],
    
    // Encryption metadata
    encryptionVersion: {
      type: String,
      default: 'AES-256-GCM-v1'
    },
    
    // Last security check
    lastSecurityCheck: {
      type: Date,
      default: Date.now
    }
  },
  
  // ============================================================================
  // USAGE TRACKING
  // ============================================================================
  
  // Usage configuration
  usageConfig: {
    maxUsage: {
      type: Number,
      required: true,
      min: [1, 'Usage maximum doit être au moins 1'],
      max: [1000, 'Usage maximum ne peut pas dépasser 1000'],
      default: 1
    },
    
    currentUsage: {
      type: Number,
      default: 0,
      min: [0, 'Usage actuel ne peut pas être négatif'],
      index: true
    },
    
    allowMultipleUsage: {
      type: Boolean,
      default: false
    },
    
    usageWindow: {
      type: Number, // Minutes
      min: [1, 'Fenêtre d\'usage minimum 1 minute'],
      max: [1440, 'Fenêtre d\'usage maximum 24 heures']
    }
  },
  
  // Detailed usage log
  usageLog: [{
    action: {
      type: String,
      enum: Object.values(QR_ACTIONS),
      required: true
    },
    
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    
    // Who performed the action
    performedBy: {
      user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      role: {
        type: String,
        enum: ['CLIENT', 'RECEPTIONIST', 'ADMIN', 'SYSTEM']
      },
      name: String,
      email: String
    },
    
    // Context of the action
    context: {
      ipAddress: String,
      userAgent: String,
      location: {
        country: String,
        city: String,
        coordinates: {
          latitude: Number,
          longitude: Number
        }
      },
      device: {
        type: String,
        platform: String,
        mobile: Boolean
      },
      
      // Hotel context (if applicable)
      hotel: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel'
      },
      hotelName: String,
      
      // Booking context (if applicable)
      booking: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'
      },
      bookingNumber: String
    },
    
    // Result of the action
    result: {
      success: {
        type: Boolean,
        required: true
      },
      
      errorCode: String,
      errorMessage: String,
      
      // Additional data from the action
      data: mongoose.Schema.Types.Mixed,
      
      // Processing time in milliseconds
      processingTime: {
        type: Number,
        min: [0, 'Temps de traitement ne peut pas être négatif']
      }
    },
    
    // Security assessment for this usage
    securityAssessment: {
      riskLevel: {
        type: String,
        enum: ['VERY_LOW', 'LOW', 'MEDIUM', 'HIGH', 'VERY_HIGH'],
        default: 'LOW'
      },
      
      anomalies: [{
        type: String,
        severity: String,
        description: String
      }],
      
      verificationsPassed: [{
        type: String,
        enum: ['IP_CHECK', 'TIME_CHECK', 'LOCATION_CHECK', 'FREQUENCY_CHECK', 'PATTERN_CHECK']
      }],
      
      verificationsFailed: [{
        type: String,
        reason: String
      }]
    }
  }],
  
  // Usage statistics (computed fields)
  usageStats: {
    firstUsed: Date,
    lastUsed: {
      type: Date,
      index: true
    },
    
    totalAttempts: {
      type: Number,
      default: 0
    },
    successfulAttempts: {
      type: Number,
      default: 0
    },
    failedAttempts: {
      type: Number,
      default: 0
    },
    
    averageProcessingTime: {
      type: Number,
      default: 0
    },
    
    uniqueUsers: {
      type: Number,
      default: 0
    },
    uniqueDevices: {
      type: Number,
      default: 0
    },
    uniqueLocations: {
      type: Number,
      default: 0
    },
    
    // Usage pattern analysis
    peakUsageHour: {
      type: Number,
      min: [0, 'Heure minimum 0'],
      max: [23, 'Heure maximum 23']
    },
    
    mostCommonLocation: String,
    mostCommonDevice: String
  },
  
  // ============================================================================
  // RELATIONS & OWNERSHIP
  // ============================================================================
  
  // Primary creator
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Créateur requis'],
    index: true
  },
  
  // Owner (can be different from creator)
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Propriétaire requis'],
    index: true
  },
  
  // Related booking (if applicable)
  relatedBooking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    sparse: true,
    index: true
  },
  
  // Related hotel (if applicable)
  relatedHotel: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    sparse: true,
    index: true
  },
  
  // Related room (if applicable)
  relatedRoom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Room',
    sparse: true
  },
  
  // Associated users (for tracking who can use this QR)
  authorizedUsers: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    role: {
      type: String,
      enum: ['PRIMARY', 'SECONDARY', 'EMERGENCY'],
      default: 'PRIMARY'
    },
    permissions: [{
      type: String,
      enum: ['READ', 'USE', 'VALIDATE', 'REVOKE']
    }],
    addedAt: {
      type: Date,
      default: Date.now
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }],
  
  // ============================================================================
  // EXPIRY & LIFECYCLE MANAGEMENT
  // ============================================================================
  
  // Expiry configuration
  expiry: {
    expiresAt: {
      type: Date,
      required: true,
      index: true
    },
    
    // Auto-extend settings
    autoExtend: {
      enabled: {
        type: Boolean,
        default: false
      },
      maxExtensions: {
        type: Number,
        default: 0,
        min: [0, 'Extensions maximum ne peut pas être négatif']
      },
      currentExtensions: {
        type: Number,
        default: 0
      },
      extendBy: {
        type: Number, // Minutes
        default: 60
      },
      conditions: [{
        type: String,
        enum: ['ON_USAGE', 'BEFORE_EXPIRY', 'ON_DEMAND']
      }]
    },
    
    // Expiry warnings
    warnings: {
      enabled: {
        type: Boolean,
        default: true
      },
      intervals: [{
        type: Number, // Minutes before expiry
        default: [60, 30, 10, 5] // 1h, 30min, 10min, 5min
      }],
      lastWarningAt: Date,
      warningsSent: {
        type: Number,
        default: 0
      }
    },
    
    // Grace period after expiry
    gracePeriod: {
      type: Number, // Minutes
      default: 0,
      min: [0, 'Période de grâce ne peut pas être négative']
    }
  },
  
  // Lifecycle events
  lifecycle: {
    generated: {
      at: {
        type: Date,
        default: Date.now,
        index: true
      },
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      method: {
        type: String,
        enum: ['WEB', 'MOBILE', 'API', 'BATCH', 'AUTO'],
        default: 'WEB'
      }
    },
    
    activated: {
      at: Date,
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    
    firstUsed: {
      at: Date,
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      context: String
    },
    
    lastUsed: {
      at: Date,
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      context: String
    },
    
    expired: {
      at: Date,
      reason: {
        type: String,
        enum: ['NATURAL_EXPIRY', 'MANUAL_EXPIRY', 'SYSTEM_EXPIRY', 'SECURITY_EXPIRY']
      },
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      }
    },
    
    revoked: {
      at: Date,
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function() {
          return this.lifecycle.revoked.at != null;
        }
      },
      reason: {
        type: String,
        required: function() {
          return this.lifecycle.revoked.at != null;
        },
        maxlength: [200, 'Raison de révocation trop longue']
      },
      category: {
        type: String,
        enum: ['SECURITY', 'MANUAL', 'AUTOMATIC', 'POLICY', 'ERROR']
      }
    },
    
    archived: {
      at: Date,
      by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      reason: String
    }
  },
  
  // ============================================================================
  // STYLING & PRESENTATION
  // ============================================================================
  
  // QR code styling used
  styling: {
    style: {
      type: String,
      enum: ['default', 'hotel', 'mobile', 'print'],
      default: 'default'
    },
    
    customizations: {
      colors: {
        foreground: {
          type: String,
          match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format couleur invalide']
        },
        background: {
          type: String,
          match: [/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, 'Format couleur invalide']
        }
      },
      
      logo: {
        enabled: Boolean,
        url: String,
        size: {
          type: Number,
          min: [10, 'Taille logo minimum 10px'],
          max: [200, 'Taille logo maximum 200px']
        }
      },
      
      branding: {
        hotelName: String,
        hotelLogo: String,
        brandColors: {
          primary: String,
          secondary: String
        }
      }
    },
    
    // Generated QR code metadata
    generated: {
      format: {
        type: String,
        enum: ['PNG', 'SVG', 'PDF'],
        default: 'PNG'
      },
      size: {
        width: Number,
        height: Number
      },
      quality: {
        type: Number,
        min: [0.1, 'Qualité minimum 0.1'],
        max: [1.0, 'Qualité maximum 1.0']
      },
      fileSize: Number, // bytes
      errorCorrectionLevel: {
        type: String,
        enum: ['L', 'M', 'Q', 'H'],
        default: 'M'
      }
    }
  },
  
  // ============================================================================
  // ANALYTICS & PERFORMANCE
  // ============================================================================
  
  // Performance metrics
  performance: {
    // Generation metrics
    generationTime: {
      type: Number, // milliseconds
      min: [0, 'Temps de génération ne peut pas être négatif']
    },
    
    // Validation metrics
    averageValidationTime: {
      type: Number,
      default: 0
    },
    
    // Usage patterns
    usagePattern: {
      type: String,
      enum: ['SINGLE_USE', 'MULTIPLE_USE', 'BURST', 'STEADY', 'IRREGULAR'],
      default: 'SINGLE_USE'
    },
    
    // Efficiency scores
    efficiencyScore: {
      type: Number,
      min: [0, 'Score efficacité minimum 0'],
      max: [100, 'Score efficacité maximum 100'],
      default: 50
    },
    
    // User satisfaction (if available)
    userSatisfaction: {
      rating: {
        type: Number,
        min: [1, 'Note minimum 1'],
        max: [5, 'Note maximum 5']
      },
      feedback: String,
      collectedAt: Date
    }
  },
  
  // Analytics data
  analytics: {
    // Scan analytics
    totalScans: {
      type: Number,
      default: 0
    },
    
    successfulScans: {
      type: Number,
      default: 0
    },
    
    failedScans: {
      type: Number,
      default: 0
    },
    
    // Geographic analytics
    scansByCountry: [{
      country: String,
      count: Number
    }],
    
    scansByCity: [{
      city: String,
      count: Number
    }],
    
    // Device analytics
    scansByDevice: [{
      device: String,
      platform: String,
      count: Number
    }],
    
    // Time-based analytics
    scansByHour: [{
      hour: {
        type: Number,
        min: 0,
        max: 23
      },
      count: Number
    }],
    
    scansByDayOfWeek: [{
      day: {
        type: Number,
        min: 0,
        max: 6
      },
      count: Number
    }],
    
    // User behavior analytics
    averageTimeToFirstScan: Number, // minutes
    averageTimeBetweenScans: Number, // minutes
    
    // Conversion analytics (if applicable)
    conversionRate: {
      type: Number,
      min: [0, 'Taux de conversion minimum 0'],
      max: [100, 'Taux de conversion maximum 100']
    },
    
    // Last analytics update
    lastAnalyticsUpdate: {
      type: Date,
      default: Date.now
    }
  },
  
  // ============================================================================
  // BATCH & CAMPAIGN MANAGEMENT
  // ============================================================================
  
  // Batch information (if generated as part of a batch)
  batch: {
    batchId: {
      type: String,
      sparse: true,
      index: true
    },
    
    batchSize: Number,
    batchPosition: Number,
    
    campaign: {
      name: String,
      description: String,
      startDate: Date,
      endDate: Date,
      targetAudience: String
    },
    
    batchMetadata: {
      generatedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      generatedAt: Date,
      purpose: String,
      notes: String
    }
  },
  
  // ============================================================================
  // COMPLIANCE & AUDIT
  // ============================================================================
  
  // Compliance data
  compliance: {
    // GDPR compliance
    gdpr: {
      dataProcessingBasis: {
        type: String,
        enum: ['CONSENT', 'CONTRACT', 'LEGAL_OBLIGATION', 'VITAL_INTERESTS', 'PUBLIC_TASK', 'LEGITIMATE_INTERESTS']
      },
      consentGiven: Boolean,
      consentDate: Date,
      dataRetentionPeriod: Number, // days
      anonymizationScheduled: Boolean,
      anonymizationDate: Date
    },
    
    // PCI DSS (for payment QR codes)
    pciDss: {
      compliant: Boolean,
      lastAudit: Date,
      auditScore: Number,
      requirements: [{
        requirement: String,
        status: {
          type: String,
          enum: ['COMPLIANT', 'NON_COMPLIANT', 'NOT_APPLICABLE']
        }
      }]
    },
    
    // Industry-specific compliance
    hotelCompliance: {
      guestDataProtection: Boolean,
      financialDataProtection: Boolean,
      accessControlCompliance: Boolean,
      auditTrailCompliance: Boolean
    }
  },
  
  // Audit trail
  auditTrail: [{
    timestamp: {
      type: Date,
      default: Date.now
    },
    
    action: {
      type: String,
      required: true
    },
    
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    
    details: {
      before: mongoose.Schema.Types.Mixed,
      after: mongoose.Schema.Types.Mixed,
      changes: [String],
      reason: String
    },
    
    metadata: {
      ipAddress: String,
      userAgent: String,
      sessionId: String,
      requestId: String
    }
  }],
  
  // ============================================================================
  // INTEGRATION & EXTERNAL SYSTEMS
  // ============================================================================
  
  // External system integrations
  integrations: {
    // Hotel management system
    pms: {
      systemName: String,
      externalId: String,
      syncStatus: {
        type: String,
        enum: ['SYNCED', 'PENDING', 'FAILED', 'NOT_SYNCED'],
        default: 'NOT_SYNCED'
      },
      lastSync: Date,
      syncErrors: [String]
    },
    
    // Payment systems
    paymentGateway: {
      provider: String,
      transactionId: String,
      status: String,
      lastUpdate: Date
    },
    
    // Access control systems
    accessControl: {
      systemName: String,
      deviceId: String,
      accessLevel: String,
      lastAccess: Date
    },
    
    // Analytics platforms
    analytics: {
      googleAnalytics: {
        trackingId: String,
        eventCategory: String,
        eventAction: String
      },
      customAnalytics: [{
        platform: String,
        trackingId: String,
        metadata: mongoose.Schema.Types.Mixed
      }]
    }
  },
  
  // ============================================================================
  // METADATA & SYSTEM FIELDS
  // ============================================================================
  
  // Version for schema migrations
  schemaVersion: {
    type: String,
    default: '1.0.0'
  },
  
  // Soft delete
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deletionReason: String,
  
  // Archive status
  isArchived: {
    type: Boolean,
    default: false,
    index: true
  },
  
  archivedAt: Date,
  archivedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // System tags for categorization
  tags: [{
    type: String,
    trim: true,
    maxlength: [50, 'Tag trop long']
  }],
  
  // Custom metadata
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    validate: {
      validator: function(value) {
        return !value || JSON.stringify(value).length <= 5000;
      },
      message: 'Métadonnées trop volumineuses (max 5KB)'
    }
  },
  
  // System notes
  systemNotes: [{
    note: String,
    addedAt: {
      type: Date,
      default: Date.now
    },
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    category: {
      type: String,
      enum: ['INFO', 'WARNING', 'ERROR', 'SECURITY', 'MAINTENANCE']
    }
  }]

}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      // Remove sensitive fields from JSON output
      delete ret.encryptedToken;
      delete ret.tokenHash;
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Core indexes
qrTokenSchema.index({ tokenId: 1 }, { unique: true });
qrTokenSchema.index({ identifier: 1 });
qrTokenSchema.index({ type: 1, status: 1 });
qrTokenSchema.index({ 'claims.expiresAt': 1 });
qrTokenSchema.index({ 'claims.issuedAt': -1 });

// Relationship indexes
qrTokenSchema.index({ createdBy: 1, 'claims.issuedAt': -1 });
qrTokenSchema.index({ owner: 1 });
qrTokenSchema.index({ relatedBooking: 1 });
qrTokenSchema.index({ relatedHotel: 1 });

// Usage tracking indexes
qrTokenSchema.index({ 'usageConfig.currentUsage': 1 });
qrTokenSchema.index({ 'usageStats.lastUsed': -1 });

// Security indexes
qrTokenSchema.index({ 'security.riskScore': -1 });
qrTokenSchema.index({ tokenHash: 1 });

// Batch indexes
qrTokenSchema.index({ 'batch.batchId': 1 });

// Cleanup indexes
qrTokenSchema.index({ isDeleted: 1, deletedAt: 1 });
qrTokenSchema.index({ isArchived: 1, archivedAt: 1 });

// TTL index for automatic cleanup of expired tokens
qrTokenSchema.index(
  { 'claims.expiresAt': 1 }, 
  { 
    expireAfterSeconds: 7 * 24 * 60 * 60, // 7 days after expiry
    partialFilterExpression: { 
      status: { $in: ['EXPIRED', 'USED'] },
      isArchived: false 
    }
  }
);

// Compound indexes for complex queries
qrTokenSchema.index({ type: 1, status: 1, 'claims.expiresAt': 1 });
qrTokenSchema.index({ createdBy: 1, type: 1, status: 1 });
qrTokenSchema.index({ relatedHotel: 1, type: 1, 'claims.issuedAt': -1 });

// ============================================================================
// VIRTUALS
// ============================================================================

// Check if token is expired
qrTokenSchema.virtual('isExpired').get(function() {
  return new Date() > this.claims.expiresAt;
});

// Check if token is active
qrTokenSchema.virtual('isActive').get(function() {
  return this.status === QR_STATUS.ACTIVE && !this.isExpired;
});

// Check if token is usable
qrTokenSchema.virtual('isUsable').get(function() {
  return this.isActive && 
         this.usageConfig.currentUsage < this.usageConfig.maxUsage &&
         new Date() >= this.claims.notBefore;
});

// Remaining usage count
qrTokenSchema.virtual('remainingUsage').get(function() {
  return Math.max(0, this.usageConfig.maxUsage - this.usageConfig.currentUsage);
});

// Usage percentage
qrTokenSchema.virtual('usagePercentage').get(function() {
  return this.usageConfig.maxUsage > 0 
    ? Math.round((this.usageConfig.currentUsage / this.usageConfig.maxUsage) * 100)
    : 0;
});

// Time until expiry
qrTokenSchema.virtual('timeUntilExpiry').get(function() {
  const now = new Date();
  const expiry = this.claims.expiresAt;
  return expiry > now ? expiry - now : 0; // milliseconds
});

// Success rate
qrTokenSchema.virtual('successRate').get(function() {
  const total = this.usageStats.totalAttempts;
  return total > 0 
    ? Math.round((this.usageStats.successfulAttempts / total) * 100)
    : 0;
});

// Security status
qrTokenSchema.virtual('securityStatus').get(function() {
  const riskScore = this.security.riskScore;
  if (riskScore >= 80) return 'HIGH_RISK';
  if (riskScore >= 60) return 'MEDIUM_RISK';
  if (riskScore >= 40) return 'LOW_RISK';
  return 'SECURE';
});

// Display name for UI
qrTokenSchema.virtual('displayName').get(function() {
  switch (this.type) {
    case QR_TYPES.CHECK_IN:
      return `Check-in - ${this.identifier}`;
    case QR_TYPES.CHECK_OUT:
      return `Check-out - ${this.identifier}`;
    case QR_TYPES.PAYMENT:
      return `Paiement ${this.payload.paymentData?.amount || ''}€ - ${this.identifier}`;
    case QR_TYPES.ROOM_ACCESS:
      return `Accès chambre - ${this.identifier}`;
    default:
      return `${this.type} - ${this.identifier}`;
  }
});

// Virtual relationships
qrTokenSchema.virtual('usageHistory', {
  ref: 'QRUsage',
  localField: '_id',
  foreignField: 'qrToken'
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Pre-save middleware
qrTokenSchema.pre('save', async function(next) {
  try {
    // Generate token ID if new
    if (this.isNew && !this.tokenId) {
      this.tokenId = crypto.randomUUID();
    }
    
    // Calculate checksum
    if (this.isModified('payload') || this.isNew) {
      this.checksum = this.calculateChecksum();
    }
    
    // Update security risk score
    if (this.isModified('usageLog') || this.isModified('security.fraudFlags')) {
      this.security.riskScore = this.calculateRiskScore();
    }
    
    // Update usage statistics
    if (this.isModified('usageLog')) {
      this.updateUsageStats();
    }
    
    // Auto-update status based on conditions
    this.updateStatus();
    
    // Validate expiry
    if (this.claims.expiresAt <= this.claims.issuedAt) {
      return next(new Error('La date d\'expiration doit être postérieure à la date de création'));
    }
    
    // Validate usage configuration
    if (this.usageConfig.currentUsage > this.usageConfig.maxUsage) {
      return next(new Error('L\'usage actuel ne peut pas dépasser l\'usage maximum'));
    }
    
    // Encrypt token if provided and not already encrypted
    if (this.isModified('encryptedToken') && this.encryptedToken && !this.encryptedToken.startsWith('enc:')) {
      this.encryptedToken = this.encryptToken(this.encryptedToken);
    }
    
    // Generate token hash
    if (this.isModified('encryptedToken') || this.isNew) {
      this.tokenHash = this.generateTokenHash();
    }
    
    next();
  } catch (error) {
    next(error);
  }
});

// Pre-save middleware for audit trail
qrTokenSchema.pre('save', function(next) {
  // Add audit trail entry for modifications
  if (!this.isNew && this.isModified()) {
    const changes = [];
    this.modifiedPaths().forEach(path => {
      if (!path.startsWith('auditTrail') && !path.startsWith('updatedAt')) {
        changes.push(path);
      }
    });
    
    if (changes.length > 0) {
      this.auditTrail.push({
        action: 'MODIFIED',
        actor: this.constructor.currentUser || null,
        details: {
          changes: changes,
          reason: 'Automatic modification tracking'
        },
        metadata: {
          modifiedPaths: changes.length
        }
      });
    }
  }
  
  next();
});

// Post-save middleware for real-time notifications
qrTokenSchema.post('save', async function(doc) {
  try {
    // Emit events for status changes
    if (doc.isModified('status')) {
      const eventType = `QR_STATUS_${doc.status}`;
      process.nextTick(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        emitter.emit('qr:status_changed', {
          tokenId: doc.tokenId,
          identifier: doc.identifier,
          oldStatus: doc.constructor.previousStatus,
          newStatus: doc.status,
          qrToken: doc
        });
      });
    }
    
    // Emit usage events
    if (doc.isModified('usageConfig.currentUsage')) {
      process.nextTick(() => {
        const EventEmitter = require('events');
        const emitter = new EventEmitter();
        emitter.emit('qr:usage_updated', {
          tokenId: doc.tokenId,
          identifier: doc.identifier,
          currentUsage: doc.usageConfig.currentUsage,
          maxUsage: doc.usageConfig.maxUsage,
          qrToken: doc
        });
      });
    }
    
  } catch (error) {
    console.error('Post-save QR token event error:', error);
  }
});

// ============================================================================
// INSTANCE METHODS
// ============================================================================

// Calculate data integrity checksum
qrTokenSchema.methods.calculateChecksum = function() {
  const data = {
    type: this.type,
    identifier: this.identifier,
    payload: this.payload,
    claims: {
      issuer: this.claims.issuer,
      audience: this.claims.audience,
      issuedAt: this.claims.issuedAt,
      expiresAt: this.claims.expiresAt
    }
  };
  
  const dataString = JSON.stringify(data, Object.keys(data).sort());
  return crypto.createHash('sha256').update(dataString).digest('hex').substring(0, 16);
};

// Validate checksum integrity
qrTokenSchema.methods.validateChecksum = function() {
  return this.checksum === this.calculateChecksum();
};

// Calculate security risk score
qrTokenSchema.methods.calculateRiskScore = function() {
  let riskScore = 0;
  
  // Base risk factors
  const now = new Date();
  const ageHours = (now - this.claims.issuedAt) / (1000 * 60 * 60);
  
  // Age factor
  if (ageHours > 24) riskScore += 10;
  if (ageHours > 168) riskScore += 20; // 1 week
  
  // Usage pattern factor
  const usageRate = this.usageConfig.currentUsage / this.usageConfig.maxUsage;
  if (usageRate > 0.8) riskScore += 15;
  
  // Failed attempts factor
  const failureRate = this.usageStats.totalAttempts > 0 
    ? this.usageStats.failedAttempts / this.usageStats.totalAttempts 
    : 0;
  riskScore += failureRate * 30;
  
  // Fraud flags factor
  const fraudFlagScore = this.security.fraudFlags.reduce((score, flag) => {
    switch (flag.severity) {
      case 'LOW': return score + 5;
      case 'MEDIUM': return score + 15;
      case 'HIGH': return score + 30;
      case 'CRITICAL': return score + 50;
      default: return score;
    }
  }, 0);
  riskScore += fraudFlagScore;
  
  // Multiple device usage (suspicious pattern)
  if (this.usageStats.uniqueDevices > 3) riskScore += 20;
  
  // Unusual location pattern
  if (this.usageStats.uniqueLocations > 5) riskScore += 15;
  
  return Math.min(100, Math.max(0, Math.round(riskScore)));
};

// Update usage statistics
qrTokenSchema.methods.updateUsageStats = function() {
  const usageEntries = this.usageLog;
  
  if (usageEntries.length === 0) return;
  
  // Basic stats
  this.usageStats.totalAttempts = usageEntries.length;
  this.usageStats.successfulAttempts = usageEntries.filter(entry => entry.result.success).length;
  this.usageStats.failedAttempts = this.usageStats.totalAttempts - this.usageStats.successfulAttempts;
  
  // Time stats
  const sortedEntries = usageEntries.sort((a, b) => a.timestamp - b.timestamp);
  this.usageStats.firstUsed = sortedEntries[0].timestamp;
  this.usageStats.lastUsed = sortedEntries[sortedEntries.length - 1].timestamp;
  
  // Processing time average
  const processingTimes = usageEntries
    .filter(entry => entry.result.processingTime)
    .map(entry => entry.result.processingTime);
  
  if (processingTimes.length > 0) {
    this.usageStats.averageProcessingTime = Math.round(
      processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
    );
  }
  
  // Unique counters
  const uniqueUserIds = new Set();
  const uniqueDevices = new Set();
  const uniqueLocations = new Set();
  const hourUsage = new Array(24).fill(0);
  
  usageEntries.forEach(entry => {
    if (entry.performedBy.user) uniqueUserIds.add(entry.performedBy.user.toString());
    if (entry.context.device?.type) uniqueDevices.add(entry.context.device.type);
    if (entry.context.location?.city) uniqueLocations.add(entry.context.location.city);
    
    const hour = entry.timestamp.getHours();
    hourUsage[hour]++;
  });
  
  this.usageStats.uniqueUsers = uniqueUserIds.size;
  this.usageStats.uniqueDevices = uniqueDevices.size;
  this.usageStats.uniqueLocations = uniqueLocations.size;
  
  // Peak usage hour
  const maxUsageHour = hourUsage.indexOf(Math.max(...hourUsage));
  this.usageStats.peakUsageHour = maxUsageHour;
  
  // Most common patterns
  if (uniqueLocations.size > 0) {
    const locationCounts = {};
    usageEntries.forEach(entry => {
      const city = entry.context.location?.city;
      if (city) locationCounts[city] = (locationCounts[city] || 0) + 1;
    });
    this.usageStats.mostCommonLocation = Object.keys(locationCounts)
      .reduce((a, b) => locationCounts[a] > locationCounts[b] ? a : b);
  }
  
  if (uniqueDevices.size > 0) {
    const deviceCounts = {};
    usageEntries.forEach(entry => {
      const device = entry.context.device?.type;
      if (device) deviceCounts[device] = (deviceCounts[device] || 0) + 1;
    });
    this.usageStats.mostCommonDevice = Object.keys(deviceCounts)
      .reduce((a, b) => deviceCounts[a] > deviceCounts[b] ? a : b);
  }
};

// Update status based on current conditions
qrTokenSchema.methods.updateStatus = function() {
  const now = new Date();
  
  // Check if expired
  if (now > this.claims.expiresAt) {
    if (this.status !== QR_STATUS.EXPIRED) {
      this.status = QR_STATUS.EXPIRED;
      this.lifecycle.expired = {
        at: now,
        reason: 'NATURAL_EXPIRY'
      };
    }
    return;
  }
  
  // Check if revoked
  if (this.lifecycle.revoked.at) {
    this.status = QR_STATUS.REVOKED;
    return;
  }
  
  // Check if usage limit reached
  if (this.usageConfig.currentUsage >= this.usageConfig.maxUsage) {
    this.status = QR_STATUS.USED;
    return;
  }
  
  // Check if not yet valid
  if (now < this.claims.notBefore) {
    // Keep current status but don't allow usage
    return;
  }
  
  // Should be active
  if (this.status === QR_STATUS.EXPIRED || this.status === QR_STATUS.INVALID) {
    this.status = QR_STATUS.ACTIVE;
  }
};

// Record usage attempt
qrTokenSchema.methods.recordUsage = function(action, performedBy, context = {}, result = {}) {
  const usageEntry = {
    action,
    timestamp: new Date(),
    performedBy: {
      user: performedBy.user || performedBy._id || performedBy,
      role: performedBy.role || 'UNKNOWN',
      name: performedBy.name || `${performedBy.firstName || ''} ${performedBy.lastName || ''}`.trim(),
      email: performedBy.email
    },
    context: {
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      location: context.location,
      device: context.device,
      hotel: context.hotel,
      hotelName: context.hotelName,
      booking: context.booking,
      bookingNumber: context.bookingNumber
    },
    result: {
      success: result.success !== false,
      errorCode: result.errorCode,
      errorMessage: result.errorMessage,
      data: result.data,
      processingTime: result.processingTime
    },
    securityAssessment: this.assessSecurityForUsage(context, result)
  };
  
  this.usageLog.push(usageEntry);
  
  // Update usage count if successful
  if (usageEntry.result.success) {
    this.usageConfig.currentUsage += 1;
    
    // Record lifecycle events
    if (!this.lifecycle.firstUsed.at) {
      this.lifecycle.firstUsed = {
        at: usageEntry.timestamp,
        by: usageEntry.performedBy.user,
        context: action
      };
    }
    
    this.lifecycle.lastUsed = {
      at: usageEntry.timestamp,
      by: usageEntry.performedBy.user,
      context: action
    };
  }
  
  return usageEntry;
};

// Assess security for a usage attempt
qrTokenSchema.methods.assessSecurityForUsage = function(context, result) {
  const assessment = {
    riskLevel: 'LOW',
    anomalies: [],
    verificationsPassed: [],
    verificationsFailed: []
  };
  
  // IP address verification
  if (context.ipAddress) {
    if (this.security.generatedFrom.ipAddress && 
        context.ipAddress !== this.security.generatedFrom.ipAddress) {
      assessment.anomalies.push({
        type: 'IP_MISMATCH',
        severity: 'MEDIUM',
        description: 'IP address differs from generation IP'
      });
      assessment.verificationsFailed.push({
        type: 'IP_CHECK',
        reason: 'Different IP address'
      });
    } else {
      assessment.verificationsPassed.push('IP_CHECK');
    }
  }
  
  // Time-based verification
  const now = new Date();
  const timeSinceGeneration = now - this.claims.issuedAt;
  const hoursOld = timeSinceGeneration / (1000 * 60 * 60);
  
  if (hoursOld > 24) {
    assessment.anomalies.push({
      type: 'OLD_TOKEN',
      severity: 'LOW',
      description: `Token is ${Math.round(hoursOld)} hours old`
    });
  } else {
    assessment.verificationsPassed.push('TIME_CHECK');
  }
  
  // Location verification
  if (context.location?.country && this.security.generatedFrom.location?.country) {
    if (context.location.country !== this.security.generatedFrom.location.country) {
      assessment.anomalies.push({
        type: 'LOCATION_MISMATCH',
        severity: 'HIGH',
        description: 'Usage from different country than generation'
      });
      assessment.verificationsFailed.push({
        type: 'LOCATION_CHECK',
        reason: 'Different country'
      });
    } else {
      assessment.verificationsPassed.push('LOCATION_CHECK');
    }
  }
  
  // Frequency verification
  const recentUsages = this.usageLog.filter(entry => 
    (now - entry.timestamp) < 60000 // Last minute
  );
  
  if (recentUsages.length > 5) {
    assessment.anomalies.push({
      type: 'HIGH_FREQUENCY',
      severity: 'HIGH',
      description: 'Too many attempts in short period'
    });
    assessment.verificationsFailed.push({
      type: 'FREQUENCY_CHECK',
      reason: 'High frequency usage'
    });
  } else {
    assessment.verificationsPassed.push('FREQUENCY_CHECK');
  }
  
  // Pattern verification
  const uniqueIPs = new Set(this.usageLog.map(entry => entry.context.ipAddress).filter(Boolean));
  if (uniqueIPs.size > 3) {
    assessment.anomalies.push({
      type: 'MULTIPLE_IPS',
      severity: 'MEDIUM',
      description: 'Usage from multiple IP addresses'
    });
  } else {
    assessment.verificationsPassed.push('PATTERN_CHECK');
  }
  
  // Determine overall risk level
  const highSeverityAnomalies = assessment.anomalies.filter(a => a.severity === 'HIGH');
  const mediumSeverityAnomalies = assessment.anomalies.filter(a => a.severity === 'MEDIUM');
  
  if (highSeverityAnomalies.length > 0 || mediumSeverityAnomalies.length > 2) {
    assessment.riskLevel = 'HIGH';
  } else if (mediumSeverityAnomalies.length > 0 || assessment.anomalies.length > 2) {
    assessment.riskLevel = 'MEDIUM';
  }
  
  return assessment;
};

// Encrypt token
qrTokenSchema.methods.encryptToken = function(token) {
  try {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.QR_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = crypto.randomBytes(16);
    
    const cipher = crypto.createCipher(algorithm, key);
    cipher.setAAD(Buffer.from(this.tokenId));
    
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    return `enc:${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`;
  } catch (error) {
    throw new Error('Token encryption failed');
  }
};

// Decrypt token
qrTokenSchema.methods.decryptToken = function() {
  try {
    if (!this.encryptedToken || !this.encryptedToken.startsWith('enc:')) {
      throw new Error('No encrypted token available');
    }
    
    const [prefix, ivHex, encrypted, authTagHex] = this.encryptedToken.split(':');
    
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(process.env.QR_ENCRYPTION_KEY || 'default-key', 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAAD(Buffer.from(this.tokenId));
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    throw new Error('Token decryption failed');
  }
};

// Generate token hash for quick validation
qrTokenSchema.methods.generateTokenHash = function() {
  const tokenData = this.encryptedToken || '';
  return crypto.createHash('sha256')
    .update(tokenData + this.tokenId)
    .digest('hex')
    .substring(0, 32);
};

// Extend expiration
qrTokenSchema.methods.extend = function(additionalMinutes, extendedBy, reason = 'Manual extension') {
  if (!this.expiry.autoExtend.enabled) {
    throw new Error('Auto-extension not enabled for this token');
  }
  
  if (this.expiry.autoExtend.currentExtensions >= this.expiry.autoExtend.maxExtensions) {
    throw new Error('Maximum extensions reached');
  }
  
  const newExpiry = new Date(this.claims.expiresAt.getTime() + (additionalMinutes * 60 * 1000));
  const oldExpiry = this.claims.expiresAt;
  
  this.claims.expiresAt = newExpiry;
  this.expiry.expiresAt = newExpiry;
  this.expiry.autoExtend.currentExtensions += 1;
  
  // Add audit entry
  this.auditTrail.push({
    action: 'EXTENDED',
    actor: extendedBy,
    details: {
      before: oldExpiry,
      after: newExpiry,
      changes: ['claims.expiresAt', 'expiry.expiresAt'],
      reason: reason,
      additionalMinutes: additionalMinutes
    }
  });
  
  return this.save();
};

// Revoke token
qrTokenSchema.methods.revoke = function(revokedBy, reason, category = 'MANUAL') {
  if (this.status === QR_STATUS.REVOKED) {
    throw new Error('Token already revoked');
  }
  
  const now = new Date();
  
  this.status = QR_STATUS.REVOKED;
  this.lifecycle.revoked = {
    at: now,
    by: revokedBy,
    reason: reason,
    category: category
  };
  
  // Add audit entry
  this.auditTrail.push({
    action: 'REVOKED',
    actor: revokedBy,
    details: {
      reason: reason,
      category: category,
      changes: ['status', 'lifecycle.revoked']
    }
  });
  
  return this.save();
};

// Archive token
qrTokenSchema.methods.archive = function(archivedBy, reason = 'Manual archiving') {
  this.isArchived = true;
  this.archivedAt = new Date();
  this.archivedBy = archivedBy;
  
  this.auditTrail.push({
    action: 'ARCHIVED',
    actor: archivedBy,
    details: {
      reason: reason,
      changes: ['isArchived', 'archivedAt', 'archivedBy']
    }
  });
  
  return this.save();
};

// Soft delete token
qrTokenSchema.methods.softDelete = function(deletedBy, reason = 'Manual deletion') {
  this.isDeleted = true;
  this.deletedAt = new Date();
  this.deletedBy = deletedBy;
  this.deletionReason = reason;
  
  this.auditTrail.push({
    action: 'DELETED',
    actor: deletedBy,
    details: {
      reason: reason,
      changes: ['isDeleted', 'deletedAt', 'deletedBy', 'deletionReason']
    }
  });
  
  return this.save();
};

// Update analytics
qrTokenSchema.methods.updateAnalytics = function() {
  const usageLog = this.usageLog;
  
  // Basic analytics
  this.analytics.totalScans = usageLog.length;
  this.analytics.successfulScans = usageLog.filter(entry => entry.result.success).length;
  this.analytics.failedScans = this.analytics.totalScans - this.analytics.successfulScans;
  
  // Geographic analytics
  const countryCounts = {};
  const cityCounts = {};
  
  usageLog.forEach(entry => {
    const country = entry.context.location?.country;
    const city = entry.context.location?.city;
    
    if (country) countryCounts[country] = (countryCounts[country] || 0) + 1;
    if (city) cityCounts[city] = (cityCounts[city] || 0) + 1;
  });
  
  this.analytics.scansByCountry = Object.entries(countryCounts)
    .map(([country, count]) => ({ country, count }))
    .sort((a, b) => b.count - a.count);
    
  this.analytics.scansByCity = Object.entries(cityCounts)
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count);
  
  // Device analytics
  const deviceCounts = {};
  
  usageLog.forEach(entry => {
    const device = entry.context.device?.type;
    const platform = entry.context.device?.platform;
    
    if (device) {
      const key = platform ? `${device} (${platform})` : device;
      deviceCounts[key] = (deviceCounts[key] || 0) + 1;
    }
  });
  
  this.analytics.scansByDevice = Object.entries(deviceCounts)
    .map(([device, count]) => {
      const [type, platform] = device.split(' (');
      return { 
        device: type, 
        platform: platform?.replace(')', '') || null, 
        count 
      };
    })
    .sort((a, b) => b.count - a.count);
  
  // Time-based analytics
  const hourCounts = new Array(24).fill(0);
  const dayOfWeekCounts = new Array(7).fill(0);
  
  usageLog.forEach(entry => {
    const date = new Date(entry.timestamp);
    hourCounts[date.getHours()]++;
    dayOfWeekCounts[date.getDay()]++;
  });
  
  this.analytics.scansByHour = hourCounts.map((count, hour) => ({ hour, count }));
  this.analytics.scansByDayOfWeek = dayOfWeekCounts.map((count, day) => ({ day, count }));
  
  // Timing analytics
  if (usageLog.length > 1) {
    const sortedLog = usageLog.sort((a, b) => a.timestamp - b.timestamp);
    const firstScan = sortedLog[0].timestamp;
    const timesToFirstScan = (firstScan - this.claims.issuedAt) / (1000 * 60); // minutes
    
    this.analytics.averageTimeToFirstScan = timesToFirstScan;
    
    // Calculate average time between scans
    let totalTimeBetween = 0;
    for (let i = 1; i < sortedLog.length; i++) {
      totalTimeBetween += (sortedLog[i].timestamp - sortedLog[i-1].timestamp) / (1000 * 60);
    }
    this.analytics.averageTimeBetweenScans = totalTimeBetween / (sortedLog.length - 1);
  }
  
  // Conversion rate (successful scans / total scans)
  this.analytics.conversionRate = this.analytics.totalScans > 0 
    ? Math.round((this.analytics.successfulScans / this.analytics.totalScans) * 100)
    : 0;
  
  this.analytics.lastAnalyticsUpdate = new Date();
  
  return this.save({ validateBeforeSave: false });
};

// Generate comprehensive report
qrTokenSchema.methods.generateReport = function() {
  return {
    // Basic info
    token: {
      id: this.tokenId,
      identifier: this.identifier,
      type: this.type,
      status: this.status,
      displayName: this.displayName
    },
    
    // Validity info
    validity: {
      isActive: this.isActive,
      isUsable: this.isUsable,
      isExpired: this.isExpired,
      expiresAt: this.claims.expiresAt,
      timeUntilExpiry: this.timeUntilExpiry
    },
    
    // Usage info
    usage: {
      current: this.usageConfig.currentUsage,
      maximum: this.usageConfig.maxUsage,
      remaining: this.remainingUsage,
      percentage: this.usagePercentage,
      successRate: this.successRate
    },
    
    // Security info
    security: {
      riskScore: this.security.riskScore,
      securityStatus: this.securityStatus,
      fraudFlags: this.security.fraudFlags.length,
      integrityValid: this.validateChecksum()
    },
    
    // Statistics
    statistics: this.usageStats,
    
    // Analytics summary
    analytics: {
      totalScans: this.analytics.totalScans,
      successfulScans: this.analytics.successfulScans,
      conversionRate: this.analytics.conversionRate,
      topCountry: this.analytics.scansByCountry[0]?.country || null,
      topDevice: this.analytics.scansByDevice[0]?.device || null
    },
    
    // Recent activity
    recentActivity: this.usageLog.slice(-5).map(entry => ({
      action: entry.action,
      timestamp: entry.timestamp,
      success: entry.result.success,
      performer: entry.performedBy.name || entry.performedBy.email,
      location: entry.context.location?.city || null
    }))
  };
};

// ============================================================================
// STATIC METHODS
// ============================================================================

// Find by token ID
qrTokenSchema.statics.findByTokenId = function(tokenId) {
  return this.findOne({ 
    tokenId: tokenId,
    isDeleted: false 
  });
};

// Find active tokens
qrTokenSchema.statics.findActive = function(filters = {}) {
  const query = {
    status: QR_STATUS.ACTIVE,
    isDeleted: false,
    'claims.expiresAt': { $gt: new Date() },
    ...filters
  };
  
  return this.find(query).sort({ 'claims.issuedAt': -1 });
};

// Find tokens by user
qrTokenSchema.statics.findByUser = function(userId, includeExpired = false) {
  const query = {
    $or: [
      { createdBy: userId },
      { owner: userId },
      { 'authorizedUsers.user': userId }
    ],
    isDeleted: false
  };
  
  if (!includeExpired) {
    query['claims.expiresAt'] = { $gt: new Date() };
  }
  
  return this.find(query).sort({ 'claims.issuedAt': -1 });
};

// Find tokens by booking
qrTokenSchema.statics.findByBooking = function(bookingId) {
  return this.find({
    relatedBooking: bookingId,
    isDeleted: false
  }).sort({ 'claims.issuedAt': -1 });
};

// Find tokens by hotel
qrTokenSchema.statics.findByHotel = function(hotelId, type = null) {
  const query = {
    relatedHotel: hotelId,
    isDeleted: false
  };
  
  if (type) {
    query.type = type;
  }
  
  return this.find(query).sort({ 'claims.issuedAt': -1 });
};

// Find expiring tokens
qrTokenSchema.statics.findExpiring = function(minutesFromNow = 60) {
  const expiryThreshold = new Date(Date.now() + minutesFromNow * 60 * 1000);
  
  return this.find({
    status: QR_STATUS.ACTIVE,
    'claims.expiresAt': { $lt: expiryThreshold, $gt: new Date() },
    'expiry.warnings.enabled': true,
    isDeleted: false
  });
};

// Find high-risk tokens
qrTokenSchema.statics.findHighRisk = function(minRiskScore = 70) {
  return this.find({
    'security.riskScore': { $gte: minRiskScore },
    status: { $in: [QR_STATUS.ACTIVE, QR_STATUS.USED] },
    isDeleted: false
  }).sort({ 'security.riskScore': -1 });
};

// Cleanup expired tokens
qrTokenSchema.statics.cleanupExpired = async function(daysOld = 7) {
  const cutoffDate = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  
  const result = await this.updateMany(
    {
      status: { $in: [QR_STATUS.EXPIRED, QR_STATUS.USED] },
      'claims.expiresAt': { $lt: cutoffDate },
      isArchived: false,
      isDeleted: false
    },
    {
      $set: {
        isArchived: true,
        archivedAt: new Date(),
        archivedBy: null // System archiving
      },
      $push: {
        auditTrail: {
          action: 'AUTO_ARCHIVED',
          actor: null,
          details: {
            reason: `Automatic archiving after ${daysOld} days`,
            changes: ['isArchived', 'archivedAt']
          },
          metadata: {
            systemAction: true,
            cutoffDate: cutoffDate
          }
        }
      }
    }
  );
  
  return result;
};

// Get usage statistics
qrTokenSchema.statics.getUsageStats = function(filters = {}) {
  const matchStage = {
    isDeleted: false,
    ...filters
  };
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalTokens: { $sum: 1 },
        activeTokens: {
          $sum: {
            $cond: [{ $eq: ['$status', QR_STATUS.ACTIVE] }, 1, 0]
          }
        },
        expiredTokens: {
          $sum: {
            $cond: [{ $eq: ['$status', QR_STATUS.EXPIRED] }, 1, 0]
          }
        },
        usedTokens: {
          $sum: {
            $cond: [{ $eq: ['$status', QR_STATUS.USED] }, 1, 0]
          }
        },
        revokedTokens: {
          $sum: {
            $cond: [{ $eq: ['$status', QR_STATUS.REVOKED] }, 1, 0]
          }
        },
        totalUsageAttempts: { $sum: '$usageStats.totalAttempts' },
        totalSuccessfulUsage: { $sum: '$usageStats.successfulAttempts' },
        averageRiskScore: { $avg: '$security.riskScore' },
        highRiskTokens: {
          $sum: {
            $cond: [{ $gte: ['$security.riskScore', 70] }, 1, 0]
          }
        }
      }
    }
  ]);
};

// Get type statistics
qrTokenSchema.statics.getTypeStats = function(dateRange = null) {
  const matchStage = { isDeleted: false };
  
  if (dateRange) {
    matchStage['claims.issuedAt'] = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        active: {
          $sum: {
            $cond: [{ $eq: ['$status', QR_STATUS.ACTIVE] }, 1, 0]
          }
        },
        totalUsage: { $sum: '$usageConfig.currentUsage' },
        averageRiskScore: { $avg: '$security.riskScore' }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

// Get performance metrics
qrTokenSchema.statics.getPerformanceMetrics = function(hotelId = null) {
  const matchStage = { isDeleted: false };
  
  if (hotelId) {
    matchStage.relatedHotel = hotelId;
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        averageGenerationTime: { $avg: '$performance.generationTime' },
        averageValidationTime: { $avg: '$performance.averageValidationTime' },
        averageEfficiencyScore: { $avg: '$performance.efficiencyScore' },
        totalTokensGenerated: { $sum: 1 },
        tokensWithFeedback: {
          $sum: {
            $cond: [{ $ne: ['$performance.userSatisfaction.rating', null] }, 1, 0]
          }
        },
        averageUserSatisfaction: { $avg: '$performance.userSatisfaction.rating' }
      }
    }
  ]);
};

// Batch operations
qrTokenSchema.statics.batchRevoke = async function(tokenIds, revokedBy, reason) {
  const result = await this.updateMany(
    {
      tokenId: { $in: tokenIds },
      status: { $ne: QR_STATUS.REVOKED },
      isDeleted: false
    },
    {
      $set: {
        status: QR_STATUS.REVOKED,
        'lifecycle.revoked': {
          at: new Date(),
          by: revokedBy,
          reason: reason,
          category: 'BATCH'
        }
      },
      $push: {
        auditTrail: {
          action: 'BATCH_REVOKED',
          actor: revokedBy,
          details: {
            reason: reason,
            changes: ['status', 'lifecycle.revoked']
          },
          metadata: {
            batchOperation: true,
            totalTokens: tokenIds.length
          }
        }
      }
    }
  );
  
  return result;
};

// Security audit
qrTokenSchema.statics.securityAudit = function(days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  return this.aggregate([
    {
      $match: {
        'claims.issuedAt': { $gte: startDate },
        isDeleted: false
      }
    },
    {
      $group: {
        _id: null,
        totalTokens: { $sum: 1 },
        highRiskTokens: {
          $sum: {
            $cond: [{ $gte: ['$security.riskScore', 70] }, 1, 0]
          }
        },
        tokensWithFraudFlags: {
          $sum: {
            $cond: [{ $gt: [{ $size: '$security.fraudFlags' }, 0] }, 1, 0]
          }
        },
        revokedForSecurity: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ['$status', QR_STATUS.REVOKED] },
                  { $eq: ['$lifecycle.revoked.category', 'SECURITY'] }
                ]
              },
              1,
              0
            ]
          }
        },
        averageRiskScore: { $avg: '$security.riskScore' },
        uniqueIPAddresses: {
          $addToSet: '$security.generatedFrom.ipAddress'
        },
        suspiciousPatterns: {
          $sum: {
            $cond: [
              {
                $or: [
                  { $gt: ['$usageStats.uniqueDevices', 3] },
                  { $gt: ['$usageStats.uniqueLocations', 5] },
                  { $gt: ['$usageStats.failedAttempts', 3] }
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
        uniqueIPCount: { $size: '$uniqueIPAddresses' },
        riskPercentage: {
          $multiply: [
            { $divide: ['$highRiskTokens', '$totalTokens'] },
            100
          ]
        },
        securityIncidentRate: {
          $multiply: [
            { $divide: ['$revokedForSecurity', '$totalTokens'] },
            100
          ]
        }
      }
    }
  ]);
};

// Set current user for audit trail (middleware helper)
qrTokenSchema.statics.setCurrentUser = function(user) {
  this.currentUser = user;
};

// ============================================================================
// QUERY HELPERS
// ============================================================================

// Active tokens query helper
qrTokenSchema.query.active = function() {
  return this.where({
    status: QR_STATUS.ACTIVE,
    isDeleted: false,
    'claims.expiresAt': { $gt: new Date() }
  });
};

// Usable tokens query helper
qrTokenSchema.query.usable = function() {
  return this.active().where({
    'claims.notBefore': { $lte: new Date() }
  }).where({
    $expr: {
      $lt: ['$usageConfig.currentUsage', '$usageConfig.maxUsage']
    }
  });
};

// By type query helper
qrTokenSchema.query.byType = function(type) {
  return this.where({ type: type });
};

// By hotel query helper
qrTokenSchema.query.byHotel = function(hotelId) {
  return this.where({ relatedHotel: hotelId });
};

// By booking query helper
qrTokenSchema.query.byBooking = function(bookingId) {
  return this.where({ relatedBooking: bookingId });
};

// High risk query helper
qrTokenSchema.query.highRisk = function(minScore = 70) {
  return this.where({
    'security.riskScore': { $gte: minScore }
  });
};

// Expiring soon query helper
qrTokenSchema.query.expiringSoon = function(minutes = 60) {
  const threshold = new Date(Date.now() + minutes * 60 * 1000);
  return this.active().where({
    'claims.expiresAt': { $lt: threshold }
  });
};

// ============================================================================
// HOOKS FOR EXTERNAL INTEGRATIONS
// ============================================================================

// Hook for real-time notifications
qrTokenSchema.post('save', function(doc) {
  // Emit real-time events (integrate with your socket service)
  if (doc.isModified('status')) {
    process.nextTick(() => {
      // Example integration with socket service
      try {
        const socketService = require('../services/socketService');
        
        // Notify token owner
        socketService.sendUserNotification(doc.owner, 'QR_STATUS_CHANGED', {
          tokenId: doc.tokenId,
          identifier: doc.identifier,
          newStatus: doc.status,
          type: doc.type
        });
        
        // Notify related hotel if applicable
        if (doc.relatedHotel) {
          socketService.sendHotelNotification(doc.relatedHotel, 'QR_STATUS_CHANGED', {
            tokenId: doc.tokenId,
            identifier: doc.identifier,
            newStatus: doc.status,
            type: doc.type
          });
        }
        
      } catch (error) {
        console.error('Socket notification error:', error);
      }
    });
  }
});

// Hook for analytics updates
qrTokenSchema.post('save', function(doc) {
  if (doc.isModified('usageLog')) {
    process.nextTick(() => {
      doc.updateAnalytics().catch(error => {
        console.error('Analytics update error:', error);
      });
    });
  }
});

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

// Custom validator for token payload
qrTokenSchema.path('payload').validate(function(value) {
  if (!value || !value.type) {
    return false;
  }
  
  // Type-specific validation
  switch (value.type) {
    case QR_TYPES.CHECK_IN:
      return value.bookingId && value.hotelId;
    case QR_TYPES.PAYMENT:
      return value.paymentData && value.paymentData.amount > 0;
    case QR_TYPES.WIFI:
      return value.wifiData && value.wifiData.networkName;
    default:
      return true;
  }
}, 'Invalid payload for QR type');

// Custom validator for expiry dates
qrTokenSchema.path('claims.expiresAt').validate(function(value) {
  return value > this.claims.issuedAt;
}, 'Expiry date must be after issue date');

// Custom validator for usage limits
qrTokenSchema.path('usageConfig.maxUsage').validate(function(value) {
  return value >= this.usageConfig.currentUsage;
}, 'Max usage cannot be less than current usage');

// ============================================================================
// EXPORT
// ============================================================================

const QRToken = mongoose.model('QRToken', qrTokenSchema);

module.exports = {
  QRToken,
  QR_TYPES,
  QR_STATUS,
  QR_ACTIONS
};