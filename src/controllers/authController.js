const User = require('../models/User');
const jwtUtils = require('../utils/jwt');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * Inscription d'un nouvel utilisateur
 * POST /api/auth/register
 */
const register = async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      password,
      phone,
      role = 'CLIENT',
      companyName,
      siret,
      preferences
    } = req.body;

    // 1. Vérification des champs obligatoires
    if (!firstName || !lastName || !email || !password || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Tous les champs obligatoires doivent être renseignés',
        required: ['firstName', 'lastName', 'email', 'password', 'phone']
      });
    }

    // 2. Vérifier si l'utilisateur existe déjà
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'Un compte existe déjà avec cette adresse email',
        field: 'email'
      });
    }

    // 3. Validation du mot de passe
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Le mot de passe doit contenir au moins 6 caractères',
        field: 'password'
      });
    }

    // 4. Validation du rôle selon les permissions
    const allowedRoles = ['CLIENT'];
    // Seuls les admins peuvent créer des réceptionnistes et autres admins
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

    // 5. Créer le nouvel utilisateur
    const userData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      password,
      phone: phone.trim(),
      role,
      preferences: preferences || {}
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

    // 6. Générer le token de vérification email
    const emailVerificationToken = user.createEmailVerificationToken();
    
    // 7. Sauvegarder l'utilisateur
    await user.save();

    // 8. Générer les tokens JWT pour connexion automatique
    const tokenPair = jwtUtils.generateTokenPair(user);

    // 9. Envoyer l'email de vérification (simulation)
    // TODO: Intégrer service d'email (Nodemailer, SendGrid, etc.)
    console.log(`Email de vérification pour ${user.email}: /api/auth/verify-email/${emailVerificationToken}`);

    // 10. Réponse succès (sans le password)
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
      createdAt: user.createdAt
    };

    res.status(201).json({
      success: true,
      message: 'Compte créé avec succès',
      user: userResponse,
      ...tokenPair,
      emailVerification: {
        required: true,
        message: 'Un email de vérification a été envoyé'
      }
    });

  } catch (error) {
    console.error('Erreur inscription:', error);

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
  }
};

/**
 * Connexion utilisateur
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

    // 7. Mettre à jour la dernière connexion
    await user.updateLastLogin();

    // 8. Générer les tokens JWT
    const tokenOptions = {};
    if (rememberMe) {
      tokenOptions.expiresIn = '30d'; // Token plus long pour "Se souvenir de moi"
    }

    const tokenPair = jwtUtils.generateTokenPair(user);

    // 9. Préparer la réponse utilisateur
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

    // 10. Réponse succès
    res.json({
      success: true,
      message: 'Connexion réussie',
      user: userResponse,
      ...tokenPair,
      rememberMe,
      loginTime: new Date()
    });

  } catch (error) {
    console.error('Erreur connexion:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur interne du serveur lors de la connexion'
    });
  }
};

/**
 * Déconnexion utilisateur
 * POST /api/auth/logout
 */
const logout = async (req, res) => {
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
};

/**
 * Renouveler le token d'accès
 * POST /api/auth/refresh
 */
const refreshToken = async (req, res) => {
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
};

/**
 * Obtenir les informations du profil utilisateur connecté
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

    res.json({
      success: true,
      user: {
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
      }
    });

  } catch (error) {
    console.error('Erreur récupération profil:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du profil'
    });
  }
};

/**
 * Demande de réinitialisation du mot de passe
 * POST /api/auth/forgot-password
 */
const forgotPassword = async (req, res) => {
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
};

/**
 * Réinitialisation du mot de passe
 * POST /api/auth/reset-password/:token
 */
const resetPassword = async (req, res) => {
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
};

/**
 * Vérification de l'email
 * GET /api/auth/verify-email/:token
 */
const verifyEmail = async (req, res) => {
  try {
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
    });

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

    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'Email vérifié avec succès',
      user: {
        id: user._id,
        email: user.email,
        isEmailVerified: true
      },
      verifiedAt: new Date()
    });

  } catch (error) {
    console.error('Erreur vérification email:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification de l\'email'
    });
  }
};

/**
 * Renvoyer l'email de vérification
 * POST /api/auth/resend-verification
 */
const resendVerification = async (req, res) => {
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

    res.json({
      success: true,
      message: 'Email de vérification renvoyé',
      email: user.email,
      expiresAt: user.emailVerificationExpires
    });

  } catch (error) {
    console.error('Erreur renvoi vérification:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors du renvoi de l\'email de vérification'
    });
  }
};

/**
 * Changer le mot de passe (utilisateur connecté)
 * PUT /api/auth/change-password
 */
const changePassword = async (req, res) => {
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
    await user.save();

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
};

module.exports = {
  register,
  login,
  logout,
  refreshToken,
  getProfile,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerification,
  changePassword
};