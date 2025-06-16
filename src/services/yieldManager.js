/**
 * Advanced Yield Manager Service - REDIS CACHE INTEGRATION
 * Dynamic pricing algorithms and revenue optimization with Redis caching
 * Implements real-time pricing based on demand, occupancy, and market conditions
 *
 * PHASE 2 INTEGRATION: Redis Cache + Original Yield Management
 */

const moment = require('moment');
const EventEmitter = require('events');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const PricingRule = require('../models/PricingRule');
const currencyService = require('./currencyService');
const demandAnalyzer = require('./demandAnalyzer');
const revenueAnalytics = require('./revenueAnalytics');
const cacheService = require('./cacheService'); // ✅ NEW: Redis cache integration
const { logger } = require('../utils/logger');
const {
  OCCUPANCY_THRESHOLDS,
  OCCUPANCY_PRICE_MULTIPLIERS,
  DAY_OF_WEEK_MULTIPLIERS,
  ADVANCE_BOOKING_MULTIPLIERS,
  DEMAND_LEVELS,
  DEMAND_PRICE_MULTIPLIERS,
  SEASONAL_MULTIPLIERS,
  YIELD_LIMITS,
  PRICING_RULE_TYPES,
  PRICING_ACTIONS,
} = require('../utils/constants');

class YieldManager extends EventEmitter {
  constructor() {
    super();

    // ============================================================================
    // ORIGINAL CONFIGURATION (PRESERVED)
    // ============================================================================
    this.pricingStrategies = {
      CONSERVATIVE: { multiplier: 0.8, volatility: 0.1, riskTolerance: 'low' },
      MODERATE: { multiplier: 1.0, volatility: 0.2, riskTolerance: 'medium' },
      AGGRESSIVE: { multiplier: 1.2, volatility: 0.3, riskTolerance: 'high' },
    };

    // Use constants from utils/constants.js
    this.seasonalFactors = SEASONAL_MULTIPLIERS;
    this.occupancyThresholds = this.convertOccupancyThresholds();
    this.leadTimeFactors = ADVANCE_BOOKING_MULTIPLIERS;
    this.dayOfWeekFactors = DAY_OF_WEEK_MULTIPLIERS;
    this.demandFactors = DEMAND_PRICE_MULTIPLIERS;

    // ============================================================================
    // MEMORY CACHE (PRESERVED FOR FALLBACK)
    // ============================================================================
    this.priceCache = new Map();
    this.demandCache = new Map();
    this.cacheExpiry = parseInt(process.env.YIELD_CACHE_TTL || '300000'); // 5 minutes

    // ============================================================================
    // NEW: REDIS CACHE INTEGRATION LAYER
    // ============================================================================
    this.redisCache = cacheService;
    this.cacheStrategy = {
      // Cache TTL strategy for yield calculations
      yieldPricing: {
        ttl: 30 * 60, // 30 minutes for yield pricing
        useRedis: true,
        useFallback: true,
      },
      occupancyData: {
        ttl: 10 * 60, // 10 minutes for occupancy calculations
        useRedis: true,
        useFallback: true,
      },
      demandAnalysis: {
        ttl: 15 * 60, // 15 minutes for demand analysis
        useRedis: true,
        useFallback: true,
      },
      hotelMetrics: {
        ttl: 60 * 60, // 1 hour for hotel performance metrics
        useRedis: true,
        useFallback: true,
      },
      pricingRules: {
        ttl: 6 * 60 * 60, // 6 hours for pricing rules (less frequent changes)
        useRedis: true,
        useFallback: true,
      },
    };

    // Cache performance metrics
    this.cacheMetrics = {
      redisHits: 0,
      redisMisses: 0,
      memoryHits: 0,
      memoryMisses: 0,
      redisErrors: 0,
      totalCalculations: 0,
      cacheBypass: 0,
      lastResetAt: new Date(),
    };

    // Initialization flag
    this.initialized = false;

    // Statistics (ENHANCED)
    this.stats = {
      priceCalculations: 0,
      cacheHits: 0,
      cacheMisses: 0,
      lastCalculation: null,
      averageCalculationTime: 0,
      redisCalculationTime: 0,
      memoryCalculationTime: 0,
    };

    logger.info('✅ Yield Manager constructed with Redis cache integration');
  }

  /**
   * ================================
   * INITIALIZATION (ENHANCED)
   * ================================
   */

  /**
   * Initialize the yield manager with Redis integration
   */
  async initialize() {
    if (this.initialized) {
      logger.warn('Yield Manager already initialized');
      return;
    }

    try {
      // Verify dependencies
      await this.verifyDependencies();

      // Initialize Redis cache integration
      await this.initializeRedisIntegration();

      // Load pricing rules from database with cache
      await this.loadPricingRulesWithCache();

      // Initialize demand analyzer
      if (demandAnalyzer.initialize) {
        await demandAnalyzer.initialize();
      }

      // Initialize revenue analytics
      if (revenueAnalytics.initialize) {
        await revenueAnalytics.initialize();
      }

      // Set up event listeners
      this.setupEventListeners();

      // Set up cache metrics logging
      this.setupCacheMetricsLogging();

      // Warm up cache with frequently accessed data
      await this.warmUpYieldCache();

      this.initialized = true;
      logger.info('✅ Yield Manager initialized successfully with Redis cache');
    } catch (error) {
      logger.error('❌ Failed to initialize Yield Manager:', error);
      throw error;
    }
  }

  /**
   * Initialize Redis cache integration
   */
  async initializeRedisIntegration() {
    try {
      // Test Redis connection
      if (!this.redisCache.redis) {
        throw new Error('Redis cache service not available');
      }

      // Verify Redis health
      await this.redisCache.redis.ping();

      logger.info('✅ Redis cache integration verified for Yield Manager');
    } catch (error) {
      logger.warn('⚠️ Redis not available, falling back to memory cache only:', error.message);
      // Continue with memory cache only
    }
  }

  /**
   * Setup cache metrics logging
   */
  setupCacheMetricsLogging() {
    setInterval(
      () => {
        this.logCacheMetrics();
      },
      5 * 60 * 1000
    ); // Log every 5 minutes
  }

  /**
   * ================================
   * HYBRID CACHE LAYER (Redis + Memory)
   * ================================
   */

  /**
   * Get data from hybrid cache (Redis first, then memory fallback)
   * @param {string} cacheKey - Cache key
   * @param {string} dataType - Type of data
   * @returns {Object|null} Cached data or null
   */
  async getFromHybridCache(cacheKey, dataType) {
    this.cacheMetrics.totalCalculations++;

    const strategy = this.cacheStrategy[dataType] || this.cacheStrategy.yieldPricing;

    // Try Redis first if enabled
    if (strategy.useRedis) {
      try {
        let redisData = null;

        // Use specific cache method based on data type
        switch (dataType) {
          case 'yieldPricing':
            const keyParts = this.parseYieldPricingKey(cacheKey);
            if (keyParts) {
              redisData = await this.redisCache.getYieldPricing(
                keyParts.hotelId,
                keyParts.roomType,
                keyParts.date
              );
            }
            break;

          case 'analytics':
            const analyticsParts = this.parseAnalyticsKey(cacheKey);
            if (analyticsParts) {
              redisData = await this.redisCache.getAnalytics(
                analyticsParts.type,
                analyticsParts.identifier
              );
            }
            break;

          default:
            // Generic cache retrieval
            redisData = await this.redisCache.getWithDecompression(cacheKey);
        }

        if (redisData) {
          this.cacheMetrics.redisHits++;
          logger.debug(`💰 Redis cache hit for yield: ${cacheKey}`);
          return redisData;
        }

        this.cacheMetrics.redisMisses++;
      } catch (error) {
        this.cacheMetrics.redisErrors++;
        logger.warn(`⚠️ Redis cache error for ${cacheKey}:`, error.message);
      }
    }

    // Fallback to memory cache if enabled
    if (strategy.useFallback) {
      const memoryData = this.getFromMemoryCache(cacheKey, dataType);
      if (memoryData) {
        this.cacheMetrics.memoryHits++;
        logger.debug(`💾 Memory cache hit for yield: ${cacheKey}`);
        return memoryData;
      }

      this.cacheMetrics.memoryMisses++;
    }

    return null;
  }

  /**
   * Set data in hybrid cache (Redis + Memory)
   * @param {string} cacheKey - Cache key
   * @param {Object} data - Data to cache
   * @param {string} dataType - Type of data
   * @param {number} customTTL - Custom TTL (optional)
   */
  async setInHybridCache(cacheKey, data, dataType, customTTL = null) {
    const strategy = this.cacheStrategy[dataType] || this.cacheStrategy.yieldPricing;
    const ttl = customTTL || strategy.ttl;

    // Store in Redis if enabled
    if (strategy.useRedis) {
      try {
        let success = false;

        // Use specific cache method based on data type
        switch (dataType) {
          case 'yieldPricing':
            const keyParts = this.parseYieldPricingKey(cacheKey);
            if (keyParts) {
              success = await this.redisCache.cacheYieldPricing(
                keyParts.hotelId,
                keyParts.roomType,
                keyParts.date,
                data,
                ttl
              );
            }
            break;

          case 'analytics':
            const analyticsParts = this.parseAnalyticsKey(cacheKey);
            if (analyticsParts) {
              success = await this.redisCache.cacheAnalytics(
                analyticsParts.type,
                analyticsParts.identifier,
                data,
                ttl
              );
            }
            break;

          default:
            // Generic cache storage
            success = await this.redisCache.setWithCompression(cacheKey, data, ttl);
        }

        if (success) {
          logger.debug(`💰 Stored in Redis cache: ${cacheKey}`);
        }
      } catch (error) {
        this.cacheMetrics.redisErrors++;
        logger.warn(`⚠️ Failed to store in Redis cache for ${cacheKey}:`, error.message);
      }
    }

    // Store in memory cache if enabled
    if (strategy.useFallback) {
      this.setInMemoryCache(cacheKey, data, dataType, ttl);
      logger.debug(`💾 Stored in memory cache: ${cacheKey}`);
    }
  }

  /**
   * ================================
   * MEMORY CACHE METHODS (Original, Enhanced)
   * ================================
   */

  /**
   * Get data from memory cache (original logic enhanced)
   */
  getFromMemoryCache(cacheKey, dataType) {
    let cached = null;

    switch (dataType) {
      case 'yieldPricing':
      case 'occupancyData':
      case 'hotelMetrics':
        cached = this.priceCache.get(cacheKey);
        break;

      case 'demandAnalysis':
        cached = this.demandCache.get(cacheKey);
        break;

      default:
        cached = this.priceCache.get(cacheKey);
    }

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    // Clean expired entries
    if (cached) {
      this.priceCache.delete(cacheKey);
      this.demandCache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Set data in memory cache (original logic enhanced)
   */
  setInMemoryCache(cacheKey, data, dataType, ttl) {
    const cacheData = {
      data,
      timestamp: Date.now(),
      ttl: ttl * 1000, // Convert to milliseconds
      dataType,
    };

    switch (dataType) {
      case 'yieldPricing':
      case 'occupancyData':
      case 'hotelMetrics':
        this.priceCache.set(cacheKey, cacheData);
        break;

      case 'demandAnalysis':
        this.demandCache.set(cacheKey, cacheData);
        break;

      default:
        this.priceCache.set(cacheKey, cacheData);
    }
  }

  /**
   * ================================
   * CACHE KEY UTILITIES
   * ================================
   */

  /**
   * Build cache key for yield pricing
   */
  buildYieldPricingKey(hotelId, roomType, date, strategy = 'MODERATE') {
    const dateStr = moment(date).format('YYYY-MM-DD');
    return `yield_${hotelId}_${roomType}_${dateStr}_${strategy}`;
  }

  /**
   * Build cache key for occupancy data
   */
  buildOccupancyKey(hotelId, date) {
    const dateStr = moment(date).format('YYYY-MM-DD');
    return `occupancy_${hotelId}_${dateStr}`;
  }

  /**
   * Build cache key for demand analysis
   */
  buildDemandKey(hotelId, roomType, date) {
    const dateStr = moment(date).format('YYYY-MM-DD');
    return `demand_${hotelId}_${roomType}_${dateStr}`;
  }

  /**
   * Build cache key for hotel metrics
   */
  buildHotelMetricsKey(hotelId, metricType = 'performance') {
    return `hotel_metrics_${hotelId}_${metricType}`;
  }

  /**
   * Parse yield pricing key
   */
  parseYieldPricingKey(key) {
    const parts = key.split('_');
    if (parts.length >= 4 && parts[0] === 'yield') {
      return {
        hotelId: parts[1],
        roomType: parts[2],
        date: new Date(parts[3]),
      };
    }
    return null;
  }

  /**
   * Parse analytics key
   */
  parseAnalyticsKey(key) {
    const parts = key.split('_');
    if (parts.length >= 3) {
      return {
        type: parts[1],
        identifier: parts.slice(2).join('_'),
      };
    }
    return null;
  }

  /**
   * ================================
   * ENHANCED YIELD CALCULATION WITH REDIS
   * ================================
   */

  /**
   * Calculate dynamic price with Redis caching (ENHANCED)
   * @param {Object} params - Pricing parameters
   * @returns {Object} Calculated price with breakdown
   */
  async calculateDynamicPrice(params) {
    if (!this.initialized) {
      throw new Error('Yield Manager not initialized. Call initialize() first.');
    }

    const startTime = Date.now();

    const {
      hotelId,
      roomType,
      checkInDate,
      checkOutDate,
      guestCount = 1,
      baseCurrency = 'EUR',
      strategy = 'MODERATE',
    } = params;

    try {
      this.stats.priceCalculations++;

      // Generate cache key for Redis
      const cacheKey = this.buildYieldPricingKey(hotelId, roomType, checkInDate, strategy);

      // Try hybrid cache first
      const cached = await this.getFromHybridCache(cacheKey, 'yieldPricing');

      if (cached && this.validateCachedYieldData(cached, params)) {
        this.stats.cacheHits++;
        logger.debug(`💰 Yield pricing cache hit: ${hotelId}-${roomType}`);

        // Add cache info to response
        const result = {
          ...cached,
          fromCache: true,
          cacheSource: cached.fromCache ? 'redis' : 'memory',
          calculationTime: Date.now() - startTime,
        };

        return result;
      }

      this.stats.cacheMisses++;

      // Calculate fresh yield pricing
      logger.debug(`🔄 Calculating fresh yield pricing: ${hotelId}-${roomType}`);
      const result = await this.calculateFreshDynamicPrice(params);

      // Add timing information
      const executionTime = Date.now() - startTime;
      result.calculationTime = executionTime;
      result.fromCache = false;
      result.cacheSource = 'calculated';

      // Cache the result in hybrid cache
      await this.setInHybridCache(cacheKey, result, 'yieldPricing');

      // Update statistics
      this.updateCalculationStats(executionTime);

      // Emit pricing event for monitoring
      this.emit('price:calculated', {
        hotelId,
        roomType,
        basePrice: result.basePrice,
        dynamicPrice: result.dynamicPrice,
        factor: result.factors?.totalFactor,
        executionTime,
        cached: false,
      });

      return result;
    } catch (error) {
      logger.error('❌ Error calculating dynamic price:', error);

      // Emit error event
      this.emit('price:calculation_failed', {
        hotelId,
        roomType,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Calculate fresh dynamic price (original logic preserved)
   */
  async calculateFreshDynamicPrice(params) {
    const {
      hotelId,
      roomType,
      checkInDate,
      checkOutDate,
      guestCount = 1,
      baseCurrency = 'EUR',
      strategy = 'MODERATE',
    } = params;

    // Get base price from hotel/room configuration with cache
    const basePrice = await this.getBasePriceWithCache(hotelId, roomType);
    if (!basePrice) {
      throw new Error(`Base price not found for ${roomType} in hotel ${hotelId}`);
    }

    // Calculate all pricing factors with cache
    const factors = await this.calculatePricingFactorsWithCache({
      hotelId,
      roomType,
      checkInDate,
      checkOutDate,
      guestCount,
      strategy,
    });

    // Apply pricing rules if any (with cache)
    const rulesAdjustment = await this.applyPricingRulesWithCache({
      hotelId,
      roomType,
      checkInDate,
      factors,
    });

    // Apply all factors to base price
    const dynamicPrice = this.applyPricingFactors(basePrice, factors, rulesAdjustment);

    // Calculate price for entire stay
    const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');
    const totalPrice = dynamicPrice * nights;

    // Convert currency if needed
    const convertedPrice =
      baseCurrency !== 'EUR'
        ? await currencyService.convertCurrency(totalPrice, 'EUR', baseCurrency)
        : totalPrice;

    return {
      basePrice,
      dynamicPrice,
      totalPrice,
      convertedPrice,
      nights,
      currency: baseCurrency,
      factors,
      rulesApplied: rulesAdjustment,
      strategy,
      calculatedAt: new Date(),
      breakdown: {
        baseTotal: basePrice * nights,
        adjustments: (dynamicPrice - basePrice) * nights,
        savings: basePrice > dynamicPrice ? (basePrice - dynamicPrice) * nights : 0,
        markup: dynamicPrice > basePrice ? (dynamicPrice - basePrice) * nights : 0,
        currencyConversion: baseCurrency !== 'EUR' ? convertedPrice - totalPrice : 0,
      },
      recommendations: this.generatePricingRecommendations(factors, strategy),
      confidence: this.calculateConfidenceScore(factors),
      cacheInfo: {
        calculatedAt: new Date(),
        willBeCached: true,
        ttl: this.cacheStrategy.yieldPricing.ttl,
      },
    };
  }

  /**
   * Calculate pricing factors with Redis caching
   */
  async calculatePricingFactorsWithCache(params) {
    const { hotelId, roomType, checkInDate, checkOutDate, strategy } = params;

    // 1. Occupancy-based factor (with cache)
    const occupancyFactor = await this.calculateOccupancyFactorWithCache(
      hotelId,
      checkInDate,
      checkOutDate
    );

    // 2. Seasonal factor (cached implicitly through hotel data)
    const seasonalFactor = await this.calculateSeasonalFactorWithCache(
      checkInDate,
      checkOutDate,
      hotelId
    );

    // 3. Lead time factor (lightweight, no cache needed)
    const leadTimeFactor = this.calculateLeadTimeFactor(checkInDate);

    // 4. Day of week factor (lightweight, no cache needed)
    const dayOfWeekFactor = this.calculateDayOfWeekFactor(checkInDate, checkOutDate);

    // 5. Demand trend factor (with cache)
    const demandFactor = await this.calculateDemandFactorWithCache(hotelId, roomType, checkInDate);

    // 6. Competition factor (with cache)
    const competitionFactor = await this.calculateCompetitionFactorWithCache(hotelId, checkInDate);

    // 7. Strategy multiplier
    const strategyFactor = this.pricingStrategies[strategy].multiplier;

    // 8. Length of stay factor
    const lengthOfStayFactor = this.calculateLengthOfStayFactor(checkInDate, checkOutDate);

    // Calculate weighted total factor
    const totalFactor = this.calculateWeightedFactor({
      occupancyFactor,
      seasonalFactor,
      leadTimeFactor,
      dayOfWeekFactor,
      demandFactor,
      competitionFactor,
      strategyFactor,
      lengthOfStayFactor,
    });

    return {
      occupancyFactor,
      seasonalFactor,
      leadTimeFactor,
      dayOfWeekFactor,
      demandFactor,
      competitionFactor,
      strategyFactor,
      lengthOfStayFactor,
      totalFactor,
      weights: this.getFactorWeights(strategy),
      cacheInfo: {
        occupancyCached: occupancyFactor.fromCache || false,
        demandCached: demandFactor.fromCache || false,
        competitionCached: competitionFactor.fromCache || false,
      },
    };
  }

  /**
   * Calculate occupancy factor with Redis caching
   */
  async calculateOccupancyFactorWithCache(hotelId, checkInDate, checkOutDate) {
    const cacheKey = this.buildOccupancyKey(hotelId, checkInDate);

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'occupancyData');
    if (cached && this.validateOccupancyData(cached, checkInDate)) {
      return { ...cached, fromCache: true };
    }

    // Calculate fresh occupancy
    const occupancyData = await this.calculateOccupancyFactor(hotelId, checkInDate, checkOutDate);

    // Cache the result
    await this.setInHybridCache(cacheKey, occupancyData, 'occupancyData');

    return { ...occupancyData, fromCache: false };
  }

  /**
   * Calculate seasonal factor with hotel data cache
   */
  async calculateSeasonalFactorWithCache(checkInDate, checkOutDate, hotelId) {
    // Try to get hotel data from cache
    let hotel = await this.redisCache.getHotelData(hotelId, 'seasonal');

    if (!hotel) {
      // Get hotel from database and cache seasonal data
      hotel = await Hotel.findById(hotelId).select('seasonalPricing yieldManagement');
      if (hotel) {
        await this.redisCache.cacheHotelData(hotelId, hotel, 'seasonal', 6 * 60 * 60); // 6 hours
      }
    }

    // Use hotel-specific seasonal data or fall back to default
    if (hotel && hotel.yieldManagement?.enabled) {
      return this.calculateSeasonalFactorFromHotel(checkInDate, checkOutDate, hotel);
    }

    // Default seasonal calculation
    return this.calculateSeasonalFactor(checkInDate, checkOutDate, hotelId);
  }

  /**
   * Calculate demand factor with Redis caching
   */
  async calculateDemandFactorWithCache(hotelId, roomType, checkInDate) {
    const cacheKey = this.buildDemandKey(hotelId, roomType, checkInDate);

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'demandAnalysis');
    if (cached && this.validateDemandData(cached, checkInDate)) {
      return { ...cached, fromCache: true };
    }

    // Calculate fresh demand
    const demandData = await this.calculateDemandFactor(hotelId, roomType, checkInDate);

    // Cache the result
    await this.setInHybridCache(cacheKey, demandData, 'demandAnalysis');

    return { ...demandData, fromCache: false };
  }

  /**
   * Calculate competition factor with caching
   */
  async calculateCompetitionFactorWithCache(hotelId, checkInDate) {
    const cacheKey = `competition_${hotelId}_${moment(checkInDate).format('YYYY-MM-DD')}`;

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'analytics');
    if (cached && this.validateCompetitionData(cached, checkInDate)) {
      return { ...cached, fromCache: true };
    }

    // Calculate fresh competition data
    const competitionData = await this.calculateCompetitionFactor(hotelId, checkInDate);

    // Cache with shorter TTL (competition data changes frequently)
    await this.setInHybridCache(cacheKey, competitionData, 'analytics', 60 * 60); // 1 hour

    return { ...competitionData, fromCache: false };
  }

  /**
   * Get base price with Redis caching
   */
  async getBasePriceWithCache(hotelId, roomType) {
    const cacheKey = `base_price_${hotelId}_${roomType}`;

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'hotelMetrics');
    if (cached && cached.basePrice) {
      return cached.basePrice;
    }

    // Get from database
    const basePrice = await this.getBasePrice(hotelId, roomType);

    // Cache the result with longer TTL (base prices change less frequently)
    if (basePrice) {
      await this.setInHybridCache(
        cacheKey,
        { basePrice, cachedAt: new Date() },
        'hotelMetrics',
        12 * 60 * 60
      ); // 12 hours
    }

    return basePrice;
  }

  /**
   * Apply pricing rules with Redis caching
   */
  async applyPricingRulesWithCache(params) {
    const { hotelId, roomType, checkInDate, factors } = params;
    const cacheKey = `pricing_rules_${hotelId}_${roomType}_${moment(checkInDate).format('YYYY-MM-DD')}`;

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'pricingRules');
    if (cached && this.validatePricingRulesData(cached, checkInDate)) {
      return { ...cached, fromCache: true };
    }

    // Calculate fresh pricing rules
    const rulesData = await this.applyPricingRules(params);

    // Cache the result
    await this.setInHybridCache(cacheKey, rulesData, 'pricingRules');

    return { ...rulesData, fromCache: false };
  }

  /**
   * ================================
   * CACHE INVALIDATION WITH REDIS
   * ================================
   */

  /**
   * Invalidate yield cache for a hotel
   */
  async invalidateHotelYieldCache(hotelId) {
    try {
      const results = await Promise.allSettled([
        // Invalidate Redis yield pricing cache
        this.redisCache.invalidateYieldPricing(hotelId),

        // Invalidate Redis hotel data cache
        this.redisCache.invalidateHotelData(hotelId),

        // Invalidate Redis analytics cache
        this.redisCache.invalidateAnalytics('hotel', hotelId),

        // Clear memory caches
        this.clearMemoryCacheForHotel(hotelId),
      ]);

      const totalDeleted = results
        .filter((result) => result.status === 'fulfilled')
        .reduce((sum, result) => sum + (result.value || 0), 0);

      logger.info(`🗑️ Invalidated yield cache for hotel ${hotelId}: ${totalDeleted} entries`);

      // Emit cache invalidation event
      this.emit('cache:invalidated', {
        hotelId,
        type: 'hotel_yield',
        entriesDeleted: totalDeleted,
        timestamp: new Date(),
      });

      return totalDeleted;
    } catch (error) {
      logger.error('❌ Error invalidating hotel yield cache:', error);
      return 0;
    }
  }

  /**
   * Invalidate pricing cache when room rates change
   */
  async invalidateRoomPricingCache(hotelId, roomType) {
    try {
      let deletedCount = 0;

      // Invalidate Redis yield pricing for specific room type
      deletedCount += await this.redisCache.invalidateYieldPricing(hotelId, roomType);

      // Clear memory cache entries
      const memoryKeysToDelete = [];

      // Clear memory cache entries for this room type
      for (const key of this.priceCache.keys()) {
        if (key.includes(hotelId) && key.includes(roomType)) {
          memoryKeysToDelete.push(key);
        }
      }

      for (const key of this.demandCache.keys()) {
        if (key.includes(hotelId) && key.includes(roomType)) {
          memoryKeysToDelete.push(key);
        }
      }

      memoryKeysToDelete.forEach((key) => {
        this.priceCache.delete(key);
        this.demandCache.delete(key);
      });

      deletedCount += memoryKeysToDelete.length;

      logger.info(
        `🗑️ Invalidated room pricing cache: ${hotelId}-${roomType} (${deletedCount} entries)`
      );

      // Emit cache invalidation event
      this.emit('cache:invalidated', {
        hotelId,
        roomType,
        type: 'room_pricing',
        entriesDeleted: deletedCount,
        timestamp: new Date(),
      });

      return deletedCount;
    } catch (error) {
      logger.error('❌ Error invalidating room pricing cache:', error);
      return 0;
    }
  }

  /**
   * Clear memory cache for a specific hotel
   */
  clearMemoryCacheForHotel(hotelId) {
    const keysToDelete = [];

    // Collect keys to delete from price cache
    for (const key of this.priceCache.keys()) {
      if (key.includes(hotelId)) {
        keysToDelete.push({ cache: this.priceCache, key });
      }
    }

    // Collect keys to delete from demand cache
    for (const key of this.demandCache.keys()) {
      if (key.includes(hotelId)) {
        keysToDelete.push({ cache: this.demandCache, key });
      }
    }

    // Delete collected keys
    keysToDelete.forEach(({ cache, key }) => cache.delete(key));

    logger.debug(`🗑️ Cleared ${keysToDelete.length} memory cache entries for hotel ${hotelId}`);

    return keysToDelete.length;
  }

  /**
   * ================================
   * REDIS CACHE WARMING
   * ================================
   */

  /**
   * Warm up yield cache with frequently accessed data
   */
  async warmUpYieldCache() {
    try {
      logger.info('🔥 Starting yield cache warm-up...');

      // Get active hotels with yield management enabled
      const activeHotels = await Hotel.find({
        isActive: true,
        'yieldManagement.enabled': true,
      })
        .select('_id name yieldManagement')
        .limit(10);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const nextWeek = new Date(tomorrow);
      nextWeek.setDate(nextWeek.getDate() + 7);

      let warmedUp = 0;
      const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];

      for (const hotel of activeHotels) {
        try {
          // Warm up pricing for each room type for the next week
          for (const roomType of roomTypes) {
            if (hotel.yieldManagement.basePricing[roomType]) {
              await this.calculateDynamicPrice({
                hotelId: hotel._id.toString(),
                roomType,
                checkInDate: tomorrow,
                checkOutDate: nextWeek,
                strategy: hotel.yieldManagement.strategy || 'MODERATE',
              });

              warmedUp++;
            }
          }

          // Cache hotel metrics
          const metrics = await this.getHotelPerformanceMetrics(hotel._id.toString());
          const metricsKey = this.buildHotelMetricsKey(hotel._id.toString());
          await this.setInHybridCache(metricsKey, metrics, 'hotelMetrics');
        } catch (error) {
          logger.warn(`⚠️ Failed to warm up cache for hotel ${hotel._id}:`, error.message);
        }
      }

      logger.info(`🔥 Yield cache warm-up completed: ${warmedUp} pricing calculations cached`);
    } catch (error) {
      logger.error('❌ Error during yield cache warm-up:', error);
    }
  }

  /**
   * ================================
   * CACHE VALIDATION METHODS
   * ================================
   */

  /**
   * Validate cached yield data
   */
  validateCachedYieldData(cached, params) {
    if (!cached || !cached.calculatedAt) return false;

    // Check if cache is not too old (beyond TTL)
    const age = Date.now() - new Date(cached.calculatedAt).getTime();
    const maxAge = this.cacheStrategy.yieldPricing.ttl * 1000;

    if (age > maxAge) return false;

    // Validate data structure
    return (
      cached.basePrice &&
      cached.dynamicPrice &&
      cached.factors &&
      typeof cached.factors === 'object'
    );
  }

  /**
   * Validate cached occupancy data
   */
  validateOccupancyData(cached, checkInDate) {
    if (!cached || !cached.factor) return false;

    // Check if data is for the correct date
    const cacheDate = new Date(cached.calculatedFor || cached.date);
    const targetDate = new Date(checkInDate);

    return cacheDate.toDateString() === targetDate.toDateString();
  }

  /**
   * Validate cached demand data
   */
  validateDemandData(cached, checkInDate) {
    if (!cached || !cached.factor) return false;

    // Check date and data freshness
    const age = Date.now() - new Date(cached.calculatedAt || cached.timestamp).getTime();
    const maxAge = this.cacheStrategy.demandAnalysis.ttl * 1000;

    return age <= maxAge;
  }

  /**
   * Validate cached competition data
   */
  validateCompetitionData(cached, checkInDate) {
    if (!cached || !cached.factor) return false;

    // Competition data should be relatively fresh
    const age = Date.now() - new Date(cached.calculatedAt || cached.timestamp).getTime();
    const maxAge = 60 * 60 * 1000; // 1 hour max

    return age <= maxAge;
  }

  /**
   * Validate pricing rules data
   */
  validatePricingRulesData(cached, checkInDate) {
    if (!cached || cached.factor === undefined) return false;

    // Pricing rules can be cached longer
    const age = Date.now() - new Date(cached.calculatedAt || cached.timestamp).getTime();
    const maxAge = this.cacheStrategy.pricingRules.ttl * 1000;

    return age <= maxAge;
  }

  /**
   * ================================
   * CACHE MONITORING & METRICS
   * ================================
   */

  /**
   * Get comprehensive cache performance metrics
   */
  getCacheMetrics() {
    const totalRequests =
      this.cacheMetrics.redisHits +
      this.cacheMetrics.redisMisses +
      this.cacheMetrics.memoryHits +
      this.cacheMetrics.memoryMisses;

    const redisHitRate =
      totalRequests > 0 ? Math.round((this.cacheMetrics.redisHits / totalRequests) * 100) : 0;

    const memoryHitRate =
      totalRequests > 0 ? Math.round((this.cacheMetrics.memoryHits / totalRequests) * 100) : 0;

    const overallHitRate =
      totalRequests > 0
        ? Math.round(
            ((this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits) / totalRequests) * 100
          )
        : 0;

    return {
      redis: {
        hits: this.cacheMetrics.redisHits,
        misses: this.cacheMetrics.redisMisses,
        errors: this.cacheMetrics.redisErrors,
        hitRate: redisHitRate,
      },
      memory: {
        hits: this.cacheMetrics.memoryHits,
        misses: this.cacheMetrics.memoryMisses,
        hitRate: memoryHitRate,
        cacheSize: {
          pricing: this.priceCache.size,
          demand: this.demandCache.size,
        },
      },
      overall: {
        totalRequests: this.cacheMetrics.totalCalculations,
        hitRate: overallHitRate,
        errorRate:
          totalRequests > 0 ? Math.round((this.cacheMetrics.redisErrors / totalRequests) * 100) : 0,
        bypassRate:
          totalRequests > 0 ? Math.round((this.cacheMetrics.cacheBypass / totalRequests) * 100) : 0,
      },
      performance: {
        averageCalculationTime: this.stats.averageCalculationTime,
        totalCalculations: this.stats.priceCalculations,
        cacheImpact: this.calculateCacheImpact(),
      },
      lastResetAt: this.cacheMetrics.lastResetAt,
    };
  }

  /**
   * Calculate cache performance impact
   */
  calculateCacheImpact() {
    const totalRequests =
      this.cacheMetrics.redisHits +
      this.cacheMetrics.redisMisses +
      this.cacheMetrics.memoryHits +
      this.cacheMetrics.memoryMisses;

    if (totalRequests === 0) return { timeSaved: 0, efficiency: 0 };

    // Estimate time savings (cached requests are much faster)
    const avgCacheTime = 5; // ms
    const avgCalculationTime = this.stats.averageCalculationTime || 100; // ms
    const cacheHits = this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits;

    const timeSaved = cacheHits * (avgCalculationTime - avgCacheTime);
    const efficiency = totalRequests > 0 ? (cacheHits / totalRequests) * 100 : 0;

    return {
      timeSaved: Math.round(timeSaved),
      efficiency: Math.round(efficiency),
      cacheHits,
      totalRequests,
    };
  }

  /**
   * Log cache performance metrics
   */
  logCacheMetrics() {
    const metrics = this.getCacheMetrics();

    logger.info(
      `💰 Yield Cache Metrics - Overall Hit Rate: ${metrics.overall.hitRate}%, ` +
        `Redis: ${metrics.redis.hitRate}%, Memory: ${metrics.memory.hitRate}%, ` +
        `Errors: ${metrics.redis.errors}, Calculations: ${metrics.performance.totalCalculations}`
    );

    // Log cache impact
    const impact = metrics.performance.cacheImpact;
    if (impact.timeSaved > 0) {
      logger.info(
        `💰 Cache Impact - Time Saved: ${impact.timeSaved}ms, ` +
          `Efficiency: ${impact.efficiency}%, Hits: ${impact.cacheHits}/${impact.totalRequests}`
      );
    }
  }

  /**
   * Reset cache metrics
   */
  resetCacheMetrics() {
    this.cacheMetrics = {
      redisHits: 0,
      redisMisses: 0,
      memoryHits: 0,
      memoryMisses: 0,
      redisErrors: 0,
      totalCalculations: 0,
      cacheBypass: 0,
      lastResetAt: new Date(),
    };

    logger.info('💰 Yield cache metrics reset');
  }

  /**
   * Update calculation statistics
   */
  updateCalculationStats(executionTime) {
    this.stats.lastCalculation = new Date();
    this.stats.averageCalculationTime =
      (this.stats.averageCalculationTime * (this.stats.priceCalculations - 1) + executionTime) /
      this.stats.priceCalculations;
  }

  /**
   * ================================
   * ENHANCED CACHE-AWARE METHODS
   * ================================
   */

  /**
   * Load pricing rules with Redis caching
   */
  async loadPricingRulesWithCache() {
    try {
      const cacheKey = 'pricing_rules_all';

      // Try Redis cache first
      let rules = await this.redisCache.getAnalytics('pricing', 'rules');

      if (!rules) {
        // Load from database
        rules = await PricingRule.find({ isActive: true });

        // Cache the rules
        await this.redisCache.cacheAnalytics('pricing', 'rules', rules, 6 * 60 * 60); // 6 hours

        logger.info(`💾 Loaded and cached ${rules.length} active pricing rules`);
      } else {
        logger.info(`🎯 Loaded ${rules.length} pricing rules from cache`);
      }

      this.pricingRules = rules;
    } catch (error) {
      logger.error('❌ Error loading pricing rules with cache:', error);
      this.pricingRules = [];
    }
  }

  /**
   * Get hotel performance metrics with caching
   */
  async getHotelPerformanceMetrics(hotelId) {
    const cacheKey = this.buildHotelMetricsKey(hotelId, 'performance');

    // Try cache first
    const cached = await this.getFromHybridCache(cacheKey, 'hotelMetrics');
    if (cached && this.validateHotelMetrics(cached)) {
      return cached;
    }

    // Calculate fresh metrics
    const metrics = await this.calculateHotelPerformanceMetrics(hotelId);

    // Cache the result
    await this.setInHybridCache(cacheKey, metrics, 'hotelMetrics');

    return metrics;
  }

  /**
   * Calculate hotel performance metrics (original logic preserved)
   */
  async calculateHotelPerformanceMetrics(hotelId) {
    try {
      const hotel = await Hotel.findById(hotelId);
      if (!hotel) return null;

      // Calculate basic metrics
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const bookings = await Booking.find({
        hotel: hotelId,
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
        checkIn: { $gte: thirtyDaysAgo },
      });

      const totalRevenue = bookings.reduce((sum, booking) => sum + booking.pricing.totalPrice, 0);
      const averageBookingValue = bookings.length > 0 ? totalRevenue / bookings.length : 0;

      // Calculate occupancy rate
      const totalRooms = hotel.stats.totalRooms || 0;
      const totalRoomNights = totalRooms * 30;
      const occupiedRoomNights = bookings.reduce((sum, booking) => {
        const nights = Math.ceil((booking.checkOut - booking.checkIn) / (1000 * 60 * 60 * 24));
        return sum + booking.rooms.length * nights;
      }, 0);

      const occupancyRate = totalRoomNights > 0 ? (occupiedRoomNights / totalRoomNights) * 100 : 0;

      return {
        hotelId,
        period: { days: 30, from: thirtyDaysAgo, to: new Date() },
        revenue: {
          total: totalRevenue,
          average: averageBookingValue,
          daily: totalRevenue / 30,
        },
        occupancy: {
          rate: occupancyRate,
          totalRooms,
          totalRoomNights,
          occupiedRoomNights,
        },
        bookings: {
          count: bookings.length,
          averageValue: averageBookingValue,
        },
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('❌ Error calculating hotel performance metrics:', error);
      return null;
    }
  }

  /**
   * Validate hotel metrics data
   */
  validateHotelMetrics(cached) {
    if (!cached || !cached.calculatedAt) return false;

    // Hotel metrics can be cached for 1 hour
    const age = Date.now() - new Date(cached.calculatedAt).getTime();
    const maxAge = 60 * 60 * 1000; // 1 hour

    return age <= maxAge && cached.revenue && cached.occupancy;
  }

  /**
   * ================================
   * ENHANCED EVENT HANDLING
   * ================================
   */

  /**
   * Setup event listeners (enhanced with cache invalidation)
   */
  setupEventListeners() {
    // Listen for booking events to trigger cache invalidation
    this.on('booking:created', async (data) => {
      await this.invalidateHotelYieldCache(data.hotelId);
      await this.triggerDemandAnalysis(data.hotelId);
    });

    this.on('booking:confirmed', async (data) => {
      await this.invalidateHotelYieldCache(data.hotelId);
      await this.updatePricingForHotel(data.hotelId);
    });

    this.on('booking:cancelled', async (data) => {
      await this.invalidateHotelYieldCache(data.hotelId);
    });

    // Clear cache when pricing rules are updated
    this.on('pricing:rules_updated', async () => {
      await this.invalidateAllPricingRulesCache();
      await this.loadPricingRulesWithCache();
    });

    // Clear cache when hotel configuration changes
    this.on('hotel:configuration_updated', async (data) => {
      await this.invalidateHotelYieldCache(data.hotelId);
    });

    // Clear cache when room prices are updated
    this.on('room:price_updated', async (data) => {
      await this.invalidateRoomPricingCache(data.hotelId, data.roomType);
    });
  }

  /**
   * Invalidate all pricing rules cache
   */
  async invalidateAllPricingRulesCache() {
    try {
      await this.redisCache.invalidateAnalytics('pricing', 'rules');

      // Clear memory cache entries
      const keysToDelete = [];
      for (const key of this.priceCache.keys()) {
        if (key.includes('pricing_rules')) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach((key) => this.priceCache.delete(key));

      logger.info('🗑️ Invalidated all pricing rules cache');
    } catch (error) {
      logger.error('❌ Error invalidating pricing rules cache:', error);
    }
  }

  /**
   * ================================
   * ENHANCED DASHBOARD DATA WITH CACHE
   * ================================
   */

  /**
   * Get dashboard data with Redis caching
   */
  async getDashboardData() {
    try {
      const cacheKey = 'yield_dashboard_data';

      // Try cache first (shorter TTL for dashboard)
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateDashboardData(cached)) {
        return { ...cached, fromCache: true };
      }

      // Calculate fresh dashboard data
      const dashboardData = {
        timestamp: new Date(),
        statistics: this.getSystemStatsWithCache(),
        cacheMetrics: this.getCacheMetrics(),
        recentPriceChanges: await this.getRecentPriceChanges(),
        occupancyTrends: await this.getOccupancyTrends(),
        revenueForecast: await this.getRevenueForecast(),
        recommendations: await this.getSystemRecommendations(),
        fromCache: false,
      };

      // Cache with short TTL (5 minutes for dashboard)
      await this.setInHybridCache(cacheKey, dashboardData, 'analytics', 5 * 60);

      return dashboardData;
    } catch (error) {
      logger.error('❌ Error getting dashboard data:', error);
      throw error;
    }
  }

  /**
   * Validate dashboard data cache
   */
  validateDashboardData(cached) {
    if (!cached || !cached.timestamp) return false;

    // Dashboard data should be fresh (5 minutes max)
    const age = Date.now() - new Date(cached.timestamp).getTime();
    const maxAge = 5 * 60 * 1000; // 5 minutes

    return age <= maxAge;
  }

  /**
   * Get system statistics with cache information
   */
  getSystemStatsWithCache() {
    const baseStats = this.getSystemStats(); // Original method
    const cacheMetrics = this.getCacheMetrics();

    return {
      ...baseStats,
      cache: {
        enabled: true,
        redisConnected: this.redisCache.redis ? true : false,
        metrics: cacheMetrics,
        strategies: Object.keys(this.cacheStrategy),
      },
    };
  }

  /**
   * ================================
   * CACHE HEALTH & MAINTENANCE
   * ================================
   */

  /**
   * Perform cache health check
   */
  async performCacheHealthCheck() {
    const healthCheck = {
      timestamp: new Date(),
      redis: { status: 'unknown', latency: null, error: null },
      memory: { status: 'ok', size: this.getMemoryCacheSize() },
      overall: { status: 'unknown' },
    };

    try {
      // Test Redis connection and latency
      const startTime = Date.now();
      await this.redisCache.redis.ping();
      healthCheck.redis = {
        status: 'ok',
        latency: Date.now() - startTime,
        error: null,
      };
    } catch (error) {
      healthCheck.redis = {
        status: 'error',
        latency: null,
        error: error.message,
      };
    }

    // Determine overall health
    healthCheck.overall.status = healthCheck.redis.status === 'ok' ? 'healthy' : 'degraded';

    return healthCheck;
  }

  /**
   * Get memory cache size info
   */
  getMemoryCacheSize() {
    return {
      pricing: this.priceCache.size,
      demand: this.demandCache.size,
      total: this.priceCache.size + this.demandCache.size,
    };
  }

  /**
   * Cleanup and maintenance with Redis
   */
  async performMaintenance() {
    try {
      logger.info('🔧 Starting yield manager maintenance...');

      // Clean expired memory cache
      this.cleanExpiredMemoryCache();

      // Clean up Redis cache (old entries)
      await this.cleanupRedisCache();

      // Log current metrics
      this.logCacheMetrics();

      // Perform health check
      const health = await this.performCacheHealthCheck();
      logger.info(`🔧 Maintenance completed. Cache health: ${health.overall.status}`);

      return health;
    } catch (error) {
      logger.error('❌ Error during maintenance:', error);
      return { status: 'error', error: error.message };
    }
  }

  /**
   * Clean expired memory cache entries
   */
  cleanExpiredMemoryCache() {
    const now = Date.now();
    let expiredCount = 0;

    // Clean price cache
    for (const [key, data] of this.priceCache.entries()) {
      if (now - data.timestamp > data.ttl) {
        this.priceCache.delete(key);
        expiredCount++;
      }
    }

    // Clean demand cache
    for (const [key, data] of this.demandCache.entries()) {
      if (now - data.timestamp > data.ttl) {
        this.demandCache.delete(key);
        expiredCount++;
      }
    }

    if (expiredCount > 0) {
      logger.debug(`🗑️ Cleaned ${expiredCount} expired memory cache entries`);
    }
  }

  /**
   * Cleanup old Redis cache entries with intelligent index management
   */
  async cleanupRedisCache() {
    try {
      let cleanedEntries = 0;

      // Clean up expired yield pricing indexes
      const yieldIndexPattern = `${this.redisCache.prefixes.yield}index:*`;
      const yieldIndexKeys = await this.redisCache.redis.keys(yieldIndexPattern);

      for (const indexKey of yieldIndexKeys) {
        const members = await this.redisCache.redis.sMembers(indexKey);
        const expiredMembers = [];

        for (const member of members) {
          const exists = await this.redisCache.redis.exists(member);
          if (!exists) {
            expiredMembers.push(member);
          }
        }

        if (expiredMembers.length > 0) {
          await this.redisCache.redis.sRem(indexKey, ...expiredMembers);
          cleanedEntries += expiredMembers.length;
        }
      }

      // Clean up expired analytics indexes
      const analyticsIndexPattern = `${this.redisCache.prefixes.analytics}index:*`;
      const analyticsIndexKeys = await this.redisCache.redis.keys(analyticsIndexPattern);

      for (const indexKey of analyticsIndexKeys) {
        const members = await this.redisCache.redis.sMembers(indexKey);
        const expiredMembers = [];

        for (const member of members) {
          const exists = await this.redisCache.redis.exists(member);
          if (!exists) {
            expiredMembers.push(member);
          }
        }

        if (expiredMembers.length > 0) {
          await this.redisCache.redis.sRem(indexKey, ...expiredMembers);
          cleanedEntries += expiredMembers.length;
        }
      }

      // Clean up old pricing history keys (older than 90 days)
      const ninetyDaysAgo = moment().subtract(90, 'days').format('YYYY-MM-DD');
      const oldPricingPattern = `${this.redisCache.prefixes.yield}*_????-??-??_*`;
      const oldPricingKeys = await this.redisCache.redis.keys(oldPricingPattern);

      const keysToDelete = oldPricingKeys.filter((key) => {
        const dateMatch = key.match(/(\d{4}-\d{2}-\d{2})/);
        if (dateMatch) {
          return dateMatch[1] < ninetyDaysAgo;
        }
        return false;
      });

      if (keysToDelete.length > 0) {
        await this.redisCache.redis.del(...keysToDelete);
        cleanedEntries += keysToDelete.length;
      }

      // Clean up orphaned hotel metric keys
      const hotelMetricPattern = `hotel_metrics_*`;
      const hotelMetricKeys = await this.redisCache.redis.keys(hotelMetricPattern);

      for (const metricKey of hotelMetricKeys) {
        const hotelId = metricKey.split('_')[2];
        if (hotelId) {
          // Check if hotel still exists
          try {
            const hotel = await Hotel.findById(hotelId).select('_id');
            if (!hotel) {
              await this.redisCache.redis.del(metricKey);
              cleanedEntries++;
            }
          } catch (error) {
            // If hotel check fails, keep the metric key for safety
            continue;
          }
        }
      }

      logger.debug(`🗑️ Redis cache cleanup completed: ${cleanedEntries} expired entries cleaned`);

      return cleanedEntries;
    } catch (error) {
      logger.warn('⚠️ Error during Redis cache cleanup:', error);
      return 0;
    }
  }

  /**
   * ================================
   * ENHANCED PRICING METHODS (PRESERVED FUNCTIONALITY)
   * ================================
   */

  /**
   * All original methods preserved with cache integration where beneficial
   * This includes all the existing functionality from the original yieldManager.js
   */

  // [PRESERVED: All original methods from verifyDependencies through shutdown]
  // The following methods remain exactly as they were, with cache integration added where beneficial:

  async verifyDependencies() {
    const dependencies = [
      { name: 'Booking Model', check: () => Booking !== undefined },
      { name: 'Hotel Model', check: () => Hotel !== undefined },
      { name: 'Room Model', check: () => Room !== undefined },
      { name: 'PricingRule Model', check: () => PricingRule !== undefined },
      {
        name: 'Currency Service',
        check: () => currencyService && typeof currencyService.getServiceStatus === 'function',
      },
      { name: 'Logger', check: () => logger && typeof logger.info === 'function' },
      { name: 'Constants', check: () => OCCUPANCY_THRESHOLDS && YIELD_LIMITS },
      {
        name: 'Redis Cache Service',
        check: () => cacheService && typeof cacheService.cacheYieldPricing === 'function',
      },
    ];

    const failedDependencies = [];

    for (const dep of dependencies) {
      try {
        if (!dep.check()) {
          failedDependencies.push(dep.name);
        }
      } catch (error) {
        failedDependencies.push(`${dep.name} (${error.message})`);
      }
    }

    if (failedDependencies.length > 0) {
      throw new Error(`Missing dependencies: ${failedDependencies.join(', ')}`);
    }

    logger.info('✅ All Yield Manager dependencies verified successfully (including Redis)');
  }

  convertOccupancyThresholds() {
    return {
      VERY_LOW: {
        max: OCCUPANCY_THRESHOLDS.LOW,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.VERY_LOW],
      },
      LOW: {
        min: OCCUPANCY_THRESHOLDS.LOW,
        max: OCCUPANCY_THRESHOLDS.MEDIUM,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.LOW],
      },
      MODERATE: {
        min: OCCUPANCY_THRESHOLDS.MEDIUM,
        max: OCCUPANCY_THRESHOLDS.HIGH,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.MEDIUM],
      },
      HIGH: {
        min: OCCUPANCY_THRESHOLDS.HIGH,
        max: OCCUPANCY_THRESHOLDS.VERY_HIGH,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.HIGH],
      },
      VERY_HIGH: {
        min: OCCUPANCY_THRESHOLDS.VERY_HIGH,
        max: OCCUPANCY_THRESHOLDS.CRITICAL,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.VERY_HIGH],
      },
      CRITICAL: {
        min: OCCUPANCY_THRESHOLDS.CRITICAL,
        factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.CRITICAL],
      },
    };
  }

  // [ALL OTHER ORIGINAL METHODS PRESERVED - continuing with the exact same functionality]
  // Including: applyPricingRules, evaluateRuleConditions, calculateRuleEffect, calculateConfidenceScore,
  // calculateOccupancyFactor, calculateSeasonalFactor, calculateLeadTimeFactor, calculateDayOfWeekFactor,
  // calculateDemandFactor, calculateSimpleDemandFactor, calculateCompetitionFactor, calculateLengthOfStayFactor,
  // calculateWeightedFactor, applyPricingFactors, generatePricingRecommendations, triggerDemandAnalysis,
  // updatePricingForHotel, getDynamicPricing, getBookingYieldData, getRecentPriceChanges, getOccupancyTrends,
  // getRevenueForecast, getSystemRecommendations, getBasePrice, getOccupancyRate, determineSeason, isHolidayPeriod,
  // getFactorWeights, clearCache (enhanced), getSystemStats, getHealthStatus, getServiceStatus, shutdown

  // [For brevity, I'm showing the structure - all original methods would be included with cache integration where beneficial]

  /**
   * Clear pricing cache (enhanced with Redis)
   */
  clearCache() {
    // Clear memory caches
    this.priceCache.clear();
    this.demandCache.clear();

    // Clear Redis caches would be done through invalidation methods
    logger.info('💰 Yield manager cache cleared (memory)');
    this.emit('cache:cleared', { timestamp: new Date(), type: 'manual' });
  }

  /**
   * Get service status (enhanced with cache info)
   */
  getServiceStatus() {
    const cacheMetrics = this.getCacheMetrics();

    return {
      initialized: this.initialized,
      strategies: Object.keys(this.pricingStrategies),
      cacheSize: {
        memory: {
          prices: this.priceCache.size,
          demand: this.demandCache.size,
        },
        redis: {
          connected: this.redisCache.redis ? true : false,
          hitRate: cacheMetrics.redis.hitRate,
        },
      },
      factors: {
        seasonal: Object.keys(this.seasonalFactors),
        occupancy: Object.keys(this.occupancyThresholds),
        leadTime: Object.keys(this.leadTimeFactors),
      },
      statistics: this.stats,
      cacheMetrics: cacheMetrics,
      health: this.initialized ? 'operational' : 'starting',
    };
  }

  /**
   * Graceful shutdown (enhanced with cache cleanup)
   */
  async shutdown() {
    logger.info('🛑 Shutting down Yield Manager...');

    // Clear all caches
    this.clearCache();

    // Log final metrics
    this.logCacheMetrics();

    // Remove all listeners
    this.removeAllListeners();

    this.initialized = false;

    logger.info('✅ Yield Manager shutdown completed');
    this.emit('shutdown:completed');
  }

  // ============================================================================
  // ORIGINAL METHODS PRESERVED (with cache integration where beneficial)
  // ============================================================================

  /**
   * Apply pricing rules from database (original with cache)
   */
  async applyPricingRules(params) {
    const { hotelId, roomType, checkInDate, factors } = params;

    if (!this.pricingRules || this.pricingRules.length === 0) {
      return { factor: 1.0, rulesApplied: [], description: 'No pricing rules active' };
    }

    const applicableRules = this.pricingRules.filter((rule) => {
      // Check if rule applies to this hotel and room type
      if (rule.hotel.toString() !== hotelId.toString()) return false;
      if (rule.roomType && rule.roomType !== roomType) return false;

      // Check validity period
      const checkIn = new Date(checkInDate);
      if (rule.validFrom && checkIn < rule.validFrom) return false;
      if (rule.validTo && checkIn > rule.validTo) return false;

      // Check conditions
      return this.evaluateRuleConditions(rule.conditions, factors, checkIn);
    });

    // Sort by priority (higher priority first)
    applicableRules.sort((a, b) => (b.priority || 0) - (a.priority || 0));

    let totalFactor = 1.0;
    const appliedRules = [];

    for (const rule of applicableRules) {
      const ruleEffect = this.calculateRuleEffect(rule, factors);
      totalFactor *= ruleEffect.factor;

      appliedRules.push({
        ruleId: rule._id,
        ruleType: rule.ruleType,
        description: rule.description,
        factor: ruleEffect.factor,
        effect: ruleEffect.description,
      });

      // Respect rule limits
      if (appliedRules.length >= 5) break; // Max 5 rules to prevent over-optimization
    }

    return {
      factor: totalFactor,
      rulesApplied: appliedRules,
      description: `${appliedRules.length} pricing rules applied`,
    };
  }

  /**
   * Evaluate if rule conditions are met (original)
   */
  evaluateRuleConditions(conditions, factors, checkInDate) {
    if (!conditions) return true;

    // Check occupancy conditions
    if (conditions.occupancyRange) {
      const occupancy = factors.occupancyFactor.occupancy;
      if (occupancy < conditions.occupancyRange.min || occupancy > conditions.occupancyRange.max) {
        return false;
      }
    }

    // Check day of week conditions
    if (conditions.dayOfWeek && conditions.dayOfWeek.length > 0) {
      const dayOfWeek = moment(checkInDate).format('dddd').toUpperCase();
      if (!conditions.dayOfWeek.includes(dayOfWeek)) {
        return false;
      }
    }

    // Check advance booking conditions
    if (conditions.advanceBookingDays) {
      const daysAhead = moment(checkInDate).diff(moment(), 'days');
      if (
        daysAhead < conditions.advanceBookingDays.min ||
        daysAhead > conditions.advanceBookingDays.max
      ) {
        return false;
      }
    }

    // Check season conditions
    if (conditions.seasonType) {
      const currentSeason = factors.seasonalFactor.season;
      if (currentSeason !== conditions.seasonType) {
        return false;
      }
    }

    return true;
  }

  /**
   * Calculate the effect of a pricing rule (original)
   */
  calculateRuleEffect(rule, factors) {
    const actions = rule.actions;
    let factor = 1.0;
    let description = '';

    for (const action of actions) {
      switch (action.type) {
        case PRICING_ACTIONS.MULTIPLY:
          factor *= action.value;
          description += `${action.value}x multiplier, `;
          break;
        case PRICING_ACTIONS.INCREASE:
          factor *= 1 + action.value / 100;
          description += `+${action.value}%, `;
          break;
        case PRICING_ACTIONS.DECREASE:
          factor *= 1 - action.value / 100;
          description += `-${action.value}%, `;
          break;
      }
    }

    return {
      factor,
      description: description.slice(0, -2) || 'Rule applied',
    };
  }

  /**
   * Calculate confidence score for the pricing calculation (original)
   */
  calculateConfidenceScore(factors) {
    let confidence = 100;

    // Reduce confidence based on missing or uncertain data
    if (!factors.demandFactor || factors.demandFactor.factor === 1.0) {
      confidence -= 20; // No historical demand data
    }

    if (!factors.competitionFactor || factors.competitionFactor.note) {
      confidence -= 15; // No competition data
    }

    if (factors.occupancyFactor.occupancy === 0) {
      confidence -= 25; // No occupancy data
    }

    return Math.max(0, confidence);
  }

  /**
   * Calculate occupancy-based pricing factor (original)
   */
  async calculateOccupancyFactor(hotelId, checkInDate, checkOutDate) {
    try {
      const startDate = moment(checkInDate);
      const endDate = moment(checkOutDate);
      const totalDays = endDate.diff(startDate, 'days');

      let avgOccupancy = 0;

      // Calculate average occupancy for the stay period
      for (let i = 0; i < totalDays; i++) {
        const date = moment(startDate).add(i, 'days');
        const occupancy = await this.getOccupancyRate(hotelId, date.toDate());
        avgOccupancy += occupancy;
      }
      avgOccupancy = avgOccupancy / totalDays;

      // Determine factor based on occupancy thresholds
      for (const [level, threshold] of Object.entries(this.occupancyThresholds)) {
        if (
          threshold.max &&
          avgOccupancy <= threshold.max &&
          (!threshold.min || avgOccupancy >= threshold.min)
        ) {
          return {
            factor: threshold.factor,
            occupancy: avgOccupancy,
            level,
            description: `${avgOccupancy.toFixed(1)}% occupancy (${level.toLowerCase()})`,
            calculatedFor: checkInDate,
          };
        } else if (!threshold.max && avgOccupancy >= threshold.min) {
          return {
            factor: threshold.factor,
            occupancy: avgOccupancy,
            level,
            description: `${avgOccupancy.toFixed(1)}% occupancy (${level.toLowerCase()})`,
            calculatedFor: checkInDate,
          };
        }
      }

      // Default moderate factor
      return {
        factor: 1.0,
        occupancy: avgOccupancy,
        level: 'MODERATE',
        description: `${avgOccupancy.toFixed(1)}% occupancy (moderate)`,
        calculatedFor: checkInDate,
      };
    } catch (error) {
      logger.error('❌ Error calculating occupancy factor:', error);
      return {
        factor: 1.0,
        occupancy: 0,
        level: 'UNKNOWN',
        description: 'Occupancy data unavailable',
        calculatedFor: checkInDate,
      };
    }
  }

  /**
   * Calculate seasonal pricing factor using constants (original)
   */
  calculateSeasonalFactor(checkInDate, checkOutDate, hotelId) {
    const startDate = moment(checkInDate);
    const endDate = moment(checkOutDate);

    // Get seasonal period for the stay
    const season = this.determineSeason(startDate, endDate);
    const factor = this.seasonalFactors[season] || 1.0;

    return {
      factor,
      season,
      description: `${season.toLowerCase().replace('_', ' ')} pricing`,
      period: `${startDate.format('MMM DD')} - ${endDate.format('MMM DD')}`,
      calculatedAt: new Date(),
    };
  }

  /**
   * Calculate seasonal factor from hotel data (new - for cached hotel data)
   */
  calculateSeasonalFactorFromHotel(checkInDate, checkOutDate, hotel) {
    if (hotel.yieldManagement?.eventPricing?.length > 0) {
      // Check for event-based pricing first
      const checkIn = new Date(checkInDate);

      for (const event of hotel.yieldManagement.eventPricing) {
        const eventStart = new Date(event.startDate);
        const eventEnd = new Date(event.endDate);

        if (checkIn >= eventStart && checkIn <= eventEnd) {
          return {
            factor: event.priceMultiplier,
            season: 'EVENT',
            description: `Event pricing: ${event.eventName}`,
            period: `${eventStart.toDateString()} - ${eventEnd.toDateString()}`,
            calculatedAt: new Date(),
          };
        }
      }
    }

    // Fall back to standard seasonal calculation
    return this.calculateSeasonalFactor(checkInDate, checkOutDate, hotel._id);
  }

  /**
   * Calculate lead time factor using constants (original)
   */
  calculateLeadTimeFactor(checkInDate) {
    const now = moment();
    const checkIn = moment(checkInDate);
    const daysAhead = checkIn.diff(now, 'days');

    let category, factor;

    if (daysAhead <= 0) {
      category = 'SAME_DAY';
      factor = this.leadTimeFactors.SAME_DAY;
    } else if (daysAhead === 1) {
      category = 'NEXT_DAY';
      factor = this.leadTimeFactors.ONE_WEEK; // Use closest match
    } else if (daysAhead <= 7) {
      category = 'WEEK_AHEAD';
      factor = this.leadTimeFactors.ONE_WEEK;
    } else if (daysAhead <= 14) {
      category = 'TWO_WEEKS';
      factor = this.leadTimeFactors.TWO_WEEKS;
    } else if (daysAhead <= 30) {
      category = 'MONTH_AHEAD';
      factor = this.leadTimeFactors.ONE_MONTH;
    } else {
      category = 'ADVANCE';
      factor = this.leadTimeFactors.SIX_MONTHS;
    }

    return {
      factor,
      daysAhead,
      category,
      description: `${daysAhead} days lead time (${category.toLowerCase().replace('_', ' ')})`,
      calculatedAt: new Date(),
    };
  }

  /**
   * Calculate day of week factor using constants (original)
   */
  calculateDayOfWeekFactor(checkInDate, checkOutDate) {
    const startDate = moment(checkInDate);
    const endDate = moment(checkOutDate);
    const totalDays = endDate.diff(startDate, 'days');

    let totalFactor = 0;
    const dayFactors = [];

    for (let i = 0; i < totalDays; i++) {
      const date = moment(startDate).add(i, 'days');
      const dayName = date.format('dddd').toUpperCase();
      const dayFactor = this.dayOfWeekFactors[dayName] || 1.0;

      totalFactor += dayFactor;
      dayFactors.push({ day: dayName, factor: dayFactor });
    }

    const avgFactor = totalDays > 0 ? totalFactor / totalDays : 1.0;

    return {
      factor: avgFactor,
      dayFactors,
      totalDays,
      description: `Average day-of-week factor: ${avgFactor.toFixed(2)}`,
      calculatedAt: new Date(),
    };
  }

  /**
   * Calculate demand trend factor using demand analyzer (original)
   */
  async calculateDemandFactor(hotelId, roomType, checkInDate) {
    try {
      if (demandAnalyzer && demandAnalyzer.analyzeDemandForDate) {
        const demandAnalysis = await demandAnalyzer.analyzeDemandForDate(
          hotelId,
          roomType,
          checkInDate
        );
        const demandLevel = demandAnalysis.level || 'NORMAL';
        const factor = this.demandFactors[demandLevel] || 1.0;

        return {
          factor,
          level: demandLevel,
          confidence: demandAnalysis.confidence || 0.5,
          description: `${demandLevel.toLowerCase()} demand predicted`,
          calculatedAt: new Date(),
        };
      }

      // Fallback to simple historical analysis
      return await this.calculateSimpleDemandFactor(hotelId, roomType, checkInDate);
    } catch (error) {
      logger.error('❌ Error calculating demand factor:', error);
      return {
        factor: 1.0,
        description: 'Demand data unavailable',
        calculatedAt: new Date(),
      };
    }
  }

  /**
   * Simple demand factor calculation as fallback (original with cache keys)
   */
  async calculateSimpleDemandFactor(hotelId, roomType, checkInDate) {
    try {
      // Look at booking patterns for similar dates in previous years
      const targetDate = moment(checkInDate);
      const lastYear = moment(targetDate).subtract(1, 'year');
      const twoYearsAgo = moment(targetDate).subtract(2, 'years');

      // Get historical bookings for same period
      const historicalBookings = await Booking.find({
        hotel: hotelId,
        'rooms.roomType': roomType,
        checkInDate: {
          $in: [
            {
              $gte: moment(lastYear).subtract(7, 'days').toDate(),
              $lte: moment(lastYear).add(7, 'days').toDate(),
            },
            {
              $gte: moment(twoYearsAgo).subtract(7, 'days').toDate(),
              $lte: moment(twoYearsAgo).add(7, 'days').toDate(),
            },
          ],
        },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      });

      // Calculate demand factor based on historical data
      const bookingCount = historicalBookings.length;
      let demandLevel = 'NORMAL';
      let factor = 1.0;

      if (bookingCount === 0) {
        demandLevel = 'VERY_LOW';
        factor = this.demandFactors.VERY_LOW;
      } else if (bookingCount <= 2) {
        demandLevel = 'LOW';
        factor = this.demandFactors.LOW;
      } else if (bookingCount <= 5) {
        demandLevel = 'NORMAL';
        factor = this.demandFactors.NORMAL;
      } else if (bookingCount <= 8) {
        demandLevel = 'HIGH';
        factor = this.demandFactors.HIGH;
      } else {
        demandLevel = 'VERY_HIGH';
        factor = this.demandFactors.VERY_HIGH;
      }

      return {
        factor,
        level: demandLevel,
        historicalBookings: bookingCount,
        description: `${bookingCount} historical bookings (${demandLevel.toLowerCase()} demand)`,
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('❌ Error calculating simple demand factor:', error);
      return {
        factor: 1.0,
        description: 'Historical demand data unavailable',
        calculatedAt: new Date(),
      };
    }
  }

  /**
   * Calculate competition factor (original)
   */
  async calculateCompetitionFactor(hotelId, checkInDate) {
    try {
      const hotel = await Hotel.findById(hotelId);
      if (!hotel) {
        return {
          factor: 1.0,
          description: 'Hotel not found for competition analysis',
          calculatedAt: new Date(),
        };
      }

      // Base competition factor on hotel category and location
      let baseCompetitionFactor = 1.0;

      // Adjust based on hotel star rating (higher category = more competition)
      if (hotel.stars >= 4) {
        baseCompetitionFactor = 1.05; // 5% premium for luxury hotels
      } else if (hotel.stars <= 2) {
        baseCompetitionFactor = 0.95; // 5% discount for budget hotels
      }

      // Add some market volatility
      const marketVolatility = Math.random() * 0.1 - 0.05; // ±5% randomness
      const factor = Math.max(0.8, Math.min(1.2, baseCompetitionFactor + marketVolatility));

      return {
        factor,
        baseCompetitionFactor,
        marketVolatility,
        hotelCategory: hotel.stars,
        description: `${hotel.stars}-star hotel market adjustment`,
        note: 'Enhanced competition analysis with external APIs planned',
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('❌ Error calculating competition factor:', error);
      return {
        factor: 1.0,
        description: 'Competition data unavailable',
        calculatedAt: new Date(),
      };
    }
  }

  /**
   * Calculate length of stay factor (original)
   */
  calculateLengthOfStayFactor(checkInDate, checkOutDate) {
    const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');

    let factor = 1.0;
    let description = `${nights} night stay`;

    if (nights >= 7 && nights < 14) {
      factor = 0.9; // 10% discount for weekly stays
      description += ' (weekly discount)';
    } else if (nights >= 14 && nights < 30) {
      factor = 0.85; // 15% discount for 2+ week stays
      description += ' (extended stay discount)';
    } else if (nights >= 30) {
      factor = 0.8; // 20% discount for monthly stays
      description += ' (monthly discount)';
    }

    return {
      factor,
      nights,
      description,
      calculatedAt: new Date(),
    };
  }

  /**
   * Calculate weighted total factor from all individual factors (original)
   */
  calculateWeightedFactor(factors) {
    const weights = this.getFactorWeights();

    let totalFactor = 0;
    let totalWeight = 0;

    for (const [factorName, weight] of Object.entries(weights)) {
      if (factors[factorName] && typeof factors[factorName].factor === 'number') {
        totalFactor += factors[factorName].factor * weight;
        totalWeight += weight;
      }
    }

    // Normalize if some factors are missing
    const result = totalWeight > 0 ? totalFactor / totalWeight : 1.0;

    // Apply yield limits
    const maxIncrease = 1 + YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT / 100;
    const maxDecrease = 1 - YIELD_LIMITS.MIN_PRICE_DECREASE_PERCENT / 100;

    return Math.max(maxDecrease, Math.min(maxIncrease, result));
  }

  /**
   * Apply calculated factors to base price with rules adjustment (original)
   */
  applyPricingFactors(basePrice, factors, rulesAdjustment = { factor: 1.0 }) {
    let adjustedPrice = basePrice * factors.totalFactor * rulesAdjustment.factor;

    // Apply reasonable bounds from constants
    const minPrice = basePrice * (1 - YIELD_LIMITS.MIN_PRICE_DECREASE_PERCENT / 100);
    const maxPrice = basePrice * (1 + YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT / 100);

    adjustedPrice = Math.max(minPrice, Math.min(maxPrice, adjustedPrice));

    // Emit price update event
    this.emit('price:updated', {
      basePrice,
      adjustedPrice,
      factor: factors.totalFactor,
      rulesAdjustment: rulesAdjustment.factor,
    });

    return adjustedPrice;
  }

  /**
   * Generate pricing recommendations based on factors (original)
   */
  generatePricingRecommendations(factors, strategy) {
    const recommendations = [];

    // Low occupancy recommendations
    if (factors.occupancyFactor.factor < 0.9) {
      recommendations.push({
        type: 'OPPORTUNITY',
        message: 'Low occupancy detected - consider promotional pricing or marketing campaigns',
        action: 'REDUCE_PRICE',
        priority: 'HIGH',
        expectedImpact: 'Increase bookings by 15-25%',
      });
    }

    // High demand recommendations
    if (factors.occupancyFactor.factor > 1.2) {
      recommendations.push({
        type: 'REVENUE',
        message: 'High demand period - maximize revenue potential with premium pricing',
        action: 'INCREASE_PRICE',
        priority: 'HIGH',
        expectedImpact: 'Increase revenue by 10-20%',
      });
    }

    // Last-minute booking recommendations
    if (factors.leadTimeFactor.daysAhead < 3) {
      recommendations.push({
        type: 'URGENCY',
        message: 'Last-minute booking window - premium pricing justified by urgency',
        action: 'MAINTAIN_PREMIUM',
        priority: 'MEDIUM',
        expectedImpact: 'Capture urgent demand premium',
      });
    }

    // Extended stay recommendations
    if (factors.lengthOfStayFactor.nights >= 7) {
      recommendations.push({
        type: 'LOYALTY',
        message: 'Extended stay opportunity - consider value-added packages',
        action: 'ADD_VALUE',
        priority: 'LOW',
        expectedImpact: 'Improve guest satisfaction and loyalty',
      });
    }

    // Seasonal recommendations
    if (factors.seasonalFactor.season === 'LOW_SEASON') {
      recommendations.push({
        type: 'SEASONAL',
        message: 'Low season period - focus on local market and special packages',
        action: 'TARGETED_PROMOTION',
        priority: 'MEDIUM',
        expectedImpact: 'Maintain occupancy during slow period',
      });
    }

    return recommendations;
  }

  // [CONTINUE WITH ALL OTHER ORIGINAL METHODS...]
  // For brevity, I'll include the key remaining methods that are essential:

  /**
   * Helper methods (original)
   */
  async getBasePrice(hotelId, roomType) {
    try {
      const room = await Room.findOne({ hotel: hotelId, type: roomType });
      return room ? room.basePrice || room.pricePerNight : null;
    } catch (error) {
      logger.error('❌ Error getting base price:', error);
      return null;
    }
  }

  async getOccupancyRate(hotelId, date) {
    try {
      const startOfDay = moment(date).startOf('day').toDate();
      const endOfDay = moment(date).endOf('day').toDate();

      // Get total bookings for the date
      const bookings = await Booking.find({
        hotel: hotelId,
        checkIn: { $lte: endOfDay },
        checkOut: { $gt: startOfDay },
        status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
      });

      // Get total rooms in hotel
      const hotel = await Hotel.findById(hotelId);
      const totalRooms = hotel ? hotel.totalRooms || 0 : 0;

      if (totalRooms === 0) return 0;

      // Calculate occupancy rate
      const occupiedRooms = bookings.reduce((sum, booking) => {
        return sum + booking.rooms.reduce((roomSum, room) => roomSum + room.quantity, 0);
      }, 0);

      return Math.min(100, (occupiedRooms / totalRooms) * 100);
    } catch (error) {
      logger.error('❌ Error calculating occupancy rate:', error);
      return 0;
    }
  }

  getFactorWeights(strategy = 'MODERATE') {
    const baseWeights = {
      occupancyFactor: 0.3,
      seasonalFactor: 0.2,
      leadTimeFactor: 0.15,
      dayOfWeekFactor: 0.1,
      demandFactor: 0.1,
      competitionFactor: 0.05,
      strategyFactor: 0.05,
      lengthOfStayFactor: 0.05,
    };

    // Adjust weights based on strategy
    switch (strategy) {
      case 'CONSERVATIVE':
        baseWeights.occupancyFactor = 0.4; // Focus more on occupancy
        baseWeights.competitionFactor = 0.1; // Consider competition more
        break;
      case 'AGGRESSIVE':
        baseWeights.seasonalFactor = 0.3; // Focus on seasonal premiums
        baseWeights.leadTimeFactor = 0.2; // Take advantage of urgency
        break;
    }

    return baseWeights;
  }

  determineSeason(startDate, endDate) {
    const startMonth = startDate.month();
    const endMonth = endDate.month();

    // Use constants for season determination
    if (this.isHolidayPeriod(startDate, endDate)) {
      return 'PEAK_SEASON';
    }

    // Northern hemisphere seasons (adjust for your market)
    const seasons = {
      HIGH_SEASON: [5, 6, 7, 8], // June-September (summer)
      SHOULDER_SEASON: [3, 4, 9, 10], // April-May, Oct-Nov
      LOW_SEASON: [0, 1, 2, 11], // Dec-March (winter)
    };

    // Determine season based on majority of stay
    for (const [season, months] of Object.entries(seasons)) {
      if (months.includes(startMonth) || months.includes(endMonth)) {
        return season;
      }
    }

    return 'MEDIUM_SEASON';
  }

  isHolidayPeriod(startDate, endDate) {
    // Check for major holiday periods
    const holidayPeriods = [
      { start: [11, 20], end: [0, 5] }, // Christmas/New Year
      { start: [6, 1], end: [6, 31] }, // July (summer holiday)
      // Add more holiday periods as needed
    ];

    return holidayPeriods.some((period) => {
      const holidayStart = moment().month(period.start[0]).date(period.start[1]);
      const holidayEnd = moment().month(period.end[0]).date(period.end[1]);

      return (
        startDate.isBetween(holidayStart, holidayEnd, null, '[]') ||
        endDate.isBetween(holidayStart, holidayEnd, null, '[]')
      );
    });
  }

  /**
   * Get system statistics (enhanced with real cache hit rate)
   */
  getSystemStats() {
    const realHitRate = this.calculateCacheHitRate();
    const cachePerformance = this.getCachePerformanceSummary();

    return {
      ...this.stats,
      cacheStats: {
        priceCache: this.priceCache.size,
        demandCache: this.demandCache.size,
        hitRate: realHitRate, // Real calculated hit rate
        performance: cachePerformance,
        redis: {
          connected: this.redisCache.redis ? true : false,
          hits: this.cacheMetrics.redisHits,
          misses: this.cacheMetrics.redisMisses,
          errors: this.cacheMetrics.redisErrors,
        },
        memory: {
          hits: this.cacheMetrics.memoryHits,
          misses: this.cacheMetrics.memoryMisses,
        },
      },
      initialized: this.initialized,
      pricingRulesCount: this.pricingRules ? this.pricingRules.length : 0,
      cacheEnabled: true,
      redisConnected: this.redisCache.redis ? true : false,
    };
  }

  /**
   * Get service health status (enhanced with cache health)
   */
  async getHealthStatus() {
    try {
      const cacheHealth = await this.performCacheHealthCheck();

      const health = {
        status: this.initialized ? 'healthy' : 'initializing',
        initialized: this.initialized,
        dependencies: {
          database: 'connected',
          currencyService: currencyService.getServiceStatus(),
          demandAnalyzer: demandAnalyzer ? 'available' : 'unavailable',
          revenueAnalytics: revenueAnalytics ? 'available' : 'unavailable',
          redisCache: cacheHealth.redis.status,
        },
        cache: {
          redis: cacheHealth.redis,
          memory: cacheHealth.memory,
          overall: cacheHealth.overall,
        },
        statistics: this.getSystemStats(),
        lastActivity: this.stats.lastCalculation,
      };

      return health;
    } catch (error) {
      return {
        status: 'error',
        error: error.message,
        initialized: this.initialized,
      };
    }
  }

  // [ALL OTHER REMAINING ORIGINAL METHODS WOULD BE INCLUDED HERE]
  // Including: triggerDemandAnalysis, updatePricingForHotel, getDynamicPricing,
  // getBookingYieldData, getRecentPriceChanges, getOccupancyTrends, getRevenueForecast, etc.
  /**
   * Trigger demand analysis for a hotel (original)
   */
  async triggerDemandAnalysis(hotelId) {
    try {
      if (demandAnalyzer && demandAnalyzer.triggerAnalysis) {
        await demandAnalyzer.triggerAnalysis(hotelId);
      }

      this.emit('demand:analysis_triggered', { hotelId, timestamp: new Date() });
      logger.info(`📊 Demand analysis triggered for hotel ${hotelId}`);
    } catch (error) {
      logger.error('❌ Error triggering demand analysis:', error);
    }
  }

  /**
   * Update pricing for all rooms in a hotel (enhanced with cache invalidation)
   */
  async updatePricingForHotel(hotelId) {
    try {
      const rooms = await Room.find({ hotel: hotelId });
      const updatedRooms = [];

      for (const room of rooms) {
        try {
          const pricing = await this.getDynamicPricing(hotelId, room.type, new Date());

          // Update room with new dynamic pricing
          room.currentDynamicPrice = {
            price: pricing.dynamicPrice,
            factor: pricing.factors.totalFactor,
            updatedAt: new Date(),
            strategy: pricing.strategy,
          };

          await room.save();
          updatedRooms.push(room);
        } catch (roomError) {
          logger.error(`❌ Error updating pricing for room ${room._id}:`, roomError);
        }
      }

      // Invalidate cache after updates
      await this.invalidateHotelYieldCache(hotelId);

      this.emit('pricing:hotel_updated', {
        hotelId,
        updatedRoomsCount: updatedRooms.length,
        timestamp: new Date(),
      });

      logger.info(`💰 Updated pricing for ${updatedRooms.length} rooms in hotel ${hotelId}`);
      return updatedRooms;
    } catch (error) {
      logger.error('❌ Error updating hotel pricing:', error);
      throw error;
    }
  }

  /**
   * Get dynamic pricing for a specific room type and date (original)
   */
  async getDynamicPricing(hotelId, roomType, date) {
    const checkInDate = moment(date).format('YYYY-MM-DD');
    const checkOutDate = moment(date).add(1, 'day').format('YYYY-MM-DD');

    return await this.calculateDynamicPrice({
      hotelId,
      roomType,
      checkInDate,
      checkOutDate,
      strategy: 'MODERATE',
    });
  }

  /**
   * Get booking yield data for analytics (original)
   */
  async getBookingYieldData(bookingId) {
    try {
      const booking = await Booking.findById(bookingId).populate('hotel');
      if (!booking) {
        throw new Error('Booking not found');
      }

      const yieldData = {
        bookingId,
        hotelId: booking.hotel._id,
        originalPrice: booking.originalPrice || booking.pricing.totalPrice,
        finalPrice: booking.pricing.totalPrice,
        priceAdjustment:
          booking.pricing.totalPrice - (booking.originalPrice || booking.pricing.totalPrice),
        adjustmentPercentage: booking.originalPrice
          ? (
              ((booking.pricing.totalPrice - booking.originalPrice) / booking.originalPrice) *
              100
            ).toFixed(2)
          : 0,
        bookingDate: booking.createdAt,
        checkInDate: booking.checkIn,
        leadTime: moment(booking.checkIn).diff(moment(booking.createdAt), 'days'),
        roomTypes: booking.rooms.map((room) => room.roomType),
        yieldStrategy: booking.yieldStrategy || 'MODERATE',
        revenue: booking.pricing.totalPrice,
        calculatedAt: new Date(),
      };

      return yieldData;
    } catch (error) {
      logger.error('❌ Error getting booking yield data:', error);
      throw error;
    }
  }

  /**
   * Get recent price changes across all hotels (enhanced with cache)
   */
  async getRecentPriceChanges(limit = 10) {
    try {
      const cacheKey = `recent_price_changes_${limit}`;

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateRecentChangesData(cached)) {
        return cached;
      }

      // Get recent price changes from room price history
      const recentChanges = await Room.aggregate([
        { $match: { 'priceHistory.0': { $exists: true } } },
        { $unwind: '$priceHistory' },
        { $sort: { 'priceHistory.date': -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'hotels',
            localField: 'hotel',
            foreignField: '_id',
            as: 'hotelInfo',
          },
        },
        { $unwind: '$hotelInfo' },
        {
          $project: {
            roomNumber: '$number',
            roomType: '$type',
            hotelName: '$hotelInfo.name',
            hotelId: '$hotel',
            date: '$priceHistory.date',
            basePrice: '$priceHistory.basePrice',
            dynamicPrice: '$priceHistory.dynamicPrice',
            changePercentage: {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ['$priceHistory.dynamicPrice', '$priceHistory.basePrice'] },
                    '$priceHistory.basePrice',
                  ],
                },
                100,
              ],
            },
            factors: '$priceHistory.factors',
            source: '$priceHistory.source',
          },
        },
      ]);

      const result = {
        changes: recentChanges,
        totalChanges: recentChanges.length,
        averageChange:
          recentChanges.length > 0
            ? recentChanges.reduce((sum, change) => sum + change.changePercentage, 0) /
              recentChanges.length
            : 0,
        lastUpdate: new Date(),
        generatedAt: new Date(),
      };

      // Cache the result for 10 minutes
      await this.setInHybridCache(cacheKey, result, 'analytics', 10 * 60);

      return result;
    } catch (error) {
      logger.error('❌ Error getting recent price changes:', error);
      return { changes: [], totalChanges: 0, averageChange: 0 };
    }
  }

  /**
   * Validate recent price changes data
   */
  validateRecentChangesData(cached) {
    if (!cached || !cached.generatedAt) return false;

    const age = Date.now() - new Date(cached.generatedAt).getTime();
    const maxAge = 10 * 60 * 1000; // 10 minutes

    return age <= maxAge;
  }

  /**
   * Get occupancy trends for analytics (enhanced with cache)
   */
  async getOccupancyTrends() {
    try {
      const cacheKey = 'occupancy_trends_analytics';

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateTrendsData(cached)) {
        return cached;
      }

      if (revenueAnalytics && revenueAnalytics.getOccupancyTrends) {
        const trends = await revenueAnalytics.getOccupancyTrends();

        // Cache for 30 minutes
        await this.setInHybridCache(cacheKey, trends, 'analytics', 30 * 60);

        return trends;
      }

      // Fallback calculation
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const occupancyData = await Booking.aggregate([
        {
          $match: {
            status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
            checkIn: { $gte: thirtyDaysAgo },
          },
        },
        {
          $group: {
            _id: {
              date: { $dateToString: { format: '%Y-%m-%d', date: '$checkIn' } },
              hotel: '$hotel',
            },
            bookings: { $sum: 1 },
            totalRooms: { $sum: { $size: '$rooms' } },
          },
        },
        {
          $group: {
            _id: '$_id.date',
            totalBookings: { $sum: '$bookings' },
            totalRoomsBooked: { $sum: '$totalRooms' },
            avgOccupancy: { $avg: '$totalRooms' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const result = {
        trends: occupancyData,
        averageOccupancy:
          occupancyData.length > 0
            ? occupancyData.reduce((sum, day) => sum + day.avgOccupancy, 0) / occupancyData.length
            : 0,
        growth: this.calculateOccupancyGrowth(occupancyData),
        generatedAt: new Date(),
      };

      // Cache for 30 minutes
      await this.setInHybridCache(cacheKey, result, 'analytics', 30 * 60);

      return result;
    } catch (error) {
      logger.error('❌ Error getting occupancy trends:', error);
      return { trends: [], averageOccupancy: 0, growth: 0 };
    }
  }

  /**
   * Calculate occupancy growth rate
   */
  calculateOccupancyGrowth(occupancyData) {
    if (occupancyData.length < 2) return 0;

    const firstWeek = occupancyData.slice(0, 7);
    const lastWeek = occupancyData.slice(-7);

    const firstWeekAvg =
      firstWeek.reduce((sum, day) => sum + day.avgOccupancy, 0) / firstWeek.length;
    const lastWeekAvg = lastWeek.reduce((sum, day) => sum + day.avgOccupancy, 0) / lastWeek.length;

    return firstWeekAvg > 0 ? ((lastWeekAvg - firstWeekAvg) / firstWeekAvg) * 100 : 0;
  }

  /**
   * Validate trends data
   */
  validateTrendsData(cached) {
    if (!cached || !cached.generatedAt) return false;

    const age = Date.now() - new Date(cached.generatedAt).getTime();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    return age <= maxAge;
  }

  /**
   * Get revenue forecast (enhanced with cache)
   */
  async getRevenueForecast() {
    try {
      const cacheKey = 'revenue_forecast_analytics';

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateForecastData(cached)) {
        return cached;
      }

      if (revenueAnalytics && revenueAnalytics.getRevenueForecast) {
        const forecast = await revenueAnalytics.getRevenueForecast();

        // Cache for 1 hour
        await this.setInHybridCache(cacheKey, forecast, 'analytics', 60 * 60);

        return forecast;
      }

      // Fallback forecast calculation
      const last30Days = await this.calculateLast30DaysRevenue();
      const forecast = this.generateSimpleForecast(last30Days);

      // Cache for 1 hour
      await this.setInHybridCache(cacheKey, forecast, 'analytics', 60 * 60);

      return forecast;
    } catch (error) {
      logger.error('❌ Error getting revenue forecast:', error);
      return { forecast: [], expectedRevenue: 0, confidence: 0 };
    }
  }

  /**
   * Calculate last 30 days revenue
   */
  async calculateLast30DaysRevenue() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const revenue = await Booking.aggregate([
      {
        $match: {
          status: { $in: ['COMPLETED', 'CHECKED_OUT'] },
          checkOut: { $gte: thirtyDaysAgo },
        },
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: '$pricing.totalPrice' },
          totalBookings: { $sum: 1 },
          avgBookingValue: { $avg: '$pricing.totalPrice' },
        },
      },
    ]);

    return revenue[0] || { totalRevenue: 0, totalBookings: 0, avgBookingValue: 0 };
  }

  /**
   * Generate simple revenue forecast
   */
  generateSimpleForecast(historicalData) {
    const dailyRevenue = historicalData.totalRevenue / 30;
    const forecastDays = 30;

    const forecast = [];
    for (let i = 1; i <= forecastDays; i++) {
      const date = new Date();
      date.setDate(date.getDate() + i);

      // Add some seasonality and trend
      const seasonalityFactor = 1 + 0.1 * Math.sin((i / 30) * Math.PI * 2);
      const trendFactor = 1 + i / 1000; // Slight growth trend

      forecast.push({
        date,
        expectedRevenue: Math.round(dailyRevenue * seasonalityFactor * trendFactor),
        confidence: Math.max(50, 90 - i * 1.5), // Decreasing confidence over time
      });
    }

    return {
      forecast,
      expectedRevenue: forecast.reduce((sum, day) => sum + day.expectedRevenue, 0),
      confidence: forecast.reduce((sum, day) => sum + day.confidence, 0) / forecast.length,
      generatedAt: new Date(),
    };
  }

  /**
   * Validate forecast data
   */
  validateForecastData(cached) {
    if (!cached || !cached.generatedAt) return false;

    const age = Date.now() - new Date(cached.generatedAt).getTime();
    const maxAge = 60 * 60 * 1000; // 1 hour

    return age <= maxAge;
  }

  /**
   * Get system-wide recommendations (enhanced with cache)
   */
  async getSystemRecommendations() {
    try {
      const cacheKey = 'system_recommendations';

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateRecommendationsData(cached)) {
        return cached;
      }

      const recommendations = [];

      // Cache-based recommendations
      const cacheMetrics = this.getCacheMetrics();
      if (cacheMetrics.overall.hitRate < 70) {
        recommendations.push({
          type: 'PERFORMANCE',
          message: 'Cache hit rate is low - consider increasing cache TTL or warming up cache',
          priority: 'LOW',
          action: 'OPTIMIZE_CACHE',
          impact: 'Improve system performance by 20-30%',
        });
      }

      // System performance recommendations
      if (this.stats.averageCalculationTime > 500) {
        recommendations.push({
          type: 'PERFORMANCE',
          message: 'Average yield calculation time is high - consider system optimization',
          priority: 'MEDIUM',
          action: 'OPTIMIZE_CALCULATIONS',
          impact: 'Reduce response time and improve user experience',
        });
      }

      // Redis health recommendations
      if (cacheMetrics.redis.errors > 10) {
        recommendations.push({
          type: 'INFRASTRUCTURE',
          message: 'High Redis error rate detected - check Redis connection and health',
          priority: 'HIGH',
          action: 'CHECK_REDIS_HEALTH',
          impact: 'Ensure cache reliability and system stability',
        });
      }

      // Yield management adoption recommendations
      const hotelsWithYield = await Hotel.countDocuments({
        isActive: true,
        'yieldManagement.enabled': true,
      });
      const totalHotels = await Hotel.countDocuments({ isActive: true });

      if (hotelsWithYield / totalHotels < 0.5) {
        recommendations.push({
          type: 'BUSINESS',
          message: 'Low yield management adoption - consider enabling for more hotels',
          priority: 'MEDIUM',
          action: 'ENABLE_YIELD_MANAGEMENT',
          impact: 'Potential revenue increase of 15-25%',
        });
      }

      const result = {
        recommendations,
        totalRecommendations: recommendations.length,
        highPriority: recommendations.filter((r) => r.priority === 'HIGH').length,
        generatedAt: new Date(),
      };

      // Cache for 30 minutes
      await this.setInHybridCache(cacheKey, result, 'analytics', 30 * 60);

      return result;
    } catch (error) {
      logger.error('❌ Error getting system recommendations:', error);
      return [];
    }
  }

  /**
   * Validate recommendations data
   */
  validateRecommendationsData(cached) {
    if (!cached || !cached.generatedAt) return false;

    const age = Date.now() - new Date(cached.generatedAt).getTime();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    return age <= maxAge;
  }

  /**
   * Calculate actual cache hit rate based on real metrics
   */
  calculateCacheHitRate() {
    const totalRequests =
      this.cacheMetrics.redisHits +
      this.cacheMetrics.redisMisses +
      this.cacheMetrics.memoryHits +
      this.cacheMetrics.memoryMisses;

    if (totalRequests === 0) {
      return 0; // No requests yet
    }

    const totalHits = this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits;
    const hitRate = totalHits / totalRequests;

    // Return percentage rounded to 2 decimal places
    return Math.round(hitRate * 10000) / 100;
  }

  /**
   * Get detailed cache hit rates breakdown
   */
  getDetailedCacheHitRates() {
    const totalRequests =
      this.cacheMetrics.redisHits +
      this.cacheMetrics.redisMisses +
      this.cacheMetrics.memoryHits +
      this.cacheMetrics.memoryMisses;

    if (totalRequests === 0) {
      return {
        overall: 0,
        redis: 0,
        memory: 0,
        totalRequests: 0,
      };
    }

    const redisRequests = this.cacheMetrics.redisHits + this.cacheMetrics.redisMisses;
    const memoryRequests = this.cacheMetrics.memoryHits + this.cacheMetrics.memoryMisses;

    return {
      overall:
        Math.round(
          ((this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits) / totalRequests) * 10000
        ) / 100,
      redis:
        redisRequests > 0
          ? Math.round((this.cacheMetrics.redisHits / redisRequests) * 10000) / 100
          : 0,
      memory:
        memoryRequests > 0
          ? Math.round((this.cacheMetrics.memoryHits / memoryRequests) * 10000) / 100
          : 0,
      totalRequests,
      breakdown: {
        redisHits: this.cacheMetrics.redisHits,
        redisMisses: this.cacheMetrics.redisMisses,
        memoryHits: this.cacheMetrics.memoryHits,
        memoryMisses: this.cacheMetrics.memoryMisses,
        redisErrors: this.cacheMetrics.redisErrors,
      },
    };
  }

  /**
   * Get cache performance summary
   */
  getCachePerformanceSummary() {
    const hitRates = this.getDetailedCacheHitRates();
    const avgCalculationTime = this.stats.averageCalculationTime || 0;

    // Estimate time savings from cache
    const estimatedCacheTime = 5; // ms - typical cache lookup time
    const estimatedCalculationTime = avgCalculationTime || 100; // ms - typical calculation time
    const timeSavedPerHit = estimatedCalculationTime - estimatedCacheTime;
    const totalTimeSaved =
      (this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits) * timeSavedPerHit;

    return {
      hitRate: hitRates.overall,
      timeSaved: {
        total: totalTimeSaved,
        perRequest: hitRates.totalRequests > 0 ? totalTimeSaved / hitRates.totalRequests : 0,
        unit: 'milliseconds',
      },
      efficiency: {
        requests: hitRates.totalRequests,
        cacheHits: this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits,
        calculations: this.stats.priceCalculations,
        errors: this.cacheMetrics.redisErrors,
      },
      performance: {
        avgCalculationTime,
        estimatedCacheTime,
        improvementFactor:
          avgCalculationTime > 0 ? estimatedCalculationTime / estimatedCacheTime : 1,
      },
    };
  }
}

// Export singleton instance
module.exports = new YieldManager();
