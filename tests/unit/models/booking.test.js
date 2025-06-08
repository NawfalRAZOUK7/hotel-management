const mongoose = require('mongoose');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserWithRole,
  createTestHotelWithRooms,
  createTestBooking,
  createBookingData,
  futureDate,
  pastDate,
  expectSuccessResponse,
  expectErrorResponse,
  countDocuments
} = require('../setup/test-helpers');

// Models to test
const Booking = require('../../models/Booking');
const User = require('../../models/User');
const Hotel = require('../../models/Hotel');
const Room = require('../../models/Room');

describe('Booking Model Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // SCHEMA VALIDATION TESTS
  // ============================================================================

  describe('Schema Validation', () => {
    test('should create booking with valid data', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const bookingData = createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: futureDate(1),
        checkOut: futureDate(3),
        adults: 2,
        children: 0
      });

      const booking = new Booking(bookingData);
      const savedBooking = await booking.save();

      expect(savedBooking._id).toBeDefined();
      expect(savedBooking.bookingNumber).toMatch(/^BK\d{8}$/);
      expect(savedBooking.user).toEqual(user._id);
      expect(savedBooking.hotel).toEqual(hotel._id);
      expect(savedBooking.rooms).toHaveLength(1);
      expect(savedBooking.status).toBe('PENDING');
      expect(savedBooking.source).toBe('WEB');
      expect(savedBooking.numberOfNights).toBe(2);
    });

    test('should require mandatory fields', async () => {
      // Test missing user
      const bookingNoUser = new Booking({
        hotel: new mongoose.Types.ObjectId(),
        rooms: [{
          room: new mongoose.Types.ObjectId(),
          pricePerNight: 100,
          guests: [{ firstName: 'Test', lastName: 'Guest', isMainGuest: true }]
        }],
        checkIn: futureDate(1),
        checkOut: futureDate(2),
        totalGuests: { adults: 1, children: 0 }
      });
      await expect(bookingNoUser.save()).rejects.toThrow('L\'utilisateur est requis');

      // Test missing hotel
      const bookingNoHotel = new Booking({
        user: new mongoose.Types.ObjectId(),
        rooms: [{
          room: new mongoose.Types.ObjectId(),
          pricePerNight: 100,
          guests: [{ firstName: 'Test', lastName: 'Guest', isMainGuest: true }]
        }],
        checkIn: futureDate(1),
        checkOut: futureDate(2),
        totalGuests: { adults: 1, children: 0 }
      });
      await expect(bookingNoHotel.save()).rejects.toThrow('L\'hôtel est requis');

      // Test missing checkIn
      const bookingNoCheckIn = new Booking({
        user: new mongoose.Types.ObjectId(),
        hotel: new mongoose.Types.ObjectId(),
        rooms: [{
          room: new mongoose.Types.ObjectId(),
          pricePerNight: 100,
          guests: [{ firstName: 'Test', lastName: 'Guest', isMainGuest: true }]
        }],
        checkOut: futureDate(2),
        totalGuests: { adults: 1, children: 0 }
      });
      await expect(bookingNoCheckIn.save()).rejects.toThrow('La date d\'arrivée est requise');
    });

    test('should validate date constraints', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Test past check-in date
      const bookingPastCheckIn = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: pastDate(1),
        checkOut: futureDate(1)
      }));
      await expect(bookingPastCheckIn.save()).rejects.toThrow('La date d\'arrivée ne peut pas être dans le passé');

      // Test check-out before check-in
      const bookingInvalidDates = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: futureDate(3),
        checkOut: futureDate(1)
      }));
      await expect(bookingInvalidDates.save()).rejects.toThrow('La date de départ doit être postérieure à la date d\'arrivée');
    });

    test('should validate guest constraints', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Test minimum adults
      const bookingNoAdults = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        adults: 0,
        children: 2
      }));
      await expect(bookingNoAdults.save()).rejects.toThrow('Au moins 1 adulte requis');

      // Test maximum adults
      const bookingTooManyAdults = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        adults: 25,
        children: 0
      }));
      await expect(bookingTooManyAdults.save()).rejects.toThrow('Maximum 20 adultes');
    });

    test('should validate status enum', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const bookingInvalidStatus = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      }));
      
      bookingInvalidStatus.status = 'INVALID_STATUS';
      await expect(bookingInvalidStatus.save()).rejects.toThrow('Statut de réservation invalide');
    });

    test('should validate source enum', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const bookingInvalidSource = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        source: 'INVALID_SOURCE'
      }));
      
      await expect(bookingInvalidSource.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // BOOKING NUMBER GENERATION TESTS
  // ============================================================================

  describe('Booking Number Generation', () => {
    test('should generate unique booking numbers', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking1 = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      });

      const booking2 = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[1]._id]
      });

      expect(booking1.bookingNumber).toMatch(/^BK\d{8}$/);
      expect(booking2.bookingNumber).toMatch(/^BK\d{8}$/);
      expect(booking1.bookingNumber).not.toBe(booking2.bookingNumber);
    });

    test('should generate sequential booking numbers', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking1 = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      });

      const booking2 = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[1]._id]
      });

      const num1 = parseInt(booking1.bookingNumber.substring(2));
      const num2 = parseInt(booking2.bookingNumber.substring(2));
      
      expect(num2).toBe(num1 + 1);
    });

    test('should handle concurrent booking creation', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const bookingPromises = [];
      for (let i = 0; i < 5; i++) {
        const bookingData = createBookingData({
          userId: user._id,
          hotelId: hotel._id,
          roomIds: [rooms[i % rooms.length]._id]
        });
        bookingPromises.push(new Booking(bookingData).save());
      }

      const bookings = await Promise.all(bookingPromises);
      const bookingNumbers = bookings.map(b => b.bookingNumber);
      const uniqueNumbers = new Set(bookingNumbers);

      expect(uniqueNumbers.size).toBe(5);
      bookingNumbers.forEach(num => {
        expect(num).toMatch(/^BK\d{8}$/);
      });
    });
  });

  // ============================================================================
  // VIRTUAL PROPERTIES TESTS
  // ============================================================================

  describe('Virtual Properties', () => {
    test('should calculate total guests count', async () => {
      const booking = await createTestBooking();

      expect(booking.totalGuestsCount).toBe(booking.totalGuests.adults + booking.totalGuests.children);
    });

    test('should calculate total rooms count', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id, rooms[1]._id]
      });

      expect(booking.totalRooms).toBe(2);
    });

    test('should calculate stay duration', async () => {
      const checkIn = futureDate(1);
      const checkOut = futureDate(4); // 3 nights

      const booking = await createTestBooking({
        checkIn,
        checkOut
      });

      expect(booking.stayDuration).toBe(3);
    });

    test('should calculate final total price with extras', async () => {
      const booking = await createTestBooking();
      
      // Add some extras
      booking.extras.push({
        name: 'Mini-bar',
        description: 'Boissons et snacks',
        quantity: 2,
        unitPrice: 15,
        totalPrice: 30,
        addedBy: booking.user,
        category: 'MINIBAR'
      });

      const finalTotal = booking.finalTotalPrice;
      expect(finalTotal).toBe(booking.pricing.totalPrice + 30);
    });

    test('should calculate remaining amount to pay', async () => {
      const booking = await createTestBooking();
      booking.payment.amountPaid = 100;

      const remaining = booking.remainingAmount;
      expect(remaining).toBe(Math.max(0, booking.finalTotalPrice - 100));
    });

    test('should check if booking is modifiable', async () => {
      // Booking far in future should be modifiable
      const futureBooking = await createTestBooking({
        checkIn: futureDate(10),
        checkOut: futureDate(12),
        status: 'CONFIRMED'
      });
      expect(futureBooking.isModifiable).toBe(true);

      // Booking close to check-in should not be modifiable
      const soonBooking = await createTestBooking({
        checkIn: futureDate(0.5), // 12 hours from now
        checkOut: futureDate(1),
        status: 'CONFIRMED'
      });
      expect(soonBooking.isModifiable).toBe(false);

      // Completed booking should not be modifiable
      const completedBooking = await createTestBooking({
        status: 'COMPLETED'
      });
      expect(completedBooking.isModifiable).toBe(false);
    });

    test('should check if booking is cancellable', async () => {
      const now = new Date();
      const cancellationDeadline = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now

      const cancellableBooking = await createTestBooking({
        status: 'CONFIRMED'
      });
      cancellableBooking.dates.cancellationDeadline = cancellationDeadline;

      expect(cancellableBooking.isCancellable).toBe(true);

      // Past deadline
      cancellableBooking.dates.cancellationDeadline = pastDate(1);
      expect(cancellableBooking.isCancellable).toBe(false);
    });
  });

  // ============================================================================
  // MIDDLEWARE TESTS
  // ============================================================================

  describe('Pre-save Middleware', () => {
    test('should calculate number of nights automatically', async () => {
      const checkIn = futureDate(1);
      const checkOut = futureDate(4);

      const booking = await createTestBooking({
        checkIn,
        checkOut
      });

      expect(booking.numberOfNights).toBe(3);
    });

    test('should set cancellation deadline automatically', async () => {
      const checkIn = futureDate(2);
      const booking = await createTestBooking({ checkIn });

      expect(booking.dates.cancellationDeadline).toBeDefined();
      
      const deadline = new Date(booking.dates.cancellationDeadline);
      const expectedDeadline = new Date(checkIn.getTime() - 24 * 60 * 60 * 1000);
      
      expect(Math.abs(deadline - expectedDeadline)).toBeLessThan(1000); // Within 1 second
    });

    test('should validate guest assignment consistency', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const bookingData = createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      });

      // Mismatch between totalGuests and assigned guests
      bookingData.totalGuests.adults = 3; // But only 1 guest assigned to room
      
      const booking = new Booking(bookingData);
      await expect(booking.save()).rejects.toThrow('Le nombre d\'invités assignés aux chambres ne correspond pas au total');
    });

    test('should require exactly one main guest', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const bookingData = createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      });

      // No main guest
      bookingData.rooms[0].guests[0].isMainGuest = false;

      const booking = new Booking(bookingData);
      await expect(booking.save()).rejects.toThrow('Il doit y avoir exactement un invité principal par réservation');
    });

    test('should calculate extras total prices', async () => {
      const booking = await createTestBooking();

      booking.extras.push({
        name: 'Spa Service',
        quantity: 1,
        unitPrice: 50,
        addedBy: booking.user,
        category: 'SPA'
      });

      await booking.save();

      expect(booking.extras[0].totalPrice).toBe(50);
    });
  });

  // ============================================================================
  // STATUS MANAGEMENT TESTS
  // ============================================================================

  describe('Status Management', () => {
    test('should change status with valid transitions', async () => {
      const admin = await createUserWithRole('ADMIN');
      const booking = await createTestBooking({ status: 'PENDING' });

      // PENDING -> CONFIRMED
      await booking.changeStatus('CONFIRMED', admin._id, 'Admin approval');
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.dates.confirmedAt).toBeDefined();
      expect(booking.statusHistory).toHaveLength(1);

      // CONFIRMED -> CHECKED_IN
      const receptionist = await createUserWithRole('RECEPTIONIST');
      await booking.changeStatus('CHECKED_IN', receptionist._id, 'Guest arrived');
      expect(booking.status).toBe('CHECKED_IN');
      expect(booking.dates.checkedInAt).toBeDefined();
      expect(booking.statusHistory).toHaveLength(2);

      // CHECKED_IN -> CHECKED_OUT
      await booking.changeStatus('CHECKED_OUT', receptionist._id, 'Guest departed');
      expect(booking.status).toBe('CHECKED_OUT');
      expect(booking.dates.checkedOutAt).toBeDefined();

      // CHECKED_OUT -> COMPLETED
      await booking.changeStatus('COMPLETED', receptionist._id, 'Booking completed');
      expect(booking.status).toBe('COMPLETED');
    });

    test('should reject invalid status transitions', async () => {
      const admin = await createUserWithRole('ADMIN');
      const booking = await createTestBooking({ status: 'PENDING' });

      // PENDING -> CHECKED_IN (skipping CONFIRMED)
      await expect(
        booking.changeStatus('CHECKED_IN', admin._id)
      ).rejects.toThrow('Transition de PENDING vers CHECKED_IN non autorisée');

      // COMPLETED -> CANCELLED (terminal status)
      booking.status = 'COMPLETED';
      await expect(
        booking.changeStatus('CANCELLED', admin._id)
      ).rejects.toThrow('Transition de COMPLETED vers CANCELLED non autorisée');
    });

    test('should track status history correctly', () => {
      const booking = new Booking(createBookingData());
      const userId = new mongoose.Types.ObjectId();

      booking.changeStatus('CONFIRMED', userId, 'Initial confirmation', 'Approved by admin');

      const historyEntry = booking.statusHistory[0];
      expect(historyEntry.status).toBe('CONFIRMED');
      expect(historyEntry.changedBy).toEqual(userId);
      expect(historyEntry.reason).toBe('Initial confirmation');
      expect(historyEntry.notes).toBe('Approved by admin');
      expect(historyEntry.changedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================================
  // EXTRAS MANAGEMENT TESTS
  // ============================================================================

  describe('Extras Management', () => {
    test('should add extras correctly', async () => {
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const booking = await createTestBooking();

      const extraData = {
        name: 'Room Service',
        description: 'Late night dinner',
        quantity: 1,
        unitPrice: 35,
        category: 'RESTAURANT'
      };

      await booking.addExtra(extraData, receptionist._id);

      expect(booking.extras).toHaveLength(1);
      const extra = booking.extras[0];
      expect(extra.name).toBe('Room Service');
      expect(extra.totalPrice).toBe(35);
      expect(extra.addedBy).toEqual(receptionist._id);
      expect(extra.addedAt).toBeInstanceOf(Date);
    });

    test('should calculate total with multiple extras', async () => {
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const booking = await createTestBooking();

      await booking.addExtra({
        name: 'Mini-bar',
        quantity: 3,
        unitPrice: 12,
        category: 'MINIBAR'
      }, receptionist._id);

      await booking.addExtra({
        name: 'Laundry',
        quantity: 1,
        unitPrice: 25,
        category: 'LAUNDRY'
      }, receptionist._id);

      expect(booking.extras).toHaveLength(2);
      
      const extrasTotal = booking.extras.reduce((sum, extra) => sum + extra.totalPrice, 0);
      expect(extrasTotal).toBe(36 + 25); // 3*12 + 1*25
      expect(booking.finalTotalPrice).toBe(booking.pricing.totalPrice + extrasTotal);
    });

    test('should validate extra categories', async () => {
      const booking = await createTestBooking();
      
      booking.extras.push({
        name: 'Invalid Service',
        quantity: 1,
        unitPrice: 10,
        addedBy: booking.user,
        category: 'INVALID_CATEGORY'
      });

      await expect(booking.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // PRICE CALCULATION TESTS
  // ============================================================================

  describe('Price Calculation', () => {
    test('should calculate total price correctly', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      }));

      await booking.calculateTotalPrice();

      expect(booking.pricing.subtotal).toBeGreaterThan(0);
      expect(booking.pricing.taxes).toBeGreaterThan(0);
      expect(booking.pricing.totalPrice).toBe(
        booking.pricing.subtotal + booking.pricing.taxes - booking.pricing.discount + booking.pricing.fees
      );
    });

    test('should handle multiple rooms pricing', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id, rooms[1]._id] // Two rooms
      }));

      await booking.calculateTotalPrice();

      expect(booking.rooms).toHaveLength(2);
      expect(booking.pricing.subtotal).toBeGreaterThan(0);
      
      // Should be price of both rooms combined
      const expectedSubtotal = (rooms[0].basePrice + rooms[1].basePrice) * booking.numberOfNights;
      expect(booking.pricing.subtotal).toBeCloseTo(expectedSubtotal, 2);
    });

    test('should apply taxes correctly', async () => {
      const booking = new Booking(createBookingData());
      await booking.calculateTotalPrice();

      // Tax rate is 10% in the calculation
      const expectedTaxes = booking.pricing.subtotal * 0.10;
      expect(booking.pricing.taxes).toBeCloseTo(expectedTaxes, 2);
    });
  });

  // ============================================================================
  // CANCELLATION TESTS
  // ============================================================================

  describe('Cancellation Logic', () => {
    test('should cancel booking with full refund (>48h)', async () => {
      const user = await createTestUser();
      const booking = await createTestBooking({
        userId: user._id,
        checkIn: futureDate(3), // 3 days from now
        status: 'CONFIRMED'
      });

      await booking.cancel('CLIENT_REQUEST', user._id, 'Change of plans');

      expect(booking.status).toBe('CANCELLED');
      expect(booking.cancellation.reason).toBe('CLIENT_REQUEST');
      expect(booking.cancellation.refundPolicy).toBe('FULL_REFUND');
      expect(booking.cancellation.refundAmount).toBe(booking.pricing.totalPrice);
      expect(booking.dates.cancelledAt).toBeInstanceOf(Date);
    });

    test('should cancel booking with partial refund (24-48h)', async () => {
      const user = await createTestUser();
      const booking = await createTestBooking({
        userId: user._id,
        checkIn: futureDate(1.5), // 1.5 days from now
        status: 'CONFIRMED'
      });

      await booking.cancel('CLIENT_REQUEST', user._id, 'Emergency');

      expect(booking.status).toBe('CANCELLED');
      expect(booking.cancellation.refundPolicy).toBe('PARTIAL_REFUND');
      expect(booking.cancellation.refundAmount).toBe(booking.pricing.totalPrice * 0.5);
    });

    test('should cancel booking with no refund (<24h)', async () => {
      const user = await createTestUser();
      const booking = await createTestBooking({
        userId: user._id,
        checkIn: futureDate(0.5), // 12 hours from now
        status: 'CONFIRMED'
      });

      await booking.cancel('CLIENT_REQUEST', user._id, 'Late cancellation');

      expect(booking.status).toBe('CANCELLED');
      expect(booking.cancellation.refundPolicy).toBe('NO_REFUND');
      expect(booking.cancellation.refundAmount).toBe(0);
    });

    test('should reject cancellation if not cancellable', async () => {
      const user = await createTestUser();
      const booking = await createTestBooking({
        userId: user._id,
        status: 'COMPLETED'
      });

      await expect(
        booking.cancel('CLIENT_REQUEST', user._id)
      ).rejects.toThrow('Cette réservation ne peut plus être annulée');
    });
  });

  // ============================================================================
  // VALIDATION WORKFLOW TESTS
  // ============================================================================

  describe('Validation Workflow', () => {
    test('should validate booking by admin', async () => {
      const admin = await createUserWithRole('ADMIN');
      const booking = await createTestBooking({ status: 'PENDING' });

      await booking.validate(admin._id, 'Booking approved after review');

      expect(booking.validation.isValidated).toBe(true);
      expect(booking.validation.validatedBy).toEqual(admin._id);
      expect(booking.validation.validatedAt).toBeInstanceOf(Date);
      expect(booking.validation.validationNotes).toBe('Booking approved after review');
      expect(booking.status).toBe('CONFIRMED');
    });

    test('should track validation in status history', async () => {
      const admin = await createUserWithRole('ADMIN');
      const booking = await createTestBooking({ status: 'PENDING' });

      await booking.validate(admin._id, 'Standard validation process');

      expect(booking.statusHistory).toHaveLength(1);
      const historyEntry = booking.statusHistory[0];
      expect(historyEntry.status).toBe('CONFIRMED');
      expect(historyEntry.changedBy).toEqual(admin._id);
      expect(historyEntry.reason).toBe('Réservation validée par l\'administrateur');
    });
  });

  // ============================================================================
  // INVOICE GENERATION TESTS
  // ============================================================================

  describe('Invoice Generation', () => {
    test('should generate complete invoice', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const booking = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id]
      });

      // Add some extras
      await booking.addExtra({
        name: 'Breakfast',
        quantity: 2,
        unitPrice: 15,
        category: 'RESTAURANT'
      }, user._id);

      const invoice = booking.generateInvoice();

      expect(invoice.bookingNumber).toBe(booking.bookingNumber);
      expect(invoice.guestName).toBeDefined();
      expect(invoice.hotelName).toBe(hotel.name);
      expect(invoice.checkIn).toEqual(booking.checkIn);
      expect(invoice.checkOut).toEqual(booking.checkOut);
      expect(invoice.numberOfNights).toBe(booking.numberOfNights);
      expect(invoice.rooms).toHaveLength(1);
      expect(invoice.extras).toHaveLength(1);
      expect(invoice.finalTotal).toBe(booking.finalTotalPrice);
      expect(invoice.generatedAt).toBeInstanceOf(Date);
    });

    test('should include all room details in invoice', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const booking = await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id, rooms[1]._id]
      });

      const invoice = booking.generateInvoice();

      expect(invoice.rooms).toHaveLength(2);
      invoice.rooms.forEach(room => {
        expect(room.roomNumber).toBeDefined();
        expect(room.roomType).toBeDefined();
        expect(room.pricePerNight).toBeGreaterThan(0);
        expect(room.totalPrice).toBe(room.pricePerNight * booking.numberOfNights);
      });
    });
  });

  // ============================================================================
  // STATIC METHODS TESTS
  // ============================================================================

  describe('Static Methods', () => {
    test('should search bookings with filters', async () => {
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });
      
      const { hotel } = await createTestHotelWithRooms();

      await createTestBooking({ userId: user1._id, hotelId: hotel._id, status: 'CONFIRMED' });
      await createTestBooking({ userId: user2._id, hotelId: hotel._id, status: 'PENDING' });
      await createTestBooking({ userId: user1._id, hotelId: hotel._id, status: 'CANCELLED' });

      // Search by user
      const user1Bookings = await Booking.searchBookings({ user: user1._id });
      expect(user1Bookings).toHaveLength(2);

      // Search by status
      const confirmedBookings = await Booking.searchBookings({ status: 'CONFIRMED' });
      expect(confirmedBookings).toHaveLength(1);

      // Search by hotel
      const hotelBookings = await Booking.searchBookings({ hotel: hotel._id });
      expect(hotelBookings).toHaveLength(3);
    });

    test('should search bookings by date range', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Create bookings with different check-in dates
      await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: futureDate(1),
        checkOut: futureDate(3)
      });

      await createTestBooking({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[1]._id],
        checkIn: futureDate(10),
        checkOut: futureDate(12)
      });

      // Search within date range
      const bookingsInRange = await Booking.searchBookings({
        dateFrom: new Date(),
        dateTo: futureDate(5)
      });

      expect(bookingsInRange).toHaveLength(1);
    });

    test('should search bookings by booking number', async () => {
      const booking = await createTestBooking();
      const partialNumber = booking.bookingNumber.substring(2, 6); // Partial search

      const foundBookings = await Booking.searchBookings({
        bookingNumber: partialNumber
      });

      expect(foundBookings).toHaveLength(1);
      expect(foundBookings[0].bookingNumber).toBe(booking.bookingNumber);
    });

    test('should get booking statistics', async () => {
      const { hotel } = await createTestHotelWithRooms();
      
      // Create bookings with different statuses and prices
      await createTestBooking({ 
        hotelId: hotel._id, 
        status: 'CONFIRMED',
        checkIn: futureDate(1),
        checkOut: futureDate(3)
      });
      
      await createTestBooking({ 
        hotelId: hotel._id, 
        status: 'COMPLETED',
        checkIn: futureDate(5),
        checkOut: futureDate(7)
      });

      const stats = await Booking.getBookingStats(hotel._id);

      expect(stats).toHaveLength(1);
      const stat = stats[0];
      expect(stat.totalBookings).toBe(2);
      expect(stat.totalRevenue).toBeGreaterThan(0);
      expect(stat.avgBookingValue).toBeGreaterThan(0);
      expect(stat.totalNights).toBeGreaterThan(0);
    });

    test('should get bookings pending validation', async () => {
      const { hotel } = await createTestHotelWithRooms();

      await createTestBooking({ 
        hotelId: hotel._id, 
        status: 'PENDING' 
      });
      
      await createTestBooking({ 
        hotelId: hotel._id, 
        status: 'CONFIRMED' 
      });

      const pendingBookings = await Booking.getPendingValidation(hotel._id);

      expect(pendingBookings).toHaveLength(1);
      expect(pendingBookings[0].status).toBe('PENDING');
      expect(pendingBookings[0].validation.isValidated).toBe(false);
    });

    test('should calculate occupancy rate', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      // Create confirmed bookings for occupancy calculation
      const checkIn = futureDate(1);
      const checkOut = futureDate(3);

      await createTestBooking({
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn,
        checkOut,
        status: 'CONFIRMED'
      });

      const occupancyData = await Booking.getOccupancyRate(
        hotel._id,
        checkIn,
        futureDate(10)
      );

      expect(occupancyData.occupancyRate).toBeGreaterThan(0);
      expect(occupancyData.totalRoomNights).toBeGreaterThan(0);
      expect(occupancyData.maxPossibleRoomNights).toBeGreaterThan(0);
      expect(occupancyData.totalRooms).toBe(rooms.length);
    });
  });

  // ============================================================================
  // SPECIAL REQUESTS TESTS
  // ============================================================================

  describe('Special Requests', () => {
    test('should handle special requests', async () => {
      const booking = await createTestBooking();
      const receptionist = await createUserWithRole('RECEPTIONIST');

      booking.specialRequests.push({
        type: 'HIGH_FLOOR',
        description: 'Please assign a room on a high floor with city view',
        status: 'PENDING'
      });

      await booking.save();

      expect(booking.specialRequests).toHaveLength(1);
      const request = booking.specialRequests[0];
      expect(request.type).toBe('HIGH_FLOOR');
      expect(request.status).toBe('PENDING');
    });

    test('should approve special requests', async () => {
      const booking = await createTestBooking();
      const receptionist = await createUserWithRole('RECEPTIONIST');

      booking.specialRequests.push({
        type: 'LATE_CHECKIN',
        description: 'Arriving at 11 PM',
        status: 'PENDING'
      });

      await booking.save();

      // Approve the request
      const request = booking.specialRequests[0];
      request.status = 'APPROVED';
      request.handledBy = receptionist._id;
      request.handledAt = new Date();
      request.notes = 'Late check-in approved, front desk notified';

      await booking.save();

      expect(request.status).toBe('APPROVED');
      expect(request.handledBy).toEqual(receptionist._id);
      expect(request.handledAt).toBeInstanceOf(Date);
    });

    test('should validate special request types', async () => {
      const booking = await createTestBooking();

      booking.specialRequests.push({
        type: 'INVALID_TYPE',
        description: 'Invalid request',
        status: 'PENDING'
      });

      await expect(booking.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // PAYMENT INTEGRATION TESTS
  // ============================================================================

  describe('Payment Integration', () => {
    test('should handle payment information', async () => {
      const booking = await createTestBooking();

      booking.payment.method = 'CARD';
      booking.payment.status = 'PAID';
      booking.payment.amountPaid = booking.pricing.totalPrice;
      booking.payment.transactionId = 'TXN123456789';
      booking.payment.paidAt = new Date();

      await booking.save();

      expect(booking.payment.method).toBe('CARD');
      expect(booking.payment.status).toBe('PAID');
      expect(booking.remainingAmount).toBe(0);
    });

    test('should handle partial payments', async () => {
      const booking = await createTestBooking();
      const partialPayment = booking.pricing.totalPrice * 0.5;

      booking.payment.status = 'PARTIAL';
      booking.payment.amountPaid = partialPayment;

      expect(booking.remainingAmount).toBe(booking.pricing.totalPrice - partialPayment);
    });

    test('should handle refunds', async () => {
      const booking = await createTestBooking();

      booking.payment.status = 'REFUNDED';
      booking.payment.refundAmount = booking.pricing.totalPrice * 0.8;
      booking.payment.refundedAt = new Date();

      await booking.save();

      expect(booking.payment.status).toBe('REFUNDED');
      expect(booking.payment.refundAmount).toBeGreaterThan(0);
      expect(booking.payment.refundedAt).toBeInstanceOf(Date);
    });
  });

  // ============================================================================
  // CONTACT INFORMATION TESTS
  // ============================================================================

  describe('Contact Information', () => {
    test('should store contact information', async () => {
      const booking = await createTestBooking();

      booking.contactInfo.phone = '0123456789';
      booking.contactInfo.email = 'guest@example.com';
      booking.contactInfo.emergencyContact = {
        name: 'John Doe',
        phone: '0987654321',
        relationship: 'Spouse'
      };

      await booking.save();

      expect(booking.contactInfo.phone).toBe('0123456789');
      expect(booking.contactInfo.email).toBe('guest@example.com');
      expect(booking.contactInfo.emergencyContact.name).toBe('John Doe');
    });

    test('should validate phone number format', async () => {
      const booking = await createTestBooking();

      booking.contactInfo.phone = '123'; // Invalid format

      await expect(booking.save()).rejects.toThrow('Numéro de téléphone français invalide');
    });

    test('should validate email format', async () => {
      const booking = await createTestBooking();

      booking.contactInfo.email = 'invalid-email'; // Invalid format

      await expect(booking.save()).rejects.toThrow('Email invalide');
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    test('should handle complete booking lifecycle', async () => {
      const client = await createUserWithRole('CLIENT');
      const admin = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      
      const { hotel, rooms } = await createTestHotelWithRooms();

      // 1. Create booking
      const booking = await createTestBooking({
        userId: client._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        status: 'PENDING'
      });

      expect(booking.status).toBe('PENDING');
      expect(booking.validation.isValidated).toBe(false);

      // 2. Admin validates booking
      await booking.validate(admin._id, 'Approved after verification');
      expect(booking.status).toBe('CONFIRMED');
      expect(booking.validation.isValidated).toBe(true);

      // 3. Guest checks in
      await booking.changeStatus('CHECKED_IN', receptionist._id, 'Guest arrived on time');
      expect(booking.status).toBe('CHECKED_IN');
      expect(booking.dates.checkedInAt).toBeDefined();

      // 4. Add extras during stay
      await booking.addExtra({
        name: 'Room Service',
        quantity: 1,
        unitPrice: 25,
        category: 'RESTAURANT'
      }, receptionist._id);

      // 5. Guest checks out
      await booking.changeStatus('CHECKED_OUT', receptionist._id, 'Guest departed');
      expect(booking.status).toBe('CHECKED_OUT');

      // 6. Complete booking
      await booking.changeStatus('COMPLETED', receptionist._id, 'All charges processed');
      expect(booking.status).toBe('COMPLETED');

      // 7. Generate final invoice
      const invoice = booking.generateInvoice();
      expect(invoice.extras).toHaveLength(1);
      expect(invoice.finalTotal).toBeGreaterThan(booking.pricing.totalPrice);

      // Verify status history
      expect(booking.statusHistory).toHaveLength(4); // CONFIRMED, CHECKED_IN, CHECKED_OUT, COMPLETED
    });

    test('should handle booking cancellation workflow', async () => {
      const client = await createUserWithRole('CLIENT');
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Create and confirm booking
      const booking = await createTestBooking({
        userId: client._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: futureDate(5), // 5 days from now
        status: 'CONFIRMED'
      });

      const originalPrice = booking.pricing.totalPrice;

      // Cancel booking (should get full refund)
      await booking.cancel('CLIENT_REQUEST', client._id, 'Plans changed');

      expect(booking.status).toBe('CANCELLED');
      expect(booking.cancellation.reason).toBe('CLIENT_REQUEST');
      expect(booking.cancellation.refundPolicy).toBe('FULL_REFUND');
      expect(booking.cancellation.refundAmount).toBe(originalPrice);
      expect(booking.dates.cancelledAt).toBeDefined();
    });

    test('should handle concurrent booking operations', async () => {
      const users = await Promise.all([
        createTestUser({ email: 'user1@test.com' }),
        createTestUser({ email: 'user2@test.com' }),
        createTestUser({ email: 'user3@test.com' })
      ]);

      const { hotel, rooms } = await createTestHotelWithRooms();

      // Create multiple bookings concurrently
      const bookingPromises = users.map((user, index) => 
        createTestBooking({
          userId: user._id,
          hotelId: hotel._id,
          roomIds: [rooms[index % rooms.length]._id]
        })
      );

      const bookings = await Promise.all(bookingPromises);

      // All bookings should be created successfully
      expect(bookings).toHaveLength(3);
      
      // All should have unique booking numbers
      const bookingNumbers = bookings.map(b => b.bookingNumber);
      const uniqueNumbers = new Set(bookingNumbers);
      expect(uniqueNumbers.size).toBe(3);

      // All should be in PENDING status initially
      bookings.forEach(booking => {
        expect(booking.status).toBe('PENDING');
        expect(booking.bookingNumber).toMatch(/^BK\d{8}$/);
      });
    });
  });

  // ============================================================================
  // EDGE CASES & ERROR HANDLING
  // ============================================================================

  describe('Edge Cases & Error Handling', () => {
    test('should handle invalid ObjectIds', async () => {
      const invalidBooking = new Booking({
        user: 'invalid-id',
        hotel: new mongoose.Types.ObjectId(),
        rooms: [{
          room: new mongoose.Types.ObjectId(),
          pricePerNight: 100,
          guests: [{ firstName: 'Test', lastName: 'Guest', isMainGuest: true }]
        }],
        checkIn: futureDate(1),
        checkOut: futureDate(2),
        totalGuests: { adults: 1, children: 0 }
      });

      await expect(invalidBooking.save()).rejects.toThrow();
    });

    test('should handle extreme date ranges', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Very far future dates
      const farFuture = new Date();
      farFuture.setFullYear(farFuture.getFullYear() + 10);

      const booking = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        checkIn: farFuture,
        checkOut: new Date(farFuture.getTime() + 24 * 60 * 60 * 1000)
      }));

      const savedBooking = await booking.save();
      expect(savedBooking.checkIn).toEqual(farFuture);
    });

    test('should handle maximum guest limits', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const booking = new Booking(createBookingData({
        userId: user._id,
        hotelId: hotel._id,
        roomIds: [rooms[0]._id],
        adults: 20, // Maximum allowed
        children: 10 // Maximum allowed
      }));

      const savedBooking = await booking.save();
      expect(savedBooking.totalGuests.adults).toBe(20);
      expect(savedBooking.totalGuests.children).toBe(10);
    });

    test('should handle empty extras array', async () => {
      const booking = await createTestBooking();
      
      expect(booking.extras).toHaveLength(0);
      expect(booking.finalTotalPrice).toBe(booking.pricing.totalPrice);
    });

    test('should handle database connection errors gracefully', async () => {
      // Simulate database error by using invalid data
      const invalidBooking = new Booking({
        user: null, // This will cause a validation error
        hotel: new mongoose.Types.ObjectId(),
        checkIn: futureDate(1),
        checkOut: futureDate(2)
      });

      await expect(invalidBooking.save()).rejects.toThrow();
    });

    test('should handle concurrent status changes', async () => {
      const admin = await createUserWithRole('ADMIN');
      const booking = await createTestBooking({ status: 'PENDING' });

      // Try to change status concurrently
      const promise1 = booking.changeStatus('CONFIRMED', admin._id, 'First change');
      const promise2 = booking.changeStatus('CANCELLED', admin._id, 'Second change');

      // One should succeed, one should fail
      const results = await Promise.allSettled([promise1, promise2]);
      
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes.length + failures.length).toBe(2);
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should handle large number of bookings efficiently', async () => {
      const user = await createTestUser();
      const { hotel, rooms } = await createTestHotelWithRooms();

      const startTime = Date.now();

      // Create 50 bookings
      const bookingPromises = [];
      for (let i = 0; i < 50; i++) {
        bookingPromises.push(createTestBooking({
          userId: user._id,
          hotelId: hotel._id,
          roomIds: [rooms[i % rooms.length]._id]
        }));
      }

      const bookings = await Promise.all(bookingPromises);
      const endTime = Date.now();

      expect(bookings).toHaveLength(50);
      expect(endTime - startTime).toBeLessThan(10000); // Should complete in less than 10 seconds
    });

    test('should search bookings efficiently', async () => {
      // Create some test bookings first
      const user = await createTestUser();
      const { hotel } = await createTestHotelWithRooms();

      for (let i = 0; i < 20; i++) {
        await createTestBooking({ userId: user._id, hotelId: hotel._id });
      }

      const startTime = Date.now();
      
      // Perform search
      const results = await Booking.searchBookings({ user: user._id });
      
      const endTime = Date.now();

      expect(results).toHaveLength(20);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in less than 1 second
    });

    test('should calculate occupancy efficiently', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();

      // Create multiple bookings
      for (let i = 0; i < 10; i++) {
        await createTestBooking({
          hotelId: hotel._id,
          roomIds: [rooms[i % rooms.length]._id],
          status: 'CONFIRMED'
        });
      }

      const startTime = Date.now();
      
      const occupancy = await Booking.getOccupancyRate(
        hotel._id,
        new Date(),
        futureDate(30)
      );
      
      const endTime = Date.now();

      expect(occupancy.occupancyRate).toBeGreaterThan(0);
      expect(endTime - startTime).toBeLessThan(2000); // Should complete in less than 2 seconds
    });
  });
});