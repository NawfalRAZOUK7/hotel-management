/**
 * ROUTES HOTELS - SÉCURISÉES ADMIN UNIQUEMENT
 * Gestion complète des hôtels avec middleware d'authentification et validation
 * 
 * Toutes les routes nécessitent :
 * - Authentification JWT valide
 * - Rôle ADMIN
 * - Validation des données selon le contexte
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Middleware d'authentification et autorisation
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');

// Middleware de validation
const { 
  validateHotelCreation,
  validateHotelUpdate,
  validateSeasonalPricing,
  validatePriceCalculation,
  validatePagination,
  validateImageUpload
} = require('../middleware/validation');

// Controllers
const {
  createHotel,
  getAllHotels,
  getHotelById,
  updateHotel,
  deleteHotel,
  uploadHotelImages,
  deleteHotelImage,
  getHotelStats,
  getSeasonalPricing,
  updateSeasonalPricing,
  calculateHotelPrice
} = require('../controllers/hotelController');

const { USER_ROLES, BUSINESS_RULES } = require('../utils/constants');

/**
 * ================================
 * CONFIGURATION UPLOAD IMAGES
 * ================================
 */

// Créer le dossier uploads s'il n'existe pas
const uploadDir = 'uploads/hotels';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configuration Multer pour upload images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Format: hotelId_timestamp_originalname
    const hotelId = req.params.id;
    const timestamp = Date.now();
    const extension = path.extname(file.originalname);
    const filename = `${hotelId}_${timestamp}_${Math.random().toString(36).substring(7)}${extension}`;
    cb(null, filename);
  }
});

// Filtres et limites pour images
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Type de fichier non autorisé. Formats acceptés: JPEG, PNG, WebP'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: BUSINESS_RULES.MAX_IMAGE_SIZE_MB * 1024 * 1024, // Convertir MB en bytes
    files: BUSINESS_RULES.MAX_HOTEL_IMAGES
  }
});

/**
 * ================================
 * MIDDLEWARE RATE LIMITING SPÉCIALISÉ
 * ================================
 */

// Rate limiting pour opérations sensibles
const strictRateLimit = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requêtes max
  message: 'Trop de tentatives, réessayez dans 15 minutes'
});

// Rate limiting pour uploads
const uploadRateLimit = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // 20 uploads max
  message: 'Trop d\'uploads, attendez 5 minutes'
});

// Rate limiting standard
const standardRateLimit = rateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 60, // 60 requêtes max
  message: 'Limite de requêtes atteinte'
});

/**
 * ================================
 * MIDDLEWARE ADMIN REQUIRED
 * ================================
 */

// Middleware combiné : Auth + Admin + Rate limit standard
const requireAdmin = [
  standardRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN)
];

// Middleware combiné : Auth + Admin + Rate limit strict
const requireAdminStrict = [
  strictRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN)
];

/**
 * ================================
 * ROUTES CRUD PRINCIPAL
 * ================================
 */

/**
 * @route   POST /api/hotels
 * @desc    Créer un nouveau hôtel
 * @access  Admin uniquement
 * @body    { code, name, address, city, category, ... }
 */
router.post(
  '/',
  requireAdminStrict,
  validateHotelCreation,
  createHotel
);

/**
 * @route   GET /api/hotels
 * @desc    Obtenir tous les hôtels avec pagination et filtres
 * @access  Admin uniquement
 * @query   page, limit, search, category, city, includeStats, sortBy, sortOrder
 */
router.get(
  '/',
  requireAdmin,
  validatePagination,
  getAllHotels
);

/**
 * @route   GET /api/hotels/:id
 * @desc    Obtenir un hôtel par ID
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @query   includeRooms, includeStats
 */
router.get(
  '/:id',
  requireAdmin,
  getHotelById
);

/**
 * @route   PUT /api/hotels/:id
 * @desc    Mettre à jour un hôtel
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @body    Champs à mettre à jour
 */
router.put(
  '/:id',
  requireAdminStrict,
  validateHotelUpdate,
  updateHotel
);

/**
 * @route   DELETE /api/hotels/:id
 * @desc    Supprimer un hôtel
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @query   force - true pour suppression forcée avec cascade
 */
router.delete(
  '/:id',
  requireAdminStrict,
  deleteHotel
);

/**
 * ================================
 * ROUTES GESTION IMAGES
 * ================================
 */

/**
 * @route   POST /api/hotels/:id/upload
 * @desc    Upload images pour un hôtel
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @files   images[] - Fichiers images (max 20, 5MB chacun)
 */
router.post(
  '/:id/upload',
  uploadRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN),
  upload.array('images', BUSINESS_RULES.MAX_HOTEL_IMAGES),
  validateImageUpload,
  uploadHotelImages
);

/**
 * @route   DELETE /api/hotels/:id/images/:imageId
 * @desc    Supprimer une image d'hôtel
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel, imageId - ID de l'image
 */
router.delete(
  '/:id/images/:imageId',
  requireAdminStrict,
  deleteHotelImage
);

/**
 * ================================
 * ROUTES PRICING SAISONNIER
 * ================================
 */

/**
 * @route   GET /api/hotels/:id/pricing
 * @desc    Obtenir la configuration de prix saisonniers
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 */
router.get(
  '/:id/pricing',
  requireAdmin,
  getSeasonalPricing
);

/**
 * @route   PUT /api/hotels/:id/pricing
 * @desc    Mettre à jour les prix saisonniers
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @body    { seasonalPricing: [{ roomType, season, basePrice, multiplier }] }
 */
router.put(
  '/:id/pricing',
  requireAdminStrict,
  validateSeasonalPricing,
  updateSeasonalPricing
);

/**
 * @route   POST /api/hotels/:id/calculate-price
 * @desc    Calculer le prix pour une réservation
 * @access  Admin + Receptionist (pour devis)
 * @params  id - ID de l'hôtel
 * @body    { roomType, checkInDate, checkOutDate, numberOfRooms }
 */
router.post(
  '/:id/calculate-price',
  standardRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST), // Plus permissif pour les devis
  validatePriceCalculation,
  calculateHotelPrice
);

/**
 * ================================
 * ROUTES STATISTIQUES
 * ================================
 */

/**
 * @route   GET /api/hotels/:id/stats
 * @desc    Obtenir les statistiques détaillées d'un hôtel
 * @access  Admin uniquement
 * @params  id - ID de l'hôtel
 * @query   period (7d|30d|90d|1y), startDate, endDate
 */
router.get(
  '/:id/stats',
  requireAdmin,
  getHotelStats
);

/**
 * ================================
 * ROUTES UTILITAIRES
 * ================================
 */

/**
 * @route   GET /api/hotels/:id/availability
 * @desc    Vérifier disponibilité générale d'un hôtel (redirected vers availability)
 * @access  Admin + Receptionist
 * @params  id - ID de l'hôtel
 * @query   checkInDate, checkOutDate, roomType, roomsNeeded
 */
router.get(
  '/:id/availability',
  standardRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { checkAvailability } = require('../utils/availability');
      
      const { checkInDate, checkOutDate, roomType, roomsNeeded = 1 } = req.query;
      
      if (!checkInDate || !checkOutDate) {
        return res.status(400).json({
          success: false,
          message: 'Dates d\'arrivée et de départ requises'
        });
      }

      const availability = await checkAvailability({
        hotelId: req.params.id,
        roomType: roomType || null,
        checkInDate: new Date(checkInDate),
        checkOutDate: new Date(checkOutDate),
        roomsNeeded: parseInt(roomsNeeded)
      });

      res.status(200).json({
        success: true,
        data: availability
      });

    } catch (error) {
      console.error('Erreur vérification disponibilité:', error);
      res.status(500).json({
        success: false,
        message: error.message
      });
    }
  }
);

/**
 * @route   GET /api/hotels/search/suggestions
 * @desc    Suggestions de recherche pour autocomplete
 * @access  Admin + Receptionist  
 * @query   q - terme de recherche
 */
router.get(
  '/search/suggestions',
  standardRateLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST),
  async (req, res) => {
    try {
      const { q } = req.query;
      
      if (!q || q.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Terme de recherche trop court (minimum 2 caractères)'
        });
      }

      const Hotel = require('../models/Hotel');
      
      const suggestions = await Hotel.aggregate([
        {
          $match: {
            $or: [
              { name: { $regex: q, $options: 'i' } },
              { code: { $regex: q, $options: 'i' } },
              { city: { $regex: q, $options: 'i' } }
            ]
          }
        },
        {
          $project: {
            _id: 1,
            name: 1,
            code: 1,
            city: 1,
            category: 1,
            suggestion: {
              $concat: ['$name', ' (', '$code', ') - ', '$city']
            }
          }
        },
        { $limit: 10 },
        { $sort: { name: 1 } }
      ]);

      res.status(200).json({
        success: true,
        data: {
          query: q,
          suggestions,
          count: suggestions.length
        }
      });

    } catch (error) {
      console.error('Erreur suggestions recherche:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur'
      });
    }
  }
);

/**
 * ================================
 * MIDDLEWARE DE GESTION D'ERREURS MULTER
 * ================================
 */

// Gestionnaire d'erreurs spécifique pour Multer
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        message: `Fichier trop volumineux. Taille maximum: ${BUSINESS_RULES.MAX_IMAGE_SIZE_MB}MB`
      });
    }
    
    if (error.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        message: `Trop de fichiers. Maximum: ${BUSINESS_RULES.MAX_HOTEL_IMAGES} images`
      });
    }
    
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Champ de fichier inattendu. Utilisez le champ "images"'
      });
    }
  }
  
  if (error.message.includes('Type de fichier non autorisé')) {
    return res.status(400).json({
      success: false,
      message: error.message
    });
  }
  
  // Passer l'erreur au gestionnaire global
  next(error);
});

/**
 * ================================
 * DOCUMENTATION ROUTES (DEV)
 * ================================
 */

/**
 * @route   GET /api/hotels/docs/routes
 * @desc    Documentation des routes disponibles (développement uniquement)
 * @access  Admin uniquement
 */
if (process.env.NODE_ENV === 'development') {
  router.get('/docs/routes', requireAdmin, (req, res) => {
    const routes = [
      {
        method: 'POST',
        path: '/api/hotels',
        description: 'Créer un hôtel',
        auth: 'Admin',
        body: 'Hotel data + seasonalPricing'
      },
      {
        method: 'GET',
        path: '/api/hotels',
        description: 'Liste hôtels paginée',
        auth: 'Admin',
        query: 'page, limit, search, category, city, includeStats'
      },
      {
        method: 'GET',
        path: '/api/hotels/:id',
        description: 'Détails hôtel',
        auth: 'Admin',
        query: 'includeRooms, includeStats'
      },
      {
        method: 'PUT',
        path: '/api/hotels/:id',
        description: 'Modifier hôtel',
        auth: 'Admin',
        body: 'Updated fields'
      },
      {
        method: 'DELETE',
        path: '/api/hotels/:id',
        description: 'Supprimer hôtel',
        auth: 'Admin',
        query: 'force=true pour cascade'
      },
      {
        method: 'POST',
        path: '/api/hotels/:id/upload',
        description: 'Upload images',
        auth: 'Admin',
        files: 'images[] (max 20, 5MB)'
      },
      {
        method: 'GET',
        path: '/api/hotels/:id/pricing',
        description: 'Prix saisonniers',
        auth: 'Admin'
      },
      {
        method: 'PUT',
        path: '/api/hotels/:id/pricing',
        description: 'Modifier prix saisonniers',
        auth: 'Admin',
        body: 'seasonalPricing array'
      },
      {
        method: 'POST',
        path: '/api/hotels/:id/calculate-price',
        description: 'Calculer prix devis',
        auth: 'Admin + Receptionist',
        body: 'roomType, dates, numberOfRooms'
      },
      {
        method: 'GET',
        path: '/api/hotels/:id/stats',
        description: 'Statistiques hôtel',
        auth: 'Admin',
        query: 'period, startDate, endDate'
      },
      {
        method: 'GET',
        path: '/api/hotels/:id/availability',
        description: 'Vérifier disponibilité',
        auth: 'Admin + Receptionist',
        query: 'checkInDate, checkOutDate, roomType, roomsNeeded'
      },
      {
        method: 'GET',
        path: '/api/hotels/search/suggestions',
        description: 'Autocomplete recherche',
        auth: 'Admin + Receptionist',
        query: 'q (terme recherche)'
      }
    ];

    res.status(200).json({
      success: true,
      data: {
        totalRoutes: routes.length,
        routes,
        rateLimits: {
          standard: '60 req/min',
          strict: '10 req/15min',
          upload: '20 req/5min'
        },
        imageUpload: {
          maxFiles: BUSINESS_RULES.MAX_HOTEL_IMAGES,
          maxSize: `${BUSINESS_RULES.MAX_IMAGE_SIZE_MB}MB`,
          allowedTypes: ['JPEG', 'PNG', 'WebP']
        }
      }
    });
  });
}

module.exports = router;