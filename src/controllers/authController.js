const User = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const jwtUtils = require('../utils/jwt');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

// Services intégrés
const socketService = require('../services/socketService');
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
const { getLoyaltyService } = require('../services/loyaltyService');

// Utilitaires
const { logger } = require('../utils/logger');

/**
 * Inscription d'un nouvel utilisateur avec intégration loyalty automatique
 * POST /api/auth/register
 */
const register = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    return await session.withTransaction(async () => {
      const {
        firstName,
        lastName,
        email,
        password,
        phone,
        role = 'CLIENT',
        companyName,
        siret,
        preferences,
        // Nouveaux paramètres loyalty
        acceptLoyaltyProgram = true,
        communicationPreferences = {
          email: true,
          sms: false,
          push: true
        }
      } = req.body;

      // ============================================================================
      // 1. VALIDATIONS EXISTANTES
      // ============================================================================
      
      if (!firstName || !lastName || !email || !password || !phone) {
        return res.status(400).json({
          success: false,
          message: 'Tous les champs obligatoires doivent être renseignés',
          required: ['firstName', 'lastName', 'email', 'password', 'phone']
        });
      }

      // Vérifier si l'utilisateur existe déjà
      const existingUser = await User.findOne({ email: email.toLowerCase() }).session(session);
      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Un compte existe déjà avec cette adresse email',
          field: 'email'
        });
      }

      // Validation du mot de passe
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Le mot de passe doit contenir au moins 6 caractères',
          field: 'password'
        });
      }

      // Validation du rôle selon les permissions
      const allowedRoles = ['CLIENT'];
      if (req.user && req.user.role === 'ADMIN') {
        allowedRoles.push('RECEPTIONIST', 'ADMIN');
      }
      
      if (!allowedRoles.includes(role)) {
        return res.status(403).json({
          success: false,
          message: 'Vous n\'avez pas les permissions pour créer ce type de compte',
          allowedRoles
        });
      }

      // ============================================================================
      // 2. CONFIGURATION LOYALTY PROGRAM
      // ============================================================================
      
      const loyaltyService = getLoyaltyService();
      const WELCOME_BONUS_POINTS = 100;
      const currentDate = new Date();
      
      // Initialiser les données loyalty pour tous les clients
      const loyaltyData = role === 'CLIENT' && acceptLoyaltyProgram ? {
        // Points et progression
        currentPoints: WELCOME_BONUS_POINTS,
        lifetimePoints: WELCOME_BONUS_POINTS,
        tier: 'BRONZE',
        enrolledAt: currentDate,
        
        // Progression vers niveau suivant
        tierProgress: {
          pointsToNextTier: 900, // 1000 (SILVER) - 100 (current)
          nextTier: 'SILVER',
          progressPercentage: 10 // 100/1000 * 100
        },
        
        // Préférences utilisateur
        preferences: {
          language: preferences?.language || 'fr',
          timezone: preferences?.timezone || 'Europe/Paris',
          currency: preferences?.currency || 'EUR',
          notifications: {
            email: communicationPreferences.email,
            sms: communicationPreferences.sms,
            inApp: communicationPreferences.push
          },
          dashboard: {
            defaultView: 'bookings',
            showTutorial: true
          },
          // Préférences loyalty spécifiques
          communicationPreferences: {
            email: communicationPreferences.email,
            sms: communicationPreferences.sms,
            push: communicationPreferences.push,
            newsletter: true,
            promotions: true,
            tierUpdates: true
          }
        },
        
        // Statistiques initiales
        statistics: {
          totalBookingsWithPoints: 0,
          totalPointsEarned: WELCOME_BONUS_POINTS,
          totalPointsRedeemed: 0,
          totalSpentWithProgram: 0,
          favoriteHotelChain: null,
          averageBookingValueWithPoints: 0,
          lastActivity: currentDate,
          joinDate: currentDate
        },
        
        // Performance metrics
        performance: {
          pointsVelocity: 0, // Points par mois
          redemptionRate: 0, // Taux d'utilisation des points
          engagementScore: 50, // Score d'engagement initial
          lastCalculated: currentDate
        },
        
        // Bénéfices actifs (Bronze level)
        activeBenefits: [
          {
            type: 'BONUS_POINTS',
            value: 10,
            description: 'Points sur réservations',
            validUntil: new Date(currentDate.getFullYear() + 1, 11, 31), // Fin d'année suivante
            usageCount: 0,
            maxUsage: 999,
            isActive: true,
            autoRenew: true
          }
        ],
        
        // Historique des niveaux
        tierHistory: [
          {
            tier: 'BRONZE',
            achievedAt: currentDate,
            pointsAtAchievement: WELCOME_BONUS_POINTS,
            celebrationSent: false
          }
        ],
        
        // Statut spécial initial
        specialStatus: {
          isVIP: false,
          vipSince: null,
          isInfluencer: false,
          specialOffers: []
        }
      } : null;

      // ============================================================================
      // 3. CRÉATION UTILISATEUR AVEC LOYALTY
      // ============================================================================
      
      const userData = {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        password,
        phone: phone.trim(),
        role,
        preferences: preferences || {},
        // Intégrer les données loyalty si applicable
        ...(loyaltyData && { loyalty: loyaltyData })
      };

      // Ajouter les informations d'entreprise si présentes
      if (companyName) {
        userData.companyName = companyName.trim();
      }
      if (siret) {
        userData.siret = siret.trim();
      }

      // Ajouter qui a créé ce compte
      if (req.user) {
        userData.createdBy = req.user.userId;
      }

      const user = new User(userData);

      // Générer le token de vérification email
      const emailVerificationToken = user.createEmailVerificationToken();
      
      // Sauvegarder l'utilisateur
      await user.save({ session });

      // ============================================================================
      // 4. CRÉATION TRANSACTION LOYALTY BIENVENUE
      // ============================================================================
      
      let loyaltyTransaction = null;
      if (loyaltyData) {
        loyaltyTransaction = new LoyaltyTransaction({
          user: user._id,
          type: 'EARN_WELCOME',
          pointsAmount: WELCOME_BONUS_POINTS,
          previousBalance: 0,
          newBalance: WELCOME_BONUS_POINTS,
          description: `Bonus de bienvenue au programme de fidélité`,
          earnedFrom: {
            bonusMultiplier: 1,
            tierAtEarning: 'BRONZE',
            bonusDetails: 'Inscription au programme de fidélité'
          },
          source: 'SYSTEM',
          processedBy: req.user?.userId || null,
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          expiresAt: new Date(currentDate.getTime() + (24 * 30 * 24 * 60 * 60 * 1000)) // 24 mois
        });

        await loyaltyTransaction.save({ session });
        
        logger.info(`Loyalty welcome transaction created for user ${user._id}: ${WELCOME_BONUS_POINTS} points`);
      }

      // ============================================================================
      // 5. GÉNÉRATION TOKENS JWT
      // ============================================================================
      
      const tokenPair = jwtUtils.generateTokenPair(user);

      // ============================================================================
      // 6. NOTIFICATIONS ET COMMUNICATIONS
      // ============================================================================
      
      // Préparation de la réponse utilisateur
      const userResponse = {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        email: user.email,
        phone: user.phone,
        role: user.role,
        clientType: user.clientType,
        companyName: user.companyName,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        // Inclure informations loyalty si applicable
        ...(loyaltyData && {
          loyalty: {
            enrolled: true,
            tier: 'BRONZE',
            tierDisplay: 'Bronze',
            currentPoints: WELCOME_BONUS_POINTS,
            welcomeBonus: WELCOME_BONUS_POINTS
          }
        })
      };

      // ============================================================================
      // 7. NOTIFICATIONS TEMPS RÉEL
      // ============================================================================
      
      if (loyaltyData) {
        // Notification temps réel d'inscription au programme
        setTimeout(() => {
          socketService.sendUserNotification(user._id, 'LOYALTY_ENROLLED', {
            welcomeBonus: WELCOME_BONUS_POINTS,
            tier: 'BRONZE',
            tierDisplay: 'Bronze',
            enrolledAt: currentDate,
            message: `Félicitations ! Vous êtes maintenant membre de notre programme de fidélité !`,
            nextMilestone: {
              tier: 'SILVER',
              pointsNeeded: 900,
              benefits: ['20% bonus points', 'Check-in prioritaire', '1 upgrade/an']
            }
          });
        }, 1000);

        // Notification de points de bienvenue
        setTimeout(() => {
          socketService.sendUserNotification(user._id, 'WELCOME_POINTS_EARNED', {
            pointsEarned: WELCOME_BONUS_POINTS,
            totalPoints: WELCOME_BONUS_POINTS,
            transactionId: loyaltyTransaction._id,
            message: `${WELCOME_BONUS_POINTS} points de bienvenue crédités !`,
            estimatedValue: Math.round((WELCOME_BONUS_POINTS / 100) * 100) / 100,
            firstRedemptionSuggestion: {
              type: 'DISCOUNT',
              message: 'Utilisez vos points pour obtenir 1€ de réduction sur votre première réservation'
            }
          });
        }, 2000);
      }

      // ============================================================================
      // 8. ENVOI EMAILS
      // ============================================================================
      
      try {
        // Email de vérification (existant)
        console.log(`Email de vérification pour ${user.email}: /api/auth/verify-email/${emailVerificationToken}`);
        
        if (loyaltyData) {
          // Email de bienvenue au programme de fidélité
          await emailService.sendEmail({
            to: user.email,
            template: 'loyalty-welcome',
            data: {
              user: {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email
              },
              loyalty: {
                welcomeBonus: WELCOME_BONUS_POINTS,
                tier: 'BRONZE',
                tierDisplay: 'Bronze',
                enrolledAt: currentDate,
                benefits: [
                  'Points sur toutes vos réservations',
                  'Offres exclusives membres',
                  'Progression vers niveaux supérieurs',
                  'Réductions et upgrades gratuits'
                ],
                nextMilestone: {
                  tier: 'SILVER',
                  pointsNeeded: 900,
                  benefits: ['20% bonus points', 'Check-in prioritaire', '1 upgrade/an']
                },
                quickStart: {
                  pointsValue: '1€',
                  firstRedemption: 'Utilisez 100 points = 1€ de réduction',
                  howToEarn: 'Gagnez 1 point par euro dépensé'
                }
              },
              verificationLink: `/api/auth/verify-email/${emailVerificationToken}`,
              dashboardLink: '/loyalty/dashboard',
              supportEmail: process.env.SUPPORT_EMAIL || 'support@hotel.com'
            }
          });

          logger.info(`Loyalty welcome email sent to ${user.email}`);
        }
      } catch (emailError) {
        logger.error('Erreur envoi email bienvenue loyalty:', emailError);
        // Ne pas faire échouer l'inscription pour un problème d'email
      }

      // ============================================================================
      // 9. ENVOI SMS (SI ACTIVÉ)
      // ============================================================================
      
      if (loyaltyData && communicationPreferences.sms && user.phone) {
        try {
          const smsMessage = `🎉 Bienvenue dans notre programme de fidélité ! ${WELCOME_BONUS_POINTS} points offerts = 1€ de réduction. Commencez à économiser dès maintenant !`;
          
          await smsService.sendSMS(user.phone, smsMessage);
          
          logger.info(`Loyalty welcome SMS sent to ${user.phone}`);
        } catch (smsError) {
          logger.error('Erreur envoi SMS bienvenue loyalty:', smsError);
          // Ne pas faire échouer l'inscription pour un problème de SMS
        }
      }

      // ============================================================================
      // 10. LOGGING ET AUDIT
      // ============================================================================
      
      logger.info(`New user registered: ${user.email} (${user.role})`, {
        userId: user._id,
        email: user.email,
        role: user.role,
        loyaltyEnrolled: !!loyaltyData,
        welcomeBonus: loyaltyData ? WELCOME_BONUS_POINTS : 0,
        source: req.get('User-Agent')?.includes('Mobile') ? 'MOBILE' : 'WEB',
        ipAddress: req.ip,
        timestamp: currentDate
      });

      if (loyaltyData) {
        logger.info(`Loyalty program enrollment: ${user.email}`, {
          userId: user._id,
          tier: 'BRONZE',
          welcomeBonus: WELCOME_BONUS_POINTS,
          transactionId: loyaltyTransaction._id,
          enrolledAt: currentDate
        });
      }

      // ============================================================================
      // 11. RÉPONSE FINALE ENRICHIE
      // ============================================================================
      
      const response = {
        success: true,
        message: loyaltyData ? 
          'Compte créé avec succès ! Bienvenue dans notre programme de fidélité !' :
          'Compte créé avec succès',
        user: userResponse,
        ...tokenPair,
        emailVerification: {
          required: true,
          message: 'Un email de vérification a été envoyé'
        }
      };

      // Ajouter informations loyalty à la réponse si applicable
      if (loyaltyData) {
        response.loyalty = {
          enrolled: true,
          tier: 'BRONZE',
          tierDisplay: 'Bronze',
          welcomeBonus: WELCOME_BONUS_POINTS,
          currentPoints: WELCOME_BONUS_POINTS,
          nextMilestone: {
            tier: 'SILVER',
            pointsNeeded: 900,
            progressPercentage: 10
          },
          quickStart: {
            firstRedemption: `Utilisez ${WELCOME_BONUS_POINTS} points pour 1€ de réduction`,
            howToEarn: 'Gagnez 1 point par euro dépensé sur vos réservations',
            benefits: ['Points sur réservations', 'Offres exclusives', 'Réductions et upgrades']
          },
          transactionId: loyaltyTransaction._id,
          dashboardUrl: '/loyalty/dashboard'
        };
      }

      res.status(201).json(response);

    }); // Fin transaction
  } catch (error) {
    logger.error('Erreur inscription avec loyalty:', error);

    // Gestion des erreurs de validation Mongoose
    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => ({
        field: err.path,
        message: err.message
      }));

      return res.status(400).json({
        success: false,
        message: 'Erreur de validation des données',
        errors: validationErrors
      });
    }

    // Erreur de duplication (index unique)
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `Cette ${field === 'email' ? 'adresse email' : field} est déjà utilisée`,
        field
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur lors de l\'inscription'
    });
  } finally {
    await session.endSession();
  }
};

/**
 * Connexion utilisateur avec enrichissement loyalty
 * POST /api/auth/login
 */
const login = async (req, res) => {
  try {
    const { email, password, rememberMe = false } = req.body;

    // 1. Vérification des champs obligatoires
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email et mot de passe sont requis',
        required: ['email', 'password']
      });
    }

    // 2. Rechercher l'utilisateur avec le mot de passe
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides',
        field: 'email'
      });
    }

    // 3. Vérifier si le compte est verrouillé
    if (user.isLocked) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(423).json({
        success: false,
        message: `Compte temporairement verrouillé suite à trop de tentatives échouées`,
        lockTimeRemaining: `${lockTimeRemaining} minutes`,
        unlockAt: user.lockUntil
      });
    }

    // 4. Vérifier si le compte est actif
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Compte désactivé. Contactez l\'administrateur.',
        reason: 'ACCOUNT_DISABLED'
      });
    }

    // 5. Vérifier le mot de passe
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Incrémenter les tentatives échouées
      await user.incLoginAttempts();
      
      return res.status(401).json({
        success: false,
        message: 'Identifiants invalides',
        field: 'password'
      });
    }

    // 6. Reset des tentatives de connexion échouées
    if (user.loginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // 7. Mettre à jour la dernière connexion ET l'activité loyalty
    await user.updateLastLogin();
    
    // Mettre à jour l'activité loyalty si membre
    if (user.loyalty?.enrolledAt) {
      user.loyalty.statistics.lastActivity = new Date();
      await user.save({ validateBeforeSave: false });
    }

    // 8. Générer les tokens JWT
    const tokenOptions = {};
    if (rememberMe) {
      tokenOptions.expiresIn = '30d'; // Token plus long pour "Se souvenir de moi"
    }

    const tokenPair = jwtUtils.generateTokenPair(user);

    // 9. Préparer la réponse utilisateur avec informations loyalty
    const userResponse = {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      role: user.role,
      clientType: user.clientType,
      companyName: user.companyName,
      isEmailVerified: user.isEmailVerified,
      lastLogin: user.lastLogin,
      preferences: user.preferences
    };

    // Ajouter informations loyalty si membre
    if (user.loyalty?.enrolledAt) {
      userResponse.loyalty = {
        enrolled: true,
        tier: user.loyalty.tier,
        tierDisplay: getLoyaltyService().getTierDisplayName(user.loyalty.tier),
        currentPoints: user.loyalty.currentPoints,
        lifetimePoints: user.loyalty.lifetimePoints,
        tierProgress: user.loyalty.tierProgress,
        memberSince: user.loyalty.enrolledAt,
        lastActivity: user.loyalty.statistics.lastActivity
      };
    }

    // 10. Notifications temps réel de connexion
    if (user.loyalty?.enrolledAt) {
      setTimeout(() => {
        socketService.sendUserNotification(user._id, 'LOYALTY_LOGIN', {
          tier: user.loyalty.tier,
          currentPoints: user.loyalty.currentPoints,
          lastActivity: user.loyalty.statistics.lastActivity,
          message: `Bon retour, membre ${user.loyalty.tier} !`
        });
      }, 1000);
    }

    // 11. Logging enrichi
    logger.info(`User login: ${user.email}`, {
      userId: user._id,
      role: user.role,
      loyaltyMember: !!user.loyalty?.enrolledAt,
      loyaltyTier: user.loyalty?.tier,
      rememberMe,
      source: req.get('User-Agent')?.includes('Mobile') ? 'MOBILE' : 'WEB',
      ipAddress: req.ip
    });

    // 12. Réponse succès enrichie
    const response = {
      success: true,
      message: user.loyalty?.enrolledAt ? 
        `Bon retour, membre ${user.loyalty.tier} !` : 
        'Connexion réussie',
      user: userResponse,
      ...tokenPair,
      rememberMe,
      loginTime: new Date()
    };

    res.json(response);

  } catch (error) {
    logger.error('Erreur connexion:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur lors de la connexion'
    });
  }
};

/**
 * Obtenir les informations du profil utilisateur connecté avec loyalty
 * GET /api/auth/me
 */
const getProfile = async (req, res) => {
  try {
    // L'utilisateur est déjà récupéré par le middleware auth
    const user = req.user;

    // Récupérer les données complètes depuis la DB
    const fullUser = await User.findById(user.userId)
      .select('-password')
      .populate('createdBy', 'firstName lastName fullName');

    if (!fullUser) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    // Préparer la réponse de base
    const userProfile = {
      id: fullUser._id,
      firstName: fullUser.firstName,
      lastName: fullUser.lastName,
      fullName: fullUser.fullName,
      email: fullUser.email,
      phone: fullUser.phone,
      role: fullUser.role,
      clientType: fullUser.clientType,
      companyName: fullUser.companyName,
      siret: fullUser.siret,
      isEmailVerified: fullUser.isEmailVerified,
      isActive: fullUser.isActive,
      lastLogin: fullUser.lastLogin,
      preferences: fullUser.preferences,
      createdAt: fullUser.createdAt,
      createdBy: fullUser.createdBy
    };

    // Enrichir avec informations loyalty si membre
    if (fullUser.loyalty?.enrolledAt) {
      // Calculer métriques loyalty temps réel
      const loyaltyService = getLoyaltyService();
      
      // Points qui expirent bientôt
      const expiringPoints = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: fullUser._id,
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

      // Dernière transaction
      const lastTransaction = await LoyaltyTransaction.findOne({ user: fullUser._id })
        .sort({ createdAt: -1 })
        .select('type pointsAmount createdAt description')
        .lean();

      userProfile.loyalty = {
        enrolled: true,
        tier: fullUser.loyalty.tier,
        tierDisplay: loyaltyService.getTierDisplayName(fullUser.loyalty.tier),
        tierIcon: loyaltyService.getTierIcon(fullUser.loyalty.tier),
        currentPoints: fullUser.loyalty.currentPoints,
        lifetimePoints: fullUser.loyalty.lifetimePoints,
        tierProgress: fullUser.loyalty.tierProgress,
        memberSince: fullUser.loyalty.enrolledAt,
        preferences: fullUser.loyalty.preferences,
        statistics: fullUser.loyalty.statistics,
        performance: fullUser.loyalty.performance,
        
        // Métriques temps réel
        realtime: {
          pointsValue: Math.round((fullUser.loyalty.currentPoints / 100) * 100) / 100,
          expiringPoints: expiringPoints[0]?.totalExpiring || 0,
          nextExpiry: expiringPoints[0]?.nextExpiry,
          lastTransaction,
          activeBenefitsCount: fullUser.loyalty.activeBenefits?.filter(b => 
            b.isActive && b.validUntil > new Date()
          ).length || 0
        },
        
        // Actions rapides disponibles
        quickActions: getQuickActions(fullUser.loyalty),
        
        // Bénéfices actifs
        activeBenefits: fullUser.loyalty.activeBenefits?.filter(b => 
          b.isActive && b.validUntil > new Date() && b.usageCount < b.maxUsage
        ) || []
      };
    }

    const response = {
      success: true,
      user: userProfile,
      meta: {
        lastUpdated: new Date(),
        loyaltyEnabled: !!fullUser.loyalty?.enrolledAt
      }
    };

    res.json(response);

  } catch (error) {
    logger.error('Erreur récupération profil:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    });
  }
};

/**
 * Helper function pour obtenir actions rapides loyalty
 */
function getQuickActions(loyalty) {
  const actions = [];

  if (loyalty.currentPoints >= 100) {
    actions.push({
      type: 'redeem',
      title: 'Utiliser points',
      description: `${loyalty.currentPoints} points disponibles`,
      icon: '💰',
      url: '/loyalty/redeem',
      priority: 'high'
    });
  }

  if (loyalty.tierProgress?.progressPercentage >= 80) {
    actions.push({
      type: 'progress',
      title: 'Niveau supérieur',
      description: `Plus que ${loyalty.tierProgress.pointsToNextTier} points`,
      icon: '🏆',
      url: '/loyalty/progress',
      priority: 'medium'
    });
  }

  actions.push({
    type: 'history',
    title: 'Historique',
    description: 'Voir vos transactions',
    icon: '📊',
    url: '/loyalty/history',
    priority: 'low'
  });

  return actions;
}

// ============================================================================
// EXPORTS (méthodes inchangées + nouvelles fonctionnalités)
// ============================================================================

module.exports = {
  register,
  login,
  logout: async (req, res) => {
    try {
      // Récupérer les tokens depuis les headers ou body
      const accessToken = jwtUtils.extractTokenFromHeader(req.headers.authorization);
      const { refreshToken } = req.body;

      // Blacklister les tokens
      if (accessToken) {
        jwtUtils.blacklistToken(accessToken);
      }
      
      if (refreshToken) {
        jwtUtils.blacklistToken(refreshToken);
      }

      res.json({
        success: true,
        message: 'Déconnexion réussie',
        logoutTime: new Date()
      });

    } catch (error) {
      console.error('Erreur déconnexion:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la déconnexion'
      });
    }
  },
  refreshToken: async (req, res) => {
    try {
      const { refreshToken } = req.body;

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          message: 'Refresh token requis',
          required: ['refreshToken']
        });
      }

      // Fonction pour récupérer l'utilisateur par ID
      const getUserById = async (userId) => {
        return await User.findById(userId);
      };

      // Renouveler le token
      const newTokenData = await jwtUtils.refreshAccessToken(refreshToken, getUserById);

      res.json({
        success: true,
        message: 'Token renouvelé avec succès',
        ...newTokenData,
        renewedAt: new Date()
      });

    } catch (error) {
      console.error('Erreur renouvellement token:', error);

      if (error.message.includes('expiré') || error.message.includes('invalide')) {
        return res.status(401).json({
          success: false,
          message: error.message,
          code: 'TOKEN_REFRESH_FAILED'
        });
      }

      res.status(500).json({
        success: false,
        message: 'Erreur lors du renouvellement du token'
      });
    }
  },
  getProfile,
  forgotPassword: async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Adresse email requise',
          required: ['email']
        });
      }

      // Rechercher l'utilisateur
      const user = await User.findOne({ 
        email: email.toLowerCase(), 
        isActive: true 
      });

      // Toujours renvoyer un succès pour éviter l'énumération d'emails
      const successResponse = {
        success: true,
        message: 'Si cette adresse email existe, vous recevrez un lien de réinitialisation',
        email: email.toLowerCase()
      };

      if (!user) {
        return res.json(successResponse);
      }

      // Générer le token de reset
      const resetToken = user.createPasswordResetToken();
      await user.save({ validateBeforeSave: false });

      // Envoyer l'email de reset (simulation)
      // TODO: Intégrer service d'email
      console.log(`Reset password pour ${user.email}: /api/auth/reset-password/${resetToken}`);

      res.json({
        ...successResponse,
        resetToken: resetToken, // À supprimer en production
        expiresAt: user.resetPasswordExpires
      });

    } catch (error) {
      console.error('Erreur forgot password:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la demande de réinitialisation'
      });
    }
  },
  resetPassword: async (req, res) => {
    try {
      const { token } = req.params;
      const { password, confirmPassword } = req.body;

      // Validation des données
      if (!password || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Mot de passe et confirmation requis',
          required: ['password', 'confirmPassword']
        });
      }

      if (password !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Les mots de passe ne correspondent pas',
          field: 'confirmPassword'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Le mot de passe doit contenir au moins 6 caractères',
          field: 'password'
        });
      }

      // Hasher le token reçu pour comparaison
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      // Rechercher l'utilisateur avec le token valide
      const user = await User.findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: Date.now() },
        isActive: true
      });

      if (!user) {
        return res.status(400).json({
          success: false,
          message: 'Token de réinitialisation invalide ou expiré',
          code: 'INVALID_RESET_TOKEN'
        });
      }

      // Mettre à jour le mot de passe
      user.password = password;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
      
      // Reset des tentatives de connexion
      user.loginAttempts = undefined;
      user.lockUntil = undefined;

      await user.save();

      // Générer de nouveaux tokens pour connexion automatique
      const tokenPair = jwtUtils.generateTokenPair(user);

      res.json({
        success: true,
        message: 'Mot de passe réinitialisé avec succès',
        user: {
          id: user._id,
          email: user.email,
          fullName: user.fullName
        },
        ...tokenPair
      });

    } catch (error) {
      console.error('Erreur reset password:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la réinitialisation du mot de passe'
      });
    }
  },
  verifyEmail: async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const { token } = req.params;

        // Hasher le token reçu
        const hashedToken = crypto
          .createHash('sha256')
          .update(token)
          .digest('hex');

        // Rechercher l'utilisateur
        const user = await User.findOne({
          emailVerificationToken: hashedToken,
          emailVerificationExpires: { $gt: Date.now() }
        }).session(session);

        if (!user) {
          return res.status(400).json({
            success: false,
            message: 'Token de vérification invalide ou expiré',
            code: 'INVALID_VERIFICATION_TOKEN'
          });
        }

        // Marquer l'email comme vérifié
        user.isEmailVerified = true;
        user.emailVerificationToken = undefined;
        user.emailVerificationExpires = undefined;

        await user.save({ session, validateBeforeSave: false });

        // ============================================================================
        // BONUS VÉRIFICATION EMAIL POUR MEMBRES LOYALTY
        // ============================================================================
        
        let emailVerificationBonus = null;
        if (user.loyalty?.enrolledAt && !user.loyalty.statistics.emailVerified) {
          const EMAIL_VERIFICATION_BONUS = 50;
          
          // Créer transaction bonus vérification email
          emailVerificationBonus = new LoyaltyTransaction({
            user: user._id,
            type: 'EARN_BONUS',
            pointsAmount: EMAIL_VERIFICATION_BONUS,
            previousBalance: user.loyalty.currentPoints,
            newBalance: user.loyalty.currentPoints + EMAIL_VERIFICATION_BONUS,
            description: 'Bonus vérification email',
            earnedFrom: {
              bonusMultiplier: 1,
              tierAtEarning: user.loyalty.tier,
              bonusDetails: 'Vérification adresse email'
            },
            source: 'SYSTEM',
            expiresAt: new Date(Date.now() + (24 * 30 * 24 * 60 * 60 * 1000)) // 24 mois
          });

          await emailVerificationBonus.save({ session });

          // Mettre à jour les points utilisateur
          user.loyalty.currentPoints += EMAIL_VERIFICATION_BONUS;
          user.loyalty.lifetimePoints += EMAIL_VERIFICATION_BONUS;
          user.loyalty.statistics.emailVerified = true;
          user.loyalty.statistics.totalPointsEarned += EMAIL_VERIFICATION_BONUS;
          user.loyalty.statistics.lastActivity = new Date();

          // Recalculer progression niveau
          user.updateTierProgress();
          
          await user.save({ session, validateBeforeSave: false });

          // Notification temps réel bonus email
          setTimeout(() => {
            socketService.sendUserNotification(user._id, 'EMAIL_VERIFICATION_BONUS', {
              bonusPoints: EMAIL_VERIFICATION_BONUS,
              totalPoints: user.loyalty.currentPoints,
              tier: user.loyalty.tier,
              message: `${EMAIL_VERIFICATION_BONUS} points bonus pour la vérification de votre email !`,
              transactionId: emailVerificationBonus._id
            });
          }, 1000);

          logger.info(`Email verification bonus awarded: ${EMAIL_VERIFICATION_BONUS} points to user ${user._id}`);
        }

        // Préparer la réponse
        const response = {
          success: true,
          message: 'Email vérifié avec succès',
          user: {
            id: user._id,
            email: user.email,
            isEmailVerified: true
          },
          verifiedAt: new Date()
        };

        // Ajouter informations bonus si applicable
        if (emailVerificationBonus) {
          response.loyaltyBonus = {
            pointsEarned: emailVerificationBonus.pointsAmount,
            newBalance: user.loyalty.currentPoints,
            transactionId: emailVerificationBonus._id,
            message: `Bonus de ${emailVerificationBonus.pointsAmount} points pour la vérification !`
          };
        }

        res.json(response);
      });

    } catch (error) {
      console.error('Erreur vérification email:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification de l\'email'
      });
    } finally {
      await session.endSession();
    }
  },
  resendVerification: async (req, res) => {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({
          success: false,
          message: 'Adresse email requise',
          required: ['email']
        });
      }

      const user = await User.findOne({ 
        email: email.toLowerCase(),
        isActive: true,
        isEmailVerified: false
      });

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé ou email déjà vérifié'
        });
      }

      // Générer un nouveau token
      const emailVerificationToken = user.createEmailVerificationToken();
      await user.save({ validateBeforeSave: false });

      // Envoyer l'email (simulation)
      console.log(`Nouveau token de vérification pour ${user.email}: /api/auth/verify-email/${emailVerificationToken}`);

      // Si membre loyalty, rappeler le bonus disponible
      const loyaltyReminder = user.loyalty?.enrolledAt && !user.loyalty.statistics?.emailVerified ? {
        loyaltyBonus: {
          available: true,
          points: 50,
          message: 'Vérifiez votre email pour gagner 50 points bonus !'
        }
      } : {};

      res.json({
        success: true,
        message: 'Email de vérification renvoyé',
        email: user.email,
        expiresAt: user.emailVerificationExpires,
        ...loyaltyReminder
      });

    } catch (error) {
      console.error('Erreur renvoi vérification:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors du renvoi de l\'email de vérification'
      });
    }
  },
  changePassword: async (req, res) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      // Validation
      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Tous les champs sont requis',
          required: ['currentPassword', 'newPassword', 'confirmPassword']
        });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({
          success: false,
          message: 'Les nouveaux mots de passe ne correspondent pas',
          field: 'confirmPassword'
        });
      }

      if (newPassword.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Le nouveau mot de passe doit contenir au moins 6 caractères',
          field: 'newPassword'
        });
      }

      // Récupérer l'utilisateur avec le mot de passe
      const user = await User.findById(req.user.userId).select('+password');
      
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }

      // Vérifier le mot de passe actuel
      const isCurrentPasswordValid = await user.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        return res.status(401).json({
          success: false,
          message: 'Mot de passe actuel incorrect',
          field: 'currentPassword'
        });
      }

      // Mettre à jour le mot de passe
      user.password = newPassword;
      
      // Mettre à jour activité loyalty si membre
      if (user.loyalty?.enrolledAt) {
        user.loyalty.statistics.lastActivity = new Date();
      }
      
      await user.save();

      // Log de sécurité
      logger.info(`Password changed for user ${user.email}`, {
        userId: user._id,
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
        loyaltyMember: !!user.loyalty?.enrolledAt
      });

      res.json({
        success: true,
        message: 'Mot de passe modifié avec succès',
        changedAt: new Date()
      });

    } catch (error) {
      console.error('Erreur changement mot de passe:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors du changement de mot de passe'
      });
    }
  },

  // ============================================================================
  // NOUVELLES MÉTHODES LOYALTY-SPÉCIFIQUES
  // ============================================================================

  /**
   * Inscription manuelle au programme de fidélité (pour utilisateurs existants)
   * POST /api/auth/enroll-loyalty
   */
  enrollLoyalty: async (req, res) => {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const userId = req.user.userId;
        const { 
          acceptTerms = true,
          communicationPreferences = { email: true, sms: false, push: true }
        } = req.body;

        if (!acceptTerms) {
          return res.status(400).json({
            success: false,
            message: 'Vous devez accepter les conditions du programme de fidélité',
            required: ['acceptTerms']
          });
        }

        const user = await User.findById(userId).session(session);
        
        if (!user) {
          return res.status(404).json({
            success: false,
            message: 'Utilisateur non trouvé'
          });
        }

        if (user.loyalty?.enrolledAt) {
          return res.status(400).json({
            success: false,
            message: 'Vous êtes déjà inscrit au programme de fidélité',
            enrolledAt: user.loyalty.enrolledAt,
            currentTier: user.loyalty.tier,
            currentPoints: user.loyalty.currentPoints
          });
        }

        // Initialiser le programme de fidélité
        const WELCOME_BONUS = 200;
        const currentDate = new Date();
        
        user.loyalty = {
          currentPoints: WELCOME_BONUS,
          lifetimePoints: WELCOME_BONUS,
          tier: 'BRONZE',
          enrolledAt: currentDate,
          tierProgress: {
            pointsToNextTier: 800, // 1000 - 200
            nextTier: 'SILVER',
            progressPercentage: 20 // 200/1000 * 100
          },
          preferences: {
            language: user.preferences?.language || 'fr',
            timezone: user.preferences?.timezone || 'Europe/Paris',
            currency: user.preferences?.currency || 'EUR',
            notifications: {
              email: communicationPreferences.email,
              sms: communicationPreferences.sms,
              inApp: communicationPreferences.push
            },
            communicationPreferences
          },
          statistics: {
            totalBookingsWithPoints: 0,
            totalPointsEarned: WELCOME_BONUS,
            totalPointsRedeemed: 0,
            joinDate: currentDate,
            lastActivity: currentDate
          },
          performance: {
            pointsVelocity: 0,
            redemptionRate: 0,
            engagementScore: 50,
            lastCalculated: currentDate
          },
          activeBenefits: [
            {
              type: 'BONUS_POINTS',
              value: 10,
              description: 'Points sur réservations',
              validUntil: new Date(currentDate.getFullYear() + 1, 11, 31),
              usageCount: 0,
              maxUsage: 999,
              isActive: true,
              autoRenew: true
            }
          ],
          tierHistory: [
            {
              tier: 'BRONZE',
              achievedAt: currentDate,
              pointsAtAchievement: WELCOME_BONUS,
              celebrationSent: false
            }
          ],
          specialStatus: {
            isVIP: false,
            specialOffers: []
          }
        };

        await user.save({ session });

        // Créer transaction de bienvenue
        const welcomeTransaction = new LoyaltyTransaction({
          user: userId,
          type: 'EARN_WELCOME',
          pointsAmount: WELCOME_BONUS,
          previousBalance: 0,
          newBalance: WELCOME_BONUS,
          description: 'Bonus de bienvenue au programme de fidélité',
          earnedFrom: {
            bonusMultiplier: 1,
            tierAtEarning: 'BRONZE',
            bonusDetails: 'Inscription manuelle au programme'
          },
          source: 'WEB',
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          expiresAt: new Date(currentDate.getTime() + (24 * 30 * 24 * 60 * 60 * 1000))
        });

        await welcomeTransaction.save({ session });

        // Notifications
        setTimeout(() => {
          socketService.sendUserNotification(userId, 'LOYALTY_ENROLLED', {
            welcomeBonus: WELCOME_BONUS,
            tier: 'BRONZE',
            enrolledAt: currentDate,
            message: 'Bienvenue dans notre programme de fidélité !'
          });
        }, 1000);

        // Email de bienvenue
        try {
          await emailService.sendEmail({
            to: user.email,
            template: 'loyalty-welcome',
            data: {
              user: { firstName: user.firstName, lastName: user.lastName },
              loyalty: {
                welcomeBonus: WELCOME_BONUS,
                tier: 'BRONZE',
                enrolledAt: currentDate
              }
            }
          });
        } catch (emailError) {
          logger.error('Erreur email bienvenue loyalty:', emailError);
        }

        logger.info(`Manual loyalty enrollment: ${user.email}`, {
          userId,
          welcomeBonus: WELCOME_BONUS,
          transactionId: welcomeTransaction._id
        });

        res.status(201).json({
          success: true,
          message: 'Inscription au programme de fidélité réussie !',
          data: {
            enrolledAt: currentDate,
            welcomeBonus: WELCOME_BONUS,
            currentTier: 'BRONZE',
            currentPoints: WELCOME_BONUS,
            transactionId: welcomeTransaction._id,
            nextMilestone: {
              tier: 'SILVER',
              pointsNeeded: 800
            }
          }
        });
      });
    } catch (error) {
      logger.error('Erreur inscription loyalty manuelle:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de l\'inscription au programme'
      });
    } finally {
      await session.endSession();
    }
  },

  /**
   * Obtenir le statut rapide du programme de fidélité
   * GET /api/auth/loyalty-status
   */
  getLoyaltyStatus: async (req, res) => {
    try {
      const userId = req.user.userId;
      
      const user = await User.findById(userId)
        .select('firstName lastName loyalty')
        .lean();

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }

      if (!user.loyalty?.enrolledAt) {
        return res.json({
          success: true,
          data: {
            enrolled: false,
            message: 'Non inscrit au programme de fidélité',
            enrollmentAvailable: true,
            benefits: [
              'Points sur toutes vos réservations',
              'Réductions et upgrades gratuits',
              'Offres exclusives membres',
              'Progression vers niveaux VIP'
            ]
          }
        });
      }

      // Calculer points qui expirent bientôt
      const expiringPoints = await LoyaltyTransaction.aggregate([
        {
          $match: {
            user: new mongoose.Types.ObjectId(userId),
            pointsAmount: { $gt: 0 },
            status: 'COMPLETED',
            expiresAt: {
              $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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

      const loyaltyService = getLoyaltyService();

      res.json({
        success: true,
        data: {
          enrolled: true,
          user: {
            name: `${user.firstName} ${user.lastName}`,
            tier: user.loyalty.tier,
            tierDisplay: loyaltyService.getTierDisplayName(user.loyalty.tier),
            tierIcon: loyaltyService.getTierIcon(user.loyalty.tier)
          },
          points: {
            current: user.loyalty.currentPoints,
            lifetime: user.loyalty.lifetimePoints,
            estimatedValue: Math.round((user.loyalty.currentPoints / 100) * 100) / 100,
            expiring: expiringPoints[0]?.totalExpiring || 0,
            nextExpiry: expiringPoints[0]?.nextExpiry
          },
          progress: user.loyalty.tierProgress,
          memberSince: user.loyalty.enrolledAt,
          quickActions: getQuickActions(user.loyalty)
        }
      });

    } catch (error) {
      logger.error('Erreur statut loyalty:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération du statut'
      });
    }
  }
};