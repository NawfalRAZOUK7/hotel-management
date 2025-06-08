const request = require('supertest');
const express = require('express');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createUserWithRole,
  generateTestToken,
  createAuthHeaders,
  authenticatedRequest,
  testRoleAccess,
  createTestHotelWithRooms,
  createTestBooking
} = require('../setup/test-helpers');

// Middleware to test
const authMiddleware = require('../../middleware/auth');

// Create test app with routes
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Public route (no auth required)
  app.get('/api/public', (req, res) => {
    res.json({ success: true, message: 'Public access' });
  });

  // CLIENT routes
  app.get('/api/client/profile', 
    authMiddleware.clientRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Client profile access',
        user: req.user
      });
    }
  );

  app.get('/api/client/bookings',
    authMiddleware.clientRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Client bookings access',
        userId: req.user.userId 
      });
    }
  );

  // RECEPTIONIST routes
  app.get('/api/reception/dashboard',
    authMiddleware.receptionistRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Reception dashboard access',
        role: req.user.role 
      });
    }
  );

  app.post('/api/reception/checkin',
    authMiddleware.receptionistRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Check-in access',
        performedBy: req.user.userId 
      });
    }
  );

  app.put('/api/reception/booking/:id/status',
    authMiddleware.receptionistRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Booking status update access',
        bookingId: req.params.id 
      });
    }
  );

  // ADMIN routes
  app.get('/api/admin/dashboard',
    authMiddleware.adminRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Admin dashboard access',
        role: req.user.role 
      });
    }
  );

  app.post('/api/admin/hotels',
    authMiddleware.adminRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Hotel creation access',
        createdBy: req.user.userId 
      });
    }
  );

  app.delete('/api/admin/users/:id',
    authMiddleware.adminRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'User deletion access',
        targetUserId: req.params.id 
      });
    }
  );

  app.get('/api/admin/stats',
    authMiddleware.adminRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Statistics access',
        role: req.user.role 
      });
    }
  );

  // Mixed role routes
  app.get('/api/staff/notifications',
    authMiddleware.authorizeRoles('RECEPTIONIST', 'ADMIN'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Staff notifications access',
        role: req.user.role 
      });
    }
  );

  app.put('/api/users/profile',
    authMiddleware.authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Profile update access',
        userId: req.user.userId 
      });
    }
  );

  // Resource ownership routes
  app.get('/api/users/:userId/bookings',
    authMiddleware.authenticateToken,
    authMiddleware.requireOwnership('userId'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'User bookings access',
        userId: req.params.userId 
      });
    }
  );

  app.put('/api/users/:userId/preferences',
    authMiddleware.authenticateToken,
    authMiddleware.requireOwnership('userId'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'User preferences update',
        userId: req.params.userId 
      });
    }
  );

  // Email verification required routes
  app.post('/api/bookings',
    authMiddleware.verifiedUserRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Booking creation access',
        userVerified: req.user.isEmailVerified 
      });
    }
  );

  app.post('/api/reviews',
    authMiddleware.verifiedUserRequired,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Review creation access',
        userId: req.user.userId 
      });
    }
  );

  // Custom permissions route
  app.get('/api/sensitive-data',
    authMiddleware.authenticateToken,
    authMiddleware.requirePermission(async (user, req) => {
      // Custom permission: only admin or verified users with specific role
      return user.role === 'ADMIN' || 
             (user.isEmailVerified && user.role === 'RECEPTIONIST');
    }),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Sensitive data access',
        role: req.user.role 
      });
    }
  );

  return app;
};

describe('Role Authorization Tests', () => {
  let app;
  let adminUser, receptionistUser, clientUser, inactiveUser, unverifiedUser;
  let adminToken, receptionistToken, clientToken, inactiveToken, unverifiedToken;

  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  beforeEach(async () => {
    // Create test app
    app = createTestApp();

    // Create users with different roles
    adminUser = await createUserWithRole('ADMIN');
    receptionistUser = await createUserWithRole('RECEPTIONIST');
    clientUser = await createUserWithRole('CLIENT');
    
    // Create inactive user
    inactiveUser = await createUserWithRole('CLIENT');
    inactiveUser.isActive = false;
    await inactiveUser.save();

    // Create unverified user
    unverifiedUser = await createUserWithRole('CLIENT');
    unverifiedUser.isEmailVerified = false;
    await unverifiedUser.save();

    // Generate tokens
    adminToken = generateTestToken(adminUser);
    receptionistToken = generateTestToken(receptionistUser);
    clientToken = generateTestToken(clientUser);
    inactiveToken = generateTestToken(inactiveUser);
    unverifiedToken = generateTestToken(unverifiedUser);
  });

  // ============================================================================
  // PUBLIC ROUTES TESTS
  // ============================================================================

  describe('Public Routes', () => {
    test('should allow access to public routes without authentication', async () => {
      const response = await request(app)
        .get('/api/public')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Public access');
    });

    test('should allow access to public routes with any token', async () => {
      const response = await request(app)
        .get('/api/public')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
    });
  });

  // ============================================================================
  // CLIENT ROLE TESTS
  // ============================================================================

  describe('Client Role Access', () => {
    test('should allow CLIENT access to client routes', async () => {
      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Client profile access');
      expect(response.body.user.role).toBe('CLIENT');
    });

    test('should allow CLIENT access to client bookings', async () => {
      const response = await request(app)
        .get('/api/client/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBe(clientUser._id.toString());
    });

    test('should deny CLIENT access to receptionist routes', async () => {
      const response = await request(app)
        .get('/api/reception/dashboard')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Permissions insuffisantes');
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.current).toBe('CLIENT');
      expect(response.body.required).toContain('RECEPTIONIST');
    });

    test('should deny CLIENT access to admin routes', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.current).toBe('CLIENT');
      expect(response.body.required).toContain('ADMIN');
    });
  });

  // ============================================================================
  // RECEPTIONIST ROLE TESTS
  // ============================================================================

  describe('Receptionist Role Access', () => {
    test('should allow RECEPTIONIST access to reception routes', async () => {
      const response = await request(app)
        .get('/api/reception/dashboard')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Reception dashboard access');
      expect(response.body.role).toBe('RECEPTIONIST');
    });

    test('should allow RECEPTIONIST to perform check-in', async () => {
      const response = await request(app)
        .post('/api/reception/checkin')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ bookingId: 'test-booking-id' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.performedBy).toBe(receptionistUser._id.toString());
    });

    test('should allow RECEPTIONIST to update booking status', async () => {
      const bookingId = 'test-booking-123';
      const response = await request(app)
        .put(`/api/reception/booking/${bookingId}/status`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ status: 'CHECKED_IN' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.bookingId).toBe(bookingId);
    });

    test('should allow RECEPTIONIST access to client routes (inheritance)', async () => {
      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.user.role).toBe('RECEPTIONIST');
    });

    test('should deny RECEPTIONIST access to admin routes', async () => {
      const response = await request(app)
        .delete('/api/admin/users/test-user-id')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.current).toBe('RECEPTIONIST');
    });
  });

  // ============================================================================
  // ADMIN ROLE TESTS
  // ============================================================================

  describe('Admin Role Access', () => {
    test('should allow ADMIN access to admin routes', async () => {
      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Admin dashboard access');
      expect(response.body.role).toBe('ADMIN');
    });

    test('should allow ADMIN to create hotels', async () => {
      const response = await request(app)
        .post('/api/admin/hotels')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Test Hotel', city: 'Paris' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.createdBy).toBe(adminUser._id.toString());
    });

    test('should allow ADMIN to delete users', async () => {
      const targetUserId = 'user-to-delete-123';
      const response = await request(app)
        .delete(`/api/admin/users/${targetUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.targetUserId).toBe(targetUserId);
    });

    test('should allow ADMIN access to statistics', async () => {
      const response = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.role).toBe('ADMIN');
    });

    test('should allow ADMIN access to all lower-level routes', async () => {
      // Test client route access
      const clientResponse = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(clientResponse.body.user.role).toBe('ADMIN');

      // Test receptionist route access
      const receptionResponse = await request(app)
        .get('/api/reception/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(receptionResponse.body.role).toBe('ADMIN');
    });
  });

  // ============================================================================
  // MIXED ROLE TESTS
  // ============================================================================

  describe('Mixed Role Access', () => {
    test('should allow RECEPTIONIST and ADMIN access to staff routes', async () => {
      // Receptionist access
      const receptionResponse = await request(app)
        .get('/api/staff/notifications')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(200);
      expect(receptionResponse.body.role).toBe('RECEPTIONIST');

      // Admin access
      const adminResponse = await request(app)
        .get('/api/staff/notifications')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminResponse.body.role).toBe('ADMIN');
    });

    test('should deny CLIENT access to staff routes', async () => {
      const response = await request(app)
        .get('/api/staff/notifications')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.current).toBe('CLIENT');
      expect(response.body.required).toEqual(['RECEPTIONIST', 'ADMIN']);
    });

    test('should allow all roles to update their profile', async () => {
      // Client access
      const clientResponse = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ firstName: 'Updated' })
        .expect(200);
      expect(clientResponse.body.success).toBe(true);

      // Receptionist access
      const receptionResponse = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ firstName: 'Updated' })
        .expect(200);
      expect(receptionResponse.body.success).toBe(true);

      // Admin access
      const adminResponse = await request(app)
        .put('/api/users/profile')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ firstName: 'Updated' })
        .expect(200);
      expect(adminResponse.body.success).toBe(true);
    });
  });

  // ============================================================================
  // RESOURCE OWNERSHIP TESTS
  // ============================================================================

  describe('Resource Ownership', () => {
    test('should allow users to access their own resources', async () => {
      const response = await request(app)
        .get(`/api/users/${clientUser._id}/bookings`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBe(clientUser._id.toString());
    });

    test('should deny users access to other users resources', async () => {
      const response = await request(app)
        .get(`/api/users/${receptionistUser._id}/bookings`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('RESOURCE_ACCESS_DENIED');
      expect(response.body.message).toBe('Accès non autorisé à cette ressource');
    });

    test('should allow ADMIN to access any user resources', async () => {
      const response = await request(app)
        .get(`/api/users/${clientUser._id}/bookings`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBe(clientUser._id.toString());
    });

    test('should allow users to update their own preferences', async () => {
      const response = await request(app)
        .put(`/api/users/${clientUser._id}/preferences`)
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ language: 'fr', notifications: true })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBe(clientUser._id.toString());
    });

    test('should handle invalid user ID parameter', async () => {
      const response = await request(app)
        .get('/api/users/invalid-id/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('RESOURCE_ACCESS_DENIED');
    });
  });

  // ============================================================================
  // EMAIL VERIFICATION TESTS
  // ============================================================================

  describe('Email Verification Requirements', () => {
    test('should allow verified users to create bookings', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ hotelId: 'test-hotel', dates: ['2025-06-01', '2025-06-02'] })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userVerified).toBe(true);
    });

    test('should deny unverified users from creating bookings', async () => {
      const response = await request(app)
        .post('/api/bookings')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send({ hotelId: 'test-hotel', dates: ['2025-06-01', '2025-06-02'] })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(response.body.message).toBe('Vérification d\'email requise');
      expect(response.body.actions).toHaveProperty('resendVerification');
    });

    test('should allow verified users to create reviews', async () => {
      const response = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ hotelId: 'test-hotel', rating: 5, comment: 'Great!' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.userId).toBe(clientUser._id.toString());
    });

    test('should deny unverified users from creating reviews', async () => {
      const response = await request(app)
        .post('/api/reviews')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .send({ hotelId: 'test-hotel', rating: 5, comment: 'Great!' })
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    });
  });

  // ============================================================================
  // CUSTOM PERMISSIONS TESTS
  // ============================================================================

  describe('Custom Permissions', () => {
    test('should allow ADMIN access to sensitive data', async () => {
      const response = await request(app)
        .get('/api/sensitive-data')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.role).toBe('ADMIN');
    });

    test('should allow verified RECEPTIONIST access to sensitive data', async () => {
      // Ensure receptionist is verified
      receptionistUser.isEmailVerified = true;
      await receptionistUser.save();
      const newReceptionistToken = generateTestToken(receptionistUser);

      const response = await request(app)
        .get('/api/sensitive-data')
        .set('Authorization', `Bearer ${newReceptionistToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.role).toBe('RECEPTIONIST');
    });

    test('should deny unverified RECEPTIONIST access to sensitive data', async () => {
      // Ensure receptionist is not verified
      receptionistUser.isEmailVerified = false;
      await receptionistUser.save();
      const newReceptionistToken = generateTestToken(receptionistUser);

      const response = await request(app)
        .get('/api/sensitive-data')
        .set('Authorization', `Bearer ${newReceptionistToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('CUSTOM_PERMISSION_DENIED');
    });

    test('should deny CLIENT access to sensitive data regardless of verification', async () => {
      const response = await request(app)
        .get('/api/sensitive-data')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('CUSTOM_PERMISSION_DENIED');
    });
  });

  // ============================================================================
  // ACCOUNT STATUS TESTS
  // ============================================================================

  describe('Account Status Tests', () => {
    test('should deny access to inactive users', async () => {
      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${inactiveToken}`)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('ACCOUNT_DISABLED');
      expect(response.body.message).toBe('Compte désactivé');
    });

    test('should deny access to locked users', async () => {
      // Lock the user account
      clientUser.lockUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
      await clientUser.save();
      const lockedToken = generateTestToken(clientUser);

      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${lockedToken}`)
        .expect(423);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('ACCOUNT_LOCKED');
      expect(response.body.message).toBe('Compte temporairement verrouillé');
      expect(response.body).toHaveProperty('lockTimeRemaining');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    test('should handle missing authorization header', async () => {
      const response = await request(app)
        .get('/api/client/profile')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('MISSING_TOKEN');
      expect(response.body.message).toBe('Token d\'accès requis');
    });

    test('should handle invalid token format', async () => {
      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', 'Invalid token format')
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    test('should handle expired tokens', async () => {
      const jwt = require('jsonwebtoken');
      const expiredToken = jwt.sign(
        { userId: clientUser._id, role: 'CLIENT' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('TOKEN_EXPIRED');
    });

    test('should handle non-existent user tokens', async () => {
      const jwt = require('jsonwebtoken');
      const fakeUserId = '507f1f77bcf86cd799439011';
      const fakeToken = jwt.sign(
        { userId: fakeUserId, role: 'CLIENT' },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${fakeToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  // ============================================================================
  // ROLE HIERARCHY TESTS
  // ============================================================================

  describe('Role Hierarchy', () => {
    test('should respect role hierarchy: ADMIN > RECEPTIONIST > CLIENT', async () => {
      const routes = [
        '/api/client/profile',
        '/api/reception/dashboard',
        '/api/admin/dashboard'
      ];

      // Test CLIENT role access
      const clientResults = await Promise.all(
        routes.map(route => 
          request(app)
            .get(route)
            .set('Authorization', `Bearer ${clientToken}`)
            .then(res => ({ route, status: res.status }))
            .catch(err => ({ route, status: err.status }))
        )
      );

      expect(clientResults[0].status).toBe(200); // Can access client routes
      expect(clientResults[1].status).toBe(403); // Cannot access reception routes
      expect(clientResults[2].status).toBe(403); // Cannot access admin routes

      // Test RECEPTIONIST role access
      const receptionistResults = await Promise.all(
        routes.map(route => 
          request(app)
            .get(route)
            .set('Authorization', `Bearer ${receptionistToken}`)
            .then(res => ({ route, status: res.status }))
            .catch(err => ({ route, status: err.status }))
        )
      );

      expect(receptionistResults[0].status).toBe(200); // Can access client routes
      expect(receptionistResults[1].status).toBe(200); // Can access reception routes
      expect(receptionistResults[2].status).toBe(403); // Cannot access admin routes

      // Test ADMIN role access
      const adminResults = await Promise.all(
        routes.map(route => 
          request(app)
            .get(route)
            .set('Authorization', `Bearer ${adminToken}`)
            .then(res => ({ route, status: res.status }))
            .catch(err => ({ route, status: err.status }))
        )
      );

      expect(adminResults[0].status).toBe(200); // Can access client routes
      expect(adminResults[1].status).toBe(200); // Can access reception routes
      expect(adminResults[2].status).toBe(200); // Can access admin routes
    });
  });

  // ============================================================================
  // INTEGRATION TESTS WITH BUSINESS LOGIC
  // ============================================================================

  describe('Integration with Business Logic', () => {
    test('should allow role-appropriate access to booking workflow', async () => {
      // CLIENT can view their bookings
      const clientBookingResponse = await request(app)
        .get('/api/client/bookings')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);
      expect(clientBookingResponse.body.success).toBe(true);

      // RECEPTIONIST can perform check-in
      const checkinResponse = await request(app)
        .post('/api/reception/checkin')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .send({ bookingId: 'test-booking' })
        .expect(200);
      expect(checkinResponse.body.success).toBe(true);

      // ADMIN can access all statistics
      const statsResponse = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(statsResponse.body.success).toBe(true);
    });

    test('should enforce proper workflow restrictions', async () => {
      // CLIENT cannot perform check-in
      const clientCheckinResponse = await request(app)
        .post('/api/reception/checkin')
        .set('Authorization', `Bearer ${clientToken}`)
        .send({ bookingId: 'test-booking' })
        .expect(403);
      expect(clientCheckinResponse.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      // CLIENT cannot access admin stats
      const clientStatsResponse = await request(app)
        .get('/api/admin/stats')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);
      expect(clientStatsResponse.body.code).toBe('INSUFFICIENT_PERMISSIONS');

      // RECEPTIONIST cannot delete users
      const receptionistDeleteResponse = await request(app)
        .delete('/api/admin/users/test-user')
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);
      expect(receptionistDeleteResponse.body.code).toBe('INSUFFICIENT_PERMISSIONS');
    });
  });

  // ============================================================================
  // COMPREHENSIVE ROLE ACCESS MATRIX TESTS
  // ============================================================================

  describe('Comprehensive Role Access Matrix', () => {
    const roleAccessMatrix = [
      // Route, CLIENT, RECEPTIONIST, ADMIN
      ['/api/public', true, true, true],
      ['/api/client/profile', true, true, true],
      ['/api/client/bookings', true, true, true],
      ['/api/reception/dashboard', false, true, true],
      ['/api/reception/checkin', false, true, true],
      ['/api/admin/dashboard', false, false, true],
      ['/api/admin/hotels', false, false, true],
      ['/api/admin/users/test', false, false, true],
      ['/api/staff/notifications', false, true, true],
      ['/api/users/profile', true, true, true]
    ];

    test.each(roleAccessMatrix)(
      'should enforce access matrix for route %s',
      async (route, clientAccess, receptionistAccess, adminAccess) => {
        const method = route.includes('/users/') && route !== '/api/users/profile' ? 'delete' : 'get';
        const expectedClientStatus = clientAccess ? 200 : 403;
        const expectedReceptionistStatus = receptionistAccess ? 200 : 403;
        const expectedAdminStatus = adminAccess ? 200 : 403;

        // Test CLIENT access
        const clientResponse = await request(app)
          [method](route)
          .set('Authorization', `Bearer ${clientToken}`);
        expect(clientResponse.status).toBe(expectedClientStatus);

        // Test RECEPTIONIST access
        const receptionistResponse = await request(app)
          [method](route)
          .set('Authorization', `Bearer ${receptionistToken}`);
        expect(receptionistResponse.status).toBe(expectedReceptionistStatus);

        // Test ADMIN access
        const adminResponse = await request(app)
          [method](route)
          .set('Authorization', `Bearer ${adminToken}`);
        expect(adminResponse.status).toBe(expectedAdminStatus);
      }
    );
  });

  // ============================================================================
  // CONCURRENT ACCESS TESTS
  // ============================================================================

  describe('Concurrent Access Tests', () => {
    test('should handle multiple simultaneous requests with different roles', async () => {
      const promises = [
        // Multiple client requests
        request(app).get('/api/client/profile').set('Authorization', `Bearer ${clientToken}`),
        request(app).get('/api/client/bookings').set('Authorization', `Bearer ${clientToken}`),
        
        // Multiple receptionist requests
        request(app).get('/api/reception/dashboard').set('Authorization', `Bearer ${receptionistToken}`),
        request(app).post('/api/reception/checkin').set('Authorization', `Bearer ${receptionistToken}`).send({}),
        
        // Multiple admin requests
        request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`),
        request(app).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`)
      ];

      const results = await Promise.all(promises);

      // All client requests should succeed
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      // All receptionist requests should succeed
      expect(results[2].status).toBe(200);
      expect(results[3].status).toBe(200);

      // All admin requests should succeed
      expect(results[4].status).toBe(200);
      expect(results[5].status).toBe(200);
    });

    test('should handle mixed valid and invalid requests concurrently', async () => {
      const promises = [
        // Valid requests
        request(app).get('/api/client/profile').set('Authorization', `Bearer ${clientToken}`),
        request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`),
        
        // Invalid requests (wrong roles)
        request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${clientToken}`),
        request(app).get('/api/reception/dashboard').set('Authorization', `Bearer ${clientToken}`),
        
        // Invalid requests (no auth)
        request(app).get('/api/client/profile'),
        request(app).get('/api/admin/dashboard')
      ];

      const results = await Promise.all(promises);

      // Valid requests should succeed
      expect(results[0].status).toBe(200);
      expect(results[1].status).toBe(200);

      // Invalid role requests should be forbidden
      expect(results[2].status).toBe(403);
      expect(results[3].status).toBe(403);

      // No auth requests should be unauthorized
      expect(results[4].status).toBe(401);
      expect(results[5].status).toBe(401);
    });
  });

  // ============================================================================
  // PERFORMANCE AND SCALABILITY TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should handle role authorization efficiently for many requests', async () => {
      const startTime = Date.now();
      
      // Generate 100 requests with different roles
      const promises = [];
      for (let i = 0; i < 100; i++) {
        const token = i % 3 === 0 ? adminToken : i % 3 === 1 ? receptionistToken : clientToken;
        const route = i % 3 === 0 ? '/api/admin/dashboard' : i % 3 === 1 ? '/api/reception/dashboard' : '/api/client/profile';
        
        promises.push(
          request(app)
            .get(route)
            .set('Authorization', `Bearer ${token}`)
        );
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();
      const duration = endTime - startTime;

      // All requests should succeed
      results.forEach(result => {
        expect(result.status).toBe(200);
      });

      // Should complete in reasonable time (less than 5 seconds for 100 requests)
      expect(duration).toBeLessThan(5000);
    });

    test('should maintain consistent response times for role checks', async () => {
      const responseTimes = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();
        
        await request(app)
          .get('/api/admin/dashboard')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);
          
        const endTime = Date.now();
        responseTimes.push(endTime - startTime);
      }

      // Calculate average response time
      const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      
      // Average response time should be reasonable (less than 100ms)
      expect(avgResponseTime).toBeLessThan(100);

      // Response times should be consistent (standard deviation < 50ms)
      const variance = responseTimes.reduce((sum, time) => sum + Math.pow(time - avgResponseTime, 2), 0) / responseTimes.length;
      const stdDeviation = Math.sqrt(variance);
      expect(stdDeviation).toBeLessThan(50);
    });
  });

  // ============================================================================
  // EDGE CASES AND SECURITY TESTS
  // ============================================================================

  describe('Edge Cases and Security', () => {
    test('should handle malformed user IDs in ownership checks', async () => {
      const malformedIds = ['', 'invalid', '123', 'not-a-valid-objectid'];

      for (const malformedId of malformedIds) {
        const response = await request(app)
          .get(`/api/users/${malformedId}/bookings`)
          .set('Authorization', `Bearer ${clientToken}`)
          .expect(403);

        expect(response.body.success).toBe(false);
        expect(response.body.code).toBe('RESOURCE_ACCESS_DENIED');
      }
    });

    test('should prevent privilege escalation attempts', async () => {
      // Try to access admin route with modified token payload
      const jwt = require('jsonwebtoken');
      
      // This would fail because the token signature wouldn't match
      const maliciousToken = jwt.sign(
        { userId: clientUser._id, role: 'ADMIN' }, // Changed role
        'wrong-secret', // Wrong secret
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${maliciousToken}`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    test('should handle rapid role switching scenarios', async () => {
      // Simulate rapid requests with different tokens
      const rapidRequests = [];
      const tokens = [clientToken, receptionistToken, adminToken];
      const routes = ['/api/client/profile', '/api/reception/dashboard', '/api/admin/dashboard'];

      for (let i = 0; i < 20; i++) {
        const tokenIndex = i % 3;
        const routeIndex = i % 3;
        
        rapidRequests.push(
          request(app)
            .get(routes[routeIndex])
            .set('Authorization', `Bearer ${tokens[tokenIndex]}`)
        );
      }

      const results = await Promise.all(rapidRequests);

      // Verify each request got the expected result based on role matching
      results.forEach((result, index) => {
        const tokenIndex = index % 3;
        const routeIndex = index % 3;
        
        if (tokenIndex >= routeIndex) {
          // Token has sufficient privileges
          expect(result.status).toBe(200);
        } else {
          // Token has insufficient privileges
          expect(result.status).toBe(403);
        }
      });
    });

    test('should handle resource ownership edge cases', async () => {
      // Test with admin accessing client resources (should work)
      const adminAccessResponse = await request(app)
        .get(`/api/users/${clientUser._id}/bookings`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(adminAccessResponse.body.success).toBe(true);

      // Test with receptionist accessing client resources (should fail)
      const receptionistAccessResponse = await request(app)
        .get(`/api/users/${clientUser._id}/bookings`)
        .set('Authorization', `Bearer ${receptionistToken}`)
        .expect(403);
      expect(receptionistAccessResponse.body.code).toBe('RESOURCE_ACCESS_DENIED');

      // Test with client accessing their own resources (should work)
      const clientAccessResponse = await request(app)
        .get(`/api/users/${clientUser._id}/bookings`)
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);
      expect(clientAccessResponse.body.success).toBe(true);
    });
  });

  // ============================================================================
  // LOGGING AND AUDIT TESTS
  // ============================================================================

  describe('Logging and Audit', () => {
    test('should log authenticated access attempts', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await request(app)
        .get('/api/client/profile')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      // Verify that access was logged
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /api/client/profile - User:')
      );

      consoleSpy.mockRestore();
    });

    test('should handle logging for failed authorization attempts', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

      await request(app)
        .get('/api/admin/dashboard')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      // The middleware should still log the attempt even if it fails
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('GET /api/admin/dashboard - User:')
      );

      consoleSpy.mockRestore();
    });
  });
});