/**
 * HOTEL CONTROLLER - CRUD COMPLET + BUSINESS LOGIC + REAL-TIME FEATURES
 * Gestion des hôtels avec pricing saisonnier, upload images, statistiques
 * NOUVEAU: Fonctionnalités temps réel (Week 3)
 * 
 * Fonctionnalités :
 * - CRUD hôtels (Admin uniquement)
 * - Gestion prix saisonniers par type chambre
 * - Upload et gestion images
 * - Statistiques occupation et revenus
 * - Validation métier complète
 * - NOUVEAU: Broadcasting temps réel des mises à jour hôtel
 * - NOUVEAU: Live pricing avec notifications WebSocket
 * - NOUVEAU: Intégration disponibilité temps réel
 * - NOUVEAU: Streaming données hôtel en continu
 */

const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');

// NOUVEAU: Import des services temps réel
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const availabilityService = require('../utils/availability');
const { logger } = require('../utils/logger');

const {
  HOTEL_CATEGORIES,
  ROOM_TYPES,
  SEASONS,
  BUSINESS_RULES,
  ERROR_MESSAGES,
  VALIDATION_PATTERNS,
  USER_ROLES
} = require('../utils/constants');

const { 
  calculateBasePriceWithMultipliers,
  validatePrice,
  getSeason,
  getSeasonalMultiplier
} = require('../utils/pricing');

const { getOccupancyRate } = require('../utils/availability');

/**
 * ================================
 * CRUD OPERATIONS
 * ================================
 */

/**
 * @desc    Créer un nouvel hôtel
 * @route   POST /api/hotels
 * @access  Admin uniquement
 */
const createHotel = async (req, res) => {
  try {
    const {
      code,
      name,
      address,
      city,
      postalCode,
      phone,
      email,
      category,
      description,
      amenities,
      seasonalPricing
    } = req.body;

    // ================================
    // VALIDATIONS MÉTIER
    // ================================
    
    // Vérifier code hôtel unique et format
    if (!VALIDATION_PATTERNS.HOTEL_CODE.test(code)) {
      return res.status(400).json({
        success: false,
        message: 'Code hôtel invalide. Format requis: XXX000 (ex: RAB001)'
      });
    }

    const existingHotel = await Hotel.findOne({ code });
    if (existingHotel) {
      return res.status(409).json({
        success: false,
        message: 'Code hôtel déjà utilisé'
      });
    }

    // Vérifier catégorie valide
    if (!Object.values(HOTEL_CATEGORIES).includes(category)) {
      return res.status(400).json({
        success: false,
        message: 'Catégorie hôtel invalide (1-5 étoiles)'
      });
    }

    // Valider téléphone si fourni
    if (phone && !VALIDATION_PATTERNS.PHONE.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Format téléphone invalide'
      });
    }

    // Valider code postal si fourni
    if (postalCode && !VALIDATION_PATTERNS.POSTAL_CODE.test(postalCode)) {
      return res.status(400).json({
        success: false,
        message: 'Code postal invalide (5 chiffres)'
      });
    }

    // ================================
    // VALIDATION PRICING SAISONNIER
    // ================================
    
    let validatedSeasonalPricing = null;
    if (seasonalPricing && Array.isArray(seasonalPricing)) {
      validatedSeasonalPricing = await validateSeasonalPricing(seasonalPricing);
    }

    // ================================
    // CRÉATION HÔTEL
    // ================================
    
    const hotel = new Hotel({
      code,
      name,
      address,
      city,
      postalCode,
      phone,
      email,
      category,
      description,
      amenities: amenities || [],
      seasonalPricing: validatedSeasonalPricing,
      createdBy: req.user.id,
      images: [] // Sera rempli via upload séparé
    });

    const savedHotel = await hotel.save();

    // Populer les données pour la réponse
    const populatedHotel = await Hotel.findById(savedHotel._id)
      .populate('createdBy', 'firstName lastName email')
      .select('-__v');

    // ================================
    // NOUVEAU: NOTIFICATIONS TEMPS RÉEL
    // ================================
    
    // Broadcast création hôtel à tous les admins
    await broadcastHotelUpdate('HOTEL_CREATED', populatedHotel, {
      action: 'create',
      performedBy: req.user.id,
      timestamp: new Date()
    });

    // Notification via service de notifications
    await notificationService.emit('hotel:created', {
      hotelId: savedHotel._id,
      hotelName: savedHotel.name,
      createdBy: req.user.id
    });

    res.status(201).json({
      success: true,
      message: 'Hôtel créé avec succès',
      data: {
        hotel: populatedHotel,
        nextSteps: {
          addRooms: `/api/hotels/${savedHotel._id}/rooms`,
          uploadImages: `/api/hotels/${savedHotel._id}/upload`,
          viewStats: `/api/hotels/${savedHotel._id}/stats`
        }
      }
    });

  } catch (error) {
    console.error('Erreur création hôtel:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la création'
    });
  }
};

/**
 * @desc    Obtenir tous les hôtels
 * @route   GET /api/hotels
 * @access  Admin uniquement
 */
const getAllHotels = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      search,
      category,
      city,
      includeStats = false,
      // NOUVEAU: Option pour stream temps réel
      realtime = false
    } = req.query;

    // ================================
    // CONSTRUCTION REQUÊTE
    // ================================
    
    const query = {};
    
    // Recherche textuelle
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { code: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } }
      ];
    }

    // Filtres
    if (category) {
      query.category = parseInt(category);
    }
    
    if (city) {
      query.city = { $regex: city, $options: 'i' };
    }

    // ================================
    // PAGINATION & TRI
    // ================================
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortOptions = {};
    sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // ================================
    // EXÉCUTION REQUÊTES
    // ================================
    
    const [hotels, totalCount] = await Promise.all([
      Hotel.find(query)
        .populate('createdBy', 'firstName lastName')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('-seasonalPricing -__v'), // Exclure pricing détaillé dans la liste
      Hotel.countDocuments(query)
    ]);

    // ================================
    // AJOUT STATISTIQUES SI DEMANDÉ
    // ================================
    
    let hotelsWithStats = hotels;
    if (includeStats === 'true') {
      hotelsWithStats = await Promise.all(
        hotels.map(async (hotel) => {
          const roomCount = await Room.countDocuments({ hotel: hotel._id });
          const activeBookings = await Booking.countDocuments({
            hotel: hotel._id,
            status: { $in: ['Confirmed', 'Checked-in'] }
          });
          
          // NOUVEAU: Obtenir disponibilité temps réel
          const realTimeAvailability = await availabilityService.checkRealTimeAvailability(
            hotel._id.toString(),
            new Date(),
            new Date(Date.now() + 24 * 60 * 60 * 1000)
          );
          
          return {
            ...hotel.toObject(),
            stats: {
              roomCount,
              activeBookings,
              occupancyRate: roomCount > 0 ? Math.round((activeBookings / roomCount) * 100) : 0,
              realTimeAvailable: realTimeAvailability.availableRooms.length
            }
          };
        })
      );
    }

    // ================================
    // NOUVEAU: STREAMING TEMPS RÉEL
    // ================================
    
    if (realtime === 'true' && req.user.id) {
      // Enregistrer l'utilisateur pour les mises à jour temps réel
      registerForRealTimeUpdates(req.user.id, {
        type: 'HOTEL_LIST',
        filters: { category, city, search }
      });
    }

    // ================================
    // RÉPONSE PAGINÉE
    // ================================
    
    const totalPages = Math.ceil(totalCount / parseInt(limit));
    
    res.status(200).json({
      success: true,
      data: {
        hotels: hotelsWithStats,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        },
        filters: {
          search,
          category,
          city,
          includeStats
        },
        // NOUVEAU: Indicateur temps réel
        realtime: {
          enabled: realtime === 'true',
          updateChannel: 'hotel-updates'
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération hôtels:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Obtenir un hôtel par ID
 * @route   GET /api/hotels/:id
 * @access  Admin uniquement
 */
const getHotelById = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      includeRooms = false, 
      includeStats = false,
      // NOUVEAU: Options temps réel
      realtime = false,
      includeLivePricing = false
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    // ================================
    // RÉCUPÉRATION HÔTEL
    // ================================
    
    const hotel = await Hotel.findById(id)
      .populate('createdBy', 'firstName lastName email')
      .populate('updatedBy', 'firstName lastName email');

    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // DONNÉES ADDITIONNELLES
    // ================================
    
    const responseData = { hotel };

    // Inclure les chambres si demandé
    if (includeRooms === 'true') {
      const rooms = await Room.find({ hotel: id })
        .sort({ floor: 1, number: 1 })
        .select('-__v');
      responseData.rooms = rooms;
    }

    // Inclure les statistiques si demandé
    if (includeStats === 'true') {
      const stats = await generateHotelStats(id);
      responseData.stats = stats;
    }

    // ================================
    // NOUVEAU: LIVE PRICING
    // ================================
    
    if (includeLivePricing === 'true') {
      const livePricing = await calculateLivePricing(id);
      responseData.livePricing = livePricing;
    }

    // ================================
    // NOUVEAU: ABONNEMENT TEMPS RÉEL
    // ================================
    
    if (realtime === 'true' && req.user.id) {
      // Enregistrer pour mises à jour temps réel de cet hôtel
      registerForRealTimeUpdates(req.user.id, {
        type: 'HOTEL_DETAIL',
        hotelId: id
      });
      
      // Joindre le canal Socket.io de l'hôtel
      socketService.sendUserNotification(req.user.id, 'join-hotel-updates', {
        hotelId: id,
        message: `Abonné aux mises à jour de ${hotel.name}`
      });
    }

    res.status(200).json({
      success: true,
      data: {
        ...responseData,
        // NOUVEAU: Métadonnées temps réel
        realtime: {
          enabled: realtime === 'true',
          updateChannel: `hotel-${id}`,
          livePricing: includeLivePricing === 'true'
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération hôtel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Mettre à jour un hôtel
 * @route   PUT /api/hotels/:id
 * @access  Admin uniquement
 */
const updateHotel = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const hotel = await Hotel.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // VALIDATION UPDATES
    // ================================
    
    const allowedUpdates = [
      'name', 'address', 'city', 'postalCode', 'phone', 'email', 
      'category', 'description', 'amenities', 'seasonalPricing'
    ];
    
    const updates = {};
    
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        // Validations spécifiques
        if (field === 'category' && !Object.values(HOTEL_CATEGORIES).includes(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: 'Catégorie hôtel invalide'
          });
        }
        
        if (field === 'phone' && req.body[field] && !VALIDATION_PATTERNS.PHONE.test(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: 'Format téléphone invalide'
          });
        }
        
        if (field === 'postalCode' && req.body[field] && !VALIDATION_PATTERNS.POSTAL_CODE.test(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: 'Code postal invalide'
          });
        }
        
        if (field === 'seasonalPricing' && req.body[field]) {
          updates[field] = await validateSeasonalPricing(req.body[field]);
        } else {
          updates[field] = req.body[field];
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune donnée à mettre à jour'
      });
    }

    // ================================
    // MISE À JOUR
    // ================================
    
    updates.updatedBy = req.user.id;
    updates.updatedAt = new Date();

    const updatedHotel = await Hotel.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    ).populate('createdBy updatedBy', 'firstName lastName email');

    // ================================
    // NOUVEAU: BROADCAST MISES À JOUR TEMPS RÉEL
    // ================================
    
    // Broadcast général
    await broadcastHotelUpdate('HOTEL_UPDATED', updatedHotel, {
      action: 'update',
      updatedFields: Object.keys(updates),
      performedBy: req.user.id,
      timestamp: new Date()
    });

    // Si pricing mis à jour, broadcast spécifique
    if (updates.seasonalPricing) {
      await broadcastPricingUpdate(updatedHotel);
    }

    // Si infos essentielles mises à jour, mettre à jour disponibilité
    if (updates.name || updates.category || updates.amenities) {
      await availabilityService.updateRoomAvailability(id, null, {
        checkIn: new Date(),
        checkOut: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 jours
      }, 'INFO_UPDATE', req.user.id, {
        updatedFields: Object.keys(updates)
      });
    }

    res.status(200).json({
      success: true,
      message: 'Hôtel mis à jour avec succès',
      data: { 
        hotel: updatedHotel,
        // NOUVEAU: Indicateur broadcast
        broadcast: {
          sent: true,
          channels: ['hotel-updates', `hotel-${id}`]
        }
      }
    });

  } catch (error) {
    console.error('Erreur mise à jour hôtel:', error);
    
    if (error.name === 'ValidationError') {
      const errors = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Erreurs de validation',
        errors
      });
    }

    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Supprimer un hôtel
 * @route   DELETE /api/hotels/:id
 * @access  Admin uniquement
 */
const deleteHotel = async (req, res) => {
  try {
    const { id } = req.params;
    const { force = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const hotel = await Hotel.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // VÉRIFICATIONS SÉCURITÉ
    // ================================
    
    // Vérifier s'il y a des chambres
    const roomCount = await Room.countDocuments({ hotel: id });
    
    // Vérifier s'il y a des réservations actives
    const activeBookingsCount = await Booking.countDocuments({
      hotel: id,
      status: { $in: ['Pending', 'Confirmed', 'Checked-in'] }
    });

    if (roomCount > 0 || activeBookingsCount > 0) {
      if (force !== 'true') {
        return res.status(409).json({
          success: false,
          message: 'Impossible de supprimer l\'hôtel',
          details: {
            roomCount,
            activeBookingsCount,
            solution: 'Utilisez ?force=true pour forcer la suppression'
          }
        });
      }

      // ================================
      // SUPPRESSION EN CASCADE (si force=true)
      // ================================
      
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Supprimer les réservations
          await Booking.deleteMany({ hotel: id }, { session });
          
          // Supprimer les chambres
          await Room.deleteMany({ hotel: id }, { session });
          
          // Supprimer l'hôtel
          await Hotel.findByIdAndDelete(id, { session });
        });
        
        await session.endSession();
        
        // ================================
        // NOUVEAU: BROADCAST SUPPRESSION
        // ================================
        
        await broadcastHotelUpdate('HOTEL_DELETED', { _id: id, name: hotel.name }, {
          action: 'delete',
          performedBy: req.user.id,
          timestamp: new Date(),
          cascadeInfo: {
            roomsDeleted: roomCount,
            bookingsDeleted: activeBookingsCount
          }
        });
        
        res.status(200).json({
          success: true,
          message: 'Hôtel et données associées supprimés avec succès',
          details: {
            deletedRooms: roomCount,
            deletedBookings: activeBookingsCount
          }
        });
        
      } catch (transactionError) {
        await session.endSession();
        throw transactionError;
      }
    } else {
      // ================================
      // SUPPRESSION SIMPLE
      // ================================
      
      await Hotel.findByIdAndDelete(id);
      
      // NOUVEAU: Broadcast suppression
      await broadcastHotelUpdate('HOTEL_DELETED', { _id: id, name: hotel.name }, {
        action: 'delete',
        performedBy: req.user.id,
        timestamp: new Date()
      });
      
      res.status(200).json({
        success: true,
        message: 'Hôtel supprimé avec succès'
      });
    }

  } catch (error) {
    console.error('Erreur suppression hôtel:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * GESTION IMAGES
 * ================================
 */

/**
 * @desc    Upload images hôtel
 * @route   POST /api/hotels/:id/upload
 * @access  Admin uniquement
 */
const uploadHotelImages = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const hotel = await Hotel.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // Vérifier que des fichiers ont été uploadés
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune image fournie'
      });
    }

    // ================================
    // VALIDATION IMAGES
    // ================================
    
    const maxImages = BUSINESS_RULES.MAX_HOTEL_IMAGES;
    const currentImageCount = hotel.images ? hotel.images.length : 0;
    
    if (currentImageCount + req.files.length > maxImages) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${maxImages} images autorisées. Actuellement: ${currentImageCount}`
      });
    }

    // ================================
    // TRAITEMENT IMAGES
    // ================================
    
    const imageData = req.files.map((file, index) => ({
      filename: file.filename,
      originalName: file.originalname,
      path: file.path,
      size: file.size,
      mimetype: file.mimetype,
      uploadedAt: new Date(),
      uploadedBy: req.user.id,
      isMain: currentImageCount === 0 && index === 0 // Première image = image principale
    }));

    // Ajouter les nouvelles images
    hotel.images = [...(hotel.images || []), ...imageData];
    hotel.updatedBy = req.user.id;
    hotel.updatedAt = new Date();

    await hotel.save();

    // ================================
    // NOUVEAU: BROADCAST UPLOAD IMAGES
    // ================================
    
    await broadcastHotelUpdate('HOTEL_IMAGES_UPDATED', hotel, {
      action: 'upload_images',
      imagesAdded: req.files.length,
      totalImages: hotel.images.length,
      performedBy: req.user.id,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: `${req.files.length} image(s) uploadée(s) avec succès`,
      data: {
        uploadedImages: imageData,
        totalImages: hotel.images.length
      }
    });

  } catch (error) {
    console.error('Erreur upload images:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de l\'upload'
    });
  }
};

/**
 * @desc    Supprimer une image hôtel
 * @route   DELETE /api/hotels/:id/images/:imageId
 * @access  Admin uniquement
 */
const deleteHotelImage = async (req, res) => {
  try {
    const { id, imageId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const hotel = await Hotel.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // Trouver et supprimer l'image
    const imageIndex = hotel.images.findIndex(img => img._id.toString() === imageId);
    
    if (imageIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Image non trouvée'
      });
    }

    const deletedImage = hotel.images[imageIndex];
    hotel.images.splice(imageIndex, 1);

    // Si c'était l'image principale, définir une nouvelle image principale
    if (deletedImage.isMain && hotel.images.length > 0) {
      hotel.images[0].isMain = true;
    }

    hotel.updatedBy = req.user.id;
    hotel.updatedAt = new Date();

    await hotel.save();

    // TODO: Supprimer le fichier du système de fichiers/cloud storage
    // fs.unlinkSync(deletedImage.path);

    // ================================
    // NOUVEAU: BROADCAST SUPPRESSION IMAGE
    // ================================
    
    await broadcastHotelUpdate('HOTEL_IMAGE_DELETED', hotel, {
      action: 'delete_image',
      imageDeleted: deletedImage.filename,
      remainingImages: hotel.images.length,
      performedBy: req.user.id,
      timestamp: new Date()
    });

    res.status(200).json({
      success: true,
      message: 'Image supprimée avec succès',
      data: {
        deletedImage: deletedImage.filename,
        remainingImages: hotel.images.length
      }
    });

  } catch (error) {
    console.error('Erreur suppression image:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * STATISTIQUES HÔTEL
 * ================================
 */

/**
 * @desc    Obtenir statistiques détaillées d'un hôtel
 * @route   GET /api/hotels/:id/stats
 * @access  Admin uniquement
 */
const getHotelStats = async (req, res) => {
  try {
    const { id } = req.params;
    const { 
      period = '30d',  // 7d, 30d, 90d, 1y
      startDate,
      endDate,
      // NOUVEAU: Options temps réel
      realtime = false,
      autoRefresh = false
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    const hotel = await Hotel.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // CALCUL PÉRIODE
    // ================================
    
    let periodStart, periodEnd;
    
    if (startDate && endDate) {
      periodStart = new Date(startDate);
      periodEnd = new Date(endDate);
    } else {
      periodEnd = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      periodStart = new Date(periodEnd.getTime() - (days * 24 * 60 * 60 * 1000));
    }

    // ================================
    // GÉNÉRATION STATISTIQUES
    // ================================
    
    const stats = await generateHotelStats(id, periodStart, periodEnd);

    // ================================
    // NOUVEAU: ABONNEMENT STATS TEMPS RÉEL
    // ================================
    
    if (realtime === 'true' && req.user.id) {
      // Enregistrer pour mises à jour automatiques
      registerForRealTimeUpdates(req.user.id, {
        type: 'HOTEL_STATS',
        hotelId: id,
        period: period,
       autoRefresh: autoRefresh === 'true'
     });
     
     // Démarrer auto-refresh si demandé
     if (autoRefresh === 'true') {
       startStatsAutoRefresh(req.user.id, id, period);
     }
   }

   res.status(200).json({
     success: true,
     data: {
       hotel: {
         id: hotel._id,
         name: hotel.name,
         code: hotel.code,
         category: hotel.category
       },
       period: {
         start: periodStart,
         end: periodEnd,
         days: Math.ceil((periodEnd - periodStart) / (1000 * 60 * 60 * 24))
       },
       stats,
       // NOUVEAU: Métadonnées temps réel
       realtime: {
         enabled: realtime === 'true',
         autoRefresh: autoRefresh === 'true',
         updateChannel: `hotel-stats-${id}`,
         refreshInterval: 60000 // 1 minute
       }
     }
   });

 } catch (error) {
   console.error('Erreur statistiques hôtel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* ================================
* NOUVEAU: ENDPOINTS TEMPS RÉEL
* ================================
*/

/**
* @desc    Obtenir stream temps réel des données hôtel
* @route   GET /api/hotels/:id/stream
* @access  Admin uniquement
*/
const streamHotelData = async (req, res) => {
 try {
   const { id } = req.params;
   const { 
     includeAvailability = true,
     includePricing = true,
     includeStats = false 
   } = req.query;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   const hotel = await Hotel.findById(id);
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // Configurer SSE (Server-Sent Events)
   res.writeHead(200, {
     'Content-Type': 'text/event-stream',
     'Cache-Control': 'no-cache',
     'Connection': 'keep-alive',
     'Access-Control-Allow-Origin': '*'
   });

   // Envoyer données initiales
   const initialData = await getStreamData(id, {
     includeAvailability: includeAvailability === 'true',
     includePricing: includePricing === 'true',
     includeStats: includeStats === 'true'
   });

   res.write(`data: ${JSON.stringify({
     type: 'initial',
     hotel: hotel.toObject(),
     ...initialData,
     timestamp: new Date()
   })}\n\n`);

   // Configurer interval pour mises à jour
   const streamInterval = setInterval(async () => {
     try {
       const updatedData = await getStreamData(id, {
         includeAvailability: includeAvailability === 'true',
         includePricing: includePricing === 'true',
         includeStats: includeStats === 'true'
       });

       res.write(`data: ${JSON.stringify({
         type: 'update',
         ...updatedData,
         timestamp: new Date()
       })}\n\n`);
     } catch (error) {
       logger.error(`Stream error for hotel ${id}:`, error);
     }
   }, 30000); // Mise à jour toutes les 30 secondes

   // Gérer la fermeture de connexion
   req.on('close', () => {
     clearInterval(streamInterval);
     logger.info(`Stream closed for hotel ${id}`);
   });

 } catch (error) {
   console.error('Erreur streaming données hôtel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Obtenir pricing temps réel pour un hôtel
* @route   GET /api/hotels/:id/live-pricing
* @access  Admin uniquement
*/
const getLivePricing = async (req, res) => {
 try {
   const { id } = req.params;
   const { 
     checkIn,
     checkOut,
     roomType,
     includeDynamicPricing = true
   } = req.query;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   const hotel = await Hotel.findById(id);
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // Calculer pricing en temps réel
   const livePricing = await calculateLivePricing(id, {
     checkIn: checkIn ? new Date(checkIn) : new Date(),
     checkOut: checkOut ? new Date(checkOut) : new Date(Date.now() + 24 * 60 * 60 * 1000),
     roomType,
     includeDynamicPricing: includeDynamicPricing === 'true'
   });

   // Enregistrer pour mises à jour temps réel
   if (req.user.id) {
     registerForRealTimeUpdates(req.user.id, {
       type: 'LIVE_PRICING',
       hotelId: id,
       searchParams: { checkIn, checkOut, roomType }
     });
   }

   res.status(200).json({
     success: true,
     data: {
       hotel: {
         id: hotel._id,
         name: hotel.name,
         category: hotel.category
       },
       pricing: livePricing,
       validity: {
         from: new Date(),
         until: new Date(Date.now() + 5 * 60 * 1000), // Valide 5 minutes
         refreshUrl: `/api/hotels/${id}/live-pricing?${req.originalUrl.split('?')[1]}`
       },
       realtime: {
         enabled: true,
         updateChannel: `pricing-${id}`,
         updateFrequency: 60000 // 1 minute
       }
     }
   });

 } catch (error) {
   console.error('Erreur pricing temps réel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Souscrire aux mises à jour temps réel d'un hôtel
* @route   POST /api/hotels/:id/subscribe
* @access  Admin uniquement
*/
const subscribeToHotelUpdates = async (req, res) => {
 try {
   const { id } = req.params;
   const { 
     updates = ['availability', 'pricing', 'stats'],
     duration = 3600000 // 1 heure par défaut
   } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   const hotel = await Hotel.findById(id);
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // Créer abonnement
   const subscription = {
     id: `sub_${Date.now()}_${Math.random().toString(36).substring(7)}`,
     userId: req.user.id,
     hotelId: id,
     updates,
     createdAt: new Date(),
     expiresAt: new Date(Date.now() + duration)
   };

   // Enregistrer abonnement
   await storeSubscription(subscription);

   // Notifier via Socket.io
   socketService.sendUserNotification(req.user.id, 'subscription-created', {
     subscription,
     hotel: {
       id: hotel._id,
       name: hotel.name
     },
     channels: updates.map(type => `${type}-${id}`)
   });

   res.status(200).json({
     success: true,
     message: 'Abonnement créé avec succès',
     data: {
       subscription,
       instructions: {
         websocket: `Connectez-vous au canal hotel-${id} via WebSocket`,
         sse: `/api/hotels/${id}/stream`,
         channels: updates.map(type => ({
           type,
           channel: `${type}-${id}`
         }))
       }
     }
   });

 } catch (error) {
   console.error('Erreur abonnement hôtel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* ================================
* UTILITAIRES INTERNES
* ================================
*/

/**
* Valide la configuration de pricing saisonnier
*/
const validateSeasonalPricing = async (seasonalPricing) => {
 const validatedPricing = [];

 for (const pricing of seasonalPricing) {
   const { roomType, season, basePrice, multiplier } = pricing;

   // Vérifier type de chambre
   if (!Object.values(ROOM_TYPES).includes(roomType)) {
     throw new Error(`Type de chambre invalide: ${roomType}`);
   }

   // Vérifier saison
   if (!Object.values(SEASONS).includes(season)) {
     throw new Error(`Saison invalide: ${season}`);
   }

   // Vérifier prix ou multiplicateur
   if (basePrice) {
     const priceValidation = validatePrice(basePrice);
     if (!priceValidation.valid) {
       throw new Error(`Prix invalide pour ${roomType} ${season}: ${priceValidation.error}`);
     }
   }

   if (multiplier && (multiplier < 0.1 || multiplier > 5.0)) {
     throw new Error(`Multiplicateur invalide pour ${roomType} ${season}: doit être entre 0.1 et 5.0`);
   }

   validatedPricing.push({
     roomType,
     season,
     basePrice: basePrice || null,
     multiplier: multiplier || null,
     updatedAt: new Date()
   });
 }

 return validatedPricing;
};

/**
* Génère des statistiques complètes pour un hôtel
*/
const generateHotelStats = async (hotelId, startDate = null, endDate = null) => {
 try {
   // Période par défaut : 30 derniers jours
   if (!startDate || !endDate) {
     endDate = new Date();
     startDate = new Date(endDate.getTime() - (30 * 24 * 60 * 60 * 1000));
   }

   // ================================
   // REQUÊTES PARALLÈLES
   // ================================
   
   const [
     roomStats,
     bookingStats,
     revenueStats,
     occupancyRate,
     // NOUVEAU: Stats temps réel
     realTimeAvailability
   ] = await Promise.all([
     // Statistiques chambres
     Room.aggregate([
       { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
       {
         $group: {
           _id: '$type',
           count: { $sum: 1 },
           avgPrice: { $avg: '$basePrice' },
           status: { $push: '$status' }
         }
       }
     ]),

     // Statistiques réservations
     Booking.aggregate([
       {
         $match: {
           hotel: new mongoose.Types.ObjectId(hotelId),
           createdAt: { $gte: startDate, $lte: endDate }
         }
       },
       {
         $group: {
           _id: '$status',
           count: { $sum: 1 },
           totalRevenue: { $sum: '$totalPrice' },
           avgPrice: { $avg: '$totalPrice' }
         }
       }
     ]),

     // Revenus par période
     Booking.aggregate([
       {
         $match: {
           hotel: new mongoose.Types.ObjectId(hotelId),
           checkInDate: { $gte: startDate, $lte: endDate },
           status: { $in: ['Confirmed', 'Checked-in', 'Completed'] }
         }
       },
       {
         $group: {
           _id: {
             year: { $year: '$checkInDate' },
             month: { $month: '$checkInDate' },
             day: { $dayOfMonth: '$checkInDate' }
           },
           dailyRevenue: { $sum: '$totalPrice' },
           bookingCount: { $sum: 1 }
         }
       },
       { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
     ]),

     // Taux d'occupation
     getOccupancyRate(hotelId, startDate, endDate),

     // NOUVEAU: Disponibilité temps réel
     availabilityService.getRealTimeAvailabilityReport(hotelId, '7d')
   ]);

   // ================================
   // TRAITEMENT RÉSULTATS
   // ================================
   
   // Statistiques chambres par type
   const roomTypeStats = {};
   roomStats.forEach(stat => {
     const availableCount = stat.status.filter(s => s === 'Available').length;
     roomTypeStats[stat._id] = {
       total: stat.count,
       available: availableCount,
       occupied: stat.count - availableCount,
       averagePrice: Math.round(stat.avgPrice * 100) / 100
     };
   });

   // Statistiques réservations par statut
   const bookingStatusStats = {};
   let totalRevenue = 0;
   bookingStats.forEach(stat => {
     bookingStatusStats[stat._id] = {
       count: stat.count,
       revenue: stat.totalRevenue || 0,
       averagePrice: Math.round((stat.avgPrice || 0) * 100) / 100
     };
     totalRevenue += stat.totalRevenue || 0;
   });

   // Revenus journaliers
   const dailyRevenue = revenueStats.map(day => ({
     date: new Date(day._id.year, day._id.month - 1, day._id.day),
     revenue: Math.round(day.dailyRevenue * 100) / 100,
     bookings: day.bookingCount
   }));

   return {
     summary: {
       totalRooms: roomStats.reduce((sum, stat) => sum + stat.count, 0),
       totalBookings: bookingStats.reduce((sum, stat) => sum + stat.count, 0),
       totalRevenue: Math.round(totalRevenue * 100) / 100,
       averageBookingValue: bookingStats.length > 0 ? 
         Math.round((totalRevenue / bookingStats.reduce((sum, stat) => sum + stat.count, 0)) * 100) / 100 : 0,
       occupancyRate: occupancyRate.occupancyRate
     },
     
     roomTypes: roomTypeStats,
     bookingStatuses: bookingStatusStats,
     dailyRevenue,
     
     trends: {
       revenueGrowth: calculateRevenueGrowth(dailyRevenue),
       averageDailyRate: dailyRevenue.length > 0 ? 
         Math.round((totalRevenue / dailyRevenue.length) * 100) / 100 : 0,
       peakDays: dailyRevenue
         .sort((a, b) => b.revenue - a.revenue)
         .slice(0, 5)
         .map(day => ({
           date: day.date,
           revenue: day.revenue,
           bookings: day.bookings
         }))
     },
     
     // NOUVEAU: Métriques temps réel
     realtime: {
       currentAvailability: realTimeAvailability.summary,
       forecast: realTimeAvailability.dailyReports.slice(0, 7),
       lastUpdated: new Date()
     }
   };

 } catch (error) {
   console.error('Erreur génération statistiques:', error);
   throw new Error('Impossible de générer les statistiques');
 }
};

/**
* Calcule la croissance des revenus
*/
const calculateRevenueGrowth = (dailyRevenue) => {
 if (dailyRevenue.length < 2) return 0;
 
 const midPoint = Math.floor(dailyRevenue.length / 2);
 const firstHalf = dailyRevenue.slice(0, midPoint);
 const secondHalf = dailyRevenue.slice(midPoint);
 
 const firstHalfAvg = firstHalf.reduce((sum, day) => sum + day.revenue, 0) / firstHalf.length;
 const secondHalfAvg = secondHalf.reduce((sum, day) => sum + day.revenue, 0) / secondHalf.length;
 
 if (firstHalfAvg === 0) return 0;
 
 return Math.round(((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100);
};

/**
* ================================
* GESTION PRIX SAISONNIERS
* ================================
*/

/**
* @desc    Obtenir prix saisonniers d'un hôtel
* @route   GET /api/hotels/:id/pricing
* @access  Admin uniquement
*/
const getSeasonalPricing = async (req, res) => {
 try {
   const { id } = req.params;
   // NOUVEAU: Option temps réel
   const { realtime = false } = req.query;
   
   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   const hotel = await Hotel.findById(id).select('name code seasonalPricing');
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // NOUVEAU: Abonnement temps réel
   if (realtime === 'true' && req.user.id) {
     registerForRealTimeUpdates(req.user.id, {
       type: 'SEASONAL_PRICING',
       hotelId: id
     });
   }

   res.status(200).json({
     success: true,
     data: {
       hotel: {
         id: hotel._id,
         name: hotel.name,
         code: hotel.code
       },
       seasonalPricing: hotel.seasonalPricing || [],
       defaultMultipliers: {
         seasons: Object.values(SEASONS),
         roomTypes: Object.values(ROOM_TYPES),
         priceRange: {
           min: BUSINESS_RULES.MIN_ROOM_PRICE,
           max: BUSINESS_RULES.MAX_ROOM_PRICE
         }
       },
       // NOUVEAU: Info temps réel
       realtime: {
         enabled: realtime === 'true',
         updateChannel: `pricing-${id}`
       }
     }
   });

 } catch (error) {
   console.error('Erreur récupération pricing:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Mettre à jour prix saisonniers
* @route   PUT /api/hotels/:id/pricing
* @access  Admin uniquement
*/
const updateSeasonalPricing = async (req, res) => {
 try {
   const { id } = req.params;
   const { seasonalPricing } = req.body;
   
   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   if (!seasonalPricing || !Array.isArray(seasonalPricing)) {
     return res.status(400).json({
       success: false,
       message: 'Configuration pricing invalide'
     });
   }

   const hotel = await Hotel.findById(id);
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // ================================
   // VALIDATION PRICING
   // ================================
   
   const validatedPricing = await validateSeasonalPricing(seasonalPricing);

   // ================================
   // MISE À JOUR
   // ================================
   
   hotel.seasonalPricing = validatedPricing;
   hotel.updatedBy = req.user.id;
   hotel.updatedAt = new Date();

   await hotel.save();

   // ================================
   // NOUVEAU: BROADCAST PRICING UPDATE
   // ================================
   
   await broadcastPricingUpdate(hotel, {
     action: 'seasonal_pricing_updated',
     updatedBy: req.user.id,
     changes: validatedPricing
   });

   res.status(200).json({
     success: true,
     message: 'Prix saisonniers mis à jour avec succès',
     data: {
       seasonalPricing: hotel.seasonalPricing,
       updatedCount: validatedPricing.length,
       // NOUVEAU: Indicateur broadcast
       broadcast: {
         sent: true,
         channels: [`pricing-${id}`, 'pricing-updates']
       }
     }
   });

 } catch (error) {
   console.error('Erreur mise à jour pricing:', error);
   
   if (error.message.includes('invalide')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* @desc    Calculer prix pour une période donnée
* @route   POST /api/hotels/:id/calculate-price
* @access  Admin + Receptionist (pour devis)
*/
const calculateHotelPrice = async (req, res) => {
 try {
   const { id } = req.params;
   const { 
     roomType, 
     checkInDate, 
     checkOutDate, 
     numberOfRooms = 1,
     // NOUVEAU: Options temps réel
     includeDynamicPricing = false,
     realtime = false
   } = req.body;

   if (!mongoose.Types.ObjectId.isValid(id)) {
     return res.status(400).json({
       success: false,
       message: 'ID hôtel invalide'
     });
   }

   // ================================
   // VALIDATION DONNÉES
   // ================================
   
   if (!roomType || !Object.values(ROOM_TYPES).includes(roomType)) {
     return res.status(400).json({
       success: false,
       message: 'Type de chambre requis et valide'
     });
   }

   if (!checkInDate || !checkOutDate) {
     return res.status(400).json({
       success: false,
       message: 'Dates d\'arrivée et de départ requises'
     });
   }

   const checkIn = new Date(checkInDate);
   const checkOut = new Date(checkOutDate);

   if (checkIn >= checkOut) {
     return res.status(400).json({
       success: false,
       message: ERROR_MESSAGES.INVALID_DATE_RANGE
     });
   }

   // ================================
   // RÉCUPÉRATION HÔTEL ET PRIX
   // ================================
   
   const hotel = await Hotel.findById(id).select('name code category seasonalPricing');
   if (!hotel) {
     return res.status(404).json({
       success: false,
       message: ERROR_MESSAGES.HOTEL_NOT_FOUND
     });
   }

   // Trouver le prix de base pour ce type de chambre
   const room = await Room.findOne({ 
     hotel: id, 
     type: roomType 
   }).select('basePrice');

   if (!room) {
     return res.status(404).json({
       success: false,
       message: `Aucune chambre de type ${roomType} trouvée dans cet hôtel`
     });
   }

   // ================================
   // CALCUL PRIX AVEC PRICING UTILS
   // ================================
   
   const { calculateBookingPrice } = require('../utils/pricing');
   
   const priceCalculation = calculateBookingPrice({
     basePrice: room.basePrice,
     roomType,
     hotelCategory: hotel.category,
     checkInDate: checkIn,
     checkOutDate: checkOut,
     numberOfRooms,
     customSeasonalPeriods: hotel.seasonalPricing ? 
       extractSeasonalPeriods(hotel.seasonalPricing) : null
   });

   // ================================
   // NOUVEAU: DYNAMIC PRICING
   // ================================
   
   let finalPricing = priceCalculation;
   
   if (includeDynamicPricing) {
     const dynamicMultiplier = await calculateDynamicPricingMultiplier(id, {
       checkIn,
       checkOut,
       roomType,
       numberOfRooms
     });
     
     finalPricing = {
       ...priceCalculation,
       dynamicMultiplier,
       dynamicPrice: Math.round(priceCalculation.totalPrice * dynamicMultiplier * 100) / 100,
       priceBeforeDynamic: priceCalculation.totalPrice
     };
   }

   // ================================
   // NOUVEAU: ABONNEMENT TEMPS RÉEL
   // ================================
   
   if (realtime && req.user.id) {
     registerForRealTimeUpdates(req.user.id, {
       type: 'PRICE_CALCULATION',
       hotelId: id,
       calculationParams: {
         roomType,
         checkIn,
         checkOut,
         numberOfRooms
       }
     });
   }

   res.status(200).json({
     success: true,
     data: {
       hotel: {
         id: hotel._id,
         name: hotel.name,
         code: hotel.code,
         category: hotel.category
       },
       request: {
         roomType,
         checkInDate: checkIn,
         checkOutDate: checkOut,
         numberOfRooms
       },
       pricing: finalPricing,
       // NOUVEAU: Métadonnées temps réel
       realtime: {
         enabled: realtime,
         validUntil: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes
         updateChannel: `price-calc-${id}`
       }
     }
   });

 } catch (error) {
   console.error('Erreur calcul prix:', error);
   
   if (error.message.includes('invalide') || error.message.includes('requis')) {
     return res.status(400).json({
       success: false,
       message: error.message
     });
   }

   res.status(500).json({
     success: false,
     message: 'Erreur serveur lors du calcul'
   });
 }
};

/**
* Extrait les périodes saisonnières depuis la configuration hôtel
*/
const extractSeasonalPeriods = (seasonalPricing) => {
 const periods = [];
 const seasonGroups = {};

 // Grouper par saison
 seasonalPricing.forEach(pricing => {
   if (!seasonGroups[pricing.season]) {
     seasonGroups[pricing.season] = [];
   }
   seasonGroups[pricing.season].push(pricing);
 });

 // Convertir en format attendu par pricing.js
 Object.entries(seasonGroups).forEach(([season, pricings]) => {
   // TODO: Implémenter logique pour extraire startMonth/endMonth depuis la config
   // Pour l'instant, utiliser les périodes par défaut
 });

 return periods.length > 0 ? periods : null;
};

/**
* ================================
* NOUVEAU: FONCTIONS TEMPS RÉEL
* ================================
*/

/**
* Broadcast mise à jour hôtel via WebSocket
*/
const broadcastHotelUpdate = async (eventType, hotel, metadata = {}) => {
 try {
   const updateData = {
     eventType,
     hotel: {
       id: hotel._id,
       name: hotel.name,
       code: hotel.code,
       category: hotel.category
     },
     metadata,
     timestamp: new Date()
   };

   // Broadcast général aux admins
   socketService.sendAdminNotification(eventType, updateData);

   // Broadcast sur canal spécifique hôtel
   if (hotel._id) {
     socketService.sendHotelNotification(hotel._id.toString(), eventType, updateData);
   }

   // Log pour monitoring
   logger.info(`Hotel update broadcasted: ${eventType} for hotel ${hotel._id}`);

 } catch (error) {
   logger.error('Error broadcasting hotel update:', error);
 }
};

/**
* Broadcast mise à jour pricing
*/
const broadcastPricingUpdate = async (hotel, changes = {}) => {
 try {
   const pricingData = {
     hotelId: hotel._id,
     hotelName: hotel.name,
     seasonalPricing: hotel.seasonalPricing,
     changes,
     timestamp: new Date()
   };

   // Broadcast sur canal pricing global
   socketService.sendAdminNotification('PRICING_UPDATE', pricingData);

   // Broadcast sur canal pricing spécifique hôtel
   socketService.sendHotelNotification(hotel._id.toString(), 'PRICING_UPDATE', pricingData);

   // Notifier les utilisateurs avec recherches actives
   await notifyActivePricingSearches(hotel._id, pricingData);

   logger.info(`Pricing update broadcasted for hotel ${hotel._id}`);

 } catch (error) {
   logger.error('Error broadcasting pricing update:', error);
 }
};

/**
* Enregistre un utilisateur pour les mises à jour temps réel
*/
const registerForRealTimeUpdates = (userId, config) => {
 try {
   // Store dans Redis ou mémoire selon architecture
   const registration = {
     userId,
     config,
     registeredAt: new Date(),
     expiresAt: new Date(Date.now() + 3600000) // 1 heure
   };

   // TODO: Implémenter stockage persistant
   logger.info(`User ${userId} registered for real-time updates:`, config);

   // Notifier l'utilisateur
   socketService.sendUserNotification(userId, 'realtime-registration', {
     message: 'Enregistré pour mises à jour temps réel',
     config,
     expiresAt: registration.expiresAt
   });

   return registration;

 } catch (error) {
   logger.error('Error registering for real-time updates:', error);
 }
};

/**
* Démarre l'auto-refresh des statistiques
*/
const startStatsAutoRefresh = (userId, hotelId, period) => {
 try {
   const refreshInterval = setInterval(async () => {
     try {
       const stats = await generateHotelStats(hotelId);
       
       socketService.sendUserNotification(userId, 'stats-update', {
         hotelId,
         stats,
         period,
         timestamp: new Date()
       });
     } catch (error) {
       logger.error(`Stats auto-refresh error for hotel ${hotelId}:`, error);
     }
   }, 60000); // Rafraîchir toutes les minutes

   // Stocker l'interval pour pouvoir l'arrêter plus tard
   // TODO: Implémenter gestion des intervals
   
   logger.info(`Stats auto-refresh started for user ${userId}, hotel ${hotelId}`);
   
   return refreshInterval;

 } catch (error) {
   logger.error('Error starting stats auto-refresh:', error);
 }
};

/**
* Obtient les données pour le streaming
*/
const getStreamData = async (hotelId, options = {}) => {
 try {
   const data = {};

   if (options.includeAvailability) {
     const availability = await availabilityService.checkRealTimeAvailability(
       hotelId,
       new Date(),
       new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
     );
     data.availability = availability;
   }

   if (options.includePricing) {
     const pricing = await calculateLivePricing(hotelId);
     data.pricing = pricing;
   }

   if (options.includeStats) {
     const stats = await generateHotelStats(hotelId);
     data.stats = stats;
   }

   return data;

 } catch (error) {
   logger.error('Error getting stream data:', error);
   return {};
 }
};

/**
* Calcule le pricing en temps réel
*/
const calculateLivePricing = async (hotelId, options = {}) => {
 try {
   const {
     checkIn = new Date(),
     checkOut = new Date(Date.now() + 24 * 60 * 60 * 1000),
     roomType = null,
     includeDynamicPricing = true
   } = options;

   const hotel = await Hotel.findById(hotelId).select('category seasonalPricing');
   const rooms = await Room.find({ 
     hotel: hotelId,
     ...(roomType && { type: roomType })
   }).select('type basePrice');

   const pricingByType = {};

   for (const room of rooms) {
     const { calculateBookingPrice } = require('../utils/pricing');
     
     const baseCalculation = calculateBookingPrice({
       basePrice: room.basePrice,
       roomType: room.type,
       hotelCategory: hotel.category,
       checkInDate: checkIn,
       checkOutDate: checkOut,
       numberOfRooms: 1,
       customSeasonalPeriods: hotel.seasonalPricing
     });

     let finalPrice = baseCalculation.totalPrice;

     if (includeDynamicPricing) {
       const dynamicMultiplier = await calculateDynamicPricingMultiplier(hotelId, {
         checkIn,
         checkOut,
         roomType: room.type,
         numberOfRooms: 1
       });
       
       finalPrice = Math.round(finalPrice * dynamicMultiplier * 100) / 100;
     }

     pricingByType[room.type] = {
       basePrice: room.basePrice,
       calculatedPrice: baseCalculation.totalPrice,
       dynamicPrice: finalPrice,
       pricePerNight: Math.round(finalPrice / baseCalculation.numberOfNights * 100) / 100,
       breakdown: baseCalculation.breakdown
     };
   }

   return {
     checkIn,
     checkOut,
     pricingByType,
     lastUpdated: new Date()
   };

 } catch (error) {
   logger.error('Error calculating live pricing:', error);
   throw error;
 }
};

/**
* Calcule le multiplicateur de pricing dynamique
*/
const calculateDynamicPricingMultiplier = async (hotelId, params) => {
 try {
   const { checkIn, checkOut, roomType, numberOfRooms } = params;

   // Obtenir le taux d'occupation actuel
   const occupancyData = await availabilityService.getOccupancyRate(
     hotelId,
     checkIn,
     checkOut,
     false // Pas de broadcast
   );

   // Facteurs pour le calcul dynamique
   let multiplier = 1.0;

   // Facteur occupation (80%+ = +20%, 90%+ = +40%)
   if (occupancyData.occupancyRate >= 90) {
     multiplier *= 1.4;
   } else if (occupancyData.occupancyRate >= 80) {
     multiplier *= 1.2;
   } else if (occupancyData.occupancyRate >= 70) {
     multiplier *= 1.1;
   } else if (occupancyData.occupancyRate < 40) {
     multiplier *= 0.9; // Réduction si faible occupation
   }

   // Facteur dernière minute (< 3 jours = +15%)
   const daysUntilCheckIn = Math.ceil((checkIn - new Date()) / (1000 * 60 * 60 * 24));
   if (daysUntilCheckIn <= 3) {
     multiplier *= 1.15;
   } else if (daysUntilCheckIn <= 7) {
     multiplier *= 1.08;
   }

   // Facteur jour de la semaine (weekend = +10%)
   const dayOfWeek = checkIn.getDay();
   if (dayOfWeek === 5 || dayOfWeek === 6) { // Vendredi ou Samedi
     multiplier *= 1.1;
   }

   // Facteur nombre de chambres (groupe = -5%)
   if (numberOfRooms >= 5) {
     multiplier *= 0.95;
   }

   // Limiter le multiplicateur entre 0.7 et 1.8
   multiplier = Math.max(0.7, Math.min(1.8, multiplier));

   return Math.round(multiplier * 100) / 100;

 } catch (error) {
   logger.error('Error calculating dynamic pricing multiplier:', error);
   return 1.0; // Retour au prix normal en cas d'erreur
 }
};

/**
* Notifie les utilisateurs avec recherches de prix actives
*/
const notifyActivePricingSearches = async (hotelId, pricingData) => {
 try {
   // TODO: Implémenter avec Redis ou système de cache
   // Récupérer les recherches actives pour cet hôtel
   
   // Pour l'instant, broadcast général
   socketService.sendHotelNotification(hotelId.toString(), 'pricing-search-update', {
     message: 'Les prix ont été mis à jour',
     pricingData,
     action: 'REFRESH_SEARCH'
   });

 } catch (error) {
   logger.error('Error notifying active pricing searches:', error);
 }
};

/**
* Stocke un abonnement temps réel
*/
const storeSubscription = async (subscription) => {
 try {
   // TODO: Implémenter stockage persistant (Redis, MongoDB, etc.)
   
   logger.info('Subscription stored:', subscription);
   
   // Configurer expiration automatique
   setTimeout(() => {
     // Nettoyer l'abonnement expiré
     logger.info(`Subscription ${subscription.id} expired`);
   }, subscription.expiresAt - Date.now());

 } catch (error) {
   logger.error('Error storing subscription:', error);
 }
};

/**
* ================================
* ENDPOINTS MONITORING TEMPS RÉEL
* ================================
*/

/**
* @desc    Obtenir métriques temps réel système hôtels
* @route   GET /api/hotels/realtime/metrics
* @access  Admin uniquement
*/
const getRealTimeMetrics = async (req, res) => {
 try {
   const metrics = {
     timestamp: new Date(),
     hotels: {
       total: await Hotel.countDocuments(),
       active: await Hotel.countDocuments({ status: 'ACTIVE' }),
       withActiveBookings: await Booking.distinct('hotel', {
         status: { $in: ['Confirmed', 'Checked-in'] }
       }).then(hotels => hotels.length)
     },
     availability: {
       avgOccupancyRate: await calculateSystemWideOccupancy(),
       hotelsNearCapacity: await getHotelsNearCapacity(90), // 90%+
       hotelsLowOccupancy: await getHotelsNearCapacity(30, 'below') // <30%
     },
     pricing: {
       avgDynamicMultiplier: 1.12, // TODO: Calculer réellement
       hotelsWithDynamicPricing: await Hotel.countDocuments({ 
         'features.dynamicPricing': true 
       })
     },
     connections: socketService.getConnectionStats()
   };

   res.status(200).json({
     success: true,
     data: metrics
   });

 } catch (error) {
   console.error('Erreur métriques temps réel:', error);
   res.status(500).json({
     success: false,
     message: 'Erreur serveur'
   });
 }
};

/**
* Calcule le taux d'occupation système
*/
const calculateSystemWideOccupancy = async () => {
 try {
   const today = new Date();
   const tomorrow = new Date(today);
   tomorrow.setDate(tomorrow.getDate() + 1);

   const hotels = await Hotel.find({ status: 'ACTIVE' }).select('_id');
   let totalOccupancy = 0;

   for (const hotel of hotels) {
     const occupancy = await getOccupancyRate(hotel._id, today, tomorrow, false);
     totalOccupancy += occupancy.occupancyRate;
   }

   return Math.round(totalOccupancy / hotels.length);

 } catch (error) {
   logger.error('Error calculating system-wide occupancy:', error);
   return 0;
 }
};

/**
* Obtient les hôtels proches de la capacité
*/
const getHotelsNearCapacity = async (threshold, direction = 'above') => {
 try {
   const today = new Date();
   const tomorrow = new Date(today);
   tomorrow.setDate(tomorrow.getDate() + 1);

   const hotels = await Hotel.find({ status: 'ACTIVE' }).select('_id name');
   const hotelsNearCapacity = [];

   for (const hotel of hotels) {
     const occupancy = await getOccupancyRate(hotel._id, today, tomorrow, false);
     
     if (direction === 'above' && occupancy.occupancyRate >= threshold) {
       hotelsNearCapacity.push({
         id: hotel._id,
         name: hotel.name,
         occupancyRate: occupancy.occupancyRate
       });
     } else if (direction === 'below' && occupancy.occupancyRate < threshold) {
       hotelsNearCapacity.push({
         id: hotel._id,
         name: hotel.name,
         occupancyRate: occupancy.occupancyRate
       });
     }
   }

   return hotelsNearCapacity;

 } catch (error) {
   logger.error('Error getting hotels near capacity:', error);
   return [];
 }
};

/**
* ================================
* EXPORTS
* ================================
*/
module.exports = {
 // CRUD principal
 createHotel,
 getAllHotels,
 getHotelById,
 updateHotel,
 deleteHotel,
 
 // Gestion images
 uploadHotelImages,
 deleteHotelImage,
 
 // Statistiques
 getHotelStats,
 
 // Pricing saisonnier
 getSeasonalPricing,
 updateSeasonalPricing,
 calculateHotelPrice,
 
 // NOUVEAU: Endpoints temps réel
 streamHotelData,
 getLivePricing,
 subscribeToHotelUpdates,
 getRealTimeMetrics,
 
 // Utilitaires (pour tests)
 validateSeasonalPricing,
 generateHotelStats,
 calculateRevenueGrowth,
 
 // NOUVEAU: Fonctions temps réel exportées
 broadcastHotelUpdate,
 broadcastPricingUpdate,
 calculateLivePricing,
 calculateDynamicPricingMultiplier
};