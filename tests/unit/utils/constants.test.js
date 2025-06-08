/**
 * TESTS CONSTANTS - VALIDATION CONSTANTES MÉTIER
 * Tests pour toutes les constantes business + fonctions helpers
 * 
 * Coverage :
 * - Types et statuts (rooms, bookings, users)
 * - Multiplicateurs et règles business
 * - Fonctions validation helpers
 * - Permissions et transitions
 * - Messages d'erreur et patterns
 */

const {
  // Types et statuts
  ROOM_TYPES,
  ROOM_TYPE_MULTIPLIERS,
  ROOM_CAPACITIES,
  ROOM_STATUS,
  BOOKING_STATUS,
  BOOKING_STATUS_TRANSITIONS,
  BOOKING_SOURCES,
  USER_ROLES,
  CLIENT_TYPES,
  
  // Saisons et prix
  SEASONS,
  SEASONAL_MULTIPLIERS,
  DEFAULT_SEASONAL_PERIODS,
  HOTEL_CATEGORIES,
  HOTEL_CATEGORY_MULTIPLIERS,
  
  // Business rules
  BUSINESS_RULES,
  VALIDATION_PATTERNS,
  ERROR_MESSAGES,
  NOTIFICATION_TYPES,
  
  // Fonctions helpers
  isValidRoomType,
  isValidBookingStatus,
  isValidUserRole,
  canTransitionBookingStatus,
  hasPermission
} = require('../../../src/utils/constants');

describe('Constants - Types et Statuts', () => {
  
  describe('ROOM_TYPES', () => {
    test('devrait contenir les 4 types obligatoires selon cahier des charges', () => {
      expect(ROOM_TYPES).toEqual({
        SIMPLE: 'Simple',
        DOUBLE: 'Double',
        DOUBLE_COMFORT: 'Double Confort',
        SUITE: 'Suite'
      });
    });

    test('devrait avoir exactement 4 types de chambres', () => {
      expect(Object.keys(ROOM_TYPES)).toHaveLength(4);
    });

    test('tous les types devraient être des chaînes non vides', () => {
      Object.values(ROOM_TYPES).forEach(type => {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      });
    });
  });

  describe('ROOM_TYPE_MULTIPLIERS', () => {
    test('devrait avoir des multiplicateurs pour tous les types de chambres', () => {
      Object.values(ROOM_TYPES).forEach(roomType => {
        expect(ROOM_TYPE_MULTIPLIERS[roomType]).toBeDefined();
        expect(typeof ROOM_TYPE_MULTIPLIERS[roomType]).toBe('number');
      });
    });

    test('devrait avoir Simple comme référence (1.0)', () => {
      expect(ROOM_TYPE_MULTIPLIERS[ROOM_TYPES.SIMPLE]).toBe(1.0);
    });

    test('devrait avoir des multiplicateurs croissants par ordre de luxe', () => {
      const simple = ROOM_TYPE_MULTIPLIERS[ROOM_TYPES.SIMPLE];
      const double = ROOM_TYPE_MULTIPLIERS[ROOM_TYPES.DOUBLE];
      const doubleConfort = ROOM_TYPE_MULTIPLIERS[ROOM_TYPES.DOUBLE_COMFORT];
      const suite = ROOM_TYPE_MULTIPLIERS[ROOM_TYPES.SUITE];

      expect(simple).toBeLessThan(double);
      expect(double).toBeLessThan(doubleConfort);
      expect(doubleConfort).toBeLessThan(suite);
    });

    test('devrait avoir des multiplicateurs réalistes (1.0-3.0)', () => {
      Object.values(ROOM_TYPE_MULTIPLIERS).forEach(multiplier => {
        expect(multiplier).toBeGreaterThanOrEqual(1.0);
        expect(multiplier).toBeLessThanOrEqual(3.0);
      });
    });
  });

  describe('ROOM_CAPACITIES', () => {
    test('devrait avoir des capacités pour tous les types', () => {
      Object.values(ROOM_TYPES).forEach(roomType => {
        expect(ROOM_CAPACITIES[roomType]).toBeDefined();
        expect(Number.isInteger(ROOM_CAPACITIES[roomType])).toBe(true);
        expect(ROOM_CAPACITIES[roomType]).toBeGreaterThan(0);
      });
    });

    test('devrait avoir des capacités logiques', () => {
      expect(ROOM_CAPACITIES[ROOM_TYPES.SIMPLE]).toBe(1);
      expect(ROOM_CAPACITIES[ROOM_TYPES.DOUBLE]).toBe(2);
      expect(ROOM_CAPACITIES[ROOM_TYPES.DOUBLE_COMFORT]).toBe(2);
      expect(ROOM_CAPACITIES[ROOM_TYPES.SUITE]).toBeGreaterThanOrEqual(2);
    });
  });

  describe('ROOM_STATUS', () => {
    test('devrait contenir tous les statuts nécessaires', () => {
      const expectedStatuses = ['Available', 'Occupied', 'Maintenance', 'Out of Order'];
      const actualStatuses = Object.values(ROOM_STATUS);
      
      expectedStatuses.forEach(status => {
        expect(actualStatuses).toContain(status);
      });
    });

    test('devrait avoir exactement 4 statuts', () => {
      expect(Object.keys(ROOM_STATUS)).toHaveLength(4);
    });
  });

  describe('BOOKING_STATUS', () => {
    test('devrait contenir le workflow complet selon cahier des charges', () => {
      const expectedStatuses = [
        'Pending', 'Confirmed', 'Checked-in', 'Completed',
        'Cancelled', 'Rejected', 'No-show'
      ];
      
      expectedStatuses.forEach(status => {
        expect(Object.values(BOOKING_STATUS)).toContain(status);
      });
    });

    test('devrait avoir exactement 7 statuts', () => {
      expect(Object.keys(BOOKING_STATUS)).toHaveLength(7);
    });
  });

  describe('BOOKING_SOURCES', () => {
    test('devrait contenir les 3 sources selon cahier des charges', () => {
      expect(BOOKING_SOURCES).toEqual({
        WEB: 'Web',
        MOBILE: 'Mobile',
        RECEPTION: 'Reception'
      });
    });
  });

  describe('USER_ROLES', () => {
    test('devrait contenir les 3 rôles requis', () => {
      expect(USER_ROLES).toEqual({
        CLIENT: 'CLIENT',
        RECEPTIONIST: 'RECEPTIONIST',
        ADMIN: 'ADMIN'
      });
    });
  });

  describe('CLIENT_TYPES', () => {
    test('devrait supporter particuliers et entreprises', () => {
      expect(CLIENT_TYPES).toEqual({
        INDIVIDUAL: 'Individual',
        CORPORATE: 'Corporate'
      });
    });
  });
});

describe('Constants - Pricing et Saisons', () => {
  
  describe('SEASONS', () => {
    test('devrait contenir 4 saisons', () => {
      expect(Object.keys(SEASONS)).toHaveLength(4);
      expect(SEASONS).toEqual({
        LOW: 'Low Season',
        MEDIUM: 'Medium Season',
        HIGH: 'High Season',
        PEAK: 'Peak Season'
      });
    });
  });

  describe('SEASONAL_MULTIPLIERS', () => {
    test('devrait avoir des multiplicateurs pour toutes les saisons', () => {
      Object.values(SEASONS).forEach(season => {
        expect(SEASONAL_MULTIPLIERS[season]).toBeDefined();
        expect(typeof SEASONAL_MULTIPLIERS[season]).toBe('number');
      });
    });

    test('devrait avoir Medium comme référence (1.0)', () => {
      expect(SEASONAL_MULTIPLIERS[SEASONS.MEDIUM]).toBe(1.0);
    });

    test('devrait avoir des multiplicateurs croissants', () => {
      const low = SEASONAL_MULTIPLIERS[SEASONS.LOW];
      const medium = SEASONAL_MULTIPLIERS[SEASONS.MEDIUM];
      const high = SEASONAL_MULTIPLIERS[SEASONS.HIGH];
      const peak = SEASONAL_MULTIPLIERS[SEASONS.PEAK];

      expect(low).toBeLessThan(medium);
      expect(medium).toBeLessThan(high);
      expect(high).toBeLessThan(peak);
    });

    test('devrait avoir des multiplicateurs réalistes', () => {
      Object.values(SEASONAL_MULTIPLIERS).forEach(multiplier => {
        expect(multiplier).toBeGreaterThan(0.5);
        expect(multiplier).toBeLessThan(2.0);
      });
    });
  });

  describe('DEFAULT_SEASONAL_PERIODS', () => {
    test('devrait être un tableau non vide', () => {
      expect(Array.isArray(DEFAULT_SEASONAL_PERIODS)).toBe(true);
      expect(DEFAULT_SEASONAL_PERIODS.length).toBeGreaterThan(0);
    });

    test('chaque période devrait avoir les champs requis', () => {
      DEFAULT_SEASONAL_PERIODS.forEach(period => {
        expect(period).toHaveProperty('season');
        expect(period).toHaveProperty('startMonth');
        expect(period).toHaveProperty('startDay');
        expect(period).toHaveProperty('endMonth');
        expect(period).toHaveProperty('endDay');

        expect(Object.values(SEASONS)).toContain(period.season);
        expect(period.startMonth).toBeGreaterThanOrEqual(1);
        expect(period.startMonth).toBeLessThanOrEqual(12);
        expect(period.endMonth).toBeGreaterThanOrEqual(1);
        expect(period.endMonth).toBeLessThanOrEqual(12);
      });
    });
  });

  describe('HOTEL_CATEGORIES', () => {
    test('devrait contenir les catégories 1-5 étoiles', () => {
      expect(HOTEL_CATEGORIES).toEqual({
        ONE_STAR: 1,
        TWO_STAR: 2,
        THREE_STAR: 3,
        FOUR_STAR: 4,
        FIVE_STAR: 5
      });
    });
  });

  describe('HOTEL_CATEGORY_MULTIPLIERS', () => {
    test('devrait avoir des multiplicateurs pour toutes les catégories', () => {
      Object.values(HOTEL_CATEGORIES).forEach(category => {
        expect(HOTEL_CATEGORY_MULTIPLIERS[category]).toBeDefined();
        expect(typeof HOTEL_CATEGORY_MULTIPLIERS[category]).toBe('number');
      });
    });

    test('devrait avoir 3 étoiles comme référence (1.0)', () => {
      expect(HOTEL_CATEGORY_MULTIPLIERS[HOTEL_CATEGORIES.THREE_STAR]).toBe(1.0);
    });

    test('devrait avoir des multiplicateurs croissants avec le nombre d\'étoiles', () => {
      const multipliers = Object.values(HOTEL_CATEGORIES)
        .sort()
        .map(cat => HOTEL_CATEGORY_MULTIPLIERS[cat]);

      for (let i = 1; i < multipliers.length; i++) {
        expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]);
      }
    });
  });
});

describe('Constants - Business Rules', () => {
  
  describe('BUSINESS_RULES', () => {
    test('devrait contenir toutes les règles métier critiques', () => {
      expect(BUSINESS_RULES).toHaveProperty('MIN_BOOKING_NIGHTS');
      expect(BUSINESS_RULES).toHaveProperty('MAX_BOOKING_NIGHTS');
      expect(BUSINESS_RULES).toHaveProperty('MAX_ROOMS_PER_BOOKING');
      expect(BUSINESS_RULES).toHaveProperty('FREE_CANCELLATION_HOURS');
      expect(BUSINESS_RULES).toHaveProperty('MIN_ROOM_PRICE');
      expect(BUSINESS_RULES).toHaveProperty('MAX_ROOM_PRICE');
      expect(BUSINESS_RULES).toHaveProperty('SIRET_LENGTH');
    });

    test('devrait avoir des valeurs numériques positives', () => {
      const numericRules = [
        'MIN_BOOKING_NIGHTS', 'MAX_BOOKING_NIGHTS', 'MAX_ROOMS_PER_BOOKING',
        'FREE_CANCELLATION_HOURS', 'MIN_ROOM_PRICE', 'MAX_ROOM_PRICE', 'SIRET_LENGTH'
      ];

      numericRules.forEach(rule => {
        expect(typeof BUSINESS_RULES[rule]).toBe('number');
        expect(BUSINESS_RULES[rule]).toBeGreaterThan(0);
      });
    });

    test('devrait avoir des règles logiques', () => {
      expect(BUSINESS_RULES.MIN_BOOKING_NIGHTS).toBeLessThan(BUSINESS_RULES.MAX_BOOKING_NIGHTS);
      expect(BUSINESS_RULES.MIN_ROOM_PRICE).toBeLessThan(BUSINESS_RULES.MAX_ROOM_PRICE);
      expect(BUSINESS_RULES.SIRET_LENGTH).toBe(14); // SIRET français = 14 chiffres
      expect(BUSINESS_RULES.MAX_ROOMS_PER_BOOKING).toBeGreaterThanOrEqual(1);
    });
  });

  describe('VALIDATION_PATTERNS', () => {
    test('devrait contenir tous les patterns de validation', () => {
      expect(VALIDATION_PATTERNS).toHaveProperty('HOTEL_CODE');
      expect(VALIDATION_PATTERNS).toHaveProperty('PHONE');
      expect(VALIDATION_PATTERNS).toHaveProperty('SIRET');
      expect(VALIDATION_PATTERNS).toHaveProperty('POSTAL_CODE');
    });

    test('tous les patterns devraient être des RegExp valides', () => {
      Object.values(VALIDATION_PATTERNS).forEach(pattern => {
        expect(pattern).toBeInstanceOf(RegExp);
      });
    });

    test('HOTEL_CODE devrait valider le format XXX000', () => {
      const validCodes = ['RAB001', 'CAS002', 'FEZ123'];
      const invalidCodes = ['RAB1', 'rab001', '123456', 'RABAT1'];

      validCodes.forEach(code => {
        expect(VALIDATION_PATTERNS.HOTEL_CODE.test(code)).toBe(true);
      });

      invalidCodes.forEach(code => {
        expect(VALIDATION_PATTERNS.HOTEL_CODE.test(code)).toBe(false);
      });
    });

    test('PHONE devrait valider les numéros marocains', () => {
      const validPhones = ['+212612345678', '0612345678', '+212523456789'];
      const invalidPhones = ['123456789', '+33123456789', '06123'];

      validPhones.forEach(phone => {
        expect(VALIDATION_PATTERNS.PHONE.test(phone)).toBe(true);
      });

      invalidPhones.forEach(phone => {
        expect(VALIDATION_PATTERNS.PHONE.test(phone)).toBe(false);
      });
    });

    test('SIRET devrait valider 14 chiffres', () => {
      const validSiret = '12345678901234';
      const invalidSirets = ['123456789012', '1234567890123a', ''];

      expect(VALIDATION_PATTERNS.SIRET.test(validSiret)).toBe(true);
      
      invalidSirets.forEach(siret => {
        expect(VALIDATION_PATTERNS.SIRET.test(siret)).toBe(false);
      });
    });
  });

  describe('ERROR_MESSAGES', () => {
    test('devrait contenir tous les messages d\'erreur essentiels', () => {
      const essentialMessages = [
        'INVALID_CREDENTIALS', 'ACCESS_DENIED', 'TOKEN_EXPIRED',
        'REQUIRED_FIELD', 'INVALID_EMAIL', 'INVALID_DATE',
        'ROOM_NOT_AVAILABLE', 'BOOKING_NOT_FOUND', 'HOTEL_NOT_FOUND'
      ];

      essentialMessages.forEach(messageKey => {
        expect(ERROR_MESSAGES).toHaveProperty(messageKey);
        expect(typeof ERROR_MESSAGES[messageKey]).toBe('string');
        expect(ERROR_MESSAGES[messageKey].length).toBeGreaterThan(0);
      });
    });
  });
});

describe('Constants - Workflow et Transitions', () => {
  
  describe('BOOKING_STATUS_TRANSITIONS', () => {
    test('devrait définir les transitions pour tous les statuts', () => {
      Object.values(BOOKING_STATUS).forEach(status => {
        expect(BOOKING_STATUS_TRANSITIONS).toHaveProperty(status);
        expect(Array.isArray(BOOKING_STATUS_TRANSITIONS[status])).toBe(true);
      });
    });

    test('devrait avoir des transitions logiques selon workflow', () => {
      // PENDING peut aller vers CONFIRMED ou REJECTED
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.PENDING]).toContain(BOOKING_STATUS.CONFIRMED);
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.PENDING]).toContain(BOOKING_STATUS.REJECTED);

      // CONFIRMED peut aller vers CHECKED_IN
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.CONFIRMED]).toContain(BOOKING_STATUS.CHECKED_IN);

      // CHECKED_IN peut aller vers COMPLETED
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.CHECKED_IN]).toContain(BOOKING_STATUS.COMPLETED);

      // États finaux n'ont pas de transitions
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.COMPLETED]).toHaveLength(0);
      expect(BOOKING_STATUS_TRANSITIONS[BOOKING_STATUS.REJECTED]).toHaveLength(0);
    });

    test('ne devrait pas avoir de transitions circulaires directes', () => {
      Object.entries(BOOKING_STATUS_TRANSITIONS).forEach(([fromStatus, toStatuses]) => {
        toStatuses.forEach(toStatus => {
          const reverseTransitions = BOOKING_STATUS_TRANSITIONS[toStatus] || [];
          if (reverseTransitions.includes(fromStatus)) {
            // Éviter les cycles directs sauf cas spéciaux (ex: CONFIRMED ↔ CANCELLED)
            const allowedCycles = [
              [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CANCELLED],
              [BOOKING_STATUS.CANCELLED, BOOKING_STATUS.CONFIRMED]
            ];
            
            const cycleExists = allowedCycles.some(cycle => 
              (cycle[0] === fromStatus && cycle[1] === toStatus) ||
              (cycle[1] === fromStatus && cycle[0] === toStatus)
            );
            
            if (!cycleExists) {
              fail(`Cycle détecté entre ${fromStatus} et ${toStatus}`);
            }
          }
        });
      });
    });
  });
});

describe('Fonctions Helpers', () => {
  
  describe('isValidRoomType', () => {
    test('devrait valider les types de chambres corrects', () => {
      Object.values(ROOM_TYPES).forEach(roomType => {
        expect(isValidRoomType(roomType)).toBe(true);
      });
    });

    test('devrait rejeter les types invalides', () => {
      const invalidTypes = ['Studio', 'Penthouse', '', null, undefined, 123];
      
      invalidTypes.forEach(type => {
        expect(isValidRoomType(type)).toBe(false);
      });
    });
  });

  describe('isValidBookingStatus', () => {
    test('devrait valider les statuts de réservation corrects', () => {
      Object.values(BOOKING_STATUS).forEach(status => {
        expect(isValidBookingStatus(status)).toBe(true);
      });
    });

    test('devrait rejeter les statuts invalides', () => {
      const invalidStatuses = ['Processing', 'Active', '', null, undefined];
      
      invalidStatuses.forEach(status => {
        expect(isValidBookingStatus(status)).toBe(false);
      });
    });
  });

  describe('isValidUserRole', () => {
    test('devrait valider les rôles utilisateur corrects', () => {
      Object.values(USER_ROLES).forEach(role => {
        expect(isValidUserRole(role)).toBe(true);
      });
    });

    test('devrait rejeter les rôles invalides', () => {
      const invalidRoles = ['MANAGER', 'GUEST', 'SUPER_ADMIN', '', null];
      
      invalidRoles.forEach(role => {
        expect(isValidUserRole(role)).toBe(false);
      });
    });
  });

  describe('canTransitionBookingStatus', () => {
    test('devrait autoriser les transitions valides', () => {
      // Transitions autorisées selon le workflow
      expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING, BOOKING_STATUS.CONFIRMED)).toBe(true);
      expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING, BOOKING_STATUS.REJECTED)).toBe(true);
      expect(canTransitionBookingStatus(BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN)).toBe(true);
      expect(canTransitionBookingStatus(BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED)).toBe(true);
    });

    test('devrait rejeter les transitions invalides', () => {
      // Transitions interdites
      expect(canTransitionBookingStatus(BOOKING_STATUS.COMPLETED, BOOKING_STATUS.PENDING)).toBe(false);
      expect(canTransitionBookingStatus(BOOKING_STATUS.REJECTED, BOOKING_STATUS.CONFIRMED)).toBe(false);
      expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING, BOOKING_STATUS.COMPLETED)).toBe(false);
    });

    test('devrait gérer les paramètres invalides', () => {
      expect(canTransitionBookingStatus(null, BOOKING_STATUS.CONFIRMED)).toBe(false);
      expect(canTransitionBookingStatus(BOOKING_STATUS.PENDING, null)).toBe(false);
      expect(canTransitionBookingStatus('InvalidStatus', BOOKING_STATUS.CONFIRMED)).toBe(false);
    });
  });

  describe('hasPermission', () => {
    test('ADMIN devrait avoir toutes les permissions', () => {
      expect(hasPermission(USER_ROLES.ADMIN, 'booking:create')).toBe(true);
      expect(hasPermission(USER_ROLES.ADMIN, 'hotel:delete')).toBe(true);
      expect(hasPermission(USER_ROLES.ADMIN, 'any:permission')).toBe(true);
    });

    test('CLIENT devrait avoir des permissions limitées', () => {
      expect(hasPermission(USER_ROLES.CLIENT, 'booking:create')).toBe(true);
      expect(hasPermission(USER_ROLES.CLIENT, 'booking:read:own')).toBe(true);
      expect(hasPermission(USER_ROLES.CLIENT, 'hotel:delete')).toBe(false);
      expect(hasPermission(USER_ROLES.CLIENT, 'user:create')).toBe(false);
    });

    test('RECEPTIONIST devrait avoir permissions intermédiaires', () => {
      expect(hasPermission(USER_ROLES.RECEPTIONIST, 'booking:create')).toBe(true);
      expect(hasPermission(USER_ROLES.RECEPTIONIST, 'booking:checkin')).toBe(true);
      expect(hasPermission(USER_ROLES.RECEPTIONIST, 'room:update:status')).toBe(true);
      expect(hasPermission(USER_ROLES.RECEPTIONIST, 'hotel:delete')).toBe(false);
    });

    test('devrait gérer les wildcards', () => {
      expect(hasPermission(USER_ROLES.ADMIN, 'booking:*')).toBe(true);
      expect(hasPermission(USER_ROLES.RECEPTIONIST, 'booking:*')).toBe(false);
    });

    test('devrait gérer les rôles invalides', () => {
      expect(hasPermission('INVALID_ROLE', 'booking:create')).toBe(false);
      expect(hasPermission(null, 'booking:create')).toBe(false);
    });
  });
});

describe('Constants - Cohérence Globale', () => {
  
  test('tous les objets constants devraient être définis', () => {
    const constants = [
      ROOM_TYPES, ROOM_STATUS, BOOKING_STATUS, USER_ROLES,
      SEASONS, HOTEL_CATEGORIES, BUSINESS_RULES, ERROR_MESSAGES
    ];

    constants.forEach(constant => {
      expect(constant).toBeDefined();
      expect(typeof constant).toBe('object');
      expect(constant).not.toBeNull();
    });
  });

  test('les énumérations devraient avoir des valeurs uniques', () => {
    const enums = [ROOM_TYPES, ROOM_STATUS, BOOKING_STATUS, USER_ROLES, SEASONS];

    enums.forEach(enumObj => {
      const values = Object.values(enumObj);
      const uniqueValues = [...new Set(values)];
      expect(values).toHaveLength(uniqueValues.length);
    });
  });

  test('les multiplicateurs devraient être cohérents', () => {
    // Vérifier que tous les multiplicateurs sont positifs
    const multiplierObjects = [
      ROOM_TYPE_MULTIPLIERS,
      SEASONAL_MULTIPLIERS,
      HOTEL_CATEGORY_MULTIPLIERS
    ];

    multiplierObjects.forEach(obj => {
      Object.values(obj).forEach(multiplier => {
        expect(multiplier).toBeGreaterThan(0);
        expect(typeof multiplier).toBe('number');
      });
    });
  });

  test('les règles business devraient être réalistes', () => {
    expect(BUSINESS_RULES.MIN_BOOKING_NIGHTS).toBeGreaterThanOrEqual(1);
    expect(BUSINESS_RULES.MAX_BOOKING_NIGHTS).toBeLessThanOrEqual(365);
    expect(BUSINESS_RULES.MIN_ROOM_PRICE).toBeGreaterThan(0);
    expect(BUSINESS_RULES.MAX_ROOM_PRICE).toBeLessThan(100000); // Prix max réaliste
    expect(BUSINESS_RULES.FREE_CANCELLATION_HOURS).toBeGreaterThanOrEqual(0);
  });
});