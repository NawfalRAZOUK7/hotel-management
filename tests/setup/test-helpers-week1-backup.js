const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// Models
const User = require('../models/User');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');

// Utils
const jwtUtils = require('../utils/jwt');

/**
 * MOCK DATA GENERATORS
 */

/**
 * Générateur de données utilisateur de test
 */
const createUserData = ({
  firstName = 'Test',
  lastName = 'User',
  email = null,
  password = 'password123',
  phone = '0123456789',
  role = 'CLIENT',
  companyName = null,
  siret = null,
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
    isEmailVerified,
    isActive
  };

  // Ajouter les données d'entreprise si fournies
  if (companyName) userData.companyName = companyName;
  if (siret) userData.siret = siret;

  return userData;
};

/**
 * Générateur de données hôtel de test
 */
const createHotelData = ({
  code = null,
  name = 'Test Hotel',
  city = 'Paris',
  stars = 4,
  managerId = null
} = {}) => {
  // Générer un code unique si non fourni
  const uniqueCode = code || `HTL${Date.now()}`;

  return {
    code: uniqueCode,
    name,
    address: {
      street: '123 Rue de Test',
      city,
      postalCode: '75001',
      country: 'France',
      coordinates: {
        latitude: 48.8566 + (Math.random() - 0.5) * 0.1, // Variation autour de Paris
        longitude: 2.3522 + (Math.random() - 0.5) * 0.1
      }
    },
    stars,
    contact: {
      phone: '0140000000',
      email: `contact@${uniqueCode.toLowerCase()}.com`,
      website: `https://${uniqueCode.toLowerCase()}.com`
    },
    manager: managerId,
    isActive: true,
    isPublished: true,
    seasonalPricing: [
      {
        name: 'HAUTE_SAISON',
        startDate: new Date('2025-07-01'),
        endDate: new Date('2025-08-31'),
        multiplier: 1.5
      },
      {
        name: 'BASSE_SAISON',
        startDate: new Date('2025-11-01'),
        endDate: new Date('2025-03-31'),
        multiplier: 0.8
      }
    ]
  };
};

/**
 * Générateur de données chambre de test
 */
const createRoomData = ({
  number = null,
  floor = 1,
  type = 'Double',
  hotelId = null,
  basePrice = 120,
  status = 'AVAILABLE'
} = {}) => {
  // Générer un numéro unique si non fourni
  const uniqueNumber = number || `${floor}${String(Date.now()).slice(-2)}`;

  return {
    number: uniqueNumber,
    floor,
    type,
    hotel: hotelId,
    basePrice,
    status,
    isActive: true,
    amenities: ['WiFi gratuit', 'Télévision', 'Salle de bain privée']
  };
};

/**
 * Générateur de données réservation de test
 */
const createBookingData = ({
  userId = null,
  hotelId = null,
  roomIds = [],
  checkIn = null,
  checkOut = null,
  adults = 2,
  children = 0,
  source = 'WEB'
} = {}) => {
  // Dates par défaut : demain et après-demain
  const defaultCheckIn = checkIn || new Date(Date.now() + 24 * 60 * 60 * 1000);
  const defaultCheckOut = checkOut || new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

  return {
    user: userId,
    hotel: hotelId,
    rooms: roomIds.map((roomId, index) => ({
      room: roomId,
      pricePerNight: 120 + (index * 20), // Prix variable selon la chambre
      guests: [{
        firstName: 'Guest',
        lastName: `${index + 1}`,
        age: 30,
        isMainGuest: index === 0
      }]
    })),
    checkIn: defaultCheckIn,
    checkOut: defaultCheckOut,
    totalGuests: {
      adults,
      children
    },
    source,
    pricing: {
      subtotal: 120 * roomIds.length,
      taxes: 12 * roomIds.length,
      fees: 0,
      discount: 0,
      totalPrice: 132 * roomIds.length
    }
  };
};

/**
 * USER CREATION HELPERS
 */

/**
 * Créer un utilisateur en base de données
 */
const createTestUser = async (userData = {}) => {
  const data = createUserData(userData);
  const user = new User(data);
  await user.save();
  return user;
};

/**
 * Créer plusieurs utilisateurs
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
 * Créer un utilisateur avec rôle spécifique
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
 * Créer un utilisateur d'entreprise
 */
const createCompanyUser = async () => {
  const userData = createUserData({
    companyName: 'Test Company SARL',
    siret: `${Date.now()}`.slice(-14).padStart(14, '1'),
    email: 'company@test.com'
  });
  
  return await createTestUser(userData);
};

/**
 * TOKEN HELPERS
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
 * REQUEST HELPERS
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
 * Helper pour les tests de rôles
 */
const testRoleAccess = async (request, endpoint, method = 'get') => {
  const admin = await createUserWithRole('ADMIN');
  const receptionist = await createUserWithRole('RECEPTIONIST');
  const client = await createUserWithRole('CLIENT');

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
 * HOTEL & ROOM HELPERS
 */

/**
 * Créer un hôtel de test complet avec chambres
 */
const createTestHotelWithRooms = async (managerId = null) => {
  // Créer le manager si non fourni
  let manager = managerId;
  if (!manager) {
    const adminUser = await createUserWithRole('ADMIN');
    manager = adminUser._id;
  }

  // Créer l'hôtel
  const hotelData = createHotelData({ managerId: manager });
  const hotel = new Hotel(hotelData);
  await hotel.save();

  // Créer des chambres de chaque type
  const roomTypes = ['Simple', 'Double', 'Double Confort', 'Suite'];
  const basePrices = [80, 120, 160, 300];
  const rooms = [];

  for (let i = 0; i < roomTypes.length; i++) {
    const roomData = createRoomData({
      number: `${i + 1}01`,
      floor: i + 1,
      type: roomTypes[i],
      hotelId: hotel._id,
      basePrice: basePrices[i]
    });
    
    const room = new Room(roomData);
    await room.save();
    rooms.push(room);
  }

  return { hotel, rooms };
};

/**
 * BOOKING HELPERS
 */

/**
 * Créer une réservation de test complète
 */
const createTestBooking = async ({
  userId = null,
  hotelId = null,
  roomIds = null,
  status = 'PENDING'
} = {}) => {
  // Créer les données nécessaires si non fournies
  let user = userId;
  if (!user) {
    const testUser = await createTestUser();
    user = testUser._id;
  }

  let hotel = hotelId;
  let rooms = roomIds;
  if (!hotel || !rooms) {
    const hotelWithRooms = await createTestHotelWithRooms();
    hotel = hotelWithRooms.hotel._id;
    rooms = [hotelWithRooms.rooms[0]._id]; // Prendre la première chambre
  }

  // Créer la réservation
  const bookingData = createBookingData({
    userId: user,
    hotelId: hotel,
    roomIds: rooms
  });

  const booking = new Booking(bookingData);
  booking.status = status;
  await booking.save();

  return booking;
};

/**
 * ASSERTION HELPERS
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
  expect(response.body).toHaveProperty('code');
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
  expect(userObject).toHaveProperty('id');
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
 * DATABASE UTILITIES
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
 * TIME UTILITIES
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
 * VALIDATION HELPERS
 */

/**
 * Données invalides pour tester la validation
 */
const getInvalidUserData = () => {
  return {
    noFirstName: { lastName: 'Test', email: 'test@test.com', password: 'password', phone: '0123456789' },
    noLastName: { firstName: 'Test', email: 'test@test.com', password: 'password', phone: '0123456789' },
    noEmail: { firstName: 'Test', lastName: 'Test', password: 'password', phone: '0123456789' },
    invalidEmail: { firstName: 'Test', lastName: 'Test', email: 'invalid-email', password: 'password', phone: '0123456789' },
    shortPassword: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: '123', phone: '0123456789' },
    invalidPhone: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '123' },
    invalidRole: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '0123456789', role: 'INVALID' },
    invalidSiret: { firstName: 'Test', lastName: 'Test', email: 'test@test.com', password: 'password', phone: '0123456789', siret: '123' }
  };
};

/**
 * CLEANUP HELPERS
 */

/**
 * Supprimer tous les utilisateurs de test
 */
const cleanupTestUsers = async () => {
  await User.deleteMany({ email: { $regex: /@test\.com$/ } });
};

/**
 * Supprimer tous les hôtels de test
 */
const cleanupTestHotels = async () => {
  await Hotel.deleteMany({ code: { $regex: /^HTL/ } });
  await Room.deleteMany({});
};

/**
 * Supprimer toutes les réservations de test
 */
const cleanupTestBookings = async () => {
  await Booking.deleteMany({});
};

module.exports = {
  // Data generators
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
  
  // Hotel & Room helpers
  createTestHotelWithRooms,
  
  // Booking helpers
  createTestBooking,
  
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
  cleanupTestBookings
};