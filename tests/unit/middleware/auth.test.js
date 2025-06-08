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
  expectErrorResponse,
  expectSuccessResponse
} = require('../setup/test-helpers');

// Middleware to test
const authMiddleware = require('../../middleware/auth');
const jwtUtils = require('../../utils/jwt');

// Mock Express app for testing
const createTestApp = () => {
  const app = express();
  app.use(express.json());
  
  // Test routes with different middleware combinations
  app.get('/public', (req, res) => {
    res.json({ success: true, message: 'Public route', user: req.user || null });
  });
  
  app.get('/protected/basic', authMiddleware.authenticateToken, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Protected route accessed',
      user: {
        userId: req.user.userId,
        email: req.user.email,
        role: req.user.role
      }
    });
  });
  
  app.get('/protected/admin', 
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRoles('ADMIN'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Admin route accessed',
        user: req.user
      });
    }
  );
  
  app.get('/protected/receptionist',
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRoles('RECEPTIONIST', 'ADMIN'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Receptionist route accessed',
        user: req.user
      });
    }
  );
  
  app.get('/protected/client',
    authMiddleware.authenticateToken,
    authMiddleware.authorizeRoles('CLIENT', 'RECEPTIONIST', 'ADMIN'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Client route accessed',
        user: req.user
      });
    }
  );
  
  app.get('/protected/email-verified',
    authMiddleware.authenticateToken,
    authMiddleware.requireEmailVerification,
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Email verified route accessed',
        user: req.user
      });
    }
  );
  
  app.get('/protected/ownership/:userId',
    authMiddleware.authenticateToken,
    authMiddleware.requireOwnership('userId'),
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Ownership route accessed',
        user: req.user,
        resourceId: req.params.userId
      });
    }
  );
  
  app.get('/optional-auth', authMiddleware.optionalAuth, (req, res) => {
    res.json({ 
      success: true, 
      message: 'Optional auth route',
      authenticated: !!req.user,
      user: req.user || null
    });
  });
  
  app.get('/rate-limited',
    authMiddleware.rateLimiter(3, 60000), // 3 requests per minute
    (req, res) => {
      res.json({ 
        success: true, 
        message: 'Rate limited route accessed'
      });
    }
  );
  
  // Shortcut middleware routes
  app.get('/shortcuts/admin-required', authMiddleware.adminRequired, (req, res) => {
    res.json({ success: true, message: 'Admin shortcut accessed' });
  });
  
  app.get('/shortcuts/receptionist-required', authMiddleware.receptionistRequired, (req, res) => {
    res.json({ success: true, message: 'Receptionist shortcut accessed' });
  });
  
  app.get('/shortcuts/client-required', authMiddleware.clientRequired, (req, res) => {
    res.json({ success: true, message: 'Client shortcut accessed' });
  });
  
  app.get('/shortcuts/verified-user-required', authMiddleware.verifiedUserRequired, (req, res) => {
    res.json({ success: true, message: 'Verified user shortcut accessed' });
  });
  
  return app;
};

describe('Auth Middleware Tests', () => {
  let app;
  
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);
  
  beforeEach(() => {
    app = createTestApp();
  });

  // ============================================================================
  // AUTHENTICATE TOKEN MIDDLEWARE TESTS
  // ============================================================================

  describe('authenticateToken Middleware', () => {
    test('should allow access with valid token', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.user.userId).toBe(user._id.toString());
      expect(response.body.user.email).toBe(user.email);
      expect(response.body.user.role).toBe(user.role);
    });

    test('should reject request without token', async () => {
      const response = await request(app)
        .get('/protected/basic');

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
      expect(response.body.hint).toContain('Authorization: Bearer');
    });

    test('should reject request with invalid token format', async () => {
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', 'Basic invalid-token');

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
    });

    test('should reject request with invalid token', async () => {
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', 'Bearer invalid.jwt.token');

      expectErrorResponse(response, 401, 'Token invalide');
      expect(response.body.code).toBe('INVALID_TOKEN');
    });

    test('should reject request with expired token', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${expiredToken}`);

      expectErrorResponse(response, 401, 'Token expiré');
      expect(response.body.code).toBe('TOKEN_EXPIRED');
      expect(response.body.hint).toContain('refresh token');
    });

    test('should reject request with blacklisted token', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      // Blacklist the token
      jwtUtils.blacklistToken(token);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 401, 'Token révoqué');
      expect(response.body.code).toBe('TOKEN_REVOKED');
      expect(response.body.hint).toContain('Reconnectez-vous');
    });

    test('should reject request when user not found', async () => {
      // Create token with non-existent user ID
      const fakeUserId = '507f1f77bcf86cd799439011';
      const fakeToken = jwtUtils.generateAccessToken({
        userId: fakeUserId,
        email: 'fake@test.com',
        role: 'CLIENT'
      });

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${fakeToken}`);

      expectErrorResponse(response, 401, 'Utilisateur non trouvé');
      expect(response.body.code).toBe('USER_NOT_FOUND');
    });

    test('should reject request when user is inactive', async () => {
      const user = await createTestUser({ isActive: false });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Compte désactivé');
      expect(response.body.code).toBe('ACCOUNT_DISABLED');
      expect(response.body.hint).toContain('administrateur');
    });

    test('should reject request when user account is locked', async () => {
      const user = await createTestUser();
      
      // Lock the user account
      user.lockUntil = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now
      await user.save();
      
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 423, 'Compte temporairement verrouillé');
      expect(response.body.code).toBe('ACCOUNT_LOCKED');
      expect(response.body.lockTimeRemaining).toContain('minutes');
      expect(response.body.unlockAt).toBeDefined();
    });

    test('should populate req.user with correct data', async () => {
      const user = await createTestUser({
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@test.com',
        role: 'CLIENT'
      });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({
        userId: user._id.toString(),
        email: 'john.doe@test.com',
        role: 'CLIENT'
      });
    });
  });

  // ============================================================================
  // AUTHORIZE ROLES MIDDLEWARE TESTS
  // ============================================================================

  describe('authorizeRoles Middleware', () => {
    test('should allow admin access to admin route', async () => {
      const admin = await createUserWithRole('ADMIN');
      const token = generateTestToken(admin);

      const response = await request(app)
        .get('/protected/admin')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.message).toContain('Admin route accessed');
    });

    test('should deny client access to admin route', async () => {
      const client = await createUserWithRole('CLIENT');
      const token = generateTestToken(client);

      const response = await request(app)
        .get('/protected/admin')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Permissions insuffisantes');
      expect(response.body.code).toBe('INSUFFICIENT_PERMISSIONS');
      expect(response.body.required).toContain('ADMIN');
      expect(response.body.current).toBe('CLIENT');
    });

    test('should allow receptionist and admin access to receptionist route', async () => {
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const admin = await createUserWithRole('ADMIN');
      
      const receptionistToken = generateTestToken(receptionist);
      const adminToken = generateTestToken(admin);

      // Test receptionist access
      const receptionistResponse = await request(app)
        .get('/protected/receptionist')
        .set('Authorization', `Bearer ${receptionistToken}`);

      expectSuccessResponse(receptionistResponse, 200);

      // Test admin access
      const adminResponse = await request(app)
        .get('/protected/receptionist')
        .set('Authorization', `Bearer ${adminToken}`);

      expectSuccessResponse(adminResponse, 200);
    });

    test('should deny client access to receptionist route', async () => {
      const client = await createUserWithRole('CLIENT');
      const token = generateTestToken(client);

      const response = await request(app)
        .get('/protected/receptionist')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Permissions insuffisantes');
      expect(response.body.required).toEqual(['RECEPTIONIST', 'ADMIN']);
      expect(response.body.current).toBe('CLIENT');
    });

    test('should allow all roles access to client route', async () => {
      const client = await createUserWithRole('CLIENT');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const admin = await createUserWithRole('ADMIN');

      const clientToken = generateTestToken(client);
      const receptionistToken = generateTestToken(receptionist);
      const adminToken = generateTestToken(admin);

      // Test all role access
      const responses = await Promise.all([
        request(app).get('/protected/client').set('Authorization', `Bearer ${clientToken}`),
        request(app).get('/protected/client').set('Authorization', `Bearer ${receptionistToken}`),
        request(app).get('/protected/client').set('Authorization', `Bearer ${adminToken}`)
      ]);

      responses.forEach(response => {
        expectSuccessResponse(response, 200);
      });
    });

    test('should reject authorization without authentication', async () => {
      const response = await request(app)
        .get('/protected/admin');

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });
  });

  // ============================================================================
  // OPTIONAL AUTH MIDDLEWARE TESTS
  // ============================================================================

  describe('optionalAuth Middleware', () => {
    test('should work without token', async () => {
      const response = await request(app)
        .get('/optional-auth');

      expectSuccessResponse(response, 200);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });

    test('should work with valid token', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/optional-auth')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.authenticated).toBe(true);
      expect(response.body.user.userId).toBe(user._id.toString());
    });

    test('should work with invalid token (graceful degradation)', async () => {
      const response = await request(app)
        .get('/optional-auth')
        .set('Authorization', 'Bearer invalid.token');

      expectSuccessResponse(response, 200);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });

    test('should work with expired token (graceful degradation)', async () => {
      const user = await createTestUser();
      const expiredToken = generateExpiredToken(user);

      const response = await request(app)
        .get('/optional-auth')
        .set('Authorization', `Bearer ${expiredToken}`);

      expectSuccessResponse(response, 200);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });

    test('should not authenticate inactive user', async () => {
      const user = await createTestUser({ isActive: false });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/optional-auth')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.authenticated).toBe(false);
      expect(response.body.user).toBeNull();
    });
  });

  // ============================================================================
  // EMAIL VERIFICATION MIDDLEWARE TESTS
  // ============================================================================

  describe('requireEmailVerification Middleware', () => {
    test('should allow access with verified email', async () => {
      const user = await createTestUser({ isEmailVerified: true });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/email-verified')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
    });

    test('should deny access with unverified email', async () => {
      const user = await createTestUser({ isEmailVerified: false });
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/protected/email-verified')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Vérification d\'email requise');
      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(response.body.hint).toContain('Vérifiez votre email');
      expect(response.body.actions.resendVerification).toBe('/api/auth/resend-verification');
    });

    test('should require authentication first', async () => {
      const response = await request(app)
        .get('/protected/email-verified');

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });
  });

  // ============================================================================
  // OWNERSHIP MIDDLEWARE TESTS
  // ============================================================================

  describe('requireOwnership Middleware', () => {
    test('should allow user to access their own resource', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get(`/protected/ownership/${user._id}`)
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.resourceId).toBe(user._id.toString());
    });

    test('should deny user access to other user resource', async () => {
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });
      const token = generateTestToken(user1);

      const response = await request(app)
        .get(`/protected/ownership/${user2._id}`)
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Accès non autorisé à cette ressource');
      expect(response.body.code).toBe('RESOURCE_ACCESS_DENIED');
      expect(response.body.hint).toContain('propres ressources');
    });

    test('should allow admin access to any resource', async () => {
      const admin = await createUserWithRole('ADMIN');
      const user = await createTestUser();
      const token = generateTestToken(admin);

      const response = await request(app)
        .get(`/protected/ownership/${user._id}`)
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
    });

    test('should handle missing parameter', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);

      // Create a route without the parameter
      const testApp = express();
      testApp.use(express.json());
      testApp.get('/test', 
        authMiddleware.authenticateToken,
        authMiddleware.requireOwnership('missingParam'),
        (req, res) => res.json({ success: true })
      );

      const response = await request(testApp)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 400, 'Paramètre missingParam requis');
      expect(response.body.code).toBe('MISSING_PARAMETER');
    });
  });

  // ============================================================================
  // RATE LIMITER MIDDLEWARE TESTS
  // ============================================================================

  describe('rateLimiter Middleware', () => {
    test('should allow requests within limit', async () => {
      const responses = await Promise.all([
        request(app).get('/rate-limited'),
        request(app).get('/rate-limited'),
        request(app).get('/rate-limited')
      ]);

      responses.forEach(response => {
        expectSuccessResponse(response, 200);
        expect(response.headers['x-ratelimit-limit']).toBe('3');
      });

      // Check remaining count decreases
      expect(responses[0].headers['x-ratelimit-remaining']).toBe('2');
      expect(responses[1].headers['x-ratelimit-remaining']).toBe('1');
      expect(responses[2].headers['x-ratelimit-remaining']).toBe('0');
    });

    test('should block requests exceeding limit', async () => {
      // Make 3 allowed requests
      await Promise.all([
        request(app).get('/rate-limited'),
        request(app).get('/rate-limited'),
        request(app).get('/rate-limited')
      ]);

      // 4th request should be blocked
      const response = await request(app).get('/rate-limited');

      expectErrorResponse(response, 429, 'Trop de requêtes');
      expect(response.body.code).toBe('RATE_LIMIT_EXCEEDED');
      expect(response.body.limit).toBe(3);
      expect(response.body.resetIn).toContain('secondes');
    });

    test('should track rate limits per user when authenticated', async () => {
      const user1 = await createTestUser({ email: 'user1@test.com' });
      const user2 = await createTestUser({ email: 'user2@test.com' });
      const token1 = generateTestToken(user1);
      const token2 = generateTestToken(user2);

      // User 1 makes 3 requests
      await Promise.all([
        request(app).get('/rate-limited').set('Authorization', `Bearer ${token1}`),
        request(app).get('/rate-limited').set('Authorization', `Bearer ${token1}`),
        request(app).get('/rate-limited').set('Authorization', `Bearer ${token1}`)
      ]);

      // User 1's 4th request should be blocked
      const user1Response = await request(app)
        .get('/rate-limited')
        .set('Authorization', `Bearer ${token1}`);
      
      expectErrorResponse(user1Response, 429);

      // User 2 should still be able to make requests
      const user2Response = await request(app)
        .get('/rate-limited')
        .set('Authorization', `Bearer ${token2}`);
      
      expectSuccessResponse(user2Response, 200);
    });

    test('should include rate limit headers', async () => {
      const response = await request(app).get('/rate-limited');

      expect(response.headers['x-ratelimit-limit']).toBe('3');
      expect(response.headers['x-ratelimit-remaining']).toBe('2');
      expect(response.headers['x-ratelimit-reset']).toBeDefined();
    });
  });

  // ============================================================================
  // SHORTCUT MIDDLEWARE TESTS
  // ============================================================================

  describe('Shortcut Middleware', () => {
    test('adminRequired should work correctly', async () => {
      const admin = await createUserWithRole('ADMIN');
      const client = await createUserWithRole('CLIENT');
      const adminToken = generateTestToken(admin);
      const clientToken = generateTestToken(client);

      // Admin should have access
      const adminResponse = await request(app)
        .get('/shortcuts/admin-required')
        .set('Authorization', `Bearer ${adminToken}`);
      
      expectSuccessResponse(adminResponse, 200);

      // Client should be denied
      const clientResponse = await request(app)
        .get('/shortcuts/admin-required')
        .set('Authorization', `Bearer ${clientToken}`);
      
      expectErrorResponse(clientResponse, 403);
    });

    test('receptionistRequired should work correctly', async () => {
      const admin = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const client = await createUserWithRole('CLIENT');
      
      const adminToken = generateTestToken(admin);
      const receptionistToken = generateTestToken(receptionist);
      const clientToken = generateTestToken(client);

      // Admin and receptionist should have access
      const adminResponse = await request(app)
        .get('/shortcuts/receptionist-required')
        .set('Authorization', `Bearer ${adminToken}`);
      
      const receptionistResponse = await request(app)
        .get('/shortcuts/receptionist-required')
        .set('Authorization', `Bearer ${receptionistToken}`);

      expectSuccessResponse(adminResponse, 200);
      expectSuccessResponse(receptionistResponse, 200);

      // Client should be denied
      const clientResponse = await request(app)
        .get('/shortcuts/receptionist-required')
        .set('Authorization', `Bearer ${clientToken}`);
      
      expectErrorResponse(clientResponse, 403);
    });

    test('clientRequired should allow all roles', async () => {
      const admin = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const client = await createUserWithRole('CLIENT');
      
      const tokens = [
        generateTestToken(admin),
        generateTestToken(receptionist),
        generateTestToken(client)
      ];

      const responses = await Promise.all(
        tokens.map(token => 
          request(app)
            .get('/shortcuts/client-required')
            .set('Authorization', `Bearer ${token}`)
        )
      );

      responses.forEach(response => {
        expectSuccessResponse(response, 200);
      });
    });

    test('verifiedUserRequired should check email verification', async () => {
      const verifiedUser = await createTestUser({ isEmailVerified: true });
      const unverifiedUser = await createTestUser({ isEmailVerified: false });
      
      const verifiedToken = generateTestToken(verifiedUser);
      const unverifiedToken = generateTestToken(unverifiedUser);

      // Verified user should have access
      const verifiedResponse = await request(app)
        .get('/shortcuts/verified-user-required')
        .set('Authorization', `Bearer ${verifiedToken}`);
      
      expectSuccessResponse(verifiedResponse, 200);

      // Unverified user should be denied
      const unverifiedResponse = await request(app)
        .get('/shortcuts/verified-user-required')
        .set('Authorization', `Bearer ${unverifiedToken}`);
      
      expectErrorResponse(unverifiedResponse, 403, 'Vérification d\'email requise');
    });
  });

  // ============================================================================
  // REQUIRE PERMISSION MIDDLEWARE TESTS
  // ============================================================================

  describe('requirePermission Middleware', () => {
    test('should allow access when permission check returns true', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      const app = express();
      app.use(express.json());
      
      const permissionCheck = jest.fn().mockResolvedValue(true);
      
      app.get('/test', 
        authMiddleware.authenticateToken,
        authMiddleware.requirePermission(permissionCheck),
        (req, res) => res.json({ success: true })
      );

      const response = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(permissionCheck).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: user._id.toString(),
          email: user.email,
          role: user.role
        }),
        expect.any(Object)
      );
    });

    test('should deny access when permission check returns false', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      const app = express();
      app.use(express.json());
      
      const permissionCheck = jest.fn().mockResolvedValue(false);
      
      app.get('/test', 
        authMiddleware.authenticateToken,
        authMiddleware.requirePermission(permissionCheck),
        (req, res) => res.json({ success: true })
      );

      const response = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Permission refusée');
      expect(response.body.code).toBe('CUSTOM_PERMISSION_DENIED');
    });

    test('should handle permission check errors', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      const app = express();
      app.use(express.json());
      
      const permissionCheck = jest.fn().mockRejectedValue(new Error('Permission check failed'));
      
      app.get('/test', 
        authMiddleware.authenticateToken,
        authMiddleware.requirePermission(permissionCheck),
        (req, res) => res.json({ success: true })
      );

      const response = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 500, 'Erreur lors de la vérification des permissions');
      expect(response.body.code).toBe('PERMISSION_ERROR');
    });

    test('should require authentication first', async () => {
      const app = express();
      app.use(express.json());
      
      const permissionCheck = jest.fn();
      
      app.get('/test', 
        authMiddleware.requirePermission(permissionCheck),
        (req, res) => res.json({ success: true })
      );

      const response = await request(app).get('/test');

      expectErrorResponse(response, 401, 'Authentification requise');
      expect(permissionCheck).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // COMBINE AUTH MIDDLEWARES TESTS
  // ============================================================================

  describe('combineAuthMiddlewares', () => {
    test('should execute middlewares in order', async () => {
      const user = await createTestUser({ 
        role: 'ADMIN',
        isEmailVerified: true 
      });
      const token = generateTestToken(user);
      
      const app = express();
      app.use(express.json());
      
      const combinedMiddleware = authMiddleware.combineAuthMiddlewares(
        authMiddleware.authenticateToken,
        authMiddleware.requireEmailVerification,
        authMiddleware.authorizeRoles('ADMIN')
      );
      
      app.get('/test', combinedMiddleware, (req, res) => {
        res.json({ 
          success: true,
          user: {
            userId: req.user.userId,
            role: req.user.role,
            isEmailVerified: req.user.isEmailVerified
          }
        });
      });

      const response = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectSuccessResponse(response, 200);
      expect(response.body.user.role).toBe('ADMIN');
    });

    test('should stop execution on first middleware failure', async () => {
      const user = await createTestUser({ 
        role: 'CLIENT', // Wrong role for admin route
        isEmailVerified: true 
      });
      const token = generateTestToken(user);
      
      const app = express();
      app.use(express.json());
      
      const combinedMiddleware = authMiddleware.combineAuthMiddlewares(
        authMiddleware.authenticateToken,
        authMiddleware.authorizeRoles('ADMIN'), // This should fail
        authMiddleware.requireEmailVerification // This should not be reached
      );
      
      app.get('/test', combinedMiddleware, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 403, 'Permissions insuffisantes');
      expect(response.body.current).toBe('CLIENT');
      expect(response.body.required).toContain('ADMIN');
    });

    test('should handle middleware errors gracefully', async () => {
      const app = express();
      app.use(express.json());
      
      const errorMiddleware = (req, res, next) => {
        throw new Error('Middleware error');
      };
      
      const combinedMiddleware = authMiddleware.combineAuthMiddlewares(
        errorMiddleware
      );
      
      app.get('/test', combinedMiddleware, (req, res) => {
        res.json({ success: true });
      });

      const response = await request(app).get('/test');

      expect(response.status).toBe(500);
    });
  });

  // ============================================================================
  // LOG AUTHENTICATED ACCESS TESTS
  // ============================================================================

  describe('logAuthenticatedAccess Middleware', () => {
    test('should log authenticated requests', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const app = express();
      app.use(express.json());
      
      app.get('/test', 
        authMiddleware.authenticateToken,
        authMiddleware.logAuthenticatedAccess,
        (req, res) => res.json({ success: true })
      );

      await request(app)
        .get('/test')
        .set('Authorization', `Bearer ${token}`);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining(`GET /test - User: ${user.email} (${user.role})`)
      );
      
      consoleSpy.mockRestore();
    });

    test('should not log unauthenticated requests', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      const app = express();
      app.use(express.json());
      
      app.get('/test', 
        authMiddleware.logAuthenticatedAccess,
        (req, res) => res.json({ success: true })
      );

      await request(app).get('/test');

      expect(consoleSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('GET /test - User:')
      );
      
      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    test('should handle complete authentication flow', async () => {
      const user = await createTestUser({
        role: 'ADMIN',
        isEmailVerified: true
      });
      
      // Generate token pair
      const tokenPair = jwtUtils.generateTokenPair(user);
      
      // Test protected route access
      const response = await request(app)
        .get('/protected/admin')
        .set('Authorization', `Bearer ${tokenPair.accessToken}`);
      
      expectSuccessResponse(response, 200);
      expect(response.body.user.role).toBe('ADMIN');
      
      // Test token blacklisting
      jwtUtils.blacklistToken(tokenPair.accessToken);
      
      const blacklistedResponse = await request(app)
        .get('/protected/admin')
        .set('Authorization', `Bearer ${tokenPair.accessToken}`);
      
      expectErrorResponse(blacklistedResponse, 401, 'Token révoqué');
    });

    test('should handle role hierarchy correctly', async () => {
      const admin = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const client = await createUserWithRole('CLIENT');
      
      const adminToken = generateTestToken(admin);
      const receptionistToken = generateTestToken(receptionist);
      const clientToken = generateTestToken(client);
      
      // Test admin access to all routes
      const adminRoutes = [
        '/protected/admin',
        '/protected/receptionist', 
        '/protected/client'
      ];
      
      for (const route of adminRoutes) {
        const response = await request(app)
          .get(route)
          .set('Authorization', `Bearer ${adminToken}`);
        expectSuccessResponse(response, 200);
      }
      
      // Test receptionist access
      const receptionistAllowed = ['/protected/receptionist', '/protected/client'];
      const receptionistDenied = ['/protected/admin'];
      
      for (const route of receptionistAllowed) {
        const response = await request(app)
          .get(route)
          .set('Authorization', `Bearer ${receptionistToken}`);
        expectSuccessResponse(response, 200);
      }
      
      for (const route of receptionistDenied) {
        const response = await request(app)
          .get(route)
          .set('Authorization', `Bearer ${receptionistToken}`);
        expectErrorResponse(response, 403);
      }
      
      // Test client access
      const clientAllowed = ['/protected/client'];
      const clientDenied = ['/protected/admin', '/protected/receptionist'];
      
      for (const route of clientAllowed) {
        const response = await request(app)
          .get(route)
          .set('Authorization', `Bearer ${clientToken}`);
        expectSuccessResponse(response, 200);
      }
      
      for (const route of clientDenied) {
        const response = await request(app)
          .get(route)
          .set('Authorization', `Bearer ${clientToken}`);
        expectErrorResponse(response, 403);
      }
    });

    test('should handle multiple middleware combinations', async () => {
      const verifiedAdmin = await createTestUser({
        role: 'ADMIN',
        isEmailVerified: true
      });
      
      const unverifiedAdmin = await createTestUser({
        role: 'ADMIN', 
        isEmailVerified: false,
        email: 'unverified.admin@test.com'
      });
      
      const verifiedToken = generateTestToken(verifiedAdmin);
      const unverifiedToken = generateTestToken(unverifiedAdmin);
      
      // Test verified admin access
      const verifiedResponse = await request(app)
        .get('/shortcuts/verified-user-required')
        .set('Authorization', `Bearer ${verifiedToken}`);
      
      expectSuccessResponse(verifiedResponse, 200);
      
      // Test unverified admin access (should be denied)
      const unverifiedResponse = await request(app)
        .get('/shortcuts/verified-user-required')
        .set('Authorization', `Bearer ${unverifiedToken}`);
      
      expectErrorResponse(unverifiedResponse, 403, 'Vérification d\'email requise');
    });

    test('should handle concurrent requests with rate limiting', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      // Make concurrent requests
      const promises = Array(5).fill().map(() =>
        request(app)
          .get('/rate-limited')
          .set('Authorization', `Bearer ${token}`)
      );
      
      const responses = await Promise.all(promises);
      
      // First 3 should succeed
      responses.slice(0, 3).forEach(response => {
        expectSuccessResponse(response, 200);
      });
      
      // Last 2 should be rate limited
      responses.slice(3).forEach(response => {
        expectErrorResponse(response, 429, 'Trop de requêtes');
      });
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    test('should handle database connection errors gracefully', async () => {
      // Mock a database error
      const originalFindById = require('../../models/User').findById;
      require('../../models/User').findById = jest.fn().mockRejectedValue(
        new Error('Database connection error')
      );
      
      const token = jwtUtils.generateAccessToken({
        userId: '507f1f77bcf86cd799439011',
        email: 'test@test.com',
        role: 'CLIENT'
      });

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);

      expectErrorResponse(response, 500, 'Erreur interne lors de l\'authentification');
      expect(response.body.code).toBe('AUTH_ERROR');
      
      // Restore original method
      require('../../models/User').findById = originalFindById;
    });

    test('should handle malformed JWT gracefully', async () => {
      const malformedTokens = [
        'not.a.jwt.at.all',
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid-json.signature',
        'valid.header.but.too.many.parts.here'
      ];

      for (const token of malformedTokens) {
        const response = await request(app)
          .get('/protected/basic')
          .set('Authorization', `Bearer ${token}`);

        expectErrorResponse(response, 401, 'Token invalide');
        expect(response.body.code).toBe('INVALID_TOKEN');
      }
    });

    test('should handle missing Authorization header formats', async () => {
      const invalidHeaders = [
        'Basic dXNlcjpwYXNzd29yZA==', // Basic auth
        'Token abc123', // Different scheme
        'Bearer', // Missing token
        'Bearer token1 token2', // Multiple tokens
        ''
      ];

      for (const header of invalidHeaders) {
        const response = await request(app)
          .get('/protected/basic')
          .set('Authorization', header);

        expectErrorResponse(response, 401);
        expect(['MISSING_TOKEN', 'INVALID_TOKEN']).toContain(response.body.code);
      }
    });

    test('should handle user model validation errors', async () => {
      // Create token with invalid user data
      const invalidToken = jwtUtils.generateAccessToken({
        userId: 'invalid-mongodb-id',
        email: 'test@test.com',
        role: 'CLIENT'
      });

      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${invalidToken}`);

      expectErrorResponse(response, 500, 'Erreur interne lors de l\'authentification');
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should handle multiple concurrent authenticated requests', async () => {
      const users = await Promise.all(
        Array(10).fill().map((_, i) => 
          createTestUser({ email: `user${i}@test.com` })
        )
      );
      
      const tokens = users.map(user => generateTestToken(user));
      
      const startTime = Date.now();
      
      const promises = tokens.map(token =>
        request(app)
          .get('/protected/basic')
          .set('Authorization', `Bearer ${token}`)
      );
      
      const responses = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // All requests should succeed
      responses.forEach(response => {
        expectSuccessResponse(response, 200);
      });
      
      // Should complete in reasonable time (less than 2 seconds for 10 requests)
      expect(duration).toBeLessThan(2000);
    });

    test('should efficiently validate tokens', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      const startTime = Date.now();
      
      // Make 50 requests to test token validation performance
      const promises = Array(50).fill().map(() =>
        request(app)
          .get('/protected/basic')
          .set('Authorization', `Bearer ${token}`)
      );
      
      const responses = await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // All requests should succeed
      responses.forEach(response => {
        expectSuccessResponse(response, 200);
      });
      
      // Should complete efficiently (less than 3 seconds for 50 requests)
      expect(duration).toBeLessThan(3000);
    });

    test('should handle rate limiting efficiently', async () => {
      const startTime = Date.now();
      
      // Make requests that will hit rate limit
      const promises = Array(10).fill().map(() =>
        request(app).get('/rate-limited')
      );
      
      await Promise.all(promises);
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Rate limiting should not add significant overhead
      expect(duration).toBeLessThan(1000);
    });
  });

  // ============================================================================
  // EDGE CASES TESTS
  // ============================================================================

  describe('Edge Cases', () => {
    test('should handle user account state changes during request', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      // Deactivate user after token generation
      user.isActive = false;
      await user.save();
      
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);
      
      expectErrorResponse(response, 403, 'Compte désactivé');
    });

    test('should handle user deletion during request', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      // Delete user after token generation
      await user.deleteOne();
      
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);
      
      expectErrorResponse(response, 401, 'Utilisateur non trouvé');
    });

    test('should handle expired lock during request', async () => {
      const user = await createTestUser();
      
      // Set lock that will expire very soon
      user.lockUntil = new Date(Date.now() + 100); // 100ms from now
      await user.save();
      
      const token = generateTestToken(user);
      
      // Wait for lock to expire
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);
      
      // Should succeed because lock expired
      expectSuccessResponse(response, 200);
    });

    test('should handle missing user properties gracefully', async () => {
      const user = await createTestUser();
      const token = generateTestToken(user);
      
      // Remove some user properties
      delete user.fullName;
      delete user.companyName;
      
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${token}`);
      
      expectSuccessResponse(response, 200);
      expect(response.body.user.userId).toBe(user._id.toString());
    });

    test('should handle very long tokens', async () => {
      const user = await createTestUser();
      
      // Create token with very long payload
      const longPayload = {
        userId: user._id.toString(),
        email: user.email,
        role: user.role,
        extraData: 'a'.repeat(1000) // Long string
      };
      
      const longToken = jwtUtils.generateAccessToken(longPayload);
      
      const response = await request(app)
        .get('/protected/basic')
        .set('Authorization', `Bearer ${longToken}`);
      
      expectSuccessResponse(response, 200);
    });

    test('should handle special characters in Authorization header', async () => {
      const specialTokens = [
        'Bearer token-with-dashes',
        'Bearer token_with_underscores',
        'Bearer token.with.dots',
        'Bearer token+with+plus'
      ];
      
      for (const authHeader of specialTokens) {
        const response = await request(app)
          .get('/protected/basic')
          .set('Authorization', authHeader);
        
        // Should handle gracefully (will be invalid JWT but not crash)
        expectErrorResponse(response, 401);
      }
    });
  });
});