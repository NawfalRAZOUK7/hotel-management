/**
 * QR ROUTES & CONTROLLERS - COMPLETE QR CODE API
 * Routes complètes pour la gestion des QR codes avec contrôleurs intégrés
 * 
 * Endpoints :
 * - Generate QR endpoint avec styling
 * - Validate QR endpoint avec security
 * - Process QR check-in workflow
 * - QR status tracking et monitoring
 * - Batch operations pour événements
 * - Admin management des QR codes
 */

const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, param, query, validationResult } = require('express-validator');

// Services
const { 
  generateQRCode, 
  validateQRCode, 
  useToken, 
  revokeToken, 
  generateBatchQRCodes,
  getStats,
  getAuditLog,
  QR_TYPES,
  QR_CONFIG
} = require('../services/qrCodeService');

const bookingRealtimeService = require('../services/bookingRealtimeService');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');

// Models
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');

// Middleware
const { auth, authorize } = require('../middleware/auth');
const { logger } = require('../utils/logger');

const router = express.Router();

/**
 * ================================
 * RATE LIMITING CONFIGURATION
 * ================================
 */

// General QR rate limiting
const qrRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: {
    success: false,
    message: 'Trop de requêtes QR code. Réessayez dans une minute.',
    code: 'QR_RATE_LIMITED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Generation rate limiting (more restrictive)
const generateRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 generations per minute
  message: {
    success: false,
    message: 'Limite de génération QR atteinte. Réessayez dans une minute.',
    code: 'QR_GENERATION_RATE_LIMITED'
  }
});

// Validation rate limiting (more permissive)
const validateRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20, // 20 validations per minute
  message: {
    success: false,
    message: 'Limite de validation QR atteinte. Réessayez dans une minute.',
    code: 'QR_VALIDATION_RATE_LIMITED'
  }
});

/**
 * ================================
 * VALIDATION RULES
 * ================================
 */

const validateQRGeneration = [
  body('type')
    .isIn(Object.values(QR_TYPES))
    .withMessage('Type de QR code invalide'),
  
  body('identifier')
    .isLength({ min: 1, max: 100 })
    .withMessage('Identifiant requis (max 100 caractères)'),
  
  body('expiresIn')
    .optional()
    .isInt({ min: 30, max: 7 * 24 * 60 * 60 })
    .withMessage('Durée de validité entre 30 secondes et 7 jours'),
  
  body('maxUsage')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Usage maximum entre 1 et 100'),
  
  body('style')
    .optional()
    .isIn(['default', 'hotel', 'mobile', 'print'])
    .withMessage('Style de QR code invalide')
];

const validateQRToken = [
  body('token')
    .isLength({ min: 10 })
    .withMessage('Token QR requis et valide')
];

const validateQRBatch = [
  body('payloads')
    .isArray({ min: 1, max: 50 })
    .withMessage('Liste de payloads requise (1-50 éléments)'),
  
  body('payloads.*.type')
    .isIn(Object.values(QR_TYPES))
    .withMessage('Type de QR code invalide dans la liste'),
  
  body('payloads.*.identifier')
    .isLength({ min: 1, max: 100 })
    .withMessage('Identifiant requis pour chaque payload')
];

/**
 * ================================
 * UTILITY FUNCTIONS
 * ================================
 */

/**
 * Gère les erreurs de validation
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Erreurs de validation',
      errors: errors.array().map(error => ({
        field: error.param,
        message: error.msg,
        value: error.value
      }))
    });
  }
  next();
};

/**
 * Enrichit le contexte de la requête
 */
const enrichRequestContext = (req) => {
  return {
    userId: req.user?.id,
    userRole: req.user?.role,
    ipAddress: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    timestamp: new Date(),
    deviceInfo: {
      mobile: req.get('User-Agent')?.includes('Mobile') || false,
      platform: req.get('User-Agent')?.match(/(iPhone|iPad|Android|Windows|Mac)/)?.[1] || 'Unknown'
    }
  };
};

/**
 * ================================
 * QR GENERATION ENDPOINTS
 * ================================
 */

/**
 * @desc    Génère un QR code pour check-in
 * @route   POST /api/qr/generate/checkin
 * @access  Private (Client owns booking)
 */
router.post('/generate/checkin', [
  auth,
  generateRateLimit,
  body('bookingId').isMongoId().withMessage('ID réservation invalide'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { bookingId, style = 'hotel', expiresIn = 24 * 60 * 60 } = req.body;
    const context = enrichRequestContext(req);

    // Vérifier que la réservation existe et appartient à l'utilisateur
    const booking = await Booking.findById(bookingId)
      .populate('hotel', 'name code')
      .populate('customer', 'firstName lastName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée',
        code: 'BOOKING_NOT_FOUND'
      });
    }

    // Vérifier permissions
    if (req.user.role === 'CLIENT' && booking.customer._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Accès non autorisé à cette réservation',
        code: 'UNAUTHORIZED_BOOKING_ACCESS'
      });
    }

    // Vérifier statut réservation
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'QR code disponible uniquement pour réservations confirmées',
        code: 'INVALID_BOOKING_STATUS'
      });
    }

    // Vérifier si pas trop en avance
    const checkInDate = new Date(booking.checkInDate);
    const now = new Date();
    const hoursUntilCheckIn = (checkInDate - now) / (1000 * 60 * 60);

    if (hoursUntilCheckIn > 48) {
      return res.status(400).json({
        success: false,
        message: 'QR code disponible 48h avant le check-in',
        code: 'QR_TOO_EARLY',
        availableAt: new Date(checkInDate.getTime() - 48 * 60 * 60 * 1000)
      });
    }

    // Générer QR code
    const qrPayload = {
      type: QR_TYPES.CHECK_IN,
      identifier: `checkin_${bookingId}`,
      bookingId: bookingId,
      hotelId: booking.hotel._id.toString(),
      userId: req.user.id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate
    };

    const qrResult = await generateQRCode(qrPayload, {
      style,
      expiresIn,
      maxUsage: 5, // Max 5 scans for check-in
      ...context
    });

    if (!qrResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Erreur génération QR code',
        error: qrResult.error,
        code: qrResult.code
      });
    }

    // Notification temps réel
    socketService.sendUserNotification(req.user.id, 'QR_CODE_GENERATED', {
      type: 'check_in',
      bookingId: bookingId,
      hotelName: booking.hotel.name,
      expiresAt: qrResult.metadata.expiresAt,
      message: 'QR code de check-in généré avec succès!'
    });

    // Notification hôtel
    socketService.sendHotelNotification(booking.hotel._id, 'QR_CODE_GENERATED', {
      type: 'check_in',
      bookingId: bookingId,
      customerName: qrPayload.customerName,
      generatedBy: req.user.id,
      expiresAt: qrResult.metadata.expiresAt
    });

    res.status(201).json({
      success: true,
      message: 'QR code de check-in généré avec succès',
      data: {
        qrCode: {
          dataURL: qrResult.qrCode.dataURL,
          svg: qrResult.qrCode.svg,
          metadata: qrResult.qrCode.metadata
        },
        booking: {
          id: booking._id,
          hotel: booking.hotel.name,
          checkInDate: booking.checkInDate,
          customer: qrPayload.customerName
        },
        validity: {
          expiresAt: qrResult.metadata.expiresAt,
          maxUsage: qrResult.metadata.usageLimit,
          hoursValid: Math.round(expiresIn / 3600)
        },
        instructions: {
          title: 'QR Code Check-in',
          steps: [
            'Présentez ce QR code à la réception de l\'hôtel',
            'Le staff scannera le code pour votre check-in',
            'Votre chambre sera attribuée automatiquement',
            'Récupérez vos clés et profitez de votre séjour!'
          ],
          validity: `Valable ${Math.round(expiresIn / 3600)}h`,
          support: 'Contactez la réception en cas de problème'
        }
      }
    });

  } catch (error) {
    logger.error('QR check-in generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * @desc    Génère un QR code générique
 * @route   POST /api/qr/generate
 * @access  Private
 */
router.post('/generate', [
  auth,
  generateRateLimit,
  ...validateQRGeneration,
  handleValidationErrors
], async (req, res) => {
  try {
    const { 
      type, 
      identifier, 
      expiresIn = 60 * 60, 
      maxUsage = 10, 
      style = 'default',
      ...additionalData 
    } = req.body;
    
    const context = enrichRequestContext(req);

    // Validation spécifique par type
    const typeValidation = await validateQRTypeData(type, additionalData, req.user);
    if (!typeValidation.valid) {
      return res.status(400).json({
        success: false,
        message: typeValidation.message,
        code: 'INVALID_TYPE_DATA'
      });
    }

    // Générer QR code
    const qrPayload = {
      type,
      identifier,
      userId: req.user.id,
      ...additionalData
    };

    const qrResult = await generateQRCode(qrPayload, {
      style,
      expiresIn,
      maxUsage,
      ...context
    });

    if (!qrResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Erreur génération QR code',
        error: qrResult.error,
        code: qrResult.code
      });
    }

    // Notification
    socketService.sendUserNotification(req.user.id, 'QR_CODE_GENERATED', {
      type,
      identifier,
      expiresAt: qrResult.metadata.expiresAt
    });

    res.status(201).json({
      success: true,
      message: 'QR code généré avec succès',
      data: {
        qrCode: qrResult.qrCode,
        metadata: qrResult.metadata,
        type,
        identifier,
        expiresAt: qrResult.metadata.expiresAt
      }
    });

  } catch (error) {
    logger.error('QR generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * QR VALIDATION ENDPOINTS
 * ================================
 */

/**
 * @desc    Valide un QR code
 * @route   POST /api/qr/validate
 * @access  Private (Staff + Admin)
 */
router.post('/validate', [
  auth,
  authorize(['RECEPTIONIST', 'ADMIN']),
  validateRateLimit,
  ...validateQRToken,
  handleValidationErrors
], async (req, res) => {
  try {
    const { token, action = 'validate' } = req.body;
    const context = enrichRequestContext(req);

    // Valider le QR code
    const validation = await validateQRCode(token, context);

    if (!validation.success) {
      // Log tentative de validation échouée
      logger.warn('QR validation failed', {
        error: validation.error,
        code: validation.code,
        userId: req.user.id,
        ...context
      });

      return res.status(400).json({
        success: false,
        message: 'QR code invalide',
        error: validation.error,
        code: validation.code
      });
    }

    const qrData = validation.data;

    // Vérifications contextuelles supplémentaires
    const contextValidation = await performContextValidation(qrData, req.user, context);
    if (!contextValidation.valid) {
      return res.status(403).json({
        success: false,
        message: contextValidation.message,
        code: 'CONTEXT_VALIDATION_FAILED'
      });
    }

    // Notification temps réel
    socketService.sendUserNotification(qrData.userId, 'QR_CODE_VALIDATED', {
      type: qrData.type,
      identifier: qrData.identifier,
      validatedBy: req.user.id,
      validatedAt: new Date(),
      remainingUsage: validation.metadata.remainingUsage
    });

    res.status(200).json({
      success: true,
      message: 'QR code validé avec succès',
      data: {
        type: qrData.type,
        identifier: qrData.identifier,
        issuedAt: validation.metadata.issuedAt,
        expiresAt: validation.metadata.expiresAt,
        usageCount: validation.metadata.usageCount,
        maxUsage: validation.metadata.maxUsage,
        remainingUsage: validation.metadata.remainingUsage,
        payload: filterSensitiveData(qrData)
      },
      validation: {
        validatedBy: req.user.id,
        validatedAt: new Date(),
        method: action
      }
    });

  } catch (error) {
    logger.error('QR validation error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la validation',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * QR CHECK-IN PROCESSING
 * ================================
 */

/**
 * @desc    Traite un check-in via QR code
 * @route   POST /api/qr/checkin/process
 * @access  Private (Receptionist + Admin)
 */
router.post('/checkin/process', [
  auth,
  authorize(['RECEPTIONIST', 'ADMIN']),
  qrRateLimit,
  ...validateQRToken,
  body('hotelId').optional().isMongoId().withMessage('ID hôtel invalide'),
  body('roomAssignments').optional().isArray().withMessage('Assignations chambres invalides'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { token, hotelId, roomAssignments = [], guestNotes = '' } = req.body;
    const context = enrichRequestContext(req);

    // Valider le QR code
    const validation = await validateQRCode(token, { ...context, hotelId });

    if (!validation.success) {
      return res.status(400).json({
        success: false,
        message: 'QR code invalide pour check-in',
        error: validation.error,
        code: validation.code
      });
    }

    const qrData = validation.data;

    // Vérifier que c'est un QR de check-in
    if (qrData.type !== QR_TYPES.CHECK_IN) {
      return res.status(400).json({
        success: false,
        message: 'Ce QR code n\'est pas pour un check-in',
        code: 'INVALID_QR_TYPE'
      });
    }

    // Vérifier que la réservation existe et est valide
    const booking = await Booking.findById(qrData.bookingId)
      .populate('hotel', 'name code')
      .populate('customer', 'firstName lastName email phone');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée',
        code: 'BOOKING_NOT_FOUND'
      });
    }

    // Vérifier statut réservation
    if (booking.status !== 'CONFIRMED') {
      return res.status(400).json({
        success: false,
        message: `Check-in impossible. Statut: ${booking.status}`,
        code: 'INVALID_BOOKING_STATUS'
      });
    }

    // Vérifier correspondance hôtel
    if (hotelId && booking.hotel._id.toString() !== hotelId) {
      return res.status(400).json({
        success: false,
        message: 'QR code ne correspond pas à cet hôtel',
        code: 'HOTEL_MISMATCH'
      });
    }

    // Marquer le token comme utilisé
    await useToken(validation.metadata.tokenId, {
      action: 'check_in_processed',
      bookingId: booking._id,
      processedBy: req.user.id,
      ...context
    });

    // Traiter le check-in via le service existant
    const checkInResult = await bookingRealtimeService.processCheckInRealtime(
      booking._id,
      req.user.id,
      roomAssignments.map(a => a.roomId),
      {
        checkInMethod: 'QR_CODE',
        qrToken: validation.metadata.tokenId,
        guestNotes,
        automaticProcess: true
      }
    );

    if (!checkInResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors du traitement du check-in',
        error: checkInResult.error,
        code: 'CHECKIN_PROCESSING_FAILED'
      });
    }

    // Mettre à jour le statut de la réservation
    booking.status = 'CHECKED_IN';
    booking.actualCheckInDate = new Date();
    booking.checkedInBy = req.user.id;
    booking.checkInMethod = 'QR_CODE';
    booking.guestNotes = guestNotes;
    
    await booking.save();

    // Notifications temps réel complètes
    const notificationData = {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      checkInTime: booking.actualCheckInDate,
      method: 'QR_CODE',
      processedBy: req.user.id,
      roomsAssigned: roomAssignments.length
    };

    // Notifier le client
    socketService.sendUserNotification(booking.customer._id, 'QR_CHECKIN_SUCCESS', {
      ...notificationData,
      message: 'Check-in QR effectué avec succès!',
      welcomeMessage: `Bienvenue au ${booking.hotel.name}`,
      nextSteps: [
        'Récupérez vos clés à la réception',
        'Consultez les informations de votre chambre',
        'Profitez de votre séjour!'
      ]
    });

    // Notifier l'équipe hôtel
    socketService.sendHotelNotification(booking.hotel._id, 'QR_CHECKIN_COMPLETED', {
      ...notificationData,
      customerContact: {
        email: booking.customer.email,
        phone: booking.customer.phone
      },
      specialRequests: booking.specialRequests,
      roomPreparation: roomAssignments.length > 0 ? 'Chambres assignées' : 'Attribution en cours'
    });

    // Notifier les admins
    socketService.sendAdminNotification('QR_CHECKIN_PROCESSED', {
      ...notificationData,
      efficiency: 'HIGH', // QR check-in is faster
      systemUsage: 'QR_CODE_CHECKIN'
    });

    res.status(200).json({
      success: true,
      message: 'Check-in QR traité avec succès',
      data: {
        booking: {
          id: booking._id,
          customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
          hotel: booking.hotel.name,
          checkInTime: booking.actualCheckInDate,
          status: booking.status
        },
        qrProcessing: {
          tokenUsed: validation.metadata.tokenId,
          remainingUsage: validation.metadata.remainingUsage - 1,
          method: 'QR_CODE'
        },
        roomInfo: {
          assigned: roomAssignments.length,
          total: booking.rooms?.length || 0,
          assignmentStatus: roomAssignments.length > 0 ? 'COMPLETED' : 'PENDING'
        },
        nextSteps: {
          keyCollection: 'Remettez les clés au client',
          roomPreparation: 'Vérifiez la propreté des chambres',
          guestServices: 'Informez sur les services de l\'hôtel'
        },
        notifications: {
          customerNotified: true,
          hotelTeamNotified: true,
          adminNotified: true
        }
      }
    });

  } catch (error) {
    logger.error('QR check-in processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du check-in QR',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * QR STATUS TRACKING
 * ================================
 */

/**
 * @desc    Obtient le statut d'un QR code
 * @route   GET /api/qr/status/:identifier
 * @access  Private
 */
router.get('/status/:identifier', [
  auth,
  qrRateLimit,
  param('identifier').isLength({ min: 1, max: 100 }).withMessage('Identifiant invalide'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { identifier } = req.params;
    const userId = req.user.id;

    // Rechercher dans les logs d'audit récents
    const auditLog = getAuditLog(100);
    const qrEvents = auditLog.filter(entry => 
      entry.data.identifier === identifier &&
      (entry.data.userId === userId || req.user.role === 'ADMIN')
    );

    if (qrEvents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'QR code non trouvé ou accès non autorisé',
        code: 'QR_NOT_FOUND'
      });
    }

    // Analyser les événements
    const creationEvent = qrEvents.find(e => e.event === 'QR_GENERATED');
    const validationEvents = qrEvents.filter(e => e.event === 'QR_VALIDATED');
    const usageEvents = qrEvents.filter(e => e.event === 'QR_USED');
    const lastEvent = qrEvents[qrEvents.length - 1];

    const status = {
      identifier,
      type: creationEvent?.data.type,
      created: {
        at: creationEvent?.timestamp,
        by: creationEvent?.data.userId,
        expiresAt: creationEvent?.data.expiresAt
      },
      usage: {
        validations: validationEvents.length,
        uses: usageEvents.length,
        lastActivity: lastEvent?.timestamp,
        lastActivityType: lastEvent?.event
      },
      current: {
        status: this.determineQRStatus(qrEvents),
        isExpired: creationEvent?.data.expiresAt ? new Date(creationEvent.data.expiresAt) < new Date() : false,
        isActive: this.isQRActive(qrEvents)
      }
    };

    res.status(200).json({
      success: true,
      data: status
    });

  } catch (error) {
    logger.error('QR status tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération du statut',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * @desc    Liste les QR codes d'un utilisateur
 * @route   GET /api/qr/my-codes
 * @access  Private
 */
router.get('/my-codes', [
  auth,
  qrRateLimit,
  query('type').optional().isIn(Object.values(QR_TYPES)).withMessage('Type invalide'),
  query('status').optional().isIn(['active', 'expired', 'used', 'all']).withMessage('Statut invalide'),
  query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limite invalide'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { type, status = 'all', limit = 20 } = req.query;
    const userId = req.user.id;

    // Récupérer les QR codes de l'utilisateur depuis les logs
    const auditLog = getAuditLog(500);
    const userQREvents = auditLog.filter(entry => 
      entry.event === 'QR_GENERATED' && 
      entry.data.userId === userId &&
      (!type || entry.data.type === type)
    );

    // Grouper par identifiant
    const qrCodes = userQREvents.reduce((acc, event) => {
      const identifier = event.data.identifier;
      if (!acc[identifier]) {
        acc[identifier] = {
          identifier,
          type: event.data.type,
          createdAt: event.timestamp,
          expiresAt: event.data.expiresAt,
          events: []
        };
      }
      
      // Ajouter tous les événements pour ce QR
      const allEvents = auditLog.filter(e => e.data.identifier === identifier);
      acc[identifier].events = allEvents;
      
      return acc;
    }, {});

    // Convertir en array et filtrer par statut
    let qrList = Object.values(qrCodes).map(qr => ({
      ...qr,
      status: this.determineQRStatus(qr.events),
      usageCount: qr.events.filter(e => e.event === 'QR_USED').length,
      lastUsed: qr.events.filter(e => e.event === 'QR_USED').pop()?.timestamp || null
    }));

    // Filtrer par statut si demandé
    if (status !== 'all') {
      qrList = qrList.filter(qr => qr.status === status);
    }

    // Trier par date de création (plus récent en premier)
    qrList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Limiter les résultats
    qrList = qrList.slice(0, parseInt(limit));

            res.status(200).json({
      success: true,
      data: {
        qrCodes: qrList.map(qr => ({
          identifier: qr.identifier,
          type: qr.type,
          status: qr.status,
          createdAt: qr.createdAt,
          expiresAt: qr.expiresAt,
          usageCount: qr.usageCount,
          lastUsed: qr.lastUsed
        })),
        pagination: {
          total: Object.keys(qrCodes).length,
          returned: qrList.length,
          limit: parseInt(limit)
        },
        filters: {
          type: type || 'all',
          status: status
        }
      }
    });

  } catch (error) {
    logger.error('QR codes listing error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des QR codes',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * BATCH OPERATIONS
 * ================================
 */

/**
 * @desc    Génère plusieurs QR codes en lot
 * @route   POST /api/qr/batch/generate
 * @access  Private (Admin + Receptionist)
 */
router.post('/batch/generate', [
  auth,
  authorize(['ADMIN', 'RECEPTIONIST']),
  generateRateLimit,
  ...validateQRBatch,
  handleValidationErrors
], async (req, res) => {
  try {
    const { payloads, options = {} } = req.body;
    const context = enrichRequestContext(req);

    // Validation des payloads
    for (const payload of payloads) {
      const typeValidation = await validateQRTypeData(payload.type, payload, req.user);
      if (!typeValidation.valid) {
        return res.status(400).json({
          success: false,
          message: `Payload invalide pour ${payload.identifier}: ${typeValidation.message}`,
          code: 'INVALID_BATCH_PAYLOAD'
        });
      }
    }

    // Enrichir les payloads avec l'utilisateur
    const enrichedPayloads = payloads.map(payload => ({
      ...payload,
      userId: req.user.id,
      batchId: crypto.randomUUID()
    }));

    // Générer en lot
    const batchResult = await generateBatchQRCodes(enrichedPayloads, {
      ...options,
      ...context
    });

    // Notification des résultats
    socketService.sendUserNotification(req.user.id, 'QR_BATCH_COMPLETED', {
      total: batchResult.total,
      successful: batchResult.successful,
      failed: batchResult.failed,
      batchId: enrichedPayloads[0].batchId
    });

    res.status(201).json({
      success: true,
      message: `Génération en lot terminée: ${batchResult.successful}/${batchResult.total} réussies`,
      data: {
        summary: {
          total: batchResult.total,
          successful: batchResult.successful,
          failed: batchResult.failed,
          successRate: Math.round((batchResult.successful / batchResult.total) * 100)
        },
        results: batchResult.results,
        failedItems: batchResult.results.filter(r => !r.success)
      }
    });

  } catch (error) {
    logger.error('QR batch generation error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération en lot',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * ADMIN MANAGEMENT
 * ================================
 */

/**
 * @desc    Révoque un QR code
 * @route   POST /api/qr/admin/revoke
 * @access  Private (Admin only)
 */
router.post('/admin/revoke', [
  auth,
  authorize(['ADMIN']),
  qrRateLimit,
  body('tokenId').isLength({ min: 1 }).withMessage('ID token requis'),
  body('reason').isLength({ min: 1, max: 200 }).withMessage('Raison requise (max 200 chars)'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { tokenId, reason } = req.body;
    const context = enrichRequestContext(req);

    const revokeResult = await revokeToken(tokenId, reason, context);

    if (!revokeResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la révocation',
        error: revokeResult.error,
        code: 'REVOCATION_FAILED'
      });
    }

    // Notification admin
    socketService.sendAdminNotification('QR_TOKEN_REVOKED', {
      tokenId,
      reason,
      revokedBy: req.user.id,
      revokedAt: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'QR code révoqué avec succès',
      data: {
        tokenId,
        reason,
        revokedBy: req.user.id,
        revokedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('QR revocation error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la révocation',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * @desc    Statistiques des QR codes
 * @route   GET /api/qr/admin/stats
 * @access  Private (Admin + Receptionist)
 */
router.get('/admin/stats', [
  auth,
  authorize(['ADMIN', 'RECEPTIONIST']),
  qrRateLimit
], async (req, res) => {
  try {
    const stats = getStats();
    const auditLog = getAuditLog(1000);

    // Analyser les logs pour statistiques détaillées
    const eventStats = auditLog.reduce((acc, entry) => {
      acc[entry.event] = (acc[entry.event] || 0) + 1;
      return acc;
    }, {});

    const typeStats = auditLog
      .filter(entry => entry.event === 'QR_GENERATED')
      .reduce((acc, entry) => {
        const type = entry.data.type;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

    // Statistiques par période
    const today = new Date();
    const lastWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const recentEvents = auditLog.filter(entry => new Date(entry.timestamp) >= lastWeek);
    const todayEvents = auditLog.filter(entry => {
      const entryDate = new Date(entry.timestamp);
      return entryDate.toDateString() === today.toDateString();
    });

    res.status(200).json({
      success: true,
      data: {
        service: stats,
        events: {
          all: eventStats,
          recent: recentEvents.length,
          today: todayEvents.length
        },
        types: typeStats,
        performance: {
          generationRate: recentEvents.filter(e => e.event === 'QR_GENERATED').length / 7, // per day
          validationRate: recentEvents.filter(e => e.event === 'QR_VALIDATED').length / 7,
          errorRate: recentEvents.filter(e => e.event.includes('FAILED')).length / recentEvents.length * 100
        },
        topUsers: this.getTopQRUsers(auditLog, 10)
      }
    });

  } catch (error) {
    logger.error('QR stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des statistiques',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * @desc    Logs d'audit des QR codes
 * @route   GET /api/qr/admin/audit
 * @access  Private (Admin only)
 */
router.get('/admin/audit', [
  auth,
  authorize(['ADMIN']),
  qrRateLimit,
  query('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limite invalide'),
  query('event').optional().withMessage('Événement invalide'),
  handleValidationErrors
], async (req, res) => {
  try {
    const { limit = 100, event } = req.query;
    
    let auditLog = getAuditLog(parseInt(limit) * 2); // Get more to filter
    
    // Filtrer par type d'événement si demandé
    if (event) {
      auditLog = auditLog.filter(entry => entry.event === event);
    }
    
    // Limiter les résultats
    auditLog = auditLog.slice(-parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        logs: auditLog,
        summary: {
          total: auditLog.length,
          filtered: !!event,
          filterType: event || null,
          timeRange: {
            oldest: auditLog[0]?.timestamp,
            newest: auditLog[auditLog.length - 1]?.timestamp
          }
        }
      }
    });

  } catch (error) {
    logger.error('QR audit logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des logs',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
});

/**
 * ================================
 * UTILITY FUNCTIONS
 * ================================
 */

/**
 * Valide les données spécifiques à un type de QR
 */
async function validateQRTypeData(type, data, user) {
  switch (type) {
    case QR_TYPES.CHECK_IN:
      if (!data.bookingId || !data.hotelId) {
        return { valid: false, message: 'bookingId et hotelId requis pour check-in' };
      }
      // Vérifier que la réservation existe et appartient à l'utilisateur
      const booking = await Booking.findById(data.bookingId);
      if (!booking) {
        return { valid: false, message: 'Réservation non trouvée' };
      }
      if (user.role === 'CLIENT' && booking.customer.toString() !== user.id) {
        return { valid: false, message: 'Réservation non autorisée' };
      }
      break;

    case QR_TYPES.CHECK_OUT:
      if (!data.bookingId) {
        return { valid: false, message: 'bookingId requis pour check-out' };
      }
      break;

    case QR_TYPES.ROOM_ACCESS:
      if (!data.roomId || !data.guestId) {
        return { valid: false, message: 'roomId et guestId requis pour accès chambre' };
      }
      break;

    case QR_TYPES.PAYMENT:
      if (!data.amount || !data.currency) {
        return { valid: false, message: 'amount et currency requis pour paiement' };
      }
      if (data.amount <= 0) {
        return { valid: false, message: 'Montant doit être positif' };
      }
      break;

    case QR_TYPES.WIFI:
      if (!data.networkName) {
        return { valid: false, message: 'networkName requis pour WiFi' };
      }
      break;

    default:
      // Types génériques - validation minimale
      break;
  }

  return { valid: true };
}

/**
 * Effectue une validation contextuelle
 */
async function performContextValidation(qrData, user, context) {
  // Vérification de base
  if (qrData.type === QR_TYPES.CHECK_IN) {
    // Vérifier que l'utilisateur est dans le bon hôtel
    if (context.hotelId && qrData.hotelId !== context.hotelId) {
      return { valid: false, message: 'QR code ne correspond pas à cet hôtel' };
    }
  }

  // Vérification des permissions par rôle
  const restrictedTypes = [QR_TYPES.ROOM_ACCESS, QR_TYPES.EMERGENCY];
  if (restrictedTypes.includes(qrData.type) && user.role === 'CLIENT') {
    return { valid: false, message: 'Type de QR code non autorisé pour ce rôle' };
  }

  return { valid: true };
}

/**
 * Filtre les données sensibles avant envoi
 */
function filterSensitiveData(data) {
  const { checksum, jti, iat, exp, ...filtered } = data;
  return filtered;
}

/**
 * Détermine le statut d'un QR code basé sur ses événements
 */
function determineQRStatus(events) {
  const hasGeneration = events.some(e => e.event === 'QR_GENERATED');
  const hasRevocation = events.some(e => e.event === 'QR_REVOKED');
  const hasUsage = events.some(e => e.event === 'QR_USED');
  const hasFailure = events.some(e => e.event.includes('FAILED'));

  if (!hasGeneration) return 'unknown';
  if (hasRevocation) return 'revoked';
  if (hasUsage) return 'used';
  if (hasFailure) return 'error';
  
  // Vérifier expiration
  const generationEvent = events.find(e => e.event === 'QR_GENERATED');
  if (generationEvent?.data?.expiresAt) {
    if (new Date(generationEvent.data.expiresAt) < new Date()) {
      return 'expired';
    }
  }

  return 'active';
}

/**
 * Vérifie si un QR code est actif
 */
function isQRActive(events) {
  const status = this.determineQRStatus(events);
  return ['active', 'used'].includes(status);
}

/**
 * Obtient les utilisateurs les plus actifs
 */
function getTopQRUsers(auditLog, limit = 10) {
  const userActivity = auditLog
    .filter(entry => entry.data.userId)
    .reduce((acc, entry) => {
      const userId = entry.data.userId;
      acc[userId] = (acc[userId] || 0) + 1;
      return acc;
    }, {});

  return Object.entries(userActivity)
    .sort(([,a], [,b]) => b - a)
    .slice(0, limit)
    .map(([userId, count]) => ({ userId, activityCount: count }));
}

/**
 * ================================
 * ERROR HANDLING MIDDLEWARE
 * ================================
 */

// Global error handler for QR routes
router.use((error, req, res, next) => {
  logger.error('QR routes error:', error);
  
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Erreur de validation',
      errors: Object.values(error.errors).map(err => err.message),
      code: 'VALIDATION_ERROR'
    });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'ID invalide',
      code: 'INVALID_ID'
    });
  }

  res.status(500).json({
    success: false,
    message: 'Erreur serveur interne',
    code: 'INTERNAL_SERVER_ERROR'
  });
});

module.exports = router;