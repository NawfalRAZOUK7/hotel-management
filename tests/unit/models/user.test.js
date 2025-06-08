const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  createUserData,
  createUserWithRole,
  createCompanyUser,
  getInvalidUserData,
  expectUserProperties,
  countDocuments
} = require('../setup/test-helpers');

// Model to test
const User = require('../../models/User');

describe('User Model Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // ============================================================================
  // SCHEMA VALIDATION TESTS
  // ============================================================================

  describe('Schema Validation', () => {
    test('should create user with valid data', async () => {
      const userData = createUserData();
      const user = new User(userData);
      
      const savedUser = await user.save();
      
      expect(savedUser._id).toBeDefined();
      expect(savedUser.firstName).toBe(userData.firstName);
      expect(savedUser.lastName).toBe(userData.lastName);
      expect(savedUser.email).toBe(userData.email.toLowerCase());
      expect(savedUser.phone).toBe(userData.phone);
      expect(savedUser.role).toBe('CLIENT'); // Default role
      expect(savedUser.isActive).toBe(true);
      expect(savedUser.createdAt).toBeDefined();
    });

    test('should require all mandatory fields', async () => {
      const invalidData = getInvalidUserData();
      
      // Test missing firstName
      const userNoFirstName = new User(invalidData.noFirstName);
      await expect(userNoFirstName.save()).rejects.toThrow('Le prénom est requis');
      
      // Test missing lastName
      const userNoLastName = new User(invalidData.noLastName);
      await expect(userNoLastName.save()).rejects.toThrow('Le nom est requis');
      
      // Test missing email
      const userNoEmail = new User(invalidData.noEmail);
      await expect(userNoEmail.save()).rejects.toThrow('L\'email est requis');
      
      // Test missing password
      const userNoPassword = new User({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        phone: '0123456789'
      });
      await expect(userNoPassword.save()).rejects.toThrow('Le mot de passe est requis');
      
      // Test missing phone
      const userNoPhone = new User({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@test.com',
        password: 'password123'
      });
      await expect(userNoPhone.save()).rejects.toThrow('Le numéro de téléphone est requis');
    });

    test('should validate field formats', async () => {
      const invalidData = getInvalidUserData();
      
      // Test invalid email
      const userInvalidEmail = new User(invalidData.invalidEmail);
      await expect(userInvalidEmail.save()).rejects.toThrow('Veuillez entrer un email valide');
      
      // Test short password
      const userShortPassword = new User(invalidData.shortPassword);
      await expect(userShortPassword.save()).rejects.toThrow('Le mot de passe doit contenir au moins 6 caractères');
      
      // Test invalid phone
      const userInvalidPhone = new User(invalidData.invalidPhone);
      await expect(userInvalidPhone.save()).rejects.toThrow('Veuillez entrer un numéro de téléphone français valide');
      
      // Test invalid role
      const userInvalidRole = new User(invalidData.invalidRole);
      await expect(userInvalidRole.save()).rejects.toThrow('Le rôle doit être CLIENT, RECEPTIONIST ou ADMIN');
    });

    test('should enforce unique email', async () => {
      const userData = createUserData({ email: 'unique@test.com' });
      
      // Create first user
      const user1 = new User(userData);
      await user1.save();
      
      // Try to create second user with same email
      const user2 = new User({ ...userData, firstName: 'Different' });
      await expect(user2.save()).rejects.toThrow();
    });

    test('should enforce unique SIRET', async () => {
      const siret = '12345678901234';
      
      // Create first company user
      const company1 = new User(createUserData({
        email: 'company1@test.com',
        companyName: 'Company 1',
        siret
      }));
      await company1.save();
      
      // Try to create second company with same SIRET
      const company2 = new User(createUserData({
        email: 'company2@test.com',
        companyName: 'Company 2',
        siret
      }));
      await expect(company2.save()).rejects.toThrow();
    });

    test('should validate SIRET format', async () => {
      const invalidData = getInvalidUserData();
      const userInvalidSiret = new User(invalidData.invalidSiret);
      
      await expect(userInvalidSiret.save()).rejects.toThrow('Le numéro SIRET doit contenir 14 chiffres');
    });

    test('should validate field lengths', async () => {
      // Test firstName too long
      const userLongFirstName = new User(createUserData({
        firstName: 'A'.repeat(51)
      }));
      await expect(userLongFirstName.save()).rejects.toThrow('Le prénom ne peut pas dépasser 50 caractères');
      
      // Test lastName too long
      const userLongLastName = new User(createUserData({
        lastName: 'B'.repeat(51)
      }));
      await expect(userLongLastName.save()).rejects.toThrow('Le nom ne peut pas dépasser 50 caractères');
      
      // Test email too long
      const longEmail = 'a'.repeat(90) + '@test.com';
      const userLongEmail = new User(createUserData({
        email: longEmail
      }));
      await expect(userLongEmail.save()).rejects.toThrow('L\'adresse email ne peut pas dépasser 100 caractères');
    });
  });

  // ============================================================================
  // PASSWORD HANDLING TESTS
  // ============================================================================

  describe('Password Handling', () => {
    test('should hash password before saving', async () => {
      const plainPassword = 'password123';
      const user = new User(createUserData({ password: plainPassword }));
      
      await user.save();
      
      // Password should be hashed
      expect(user.password).not.toBe(plainPassword);
      expect(user.password).toMatch(/^\$2[ayb]\$.{56}$/); // bcrypt format
    });

    test('should not rehash password if not modified', async () => {
      const user = await createTestUser();
      const originalHash = user.password;
      
      // Update another field
      user.firstName = 'Updated';
      await user.save();
      
      // Password hash should remain the same
      expect(user.password).toBe(originalHash);
    });

    test('should rehash password when modified', async () => {
      const user = await createTestUser();
      const originalHash = user.password;
      
      // Change password
      user.password = 'newpassword123';
      await user.save();
      
      // Password hash should be different
      expect(user.password).not.toBe(originalHash);
      expect(user.password).toMatch(/^\$2[ayb]\$.{56}$/);
    });

    test('should compare passwords correctly', async () => {
      const plainPassword = 'password123';
      const user = await createTestUser({ password: plainPassword });
      
      // Correct password should match
      const isValidCorrect = await user.comparePassword(plainPassword);
      expect(isValidCorrect).toBe(true);
      
      // Wrong password should not match
      const isValidWrong = await user.comparePassword('wrongpassword');
      expect(isValidWrong).toBe(false);
      
      // Empty password should not match
      const isValidEmpty = await user.comparePassword('');
      expect(isValidEmpty).toBe(false);
      
      // Null password should not match
      const isValidNull = await user.comparePassword(null);
      expect(isValidNull).toBe(false);
    });

    test('should exclude password from queries by default', async () => {
      await createTestUser();
      
      const userFromDB = await User.findOne({});
      expect(userFromDB.password).toBeUndefined();
    });

    test('should include password when explicitly selected', async () => {
      const user = await createTestUser();
      
      const userWithPassword = await User.findById(user._id).select('+password');
      expect(userWithPassword.password).toBeDefined();
      expect(userWithPassword.password).toMatch(/^\$2[ayb]\$.{56}$/);
    });
  });

  // ============================================================================
  // JWT TOKEN METHODS TESTS
  // ============================================================================

  describe('JWT Token Methods', () => {
    test('should generate valid auth token', async () => {
      const user = await createTestUser();
      const token = user.generateAuthToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT structure
      
      // Decode and verify payload
      const jwtUtils = require('../../utils/jwt');
      const decoded = jwtUtils.decodeToken(token);
      
      expect(decoded.userId).toBe(user._id.toString());
      expect(decoded.email).toBe(user.email);
      expect(decoded.role).toBe(user.role);
      expect(decoded.fullName).toBe(user.fullName);
    });

    test('should generate valid refresh token', async () => {
      const user = await createTestUser();
      const refreshToken = user.generateRefreshToken();
      
      expect(refreshToken).toBeDefined();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.')).toHaveLength(3);
      
      // Decode and verify payload
      const jwtUtils = require('../../utils/jwt');
      const decoded = jwtUtils.decodeToken(refreshToken);
      
      expect(decoded.userId).toBe(user._id.toString());
      expect(decoded.type).toBe('refresh');
    });

    test('should generate different tokens each time', async () => {
      const user = await createTestUser();
      
      const token1 = user.generateAuthToken();
      const token2 = user.generateAuthToken();
      const refreshToken1 = user.generateRefreshToken();
      const refreshToken2 = user.generateRefreshToken();
      
      expect(token1).not.toBe(token2);
      expect(refreshToken1).not.toBe(refreshToken2);
    });
  });

  // ============================================================================
  // PASSWORD RESET METHODS TESTS
  // ============================================================================

  describe('Password Reset Methods', () => {
    test('should create password reset token', async () => {
      const user = await createTestUser();
      const resetToken = user.createPasswordResetToken();
      
      expect(resetToken).toBeDefined();
      expect(typeof resetToken).toBe('string');
      expect(resetToken).toHaveLength(64); // 32 bytes hex = 64 chars
      
      // User should have hashed token and expiration
      expect(user.resetPasswordToken).toBeDefined();
      expect(user.resetPasswordToken).not.toBe(resetToken);
      expect(user.resetPasswordExpires).toBeDefined();
      expect(user.resetPasswordExpires).toBeInstanceOf(Date);
      
      // Should expire in 10 minutes
      const now = new Date();
      const tenMinutesFromNow = new Date(now.getTime() + 10 * 60 * 1000);
      expect(user.resetPasswordExpires.getTime()).toBeCloseTo(tenMinutesFromNow.getTime(), -4);
    });

    test('should hash reset token for storage', async () => {
      const user = await createTestUser();
      const resetToken = user.createPasswordResetToken();
      
      // Manually hash the token
      const hashedToken = crypto
        .createHash('sha256')
        .update(resetToken)
        .digest('hex');
      
      expect(user.resetPasswordToken).toBe(hashedToken);
    });

    test('should create different reset tokens each time', async () => {
      const user = await createTestUser();
      
      const token1 = user.createPasswordResetToken();
      const token2 = user.createPasswordResetToken();
      
      expect(token1).not.toBe(token2);
      expect(user.resetPasswordToken).not.toBe(token1);
    });
  });

  // ============================================================================
  // EMAIL VERIFICATION METHODS TESTS
  // ============================================================================

  describe('Email Verification Methods', () => {
    test('should create email verification token', async () => {
      const user = await createTestUser();
      const verificationToken = user.createEmailVerificationToken();
      
      expect(verificationToken).toBeDefined();
      expect(typeof verificationToken).toBe('string');
      expect(verificationToken).toHaveLength(64);
      
      // User should have hashed token and expiration
      expect(user.emailVerificationToken).toBeDefined();
      expect(user.emailVerificationToken).not.toBe(verificationToken);
      expect(user.emailVerificationExpires).toBeDefined();
      
      // Should expire in 24 hours
      const now = new Date();
      const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      expect(user.emailVerificationExpires.getTime()).toBeCloseTo(twentyFourHoursFromNow.getTime(), -4);
    });

    test('should hash verification token for storage', async () => {
      const user = await createTestUser();
      const verificationToken = user.createEmailVerificationToken();
      
      const hashedToken = crypto
        .createHash('sha256')
        .update(verificationToken)
        .digest('hex');
      
      expect(user.emailVerificationToken).toBe(hashedToken);
    });
  });

  // ============================================================================
  // LOGIN ATTEMPTS & LOCKING TESTS
  // ============================================================================

  describe('Login Attempts & Account Locking', () => {
    test('should increment login attempts', async () => {
      const user = await createTestUser();
      
      expect(user.loginAttempts).toBe(0);
      
      await user.incLoginAttempts();
      await user.save();
      
      const updatedUser = await User.findById(user._id);
      expect(updatedUser.loginAttempts).toBe(1);
    });

    test('should lock account after 5 failed attempts', async () => {
      const user = await createTestUser();
      
      // Make 4 failed attempts
      for (let i = 0; i < 4; i++) {
        await user.incLoginAttempts();
      }
      
      expect(user.isLocked).toBe(false);
      
      // 5th attempt should lock the account
      await user.incLoginAttempts();
      await user.save();
      
      const updatedUser = await User.findById(user._id);
      expect(updatedUser.loginAttempts).toBe(5);
      expect(updatedUser.lockUntil).toBeDefined();
      expect(updatedUser.isLocked).toBe(true);
      
      // Should be locked for 2 hours
      const twoHoursFromNow = new Date(Date.now() + 2 * 60 * 60 * 1000);
      expect(updatedUser.lockUntil.getTime()).toBeCloseTo(twoHoursFromNow.getTime(), -4);
    });

    test('should reset login attempts', async () => {
      const user = await createTestUser();
      
      // Add some failed attempts
      await user.incLoginAttempts();
      await user.incLoginAttempts();
      expect(user.loginAttempts).toBe(2);
      
      // Reset attempts
      await user.resetLoginAttempts();
      await user.save();
      
      const updatedUser = await User.findById(user._id);
      expect(updatedUser.loginAttempts).toBeUndefined();
      expect(updatedUser.lockUntil).toBeUndefined();
    });

    test('should update last login', async () => {
      const user = await createTestUser();
      const beforeLogin = new Date();
      
      await user.updateLastLogin();
      
      expect(user.lastLogin).toBeDefined();
      expect(user.lastLogin.getTime()).toBeGreaterThanOrEqual(beforeLogin.getTime());
    });

    test('should reset expired lock automatically', async () => {
      const user = await createTestUser();
      
      // Manually set expired lock
      user.loginAttempts = 5;
      user.lockUntil = new Date(Date.now() - 1000); // 1 second ago
      await user.save();
      
      // Should reset when checking lock status
      await user.incLoginAttempts();
      
      expect(user.loginAttempts).toBe(1); // Should start fresh
      expect(user.lockUntil).toBeUndefined();
    });
  });

  // ============================================================================
  // VIRTUALS TESTS
  // ============================================================================

  describe('Virtual Properties', () => {
    test('should generate full name', async () => {
      const user = await createTestUser({
        firstName: 'John',
        lastName: 'Doe'
      });
      
      expect(user.fullName).toBe('John Doe');
    });

    test('should check if account is locked', async () => {
      const user = await createTestUser();
      
      // Not locked initially
      expect(user.isLocked).toBe(false);
      
      // Set future lock
      user.lockUntil = new Date(Date.now() + 60000); // 1 minute from now
      expect(user.isLocked).toBe(true);
      
      // Set past lock
      user.lockUntil = new Date(Date.now() - 60000); // 1 minute ago
      expect(user.isLocked).toBe(false);
    });
  });

  // ============================================================================
  // MIDDLEWARE TESTS
  // ============================================================================

  describe('Pre-save Middleware', () => {
    test('should set client type to COMPANY when company data provided', async () => {
      const user = new User(createUserData({
        companyName: 'Test Company',
        siret: '12345678901234'
      }));
      
      await user.save();
      expect(user.clientType).toBe('COMPANY');
    });

    test('should set client type to INDIVIDUAL when no company data', async () => {
      const user = new User(createUserData());
      
      await user.save();
      expect(user.clientType).toBe('INDIVIDUAL');
    });

    test('should set client type to COMPANY when only SIRET provided', async () => {
      const user = new User(createUserData({
        siret: '12345678901234'
      }));
      
      await user.save();
      expect(user.clientType).toBe('COMPANY');
    });

    test('should set client type to COMPANY when only company name provided', async () => {
      const user = new User(createUserData({
        companyName: 'Test Company'
      }));
      
      await user.save();
      expect(user.clientType).toBe('COMPANY');
    });
  });

  // ============================================================================
  // STATIC METHODS TESTS
  // ============================================================================

  describe('Static Methods', () => {
    test('should find user by email', async () => {
      const userData = createUserData({ email: 'findme@test.com' });
      await createTestUser(userData);
      
      const foundUser = await User.findByEmail('findme@test.com');
      expect(foundUser).toBeDefined();
      expect(foundUser.email).toBe('findme@test.com');
      expect(foundUser.password).toBeDefined(); // Should include password
      
      // Should be case insensitive
      const foundUserCaseInsensitive = await User.findByEmail('FINDME@TEST.COM');
      expect(foundUserCaseInsensitive).toBeDefined();
      expect(foundUserCaseInsensitive.email).toBe('findme@test.com');
    });

    test('should not find inactive user by email', async () => {
      const userData = createUserData({ 
        email: 'inactive@test.com',
        isActive: false 
      });
      await createTestUser(userData);
      
      const foundUser = await User.findByEmail('inactive@test.com');
      expect(foundUser).toBeNull();
    });

    test('should check permissions correctly', async () => {
      // Admin should have all permissions
      expect(User.checkPermissions('ADMIN', 'CLIENT')).toBe(true);
      expect(User.checkPermissions('ADMIN', ['CLIENT', 'RECEPTIONIST'])).toBe(true);
      
      // Receptionist should have client permissions
      expect(User.checkPermissions('RECEPTIONIST', ['CLIENT', 'RECEPTIONIST'])).toBe(true);
      expect(User.checkPermissions('RECEPTIONIST', 'ADMIN')).toBe(false);
      
      // Client should only have client permissions
      expect(User.checkPermissions('CLIENT', 'CLIENT')).toBe(true);
      expect(User.checkPermissions('CLIENT', 'RECEPTIONIST')).toBe(false);
      expect(User.checkPermissions('CLIENT', 'ADMIN')).toBe(false);
    });

    test('should get statistics by role', async () => {
      // Create users with different roles
      await createUserWithRole('ADMIN');
      await createUserWithRole('ADMIN');
      await createUserWithRole('RECEPTIONIST');
      await createUserWithRole('CLIENT');
      await createUserWithRole('CLIENT');
      await createUserWithRole('CLIENT');
      
      const stats = await User.getStatsByRole();
      
      expect(stats).toHaveLength(3);
      
      const adminStats = stats.find(s => s._id === 'ADMIN');
      const receptionistStats = stats.find(s => s._id === 'RECEPTIONIST');
      const clientStats = stats.find(s => s._id === 'CLIENT');
      
      expect(adminStats.count).toBe(2);
      expect(receptionistStats.count).toBe(1);
      expect(clientStats.count).toBe(3);
    });
  });

  // ============================================================================
  // ROLE-BASED TESTS
  // ============================================================================

  describe('Role Management', () => {
    test('should create users with different roles', async () => {
      const admin = await createUserWithRole('ADMIN');
      const receptionist = await createUserWithRole('RECEPTIONIST');
      const client = await createUserWithRole('CLIENT');
      
      expect(admin.role).toBe('ADMIN');
      expect(receptionist.role).toBe('RECEPTIONIST');
      expect(client.role).toBe('CLIENT');
    });

    test('should default to CLIENT role', async () => {
      const user = await createTestUser();
      expect(user.role).toBe('CLIENT');
    });

    test('should validate role enum', async () => {
      const invalidRoleData = createUserData({ role: 'INVALID_ROLE' });
      const user = new User(invalidRoleData);
      
      await expect(user.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // COMPANY USER TESTS
  // ============================================================================

  describe('Company Users', () => {
    test('should create company user correctly', async () => {
      const companyUser = await createCompanyUser();
      
      expect(companyUser.companyName).toBeDefined();
      expect(companyUser.siret).toBeDefined();
      expect(companyUser.clientType).toBe('COMPANY');
      expect(companyUser.siret).toMatch(/^\d{14}$/);
    });

    test('should validate SIRET uniqueness across companies', async () => {
      const siret = '12345678901234';
      
      await createTestUser({
        companyName: 'Company 1',
        siret,
        email: 'company1@test.com'
      });
      
      const duplicateCompany = new User(createUserData({
        companyName: 'Company 2',
        siret,
        email: 'company2@test.com'
      }));
      
      await expect(duplicateCompany.save()).rejects.toThrow();
    });
  });

  // ============================================================================
  // DATABASE INTEGRATION TESTS
  // ============================================================================

  describe('Database Integration', () => {
    test('should save and retrieve user correctly', async () => {
      const userData = createUserData({
        firstName: 'Integration',
        lastName: 'Test',
        email: 'integration@test.com'
      });
      
      const user = new User(userData);
      const savedUser = await user.save();
      
      expect(savedUser._id).toBeDefined();
      expect(savedUser.createdAt).toBeDefined();
      expect(savedUser.updatedAt).toBeDefined();
      
      const retrievedUser = await User.findById(savedUser._id);
      expect(retrievedUser.firstName).toBe(userData.firstName);
      expect(retrievedUser.email).toBe(userData.email.toLowerCase());
    });

    test('should handle concurrent user creation', async () => {
      const userData1 = createUserData({ email: 'concurrent1@test.com' });
      const userData2 = createUserData({ email: 'concurrent2@test.com' });
      
      const promises = [
        new User(userData1).save(),
        new User(userData2).save()
      ];
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(2);
      expect(results[0]._id).toBeDefined();
      expect(results[1]._id).toBeDefined();
      expect(results[0]._id).not.toEqual(results[1]._id);
    });

    test('should maintain data integrity on updates', async () => {
      const user = await createTestUser();
      const originalId = user._id;
      const originalCreatedAt = user.createdAt;
      
      // Update user
      user.firstName = 'Updated';
      await user.save();
      
      // Verify integrity
      expect(user._id).toEqual(originalId);
      expect(user.createdAt).toEqual(originalCreatedAt);
      expect(user.updatedAt).not.toEqual(originalCreatedAt);
      expect(user.firstName).toBe('Updated');
    });
  });

  // ============================================================================
  // EDGE CASES & ERROR HANDLING
  // ============================================================================

  describe('Edge Cases & Error Handling', () => {
    test('should handle empty string validations', async () => {
      const userEmptyStrings = new User({
        firstName: '',
        lastName: '',
        email: '',
        password: '',
        phone: ''
      });
      
      await expect(userEmptyStrings.save()).rejects.toThrow();
    });

    test('should handle null and undefined values', async () => {
      const userNullValues = new User({
        firstName: null,
        lastName: undefined,
        email: 'test@test.com',
        password: 'password123',
        phone: '0123456789'
      });
      
      await expect(userNullValues.save()).rejects.toThrow();
    });

    test('should handle very long input strings', async () => {
      const veryLongString = 'a'.repeat(1000);
      
      const userLongData = new User(createUserData({
        firstName: veryLongString
      }));
      
      await expect(userLongData.save()).rejects.toThrow();
    });

    test('should handle special characters in names', async () => {
      const user = new User(createUserData({
        firstName: "Jean-François",
        lastName: "O'Connor-Müller"
      }));
      
      const savedUser = await user.save();
      expect(savedUser.firstName).toBe("Jean-François");
      expect(savedUser.lastName).toBe("O'Connor-Müller");
    });

    test('should handle email normalization', async () => {
      const user = new User(createUserData({
        email: 'TeSt@ExAmPle.CoM'
      }));
      
      const savedUser = await user.save();
      expect(savedUser.email).toBe('test@example.com');
    });
  });
});