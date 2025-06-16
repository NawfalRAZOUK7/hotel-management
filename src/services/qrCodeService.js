/**
 * QR CODE SERVICE - SECURE QR CODE GENERATION & VALIDATION
 * Service complet pour génération et validation de QR codes sécurisés
 * 
 * Fonctionnalités :
 * - QR generation avec JWT sécurisé
 * - QR validation & expiry automatique
 * - Security tokens avec encryption
 * - QR code styling personnalisé
 * - Rate limiting et anti-fraude
 * - Audit trail et logging
 * - Multi-format support (SVG, PNG, Base64)
 * - Batch generation pour événements
 */

const QRCode = require('qrcode');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { logger } = require('../utils/logger');
const cacheService = require('./cacheService');
const { CacheKeys, TTL } = require('../utils/cacheKeys');

/**
 * ================================
 * QR CODE CONFIGURATION
 * ================================
 */
const QR_CONFIG = {
  // JWT Configuration
  jwt: {
    secret: process.env.QR_JWT_SECRET || crypto.randomBytes(64).toString('hex'),
    algorithm: 'HS256',
    issuer: process.env.APP_NAME || 'HotelManagement',
    audience: process.env.QR_AUDIENCE || 'hotel-app'
  },
  
  // QR Code Styling
  styling: {
    // Default style
    default: {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      },
      width: 256
    },
    
    // Hotel branded style
    hotel: {
      errorCorrectionLevel: 'H', // Higher error correction for logos
      type: 'image/png',
      quality: 0.95,
      margin: 2,
      color: {
        dark: '#1a365d',
        light: '#f7fafc'
      },
      width: 300
    },
    
    // Mobile optimized
    mobile: {
      errorCorrectionLevel: 'M',
      type: 'image/png',
      quality: 0.88,
      margin: 1,
      color: {
        dark: '#2d3748',
        light: '#ffffff'
      },
      width: 200
    },
    
    // Print optimized
    print: {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      quality: 1.0,
      margin: 3,
      color: {
        dark: '#000000',
        light: '#ffffff'
      },
      width: 400
    }
  },
  
  // Security Configuration
  security: {
    maxTokenAge: 24 * 60 * 60, // 24 hours
    minTokenAge: 30,           // 30 seconds minimum
    maxUsageCount: 10,         // Max usages per QR code
    rateLimitWindow: 60 * 1000, // 1 minute window
    maxRequestsPerWindow: 5,    // Max requests per window
    encryptionKey: process.env.QR_ENCRYPTION_KEY || crypto.randomBytes(32).toString('hex')
  },
  
  // Feature Flags
  features: {
    enableCaching: true,
    enableRateLimit: true,
    enableAuditLog: true,
    enableBatchGeneration: true,
    enableCustomStyling: true
  }
};

/**
 * ================================
 * QR CODE TYPES & ACTIONS
 * ================================
 */
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

const QR_ACTIONS = {
  SCAN: 'scan',
  VALIDATE: 'validate',
  USE: 'use',
  REVOKE: 'revoke'
};

/**
 * ================================
 * QR CODE SERVICE CLASS
 * ================================
 */
class QRCodeService {
  constructor() {
    this.cache = cacheService;
    this.rateLimitCache = new Map();
    this.auditLog = [];
    
    // Initialize encryption
    this.cipher = crypto.createCipher('aes-256-cbc', QR_CONFIG.security.encryptionKey);
    
    // Cleanup old rate limit entries
    setInterval(() => {
      this.cleanupRateLimit();
    }, 5 * 60 * 1000); // Every 5 minutes
  }

  /**
   * ================================
   * QR GENERATION METHODS
   * ================================
   */

  /**
   * Génère un QR code sécurisé avec JWT
   * @param {Object} payload - Données à encoder
   * @param {Object} options - Options de génération
   */
  async generateQRCode(payload, options = {}) {
    try {
      // Validate payload
      this.validatePayload(payload);
      
      // Check rate limiting
      if (QR_CONFIG.features.enableRateLimit) {
        await this.checkRateLimit(payload.userId || payload.identifier);
      }
      
      // Generate secure token
      const token = await this.generateSecureToken(payload, options);
      
      // Generate QR code with styling
      const qrResult = await this.generateStyledQR(token, options.style);
      
      // Cache QR code data
      if (QR_CONFIG.features.enableCaching) {
        await this.cacheQRData(token, payload, options);
      }
      
      // Audit log
      if (QR_CONFIG.features.enableAuditLog) {
        this.logAuditEvent('QR_GENERATED', payload, options);
      }
      
      return {
        success: true,
        token,
        qrCode: qrResult,
        metadata: {
          type: payload.type,
          expiresAt: new Date(Date.now() + (options.expiresIn || QR_CONFIG.security.maxTokenAge) * 1000),
          usageLimit: options.maxUsage || QR_CONFIG.security.maxUsageCount,
          styling: options.style || 'default',
          generatedAt: new Date()
        }
      };
      
    } catch (error) {
      logger.error('QR Code generation failed:', error);
      return {
        success: false,
        error: error.message,
        code: 'QR_GENERATION_FAILED'
      };
    }
  }

  /**
   * Génère un token JWT sécurisé
   */
  async generateSecureToken(payload, options = {}) {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = options.expiresIn || QR_CONFIG.security.maxTokenAge;
    
    // Enhanced payload with security features
    const enhancedPayload = {
      // Original data
      ...payload,
      
      // Security fields
      jti: crypto.randomUUID(), // Unique token ID
      iat: now,                 // Issued at
      exp: now + expiresIn,     // Expires at
      nbf: now,                 // Not before
      iss: QR_CONFIG.jwt.issuer,
      aud: QR_CONFIG.jwt.audience,
      
      // Usage tracking
      maxUsage: options.maxUsage || QR_CONFIG.security.maxUsageCount,
      usageCount: 0,
      
      // Context
      generatedBy: payload.userId || 'system',
      deviceInfo: options.deviceInfo || null,
      ipAddress: options.ipAddress || null,
      
      // Checksum for integrity
      checksum: this.calculateChecksum(payload)
    };
    
    // Sign JWT
    const token = jwt.sign(enhancedPayload, QR_CONFIG.jwt.secret, {
      algorithm: QR_CONFIG.jwt.algorithm,
      expiresIn: `${expiresIn}s`
    });
    
    return token;
  }

  /**
   * Génère un QR code avec styling personnalisé
   */
  async generateStyledQR(token, styleType = 'default') {
    const style = QR_CONFIG.styling[styleType] || QR_CONFIG.styling.default;
    
    try {
      // Generate QR code options
      const qrOptions = {
        errorCorrectionLevel: style.errorCorrectionLevel,
        type: style.type,
        quality: style.quality,
        margin: style.margin,
        color: style.color,
        width: style.width
      };
      
      // Generate different formats
      const results = {};
      
      // Base64 Data URL (for web)
      results.dataURL = await QRCode.toDataURL(token, qrOptions);
      
      // SVG (for print/scaling)
      results.svg = await QRCode.toString(token, {
        ...qrOptions,
        type: 'svg'
      });
      
      // Buffer (for file operations)
      results.buffer = await QRCode.toBuffer(token, qrOptions);
      
      // File info
      results.metadata = {
        format: style.type,
        width: style.width,
        height: style.width,
        size: results.buffer.length,
        style: styleType
      };
      
      return results;
      
    } catch (error) {
      logger.error('QR styling failed:', error);
      throw new Error(`QR styling failed: ${error.message}`);
    }
  }

  /**
   * ================================
   * QR VALIDATION METHODS
   * ================================
   */

  /**
   * Valide un QR code et son token JWT
   * @param {string} token - Token JWT à valider
   * @param {Object} context - Contexte de validation
   */
  async validateQRCode(token, context = {}) {
    try {
      // Basic token validation
      if (!token || typeof token !== 'string') {
        throw new Error('Invalid token format');
      }
      
      // Verify JWT signature and expiry
      const decoded = this.verifyJWT(token);
      
      // Check if token is still valid (not revoked)
      const isRevoked = await this.isTokenRevoked(decoded.jti);
      if (isRevoked) {
        throw new Error('Token has been revoked');
      }
      
      // Check usage limits
      const currentUsage = await this.getTokenUsage(decoded.jti);
      if (currentUsage >= decoded.maxUsage) {
        throw new Error('Token usage limit exceeded');
      }
      
      // Validate checksum
      if (!this.validateChecksum(decoded)) {
        throw new Error('Token integrity check failed');
      }
      
      // Additional security checks
      await this.performSecurityChecks(decoded, context);
      
      // Audit log
      if (QR_CONFIG.features.enableAuditLog) {
        this.logAuditEvent('QR_VALIDATED', decoded, context);
      }
      
      return {
        success: true,
        data: decoded,
        metadata: {
          tokenId: decoded.jti,
          type: decoded.type,
          issuedAt: new Date(decoded.iat * 1000),
          expiresAt: new Date(decoded.exp * 1000),
          usageCount: currentUsage,
          maxUsage: decoded.maxUsage,
          remainingUsage: decoded.maxUsage - currentUsage
        }
      };
      
    } catch (error) {
      logger.warn('QR Code validation failed:', error.message);
      
      // Audit failed validation
      if (QR_CONFIG.features.enableAuditLog) {
        this.logAuditEvent('QR_VALIDATION_FAILED', { token: token.substring(0, 20) + '...' }, context, error);
      }
      
      return {
        success: false,
        error: error.message,
        code: this.getErrorCode(error.message)
      };
    }
  }

  /**
   * Vérifie et décode le JWT
   */
  verifyJWT(token) {
    try {
      return jwt.verify(token, QR_CONFIG.jwt.secret, {
        algorithms: [QR_CONFIG.jwt.algorithm],
        issuer: QR_CONFIG.jwt.issuer,
        audience: QR_CONFIG.jwt.audience,
        maxAge: `${QR_CONFIG.security.maxTokenAge}s`
      });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        throw new Error('QR Code has expired');
      } else if (error.name === 'JsonWebTokenError') {
        throw new Error('Invalid QR Code');
      } else {
        throw new Error(`Token verification failed: ${error.message}`);
      }
    }
  }

  /**
   * ================================
   * SECURITY & USAGE TRACKING
   * ================================
   */

  /**
   * Marque un token comme utilisé
   */
  async useToken(tokenId, context = {}) {
    try {
      const usageKey = CacheKeys.generateKey('qr_usage', tokenId);
      const currentUsage = await this.getTokenUsage(tokenId);
      
      // Increment usage count
      await this.cache.redis.setEx(usageKey, TTL.BOOKING_DATA.WORKFLOW, currentUsage + 1);
      
      // Log usage
      if (QR_CONFIG.features.enableAuditLog) {
        this.logAuditEvent('QR_USED', { tokenId }, context);
      }
      
      return {
        success: true,
        usageCount: currentUsage + 1
      };
      
    } catch (error) {
      logger.error('Token usage tracking failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Révoque un token
   */
  async revokeToken(tokenId, reason = 'Manual revocation', context = {}) {
    try {
      const revokeKey = CacheKeys.generateKey('qr_revoked', tokenId);
      
      // Mark as revoked
      await this.cache.redis.setEx(revokeKey, QR_CONFIG.security.maxTokenAge, {
        revokedAt: new Date().toISOString(),
        reason,
        revokedBy: context.userId || 'system'
      });
      
      // Log revocation
      if (QR_CONFIG.features.enableAuditLog) {
        this.logAuditEvent('QR_REVOKED', { tokenId, reason }, context);
      }
      
      return {
        success: true,
        message: 'Token revoked successfully'
      };
      
    } catch (error) {
      logger.error('Token revocation failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Vérifie si un token est révoqué
   */
  async isTokenRevoked(tokenId) {
    try {
      const revokeKey = CacheKeys.generateKey('qr_revoked', tokenId);
      const revoked = await this.cache.redis.get(revokeKey);
      return !!revoked;
    } catch (error) {
      logger.error('Revocation check failed:', error);
      return false; // Fail open for availability
    }
  }

  /**
   * Obtient le nombre d'utilisations d'un token
   */
  async getTokenUsage(tokenId) {
    try {
      const usageKey = CacheKeys.generateKey('qr_usage', tokenId);
      const usage = await this.cache.redis.get(usageKey);
      return parseInt(usage) || 0;
    } catch (error) {
      logger.error('Usage tracking check failed:', error);
      return 0; // Fail safe
    }
  }

  /**
   * ================================
   * BATCH OPERATIONS
   * ================================
   */

  /**
   * Génère plusieurs QR codes en lot
   */
  async generateBatchQRCodes(payloads, options = {}) {
    if (!QR_CONFIG.features.enableBatchGeneration) {
      throw new Error('Batch generation is disabled');
    }
    
    const results = [];
    const batchSize = options.batchSize || 50;
    
    // Process in batches to avoid memory issues
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (payload, index) => {
        try {
          const result = await this.generateQRCode(payload, {
            ...options,
            batchIndex: i + index
          });
          
          return {
            index: i + index,
            success: true,
            ...result
          };
          
        } catch (error) {
          return {
            index: i + index,
            success: false,
            error: error.message,
            payload: payload
          };
        }
      });
      
      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));
      
      // Small delay between batches
      if (i + batchSize < payloads.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    logger.info(`Batch QR generation completed: ${successful} successful, ${failed} failed`);
    
    return {
      success: true,
      total: payloads.length,
      successful,
      failed,
      results
    };
  }

  /**
   * ================================
   * UTILITY METHODS
   * ================================
   */

  /**
   * Valide le payload d'entrée
   */
  validatePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Invalid payload');
    }
    
    if (!payload.type || !Object.values(QR_TYPES).includes(payload.type)) {
      throw new Error('Invalid or missing QR type');
    }
    
    if (!payload.identifier) {
      throw new Error('Missing identifier');
    }
    
    // Type-specific validation
    switch (payload.type) {
      case QR_TYPES.CHECK_IN:
        if (!payload.bookingId || !payload.hotelId) {
          throw new Error('Check-in QR requires bookingId and hotelId');
        }
        break;
        
      case QR_TYPES.ROOM_ACCESS:
        if (!payload.roomId || !payload.guestId) {
          throw new Error('Room access QR requires roomId and guestId');
        }
        break;
        
      case QR_TYPES.PAYMENT:
        if (!payload.amount || !payload.currency) {
          throw new Error('Payment QR requires amount and currency');
        }
        break;
    }
  }

  /**
   * Calcule le checksum pour l'intégrité
   */
  calculateChecksum(payload) {
    const data = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
  }

  /**
   * Valide le checksum
   */
  validateChecksum(decoded) {
    const { checksum, ...originalPayload } = decoded;
    
    // Remove JWT standard fields
    const cleanPayload = { ...originalPayload };
    delete cleanPayload.jti;
    delete cleanPayload.iat;
    delete cleanPayload.exp;
    delete cleanPayload.nbf;
    delete cleanPayload.iss;
    delete cleanPayload.aud;
    delete cleanPayload.maxUsage;
    delete cleanPayload.usageCount;
    delete cleanPayload.generatedBy;
    delete cleanPayload.deviceInfo;
    delete cleanPayload.ipAddress;
    
    const calculatedChecksum = this.calculateChecksum(cleanPayload);
    return checksum === calculatedChecksum;
  }

  /**
   * Vérifie la sécurité additionnelle
   */
  async performSecurityChecks(decoded, context) {
    // IP address validation (if required)
    if (decoded.ipAddress && context.ipAddress && decoded.ipAddress !== context.ipAddress) {
      logger.warn(`IP mismatch for token ${decoded.jti}: ${decoded.ipAddress} vs ${context.ipAddress}`);
      // Note: Don't throw error, just log for monitoring
    }
    
    // Time-based checks
    if (decoded.nbf && decoded.nbf > Math.floor(Date.now() / 1000)) {
      throw new Error('Token not yet valid');
    }
    
    // Context-specific validation
    if (decoded.type === QR_TYPES.CHECK_IN && context.hotelId) {
      if (decoded.hotelId !== context.hotelId) {
        throw new Error('Hotel mismatch');
      }
    }
  }

  /**
   * Rate limiting check
   */
  async checkRateLimit(identifier) {
    const key = identifier || 'anonymous';
    const now = Date.now();
    const windowStart = now - QR_CONFIG.security.rateLimitWindow;
    
    // Get existing requests
    const requests = this.rateLimitCache.get(key) || [];
    
    // Remove old requests
    const recentRequests = requests.filter(time => time > windowStart);
    
    // Check limit
    if (recentRequests.length >= QR_CONFIG.security.maxRequestsPerWindow) {
      throw new Error('Rate limit exceeded');
    }
    
    // Add current request
    recentRequests.push(now);
    this.rateLimitCache.set(key, recentRequests);
  }

  /**
   * Nettoie les anciennes entrées de rate limiting
   */
  cleanupRateLimit() {
    const now = Date.now();
    const windowStart = now - QR_CONFIG.security.rateLimitWindow;
    
    for (const [key, requests] of this.rateLimitCache.entries()) {
      const recentRequests = requests.filter(time => time > windowStart);
      
      if (recentRequests.length === 0) {
        this.rateLimitCache.delete(key);
      } else {
        this.rateLimitCache.set(key, recentRequests);
      }
    }
  }

  /**
   * Log d'audit
   */
  logAuditEvent(event, data, context = {}, error = null) {
    const auditEntry = {
      timestamp: new Date().toISOString(),
      event,
      data,
      context,
      error: error ? error.message : null,
      source: 'QRCodeService'
    };
    
    this.auditLog.push(auditEntry);
    
    // Keep only recent entries
    if (this.auditLog.length > 1000) {
      this.auditLog = this.auditLog.slice(-500);
    }
    
    // Log to main logger
    if (error) {
      logger.warn(`QR Audit: ${event}`, auditEntry);
    } else {
      logger.info(`QR Audit: ${event}`, auditEntry);
    }
  }

  /**
   * Cache des données QR
   */
  async cacheQRData(token, payload, options) {
    try {
      const decoded = jwt.decode(token);
      const cacheKey = CacheKeys.generateKey('qr_data', decoded.jti);
      
      const cacheData = {
        token,
        payload,
        options,
        generatedAt: new Date().toISOString(),
        expiresAt: new Date(decoded.exp * 1000).toISOString()
      };
      
      await this.cache.redis.setEx(cacheKey, TTL.QR_CODES.ACTIVE, JSON.stringify(cacheData));
      
    } catch (error) {
      logger.error('QR cache storage failed:', error);
    }
  }

  /**
   * Obtient le code d'erreur approprié
   */
  getErrorCode(errorMessage) {
    const errorCodes = {
      'expired': 'QR_EXPIRED',
      'invalid': 'QR_INVALID',
      'revoked': 'QR_REVOKED',
      'usage limit': 'QR_USAGE_EXCEEDED',
      'rate limit': 'QR_RATE_LIMITED',
      'integrity': 'QR_INTEGRITY_FAILED'
    };
    
    for (const [keyword, code] of Object.entries(errorCodes)) {
      if (errorMessage.toLowerCase().includes(keyword)) {
        return code;
      }
    }
    
    return 'QR_UNKNOWN_ERROR';
  }

  /**
   * ================================
   * MONITORING & STATS
   * ================================
   */

  /**
   * Obtient les statistiques du service
   */
  getStats() {
    const recentAuditLog = this.auditLog.slice(-100);
    const events = recentAuditLog.reduce((acc, entry) => {
      acc[entry.event] = (acc[entry.event] || 0) + 1;
      return acc;
    }, {});
    
    return {
      rateLimitCache: this.rateLimitCache.size,
      auditLogSize: this.auditLog.length,
      recentEvents: events,
      config: {
        maxTokenAge: QR_CONFIG.security.maxTokenAge,
        maxUsageCount: QR_CONFIG.security.maxUsageCount,
        rateLimitWindow: QR_CONFIG.security.rateLimitWindow,
        features: QR_CONFIG.features
      }
    };
  }

  /**
   * Obtient les logs d'audit récents
   */
  getAuditLog(limit = 50) {
    return this.auditLog.slice(-limit);
  }
}

/**
 * ================================
 * EXPORTS
 * ================================
 */

// Create singleton instance
const qrCodeService = new QRCodeService();

module.exports = {
  // Main service
  qrCodeService,
  
  // Methods
  generateQRCode: qrCodeService.generateQRCode.bind(qrCodeService),
  validateQRCode: qrCodeService.validateQRCode.bind(qrCodeService),
  useToken: qrCodeService.useToken.bind(qrCodeService),
  revokeToken: qrCodeService.revokeToken.bind(qrCodeService),
  generateBatchQRCodes: qrCodeService.generateBatchQRCodes.bind(qrCodeService),
  
  // Monitoring
  getStats: qrCodeService.getStats.bind(qrCodeService),
  getAuditLog: qrCodeService.getAuditLog.bind(qrCodeService),
  
  // Constants
  QR_TYPES,
  QR_ACTIONS,
  QR_CONFIG,
  
  // Class for custom instances
  QRCodeService
};