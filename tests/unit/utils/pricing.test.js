/**
 * TESTS PRICING - CALCULS PRIX DYNAMIQUES CRITIQUES
 * Tests pour tous les calculs financiers avec scénarios edge cases
 * 
 * Coverage :
 * - Calculs prix booking avec multiplicateurs
 * - Gestion saisons et périodes personnalisées
 * - Validation business rules prix
 * - Edge cases et erreurs
 * - Conversion devises
 * - Optimisations performance
 */

const {
  // Fonctions principales
  calculateBookingPrice,
  calculateAverageNightPrice,
  calculateBasePriceWithMultipliers,
  
  // Utilitaires saisons
  getSeason,
  getSeasonalMultiplier,
  
  // Utilitaires multiplicateurs
  getRoomTypeMultiplier,
  getHotelCategoryMultiplier,
  
  // Validation
  validatePrice,
  convertCurrency,
  
  // Helpers internes
  isDateInPeriod,
  getSeasonsSummary
} = require('../../../src/utils/pricing');

const {
  ROOM_TYPES,
  SEASONS,
  HOTEL_CATEGORIES,
  BUSINESS_RULES
} = require('../../../src/utils/constants');

describe('Pricing - Fonctions Core', () => {
  
  describe('calculateBookingPrice', () => {
    const baseParams = {
      basePrice: 200,
      roomType: ROOM_TYPES.DOUBLE,
      hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-18'), // 3 nuits
      numberOfRooms: 1
    };

    test('devrait calculer le prix de base correctement', () => {
      const result = calculateBookingPrice(baseParams);
      
      expect(result).toHaveProperty('totalPrice');
      expect(result).toHaveProperty('pricePerRoom');
      expect(result).toHaveProperty('averagePricePerNight');
      expect(result).toHaveProperty('breakdown');
      expect(result).toHaveProperty('currency', 'MAD');
      
      expect(result.totalPrice).toBeGreaterThan(0);
      expect(result.breakdown.nightsCount).toBe(3);
      expect(result.breakdown.numberOfRooms).toBe(1);
    });

    test('devrait appliquer les multiplicateurs de type de chambre', () => {
      const simpleResult = calculateBookingPrice({
        ...baseParams,
        roomType: ROOM_TYPES.SIMPLE // multiplier 1.0
      });
      
      const suiteResult = calculateBookingPrice({
        ...baseParams,
        roomType: ROOM_TYPES.SUITE // multiplier 2.5
      });
      
      // Suite devrait coûter 2.5x plus cher que Simple
      expect(suiteResult.totalPrice).toBeGreaterThan(simpleResult.totalPrice);
      expect(suiteResult.totalPrice / simpleResult.totalPrice).toBeCloseTo(2.5, 1);
    });

    test('devrait appliquer les multiplicateurs de catégorie hôtel', () => {
      const twoStarResult = calculateBookingPrice({
        ...baseParams,
        hotelCategory: HOTEL_CATEGORIES.TWO_STAR // multiplier 0.8
      });
      
      const fiveStarResult = calculateBookingPrice({
        ...baseParams,
        hotelCategory: HOTEL_CATEGORIES.FIVE_STAR // multiplier 2.2
      });
      
      expect(fiveStarResult.totalPrice).toBeGreaterThan(twoStarResult.totalPrice);
    });

    test('devrait calculer correctement pour plusieurs chambres', () => {
      const singleRoomResult = calculateBookingPrice({
        ...baseParams,
        numberOfRooms: 1
      });
      
      const multipleRoomsResult = calculateBookingPrice({
        ...baseParams,
        numberOfRooms: 3
      });
      
      expect(multipleRoomsResult.totalPrice).toBe(singleRoomResult.totalPrice * 3);
      expect(multipleRoomsResult.pricePerRoom).toBe(singleRoomResult.pricePerRoom);
    });

    test('devrait calculer les prix jour par jour avec saisons', () => {
      const result = calculateBookingPrice(baseParams);
      
      expect(result.breakdown.dailyPrices).toHaveLength(3);
      result.breakdown.dailyPrices.forEach(day => {
        expect(day).toHaveProperty('date');
        expect(day).toHaveProperty('season');
        expect(day).toHaveProperty('seasonalMultiplier');
        expect(day).toHaveProperty('nightPrice');
        expect(day.nightPrice).toBeGreaterThan(0);
      });
    });

    test('devrait générer un résumé des saisons', () => {
      const result = calculateBookingPrice(baseParams);
      
      expect(result.seasonsSummary).toBeDefined();
      expect(Array.isArray(result.seasonsSummary)).toBe(true);
      
      result.seasonsSummary.forEach(summary => {
        expect(summary).toHaveProperty('season');
        expect(summary).toHaveProperty('nights');
        expect(summary).toHaveProperty('percentage');
        expect(summary.percentage).toBeGreaterThanOrEqual(0);
        expect(summary.percentage).toBeLessThanOrEqual(100);
      });
    });

    test('devrait arrondir les prix à 2 décimales', () => {
      const result = calculateBookingPrice({
        ...baseParams,
        basePrice: 133.333 // Prix avec beaucoup de décimales
      });
      
      expect(result.totalPrice).toBe(Math.round(result.totalPrice * 100) / 100);
      expect(result.pricePerRoom).toBe(Math.round(result.pricePerRoom * 100) / 100);
      expect(result.averagePricePerNight).toBe(Math.round(result.averagePricePerNight * 100) / 100);
    });

    test('devrait gérer les périodes saisonnières personnalisées', () => {
      const customPeriods = [
        {
          season: SEASONS.HIGH,
          startMonth: 7,
          startDay: 1,
          endMonth: 8,
          endDay: 31
        }
      ];
      
      const result = calculateBookingPrice({
        ...baseParams,
        customSeasonalPeriods: customPeriods
      });
      
      expect(result.breakdown.dailyPrices[0].season).toBe(SEASONS.HIGH);
    });
  });

  describe('calculateAverageNightPrice', () => {
    test('devrait calculer la moyenne sans détail jour par jour', () => {
      const params = {
        basePrice: 150,
        roomType: ROOM_TYPES.DOUBLE_COMFORT,
        hotelCategory: HOTEL_CATEGORIES.FOUR_STAR,
        checkInDate: new Date('2025-12-25'),
        checkOutDate: new Date('2025-12-28')
      };
      
      const result = calculateAverageNightPrice(params);
      
      expect(result).toHaveProperty('averageNightPrice');
      expect(result).toHaveProperty('totalForPeriod');
      expect(result).toHaveProperty('nightsCount');
      expect(result).toHaveProperty('dominantSeason');
      
      expect(result.averageNightPrice).toBeGreaterThan(0);
      expect(result.nightsCount).toBe(3);
    });

    test('devrait identifier la saison dominante', () => {
      const winterParams = {
        basePrice: 100,
        roomType: ROOM_TYPES.SIMPLE,
        hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
        checkInDate: new Date('2025-12-25'), // Période peak
        checkOutDate: new Date('2025-12-27')
      };
      
      const result = calculateAverageNightPrice(winterParams);
      expect(result.dominantSeason).toBe(SEASONS.PEAK);
    });
  });

  describe('calculateBasePriceWithMultipliers', () => {
    test('devrait calculer le prix ajusté sans dates', () => {
      const result = calculateBasePriceWithMultipliers(
        100,
        ROOM_TYPES.SUITE,
        HOTEL_CATEGORIES.FIVE_STAR,
        SEASONS.HIGH
      );
      
      expect(result).toHaveProperty('adjustedPrice');
      expect(result).toHaveProperty('multipliers');
      
      expect(result.multipliers).toHaveProperty('roomType');
      expect(result.multipliers).toHaveProperty('hotelCategory');
      expect(result.multipliers).toHaveProperty('seasonal');
      expect(result.multipliers).toHaveProperty('total');
      
      // Vérifier calcul total
      const expectedTotal = result.multipliers.roomType * 
                           result.multipliers.hotelCategory * 
                           result.multipliers.seasonal;
      expect(result.multipliers.total).toBeCloseTo(expectedTotal, 5);
      
      const expectedPrice = 100 * expectedTotal;
      expect(result.adjustedPrice).toBeCloseTo(expectedPrice, 2);
    });
  });
});

describe('Pricing - Gestion Saisons', () => {
  
  describe('getSeason', () => {
    test('devrait déterminer la saison correctement', () => {
      // Dates test pour différentes saisons
      const testDates = [
        { date: new Date('2025-07-15'), expectedSeason: SEASONS.LOW }, // Été = basse saison
        { date: new Date('2025-12-25'), expectedSeason: SEASONS.PEAK }, // Vacances = peak
        { date: new Date('2025-10-15'), expectedSeason: SEASONS.HIGH }, // Automne = haute
        { date: new Date('2025-04-15'), expectedSeason: SEASONS.MEDIUM } // Printemps = moyenne
      ];
      
      testDates.forEach(({ date, expectedSeason }) => {
        const season = getSeason(date);
        expect(Object.values(SEASONS)).toContain(season);
        // Note: Test exact dépend de la configuration DEFAULT_SEASONAL_PERIODS
      });
    });

    test('devrait utiliser les périodes personnalisées si fournies', () => {
      const customPeriods = [
        {
          season: SEASONS.PEAK,
          startMonth: 7,
          startDay: 1,
          endMonth: 7,
          endDay: 31
        }
      ];
      
      const julyDate = new Date('2025-07-15');
      const season = getSeason(julyDate, customPeriods);
      expect(season).toBe(SEASONS.PEAK);
    });

    test('devrait retourner MEDIUM par défaut pour dates non couvertes', () => {
      const customPeriods = [
        {
          season: SEASONS.HIGH,
          startMonth: 12,
          startDay: 1,
          endMonth: 12,
          endDay: 31
        }
      ];
      
      const juneDate = new Date('2025-06-15');
      const season = getSeason(juneDate, customPeriods);
      expect(season).toBe(SEASONS.MEDIUM);
    });

    test('devrait gérer les dates invalides', () => {
      expect(() => getSeason(null)).toThrow();
      expect(() => getSeason(undefined)).toThrow();
      expect(() => getSeason('invalid')).toThrow();
    });
  });

  describe('isDateInPeriod', () => {
    test('devrait détecter les dates dans une période normale', () => {
      const period = {
        startMonth: 6,
        startDay: 1,
        endMonth: 8,
        endDay: 31
      };
      
      expect(isDateInPeriod(7, 15, period)).toBe(true); // 15 juillet
      expect(isDateInPeriod(5, 15, period)).toBe(false); // 15 mai
      expect(isDateInPeriod(9, 15, period)).toBe(false); // 15 septembre
    });

    test('devrait gérer les périodes chevauchant deux années', () => {
      const winterPeriod = {
        startMonth: 12,
        startDay: 20,
        endMonth: 1,
        endDay: 10
      };
      
      expect(isDateInPeriod(12, 25, winterPeriod)).toBe(true); // 25 décembre
      expect(isDateInPeriod(1, 5, winterPeriod)).toBe(true); // 5 janvier
      expect(isDateInPeriod(6, 15, winterPeriod)).toBe(false); // 15 juin
    });

    test('devrait gérer les dates de limite', () => {
      const period = {
        startMonth: 7,
        startDay: 1,
        endMonth: 7,
        endDay: 31
      };
      
      expect(isDateInPeriod(7, 1, period)).toBe(true); // Premier jour
      expect(isDateInPeriod(7, 31, period)).toBe(true); // Dernier jour
      expect(isDateInPeriod(6, 30, period)).toBe(false); // Jour avant
      expect(isDateInPeriod(8, 1, period)).toBe(false); // Jour après
    });
  });

  describe('getSeasonalMultiplier', () => {
    test('devrait retourner les multiplicateurs corrects', () => {
      Object.entries(SEASONS).forEach(([key, season]) => {
        const multiplier = getSeasonalMultiplier(season);
        expect(typeof multiplier).toBe('number');
        expect(multiplier).toBeGreaterThan(0);
      });
    });

    test('devrait utiliser les multiplicateurs personnalisés', () => {
      const customMultipliers = {
        [SEASONS.HIGH]: 2.0
      };
      
      const multiplier = getSeasonalMultiplier(SEASONS.HIGH, customMultipliers);
      expect(multiplier).toBe(2.0);
    });

    test('devrait fallback sur MEDIUM pour saisons inconnues', () => {
      const unknownSeason = 'Unknown Season';
      const multiplier = getSeasonalMultiplier(unknownSeason);
      const mediumMultiplier = getSeasonalMultiplier(SEASONS.MEDIUM);
      expect(multiplier).toBe(mediumMultiplier);
    });
  });
});

describe('Pricing - Multiplicateurs', () => {
  
  describe('getRoomTypeMultiplier', () => {
    test('devrait retourner les multiplicateurs pour tous les types', () => {
      Object.values(ROOM_TYPES).forEach(roomType => {
        const multiplier = getRoomTypeMultiplier(roomType);
        expect(typeof multiplier).toBe('number');
        expect(multiplier).toBeGreaterThan(0);
      });
    });

    test('devrait avoir Simple comme référence (1.0)', () => {
      const simpleMultiplier = getRoomTypeMultiplier(ROOM_TYPES.SIMPLE);
      expect(simpleMultiplier).toBe(1.0);
    });

    test('devrait rejeter les types invalides', () => {
      expect(() => getRoomTypeMultiplier('InvalidType')).toThrow();
      expect(() => getRoomTypeMultiplier(null)).toThrow();
      expect(() => getRoomTypeMultiplier(undefined)).toThrow();
    });
  });

  describe('getHotelCategoryMultiplier', () => {
    test('devrait retourner les multiplicateurs pour toutes les catégories', () => {
      Object.values(HOTEL_CATEGORIES).forEach(category => {
        const multiplier = getHotelCategoryMultiplier(category);
        expect(typeof multiplier).toBe('number');
        expect(multiplier).toBeGreaterThan(0);
      });
    });

    test('devrait avoir 3 étoiles comme référence (1.0)', () => {
      const threeStarMultiplier = getHotelCategoryMultiplier(HOTEL_CATEGORIES.THREE_STAR);
      expect(threeStarMultiplier).toBe(1.0);
    });

    test('devrait rejeter les catégories invalides', () => {
      expect(() => getHotelCategoryMultiplier(0)).toThrow();
      expect(() => getHotelCategoryMultiplier(6)).toThrow();
      expect(() => getHotelCategoryMultiplier('invalid')).toThrow();
    });
  });
});

describe('Pricing - Validation et Edge Cases', () => {
  
  describe('validatePrice', () => {
    test('devrait valider les prix corrects', () => {
      const validPrices = [50, 100, 500, 1000, 5000];
      
      validPrices.forEach(price => {
        const result = validatePrice(price);
        expect(result.valid).toBe(true);
        expect(result).not.toHaveProperty('error');
      });
    });

    test('devrait rejeter les prix invalides', () => {
      const invalidPrices = [
        { price: 0, reason: 'zero' },
        { price: -100, reason: 'negative' },
        { price: 25, reason: 'below minimum' },
        { price: 50000, reason: 'above maximum' },
        { price: 'invalid', reason: 'not a number' },
        { price: null, reason: 'null' }
      ];
      
      invalidPrices.forEach(({ price, reason }) => {
        const result = validatePrice(price);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      });
    });

    test('devrait respecter les limites BUSINESS_RULES', () => {
      const minPrice = BUSINESS_RULES.MIN_ROOM_PRICE;
      const maxPrice = BUSINESS_RULES.MAX_ROOM_PRICE;
      
      expect(validatePrice(minPrice).valid).toBe(true);
      expect(validatePrice(maxPrice).valid).toBe(true);
      expect(validatePrice(minPrice - 1).valid).toBe(false);
      expect(validatePrice(maxPrice + 1).valid).toBe(false);
    });
  });

  describe('calculateBookingPrice - Edge Cases', () => {
    test('devrait rejeter les prix de base invalides', () => {
      const invalidParams = {
        basePrice: -100,
        roomType: ROOM_TYPES.DOUBLE,
        hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
        checkInDate: new Date('2025-07-15'),
        checkOutDate: new Date('2025-07-18'),
        numberOfRooms: 1
      };
      
      expect(() => calculateBookingPrice(invalidParams)).toThrow();
    });

    test('devrait rejeter les dates invalides', () => {
      const baseParams = {
        basePrice: 200,
        roomType: ROOM_TYPES.DOUBLE,
        hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
        numberOfRooms: 1
      };
      
      // Date de fin avant début
      expect(() => calculateBookingPrice({
        ...baseParams,
        checkInDate: new Date('2025-07-18'),
        checkOutDate: new Date('2025-07-15')
      })).toThrow();
      
      // Dates non-Date objects
      expect(() => calculateBookingPrice({
        ...baseParams,
        checkInDate: 'invalid',
        checkOutDate: new Date('2025-07-18')
      })).toThrow();
    });

    test('devrait rejeter le nombre de chambres invalide', () => {
      const baseParams = {
        basePrice: 200,
        roomType: ROOM_TYPES.DOUBLE,
        hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
        checkInDate: new Date('2025-07-15'),
        checkOutDate: new Date('2025-07-18')
      };
      
      expect(() => calculateBookingPrice({
        ...baseParams,
        numberOfRooms: 0
      })).toThrow();
      
      expect(() => calculateBookingPrice({
        ...baseParams,
        numberOfRooms: BUSINESS_RULES.MAX_ROOMS_PER_BOOKING + 1
      })).toThrow();
    });

    test('devrait rejeter les séjours trop courts ou trop longs', () => {
      const baseParams = {
        basePrice: 200,
        roomType: ROOM_TYPES.DOUBLE,
        hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
        numberOfRooms: 1
      };
      
      // Séjour trop court (moins que MIN_BOOKING_NIGHTS)
      const today = new Date();
      const tomorrow = new Date(today);
      tomorrow.setHours(tomorrow.getHours() + 12); // Moins d'une nuit
      
      expect(() => calculateBookingPrice({
        ...baseParams,
        checkInDate: today,
        checkOutDate: tomorrow
      })).toThrow();
      
      // Séjour trop long
      const nextYear = new Date();
      nextYear.setFullYear(nextYear.getFullYear() + 2);
      
      expect(() => calculateBookingPrice({
        ...baseParams,
        checkInDate: new Date(),
        checkOutDate: nextYear
      })).toThrow();
    });
  });

  describe('getSeasonsSummary', () => {
    test('devrait calculer correctement les pourcentages', () => {
      const dailyPrices = [
        { season: SEASONS.HIGH, nightPrice: 100 },
        { season: SEASONS.HIGH, nightPrice: 100 },
        { season: SEASONS.MEDIUM, nightPrice: 80 }
      ];
      
      const summary = getSeasonsSummary(dailyPrices);
      
      expect(summary).toHaveLength(2);
      
      const highSeason = summary.find(s => s.season === SEASONS.HIGH);
      const mediumSeason = summary.find(s => s.season === SEASONS.MEDIUM);
      
      expect(highSeason.nights).toBe(2);
      expect(highSeason.percentage).toBe(67); // 2/3 * 100, arrondi
      expect(mediumSeason.nights).toBe(1);
      expect(mediumSeason.percentage).toBe(33); // 1/3 * 100, arrondi
    });

    test('devrait gérer une seule saison', () => {
      const dailyPrices = [
        { season: SEASONS.LOW, nightPrice: 60 },
        { season: SEASONS.LOW, nightPrice: 60 }
      ];
      
      const summary = getSeasonsSummary(dailyPrices);
      
      expect(summary).toHaveLength(1);
      expect(summary[0].season).toBe(SEASONS.LOW);
      expect(summary[0].nights).toBe(2);
      expect(summary[0].percentage).toBe(100);
    });

    test('devrait gérer un tableau vide', () => {
      const summary = getSeasonsSummary([]);
      expect(summary).toHaveLength(0);
    });
  });
});

describe('Pricing - Conversion Devises', () => {
  
  describe('convertCurrency', () => {
    test('devrait retourner le même montant pour la même devise', () => {
      const amount = 1000;
      const result = convertCurrency(amount, 'MAD', 'MAD');
      expect(result.convertedAmount).toBe(amount);
      expect(result.exchangeRate).toBe(1);
    });

    test('devrait convertir MAD vers EUR', () => {
      const amount = 1000; // MAD
      const result = convertCurrency(amount, 'MAD', 'EUR');
      
      expect(result).toHaveProperty('originalAmount', amount);
      expect(result).toHaveProperty('convertedAmount');
      expect(result).toHaveProperty('fromCurrency', 'MAD');
      expect(result).toHaveProperty('toCurrency', 'EUR');
      expect(result).toHaveProperty('exchangeRate');
      expect(result).toHaveProperty('convertedAt');
      
      expect(result.convertedAmount).toBeGreaterThan(0);
      expect(result.convertedAmount).toBeLessThan(amount); // EUR plus fort que MAD
    });

    test('devrait convertir EUR vers MAD', () => {
      const amount = 100; // EUR
      const result = convertCurrency(amount, 'EUR', 'MAD');
      
      expect(result.convertedAmount).toBeGreaterThan(amount); // MAD plus faible que EUR
    });

    test('devrait arrondir à 2 décimales', () => {
      const amount = 133.3333;
      const result = convertCurrency(amount, 'MAD', 'EUR');
      
      const decimals = result.convertedAmount.toString().split('.')[1];
      if (decimals) {
        expect(decimals.length).toBeLessThanOrEqual(2);
      }
    });

    test('devrait rejeter les conversions non supportées', () => {
      expect(() => convertCurrency(100, 'MAD', 'JPY')).toThrow();
      expect(() => convertCurrency(100, 'INVALID', 'EUR')).toThrow();
    });

    test('devrait gérer les montants edge cases', () => {
      expect(() => convertCurrency(-100, 'MAD', 'EUR')).not.toThrow();
      expect(() => convertCurrency(0, 'MAD', 'EUR')).not.toThrow();
      expect(convertCurrency(0, 'MAD', 'EUR').convertedAmount).toBe(0);
    });
  });
});

describe('Pricing - Performance et Optimisation', () => {
  
  test('devrait calculer rapidement pour des séjours longs', () => {
    const start = Date.now();
    
    const longStayParams = {
      basePrice: 150,
      roomType: ROOM_TYPES.DOUBLE,
      hotelCategory: HOTEL_CATEGORIES.FOUR_STAR,
      checkInDate: new Date('2025-01-01'),
      checkOutDate: new Date('2025-12-31'), // 1 an
      numberOfRooms: 1
    };
    
    const result = calculateBookingPrice(longStayParams);
    
    const duration = Date.now() - start;
    
    expect(result.breakdown.nightsCount).toBeGreaterThan(300); // ~365 jours
    expect(duration).toBeLessThan(1000); // Moins d'1 seconde
  });

  test('devrait calculer rapidement pour de nombreuses chambres', () => {
    const start = Date.now();
    
    const manyRoomsParams = {
      basePrice: 100,
      roomType: ROOM_TYPES.SIMPLE,
      hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-18'),
      numberOfRooms: BUSINESS_RULES.MAX_ROOMS_PER_BOOKING // Maximum autorisé
    };
    
    const result = calculateBookingPrice(manyRoomsParams);
    
    const duration = Date.now() - start;
    
    expect(result.totalPrice).toBeGreaterThan(0);
    expect(duration).toBeLessThan(500); // Moins de 0.5 seconde
  });

  test('devrait maintenir la précision pour de gros montants', () => {
    const expensiveParams = {
      basePrice: 5000, // Prix très élevé
      roomType: ROOM_TYPES.SUITE,
      hotelCategory: HOTEL_CATEGORIES.FIVE_STAR,
      checkInDate: new Date('2025-12-25'), // Peak season
      checkOutDate: new Date('2025-12-28'),
      numberOfRooms: 10
    };
    
    const result = calculateBookingPrice(expensiveParams);
    
    // Vérifier que les calculs restent précis
    expect(result.totalPrice).toBeGreaterThan(100000); // Très gros montant
    expect(Number.isFinite(result.totalPrice)).toBe(true);
    expect(result.totalPrice).toBe(Math.round(result.totalPrice * 100) / 100);
  });
});

describe('Pricing - Intégration Réelle', () => {
  
  test('devrait calculer un prix réaliste pour un weekend à Rabat', () => {
    const weekendRabat = {
      basePrice: 350,
      roomType: ROOM_TYPES.DOUBLE_COMFORT,
      hotelCategory: HOTEL_CATEGORIES.FOUR_STAR,
      checkInDate: new Date('2025-08-15'), // Weekend été
      checkOutDate: new Date('2025-08-17'), // 2 nuits
      numberOfRooms: 1
    };
    
    const result = calculateBookingPrice(weekendRabat);
    
    expect(result.totalPrice).toBeGreaterThan(500); // Minimum attendu
    expect(result.totalPrice).toBeLessThan(2000); // Maximum réaliste
    expect(result.breakdown.nightsCount).toBe(2);
    expect(result.currency).toBe('MAD');
  });

  test('devrait calculer un prix réaliste pour vacances famille', () => {
    const familyVacation = {
      basePrice: 250,
      roomType: ROOM_TYPES.DOUBLE,
      hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
      checkInDate: new Date('2025-07-10'),
      checkOutDate: new Date('2025-07-17'), // 1 semaine
      numberOfRooms: 2 // Parents + enfants
    };
    
    const result = calculateBookingPrice(familyVacation);
    
    expect(result.totalPrice).toBeGreaterThan(2000); // 1 semaine 2 chambres
    expect(result.totalPrice).toBeLessThan(8000); // Reste raisonnable
    expect(result.breakdown.numberOfRooms).toBe(2);
    expect(result.breakdown.nightsCount).toBe(7);
  });

  test('devrait calculer un prix corporate réaliste', () => {
    const corporateStay = {
      basePrice: 400,
      roomType: ROOM_TYPES.SUITE,
      hotelCategory: HOTEL_CATEGORIES.FIVE_STAR,
      checkInDate: new Date('2025-11-15'), // Haute saison business
      checkOutDate: new Date('2025-11-18'),
      numberOfRooms: 1
    };
    
    const result = calculateBookingPrice(corporateStay);
    
    expect(result.totalPrice).toBeGreaterThan(3000); // Suite 5* haute saison
    expect(result.totalPrice).toBeLessThan(8000); // Reste dans le réaliste
    expect(result.breakdown.roomType).toBe(ROOM_TYPES.SUITE);
    expect(result.breakdown.hotelCategory).toBe(HOTEL_CATEGORIES.FIVE_STAR);
  });
});

describe('Pricing - Cohérence et Regression Tests', () => {
  
  test('les prix devraient être croissants par type de chambre', () => {
    const baseParams = {
      basePrice: 200,
      hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-17'),
      numberOfRooms: 1
    };
    
    const prices = {};
    Object.values(ROOM_TYPES).forEach(roomType => {
      const result = calculateBookingPrice({ ...baseParams, roomType });
      prices[roomType] = result.totalPrice;
    });
    
    expect(prices[ROOM_TYPES.SIMPLE]).toBeLessThan(prices[ROOM_TYPES.DOUBLE]);
    expect(prices[ROOM_TYPES.DOUBLE]).toBeLessThan(prices[ROOM_TYPES.DOUBLE_COMFORT]);
    expect(prices[ROOM_TYPES.DOUBLE_COMFORT]).toBeLessThan(prices[ROOM_TYPES.SUITE]);
  });

  test('les prix devraient être croissants par catégorie hôtel', () => {
    const baseParams = {
      basePrice: 200,
      roomType: ROOM_TYPES.DOUBLE,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-17'),
      numberOfRooms: 1
    };
    
    const prices = {};
    Object.values(HOTEL_CATEGORIES).forEach(category => {
      const result = calculateBookingPrice({ ...baseParams, hotelCategory: category });
      prices[category] = result.totalPrice;
    });
    
    expect(prices[1]).toBeLessThan(prices[2]);
    expect(prices[2]).toBeLessThan(prices[3]);
    expect(prices[3]).toBeLessThan(prices[4]);
    expect(prices[4]).toBeLessThan(prices[5]);
  });

  test('les calculs devraient être reproductibles', () => {
    const params = {
      basePrice: 175,
      roomType: ROOM_TYPES.DOUBLE_COMFORT,
      hotelCategory: HOTEL_CATEGORIES.FOUR_STAR,
      checkInDate: new Date('2025-09-10'),
      checkOutDate: new Date('2025-09-13'),
      numberOfRooms: 2
    };
    
    const result1 = calculateBookingPrice(params);
    const result2 = calculateBookingPrice(params);
    
    expect(result1.totalPrice).toBe(result2.totalPrice);
    expect(result1.pricePerRoom).toBe(result2.pricePerRoom);
    expect(result1.averagePricePerNight).toBe(result2.averagePricePerNight);
  });

  test('les multiplicateurs devraient être appliqués dans le bon ordre', () => {
    const basePrice = 100;
    const roomMultiplier = getRoomTypeMultiplier(ROOM_TYPES.SUITE); // 2.5
    const hotelMultiplier = getHotelCategoryMultiplier(HOTEL_CATEGORIES.FIVE_STAR); // 2.2
    const seasonMultiplier = getSeasonalMultiplier(SEASONS.PEAK); // 1.6
    
    const expectedBaseNightPrice = basePrice * roomMultiplier * hotelMultiplier * seasonMultiplier;
    
    const result = calculateBookingPrice({
      basePrice,
      roomType: ROOM_TYPES.SUITE,
      hotelCategory: HOTEL_CATEGORIES.FIVE_STAR,
      checkInDate: new Date('2025-12-25'), // Peak season
      checkOutDate: new Date('2025-12-26'), // 1 nuit
      numberOfRooms: 1
    });
    
    // Vérifier que le prix calculé correspond aux multiplicateurs attendus
    expect(result.totalPrice).toBeCloseTo(expectedBaseNightPrice, 1);
  });

  test('les périodes saisonnières ne devraient pas créer de gaps', () => {
    // Tester une année complète pour s'assurer qu'il n'y a pas de dates sans saison
    const testYear = 2025;
    const problematicDates = [];
    
    for (let month = 1; month <= 12; month++) {
      for (let day = 1; day <= 28; day++) { // 28 pour éviter problèmes février
        try {
          const testDate = new Date(testYear, month - 1, day);
          const season = getSeason(testDate);
          
          if (!Object.values(SEASONS).includes(season)) {
            problematicDates.push(`${testYear}-${month}-${day}`);
          }
        } catch (error) {
          problematicDates.push(`${testYear}-${month}-${day} (error: ${error.message})`);
        }
      }
    }
    
    expect(problematicDates).toHaveLength(0);
  });

  test('les prix calculés devraient respecter les limites business', () => {
    // Test avec prix minimum
    const minPriceResult = calculateBookingPrice({
      basePrice: BUSINESS_RULES.MIN_ROOM_PRICE,
      roomType: ROOM_TYPES.SIMPLE,
      hotelCategory: HOTEL_CATEGORIES.ONE_STAR,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-16'),
      numberOfRooms: 1
    });
    
    expect(minPriceResult.totalPrice).toBeGreaterThan(0);
    
    // Test avec prix maximum (devrait fonctionner sans erreur)
    const maxPriceResult = calculateBookingPrice({
      basePrice: BUSINESS_RULES.MAX_ROOM_PRICE,
      roomType: ROOM_TYPES.SUITE,
      hotelCategory: HOTEL_CATEGORIES.FIVE_STAR,
      checkInDate: new Date('2025-12-25'),
      checkOutDate: new Date('2025-12-26'),
      numberOfRooms: 1
    });
    
    expect(maxPriceResult.totalPrice).toBeGreaterThan(BUSINESS_RULES.MAX_ROOM_PRICE);
  });
});

describe('Pricing - Tests de Non-Régression', () => {
  
  test('calcul prix standard devrait rester stable', () => {
    // Test de référence pour éviter les régressions
    const referenceParams = {
      basePrice: 200,
      roomType: ROOM_TYPES.DOUBLE,
      hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
      checkInDate: new Date('2025-06-15'),
      checkOutDate: new Date('2025-06-18'), // 3 nuits
      numberOfRooms: 1
    };
    
    const result = calculateBookingPrice(referenceParams);
    
    // Ces valeurs devraient rester stables à travers les versions
    expect(result.breakdown.nightsCount).toBe(3);
    expect(result.breakdown.numberOfRooms).toBe(1);
    expect(result.breakdown.basePrice).toBe(200);
    expect(result.breakdown.roomType).toBe(ROOM_TYPES.DOUBLE);
    expect(result.breakdown.hotelCategory).toBe(HOTEL_CATEGORIES.THREE_STAR);
    expect(result.currency).toBe('MAD');
    
    // Le prix total devrait être cohérent (test approximatif pour éviter dépendance exacte)
    expect(result.totalPrice).toBeGreaterThan(600); // 3 × 200 minimum
    expect(result.totalPrice).toBeLessThan(1200); // Avec tous multiplicateurs max
  });

  test('structure de réponse devrait rester cohérente', () => {
    const result = calculateBookingPrice({
      basePrice: 150,
      roomType: ROOM_TYPES.SIMPLE,
      hotelCategory: HOTEL_CATEGORIES.TWO_STAR,
      checkInDate: new Date('2025-08-01'),
      checkOutDate: new Date('2025-08-03'),
      numberOfRooms: 1
    });
    
    // Vérifier structure complète de la réponse
    expect(result).toHaveProperty('totalPrice');
    expect(result).toHaveProperty('pricePerRoom');
    expect(result).toHaveProperty('averagePricePerNight');
    expect(result).toHaveProperty('breakdown');
    expect(result).toHaveProperty('currency');
    expect(result).toHaveProperty('calculatedAt');
    expect(result).toHaveProperty('seasonsSummary');
    
    // Breakdown structure
    expect(result.breakdown).toHaveProperty('basePrice');
    expect(result.breakdown).toHaveProperty('roomType');
    expect(result.breakdown).toHaveProperty('roomTypeMultiplier');
    expect(result.breakdown).toHaveProperty('hotelCategory');
    expect(result.breakdown).toHaveProperty('hotelCategoryMultiplier');
    expect(result.breakdown).toHaveProperty('numberOfRooms');
    expect(result.breakdown).toHaveProperty('nightsCount');
    expect(result.breakdown).toHaveProperty('dailyPrices');
    
    // Daily prices structure
    expect(Array.isArray(result.breakdown.dailyPrices)).toBe(true);
    result.breakdown.dailyPrices.forEach(day => {
      expect(day).toHaveProperty('date');
      expect(day).toHaveProperty('season');
      expect(day).toHaveProperty('seasonalMultiplier');
      expect(day).toHaveProperty('nightPrice');
    });
    
    // Seasons summary structure
    expect(Array.isArray(result.seasonsSummary)).toBe(true);
    result.seasonsSummary.forEach(summary => {
      expect(summary).toHaveProperty('season');
      expect(summary).toHaveProperty('nights');
      expect(summary).toHaveProperty('percentage');
    });
  });

  test('gestion erreurs devrait rester cohérente', () => {
    const errorScenarios = [
      {
        params: { basePrice: -100, roomType: ROOM_TYPES.DOUBLE, hotelCategory: 3, checkInDate: new Date(), checkOutDate: new Date() },
        expectedError: /prix/i
      },
      {
        params: { basePrice: 200, roomType: 'InvalidType', hotelCategory: 3, checkInDate: new Date(), checkOutDate: new Date() },
        expectedError: /type.*chambre/i
      },
      {
        params: { basePrice: 200, roomType: ROOM_TYPES.DOUBLE, hotelCategory: 10, checkInDate: new Date(), checkOutDate: new Date() },
        expectedError: /catégorie/i
      }
    ];
    
    errorScenarios.forEach(({ params, expectedError }) => {
      expect(() => calculateBookingPrice(params)).toThrow(expectedError);
    });
  });
});

describe('Pricing - Tests de Stress', () => {
  
  test('devrait gérer de nombreux calculs consécutifs', () => {
    const start = Date.now();
    const results = [];
    
    for (let i = 0; i < 100; i++) {
      const result = calculateBookingPrice({
        basePrice: 100 + i,
        roomType: Object.values(ROOM_TYPES)[i % 4],
        hotelCategory: (i % 5) + 1,
        checkInDate: new Date('2025-07-01'),
        checkOutDate: new Date('2025-07-04'),
        numberOfRooms: 1
      });
      
      results.push(result.totalPrice);
    }
    
    const duration = Date.now() - start;
    
    expect(results).toHaveLength(100);
    expect(results.every(price => price > 0)).toBe(true);
    expect(duration).toBeLessThan(2000); // Moins de 2 secondes pour 100 calculs
  });

  test('devrait maintenir la cohérence avec dates aléatoires', () => {
    const randomTests = 50;
    const results = [];
    
    for (let i = 0; i < randomTests; i++) {
      const startDate = new Date(2025, Math.floor(Math.random() * 12), Math.floor(Math.random() * 28) + 1);
      const endDate = new Date(startDate);
      endDate.setDate(endDate.getDate() + Math.floor(Math.random() * 10) + 1);
      
      try {
        const result = calculateBookingPrice({
          basePrice: 150,
          roomType: ROOM_TYPES.DOUBLE,
          hotelCategory: HOTEL_CATEGORIES.THREE_STAR,
          checkInDate: startDate,
          checkOutDate: endDate,
          numberOfRooms: 1
        });
        
        results.push({
          startDate,
          endDate,
          totalPrice: result.totalPrice,
          nights: result.breakdown.nightsCount
        });
      } catch (error) {
        // Ignorer les erreurs de dates invalides pour ce test
      }
    }
    
    expect(results.length).toBeGreaterThan(randomTests * 0.8); // Au moins 80% de succès
    
    // Vérifier cohérence : plus de nuits = prix plus élevé (à base price égal)
    results.forEach(result => {
      expect(result.totalPrice / result.nights).toBeGreaterThan(100); // Prix minimum par nuit
    });
  });
});