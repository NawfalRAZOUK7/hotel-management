const User = require('../models/User');
const Company = require('../models/Company');
const ApprovalRequest = require('../models/ApprovalRequest');
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
    const user = await User.findById(decoded.userId)
      .select('-password')
      .populate('company', 'name status contract billing settings');
    
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

    // 6. Vérifier le statut de l'entreprise si applicable
    if (user.company && user.company.status === 'suspended') {
      return res.status(403).json({
        success: false,
        message: 'Entreprise suspendue',
        code: 'COMPANY_SUSPENDED',
        hint: 'Contactez votre administrateur ou le support pour plus d\'informations'
      });
    }

    // 7. Ajouter les informations utilisateur à la requête
    req.user = {
      userId: user._id,
      email: user.email,
      role: user.role,
      userType: user.userType,
      fullName: user.fullName,
      isEmailVerified: user.isEmailVerified,
      clientType: user.clientType,
      companyName: user.companyName,
      company: user.company,
      department: user.department,
      jobTitle: user.jobTitle,
      hierarchy: user.hierarchy,
      permissions: user.permissions,
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
      const user = await User.findById(decoded.userId)
        .select('-password')
        .populate('company', 'name status contract billing settings');

      if (user && user.isActive && !user.isLocked) {
        req.user = {
          userId: user._id,
          email: user.email,
          role: user.role,
          userType: user.userType,
          fullName: user.fullName,
          isEmailVerified: user.isEmailVerified,
          clientType: user.clientType,
          companyName: user.companyName,
          company: user.company,
          department: user.department,
          permissions: user.permissions,
          hierarchy: user.hierarchy
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

// ============================================================================
// NOUVEAUX MIDDLEWARES ENTREPRISE
// ============================================================================

/**
 * Middleware - Vérifier si l'utilisateur est administrateur d'entreprise
 * @returns {Function} Middleware de vérification
 */
const isCompanyAdmin = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Vérifier si l'utilisateur est un admin système (accès total)
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Vérifier si l'utilisateur a une entreprise
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux utilisateurs d\'entreprise',
          code: 'NOT_COMPANY_USER',
          hint: 'Cette action nécessite d\'être associé à une entreprise'
        });
      }

      // Vérifier le type d'utilisateur
      if (req.user.userType !== 'company_admin') {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux administrateurs d\'entreprise',
          code: 'NOT_COMPANY_ADMIN',
          current: req.user.userType,
          required: 'company_admin',
          hint: 'Contactez votre administrateur d\'entreprise pour obtenir les permissions nécessaires'
        });
      }

      // Vérifier que l'entreprise est active
      if (req.user.company.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Entreprise non active',
          code: 'COMPANY_INACTIVE',
          status: req.user.company.status,
          hint: 'L\'entreprise doit être active pour effectuer cette action'
        });
      }

      // Vérifier les permissions spécifiques
      if (!req.user.permissions?.canManageTeam) {
        return res.status(403).json({
          success: false,
          message: 'Permission de gestion d\'équipe requise',
          code: 'MISSING_TEAM_MANAGEMENT_PERMISSION',
          hint: 'Cette action nécessite la permission de gestion d\'équipe'
        });
      }

      next();

    } catch (error) {
      console.error('Erreur middleware isCompanyAdmin:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification des permissions d\'administration',
        code: 'COMPANY_ADMIN_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier si l'utilisateur peut approuver des demandes
 * @returns {Function} Middleware de vérification
 */
const isManager = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Admin système peut tout approuver
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Vérifier si l'utilisateur a une entreprise
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux utilisateurs d\'entreprise',
          code: 'NOT_COMPANY_USER',
          hint: 'Les approbations nécessitent d\'être associé à une entreprise'
        });
      }

      // Vérifier le type d'utilisateur (manager ou company_admin)
      const allowedTypes = ['manager', 'company_admin'];
      if (!allowedTypes.includes(req.user.userType)) {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux managers et administrateurs d\'entreprise',
          code: 'NOT_MANAGER',
          current: req.user.userType,
          required: allowedTypes,
          hint: 'Contactez votre manager pour obtenir les permissions d\'approbation'
        });
      }

      // Vérifier les permissions générales d'approbation
      if (!req.user.permissions?.canApprove) {
        return res.status(403).json({
          success: false,
          message: 'Permission d\'approbation requise',
          code: 'MISSING_APPROVAL_PERMISSION',
          hint: 'Votre compte n\'a pas les permissions pour approuver des demandes'
        });
      }

      // Vérifier les paramètres hiérarchiques
      if (!req.user.hierarchy?.canApprove) {
        return res.status(403).json({
          success: false,
          message: 'Approbation non autorisée dans la hiérarchie',
          code: 'HIERARCHY_APPROVAL_DISABLED',
          hint: 'Votre niveau hiérarchique ne permet pas d\'approuver des demandes'
        });
      }

      // Vérifier que l'utilisateur a une limite d'approbation
      if (!req.user.hierarchy?.approvalLimit || req.user.hierarchy.approvalLimit <= 0) {
        return res.status(403).json({
          success: false,
          message: 'Limite d\'approbation non définie',
          code: 'NO_APPROVAL_LIMIT',
          hint: 'Une limite d\'approbation doit être configurée pour votre compte'
        });
      }

      // Ajouter les informations d'approbation à la requête
      req.approvalInfo = {
        canApprove: true,
        approvalLimit: req.user.hierarchy.approvalLimit,
        userLevel: req.user.hierarchy.level || 1,
        isCompanyAdmin: req.user.userType === 'company_admin'
      };

      next();

    } catch (error) {
      console.error('Erreur middleware isManager:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification des permissions de management',
        code: 'MANAGER_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier les limites d'approbation selon le montant
 * @param {Object} options - Options de configuration
 * @param {string} options.amountField - Champ contenant le montant (défaut: 'amount')
 * @param {string} options.source - Source du montant ('body', 'params', 'query')
 * @returns {Function} Middleware de vérification
 */
const checkApprovalLimit = (options = {}) => {
  const { amountField = 'amount', source = 'body' } = options;
  
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Extraire le montant selon la source
      let amount;
      switch (source) {
        case 'params':
          amount = parseFloat(req.params[amountField]);
          break;
        case 'query':
          amount = parseFloat(req.query[amountField]);
          break;
        default: // body
          amount = parseFloat(req.body[amountField]);
      }

      // Vérifier que le montant est valide
      if (isNaN(amount) || amount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Montant invalide',
          code: 'INVALID_AMOUNT',
          provided: req[source][amountField],
          hint: `Le champ ${amountField} doit contenir un nombre positif`
        });
      }

      // Admin système : pas de limite
      if (req.user.role === 'ADMIN') {
        req.approvalCheck = {
          amount,
          canApprove: true,
          unlimited: true,
          reason: 'Administrateur système'
        };
        return next();
      }

      // Vérifier si l'utilisateur a une entreprise
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Approbation réservée aux utilisateurs d\'entreprise',
          code: 'NOT_COMPANY_USER'
        });
      }

      // Récupérer l'utilisateur complet avec hiérarchie
      const user = await User.findById(req.user.userId)
        .populate('company', 'name settings billing')
        .select('hierarchy permissions userType');

      if (!user) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur non trouvé',
          code: 'USER_NOT_FOUND'
        });
      }

      // Vérifier si l'utilisateur peut approuver
      if (!user.permissions?.canApprove || !user.hierarchy?.canApprove) {
        return res.status(403).json({
          success: false,
          message: 'Permission d\'approbation requise',
          code: 'CANNOT_APPROVE',
          hint: 'Votre compte n\'a pas les permissions pour approuver des montants'
        });
      }

      const approvalLimit = user.hierarchy.approvalLimit || 0;

      // Vérifier la limite d'approbation
      if (amount > approvalLimit) {
        // Chercher un approbateur de niveau supérieur
        const higherApprovers = await User.find({
          company: req.user.company._id,
          'permissions.canApprove': true,
          'hierarchy.canApprove': true,
          'hierarchy.approvalLimit': { $gte: amount },
          'hierarchy.level': { $gt: user.hierarchy.level || 1 },
          isActive: true
        }).select('firstName lastName hierarchy.approvalLimit hierarchy.level')
          .sort({ 'hierarchy.level': 1 })
          .limit(3);

        return res.status(403).json({
          success: false,
          message: 'Montant dépasse votre limite d\'approbation',
          code: 'AMOUNT_EXCEEDS_LIMIT',
          details: {
            requestedAmount: amount,
            userLimit: approvalLimit,
            excess: amount - approvalLimit
          },
          suggestions: higherApprovers.length > 0 ? {
            message: 'Approbateurs disponibles pour ce montant',
            approvers: higherApprovers.map(approver => ({
              name: `${approver.firstName} ${approver.lastName}`,
              limit: approver.hierarchy.approvalLimit,
              level: approver.hierarchy.level
            }))
          } : {
            message: 'Aucun approbateur trouvé pour ce montant',
            action: 'Contactez votre administrateur d\'entreprise'
          }
        });
      }

      // Vérifier les règles d'entreprise
      if (user.company.settings?.requireApproval && 
          amount < user.company.settings.approvalLimit) {
        req.approvalCheck = {
          amount,
          canApprove: true,
          autoApprove: true,
          reason: 'Montant sous le seuil d\'approbation entreprise'
        };
        return next();
      }

      // Ajouter les informations de vérification à la requête
      req.approvalCheck = {
        amount,
        canApprove: true,
        userLimit: approvalLimit,
        remainingLimit: approvalLimit - amount,
        approvalLevel: user.hierarchy.level || 1,
        userType: user.userType,
        companySettings: {
          requireApproval: user.company.settings?.requireApproval || false,
          approvalLimit: user.company.settings?.approvalLimit || 0
        }
      };

      next();

    } catch (error) {
      console.error('Erreur middleware checkApprovalLimit:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification des limites d\'approbation',
        code: 'APPROVAL_LIMIT_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier l'accès à une entreprise spécifique
 * @param {string} companyIdField - Champ contenant l'ID entreprise (défaut: 'companyId')
 * @param {string} source - Source de l'ID ('params', 'body', 'query')
 * @returns {Function} Middleware de vérification
 */
const requireCompanyAccess = (companyIdField = 'companyId', source = 'params') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Extraire l'ID entreprise
      const companyId = req[source][companyIdField];
      
      if (!companyId) {
        return res.status(400).json({
          success: false,
          message: `Paramètre ${companyIdField} requis`,
          code: 'MISSING_COMPANY_ID'
        });
      }

      // Admin système peut accéder à toutes les entreprises
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Vérifier que l'utilisateur appartient à cette entreprise
      if (!req.user.company || req.user.company._id.toString() !== companyId) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cette entreprise',
          code: 'COMPANY_ACCESS_DENIED',
          hint: 'Vous ne pouvez accéder qu\'aux ressources de votre entreprise'
        });
      }

      // Vérifier que l'entreprise est active
      if (req.user.company.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Entreprise non active',
          code: 'COMPANY_INACTIVE',
          status: req.user.company.status
        });
      }

      next();

    } catch (error) {
      console.error('Erreur middleware requireCompanyAccess:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification d\'accès entreprise',
        code: 'COMPANY_ACCESS_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier l'accès à une demande d'approbation
 * @returns {Function} Middleware de vérification
 */
const requireApprovalAccess = () => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      const approvalId = req.params.approvalId || req.params.id;
      
      if (!approvalId) {
        return res.status(400).json({
          success: false,
          message: 'ID de demande d\'approbation requis',
          code: 'MISSING_APPROVAL_ID'
        });
      }

      // Récupérer la demande d'approbation
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('requester', 'firstName lastName company')
        .populate('company', 'name status')
        .populate('approvalChain.approver', 'firstName lastName');

      if (!approval) {
        return res.status(404).json({
          success: false,
          message: 'Demande d\'approbation non trouvée',
          code: 'APPROVAL_NOT_FOUND'
        });
      }

      // Admin système peut accéder à tout
      if (req.user.role === 'ADMIN') {
        req.approval = approval;
        return next();
      }

      // Vérifier l'accès selon le rôle utilisateur
      let hasAccess = false;
      let accessReason = '';

      // Le demandeur peut voir sa propre demande
      if (approval.requester._id.toString() === req.user.userId.toString()) {
        hasAccess = true;
        accessReason = 'Demandeur';
      }
      
      // Les approbateurs peuvent voir les demandes qui leur sont assignées
      else if (approval.approvalChain.some(step => 
        step.approver._id.toString() === req.user.userId.toString()
      )) {
        hasAccess = true;
        accessReason = 'Approbateur assigné';
      }
      
      // Les admins d'entreprise peuvent voir toutes les demandes de leur entreprise
      else if (req.user.userType === 'company_admin' && 
               req.user.company && 
               approval.company._id.toString() === req.user.company._id.toString()) {
        hasAccess = true;
        accessReason = 'Administrateur d\'entreprise';
      }

      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Accès non autorisé à cette demande d\'approbation',
          code: 'APPROVAL_ACCESS_DENIED',
          hint: 'Vous ne pouvez accéder qu\'aux demandes vous concernant'
        });
      }

      // Vérifier que l'entreprise est active
      if (approval.company.status !== 'active') {
        return res.status(403).json({
          success: false,
          message: 'Entreprise non active',
          code: 'APPROVAL_COMPANY_INACTIVE',
          hint: 'L\'entreprise associée à cette demande n\'est pas active'
        });
      }

      // Ajouter les informations à la requête
      req.approval = approval;
      req.approvalAccess = {
        hasAccess: true,
        reason: accessReason,
        canModify: accessReason === 'Demandeur' || accessReason === 'Administrateur d\'entreprise',
        canApprove: approval.approvalChain.some(step => 
          step.approver._id.toString() === req.user.userId.toString() && 
          step.level === approval.currentLevel &&
          step.status === 'pending'
        )
      };

      next();

    } catch (error) {
      console.error('Erreur middleware requireApprovalAccess:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification d\'accès à l\'approbation',
        code: 'APPROVAL_ACCESS_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier les permissions granulaires
 * @param {string} permission - Permission requise
 * @param {Object} options - Options de configuration
 * @returns {Function} Middleware de vérification
 */
const requirePermission = (permission, options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      // Admin système a toutes les permissions
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Vérifier la permission de base
      if (!req.user.permissions || !req.user.permissions[permission]) {
        return res.status(403).json({
          success: false,
          message: `Permission ${permission} requise`,
          code: 'MISSING_PERMISSION',
          required: permission,
          hint: 'Contactez votre administrateur pour obtenir cette permission'
        });
      }

      // Vérifications supplémentaires selon la permission
      switch (permission) {
        case 'canBook':
          if (options.amount && req.user.permissions.maxBookingAmount) {
            if (options.amount > req.user.permissions.maxBookingAmount) {
              return res.status(403).json({
                success: false,
                message: 'Montant dépasse votre limite de réservation',
                code: 'BOOKING_AMOUNT_EXCEEDED',
                details: {
                  requestedAmount: options.amount,
                  maxAllowed: req.user.permissions.maxBookingAmount
                }
              });
            }
          }
          break;

        case 'canApprove':
          if (options.amount && req.user.hierarchy?.approvalLimit) {
            if (options.amount > req.user.hierarchy.approvalLimit) {
              return res.status(403).json({
                success: false,
                message: 'Montant dépasse votre limite d\'approbation',
                code: 'APPROVAL_AMOUNT_EXCEEDED',
                details: {
                  requestedAmount: options.amount,
                  maxAllowed: req.user.hierarchy.approvalLimit
                }
              });
            }
          }
          break;

        case 'canViewReports':
          if (req.user.userType === 'employee' && !req.user.permissions.canViewReports) {
            return res.status(403).json({
              success: false,
              message: 'Accès aux rapports non autorisé pour les employés standard',
              code: 'REPORTS_ACCESS_DENIED'
            });
          }
          break;
      }

      next();

    } catch (error) {
      console.error('Erreur middleware requirePermission:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification des permissions',
        code: 'PERMISSION_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Vérifier la hiérarchie (que l'utilisateur peut gérer la ressource)
 * @param {string} targetUserField - Champ contenant l'ID utilisateur cible
 * @param {string} source - Source de l'ID ('params', 'body', 'query')
 * @returns {Function} Middleware de vérification
 */
const requireHierarchyAccess = (targetUserField = 'userId', source = 'params') => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Authentification requise',
          code: 'AUTHENTICATION_REQUIRED'
        });
      }

      const targetUserId = req[source][targetUserField];
      
      if (!targetUserId) {
        return res.status(400).json({
          success: false,
          message: `Paramètre ${targetUserField} requis`,
          code: 'MISSING_TARGET_USER_ID'
        });
      }

      // Admin système peut gérer tout le monde
      if (req.user.role === 'ADMIN') {
        return next();
      }

      // Utilisateur peut se gérer lui-même
      if (req.user.userId.toString() === targetUserId) {
        return next();
      }

      // Vérifier la hiérarchie d'entreprise
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Gestion hiérarchique réservée aux utilisateurs d\'entreprise',
          code: 'NOT_COMPANY_USER'
        });
      }

      // Récupérer l'utilisateur cible
      const targetUser = await User.findById(targetUserId)
        .select('company hierarchy userType')
        .populate('company', '_id');

      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Utilisateur cible non trouvé',
          code: 'TARGET_USER_NOT_FOUND'
        });
      }

      // Vérifier que les utilisateurs sont dans la même entreprise
      if (!targetUser.company || 
          targetUser.company._id.toString() !== req.user.company._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Gestion possible uniquement au sein de la même entreprise',
          code: 'DIFFERENT_COMPANY'
        });
      }

      // Admin d'entreprise peut gérer tous les employés de son entreprise
      if (req.user.userType === 'company_admin') {
        return next();
      }

      // Manager peut gérer ses subordonnés directs
      if (req.user.userType === 'manager' && req.user.permissions?.canManageTeam) {
        // Vérifier si l'utilisateur cible est un subordonné
        if (targetUser.hierarchy?.manager?.toString() === req.user.userId.toString()) {
          return next();
        }
        
        // Ou si le manager a un niveau hiérarchique supérieur
        const userLevel = req.user.hierarchy?.level || 1;
        const targetLevel = targetUser.hierarchy?.level || 1;
        
        if (userLevel > targetLevel) {
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        message: 'Vous n\'avez pas l\'autorité hiérarchique sur cet utilisateur',
        code: 'INSUFFICIENT_HIERARCHY_LEVEL',
        hint: 'Seuls les managers directs ou admins peuvent gérer cet utilisateur'
      });

    } catch (error) {
      console.error('Erreur middleware requireHierarchyAccess:', error);
      
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la vérification hiérarchique',
        code: 'HIERARCHY_CHECK_ERROR'
      });
    }
  };
};

/**
 * Middleware - Limitation de débit (Rate Limiting) avancé pour entreprises
 * @param {Object} limits - Limites par type d'utilisateur
 * @param {number} windowMs - Fenêtre de temps en millisecondes
 * @returns {Function} Middleware de rate limiting
 */
const enterpriseRateLimit = (limits = {}, windowMs = 15 * 60 * 1000) => {
  const requests = new Map();
  
  const defaultLimits = {
    employee: 100,
    manager: 200,
    company_admin: 500,
    CLIENT: 50,
    RECEPTIONIST: 300,
    ADMIN: 1000
  };

  return (req, res, next) => {
    try {
      const identifier = req.user ? req.user.userId : req.ip;
      const userType = req.user?.userType || req.user?.role || 'anonymous';
      
      // Déterminer la limite applicable
      const limit = limits[userType] || defaultLimits[userType] || defaultLimits.employee;
      
      const now = Date.now();
      
      // Nettoyer les anciennes entrées
      requests.forEach((data, key) => {
        if (now - data.firstRequest > windowMs) {
          requests.delete(key);
        }
      });

      // Obtenir ou créer l'entrée pour cet utilisateur
      let userRequests = requests.get(identifier);
      
      if (!userRequests) {
        userRequests = {
          count: 0,
          firstRequest: now,
          userType: userType
        };
        requests.set(identifier, userRequests);
      }

      // Vérifier la limite
      if (userRequests.count >= limit) {
        const resetTime = userRequests.firstRequest + windowMs;
        const resetIn = Math.ceil((resetTime - now) / 1000);
        
        return res.status(429).json({
          success: false,
          message: 'Limite de requêtes dépassée',
          code: 'RATE_LIMIT_EXCEEDED',
          details: {
            limit: limit,
            userType: userType,
            windowMs: windowMs,
            resetIn: `${resetIn} secondes`
          },
          hint: 'Attendez avant de refaire une requête ou contactez le support pour augmenter vos limites'
        });
      }

      // Incrémenter le compteur
      userRequests.count++;

      // Ajouter les headers de rate limiting
      res.set({
        'X-RateLimit-Limit': limit,
        'X-RateLimit-Remaining': limit - userRequests.count,
        'X-RateLimit-Reset': new Date(userRequests.firstRequest + windowMs).toISOString(),
        'X-RateLimit-Type': userType
      });

      next();

    } catch (error) {
      console.error('Erreur middleware enterpriseRateLimit:', error);
      next(); // En cas d'erreur, laisser passer
    }
  };
};

/**
 * Middleware de logging des accès authentifiés avec contexte entreprise
 */
const logAuthenticatedAccess = (req, res, next) => {
  if (req.user) {
    const logData = {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.originalUrl,
      user: {
        id: req.user.userId,
        email: req.user.email,
        role: req.user.role,
        userType: req.user.userType,
        company: req.user.company?.name || 'N/A'
      },
      ip: req.ip,
      userAgent: req.get('User-Agent')
    };
    
    console.log(`[ENTERPRISE-ACCESS] ${JSON.stringify(logData)}`);
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

// ============================================================================
// HELPERS ET UTILITAIRES ENTREPRISE
// ============================================================================

/**
 * Helper - Vérifier si un utilisateur peut approuver un montant spécifique
 * @param {Object} user - Objet utilisateur
 * @param {number} amount - Montant à vérifier
 * @returns {Object} Résultat de la vérification
 */
const canUserApprove = (user, amount) => {
  if (!user) {
    return { canApprove: false, reason: 'Utilisateur non défini' };
  }

  if (user.role === 'ADMIN') {
    return { canApprove: true, reason: 'Administrateur système' };
  }

  if (!user.permissions?.canApprove) {
    return { canApprove: false, reason: 'Permission d\'approbation manquante' };
  }

  if (!user.hierarchy?.canApprove) {
    return { canApprove: false, reason: 'Approbation désactivée dans la hiérarchie' };
  }

  const approvalLimit = user.hierarchy?.approvalLimit || 0;
  if (amount > approvalLimit) {
    return { 
      canApprove: false, 
      reason: 'Montant dépasse la limite',
      limit: approvalLimit,
      excess: amount - approvalLimit
    };
  }

  return { 
    canApprove: true, 
    reason: 'Autorisation accordée',
    limit: approvalLimit,
    remaining: approvalLimit - amount
  };
};

/**
 * Helper - Obtenir la chaîne d'approbation pour un montant
 * @param {string} companyId - ID de l'entreprise
 * @param {number} amount - Montant nécessitant approbation
 * @returns {Promise<Array>} Liste des approbateurs possibles
 */
const getApprovalChain = async (companyId, amount) => {
  try {
    const approvers = await User.find({
      company: companyId,
      'permissions.canApprove': true,
      'hierarchy.canApprove': true,
      'hierarchy.approvalLimit': { $gte: amount },
      isActive: true
    }).select('firstName lastName hierarchy.approvalLimit hierarchy.level userType')
      .sort({ 'hierarchy.level': 1, 'hierarchy.approvalLimit': 1 });

    return approvers.map(user => ({
      userId: user._id,
      name: `${user.firstName} ${user.lastName}`,
      limit: user.hierarchy.approvalLimit,
      level: user.hierarchy.level,
      type: user.userType
    }));

  } catch (error) {
    console.error('Erreur récupération chaîne approbation:', error);
    return [];
  }
};

/**
 * Helper - Vérifier les permissions entreprise complexes
 * @param {Object} user - Utilisateur
 * @param {string} action - Action à vérifier
 * @param {Object} context - Contexte additionnel
 * @returns {Object} Résultat de la vérification
 */
const checkEnterprisePermission = (user, action, context = {}) => {
  if (!user) {
    return { allowed: false, reason: 'Utilisateur non défini' };
  }

  // Admin système peut tout faire
  if (user.role === 'ADMIN') {
    return { allowed: true, reason: 'Administrateur système' };
  }

  // Vérifications par action
  switch (action) {
    case 'manage_company_users':
      if (user.userType === 'company_admin' && user.permissions?.canManageTeam) {
        return { allowed: true, reason: 'Administrateur d\'entreprise' };
      }
      return { allowed: false, reason: 'Seuls les administrateurs d\'entreprise peuvent gérer les utilisateurs' };

    case 'approve_booking':
      return canUserApprove(user, context.amount || 0);

    case 'view_company_reports':
      if (['company_admin', 'manager'].includes(user.userType) && user.permissions?.canViewReports) {
        return { allowed: true, reason: 'Permission de consultation des rapports' };
      }
      return { allowed: false, reason: 'Permission de consultation des rapports requise' };

    case 'modify_booking_limits':
      if (user.userType === 'company_admin' && user.permissions?.canManageTeam) {
        return { allowed: true, reason: 'Administrateur d\'entreprise' };
      }
      return { allowed: false, reason: 'Modification des limites réservée aux administrateurs' };

    case 'access_financials':
      if (user.permissions?.canAccessFinancials) {
        return { allowed: true, reason: 'Permission d\'accès financier' };
      }
      return { allowed: false, reason: 'Accès aux données financières non autorisé' };

    default:
      return { allowed: false, reason: `Action non reconnue: ${action}` };
  }
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Middlewares principaux (existants)
  authenticateToken,
  authorizeRoles,
  optionalAuth,
  
  // Middlewares spécialisés (existants)
  requireEmailVerification,
  requireOwnership,
  
  // Nouveaux middlewares entreprise
  isCompanyAdmin,
  isManager,
  checkApprovalLimit,
  requireCompanyAccess,
  requireApprovalAccess,
  requirePermission,
  requireHierarchyAccess,
  
  // Utilitaires
  enterpriseRateLimit,
  logAuthenticatedAccess,
  combineAuthMiddlewares,
  
  // Helpers
  canUserApprove,
  getApprovalChain,
  checkEnterprisePermission,
  
  // Raccourcis pour les rôles courants
  requireAdmin: authorizeRoles('ADMIN'),
  requireReceptionist: authorizeRoles('RECEPTIONIST', 'ADMIN'),
  requireClient: authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN'),
  
  // Nouveaux raccourcis entreprise
  requireCompanyAdmin: combineAuthMiddlewares(authenticateToken, isCompanyAdmin()),
  requireManagerAccess: combineAuthMiddlewares(authenticateToken, isManager()),
  requireEnterpriseUser: combineAuthMiddlewares(
    authenticateToken, 
    (req, res, next) => {
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux utilisateurs d\'entreprise',
          code: 'NOT_ENTERPRISE_USER'
        });
      }
      next();
    }
  ),
  
  // Raccourcis combinés fréquents
  authRequired: combineAuthMiddlewares(authenticateToken),
  adminRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('ADMIN')),
  receptionistRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('RECEPTIONIST', 'ADMIN')),
  clientRequired: combineAuthMiddlewares(authenticateToken, authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN')),
  verifiedUserRequired: combineAuthMiddlewares(authenticateToken, requireEmailVerification),
  
  // Raccourcis entreprise avec vérifications
  companyAdminRequired: combineAuthMiddlewares(
    authenticateToken,
    isCompanyAdmin(),
    logAuthenticatedAccess
  ),
  
  managerRequired: combineAuthMiddlewares(
    authenticateToken,
    isManager(),
    logAuthenticatedAccess
  ),
  
  approvalRequired: (amountField = 'amount', source = 'body') => combineAuthMiddlewares(
    authenticateToken,
    isManager(),
    checkApprovalLimit({ amountField, source }),
    logAuthenticatedAccess
  ),
  
  enterpriseRequired: combineAuthMiddlewares(
    authenticateToken,
    (req, res, next) => {
      if (!req.user.company) {
        return res.status(403).json({
          success: false,
          message: 'Accès réservé aux utilisateurs d\'entreprise',
          code: 'NOT_ENTERPRISE_USER'
        });
      }
      next();
    },
    enterpriseRateLimit(),
    logAuthenticatedAccess
  )
};