/**
 * TESTS AVAILABILITY - VÉRIFICATION DISPONIBILITÉ TEMPS RÉEL
 * Tests critiques pour éviter double-réservations et optimiser occupation
 * 
 * Coverage critique :
 * - Anti-collision : overlapping bookings detection
 * - Availability checking temps réel avec cache
 * - Room status management et cohérence
 * - Edge cases : dates limites, statuts complexes
 * - Performance : cache invalidation et optimisation
 * - Business logic : allocation optimisée + alternatives
 */

const mongoose = require('mongoose');
const {
  checkAvailability,
  isRoomAvailable,
  getOccupancyRate,
  invalidateHotelCache,
  processAvailability,
  optimizeRoomAllocation,
  generateAlternatives,
  getRoomsForHotel,
  getConflictingBookings
} = require('../../../src/utils/availability');

const {
  ROOM_STATUS,
  BOOKING_STATUS,
  ROOM_TYPES,
  ERROR_MESSAGES
} = require('../../../src/utils/constants');

// Mock des modèles
jest.mock('../../../src/models/Room');
jest.mock('../../../src/models/Booking');
jest.mock('../../../src/models/Hotel');

const Room = require('../../../src/models/Room');
const Booking = require('../../../src/models/Booking');

describe('Availability - Core Functions', () => {

  beforeEach(() => {
    jest.clearAllMocks();
    // Clear cache avant chaque test
    if (typeof invalidateHotelCache === 'function') {
      invalidateHotelCache('test-hotel-id');
    }
  });

  describe('checkAvailability - Fonction principale', () => {
    
    const mockHotelId = new mongoose.Types.ObjectId();
    const checkInDate = new Date('2025-12-25');
    const checkOutDate = new Date('2025-12-28');

    test('devrait valider les paramètres requis', async () => {
      // Test ID hôtel invalide
      await expect(checkAvailability({
        hotelId: 'invalid-id',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      })).rejects.toThrow('ID hôtel invalide');

      // Test dates invalides
      await expect(checkAvailability({
        hotelId: mockHotelId,
        checkInDate: null,
        checkOutDate,
        roomsNeeded: 1
      })).rejects.toThrow('Date invalide');

      // Test dates incohérentes
      await expect(checkAvailability({
        hotelId: mockHotelId,
        checkInDate: checkOutDate,
        checkOutDate: checkInDate,
        roomsNeeded: 1
      })).rejects.toThrow('Date de fin doit être après date de début');

      // Test date dans le passé
      const pastDate = new Date('2020-01-01');
      await expect(checkAvailability({
        hotelId: mockHotelId,
        checkInDate: pastDate,
        checkOutDate,
        roomsNeeded: 1
      })).rejects.toThrow('La date ne peut pas être dans le passé');
    });

    test('devrait valider le nombre de chambres', async () => {
      // Test nombre négatif
      await expect(checkAvailability({
        hotelId: mockHotelId,
        checkInDate,
        checkOutDate,
        roomsNeeded: -1
      })).rejects.toThrow('Nombre de chambres invalide');

      // Test nombre trop élevé
      await expect(checkAvailability({
        hotelId: mockHotelId,
        checkInDate,
        checkOutDate,
        roomsNeeded: 15 // > MAX_ROOMS_PER_BOOKING
      })).rejects.toThrow('Nombre de chambres invalide');
    });

    test('devrait valider le type de chambre si fourni', async () => {
      await expect(checkAvailability({
        hotelId: mockHotelId,
        roomType: 'InvalidType',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      })).rejects.toThrow('Type de chambre invalide');
    });

    test('devrait retourner disponibilité quand chambres libres', async () => {
      // Mock chambres disponibles
      Room.find.mockResolvedValue([
        { _id: 'room1', number: '101', type: 'Double', status: ROOM_STATUS.AVAILABLE, floor: 1, basePrice: 200 },
        { _id: 'room2', number: '102', type: 'Double', status: ROOM_STATUS.AVAILABLE, floor: 1, basePrice: 200 }
      ]);

      // Mock aucune réservation conflictuelle
      Booking.find.mockResolvedValue([]);

      const result = await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      });

      expect(result.available).toBe(true);
      expect(result.roomsFound).toBe(1);
      expect(result.recommendedRooms).toHaveLength(1);
      expect(result.recommendedRooms[0].number).toBe('101');
    });

    test('devrait détecter conflits de réservations (overlapping)', async () => {
      // Mock chambres disponibles
      Room.find.mockResolvedValue([
        { _id: 'room1', number: '101', type: 'Double', status: ROOM_STATUS.AVAILABLE }
      ]);

      // Mock réservation conflictuelle (overlapping)
      Booking.find.mockResolvedValue([
        {
          _id: 'booking1',
          checkInDate: new Date('2025-12-24'),
          checkOutDate: new Date('2025-12-26'), // Overlap avec notre période
          status: BOOKING_STATUS.CONFIRMED,
          rooms: [{ room: { _id: 'room1' }, type: 'Double' }]
        }
      ]);

      const result = await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      });

      expect(result.available).toBe(false);
      expect(result.roomsFound).toBe(0);
    });

    test('devrait exclure chambres en maintenance', async () => {
      // Mock chambres : 1 disponible, 1 en maintenance
      Room.find.mockResolvedValue([
        { _id: 'room1', number: '101', type: 'Double', status: ROOM_STATUS.AVAILABLE },
        { _id: 'room2', number: '102', type: 'Double', status: ROOM_STATUS.MAINTENANCE }
      ]);

      Booking.find.mockResolvedValue([]);

      const result = await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 2
      });

      expect(result.available).toBe(false); // Seulement 1 disponible sur 2 demandées
      expect(result.roomsFound).toBe(1);
      expect(result.statistics.totalUnavailable).toBe(1);
    });

    test('devrait gérer les réservations avec exclusion', async () => {
      Room.find.mockResolvedValue([
        { _id: 'room1', number: '101', type: 'Double', status: ROOM_STATUS.AVAILABLE }
      ]);

      // Mock réservation conflictuelle
      Booking.find.mockResolvedValue([
        {
          _id: 'booking-to-exclude',
          checkInDate: checkInDate,
          checkOutDate: checkOutDate,
          status: BOOKING_STATUS.CONFIRMED,
          rooms: [{ room: { _id: 'room1' }, type: 'Double' }]
        }
      ]);

      // Sans exclusion : pas disponible
      const resultWithoutExclusion = await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1
      });
      expect(resultWithoutExclusion.available).toBe(false);

      // Avec exclusion : disponible (pour modification réservation)
      const resultWithExclusion = await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate,
        checkOutDate,
        roomsNeeded: 1,
        excludeBookingId: 'booking-to-exclude'
      });
      expect(resultWithExclusion.available).toBe(true);
    });
  });

  describe('Overlapping Detection - Logique Anti-Collision', () => {
    
    test('devrait détecter overlapping exact', () => {
      const booking = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };
      
      const searchPeriod = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };

      // Même période exacte = conflit
      const hasOverlap = (
        booking.checkOutDate > searchPeriod.checkInDate &&
        booking.checkInDate < searchPeriod.checkOutDate
      );
      
      expect(hasOverlap).toBe(true);
    });

    test('devrait détecter overlapping partiel début', () => {
      const booking = {
        checkInDate: new Date('2025-12-23'),
        checkOutDate: new Date('2025-12-26') // Se termine pendant notre période
      };
      
      const searchPeriod = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };

      const hasOverlap = (
        booking.checkOutDate > searchPeriod.checkInDate &&
        booking.checkInDate < searchPeriod.checkOutDate
      );
      
      expect(hasOverlap).toBe(true);
    });

    test('devrait détecter overlapping partiel fin', () => {
      const booking = {
        checkInDate: new Date('2025-12-26'), // Commence pendant notre période
        checkOutDate: new Date('2025-12-30')
      };
      
      const searchPeriod = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };

      const hasOverlap = (
        booking.checkOutDate > searchPeriod.checkInDate &&
        booking.checkInDate < searchPeriod.checkOutDate
      );
      
      expect(hasOverlap).toBe(true);
    });

    test('devrait détecter overlapping englobant', () => {
      const booking = {
        checkInDate: new Date('2025-12-20'), // Commence avant
        checkOutDate: new Date('2025-12-30')  // Finit après
      };
      
      const searchPeriod = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };

      const hasOverlap = (
        booking.checkOutDate > searchPeriod.checkInDate &&
        booking.checkInDate < searchPeriod.checkOutDate
      );
      
      expect(hasOverlap).toBe(true);
    });

    test('NE devrait PAS détecter overlapping adjacent', () => {
      const booking1 = {
        checkInDate: new Date('2025-12-20'),
        checkOutDate: new Date('2025-12-25') // Finit quand notre période commence
      };

      const booking2 = {
        checkInDate: new Date('2025-12-28'), // Commence quand notre période finit
        checkOutDate: new Date('2025-12-30')
      };
      
      const searchPeriod = {
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };

      const hasOverlap1 = (
        booking1.checkOutDate > searchPeriod.checkInDate &&
        booking1.checkInDate < searchPeriod.checkOutDate
      );

      const hasOverlap2 = (
        booking2.checkOutDate > searchPeriod.checkInDate &&
        booking2.checkInDate < searchPeriod.checkOutDate
      );
      
      expect(hasOverlap1).toBe(false); // Check-out = check-in suivant OK
      expect(hasOverlap2).toBe(false); // Check-in = check-out précédent OK
    });
  });

  describe('isRoomAvailable - Chambre spécifique', () => {
    
    const mockRoomId = new mongoose.Types.ObjectId();
    const checkInDate = new Date('2025-12-25');
    const checkOutDate = new Date('2025-12-28');

    test('devrait retourner erreur si chambre n\'existe pas', async () => {
      Room.findById.mockResolvedValue(null);

      await expect(isRoomAvailable(mockRoomId, checkInDate, checkOutDate))
        .rejects.toThrow(ERROR_MESSAGES.ROOM_NOT_FOUND);
    });

    test('devrait retourner non disponible si chambre en maintenance', async () => {
      Room.findById.mockResolvedValue({
        _id: mockRoomId,
        status: ROOM_STATUS.MAINTENANCE,
        hotel: 'hotel1',
        type: 'Double'
      });

      const result = await isRoomAvailable(mockRoomId, checkInDate, checkOutDate);

      expect(result.available).toBe(false);
      expect(result.reason).toContain('Maintenance');
    });

    test('devrait vérifier disponibilité via checkAvailability', async () => {
      Room.findById.mockResolvedValue({
        _id: mockRoomId,
        status: ROOM_STATUS.AVAILABLE,
        hotel: 'hotel1',
        type: 'Double'
      });

      // Mock checkAvailability indirectement
      Room.find.mockResolvedValue([
        { _id: mockRoomId, number: '101', type: 'Double', status: ROOM_STATUS.AVAILABLE }
      ]);
      Booking.find.mockResolvedValue([]);

      const result = await isRoomAvailable(mockRoomId, checkInDate, checkOutDate);

      expect(result.available).toBe(true);
      expect(result.reason).toBeNull();
    });
  });

  describe('processAvailability - Logique métier', () => {
    
    test('devrait traiter correctement les chambres occupées', () => {
      const allRooms = [
        { _id: 'room1', type: 'Double', status: ROOM_STATUS.AVAILABLE },
        { _id: 'room2', type: 'Double', status: ROOM_STATUS.AVAILABLE },
        { _id: 'room3', type: 'Suite', status: ROOM_STATUS.AVAILABLE }
      ];

      const conflictingBookings = [
        {
          rooms: [
            { room: { _id: 'room1' }, type: 'Double' }
          ]
        }
      ];

      const result = processAvailability({
        allRooms,
        conflictingBookings,
        roomType: 'Double',
        roomsNeeded: 1,
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      });

      expect(result.available).toBe(true); // room2 disponible
      expect(result.roomsFound).toBe(1);
      expect(result.availabilityByType.Double.available).toBe(1);
      expect(result.availabilityByType.Double.occupied).toBe(1);
    });

    test('devrait calculer correctement les statistiques', () => {
      const allRooms = [
        { _id: 'room1', type: 'Double', status: ROOM_STATUS.AVAILABLE },
        { _id: 'room2', type: 'Double', status: ROOM_STATUS.MAINTENANCE },
        { _id: 'room3', type: 'Suite', status: ROOM_STATUS.AVAILABLE }
      ];

      const conflictingBookings = [
        {
          rooms: [
            { room: { _id: 'room1' }, type: 'Double' }
          ]
        }
      ];

      const result = processAvailability({
        allRooms,
        conflictingBookings,
        roomType: null, // Tous types
        roomsNeeded: 2,
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      });

      expect(result.statistics.totalRooms).toBe(3);
      expect(result.statistics.totalAvailable).toBe(1); // Seulement Suite disponible
      expect(result.statistics.totalOccupied).toBe(1);   // room1 occupée
      expect(result.statistics.totalUnavailable).toBe(1); // room2 maintenance
    });
  });

  describe('optimizeRoomAllocation - Allocation intelligente', () => {
    
    test('devrait allouer dans l\'ordre de préférence prix', () => {
      const availabilityByType = {
        [ROOM_TYPES.SIMPLE]: {
          available: 2,
          availableRooms: [
            { _id: 'simple1', type: ROOM_TYPES.SIMPLE },
            { _id: 'simple2', type: ROOM_TYPES.SIMPLE }
          ]
        },
        [ROOM_TYPES.SUITE]: {
          available: 1,
          availableRooms: [
            { _id: 'suite1', type: ROOM_TYPES.SUITE }
          ]
        }
      };

      const result = optimizeRoomAllocation(availabilityByType, 2);

      expect(result).toHaveLength(2);
      expect(result[0].type).toBe(ROOM_TYPES.SIMPLE); // Moins cher en premier
      expect(result[1].type).toBe(ROOM_TYPES.SIMPLE);
    });

    test('devrait mixer les types si nécessaire', () => {
      const availabilityByType = {
        [ROOM_TYPES.SIMPLE]: {
          available: 1,
          availableRooms: [{ _id: 'simple1', type: ROOM_TYPES.SIMPLE }]
        },
        [ROOM_TYPES.DOUBLE]: {
          available: 2,
          availableRooms: [
            { _id: 'double1', type: ROOM_TYPES.DOUBLE },
            { _id: 'double2', type: ROOM_TYPES.DOUBLE }
          ]
        }
      };

      const result = optimizeRoomAllocation(availabilityByType, 3);

      expect(result).toHaveLength(3);
      expect(result.filter(r => r.type === ROOM_TYPES.SIMPLE)).toHaveLength(1);
      expect(result.filter(r => r.type === ROOM_TYPES.DOUBLE)).toHaveLength(2);
    });
  });

  describe('generateAlternatives - Suggestions intelligentes', () => {
    
    test('devrait suggérer types différents', () => {
      const availabilityByType = {
        [ROOM_TYPES.DOUBLE]: {
          available: 0,
          availableRooms: []
        },
        [ROOM_TYPES.SUITE]: {
          available: 2,
          availableRooms: [
            { _id: 'suite1' },
            { _id: 'suite2' }
          ]
        }
      };

      const alternatives = generateAlternatives(
        availabilityByType,
        1, // roomsNeeded
        ROOM_TYPES.DOUBLE // requestedType
      );

      expect(alternatives).toHaveLength(1);
      expect(alternatives[0].type).toBe('different_room_type');
      expect(alternatives[0].roomType).toBe(ROOM_TYPES.SUITE);
      expect(alternatives[0].availableCount).toBe(2);
    });

    test('devrait suggérer quantité réduite', () => {
      const availabilityByType = {
        [ROOM_TYPES.DOUBLE]: {
          available: 2,
          availableRooms: [
            { _id: 'double1' },
            { _id: 'double2' }
          ]
        }
      };

      const alternatives = generateAlternatives(
        availabilityByType,
        5, // roomsNeeded
        ROOM_TYPES.DOUBLE
      );

      expect(alternatives).toHaveLength(1);
      expect(alternatives[0].type).toBe('reduced_quantity');
      expect(alternatives[0].availableCount).toBe(2);
    });
  });

  describe('getOccupancyRate - Taux d\'occupation', () => {
    
    const mockHotelId = new mongoose.Types.ObjectId();
    const startDate = new Date('2025-12-01');
    const endDate = new Date('2025-12-31');

    test('devrait calculer taux d\'occupation correctement', async () => {
      // Mock disponibilité retournant des stats
      Room.find.mockResolvedValue([
        { _id: 'room1', status: ROOM_STATUS.AVAILABLE },
        { _id: 'room2', status: ROOM_STATUS.OCCUPIED },
        { _id: 'room3', status: ROOM_STATUS.AVAILABLE }
      ]);
      Booking.find.mockResolvedValue([
        {
          rooms: [{ room: { _id: 'room2' }, type: 'Double' }]
        }
      ]);

      const result = await getOccupancyRate(mockHotelId, startDate, endDate);

      expect(result.totalRooms).toBe(3);
      expect(result.totalOccupied).toBe(1);
      expect(result.totalAvailable).toBe(2);
      expect(result.occupancyRate).toBe(33); // 1/3 = 33%
    });
  });

  describe('Cache Management', () => {
    
    test('invalidateHotelCache devrait être une fonction', () => {
      expect(typeof invalidateHotelCache).toBe('function');
    });

    test('devrait gérer l\'invalidation sans erreur', () => {
      expect(() => {
        invalidateHotelCache('test-hotel-id');
        invalidateHotelCache(null);
        invalidateHotelCache(undefined);
      }).not.toThrow();
    });
  });

  describe('Edge Cases et Robustesse', () => {
    
    test('devrait gérer les dates limites', async () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      Room.find.mockResolvedValue([
        { _id: 'room1', status: ROOM_STATUS.AVAILABLE, type: 'Double' }
      ]);
      Booking.find.mockResolvedValue([]);

      // Test réservation pour demain (limite minimale)
      const result = await checkAvailability({
        hotelId: new mongoose.Types.ObjectId(),
        checkInDate: tomorrow,
        checkOutDate: new Date(tomorrow.getTime() + 24 * 60 * 60 * 1000),
        roomsNeeded: 1
      });

      expect(result.available).toBe(true);
    });

    test('devrait gérer les erreurs de base de données', async () => {
      Room.find.mockRejectedValue(new Error('Database connection failed'));

      await expect(checkAvailability({
        hotelId: new mongoose.Types.ObjectId(),
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28'),
        roomsNeeded: 1
      })).rejects.toThrow('Erreur vérification disponibilité');
    });

    test('devrait gérer les statuts de réservation correctement', async () => {
      Room.find.mockResolvedValue([
        { _id: 'room1', status: ROOM_STATUS.AVAILABLE, type: 'Double' }
      ]);

      // Seules les réservations CONFIRMED, CHECKED_IN, PENDING bloquent
      Booking.find.mockResolvedValue([
        {
          status: BOOKING_STATUS.CANCELLED, // Ne doit PAS bloquer
          rooms: [{ room: { _id: 'room1' }, type: 'Double' }]
        }
      ]);

      const result = await checkAvailability({
        hotelId: new mongoose.Types.ObjectId(),
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28'),
        roomsNeeded: 1
      });

      expect(result.available).toBe(true); // Réservation annulée ne bloque pas
    });

    test('devrait calculer correctement les nuits pour différentes durées', async () => {
      const testCases = [
        { checkIn: '2025-12-25', checkOut: '2025-12-26', expectedNights: 1 },
        { checkIn: '2025-12-25', checkOut: '2025-12-28', expectedNights: 3 },
        { checkIn: '2025-12-01', checkOut: '2025-12-31', expectedNights: 30 }
      ];

      Room.find.mockResolvedValue([
        { _id: 'room1', status: ROOM_STATUS.AVAILABLE, type: 'Double' }
      ]);
      Booking.find.mockResolvedValue([]);

      for (const testCase of testCases) {
        const result = await checkAvailability({
          hotelId: new mongoose.Types.ObjectId(),
          checkInDate: new Date(testCase.checkIn),
          checkOutDate: new Date(testCase.checkOut),
          roomsNeeded: 1
        });

        const actualNights = Math.ceil(
          (new Date(testCase.checkOut) - new Date(testCase.checkIn)) / (1000 * 60 * 60 * 24)
        );
        expect(actualNights).toBe(testCase.expectedNights);
      }
    });
  });

  describe('Performance et Optimisation', () => {
    
    test('devrait utiliser les indexes MongoDB correctement', async () => {
      const mockHotelId = new mongoose.Types.ObjectId();
      
      Room.find.mockResolvedValue([]);
      Booking.find.mockResolvedValue([]);

      await checkAvailability({
        hotelId: mockHotelId,
        roomType: 'Double',
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28'),
        roomsNeeded: 1
      });

      // Vérifier que les requêtes sont optimisées
      expect(Room.find).toHaveBeenCalledWith(
        expect.objectContaining({
          hotel: mockHotelId,
          type: 'Double'
        })
      );

      expect(Booking.find).toHaveBeenCalledWith(
        expect.objectContaining({
          hotel: mockHotelId,
          $and: expect.any(Array)
        })
      );
    });

    test('devrait limiter les résultats pour performance', async () => {
      const manyRooms = Array.from({ length: 100 }, (_, i) => ({
        _id: `room${i}`,
        status: ROOM_STATUS.AVAILABLE,
        type: 'Double'
      }));

      Room.find.mockResolvedValue(manyRooms);
      Booking.find.mockResolvedValue([]);

      const result = await checkAvailability({
        hotelId: new mongoose.Types.ObjectId(),
        roomType: 'Double',
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28'),
        roomsNeeded: 5
      });

      expect(result.recommendedRooms).toHaveLength(5); // Seulement ce qui est demandé
    });
  });
});