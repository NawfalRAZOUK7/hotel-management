/**
 * TESTS HOTEL CONTROLLER - CRUD COMPLET + BUSINESS LOGIC
 * Tests unitaires pour toutes les fonctionnalités hôtels
 * 
 * Couverture :
 * - CRUD complet (Create, Read, Update, Delete)
 * - Validation métier et contraintes
 * - Gestion prix saisonniers
 * - Upload et gestion images
 * - Statistiques et rapports
 * - Permissions et sécurité
 * - Edge cases et erreurs
 */

const request = require('supertest');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');

// Import app et modèles
const app = require('../../../src/app');
const Hotel = require('../../../src/models/Hotel');
const Room = require('../../../src/models/Room');
const Booking = require('../../../src/models/Booking');
const User = require('../../../src/models/User');

// Import helpers et constantes
const { setupTestDB, cleanupTestDB, createTestUser } = require('../../setup/test-helpers');
const { HOTEL_CATEGORIES, USER_ROLES, SEASONS } = require('../../../src/utils/constants');

describe('Hotel Controller', () => {
  let adminUser, adminToken;
  let receptionistUser, receptionistToken;
  let clientUser, clientToken;
  let testHotel;

  // ================================
  // SETUP ET TEARDOWN
  // ================================

  beforeAll(async () => {
    await setupTestDB();
    
    // Créer utilisateurs de test
    adminUser = await createTestUser({
      firstName: 'Admin',
      lastName: 'Test',
      email: 'admin@test.com',
      role: USER_ROLES.ADMIN
    });
    adminToken = adminUser.token;

    receptionistUser = await createTestUser({
      firstName: 'Receptionist',
      lastName: 'Test', 
      email: 'receptionist@test.com',
      role: USER_ROLES.RECEPTIONIST
    });
    receptionistToken = receptionistUser.token;

    clientUser = await createTestUser({
      firstName: 'Client',
      lastName: 'Test',
      email: 'client@test.com', 
      role: USER_ROLES.CLIENT
    });
    clientToken = clientUser.token;
  });

  afterAll(async () => {
    await cleanupTestDB();
  });

  beforeEach(async () => {
    // Nettoyer collections avant chaque test
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});
  });

  // ================================
  // TESTS CREATE HOTEL
  // ================================

  describe('POST /api/hotels', () => {
    const validHotelData = {
      code: 'RAB001',
      name: 'Hôtel Atlas Rabat',
      address: 'Avenue Mohammed V',
      city: 'Rabat',
      postalCode: '10000',
      phone: '+212537123456',
      email: 'contact@atlas-rabat.ma',
      category: 4,
      description: 'Hôtel 4 étoiles au centre de Rabat',
      amenities: ['WiFi', 'Piscine', 'Spa', 'Restaurant']
    };

    it('should create hotel successfully with valid data (Admin)', async () => {
      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validHotelData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hotel).toMatchObject({
        code: validHotelData.code,
        name: validHotelData.name,
        city: validHotelData.city,
        category: validHotelData.category
      });

      // Vérifier en base
      const hotel = await Hotel.findById(response.body.data.hotel._id);
      expect(hotel).toBeTruthy();
      expect(hotel.createdBy.toString()).toBe(adminUser.user._id.toString());
    });

    it('should create hotel with seasonal pricing', async () => {
      const hotelWithPricing = {
        ...validHotelData,
        code: 'RAB002',
        seasonalPricing: [
          {
            roomType: 'Double',
            season: 'High Season',
            basePrice: 300,
            multiplier: 1.5
          },
          {
            roomType: 'Suite', 
            season: 'Peak Season',
            basePrice: 800,
            multiplier: 2.0
          }
        ]
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(hotelWithPricing)
        .expect(201);

      expect(response.body.data.hotel.seasonalPricing).toHaveLength(2);
      expect(response.body.data.hotel.seasonalPricing[0]).toMatchObject({
        roomType: 'Double',
        season: 'High Season',
        basePrice: 300
      });
    });

    it('should reject invalid hotel code format', async () => {
      const invalidData = {
        ...validHotelData,
        code: 'INVALID'
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Code hôtel invalide');
    });

    it('should reject duplicate hotel code', async () => {
      // Créer premier hôtel
      await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validHotelData)
        .expect(201);

      // Tenter de créer avec même code
      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validHotelData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Code hôtel déjà utilisé');
    });

    it('should reject invalid category', async () => {
      const invalidData = {
        ...validHotelData,
        category: 6 // Maximum 5 étoiles
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Catégorie hôtel invalide');
    });

    it('should reject invalid phone format', async () => {
      const invalidData = {
        ...validHotelData,
        phone: '123456' // Format invalide
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Format téléphone invalide');
    });

    it('should reject invalid seasonal pricing', async () => {
      const invalidData = {
        ...validHotelData,
        code: 'RAB003',
        seasonalPricing: [
          {
            roomType: 'InvalidType', // Type invalide
            season: 'High Season',
            basePrice: 300
          }
        ]
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Type de chambre invalide');
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(validHotelData)
        .expect(403);

      await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validHotelData)
        .expect(403);
    });

    it('should reject unauthenticated access', async () => {
      await request(app)
        .post('/api/hotels')
        .send(validHotelData)
        .expect(401);
    });
  });

  // ================================
  // TESTS GET HOTELS
  // ================================

  describe('GET /api/hotels', () => {
    beforeEach(async () => {
      // Créer données de test
      const hotels = [
        {
          code: 'RAB001',
          name: 'Hôtel Atlas Rabat',
          city: 'Rabat',
          category: 4,
          createdBy: adminUser.user._id
        },
        {
          code: 'CAS001', 
          name: 'Hôtel Marina Casablanca',
          city: 'Casablanca',
          category: 5,
          createdBy: adminUser.user._id
        },
        {
          code: 'MAR001',
          name: 'Riad Marrakech',
          city: 'Marrakech', 
          category: 3,
          createdBy: adminUser.user._id
        }
      ];

      await Hotel.insertMany(hotels);
    });

    it('should get all hotels with pagination (Admin)', async () => {
      const response = await request(app)
        .get('/api/hotels?page=1&limit=2')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hotels).toHaveLength(2);
      expect(response.body.data.pagination).toMatchObject({
        currentPage: 1,
        totalPages: 2,
        totalCount: 3,
        hasNextPage: true,
        hasPrevPage: false
      });
    });

    it('should filter hotels by city', async () => {
      const response = await request(app)
        .get('/api/hotels?city=Rabat')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.hotels).toHaveLength(1);
      expect(response.body.data.hotels[0].city).toBe('Rabat');
    });

    it('should filter hotels by category', async () => {
      const response = await request(app)
        .get('/api/hotels?category=5')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.hotels).toHaveLength(1);
      expect(response.body.data.hotels[0].category).toBe(5);
    });

    it('should search hotels by name', async () => {
      const response = await request(app)
        .get('/api/hotels?search=Marina')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.hotels).toHaveLength(1);
      expect(response.body.data.hotels[0].name).toContain('Marina');
    });

    it('should include statistics when requested', async () => {
      // Créer quelques chambres et réservations pour stats
      const hotel = await Hotel.findOne({ code: 'RAB001' });
      
      await Room.create({
        hotel: hotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200,
        status: 'Available'
      });

      await Booking.create({
        hotel: hotel._id,
        customer: clientUser.user._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 200 }],
        totalPrice: 200,
        status: 'Confirmed'
      });

      const response = await request(app)
        .get('/api/hotels?includeStats=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const hotelWithStats = response.body.data.hotels.find(h => h.code === 'RAB001');
      expect(hotelWithStats.stats).toBeDefined();
      expect(hotelWithStats.stats.roomCount).toBe(1);
      expect(hotelWithStats.stats.activeBookings).toBe(1);
    });

    it('should sort hotels correctly', async () => {
      const response = await request(app)
        .get('/api/hotels?sortBy=category&sortOrder=desc')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const categories = response.body.data.hotels.map(h => h.category);
      expect(categories).toEqual([5, 4, 3]); // Ordre décroissant
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      await request(app)
        .get('/api/hotels')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);

      await request(app)
        .get('/api/hotels')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });
  });

  // ================================
  // TESTS GET HOTEL BY ID
  // ================================

  describe('GET /api/hotels/:id', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id,
        seasonalPricing: [
          {
            roomType: 'Double',
            season: 'High Season',
            basePrice: 300
          }
        ]
      });
    });

    it('should get hotel by valid ID (Admin)', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hotel.code).toBe('RAB001');
      expect(response.body.data.hotel.seasonalPricing).toHaveLength(1);
    });

    it('should include rooms when requested', async () => {
      // Créer chambre
      await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200,
        status: 'Available'
      });

      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}?includeRooms=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms).toBeDefined();
      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].number).toBe('101');
    });

    it('should include statistics when requested', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}?includeStats=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.stats).toBeDefined();
      expect(typeof response.body.data.stats.totalRooms).toBe('number');
    });

    it('should return 404 for non-existent hotel', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      const response = await request(app)
        .get(`/api/hotels/${fakeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Hôtel non trouvé');
    });

    it('should return 400 for invalid ObjectId', async () => {
      const response = await request(app)
        .get('/api/hotels/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('ID hôtel invalide');
    });
  });

  // ================================
  // TESTS UPDATE HOTEL
  // ================================

  describe('PUT /api/hotels/:id', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        phone: '+212537123456',
        createdBy: adminUser.user._id
      });
    });

    it('should update hotel successfully (Admin)', async () => {
      const updateData = {
        name: 'Hôtel Test Updated',
        category: 5,
        description: 'Description mise à jour'
      };

      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hotel.name).toBe(updateData.name);
      expect(response.body.data.hotel.category).toBe(updateData.category);
      expect(response.body.data.hotel.updatedBy.toString()).toBe(adminUser.user._id.toString());
    });

    it('should update seasonal pricing', async () => {
      const updateData = {
        seasonalPricing: [
          {
            roomType: 'Suite',
            season: 'Peak Season',
            basePrice: 1000,
            multiplier: 2.5
          }
        ]
      };

      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.data.hotel.seasonalPricing).toHaveLength(1);
      expect(response.body.data.hotel.seasonalPricing[0].basePrice).toBe(1000);
    });

    it('should reject invalid updates', async () => {
      const invalidData = {
        category: 10, // Invalide
        phone: '123' // Format invalide
      };

      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject empty updates', async () => {
      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({})
        .expect(400);

      expect(response.body.message).toContain('Aucune donnée à mettre à jour');
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      const updateData = { name: 'Unauthorized Update' };

      await request(app)
        .put(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(updateData)
        .expect(403);
    });
  });

  // ================================
  // TESTS DELETE HOTEL
  // ================================

  describe('DELETE /api/hotels/:id', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id
      });
    });

    it('should delete empty hotel successfully (Admin)', async () => {
      const response = await request(app)
        .delete(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Hôtel supprimé avec succès');

      // Vérifier suppression en base
      const deletedHotel = await Hotel.findById(testHotel._id);
      expect(deletedHotel).toBeNull();
    });

    it('should prevent deletion with active rooms/bookings', async () => {
      // Créer chambre
      await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      });

      const response = await request(app)
        .delete(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Impossible de supprimer');
      expect(response.body.details.roomCount).toBe(1);
    });

    it('should force delete with cascade', async () => {
      // Créer chambre et réservation
      const room = await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      });

      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser.user._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 200 }],
        totalPrice: 200,
        status: 'Confirmed'
      });

      const response = await request(app)
        .delete(`/api/hotels/${testHotel._id}?force=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.details.deletedRooms).toBe(1);
      expect(response.body.details.deletedBookings).toBe(1);

      // Vérifier suppression cascade
      const deletedHotel = await Hotel.findById(testHotel._id);
      const deletedRoom = await Room.findById(room._id);
      const deletedBookings = await Booking.find({ hotel: testHotel._id });

      expect(deletedHotel).toBeNull();
      expect(deletedRoom).toBeNull();
      expect(deletedBookings).toHaveLength(0);
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      await request(app)
        .delete(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);
    });
  });

  // ================================
  // TESTS GESTION IMAGES
  // ================================

  describe('POST /api/hotels/:id/upload', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id
      });
    });

    it('should upload images successfully (Admin)', async () => {
      // Créer fichier test temporaire
      const testImagePath = path.join(__dirname, '../../fixtures/test-image.jpg');
      const testImageBuffer = Buffer.from('fake-image-content');
      
      // Mock upload (en pratique, utiliserait un vrai fichier)
      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/upload`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('images', testImageBuffer, 'test-image.jpg')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('uploadée(s) avec succès');
    });

    it('should reject too many images', async () => {
      // Pré-remplir avec maximum d'images
      const images = Array(20).fill(null).map((_, i) => ({
        filename: `image${i}.jpg`,
        originalName: `test${i}.jpg`,
        path: `/uploads/test${i}.jpg`,
        size: 1000
      }));

      await Hotel.findByIdAndUpdate(testHotel._id, { images });

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/upload`)
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('images', Buffer.from('test'), 'extra.jpg')
        .expect(400);

      expect(response.body.message).toContain('Maximum');
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      await request(app)
        .post(`/api/hotels/${testHotel._id}/upload`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .attach('images', Buffer.from('test'), 'test.jpg')
        .expect(403);
    });
  });

  // ================================
  // TESTS PRICING SAISONNIER
  // ================================

  describe('GET/PUT /api/hotels/:id/pricing', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id,
        seasonalPricing: [
          {
            roomType: 'Double',
            season: 'High Season',
            basePrice: 300,
            multiplier: 1.5
          }
        ]
      });
    });

    it('should get seasonal pricing (Admin)', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/pricing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.seasonalPricing).toHaveLength(1);
      expect(response.body.data.seasonalPricing[0].basePrice).toBe(300);
    });

    it('should update seasonal pricing (Admin)', async () => {
      const newPricing = [
        {
          roomType: 'Suite',
          season: 'Peak Season',
          basePrice: 800,
          multiplier: 2.0
        },
        {
          roomType: 'Double',
          season: 'Low Season',
          basePrice: 150,
          multiplier: 0.8
        }
      ];

      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}/pricing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seasonalPricing: newPricing })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.seasonalPricing).toHaveLength(2);
      expect(response.body.data.updatedCount).toBe(2);
    });

    it('should reject invalid pricing data', async () => {
      const invalidPricing = [
        {
          roomType: 'InvalidType',
          season: 'High Season',
          basePrice: 300
        }
      ];

      const response = await request(app)
        .put(`/api/hotels/${testHotel._id}/pricing`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ seasonalPricing: invalidPricing })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('invalide');
    });
  });

  // ================================
  // TESTS CALCUL PRIX
  // ================================

  describe('POST /api/hotels/:id/calculate-price', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id
      });

      // Créer chambre pour calculs
      await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      });
    });

    it('should calculate price correctly (Admin)', async () => {
      const priceRequest = {
        roomType: 'Double',
        checkInDate: '2025-07-15',
        checkOutDate: '2025-07-18',
        numberOfRooms: 2
      };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/calculate-price`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(priceRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pricing.totalPrice).toBeGreaterThan(0);
      expect(response.body.data.pricing.breakdown).toBeDefined();
      expect(response.body.data.pricing.breakdown.nightsCount).toBe(3);
    });

    it('should allow receptionist to calculate price', async () => {
      const priceRequest = {
        roomType: 'Double',
        checkInDate: '2025-07-15',
        checkOutDate: '2025-07-18',
        numberOfRooms: 1
      };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/calculate-price`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(priceRequest)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject invalid date range', async () => {
      const invalidRequest = {
        roomType: 'Double',
        checkInDate: '2025-07-18',
        checkOutDate: '2025-07-15', // Date fin avant début
        numberOfRooms: 1
      };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/calculate-price`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidRequest)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Date de fin doit être après');
    });

    it('should reject non-existent room type', async () => {
      const invalidRequest = {
        roomType: 'NonExistentType',
        checkInDate: '2025-07-15',
        checkOutDate: '2025-07-18',
        numberOfRooms: 1
      };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/calculate-price`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidRequest)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Aucune chambre de type');
    });

    it('should reject client access to price calculation', async () => {
      const priceRequest = {
        roomType: 'Double',
        checkInDate: '2025-07-15',
        checkOutDate: '2025-07-18',
        numberOfRooms: 1
      };

      await request(app)
        .post(`/api/hotels/${testHotel._id}/calculate-price`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send(priceRequest)
        .expect(403);
    });
  });

  // ================================
  // TESTS STATISTIQUES
  // ================================

  describe('GET /api/hotels/:id/stats', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'RAB001',
        name: 'Hôtel Test',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id
      });

      // Créer données pour statistiques
      const room1 = await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      });

      const room2 = await Room.create({
        hotel: testHotel._id,
        number: '201',
        type: 'Suite',
        floor: 2,
        basePrice: 500
      });

      // Créer réservations pour stats
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser.user._id,
        checkInDate: new Date('2025-06-01'),
        checkOutDate: new Date('2025-06-04'),
        rooms: [{ type: 'Double', basePrice: 200, room: room1._id }],
        totalPrice: 600,
        status: 'Completed',
        createdAt: new Date('2025-06-01')
      });

      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser.user._id,
        checkInDate: new Date('2025-06-05'),
        checkOutDate: new Date('2025-06-07'),
        rooms: [{ type: 'Suite', basePrice: 500, room: room2._id }],
        totalPrice: 1000,
        status: 'Confirmed',
        createdAt: new Date('2025-06-05')
      });
    });

    it('should get hotel statistics (Admin)', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats?period=30d`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats).toBeDefined();
      expect(response.body.data.stats.summary).toMatchObject({
        totalRooms: 2,
        totalBookings: 2,
        totalRevenue: 1600
      });
    });

    it('should get stats for custom period', async () => {
      const startDate = '2025-06-01';
      const endDate = '2025-06-30';

      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats?startDate=${startDate}&endDate=${endDate}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.period.start).toBeDefined();
      expect(response.body.data.period.end).toBeDefined();
      expect(response.body.data.period.days).toBe(29); // 30 juin - 1 juin
    });

    it('should include room type breakdown', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.stats.roomTypes).toBeDefined();
      expect(response.body.data.stats.roomTypes['Double']).toMatchObject({
        total: 1,
        averagePrice: 200
      });
      expect(response.body.data.stats.roomTypes['Suite']).toMatchObject({
        total: 1,
        averagePrice: 500
      });
    });

    it('should include booking status breakdown', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.stats.bookingStatuses).toBeDefined();
      expect(response.body.data.stats.bookingStatuses['Completed']).toMatchObject({
        count: 1,
        revenue: 600
      });
      expect(response.body.data.stats.bookingStatuses['Confirmed']).toMatchObject({
        count: 1,
        revenue: 1000
      });
    });

    it('should calculate trends and growth', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.stats.trends).toBeDefined();
      expect(response.body.data.stats.trends.averageDailyRate).toBeGreaterThan(0);
      expect(Array.isArray(response.body.data.stats.trends.peakDays)).toBe(true);
    });

    it('should reject unauthorized access (non-Admin)', async () => {
      await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);

      await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });
  });

  // ================================
  // TESTS EDGE CASES ET ERREURS
  // ================================

  describe('Edge Cases and Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      // Simuler erreur de base de données
      const originalFind = Hotel.find;
      Hotel.find = jest.fn().mockRejectedValue(new Error('Database connection lost'));

      const response = await request(app)
        .get('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Erreur serveur');

      // Restaurer méthode originale
      Hotel.find = originalFind;
    });

    it('should handle malformed JSON in request body', async () => {
      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}') // JSON malformé
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle very large pagination requests', async () => {
      const response = await request(app)
        .get('/api/hotels?page=999999&limit=10000')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.hotels).toHaveLength(0);
      expect(response.body.data.pagination.currentPage).toBe(999999);
    });

    it('should handle special characters in search', async () => {
      // Créer hôtel avec caractères spéciaux
      await Hotel.create({
        code: 'SPE001',
        name: 'Hôtel Spé¢ia£ Çhârs',
        city: 'Tétouan',
        category: 3,
        createdBy: adminUser.user._id
      });

      const response = await request(app)
        .get('/api/hotels?search=Spé¢ia£')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.hotels).toHaveLength(1);
    });

    it('should handle concurrent hotel creation with same code', async () => {
      const hotelData = {
        code: 'CON001',
        name: 'Concurrent Test',
        city: 'Test',
        category: 3
      };

      // Tenter créations simultanées
      const promises = Array(3).fill(null).map(() =>
        request(app)
          .post('/api/hotels')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(hotelData)
      );

      const responses = await Promise.allSettled(promises);

      // Une seule devrait réussir
      const successful = responses.filter(r => r.status === 'fulfilled' && r.value.status === 201);
      const failed = responses.filter(r => r.status === 'fulfilled' && r.value.status === 409);

      expect(successful).toHaveLength(1);
      expect(failed).toHaveLength(2);
    });

    it('should validate seasonal pricing multiplier bounds', async () => {
      const invalidPricingData = {
        code: 'VAL001',
        name: 'Validation Test',
        city: 'Test',
        category: 3,
        seasonalPricing: [
          {
            roomType: 'Double',
            season: 'High Season',
            basePrice: 200,
            multiplier: 10.0 // Trop élevé
          }
        ]
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidPricingData)
        .expect(400);

      expect(response.body.message).toContain('Multiplicateur invalide');
    });

    it('should handle missing required fields gracefully', async () => {
      const incompleteData = {
        name: 'Incomplete Hotel'
        // Manque code, city, category
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(incompleteData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors || response.body.message).toBeDefined();
    });
  });

  // ================================
  // TESTS PERFORMANCE ET LIMITES
  // ================================

  describe('Performance and Limits', () => {
    it('should handle large hotel lists efficiently', async () => {
      // Créer 100 hôtels
      const hotels = Array(100).fill(null).map((_, i) => ({
        code: `PERF${String(i).padStart(3, '0')}`,
        name: `Hotel Performance ${i}`,
        city: 'TestCity',
        category: (i % 5) + 1,
        createdBy: adminUser.user._id
      }));

      await Hotel.insertMany(hotels);

      const startTime = Date.now();
      
      const response = await request(app)
        .get('/api/hotels?limit=50')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const duration = Date.now() - startTime;

      expect(response.body.data.hotels).toHaveLength(50);
      expect(response.body.data.pagination.totalCount).toBe(100);
      expect(duration).toBeLessThan(1000); // Moins d'1 seconde
    });

    it('should handle complex search queries efficiently', async () => {
      // Créer hôtels variés pour recherche
      const complexHotels = [
        { code: 'COMP001', name: 'Complex Search Hotel 1', city: 'Rabat', category: 5 },
        { code: 'COMP002', name: 'Another Complex Hotel', city: 'Casablanca', category: 4 },
        { code: 'COMP003', name: 'Third Search Test', city: 'Rabat', category: 3 }
      ].map(h => ({ ...h, createdBy: adminUser.user._id }));

      await Hotel.insertMany(complexHotels);

      const startTime = Date.now();

      const response = await request(app)
        .get('/api/hotels?search=Complex&city=Rabat&category=5&sortBy=name&includeStats=true')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const duration = Date.now() - startTime;

      expect(response.body.data.hotels).toHaveLength(1);
      expect(response.body.data.hotels[0].code).toBe('COMP001');
      expect(duration).toBeLessThan(500); // Moins de 500ms
    });

    it('should respect rate limiting', async () => {
      // Simuler beaucoup de requêtes rapides
      const requests = Array(10).fill(null).map(() =>
        request(app)
          .get('/api/hotels')
          .set('Authorization', `Bearer ${adminToken}`)
      );

      const responses = await Promise.allSettled(requests);

      // La plupart devraient réussir, quelques-unes peuvent être rate limited
      const successful = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 200
      );
      
      expect(successful.length).toBeGreaterThan(5); // Au moins quelques-unes passent
    });
  });

  // ================================
  // TESTS INTÉGRATION AVEC AUTRES MODULES
  // ================================

  describe('Integration with Other Modules', () => {
    beforeEach(async () => {
      testHotel = await Hotel.create({
        code: 'INT001',
        name: 'Integration Test Hotel',
        city: 'Rabat',
        category: 4,
        createdBy: adminUser.user._id
      });
    });

    it('should integrate with room creation', async () => {
      // Créer hôtel puis chambre
      const roomData = {
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      };

      const roomResponse = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(roomData)
        .expect(201);

      // Vérifier que l'hôtel est correctement lié
      expect(roomResponse.body.data.room.hotel._id).toBe(testHotel._id.toString());

      // Vérifier statistiques mises à jour
      const statsResponse = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(statsResponse.body.data.stats.summary.totalRooms).toBe(1);
    });

    it('should integrate with booking system', async () => {
      // Créer chambre
      await Room.create({
        hotel: testHotel._id,
        number: '101',
        type: 'Double',
        floor: 1,
        basePrice: 200
      });

      // Créer réservation
      const bookingData = {
        hotelId: testHotel._id,
        checkInDate: '2025-07-15',
        checkOutDate: '2025-07-18',
        rooms: [{ type: 'Double', quantity: 1 }],
        numberOfGuests: 2
      };

      const bookingResponse = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingData)
        .expect(201);

      // Vérifier lien hôtel-réservation
      expect(bookingResponse.body.data.booking.hotel._id).toBe(testHotel._id.toString());

      // Vérifier impact sur statistiques hôtel
      const statsResponse = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(statsResponse.body.data.stats.summary.totalBookings).toBe(1);
    });

    it('should validate hotel deletion impact on bookings', async () => {
      // Créer réservation active
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser.user._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 48 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 200 }],
        totalPrice: 400,
        status: 'Confirmed'
      });

      // Tenter suppression sans force
      const deleteResponse = await request(app)
        .delete(`/api/hotels/${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(deleteResponse.body.details.activeBookingsCount).toBe(1);

      // Vérifier que l'hôtel existe toujours
      const hotelExists = await Hotel.findById(testHotel._id);
      expect(hotelExists).toBeTruthy();
    });
  });
});

// ================================
// HELPER FUNCTIONS POUR TESTS
// ================================

/**
 * Crée un hôtel de test avec données complètes
 */
const createTestHotel = async (overrides = {}) => {
  const defaultData = {
    code: 'TEST001',
    name: 'Test Hotel',
    address: 'Test Address',
    city: 'Test City',
    category: 4,
    createdBy: new mongoose.Types.ObjectId()
  };

  return await Hotel.create({ ...defaultData, ...overrides });
};

/**
 * Crée des données de test pour statistiques
 */
const createTestDataForStats = async (hotelId, userId) => {
  // Créer chambres
  const rooms = await Room.insertMany([
    { hotel: hotelId, number: '101', type: 'Double', floor: 1, basePrice: 200 },
    { hotel: hotelId, number: '102', type: 'Double', floor: 1, basePrice: 200 },
    { hotel: hotelId, number: '201', type: 'Suite', floor: 2, basePrice: 500 }
  ]);

  // Créer réservations variées
  const bookings = await Booking.insertMany([
    {
      hotel: hotelId,
      customer: userId,
      checkInDate: new Date('2025-06-01'),
      checkOutDate: new Date('2025-06-04'),
      rooms: [{ type: 'Double', basePrice: 200 }],
      totalPrice: 600,
      status: 'Completed'
    },
    {
      hotel: hotelId,
      customer: userId,
      checkInDate: new Date('2025-06-05'),
      checkOutDate: new Date('2025-06-08'),
      rooms: [{ type: 'Suite', basePrice: 500 }],
      totalPrice: 1500,
      status: 'Confirmed'
    }
  ]);

  return { rooms, bookings };
};

/**
 * Valide la structure d'une réponse hôtel
 */
const validateHotelResponse = (hotel) => {
  expect(hotel).toMatchObject({
    _id: expect.any(String),
    code: expect.any(String),
    name: expect.any(String),
    city: expect.any(String),
    category: expect.any(Number),
    createdAt: expect.any(String),
    updatedAt: expect.any(String)
  });

  expect(hotel.category).toBeGreaterThanOrEqual(1);
  expect(hotel.category).toBeLessThanOrEqual(5);
  expect(hotel.code).toMatch(/^[A-Z]{3}\d{3}$/);
};

module.exports = {
  createTestHotel,
  createTestDataForStats,
  validateHotelResponse
};