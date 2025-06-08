/**
 * TESTS ROOM CONTROLLER - VALIDATION COMPLÈTE CRUD + AVAILABILITY LOGIC
 * Tests unitaires pour roomController avec business logic complexe
 * 
 * Coverage :
 * - CRUD operations (createRoom, getRoomsByHotel, getRoomById, updateRoom, deleteRoom)
 * - Status management (updateRoomStatus, validateStatusChange)
 * - Availability logic (checkRoomAvailability, searchAvailableRooms)
 * - Auto assignment (autoAssignRooms)
 * - Statistics (getRoomOccupancyStats)
 * - Permissions et validations métier
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../../src/app');

// Models
const Room = require('../../../src/models/Room');
const Hotel = require('../../../src/models/Hotel');
const Booking = require('../../../src/models/Booking');
const User = require('../../../src/models/User');

// Test helpers
const { 
  setupTestDatabase,
  teardownTestDatabase,
  createTestUser,
  generateJWT
} = require('../../setup/test-helpers');

// Constants
const {
  ROOM_TYPES,
  ROOM_STATUS,
  USER_ROLES,
  BUSINESS_RULES
} = require('../../../src/utils/constants');

describe('Room Controller', () => {
  let testDb;
  let adminUser, receptionistUser, clientUser;
  let adminToken, receptionistToken, clientToken;
  let testHotel, testRooms;

  beforeAll(async () => {
    testDb = await setupTestDatabase();
  });

  afterAll(async () => {
    await teardownTestDatabase(testDb);
  });

  beforeEach(async () => {
    // Clean database
    await Room.deleteMany({});
    await Hotel.deleteMany({});
    await Booking.deleteMany({});
    await User.deleteMany({});

    // Create test users
    adminUser = await createTestUser({
      firstName: 'Admin',
      lastName: 'Test',
      email: 'admin@test.com',
      role: USER_ROLES.ADMIN
    });

    receptionistUser = await createTestUser({
      firstName: 'Reception',
      lastName: 'Test',
      email: 'reception@test.com',
      role: USER_ROLES.RECEPTIONIST
    });

    clientUser = await createTestUser({
      firstName: 'Client',
      lastName: 'Test',
      email: 'client@test.com',
      role: USER_ROLES.CLIENT
    });

    // Generate JWT tokens
    adminToken = generateJWT(adminUser);
    receptionistToken = generateJWT(receptionistUser);
    clientToken = generateJWT(clientUser);

    // Create test hotel
    testHotel = await Hotel.create({
      code: 'TEST001',
      name: 'Test Hotel',
      address: '123 Test Street',
      city: 'Test City',
      category: 4,
      createdBy: adminUser._id
    });

    // Create test rooms
    testRooms = await Room.create([
      {
        hotel: testHotel._id,
        number: '101',
        type: ROOM_TYPES.SIMPLE,
        floor: 1,
        basePrice: 200,
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      },
      {
        hotel: testHotel._id,
        number: '201',
        type: ROOM_TYPES.DOUBLE,
        floor: 2,
        basePrice: 300,
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      },
      {
        hotel: testHotel._id,
        number: '301',
        type: ROOM_TYPES.SUITE,
        floor: 3,
        basePrice: 600,
        status: ROOM_STATUS.MAINTENANCE,
        createdBy: adminUser._id
      }
    ]);
  });

  /**
   * ================================
   * TESTS CRUD OPERATIONS
   * ================================
   */

  describe('POST /api/hotels/:hotelId/rooms - Create Room', () => {
    const validRoomData = {
      number: '102',
      type: ROOM_TYPES.DOUBLE,
      floor: 1,
      basePrice: 250,
      description: 'Chambre double confort',
      amenities: ['TV', 'WiFi', 'Climatisation'],
      maxOccupancy: 2
    };

    it('should create room successfully with admin token', async () => {
      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validRoomData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.room.number).toBe(validRoomData.number);
      expect(response.body.data.room.type).toBe(validRoomData.type);
      expect(response.body.data.room.hotel.name).toBe(testHotel.name);

      // Verify room in database
      const roomInDb = await Room.findById(response.body.data.room._id);
      expect(roomInDb).toBeTruthy();
      expect(roomInDb.status).toBe(ROOM_STATUS.AVAILABLE);
      expect(roomInDb.createdBy.toString()).toBe(adminUser._id.toString());
    });

    it('should include pricing suggestions in response', async () => {
      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validRoomData)
        .expect(201);

      expect(response.body.data.pricingInfo).toBeDefined();
      expect(response.body.data.pricingInfo.basePriceEntered).toBe(validRoomData.basePrice);
      expect(response.body.data.pricingInfo.suggestedAdjustedPrice).toBeDefined();
      expect(response.body.data.pricingInfo.multipliers).toBeDefined();
    });

    it('should reject invalid room type', async () => {
      const invalidData = { ...validRoomData, type: 'InvalidType' };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Type de chambre invalide');
    });

    it('should reject duplicate room number in same hotel', async () => {
      const duplicateData = { ...validRoomData, number: testRooms[0].number };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(duplicateData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('existe déjà');
    });

    it('should reject invalid price', async () => {
      const invalidPriceData = { ...validRoomData, basePrice: 10 }; // Below minimum

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidPriceData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject non-admin access', async () => {
      await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(validRoomData)
        .expect(403);

      await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validRoomData)
        .expect(403);
    });

    it('should reject invalid hotel ID', async () => {
      const invalidHotelId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .post(`/api/hotels/${invalidHotelId}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validRoomData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/hotels/:hotelId/rooms - Get Rooms by Hotel', () => {
    it('should return rooms with admin token', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.rooms).toHaveLength(3);
      expect(response.body.data.hotel.name).toBe(testHotel.name);
      expect(response.body.data.statistics.totalRooms).toBe(3);
    });

    it('should return rooms with receptionist token', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.rooms).toHaveLength(3);
    });

    it('should reject client access', async () => {
      await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('should filter by room type', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?type=${ROOM_TYPES.DOUBLE}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].type).toBe(ROOM_TYPES.DOUBLE);
    });

    it('should filter by room status', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?status=${ROOM_STATUS.AVAILABLE}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms).toHaveLength(2);
      expect(response.body.data.rooms.every(room => room.status === ROOM_STATUS.AVAILABLE)).toBe(true);
    });

    it('should filter by floor', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?floor=1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].floor).toBe(1);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?page=1&limit=2`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms).toHaveLength(2);
      expect(response.body.data.pagination.currentPage).toBe(1);
      expect(response.body.data.pagination.totalCount).toBe(3);
    });

    it('should include availability when requested', async () => {
      const checkInDate = new Date();
      checkInDate.setDate(checkInDate.getDate() + 1);
      const checkOutDate = new Date();
      checkOutDate.setDate(checkOutDate.getDate() + 3);

      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?includeAvailability=true&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms[0].availability).toBeDefined();
      expect(response.body.data.rooms[0].availability.checkedFor).toBeDefined();
    });
  });

  describe('GET /api/rooms/:id - Get Room by ID', () => {
    it('should return room details with admin token', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.room._id).toBe(testRooms[0]._id.toString());
      expect(response.body.data.room.hotel.name).toBe(testHotel.name);
      expect(response.body.data.pricingInfo).toBeDefined();
    });

    it('should include pricing info in response', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.pricingInfo.currentBasePrice).toBe(testRooms[0].basePrice);
      expect(response.body.data.pricingInfo.adjustedPrices).toBeDefined();
      expect(response.body.data.pricingInfo.adjustedPrices.mediumSeason).toBeDefined();
    });

    it('should include bookings when requested', async () => {
      // Create a test booking
      const booking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{
          type: ROOM_TYPES.SIMPLE,
          room: testRooms[0]._id,
          basePrice: 200,
          calculatedPrice: 200
        }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: 'Confirmed',
        createdBy: clientUser._id
      });

      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}?includeBookings=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.upcomingBookings).toBeDefined();
      expect(response.body.data.upcomingBookings).toHaveLength(1);
    });

    it('should return 404 for non-existent room', async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      const response = await request(app)
        .get(`/api/rooms/${nonExistentId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /api/rooms/:id - Update Room', () => {
    const updateData = {
      basePrice: 350,
      description: 'Updated description',
      amenities: ['TV', 'WiFi', 'Climatisation', 'Mini-bar']
    };

    it('should update room successfully with admin token', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.room.basePrice).toBe(updateData.basePrice);
      expect(response.body.data.room.description).toBe(updateData.description);

      // Verify in database
      const updatedRoom = await Room.findById(testRooms[0]._id);
      expect(updatedRoom.basePrice).toBe(updateData.basePrice);
      expect(updatedRoom.updatedBy.toString()).toBe(adminUser._id.toString());
    });

    it('should reject invalid price update', async () => {
      const invalidUpdate = { basePrice: 10 }; // Below minimum

      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(invalidUpdate)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject duplicate room number', async () => {
      const duplicateNumber = { number: testRooms[1].number };

      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(duplicateNumber)
        .expect(409);

      expect(response.body.success).toBe(false);
    });

    it('should reject non-admin access', async () => {
      await request(app)
        .put(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(updateData)
        .expect(403);
    });

    it('should validate status transitions', async () => {
      // First set room to occupied
      await Room.findByIdAndUpdate(testRooms[0]._id, { status: ROOM_STATUS.OCCUPIED });

      // Try to set directly to out of order (should work)
      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: ROOM_STATUS.OUT_OF_ORDER })
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /api/rooms/:id - Delete Room', () => {
    it('should delete room successfully when no active bookings', async () => {
      const response = await request(app)
        .delete(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify deletion in database
      const deletedRoom = await Room.findById(testRooms[0]._id);
      expect(deletedRoom).toBeNull();
    });

    it('should prevent deletion when active bookings exist', async () => {
      // Create active booking
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{
          type: ROOM_TYPES.SIMPLE,
          room: testRooms[0]._id,
          basePrice: 200,
          calculatedPrice: 200
        }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: 'Confirmed',
        createdBy: clientUser._id
      });

      const response = await request(app)
        .delete(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.details.activeBookingsCount).toBe(1);
    });

    it('should force delete with active bookings when force=true', async () => {
      // Create active booking
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{
          type: ROOM_TYPES.SIMPLE,
          room: testRooms[0]._id,
          basePrice: 200,
          calculatedPrice: 200
        }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: 'Confirmed',
        createdBy: clientUser._id
      });

      const response = await request(app)
        .delete(`/api/rooms/${testRooms[0]._id}?force=true`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.details.cancelledBookings).toBe(1);

      // Verify room deleted and booking cancelled
      const deletedRoom = await Room.findById(testRooms[0]._id);
      expect(deletedRoom).toBeNull();

      const cancelledBooking = await Booking.findOne({ 'rooms.room': testRooms[0]._id });
      expect(cancelledBooking.status).toBe('Cancelled');
    });

    it('should reject non-admin access', async () => {
      await request(app)
        .delete(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);
    });
  });

  /**
   * ================================
   * TESTS STATUS MANAGEMENT
   * ================================
   */

  describe('PUT /api/rooms/:id/status - Update Room Status', () => {
    it('should update room status with admin token', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ 
          status: ROOM_STATUS.MAINTENANCE,
          reason: 'Scheduled maintenance'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.room.newStatus).toBe(ROOM_STATUS.MAINTENANCE);

      // Verify in database
      const updatedRoom = await Room.findById(testRooms[0]._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.MAINTENANCE);
      expect(updatedRoom.statusHistory).toHaveLength(1);
      expect(updatedRoom.statusHistory[0].reason).toBe('Scheduled maintenance');
    });

    it('should update room status with receptionist token', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ 
          status: ROOM_STATUS.OCCUPIED,
          reason: 'Guest checked in'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject invalid status', async () => {
      const response = await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'InvalidStatus' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should reject client access', async () => {
      await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ status: ROOM_STATUS.MAINTENANCE })
        .expect(403);
    });

    it('should maintain status history', async () => {
      // First status change
      await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ 
          status: ROOM_STATUS.MAINTENANCE,
          reason: 'First change'
        });

      // Second status change
      await request(app)
        .put(`/api/rooms/${testRooms[0]._id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ 
          status: ROOM_STATUS.AVAILABLE,
          reason: 'Second change'
        });

      const room = await Room.findById(testRooms[0]._id);
      expect(room.statusHistory).toHaveLength(2);
      expect(room.statusHistory[0].reason).toBe('First change');
      expect(room.statusHistory[1].reason).toBe('Second change');
    });
  });

  /**
   * ================================
   * TESTS AVAILABILITY LOGIC
   * ================================
   */

  describe('GET /api/rooms/:id/availability - Check Room Availability', () => {
    const checkInDate = new Date();
    checkInDate.setDate(checkInDate.getDate() + 1);
    const checkOutDate = new Date();
    checkOutDate.setDate(checkOutDate.getDate() + 3);

    it('should return availability for available room', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}/availability?checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.availability.available).toBe(true);
      expect(response.body.data.room.status).toBe(ROOM_STATUS.AVAILABLE);
    });

    it('should return unavailable for maintenance room', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRooms[2]._id}/availability?checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.availability.available).toBe(false);
      expect(response.body.data.availability.reason).toContain('Maintenance');
    });

    it('should return unavailable when conflicting booking exists', async () => {
      // Create conflicting booking
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        rooms: [{
          type: ROOM_TYPES.SIMPLE,
          room: testRooms[0]._id,
          basePrice: 200,
          calculatedPrice: 200
        }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: 'Confirmed',
        createdBy: clientUser._id
      });

      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}/availability?checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.availability.available).toBe(false);
      expect(response.body.data.conflictingBookings).toHaveLength(1);
    });

    it('should exclude specific booking from availability check', async () => {
      // Create booking
      const booking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: checkInDate,
        checkOutDate: checkOutDate,
        rooms: [{
          type: ROOM_TYPES.SIMPLE,
          room: testRooms[0]._id,
          basePrice: 200,
          calculatedPrice: 200
        }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: 'Confirmed',
        createdBy: clientUser._id
      });

      // Check availability excluding this booking
      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}/availability?checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}&excludeBookingId=${booking._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.availability.available).toBe(true);
    });

    it('should require dates for availability check', async () => {
      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/rooms/search/available - Search Available Rooms', () => {
    const checkInDate = new Date();
    checkInDate.setDate(checkInDate.getDate() + 1);
    const checkOutDate = new Date();
    checkOutDate.setDate(checkOutDate.getDate() + 3);

    it('should return available rooms for given criteria', async () => {
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}&roomType=${ROOM_TYPES.SIMPLE}&roomsNeeded=1`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.availability.canAccommodate).toBe(true);
      expect(response.body.data.rooms).toHaveLength(1);
      expect(response.body.data.rooms[0].type).toBe(ROOM_TYPES.SIMPLE);
    });

    it('should include pricing information for each room', async () => {
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.rooms[0].pricing).toBeDefined();
      expect(response.body.data.rooms[0].pricing.totalPrice).toBeDefined();
      expect(response.body.data.rooms[0].pricing.pricePerNight).toBeDefined();
      expect(response.body.data.rooms[0].pricing.nights).toBeDefined();
    });

    it('should filter by max price', async () => {
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}&maxPrice=250`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.rooms.every(room => room.basePrice <= 250)).toBe(true);
    });

    it('should filter by amenities', async () => {
      // Update room with specific amenities
      await Room.findByIdAndUpdate(testRooms[0]._id, {
        amenities: ['TV', 'WiFi', 'Jacuzzi']
      });

      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}&amenities=WiFi,Jacuzzi`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      // Should find the room with matching amenities
    });

    it('should sort rooms by price (lowest first)', async () => {
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const prices = response.body.data.rooms.map(room => room.pricing.totalPrice);
      const sortedPrices = [...prices].sort((a, b) => a - b);
      expect(prices).toEqual(sortedPrices);
    });

    it('should allow client access for booking purposes', async () => {
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should return alternatives when exact criteria not available', async () => {
      // Request more rooms than available
      const response = await request(app)
        .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${checkInDate.toISOString()}&checkOutDate=${checkOutDate.toISOString()}&roomType=${ROOM_TYPES.SUITE}&roomsNeeded=5`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.availability.canAccommodate).toBe(false);
      expect(response.body.data.alternatives).toBeDefined();
    });
  });

  /**
   * ================================
   * TESTS AUTO ASSIGNMENT
   * ================================
   */

  describe('POST /api/rooms/auto-assign - Auto Assign Rooms', () => {
    let testBooking;

    beforeEach(async () => {
      // Create test booking for assignment
      testBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [
          {
            type: ROOM_TYPES.SIMPLE,
            basePrice: 200,
            calculatedPrice: 200
          },
          {
            type: ROOM_TYPES.DOUBLE,
            basePrice: 300,
            calculatedPrice: 300
          }
        ],
        numberOfGuests: 3,
        totalPrice: 500,
        status: 'Confirmed',
        createdBy: clientUser._id
      });
    });

    it('should auto-assign rooms successfully', async () => {
      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId: testBooking._id,
          preferences: {
            preferredFloor: 2,
            adjacentRooms: true
          }
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.assignments).toHaveLength(2);
      expect(response.body.data.readyForCheckIn).toBe(true);

      // Verify booking updated with room assignments
      const updatedBooking = await Booking.findById(testBooking._id);
      expect(updatedBooking.rooms[0].room).toBeDefined();
      expect(updatedBooking.rooms[1].room).toBeDefined();

      // Verify rooms marked as occupied
      const assignedRoomIds = response.body.data.assignments.map(a => a.roomId);
      const occupiedRooms = await Room.find({ 
        _id: { $in: assignedRoomIds },
        status: ROOM_STATUS.OCCUPIED 
      });
      expect(occupiedRooms).toHaveLength(2);
    });

    it('should work with receptionist token', async () => {
      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ bookingId: testBooking._id })
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject client access', async () => {
      await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ bookingId: testBooking._id })
        .expect(403);
    });

    it('should handle insufficient available rooms', async () => {
      // Mark all rooms as occupied
      await Room.updateMany({}, { status: ROOM_STATUS.OCCUPIED });

      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bookingId: testBooking._id })
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.data.assignmentErrors).toBeDefined();
    });

    it('should only assign to confirmed bookings', async () => {
      // Change booking status to pending
      await Booking.findByIdAndUpdate(testBooking._id, { status: 'Pending' });

      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ bookingId: testBooking._id })
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should respect room preferences', async () => {
      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bookingId: testBooking._id,
          preferences: {
            preferredFloor: 1
          }
        })
        .expect(200);

      // Check if assignment respects floor preference when possible
      const assignments = response.body.data.assignments;
      const hasFloor1Assignment = assignments.some(a => a.floor === 1);
      expect(hasFloor1Assignment).toBe(true);
    });
  });

  /**
   * ================================
   * TESTS STATISTICS
   * ================================
   */

  describe('GET /api/rooms/stats/occupancy - Room Occupancy Stats', () => {
    beforeEach(async () => {
      // Create some bookings for statistics
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);

      await Booking.create([
        {
          hotel: testHotel._id,
          customer: clientUser._id,
          checkInDate: new Date(),
          checkOutDate: tomorrow,
          rooms: [{
            type: ROOM_TYPES.SIMPLE,
            room: testRooms[0]._id,
            basePrice: 200,
            calculatedPrice: 200
          }],
          numberOfGuests: 1,
          totalPrice: 200,
          status: 'Completed',
          createdBy: clientUser._id
        },
        {
          hotel: testHotel._id,
          customer: clientUser._id,
          checkInDate: tomorrow,
          checkOutDate: dayAfter,
          rooms: [{
            type: ROOM_TYPES.DOUBLE,
            room: testRooms[1]._id,
            basePrice: 300,
            calculatedPrice: 300
          }],
          numberOfGuests: 2,
          totalPrice: 300,
          status: 'Confirmed',
          createdBy: clientUser._id
        }
      ]);
    });

    it('should return occupancy statistics with admin token', async () => {
      const response = await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}&period=30d`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.currentOccupancy).toBeDefined();
      expect(response.body.data.roomTypeBreakdown).toBeDefined();
      expect(response.body.data.occupancyTrends).toBeDefined();
    });

    it('should work with receptionist token', async () => {
      const response = await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}&period=7d`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should reject client access', async () => {
      await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });

    it('should calculate occupancy rates correctly', async () => {
      const response = await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const stats = response.body.data.currentOccupancy;
      expect(stats.totalRooms).toBe(3);
      expect(stats.occupancyRate).toBeGreaterThanOrEqual(0);
      expect(stats.occupancyRate).toBeLessThanOrEqual(100);
    });

    it('should group statistics by specified period', async () => {
      const response = await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}&groupBy=week`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.period.groupBy).toBe('week');
    });

    it('should break down statistics by room type', async () => {
      const response = await request(app)
        .get(`/api/rooms/stats/occupancy?hotelId=${testHotel._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const roomTypeBreakdown = response.body.data.roomTypeBreakdown;
      expect(roomTypeBreakdown).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: expect.any(String),
            total: expect.any(Number),
            occupancyRate: expect.any(Number)
          })
        ])
      );
    });
  });

  /**
   * ================================
   * TESTS ERROR HANDLING
   * ================================
   */

  describe('Error Handling', () => {
    it('should handle invalid ObjectId gracefully', async () => {
      const response = await request(app)
        .get('/api/rooms/invalid-id')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('invalide');
    });

    it('should handle missing authorization header', async () => {
      await request(app)
        .get(`/api/rooms/${testRooms[0]._id}`)
        .expect(401);
    });

    it('should handle invalid JWT token', async () => {
      await request(app)
        .get(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);
    });

    it('should handle database connection errors gracefully', async () => {
      // Mock database error
      const originalFindById = Room.findById;
      Room.findById = jest.fn().mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .get(`/api/rooms/${testRooms[0]._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(500);

      expect(response.body.success).toBe(false);

      // Restore original function
      Room.findById = originalFindById;
    });
  });

  /**
   * ================================
   * TESTS INTEGRATION SCENARIOS
   * ================================
   */

  describe('Integration Scenarios', () => {
    it('should handle complete room lifecycle', async () => {
      // 1. Create room
      const createResponse = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          number: '999',
          type: ROOM_TYPES.DOUBLE,
          floor: 9,
          basePrice: 400
        })
        .expect(201);

      const roomId = createResponse.body.data.room._id;

      // 2. Check availability
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);

      const availabilityResponse = await request(app)
        .get(`/api/rooms/${roomId}/availability?checkInDate=${tomorrow.toISOString()}&checkOutDate=${dayAfter.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(availabilityResponse.body.data.availability.available).toBe(true);

      // 3. Change status to maintenance
      await request(app)
        .put(`/api/rooms/${roomId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: ROOM_STATUS.MAINTENANCE,
          reason: 'Routine maintenance'
        })
        .expect(200);

      // 4. Verify unavailable during maintenance
      const unavailableResponse = await request(app)
        .get(`/api/rooms/${roomId}/availability?checkInDate=${tomorrow.toISOString()}&checkOutDate=${dayAfter.toISOString()}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(unavailableResponse.body.data.availability.available).toBe(false);

      // 5. Return to available
      await request(app)
        .put(`/api/rooms/${roomId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: ROOM_STATUS.AVAILABLE,
          reason: 'Maintenance completed'
        })
        .expect(200);

      // 6. Update room details
      await request(app)
        .put(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          basePrice: 450,
          amenities: ['TV', 'WiFi', 'Mini-bar']
        })
        .expect(200);

      // 7. Get final room state
      const finalResponse = await request(app)
        .get(`/api/rooms/${roomId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(finalResponse.body.data.room.status).toBe(ROOM_STATUS.AVAILABLE);
      expect(finalResponse.body.data.room.basePrice).toBe(450);
      expect(finalResponse.body.data.room.amenities).toContain('Mini-bar');

      // 8. Verify status history
      const room = await Room.findById(roomId);
      expect(room.statusHistory).toHaveLength(2);
    });

    it('should maintain data consistency during concurrent operations', async () => {
      const roomId = testRooms[0]._id;

      // Simulate concurrent status updates
      const statusUpdate1 = request(app)
        .put(`/api/rooms/${roomId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: ROOM_STATUS.MAINTENANCE,
          reason: 'Update 1'
        });

      const statusUpdate2 = request(app)
        .put(`/api/rooms/${roomId}/status`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          status: ROOM_STATUS.OCCUPIED,
          reason: 'Update 2'
        });

      const responses = await Promise.allSettled([statusUpdate1, statusUpdate2]);

      // At least one should succeed
      const successfulResponses = responses.filter(r => 
        r.status === 'fulfilled' && r.value.status === 200
      );
      expect(successfulResponses.length).toBeGreaterThanOrEqual(1);

      // Verify final state is consistent
      const finalRoom = await Room.findById(roomId);
      expect([ROOM_STATUS.MAINTENANCE, ROOM_STATUS.OCCUPIED]).toContain(finalRoom.status);
    });
  });

  /**
   * ================================
   * TESTS PERFORMANCE AND EDGE CASES
   * ================================
   */

  describe('Performance and Edge Cases', () => {
    it('should handle large number of rooms efficiently', async () => {
      // Create many rooms for pagination testing
      const manyRooms = Array.from({ length: 50 }, (_, i) => ({
        hotel: testHotel._id,
        number: `A${i + 100}`,
        type: ROOM_TYPES.SIMPLE,
        floor: Math.floor(i / 10) + 1,
        basePrice: 200 + (i * 10),
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      }));

      await Room.insertMany(manyRooms);

      const startTime = Date.now();
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/rooms?limit=20`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      const endTime = Date.now();
      const responseTime = endTime - startTime;

      expect(response.body.data.rooms).toHaveLength(20);
      expect(response.body.data.pagination.totalCount).toBeGreaterThan(50);
      expect(responseTime).toBeLessThan(1000); // Should respond within 1 second
    });

    it('should handle edge case room numbers and types', async () => {
      const edgeCaseRoom = {
        number: '0001',
        type: ROOM_TYPES.SUITE,
        floor: 0,
        basePrice: BUSINESS_RULES.MIN_ROOM_PRICE,
        description: 'A'.repeat(1000) // Very long description
      };

      const response = await request(app)
        .post(`/api/hotels/${testHotel._id}/rooms`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(edgeCaseRoom)
        .expect(201);

      expect(response.body.data.room.number).toBe('0001');
      expect(response.body.data.room.floor).toBe(0);
    });

    it('should handle simultaneous availability checks', async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date();
      dayAfter.setDate(dayAfter.getDate() + 2);

      // Multiple simultaneous availability checks
      const checks = Array.from({ length: 10 }, () =>
        request(app)
          .get(`/api/rooms/search/available?hotelId=${testHotel._id}&checkInDate=${tomorrow.toISOString()}&checkOutDate=${dayAfter.toISOString()}`)
          .set('Authorization', `Bearer ${adminToken}`)
      );

      const responses = await Promise.all(checks);
      
      // All should succeed and return consistent results
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
      });

      // Results should be consistent
      const firstResult = responses[0].body.data.rooms.length;
      responses.forEach(response => {
        expect(response.body.data.rooms.length).toBe(firstResult);
      });
    });
  });
});

/**
 * ================================
 * HELPER FUNCTIONS FOR TESTS
 * ================================
 */

// Helper to create test booking for room assignment tests
const createTestBookingForAssignment = async (hotelId, customerId, roomRequirements) => {
  return await Booking.create({
    hotel: hotelId,
    customer: customerId,
    checkInDate: new Date(),
    checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
    rooms: roomRequirements,
    numberOfGuests: roomRequirements.length,
    totalPrice: roomRequirements.reduce((sum, room) => sum + room.calculatedPrice, 0),
    status: 'Confirmed',
    createdBy: customerId
  });
};

// Helper to verify room status transitions
const verifyStatusTransition = async (roomId, expectedStatus) => {
  const room = await Room.findById(roomId);
  expect(room.status).toBe(expectedStatus);
  return room;
};

// Helper to create multiple rooms with different statuses
const createRoomsWithVariousStatuses = async (hotelId, createdBy) => {
  return await Room.create([
    {
      hotel: hotelId,
      number: 'T001',
      type: ROOM_TYPES.SIMPLE,
      floor: 1,
      basePrice: 150,
      status: ROOM_STATUS.AVAILABLE,
      createdBy
    },
    {
      hotel: hotelId,
      number: 'T002',
      type: ROOM_TYPES.DOUBLE,
      floor: 1,
      basePrice: 250,
      status: ROOM_STATUS.OCCUPIED,
      createdBy
    },
    {
      hotel: hotelId,
      number: 'T003',
      type: ROOM_TYPES.SUITE,
      floor: 2,
      basePrice: 500,
      status: ROOM_STATUS.MAINTENANCE,
      createdBy
    },
    {
      hotel: hotelId,
      number: 'T004',
      type: ROOM_TYPES.DOUBLE_COMFORT,
      floor: 2,
      basePrice: 350,
      status: ROOM_STATUS.OUT_OF_ORDER,
      createdBy
    }
  ]);
};