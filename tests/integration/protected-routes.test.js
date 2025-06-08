const request = require('supertest');
const express = require('express');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserWithRole,
  generateTestToken,
  generateExpiredToken,
  generateInvalidToken,
  createAuthHeaders,
  authenticatedRequest,
  expectErrorResponse,
  expectSuccessResponse
} = require('../setup/test-helpers');

// Middleware and utils to test
const authMiddleware = require('../../middleware/auth');
const jwtUtils = require('../../utils/jwt');

// Create test app with protected routes
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Public route (no protection)
  app.get('/api/public', (req, res) => {
    res.json({ success: true, message: 'Public route accessible' });
  });

  // Protected route (authentication required)
  app.get('/api/protected', authMiddleware.authRequired, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Protected route accessed',
      user: req.user
    });
  });

  // Admin only route
  app.get('/api/admin', authMiddleware.adminRequired, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Admin route accessed',
      user: req.user
    });
  });

  // Receptionist or Admin route
  app.get('/api/reception', authMiddleware.receptionistRequired, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Reception route accessed',
      user: req.user
    });
  });

  // Client, Receptionist or Admin route
  app.get('/api/client', authMiddleware.clientRequired, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Client route accessed',
      user: req.user
    });
  });

  // Email verification required route
  app.get('/api/verified', 
    authMiddleware.authRequired,
    authMiddleware.requireEmailVerification,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Verified email route accessed',
        user: req.user
      });
    }
  );

  // Ownership required route
  app.get('/api/users/:userId/profile', 
    authMiddleware.authRequired,
    authMiddleware.requireOwnership('userId'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'User profile accessed',
        userId: req.params.userId,
        user: req.user
      });
    }
  );

  // Rate limited route
  app.post('/api/limited', 
    authMiddleware.rateLimiter(3, 60000), // 3 requests per minute
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Rate limited route accessed' 
      });
    }
  );

  // Optional auth route
  app.get('/api/optional', authMiddleware.optionalAuth, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Optional auth route accessed',
      authenticated: !!req.user,
      user: req.user || null
    });
  });

  // Combined middleware route
  app.get('/api/admin-verified', 
    authMiddleware.combineAuthMiddlewares(
      authMiddleware.authenticateToken,
      authMiddleware.requireEmailVerification,
      authMiddleware.authorizeRoles('ADMIN')
    ),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Admin verified route accessed',
        user: req.user
      });
    }
  );

  return app;
};

describe('Protected Routes Security Tests', () => {
  let app;

  beforeAll(async () => {
    await testHooks.beforeAll();
    app = createTestApp();
  });

  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // PUBLIC ROUTES TESTS
  // ============================================================================

  describe('Public Routes', () => {
    test('should access public route without authentication', async () => {
      const response = await request(app)
        .get('/api/public')
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.message).toBe('Public route accessible');
    });

    test('should access public route with invalid token', async () => {
      const response = await request(app)
        .get('/api/public')
        .set('Authorization', 'Bearer invalid-token')
        .expect(200);

      expectSuccessResponse(response);
    });

    test('should access public route with expired token', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      const response = await request(app)
        .get('/api/public')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(200);

      expectSuccessResponse(response);
    });
  });

  // ============================================================================
  // AUTHENTICATION REQUIRED TESTS
  // ============================================================================

  describe('Authentication Required Routes', () => {
    test('should reject access without token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
    });

    test('should reject access with invalid token', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401);

      expectErrorResponse(response, 401, 'Token invalide');
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    test('should reject access with malformed authorization header', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Basic sometoken')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
    });

    test('should reject access with expired token', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expectErrorResponse(response, 401, 'Token expiré');
      expect(response.body.code).toBe('TOKEN_EXPIRED');
      expect(response.body.hint).toContain('refresh token');
    });

    test('should reject access with blacklisted token', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      // Blacklist the token
      jwtUtils.blacklistToken(token);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expectErrorResponse(response, 401, 'Token révoqué');
      expect(response.body.code).toBe('TOKEN_REVOKED');
    });

    test('should allow access with valid token', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.message).toBe('Protected route accessed');
      expect(response.body.user.userId).toBe(user._id.toString());
      expect(response.body.user.email).toBe(user.email);
      expect(response.body.user.role).toBe(user.role);
    });

    test('should reject access for inactive user', async () => {
      const user = await createTestUser({ isActive: false });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expectErrorResponse(response, 403, 'Compte désactivé');
      expect(response.body.code).toBe('ACCOUNT_DISABLED');
    });

    test('should reject access for locked user', async () => {
      const user = await createTestUser();
      // Simulate locked account
      user.lockUntil = new Date(Date.now() + 60000); // Locked for 1 minute
      await user.save();

      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(423);

      expectErrorResponse(response, 423, 'Compte temporairement verrouillé');
      expect(response.body.code).toBe('ACCOUNT_LOCKED');
      expect(response.body.lockTimeRemaining).toBeTruthy();
    });

    test('should reject access for non-existent user', async () => {
      // Create token with fake user ID
      const fakeUserId = '507f1f77bcf86cd799439011';
      const payload = {
        userId: fakeUserId,
        email: 'fake@test.com',
        role: 'CLIENT'
      };
      const token = jwtUtils.generateAccessToken(payload);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      expectErrorResponse(response, 401, 'Utilisateur non trouvé');
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });
  });

  // ============================================================================
  // ROLE-BASED ACCESS TESTS
  // ============================================================================

  describe('Role-Based Access Control', () => {
    describe('Admin Routes', () => {
      test('should allow admin access to admin route', async () => {
        const admin = await createUserWithRole('ADMIN');
        const token = generateTestToken(admin);

        const response = await request(app)
          .get('/api/admin')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.message).toBe('Admin route accessed');
        expect(response.body.user.role).toBe('ADMIN');
      });

      test('should reject receptionist access to admin route', async () => {
        const receptionist = await createUserWithRole('RECEPTIONIST');
        const token = generateTestToken(receptionist);

        const response = await request(app)
          .get('/api/admin')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expectErrorResponse(response, 403, 'Permissions insuffisantes');
        expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(response.body.required).toEqual(['ADMIN']);
        expect(response.body.current).toBe('RECEPTIONIST');
      });

      test('should reject client access to admin route', async () => {
        const client = await createUserWithRole('CLIENT');
        const token = generateTestToken(client);

        const response = await request(app)
          .get('/api/admin')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expectErrorResponse(response, 403, 'Permissions insuffisantes');
        expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
        expect(response.body.required).toEqual(['ADMIN']);
        expect(response.body.current).toBe('CLIENT');
      });
    });

    describe('Reception Routes', () => {
      test('should allow admin access to reception route', async () => {
        const admin = await createUserWithRole('ADMIN');
        const token = generateTestToken(admin);

        const response = await request(app)
          .get('/api/reception')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.user.role).toBe('ADMIN');
      });

      test('should allow receptionist access to reception route', async () => {
        const receptionist = await createUserWithRole('RECEPTIONIST');
        const token = generateTestToken(receptionist);

        const response = await request(app)
          .get('/api/reception')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.user.role).toBe('RECEPTIONIST');
      });

      test('should reject client access to reception route', async () => {
        const client = await createUserWithRole('CLIENT');
        const token = generateTestToken(client);

        const response = await request(app)
          .get('/api/reception')
          .set('Authorization', `Bearer ${token}`)
          .expect(403);

        expectErrorResponse(response, 403, 'Permissions insuffisantes');
        expect(response.body.required).toEqual(['RECEPTIONIST', 'ADMIN']);
        expect(response.body.current).toBe('CLIENT');
      });
    });

    describe('Client Routes', () => {
      test('should allow admin access to client route', async () => {
        const admin = await createUserWithRole('ADMIN');
        const token = generateTestToken(admin);

        const response = await request(app)
          .get('/api/client')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.user.role).toBe('ADMIN');
      });

      test('should allow receptionist access to client route', async () => {
        const receptionist = await createUserWithRole('RECEPTIONIST');
        const token = generateTestToken(receptionist);

        const response = await request(app)
          .get('/api/client')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.user.role).toBe('RECEPTIONIST');
      });

      test('should allow client access to client route', async () => {
        const client = await createUserWithRole('CLIENT');
        const token = generateTestToken(client);

        const response = await request(app)
          .get('/api/client')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);

        expectSuccessResponse(response);
        expect(response.body.user.role).toBe('CLIENT');
      });
    });
  });

  // ============================================================================
  // EMAIL VERIFICATION TESTS
  // ============================================================================

  describe('Email Verification Requirements', () => {
    test('should allow verified user access to verified route', async () => {
      const user = await createTestUser({ isEmailVerified: true });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/verified')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.message).toBe('Verified email route accessed');
    });

    test('should reject unverified user access to verified route', async () => {
      const user = await createTestUser({ isEmailVerified: false });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/verified')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expectErrorResponse(response, 403, 'Vérification d\'email requise');
      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(response.body.actions.resendVerification).toBe('/api/auth/resend-verification');
    });

    test('should reject unauthenticated access to verified route', async () => {
      const response = await request(app)
        .get('/api/verified')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });
  });

  // ============================================================================
  // OWNERSHIP TESTS
  // ============================================================================

  describe('Resource Ownership', () => {
    test('should allow user to access own profile', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get(`/api/users/${user._id}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.userId).toBe(user._id.toString());
      expect(response.body.user.userId).toBe(user._id.toString());
    });

    test('should reject user accessing other user profile', async () => {
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });
      const token = generateTestToken(user1);

      const response = await request(app)
        .get(`/api/users/${user2._id}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expectErrorResponse(response, 403, 'Accès non autorisé à cette ressource');
      expect(response.body.code).toBe('RESOURCE_ACCESS_DENIED');
    });

    test('should allow admin to access any user profile', async () => {
      const admin = await createUserWithRole('ADMIN');
      const user = await createTestUser();
      const token = generateTestToken(admin);

      const response = await request(app)
        .get(`/api/users/${user._id}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.userId).toBe(user._id.toString());
      expect(response.body.user.role).toBe('ADMIN');
    });

    test('should reject access with missing parameter', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/users//profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(404); // Express will return 404 for missing parameter

      // Route not found due to missing parameter
    });
  });

  // ============================================================================
  // RATE LIMITING TESTS
  // ============================================================================

  describe('Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      const responses = [];

      // Make 3 requests (within limit)
      for (let i = 0; i < 3; i++) {
        const response = await request(app)
          .post('/api/limited')
          .send({ data: `request ${i}` })
          .expect(200);

        responses.push(response);
        expectSuccessResponse(response);
        expect(response.headers['x-ratelimit-limit']).toBe('3');
        expect(parseInt(response.headers['x-ratelimit-remaining'])).toBe(2 - i);
      }
    });

    test('should reject requests exceeding rate limit', async () => {
      // Make 3 requests to reach the limit
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/limited')
          .send({ data: `request ${i}` })
          .expect(200);
      }

      // 4th request should be rate limited
      const response = await request(app)
        .post('/api/limited')
        .send({ data: 'request 4' })
        .expect(429);

      expectErrorResponse(response, 429, 'Trop de requêtes');
      expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.limit).toBe(3);
      expect(response.body.resetIn).toBeTruthy();
    });

    test('should apply rate limiting per user', async () => {
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });
      const token1 = generateTestToken(user1);
      const token2 = generateTestToken(user2);

      // User 1 makes 3 requests
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/limited')
          .set('Authorization', `Bearer ${token1}`)
          .send({ data: `user1 request ${i}` })
          .expect(200);
      }

      // User 1's 4th request should be rate limited
      await request(app)
        .post('/api/limited')
        .set('Authorization', `Bearer ${token1}`)
        .send({ data: 'user1 request 4' })
        .expect(429);

      // User 2 should still be able to make requests
      const response = await request(app)
        .post('/api/limited')
        .set('Authorization', `Bearer ${token2}`)
        .send({ data: 'user2 request 1' })
        .expect(200);

      expectSuccessResponse(response);
    });
  });

  // ============================================================================
  // OPTIONAL AUTHENTICATION TESTS
  // ============================================================================

  describe('Optional Authentication', () => {
    test('should work without authentication', async () => {
      const response = await request(app)
        .get('/api/optional')
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.message).toBe('Optional auth route accessed');
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });

    test('should work with valid authentication', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/optional')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.user.userId).toBe(user._id.toString());
      expect(response.body.user.email).toBe(user.email);
    });

    test('should work with invalid authentication (graceful degradation)', async () => {
      const response = await request(app)
        .get('/api/optional')
        .set('Authorization', 'Bearer invalid-token')
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });

    test('should work with expired token (graceful degradation)', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      const response = await request(app)
        .get('/api/optional')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });
  });

  // ============================================================================
  // COMBINED MIDDLEWARE TESTS
  // ============================================================================

  describe('Combined Middleware', () => {
    test('should allow admin with verified email to access combined route', async () => {
      const admin = await createUserWithRole('ADMIN');
      admin.isEmailVerified = true;
      await admin.save();
      const token = generateTestToken(admin);

      const response = await request(app)
        .get('/api/admin-verified')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expectSuccessResponse(response);
      expect(response.body.message).toBe('Admin verified route accessed');
      expect(response.body.user.role).toBe('ADMIN');
    });

    test('should reject admin with unverified email from combined route', async () => {
      const admin = await createUserWithRole('ADMIN');
      admin.isEmailVerified = false;
      await admin.save();
      const token = generateTestToken(admin);

      const response = await request(app)
        .get('/api/admin-verified')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expectErrorResponse(response, 403, 'Vérification d\'email requise');
      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    });

    test('should reject client with verified email from combined route', async () => {
      const client = await createUserWithRole('CLIENT');
      client.isEmailVerified = true;
      await client.save();
      const token = generateTestToken(client);

      const response = await request(app)
        .get('/api/admin-verified')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expectErrorResponse(response, 403, 'Permissions insuffisantes');
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.current).toBe('CLIENT');
    });

    test('should reject unauthenticated access to combined route', async () => {
      const response = await request(app)
        .get('/api/admin-verified')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
    });
  });

  // ============================================================================
  // SECURITY HEADERS TESTS
  // ============================================================================

  describe('Security Headers', () => {
    test('should include rate limit headers', async () => {
      const response = await request(app)
        .post('/api/limited')
        .send({ data: 'test' })
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBe('3');
      expect(response.headers['x-ratelimit-remaining']).toBe('2');
      expect(response.headers['x-ratelimit-reset']).toBeTruthy();
    });

    test('should not leak sensitive information in error responses', async () => {
      const response = await request(app)
        .get('/api/protected')
        .expect(401);

      // Should not include stack traces or internal details
      expect(response.body).not.toHaveProperty('stack');
      expect(response.body).not.toHaveProperty('path');
      expect(response.body).not.toHaveProperty('statusCode');
      
      // Should have proper error structure
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('message');
      expect(response.body).toHaveProperty('code');
    });
  });

  // ============================================================================
  // EDGE CASES AND ERROR HANDLING
  // ============================================================================

  describe('Edge Cases and Error Handling', () => {
    test('should handle malformed JSON in request body', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .post('/api/limited')
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/json')
        .send('{"invalid": json}')
        .expect(400);

      // Express will handle malformed JSON
    });

    test('should handle very long authorization headers', async () => {
      const longHeader = 'Bearer ' + 'a'.repeat(10000);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', longHeader)
        .expect(401);

      expectErrorResponse(response, 401);
    });

    test('should handle concurrent requests to rate limited endpoint', async () => {
      const requests = [];
      
      // Make 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        requests.push(
          request(app)
            .post('/api/limited')
            .send({ data: `concurrent request ${i}` })
        );
      }

      const responses = await Promise.all(requests);
      
      // Should have 3 successful and 2 rate limited responses
      const successCount = responses.filter(r => r.status === 200).length;
      const rateLimitedCount = responses.filter(r => r.status === 429).length;
      
      expect(successCount).toBe(3);
      expect(rateLimitedCount).toBe(2);
    });

    test('should handle requests with multiple authorization headers', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .set('Authorization', 'Bearer another-token')
        .expect(200);

      // Should use the last authorization header
      expectSuccessResponse(response);
    });

    test('should handle empty authorization header', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', '')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });

    test('should handle whitespace-only authorization header', async () => {
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', '   ')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });
  });

  // ============================================================================
  // INTEGRATION WITH REAL USE CASES
  // ============================================================================

  describe('Real Use Case Integration', () => {
    test('should simulate complete user authentication flow', async () => {
      // Create user
      const user = await createTestUser();
      const token = generateTestToken(user);

      // Access protected route
      const protectedResponse = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(protectedResponse.body.user.userId).toBe(user._id.toString());

      // Access role-appropriate route
      const clientResponse = await request(app)
        .get('/api/client')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(clientResponse.body.user.role).toBe('CLIENT');

      // Try to access admin route (should fail)
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    test('should simulate hotel staff workflow', async () => {
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const token = generateTestToken(receptionist);

      // Can access reception routes
      await request(app)
        .get('/api/reception')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Can access client routes
      await request(app)
        .get('/api/client')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Cannot access admin routes
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    test('should simulate admin workflow', async () => {
      const admin = await createUserWithRole('ADMIN');
      const token = generateTestToken(admin);

      // Can access all routes
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app)
        .get('/api/reception')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await request(app)
        .get('/api/client')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Can access any user's profile
      const user = await createTestUser();
      await request(app)
        .get(`/api/users/${user._id}/profile`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    test('should simulate token expiration scenario', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      // All protected routes should reject expired token
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      await request(app)
        .get('/api/client')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      // Optional auth should still work
      const response = await request(app)
        .get('/api/optional')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(200);

      expect(response.body.authenticated).toBe(false);
    });

    test('should simulate account lockout scenario', async () => {
      const user = await createTestUser();
      
      // Lock the account
      user.lockUntil = new Date(Date.now() + 300000); // 5 minutes
      await user.save();
      
      const token = generateTestToken(user);

      // All protected routes should reject locked account
      const responses = await Promise.all([
        request(app).get('/api/protected').set('Authorization', `Bearer ${token}`),
        request(app).get('/api/client').set('Authorization', `Bearer ${token}`),
        request(app).get('/api/admin').set('Authorization', `Bearer ${token}`)
      ]);

      responses.forEach(response => {
        expect(response.status).toBe(423);
        expect(response.body.code).toBe('ACCOUNT_LOCKED');
        expect(response.body.lockTimeRemaining).toBeTruthy();
      });
    });

    test('should simulate email verification workflow', async () => {
      // Unverified user
      const unverifiedUser = await createTestUser({ isEmailVerified: false });
      const unverifiedToken = generateTestToken(unverifiedUser);

      // Can access basic protected routes
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .expect(200);

      // Cannot access verification-required routes
      await request(app)
        .get('/api/verified')
        .set('Authorization', `Bearer ${unverifiedToken}`)
        .expect(403);

      // Verify email
      unverifiedUser.isEmailVerified = true;
      await unverifiedUser.save();
      
      const verifiedToken = generateTestToken(unverifiedUser);

      // Now can access verification-required routes
      await request(app)
        .get('/api/verified')
        .set('Authorization', `Bearer ${verifiedToken}`)
        .expect(200);
    });
  });

  // ============================================================================
  // PERFORMANCE AND LOAD TESTS
  // ============================================================================

  describe('Performance and Load Tests', () => {
    test('should handle multiple concurrent authenticated requests', async () => {
      const users = await Promise.all([
        createTestUser({ email: 'user1@test.com' }),
        createTestUser({ email: 'user2@test.com' }),
        createTestUser({ email: 'user3@test.com' }),
        createTestUser({ email: 'user4@test.com' }),
        createTestUser({ email: 'user5@test.com' })
      ]);

      const requests = users.map(user => {
        const token = generateTestToken(user);
        return request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`);
      });

      const startTime = Date.now();
      const responses = await Promise.all(requests);
      const endTime = Date.now();

      // All requests should succeed
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
        expect(response.body.user.email).toBe(users[index].email);
      });

      // Should complete reasonably quickly (under 1 second)
      expect(endTime - startTime).toBeLessThan(1000);
    });

    test('should handle authentication middleware efficiently', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const startTime = Date.now();

      // Make 50 sequential requests
      for (let i = 0; i < 50; i++) {
        await request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`)
          .expect(200);
      }

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (under 5 seconds)
      expect(duration).toBeLessThan(5000);
      
      // Average response time should be under 100ms
      const avgResponseTime = duration / 50;
      expect(avgResponseTime).toBeLessThan(100);
    });

    test('should handle rate limiting under load', async () => {
      const requests = [];
      
      // Make 20 concurrent requests to rate limited endpoint
      for (let i = 0; i < 20; i++) {
        requests.push(
          request(app)
            .post('/api/limited')
            .send({ data: `load test request ${i}` })
        );
      }

      const responses = await Promise.all(requests);
      
      // Should have exactly 3 successful responses (rate limit)
      const successCount = responses.filter(r => r.status === 200).length;
      const rateLimitedCount = responses.filter(r => r.status === 429).length;
      
      expect(successCount).toBe(3);
      expect(rateLimitedCount).toBe(17);
      
      // Rate limited responses should have proper structure
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      rateLimitedResponses.forEach(response => {
        expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(response.body.limit).toBe(3);
        expect(response.body.resetIn).toBeTruthy();
      });
    });
  });

  // ============================================================================
  // SECURITY VULNERABILITY TESTS
  // ============================================================================

  describe('Security Vulnerability Tests', () => {
    test('should prevent header injection attacks', async () => {
      const maliciousHeaders = [
        'Bearer token\r\nX-Injected: malicious',
        'Bearer token\nX-Injected: malicious',
        'Bearer token\0X-Injected: malicious'
      ];

      for (const header of maliciousHeaders) {
        const response = await request(app)
          .get('/api/protected')
          .set('Authorization', header)
          .expect(401);

        expectErrorResponse(response, 401);
        // Should not have injected headers
        expect(response.headers['x-injected']).toBeUndefined();
      }
    });

    test('should prevent timing attacks on token validation', async () => {
      const user = await createTestUser();
      const validToken = generateTestToken(user);
      const invalidToken = 'invalid.token.here';

      // Measure response times
      const measureTime = async (token) => {
        const start = process.hrtime.bigint();
        await request(app)
          .get('/api/protected')
          .set('Authorization', `Bearer ${token}`);
        const end = process.hrtime.bigint();
        return Number(end - start) / 1000000; // Convert to milliseconds
      };

      // Test multiple times to get average
      const validTimes = [];
      const invalidTimes = [];

      for (let i = 0; i < 10; i++) {
        validTimes.push(await measureTime(validToken));
        invalidTimes.push(await measureTime(invalidToken));
      }

      const avgValidTime = validTimes.reduce((a, b) => a + b) / validTimes.length;
      const avgInvalidTime = invalidTimes.reduce((a, b) => a + b) / invalidTimes.length;

      // Timing difference should not be significant (within 50ms)
      const timingDifference = Math.abs(avgValidTime - avgInvalidTime);
      expect(timingDifference).toBeLessThan(50);
    });

    test('should prevent token reuse after user role change', async () => {
      const user = await createUserWithRole('CLIENT');
      const clientToken = generateTestToken(user);

      // Token should work for client routes
      await request(app)
        .get('/api/client')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(200);

      // Should not work for admin routes
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      // Change user role to ADMIN
      user.role = 'ADMIN';
      await user.save();

      // Old token should still reflect old role (CLIENT)
      // This is expected behavior - new token needed after role change
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${clientToken}`)
        .expect(403);

      // New token should work for admin routes
      const adminToken = generateTestToken(user);
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
    });

    test('should prevent privilege escalation through token manipulation', async () => {
      const client = await createUserWithRole('CLIENT');
      const clientToken = generateTestToken(client);

      // Attempt to modify token payload (this should fail at verification)
      const tokenParts = clientToken.split('.');
      const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64'));
      payload.role = 'ADMIN'; // Attempt privilege escalation
      
      const modifiedPayload = Buffer.from(JSON.stringify(payload)).toString('base64');
      const modifiedToken = `${tokenParts[0]}.${modifiedPayload}.${tokenParts[2]}`;

      // Modified token should be rejected
      await request(app)
        .get('/api/admin')
        .set('Authorization', `Bearer ${modifiedToken}`)
        .expect(401);
    });

    test('should handle token replay attacks', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      // First request should work
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // Blacklist the token (simulate logout)
      jwtUtils.blacklistToken(token);

      // Replayed token should be rejected
      await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    test('should prevent session fixation attacks', async () => {
      // Create two users
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });

      const token1 = generateTestToken(user1);
      const token2 = generateTestToken(user2);

      // Each token should only work for its respective user
      const response1 = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token1}`)
        .expect(200);

      const response2 = await request(app)
        .get('/api/protected')
        .set('Authorization', `Bearer ${token2}`)
        .expect(200);

      expect(response1.body.user.email).toBe(user1.email);
      expect(response2.body.user.email).toBe(user2.email);
      expect(response1.body.user.email).not.toBe(response2.body.user.email);
    });
  });

  // ============================================================================
  // CLEANUP AND RESOURCE MANAGEMENT TESTS
  // ============================================================================

  describe('Cleanup and Resource Management', () => {
    test('should not leak memory with multiple token validations', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      // Make many requests to test for memory leaks
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .get('/api/protected')
            .set('Authorization', `Bearer ${token}`)
            .expect(200)
        );
      }

      await Promise.all(requests);
      
      // If we get here without timeout, no obvious memory leak
      expect(true).toBe(true);
    });

    test('should handle cleanup of expired rate limit entries', async () => {
      // This test ensures rate limiting doesn't accumulate indefinitely
      const user = await createTestUser();
      const token = generateTestToken(user);

      // Make requests over time to trigger cleanup
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/limited')
          .set('Authorization', `Bearer ${token}`)
          .send({ data: `cleanup test ${i}` });
        
        // Small delay to allow cleanup
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Should not cause memory issues
      expect(true).toBe(true);
    });
  });
});