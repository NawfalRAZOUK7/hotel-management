/**
 * ROOM CONTROLLER - CRUD COMPLET + AVAILABILITY LOGIC + REAL-TIME FEATURES
 * Gestion des chambres avec vérification disponibilité temps réel
 * 
 * Fonctionnalités :
 * - CRUD chambres (Admin + Receptionist)
 * - Vérification disponibilité temps réel
 * - Gestion statuts chambres (Available, Occupied, Maintenance, Out of Order)
 * - Attribution automatique chambres lors check-in
 * - Pricing dynamique intégré
 * - Validation cohérence avec hôtel parent
 * - REAL-TIME FEATURES: Live updates via Socket.io
 * - Broadcast availability changes
 * - Instant notifications
 */

const Room = require('../models/Room');
const Hotel = require('../models/Hotel');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');

// Import real-time services
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const availabilityRealtimeService = require('../services/availabilityRealtimeService');

const {
  ROOM_TYPES,
  ROOM_STATUS,
  ROOM_TYPE_MULTIPLIERS,
  BUSINESS_RULES,
  ERROR_MESSAGES,
  USER_ROLES
} = require('../utils/constants');

const { 
  calculateBasePriceWithMultipliers,
  validatePrice 
} = require('../utils/pricing');

const { 
  checkAvailability,
  isRoomAvailable,
  invalidateHotelCache
} = require('../utils/availability');

/**
 * ================================
 * CRUD OPERATIONS
 * ================================
 */

/**
 * @desc    Créer une nouvelle chambre
 * @route   POST /api/hotels/:hotelId/rooms
 * @access  Admin uniquement
 */
const createRoom = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const {
      number,
      type,
      floor,
      basePrice,
      description,
      amenities,
      maxOccupancy
    } = req.body;

    // ================================
    // VALIDATIONS PRÉLIMINAIRES
    // ================================
    
    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    // Vérifier que l'hôtel existe
    const hotel = await Hotel.findById(hotelId).select('name code category');
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // VALIDATIONS MÉTIER
    // ================================
    
    // Vérifier type de chambre valide
    if (!Object.values(ROOM_TYPES).includes(type)) {
      return res.status(400).json({
        success: false,
        message: `Type de chambre invalide. Types autorisés: ${Object.values(ROOM_TYPES).join(', ')}`
      });
    }

    // Vérifier unicité numéro chambre dans l'hôtel
    const existingRoom = await Room.findOne({ 
      hotel: hotelId, 
      number: number 
    });
    
    if (existingRoom) {
      return res.status(409).json({
        success: false,
        message: `Chambre numéro ${number} existe déjà dans cet hôtel`
      });
    }

    // Validation prix
    const priceValidation = validatePrice(basePrice);
    if (!priceValidation.valid) {
      return res.status(400).json({
        success: false,
        message: priceValidation.error
      });
    }

    // Validation étage
    if (floor < 0 || floor > 50) {
      return res.status(400).json({
        success: false,
        message: 'Étage invalide (0-50)'
      });
    }

    // ================================
    // CALCUL PRIX SUGGÉRÉ AVEC MULTIPLICATEURS
    // ================================
    
    const pricingInfo = calculateBasePriceWithMultipliers(
      basePrice,
      type,
      hotel.category
    );

    // ================================
    // CRÉATION CHAMBRE
    // ================================
    
    const room = new Room({
      hotel: hotelId,
      number,
      type,
      floor,
      basePrice,
      description,
      amenities: amenities || [],
      maxOccupancy: maxOccupancy || getDefaultOccupancy(type),
      status: ROOM_STATUS.AVAILABLE,
      createdBy: req.user.id
    });

    const savedRoom = await room.save();

    // Invalidation cache availability pour cet hôtel
    invalidateHotelCache(hotelId);

    // Populer les données pour la réponse
    const populatedRoom = await Room.findById(savedRoom._id)
      .populate('hotel', 'name code category')
      .populate('createdBy', 'firstName lastName email')
      .select('-__v');

    // ================================
    // REAL-TIME UPDATES
    // ================================
    
    // Broadcast availability update to all connected users
    await broadcastAvailabilityUpdate(hotelId, 'ROOM_ADDED', {
      room: populatedRoom,
      action: 'added',
      totalRooms: await Room.countDocuments({ hotel: hotelId, status: ROOM_STATUS.AVAILABLE })
    });

    // Notify admins about new room
    await notifyAdminsNewRoom(populatedRoom, hotel);

    // Update real-time availability service
    await availabilityRealtimeService.updateAvailabilityAfterRoomChange(hotelId, 'ADD', populatedRoom);

    res.status(201).json({
      success: true,
      message: 'Chambre créée avec succès',
      data: {
        room: populatedRoom,
        pricingInfo: {
          basePriceEntered: basePrice,
          suggestedAdjustedPrice: pricingInfo.adjustedPrice,
          multipliers: pricingInfo.multipliers
        },
        nextSteps: {
          updateStatus: `/api/rooms/${savedRoom._id}/status`,
          checkAvailability: `/api/rooms/${savedRoom._id}/availability`,
          uploadImages: `/api/rooms/${savedRoom._id}/upload`
        }
      }
    });

  } catch (error) {
    console.error('Erreur création chambre:', error);
    
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
 * @desc    Obtenir toutes les chambres d'un hôtel
 * @route   GET /api/hotels/:hotelId/rooms
 * @access  Admin + Receptionist
 */
const getRoomsByHotel = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const {
      page = 1,
      limit = 20,
      type,
      status,
      floor,
      sortBy = 'floor,number',
      sortOrder = 'asc',
      includeAvailability = false,
      checkInDate,
      checkOutDate,
      realtime = false // New parameter for real-time subscription
    } = req.query;

    if (!mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel invalide'
      });
    }

    // Vérifier que l'hôtel existe
    const hotel = await Hotel.findById(hotelId).select('name code');
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // REAL-TIME SUBSCRIPTION
    // ================================
    
    if (realtime === 'true' && req.user) {
      // Track search session for real-time updates
      availabilityRealtimeService.trackSearchSession(req.user.id, {
        hotelId,
        checkInDate: checkInDate || new Date(),
        checkOutDate: checkOutDate || new Date(),
        filters: { type, status, floor }
      });
    }

    // ================================
    // CONSTRUCTION REQUÊTE
    // ================================
    
    const query = { hotel: hotelId };
    
    // Filtres
    if (type && Object.values(ROOM_TYPES).includes(type)) {
      query.type = type;
    }
    
    if (status && Object.values(ROOM_STATUS).includes(status)) {
      query.status = status;
    }
    
    if (floor !== undefined) {
      query.floor = parseInt(floor);
    }

    // ================================
    // TRI COMPLEXE (étage puis numéro)
    // ================================
    
    const sortOptions = {};
    if (sortBy.includes('floor')) {
      sortOptions.floor = sortOrder === 'desc' ? -1 : 1;
      sortOptions.number = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    // ================================
    // PAGINATION
    // ================================
    
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [rooms, totalCount] = await Promise.all([
      Room.find(query)
        .populate('hotel', 'name code category')
        .populate('createdBy', 'firstName lastName')
        .sort(sortOptions)
        .skip(skip)
        .limit(parseInt(limit))
        .select('-__v'),
      Room.countDocuments(query)
    ]);

    // ================================
    // AJOUT DISPONIBILITÉ SI DEMANDÉ
    // ================================
    
    let roomsWithAvailability = rooms;
    
    if (includeAvailability === 'true' && checkInDate && checkOutDate) {
      // Use real-time availability service
      const availabilityData = await availabilityRealtimeService.getRealTimeAvailability(
        hotelId,
        new Date(checkInDate),
        new Date(checkOutDate)
      );

      roomsWithAvailability = await Promise.all(
        rooms.map(async (room) => {
          const roomAvailability = availabilityData.rooms[room.type] || {};
          
          return {
            ...room.toObject(),
            availability: {
              available: roomAvailability.availableRooms > 0,
              currentPrice: roomAvailability.currentPrice,
              demandLevel: roomAvailability.demandLevel,
              priceChange: roomAvailability.priceChange,
              checkedFor: { checkInDate, checkOutDate }
            }
          };
        })
      );
    }

    // ================================
    // STATISTIQUES RÉSUMÉ
    // ================================
    
    const roomStats = await Room.aggregate([
      { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
      {
        $group: {
          _id: '$type',
          count: { $sum: 1 },
          availableCount: {
            $sum: { $cond: [{ $eq: ['$status', ROOM_STATUS.AVAILABLE] }, 1, 0] }
          },
          avgPrice: { $avg: '$basePrice' }
        }
      }
    ]);

    // Get real-time occupancy if available
    const realtimeOccupancy = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.status(200).json({
      success: true,
      data: {
        hotel: {
          id: hotel._id,
          name: hotel.name,
          code: hotel.code
        },
        rooms: roomsWithAvailability,
        pagination: {
          currentPage: parseInt(page),
          totalPages,
          totalCount,
          hasNextPage: parseInt(page) < totalPages,
          hasPrevPage: parseInt(page) > 1
        },
        statistics: {
          totalRooms: totalCount,
          roomsByType: roomStats,
          filters: { type, status, floor },
          realtimeOccupancy: realtimeOccupancy
        }
      }
    });

  } catch (error) {
    console.error('Erreur récupération chambres:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Obtenir une chambre par ID
 * @route   GET /api/rooms/:id
 * @access  Admin + Receptionist
 */
const getRoomById = async (req, res) => {
  try {
    const { id } = req.params;
    const { includeBookings = false, includeAvailability = false, realtime = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID chambre invalide'
      });
    }

    const room = await Room.findById(id)
      .populate('hotel', 'name code category seasonalPricing')
      .populate('createdBy updatedBy', 'firstName lastName email');

    if (!room) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.ROOM_NOT_FOUND
      });
    }

    // ================================
    // REAL-TIME SUBSCRIPTION
    // ================================
    
    if (realtime === 'true' && req.user) {
      // Subscribe to room-specific updates
      socketService.joinRoomSpecificUpdates(req.user.id, id);
    }

    const responseData = { room };

    // ================================
    // INCLURE RÉSERVATIONS SI DEMANDÉ
    // ================================
    
    if (includeBookings === 'true') {
      const bookings = await Booking.find({
        'rooms.room': id,
        status: { $in: ['Pending', 'Confirmed', 'Checked-in'] }
      })
      .populate('customer', 'firstName lastName email')
      .sort({ checkInDate: 1 })
      .select('checkInDate checkOutDate status totalPrice')
      .limit(10);

      responseData.upcomingBookings = bookings;
    }

    // ================================
    // INCLURE DISPONIBILITÉ SI DEMANDÉ
    // ================================
    
    if (includeAvailability === 'true') {
      const today = new Date();
      const nextWeek = new Date(today.getTime() + (7 * 24 * 60 * 60 * 1000));
      
      try {
        const availability = await isRoomAvailable(id, today, nextWeek);
        
        // Get real-time pricing
        const realtimePricing = await availabilityRealtimeService.getRoomPricing(
          room.hotel._id,
          room.type,
          today,
          nextWeek
        );
        
        responseData.availabilityNext7Days = {
          ...availability,
          pricing: realtimePricing
        };
      } catch (error) {
        responseData.availabilityNext7Days = {
          available: false,
          reason: 'Erreur vérification disponibilité'
        };
      }
    }

    // ================================
    // CALCUL PRIX DYNAMIQUE ACTUEL
    // ================================
    
    const currentPricing = calculateBasePriceWithMultipliers(
      room.basePrice,
      room.type,
      room.hotel.category
    );

    responseData.pricingInfo = {
      currentBasePrice: room.basePrice,
      adjustedPrices: {
        lowSeason: currentPricing.adjustedPrice * 0.8,
        mediumSeason: currentPricing.adjustedPrice,
        highSeason: currentPricing.adjustedPrice * 1.3,
        peakSeason: currentPricing.adjustedPrice * 1.6
      },
      multipliers: currentPricing.multipliers
    };

    res.status(200).json({
      success: true,
      data: responseData
    });

  } catch (error) {
    console.error('Erreur récupération chambre:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Mettre à jour une chambre
 * @route   PUT /api/rooms/:id
 * @access  Admin uniquement
 */
const updateRoom = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID chambre invalide'
      });
    }

    const room = await Room.findById(id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.ROOM_NOT_FOUND
      });
    }

    // ================================
    // VALIDATION UPDATES
    // ================================
    
    const allowedUpdates = [
      'number', 'type', 'floor', 'basePrice', 'description', 
      'amenities', 'maxOccupancy', 'status'
    ];
    
    const updates = {};
    
    for (const field of allowedUpdates) {
      if (req.body[field] !== undefined) {
        // Validations spécifiques
        if (field === 'type' && !Object.values(ROOM_TYPES).includes(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: 'Type de chambre invalide'
          });
        }
        
        if (field === 'status' && !Object.values(ROOM_STATUS).includes(req.body[field])) {
          return res.status(400).json({
            success: false,
            message: 'Statut chambre invalide'
          });
        }
        
        if (field === 'basePrice') {
          const priceValidation = validatePrice(req.body[field]);
          if (!priceValidation.valid) {
            return res.status(400).json({
              success: false,
              message: priceValidation.error
            });
          }
        }
        
        if (field === 'number') {
          // Vérifier unicité nouveau numéro
          const existingRoom = await Room.findOne({
            hotel: room.hotel,
            number: req.body[field],
            _id: { $ne: id }
          });
          
          if (existingRoom) {
            return res.status(409).json({
              success: false,
              message: `Chambre numéro ${req.body[field]} existe déjà`
            });
          }
        }
        
        updates[field] = req.body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Aucune donnée à mettre à jour'
      });
    }

    // ================================
    // VÉRIFICATION STATUT CHANGEMENT
    // ================================
    
    if (updates.status && updates.status !== room.status) {
      const statusChangeValidation = await validateStatusChange(
        room._id,
        room.status,
        updates.status
      );
      
      if (!statusChangeValidation.valid) {
        return res.status(400).json({
          success: false,
          message: statusChangeValidation.message
        });
      }
    }

    // ================================
    // MISE À JOUR
    // ================================
    
    updates.updatedBy = req.user.id;
    updates.updatedAt = new Date();

    const updatedRoom = await Room.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true, runValidators: true }
    )
    .populate('hotel', 'name code category')
    .populate('createdBy updatedBy', 'firstName lastName email');

    // Invalidation cache si changement de statut
    if (updates.status) {
      invalidateHotelCache(room.hotel);
    }

    // ================================
    // REAL-TIME UPDATES
    // ================================
    
    // Broadcast room update
    await broadcastRoomUpdate(updatedRoom, updates);

    // If status changed, broadcast availability update
    if (updates.status) {
      await broadcastAvailabilityUpdate(room.hotel, 'ROOM_STATUS_CHANGED', {
        room: updatedRoom,
        previousStatus: room.status,
        newStatus: updates.status,
        impact: calculateStatusChangeImpact(room.status, updates.status)
      });
    }

    // If price changed, notify price watchers
    if (updates.basePrice) {
      await notifyPriceWatchers(updatedRoom, room.basePrice, updates.basePrice);
    }

    // Update real-time availability service
    await availabilityRealtimeService.updateAvailabilityAfterRoomChange(
      room.hotel,
      'UPDATE',
      updatedRoom,
      updates
    );

    res.status(200).json({
      success: true,
      message: 'Chambre mise à jour avec succès',
      data: { 
        room: updatedRoom,
        changes: Object.keys(updates)
      }
    });

  } catch (error) {
    console.error('Erreur mise à jour chambre:', error);
    
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
 * @desc    Supprimer une chambre
 * @route   DELETE /api/rooms/:id
 * @access  Admin uniquement
 */
const deleteRoom = async (req, res) => {
  try {
    const { id } = req.params;
    const { force = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID chambre invalide'
      });
    }

    const room = await Room.findById(id);
    if (!room) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.ROOM_NOT_FOUND
      });
    }

    // ================================
    // VÉRIFICATIONS SÉCURITÉ
    // ================================
    
    // Vérifier s'il y a des réservations actives
    const activeBookingsCount = await Booking.countDocuments({
      'rooms.room': id,
      status: { $in: ['Pending', 'Confirmed', 'Checked-in'] }
    });

    if (activeBookingsCount > 0) {
      if (force !== 'true') {
        return res.status(409).json({
          success: false,
          message: 'Impossible de supprimer la chambre',
          details: {
            activeBookingsCount,
            solution: 'Utilisez ?force=true pour forcer la suppression'
          }
        });
      }

      // ================================
      // SUPPRESSION FORCÉE
      // ================================
      
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Annuler les réservations actives
          await Booking.updateMany(
            {
              'rooms.room': id,
              status: { $in: ['Pending', 'Confirmed'] }
            },
            {
              $set: { 
                status: 'Cancelled',
                cancellationReason: 'Chambre supprimée par admin',
                cancelledAt: new Date(),
                cancelledBy: req.user.id
              }
            },
            { session }
          );
          
          // Supprimer la chambre
          await Room.findByIdAndDelete(id, { session });
        });
        
        await session.endSession();
        
        // Invalidation cache
        invalidateHotelCache(room.hotel);
        
        // ================================
        // REAL-TIME UPDATES
        // ================================
        
        // Broadcast room deletion
        await broadcastAvailabilityUpdate(room.hotel, 'ROOM_DELETED', {
          roomId: id,
          roomNumber: room.number,
          roomType: room.type,
          cancelledBookings: activeBookingsCount
        });

        // Notify affected customers
        await notifyAffectedCustomers(id, activeBookingsCount);

        // Update real-time availability service
        await availabilityRealtimeService.updateAvailabilityAfterRoomChange(
          room.hotel,
          'DELETE',
          room
        );
        
        res.status(200).json({
          success: true,
          message: 'Chambre et réservations associées supprimées/annulées',
          details: {
            cancelledBookings: activeBookingsCount
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
      
      await Room.findByIdAndDelete(id);
      invalidateHotelCache(room.hotel);
      
      // Real-time updates
      await broadcastAvailabilityUpdate(room.hotel, 'ROOM_DELETED', {
        roomId: id,
        roomNumber: room.number,
        roomType: room.type
      });

      await availabilityRealtimeService.updateAvailabilityAfterRoomChange(
        room.hotel,
        'DELETE',
        room
      );
      
      res.status(200).json({
        success: true,
        message: 'Chambre supprimée avec succès'
      });
    }

  } catch (error) {
    console.error('Erreur suppression chambre:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * GESTION STATUTS CHAMBRES
 * ================================
 */

/**
 * @desc    Changer le statut d'une chambre
 * @route   PUT /api/rooms/:id/status
 * @access  Admin + Receptionist
 */
const updateRoomStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID chambre invalide'
      });
    }

    if (!Object.values(ROOM_STATUS).includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Statut invalide. Statuts autorisés: ${Object.values(ROOM_STATUS).join(', ')}`
      });
    }

    const room = await Room.findById(id).populate('hotel', 'name');
    if (!room) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.ROOM_NOT_FOUND
      });
    }

    // ================================
    // VALIDATION CHANGEMENT STATUT
    // ================================
    
    const statusChangeValidation = await validateStatusChange(
      id,
      room.status,
      status
    );
    
    if (!statusChangeValidation.valid) {
      return res.status(400).json({
        success: false,
        message: statusChangeValidation.message
      });
    }

    // ================================
    // MISE À JOUR STATUT
    // ================================
    
    const updates = {
      status,
      statusHistory: [
        ...(room.statusHistory || []),
        {
          previousStatus: room.status,
          newStatus: status,
          reason: reason || 'Changement manuel',
          changedBy: req.user.id,
          changedAt: new Date()
        }
      ],
      updatedBy: req.user.id,
      updatedAt: new Date()
    };

    const updatedRoom = await Room.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    ).populate('hotel', 'name code');

    // Invalidation cache
    invalidateHotelCache(room.hotel._id);

    // ================================
    // REAL-TIME UPDATES
    // ================================
    
    // Calculate impact on availability
    const impact = calculateStatusChangeImpact(room.status, status);
    
    // Broadcast status change
    await broadcastRoomStatusChange(updatedRoom, room.status, status, impact);

    // Update real-time availability
    await availabilityRealtimeService.updateAvailabilityAfterBooking(
      room.hotel._id,
      {
        rooms: [{
          room: id,
          type: room.type,
          status: status
        }]
      },
      'STATUS_CHANGE'
    );

    // Notify relevant users
    await notifyStatusChangeSubscribers(updatedRoom, room.status, status, reason);

    res.status(200).json({
      success: true,
      message: `Statut chambre changé: ${room.status} → ${status}`,
      data: {
        room: {
          id: updatedRoom._id,
          number: updatedRoom.number,
          type: updatedRoom.type,
          previousStatus: room.status,
          newStatus: status,
          hotel: updatedRoom.hotel
        },
        statusChange: {
          reason: reason || 'Changement manuel',
          changedBy: req.user.id,
          changedAt: new Date(),
          impact: impact
        }
      }
    });

  } catch (error) {
    console.error('Erreur changement statut:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * VÉRIFICATION DISPONIBILITÉ
 * ================================
 */

/**
 * @desc    Vérifier disponibilité d'une chambre spécifique
 * @route   GET /api/rooms/:id/availability
 * @access  Admin + Receptionist
 */
const checkRoomAvailability = async (req, res) => {
  try {
    const { id } = req.params;
    const { checkInDate, checkOutDate, excludeBookingId, realtime = false } = req.query;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'ID chambre invalide'
      });
    }

    if (!checkInDate || !checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Dates d\'arrivée et de départ requises'
      });
    }

    const room = await Room.findById(id).populate('hotel', 'name code');
    if (!room) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.ROOM_NOT_FOUND
      });
    }

    // ================================
    // REAL-TIME AVAILABILITY CHECK
    // ================================
    
    if (realtime === 'true') {
      // Get real-time availability with pricing
      const realtimeAvailability = await availabilityRealtimeService.getRealTimeAvailability(
        room.hotel._id,
        new Date(checkInDate),
        new Date(checkOutDate)
      );

      const roomTypeAvailability = realtimeAvailability.rooms[room.type];
      
      // Subscribe user to availability updates
      if (req.user) {
        availabilityRealtimeService.trackSearchSession(req.user.id, {
          hotelId: room.hotel._id,
          roomId: id,
          checkInDate,
          checkOutDate,
          currency: req.query.currency || 'EUR'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          room: {
            id: room._id,
            number: room.number,
            type: room.type,
            status: room.status,
            hotel: room.hotel
          },
          period: {
            checkInDate,
            checkOutDate
          },
          availability: {
            available: roomTypeAvailability.availableRooms > 0,
            currentPrice: roomTypeAvailability.currentPrice,
            demandLevel: roomTypeAvailability.demandLevel,
            priceChange: roomTypeAvailability.priceChange,
            reason: roomTypeAvailability.availableRooms > 0 ? 'Available' : 'Fully booked'
          },
          realtime: true,
          lastUpdated: roomTypeAvailability.lastUpdated
        }
      });
    }

    // ================================
    // STANDARD AVAILABILITY CHECK
    // ================================
    
    const availability = await isRoomAvailable(
      id,
      new Date(checkInDate),
      new Date(checkOutDate),
      excludeBookingId
    );

    // ================================
    // INFORMATIONS SUPPLÉMENTAIRES
    // ================================
    
    let conflictingBookings = [];
    if (!availability.available) {
      // Trouver les réservations en conflit pour informer l'utilisateur
      conflictingBookings = await Booking.find({
        'rooms.room': id,
        status: { $in: ['Pending', 'Confirmed', 'Checked-in'] },
        $and: [
          { checkOutDate: { $gt: new Date(checkInDate) } },
          { checkInDate: { $lt: new Date(checkOutDate) } }
        ]
      })
      .select('checkInDate checkOutDate status customer')
      .populate('customer', 'firstName lastName')
      .limit(5);
    }

    res.status(200).json({
      success: true,
      data: {
        room: {
          id: room._id,
          number: room.number,
          type: room.type,
          status: room.status,
          hotel: room.hotel
        },
        period: {
          checkInDate,
          checkOutDate
        },
        availability: {
          available: availability.available,
          reason: availability.reason
        },
        conflictingBookings: conflictingBookings.map(booking => ({
          id: booking._id,
          period: {
            checkIn: booking.checkInDate,
            checkOut: booking.checkOutDate
          },
          status: booking.status,
          customer: booking.customer ? 
            `${booking.customer.firstName} ${booking.customer.lastName}` : 
            'Client anonyme'
        }))
      }
    });

  } catch (error) {
    console.error('Erreur vérification disponibilité chambre:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * @desc    Rechercher chambres disponibles
 * @route   GET /api/rooms/search/available
 * @access  Admin + Receptionist + Client (pour réservation)
 */
const searchAvailableRooms = async (req, res) => {
  try {
    const {
      hotelId,
      checkInDate,
      checkOutDate,
      roomType,
      roomsNeeded = 1,
      maxPrice,
      amenities,
      realtime = false,
      currency = 'EUR'
    } = req.query;

    // ================================
    // VALIDATIONS
    // ================================
    
    if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis et valide'
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
    // REAL-TIME AVAILABILITY SEARCH
    // ================================
    
    if (realtime === 'true') {
      // Track search session
      if (req.user) {
        availabilityRealtimeService.trackSearchSession(req.user.id, {
          hotelId,
          checkInDate: checkIn,
          checkOutDate: checkOut,
          currency,
          filters: { roomType, maxPrice, amenities }
        });
      }

      // Get real-time availability with dynamic pricing
      const realtimeData = await availabilityRealtimeService.getRealTimeAvailability(
        hotelId,
        checkIn,
        checkOut,
        currency
      );

      // Filter by room type if specified
      let availableRoomTypes = Object.values(realtimeData.rooms);
      if (roomType) {
        availableRoomTypes = availableRoomTypes.filter(r => r.type === roomType);
      }

      // Filter by max price
      if (maxPrice) {
        availableRoomTypes = availableRoomTypes.filter(r => 
          r.currentPrice <= parseFloat(maxPrice)
        );
      }

      // Check if enough rooms available
      const totalAvailable = availableRoomTypes.reduce((sum, r) => sum + r.availableRooms, 0);

      return res.status(200).json({
        success: true,
        data: {
          searchCriteria: {
            hotelId,
            checkInDate,
            checkOutDate,
            roomType,
            roomsNeeded: parseInt(roomsNeeded),
            maxPrice,
            currency
          },
          availability: {
            found: totalAvailable,
            requested: parseInt(roomsNeeded),
            canAccommodate: totalAvailable >= parseInt(roomsNeeded)
          },
          rooms: availableRoomTypes.map(room => ({
            type: room.type,
            availableCount: room.availableRooms,
            basePrice: room.basePrice,
            currentPrice: room.currentPrice,
            currency: room.currency || currency,
            demandLevel: room.demandLevel,
            priceChange: room.priceChange,
            totalForStay: room.currentPrice * Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24))
          })),
          summary: realtimeData.summary,
          realtime: true,
          lastUpdated: new Date()
        }
      });
    }

    // ================================
    // STANDARD SEARCH (EXISTING CODE)
    // ================================
    
    const availability = await checkAvailability({
      hotelId,
      roomType: roomType || null,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      roomsNeeded: parseInt(roomsNeeded)
    });

    // ================================
    // FILTRAGE SUPPLÉMENTAIRE
    // ================================
    
    let availableRooms = availability.recommendedRooms;

    // Filtre par prix maximum
    if (maxPrice) {
      availableRooms = availableRooms.filter(room => 
        room.basePrice <= parseFloat(maxPrice)
      );
    }

    // Filtre par équipements
    if (amenities) {
      const requiredAmenities = amenities.split(',').map(a => a.trim());
      const roomsWithDetails = await Room.find({
        _id: { $in: availableRooms.map(r => r.id) }
      }).select('amenities');

      const roomAmenitiesMap = {};
      roomsWithDetails.forEach(room => {
        roomAmenitiesMap[room._id.toString()] = room.amenities || [];
      });

      availableRooms = availableRooms.filter(room => {
        const roomAmenities = roomAmenitiesMap[room.id.toString()] || [];
        return requiredAmenities.every(amenity => 
          roomAmenities.some(ra => ra.toLowerCase().includes(amenity.toLowerCase()))
        );
      });
    }

    // ================================
    // CALCUL PRIX POUR CHAQUE CHAMBRE
    // ================================
    
    const { calculateBookingPrice } = require('../utils/pricing');
    const hotel = await Hotel.findById(hotelId).select('category');

    const roomsWithPricing = await Promise.all(
      availableRooms.map(async (room) => {
        try {
          const pricingInfo = calculateBookingPrice({
            basePrice: room.basePrice,
            roomType: room.type,
            hotelCategory: hotel.category,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            numberOfRooms: 1
          });

          return {
            ...room,
            pricing: {
              totalPrice: pricingInfo.totalPrice,
              pricePerNight: pricingInfo.averagePricePerNight,
              nights: pricingInfo.breakdown.nightsCount,
              seasonsSummary: pricingInfo.seasonsSummary
            }
          };
        } catch (error) {
          console.error(`Erreur calcul prix chambre ${room.id}:`, error);
          return {
            ...room,
            pricing: {
              totalPrice: room.basePrice * Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)),
              pricePerNight: room.basePrice,
              nights: Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24)),
              seasonsSummary: []
            }
          };
        }
      })
    );

    // ================================
    // TRI PAR PRIX
    // ================================
    
    roomsWithPricing.sort((a, b) => a.pricing.totalPrice - b.pricing.totalPrice);

    res.status(200).json({
      success: true,
      data: {
        searchCriteria: {
          hotelId,
          checkInDate,
          checkOutDate,
          roomType,
          roomsNeeded: parseInt(roomsNeeded),
          maxPrice,
          amenities
        },
        availability: {
          found: roomsWithPricing.length,
          requested: parseInt(roomsNeeded),
          canAccommodate: roomsWithPricing.length >= parseInt(roomsNeeded)
        },
        rooms: roomsWithPricing,
        alternatives: availability.alternatives,
        statistics: availability.statistics
      }
    });

  } catch (error) {
    console.error('Erreur recherche chambres disponibles:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * ATTRIBUTION AUTOMATIQUE CHAMBRES
 * ================================
 */

/**
 * @desc    Attribuer automatiquement des chambres pour check-in
 * @route   POST /api/rooms/auto-assign
 * @access  Receptionist + Admin
 */
const autoAssignRooms = async (req, res) => {
  try {
    const { 
      bookingId,
      preferences = {}
    } = req.body;

    if (!mongoose.Types.ObjectId.isValid(bookingId)) {
      return res.status(400).json({
        success: false,
        message: 'ID réservation invalide'
      });
    }

    // ================================
    // RÉCUPÉRATION RÉSERVATION
    // ================================
    
    const booking = await Booking.findById(bookingId)
      .populate('hotel', 'name code')
      .populate('customer', 'firstName lastName');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Réservation non trouvée'
      });
    }

    if (booking.status !== 'Confirmed') {
      return res.status(400).json({
        success: false,
        message: 'Seules les réservations confirmées peuvent être assignées'
      });
    }

    // ================================
    // VÉRIFICATION DISPONIBILITÉ
    // ================================
    
    const roomsToAssign = [];
    const assignmentErrors = [];

    for (const roomBooking of booking.rooms) {
      try {
        const availability = await checkAvailability({
          hotelId: booking.hotel._id,
          roomType: roomBooking.type,
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          roomsNeeded: 1,
          excludeBookingId: bookingId
        });

        if (availability.available && availability.recommendedRooms.length > 0) {
          // Appliquer préférences d'attribution
          let selectedRoom = availability.recommendedRooms[0];

          // Préférence étage
          if (preferences.preferredFloor) {
            const roomOnPreferredFloor = availability.recommendedRooms.find(
              room => room.floor === parseInt(preferences.preferredFloor)
            );
            if (roomOnPreferredFloor) {
              selectedRoom = roomOnPreferredFloor;
            }
          }

          // Préférence chambres adjacentes (pour groupes)
          if (preferences.adjacentRooms && roomsToAssign.length > 0) {
            const lastAssignedFloor = roomsToAssign[roomsToAssign.length - 1].floor;
            const adjacentRoom = availability.recommendedRooms.find(
              room => room.floor === lastAssignedFloor && 
                     Math.abs(parseInt(room.number) - parseInt(roomsToAssign[roomsToAssign.length - 1].number)) <= 2
            );
            if (adjacentRoom) {
              selectedRoom = adjacentRoom;
            }
          }

          roomsToAssign.push({
            bookingRoomId: roomBooking._id,
            roomId: selectedRoom.id,
            roomNumber: selectedRoom.number,
            roomType: selectedRoom.type,
            floor: selectedRoom.floor
          });
        } else {
          assignmentErrors.push({
            roomType: roomBooking.type,
            error: 'Aucune chambre disponible'
          });
        }
      } catch (error) {
        assignmentErrors.push({
          roomType: roomBooking.type,
          error: error.message
        });
      }
    }

    // ================================
    // VÉRIFICATION ATTRIBUTION COMPLÈTE
    // ================================
    
    if (assignmentErrors.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'Attribution impossible pour certaines chambres',
        data: {
          assignmentErrors,
          partialAssignment: roomsToAssign
        }
      });
    }

    // ================================
    // MISE À JOUR RÉSERVATION
    // ================================
    
    const session = await mongoose.startSession();
    
    try {
      await session.withTransaction(async () => {
        // Mettre à jour les room assignments dans la réservation
        for (const assignment of roomsToAssign) {
          await Booking.updateOne(
            { 
              _id: bookingId,
              'rooms._id': assignment.bookingRoomId 
            },
            {
              $set: {
                'rooms.$.room': assignment.roomId,
                'rooms.$.assignedAt': new Date(),
                'rooms.$.assignedBy': req.user.id
              }
            },
            { session }
          );
        }

        // Marquer les chambres comme occupées
        const roomIds = roomsToAssign.map(a => a.roomId);
        await Room.updateMany(
          { _id: { $in: roomIds } },
          { 
            $set: { 
              status: ROOM_STATUS.OCCUPIED,
              currentBooking: bookingId,
              updatedBy: req.user.id,
              updatedAt: new Date()
            }
          },
          { session }
        );
      });
      
      await session.endSession();

      // Invalidation cache
      invalidateHotelCache(booking.hotel._id);

      // ================================
      // REAL-TIME UPDATES
      // ================================
      
      // Broadcast room assignments
      await broadcastRoomAssignments(booking, roomsToAssign);

      // Update availability in real-time
      await availabilityRealtimeService.updateAvailabilityAfterBooking(
        booking.hotel._id,
        {
          checkInDate: booking.checkInDate,
          checkOutDate: booking.checkOutDate,
          rooms: roomsToAssign.map(a => ({
            room: a.roomId,
            type: a.roomType,
            quantity: 1
          }))
        },
        'ASSIGN'
      );

      // Notify customer about room assignment
      await notificationService.sendNotification({
        type: 'ROOM_ASSIGNED',
        userId: booking.customer._id,
        channels: ['socket', 'sms'],
        data: {
          booking: booking,
          assignments: roomsToAssign.map(a => ({
            roomNumber: a.roomNumber,
            floor: a.floor,
            type: a.roomType
          })),
          message: `Chambres attribuées: ${roomsToAssign.map(a => a.roomNumber).join(', ')}`
        },
        priority: 'high'
      });

      res.status(200).json({
        success: true,
        message: 'Chambres attribuées avec succès',
        data: {
          booking: {
            id: booking._id,
            customer: `${booking.customer.firstName} ${booking.customer.lastName}`,
            checkInDate: booking.checkInDate,
            checkOutDate: booking.checkOutDate
          },
          assignments: roomsToAssign.map(assignment => ({
            roomNumber: assignment.roomNumber,
            roomType: assignment.roomType,
            floor: assignment.floor
          })),
          readyForCheckIn: true
        }
      });

    } catch (transactionError) {
      await session.endSession();
      throw transactionError;
    }

  } catch (error) {
    console.error('Erreur attribution automatique:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de l\'attribution'
    });
  }
};

/**
 * ================================
 * REAL-TIME HELPER FUNCTIONS
 * ================================
 */

/**
 * Broadcast availability update to all connected users
 */
const broadcastAvailabilityUpdate = async (hotelId, eventType, data) => {
  try {
    // Use socketService to broadcast
    socketService.broadcastAvailabilityUpdate(hotelId, {
      eventType,
      ...data,
      timestamp: new Date()
    });

    // Also send hotel-wide notification
    socketService.sendHotelNotification(hotelId, 'availability-changed', {
      eventType,
      ...data
    });

    console.log(`Broadcasted availability update: ${eventType} for hotel ${hotelId}`);
  } catch (error) {
    console.error('Error broadcasting availability update:', error);
  }
};

/**
 * Broadcast room-specific update
 */
const broadcastRoomUpdate = async (room, changes) => {
  try {
    const updateData = {
      roomId: room._id,
      roomNumber: room.number,
      roomType: room.type,
      changes: Object.keys(changes),
      newValues: changes,
      hotel: {
        id: room.hotel._id,
        name: room.hotel.name
      },
      timestamp: new Date()
    };

    // Broadcast to hotel staff
    socketService.sendHotelNotification(room.hotel._id, 'room-updated', updateData);

    // Broadcast to admins
    socketService.sendAdminNotification('room-updated', updateData);

    console.log(`Broadcasted room update for room ${room.number}`);
  } catch (error) {
    console.error('Error broadcasting room update:', error);
  }
};

/**
 * Broadcast room status change
 */
const broadcastRoomStatusChange = async (room, oldStatus, newStatus, impact) => {
  try {
    const statusChangeData = {
      roomId: room._id,
      roomNumber: room.number,
      roomType: room.type,
      oldStatus,
      newStatus,
      impact,
      hotel: {
        id: room.hotel._id,
        name: room.hotel.name
      },
      timestamp: new Date()
    };

    // Broadcast to all relevant channels
    socketService.broadcastAvailabilityUpdate(room.hotel._id, statusChangeData);
    socketService.sendHotelNotification(room.hotel._id, 'room-status-changed', statusChangeData);
    socketService.sendAdminNotification('room-status-changed', statusChangeData);

    console.log(`Broadcasted room status change: ${oldStatus} -> ${newStatus}`);
  } catch (error) {
    console.error('Error broadcasting room status change:', error);
  }
};

/**
 * Broadcast room assignments for check-in
 */
const broadcastRoomAssignments = async (booking, assignments) => {
  try {
    const assignmentData = {
      bookingId: booking._id,
      confirmationNumber: booking.confirmationNumber,
      customer: {
        id: booking.customer._id,
        name: `${booking.customer.firstName} ${booking.customer.lastName}`
      },
      assignments: assignments.map(a => ({
        roomNumber: a.roomNumber,
        roomType: a.roomType,
        floor: a.floor
      })),
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      timestamp: new Date()
    };

    // Notify hotel staff
    socketService.sendHotelNotification(booking.hotel._id, 'rooms-assigned', assignmentData);

    // Notify customer
    socketService.sendUserNotification(booking.customer._id, 'rooms-assigned', assignmentData);

    console.log(`Broadcasted room assignments for booking ${booking.confirmationNumber}`);
  } catch (error) {
    console.error('Error broadcasting room assignments:', error);
  }
};

/**
 * Notify admins about new room
 */
const notifyAdminsNewRoom = async (room, hotel) => {
  try {
    await notificationService.sendNotification({
      type: 'NEW_ROOM_ADDED',
      userId: 'ADMIN_BROADCAST', // Special identifier for admin broadcast
      channels: ['socket'],
      data: {
        room: {
          id: room._id,
          number: room.number,
          type: room.type,
          floor: room.floor,
          basePrice: room.basePrice
        },
        hotel: {
          id: hotel._id,
          name: hotel.name,
          code: hotel.code
        },
        message: `Nouvelle chambre ajoutée: ${room.number} - ${hotel.name}`
      }
    });
  } catch (error) {
    console.error('Error notifying admins about new room:', error);
  }
};

/**
 * Notify price watchers about price changes
 */
const notifyPriceWatchers = async (room, oldPrice, newPrice) => {
  try {
    const priceChangeData = {
      roomId: room._id,
      roomNumber: room.number,
      roomType: room.type,
      hotel: {
        id: room.hotel._id,
        name: room.hotel.name
      },
      oldPrice,
      newPrice,
      changeAmount: newPrice - oldPrice,
      changePercentage: ((newPrice - oldPrice) / oldPrice) * 100,
      timestamp: new Date()
    };

    // Broadcast price change
    socketService.broadcastAvailabilityUpdate(room.hotel._id, {
      eventType: 'PRICE_CHANGED',
      ...priceChangeData
    });

    console.log(`Notified price watchers for room ${room.number}`);
  } catch (error) {
    console.error('Error notifying price watchers:', error);
  }
};

/**
 * Notify customers affected by room deletion
 */
const notifyAffectedCustomers = async (roomId, cancelledCount) => {
  try {
    if (cancelledCount > 0) {
      // Find affected bookings and notify customers
      const affectedBookings = await Booking.find({
        'rooms.room': roomId,
        status: 'Cancelled',
        cancelledAt: { $gte: new Date(Date.now() - 60000) } // Last minute
      }).populate('customer');

      for (const booking of affectedBookings) {
        await notificationService.sendNotification({
          type: 'BOOKING_CANCELLED_ROOM_DELETED',
          userId: booking.customer._id,
          channels: ['email', 'sms', 'socket'],
          data: {
            booking: booking,
            reason: 'La chambre réservée a été supprimée',
            message: 'Votre réservation a été annulée car la chambre n\'est plus disponible'
          },
          priority: 'high'
        });
      }
    }
  } catch (error) {
    console.error('Error notifying affected customers:', error);
  }
};

/**
 * Notify subscribers about room status changes
 */
const notifyStatusChangeSubscribers = async (room, oldStatus, newStatus, reason) => {
  try {
    // This would integrate with a subscription service
    // For now, we'll notify hotel staff and admins
    const statusChangeData = {
      room: {
        id: room._id,
        number: room.number,
        type: room.type
      },
      hotel: {
        id: room.hotel._id,
        name: room.hotel.name
      },
      oldStatus,
      newStatus,
      reason,
      timestamp: new Date()
    };

    await notificationService.emit('room:status_changed', statusChangeData);
  } catch (error) {
    console.error('Error notifying status change subscribers:', error);
  }
};

/**
 * Calculate impact of status change on availability
 */
const calculateStatusChangeImpact = (oldStatus, newStatus) => {
  const impact = {
    availabilityChange: 0,
    urgency: 'low',
    requiresAction: false
  };

  // Going from available to unavailable
  if (oldStatus === ROOM_STATUS.AVAILABLE && newStatus !== ROOM_STATUS.AVAILABLE) {
    impact.availabilityChange = -1;
    impact.urgency = 'medium';
  }

  // Going from unavailable to available
  if (oldStatus !== ROOM_STATUS.AVAILABLE && newStatus === ROOM_STATUS.AVAILABLE) {
    impact.availabilityChange = 1;
    impact.urgency = 'high';
    impact.requiresAction = true;
  }

  // Maintenance or out of order
  if (newStatus === ROOM_STATUS.MAINTENANCE || newStatus === ROOM_STATUS.OUT_OF_ORDER) {
    impact.urgency = 'high';
    impact.requiresAction = true;
  }

  return impact;
};

/**
 * ================================
 * UTILITAIRES INTERNES
 * ================================
 */

/**
 * Obtient l'occupation par défaut selon le type de chambre
 */
const getDefaultOccupancy = (roomType) => {
  const { ROOM_CAPACITIES } = require('../utils/constants');
  return ROOM_CAPACITIES[roomType] || 2;
};

/**
 * Valide un changement de statut de chambre
 */
const validateStatusChange = async (roomId, currentStatus, newStatus) => {
  // Transitions autorisées
  const allowedTransitions = {
    [ROOM_STATUS.AVAILABLE]: [ROOM_STATUS.OCCUPIED, ROOM_STATUS.MAINTENANCE, ROOM_STATUS.OUT_OF_ORDER],
    [ROOM_STATUS.OCCUPIED]: [ROOM_STATUS.AVAILABLE, ROOM_STATUS.MAINTENANCE],
    [ROOM_STATUS.MAINTENANCE]: [ROOM_STATUS.AVAILABLE, ROOM_STATUS.OUT_OF_ORDER],
    [ROOM_STATUS.OUT_OF_ORDER]: [ROOM_STATUS.MAINTENANCE, ROOM_STATUS.AVAILABLE]
  };

  if (!allowedTransitions[currentStatus]?.includes(newStatus)) {
    return {
      valid: false,
      message: `Transition ${currentStatus} → ${newStatus} non autorisée`
    };
  }

  // Vérifications spéciales
  if (newStatus === ROOM_STATUS.AVAILABLE && currentStatus === ROOM_STATUS.OCCUPIED) {
    // Vérifier qu'il n'y a pas de réservation active
    const activeBooking = await Booking.findOne({
      'rooms.room': roomId,
      status: { $in: ['Confirmed', 'Checked-in'] },
      checkInDate: { $lte: new Date() },
      checkOutDate: { $gt: new Date() }
    });

    if (activeBooking) {
      return {
        valid: false,
        message: 'Impossible de libérer une chambre avec réservation active'
      };
    }
  }

  return { valid: true };
};

/**
 * ================================
 * STATISTIQUES CHAMBRES
 * ================================
 */

/**
 * @desc    Obtenir statistiques d'occupation des chambres
 * @route   GET /api/rooms/stats/occupancy
 * @access  Admin + Receptionist
 */
const getRoomOccupancyStats = async (req, res) => {
  try {
    const { 
      hotelId,
      period = '30d',
      groupBy = 'day', // day, week, month
      realtime = false
    } = req.query;

    if (!hotelId || !mongoose.Types.ObjectId.isValid(hotelId)) {
      return res.status(400).json({
        success: false,
        message: 'ID hôtel requis et valide'
      });
    }

    const hotel = await Hotel.findById(hotelId).select('name code');
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: ERROR_MESSAGES.HOTEL_NOT_FOUND
      });
    }

    // ================================
    // REAL-TIME STATISTICS
    // ================================
    
    if (realtime === 'true') {
      const realtimeStats = await availabilityRealtimeService.getRealTimeOccupancy(hotelId);
      
      // Subscribe to real-time updates
      if (req.user) {
        socketService.sendUserNotification(req.user.id, 'occupancy-stats-subscribed', {
          hotelId,
          message: 'Subscribed to real-time occupancy updates'
        });
      }

      return res.status(200).json({
        success: true,
        data: {
          hotel: {
            id: hotel._id,
            name: hotel.name,
            code: hotel.code
          },
          realtime: true,
          currentOccupancy: realtimeStats,
          liveUpdates: true,
          lastUpdated: new Date()
        }
      });
    }

    // ================================
    // CALCUL PÉRIODE
    // ================================
    
    const endDate = new Date();
    const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
    const days = daysMap[period] || 30;
    const startDate = new Date(endDate.getTime() - (days * 24 * 60 * 60 * 1000));

    // ================================
    // STATISTIQUES GLOBALES
    // ================================
    
    const [roomStats, occupancyStats] = await Promise.all([
      // Stats par type de chambre
      Room.aggregate([
        { $match: { hotel: new mongoose.Types.ObjectId(hotelId) } },
        {
          $group: {
            _id: '$type',
            totalRooms: { $sum: 1 },
            availableRooms: {
              $sum: { $cond: [{ $eq: ['$status', ROOM_STATUS.AVAILABLE] }, 1, 0] }
            },
            occupiedRooms: {
              $sum: { $cond: [{ $eq: ['$status', ROOM_STATUS.OCCUPIED] }, 1, 0] }
            },
            maintenanceRooms: {
              $sum: { $cond: [{ $eq: ['$status', ROOM_STATUS.MAINTENANCE] }, 1, 0] }
            },
            avgPrice: { $avg: '$basePrice' }
          }
        }
      ]),

      // Stats d'occupation par période
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
              $dateToString: {
                format: groupBy === 'day' ? '%Y-%m-%d' : 
                        groupBy === 'week' ? '%Y-%U' : '%Y-%m',
                date: '$checkInDate'
              }
            },
            bookings: { $sum: 1 },
            roomsBooked: { $sum: { $size: '$rooms' } },
            revenue: { $sum: '$totalPrice' }
          }
        },
        { $sort: { _id: 1 } }
      ])
    ]);

    // ================================
    // CALCUL TAUX D'OCCUPATION
    // ================================
    
    const totalRooms = roomStats.reduce((sum, stat) => sum + stat.totalRooms, 0);
    const currentOccupiedRooms = roomStats.reduce((sum, stat) => sum + stat.occupiedRooms, 0);
    const currentOccupancyRate = totalRooms > 0 ? 
      Math.round((currentOccupiedRooms / totalRooms) * 100) : 0;

    res.status(200).json({
      success: true,
      data: {
        hotel: {
          id: hotel._id,
          name: hotel.name,
          code: hotel.code
        },
        period: {
          start: startDate,
          end: endDate,
          groupBy
        },
        currentOccupancy: {
          totalRooms,
          occupiedRooms: currentOccupiedRooms,
          availableRooms: roomStats.reduce((sum, stat) => sum + stat.availableRooms, 0),
          maintenanceRooms: roomStats.reduce((sum, stat) => sum + stat.maintenanceRooms, 0),
          occupancyRate: currentOccupancyRate
        },
        roomTypeBreakdown: roomStats.map(stat => ({
          type: stat._id,
          total: stat.totalRooms,
          available: stat.availableRooms,
          occupied: stat.occupiedRooms,
          maintenance: stat.maintenanceRooms,
          occupancyRate: Math.round((stat.occupiedRooms / stat.totalRooms) * 100),
          averagePrice: Math.round(stat.avgPrice * 100) / 100
        })),
        occupancyTrends: occupancyStats.map(stat => ({
          period: stat._id,
          bookings: stat.bookings,
          roomsBooked: stat.roomsBooked,
          revenue: Math.round(stat.revenue * 100) / 100,
          averageRoomsPerBooking: Math.round((stat.roomsBooked / stat.bookings) * 100) / 100
        }))
      }
    });

  } catch (error) {
    console.error('Erreur statistiques occupation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur'
    });
  }
};

/**
 * ================================
 * REAL-TIME LIVE SEARCH
 * ================================
 */

/**
 * @desc    Live search with real-time updates
 * @route   POST /api/rooms/live-search
 * @access  All authenticated users
 */
const liveSearchRooms = async (req, res) => {
  try {
    const {
      hotelId,
      checkInDate,
      checkOutDate,
      roomType,
      maxPrice,
      guests = 1,
      subscribeToupdates = true
    } = req.body;

    // Validation
    if (!hotelId || !checkInDate || !checkOutDate) {
      return res.status(400).json({
        success: false,
        message: 'Hotel ID and dates are required'
      });
    }

    // Create search session
    const searchSessionId = `search_${req.user.id}_${Date.now()}`;
    
    // Track search session for real-time updates
    if (subscribeToupdates) {
      availabilityRealtimeService.trackSearchSession(req.user.id, {
        sessionId: searchSessionId,
        hotelId,
        checkInDate: new Date(checkInDate),
        checkOutDate: new Date(checkOutDate),
        filters: { roomType, maxPrice, guests },
        currency: req.body.currency || 'EUR'
      });

      // Join search-specific room for updates
      socketService.sendUserNotification(req.user.id, 'search-session-created', {
        sessionId: searchSessionId,
        message: 'You will receive real-time updates for this search'
      });
    }

    // Get real-time availability
    const availability = await availabilityRealtimeService.getRealTimeAvailability(
      hotelId,
      new Date(checkInDate),
      new Date(checkOutDate),
      req.body.currency || 'EUR'
    );

    // Filter results based on criteria
    let results = Object.values(availability.rooms).filter(room => {
      if (roomType && room.type !== roomType) return false;
      if (maxPrice && room.currentPrice > maxPrice) return false;
      if (room.availableRooms < 1) return false;
      return true;
    });

    res.status(200).json({
      success: true,
      data: {
        searchSessionId,
        subscribedToUpdates: subscribeToupdates,
        results: results.map(room => ({
          type: room.type,
          availableCount: room.availableRooms,
          price: {
            current: room.currentPrice,
            base: room.basePrice,
            currency: room.currency || 'EUR',
            demandLevel: room.demandLevel,
            priceChange: room.priceChange
          },
          totalForStay: room.currentPrice * Math.ceil((new Date(checkOutDate) - new Date(checkInDate)) / (1000 * 60 * 60 * 24))
        })),
        summary: availability.summary,
        lastUpdated: new Date()
      }
    });

  } catch (error) {
    console.error('Error in live search:', error);
    res.status(500).json({
      success: false,
      message: 'Error performing live search'
    });
  }
};

/**
 * ================================
 * REAL-TIME AVAILABILITY MONITORING
 * ================================
 */

/**
 * @desc    Monitor availability changes for specific criteria
 * @route   POST /api/rooms/monitor-availability
 * @access  Authenticated users
 */
const monitorAvailability = async (req, res) => {
  try {
    const {
      hotelId,
      checkInDate,
      checkOutDate,
      roomType,
      targetPrice,
      notifyWhen = 'AVAILABLE' // AVAILABLE, PRICE_DROP, BOTH
    } = req.body;

    // Create monitoring session
    const monitoringId = `monitor_${req.user.id}_${Date.now()}`;
    
    // Register monitoring with real-time service
    const monitoringSession = {
      id: monitoringId,
      userId: req.user.id,
      hotelId,
      checkInDate: new Date(checkInDate),
      checkOutDate: new Date(checkOutDate),
      criteria: {
        roomType,
        targetPrice,
        notifyWhen
      },
      createdAt: new Date()
    };

    // This would be stored in a monitoring service
    // For now, we'll just track it in the session
    availabilityRealtimeService.trackSearchSession(req.user.id, monitoringSession);

    // Send confirmation
    socketService.sendUserNotification(req.user.id, 'monitoring-activated', {
      monitoringId,
      message: 'Availability monitoring activated. You will be notified of changes.',
      criteria: monitoringSession.criteria
    });

    res.status(200).json({
      success: true,
      data: {
        monitoringId,
        status: 'ACTIVE',
        criteria: monitoringSession.criteria,
        message: 'You will receive notifications when your criteria are met'
      }
    });

  } catch (error) {
    console.error('Error setting up availability monitoring:', error);
    res.status(500).json({
      success: false,
      message: 'Error setting up monitoring'
    });
  }
};

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // CRUD principal
  createRoom,
  getRoomsByHotel,
  getRoomById,
  updateRoom,
  deleteRoom,
  
  // Gestion statuts
  updateRoomStatus,
  
  // Disponibilité
  checkRoomAvailability,
  searchAvailableRooms,
  
  // Attribution automatique
  autoAssignRooms,
  
  // Statistiques
  getRoomOccupancyStats,
  
  // Real-time features
  liveSearchRooms,
  monitorAvailability,
  
  // Utilitaires (pour tests)
  validateStatusChange,
  getDefaultOccupancy,
  
  // Real-time helpers (for internal use)
  broadcastAvailabilityUpdate,
  broadcastRoomUpdate,
  broadcastRoomStatusChange,
  calculateStatusChangeImpact
};