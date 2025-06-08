/**
 * AVAILABILITY STRESS TESTS - TESTS DE CHARGE ANTI-COLLISION
 * Tests critiques pour valider la robustesse du système availability
 * sous charge et prévenir les double-réservations
 * 
 * Scénarios testés :
 * - Réservations simultanées sur mêmes chambres
 * - Cache invalidation sous charge
 * - Performance avec grand volume de données
 * - Cohérence données sous concurrent access
 * - Edge cases avec overlapping complexes
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const { setupTestDB, clearTestDB, createTestUser, createTestHotel, createTestRooms } = require('../setup/test-helpers');
const { checkAvailability, invalidateHotelCache } = require('../../src/utils/availability');

const Hotel = require('../../src/models/Hotel');
const Room = require('../../src/models/Room');
const Booking = require('../../src/models/Booking');
const User = require('../../src/models/User');

describe('Availability Stress Tests - Anti-Collision', () => {
  let testHotel;
  let testRooms;
  let adminUser;
  let adminToken;
  let clientUsers;
  let clientTokens;

  beforeAll(async () => {
    await setupTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
  });

  beforeEach(async () => {
    // Créer données test pour chaque test
    adminUser = await createTestUser({ role: 'ADMIN' });
    adminToken = adminUser.token;

    testHotel = await createTestHotel(adminUser.user._id);
    
    // Créer 20 chambres de différents types pour tests de charge
    testRooms = await createTestRooms(testHotel._id, {
      'Simple': 8,
      'Double': 6, 
      'Double Confort': 4,
      'Suite': 2
    });

    // Créer plusieurs utilisateurs clients pour tests concurrents
    clientUsers = [];
    clientTokens = [];
    for (let i = 0; i < 10; i++) {
      const client = await createTestUser({ 
        role: 'CLIENT',
        email: `client${i}@test.com`,
        firstName: `Client${i}`
      });
      clientUsers.push(client.user);
      clientTokens.push(client.token);
    }
  });

  afterEach(async () => {
    // Nettoyage complet après chaque test
    await Booking.deleteMany({});
    await Room.deleteMany({});
    await Hotel.deleteMany({});
    await User.deleteMany({});
    
    // Clear availability cache
    invalidateHotelCache(testHotel._id);
  });

  /**
   * ================================
   * TESTS CONCURRENCE RÉSERVATIONS
   * ================================
   */

  describe('Concurrent Booking Stress Tests', () => {
    test('Should prevent double booking under concurrent load', async () => {
      const checkInDate = new Date('2025-08-01');
      const checkOutDate = new Date('2025-08-03');

      // Créer 10 réservations simultanées pour même type chambre
      const concurrentBookings = clientTokens.map((token, index) => 
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${token}`)
          .send({
            hotelId: testHotel._id,
            checkInDate,
            checkOutDate,
            rooms: [{ type: 'Double', quantity: 1 }],
            numberOfGuests: 2,
            source: 'WEB'
          })
      );

      // Exécuter toutes les requêtes en parallèle
      const results = await Promise.allSettled(concurrentBookings);

      // Analyser résultats
      const successful = results.filter(result => 
        result.status === 'fulfilled' && result.value.status === 201
      );
      const failed = results.filter(result => 
        result.status === 'fulfilled' && result.value.status !== 201
      );

      // Validation : Max 6 réservations (nombre chambres Double disponibles)
      expect(successful.length).toBeLessThanOrEqual(6);
      expect(failed.length).toBeGreaterThanOrEqual(4);

      // Vérifier que les échecs sont dus à indisponibilité
      failed.forEach(result => {
        if (result.status === 'fulfilled') {
          expect(result.value.status).toBeIn([400, 409]);
          expect(result.value.body.message).toMatch(/disponible|conflict/i);
        }
      });

      // Vérifier cohérence base de données
      const actualBookings = await Booking.countDocuments({
        hotel: testHotel._id,
        checkInDate,
        checkOutDate,
        status: 'Pending'
      });

      expect(actualBookings).toBe(successful.length);
      expect(actualBookings).toBeLessThanOrEqual(6);
    }, 10000); // Timeout 10s pour test charge

    test('Should handle rapid successive bookings correctly', async () => {
      const dates = [
        { checkIn: '2025-08-01', checkOut: '2025-08-02' },
        { checkIn: '2025-08-02', checkOut: '2025-08-03' },
        { checkIn: '2025-08-03', checkOut: '2025-08-04' },
        { checkIn: '2025-08-04', checkOut: '2025-08-05' }
      ];

      // Créer réservations successives très rapides
      const rapidBookings = [];
      for (let i = 0; i < 4; i++) {
        const bookingPromise = request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${clientTokens[i]}`)
          .send({
            hotelId: testHotel._id,
            checkInDate: dates[i].checkIn,
            checkOutDate: dates[i].checkOut,
            rooms: [{ type: 'Suite', quantity: 1 }],
            numberOfGuests: 2,
            source: 'WEB'
          });
        
        rapidBookings.push(bookingPromise);
        
        // Délai très court entre requêtes (50ms)
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      const results = await Promise.all(rapidBookings);

      // Toutes devraient réussir (dates différentes)
      results.forEach(result => {
        expect(result.status).toBe(201);
        expect(result.body.success).toBe(true);
      });

      // Vérifier qu'aucune chambre n'est double-bookée
      const allBookings = await Booking.find({
        hotel: testHotel._id,
        'rooms.type': 'Suite'
      }).populate('rooms.room');

      // Vérifier unicité des chambres assignées par période
      const roomAssignments = new Map();
      allBookings.forEach(booking => {
        const period = `${booking.checkInDate}-${booking.checkOutDate}`;
        if (!roomAssignments.has(period)) {
          roomAssignments.set(period, new Set());
        }
        
        booking.rooms.forEach(room => {
          if (room.room) {
            const roomId = room.room._id.toString();
            expect(roomAssignments.get(period).has(roomId)).toBe(false);
            roomAssignments.get(period).add(roomId);
          }
        });
      });
    }, 15000);

    test('Should maintain availability cache consistency under load', async () => {
      const checkInDate = new Date('2025-08-10');
      const checkOutDate = new Date('2025-08-12');

      // Phase 1: Vérifier availability initiale
      const initialAvailability = await checkAvailability({
        hotelId: testHotel._id,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      });

      expect(initialAvailability.available).toBe(true);
      expect(initialAvailability.recommendedRooms.length).toBeGreaterThanOrEqual(1);

      // Phase 2: Créer une réservation
      const bookingResponse = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientTokens[0]}`)
        .send({
          hotelId: testHotel._id,
          checkInDate,
          checkOutDate,
          rooms: [{ type: 'Double', quantity: 3 }], // Réserver 3 chambres
          numberOfGuests: 6,
          source: 'WEB'
        });

      expect(bookingResponse.status).toBe(201);

      // Phase 3: Vérifications availability simultanées (stress cache)
      const simultaneousChecks = Array(20).fill().map(() =>
        checkAvailability({
          hotelId: testHotel._id,
          roomType: 'Double',
          checkInDate,
          checkOutDate,
          roomsNeeded: 1
        })
      );

      const availabilityResults = await Promise.all(simultaneousChecks);

      // Toutes les vérifications doivent être cohérentes
      const firstResult = availabilityResults[0];
      availabilityResults.forEach(result => {
        expect(result.available).toBe(firstResult.available);
        expect(result.recommendedRooms.length).toBe(firstResult.recommendedRooms.length);
        expect(result.statistics.totalAvailable).toBe(firstResult.statistics.totalAvailable);
      });

      // Vérifier que l'availability a été correctement mise à jour
      // (6 chambres Double - 3 réservées = 3 disponibles)
      expect(firstResult.statistics.totalAvailable).toBe(3);
    }, 12000);
  });

  /**
   * ================================
   * TESTS PERFORMANCE VOLUME
   * ================================
   */

  describe('High Volume Performance Tests', () => {
    test('Should handle large number of overlapping bookings efficiently', async () => {
      // Créer 50 réservations avec overlaps complexes
      const bookingPromises = [];
      const baseDate = new Date('2025-09-01');

      for (let i = 0; i < 50; i++) {
        const checkIn = new Date(baseDate);
        checkIn.setDate(baseDate.getDate() + (i % 10)); // 10 jours différents
        
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkIn.getDate() + 2); // 2 nuits

        const clientIndex = i % clientTokens.length;
        
        const bookingPromise = request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${clientTokens[clientIndex]}`)
          .send({
            hotelId: testHotel._id,
            checkInDate: checkIn,
            checkOutDate: checkOut,
            rooms: [{ type: i % 2 === 0 ? 'Simple' : 'Double', quantity: 1 }],
            numberOfGuests: 1,
            source: 'WEB'
          });

        bookingPromises.push(bookingPromise);
      }

      const startTime = Date.now();
      const results = await Promise.allSettled(bookingPromises);
      const endTime = Date.now();

      // Performance : Doit traiter 50 réservations en moins de 10 secondes
      const processingTime = endTime - startTime;
      expect(processingTime).toBeLessThan(10000);

      // Analyser succès/échecs
      const successful = results.filter(r => 
        r.status === 'fulfilled' && r.value.status === 201
      );
      const failed = results.filter(r => 
        r.status === 'fulfilled' && r.value.status !== 201
      );

      console.log(`Performance: ${successful.length} success, ${failed.length} failed in ${processingTime}ms`);

      // Au moins 60% de succès attendu
      expect(successful.length).toBeGreaterThan(30);

      // Vérifier cohérence finale
      const finalBookingCount = await Booking.countDocuments({
        hotel: testHotel._id,
        status: 'Pending'
      });

      expect(finalBookingCount).toBe(successful.length);
    }, 15000);

    test('Should maintain performance with cache pressure', async () => {
      // Phase 1: Remplir le cache avec multiples vérifications
      const cacheWarmupPromises = [];
      
      for (let day = 1; day <= 30; day++) {
        const checkIn = new Date('2025-10-01');
        checkIn.setDate(day);
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkIn.getDate() + 1);

        cacheWarmupPromises.push(
          checkAvailability({
            hotelId: testHotel._id,
            roomType: 'Simple',
            checkInDate: checkIn,
            checkOutDate: checkOut,
            roomsNeeded: 1
          })
        );
      }

      await Promise.all(cacheWarmupPromises);

      // Phase 2: Mesurer performance sous pression cache
      const performanceTestPromises = [];
      const startTime = Date.now();

      for (let i = 0; i < 100; i++) {
        const randomDay = Math.floor(Math.random() * 30) + 1;
        const checkIn = new Date('2025-10-01');
        checkIn.setDate(randomDay);
        const checkOut = new Date(checkIn);
        checkOut.setDate(checkIn.getDate() + 1);

        performanceTestPromises.push(
          checkAvailability({
            hotelId: testHotel._id,
            roomType: 'Simple',
            checkInDate: checkIn,
            checkOutDate: checkOut,
            roomsNeeded: 1
          })
        );
      }

      const results = await Promise.all(performanceTestPromises);
      const endTime = Date.now();

      // Performance : 100 vérifications en moins de 2 secondes
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(2000);

      // Toutes les vérifications doivent réussir
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result.available).toBeDefined();
        expect(result.statistics).toBeDefined();
      });

      console.log(`Cache Performance: 100 availability checks in ${totalTime}ms (avg: ${totalTime/100}ms per check)`);
    }, 10000);
  });

  /**
   * ================================
   * TESTS EDGE CASES COMPLEXES
   * ================================
   */

  describe('Complex Edge Cases Under Load', () => {
    test('Should handle complex overlapping scenarios correctly', async () => {
      // Scénario : Réservations qui se chevauchent partiellement
      const scenarios = [
        { checkIn: '2025-11-01', checkOut: '2025-11-05', rooms: 2 }, // 4 nuits
        { checkIn: '2025-11-03', checkOut: '2025-11-06', rooms: 2 }, // Overlap 2 jours
        { checkIn: '2025-11-05', checkOut: '2025-11-08', rooms: 2 }, // Overlap 1 jour
        { checkIn: '2025-11-07', checkOut: '2025-11-10', rooms: 2 }, // Overlap 1 jour
        { checkIn: '2025-11-02', checkOut: '2025-11-09', rooms: 2 }  // Span multiple
      ];

      const bookingResults = [];

      // Créer réservations séquentiellement pour analyser patterns
      for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        const clientToken = clientTokens[i % clientTokens.length];

        const response = await request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${clientToken}`)
          .send({
            hotelId: testHotel._id,
            checkInDate: scenario.checkIn,
            checkOutDate: scenario.checkOut,
            rooms: [{ type: 'Double', quantity: scenario.rooms }],
            numberOfGuests: scenario.rooms * 2,
            source: 'WEB'
          });

        bookingResults.push({
          scenario: i + 1,
          success: response.status === 201,
          status: response.status,
          message: response.body.message
        });

        // Vérifier availability après chaque réservation
        if (response.status === 201) {
          const availability = await checkAvailability({
            hotelId: testHotel._id,
            roomType: 'Double',
            checkInDate: new Date(scenario.checkIn),
            checkOutDate: new Date(scenario.checkOut),
            roomsNeeded: 1
          });

          expect(availability.statistics.totalOccupied).toBeGreaterThan(0);
        }
      }

      // Analyser pattern de succès/échecs
      const successCount = bookingResults.filter(r => r.success).length;
      console.log('Overlap Scenarios Results:', bookingResults);

      // Au moins les 3 premières devraient réussir (6 chambres Double disponibles)
      expect(successCount).toBeGreaterThanOrEqual(3);

      // Vérifier qu'aucune double-réservation n'existe
      const allBookings = await Booking.find({
        hotel: testHotel._id,
        status: 'Pending'
      }).sort({ checkInDate: 1 });

      for (let i = 0; i < allBookings.length; i++) {
        for (let j = i + 1; j < allBookings.length; j++) {
          const booking1 = allBookings[i];
          const booking2 = allBookings[j];

          // Vérifier qu'il n'y a pas d'overlap de chambres
          const hasOverlap = (
            booking1.checkOutDate > booking2.checkInDate &&
            booking1.checkInDate < booking2.checkOutDate
          );

          if (hasOverlap) {
            // Si overlap de dates, vérifier que pas de conflits chambres
            const rooms1 = booking1.rooms.filter(r => r.room).map(r => r.room.toString());
            const rooms2 = booking2.rooms.filter(r => r.room).map(r => r.room.toString());
            
            const roomConflict = rooms1.some(roomId => rooms2.includes(roomId));
            expect(roomConflict).toBe(false);
          }
        }
      }
    }, 20000);

    test('Should recover gracefully from database errors', async () => {
      // Simuler erreur de connexion database pendant availability check
      const originalFind = Room.find;
      let errorCount = 0;
      const maxErrors = 3;

      Room.find = jest.fn().mockImplementation((...args) => {
        if (errorCount < maxErrors) {
          errorCount++;
          return Promise.reject(new Error('Simulated DB error'));
        }
        return originalFind.apply(Room, args);
      });

      try {
        const checkInDate = new Date('2025-12-01');
        const checkOutDate = new Date('2025-12-03');

        // Tenter plusieurs vérifications availability
        const attempts = [];
        for (let i = 0; i < 5; i++) {
          attempts.push(
            checkAvailability({
              hotelId: testHotel._id,
              roomType: 'Simple',
              checkInDate,
              checkOutDate,
              roomsNeeded: 1
            }).catch(error => ({ error: error.message }))
          );
        }

        const results = await Promise.all(attempts);

        // Les premières tentatives devraient échouer
        const errors = results.filter(r => r.error).length;
        const successes = results.filter(r => !r.error).length;

        expect(errors).toBe(maxErrors);
        expect(successes).toBe(2);

        // Vérifier que les succès sont valides
        results.filter(r => !r.error).forEach(result => {
          expect(result.available).toBeDefined();
          expect(result.statistics).toBeDefined();
        });

      } finally {
        // Restaurer fonction originale
        Room.find = originalFind;
      }
    }, 8000);
  });

  /**
   * ================================
   * TESTS STRESS SYSTEM LIMITS
   * ================================
   */

  describe('System Limits Stress Tests', () => {
    test('Should handle maximum concurrent users gracefully', async () => {
      // Créer 50 utilisateurs supplémentaires
      const massClientTokens = [...clientTokens];
      
      for (let i = 10; i < 50; i++) {
        const client = await createTestUser({
          role: 'CLIENT',
          email: `massclient${i}@test.com`
        });
        massClientTokens.push(client.token);
      }

      const checkInDate = new Date('2025-12-15');
      const checkOutDate = new Date('2025-12-17');

      // 50 requêtes simultanées
      const massRequests = massClientTokens.map((token, index) =>
        request(app)
          .post('/api/bookings')
          .set('Authorization', `Bearer ${token}`)
          .send({
            hotelId: testHotel._id,
            checkInDate,
            checkOutDate,
            rooms: [{ type: 'Simple', quantity: 1 }],
            numberOfGuests: 1,
            source: 'WEB'
          })
          .timeout(5000) // 5s timeout par requête
      );

      const startTime = Date.now();
      const results = await Promise.allSettled(massRequests);
      const endTime = Date.now();

      const totalTime = endTime - startTime;
      console.log(`Mass concurrent test: 50 requests in ${totalTime}ms`);

      // Analyser résultats
      const successful = results.filter(r => 
        r.status === 'fulfilled' && r.value.status === 201
      );
      const failed = results.filter(r => 
        r.status === 'fulfilled' && r.value.status !== 201
      );
      const timeouts = results.filter(r => r.status === 'rejected');

      console.log(`Results: ${successful.length} success, ${failed.length} failed, ${timeouts.length} timeouts`);

      // Maximum 8 chambres Simple disponibles
      expect(successful.length).toBeLessThanOrEqual(8);
      expect(successful.length).toBeGreaterThan(0);
      
      // Pas plus de 10% de timeouts acceptable
      expect(timeouts.length).toBeLessThan(5);

      // Vérifier cohérence finale
      const finalCount = await Booking.countDocuments({
        hotel: testHotel._id,
        checkInDate,
        checkOutDate,
        status: 'Pending'
      });

      expect(finalCount).toBe(successful.length);
    }, 30000);
  });

  /**
   * ================================
   * HELPER METHODS
   * ================================
   */

  // Helper pour créer multiples chambres par type
  async function createTestRoomsMultiple(hotelId, roomCounts) {
    const rooms = [];
    let roomNumber = 100;

    for (const [roomType, count] of Object.entries(roomCounts)) {
      for (let i = 0; i < count; i++) {
        const room = await Room.create({
          hotel: hotelId,
          number: `${roomNumber++}`,
          type: roomType,
          floor: Math.floor(roomNumber / 100),
          basePrice: getBasePriceForType(roomType),
          status: 'Available',
          amenities: [`WiFi`, `AC`],
          maxOccupancy: roomType === 'Suite' ? 4 : roomType.includes('Double') ? 2 : 1
        });
        rooms.push(room);
      }
    }

    return rooms;
  }

  function getBasePriceForType(roomType) {
    const basePrices = {
      'Simple': 150,
      'Double': 200,
      'Double Confort': 300,
      'Suite': 500
    };
    return basePrices[roomType] || 200;
  }
});

// Matcher Jest personnalisé
expect.extend({
  toBeIn(received, expectedArray) {
    const pass = expectedArray.includes(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be in [${expectedArray.join(', ')}]`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be in [${expectedArray.join(', ')}]`,
        pass: false,
      };
    }
  },
});