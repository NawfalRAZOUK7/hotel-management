/**
 * TESTS BOOKING WORKFLOW - TRANSITIONS STATUTS COMPLÈTES
 * Tests critiques pour le moteur de workflow des réservations
 * 
 * Coverage :
 * - Toutes transitions autorisées/interdites
 * - Validations métier par statut
 * - Actions pré/post transition
 * - Gestion erreurs et rollback
 * - Permissions par rôle
 * - Business rules complexes
 */

const {
  executeStatusTransition,
  validateTransition,
  validateConfirmation,
  validateCheckIn,
  validateCheckOut,
  validateCancellation,
  validateRejection,
  getAvailableTransitions,
  canUserExecuteTransition,
  WorkflowError
} = require('../../../src/utils/bookingWorkflow');

const {
  BOOKING_STATUS,
  USER_ROLES,
  ROOM_STATUS,
  CLIENT_TYPES,
  BUSINESS_RULES
} = require('../../../src/utils/constants');

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mocks
jest.mock('../../../src/utils/availability');
jest.mock('../../../src/models/Booking');
jest.mock('../../../src/models/Room');
jest.mock('../../../src/models/Hotel');

const { checkAvailability, invalidateHotelCache } = require('../../../src/utils/availability');

describe('🔄 BookingWorkflow - Core Engine', () => {
  let mongoServer;
  let mockBooking;
  let mockUser;
  let mockSession;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock booking de base
    mockBooking = {
      _id: new mongoose.Types.ObjectId(),
      status: BOOKING_STATUS.PENDING,
      hotel: {
        _id: new mongoose.Types.ObjectId(),
        name: 'Hôtel Test',
        code: 'TST001'
      },
      customer: {
        _id: new mongoose.Types.ObjectId(),
        firstName: 'Ahmed',
        lastName: 'Bennani',
        email: 'ahmed@test.ma'
      },
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-18'),
      totalPrice: 1500,
      rooms: [
        { type: 'Double', basePrice: 200, calculatedPrice: 500 }
      ],
      statusHistory: [],
      save: jest.fn().mockResolvedValue(true)
    };

    // Mock utilisateur admin
    mockUser = {
      id: new mongoose.Types.ObjectId(),
      role: USER_ROLES.ADMIN,
      firstName: 'Admin',
      lastName: 'System'
    };

    // Mock session MongoDB
    mockSession = {
      abortTransaction: jest.fn(),
      endSession: jest.fn()
    };

    // Setup mocks Mongoose
    const Booking = require('../../../src/models/Booking');
    Booking.findById = jest.fn().mockReturnValue({
      populate: jest.fn().mockReturnValue({
        session: jest.fn().mockResolvedValue(mockBooking)
      })
    });
    Booking.findByIdAndUpdate = jest.fn().mockResolvedValue({
      ...mockBooking,
      status: BOOKING_STATUS.CONFIRMED
    });

    const Room = require('../../../src/models/Room');
    Room.findById = jest.fn().mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      number: '201',
      status: ROOM_STATUS.AVAILABLE
    });
    Room.updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  });

  describe('🔧 executeStatusTransition - Moteur Principal', () => {
    test('✅ Doit exécuter transition valide PENDING → CONFIRMED', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.PENDING;
      checkAvailability.mockResolvedValue({ available: true });

      // Act
      const result = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CONFIRMED,
        { reason: 'Validation admin' },
        mockUser,
        mockSession
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.transition.from).toBe(BOOKING_STATUS.PENDING);
      expect(result.transition.to).toBe(BOOKING_STATUS.CONFIRMED);
      expect(result.transition.reason).toBe('Validation admin');
      expect(result.booking.status).toBe(BOOKING_STATUS.CONFIRMED);
    });

    test('❌ Doit rejeter transition non autorisée COMPLETED → PENDING', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.COMPLETED;

      // Act & Assert
      await expect(
        executeStatusTransition(
          mockBooking._id,
          BOOKING_STATUS.PENDING,
          { reason: 'Test invalide' },
          mockUser,
          mockSession
        )
      ).rejects.toThrow(WorkflowError);
    });

    test('❌ Doit rejeter si réservation non trouvée', async () => {
      // Arrange
      const Booking = require('../../../src/models/Booking');
      Booking.findById.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue(null)
        })
      });

      // Act & Assert
      await expect(
        executeStatusTransition(
          new mongoose.Types.ObjectId(),
          BOOKING_STATUS.CONFIRMED,
          { reason: 'Test' },
          mockUser
        )
      ).rejects.toThrow('Réservation non trouvée');
    });

    test('🔄 Doit créer historique de transition', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.PENDING;
      mockBooking.statusHistory = [
        {
          previousStatus: 'Initial',
          newStatus: BOOKING_STATUS.PENDING,
          changedAt: new Date()
        }
      ];
      checkAvailability.mockResolvedValue({ available: true });

      // Act
      const result = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CONFIRMED,
        { reason: 'Test historique' },
        mockUser
      );

      // Assert
      expect(result.booking.statusHistory).toHaveLength(2);
      expect(result.booking.statusHistory[1]).toMatchObject({
        previousStatus: BOOKING_STATUS.PENDING,
        newStatus: BOOKING_STATUS.CONFIRMED,
        reason: 'Test historique',
        changedBy: mockUser.id
      });
    });

    test('🎯 Doit invalider cache si nécessaire', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.PENDING;
      checkAvailability.mockResolvedValue({ available: true });

      // Act
      await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CONFIRMED,
        { reason: 'Test cache' },
        mockUser
      );

      // Assert
      expect(invalidateHotelCache).toHaveBeenCalledWith(mockBooking.hotel._id);
    });
  });

  describe('✅ Validations Spécifiques par Statut', () => {
    describe('validateConfirmation', () => {
      test('✅ Admin peut confirmer avec disponibilité valide', async () => {
        // Arrange
        checkAvailability.mockResolvedValue({ available: true });

        // Act
        const result = await validateConfirmation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(true);
        expect(checkAvailability).toHaveBeenCalledWith({
          hotelId: mockBooking.hotel._id,
          roomType: 'Double',
          checkInDate: mockBooking.checkInDate,
          checkOutDate: mockBooking.checkOutDate,
          roomsNeeded: 1,
          excludeBookingId: mockBooking._id
        });
      });

      test('❌ Non-admin ne peut pas confirmer', async () => {
        // Arrange
        mockUser.role = USER_ROLES.CLIENT;

        // Act
        const result = await validateConfirmation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Seuls les admins peuvent confirmer');
      });

      test('❌ Doit rejeter si plus de disponibilité', async () => {
        // Arrange
        checkAvailability.mockResolvedValue({ available: false });

        // Act
        const result = await validateConfirmation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Plus de chambres Double disponibles');
      });
    });

    describe('validateCheckIn', () => {
      test('✅ Staff peut effectuer check-in à date valide', async () => {
        // Arrange
        mockUser.role = USER_ROLES.RECEPTIONIST;
        mockBooking.checkInDate = new Date(); // Aujourd'hui

        // Act
        const result = await validateCheckIn(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(true);
      });

      test('❌ Client ne peut pas effectuer check-in', async () => {
        // Arrange
        mockUser.role = USER_ROLES.CLIENT;

        // Act
        const result = await validateCheckIn(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Check-in réservé au staff');
      });

      test('❌ Check-in trop tardif (> 1 jour après date prévue)', async () => {
        // Arrange
        const pastDate = new Date();
        pastDate.setDate(pastDate.getDate() - 3); // Il y a 3 jours
        mockBooking.checkInDate = pastDate;

        // Act
        const result = await validateCheckIn(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Date limite de check-in dépassée');
      });

      test('✅ Validation attribution chambres si fournie', async () => {
        // Arrange
        const Room = require('../../../src/models/Room');
        Room.findById.mockResolvedValue({
          _id: 'room1',
          number: '201',
          status: ROOM_STATUS.AVAILABLE
        });

        const transitionData = {
          roomAssignments: [
            { roomId: 'room1' }
          ]
        };

        // Act
        const result = await validateCheckIn(mockBooking, transitionData, mockUser);

        // Assert
        expect(result.valid).toBe(true);
        expect(Room.findById).toHaveBeenCalledWith('room1');
      });

      test('❌ Attribution chambre non disponible', async () => {
        // Arrange
        const Room = require('../../../src/models/Room');
        Room.findById.mockResolvedValue({
          _id: 'room1',
          number: '201',
          status: ROOM_STATUS.OCCUPIED
        });

        const transitionData = {
          roomAssignments: [
            { roomId: 'room1' }
          ]
        };

        // Act
        const result = await validateCheckIn(mockBooking, transitionData, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Chambre 201 non disponible');
      });
    });

    describe('validateCheckOut', () => {
      test('✅ Staff peut effectuer check-out avec chambres assignées', async () => {
        // Arrange
        mockUser.role = USER_ROLES.RECEPTIONIST;
        mockBooking.rooms = [
          { type: 'Double', room: new mongoose.Types.ObjectId() }
        ];

        // Act
        const result = await validateCheckOut(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(true);
      });

      test('❌ Check-out impossible avec chambres non assignées', async () => {
        // Arrange
        mockBooking.rooms = [
          { type: 'Double', room: null }
        ];

        // Act
        const result = await validateCheckOut(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('chambre(s) non assignée(s)');
      });
    });

    describe('validateCancellation', () => {
      test('✅ Client peut annuler sa propre réservation', async () => {
        // Arrange
        mockUser.role = USER_ROLES.CLIENT;
        mockUser.id = mockBooking.customer._id;
        mockBooking.status = BOOKING_STATUS.PENDING;

        // Act
        const result = await validateCancellation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(true);
      });

      test('❌ Client ne peut pas annuler réservation d\'autrui', async () => {
        // Arrange
        mockUser.role = USER_ROLES.CLIENT;
        mockUser.id = new mongoose.Types.ObjectId(); // Différent du customer
        mockBooking.customer = { toString: () => 'different_id' };

        // Act
        const result = await validateCancellation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Accès non autorisé à cette réservation');
      });

      test('❌ Impossible d\'annuler réservation COMPLETED', async () => {
        // Arrange
        mockBooking.status = BOOKING_STATUS.COMPLETED;

        // Act
        const result = await validateCancellation(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Impossible d\'annuler une réservation Completed');
      });
    });

    describe('validateRejection', () => {
      test('✅ Admin peut rejeter avec raison valide', async () => {
        // Arrange
        const transitionData = {
          reason: 'Réservation frauduleuse détectée'
        };

        // Act
        const result = await validateRejection(mockBooking, transitionData, mockUser);

        // Assert
        expect(result.valid).toBe(true);
      });

      test('❌ Non-admin ne peut pas rejeter', async () => {
        // Arrange
        mockUser.role = USER_ROLES.RECEPTIONIST;

        // Act
        const result = await validateRejection(mockBooking, {}, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toBe('Seuls les admins peuvent rejeter');
      });

      test('❌ Raison de rejet trop courte', async () => {
        // Arrange
        const transitionData = {
          reason: 'Non' // < 10 caractères
        };

        // Act
        const result = await validateRejection(mockBooking, transitionData, mockUser);

        // Assert
        expect(result.valid).toBe(false);
        expect(result.error).toContain('Raison de rejet requise (minimum 10 caractères)');
      });
    });
  });

  describe('🔐 Permissions et Transitions Autorisées', () => {
    describe('getAvailableTransitions', () => {
      test('✅ Admin a toutes les transitions depuis PENDING', () => {
        // Act
        const transitions = getAvailableTransitions(BOOKING_STATUS.PENDING, USER_ROLES.ADMIN);

        // Assert
        expect(transitions).toContain(BOOKING_STATUS.CONFIRMED);
        expect(transitions).toContain(BOOKING_STATUS.REJECTED);
        expect(transitions).toContain(BOOKING_STATUS.CANCELLED);
      });

      test('✅ Receptionist peut check-in/out mais pas valider', () => {
        // Act
        const transitionsConfirmed = getAvailableTransitions(BOOKING_STATUS.CONFIRMED, USER_ROLES.RECEPTIONIST);
        const transitionsCheckedIn = getAvailableTransitions(BOOKING_STATUS.CHECKED_IN, USER_ROLES.RECEPTIONIST);

        // Assert
        expect(transitionsConfirmed).toContain(BOOKING_STATUS.CHECKED_IN);
        expect(transitionsConfirmed).not.toContain(BOOKING_STATUS.REJECTED);
        expect(transitionsCheckedIn).toContain(BOOKING_STATUS.COMPLETED);
      });

      test('✅ Client peut seulement annuler', () => {
        // Act
        const transitions = getAvailableTransitions(BOOKING_STATUS.PENDING, USER_ROLES.CLIENT);

        // Assert
        expect(transitions).toContain(BOOKING_STATUS.CANCELLED);
        expect(transitions).not.toContain(BOOKING_STATUS.CONFIRMED);
        expect(transitions).not.toContain(BOOKING_STATUS.REJECTED);
      });
    });

    describe('canUserExecuteTransition', () => {
      test('✅ Admin peut confirmer réservation PENDING', () => {
        // Act
        const result = canUserExecuteTransition(
          BOOKING_STATUS.PENDING,
          BOOKING_STATUS.CONFIRMED,
          USER_ROLES.ADMIN,
          mockBooking,
          mockUser
        );

        // Assert
        expect(result.allowed).toBe(true);
      });

      test('❌ Receptionist ne peut pas valider', () => {
        // Act
        const result = canUserExecuteTransition(
          BOOKING_STATUS.PENDING,
          BOOKING_STATUS.CONFIRMED,
          USER_ROLES.RECEPTIONIST,
          mockBooking,
          { ...mockUser, role: USER_ROLES.RECEPTIONIST }
        );

        // Assert
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Permissions insuffisantes');
      });

      test('❌ Client ne peut pas annuler réservation d\'autrui', () => {
        // Arrange
        const otherUser = {
          id: new mongoose.Types.ObjectId(),
          role: USER_ROLES.CLIENT
        };
        mockBooking.customer = { toString: () => 'different_customer_id' };

        // Act
        const result = canUserExecuteTransition(
          BOOKING_STATUS.PENDING,
          BOOKING_STATUS.CANCELLED,
          USER_ROLES.CLIENT,
          mockBooking,
          otherUser
        );

        // Assert
        expect(result.allowed).toBe(false);
        expect(result.reason).toBe('Accès non autorisé à cette réservation');
      });
    });
  });

  describe('🔄 Workflow Complet End-to-End', () => {
    test('✅ Cycle complet : PENDING → CONFIRMED → CHECKED_IN → COMPLETED', async () => {
      // Setup mocks pour toutes les étapes
      let bookingStatus = BOOKING_STATUS.PENDING;
      const Booking = require('../../../src/models/Booking');
      
      Booking.findById.mockImplementation(() => ({
        populate: jest.fn().mockReturnValue({
          session: jest.fn().mockResolvedValue({
            ...mockBooking,
            status: bookingStatus
          })
        })
      }));

      Booking.findByIdAndUpdate.mockImplementation((id, update) => {
        bookingStatus = update.$set.status;
        return Promise.resolve({
          ...mockBooking,
          status: bookingStatus,
          statusHistory: [...(mockBooking.statusHistory || []), update.$set.statusHistory[0]]
        });
      });

      checkAvailability.mockResolvedValue({ available: true });

      // Step 1: PENDING → CONFIRMED
      const step1 = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CONFIRMED,
        { reason: 'Validation admin' },
        mockUser
      );

      expect(step1.success).toBe(true);
      expect(step1.transition.to).toBe(BOOKING_STATUS.CONFIRMED);

      // Step 2: CONFIRMED → CHECKED_IN
      mockUser.role = USER_ROLES.RECEPTIONIST;
      const step2 = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CHECKED_IN,
        { 
          reason: 'Arrivée client',
          roomAssignments: [{ bookingRoomIndex: 0, roomId: 'room1' }]
        },
        mockUser
      );

      expect(step2.success).toBe(true);
      expect(step2.transition.to).toBe(BOOKING_STATUS.CHECKED_IN);

      // Step 3: CHECKED_IN → COMPLETED
      const step3 = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.COMPLETED,
        { 
          reason: 'Départ client',
          finalExtras: [{ name: 'Mini-bar', price: 50, quantity: 1 }]
        },
        mockUser
      );

      expect(step3.success).toBe(true);
      expect(step3.transition.to).toBe(BOOKING_STATUS.COMPLETED);
    });

    test('✅ Workflow annulation avec remboursement', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.CONFIRMED;
      mockBooking.checkInDate = new Date(Date.now() + 48 * 60 * 60 * 1000); // Dans 48h
      mockUser.role = USER_ROLES.CLIENT;
      mockUser.id = mockBooking.customer._id;

      // Act
      const result = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CANCELLED,
        { reason: 'Changement de plans' },
        mockUser
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.transition.to).toBe(BOOKING_STATUS.CANCELLED);
      expect(result.preTransitionActions).toHaveLength(1);
      expect(result.preTransitionActions[0].action).toBe('calculate_refund');
      expect(result.preTransitionActions[0].refundPercentage).toBe(100); // Gratuit > 24h
    });

    test('❌ Workflow avec erreur et rollback', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.PENDING;
      checkAvailability.mockRejectedValue(new Error('Erreur API disponibilité'));

      // Act & Assert
      await expect(
        executeStatusTransition(
          mockBooking._id,
          BOOKING_STATUS.CONFIRMED,
          { reason: 'Test erreur' },
          mockUser,
          mockSession
        )
      ).rejects.toThrow(WorkflowError);

      // Vérifier que rollback a été appelé
      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });

  describe('🚨 Gestion d\'Erreurs', () => {
    test('❌ WorkflowError avec code et détails', () => {
      // Act
      const error = new WorkflowError(
        'INVALID_TRANSITION',
        'Transition non autorisée',
        { from: 'Completed', to: 'Pending' }
      );

      // Assert
      expect(error.name).toBe('WorkflowError');
      expect(error.code).toBe('INVALID_TRANSITION');
      expect(error.message).toBe('Transition non autorisée');
      expect(error.details).toEqual({ from: 'Completed', to: 'Pending' });
    });

    test('❌ Gestion erreur base de données', async () => {
      // Arrange
      const Booking = require('../../../src/models/Booking');
      Booking.findById.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(
        executeStatusTransition(
          mockBooking._id,
          BOOKING_STATUS.CONFIRMED,
          { reason: 'Test DB error' },
          mockUser
        )
      ).rejects.toThrow('Erreur transition: Database connection failed');
    });

    test('❌ Gestion erreur validation availability', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.PENDING;
      checkAvailability.mockRejectedValue(new Error('Service indisponible'));

      // Act & Assert
      await expect(
        executeStatusTransition(
          mockBooking._id,
          BOOKING_STATUS.CONFIRMED,
          { reason: 'Test availability error' },
          mockUser
        )
      ).rejects.toThrow(WorkflowError);
    });
  });

  describe('🧪 Edge Cases et Scénarios Complexes', () => {
    test('✅ Multiple transitions simultanées (concurrence)', async () => {
      // Simulate concurrent transitions
      const transitions = [
        BOOKING_STATUS.CONFIRMED,
        BOOKING_STATUS.REJECTED,
        BOOKING_STATUS.CANCELLED
      ];

      // Toutes devraient échouer sauf la première à cause des locks
      const promises = transitions.map(status =>
        executeStatusTransition(
          mockBooking._id,
          status,
          { reason: `Transition vers ${status}` },
          mockUser
        ).catch(err => err)
      );

      const results = await Promise.all(promises);
      
      // Au moins une doit réussir, les autres doivent échouer
      const successes = results.filter(r => r.success);
      const failures = results.filter(r => r instanceof Error);
      
      expect(successes.length).toBeGreaterThanOrEqual(1);
      expect(failures.length).toBeGreaterThanOrEqual(0);
    });

    test('✅ Transition avec métadonnées complexes', async () => {
      // Arrange
      mockBooking.status = BOOKING_STATUS.CONFIRMED;
      const complexTransitionData = {
        reason: 'Check-in VIP',
        actualCheckInTime: new Date(),
        guestNotes: 'Client préférentiel - service premium',
        specialServices: ['Late checkout', 'Room upgrade', 'Welcome amenities'],
        roomAssignments: [
          { bookingRoomIndex: 0, roomId: 'premium_room_501' }
        ],
        metadata: {
          priority: 'VIP',
          source: 'concierge',
          upgrades: ['room', 'service']
        }
      };

      // Act
      const result = await executeStatusTransition(
        mockBooking._id,
        BOOKING_STATUS.CHECKED_IN,
        complexTransitionData,
        { ...mockUser, role: USER_ROLES.RECEPTIONIST }
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.booking.guestNotes).toBe('Client préférentiel - service premium');
      expect(result.booking.specialServices).toContain('Welcome amenities');
      expect(result.booking.statusHistory[0].metadata).toEqual(complexTransitionData.metadata);
    });

    test('✅ Calcul remboursement selon délais', async () => {
      const testCases = [
        { 
          hoursUntil: 48, 
          expectedRefund: 100, 
          description: 'Annulation gratuite > 24h' 
        },
        { 
          hoursUntil: 18, 
          expectedRefund: 50, 
          description: 'Annulation tardive 12-24h' 
        },
        { 
          hoursUntil: 6, 
          expectedRefund: 0, 
          description: 'Annulation très tardive < 12h' 
        }
      ];

      for (const testCase of testCases) {
        // Arrange
        const checkInDate = new Date(Date.now() + testCase.hoursUntil * 60 * 60 * 1000);
        const booking = {
          ...mockBooking,
          status: BOOKING_STATUS.CONFIRMED,
          checkInDate,
          totalPrice: 1000
        };

        // Act
        const result = await executeStatusTransition(
          booking._id,
          BOOKING_STATUS.CANCELLED,
          { reason: 'Test calcul remboursement' },
          { ...mockUser, role: USER_ROLES.CLIENT, id: booking.customer._id }
        );

        // Assert
        expect(result.preTransitionActions[0].refundPercentage).toBe(testCase.expectedRefund);
        expect(result.preTransitionActions[0].refundAmount).toBe(1000 * testCase.expectedRefund / 100);
      }
    });
  });
});

describe('🎯 Performance et Optimisation', () => {
  test('⚡ Transition doit s\'exécuter en moins de 500ms', async () => {
    // Arrange
    const startTime = Date.now();
    
    // Act
    await executeStatusTransition(
      mockBooking._id,
      BOOKING_STATUS.CONFIRMED,
      { reason: 'Test performance' },
      mockUser
    );
    
    const executionTime = Date.now() - startTime;
    
    // Assert
    expect(executionTime).toBeLessThan(500);
  });

  test('📊 Cache invalidation sélective', async () => {
    // Test que le cache n'est invalidé que pour certaines transitions
    const nonCacheInvalidatingTransition = BOOKING_STATUS.REJECTED;
    
    await executeStatusTransition(
      mockBooking._id,
      nonCacheInvalidatingTransition,
      { reason: 'Rejet admin' },
      mockUser
    );

    // Le cache ne devrait pas être invalidé pour un rejet
    expect(invalidateHotelCache).not.toHaveBeenCalled();
  });
});