const { body, param, validationResult } = require('express-validator');
const User = require('../models/User');

/**
 * Middleware pour gérer les erreurs de validation
 * Centralise le traitement des erreurs de express-validator
 */
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map(error => ({
      field: error.path || error.param,
      message: error.msg,
      value: error.value,
      location: error.location
    }));

    return res.status(400).json({
      success: false,
      message: 'Erreur de validation des données',
      errors: formattedErrors,
      code: 'VALIDATION_ERROR'
    });
  }
  
  next();
};

/**
 * Sanitisation des données d'entrée
 * Nettoie et normalise les données avant validation
 */
const sanitizeInput = [
  // Nettoyer les espaces et normaliser les emails
  body('email').optional().toLowerCase().trim(),
  body('firstName').optional().trim(),
  body('lastName').optional().trim(),
  body('companyName').optional().trim(),
  body('phone').optional().trim().customSanitizer(value => {
    // Normaliser les numéros de téléphone français
    if (value && typeof value === 'string') {
      // Supprimer tous les espaces, points, tirets
      let cleaned = value.replace(/[\s.-]/g, '');
      // Remplacer +33 par 0
      if (cleaned.startsWith('+33')) {
        cleaned = '0' + cleaned.substring(3);
      }
      return cleaned;
    }
    return value;
  }),
  body('siret').optional().trim().customSanitizer(value => {
    // Supprimer tous les espaces du SIRET
    return value ? value.replace(/\s/g, '') : value;
  })
];

/**
 * Validation pour l'inscription
 */
const validateRegister = [
  ...sanitizeInput,
  
  // Prénom
  body('firstName')
    .notEmpty()
    .withMessage('Le prénom est requis')
    .isLength({ min: 2, max: 50 })
    .withMessage('Le prénom doit contenir entre 2 et 50 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage('Le prénom ne peut contenir que des lettres, espaces, apostrophes et tirets'),

  // Nom
  body('lastName')
    .notEmpty()
    .withMessage('Le nom est requis')
    .isLength({ min: 2, max: 50 })
    .withMessage('Le nom doit contenir entre 2 et 50 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage('Le nom ne peut contenir que des lettres, espaces, apostrophes et tirets'),

  // Email
  body('email')
    .notEmpty()
    .withMessage('L\'adresse email est requise')
    .isEmail()
    .withMessage('Veuillez entrer une adresse email valide')
    .isLength({ max: 100 })
    .withMessage('L\'adresse email ne peut pas dépasser 100 caractères')
    .custom(async (email) => {
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        throw new Error('Cette adresse email est déjà utilisée');
      }
      return true;
    }),

  // Mot de passe
  body('password')
    .notEmpty()
    .withMessage('Le mot de passe est requis')
    .isLength({ min: 6, max: 100 })
    .withMessage('Le mot de passe doit contenir entre 6 et 100 caractères')
    .custom((password) => {
      // Vérification de la complexité du mot de passe
      const hasLowerCase = /[a-z]/.test(password);
      const hasUpperCase = /[A-Z]/.test(password);
      const hasNumbers = /\d/.test(password);
      const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(password);
      
      let strength = 0;
      if (hasLowerCase) strength++;
      if (hasUpperCase) strength++;
      if (hasNumbers) strength++;
      if (hasSpecialChars) strength++;
      
      if (password.length >= 8 && strength >= 3) {
        return true; // Mot de passe fort
      } else if (password.length >= 6) {
        return true; // Mot de passe acceptable
      } else {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères');
      }
    }),

  // Téléphone
  body('phone')
    .notEmpty()
    .withMessage('Le numéro de téléphone est requis')
    .matches(/^(0[1-9])(\d{8})$/)
    .withMessage('Veuillez entrer un numéro de téléphone français valide (format: 0123456789)'),

  // Rôle (optionnel)
  body('role')
    .optional()
    .isIn(['CLIENT', 'RECEPTIONIST', 'ADMIN'])
    .withMessage('Le rôle doit être CLIENT, RECEPTIONIST ou ADMIN'),

  // Nom d'entreprise (optionnel)
  body('companyName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Le nom de l\'entreprise doit contenir entre 2 et 100 caractères')
    .matches(/^[a-zA-ZÀ-ÿ0-9\s.,-]+$/)
    .withMessage('Le nom de l\'entreprise contient des caractères non autorisés'),

  // SIRET (optionnel)
  body('siret')
    .optional()
    .matches(/^\d{14}$/)
    .withMessage('Le numéro SIRET doit contenir exactement 14 chiffres')
    .custom(async (siret) => {
      if (siret) {
        const existingUser = await User.findOne({ siret });
        if (existingUser) {
          throw new Error('Ce numéro SIRET est déjà utilisé');
        }
      }
      return true;
    }),

  // Validation de cohérence entreprise
  body().custom((value) => {
    const { companyName, siret } = value;
    
    // Si SIRET fourni, nom d'entreprise requis
    if (siret && !companyName) {
      throw new Error('Le nom de l\'entreprise est requis lorsque le SIRET est fourni');
    }
    
    // Si nom d'entreprise fourni, SIRET recommandé mais pas obligatoire
    return true;
  }),

  handleValidationErrors
];

/**
 * Validation pour la connexion
 */
const validateLogin = [
  ...sanitizeInput,
  
  // Email
  body('email')
    .notEmpty()
    .withMessage('L\'adresse email est requise')
    .isEmail()
    .withMessage('Veuillez entrer une adresse email valide'),

  // Mot de passe
  body('password')
    .notEmpty()
    .withMessage('Le mot de passe est requis')
    .isLength({ min: 1, max: 100 })
    .withMessage('Le mot de passe ne peut pas être vide'),

  // Remember me (optionnel)
  body('rememberMe')
    .optional()
    .isBoolean()
    .withMessage('Remember me doit être un booléen'),

  handleValidationErrors
];

/**
 * Validation pour l'email uniquement
 */
const validateEmail = [
  ...sanitizeInput,
  
  body('email')
    .notEmpty()
    .withMessage('L\'adresse email est requise')
    .isEmail()
    .withMessage('Veuillez entrer une adresse email valide')
    .isLength({ max: 100 })
    .withMessage('L\'adresse email ne peut pas dépasser 100 caractères'),

  handleValidationErrors
];

/**
 * Validation pour le refresh token
 */
const validateRefreshToken = [
  body('refreshToken')
    .notEmpty()
    .withMessage('Le refresh token est requis')
    .isJWT()
    .withMessage('Le refresh token doit être un JWT valide'),

  handleValidationErrors
];

/**
 * Validation pour la réinitialisation du mot de passe
 */
const validateResetPassword = [
  // Token dans l'URL
  param('token')
    .notEmpty()
    .withMessage('Le token de réinitialisation est requis')
    .isLength({ min: 32, max: 100 })
    .withMessage('Token de réinitialisation invalide'),

  // Nouveau mot de passe
  body('password')
    .notEmpty()
    .withMessage('Le nouveau mot de passe est requis')
    .isLength({ min: 6, max: 100 })
    .withMessage('Le mot de passe doit contenir entre 6 et 100 caractères')
    .custom((password) => {
      // Même validation que pour l'inscription
      const hasLowerCase = /[a-z]/.test(password);
      const hasUpperCase = /[A-Z]/.test(password);
      const hasNumbers = /\d/.test(password);
      const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(password);
      
      let strength = 0;
      if (hasLowerCase) strength++;
      if (hasUpperCase) strength++;
      if (hasNumbers) strength++;
      if (hasSpecialChars) strength++;
      
      if (password.length >= 6) {
        return true;
      } else {
        throw new Error('Le mot de passe doit contenir au moins 6 caractères');
      }
    }),

  // Confirmation mot de passe
  body('confirmPassword')
    .notEmpty()
    .withMessage('La confirmation du mot de passe est requise')
    .custom((confirmPassword, { req }) => {
      if (confirmPassword !== req.body.password) {
        throw new Error('Les mots de passe ne correspondent pas');
      }
      return true;
    }),

  handleValidationErrors
];

/**
 * Validation pour le changement de mot de passe
 */
const validateChangePassword = [
  // Mot de passe actuel
  body('currentPassword')
    .notEmpty()
    .withMessage('Le mot de passe actuel est requis'),

  // Nouveau mot de passe
  body('newPassword')
    .notEmpty()
    .withMessage('Le nouveau mot de passe est requis')
    .isLength({ min: 6, max: 100 })
    .withMessage('Le nouveau mot de passe doit contenir entre 6 et 100 caractères')
    .custom((newPassword, { req }) => {
      // Vérifier que le nouveau mot de passe est différent de l'ancien
      if (newPassword === req.body.currentPassword) {
        throw new Error('Le nouveau mot de passe doit être différent du mot de passe actuel');
      }
      
      // Validation de la complexité
      const hasLowerCase = /[a-z]/.test(newPassword);
      const hasUpperCase = /[A-Z]/.test(newPassword);
      const hasNumbers = /\d/.test(newPassword);
      const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
      
      let strength = 0;
      if (hasLowerCase) strength++;
      if (hasUpperCase) strength++;
      if (hasNumbers) strength++;
      if (hasSpecialChars) strength++;
      
      return true;
    }),

  // Confirmation nouveau mot de passe
  body('confirmPassword')
    .notEmpty()
    .withMessage('La confirmation du nouveau mot de passe est requise')
    .custom((confirmPassword, { req }) => {
      if (confirmPassword !== req.body.newPassword) {
        throw new Error('Les nouveaux mots de passe ne correspondent pas');
      }
      return true;
    }),

  handleValidationErrors
];

/**
 * Validation pour les tokens d'URL (email verification, reset password)
 */
const validateToken = [
  param('token')
    .notEmpty()
    .withMessage('Le token est requis')
    .isLength({ min: 32, max: 100 })
    .withMessage('Format de token invalide')
    .matches(/^[a-fA-F0-9]+$/)
    .withMessage('Le token ne peut contenir que des caractères hexadécimaux'),

  handleValidationErrors
];

/**
 * Validation pour les paramètres utilisateur (routes admin)
 */
const validateUserParams = [
  param('userId')
    .notEmpty()
    .withMessage('L\'ID utilisateur est requis')
    .isMongoId()
    .withMessage('ID utilisateur invalide'),

  handleValidationErrors
];

/**
 * Validation pour la mise à jour du profil
 */
const validateProfileUpdate = [
  ...sanitizeInput,
  
  // Tous les champs sont optionnels pour la mise à jour
  body('firstName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Le prénom doit contenir entre 2 et 50 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage('Le prénom ne peut contenir que des lettres, espaces, apostrophes et tirets'),

  body('lastName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Le nom doit contenir entre 2 et 50 caractères')
    .matches(/^[a-zA-ZÀ-ÿ\s'-]+$/)
    .withMessage('Le nom ne peut contenir que des lettres, espaces, apostrophes et tirets'),

  body('phone')
    .optional()
    .matches(/^(0[1-9])(\d{8})$/)
    .withMessage('Veuillez entrer un numéro de téléphone français valide'),

  body('companyName')
    .optional()
    .isLength({ min: 2, max: 100 })
    .withMessage('Le nom de l\'entreprise doit contenir entre 2 et 100 caractères'),

  body('siret')
    .optional()
    .matches(/^\d{14}$/)
    .withMessage('Le numéro SIRET doit contenir exactement 14 chiffres')
    .custom(async (siret, { req }) => {
      if (siret) {
        const existingUser = await User.findOne({ 
          siret, 
          _id: { $ne: req.user.userId } // Exclure l'utilisateur actuel
        });
        if (existingUser) {
          throw new Error('Ce numéro SIRET est déjà utilisé');
        }
      }
      return true;
    }),

  // Validation des préférences
  body('preferences.language')
    .optional()
    .isIn(['fr', 'en'])
    .withMessage('La langue doit être fr ou en'),

  body('preferences.notifications.email')
    .optional()
    .isBoolean()
    .withMessage('La préférence email doit être un booléen'),

  body('preferences.notifications.sms')
    .optional()
    .isBoolean()
    .withMessage('La préférence SMS doit être un booléen'),

  handleValidationErrors
];

/**
 * Validation pour les données de réservation (à utiliser avec le booking controller)
 */
const validateBookingData = [
  body('hotelId')
    .notEmpty()
    .withMessage('L\'ID de l\'hôtel est requis')
    .isMongoId()
    .withMessage('ID d\'hôtel invalide'),

  body('checkIn')
    .notEmpty()
    .withMessage('La date d\'arrivée est requise')
    .isISO8601()
    .withMessage('Format de date d\'arrivée invalide')
    .custom((checkIn) => {
      const checkInDate = new Date(checkIn);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      if (checkInDate < today) {
        throw new Error('La date d\'arrivée ne peut pas être dans le passé');
      }
      return true;
    }),

  body('checkOut')
    .notEmpty()
    .withMessage('La date de départ est requise')
    .isISO8601()
    .withMessage('Format de date de départ invalide')
    .custom((checkOut, { req }) => {
      const checkOutDate = new Date(checkOut);
      const checkInDate = new Date(req.body.checkIn);
      
      if (checkOutDate <= checkInDate) {
        throw new Error('La date de départ doit être postérieure à la date d\'arrivée');
      }
      
      // Vérifier que le séjour ne dépasse pas 30 nuits
      const diffTime = checkOutDate - checkInDate;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays > 30) {
        throw new Error('La durée du séjour ne peut pas dépasser 30 nuits');
      }
      
      return true;
    }),

  body('rooms')
    .isArray({ min: 1, max: 5 })
    .withMessage('Au moins 1 chambre et maximum 5 chambres par réservation'),

  body('rooms.*.roomId')
    .notEmpty()
    .withMessage('L\'ID de la chambre est requis')
    .isMongoId()
    .withMessage('ID de chambre invalide'),

  body('totalGuests.adults')
    .isInt({ min: 1, max: 20 })
    .withMessage('Nombre d\'adultes doit être entre 1 et 20'),

  body('totalGuests.children')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Nombre d\'enfants doit être entre 0 et 10'),

  handleValidationErrors
];

/**
 * Utilitaire pour valider les objets MongoDB
 */
const validateObjectId = (fieldName) => [
  param(fieldName)
    .notEmpty()
    .withMessage(`${fieldName} est requis`)
    .isMongoId()
    .withMessage(`${fieldName} invalide`),
  
  handleValidationErrors
];

/**
 * Middleware de validation personnalisée
 * Permet de créer des validations spécifiques au contexte
 */
const customValidation = (validationFn, errorMessage) => {
  return (req, res, next) => {
    try {
      const isValid = validationFn(req.body, req.params, req.query, req.user);
      
      if (!isValid) {
        return res.status(400).json({
          success: false,
          message: errorMessage,
          code: 'CUSTOM_VALIDATION_ERROR'
        });
      }
      
      next();
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: error.message || errorMessage,
        code: 'CUSTOM_VALIDATION_ERROR'
      });
    }
  };
};

/**
 * Middleware pour logger les erreurs de validation
 */
const logValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    console.log(`[${new Date().toISOString()}] Validation Error on ${req.method} ${req.originalUrl}:`, 
      errors.array().map(err => `${err.path}: ${err.msg}`).join(', ')
    );
  }
  
  next();
};

module.exports = {
  // Middlewares principaux
  validateRegister,
  validateLogin,
  validateEmail,
  validateRefreshToken,
  validateResetPassword,
  validateChangePassword,
  validateToken,
  validateUserParams,
  validateProfileUpdate,
  validateBookingData,
  
  // Utilitaires
  validateObjectId,
  customValidation,
  sanitizeInput,
  handleValidationErrors,
  logValidationErrors,
  
  // Validations spécifiques réutilisables
  emailValidation: [
    body('email')
      .isEmail()
      .withMessage('Email invalide')
      .toLowerCase()
      .trim()
  ],
  
  passwordValidation: [
    body('password')
      .isLength({ min: 6 })
      .withMessage('Mot de passe minimum 6 caractères')
  ],
  
  phoneValidation: [
    body('phone')
      .matches(/^(0[1-9])(\d{8})$/)
      .withMessage('Numéro de téléphone français invalide')
  ],
  
  // Configuration des messages d'erreur
  errorMessages: {
    REQUIRED: 'Ce champ est requis',
    INVALID_EMAIL: 'Adresse email invalide',
    INVALID_PHONE: 'Numéro de téléphone invalide', 
    PASSWORD_TOO_SHORT: 'Mot de passe trop court (minimum 6 caractères)',
    PASSWORDS_DONT_MATCH: 'Les mots de passe ne correspondent pas',
    INVALID_DATE: 'Format de date invalide',
    INVALID_OBJECT_ID: 'ID invalide'
  }
};