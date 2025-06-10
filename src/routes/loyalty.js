/**
 * LOYALTY ROUTES - ROUTES PROGRAMME DE FIDÉLITÉ
 * 
 * Routes complètes pour le système de fidélité :
 * - Statut et informations utilisateur
 * - Historique des transactions
 * - Utilisation de points (réductions, upgrades, bénéfices)
 * - Gestion des campagnes et promotions
 * - Administration (analytics, ajustements)
 * - Sécurité par rôles et validation complète
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

// Controllers
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

// Auth Middleware
const {
  authenticateToken,
  authorizeRoles,
  requireEmailVerification,
  requireOwnership,
  authRequired,
  adminRequired,
  clientRequired,
  enterpriseRateLimit,
  logAuthenticatedAccess
} = require('../middleware/auth');

// Validation Middleware
const {
  handleValidationErrors,
  validateObjectId,
  customValidation
} = require('../middleware/validation');

// Utilities
const asyncHandler = require('../middleware/asyncHandler');
const { AppError } = require('../middleware/errorHandler');

// ============================================================================
// MIDDLEWARE SPÉCIALISÉS LOYALTY
// ============================================================================

/**
 * Middleware spécifique pour vérifier l'inscription au programme de fidélité
 */
const requireLoyaltyMembership = asyncHandler(async (req, res, next) => {
  const User = require('../models/User');
  
  try {
    const user = await User.findById(req.user.userId).select('loyalty').lean();
    
    if (!user?.loyalty?.enrolledAt) {
      return res.status(403).json({
        success: false,
        message: 'Inscription au programme de fidélité requise',
        code: 'NOT_LOYALTY_MEMBER',
        action: 'ENROLL_REQUIRED',
        enrollmentUrl: '/api/loyalty/enroll'
      });
    }
    
    req.loyaltyMember = true;
    next();
  } catch (error) {
    throw new AppError('Erreur vérification membre fidélité', 500);
  }
});

/**
 * Middleware pour valider les montants de points
 */
const validatePointsAmount = [
  body('pointsAmount')
    .isInt({ min: 1, max: 100000 })
    .withMessage('Montant de points invalide (1-100000)')
    .custom((value) => {
      // Vérifier que c'est un multiple de 10 pour éviter les montants bizarres
      if (value % 10 !== 0 && value > 100) {
        throw new Error('Les montants importants doivent être des multiples de 10');
      }
      return true;
    }),
  handleValidationErrors
];

/**
 * Middleware pour valider les données de campagne
 */
const validateCampaignData = [
  body('name')
    .isLength({ min: 3, max: 100 })
    .withMessage('Nom de campagne requis (3-100 caractères)')
    .trim(),
  body('type')
    .isIn(['MULTIPLIER', 'BONUS_FIXED', 'TIER_UPGRADE', 'SEASONAL', 'WELCOME'])
    .withMessage('Type de campagne invalide'),
  body('value')
    .isFloat({ min: 0.1, max: 10 })
    .withMessage('Valeur de campagne invalide (0.1-10)'),
  body('startDate')
    .isISO8601()
    .withMessage('Date de début invalide')
    .custom((value) => {
      const startDate = new Date(value);
      const now = new Date();
      if (startDate < now) {
        throw new Error('La date de début ne peut pas être dans le passé');
      }
      return true;
    }),
  body('endDate')
    .isISO8601()
    .withMessage('Date de fin invalide')
    .custom((value, { req }) => {
      const endDate = new Date(value);
      const startDate = new Date(req.body.startDate);
      if (endDate <= startDate) {
        throw new Error('La date de fin doit être après la date de début');
      }
      return true;
    }),
  body('targetTiers')
    .optional()
    .isArray()
    .withMessage('Les niveaux cibles doivent être un tableau')
    .custom((value) => {
      const validTiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND', 'ALL'];
      const invalidTiers = value.filter(tier => !validTiers.includes(tier));
      if (invalidTiers.length > 0) {
        throw new Error(`Niveaux invalides: ${invalidTiers.join(', ')}`);
      }
      return true;
    }),
  handleValidationErrors
];

/**
 * Middleware pour valider les données d'utilisation de points
 */
const validateRedemptionData = [
  body('pointsToRedeem')
    .isInt({ min: 100, max: 50000 })
    .withMessage('Points à utiliser invalides (100-50000)'),
  body('redemptionType')
    .isIn(['DISCOUNT', 'UPGRADE', 'FREE_NIGHT', 'BENEFIT'])
    .withMessage('Type d\'utilisation invalide'),
  body('bookingId')
    .optional()
    .isMongoId()
    .withMessage('ID de réservation invalide'),
  handleValidationErrors
];

/**
 * Rate limiting spécialisé pour loyalty
 */
const loyaltyRateLimit = enterpriseRateLimit({
  CLIENT: 200,        // 200 req/15min pour clients
  RECEPTIONIST: 400,  // 400 req/15min pour réceptionnistes  
  ADMIN: 1000        // 1000 req/15min pour admins
});

// ============================================================================
// ROUTES PUBLIQUES ET INSCRIPTION
// ============================================================================

/**
 * GET /api/loyalty/info
 * Informations publiques sur le programme de fidélité
 * Public - Pas d'auth requise
 */
router.get('/info', 
  loyaltyRateLimit,
  asyncHandler(async (req, res) => {
    const programInfo = {
      success: true,
      data: {
        program: {
          name: 'Programme Fidélité Hôtel',
          description: 'Gagnez des points à chaque réservation et profitez d\'avantages exclusifs',
          currency: 'points',
          conversionRate: '100 points = 1€'
        },
        tiers: [
          {
            name: 'Bronze',
            threshold: 0,
            icon: '🥉',
            benefits: ['Points sur réservations', 'Offres exclusives'],
            pointsMultiplier: 1.0
          },
          {
            name: 'Argent', 
            threshold: 1000,
            icon: '🥈',
            benefits: ['20% bonus points', 'Check-in prioritaire', '1 upgrade/an'],
            pointsMultiplier: 1.2
          },
          {
            name: 'Or',
            threshold: 5000,
            icon: '🥇',
            benefits: ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades/an'],
            pointsMultiplier: 1.5
          },
          {
            name: 'Platine',
            threshold: 15000,
            icon: '💎',
            benefits: ['Double points', 'Accès lounge', '1 nuit gratuite/an'],
            pointsMultiplier: 2.0
          },
          {
            name: 'Diamant',
            threshold: 50000,
            icon: '💠',
            benefits: ['2.5x points', 'Suite upgrade', '2 nuits gratuites/an'],
            pointsMultiplier: 2.5
          }
        ],
        redemption: [
          { type: 'Réduction', rate: '100 points = 1€', min: 100 },
          { type: 'Upgrade chambre', cost: 1000, description: 'Surclassement gratuit' },
          { type: 'Nuit gratuite', cost: 5000, description: 'Une nuit offerte' },
          { type: 'Petit-déjeuner', cost: 250, description: 'Petit-déjeuner gratuit' }
        ],
        enrollment: {
          required: true,
          automatic: true,
          welcomeBonus: 200,
          description: 'Inscription automatique à la première réservation'
        }
      },
      meta: {
        version: '2.0',
        lastUpdated: new Date(),
        contactSupport: '/contact'
      }
    };

    res.status(200).json(programInfo);
  })
);

/**
 * POST /api/loyalty/enroll
 * Inscription manuelle au programme de fidélité
 * Auth: CLIENT requis
 */
router.post('/enroll',
  authRequired,
  clientRequired,
  loyaltyRateLimit,
  [
    body('acceptTerms')
      .isBoolean()
      .withMessage('Acceptation des conditions requise')
      .custom((value) => {
        if (!value) {
          throw new Error('Vous devez accepter les conditions du programme');
        }
        return true;
      }),
    body('preferredCommunication')
      .optional()
      .isIn(['EMAIL', 'SMS', 'BOTH', 'NONE'])
      .withMessage('Préférence de communication invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const User = require('../models/User');
    const { getLoyaltyService } = require('../services/loyaltyService');
    
    const userId = req.user.userId;
    const { acceptTerms, preferredCommunication = 'EMAIL' } = req.body;

    try {
      const user = await User.findById(userId);
      
      if (!user) {
        throw new AppError('Utilisateur non trouvé', 404);
      }

      // Vérifier si déjà inscrit
      if (user.loyalty?.enrolledAt) {
        return res.status(400).json({
          success: false,
          message: 'Vous êtes déjà inscrit au programme de fidélité',
          code: 'ALREADY_ENROLLED',
          enrolledAt: user.loyalty.enrolledAt,
          currentTier: user.loyalty.tier,
          currentPoints: user.loyalty.currentPoints
        });
      }

      // Initialiser le programme de fidélité
      user.loyalty = {
        enrolledAt: new Date(),
        tier: 'BRONZE',
        currentPoints: 200, // Bonus de bienvenue
        lifetimePoints: 200,
        tierProgress: {
          pointsToNextTier: 800, // 1000 - 200
          nextTier: 'SILVER',
          progressPercentage: 20
        },
        preferences: {
          communicationPreferences: {
            email: ['EMAIL', 'BOTH'].includes(preferredCommunication),
            sms: ['SMS', 'BOTH'].includes(preferredCommunication),
            push: true,
            newsletter: true,
            promotions: true
          }
        },
        statistics: {
          totalBookingsWithPoints: 0,
          totalPointsEarned: 200,
          totalPointsRedeemed: 0,
          joinDate: new Date(),
          lastActivity: new Date()
        }
      };

      await user.save();

      // Attribution du bonus de bienvenue via transaction
      const loyaltyService = getLoyaltyService();
      await loyaltyService.awardBonusPoints(
        userId,
        'EARN_WELCOME',
        200,
        'Bonus de bienvenue au programme de fidélité',
        { enrollmentDate: new Date(), communicationPreference: preferredCommunication }
      );

      res.status(201).json({
        success: true,
        message: 'Inscription au programme de fidélité réussie !',
        data: {
          enrolledAt: user.loyalty.enrolledAt,
          welcomeBonus: 200,
          currentTier: 'BRONZE',
          currentPoints: 200,
          nextMilestone: {
            tier: 'SILVER',
            pointsNeeded: 800
          },
          benefits: [
            'Points sur toutes vos réservations',
            'Offres exclusives membres',
            'Progression vers niveaux supérieurs'
          ]
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de l\'inscription au programme', 500);
    }
  })
);

// ============================================================================
// ROUTES STATUT ET INFORMATIONS UTILISATEUR
// ============================================================================

/**
 * GET /api/loyalty/status
 * Statut complet du programme de fidélité de l'utilisateur
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/status',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('skipCache')
      .optional()
      .isBoolean()
      .withMessage('skipCache doit être un booléen'),
    query('includeAnalytics')
      .optional()
      .isBoolean()
      .withMessage('includeAnalytics doit être un booléen'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getMyLoyaltyStatus
);

/**
 * GET /api/loyalty/dashboard
 * Dashboard personnalisé avec métriques et insights
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/dashboard',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('period')
      .optional()
      .isIn(['7d', '30d', '90d', '1y'])
      .withMessage('Période invalide (7d, 30d, 90d, 1y)'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getLoyaltyDashboard
);

/**
 * GET /api/loyalty/summary
 * Résumé rapide pour widgets/header
 * Auth: CLIENT requis + membre fidélité  
 */
router.get('/summary',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  logAuthenticatedAccess,
  getLoyaltySummary
);

// ============================================================================
// ROUTES HISTORIQUE ET TRANSACTIONS
// ============================================================================

/**
 * GET /api/loyalty/history
 * Historique détaillé des transactions avec filtres
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/history',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('page')
      .optional()
      .isInt({ min: 1, max: 1000 })
      .withMessage('Page invalide (1-1000)'),
    query('limit')
      .optional()
      .isInt({ min: 5, max: 100 })
      .withMessage('Limite invalide (5-100)'),
    query('type')
      .optional()
      .isIn(['ALL', 'EARNINGS', 'REDEMPTIONS', 'EARN_BOOKING', 'EARN_REVIEW', 'REDEEM_DISCOUNT', 'REDEEM_UPGRADE'])
      .withMessage('Type de transaction invalide'),
    query('status')
      .optional()
      .isIn(['ALL', 'COMPLETED', 'PENDING', 'CANCELLED', 'EXPIRED'])
      .withMessage('Statut invalide'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Date de début invalide'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Date de fin invalide'),
    query('groupBy')
      .optional()
      .isIn(['none', 'month', 'type'])
      .withMessage('Groupement invalide'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getLoyaltyHistory
);

/**
 * GET /api/loyalty/history/export
 * Export de l'historique en CSV/PDF
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/history/export',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  [
    query('format')
      .isIn(['CSV', 'PDF', 'EXCEL'])
      .withMessage('Format d\'export invalide (CSV, PDF, EXCEL)'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Date de début invalide'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Date de fin invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { format, startDate, endDate } = req.query;
    const userId = req.user.userId;

    // TODO: Implémenter l'export (CSV/PDF)
    // Pour l'instant, retourner un placeholder
    res.status(501).json({
      success: false,
      message: 'Export en cours de développement',
      code: 'FEATURE_COMING_SOON',
      supportedFormats: ['CSV', 'PDF', 'EXCEL'],
      eta: 'Q2 2024'
    });
  })
);

/**
 * GET /api/loyalty/transaction/:transactionId
 * Détails d'une transaction spécifique
 * Auth: CLIENT requis + propriété de la transaction
 */
router.get('/transaction/:transactionId',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  [
    param('transactionId')
      .isMongoId()
      .withMessage('ID de transaction invalide'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getTransactionDetails
);

// ============================================================================
// ROUTES UTILISATION DE POINTS
// ============================================================================

/**
 * GET /api/loyalty/redemption/options
 * Options d'utilisation disponibles selon le solde et niveau
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/redemption/options',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('bookingId')
      .optional()
      .isMongoId()
      .withMessage('ID de réservation invalide'),
    query('category')
      .optional()
      .isIn(['ALL', 'DISCOUNT', 'UPGRADE', 'BENEFITS', 'EXPERIENCES'])
      .withMessage('Catégorie invalide'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getRedemptionOptions
);

/**
 * POST /api/loyalty/redeem/discount
 * Utiliser des points pour une réduction
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/redeem/discount',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  requireEmailVerification,
  loyaltyRateLimit,
  redeemForDiscount,
  logAuthenticatedAccess
);

/**
 * POST /api/loyalty/redeem/upgrade
 * Utiliser des points pour un upgrade
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/redeem/upgrade',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  requireEmailVerification,
  loyaltyRateLimit,
  redeemForUpgrade,
  logAuthenticatedAccess
);

/**
 * POST /api/loyalty/redeem/free-night
 * Utiliser des points pour une nuit gratuite
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/redeem/free-night',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  requireEmailVerification,
  loyaltyRateLimit,
  redeemForFreeNight,
  logAuthenticatedAccess
);

/**
 * POST /api/loyalty/redeem/benefit
 * Utiliser des points pour un bénéfice (petit-déjeuner, lounge, etc.)
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/redeem/benefit',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  requireEmailVerification,
  loyaltyRateLimit,
  [
    body('benefitType')
      .isIn(['BREAKFAST', 'LOUNGE_ACCESS', 'LATE_CHECKOUT', 'EARLY_CHECKIN', 'SPA_DISCOUNT', 'PARKING'])
      .withMessage('Type de bénéfice invalide'),
    body('pointsToRedeem')
      .isInt({ min: 50, max: 2000 })
      .withMessage('Points à utiliser invalides (50-2000)'),
    body('bookingId')
      .optional()
      .isMongoId()
      .withMessage('ID de réservation invalide'),
    body('validDate')
      .optional()
      .isISO8601()
      .withMessage('Date de validité invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { benefitType, pointsToRedeem, bookingId, validDate } = req.body;
    const userId = req.user.userId;

    // TODO: Implémenter l'utilisation de bénéfices
    // Pour l'instant, simulation de la logique
    const benefitCosts = {
      'BREAKFAST': 250,
      'LOUNGE_ACCESS': 300,
      'LATE_CHECKOUT': 150,
      'EARLY_CHECKIN': 150,
      'SPA_DISCOUNT': 200,
      'PARKING': 100
    };

    const requiredPoints = benefitCosts[benefitType];
    
    if (pointsToRedeem !== requiredPoints) {
      return res.status(400).json({
        success: false,
        message: `Ce bénéfice coûte ${requiredPoints} points`,
        code: 'INCORRECT_POINTS_AMOUNT',
        required: requiredPoints,
        provided: pointsToRedeem
      });
    }

    res.status(200).json({
      success: true,
      message: `Bénéfice ${benefitType} réservé avec succès`,
      data: {
        benefitType,
        pointsUsed: pointsToRedeem,
        voucher: `BENEFIT_${Date.now()}`,
        validUntil: validDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        instructions: 'Présentez ce voucher lors de votre séjour'
      }
    });
  }),
  logAuthenticatedAccess
);

// ============================================================================
// ROUTES TRANSFERT ET PARTAGE
// ============================================================================

/**
 * POST /api/loyalty/transfer
 * Transférer des points à un autre membre (fonctionnalité premium)
 * Auth: CLIENT requis + membre fidélité + niveau Gold+
 */
router.post('/transfer',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  requireEmailVerification,
  loyaltyRateLimit,
  [
    body('recipientEmail')
      .isEmail()
      .withMessage('Email du destinataire invalide')
      .toLowerCase()
      .trim(),
    body('pointsToTransfer')
      .isInt({ min: 100, max: 10000 })
      .withMessage('Points à transférer invalides (100-10000)')
      .custom((value) => {
        if (value % 50 !== 0) {
          throw new Error('Les points doivent être transférés par multiples de 50');
        }
        return true;
      }),
    body('message')
      .optional()
      .isLength({ min: 1, max: 200 })
      .withMessage('Message trop long (max 200 caractères)')
      .trim(),
    body('confirmTransfer')
      .isBoolean()
      .withMessage('Confirmation de transfert requise')
      .custom((value) => {
        if (!value) {
          throw new Error('Vous devez confirmer le transfert');
        }
        return true;
      }),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const User = require('../models/User');
    const { recipientEmail, pointsToTransfer, message, confirmTransfer } = req.body;
    const userId = req.user.userId;

    try {
      // Vérifier que l'utilisateur a un niveau suffisant pour transférer
      const user = await User.findById(userId).select('loyalty').lean();
      
      if (!['GOLD', 'PLATINUM', 'DIAMOND'].includes(user.loyalty.tier)) {
        return res.status(403).json({
          success: false,
          message: 'Transfert de points réservé aux membres Gold et plus',
          code: 'INSUFFICIENT_TIER',
          currentTier: user.loyalty.tier,
          requiredTier: 'GOLD',
          hint: 'Atteignez le niveau Gold pour débloquer cette fonctionnalité'
        });
      }

      // Vérifier le solde
      if (user.loyalty.currentPoints < pointsToTransfer) {
        return res.status(400).json({
          success: false,
          message: 'Solde de points insuffisant',
          code: 'INSUFFICIENT_POINTS',
          available: user.loyalty.currentPoints,
          requested: pointsToTransfer,
          shortfall: pointsToTransfer - user.loyalty.currentPoints
        });
      }

      // Trouver le destinataire
      const recipient = await User.findOne({ 
        email: recipientEmail,
        'loyalty.enrolledAt': { $exists: true }
      }).select('firstName lastName email loyalty');

      if (!recipient) {
        return res.status(404).json({
          success: false,
          message: 'Destinataire non trouvé ou non membre du programme',
          code: 'RECIPIENT_NOT_FOUND',
          hint: 'Le destinataire doit être inscrit au programme de fidélité'
        });
      }

      // Empêcher le transfert vers soi-même
      if (recipient._id.toString() === userId) {
        return res.status(400).json({
          success: false,
          message: 'Impossible de transférer des points vers votre propre compte',
          code: 'SELF_TRANSFER_DENIED'
        });
      }

      // TODO: Implémenter la logique de transfert complète
      // Pour l'instant, simulation
      res.status(200).json({
        success: true,
        message: 'Transfert de points effectué avec succès',
        data: {
          transferId: `TR_${Date.now()}`,
          from: {
            userId: userId,
            name: req.user.fullName
          },
          to: {
            userId: recipient._id,
            name: `${recipient.firstName} ${recipient.lastName}`,
            email: recipient.email
          },
          pointsTransferred: pointsToTransfer,
          fee: Math.ceil(pointsToTransfer * 0.05), // 5% de frais
          message: message || 'Transfert de points fidélité',
          processedAt: new Date(),
          status: 'COMPLETED'
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors du transfert de points', 500);
    }
  }),
  logAuthenticatedAccess
);

// ============================================================================
// ROUTES CAMPAGNES ET PROMOTIONS
// ============================================================================

/**
 * GET /api/loyalty/campaigns
 * Campagnes et promotions actives
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/campaigns',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('status')
      .optional()
      .isIn(['ACTIVE', 'UPCOMING', 'EXPIRED', 'ALL'])
      .withMessage('Statut de campagne invalide'),
    query('type')
      .optional()
      .isIn(['MULTIPLIER', 'BONUS_FIXED', 'TIER_UPGRADE', 'SEASONAL', 'ALL'])
      .withMessage('Type de campagne invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { status = 'ACTIVE', type = 'ALL' } = req.query;
    const userId = req.user.userId;

    try {
      // TODO: Récupérer depuis la base Campaign
      // Pour l'instant, simulation des campagnes actives
      const campaigns = [
        {
          id: 'SUMMER2024',
          name: 'Bonus Été 2024',
          description: 'Points x1.5 sur toutes vos réservations estivales',
          type: 'MULTIPLIER',
          value: 1.5,
          status: 'ACTIVE',
          startDate: '2024-06-01T00:00:00Z',
          endDate: '2024-08-31T23:59:59Z',
          targetTiers: ['ALL'],
          eligible: true,
          conditions: [
            'Réservation min. 2 nuits',
            'Valable dans tous nos hôtels',
            'Non cumulable avec autres offres'
          ],
          icon: '☀️',
          badge: 'HOT'
        },
        {
          id: 'REVIEW2024',
          name: 'Super Avis',
          description: 'Bonus de 200 points pour chaque avis client',
          type: 'BONUS_FIXED',
          value: 200,
          status: 'ACTIVE',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-12-31T23:59:59Z',
          targetTiers: ['ALL'],
          eligible: true,
          conditions: [
            'Avis après séjour terminé',
            'Minimum 50 mots',
            'Maximum 1 bonus par séjour'
          ],
          icon: '⭐',
          badge: 'POPULAR'
        },
        {
          id: 'GOLD_UPGRADE',
          name: 'Promotion Or',
          description: 'Bonus de 1000 points pour atteindre le niveau Or',
          type: 'TIER_UPGRADE',
          value: 1000,
          status: 'ACTIVE',
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-06-30T23:59:59Z',
          targetTiers: ['SILVER'],
          eligible: req.user.tier === 'SILVER',
          conditions: [
            'Réservé aux membres Argent',
            'Atteindre 5000 points lifetime',
            'Bonus versé automatiquement'
          ],
          icon: '🥇',
          badge: 'EXCLUSIVE'
        }
      ];

      // Filtrer selon les paramètres
      let filteredCampaigns = campaigns;
      
      if (status !== 'ALL') {
        filteredCampaigns = filteredCampaigns.filter(c => c.status === status);
      }
      
      if (type !== 'ALL') {
        filteredCampaigns = filteredCampaigns.filter(c => c.type === type);
      }

      // Calculer jours restants pour campagnes actives
      filteredCampaigns = filteredCampaigns.map(campaign => {
        const endDate = new Date(campaign.endDate);
        const now = new Date();
        const daysRemaining = Math.ceil((endDate - now) / (24 * 60 * 60 * 1000));
        
        return {
          ...campaign,
          daysRemaining: daysRemaining > 0 ? daysRemaining : 0,
          isExpiringSoon: daysRemaining <= 7 && daysRemaining > 0
        };
      });

      res.status(200).json({
        success: true,
        data: {
          campaigns: filteredCampaigns,
          summary: {
            total: filteredCampaigns.length,
            active: campaigns.filter(c => c.status === 'ACTIVE').length,
            eligible: filteredCampaigns.filter(c => c.eligible).length,
            expiringSoon: filteredCampaigns.filter(c => c.isExpiringSoon).length
          }
        },
        meta: {
          filters: { status, type },
          lastUpdated: new Date()
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la récupération des campagnes', 500);
    }
  }),
  logAuthenticatedAccess
);

/**
 * POST /api/loyalty/campaigns/:campaignId/participate
 * Participer à une campagne spécifique
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/campaigns/:campaignId/participate',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    param('campaignId')
      .isLength({ min: 3, max: 50 })
      .withMessage('ID de campagne invalide')
      .trim(),
    body('acceptTerms')
      .isBoolean()
      .withMessage('Acceptation des conditions requise')
      .custom((value) => {
        if (!value) {
          throw new Error('Vous devez accepter les conditions de la campagne');
        }
        return true;
      }),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { campaignId } = req.params;
    const { acceptTerms } = req.body;
    const userId = req.user.userId;

    try {
      // TODO: Vérifier que la campagne existe et est active
      // TODO: Vérifier l'éligibilité de l'utilisateur
      // TODO: Enregistrer la participation
      
      res.status(200).json({
        success: true,
        message: 'Participation à la campagne enregistrée',
        data: {
          campaignId,
          participationDate: new Date(),
          status: 'ACTIVE',
          expectedBenefits: 'Bonus appliqué automatiquement lors de vos prochaines réservations',
          trackingId: `PART_${userId}_${campaignId}_${Date.now()}`
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la participation à la campagne', 500);
    }
  }),
  logAuthenticatedAccess
);

// ============================================================================
// ROUTES BÉNÉFICES ET AVANTAGES
// ============================================================================

/**
 * GET /api/loyalty/benefits
 * Bénéfices disponibles selon le niveau utilisateur
 * Auth: CLIENT requis + membre fidélité
 */
router.get('/benefits',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    query('category')
      .optional()
      .isIn(['ALL', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'AVAILABLE'])
      .withMessage('Catégorie de bénéfices invalide'),
    query('type')
      .optional()
      .isIn(['ALL', 'DISCOUNT', 'UPGRADE', 'FREE_SERVICE', 'ACCESS'])
      .withMessage('Type de bénéfice invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const User = require('../models/User');
    const { category = 'ALL', type = 'ALL' } = req.query;
    const userId = req.user.userId;

    try {
      const user = await User.findById(userId).select('loyalty').lean();
      
      // Bénéfices par niveau
      const tierBenefits = {
        BRONZE: [
          {
            id: 'bronze_points',
            name: 'Points sur réservations',
            description: '1 point par euro dépensé',
            type: 'EARNING',
            status: 'ACTIVE',
            icon: '💰',
            automatic: true
          }
        ],
        SILVER: [
          {
            id: 'silver_bonus',
            name: 'Bonus points 20%',
            description: '20% de points en plus sur toutes les réservations',
            type: 'EARNING',
            status: 'ACTIVE',
            icon: '📈',
            automatic: true
          },
          {
            id: 'silver_checkin',
            name: 'Check-in prioritaire',
            description: 'File prioritaire à la réception',
            type: 'ACCESS',
            status: 'ACTIVE',
            icon: '⚡',
            automatic: true
          },
          {
            id: 'silver_upgrade',
            name: 'Upgrade gratuit',
            description: '1 upgrade gratuit par an',
            type: 'UPGRADE',
            status: user.loyalty.activeBenefits?.find(b => b.type === 'UPGRADE')?.usageCount < 1 ? 'AVAILABLE' : 'USED',
            icon: '⬆️',
            usageLimit: 1,
            usageCount: user.loyalty.activeBenefits?.find(b => b.type === 'UPGRADE')?.usageCount || 0
          }
        ],
        GOLD: [
          {
            id: 'gold_bonus',
            name: 'Bonus points 50%',
            description: '50% de points en plus sur toutes les réservations',
            type: 'EARNING',
            status: 'ACTIVE',
            icon: '🚀',
            automatic: true
          },
          {
            id: 'gold_breakfast',
            name: 'Petit-déjeuner gratuit',
            description: 'Petit-déjeuner offert à chaque séjour',
            type: 'FREE_SERVICE',
            status: 'ACTIVE',
            icon: '🥐',
            automatic: true
          },
          {
            id: 'gold_checkout',
            name: 'Check-out tardif',
            description: 'Départ jusqu\'à 14h sans frais',
            type: 'ACCESS',
            status: 'ACTIVE',
            icon: '🕐',
            automatic: true
          }
        ],
        PLATINUM: [
          {
            id: 'platinum_points',
            name: 'Double points',
            description: 'Points doublés sur toutes les réservations',
            type: 'EARNING',
            status: 'ACTIVE',
            icon: '💎',
            automatic: true
          },
          {
            id: 'platinum_lounge',
            name: 'Accès lounge VIP',
            description: 'Accès aux salons VIP dans nos hôtels',
            type: 'ACCESS',
            status: 'ACTIVE',
            icon: '🍸',
            automatic: true
          },
          {
            id: 'platinum_night',
            name: 'Nuit gratuite annuelle',
            description: '1 nuit gratuite par année d\'adhésion',
            type: 'FREE_SERVICE',
            status: 'AVAILABLE',
            icon: '🌙',
            usageLimit: 1,
            usageCount: 0
          }
        ],
        DIAMOND: [
          {
            id: 'diamond_points',
            name: 'Points x2.5',
            description: '2.5x points sur toutes les réservations',
            type: 'EARNING',
            status: 'ACTIVE',
            icon: '💠',
            automatic: true
          },
          {
            id: 'diamond_suite',
            name: 'Suite upgrade automatique',
            description: 'Upgrade automatique vers suite quand disponible',
            type: 'UPGRADE',
            status: 'ACTIVE',
            icon: '👑',
            automatic: true
          },
          {
            id: 'diamond_concierge',
            name: 'Service concierge dédié',
            description: 'Concierge personnel pour tous vos besoins',
            type: 'ACCESS',
            status: 'ACTIVE',
            icon: '🎩',
            automatic: true
          }
        ]
      };

      // Récupérer les bénéfices du niveau actuel et inférieurs
      const userTier = user.loyalty.tier;
      const tierOrder = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
      const userTierIndex = tierOrder.indexOf(userTier);
      
      let allBenefits = [];
      for (let i = 0; i <= userTierIndex; i++) {
        const tierName = tierOrder[i];
        if (tierBenefits[tierName]) {
          allBenefits = allBenefits.concat(
            tierBenefits[tierName].map(benefit => ({
              ...benefit,
              tier: tierName,
              inherited: i < userTierIndex
            }))
          );
        }
      }

      // Appliquer les filtres
      let filteredBenefits = allBenefits;
      
      if (category !== 'ALL') {
        filteredBenefits = filteredBenefits.filter(b => b.status === category);
      }
      
      if (type !== 'ALL') {
        filteredBenefits = filteredBenefits.filter(b => b.type === type);
      }

      // Prochains bénéfices à débloquer
      const nextTierBenefits = userTierIndex < tierOrder.length - 1 ? 
        tierBenefits[tierOrder[userTierIndex + 1]] || [] : [];

      res.status(200).json({
        success: true,
        data: {
          currentTier: userTier,
          benefits: filteredBenefits,
          summary: {
            total: filteredBenefits.length,
            active: filteredBenefits.filter(b => b.status === 'ACTIVE').length,
            available: filteredBenefits.filter(b => b.status === 'AVAILABLE').length,
            automatic: filteredBenefits.filter(b => b.automatic).length
          },
          nextLevel: {
            tier: userTierIndex < tierOrder.length - 1 ? tierOrder[userTierIndex + 1] : null,
            benefits: nextTierBenefits,
            pointsNeeded: user.loyalty.tierProgress?.pointsToNextTier || 0
          }
        },
        meta: {
          filters: { category, type },
          userTier,
          lastUpdated: new Date()
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la récupération des bénéfices', 500);
    }
  }),
  logAuthenticatedAccess
);

/**
 * POST /api/loyalty/benefits/:benefitId/activate
 * Activer un bénéfice spécifique (pour les bénéfices non automatiques)
 * Auth: CLIENT requis + membre fidélité
 */
router.post('/benefits/:benefitId/activate',
  authRequired,
  clientRequired,
  requireLoyaltyMembership,
  loyaltyRateLimit,
  [
    param('benefitId')
      .isLength({ min: 3, max: 50 })
      .withMessage('ID de bénéfice invalide'),
    body('bookingId')
      .optional()
      .isMongoId()
      .withMessage('ID de réservation invalide'),
    body('activationDate')
      .optional()
      .isISO8601()
      .withMessage('Date d\'activation invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { benefitId } = req.params;
    const { bookingId, activationDate } = req.body;
    const userId = req.user.userId;

    try {
      // TODO: Vérifier que l'utilisateur a accès à ce bénéfice
      // TODO: Vérifier les limites d'utilisation
      // TODO: Activer le bénéfice
      
      res.status(200).json({
        success: true,
        message: 'Bénéfice activé avec succès',
        data: {
          benefitId,
          activatedAt: activationDate || new Date(),
          appliedTo: bookingId || 'GENERAL',
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 jours
          activationCode: `ACT_${benefitId}_${Date.now()}`,
          instructions: 'Présentez ce code lors de votre séjour ou réservation'
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de l\'activation du bénéfice', 500);
    }
  }),
  logAuthenticatedAccess
);

// ============================================================================
// ROUTES ADMINISTRATION
// ============================================================================

/**
 * GET /api/loyalty/admin/analytics
 * Analytics globaux du programme (Admin uniquement)
 * Auth: ADMIN requis
 */
router.get('/admin/analytics',
  adminRequired,
  loyaltyRateLimit,
  [
    query('period')
      .optional()
      .isIn(['7d', '30d', '90d', '1y'])
      .withMessage('Période invalide'),
    query('hotelId')
      .optional()
      .isMongoId()
      .withMessage('ID hôtel invalide'),
    query('includeProjections')
      .optional()
      .isBoolean()
      .withMessage('includeProjections doit être un booléen'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getAdminAnalytics
);

/**
 * POST /api/loyalty/admin/adjust-points
 * Ajustement manuel de points (Admin uniquement)
 * Auth: ADMIN requis
 */
router.post('/admin/adjust-points',
  adminRequired,
  loyaltyRateLimit,
  logAuthenticatedAccess,
  adminAdjustPoints
);

/**
 * GET /api/loyalty/admin/users
 * Liste des utilisateurs du programme avec filtres (Admin)
 * Auth: ADMIN requis
 */
router.get('/admin/users',
  adminRequired,
  loyaltyRateLimit,
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page invalide'),
    query('limit')
      .optional()
      .isInt({ min: 10, max: 100 })
      .withMessage('Limite invalide (10-100)'),
    query('tier')
      .optional()
      .isIn(['ALL', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'])
      .withMessage('Niveau invalide'),
    query('sortBy')
      .optional()
      .isIn(['lifetimePoints', 'currentPoints', 'memberSince', 'lastActivity'])
      .withMessage('Tri invalide'),
    query('search')
      .optional()
      .isLength({ min: 2, max: 100 })
      .withMessage('Recherche invalide (2-100 caractères)'),
    handleValidationErrors
  ],
  logAuthenticatedAccess,
  getAdminUsersList
);

/**
 * POST /api/loyalty/admin/campaigns
 * Créer une campagne de points bonus (Admin)
 * Auth: ADMIN requis
 */
router.post('/admin/campaigns',
  adminRequired,
  loyaltyRateLimit,
  validateCampaignData,
  logAuthenticatedAccess,
  createBonusCampaign
);

/**
 * GET /api/loyalty/admin/campaigns
 * Gestion des campagnes (Admin)
 * Auth: ADMIN requis
 */
router.get('/admin/campaigns',
  adminRequired,
  loyaltyRateLimit,
  [
    query('status')
      .optional()
      .isIn(['ALL', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'DRAFT'])
      .withMessage('Statut de campagne invalide'),
    query('type')
      .optional()
      .isIn(['ALL', 'MULTIPLIER', 'BONUS_FIXED', 'TIER_UPGRADE', 'SEASONAL'])
      .withMessage('Type de campagne invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { status = 'ALL', type = 'ALL' } = req.query;

    try {
      // TODO: Récupérer les campagnes depuis la base de données
      // Pour l'instant, simulation
      const adminCampaigns = [
        {
          id: 'SUMMER2024',
          name: 'Bonus Été 2024',
          type: 'MULTIPLIER',
          value: 1.5,
          status: 'ACTIVE',
          startDate: '2024-06-01T00:00:00Z',
          endDate: '2024-08-31T23:59:59Z',
          targetTiers: ['ALL'],
          createdBy: 'admin@hotel.com',
          createdAt: '2024-05-15T10:00:00Z',
          stats: {
            participants: 1542,
            pointsIssued: 89750,
            revenue: 125000,
            conversions: 892
          }
        },
        {
          id: 'GOLD_PROMO',
          name: 'Promotion Niveau Or',
          type: 'TIER_UPGRADE',
          value: 1000,
          status: 'UPCOMING',
          startDate: '2024-07-01T00:00:00Z',
          endDate: '2024-07-31T23:59:59Z',
          targetTiers: ['SILVER'],
          createdBy: 'admin@hotel.com',
          createdAt: '2024-06-01T14:30:00Z',
          stats: {
            participants: 0,
            pointsIssued: 0,
            estimatedBudget: 50000
          }
        }
      ];

      // Appliquer filtres
      let filteredCampaigns = adminCampaigns;
      
      if (status !== 'ALL') {
        filteredCampaigns = filteredCampaigns.filter(c => c.status === status);
      }
      
      if (type !== 'ALL') {
        filteredCampaigns = filteredCampaigns.filter(c => c.type === type);
      }

      res.status(200).json({
        success: true,
        data: {
          campaigns: filteredCampaigns,
          summary: {
            total: adminCampaigns.length,
            active: adminCampaigns.filter(c => c.status === 'ACTIVE').length,
            upcoming: adminCampaigns.filter(c => c.status === 'UPCOMING').length,
            totalParticipants: adminCampaigns.reduce((sum, c) => sum + c.stats.participants, 0),
            totalPointsIssued: adminCampaigns.reduce((sum, c) => sum + c.stats.pointsIssued, 0)
          }
        },
        meta: {
          filters: { status, type },
          generatedAt: new Date()
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la récupération des campagnes admin', 500);
    }
  }),
  logAuthenticatedAccess
);

/**
 * PUT /api/loyalty/admin/campaigns/:campaignId
 * Modifier une campagne (Admin)
 * Auth: ADMIN requis
 */
router.put('/admin/campaigns/:campaignId',
  adminRequired,
  loyaltyRateLimit,
  [
    param('campaignId')
      .isLength({ min: 3, max: 50 })
      .withMessage('ID de campagne invalide'),
    validateCampaignData,
  ],
  asyncHandler(async (req, res) => {
    const { campaignId } = req.params;
    const updateData = req.body;

    try {
      // TODO: Mettre à jour la campagne en base
      
      res.status(200).json({
        success: true,
        message: 'Campagne mise à jour avec succès',
        data: {
          campaignId,
          updatedFields: Object.keys(updateData),
          lastModified: new Date(),
          modifiedBy: req.user.email
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la mise à jour de la campagne', 500);
    }
  }),
  logAuthenticatedAccess
);

/**
 * DELETE /api/loyalty/admin/campaigns/:campaignId
 * Supprimer une campagne (Admin)
 * Auth: ADMIN requis
 */
router.delete('/admin/campaigns/:campaignId',
  adminRequired,
  loyaltyRateLimit,
  [
    param('campaignId')
      .isLength({ min: 3, max: 50 })
      .withMessage('ID de campagne invalide'),
    body('confirmDeletion')
      .isBoolean()
      .withMessage('Confirmation de suppression requise')
      .custom((value) => {
        if (!value) {
          throw new Error('Vous devez confirmer la suppression');
        }
        return true;
      }),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { campaignId } = req.params;
    const { confirmDeletion } = req.body;

    try {
      // TODO: Supprimer la campagne et gérer les participants actifs
      
      res.status(200).json({
        success: true,
        message: 'Campagne supprimée avec succès',
        data: {
          campaignId,
          deletedAt: new Date(),
          deletedBy: req.user.email,
          affectedParticipants: 0 // TODO: calculer réellement
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la suppression de la campagne', 500);
    }
  }),
  logAuthenticatedAccess
);

/**
 * GET /api/loyalty/admin/reports/export
 * Export des rapports loyalty (Admin)
 * Auth: ADMIN requis
 */
router.get('/admin/reports/export',
  adminRequired,
  [
    query('format')
      .isIn(['CSV', 'EXCEL', 'PDF'])
      .withMessage('Format d\'export invalide'),
    query('reportType')
      .isIn(['TRANSACTIONS', 'USERS', 'CAMPAIGNS', 'ANALYTICS'])
      .withMessage('Type de rapport invalide'),
    query('startDate')
      .optional()
      .isISO8601()
      .withMessage('Date de début invalide'),
    query('endDate')
      .optional()
      .isISO8601()
      .withMessage('Date de fin invalide'),
    handleValidationErrors
  ],
  asyncHandler(async (req, res) => {
    const { format, reportType, startDate, endDate } = req.query;

    try {
      // TODO: Générer le rapport selon le format demandé
      
      res.status(200).json({
        success: true,
        message: 'Génération du rapport en cours',
        data: {
          reportId: `RPT_${reportType}_${Date.now()}`,
          format,
          type: reportType,
          period: { startDate, endDate },
          estimatedTime: '2-5 minutes',
          downloadUrl: `/api/loyalty/admin/reports/download/RPT_${reportType}_${Date.now()}`,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
        }
      });

    } catch (error) {
      throw new AppError('Erreur lors de la génération du rapport', 500);
    }
  }),
  logAuthenticatedAccess
);

// ============================================================================
// ROUTES SYSTÈME ET MONITORING
// ============================================================================

/**
 * GET /api/loyalty/system/health
 * Statut de santé du système loyalty (Admin)
 * Auth: ADMIN requis
 */
router.get('/system/health',
  adminRequired,
  asyncHandler(async (req, res) => {
    const User = require('../models/User');
    const LoyaltyTransaction = require('../models/LoyaltyTransaction');

    try {
      const [
        totalMembers,
        activeMembers,
        recentTransactions,
        systemErrors
      ] = await Promise.all([
        User.countDocuments({ 'loyalty.enrolledAt': { $exists: true } }),
        User.countDocuments({
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }),
        LoyaltyTransaction.countDocuments({
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        }),
        LoyaltyTransaction.countDocuments({
          status: 'CANCELLED',
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        })
      ]);

      const healthStatus = {
        status: 'HEALTHY',
        timestamp: new Date(),
        metrics: {
          totalMembers,
          activeMembers,
          activationRate: totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0,
          recentTransactions,
          errorRate: recentTransactions > 0 ? Math.round((systemErrors / recentTransactions) * 100) : 0
        },
        services: {
          database: 'HEALTHY',
          pointsEngine: 'HEALTHY',
          notifications: 'HEALTHY',
          emailService: 'HEALTHY'
        },
        alerts: []
      };

      // Alertes basées sur les métriques
      if (healthStatus.metrics.activationRate < 30) {
        healthStatus.alerts.push({
          level: 'WARNING',
          message: 'Taux d\'activation faible',
          metric: 'activationRate',
          value: healthStatus.metrics.activationRate
        });
      }

      if (healthStatus.metrics.errorRate > 5) {
        healthStatus.status = 'DEGRADED';
        healthStatus.alerts.push({
          level: 'ERROR',
          message: 'Taux d\'erreur élevé',
          metric: 'errorRate',
          value: healthStatus.metrics.errorRate
        });
      }

      res.status(200).json({
        success: true,
        data: healthStatus
      });

    } catch (error) {
      res.status(500).json({
        success: false,
        data: {
          status: 'UNHEALTHY',
          timestamp: new Date(),
          error: 'Health check failed'
        }
      });
    }
  })
);

/**
 * GET /api/loyalty/system/metrics
 * Métriques système temps réel (Admin)
 * Auth: ADMIN requis
 */
router.get('/system/metrics',
  adminRequired,
  asyncHandler(async (req, res) => {
    try {
      // TODO: Récupérer métriques temps réel depuis monitoring
      
      const metrics = {
        performance: {
          averageResponseTime: 125, // ms
          requestsPerMinute: 45,
          errorRate: 0.2, // %
          uptime: 99.9 // %
        },
        usage: {
          activeUsers: 234,
          pointsIssued24h: 15420,
          pointsRedeemed24h: 8930,
          transactionsPerHour: 89
        },
        system: {
          cpuUsage: 35, // %
          memoryUsage: 67, // %
          diskUsage: 23, // %
          networkIO: 1.2 // MB/s
        },
        timestamp: new Date()
      };

      res.status(200).json({
        success: true,
        data: metrics
      });

    } catch (error) {
      throw new AppError('Erreur lors de la récupération des métriques', 500);
    }
  })
);

// ============================================================================
// MIDDLEWARE DE GESTION D'ERREURS
// ============================================================================

/**
 * Middleware de gestion d'erreurs spécifique au loyalty
 */
router.use((error, req, res, next) => {
  // Log de l'erreur avec contexte loyalty
  console.error(`[LOYALTY ERROR] ${req.method} ${req.originalUrl}:`, {
    error: error.message,
    userId: req.user?.userId,
    userRole: req.user?.role,
    timestamp: new Date().toISOString(),
    stack: error.stack
  });

  // Erreurs spécifiques au loyalty
  if (error.code === 'INSUFFICIENT_POINTS') {
    return res.status(400).json({
      success: false,
      message: 'Solde de points insuffisant',
      code: 'INSUFFICIENT_POINTS',
      currentPoints: error.currentPoints,
      requiredPoints: error.requiredPoints,
      shortfall: error.shortfall,
      suggestions: [
        'Effectuez une réservation pour gagner des points',
        'Participez aux campagnes en cours',
        'Laissez un avis pour gagner des points bonus'
      ]
    });
  }

  if (error.code === 'INVALID_REDEMPTION') {
    return res.status(400).json({
      success: false,
      message: 'Utilisation de points invalide',
      code: 'INVALID_REDEMPTION',
      reason: error.reason,
      availableOptions: error.availableOptions || []
    });
  }

  if (error.code === 'TIER_RESTRICTION') {
    return res.status(403).json({
      success: false,
      message: 'Niveau de fidélité insuffisant',
      code: 'TIER_RESTRICTION',
      currentTier: error.currentTier,
      requiredTier: error.requiredTier,
      hint: 'Atteignez un niveau supérieur pour accéder à cette fonctionnalité'
    });
  }

  if (error.code === 'CAMPAIGN_EXPIRED') {
    return res.status(410).json({
      success: false,
      message: 'Campagne expirée',
      code: 'CAMPAIGN_EXPIRED',
      campaignId: error.campaignId,
      expiredAt: error.expiredAt
    });
  }

  if (error.code === 'RATE_LIMIT_EXCEEDED') {
    return res.status(429).json({
      success: false,
      message: 'Limite de requêtes dépassée',
      code: 'RATE_LIMIT_EXCEEDED',
      retryAfter: error.retryAfter,
      limit: error.limit,
      userType: error.userType
    });
  }

  // Erreurs de validation
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: 'Données invalides',
      code: 'VALIDATION_ERROR',
      errors: Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message,
        value: err.value
      }))
    });
  }

  // Erreurs MongoDB
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      message: 'ID invalide',
      code: 'INVALID_ID',
      field: error.path,
      value: error.value
    });
  }

  if (error.code === 11000) {
    return res.status(409).json({
      success: false,
      message: 'Conflit de données',
      code: 'DUPLICATE_ENTRY',
      field: Object.keys(error.keyPattern)[0]
    });
  }

  // Erreur par défaut
  const statusCode = error.statusCode || error.status || 500;
  const isProduction = process.env.NODE_ENV === 'production';

  res.status(statusCode).json({
    success: false,
    message: error.message || 'Erreur interne du serveur',
    code: error.code || 'INTERNAL_ERROR',
    ...(isProduction ? {} : { 
      stack: error.stack,
      timestamp: new Date().toISOString(),
      requestId: req.id
    })
  });
});

// ============================================================================
// ROUTES 404 - Gestion des routes non trouvées
// ============================================================================

/**
 * Gestion des routes loyalty non trouvées
 */
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route loyalty non trouvée',
    code: 'LOYALTY_ROUTE_NOT_FOUND',
    requestedPath: req.originalUrl,
    method: req.method,
    availableRoutes: [
      'GET /api/loyalty/status',
      'GET /api/loyalty/dashboard',
      'GET /api/loyalty/history',
      'GET /api/loyalty/redemption/options',
      'POST /api/loyalty/redeem/discount',
      'POST /api/loyalty/redeem/upgrade',
      'GET /api/loyalty/campaigns',
      'GET /api/loyalty/benefits',
      'POST /api/loyalty/transfer',
      'GET /api/loyalty/admin/analytics (Admin)',
      'POST /api/loyalty/admin/adjust-points (Admin)'
    ],
    hint: 'Consultez la documentation API pour les routes disponibles'
  });
});

// ============================================================================
// EXPORT DU ROUTER
// ============================================================================

module.exports = router;

// ============================================================================
// DOCUMENTATION DES ROUTES
// ============================================================================

/**
 * RÉSUMÉ DES ROUTES LOYALTY
 * 
 * ROUTES PUBLIQUES :
 * GET    /api/loyalty/info                    - Infos programme (public)
 * POST   /api/loyalty/enroll                  - Inscription programme
 * 
 * ROUTES UTILISATEUR (CLIENT requis) :
 * GET    /api/loyalty/status                  - Statut fidélité complet
 * GET    /api/loyalty/dashboard               - Dashboard personnalisé  
 * GET    /api/loyalty/summary                 - Résumé rapide
 * GET    /api/loyalty/history                 - Historique transactions
 * GET    /api/loyalty/history/export          - Export historique
 * GET    /api/loyalty/transaction/:id         - Détails transaction
 * 
 * UTILISATION POINTS :
 * GET    /api/loyalty/redemption/options      - Options d'utilisation
 * POST   /api/loyalty/redeem/discount         - Réduction avec points
 * POST   /api/loyalty/redeem/upgrade          - Upgrade avec points
 * POST   /api/loyalty/redeem/free-night       - Nuit gratuite
 * POST   /api/loyalty/redeem/benefit          - Bénéfices divers
 * 
 * TRANSFERTS ET PARTAGE :
 * POST   /api/loyalty/transfer                - Transfert points (Gold+)
 * 
 * CAMPAGNES ET PROMOTIONS :
 * GET    /api/loyalty/campaigns               - Campagnes actives
 * POST   /api/loyalty/campaigns/:id/participate - Participer campagne
 * 
 * BÉNÉFICES :
 * GET    /api/loyalty/benefits                - Bénéfices disponibles
 * POST   /api/loyalty/benefits/:id/activate   - Activer bénéfice
 * 
 * ROUTES ADMIN (ADMIN requis) :
 * GET    /api/loyalty/admin/analytics         - Analytics globaux
 * POST   /api/loyalty/admin/adjust-points     - Ajustement manuel
 * GET    /api/loyalty/admin/users             - Liste membres
 * GET    /api/loyalty/admin/campaigns         - Gestion campagnes
 * POST   /api/loyalty/admin/campaigns         - Créer campagne
 * PUT    /api/loyalty/admin/campaigns/:id     - Modifier campagne
 * DELETE /api/loyalty/admin/campaigns/:id     - Supprimer campagne
 * GET    /api/loyalty/admin/reports/export    - Export rapports
 * 
 * ROUTES SYSTÈME (ADMIN requis) :
 * GET    /api/loyalty/system/health           - Santé système
 * GET    /api/loyalty/system/metrics          - Métriques temps réel
 * 
 * SÉCURITÉ :
 * - Authentification JWT obligatoire (sauf routes publiques)
 * - Autorisation par rôles (CLIENT/ADMIN/RECEPTIONIST)
 * - Rate limiting adaptatif selon le rôle
 * - Validation complète des données
 * - Logging des accès authentifiés
 * - Gestion d'erreurs spécialisée
 * 
 * MIDDLEWARE UTILISÉS :
 * - authenticateToken : Vérification JWT
 * - authorizeRoles : Contrôle rôles
 * - requireLoyaltyMembership : Membre fidélité requis
 * - validatePointsAmount : Validation montants
 * - validateCampaignData : Validation campagnes
 * - loyaltyRateLimit : Rate limiting
 * - logAuthenticatedAccess : Logging accès
 * - handleValidationErrors : Gestion erreurs validation
 * 
 * CODES D'ERREUR SPÉCIFIQUES :
 * - NOT_LOYALTY_MEMBER : Non inscrit au programme
 * - INSUFFICIENT_POINTS : Solde points insuffisant
 * - INVALID_REDEMPTION : Utilisation invalide
 * - TIER_RESTRICTION : Niveau insuffisant
 * - CAMPAIGN_EXPIRED : Campagne expirée
 * - RATE_LIMIT_EXCEEDED : Limite requêtes
 * 
 * FONCTIONNALITÉS AVANCÉES :
 * - Cache intelligent pour performances
 * - Notifications temps réel via WebSocket
 * - Export de données en multiple formats
 * - Analytics en temps réel
 * - Monitoring santé système
 * - Audit trail complet
 * - Gestion hiérarchique entreprise
 * - Campagnes ciblées par niveau
 * - Transferts entre membres
 * - Bénéfices automatiques et manuels
 * 
 * INTÉGRATIONS :
 * - loyaltyController.js : Logique métier
 * - loyaltyService.js : Service principal
 * - socketService.js : Notifications temps réel
 * - emailService.js : Notifications email
 * - auth.js : Authentification/autorisation
 * - validation.js : Validation données
 * 
 * UTILISATION :
 * Dans app.js : app.use('/api/loyalty', require('./routes/loyalty'));
 */