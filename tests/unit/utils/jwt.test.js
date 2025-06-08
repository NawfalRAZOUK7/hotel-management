const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// Test setup
const { testHooks } = require('../setup/test-database');
const {
  createTestUser,
  generateTestToken,
  generateExpiredToken,
  generateInvalidToken,
  expectValidToken
} = require('../setup/test-helpers');

// Utils to test
const jwtUtils = require('../../utils/jwt');

// Mock user data for testing
const mockUser = {
  _id: '507f1f77bcf86cd799439011',
  email: 'test@test.com',
  role: 'CLIENT',
  fullName: 'Test User'
};

describe('JWT Utils Tests', () => {
  beforeAll(testHooks.beforeAll);
  afterAll(testHooks.afterAll);
  beforeEach(testHooks.beforeEach);

  // Mock environment variables for consistent testing
  const originalEnv = process.env;
  
  beforeEach(() => {
    process.env = {
      ...originalEnv,
      JWT_SECRET: 'test-jwt-secret-key-256-bits-long-for-security-purposes-in-testing',
      JWT_REFRESH_SECRET: 'test-refresh-secret-key-256-bits-long-for-security-purposes',
      JWT_EXPIRE: '1h',
      JWT_REFRESH_EXPIRE: '7d',
      JWT_ISSUER: 'hotel-management-test'
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ============================================================================
  // ACCESS TOKEN TESTS
  // ============================================================================

  describe('Access Token Generation', () => {
    test('should generate valid access token with complete payload', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role,
        fullName: mockUser.fullName
      };

      const token = jwtUtils.generateAccessToken(payload);

      expect(token).toBeTruthy();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT structure

      // Decode and verify payload
      const decoded = jwtUtils.decodeToken(token);
      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
      expect(decoded.fullName).toBe(payload.fullName);
      expect(decoded.type).toBe('access');
      expect(decoded.iss).toBe('hotel-management-test');
      expect(decoded.aud).toBe('hotel-users');
    });

    test('should generate different tokens each time', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role,
        fullName: mockUser.fullName
      };

      const token1 = jwtUtils.generateAccessToken(payload);
      const token2 = jwtUtils.generateAccessToken(payload);

      expect(token1).not.toBe(token2);
    });

    test('should use custom options when provided', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const customOptions = {
        expiresIn: '30m',
        audience: 'custom-audience'
      };

      const token = jwtUtils.generateAccessToken(payload, customOptions);
      const decoded = jwtUtils.decodeToken(token);

      expect(decoded.aud).toBe('custom-audience');
      // Verify expiration is approximately 30 minutes
      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + (30 * 60); // 30 minutes
      expect(decoded.exp).toBeCloseTo(expectedExp, -2); // Within 100 seconds
    });

    test('should require userId in payload', () => {
      const payloadWithoutUserId = {
        email: mockUser.email,
        role: mockUser.role
      };

      expect(() => {
        jwtUtils.generateAccessToken(payloadWithoutUserId);
      }).toThrow('userId est requis dans le payload');
    });

    test('should require payload to be object', () => {
      expect(() => {
        jwtUtils.generateAccessToken(null);
      }).toThrow('Payload doit être un objet');

      expect(() => {
        jwtUtils.generateAccessToken('string');
      }).toThrow('Payload doit être un objet');
    });

    test('should handle payload with minimal required fields', () => {
      const minimalPayload = {
        userId: mockUser._id
      };

      const token = jwtUtils.generateAccessToken(minimalPayload);
      const decoded = jwtUtils.decodeToken(token);

      expect(decoded.userId).toBe(minimalPayload.userId);
      expect(decoded.type).toBe('access');
    });
  });

  // ============================================================================
  // REFRESH TOKEN TESTS
  // ============================================================================

  describe('Refresh Token Generation', () => {
    test('should generate valid refresh token', () => {
      const userId = mockUser._id;
      const refreshToken = jwtUtils.generateRefreshToken(userId);

      expect(refreshToken).toBeTruthy();
      expect(typeof refreshToken).toBe('string');
      expect(refreshToken.split('.')).toHaveLength(3);

      const decoded = jwtUtils.decodeToken(refreshToken);
      expect(decoded.userId).toBe(userId);
      expect(decoded.type).toBe('refresh');
      expect(decoded.jti).toBeTruthy(); // Unique ID
      expect(decoded.iss).toBe('hotel-management-test');
      expect(decoded.aud).toBe('hotel-refresh');
    });

    test('should generate unique JTI for each refresh token', () => {
      const userId = mockUser._id;
      
      const token1 = jwtUtils.generateRefreshToken(userId);
      const token2 = jwtUtils.generateRefreshToken(userId);

      const decoded1 = jwtUtils.decodeToken(token1);
      const decoded2 = jwtUtils.decodeToken(token2);

      expect(decoded1.jti).not.toBe(decoded2.jti);
    });

    test('should require userId', () => {
      expect(() => {
        jwtUtils.generateRefreshToken();
      }).toThrow('userId est requis');

      expect(() => {
        jwtUtils.generateRefreshToken(null);
      }).toThrow('userId est requis');
    });

    test('should use custom options', () => {
      const userId = mockUser._id;
      const customOptions = {
        expiresIn: '30d'
      };

      const token = jwtUtils.generateRefreshToken(userId, customOptions);
      const decoded = jwtUtils.decodeToken(token);

      // Verify expiration is approximately 30 days
      const now = Math.floor(Date.now() / 1000);
      const expectedExp = now + (30 * 24 * 60 * 60); // 30 days
      expect(decoded.exp).toBeCloseTo(expectedExp, -2);
    });
  });

  // ============================================================================
  // TOKEN VERIFICATION TESTS
  // ============================================================================

  describe('Access Token Verification', () => {
    test('should verify valid access token', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const token = jwtUtils.generateAccessToken(payload);
      const verified = jwtUtils.verifyAccessToken(token);

      expect(verified.userId).toBe(payload.userId);
      expect(verified.email).toBe(payload.email);
      expect(verified.role).toBe(payload.role);
      expect(verified.type).toBe('access');
    });

    test('should reject missing token', () => {
      expect(() => {
        jwtUtils.verifyAccessToken();
      }).toThrow('Token manquant');

      expect(() => {
        jwtUtils.verifyAccessToken(null);
      }).toThrow('Token manquant');

      expect(() => {
        jwtUtils.verifyAccessToken('');
      }).toThrow('Token manquant');
    });

    test('should reject invalid token format', () => {
      expect(() => {
        jwtUtils.verifyAccessToken('invalid.token');
      }).toThrow('Token invalide');

      expect(() => {
        jwtUtils.verifyAccessToken('not-a-jwt-token');
      }).toThrow('Token invalide');
    });

    test('should reject expired token', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const expiredToken = jwt.sign(payload, process.env.JWT_SECRET, {
        expiresIn: '-1h', // Expired 1 hour ago
        issuer: process.env.JWT_ISSUER,
        audience: 'hotel-users'
      });

      expect(() => {
        jwtUtils.verifyAccessToken(expiredToken);
      }).toThrow('Token expiré');
    });

    test('should reject token with wrong type', () => {
      const refreshToken = jwtUtils.generateRefreshToken(mockUser._id);

      expect(() => {
        jwtUtils.verifyAccessToken(refreshToken);
      }).toThrow('Type de token invalide');
    });

    test('should reject blacklisted token', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const token = jwtUtils.generateAccessToken(payload);
      
      // Blacklist the token
      jwtUtils.blacklistToken(token);

      expect(() => {
        jwtUtils.verifyAccessToken(token);
      }).toThrow('Token révoqué');
    });

    test('should use custom verification options', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const token = jwtUtils.generateAccessToken(payload, {
        audience: 'custom-audience'
      });

      // Should verify with matching audience
      const verified = jwtUtils.verifyAccessToken(token, {
        audience: 'custom-audience'
      });
      expect(verified.userId).toBe(payload.userId);

      // Should fail with wrong audience
      expect(() => {
        jwtUtils.verifyAccessToken(token, {
          audience: 'wrong-audience'
        });
      }).toThrow('Token invalide');
    });
  });

  // ============================================================================
  // REFRESH TOKEN VERIFICATION TESTS
  // ============================================================================

  describe('Refresh Token Verification', () => {
    test('should verify valid refresh token', () => {
      const userId = mockUser._id;
      const refreshToken = jwtUtils.generateRefreshToken(userId);
      const verified = jwtUtils.verifyRefreshToken(refreshToken);

      expect(verified.userId).toBe(userId);
      expect(verified.type).toBe('refresh');
      expect(verified.jti).toBeTruthy();
    });

    test('should reject missing refresh token', () => {
      expect(() => {
        jwtUtils.verifyRefreshToken();
      }).toThrow('Refresh token manquant');
    });

    test('should reject expired refresh token', () => {
      const userId = mockUser._id;
      const expiredRefreshToken = jwt.sign(
        { userId, type: 'refresh', jti: crypto.randomUUID() },
        process.env.JWT_REFRESH_SECRET,
        {
          expiresIn: '-1d', // Expired 1 day ago
          issuer: process.env.JWT_ISSUER,
          audience: 'hotel-refresh'
        }
      );

      expect(() => {
        jwtUtils.verifyRefreshToken(expiredRefreshToken);
      }).toThrow('Refresh token expiré');
    });

    test('should reject access token used as refresh token', () => {
      const accessToken = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      expect(() => {
        jwtUtils.verifyRefreshToken(accessToken);
      }).toThrow('Type de token invalide');
    });

    test('should reject blacklisted refresh token', () => {
      const refreshToken = jwtUtils.generateRefreshToken(mockUser._id);
      
      // Blacklist the refresh token
      jwtUtils.blacklistToken(refreshToken);

      expect(() => {
        jwtUtils.verifyRefreshToken(refreshToken);
      }).toThrow('Refresh token révoqué');
    });
  });

  // ============================================================================
  // TOKEN PAIR GENERATION TESTS
  // ============================================================================

  describe('Token Pair Generation', () => {
    test('should generate complete token pair with user object', async () => {
      const user = await createTestUser();
      const tokenPair = jwtUtils.generateTokenPair(user);

      expect(tokenPair).toHaveProperty('accessToken');
      expect(tokenPair).toHaveProperty('refreshToken');
      expect(tokenPair).toHaveProperty('tokenType', 'Bearer');
      expect(tokenPair).toHaveProperty('expiresIn');
      expect(tokenPair).toHaveProperty('accessTokenExpires');
      expect(tokenPair).toHaveProperty('refreshTokenExpires');
      expect(tokenPair).toHaveProperty('user');

      // Verify access token
      expectValidToken(tokenPair.accessToken);
      const accessDecoded = jwtUtils.decodeToken(tokenPair.accessToken);
      expect(accessDecoded.userId).toBe(user._id.toString());
      expect(accessDecoded.type).toBe('access');

      // Verify refresh token
      expectValidToken(tokenPair.refreshToken);
      const refreshDecoded = jwtUtils.decodeToken(tokenPair.refreshToken);
      expect(refreshDecoded.userId).toBe(user._id.toString());
      expect(refreshDecoded.type).toBe('refresh');

      // Verify user info
      expect(tokenPair.user.id).toBe(user._id);
      expect(tokenPair.user.email).toBe(user.email);
      expect(tokenPair.user.role).toBe(user.role);
    });

    test('should require valid user object', () => {
      expect(() => {
        jwtUtils.generateTokenPair();
      }).toThrow('Objet utilisateur invalide');

      expect(() => {
        jwtUtils.generateTokenPair({});
      }).toThrow('Objet utilisateur invalide');

      expect(() => {
        jwtUtils.generateTokenPair({ email: 'test@test.com' });
      }).toThrow('Objet utilisateur invalide');
    });

    test('should handle user without fullName', async () => {
      const user = await createTestUser();
      delete user.fullName;

      const tokenPair = jwtUtils.generateTokenPair(user);
      
      expect(tokenPair.accessToken).toBeTruthy();
      const decoded = jwtUtils.decodeToken(tokenPair.accessToken);
      expect(decoded.fullName).toBe(`${user.firstName} ${user.lastName}`);
    });
  });

  // ============================================================================
  // TOKEN REFRESH TESTS
  // ============================================================================

  describe('Token Refresh', () => {
    test('should refresh access token with valid refresh token', async () => {
      const user = await createTestUser();
      const refreshToken = jwtUtils.generateRefreshToken(user._id);

      // Mock getUserById function
      const getUserById = jest.fn().mockResolvedValue(user);

      const newTokenData = await jwtUtils.refreshAccessToken(refreshToken, getUserById);

      expect(newTokenData).toHaveProperty('accessToken');
      expect(newTokenData).toHaveProperty('tokenType', 'Bearer');
      expect(newTokenData).toHaveProperty('expiresIn');
      expect(newTokenData).toHaveProperty('user');

      // Verify new access token
      expectValidToken(newTokenData.accessToken);
      const decoded = jwtUtils.decodeToken(newTokenData.accessToken);
      expect(decoded.userId).toBe(user._id.toString());
      expect(decoded.type).toBe('access');

      // Verify getUserById was called
      expect(getUserById).toHaveBeenCalledWith(user._id.toString());
    });

    test('should reject refresh with expired token', async () => {
      const user = await createTestUser();
      const expiredRefreshToken = jwt.sign(
        { userId: user._id.toString(), type: 'refresh', jti: crypto.randomUUID() },
        process.env.JWT_REFRESH_SECRET,
        { expiresIn: '-1d' }
      );

      const getUserById = jest.fn();

      await expect(
        jwtUtils.refreshAccessToken(expiredRefreshToken, getUserById)
      ).rejects.toThrow('Refresh token expiré');
    });

    test('should reject refresh when user not found', async () => {
      const refreshToken = jwtUtils.generateRefreshToken('507f1f77bcf86cd799439011');
      const getUserById = jest.fn().mockResolvedValue(null);

      await expect(
        jwtUtils.refreshAccessToken(refreshToken, getUserById)
      ).rejects.toThrow('Utilisateur non trouvé ou inactif');
    });

    test('should reject refresh when user is inactive', async () => {
      const user = await createTestUser({ isActive: false });
      const refreshToken = jwtUtils.generateRefreshToken(user._id);
      const getUserById = jest.fn().mockResolvedValue(user);

      await expect(
        jwtUtils.refreshAccessToken(refreshToken, getUserById)
      ).rejects.toThrow('Utilisateur non trouvé ou inactif');
    });
  });

  // ============================================================================
  // BLACKLIST TESTS
  // ============================================================================

  describe('Token Blacklisting', () => {
    test('should blacklist token successfully', () => {
      const token = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      const result = jwtUtils.blacklistToken(token);
      expect(result).toBe(true);

      // Token should now be blacklisted
      expect(jwtUtils.isTokenBlacklisted(token)).toBe(true);
    });

    test('should handle empty token for blacklisting', () => {
      const result1 = jwtUtils.blacklistToken('');
      const result2 = jwtUtils.blacklistToken(null);
      const result3 = jwtUtils.blacklistToken(undefined);

      expect(result1).toBe(false);
      expect(result2).toBe(false);
      expect(result3).toBe(false);
    });

    test('should check if token is blacklisted', () => {
      const token = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      // Initially not blacklisted
      expect(jwtUtils.isTokenBlacklisted(token)).toBe(false);

      // After blacklisting
      jwtUtils.blacklistToken(token);
      expect(jwtUtils.isTokenBlacklisted(token)).toBe(true);
    });

    test('should clean up expired tokens from blacklist', () => {
      // Create expired token
      const expiredToken = jwt.sign(
        { userId: mockUser._id, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );

      // Blacklist it
      jwtUtils.blacklistToken(expiredToken);
      expect(jwtUtils.isTokenBlacklisted(expiredToken)).toBe(true);

      // Cleanup should remove it
      const cleanedCount = jwtUtils.cleanupBlacklist();
      expect(cleanedCount).toBeGreaterThanOrEqual(1);
      expect(jwtUtils.isTokenBlacklisted(expiredToken)).toBe(false);
    });
  });

  // ============================================================================
  // UTILITY FUNCTIONS TESTS
  // ============================================================================

  describe('Utility Functions', () => {
    test('should extract token from Authorization header', () => {
      const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature';
      
      // Valid Bearer format
      const extracted1 = jwtUtils.extractTokenFromHeader(`Bearer ${token}`);
      expect(extracted1).toBe(token);

      // Invalid format
      const extracted2 = jwtUtils.extractTokenFromHeader(`Basic ${token}`);
      expect(extracted2).toBeNull();

      // Missing header
      const extracted3 = jwtUtils.extractTokenFromHeader(null);
      expect(extracted3).toBeNull();

      // Malformed header
      const extracted4 = jwtUtils.extractTokenFromHeader('Bearer');
      expect(extracted4).toBeNull();
    });

    test('should decode token without verification', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const token = jwtUtils.generateAccessToken(payload);
      const decoded = jwtUtils.decodeToken(token);

      expect(decoded.userId).toBe(payload.userId);
      expect(decoded.email).toBe(payload.email);
      expect(decoded.role).toBe(payload.role);
    });

    test('should return null for invalid token decode', () => {
      const decoded = jwtUtils.decodeToken('invalid.token');
      expect(decoded).toBeNull();
    });

    test('should get token expiration info', () => {
      const token = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      const expiration = jwtUtils.getTokenExpiration(token);

      expect(expiration).toHaveProperty('expiresAt');
      expect(expiration).toHaveProperty('isExpired');
      expect(expiration).toHaveProperty('timeUntilExpiry');
      expect(expiration).toHaveProperty('hoursUntilExpiry');
      expect(expiration).toHaveProperty('minutesUntilExpiry');

      expect(expiration.isExpired).toBe(false);
      expect(expiration.timeUntilExpiry).toBeGreaterThan(0);
      expect(expiration.expiresAt).toBeInstanceOf(Date);
    });

    test('should detect expired token in expiration info', () => {
      const expiredToken = jwt.sign(
        { userId: mockUser._id, type: 'access' },
        process.env.JWT_SECRET,
        { expiresIn: '-1h' }
      );

      const expiration = jwtUtils.getTokenExpiration(expiredToken);

      expect(expiration.isExpired).toBe(true);
      expect(expiration.timeUntilExpiry).toBe(0);
      expect(expiration.hoursUntilExpiry).toBe(0);
      expect(expiration.minutesUntilExpiry).toBe(0);
    });

    test('should return null for invalid token expiration', () => {
      const expiration = jwtUtils.getTokenExpiration('invalid.token');
      expect(expiration).toBeNull();
    });
  });

  // ============================================================================
  // JWT SECRET VALIDATION TESTS
  // ============================================================================

  describe('JWT Secret Validation', () => {
    test('should validate strong secret', () => {
      const strongSecret = 'Super-Strong-Secret-Key-2025!@#$%^&*()_+{}[]';
      const validation = jwtUtils.validateJwtSecret(strongSecret);

      expect(validation.isValid).toBe(true);
      expect(validation.strength).toBe('Excellent');
    });

    test('should reject weak secrets', () => {
      // Too short
      const shortSecret = jwtUtils.validateJwtSecret('short');
      expect(shortSecret.isValid).toBe(false);
      expect(shortSecret.message).toContain('trop court');

      // Default secrets
      const defaultSecret = jwtUtils.validateJwtSecret('your-secret-key');
      expect(defaultSecret.isValid).toBe(false);
      expect(defaultSecret.message).toContain('non sécurisé');

      // Missing secret
      const missingSecret = jwtUtils.validateJwtSecret(null);
      expect(missingSecret.isValid).toBe(false);
      expect(missingSecret.message).toContain('manquant');
    });

    test('should validate medium strength secret', () => {
      const mediumSecret = 'Medium-Strength-Secret-Key-123456789';
      const validation = jwtUtils.validateJwtSecret(mediumSecret);

      expect(validation.isValid).toBe(true);
      expect(validation.strength).toBe('Bon');
    });

    test('should reject low complexity secrets', () => {
      const lowComplexitySecret = 'thisisaverylongsecretbutnotcomplex';
      const validation = jwtUtils.validateJwtSecret(lowComplexitySecret);

      expect(validation.isValid).toBe(false);
      expect(validation.message).toContain('pas assez complexe');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    test('should handle malformed JWT tokens gracefully', () => {
      const malformedTokens = [
        'not.a.token',
        'definitely-not-jwt',
        '',
        'a.b', // Only 2 parts
        'a.b.c.d', // Too many parts
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid-payload.signature'
      ];

      malformedTokens.forEach(token => {
        expect(() => {
          jwtUtils.verifyAccessToken(token);
        }).toThrow('Token invalide');
      });
    });

    test('should handle environment variable missing', () => {
      const originalSecret = process.env.JWT_SECRET;
      delete process.env.JWT_SECRET;

      expect(() => {
        require('../../utils/jwt');
      }).toThrow('JWT_SECRET must be defined');

      // Restore
      process.env.JWT_SECRET = originalSecret;
    });

    test('should handle token generation errors gracefully', () => {
      // Invalid payload types that should throw
      const invalidPayloads = [
        undefined,
        'string',
        123,
        true,
        []
      ];

      invalidPayloads.forEach(payload => {
        expect(() => {
          jwtUtils.generateAccessToken(payload);
        }).toThrow();
      });
    });
  });

  // ============================================================================
  // INTEGRATION TESTS
  // ============================================================================

  describe('Integration Tests', () => {
    test('should complete full token lifecycle', async () => {
      const user = await createTestUser();

      // Generate token pair
      const tokenPair = jwtUtils.generateTokenPair(user);
      expect(tokenPair.accessToken).toBeTruthy();
      expect(tokenPair.refreshToken).toBeTruthy();

      // Verify access token works
      const verifiedAccess = jwtUtils.verifyAccessToken(tokenPair.accessToken);
      expect(verifiedAccess.userId).toBe(user._id.toString());

      // Verify refresh token works
      const verifiedRefresh = jwtUtils.verifyRefreshToken(tokenPair.refreshToken);
      expect(verifiedRefresh.userId).toBe(user._id.toString());

      // Refresh the access token
      const getUserById = jest.fn().mockResolvedValue(user);
      const newTokenData = await jwtUtils.refreshAccessToken(tokenPair.refreshToken, getUserById);
      expect(newTokenData.accessToken).toBeTruthy();

      // Blacklist old tokens
      const blacklisted1 = jwtUtils.blacklistToken(tokenPair.accessToken);
      const blacklisted2 = jwtUtils.blacklistToken(tokenPair.refreshToken);
      expect(blacklisted1).toBe(true);
      expect(blacklisted2).toBe(true);

      // Verify blacklisted tokens are rejected
      expect(() => {
        jwtUtils.verifyAccessToken(tokenPair.accessToken);
      }).toThrow('Token révoqué');

      expect(() => {
        jwtUtils.verifyRefreshToken(tokenPair.refreshToken);
      }).toThrow('Refresh token révoqué');
    });

    test('should maintain security across multiple operations', async () => {
      const users = await Promise.all([
        createTestUser({ email: 'user1@test.com' }),
        createTestUser({ email: 'user2@test.com' }),
        createTestUser({ email: 'user3@test.com' })
      ]);

      // Generate tokens for all users
      const tokenPairs = users.map(user => jwtUtils.generateTokenPair(user));

      // Verify each token only works for its user
      tokenPairs.forEach((pair, index) => {
        const decoded = jwtUtils.verifyAccessToken(pair.accessToken);
        expect(decoded.userId).toBe(users[index]._id.toString());
        expect(decoded.email).toBe(users[index].email);
      });

      // Cross-contamination test: tokens shouldn't work for wrong users
      const user1Token = tokenPairs[0].accessToken;
      const user1Decoded = jwtUtils.verifyAccessToken(user1Token);
      
      expect(user1Decoded.userId).not.toBe(users[1]._id.toString());
      expect(user1Decoded.userId).not.toBe(users[2]._id.toString());
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance Tests', () => {
    test('should generate tokens efficiently', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const startTime = Date.now();
      
      // Generate 100 tokens
      for (let i = 0; i < 100; i++) {
        jwtUtils.generateAccessToken(payload);
      }
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 500ms)
      expect(duration).toBeLessThan(500);
    });

    test('should verify tokens efficiently', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      // Generate tokens to verify
      const tokens = [];
      for (let i = 0; i < 50; i++) {
        tokens.push(jwtUtils.generateAccessToken(payload));
      }

      const startTime = Date.now();
      
      // Verify all tokens
      tokens.forEach(token => {
        jwtUtils.verifyAccessToken(token);
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 1000ms for 50 verifications)
      expect(duration).toBeLessThan(1000);
    });

    test('should handle large blacklist efficiently', () => {
      const tokens = [];
      
      // Generate and blacklist 1000 tokens
      for (let i = 0; i < 1000; i++) {
        const token = jwtUtils.generateAccessToken({
          userId: `user${i}`,
          email: `user${i}@test.com`,
          role: 'CLIENT'
        });
        tokens.push(token);
        jwtUtils.blacklistToken(token);
      }

      const startTime = Date.now();
      
      // Check blacklist status for all tokens
      tokens.forEach(token => {
        expect(jwtUtils.isTokenBlacklisted(token)).toBe(true);
      });
      
      const endTime = Date.now();
      const duration = endTime - startTime;

      // Should complete in reasonable time (less than 100ms)
      expect(duration).toBeLessThan(100);
    });
  });

  // ============================================================================
  // CONFIGURATION TESTS
  // ============================================================================

  describe('Configuration Tests', () => {
    test('should use environment variables correctly', () => {
      const config = jwtUtils.config;

      expect(config.JWT_EXPIRE).toBe('1h');
      expect(config.JWT_REFRESH_EXPIRE).toBe('7d');
      expect(config.JWT_ISSUER).toBe('hotel-management-test');
      expect(config.secretIsValid).toBe(true);
    });

    test('should handle missing environment variables with defaults', () => {
      // Create new instance without some env vars
      const originalRefreshSecret = process.env.JWT_REFRESH_SECRET;
      const originalExpire = process.env.JWT_EXPIRE;
      const originalRefreshExpire = process.env.JWT_REFRESH_EXPIRE;
      const originalIssuer = process.env.JWT_ISSUER;

      delete process.env.JWT_REFRESH_SECRET;
      delete process.env.JWT_EXPIRE;
      delete process.env.JWT_REFRESH_EXPIRE;
      delete process.env.JWT_ISSUER;

      // Re-require the module to test defaults
      delete require.cache[require.resolve('../../utils/jwt')];
      const jwtUtilsWithDefaults = require('../../utils/jwt');

      const config = jwtUtilsWithDefaults.config;
      expect(config.JWT_EXPIRE).toBe('24h'); // Default
      expect(config.JWT_REFRESH_EXPIRE).toBe('7d'); // Default
      expect(config.JWT_ISSUER).toBe('hotel-management-system'); // Default

      // Restore environment variables
      process.env.JWT_REFRESH_SECRET = originalRefreshSecret;
      process.env.JWT_EXPIRE = originalExpire;
      process.env.JWT_REFRESH_EXPIRE = originalRefreshExpire;
      process.env.JWT_ISSUER = originalIssuer;

      // Re-require original module
      delete require.cache[require.resolve('../../utils/jwt')];
      require('../../utils/jwt');
    });

    test('should validate configuration on module load', () => {
      // Test with invalid secret
      const originalSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = 'weak';

      // Re-require module
      delete require.cache[require.resolve('../../utils/jwt')];
      
      // Should still load but config should show invalid
      const jwtUtilsWeak = require('../../utils/jwt');
      expect(jwtUtilsWeak.config.secretIsValid).toBe(false);

      // Restore
      process.env.JWT_SECRET = originalSecret;
      delete require.cache[require.resolve('../../utils/jwt')];
      require('../../utils/jwt');
    });
  });

  // ============================================================================
  // SECURITY EDGE CASES
  // ============================================================================

  describe('Security Edge Cases', () => {
    test('should prevent token reuse after blacklisting', () => {
      const payload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      };

      const token = jwtUtils.generateAccessToken(payload);
      
      // Verify token works initially
      const verified1 = jwtUtils.verifyAccessToken(token);
      expect(verified1.userId).toBe(payload.userId);

      // Blacklist token
      jwtUtils.blacklistToken(token);

      // Should not work after blacklisting
      expect(() => {
        jwtUtils.verifyAccessToken(token);
      }).toThrow('Token révoqué');
    });

    test('should prevent access token use as refresh token', () => {
      const accessToken = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      expect(() => {
        jwtUtils.verifyRefreshToken(accessToken);
      }).toThrow('Type de token invalide');
    });

    test('should prevent refresh token use as access token', () => {
      const refreshToken = jwtUtils.generateRefreshToken(mockUser._id);

      expect(() => {
        jwtUtils.verifyAccessToken(refreshToken);
      }).toThrow('Type de token invalide');
    });

    test('should handle token tampering attempts', () => {
      const originalToken = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      // Tamper with token by changing characters
      const tamperedToken = originalToken.slice(0, -10) + 'TAMPERED123';

      expect(() => {
        jwtUtils.verifyAccessToken(tamperedToken);
      }).toThrow('Token invalide');
    });

    test('should handle payload manipulation attempts', () => {
      // Create token with normal role
      const normalToken = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: 'CLIENT'
      });

      // Decode and verify original role
      const decoded = jwtUtils.verifyAccessToken(normalToken);
      expect(decoded.role).toBe('CLIENT');

      // Attempts to manipulate payload should fail verification
      const parts = normalToken.split('.');
      const header = parts[0];
      const signature = parts[2];

      // Create malicious payload
      const maliciousPayload = {
        userId: mockUser._id,
        email: mockUser.email,
        role: 'ADMIN', // Privilege escalation attempt
        type: 'access',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600
      };

      const encodedMaliciousPayload = Buffer.from(JSON.stringify(maliciousPayload))
        .toString('base64')
        .replace(/[+]/g, '-')
        .replace(/[/]/g, '_')
        .replace(/=/g, '');

      const maliciousToken = `${header}.${encodedMaliciousPayload}.${signature}`;

      expect(() => {
        jwtUtils.verifyAccessToken(maliciousToken);
      }).toThrow('Token invalide');
    });

    test('should handle concurrent blacklisting operations', () => {
      const tokens = [];
      
      // Generate multiple tokens
      for (let i = 0; i < 10; i++) {
        tokens.push(jwtUtils.generateAccessToken({
          userId: `user${i}`,
          email: `user${i}@test.com`,
          role: 'CLIENT'
        }));
      }

      // Blacklist all tokens concurrently
      const blacklistPromises = tokens.map(token => 
        Promise.resolve(jwtUtils.blacklistToken(token))
      );

      return Promise.all(blacklistPromises).then(results => {
        // All should be successfully blacklisted
        results.forEach(result => {
          expect(result).toBe(true);
        });

        // All tokens should be blacklisted
        tokens.forEach(token => {
          expect(jwtUtils.isTokenBlacklisted(token)).toBe(true);
        });
      });
    });

    test('should handle rapid token generation and verification', () => {
      const payloads = [];
      const tokens = [];

      // Generate multiple payloads
      for (let i = 0; i < 50; i++) {
        payloads.push({
          userId: `user${i}`,
          email: `user${i}@test.com`,
          role: i % 3 === 0 ? 'ADMIN' : i % 3 === 1 ? 'RECEPTIONIST' : 'CLIENT'
        });
      }

      // Generate tokens rapidly
      payloads.forEach(payload => {
        tokens.push(jwtUtils.generateAccessToken(payload));
      });

      // Verify all tokens
      tokens.forEach((token, index) => {
        const verified = jwtUtils.verifyAccessToken(token);
        expect(verified.userId).toBe(payloads[index].userId);
        expect(verified.email).toBe(payloads[index].email);
        expect(verified.role).toBe(payloads[index].role);
      });
    });
  });

  // ============================================================================
  // COMPATIBILITY AND STANDARDS TESTS
  // ============================================================================

  describe('Compatibility and Standards', () => {
    test('should generate RFC 7519 compliant JWT tokens', () => {
      const token = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      // JWT should have 3 parts separated by dots
      const parts = token.split('.');
      expect(parts).toHaveLength(3);

      // Each part should be base64url encoded
      parts.forEach(part => {
        expect(part).toMatch(/^[A-Za-z0-9_-]*$/);
      });

      // Header should be valid JSON
      const headerJson = Buffer.from(parts[0], 'base64').toString();
      const header = JSON.parse(headerJson);
      expect(header).toHaveProperty('alg');
      expect(header).toHaveProperty('typ', 'JWT');

      // Payload should be valid JSON
      const payloadJson = Buffer.from(parts[1], 'base64').toString();
      const payload = JSON.parse(payloadJson);
      expect(payload).toHaveProperty('iat');
      expect(payload).toHaveProperty('exp');
      expect(payload).toHaveProperty('iss');
      expect(payload).toHaveProperty('aud');
    });

    test('should use standard JWT claims correctly', () => {
      const token = jwtUtils.generateAccessToken({
        userId: mockUser._id,
        email: mockUser.email,
        role: mockUser.role
      });

      const decoded = jwtUtils.decodeToken(token);

      // Standard claims
      expect(decoded).toHaveProperty('iat'); // Issued At
      expect(decoded).toHaveProperty('exp'); // Expiration Time
      expect(decoded).toHaveProperty('iss'); // Issuer
      expect(decoded).toHaveProperty('aud'); // Audience
      expect(decoded).toHaveProperty('sub'); // Subject (userId)

      // Custom claims
      expect(decoded).toHaveProperty('userId');
      expect(decoded).toHaveProperty('email');
      expect(decoded).toHaveProperty('role');
      expect(decoded).toHaveProperty('type');

      // Verify claim values
      expect(typeof decoded.iat).toBe('number');
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp).toBeGreaterThan(decoded.iat);
      expect(decoded.iss).toBe('hotel-management-test');
      expect(decoded.sub).toBe(mockUser._id);
    });

    test('should handle different token formats gracefully', () => {
      const testCases = [
        '', // Empty string
        'Bearer token', // Missing Bearer prefix when extracted
        'token', // Single part
        'header.payload', // Missing signature
        'header.payload.signature.extra', // Extra parts
        'not-base64.not-base64.not-base64' // Invalid base64
      ];

      testCases.forEach(testCase => {
        expect(() => {
          jwtUtils.verifyAccessToken(testCase);
        }).toThrow();
      });
    });
  });
});