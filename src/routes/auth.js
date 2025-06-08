const express = require('express');
const router = express.Router();

// Controllers et middleware
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const validation = require('../middleware/validation');

/**
 * @swagger
 * components:
 *   schemas:
 *     User:
 *       type: object
 *       required:
 *         - firstName
 *         - lastName
 *         - email
 *         - password
 *         - phone
 *       properties:
 *         firstName:
 *           type: string
 *           description: Prénom de l'utilisateur
 *         lastName:
 *           type: string
 *           description: Nom de l'utilisateur
 *         email:
 *           type: string
 *           format: email
 *           description: Adresse email unique
 *         password:
 *           type: string
 *           minLength: 6
 *           description: Mot de passe (minimum 6 caractères)
 *         phone:
 *           type: string
 *           pattern: '^(\+33|0)[1-9](\d{8})$'
 *           description: Numéro de téléphone français
 *         role:
 *           type: string
 *           enum: [CLIENT, RECEPTIONIST, ADMIN]
 *           default: CLIENT
 *           description: Rôle de l'utilisateur
 *         companyName:
 *           type: string
 *           description: Nom de l'entreprise (optionnel)
 *         siret:
 *           type: string
 *           pattern: '^\d{14}$'
 *           description: Numéro SIRET (14 chiffres)
 * 
 *     AuthResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *         user:
 *           $ref: '#/components/schemas/User'
 *         accessToken:
 *           type: string
 *         refreshToken:
 *           type: string
 *         tokenType:
 *           type: string
 *           default: Bearer
 *         expiresIn:
 *           type: number
 *         accessTokenExpires:
 *           type: string
 *           format: date-time
 * 
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     summary: Inscription d'un nouvel utilisateur
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - firstName
 *               - lastName
 *               - email
 *               - password
 *               - phone
 *             properties:
 *               firstName:
 *                 type: string
 *                 example: "Jean"
 *               lastName:
 *                 type: string
 *                 example: "Dupont"
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@email.com"
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "motdepasse123"
 *               phone:
 *                 type: string
 *                 example: "0123456789"
 *               role:
 *                 type: string
 *                 enum: [CLIENT, RECEPTIONIST, ADMIN]
 *                 default: CLIENT
 *               companyName:
 *                 type: string
 *                 example: "Mon Entreprise SARL"
 *               siret:
 *                 type: string
 *                 example: "12345678901234"
 *     responses:
 *       201:
 *         description: Inscription réussie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Données invalides
 *       409:
 *         description: Email déjà utilisé
 */
router.post('/register', 
  authMiddleware.rateLimiter(10, 15 * 60 * 1000), // 10 inscriptions max par 15min
  validation.validateRegister,
  authController.register
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Connexion utilisateur
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@email.com"
 *               password:
 *                 type: string
 *                 example: "motdepasse123"
 *               rememberMe:
 *                 type: boolean
 *                 default: false
 *                 description: Token longue durée (30 jours)
 *     responses:
 *       200:
 *         description: Connexion réussie
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Identifiants invalides
 *       423:
 *         description: Compte verrouillé
 */
router.post('/login',
  authMiddleware.rateLimiter(5, 15 * 60 * 1000), // 5 tentatives max par 15min
  validation.validateLogin,
  authController.login
);

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Déconnexion utilisateur
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token à révoquer
 *     responses:
 *       200:
 *         description: Déconnexion réussie
 *       401:
 *         description: Token invalide
 */
router.post('/logout',
  authMiddleware.optionalAuth, // Auth optionnelle car on peut se déconnecter sans token valide
  authController.logout
);

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Renouveler le token d'accès
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refreshToken
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Refresh token valide
 *     responses:
 *       200:
 *         description: Token renouvelé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 accessToken:
 *                   type: string
 *                 tokenType:
 *                   type: string
 *                 expiresIn:
 *                   type: number
 *                 accessTokenExpires:
 *                   type: string
 *                   format: date-time
 *       401:
 *         description: Refresh token invalide ou expiré
 */
router.post('/refresh',
  authMiddleware.rateLimiter(20, 15 * 60 * 1000), // 20 renouvellements max par 15min
  validation.validateRefreshToken,
  authController.refreshToken
);

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Obtenir le profil utilisateur connecté
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Profil utilisateur
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 user:
 *                   $ref: '#/components/schemas/User'
 *       401:
 *         description: Token invalide
 */
router.get('/me',
  authMiddleware.authRequired,
  authMiddleware.logAuthenticatedAccess,
  authController.getProfile
);

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     summary: Demande de réinitialisation du mot de passe
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@email.com"
 *     responses:
 *       200:
 *         description: Email de réinitialisation envoyé (si l'email existe)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 email:
 *                   type: string
 *       400:
 *         description: Email requis
 */
router.post('/forgot-password',
  authMiddleware.rateLimiter(3, 15 * 60 * 1000), // 3 demandes max par 15min
  validation.validateEmail,
  authController.forgotPassword
);

/**
 * @swagger
 * /api/auth/reset-password/{token}:
 *   post:
 *     summary: Réinitialiser le mot de passe
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token de réinitialisation reçu par email
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - password
 *               - confirmPassword
 *             properties:
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: "nouveaumotdepasse123"
 *               confirmPassword:
 *                 type: string
 *                 example: "nouveaumotdepasse123"
 *     responses:
 *       200:
 *         description: Mot de passe réinitialisé avec succès
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       400:
 *         description: Token invalide ou mots de passe non conformes
 */
router.post('/reset-password/:token',
  authMiddleware.rateLimiter(5, 15 * 60 * 1000), // 5 tentatives max par 15min
  validation.validateResetPassword,
  authController.resetPassword
);

/**
 * @swagger
 * /api/auth/verify-email/{token}:
 *   get:
 *     summary: Vérifier l'adresse email
 *     tags: [Authentication]
 *     parameters:
 *       - in: path
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token de vérification reçu par email
 *     responses:
 *       200:
 *         description: Email vérifié avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     email:
 *                       type: string
 *                     isEmailVerified:
 *                       type: boolean
 *                 verifiedAt:
 *                   type: string
 *                   format: date-time
 *       400:
 *         description: Token invalide ou expiré
 */
router.get('/verify-email/:token',
  authController.verifyEmail
);

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     summary: Renvoyer l'email de vérification
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: "jean.dupont@email.com"
 *     responses:
 *       200:
 *         description: Email de vérification renvoyé
 *       400:
 *         description: Email requis
 *       404:
 *         description: Utilisateur non trouvé ou email déjà vérifié
 */
router.post('/resend-verification',
  authMiddleware.rateLimiter(3, 15 * 60 * 1000), // 3 renvois max par 15min
  validation.validateEmail,
  authController.resendVerification
);

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     summary: Changer le mot de passe (utilisateur connecté)
 *     tags: [Authentication]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *               - confirmPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 example: "ancienpassword123"
 *               newPassword:
 *                 type: string
 *                 minLength: 6
 *                 example: "nouveaupassword123"
 *               confirmPassword:
 *                 type: string
 *                 example: "nouveaupassword123"
 *     responses:
 *       200:
 *         description: Mot de passe modifié avec succès
 *       401:
 *         description: Mot de passe actuel incorrect
 *       400:
 *         description: Données invalides
 */
router.put('/change-password',
  authMiddleware.authRequired,
  authMiddleware.rateLimiter(5, 15 * 60 * 1000), // 5 changements max par 15min
  validation.validateChangePassword,
  authController.changePassword
);

// ============================================================================
// ROUTES D'ADMINISTRATION - ADMIN UNIQUEMENT
// ============================================================================

/**
 * @swagger
 * /api/auth/admin/users:
 *   post:
 *     summary: Créer un utilisateur (Admin uniquement)
 *     tags: [Admin - Authentication]
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/User'
 *     responses:
 *       201:
 *         description: Utilisateur créé avec succès
 *       403:
 *         description: Permissions insuffisantes
 */
router.post('/admin/users',
  authMiddleware.adminRequired,
  validation.validateRegister,
  authController.register
);

/**
 * @swagger
 * /api/auth/admin/users/{userId}/toggle-status:
 *   patch:
 *     summary: Activer/Désactiver un utilisateur
 *     tags: [Admin - Authentication]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de l'utilisateur
 *     responses:
 *       200:
 *         description: Statut utilisateur modifié
 *       403:
 *         description: Permissions insuffisantes
 *       404:
 *         description: Utilisateur non trouvé
 */
router.patch('/admin/users/:userId/toggle-status',
  authMiddleware.adminRequired,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const User = require('../models/User');
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }
      
      user.isActive = !user.isActive;
      await user.save();
      
      res.json({
        success: true,
        message: `Utilisateur ${user.isActive ? 'activé' : 'désactivé'} avec succès`,
        user: {
          id: user._id,
          email: user.email,
          isActive: user.isActive
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la modification du statut'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/admin/users/{userId}/unlock:
 *   patch:
 *     summary: Déverrouiller un compte utilisateur
 *     tags: [Admin - Authentication]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de l'utilisateur
 *     responses:
 *       200:
 *         description: Compte déverrouillé avec succès
 *       403:
 *         description: Permissions insuffisantes
 *       404:
 *         description: Utilisateur non trouvé
 */
router.patch('/admin/users/:userId/unlock',
  authMiddleware.adminRequired,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const User = require('../models/User');
      
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé'
        });
      }
      
      await user.resetLoginAttempts();
      
      res.json({
        success: true,
        message: 'Compte déverrouillé avec succès',
        user: {
          id: user._id,
          email: user.email,
          isLocked: false
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors du déverrouillage du compte'
      });
    }
  }
);

/**
 * @swagger
 * /api/auth/admin/stats:
 *   get:
 *     summary: Statistiques d'authentification
 *     tags: [Admin - Authentication]
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Statistiques récupérées avec succès
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 stats:
 *                   type: object
 *                   properties:
 *                     totalUsers:
 *                       type: number
 *                     activeUsers:
 *                       type: number
 *                     lockedUsers:
 *                       type: number
 *                     unverifiedEmails:
 *                       type: number
 *                     usersByRole:
 *                       type: array
 *       403:
 *         description: Permissions insuffisantes
 */
router.get('/admin/stats',
  authMiddleware.adminRequired,
  async (req, res) => {
    try {
      const User = require('../models/User');
      
      const totalUsers = await User.countDocuments();
      const activeUsers = await User.countDocuments({ isActive: true });
      const lockedUsers = await User.countDocuments({ 
        lockUntil: { $gt: new Date() } 
      });
      const unverifiedEmails = await User.countDocuments({ 
        isEmailVerified: false 
      });
      
      const usersByRole = await User.getStatsByRole();
      
      res.json({
        success: true,
        stats: {
          totalUsers,
          activeUsers,
          lockedUsers,
          unverifiedEmails,
          usersByRole,
          generatedAt: new Date()
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la récupération des statistiques'
      });
    }
  }
);

// ============================================================================
// ROUTES DE DÉVELOPPEMENT (À SUPPRIMER EN PRODUCTION)
// ============================================================================

if (process.env.NODE_ENV === 'development') {
  /**
   * Route de développement pour tester les tokens
   * GET /api/auth/dev/token-info
   */
  router.get('/dev/token-info',
    authMiddleware.authRequired,
    (req, res) => {
      const jwtUtils = require('../utils/jwt');
      const token = jwtUtils.extractTokenFromHeader(req.headers.authorization);
      const tokenInfo = jwtUtils.getTokenExpiration(token);
      
      res.json({
        success: true,
        tokenInfo: {
          ...tokenInfo,
          user: req.user,
          issued: req.user.tokenIssued,
          expires: req.user.tokenExpires
        }
      });
    }
  );

  /**
   * Route de développement pour nettoyer la blacklist
   * POST /api/auth/dev/cleanup-blacklist
   */
  router.post('/dev/cleanup-blacklist',
    authMiddleware.adminRequired,
    (req, res) => {
      const jwtUtils = require('../utils/jwt');
      const cleaned = jwtUtils.cleanupBlacklist();
      
      res.json({
        success: true,
        message: `${cleaned} tokens expirés supprimés de la blacklist`,
        cleanedCount: cleaned
      });
    }
  );
}

module.exports = router;