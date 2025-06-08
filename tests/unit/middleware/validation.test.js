const request = require('supertest');
const express = require('express');
const { validationResult } = require('express-validator');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserData,
  getInvalidUserData,
  cleanupTestUsers
} = require('../setup/test-helpers');

// Validation middleware to test
const validation = require('../../middleware/validation');
const User = require('../../models/User');

// Create express app for testing validation
const createTestApp = (validationMiddleware, handler = null) => {
  const app = express();
  app.use(express.json());
  
  const defaultHandler = (req, res) => {
    res.json({ success: true, data: req.body });
  };
  
  app.post('/test', validationMiddleware, handler || defaultHandler);
  app.put('/test', validationMiddleware, handler || defaultHandler);
  app.get('/test/:token', validationMiddleware, handler || defaultHandler);
  
  return app;
};

describe('Validation Middleware Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // USER REGISTRATION VALIDATION TESTS
  // ============================================================================

  describe('validateRegister', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateRegister);
    });

    afterEach(async () => {
      await cleanupTestUsers();
    });

    test('should accept valid registration data', async () => {
      const validData = createUserData({
        firstName: 'Jean',
        lastName: 'Dupont',
        email: 'test@valid.com',
        password: 'validPassword123',
        phone: '0123456789'
      });

      const response = await request(app)
        .post('/test')
        .send(validData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should reject missing required fields', async () => {
      const invalidData = getInvalidUserData();

      // Test missing firstName
      const responseNoFirstName = await request(app)
        .post('/test')
        .send(invalidData.noFirstName);

      expect(responseNoFirstName.status).toBe(400);
      expect(responseNoFirstName.body.success).toBe(false);
      expect(responseNoFirstName.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'firstName',
            message: expect.stringContaining('prénom est requis')
          })
        ])
      );

      // Test missing lastName
      const responseNoLastName = await request(app)
        .post('/test')
        .send(invalidData.noLastName);

      expect(responseNoLastName.status).toBe(400);
      expect(responseNoLastName.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'lastName',
            message: expect.stringContaining('nom est requis')
          })
        ])
      );

      // Test missing email
      const responseNoEmail = await request(app)
        .post('/test')
        .send(invalidData.noEmail);

      expect(responseNoEmail.status).toBe(400);
      expect(responseNoEmail.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('email est requise')
          })
        ])
      );
    });

    test('should validate email format', async () => {
      const invalidEmailData = createUserData({
        email: 'invalid-email-format'
      });

      const response = await request(app)
        .post('/test')
        .send(invalidEmailData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('email valide')
          })
        ])
      );
    });

    test('should validate password strength', async () => {
      // Test short password
      const shortPasswordData = createUserData({
        password: '123'
      });

      const response = await request(app)
        .post('/test')
        .send(shortPasswordData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('6 caractères')
          })
        ])
      );
    });

    test('should validate French phone number format', async () => {
      const invalidPhoneData = createUserData({
        phone: '123456'
      });

      const response = await request(app)
        .post('/test')
        .send(invalidPhoneData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'phone',
            message: expect.stringContaining('téléphone français valide')
          })
        ])
      );
    });

    test('should validate role enum', async () => {
      const invalidRoleData = createUserData({
        role: 'INVALID_ROLE'
      });

      const response = await request(app)
        .post('/test')
        .send(invalidRoleData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'role',
            message: expect.stringContaining('CLIENT, RECEPTIONIST ou ADMIN')
          })
        ])
      );
    });

    test('should validate SIRET format', async () => {
      const invalidSiretData = createUserData({
        siret: '123'
      });

      const response = await request(app)
        .post('/test')
        .send(invalidSiretData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'siret',
            message: expect.stringContaining('14 chiffres')
          })
        ])
      );
    });

    test('should validate field lengths', async () => {
      const longFieldsData = createUserData({
        firstName: 'A'.repeat(51),
        lastName: 'B'.repeat(51),
        email: 'a'.repeat(90) + '@test.com'
      });

      const response = await request(app)
        .post('/test')
        .send(longFieldsData);

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('should check email uniqueness', async () => {
      // Create a user first
      const existingUser = await createTestUser({
        email: 'existing@test.com'
      });

      // Try to create another user with same email
      const duplicateEmailData = createUserData({
        email: 'existing@test.com'
      });

      const response = await request(app)
        .post('/test')
        .send(duplicateEmailData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('déjà utilisée')
          })
        ])
      );
    });

    test('should check SIRET uniqueness', async () => {
      // Create a company user first
      const existingCompany = await createTestUser({
        email: 'company1@test.com',
        companyName: 'Existing Company',
        siret: '12345678901234'
      });

      // Try to create another company with same SIRET
      const duplicateSiretData = createUserData({
        email: 'company2@test.com',
        companyName: 'Another Company',
        siret: '12345678901234'
      });

      const response = await request(app)
        .post('/test')
        .send(duplicateSiretData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'siret',
            message: expect.stringContaining('déjà utilisé')
          })
        ])
      );
    });

    test('should validate company data coherence', async () => {
      // SIRET without company name should fail
      const siretWithoutNameData = createUserData({
        siret: '12345678901234'
        // companyName missing
      });

      const response = await request(app)
        .post('/test')
        .send(siretWithoutNameData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.stringContaining('nom de l\'entreprise est requis')
          })
        ])
      );
    });

    test('should sanitize input data', async () => {
      const dirtyData = {
        firstName: '  Jean  ',
        lastName: '  Dupont  ',
        email: '  TEST@EMAIL.COM  ',
        password: 'password123',
        phone: ' 01 23 45 67 89 ',
        siret: ' 123 456 789 012 34 '
      };

      const response = await request(app)
        .post('/test')
        .send(dirtyData);

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Jean');
      expect(response.body.data.lastName).toBe('Dupont');
      expect(response.body.data.email).toBe('test@email.com');
      expect(response.body.data.phone).toBe('0123456789');
      expect(response.body.data.siret).toBe('12345678901234');
    });
  });

  // ============================================================================
  // USER LOGIN VALIDATION TESTS
  // ============================================================================

  describe('validateLogin', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateLogin);
    });

    test('should accept valid login data', async () => {
      const validLoginData = {
        email: 'test@test.com',
        password: 'password123',
        rememberMe: true
      };

      const response = await request(app)
        .post('/test')
        .send(validLoginData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should require email and password', async () => {
      const invalidLoginData = {
        // missing email and password
      };

      const response = await request(app)
        .post('/test')
        .send(invalidLoginData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('email est requise')
          }),
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('mot de passe est requis')
          })
        ])
      );
    });

    test('should validate email format for login', async () => {
      const invalidEmailLogin = {
        email: 'invalid-email',
        password: 'password123'
      };

      const response = await request(app)
        .post('/test')
        .send(invalidEmailLogin);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('email valide')
          })
        ])
      );
    });

    test('should validate rememberMe boolean', async () => {
      const invalidRememberMe = {
        email: 'test@test.com',
        password: 'password123',
        rememberMe: 'not-a-boolean'
      };

      const response = await request(app)
        .post('/test')
        .send(invalidRememberMe);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'rememberMe',
            message: expect.stringContaining('booléen')
          })
        ])
      );
    });

    test('should sanitize login input', async () => {
      const dirtyLoginData = {
        email: '  TEST@EMAIL.COM  ',
        password: 'password123'
      };

      const response = await request(app)
        .post('/test')
        .send(dirtyLoginData);

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('test@email.com');
    });
  });

  // ============================================================================
  // EMAIL VALIDATION TESTS
  // ============================================================================

  describe('validateEmail', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateEmail);
    });

    test('should accept valid email', async () => {
      const validEmailData = {
        email: 'valid@test.com'
      };

      const response = await request(app)
        .post('/test')
        .send(validEmailData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should reject invalid email formats', async () => {
      const invalidEmails = [
        'invalid-email',
        '@test.com',
        'test@',
        'test.com',
        ''
      ];

      for (const email of invalidEmails) {
        const response = await request(app)
          .post('/test')
          .send({ email });

        expect(response.status).toBe(400);
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'email'
            })
          ])
        );
      }
    });

    test('should require email field', async () => {
      const response = await request(app)
        .post('/test')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('email est requise')
          })
        ])
      );
    });
  });

  // ============================================================================
  // REFRESH TOKEN VALIDATION TESTS
  // ============================================================================

  describe('validateRefreshToken', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateRefreshToken);
    });

    test('should accept valid JWT refresh token', async () => {
      const validTokenData = {
        refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      };

      const response = await request(app)
        .post('/test')
        .send(validTokenData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should reject invalid JWT format', async () => {
      const invalidTokenData = {
        refreshToken: 'invalid-token-format'
      };

      const response = await request(app)
        .post('/test')
        .send(invalidTokenData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'refreshToken',
            message: expect.stringContaining('JWT valide')
          })
        ])
      );
    });

    test('should require refresh token', async () => {
      const response = await request(app)
        .post('/test')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'refreshToken',
            message: expect.stringContaining('refresh token est requis')
          })
        ])
      );
    });
  });

  // ============================================================================
  // PASSWORD RESET VALIDATION TESTS
  // ============================================================================

  describe('validateResetPassword', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateResetPassword);
    });

    test('should accept valid reset password data', async () => {
      const validResetData = {
        password: 'newPassword123',
        confirmPassword: 'newPassword123'
      };

      const response = await request(app)
        .get('/test/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
        .send(validResetData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should validate token parameter', async () => {
      const validResetData = {
        password: 'newPassword123',
        confirmPassword: 'newPassword123'
      };

      // Test short token
      const responseShortToken = await request(app)
        .get('/test/short-token')
        .send(validResetData);

      expect(responseShortToken.status).toBe(400);
      expect(responseShortToken.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'token',
            message: expect.stringContaining('réinitialisation invalide')
          })
        ])
      );
    });

    test('should require password confirmation', async () => {
      const invalidResetData = {
        password: 'newPassword123'
        // confirmPassword missing
      };

      const response = await request(app)
        .get('/test/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
        .send(invalidResetData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'confirmPassword',
            message: expect.stringContaining('confirmation du mot de passe est requise')
          })
        ])
      );
    });

    test('should validate password confirmation match', async () => {
      const mismatchData = {
        password: 'newPassword123',
        confirmPassword: 'differentPassword456'
      };

      const response = await request(app)
        .get('/test/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
        .send(mismatchData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'confirmPassword',
            message: expect.stringContaining('ne correspondent pas')
          })
        ])
      );
    });

    test('should validate password strength for reset', async () => {
      const weakPasswordData = {
        password: '123',
        confirmPassword: '123'
      };

      const response = await request(app)
        .get('/test/abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890')
        .send(weakPasswordData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('6 caractères')
          })
        ])
      );
    });
  });

  // ============================================================================
  // CHANGE PASSWORD VALIDATION TESTS
  // ============================================================================

  describe('validateChangePassword', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateChangePassword);
    });

    test('should accept valid change password data', async () => {
      const validChangeData = {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
        confirmPassword: 'newPassword456'
      };

      const response = await request(app)
        .post('/test')
        .send(validChangeData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should require all password fields', async () => {
      const incompleteData = {
        currentPassword: 'oldPassword123'
        // newPassword and confirmPassword missing
      };

      const response = await request(app)
        .post('/test')
        .send(incompleteData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'newPassword'
          }),
          expect.objectContaining({
            field: 'confirmPassword'
          })
        ])
      );
    });

    test('should validate new password differs from current', async () => {
      const samePasswordData = {
        currentPassword: 'samePassword123',
        newPassword: 'samePassword123',
        confirmPassword: 'samePassword123'
      };

      const response = await request(app)
        .post('/test')
        .send(samePasswordData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'newPassword',
            message: expect.stringContaining('différent du mot de passe actuel')
          })
        ])
      );
    });

    test('should validate new password confirmation', async () => {
      const mismatchData = {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword456',
        confirmPassword: 'differentPassword789'
      };

      const response = await request(app)
        .post('/test')
        .send(mismatchData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'confirmPassword',
            message: expect.stringContaining('ne correspondent pas')
          })
        ])
      );
    });
  });

  // ============================================================================
  // PROFILE UPDATE VALIDATION TESTS
  // ============================================================================

  describe('validateProfileUpdate', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateProfileUpdate, (req, res) => {
        // Mock req.user for SIRET uniqueness check
        req.user = { userId: '507f1f77bcf86cd799439011' };
        res.json({ success: true, data: req.body });
      });
    });

    afterEach(async () => {
      await cleanupTestUsers();
    });

    test('should accept valid profile update data', async () => {
      const validUpdateData = {
        firstName: 'Jean',
        lastName: 'Dupont',
        phone: '0123456789',
        companyName: 'Mon Entreprise',
        preferences: {
          language: 'fr',
          notifications: {
            email: true,
            sms: false
          }
        }
      };

      const response = await request(app)
        .put('/test')
        .send(validUpdateData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should validate optional fields when provided', async () => {
      const invalidUpdateData = {
        firstName: 'A'.repeat(51), // Too long
        phone: '123', // Invalid format
        preferences: {
          language: 'invalid' // Invalid language
        }
      };

      const response = await request(app)
        .put('/test')
        .send(invalidUpdateData);

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('should validate preferences structure', async () => {
      const invalidPreferencesData = {
        firstName: 'Jean',
        preferences: {
          language: 'es', // Not fr or en
          notifications: {
            email: 'not-boolean',
            sms: 'also-not-boolean'
          }
        }
      };

      const response = await request(app)
        .put('/test')
        .send(invalidPreferencesData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'preferences.language'
          }),
          expect.objectContaining({
            field: 'preferences.notifications.email'
          }),
          expect.objectContaining({
            field: 'preferences.notifications.sms'
          })
        ])
      );
    });

    test('should check SIRET uniqueness on update', async () => {
      // Create existing user with SIRET
      const existingUser = await createTestUser({
        email: 'existing@test.com',
        siret: '98765432109876'
      });

      const duplicateSiretUpdate = {
        siret: '98765432109876'
      };

      const response = await request(app)
        .put('/test')
        .send(duplicateSiretUpdate);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'siret',
            message: expect.stringContaining('déjà utilisé')
          })
        ])
      );
    });
  });

  // ============================================================================
  // BOOKING DATA VALIDATION TESTS
  // ============================================================================

  describe('validateBookingData', () => {
    let app;

    beforeEach(() => {
      app = createTestApp(validation.validateBookingData);
    });

    test('should accept valid booking data', async () => {
      const validBookingData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-06-05T00:00:00.000Z',
        rooms: [
          { roomId: '507f1f77bcf86cd799439012' },
          { roomId: '507f1f77bcf86cd799439013' }
        ],
        totalGuests: {
          adults: 2,
          children: 1
        }
      };

      const response = await request(app)
        .post('/test')
        .send(validBookingData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    test('should validate required booking fields', async () => {
      const incompleteBookingData = {
        // Missing required fields
      };

      const response = await request(app)
        .post('/test')
        .send(incompleteBookingData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: 'hotelId' }),
          expect.objectContaining({ field: 'checkIn' }),
          expect.objectContaining({ field: 'checkOut' }),
          expect.objectContaining({ field: 'rooms' })
        ])
      );
    });

    test('should validate MongoDB ObjectIds', async () => {
      const invalidIdData = {
        hotelId: 'invalid-object-id',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-06-05T00:00:00.000Z',
        rooms: [
          { roomId: 'also-invalid' }
        ],
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(invalidIdData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'hotelId',
            message: expect.stringContaining('invalide')
          }),
          expect.objectContaining({
            field: 'rooms.0.roomId',
            message: expect.stringContaining('invalide')
          })
        ])
      );
    });

    test('should validate date formats and logic', async () => {
      const invalidDateData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: 'invalid-date',
        checkOut: '2025-05-01T00:00:00.000Z', // Before checkIn
        rooms: [{ roomId: '507f1f77bcf86cd799439012' }],
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(invalidDateData);

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('should validate past dates', async () => {
      const pastDateData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2020-01-01T00:00:00.000Z', // Past date
        checkOut: '2020-01-05T00:00:00.000Z',
        rooms: [{ roomId: '507f1f77bcf86cd799439012' }],
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(pastDateData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'checkIn',
            message: expect.stringContaining('passé')
          })
        ])
      );
    });

    test('should validate guest numbers', async () => {
      const invalidGuestData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-06-05T00:00:00.000Z',
        rooms: [{ roomId: '507f1f77bcf86cd799439012' }],
        totalGuests: {
          adults: 0, // Invalid: must be at least 1
          children: -1 // Invalid: cannot be negative
        }
      };

      const response = await request(app)
        .post('/test')
        .send(invalidGuestData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'totalGuests.adults',
            message: expect.stringContaining('entre 1 et 20')
          }),
          expect.objectContaining({
            field: 'totalGuests.children',
            message: expect.stringContaining('entre 0 et 10')
          })
        ])
      );
    });

    test('should validate rooms array', async () => {
      const invalidRoomsData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-06-05T00:00:00.000Z',
        rooms: [], // Empty array
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(invalidRoomsData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'rooms',
            message: expect.stringContaining('Au moins 1 chambre')
          })
        ])
      );
    });

    test('should validate maximum stay duration', async () => {
      const longStayData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-07-15T00:00:00.000Z', // More than 30 days
        rooms: [{ roomId: '507f1f77bcf86cd799439012' }],
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(longStayData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'checkOut',
            message: expect.stringContaining('30 nuits')
          })
        ])
      );
    });

    test('should validate maximum rooms per booking', async () => {
      const tooManyRoomsData = {
        hotelId: '507f1f77bcf86cd799439011',
        checkIn: '2025-06-01T00:00:00.000Z',
        checkOut: '2025-06-05T00:00:00.000Z',
        rooms: Array(6).fill().map((_, i) => ({ roomId: `507f1f77bcf86cd79943901${i}` })), // 6 rooms (max is 5)
        totalGuests: { adults: 1 }
      };

      const response = await request(app)
        .post('/test')
        .send(tooManyRoomsData);

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'rooms',
            message: expect.stringContaining('maximum 5 chambres')
          })
        ])
      );
    });
  });

  // ============================================================================
  // OBJECT ID VALIDATION TESTS
  // ============================================================================

  describe('validateObjectId', () => {
    test('should validate MongoDB ObjectId format', async () => {
      const app = createTestApp(validation.validateObjectId('userId'));

      // Valid ObjectId
      const validResponse = await request(app)
        .get('/test/507f1f77bcf86cd799439011');

      expect(validResponse.status).toBe(200);

      // Invalid ObjectId
      const invalidResponse = await request(app)
        .get('/test/invalid-object-id');

      expect(invalidResponse.status).toBe(400);
      expect(invalidResponse.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'userId',
            message: expect.stringContaining('invalide')
          })
        ])
      );
    });

    test('should require ObjectId parameter', async () => {
      const app = createTestApp(validation.validateObjectId('hotelId'));

      const response = await request(app)
        .get('/test/');

      expect(response.status).toBe(404); // Route not found for empty param
    });
  });

  // ============================================================================
  // CUSTOM VALIDATION TESTS
  // ============================================================================

  describe('customValidation', () => {
    test('should execute custom validation function', async () => {
      const customValidationFn = (body, params, query, user) => {
        return body.amount > 0;
      };

      const app = createTestApp(
        validation.customValidation(customValidationFn, 'Le montant doit être positif')
      );

      // Valid case
      const validResponse = await request(app)
        .post('/test')
        .send({ amount: 100 });

      expect(validResponse.status).toBe(200);

      // Invalid case
      const invalidResponse = await request(app)
        .post('/test')
        .send({ amount: -50 });

      expect(invalidResponse.status).toBe(400);
      expect(invalidResponse.body.message).toBe('Le montant doit être positif');
    });

    test('should handle custom validation errors', async () => {
      const failingValidationFn = () => {
        throw new Error('Custom validation error');
      };

      const app = createTestApp(
        validation.customValidation(failingValidationFn, 'Default error message')
      );

      const response = await request(app)
        .post('/test')
        .send({ data: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Custom validation error');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    test('should format validation errors consistently', async () => {
      const app = createTestApp(validation.validateRegister);

      const response = await request(app)
        .post('/test')
        .send({
          firstName: '', // Invalid
          email: 'invalid-email', // Invalid
          password: '123' // Too short
        });

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('success', false);
      expect(response.body).toHaveProperty('message', 'Erreur de validation des données');
      expect(response.body).toHaveProperty('code', 'VALIDATION_ERROR');
      expect(response.body).toHaveProperty('errors');
      expect(Array.isArray(response.body.errors)).toBe(true);

      response.body.errors.forEach(error => {
        expect(error).toHaveProperty('field');
        expect(error).toHaveProperty('message');
        expect(error).toHaveProperty('value');
        expect(error).toHaveProperty('location');
      });
    });

    test('should handle multiple validation errors', async () => {
      const app = createTestApp(validation.validateRegister);

      const response = await request(app)
        .post('/test')
        .send({
          // All fields invalid or missing
          firstName: '',
          lastName: '',
          email: 'invalid',
          password: '1',
          phone: '123',
          role: 'INVALID'
        });

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(5);
    });

    test('should handle database validation errors gracefully', async () => {
      const app = createTestApp(validation.validateRegister);

      // First, create a user
      await createTestUser({ email: 'test@unique.com' });

      // Then try to create another with same email
      const response = await request(app)
        .post('/test')
        .send(createUserData({ email: 'test@unique.com' }));

      expect(response.status).toBe(400);
      expect(response.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('déjà utilisée')
          })
        ])
      );
    });
  });

  // ============================================================================
  // SANITIZATION TESTS
  // ============================================================================

  describe('Input Sanitization', () => {
    test('should sanitize email to lowercase', async () => {
      const app = createTestApp(validation.validateEmail);

      const response = await request(app)
        .post('/test')
        .send({ email: 'TEST@EMAIL.COM' });

      expect(response.status).toBe(200);
      expect(response.body.data.email).toBe('test@email.com');
    });

    test('should trim whitespace from text fields', async () => {
      const app = createTestApp(validation.validateRegister);

      const response = await request(app)
        .post('/test')
        .send({
          firstName: '  Jean  ',
          lastName: '  Dupont  ',
          email: '  test@test.com  ',
          password: 'password123',
          phone: '0123456789'
        });

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Jean');
      expect(response.body.data.lastName).toBe('Dupont');
      expect(response.body.data.email).toBe('test@test.com');
    });

    test('should normalize phone numbers', async () => {
      const app = createTestApp(validation.validateRegister);

      const testCases = [
        { input: '+33123456789', expected: '0123456789' },
        { input: '01 23 45 67 89', expected: '0123456789' },
        { input: '01.23.45.67.89', expected: '0123456789' },
        { input: '01-23-45-67-89', expected: '0123456789' }
      ];

      for (const testCase of testCases) {
        const response = await request(app)
          .post('/test')
          .send({
            firstName: 'Jean',
            lastName: 'Dupont',
            email: `test${Date.now()}@test.com`,
            password: 'password123',
            phone: testCase.input
          });

        expect(response.status).toBe(200);
        expect(response.body.data.phone).toBe(testCase.expected);
      }
    });

    test('should normalize SIRET numbers', async () => {
      const app = createTestApp(validation.validateRegister);

      const response = await request(app)
        .post('/test')
        .send({
          firstName: 'Jean',
          lastName: 'Dupont',
          email: 'test@test.com',
          password: 'password123',
          phone: '0123456789',
          companyName: 'Test Company',
          siret: '123 456 789 012 34'
        });

      expect(response.status).toBe(200);
      expect(response.body.data.siret).toBe('12345678901234');
    });
  });

  // ============================================================================
  // VALIDATION UTILITIES TESTS
  // ============================================================================

  describe('Validation Utilities', () => {
    test('should provide reusable email validation', async () => {
      const app = createTestApp(validation.emailValidation.concat(validation.handleValidationErrors));

      const validResponse = await request(app)
        .post('/test')
        .send({ email: 'valid@test.com' });

      expect(validResponse.status).toBe(200);

      const invalidResponse = await request(app)
        .post('/test')
        .send({ email: 'invalid-email' });

      expect(invalidResponse.status).toBe(400);
    });

    test('should provide reusable password validation', async () => {
      const app = createTestApp(validation.passwordValidation.concat(validation.handleValidationErrors));

      const validResponse = await request(app)
        .post('/test')
        .send({ password: 'validPassword123' });

      expect(validResponse.status).toBe(200);

      const invalidResponse = await request(app)
        .post('/test')
        .send({ password: '123' });

      expect(invalidResponse.status).toBe(400);
    });

    test('should provide reusable phone validation', async () => {
      const app = createTestApp(validation.phoneValidation.concat(validation.handleValidationErrors));

      const validResponse = await request(app)
        .post('/test')
        .send({ phone: '0123456789' });

      expect(validResponse.status).toBe(200);

      const invalidResponse = await request(app)
        .post('/test')
        .send({ phone: '123' });

      expect(invalidResponse.status).toBe(400);
    });
  });

  // ============================================================================
  // SECURITY TESTS
  // ============================================================================

  describe('Security Validations', () => {
    test('should prevent SQL injection attempts', async () => {
      const app = createTestApp(validation.validateLogin);

      const maliciousData = {
        email: "test@test.com'; DROP TABLE users; --",
        password: "password123"
      };

      const response = await request(app)
        .post('/test')
        .send(maliciousData);

      // Should either reject due to email format or pass through safely
      if (response.status === 400) {
        expect(response.body.errors).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              field: 'email'
            })
          ])
        );
      } else {
        expect(response.status).toBe(200);
      }
    });

    test('should prevent XSS attacks in text fields', async () => {
      const app = createTestApp(validation.validateRegister);

      const xssData = {
        firstName: '<script>alert("XSS")</script>',
        lastName: '<img src="x" onerror="alert(1)">',
        email: 'test@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/test')
        .send(xssData);

      // Should reject due to invalid characters or pass through safely
      if (response.status === 400) {
        expect(response.body.errors.length).toBeGreaterThan(0);
      } else {
        expect(response.status).toBe(200);
        // If it passes, the data should be sanitized
        expect(response.body.data.firstName).not.toContain('<script>');
        expect(response.body.data.lastName).not.toContain('<img');
      }
    });

    test('should handle extremely long input strings', async () => {
      const app = createTestApp(validation.validateRegister);

      const longData = {
        firstName: 'A'.repeat(1000),
        lastName: 'B'.repeat(1000),
        email: 'a'.repeat(500) + '@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/test')
        .send(longData);

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    test('should validate against Unicode control characters', async () => {
      const app = createTestApp(validation.validateRegister);

      const controlCharData = {
        firstName: 'Jean\u0000\u0001\u0002',
        lastName: 'Dupont\u007F\u009F',
        email: 'test@test.com',
        password: 'password123',
        phone: '0123456789'
      };

      const response = await request(app)
        .post('/test')
        .send(controlCharData);

      // Should either reject or sanitize control characters
      if (response.status === 200) {
        expect(response.body.data.firstName).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
        expect(response.body.data.lastName).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      } else {
        expect(response.status).toBe(400);
      }
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should validate large number of fields efficiently', async () => {
      const app = createTestApp(validation.validateRegister);

      const startTime = Date.now();

      // Test with 100 requests
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .post('/test')
            .send(createUserData({ email: `test${i}@test.com` }))
        );
      }

      await Promise.all(requests);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 5 seconds for 100 requests)
      expect(duration).toBeLessThan(5000);
    });

    test('should handle validation errors efficiently', async () => {
      const app = createTestApp(validation.validateRegister);

      const startTime = Date.now();

      // Test with 50 invalid requests
      const requests = [];
      for (let i = 0; i < 50; i++) {
        requests.push(
          request(app)
            .post('/test')
            .send({
              firstName: '', // Invalid
              email: 'invalid-email', // Invalid
              password: '123' // Invalid
            })
        );
      }

      const responses = await Promise.all(requests);

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All should return validation errors
      responses.forEach(response => {
        expect(response.status).toBe(400);
        expect(response.body.errors.length).toBeGreaterThan(0);
      });

      // Should complete in reasonable time
      expect(duration).toBeLessThan(3000);
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    test('should work with real database constraints', async () => {
      const app = createTestApp(validation.validateRegister);

      // Create a user successfully
      const validUser = createUserData({
        email: 'integration@test.com',
        phone: '0123456789'
      });

      const successResponse = await request(app)
        .post('/test')
        .send(validUser);

      expect(successResponse.status).toBe(200);

      // Try to create duplicate user
      const duplicateResponse = await request(app)
        .post('/test')
        .send(validUser);

      expect(duplicateResponse.status).toBe(400);
      expect(duplicateResponse.body.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('déjà utilisée')
          })
        ])
      );
    });

    test('should combine multiple validation middlewares', async () => {
      const app = express();
      app.use(express.json());
      
      // Combine sanitization and validation
      app.post('/test', 
        validation.sanitizeInput,
        validation.validateRegister,
        (req, res) => {
          res.json({ success: true, data: req.body });
        }
      );

      const dirtyButValidData = {
        firstName: '  Jean  ',
        lastName: '  Dupont  ',
        email: '  TEST@TEST.COM  ',
        password: 'validPassword123',
        phone: ' 01 23 45 67 89 '
      };

      const response = await request(app)
        .post('/test')
        .send(dirtyButValidData);

      expect(response.status).toBe(200);
      expect(response.body.data.firstName).toBe('Jean');
      expect(response.body.data.email).toBe('test@test.com');
      expect(response.body.data.phone).toBe('0123456789');
    });

    test('should handle middleware chain errors gracefully', async () => {
      const app = express();
      app.use(express.json());
      
      // Add middleware that might throw
      app.post('/test',
        (req, res, next) => {
          if (req.body.throwError) {
            throw new Error('Middleware error');
          }
          next();
        },
        validation.validateRegister,
        (req, res) => {
          res.json({ success: true });
        }
      );

      // Add error handler
      app.use((error, req, res, next) => {
        res.status(500).json({ 
          success: false, 
          message: 'Internal server error' 
        });
      });

      const errorResponse = await request(app)
        .post('/test')
        .send({ throwError: true });

      expect(errorResponse.status).toBe(500);
      expect(errorResponse.body.success).toBe(false);
    });
  });
});