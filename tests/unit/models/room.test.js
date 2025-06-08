const mongoose = require('mongoose');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createTestHotelWithRooms,
  createUserWithRole,
  createRoomData,
  futureDate,
  pastDate,
  countDocuments,
  expectUserProperties
} = require('../setup/test-helpers');

// Models to test
const Room = require('../../models/Room');
const Hotel = require('../../models/Hotel');
const User = require('../../models/User');
const Booking = require('../../models/Booking');

describe('Room Model Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // SCHEMA VALIDATION TESTS
  // ============================================================================

  describe('Schema Validation', () => {
    test('should create room with valid data', async () => {
      const { hotel } = await createTestHotelWithRooms();
      
      const roomData = createRoomData({
        number: '101',
        type: 'Double',
        hotelId: hotel._id,
        basePrice: 120
      });

      const room = new Room(roomData);
      const savedRoom = await room.save();

      expect(savedRoom._id).toBeDefined();
      expect(savedRoom.number).toBe('101');
      expect(savedRoom.type).toBe('Double');
      expect(savedRoom.hotel.toString()).toBe(hotel._id.toString());
      expect(savedRoom.basePrice).toBe(120);
      expect(savedRoom.status).toBe('AVAILABLE');
      expect(savedRoom.isActive).toBe(true);
      expect(savedRoom.capacity.adults).toBe(2); // Auto-assigned for Double
      expect(savedRoom.capacity.children).toBe(1);
    });

    test('should require mandatory fields', async () => {
      // Test missing number
      const roomNoNumber = new Room({
        type: 'Double',
        basePrice: 100
      });
      await expect(roomNoNumber.save()).rejects.toThrow('Le numéro de chambre est requis');

      // Test missing type
      const roomNoType = new Room({
        number: '101',
        basePrice: 100
      });
      await expect(roomNoType.save()).rejects.toThrow('Le type de chambre est requis');

      // Test missing basePrice
      const roomNoPrice = new Room({
        number: '101',
        type: 'Double'
      });
      await expect(roomNoPrice.save()).rejects.toThrow('Le prix de base est requis');

      // Test missing hotel
      const roomNoHotel = new Room({
        number: '101',
        type: 'Double',
        basePrice: 100
      });
      await expect(roomNoHotel.save()).rejects.toThrow('L\'hôtel de référence est requis');
    });

    test('should validate room types', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const invalidTypes = ['Standard', 'Deluxe', 'Premium', 'INVALID'];
      
      for (const invalidType of invalidTypes) {
        const room = new Room({
          number: '101',
          type: invalidType,
          hotel: hotel._id,
          basePrice: 100
        });
        await expect(room.save()).rejects.toThrow('Le type de chambre doit être Simple, Double, Double Confort ou Suite');
      }
    });

    test('should validate price is positive', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Test negative price
      const roomNegativePrice = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: -50
      });
      await expect(roomNegativePrice.save()).rejects.toThrow('Le prix ne peut pas être négatif');

      // Test zero price
      const roomZeroPrice = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 0
      });
      await expect(roomZeroPrice.save()).rejects.toThrow('Le prix de base doit être supérieur à 0');
    });

    test('should enforce unique room number per hotel', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Create first room
      const room1 = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100
      });
      await room1.save();

      // Try to create second room with same number in same hotel
      const room2 = new Room({
        number: '101',
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 80
      });
      await expect(room2.save()).rejects.toThrow();
    });

    test('should allow same room number in different hotels', async () => {
      const admin = await createUserWithRole('ADMIN');
      
      // Create two different hotels
      const hotel1 = new Hotel({
        code: 'HTL001',
        name: 'Hotel 1',
        address: {
          street: '123 Street',
          city: 'Paris',
          postalCode: '75001'
        },
        stars: 4,
        contact: { phone: '0140000001', email: 'hotel1@test.com' },
        manager: admin._id
      });
      await hotel1.save();

      const hotel2 = new Hotel({
        code: 'HTL002',
        name: 'Hotel 2',
        address: {
          street: '456 Street',
          city: 'Lyon',
          postalCode: '69001'
        },
        stars: 3,
        contact: { phone: '0140000002', email: 'hotel2@test.com' },
        manager: admin._id
      });
      await hotel2.save();

      // Create rooms with same number in different hotels
      const room1 = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel1._id,
        basePrice: 100
      });
      const room2 = new Room({
        number: '101',
        type: 'Simple',
        hotel: hotel2._id,
        basePrice: 80
      });

      await room1.save();
      await room2.save(); // Should not throw error

      expect(room1.number).toBe('101');
      expect(room2.number).toBe('101');
      expect(room1.hotel.toString()).not.toBe(room2.hotel.toString());
    });

    test('should validate status enum', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const invalidStatuses = ['BUSY', 'RESERVED', 'INVALID'];
      
      for (const invalidStatus of invalidStatuses) {
        const room = new Room({
          number: '101',
          type: 'Double',
          hotel: hotel._id,
          basePrice: 100,
          status: invalidStatus
        });
        await expect(room.save()).rejects.toThrow('Statut invalide');
      }
    });

    test('should validate floor bounds', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Test negative floor
      const roomNegativeFloor = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100,
        floor: -1
      });
      await expect(roomNegativeFloor.save()).rejects.toThrow('L\'étage ne peut pas être négatif');

      // Test floor too high
      const roomHighFloor = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100,
        floor: 51
      });
      await expect(roomHighFloor.save()).rejects.toThrow('L\'étage ne peut pas dépasser 50');
    });
  });

  // ============================================================================
  // ROOM TYPE CAPACITY TESTS
  // ============================================================================

  describe('Room Type Capacity Assignment', () => {
    test('should auto-assign capacity for Simple room', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 80
      });
      await room.save();

      expect(room.capacity.adults).toBe(1);
      expect(room.capacity.children).toBe(0);
    });

    test('should auto-assign capacity for Double room', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '102',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      });
      await room.save();

      expect(room.capacity.adults).toBe(2);
      expect(room.capacity.children).toBe(1);
    });

    test('should auto-assign capacity for Double Confort room', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '201',
        type: 'Double Confort',
        hotel: hotel._id,
        basePrice: 160
      });
      await room.save();

      expect(room.capacity.adults).toBe(2);
      expect(room.capacity.children).toBe(2);
    });

    test('should auto-assign capacity for Suite room', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '301',
        type: 'Suite',
        hotel: hotel._id,
        basePrice: 300
      });
      await room.save();

      expect(room.capacity.adults).toBe(4);
      expect(room.capacity.children).toBe(2);
    });

    test('should update capacity when type changes', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 80
      });
      await room.save();

      expect(room.capacity.adults).toBe(1);
      expect(room.capacity.children).toBe(0);

      // Change type to Suite
      room.type = 'Suite';
      await room.save();

      expect(room.capacity.adults).toBe(4);
      expect(room.capacity.children).toBe(2);
    });
  });

  // ============================================================================
  // VIRTUAL PROPERTIES TESTS
  // ============================================================================

  describe('Virtual Properties', () => {
    test('should generate full name', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double Confort',
        hotel: hotel._id,
        basePrice: 160
      });

      expect(room.fullName).toBe('Double Confort 101');
    });

    test('should calculate total capacity', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '301',
        type: 'Suite',
        hotel: hotel._id,
        basePrice: 300
      });

      expect(room.totalCapacity).toBe(6); // 4 adults + 2 children
    });

    test('should identify maintenance status', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        status: 'MAINTENANCE'
      });

      expect(room.isInMaintenance).toBe(true);

      room.status = 'AVAILABLE';
      expect(room.isInMaintenance).toBe(false);

      room.status = 'OUT_OF_ORDER';
      expect(room.isInMaintenance).toBe(true);

      room.status = 'CLEANING';
      expect(room.isInMaintenance).toBe(true);
    });

    test('should check if maintenance is due', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      });

      // No maintenance scheduled
      expect(room.maintenanceDue).toBe(false);

      // Schedule future maintenance
      room.maintenance.nextMaintenance = futureDate(7);
      expect(room.maintenanceDue).toBe(false);

      // Schedule overdue maintenance
      room.maintenance.nextMaintenance = pastDate(1);
      expect(room.maintenanceDue).toBe(true);
    });

    test('should get primary image', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        images: [
          { url: 'https://example.com/room1.jpg', alt: 'Room view' },
          { url: 'https://example.com/room2.jpg', alt: 'Bathroom', isPrimary: true },
          { url: 'https://example.com/room3.jpg', alt: 'Balcony' }
        ]
      });

      expect(room.primaryImage.url).toBe('https://example.com/room2.jpg');
      expect(room.primaryImage.isPrimary).toBe(true);
    });

    test('should return first image when no primary set', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        images: [
          { url: 'https://example.com/room1.jpg', alt: 'Room view' },
          { url: 'https://example.com/room2.jpg', alt: 'Bathroom' }
        ]
      });

      expect(room.primaryImage.url).toBe('https://example.com/room1.jpg');
    });
  });

  // ============================================================================
  // PRICE CALCULATION TESTS
  // ============================================================================

  describe('Price Calculation', () => {
    test('should return base price when no special pricing', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];

      const price = await room.getPriceForDate(new Date());
      expect(price).toBe(room.basePrice);
    });

    test('should apply seasonal multiplier from hotel', async () => {
      const admin = await createUserWithRole('ADMIN');
      
      // Create hotel with seasonal pricing
      const hotel = new Hotel({
        code: 'HTL001',
        name: 'Seasonal Hotel',
        address: {
          street: '123 Street',
          city: 'Paris',
          postalCode: '75001'
        },
        stars: 4,
        contact: { phone: '0140000001', email: 'hotel@test.com' },
        manager: admin._id,
        seasonalPricing: [
          {
            name: 'HAUTE_SAISON',
            startDate: new Date('2025-07-01'),
            endDate: new Date('2025-08-31'),
            multiplier: 1.5
          }
        ]
      });
      await hotel.save();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100
      });
      await room.save();

      // Test during high season
      const highSeasonPrice = await room.getPriceForDate(new Date('2025-07-15'));
      expect(highSeasonPrice).toBe(150); // 100 * 1.5

      // Test outside high season
      const normalPrice = await room.getPriceForDate(new Date('2025-06-15'));
      expect(normalPrice).toBe(100); // Base price
    });

    test('should apply special pricing over seasonal pricing', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100,
        specialPricing: [
          {
            name: 'VIP Event',
            startDate: new Date('2025-07-10'),
            endDate: new Date('2025-07-20'),
            priceOverride: 200,
            reason: 'EVENT'
          }
        ]
      });
      await room.save();

      // Test during special pricing period
      const specialPrice = await room.getPriceForDate(new Date('2025-07-15'));
      expect(specialPrice).toBe(200); // Override price
    });

    test('should apply special multiplier pricing', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 100,
        specialPricing: [
          {
            name: 'Weekend Special',
            startDate: new Date('2025-07-10'),
            endDate: new Date('2025-07-20'),
            multiplier: 1.2,
            reason: 'PROMOTION'
          }
        ]
      });
      await room.save();

      const specialPrice = await room.getPriceForDate(new Date('2025-07-15'));
      expect(specialPrice).toBe(120); // 100 * 1.2
    });

    test('should round price to 2 decimals', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 99.99,
        specialPricing: [
          {
            name: 'Complex Pricing',
            startDate: new Date('2025-07-10'),
            endDate: new Date('2025-07-20'),
            multiplier: 1.333,
            reason: 'PROMOTION'
          }
        ]
      });
      await room.save();

      const price = await room.getPriceForDate(new Date('2025-07-15'));
      expect(price).toBe(133.32); // 99.99 * 1.333 = 133.31667, rounded to 133.32
    });
  });

  // ============================================================================
  // AVAILABILITY TESTS
  // ============================================================================

  describe('Availability Tests', () => {
    test('should be available when status is AVAILABLE and no bookings', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];

      const checkIn = futureDate(1);
      const checkOut = futureDate(3);
      
      const isAvailable = await room.isAvailableForPeriod(checkIn, checkOut);
      expect(isAvailable).toBe(true);
    });

    test('should not be available when status is not AVAILABLE', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      
      room.status = 'MAINTENANCE';
      await room.save();

      const checkIn = futureDate(1);
      const checkOut = futureDate(3);
      
      const isAvailable = await room.isAvailableForPeriod(checkIn, checkOut);
      expect(isAvailable).toBe(false);
    });

    test('should not be available when booked for overlapping period', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const client = await createUserWithRole('CLIENT');

      // Create a booking
      const booking = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: room._id,
          pricePerNight: 120,
          guests: [{ firstName: 'John', lastName: 'Doe', isMainGuest: true }]
        }],
        checkIn: futureDate(2),
        checkOut: futureDate(5),
        totalGuests: { adults: 1, children: 0 },
        source: 'WEB',
        status: 'CONFIRMED',
        pricing: {
          subtotal: 360,
          taxes: 36,
          totalPrice: 396
        }
      });
      await booking.save();

      // Test overlapping periods
      const checkIn1 = futureDate(1);
      const checkOut1 = futureDate(3); // Overlaps with booking
      const isAvailable1 = await room.isAvailableForPeriod(checkIn1, checkOut1);
      expect(isAvailable1).toBe(false);

      const checkIn2 = futureDate(4);
      const checkOut2 = futureDate(6); // Overlaps with booking
      const isAvailable2 = await room.isAvailableForPeriod(checkIn2, checkOut2);
      expect(isAvailable2).toBe(false);

      // Test non-overlapping period
      const checkIn3 = futureDate(6);
      const checkOut3 = futureDate(8); // After booking
      const isAvailable3 = await room.isAvailableForPeriod(checkIn3, checkOut3);
      expect(isAvailable3).toBe(true);
    });

    test('should be available when booking is cancelled', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const client = await createUserWithRole('CLIENT');

      // Create a cancelled booking
      const booking = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: room._id,
          pricePerNight: 120,
          guests: [{ firstName: 'John', lastName: 'Doe', isMainGuest: true }]
        }],
        checkIn: futureDate(2),
        checkOut: futureDate(5),
        totalGuests: { adults: 1, children: 0 },
        source: 'WEB',
        status: 'CANCELLED',
        pricing: {
          subtotal: 360,
          taxes: 36,
          totalPrice: 396
        }
      });
      await booking.save();

      const checkIn = futureDate(1);
      const checkOut = futureDate(3);
      const isAvailable = await room.isAvailableForPeriod(checkIn, checkOut);
      expect(isAvailable).toBe(true);
    });
  });

  // ============================================================================
  // MAINTENANCE TESTS
  // ============================================================================

  describe('Maintenance Management', () => {
    test('should add maintenance note', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const technician = await createUserWithRole('RECEPTIONIST');

      await room.addMaintenanceNote(
        'REPAIR',
        'Fixed air conditioning',
        technician._id,
        150
      );

      const updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.maintenance.notes).toHaveLength(1);
      
      const note = updatedRoom.maintenance.notes[0];
      expect(note.type).toBe('REPAIR');
      expect(note.description).toBe('Fixed air conditioning');
      expect(note.technician.toString()).toBe(technician._id.toString());
      expect(note.cost).toBe(150);
      expect(note.completed).toBe(false);
    });

    test('should complete maintenance and update status', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const technician = await createUserWithRole('RECEPTIONIST');

      // Add room to maintenance
      room.status = 'MAINTENANCE';
      await room.save();

      // Add maintenance note
      await room.addMaintenanceNote('CLEANING', 'Deep clean', technician._id);
      
      const noteId = room.maintenance.notes[0]._id;
      await room.completeMaintenance(noteId);

      const updatedRoom = await Room.findById(room._id);
      const note = updatedRoom.maintenance.notes[0];
      
      expect(note.completed).toBe(true);
      expect(updatedRoom.maintenance.lastCleaning).toBeDefined();
      expect(updatedRoom.status).toBe('AVAILABLE'); // Should be back to available
    });

    test('should update lastMaintenance for non-cleaning tasks', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const technician = await createUserWithRole('RECEPTIONIST');

      await room.addMaintenanceNote('REPAIR', 'Fixed TV', technician._id);
      
      const noteId = room.maintenance.notes[0]._id;
      await room.completeMaintenance(noteId);

      const updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.maintenance.lastMaintenance).toBeDefined();
    });

    test('should validate status transitions', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];

      // Valid transitions
      await room.changeStatus('OCCUPIED');
      expect(room.status).toBe('OCCUPIED');

      await room.changeStatus('CLEANING');
      expect(room.status).toBe('CLEANING');

      await room.changeStatus('AVAILABLE');
      expect(room.status).toBe('AVAILABLE');

      // Invalid transition
      await expect(room.changeStatus('OUT_OF_ORDER')).rejects.toThrow('Transition');
    });

    test('should add reason note when changing status', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];

      await room.changeStatus('MAINTENANCE', 'AC repair needed');

      expect(room.status).toBe('MAINTENANCE');
      expect(room.maintenance.notes).toHaveLength(1);
      expect(room.maintenance.notes[0].description).toContain('AC repair needed');
    });
  });

  // ============================================================================
  // STATISTICS TESTS
  // ============================================================================

  describe('Statistics and Reporting', () => {
    test('should update room statistics', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];
      const client = await createUserWithRole('CLIENT');

      // Create completed bookings
      const booking1 = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: room._id,
          pricePerNight: 120,
          guests: [{ firstName: 'John', lastName: 'Doe', isMainGuest: true }]
        }],
        checkIn: pastDate(10),
        checkOut: pastDate(8),
        totalGuests: { adults: 1, children: 0 },
        source: 'WEB',
        status: 'COMPLETED',
        pricing: {
          subtotal: 240,
          taxes: 24,
          totalPrice: 264
        }
      });

      const booking2 = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: room._id,
          pricePerNight: 120,
          guests: [{ firstName: 'Jane', lastName: 'Smith', isMainGuest: true }]
        }],
        checkIn: pastDate(7),
        checkOut: pastDate(4),
        totalGuests: { adults: 1, children: 0 },
        source: 'MOBILE',
        status: 'COMPLETED',
        pricing: {
          subtotal: 360,
          taxes: 36,
          totalPrice: 396
        }
      });

      await booking1.save();
      await booking2.save();

      await room.updateStats();

      const updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.stats.totalBookings).toBe(2);
      expect(updatedRoom.stats.totalRevenue).toBe(660); // 264 + 396
      expect(updatedRoom.stats.occupancyRate).toBeGreaterThan(0);
    });

    test('should get statistics by room type', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Create additional rooms
      const simpleRoom = new Room({
        number: '105',
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 80
      });

      const suiteRoom = new Room({
        number: '305',
        type: 'Suite',
        hotel: hotel._id,
        basePrice: 300
      });

      await simpleRoom.save();
      await suiteRoom.save();

      const stats = await Room.getStatsByType(hotel._id);

      expect(stats).toHaveLength(4); // Simple, Double, Double Confort, Suite
      
      const simpleStats = stats.find(s => s._id === 'Simple');
      const suiteStats = stats.find(s => s._id === 'Suite');

      expect(simpleStats.count).toBe(2); // Original + new one
      expect(suiteStats.count).toBe(2); // Original + new one
      expect(simpleStats.avgPrice).toBe(80);
      expect(suiteStats.avgPrice).toBe(300);
    });

    test('should get rooms needing maintenance', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const room = rooms[0];

      // Set room to maintenance status
      room.status = 'MAINTENANCE';
      await room.save();

      // Set another room with overdue maintenance
      const room2 = rooms[1];
      room2.maintenance.nextMaintenance = pastDate(1);
      await room2.save();

      const needingMaintenance = await Room.getRoomsNeedingMaintenance(hotel._id);

      expect(needingMaintenance).toHaveLength(2);
      expect(needingMaintenance.some(r => r._id.toString() === room._id.toString())).toBe(true);
      expect(needingMaintenance.some(r => r._id.toString() === room2._id.toString())).toBe(true);
    });

    test('should get occupancy by floor', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Create rooms on different floors
      const room1Floor2 = new Room({
        number: '201',
        floor: 2,
        type: 'Double',
        hotel: hotel._id,
        basePrice: 130,
        status: 'AVAILABLE'
      });

      const room2Floor2 = new Room({
        number: '202',
        floor: 2,
        type: 'Double Confort',
        hotel: hotel._id,
        basePrice: 170,
        status: 'OCCUPIED'
      });

      const room1Floor3 = new Room({
        number: '301',
        floor: 3,
        type: 'Suite',
        hotel: hotel._id,
        basePrice: 320,
        status: 'AVAILABLE'
      });

      await room1Floor2.save();
      await room2Floor2.save();
      await room1Floor3.save();

      const occupancyByFloor = await Room.getOccupancyByFloor(hotel._id);

      expect(occupancyByFloor).toHaveLength(4); // floors 1, 2, 3, and original rooms

      const floor2Stats = occupancyByFloor.find(f => f._id === 2);
      expect(floor2Stats.totalRooms).toBe(2);
      expect(floor2Stats.availableRooms).toBe(1); // One available, one occupied
    });
  });

  // ============================================================================
  // STATIC METHODS TESTS
  // ============================================================================

  describe('Static Methods', () => {
    test('should find available rooms', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const client = await createUserWithRole('CLIENT');

      // Create a booking for one room
      const booking = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: rooms[0]._id,
          pricePerNight: 120,
          guests: [{ firstName: 'John', lastName: 'Doe', isMainGuest: true }]
        }],
        checkIn: futureDate(1),
        checkOut: futureDate(3),
        totalGuests: { adults: 1, children: 0 },
        source: 'WEB',
        status: 'CONFIRMED',
        pricing: {
          subtotal: 240,
          taxes: 24,
          totalPrice: 264
        }
      });
      await booking.save();

      const availableRooms = await Room.findAvailableRooms(
        hotel._id,
        futureDate(1),
        futureDate(3),
        null,
        1
      );

      // Should return 3 rooms (4 total - 1 booked)
      expect(availableRooms).toHaveLength(3);
      expect(availableRooms.every(room => room._id.toString() !== rooms[0]._id.toString())).toBe(true);
    });

    test('should filter available rooms by type', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();

      const availableDoubleRooms = await Room.findAvailableRooms(
        hotel._id,
        futureDate(1),
        futureDate(3),
        'Double',
        2
      );

      expect(availableDoubleRooms.every(room => room.type === 'Double')).toBe(true);
      expect(availableDoubleRooms.every(room => room.capacity.adults >= 2)).toBe(true);
    });

    test('should filter available rooms by guest count', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();

      const availableForFamily = await Room.findAvailableRooms(
        hotel._id,
        futureDate(1),
        futureDate(3),
        null,
        4
      );

      // Only Suites can accommodate 4 adults
      expect(availableForFamily.every(room => room.capacity.adults >= 4)).toBe(true);
      expect(availableForFamily.every(room => room.type === 'Suite')).toBe(true);
    });

    test('should exclude inactive rooms from availability', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Make one room inactive
      rooms[0].isActive = false;
      await rooms[0].save();

      const availableRooms = await Room.findAvailableRooms(
        hotel._id,
        futureDate(1),
        futureDate(3)
      );

      expect(availableRooms).toHaveLength(3); // 4 total - 1 inactive
      expect(availableRooms.every(room => room.isActive)).toBe(true);
    });
  });

  // ============================================================================
  // IMAGE MANAGEMENT TESTS
  // ============================================================================

  describe('Image Management', () => {
    test('should set first image as primary when none specified', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        images: [
          { url: 'https://example.com/room1.jpg', alt: 'Room view' },
          { url: 'https://example.com/room2.jpg', alt: 'Bathroom' }
        ]
      });

      await room.save();

      expect(room.images[0].isPrimary).toBe(true);
      expect(room.images[1].isPrimary).toBe(false);
    });

    test('should maintain only one primary image', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        images: [
          { url: 'https://example.com/room1.jpg', alt: 'Room view', isPrimary: true },
          { url: 'https://example.com/room2.jpg', alt: 'Bathroom', isPrimary: true },
          { url: 'https://example.com/room3.jpg', alt: 'Balcony', isPrimary: true }
        ]
      });

      await room.save();

      const primaryImages = room.images.filter(img => img.isPrimary);
      expect(primaryImages).toHaveLength(1);
      expect(room.images[0].isPrimary).toBe(true);
    });

    test('should validate image URLs', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const roomInvalidImage = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        images: [
          { url: 'not-a-valid-url', alt: 'Room view' }
        ]
      });

      await expect(roomInvalidImage.save()).rejects.toThrow('URL d\'image invalide');
    });
  });

  // ============================================================================
  // SPECIAL PRICING VALIDATION TESTS
  // ============================================================================

  describe('Special Pricing Validation', () => {
    test('should validate date ranges in special pricing', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const roomInvalidDates = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        specialPricing: [
          {
            name: 'Invalid Range',
            startDate: new Date('2025-07-20'),
            endDate: new Date('2025-07-10'), // End before start
            multiplier: 1.2,
            reason: 'PROMOTION'
          }
        ]
      });

      await expect(roomInvalidDates.save()).rejects.toThrow('La date de début doit être antérieure à la date de fin');
    });

    test('should prevent both priceOverride and multiplier', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const roomBothPricing = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        specialPricing: [
          {
            name: 'Conflicting Pricing',
            startDate: new Date('2025-07-10'),
            endDate: new Date('2025-07-20'),
            priceOverride: 200,
            multiplier: 1.5,
            reason: 'PROMOTION'
          }
        ]
      });

      await expect(roomBothPricing.save()).rejects.toThrow('Utilisez soit priceOverride soit multiplier, pas les deux');
    });

    test('should set default multiplier when neither provided', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const room = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        specialPricing: [
          {
            name: 'Default Multiplier',
            startDate: new Date('2025-07-10'),
            endDate: new Date('2025-07-20'),
            reason: 'PROMOTION'
          }
        ]
      });

      await room.save();
      expect(room.specialPricing[0].multiplier).toBe(1.0);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    test('should work with hotel seasonal pricing', async () => {
      const admin = await createUserWithRole('ADMIN');
      
      // Create hotel with complex seasonal pricing
      const hotel = new Hotel({
        code: 'HTL001',
        name: 'Seasonal Resort',
        address: {
          street: '123 Beach Road',
          city: 'Nice',
          postalCode: '06000'
        },
        stars: 5,
        contact: { phone: '0140000001', email: 'resort@test.com' },
        manager: admin._id,
        seasonalPricing: [
          {
            name: 'HAUTE_SAISON',
            startDate: new Date('2025-07-01'),
            endDate: new Date('2025-08-31'),
            multiplier: 1.8
          },
          {
            name: 'BASSE_SAISON',
            startDate: new Date('2025-11-01'),
            endDate: new Date('2025-03-31'),
            multiplier: 0.7
          }
        ]
      });
      await hotel.save();

      const room = new Room({
        number: '101',
        type: 'Suite',
        hotel: hotel._id,
        basePrice: 200
      });
      await room.save();

      // Test high season pricing
      const highSeasonPrice = await room.getPriceForDate(new Date('2025-08-15'));
      expect(highSeasonPrice).toBe(360); // 200 * 1.8

      // Test low season pricing
      const lowSeasonPrice = await room.getPriceForDate(new Date('2025-12-15'));
      expect(lowSeasonPrice).toBe(140); // 200 * 0.7

      // Test normal season pricing
      const normalPrice = await room.getPriceForDate(new Date('2025-10-15'));
      expect(normalPrice).toBe(200); // Base price
    });

    test('should handle complex booking scenarios', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const client = await createUserWithRole('CLIENT');

      // Create overlapping bookings
      const booking1 = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: rooms[0]._id,
          pricePerNight: 120,
          guests: [{ firstName: 'John', lastName: 'Doe', isMainGuest: true }]
        }],
        checkIn: futureDate(1),
        checkOut: futureDate(4),
        totalGuests: { adults: 1, children: 0 },
        source: 'WEB',
        status: 'CONFIRMED',
        pricing: { subtotal: 360, taxes: 36, totalPrice: 396 }
      });

      const booking2 = new Booking({
        user: client._id,
        hotel: hotel._id,
        rooms: [{
          room: rooms[1]._id,
          pricePerNight: 130,
          guests: [{ firstName: 'Jane', lastName: 'Smith', isMainGuest: true }]
        }],
        checkIn: futureDate(2),
        checkOut: futureDate(5),
        totalGuests: { adults: 1, children: 0 },
        source: 'MOBILE',
        status: 'CONFIRMED',
        pricing: { subtotal: 390, taxes: 39, totalPrice: 429 }
      });

      await booking1.save();
      await booking2.save();

      // Check availability for different periods
      const available1 = await Room.findAvailableRooms(
        hotel._id,
        futureDate(1),
        futureDate(2) // Conflicts with booking1
      );
      expect(available1).toHaveLength(3); // 4 total - 1 booked

      const available2 = await Room.findAvailableRooms(
        hotel._id,
        futureDate(3),
        futureDate(4) // Conflicts with both bookings
      );
      expect(available2).toHaveLength(2); // 4 total - 2 booked

      const available3 = await Room.findAvailableRooms(
        hotel._id,
        futureDate(6),
        futureDate(8) // No conflicts
      );
      expect(available3).toHaveLength(4); // All available
    });

    test('should handle maintenance workflow', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const technician = await createUserWithRole('RECEPTIONIST');
      const room = rooms[0];

      // Start maintenance
      await room.changeStatus('MAINTENANCE', 'Annual maintenance');
      expect(room.status).toBe('MAINTENANCE');
      expect(room.isInMaintenance).toBe(true);

      // Add multiple maintenance tasks
      await room.addMaintenanceNote('CLEANING', 'Deep clean carpets', technician._id, 100);
      await room.addMaintenanceNote('REPAIR', 'Fix bathroom leak', technician._id, 250);
      await room.addMaintenanceNote('INSPECTION', 'Safety check', technician._id, 50);

      let updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.maintenance.notes).toHaveLength(4); // 3 new + 1 from status change

      // Complete tasks one by one
      const cleaningNote = updatedRoom.maintenance.notes.find(n => n.type === 'CLEANING');
      await updatedRoom.completeMaintenance(cleaningNote._id);

      updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.status).toBe('MAINTENANCE'); // Still in maintenance

      // Complete remaining tasks
      const repairNote = updatedRoom.maintenance.notes.find(n => n.type === 'REPAIR' && !n.completed);
      const inspectionNote = updatedRoom.maintenance.notes.find(n => n.type === 'INSPECTION');

      await updatedRoom.completeMaintenance(repairNote._id);
      await updatedRoom.completeMaintenance(inspectionNote._id);

      // Complete the status change note
      const statusNote = updatedRoom.maintenance.notes.find(n => n.description.includes('Annual maintenance'));
      await updatedRoom.completeMaintenance(statusNote._id);

      updatedRoom = await Room.findById(room._id);
      expect(updatedRoom.status).toBe('AVAILABLE'); // Should be back to available
      expect(updatedRoom.maintenance.lastMaintenance).toBeDefined();
    });
  });

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    test('should handle room number validation', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Test empty room number
      const roomEmptyNumber = new Room({
        number: '',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      });
      await expect(roomEmptyNumber.save()).rejects.toThrow('Le numéro de chambre est requis');

      // Test room number too long
      const roomLongNumber = new Room({
        number: '12345678901', // 11 characters
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      });
      await expect(roomLongNumber.save()).rejects.toThrow('Le numéro de chambre ne peut pas dépasser 10 caractères');

      // Test invalid characters in room number
      const roomInvalidChars = new Room({
        number: '101@#',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      });
      await expect(roomInvalidChars.save()).rejects.toThrow('Le numéro de chambre ne peut contenir que des lettres, chiffres et tirets');
    });

    test('should handle capacity validation', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Test invalid adult capacity
      const roomInvalidAdults = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        capacity: {
          adults: 9, // Max is 8
          children: 2
        }
      });
      await expect(roomInvalidAdults.save()).rejects.toThrow('Maximum 8 adultes');

      // Test invalid children capacity
      const roomInvalidChildren = new Room({
        number: '102',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        capacity: {
          adults: 2,
          children: 5 // Max is 4
        }
      });
      await expect(roomInvalidChildren.save()).rejects.toThrow('Maximum 4 enfants');
    });

    test('should handle area validation', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Test area too small
      const roomSmallArea = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        area: 5 // Min is 10
      });
      await expect(roomSmallArea.save()).rejects.toThrow('La superficie minimum est de 10m²');

      // Test area too large
      const roomLargeArea = new Room({
        number: '102',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        area: 250 // Max is 200
      });
      await expect(roomLargeArea.save()).rejects.toThrow('La superficie maximum est de 200m²');
    });

    test('should handle invalid amenities', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const roomInvalidAmenities = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        amenities: ['WiFi gratuit', 'Invalid Amenity', 'Télévision']
      });

      await expect(roomInvalidAmenities.save()).rejects.toThrow();
    });

    test('should handle concurrent room creation', async () => {
      const { hotel } = await createTestHotelWithRooms();

      // Try to create multiple rooms with same number simultaneously
      const room1Promise = new Room({
        number: '999',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120
      }).save();

      const room2Promise = new Room({
        number: '999',
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 80
      }).save();

      const results = await Promise.allSettled([room1Promise, room2Promise]);
      
      // One should succeed, one should fail due to unique constraint
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
    });

    test('should handle null and undefined values gracefully', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const roomWithNulls = new Room({
        number: '101',
        type: 'Double',
        hotel: hotel._id,
        basePrice: 120,
        area: null,
        amenities: undefined,
        images: []
      });

      const savedRoom = await roomWithNulls.save();
      expect(savedRoom.area).toBeNull();
      expect(savedRoom.amenities).toEqual([]);
      expect(savedRoom.images).toEqual([]);
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should handle large number of rooms efficiently', async () => {
      const { hotel } = await createTestHotelWithRooms();

      const startTime = Date.now();
      
      // Create 100 rooms
      const roomPromises = [];
      for (let i = 1; i <= 100; i++) {
        const room = new Room({
          number: `R${i.toString().padStart(3, '0')}`,
          type: ['Simple', 'Double', 'Double Confort', 'Suite'][i % 4],
          hotel: hotel._id,
          basePrice: 80 + (i % 4) * 40,
          floor: Math.ceil(i / 20)
        });
        roomPromises.push(room.save());
      }

      await Promise.all(roomPromises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 5 seconds)
      expect(duration).toBeLessThan(5000);

      // Verify all rooms were created
      const roomCount = await Room.countDocuments({ hotel: hotel._id });
      expect(roomCount).toBe(104); // 100 new + 4 original
    });

    test('should efficiently find available rooms with many bookings', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      const client = await createUserWithRole('CLIENT');

      // Create many bookings
      const bookingPromises = [];
      for (let i = 0; i < 50; i++) {
        const booking = new Booking({
          user: client._id,
          hotel: hotel._id,
          rooms: [{
            room: rooms[i % 4]._id,
            pricePerNight: 120,
            guests: [{ firstName: `Guest${i}`, lastName: 'Test', isMainGuest: true }]
          }],
          checkIn: futureDate(i % 30 + 1),
          checkOut: futureDate(i % 30 + 3),
          totalGuests: { adults: 1, children: 0 },
          source: 'WEB',
          status: 'CONFIRMED',
          pricing: { subtotal: 240, taxes: 24, totalPrice: 264 }
        });
        bookingPromises.push(booking.save());
      }

      await Promise.all(bookingPromises);

      const startTime = Date.now();
      
      const availableRooms = await Room.findAvailableRooms(
        hotel._id,
        futureDate(15),
        futureDate(17)
      );
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete quickly even with many bookings
      expect(duration).toBeLessThan(1000);
      expect(Array.isArray(availableRooms)).toBe(true);
    });
  });
});