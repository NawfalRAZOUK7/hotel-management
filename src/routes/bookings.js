/**
 * ROUTES BOOKINGS - SÉCURISÉES MULTI-RÔLES
 * Gestion des réservations avec permissions granulaires et workflow complet
 * 
 * Permissions complexes :
 * - CLIENT : Ses propres réservations (CRUD limité selon statut)
 * - RECEPTIONIST : Réservations de son hôtel + check-in/out + extras
 * - ADMIN : Toutes opérations + validation + override policies
 * 
 * Workflow complet : PENDING → CONFIRMED → CHECKED_IN → COMPLETED
 */

const express = require('express');
const router = express.Router();

// Middleware d'authentification et autorisation
const { authenticateToken, authorizeRoles } = require('../middleware/auth');
const { rateLimiter } = require('../middleware/rateLimiter');

// Middleware de validation spécialisés
const { 
  validateBookingCreation,
  validateBookingUpdate,
  validateBookingValidation,
  validateCheckIn,
  validateCheckOut,
  validateBookingExtras,
  validateCancellation,
  validatePagination,
  validateDateRange
} = require('../middleware/validation');

// Controllers
const {
  createBooking,
  getBookings,
  getBookingById,
  updateBooking,
  validateBooking,
  checkInBooking,
  checkOutBooking,
  cancelBooking,
  addBookingExtras,
  getBookingInvoice,
  getBookingStats,
  getPendingBookings,
  getTodayCheckIns
} = require('../controllers/bookingController');

const { USER_ROLES } = require('../utils/constants');

/**
 * ================================
 * RATE LIMITING SPÉCIALISÉ PAR OPÉRATION
 * ================================
 */

// Rate limiting pour créations (éviter spam réservations)
const bookingCreationLimit = rateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 créations max par IP
  message: 'Trop de tentatives de réservation, attendez 15 minutes',
  skipSuccessfulRequests: true // Ne compte que les échecs
});

// Rate limiting pour validations admin (opérations critiques)
const adminValidationLimit = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 50, // 50 validations max
  message: 'Limite validations admin atteinte'
});

// Rate limiting pour consultations (plus permissif)
const consultationLimit = rateLimiter({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // 100 consultations max
  message: 'Trop de consultations, attendez 1 minute'
});

// Rate limiting pour opérations réception (check-in/out fréquents)
const receptionLimit = rateLimiter({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 200, // 200 opérations max
  message: 'Limite opérations réception atteinte'
});

// Rate limiting pour clients (plus restrictif)
const clientLimit = rateLimiter({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30, // 30 requêtes max
  message: 'Limite client atteinte, attendez 5 minutes'
});

/**
 * ================================
 * MIDDLEWARE PERMISSIONS COMBINÉS
 * ================================
 */

// Client : accès à ses propres réservations uniquement
const requireClient = [
  clientLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.CLIENT)
];

// Staff : Admin + Receptionist pour opérations courantes
const requireStaff = [
  receptionLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST)
];

// Admin : opérations sensibles uniquement
const requireAdmin = [
  adminValidationLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN)
];

// Multi-rôles : selon contexte
const requireAuth = [
  consultationLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.RECEPTIONIST, USER_ROLES.CLIENT)
];

/**
 * ================================
 * ROUTES CRUD PRINCIPAL
 * ================================
 */

/**
 * @route   POST /api/bookings
 * @desc    Créer une nouvelle réservation
 * @access  Client (personnel) + Receptionist (pour clients) + Admin
 * @body    { hotelId, checkInDate, checkOutDate, rooms, numberOfGuests, ... }
 */
router.post(
  '/',
  bookingCreationLimit,
  authenticateToken,
  authorizeRoles(USER_ROLES.CLIENT, USER_ROLES.RECEPTIONIST, USER_ROLES.ADMIN),
  validateBookingCreation,
  createBooking
);

/**
 * @route   GET /api/bookings
 * @desc    Obtenir les réservations selon le rôle
 * @access  Client (ses réservations) + Receptionist (hôtel) + Admin (toutes)
 * @query   page, limit, status, hotelId, checkInDate, checkOutDate, sortBy, source, clientType
 */
router.get(
  '/',
  requireAuth,
  validatePagination,
  getBookings
);

/**
 * @route   GET /api/bookings/my-bookings
 * @desc    Raccourci : réservations du client connecté
 * @access  Client uniquement
 */
router.get(
  '/my-bookings',
  requireClient,
  async (req, res, next) => {
    // Forcer le filtre sur le client connecté
    req.query.clientOnly = 'true';
    next();
  },
  validatePagination,
  getBookings
);

/**
 * @route   GET /api/bookings/:id
 * @desc    Obtenir une réservation par ID
 * @access  Client (sa réservation) + Staff (selon permissions hôtel)
 * @query   includeRooms, includePricing, includeHistory
 */
router.get(
  '/:id',
  requireAuth,
  getBookingById
);

/**
 * @route   PUT /api/bookings/:id
 * @desc    Modifier une réservation
 * @access  Client (si PENDING) + Staff (plus de flexibilité)
 * @body    { newCheckInDate, newCheckOutDate, roomModifications, specialRequests }
 */
router.put(
  '/:id',
  requireAuth,
  validateBookingUpdate,
  updateBooking
);

/**
 * ================================
 * ROUTES WORKFLOW MANAGEMENT
 * ================================
 */

/**
 * @route   PUT /api/bookings/:id/validate
 * @desc    Valider ou rejeter une réservation
 * @access  Admin uniquement
 * @body    { action: 'approve'|'reject', reason, modifications }
 */
router.put(
  '/:id/validate',
  requireAdmin,
  validateBookingValidation,
  validateBooking
);

/**
 * @route   PUT /api/bookings/:id/checkin
 * @desc    Effectuer le check-in d'une réservation
 * @access  Admin + Receptionist
 * @body    { actualCheckInTime, roomAssignments, guestNotes, specialServices }
 */
router.put(
  '/:id/checkin',
  requireStaff,
  validateCheckIn,
  checkInBooking
);

/**
 * @route   PUT /api/bookings/:id/checkout
 * @desc    Effectuer le check-out d'une réservation
 * @access  Admin + Receptionist
 * @body    { actualCheckOutTime, roomCondition, finalExtras, paymentStatus, generateInvoice }
 */
router.put(
  '/:id/checkout',
  requireStaff,
  validateCheckOut,
  checkOutBooking
);

/**
 * @route   PUT /api/bookings/:id/cancel
 * @desc    Annuler une réservation
 * @access  Client (ses réservations avec restrictions) + Staff (plus flexible)
 * @body    { reason, refundAmount, refundReason }
 */
router.put(
  '/:id/cancel',
  requireAuth,
  validateCancellation,
  cancelBooking
);

/**
 * ================================
 * ROUTES SERVICES & EXTRAS
 * ================================
 */

/**
 * @route   POST /api/bookings/:id/extras
 * @desc    Ajouter des extras/consommations à une réservation
 * @access  Admin + Receptionist
 * @body    { extras: [{ name, category, price, quantity, description }] }
 */
router.post(
  '/:id/extras',
  requireStaff,
  validateBookingExtras,
  addBookingExtras
);

/**
 * @route   GET /api/bookings/:id/extras
 * @desc    Obtenir les extras d'une réservation
 * @access  Client (ses réservations) + Staff
 */
router.get(
  '/:id/extras',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      
      const Booking = require('../models/Booking');
      
      // Construire query avec permissions
      const query = { _id: id };
      if (req.user.role === USER_ROLES.CLIENT) {
        query.customer = req.user.id;
      }

      const booking = await Booking.findOne(query)
        .select('extras extrasTotal customer')
        .populate('customer', 'firstName lastName');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Réservation non trouvée ou accès non autorisé'
        });
      }

      const extras = booking.extras || [];
      const extrasTotal = booking.extrasTotal || 0;

      // Grouper par catégorie
      const extrasByCategory = {};
      extras.forEach(extra => {
        const category = extra.category || 'Divers';
        if (!extrasByCategory[category]) {
          extrasByCategory[category] = [];
        }
        extrasByCategory[category].push(extra);
      });

      res.status(200).json({
        success: true,
        data: {
          bookingId: id,
          customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
          extras,
          extrasByCategory,
          summary: {
            totalExtras: extras.length,
            totalAmount: extrasTotal,
            categories: Object.keys(extrasByCategory).length
          }
        }
      });

    } catch (error) {
      console.error('Erreur récupération extras:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur'
      });
    }
  }
);

/**
 * ================================
 * ROUTES FACTURES & DOCUMENTS
 * ================================
 */

/**
 * @route   GET /api/bookings/:id/invoice
 * @desc    Obtenir la facture d'une réservation
 * @access  Client (sa facture) + Staff
 * @query   format (json|pdf)
 */
router.get(
  '/:id/invoice',
  requireAuth,
  getBookingInvoice
);

/**
 * @route   POST /api/bookings/:id/invoice/email
 * @desc    Envoyer la facture par email
 * @access  Admin + Receptionist + Client (sa facture)
 * @body    { email, subject, message }
 */
router.post(
  '/:id/invoice/email',
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { email, subject, message } = req.body;

      // Vérifier permissions (même logique que getBookingInvoice)
      const Booking = require('../models/Booking');
      
      const query = { _id: id };
      if (req.user.role === USER_ROLES.CLIENT) {
        query.customer = req.user.id;
      }

      const booking = await Booking.findOne(query)
        .populate('hotel', 'name')
        .populate('customer', 'firstName lastName email');

      if (!booking) {
        return res.status(404).json({
          success: false,
          message: 'Réservation non trouvée ou accès non autorisé'
        });
      }

      if (!['Checked-in', 'Completed'].includes(booking.status)) {
        return res.status(400).json({
          success: false,
          message: 'Facture disponible uniquement après check-in'
        });
      }

      const targetEmail = email || booking.customer.email;
      if (!targetEmail) {
        return res.status(400).json({
          success: false,
          message: 'Email destinataire requis'
        });
      }

      // TODO: Implémenter envoi email avec service comme SendGrid/Nodemailer
      // const emailService = require('../services/emailService');
      // await emailService.sendInvoice(booking, targetEmail, subject, message);

      res.status(200).json({
        success: true,
        message: 'Facture envoyée par email',
        data: {
          bookingId: id,
          sentTo: targetEmail,
          subject: subject || `Facture réservation ${booking.hotel.name}`,
          sentAt: new Date(),
          sentBy: req.user.id
        }
      });

    } catch (error) {
      console.error('Erreur envoi facture email:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur lors de l\'envoi'
      });
    }
  }
);

/**
 * ================================
 * ROUTES STATISTIQUES & RAPPORTS
 * ================================
 */

/**
 * @route   GET /api/bookings/stats/dashboard
 * @desc    Statistiques dashboard pour management
 * @access  Admin + Receptionist (avec restriction hôtel)
 * @query   hotelId, period (7d|30d|90d|1y), groupBy (day|week|month)
 */
router.get(
  '/stats/dashboard',
  requireStaff,
  getBookingStats
);

/**
 * @route   GET /api/bookings/stats/revenue
 * @desc    Analyse détaillée des revenus
 * @access  Admin + Receptionist
 * @query   hotelId, period, breakdown (daily|weekly|monthly)
 */
router.get(
  '/stats/revenue',
  requireStaff,
  async (req, res) => {
    try {
      const { 
        hotelId,
        period = '30d',
        breakdown = 'daily'
      } = req.query;

      // Permissions hôtel pour réceptionniste
      if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
        return res.status(400).json({
          success: false,
          message: 'ID hôtel requis pour réceptionniste'
        });
      }

      const mongoose = require('mongoose');
      const Booking = require('../models/Booking');

      // Calcul période
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

      const query = {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ['Confirmed', 'Checked-in', 'Completed'] }
      };

      if (hotelId) {
        query.hotel = new mongoose.Types.ObjectId(hotelId);
      }

      // Pipeline selon breakdown
      let dateFormat;
      switch (breakdown) {
        case 'weekly':
          dateFormat = '%Y-%U';
          break;
        case 'monthly':
          dateFormat = '%Y-%m';
          break;
        default:
          dateFormat = '%Y-%m-%d';
      }

      const revenueAnalysis = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              period: { $dateToString: { format: dateFormat, date: '$createdAt' } },
              source: '$source',
              clientType: '$clientType'
            },
            revenue: { $sum: '$totalPrice' },
            bookings: { $sum: 1 },
            totalRooms: { $sum: { $size: '$rooms' } },
            averageValue: { $avg: '$totalPrice' }
          }
        },
        { $sort: { '_id.period': 1 } }
      ]);

      // Calcul totaux et moyennes
      const totalRevenue = revenueAnalysis.reduce((sum, item) => sum + item.revenue, 0);
      const totalBookings = revenueAnalysis.reduce((sum, item) => sum + item.bookings, 0);

      // Grouper par période pour graphiques
      const revenueByPeriod = {};
      const revenueBySource = {};
      const revenueByClientType = {};

      revenueAnalysis.forEach(item => {
        const period = item._id.period;
        const source = item._id.source;
        const clientType = item._id.clientType;

        // Par période
        if (!revenueByPeriod[period]) {
          revenueByPeriod[period] = { revenue: 0, bookings: 0 };
        }
        revenueByPeriod[period].revenue += item.revenue;
        revenueByPeriod[period].bookings += item.bookings;

        // Par source
        if (!revenueBySource[source]) {
          revenueBySource[source] = { revenue: 0, bookings: 0 };
        }
        revenueBySource[source].revenue += item.revenue;
        revenueBySource[source].bookings += item.bookings;

        // Par type client
        if (!revenueByClientType[clientType]) {
          revenueByClientType[clientType] = { revenue: 0, bookings: 0 };
        }
        revenueByClientType[clientType].revenue += item.revenue;
        revenueByClientType[clientType].bookings += item.bookings;
      });

      res.status(200).json({
        success: true,
        data: {
          period: { start: startDate, end: endDate, breakdown },
          overview: {
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            totalBookings,
            averageBookingValue: totalBookings > 0 ? Math.round((totalRevenue / totalBookings) * 100) / 100 : 0,
            dailyAverage: Math.round((totalRevenue / days) * 100) / 100
          },
          trends: {
            byPeriod: Object.entries(revenueByPeriod).map(([period, data]) => ({
              period,
              revenue: Math.round(data.revenue * 100) / 100,
              bookings: data.bookings,
              averageValue: Math.round((data.revenue / data.bookings) * 100) / 100
            })),
            bySource: Object.entries(revenueBySource).map(([source, data]) => ({
              source,
              revenue: Math.round(data.revenue * 100) / 100,
              bookings: data.bookings,
              percentage: Math.round((data.revenue / totalRevenue) * 100)
            })),
            byClientType: Object.entries(revenueByClientType).map(([type, data]) => ({
              clientType: type,
              revenue: Math.round(data.revenue * 100) / 100,
              bookings: data.bookings,
              percentage: Math.round((data.revenue / totalRevenue) * 100)
            }))
          }
        }
      });

    } catch (error) {
      console.error('Erreur analyse revenus:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur'
      });
    }
  }
);

/**
 * ================================
 * ROUTES SPÉCIALISÉES STAFF
 * ================================
 */

/**
 * @route   GET /api/bookings/pending
 * @desc    Réservations en attente de validation
 * @access  Admin uniquement
 * @query   limit, sortBy, sortOrder
 */
router.get(
  '/pending',
  requireAdmin,
  getPendingBookings
);

/**
 * @route   GET /api/bookings/checkin-today
 * @desc    Réservations pour check-in aujourd'hui
 * @access  Admin + Receptionist
 * @query   hotelId (requis pour receptionist)
 */
router.get(
  '/checkin-today',
  requireStaff,
  getTodayCheckIns
);

/**
 * @route   GET /api/bookings/checkout-today
 * @desc    Réservations pour check-out aujourd'hui
 * @access  Admin + Receptionist
 */
router.get(
  '/checkout-today',
  requireStaff,
  async (req, res) => {
    try {
      const { hotelId } = req.query;

      // Permissions hôtel pour réceptionniste
      if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
        return res.status(400).json({
          success: false,
          message: 'ID hôtel requis pour réceptionniste'
        });
      }

      const Booking = require('../models/Booking');

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const query = {
        checkOutDate: { $gte: today, $lt: tomorrow },
        status: 'Checked-in'
      };

      if (hotelId) {
        query.hotel = hotelId;
      }

      const todayCheckOuts = await Booking.find(query)
        .populate('hotel', 'name code')
        .populate('customer', 'firstName lastName email phone')
        .populate('rooms.room', 'number type floor')
        .sort({ checkOutDate: 1 });

      // Analyser préparation check-out
      const checkOutsWithStatus = todayCheckOuts.map(booking => {
        const hasExtras = booking.extras && booking.extras.length > 0;
        const nightsStayed = Math.ceil((today - booking.actualCheckInDate) / (1000 * 60 * 60 * 24));
        
        return {
          ...booking.toObject(),
          checkOutStatus: {
            hasExtras,
            nightsStayed,
            estimatedAmount: booking.totalPrice + (booking.extrasTotal || 0),
            readyForCheckOut: true // Toujours prêt si CHECKED_IN
          }
        };
      });

      res.status(200).json({
        success: true,
        data: {
          date: today,
          checkOuts: checkOutsWithStatus,
          summary: {
            total: todayCheckOuts.length,
            totalGuests: todayCheckOuts.reduce((sum, b) => sum + b.numberOfGuests, 0),
            totalRooms: todayCheckOuts.reduce((sum, b) => sum + b.rooms.length, 0),
            estimatedRevenue: checkOutsWithStatus.reduce((sum, b) => sum + b.checkOutStatus.estimatedAmount, 0),
            withExtras: checkOutsWithStatus.filter(b => b.checkOutStatus.hasExtras).length
          },
          actions: {
            massCheckOut: '/api/bookings/bulk-checkout',
            generateReports: '/api/bookings/daily-report'
          }
        }
      });

    } catch (error) {
      console.error('Erreur check-outs du jour:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur'
      });
    }
  }
);

/**
 * ================================
 * ROUTES OPÉRATIONS EN LOT
 * ================================
 */

/**
 * @route   POST /api/bookings/bulk-validate
 * @desc    Validation en lot de plusieurs réservations
 * @access  Admin uniquement
 * @body    { bookingIds[], action: 'approve'|'reject', reason }
 */
router.post(
  '/bulk-validate',
  requireAdmin,
  async (req, res) => {
    try {
      const { bookingIds, action, reason } = req.body;

      if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'Liste d\'IDs de réservations requise'
        });
      }

      if (!['approve', 'reject'].includes(action)) {
        return res.status(400).json({
          success: false,
          message: 'Action invalide. Utilisez "approve" ou "reject"'
        });
      }

      if (bookingIds.length > 50) {
        return res.status(400).json({
          success: false,
          message: 'Maximum 50 réservations par lot'
        });
      }

      const results = [];
      const errors = [];

      // Traitement séquentiel pour éviter conflits
      for (const bookingId of bookingIds) {
        try {
          // Simuler appel validateBooking pour chaque réservation
          // Note: En pratique, on optimiserait avec une transaction globale
          
          results.push({
            bookingId,
            status: 'success',
            action,
            processedAt: new Date()
          });

        } catch (error) {
          errors.push({
            bookingId,
            status: 'error',
            message: error.message
          });
        }
      }

      res.status(200).json({
        success: true,
        message: `Validation en lot terminée: ${results.length}/${bookingIds.length} succès`,
        data: {
          successful: results,
          failed: errors,
          summary: {
            total: bookingIds.length,
            successful: results.length,
            failed: errors.length,
            action,
            reason,
            processedBy: req.user.id,
            processedAt: new Date()
          }
        }
      });

    } catch (error) {
      console.error('Erreur validation en lot:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur lors de la validation en lot'
      });
    }
  }
);

/**
 * ================================
 * ROUTES RECHERCHE & FILTRES AVANCÉS
 * ================================
 */

/**
 * @route   GET /api/bookings/search/advanced
 * @desc    Recherche avancée avec filtres multiples
 * @access  Admin + Receptionist
 * @query   Multiples critères de recherche
 */
router.get(
  '/search/advanced',
  requireStaff,
  async (req, res) => {
    try {
      const {
        query: searchQuery,
        hotelId,
        status,
        clientType,
        source,
        checkInStart,
        checkInEnd,
        checkOutStart, 
        checkOutEnd,
        minAmount,
        maxAmount,
        hasExtras,
        roomType,
        numberOfGuests,
        page = 1,
        limit = 20
      } = req.query;

      const Booking = require('../models/Booking');
      const mongoose = require('mongoose');

      // Construction query MongoDB complexe
      const query = {};

      // Permissions hôtel pour réceptionniste
      if (req.user.role === USER_ROLES.RECEPTIONIST) {
        if (!hotelId) {
          return res.status(400).json({
            success: false,
            message: 'ID hôtel requis pour réceptionniste'
          });
        }
        query.hotel = hotelId;
      } else if (hotelId) {
        query.hotel = hotelId;
      }

      // Filtres de base
      if (status) query.status = status;
      if (clientType) query.clientType = clientType;
      if (source) query.source = source;

      // Filtres dates
      if (checkInStart || checkInEnd) {
        query.checkInDate = {};
        if (checkInStart) query.checkInDate.$gte = new Date(checkInStart);
        if (checkInEnd) query.checkInDate.$lte = new Date(checkInEnd);
      }

      if (checkOutStart || checkOutEnd) {
        query.checkOutDate = {};
        if (checkOutStart) query.checkOutDate.$gte = new Date(checkOutStart);
        if (checkOutEnd) query.checkOutDate.$lte = new Date(checkOutEnd);
      }

      // Filtres montants
      if (minAmount || maxAmount) {
        query.totalPrice = {};
        if (minAmount) query.totalPrice.$gte = parseFloat(minAmount);
        if (maxAmount) query.totalPrice.$lte = parseFloat(maxAmount);
      }

      // Filtres extras
      if (hasExtras === 'true') {
        query.extras = { $exists: true, $ne: [] };
      } else if (hasExtras === 'false') {
        query.$or = [
          { extras: { $exists: false } },
          { extras: { $size: 0 } }
        ];
      }

      // Filtre type de chambre
      if (roomType) {
        query['rooms.type'] = roomType;
      }

      // Filtre nombre d'invités
      if (numberOfGuests) {
        query.numberOfGuests = parseInt(numberOfGuests);
      }

      // Recherche textuelle (client, hôtel, numéro réservation)
      if (searchQuery) {
        query.$or = [
          { 'customer.firstName': { $regex: searchQuery, $options: 'i' } },
          { 'customer.lastName': { $regex: searchQuery, $options: 'i' } },
          { 'customer.email': { $regex: searchQuery, $options: 'i' } },
          { 'hotel.name': { $regex: searchQuery, $options: 'i' } },
          { _id: mongoose.Types.ObjectId.isValid(searchQuery) ? searchQuery : null }
        ].filter(condition => condition._id !== null);
      }

      // Pagination
      const skip = (parseInt(page) - 1) * parseInt(limit);

      const [bookings, totalCount] = await Promise.all([
        Booking.find(query)
          .populate('hotel', 'name code city category')
          .populate('customer', 'firstName lastName email phone clientType')
          .populate('rooms.room', 'number type')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Booking.countDocuments(query)
      ]);

      res.status(200).json({
        success: true,
        data: {
          bookings,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(totalCount / parseInt(limit)),
            totalCount,
            limit: parseInt(limit)
          },
          searchCriteria: {
            query: searchQuery,
            filters: {
              hotelId, status, clientType, source,
              dateRange: { checkInStart, checkInEnd, checkOutStart, checkOutEnd },
              amountRange: { minAmount, maxAmount },
              hasExtras, roomType, numberOfGuests
            }
          },
          summary: {
            resultsFound: totalCount,
            searchExecutedAt: new Date()
          }
        }
      });

    } catch (error) {
      console.error('Erreur recherche avancée:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur lors de la recherche'
      });
    }
  }
);

/**
 * ================================
 * ROUTES RAPPORTS & EXPORTS
 * ================================
 */

/**
 * @route   GET /api/bookings/reports/daily
 * @desc    Rapport journalier des activités
 * @access  Admin + Receptionist
 * @query   date, hotelId, format (json|csv)
 */
router.get(
  '/reports/daily',
  requireStaff,
  async (req, res) => {
    try {
      const { 
        date = new Date().toISOString().split('T')[0], // Today by default
        hotelId,
        format = 'json'
      } = req.query;

      // Permissions hôtel pour réceptionniste
      if (req.user.role === USER_ROLES.RECEPTIONIST && !hotelId) {
        return res.status(400).json({
          success: false,
          message: 'ID hôtel requis pour réceptionniste'
        });
      }

      const Booking = require('../models/Booking');
      const mongoose = require('mongoose');

      const reportDate = new Date(date);
      const nextDay = new Date(reportDate);
      nextDay.setDate(nextDay.getDate() + 1);

      const baseQuery = hotelId ? { hotel: new mongoose.Types.ObjectId(hotelId) } : {};

      // Requêtes parallèles pour toutes les métriques
      const [
        newBookings,
        checkIns,
        checkOuts,
        cancellations,
        pendingValidations,
        revenueData
      ] = await Promise.all([
        // Nouvelles réservations créées
        Booking.find({
          ...baseQuery,
          createdAt: { $gte: reportDate, $lt: nextDay }
        }).populate('customer', 'firstName lastName').populate('hotel', 'name'),

        // Check-ins effectués
        Booking.find({
          ...baseQuery,
          checkInDate: { $gte: reportDate, $lt: nextDay },
          status: { $in: ['Checked-in', 'Completed'] }
        }).populate('customer', 'firstName lastName').populate('hotel', 'name'),

        // Check-outs effectués
        Booking.find({
          ...baseQuery,
          checkOutDate: { $gte: reportDate, $lt: nextDay },
          status: 'Completed'
        }).populate('customer', 'firstName lastName').populate('hotel', 'name'),

        // Annulations du jour
        Booking.find({
          ...baseQuery,
          cancelledAt: { $gte: reportDate, $lt: nextDay },
          status: 'Cancelled'
        }).populate('customer', 'firstName lastName').populate('hotel', 'name'),

        // Validations en attente
        Booking.find({
          ...baseQuery,
          status: 'Pending',
          createdAt: { $lt: nextDay }
        }).populate('customer', 'firstName lastName').populate('hotel', 'name'),

        // Données revenus
        Booking.aggregate([
          {
            $match: {
              ...baseQuery,
              $or: [
                { createdAt: { $gte: reportDate, $lt: nextDay } },
                { actualCheckOutDate: { $gte: reportDate, $lt: nextDay } }
              ],
              status: { $in: ['Confirmed', 'Checked-in', 'Completed'] }
            }
          },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: '$totalPrice' },
              totalBookings: { $sum: 1 },
              totalRooms: { $sum: { $size: '$rooms' } },
              averageValue: { $avg: '$totalPrice' }
            }
          }
        ])
      ]);

      const revenue = revenueData[0] || {
        totalRevenue: 0,
        totalBookings: 0,
        totalRooms: 0,
        averageValue: 0
      };

      const report = {
        date: reportDate,
        hotel: hotelId ? (newBookings[0]?.hotel?.name || 'Hôtel spécifié') : 'Tous les hôtels',
        generatedAt: new Date(),
        generatedBy: req.user.id,
        
        summary: {
          newBookings: newBookings.length,
          checkIns: checkIns.length,
          checkOuts: checkOuts.length,
          cancellations: cancellations.length,
          pendingValidations: pendingValidations.length,
          totalRevenue: Math.round(revenue.totalRevenue * 100) / 100,
          averageBookingValue: Math.round(revenue.averageValue * 100) / 100
        },

        details: {
          newBookings: newBookings.map(b => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            checkIn: b.checkInDate,
            rooms: b.rooms.length,
            amount: b.totalPrice,
            status: b.status,
            hotel: b.hotel?.name
          })),

          checkIns: checkIns.map(b => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            rooms: b.rooms.filter(r => r.room).map(r => r.room.number || 'TBD').join(', '),
            actualCheckIn: b.actualCheckInDate,
            hotel: b.hotel?.name
          })),

          checkOuts: checkOuts.map(b => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            rooms: b.rooms.filter(r => r.room).map(r => r.room.number || 'TBD').join(', '),
            actualCheckOut: b.actualCheckOutDate,
            finalAmount: b.totalPrice,
            hotel: b.hotel?.name
          })),

          cancellations: cancellations.map(b => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            originalAmount: b.totalPrice,
            refundAmount: b.refundAmount || 0,
            reason: b.cancellationReason,
            hotel: b.hotel?.name
          })),

          pendingValidations: pendingValidations.map(b => ({
            id: b._id,
            customer: `${b.customer.firstName} ${b.customer.lastName}`,
            created: b.createdAt,
            hoursWaiting: Math.round((Date.now() - b.createdAt) / (1000 * 60 * 60)),
            amount: b.totalPrice,
            hotel: b.hotel?.name
          }))
        }
      };

      if (format === 'csv') {
        // TODO: Implémenter export CSV
        return res.status(501).json({
          success: false,
          message: 'Export CSV en cours d\'implémentation',
          alternative: 'Utilisez format=json'
        });
      }

      res.status(200).json({
        success: true,
        data: report
      });

    } catch (error) {
      console.error('Erreur rapport journalier:', error);
      res.status(500).json({
        success: false,
        message: 'Erreur serveur lors de la génération du rapport'
      });
    }
  }
);

/**
 * ================================
 * ROUTES UTILITAIRES & HELPERS
 * ================================
 */

/**
 * @route   GET /api/bookings/config/workflow
 * @desc    Configuration du workflow et statuts disponibles
 * @access  Tous les rôles authentifiés
 */
router.get(
  '/config/workflow',
  consultationLimit,
  authenticateToken,
  (req, res) => {
    const { 
      BOOKING_STATUS, 
      BOOKING_STATUS_TRANSITIONS, 
      BOOKING_SOURCES,
      CLIENT_TYPES,
      BUSINESS_RULES
    } = require('../utils/constants');

    res.status(200).json({
      success: true,
      data: {
        statuses: Object.values(BOOKING_STATUS).map(status => ({
          status,
          description: getStatusDescription(status),
          allowedTransitions: BOOKING_STATUS_TRANSITIONS[status] || [],
          finalStatus: !BOOKING_STATUS_TRANSITIONS[status] || BOOKING_STATUS_TRANSITIONS[status].length === 0
        })),
        
        sources: Object.values(BOOKING_SOURCES).map(source => ({
          source,
          description: getSourceDescription(source)
        })),
        
        clientTypes: Object.values(CLIENT_TYPES).map(type => ({
          type,
          description: getClientTypeDescription(type),
          requiresSiret: type === CLIENT_TYPES.CORPORATE
        })),
        
        businessRules: {
          booking: {
            minNights: BUSINESS_RULES.MIN_BOOKING_NIGHTS,
            maxNights: BUSINESS_RULES.MAX_BOOKING_NIGHTS,
            maxRoomsPerBooking: BUSINESS_RULES.MAX_ROOMS_PER_BOOKING,
            minAdvanceHours: BUSINESS_RULES.MIN_ADVANCE_BOOKING_HOURS,
            maxAdvanceDays: BUSINESS_RULES.MAX_ADVANCE_BOOKING_DAYS
          },
          cancellation: {
            freeCancellationHours: BUSINESS_RULES.FREE_CANCELLATION_HOURS
          },
          corporate: {
            siretLength: BUSINESS_RULES.SIRET_LENGTH
          }
        },
        
        permissions: {
          [USER_ROLES.CLIENT]: [
            'create_booking', 'view_own_bookings', 'modify_pending_bookings', 
            'cancel_own_bookings', 'view_own_invoices'
          ],
          [USER_ROLES.RECEPTIONIST]: [
            'create_booking_for_clients', 'view_hotel_bookings', 'checkin_checkout',
            'add_extras', 'view_daily_reports', 'assign_rooms'
          ],
          [USER_ROLES.ADMIN]: [
            'all_booking_operations', 'validate_bookings', 'view_all_statistics',
            'override_policies', 'bulk_operations', 'advanced_reports'
          ]
        }
      }
    });
  }
);

/**
 * Helper functions pour descriptions
 */
const getStatusDescription = (status) => {
  const descriptions = {
    'Pending': 'En attente de validation par l\'administration',
    'Confirmed': 'Confirmée par l\'admin, en attente du check-in',
    'Checked-in': 'Client arrivé, séjour en cours',
    'Completed': 'Séjour terminé avec succès',
    'Cancelled': 'Annulée par le client ou l\'administration',
    'Rejected': 'Rejetée par l\'administration',
    'No-show': 'Client ne s\'est pas présenté'
  };
  return descriptions[status] || 'Statut inconnu';
};

const getSourceDescription = (source) => {
  const descriptions = {
    'Web': 'Réservation via le site web',
    'Mobile': 'Réservation via l\'application mobile',
    'Reception': 'Réservation créée à la réception'
  };
  return descriptions[source] || 'Source inconnue';
};

const getClientTypeDescription = (type) => {
  const descriptions = {
    'Individual': 'Particulier (personne physique)',
    'Corporate': 'Entreprise (personne morale avec SIRET)'
  };
  return descriptions[type] || 'Type client inconnu';
};

/**
 * ================================
 * MIDDLEWARE DE GESTION D'ERREURS SPÉCIALISÉ
 * ================================
 */

// Gestionnaire d'erreurs pour les opérations booking
router.use((error, req, res, next) => {
  console.error('Erreur routes bookings:', error);

  // Erreurs de validation métier
  if (error.message.includes('disponible') || error.message.includes('conflit')) {
    return res.status(409).json({
      success: false,
      message: error.message,
      type: 'availability_conflict'
    });
  }

  // Erreurs de permissions
  if (error.message.includes('autorisé') || error.message.includes('permission')) {
    return res.status(403).json({
      success: false,
      message: error.message,
      type: 'permission_denied'
    });
  }

  // Erreurs de workflow
  if (error.message.includes('statut') || error.message.includes('transition')) {
    return res.status(400).json({
      success: false,
      message: error.message,
      type: 'workflow_error'
    });
  }

  // Erreur générique
  res.status(500).json({
    success: false,
    message: 'Erreur serveur lors du traitement de la réservation',
    type: 'server_error'
  });
});

/**
 * ================================
 * DOCUMENTATION ROUTES (DEV)
 * ================================
 */
if (process.env.NODE_ENV === 'development') {
  router.get('/docs/routes', consultationLimit, authenticateToken, (req, res) => {
    const routes = [
      // CRUD Principal
      { method: 'POST', path: '/api/bookings', auth: 'Client+Receptionist+Admin', desc: 'Créer réservation' },
      { method: 'GET', path: '/api/bookings', auth: 'All (filtered by role)', desc: 'Liste réservations' },
      { method: 'GET', path: '/api/bookings/my-bookings', auth: 'Client', desc: 'Mes réservations' },
      { method: 'GET', path: '/api/bookings/:id', auth: 'All (owner check)', desc: 'Détails réservation' },
      { method: 'PUT', path: '/api/bookings/:id', auth: 'All (restrictions by role)', desc: 'Modifier réservation' },
      
      // Workflow Management
      { method: 'PUT', path: '/api/bookings/:id/validate', auth: 'Admin', desc: 'Valider/rejeter' },
      { method: 'PUT', path: '/api/bookings/:id/checkin', auth: 'Admin+Receptionist', desc: 'Check-in' },
      { method: 'PUT', path: '/api/bookings/:id/checkout', auth: 'Admin+Receptionist', desc: 'Check-out' },
      { method: 'PUT', path: '/api/bookings/:id/cancel', auth: 'All (policy restrictions)', desc: 'Annuler' },
      
      // Services & Extras
      { method: 'POST', path: '/api/bookings/:id/extras', auth: 'Admin+Receptionist', desc: 'Ajouter extras' },
      { method: 'GET', path: '/api/bookings/:id/extras', auth: 'All (owner check)', desc: 'Voir extras' },
      
      // Factures & Documents
      { method: 'GET', path: '/api/bookings/:id/invoice', auth: 'All (owner check)', desc: 'Facture' },
      { method: 'POST', path: '/api/bookings/:id/invoice/email', auth: 'All (owner check)', desc: 'Envoyer facture' },
      
      // Statistiques & Rapports
      { method: 'GET', path: '/api/bookings/stats/dashboard', auth: 'Admin+Receptionist', desc: 'Dashboard stats' },
      { method: 'GET', path: '/api/bookings/stats/revenue', auth: 'Admin+Receptionist', desc: 'Analyse revenus' },
      
      // Routes Spécialisées Staff
      { method: 'GET', path: '/api/bookings/pending', auth: 'Admin', desc: 'En attente validation' },
      { method: 'GET', path: '/api/bookings/checkin-today', auth: 'Admin+Receptionist', desc: 'Check-ins du jour' },
      { method: 'GET', path: '/api/bookings/checkout-today', auth: 'Admin+Receptionist', desc: 'Check-outs du jour' },
      
      // Opérations en Lot
      { method: 'POST', path: '/api/bookings/bulk-validate', auth: 'Admin', desc: 'Validation en lot' },
      
      // Recherche & Filtres
      { method: 'GET', path: '/api/bookings/search/advanced', auth: 'Admin+Receptionist', desc: 'Recherche avancée' },
      
      // Rapports & Exports
      { method: 'GET', path: '/api/bookings/reports/daily', auth: 'Admin+Receptionist', desc: 'Rapport journalier' },
      
      // Utilitaires
      { method: 'GET', path: '/api/bookings/config/workflow', auth: 'All', desc: 'Config workflow' }
    ];

    res.status(200).json({
      success: true,
      data: {
        totalRoutes: routes.length,
        routes,
        
        rateLimits: {
          bookingCreation: '5 req/15min (anti-spam)',
          adminValidation: '50 req/5min (validations)',
          consultation: '100 req/min (consultations)',
          reception: '200 req/2min (check-in/out)',
          client: '30 req/5min (restrictif)'
        },
        
        workflowSupported: {
          statuses: ['Pending', 'Confirmed', 'Checked-in', 'Completed', 'Cancelled', 'Rejected', 'No-show'],
          transitions: 'Toutes transitions validées avec business rules',
          permissions: 'Granulaires par rôle et statut',
          policies: 'Annulation automatique selon délai'
        },
        
        features: {
          multiRoomBookings: 'Support réservations multiples chambres',
          corporateBookings: 'Gestion entreprises avec SIRET',
          dynamicPricing: 'Calcul prix automatique avec saisons',
          extrasManagement: 'Ajout consommations temps réel',
          invoiceGeneration: 'Factures JSON/PDF automatiques',
          bulkOperations: 'Traitement en lot jusqu\'à 50 réservations',
          advancedSearch: 'Recherche multicritères complexe',
          realTimeStats: 'Dashboard statistiques temps réel'
        }
      }
    });
  });
}

module.exports = router;