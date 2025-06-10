/**
 * LOYALTY CONTROLLER - CONTRÔLEUR PROGRAMME DE FIDÉLITÉ
 * 
 * Endpoints complets pour la gestion du programme de fidélité :
 * - Statut et informations utilisateur
 * - Historique des transactions
 * - Utilisation de points (réductions, upgrades, bénéfices)
 * - Analytics et dashboard
 * - Administration (ajustements, campagnes)
 * - Notifications temps réel
 * - Intégration système de réservation
 */

const mongoose = require('mongoose');
const { validationResult, body, param, query } = require('express-validator');

// Modèles
const User = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');

// Services
const { getLoyaltyService, quickAwardPoints, quickRedeemPoints, quickGetStatus, checkDiscountEligibility } = require('../services/loyaltyService');
const socketService = require('../services/socketService');
const emailService = require('../services/emailService');

// Utilitaires
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');
const { logger } = require('../utils/logger');
const { formatResponse, formatErrorResponse } = require('../utils/responseFormatter');

/**
 * CLASSE PRINCIPALE DU CONTRÔLEUR
 */
class LoyaltyController {
  constructor() {
    this.loyaltyService = getLoyaltyService();
    
    // Configuration pagination par défaut
    this.defaultPagination = {
      page: 1,
      limit: 20,
      maxLimit: 100
    };

    // Cache pour optimiser les requêtes fréquentes
    this.cache = new Map();
    this.cacheExpiry = 5 * 60 * 1000; // 5 minutes
  }

  // ============================================================================
  // STATUT ET INFORMATIONS UTILISATEUR
  // ============================================================================

  /**
   * GET /api/loyalty/status
   * Obtenir le statut complet du programme de fidélité de l'utilisateur
   */
  getMyLoyaltyStatus = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { skipCache = false } = req.query;

    try {
      const loyaltyStatus = await quickGetStatus(userId, skipCache === 'true');

      // Enrichir avec données temps réel
      const realtimeData = await this.enrichWithRealtimeData(userId, loyaltyStatus);

      // Notifications actives
      const activeNotifications = await this.getActiveNotifications(userId);

      const response = {
        success: true,
        data: {
          ...loyaltyStatus,
          realtime: realtimeData,
          notifications: activeNotifications,
          lastUpdated: new Date()
        },
        meta: {
          version: '2.0',
          features: ['points', 'tiers', 'benefits', 'redemption', 'analytics']
        }
      };

      // Notification temps réel de consultation
      socketService.sendUserNotification(userId, 'LOYALTY_STATUS_VIEWED', {
        tier: loyaltyStatus.user.tier,
        points: loyaltyStatus.user.currentPoints,
        timestamp: new Date()
      });

      res.status(200).json(formatResponse(response));
    } catch (error) {
      logger.error('Erreur récupération statut loyalty:', error);
      throw new AppError('Erreur lors de la récupération du statut fidélité', 500);
    }
  });

  /**
   * GET /api/loyalty/dashboard
   * Dashboard personnalisé avec métriques et insights
   */
  getLoyaltyDashboard = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { period = '30d' } = req.query;

    try {
      const cacheKey = `dashboard_${userId}_${period}`;
      let dashboardData = this.getFromCache(cacheKey);

      if (!dashboardData) {
        // Données de base
        const [loyaltyStatus, recentActivity, analytics, goals] = await Promise.all([
          quickGetStatus(userId, true),
          this.getRecentActivity(userId, 5),
          this.getUserAnalytics(userId, period),
          this.getUserGoals(userId)
        ]);

        // Recommandations personnalisées
        const recommendations = await this.generatePersonalizedRecommendations(userId, loyaltyStatus);

        // Prochaines échéances
        const upcomingEvents = await this.getUpcomingEvents(userId);

        dashboardData = {
          overview: {
            currentPoints: loyaltyStatus.user.currentPoints,
            tier: loyaltyStatus.user.tier,
            tierDisplay: loyaltyStatus.user.tierDisplay,
            progressToNext: loyaltyStatus.user.tierProgress,
            memberSince: loyaltyStatus.user.memberSince,
            estimatedValue: Math.round((loyaltyStatus.user.currentPoints / 100) * 100) / 100
          },
          activity: {
            recent: recentActivity,
            analytics: analytics,
            performance: loyaltyStatus.performance
          },
          opportunities: {
            recommendations: recommendations,
            upcoming: upcomingEvents,
            goals: goals
          },
          benefits: {
            active: loyaltyStatus.benefits.active,
            available: loyaltyStatus.redemption.options.slice(0, 6),
            next: loyaltyStatus.benefits.next
          },
          insights: await this.generateUserInsights(userId, analytics)
        };

        this.setCache(cacheKey, dashboardData);
      }

      res.status(200).json(formatResponse({
        success: true,
        data: dashboardData,
        generatedAt: new Date()
      }));
    } catch (error) {
      logger.error('Erreur dashboard loyalty:', error);
      throw new AppError('Erreur lors de la génération du dashboard', 500);
    }
  });

  /**
   * GET /api/loyalty/summary
   * Résumé rapide pour header/widget
   */
  getLoyaltySummary = asyncHandler(async (req, res) => {
    const userId = req.user.id;

    try {
      const user = await User.findById(userId)
        .select('firstName loyalty')
        .lean();

      if (!user?.loyalty) {
        return res.status(200).json(formatResponse({
          success: true,
          data: {
            enrolled: false,
            message: 'Non inscrit au programme de fidélité'
          }
        }));
      }

      // Points qui expirent bientôt
      const expiringPoints = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            pointsAmount: { $gt: 0 },
            status: 'COMPLETED',
            expiresAt: {
              $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 jours
              $gt: new Date()
            }
          }
        },
        {
          $group: {
            _id: null,
            totalExpiring: { $sum: '$pointsAmount' },
            nextExpiry: { $min: '$expiresAt' }
          }
        }
      ]);

      const summary = {
        enrolled: true,
        user: {
          name: user.firstName,
          tier: user.loyalty.tier,
          tierDisplay: this.getTierDisplayName(user.loyalty.tier),
          tierIcon: this.getTierIcon(user.loyalty.tier)
        },
        points: {
          current: user.loyalty.currentPoints,
          lifetime: user.loyalty.lifetimePoints,
          estimatedValue: Math.round((user.loyalty.currentPoints / 100) * 100) / 100,
          expiring: expiringPoints[0]?.totalExpiring || 0,
          nextExpiry: expiringPoints[0]?.nextExpiry
        },
        progress: user.loyalty.tierProgress,
        quickActions: this.getQuickActions(user.loyalty)
      };

      res.status(200).json(formatResponse({
        success: true,
        data: summary
      }));
    } catch (error) {
      logger.error('Erreur résumé loyalty:', error);
      throw new AppError('Erreur lors de la récupération du résumé', 500);
    }
  });

  // ============================================================================
  // HISTORIQUE ET TRANSACTIONS
  // ============================================================================

  /**
   * GET /api/loyalty/history
   * Historique détaillé des transactions avec filtres
   */
  getLoyaltyHistory = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const {
      page = 1,
      limit = 20,
      type,
      status = 'COMPLETED',
      startDate,
      endDate,
      groupBy = 'none'
    } = req.query;

    // Validation pagination
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit) || 20, this.defaultPagination.maxLimit);

    try {
      const query = { user: userId };
      
      // Filtres
      if (type && type !== 'ALL') {
        if (type === 'EARNINGS') {
          query.pointsAmount = { $gt: 0 };
        } else if (type === 'REDEMPTIONS') {
          query.pointsAmount = { $lt: 0 };
        } else {
          query.type = type;
        }
      }
      
      if (status && status !== 'ALL') query.status = status;
      
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      // Exécution des requêtes en parallèle
      const [transactions, totalCount, summary] = await Promise.all([
        LoyaltyTransaction.find(query)
          .sort({ createdAt: -1, _id: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .populate('booking', 'bookingNumber totalPrice checkInDate hotelName')
          .populate('hotel', 'name code city')
          .populate('processedBy', 'firstName lastName role')
          .lean(),
        LoyaltyTransaction.countDocuments(query),
        this.calculateHistorySummary(userId, query)
      ]);

      // Enrichir les transactions
      const enrichedTransactions = await this.enrichTransactions(transactions);

      // Groupement optionnel
      let groupedData = null;
      if (groupBy === 'month') {
        groupedData = this.groupTransactionsByMonth(enrichedTransactions);
      } else if (groupBy === 'type') {
        groupedData = this.groupTransactionsByType(enrichedTransactions);
      }

      const response = {
        success: true,
        data: {
          transactions: enrichedTransactions,
          grouped: groupedData,
          summary: summary,
          filters: {
            type: type || 'ALL',
            status: status || 'ALL',
            period: { startDate, endDate }
          }
        },
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalCount / limitNum),
          totalItems: totalCount,
          itemsPerPage: limitNum,
          hasNext: pageNum * limitNum < totalCount,
          hasPrev: pageNum > 1
        },
        meta: {
          queryExecutedAt: new Date(),
          processingTime: Date.now()
        }
      };

      res.status(200).json(formatResponse(response));
    } catch (error) {
      logger.error('Erreur historique transactions:', error);
      throw new AppError('Erreur lors de la récupération de l\'historique', 500);
    }
  });

  /**
   * GET /api/loyalty/transaction/:transactionId
   * Détails d'une transaction spécifique
   */
  getTransactionDetails = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { transactionId } = req.params;

    try {
      const transaction = await LoyaltyTransaction.findOne({
        _id: transactionId,
        user: userId
      })
      .populate('booking', 'bookingNumber totalPrice checkInDate checkOutDate hotelName rooms status')
      .populate('hotel', 'name code address city phone email')
      .populate('processedBy', 'firstName lastName role email')
      .populate('relatedTransactions')
      .lean();

      if (!transaction) {
        throw new AppError('Transaction non trouvée', 404);
      }

      // Enrichir avec informations supplémentaires
      const enrichedTransaction = await this.enrichSingleTransaction(transaction);

      // Transactions liées (ex: annulations, ajustements)
      const relatedTransactions = await LoyaltyTransaction.find({
        $or: [
          { parentTransaction: transactionId },
          { _id: { $in: transaction.relatedTransactions || [] } }
        ]
      }).lean();

      const response = {
        success: true,
        data: {
          transaction: enrichedTransaction,
          related: relatedTransactions,
          metadata: {
            canCancel: this.canCancelTransaction(transaction),
            canRefund: this.canRefundTransaction(transaction),
            hasReceipt: !!transaction.booking
          }
        }
      };

      res.status(200).json(formatResponse(response));
    } catch (error) {
      logger.error('Erreur détails transaction:', error);
      throw new AppError('Erreur lors de la récupération des détails', 500);
    }
  });

  // ============================================================================
  // UTILISATION DE POINTS
  // ============================================================================

  /**
   * GET /api/loyalty/redemption/options
   * Options d'utilisation disponibles selon le solde et niveau
   */
  getRedemptionOptions = asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const { bookingId, category = 'ALL' } = req.query;

    try {
      const user = await User.findById(userId).select('loyalty').lean();
      
      if (!user?.loyalty) {
        throw new AppError('Utilisateur non inscrit au programme fidélité', 404);
      }

      // Options générales basées sur le solde et niveau
      const baseOptions = this.loyaltyService.getRedemptionOptions(
        user.loyalty.currentPoints, 
        user.loyalty.tier
      );

      // Enrichir avec informations spécifiques à la réservation
      let bookingSpecificOptions = [];
      if (bookingId) {
        bookingSpecificOptions = await this.getBookingSpecificOptions(bookingId, user);
      }

      // Filtrer par catégorie si spécifiée
      const filteredOptions = this.filterOptionsByCategory(
        [...baseOptions, ...bookingSpecificOptions], 
        category
      );

      // Calculer économies potentielles
      const savingsCalculation = this.calculatePotentialSavings(user.loyalty.currentPoints);

      const response = {
        success: true,
        data: {
          currentPoints: user.loyalty.currentPoints,
          tier: user.loyalty.tier,
          options: filteredOptions,
          categories: ['DISCOUNT', 'UPGRADE', 'BENEFITS', 'EXPERIENCES'],
          savings: savingsCalculation,
          recommendations: this.getRedemptionRecommendations(user.loyalty, filteredOptions)
        },
        meta: {
          pointsValue: Math.round((user.loyalty.currentPoints / 100) * 100) / 100,
          tier: user.loyalty.tier,
          hasBookingContext: !!bookingId
        }
      };

      res.status(200).json(formatResponse(response));
    } catch (error) {
      logger.error('Erreur options utilisation:', error);
      throw new AppError('Erreur lors de la récupération des options', 500);
    }
  });

  /**
   * POST /api/loyalty/redeem/discount
   * Utiliser des points pour une réduction
   */
  redeemForDiscount = [
    body('pointsToRedeem')
      .isInt({ min: 100, max: 10000 })
      .withMessage('Points à utiliser invalides (100-10000)'),
    body('bookingId')
      .isMongoId()
      .withMessage('ID de réservation invalide'),
    body('discountAmount')
      .isFloat({ min: 1, max: 100 })
      .withMessage('Montant réduction invalide'),

    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Données de réduction invalides', 400, errors.array());
      }

      const userId = req.user.id;
      const { pointsToRedeem, bookingId, discountAmount, applyImmediately = false } = req.body;

      const session = await mongoose.startSession();

      try {
        const result = await session.withTransaction(async () => {
          // Vérifications préliminaires
          const [user, booking] = await Promise.all([
            User.findById(userId).session(session),
            Booking.findById(bookingId).session(session)
          ]);

          if (!user?.loyalty) {
            throw new AppError('Utilisateur non inscrit au programme fidélité', 404);
          }

          if (!booking || booking.customer.toString() !== userId) {
            throw new AppError('Réservation non trouvée ou non autorisée', 404);
          }

          // Vérifier éligibilité
          const eligibilityCheck = await checkDiscountEligibility(userId, discountAmount);
          if (!eligibilityCheck.eligible) {
            throw new AppError(`Réduction non disponible: ${eligibilityCheck.reason}`, 400);
          }

          // Utiliser les points
          const redemption = await quickRedeemPoints(
            userId, 
            pointsToRedeem, 
            bookingId, 
            { source: 'WEB', applyImmediately }
          );

          // Appliquer la réduction à la réservation si demandé
          if (applyImmediately && booking.status === 'PENDING') {
            booking.discounts = booking.discounts || [];
            booking.discounts.push({
              type: 'LOYALTY_POINTS',
              amount: discountAmount,
              description: `Réduction fidélité - ${pointsToRedeem} points`,
              transactionId: redemption.transactionId
            });

            booking.totalPrice = Math.max(0, booking.totalPrice - discountAmount);
            await booking.save({ session });
          }

          return {
            redemption,
            booking: applyImmediately ? booking : null,
            savings: discountAmount
          };
        });

        // Notifications temps réel
        socketService.sendUserNotification(userId, 'DISCOUNT_REDEEMED', {
          pointsUsed: pointsToRedeem,
          discountAmount,
          bookingId,
          newBalance: result.redemption.remainingPoints,
          message: `Réduction de ${discountAmount}€ appliquée !`,
          applied: applyImmediately
        });

        // Email de confirmation
        const user = await User.findById(userId).select('firstName lastName email');
        if (user) {
          await emailService.sendEmail({
            to: user.email,
            template: 'loyalty-redemption',
            data: {
              user: { firstName: user.firstName },
              redemption: {
                type: 'discount',
                pointsUsed: pointsToRedeem,
                value: discountAmount,
                applied: applyImmediately
              },
              booking: { id: bookingId }
            }
          });
        }

        res.status(200).json(formatResponse({
          success: true,
          data: result,
          message: `${discountAmount}€ de réduction obtenue avec ${pointsToRedeem} points`
        }));

      } catch (error) {
        logger.error('Erreur utilisation points réduction:', error);
        throw error;
      } finally {
        await session.endSession();
      }
    })
  ];

  /**
   * POST /api/loyalty/redeem/upgrade
   * Utiliser des points pour un upgrade
   */
  redeemForUpgrade = [
    body('upgradeType')
      .isIn(['ROOM_CATEGORY', 'VIEW', 'FLOOR_HIGH', 'SUITE'])
      .withMessage('Type upgrade invalide'),
    body('bookingId')
      .isMongoId()
      .withMessage('ID de réservation invalide'),

    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Données upgrade invalides', 400, errors.array());
      }

      const userId = req.user.id;
      const { upgradeType, bookingId, requestUpgrade = false } = req.body;

      const session = await mongoose.startSession();

      try {
        const result = await session.withTransaction(async () => {
          // Vérifications
          const [user, booking] = await Promise.all([
            User.findById(userId).session(session),
            Booking.findById(bookingId).populate('hotel').session(session)
          ]);

          if (!booking || booking.customer.toString() !== userId) {
            throw new AppError('Réservation non autorisée', 403);
          }

          if (!this.isUpgradeAvailable(booking, upgradeType)) {
            throw new AppError('Upgrade non disponible pour cette réservation', 400);
          }

          // Utiliser points pour upgrade
          const redemption = await this.loyaltyService.redeemPointsForUpgrade(
            userId, 
            upgradeType, 
            bookingId, 
            { source: 'WEB' }
          );

          // Traitement différé de l'upgrade si demandé
          if (requestUpgrade) {
            await this.requestUpgradeProcessing(booking, upgradeType, redemption.transactionId);
          }

          return { redemption, upgradeRequested: requestUpgrade };
        });

        // Notifications
        socketService.sendUserNotification(userId, 'UPGRADE_REDEEMED', {
          upgradeType,
          bookingId,
          pointsUsed: result.redemption.pointsRedeemed,
          newBalance: result.redemption.remainingPoints,
          upgradeRequested: result.upgradeRequested
        });

        res.status(200).json(formatResponse({
          success: true,
          data: result,
          message: `Upgrade ${upgradeType} obtenu !`
        }));

      } catch (error) {
        logger.error('Erreur upgrade points:', error);
        throw error;
      } finally {
        await session.endSession();
      }
    })
  ];

  /**
   * POST /api/loyalty/redeem/free-night
   * Utiliser des points pour une nuit gratuite
   */
  redeemForFreeNight = [
    body('hotelId').isMongoId().withMessage('ID hôtel invalide'),
    body('checkInDate').isISO8601().withMessage('Date arrivée invalide'),
    body('checkOutDate').isISO8601().withMessage('Date départ invalide'),
    body('roomType').isIn(['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE']).withMessage('Type chambre invalide'),

    asyncHandler(async (req, res) => {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Données nuit gratuite invalides', 400, errors.array());
      }

      const userId = req.user.id;
      const { hotelId, checkInDate, checkOutDate, roomType } = req.body;

      try {
        // Vérifier éligibilité nuit gratuite
        const user = await User.findById(userId).select('loyalty');
        const requiredPoints = this.loyaltyService.config.redemptionRules.freeNightCost;

        if (user.loyalty.currentPoints < requiredPoints) {
          throw new AppError(`Points insuffisants. Requis: ${requiredPoints}, Disponible: ${user.loyalty.currentPoints}`, 400);
        }

        // Vérifier disponibilité hôtel
        const hotel = await Hotel.findById(hotelId);
        if (!hotel) {
          throw new AppError('Hôtel non trouvé', 404);
        }

        // Traiter la nuit gratuite
        const result = await this.loyaltyService.redeemPointsForFreeNight(
          userId, hotelId, checkInDate, checkOutDate, roomType
        );

        // Créer voucher/réservation
        const voucher = await this.createFreeNightVoucher(result, hotel, {
          checkInDate: new Date(checkInDate),
          checkOutDate: new Date(checkOutDate),
          roomType
        });

        // Notifications
        socketService.sendUserNotification(userId, 'FREE_NIGHT_REDEEMED', {
          hotelName: hotel.name,
          checkInDate,
          checkOutDate,
          roomType,
          voucherCode: result.voucherCode,
          pointsUsed: requiredPoints,
          newBalance: result.remainingPoints
        });

        res.status(200).json(formatResponse({
          success: true,
          data: {
            ...result,
            voucher,
            hotel: {
              name: hotel.name,
              address: hotel.address,
              city: hotel.city,
              phone: hotel.phone
            }
          },
          message: 'Nuit gratuite réservée avec succès !'
        }));

      } catch (error) {
        logger.error('Erreur nuit gratuite:', error);
        throw error;
      }
    })
  ];

  // ============================================================================
  // GESTION ADMIN
  // ============================================================================

  /**
   * GET /api/loyalty/admin/analytics
   * Analytics globaux du programme (Admin uniquement)
   */
  getAdminAnalytics = asyncHandler(async (req, res) => {
    // Vérification admin
    if (req.user.role !== 'ADMIN') {
      throw new AppError('Accès administrateur requis', 403);
    }

    const { period = '30d', hotelId } = req.query;

    try {
      const analytics = await this.loyaltyService.getGlobalLoyaltyAnalytics(period, hotelId);

      // Données supplémentaires admin
      const [topUsers, recentActivity, systemHealth] = await Promise.all([
        this.getTopLoyaltyUsers(10),
        this.getSystemRecentActivity(20),
        this.getLoyaltySystemHealth()
      ]);

      const response = {
        success: true,
        data: {
          analytics,
          insights: {
            topUsers,
            recentActivity,
            systemHealth
          },
          recommendations: this.generateAdminRecommendations(analytics)
        },
        meta: {
          period,
          hotelFilter: hotelId || 'ALL',
          generatedAt: new Date()
        }
      };

      res.status(200).json(formatResponse(response));
    } catch (error) {
      logger.error('Erreur analytics admin:', error);
      throw new AppError('Erreur lors de la génération des analytics', 500);
    }
  });

  /**
   * POST /api/loyalty/admin/adjust-points
   * Ajustement manuel de points (Admin uniquement)
   */
  adminAdjustPoints = [
    body('userId').isMongoId().withMessage('ID utilisateur invalide'),
    body('pointsAmount').isInt({ min: -10000, max: 10000 }).withMessage('Montant points invalide'),
    body('reason').isLength({ min: 10, max: 500 }).withMessage('Raison requise (10-500 caractères)'),
    body('type').isIn(['ADJUSTMENT_ADMIN', 'ADJUSTMENT_ERROR', 'CAMPAIGN_BONUS']).withMessage('Type ajustement invalide'),

    asyncHandler(async (req, res) => {
      if (req.user.role !== 'ADMIN') {
        throw new AppError('Accès administrateur requis', 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Données ajustement invalides', 400, errors.array());
      }

      const adminId = req.user.id;
      const { userId, pointsAmount, reason, type, notifyUser = true } = req.body;

      const session = await mongoose.startSession();

      try {
        const result = await session.withTransaction(async () => {
          const user = await User.findById(userId).session(session);
          if (!user) {
            throw new AppError('Utilisateur non trouvé', 404);
          }

          // Créer transaction d'ajustement
          const transaction = new LoyaltyTransaction({
            user: userId,
            type,
            pointsAmount,
            previousBalance: user.loyalty.currentPoints,
            newBalance: user.loyalty.currentPoints + pointsAmount,
            description: `Ajustement admin: ${reason}`,
            source: 'ADMIN',
            processedBy: adminId,
            internalNotes: `Ajustement effectué par admin ${req.user.firstName} ${req.user.lastName}`,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          });

          await transaction.save({ session });

          // Mettre à jour solde utilisateur
          if (pointsAmount > 0) {
            user.addLoyaltyPoints(pointsAmount, reason);
          } else {
            user.redeemLoyaltyPoints(Math.abs(pointsAmount), reason);
          }

          await user.save({ session });

          return { transaction, user, adjustment: pointsAmount };
        });

        // Notifications si demandées
        if (notifyUser) {
          socketService.sendUserNotification(userId, 'POINTS_ADJUSTED', {
            adjustment: pointsAmount,
            reason,
            newBalance: result.user.loyalty.currentPoints,
            adjustedBy: 'Administration',
            message: pointsAmount > 0 ? 
              `${pointsAmount} points ajoutés à votre compte` : 
              `${Math.abs(pointsAmount)} points déduits de votre compte`
          });

          // Email si ajustement significatif
          if (Math.abs(pointsAmount) >= 500) {
            await emailService.sendEmail({
              to: result.user.email,
              template: 'points-adjustment',
              data: {
                user: { firstName: result.user.firstName },
                adjustment: {
                  amount: pointsAmount,
                  reason,
                  type: pointsAmount > 0 ? 'credit' : 'debit',
                  newBalance: result.user.loyalty.currentPoints
                }
              }
            });
          }
        }

        // Log audit pour traçabilité
        logger.info(`Admin points adjustment: ${pointsAmount} points ${pointsAmount > 0 ? 'added to' : 'removed from'} user ${userId} by admin ${adminId}. Reason: ${reason}`);

        res.status(200).json(formatResponse({
          success: true,
          data: {
            transactionId: result.transaction._id,
            previousBalance: result.transaction.previousBalance,
            adjustment: pointsAmount,
            newBalance: result.user.loyalty.currentPoints,
            userNotified: notifyUser
          },
          message: `Ajustement de ${pointsAmount} points effectué avec succès`
        }));

      } catch (error) {
        logger.error('Erreur ajustement admin points:', error);
        throw error;
      } finally {
        await session.endSession();
      }
    })
  ];

  /**
   * GET /api/loyalty/admin/users
   * Liste des utilisateurs du programme avec filtres (Admin)
   */
  getAdminUsersList = asyncHandler(async (req, res) => {
    if (req.user.role !== 'ADMIN') {
      throw new AppError('Accès administrateur requis', 403);
    }

    const {
      page = 1,
      limit = 50,
      tier,
      sortBy = 'lifetimePoints',
      sortOrder = 'desc',
      search,
      minPoints,
      maxPoints,
      status = 'active'
    } = req.query;

    try {
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), 100);

      // Construction de la requête
      const query = { 'loyalty.enrolledAt': { $exists: true } };
      
      if (tier && tier !== 'ALL') query['loyalty.tier'] = tier;
      if (status === 'active') query.isActive = true;
      if (status === 'inactive') query.isActive = false;
      
      if (minPoints || maxPoints) {
        query['loyalty.currentPoints'] = {};
        if (minPoints) query['loyalty.currentPoints'].$gte = parseInt(minPoints);
        if (maxPoints) query['loyalty.currentPoints'].$lte = parseInt(maxPoints);
      }

      if (search) {
        query.$or = [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } }
        ];
      }

      // Tri
      const sortField = sortBy === 'lifetimePoints' ? 'loyalty.lifetimePoints' : 
                       sortBy === 'currentPoints' ? 'loyalty.currentPoints' :
                       sortBy === 'memberSince' ? 'loyalty.enrolledAt' : 'createdAt';
      const sortDirection = sortOrder === 'asc' ? 1 : -1;

      const [users, totalCount] = await Promise.all([
        User.find(query)
          .select('firstName lastName email loyalty isActive lastLogin createdAt')
          .sort({ [sortField]: sortDirection })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .lean(),
        User.countDocuments(query)
      ]);

      // Enrichir avec dernière activité
      const enrichedUsers = await Promise.all(
        users.map(async (user) => {
          const lastTransaction = await LoyaltyTransaction.findOne({ user: user._id })
            .sort({ createdAt: -1 })
            .select('createdAt type')
            .lean();

          return {
            ...user,
            lastLoyaltyActivity: lastTransaction?.createdAt,
            lastTransactionType: lastTransaction?.type,
            pointsValue: Math.round((user.loyalty.currentPoints / 100) * 100) / 100,
            tierDisplay: this.getTierDisplayName(user.loyalty.tier)
          };
        })
      );

      res.status(200).json(formatResponse({
        success: true,
        data: {
          users: enrichedUsers,
          summary: {
            totalUsers: totalCount,
            averagePoints: users.reduce((sum, u) => sum + u.loyalty.currentPoints, 0) / users.length || 0,
            tierDistribution: this.calculateTierDistribution(users)
          }
        },
        pagination: {
          currentPage: pageNum,
          totalPages: Math.ceil(totalCount / limitNum),
          totalItems: totalCount,
          itemsPerPage: limitNum
        },
        filters: { tier, sortBy, sortOrder, search, status }
      }));

    } catch (error) {
      logger.error('Erreur liste utilisateurs admin:', error);
      throw new AppError('Erreur lors de la récupération des utilisateurs', 500);
    }
  });

  /**
   * POST /api/loyalty/admin/campaign
   * Créer une campagne de points bonus (Admin)
   */
  createBonusCampaign = [
    body('name').isLength({ min: 3, max: 100 }).withMessage('Nom campagne requis (3-100 caractères)'),
    body('type').isIn(['MULTIPLIER', 'BONUS_FIXED', 'TIER_UPGRADE']).withMessage('Type campagne invalide'),
    body('value').isFloat({ min: 0.1, max: 10 }).withMessage('Valeur campagne invalide'),
    body('startDate').isISO8601().withMessage('Date début invalide'),
    body('endDate').isISO8601().withMessage('Date fin invalide'),

    asyncHandler(async (req, res) => {
      if (req.user.role !== 'ADMIN') {
        throw new AppError('Accès administrateur requis', 403);
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        throw new AppError('Données campagne invalides', 400, errors.array());
      }

      const {
        name,
        description,
        type,
        value,
        startDate,
        endDate,
        targetTiers = ['ALL'],
        targetHotels = [],
        minimumBookingAmount = 0,
        maxUsagePerUser = null,
        autoApply = true
      } = req.body;

      try {
        // Vérifier dates
        const start = new Date(startDate);
        const end = new Date(endDate);
        
        if (start >= end) {
          throw new AppError('Date de fin doit être après la date de début', 400);
        }

        // Générer code campagne unique
        const campaignCode = this.generateCampaignCode(name);

        // Créer campagne (utiliser un modèle Campaign si disponible, sinon stocker en base)
        const campaign = {
          name,
          description,
          code: campaignCode,
          type,
          value,
          startDate: start,
          endDate: end,
          targetTiers: targetTiers.includes('ALL') ? ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] : targetTiers,
          targetHotels,
          minimumBookingAmount,
          maxUsagePerUser,
          autoApply,
          createdBy: req.user.id,
          isActive: true,
          usageStats: {
            totalUsers: 0,
            totalPointsIssued: 0,
            totalBookings: 0
          }
        };

        // Sauvegarder (simulation - adapter selon votre modèle Campaign)
        // const savedCampaign = await Campaign.create(campaign);

        // Notification aux utilisateurs éligibles si autoApply
        if (autoApply) {
          await this.notifyEligibleUsers(campaign);
        }

        // Notification aux admins
        socketService.sendAdminNotification('CAMPAIGN_CREATED', {
          campaignName: name,
          campaignCode,
          type,
          createdBy: req.user.firstName + ' ' + req.user.lastName
        });

        logger.info(`Loyalty campaign created: ${name} (${campaignCode}) by admin ${req.user.id}`);

        res.status(201).json(formatResponse({
          success: true,
          data: {
            campaign: {
              ...campaign,
              id: campaignCode // Utiliser code comme ID temporaire
            }
          },
          message: `Campagne "${name}" créée avec succès`
        }));

      } catch (error) {
        logger.error('Erreur création campagne:', error);
        throw error;
      }
    })
  ];

  // ============================================================================
  // MÉTHODES UTILITAIRES ET HELPERS
  // ============================================================================

  /**
   * Enrichir données avec informations temps réel
   */
  async enrichWithRealtimeData(userId, loyaltyStatus) {
    try {
      // Points gagnés aujourd'hui
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayEarnings = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            pointsAmount: { $gt: 0 },
            createdAt: { $gte: today }
          }
        },
        {
          $group: {
            _id: null,
            totalEarned: { $sum: '$pointsAmount' },
            transactionCount: { $sum: 1 }
          }
        }
      ]);

      // Prochaine expiration
      const nextExpiry = await LoyaltyTransaction.findOne({
        user: userId,
        pointsAmount: { $gt: 0 },
        status: 'COMPLETED',
        expiresAt: { $gt: new Date() }
      })
      .sort({ expiresAt: 1 })
      .select('pointsAmount expiresAt');

      // Recommandations dynamiques
      const dynamicRecommendations = await this.getDynamicRecommendations(userId, loyaltyStatus);

      return {
        todayEarnings: todayEarnings[0] || { totalEarned: 0, transactionCount: 0 },
        nextExpiry,
        recommendations: dynamicRecommendations,
        activityScore: this.calculateActivityScore(loyaltyStatus),
        trending: {
          pointsVelocity: loyaltyStatus.performance?.pointsVelocity || 0,
          redemptionRate: loyaltyStatus.performance?.redemptionRate || 0
        }
      };
    } catch (error) {
      logger.error('Erreur enrichissement temps réel:', error);
      return {};
    }
  }

  /**
   * Obtenir notifications actives pour l'utilisateur
   */
  async getActiveNotifications(userId) {
    try {
      const notifications = [];

      // Points qui expirent bientôt
      const expiringPoints = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            pointsAmount: { $gt: 0 },
            status: 'COMPLETED',
            expiresAt: {
              $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
              $gt: new Date()
            }
          }
        },
        {
          $group: {
            _id: null,
            totalExpiring: { $sum: '$pointsAmount' },
            nextExpiry: { $min: '$expiresAt' }
          }
        }
      ]);

      if (expiringPoints[0]?.totalExpiring > 0) {
        notifications.push({
          type: 'warning',
          title: 'Points qui expirent bientôt',
          message: `${expiringPoints[0].totalExpiring} points expirent le ${expiringPoints[0].nextExpiry.toLocaleDateString()}`,
          action: 'Utiliser mes points',
          priority: 'medium',
          expires: expiringPoints[0].nextExpiry
        });
      }

      // Proche du niveau supérieur
      const user = await User.findById(userId).select('loyalty').lean();
      if (user?.loyalty?.tierProgress?.progressPercentage >= 80) {
        notifications.push({
          type: 'info',
          title: 'Proche du niveau supérieur !',
          message: `Plus que ${user.loyalty.tierProgress.pointsToNextTier} points pour ${user.loyalty.tierProgress.nextTier}`,
          action: 'Faire une réservation',
          priority: 'low'
        });
      }

      // Offres spéciales actives
      const specialOffers = user?.loyalty?.specialStatus?.specialOffers?.filter(offer => 
        offer.validUntil > new Date() && !offer.used
      ) || [];

      specialOffers.forEach(offer => {
        notifications.push({
          type: 'success',
          title: 'Offre spéciale disponible',
          message: offer.description,
          action: 'Voir l\'offre',
          priority: 'high',
          expires: offer.validUntil
        });
      });

      return notifications;
    } catch (error) {
      logger.error('Erreur notifications actives:', error);
      return [];
    }
  }

  /**
   * Obtenir activité récente de l'utilisateur
   */
  async getRecentActivity(userId, limit = 5) {
    try {
      const activities = await LoyaltyTransaction.find({ user: userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('booking', 'bookingNumber hotelName')
        .populate('hotel', 'name')
        .select('type pointsAmount description createdAt booking hotel')
        .lean();

      return activities.map(activity => ({
        ...activity,
        typeDisplay: this.getTransactionTypeDisplay(activity.type),
        icon: this.getTransactionIcon(activity.type),
        isPositive: activity.pointsAmount > 0
      }));
    } catch (error) {
      logger.error('Erreur activité récente:', error);
      return [];
    }
  }

  /**
   * Obtenir analytics utilisateur pour une période
   */
  async getUserAnalytics(userId, period = '30d') {
    try {
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const analytics = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              type: { $cond: [{ $gt: ['$pointsAmount', 0] }, 'earned', 'redeemed'] }
            },
            points: { $sum: { $abs: '$pointsAmount' } },
            transactions: { $sum: 1 }
          }
        },
        {
          $group: {
            _id: '$_id.date',
            earned: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'earned'] }, '$points', 0] }
            },
            redeemed: {
              $sum: { $cond: [{ $eq: ['$_id.type', 'redeemed'] }, '$points', 0] }
            },
            transactions: { $sum: '$transactions' }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Calculer totaux et moyennes
      const totals = analytics.reduce((acc, day) => ({
        earned: acc.earned + day.earned,
        redeemed: acc.redeemed + day.redeemed,
        transactions: acc.transactions + day.transactions
      }), { earned: 0, redeemed: 0, transactions: 0 });

      return {
        period: { days, startDate },
        daily: analytics,
        totals,
        averages: {
          earnedPerDay: Math.round(totals.earned / days),
          redeemedPerDay: Math.round(totals.redeemed / days),
          transactionsPerDay: Math.round(totals.transactions / days)
        },
        trends: this.calculateTrends(analytics)
      };
    } catch (error) {
      logger.error('Erreur analytics utilisateur:', error);
      return { daily: [], totals: {}, averages: {} };
    }
  }

  /**
   * Générer recommandations personnalisées
   */
  async generatePersonalizedRecommendations(userId, loyaltyStatus) {
    try {
      const recommendations = [];
      const { user, redemption, benefits } = loyaltyStatus;

      // Recommandation utilisation de points
      if (user.currentPoints >= 500) {
        const potentialDiscount = Math.floor(user.currentPoints / 100);
        recommendations.push({
          type: 'redemption',
          title: 'Utilisez vos points',
          message: `Vous pouvez obtenir jusqu'à ${potentialDiscount}€ de réduction`,
          action: 'Utiliser mes points',
          priority: 'medium',
          category: 'savings'
        });
      }

      // Recommandation progression niveau
      if (user.tierProgress?.progressPercentage >= 60 && user.tierProgress?.progressPercentage < 95) {
        recommendations.push({
          type: 'progression',
          title: 'Proche du niveau supérieur',
          message: `Plus que ${user.tierProgress.pointsToNextTier} points pour ${user.tierProgress.nextTier}`,
          action: 'Voir les avantages',
          priority: 'high',
          category: 'tier'
        });
      }

      // Recommandation basée sur l'historique
      const recentBookings = await this.getRecentBookingPattern(userId);
      if (recentBookings.suggestLoyalty) {
        recommendations.push({
          type: 'booking',
          title: 'Votre hôtel préféré',
          message: `Réservez à nouveau chez ${recentBookings.favoriteHotel} et gagnez des points bonus`,
          action: 'Réserver',
          priority: 'low',
          category: 'booking'
        });
      }

      return recommendations.slice(0, 5); // Limiter à 5 recommandations
    } catch (error) {
      logger.error('Erreur recommandations:', error);
      return [];
    }
  }

  /**
   * Obtenir événements à venir pour l'utilisateur
   */
  async getUpcomingEvents(userId) {
    try {
      const events = [];
      const user = await User.findById(userId).select('loyalty createdAt').lean();

      // Anniversaire adhésion
      const anniversaryDate = new Date(user.loyalty.enrolledAt);
      const nextAnniversary = new Date();
      nextAnniversary.setFullYear(nextAnniversary.getFullYear() + 1);
      nextAnniversary.setMonth(anniversaryDate.getMonth());
      nextAnniversary.setDate(anniversaryDate.getDate());

      if (nextAnniversary > new Date()) {
        const daysUntil = Math.ceil((nextAnniversary - new Date()) / (24 * 60 * 60 * 1000));
        if (daysUntil <= 30) {
          events.push({
            type: 'anniversary',
            title: 'Anniversaire de fidélité',
            date: nextAnniversary,
            daysUntil,
            description: 'Recevez des points bonus !',
            icon: '🎉'
          });
        }
      }

      // Points qui expirent
      const expiringPoints = await LoyaltyTransaction.findOne({
        user: userId,
        pointsAmount: { $gt: 0 },
        status: 'COMPLETED',
        expiresAt: { $gt: new Date() }
      })
      .sort({ expiresAt: 1 })
      .select('pointsAmount expiresAt');

      if (expiringPoints) {
        const daysUntilExpiry = Math.ceil((expiringPoints.expiresAt - new Date()) / (24 * 60 * 60 * 1000));
        if (daysUntilExpiry <= 90) {
          events.push({
            type: 'expiry',
            title: 'Expiration de points',
            date: expiringPoints.expiresAt,
            daysUntil: daysUntilExpiry,
            description: `${expiringPoints.pointsAmount} points vont expirer`,
            icon: '⏰'
          });
        }
      }

      return events.sort((a, b) => a.daysUntil - b.daysUntil);
    } catch (error) {
      logger.error('Erreur événements à venir:', error);
      return [];
    }
  }

  /**
   * Générer insights utilisateur
   */
  async generateUserInsights(userId, analytics) {
    try {
      const insights = [];

      // Analyse tendance points
      if (analytics.trends?.earning === 'increasing') {
        insights.push({
          type: 'positive',
          title: 'Tendance positive',
          message: 'Vous gagnez plus de points récemment !',
          icon: '📈'
        });
      }

      // Analyse utilisation
      const user = await User.findById(userId).select('loyalty').lean();
      const redemptionRate = user.loyalty.statistics?.totalPointsRedeemed / 
                           (user.loyalty.statistics?.totalPointsEarned || 1);

      if (redemptionRate < 0.2) {
        insights.push({
          type: 'suggestion',
          title: 'Utilisez vos points',
          message: 'Vous pourriez profiter davantage de vos points !',
          icon: '💡'
        });
      }

      // Performance vs autres membres
      const avgPoints = await User.aggregate([
        { $match: { 'loyalty.tier': user.loyalty.tier } },
        { $group: { _id: null, avg: { $avg: '$loyalty.currentPoints' } } }
      ]);

      if (user.loyalty.currentPoints > (avgPoints[0]?.avg || 0) * 1.2) {
        insights.push({
          type: 'achievement',
          title: 'Super membre !',
          message: `Vous avez plus de points que la moyenne des membres ${user.loyalty.tier}`,
          icon: '🏆'
        });
      }

      return insights;
    } catch (error) {
      logger.error('Erreur génération insights:', error);
      return [];
    }
  }

  /**
   * Obtenir actions rapides selon le profil
   */
  getQuickActions(loyalty) {
    const actions = [];

    if (loyalty.currentPoints >= 100) {
      actions.push({
        type: 'redeem',
        title: 'Utiliser points',
        description: 'Obtenir une réduction',
        icon: '💰',
        link: '/loyalty/redeem'
      });
    }

    if (loyalty.tierProgress?.progressPercentage >= 80) {
      actions.push({
        type: 'book',
        title: 'Réserver',
        description: 'Atteindre le niveau supérieur',
        icon: '🏨',
        link: '/search'
      });
    }

    actions.push({
      type: 'history',
      title: 'Historique',
      description: 'Voir vos transactions',
      icon: '📊',
      link: '/loyalty/history'
    });

    return actions;
  }

  /**
   * Enrichir transactions avec métadonnées
   */
  async enrichTransactions(transactions) {
    return transactions.map(transaction => ({
      ...transaction,
      typeDisplay: this.getTransactionTypeDisplay(transaction.type),
      icon: this.getTransactionIcon(transaction.type),
      isPositive: transaction.pointsAmount > 0,
      estimatedValue: Math.round((Math.abs(transaction.pointsAmount) / 100) * 100) / 100,
      daysAgo: Math.floor((Date.now() - transaction.createdAt) / (24 * 60 * 60 * 1000))
    }));
  }

  /**
   * Enrichir une transaction spécifique
   */
  async enrichSingleTransaction(transaction) {
    const enriched = {
      ...transaction,
      typeDisplay: this.getTransactionTypeDisplay(transaction.type),
      icon: this.getTransactionIcon(transaction.type),
      isPositive: transaction.pointsAmount > 0,
      estimatedValue: Math.round((Math.abs(transaction.pointsAmount) / 100) * 100) / 100
    };

    // Ajouter contexte spécifique selon le type
    if (transaction.type === 'EARN_BOOKING' && transaction.booking) {
      enriched.context = {
        type: 'booking',
        details: {
          hotel: transaction.booking.hotelName,
          checkIn: transaction.booking.checkInDate,
          rooms: transaction.booking.rooms?.length || 1,
          totalAmount: transaction.booking.totalPrice
        }
      };
    }

    return enriched;
  }

  /**
   * Calculer résumé historique
   */
  async calculateHistorySummary(userId, query) {
    try {
      const summary = await LoyaltyTransaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalEarned: { $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] } },
            totalRedeemed: { $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] } },
            avgTransaction: { $avg: '$pointsAmount' },
            firstTransaction: { $min: '$createdAt' },
            lastTransaction: { $max: '$createdAt' }
          }
        }
      ]);

      const result = summary[0] || {
        totalTransactions: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        avgTransaction: 0
      };

      result.netGain = result.totalEarned - result.totalRedeemed;
      result.estimatedValue = Math.round(((result.totalEarned - result.totalRedeemed) / 100) * 100) / 100;

      return result;
    } catch (error) {
      logger.error('Erreur calcul résumé:', error);
      return {};
    }
  }

  /**
   * Grouper transactions par mois
   */
  groupTransactionsByMonth(transactions) {
    const grouped = {};
    
    transactions.forEach(transaction => {
      const monthKey = new Date(transaction.createdAt).toISOString().slice(0, 7);
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = {
          month: monthKey,
          transactions: [],
          totalEarned: 0,
          totalRedeemed: 0,
          netChange: 0,
          count: 0
        };
      }
      
      grouped[monthKey].transactions.push(transaction);
      grouped[monthKey].count++;
      
      if (transaction.pointsAmount > 0) {
        grouped[monthKey].totalEarned += transaction.pointsAmount;
      } else {
        grouped[monthKey].totalRedeemed += Math.abs(transaction.pointsAmount);
      }
      
      grouped[monthKey].netChange += transaction.pointsAmount;
    });
    
    return Object.values(grouped).sort((a, b) => b.month.localeCompare(a.month));
  }

  /**
   * Grouper transactions par type
   */
  groupTransactionsByType(transactions) {
    const grouped = {};
    
    transactions.forEach(transaction => {
      const type = transaction.type;
      
      if (!grouped[type]) {
        grouped[type] = {
          type,
          typeDisplay: this.getTransactionTypeDisplay(type),
          transactions: [],
          totalPoints: 0,
          count: 0,
          icon: this.getTransactionIcon(type)
        };
      }
      
      grouped[type].transactions.push(transaction);
      grouped[type].count++;
      grouped[type].totalPoints += Math.abs(transaction.pointsAmount);
    });
    
    return Object.values(grouped).sort((a, b) => b.totalPoints - a.totalPoints);
  }

  /**
   * Vérifier si transaction peut être annulée
   */
  canCancelTransaction(transaction) {
    if (transaction.status !== 'COMPLETED') return false;
    if (transaction.pointsAmount <= 0) return false; // Seulement les gains
    
    const daysSince = (Date.now() - transaction.createdAt) / (24 * 60 * 60 * 1000);
    return daysSince <= 7; // 7 jours pour annuler
  }

  /**
   * Vérifier si transaction peut être remboursée
   */
  canRefundTransaction(transaction) {
    return transaction.type.startsWith('REDEEM_') && 
           transaction.status === 'COMPLETED' &&
           (Date.now() - transaction.createdAt) <= (24 * 60 * 60 * 1000); // 24h pour remboursement
  }

  /**
   * Obtenir options spécifiques à une réservation
   */
  async getBookingSpecificOptions(bookingId, user) {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('hotel')
        .lean();

      if (!booking) return [];

      const options = [];

      // Check if booking allows upgrades
      if (booking.status === 'CONFIRMED' && this.isUpgradeAvailable(booking, 'ROOM_CATEGORY')) {
        options.push({
          type: 'UPGRADE',
          pointsRequired: 1000,
          value: 'Upgrade chambre',
          description: 'Surclassement pour cette réservation',
          available: user.loyalty.currentPoints >= 1000,
          bookingSpecific: true,
          bookingId
        });
      }

      // Early check-in option
      if (booking.checkInDate > new Date()) {
        options.push({
          type: 'EARLY_CHECKIN',
          pointsRequired: 150,
          value: 'Check-in anticipé',
          description: 'Arrivée 2h plus tôt',
          available: user.loyalty.currentPoints >= 150,
          bookingSpecific: true,
          bookingId
        });
      }

      return options;
    } catch (error) {
      logger.error('Erreur options réservation:', error);
      return [];
    }
  }

  /**
   * Filtrer options par catégorie
   */
  filterOptionsByCategory(options, category) {
    if (category === 'ALL') return options;

    const categoryMap = {
      'DISCOUNT': ['DISCOUNT'],
      'UPGRADE': ['UPGRADE', 'EARLY_CHECKIN', 'LATE_CHECKOUT'],
      'BENEFITS': ['BREAKFAST', 'LOUNGE_ACCESS', 'SPA_DISCOUNT'],
      'EXPERIENCES': ['FREE_NIGHT', 'AIRPORT_TRANSFER']
    };

    const allowedTypes = categoryMap[category] || [];
    return options.filter(option => allowedTypes.includes(option.type));
  }

  /**
   * Calculer économies potentielles
   */
  calculatePotentialSavings(currentPoints) {
    return {
      maxDiscount: Math.floor(currentPoints / 100),
      upgradeCount: Math.floor(currentPoints / 1000),
      freeNights: Math.floor(currentPoints / 5000),
      totalValue: Math.round((currentPoints / 100) * 100) / 100
    };
  }

  /**
   * Obtenir recommandations d'utilisation
   */
  getRedemptionRecommendations(loyalty, options) {
    const recommendations = [];

    // Recommandation basée sur le solde
    if (loyalty.currentPoints >= 5000) {
      recommendations.push({
        type: 'high_value',
        title: 'Nuit gratuite recommandée',
        description: 'Utilisez vos points pour une nuit gratuite - meilleur rapport qualité/prix',
        pointsRequired: 5000,
        priority: 'high'
      });
    } else if (loyalty.currentPoints >= 1000) {
      recommendations.push({
        type: 'upgrade',
        title: 'Upgrade recommandé',
        description: 'Surclassez votre prochaine réservation',
        pointsRequired: 1000,
        priority: 'medium'
      });
    }

    // Recommandation basée sur l'utilisation historique
    const redemptionRate = loyalty.statistics?.totalPointsRedeemed / 
                          (loyalty.statistics?.totalPointsEarned || 1);

    if (redemptionRate < 0.1) {
      recommendations.push({
        type: 'first_redemption',
        title: 'Première utilisation',
        description: 'Commencez par une petite réduction pour découvrir les avantages',
        pointsRequired: 100,
        priority: 'low'
      });
    }

    return recommendations;
  }

  /**
   * Vérifier si upgrade disponible pour réservation
   */
  isUpgradeAvailable(booking, upgradeType) {
    // Vérifications basiques
    if (!booking || booking.status !== 'CONFIRMED') return false;
    
    // Check if check-in is not too soon (less than 24h)
    const checkInDate = new Date(booking.checkInDate);
    const timeDiff = checkInDate - new Date();
    const hoursDiff = timeDiff / (1000 * 60 * 60);
    
    if (hoursDiff < 24) return false; // Too late to upgrade
    
    // Type-specific checks
    switch (upgradeType) {
      case 'ROOM_CATEGORY':
        return booking.rooms?.[0]?.roomType !== 'SUITE'; // Can't upgrade from suite
      case 'VIEW':
        return true; // Usually available
      case 'FLOOR_HIGH':
        return true; // Usually available
      case 'SUITE':
        return booking.rooms?.[0]?.roomType !== 'SUITE'; // Not already a suite
      default:
        return false;
    }
  }

  /**
   * Demander traitement d'upgrade
   */
  async requestUpgradeProcessing(booking, upgradeType, transactionId) {
    try {
      // Add upgrade request to booking (simulate - adapt to your Booking model)
      const upgradeRequest = {
        type: upgradeType,
        transactionId,
        requestedAt: new Date(),
        status: 'PENDING',
        processedBy: null
      };

      // In a real implementation, you would save this to the booking
      // booking.upgradeRequests = booking.upgradeRequests || [];
      // booking.upgradeRequests.push(upgradeRequest);
      // await booking.save();

      // Notify hotel staff
      socketService.sendHotelNotification(booking.hotel._id, 'UPGRADE_REQUESTED', {
        bookingId: booking._id,
        upgradeType,
        guestName: booking.guestName,
        checkInDate: booking.checkInDate,
        transactionId
      });

      logger.info(`Upgrade request created: ${upgradeType} for booking ${booking._id}`);
      return upgradeRequest;
    } catch (error) {
      logger.error('Erreur demande upgrade:', error);
      throw error;
    }
  }

  /**
   * Créer voucher nuit gratuite
   */
  async createFreeNightVoucher(redemptionResult, hotel, bookingDetails) {
    try {
      const voucher = {
        code: redemptionResult.voucherCode,
        type: 'FREE_NIGHT',
        hotelId: hotel._id,
        hotelName: hotel.name,
        roomType: bookingDetails.roomType,
        checkInDate: bookingDetails.checkInDate,
        checkOutDate: bookingDetails.checkOutDate,
        transactionId: redemptionResult.transactionId,
        status: 'ACTIVE',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year validity
        terms: [
          'Sous réserve de disponibilité',
          'Non remboursable et non transférable',
          'Valable 1 an à partir de la date d\'émission',
          'Présenter ce voucher lors de la réservation'
        ]
      };

      // In a real implementation, save to Voucher collection
      // const savedVoucher = await Voucher.create(voucher);

      return voucher;
    } catch (error) {
      logger.error('Erreur création voucher:', error);
      throw error;
    }
  }

  /**
   * Obtenir top utilisateurs loyalty (Admin)
   */
  async getTopLoyaltyUsers(limit = 10) {
    try {
      return await User.find({ 'loyalty.enrolledAt': { $exists: true } })
        .sort({ 'loyalty.lifetimePoints': -1 })
        .limit(limit)
        .select('firstName lastName email loyalty.tier loyalty.lifetimePoints loyalty.currentPoints')
        .lean();
    } catch (error) {
      logger.error('Erreur top users:', error);
      return [];
    }
  }

  /**
   * Obtenir activité système récente (Admin)
   */
  async getSystemRecentActivity(limit = 20) {
    try {
      return await LoyaltyTransaction.find({})
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('user', 'firstName lastName')
        .populate('hotel', 'name')
        .select('type pointsAmount user hotel createdAt description')
        .lean();
    } catch (error) {
      logger.error('Erreur activité système:', error);
      return [];
    }
  }

  /**
   * Obtenir santé du système loyalty (Admin)
   */
  async getLoyaltySystemHealth() {
    try {
      const [totalMembers, activeToday, totalTransactions, errorRate] = await Promise.all([
        User.countDocuments({ 'loyalty.enrolledAt': { $exists: true } }),
        User.countDocuments({
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000)
          }
        }),
        LoyaltyTransaction.countDocuments({}),
        LoyaltyTransaction.countDocuments({
          status: 'CANCELLED',
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      ]);

      return {
        totalMembers,
        activeToday,
        totalTransactions,
        errorRate: Math.round((errorRate / Math.max(totalTransactions, 1)) * 100),
        status: errorRate < totalTransactions * 0.05 ? 'healthy' : 'warning',
        uptime: process.uptime(),
        lastUpdated: new Date()
      };
    } catch (error) {
      logger.error('Erreur santé système:', error);
      return { status: 'error' };
    }
  }

  /**
   * Générer recommandations admin
   */
  generateAdminRecommendations(analytics) {
    const recommendations = [];

    // Analyse engagement
    if (analytics.users?.activeMembers / analytics.users?.totalMembers < 0.3) {
      recommendations.push({
        type: 'engagement',
        priority: 'high',
        title: 'Améliorer l\'engagement',
        description: 'Moins de 30% des membres sont actifs',
        actions: ['Campagne de réactivation', 'Bonus spéciaux', 'Communication ciblée']
      });
    }

    // Analyse distribution niveaux
    const platinumPlus = analytics.tiers?.filter(t => 
      ['PLATINUM', 'DIAMOND'].includes(t._id)
    ).reduce((sum, tier) => sum + tier.count, 0) || 0;

    const totalMembers = analytics.tiers?.reduce((sum, tier) => sum + tier.count, 0) || 1;

    if (platinumPlus / totalMembers < 0.05) {
      recommendations.push({
        type: 'tier_progression',
        priority: 'medium',
        title: 'Encourager progression niveaux',
        description: 'Peu de membres atteignent les niveaux premium',
        actions: ['Réduire seuils', 'Bonus progression', 'Défis spéciaux']
      });
    }

    return recommendations;
  }

  /**
   * Calculer distribution des niveaux
   */
  calculateTierDistribution(users) {
    const distribution = {
      BRONZE: 0,
      SILVER: 0,
      GOLD: 0,
      PLATINUM: 0,
      DIAMOND: 0
    };

    users.forEach(user => {
      if (distribution.hasOwnProperty(user.loyalty.tier)) {
        distribution[user.loyalty.tier]++;
      }
    });

    return distribution;
  }

  /**
   * Générer code campagne unique
   */
  generateCampaignCode(name) {
    const prefix = name.substring(0, 3).toUpperCase();
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 3);
    return `${prefix}${timestamp}${random}`.toUpperCase();
  }

  /**
   * Notifier utilisateurs éligibles pour campagne
   */
  async notifyEligibleUsers(campaign) {
    try {
      // Find eligible users
      const query = { 'loyalty.enrolledAt': { $exists: true } };
      
      if (!campaign.targetTiers.includes('ALL')) {
        query['loyalty.tier'] = { $in: campaign.targetTiers };
      }

      const eligibleUsers = await User.find(query)
        .select('_id firstName email loyalty.tier')
        .limit(1000) // Limit for performance
        .lean();

      // Send notifications (in batches)
      const batchSize = 50;
      for (let i = 0; i < eligibleUsers.length; i += batchSize) {
        const batch = eligibleUsers.slice(i, i + batchSize);
        
        batch.forEach(user => {
          socketService.sendUserNotification(user._id, 'CAMPAIGN_AVAILABLE', {
            campaignName: campaign.name,
            campaignCode: campaign.code,
            tier: user.loyalty.tier,
            validUntil: campaign.endDate,
            message: `Nouvelle campagne disponible: ${campaign.name}`
          });
        });

        // Small delay between batches
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      logger.info(`Campaign notifications sent to ${eligibleUsers.length} users`);
    } catch (error) {
      logger.error('Erreur notification campagne:', error);
    }
  }

  /**
   * Obtenir pattern de réservation récent
   */
  async getRecentBookingPattern(userId) {
    try {
      const recentBookings = await Booking.find({ customer: userId })
        .sort({ createdAt: -1 })
        .limit(5)
        .populate('hotel', 'name')
        .lean();

      if (recentBookings.length === 0) {
        return { suggestLoyalty: false };
      }

      // Find most frequent hotel
      const hotelCounts = {};
      recentBookings.forEach(booking => {
        const hotelName = booking.hotel?.name;
        if (hotelName) {
          hotelCounts[hotelName] = (hotelCounts[hotelName] || 0) + 1;
        }
      });

      const favoriteHotel = Object.keys(hotelCounts).reduce((a, b) => 
        hotelCounts[a] > hotelCounts[b] ? a : b
      );

      return {
        suggestLoyalty: hotelCounts[favoriteHotel] >= 2,
        favoriteHotel,
        recentBookings: recentBookings.length,
        pattern: this.analyzeBookingPattern(recentBookings)
      };
    } catch (error) {
      logger.error('Erreur pattern réservation:', error);
      return { suggestLoyalty: false };
    }
  }

  /**
   * Analyser pattern de réservation
   */
  analyzeBookingPattern(bookings) {
    if (bookings.length < 2) return 'insufficient_data';

    const intervals = [];
    for (let i = 1; i < bookings.length; i++) {
      const interval = bookings[i-1].createdAt - bookings[i].createdAt;
      intervals.push(interval / (24 * 60 * 60 * 1000)); // Days
    }

    const avgInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;

    if (avgInterval <= 30) return 'frequent'; // Monthly or more
    if (avgInterval <= 90) return 'regular'; // Quarterly
    if (avgInterval <= 180) return 'occasional'; // Semi-annual
    return 'rare';
  }

  /**
   * Obtenir recommandations dynamiques
   */
  async getDynamicRecommendations(userId, loyaltyStatus) {
    try {
      const recommendations = [];
      const { user } = loyaltyStatus;

      // Time-based recommendations
      const hour = new Date().getHours();
      const dayOfWeek = new Date().getDay();

      // Weekend booking suggestion
      if (dayOfWeek >= 5 && user.currentPoints >= 1000) { // Friday-Sunday
        recommendations.push({
          type: 'weekend',
          title: 'Escapade week-end',
          message: 'Utilisez vos points pour un week-end détente',
          urgency: 'low',
          validUntil: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) // 2 days
        });
      }

      // Season-based recommendations
      const month = new Date().getMonth();
      if ([5, 6, 7].includes(month) && user.currentPoints >= 2000) { // Summer
        recommendations.push({
          type: 'seasonal',
          title: 'Offre été',
          message: 'Points bonus x1.5 pour réservations estivales',
          urgency: 'medium',
          seasonal: true
        });
      }

      return recommendations;
    } catch (error) {
      logger.error('Erreur recommandations dynamiques:', error);
      return [];
    }
  }

  /**
   * Calculer score d'activité
   */
  calculateActivityScore(loyaltyStatus) {
    const { user, transactions } = loyaltyStatus;
    let score = 0;

    // Base score from tier
    const tierScores = { BRONZE: 10, SILVER: 25, GOLD: 50, PLATINUM: 75, DIAMOND: 100 };
    score += tierScores[user.tier] || 0;

    // Recent activity bonus
    if (transactions?.recent?.length > 0) {
      const recentActivity = transactions.recent.filter(t => 
        (Date.now() - new Date(t.createdAt)) < 30 * 24 * 60 * 60 * 1000 // 30 days
      );
      score += Math.min(recentActivity.length * 5, 25); // Max 25 points
    }

    // Points balance factor
    const pointsBonus = Math.min(user.currentPoints / 100, 25); // Max 25 points
    score += pointsBonus;

    return Math.min(Math.round(score), 100);
  }

  /**
   * Calculer tendances analytics
   */
  calculateTrends(analytics) {
    if (analytics.length < 2) return {};

    const firstHalf = analytics.slice(0, Math.floor(analytics.length / 2));
    const secondHalf = analytics.slice(Math.floor(analytics.length / 2));

    const firstHalfAvg = firstHalf.reduce((sum, day) => sum + day.earned, 0) / firstHalf.length;
    const secondHalfAvg = secondHalf.reduce((sum, day) => sum + day.earned, 0) / secondHalf.length;

    const earningTrend = secondHalfAvg > firstHalfAvg * 1.1 ? 'increasing' :
                        secondHalfAvg < firstHalfAvg * 0.9 ? 'decreasing' : 'stable';

    return {
      earning: earningTrend,
      changePercent: Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100)
    };
  }

  /**
   * Obtenir nom d'affichage du type de transaction
   */
  getTransactionTypeDisplay(type) {
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
    
    return typeLabels[type] || type;
  }

  /**
   * Obtenir icône du type de transaction
   */
  getTransactionIcon(type) {
    const icons = {
      'EARN_BOOKING': '🏨',
      'EARN_REVIEW': '⭐',
      'EARN_REFERRAL': '👥',
      'EARN_BONUS': '🎁',
      'EARN_BIRTHDAY': '🎂',
      'EARN_ANNIVERSARY': '🎉',
      'REDEEM_DISCOUNT': '💰',
      'REDEEM_UPGRADE': '⬆️',
      'REDEEM_FREE_NIGHT': '🌙',
      'TIER_BONUS': '🏆',
      'EXPIRE': '⏰',
      'ADJUSTMENT_ADMIN': '⚙️'
    };
    
    return icons[type] || '📊';
  }

  /**
   * Obtenir nom d'affichage du niveau
   */
  getTierDisplayName(tier) {
    const names = {
      'BRONZE': 'Bronze',
      'SILVER': 'Argent',
      'GOLD': 'Or',
      'PLATINUM': 'Platine',
      'DIAMOND': 'Diamant'
    };
    return names[tier] || 'Bronze';
  }

  /**
   * Obtenir icône du niveau
   */
  getTierIcon(tier) {
    const icons = {
      'BRONZE': '🥉',
      'SILVER': '🥈',
      'GOLD': '🥇',
      'PLATINUM': '💎',
      'DIAMOND': '💠'
    };
    return icons[tier] || '🥉';
  }

  /**
   * Gestion du cache
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Cleanup if cache gets too large
    if (this.cache.size > 100) {
      const oldestKeys = Array.from(this.cache.keys()).slice(0, 20);
      oldestKeys.forEach(k => this.cache.delete(k));
    }
  }
}

// ============================================================================
// INSTANCE DU CONTRÔLEUR ET ROUTES
// ============================================================================

const loyaltyController = new LoyaltyController();

// ============================================================================
// EXPORTS DES MÉTHODES (Format Express.js)
// ============================================================================

module.exports = {
  // Statut et informations utilisateur
  getMyLoyaltyStatus: loyaltyController.getMyLoyaltyStatus,
  getLoyaltyDashboard: loyaltyController.getLoyaltyDashboard,
  getLoyaltySummary: loyaltyController.getLoyaltySummary,

  // Historique et transactions
  getLoyaltyHistory: loyaltyController.getLoyaltyHistory,
  getTransactionDetails: loyaltyController.getTransactionDetails,

  // Utilisation de points
  getRedemptionOptions: loyaltyController.getRedemptionOptions,
  redeemForDiscount: loyaltyController.redeemForDiscount,
  redeemForUpgrade: loyaltyController.redeemForUpgrade,
  redeemForFreeNight: loyaltyController.redeemForFreeNight,

  // Administration
  getAdminAnalytics: loyaltyController.getAdminAnalytics,
  adminAdjustPoints: loyaltyController.adminAdjustPoints,
  getAdminUsersList: loyaltyController.getAdminUsersList,
  createBonusCampaign: loyaltyController.createBonusCampaign,

  // Instance de classe pour accès aux méthodes utilitaires
  loyaltyController
};

// ============================================================================
// ROUTES SUGGÉRÉES POUR INTÉGRATION
// ============================================================================

/*
// Dans votre fichier de routes (ex: loyaltyRoutes.js)
const express = require('express');
const router = express.Router();
const {
  getMyLoyaltyStatus,
  getLoyaltyDashboard,
  getLoyaltySummary,
  getLoyaltyHistory,
  getTransactionDetails,
  getRedemptionOptions,
  redeemForDiscount,
  redeemForUpgrade,
  redeemForFreeNight,
  getAdminAnalytics,
  adminAdjustPoints,
  getAdminUsersList,
  createBonusCampaign
} = require('../controllers/loyaltyController');

const { protect, authorize } = require('../middleware/auth');

// Routes utilisateur
router.get('/status', protect, getMyLoyaltyStatus);
router.get('/dashboard', protect, getLoyaltyDashboard);
router.get('/summary', protect, getLoyaltySummary);
router.get('/history', protect, getLoyaltyHistory);
router.get('/transaction/:transactionId', protect, getTransactionDetails);

// Routes utilisation
router.get('/redemption/options', protect, getRedemptionOptions);
router.post('/redeem/discount', protect, redeemForDiscount);
router.post('/redeem/upgrade', protect, redeemForUpgrade);
router.post('/redeem/free-night', protect, redeemForFreeNight);

// Routes admin
router.get('/admin/analytics', protect, authorize('ADMIN'), getAdminAnalytics);
router.post('/admin/adjust-points', protect, authorize('ADMIN'), adminAdjustPoints);
router.get('/admin/users', protect, authorize('ADMIN'), getAdminUsersList);
router.post('/admin/campaign', protect, authorize('ADMIN'), createBonusCampaign);

module.exports = router;

// Dans app.js
app.use('/api/loyalty', require('./routes/loyaltyRoutes'));
*/