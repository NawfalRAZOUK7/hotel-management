/**
 * QR CONTROLLER - SYSTÈME GESTION HÔTELIÈRE
 * Contrôleur complet pour gestion QR codes sécurisés avec workflow automatisé
 * 
 * Fonctionnalités:
 * - Génération QR codes sécurisés (JWT + styling)
 * - Validation QR codes avec security checks
 * - Workflow check-in automatique
 * - Tracking statuts et usage
 * - Notifications temps réel
 * - Audit trail complet
 * - Support multi-types QR codes
 * - Rate limiting et sécurité
 */

const { validationResult } = require('express-validator');

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

// Utils
const { logger } = require('../utils/logger');
const { BOOKING_STATUS, USER_ROLES } = require('../utils/constants');

/**
 * ================================
 * QR GENERATION CONTROLLERS
 * ================================
 */

/**
 * @desc    Génère un QR code pour check-in
 * @route   POST /api/qr/generate/checkin
 * @access  Private (Client owns booking)
 */
const generateCheckInQR = async (req, res) => {
  try {
    // Validation des erreurs
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { bookingId, style = 'hotel', expiresIn = 24 * 60 * 60 } = req.body;
    const userId = req.user.userId;

    // Vérifier que la réservation existe et appartient à l'utilisateur
    const bookingData = await validateBookingAccess(bookingId, userId, req.user.role);
    if (!bookingData.success) {
      return res.status(bookingData.status).json({
        success: false,
        message: bookingData.message,
        code: bookingData.code
      });
    }

    const { booking } = bookingData;

    // Vérifier statut réservation
    if (!['CONFIRMED', 'CHECKED_IN'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: 'QR code disponible uniquement pour réservations confirmées',
        code: 'INVALID_BOOKING_STATUS',
        currentStatus: booking.status,
        allowedStatuses: ['CONFIRMED', 'CHECKED_IN']
      });
    }

    // Vérifier si pas trop en avance
    const timeValidation = validateCheckInTiming(booking.checkIn);
    if (!timeValidation.valid) {
      return res.status(400).json({
        success: false,
        message: timeValidation.message,
        code: timeValidation.code,
        availableAt: timeValidation.availableAt
      });
    }

    // Construire le contexte de génération
    const context = buildRequestContext(req);

    // Générer QR code
    const qrPayload = {
      type: QR_TYPES.CHECK_IN,
      identifier: `checkin_${bookingId}`,
      bookingId: bookingId,
      hotelId: booking.hotel._id.toString(),
      userId: userId,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      checkInDate: booking.checkIn,
      checkOutDate: booking.checkOut,
      roomsCount: booking.rooms?.length || 0,
      guestCount: booking.totalGuests?.adults + booking.totalGuests?.children || 0
    };

    const qrResult = await generateQRCode(qrPayload, {
      style,
      expiresIn,
      maxUsage: 5, // Max 5 scans for check-in
      ...context
    });

    if (!qrResult.success) {
      logger.error('QR check-in generation failed:', qrResult);
      return res.status(500).json({
        success: false,
        message: 'Erreur génération QR code',
        error: qrResult.error,
        code: qrResult.code
      });
    }

    // Notifications temps réel
    await sendQRGenerationNotifications(
      userId, 
      booking.hotel._id, 
      qrResult, 
      booking,
      'check_in'
    );

    res.status(201).json({
      success: true,
      message: 'QR code de check-in généré avec succès',
      data: {
        qrCode: {
          dataURL: qrResult.qrCode.dataURL,
          svg: qrResult.qrCode.svg,
          metadata: qrResult.qrCode.metadata
        },
        token: qrResult.token,
        booking: {
          id: booking._id,
          confirmationNumber: booking.bookingNumber,
          hotel: booking.hotel.name,
          checkInDate: booking.checkIn,
          checkOutDate: booking.checkOut,
          customer: qrPayload.customerName,
          rooms: booking.rooms?.length || 0,
          guests: qrPayload.guestCount
        },
        validity: {
          expiresAt: qrResult.metadata.expiresAt,
          maxUsage: qrResult.metadata.usageLimit,
          hoursValid: Math.round(expiresIn / 3600)
        },
        instructions: buildCheckInInstructions(booking, qrResult.metadata.expiresAt),
        securityInfo: {
          tokenId: qrResult.metadata.tokenId,
          generatedAt: new Date(),
          securityLevel: 'HIGH'
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
};

/**
 * @desc    Génère un QR code générique
 * @route   POST /api/qr/generate
 * @access  Private
 */
const generateGenericQR = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { 
      type, 
      identifier, 
      expiresIn = 60 * 60, 
      maxUsage = 10, 
      style = 'default',
      ...additionalData 
    } = req.body;
    
    const userId = req.user.userId;
    const context = buildRequestContext(req);

    // Validation spécifique par type
    const typeValidation = await validateQRTypeData(type, additionalData, req.user);
    if (!typeValidation.valid) {
      return res.status(400).json({
        success: false,
        message: typeValidation.message,
        code: 'INVALID_TYPE_DATA',
        details: typeValidation.details
      });
    }

    // Vérifier les permissions par type
    const permissionCheck = await checkQRTypePermissions(type, req.user, additionalData);
    if (!permissionCheck.allowed) {
      return res.status(403).json({
        success: false,
        message: permissionCheck.message,
        code: 'INSUFFICIENT_PERMISSIONS'
      });
    }

    // Générer QR code
    const qrPayload = {
      type,
      identifier,
      userId,
      ...additionalData,
      ...typeValidation.enrichedData
    };

    const qrResult = await generateQRCode(qrPayload, {
      style,
      expiresIn,
      maxUsage,
      ...context
    });

    if (!qrResult.success) {
      logger.error('QR generic generation failed:', qrResult);
      return res.status(500).json({
        success: false,
        message: 'Erreur génération QR code',
        error: qrResult.error,
        code: qrResult.code
      });
    }

    // Notification
    await socketService.sendUserNotification(userId, 'QR_CODE_GENERATED', {
      type,
      identifier,
      expiresAt: qrResult.metadata.expiresAt,
      maxUsage,
      style
    });

    res.status(201).json({
      success: true,
      message: 'QR code généré avec succès',
      data: {
        qrCode: qrResult.qrCode,
        token: qrResult.token,
        metadata: qrResult.metadata,
        type,
        identifier,
        permissions: permissionCheck.permissions,
        generatedAt: new Date()
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
};

/**
 * ================================
 * QR VALIDATION CONTROLLERS
 * ================================
 */

/**
 * @desc    Valide un QR code
 * @route   POST /api/qr/validate
 * @access  Private (Staff + Admin)
 */
const validateQR = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { token, action = 'validate', context: additionalContext = {} } = req.body;
    const context = {
      ...buildRequestContext(req),
      ...additionalContext
    };

    // Valider le QR code
    const validation = await validateQRCode(token, context);

    if (!validation.success) {
      // Log tentative de validation échouée
      logger.warn('QR validation failed', {
        error: validation.error,
        code: validation.code,
        userId: req.user.userId,
        staffRole: req.user.role,
        ...context
      });

      return res.status(400).json({
        success: false,
        message: 'QR code invalide',
        error: validation.error,
        code: validation.code,
        validationContext: {
          attemptedBy: req.user.userId,
          attemptedAt: new Date(),
          ipAddress: context.ipAddress
        }
      });
    }

    const qrData = validation.data;

    // Vérifications contextuelles supplémentaires
    const contextValidation = await performContextualValidation(qrData, req.user, context);
    if (!contextValidation.valid) {
      return res.status(403).json({
        success: false,
        message: contextValidation.message,
        code: 'CONTEXT_VALIDATION_FAILED',
        details: contextValidation.details
      });
    }

    // Enrichir avec des données métier
    const enrichedData = await enrichQRData(qrData);

    // Notifications temps réel
    await sendQRValidationNotifications(qrData, req.user, validation.metadata);

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
        payload: filterSensitiveData(qrData),
        enrichedData: enrichedData,
        contextValidation: contextValidation.details
      },
      validation: {
        validatedBy: req.user.userId,
        validatedAt: new Date(),
        method: action,
        context: context.summary
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
};

/**
 * ================================
 * QR CHECK-IN PROCESSING
 * ================================
 */

/**
 * @desc    Traite un check-in via QR code (workflow complet)
 * @route   POST /api/qr/checkin/process
 * @access  Private (Receptionist + Admin)
 */
const processQRCheckIn = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { 
      token, 
      hotelId, 
      roomAssignments = [], 
      guestNotes = '',
      additionalServices = [],
      skipRoomAssignment = false 
    } = req.body;
    
    const receptionistId = req.user.userId;
    const context = buildRequestContext(req);

    // Étape 1: Valider le QR code
    logger.info(`Starting QR check-in process by ${receptionistId}`);
    
    const validation = await validateQRCode(token, { ...context, hotelId });

    if (!validation.success) {
      logger.warn('QR check-in validation failed:', validation);
      return res.status(400).json({
        success: false,
        message: 'QR code invalide pour check-in',
        error: validation.error,
        code: validation.code
      });
    }

    const qrData = validation.data;

    // Étape 2: Vérifier que c'est un QR de check-in
    if (qrData.type !== QR_TYPES.CHECK_IN) {
      return res.status(400).json({
        success: false,
        message: 'Ce QR code n\'est pas pour un check-in',
        code: 'INVALID_QR_TYPE',
        expectedType: QR_TYPES.CHECK_IN,
        actualType: qrData.type
      });
    }

    // Étape 3: Récupérer et valider la réservation
    const bookingValidation = await validateBookingForCheckIn(qrData.bookingId, hotelId);
    if (!bookingValidation.success) {
      return res.status(bookingValidation.status).json({
        success: false,
        message: bookingValidation.message,
        code: bookingValidation.code,
        details: bookingValidation.details
      });
    }

    const { booking } = bookingValidation;

    // Étape 4: Marquer le token comme utilisé
    const tokenUsage = await useToken(validation.metadata.tokenId, {
      action: 'check_in_processed',
      bookingId: booking._id,
      processedBy: receptionistId,
      hotelId: hotelId,
      ...context
    });

    if (!tokenUsage.success) {
      logger.error('Failed to mark token as used:', tokenUsage);
      // Continue anyway, but log the issue
    }

    // Étape 5: Traiter le check-in via le service temps réel
    logger.info(`Processing check-in for booking ${booking._id}`);
    
    const checkInOptions = {
      checkInMethod: 'QR_CODE',
      qrToken: validation.metadata.tokenId,
      guestNotes,
      additionalServices,
      automaticProcess: true,
      skipRoomAssignment,
      processedBy: receptionistId
    };

    const checkInResult = await bookingRealtimeService.processCheckInRealtime(
      booking._id,
      receptionistId,
      roomAssignments.map(a => a.roomId),
      checkInOptions
    );

    if (!checkInResult.success) {
      logger.error('Check-in processing failed:', checkInResult);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors du traitement du check-in',
        error: checkInResult.error,
        code: 'CHECKIN_PROCESSING_FAILED'
      });
    }

    // Étape 6: Mettre à jour le statut de la réservation
    const bookingUpdate = await updateBookingAfterCheckIn(
      booking, 
      receptionistId, 
      checkInOptions
    );

    // Étape 7: Notifications complètes
    await sendComprehensiveCheckInNotifications(
      booking, 
      receptionistId, 
      roomAssignments, 
      validation.metadata.tokenId
    );

    // Étape 8: Réponse de succès complète
    const response = buildCheckInSuccessResponse(
      booking,
      checkInResult,
      validation.metadata,
      roomAssignments,
      receptionistId
    );

    logger.info(`QR check-in completed successfully for booking ${booking._id}`);

    res.status(200).json(response);

  } catch (error) {
    logger.error('QR check-in processing error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors du check-in QR',
      code: 'INTERNAL_SERVER_ERROR',
      timestamp: new Date()
    });
  }
};

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
const getQRStatus = async (req, res) => {
  try {
    const { identifier } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Validation identifier
    if (!identifier || identifier.length < 1 || identifier.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Identifiant invalide',
        code: 'INVALID_IDENTIFIER'
      });
    }

    // Rechercher dans les logs d'audit récents
    const auditLog = getAuditLog(200);
    const qrEvents = auditLog.filter(entry => {
      return entry.data.identifier === identifier &&
             (entry.data.userId === userId || userRole === 'ADMIN' || userRole === 'RECEPTIONIST');
    });

    if (qrEvents.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'QR code non trouvé ou accès non autorisé',
        code: 'QR_NOT_FOUND'
      });
    }

    // Analyser les événements
    const analysis = analyzeQREvents(qrEvents);
    const status = buildQRStatus(identifier, analysis, qrEvents);

    // Ajouter des informations contextuelles
    if (status.type === QR_TYPES.CHECK_IN && status.bookingId) {
      const bookingInfo = await getBookingStatusInfo(status.bookingId);
      status.bookingStatus = bookingInfo;
    }

    res.status(200).json({
      success: true,
      data: status,
      meta: {
        totalEvents: qrEvents.length,
        analysisDate: new Date(),
        accessLevel: userRole === 'ADMIN' ? 'FULL' : 'RESTRICTED'
      }
    });

  } catch (error) {
    logger.error('QR status tracking error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération du statut',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
};

/**
 * @desc    Liste les QR codes d'un utilisateur
 * @route   GET /api/qr/my-codes
 * @access  Private
 */
const getUserQRCodes = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { 
      type, 
      status = 'all', 
      limit = 20, 
      offset = 0,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    const userId = req.user.userId;

    // Récupérer les QR codes de l'utilisateur depuis les logs
    const auditLog = getAuditLog(1000);
    const userQREvents = auditLog.filter(entry => 
      entry.event === 'QR_GENERATED' && 
      entry.data.userId === userId &&
      (!type || entry.data.type === type)
    );

    // Grouper par identifiant et analyser
    const qrCodesMap = groupQREventsByIdentifier(userQREvents, auditLog);
    
    // Convertir en array et filtrer
    let qrList = Object.values(qrCodesMap).map(qr => ({
      ...qr,
      status: determineQRStatus(qr.events),
      usageCount: qr.events.filter(e => e.event === 'QR_USED').length,
      lastUsed: qr.events.filter(e => e.event === 'QR_USED').pop()?.timestamp || null,
      isActive: isQRActive(qr.events),
      securityLevel: calculateSecurityLevel(qr.events)
    }));

    // Filtrer par statut
    if (status !== 'all') {
      qrList = qrList.filter(qr => qr.status === status);
    }

    // Trier
    qrList = sortQRCodes(qrList, sortBy, sortOrder);

    // Paginer
    const total = qrList.length;
    qrList = qrList.slice(offset, offset + parseInt(limit));

    // Enrichir avec informations additionnelles
    for (const qr of qrList) {
      if (qr.type === QR_TYPES.CHECK_IN && qr.bookingId) {
        qr.bookingInfo = await getBookingBasicInfo(qr.bookingId);
      }
    }

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
          lastUsed: qr.lastUsed,
          isActive: qr.isActive,
          securityLevel: qr.securityLevel,
          bookingInfo: qr.bookingInfo || null
        })),
        pagination: {
          total,
          returned: qrList.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: offset + parseInt(limit) < total
        },
        filters: {
          type: type || 'all',
          status: status,
          sortBy,
          sortOrder
        },
        summary: generateQRSummary(qrList)
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
};

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
const generateBatchQR = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { payloads, options = {} } = req.body;
    const userId = req.user.userId;
    const context = buildRequestContext(req);

    // Validation des payloads
    const validationResults = await validateBatchPayloads(payloads, req.user);
    
    if (validationResults.invalidCount > 0) {
      return res.status(400).json({
        success: false,
        message: `${validationResults.invalidCount} payload(s) invalide(s)`,
        code: 'INVALID_BATCH_PAYLOADS',
        details: validationResults.errors
      });
    }

    // Enrichir les payloads avec l'utilisateur
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const enrichedPayloads = payloads.map((payload, index) => ({
      ...payload,
      userId,
      batchId,
      batchIndex: index
    }));

    // Générer en lot
    logger.info(`Starting batch QR generation: ${enrichedPayloads.length} codes`);
    
    const batchStart = Date.now();
    const batchResult = await generateBatchQRCodes(enrichedPayloads, {
      ...options,
      ...context
    });
    const batchDuration = Date.now() - batchStart;

    // Analyser les résultats
    const analysis = analyzeBatchResults(batchResult);

    // Notification des résultats
    await socketService.sendUserNotification(userId, 'QR_BATCH_COMPLETED', {
      batchId,
      total: batchResult.total,
      successful: batchResult.successful,
      failed: batchResult.failed,
      duration: batchDuration,
      successRate: analysis.successRate
    });

    // Notifier les admins si taux d'échec élevé
    if (analysis.failureRate > 20) {
      await socketService.sendAdminNotification('QR_BATCH_HIGH_FAILURE', {
        batchId,
        userId,
        failureRate: analysis.failureRate,
        totalFailed: batchResult.failed
      });
    }

    logger.info(`Batch QR generation completed: ${batchResult.successful}/${batchResult.total} in ${batchDuration}ms`);

    res.status(201).json({
      success: true,
      message: `Génération en lot terminée: ${batchResult.successful}/${batchResult.total} réussies`,
      data: {
        batchId,
        summary: {
          total: batchResult.total,
          successful: batchResult.successful,
          failed: batchResult.failed,
          successRate: analysis.successRate,
          failureRate: analysis.failureRate,
          duration: batchDuration
        },
        results: batchResult.results,
        failedItems: batchResult.results.filter(r => !r.success),
        analysis: analysis,
        performance: {
          averageGenerationTime: batchDuration / batchResult.total,
          throughput: Math.round((batchResult.total / batchDuration) * 1000) // per second
        }
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
};

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
const revokeQRCode = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { tokenId, reason, notifyUser = true } = req.body;
    const adminId = req.user.userId;
    const context = buildRequestContext(req);

    // Vérifier que le token existe
    const tokenInfo = await getTokenInfo(tokenId);
    if (!tokenInfo) {
      return res.status(404).json({
        success: false,
        message: 'Token non trouvé',
        code: 'TOKEN_NOT_FOUND'
      });
    }

    // Révoquer le token
    const revokeResult = await revokeToken(tokenId, reason, {
      ...context,
      revokedBy: adminId,
      adminAction: true
    });

    if (!revokeResult.success) {
      logger.error('Token revocation failed:', revokeResult);
      return res.status(500).json({
        success: false,
        message: 'Erreur lors de la révocation',
        error: revokeResult.error,
        code: 'REVOCATION_FAILED'
      });
    }

    // Notifications
    await socketService.sendAdminNotification('QR_TOKEN_REVOKED', {
      tokenId,
      reason,
      revokedBy: adminId,
      revokedAt: new Date(),
      originalUser: tokenInfo.userId,
      tokenType: tokenInfo.type
    });

    // Notifier l'utilisateur si demandé
    if (notifyUser && tokenInfo.userId) {
      await socketService.sendUserNotification(tokenInfo.userId, 'QR_CODE_REVOKED', {
        tokenId,
        reason,
        revokedBy: 'Administration',
        revokedAt: new Date(),
        message: 'Un de vos QR codes a été révoqué par l\'administration'
      });
    }

    res.status(200).json({
      success: true,
      message: 'QR code révoqué avec succès',
      data: {
        tokenId,
        reason,
        revokedBy: adminId,
        revokedAt: new Date(),
        userNotified: notifyUser && !!tokenInfo.userId,
        originalTokenInfo: {
          type: tokenInfo.type,
          identifier: tokenInfo.identifier,
          userId: tokenInfo.userId
        }
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
};

/**
 * @desc    Statistiques des QR codes
 * @route   GET /api/qr/admin/stats
 * @access  Private (Admin + Receptionist)
 */
const getQRStats = async (req, res) => {
  try {
    const { 
      period = '7d', 
      hotelId, 
      includeDetails = false 
    } = req.query;
    
    const userRole = req.user.role;

    // Récupérer les stats du service
    const serviceStats = getStats();
    const auditLog = getAuditLog(2000);

    // Filtrer par hôtel si demandé et autorisé
    let filteredLog = auditLog;
    if (hotelId && (userRole === 'ADMIN' || req.user.hotelId === hotelId)) {
      filteredLog = auditLog.filter(entry => 
        entry.data.hotelId === hotelId || 
        entry.context?.hotelId === hotelId
      );
    }

    // Analyser par période
    const periodMs = parsePeriod(period);
    const cutoffDate = new Date(Date.now() - periodMs);
    const periodEvents = filteredLog.filter(entry => 
      new Date(entry.timestamp) >= cutoffDate
    );

    // Statistiques par événement
    const eventStats = periodEvents.reduce((acc, entry) => {
      acc[entry.event] = (acc[entry.event] || 0) + 1;
      return acc;
    }, {});

    // Statistiques par type de QR
    const typeStats = periodEvents
      .filter(entry => entry.event === 'QR_GENERATED')
      .reduce((acc, entry) => {
        const type = entry.data.type;
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {});

    // Statistiques par utilisateur (top 10)
    const userStats = getTopQRUsers(periodEvents, 10);

    // Statistiques temporelles
    const temporalStats = generateTemporalStats(periodEvents, period);

    // Métriques de performance
    const performanceMetrics = calculatePerformanceMetrics(periodEvents);

    // Alertes système
    const systemAlerts = generateSystemAlerts(serviceStats, performanceMetrics);

    const response = {
      success: true,
      data: {
        service: serviceStats,
        period: {
          range: period,
          startDate: cutoffDate,
          endDate: new Date(),
          totalEvents: periodEvents.length
        },
        events: {
          breakdown: eventStats,
          total: periodEvents.length
        },
        types: typeStats,
        users: userStats,
        temporal: temporalStats,
        performance: performanceMetrics,
        alerts: systemAlerts
      },
      meta: {
        generatedAt: new Date(),
        generatedBy: req.user.userId,
        includeDetails,
        hotelFilter: hotelId || null
      }
    };

    // Ajouter détails si demandé (Admin uniquement)
    if (includeDetails && userRole === 'ADMIN') {
      response.data.details = {
        recentErrors: getRecentErrors(filteredLog, 20),
        topFailureReasons: getTopFailureReasons(filteredLog),
        securityIncidents: getSecurityIncidents(filteredLog),
        unusualPatterns: detectUnusualPatterns(filteredLog)
      };
    }

    res.status(200).json(response);

  } catch (error) {
    logger.error('QR stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la récupération des statistiques',
      code: 'INTERNAL_SERVER_ERROR'
    });
  }
};

/**
 * @desc    Logs d'audit des QR codes
 * @route   GET /api/qr/admin/audit
 * @access  Private (Admin only)
 */
const getQRAuditLogs = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors: errors.array(),
        code: 'VALIDATION_ERROR'
      });
    }

    const { 
      limit = 100, 
      offset = 0,
      event, 
      userId, 
      startDate, 
      endDate,
      severity = 'all'
    } = req.query;
    
    let auditLog = getAuditLog(parseInt(limit) * 3); // Get more to filter

    // Filtres
    if (event) {
      auditLog = auditLog.filter(entry => entry.event === event);
    }

    if (userId) {
      auditLog = auditLog.filter(entry => 
        entry.data.userId === userId || entry.context?.userId === userId
      );
    }

    if (startDate) {
      const start = new Date(startDate);
      auditLog = auditLog.filter(entry => new Date(entry.timestamp) >= start);
    }

    if (endDate) {
      const end = new Date(endDate);
      auditLog = auditLog.filter(entry => new Date(entry.timestamp) <= end);
    }

    if (severity !== 'all') {
      auditLog = auditLog.filter(entry => 
        getSeverityLevel(entry) === severity
      );
    }

    // Paginer
    const total = auditLog.length;
    auditLog = auditLog.slice(offset, offset + parseInt(limit));

    // Enrichir les logs
    const enrichedLogs = await enrichAuditLogs(auditLog);

    res.status(200).json({
      success: true,
      data: {
        logs: enrichedLogs,
        pagination: {
          total,
          returned: enrichedLogs.length,
          limit: parseInt(limit),
          offset: parseInt(offset),
          hasMore: offset + parseInt(limit) < total
        },
        filters: {
          event: event || null,
          userId: userId || null,
          startDate: startDate || null,
          endDate: endDate || null,
          severity
        },
        summary: {
          totalEvents: total,
          uniqueUsers: new Set(auditLog.map(e => e.data.userId || e.context?.userId)).size,
          eventTypes: [...new Set(auditLog.map(e => e.event))],
          dateRange: {
            oldest: auditLog[auditLog.length - 1]?.timestamp,
            newest: auditLog[0]?.timestamp
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
};

/**
 * ================================
 * UTILITY FUNCTIONS
 * ================================
 */

/**
 * Valide l'accès à une réservation
 */
async function validateBookingAccess(bookingId, userId, userRole) {
  try {
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email')
      .populate('hotel', 'name code');

    if (!booking) {
      return {
        success: false,
        status: 404,
        message: 'Réservation non trouvée',
        code: 'BOOKING_NOT_FOUND'
      };
    }

    // Vérifier permissions
    if (userRole === 'CLIENT' && booking.customer._id.toString() !== userId) {
      return {
        success: false,
        status: 403,
        message: 'Accès non autorisé à cette réservation',
        code: 'UNAUTHORIZED_BOOKING_ACCESS'
      };
    }

    return {
      success: true,
      booking
    };

  } catch (error) {
    logger.error('Booking access validation error:', error);
    return {
      success: false,
      status: 500,
      message: 'Erreur lors de la validation de la réservation',
      code: 'BOOKING_VALIDATION_ERROR'
    };
  }
}

/**
 * Valide le timing pour un check-in
 */
function validateCheckInTiming(checkInDate) {
  const now = new Date();
  const checkIn = new Date(checkInDate);
  const hoursUntilCheckIn = (checkIn - now) / (1000 * 60 * 60);

  if (hoursUntilCheckIn > 48) {
    return {
      valid: false,
      message: 'QR code disponible 48h avant le check-in',
      code: 'QR_TOO_EARLY',
      availableAt: new Date(checkIn.getTime() - 48 * 60 * 60 * 1000)
    };
  }

  return { valid: true };
}

/**
 * Construit le contexte de requête
 */
function buildRequestContext(req) {
  return {
    userId: req.user?.userId,
    userRole: req.user?.role,
    ipAddress: req.ip || req.connection?.remoteAddress,
    userAgent: req.get('User-Agent'),
    timestamp: new Date(),
    deviceInfo: {
      mobile: req.get('User-Agent')?.includes('Mobile') || false,
      platform: req.get('User-Agent')?.match(/(iPhone|iPad|Android|Windows|Mac)/)?.[1] || 'Unknown'
    }
  };
}

/**
 * Construit les instructions de check-in
 */
function buildCheckInInstructions(booking, expiresAt) {
  return {
    title: 'QR Code Check-in',
    steps: [
      'Présentez ce QR code à la réception de l\'hôtel',
      'Le staff scannera le code pour votre check-in',
      'Votre chambre sera attribuée automatiquement',
      'Récupérez vos clés et profitez de votre séjour!'
    ],
    validity: `Valable jusqu'au ${new Date(expiresAt).toLocaleString('fr-FR')}`,
    support: 'Contactez la réception en cas de problème',
    hotel: {
      name: booking.hotel.name,
      phone: booking.hotel.phone || 'Non disponible'
    },
    important: [
      'Ne partagez pas ce QR code',
      'Présentez-vous avec une pièce d\'identité',
      'Le QR code peut être utilisé maximum 5 fois'
    ]
  };
}

/**
 * Valide les données spécifiques à un type de QR
 */
async function validateQRTypeData(type, data, user) {
  const validation = { valid: true, enrichedData: {} };

  switch (type) {
    case QR_TYPES.CHECK_IN:
      if (!data.bookingId || !data.hotelId) {
        validation.valid = false;
        validation.message = 'bookingId et hotelId requis pour check-in';
        validation.details = { missingFields: ['bookingId', 'hotelId'] };
        break;
      }

      // Vérifier que la réservation existe et appartient à l'utilisateur
      const bookingAccess = await validateBookingAccess(data.bookingId, user.userId, user.role);
      if (!bookingAccess.success) {
        validation.valid = false;
        validation.message = bookingAccess.message;
        validation.details = { bookingError: bookingAccess.code };
        break;
      }

      validation.enrichedData = {
        customerName: `${bookingAccess.booking.customer.firstName} ${bookingAccess.booking.customer.lastName}`,
        hotelName: bookingAccess.booking.hotel.name
      };
      break;

    case QR_TYPES.CHECK_OUT:
      if (!data.bookingId) {
        validation.valid = false;
        validation.message = 'bookingId requis pour check-out';
        break;
      }
      break;

    case QR_TYPES.ROOM_ACCESS:
      if (!data.roomId || !data.guestId) {
        validation.valid = false;
        validation.message = 'roomId et guestId requis pour accès chambre';
        break;
      }
      break;

    case QR_TYPES.PAYMENT:
      if (!data.amount || !data.currency) {
        validation.valid = false;
        validation.message = 'amount et currency requis pour paiement';
        break;
      }
      if (data.amount <= 0) {
        validation.valid = false;
        validation.message = 'Montant doit être positif';
        break;
      }
      break;

    case QR_TYPES.WIFI:
      if (!data.networkName) {
        validation.valid = false;
        validation.message = 'networkName requis pour WiFi';
        break;
      }
      break;

    default:
      // Types génériques - validation minimale
      break;
  }

  return validation;
}

/**
 * Vérifie les permissions par type de QR
 */
async function checkQRTypePermissions(type, user, data) {
  const check = { allowed: true, permissions: [] };

  // Vérifications de base par rôle
  const restrictedTypes = [QR_TYPES.ROOM_ACCESS, QR_TYPES.EMERGENCY];
  if (restrictedTypes.includes(type) && user.role === 'CLIENT') {
    check.allowed = false;
    check.message = 'Type de QR code non autorisé pour ce rôle';
    return check;
  }

  // Permissions spécifiques
  switch (type) {
    case QR_TYPES.PAYMENT:
      if (data.amount > 1000 && user.role === 'CLIENT') {
        check.allowed = false;
        check.message = 'Montant trop élevé pour génération automatique';
        return check;
      }
      check.permissions.push('payment_qr');
      break;

    case QR_TYPES.CHECK_IN:
      check.permissions.push('checkin_qr');
      break;

    case QR_TYPES.ROOM_ACCESS:
      if (!['RECEPTIONIST', 'ADMIN'].includes(user.role)) {
        check.allowed = false;
        check.message = 'Seul le personnel peut générer des QR d\'accès chambre';
        return check;
      }
      check.permissions.push('room_access_qr');
      break;
  }

  return check;
}

/**
 * Envoie les notifications de génération QR
 */
async function sendQRGenerationNotifications(userId, hotelId, qrResult, booking, type) {
  try {
    // Notification client
    await socketService.sendUserNotification(userId, 'QR_CODE_GENERATED', {
      type,
      bookingId: booking._id,
      hotelName: booking.hotel.name,
      expiresAt: qrResult.metadata.expiresAt,
      message: 'QR code de check-in généré avec succès!'
    });

    // Notification hôtel
    if (hotelId) {
      await socketService.sendHotelNotification(hotelId, 'QR_CODE_GENERATED', {
        type,
        bookingId: booking._id,
        customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
        generatedBy: userId,
        expiresAt: qrResult.metadata.expiresAt
      });
    }

    // Notification admins si type sensible
    const sensitiveTypes = [QR_TYPES.PAYMENT, QR_TYPES.ROOM_ACCESS];
    if (sensitiveTypes.includes(type)) {
      await socketService.sendAdminNotification('SENSITIVE_QR_GENERATED', {
        type,
        userId,
        bookingId: booking._id,
        amount: qrResult.data?.amount || null
      });
    }

  } catch (error) {
    logger.error('QR generation notification error:', error);
  }
}

/**
 * Effectue une validation contextuelle
 */
async function performContextualValidation(qrData, user, context) {
  const validation = { valid: true, details: {} };

  // Vérification IP si requise
  if (qrData.ipAddress && context.ipAddress && qrData.ipAddress !== context.ipAddress) {
    validation.details.ipMismatch = {
      original: qrData.ipAddress,
      current: context.ipAddress,
      severity: 'warning'
    };
  }

  // Vérification temporelle
  if (qrData.nbf && qrData.nbf > Math.floor(Date.now() / 1000)) {
    validation.valid = false;
    validation.message = 'Token pas encore valide';
    validation.details.notBefore = new Date(qrData.nbf * 1000);
    return validation;
  }

  // Vérification contextuelle par type
  if (qrData.type === QR_TYPES.CHECK_IN) {
    if (context.hotelId && qrData.hotelId !== context.hotelId) {
      validation.valid = false;
      validation.message = 'QR code ne correspond pas à cet hôtel';
      validation.details.hotelMismatch = {
        expected: context.hotelId,
        actual: qrData.hotelId
      };
      return validation;
    }
  }

  // Vérification des permissions par rôle
  const restrictedTypes = [QR_TYPES.ROOM_ACCESS, QR_TYPES.EMERGENCY];
  if (restrictedTypes.includes(qrData.type) && user.role === 'CLIENT') {
    validation.valid = false;
    validation.message = 'Type de QR code non autorisé pour ce rôle';
    validation.details.roleRestriction = {
      userRole: user.role,
      restrictedType: qrData.type
    };
    return validation;
  }

  return validation;
}

/**
 * Enrichit les données QR avec informations métier
 */
async function enrichQRData(qrData) {
  const enriched = {};

  try {
    if (qrData.type === QR_TYPES.CHECK_IN && qrData.bookingId) {
      const booking = await Booking.findById(qrData.bookingId)
        .populate('hotel', 'name phone')
        .populate('customer', 'firstName lastName');
      
      if (booking) {
        enriched.booking = {
          status: booking.status,
          checkInDate: booking.checkIn,
          checkOutDate: booking.checkOut,
          roomsCount: booking.rooms?.length || 0
        };
        enriched.hotel = {
          name: booking.hotel.name,
          phone: booking.hotel.phone
        };
        enriched.customer = {
          name: `${booking.customer.firstName} ${booking.customer.lastName}`
        };
      }
    }

    if (qrData.hotelId) {
      const hotel = await Hotel.findById(qrData.hotelId).select('name category');
      if (hotel) {
        enriched.hotelInfo = {
          name: hotel.name,
          category: hotel.category
        };
      }
    }

  } catch (error) {
    logger.error('QR data enrichment error:', error);
  }

  return enriched;
}

/**
 * Filtre les données sensibles
 */
function filterSensitiveData(data) {
  const { checksum, jti, iat, exp, ipAddress, deviceInfo, ...filtered } = data;
  return filtered;
}

/**
 * Envoie les notifications de validation QR
 */
async function sendQRValidationNotifications(qrData, validator, metadata) {
  try {
    // Notifier l'utilisateur original
    if (qrData.userId) {
      await socketService.sendUserNotification(qrData.userId, 'QR_CODE_VALIDATED', {
        type: qrData.type,
        identifier: qrData.identifier,
        validatedBy: validator.userId,
        validatedAt: new Date(),
        remainingUsage: metadata.remainingUsage
      });
    }

    // Log pour audit
    logger.info(`QR code validated: ${qrData.identifier} by ${validator.userId}`);

  } catch (error) {
    logger.error('QR validation notification error:', error);
  }
}

/**
 * Valide une réservation pour check-in
 */
async function validateBookingForCheckIn(bookingId, hotelId) {
  try {
    const booking = await Booking.findById(bookingId)
      .populate('customer', 'firstName lastName email phone')
      .populate('hotel', 'name code phone');

    if (!booking) {
      return {
        success: false,
        status: 404,
        message: 'Réservation non trouvée',
        code: 'BOOKING_NOT_FOUND'
      };
    }

    // Vérifier statut
    if (booking.status !== 'CONFIRMED') {
      return {
        success: false,
        status: 400,
        message: `Check-in impossible. Statut: ${booking.status}`,
        code: 'INVALID_BOOKING_STATUS',
        details: { currentStatus: booking.status, requiredStatus: 'CONFIRMED' }
      };
    }

    // Vérifier correspondance hôtel
    if (hotelId && booking.hotel._id.toString() !== hotelId) {
      return {
        success: false,
        status: 400,
        message: 'QR code ne correspond pas à cet hôtel',
        code: 'HOTEL_MISMATCH',
        details: { 
          expectedHotel: hotelId, 
          actualHotel: booking.hotel._id.toString(),
          hotelName: booking.hotel.name
        }
      };
    }

    return {
      success: true,
      booking
    };

  } catch (error) {
    logger.error('Booking check-in validation error:', error);
    return {
      success: false,
      status: 500,
      message: 'Erreur lors de la validation de la réservation',
      code: 'BOOKING_VALIDATION_ERROR'
    };
  }
}

/**
 * Met à jour la réservation après check-in
 */
async function updateBookingAfterCheckIn(booking, receptionistId, options) {
  try {
    booking.status = 'CHECKED_IN';
    booking.actualCheckInDate = new Date();
    booking.checkedInBy = receptionistId;
    booking.checkInMethod = 'QR_CODE';
    booking.guestNotes = options.guestNotes || '';
    
    if (options.additionalServices?.length > 0) {
      booking.additionalServices = options.additionalServices;
    }

    await booking.save();
    
    logger.info(`Booking ${booking._id} updated after QR check-in`);
    return booking;

  } catch (error) {
    logger.error('Booking update after check-in error:', error);
    throw error;
  }
}

/**
 * Envoie des notifications complètes de check-in
 */
async function sendComprehensiveCheckInNotifications(booking, receptionistId, roomAssignments, tokenId) {
  try {
    const notificationData = {
      bookingId: booking._id,
      customerName: `${booking.customer.firstName} ${booking.customer.lastName}`,
      hotelName: booking.hotel.name,
      checkInTime: booking.actualCheckInDate,
      method: 'QR_CODE',
      processedBy: receptionistId,
      roomsAssigned: roomAssignments.length,
      tokenId
    };

    // Notifier le client
    await socketService.sendUserNotification(booking.customer._id, 'QR_CHECKIN_SUCCESS', {
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
    await socketService.sendHotelNotification(booking.hotel._id, 'QR_CHECKIN_COMPLETED', {
      ...notificationData,
      customerContact: {
        email: booking.customer.email,
        phone: booking.customer.phone
      },
      specialRequests: booking.specialRequests,
      roomPreparation: roomAssignments.length > 0 ? 'Chambres assignées' : 'Attribution en cours'
    });

    // Notifier les admins
    await socketService.sendAdminNotification('QR_CHECKIN_PROCESSED', {
      ...notificationData,
      efficiency: 'HIGH', // QR check-in is faster
      systemUsage: 'QR_CODE_CHECKIN'
    });

  } catch (error) {
    logger.error('Check-in notifications error:', error);
  }
}

/**
 * Construit la réponse de succès du check-in
 */
function buildCheckInSuccessResponse(booking, checkInResult, tokenMetadata, roomAssignments, receptionistId) {
  return {
    success: true,
    message: 'Check-in QR traité avec succès',
    data: {
      booking: {
        id: booking._id,
        confirmationNumber: booking.bookingNumber,
        customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
        hotel: booking.hotel.name,
        checkInTime: booking.actualCheckInDate,
        status: booking.status
      },
      qrProcessing: {
        tokenUsed: tokenMetadata.tokenId,
        remainingUsage: Math.max(0, tokenMetadata.remainingUsage - 1),
        method: 'QR_CODE',
        processedAt: new Date()
      },
      roomInfo: {
        assigned: roomAssignments.length,
        total: booking.rooms?.length || 0,
        assignmentStatus: roomAssignments.length > 0 ? 'COMPLETED' : 'PENDING',
        assignments: roomAssignments
      },
      workflow: {
        checkInCompleted: true,
        paymentStatus: booking.payment?.status || 'PENDING',
        keyCollection: 'REQUIRED',
        housekeepingNotified: true
      },
      nextSteps: {
        staff: [
          'Remettez les clés au client',
          'Vérifiez la propreté des chambres',
          'Informez sur les services de l\'hôtel'
        ],
        guest: [
          'Récupération des clés',
          'Installation en chambre',
          'Découverte des services'
        ]
      },
      notifications: {
        customerNotified: true,
        hotelTeamNotified: true,
        adminNotified: true,
        checkInTime: new Date()
      }
    }
  };
}

/**
 * Parse une période en millisecondes
 */
function parsePeriod(period) {
  const periodMap = {
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
    '90d': 90 * 24 * 60 * 60 * 1000
  };
  
  return periodMap[period] || periodMap['7d'];
}

/**
 * Analyse les événements QR d'un utilisateur
 */
function analyzeQREvents(events) {
  const analysis = {
    creationEvent: events.find(e => e.event === 'QR_GENERATED'),
    validationEvents: events.filter(e => e.event === 'QR_VALIDATED'),
    usageEvents: events.filter(e => e.event === 'QR_USED'),
    errorEvents: events.filter(e => e.event.includes('FAILED')),
    lastEvent: events[events.length - 1]
  };

  return analysis;
}

/**
 * Construit le statut d'un QR code
 */
function buildQRStatus(identifier, analysis, events) {
  const status = {
    identifier,
    type: analysis.creationEvent?.data?.type,
    bookingId: analysis.creationEvent?.data?.bookingId,
    created: {
      at: analysis.creationEvent?.timestamp,
      by: analysis.creationEvent?.data?.userId,
      expiresAt: analysis.creationEvent?.data?.expiresAt
    },
    usage: {
      validations: analysis.validationEvents.length,
      uses: analysis.usageEvents.length,
      errors: analysis.errorEvents.length,
      lastActivity: analysis.lastEvent?.timestamp,
      lastActivityType: analysis.lastEvent?.event
    },
    current: {
      status: determineQRStatus(events),
      isExpired: analysis.creationEvent?.data?.expiresAt ? 
        new Date(analysis.creationEvent.data.expiresAt) < new Date() : false,
      isActive: isQRActive(events),
      securityLevel: calculateQRSecurityLevel(events)
    },
    timeline: events.map(event => ({
      event: event.event,
      timestamp: event.timestamp,
      context: event.context?.summary || 'N/A'
    }))
  };

  return status;
}

/**
 * Détermine le statut d'un QR code
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
  const status = determineQRStatus(events);
  return ['active', 'used'].includes(status);
}

/**
 * Calcule le niveau de sécurité d'un QR
 */
function calculateQRSecurityLevel(events) {
  const errorCount = events.filter(e => e.event.includes('FAILED')).length;
  const validationCount = events.filter(e => e.event === 'QR_VALIDATED').length;
  const ipChanges = new Set(events.map(e => e.context?.ipAddress).filter(Boolean)).size;

  if (errorCount > 5) return 'HIGH_RISK';
  if (ipChanges > 3) return 'MEDIUM_RISK';
  if (validationCount > 10) return 'MONITORED';
  return 'NORMAL';
}

/**
 * Calcule le niveau de sécurité général
 */
function calculateSecurityLevel(events) {
  return calculateQRSecurityLevel(events);
}

/**
 * Groupe les événements QR par identifiant
 */
function groupQREventsByIdentifier(userQREvents, auditLog) {
  const qrCodesMap = {};

  userQREvents.forEach(event => {
    const identifier = event.data.identifier;
    if (!qrCodesMap[identifier]) {
      qrCodesMap[identifier] = {
        identifier,
        type: event.data.type,
        bookingId: event.data.bookingId,
        createdAt: event.timestamp,
        expiresAt: event.data.expiresAt,
        events: []
      };
    }
    
    // Ajouter tous les événements pour ce QR
    const allEvents = auditLog.filter(e => e.data.identifier === identifier);
    qrCodesMap[identifier].events = allEvents;
  });

  return qrCodesMap;
}

/**
 * Trie les QR codes
 */
function sortQRCodes(qrList, sortBy, sortOrder) {
  return qrList.sort((a, b) => {
    let aVal, bVal;
    
    switch (sortBy) {
      case 'createdAt':
        aVal = new Date(a.createdAt);
        bVal = new Date(b.createdAt);
        break;
      case 'expiresAt':
        aVal = new Date(a.expiresAt || 0);
        bVal = new Date(b.expiresAt || 0);
        break;
      case 'usageCount':
        aVal = a.usageCount || 0;
        bVal = b.usageCount || 0;
        break;
      case 'type':
        aVal = a.type || '';
        bVal = b.type || '';
        break;
      default:
        aVal = new Date(a.createdAt);
        bVal = new Date(b.createdAt);
    }

    if (sortOrder === 'asc') {
      return aVal > bVal ? 1 : -1;
    } else {
      return aVal < bVal ? 1 : -1;
    }
  });
}

/**
 * Génère un résumé des QR codes
 */
function generateQRSummary(qrList) {
  const summary = {
    total: qrList.length,
    byStatus: {},
    byType: {},
    totalUsage: 0,
    activeCount: 0,
    expiredCount: 0
  };

  qrList.forEach(qr => {
    // Par statut
    summary.byStatus[qr.status] = (summary.byStatus[qr.status] || 0) + 1;
    
    // Par type
    summary.byType[qr.type] = (summary.byType[qr.type] || 0) + 1;
    
    // Totaux
    summary.totalUsage += qr.usageCount || 0;
    if (qr.isActive) summary.activeCount++;
    if (qr.status === 'expired') summary.expiredCount++;
  });

  return summary;
}

/**
 * Obtient des informations basiques sur une réservation
 */
async function getBookingBasicInfo(bookingId) {
  try {
    const booking = await Booking.findById(bookingId)
      .select('bookingNumber status checkIn checkOut')
      .populate('hotel', 'name')
      .populate('customer', 'firstName lastName');

    if (!booking) return null;

    return {
      confirmationNumber: booking.bookingNumber,
      status: booking.status,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      hotel: booking.hotel?.name,
      customer: booking.customer ? `${booking.customer.firstName} ${booking.customer.lastName}` : null
    };
  } catch (error) {
    logger.error('Error getting booking basic info:', error);
    return null;
  }
}

/**
 * Obtient des informations sur le statut d'une réservation
 */
async function getBookingStatusInfo(bookingId) {
  try {
    const booking = await Booking.findById(bookingId)
      .select('status actualCheckInDate actualCheckOutDate')
      .populate('hotel', 'name');

    if (!booking) return null;

    return {
      status: booking.status,
      checkInDate: booking.actualCheckInDate,
      checkOutDate: booking.actualCheckOutDate,
      hotel: booking.hotel?.name
    };
  } catch (error) {
    logger.error('Error getting booking status info:', error);
    return null;
  }
}

/**
 * Valide les payloads en lot
 */
async function validateBatchPayloads(payloads, user) {
  const results = {
    validCount: 0,
    invalidCount: 0,
    errors: []
  };

  for (let i = 0; i < payloads.length; i++) {
    const payload = payloads[i];
    
    try {
      const validation = await validateQRTypeData(payload.type, payload, user);
      
      if (validation.valid) {
        results.validCount++;
      } else {
        results.invalidCount++;
        results.errors.push({
          index: i,
          identifier: payload.identifier,
          error: validation.message,
          details: validation.details
        });
      }
    } catch (error) {
      results.invalidCount++;
      results.errors.push({
        index: i,
        identifier: payload.identifier,
        error: 'Erreur de validation',
        details: error.message
      });
    }
  }

  return results;
}

/**
 * Analyse les résultats de génération en lot
 */
function analyzeBatchResults(batchResult) {
  const analysis = {
    successRate: Math.round((batchResult.successful / batchResult.total) * 100),
    failureRate: Math.round((batchResult.failed / batchResult.total) * 100),
    errors: {},
    types: {}
  };

  // Analyser les erreurs
  batchResult.results.filter(r => !r.success).forEach(result => {
    const errorCode = result.code || 'UNKNOWN_ERROR';
    analysis.errors[errorCode] = (analysis.errors[errorCode] || 0) + 1;
  });

  // Analyser les types
  batchResult.results.filter(r => r.success).forEach(result => {
    const type = result.type || 'UNKNOWN_TYPE';
    analysis.types[type] = (analysis.types[type] || 0) + 1;
  });

  return analysis;
}

/**
 * Obtient des informations sur un token
 */
async function getTokenInfo(tokenId) {
  try {
    const auditLog = getAuditLog(500);
    const tokenEvent = auditLog.find(entry => 
      entry.event === 'QR_GENERATED' && 
      entry.data.tokenId === tokenId
    );

    if (!tokenEvent) return null;

    return {
      tokenId,
      userId: tokenEvent.data.userId,
      type: tokenEvent.data.type,
      identifier: tokenEvent.data.identifier,
      createdAt: tokenEvent.timestamp
    };
  } catch (error) {
    logger.error('Error getting token info:', error);
    return null;
  }
}

/**
 * Obtient les utilisateurs les plus actifs en QR
 */
function getTopQRUsers(auditLog, limit = 10) {
  const userActivity = auditLog
    .filter(entry => entry.data.userId)
    .reduce((acc, entry) => {
      const userId = entry.data.userId;
      if (!acc[userId]) {
        acc[userId] = {
          userId,
          totalActivity: 0,
          generations: 0,
          validations: 0,
          usages: 0
        };
      }
      
      acc[userId].totalActivity++;
      
      switch (entry.event) {
        case 'QR_GENERATED':
          acc[userId].generations++;
          break;
        case 'QR_VALIDATED':
          acc[userId].validations++;
          break;
        case 'QR_USED':
          acc[userId].usages++;
          break;
      }
      
      return acc;
    }, {});

  return Object.values(userActivity)
    .sort((a, b) => b.totalActivity - a.totalActivity)
    .slice(0, limit);
}

/**
 * Génère des statistiques temporelles
 */
function generateTemporalStats(events, period) {
  const stats = {
    hourly: {},
    daily: {},
    weekly: {}
  };

  events.forEach(event => {
    const date = new Date(event.timestamp);
    const hour = date.getHours();
    const day = date.toISOString().split('T')[0];
    const week = getWeekNumber(date);

    stats.hourly[hour] = (stats.hourly[hour] || 0) + 1;
    stats.daily[day] = (stats.daily[day] || 0) + 1;
    stats.weekly[week] = (stats.weekly[week] || 0) + 1;
  });

  return stats;
}

/**
 * Calcule les métriques de performance
 */
function calculatePerformanceMetrics(events) {
  const metrics = {
    totalEvents: events.length,
    averageEventsPerHour: 0,
    peakHour: null,
    errorRate: 0,
    mostActiveType: null
  };

  if (events.length === 0) return metrics;

  // Calculer les événements par heure
  const hourlyEvents = {};
  const eventTypes = {};
  let errorCount = 0;

  events.forEach(event => {
    const hour = new Date(event.timestamp).getHours();
    hourlyEvents[hour] = (hourlyEvents[hour] || 0) + 1;
    
    const type = event.data.type || 'unknown';
    eventTypes[type] = (eventTypes[type] || 0) + 1;
    
    if (event.event.includes('FAILED')) {
      errorCount++;
    }
  });

  // Heure de pic
  const maxHour = Object.entries(hourlyEvents).reduce((a, b) => 
    hourlyEvents[a[0]] > hourlyEvents[b[0]] ? a : b
  );
  metrics.peakHour = {
    hour: parseInt(maxHour[0]),
    count: maxHour[1]
  };

  // Moyenne par heure
  metrics.averageEventsPerHour = Math.round(events.length / 24 * 100) / 100;

  // Taux d'erreur
  metrics.errorRate = Math.round((errorCount / events.length) * 100 * 100) / 100;

  // Type le plus actif
  const mostActiveType = Object.entries(eventTypes).reduce((a, b) => 
    eventTypes[a[0]] > eventTypes[b[0]] ? a : b
  );
  metrics.mostActiveType = {
    type: mostActiveType[0],
    count: mostActiveType[1]
  };

  return metrics;
}

/**
 * Génère des alertes système
 */
function generateSystemAlerts(serviceStats, performanceMetrics) {
  const alerts = [];

  // Alerte taux d'erreur élevé
  if (performanceMetrics.errorRate > 10) {
    alerts.push({
      type: 'HIGH_ERROR_RATE',
      severity: 'warning',
      message: `Taux d'erreur élevé: ${performanceMetrics.errorRate}%`,
      threshold: 10,
      current: performanceMetrics.errorRate
    });
  }

  // Alerte surcharge système
  if (serviceStats.activeProcesses > 100) {
    alerts.push({
      type: 'HIGH_LOAD',
      severity: 'warning',
      message: `Charge système élevée: ${serviceStats.activeProcesses} processus actifs`,
      threshold: 100,
      current: serviceStats.activeProcesses
    });
  }

  // Alerte queue de traitement
  if (serviceStats.queueSize > 50) {
    alerts.push({
      type: 'LARGE_QUEUE',
      severity: 'info',
      message: `Queue de traitement importante: ${serviceStats.queueSize} éléments`,
      threshold: 50,
      current: serviceStats.queueSize
    });
  }

  return alerts;
}

/**
 * Obtient les erreurs récentes
 */
function getRecentErrors(auditLog, limit = 20) {
  return auditLog
    .filter(entry => entry.event.includes('FAILED') || entry.error)
    .slice(0, limit)
    .map(entry => ({
      timestamp: entry.timestamp,
      event: entry.event,
      error: entry.error,
      context: entry.context,
      userId: entry.data?.userId
    }));
}

/**
 * Obtient les principales raisons d'échec
 */
function getTopFailureReasons(auditLog) {
  const failures = auditLog.filter(entry => entry.event.includes('FAILED') || entry.error);
  const reasons = {};

  failures.forEach(failure => {
    const reason = failure.error || failure.data?.error || 'Unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;
  });

  return Object.entries(reasons)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }));
}

/**
 * Obtient les incidents de sécurité
 */
function getSecurityIncidents(auditLog) {
  const securityEvents = [
    'QR_VALIDATION_FAILED',
    'QR_REVOKED',
    'QR_USAGE_EXCEEDED',
    'QR_INTEGRITY_FAILED'
  ];

  return auditLog
    .filter(entry => securityEvents.includes(entry.event))
    .slice(0, 20)
    .map(entry => ({
      timestamp: entry.timestamp,
      event: entry.event,
      severity: getSeverityLevel(entry),
      userId: entry.data?.userId,
      details: entry.context
    }));
}

/**
 * Détecte des patterns anormaux
 */
function detectUnusualPatterns(auditLog) {
  const patterns = [];

  // Pattern: Trop de générations par utilisateur
  const userGenerations = {};
  auditLog.filter(e => e.event === 'QR_GENERATED').forEach(event => {
    const userId = event.data.userId;
    userGenerations[userId] = (userGenerations[userId] || 0) + 1;
  });

  Object.entries(userGenerations).forEach(([userId, count]) => {
    if (count > 20) {
      patterns.push({
        type: 'HIGH_GENERATION_RATE',
        userId,
        count,
        severity: 'warning',
        description: `Utilisateur a généré ${count} QR codes`
      });
    }
  });

  // Pattern: Échecs répétés de validation
  const userFailures = {};
  auditLog.filter(e => e.event === 'QR_VALIDATION_FAILED').forEach(event => {
    const userId = event.data.userId;
    userFailures[userId] = (userFailures[userId] || 0) + 1;
  });

  Object.entries(userFailures).forEach(([userId, count]) => {
    if (count > 5) {
      patterns.push({
        type: 'HIGH_VALIDATION_FAILURE',
        userId,
        count,
        severity: 'warning',
        description: `Utilisateur a ${count} échecs de validation`
      });
    }
  });

  return patterns;
}

/**
 * Détermine le niveau de sévérité
 */
function getSeverityLevel(entry) {
  if (entry.event.includes('FAILED')) return 'error';
  if (entry.event === 'QR_REVOKED') return 'warning';
  if (entry.event.includes('EXCEEDED')) return 'warning';
  return 'info';
}

/**
 * Enrichit les logs d'audit
 */
async function enrichAuditLogs(auditLog) {
  const enrichedLogs = [];

  for (const log of auditLog) {
    const enriched = {
      ...log,
      severity: getSeverityLevel(log),
      enriched: {}
    };

    // Enrichir avec info utilisateur si disponible
    if (log.data?.userId) {
      try {
        const user = await User.findById(log.data.userId).select('firstName lastName email role');
        if (user) {
          enriched.enriched.user = {
            name: `${user.firstName} ${user.lastName}`,
            email: user.email,
            role: user.role
          };
        }
      } catch (error) {
        // Ignore user enrichment errors
      }
    }

    // Enrichir avec info réservation si disponible
    if (log.data?.bookingId) {
      try {
        const booking = await Booking.findById(log.data.bookingId)
          .select('bookingNumber status')
          .populate('hotel', 'name');
        if (booking) {
          enriched.enriched.booking = {
            confirmationNumber: booking.bookingNumber,
            status: booking.status,
            hotel: booking.hotel?.name
          };
        }
      } catch (error) {
        // Ignore booking enrichment errors
      }
    }

    enrichedLogs.push(enriched);
  }

  return enrichedLogs;
}

/**
 * Obtient le numéro de semaine
 */
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // QR Generation
  generateCheckInQR,
  generateGenericQR,
  
  // QR Validation
  validateQR,
  
  // QR Check-in Processing
  processQRCheckIn,
  
  // QR Status Tracking
  getQRStatus,
  getUserQRCodes,
  
  // Batch Operations
  generateBatchQR,
  
  // Admin Management
  revokeQRCode,
  getQRStats,
  getQRAuditLogs,
  
  // Utility Functions (for testing/reuse)
  validateBookingAccess,
  validateCheckInTiming,
  buildRequestContext,
  validateQRTypeData,
  checkQRTypePermissions,
  performContextualValidation,
  enrichQRData,
  filterSensitiveData,
  determineQRStatus,
  isQRActive,
  calculateQRSecurityLevel
};