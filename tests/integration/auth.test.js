const request = require('supertest');
const mongoose = require('mongoose');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserWithRole,
  createCompanyUser,
  generateTestToken,
  generateExpiredToken,
  createAuthHeaders,
  authenticatedRequest,
  expectErrorResponse,
  expectSuccessResponse,
  expectValidToken,
  expectUserProperties,
  getInvalidUserData,
  cleanupTestUsers
} = require('../setup/test-helpers');

// Models
const User = require('../../models/User');

// App setup (assuming you have an app.js or server.js)
const app = require('../../app'); // Adjust path as needed

describe('Authentication API Integration Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // REGISTRATION ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/register', () => {
    test('should register new user successfully', async () => {
      const userData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'john.doe@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expectSuccessResponse(response, 201);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('tokenType', 'Bearer');
      expect(response.body).toHaveProperty('expiresIn');

      // Verify user properties
      expectUserProperties(response.body.user);
      expect(response.body.user.firstName).toBe(userData.firstName);
      expect(response.body.user.lastName).toBe(userData.lastName);
      expect(response.body.user.email).toBe(userData.email.toLowerCase());
      expect(response.body.user.role).toBe('CLIENT');

      // Verify tokens
      expectValidToken(response.body.accessToken);
      expectValidToken(response.body.refreshToken);

      // Verify user was created in database
      const userInDb = await User.findOne({ email: userData.email.toLowerCase() });
      expect(userInDb).toBeTruthy();
      expect(userInDb.firstName).toBe(userData.firstName);
    });

    test('should register company user successfully', async () => {
      const companyData = {
        firstName: 'Jane',
        lastName: 'Smith',
        email: 'jane.smith@company.com',
        password: 'password123',
        phone: '0123456788',
        companyName: 'Test Company SARL',
        siret: '12345678901234'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(companyData)
        .expect(201);

      expectSuccessResponse(response, 201);

      // Verify company-specific properties
      expect(response.body.user.companyName).toBe(companyData.companyName);
      expect(response.body.user.clientType).toBe('COMPANY');

      // Verify in database
      const userInDb = await User.findOne({ email: companyData.email.toLowerCase() });
      expect(userInDb.siret).toBe(companyData.siret);
      expect(userInDb.clientType).toBe('COMPANY');
    });

    test('should reject registration with missing required fields', async () => {
      const invalidData = getInvalidUserData();

      // Test missing firstName
      await request(app)
        .post('/api/auth/register')
        .send(invalidData.noFirstName)
        .expect(400);

      // Test missing email
      await request(app)
        .post('/api/auth/register')
        .send(invalidData.noEmail)
        .expect(400);

      // Test missing password
      const noPassword = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(noPassword)
        .expect(400);

      expectErrorResponse(response, 400);
      expect(response.body.required).toContain('password');
    });

    test('should reject registration with invalid email format', async () => {
      const invalidEmailData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'invalid-email',
        password: 'password123',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidEmailData)
        .expect(400);

      expectErrorResponse(response, 400, 'validation');
    });

    test('should reject registration with weak password', async () => {
      const weakPasswordData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        password: '123', // Too short
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(weakPasswordData)
        .expect(400);

      expectErrorResponse(response, 400, 'mot de passe');
    });

    test('should reject registration with invalid phone format', async () => {
      const invalidPhoneData = {
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        password: 'password123',
        phone: '123' // Invalid format
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(invalidPhoneData)
        .expect(400);

      expectErrorResponse(response, 400, 'téléphone');
    });

    test('should reject duplicate email registration', async () => {
      const userData = {
        firstName: 'First',
        lastName: 'User',
        email: 'duplicate@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      // First registration should succeed
      await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // Second registration with same email should fail
      const duplicateData = {
        ...userData,
        firstName: 'Second'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(duplicateData)
        .expect(409);

      expectErrorResponse(response, 409, 'email');
      expect(response.body.field).toBe('email');
    });

    test('should reject duplicate SIRET registration', async () => {
      const siret = '98765432109876';
      
      const firstCompany = {
        firstName: 'First',
        lastName: 'Company',
        email: 'first@company.com',
        password: 'password123',
        phone: '0123456789',
        companyName: 'First Company',
        siret
      };

      // First registration should succeed
      await request(app)
        .post('/api/auth/register')
        .send(firstCompany)
        .expect(201);

      // Second registration with same SIRET should fail
      const secondCompany = {
        ...firstCompany,
        email: 'second@company.com',
        companyName: 'Second Company'
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(secondCompany)
        .expect(409);

      expectErrorResponse(response, 409, 'SIRET');
    });

    test('should handle rate limiting on registration', async () => {
      const userData = {
        firstName: 'Rate',
        lastName: 'Test',
        password: 'password123',
        phone: '0123456789'
      };

      // Make multiple registration attempts rapidly
      const promises = [];
      for (let i = 0; i < 12; i++) { // Exceed rate limit of 10/15min
        promises.push(
          request(app)
            .post('/api/auth/register')
            .send({
              ...userData,
              email: `rate${i}@test.com`
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429)
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);

      // Check rate limit headers
      const rateLimitedResponse = rateLimitedResponses[0];
      expect(rateLimitedResponse.headers).toHaveProperty('x-ratelimit-limit');
      expect(rateLimitedResponse.headers).toHaveProperty('x-ratelimit-remaining');
    });
  });

  // ============================================================================
  // LOGIN ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'login@test.com',
        password: 'password123'
      });
    });

    test('should login successfully with valid credentials', async () => {
      const loginData = {
        email: 'login@test.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expectSuccessResponse(response, 200);

      // Verify response structure
      expect(response.body).toHaveProperty('user');
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expect(response.body).toHaveProperty('tokenType', 'Bearer');

      // Verify user data
      expectUserProperties(response.body.user);
      expect(response.body.user.email).toBe(loginData.email.toLowerCase());

      // Verify tokens
      expectValidToken(response.body.accessToken);
      expectValidToken(response.body.refreshToken);

      // Verify lastLogin was updated
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.lastLogin).toBeTruthy();
    });

    test('should login with remember me option', async () => {
      const loginData = {
        email: 'login@test.com',
        password: 'password123',
        rememberMe: true
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expectSuccessResponse(response, 200);
      expect(response.body.rememberMe).toBe(true);

      // Token should have longer expiration (this would need to be verified by decoding)
      expectValidToken(response.body.accessToken);
    });

    test('should reject login with invalid email', async () => {
      const loginData = {
        email: 'nonexistent@test.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expectErrorResponse(response, 401, 'Identifiants invalides');
      expect(response.body.field).toBe('email');
    });

    test('should reject login with invalid password', async () => {
      const loginData = {
        email: 'login@test.com',
        password: 'wrongpassword'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expectErrorResponse(response, 401, 'Identifiants invalides');
      expect(response.body.field).toBe('password');
    });

    test('should reject login with missing credentials', async () => {
      // Missing email
      await request(app)
        .post('/api/auth/login')
        .send({ password: 'password123' })
        .expect(400);

      // Missing password
      await request(app)
        .post('/api/auth/login')
        .send({ email: 'test@test.com' })
        .expect(400);
    });

    test('should handle account locking after failed attempts', async () => {
      const loginData = {
        email: 'login@test.com',
        password: 'wrongpassword'
      };

      // Make 5 failed login attempts
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/api/auth/login')
          .send(loginData)
          .expect(401);
      }

      // 6th attempt should return account locked
      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(423);

      expectErrorResponse(response, 423, 'verrouillé');
      expect(response.body).toHaveProperty('lockTimeRemaining');
      expect(response.body).toHaveProperty('unlockAt');
    });

    test('should reject login for inactive account', async () => {
      // Deactivate the user
      await User.findByIdAndUpdate(testUser._id, { isActive: false });

      const loginData = {
        email: 'login@test.com',
        password: 'password123'
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(403);

      expectErrorResponse(response, 403, 'désactivé');
      expect(response.body.reason).toBe('ACCOUNT_DISABLED');
    });

    test('should handle rate limiting on login', async () => {
      const loginData = {
        email: 'login@test.com',
        password: 'wrongpassword'
      };

      // Make multiple login attempts rapidly (exceeding 5/15min limit)
      const promises = [];
      for (let i = 0; i < 7; i++) {
        promises.push(
          request(app)
            .post('/api/auth/login')
            .send(loginData)
        );
      }

      const responses = await Promise.all(promises);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // LOGOUT ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/logout', () => {
    let testUser, authTokens;

    beforeEach(async () => {
      testUser = await createTestUser();
      
      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'password123'
        });
      
      authTokens = {
        accessToken: loginResponse.body.accessToken,
        refreshToken: loginResponse.body.refreshToken
      };
    });

    test('should logout successfully with valid token', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .send({ refreshToken: authTokens.refreshToken })
        .expect(200);

      expectSuccessResponse(response, 200);
      expect(response.body).toHaveProperty('logoutTime');
    });

    test('should logout without authentication (optional auth)', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: authTokens.refreshToken })
        .expect(200);

      expectSuccessResponse(response, 200);
    });

    test('should blacklist tokens after logout', async () => {
      // Logout
      await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .send({ refreshToken: authTokens.refreshToken })
        .expect(200);

      // Try to use the access token - should fail
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${authTokens.accessToken}`)
        .expect(401);

      expectErrorResponse(response, 401, 'révoqué');
    });
  });

  // ============================================================================
  // TOKEN REFRESH ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/refresh', () => {
    let testUser, refreshToken;

    beforeEach(async () => {
      testUser = await createTestUser();
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'password123'
        });
      
      refreshToken = loginResponse.body.refreshToken;
    });

    test('should refresh token successfully', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expectSuccessResponse(response, 200);

      // Verify response structure
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('tokenType', 'Bearer');
      expect(response.body).toHaveProperty('expiresIn');
      expect(response.body).toHaveProperty('user');

      // Verify new token is valid
      expectValidToken(response.body.accessToken);

      // Verify user data
      expectUserProperties(response.body.user);
    });

    test('should reject refresh with missing token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({})
        .expect(400);

      expectErrorResponse(response, 400, 'Refresh token requis');
      expect(response.body.required).toContain('refreshToken');
    });

    test('should reject refresh with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: 'invalid.token.here' })
        .expect(401);

      expectErrorResponse(response, 401);
      expect(response.body.code).toBe('TOKEN_REFRESH_FAILED');
    });

    test('should reject refresh with expired token', async () => {
      const expiredToken = generateExpiredToken(testUser);

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: expiredToken })
        .expect(401);

      expectErrorResponse(response, 401, 'expiré');
    });

    test('should reject refresh for inactive user', async () => {
      // Deactivate user
      await User.findByIdAndUpdate(testUser._id, { isActive: false });

      const response = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(401);

      expectErrorResponse(response, 401, 'inactif');
    });

    test('should handle rate limiting on refresh', async () => {
      // Make many refresh requests rapidly (exceeding 20/15min limit)
      const promises = [];
      for (let i = 0; i < 22; i++) {
        promises.push(
          request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // GET PROFILE ENDPOINT TESTS
  // ============================================================================

  describe('GET /api/auth/me', () => {
    let testUser, accessToken;

    beforeEach(async () => {
      testUser = await createTestUser({
        firstName: 'Profile',
        lastName: 'Test'
      });
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'password123'
        });
      
      accessToken = loginResponse.body.accessToken;
    });

    test('should get user profile successfully', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expectSuccessResponse(response, 200);

      // Verify user data
      expect(response.body).toHaveProperty('user');
      expectUserProperties(response.body.user);
      expect(response.body.user.firstName).toBe('Profile');
      expect(response.body.user.lastName).toBe('Test');
      expect(response.body.user.email).toBe(testUser.email);
    });

    test('should reject profile request without token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
      expect(response.body.code).toBe('MISSING_TOKEN');
    });

    test('should reject profile request with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expectErrorResponse(response, 401, 'Token invalide');
    });

    test('should reject profile request with expired token', async () => {
      const expiredToken = generateExpiredToken(testUser);

      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expectErrorResponse(response, 401, 'Token expiré');
    });
  });

  // ============================================================================
  // FORGOT PASSWORD ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/forgot-password', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'forgot@test.com'
      });
    });

    test('should send forgot password email for existing user', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'forgot@test.com' })
        .expect(200);

      expectSuccessResponse(response, 200);
      expect(response.body.email).toBe('forgot@test.com');

      // Verify reset token was created in database
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.resetPasswordToken).toBeTruthy();
      expect(updatedUser.resetPasswordExpires).toBeTruthy();
    });

    test('should return success even for non-existent email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' })
        .expect(200);

      // Should return same response to prevent email enumeration
      expectSuccessResponse(response, 200);
      expect(response.body.message).toContain('Si cette adresse email existe');
    });

    test('should reject forgot password without email', async () => {
      const response = await request(app)
        .post('/api/auth/forgot-password')
        .send({})
        .expect(400);

      expectErrorResponse(response, 400, 'email requise');
      expect(response.body.required).toContain('email');
    });

    test('should handle rate limiting on forgot password', async () => {
      // Make multiple requests rapidly (exceeding 3/15min limit)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/auth/forgot-password')
            .send({ email: 'forgot@test.com' })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // RESET PASSWORD ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/reset-password/:token', () => {
    let testUser, resetToken;

    beforeEach(async () => {
      testUser = await createTestUser();
      resetToken = testUser.createPasswordResetToken();
      await testUser.save();
    });

    test('should reset password successfully with valid token', async () => {
      const newPasswordData = {
        password: 'newpassword123',
        confirmPassword: 'newpassword123'
      };

      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send(newPasswordData)
        .expect(200);

      expectSuccessResponse(response, 200);

      // Should return new tokens for automatic login
      expect(response.body).toHaveProperty('accessToken');
      expect(response.body).toHaveProperty('refreshToken');
      expectValidToken(response.body.accessToken);

      // Verify password was changed
      const updatedUser = await User.findById(testUser._id).select('+password');
      const isNewPasswordValid = await updatedUser.comparePassword('newpassword123');
      expect(isNewPasswordValid).toBe(true);

      // Verify reset token was cleared
      expect(updatedUser.resetPasswordToken).toBeUndefined();
      expect(updatedUser.resetPasswordExpires).toBeUndefined();
    });

    test('should reject reset with invalid token', async () => {
      const response = await request(app)
        .post('/api/auth/reset-password/invalidtoken123')
        .send({
          password: 'newpassword123',
          confirmPassword: 'newpassword123'
        })
        .expect(400);

      expectErrorResponse(response, 400, 'invalide');
      expect(response.body.code).toBe('INVALID_RESET_TOKEN');
    });

    test('should reject reset with expired token', async () => {
      // Manually expire the token
      await User.findByIdAndUpdate(testUser._id, {
        resetPasswordExpires: new Date(Date.now() - 1000) // 1 second ago
      });

      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: 'newpassword123',
          confirmPassword: 'newpassword123'
        })
        .expect(400);

      expectErrorResponse(response, 400, 'expiré');
    });

    test('should reject reset with mismatched passwords', async () => {
      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: 'newpassword123',
          confirmPassword: 'differentpassword'
        })
        .expect(400);

      expectErrorResponse(response, 400, 'correspondent pas');
      expect(response.body.field).toBe('confirmPassword');
    });

    test('should reject reset with weak password', async () => {
      const response = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: '123', // Too short
          confirmPassword: '123'
        })
        .expect(400);

      expectErrorResponse(response, 400, 'caractères');
      expect(response.body.field).toBe('password');
    });
  });

  // ============================================================================
  // EMAIL VERIFICATION ENDPOINT TESTS
  // ============================================================================

  describe('GET /api/auth/verify-email/:token', () => {
    let testUser, verificationToken;

    beforeEach(async () => {
      testUser = await createTestUser({
        isEmailVerified: false
      });
      verificationToken = testUser.createEmailVerificationToken();
      await testUser.save();
    });

    test('should verify email successfully with valid token', async () => {
      const response = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`)
        .expect(200);

      expectSuccessResponse(response, 200);

      // Verify response
      expect(response.body.user.isEmailVerified).toBe(true);
      expect(response.body).toHaveProperty('verifiedAt');

      // Verify in database
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.isEmailVerified).toBe(true);
      expect(updatedUser.emailVerificationToken).toBeUndefined();
    });

    test('should reject verification with invalid token', async () => {
      const response = await request(app)
        .get('/api/auth/verify-email/invalidtoken123')
        .expect(400);

      expectErrorResponse(response, 400, 'invalide');
      expect(response.body.code).toBe('INVALID_VERIFICATION_TOKEN');
    });

    test('should reject verification with expired token', async () => {
      // Manually expire the token
      await User.findByIdAndUpdate(testUser._id, {
        emailVerificationExpires: new Date(Date.now() - 1000)
      });

      const response = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`)
        .expect(400);

      expectErrorResponse(response, 400, 'expiré');
    });
  });

  // ============================================================================
  // RESEND VERIFICATION ENDPOINT TESTS
  // ============================================================================

  describe('POST /api/auth/resend-verification', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'unverified@test.com',
        isEmailVerified: false
      });
    });

    test('should resend verification email successfully', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@test.com' })
        .expect(200);

      expectSuccessResponse(response, 200);
      expect(response.body.email).toBe('unverified@test.com');

      // Verify new token was created
      const updatedUser = await User.findById(testUser._id);
      expect(updatedUser.emailVerificationToken).toBeTruthy();
      expect(updatedUser.emailVerificationExpires).toBeTruthy();
    });

    test('should reject resend for verified email', async () => {
      // Verify the email first
      await User.findByIdAndUpdate(testUser._id, { isEmailVerified: true });

      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'unverified@test.com' })
        .expect(404);

      expectErrorResponse(response, 404, 'déjà vérifié');
    });

    test('should reject resend for non-existent email', async () => {
      const response = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'nonexistent@test.com' })
        .expect(404);

      expectErrorResponse(response, 404, 'non trouvé');
    });

    test('should handle rate limiting on resend verification', async () => {
      // Make multiple requests rapidly (exceeding 3/15min limit)
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/auth/resend-verification')
            .send({ email: 'unverified@test.com' })
        );
      }

      const responses = await Promise.all(promises);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // CHANGE PASSWORD ENDPOINT TESTS
  // ============================================================================

  describe('PUT /api/auth/change-password', () => {
    let testUser, accessToken;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'changepass@test.com',
        password: 'oldpassword123'
      });
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'changepass@test.com',
          password: 'oldpassword123'
        });
      
      accessToken = loginResponse.body.accessToken;
    });

    test('should change password successfully', async () => {
      const changePasswordData = {
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(changePasswordData)
        .expect(200);

      expectSuccessResponse(response, 200);
      expect(response.body).toHaveProperty('changedAt');

      // Verify password was changed
      const updatedUser = await User.findById(testUser._id).select('+password');
      const isNewPasswordValid = await updatedUser.comparePassword('newpassword123');
      const isOldPasswordInvalid = await updatedUser.comparePassword('oldpassword123');
      
      expect(isNewPasswordValid).toBe(true);
      expect(isOldPasswordInvalid).toBe(false);
    });

    test('should reject change with wrong current password', async () => {
      const changePasswordData = {
        currentPassword: 'wrongpassword',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(changePasswordData)
        .expect(401);

      expectErrorResponse(response, 401, 'incorrect');
      expect(response.body.field).toBe('currentPassword');
    });

    test('should reject change with mismatched new passwords', async () => {
      const changePasswordData = {
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
        confirmPassword: 'differentpassword'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(changePasswordData)
        .expect(400);

      expectErrorResponse(response, 400, 'correspondent pas');
      expect(response.body.field).toBe('confirmPassword');
    });

    test('should reject change with weak new password', async () => {
      const changePasswordData = {
        currentPassword: 'oldpassword123',
        newPassword: '123', // Too short
        confirmPassword: '123'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(changePasswordData)
        .expect(400);

      expectErrorResponse(response, 400, 'caractères');
      expect(response.body.field).toBe('newPassword');
    });

    test('should require authentication for password change', async () => {
      const changePasswordData = {
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123'
      };

      const response = await request(app)
        .put('/api/auth/change-password')
        .send(changePasswordData)
        .expect(401);

      expectErrorResponse(response, 401, 'Token d\'accès requis');
    });

    test('should handle rate limiting on password change', async () => {
      const changePasswordData = {
        currentPassword: 'oldpassword123',
        newPassword: 'newpassword123',
        confirmPassword: 'newpassword123'
      };

      // Make multiple requests rapidly (exceeding 5/15min limit)
      const promises = [];
      for (let i = 0; i < 7; i++) {
        promises.push(
          request(app)
            .put('/api/auth/change-password')
            .set('Authorization', `Bearer ${accessToken}`)
            .send(changePasswordData)
        );
      }

      const responses = await Promise.all(promises);
      
      // Some should be rate limited
      const rateLimitedResponses = responses.filter(res => res.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });

  // ============================================================================
  // ADMIN ENDPOINTS TESTS
  // ============================================================================

  describe('Admin Endpoints', () => {
    let adminUser, receptionistUser, clientUser;
    let adminToken, receptionistToken, clientToken;

    beforeEach(async () => {
      // Create users with different roles
      adminUser = await createUserWithRole('ADMIN');
      receptionistUser = await createUserWithRole('RECEPTIONIST');
      clientUser = await createUserWithRole('CLIENT');

      // Login each user to get tokens
      const adminLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: adminUser.email,
          password: 'password123'
        });
      adminToken = adminLogin.body.accessToken;

      const receptionistLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: receptionistUser.email,
          password: 'password123'
        });
      receptionistToken = receptionistLogin.body.accessToken;

      const clientLogin = await request(app)
        .post('/api/auth/login')
        .send({
          email: clientUser.email,
          password: 'password123'
        });
      clientToken = clientLogin.body.accessToken;
    });

    describe('POST /api/auth/admin/users', () => {
      test('should allow admin to create receptionist user', async () => {
        const newUserData = {
          firstName: 'New',
          lastName: 'Receptionist',
          email: 'newreceptionist@test.com',
          password: 'password123',
          phone: '0123456789',
          role: 'RECEPTIONIST'
        };

        const response = await request(app)
          .post('/api/auth/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(newUserData)
          .expect(201);

        expectSuccessResponse(response, 201);
        expect(response.body.user.role).toBe('RECEPTIONIST');
        expect(response.body.user.createdBy).toBe(adminUser._id.toString());
      });

      test('should allow admin to create admin user', async () => {
        const newAdminData = {
          firstName: 'New',
          lastName: 'Admin',
          email: 'newadmin@test.com',
          password: 'password123',
          phone: '0123456789',
          role: 'ADMIN'
        };

        const response = await request(app)
          .post('/api/auth/admin/users')
          .set('Authorization', `Bearer ${adminToken}`)
          .send(newAdminData)
          .expect(201);

        expectSuccessResponse(response, 201);
        expect(response.body.user.role).toBe('ADMIN');
      });

      test('should reject non-admin user creating privileged accounts', async () => {
        const newUserData = {
          firstName: 'Unauthorized',
          lastName: 'User',
          email: 'unauthorized@test.com',
          password: 'password123',
          phone: '0123456789',
          role: 'RECEPTIONIST'
        };

        // Receptionist trying to create another receptionist
        const receptionistResponse = await request(app)
          .post('/api/auth/admin/users')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .send(newUserData)
          .expect(403);

        expectErrorResponse(receptionistResponse, 403, 'permissions');

        // Client trying to create receptionist
        const clientResponse = await request(app)
          .post('/api/auth/admin/users')
          .set('Authorization', `Bearer ${clientToken}`)
          .send(newUserData)
          .expect(403);

        expectErrorResponse(clientResponse, 403, 'permissions');
      });

      test('should require authentication for admin user creation', async () => {
        const newUserData = {
          firstName: 'No',
          lastName: 'Auth',
          email: 'noauth@test.com',
          password: 'password123',
          phone: '0123456789',
          role: 'RECEPTIONIST'
        };

        const response = await request(app)
          .post('/api/auth/admin/users')
          .send(newUserData)
          .expect(401);

        expectErrorResponse(response, 401, 'Token d\'accès requis');
      });
    });

    describe('PATCH /api/auth/admin/users/:userId/toggle-status', () => {
      test('should allow admin to toggle user status', async () => {
        const response = await request(app)
          .patch(`/api/auth/admin/users/${clientUser._id}/toggle-status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expectSuccessResponse(response, 200);
        expect(response.body.user.isActive).toBe(false); // Should be toggled to false

        // Verify in database
        const updatedUser = await User.findById(clientUser._id);
        expect(updatedUser.isActive).toBe(false);
      });

      test('should reject non-admin user toggling status', async () => {
        const response = await request(app)
          .patch(`/api/auth/admin/users/${clientUser._id}/toggle-status`)
          .set('Authorization', `Bearer ${receptionistToken}`)
          .expect(403);

        expectErrorResponse(response, 403, 'permissions');
      });

      test('should return 404 for non-existent user', async () => {
        const fakeUserId = new mongoose.Types.ObjectId();
        
        const response = await request(app)
          .patch(`/api/auth/admin/users/${fakeUserId}/toggle-status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(404);

        expectErrorResponse(response, 404, 'non trouvé');
      });
    });

    describe('PATCH /api/auth/admin/users/:userId/unlock', () => {
      test('should allow admin to unlock user account', async () => {
        // First lock the account by failing login attempts
        for (let i = 0; i < 5; i++) {
          await request(app)
            .post('/api/auth/login')
            .send({
              email: clientUser.email,
              password: 'wrongpassword'
            });
        }

        // Verify account is locked
        const lockedUser = await User.findById(clientUser._id);
        expect(lockedUser.isLocked).toBe(true);

        // Unlock with admin
        const response = await request(app)
          .patch(`/api/auth/admin/users/${clientUser._id}/unlock`)
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expectSuccessResponse(response, 200);
        expect(response.body.user.isLocked).toBe(false);

        // Verify in database
        const unlockedUser = await User.findById(clientUser._id);
        expect(unlockedUser.isLocked).toBe(false);
      });

      test('should reject non-admin user unlocking accounts', async () => {
        const response = await request(app)
          .patch(`/api/auth/admin/users/${clientUser._id}/unlock`)
          .set('Authorization', `Bearer ${clientToken}`)
          .expect(403);

        expectErrorResponse(response, 403, 'permissions');
      });
    });

    describe('GET /api/auth/admin/stats', () => {
      test('should return authentication statistics for admin', async () => {
        const response = await request(app)
          .get('/api/auth/admin/stats')
          .set('Authorization', `Bearer ${adminToken}`)
          .expect(200);

        expectSuccessResponse(response, 200);

        // Verify stats structure
        expect(response.body).toHaveProperty('stats');
        expect(response.body.stats).toHaveProperty('totalUsers');
        expect(response.body.stats).toHaveProperty('activeUsers');
        expect(response.body.stats).toHaveProperty('lockedUsers');
        expect(response.body.stats).toHaveProperty('unverifiedEmails');
        expect(response.body.stats).toHaveProperty('usersByRole');
        expect(response.body.stats).toHaveProperty('generatedAt');

        // Verify stats values
        expect(response.body.stats.totalUsers).toBeGreaterThan(0);
        expect(response.body.stats.usersByRole).toBeInstanceOf(Array);
      });

      test('should reject non-admin user accessing stats', async () => {
        const response = await request(app)
          .get('/api/auth/admin/stats')
          .set('Authorization', `Bearer ${receptionistToken}`)
          .expect(403);

        expectErrorResponse(response, 403, 'permissions');
      });

      test('should require authentication for stats', async () => {
        const response = await request(app)
          .get('/api/auth/admin/stats')
          .expect(401);

        expectErrorResponse(response, 401, 'Token d\'accès requis');
      });
    });
  });

  // ============================================================================
  // DEVELOPMENT ENDPOINTS TESTS (if NODE_ENV === 'development')
  // ============================================================================

  describe('Development Endpoints', () => {
    const originalEnv = process.env.NODE_ENV;

    beforeAll(() => {
      process.env.NODE_ENV = 'development';
    });

    afterAll(() => {
      process.env.NODE_ENV = originalEnv;
    });

    let testUser, accessToken;

    beforeEach(async () => {
      testUser = await createTestUser();
      
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: testUser.email,
          password: 'password123'
        });
      
      accessToken = loginResponse.body.accessToken;
    });

    describe('GET /api/auth/dev/token-info', () => {
      test('should return token information in development', async () => {
        const response = await request(app)
          .get('/api/auth/dev/token-info')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        expectSuccessResponse(response, 200);

        // Verify token info structure
        expect(response.body).toHaveProperty('tokenInfo');
        expect(response.body.tokenInfo).toHaveProperty('expiresAt');
        expect(response.body.tokenInfo).toHaveProperty('isExpired');
        expect(response.body.tokenInfo).toHaveProperty('user');
        expect(response.body.tokenInfo).toHaveProperty('issued');
        expect(response.body.tokenInfo).toHaveProperty('expires');
      });

      test('should require authentication for token info', async () => {
        const response = await request(app)
          .get('/api/auth/dev/token-info')
          .expect(401);

        expectErrorResponse(response, 401, 'Token d\'accès requis');
      });
    });

    describe('POST /api/auth/dev/cleanup-blacklist', () => {
      test('should cleanup blacklist in development', async () => {
        const adminUser = await createUserWithRole('ADMIN');
        const adminLogin = await request(app)
          .post('/api/auth/login')
          .send({
            email: adminUser.email,
            password: 'password123'
          });

        const response = await request(app)
          .post('/api/auth/dev/cleanup-blacklist')
          .set('Authorization', `Bearer ${adminLogin.body.accessToken}`)
          .expect(200);

        expectSuccessResponse(response, 200);
        expect(response.body).toHaveProperty('cleanedCount');
        expect(typeof response.body.cleanedCount).toBe('number');
      });

      test('should require admin role for blacklist cleanup', async () => {
        const response = await request(app)
          .post('/api/auth/dev/cleanup-blacklist')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(403);

        expectErrorResponse(response, 403, 'permissions');
      });
    });
  });

  // ============================================================================
  // COMPREHENSIVE WORKFLOW TESTS
  // ============================================================================

  describe('Complete Authentication Workflows', () => {
    test('should complete full registration to profile workflow', async () => {
      // 1. Register
      const userData = {
        firstName: 'Workflow',
        lastName: 'Test',
        email: 'workflow@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      expectSuccessResponse(registerResponse, 201);
      const { accessToken, refreshToken } = registerResponse.body;

      // 2. Get profile
      const profileResponse = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expectSuccessResponse(profileResponse, 200);
      expect(profileResponse.body.user.email).toBe(userData.email.toLowerCase());

      // 3. Refresh token
      const refreshResponse = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expectSuccessResponse(refreshResponse, 200);
      expect(refreshResponse.body.accessToken).toBeTruthy();

      // 4. Logout
      const logoutResponse = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(200);

      expectSuccessResponse(logoutResponse, 200);

      // 5. Verify tokens are blacklisted
      await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(401);
    });

    test('should complete full password reset workflow', async () => {
      // 1. Create user
      const testUser = await createTestUser({
        email: 'resetworkflow@test.com'
      });

      // 2. Request password reset
      const forgotResponse = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: 'resetworkflow@test.com' })
        .expect(200);

      expectSuccessResponse(forgotResponse, 200);

      // 3. Get reset token from database (in real app, this would come from email)
      const userWithToken = await User.findById(testUser._id);
      expect(userWithToken.resetPasswordToken).toBeTruthy();

      // 4. Reset password (we need the original token, not the hashed one)
      // For testing purposes, we'll create a new reset token
      const resetToken = testUser.createPasswordResetToken();
      await testUser.save();

      const resetResponse = await request(app)
        .post(`/api/auth/reset-password/${resetToken}`)
        .send({
          password: 'newpassword123',
          confirmPassword: 'newpassword123'
        })
        .expect(200);

      expectSuccessResponse(resetResponse, 200);
      expect(resetResponse.body.accessToken).toBeTruthy();

      // 5. Login with new password
      const loginResponse = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'resetworkflow@test.com',
          password: 'newpassword123'
        })
        .expect(200);

      expectSuccessResponse(loginResponse, 200);
    });

    test('should handle complete email verification workflow', async () => {
      // 1. Register user (email unverified by default)
      const userData = {
        firstName: 'Email',
        lastName: 'Verification',
        email: 'emailverify@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send(userData)
        .expect(201);

      // 2. User should not be email verified initially
      expect(registerResponse.body.user.isEmailVerified).toBe(false);

      // 3. Resend verification email
      const resendResponse = await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: 'emailverify@test.com' })
        .expect(200);

      expectSuccessResponse(resendResponse, 200);

      // 4. Get verification token from database
      const userWithToken = await User.findOne({ email: 'emailverify@test.com' });
      expect(userWithToken.emailVerificationToken).toBeTruthy();

      // 5. Create verification token for testing
      const verificationToken = userWithToken.createEmailVerificationToken();
      await userWithToken.save();

      // 6. Verify email
      const verifyResponse = await request(app)
        .get(`/api/auth/verify-email/${verificationToken}`)
        .expect(200);

      expectSuccessResponse(verifyResponse, 200);
      expect(verifyResponse.body.user.isEmailVerified).toBe(true);
    });
  });

  // ============================================================================
  // ERROR HANDLING AND EDGE CASES
  // ============================================================================

  describe('Error Handling and Edge Cases', () => {
    test('should handle malformed request bodies gracefully', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send('invalid json')
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    test('should handle very long input strings', async () => {
      const longString = 'a'.repeat(1000);
      
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          firstName: longString,
          lastName: 'Test',
          email: 'long@test.com',
          password: 'password123',
          phone: '0123456789'
        })
        .expect(400);

      expectErrorResponse(response, 400);
    });

    test('should handle concurrent user creation', async () => {
      const userData = {
        firstName: 'Concurrent',
        lastName: 'Test',
        password: 'password123',
        phone: '0123456789'
      };

      // Create multiple users concurrently
      const promises = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/auth/register')
            .send({
              ...userData,
              email: `concurrent${i}@test.com`
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // All should succeed with different emails
      responses.forEach(response => {
        expect(response.status).toBe(201);
      });
    });

    test('should handle database connection issues gracefully', async () => {
      // This test would require mocking the database connection
      // For now, we'll just ensure the endpoint exists and works normally
      const response = await request(app)
        .get('/api/auth/admin/stats')
        .expect(401); // Should get 401 (no auth) rather than 500 (server error)

      expect(response.body.success).toBe(false);
    });
  });
});