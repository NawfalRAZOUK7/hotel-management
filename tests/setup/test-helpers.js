const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Models
const User = require('../../src/models/User');
const Hotel = require('../../src/models/Hotel');
const Room = require('../../src/models/Room');
const Booking = require('../../src/models/Booking');

// Utils
const jwtUtils = require('../../src/utils/jwt');
const { 
  ROOM_TYPES, 
  ROOM_STATUS, 
  BOOKING_STATUS, 
  BOOKING_SOURCES,
  CLIENT_TYPES,
  USER_ROLES,
  HOTEL_CATEGORIES,
  SEASONS
} = require('../../src/utils/constants');

/**
 * ================================
 * WEEK 2 - ADVANCED DATA GENERATORS
 * ================================
 */

/**
 * Générateur de données utilisateur de test (UPDATED)
 */
const createUserData = ({
  firstName = 'Test',
  lastName = 'User',
  email = null,
  password = 'password123',
  phone = '+212612345678',
  role = USER_ROLES.CLIENT,
  clientType = CLIENT_TYPES.INDIVIDUAL,
  companyName = null,
  siret = null,
  address = null,
  isEmailVerified = true,
  isActive = true
} = {}) => {
  // Générer un email unique si non fourni
  const uniqueEmail = email || `test${Date.now()}${Math.floor(Math.random() * 1000)}@test.com`;
  
  const userData = {
    firstName,
    lastName,
    email: uniqueEmail,
    password,
    phone,
    role,
    clientType,
    isEmailVerified,
    isActive,
    address: address || `${Math.floor(Math.random() * 999)} Rue Test, Rabat`
  };

  // Ajouter les données d'entreprise si corporate
  if (clientType === CLIENT_TYPES.CORPORATE || companyName) {
    userData.clientType = CLIENT_TYPES.CORPORATE;
    userData.companyName = companyName || 'Test Company SARL';
    userData.siret = siret || generateTestSiret();
  }

  return userData;
};

/**
 * Générateur de données hôtel de test (UPDATED WEEK 2)
 */
const createHotelData = ({
  code = null,
  name = 'Test Hotel Atlas',
  address = '123 Avenue Mohammed V',
  city = 'Rabat',
  postalCode = '10000',
  phone = '+212537123456',
  email = null,
  category = HOTEL_CATEGORIES.FOUR_STAR,
  description = 'Hôtel de test moderne',
  amenities = ['WiFi gratuit', 'Piscine', 'Restaurant', 'Spa'],
  seasonalPricing = null,
  createdBy = null
} = {}) => {
  // Générer un code unique si non fourni
  const uniqueCode = code || `TST${Date.now().toString().slice(-3)}`;
  const uniqueEmail = email || `contact@${uniqueCode.toLowerCase()}.ma`;

  const hotelData = {
    code: uniqueCode,
    name,
    address,
    city,
    postalCode,
    phone,
    email: uniqueEmail,
    category,
    description,
    amenities,
    createdBy,
    isActive: true
  };

  // Ajouter pricing saisonnier si fourni
  if (seasonalPricing) {
    hotelData.seasonalPricing = seasonalPricing;
  } else {
    hotelData.seasonalPricing = createDefaultSeasonalPricing();
  }

  return hotelData;
};

/**
 * Générateur de données chambre de test (UPDATED WEEK 2)
 */
const createRoomData = ({
  number = null,
  floor = 1,
  type = ROOM_TYPES.DOUBLE,
  hotelId = null,
  basePrice = 250,
  status = ROOM_STATUS.AVAILABLE,
  description = null,
  amenities = ['WiFi', 'TV', 'Climatisation'],
  maxOccupancy = null,
  images = [],
  createdBy = null
} = {}) => {
  // Générer un numéro unique si non fourni
  const uniqueNumber = number || `${floor}${String(Date.now()).slice(-2)}`;

  return {
    hotel: hotelId,
    number: uniqueNumber,
    type,
    floor,
    basePrice,
    status,
    description: description || `Chambre ${type} confortable`,
    amenities,
    maxOccupancy: maxOccupancy || getDefaultMaxOccupancy(type),
    images,
    createdBy,
    isActive: true
  };
};

/**
 * Générateur de données réservation de test (UPDATED WEEK 2)
 */
const createBookingData = ({
  hotelId = null,
  customerId = null,
  rooms = null,
  checkInDate = null,
  checkOutDate = null,
  numberOfGuests = 2,
  status = BOOKING_STATUS.PENDING,
  source = BOOKING_SOURCES.WEB,
  clientType = CLIENT_TYPES.INDIVIDUAL,
  specialRequests = '',
  corporateDetails = null,
  extras = [],
  createdBy = null
} = {}) => {
  // Dates par défaut : demain et après-demain
  const defaultCheckIn = checkInDate || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const defaultCheckOut = checkOutDate || new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  // Rooms par défaut
  const defaultRooms = rooms || [{
    type: ROOM_TYPES.DOUBLE,
    basePrice: 250,
    calculatedPrice: 750, // 3 nuits
    room: null, // Sera assigné plus tard
    assignedAt: null,
    assignedBy: null
  }];

  // Calcul prix total
  const roomsTotal = defaultRooms.reduce((sum, room) => sum + (room.calculatedPrice || room.basePrice * 3), 0);
  const extrasTotal = extras.reduce((sum, extra) => sum + (extra.price * extra.quantity), 0);
  const totalPrice = roomsTotal + extrasTotal;

  const bookingData = {
    hotel: hotelId,
    customer: customerId,
    checkInDate: defaultCheckIn,
    checkOutDate: defaultCheckOut,
    rooms: defaultRooms,
    numberOfGuests,
    totalPrice,
    status,
    source,
    clientType,
    specialRequests,
    extras,
    extrasTotal,
    createdBy,
    paymentStatus: 'Pending',
    cancellationPolicy: generateTestCancellationPolicy()
  };

  // Ajouter détails corporate si nécessaire
  if (clientType === CLIENT_TYPES.CORPORATE && corporateDetails) {
    bookingData.corporateDetails = corporateDetails;
  }

  return bookingData;
};

/**
 * ================================
 * WEEK 2 - SPECIALIZED CREATORS
 * ================================
 */

/**
 * Créer un hôtel complet avec chambres et pricing
 */
const createCompleteTestHotel = async (creatorId = null) => {
  // Créer le créateur si non fourni
  let creator = creatorId;
  if (!creator) {
    const adminUser = await createUserWithRole(USER_ROLES.ADMIN);
    creator = adminUser._id;
  }

  // Créer l'hôtel
  const hotelData = createHotelData({ createdBy: creator });
  const hotel = new Hotel(hotelData);
  await hotel.save();

  // Créer des chambres de chaque type
  const rooms = [];
  const roomConfigs = [
    { type: ROOM_TYPES.SIMPLE, count: 5, basePrice: 150, floor: 1 },
    { type: ROOM_TYPES.DOUBLE, count: 8, basePrice: 250, floor: 2 },
    { type: ROOM_TYPES.DOUBLE_COMFORT, count: 5, basePrice: 350, floor: 3 },
    { type: ROOM_TYPES.SUITE, count: 2, basePrice: 600, floor: 4 }
  ];

  for (const config of roomConfigs) {
    for (let i = 1; i <= config.count; i++) {
      const roomData = createRoomData({
        number: `${config.floor}${String(i).padStart(2, '0')}`,
        floor: config.floor,
        type: config.type,
        hotelId: hotel._id,
        basePrice: config.basePrice,
        createdBy: creator
      });
      
      const room = new Room(roomData);
      await room.save();
      rooms.push(room);
    }
  }

  return { hotel, rooms, creator };
};

/**
 * Créer une réservation complète avec workflow
 */
const createCompleteTestBooking = async ({
  hotelId = null,
  customerId = null,
  status = BOOKING_STATUS.PENDING,
  withRoomAssignment = false,
  withExtras = false
} = {}) => {
  // Créer hôtel si non fourni
  let hotel = hotelId;
  let availableRooms = [];
  if (!hotel) {
    const hotelData = await createCompleteTestHotel();
    hotel = hotelData.hotel._id;
    availableRooms = hotelData.rooms;
  } else {
    availableRooms = await Room.find({ hotel, status: ROOM_STATUS.AVAILABLE });
  }

  // Créer client si non fourni
  let customer = customerId;
  if (!customer) {
    const testUser = await createTestUser();
    customer = testUser._id;
  }

  // Créer réservation
  const rooms = [{
    type: ROOM_TYPES.DOUBLE,
    basePrice: 250,
    calculatedPrice: 750,
    room: withRoomAssignment ? availableRooms[0]._id : null,
    assignedAt: withRoomAssignment ? new Date() : null,
    assignedBy: withRoomAssignment ? customer : null
  }];

  const extras = withExtras ? [
    { name: 'Mini-bar', category: 'Boissons', price: 45, quantity: 2, total: 90 },
    { name: 'Room service', category: 'Restauration', price: 85, quantity: 1, total: 85 }
  ] : [];

  const bookingData = createBookingData({
    hotelId: hotel,
    customerId: customer,
    rooms,
    status,
    extras
  });

  const booking = new Booking(bookingData);
  await booking.save();

  // Marquer chambre comme occupée si assignée
  if (withRoomAssignment && rooms[0].room) {
    await Room.findByIdAndUpdate(rooms[0].room, {
      status: ROOM_STATUS.OCCUPIED,
      currentBooking: booking._id
    });
  }

  return booking;
};

/**
 * ================================
 * WEEK 2 - BUSINESS LOGIC HELPERS
 * ================================
 */

/**
 * Créer des données de pricing saisonnier par défaut
 */
const createDefaultSeasonalPricing = () => {
  return [
    {
      roomType: ROOM_TYPES.SIMPLE,
      season: SEASONS.HIGH,
      basePrice: 200,
      multiplier: 1.3,
      updatedAt: new Date()
    },
    {
      roomType: ROOM_TYPES.DOUBLE,
      season: SEASONS.HIGH,
      basePrice: 325,
      multiplier: 1.3,
      updatedAt: new Date()
    },
    {
      roomType: ROOM_TYPES.SUITE,
      season: SEASONS.PEAK,
      basePrice: 960,
      multiplier: 1.6,
      updatedAt: new Date()
    }
  ];
};

/**
 * Générer un SIRET de test valide
 */
const generateTestSiret = () => {
  return `${Date.now()}`.slice(-14).padStart(14, '1');
};

/**
 * Obtenir occupation maximale par défaut selon type chambre
 */
const getDefaultMaxOccupancy = (roomType) => {
  const occupancy = {
    [ROOM_TYPES.SIMPLE]: 1,
    [ROOM_TYPES.DOUBLE]: 2,
    [ROOM_TYPES.DOUBLE_COMFORT]: 2,
    [ROOM_TYPES.SUITE]: 4
  };
  return occupancy[roomType] || 2;
};

/**
 * Générer politique d'annulation de test
 */
const generateTestCancellationPolicy = () => {
  return {
    freeUntil: 24,
    policies: [
      { hoursBeforeCheckIn: 24, refundPercentage: 100, description: 'Annulation gratuite' },
      { hoursBeforeCheckIn: 12, refundPercentage: 50, description: 'Annulation tardive' },
      { hoursBeforeCheckIn: 0, refundPercentage: 0, description: 'Aucun remboursement' }
    ]
  };
};

/**
 * ================================
 * WEEK 2 - WORKFLOW HELPERS
 * ================================
 */

/**
 * Simuler transition de statut booking
 */
const simulateBookingStatusTransition = async (bookingId, newStatus, userId) => {
  const booking = await Booking.findById(bookingId);
  if (!booking) throw new Error('Booking not found');

  const previousStatus = booking.status;
  booking.status = newStatus;
  
  // Ajouter à l'historique
  booking.statusHistory = booking.statusHistory || [];
  booking.statusHistory.push({
    previousStatus,
    newStatus,
    reason: `Test transition: ${previousStatus} → ${newStatus}`,
    changedBy: userId,
    changedAt: new Date()
  });

  // Ajouter champs spécifiques selon statut
  switch (newStatus) {
    case BOOKING_STATUS.CONFIRMED:
      booking.confirmedAt = new Date();
      booking.confirmedBy = userId;
      break;
    case BOOKING_STATUS.CHECKED_IN:
      booking.actualCheckInDate = new Date();
      booking.checkedInBy = userId;
      break;
    case BOOKING_STATUS.COMPLETED:
      booking.actualCheckOutDate = new Date();
      booking.checkedOutBy = userId;
      break;
    case BOOKING_STATUS.CANCELLED:
      booking.cancelledAt = new Date();
      booking.cancelledBy = userId;
      booking.refundPercentage = 100;
      booking.refundAmount = booking.totalPrice;
      break;
  }

  await booking.save();
  return booking;
};

/**
 * Créer scénario de conflit de réservation
 */
const createBookingConflictScenario = async (hotelId, roomId) => {
  const customer1 = await createTestUser({ email: 'customer1@test.com' });
  const customer2 = await createTestUser({ email: 'customer2@test.com' });

  const checkIn = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  // Première réservation (confirmée)
  const booking1 = await createCompleteTestBooking({
    hotelId,
    customerId: customer1._id,
    status: BOOKING_STATUS.CONFIRMED
  });

  // Deuxième réservation (conflictuelle, en attente)
  const booking2 = await createCompleteTestBooking({
    hotelId,
    customerId: customer2._id,
    status: BOOKING_STATUS.PENDING
  });

  return { booking1, booking2, customer1, customer2 };
};

/**
 * ================================
 * WEEK 2 - PRICING HELPERS
 * ================================
 */

/**
 * Créer scénario de test pricing saisonnier
 */
const createSeasonalPricingScenario = () => {
  const basePrice = 200;
  const scenarios = [
    {
      season: SEASONS.LOW,
      checkInDate: new Date('2025-06-15'), // Basse saison été
      expectedMultiplier: 0.8,
      expectedPrice: basePrice * 0.8
    },
    {
      season: SEASONS.HIGH,
      checkInDate: new Date('2025-12-15'), // Haute saison hiver
      expectedMultiplier: 1.3,
      expectedPrice: basePrice * 1.3
    },
    {
      season: SEASONS.PEAK,
      checkInDate: new Date('2025-12-25'), // Très haute saison Noël
      expectedMultiplier: 1.6,
      expectedPrice: basePrice * 1.6
    }
  ];

  return scenarios;
};

/**
 * ================================
 * WEEK 2 - AVAILABILITY HELPERS
 * ================================
 */

/**
 * Créer scénario de test availability complexe
 */
const createAvailabilityTestScenario = async () => {
  const { hotel, rooms } = await createCompleteTestHotel();
  
  // Réserver quelques chambres
  const occupiedRooms = rooms.slice(0, 3);
  await Room.updateMany(
    { _id: { $in: occupiedRooms.map(r => r._id) } },
    { status: ROOM_STATUS.OCCUPIED }
  );

  // Mettre une chambre en maintenance
  await Room.findByIdAndUpdate(rooms[3]._id, { status: ROOM_STATUS.MAINTENANCE });

  // Créer des réservations conflictuelles
  const customer = await createTestUser();
  const checkIn = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const checkOut = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  const conflictingBooking = await createCompleteTestBooking({
    hotelId: hotel._id,
    customerId: customer._id,
    status: BOOKING_STATUS.CONFIRMED
  });

  return {
    hotel,
    totalRooms: rooms.length,
    occupiedRooms: occupiedRooms.length,
    availableRooms: rooms.length - occupiedRooms.length - 1, // -1 pour maintenance
    maintenanceRooms: 1,
    conflictingBooking
  };
};

/**
 * ================================
 * WEEK 2 - INVOICE HELPERS
 * ================================
 */

/**
 * Créer données de test pour facture
 */
const createInvoiceTestData = async () => {
  const { hotel } = await createCompleteTestHotel();
  const customer = await createTestUser({
    firstName: 'Ahmed',
    lastName: 'Bennani',
    email: 'ahmed.bennani@test.ma',
    clientType: CLIENT_TYPES.CORPORATE,
    companyName: 'Tech Solutions Maroc',
    siret: generateTestSiret()
  });

  const booking = await createCompleteTestBooking({
    hotelId: hotel._id,
    customerId: customer._id,
    status: BOOKING_STATUS.COMPLETED,
    withExtras: true
  });

  return { hotel, customer, booking };
};

/**
 * ================================
 * WEEK 2 - ASSERTION HELPERS
 * ================================
 */

/**
 * Vérifier structure réponse booking
 */
const expectBookingResponse = (bookingObject) => {
  expect(bookingObject).toHaveProperty('_id');
  expect(bookingObject).toHaveProperty('hotel');
  expect(bookingObject).toHaveProperty('customer');
  expect(bookingObject).toHaveProperty('checkInDate');
  expect(bookingObject).toHaveProperty('checkOutDate');
  expect(bookingObject).toHaveProperty('rooms');
  expect(bookingObject).toHaveProperty('status');
  expect(bookingObject).toHaveProperty('totalPrice');
  expect(Array.isArray(bookingObject.rooms)).toBe(true);
};

/**
 * Vérifier structure réponse hotel
 */
const expectHotelResponse = (hotelObject) => {
  expect(hotelObject).toHaveProperty('_id');
  expect(hotelObject).toHaveProperty('code');
  expect(hotelObject).toHaveProperty('name');
  expect(hotelObject).toHaveProperty('address');
  expect(hotelObject).toHaveProperty('city');
  expect(hotelObject).toHaveProperty('category');
  expect(hotelObject).toHaveProperty('phone');
  expect(hotelObject).toHaveProperty('email');
};

/**
 * Vérifier structure réponse room
 */
const expectRoomResponse = (roomObject) => {
  expect(roomObject).toHaveProperty('_id');
  expect(roomObject).toHaveProperty('hotel');
  expect(roomObject).toHaveProperty('number');
  expect(roomObject).toHaveProperty('type');
  expect(roomObject).toHaveProperty('floor');
  expect(roomObject).toHaveProperty('basePrice');
  expect(roomObject).toHaveProperty('status');
  expect(Object.values(ROOM_TYPES)).toContain(roomObject.type);
  expect(Object.values(ROOM_STATUS)).toContain(roomObject.status);
};

/**
 * Vérifier calcul de prix
 */
const expectPricingCalculation = (pricingResult, expectedTotal) => {
  expect(pricingResult).toHaveProperty('totalPrice');
  expect(pricingResult).toHaveProperty('breakdown');
  expect(pricingResult).toHaveProperty('currency');
  expect(pricingResult.totalPrice).toBeCloseTo(expectedTotal, 2);
  expect(pricingResult.currency).toBe('MAD');
};

/**
 * Vérifier disponibilité réponse
 */
const expectAvailabilityResponse = (availabilityResult) => {
  expect(availabilityResult).toHaveProperty('available');
  expect(availabilityResult).toHaveProperty('roomsRequested');
  expect(availabilityResult).toHaveProperty('roomsFound');
  expect(availabilityResult).toHaveProperty('statistics');
  expect(typeof availabilityResult.available).toBe('boolean');
};

/**
 * ================================
 * EXISTING HELPERS (UPDATED)
 * ================================
 */

/**
 * Créer un utilisateur en base de données (UPDATED)
 */
const createTestUser = async (userData = {}) => {
  const data = createUserData(userData);
  const user = new User(data);
  await user.save();
  return user;
};

/**
 * Créer plusieurs utilisateurs (UPDATED)
 */
const createTestUsers = async (count = 3) => {
  const users = [];
  
  for (let i = 0; i < count; i++) {
    const userData = createUserData({
      firstName: `User${i + 1}`,
      email: `user${i + 1}@test.com`
    });
    const user = new User(userData);
    await user.save();
    users.push(user);
  }
  
  return users;
};

/**
 * Créer un utilisateur avec rôle spécifique (UPDATED)
 */
const createUserWithRole = async (role) => {
  const userData = createUserData({ 
    role,
    firstName: role.charAt(0) + role.slice(1).toLowerCase(),
    email: `${role.toLowerCase()}@test.com`
  });
  
  return await createTestUser(userData);
};

/**
 * Créer un utilisateur d'entreprise (UPDATED)
 */
const createCompanyUser = async () => {
  const userData = createUserData({
    clientType: CLIENT_TYPES.CORPORATE,
    companyName: 'Test Company SARL',
    siret: generateTestSiret(),
    email: 'company@test.com'
  });
  
  return await createTestUser(userData);
};

/**
 * ================================
 * TOKEN HELPERS (UNCHANGED)
 * ================================
 */

/**
 * Générer un token JWT pour les tests
 */
const generateTestToken = (user, options = {}) => {
  const payload = {
    userId: user._id,
    email: user.email,
    role: user.role,
    fullName: `${user.firstName} ${user.lastName}`
  };

  return jwtUtils.generateAccessToken(payload, options);
};

/**
 * Générer une paire de tokens pour les tests
 */
const generateTestTokenPair = (user) => {
  return jwtUtils.generateTokenPair(user);
};

/**
 * Créer un token expiré pour les tests
 */
const generateExpiredToken = (user) => {
  const payload = {
    userId: user._id,
    email: user.email,
    role: user.role
  };

  return jwt.sign(payload, process.env.JWT_SECRET, { 
    expiresIn: '-1h', // Expiré depuis 1h
    issuer: 'hotel-management-system'
  });
};

/**
 * Créer un token invalide pour les tests
 */
const generateInvalidToken = () => {
  return 'invalid.jwt.token.here';
};

/**
 * ================================
 * REQUEST HELPERS (UNCHANGED)
 * ================================
 */

/**
 * Créer des headers d'authentification
 */
const createAuthHeaders = (token) => {
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
};

/**
 * Créer une requête authentifiée pour supertest
 */
const authenticatedRequest = (request, token) => {
  return request.set('Authorization', `Bearer ${token}`);
};

/**
 * Helper pour les tests de rôles (UPDATED)
 */
const testRoleAccess = async (request, endpoint, method = 'get') => {
  const admin = await createUserWithRole(USER_ROLES.ADMIN);
  const receptionist = await createUserWithRole(USER_ROLES.RECEPTIONIST);
  const client = await createUserWithRole(USER_ROLES.CLIENT);

  const adminToken = generateTestToken(admin);
  const receptionistToken = generateTestToken(receptionist);
  const clientToken = generateTestToken(client);

  const results = {};

  // Test admin access
  try {
    const adminResponse = await request[method](endpoint)
      .set('Authorization', `Bearer ${adminToken}`);
    results.admin = { status: adminResponse.status, allowed: adminResponse.status < 400 };
  } catch (error) {
    results.admin = { status: 500, allowed: false, error: error.message };
  }

  // Test receptionist access
  try {
    const receptionistResponse = await request[method](endpoint)
      .set('Authorization', `Bearer ${receptionistToken}`);
    results.receptionist = { status: receptionistResponse.status, allowed: receptionistResponse.status < 400 };
  } catch (error) {
    results.receptionist = { status: 500, allowed: false, error: error.message };
  }

  // Test client access
  try {
    const clientResponse = await request[method](endpoint)
      .set('Authorization', `Bearer ${clientToken}`);
    results.client = { status: clientResponse.status, allowed: clientResponse.status < 400 };
  } catch (error) {
    results.client = { status: 500, allowed: false, error: error.message };
  }

  return results;
};

/**
 * ================================
 * DEPRECATED HELPERS (TO REMOVE)
 * ================================
 */

/**
 * Créer un hôtel de test complet avec chambres (DEPRECATED - Use createCompleteTestHotel)
 */
const createTestHotelWithRooms = async (managerId = null) => {
  console.warn('createTestHotelWithRooms is deprecated. Use createCompleteTestHotel instead.');
  return await createCompleteTestHotel(managerId);
};

/**
 * Créer une réservation de test complète (DEPRECATED - Use createCompleteTestBooking)
 */
const createTestBooking = async (options = {}) => {
  console.warn('createTestBooking is deprecated. Use createCompleteTestBooking instead.');
  return await createCompleteTestBooking(options);
};

/**
 * ================================
 * ASSERTION HELPERS (EXISTING + NEW)
 * ================================
 */

/**
 * Vérifier qu'une réponse d'erreur est correcte
 */
const expectErrorResponse = (response, expectedStatus, expectedMessage = null) => {
  expect(response.status).toBe(expectedStatus);
  expect(response.body.success).toBe(false);
  if (expectedMessage) {
    expect(response.body.message).toContain(expectedMessage);
  }
};

/**
 * Vérifier qu'une réponse de succès est correcte
 */
const expectSuccessResponse = (response, expectedStatus = 200) => {
  expect(response.status).toBe(expectedStatus);
  expect(response.body.success).toBe(true);
  expect(response.body).toHaveProperty('message');
};

/**
 * Vérifier qu'un token JWT est valide
 */
const expectValidToken = (token) => {
  expect(token).toBeTruthy();
  expect(typeof token).toBe('string');
  expect(token.split('.')).toHaveLength(3); // JWT structure
  
  // Vérifier que le token peut être décodé
  const decoded = jwtUtils.decodeToken(token);
  expect(decoded).toBeTruthy();
  expect(decoded).toHaveProperty('userId');
  expect(decoded).toHaveProperty('exp');
};

/**
 * Vérifier les propriétés d'un utilisateur dans une réponse
 */
const expectUserProperties = (userObject, includePrivate = false) => {
  expect(userObject).toHaveProperty('_id');
  expect(userObject).toHaveProperty('firstName');
  expect(userObject).toHaveProperty('lastName');
  expect(userObject).toHaveProperty('email');
  expect(userObject).toHaveProperty('role');
  
  // Vérifier que les propriétés sensibles ne sont pas exposées
  if (!includePrivate) {
    expect(userObject).not.toHaveProperty('password');
    expect(userObject).not.toHaveProperty('resetPasswordToken');
    expect(userObject).not.toHaveProperty('loginAttempts');
  }
};

/**
 * ================================
 * DATABASE UTILITIES (EXISTING + NEW)
 * ================================
 */

/**
 * Compter les documents dans une collection
 */
const countDocuments = async (Model) => {
  return await Model.countDocuments();
};

/**
 * Vérifier qu'un document existe
 */
const documentExists = async (Model, query) => {
  const doc = await Model.findOne(query);
  return doc !== null;
};

/**
 * Obtenir des statistiques de base sur les collections
 */
const getCollectionStats = async () => {
  return {
    users: await User.countDocuments(),
    hotels: await Hotel.countDocuments(),
    rooms: await Room.countDocuments(),
    bookings: await Booking.countDocuments()
  };
};

/**
 * Vérifier intégrité données de test
 */
const validateTestDataIntegrity = async () => {
  const stats = await getCollectionStats();
  const issues = [];

  // Vérifier que les références sont cohérentes
  const rooms = await Room.find().populate('hotel');
  const orphanedRooms = rooms.filter(room => !room.hotel);
  if (orphanedRooms.length > 0) {
    issues.push(`${orphanedRooms.length} chambres sans hôtel`);
  }

  const bookings = await Booking.find().populate('hotel customer');
  const orphanedBookings = bookings.filter(booking => !booking.hotel || !booking.customer);
  if (orphanedBookings.length > 0) {
    issues.push(`${orphanedBookings.length} réservations avec références manquantes`);
  }

  return {
    stats,
    issues,
    isValid: issues.length === 0
  };
};

/**
 * ================================
 * TIME UTILITIES (EXISTING + NEW)
 * ================================
 */

/**
 * Créer une date dans le futur
 */
const futureDate = (days = 1) => {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
};

/**
 * Créer une date dans le passé
 */
const pastDate = (days = 1) => {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
};

/**
 * Créer une plage de dates pour tests
 */
const createDateRange = (startDaysFromNow = 1, durationDays = 2) => {
  const checkIn = futureDate(startDaysFromNow);
  const checkOut = new Date(checkIn.getTime() + durationDays * 24 * 60 * 60 * 1000);
  return { checkIn, checkOut };
};

/**
 * Créer dates pour conflit de réservation
 */
const createOverlappingDates = () => {
  const baseCheckIn = futureDate(1);
  const baseCheckOut = futureDate(4);
  
  return {
    original: { checkIn: baseCheckIn, checkOut: baseCheckOut },
    overlapping: [
      { checkIn: futureDate(0), checkOut: futureDate(2) }, // Chevauche début
      { checkIn: futureDate(2), checkOut: futureDate(5) }, // Chevauche fin
      { checkIn: futureDate(1.5), checkOut: futureDate(2.5) }, // Inclus dedans
      { checkIn: futureDate(0), checkOut: futureDate(5) }  // Englobe
    ],
    nonOverlapping: [
      { checkIn: pastDate(2), checkOut: pastDate(1) },     // Avant
      { checkIn: futureDate(5), checkOut: futureDate(6) }  // Après
    ]
  };
};

/**
 * ================================
 * VALIDATION HELPERS (EXISTING + NEW)
 * ================================
 */

/**
 * Données invalides pour tester la validation (UPDATED)
 */
const getInvalidUserData = () => {
  return {
    noFirstName: { lastName: 'Test', email: 'test@test.com', password: 'password', phone: '+212612345678' },
    noLastName: { firstName: 'Test', email: 'test@test.com', password: 'password', phone: '+212612345678' },
    noEmail: { firstName: 'Test', lastName: 'Test', password: 'password', phone: '+212612345678' },
    invalidEmail: { firstName: 'Test', lastName: 'Test', email: 'invalid-email', password: 'password', phone: '+212612345678' },
    shortPassword: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: '123', phone: '+212612345678' },
    invalidPhone: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '123' },
    invalidRole: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '+212612345678', role: 'INVALID' },
    invalidSiret: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '+212612345678', siret: '123' }
  };
};

/**
 * Données invalides pour hôtels
 */
const getInvalidHotelData = () => {
  return {
    noCode: { name: 'Test Hotel', city: 'Rabat', category: 4 },
    noName: { code: 'TST001', city: 'Rabat', category: 4 },
    invalidCode: { code: 'INVALID', name: 'Test Hotel', city: 'Rabat', category: 4 },
    invalidCategory: { code: 'TST001', name: 'Test Hotel', city: 'Rabat', category: 10 },
    invalidPhone: { code: 'TST001', name: 'Test Hotel', city: 'Rabat', category: 4, phone: '123' },
    invalidEmail: { code: 'TST001', name: 'Test Hotel', city: 'Rabat', category: 4, email: 'invalid' }
  };
};

/**
 * Données invalides pour chambres
 */
const getInvalidRoomData = () => {
  return {
    noNumber: { type: ROOM_TYPES.DOUBLE, floor: 1, basePrice: 200 },
    noType: { number: '101', floor: 1, basePrice: 200 },
    invalidType: { number: '101', type: 'INVALID', floor: 1, basePrice: 200 },
    invalidFloor: { number: '101', type: ROOM_TYPES.DOUBLE, floor: -1, basePrice: 200 },
    invalidPrice: { number: '101', type: ROOM_TYPES.DOUBLE, floor: 1, basePrice: -100 },
    invalidStatus: { number: '101', type: ROOM_TYPES.DOUBLE, floor: 1, basePrice: 200, status: 'INVALID' }
  };
};

/**
 * Données invalides pour réservations
 */
const getInvalidBookingData = () => {
  return {
    noHotel: { checkInDate: futureDate(1), checkOutDate: futureDate(3), rooms: [{ type: ROOM_TYPES.DOUBLE }] },
    noCustomer: { hotel: new mongoose.Types.ObjectId(), checkInDate: futureDate(1), checkOutDate: futureDate(3), rooms: [{ type: ROOM_TYPES.DOUBLE }] },
    invalidDates: { hotel: new mongoose.Types.ObjectId(), customer: new mongoose.Types.ObjectId(), checkInDate: futureDate(3), checkOutDate: futureDate(1) },
    pastCheckIn: { hotel: new mongoose.Types.ObjectId(), customer: new mongoose.Types.ObjectId(), checkInDate: pastDate(1), checkOutDate: futureDate(1) },
    noRooms: { hotel: new mongoose.Types.ObjectId(), customer: new mongoose.Types.ObjectId(), checkInDate: futureDate(1), checkOutDate: futureDate(3), rooms: [] },
    invalidStatus: { hotel: new mongoose.Types.ObjectId(), customer: new mongoose.Types.ObjectId(), checkInDate: futureDate(1), checkOutDate: futureDate(3), rooms: [{ type: ROOM_TYPES.DOUBLE }], status: 'INVALID' }
  };
};

/**
 * ================================
 * MOCK DATA SETS
 * ================================
 */

/**
 * Jeu de données complet pour tests d'intégration
 */
const createFullTestDataSet = async () => {
  // Créer utilisateurs de tous types
  const admin = await createUserWithRole(USER_ROLES.ADMIN);
  const receptionist = await createUserWithRole(USER_ROLES.RECEPTIONIST);
  const clientIndividual = await createTestUser({ clientType: CLIENT_TYPES.INDIVIDUAL });
  const clientCorporate = await createCompanyUser();

  // Créer hôtels avec chambres
  const { hotel: hotel1, rooms: rooms1 } = await createCompleteTestHotel(admin._id);
  const { hotel: hotel2, rooms: rooms2 } = await createCompleteTestHotel(admin._id);

  // Créer réservations dans différents statuts
  const bookingPending = await createCompleteTestBooking({
    hotelId: hotel1._id,
    customerId: clientIndividual._id,
    status: BOOKING_STATUS.PENDING
  });

  const bookingConfirmed = await createCompleteTestBooking({
    hotelId: hotel1._id,
    customerId: clientCorporate._id,
    status: BOOKING_STATUS.CONFIRMED,
    withRoomAssignment: true
  });

  const bookingCheckedIn = await createCompleteTestBooking({
    hotelId: hotel2._id,
    customerId: clientIndividual._id,
    status: BOOKING_STATUS.CHECKED_IN,
    withRoomAssignment: true,
    withExtras: true
  });

  return {
    users: { admin, receptionist, clientIndividual, clientCorporate },
    hotels: { hotel1, hotel2 },
    rooms: { rooms1, rooms2 },
    bookings: { bookingPending, bookingConfirmed, bookingCheckedIn }
  };
};

/**
 * ================================
 * PERFORMANCE TEST HELPERS
 * ================================
 */

/**
 * Créer données de charge pour tests de performance
 */
const createLoadTestData = async (hotelCount = 5, roomsPerHotel = 20, bookingsPerHotel = 10) => {
  const admin = await createUserWithRole(USER_ROLES.ADMIN);
  const hotels = [];
  const allRooms = [];
  const allBookings = [];

  for (let h = 0; h < hotelCount; h++) {
    const hotelData = createHotelData({
      code: `LOAD${String(h + 1).padStart(3, '0')}`,
      name: `Load Test Hotel ${h + 1}`,
      createdBy: admin._id
    });
    
    const hotel = new Hotel(hotelData);
    await hotel.save();
    hotels.push(hotel);

    // Créer chambres
    const rooms = [];
    for (let r = 0; r < roomsPerHotel; r++) {
      const roomData = createRoomData({
        number: `${Math.floor(r / 10) + 1}${String(r % 10).padStart(2, '0')}`,
        hotelId: hotel._id,
        type: Object.values(ROOM_TYPES)[r % 4],
        createdBy: admin._id
      });
      
      const room = new Room(roomData);
      await room.save();
      rooms.push(room);
    }
    allRooms.push(...rooms);

    // Créer clients et réservations
    for (let b = 0; b < bookingsPerHotel; b++) {
      const customer = await createTestUser({
        email: `load${h}_${b}@test.com`
      });

      const bookingData = createBookingData({
        hotelId: hotel._id,
        customerId: customer._id,
        status: Object.values(BOOKING_STATUS)[b % Object.values(BOOKING_STATUS).length]
      });
      
      const booking = new Booking(bookingData);
      await booking.save();
      allBookings.push(booking);
    }
  }

  return {
    hotels,
    rooms: allRooms,
    bookings: allBookings,
    stats: {
      hotelCount,
      roomCount: allRooms.length,
      bookingCount: allBookings.length
    }
  };
};

/**
 * ================================
 * CLEANUP HELPERS (EXISTING + NEW)
 * ================================
 */

/**
 * Supprimer tous les utilisateurs de test
 */
const cleanupTestUsers = async () => {
  await User.deleteMany({ 
    $or: [
      { email: { $regex: /@test\.com$/ } },
      { email: { $regex: /^(admin|receptionist|client)@test\.com$/ } }
    ]
  });
};

/**
 * Supprimer tous les hôtels de test
 */
const cleanupTestHotels = async () => {
  await Hotel.deleteMany({ 
    $or: [
      { code: { $regex: /^(TST|HTL|LOAD)/ } },
      { name: { $regex: /Test Hotel/ } }
    ]
  });
};

/**
 * Supprimer toutes les chambres de test
 */
const cleanupTestRooms = async () => {
  // Supprimer chambres des hôtels de test
  const testHotels = await Hotel.find({ 
    code: { $regex: /^(TST|HTL|LOAD)/ } 
  }).select('_id');
  
  if (testHotels.length > 0) {
    await Room.deleteMany({
      hotel: { $in: testHotels.map(h => h._id) }
    });
  }
};

/**
 * Supprimer toutes les réservations de test
 */
const cleanupTestBookings = async () => {
  // Supprimer réservations des hôtels de test
  const testHotels = await Hotel.find({ 
    code: { $regex: /^(TST|HTL|LOAD)/ } 
  }).select('_id');
  
  if (testHotels.length > 0) {
    await Booking.deleteMany({
      hotel: { $in: testHotels.map(h => h._id) }
    });
  }
};

/**
 * Nettoyage complet de toutes les données de test
 */
const cleanupAllTestData = async () => {
  await cleanupTestBookings();
  await cleanupTestRooms(); 
  await cleanupTestHotels();
  await cleanupTestUsers();
  
  // Vérifier que le nettoyage est complet
  const remainingStats = await getCollectionStats();
  return remainingStats;
};

/**
 * Nettoyage sélectif par patterns
 */
const cleanupByPattern = async (patterns = []) => {
  for (const pattern of patterns) {
    switch (pattern.type) {
      case 'user':
        await User.deleteMany(pattern.query);
        break;
      case 'hotel':
        await Hotel.deleteMany(pattern.query);
        break;
      case 'room':
        await Room.deleteMany(pattern.query);
        break;
      case 'booking':
        await Booking.deleteMany(pattern.query);
        break;
    }
  }
};

/**
 * ================================
 * SNAPSHOT HELPERS
 * ================================
 */

/**
 * Créer snapshot de l'état de la base de données
 */
const createDatabaseSnapshot = async () => {
  const snapshot = {
    timestamp: new Date(),
    collections: {
      users: await User.find().lean(),
      hotels: await Hotel.find().lean(),
      rooms: await Room.find().lean(),
      bookings: await Booking.find().lean()
    },
    stats: await getCollectionStats()
  };
  
  return snapshot;
};

/**
 * Comparer deux snapshots
 */
const compareDatabaseSnapshots = (before, after) => {
  const changes = {
    users: {
      added: after.collections.users.length - before.collections.users.length,
      details: {}
    },
    hotels: {
      added: after.collections.hotels.length - before.collections.hotels.length,
      details: {}
    },
    rooms: {
      added: after.collections.rooms.length - before.collections.rooms.length,
      details: {}
    },
    bookings: {
      added: after.collections.bookings.length - before.collections.bookings.length,
      details: {}
    }
  };
  
  return changes;
};

module.exports = {
  // ================================
  // WEEK 1 - EXISTING HELPERS
  // ================================
  
  // Data generators (updated)
  createUserData,
  createHotelData,
  createRoomData,
  createBookingData,
  
  // User helpers
  createTestUser,
  createTestUsers,
  createUserWithRole,
  createCompanyUser,
  
  // Token helpers
  generateTestToken,
  generateTestTokenPair,
  generateExpiredToken,
  generateInvalidToken,
  
  // Request helpers
  createAuthHeaders,
  authenticatedRequest,
  testRoleAccess,
  
  // Assertion helpers
  expectErrorResponse,
  expectSuccessResponse,
  expectValidToken,
  expectUserProperties,
  
  // Database utilities
  countDocuments,
  documentExists,
  getCollectionStats,
  
  // Time utilities
  futureDate,
  pastDate,
  
  // Validation helpers
  getInvalidUserData,
  
  // Cleanup helpers
  cleanupTestUsers,
  cleanupTestHotels,
  cleanupTestBookings,
  
  // ================================
  // WEEK 2 - NEW HELPERS
  // ================================
  
  // Advanced creators
  createCompleteTestHotel,
  createCompleteTestBooking,
  createFullTestDataSet,
  createLoadTestData,
  
  // Business logic helpers
  createDefaultSeasonalPricing,
  generateTestSiret,
  getDefaultMaxOccupancy,
  generateTestCancellationPolicy,
  
  // Workflow helpers
  simulateBookingStatusTransition,
  createBookingConflictScenario,
  
  // Pricing helpers
  createSeasonalPricingScenario,
  
  // Availability helpers
  createAvailabilityTestScenario,
  
  // Invoice helpers
  createInvoiceTestData,
  
  // New assertion helpers
  expectBookingResponse,
  expectHotelResponse,
  expectRoomResponse,
  expectPricingCalculation,
  expectAvailabilityResponse,
  
  // Enhanced database utilities
  validateTestDataIntegrity,
  
  // Enhanced time utilities
  createDateRange,
  createOverlappingDates,
  
  // Enhanced validation helpers
  getInvalidHotelData,
  getInvalidRoomData,
  getInvalidBookingData,
  
  // Enhanced cleanup helpers
  cleanupTestRooms,
  cleanupAllTestData,
  cleanupByPattern,
  
  // Snapshot helpers
  createDatabaseSnapshot,
  compareDatabaseSnapshots,
  
  // ================================
  // DEPRECATED (TO REMOVE IN WEEK 3)
  // ================================
  createTestHotelWithRooms, // Use createCompleteTestHotel
  createTestBooking // Use createCompleteTestBooking
};