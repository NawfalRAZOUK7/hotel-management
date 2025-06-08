/**
 * INTEGRATION TEST - BOOKING COMPLETE FLOW
 * Test end-to-end du workflow complet de réservation
 * 
 * Scénario testé :
 * 1. Création hôtel + chambres (Admin)
 * 2. Création réservation (Client) → PENDING
 * 3. Validation réservation (Admin) → CONFIRMED
 * 4. Check-in avec attribution chambres (Receptionist) → CHECKED_IN
 * 5. Ajout extras/consommations (Receptionist)
 * 6. Check-out avec facture (Receptionist) → COMPLETED
 * 7. Vérification facture + libération chambres
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../src/app');
const { setupTestDatabase, cleanupTestDatabase } = require('../setup/test-database');
const { 
  createTestUser, 
  generateValidToken,
  createTestHotel,
  createTestRoom,
  waitForAsync
} = require('../setup/test-helpers');

const User = require('../../src/models/User');
const Hotel = require('../../src/models/Hotel');
const Room = require('../../src/models/Room');
const Booking = require('../../src/models/Booking');

describe('Booking Complete Flow Integration', () => {
  let adminUser, clientUser, receptionistUser;
  let adminToken, clientToken, receptionistToken;
  let testHotel, testRooms;
  let bookingId;

  beforeAll(async () => {
    await setupTestDatabase();
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    // Nettoyer les collections
    await User.deleteMany({});
    await Hotel.deleteMany({});
    await Room.deleteMany({});
    await Booking.deleteMany({});

    // ================================
    // SETUP UTILISATEURS TEST
    // ================================
    
    // Admin
    adminUser = await createTestUser({
      firstName: 'Admin',
      lastName: 'Système',
      email: 'admin@hotel-test.ma',
      role: 'ADMIN'
    });
    adminToken = generateValidToken(adminUser);

    // Client
    clientUser = await createTestUser({
      firstName: 'Ahmed',
      lastName: 'Bennani',
      email: 'ahmed@client-test.ma',
      phone: '+212612345678',
      role: 'CLIENT'
    });
    clientToken = generateValidToken(clientUser);

    // Receptionist
    receptionistUser = await createTestUser({
      firstName: 'Fatima',
      lastName: 'Alaoui',
      email: 'fatima@hotel-test.ma',
      role: 'RECEPTIONIST'
    });
    receptionistToken = generateValidToken(receptionistUser);
  });

  describe('🏨 ÉTAPE 1: Setup Hôtel et Chambres', () => {
    test('Admin crée hôtel avec succès', async () => {
      const hotelData = {
        code: 'RAB001',
        name: 'Hôtel Test Rabat',
        address: 'Avenue Mohammed V',
        city: 'Rabat',
        postalCode: '10000',
        phone: '+212537123456',
        email: 'contact@hotel-test.ma',
        category: 4,
        description: 'Hôtel test pour intégration'
      };

      const response = await request(app)
        .post('/api/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(hotelData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.hotel.code).toBe('RAB001');
      expect(response.body.data.hotel.name).toBe('Hôtel Test Rabat');

      testHotel = response.body.data.hotel;
    });

    test('Admin crée chambres variées', async () => {
      const roomsData = [
        {
          number: '201',
          type: 'Double',
          floor: 2,
          basePrice: 300,
          description: 'Chambre double standard'
        },
        {
          number: '202',
          type: 'Double',
          floor: 2,
          basePrice: 300,
          description: 'Chambre double standard'
        },
        {
          number: '301',
          type: 'Suite',
          floor: 3,
          basePrice: 600,
          description: 'Suite luxueuse'
        }
      ];

      testRooms = [];
      
      for (const roomData of roomsData) {
        const response = await request(app)
          .post(`/api/hotels/${testHotel._id}/rooms`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send(roomData)
          .expect(201);

        expect(response.body.success).toBe(true);
        testRooms.push(response.body.data.room);
      }

      expect(testRooms).toHaveLength(3);
      expect(testRooms[0].type).toBe('Double');
      expect(testRooms[2].type).toBe('Suite');
    });
  });

  describe('📋 ÉTAPE 2: Création Réservation Client', () => {
    test('Client crée réservation multi-chambres', async () => {
      const bookingData = {
        hotelId: testHotel._id,
        checkInDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // +7 jours
        checkOutDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // +10 jours
        rooms: [
          { type: 'Double', quantity: 2 }, // 2 chambres Double
          { type: 'Suite', quantity: 1 }   // 1 Suite
        ],
        numberOfGuests: 6,
        specialRequests: 'Chambres adjacentes si possible',
        source: 'WEB'
      };

      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send(bookingData)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe('Pending');
      expect(response.body.data.booking.rooms).toHaveLength(3); // 2 + 1
      expect(response.body.data.booking.customer).toBe(clientUser._id.toString());
      expect(response.body.data.pricing.totalPrice).toBeGreaterThan(0);

      bookingId = response.body.data.booking._id;

      // Vérifier calcul prix automatique (3 nuits × chambres)
      const expectedMinPrice = (300 * 2 + 600) * 3; // Base sans multiplicateurs
      expect(response.body.data.pricing.totalPrice).toBeGreaterThanOrEqual(expectedMinPrice);
    });

    test('Vérification statut PENDING nécessite validation', async () => {
      const response = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.data.booking.status).toBe('Pending');
      expect(response.body.data.availableActions).toContain('cancel');
      expect(response.body.data.availableActions).toContain('modify');
    });

    test('Chambres non encore assignées', async () => {
      const booking = await Booking.findById(bookingId);
      booking.rooms.forEach(room => {
        expect(room.room).toBeNull(); // Pas encore assignées
        expect(room.assignedAt).toBeNull();
      });
    });
  });

  describe('✅ ÉTAPE 3: Validation Admin', () => {
    test('Admin peut voir réservations en attente', async () => {
      const response = await request(app)
        .get('/api/bookings/pending')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pendingBookings).toHaveLength(1);
      expect(response.body.data.pendingBookings[0]._id).toBe(bookingId);
    });

    test('Admin valide la réservation → CONFIRMED', async () => {
      const validationData = {
        action: 'approve',
        reason: 'Réservation validée - disponibilité confirmée'
      };

      const response = await request(app)
        .put(`/api/bookings/${bookingId}/validate`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(validationData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe('Confirmed');
      expect(response.body.data.action).toBe('approve');

      // Vérifier en base
      const updatedBooking = await Booking.findById(bookingId);
      expect(updatedBooking.status).toBe('Confirmed');
      expect(updatedBooking.confirmedBy.toString()).toBe(adminUser._id.toString());
      expect(updatedBooking.confirmedAt).toBeDefined();
      expect(updatedBooking.statusHistory).toHaveLength(1);
    });

    test('Client ne peut plus modifier après confirmation', async () => {
      const response = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.data.booking.status).toBe('Confirmed');
      expect(response.body.data.availableActions).not.toContain('modify');
      expect(response.body.data.availableActions).toContain('cancel'); // Encore possible
    });
  });

  describe('🏨 ÉTAPE 4: Check-in Receptionist', () => {
    test('Receptionist peut voir check-ins du jour', async () => {
      // Modifier dates pour aujourd'hui
      await Booking.findByIdAndUpdate(bookingId, {
        checkInDate: new Date(),
        checkOutDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      });

      const response = await request(app)
        .get(`/api/bookings/checkin-today?hotelId=${testHotel._id}`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.checkIns).toHaveLength(1);
      expect(response.body.data.checkIns[0]._id).toBe(bookingId);
      expect(response.body.data.checkIns[0].preparationStatus.readyForCheckIn).toBe(false); // Pas encore assigné
    });

    test('Attribution automatique des chambres', async () => {
      const assignmentData = {
        bookingId,
        preferences: {
          preferredFloor: 2,
          adjacentRooms: true
        }
      };

      const response = await request(app)
        .post('/api/rooms/auto-assign')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(assignmentData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.assignments).toHaveLength(3);
      expect(response.body.data.readyForCheckIn).toBe(true);

      // Vérifier assignation en base
      const updatedBooking = await Booking.findById(bookingId);
      const assignedRooms = updatedBooking.rooms.filter(r => r.room);
      expect(assignedRooms).toHaveLength(3);

      // Vérifier statuts chambres → OCCUPIED
      const occupiedRooms = await Room.find({ 
        _id: { $in: assignedRooms.map(r => r.room) },
        status: 'Occupied'
      });
      expect(occupiedRooms).toHaveLength(3);
    });

    test('Check-in effectué → CHECKED_IN', async () => {
      const checkInData = {
        actualCheckInTime: new Date(),
        guestNotes: 'Client arrivé à l\'heure, demande late checkout',
        specialServices: ['Late checkout', 'Room service']
      };

      const response = await request(app)
        .put(`/api/bookings/${bookingId}/checkin`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(checkInData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe('Checked-in');
      expect(response.body.data.booking.assignedRooms).toHaveLength(3);

      // Vérifier en base
      const checkedInBooking = await Booking.findById(bookingId);
      expect(checkedInBooking.status).toBe('Checked-in');
      expect(checkedInBooking.actualCheckInDate).toBeDefined();
      expect(checkedInBooking.checkedInBy.toString()).toBe(receptionistUser._id.toString());
      expect(checkedInBooking.guestNotes).toBe('Client arrivé à l\'heure, demande late checkout');
      expect(checkedInBooking.specialServices).toContain('Late checkout');
    });
  });

  describe('🍽️ ÉTAPE 5: Ajout Extras/Consommations', () => {
    test('Receptionist ajoute consommations mini-bar', async () => {
      const extrasData = {
        extras: [
          {
            name: 'Mini-bar Suite',
            category: 'Boissons',
            price: 180,
            quantity: 1,
            description: 'Consommation mini-bar chambre 301'
          },
          {
            name: 'Room Service Breakfast',
            category: 'Restauration',
            price: 120,
            quantity: 2,
            description: 'Petit-déjeuner en chambre'
          },
          {
            name: 'Blanchisserie Express',
            category: 'Services',
            price: 80,
            quantity: 1,
            description: 'Service pressing 24h'
          }
        ]
      };

      const response = await request(app)
        .post(`/api/bookings/${bookingId}/extras`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(extrasData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.addedExtras).toHaveLength(3);
      
      const totalExtrasAdded = 180 + (120 * 2) + 80; // 500 MAD
      expect(response.body.data.totals.extrasAdded).toBe(totalExtrasAdded);
      expect(response.body.data.totals.newTotalPrice).toBeGreaterThan(totalExtrasAdded);

      // Vérifier en base
      const bookingWithExtras = await Booking.findById(bookingId);
      expect(bookingWithExtras.extras).toHaveLength(3);
      expect(bookingWithExtras.extrasTotal).toBe(totalExtrasAdded);
    });

    test('Client peut voir ses extras', async () => {
      const response = await request(app)
        .get(`/api/bookings/${bookingId}/extras`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.extras).toHaveLength(3);
      expect(response.body.data.extrasByCategory).toHaveProperty('Boissons');
      expect(response.body.data.extrasByCategory).toHaveProperty('Restauration');
      expect(response.body.data.extrasByCategory).toHaveProperty('Services');
      expect(response.body.data.summary.totalAmount).toBe(500);
    });
  });

  describe('🏁 ÉTAPE 6: Check-out et Facture', () => {
    test('Check-out avec extras finaux → COMPLETED', async () => {
      const checkOutData = {
        actualCheckOutTime: new Date(),
        finalExtras: [
          {
            name: 'Parking Supplémentaire',
            category: 'Services',
            price: 50,
            quantity: 3,
            description: 'Parking 3 nuits supplémentaires'
          }
        ],
        roomCondition: [
          {
            roomId: testRooms[0]._id,
            condition: 'good',
            notes: 'Chambre en bon état'
          },
          {
            roomId: testRooms[1]._id,
            condition: 'good',
            notes: 'Chambre en bon état'
          },
          {
            roomId: testRooms[2]._id,
            condition: 'maintenance_required',
            notes: 'Climatisation à vérifier'
          }
        ],
        paymentStatus: 'Paid',
        generateInvoice: true
      };

      const response = await request(app)
        .put(`/api/bookings/${bookingId}/checkout`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send(checkOutData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.booking.status).toBe('Completed');
      expect(response.body.data.booking.paymentStatus).toBe('Paid');
      expect(response.body.data.releasedRooms).toHaveLength(3);

      // Vérifier extras finaux ajoutés
      const finalTotal = 500 + (50 * 3); // 650 MAD extras
      expect(response.body.data.summary.extrasTotal).toBe(finalTotal);

      // Vérifier en base
      const completedBooking = await Booking.findById(bookingId);
      expect(completedBooking.status).toBe('Completed');
      expect(completedBooking.actualCheckOutDate).toBeDefined();
      expect(completedBooking.checkedOutBy.toString()).toBe(receptionistUser._id.toString());
      expect(completedBooking.paymentStatus).toBe('Paid');
      expect(completedBooking.extras).toHaveLength(4); // 3 précédents + 1 final
    });

    test('Vérification libération chambres avec statuts corrects', async () => {
      // Récupérer les chambres assignées
      const booking = await Booking.findById(bookingId).populate('rooms.room');
      const roomIds = booking.rooms.map(r => r.room._id);

      const rooms = await Room.find({ _id: { $in: roomIds } });

      // 2 chambres → Available, 1 → Maintenance
      const availableRooms = rooms.filter(r => r.status === 'Available');
      const maintenanceRooms = rooms.filter(r => r.status === 'Maintenance');

      expect(availableRooms).toHaveLength(2);
      expect(maintenanceRooms).toHaveLength(1);

      // Vérifier currentBooking effacé
      rooms.forEach(room => {
        expect(room.currentBooking).toBeNull();
        expect(room.lastCheckOut).toBeDefined();
      });
    });
  });

  describe('🧾 ÉTAPE 7: Génération et Vérification Facture', () => {
    test('Génération facture automatique', async () => {
      const response = await request(app)
        .get(`/api/bookings/${bookingId}/invoice`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.invoice).toBeDefined();

      const invoice = response.body.data.invoice;
      
      // Vérifier structure facture
      expect(invoice.invoice.number).toMatch(/^\d{4}-\d{2}-\d{4}$/); // Format YYYY-MM-XXXX
      expect(invoice.customer.name).toBe('Ahmed Bennani');
      expect(invoice.stay.nightsActual).toBe(3);
      expect(invoice.billing.rooms).toHaveLength(3);
      expect(invoice.billing.extras).toHaveLength(4);
      
      // Vérifier calculs
      expect(invoice.billing.extrasSubtotal).toBe(650); // Total extras
      expect(invoice.billing.total).toBeGreaterThan(650); // Chambres + extras
      expect(invoice.payment.status).toBe('Paid');
    });

    test('Envoi facture par email', async () => {
      const emailData = {
        email: 'ahmed@client-test.ma',
        subject: 'Facture séjour Hôtel Test Rabat',
        message: 'Merci pour votre séjour. Voici votre facture.'
      };

      const response = await request(app)
        .post(`/api/bookings/${bookingId}/invoice/email`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send(emailData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.sentTo).toBe('ahmed@client-test.ma');
      expect(response.body.data.sentBy).toBe(clientUser._id.toString());
    });
  });

  describe('📊 ÉTAPE 8: Vérifications Finales et Statistiques', () => {
    test('Workflow historique complet enregistré', async () => {
      const finalBooking = await Booking.findById(bookingId);
      
      // Vérifier historique complet des statuts
      expect(finalBooking.statusHistory).toHaveLength(3);
      
      const [pendingToConfirmed, confirmedToCheckedIn, checkedInToCompleted] = finalBooking.statusHistory;
      
      expect(pendingToConfirmed.previousStatus).toBe('Pending');
      expect(pendingToConfirmed.newStatus).toBe('Confirmed');
      expect(pendingToConfirmed.changedBy.toString()).toBe(adminUser._id.toString());
      
      expect(confirmedToCheckedIn.previousStatus).toBe('Confirmed');
      expect(confirmedToCheckedIn.newStatus).toBe('Checked-in');
      expect(confirmedToCheckedIn.changedBy.toString()).toBe(receptionistUser._id.toString());
      
      expect(checkedInToCompleted.previousStatus).toBe('Checked-in');
      expect(checkedInToCompleted.newStatus).toBe('Completed');
      expect(checkedInToCompleted.changedBy.toString()).toBe(receptionistUser._id.toString());
    });

    test('Statistiques hôtel mises à jour', async () => {
      const response = await request(app)
        .get(`/api/hotels/${testHotel._id}/stats?period=7d`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.stats.summary.totalBookings).toBe(1);
      expect(response.body.data.stats.summary.totalRevenue).toBeGreaterThan(0);
    });

    test('Statistiques réservations dashboard', async () => {
      const response = await request(app)
        .get(`/api/bookings/stats/dashboard?hotelId=${testHotel._id}&period=7d`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      
      const stats = response.body.data;
      expect(stats.overview.totalBookings).toBe(1);
      expect(stats.breakdown.byStatus.Completed.count).toBe(1);
      expect(stats.breakdown.bySource.Web.count).toBe(1);
      expect(stats.insights.completionRate).toBe(100); // 1 complétée sur 1
    });

    test('Toutes les actions finales interdites', async () => {
      const response = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.data.booking.status).toBe('Completed');
      expect(response.body.data.availableActions).toContain('view_invoice');
      expect(response.body.data.availableActions).not.toContain('cancel');
      expect(response.body.data.availableActions).not.toContain('modify');
    });
  });

  describe('🚨 TESTS EDGE CASES ET SÉCURITÉ', () => {
    test('Client ne peut pas voir autres réservations', async () => {
      // Créer un autre client
      const otherClient = await createTestUser({
        firstName: 'Youssef',
        lastName: 'Alami',
        email: 'youssef@test.ma',
        role: 'CLIENT'
      });
      const otherClientToken = generateValidToken(otherClient);

      const response = await request(app)
        .get(`/api/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${otherClientToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('non trouvée ou accès non autorisé');
    });

    test('Receptionist sans hôtel ne peut pas voir check-ins', async () => {
      const response = await request(app)
        .get('/api/bookings/checkin-today')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('ID hôtel requis');
    });

    test('Impossible de check-in une réservation déjà complétée', async () => {
      const response = await request(app)
        .put(`/api/bookings/${bookingId}/checkin`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ actualCheckInTime: new Date() })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Check-in impossible');
    });

    test('Validation intégrité données finales', async () => {
      // Vérifier cohérence complète
      const booking = await Booking.findById(bookingId)
        .populate('hotel')
        .populate('customer')
        .populate('rooms.room');

      // Cohérence utilisateurs
      expect(booking.customer._id.toString()).toBe(clientUser._id.toString());
      expect(booking.confirmedBy.toString()).toBe(adminUser._id.toString());
      expect(booking.checkedInBy.toString()).toBe(receptionistUser._id.toString());
      expect(booking.checkedOutBy.toString()).toBe(receptionistUser._id.toString());

      // Cohérence dates
      expect(booking.actualCheckInDate).toBeDefined();
      expect(booking.actualCheckOutDate).toBeDefined();
      expect(booking.actualCheckOutDate > booking.actualCheckInDate).toBe(true);

      // Cohérence financière
      expect(booking.totalPrice).toBeGreaterThan(0);
      expect(booking.extrasTotal).toBe(650);
      expect(booking.extras).toHaveLength(4);

      // Cohérence chambres
      expect(booking.rooms).toHaveLength(3);
      booking.rooms.forEach(room => {
        expect(room.room).toBeDefined();
        expect(room.assignedAt).toBeDefined();
        expect(room.assignedBy.toString()).toBe(receptionistUser._id.toString());
      });
    });
  });
});

/**
 * ================================
 * HELPERS SPÉCIFIQUES AU TEST
 * ================================
 */

/**
 * Vérifie la cohérence complète du système après workflow
 */
const verifySystemIntegrity = async (bookingId, expectedStatus) => {
  const booking = await Booking.findById(bookingId)
    .populate('rooms.room');

  // Vérifier statut booking
  expect(booking.status).toBe(expectedStatus);

  // Vérifier cohérence chambres selon statut
  if (expectedStatus === 'Checked-in') {
    const roomIds = booking.rooms.map(r => r.room._id);
    const rooms = await Room.find({ _id: { $in: roomIds } });
    rooms.forEach(room => {
      expect(room.status).toBe('Occupied');
      expect(room.currentBooking.toString()).toBe(bookingId);
    });
  } else if (expectedStatus === 'Completed') {
    const roomIds = booking.rooms.map(r => r.room._id);
    const rooms = await Room.find({ _id: { $in: roomIds } });
    rooms.forEach(room => {
      expect(['Available', 'Maintenance']).toContain(room.status);
      expect(room.currentBooking).toBeNull();
    });
  }

  return booking;
};