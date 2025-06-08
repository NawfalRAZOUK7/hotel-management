/**
 * TESTS BOOKING CONTROLLER - WORKFLOW COMPLET RÉSERVATIONS
 * Tests les plus complexes du système : CRUD + workflow + business logic
 * 
 * Couvre :
 * - CRUD réservations avec permissions par rôle
 * - Workflow complet PENDING → CONFIRMED → CHECKED_IN → COMPLETED
 * - Branches alternatives : REJECTED, CANCELLED, NO_SHOW
 * - Calculs prix automatiques + availability checking
 * - Gestion extras + génération factures
 * - Check-in/Check-out avec attribution chambres
 * - Politiques annulation + remboursement
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../../src/app');

// Models
const Booking = require('../../../src/models/Booking');
const Hotel = require('../../../src/models/Hotel');
const Room = require('../../../src/models/Room');
const User = require('../../../src/models/User');

// Test helpers
const { 
  connectTestDB, 
  clearTestDB, 
  closeTestDB,
  createTestUser,
  generateJWT
} = require('../../setup/test-helpers');

// Constants
const {
  BOOKING_STATUS,
  BOOKING_SOURCES,
  CLIENT_TYPES,
  ROOM_STATUS,
  USER_ROLES
} = require('../../../src/utils/constants');

describe('Booking Controller', () => {
  let testHotel, testRooms, adminUser, clientUser, receptionistUser;
  let adminToken, clientToken, receptionistToken;

  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await closeTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
    
    // ================================
    // SETUP DONNÉES TEST
    // ================================
    
    // Créer utilisateurs
    adminUser = await createTestUser({
      firstName: 'Admin',
      lastName: 'System',
      email: 'admin@test.com',
      role: USER_ROLES.ADMIN
    });

    clientUser = await createTestUser({
      firstName: 'Client',
      lastName: 'Test',
      email: 'client@test.com',
      role: USER_ROLES.CLIENT
    });

    receptionistUser = await createTestUser({
      firstName: 'Reception',
      lastName: 'Staff',
      email: 'reception@test.com',
      role: USER_ROLES.RECEPTIONIST
    });

    // Générer tokens JWT
    adminToken = generateJWT(adminUser);
    clientToken = generateJWT(clientUser);
    receptionistToken = generateJWT(receptionistUser);

    // Créer hôtel test
    testHotel = new Hotel({
      code: 'TEST001',
      name: 'Test Hotel',
      address: 'Test Address',
      city: 'Test City',
      category: 4,
      createdBy: adminUser._id
    });
    await testHotel.save();

    // Créer chambres test
    testRooms = await Room.create([
      {
        hotel: testHotel._id,
        number: '101',
        type: 'Simple',
        floor: 1,
        basePrice: 200,
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      },
      {
        hotel: testHotel._id,
        number: '201',
        type: 'Double',
        floor: 2,
        basePrice: 300,
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      },
      {
        hotel: testHotel._id,
        number: '301',
        type: 'Suite',
        floor: 3,
        basePrice: 500,
        status: ROOM_STATUS.AVAILABLE,
        createdBy: adminUser._id
      }
    ]);
  });

  // ================================
  // TESTS CRÉATION RÉSERVATIONS
  // ================================

  describe('POST /api/bookings - Create Booking', () => {
    const validBookingData = {
      hotelId: null, // Sera défini dans beforeEach
      checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000), // Demain
      checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // Dans 3 jours
      rooms: [
        { type: 'Double', quantity: 1 }
      ],
      numberOfGuests: 2,
      specialRequests: 'Vue sur mer si possible'
    };

    beforeEach(() => {
      validBookingData.hotelId = testHotel._id.toString();
    });

    test('Client peut créer sa propre réservation', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validBookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking).toMatchObject({
        hotel: testHotel._id.toString(),
        customer: clientUser._id.toString(),
        status: BOOKING_STATUS.PENDING,
        source: BOOKING_SOURCES.WEB,
        numberOfGuests: 2
      });

      // Vérifier calcul prix automatique
      expect(response.body.data.pricing).toHaveProperty('totalPrice');
      expect(response.body.data.pricing.totalPrice).toBeGreaterThan(0);

      // Vérifier que réservation est en attente de validation
      expect(response.body.data.nextSteps.awaitingValidation).toBe(true);
    });

    test('Receptionist peut créer réservation pour client', async () => {
      const bookingWithCustomer = {
        ...validBookingData,
        customerInfo: {
          firstName: 'Nouveau',
          lastName: 'Client',
          email: 'nouveau@test.com',
          phone: '+212612345678'
        }
      };

      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(bookingWithCustomer)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.source).toBe(BOOKING_SOURCES.RECEPTION);
    });

    test('Réservation corporate avec SIRET', async () => {
      const corporateBooking = {
        ...validBookingData,
        corporateDetails: {
          companyName: 'Tech Corp',
          siret: '12345678901234',
          contactPerson: 'Manager'
        }
      };

      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(corporateBooking)
        .expect(201);

      expect(response.body.data.booking.clientType).toBe(CLIENT_TYPES.CORPORATE);
      expect(response.body.data.booking.corporateDetails.siret).toBe('12345678901234');
    });

    test('Échec si chambres non disponibles', async () => {
      // Créer une réservation existante qui bloque les chambres
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: validBookingData.checkInDate,
        checkOutDate: validBookingData.checkOutDate,
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(validBookingData)
        .expect(400);
    });

    test('Validation dates invalides', async () => {
      const invalidDates = {
        ...validBookingData,
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() - 24 * 60 * 60 * 1000) // Hier
      };

      await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(invalidDates)
        .expect(400);
    });

    test('Échec sans authentification', async () => {
      await request(app)
        .post('/api/bookings')
        .send(validBookingData)
        .expect(401);
    });
  });

  // ================================
  // TESTS LECTURE RÉSERVATIONS
  // ================================

  describe('GET /api/bookings - Get Bookings', () => {
    let clientBooking, otherClientBooking;

    beforeEach(async () => {
      // Créer réservations test
      clientBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.PENDING,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      // Autre client pour tester isolation
      const otherClient = await createTestUser({
        firstName: 'Other',
        lastName: 'Client',
        email: 'other@test.com',
        role: USER_ROLES.CLIENT
      });

      otherClientBooking = await Booking.create({
        hotel: testHotel._id,
        customer: otherClient._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Simple', basePrice: 200, calculatedPrice: 600 }],
        numberOfGuests: 1,
        totalPrice: 600,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: otherClient._id
      });
    });

    test('Client voit uniquement ses réservations', async () => {
      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.bookings).toHaveLength(1);
      expect(response.body.data.bookings[0]._id).toBe(clientBooking._id.toString());
    });

    test('Admin voit toutes les réservations', async () => {
      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.data.bookings).toHaveLength(2);
    });

    test('Receptionist voit réservations de son hôtel', async () => {
      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .query({ hotelId: testHotel._id })
        .expect(200);

      expect(response.body.data.bookings).toHaveLength(2);
    });

    test('Filtrage par statut', async () => {
      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ status: BOOKING_STATUS.CONFIRMED })
        .expect(200);

      expect(response.body.data.bookings).toHaveLength(1);
      expect(response.body.data.bookings[0].status).toBe(BOOKING_STATUS.CONFIRMED);
    });

    test('Pagination fonctionne', async () => {
      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 1 })
        .expect(200);

      expect(response.body.data.bookings).toHaveLength(1);
      expect(response.body.data.pagination).toMatchObject({
        currentPage: 1,
        totalCount: 2,
        hasNextPage: true
      });
    });
  });

  // ================================
  // TESTS WORKFLOW - VALIDATION ADMIN
  // ================================

  describe('PUT /api/bookings/:id/validate - Admin Validation', () => {
    let pendingBooking;

    beforeEach(async () => {
      pendingBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.PENDING,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });
    });

    test('Admin peut approuver réservation', async () => {
      const response = await request(app)
        .put(`/api/bookings/${pendingBooking._id}/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'approve',
          reason: 'Réservation validée'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.CONFIRMED);

      // Vérifier mise à jour en base
      const updatedBooking = await Booking.findById(pendingBooking._id);
      expect(updatedBooking.status).toBe(BOOKING_STATUS.CONFIRMED);
      expect(updatedBooking.confirmedBy.toString()).toBe(adminUser._id.toString());
      expect(updatedBooking.confirmedAt).toBeDefined();
    });

    test('Admin peut rejeter réservation', async () => {
      const response = await request(app)
        .put(`/api/bookings/${pendingBooking._id}/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'reject',
          reason: 'Dates non disponibles'
        })
        .expect(200);

      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.REJECTED);

      const updatedBooking = await Booking.findById(pendingBooking._id);
      expect(updatedBooking.status).toBe(BOOKING_STATUS.REJECTED);
      expect(updatedBooking.rejectionReason).toBe('Dates non disponibles');
    });

    test('Admin peut modifier prix lors validation', async () => {
      const response = await request(app)
        .put(`/api/bookings/${pendingBooking._id}/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          action: 'approve',
          reason: 'Approuvé avec réduction',
          modifications: {
            newPrice: 800,
            priceReason: 'Réduction fidélité'
          }
        })
        .expect(200);

      const updatedBooking = await Booking.findById(pendingBooking._id);
      expect(updatedBooking.totalPrice).toBe(800);
      expect(updatedBooking.priceModified).toBe(true);
    });

    test('Client ne peut pas valider', async () => {
      await request(app)
        .put(`/api/bookings/${pendingBooking._id}/validate`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ action: 'approve' })
        .expect(403);
    });

    test('Échec validation si chambres plus disponibles', async () => {
      // Créer réservation conflictuelle confirmée
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: pendingBooking.checkInDate,
        checkOutDate: pendingBooking.checkOutDate,
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      await request(app)
        .put(`/api/bookings/${pendingBooking._id}/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ action: 'approve' })
        .expect(400);
    });
  });

  // ================================
  // TESTS WORKFLOW - CHECK-IN
  // ================================

  describe('PUT /api/bookings/:id/checkin - Check-in Process', () => {
    let confirmedBooking;

    beforeEach(async () => {
      confirmedBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(), // Aujourd'hui
        checkOutDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 600 }],
        numberOfGuests: 2,
        totalPrice: 600,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id,
        confirmedBy: adminUser._id,
        confirmedAt: new Date()
      });
    });

    test('Receptionist peut effectuer check-in avec attribution chambres', async () => {
      const response = await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/checkin`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          roomAssignments: [
            {
              bookingRoomIndex: 0,
              roomId: testRooms[1]._id // Chambre Double 201
            }
          ],
          guestNotes: 'Client VIP',
          specialServices: ['Late checkout']
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.CHECKED_IN);

      // Vérifier mise à jour booking
      const updatedBooking = await Booking.findById(confirmedBooking._id);
      expect(updatedBooking.status).toBe(BOOKING_STATUS.CHECKED_IN);
      expect(updatedBooking.rooms[0].room.toString()).toBe(testRooms[1]._id.toString());
      expect(updatedBooking.guestNotes).toBe('Client VIP');

      // Vérifier chambre marquée occupée
      const updatedRoom = await Room.findById(testRooms[1]._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.OCCUPIED);
      expect(updatedRoom.currentBooking.toString()).toBe(confirmedBooking._id.toString());
    });

    test('Admin peut effectuer check-in', async () => {
      const response = await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/checkin`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          roomAssignments: [
            { bookingRoomIndex: 0, roomId: testRooms[1]._id }
          ]
        })
        .expect(200);

      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.CHECKED_IN);
    });

    test('Client ne peut pas effectuer check-in', async () => {
      await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/checkin`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          roomAssignments: [
            { bookingRoomIndex: 0, roomId: testRooms[1]._id }
          ]
        })
        .expect(403);
    });

    test('Échec check-in si chambre non disponible', async () => {
      // Marquer chambre comme occupée
      await Room.findByIdAndUpdate(testRooms[1]._id, {
        status: ROOM_STATUS.OCCUPIED
      });

      await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/checkin`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          roomAssignments: [
            { bookingRoomIndex: 0, roomId: testRooms[1]._id }
          ]
        })
        .expect(400);
    });

    test('Échec check-in si booking pas confirmé', async () => {
      await Booking.findByIdAndUpdate(confirmedBooking._id, {
        status: BOOKING_STATUS.PENDING
      });

      await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/checkin`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          roomAssignments: [
            { bookingRoomIndex: 0, roomId: testRooms[1]._id }
          ]
        })
        .expect(400);
    });
  });

  // ================================
  // TESTS WORKFLOW - CHECK-OUT
  // ================================

  describe('PUT /api/bookings/:id/checkout - Check-out Process', () => {
    let checkedInBooking;

    beforeEach(async () => {
      // Marquer chambre comme occupée
      await Room.findByIdAndUpdate(testRooms[1]._id, {
        status: ROOM_STATUS.OCCUPIED,
        currentBooking: null // Sera défini après création booking
      });

      checkedInBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Hier
        checkOutDate: new Date(), // Aujourd'hui
        actualCheckInDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        rooms: [{ 
          type: 'Double', 
          basePrice: 300, 
          calculatedPrice: 300,
          room: testRooms[1]._id,
          assignedAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
          assignedBy: receptionistUser._id
        }],
        numberOfGuests: 2,
        totalPrice: 300,
        status: BOOKING_STATUS.CHECKED_IN,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id,
        checkedInBy: receptionistUser._id
      });

      // Mettre à jour chambre avec booking
      await Room.findByIdAndUpdate(testRooms[1]._id, {
        currentBooking: checkedInBooking._id
      });
    });

    test('Receptionist peut effectuer check-out avec extras', async () => {
      const response = await request(app)
        .put(`/api/bookings/${checkedInBooking._id}/checkout`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          finalExtras: [
            {
              name: 'Mini-bar',
              category: 'Boissons',
              price: 50,
              quantity: 1,
              description: 'Consommation mini-bar'
            }
          ],
          roomCondition: [
            {
              roomId: testRooms[1]._id,
              condition: 'good',
              notes: 'Chambre en bon état'
            }
          ],
          paymentStatus: 'Paid',
          generateInvoice: true
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.COMPLETED);

      // Vérifier mise à jour booking
      const updatedBooking = await Booking.findById(checkedInBooking._id);
      expect(updatedBooking.status).toBe(BOOKING_STATUS.COMPLETED);
      expect(updatedBooking.totalPrice).toBe(350); // 300 + 50 extras
      expect(updatedBooking.paymentStatus).toBe('Paid');

      // Vérifier chambre libérée
      const updatedRoom = await Room.findById(testRooms[1]._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.AVAILABLE);
      expect(updatedRoom.currentBooking).toBeNull();
    });

    test('Check-out avec chambre en maintenance', async () => {
      const response = await request(app)
        .put(`/api/bookings/${checkedInBooking._id}/checkout`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          roomCondition: [
            {
              roomId: testRooms[1]._id,
              condition: 'maintenance_required',
              notes: 'Climatisation défaillante'
            }
          ]
        })
        .expect(200);

      // Vérifier chambre marquée en maintenance
      const updatedRoom = await Room.findById(testRooms[1]._id);
      expect(updatedRoom.status).toBe(ROOM_STATUS.MAINTENANCE);
    });

    test('Échec check-out si pas checked-in', async () => {
      await Booking.findByIdAndUpdate(checkedInBooking._id, {
        status: BOOKING_STATUS.CONFIRMED
      });

      await request(app)
        .put(`/api/bookings/${checkedInBooking._id}/checkout`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({})
        .expect(400);
    });
  });

  // ================================
  // TESTS GESTION EXTRAS
  // ================================

  describe('POST /api/bookings/:id/extras - Add Extras', () => {
    let checkedInBooking;

    beforeEach(async () => {
      checkedInBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 300 }],
        numberOfGuests: 2,
        totalPrice: 300,
        status: BOOKING_STATUS.CHECKED_IN,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });
    });

    test('Staff peut ajouter extras', async () => {
      const response = await request(app)
        .post(`/api/bookings/${checkedInBooking._id}/extras`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          extras: [
            {
              name: 'Room Service',
              category: 'Restauration',
              price: 75,
              quantity: 1,
              description: 'Petit déjeuner en chambre'
            },
            {
              name: 'Blanchisserie',
              category: 'Services',
              price: 25,
              quantity: 2
            }
          ]
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totals.extrasAdded).toBe(125); // 75 + (25*2)
      expect(response.body.data.totals.newTotalPrice).toBe(425); // 300 + 125

      // Vérifier mise à jour en base
      const updatedBooking = await Booking.findById(checkedInBooking._id);
      expect(updatedBooking.extras).toHaveLength(2);
      expect(updatedBooking.extrasTotal).toBe(125);
      expect(updatedBooking.totalPrice).toBe(425);
    });

    test('Client ne peut pas ajouter extras', async () => {
      await request(app)
        .post(`/api/bookings/${checkedInBooking._id}/extras`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          extras: [{ name: 'Test', price: 10, quantity: 1 }]
        })
        .expect(403);
    });

    test('Validation prix extras', async () => {
      await request(app)
        .post(`/api/bookings/${checkedInBooking._id}/extras`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({
          extras: [
            { name: 'Invalid', price: -10, quantity: 1 }
          ]
        })
        .expect(400);
    });
  });

  // ================================
  // TESTS ANNULATION
  // ================================

  describe('PUT /api/bookings/:id/cancel - Cancel Booking', () => {
    let pendingBooking, confirmedBooking;

    beforeEach(async () => {
      pendingBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 48 * 60 * 60 * 1000), // Dans 2 jours
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 600 }],
        numberOfGuests: 2,
        totalPrice: 600,
        status: BOOKING_STATUS.PENDING,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      confirmedBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 12 * 60 * 60 * 1000), // Dans 12h
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 600 }],
        numberOfGuests: 2,
        totalPrice: 600,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id,
        confirmedBy: adminUser._id
      });
    });

    test('Client peut annuler sa réservation PENDING avec remboursement complet', async () => {
      const response = await request(app)
        .put(`/api/bookings/${pendingBooking._id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          reason: 'Changement de plans'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe(BOOKING_STATUS.CANCELLED);
      
      // Remboursement complet car >24h
      expect(response.body.data.cancellation.refundPolicy.refundPercentage).toBe(100);
      expect(response.body.data.cancellation.refundPolicy.refundAmount).toBe(600);

      // Vérifier mise à jour en base
      const cancelledBooking = await Booking.findById(pendingBooking._id);
      expect(cancelledBooking.status).toBe(BOOKING_STATUS.CANCELLED);
      expect(cancelledBooking.refundPercentage).toBe(100);
    });

    test('Annulation tardive avec pénalité', async () => {
      const response = await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          reason: 'Urgence familiale'
        })
        .expect(200);

      // Pénalité car <24h mais >12h
      expect(response.body.data.cancellation.refundPolicy.refundPercentage).toBe(50);
      expect(response.body.data.cancellation.refundPolicy.refundAmount).toBe(300);
      expect(response.body.data.cancellation.refundPolicy.cancellationFee).toBe(300);
    });

    test('Admin peut forcer remboursement personnalisé', async () => {
      const response = await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Geste commercial',
          refundAmount: 500,
          refundReason: 'Remboursement exceptionnel'
        })
        .expect(200);

      expect(response.body.data.cancellation.refundPolicy.refundAmount).toBe(500);
    });

    test('Client ne peut pas annuler réservation d\'un autre', async () => {
      // Créer booking d'un autre client
      const otherClient = await createTestUser({
        firstName: 'Other',
        lastName: 'Client',
        email: 'other2@test.com',
        role: USER_ROLES.CLIENT
      });

      const otherBooking = await Booking.create({
        hotel: testHotel._id,
        customer: otherClient._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Simple', basePrice: 200, calculatedPrice: 400 }],
        numberOfGuests: 1,
        totalPrice: 400,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: otherClient._id
      });

      await request(app)
        .put(`/api/bookings/${otherBooking._id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Test' })
        .expect(400);
    });

    test('Impossible d\'annuler booking COMPLETED', async () => {
      await Booking.findByIdAndUpdate(confirmedBooking._id, {
        status: BOOKING_STATUS.COMPLETED
      });

      await request(app)
        .put(`/api/bookings/${confirmedBooking._id}/cancel`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ reason: 'Test' })
        .expect(400);
    });
  });

  // ================================
  // TESTS FACTURES
  // ================================

  describe('GET /api/bookings/:id/invoice - Get Invoice', () => {
    let completedBooking;

    beforeEach(async () => {
      completedBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000), // Il y a 3 jours
        checkOutDate: new Date(Date.now() - 24 * 60 * 60 * 1000), // Hier
        actualCheckInDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
        actualCheckOutDate: new Date(Date.now() - 24 * 60 * 60 * 1000),
        rooms: [{ 
          type: 'Double', 
          basePrice: 300, 
          calculatedPrice: 600,
          room: testRooms[1]._id
        }],
        extras: [
          {
            name: 'Room Service',
            category: 'Restauration',
            price: 50,
            quantity: 1,
            total: 50,
            addedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
          }
        ],
        numberOfGuests: 2,
        totalPrice: 650, // 600 + 50 extras
        extrasTotal: 50,
        status: BOOKING_STATUS.COMPLETED,
        source: BOOKING_SOURCES.WEB,
        paymentStatus: 'Paid',
        createdBy: clientUser._id,
        checkedOutBy: receptionistUser._id
      });
    });

    test('Client peut voir sa facture', async () => {
      const response = await request(app)
        .get(`/api/bookings/${completedBooking._id}/invoice`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice).toHaveProperty('invoiceNumber');
      expect(response.body.data.invoice.customer.name).toBe('Client Test');
      expect(response.body.data.invoice.billing.total).toBe(650);
      expect(response.body.data.invoice.billing.rooms).toHaveLength(1);
      expect(response.body.data.invoice.billing.extras).toHaveLength(1);
    });

    test('Staff peut voir facture', async () => {
      const response = await request(app)
        .get(`/api/bookings/${completedBooking._id}/invoice`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice.booking.id).toBe(completedBooking._id.toString());
    });

    test('Facture non disponible si pas completed/checked-in', async () => {
      await Booking.findByIdAndUpdate(completedBooking._id, {
        status: BOOKING_STATUS.CONFIRMED
      });

      await request(app)
        .get(`/api/bookings/${completedBooking._id}/invoice`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(400);
    });
  });

  // ================================
  // TESTS STATISTIQUES
  // ================================

  describe('GET /api/bookings/stats/dashboard - Dashboard Stats', () => {
    beforeEach(async () => {
      // Créer plusieurs réservations pour statistiques
      const bookingsData = [
        {
          status: BOOKING_STATUS.CONFIRMED,
          totalPrice: 500,
          source: BOOKING_SOURCES.WEB,
          createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000)
        },
        {
          status: BOOKING_STATUS.COMPLETED,
          totalPrice: 800,
          source: BOOKING_SOURCES.MOBILE,
          createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
        },
        {
          status: BOOKING_STATUS.CANCELLED,
          totalPrice: 300,
          source: BOOKING_SOURCES.WEB,
          createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000)
        }
      ];

      for (const data of bookingsData) {
        await Booking.create({
          hotel: testHotel._id,
          customer: clientUser._id,
          checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          rooms: [{ type: 'Double', basePrice: 200, calculatedPrice: data.totalPrice }],
          numberOfGuests: 2,
          totalPrice: data.totalPrice,
          status: data.status,
          source: data.source,
          createdAt: data.createdAt,
          createdBy: clientUser._id
        });
      }
    });

    test('Admin peut voir stats globales', async () => {
      const response = await request(app)
        .get('/api/bookings/stats/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ period: '30d' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.overview).toHaveProperty('totalBookings');
      expect(response.body.data.overview).toHaveProperty('totalRevenue');
      expect(response.body.data.breakdown).toHaveProperty('byStatus');
      expect(response.body.data.breakdown).toHaveProperty('bySource');
      expect(response.body.data.insights).toHaveProperty('conversionRate');
    });

    test('Receptionist doit spécifier hotelId', async () => {
      await request(app)
        .get('/api/bookings/stats/dashboard')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(400);
    });

    test('Receptionist peut voir stats de son hôtel', async () => {
      const response = await request(app)
        .get('/api/bookings/stats/dashboard')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .query({ hotelId: testHotel._id })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.overview.totalBookings).toBeGreaterThan(0);
    });

    test('Client ne peut pas voir stats', async () => {
      await request(app)
        .get('/api/bookings/stats/dashboard')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });
  });

  // ================================
  // TESTS ROUTES SPÉCIALISÉES STAFF
  // ================================

  describe('GET /api/bookings/pending - Pending Bookings', () => {
    beforeEach(async () => {
      // Créer réservations en attente avec différents délais
      const pendingBookings = [
        { 
          createdAt: new Date(Date.now() - 50 * 60 * 60 * 1000), // 50h ago (urgent)
          status: BOOKING_STATUS.PENDING 
        },
        { 
          createdAt: new Date(Date.now() - 30 * 60 * 60 * 1000), // 30h ago (medium)
          status: BOOKING_STATUS.PENDING 
        },
        { 
          createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000), // 5h ago (normal)
          status: BOOKING_STATUS.PENDING 
        }
      ];

      for (const data of pendingBookings) {
        await Booking.create({
          hotel: testHotel._id,
          customer: clientUser._id,
          checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 600 }],
          numberOfGuests: 2,
          totalPrice: 600,
          status: data.status,
          source: BOOKING_SOURCES.WEB,
          createdAt: data.createdAt,
          createdBy: clientUser._id
        });
      }
    });

    test('Admin peut voir réservations en attente avec priorités', async () => {
      const response = await request(app)
        .get('/api/bookings/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pendingBookings).toHaveLength(3);
      
      // Vérifier calcul priorités
      const urgentBooking = response.body.data.pendingBookings.find(b => b.waitingTime.urgent);
      expect(urgentBooking).toBeDefined();
      expect(urgentBooking.waitingTime.priority).toBe('high');

      expect(response.body.data.summary.urgent).toBe(1);
      expect(response.body.data.summary.total).toBe(3);
    });

    test('Client ne peut pas voir pending bookings', async () => {
      await request(app)
        .get('/api/bookings/pending')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
    });
  });

  describe('GET /api/bookings/checkin-today - Today Check-ins', () => {
    beforeEach(async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: today,
        checkOutDate: new Date(today.getTime() + 2 * 24 * 60 * 60 * 1000),
        rooms: [{ 
          type: 'Double', 
          basePrice: 300, 
          calculatedPrice: 600,
          room: testRooms[1]._id, // Chambre assignée
          assignedAt: new Date(),
          assignedBy: adminUser._id
        }],
        numberOfGuests: 2,
        totalPrice: 600,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      // Booking sans chambre assignée
      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: today,
        checkOutDate: new Date(today.getTime() + 1 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Simple', basePrice: 200, calculatedPrice: 200 }],
        numberOfGuests: 1,
        totalPrice: 200,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.MOBILE,
        createdBy: clientUser._id
      });
    });

    test('Staff peut voir check-ins du jour avec statut préparation', async () => {
      const response = await request(app)
        .get('/api/bookings/checkin-today')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .query({ hotelId: testHotel._id })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.checkIns).toHaveLength(2);
      
      // Vérifier analyse préparation
      const readyBooking = response.body.data.checkIns.find(b => 
        b.preparationStatus.readyForCheckIn
      );
      expect(readyBooking).toBeDefined();
      expect(readyBooking.preparationStatus.roomsAssigned).toBe(1);

      expect(response.body.data.summary.ready).toBe(1);
      expect(response.body.data.summary.pending).toBe(1);
    });

    test('Receptionist doit spécifier hotelId', async () => {
      await request(app)
        .get('/api/bookings/checkin-today')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(400);
    });
  });

  // ================================
  // TESTS MODIFICATION RÉSERVATIONS
  // ================================

  describe('PUT /api/bookings/:id - Update Booking', () => {
    let pendingBooking, confirmedBooking;

    beforeEach(async () => {
      pendingBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Dans 7 jours
        checkOutDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // Dans 10 jours
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.PENDING,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      confirmedBooking = await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Suite', basePrice: 500, calculatedPrice: 1500 }],
        numberOfGuests: 2,
        totalPrice: 1500,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id,
        confirmedBy: adminUser._id
      });
    });

    test('Client peut modifier sa réservation PENDING', async () => {
      const newCheckIn = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      const newCheckOut = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);

      const response = await request(app)
        .put(`/api/bookings/${pendingBooking._id}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          newCheckInDate: newCheckIn,
          newCheckOutDate: newCheckOut,
          specialRequests: 'Chambre avec vue mer'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes.modifications).toContain('Date arrivée');
      expect(response.body.data.changes.modifications).toContain('Date départ');

      // Vérifier mise à jour en base
      const updatedBooking = await Booking.findById(pendingBooking._id);
      expect(updatedBooking.checkInDate.toDateString()).toBe(newCheckIn.toDateString());
      expect(updatedBooking.specialRequests).toBe('Chambre avec vue mer');
    });

    test('Admin peut modifier réservation CONFIRMED', async () => {
      const response = await request(app)
        .put(`/api/bookings/${confirmedBooking._id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          roomModifications: [
            { action: 'add', type: 'Double', quantity: 1 }
          ],
          guestNotes: 'Client VIP - attention spéciale'
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.changes.modifications).toContain('Nombre chambres');

      // Vérifier ajout chambre
      const updatedBooking = await Booking.findById(confirmedBooking._id);
      expect(updatedBooking.rooms).toHaveLength(2); // 1 Suite + 1 Double
      expect(updatedBooking.guestNotes).toBe('Client VIP - attention spéciale');
    });

    test('Client ne peut pas modifier réservation CONFIRMED', async () => {
      await request(app)
        .put(`/api/bookings/${confirmedBooking._id}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          newCheckInDate: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000)
        })
        .expect(400);
    });

    test('Échec modification si nouvelles dates non disponibles', async () => {
      // Créer booking conflictuel
      const conflictCheckIn = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
      const conflictCheckOut = new Date(Date.now() + 11 * 24 * 60 * 60 * 1000);

      await Booking.create({
        hotel: testHotel._id,
        customer: clientUser._id,
        checkInDate: conflictCheckIn,
        checkOutDate: conflictCheckOut,
        rooms: [{ type: 'Double', basePrice: 300, calculatedPrice: 900 }],
        numberOfGuests: 2,
        totalPrice: 900,
        status: BOOKING_STATUS.CONFIRMED,
        source: BOOKING_SOURCES.WEB,
        createdBy: clientUser._id
      });

      // Tenter modification vers dates conflictuelles
      await request(app)
        .put(`/api/bookings/${pendingBooking._id}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          newCheckInDate: conflictCheckIn,
          newCheckOutDate: conflictCheckOut
        })
        .expect(400);
    });
  });

  // ================================
  // TESTS EDGE CASES ET ERREURS
  // ================================

  describe('Edge Cases & Error Handling', () => {
    test('Gestion ID invalide', async () => {
      await request(app)
        .get('/api/bookings/invalid-id')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(400);
    });

    test('Booking inexistant', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      
      await request(app)
        .get(`/api/bookings/${fakeId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(404);
    });

    test('Rate limiting respecté', async () => {
      // Faire beaucoup de requêtes rapidement pour tester rate limiting
      const promises = Array(35).fill().map(() => 
        request(app)
          .get('/api/bookings')
          .set('Authorization', `Bearer ${clientToken}`)
      );

      const responses = await Promise.allSettled(promises);
      
      // Au moins une requête devrait être rate limitée
      const rateLimited = responses.some(result => 
        result.value?.status === 429
      );
      
      expect(rateLimited).toBe(true);
    });

    test('Validation données manquantes création', async () => {
      await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          // Données incomplètes
          hotelId: testHotel._id,
          checkInDate: new Date()
          // checkOutDate manquant
        })
        .expect(400);
    });

    test('Protection CSRF et injection', async () => {
      const maliciousData = {
        hotelId: testHotel._id,
        checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        rooms: [{ type: 'Double', quantity: 1 }],
        numberOfGuests: 2,
        specialRequests: '<script>alert("XSS")</script>',
        '$where': 'this.password.length > 0' // NoSQL injection attempt
      };

      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(maliciousData)
        .expect(201);

      // Vérifier que le script est sanitisé
      const booking = await Booking.findById(response.body.data.booking._id);
      expect(booking.specialRequests).not.toContain('<script>');
      expect(booking).not.toHaveProperty('$where');
    });
  });

  // ================================
  // TESTS PERFORMANCE
  // ================================

  describe('Performance Tests', () => {
    test('Temps réponse création réservation < 2s', async () => {
      const startTime = Date.now();

      await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({
          hotelId: testHotel._id,
          checkInDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
          checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          rooms: [{ type: 'Double', quantity: 1 }],
          numberOfGuests: 2
        })
        .expect(201);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(2000); // < 2 secondes
    });

    test('Pagination performance avec beaucoup de réservations', async () => {
      // Créer 50 réservations
      const bookingPromises = Array(50).fill().map((_, index) => 
        Booking.create({
          hotel: testHotel._id,
          customer: clientUser._id,
          checkInDate: new Date(Date.now() + (index + 1) * 24 * 60 * 60 * 1000),
          checkOutDate: new Date(Date.now() + (index + 3) * 24 * 60 * 60 * 1000),
          rooms: [{ type: 'Simple', basePrice: 200, calculatedPrice: 400 }],
          numberOfGuests: 1,
          totalPrice: 400,
          status: BOOKING_STATUS.PENDING,
          source: BOOKING_SOURCES.WEB,
          createdBy: clientUser._id
        })
      );

      await Promise.all(bookingPromises);

      const startTime = Date.now();

      const response = await request(app)
        .get('/api/bookings')
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ page: 1, limit: 20 })
        .expect(200);

      const responseTime = Date.now() - startTime;
      expect(responseTime).toBeLessThan(1000); // < 1 seconde
      expect(response.body.data.bookings).toHaveLength(20);
      expect(response.body.data.pagination.totalCount).toBeGreaterThan(50);
    });
  });
});