const mongoose = require('mongoose');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserWithRole,
  createHotelData,
  createTestHotelWithRooms,
  expectErrorResponse,
  expectSuccessResponse,
  countDocuments,
  futureDate,
  pastDate
} = require('../setup/test-helpers');

// Models to test
const Hotel = require('../../models/Hotel');
const User = require('../../models/User');
const Room = require('../../models/Room');

describe('Hotel Model Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // SCHEMA VALIDATION TESTS
  // ============================================================================

  describe('Schema Validation', () => {
    test('should create hotel with valid data', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotelData = createHotelData({ managerId: manager._id });
      
      const hotel = new Hotel(hotelData);
      const savedHotel = await hotel.save();

      expect(savedHotel._id).toBeDefined();
      expect(savedHotel.code).toBe(hotelData.code.toUpperCase());
      expect(savedHotel.name).toBe(hotelData.name);
      expect(savedHotel.stars).toBe(hotelData.stars);
      expect(savedHotel.manager).toEqual(manager._id);
      expect(savedHotel.isActive).toBe(true);
      expect(savedHotel.isPublished).toBe(true);
      expect(savedHotel.createdAt).toBeDefined();
    });

    test('should require all mandatory fields', async () => {
      // Test missing code
      const hotelNoCode = new Hotel({
        name: 'Test Hotel',
        address: { street: '123 Test St', city: 'Paris', postalCode: '75001' },
        stars: 4,
        contact: { phone: '0140000000', email: 'test@hotel.com' }
      });
      await expect(hotelNoCode.save()).rejects.toThrow('Le code de l\'hôtel est requis');

      // Test missing name
      const hotelNoName = new Hotel({
        code: 'HTL001',
        address: { street: '123 Test St', city: 'Paris', postalCode: '75001' },
        stars: 4,
        contact: { phone: '0140000000', email: 'test@hotel.com' }
      });
      await expect(hotelNoName.save()).rejects.toThrow('Le nom de l\'hôtel est requis');

      // Test missing address components
      const hotelNoAddress = new Hotel({
        code: 'HTL002',
        name: 'Test Hotel',
        stars: 4,
        contact: { phone: '0140000000', email: 'test@hotel.com' }
      });
      await expect(hotelNoAddress.save()).rejects.toThrow('L\'adresse est requise');

      // Test missing stars
      const hotelNoStars = new Hotel({
        code: 'HTL003',
        name: 'Test Hotel',
        address: { street: '123 Test St', city: 'Paris', postalCode: '75001' },
        contact: { phone: '0140000000', email: 'test@hotel.com' }
      });
      await expect(hotelNoStars.save()).rejects.toThrow('La catégorie d\'étoiles est requise');
    });

    test('should validate field formats and constraints', async () => {
      const manager = await createUserWithRole('ADMIN');

      // Test invalid code format
      const hotelInvalidCode = new Hotel(createHotelData({
        code: 'htl-001-invalid',
        managerId: manager._id
      }));
      await expect(hotelInvalidCode.save()).rejects.toThrow('Le code ne peut contenir que des lettres majuscules et des chiffres');

      // Test code too short
      const hotelShortCode = new Hotel(createHotelData({
        code: 'HT',
        managerId: manager._id
      }));
      await expect(hotelShortCode.save()).rejects.toThrow('Le code doit contenir au moins 3 caractères');

      // Test invalid stars (too low)
      const hotelLowStars = new Hotel(createHotelData({
        stars: 0,
        managerId: manager._id
      }));
      await expect(hotelLowStars.save()).rejects.toThrow('Un hôtel doit avoir au minimum 1 étoile');

      // Test invalid stars (too high)
      const hotelHighStars = new Hotel(createHotelData({
        stars: 6,
        managerId: manager._id
      }));
      await expect(hotelHighStars.save()).rejects.toThrow('Un hôtel ne peut pas avoir plus de 5 étoiles');

      // Test invalid postal code
      const hotelInvalidPostal = new Hotel(createHotelData({
        managerId: manager._id
      }));
      hotelInvalidPostal.address.postalCode = '123';
      await expect(hotelInvalidPostal.save()).rejects.toThrow('Le code postal doit contenir 5 chiffres');
    });

    test('should enforce unique hotel code', async () => {
      const manager = await createUserWithRole('ADMIN');
      const code = 'HTL001';

      // Create first hotel
      const hotel1 = new Hotel(createHotelData({ code, managerId: manager._id }));
      await hotel1.save();

      // Try to create second hotel with same code
      const hotel2 = new Hotel(createHotelData({ code, managerId: manager._id, name: 'Different Hotel' }));
      await expect(hotel2.save()).rejects.toThrow();
    });

    test('should validate contact information', async () => {
      const manager = await createUserWithRole('ADMIN');

      // Test invalid phone format
      const hotelInvalidPhone = new Hotel(createHotelData({ managerId: manager._id }));
      hotelInvalidPhone.contact.phone = '123';
      await expect(hotelInvalidPhone.save()).rejects.toThrow('Numéro de téléphone français invalide');

      // Test invalid email format
      const hotelInvalidEmail = new Hotel(createHotelData({ managerId: manager._id }));
      hotelInvalidEmail.contact.email = 'invalid-email';
      await expect(hotelInvalidEmail.save()).rejects.toThrow('Email invalide');

      // Test invalid website URL
      const hotelInvalidWebsite = new Hotel(createHotelData({ managerId: manager._id }));
      hotelInvalidWebsite.contact.website = 'not-a-url';
      await expect(hotelInvalidWebsite.save()).rejects.toThrow('URL du site web invalide');
    });

    test('should validate coordinates ranges', async () => {
      const manager = await createUserWithRole('ADMIN');

      // Test invalid latitude (too high)
      const hotelInvalidLat = new Hotel(createHotelData({ managerId: manager._id }));
      hotelInvalidLat.address.coordinates = { latitude: 91, longitude: 2.3522 };
      await expect(hotelInvalidLat.save()).rejects.toThrow('La latitude doit être entre -90 et 90');

      // Test invalid longitude (too low)
      const hotelInvalidLng = new Hotel(createHotelData({ managerId: manager._id }));
      hotelInvalidLng.address.coordinates = { latitude: 48.8566, longitude: -181 };
      await expect(hotelInvalidLng.save()).rejects.toThrow('La longitude doit être entre -180 et 180');
    });
  });

  // ============================================================================
  // SEASONAL PRICING TESTS
  // ============================================================================

  describe('Seasonal Pricing', () => {
    test('should calculate correct price multiplier for dates', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      // Add seasonal pricing
      hotel.seasonalPricing = [
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
      ];
      
      await hotel.save();

      // Test high season multiplier
      const highSeasonDate = new Date('2025-07-15');
      const highSeasonMultiplier = hotel.getPriceMultiplier(highSeasonDate);
      expect(highSeasonMultiplier).toBe(1.5);

      // Test low season multiplier
      const lowSeasonDate = new Date('2025-12-15');
      const lowSeasonMultiplier = hotel.getPriceMultiplier(lowSeasonDate);
      expect(lowSeasonMultiplier).toBe(0.8);

      // Test normal season (no multiplier)
      const normalSeasonDate = new Date('2025-05-15');
      const normalMultiplier = hotel.getPriceMultiplier(normalSeasonDate);
      expect(normalMultiplier).toBe(1.0);
    });

    test('should handle cross-year seasonal pricing', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      // Winter season crossing year boundary
      hotel.seasonalPricing = [{
        name: 'BASSE_SAISON',
        startDate: new Date('2024-12-01'),
        endDate: new Date('2025-02-28'),
        multiplier: 0.7
      }];
      
      await hotel.save();

      // Test December date
      const decemberDate = new Date('2024-12-15');
      const decemberMultiplier = hotel.getPriceMultiplier(decemberDate);
      expect(decemberMultiplier).toBe(0.7);

      // Test January date
      const januaryDate = new Date('2025-01-15');
      const januaryMultiplier = hotel.getPriceMultiplier(januaryDate);
      expect(januaryMultiplier).toBe(0.7);

      // Test outside season
      const marchDate = new Date('2025-03-15');
      const marchMultiplier = hotel.getPriceMultiplier(marchDate);
      expect(marchMultiplier).toBe(1.0);
    });

    test('should validate seasonal pricing dates', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      // Invalid seasonal pricing (start after end)
      hotel.seasonalPricing = [{
        name: 'INVALID_SEASON',
        startDate: new Date('2025-08-31'),
        endDate: new Date('2025-07-01'),
        multiplier: 1.2
      }];

      await expect(hotel.save()).rejects.toThrow('La date de début de saison doit être antérieure à la date de fin');
    });

    test('should validate multiplier ranges', async () => {
      const manager = await createUserWithRole('ADMIN');

      // Test multiplier too low
      const hotelLowMultiplier = new Hotel(createHotelData({ managerId: manager._id }));
      hotelLowMultiplier.seasonalPricing = [{
        name: 'LOW_SEASON',
        startDate: new Date('2025-01-01'),
        endDate: new Date('2025-02-28'),
        multiplier: 0.3
      }];
      await expect(hotelLowMultiplier.save()).rejects.toThrow('Le multiplicateur ne peut pas être inférieur à 0.5');

      // Test multiplier too high
      const hotelHighMultiplier = new Hotel(createHotelData({ managerId: manager._id }));
      hotelHighMultiplier.seasonalPricing = [{
        name: 'HIGH_SEASON',
        startDate: new Date('2025-07-01'),
        endDate: new Date('2025-08-31'),
        multiplier: 3.5
      }];
      await expect(hotelHighMultiplier.save()).rejects.toThrow('Le multiplicateur ne peut pas être supérieur à 3.0');
    });
  });

  // ============================================================================
  // STAFF MANAGEMENT TESTS
  // ============================================================================

  describe('Staff Management', () => {
    test('should add staff member successfully', async () => {
      const manager = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      await hotel.addStaffMember(receptionist._id, 'RECEPTIONIST');

      const updatedHotel = await Hotel.findById(hotel._id);
      expect(updatedHotel.staff).toHaveLength(1);
      expect(updatedHotel.staff[0].user).toEqual(receptionist._id);
      expect(updatedHotel.staff[0].position).toBe('RECEPTIONIST');
      expect(updatedHotel.staff[0].startDate).toBeInstanceOf(Date);
    });

    test('should prevent duplicate staff members', async () => {
      const manager = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      // Add staff member first time
      await hotel.addStaffMember(receptionist._id, 'RECEPTIONIST');

      // Try to add same staff member again
      await expect(
        hotel.addStaffMember(receptionist._id, 'HOUSEKEEPING')
      ).rejects.toThrow('Cet utilisateur fait déjà partie du personnel');
    });

    test('should remove staff member successfully', async () => {
      const manager = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      // Add staff member
      await hotel.addStaffMember(receptionist._id, 'RECEPTIONIST');
      expect(hotel.staff).toHaveLength(1);

      // Remove staff member
      await hotel.removeStaffMember(receptionist._id);
      expect(hotel.staff).toHaveLength(0);
    });

    test('should validate staff positions', async () => {
      const manager = await createUserWithRole('ADMIN');
      const staff = await createUserWithRole('RECEPTIONIST');
      
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.staff = [{
        user: staff._id,
        position: 'INVALID_POSITION',
        startDate: new Date()
      }];

      await expect(hotel.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // VIRTUALS AND COMPUTED PROPERTIES TESTS
  // ============================================================================

  describe('Virtuals and Computed Properties', () => {
    test('should generate full address correctly', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.address = {
        street: '123 Rue de Rivoli',
        city: 'Paris',
        postalCode: '75001',
        country: 'France'
      };
      await hotel.save();

      expect(hotel.fullAddress).toBe('123 Rue de Rivoli, 75001 Paris, France');
    });

    test('should generate Google Maps URL with coordinates', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.address.coordinates = {
        latitude: 48.8566,
        longitude: 2.3522
      };
      await hotel.save();

      expect(hotel.googleMapsUrl).toBe('https://maps.google.com/?q=48.8566,2.3522');
    });

    test('should generate Google Maps URL with address fallback', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      // No coordinates set
      await hotel.save();

      expect(hotel.googleMapsUrl).toContain('https://maps.google.com/?q=');
      expect(hotel.googleMapsUrl).toContain(encodeURIComponent(hotel.fullAddress));
    });

    test('should identify primary image correctly', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.images = [
        { url: 'https://example.com/image1.jpg', alt: 'Image 1', isPrimary: false },
        { url: 'https://example.com/image2.jpg', alt: 'Image 2', isPrimary: true },
        { url: 'https://example.com/image3.jpg', alt: 'Image 3', isPrimary: false }
      ];
      await hotel.save();

      expect(hotel.primaryImage.url).toBe('https://example.com/image2.jpg');
      expect(hotel.primaryImage.isPrimary).toBe(true);
    });

    test('should use first image as primary when none marked', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.images = [
        { url: 'https://example.com/image1.jpg', alt: 'Image 1', isPrimary: false },
        { url: 'https://example.com/image2.jpg', alt: 'Image 2', isPrimary: false }
      ];
      await hotel.save();

      expect(hotel.primaryImage.url).toBe('https://example.com/image1.jpg');
    });
  });

  // ============================================================================
  // MIDDLEWARE TESTS
  // ============================================================================

  describe('Pre-save Middleware', () => {
    test('should ensure only one primary image', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.images = [
        { url: 'https://example.com/image1.jpg', alt: 'Image 1', isPrimary: true },
        { url: 'https://example.com/image2.jpg', alt: 'Image 2', isPrimary: true },
        { url: 'https://example.com/image3.jpg', alt: 'Image 3', isPrimary: true }
      ];
      
      await hotel.save();

      // Only first image should remain primary
      expect(hotel.images[0].isPrimary).toBe(true);
      expect(hotel.images[1].isPrimary).toBe(false);
      expect(hotel.images[2].isPrimary).toBe(false);
    });

    test('should set first image as primary when none marked', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.images = [
        { url: 'https://example.com/image1.jpg', alt: 'Image 1', isPrimary: false },
        { url: 'https://example.com/image2.jpg', alt: 'Image 2', isPrimary: false }
      ];
      
      await hotel.save();

      expect(hotel.images[0].isPrimary).toBe(true);
      expect(hotel.images[1].isPrimary).toBe(false);
    });

    test('should convert hotel code to uppercase', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ 
        code: 'htl001', 
        managerId: manager._id 
      }));
      
      await hotel.save();
      expect(hotel.code).toBe('HTL001');
    });
  });

  // ============================================================================
  // AVAILABILITY AND ROOM MANAGEMENT TESTS
  // ============================================================================

  describe('Availability and Room Management', () => {
    test('should check availability for specific dates', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const checkIn = futureDate(7);
      const checkOut = futureDate(10);
      
      const availableRooms = await hotel.checkAvailability(checkIn, checkOut);
      
      expect(availableRooms).toHaveLength(4); // All rooms should be available
      expect(availableRooms.every(room => room.status === 'AVAILABLE')).toBe(true);
    });

    test('should filter by room type in availability check', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const checkIn = futureDate(7);
      const checkOut = futureDate(10);
      
      const suiteRooms = await hotel.checkAvailability(checkIn, checkOut, 'Suite');
      
      expect(suiteRooms).toHaveLength(1);
      expect(suiteRooms[0].type).toBe('Suite');
    });

    test('should consider guest count in availability', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      const checkIn = futureDate(7);
      const checkOut = futureDate(10);
      const guestCount = 4; // Need room for 4 guests
      
      const availableRooms = await hotel.checkAvailability(checkIn, checkOut, null, guestCount);
      
      // Only Suite should accommodate 4 guests
      expect(availableRooms).toHaveLength(1);
      expect(availableRooms[0].type).toBe('Suite');
    });

    test('should update hotel statistics', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();
      
      await hotel.updateStats();
      
      const updatedHotel = await Hotel.findById(hotel._id);
      expect(updatedHotel.stats.totalRooms).toBe(4);
      expect(updatedHotel.stats.totalBookings).toBe(0); // No bookings yet
    });
  });

  // ============================================================================
  // STATIC METHODS TESTS
  // ============================================================================

  describe('Static Methods', () => {
    test('should search hotels with filters', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create hotels in different cities
      const parisHotel = new Hotel(createHotelData({ 
        city: 'Paris',
        stars: 4,
        managerId: manager._id 
      }));
      const lyonHotel = new Hotel(createHotelData({ 
        city: 'Lyon',
        stars: 3,
        managerId: manager._id 
      }));
      
      await Promise.all([parisHotel.save(), lyonHotel.save()]);

      // Search by city
      const parisResults = await Hotel.searchHotels({ city: 'Paris' });
      expect(parisResults).toHaveLength(1);
      expect(parisResults[0].address.city).toBe('Paris');

      // Search by minimum stars
      const luxuryResults = await Hotel.searchHotels({ stars: 4 });
      expect(luxuryResults).toHaveLength(1);
      expect(luxuryResults[0].stars).toBeGreaterThanOrEqual(4);
    });

    test('should search hotels with amenities filter', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      const hotelWithWifi = new Hotel(createHotelData({ managerId: manager._id }));
      hotelWithWifi.amenities = ['WiFi gratuit', 'Parking'];
      
      const hotelWithSpa = new Hotel(createHotelData({ managerId: manager._id }));
      hotelWithSpa.amenities = ['Spa', 'Piscine'];
      
      await Promise.all([hotelWithWifi.save(), hotelWithSpa.save()]);

      const wifiResults = await Hotel.searchHotels({ amenities: ['WiFi gratuit'] });
      expect(wifiResults).toHaveLength(1);
      expect(wifiResults[0].amenities).toContain('WiFi gratuit');
    });

    test('should get global statistics', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create multiple hotels
      const hotels = await Promise.all([
        new Hotel(createHotelData({ stars: 3, managerId: manager._id })).save(),
        new Hotel(createHotelData({ stars: 4, managerId: manager._id })).save(),
        new Hotel(createHotelData({ stars: 5, managerId: manager._id })).save()
      ]);

      const stats = await Hotel.getGlobalStats();
      
      expect(stats).toHaveLength(1);
      expect(stats[0].totalHotels).toBe(3);
      expect(stats[0].avgStars).toBeCloseTo(4, 1);
    });

    test('should get hotels by city statistics', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create hotels in different cities
      await Promise.all([
        new Hotel(createHotelData({ city: 'Paris', stars: 4, managerId: manager._id })).save(),
        new Hotel(createHotelData({ city: 'Paris', stars: 5, managerId: manager._id })).save(),
        new Hotel(createHotelData({ city: 'Lyon', stars: 3, managerId: manager._id })).save()
      ]);

      const cityStats = await Hotel.getHotelsByCity();
      
      expect(cityStats).toHaveLength(2);
      
      const parisStats = cityStats.find(stat => stat._id === 'Paris');
      expect(parisStats.count).toBe(2);
      expect(parisStats.avgStars).toBe(4.5);
      
      const lyonStats = cityStats.find(stat => stat._id === 'Lyon');
      expect(lyonStats.count).toBe(1);
      expect(lyonStats.avgStars).toBe(3);
    });
  });

  // ============================================================================
  // BUSINESS LOGIC TESTS
  // ============================================================================

  describe('Business Logic', () => {
    test('should handle hotel activation and deactivation', async () => {
      const { hotel } = await createTestHotelWithRooms();
      
      expect(hotel.isActive).toBe(true);
      
      // Deactivate hotel
      hotel.isActive = false;
      await hotel.save();
      
      // Should not appear in search results
      const searchResults = await Hotel.searchHotels({ city: hotel.address.city });
      expect(searchResults).toHaveLength(0);
    });

    test('should handle hotel publishing status', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.isPublished = false;
      await hotel.save();
      
      // Unpublished hotels should not appear in public search
      const searchResults = await Hotel.searchHotels({ city: hotel.address.city });
      expect(searchResults).toHaveLength(0);
    });

    test('should validate amenities enum values', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.amenities = ['WiFi gratuit', 'Invalid Amenity'];
      
      await expect(hotel.save()).rejects.toThrow();
    });

    test('should validate policy time formats', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      // Invalid check-in time format
      hotel.policies = {
        checkInTime: '25:00', // Invalid hour
        checkOutTime: '12:00'
      };
      
      await expect(hotel.save()).rejects.toThrow('Format d\'heure invalide');
    });

    test('should handle cancellation policies', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.policies = {
        checkInTime: '15:00',
        checkOutTime: '12:00',
        cancellationPolicy: 'STRICT',
        minimumAge: 21,
        petsAllowed: false
      };
      
      await hotel.save();
      
      expect(hotel.policies.cancellationPolicy).toBe('STRICT');
      expect(hotel.policies.minimumAge).toBe(21);
      expect(hotel.policies.petsAllowed).toBe(false);
    });
  });

  // ============================================================================
  // IMAGE MANAGEMENT TESTS
  // ============================================================================

  describe('Image Management', () => {
    test('should validate image URL formats', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.images = [{
        url: 'not-a-valid-image-url',
        alt: 'Invalid image'
      }];
      
      await expect(hotel.save()).rejects.toThrow('URL d\'image invalide');
    });

    test('should accept valid image URLs', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.images = [
        { url: 'https://example.com/image.jpg', alt: 'JPEG image' },
        { url: 'https://example.com/image.png', alt: 'PNG image' },
        { url: 'https://example.com/image.webp', alt: 'WebP image' }
      ];
      
      await hotel.save();
      expect(hotel.images).toHaveLength(3);
    });

    test('should set default alt text for images', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.images = [{
        url: 'https://example.com/image.jpg'
        // No alt text provided
      }];
      
      await hotel.save();
      expect(hotel.images[0].alt).toBe('Image de l\'hôtel');
    });
  });

  // ============================================================================
  // RELATIONSHIP TESTS
  // ============================================================================

  describe('Relationships', () => {
    test('should populate manager information', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      const populatedHotel = await Hotel.findById(hotel._id).populate('manager', 'firstName lastName email');
      
      expect(populatedHotel.manager.firstName).toBe(manager.firstName);
      expect(populatedHotel.manager.lastName).toBe(manager.lastName);
      expect(populatedHotel.manager.email).toBe(manager.email);
    });

    test('should populate staff information', async () => {
      const manager = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      await hotel.addStaffMember(receptionist._id, 'RECEPTIONIST');

      const populatedHotel = await Hotel.findById(hotel._id).populate('staff.user', 'firstName lastName');
      
      expect(populatedHotel.staff[0].user.firstName).toBe(receptionist.firstName);
      expect(populatedHotel.staff[0].user.lastName).toBe(receptionist.lastName);
    });

    test('should handle virtual rooms relationship', async () => {
      const { hotel, rooms } = await createTestHotelWithRooms();

      const hotelWithRooms = await Hotel.findById(hotel._id).populate('rooms');
      
      expect(hotelWithRooms.rooms).toHaveLength(4);
      expect(hotelWithRooms.rooms[0].hotel.toString()).toBe(hotel._id.toString());
    });

    test('should require valid manager reference', async () => {
      const invalidManagerId = new mongoose.Types.ObjectId();
      const hotel = new Hotel(createHotelData({ managerId: invalidManagerId }));
      
      await expect(hotel.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // SEARCH AND FILTERING TESTS
  // ============================================================================

  describe('Search and Filtering', () => {
    test('should search hotels by text (name, city, description)', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      const hotelPalace = new Hotel(createHotelData({ 
        name: 'Grand Palace Hotel',
        managerId: manager._id 
      }));
      hotelPalace.description = 'Luxury palace in the heart of Paris';
      
      const hotelBoutique = new Hotel(createHotelData({ 
        name: 'Boutique Hotel Modern',
        managerId: manager._id 
      }));
      hotelBoutique.description = 'Modern boutique experience';
      
      await Promise.all([hotelPalace.save(), hotelBoutique.save()]);

      // Search by name
      const palaceResults = await Hotel.find({ $text: { $search: 'Palace' } });
      expect(palaceResults).toHaveLength(1);
      expect(palaceResults[0].name).toContain('Palace');

      // Search by description
      const luxuryResults = await Hotel.find({ $text: { $search: 'luxury' } });
      expect(luxuryResults).toHaveLength(1);
      expect(luxuryResults[0].description).toContain('Luxury');
    });

    test('should filter by multiple criteria', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create hotels with different characteristics
      const hotels = await Promise.all([
        new Hotel(createHotelData({ 
          city: 'Paris', 
          stars: 5, 
          managerId: manager._id 
        })).save(),
        new Hotel(createHotelData({ 
          city: 'Paris', 
          stars: 3, 
          managerId: manager._id 
        })).save(),
        new Hotel(createHotelData({ 
          city: 'Lyon', 
          stars: 4, 
          managerId: manager._id 
        })).save()
      ]);

      // Add amenities
      hotels[0].amenities = ['WiFi gratuit', 'Spa'];
      hotels[1].amenities = ['WiFi gratuit'];
      hotels[2].amenities = ['Parking'];
      await Promise.all(hotels.map(h => h.save()));

      // Filter by city + stars + amenities
      const results = await Hotel.searchHotels({
        city: 'Paris',
        stars: 4,
        amenities: ['WiFi gratuit']
      });

      expect(results).toHaveLength(1);
      expect(results[0].address.city).toBe('Paris');
      expect(results[0].stars).toBeGreaterThanOrEqual(4);
      expect(results[0].amenities).toContain('WiFi gratuit');
    });

    test('should sort search results correctly', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      const hotels = await Promise.all([
        new Hotel(createHotelData({ 
          stars: 3, 
          managerId: manager._id 
        })).save(),
        new Hotel(createHotelData({ 
          stars: 5, 
          managerId: manager._id 
        })).save(),
        new Hotel(createHotelData({ 
          stars: 4, 
          managerId: manager._id 
        })).save()
      ]);

      // Set ratings
      hotels[0].stats.averageRating = 3.5;
      hotels[1].stats.averageRating = 4.8;
      hotels[2].stats.averageRating = 4.2;
      await Promise.all(hotels.map(h => h.save()));

      const results = await Hotel.searchHotels({});
      
      // Should be sorted by stars (descending) then by rating (descending)
      expect(results[0].stars).toBe(5);
      expect(results[1].stars).toBe(4);
      expect(results[2].stars).toBe(3);
    });
  });

  // ============================================================================
  // PERFORMANCE AND INDEXING TESTS
  // ============================================================================

  describe('Performance and Indexing', () => {
    test('should have proper indexes for search performance', async () => {
      const indexes = await Hotel.collection.getIndexes();
      
      // Check for required indexes
      expect(indexes).toHaveProperty('code_1');
      expect(indexes).toHaveProperty('address.city_1');
      expect(indexes).toHaveProperty('stars_1');
      expect(indexes).toHaveProperty('isActive_1_isPublished_1');
    });

    test('should handle large number of hotels efficiently', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create many hotels
      const hotelPromises = [];
      for (let i = 0; i < 100; i++) {
        const hotelData = createHotelData({ 
          code: `HTL${String(i).padStart(3, '0')}`,
          managerId: manager._id 
        });
        hotelPromises.push(new Hotel(hotelData).save());
      }
      
      const startTime = Date.now();
      await Promise.all(hotelPromises);
      const saveTime = Date.now() - startTime;
      
      // Should save 100 hotels in reasonable time (less than 5 seconds)
      expect(saveTime).toBeLessThan(5000);
      
      // Search should also be fast
      const searchStartTime = Date.now();
      const results = await Hotel.searchHotels({});
      const searchTime = Date.now() - searchStartTime;
      
      expect(results).toHaveLength(100);
      expect(searchTime).toBeLessThan(1000); // Less than 1 second
    });
  });

  // ============================================================================
  // ERROR HANDLING AND EDGE CASES
  // ============================================================================

  describe('Error Handling and Edge Cases', () => {
    test('should handle empty seasonal pricing gracefully', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.seasonalPricing = [];
      await hotel.save();

      const multiplier = hotel.getPriceMultiplier(new Date());
      expect(multiplier).toBe(1.0);
    });

    test('should handle null/undefined dates in price calculation', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();

      expect(() => hotel.getPriceMultiplier(null)).not.toThrow();
      expect(() => hotel.getPriceMultiplier(undefined)).not.toThrow();
    });

    test('should handle empty staff array', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.staff = [];
      await hotel.save();

      expect(hotel.staff).toHaveLength(0);
      expect(() => hotel.removeStaffMember(manager._id)).not.toThrow();
    });

    test('should handle missing images array', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      hotel.images = [];
      await hotel.save();

      expect(hotel.primaryImage).toBeNull();
    });

    test('should validate required manager field', async () => {
      const hotelWithoutManager = new Hotel(createHotelData({}));
      delete hotelWithoutManager.manager;
      
      await expect(hotelWithoutManager.save()).rejects.toThrow('Un responsable doit être assigné à l\'hôtel');
    });

    test('should handle concurrent hotel creation with same code', async () => {
      const manager = await createUserWithRole('ADMIN');
      const code = 'HTL999';
      
      const hotel1 = new Hotel(createHotelData({ code, managerId: manager._id }));
      const hotel2 = new Hotel(createHotelData({ code, managerId: manager._id }));
      
      // One should succeed, one should fail
      const results = await Promise.allSettled([
        hotel1.save(),
        hotel2.save()
      ]);
      
      const successes = results.filter(r => r.status === 'fulfilled');
      const failures = results.filter(r => r.status === 'rejected');
      
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
    });
  });

  // ============================================================================
  // INTEGRATION WITH OTHER MODELS
  // ============================================================================

  describe('Integration with Other Models', () => {
    test('should update stats when rooms are added', async () => {
      const { hotel } = await createTestHotelWithRooms();
      
      // Add an additional room
      const Room = require('../../models/Room');
      const newRoom = new Room({
        number: '501',
        floor: 5,
        type: 'Simple',
        hotel: hotel._id,
        basePrice: 90,
        status: 'AVAILABLE',
        isActive: true
      });
      await newRoom.save();
      
      // Update hotel stats
      await hotel.updateStats();
      
      const updatedHotel = await Hotel.findById(hotel._id);
      expect(updatedHotel.stats.totalRooms).toBe(5);
    });

    test('should handle deletion of referenced manager', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      await hotel.save();
      
      // Delete the manager
      await User.findByIdAndDelete(manager._id);
      
      // Hotel should still exist but with invalid reference
      const hotelAfterDeletion = await Hotel.findById(hotel._id);
      expect(hotelAfterDeletion).toBeTruthy();
      expect(hotelAfterDeletion.manager).toEqual(manager._id);
      
      // Populating should handle missing reference gracefully
      const populatedHotel = await Hotel.findById(hotel._id).populate('manager');
      expect(populatedHotel.manager).toBeNull();
    });
  });

  // ============================================================================
  // CUSTOM VALIDATION TESTS
  // ============================================================================

  describe('Custom Validation', () => {
    test('should accept valid amenity values only', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      // Valid amenities
      hotel.amenities = [
        'WiFi gratuit',
        'Parking',
        'Piscine',
        'Spa',
        'Restaurant',
        'Climatisation'
      ];
      
      await expect(hotel.save()).resolves.toBeTruthy();
    });

    test('should validate coordinates are numbers', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.address.coordinates = {
        latitude: 'not-a-number',
        longitude: 2.3522
      };
      
      await expect(hotel.save()).rejects.toThrow();
    });

    test('should validate star rating is integer', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.stars = 3.5; // Should be integer
      
      await expect(hotel.save()).rejects.toThrow('Le nombre d\'étoiles doit être un entier');
    });

    test('should validate description length', async () => {
      const manager = await createUserWithRole('ADMIN');
      const hotel = new Hotel(createHotelData({ managerId: manager._id }));
      
      hotel.description = 'A'.repeat(1001); // Exceeds 1000 character limit
      
      await expect(hotel.save()).rejects.toThrow('La description ne peut pas dépasser 1000 caractères');
    });
  });

  // ============================================================================
  // QUERY OPTIMIZATION TESTS
  // ============================================================================

  describe('Query Optimization', () => {
    test('should use efficient queries for common operations', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create test data
      await Promise.all([
        new Hotel(createHotelData({ city: 'Paris', managerId: manager._id })).save(),
        new Hotel(createHotelData({ city: 'Lyon', managerId: manager._id })).save(),
        new Hotel(createHotelData({ city: 'Marseille', managerId: manager._id })).save()
      ]);

      // Test query plan for city search
      const explain = await Hotel.find({ 'address.city': 'Paris' }).explain('executionStats');
      
      // Should use index scan, not collection scan
      expect(explain.executionStats.executionSuccess).toBe(true);
      expect(explain.executionStats.totalDocsExamined).toBeLessThanOrEqual(1);
    });

    test('should aggregate statistics efficiently', async () => {
      const manager = await createUserWithRole('ADMIN');
      
      // Create hotels with various stats
      const hotels = await Promise.all([
        new Hotel(createHotelData({ managerId: manager._id })).save(),
        new Hotel(createHotelData({ managerId: manager._id })).save(),
        new Hotel(createHotelData({ managerId: manager._id })).save()
      ]);

      const startTime = Date.now();
      const stats = await Hotel.getGlobalStats();
      const queryTime = Date.now() - startTime;
      
      expect(stats).toHaveLength(1);
      expect(queryTime).toBeLessThan(500); // Should be fast
    });
  });
});