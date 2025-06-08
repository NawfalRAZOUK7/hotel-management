const User = require('../models/User');
const jwtUtils = require('../utils/jwt');

/**
 * Middleware d'authentification - Vérifier le JWT token
 * Vérifie la présence et validité du token d'accès
 */
const authenticateToken = async (req, res, next) => {
  try {
    // 1. Extraire le token du header Authorization
    const authHeader = req.headers.authorization;
    const token = jwtUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token d\'accès requis',
        code: 'MISSING_TOKEN',
        hint: 'Ajoutez le header: Authorization: Bearer <token>'
      });
    }

    // 2. Vérifier le token JWT
    let decoded;
    try {
      decoded = jwtUtils.verifyAccessToken(token);
    } catch (error) {
      let errorResponse = {
        success: false,
        code: 'INVALID_TOKEN'
      };

      if (error.message.includes('expiré')) {
        errorResponse.message = 'Token expiré';
        errorResponse.code = 'TOKEN_EXPIRED';
        errorResponse.hint = 'Utilisez votre refresh token pour obtenir un nouveau token d\'accès';
        return res.status(401).json(errorResponse);
      } else if (error.message.includes('révoqué')) {
        errorResponse.message = 'Token révoqué';
        errorResponse.code = 'TOKEN_REVOKED';
        errorResponse.hint = 'Reconnectez-vous pour obtenir un nouveau token';
        return res.status(401).json(errorResponse);
      } else {
        errorResponse.message = 'Token invalide';
        errorResponse.hint = 'Vérifiez le format de votre token';
        return res.status(401).json(errorResponse);
      }
    }

    // 3. Vérifier que l'utilisateur existe toujours
    const user = await User.findById(decoded.userId).select('-password');
    
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé',
        code: 'USER_NOT_FOUND',
        hint: 'L\'utilisateur associé à ce token n\'existe plus'
      });
    }

    // 4. Vérifier que l'utilisateur est actif
    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Compte désactivé',
        code: 'ACCOUNT_DISABLED',
        hint: 'Contactez l\'administrateur pour réactiver votre compte'
      });
    }

    // 5. Vérifier que le compte n'est pas verrouillé
    if (user.isLocked) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(423).json({
        success: false,
        message: 'Compte temporairement verrouillé',
        code: 'ACCOUNT_LOCKED',
        lockTimeRemaining: `${lockTimeRemaining} minutes`,
        unlockAt: user.lockUntil
      });
    }

    // 6. Ajouter les informations utilisateur à la requête
    req.user = {
      userId: user._id,
      email: user.email,
      role: user.role,
      fullName: user.fullName,
      isEmailVerified: user.isEmailVerified,
      clientType: user.clientType,
      companyName: user.companyName,
      // Informations du token
      tokenIssued: new Date(decoded.iat * 1000),
      tokenExpires: new Date(decoded.exp * 1000)
    };

    // Ajouter l'objet user complet si besoin (optionnel)
    req.userDoc = user;

    next();

  } catch (error) {
    console.error('Erreur middleware authentification:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur interne lors de l\'authentification',
      code: 'AUTH_ERROR'
    });
  }
};

/**
 * Middleware d'autorisation - Vérifier les rôles
 * @param {...string} allowedRoles - Rôles autorisés
 * @returns {Function} Middleware d'autorisation
 */
const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    try {
      // Vérifier que l'utilisateur est authentifié
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED',
          hint: 'Utilisez d\'abord le middleware authenticateToken'
        });
      }

      // Vérifier les rôles
      if (!allowedRoles.includes(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Permissions insuffisantes',
          code: 'INSUFFICIENT_PERMISSIONS',
          required: allowedRoles,
          current: req.user.role,
          hint: `Seuls les rôles [${allowedRoles.join(', ')}] peuvent accéder à cette ressource`
        });
      }

      next();

    } catch (error) {
      console.error('Erreur middleware autorisation:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur interne lors de la vérification des permissions',
        code: 'AUTHORIZATION_ERROR'
      });
    }
  };
};

/**
 * Middleware optionnel - Authentifier si token présent
 * Utile pour les routes qui peuvent fonctionner avec ou sans authentification
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = jwtUtils.extractTokenFromHeader(authHeader);

    // Si pas de token, continuer sans authentification
    if (!token) {
      req.user = null;
      return next();
    }

    // Si token présent, essayer de l'authentifier
    try {
      const decoded = jwtUtils.verifyAccessToken(token);
      const user = await User.findById(decoded.userId).select('-password');

      if (user && user.isActive && !user.isLocked) {
        req.user = {
          userId: user._id,
          email: user.email,
          role: user.role,
          fullName: user.fullName,
          isEmailVerified: user.isEmailVerified,
          clientType: user.clientType,
          companyName: user.companyName
        };
        req.userDoc = user;
      } else {
        req.user = null;
      }
    } catch (error) {
      // En cas d'erreur token, continuer sans authentification
      req.user = null;
    }

    next();

  } catch (error) {
    console.error('Erreur middleware authentification optionnelle:', error);
    req.user = null;
    next();
  }
};

/**
 * Middleware de vérification d'email
 * Nécessite que l'email de l'utilisateur soit vérifié
 */
const requireEmailVerification = (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentification requise',
        code: 'AUTHENTICATION_REQUIRED'
      });
    }

    if (!req.user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Vérification d\'email requise',
        code: 'EMAIL_VERIFICATION_REQUIRED',
        hint: 'Vérifiez votre email avant d\'accéder à cette ressource',
        actions: {
          resendVerification: '/api/auth/resend-verification'
        }
      });
    }

    next();

  } catch (error) {
    console.error('Erreur middleware vérification email:', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification d\'email',
      code: 'EMAIL_VERIFICATION_ERROR'
    });
  }
};

/**
 * Middleware de vérification de propriété de ressource
 * Vérifie que l'utilisateur peut accéder à sa propre ressource
 * @param {string} paramName - Nom du paramètre contenant l'ID utilisateur
 * @returns {Function} Middleware de vérification
 */
const requireOwnership = (paramName = 'userId') => {
  return (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      const resourceUserId = req.params[paramName];
      
      if (!resourceUserId) {
        return res.status(400).json({
          success: false,
          message: `Paramètre ${paramName} requis`,
          code: 'MISSING_PARAMETER'
        });
      }

      // Les admins peuvent accéder à toutes les ressources
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Vérifier que l'utilisateur accède à sa propre ressource
      if (req.user.userId.toString() !== resourceUserId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cette ressource',
          code: 'RESOURCE_ACCESS_DENIED',
          hint: 'Vous ne pouvez accéder qu\'à vos propres ressources'
        });
      }

      next();

    } catch (error) {
      console.error('Erreur middleware ownership:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification de propriété',
        code: 'OWNERSHIP_ERROR'
      });
    }
  };
};

/**
 * Middleware de limitation de débit (Rate Limiting)
 * @param {number} maxRequests - Nombre maximum de requêtes
 * @param {number} windowMs - Fenêtre de temps en millisecondes
 * @returns {Function} Middleware de rate limiting
 */
const rateLimiter = (maxRequests = 100, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();

  return (req, res, next) => {
    try {
      const identifier = req.user ? req.user.userId : req.ip;
      const now = Date.now();
      
      // Nettoyer les anciennes entrées
      requests.forEach((data, key) => {
        if (now - data.firstRequest > windowMs) {
          requests.delete(key);
        }
      });

      // Obtenir ou créer l'entrée pour cet utilisateur/IP
      let userRequests = requests.get(identifier);
      
      if (!userRequests) {
        userRequests = {
          count: 0,
          firstRequest: now
        };
        requests.set(identifier, userRequests);
      }

      // Vérifier la limite
      if (userRequests.count >= maxRequests) {
        const resetTime = userRequests.firstRequest + windowMs;
        const resetIn = Math.ceil((resetTime - now) / 1000);
        
        return res.status(429).json({
          success: false,
          message: 'Trop de requêtes',
          code: 'RATE_LIMIT_EXCEEDED',
          limit: maxRequests,
          windowMs,
          resetIn: `${resetIn} secondes`,
          hint: 'Attendez avant de refaire une requête'
        });
      }

      // Incrémenter le compteur
      userRequests.count++;

      // Ajouter les headers de rate limiting
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': maxRequests - userRequests.count,
        'X-RateLimit-Reset': new Date(userRequests.firstRequest + windowMs).toISOString()
      });

      next();

    } catch (error) {
      console.error('Erreur middleware rate limiting:', error);
      next(); // En cas d'erreur, laisser passer
    }
  };
};

/**
 * Middleware de validation des permissions personnalisées
 * @param {Function} permissionCheck - Fonction de vérification personnalisée
 * @returns {Function} Middleware de permission
 */
const requirePermission = (permissionCheck) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Exécuter la vérification personnalisée
      const hasPermission = await permissionCheck(req.user, req);

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: 'Permission refusée',
          code: 'CUSTOM_PERMISSION_DENIED',
          hint: 'Vous n\'avez pas les permissions nécessaires pour cette action'
        });
      }

      next();

    } catch (error) {
      console.error('Erreur middleware permission personnalisée:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification des permissions',
        code: 'PERMISSION_ERROR'
      });
    }
  };
};

/**
 * Middleware de logging des accès authentifiés
 */
const logAuthenticatedAccess = (req, res, next) => {
  if (req.user) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} - User: ${req.user.email} (${req.user.role})`);
  }
  next();
};

/**
 * Utilitaire pour combiner plusieurs middlewares d'authentification
 * @param {...Function} middlewares - Middlewares à combiner
 * @returns {Function} Middleware combiné
 */
const combineAuthMiddlewares = (...middlewares) => {
  return (req, res, next) => {
    let index = 0;

    const executeNext = (error) => {
      if (error) {
        return next(error);
      }

      if (index >= middlewares.length) {
        return next();
      }

      const middleware = middlewares[index++];
      
      try {
        middleware(req, res, executeNext);
      } catch (err) {
        next(err);
      }
    };

    executeNext();
  };
};

module.exports = {
  // Middlewares principaux
  authenticateToken,
  authorizeRoles,
  optionalAuth,
  
  // Middlewares spécialisés
  requireEmailVerification,
  requireOwnership,
  requirePermission,
  
  // Utilitaires
  rateLimiter,
  logAuthenticatedAccess,
  combineAuthMiddlewares,
  
  // Raccourcis pour les rôles courants
  requireAdmin: authorizeRoles('ADMIN'),
  requireReceptionist: authorizeRoles('RECEPTIONIST', 'ADMIN'),
  requireClient: authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN'),
  
  // Raccourcis combinés fréquents
  authRequired: combineAuthMiddlewares(authenticateToken),
  adminRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('ADMIN')),
  receptionistRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('RECEPTIONIST', 'ADMIN')),
  clientRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN')),
  verifiedUserRequired: combineAuthMiddlewares(authenticateToken, requireEmailVerification)
};