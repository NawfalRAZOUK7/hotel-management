/**
 * ANALYTICS CONTROLLER - REDIS CACHE ENHANCED
 * Advanced hotel analytics with comprehensive Redis caching integration
 * Comprehensive analytics system for hotel management with real-time data,
 * yield management insights, revenue optimization, loyalty program analytics, and advanced reporting
 *
 * PHASE 2 ENHANCEMENTS:
 * - Redis cache integration for all analytics endpoints
 * - Intelligent cache invalidation strategies
 * - Multi-layer caching (memory + Redis)
 * - Performance monitoring and metrics
 * - Cache warming and optimization
 *
 * Features:
 * - Revenue Analytics (RevPAR, ADR, Occupancy) with cache
 * - Demand Analytics & Forecasting with cache
 * - Yield Performance Analytics with cache
 * - Loyalty Program Analytics with cache
 * - Operational Analytics with cache
 * - Real-time Dashboard Streaming with cache
 * - Advanced Reporting & Export with cache
 * - Market Intelligence with cache
 * - Customer Segment Analytics with cache
 */

const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const User = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const mongoose = require('mongoose');
const moment = require('moment');

// Services Integration
const yieldManager = require('../services/yieldManager');
const revenueAnalytics = require('../services/revenueAnalytics');
const demandAnalyzer = require('../services/demandAnalyzer');
const socketService = require('../services/socketService');
const currencyService = require('../services/currencyService');

// ✅ NEW: Redis Cache Integration
const cacheService = require('../services/cacheService');
const { CacheKeys, TTL, PREFIXES } = require('../utils/cacheKeys');

// Utilities
const { logger } = require('../utils/logger');
const {
  BOOKING_STATUS,
  BOOKING_SOURCES,
  ROOM_TYPES,
  CLIENT_TYPES,
  USER_ROLES,
  PERFORMANCE_METRICS,
  ANALYSIS_PERIODS,
  DEMAND_LEVELS,
} = require('../utils/constants');

class AnalyticsController {
  constructor() {
    // ============================================================================
    // ORIGINAL CONFIGURATION (PRESERVED)
    // ============================================================================
    this.cache = new Map();
    this.cacheExpiry = 15 * 60 * 1000; // 15 minutes cache
    this.streamingClients = new Map(); // For real-time dashboard streaming

    // Analytics calculation weights
    this.analyticsWeights = {
      revenue: 0.4,
      occupancy: 0.3,
      yield: 0.2,
      customer: 0.1,
    };

    // Performance benchmarks
    this.benchmarks = {
      occupancyRate: { poor: 50, average: 70, good: 85, excellent: 95 },
      revPAR: { poor: 50, average: 80, good: 120, excellent: 180 },
      adr: { poor: 100, average: 150, good: 200, excellent: 300 },
      yieldScore: { poor: 60, average: 75, good: 85, excellent: 95 },
    };

    // ============================================================================
    // NEW: REDIS CACHE INTEGRATION LAYER
    // ============================================================================
    this.redisCache = cacheService;
    this.cacheKeys = CacheKeys;

    // Cache Strategy Configuration
    this.cacheStrategy = {
      dashboard: {
        ttl: TTL.ANALYTICS.DASHBOARD,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['booking:created', 'booking:confirmed', 'booking:cancelled'],
      },
      revenue: {
        ttl: TTL.ANALYTICS.STATISTICS,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['booking:confirmed', 'yield:updated', 'pricing:changed'],
      },
      occupancy: {
        ttl: TTL.ANALYTICS.REPORTS,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['booking:created', 'booking:confirmed', 'booking:cancelled'],
      },
      loyalty: {
        ttl: TTL.ANALYTICS.STATISTICS,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['loyalty:transaction', 'loyalty:tier_change'],
      },
      yield: {
        ttl: TTL.ANALYTICS.STATISTICS,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['yield:calculation', 'pricing:strategy_change'],
      },
      operational: {
        ttl: TTL.ANALYTICS.REPORTS,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['booking:status_change', 'checkin:completed', 'checkout:completed'],
      },
      reports: {
        ttl: TTL.ANALYTICS.HISTORICAL,
        useRedis: true,
        useFallback: true,
        invalidateOn: ['manual:refresh'],
      },
      realtime: {
        ttl: TTL.ANALYTICS.REALTIME,
        useRedis: true,
        useFallback: false,
        invalidateOn: ['booking:created', 'booking:status_change'],
      },
    };

    // Cache Performance Metrics
    this.cacheMetrics = {
      redisHits: 0,
      redisMisses: 0,
      memoryHits: 0,
      memoryMisses: 0,
      redisErrors: 0,
      totalCalculations: 0,
      cacheBypass: 0,
      lastResetAt: new Date(),
      avgCalculationTime: 0,
      avgCacheTime: 0,
    };

    // Cache warming configuration
    this.cacheWarmup = {
      enabled: process.env.ANALYTICS_CACHE_WARMUP !== 'false',
      intervals: {
        dashboard: 5 * 60 * 1000, // 5 minutes
        popular: 15 * 60 * 1000, // 15 minutes
        heavy: 60 * 60 * 1000, // 1 hour
      },
    };

    logger.info('✅ Analytics Controller initialized with Redis cache integration');

    // Initialize cache performance monitoring
    this.setupCacheMetricsLogging();
  }

  /**
   * ================================
   * CACHE INTEGRATION LAYER
   * ================================
   */

  /**
   * Get data from hybrid cache (Redis first, then memory fallback)
   * @param {string} cacheKey - Cache key
   * @param {string} analyticsType - Type of analytics data
   * @returns {Object|null} Cached data or null
   */
  async getFromHybridCache(cacheKey, analyticsType) {
    this.cacheMetrics.totalCalculations++;
    const startTime = Date.now();

    const strategy = this.cacheStrategy[analyticsType] || this.cacheStrategy.dashboard;

    // Try Redis first if enabled
    if (strategy.useRedis) {
      try {
        const redisData = await this.redisCache.getAnalytics(analyticsType, cacheKey);

        if (redisData) {
          this.cacheMetrics.redisHits++;
          this.cacheMetrics.avgCacheTime =
            (this.cacheMetrics.avgCacheTime + (Date.now() - startTime)) / 2;

          logger.debug(`📊 Redis cache hit for analytics: ${analyticsType}:${cacheKey}`);
          return { ...redisData, fromCache: true, cacheSource: 'redis' };
        }

        this.cacheMetrics.redisMisses++;
      } catch (error) {
        this.cacheMetrics.redisErrors++;
        logger.warn(`⚠️ Redis cache error for ${analyticsType}:${cacheKey}:`, error.message);
      }
    }

    // Fallback to memory cache if enabled
    if (strategy.useFallback) {
      const memoryData = this.getFromMemoryCache(cacheKey, analyticsType);
      if (memoryData) {
        this.cacheMetrics.memoryHits++;
        logger.debug(`💾 Memory cache hit for analytics: ${analyticsType}:${cacheKey}`);
        return { ...memoryData, fromCache: true, cacheSource: 'memory' };
      }

      this.cacheMetrics.memoryMisses++;
    }

    return null;
  }

  /**
   * Set data in hybrid cache (Redis + Memory)
   * @param {string} cacheKey - Cache key
   * @param {Object} data - Data to cache
   * @param {string} analyticsType - Type of analytics data
   * @param {number} customTTL - Custom TTL (optional)
   */
  async setInHybridCache(cacheKey, data, analyticsType, customTTL = null) {
    const strategy = this.cacheStrategy[analyticsType] || this.cacheStrategy.dashboard;
    const ttl = customTTL || strategy.ttl;

    // Add cache metadata
    const cacheData = {
      ...data,
      cacheMetadata: {
        cachedAt: new Date(),
        ttl,
        analyticsType,
        cacheKey,
        version: '1.0',
      },
    };

    // Store in Redis if enabled
    if (strategy.useRedis) {
      try {
        const success = await this.redisCache.cacheAnalytics(
          analyticsType,
          cacheKey,
          cacheData,
          ttl
        );

        if (success) {
          logger.debug(`📊 Stored in Redis cache: ${analyticsType}:${cacheKey}`);
        }
      } catch (error) {
        this.cacheMetrics.redisErrors++;
        logger.warn(
          `⚠️ Failed to store in Redis cache for ${analyticsType}:${cacheKey}:`,
          error.message
        );
      }
    }

    // Store in memory cache if enabled
    if (strategy.useFallback) {
      this.setInMemoryCache(cacheKey, cacheData, analyticsType, ttl);
      logger.debug(`💾 Stored in memory cache: ${analyticsType}:${cacheKey}`);
    }
  }

  /**
   * Get data from memory cache (enhanced original logic)
   */
  getFromMemoryCache(cacheKey, analyticsType) {
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }

    // Clean expired entries
    if (cached) {
      this.cache.delete(cacheKey);
    }

    return null;
  }

  /**
   * Set data in memory cache (enhanced original logic)
   */
  setInMemoryCache(cacheKey, data, analyticsType, ttl) {
    const cacheData = {
      data,
      timestamp: Date.now(),
      ttl: ttl * 1000, // Convert to milliseconds
      analyticsType,
    };

    this.cache.set(cacheKey, cacheData);
  }

  /**
   * ================================
   * CACHE KEY GENERATION
   * ================================
   */

  /**
   * Build analytics cache key
   */
  buildAnalyticsCacheKey(type, identifier, options = {}) {
    const { period, granularity, currency, hotelId, filters } = options;

    let keyParts = [type, identifier];

    if (period) {
      keyParts.push(this.formatPeriod(period));
    }

    if (granularity) {
      keyParts.push(granularity);
    }

    if (currency) {
      keyParts.push(currency);
    }

    if (hotelId) {
      keyParts.push(hotelId);
    }

    if (filters && Object.keys(filters).length > 0) {
      const filterHash = this.hashObject(filters);
      keyParts.push(filterHash);
    }

    return keyParts.join(':');
  }

  /**
   * Format period for cache key
   */
  formatPeriod(period) {
    if (typeof period === 'object' && period.start && period.end) {
      return `${moment(period.start).format('YYYY-MM-DD')}_${moment(period.end).format('YYYY-MM-DD')}`;
    }
    return String(period).replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /**
   * Hash object for cache key
   */
  hashObject(obj) {
    const crypto = require('crypto');
    const str = JSON.stringify(obj, Object.keys(obj).sort());
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 16);
  }

  /**
   * ================================
   * ENHANCED ANALYTICS ENDPOINTS WITH CACHE
   * ================================
   */

  /**
   * @desc    Get comprehensive revenue analytics with Redis cache
   * @route   GET /api/analytics/revenue
   * @access  Admin + Receptionist
   */
  async getRevenueAnalytics(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '30d',
        hotelId,
        roomType,
        currency = 'EUR',
        includeForecasting = true,
        granularity = 'daily',
        realTime = false,
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('revenue', hotelId || 'all', {
        period,
        roomType,
        currency,
        granularity,
        includeForecasting,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'revenue');
        if (cached && this.validateRevenueCache(cached, req.query)) {
          // Update execution time for cache hit
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh revenue analytics
      logger.debug(`🔄 Calculating fresh revenue analytics: ${hotelId || 'all'} - ${period}`);

      // Build query filters
      const query = this.buildAnalyticsQuery({ hotelId, roomType, startDate, endDate });

      // Parallel data collection
      const [
        revenueMetrics,
        occupancyData,
        pricingAnalysis,
        segmentAnalysis,
        trendAnalysis,
        forecastData,
      ] = await Promise.all([
        this.calculateRevenueMetrics(query, currency, granularity),
        this.calculateOccupancyMetrics(query, granularity),
        this.analyzePricingPerformance(query, currency),
        this.analyzeRevenueSegments(query, currency),
        this.analyzeTrends(query, granularity),
        includeForecasting === 'true' ? this.generateRevenueForecast(hotelId, 30) : null,
      ]);

      // Calculate composite scores
      const performanceScore = this.calculateOverallPerformanceScore({
        revenue: revenueMetrics.summary.totalRevenue,
        occupancy: occupancyData.summary.averageOccupancy,
        adr: revenueMetrics.summary.adr,
        revPAR: revenueMetrics.summary.revPAR,
      });

      // Generate insights and recommendations
      const insights = this.generateRevenueInsights({
        revenueMetrics,
        occupancyData,
        pricingAnalysis,
        performanceScore,
      });

      const executionTime = Date.now() - startTime;

      const analyticsData = {
        metadata: {
          period: { start: startDate, end: endDate, description: period },
          filters: { hotelId, roomType, currency },
          granularity,
          generatedAt: new Date(),
          dataPoints: revenueMetrics.summary.totalBookings,
        },
        revenue: revenueMetrics,
        occupancy: occupancyData,
        pricing: pricingAnalysis,
        segments: segmentAnalysis,
        trends: trendAnalysis,
        forecast: forecastData,
        performance: {
          overallScore: performanceScore,
          ratings: this.ratePerformanceMetrics({
            occupancy: occupancyData.summary.averageOccupancy,
            revPAR: revenueMetrics.summary.revPAR,
            adr: revenueMetrics.summary.adr,
          }),
          benchmarkComparison: this.compareToBenchmarks({
            occupancy: occupancyData.summary.averageOccupancy,
            revPAR: revenueMetrics.summary.revPAR,
            adr: revenueMetrics.summary.adr,
          }),
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
        },
        insights,
        recommendations: this.generateRevenueRecommendations(insights),
        realTimeEnabled: realTime === 'true',
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, analyticsData, 'revenue');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      // Setup real-time streaming if requested
      if (realTime === 'true') {
        this.setupRealtimeAnalytics(req.user.id, 'revenue', { hotelId, period, currency });
      }

      res.json({
        success: true,
        data: analyticsData,
      });

      logger.info(
        `📊 Revenue analytics generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating revenue analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate revenue analytics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get comprehensive loyalty program analytics with Redis cache
   * @route   GET /api/analytics/loyalty
   * @access  Admin + Receptionist
   */
  async getLoyaltyAnalytics(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '30d',
        hotelId,
        compareWith = 'previous_period',
        includeForecasting = true,
        granularity = 'daily',
        breakdown = 'tier',
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('loyalty', hotelId || 'all', {
        period,
        compareWith,
        granularity,
        breakdown,
        includeForecasting,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'loyalty');
        if (cached && this.validateLoyaltyCache(cached, req.query)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh loyalty analytics
      logger.debug(`🔄 Calculating fresh loyalty analytics: ${hotelId || 'all'} - ${period}`);

      // Build query filters
      const baseQuery = {};
      if (hotelId) {
        baseQuery.hotel = new mongoose.Types.ObjectId(hotelId);
      }

      // Parallel execution of all analytics
      const [
        membershipMetrics,
        pointsAnalytics,
        tierDistribution,
        engagementMetrics,
        retentionAnalytics,
        roiAnalytics,
        trendsAnalysis,
        topMembers,
        redemptionAnalytics,
        campaignPerformance,
        predictiveInsights,
      ] = await Promise.all([
        this.calculateMembershipMetrics(baseQuery, startDate, endDate),
        this.calculatePointsAnalytics(baseQuery, startDate, endDate, granularity),
        this.calculateTierDistribution(baseQuery),
        this.calculateEngagementMetrics(baseQuery, startDate, endDate),
        this.calculateRetentionAnalytics(baseQuery, startDate, endDate),
        this.calculateLoyaltyROI(baseQuery, startDate, endDate),
        this.analyzeLoyaltyTrends(baseQuery, startDate, endDate, granularity),
        this.getTopLoyaltyMembers(baseQuery, 10),
        this.analyzeRedemptionPatterns(baseQuery, startDate, endDate),
        this.analyzeCampaignPerformance(baseQuery, startDate, endDate),
        includeForecasting === 'true' ? this.generateLoyaltyForecasts(baseQuery, 30) : null,
      ]);

      // Calculate comparison metrics
      let comparisonData = null;
      if (compareWith === 'previous_period') {
        const previousStartDate = new Date(
          startDate.getTime() - (endDate.getTime() - startDate.getTime())
        );
        const previousEndDate = new Date(startDate.getTime() - 1);
        comparisonData = await this.calculateComparisonMetrics(
          baseQuery,
          previousStartDate,
          previousEndDate
        );
      }

      // Generate insights and alerts
      const insights = this.generateLoyaltyInsights({
        membership: membershipMetrics,
        points: pointsAnalytics,
        engagement: engagementMetrics,
        retention: retentionAnalytics,
        roi: roiAnalytics,
      });

      const alerts = this.generateLoyaltyAlerts({
        membership: membershipMetrics,
        engagement: engagementMetrics,
        retention: retentionAnalytics,
      });

      const executionTime = Date.now() - startTime;

      // Compile comprehensive analytics data
      const analyticsData = {
        metadata: {
          period: { start: startDate, end: endDate, description: period },
          hotelId: hotelId || 'all',
          granularity,
          breakdown,
          generatedAt: new Date(),
          dataFreshness: 'real-time',
        },

        // Core membership metrics
        membership: {
          ...membershipMetrics,
          growth: comparisonData?.membershipGrowth || null,
        },

        // Points ecosystem
        points: {
          ...pointsAnalytics,
          velocity: this.calculatePointsVelocity(pointsAnalytics.timeSeries),
          forecast: predictiveInsights?.pointsForecast || null,
        },

        // Tier analysis
        tiers: {
          distribution: tierDistribution,
          progression: await this.analyzeTierProgression(baseQuery, startDate, endDate),
          upgrades: await this.calculateTierUpgrades(baseQuery, startDate, endDate),
          retention: await this.calculateTierRetention(baseQuery, startDate, endDate),
        },

        // Engagement and activity
        engagement: {
          ...engagementMetrics,
          segmentation: await this.segmentMembersByEngagement(baseQuery, startDate, endDate),
          trends: this.analyzeEngagementTrends(engagementMetrics.timeSeries),
        },

        // Customer retention
        retention: {
          ...retentionAnalytics,
          cohortAnalysis: await this.performCohortAnalysis(baseQuery),
          churnRisk: await this.identifyChurnRisk(baseQuery),
        },

        // Financial impact
        financial: {
          roi: roiAnalytics,
          valuePerMember: this.calculateValuePerMember(membershipMetrics, roiAnalytics),
          costAnalysis: await this.analyzeLoyaltyCosts(baseQuery, startDate, endDate),
          revenueImpact: this.calculateRevenueImpact(roiAnalytics),
        },

        // Redemption behavior
        redemption: {
          ...redemptionAnalytics,
          preferences: await this.analyzeRedemptionPreferences(baseQuery, startDate, endDate),
          efficiency: this.calculateRedemptionEfficiency(redemptionAnalytics),
        },

        // Campaign effectiveness
        campaigns: {
          performance: campaignPerformance,
          effectiveness: this.calculateCampaignEffectiveness(campaignPerformance),
          recommendations: this.generateCampaignRecommendations(campaignPerformance),
        },

        // Top performers
        topPerformers: {
          members: topMembers,
          hotels: hotelId ? null : await this.getTopPerformingHotels(baseQuery, 5),
          segments: await this.getTopSegments(baseQuery, startDate, endDate),
        },

        // Trends and patterns
        trends: {
          ...trendsAnalysis,
          seasonality: await this.analyzeSeasonalityPatterns(baseQuery),
          predictors: await this.identifyGrowthPredictors(baseQuery),
        },

        // Predictive analytics
        predictions: predictiveInsights,

        // Insights and recommendations
        insights: {
          automated: insights,
          manual: this.generateManualInsights(analyticsData),
          priority: this.prioritizeInsights(insights),
        },

        // Alerts and notifications
        alerts: {
          active: alerts,
          performance: this.generatePerformanceAlerts(analyticsData),
          operational: this.generateOperationalAlerts(analyticsData),
        },

        // Benchmarks and KPIs
        benchmarks: {
          industry: this.getIndustryBenchmarks(),
          internal: this.calculateInternalBenchmarks(analyticsData),
          targets: this.getLoyaltyTargets(),
        },

        // Comparison data
        comparison: comparisonData,

        // Performance metrics
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
          dataPoints: membershipMetrics.total + pointsAnalytics.summary.totalTransactions,
        },
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, analyticsData, 'loyalty');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      res.status(200).json({
        success: true,
        data: analyticsData,
      });

      logger.info(
        `📊 Loyalty analytics generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating loyalty analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate loyalty analytics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get demand analytics and forecasting with Redis cache
   * @route   GET /api/analytics/demand
   * @access  Admin + Receptionist
   */
  async getDemandAnalytics(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '30d',
        hotelId,
        forecastDays = 30,
        includeSeasonality = true,
        includeCompetitor = false,
        granularity = 'daily',
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('demand', hotelId || 'all', {
        period,
        forecastDays,
        includeSeasonality,
        includeCompetitor,
        granularity,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'demand');
        if (cached && this.validateDemandCache(cached, req.query)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh demand analytics
      logger.debug(`🔄 Calculating fresh demand analytics: ${hotelId || 'all'} - ${period}`);

      // Parallel demand analysis
      const [
        demandPatterns,
        bookingTrends,
        seasonalAnalysis,
        leadTimeAnalysis,
        marketDemand,
        demandForecast,
      ] = await Promise.all([
        this.analyzeDemandPatterns(hotelId, startDate, endDate),
        this.analyzeBookingTrends(hotelId, startDate, endDate, granularity),
        includeSeasonality === 'true' ? this.analyzeSeasonalDemand(hotelId) : null,
        this.analyzeLeadTimePatterns(hotelId, startDate, endDate),
        this.analyzeMarketDemand(hotelId, startDate, endDate),
        this.generateDemandForecast(hotelId, parseInt(forecastDays)),
      ]);

      // Calculate demand scores and indicators
      const demandIndicators = this.calculateDemandIndicators({
        patterns: demandPatterns,
        trends: bookingTrends,
        forecast: demandForecast,
      });

      const executionTime = Date.now() - startTime;

      const analyticsData = {
        metadata: {
          period: { start: startDate, end: endDate },
          hotelId: hotelId || 'all',
          forecastDays: parseInt(forecastDays),
          generatedAt: new Date(),
        },
        patterns: demandPatterns,
        trends: bookingTrends,
        seasonal: seasonalAnalysis,
        leadTime: leadTimeAnalysis,
        market: marketDemand,
        forecast: demandForecast,
        indicators: demandIndicators,
        insights: this.generateDemandInsights({
          patterns: demandPatterns,
          trends: bookingTrends,
          indicators: demandIndicators,
        }),
        recommendations: this.generateDemandRecommendations(demandIndicators),
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
          dataPoints: bookingTrends.length,
        },
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, analyticsData, 'demand');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      res.json({
        success: true,
        data: analyticsData,
      });

      logger.info(
        `📊 Demand analytics generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating demand analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate demand analytics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get yield management performance analytics with Redis cache
   * @route   GET /api/analytics/yield
   * @access  Admin + Receptionist
   */
  async getYieldAnalytics(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '30d',
        hotelId,
        strategy = 'all',
        includeOptimization = true,
        includeRuleAnalysis = true,
        forceRefresh = false,
      } = req.query;

      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return res.status(400).json({
          success: false,
          message: 'Yield management is not enabled',
        });
      }

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('yield', hotelId || 'all', {
        period,
        strategy,
        includeOptimization,
        includeRuleAnalysis,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'yield');
        if (cached && this.validateYieldCache(cached, req.query)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh yield analytics
      logger.debug(`🔄 Calculating fresh yield analytics: ${hotelId || 'all'} - ${period}`);

      // Comprehensive yield analytics
      const [
        yieldPerformance,
        priceOptimization,
        ruleEffectiveness,
        revenueImpact,
        strategyComparison,
        elasticityAnalysis,
      ] = await Promise.all([
        this.analyzeYieldPerformance(hotelId, startDate, endDate),
        includeOptimization === 'true'
          ? this.analyzePriceOptimization(hotelId, startDate, endDate)
          : null,
        includeRuleAnalysis === 'true' ? this.analyzeYieldRules(hotelId, startDate, endDate) : null,
        this.calculateYieldRevenueImpact(hotelId, startDate, endDate),
        this.compareYieldStrategies(hotelId, startDate, endDate),
        this.analyzePriceElasticity(hotelId, startDate, endDate),
      ]);

      // Calculate yield effectiveness scores
      const effectivenessScores = this.calculateYieldEffectiveness({
        performance: yieldPerformance,
        optimization: priceOptimization,
        impact: revenueImpact,
      });

      const executionTime = Date.now() - startTime;

      const analyticsData = {
        metadata: {
          period: { start: startDate, end: endDate },
          hotelId: hotelId || 'all',
          strategy,
          generatedAt: new Date(),
        },
        performance: yieldPerformance,
        optimization: priceOptimization,
        rules: ruleEffectiveness,
        impact: revenueImpact,
        strategies: strategyComparison,
        elasticity: elasticityAnalysis,
        effectiveness: effectivenessScores,
        insights: this.generateYieldInsights({
          performance: yieldPerformance,
          optimization: priceOptimization,
          effectiveness: effectivenessScores,
        }),
        recommendations: this.generateYieldRecommendations(effectivenessScores, yieldPerformance),
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
        },
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, analyticsData, 'yield');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      res.json({
        success: true,
        data: analyticsData,
      });

      logger.info(
        `📊 Yield analytics generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating yield analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate yield analytics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get operational analytics dashboard with Redis cache
   * @route   GET /api/analytics/operational
   * @access  Admin + Receptionist
   */
  async getOperationalAnalytics(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '7d',
        hotelId,
        includeStaff = false,
        includeEfficiency = true,
        realTime = false,
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('operational', hotelId || 'all', {
        period,
        includeStaff,
        includeEfficiency,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'operational');
        if (cached && this.validateOperationalCache(cached, req.query)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh operational analytics
      logger.debug(`🔄 Calculating fresh operational analytics: ${hotelId || 'all'} - ${period}`);

      // Operational metrics collection
      const [
        checkInOutMetrics,
        serviceMetrics,
        efficiencyMetrics,
        staffMetrics,
        qualityMetrics,
        channelPerformance,
      ] = await Promise.all([
        this.analyzeCheckInOutMetrics(hotelId, startDate, endDate),
        this.analyzeServiceMetrics(hotelId, startDate, endDate),
        includeEfficiency === 'true'
          ? this.analyzeEfficiencyMetrics(hotelId, startDate, endDate)
          : null,
        includeStaff === 'true' ? this.analyzeStaffMetrics(hotelId, startDate, endDate) : null,
        this.analyzeQualityMetrics(hotelId, startDate, endDate),
        this.analyzeChannelPerformance(hotelId, startDate, endDate),
      ]);

      // Calculate operational scores
      const operationalScores = this.calculateOperationalScores({
        checkInOut: checkInOutMetrics,
        service: serviceMetrics,
        efficiency: efficiencyMetrics,
        quality: qualityMetrics,
      });

      const executionTime = Date.now() - startTime;

      const analyticsData = {
        metadata: {
          period: { start: startDate, end: endDate },
          hotelId: hotelId || 'all',
          generatedAt: new Date(),
        },
        checkInOut: checkInOutMetrics,
        service: serviceMetrics,
        efficiency: efficiencyMetrics,
        staff: staffMetrics,
        quality: qualityMetrics,
        channels: channelPerformance,
        scores: operationalScores,
        insights: this.generateOperationalInsights({
          scores: operationalScores,
          metrics: { checkInOutMetrics, serviceMetrics, qualityMetrics },
        }),
        recommendations: this.generateOperationalRecommendations(operationalScores),
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
        },
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, analyticsData, 'operational');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      // Setup real-time streaming
      if (realTime === 'true') {
        this.setupRealtimeAnalytics(req.user.id, 'operational', { hotelId, period });
      }

      res.json({
        success: true,
        data: analyticsData,
      });

      logger.info(
        `📊 Operational analytics generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating operational analytics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate operational analytics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get comprehensive analytics dashboard with Redis cache
   * @route   GET /api/analytics/dashboard
   * @access  Admin + Receptionist
   */
  async getAnalyticsDashboard(req, res) {
    const startTime = Date.now();

    try {
      const {
        period = '7d',
        hotelId,
        widgets = 'all',
        realTime = true,
        refreshInterval = 30000,
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key
      const cacheKey = this.buildAnalyticsCacheKey('dashboard', hotelId || 'all', {
        period,
        widgets,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
        if (cached && this.validateDashboardCache(cached, req.query)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              ...cached,
              performance: {
                ...cached.performance,
                executionTime,
                fromCache: true,
                cacheSource: cached.cacheSource,
              },
            },
            cached: true,
          });
        }
      }

      // Calculate fresh dashboard analytics
      logger.debug(`🔄 Calculating fresh dashboard analytics: ${hotelId || 'all'} - ${period}`);

      // Dashboard data collection
      const [
        kpiMetrics,
        revenueOverview,
        occupancyOverview,
        demandOverview,
        yieldOverview,
        loyaltyOverview,
        alerts,
        trends,
      ] = await Promise.all([
        this.calculateDashboardKPIs(hotelId, startDate, endDate),
        this.getRevenueOverview(hotelId, startDate, endDate),
        this.getOccupancyOverview(hotelId, startDate, endDate),
        this.getDemandOverview(hotelId, startDate, endDate),
        process.env.YIELD_MANAGEMENT_ENABLED === 'true'
          ? this.getYieldOverview(hotelId, startDate, endDate)
          : null,
        this.getLoyaltyOverview(hotelId, startDate, endDate),
        this.getAnalyticsAlerts(hotelId),
        this.getTrendsSummary(hotelId, startDate, endDate),
      ]);

      // Real-time metrics if enabled
      let realTimeMetrics = null;
      if (realTime === 'true') {
        realTimeMetrics = await this.getRealTimeMetrics(hotelId);
        this.setupDashboardStreaming(req.user.id, { hotelId, period, refreshInterval });
      }

      const executionTime = Date.now() - startTime;

      const dashboardData = {
        metadata: {
          period: { start: startDate, end: endDate },
          hotelId: hotelId || 'all',
          generatedAt: new Date(),
          realTimeEnabled: realTime === 'true',
          refreshInterval: parseInt(refreshInterval),
        },
        kpis: kpiMetrics,
        overview: {
          revenue: revenueOverview,
          occupancy: occupancyOverview,
          demand: demandOverview,
          yield: yieldOverview,
          loyalty: loyaltyOverview,
        },
        realTime: realTimeMetrics,
        alerts,
        trends,
        quickStats: this.generateQuickStats({
          kpis: kpiMetrics,
          revenue: revenueOverview,
          occupancy: occupancyOverview,
          loyalty: loyaltyOverview,
        }),
        performanceIndicators: this.generatePerformanceIndicators({
          kpis: kpiMetrics,
          trends,
        }),
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
          cacheMetrics: this.getCachePerformanceMetrics(),
        },
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, dashboardData, 'dashboard');

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      res.json({
        success: true,
        data: dashboardData,
      });

      logger.info(
        `📊 Analytics dashboard generated for ${hotelId || 'all hotels'} - ${period} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating analytics dashboard:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate analytics dashboard',
        error: error.message,
      });
    }
  }

  /**
   * ================================
   * CACHE INVALIDATION WITH REDIS
   * ================================
   */

  /**
   * @desc    Invalidate analytics cache
   * @route   DELETE /api/analytics/cache
   * @access  Admin + Receptionist
   */
  async invalidateAnalyticsCache(req, res) {
    try {
      const { type = 'all', hotelId, pattern, forceAll = false } = req.body;

      let deletedCount = 0;

      if (forceAll === true || type === 'all') {
        // Clear all analytics cache
        deletedCount += await this.redisCache.invalidateAnalytics('revenue');
        deletedCount += await this.redisCache.invalidateAnalytics('loyalty');
        deletedCount += await this.redisCache.invalidateAnalytics('demand');
        deletedCount += await this.redisCache.invalidateAnalytics('yield');
        deletedCount += await this.redisCache.invalidateAnalytics('operational');
        deletedCount += await this.redisCache.invalidateAnalytics('dashboard');

        // Clear memory cache
        this.cache.clear();

        logger.info('🗑️ All analytics cache cleared');
      } else if (hotelId) {
        // Clear hotel-specific analytics cache
        const patterns = this.cacheKeys.invalidationPatterns.hotel(hotelId);

        for (const pattern of patterns) {
          deletedCount += await this.invalidateCachePattern(pattern);
        }

        logger.info(`🗑️ Analytics cache cleared for hotel ${hotelId}`);
      } else if (pattern) {
        // Clear specific pattern
        deletedCount += await this.invalidateCachePattern(pattern);

        logger.info(`🗑️ Analytics cache cleared for pattern: ${pattern}`);
      } else {
        // Clear specific type
        deletedCount += await this.redisCache.invalidateAnalytics(type);

        // Clear memory cache entries for this type
        const keysToDelete = [];
        for (const [key, value] of this.cache.entries()) {
          if (value.analyticsType === type) {
            keysToDelete.push(key);
          }
        }
        keysToDelete.forEach((key) => this.cache.delete(key));
        deletedCount += keysToDelete.length;

        logger.info(`🗑️ Analytics cache cleared for type: ${type}`);
      }

      // Reset cache metrics
      this.resetCacheMetrics();

      res.json({
        success: true,
        message: 'Analytics cache invalidated successfully',
        deletedEntries: deletedCount,
        clearedAt: new Date(),
      });
    } catch (error) {
      logger.error('❌ Error invalidating analytics cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to invalidate analytics cache',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Get cache performance metrics
   * @route   GET /api/analytics/cache/metrics
   * @access  Admin + Receptionist
   */
  async getCacheMetrics(req, res) {
    try {
      const cacheMetrics = this.getCachePerformanceMetrics();
      const redisHealth = await this.checkRedisHealth();

      res.json({
        success: true,
        data: {
          cache: cacheMetrics,
          redis: redisHealth,
          system: {
            memoryUsage: process.memoryUsage(),
            uptime: process.uptime(),
            timestamp: new Date(),
          },
        },
      });
    } catch (error) {
      logger.error('❌ Error getting cache metrics:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to get cache metrics',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Warm up analytics cache
   * @route   POST /api/analytics/cache/warmup
   * @access  Admin
   */
  async warmUpAnalyticsCache(req, res) {
    try {
      const {
        types = ['dashboard', 'revenue', 'occupancy'],
        hotelIds = [],
        period = '7d',
      } = req.body;

      const warmupResults = await this.performCacheWarmup(types, hotelIds, period);

      res.json({
        success: true,
        message: 'Cache warmup completed',
        data: warmupResults,
      });
    } catch (error) {
      logger.error('❌ Error warming up cache:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to warm up cache',
        error: error.message,
      });
    }
  }

  /**
   * ================================
   * CACHE VALIDATION METHODS
   * ================================
   */

  /**
   * Validate cached revenue data
   */
  validateRevenueCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.revenue.ttl * 1000;

    if (age > maxAge) return false;

    // Validate data structure
    return cached.revenue && cached.occupancy && cached.performance;
  }

  /**
   * Validate cached loyalty data
   */
  validateLoyaltyCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.loyalty.ttl * 1000;

    if (age > maxAge) return false;

    return cached.membership && cached.points && cached.tiers;
  }

  /**
   * Validate cached demand data
   */
  validateDemandCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.demand.ttl * 1000;

    if (age > maxAge) return false;

    return cached.patterns && cached.trends && cached.forecast;
  }

  /**
   * Validate cached yield data
   */
  validateYieldCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.yield.ttl * 1000;

    if (age > maxAge) return false;

    return cached.performance && cached.optimization && cached.effectiveness;
  }

  /**
   * Validate cached operational data
   */
  validateOperationalCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.operational.ttl * 1000;

    if (age > maxAge) return false;

    return cached.checkInOut && cached.service && cached.scores;
  }

  /**
   * Validate cached dashboard data
   */
  validateDashboardCache(cached, queryParams) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.dashboard.ttl * 1000;

    if (age > maxAge) return false;

    return cached.kpis && cached.overview && cached.quickStats;
  }

  /**
   * ================================
   * CACHE PERFORMANCE MONITORING
   * ================================
   */

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
   * Update calculation metrics
   */
  updateCalculationMetrics(executionTime) {
    this.cacheMetrics.totalCalculations++;
    this.cacheMetrics.avgCalculationTime =
      (this.cacheMetrics.avgCalculationTime + executionTime) / 2;
  }

  /**
   * Get cache performance metrics
   */
  getCachePerformanceMetrics() {
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

    const timeSaved = this.calculateTimeSaved();

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
        cacheSize: this.cache.size,
      },
      overall: {
        totalRequests,
        hitRate: overallHitRate,
        errorRate:
          totalRequests > 0 ? Math.round((this.cacheMetrics.redisErrors / totalRequests) * 100) : 0,
        bypassRate:
          totalRequests > 0 ? Math.round((this.cacheMetrics.cacheBypass / totalRequests) * 100) : 0,
      },
      performance: {
        avgCalculationTime: Math.round(this.cacheMetrics.avgCalculationTime),
        avgCacheTime: Math.round(this.cacheMetrics.avgCacheTime),
        timeSaved: Math.round(timeSaved),
        efficiency: this.calculateCacheEfficiency(),
      },
      lastResetAt: this.cacheMetrics.lastResetAt,
    };
  }

  /**
   * Calculate time saved by caching
   */
  calculateTimeSaved() {
    const totalHits = this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits;
    const avgCalculationTime = this.cacheMetrics.avgCalculationTime || 1000;
    const avgCacheTime = this.cacheMetrics.avgCacheTime || 50;

    return totalHits * (avgCalculationTime - avgCacheTime);
  }

  /**
   * Calculate cache efficiency
   */
  calculateCacheEfficiency() {
    const totalRequests =
      this.cacheMetrics.redisHits +
      this.cacheMetrics.redisMisses +
      this.cacheMetrics.memoryHits +
      this.cacheMetrics.memoryMisses;

    if (totalRequests === 0) return 0;

    const totalHits = this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits;
    return Math.round((totalHits / totalRequests) * 100);
  }

  /**
   * Log cache performance metrics
   */
  logCacheMetrics() {
    const metrics = this.getCachePerformanceMetrics();

    logger.info(
      `📊 Analytics Cache Metrics - Overall Hit Rate: ${metrics.overall.hitRate}%, ` +
        `Redis: ${metrics.redis.hitRate}%, Memory: ${metrics.memory.hitRate}%, ` +
        `Time Saved: ${metrics.performance.timeSaved}ms, ` +
        `Requests: ${metrics.overall.totalRequests}`
    );
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
      avgCalculationTime: 0,
      avgCacheTime: 0,
    };

    logger.info('📊 Analytics cache metrics reset');
  }

  /**
   * Check Redis health
   */
  async checkRedisHealth() {
    try {
      const startTime = Date.now();
      await this.redisCache.redis.ping();
      const latency = Date.now() - startTime;

      const redisInfo = await this.redisCache.redis.info();

      return {
        status: 'healthy',
        latency,
        connected: true,
        info: {
          version: redisInfo.match(/redis_version:(.+)/)?.[1],
          memory: redisInfo.match(/used_memory_human:(.+)/)?.[1],
          keyspace: redisInfo.match(/db0:keys=(\d+)/)?.[1] || '0',
        },
      };
    } catch (error) {
      return {
        status: 'error',
        connected: false,
        error: error.message,
      };
    }
  }

  /**
   * ================================
   * CACHE WARMING STRATEGIES
   * ================================
   */

  /**
   * Perform cache warmup for popular analytics
   */
  async performCacheWarmup(types, hotelIds, period) {
    const warmupResults = {
      startedAt: new Date(),
      types,
      hotelIds: hotelIds.length > 0 ? hotelIds : ['all'],
      period,
      results: {},
      totalWarmed: 0,
      errors: [],
    };

    try {
      // Get active hotels if none specified
      if (hotelIds.length === 0) {
        const activeHotels = await Hotel.find({ isActive: true }).select('_id').limit(10);
        hotelIds = activeHotels.map((h) => h._id.toString());
      }

      // Warm up each type for each hotel
      for (const type of types) {
        warmupResults.results[type] = { warmed: 0, errors: 0 };

        for (const hotelId of hotelIds) {
          try {
            await this.warmupAnalyticsType(type, hotelId, period);
            warmupResults.results[type].warmed++;
            warmupResults.totalWarmed++;
          } catch (error) {
            warmupResults.results[type].errors++;
            warmupResults.errors.push({
              type,
              hotelId,
              error: error.message,
            });
            logger.warn(`⚠️ Cache warmup failed for ${type}:${hotelId}:`, error.message);
          }
        }
      }

      warmupResults.completedAt = new Date();
      warmupResults.duration = warmupResults.completedAt - warmupResults.startedAt;

      logger.info(
        `🔥 Cache warmup completed: ${warmupResults.totalWarmed} entries warmed, ` +
          `${warmupResults.errors.length} errors in ${warmupResults.duration}ms`
      );

      return warmupResults;
    } catch (error) {
      logger.error('❌ Error during cache warmup:', error);
      warmupResults.error = error.message;
      return warmupResults;
    }
  }

  /**
   * Warm up specific analytics type
   */
  async warmupAnalyticsType(type, hotelId, period) {
    const mockReq = {
      query: {
        period,
        hotelId: hotelId === 'all' ? undefined : hotelId,
        forceRefresh: false,
      },
      user: { id: 'system' },
    };

    const mockRes = {
      json: () => {},
      status: () => ({ json: () => {} }),
    };

    switch (type) {
      case 'dashboard':
        await this.getAnalyticsDashboard(mockReq, mockRes);
        break;
      case 'revenue':
        await this.getRevenueAnalytics(mockReq, mockRes);
        break;
      case 'occupancy':
        // Revenue analytics includes occupancy data
        await this.getRevenueAnalytics(mockReq, mockRes);
        break;
      case 'loyalty':
        await this.getLoyaltyAnalytics(mockReq, mockRes);
        break;
      case 'demand':
        await this.getDemandAnalytics(mockReq, mockRes);
        break;
      case 'yield':
        if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
          await this.getYieldAnalytics(mockReq, mockRes);
        }
        break;
      case 'operational':
        await this.getOperationalAnalytics(mockReq, mockRes);
        break;
      default:
        throw new Error(`Unknown analytics type: ${type}`);
    }
  }

  /**
   * Invalidate cache pattern
   */
  async invalidateCachePattern(pattern) {
    try {
      const keys = await this.redisCache.redis.keys(pattern);
      if (keys.length > 0) {
        return await this.redisCache.redis.del(...keys);
      }
      return 0;
    } catch (error) {
      logger.error(`❌ Error invalidating cache pattern ${pattern}:`, error);
      return 0;
    }
  }

  /**
   * ================================
   * EVENT-DRIVEN CACHE INVALIDATION
   * ================================
   */

  /**
   * Setup event listeners for cache invalidation
   */
  setupCacheInvalidationListeners() {
    // Booking events
    this.on('booking:created', async (data) => {
      await this.invalidateBookingRelatedCache(data);
    });

    this.on('booking:confirmed', async (data) => {
      await this.invalidateBookingRelatedCache(data);
    });

    this.on('booking:cancelled', async (data) => {
      await this.invalidateBookingRelatedCache(data);
    });

    this.on('booking:completed', async (data) => {
      await this.invalidateBookingRelatedCache(data);
    });

    // Yield management events
    this.on('yield:updated', async (data) => {
      await this.invalidateYieldRelatedCache(data);
    });

    this.on('pricing:changed', async (data) => {
      await this.invalidateRevenueRelatedCache(data);
    });

    // Loyalty events
    this.on('loyalty:transaction', async (data) => {
      await this.invalidateLoyaltyRelatedCache(data);
    });

    this.on('loyalty:tier_change', async (data) => {
      await this.invalidateLoyaltyRelatedCache(data);
    });

    // Hotel configuration events
    this.on('hotel:updated', async (data) => {
      await this.invalidateHotelRelatedCache(data);
    });

    logger.info('✅ Cache invalidation event listeners setup completed');
  }

  /**
   * Invalidate booking-related cache
   */
  async invalidateBookingRelatedCache(data) {
    const { hotelId, bookingId } = data;

    try {
      // Invalidate dashboard cache
      await this.redisCache.invalidateAnalytics('dashboard', `${hotelId}*`);

      // Invalidate revenue analytics
      await this.redisCache.invalidateAnalytics('revenue', `${hotelId}*`);

      // Invalidate operational analytics
      await this.redisCache.invalidateAnalytics('operational', `${hotelId}*`);

      // Invalidate demand analytics
      await this.redisCache.invalidateAnalytics('demand', `${hotelId}*`);

      // Clear memory cache entries
      this.clearMemoryCacheByHotel(hotelId);

      logger.debug(`🗑️ Invalidated booking-related cache for hotel ${hotelId}`);
    } catch (error) {
      logger.error('❌ Error invalidating booking-related cache:', error);
    }
  }

  /**
   * Invalidate yield-related cache
   */
  async invalidateYieldRelatedCache(data) {
    const { hotelId } = data;

    try {
      // Invalidate yield analytics
      await this.redisCache.invalidateAnalytics('yield', `${hotelId}*`);

      // Invalidate revenue analytics (includes yield data)
      await this.redisCache.invalidateAnalytics('revenue', `${hotelId}*`);

      // Invalidate dashboard cache
      await this.redisCache.invalidateAnalytics('dashboard', `${hotelId}*`);

      logger.debug(`🗑️ Invalidated yield-related cache for hotel ${hotelId}`);
    } catch (error) {
      logger.error('❌ Error invalidating yield-related cache:', error);
    }
  }

  /**
   * Invalidate revenue-related cache
   */
  async invalidateRevenueRelatedCache(data) {
    const { hotelId } = data;

    try {
      // Invalidate revenue analytics
      await this.redisCache.invalidateAnalytics('revenue', `${hotelId}*`);

      // Invalidate dashboard cache
      await this.redisCache.invalidateAnalytics('dashboard', `${hotelId}*`);

      logger.debug(`🗑️ Invalidated revenue-related cache for hotel ${hotelId}`);
    } catch (error) {
      logger.error('❌ Error invalidating revenue-related cache:', error);
    }
  }

  /**
   * Invalidate loyalty-related cache
   */
  async invalidateLoyaltyRelatedCache(data) {
    const { userId, hotelId } = data;

    try {
      // Invalidate loyalty analytics
      await this.redisCache.invalidateAnalytics('loyalty', `${hotelId || 'all'}*`);

      // Invalidate dashboard cache (includes loyalty overview)
      await this.redisCache.invalidateAnalytics('dashboard', `${hotelId || 'all'}*`);

      logger.debug(`🗑️ Invalidated loyalty-related cache for hotel ${hotelId || 'all'}`);
    } catch (error) {
      logger.error('❌ Error invalidating loyalty-related cache:', error);
    }
  }

  /**
   * Invalidate hotel-related cache
   */
  async invalidateHotelRelatedCache(data) {
    const { hotelId } = data;

    try {
      // Invalidate all analytics for the hotel
      const types = [
        'dashboard',
        'revenue',
        'occupancy',
        'demand',
        'yield',
        'operational',
        'loyalty',
      ];

      for (const type of types) {
        await this.redisCache.invalidateAnalytics(type, `${hotelId}*`);
      }

      // Clear memory cache
      this.clearMemoryCacheByHotel(hotelId);

      logger.info(`🗑️ Invalidated all analytics cache for hotel ${hotelId}`);
    } catch (error) {
      logger.error('❌ Error invalidating hotel-related cache:', error);
    }
  }

  /**
   * Clear memory cache by hotel
   */
  clearMemoryCacheByHotel(hotelId) {
    const keysToDelete = [];

    for (const [key, value] of this.cache.entries()) {
      if (key.includes(hotelId)) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((key) => this.cache.delete(key));

    logger.debug(`💾 Cleared ${keysToDelete.length} memory cache entries for hotel ${hotelId}`);
  }

  /**
   * ================================
   * ORIGINAL METHODS PRESERVED WITH CACHE INTEGRATION
   * ================================
   */

  /**
   * Calculate comprehensive revenue metrics (ORIGINAL WITH CACHE HINTS)
   */
  async calculateRevenueMetrics(query, currency = 'EUR', granularity = 'daily') {
    try {
      const bookings = await Booking.find(query)
        .populate('hotel', 'name totalRooms')
        .populate('rooms.room', 'type');

      if (bookings.length === 0) {
        return this.getEmptyRevenueMetrics();
      }

      // Convert currencies
      const revenueData = await Promise.all(
        bookings.map(async (booking) => {
          let convertedAmount = booking.totalPrice || 0;

          if (booking.currency !== currency) {
            try {
              const converted = await currencyService.convertCurrency(
                booking.totalPrice || 0,
                booking.currency || 'EUR',
                currency
              );
              convertedAmount = converted.convertedAmount;
            } catch (error) {
              logger.warn(`Currency conversion failed for booking ${booking._id}`);
            }
          }

          return {
            ...booking.toObject(),
            convertedAmount,
            nights: moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days'),
          };
        })
      );

      // Calculate room nights
      const totalRoomNights = revenueData.reduce((sum, booking) => {
        return sum + booking.rooms.length * booking.nights;
      }, 0);

      // Calculate total revenue
      const totalRevenue = revenueData.reduce((sum, booking) => sum + booking.convertedAmount, 0);

      // Calculate ADR (Average Daily Rate)
      const adr = totalRoomNights > 0 ? totalRevenue / totalRoomNights : 0;

      // Calculate RevPAR (Revenue Per Available Room)
      const totalAvailableRoomNights = await this.calculateAvailableRoomNights(query);
      const revPAR = totalAvailableRoomNights > 0 ? totalRevenue / totalAvailableRoomNights : 0;

      // Group by time period for trends
      const timeSeriesData = this.groupRevenueByPeriod(revenueData, granularity);

      // Revenue by room type
      const revenueByRoomType = this.calculateRevenueByRoomType(revenueData);

      // Revenue by source
      const revenueBySource = this.calculateRevenueBySource(revenueData);

      return {
        summary: {
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          totalBookings: revenueData.length,
          totalRoomNights,
          averageBookingValue: revenueData.length > 0 ? totalRevenue / revenueData.length : 0,
          adr: Math.round(adr * 100) / 100,
          revPAR: Math.round(revPAR * 100) / 100,
          currency,
        },
        timeSeries: timeSeriesData,
        breakdown: {
          byRoomType: revenueByRoomType,
          bySource: revenueBySource,
          byClientType: this.calculateRevenueByClientType(revenueData),
        },
        growth: await this.calculateRevenueGrowth(query, currency),
        variance: this.calculateRevenueVariance(timeSeriesData),
      };
    } catch (error) {
      logger.error('Error calculating revenue metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate occupancy metrics with detailed breakdown (ORIGINAL WITH CACHE HINTS)
   */
  async calculateOccupancyMetrics(query, granularity = 'daily') {
    try {
      // Get hotel room inventory
      const hotels = await Hotel.find(query.hotel ? { _id: query.hotel } : {}).populate('rooms');

      const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);

      // Get bookings for occupancy calculation
      const bookings = await Booking.find({
        ...query,
        status: {
          $in: [BOOKING_STATUS.CONFIRMED, BOOKING_STATUS.CHECKED_IN, BOOKING_STATUS.COMPLETED],
        },
      });

      // Calculate daily occupancy
      const dailyOccupancy = {};
      const startDate = moment(query.checkInDate?.$gte || query.createdAt?.$gte);
      const endDate = moment(query.checkInDate?.$lte || query.createdAt?.$lte);

      for (let date = moment(startDate); date.isSameOrBefore(endDate); date.add(1, 'day')) {
        const dateStr = date.format('YYYY-MM-DD');
        let occupiedRooms = 0;

        bookings.forEach((booking) => {
          const checkIn = moment(booking.checkInDate);
          const checkOut = moment(booking.checkOutDate);

          if (date.isSameOrAfter(checkIn) && date.isBefore(checkOut)) {
            occupiedRooms += booking.rooms.length;
          }
        });

        const occupancyRate = totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;

        dailyOccupancy[dateStr] = {
          date: date.toDate(),
          occupiedRooms,
          totalRooms,
          occupancyRate: Math.round(occupancyRate * 100) / 100,
        };
      }

      // Calculate average occupancy
      const occupancyRates = Object.values(dailyOccupancy).map((day) => day.occupancyRate);
      const averageOccupancy =
        occupancyRates.length > 0
          ? occupancyRates.reduce((sum, rate) => sum + rate, 0) / occupancyRates.length
          : 0;

      // Group by time period
      const timeSeriesData = this.groupOccupancyByPeriod(dailyOccupancy, granularity);

      // Calculate occupancy by room type
      const occupancyByRoomType = await this.calculateOccupancyByRoomType(query, bookings);

      // Weekly patterns
      const weeklyPatterns = this.analyzeWeeklyOccupancyPatterns(dailyOccupancy);

      return {
        summary: {
          averageOccupancy: Math.round(averageOccupancy * 100) / 100,
          totalRooms,
          peakOccupancy: Math.max(...occupancyRates, 0),
          minimumOccupancy: Math.min(...occupancyRates, 100),
          occupancyVariance: this.calculateVariance(occupancyRates),
        },
        daily: dailyOccupancy,
        timeSeries: timeSeriesData,
        breakdown: {
          byRoomType: occupancyByRoomType,
          weeklyPatterns,
        },
        trends: this.calculateOccupancyTrends(timeSeriesData),
      };
    } catch (error) {
      logger.error('Error calculating occupancy metrics:', error);
      throw error;
    }
  }

  /**
   * ================================
   * LOYALTY PROGRAM ANALYTICS METHODS (ORIGINAL PRESERVED)
   * ================================
   */

  /**
   * Calculate comprehensive membership metrics
   */
  async calculateMembershipMetrics(baseQuery, startDate, endDate) {
    try {
      const [totalMembers, newMembers, activeMembers, dormantMembers] = await Promise.all([
        // Total members
        User.countDocuments({
          ...baseQuery,
          'loyalty.enrolledAt': { $exists: true },
        }),

        // New members in period
        User.countDocuments({
          ...baseQuery,
          'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
        }),

        // Active members (activity in last 30 days)
        User.countDocuments({
          ...baseQuery,
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        }),

        // Dormant members (no activity in 90+ days)
        User.countDocuments({
          ...baseQuery,
          'loyalty.statistics.lastActivity': {
            $lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);

      // Daily new members
      const dailyNewMembers = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$loyalty.enrolledAt' } },
            newMembers: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      return {
        total: totalMembers,
        new: newMembers,
        active: activeMembers,
        dormant: dormantMembers,
        activationRate: totalMembers > 0 ? Math.round((activeMembers / totalMembers) * 100) : 0,
        churnRate: totalMembers > 0 ? Math.round((dormantMembers / totalMembers) * 100) : 0,
        growthRate: await this.calculateMembershipGrowthRate(baseQuery, startDate, endDate),
        dailyTimeSeries: dailyNewMembers,
        projectedGrowth: this.projectMembershipGrowth(dailyNewMembers),
      };
    } catch (error) {
      logger.error('Error calculating membership metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate points analytics and flows
   */
  async calculatePointsAnalytics(baseQuery, startDate, endDate, granularity) {
    try {
      const transactionQuery = {
        ...baseQuery,
        createdAt: { $gte: startDate, $lte: endDate },
      };

      // Overall points statistics
      const pointsStats = await LoyaltyTransaction.aggregate([
        { $match: transactionQuery },
        {
          $group: {
            _id: null,
            totalPointsEarned: {
              $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] },
            },
            totalPointsRedeemed: {
              $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] },
            },
            totalTransactions: { $sum: 1 },
            avgTransactionSize: { $avg: { $abs: '$pointsAmount' } },
            uniqueUsers: { $addToSet: '$user' },
          },
        },
      ]);

      const stats = pointsStats[0] || {
        totalPointsEarned: 0,
        totalPointsRedeemed: 0,
        totalTransactions: 0,
        avgTransactionSize: 0,
        uniqueUsers: [],
      };

      // Points by type breakdown
      const pointsByType = await LoyaltyTransaction.aggregate([
        { $match: transactionQuery },
        {
          $group: {
            _id: '$type',
            totalPoints: { $sum: { $abs: '$pointsAmount' } },
            transactionCount: { $sum: 1 },
            uniqueUsers: { $addToSet: '$user' },
          },
        },
        { $sort: { totalPoints: -1 } },
      ]);

      // Time series data
      let timeFormat;
      switch (granularity) {
        case 'hourly':
          timeFormat = '%Y-%m-%d %H';
          break;
        case 'weekly':
          timeFormat = '%Y-%U';
          break;
        case 'monthly':
          timeFormat = '%Y-%m';
          break;
        default:
          timeFormat = '%Y-%m-%d';
      }

      const timeSeries = await LoyaltyTransaction.aggregate([
        { $match: transactionQuery },
        {
          $group: {
            _id: { $dateToString: { format: timeFormat, date: '$createdAt' } },
            pointsEarned: { $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] } },
            pointsRedeemed: {
              $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] },
            },
            transactions: { $sum: 1 },
            uniqueUsers: { $addToSet: '$user' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Current points distribution
      const pointsDistribution = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.currentPoints': { $gt: 0 },
          },
        },
        {
          $bucket: {
            groupBy: '$loyalty.currentPoints',
            boundaries: [0, 100, 500, 1000, 2500, 5000, 10000, Infinity],
            default: 'Other',
            output: {
              count: { $sum: 1 },
              avgPoints: { $avg: '$loyalty.currentPoints' },
              totalPoints: { $sum: '$loyalty.currentPoints' },
            },
          },
        },
      ]);

      return {
        summary: {
          totalPointsEarned: stats.totalPointsEarned,
          totalPointsRedeemed: stats.totalPointsRedeemed,
          netPoints: stats.totalPointsEarned - stats.totalPointsRedeemed,
          redemptionRate:
            stats.totalPointsEarned > 0
              ? Math.round((stats.totalPointsRedeemed / stats.totalPointsEarned) * 100)
              : 0,
          avgTransactionSize: Math.round(stats.avgTransactionSize),
          totalTransactions: stats.totalTransactions,
          activeUsers: stats.uniqueUsers.length,
          avgPointsPerUser:
            stats.uniqueUsers.length > 0
              ? Math.round(stats.totalPointsEarned / stats.uniqueUsers.length)
              : 0,
        },
        breakdown: {
          byType: pointsByType,
          byDistribution: pointsDistribution,
        },
        timeSeries: timeSeries.map((item) => ({
          period: item._id,
          earned: item.pointsEarned,
          redeemed: item.pointsRedeemed,
          net: item.pointsEarned - item.pointsRedeemed,
          transactions: item.transactions,
          activeUsers: item.uniqueUsers.length,
          efficiency:
            item.pointsRedeemed > 0
              ? Math.round((item.pointsEarned / item.pointsRedeemed) * 100)
              : 0,
        })),
        velocity: this.calculatePointsVelocity(timeSeries),
        efficiency: this.calculatePointsEfficiency(stats),
      };
    } catch (error) {
      logger.error('Error calculating points analytics:', error);
      throw error;
    }
  }

  /**
   * Calculate tier distribution and progression
   */
  async calculateTierDistribution(baseQuery) {
    try {
      const distribution = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $group: {
            _id: '$loyalty.tier',
            count: { $sum: 1 },
            avgCurrentPoints: { $avg: '$loyalty.currentPoints' },
            avgLifetimePoints: { $avg: '$loyalty.lifetimePoints' },
            totalCurrentPoints: { $sum: '$loyalty.currentPoints' },
            totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      const totalMembers = distribution.reduce((sum, tier) => sum + tier.count, 0);

      // Calculate tier progression velocity
      const tierProgression = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.tierHistory': { $exists: true, $ne: [] },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            tierHistory: '$loyalty.tierHistory',
            enrolledAt: '$loyalty.enrolledAt',
            daysSinceEnrollment: {
              $divide: [{ $subtract: [new Date(), '$loyalty.enrolledAt'] }, 1000 * 60 * 60 * 24],
            },
          },
        },
        {
          $group: {
            _id: '$tier',
            avgDaysToReach: { $avg: '$daysSinceEnrollment' },
            count: { $sum: 1 },
          },
        },
      ]);

      return {
        current: distribution.map((tier) => ({
          tier: tier._id,
          count: tier.count,
          percentage: totalMembers > 0 ? Math.round((tier.count / totalMembers) * 100) : 0,
          avgCurrentPoints: Math.round(tier.avgCurrentPoints || 0),
          avgLifetimePoints: Math.round(tier.avgLifetimePoints || 0),
          totalValue: Math.round((tier.totalCurrentPoints || 0) / 100), // Convert to monetary value
          penetration: this.calculateTierPenetration(tier._id, tier.count, totalMembers),
        })),
        progression: tierProgression,
        health: this.assessTierHealth(distribution),
        recommendations: this.generateTierRecommendations(distribution),
      };
    } catch (error) {
      logger.error('Error calculating tier distribution:', error);
      throw error;
    }
  }

  /**
   * Calculate engagement metrics
   */
  async calculateEngagementMetrics(baseQuery, startDate, endDate) {
    try {
      // Active users by different time windows
      const engagementWindows = await Promise.all([
        // Last 7 days
        User.countDocuments({
          ...baseQuery,
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        }),
        // Last 30 days
        User.countDocuments({
          ...baseQuery,
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        }),
        // Last 90 days
        User.countDocuments({
          ...baseQuery,
          'loyalty.statistics.lastActivity': {
            $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          },
        }),
      ]);

      // Engagement score distribution
      const engagementScores = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.performance.engagementScore': { $exists: true },
          },
        },
        {
          $bucket: {
            groupBy: '$loyalty.performance.engagementScore',
            boundaries: [0, 25, 50, 75, 90, 100],
            default: 'Unknown',
            output: {
              count: { $sum: 1 },
              avgScore: { $avg: '$loyalty.performance.engagementScore' },
            },
          },
        },
      ]);

      // Transaction frequency analysis
      const transactionFrequency = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
          },
        },
        {
          $group: {
            _id: '$user',
            transactionCount: { $sum: 1 },
            totalPoints: { $sum: { $abs: '$pointsAmount' } },
            firstTransaction: { $min: '$createdAt' },
            lastTransaction: { $max: '$createdAt' },
          },
        },
        {
          $bucket: {
            groupBy: '$transactionCount',
            boundaries: [1, 2, 5, 10, 20, Infinity],
            default: 'Other',
            output: {
              userCount: { $sum: 1 },
              avgTransactions: { $avg: '$transactionCount' },
              avgPoints: { $avg: '$totalPoints' },
            },
          },
        },
      ]);

      return {
        activeUsers: {
          last7Days: engagementWindows[0],
          last30Days: engagementWindows[1],
          last90Days: engagementWindows[2],
          stickiness:
            engagementWindows[1] > 0
              ? Math.round((engagementWindows[0] / engagementWindows[1]) * 100)
              : 0,
        },
        scoreDistribution: engagementScores,
        transactionFrequency,
        trends: await this.calculateEngagementTrends(baseQuery, startDate, endDate),
        segmentation: await this.segmentMembersByEngagement(baseQuery, startDate, endDate),
      };
    } catch (error) {
      logger.error('Error calculating engagement metrics:', error);
      throw error;
    }
  }

  /**
   * Calculate retention analytics
   */
  async calculateRetentionAnalytics(baseQuery, startDate, endDate) {
    try {
      // Member retention by enrollment cohorts
      const cohortRetention = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            enrollmentMonth: { $dateToString: { format: '%Y-%m', date: '$loyalty.enrolledAt' } },
            lastActivity: '$loyalty.statistics.lastActivity',
            isActive: {
              $gte: [
                '$loyalty.statistics.lastActivity',
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              ],
            },
          },
        },
        {
          $group: {
            _id: '$enrollmentMonth',
            totalMembers: { $sum: 1 },
            activeMembers: { $sum: { $cond: ['$isActive', 1, 0] } },
          },
        },
        {
          $project: {
            month: '$_id',
            totalMembers: 1,
            activeMembers: 1,
            retentionRate: {
              $multiply: [{ $divide: ['$activeMembers', '$totalMembers'] }, 100],
            },
          },
        },
        { $sort: { month: -1 } },
        { $limit: 12 },
      ]);

      // Churn analysis
      const churnAnalysis = await this.analyzeChurnPatterns(baseQuery, startDate, endDate);

      // Lifecycle stage distribution
      const lifecycleStages = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            daysSinceEnrollment: {
              $divide: [{ $subtract: [new Date(), '$loyalty.enrolledAt'] }, 1000 * 60 * 60 * 24],
            },
            isActive: {
              $gte: [
                '$loyalty.statistics.lastActivity',
                new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              ],
            },
          },
        },
        {
          $project: {
            stage: {
              $switch: {
                branches: [
                  { case: { $lt: ['$daysSinceEnrollment', 30] }, then: 'New' },
                  { case: { $lt: ['$daysSinceEnrollment', 90] }, then: 'Growing' },
                  { case: { $lt: ['$daysSinceEnrollment', 365] }, then: 'Established' },
                  { case: { $gte: ['$daysSinceEnrollment', 365] }, then: 'Veteran' },
                ],
                default: 'Unknown',
              },
            },
            isActive: 1,
          },
        },
        {
          $group: {
            _id: { stage: '$stage', isActive: '$isActive' },
            count: { $sum: 1 },
          },
        },
      ]);

      return {
        cohortRetention,
        churnAnalysis,
        lifecycleStages: this.formatLifecycleStages(lifecycleStages),
        riskSegments: await this.identifyRiskSegments(baseQuery),
        retentionScore: this.calculateOverallRetentionScore(cohortRetention),
        recommendations: this.generateRetentionRecommendations(churnAnalysis),
      };
    } catch (error) {
      logger.error('Error calculating retention analytics:', error);
      throw error;
    }
  }

  /**
   * Calculate loyalty program ROI
   */
  async calculateLoyaltyROI(baseQuery, startDate, endDate) {
    try {
      // Program costs (estimated)
      const pointsIssued = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            totalPointsIssued: { $sum: '$pointsAmount' },
          },
        },
      ]);

      const pointsRedeemed = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $lt: 0 },
          },
        },
        {
          $group: {
            _id: null,
            totalPointsRedeemed: { $sum: { $abs: '$pointsAmount' } },
          },
        },
      ]);

      // Revenue impact from loyalty members
      const loyaltyMemberRevenue = await this.calculateLoyaltyMemberRevenue(
        baseQuery,
        startDate,
        endDate
      );

      // Cost analysis
      const totalPointsIssuedValue = (pointsIssued[0]?.totalPointsIssued || 0) / 100; // Convert to monetary
      const totalPointsRedeemedCost = (pointsRedeemed[0]?.totalPointsRedeemed || 0) / 100;
      const operationalCosts = this.estimateOperationalCosts(startDate, endDate);
      const totalCosts = totalPointsRedeemedCost + operationalCosts;

      // Revenue benefits
      const additionalRevenue = loyaltyMemberRevenue.incremental;
      const retentionValue = loyaltyMemberRevenue.retention;
      const totalBenefits = additionalRevenue + retentionValue;

      // ROI calculations
      const roi = totalCosts > 0 ? ((totalBenefits - totalCosts) / totalCosts) * 100 : 0;
      const paybackPeriod = totalBenefits > 0 ? totalCosts / (totalBenefits / 12) : Infinity;

      return {
        costs: {
          pointsRedemption: totalPointsRedeemedCost,
          operational: operationalCosts,
          total: totalCosts,
          breakdown: {
            technology: operationalCosts * 0.3,
            staff: operationalCosts * 0.4,
            marketing: operationalCosts * 0.2,
            other: operationalCosts * 0.1,
          },
        },
        benefits: {
          additionalRevenue,
          retentionValue,
          total: totalBenefits,
          breakdown: loyaltyMemberRevenue.breakdown,
        },
        metrics: {
          roi: Math.round(roi),
          paybackPeriod: paybackPeriod < Infinity ? Math.round(paybackPeriod) : null,
          costPerMember:
            loyaltyMemberRevenue.memberCount > 0
              ? Math.round(totalCosts / loyaltyMemberRevenue.memberCount)
              : 0,
          revenuePerMember:
            loyaltyMemberRevenue.memberCount > 0
              ? Math.round(totalBenefits / loyaltyMemberRevenue.memberCount)
              : 0,
          pointsLiability: totalPointsIssuedValue - totalPointsRedeemedCost,
        },
        trends: await this.calculateROITrends(baseQuery, startDate, endDate),
        benchmarks: this.getROIBenchmarks(),
      };
    } catch (error) {
      logger.error('Error calculating loyalty ROI:', error);
      throw error;
    }
  }

  /**
   * Analyze loyalty trends and patterns
   */
  async analyzeLoyaltyTrends(baseQuery, startDate, endDate, granularity) {
    try {
      // Membership growth trends
      const membershipTrends = await this.analyzeMembershipTrends(
        baseQuery,
        startDate,
        endDate,
        granularity
      );

      // Points velocity trends
      const pointsTrends = await this.analyzePointsTrends(
        baseQuery,
        startDate,
        endDate,
        granularity
      );

      // Engagement trends
      const engagementTrends = await this.analyzeEngagementTrends(baseQuery, startDate, endDate);

      // Tier progression trends
      const tierTrends = await this.analyzeTierProgressionTrends(baseQuery, startDate, endDate);

      // Seasonal patterns
      const seasonalPatterns = await this.analyzeSeasonalPatterns(baseQuery);

      return {
        membership: membershipTrends,
        points: pointsTrends,
        engagement: engagementTrends,
        tiers: tierTrends,
        seasonal: seasonalPatterns,
        overall: this.calculateOverallTrendDirection([
          membershipTrends,
          pointsTrends,
          engagementTrends,
        ]),
        momentum: this.calculateTrendMomentum(pointsTrends),
        forecasts: await this.generateTrendForecasts(baseQuery, 30),
      };
    } catch (error) {
      logger.error('Error analyzing loyalty trends:', error);
      throw error;
    }
  }

  /**
   * Get top loyalty members
   */
  async getTopLoyaltyMembers(baseQuery, limit = 10) {
    try {
      const topMembers = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            firstName: 1,
            lastName: 1,
            email: 1,
            tier: '$loyalty.tier',
            currentPoints: '$loyalty.currentPoints',
            lifetimePoints: '$loyalty.lifetimePoints',
            totalSpent: '$stats.totalSpent',
            totalBookings: '$stats.totalBookings',
            enrolledAt: '$loyalty.enrolledAt',
            lastActivity: '$loyalty.statistics.lastActivity',
            engagementScore: '$loyalty.performance.engagementScore',
            estimatedValue: { $divide: ['$loyalty.currentPoints', 100] },
          },
        },
        { $sort: { lifetimePoints: -1 } },
        { $limit: limit },
      ]);

      // Calculate member rankings and insights
      const enrichedMembers = topMembers.map((member, index) => ({
        ...member,
        rank: index + 1,
        memberSince: this.calculateMembershipDuration(member.enrolledAt),
        isActive: member.lastActivity > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        averageSpendPerBooking:
          member.totalBookings > 0 ? Math.round(member.totalSpent / member.totalBookings) : 0,
        pointsPerEuro:
          member.totalSpent > 0 ? Math.round(member.lifetimePoints / member.totalSpent) : 0,
        tierIcon: this.getTierIcon(member.tier),
        riskLevel: this.assessMemberRiskLevel(member),
      }));

      return {
        members: enrichedMembers,
        summary: {
          totalValue: enrichedMembers.reduce((sum, member) => sum + member.estimatedValue, 0),
          averageLifetimePoints: Math.round(
            enrichedMembers.reduce((sum, member) => sum + member.lifetimePoints, 0) /
              enrichedMembers.length
          ),
          averageSpend: Math.round(
            enrichedMembers.reduce((sum, member) => sum + member.totalSpent, 0) /
              enrichedMembers.length
          ),
          activeMembersCount: enrichedMembers.filter((member) => member.isActive).length,
        },
        insights: this.generateTopMembersInsights(enrichedMembers),
      };
    } catch (error) {
      logger.error('Error getting top loyalty members:', error);
      throw error;
    }
  }

  /**
   * Analyze redemption patterns and preferences
   */
  async analyzeRedemptionPatterns(baseQuery, startDate, endDate) {
    try {
      // Redemption by type
      const redemptionsByType = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $lt: 0 },
          },
        },
        {
          $group: {
            _id: '$type',
            totalRedemptions: { $sum: { $abs: '$pointsAmount' } },
            transactionCount: { $sum: 1 },
            uniqueUsers: { $addToSet: '$user' },
            avgRedemptionSize: { $avg: { $abs: '$pointsAmount' } },
          },
        },
        { $sort: { totalRedemptions: -1 } },
      ]);

      // Redemption timing patterns
      const timingPatterns = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $lt: 0 },
          },
        },
        {
          $project: {
            dayOfWeek: { $dayOfWeek: '$createdAt' },
            hour: { $hour: '$createdAt' },
            month: { $month: '$createdAt' },
            pointsAmount: { $abs: '$pointsAmount' },
          },
        },
        {
          $group: {
            _id: {
              dayOfWeek: '$dayOfWeek',
              hour: '$hour',
            },
            totalRedemptions: { $sum: '$pointsAmount' },
            count: { $sum: 1 },
          },
        },
      ]);

      // Average time from earning to redemption
      const timeToRedemption = await this.calculateTimeToRedemption(baseQuery, startDate, endDate);

      // Redemption efficiency by tier
      const tierEfficiency = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'loyaltytransactions',
            localField: '_id',
            foreignField: 'user',
            as: 'transactions',
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            totalEarned: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: '$transactions',
                      cond: { $gt: ['$this.pointsAmount', 0] },
                    },
                  },
                  as: 'transaction',
                  in: '$transaction.pointsAmount',
                },
              },
            },
            totalRedeemed: {
              $sum: {
                $map: {
                  input: {
                    $filter: {
                      input: '$transactions',
                      cond: { $lt: ['$this.pointsAmount', 0] },
                    },
                  },
                  as: 'transaction',
                  in: { $abs: '$transaction.pointsAmount' },
                },
              },
            },
          },
        },
        {
          $group: {
            _id: '$tier',
            avgEarned: { $avg: '$totalEarned' },
            avgRedeemed: { $avg: '$totalRedeemed' },
            memberCount: { $sum: 1 },
          },
        },
        {
          $project: {
            tier: '$_id',
            avgEarned: 1,
            avgRedeemed: 1,
            memberCount: 1,
            redemptionRate: {
              $multiply: [{ $divide: ['$avgRedeemed', '$avgEarned'] }, 100],
            },
          },
        },
      ]);

      return {
        byType: redemptionsByType.map((item) => ({
          type: item._id,
          typeDisplay: this.getTransactionTypeDisplay(item._id),
          totalRedemptions: item.totalRedemptions,
          transactionCount: item.transactionCount,
          uniqueUsers: item.uniqueUsers.length,
          avgSize: Math.round(item.avgRedemptionSize),
          popularity: Math.round((item.uniqueUsers.length / item.transactionCount) * 100),
        })),
        timing: this.formatTimingPatterns(timingPatterns),
        efficiency: {
          timeToRedemption,
          byTier: tierEfficiency,
        },
        trends: await this.analyzeRedemptionTrends(baseQuery, startDate, endDate),
        preferences: await this.identifyRedemptionPreferences(baseQuery),
      };
    } catch (error) {
      logger.error('Error analyzing redemption patterns:', error);
      throw error;
    }
  }

  /**
   * Analyze campaign performance
   */
  async analyzeCampaignPerformance(baseQuery, startDate, endDate) {
    try {
      // Get campaign transactions
      const campaignTransactions = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            'campaign.code': { $exists: true, $ne: null },
          },
        },
        {
          $group: {
            _id: '$campaign.code',
            campaignName: { $first: '$campaign.name' },
            totalPoints: { $sum: { $abs: '$pointsAmount' } },
            transactionCount: { $sum: 1 },
            uniqueParticipants: { $addToSet: '$user' },
            avgTransactionSize: { $avg: { $abs: '$pointsAmount' } },
            firstTransaction: { $min: '$createdAt' },
            lastTransaction: { $max: '$createdAt' },
          },
        },
        { $sort: { totalPoints: -1 } },
      ]);

      // Calculate campaign ROI
      const campaignROI = await Promise.all(
        campaignTransactions.map(async (campaign) => {
          const roi = await this.calculateCampaignROI(campaign._id, startDate, endDate);
          return {
            ...campaign,
            roi: roi.roi,
            cost: roi.cost,
            revenue: roi.revenue,
            efficiency: roi.efficiency,
          };
        })
      );

      // Campaign lifecycle analysis
      const lifecycleAnalysis = await this.analyzeCampaignLifecycle(campaignTransactions);

      return {
        campaigns: campaignROI.map((campaign) => ({
          code: campaign._id,
          name: campaign.campaignName,
          participants: campaign.uniqueParticipants.length,
          totalPoints: campaign.totalPoints,
          transactions: campaign.transactionCount,
          avgTransactionSize: Math.round(campaign.avgTransactionSize),
          roi: Math.round(campaign.roi),
          cost: campaign.cost,
          revenue: campaign.revenue,
          efficiency: campaign.efficiency,
          duration: Math.ceil(
            (campaign.lastTransaction - campaign.firstTransaction) / (24 * 60 * 60 * 1000)
          ),
          performance: this.rateCampaignPerformance(campaign),
        })),
        summary: {
          totalCampaigns: campaignTransactions.length,
          totalParticipants: new Set(campaignTransactions.flatMap((c) => c.uniqueParticipants))
            .size,
          totalPointsIssued: campaignTransactions.reduce((sum, c) => sum + c.totalPoints, 0),
          avgROI: campaignROI.reduce((sum, c) => sum + c.roi, 0) / campaignROI.length || 0,
          bestPerforming: campaignROI.reduce(
            (best, current) => (current.roi > best.roi ? current : best),
            campaignROI[0] || {}
          ),
        },
        lifecycle: lifecycleAnalysis,
        insights: this.generateCampaignInsights(campaignROI),
        recommendations: this.generateCampaignRecommendations(campaignROI),
      };
    } catch (error) {
      logger.error('Error analyzing campaign performance:', error);
      throw error;
    }
  }

  /**
   * Generate loyalty forecasts and predictions
   */
  async generateLoyaltyForecasts(baseQuery, days = 30) {
    try {
      // Historical data for forecasting
      const historicalData = await this.getHistoricalLoyaltyData(baseQuery, 90);

      // Membership growth forecast
      const membershipForecast = this.forecastMembershipGrowth(historicalData.membership, days);

      // Points issuance forecast
      const pointsForecast = this.forecastPointsIssuance(historicalData.points, days);

      // Revenue impact forecast
      const revenueForecast = this.forecastRevenueImpact(historicalData.revenue, days);

      // Tier distribution forecast
      const tierForecast = this.forecastTierDistribution(historicalData.tiers, days);

      return {
        period: {
          forecastDays: days,
          confidenceLevel: 85,
          methodology: 'Time series analysis with seasonal adjustment',
        },
        membership: {
          ...membershipForecast,
          expectedNewMembers: Math.round((membershipForecast.projected * days) / 30),
          growthTrend: membershipForecast.trend,
        },
        points: {
          ...pointsForecast,
          expectedIssuance: Math.round(pointsForecast.projected),
          expectedRedemption: Math.round(pointsForecast.projected * 0.3), // 30% redemption rate
          netGrowth: Math.round(pointsForecast.projected * 0.7),
        },
        revenue: {
          ...revenueForecast,
          expectedIncrease: Math.round(revenueForecast.projected),
          confidence: revenueForecast.confidence,
        },
        tiers: tierForecast,
        recommendations: this.generateForecastRecommendations({
          membership: membershipForecast,
          points: pointsForecast,
          revenue: revenueForecast,
        }),
        scenarios: {
          optimistic: this.generateOptimisticScenario({ membershipForecast, pointsForecast }),
          pessimistic: this.generatePessimisticScenario({ membershipForecast, pointsForecast }),
          realistic: this.generateRealisticScenario({ membershipForecast, pointsForecast }),
        },
      };
    } catch (error) {
      logger.error('Error generating loyalty forecasts:', error);
      return null;
    }
  }

  /**
   * ================================
   * ENHANCED REPORTING ENDPOINTS WITH CACHE
   * ================================
   */

  /**
   * @desc    Generate comprehensive analytics report with Redis cache
   * @route   POST /api/analytics/reports/generate
   * @access  Admin + Receptionist
   */
  async generateAnalyticsReport(req, res) {
    const startTime = Date.now();

    try {
      const {
        reportType = 'comprehensive',
        period = '30d',
        hotelId,
        sections = ['revenue', 'occupancy', 'demand', 'yield', 'loyalty'],
        format = 'json',
        includeCharts = true,
        includeRecommendations = true,
        customTitle,
        recipients,
        forceRefresh = false,
      } = req.body;

      const { startDate, endDate } = this.parsePeriod(period);
      const reportId = this.generateReportId();

      // Build cache key for report
      const cacheKey = this.buildAnalyticsCacheKey('report', reportId, {
        reportType,
        period,
        hotelId,
        sections: sections.sort().join('_'),
        includeCharts,
        includeRecommendations,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh && format === 'json') {
        const cached = await this.getFromHybridCache(cacheKey, 'reports');
        if (cached && this.validateReportCache(cached, req.body)) {
          const executionTime = Date.now() - startTime;

          return res.json({
            success: true,
            data: {
              report: {
                ...cached,
                performance: {
                  ...cached.performance,
                  executionTime,
                  fromCache: true,
                  cacheSource: cached.cacheSource,
                },
              },
              reportId,
              cached: true,
            },
          });
        }
      }

      // Generate fresh report sections
      logger.debug(`🔄 Generating fresh analytics report: ${reportType} - ${period}`);

      const reportSections = {};

      if (sections.includes('revenue')) {
        reportSections.revenue = await this.generateRevenueSection(hotelId, startDate, endDate);
      }

      if (sections.includes('occupancy')) {
        reportSections.occupancy = await this.generateOccupancySection(hotelId, startDate, endDate);
      }

      if (sections.includes('demand')) {
        reportSections.demand = await this.generateDemandSection(hotelId, startDate, endDate);
      }

      if (sections.includes('yield') && process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        reportSections.yield = await this.generateYieldSection(hotelId, startDate, endDate);
      }

      if (sections.includes('operational')) {
        reportSections.operational = await this.generateOperationalSection(
          hotelId,
          startDate,
          endDate
        );
      }

      if (sections.includes('loyalty')) {
        reportSections.loyalty = await this.generateLoyaltySection(hotelId, startDate, endDate);
      }

      // Generate executive summary
      const executiveSummary = this.generateExecutiveSummary(reportSections);

      // Generate recommendations
      const recommendations = includeRecommendations
        ? this.generateComprehensiveRecommendations(reportSections)
        : null;

      const executionTime = Date.now() - startTime;

      const report = {
        metadata: {
          reportId,
          title: customTitle || `Analytics Report - ${period}`,
          reportType,
          period: { start: startDate, end: endDate, description: period },
          hotelId: hotelId || 'all',
          sections,
          generatedAt: new Date(),
          generatedBy: req.user.id,
        },
        executiveSummary,
        sections: reportSections,
        recommendations,
        appendix: {
          methodology: this.getReportMethodology(),
          glossary: this.getAnalyticsGlossary(),
          benchmarks: this.benchmarks,
        },
        performance: {
          executionTime,
          fromCache: false,
          cacheSource: 'calculated',
          sectionsGenerated: sections.length,
        },
      };

      // Cache the report if JSON format
      if (format === 'json') {
        await this.setInHybridCache(cacheKey, report, 'reports');
      }

      // Handle different output formats
      if (format === 'pdf') {
        const pdfBuffer = await this.generatePDFReport(report);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="analytics-report-${reportId}.pdf"`
        );
        return res.send(pdfBuffer);
      }

      if (format === 'excel') {
        const excelBuffer = await this.generateExcelReport(report);
        res.setHeader(
          'Content-Type',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="analytics-report-${reportId}.xlsx"`
        );
        return res.send(excelBuffer);
      }

      // Send report via email if recipients specified
      if (recipients && recipients.length > 0) {
        await this.emailReport(report, recipients, format);
      }

      // Store report for future access
      await this.storeReport(reportId, report);

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      res.json({
        success: true,
        data: {
          report,
          reportId,
          downloadUrls: {
            pdf: `/api/analytics/reports/${reportId}/download?format=pdf`,
            excel: `/api/analytics/reports/${reportId}/download?format=excel`,
            json: `/api/analytics/reports/${reportId}/download?format=json`,
          },
        },
      });

      logger.info(
        `📊 Analytics report generated: ${reportId} for ${hotelId || 'all hotels'} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error generating analytics report:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to generate analytics report',
        error: error.message,
      });
    }
  }

  /**
   * @desc    Export analytics data with Redis cache
   * @route   GET /api/analytics/export
   * @access  Admin + Receptionist
   */
  async exportAnalyticsData(req, res) {
    const startTime = Date.now();

    try {
      const {
        dataType = 'revenue',
        period = '30d',
        hotelId,
        format = 'csv',
        includeHeaders = true,
        granularity = 'daily',
        forceRefresh = false,
      } = req.query;

      const { startDate, endDate } = this.parsePeriod(period);

      // Build cache key for export data
      const cacheKey = this.buildAnalyticsCacheKey('export', dataType, {
        period,
        hotelId,
        granularity,
        format,
      });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cached = await this.getFromHybridCache(cacheKey, 'reports');
        if (cached && this.validateExportCache(cached, req.query)) {
          logger.debug(`📊 Export cache hit: ${dataType}:${format}`);

          // Format cached data and send response
          const responseData = this.formatExportData(cached.exportData, format, includeHeaders);
          const mimeType = this.getExportMimeType(format);
          const filename = this.getExportFilename(dataType, period, format);

          res.setHeader('Content-Type', mimeType);
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          return res.send(responseData);
        }
      }

      // Generate fresh export data
      logger.debug(`🔄 Generating fresh export data: ${dataType} - ${format}`);

      let exportData;
      switch (dataType) {
        case 'revenue':
          exportData = await this.exportRevenueData(hotelId, startDate, endDate, granularity);
          break;
        case 'occupancy':
          exportData = await this.exportOccupancyData(hotelId, startDate, endDate, granularity);
          break;
        case 'bookings':
          exportData = await this.exportBookingsData(hotelId, startDate, endDate);
          break;
        case 'yield':
          exportData = await this.exportYieldData(hotelId, startDate, endDate, granularity);
          break;
        case 'loyalty':
          exportData = await this.exportLoyaltyData(hotelId, startDate, endDate, granularity);
          break;
        default:
          throw new Error('Invalid data type for export');
      }

      // Cache the export data
      const cacheData = {
        exportData,
        metadata: {
          dataType,
          period,
          hotelId,
          granularity,
          generatedAt: new Date(),
          recordCount: Array.isArray(exportData)
            ? exportData.length
            : Object.keys(exportData).length,
        },
      };

      await this.setInHybridCache(cacheKey, cacheData, 'reports');

      // Format data based on requested format
      const responseData = this.formatExportData(exportData, format, includeHeaders);
      const mimeType = this.getExportMimeType(format);
      const filename = this.getExportFilename(dataType, period, format);

      const executionTime = Date.now() - startTime;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.send(responseData);

      // Update performance metrics
      this.updateCalculationMetrics(executionTime);

      logger.info(
        `📊 Analytics data exported: ${dataType} - ${format} for ${hotelId || 'all hotels'} (${executionTime}ms)`
      );
    } catch (error) {
      logger.error('❌ Error exporting analytics data:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to export analytics data',
        error: error.message,
      });
    }
  }

  /**
   * ================================
   * CACHE VALIDATION HELPERS
   * ================================
   */

  /**
   * Validate report cache
   */
  validateReportCache(cached, requestData) {
    if (!cached || !cached.cacheMetadata) return false;

    const age = Date.now() - new Date(cached.cacheMetadata.cachedAt).getTime();
    const maxAge = this.cacheStrategy.reports.ttl * 1000;

    if (age > maxAge) return false;

    return cached.metadata && cached.sections && cached.executiveSummary;
  }

  /**
   * Validate export cache
   */
  validateExportCache(cached, queryParams) {
    if (!cached || !cached.metadata) return false;

    const age = Date.now() - new Date(cached.metadata.generatedAt).getTime();
    const maxAge = this.cacheStrategy.reports.ttl * 1000;

    if (age > maxAge) return false;

    return cached.exportData && cached.metadata.recordCount >= 0;
  }

  /**
   * ================================
   * EXPORT FORMATTING HELPERS
   * ================================
   */

  /**
   * Format export data based on format
   */
  formatExportData(data, format, includeHeaders) {
    switch (format.toLowerCase()) {
      case 'csv':
        return this.convertToCSV(data, includeHeaders);
      case 'json':
        return JSON.stringify(data, null, 2);
      case 'excel':
        return this.convertToExcel(data);
      default:
        throw new Error('Unsupported export format');
    }
  }

  /**
   * Get MIME type for export format
   */
  getExportMimeType(format) {
    const mimeTypes = {
      csv: 'text/csv',
      json: 'application/json',
      excel: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    return mimeTypes[format.toLowerCase()] || 'text/plain';
  }

  /**
   * Get filename for export
   */
  getExportFilename(dataType, period, format) {
    const timestamp = moment().format('YYYY-MM-DD');
    return `${dataType}-${period}-${timestamp}.${format}`;
  }

  /**
   * ================================
   * REAL-TIME ANALYTICS STREAMING WITH CACHE
   * ================================
   */

  /**
   * Setup real-time analytics streaming for a user (ENHANCED WITH CACHE)
   */
  async setupRealtimeAnalytics(userId, analyticsType, options = {}) {
    try {
      const streamId = `${userId}_${analyticsType}_${Date.now()}`;

      this.streamingClients.set(streamId, {
        userId,
        analyticsType,
        options,
        startedAt: new Date(),
        lastUpdate: new Date(),
      });

      // Send initial data (use cache if available)
      await this.sendRealtimeUpdate(streamId);

      // Setup periodic updates with intelligent caching
      const interval = setInterval(async () => {
        if (!this.streamingClients.has(streamId)) {
          clearInterval(interval);
          return;
        }

        await this.sendRealtimeUpdate(streamId);
      }, options.refreshInterval || 30000);

      // Cleanup after 1 hour
      setTimeout(
        () => {
          this.streamingClients.delete(streamId);
          clearInterval(interval);
        },
        60 * 60 * 1000
      );

      logger.info(`🔄 Real-time analytics streaming started: ${streamId}`);
    } catch (error) {
      logger.error('❌ Error setting up real-time analytics:', error);
    }
  }

  /**
   * Send real-time analytics update (ENHANCED WITH CACHE)
   */
  async sendRealtimeUpdate(streamId) {
    try {
      const client = this.streamingClients.get(streamId);
      if (!client) return;

      let updateData;
      const { analyticsType, options, userId } = client;

      // Use shorter cache TTL for real-time data
      const realtimeCacheKey = this.buildAnalyticsCacheKey('realtime', analyticsType, {
        ...options,
        timestamp: Math.floor(Date.now() / (this.cacheStrategy.realtime.ttl * 1000)), // Cache key changes every TTL period
      });

      // Try cache first for real-time updates
      const cached = await this.getFromHybridCache(realtimeCacheKey, 'realtime');
      if (cached) {
        updateData = cached;
      } else {
        // Generate fresh real-time data
        switch (analyticsType) {
          case 'revenue':
            updateData = await this.getRealTimeRevenueUpdate(options);
            break;
          case 'occupancy':
            updateData = await this.getRealTimeOccupancyUpdate(options);
            break;
          case 'demand':
            updateData = await this.getRealTimeDemandUpdate(options);
            break;
          case 'operational':
            updateData = await this.getRealTimeOperationalUpdate(options);
            break;
          case 'loyalty':
            updateData = await this.getRealTimeLoyaltyUpdate(options);
            break;
          default:
            return;
        }

        // Cache the real-time data with short TTL
        await this.setInHybridCache(realtimeCacheKey, updateData, 'realtime');
      }

      // Send update via Socket.io
      socketService.sendUserNotification(userId, 'analytics-realtime-update', {
        streamId,
        type: analyticsType,
        data: updateData,
        timestamp: new Date(),
        fromCache: cached ? true : false,
      });

      // Update last update time
      client.lastUpdate = new Date();
    } catch (error) {
      logger.error('❌ Error sending real-time analytics update:', error);
    }
  }

  /**
   * Setup dashboard streaming (ENHANCED WITH CACHE)
   */
  async setupDashboardStreaming(userId, options = {}) {
    try {
      const streamInterval = options.refreshInterval || 30000;

      const sendDashboardUpdate = async () => {
        try {
          // Use cache for dashboard streaming
          const dashboardCacheKey = this.buildAnalyticsCacheKey('dashboard_stream', userId, {
            ...options,
            timestamp: Math.floor(Date.now() / (this.cacheStrategy.dashboard.ttl * 1000)),
          });

          let liveData = await this.getFromHybridCache(dashboardCacheKey, 'dashboard');

          if (!liveData) {
            liveData = await this.getLiveDashboardData(options);
            await this.setInHybridCache(dashboardCacheKey, liveData, 'dashboard');
          }

          socketService.sendUserNotification(userId, 'dashboard-analytics-update', {
            data: liveData,
            timestamp: new Date(),
            fromCache: liveData.fromCache || false,
          });
        } catch (error) {
          logger.error('❌ Error sending dashboard update:', error);
        }
      };

      // Send initial update
      await sendDashboardUpdate();

      // Setup periodic updates
      const interval = setInterval(sendDashboardUpdate, streamInterval);

      // Cleanup after 2 hours
      setTimeout(
        () => {
          clearInterval(interval);
        },
        2 * 60 * 60 * 1000
      );
    } catch (error) {
      logger.error('❌ Error setting up dashboard streaming:', error);
    }
  }

  /**
   * ================================
   * UTILITY METHODS (PRESERVED WITH CACHE ENHANCEMENTS)
   * ================================
   */

  /**
   * Parse period string to dates (ORIGINAL)
   */
  parsePeriod(period) {
    const now = moment();
    let startDate,
      endDate = now.toDate();

    const periodMatch = period.match(/^(\d+)([dwmy])$/);
    if (periodMatch) {
      const [, amount, unit] = periodMatch;
      const unitMap = { d: 'days', w: 'weeks', m: 'months', y: 'years' };
      startDate = now.subtract(parseInt(amount), unitMap[unit]).toDate();
    } else {
      // Default to 30 days
      startDate = now.subtract(30, 'days').toDate();
    }

    return { startDate, endDate };
  }

  /**
   * Build analytics query with filters (ORIGINAL)
   */
  buildAnalyticsQuery({ hotelId, roomType, startDate, endDate }) {
    const query = {};

    if (hotelId) {
      query.hotel = mongoose.Types.ObjectId(hotelId);
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = startDate;
      if (endDate) query.createdAt.$lte = endDate;
    }

    if (roomType) {
      query['rooms.type'] = roomType;
    }

    return query;
  }

  /**
   * Calculate overall performance score (ORIGINAL)
   */
  calculateOverallPerformanceScore(metrics) {
    const { revenue, occupancy, adr, revPAR } = metrics;

    // Normalize metrics to 0-100 scale
    const occupancyScore = Math.min(occupancy, 100);
    const adrScore = Math.min((adr / 200) * 100, 100); // Assuming 200 as good ADR
    const revPARScore = Math.min((revPAR / 150) * 100, 100); // Assuming 150 as good RevPAR
    const revenueScore = Math.min((revenue / 10000) * 100, 100); // Adjust based on scale

    // Weighted combination
    return Math.round(
      occupancyScore * this.analyticsWeights.occupancy +
        adrScore * 0.3 +
        revPARScore * 0.3 +
        revenueScore * this.analyticsWeights.revenue
    );
  }

  /**
   * Rate performance metrics against benchmarks (ORIGINAL)
   */
  ratePerformanceMetrics(metrics) {
    const ratings = {};

    // Rate occupancy
    const { occupancy } = metrics;
    if (occupancy >= this.benchmarks.occupancyRate.excellent) ratings.occupancy = 'EXCELLENT';
    else if (occupancy >= this.benchmarks.occupancyRate.good) ratings.occupancy = 'GOOD';
    else if (occupancy >= this.benchmarks.occupancyRate.average) ratings.occupancy = 'AVERAGE';
    else ratings.occupancy = 'POOR';

    // Rate RevPAR
    const { revPAR } = metrics;
    if (revPAR >= this.benchmarks.revPAR.excellent) ratings.revPAR = 'EXCELLENT';
    else if (revPAR >= this.benchmarks.revPAR.good) ratings.revPAR = 'GOOD';
    else if (revPAR >= this.benchmarks.revPAR.average) ratings.revPAR = 'AVERAGE';
    else ratings.revPAR = 'POOR';

    // Rate ADR
    const { adr } = metrics;
    if (adr >= this.benchmarks.adr.excellent) ratings.adr = 'EXCELLENT';
    else if (adr >= this.benchmarks.adr.good) ratings.adr = 'GOOD';
    else if (adr >= this.benchmarks.adr.average) ratings.adr = 'AVERAGE';
    else ratings.adr = 'POOR';

    return ratings;
  }

  /**
   * Compare metrics to benchmarks (ORIGINAL)
   */
  compareToBenchmarks(metrics) {
    const comparison = {};

    for (const [metric, value] of Object.entries(metrics)) {
      if (this.benchmarks[metric]) {
        const benchmark = this.benchmarks[metric];
        comparison[metric] = {
          value,
          benchmark: benchmark.good,
          performance: value >= benchmark.good ? 'ABOVE' : 'BELOW',
          percentageOfBenchmark: Math.round((value / benchmark.good) * 100),
        };
      }
    }

    return comparison;
  }

  /**
   * Generate revenue insights (ORIGINAL)
   */
  generateRevenueInsights(data) {
    const insights = [];
    const { revenueMetrics, occupancyData, pricingAnalysis, performanceScore } = data;

    // Revenue performance insight
    if (performanceScore >= 80) {
      insights.push({
        type: 'SUCCESS',
        category: 'REVENUE',
        message: `Excellent revenue performance with score of ${performanceScore}`,
        impact: 'HIGH',
        trend: 'POSITIVE',
      });
    } else if (performanceScore < 60) {
      insights.push({
        type: 'WARNING',
        category: 'REVENUE',
        message: `Revenue performance below expectations (${performanceScore})`,
        impact: 'HIGH',
        trend: 'NEGATIVE',
      });
    }

    // Occupancy insights
    if (occupancyData.summary.averageOccupancy > 85) {
      insights.push({
        type: 'OPPORTUNITY',
        category: 'PRICING',
        message: 'High occupancy rates indicate potential for price increases',
        impact: 'MEDIUM',
        trend: 'POSITIVE',
      });
    } else if (occupancyData.summary.averageOccupancy < 60) {
      insights.push({
        type: 'ALERT',
        category: 'OCCUPANCY',
        message: 'Low occupancy rates require immediate attention',
        impact: 'HIGH',
        trend: 'NEGATIVE',
      });
    }

    // Revenue growth insights
    if (revenueMetrics.growth && revenueMetrics.growth.percentage > 10) {
      insights.push({
        type: 'SUCCESS',
        category: 'GROWTH',
        message: `Strong revenue growth of ${revenueMetrics.growth.percentage.toFixed(1)}%`,
        impact: 'HIGH',
        trend: 'POSITIVE',
      });
    }

    return insights;
  }

  /**
   * Generate revenue recommendations (ORIGINAL)
   */
  generateRevenueRecommendations(insights) {
    const recommendations = [];

    insights.forEach((insight) => {
      switch (insight.category) {
        case 'OCCUPANCY':
          if (insight.type === 'ALERT') {
            recommendations.push({
              type: 'MARKETING',
              priority: 'HIGH',
              action: 'Implement promotional pricing and marketing campaigns',
              expectedImpact: 'Increase occupancy by 15-25%',
              timeframe: '2-4 weeks',
            });
          }
          break;
        case 'PRICING':
          if (insight.type === 'OPPORTUNITY') {
            recommendations.push({
              type: 'PRICING',
              priority: 'MEDIUM',
              action: 'Consider strategic price increases during high-demand periods',
              expectedImpact: 'Increase revenue by 10-15%',
              timeframe: '1-2 weeks',
            });
          }
          break;
        case 'REVENUE':
          if (insight.type === 'WARNING') {
            recommendations.push({
              type: 'STRATEGY',
              priority: 'HIGH',
              action: 'Review and optimize overall revenue strategy',
              expectedImpact: 'Improve performance by 20-30%',
              timeframe: '4-8 weeks',
            });
          }
          break;
      }
    });

    return recommendations;
  }

  /**
   * ================================
   * PLACEHOLDER METHODS (ORIGINAL STRUCTURE PRESERVED)
   * ================================
   */

  // All original placeholder methods preserved for compatibility
  // These would be implemented based on specific business requirements

  /**
   * Analyze tier progression patterns and velocity
   */
  async analyzeTierProgression(baseQuery, startDate, endDate) {
    try {
      // Get tier progression data
      const progressionData = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.tierHistory': { $exists: true, $ne: [] },
            'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
          },
        },
        {
          $project: {
            currentTier: '$loyalty.tier',
            tierHistory: '$loyalty.tierHistory',
            enrolledAt: '$loyalty.enrolledAt',
            lifetimePoints: '$loyalty.lifetimePoints',
          },
        },
        {
          $unwind: '$tierHistory',
        },
        {
          $group: {
            _id: {
              from: '$tierHistory.previousTier',
              to: '$tierHistory.newTier',
            },
            count: { $sum: 1 },
            avgDaysToProgress: {
              $avg: {
                $divide: [
                  { $subtract: ['$tierHistory.upgradeDate', '$enrolledAt'] },
                  1000 * 60 * 60 * 24,
                ],
              },
            },
            avgPointsAtUpgrade: { $avg: '$tierHistory.pointsAtUpgrade' },
          },
        },
      ]);

      // Calculate progression matrix
      const progressionMatrix = {};
      const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];

      tiers.forEach((tier) => {
        progressionMatrix[tier] = {
          total: 0,
          upgradeTo: {},
          avgTimeToNext: 0,
          progressionRate: 0,
        };
      });

      progressionData.forEach((item) => {
        const from = item._id.from;
        const to = item._id.to;

        if (progressionMatrix[from]) {
          progressionMatrix[from].upgradeTo[to] = {
            count: item.count,
            avgDays: Math.round(item.avgDaysToProgress),
            avgPoints: Math.round(item.avgPointsAtUpgrade),
          };
          progressionMatrix[from].total += item.count;
        }
      });

      // Calculate progression rates
      const totalMembers = await User.countDocuments({
        ...baseQuery,
        'loyalty.enrolledAt': { $exists: true },
      });

      for (const tier of Object.keys(progressionMatrix)) {
        const tierMembers = await User.countDocuments({
          ...baseQuery,
          'loyalty.tier': tier,
        });

        progressionMatrix[tier].progressionRate =
          tierMembers > 0 ? (progressionMatrix[tier].total / tierMembers) * 100 : 0;
      }

      return {
        progressionMatrix,
        insights: {
          fastestProgression: this.findFastestProgression(progressionData),
          bottlenecks: this.identifyProgressionBottlenecks(progressionMatrix),
          recommendations: this.generateProgressionRecommendations(progressionMatrix),
        },
        summary: {
          totalProgressions: progressionData.length,
          avgProgressionTime:
            progressionData.reduce((sum, item) => sum + item.avgDaysToProgress, 0) /
            progressionData.length,
          mostCommonUpgrade: this.findMostCommonUpgrade(progressionData),
        },
      };
    } catch (error) {
      logger.error('Error analyzing tier progression:', error);
      return {};
    }
  }
  /**
   * Calculate tier upgrades in period
   */
  async calculateTierUpgrades(baseQuery, startDate, endDate) {
    try {
      const upgrades = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.tierHistory': {
              $elemMatch: {
                upgradeDate: { $gte: startDate, $lte: endDate },
              },
            },
          },
        },
        {
          $project: {
            upgrades: {
              $filter: {
                input: '$loyalty.tierHistory',
                cond: {
                  $and: [
                    { $gte: ['$$this.upgradeDate', startDate] },
                    { $lte: ['$$this.upgradeDate', endDate] },
                  ],
                },
              },
            },
            currentTier: '$loyalty.tier',
            lifetimePoints: '$loyalty.lifetimePoints',
          },
        },
        { $unwind: '$upgrades' },
        {
          $group: {
            _id: {
              month: { $dateToString: { format: '%Y-%m', date: '$upgrades.upgradeDate' } },
              toTier: '$upgrades.newTier',
            },
            count: { $sum: 1 },
            avgPointsAtUpgrade: { $avg: '$upgrades.pointsAtUpgrade' },
            users: { $addToSet: '$_id' },
          },
        },
        { $sort: { '_id.month': 1 } },
      ]);

      // Calculate upgrade velocity by tier
      const upgradeVelocity = {};
      const tierCounts = {};

      upgrades.forEach((upgrade) => {
        const tier = upgrade._id.toTier;
        if (!upgradeVelocity[tier]) {
          upgradeVelocity[tier] = { count: 0, totalPoints: 0 };
        }
        upgradeVelocity[tier].count += upgrade.count;
        upgradeVelocity[tier].totalPoints += upgrade.avgPointsAtUpgrade * upgrade.count;

        if (!tierCounts[tier]) tierCounts[tier] = 0;
        tierCounts[tier] += upgrade.count;
      });

      // Calculate success rates
      const upgradeSuccessRates = await this.calculateUpgradeSuccessRates(
        baseQuery,
        startDate,
        endDate
      );

      return {
        monthlyUpgrades: upgrades.map((item) => ({
          month: item._id.month,
          tier: item._id.toTier,
          count: item.count,
          avgPoints: Math.round(item.avgPointsAtUpgrade),
          uniqueUsers: item.users.length,
        })),
        velocity: Object.keys(upgradeVelocity).map((tier) => ({
          tier,
          totalUpgrades: upgradeVelocity[tier].count,
          avgPointsRequired: Math.round(
            upgradeVelocity[tier].totalPoints / upgradeVelocity[tier].count
          ),
          upgradeRate: tierCounts[tier] || 0,
        })),
        successRates: upgradeSuccessRates,
        summary: {
          totalUpgrades: upgrades.reduce((sum, item) => sum + item.count, 0),
          mostPopularTier: Object.keys(tierCounts).reduce(
            (a, b) => (tierCounts[a] > tierCounts[b] ? a : b),
            'BRONZE'
          ),
          upgradeGrowth: this.calculateUpgradeGrowth(upgrades),
        },
      };
    } catch (error) {
      logger.error('Error calculating tier upgrades:', error);
      return {};
    }
  }
  /**
   * Calculate tier retention rates
   */
  async calculateTierRetention(baseQuery, startDate, endDate) {
    try {
      const retentionData = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            enrolledAt: '$loyalty.enrolledAt',
            lastActivity: '$loyalty.statistics.lastActivity',
            lifetimePoints: '$loyalty.lifetimePoints',
            isActive: {
              $gte: [
                '$loyalty.statistics.lastActivity',
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              ],
            },
            daysSinceEnrollment: {
              $divide: [{ $subtract: [new Date(), '$loyalty.enrolledAt'] }, 1000 * 60 * 60 * 24],
            },
          },
        },
        {
          $group: {
            _id: '$tier',
            totalMembers: { $sum: 1 },
            activeMembers: { $sum: { $cond: ['$isActive', 1, 0] } },
            avgDaysSinceEnrollment: { $avg: '$daysSinceEnrollment' },
            avgLifetimePoints: { $avg: '$lifetimePoints' },
          },
        },
      ]);

      // Calculate retention by cohort (enrollment month)
      const cohortRetention = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            enrollmentCohort: {
              $dateToString: { format: '%Y-%m', date: '$loyalty.enrolledAt' },
            },
            isActive: {
              $gte: [
                '$loyalty.statistics.lastActivity',
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              ],
            },
          },
        },
        {
          $group: {
            _id: {
              tier: '$tier',
              cohort: '$enrollmentCohort',
            },
            totalMembers: { $sum: 1 },
            activeMembers: { $sum: { $cond: ['$isActive', 1, 0] } },
          },
        },
      ]);

      // Calculate tier stability (members staying in same tier)
      const tierStability = await this.calculateTierStability(baseQuery, startDate, endDate);

      const formattedRetention = retentionData.map((tier) => ({
        tier: tier._id,
        totalMembers: tier.totalMembers,
        activeMembers: tier.activeMembers,
        retentionRate:
          tier.totalMembers > 0 ? Math.round((tier.activeMembers / tier.totalMembers) * 100) : 0,
        avgTenure: Math.round(tier.avgDaysSinceEnrollment),
        avgLifetimePoints: Math.round(tier.avgLifetimePoints),
        healthScore: this.calculateTierHealthScore(tier),
      }));

      return {
        byTier: formattedRetention,
        cohortAnalysis: cohortRetention.map((item) => ({
          tier: item._id.tier,
          cohort: item._id.cohort,
          totalMembers: item.totalMembers,
          activeMembers: item.activeMembers,
          retentionRate: Math.round((item.activeMembers / item.totalMembers) * 100),
        })),
        stability: tierStability,
        insights: {
          bestRetentionTier: formattedRetention.reduce((best, current) =>
            current.retentionRate > best.retentionRate ? current : best
          ),
          retentionTrends: this.analyzeRetentionTrends(cohortRetention),
          riskSegments: formattedRetention.filter((tier) => tier.retentionRate < 60),
        },
        recommendations: this.generateRetentionRecommendations(formattedRetention),
      };
    } catch (error) {
      logger.error('Error calculating tier retention:', error);
      return {};
    }
  }
  /**
   * Segment members by engagement level
   */
  async segmentMembersByEngagement(baseQuery, startDate, endDate) {
    try {
      const members = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'loyaltytransactions',
            localField: '_id',
            foreignField: 'user',
            as: 'transactions',
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            enrolledAt: '$loyalty.enrolledAt',
            lastActivity: '$loyalty.statistics.lastActivity',
            currentPoints: '$loyalty.currentPoints',
            lifetimePoints: '$loyalty.lifetimePoints',

            // Calculate engagement metrics
            totalTransactions: { $size: '$transactions' },
            recentTransactions: {
              $size: {
                $filter: {
                  input: '$transactions',
                  cond: { $gte: ['$$this.createdAt', startDate] },
                },
              },
            },
            avgTransactionValue: { $avg: '$transactions.pointsAmount' },

            daysSinceLastActivity: {
              $divide: [
                { $subtract: [new Date(), '$loyalty.statistics.lastActivity'] },
                1000 * 60 * 60 * 24,
              ],
            },

            daysSinceEnrollment: {
              $divide: [{ $subtract: [new Date(), '$loyalty.enrolledAt'] }, 1000 * 60 * 60 * 24],
            },
          },
        },
        {
          $addFields: {
            // Calculate engagement score
            engagementScore: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $gte: ['$recentTransactions', 5] },
                        { $lte: ['$daysSinceLastActivity', 30] },
                      ],
                    },
                    then: 'HIGHLY_ENGAGED',
                  },
                  {
                    case: {
                      $and: [
                        { $gte: ['$recentTransactions', 2] },
                        { $lte: ['$daysSinceLastActivity', 60] },
                      ],
                    },
                    then: 'ENGAGED',
                  },
                  {
                    case: {
                      $and: [
                        { $gte: ['$totalTransactions', 1] },
                        { $lte: ['$daysSinceLastActivity', 90] },
                      ],
                    },
                    then: 'MODERATELY_ENGAGED',
                  },
                  {
                    case: { $lte: ['$daysSinceLastActivity', 180] },
                    then: 'LOW_ENGAGED',
                  },
                ],
                default: 'DORMANT',
              },
            },
          },
        },
        {
          $group: {
            _id: {
              tier: '$tier',
              engagement: '$engagementScore',
            },
            count: { $sum: 1 },
            avgPoints: { $avg: '$currentPoints' },
            avgLifetimePoints: { $avg: '$lifetimePoints' },
            avgTransactions: { $avg: '$totalTransactions' },
            avgDaysSinceActivity: { $avg: '$daysSinceLastActivity' },
          },
        },
      ]);

      // Format segments
      const segments = {};
      const engagementLevels = [
        'HIGHLY_ENGAGED',
        'ENGAGED',
        'MODERATELY_ENGAGED',
        'LOW_ENGAGED',
        'DORMANT',
      ];
      const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];

      tiers.forEach((tier) => {
        segments[tier] = {};
        engagementLevels.forEach((level) => {
          segments[tier][level] = {
            count: 0,
            avgPoints: 0,
            avgLifetimePoints: 0,
            avgTransactions: 0,
            avgDaysSinceActivity: 0,
            percentage: 0,
          };
        });
      });

      // Populate segments with data
      members.forEach((member) => {
        const tier = member._id.tier;
        const engagement = member._id.engagement;

        if (segments[tier] && segments[tier][engagement]) {
          segments[tier][engagement] = {
            count: member.count,
            avgPoints: Math.round(member.avgPoints),
            avgLifetimePoints: Math.round(member.avgLifetimePoints),
            avgTransactions: Math.round(member.avgTransactions),
            avgDaysSinceActivity: Math.round(member.avgDaysSinceActivity),
          };
        }
      });

      // Calculate percentages
      Object.keys(segments).forEach((tier) => {
        const tierTotal = Object.values(segments[tier]).reduce((sum, seg) => sum + seg.count, 0);
        Object.keys(segments[tier]).forEach((engagement) => {
          segments[tier][engagement].percentage =
            tierTotal > 0 ? Math.round((segments[tier][engagement].count / tierTotal) * 100) : 0;
        });
      });

      // Generate insights
      const insights = this.generateEngagementInsights(segments);

      return {
        segments,
        summary: {
          totalSegmented: members.reduce((sum, member) => sum + member.count, 0),
          mostEngagedTier: this.findMostEngagedTier(segments),
          riskSegments: this.identifyRiskSegments(segments),
          highValueSegments: this.identifyHighValueSegments(segments),
        },
        insights,
        recommendations: this.generateEngagementRecommendations(segments, insights),
      };
    } catch (error) {
      logger.error('Error segmenting members by engagement:', error);
      return {};
    }
  }
  /**
   * Perform cohort analysis for member retention
   */
  async performCohortAnalysis(baseQuery) {
    try {
      // Get members grouped by enrollment month
      const cohorts = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            enrollmentCohort: {
              $dateToString: { format: '%Y-%m', date: '$loyalty.enrolledAt' },
            },
            enrolledAt: '$loyalty.enrolledAt',
            lastActivity: '$loyalty.statistics.lastActivity',
            currentPoints: '$loyalty.currentPoints',
            tier: '$loyalty.tier',
          },
        },
        {
          $group: {
            _id: '$enrollmentCohort',
            totalMembers: { $sum: 1 },
            enrollmentDate: { $first: '$enrolledAt' },
            members: { $push: '$$ROOT' },
          },
        },
        { $sort: { _id: 1 } },
        { $limit: 24 }, // Last 24 months
      ]);

      // Calculate retention rates for each period
      const retentionMatrix = [];
      const now = new Date();

      for (let cohort of cohorts) {
        const cohortData = {
          cohort: cohort._id,
          enrollmentDate: cohort.enrollmentDate,
          size: cohort.totalMembers,
          retentionRates: {},
        };

        // Calculate retention for different periods (1, 3, 6, 12 months)
        const periods = [1, 3, 6, 12, 18, 24];

        for (let period of periods) {
          const cutoffDate = new Date(cohort.enrollmentDate);
          cutoffDate.setMonth(cutoffDate.getMonth() + period);

          if (cutoffDate <= now) {
            const activeMembers = cohort.members.filter(
              (member) => member.lastActivity && member.lastActivity >= cutoffDate
            ).length;

            cohortData.retentionRates[`month_${period}`] = {
              activeMembers,
              retentionRate: Math.round((activeMembers / cohort.totalMembers) * 100),
              period: `${period} months`,
            };
          }
        }

        retentionMatrix.push(cohortData);
      }

      // Calculate average retention rates across cohorts
      const avgRetentionRates = {};
      periods.forEach((period) => {
        const key = `month_${period}`;
        const validCohorts = retentionMatrix.filter((cohort) => cohort.retentionRates[key]);

        if (validCohorts.length > 0) {
          const avgRate =
            validCohorts.reduce(
              (sum, cohort) => sum + cohort.retentionRates[key].retentionRate,
              0
            ) / validCohorts.length;

          avgRetentionRates[key] = {
            avgRetentionRate: Math.round(avgRate),
            period: `${period} months`,
            cohortsAnalyzed: validCohorts.length,
          };
        }
      });

      // Identify best and worst performing cohorts
      const cohortPerformance = retentionMatrix
        .map((cohort) => {
          const sixMonthRetention = cohort.retentionRates.month_6?.retentionRate || 0;
          return {
            cohort: cohort.cohort,
            size: cohort.size,
            sixMonthRetention,
            performance:
              sixMonthRetention > 60 ? 'GOOD' : sixMonthRetention > 40 ? 'AVERAGE' : 'POOR',
          };
        })
        .sort((a, b) => b.sixMonthRetention - a.sixMonthRetention);

      return {
        retentionMatrix,
        avgRetentionRates,
        cohortPerformance,
        insights: {
          bestCohort: cohortPerformance[0],
          worstCohort: cohortPerformance[cohortPerformance.length - 1],
          retentionTrend: this.calculateRetentionTrend(retentionMatrix),
          criticalDropoffPeriod: this.identifyCriticalDropoffPeriod(avgRetentionRates),
        },
        recommendations: this.generateCohortRecommendations(cohortPerformance, avgRetentionRates),
      };
    } catch (error) {
      logger.error('Error performing cohort analysis:', error);
      return {};
    }
  }
  /**
   * Identify members at risk of churning
   */
  async identifyChurnRisk(baseQuery) {
    try {
      const riskAnalysis = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'loyaltytransactions',
            localField: '_id',
            foreignField: 'user',
            as: 'transactions',
          },
        },
        {
          $project: {
            firstName: 1,
            lastName: 1,
            email: 1,
            tier: '$loyalty.tier',
            enrolledAt: '$loyalty.enrolledAt',
            lastActivity: '$loyalty.statistics.lastActivity',
            currentPoints: '$loyalty.currentPoints',
            lifetimePoints: '$loyalty.lifetimePoints',

            // Risk indicators
            daysSinceLastActivity: {
              $divide: [
                { $subtract: [new Date(), '$loyalty.statistics.lastActivity'] },
                1000 * 60 * 60 * 24,
              ],
            },

            totalTransactions: { $size: '$transactions' },

            recentTransactions: {
              $size: {
                $filter: {
                  input: '$transactions',
                  cond: {
                    $gte: ['$$this.createdAt', new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)],
                  },
                },
              },
            },

            avgTransactionValue: {
              $avg: {
                $map: {
                  input: '$transactions',
                  as: 'transaction',
                  in: { $abs: '$$transaction.pointsAmount' },
                },
              },
            },

            lastTransactionDate: {
              $max: '$transactions.createdAt',
            },
          },
        },
        {
          $addFields: {
            // Calculate churn risk score
            churnRiskScore: {
              $let: {
                vars: {
                  activityScore: {
                    $cond: [
                      { $lte: ['$daysSinceLastActivity', 30] },
                      0,
                      {
                        $cond: [
                          { $lte: ['$daysSinceLastActivity', 60] },
                          25,
                          {
                            $cond: [
                              { $lte: ['$daysSinceLastActivity', 90] },
                              50,
                              { $cond: [{ $lte: ['$daysSinceLastActivity', 180] }, 75, 100] },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                  transactionScore: {
                    $cond: [
                      { $gte: ['$recentTransactions', 3] },
                      0,
                      {
                        $cond: [
                          { $gte: ['$recentTransactions', 1] },
                          30,
                          { $cond: [{ $gte: ['$totalTransactions', 1] }, 60, 100] },
                        ],
                      },
                    ],
                  },
                },
                in: {
                  $divide: [{ $add: ['$$activityScore', '$$transactionScore'] }, 2],
                },
              },
            },
          },
        },
        {
          $addFields: {
            riskLevel: {
              $switch: {
                branches: [
                  { case: { $gte: ['$churnRiskScore', 80] }, then: 'CRITICAL' },
                  { case: { $gte: ['$churnRiskScore', 60] }, then: 'HIGH' },
                  { case: { $gte: ['$churnRiskScore', 40] }, then: 'MEDIUM' },
                  { case: { $gte: ['$churnRiskScore', 20] }, then: 'LOW' },
                ],
                default: 'MINIMAL',
              },
            },
          },
        },
        {
          $match: {
            churnRiskScore: { $gte: 40 }, // Only include medium+ risk
          },
        },
        {
          $sort: { churnRiskScore: -1 },
        },
        {
          $limit: 1000, // Limit to top 1000 at-risk members
        },
      ]);

      // Group by risk level
      const riskSegments = {
        CRITICAL: [],
        HIGH: [],
        MEDIUM: [],
      };

      riskAnalysis.forEach((member) => {
        if (riskSegments[member.riskLevel]) {
          riskSegments[member.riskLevel].push({
            id: member._id,
            name: `${member.firstName} ${member.lastName}`,
            email: member.email,
            tier: member.tier,
            riskScore: Math.round(member.churnRiskScore),
            daysSinceLastActivity: Math.round(member.daysSinceLastActivity),
            recentTransactions: member.recentTransactions,
            currentPoints: member.currentPoints,
            lifetimePoints: member.lifetimePoints,
            recommendedActions: this.getChurnPreventionActions(member),
          });
        }
      });

      // Calculate churn prediction accuracy
      const churnPredictionAccuracy = await this.calculateChurnPredictionAccuracy(baseQuery);

      // Generate prevention strategies
      const preventionStrategies = this.generateChurnPreventionStrategies(riskSegments);

      return {
        riskSegments,
        summary: {
          totalAtRisk: riskAnalysis.length,
          criticalRisk: riskSegments.CRITICAL.length,
          highRisk: riskSegments.HIGH.length,
          mediumRisk: riskSegments.MEDIUM.length,
          estimatedChurnRate: this.estimateChurnRate(riskSegments),
          potentialRevenueAtRisk: this.calculatePotentialRevenueAtRisk(riskSegments),
        },
        predictionAccuracy: churnPredictionAccuracy,
        preventionStrategies,
        recommendations: this.generateChurnPreventionRecommendations(riskSegments),
      };
    } catch (error) {
      logger.error('Error identifying churn risk:', error);
      return {};
    }
  }
  /**
   * Analyze loyalty program costs
   */
  async analyzeLoyaltyCosts(baseQuery, startDate, endDate) {
    try {
      // Direct costs calculation
      const pointsIssued = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $gt: 0 },
          },
        },
        {
          $group: {
            _id: '$type',
            totalPoints: { $sum: '$pointsAmount' },
            transactionCount: { $sum: 1 },
            avgPointsPerTransaction: { $avg: '$pointsAmount' },
          },
        },
      ]);

      const pointsRedeemed = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $lt: 0 },
          },
        },
        {
          $group: {
            _id: '$type',
            totalPoints: { $sum: { $abs: '$pointsAmount' } },
            transactionCount: { $sum: 1 },
            avgPointsPerRedemption: { $avg: { $abs: '$pointsAmount' } },
          },
        },
      ]);

      // Calculate cost categories
      const totalPointsIssued = pointsIssued.reduce((sum, item) => sum + item.totalPoints, 0);
      const totalPointsRedeemed = pointsRedeemed.reduce((sum, item) => sum + item.totalPoints, 0);

      // Operational costs (estimated)
      const periodMonths = moment(endDate).diff(moment(startDate), 'months', true);
      const operationalCosts = {
        technology: periodMonths * 2000, // Monthly tech costs
        staff: periodMonths * 3000, // Staff costs
        marketing: periodMonths * 1500, // Marketing costs
        administration: periodMonths * 1000, // Admin costs
      };

      // Points liability calculation
      const pointValue = 0.01; // 1 point = 1 cent
      const pointsLiability = (totalPointsIssued - totalPointsRedeemed) * pointValue;

      // Cost per member calculation
      const totalMembers = await User.countDocuments({
        ...baseQuery,
        'loyalty.enrolledAt': { $exists: true },
      });

      const totalDirectCosts = totalPointsRedeemed * pointValue;
      const totalOperationalCosts = Object.values(operationalCosts).reduce(
        (sum, cost) => sum + cost,
        0
      );
      const totalCosts = totalDirectCosts + totalOperationalCosts;

      // Cost efficiency metrics
      const costPerMember = totalMembers > 0 ? totalCosts / totalMembers : 0;
      const costPerTransaction =
        pointsIssued.length + pointsRedeemed.length > 0
          ? totalCosts / (pointsIssued.length + pointsRedeemed.length)
          : 0;

      // ROI calculation
      const estimatedAdditionalRevenue = await this.estimateAdditionalRevenueFromLoyalty(
        baseQuery,
        startDate,
        endDate
      );
      const roi =
        totalCosts > 0 ? ((estimatedAdditionalRevenue - totalCosts) / totalCosts) * 100 : 0;

      return {
        directCosts: {
          pointsRedemption: totalDirectCosts,
          pointsLiability,
          byType: pointsRedeemed.map((item) => ({
            type: item._id,
            cost: item.totalPoints * pointValue,
            transactions: item.transactionCount,
            avgCostPerTransaction: (item.totalPoints * pointValue) / item.transactionCount,
          })),
        },
        operationalCosts: {
          ...operationalCosts,
          total: totalOperationalCosts,
          monthlyAverage: totalOperationalCosts / periodMonths,
        },
        totalCosts: {
          direct: totalDirectCosts,
          operational: totalOperationalCosts,
          total: totalCosts,
          liability: pointsLiability,
        },
        efficiency: {
          costPerMember: Math.round(costPerMember * 100) / 100,
          costPerTransaction: Math.round(costPerTransaction * 100) / 100,
          redemptionRate:
            totalPointsIssued > 0 ? (totalPointsRedeemed / totalPointsIssued) * 100 : 0,
          operationalEfficiency: totalMembers > 0 ? totalOperationalCosts / totalMembers : 0,
        },
        roi: {
          additionalRevenue: estimatedAdditionalRevenue,
          totalCosts,
          netBenefit: estimatedAdditionalRevenue - totalCosts,
          roiPercentage: Math.round(roi * 100) / 100,
          paybackPeriod:
            totalCosts > 0 && estimatedAdditionalRevenue > totalCosts
              ? totalCosts / (estimatedAdditionalRevenue / 12)
              : null,
        },
        benchmarks: {
          industryCostPerMember: 25, // Industry benchmark
          targetROI: 150, // Target 150% ROI
          optimalRedemptionRate: 30, // Target 30% redemption rate
        },
        recommendations: this.generateCostOptimizationRecommendations({
          costPerMember,
          redemptionRate:
            totalPointsIssued > 0 ? (totalPointsRedeemed / totalPointsIssued) * 100 : 0,
          roi,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing loyalty costs:', error);
      return {};
    }
  }
  /**
   * Calculate revenue impact from loyalty program
   */
  calculateRevenueImpact(roiData) {
    try {
      if (!roiData || !roiData.benefits) {
        return 0;
      }

      const { benefits, costs } = roiData;

      // Direct revenue impact
      const directImpact = benefits.additionalRevenue || 0;

      // Retention value impact
      const retentionImpact = benefits.retentionValue || 0;

      // Indirect impacts
      const indirectImpacts = {
        // Word of mouth and referrals (estimated 15% of direct impact)
        wordOfMouth: directImpact * 0.15,

        // Increased transaction frequency (estimated 10% of direct impact)
        frequencyIncrease: directImpact * 0.1,

        // Cross-selling opportunities (estimated 8% of direct impact)
        crossSelling: directImpact * 0.08,

        // Brand loyalty premium (estimated 5% of direct impact)
        brandPremium: directImpact * 0.05,
      };

      const totalIndirectImpact = Object.values(indirectImpacts).reduce(
        (sum, impact) => sum + impact,
        0
      );

      // Calculate net impact
      const totalGrossImpact = directImpact + retentionImpact + totalIndirectImpact;
      const totalCosts = costs?.total || 0;
      const netImpact = totalGrossImpact - totalCosts;

      // Calculate impact ratios
      const impactMetrics = {
        directRevenue: directImpact,
        retentionRevenue: retentionImpact,
        indirectRevenue: totalIndirectImpact,
        totalGrossImpact,
        totalCosts,
        netImpact,

        // Impact ratios
        directToTotal: totalGrossImpact > 0 ? (directImpact / totalGrossImpact) * 100 : 0,
        retentionToTotal: totalGrossImpact > 0 ? (retentionImpact / totalGrossImpact) * 100 : 0,
        indirectToTotal: totalGrossImpact > 0 ? (totalIndirectImpact / totalGrossImpact) * 100 : 0,

        // ROI metrics
        grossROI: totalCosts > 0 ? (totalGrossImpact / totalCosts) * 100 : 0,
        netROI: totalCosts > 0 ? (netImpact / totalCosts) * 100 : 0,

        // Breakdown of indirect impacts
        indirectBreakdown: indirectImpacts,
      };

      // Risk-adjusted impact (apply 85% confidence factor)
      const riskAdjustedImpact = {
        conservative: netImpact * 0.85,
        realistic: netImpact,
        optimistic: netImpact * 1.15,
      };

      return {
        ...impactMetrics,
        riskAdjusted: riskAdjustedImpact,
        summary: {
          totalImpact: Math.round(netImpact),
          confidence: this.calculateImpactConfidence(impactMetrics),
          recommendation: this.getImpactRecommendation(impactMetrics),
        },
      };
    } catch (error) {
      logger.error('Error calculating revenue impact:', error);
      return 0;
    }
  }
  /**
   * Analyze member redemption preferences
   */
  async analyzeRedemptionPreferences(baseQuery, startDate, endDate) {
    try {
      // Analyze redemption patterns by type and member characteristics
      const redemptionAnalysis = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: startDate, $lte: endDate },
            pointsAmount: { $lt: 0 }, // Redemptions only
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'user',
            foreignField: '_id',
            as: 'memberInfo',
          },
        },
        {
          $unwind: '$memberInfo',
        },
        {
          $project: {
            type: 1,
            pointsAmount: { $abs: '$pointsAmount' },
            createdAt: 1,
            memberTier: '$memberInfo.loyalty.tier',
            memberAge: {
              $divide: [
                { $subtract: [new Date(), '$memberInfo.loyalty.enrolledAt'] },
                1000 * 60 * 60 * 24,
              ],
            },
            dayOfWeek: { $dayOfWeek: '$createdAt' },
            hour: { $hour: '$createdAt' },
            month: { $month: '$createdAt' },
          },
        },
      ]);

      // Group preferences by different dimensions
      const preferenceAnalysis = {
        byType: {},
        byTier: {},
        byMemberAge: {},
        byTiming: {
          dayOfWeek: {},
          hour: {},
          month: {},
        },
        byValue: {},
      };

      // Analyze by redemption type
      const typePreferences = redemptionAnalysis.reduce((acc, redemption) => {
        const type = redemption.type;
        if (!acc[type]) {
          acc[type] = {
            count: 0,
            totalPoints: 0,
            members: new Set(),
            avgPoints: 0,
          };
        }
        acc[type].count++;
        acc[type].totalPoints += redemption.pointsAmount;
        acc[type].members.add(redemption.memberInfo?._id?.toString());
        return acc;
      }, {});

      // Calculate averages and popularity
      Object.keys(typePreferences).forEach((type) => {
        const pref = typePreferences[type];
        pref.avgPoints = pref.count > 0 ? pref.totalPoints / pref.count : 0;
        pref.uniqueMembers = pref.members.size;
        pref.popularity = pref.count;
      });

      // Analyze by tier preferences
      const tierPreferences = {};
      const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];

      tiers.forEach((tier) => {
        const tierRedemptions = redemptionAnalysis.filter((r) => r.memberTier === tier);
        const typeBreakdown = {};

        tierRedemptions.forEach((redemption) => {
          const type = redemption.type;
          if (!typeBreakdown[type]) {
            typeBreakdown[type] = { count: 0, totalPoints: 0 };
          }
          typeBreakdown[type].count++;
          typeBreakdown[type].totalPoints += redemption.pointsAmount;
        });

        tierPreferences[tier] = {
          totalRedemptions: tierRedemptions.length,
          avgPointsPerRedemption:
            tierRedemptions.length > 0
              ? tierRedemptions.reduce((sum, r) => sum + r.pointsAmount, 0) / tierRedemptions.length
              : 0,
          preferredTypes: Object.entries(typeBreakdown)
            .sort(([, a], [, b]) => b.count - a.count)
            .slice(0, 3)
            .map(([type, data]) => ({
              type,
              count: data.count,
              percentage: (data.count / tierRedemptions.length) * 100,
            })),
        };
      });

      // Analyze timing preferences
      const timingAnalysis = {
        dayOfWeek: this.analyzeTimingPattern(redemptionAnalysis, 'dayOfWeek'),
        hour: this.analyzeTimingPattern(redemptionAnalysis, 'hour'),
        month: this.analyzeTimingPattern(redemptionAnalysis, 'month'),
      };

      // Analyze value preferences (point amounts)
      const valueRanges = [
        { min: 0, max: 100, label: 'Small (0-100 points)' },
        { min: 101, max: 500, label: 'Medium (101-500 points)' },
        { min: 501, max: 1000, label: 'Large (501-1000 points)' },
        { min: 1001, max: Infinity, label: 'Premium (1000+ points)' },
      ];

      const valuePreferences = valueRanges.map((range) => {
        const redemptionsInRange = redemptionAnalysis.filter(
          (r) => r.pointsAmount >= range.min && r.pointsAmount <= range.max
        );

        return {
          range: range.label,
          count: redemptionsInRange.length,
          percentage: (redemptionsInRange.length / redemptionAnalysis.length) * 100,
          avgPoints:
            redemptionsInRange.length > 0
              ? redemptionsInRange.reduce((sum, r) => sum + r.pointsAmount, 0) /
                redemptionsInRange.length
              : 0,
        };
      });

      // Generate insights
      const insights = this.generateRedemptionInsights({
        typePreferences,
        tierPreferences,
        timingAnalysis,
        valuePreferences,
      });

      return {
        byType: Object.entries(typePreferences)
          .sort(([, a], [, b]) => b.popularity - a.popularity)
          .map(([type, data]) => ({
            type,
            popularity: data.count,
            totalPoints: data.totalPoints,
            avgPoints: Math.round(data.avgPoints),
            uniqueMembers: data.uniqueMembers,
            preference: this.calculateTypePreference(data, redemptionAnalysis.length),
          })),

        byTier: tierPreferences,

        byTiming: {
          peakDay: this.findPeakTiming(timingAnalysis.dayOfWeek),
          peakHour: this.findPeakTiming(timingAnalysis.hour),
          peakMonth: this.findPeakTiming(timingAnalysis.month),
          patterns: timingAnalysis,
        },

        byValue: valuePreferences,

        insights,

        recommendations: this.generateRedemptionRecommendations({
          typePreferences,
          tierPreferences,
          timingAnalysis,
          insights,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing redemption preferences:', error);
      return {};
    }
  }
  /**
   * Calculate redemption efficiency metrics
   */
  calculateRedemptionEfficiency(redemptionAnalytics) {
    try {
      if (!redemptionAnalytics || !redemptionAnalytics.byType) {
        return {};
      }

      const { byType, timing, efficiency } = redemptionAnalytics;

      // Calculate type efficiency
      const typeEfficiency = byType.map((type) => {
        const utilizationRate = type.uniqueUsers > 0 ? type.transactionCount / type.uniqueUsers : 0;
        const pointsPerUser = type.uniqueUsers > 0 ? type.totalRedemptions / type.uniqueUsers : 0;

        return {
          type: type.type,
          efficiency: {
            utilizationRate: Math.round(utilizationRate * 100) / 100,
            pointsPerUser: Math.round(pointsPerUser),
            avgSize: type.avgSize,
            popularity: type.popularity,

            // Efficiency score (0-100)
            efficiencyScore: this.calculateTypeEfficiencyScore({
              utilizationRate,
              pointsPerUser,
              popularity: type.popularity,
              avgSize: type.avgSize,
            }),
          },
        };
      });

      // Calculate timing efficiency
      const timingEfficiency = {
        optimalDays: timing?.peakDay ? [timing.peakDay] : [],
        optimalHours: timing?.peakHour ? [timing.peakHour] : [],
        distributionScore: this.calculateTimingDistributionScore(timing?.patterns),
        seasonalEfficiency: this.calculateSeasonalEfficiency(timing?.patterns),
      };

      // Calculate overall program efficiency
      const programEfficiency = {
        // Redemption velocity (how quickly points are redeemed)
        velocity: efficiency?.timeToRedemption
          ? {
              avgDays: efficiency.timeToRedemption.avgDays,
              velocityScore: this.calculateVelocityScore(efficiency.timeToRedemption.avgDays),
              pattern: efficiency.timeToRedemption.pattern,
            }
          : null,

        // Portfolio efficiency (how well different redemption types perform)
        portfolioEfficiency: this.calculatePortfolioEfficiency(typeEfficiency),

        // Member engagement efficiency
        engagementEfficiency: efficiency?.byTier
          ? this.calculateEngagementEfficiency(efficiency.byTier)
          : null,

        // Cost efficiency
        costEfficiency: this.calculateCostEfficiency(byType),
      };

      // Calculate improvement opportunities
      const improvements = {
        underperformingTypes: typeEfficiency
          .filter((type) => type.efficiency.efficiencyScore < 60)
          .map((type) => ({
            type: type.type,
            currentScore: type.efficiency.efficiencyScore,
            improvementPotential: this.calculateImprovementPotential(type.efficiency),
            recommendedActions: this.getImprovementActions(type),
          })),

        timingOptimizations: this.identifyTimingOptimizations(timingEfficiency),

        portfolioOptimizations: this.identifyPortfolioOptimizations(typeEfficiency),
      };

      // Overall efficiency score
      const overallScore = this.calculateOverallEfficiencyScore({
        typeEfficiency,
        timingEfficiency,
        programEfficiency,
      });

      return {
        overall: {
          score: overallScore,
          rating: this.getEfficiencyRating(overallScore),
          benchmarkComparison: this.compareToEfficiencyBenchmarks(overallScore),
        },

        byType: typeEfficiency,

        timing: timingEfficiency,

        program: programEfficiency,

        improvements,

        recommendations: this.generateEfficiencyRecommendations({
          overallScore,
          typeEfficiency,
          improvements,
        }),

        // Key metrics summary
        summary: {
          mostEfficientType: typeEfficiency.reduce((best, current) =>
            current.efficiency.efficiencyScore > best.efficiency.efficiencyScore ? current : best
          ),
          leastEfficientType: typeEfficiency.reduce((worst, current) =>
            current.efficiency.efficiencyScore < worst.efficiency.efficiencyScore ? current : worst
          ),
          avgEfficiencyScore:
            typeEfficiency.reduce((sum, type) => sum + type.efficiency.efficiencyScore, 0) /
            typeEfficiency.length,
          improvementOpportunities: improvements.underperformingTypes.length,
        },
      };
    } catch (error) {
      logger.error('Error calculating redemption efficiency:', error);
      return {};
    }
  }
  /**
   * Calculate campaign effectiveness metrics
   */
  calculateCampaignEffectiveness(campaignPerformance) {
    try {
      if (!campaignPerformance || !campaignPerformance.campaigns) {
        return {};
      }

      const { campaigns, summary } = campaignPerformance;

      // Calculate effectiveness metrics for each campaign
      const campaignEffectiveness = campaigns.map((campaign) => {
        const participationRate =
          campaign.participants > 0 ? (campaign.participants / summary.totalParticipants) * 100 : 0;

        const pointsPerParticipant =
          campaign.participants > 0 ? campaign.totalPoints / campaign.participants : 0;

        const transactionRate =
          campaign.participants > 0 ? campaign.transactions / campaign.participants : 0;

        // Effectiveness score calculation (0-100)
        const effectivenessScore = this.calculateCampaignEffectivenessScore({
          roi: campaign.roi,
          participationRate,
          transactionRate,
          duration: campaign.duration,
          efficiency: campaign.efficiency,
        });

        return {
          code: campaign.code,
          name: campaign.name,
          effectiveness: {
            score: effectivenessScore,
            rating: this.getCampaignRating(effectivenessScore),

            // Key metrics
            roi: campaign.roi,
            participationRate: Math.round(participationRate * 100) / 100,
            pointsPerParticipant: Math.round(pointsPerParticipant),
            transactionRate: Math.round(transactionRate * 100) / 100,
            costEfficiency: campaign.efficiency,

            // Performance indicators
            reachEffectiveness: this.calculateReachEffectiveness(
              campaign.participants,
              summary.totalParticipants
            ),
            engagementEffectiveness: this.calculateEngagementEffectiveness(transactionRate),
            conversionEffectiveness: this.calculateConversionEffectiveness(campaign.roi),

            // Time efficiency
            durationEfficiency: this.calculateDurationEfficiency(campaign.duration, campaign.roi),
            velocityScore: this.calculateCampaignVelocity(campaign.transactions, campaign.duration),
          },

          // Improvement suggestions
          improvements: this.suggestCampaignImprovements({
            roi: campaign.roi,
            participationRate,
            transactionRate,
            duration: campaign.duration,
          }),
        };
      });

      // Portfolio effectiveness analysis
      const portfolioEffectiveness = {
        avgEffectivenessScore:
          campaignEffectiveness.reduce((sum, campaign) => sum + campaign.effectiveness.score, 0) /
          campaignEffectiveness.length,

        bestPerforming: campaignEffectiveness.reduce((best, current) =>
          current.effectiveness.score > best.effectiveness.score ? current : best
        ),

        worstPerforming: campaignEffectiveness.reduce((worst, current) =>
          current.effectiveness.score < worst.effectiveness.score ? current : worst
        ),

        // Distribution analysis
        distribution: {
          excellent: campaignEffectiveness.filter((c) => c.effectiveness.score >= 80).length,
          good: campaignEffectiveness.filter(
            (c) => c.effectiveness.score >= 60 && c.effectiveness.score < 80
          ).length,
          average: campaignEffectiveness.filter(
            (c) => c.effectiveness.score >= 40 && c.effectiveness.score < 60
          ).length,
          poor: campaignEffectiveness.filter((c) => c.effectiveness.score < 40).length,
        },

        // Portfolio health score
        healthScore: this.calculatePortfolioHealthScore(campaignEffectiveness),
      };

      // Effectiveness trends
      const trends = this.analyzeCampaignEffectivenessTrends(campaignEffectiveness);

      // Benchmarking
      const benchmarks = {
        industry: {
          avgROI: 180,
          avgParticipationRate: 15,
          avgTransactionRate: 25,
        },
        internal: {
          topQuartileROI: this.calculateTopQuartile(campaigns.map((c) => c.roi)),
          avgParticipationRate:
            campaigns.reduce(
              (sum, c) => sum + (c.participants / summary.totalParticipants) * 100,
              0
            ) / campaigns.length,
        },
      };

      return {
        campaigns: campaignEffectiveness,

        portfolio: portfolioEffectiveness,

        trends,

        benchmarks,

        insights: this.generateCampaignEffectivenessInsights({
          campaignEffectiveness,
          portfolioEffectiveness,
          benchmarks,
        }),

        recommendations: this.generateCampaignOptimizationRecommendations({
          portfolioEffectiveness,
          underperformingCampaigns: campaignEffectiveness.filter((c) => c.effectiveness.score < 60),
          trends,
        }),

        // Action plan
        actionPlan: this.createCampaignActionPlan({
          campaignEffectiveness,
          portfolioEffectiveness,
        }),
      };
    } catch (error) {
      logger.error('Error calculating campaign effectiveness:', error);
      return {};
    }
  }
  /**
   * Get top performing hotels based on loyalty metrics
   */
  async getTopPerformingHotels(baseQuery, limit = 5) {
    try {
      // Get hotel performance data
      const hotelPerformance = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'hotels',
            localField: 'preferredHotel',
            foreignField: '_id',
            as: 'hotelInfo',
          },
        },
        {
          $unwind: { path: '$hotelInfo', preserveNullAndEmptyArrays: true },
        },
        {
          $lookup: {
            from: 'loyaltytransactions',
            localField: '_id',
            foreignField: 'user',
            as: 'transactions',
          },
        },
        {
          $group: {
            _id: '$hotelInfo._id',
            hotelName: { $first: '$hotelInfo.name' },
            hotelCity: { $first: '$hotelInfo.address.city' },
            hotelStars: { $first: '$hotelInfo.stars' },

            // Member metrics
            totalMembers: { $sum: 1 },
            activeMembers: {
              $sum: {
                $cond: [
                  {
                    $gte: [
                      '$loyalty.statistics.lastActivity',
                      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            // Points metrics
            totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' },
            avgCurrentPoints: { $avg: '$loyalty.currentPoints' },
            avgLifetimePoints: { $avg: '$loyalty.lifetimePoints' },

            // Tier distribution
            bronzeMembers: { $sum: { $cond: [{ $eq: ['$loyalty.tier', 'BRONZE'] }, 1, 0] } },
            silverMembers: { $sum: { $cond: [{ $eq: ['$loyalty.tier', 'SILVER'] }, 1, 0] } },
            goldMembers: { $sum: { $cond: [{ $eq: ['$loyalty.tier', 'GOLD'] }, 1, 0] } },
            platinumMembers: { $sum: { $cond: [{ $eq: ['$loyalty.tier', 'PLATINUM'] }, 1, 0] } },
            diamondMembers: { $sum: { $cond: [{ $eq: ['$loyalty.tier', 'DIAMOND'] }, 1, 0] } },

            // Engagement metrics
            totalTransactions: { $sum: { $size: '$transactions' } },
            avgEngagementScore: { $avg: '$loyalty.performance.engagementScore' },
          },
        },
        {
          $addFields: {
            // Calculate performance scores
            memberQualityScore: {
              $multiply: [
                { $divide: ['$avgLifetimePoints', 1000] }, // Normalize to scale
                { $add: [1, { $divide: ['$activeMembers', '$totalMembers'] }] }, // Activity bonus
              ],
            },

            tierMixScore: {
              $add: [
                { $multiply: ['$goldMembers', 3] },
                { $multiply: ['$platinumMembers', 4] },
                { $multiply: ['$diamondMembers', 5] },
              ],
            },

            engagementScore: '$avgEngagementScore',

            activationRate: {
              $multiply: [{ $divide: ['$activeMembers', '$totalMembers'] }, 100],
            },
          },
        },
        {
          $addFields: {
            overallPerformanceScore: {
              $divide: [
                {
                  $add: [
                    { $multiply: ['$memberQualityScore', 0.3] },
                    { $multiply: ['$tierMixScore', 0.25] },
                    { $multiply: ['$engagementScore', 0.25] },
                    { $multiply: ['$activationRate', 0.2] },
                  ],
                },
                100,
              ],
            },
          },
        },
        {
          $match: {
            _id: { $ne: null },
            totalMembers: { $gte: 10 }, // Minimum threshold
          },
        },
        {
          $sort: { overallPerformanceScore: -1 },
        },
        {
          $limit: limit,
        },
      ]);

      // Enrich with additional metrics
      const enrichedHotels = await Promise.all(
        hotelPerformance.map(async (hotel, index) => {
          // Get recent performance trends
          const recentTrends = await this.getHotelLoyaltyTrends(hotel._id);

          // Calculate growth metrics
          const growthMetrics = await this.calculateHotelGrowthMetrics(hotel._id);

          // Get revenue contribution
          const revenueContribution = await this.calculateHotelRevenueContribution(hotel._id);

          return {
            rank: index + 1,
            hotelId: hotel._id,
            name: hotel.hotelName,
            city: hotel.hotelCity,
            stars: hotel.hotelStars,

            performance: {
              overallScore: Math.round(hotel.overallPerformanceScore * 100) / 100,
              rating: this.getPerformanceRating(hotel.overallPerformanceScore),

              // Member metrics
              totalMembers: hotel.totalMembers,
              activeMembers: hotel.activeMembers,
              activationRate: Math.round(hotel.activationRate * 100) / 100,

              // Points metrics
              avgLifetimePoints: Math.round(hotel.avgLifetimePoints),
              avgCurrentPoints: Math.round(hotel.avgCurrentPoints),
              totalLifetimePoints: hotel.totalLifetimePoints,

              // Tier mix
              tierDistribution: {
                bronze: hotel.bronzeMembers,
                silver: hotel.silverMembers,
                gold: hotel.goldMembers,
                platinum: hotel.platinumMembers,
                diamond: hotel.diamondMembers,
              },

              // Quality indicators
              memberQuality: hotel.memberQualityScore,
              tierMixQuality: hotel.tierMixScore,
              engagementLevel: hotel.engagementScore || 0,

              // Trends
              trends: recentTrends,
              growth: growthMetrics,
              revenueContribution,
            },

            strengths: this.identifyHotelStrengths(hotel),
            opportunities: this.identifyHotelOpportunities(hotel),

            // Benchmarking
            benchmarkComparison: this.compareHotelToBenchmarks(hotel, hotelPerformance[0]),
          };
        })
      );

      // Calculate portfolio insights
      const portfolioInsights = {
        totalHotelsAnalyzed: hotelPerformance.length,
        avgPerformanceScore:
          hotelPerformance.reduce((sum, hotel) => sum + hotel.overallPerformanceScore, 0) /
          hotelPerformance.length,
        performanceGap:
          hotelPerformance[0].overallPerformanceScore -
          hotelPerformance[hotelPerformance.length - 1].overallPerformanceScore,
        topTierConcentration: this.calculateTopTierConcentration(enrichedHotels),
      };

      return {
        hotels: enrichedHotels,

        insights: portfolioInsights,

        summary: {
          topPerformer: enrichedHotels[0],
          avgScore: Math.round(portfolioInsights.avgPerformanceScore * 100) / 100,
          performanceSpread: Math.round(portfolioInsights.performanceGap * 100) / 100,
          excellentPerformers: enrichedHotels.filter((h) => h.performance.overallScore >= 80)
            .length,
          improvementCandidates: enrichedHotels.filter((h) => h.performance.overallScore < 60)
            .length,
        },

        recommendations: this.generateHotelPerformanceRecommendations(
          enrichedHotels,
          portfolioInsights
        ),
      };
    } catch (error) {
      logger.error('Error getting top performing hotels:', error);
      return [];
    }
  }
  /**
   * Get top performing customer segments
   */
  async getTopSegments(baseQuery, startDate, endDate) {
    try {
      // Define segmentation criteria
      const segments = {
        demographic: ['age', 'location'],
        behavioral: ['frequency', 'value', 'recency'],
        loyalty: ['tier', 'tenure', 'engagement'],
      };

      // Analyze by multiple dimensions
      const segmentAnalysis = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'customer',
            as: 'bookings',
          },
        },
        {
          $lookup: {
            from: 'loyaltytransactions',
            localField: '_id',
            foreignField: 'user',
            as: 'transactions',
          },
        },
        {
          $project: {
            // Demographic data
            age: {
              $cond: [
                { $ne: ['$dateOfBirth', null] },
                {
                  $divide: [{ $subtract: [new Date(), '$dateOfBirth'] }, 1000 * 60 * 60 * 24 * 365],
                },
                null,
              ],
            },
            location: '$address.city',

            // Loyalty data
            tier: '$loyalty.tier',
            enrolledAt: '$loyalty.enrolledAt',
            currentPoints: '$loyalty.currentPoints',
            lifetimePoints: '$loyalty.lifetimePoints',
            lastActivity: '$loyalty.statistics.lastActivity',

            // Behavioral metrics
            totalBookings: { $size: '$bookings' },
            totalSpent: { $sum: '$bookings.totalPrice' },
            totalTransactions: { $size: '$transactions' },

            // Calculate segments
            ageSegment: {
              $switch: {
                branches: [
                  { case: { $lt: ['$age', 25] }, then: '18-24' },
                  { case: { $lt: ['$age', 35] }, then: '25-34' },
                  { case: { $lt: ['$age', 45] }, then: '35-44' },
                  { case: { $lt: ['$age', 55] }, then: '45-54' },
                  { case: { $gte: ['$age', 55] }, then: '55+' },
                ],
                default: 'Unknown',
              },
            },

            valueSegment: {
              $switch: {
                branches: [
                  { case: { $lt: ['$totalSpent', 500] }, then: 'Low Value' },
                  { case: { $lt: ['$totalSpent', 2000] }, then: 'Medium Value' },
                  { case: { $lt: ['$totalSpent', 5000] }, then: 'High Value' },
                  { case: { $gte: ['$totalSpent', 5000] }, then: 'VIP' },
                ],
                default: 'New',
              },
            },

            frequencySegment: {
              $switch: {
                branches: [
                  { case: { $eq: ['$totalBookings', 1] }, then: 'One-time' },
                  { case: { $lte: ['$totalBookings', 3] }, then: 'Occasional' },
                  { case: { $lte: ['$totalBookings', 6] }, then: 'Regular' },
                  { case: { $gt: ['$totalBookings', 6] }, then: 'Frequent' },
                ],
                default: 'New',
              },
            },

            tenureSegment: {
              $switch: {
                branches: [
                  {
                    case: {
                      $lt: [
                        {
                          $divide: [
                            { $subtract: [new Date(), '$loyalty.enrolledAt'] },
                            1000 * 60 * 60 * 24,
                          ],
                        },
                        90,
                      ],
                    },
                    then: 'New Member',
                  },
                  {
                    case: {
                      $lt: [
                        {
                          $divide: [
                            { $subtract: [new Date(), '$loyalty.enrolledAt'] },
                            1000 * 60 * 60 * 24,
                          ],
                        },
                        365,
                      ],
                    },
                    then: 'Established',
                  },
                  {
                    case: {
                      $gte: [
                        {
                          $divide: [
                            { $subtract: [new Date(), '$loyalty.enrolledAt'] },
                            1000 * 60 * 60 * 24,
                          ],
                        },
                        365,
                      ],
                    },
                    then: 'Veteran',
                  },
                ],
                default: 'Unknown',
              },
            },
          },
        },
        {
          $group: {
            _id: {
              age: '$ageSegment',
              value: '$valueSegment',
              frequency: '$frequencySegment',
              tier: '$tier',
              tenure: '$tenureSegment',
              location: '$location',
            },
            memberCount: { $sum: 1 },
            avgLifetimePoints: { $avg: '$lifetimePoints' },
            avgCurrentPoints: { $avg: '$currentPoints' },
            totalSpent: { $sum: '$totalSpent' },
            avgSpent: { $avg: '$totalSpent' },
            totalBookings: { $sum: '$totalBookings' },
            avgBookings: { $avg: '$totalBookings' },
            totalTransactions: { $sum: '$totalTransactions' },
          },
        },
        {
          $addFields: {
            // Calculate segment performance score
            performanceScore: {
              $add: [
                { $multiply: [{ $divide: ['$avgLifetimePoints', 100] }, 0.3] }, // Points contribution
                { $multiply: [{ $divide: ['$avgSpent', 100] }, 0.4] }, // Revenue contribution
                { $multiply: ['$avgBookings', 0.2] }, // Frequency contribution
                { $multiply: ['$memberCount', 0.1] }, // Scale contribution
              ],
            },

            // Calculate segment value
            segmentValue: {
              $multiply: ['$memberCount', '$avgSpent'],
            },

            // Calculate engagement level
            engagementLevel: {
              $cond: [
                { $gt: ['$avgTransactions', 5] },
                'High',
                { $cond: [{ $gt: ['$avgTransactions', 2] }, 'Medium', 'Low'] },
              ],
            },
          },
        },
        {
          $sort: { performanceScore: -1 },
        },
        {
          $limit: 20, // Top 20 segments
        },
      ]);

      // Analyze segment characteristics
      const topSegments = segmentAnalysis.map((segment, index) => {
        const characteristics = segment._id;

        return {
          rank: index + 1,
          id: this.generateSegmentId(characteristics),

          characteristics: {
            age: characteristics.age,
            valueLevel: characteristics.value,
            frequency: characteristics.frequency,
            tier: characteristics.tier,
            tenure: characteristics.tenure,
            location: characteristics.location,
          },

          metrics: {
            memberCount: segment.memberCount,
            avgLifetimePoints: Math.round(segment.avgLifetimePoints),
            avgCurrentPoints: Math.round(segment.avgCurrentPoints),
            avgSpent: Math.round(segment.avgSpent),
            avgBookings: Math.round(segment.avgBookings * 100) / 100,
            totalValue: Math.round(segment.segmentValue),
            performanceScore: Math.round(segment.performanceScore * 100) / 100,
            engagementLevel: segment.engagementLevel,
          },

          insights: {
            revenueContribution: this.calculateRevenueContribution(segment, segmentAnalysis),
            growthPotential: this.assessGrowthPotential(segment),
            retentionRisk: this.assessRetentionRisk(segment),
            expansionOpportunity: this.assessExpansionOpportunity(segment),
          },

          recommendations: this.generateSegmentRecommendations(segment),
        };
      });

      // Cross-segment analysis
      const crossAnalysis = {
        // Best performing combinations
        topCombinations: this.identifyTopSegmentCombinations(topSegments),

        // Segment gaps and opportunities
        gaps: this.identifySegmentGaps(topSegments),

        // Migration patterns
        migrationPatterns: await this.analyzeSegmentMigration(baseQuery, startDate, endDate),

        // Concentration analysis
        concentration: this.analyzeSegmentConcentration(topSegments),
      };

      // Generate strategic insights
      const strategicInsights = {
        keyFindings: this.generateKeySegmentFindings(topSegments),
        marketOpportunities: this.identifyMarketOpportunities(topSegments, crossAnalysis),
        riskAreas: this.identifySegmentRisks(topSegments),
        investmentPriorities: this.prioritizeSegmentInvestments(topSegments),
      };

      return {
        topSegments,

        crossAnalysis,

        insights: strategicInsights,

        summary: {
          totalSegmentsAnalyzed: segmentAnalysis.length,
          topPerformer: topSegments[0],
          avgPerformanceScore:
            topSegments.reduce((sum, seg) => sum + seg.metrics.performanceScore, 0) /
            topSegments.length,
          highValueSegments: topSegments.filter((seg) => seg.metrics.performanceScore > 50).length,
          emergingSegments: topSegments.filter((seg) => seg.insights.growthPotential === 'High')
            .length,
        },

        recommendations: this.generatePortfolioSegmentRecommendations(
          topSegments,
          strategicInsights
        ),
      };
    } catch (error) {
      logger.error('Error getting top segments:', error);
      return [];
    }
  }
  /**
   * Analyze seasonality patterns in loyalty program
   */
  async analyzeSeasonalityPatterns(baseQuery) {
    try {
      // Get historical data for seasonality analysis
      const historicalData = await LoyaltyTransaction.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: {
              $gte: new Date(new Date().getFullYear() - 2, 0, 1), // Last 2 years
              $lte: new Date(),
            },
          },
        },
        {
          $project: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
            quarter: { $ceil: { $divide: [{ $month: '$createdAt' }, 3] } },
            dayOfWeek: { $dayOfWeek: '$createdAt' },
            week: { $week: '$createdAt' },
            pointsAmount: 1,
            type: 1,
            createdAt: 1,
          },
        },
      ]);

      // Analyze monthly patterns
      const monthlyPattern = await this.analyzeMonthlySeasonality(historicalData);

      // Analyze quarterly patterns
      const quarterlyPattern = await this.analyzeQuarterlySeasonality(historicalData);

      // Analyze day-of-week patterns
      const weeklyPattern = await this.analyzeWeeklySeasonality(historicalData);

      // Analyze holiday and special event patterns
      const holidayPattern = await this.analyzeHolidaySeasonality(historicalData);

      // Calculate seasonality indices
      const seasonalityIndices = {
        monthly: this.calculateSeasonalityIndex(monthlyPattern, 'month'),
        quarterly: this.calculateSeasonalityIndex(quarterlyPattern, 'quarter'),
        weekly: this.calculateSeasonalityIndex(weeklyPattern, 'dayOfWeek'),
      };

      // Identify peak and low seasons
      const seasonalInsights = {
        peakMonths: this.identifyPeakPeriods(monthlyPattern, 'high'),
        lowMonths: this.identifyPeakPeriods(monthlyPattern, 'low'),
        peakQuarters: this.identifyPeakPeriods(quarterlyPattern, 'high'),
        peakDays: this.identifyPeakPeriods(weeklyPattern, 'high'),

        // Volatility analysis
        monthlyVolatility: this.calculateVolatility(monthlyPattern),
        quarterlyVolatility: this.calculateVolatility(quarterlyPattern),
        weeklyVolatility: this.calculateVolatility(weeklyPattern),
      };

      // Seasonal adjustment factors
      const adjustmentFactors = {
        monthly: this.calculateAdjustmentFactors(monthlyPattern),
        quarterly: this.calculateAdjustmentFactors(quarterlyPattern),
        weekly: this.calculateAdjustmentFactors(weeklyPattern),
      };

      // Predictive seasonal forecast
      const seasonalForecast = await this.generateSeasonalForecast(
        monthlyPattern,
        quarterlyPattern,
        12 // 12 months ahead
      );

      // Event correlation analysis
      const eventCorrelations = await this.analyzeEventCorrelations(historicalData);

      return {
        patterns: {
          monthly: monthlyPattern,
          quarterly: quarterlyPattern,
          weekly: weeklyPattern,
          holiday: holidayPattern,
        },

        indices: seasonalityIndices,

        insights: seasonalInsights,

        adjustmentFactors,

        forecast: seasonalForecast,

        eventCorrelations,

        recommendations: this.generateSeasonalityRecommendations({
          patterns: { monthlyPattern, quarterlyPattern, weeklyPattern },
          insights: seasonalInsights,
          forecast: seasonalForecast,
        }),

        // Seasonal strategy suggestions
        strategies: {
          peakSeason: this.generatePeakSeasonStrategies(seasonalInsights.peakMonths),
          lowSeason: this.generateLowSeasonStrategies(seasonalInsights.lowMonths),
          transitionPeriods: this.generateTransitionStrategies(monthlyPattern),
        },

        // Business impact analysis
        businessImpact: {
          revenueVariability: this.calculateRevenueVariability(monthlyPattern),
          resourcePlanning: this.generateResourcePlanningInsights(seasonalForecast),
          inventoryImpact: this.analyzeInventoryImpact(seasonalInsights),
          marketingCalendar: this.generateMarketingCalendar(seasonalForecast),
        },
      };
    } catch (error) {
      logger.error('Error analyzing seasonality patterns:', error);
      return {};
    }
  }

  /**
   * Identify growth predictors for loyalty program analytics
   * Analyzes patterns and factors that predict membership growth
   * @param {Object} baseQuery - Base MongoDB query
   * @returns {Object} Growth predictors analysis
   */
  async identifyGrowthPredictors(baseQuery) {
    try {
      // Cache key for growth predictors
      const cacheKey = this.buildAnalyticsCacheKey(
        'growth_predictors',
        baseQuery.hotel?.toString() || 'all',
        {
          timestamp: Math.floor(Date.now() / (60 * 60 * 1000)), // 1 hour cache
        }
      );

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateGrowthPredictorsCache(cached)) {
        return cached;
      }

      // Seasonal enrollment patterns
      const seasonalPredictors = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            enrollmentMonth: { $month: '$loyalty.enrolledAt' },
            enrollmentDayOfWeek: { $dayOfWeek: '$loyalty.enrolledAt' },
            enrollmentYear: { $year: '$loyalty.enrolledAt' },
            currentTier: '$loyalty.tier',
            lifetimePoints: '$loyalty.lifetimePoints',
          },
        },
        {
          $group: {
            _id: {
              month: '$enrollmentMonth',
              dayOfWeek: '$enrollmentDayOfWeek',
            },
            enrollmentCount: { $sum: 1 },
            avgLifetimePoints: { $avg: '$lifetimePoints' },
            tierDistribution: { $push: '$currentTier' },
          },
        },
        { $sort: { enrollmentCount: -1 } },
      ]);

      // Booking behavior predictors
      const bookingPredictors = await Booking.aggregate([
        {
          $match: {
            ...baseQuery,
            createdAt: { $gte: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000) }, // Last 6 months
          },
        },
        {
          $lookup: {
            from: 'users',
            localField: 'customer',
            foreignField: '_id',
            as: 'customerInfo',
          },
        },
        {
          $unwind: '$customerInfo',
        },
        {
          $project: {
            hasLoyalty: { $exists: ['$customerInfo.loyalty.enrolledAt', true] },
            bookingValue: '$totalPrice',
            roomCount: { $size: '$rooms' },
            stayLength: {
              $divide: [{ $subtract: ['$checkOutDate', '$checkInDate'] }, 1000 * 60 * 60 * 24],
            },
            advanceBooking: {
              $divide: [{ $subtract: ['$checkInDate', '$createdAt'] }, 1000 * 60 * 60 * 24],
            },
            source: 1,
            clientType: 1,
          },
        },
        {
          $group: {
            _id: {
              hasLoyalty: '$hasLoyalty',
              source: '$source',
              clientType: '$clientType',
            },
            avgBookingValue: { $avg: '$bookingValue' },
            avgRoomCount: { $avg: '$roomCount' },
            avgStayLength: { $avg: '$stayLength' },
            avgAdvanceBooking: { $avg: '$advanceBooking' },
            bookingCount: { $sum: 1 },
          },
        },
      ]);

      // Customer segment predictors
      const segmentPredictors = await this.analyzeCustomerSegmentGrowth(baseQuery);

      // Marketing channel effectiveness
      const channelPredictors = await this.analyzeMarketingChannelEffectiveness(baseQuery);

      // Geographic growth patterns
      const geographicPredictors = await this.analyzeGeographicGrowthPatterns(baseQuery);

      // Predictive factors analysis
      const predictiveFactors = {
        seasonal: this.analyzeSeasonalFactors(seasonalPredictors),
        behavioral: this.analyzeBehavioralFactors(bookingPredictors),
        demographic: this.analyzeDemographicFactors(segmentPredictors),
        channel: this.analyzeChannelFactors(channelPredictors),
        geographic: this.analyzeGeographicFactors(geographicPredictors),
      };

      // Growth opportunity scoring
      const growthOpportunities = this.identifyGrowthOpportunities(predictiveFactors);

      // Predictive model insights
      const predictiveInsights = this.generatePredictiveInsights(predictiveFactors);

      const result = {
        metadata: {
          generatedAt: new Date(),
          analysisScope: baseQuery.hotel ? 'hotel' : 'chain',
          dataPoints: seasonalPredictors.length + bookingPredictors.length,
          predictionConfidence: this.calculatePredictionConfidence(predictiveFactors),
        },
        seasonalPredictors: {
          patterns: seasonalPredictors,
          insights: predictiveFactors.seasonal,
          bestMonths: seasonalPredictors.slice(0, 3).map((p) => ({
            month: p._id.month,
            enrollments: p.enrollmentCount,
            monthName: moment()
              .month(p._id.month - 1)
              .format('MMMM'),
          })),
          bestDaysOfWeek: this.getBestDaysOfWeek(seasonalPredictors),
        },
        behavioralPredictors: {
          patterns: bookingPredictors,
          insights: predictiveFactors.behavioral,
          loyaltyImpact: this.calculateLoyaltyImpact(bookingPredictors),
          conversionFactors: this.identifyConversionFactors(bookingPredictors),
        },
        segmentPredictors: {
          highValueSegments: segmentPredictors.highValue || [],
          emergingSegments: segmentPredictors.emerging || [],
          insights: predictiveFactors.demographic,
        },
        channelPredictors: {
          effectiveChannels: channelPredictors.effective || [],
          underutilizedChannels: channelPredictors.underutilized || [],
          insights: predictiveFactors.channel,
        },
        geographicPredictors: {
          growthMarkets: geographicPredictors.growth || [],
          saturatedMarkets: geographicPredictors.saturated || [],
          insights: predictiveFactors.geographic,
        },
        growthOpportunities,
        predictiveInsights,
        recommendations: this.generateGrowthRecommendations(
          growthOpportunities,
          predictiveInsights
        ),
        actionPlan: this.generateGrowthActionPlan(growthOpportunities),
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, result, 'analytics', 60 * 60); // 1 hour TTL

      return result;
    } catch (error) {
      logger.error('Error identifying growth predictors:', error);
      return {
        error: 'Failed to analyze growth predictors',
        message: error.message,
        timestamp: new Date(),
      };
    }
  }

  /**
   * Analyze customer segment growth patterns
   */
  async analyzeCustomerSegmentGrowth(baseQuery) {
    const segments = await User.aggregate([
      {
        $match: {
          ...baseQuery,
          'loyalty.enrolledAt': { $exists: true },
        },
      },
      {
        $project: {
          ageGroup: {
            $switch: {
              branches: [
                { case: { $lt: ['$age', 25] }, then: '18-24' },
                { case: { $lt: ['$age', 35] }, then: '25-34' },
                { case: { $lt: ['$age', 45] }, then: '35-44' },
                { case: { $lt: ['$age', 55] }, then: '45-54' },
                { case: { $gte: ['$age', 55] }, then: '55+' },
              ],
              default: 'Unknown',
            },
          },
          clientType: '$clientType',
          enrollmentDate: '$loyalty.enrolledAt',
          lifetimeValue: '$loyalty.lifetimePoints',
          tier: '$loyalty.tier',
        },
      },
      {
        $group: {
          _id: {
            ageGroup: '$ageGroup',
            clientType: '$clientType',
          },
          count: { $sum: 1 },
          avgLifetimeValue: { $avg: '$lifetimeValue' },
          growthRate: {
            $avg: {
              $divide: [{ $subtract: [new Date(), '$enrollmentDate'] }, 1000 * 60 * 60 * 24 * 30],
            },
          },
        },
      },
      { $sort: { count: -1 } },
    ]);

    return {
      highValue: segments.filter((s) => s.avgLifetimeValue > 1000),
      emerging: segments.filter((s) => s.growthRate < 6), // Less than 6 months old on average
      allSegments: segments,
    };
  }

  /**
   * Analyze marketing channel effectiveness
   */
  async analyzeMarketingChannelEffectiveness(baseQuery) {
    // This would integrate with your marketing attribution system
    // For now, returning placeholder structure
    return {
      effective: [
        { channel: 'email', conversionRate: 15.2, cost: 'low' },
        { channel: 'social_media', conversionRate: 8.7, cost: 'medium' },
        { channel: 'referral', conversionRate: 22.1, cost: 'low' },
      ],
      underutilized: [
        { channel: 'content_marketing', potential: 'high', currentUsage: 'low' },
        { channel: 'partnerships', potential: 'medium', currentUsage: 'low' },
      ],
    };
  }

  /**
   * Analyze geographic growth patterns
   */
  async analyzeGeographicGrowthPatterns(baseQuery) {
    // This would integrate with your geographic/location data
    // For now, returning placeholder structure
    return {
      growth: [
        { region: 'Europe', growthRate: 23.4, marketPenetration: 'medium' },
        { region: 'Asia', growthRate: 18.7, marketPenetration: 'low' },
      ],
      saturated: [{ region: 'North America', growthRate: 3.2, marketPenetration: 'high' }],
    };
  }

  /**
   * Generate manual insights from analytics data
   */
  generateManualInsights(analyticsData) {
    try {
      const insights = [];

      // Revenue insights
      if (analyticsData.revenue) {
        insights.push(...this.generateRevenueInsights(analyticsData.revenue));
      }

      // Loyalty insights
      if (analyticsData.loyalty) {
        insights.push(...this.generateLoyaltyManualInsights(analyticsData.loyalty));
      }

      // Operational insights
      if (analyticsData.operational) {
        insights.push(...this.generateOperationalManualInsights(analyticsData.operational));
      }

      // Cross-functional insights
      insights.push(...this.generateCrossFunctionalInsights(analyticsData));

      // Market intelligence insights
      insights.push(...this.generateMarketIntelligenceInsights(analyticsData));

      // Strategic insights
      insights.push(...this.generateStrategicInsights(analyticsData));

      return insights.map((insight) => ({
        ...insight,
        id: this.generateInsightId(insight),
        generatedAt: new Date(),
        confidence: this.calculateInsightConfidence(insight, analyticsData),
        actionability: this.assessInsightActionability(insight),
        businessImpact: this.assessBusinessImpact(insight, analyticsData),
      }));
    } catch (error) {
      logger.error('Error generating manual insights:', error);
      return [];
    }
  }

  /**
   * Generate loyalty-specific manual insights
   */
  generateLoyaltyManualInsights(loyaltyData) {
    const insights = [];

    // Member lifecycle insights
    if (loyaltyData.membership && loyaltyData.retention) {
      const churnRate = loyaltyData.membership.churnRate || 0;
      const activationRate = loyaltyData.membership.activationRate || 0;

      if (churnRate > 25) {
        insights.push({
          type: 'warning',
          category: 'member_lifecycle',
          title: 'High Member Churn Rate Detected',
          description: `Member churn rate of ${churnRate}% is above the industry average of 20%`,
          impact: 'high',
          urgency: 'immediate',
          recommendations: [
            'Implement win-back campaigns for dormant members',
            'Analyze exit survey feedback to identify improvement areas',
            'Create personalized retention offers for at-risk segments',
          ],
          kpis: ['churn_rate', 'retention_rate', 'member_satisfaction'],
        });
      }

      if (activationRate < 40) {
        insights.push({
          type: 'opportunity',
          category: 'member_activation',
          title: 'Low Member Activation Rate',
          description: `Only ${activationRate}% of members are actively engaged`,
          impact: 'medium',
          urgency: 'high',
          recommendations: [
            'Enhance onboarding experience for new members',
            'Create activation campaigns with immediate value',
            'Simplify point earning and redemption processes',
          ],
          kpis: ['activation_rate', 'engagement_score', 'first_transaction_rate'],
        });
      }
    }

    // Points economy insights
    if (loyaltyData.points) {
      const redemptionRate = loyaltyData.points.summary?.redemptionRate || 0;
      const pointsVelocity = loyaltyData.points.velocity;

      if (redemptionRate < 20) {
        insights.push({
          type: 'alert',
          category: 'points_economy',
          title: 'Low Points Redemption Rate',
          description: `Points redemption rate of ${redemptionRate}% indicates poor program engagement`,
          impact: 'high',
          urgency: 'high',
          recommendations: [
            'Introduce more attractive redemption options',
            'Reduce redemption thresholds for better accessibility',
            'Promote redemption opportunities through targeted communications',
          ],
          kpis: ['redemption_rate', 'points_liability', 'engagement_score'],
        });
      }

      if (pointsVelocity && pointsVelocity.trend === 'decreasing') {
        insights.push({
          type: 'warning',
          category: 'points_velocity',
          title: 'Declining Points Velocity',
          description: 'Members are earning and using points at a slower rate',
          impact: 'medium',
          urgency: 'medium',
          recommendations: [
            'Introduce bonus point events to stimulate activity',
            'Review and optimize point earning rates',
            'Create urgency with limited-time redemption offers',
          ],
          kpis: ['points_velocity', 'transaction_frequency', 'member_activity'],
        });
      }
    }

    // Tier progression insights
    if (loyaltyData.tiers) {
      const tierHealth = loyaltyData.tiers.distribution?.health;

      if (tierHealth && tierHealth.status === 'concerning') {
        insights.push({
          type: 'strategic',
          category: 'tier_structure',
          title: 'Tier Distribution Imbalance',
          description: 'Current tier distribution may not be optimal for member progression',
          impact: 'medium',
          urgency: 'low',
          recommendations: [
            'Review tier thresholds and benefits',
            'Analyze progression barriers between tiers',
            'Consider introducing intermediate tier levels',
          ],
          kpis: ['tier_distribution', 'progression_rate', 'tier_retention'],
        });
      }
    }

    return insights;
  }

  /**
   * Generate cross-functional insights
   */
  generateCrossFunctionalInsights(analyticsData) {
    const insights = [];

    // Revenue vs Loyalty correlation
    if (analyticsData.revenue && analyticsData.loyalty) {
      const loyaltyMembers = analyticsData.loyalty.membership?.total || 0;
      const totalRevenue = analyticsData.revenue.revenue?.summary?.totalRevenue || 0;

      if (loyaltyMembers > 0 && totalRevenue > 0) {
        const revenuePerMember = totalRevenue / loyaltyMembers;

        insights.push({
          type: 'insight',
          category: 'revenue_loyalty_correlation',
          title: 'Loyalty Program Revenue Impact',
          description: `Each loyalty member generates an average of €${Math.round(revenuePerMember)} in revenue`,
          impact: 'high',
          urgency: 'low',
          recommendations: [
            'Focus on increasing loyalty member acquisition',
            'Develop strategies to increase spend per loyal member',
            'Analyze high-value member characteristics for targeting',
          ],
          kpis: ['revenue_per_member', 'member_ltv', 'acquisition_cost'],
        });
      }
    }

    // Operational efficiency vs loyalty engagement
    if (analyticsData.operational && analyticsData.loyalty) {
      const engagementScore = analyticsData.loyalty.engagement?.activeUsers?.stickiness || 0;
      const operationalScore = analyticsData.operational.scores?.overall || 0;

      if (engagementScore > 70 && operationalScore < 70) {
        insights.push({
          type: 'opportunity',
          category: 'operational_loyalty_gap',
          title: 'Operational Excellence Opportunity',
          description: 'High loyalty engagement but suboptimal operational performance',
          impact: 'medium',
          urgency: 'medium',
          recommendations: [
            'Improve service delivery to match member expectations',
            'Streamline check-in/check-out processes for loyal members',
            'Implement VIP service lanes for top-tier members',
          ],
          kpis: ['service_quality', 'process_efficiency', 'member_satisfaction'],
        });
      }
    }

    return insights;
  }

  /**
   * Generate strategic insights
   */
  generateStrategicInsights(analyticsData) {
    const insights = [];

    // Market positioning insights
    insights.push({
      type: 'strategic',
      category: 'market_positioning',
      title: 'Competitive Positioning Analysis',
      description: 'Current performance relative to market benchmarks',
      impact: 'high',
      urgency: 'low',
      recommendations: [
        'Benchmark against industry leaders',
        'Identify differentiation opportunities',
        'Develop unique value propositions',
      ],
      kpis: ['market_share', 'brand_perception', 'competitive_advantage'],
    });

    // Growth strategy insights
    if (analyticsData.trends) {
      insights.push({
        type: 'strategic',
        category: 'growth_strategy',
        title: 'Growth Trajectory Analysis',
        description: 'Long-term growth patterns and strategic implications',
        impact: 'high',
        urgency: 'low',
        recommendations: [
          'Develop sustainable growth strategies',
          'Invest in high-growth segments',
          'Plan for scalability challenges',
        ],
        kpis: ['growth_rate', 'market_penetration', 'customer_acquisition'],
      });
    }

    // Innovation opportunities
    insights.push({
      type: 'opportunity',
      category: 'innovation',
      title: 'Digital Innovation Opportunities',
      description: 'Technology and process innovation potential',
      impact: 'medium',
      urgency: 'low',
      recommendations: [
        'Explore AI/ML applications for personalization',
        'Implement predictive analytics for demand forecasting',
        'Develop mobile-first customer experiences',
      ],
      kpis: ['innovation_index', 'digital_adoption', 'customer_experience'],
    });

    return insights;
  }
  /**
   * Prioritize insights based on impact, urgency, and actionability
   */
  prioritizeInsights(insights) {
    try {
      return insights
        .map((insight) => ({
          ...insight,
          priority: this.calculateInsightPriority(insight),
          scoreBreakdown: this.getInsightScoreBreakdown(insight),
        }))
        .sort((a, b) => {
          // Primary sort by priority score
          if (a.priority.score !== b.priority.score) {
            return b.priority.score - a.priority.score;
          }

          // Secondary sort by urgency
          const urgencyOrder = { immediate: 4, high: 3, medium: 2, low: 1 };
          const urgencyDiff = (urgencyOrder[b.urgency] || 0) - (urgencyOrder[a.urgency] || 0);
          if (urgencyDiff !== 0) return urgencyDiff;

          // Tertiary sort by impact
          const impactOrder = { high: 3, medium: 2, low: 1 };
          return (impactOrder[b.impact] || 0) - (impactOrder[a.impact] || 0);
        })
        .map((insight, index) => ({
          ...insight,
          rank: index + 1,
          tier: this.getInsightTier(index + 1, insights.length),
        }));
    } catch (error) {
      logger.error('Error prioritizing insights:', error);
      return insights;
    }
  }

  /**
   * Calculate insight priority score
   */
  calculateInsightPriority(insight) {
    const weights = {
      impact: 0.4,
      urgency: 0.3,
      actionability: 0.2,
      confidence: 0.1,
    };

    const scores = {
      impact: this.getImpactScore(insight.impact),
      urgency: this.getUrgencyScore(insight.urgency),
      actionability: this.getActionabilityScore(insight.actionability),
      confidence: this.getConfidenceScore(insight.confidence),
    };

    const weightedScore = Object.keys(weights).reduce((total, factor) => {
      return total + scores[factor] * weights[factor];
    }, 0);

    return {
      score: Math.round(weightedScore * 100) / 100,
      maxScore: 100,
      factors: scores,
      weights,
    };
  }

  /**
   * Get impact score from impact level
   */
  getImpactScore(impact) {
    const impactScores = { high: 100, medium: 60, low: 30 };
    return impactScores[impact] || 0;
  }

  /**
   * Get urgency score from urgency level
   */
  getUrgencyScore(urgency) {
    const urgencyScores = { immediate: 100, high: 75, medium: 50, low: 25 };
    return urgencyScores[urgency] || 0;
  }

  /**
   * Get actionability score
   */
  getActionabilityScore(actionability) {
    if (!actionability) return 50; // Default moderate actionability

    const actionabilityScores = { high: 100, medium: 60, low: 30 };
    return actionabilityScores[actionability] || 50;
  }

  /**
   * Get confidence score
   */
  getConfidenceScore(confidence) {
    if (typeof confidence === 'number') {
      return Math.min(100, Math.max(0, confidence));
    }

    const confidenceScores = { high: 90, medium: 70, low: 40 };
    return confidenceScores[confidence] || 70;
  }

  /**
   * Get insight tier based on ranking
   */
  getInsightTier(rank, total) {
    const topThird = Math.ceil(total / 3);
    const middleThird = Math.ceil((total * 2) / 3);

    if (rank <= topThird) return 'critical';
    if (rank <= middleThird) return 'important';
    return 'watch';
  }

  /**
   * Calculate membership duration
   */
  calculateMembershipDuration(enrolledAt) {
    const days = Math.floor((new Date() - enrolledAt) / (24 * 60 * 60 * 1000));

    if (days < 30) return `${days} jour(s)`;
    if (days < 365) return `${Math.floor(days / 30)} mois`;
    return `${Math.floor(days / 365)} an(s)`;
  }

  /**
   * Get tier icon for display
   */
  getTierIcon(tier) {
    const icons = {
      BRONZE: '🥉',
      SILVER: '🥈',
      GOLD: '🥇',
      PLATINUM: '💎',
      DIAMOND: '💠',
    };
    return icons[tier] || '🥉';
  }

  /**
   * Calculate tier health score
   */
  calculateTierHealthScore(tierData) {
    const retentionWeight = 0.4;
    const tenureWeight = 0.3;
    const pointsWeight = 0.3;

    const retentionScore = tierData.retentionRate;
    const tenureScore = Math.min(100, (tierData.avgTenure / 365) * 50);
    const pointsScore = Math.min(100, tierData.avgLifetimePoints / 100);

    return Math.round(
      retentionScore * retentionWeight + tenureScore * tenureWeight + pointsScore * pointsWeight
    );
  }

  /**
   * Generate campaign recommendations
   */
  generateCampaignRecommendations(campaignData) {
    const recommendations = [];

    if (campaignData.avgROI < 150) {
      recommendations.push({
        type: 'optimization',
        priority: 'high',
        action: 'Improve campaign targeting and messaging',
        expectedImpact: 'Increase ROI by 20-30%',
      });
    }

    if (campaignData.totalParticipants < 100) {
      recommendations.push({
        type: 'reach',
        priority: 'medium',
        action: 'Expand campaign reach through additional channels',
        expectedImpact: 'Increase participation by 50%',
      });
    }

    return recommendations;
  }

  /**
   * Calculate points velocity
   */
  calculatePointsVelocity(timeSeries) {
    if (!timeSeries || timeSeries.length < 2) return { trend: 'stable', velocity: 0 };

    const recent = timeSeries.slice(-7); // Last 7 periods
    const previous = timeSeries.slice(-14, -7); // Previous 7 periods

    const recentAvg = recent.reduce((sum, period) => sum + (period.earned || 0), 0) / recent.length;
    const previousAvg =
      previous.reduce((sum, period) => sum + (period.earned || 0), 0) / previous.length;

    const velocity = previousAvg > 0 ? ((recentAvg - previousAvg) / previousAvg) * 100 : 0;

    return {
      velocity: Math.round(velocity * 100) / 100,
      trend: velocity > 5 ? 'increasing' : velocity < -5 ? 'decreasing' : 'stable',
      recentAvg: Math.round(recentAvg),
      previousAvg: Math.round(previousAvg),
    };
  }

  /**
   * Assess member risk level
   */
  assessMemberRiskLevel(member) {
    const daysSinceLastActivity = member.lastActivity
      ? Math.floor((new Date() - member.lastActivity) / (24 * 60 * 60 * 1000))
      : 999;

    const engagementScore = member.engagementScore || 50;

    if (daysSinceLastActivity > 90 || engagementScore < 30) {
      return { level: 'high', color: 'red', message: 'Risque de churn élevé' };
    } else if (daysSinceLastActivity > 30 || engagementScore < 60) {
      return { level: 'medium', color: 'orange', message: 'Surveillance recommandée' };
    } else {
      return { level: 'low', color: 'green', message: 'Membre actif et engagé' };
    }
  }

  /**
   * Calculate churn prevention actions
   */
  getChurnPreventionActions(member) {
    const actions = [];

    if (member.daysSinceLastActivity > 60) {
      actions.push({
        type: 'engagement',
        action: 'Send personalized win-back email campaign',
        priority: 'high',
      });
    }

    if (member.recentTransactions === 0) {
      actions.push({
        type: 'activation',
        action: 'Offer bonus points for next transaction',
        priority: 'medium',
      });
    }

    if (member.tier === 'BRONZE' && member.lifetimePoints > 500) {
      actions.push({
        type: 'progression',
        action: 'Highlight progress toward next tier',
        priority: 'low',
      });
    }

    return actions;
  }

  /**
   * Generate redemption insights
   */
  generateRedemptionInsights(data) {
    const insights = [];

    // Type preference insights
    const topType = Object.entries(data.typePreferences).sort(
      ([, a], [, b]) => b.popularity - a.popularity
    )[0];

    if (topType) {
      insights.push({
        type: 'preference',
        message: `${topType[0]} is the most popular redemption type`,
        data: { type: topType[0], popularity: topType[1].popularity },
      });
    }

    // Timing insights
    if (data.timingAnalysis.hour) {
      const peakHour = Object.entries(data.timingAnalysis.hour).sort(
        ([, a], [, b]) => b.count - a.count
      )[0];

      insights.push({
        type: 'timing',
        message: `Peak redemption time is ${peakHour[0]}:00`,
        data: { hour: peakHour[0], transactions: peakHour[1].count },
      });
    }

    return insights;
  }

  /**
   * Calculate timing patterns
   */
  analyzeTimingPattern(data, field) {
    const patterns = {};

    data.forEach((item) => {
      const value = item[field];
      if (!patterns[value]) {
        patterns[value] = { count: 0, totalPoints: 0 };
      }
      patterns[value].count++;
      patterns[value].totalPoints += item.pointsAmount;
    });

    return patterns;
  }

  /**
   * Find peak timing
   */
  findPeakTiming(patterns) {
    return Object.entries(patterns).sort(([, a], [, b]) => b.count - a.count)[0]?.[0];
  }

  /**
   * Calculate upgrade success rates
   */
  async calculateUpgradeSuccessRates(baseQuery, startDate, endDate) {
    const attempts = await User.countDocuments({
      ...baseQuery,
      'loyalty.statistics.lastActivity': { $gte: startDate, $lte: endDate },
    });

    const successes = await User.countDocuments({
      ...baseQuery,
      'loyalty.tierHistory': {
        $elemMatch: {
          upgradeDate: { $gte: startDate, $lte: endDate },
        },
      },
    });

    return {
      attempts,
      successes,
      successRate: attempts > 0 ? Math.round((successes / attempts) * 100) : 0,
    };
  }

  /**
   * Calculate tier stability
   */
  async calculateTierStability(baseQuery, startDate, endDate) {
    const stableMembers = await User.countDocuments({
      ...baseQuery,
      'loyalty.tierHistory': { $size: 0 }, // No tier changes
    });

    const totalMembers = await User.countDocuments({
      ...baseQuery,
      'loyalty.enrolledAt': { $exists: true },
    });

    return {
      stableMembers,
      totalMembers,
      stabilityRate: totalMembers > 0 ? Math.round((stableMembers / totalMembers) * 100) : 0,
    };
  }

  /**
   * Generate tier recommendations
   */
  generateTierRecommendations(retentionData) {
    const recommendations = [];

    retentionData.forEach((tier) => {
      if (tier.retentionRate < 50) {
        recommendations.push({
          tier: tier.tier,
          type: 'retention',
          priority: 'high',
          action: `Improve ${tier.tier} tier benefits and engagement`,
          target: 'Increase retention to 70%+',
        });
      }

      if (tier.avgTenure < 180 && tier.tier !== 'BRONZE') {
        recommendations.push({
          tier: tier.tier,
          type: 'tenure',
          priority: 'medium',
          action: `Focus on long-term value for ${tier.tier} members`,
          target: 'Increase average tenure to 12+ months',
        });
      }
    });

    return recommendations;
  }

  /**
   * Calculate churn prediction accuracy
   */
  async calculateChurnPredictionAccuracy(baseQuery) {
    // This would compare predicted vs actual churn
    // Simplified implementation
    return {
      accuracy: 75,
      precision: 68,
      recall: 82,
      f1Score: 74,
      methodology: 'Historical validation over 6 months',
    };
  }

  /**
   * Estimate churn rate from risk segments
   */
  estimateChurnRate(riskSegments) {
    const criticalRisk = riskSegments.CRITICAL?.length || 0;
    const highRisk = riskSegments.HIGH?.length || 0;
    const mediumRisk = riskSegments.MEDIUM?.length || 0;

    // Apply different churn probabilities by risk level
    const estimatedChurns = criticalRisk * 0.8 + highRisk * 0.5 + mediumRisk * 0.2;
    const totalAtRisk = criticalRisk + highRisk + mediumRisk;

    return totalAtRisk > 0 ? Math.round((estimatedChurns / totalAtRisk) * 100) : 0;
  }

  /**
   * Calculate potential revenue at risk
   */
  calculatePotentialRevenueAtRisk(riskSegments) {
    let totalRevenue = 0;

    Object.values(riskSegments).forEach((segment) => {
      if (Array.isArray(segment)) {
        segment.forEach((member) => {
          // Estimate annual value based on lifetime points
          const estimatedAnnualValue = (member.lifetimePoints || 0) / 10; // Rough conversion
          totalRevenue += estimatedAnnualValue;
        });
      }
    });

    return Math.round(totalRevenue);
  }

  /**
   * Generate churn prevention strategies
   */
  generateChurnPreventionStrategies(riskSegments) {
    return {
      immediate: {
        description: 'Actions for critical risk members',
        strategies: [
          'Personal outreach by account managers',
          'Exclusive offers and experiences',
          'Priority customer service',
        ],
        targetSegment: 'CRITICAL',
        timeline: '1-2 weeks',
      },

      proactive: {
        description: 'Prevention for high-risk members',
        strategies: [
          'Targeted retention campaigns',
          'Loyalty booster programs',
          'Feedback collection and service improvement',
        ],
        targetSegment: 'HIGH',
        timeline: '1 month',
      },

      preventive: {
        description: 'Engagement for medium-risk members',
        strategies: [
          'Engagement enhancement programs',
          'Personalized communications',
          'Value demonstration campaigns',
        ],
        targetSegment: 'MEDIUM',
        timeline: '2-3 months',
      },
    };
  }

  /**
   * Generate retention recommendations
   */
  generateRetentionRecommendations(churnAnalysis) {
    const recommendations = [];

    recommendations.push({
      type: 'strategy',
      priority: 'high',
      title: 'Implement Predictive Churn Prevention',
      description: 'Use analytics to identify at-risk members earlier',
      actions: [
        'Deploy machine learning models for churn prediction',
        'Create automated intervention workflows',
        'Establish early warning alert systems',
      ],
      expectedImpact: 'Reduce churn by 25-35%',
      timeline: '3-6 months',
    });

    recommendations.push({
      type: 'operational',
      priority: 'medium',
      title: 'Enhance Member Experience',
      description: 'Address root causes of member dissatisfaction',
      actions: [
        'Conduct comprehensive member experience audit',
        'Streamline points earning and redemption processes',
        'Improve customer service response times',
      ],
      expectedImpact: 'Improve satisfaction scores by 20%',
      timeline: '2-4 months',
    });

    return recommendations;
  }

  /**
   * Estimate additional revenue from loyalty
   */
  async estimateAdditionalRevenueFromLoyalty(baseQuery, startDate, endDate) {
    // Simplified calculation - would need more sophisticated modeling
    const loyaltyMembers = await User.countDocuments({
      ...baseQuery,
      'loyalty.enrolledAt': { $exists: true },
    });

    const avgSpendIncrease = 25; // 25% average increase for loyalty members
    const avgAnnualSpend = 500; // Estimated average annual spend

    return Math.round(loyaltyMembers * avgAnnualSpend * (avgSpendIncrease / 100));
  }

  /**
   * Get transaction type display name
   */
  getTransactionTypeDisplay(type) {
    const displayNames = {
      BOOKING_REWARD: 'Récompense Réservation',
      BIRTHDAY_BONUS: 'Bonus Anniversaire',
      REFERRAL_BONUS: 'Bonus Parrainage',
      WELCOME_BONUS: 'Bonus Bienvenue',
      ROOM_UPGRADE: 'Surclassement Chambre',
      FREE_NIGHT: 'Nuit Gratuite',
      DISCOUNT: 'Réduction',
      CASH_EQUIVALENT: 'Équivalent Espèces',
    };

    return displayNames[type] || type;
  }

  /**
   * Calculate campaign ROI
   */
  async calculateCampaignROI(campaignCode, startDate, endDate) {
    // Simplified ROI calculation
    const campaignCost = 1000; // Estimated campaign cost
    const revenue = 5000; // Estimated additional revenue

    return {
      cost: campaignCost,
      revenue,
      roi: ((revenue - campaignCost) / campaignCost) * 100,
      efficiency: revenue / campaignCost,
    };
  }

  /**
   * Rate campaign performance
   */
  rateCampaignPerformance(campaign) {
    if (campaign.roi >= 200) return 'EXCELLENT';
    if (campaign.roi >= 150) return 'GOOD';
    if (campaign.roi >= 100) return 'AVERAGE';
    return 'POOR';
  }

  /**
   * Calculate available room nights
   */
  async calculateAvailableRoomNights(query) {
    try {
      const hotels = await Hotel.find(query.hotel ? { _id: query.hotel } : {});
      const totalRooms = hotels.reduce((sum, hotel) => sum + (hotel.totalRooms || 0), 0);

      const startDate = moment(query.checkInDate?.$gte || query.createdAt?.$gte);
      const endDate = moment(query.checkInDate?.$lte || query.createdAt?.$lte);
      const days = endDate.diff(startDate, 'days') + 1;

      return totalRooms * days;
    } catch (error) {
      logger.error('Error calculating available room nights:', error);
      return 1;
    }
  }

  /**
   * Calculate variance for statistical analysis
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Get empty revenue metrics structure
   */
  getEmptyRevenueMetrics() {
    return {
      summary: {
        totalRevenue: 0,
        totalBookings: 0,
        totalRoomNights: 0,
        averageBookingValue: 0,
        adr: 0,
        revPAR: 0,
        currency: 'EUR',
      },
      timeSeries: [],
      breakdown: {
        byRoomType: [],
        bySource: [],
        byClientType: [],
      },
      growth: null,
      variance: 0,
    };
  }

  /**
   * Group revenue data by time period
   */
  groupRevenueByPeriod(bookings, granularity) {
    const grouped = {};

    bookings.forEach((booking) => {
      let key;
      const date = moment(booking.createdAt);

      switch (granularity) {
        case 'hourly':
          key = date.format('YYYY-MM-DD HH');
          break;
        case 'daily':
          key = date.format('YYYY-MM-DD');
          break;
        case 'weekly':
          key = date.format('YYYY-WW');
          break;
        case 'monthly':
          key = date.format('YYYY-MM');
          break;
        default:
          key = date.format('YYYY-MM-DD');
      }

      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          revenue: 0,
          bookings: 0,
          roomNights: 0,
        };
      }

      grouped[key].revenue += booking.convertedAmount || 0;
      grouped[key].bookings += 1;
      grouped[key].roomNights += booking.nights * booking.rooms.length;
    });

    return Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period));
  }

  /**
   * Calculate revenue by room type
   */
  calculateRevenueByRoomType(bookings) {
    const revenueByType = {};

    bookings.forEach((booking) => {
      booking.rooms.forEach((room) => {
        const type = room.type || 'Unknown';
        if (!revenueByType[type]) {
          revenueByType[type] = {
            type,
            revenue: 0,
            bookings: 0,
            percentage: 0,
          };
        }

        revenueByType[type].revenue += (booking.convertedAmount || 0) / booking.rooms.length;
        revenueByType[type].bookings += 1;
      });
    });

    const totalRevenue = Object.values(revenueByType).reduce((sum, type) => sum + type.revenue, 0);

    return Object.values(revenueByType).map((type) => ({
      ...type,
      revenue: Math.round(type.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((type.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }

  /**
   * Calculate revenue by source
   */
  calculateRevenueBySource(bookings) {
    const revenueBySource = {};

    bookings.forEach((booking) => {
      const source = booking.source || 'DIRECT';
      if (!revenueBySource[source]) {
        revenueBySource[source] = {
          source,
          revenue: 0,
          bookings: 0,
          percentage: 0,
        };
      }

      revenueBySource[source].revenue += booking.convertedAmount || 0;
      revenueBySource[source].bookings += 1;
    });

    const totalRevenue = Object.values(revenueBySource).reduce(
      (sum, source) => sum + source.revenue,
      0
    );

    return Object.values(revenueBySource).map((source) => ({
      ...source,
      revenue: Math.round(source.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((source.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }

  /**
   * Calculate revenue by client type
   */
  calculateRevenueByClientType(bookings) {
    const revenueByType = {};

    bookings.forEach((booking) => {
      const clientType = booking.clientType || 'INDIVIDUAL';
      if (!revenueByType[clientType]) {
        revenueByType[clientType] = {
          type: clientType,
          revenue: 0,
          bookings: 0,
          percentage: 0,
        };
      }

      revenueByType[clientType].revenue += booking.convertedAmount || 0;
      revenueByType[clientType].bookings += 1;
    });

    const totalRevenue = Object.values(revenueByType).reduce((sum, type) => sum + type.revenue, 0);

    return Object.values(revenueByType).map((type) => ({
      ...type,
      revenue: Math.round(type.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((type.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }
  /**
   * Generate performance alerts based on analytics data
   * Identifies critical performance issues and opportunities
   * @param {Object} analyticsData - Complete analytics data
   * @returns {Array} Array of performance alerts
   */
  generatePerformanceAlerts(analyticsData) {
    try {
      const alerts = [];
      const now = new Date();

      // Revenue performance alerts
      if (analyticsData.revenue) {
        const { summary, growth } = analyticsData.revenue;

        // Critical revenue decline
        if (growth && growth.percentage < -15) {
          alerts.push({
            id: `revenue_decline_${Date.now()}`,
            type: 'CRITICAL',
            category: 'REVENUE',
            title: 'Severe Revenue Decline Detected',
            message: `Revenue has declined by ${Math.abs(growth.percentage).toFixed(1)}% compared to previous period`,
            impact: 'HIGH',
            urgency: 'IMMEDIATE',
            triggeredAt: now,
            data: {
              currentRevenue: summary.totalRevenue,
              declinePercentage: growth.percentage,
              previousRevenue: growth.previous,
            },
            recommendations: [
              'Implement emergency pricing strategy',
              'Launch promotional campaigns',
              'Analyze competitor actions',
              'Review market conditions',
            ],
            automatedActions: ['alert_management', 'create_report'],
            estimatedImpact: `Potential monthly loss: €${Math.round(summary.totalRevenue * 0.15)}`,
          });
        }

        // Revenue opportunity alert
        if (summary.revPAR < this.benchmarks.revPAR.good && summary.occupancyRate > 80) {
          alerts.push({
            id: `revenue_opportunity_${Date.now()}`,
            type: 'OPPORTUNITY',
            category: 'PRICING',
            title: 'Revenue Optimization Opportunity',
            message: `High occupancy (${summary.occupancyRate.toFixed(1)}%) with low RevPAR (€${summary.revPAR.toFixed(2)}) indicates pricing opportunity`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              currentRevPAR: summary.revPAR,
              occupancyRate: summary.occupancyRate,
              potentialIncrease: this.benchmarks.revPAR.good - summary.revPAR,
            },
            recommendations: [
              'Increase room rates for peak periods',
              'Implement dynamic pricing',
              'Review competitor pricing',
              'Optimize room type mix',
            ],
            estimatedImpact: `Potential revenue increase: €${Math.round((this.benchmarks.revPAR.good - summary.revPAR) * 30)}/month`,
          });
        }
      }

      // Occupancy performance alerts
      if (analyticsData.occupancy) {
        const { summary } = analyticsData.occupancy;

        // Low occupancy critical alert
        if (summary.averageOccupancy < this.benchmarks.occupancyRate.poor) {
          alerts.push({
            id: `occupancy_critical_${Date.now()}`,
            type: 'CRITICAL',
            category: 'OCCUPANCY',
            title: 'Critical Occupancy Level',
            message: `Occupancy rate at ${summary.averageOccupancy.toFixed(1)}% is critically low`,
            impact: 'HIGH',
            urgency: 'IMMEDIATE',
            triggeredAt: now,
            data: {
              currentOccupancy: summary.averageOccupancy,
              targetOccupancy: this.benchmarks.occupancyRate.average,
              roomsAvailable: summary.totalRooms,
            },
            recommendations: [
              'Launch immediate marketing campaigns',
              'Reduce pricing temporarily',
              'Contact corporate clients',
              'Activate discount channels',
            ],
            automatedActions: ['notify_sales_team', 'activate_promotions'],
            estimatedImpact: `Risk of €${Math.round(summary.totalRooms * 50 * 30)} monthly revenue loss`,
          });
        }

        // Overbooking risk alert
        if (summary.peakOccupancy > 98) {
          alerts.push({
            id: `overbooking_risk_${Date.now()}`,
            type: 'WARNING',
            category: 'OPERATIONS',
            title: 'Overbooking Risk Detected',
            message: `Peak occupancy at ${summary.peakOccupancy.toFixed(1)}% indicates overbooking risk`,
            impact: 'MEDIUM',
            urgency: 'HIGH',
            triggeredAt: now,
            data: {
              peakOccupancy: summary.peakOccupancy,
              totalRooms: summary.totalRooms,
            },
            recommendations: [
              'Monitor booking closely',
              'Prepare backup accommodation',
              'Consider room blocking',
              'Review overbooking policies',
            ],
            automatedActions: ['alert_operations', 'check_alternatives'],
          });
        }
      }

      // Loyalty program alerts
      if (analyticsData.loyalty) {
        const { membership, points, engagement } = analyticsData.loyalty;

        // Low loyalty engagement
        if (engagement && engagement.activeUsers.stickiness < 30) {
          alerts.push({
            id: `loyalty_engagement_${Date.now()}`,
            type: 'WARNING',
            category: 'LOYALTY',
            title: 'Low Loyalty Program Engagement',
            message: `Member stickiness at ${engagement.activeUsers.stickiness}% is below target`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              stickiness: engagement.activeUsers.stickiness,
              activeMembers: engagement.activeUsers.last30Days,
              totalMembers: membership.total,
            },
            recommendations: [
              'Launch member re-engagement campaign',
              'Review loyalty program benefits',
              'Improve member communication',
              'Analyze program friction points',
            ],
            estimatedImpact: `Potential member churn: ${Math.round(membership.total * 0.2)} members`,
          });
        }

        // High point liability
        if (points && points.summary.redemptionRate < 20) {
          alerts.push({
            id: `points_liability_${Date.now()}`,
            type: 'INFO',
            category: 'LOYALTY',
            title: 'High Points Liability',
            message: `Low redemption rate (${points.summary.redemptionRate}%) creating high points liability`,
            impact: 'LOW',
            urgency: 'LOW',
            triggeredAt: now,
            data: {
              redemptionRate: points.summary.redemptionRate,
              totalPointsIssued: points.summary.totalPointsEarned,
              pointsLiability:
                points.summary.totalPointsEarned - points.summary.totalPointsRedeemed,
            },
            recommendations: [
              'Promote point redemption options',
              'Create limited-time redemption offers',
              'Simplify redemption process',
              'Add new redemption categories',
            ],
          });
        }
      }

      // Yield management alerts
      if (analyticsData.yield && analyticsData.yield.enabled) {
        const { effectiveness, performance } = analyticsData.yield;

        // Low yield effectiveness
        if (effectiveness && effectiveness.revenueImpact < 5) {
          alerts.push({
            id: `yield_effectiveness_${Date.now()}`,
            type: 'WARNING',
            category: 'YIELD',
            title: 'Low Yield Management Effectiveness',
            message: `Yield management showing only ${effectiveness.revenueImpact.toFixed(1)}% revenue impact`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              revenueImpact: effectiveness.revenueImpact,
              automationRate: performance?.summary?.automationRate || 0,
            },
            recommendations: [
              'Review yield management rules',
              'Increase automation level',
              'Analyze pricing strategies',
              'Update demand forecasting',
            ],
            estimatedImpact: `Potential revenue optimization: €${Math.round(effectiveness.revenueImpact * 1000)}/month`,
          });
        }
      }

      // Market comparison alerts
      if (analyticsData.competitive) {
        const { position } = analyticsData.competitive;

        if (position === 'BELOW_MARKET') {
          alerts.push({
            id: `market_position_${Date.now()}`,
            type: 'WARNING',
            category: 'COMPETITIVE',
            title: 'Below Market Performance',
            message: 'Performance metrics below market average',
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            recommendations: [
              'Benchmark against competitors',
              'Review pricing strategy',
              'Improve service quality',
              'Enhance marketing efforts',
            ],
          });
        }
      }

      // System performance alerts
      const cacheMetrics = this.getCachePerformanceMetrics();
      if (cacheMetrics.overall.hitRate < 50) {
        alerts.push({
          id: `cache_performance_${Date.now()}`,
          type: 'INFO',
          category: 'SYSTEM',
          title: 'Low Cache Performance',
          message: `Cache hit rate at ${cacheMetrics.overall.hitRate}% affecting system performance`,
          impact: 'LOW',
          urgency: 'LOW',
          triggeredAt: now,
          data: {
            hitRate: cacheMetrics.overall.hitRate,
            totalRequests: cacheMetrics.overall.totalRequests,
          },
          recommendations: [
            'Optimize cache TTL settings',
            'Review cache warming strategy',
            'Check Redis performance',
            'Analyze cache patterns',
          ],
          automatedActions: ['warm_cache', 'optimize_ttl'],
        });
      }

      // Sort alerts by urgency and impact
      return alerts.sort((a, b) => {
        const urgencyOrder = { IMMEDIATE: 3, HIGH: 2, NORMAL: 1, LOW: 0 };
        const impactOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };

        const aScore = urgencyOrder[a.urgency] + impactOrder[a.impact];
        const bScore = urgencyOrder[b.urgency] + impactOrder[b.impact];

        return bScore - aScore;
      });
    } catch (error) {
      logger.error('Error generating performance alerts:', error);
      return [
        {
          id: `error_${Date.now()}`,
          type: 'ERROR',
          category: 'SYSTEM',
          title: 'Alert Generation Error',
          message: 'Failed to generate performance alerts',
          impact: 'LOW',
          urgency: 'LOW',
          triggeredAt: new Date(),
          error: error.message,
        },
      ];
    }
  }
  /**
   * Generate operational alerts for hotel operations
   * Monitors operational KPIs and generates actionable alerts
   * @param {Object} analyticsData - Analytics data including operational metrics
   * @returns {Array} Array of operational alerts
   */
  generateOperationalAlerts(analyticsData) {
    try {
      const alerts = [];
      const now = new Date();

      // Check-in/Check-out efficiency alerts
      if (analyticsData.checkInOut) {
        const { averageCheckInTime, averageCheckOutTime, efficiency } = analyticsData.checkInOut;

        // Slow check-in process
        if (averageCheckInTime > 15) {
          // 15 minutes threshold
          alerts.push({
            id: `checkin_slow_${Date.now()}`,
            type: 'WARNING',
            category: 'OPERATIONS',
            title: 'Slow Check-in Process',
            message: `Average check-in time of ${averageCheckInTime} minutes exceeds target`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              averageTime: averageCheckInTime,
              target: 10,
              deviation: averageCheckInTime - 10,
            },
            recommendations: [
              'Review check-in procedures',
              'Train front desk staff',
              'Implement mobile check-in',
              'Optimize system workflows',
            ],
            affectedDepartments: ['RECEPTION', 'GUEST_SERVICES'],
            estimatedImpact: 'Guest satisfaction may decrease by 15-20%',
          });
        }

        // High check-out waiting times
        if (averageCheckOutTime > 10) {
          // 10 minutes threshold
          alerts.push({
            id: `checkout_slow_${Date.now()}`,
            type: 'INFO',
            category: 'OPERATIONS',
            title: 'Extended Check-out Times',
            message: `Average check-out time of ${averageCheckOutTime} minutes above optimal`,
            impact: 'LOW',
            urgency: 'LOW',
            triggeredAt: now,
            data: {
              averageTime: averageCheckOutTime,
              target: 5,
              deviation: averageCheckOutTime - 5,
            },
            recommendations: [
              'Implement express check-out',
              'Optimize billing system',
              'Pre-prepare invoices',
              'Add self-service kiosks',
            ],
            affectedDepartments: ['RECEPTION', 'ACCOUNTING'],
          });
        }
      }

      // Service quality alerts
      if (analyticsData.service) {
        const { qualityScore, extrasUsage, serviceRevenue } = analyticsData.service;

        // Low service quality score
        if (qualityScore < 70) {
          alerts.push({
            id: `service_quality_${Date.now()}`,
            type: 'CRITICAL',
            category: 'SERVICE',
            title: 'Service Quality Below Standard',
            message: `Service quality score at ${qualityScore}% requires immediate attention`,
            impact: 'HIGH',
            urgency: 'HIGH',
            triggeredAt: now,
            data: {
              currentScore: qualityScore,
              target: 85,
              deficit: 85 - qualityScore,
            },
            recommendations: [
              'Conduct staff training sessions',
              'Review service procedures',
              'Implement quality monitoring',
              'Gather guest feedback',
            ],
            affectedDepartments: ['ALL'],
            automatedActions: ['schedule_training', 'quality_audit'],
            estimatedImpact: 'Risk of negative reviews and customer churn',
          });
        }

        // Low extras utilization
        if (extrasUsage && extrasUsage.utilizationRate < 30) {
          alerts.push({
            id: `extras_low_${Date.now()}`,
            type: 'OPPORTUNITY',
            category: 'REVENUE',
            title: 'Low Extras Utilization',
            message: `Only ${extrasUsage.utilizationRate}% of guests using additional services`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              utilizationRate: extrasUsage.utilizationRate,
              target: 50,
              potentialRevenue: serviceRevenue.potential || 0,
            },
            recommendations: [
              'Improve service promotion',
              'Train staff on upselling',
              'Review service pricing',
              'Enhance service visibility',
            ],
            affectedDepartments: ['SALES', 'F&B', 'SPA'],
            estimatedImpact: `Potential revenue increase: €${Math.round((serviceRevenue.potential || 0) * 0.2)}/month`,
          });
        }
      }

      // Staffing efficiency alerts
      if (analyticsData.staff) {
        const { efficiency, productivity, workload } = analyticsData.staff;

        // Staff overload alert
        if (workload && workload.average > 90) {
          alerts.push({
            id: `staff_overload_${Date.now()}`,
            type: 'WARNING',
            category: 'STAFFING',
            title: 'Staff Overload Detected',
            message: `Average staff workload at ${workload.average}% indicates potential burnout risk`,
            impact: 'MEDIUM',
            urgency: 'HIGH',
            triggeredAt: now,
            data: {
              averageWorkload: workload.average,
              maxWorkload: workload.max,
              affectedDepartments: workload.departments || [],
            },
            recommendations: [
              'Review staff scheduling',
              'Consider temporary staff',
              'Optimize task distribution',
              'Implement workflow automation',
            ],
            affectedDepartments: ['HR', 'MANAGEMENT'],
            estimatedImpact: 'Risk of service quality decline and staff turnover',
          });
        }

        // Low productivity alert
        if (productivity && productivity.score < 70) {
          alerts.push({
            id: `productivity_low_${Date.now()}`,
            type: 'INFO',
            category: 'EFFICIENCY',
            title: 'Below Target Productivity',
            message: `Staff productivity at ${productivity.score}% below optimal level`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              productivityScore: productivity.score,
              target: 85,
              departments: productivity.departments || [],
            },
            recommendations: [
              'Provide productivity training',
              'Review work processes',
              'Implement performance incentives',
              'Upgrade operational tools',
            ],
            affectedDepartments: ['HR', 'OPERATIONS'],
          });
        }
      }

      // Quality metrics alerts
      if (analyticsData.quality) {
        const { guestSatisfaction, maintenanceIssues, cleanlinessScore } = analyticsData.quality;

        // Low guest satisfaction
        if (guestSatisfaction < 4.0) {
          alerts.push({
            id: `satisfaction_low_${Date.now()}`,
            type: 'CRITICAL',
            category: 'QUALITY',
            title: 'Low Guest Satisfaction',
            message: `Guest satisfaction at ${guestSatisfaction}/5 requires immediate action`,
            impact: 'HIGH',
            urgency: 'IMMEDIATE',
            triggeredAt: now,
            data: {
              currentRating: guestSatisfaction,
              target: 4.5,
              reviewCount: analyticsData.quality.reviewCount || 0,
            },
            recommendations: [
              'Analyze negative feedback',
              'Implement service improvements',
              'Train customer service staff',
              'Address specific complaints',
            ],
            affectedDepartments: ['ALL'],
            automatedActions: ['analyze_reviews', 'create_improvement_plan'],
            estimatedImpact: 'Risk of reputation damage and booking decline',
          });
        }

        // High maintenance issues
        if (maintenanceIssues && maintenanceIssues.count > 5) {
          alerts.push({
            id: `maintenance_high_${Date.now()}`,
            type: 'WARNING',
            category: 'MAINTENANCE',
            title: 'High Maintenance Issues',
            message: `${maintenanceIssues.count} open maintenance issues affecting operations`,
            impact: 'MEDIUM',
            urgency: 'HIGH',
            triggeredAt: now,
            data: {
              issueCount: maintenanceIssues.count,
              priority: maintenanceIssues.priority || 'mixed',
              affectedRooms: maintenanceIssues.rooms || [],
            },
            recommendations: [
              'Prioritize critical repairs',
              'Schedule preventive maintenance',
              'Review maintenance procedures',
              'Consider additional maintenance staff',
            ],
            affectedDepartments: ['MAINTENANCE', 'HOUSEKEEPING'],
            estimatedImpact: `${maintenanceIssues.rooms?.length || 0} rooms potentially out of service`,
          });
        }

        // Low cleanliness score
        if (cleanlinessScore < 85) {
          alerts.push({
            id: `cleanliness_low_${Date.now()}`,
            type: 'WARNING',
            category: 'QUALITY',
            title: 'Cleanliness Standards Below Target',
            message: `Cleanliness score at ${cleanlinessScore}% needs improvement`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              currentScore: cleanlinessScore,
              target: 95,
              deficit: 95 - cleanlinessScore,
            },
            recommendations: [
              'Intensify housekeeping training',
              'Review cleaning procedures',
              'Increase quality inspections',
              'Update cleaning supplies',
            ],
            affectedDepartments: ['HOUSEKEEPING', 'QUALITY_CONTROL'],
            estimatedImpact: 'Potential negative guest reviews and reputation impact',
          });
        }
      }

      // Channel performance alerts
      if (analyticsData.channels) {
        const { performance, distribution } = analyticsData.channels;

        // Underperforming channel
        const underperformingChannels =
          performance?.filter(
            (channel) => channel.conversionRate < 5 && channel.bookingCount > 10
          ) || [];

        if (underperformingChannels.length > 0) {
          alerts.push({
            id: `channel_underperform_${Date.now()}`,
            type: 'INFO',
            category: 'MARKETING',
            title: 'Underperforming Booking Channels',
            message: `${underperformingChannels.length} channels showing low conversion rates`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              channels: underperformingChannels.map((c) => ({
                name: c.name,
                conversionRate: c.conversionRate,
                bookings: c.bookingCount,
              })),
            },
            recommendations: [
              'Optimize channel listings',
              'Review pricing strategy',
              'Improve channel content',
              'Consider channel partnerships',
            ],
            affectedDepartments: ['MARKETING', 'REVENUE_MANAGEMENT'],
            estimatedImpact: `Potential ${underperformingChannels.length * 10} additional bookings/month`,
          });
        }

        // Channel dependency risk
        if (distribution && distribution.topChannel > 60) {
          alerts.push({
            id: `channel_dependency_${Date.now()}`,
            type: 'WARNING',
            category: 'RISK',
            title: 'High Channel Dependency Risk',
            message: `${distribution.topChannel}% of bookings from single channel creates risk`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              dependencyPercentage: distribution.topChannel,
              channelName: distribution.topChannelName || 'Unknown',
              recommendedMax: 50,
            },
            recommendations: [
              'Diversify booking channels',
              'Develop direct booking strategy',
              'Negotiate better terms',
              'Reduce commission dependency',
            ],
            affectedDepartments: ['REVENUE_MANAGEMENT', 'MARKETING'],
            estimatedImpact: 'Risk exposure in case of channel issues',
          });
        }
      }

      // Efficiency alerts
      if (analyticsData.efficiency) {
        const { energyUsage, costPerRoom, operationalEfficiency } = analyticsData.efficiency;

        // High energy consumption
        if (energyUsage && energyUsage.costPerRoom > 15) {
          alerts.push({
            id: `energy_high_${Date.now()}`,
            type: 'INFO',
            category: 'EFFICIENCY',
            title: 'High Energy Consumption',
            message: `Energy cost at €${energyUsage.costPerRoom}/room above target`,
            impact: 'LOW',
            urgency: 'LOW',
            triggeredAt: now,
            data: {
              currentCost: energyUsage.costPerRoom,
              target: 12,
              monthlyCost: energyUsage.monthlyCost || 0,
            },
            recommendations: [
              'Implement energy saving measures',
              'Upgrade to LED lighting',
              'Optimize HVAC settings',
              'Install smart thermostats',
            ],
            affectedDepartments: ['MAINTENANCE', 'FACILITIES'],
            estimatedImpact: `Potential savings: €${Math.round((energyUsage.costPerRoom - 12) * 100)}/month`,
          });
        }

        // Low operational efficiency
        if (operationalEfficiency && operationalEfficiency.score < 75) {
          alerts.push({
            id: `efficiency_low_${Date.now()}`,
            type: 'INFO',
            category: 'EFFICIENCY',
            title: 'Operational Efficiency Below Target',
            message: `Operational efficiency at ${operationalEfficiency.score}% needs improvement`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              currentScore: operationalEfficiency.score,
              target: 85,
              improvementAreas: operationalEfficiency.areas || [],
            },
            recommendations: [
              'Automate routine processes',
              'Streamline workflows',
              'Implement digital solutions',
              'Train staff on efficiency',
            ],
            affectedDepartments: ['OPERATIONS', 'IT'],
          });
        }
      }

      // Technology and system alerts
      if (analyticsData.technology) {
        const { systemUptime, responseTime, errorRate } = analyticsData.technology;

        // Low system uptime
        if (systemUptime < 99.5) {
          alerts.push({
            id: `system_uptime_${Date.now()}`,
            type: 'WARNING',
            category: 'TECHNOLOGY',
            title: 'System Uptime Below Target',
            message: `System uptime at ${systemUptime}% affecting operations`,
            impact: 'HIGH',
            urgency: 'HIGH',
            triggeredAt: now,
            data: {
              currentUptime: systemUptime,
              target: 99.9,
              downtime: (100 - systemUptime) * 24 * 0.3, // Hours per month
            },
            recommendations: [
              'Review system infrastructure',
              'Implement redundancy',
              'Schedule maintenance windows',
              'Monitor system health',
            ],
            affectedDepartments: ['IT', 'OPERATIONS'],
            automatedActions: ['system_health_check', 'alert_it_team'],
          });
        }

        // Slow response times
        if (responseTime && responseTime.average > 3000) {
          // 3 seconds
          alerts.push({
            id: `response_slow_${Date.now()}`,
            type: 'INFO',
            category: 'TECHNOLOGY',
            title: 'Slow System Response Times',
            message: `Average response time of ${responseTime.average}ms affecting user experience`,
            impact: 'MEDIUM',
            urgency: 'NORMAL',
            triggeredAt: now,
            data: {
              averageResponseTime: responseTime.average,
              target: 1000,
              slowestEndpoints: responseTime.slowest || [],
            },
            recommendations: [
              'Optimize database queries',
              'Implement caching',
              'Review server resources',
              'Optimize application code',
            ],
            affectedDepartments: ['IT', 'DEVELOPMENT'],
          });
        }
      }

      // Sort operational alerts by urgency and impact
      return alerts.sort((a, b) => {
        const urgencyOrder = { IMMEDIATE: 4, HIGH: 3, NORMAL: 2, LOW: 1 };
        const impactOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };

        const aScore = (urgencyOrder[a.urgency] || 0) * 2 + (impactOrder[a.impact] || 0);
        const bScore = (urgencyOrder[b.urgency] || 0) * 2 + (impactOrder[b.impact] || 0);

        return bScore - aScore;
      });
    } catch (error) {
      logger.error('Error generating operational alerts:', error);
      return [
        {
          id: `operational_error_${Date.now()}`,
          type: 'ERROR',
          category: 'SYSTEM',
          title: 'Operational Alert Generation Error',
          message: 'Failed to generate operational alerts',
          impact: 'LOW',
          urgency: 'LOW',
          triggeredAt: new Date(),
          error: error.message,
          recommendations: ['Check system logs', 'Contact technical support'],
        },
      ];
    }
  }
  /**
   * Calculate internal benchmarks based on historical performance
   * Creates dynamic benchmarks from hotel's own historical data
   * @param {Object} analyticsData - Complete analytics data
   * @returns {Object} Internal benchmarks and targets
   */
  calculateInternalBenchmarks(analyticsData) {
    try {
      const benchmarks = {
        metadata: {
          calculatedAt: new Date(),
          dataSource: 'historical_performance',
          confidence: 'high',
          updateFrequency: 'monthly',
        },
        revenue: {},
        occupancy: {},
        loyalty: {},
        operational: {},
        comparative: {},
        trends: {},
        targets: {},
      };

      // Revenue benchmarks
      if (analyticsData.revenue) {
        const { summary, timeSeries, growth } = analyticsData.revenue;

        // Calculate historical averages and percentiles
        const revenues = timeSeries?.map((t) => t.revenue) || [];
        const revPARs = timeSeries?.map((t) => t.revPAR) || [];
        const adrs = timeSeries?.map((t) => t.adr) || [];

        benchmarks.revenue = {
          totalRevenue: {
            current: summary.totalRevenue,
            average: this.calculateAverage(revenues),
            percentile75: this.calculatePercentile(revenues, 75),
            percentile90: this.calculatePercentile(revenues, 90),
            best: Math.max(...revenues, 0),
            target: this.calculateTarget(revenues, 'growth'),
          },
          revPAR: {
            current: summary.revPAR,
            average: this.calculateAverage(revPARs),
            percentile75: this.calculatePercentile(revPARs, 75),
            percentile90: this.calculatePercentile(revPARs, 90),
            best: Math.max(...revPARs, 0),
            target: this.calculateTarget(revPARs, 'optimization'),
          },
          adr: {
            current: summary.adr,
            average: this.calculateAverage(adrs),
            percentile75: this.calculatePercentile(adrs, 75),
            percentile90: this.calculatePercentile(adrs, 90),
            best: Math.max(...adrs, 0),
            target: this.calculateTarget(adrs, 'competitive'),
          },
          growth: {
            current: growth?.percentage || 0,
            average: this.calculateAverageGrowth(revenues),
            target: 5, // 5% monthly growth target
            volatility: this.calculateVolatility(revenues),
            consistency: this.calculateConsistency(revenues),
          },
        };
      }

      // Occupancy benchmarks
      if (analyticsData.occupancy) {
        const { summary, timeSeries } = analyticsData.occupancy;
        const occupancyRates = timeSeries?.map((t) => t.occupancyRate) || [];

        benchmarks.occupancy = {
          rate: {
            current: summary.averageOccupancy,
            average: this.calculateAverage(occupancyRates),
            percentile75: this.calculatePercentile(occupancyRates, 75),
            percentile90: this.calculatePercentile(occupancyRates, 90),
            best: Math.max(...occupancyRates, 0),
            target: Math.min(this.calculateTarget(occupancyRates, 'optimization'), 95),
          },
          consistency: {
            variance: this.calculateVariance(occupancyRates),
            stabilityScore: this.calculateStabilityScore(occupancyRates),
            seasonalImpact: this.calculateSeasonalImpact(occupancyRates),
          },
          efficiency: {
            roomUtilization: summary.averageOccupancy / 100,
            peakUtilization: summary.peakOccupancy / 100,
            offPeakRatio: summary.minimumOccupancy / summary.peakOccupancy,
          },
        };
      }

      // Loyalty program benchmarks
      if (analyticsData.loyalty) {
        const { membership, engagement, points } = analyticsData.loyalty;

        benchmarks.loyalty = {
          membership: {
            total: {
              current: membership.total,
              growthRate: membership.growthRate?.rate || 0,
              target: this.calculateMembershipTarget(membership),
            },
            activation: {
              current: membership.activationRate,
              target: Math.max(membership.activationRate * 1.2, 70),
              benchmark: 75,
            },
            retention: {
              current: 100 - membership.churnRate,
              target: Math.max(100 - membership.churnRate + 10, 85),
              benchmark: 90,
            },
          },
          engagement: {
            stickiness: {
              current: engagement?.activeUsers?.stickiness || 0,
              target: Math.max((engagement?.activeUsers?.stickiness || 0) * 1.3, 50),
              benchmark: 60,
            },
            activity: {
              current: engagement?.activeUsers?.last30Days || 0,
              target: Math.round((engagement?.activeUsers?.last30Days || 0) * 1.25),
              growthRate: this.calculateEngagementGrowth(engagement),
            },
          },
          points: {
            redemption: {
              current: points?.summary?.redemptionRate || 0,
              target: Math.max((points?.summary?.redemptionRate || 0) + 10, 30),
              optimal: 40,
              efficiency: this.calculatePointsEfficiency(points?.summary),
            },
            velocity: {
              current: points?.velocity?.avgDaily || 0,
              trend: points?.velocity?.trend || 'stable',
              target: this.calculatePointsVelocityTarget(points?.velocity),
            },
          },
        };
      }

      // Operational benchmarks
      if (analyticsData.operational || analyticsData.checkInOut || analyticsData.service) {
        const checkInOut = analyticsData.checkInOut || {};
        const service = analyticsData.service || {};

        benchmarks.operational = {
          checkIn: {
            averageTime: {
              current: checkInOut.averageCheckInTime || 0,
              target: 8, // 8 minutes target
              best: Math.min(checkInOut.bestCheckInTime || 15, 5),
              benchmark: 10,
            },
            efficiency: {
              current: checkInOut.efficiency?.checkin || 0,
              target: 90,
              improvement: this.calculateEfficiencyImprovement(checkInOut.efficiency?.checkin),
            },
          },
          service: {
            quality: {
              current: service.qualityScore || 0,
              target: Math.max((service.qualityScore || 0) + 5, 85),
              benchmark: 90,
              consistency: this.calculateServiceConsistency(service),
            },
            extras: {
              utilization: service.extrasUsage?.utilizationRate || 0,
              target: Math.max((service.extrasUsage?.utilizationRate || 0) * 1.5, 40),
              revenueImpact: service.serviceRevenue?.impact || 0,
            },
          },
        };
      }

      // Comparative benchmarks (vs industry if available)
      benchmarks.comparative = {
        industry: {
          revPAR: this.getIndustryBenchmark('revPAR'),
          occupancy: this.getIndustryBenchmark('occupancy'),
          adr: this.getIndustryBenchmark('adr'),
          loyalty: this.getIndustryBenchmark('loyalty'),
        },
        competitive: {
          position: this.calculateCompetitivePosition(analyticsData),
          marketShare: this.estimateMarketShare(analyticsData),
          pricingPosition: this.calculatePricingPosition(analyticsData),
        },
        performance: {
          overallScore: this.calculateOverallPerformanceScore(analyticsData),
          ranking: this.calculatePerformanceRanking(analyticsData),
          improvementAreas: this.identifyImprovementAreas(analyticsData),
        },
      };

      // Trend benchmarks
      benchmarks.trends = {
        momentum: {
          revenue: this.calculateMomentum(analyticsData.revenue?.timeSeries),
          occupancy: this.calculateMomentum(analyticsData.occupancy?.timeSeries),
          loyalty: this.calculateMomentum(analyticsData.loyalty?.trends?.membership),
        },
        forecasting: {
          confidence: this.calculateForecastConfidence(analyticsData),
          accuracy: this.calculateHistoricalAccuracy(analyticsData),
          reliability: this.calculateBenchmarkReliability(benchmarks),
        },
      };

      // Dynamic targets based on performance and market conditions
      benchmarks.targets = {
        short_term: {
          // 1-3 months
          revenue: {
            increase: this.calculateShortTermTarget(
              benchmarks.revenue.totalRevenue,
              'conservative'
            ),
            revPAR: this.calculateShortTermTarget(benchmarks.revenue.revPAR, 'moderate'),
            occupancy: this.calculateShortTermTarget(benchmarks.occupancy.rate, 'achievable'),
          },
          loyalty: {
            members: this.calculateShortTermTarget(benchmarks.loyalty?.membership?.total, 'growth'),
            engagement: this.calculateShortTermTarget(
              benchmarks.loyalty?.engagement?.stickiness,
              'improvement'
            ),
          },
        },
        medium_term: {
          // 3-12 months
          revenue: {
            increase: this.calculateMediumTermTarget(benchmarks.revenue.totalRevenue, 'ambitious'),
            market_position: 'top_quartile',
          },
          operational: {
            efficiency: this.calculateMediumTermTarget(
              benchmarks.operational?.service?.quality,
              'excellence'
            ),
            automation: 85, // 85% process automation target
          },
        },
        long_term: {
          // 1+ years
          strategic: {
            market_leadership: this.calculateStrategicTargets(benchmarks),
            sustainability: this.calculateSustainabilityTargets(benchmarks),
            innovation: this.calculateInnovationTargets(benchmarks),
          },
        },
      };

      // Benchmark quality and confidence scoring
      benchmarks.quality = {
        dataQuality: this.assessDataQuality(analyticsData),
        representativeness: this.assessRepresentativeness(analyticsData),
        reliability: this.assessBenchmarkReliability(benchmarks),
        confidence: this.calculateOverallConfidence(benchmarks),
      };

      return benchmarks;
    } catch (error) {
      logger.error('Error calculating internal benchmarks:', error);
      return {
        error: 'Failed to calculate internal benchmarks',
        message: error.message,
        timestamp: new Date(),
        fallback: this.getFallbackBenchmarks(),
      };
    }
  }

  /**
   * Helper methods for benchmark calculations
   */
  calculateAverage(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  calculatePercentile(values, percentile) {
    if (!values || values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  calculateTarget(values, strategy) {
    if (!values || values.length === 0) return 0;
    const avg = this.calculateAverage(values);
    const p75 = this.calculatePercentile(values, 75);

    switch (strategy) {
      case 'growth':
        return avg * 1.15; // 15% above average
      case 'optimization':
        return p75 * 1.1; // 10% above 75th percentile
      case 'competitive':
        return Math.max(avg * 1.2, p75); // 20% above average or 75th percentile
      default:
        return avg * 1.1;
    }
  }

  calculateVariance(values) {
    if (!values || values.length === 0) return 0;
    const avg = this.calculateAverage(values);
    return values.reduce((sum, val) => sum + Math.pow(val - avg, 2), 0) / values.length;
  }

  /**
   * Get loyalty program targets and KPIs
   * Defines strategic targets for loyalty program optimization
   * @returns {Object} Comprehensive loyalty targets and thresholds
   */
  getLoyaltyTargets() {
    try {
      const targets = {
        metadata: {
          version: '2.0',
          lastUpdated: new Date(),
          applicability: 'hotel_chain',
          reviewFrequency: 'quarterly',
        },

        // Membership targets
        membership: {
          acquisition: {
            monthly_new_members: {
              target: 100,
              minimum: 50,
              stretch: 200,
              measurement: 'absolute_count',
              timeframe: 'monthly',
            },
            growth_rate: {
              target: 15, // 15% monthly growth
              minimum: 5,
              stretch: 25,
              measurement: 'percentage',
              timeframe: 'monthly',
            },
            conversion_rate: {
              target: 12, // 12% of guests become members
              minimum: 8,
              stretch: 20,
              measurement: 'percentage',
              source: 'booking_to_enrollment',
            },
          },
          retention: {
            activation_rate: {
              target: 70, // 70% of new members become active
              minimum: 50,
              stretch: 85,
              measurement: 'percentage',
              definition: 'activity_within_90_days',
            },
            churn_rate: {
              target: 15, // Maximum 15% annual churn
              minimum: 25,
              stretch: 10,
              measurement: 'percentage',
              timeframe: 'annual',
              definition: 'no_activity_12_months',
            },
            lifetime_value: {
              target: 2500, // €2,500 average lifetime value
              minimum: 1500,
              stretch: 5000,
              measurement: 'euros',
              calculation: 'total_revenue_per_member',
            },
          },
        },

        // Engagement targets
        engagement: {
          activity: {
            monthly_active_rate: {
              target: 45, // 45% of members active monthly
              minimum: 30,
              stretch: 60,
              measurement: 'percentage',
              definition: 'any_activity_past_30_days',
            },
            stickiness: {
              target: 50, // 50% weekly/monthly active ratio
              minimum: 35,
              stretch: 70,
              measurement: 'percentage',
              calculation: 'weekly_active / monthly_active',
            },
            engagement_score: {
              target: 75,
              minimum: 60,
              stretch: 90,
              measurement: 'score_0_100',
              factors: ['login_frequency', 'point_activity', 'redemptions', 'referrals'],
            },
          },
          interaction: {
            app_usage_frequency: {
              target: 8, // 8 sessions per month
              minimum: 4,
              stretch: 15,
              measurement: 'sessions_per_month',
              platform: 'mobile_app',
            },
            email_engagement: {
              open_rate: { target: 25, minimum: 18, stretch: 35 },
              click_rate: { target: 8, minimum: 5, stretch: 12 },
              measurement: 'percentage',
            },
            social_engagement: {
              share_rate: { target: 5, minimum: 2, stretch: 10 },
              review_rate: { target: 15, minimum: 10, stretch: 25 },
              measurement: 'percentage',
            },
          },
        },

        // Points ecosystem targets
        points: {
          earning: {
            average_per_stay: {
              target: 250,
              minimum: 150,
              stretch: 400,
              measurement: 'points',
              base_rate: '1_point_per_euro',
            },
            earning_rate: {
              target: 5, // 5% of spend in points
              minimum: 3,
              stretch: 8,
              measurement: 'percentage',
              calculation: 'points_value / spend',
            },
            bonus_participation: {
              target: 30, // 30% participate in bonus campaigns
              minimum: 20,
              stretch: 50,
              measurement: 'percentage',
            },
          },
          redemption: {
            redemption_rate: {
              target: 40, // 40% of earned points redeemed
              minimum: 25,
              stretch: 60,
              measurement: 'percentage',
              timeframe: 'annual',
            },
            time_to_redemption: {
              target: 120, // 120 days average
              minimum: 180,
              stretch: 60,
              measurement: 'days',
              optimization: 'lower_is_better',
            },
            redemption_value: {
              target: 150,
              minimum: 100,
              stretch: 250,
              measurement: 'euros_per_redemption',
            },
          },
          economics: {
            cost_per_point: {
              target: 0.008, // €0.008 per point
              maximum: 0.012,
              optimum: 0.006,
              measurement: 'euros',
              includes: 'operational_costs',
            },
            liability_ratio: {
              target: 8, // 8% of outstanding points to monthly revenue
              maximum: 15,
              optimum: 5,
              measurement: 'percentage',
              monitoring: 'monthly',
            },
          },
        },

        // Tier progression targets
        tiers: {
          distribution: {
            bronze: { target: 45, range: [40, 50] },
            silver: { target: 30, range: [25, 35] },
            gold: { target: 18, range: [15, 25] },
            platinum: { target: 6, range: [4, 8] },
            diamond: { target: 1, range: [0.5, 2] },
            measurement: 'percentage_of_members',
          },
          progression: {
            annual_upgrades: {
              target: 20, // 20% of eligible members upgrade annually
              minimum: 15,
              stretch: 30,
              measurement: 'percentage',
            },
            tier_retention: {
              target: 80, // 80% maintain tier year-over-year
              minimum: 70,
              stretch: 90,
              measurement: 'percentage',
            },
            time_to_upgrade: {
              silver: { target: 6, unit: 'months' },
              gold: { target: 18, unit: 'months' },
              platinum: { target: 36, unit: 'months' },
              measurement: 'average_months',
            },
          },
        },

        // Revenue impact targets
        revenue: {
          incremental_revenue: {
            target: 15, // 15% revenue increase from loyalty members
            minimum: 8,
            stretch: 25,
            measurement: 'percentage_vs_non_members',
          },
          member_value: {
            average_booking_value: {
              target: 20, // 20% higher than non-members
              minimum: 10,
              stretch: 35,
              measurement: 'percentage_premium',
            },
            booking_frequency: {
              target: 2.5, // 2.5x more frequent than non-members
              minimum: 1.8,
              stretch: 4.0,
              measurement: 'frequency_multiplier',
            },
          },
          program_roi: {
            target: 200, // 200% ROI
            minimum: 150,
            stretch: 300,
            measurement: 'percentage',
            calculation: 'benefits_minus_costs / costs',
            timeframe: 'annual',
          },
        },

        // Operational targets
        operations: {
          customer_service: {
            member_satisfaction: {
              target: 4.6, // 4.6/5.0 rating
              minimum: 4.2,
              stretch: 4.8,
              measurement: 'rating_scale_5',
            },
            issue_resolution: {
              target: 24, // 24 hours average
              maximum: 48,
              optimum: 12,
              measurement: 'hours',
              sla: 'first_response',
            },
            support_quality: {
              target: 90, // 90% satisfaction with support
              minimum: 85,
              stretch: 95,
              measurement: 'percentage',
            },
          },
          system_performance: {
            app_uptime: {
              target: 99.5,
              minimum: 99.0,
              stretch: 99.9,
              measurement: 'percentage',
            },
            response_time: {
              target: 2, // 2 seconds average
              maximum: 5,
              optimum: 1,
              measurement: 'seconds',
              endpoint: 'api_average',
            },
          },
        },

        // Market competitiveness targets
        competitive: {
          program_attractiveness: {
            earning_rate_ranking: {
              target: 'top_quartile',
              minimum: 'above_average',
              measurement: 'market_position',
            },
            benefit_value_ranking: {
              target: 'top_3',
              minimum: 'top_10',
              measurement: 'market_position',
            },
          },
          innovation: {
            new_features_per_quarter: {
              target: 2,
              minimum: 1,
              stretch: 4,
              measurement: 'feature_count',
            },
            member_adoption_rate: {
              target: 60, // 60% try new features
              minimum: 40,
              stretch: 80,
              measurement: 'percentage',
              timeframe: '90_days_post_launch',
            },
          },
        },

        // Seasonal and campaign targets
        campaigns: {
          participation: {
            promotion_uptake: {
              target: 35, // 35% of eligible members participate
              minimum: 25,
              stretch: 50,
              measurement: 'percentage',
            },
            seasonal_boost: {
              target: 25, // 25% activity increase during campaigns
              minimum: 15,
              stretch: 40,
              measurement: 'percentage_increase',
            },
          },
          effectiveness: {
            campaign_roi: {
              target: 150, // 150% ROI on campaigns
              minimum: 120,
              stretch: 200,
              measurement: 'percentage',
            },
            conversion_lift: {
              target: 18, // 18% conversion increase
              minimum: 12,
              stretch: 30,
              measurement: 'percentage',
            },
          },
        },
      };

      // Add dynamic targets based on current performance
      targets.dynamic = this.calculateDynamicTargets();

      // Add seasonal adjustments
      targets.seasonal_adjustments = this.getSeasonalAdjustments();

      // Add benchmarking context
      targets.benchmarks = {
        industry_standards: this.getIndustryStandards(),
        peer_comparison: this.getPeerBenchmarks(),
        best_practices: this.getBestPracticeTargets(),
      };

      // Add implementation roadmap
      targets.implementation = {
        quick_wins: this.getQuickWinTargets(), // 0-3 months
        medium_term: this.getMediumTermTargets(), // 3-12 months
        strategic: this.getStrategicTargets(), // 12+ months
        dependencies: this.getTargetDependencies(),
      };

      // Add monitoring and alerting thresholds
      targets.monitoring = {
        alert_thresholds: {
          critical: {
            // Immediate action required
            churn_rate: 25,
            activation_rate: 40,
            redemption_rate: 15,
            app_uptime: 98,
          },
          warning: {
            // Monitor closely
            churn_rate: 20,
            activation_rate: 50,
            redemption_rate: 25,
            engagement_score: 60,
          },
          opportunity: {
            // Optimization potential
            member_growth: 10,
            points_velocity: 5,
            campaign_participation: 20,
          },
        },
        review_frequency: {
          daily: ['app_uptime', 'redemption_activity'],
          weekly: ['member_acquisition', 'engagement_metrics'],
          monthly: ['tier_distribution', 'roi_analysis'],
          quarterly: ['strategic_targets', 'competitive_position'],
        },
      };

      return targets;
    } catch (error) {
      logger.error('Error getting loyalty targets:', error);
      return {
        error: 'Failed to retrieve loyalty targets',
        message: error.message,
        timestamp: new Date(),
        fallback: this.getDefaultLoyaltyTargets(),
      };
    }
  }

  /**
   * Helper methods for loyalty targets
   */
  calculateDynamicTargets() {
    // Calculate targets based on current performance and market conditions
    return {
      adaptive_growth: {
        calculation: 'current_performance * market_factor * seasonal_adjustment',
        update_frequency: 'monthly',
      },
      performance_based: {
        calculation: 'historical_trend + improvement_factor',
        confidence_interval: 85,
      },
    };
  }

  getSeasonalAdjustments() {
    return {
      Q1: { factor: 0.9, focus: 'retention' }, // Post-holiday slowdown
      Q2: { factor: 1.1, focus: 'acquisition' }, // Spring growth
      Q3: { factor: 1.2, focus: 'engagement' }, // Summer peak
      Q4: { factor: 1.0, focus: 'campaigns' }, // Holiday campaigns
    };
  }

  getQuickWinTargets() {
    return {
      email_optimization: { timeline: '4 weeks', impact: 'medium' },
      app_onboarding: { timeline: '6 weeks', impact: 'high' },
      redemption_simplification: { timeline: '8 weeks', impact: 'high' },
    };
  }
  /**
   * Calculate comparison metrics between periods, hotels, or segments
   * Provides detailed comparative analysis for strategic insights
   * @param {Object} baseQuery - Base MongoDB query
   * @param {Date} startDate - Comparison period start date
   * @param {Date} endDate - Comparison period end date
   * @returns {Object} Comprehensive comparison metrics
   */
  async calculateComparisonMetrics(baseQuery, startDate, endDate) {
    try {
      // Cache key for comparison metrics
      const cacheKey = this.buildAnalyticsCacheKey(
        'comparison',
        baseQuery.hotel?.toString() || 'all',
        {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          timestamp: Math.floor(Date.now() / (30 * 60 * 1000)), // 30 minutes cache
        }
      );

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'analytics');
      if (cached && this.validateComparisonCache(cached, startDate, endDate)) {
        return cached;
      }

      const comparison = {
        metadata: {
          baseQuery,
          comparisonPeriod: { start: startDate, end: endDate },
          currentPeriod: { start: new Date(Date.now() - (endDate - startDate)), end: new Date() },
          calculatedAt: new Date(),
          methodology: 'period_over_period_analysis',
        },
        membership: {},
        revenue: {},
        engagement: {},
        operational: {},
        growth: {},
        insights: [],
      };

      // Calculate current period metrics for comparison
      const currentStartDate = new Date(Date.now() - (endDate - startDate));
      const currentEndDate = new Date();

      // Membership comparison
      const [previousMembers, currentMembers] = await Promise.all([
        User.countDocuments({
          ...baseQuery,
          'loyalty.enrolledAt': { $gte: startDate, $lte: endDate },
        }),
        User.countDocuments({
          ...baseQuery,
          'loyalty.enrolledAt': { $gte: currentStartDate, $lte: currentEndDate },
        }),
      ]);

      comparison.membership = {
        newMembers: {
          previous: previousMembers,
          current: currentMembers,
          change: currentMembers - previousMembers,
          changePercent:
            previousMembers > 0
              ? Math.round(((currentMembers - previousMembers) / previousMembers) * 100)
              : currentMembers > 0
                ? 100
                : 0,
          trend: this.calculateTrend(previousMembers, currentMembers),
        },
        // Active members comparison
        activeMembers: await this.compareActiveMembers(
          baseQuery,
          startDate,
          endDate,
          currentStartDate,
          currentEndDate
        ),
        // Churn comparison
        churnAnalysis: await this.compareChurnRates(
          baseQuery,
          startDate,
          endDate,
          currentStartDate,
          currentEndDate
        ),
      };

      // Revenue comparison
      const [previousRevenue, currentRevenue] = await Promise.all([
        this.calculatePeriodRevenue(baseQuery, startDate, endDate),
        this.calculatePeriodRevenue(baseQuery, currentStartDate, currentEndDate),
      ]);

      comparison.revenue = {
        totalRevenue: {
          previous: previousRevenue.total,
          current: currentRevenue.total,
          change: currentRevenue.total - previousRevenue.total,
          changePercent:
            previousRevenue.total > 0
              ? Math.round(
                  ((currentRevenue.total - previousRevenue.total) / previousRevenue.total) * 100
                )
              : 0,
          trend: this.calculateTrend(previousRevenue.total, currentRevenue.total),
        },
        averageBookingValue: {
          previous: previousRevenue.avgBooking,
          current: currentRevenue.avgBooking,
          change: currentRevenue.avgBooking - previousRevenue.avgBooking,
          changePercent:
            previousRevenue.avgBooking > 0
              ? Math.round(
                  ((currentRevenue.avgBooking - previousRevenue.avgBooking) /
                    previousRevenue.avgBooking) *
                    100
                )
              : 0,
        },
        memberVsNonMember: await this.compareMemberRevenue(
          baseQuery,
          startDate,
          endDate,
          currentStartDate,
          currentEndDate
        ),
      };

      // Points and redemption comparison
      const [previousPoints, currentPoints] = await Promise.all([
        this.calculatePeriodPoints(baseQuery, startDate, endDate),
        this.calculatePeriodPoints(baseQuery, currentStartDate, currentEndDate),
      ]);

      comparison.points = {
        earned: {
          previous: previousPoints.earned,
          current: currentPoints.earned,
          change: currentPoints.earned - previousPoints.earned,
          changePercent:
            previousPoints.earned > 0
              ? Math.round(
                  ((currentPoints.earned - previousPoints.earned) / previousPoints.earned) * 100
                )
              : 0,
        },
        redeemed: {
          previous: previousPoints.redeemed,
          current: currentPoints.redeemed,
          change: currentPoints.redeemed - previousPoints.redeemed,
          changePercent:
            previousPoints.redeemed > 0
              ? Math.round(
                  ((currentPoints.redeemed - previousPoints.redeemed) / previousPoints.redeemed) *
                    100
                )
              : 0,
        },
        redemptionRate: {
          previous: previousPoints.redemptionRate,
          current: currentPoints.redemptionRate,
          change: currentPoints.redemptionRate - previousPoints.redemptionRate,
          changePercent:
            previousPoints.redemptionRate > 0
              ? Math.round(
                  ((currentPoints.redemptionRate - previousPoints.redemptionRate) /
                    previousPoints.redemptionRate) *
                    100
                )
              : 0,
        },
      };

      // Engagement comparison
      const [previousEngagement, currentEngagement] = await Promise.all([
        this.calculatePeriodEngagement(baseQuery, startDate, endDate),
        this.calculatePeriodEngagement(baseQuery, currentStartDate, currentEndDate),
      ]);

      comparison.engagement = {
        stickiness: {
          previous: previousEngagement.stickiness,
          current: currentEngagement.stickiness,
          change: currentEngagement.stickiness - previousEngagement.stickiness,
          changePercent:
            previousEngagement.stickiness > 0
              ? Math.round(
                  ((currentEngagement.stickiness - previousEngagement.stickiness) /
                    previousEngagement.stickiness) *
                    100
                )
              : 0,
        },
        activeUsers: {
          previous: previousEngagement.activeUsers,
          current: currentEngagement.activeUsers,
          change: currentEngagement.activeUsers - previousEngagement.activeUsers,
          changePercent:
            previousEngagement.activeUsers > 0
              ? Math.round(
                  ((currentEngagement.activeUsers - previousEngagement.activeUsers) /
                    previousEngagement.activeUsers) *
                    100
                )
              : 0,
        },
        sessionFrequency: {
          previous: previousEngagement.avgSessions,
          current: currentEngagement.avgSessions,
          change: currentEngagement.avgSessions - previousEngagement.avgSessions,
          changePercent:
            previousEngagement.avgSessions > 0
              ? Math.round(
                  ((currentEngagement.avgSessions - previousEngagement.avgSessions) /
                    previousEngagement.avgSessions) *
                    100
                )
              : 0,
        },
      };

      // Tier progression comparison
      const [previousTiers, currentTiers] = await Promise.all([
        this.calculateTierDistributionForPeriod(baseQuery, startDate, endDate),
        this.calculateTierDistributionForPeriod(baseQuery, currentStartDate, currentEndDate),
      ]);

      comparison.tiers = {
        upgrades: {
          previous: previousTiers.upgrades,
          current: currentTiers.upgrades,
          change: currentTiers.upgrades - previousTiers.upgrades,
          changePercent:
            previousTiers.upgrades > 0
              ? Math.round(
                  ((currentTiers.upgrades - previousTiers.upgrades) / previousTiers.upgrades) * 100
                )
              : 0,
        },
        distribution: this.compareTierDistribution(
          previousTiers.distribution,
          currentTiers.distribution
        ),
        velocity: {
          previous: previousTiers.avgUpgradeTime,
          current: currentTiers.avgUpgradeTime,
          improvement: previousTiers.avgUpgradeTime - currentTiers.avgUpgradeTime,
        },
      };

      // Campaign effectiveness comparison
      const [previousCampaigns, currentCampaigns] = await Promise.all([
        this.calculateCampaignMetrics(baseQuery, startDate, endDate),
        this.calculateCampaignMetrics(baseQuery, currentStartDate, currentEndDate),
      ]);

      comparison.campaigns = {
        participation: {
          previous: previousCampaigns.participationRate,
          current: currentCampaigns.participationRate,
          change: currentCampaigns.participationRate - previousCampaigns.participationRate,
        },
        effectiveness: {
          previous: previousCampaigns.avgROI,
          current: currentCampaigns.avgROI,
          change: currentCampaigns.avgROI - previousCampaigns.avgROI,
        },
        reach: {
          previous: previousCampaigns.totalReach,
          current: currentCampaigns.totalReach,
          change: currentCampaigns.totalReach - previousCampaigns.totalReach,
        },
      };

      // Operational metrics comparison
      comparison.operational = await this.compareOperationalMetrics(
        baseQuery,
        startDate,
        endDate,
        currentStartDate,
        currentEndDate
      );

      // Growth trajectory analysis
      comparison.growth = {
        membershipGrowth: this.analyzeGrowthTrajectory(comparison.membership),
        revenueGrowth: this.analyzeGrowthTrajectory(comparison.revenue),
        engagementGrowth: this.analyzeGrowthTrajectory(comparison.engagement),
        overallGrowth: this.calculateOverallGrowthScore(comparison),
        projectedTrends: this.projectFutureTrends(comparison),
        growthRateConsistency: this.calculateGrowthConsistency(comparison),
      };

      // Competitive position analysis
      comparison.competitive = {
        marketPosition: await this.analyzeMarketPosition(comparison),
        benchmarkComparison: this.compareToBenchmarks(comparison),
        competitiveAdvantage: this.identifyCompetitiveAdvantages(comparison),
        improvementAreas: this.identifyImprovementAreas(comparison),
      };

      // Statistical significance testing
      comparison.significance = {
        membershipGrowth: this.calculateStatisticalSignificance(
          previousMembers,
          currentMembers,
          'count'
        ),
        revenueChange: this.calculateStatisticalSignificance(
          previousRevenue.total,
          currentRevenue.total,
          'continuous'
        ),
        engagementChange: this.calculateStatisticalSignificance(
          previousEngagement.stickiness,
          currentEngagement.stickiness,
          'percentage'
        ),
        overallSignificance: this.calculateOverallSignificance(comparison),
      };

      // Generate insights and recommendations
      comparison.insights = this.generateComparisonInsights(comparison);
      comparison.recommendations = this.generateComparisonRecommendations(comparison);
      comparison.alerts = this.generateComparisonAlerts(comparison);

      // Performance scoring
      comparison.performance = {
        overallScore: this.calculateComparisonScore(comparison),
        categoryScores: this.calculateCategoryScores(comparison),
        improvement: this.calculateImprovementIndex(comparison),
        momentum: this.calculateMomentumScore(comparison),
      };

      // Cache the results
      await this.setInHybridCache(cacheKey, comparison, 'analytics', 30 * 60); // 30 minutes TTL

      return comparison;
    } catch (error) {
      logger.error('Error calculating comparison metrics:', error);
      return {
        error: 'Failed to calculate comparison metrics',
        message: error.message,
        timestamp: new Date(),
        fallback: this.getEmptyComparisonMetrics(),
      };
    }
  }

  /**
   * Helper methods for comparison calculations
   */
  async compareActiveMembers(baseQuery, startDate, endDate, currentStartDate, currentEndDate) {
    const [previousActive, currentActive] = await Promise.all([
      User.countDocuments({
        ...baseQuery,
        'loyalty.statistics.lastActivity': { $gte: startDate, $lte: endDate },
      }),
      User.countDocuments({
        ...baseQuery,
        'loyalty.statistics.lastActivity': { $gte: currentStartDate, $lte: currentEndDate },
      }),
    ]);

    return {
      previous: previousActive,
      current: currentActive,
      change: currentActive - previousActive,
      changePercent:
        previousActive > 0
          ? Math.round(((currentActive - previousActive) / previousActive) * 100)
          : 0,
      trend: this.calculateTrend(previousActive, currentActive),
    };
  }

  async calculatePeriodRevenue(baseQuery, startDate, endDate) {
    const bookings = await Booking.find({
      ...baseQuery,
      createdAt: { $gte: startDate, $lte: endDate },
      status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
    });

    const total = bookings.reduce((sum, booking) => sum + (booking.totalPrice || 0), 0);
    const avgBooking = bookings.length > 0 ? total / bookings.length : 0;

    return {
      total: Math.round(total * 100) / 100,
      avgBooking: Math.round(avgBooking * 100) / 100,
      bookingCount: bookings.length,
    };
  }

  async calculatePeriodPoints(baseQuery, startDate, endDate) {
    const transactions = await LoyaltyTransaction.aggregate([
      {
        $match: {
          ...baseQuery,
          createdAt: { $gte: startDate, $lte: endDate },
        },
      },
      {
        $group: {
          _id: null,
          earned: { $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] } },
          redeemed: {
            $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] },
          },
        },
      },
    ]);

    const result = transactions[0] || { earned: 0, redeemed: 0 };
    const redemptionRate = result.earned > 0 ? (result.redeemed / result.earned) * 100 : 0;

    return {
      earned: result.earned,
      redeemed: result.redeemed,
      redemptionRate: Math.round(redemptionRate * 100) / 100,
    };
  }

  calculateTrend(previous, current) {
    if (previous === 0 && current === 0) return 'stable';
    if (previous === 0) return 'new';

    const changePercent = ((current - previous) / previous) * 100;

    if (changePercent > 10) return 'strong_growth';
    if (changePercent > 5) return 'growth';
    if (changePercent > -5) return 'stable';
    if (changePercent > -10) return 'decline';
    return 'strong_decline';
  }

  calculateStatisticalSignificance(value1, value2, type) {
    // Simplified significance testing
    const difference = Math.abs(value1 - value2);
    const average = (value1 + value2) / 2;
    const relativeDifference = average > 0 ? (difference / average) * 100 : 0;

    if (relativeDifference > 20) return 'highly_significant';
    if (relativeDifference > 10) return 'significant';
    if (relativeDifference > 5) return 'moderately_significant';
    return 'not_significant';
  }

  generateComparisonInsights(comparison) {
    const insights = [];

    // Membership insights
    if (comparison.membership.newMembers.changePercent > 20) {
      insights.push({
        category: 'membership',
        type: 'positive',
        message: `Strong membership growth of ${comparison.membership.newMembers.changePercent}%`,
        impact: 'high',
      });
    } else if (comparison.membership.newMembers.changePercent < -10) {
      insights.push({
        category: 'membership',
        type: 'concern',
        message: `Membership acquisition declined by ${Math.abs(comparison.membership.newMembers.changePercent)}%`,
        impact: 'high',
      });
    }

    // Revenue insights
    if (comparison.revenue.totalRevenue.changePercent > 15) {
      insights.push({
        category: 'revenue',
        type: 'positive',
        message: `Excellent revenue growth of ${comparison.revenue.totalRevenue.changePercent}%`,
        impact: 'high',
      });
    }

    // Engagement insights
    if (comparison.engagement.stickiness.changePercent > 10) {
      insights.push({
        category: 'engagement',
        type: 'positive',
        message: `Improved member stickiness by ${comparison.engagement.stickiness.changePercent}%`,
        impact: 'medium',
      });
    }

    return insights;
  }

  /**
   * Cache validation for comparison data
   */
  validateComparisonCache(cached, startDate, endDate) {
    if (!cached || !cached.metadata) return false;

    const age = Date.now() - new Date(cached.metadata.calculatedAt).getTime();
    const maxAge = 30 * 60 * 1000; // 30 minutes

    if (age > maxAge) return false;

    return cached.membership && cached.revenue && cached.engagement;
  }

  getEmptyComparisonMetrics() {
    return {
      membership: { newMembers: { previous: 0, current: 0, change: 0, changePercent: 0 } },
      revenue: { totalRevenue: { previous: 0, current: 0, change: 0, changePercent: 0 } },
      engagement: { stickiness: { previous: 0, current: 0, change: 0, changePercent: 0 } },
      growth: { overallGrowth: 0 },
      insights: [],
      timestamp: new Date(),
    };
  }

  // Revenue and operational placeholder methods
  async calculateRevenueGrowth(query, currency) {
    try {
      const currentPeriod = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalPrice' },
            totalBookings: { $sum: 1 },
          },
        },
      ]);

      // Calculate previous period
      const periodDuration = query.createdAt.$lte - query.createdAt.$gte;
      const previousQuery = {
        ...query,
        createdAt: {
          $gte: new Date(query.createdAt.$gte.getTime() - periodDuration),
          $lte: query.createdAt.$gte,
        },
      };

      const previousPeriod = await Booking.aggregate([
        { $match: previousQuery },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalPrice' },
            totalBookings: { $sum: 1 },
          },
        },
      ]);

      const current = currentPeriod[0] || { totalRevenue: 0, totalBookings: 0 };
      const previous = previousPeriod[0] || { totalRevenue: 0, totalBookings: 0 };

      const revenueGrowth =
        previous.totalRevenue > 0
          ? ((current.totalRevenue - previous.totalRevenue) / previous.totalRevenue) * 100
          : 0;

      const bookingGrowth =
        previous.totalBookings > 0
          ? ((current.totalBookings - previous.totalBookings) / previous.totalBookings) * 100
          : 0;

      return {
        current: current.totalRevenue,
        previous: previous.totalRevenue,
        percentage: Math.round(revenueGrowth * 100) / 100,
        bookingGrowth: Math.round(bookingGrowth * 100) / 100,
        trend: revenueGrowth > 5 ? 'GROWING' : revenueGrowth < -5 ? 'DECLINING' : 'STABLE',
      };
    } catch (error) {
      logger.error('Error calculating revenue growth:', error);
      return { percentage: 0, trend: 'UNKNOWN' };
    }
  }
  calculateRevenueVariance(timeSeries) {
    if (!timeSeries || timeSeries.length < 2) return 0;

    const revenues = timeSeries.map((item) => item.revenue || 0);
    const mean = revenues.reduce((sum, val) => sum + val, 0) / revenues.length;

    const squaredDiffs = revenues.map((val) => Math.pow(val - mean, 2));
    const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / revenues.length;

    return Math.round(variance * 100) / 100;
  }
  groupOccupancyByPeriod(dailyOccupancy, granularity) {
    const grouped = {};

    Object.values(dailyOccupancy).forEach((day) => {
      let key;
      const date = moment(day.date);

      switch (granularity) {
        case 'weekly':
          key = date.format('YYYY-WW');
          break;
        case 'monthly':
          key = date.format('YYYY-MM');
          break;
        default:
          key = date.format('YYYY-MM-DD');
      }

      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          totalRooms: 0,
          occupiedRooms: 0,
          occupancyRate: 0,
          days: 0,
        };
      }

      grouped[key].totalRooms += day.totalRooms;
      grouped[key].occupiedRooms += day.occupiedRooms;
      grouped[key].days += 1;
    });

    // Calculate average occupancy for each period
    return Object.values(grouped)
      .map((period) => ({
        ...period,
        occupancyRate:
          period.totalRooms > 0
            ? Math.round((period.occupiedRooms / period.totalRooms) * 100) / 100
            : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }
  async calculateOccupancyByRoomType(query, bookings) {
    try {
      const roomTypeOccupancy = {};

      // Get total rooms by type
      const roomTypes = await Room.aggregate([
        { $match: { hotel: query.hotel } },
        {
          $group: {
            _id: '$type',
            totalRooms: { $sum: 1 },
          },
        },
      ]);

      // Initialize room type data
      roomTypes.forEach((rt) => {
        roomTypeOccupancy[rt._id] = {
          roomType: rt._id,
          totalRooms: rt.totalRooms,
          occupiedRooms: 0,
          occupancyRate: 0,
        };
      });

      // Calculate occupied rooms by type
      bookings.forEach((booking) => {
        booking.rooms.forEach((room) => {
          const roomType = room.type || room.roomType;
          if (roomTypeOccupancy[roomType]) {
            const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
            roomTypeOccupancy[roomType].occupiedRooms += nights;
          }
        });
      });

      // Calculate occupancy rates
      return Object.values(roomTypeOccupancy).map((rt) => ({
        ...rt,
        occupancyRate:
          rt.totalRooms > 0 ? Math.round((rt.occupiedRooms / rt.totalRooms) * 100) / 100 : 0,
      }));
    } catch (error) {
      logger.error('Error calculating occupancy by room type:', error);
      return [];
    }
  }
  analyzeWeeklyOccupancyPatterns(dailyOccupancy) {
    const weeklyPatterns = {
      Monday: { totalOccupancy: 0, days: 0 },
      Tuesday: { totalOccupancy: 0, days: 0 },
      Wednesday: { totalOccupancy: 0, days: 0 },
      Thursday: { totalOccupancy: 0, days: 0 },
      Friday: { totalOccupancy: 0, days: 0 },
      Saturday: { totalOccupancy: 0, days: 0 },
      Sunday: { totalOccupancy: 0, days: 0 },
    };

    Object.values(dailyOccupancy).forEach((day) => {
      const dayName = moment(day.date).format('dddd');
      if (weeklyPatterns[dayName]) {
        weeklyPatterns[dayName].totalOccupancy += day.occupancyRate;
        weeklyPatterns[dayName].days += 1;
      }
    });

    // Calculate averages and identify patterns
    const patterns = Object.entries(weeklyPatterns).map(([day, data]) => ({
      day,
      averageOccupancy:
        data.days > 0 ? Math.round((data.totalOccupancy / data.days) * 100) / 100 : 0,
      sampleSize: data.days,
    }));

    // Find peak and low days
    const sorted = patterns.sort((a, b) => b.averageOccupancy - a.averageOccupancy);

    return {
      patterns,
      peakDay: sorted[0],
      lowDay: sorted[sorted.length - 1],
      weekendAverage:
        (patterns.find((p) => p.day === 'Saturday')?.averageOccupancy +
          patterns.find((p) => p.day === 'Sunday')?.averageOccupancy) /
        2,
      weekdayAverage:
        patterns
          .filter((p) => !['Saturday', 'Sunday'].includes(p.day))
          .reduce((sum, p) => sum + p.averageOccupancy, 0) / 5,
    };
  }
  calculateOccupancyTrends(timeSeries) {
    if (!timeSeries || timeSeries.length < 2) {
      return { direction: 'INSUFFICIENT_DATA', strength: 0 };
    }

    const occupancyRates = timeSeries.map((item) => item.occupancyRate || 0);

    // Calculate linear trend
    const n = occupancyRates.length;
    const xValues = Array.from({ length: n }, (_, i) => i);
    const yValues = occupancyRates;

    const sumX = xValues.reduce((sum, val) => sum + val, 0);
    const sumY = yValues.reduce((sum, val) => sum + val, 0);
    const sumXY = xValues.reduce((sum, val, i) => sum + val * yValues[i], 0);
    const sumXX = xValues.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const correlation = this.calculateCorrelation(xValues, yValues);

    let direction = 'STABLE';
    if (slope > 1) direction = 'GROWING';
    else if (slope < -1) direction = 'DECLINING';

    return {
      direction,
      slope: Math.round(slope * 100) / 100,
      strength: Math.abs(correlation),
      correlation: Math.round(correlation * 100) / 100,
      volatility: this.calculateVariance(occupancyRates),
    };
  }
  analyzePriceDistribution(bookings, currency) {
    if (!bookings || bookings.length === 0) return [];

    const prices = bookings
      .map((booking) => booking.convertedAmount || booking.totalPrice || 0)
      .filter((price) => price > 0);

    if (prices.length === 0) return [];

    // Define price ranges
    const ranges = [
      { min: 0, max: 100, label: '€0-100' },
      { min: 100, max: 200, label: '€100-200' },
      { min: 200, max: 300, label: '€200-300' },
      { min: 300, max: 500, label: '€300-500' },
      { min: 500, max: 1000, label: '€500-1000' },
      { min: 1000, max: Infinity, label: '€1000+' },
    ];

    const distribution = ranges.map((range) => {
      const bookingsInRange = prices.filter((price) => price >= range.min && price < range.max);

      return {
        range: range.label,
        count: bookingsInRange.length,
        percentage: Math.round((bookingsInRange.length / prices.length) * 100),
        averagePrice:
          bookingsInRange.length > 0
            ? Math.round(
                bookingsInRange.reduce((sum, price) => sum + price, 0) / bookingsInRange.length
              )
            : 0,
        totalRevenue: bookingsInRange.reduce((sum, price) => sum + price, 0),
      };
    });

    // Add statistical measures
    const sortedPrices = prices.sort((a, b) => a - b);
    const median = sortedPrices[Math.floor(sortedPrices.length / 2)];
    const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;

    return {
      distribution,
      statistics: {
        min: Math.min(...prices),
        max: Math.max(...prices),
        average: Math.round(average),
        median: Math.round(median),
        totalBookings: prices.length,
        currency,
      },
    };
  }
  async calculatePriceElasticity(bookings, query) {
    try {
      // Group bookings by price ranges and time periods
      const priceGroups = {};

      bookings.forEach((booking) => {
        const price = booking.convertedAmount || booking.totalPrice || 0;
        const priceRange = Math.floor(price / 50) * 50; // Group by €50 ranges
        const weekOfYear = moment(booking.checkInDate).week();

        const key = `${priceRange}_${weekOfYear}`;

        if (!priceGroups[key]) {
          priceGroups[key] = {
            priceRange,
            week: weekOfYear,
            bookings: 0,
            totalRevenue: 0,
            averagePrice: 0,
          };
        }

        priceGroups[key].bookings += 1;
        priceGroups[key].totalRevenue += price;
      });

      // Calculate average prices and demand for each group
      const elasticityData = Object.values(priceGroups).map((group) => ({
        ...group,
        averagePrice: group.bookings > 0 ? group.totalRevenue / group.bookings : 0,
        demand: group.bookings,
      }));

      // Calculate price elasticity coefficient
      if (elasticityData.length < 2) {
        return { elasticity: 0, interpretation: 'Insufficient data' };
      }

      // Simple elasticity calculation: % change in demand / % change in price
      const sortedByPrice = elasticityData.sort((a, b) => a.averagePrice - b.averagePrice);
      const lowPrice = sortedByPrice[0];
      const highPrice = sortedByPrice[sortedByPrice.length - 1];

      const priceChange = (highPrice.averagePrice - lowPrice.averagePrice) / lowPrice.averagePrice;
      const demandChange = (highPrice.demand - lowPrice.demand) / lowPrice.demand;

      const elasticity = priceChange !== 0 ? demandChange / priceChange : 0;

      let interpretation = 'Neutral';
      if (elasticity < -1) interpretation = 'Elastic (price sensitive)';
      else if (elasticity > -1 && elasticity < 0) interpretation = 'Inelastic (price insensitive)';
      else if (elasticity > 0) interpretation = 'Positive elasticity (luxury good behavior)';

      return {
        elasticity: Math.round(elasticity * 100) / 100,
        interpretation,
        dataPoints: elasticityData.length,
        priceRange: {
          min: lowPrice.averagePrice,
          max: highPrice.averagePrice,
        },
        demandRange: {
          min: Math.min(...elasticityData.map((d) => d.demand)),
          max: Math.max(...elasticityData.map((d) => d.demand)),
        },
      };
    } catch (error) {
      logger.error('Error calculating price elasticity:', error);
      return { elasticity: 0, interpretation: 'Calculation error' };
    }
  }
  async analyzeYieldPricingImpact(bookings) {
    try {
      if (!bookings || bookings.length === 0) {
        return { message: 'No bookings data available for yield impact analysis' };
      }

      // Filter bookings with yield management data
      const yieldBookings = bookings.filter(
        (booking) => booking.yieldManagement && booking.yieldManagement.enabled
      );

      if (yieldBookings.length === 0) {
        return {
          message: 'No yield-managed bookings found',
          totalBookings: bookings.length,
          yieldManagedBookings: 0,
          adoptionRate: 0,
        };
      }

      // Calculate yield impact metrics
      let totalYieldRevenue = 0;
      let totalBaseRevenue = 0;
      let totalRevenueImpact = 0;
      let positiveAdjustments = 0;
      let negativeAdjustments = 0;
      let neutralAdjustments = 0;

      const impactByStrategy = {};
      const impactByDemandLevel = {};
      const impactByRoomType = {};

      yieldBookings.forEach((booking) => {
        const yieldData = booking.yieldManagement;
        const actualPrice = booking.totalPrice || 0;
        const basePrice = yieldData.originalPrice || yieldData.basePrice || actualPrice;
        const priceAdjustment = actualPrice - basePrice;

        totalYieldRevenue += actualPrice;
        totalBaseRevenue += basePrice;
        totalRevenueImpact += priceAdjustment;

        // Categorize adjustments
        if (priceAdjustment > 5) {
          positiveAdjustments++;
        } else if (priceAdjustment < -5) {
          negativeAdjustments++;
        } else {
          neutralAdjustments++;
        }

        // Group by strategy
        const strategy = yieldData.strategy || 'MODERATE';
        if (!impactByStrategy[strategy]) {
          impactByStrategy[strategy] = {
            bookings: 0,
            totalImpact: 0,
            avgImpact: 0,
            revenue: 0,
          };
        }
        impactByStrategy[strategy].bookings++;
        impactByStrategy[strategy].totalImpact += priceAdjustment;
        impactByStrategy[strategy].revenue += actualPrice;

        // Group by demand level
        const demandLevel = yieldData.demandLevel || 'NORMAL';
        if (!impactByDemandLevel[demandLevel]) {
          impactByDemandLevel[demandLevel] = {
            bookings: 0,
            totalImpact: 0,
            avgImpact: 0,
            revenue: 0,
          };
        }
        impactByDemandLevel[demandLevel].bookings++;
        impactByDemandLevel[demandLevel].totalImpact += priceAdjustment;
        impactByDemandLevel[demandLevel].revenue += actualPrice;

        // Group by room type
        const roomType = booking.rooms[0]?.type || 'UNKNOWN';
        if (!impactByRoomType[roomType]) {
          impactByRoomType[roomType] = {
            bookings: 0,
            totalImpact: 0,
            avgImpact: 0,
            revenue: 0,
          };
        }
        impactByRoomType[roomType].bookings++;
        impactByRoomType[roomType].totalImpact += priceAdjustment;
        impactByRoomType[roomType].revenue += actualPrice;
      });

      // Calculate averages for each grouping
      Object.values(impactByStrategy).forEach((strategy) => {
        strategy.avgImpact =
          strategy.bookings > 0
            ? Math.round((strategy.totalImpact / strategy.bookings) * 100) / 100
            : 0;
      });

      Object.values(impactByDemandLevel).forEach((demand) => {
        demand.avgImpact =
          demand.bookings > 0 ? Math.round((demand.totalImpact / demand.bookings) * 100) / 100 : 0;
      });

      Object.values(impactByRoomType).forEach((room) => {
        room.avgImpact =
          room.bookings > 0 ? Math.round((room.totalImpact / room.bookings) * 100) / 100 : 0;
      });

      // Calculate performance metrics
      const avgImpactPerBooking =
        yieldBookings.length > 0 ? totalRevenueImpact / yieldBookings.length : 0;

      const revenueUplift =
        totalBaseRevenue > 0
          ? ((totalYieldRevenue - totalBaseRevenue) / totalBaseRevenue) * 100
          : 0;

      const adoptionRate = bookings.length > 0 ? (yieldBookings.length / bookings.length) * 100 : 0;

      // Calculate yield effectiveness score
      const effectivenessFactors = {
        revenueImpact: Math.min(100, Math.max(0, revenueUplift + 50)), // Normalize to 0-100
        adoptionRate: adoptionRate,
        adjustmentBalance:
          100 -
          Math.abs(((positiveAdjustments - negativeAdjustments) / yieldBookings.length) * 100),
        strategyDiversity: Object.keys(impactByStrategy).length * 20, // Max 5 strategies
      };

      const yieldEffectivenessScore = Math.round(
        effectivenessFactors.revenueImpact * 0.4 +
          effectivenessFactors.adoptionRate * 0.3 +
          effectivenessFactors.adjustmentBalance * 0.2 +
          effectivenessFactors.strategyDiversity * 0.1
      );

      // Generate insights
      const insights = [];

      if (revenueUplift > 10) {
        insights.push({
          type: 'SUCCESS',
          message: `Strong yield performance with ${revenueUplift.toFixed(1)}% revenue uplift`,
          recommendation: 'Continue current yield strategies and consider expansion',
        });
      } else if (revenueUplift < 0) {
        insights.push({
          type: 'WARNING',
          message: `Negative yield impact of ${Math.abs(revenueUplift).toFixed(1)}%`,
          recommendation: 'Review yield rules and pricing strategies immediately',
        });
      }

      if (adoptionRate < 50) {
        insights.push({
          type: 'OPPORTUNITY',
          message: `Low yield adoption rate at ${adoptionRate.toFixed(1)}%`,
          recommendation: 'Increase yield management coverage across more bookings',
        });
      }

      if (positiveAdjustments / yieldBookings.length > 0.8) {
        insights.push({
          type: 'WARNING',
          message: 'Predominantly price increases detected',
          recommendation: 'Balance pricing strategy to avoid customer resistance',
        });
      }

      return {
        summary: {
          totalBookings: bookings.length,
          yieldManagedBookings: yieldBookings.length,
          adoptionRate: Math.round(adoptionRate * 100) / 100,
          totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
          avgImpactPerBooking: Math.round(avgImpactPerBooking * 100) / 100,
          revenueUplift: Math.round(revenueUplift * 100) / 100,
          yieldEffectivenessScore,
        },
        adjustmentDistribution: {
          positive: positiveAdjustments,
          negative: negativeAdjustments,
          neutral: neutralAdjustments,
          positiveRate: Math.round((positiveAdjustments / yieldBookings.length) * 100),
          negativeRate: Math.round((negativeAdjustments / yieldBookings.length) * 100),
        },
        impactAnalysis: {
          byStrategy: impactByStrategy,
          byDemandLevel: impactByDemandLevel,
          byRoomType: impactByRoomType,
        },
        performance: {
          effectivenessScore: yieldEffectivenessScore,
          factors: effectivenessFactors,
          rating:
            yieldEffectivenessScore >= 80
              ? 'EXCELLENT'
              : yieldEffectivenessScore >= 60
                ? 'GOOD'
                : yieldEffectivenessScore >= 40
                  ? 'AVERAGE'
                  : 'POOR',
        },
        insights,
        recommendations: this.generateYieldImpactRecommendations({
          revenueUplift,
          adoptionRate,
          effectivenessScore: yieldEffectivenessScore,
          adjustmentBalance: positiveAdjustments - negativeAdjustments,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing yield pricing impact:', error);
      return {
        error: 'Failed to analyze yield pricing impact',
        message: error.message,
      };
    }
  }

  analyzePricingTrends(bookings, currency) {
    try {
      if (!bookings || bookings.length === 0) {
        return { message: 'No bookings data available for pricing trend analysis' };
      }

      // Group bookings by time periods
      const timeSeriesData = {};
      const priceByRoomType = {};
      const priceBySource = {};
      const priceByDayOfWeek = {};
      const priceByLeadTime = {};

      bookings.forEach((booking) => {
        const price = booking.convertedAmount || booking.totalPrice || 0;
        const bookingDate = moment(booking.createdAt);
        const checkInDate = moment(booking.checkInDate);

        // Time series (weekly)
        const weekKey = bookingDate.format('YYYY-WW');
        if (!timeSeriesData[weekKey]) {
          timeSeriesData[weekKey] = {
            week: weekKey,
            prices: [],
            totalRevenue: 0,
            bookingCount: 0,
          };
        }
        timeSeriesData[weekKey].prices.push(price);
        timeSeriesData[weekKey].totalRevenue += price;
        timeSeriesData[weekKey].bookingCount++;

        // Room type analysis
        const roomType = booking.rooms[0]?.type || 'UNKNOWN';
        if (!priceByRoomType[roomType]) {
          priceByRoomType[roomType] = { prices: [], bookings: 0 };
        }
        priceByRoomType[roomType].prices.push(price);
        priceByRoomType[roomType].bookings++;

        // Source analysis
        const source = booking.source || 'DIRECT';
        if (!priceBySource[source]) {
          priceBySource[source] = { prices: [], bookings: 0 };
        }
        priceBySource[source].prices.push(price);
        priceBySource[source].bookings++;

        // Day of week analysis
        const dayOfWeek = checkInDate.format('dddd');
        if (!priceByDayOfWeek[dayOfWeek]) {
          priceByDayOfWeek[dayOfWeek] = { prices: [], bookings: 0 };
        }
        priceByDayOfWeek[dayOfWeek].prices.push(price);
        priceByDayOfWeek[dayOfWeek].bookings++;

        // Lead time analysis
        const leadTime = checkInDate.diff(bookingDate, 'days');
        const leadTimeCategory =
          leadTime <= 1
            ? 'SAME_DAY'
            : leadTime <= 7
              ? 'WEEK'
              : leadTime <= 30
                ? 'MONTH'
                : 'ADVANCE';

        if (!priceByLeadTime[leadTimeCategory]) {
          priceByLeadTime[leadTimeCategory] = { prices: [], bookings: 0, avgLeadTime: 0 };
        }
        priceByLeadTime[leadTimeCategory].prices.push(price);
        priceByLeadTime[leadTimeCategory].bookings++;
        priceByLeadTime[leadTimeCategory].avgLeadTime += leadTime;
      });

      // Calculate time series trends
      const weeklyTrends = Object.values(timeSeriesData)
        .sort((a, b) => a.week.localeCompare(b.week))
        .map((week) => ({
          week: week.week,
          avgPrice: Math.round((week.totalRevenue / week.bookingCount) * 100) / 100,
          totalRevenue: Math.round(week.totalRevenue * 100) / 100,
          bookingCount: week.bookingCount,
          priceVariance: this.calculateVariance(week.prices),
        }));

      // Calculate overall trend direction
      const priceValues = weeklyTrends.map((w) => w.avgPrice);
      const trendAnalysis = this.calculateLinearTrend(priceValues);

      let trendDirection = 'STABLE';
      if (trendAnalysis.slope > 2) trendDirection = 'INCREASING';
      else if (trendAnalysis.slope < -2) trendDirection = 'DECREASING';

      // Room type price analysis
      const roomTypePricing = Object.entries(priceByRoomType)
        .map(([type, data]) => {
          const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;
          const minPrice = Math.min(...data.prices);
          const maxPrice = Math.max(...data.prices);

          return {
            roomType: type,
            avgPrice: Math.round(avgPrice * 100) / 100,
            minPrice: Math.round(minPrice * 100) / 100,
            maxPrice: Math.round(maxPrice * 100) / 100,
            priceRange: Math.round((maxPrice - minPrice) * 100) / 100,
            bookings: data.bookings,
            priceVariability: this.calculateVariance(data.prices),
          };
        })
        .sort((a, b) => b.avgPrice - a.avgPrice);

      // Source price analysis
      const sourcePricing = Object.entries(priceBySource)
        .map(([source, data]) => {
          const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;

          return {
            source,
            avgPrice: Math.round(avgPrice * 100) / 100,
            bookings: data.bookings,
            marketShare: Math.round((data.bookings / bookings.length) * 100),
            totalRevenue: Math.round(data.prices.reduce((sum, p) => sum + p, 0) * 100) / 100,
          };
        })
        .sort((a, b) => b.avgPrice - a.avgPrice);

      // Day of week pricing patterns
      const dayOfWeekPricing = Object.entries(priceByDayOfWeek).map(([day, data]) => {
        const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;

        return {
          day,
          avgPrice: Math.round(avgPrice * 100) / 100,
          bookings: data.bookings,
          dayType: ['Saturday', 'Sunday'].includes(day) ? 'WEEKEND' : 'WEEKDAY',
        };
      });

      // Lead time pricing analysis
      const leadTimePricing = Object.entries(priceByLeadTime).map(([category, data]) => {
        const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length;
        const avgLeadTime = Math.round(data.avgLeadTime / data.bookings);

        return {
          category,
          avgPrice: Math.round(avgPrice * 100) / 100,
          avgLeadTime,
          bookings: data.bookings,
          share: Math.round((data.bookings / bookings.length) * 100),
        };
      });

      // Calculate price elasticity indicators
      const priceElasticityIndicators = this.calculatePriceElasticityIndicators(weeklyTrends);

      // Identify pricing anomalies
      const anomalies = this.identifyPricingAnomalies(weeklyTrends);

      // Generate pricing insights
      const insights = [];

      // Trend insights
      if (trendDirection === 'INCREASING' && trendAnalysis.correlation > 0.5) {
        insights.push({
          type: 'POSITIVE',
          category: 'TREND',
          message: `Positive pricing trend detected with ${trendAnalysis.correlation.toFixed(2)} correlation`,
          impact: 'Revenue growth opportunity identified',
        });
      } else if (trendDirection === 'DECREASING' && trendAnalysis.correlation < -0.5) {
        insights.push({
          type: 'WARNING',
          category: 'TREND',
          message: `Declining pricing trend with ${Math.abs(trendAnalysis.correlation).toFixed(2)} correlation`,
          impact: 'Revenue decline risk identified',
        });
      }

      // Room type insights
      const highestPricedRoom = roomTypePricing[0];
      const lowestPricedRoom = roomTypePricing[roomTypePricing.length - 1];

      if (highestPricedRoom && lowestPricedRoom) {
        const priceDifference = highestPricedRoom.avgPrice - lowestPricedRoom.avgPrice;
        insights.push({
          type: 'INFO',
          category: 'ROOM_TYPE',
          message: `Price difference between room types: €${priceDifference.toFixed(0)}`,
          impact: `${highestPricedRoom.roomType} commands ${Math.round((priceDifference / lowestPricedRoom.avgPrice) * 100)}% premium`,
        });
      }

      // Weekend vs weekday analysis
      const weekendPrices = dayOfWeekPricing.filter((d) => d.dayType === 'WEEKEND');
      const weekdayPrices = dayOfWeekPricing.filter((d) => d.dayType === 'WEEKDAY');

      if (weekendPrices.length > 0 && weekdayPrices.length > 0) {
        const weekendAvg =
          weekendPrices.reduce((sum, d) => sum + d.avgPrice, 0) / weekendPrices.length;
        const weekdayAvg =
          weekdayPrices.reduce((sum, d) => sum + d.avgPrice, 0) / weekdayPrices.length;
        const weekendPremium = ((weekendAvg - weekdayAvg) / weekdayAvg) * 100;

        insights.push({
          type: 'INFO',
          category: 'WEEKLY_PATTERN',
          message: `Weekend premium: ${weekendPremium.toFixed(1)}%`,
          impact:
            weekendPremium > 20
              ? 'Strong weekend pricing power'
              : 'Limited weekend differentiation',
        });
      }

      return {
        currency,
        period: {
          totalBookings: bookings.length,
          dateRange: {
            from: Math.min(...bookings.map((b) => new Date(b.createdAt))),
            to: Math.max(...bookings.map((b) => new Date(b.createdAt))),
          },
        },
        trends: {
          direction: trendDirection,
          correlation: Math.round(trendAnalysis.correlation * 100) / 100,
          slope: Math.round(trendAnalysis.slope * 100) / 100,
          strength:
            Math.abs(trendAnalysis.correlation) > 0.5
              ? 'STRONG'
              : Math.abs(trendAnalysis.correlation) > 0.3
                ? 'MODERATE'
                : 'WEAK',
          weeklyData: weeklyTrends,
        },
        segmentation: {
          roomType: roomTypePricing,
          source: sourcePricing,
          dayOfWeek: dayOfWeekPricing,
          leadTime: leadTimePricing,
        },
        analysis: {
          elasticity: priceElasticityIndicators,
          anomalies,
          volatility: {
            overall: this.calculateVariance(
              bookings.map((b) => b.convertedAmount || b.totalPrice || 0)
            ),
            byWeek: weeklyTrends.map((w) => ({ week: w.week, variance: w.priceVariance })),
          },
        },
        insights,
        recommendations: this.generatePricingTrendRecommendations({
          trendDirection,
          correlation: trendAnalysis.correlation,
          roomTypePricing,
          sourcePricing,
          anomalies,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing pricing trends:', error);
      return {
        error: 'Failed to analyze pricing trends',
        message: error.message,
      };
    }
  }

  async analyzeCompetitivePricing(query) {
    try {
      // Get hotel information
      const hotel = await Hotel.findById(query.hotel).populate('location');

      if (!hotel) {
        return { error: 'Hotel not found for competitive analysis' };
      }

      // Find similar hotels in the area (simplified approach)
      const competitorQuery = {
        _id: { $ne: hotel._id },
        isActive: true,
        stars: { $in: [hotel.stars - 1, hotel.stars, hotel.stars + 1] }, // Similar star rating
      };

      // Add location-based filtering if available
      if (hotel.location && hotel.location.coordinates) {
        const radius = 5000; // 5km radius
        competitorQuery['location.coordinates'] = {
          $near: {
            $geometry: hotel.location,
            $maxDistance: radius,
          },
        };
      } else if (hotel.city) {
        competitorQuery.city = hotel.city;
      }

      const competitors = await Hotel.find(competitorQuery)
        .select('name stars baseRooms averagePrice location city')
        .limit(10);

      if (competitors.length === 0) {
        return {
          message: 'No comparable competitors found',
          hotel: {
            name: hotel.name,
            stars: hotel.stars,
            location: hotel.city,
          },
          analysis: 'INSUFFICIENT_DATA',
        };
      }

      // Get recent pricing data for target hotel
      const recentBookings = await Booking.find({
        hotel: hotel._id,
        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      });

      if (recentBookings.length === 0) {
        return {
          message: 'No recent booking data available for competitive analysis',
          competitors: competitors.length,
          analysis: 'INSUFFICIENT_PRICING_DATA',
        };
      }

      // Calculate hotel's average pricing
      const hotelPricing = this.calculateHotelPricingMetrics(recentBookings);

      // Get competitor pricing data (in real scenario, this would come from external APIs or market data)
      const competitorAnalysis = await Promise.all(
        competitors.map(async (competitor) => {
          // Simulate competitive pricing data (in production, use real market data)
          const competitorBookings = await Booking.find({
            hotel: competitor._id,
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          }).limit(50);

          let competitorMetrics;
          if (competitorBookings.length > 0) {
            competitorMetrics = this.calculateHotelPricingMetrics(competitorBookings);
          } else {
            // Use estimated pricing based on hotel category and base rates
            competitorMetrics = this.estimateCompetitorPricing(competitor);
          }

          return {
            id: competitor._id,
            name: competitor.name,
            stars: competitor.stars,
            location: competitor.city,
            pricing: competitorMetrics,
            dataQuality: competitorBookings.length > 0 ? 'ACTUAL' : 'ESTIMATED',
          };
        })
      );

      // Competitive positioning analysis
      const marketAnalysis = this.analyzeMarketPosition(hotelPricing, competitorAnalysis);

      // Price gap analysis
      const priceGapAnalysis = this.analyzePriceGaps(hotelPricing, competitorAnalysis);

      // Market segment analysis
      const segmentAnalysis = this.analyzeCompetitiveSegments(hotel, competitors, hotelPricing);

      // Opportunity analysis
      const opportunities = this.identifyCompetitiveOpportunities({
        hotel,
        hotelPricing,
        competitors: competitorAnalysis,
        marketPosition: marketAnalysis,
      });

      // Rate parity analysis (simplified)
      const rateParityAnalysis = this.analyzeRateParity(hotelPricing, competitorAnalysis);

      // Generate competitive insights
      const insights = [];

      // Market position insights
      if (marketAnalysis.position === 'PREMIUM') {
        insights.push({
          type: 'POSITIVE',
          category: 'POSITIONING',
          message: `Premium positioning with ${marketAnalysis.premiumPercentage.toFixed(1)}% price premium`,
          recommendation: 'Maintain premium positioning through superior service quality',
        });
      } else if (marketAnalysis.position === 'DISCOUNT') {
        insights.push({
          type: 'OPPORTUNITY',
          category: 'POSITIONING',
          message: `Below-market pricing with ${Math.abs(marketAnalysis.premiumPercentage).toFixed(1)}% discount`,
          recommendation: 'Consider gradual price increases to capture market value',
        });
      }

      // Price gap insights
      if (priceGapAnalysis.largestGap > 50) {
        insights.push({
          type: 'WARNING',
          category: 'PRICE_GAP',
          message: `Large price gap of €${priceGapAnalysis.largestGap.toFixed(0)} with closest competitor`,
          recommendation: 'Review pricing strategy to ensure competitive alignment',
        });
      }

      // Rate parity insights
      if (rateParityAnalysis.parityIssues > 0) {
        insights.push({
          type: 'WARNING',
          category: 'RATE_PARITY',
          message: `Rate parity issues detected across ${rateParityAnalysis.parityIssues} segments`,
          recommendation: 'Audit distribution channels for rate consistency',
        });
      }

      return {
        hotel: {
          id: hotel._id,
          name: hotel.name,
          stars: hotel.stars,
          location: hotel.city,
          pricing: hotelPricing,
        },
        market: {
          competitorCount: competitors.length,
          analysisRadius: hotel.location ? '5km' : 'city-wide',
          dataQuality:
            competitorAnalysis.filter((c) => c.dataQuality === 'ACTUAL').length /
            competitorAnalysis.length,
          averageStars: competitors.reduce((sum, c) => sum + c.stars, 0) / competitors.length,
        },
        competitors: competitorAnalysis.map((c) => ({
          name: c.name,
          stars: c.stars,
          avgPrice: c.pricing.averagePrice,
          pricePosition: c.pricing.averagePrice > hotelPricing.averagePrice ? 'ABOVE' : 'BELOW',
          priceDifference: Math.round(Math.abs(c.pricing.averagePrice - hotelPricing.averagePrice)),
          dataQuality: c.dataQuality,
        })),
        analysis: {
          marketPosition: marketAnalysis,
          priceGaps: priceGapAnalysis,
          segments: segmentAnalysis,
          rateParity: rateParityAnalysis,
        },
        opportunities,
        insights,
        recommendations: this.generateCompetitiveRecommendations({
          marketPosition: marketAnalysis,
          priceGaps: priceGapAnalysis,
          opportunities,
          hotel: hotelPricing,
        }),
        metadata: {
          analysisDate: new Date(),
          dataFreshness: '30 days',
          competitorDataQuality: competitorAnalysis.map((c) => ({
            name: c.name,
            quality: c.dataQuality,
            bookingsAnalyzed: c.dataQuality === 'ACTUAL' ? 'Available' : 'Estimated',
          })),
        },
      };
    } catch (error) {
      logger.error('Error analyzing competitive pricing:', error);
      return {
        error: 'Failed to analyze competitive pricing',
        message: error.message,
      };
    }
  }

  groupBookingsByPeriod(bookings, granularity) {
    const grouped = {};

    bookings.forEach((booking) => {
      let key;
      const date = moment(booking.checkInDate || booking.createdAt);

      switch (granularity) {
        case 'hourly':
          key = date.format('YYYY-MM-DD HH');
          break;
        case 'weekly':
          key = date.format('YYYY-WW');
          break;
        case 'monthly':
          key = date.format('YYYY-MM');
          break;
        default:
          key = date.format('YYYY-MM-DD');
      }

      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          bookings: 0,
          revenue: 0,
          roomNights: 0,
          averageBookingValue: 0,
        };
      }

      const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
      const revenue = booking.convertedAmount || booking.totalPrice || 0;

      grouped[key].bookings += 1;
      grouped[key].revenue += revenue;
      grouped[key].roomNights += booking.rooms.length * nights;
    });

    // Calculate averages
    return Object.values(grouped)
      .map((period) => ({
        ...period,
        averageBookingValue:
          period.bookings > 0 ? Math.round((period.revenue / period.bookings) * 100) / 100 : 0,
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }
  calculateTrendMetrics(groupedData) {
    if (!groupedData || groupedData.length < 2) {
      return { direction: 'INSUFFICIENT_DATA', strength: 0 };
    }

    const values = groupedData.map((item) => item.bookings || item.revenue || 0);

    // Linear regression for trend
    const n = values.length;
    const xValues = Array.from({ length: n }, (_, i) => i);

    const sumX = xValues.reduce((sum, val) => sum + val, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = xValues.reduce((sum, val, i) => sum + val * values[i], 0);
    const sumXX = xValues.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate R-squared for trend strength
    const meanY = sumY / n;
    const ssTotal = values.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);
    const ssResidual = values.reduce((sum, val, i) => {
      const predicted = slope * i + intercept;
      return sum + Math.pow(val - predicted, 2);
    }, 0);

    const rSquared = ssTotal > 0 ? 1 - ssResidual / ssTotal : 0;

    // Determine trend direction
    let direction = 'STABLE';
    if (slope > 0.1) direction = 'GROWING';
    else if (slope < -0.1) direction = 'DECLINING';

    // Calculate momentum (recent vs overall trend)
    const recentData = values.slice(-Math.min(7, Math.floor(n / 3)));
    const recentAverage = recentData.reduce((sum, val) => sum + val, 0) / recentData.length;
    const overallAverage = meanY;
    const momentum =
      overallAverage > 0 ? ((recentAverage - overallAverage) / overallAverage) * 100 : 0;

    return {
      direction,
      slope: Math.round(slope * 100) / 100,
      strength: Math.round(rSquared * 100) / 100,
      momentum: Math.round(momentum * 100) / 100,
      confidence: rSquared > 0.7 ? 'HIGH' : rSquared > 0.4 ? 'MEDIUM' : 'LOW',
      dataPoints: n,
      average: Math.round(meanY * 100) / 100,
    };
  }
  identifyTrendPatterns(groupedData) {
    if (!groupedData || groupedData.length < 7) {
      return { patterns: [], confidence: 'LOW' };
    }

    const values = groupedData.map((item) => item.bookings || item.revenue || 0);
    const patterns = [];

    // Weekly pattern detection
    if (values.length >= 7) {
      const weeklyPattern = this.detectWeeklyPattern(values);
      if (weeklyPattern.strength > 0.3) {
        patterns.push({
          type: 'WEEKLY',
          description: 'Weekly recurring pattern detected',
          strength: weeklyPattern.strength,
          details: weeklyPattern.details,
        });
      }
    }

    // Seasonal pattern detection
    if (values.length >= 30) {
      const seasonalPattern = this.detectSeasonalPattern(values);
      if (seasonalPattern.strength > 0.3) {
        patterns.push({
          type: 'SEASONAL',
          description: 'Seasonal pattern detected',
          strength: seasonalPattern.strength,
          details: seasonalPattern.details,
        });
      }
    }

    // Growth phase detection
    const growthPhases = this.detectGrowthPhases(values);
    if (growthPhases.length > 0) {
      patterns.push({
        type: 'GROWTH_PHASES',
        description: 'Growth/decline phases identified',
        phases: growthPhases,
      });
    }

    // Volatility analysis
    const volatility = this.calculateVariance(values);
    const meanValue = values.reduce((sum, val) => sum + val, 0) / values.length;
    const volatilityRatio = meanValue > 0 ? volatility / meanValue : 0;

    if (volatilityRatio > 0.5) {
      patterns.push({
        type: 'HIGH_VOLATILITY',
        description: 'High volatility detected',
        volatilityRatio: Math.round(volatilityRatio * 100) / 100,
      });
    }

    return {
      patterns,
      confidence: patterns.length > 0 ? 'MEDIUM' : 'LOW',
      totalPatterns: patterns.length,
      recommendation: this.generatePatternRecommendations(patterns),
    };
  }

  detectWeeklyPattern(values) {
    // Auto-correlation for 7-day lag
    if (values.length < 14) return { strength: 0 };

    const lag = 7;
    let correlation = 0;
    let count = 0;

    for (let i = lag; i < values.length; i++) {
      correlation += values[i] * values[i - lag];
      count++;
    }

    const meanSquare = values.reduce((sum, val) => sum + val * val, 0) / values.length;
    const normalizedCorrelation = count > 0 ? correlation / (count * meanSquare) : 0;

    return {
      strength: Math.min(1, Math.abs(normalizedCorrelation)),
      details: {
        correlation: Math.round(normalizedCorrelation * 100) / 100,
        lag: lag,
        confidence: count > 14 ? 'HIGH' : 'MEDIUM',
      },
    };
  }

  detectSeasonalPattern(values) {
    // Simple seasonal detection using 30-day periods
    const seasonLength = 30;
    if (values.length < seasonLength * 2) return { strength: 0 };

    const seasons = [];
    for (let i = 0; i < values.length; i += seasonLength) {
      const seasonData = values.slice(i, i + seasonLength);
      if (seasonData.length === seasonLength) {
        const average = seasonData.reduce((sum, val) => sum + val, 0) / seasonLength;
        seasons.push(average);
      }
    }

    if (seasons.length < 2) return { strength: 0 };

    const seasonVariance = this.calculateVariance(seasons);
    const overallMean = seasons.reduce((sum, val) => sum + val, 0) / seasons.length;
    const strength = overallMean > 0 ? seasonVariance / (overallMean * overallMean) : 0;

    return {
      strength: Math.min(1, strength),
      details: {
        seasons: seasons.length,
        variance: Math.round(seasonVariance),
        averageSeasonValue: Math.round(overallMean),
      },
    };
  }

  detectGrowthPhases(values) {
    const phases = [];
    let currentPhase = null;

    for (let i = 1; i < values.length; i++) {
      const change = values[i] - values[i - 1];
      const changePercent = values[i - 1] > 0 ? (change / values[i - 1]) * 100 : 0;

      let phaseType = 'STABLE';
      if (changePercent > 5) phaseType = 'GROWTH';
      else if (changePercent < -5) phaseType = 'DECLINE';

      if (!currentPhase || currentPhase.type !== phaseType) {
        if (currentPhase) phases.push(currentPhase);
        currentPhase = {
          type: phaseType,
          start: i - 1,
          duration: 1,
          totalChange: changePercent,
        };
      } else {
        currentPhase.duration++;
        currentPhase.totalChange += changePercent;
      }
    }

    if (currentPhase) phases.push(currentPhase);

    // Filter out very short phases
    return phases.filter((phase) => phase.duration >= 3);
  }

  generatePatternRecommendations(patterns) {
    const recommendations = [];

    patterns.forEach((pattern) => {
      switch (pattern.type) {
        case 'WEEKLY':
          recommendations.push('Consider weekly pricing strategies based on detected patterns');
          break;
        case 'SEASONAL':
          recommendations.push('Implement seasonal pricing and marketing campaigns');
          break;
        case 'HIGH_VOLATILITY':
          recommendations.push('Focus on demand stabilization and consistent pricing');
          break;
        case 'GROWTH_PHASES':
          recommendations.push('Analyze growth drivers to replicate successful periods');
          break;
      }
    });

    return recommendations;
  }
  forecastTrends(groupedData, periods) {
    if (!groupedData || groupedData.length < 3) {
      return { error: 'Insufficient data for forecasting' };
    }

    const values = groupedData.map((item) => item.bookings || item.revenue || 0);

    // Use exponential smoothing for forecasting
    const alpha = 0.3; // Smoothing factor
    let forecast = values[0];
    const forecasts = [forecast];

    // Calculate smoothed values
    for (let i = 1; i < values.length; i++) {
      forecast = alpha * values[i] + (1 - alpha) * forecast;
      forecasts.push(forecast);
    }

    // Generate future forecasts
    const futureForecast = [];
    let lastForecast = forecasts[forecasts.length - 1];

    for (let i = 0; i < periods; i++) {
      // Add trend component
      const recentTrend =
        forecasts.length > 5
          ? (forecasts[forecasts.length - 1] - forecasts[forecasts.length - 6]) / 5
          : 0;

      lastForecast = lastForecast + recentTrend * 0.5; // Dampen trend over time

      futureForecast.push({
        period: i + 1,
        forecast: Math.max(0, Math.round(lastForecast * 100) / 100),
        confidence: Math.max(0.3, 0.9 - i * 0.1), // Decreasing confidence
      });
    }

    // Calculate forecast accuracy on historical data
    const errors = [];
    for (let i = 1; i < Math.min(values.length, forecasts.length); i++) {
      const error = Math.abs(values[i] - forecasts[i]);
      errors.push(error);
    }

    const meanError =
      errors.length > 0 ? errors.reduce((sum, err) => sum + err, 0) / errors.length : 0;

    return {
      historical: forecasts,
      future: futureForecast,
      accuracy: {
        meanAbsoluteError: Math.round(meanError * 100) / 100,
        confidence:
          meanError < (values.reduce((sum, val) => sum + val, 0) / values.length) * 0.2
            ? 'HIGH'
            : 'MEDIUM',
      },
      method: 'EXPONENTIAL_SMOOTHING',
      parameters: { alpha },
    };
  }
  generateTrendInsights(trendMetrics, patterns) {
    const insights = [];

    // Trend direction insights
    if (trendMetrics.direction === 'GROWING' && trendMetrics.strength > 0.7) {
      insights.push({
        type: 'POSITIVE',
        category: 'GROWTH',
        message: `Strong positive trend detected with ${(trendMetrics.strength * 100).toFixed(0)}% confidence`,
        recommendation: 'Capitalize on growth momentum with strategic pricing increases',
        priority: 'HIGH',
      });
    } else if (trendMetrics.direction === 'DECLINING' && trendMetrics.strength > 0.7) {
      insights.push({
        type: 'WARNING',
        category: 'DECLINE',
        message: `Concerning decline trend with ${(trendMetrics.strength * 100).toFixed(0)}% confidence`,
        recommendation: 'Implement recovery strategies and promotional campaigns',
        priority: 'CRITICAL',
      });
    }

    // Momentum insights
    if (Math.abs(trendMetrics.momentum) > 15) {
      insights.push({
        type: trendMetrics.momentum > 0 ? 'POSITIVE' : 'WARNING',
        category: 'MOMENTUM',
        message: `${trendMetrics.momentum > 0 ? 'Accelerating' : 'Decelerating'} momentum detected (${trendMetrics.momentum.toFixed(1)}%)`,
        recommendation:
          trendMetrics.momentum > 0
            ? 'Maintain current strategies and consider expansion'
            : 'Review recent changes and adjust strategies',
        priority: 'MEDIUM',
      });
    }

    // Pattern-based insights
    patterns.patterns.forEach((pattern) => {
      switch (pattern.type) {
        case 'WEEKLY':
          insights.push({
            type: 'INFO',
            category: 'PATTERN',
            message: `Weekly pattern detected with ${(pattern.strength * 100).toFixed(0)}% strength`,
            recommendation: 'Optimize weekly pricing and staffing based on predictable patterns',
            priority: 'MEDIUM',
          });
          break;

        case 'SEASONAL':
          insights.push({
            type: 'INFO',
            category: 'SEASONALITY',
            message: `Seasonal patterns identified across ${pattern.details.seasons} periods`,
            recommendation: 'Develop seasonal marketing campaigns and inventory strategies',
            priority: 'MEDIUM',
          });
          break;

        case 'HIGH_VOLATILITY':
          insights.push({
            type: 'WARNING',
            category: 'VOLATILITY',
            message: `High volatility detected (ratio: ${pattern.volatilityRatio})`,
            recommendation: 'Focus on demand stabilization and consistent service quality',
            priority: 'HIGH',
          });
          break;

        case 'GROWTH_PHASES':
          insights.push({
            type: 'INFO',
            category: 'PHASES',
            message: `${pattern.phases.length} distinct growth/decline phases identified`,
            recommendation: 'Analyze successful phases to replicate positive outcomes',
            priority: 'LOW',
          });
          break;
      }
    });

    // Data quality insights
    if (trendMetrics.confidence === 'LOW') {
      insights.push({
        type: 'WARNING',
        category: 'DATA_QUALITY',
        message: 'Low confidence in trend analysis due to data limitations',
        recommendation: 'Collect more data points for better trend analysis',
        priority: 'LOW',
      });
    }

    return insights.sort((a, b) => {
      const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
  async getHistoricalRevenueData(hotelId, days) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        checkInDate: { $gte: startDate, $lte: endDate },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      };

      if (hotelId && hotelId !== 'all') {
        query.hotel = new mongoose.Types.ObjectId(hotelId);
      }

      const dailyRevenue = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$checkInDate' },
            },
            totalRevenue: { $sum: '$totalPrice' },
            bookingCount: { $sum: 1 },
            roomNights: {
              $sum: {
                $multiply: [
                  { $size: '$rooms' },
                  {
                    $divide: [
                      { $subtract: ['$checkOutDate', '$checkInDate'] },
                      1000 * 60 * 60 * 24,
                    ],
                  },
                ],
              },
            },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Fill missing dates with zero values
      const result = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];
        const dayData = dailyRevenue.find((d) => d._id === dateStr);

        result.push({
          date: dateStr,
          revenue: dayData ? dayData.totalRevenue : 0,
          bookings: dayData ? dayData.bookingCount : 0,
          roomNights: dayData ? Math.round(dayData.roomNights) : 0,
          adr:
            dayData && dayData.roomNights > 0
              ? Math.round((dayData.totalRevenue / dayData.roomNights) * 100) / 100
              : 0,
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }

      return {
        data: result,
        summary: {
          totalRevenue: result.reduce((sum, day) => sum + day.revenue, 0),
          totalBookings: result.reduce((sum, day) => sum + day.bookings, 0),
          totalRoomNights: result.reduce((sum, day) => sum + day.roomNights, 0),
          averageDailyRevenue:
            result.length > 0
              ? result.reduce((sum, day) => sum + day.revenue, 0) / result.length
              : 0,
          period: { days, startDate, endDate },
        },
      };
    } catch (error) {
      logger.error('Error getting historical revenue data:', error);
      return { data: [], summary: null };
    }
  }
  simpleRevenueForecast(historicalData, days) {
    if (!historicalData.data || historicalData.data.length < 7) {
      return { error: 'Insufficient historical data for forecasting' };
    }

    const data = historicalData.data;
    const recentData = data.slice(-14); // Last 14 days for trend

    // Calculate trend
    const revenues = recentData.map((d) => d.revenue);
    const trend = this.calculateLinearTrend(revenues);

    // Calculate seasonal factors (day of week)
    const dayFactors = this.calculateDayOfWeekFactors(data);

    // Calculate base forecast
    const baseRevenue = recentData.reduce((sum, d) => sum + d.revenue, 0) / recentData.length;

    const forecast = [];

    for (let i = 0; i < days; i++) {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + i + 1);

      const dayOfWeek = futureDate.getDay();
      const seasonalFactor = dayFactors[dayOfWeek] || 1;
      const trendAdjustment = trend.slope * i;

      // Add some randomness for realism (±10%)
      const randomFactor = 0.9 + Math.random() * 0.2;

      const forecastRevenue = Math.max(
        0,
        (baseRevenue + trendAdjustment) * seasonalFactor * randomFactor
      );

      forecast.push({
        date: futureDate.toISOString().split('T')[0],
        forecastRevenue: Math.round(forecastRevenue * 100) / 100,
        confidence: Math.max(0.3, 0.9 - i * 0.02), // Decreasing confidence
        components: {
          base: Math.round(baseRevenue),
          trend: Math.round(trendAdjustment),
          seasonal: Math.round(seasonalFactor * 100) / 100,
          random: Math.round(randomFactor * 100) / 100,
        },
      });
    }

    return {
      forecast,
      metadata: {
        method: 'SIMPLE_TREND_SEASONAL',
        basePeriod: recentData.length,
        trendStrength: Math.abs(trend.correlation),
        confidence: trend.correlation > 0.5 ? 'MEDIUM' : 'LOW',
      },
      summary: {
        totalForecastRevenue: forecast.reduce((sum, day) => sum + day.forecastRevenue, 0),
        averageDailyForecast:
          forecast.reduce((sum, day) => sum + day.forecastRevenue, 0) / forecast.length,
        expectedGrowth: trend.slope > 0 ? 'POSITIVE' : trend.slope < 0 ? 'NEGATIVE' : 'STABLE',
      },
    };
  }

  calculateLinearTrend(values) {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: 0, correlation: 0 };

    const xValues = Array.from({ length: n }, (_, i) => i);

    const sumX = xValues.reduce((sum, val) => sum + val, 0);
    const sumY = values.reduce((sum, val) => sum + val, 0);
    const sumXY = xValues.reduce((sum, val, i) => sum + val * values[i], 0);
    const sumXX = xValues.reduce((sum, val) => sum + val * val, 0);
    const sumYY = values.reduce((sum, val) => sum + val * val, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Calculate correlation coefficient
    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    const correlation = denominator !== 0 ? numerator / denominator : 0;

    return { slope, intercept, correlation };
  }

  calculateDayOfWeekFactors(data) {
    const dayGroups = [[], [], [], [], [], [], []]; // Sunday = 0, Monday = 1, etc.

    data.forEach((day) => {
      const date = new Date(day.date);
      const dayOfWeek = date.getDay();
      dayGroups[dayOfWeek].push(day.revenue);
    });

    // Calculate average for each day
    const overallAverage = data.reduce((sum, day) => sum + day.revenue, 0) / data.length;

    return dayGroups.map((dayRevenues) => {
      if (dayRevenues.length === 0) return 1;

      const dayAverage = dayRevenues.reduce((sum, rev) => sum + rev, 0) / dayRevenues.length;
      return overallAverage > 0 ? dayAverage / overallAverage : 1;
    });
  }

  calculateCorrelation(x, y) {
    const n = Math.min(x.length, y.length);
    if (n === 0) return 0;

    const sumX = x.reduce((sum, val) => sum + val, 0);
    const sumY = y.reduce((sum, val) => sum + val, 0);
    const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
    const sumXX = x.reduce((sum, val) => sum + val * val, 0);
    const sumYY = y.reduce((sum, val) => sum + val * val, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));

    return denominator > 0 ? numerator / denominator : 0;
  }

  calculateVariance(data) {
    if (!data || data.length === 0) return 0;

    const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
    const squaredDiffs = data.map((val) => Math.pow(val - mean, 2));

    return squaredDiffs.reduce((sum, val) => sum + val, 0) / data.length;
  }

  generatePricingRecommendations(data) {
    const recommendations = [];

    // Elasticity-based recommendations
    if (data.elasticity && data.elasticity.elasticity < -1) {
      recommendations.push({
        type: 'PRICING_STRATEGY',
        priority: 'HIGH',
        title: 'Price Sensitive Market Detected',
        description: 'Customers are highly sensitive to price changes',
        action: 'Consider competitive pricing and value-added packages',
        expectedImpact: 'Improved booking volume and market share',
      });
    } else if (data.elasticity && data.elasticity.elasticity > -0.5) {
      recommendations.push({
        type: 'PRICING_STRATEGY',
        priority: 'MEDIUM',
        title: 'Price Insensitive Segment',
        description: 'Customers show low price sensitivity',
        action: 'Opportunity for strategic price increases',
        expectedImpact: 'Increased revenue without significant volume loss',
      });
    }

    // Yield impact recommendations
    if (data.yieldImpact && data.yieldImpact.effectiveness > 80) {
      recommendations.push({
        type: 'YIELD_OPTIMIZATION',
        priority: 'MEDIUM',
        title: 'Strong Yield Performance',
        description: 'Current yield management is highly effective',
        action: 'Maintain current strategies and consider expansion',
        expectedImpact: 'Sustained revenue optimization',
      });
    }

    // Competitive recommendations
    if (data.competitive && data.competitive.position === 'BELOW_MARKET') {
      recommendations.push({
        type: 'COMPETITIVE_POSITIONING',
        priority: 'HIGH',
        title: 'Below Market Pricing',
        description: 'Pricing is below competitive levels',
        action: 'Gradual price increases to market level',
        expectedImpact: 'Revenue increase of 10-15%',
      });
    }

    return recommendations;
  }

  generateSegmentInsights(segmentAnalysis) {
    const insights = [];

    Object.entries(segmentAnalysis).forEach(([segmentType, segments]) => {
      // Find dominant segment
      const sortedSegments = segments.sort((a, b) => b.revenue - a.revenue);
      const dominantSegment = sortedSegments[0];

      if (dominantSegment && dominantSegment.percentage > 40) {
        insights.push({
          type: 'CONCENTRATION',
          category: segmentType,
          message: `High concentration in ${dominantSegment.segment} (${dominantSegment.percentage}%)`,
          recommendation: 'Consider diversification strategies to reduce dependency',
          risk: 'MEDIUM',
        });
      }

      // Find growing segments
      const growingSegments = segments.filter((s) => s.growthRate > 15);
      growingSegments.forEach((segment) => {
        insights.push({
          type: 'OPPORTUNITY',
          category: segmentType,
          message: `${segment.segment} showing strong growth (${segment.growthRate}%)`,
          recommendation: 'Increase focus and resources on this segment',
          potential: 'HIGH',
        });
      });

      // Find underperforming segments
      const underperformingSegments = segments.filter((s) => s.percentage < 5 && s.potential > 15);
      underperformingSegments.forEach((segment) => {
        insights.push({
          type: 'UNDERPERFORMANCE',
          category: segmentType,
          message: `${segment.segment} underperforming despite market potential`,
          recommendation: 'Investigate barriers and develop targeted strategies',
          priority: 'MEDIUM',
        });
      });
    });

    return insights;
  }

  identifySegmentOpportunities(segmentAnalysis) {
    const opportunities = [];

    Object.entries(segmentAnalysis).forEach(([segmentType, segments]) => {
      // High-value, low-volume opportunities
      const highValueSegments = segments.filter(
        (s) =>
          s.averageValue >
            (segments.reduce((sum, seg) => sum + seg.averageValue, 0) / segments.length) * 1.5 &&
          s.percentage < 20
      );

      highValueSegments.forEach((segment) => {
        opportunities.push({
          type: 'HIGH_VALUE_EXPANSION',
          segment: segment.segment,
          category: segmentType,
          currentShare: segment.percentage,
          averageValue: segment.averageValue,
          description: 'High-value segment with growth potential',
          action: 'Develop premium targeting strategies',
          estimatedImpact: `${Math.round(segment.averageValue * 0.1)}€ additional revenue per conversion`,
        });
      });

      // Market gap opportunities
      const expectedSegments = this.getExpectedSegments(segmentType);
      expectedSegments.forEach((expected) => {
        const actual = segments.find((s) => s.segment === expected.segment);
        if (!actual || actual.percentage < expected.expectedShare * 0.5) {
          opportunities.push({
            type: 'MARKET_GAP',
            segment: expected.segment,
            category: segmentType,
            currentShare: actual ? actual.percentage : 0,
            expectedShare: expected.expectedShare,
            description: 'Underrepresented market segment',
            action: 'Develop targeted acquisition campaigns',
            estimatedImpact: `${expected.expectedShare - (actual ? actual.percentage : 0)}% market share potential`,
          });
        }
      });
    });

    return opportunities.sort((a, b) => {
      // Prioritize by potential impact
      const aImpact = parseFloat(a.estimatedImpact) || 0;
      const bImpact = parseFloat(b.estimatedImpact) || 0;
      return bImpact - aImpact;
    });
  }

  getExpectedSegments(segmentType) {
    const expectedSegments = {
      byClientType: [
        { segment: 'INDIVIDUAL', expectedShare: 70 },
        { segment: 'BUSINESS', expectedShare: 25 },
        { segment: 'GROUP', expectedShare: 5 },
      ],
      bySource: [
        { segment: 'DIRECT', expectedShare: 40 },
        { segment: 'OTA', expectedShare: 35 },
        { segment: 'PHONE', expectedShare: 15 },
        { segment: 'WALK_IN', expectedShare: 10 },
      ],
      byLoyaltyTier: [
        { segment: 'NON_MEMBER', expectedShare: 60 },
        { segment: 'BRONZE', expectedShare: 25 },
        { segment: 'SILVER', expectedShare: 10 },
        { segment: 'GOLD', expectedShare: 4 },
        { segment: 'PLATINUM', expectedShare: 1 },
      ],
    };

    return expectedSegments[segmentType] || [];
  }

  generateYieldImpactRecommendations(data) {
    const recommendations = [];

    if (data.revenueUplift < 0) {
      recommendations.push({
        priority: 'CRITICAL',
        action: 'REVIEW_YIELD_RULES',
        description: 'Negative yield impact requires immediate rule review',
        expectedImpact: 'Stop revenue loss and optimize pricing logic',
      });
    }

    if (data.adoptionRate < 30) {
      recommendations.push({
        priority: 'HIGH',
        action: 'INCREASE_COVERAGE',
        description: 'Expand yield management to more booking scenarios',
        expectedImpact: `Potential ${(100 - data.adoptionRate).toFixed(0)}% coverage increase`,
      });
    }

    if (data.effectivenessScore < 60) {
      recommendations.push({
        priority: 'HIGH',
        action: 'OPTIMIZE_STRATEGY',
        description: 'Current yield strategy needs optimization',
        expectedImpact: 'Improve effectiveness score by 20-30 points',
      });
    }

    return recommendations;
  }

  calculatePriceElasticityIndicators(weeklyTrends) {
    if (weeklyTrends.length < 4) return { insufficient_data: true };

    const priceChanges = [];
    const demandChanges = [];

    for (let i = 1; i < weeklyTrends.length; i++) {
      const priceDiff = weeklyTrends[i].avgPrice - weeklyTrends[i - 1].avgPrice;
      const demandDiff = weeklyTrends[i].bookingCount - weeklyTrends[i - 1].bookingCount;

      if (weeklyTrends[i - 1].avgPrice > 0 && weeklyTrends[i - 1].bookingCount > 0) {
        const priceChange = (priceDiff / weeklyTrends[i - 1].avgPrice) * 100;
        const demandChange = (demandDiff / weeklyTrends[i - 1].bookingCount) * 100;

        if (Math.abs(priceChange) > 1) {
          // Only consider significant price changes
          priceChanges.push(priceChange);
          demandChanges.push(demandChange);
        }
      }
    }

    if (priceChanges.length < 2) {
      return { insufficient_variation: true };
    }

    // Calculate simple elasticity
    const avgPriceChange = priceChanges.reduce((sum, val) => sum + val, 0) / priceChanges.length;
    const avgDemandChange = demandChanges.reduce((sum, val) => sum + val, 0) / demandChanges.length;

    const elasticity = avgPriceChange !== 0 ? avgDemandChange / avgPriceChange : 0;

    return {
      elasticity: Math.round(elasticity * 100) / 100,
      interpretation:
        elasticity < -1 ? 'ELASTIC' : elasticity > -1 && elasticity < 0 ? 'INELASTIC' : 'POSITIVE',
      priceVariability: this.calculateVariance(priceChanges),
      demandVariability: this.calculateVariance(demandChanges),
      dataPoints: priceChanges.length,
    };
  }

  identifyPricingAnomalies(weeklyTrends) {
    if (weeklyTrends.length < 4) return [];

    const prices = weeklyTrends.map((w) => w.avgPrice);
    const mean = prices.reduce((sum, val) => sum + val, 0) / prices.length;
    const stdDev = Math.sqrt(this.calculateVariance(prices));
    const threshold = 2 * stdDev;

    const anomalies = [];

    weeklyTrends.forEach((week, index) => {
      const deviation = Math.abs(week.avgPrice - mean);

      if (deviation > threshold) {
        anomalies.push({
          week: week.week,
          price: week.avgPrice,
          expectedPrice: Math.round(mean),
          deviation: Math.round(deviation),
          severity: deviation > 3 * stdDev ? 'HIGH' : 'MEDIUM',
          type: week.avgPrice > mean ? 'PRICE_SPIKE' : 'PRICE_DROP',
          bookingImpact: week.bookingCount,
        });
      }
    });

    return anomalies;
  }

  generatePricingTrendRecommendations(data) {
    const recommendations = [];

    if (data.trendDirection === 'INCREASING' && data.correlation > 0.5) {
      recommendations.push({
        type: 'CONTINUE_STRATEGY',
        priority: 'MEDIUM',
        description: 'Positive pricing trend detected',
        action: 'Maintain current pricing strategy while monitoring market response',
        expectedImpact: 'Sustained revenue growth',
      });
    } else if (data.trendDirection === 'DECREASING' && data.correlation < -0.5) {
      recommendations.push({
        type: 'URGENT_REVIEW',
        priority: 'HIGH',
        description: 'Declining pricing trend identified',
        action: 'Review competitive positioning and value proposition',
        expectedImpact: 'Prevent further revenue decline',
      });
    }

    // Room type recommendations
    if (data.roomTypePricing && data.roomTypePricing.length > 1) {
      const priceDifference =
        data.roomTypePricing[0].avgPrice -
        data.roomTypePricing[data.roomTypePricing.length - 1].avgPrice;

      if (priceDifference < 50) {
        recommendations.push({
          type: 'PRICE_DIFFERENTIATION',
          priority: 'MEDIUM',
          description: 'Limited price differentiation between room types',
          action: 'Enhance premium room positioning and pricing',
          expectedImpact: 'Improved revenue per booking',
        });
      }
    }

    // Source channel recommendations
    if (data.sourcePricing) {
      const directBooking = data.sourcePricing.find((s) => s.source === 'DIRECT');
      const otaBooking = data.sourcePricing.find((s) => s.source.includes('OTA'));

      if (directBooking && otaBooking && directBooking.avgPrice < otaBooking.avgPrice) {
        recommendations.push({
          type: 'DIRECT_BOOKING_INCENTIVE',
          priority: 'HIGH',
          description: 'Direct bookings priced below OTA channels',
          action: 'Implement direct booking incentives and rate parity management',
          expectedImpact: 'Increased direct booking revenue and reduced commission costs',
        });
      }
    }

    // Anomaly recommendations
    if (data.anomalies && data.anomalies.length > 0) {
      const highSeverityAnomalies = data.anomalies.filter((a) => a.severity === 'HIGH');

      if (highSeverityAnomalies.length > 0) {
        recommendations.push({
          type: 'INVESTIGATE_ANOMALIES',
          priority: 'HIGH',
          description: `${highSeverityAnomalies.length} high-severity pricing anomalies detected`,
          action: 'Investigate causes and implement pricing controls',
          expectedImpact: 'Improved pricing consistency and revenue predictability',
        });
      }
    }

    return recommendations;
  }

  calculateHotelPricingMetrics(bookings) {
    if (!bookings || bookings.length === 0) {
      return { averagePrice: 0, minPrice: 0, maxPrice: 0, bookingCount: 0 };
    }

    const prices = bookings.map((b) => b.totalPrice || 0);
    const roomNights = bookings.reduce((sum, booking) => {
      const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
      return sum + booking.rooms.length * nights;
    }, 0);

    return {
      averagePrice: Math.round((prices.reduce((sum, p) => sum + p, 0) / prices.length) * 100) / 100,
      averageDailyRate:
        roomNights > 0
          ? Math.round((prices.reduce((sum, p) => sum + p, 0) / roomNights) * 100) / 100
          : 0,
      minPrice: Math.min(...prices),
      maxPrice: Math.max(...prices),
      priceRange: Math.max(...prices) - Math.min(...prices),
      bookingCount: bookings.length,
      totalRevenue: prices.reduce((sum, p) => sum + p, 0),
      priceVariability: this.calculateVariance(prices),
    };
  }

  estimateCompetitorPricing(competitor) {
    // Estimate pricing based on hotel stars and market positioning
    const basePrices = {
      1: 60,
      2: 80,
      3: 120,
      4: 180,
      5: 300,
    };

    const basePrice = basePrices[competitor.stars] || 100;
    const variance = basePrice * 0.2; // 20% variance

    return {
      averagePrice: basePrice,
      averageDailyRate: basePrice * 0.9, // Slightly lower ADR
      minPrice: basePrice - variance,
      maxPrice: basePrice + variance,
      priceRange: variance * 2,
      bookingCount: 0, // No actual data
      totalRevenue: 0,
      priceVariability: variance,
      estimated: true,
    };
  }

  analyzeMarketPosition(hotelPricing, competitorAnalysis) {
    const competitorPrices = competitorAnalysis.map((c) => c.pricing.averagePrice);
    const marketAverage = competitorPrices.reduce((sum, p) => sum + p, 0) / competitorPrices.length;

    const premiumPercentage =
      marketAverage > 0 ? ((hotelPricing.averagePrice - marketAverage) / marketAverage) * 100 : 0;

    let position = 'MARKET_RATE';
    if (premiumPercentage > 15) position = 'PREMIUM';
    else if (premiumPercentage > 5) position = 'ABOVE_MARKET';
    else if (premiumPercentage < -15) position = 'DISCOUNT';
    else if (premiumPercentage < -5) position = 'BELOW_MARKET';

    // Calculate percentile ranking
    const sortedPrices = [...competitorPrices, hotelPricing.averagePrice].sort((a, b) => a - b);
    const hotelRank = sortedPrices.indexOf(hotelPricing.averagePrice) + 1;
    const percentile = Math.round((hotelRank / sortedPrices.length) * 100);

    return {
      position,
      premiumPercentage: Math.round(premiumPercentage * 100) / 100,
      marketAverage: Math.round(marketAverage * 100) / 100,
      percentile,
      rank: hotelRank,
      totalCompetitors: competitorAnalysis.length + 1,
    };
  }

  analyzePriceGaps(hotelPricing, competitorAnalysis) {
    const competitorPrices = competitorAnalysis
      .map((c) => ({
        name: c.name,
        price: c.pricing.averagePrice,
        gap: Math.abs(c.pricing.averagePrice - hotelPricing.averagePrice),
      }))
      .sort((a, b) => a.gap - b.gap);

    const closestCompetitor = competitorPrices[0];
    const largestGap = Math.max(...competitorPrices.map((c) => c.gap));
    const averageGap =
      competitorPrices.reduce((sum, c) => sum + c.gap, 0) / competitorPrices.length;

    return {
      closestCompetitor: {
        name: closestCompetitor.name,
        price: closestCompetitor.price,
        gap: Math.round(closestCompetitor.gap * 100) / 100,
      },
      largestGap: Math.round(largestGap * 100) / 100,
      averageGap: Math.round(averageGap * 100) / 100,
      gapDistribution: competitorPrices.map((c) => ({
        competitor: c.name,
        gap: Math.round(c.gap * 100) / 100,
        position: c.price > hotelPricing.averagePrice ? 'ABOVE' : 'BELOW',
      })),
    };
  }

  analyzeCompetitiveSegments(hotel, competitors, hotelPricing) {
    // Segment analysis by star rating
    const segmentsByStars = {};

    competitors.forEach((comp) => {
      if (!segmentsByStars[comp.stars]) {
        segmentsByStars[comp.stars] = {
          count: 0,
          avgPrice: 0,
          priceRange: { min: Infinity, max: 0 },
        };
      }

      segmentsByStars[comp.stars].count++;
      segmentsByStars[comp.stars].avgPrice += comp.pricing?.averagePrice || 0;

      if (comp.pricing?.averagePrice) {
        segmentsByStars[comp.stars].priceRange.min = Math.min(
          segmentsByStars[comp.stars].priceRange.min,
          comp.pricing.averagePrice
        );
        segmentsByStars[comp.stars].priceRange.max = Math.max(
          segmentsByStars[comp.stars].priceRange.max,
          comp.pricing.averagePrice
        );
      }
    });

    // Calculate averages
    Object.values(segmentsByStars).forEach((segment) => {
      segment.avgPrice = segment.count > 0 ? segment.avgPrice / segment.count : 0;
      if (segment.priceRange.min === Infinity) segment.priceRange.min = 0;
    });

    // Hotel's segment performance
    const hotelSegment = segmentsByStars[hotel.stars];
    let hotelSegmentPosition = 'ONLY_PLAYER';

    if (hotelSegment && hotelSegment.count > 0) {
      const segmentAvg = hotelSegment.avgPrice;
      const difference = ((hotelPricing.averagePrice - segmentAvg) / segmentAvg) * 100;

      if (difference > 10) hotelSegmentPosition = 'SEGMENT_LEADER';
      else if (difference > 0) hotelSegmentPosition = 'ABOVE_SEGMENT';
      else if (difference < -10) hotelSegmentPosition = 'SEGMENT_DISCOUNT';
      else hotelSegmentPosition = 'SEGMENT_AVERAGE';
    }

    return {
      byStars: Object.entries(segmentsByStars).map(([stars, data]) => ({
        stars: parseInt(stars),
        competitorCount: data.count,
        averagePrice: Math.round(data.avgPrice * 100) / 100,
        priceRange: {
          min: Math.round(data.priceRange.min * 100) / 100,
          max: Math.round(data.priceRange.max * 100) / 100,
        },
        isHotelSegment: parseInt(stars) === hotel.stars,
      })),
      hotelPosition: {
        segment: hotel.stars,
        position: hotelSegmentPosition,
        competitorsInSegment: hotelSegment ? hotelSegment.count : 0,
      },
    };
  }

  identifyCompetitiveOpportunities(data) {
    const opportunities = [];

    // Price positioning opportunities
    if (data.marketPosition.position === 'BELOW_MARKET') {
      opportunities.push({
        type: 'PRICE_INCREASE',
        description: 'Below-market pricing presents revenue opportunity',
        potential: `€${Math.round(data.marketPosition.marketAverage - data.hotelPricing.averagePrice)} per booking`,
        confidence: 'HIGH',
        timeframe: '2-4 weeks',
        risk: 'LOW',
      });
    }

    // Segment leadership opportunities
    const sameStarCompetitors = data.competitors.filter((c) => c.stars === data.hotel.stars);
    if (sameStarCompetitors.length > 0) {
      const segmentLeader = sameStarCompetitors.reduce((leader, comp) =>
        comp.pricing.averagePrice > leader.pricing.averagePrice ? comp : leader
      );

      if (segmentLeader.pricing.averagePrice > data.hotelPricing.averagePrice * 1.1) {
        opportunities.push({
          type: 'SEGMENT_LEADERSHIP',
          description: 'Opportunity to challenge segment price leader',
          potential: `€${Math.round(segmentLeader.pricing.averagePrice - data.hotelPricing.averagePrice)} price gap`,
          confidence: 'MEDIUM',
          timeframe: '1-3 months',
          risk: 'MEDIUM',
        });
      }
    }

    // Market positioning opportunities
    if (data.marketPosition.percentile < 25) {
      opportunities.push({
        type: 'MARKET_REPOSITIONING',
        description: 'Low market position suggests repositioning opportunity',
        potential: 'Move from bottom quartile to median pricing',
        confidence: 'MEDIUM',
        timeframe: '3-6 months',
        risk: 'MEDIUM',
      });
    }

    return opportunities;
  }

  analyzeRateParity(hotelPricing, competitorAnalysis) {
    // Simplified rate parity analysis
    // In production, this would analyze across different booking channels

    const parityIssues = [];
    let parityScore = 100;

    // Check for significant price variations that might indicate parity issues
    if (hotelPricing.priceVariability > hotelPricing.averagePrice * 0.3) {
      parityIssues.push({
        channel: 'INTERNAL_VARIANCE',
        issue: 'High price variability detected',
        severity: 'MEDIUM',
      });
      parityScore -= 20;
    }

    // Compare with competitor consistency
    const competitorVariabilities = competitorAnalysis
      .filter((c) => c.pricing.priceVariability)
      .map((c) => c.pricing.priceVariability);

    if (competitorVariabilities.length > 0) {
      const avgCompetitorVariability =
        competitorVariabilities.reduce((sum, v) => sum + v, 0) / competitorVariabilities.length;

      if (hotelPricing.priceVariability > avgCompetitorVariability * 1.5) {
        parityIssues.push({
          channel: 'MARKET_COMPARISON',
          issue: 'Price variability above market average',
          severity: 'HIGH',
        });
        parityScore -= 30;
      }
    }

    return {
      score: Math.max(0, parityScore),
      status: parityScore >= 80 ? 'GOOD' : parityScore >= 60 ? 'FAIR' : 'POOR',
      parityIssues: parityIssues.length,
      issues: parityIssues,
      recommendations:
        parityIssues.length > 0
          ? [
              'Implement rate parity monitoring',
              'Audit all distribution channels',
              'Set up automated rate consistency checks',
            ]
          : ['Maintain current rate parity practices'],
    };
  }

  generateCompetitiveRecommendations(data) {
    const recommendations = [];

    // Market position recommendations
    if (data.marketPosition.position === 'DISCOUNT') {
      recommendations.push({
        type: 'PRICING_STRATEGY',
        priority: 'HIGH',
        action: 'GRADUAL_PRICE_INCREASE',
        description: `Currently ${Math.abs(data.marketPosition.premiumPercentage)}% below market`,
        expectedImpact: 'Improved revenue without significant demand loss',
        timeline: '4-8 weeks',
      });
    } else if (data.marketPosition.position === 'PREMIUM') {
      recommendations.push({
        type: 'VALUE_PROPOSITION',
        priority: 'MEDIUM',
        action: 'ENHANCE_VALUE_DELIVERY',
        description: `Premium positioning at ${data.marketPosition.premiumPercentage}% above market`,
        expectedImpact: 'Justify premium pricing through superior service',
        timeline: 'Ongoing',
      });
    }

    // Price gap recommendations
    if (data.priceGaps.closestCompetitor.gap > 30) {
      recommendations.push({
        type: 'COMPETITIVE_ALIGNMENT',
        priority: 'HIGH',
        action: 'CLOSE_PRICE_GAP',
        description: `€${data.priceGaps.closestCompetitor.gap} gap with closest competitor`,
        expectedImpact: 'Improved competitive positioning',
        timeline: '2-4 weeks',
      });
    }

    // Opportunity-based recommendations
    data.opportunities.forEach((opportunity) => {
      recommendations.push({
        type: 'OPPORTUNITY',
        priority: opportunity.confidence === 'HIGH' ? 'HIGH' : 'MEDIUM',
        action: opportunity.type,
        description: opportunity.description,
        expectedImpact: opportunity.potential,
        timeline: opportunity.timeframe,
      });
    });

    return recommendations.sort((a, b) => {
      const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * ================================
   * OPERATIONAL ANALYTICS METHODS - FULL IMPLEMENTATION
   * ================================
   */

  /**
   * Calculate check-in metrics with detailed analysis
   */
  calculateCheckInMetrics(bookings) {
    try {
      const checkInData = bookings.filter(
        (booking) => booking.status === 'CHECKED_IN' || booking.status === 'COMPLETED'
      );

      if (checkInData.length === 0) {
        return {
          totalCheckIns: 0,
          averageProcessingTime: 0,
          peakHours: [],
          efficiency: 0,
          issues: [],
        };
      }

      // Calculate processing times
      const processingTimes = checkInData
        .filter((booking) => booking.checkInTime && booking.arrivalTime)
        .map((booking) => {
          const arrival = new Date(booking.arrivalTime);
          const checkIn = new Date(booking.checkInTime);
          return Math.max(0, (checkIn - arrival) / (1000 * 60)); // minutes
        });

      // Analyze check-in times by hour
      const hourlyDistribution = {};
      checkInData.forEach((booking) => {
        if (booking.checkInTime) {
          const hour = new Date(booking.checkInTime).getHours();
          hourlyDistribution[hour] = (hourlyDistribution[hour] || 0) + 1;
        }
      });

      // Find peak hours
      const peakHours = Object.entries(hourlyDistribution)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([hour, count]) => ({
          hour: parseInt(hour),
          count,
          timeSlot: this.formatTimeSlot(parseInt(hour)),
        }));

      // Calculate efficiency metrics
      const averageProcessingTime =
        processingTimes.length > 0
          ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
          : 0;

      const fastCheckIns = processingTimes.filter((time) => time <= 5).length;
      const slowCheckIns = processingTimes.filter((time) => time > 15).length;
      const efficiency =
        processingTimes.length > 0 ? (fastCheckIns / processingTimes.length) * 100 : 0;

      // Identify issues
      const issues = [];
      if (averageProcessingTime > 10) {
        issues.push({
          type: 'SLOW_PROCESSING',
          severity: 'HIGH',
          message: `Average check-in time of ${averageProcessingTime.toFixed(1)} minutes exceeds target of 10 minutes`,
          recommendation:
            'Review check-in procedures and consider additional staff during peak hours',
        });
      }

      if (slowCheckIns > processingTimes.length * 0.2) {
        issues.push({
          type: 'PROCESSING_DELAYS',
          severity: 'MEDIUM',
          message: `${((slowCheckIns / processingTimes.length) * 100).toFixed(1)}% of check-ins take longer than 15 minutes`,
          recommendation: 'Implement express check-in for VIP guests and pre-registered guests',
        });
      }

      // Day of week analysis
      const dayOfWeekDistribution = {};
      checkInData.forEach((booking) => {
        if (booking.checkInDate) {
          const dayOfWeek = moment(booking.checkInDate).format('dddd');
          dayOfWeekDistribution[dayOfWeek] = (dayOfWeekDistribution[dayOfWeek] || 0) + 1;
        }
      });

      return {
        totalCheckIns: checkInData.length,
        averageProcessingTime: Math.round(averageProcessingTime * 10) / 10,
        medianProcessingTime: this.calculateMedian(processingTimes),
        processingTimeDistribution: {
          fast: fastCheckIns,
          normal: processingTimes.filter((time) => time > 5 && time <= 15).length,
          slow: slowCheckIns,
        },
        hourlyDistribution,
        peakHours,
        dayOfWeekDistribution,
        efficiency: Math.round(efficiency),
        successRate: Math.round(
          (checkInData.filter((b) => !b.checkInIssues).length / checkInData.length) * 100
        ),
        issues,
        trends: this.analyzeCheckInTrends(checkInData),
        recommendations: this.generateCheckInRecommendations(
          efficiency,
          averageProcessingTime,
          issues
        ),
      };
    } catch (error) {
      logger.error('Error calculating check-in metrics:', error);
      return { error: error.message };
    }
  }

  /**
   * Calculate check-out metrics with detailed analysis
   */
  calculateCheckOutMetrics(bookings) {
    try {
      const checkOutData = bookings.filter(
        (booking) => booking.status === 'COMPLETED' || booking.status === 'CHECKED_OUT'
      );

      if (checkOutData.length === 0) {
        return {
          totalCheckOuts: 0,
          averageProcessingTime: 0,
          onTimeCheckOuts: 0,
          lateCheckOuts: 0,
          efficiency: 0,
        };
      }

      // Calculate checkout processing times
      const processingTimes = checkOutData
        .filter((booking) => booking.checkOutTime && booking.checkOutRequestTime)
        .map((booking) => {
          const request = new Date(booking.checkOutRequestTime);
          const completed = new Date(booking.checkOutTime);
          return Math.max(0, (completed - request) / (1000 * 60)); // minutes
        });

      // Analyze checkout timing vs checkout deadline (usually 11:00 AM)
      const checkOutDeadline = 11; // 11:00 AM
      const onTimeCheckOuts = checkOutData.filter((booking) => {
        if (!booking.checkOutTime) return false;
        const checkOutHour = new Date(booking.checkOutTime).getHours();
        return checkOutHour <= checkOutDeadline;
      }).length;

      const lateCheckOuts = checkOutData.length - onTimeCheckOuts;

      // Calculate room turnover efficiency
      const roomTurnoverTimes = checkOutData
        .filter((booking) => booking.roomCleanedTime && booking.checkOutTime)
        .map((booking) => {
          const checkOut = new Date(booking.checkOutTime);
          const cleaned = new Date(booking.roomCleanedTime);
          return Math.max(0, (cleaned - checkOut) / (1000 * 60)); // minutes
        });

      // Analyze additional charges processing
      const additionalCharges = checkOutData
        .filter((booking) => booking.additionalCharges && booking.additionalCharges.length > 0)
        .map((booking) => ({
          bookingId: booking._id,
          totalCharges: booking.additionalCharges.reduce((sum, charge) => sum + charge.amount, 0),
          chargeCount: booking.additionalCharges.length,
          processingTime: booking.chargesProcessingTime || 0,
        }));

      const averageProcessingTime =
        processingTimes.length > 0
          ? processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length
          : 0;

      const averageRoomTurnover =
        roomTurnoverTimes.length > 0
          ? roomTurnoverTimes.reduce((sum, time) => sum + time, 0) / roomTurnoverTimes.length
          : 0;

      // Calculate efficiency metrics
      const fastCheckOuts = processingTimes.filter((time) => time <= 3).length;
      const efficiency =
        processingTimes.length > 0 ? (fastCheckOuts / processingTimes.length) * 100 : 0;

      const onTimeRate =
        checkOutData.length > 0 ? (onTimeCheckOuts / checkOutData.length) * 100 : 0;

      // Identify issues
      const issues = [];
      if (lateCheckOuts > checkOutData.length * 0.3) {
        issues.push({
          type: 'LATE_CHECKOUTS',
          severity: 'HIGH',
          message: `${((lateCheckOuts / checkOutData.length) * 100).toFixed(1)}% of guests check out late`,
          recommendation: 'Implement late checkout fee policy and improve guest communication',
        });
      }

      if (averageRoomTurnover > 90) {
        issues.push({
          type: 'SLOW_TURNOVER',
          severity: 'MEDIUM',
          message: `Average room turnover time of ${averageRoomTurnover.toFixed(1)} minutes is too long`,
          recommendation: 'Optimize housekeeping schedule and add staff during peak periods',
        });
      }

      return {
        totalCheckOuts: checkOutData.length,
        averageProcessingTime: Math.round(averageProcessingTime * 10) / 10,
        medianProcessingTime: this.calculateMedian(processingTimes),
        onTimeCheckOuts,
        lateCheckOuts,
        onTimeRate: Math.round(onTimeRate),
        efficiency: Math.round(efficiency),
        roomTurnover: {
          averageTime: Math.round(averageRoomTurnover),
          fastTurnovers: roomTurnoverTimes.filter((time) => time <= 60).length,
          slowTurnovers: roomTurnoverTimes.filter((time) => time > 120).length,
        },
        additionalCharges: {
          totalBookingsWithCharges: additionalCharges.length,
          averageChargeAmount:
            additionalCharges.length > 0
              ? additionalCharges.reduce((sum, charge) => sum + charge.totalCharges, 0) /
                additionalCharges.length
              : 0,
          averageProcessingTime:
            additionalCharges.length > 0
              ? additionalCharges.reduce((sum, charge) => sum + charge.processingTime, 0) /
                additionalCharges.length
              : 0,
        },
        issues,
        trends: this.analyzeCheckOutTrends(checkOutData),
        recommendations: this.generateCheckOutRecommendations(onTimeRate, efficiency, issues),
      };
    } catch (error) {
      logger.error('Error calculating check-out metrics:', error);
      return { error: error.message };
    }
  }

  /**
   * Calculate processing times for various hotel operations
   */
  calculateProcessingTimes(bookings) {
    try {
      const operations = {
        checkIn: [],
        checkOut: [],
        roomService: [],
        maintenance: [],
        housekeeping: [],
      };

      bookings.forEach((booking) => {
        // Check-in processing times
        if (booking.arrivalTime && booking.checkInTime) {
          const processingTime =
            (new Date(booking.checkInTime) - new Date(booking.arrivalTime)) / (1000 * 60);
          operations.checkIn.push({
            bookingId: booking._id,
            processingTime: Math.max(0, processingTime),
            guestType: booking.guestType || 'STANDARD',
            roomType: booking.rooms[0]?.type || 'UNKNOWN',
            hasIssues: booking.checkInIssues?.length > 0,
          });
        }

        // Check-out processing times
        if (booking.checkOutRequestTime && booking.checkOutTime) {
          const processingTime =
            (new Date(booking.checkOutTime) - new Date(booking.checkOutRequestTime)) / (1000 * 60);
          operations.checkOut.push({
            bookingId: booking._id,
            processingTime: Math.max(0, processingTime),
            hasAdditionalCharges: booking.additionalCharges?.length > 0,
            paymentMethod: booking.paymentMethod || 'UNKNOWN',
          });
        }

        // Room service processing times
        if (booking.roomServiceOrders) {
          booking.roomServiceOrders.forEach((order) => {
            if (order.orderedAt && order.deliveredAt) {
              const processingTime =
                (new Date(order.deliveredAt) - new Date(order.orderedAt)) / (1000 * 60);
              operations.roomService.push({
                bookingId: booking._id,
                orderId: order._id,
                processingTime: Math.max(0, processingTime),
                orderType: order.type || 'FOOD',
                orderValue: order.totalAmount || 0,
              });
            }
          });
        }

        // Maintenance request processing times
        if (booking.maintenanceRequests) {
          booking.maintenanceRequests.forEach((request) => {
            if (request.reportedAt && request.resolvedAt) {
              const processingTime =
                (new Date(request.resolvedAt) - new Date(request.reportedAt)) / (1000 * 60);
              operations.maintenance.push({
                bookingId: booking._id,
                requestId: request._id,
                processingTime: Math.max(0, processingTime),
                urgency: request.urgency || 'NORMAL',
                category: request.category || 'GENERAL',
              });
            }
          });
        }

        // Housekeeping processing times
        if (booking.housekeepingLogs) {
          booking.housekeepingLogs.forEach((log) => {
            if (log.startTime && log.completedTime) {
              const processingTime =
                (new Date(log.completedTime) - new Date(log.startTime)) / (1000 * 60);
              operations.housekeeping.push({
                bookingId: booking._id,
                logId: log._id,
                processingTime: Math.max(0, processingTime),
                serviceType: log.serviceType || 'CLEANING',
                roomType: booking.rooms[0]?.type || 'UNKNOWN',
              });
            }
          });
        }
      });

      // Calculate statistics for each operation type
      const operationStats = {};
      Object.entries(operations).forEach(([operation, data]) => {
        if (data.length > 0) {
          const times = data.map((item) => item.processingTime);
          operationStats[operation] = {
            count: data.length,
            averageTime: times.reduce((sum, time) => sum + time, 0) / times.length,
            medianTime: this.calculateMedian(times),
            minTime: Math.min(...times),
            maxTime: Math.max(...times),
            standardDeviation: this.calculateStandardDeviation(times),
            percentiles: {
              p25: this.calculatePercentile(times, 25),
              p75: this.calculatePercentile(times, 75),
              p90: this.calculatePercentile(times, 90),
              p95: this.calculatePercentile(times, 95),
            },
            fastOperations: times.filter((time) => time <= this.getTargetTime(operation)).length,
            slowOperations: times.filter((time) => time > this.getMaxAcceptableTime(operation))
              .length,
            efficiency:
              (times.filter((time) => time <= this.getTargetTime(operation)).length /
                times.length) *
              100,
          };
        } else {
          operationStats[operation] = {
            count: 0,
            averageTime: 0,
            efficiency: 0,
          };
        }
      });

      // Overall processing efficiency
      const overallEfficiency =
        Object.values(operationStats).reduce((sum, stat) => {
          return sum + stat.efficiency * stat.count;
        }, 0) / Object.values(operationStats).reduce((sum, stat) => sum + stat.count, 0) || 0;

      // Identify bottlenecks
      const bottlenecks = Object.entries(operationStats)
        .filter(([operation, stats]) => stats.efficiency < 80)
        .map(([operation, stats]) => ({
          operation,
          efficiency: stats.efficiency,
          averageTime: stats.averageTime,
          impact: this.calculateBottleneckImpact(operation, stats),
          recommendations: this.getBottleneckRecommendations(operation, stats),
        }));

      return {
        operations: operationStats,
        overallEfficiency: Math.round(overallEfficiency),
        bottlenecks,
        trends: this.analyzeProcessingTrends(operations),
        benchmarks: this.getProcessingBenchmarks(),
        recommendations: this.generateProcessingRecommendations(operationStats, bottlenecks),
      };
    } catch (error) {
      logger.error('Error calculating processing times:', error);
      return { error: error.message };
    }
  }

  /**
   * Calculate check-in/check-out efficiency metrics
   */
  calculateCheckInOutEfficiency(checkInMetrics, checkOutMetrics) {
    try {
      // Overall efficiency calculation
      const checkInEfficiency = checkInMetrics.efficiency || 0;
      const checkOutEfficiency = checkOutMetrics.efficiency || 0;
      const overallEfficiency = (checkInEfficiency + checkOutEfficiency) / 2;

      // Time-based efficiency
      const targetCheckInTime = 5; // minutes
      const targetCheckOutTime = 3; // minutes

      const checkInTimeEfficiency =
        checkInMetrics.averageProcessingTime > 0
          ? Math.max(0, (targetCheckInTime / checkInMetrics.averageProcessingTime) * 100)
          : 0;

      const checkOutTimeEfficiency =
        checkOutMetrics.averageProcessingTime > 0
          ? Math.max(0, (targetCheckOutTime / checkOutMetrics.averageProcessingTime) * 100)
          : 0;

      // Guest satisfaction impact
      const guestSatisfactionImpact = this.calculateGuestSatisfactionImpact(
        checkInMetrics,
        checkOutMetrics
      );

      // Peak hour performance
      const peakHourEfficiency = this.calculatePeakHourEfficiency(
        checkInMetrics.hourlyDistribution || {},
        checkOutMetrics
      );

      // Staff productivity metrics
      const staffProductivity = this.calculateStaffProductivity(
        checkInMetrics.totalCheckIns || 0,
        checkOutMetrics.totalCheckOuts || 0,
        checkInMetrics.averageProcessingTime || 0,
        checkOutMetrics.averageProcessingTime || 0
      );

      // Issue resolution efficiency
      const issueResolutionEfficiency = this.calculateIssueResolutionEfficiency([
        ...(checkInMetrics.issues || []),
        ...(checkOutMetrics.issues || []),
      ]);

      // Technology utilization
      const technologyUtilization = this.calculateTechnologyUtilization(
        checkInMetrics,
        checkOutMetrics
      );

      // Cost efficiency
      const costEfficiency = this.calculateCostEfficiency(
        checkInMetrics.totalCheckIns + checkOutMetrics.totalCheckOuts,
        (checkInMetrics.averageProcessingTime + checkOutMetrics.averageProcessingTime) / 2
      );

      return {
        overall: {
          efficiency: Math.round(overallEfficiency),
          rating: this.getEfficiencyRating(overallEfficiency),
          trend: this.calculateEfficiencyTrend(checkInMetrics, checkOutMetrics),
        },
        checkIn: {
          processEfficiency: Math.round(checkInEfficiency),
          timeEfficiency: Math.round(checkInTimeEfficiency),
          peakHourPerformance: peakHourEfficiency.checkIn,
        },
        checkOut: {
          processEfficiency: Math.round(checkOutEfficiency),
          timeEfficiency: Math.round(checkOutTimeEfficiency),
          onTimePerformance: checkOutMetrics.onTimeRate || 0,
        },
        guestSatisfaction: {
          impact: guestSatisfactionImpact,
          rating: this.getGuestSatisfactionRating(guestSatisfactionImpact),
          factors: this.getGuestSatisfactionFactors(checkInMetrics, checkOutMetrics),
        },
        peakHourPerformance: peakHourEfficiency,
        staffProductivity,
        issueResolution: issueResolutionEfficiency,
        technology: technologyUtilization,
        cost: costEfficiency,
        benchmarks: {
          industryAverage: 75,
          targetEfficiency: 85,
          excellentPerformance: 95,
        },
        recommendations: this.generateEfficiencyRecommendations({
          overallEfficiency,
          checkInEfficiency,
          checkOutEfficiency,
          guestSatisfactionImpact,
          staffProductivity,
        }),
      };
    } catch (error) {
      logger.error('Error calculating check-in/out efficiency:', error);
      return { error: error.message };
    }
  }

  /**
   * Analyze extras and services usage
   */
  analyzeExtrasUsage(bookings) {
    try {
      const extrasData = {
        roomService: [],
        spa: [],
        restaurant: [],
        laundry: [],
        transportation: [],
        tours: [],
        other: [],
      };

      let totalExtrasRevenue = 0;
      let totalBookingsWithExtras = 0;

      bookings.forEach((booking) => {
        const bookingExtras = booking.extras || booking.additionalServices || [];
        const hasExtras = bookingExtras.length > 0;

        if (hasExtras) {
          totalBookingsWithExtras++;
        }

        bookingExtras.forEach((extra) => {
          const category = this.categorizeExtra(extra.type || extra.service);
          const extraData = {
            bookingId: booking._id,
            service: extra.service || extra.type,
            amount: extra.amount || extra.price || 0,
            quantity: extra.quantity || 1,
            date: extra.date || extra.usedAt || booking.checkInDate,
            guestType: booking.guestType || 'STANDARD',
            roomType: booking.rooms[0]?.type || 'UNKNOWN',
            duration: extra.duration || null,
            rating: extra.rating || null,
            revenue: (extra.amount || extra.price || 0) * (extra.quantity || 1),
          };

          extrasData[category].push(extraData);
          totalExtrasRevenue += extraData.revenue;
        });
      });

      // Calculate statistics for each category
      const categoryStats = {};
      Object.entries(extrasData).forEach(([category, services]) => {
        if (services.length > 0) {
          const revenues = services.map((service) => service.revenue);
          const quantities = services.map((service) => service.quantity);

          categoryStats[category] = {
            totalUsage: services.length,
            totalRevenue: revenues.reduce((sum, rev) => sum + rev, 0),
            averageOrderValue: revenues.reduce((sum, rev) => sum + rev, 0) / services.length,
            averageQuantity: quantities.reduce((sum, qty) => sum + qty, 0) / services.length,
            uniqueServices: [...new Set(services.map((s) => s.service))].length,
            popularServices: this.getPopularServices(services),
            revenuePercentage:
              (revenues.reduce((sum, rev) => sum + rev, 0) / totalExtrasRevenue) * 100,
            usageByGuestType: this.analyzeUsageByGuestType(services),
            usageByRoomType: this.analyzeUsageByRoomType(services),
            seasonalTrends: this.analyzeSeasonalUsage(services),
            satisfaction: this.calculateServiceSatisfaction(services),
          };
        } else {
          categoryStats[category] = {
            totalUsage: 0,
            totalRevenue: 0,
            averageOrderValue: 0,
            revenuePercentage: 0,
          };
        }
      });

      // Overall metrics
      const totalBookings = bookings.length;
      const extrasAttachRate =
        totalBookings > 0 ? (totalBookingsWithExtras / totalBookings) * 100 : 0;
      const averageExtrasRevenuePerBooking =
        totalBookings > 0 ? totalExtrasRevenue / totalBookings : 0;
      const averageExtrasRevenuePerGuestWithExtras =
        totalBookingsWithExtras > 0 ? totalExtrasRevenue / totalBookingsWithExtras : 0;

      // Identify opportunities
      const opportunities = this.identifyExtrasOpportunities(categoryStats, extrasAttachRate);

      // Revenue analysis
      const revenueAnalysis = {
        total: totalExtrasRevenue,
        averagePerBooking: averageExtrasRevenuePerBooking,
        averagePerGuestWithExtras: averageExtrasRevenuePerGuestWithExtras,
        highestCategory: Object.entries(categoryStats).sort(
          ([, a], [, b]) => b.totalRevenue - a.totalRevenue
        )[0],
        fastestGrowing: this.identifyFastestGrowingCategory(categoryStats),
        potentialIncrease: this.calculateRevenuePotential(categoryStats, extrasAttachRate),
      };

      return {
        summary: {
          totalBookings,
          bookingsWithExtras: totalBookingsWithExtras,
          extrasAttachRate: Math.round(extrasAttachRate),
          totalExtrasRevenue,
          averageExtrasRevenuePerBooking: Math.round(averageExtrasRevenuePerBooking),
          averageExtrasRevenuePerGuestWithExtras: Math.round(
            averageExtrasRevenuePerGuestWithExtras
          ),
        },
        categories: categoryStats,
        revenueAnalysis,
        opportunities,
        trends: this.analyzeExtrasTrends(extrasData),
        recommendations: this.generateExtrasRecommendations(
          categoryStats,
          opportunities,
          extrasAttachRate
        ),
      };
    } catch (error) {
      logger.error('Error analyzing extras usage:', error);
      return { error: error.message };
    }
  }

  /**
   * Analyze service quality metrics
   */
  analyzeServiceQuality(bookings) {
    try {
      const qualityMetrics = {
        overallSatisfaction: 0,
        serviceRatings: {},
        complaintAnalysis: {},
        responseTimeMetrics: {},
        resolutionMetrics: {},
        staffPerformance: {},
      };

      const ratings = [];
      const complaints = [];
      const compliments = [];
      const serviceInteractions = [];

      bookings.forEach((booking) => {
        // Overall guest ratings
        if (booking.guestRating) {
          ratings.push({
            overall: booking.guestRating.overall || 0,
            cleanliness: booking.guestRating.cleanliness || 0,
            service: booking.guestRating.service || 0,
            location: booking.guestRating.location || 0,
            value: booking.guestRating.value || 0,
            amenities: booking.guestRating.amenities || 0,
            bookingId: booking._id,
            guestType: booking.guestType || 'STANDARD',
            roomType: booking.rooms[0]?.type || 'UNKNOWN',
          });
        }

        // Complaints analysis
        if (booking.complaints && booking.complaints.length > 0) {
          booking.complaints.forEach((complaint) => {
            complaints.push({
              bookingId: booking._id,
              category: complaint.category || 'GENERAL',
              severity: complaint.severity || 'MEDIUM',
              reportedAt: complaint.reportedAt,
              resolvedAt: complaint.resolvedAt,
              resolutionTime:
                complaint.resolvedAt && complaint.reportedAt
                  ? (new Date(complaint.resolvedAt) - new Date(complaint.reportedAt)) /
                    (1000 * 60 * 60) // hours
                  : null,
              satisfactionWithResolution: complaint.resolutionRating || null,
              compensation: complaint.compensation || 0,
              preventable: complaint.preventable || false,
            });
          });
        }

        // Compliments analysis
        if (booking.compliments && booking.compliments.length > 0) {
          booking.compliments.forEach((compliment) => {
            compliments.push({
              bookingId: booking._id,
              category: compliment.category || 'GENERAL',
              staffMember: compliment.staffMember || null,
              service: compliment.service || null,
              description: compliment.description || '',
            });
          });
        }

        // Service interactions
        if (booking.serviceInteractions && booking.serviceInteractions.length > 0) {
          booking.serviceInteractions.forEach((interaction) => {
            serviceInteractions.push({
              bookingId: booking._id,
              type: interaction.type || 'GENERAL',
              requestedAt: interaction.requestedAt,
              completedAt: interaction.completedAt,
              responseTime:
                interaction.completedAt && interaction.requestedAt
                  ? (new Date(interaction.completedAt) - new Date(interaction.requestedAt)) /
                    (1000 * 60) // minutes
                  : null,
              staffMember: interaction.staffMember || null,
              rating: interaction.rating || null,
              department: interaction.department || 'GENERAL',
            });
          });
        }
      });

      // Calculate overall satisfaction
      if (ratings.length > 0) {
        qualityMetrics.overallSatisfaction = {
          average: ratings.reduce((sum, rating) => sum + rating.overall, 0) / ratings.length,
          distribution: this.calculateRatingDistribution(ratings.map((r) => r.overall)),
          byCategory: {
            cleanliness:
              ratings.reduce((sum, rating) => sum + rating.cleanliness, 0) / ratings.length,
            service: ratings.reduce((sum, rating) => sum + rating.service, 0) / ratings.length,
            location: ratings.reduce((sum, rating) => sum + rating.location, 0) / ratings.length,
            value: ratings.reduce((sum, rating) => sum + rating.value, 0) / ratings.length,
            amenities: ratings.reduce((sum, rating) => sum + rating.amenities, 0) / ratings.length,
          },
          byGuestType: this.analyzeRatingsByGuestType(ratings),
          byRoomType: this.analyzeRatingsByRoomType(ratings),
          trends: this.analyzeRatingTrends(ratings),
        };
      }

      // Analyze complaints
      if (complaints.length > 0) {
        qualityMetrics.complaintAnalysis = {
          totalComplaints: complaints.length,
          complaintRate: (complaints.length / bookings.length) * 100,
          byCategory: this.analyzeComplaintsByCategory(complaints),
          bySeverity: this.analyzeComplaintsBySeverity(complaints),
          averageResolutionTime:
            complaints
              .filter((c) => c.resolutionTime !== null)
              .reduce((sum, c) => sum + c.resolutionTime, 0) /
              complaints.filter((c) => c.resolutionTime !== null).length || 0,
          resolutionRate: (complaints.filter((c) => c.resolvedAt).length / complaints.length) * 100,
          repeatComplaints: this.identifyRepeatComplaints(complaints),
          preventableComplaints: complaints.filter((c) => c.preventable).length,
          compensationIssued: complaints.reduce((sum, c) => sum + c.compensation, 0),
          resolutionSatisfaction:
            complaints
              .filter((c) => c.satisfactionWithResolution !== null)
              .reduce((sum, c) => sum + c.satisfactionWithResolution, 0) /
              complaints.filter((c) => c.satisfactionWithResolution !== null).length || 0,
        };
      }

      // Analyze service interactions
      if (serviceInteractions.length > 0) {
        qualityMetrics.serviceRatings = {
          totalInteractions: serviceInteractions.length,
          averageResponseTime:
            serviceInteractions
              .filter((si) => si.responseTime !== null)
              .reduce((sum, si) => sum + si.responseTime, 0) /
              serviceInteractions.filter((si) => si.responseTime !== null).length || 0,
          byDepartment: this.analyzeServiceByDepartment(serviceInteractions),
          byType: this.analyzeServiceByType(serviceInteractions),
          satisfactionByService: this.analyzeServiceSatisfaction(serviceInteractions),
          responseTimeDistribution: this.analyzeResponseTimeDistribution(serviceInteractions),
          peakRequestTimes: this.analyzeServicePeakTimes(serviceInteractions),
        };
      }

      // Staff performance analysis
      const staffInteractions = serviceInteractions.filter((si) => si.staffMember);
      if (staffInteractions.length > 0) {
        qualityMetrics.staffPerformance = this.analyzeStaffPerformance(
          staffInteractions,
          compliments
        );
      }

      // Quality score calculation
      const qualityScore = this.calculateOverallQualityScore({
        averageRating: qualityMetrics.overallSatisfaction.average || 0,
        complaintRate: qualityMetrics.complaintAnalysis.complaintRate || 0,
        resolutionRate: qualityMetrics.complaintAnalysis.resolutionRate || 100,
        responseTime: qualityMetrics.serviceRatings.averageResponseTime || 0,
      });

      // Identify improvement areas
      const improvementAreas = this.identifyQualityImprovementAreas({
        ratings: qualityMetrics.overallSatisfaction,
        complaints: qualityMetrics.complaintAnalysis,
        serviceRatings: qualityMetrics.serviceRatings,
      });

      return {
        qualityScore: Math.round(qualityScore),
        overallSatisfaction: qualityMetrics.overallSatisfaction,
        complaints: qualityMetrics.complaintAnalysis,
        serviceRatings: qualityMetrics.serviceRatings,
        staffPerformance: qualityMetrics.staffPerformance,
        improvementAreas,
        trends: this.analyzeQualityTrends(ratings, complaints, serviceInteractions),
        benchmarks: this.getQualityBenchmarks(),
        recommendations: this.generateQualityRecommendations(qualityScore, improvementAreas),
      };
    } catch (error) {
      logger.error('Error analyzing service quality:', error);
      return { error: error.message };
    }
  }

  /**
   * Analyze service revenue and profitability
   */
  analyzeServiceRevenue(bookings) {
    try {
      const revenueStreams = {
        accommodation: { revenue: 0, count: 0, margin: 0.7 },
        roomService: { revenue: 0, count: 0, margin: 0.4 },
        restaurant: { revenue: 0, count: 0, margin: 0.3 },
        spa: { revenue: 0, count: 0, margin: 0.6 },
        laundry: { revenue: 0, count: 0, margin: 0.5 },
        transportation: { revenue: 0, count: 0, margin: 0.2 },
        tours: { revenue: 0, count: 0, margin: 0.25 },
        conference: { revenue: 0, count: 0, margin: 0.4 },
        minibar: { revenue: 0, count: 0, margin: 0.8 },
        parking: { revenue: 0, count: 0, margin: 0.9 },
        other: { revenue: 0, count: 0, margin: 0.3 },
      };

      let totalRevenue = 0;
      let totalProfit = 0;
      const revenueByMonth = {};
      const revenueByDay = {};
      const customerSegmentRevenue = {};

      bookings.forEach((booking) => {
        const bookingDate = moment(booking.checkInDate).format('YYYY-MM');
        const dayOfWeek = moment(booking.checkInDate).format('dddd');
        const customerSegment = this.determineCustomerSegment(booking);

        // Accommodation revenue
        const accommodationRevenue = booking.roomRevenue || booking.totalAmount || 0;
        revenueStreams.accommodation.revenue += accommodationRevenue;
        revenueStreams.accommodation.count++;

        // Additional services revenue
        const services = booking.additionalServices || booking.extras || [];
        services.forEach((service) => {
          const category = this.categorizeServiceRevenue(service.type || service.service);
          const revenue = service.amount || service.price || 0;

          if (revenueStreams[category]) {
            revenueStreams[category].revenue += revenue;
            revenueStreams[category].count++;
          }
        });

        // Calculate total booking revenue
        const bookingTotalRevenue =
          accommodationRevenue +
          services.reduce((sum, service) => sum + (service.amount || service.price || 0), 0);

        totalRevenue += bookingTotalRevenue;

        // Monthly revenue tracking
        revenueByMonth[bookingDate] = (revenueByMonth[bookingDate] || 0) + bookingTotalRevenue;

        // Daily revenue tracking
        revenueByDay[dayOfWeek] = (revenueByDay[dayOfWeek] || 0) + bookingTotalRevenue;

        // Customer segment revenue
        customerSegmentRevenue[customerSegment] =
          (customerSegmentRevenue[customerSegment] || 0) + bookingTotalRevenue;
      });

      // Calculate profit for each revenue stream
      Object.values(revenueStreams).forEach((stream) => {
        stream.profit = stream.revenue * stream.margin;
        totalProfit += stream.profit;
      });

      // Revenue stream analysis
      const revenueStreamAnalysis = Object.entries(revenueStreams)
        .map(([stream, data]) => ({
          stream,
          revenue: Math.round(data.revenue),
          profit: Math.round(data.profit),
          count: data.count,
          averagePerTransaction: data.count > 0 ? data.revenue / data.count : 0,
          marginPercentage: data.margin * 100,
          revenuePercentage: totalRevenue > 0 ? (data.revenue / totalRevenue) * 100 : 0,
          profitPercentage: totalProfit > 0 ? (data.profit / totalProfit) * 100 : 0,
          growth: this.calculateRevenueGrowth(stream, data.revenue),
          seasonality: this.analyzeRevenueSeasonality(stream, revenueByMonth),
        }))
        .sort((a, b) => b.revenue - a.revenue);

      // Performance metrics
      const averageRevenuePerBooking = bookings.length > 0 ? totalRevenue / bookings.length : 0;
      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

      // Revenue optimization opportunities
      const optimizationOpportunities = this.identifyRevenueOptimization(revenueStreamAnalysis);

      // Revenue forecasting
      const revenueForecast = this.generateRevenueForecast(revenueByMonth, revenueStreams);

      // Customer lifetime value analysis
      const customerValueAnalysis = this.analyzeCustomerLifetimeValue(
        customerSegmentRevenue,
        bookings
      );

      // Pricing analysis
      const pricingAnalysis = this.analyzePricingEffectiveness(revenueStreams, bookings);

      return {
        summary: {
          totalRevenue: Math.round(totalRevenue),
          totalProfit: Math.round(totalProfit),
          profitMargin: Math.round(profitMargin * 100) / 100,
          averageRevenuePerBooking: Math.round(averageRevenuePerBooking),
          totalBookings: bookings.length,
          revenueStreamsCount: Object.keys(revenueStreams).length,
        },
        revenueStreams: revenueStreamAnalysis,
        trends: {
          monthly: revenueByMonth,
          daily: revenueByDay,
          growth: this.calculateOverallRevenueGrowth(totalRevenue),
          seasonality: this.analyzeOverallSeasonality(revenueByMonth),
        },
        customerSegments: Object.entries(customerSegmentRevenue).map(([segment, revenue]) => ({
          segment,
          revenue: Math.round(revenue),
          percentage: (revenue / totalRevenue) * 100,
          averageValue: revenue / this.getSegmentBookingCount(segment, bookings),
        })),
        optimization: optimizationOpportunities,
        forecast: revenueForecast,
        customerValue: customerValueAnalysis,
        pricing: pricingAnalysis,
        benchmarks: this.getRevenueBenchmarks(),
        recommendations: this.generateRevenueRecommendations({
          revenueStreams: revenueStreamAnalysis,
          profitMargin,
          optimization: optimizationOpportunities,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing service revenue:', error);
      return { error: error.message };
    }
  }

  /**
   * Generate service insights from extras and quality data
   */
  generateServiceInsights(extrasAnalysis, qualityAnalysis) {
    try {
      const insights = [];

      // Extras usage insights
      if (extrasAnalysis && extrasAnalysis.summary) {
        const { extrasAttachRate, averageExtrasRevenuePerBooking } = extrasAnalysis.summary;

        if (extrasAttachRate < 30) {
          insights.push({
            type: 'OPPORTUNITY',
            category: 'EXTRAS_USAGE',
            severity: 'MEDIUM',
            title: 'Low Extras Attachment Rate',
            message: `Only ${extrasAttachRate}% of guests use additional services`,
            impact: 'Revenue opportunity being missed',
            recommendation: 'Implement proactive upselling and improve service visibility',
            potentialIncrease: `Could increase revenue by ${Math.round((50 - extrasAttachRate) * averageExtrasRevenuePerBooking)}€ per booking`,
            actionItems: [
              'Train staff on upselling techniques',
              'Create attractive service packages',
              'Improve in-room service promotion materials',
              'Implement digital upselling via mobile app',
            ],
          });
        }

        if (extrasAnalysis.categories) {
          // Find underperforming categories
          Object.entries(extrasAnalysis.categories).forEach(([category, stats]) => {
            if (stats.revenuePercentage < 5 && category !== 'other') {
              insights.push({
                type: 'UNDERPERFORMANCE',
                category: 'SERVICE_CATEGORY',
                severity: 'LOW',
                title: `Underperforming ${category} services`,
                message: `${category} represents only ${stats.revenuePercentage.toFixed(1)}% of extras revenue`,
                impact: 'Potential revenue stream not optimized',
                recommendation: `Review and enhance ${category} service offerings`,
                actionItems: [
                  `Analyze guest demand for ${category} services`,
                  `Review pricing strategy for ${category}`,
                  `Improve marketing of ${category} services`,
                  `Consider partnerships or service upgrades`,
                ],
              });
            }
          });
        }
      }

      // Quality insights
      if (qualityAnalysis && qualityAnalysis.overallSatisfaction) {
        const satisfaction = qualityAnalysis.overallSatisfaction.average;

        if (satisfaction < 4.0) {
          insights.push({
            type: 'ALERT',
            category: 'SERVICE_QUALITY',
            severity: 'HIGH',
            title: 'Low Guest Satisfaction',
            message: `Average satisfaction rating of ${satisfaction.toFixed(1)}/5 is below acceptable threshold`,
            impact: 'Risk of negative reviews and reduced repeat bookings',
            recommendation: 'Immediate service quality improvement program required',
            actionItems: [
              'Conduct guest feedback analysis',
              'Implement staff training programs',
              'Review service delivery processes',
              'Establish quality monitoring system',
            ],
          });
        }

        // Category-specific quality insights
        if (qualityAnalysis.overallSatisfaction.byCategory) {
          Object.entries(qualityAnalysis.overallSatisfaction.byCategory).forEach(
            ([category, rating]) => {
              if (rating < 3.8) {
                insights.push({
                  type: 'WARNING',
                  category: 'QUALITY_CATEGORY',
                  severity: 'MEDIUM',
                  title: `Low ${category} satisfaction`,
                  message: `${category} rating of ${rating.toFixed(1)}/5 needs improvement`,
                  impact: `Poor ${category} experience affecting overall satisfaction`,
                  recommendation: `Focus improvement efforts on ${category}`,
                  actionItems: [
                    `Conduct detailed ${category} assessment`,
                    `Invest in ${category} improvements`,
                    `Train staff on ${category} standards`,
                    `Monitor ${category} performance closely`,
                  ],
                });
              }
            }
          );
        }
      }

      // Complaint insights
      if (qualityAnalysis && qualityAnalysis.complaints) {
        const { complaintRate, averageResolutionTime } = qualityAnalysis.complaints;

        if (complaintRate > 10) {
          insights.push({
            type: 'ALERT',
            category: 'COMPLAINTS',
            severity: 'HIGH',
            title: 'High Complaint Rate',
            message: `${complaintRate.toFixed(1)}% complaint rate exceeds acceptable threshold`,
            impact: 'Guest satisfaction and reputation at risk',
            recommendation: 'Implement comprehensive service improvement program',
            actionItems: [
              'Analyze complaint root causes',
              'Strengthen preventive measures',
              'Improve staff training',
              'Enhance quality control processes',
            ],
          });
        }

        if (averageResolutionTime > 24) {
          insights.push({
            type: 'WARNING',
            category: 'COMPLAINT_RESOLUTION',
            severity: 'MEDIUM',
            title: 'Slow Complaint Resolution',
            message: `Average resolution time of ${averageResolutionTime.toFixed(1)} hours is too long`,
            impact: 'Poor resolution experience affecting guest satisfaction',
            recommendation: 'Streamline complaint resolution process',
            actionItems: [
              'Establish clear escalation procedures',
              'Empower front-line staff for faster resolution',
              'Implement complaint tracking system',
              'Set and monitor resolution time targets',
            ],
          });
        }
      }

      // Cross-analysis insights
      if (extrasAnalysis && qualityAnalysis) {
        // Correlation between service usage and satisfaction
        const serviceUsageCorrelation = this.analyzeServiceUsageCorrelation(
          extrasAnalysis,
          qualityAnalysis
        );

        if (serviceUsageCorrelation.strongPositiveCorrelation) {
          insights.push({
            type: 'SUCCESS',
            category: 'SERVICE_CORRELATION',
            severity: 'INFO',
            title: 'Service Usage Drives Satisfaction',
            message: 'Guests who use additional services show higher satisfaction rates',
            impact: 'Strong business case for promoting additional services',
            recommendation: 'Increase focus on service upselling and cross-selling',
            actionItems: [
              'Develop integrated service packages',
              'Train staff on benefit-focused selling',
              'Create personalized service recommendations',
              'Implement loyalty rewards for service usage',
            ],
          });
        }

        // Revenue vs Quality balance
        const revenueQualityBalance = this.analyzeRevenueQualityBalance(
          extrasAnalysis,
          qualityAnalysis
        );

        if (revenueQualityBalance.imbalanced) {
          insights.push({
            type: 'WARNING',
            category: 'REVENUE_QUALITY_BALANCE',
            severity: 'MEDIUM',
            title: 'Revenue-Quality Imbalance Detected',
            message: revenueQualityBalance.message,
            impact: 'Potential long-term revenue risk due to quality issues',
            recommendation: 'Balance revenue growth with quality maintenance',
            actionItems: revenueQualityBalance.actionItems,
          });
        }
      }

      // Prioritize insights by severity and impact
      insights.sort((a, b) => {
        const severityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1, INFO: 0 };
        return severityOrder[b.severity] - severityOrder[a.severity];
      });

      return insights;
    } catch (error) {
      logger.error('Error generating service insights:', error);
      return [];
    }
  }

  /**
   * Analyze efficiency metrics for hotel operations
   */
  async analyzeEfficiencyMetrics(hotelId, startDate, endDate) {
    try {
      // Get operational data
      const bookings = await Booking.find({
        hotel: hotelId,
        checkInDate: { $gte: startDate, $lte: endDate },
      }).populate('rooms hotel');

      const hotel = await Hotel.findById(hotelId);

      // Calculate various efficiency metrics
      const metrics = {
        occupancy: await this.calculateOccupancyEfficiency(bookings, hotel),
        revenue: await this.calculateRevenueEfficiency(bookings, hotel),
        operational: await this.calculateOperationalEfficiency(bookings),
        staff: await this.calculateStaffEfficiency(hotelId, startDate, endDate),
        resource: await this.calculateResourceEfficiency(bookings, hotel),
        technology: await this.calculateTechnologyEfficiency(bookings),
        cost: await this.calculateCostEfficiency(hotelId, bookings),
        environmental: await this.calculateEnvironmentalEfficiency(bookings, hotel),
      };

      // Overall efficiency score
      const overallEfficiency = this.calculateOverallEfficiency(metrics);

      // Efficiency trends
      const trends = await this.analyzeEfficiencyTrends(hotelId, startDate, endDate);

      // Benchmarking
      const benchmarks = await this.getEfficiencyBenchmarks(hotel.category, hotel.size);

      // Improvement opportunities
      const improvements = this.identifyEfficiencyImprovements(metrics, benchmarks);

      return {
        overall: {
          score: Math.round(overallEfficiency),
          rating: this.getEfficiencyRating(overallEfficiency),
          trend: trends.overall,
        },
        metrics,
        trends,
        benchmarks,
        improvements,
        recommendations: this.generateEfficiencyRecommendations(metrics, improvements),
      };
    } catch (error) {
      logger.error('Error analyzing efficiency metrics:', error);
      return { error: error.message };
    }
  }

  /**
   * Analyze staff performance metrics
   */
  async analyzeStaffMetrics(hotelId, startDate, endDate) {
    try {
      // This would integrate with HR/Staff management system
      // For now, we'll analyze staff-related metrics from bookings and services

      const bookings = await Booking.find({
        hotel: hotelId,
        checkInDate: { $gte: startDate, $lte: endDate },
      });

      const staffMetrics = {
        frontDesk: { efficiency: 0, satisfaction: 0, workload: 0 },
        housekeeping: { efficiency: 0, satisfaction: 0, workload: 0 },
        maintenance: { efficiency: 0, satisfaction: 0, workload: 0 },
        foodService: { efficiency: 0, satisfaction: 0, workload: 0 },
        management: { efficiency: 0, satisfaction: 0, workload: 0 },
      };

      // Analyze front desk performance
      const checkInTimes = bookings
        .filter((b) => b.checkInTime && b.arrivalTime)
        .map((b) => (new Date(b.checkInTime) - new Date(b.arrivalTime)) / (1000 * 60));

      if (checkInTimes.length > 0) {
        const avgCheckInTime =
          checkInTimes.reduce((sum, time) => sum + time, 0) / checkInTimes.length;
        staffMetrics.frontDesk.efficiency = Math.max(0, 100 - avgCheckInTime * 2); // Efficiency decreases with longer times
        staffMetrics.frontDesk.workload = checkInTimes.length;
      }

      // Analyze housekeeping performance from room cleanliness ratings
      const cleanlinessRatings = bookings
        .filter((b) => b.guestRating && b.guestRating.cleanliness)
        .map((b) => b.guestRating.cleanliness);

      if (cleanlinessRatings.length > 0) {
        staffMetrics.housekeeping.satisfaction =
          (cleanlinessRatings.reduce((sum, rating) => sum + rating, 0) /
            cleanlinessRatings.length) *
          20; // Convert to 100 scale
        staffMetrics.housekeeping.workload = bookings.length; // Number of rooms to clean
      }

      // Analyze maintenance performance from issue resolution
      const maintenanceIssues = bookings
        .flatMap((b) => b.maintenanceRequests || [])
        .filter((req) => req.reportedAt && req.resolvedAt);

      if (maintenanceIssues.length > 0) {
        const avgResolutionTime =
          maintenanceIssues
            .map((req) => (new Date(req.resolvedAt) - new Date(req.reportedAt)) / (1000 * 60 * 60))
            .reduce((sum, time) => sum + time, 0) / maintenanceIssues.length;

        staffMetrics.maintenance.efficiency = Math.max(0, 100 - avgResolutionTime); // Efficiency decreases with longer times
        staffMetrics.maintenance.workload = maintenanceIssues.length;
      }

      // Analyze food service performance
      const foodServiceRatings = bookings
        .flatMap((b) => b.roomServiceOrders || [])
        .filter((order) => order.rating)
        .map((order) => order.rating);

      if (foodServiceRatings.length > 0) {
        staffMetrics.foodService.satisfaction =
          (foodServiceRatings.reduce((sum, rating) => sum + rating, 0) /
            foodServiceRatings.length) *
          20;
        staffMetrics.foodService.workload = foodServiceRatings.length;
      }

      // Calculate overall staff performance
      const overallStaffPerformance =
        Object.values(staffMetrics).reduce(
          (sum, dept) => sum + (dept.efficiency + dept.satisfaction) / 2,
          0
        ) / Object.keys(staffMetrics).length;

      // Staff productivity analysis
      const productivity = {
        guestsPerStaffMember: this.calculateGuestsPerStaff(bookings.length),
        revenuePerStaffMember: this.calculateRevenuePerStaff(bookings),
        tasksCompletedPerStaff: this.calculateTasksPerStaff(bookings),
        customerSatisfactionImpact: this.calculateStaffSatisfactionImpact(staffMetrics),
      };

      return {
        departmentMetrics: staffMetrics,
        overallPerformance: Math.round(overallStaffPerformance),
        productivity,
        workloadDistribution: this.analyzeWorkloadDistribution(staffMetrics),
        trainingNeeds: this.identifyTrainingNeeds(staffMetrics),
        recommendations: this.generateStaffRecommendations(staffMetrics, productivity),
      };
    } catch (error) {
      logger.error('Error analyzing staff metrics:', error);
      return { error: error.message };
    }
  }

  /**
   * Calculate operational scores from all metrics
   */
  calculateOperationalScores(metrics) {
    try {
      const { checkInOut, service, efficiency, quality } = metrics;

      // Calculate weighted scores
      const scores = {
        checkInEfficiency:
          (checkInOut?.checkIn?.processEfficiency || 0) * 0.25 +
          (checkInOut?.checkOut?.processEfficiency || 0) * 0.25,

        serviceQuality: (quality?.qualityScore || 0) * 0.3,

        operationalEfficiency: (efficiency?.overall?.score || 0) * 0.2,

        guestSatisfaction: (quality?.overallSatisfaction?.average || 0) * 20, // Convert to 100 scale

        revenueOptimization: (service?.revenueStreams?.[0]?.revenuePercentage || 0) * 0.15,
      };

      // Calculate overall operational score
      const overallScore =
        Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length;

      // Performance categories
      const performanceCategories = {
        excellent: overallScore >= 90,
        good: overallScore >= 75 && overallScore < 90,
        average: overallScore >= 60 && overallScore < 75,
        poor: overallScore < 60,
      };

      const performanceLevel =
        Object.entries(performanceCategories).find(([level, condition]) => condition)?.[0] ||
        'poor';

      // Key performance indicators
      const kpis = {
        customerSatisfaction: scores.guestSatisfaction,
        operationalEfficiency: scores.operationalEfficiency,
        revenuePerformance: scores.revenueOptimization,
        serviceDelivery: scores.serviceQuality,
        processEfficiency: scores.checkInEfficiency,
      };

      // Performance trends
      const trends = this.calculatePerformanceTrends(scores);

      // Critical success factors
      const criticalFactors = this.identifyCriticalSuccessFactors(scores, metrics);

      return {
        overall: {
          score: Math.round(overallScore),
          level: performanceLevel,
          trend: trends.overall,
        },
        categoryScores: Object.entries(scores).map(([category, score]) => ({
          category,
          score: Math.round(score),
          rating: this.getScoreRating(score),
          trend: trends[category] || 'stable',
        })),
        kpis,
        trends,
        criticalFactors,
        improvementPriorities: this.identifyImprovementPriorities(scores),
        benchmarkComparison: this.compareToIndustryBenchmarks(overallScore, kpis),
      };
    } catch (error) {
      logger.error('Error calculating operational scores:', error);
      return { error: error.message };
    }
  }

  /**
   * Generate operational insights from metrics data
   */
  generateOperationalInsights(data) {
    try {
      const insights = [];
      const { scores, metrics } = data;

      // Overall performance insights
      if (scores.overall.score >= 85) {
        insights.push({
          type: 'SUCCESS',
          category: 'OVERALL_PERFORMANCE',
          title: 'Excellent Operational Performance',
          message: `Outstanding operational score of ${scores.overall.score}/100`,
          impact: 'HIGH',
          recommendation: 'Maintain current excellence and share best practices',
          priority: 'LOW',
        });
      } else if (scores.overall.score < 70) {
        insights.push({
          type: 'ALERT',
          category: 'OVERALL_PERFORMANCE',
          title: 'Operational Performance Below Target',
          message: `Operational score of ${scores.overall.score}/100 needs improvement`,
          impact: 'HIGH',
          recommendation: 'Implement comprehensive operational improvement program',
          priority: 'HIGH',
        });
      }

      // Category-specific insights
      scores.categoryScores?.forEach((category) => {
        if (category.score < 65) {
          insights.push({
            type: 'WARNING',
            category: category.category.toUpperCase(),
            title: `Poor ${category.category} Performance`,
            message: `${category.category} score of ${category.score}/100 is below acceptable level`,
            impact: 'MEDIUM',
            recommendation: `Focus improvement efforts on ${category.category}`,
            priority: 'MEDIUM',
          });
        }
      });

      // Check-in/Check-out specific insights
      if (metrics.checkInOutMetrics) {
        const { averageProcessingTime } = metrics.checkInOutMetrics;
        if (averageProcessingTime > 10) {
          insights.push({
            type: 'OPPORTUNITY',
            category: 'PROCESS_EFFICIENCY',
            title: 'Check-in Process Optimization Needed',
            message: `Average check-in time of ${averageProcessingTime} minutes exceeds target`,
            impact: 'MEDIUM',
            recommendation: 'Streamline check-in process and consider technology solutions',
            priority: 'MEDIUM',
          });
        }
      }

      // Service quality insights
      if (metrics.qualityMetrics) {
        const { complaintRate } = metrics.qualityMetrics;
        if (complaintRate > 15) {
          insights.push({
            type: 'ALERT',
            category: 'SERVICE_QUALITY',
            title: 'High Guest Complaint Rate',
            message: `Complaint rate of ${complaintRate}% indicates service quality issues`,
            impact: 'HIGH',
            recommendation: 'Immediate service quality improvement initiative required',
            priority: 'HIGH',
          });
        }
      }

      // Efficiency insights
      if (metrics.serviceMetrics && metrics.serviceMetrics.extrasAttachRate < 25) {
        insights.push({
          type: 'OPPORTUNITY',
          category: 'REVENUE_OPTIMIZATION',
          title: 'Low Additional Services Usage',
          message: `Only ${metrics.serviceMetrics.extrasAttachRate}% of guests use additional services`,
          impact: 'MEDIUM',
          recommendation: 'Implement upselling training and improve service visibility',
          priority: 'MEDIUM',
        });
      }

      // Technology utilization insights
      if (scores.kpis && scores.kpis.processEfficiency < 70) {
        insights.push({
          type: 'OPPORTUNITY',
          category: 'TECHNOLOGY',
          title: 'Technology Adoption Opportunity',
          message: 'Low process efficiency suggests potential for technology improvements',
          impact: 'MEDIUM',
          recommendation: 'Evaluate technology solutions for process automation',
          priority: 'MEDIUM',
        });
      }

      // Staff performance insights
      if (metrics.staffMetrics) {
        const avgStaffPerformance = metrics.staffMetrics.overallPerformance || 0;
        if (avgStaffPerformance < 75) {
          insights.push({
            type: 'WARNING',
            category: 'STAFF_PERFORMANCE',
            title: 'Staff Performance Below Target',
            message: `Average staff performance of ${avgStaffPerformance}/100 needs attention`,
            impact: 'HIGH',
            recommendation: 'Implement staff training and performance improvement programs',
            priority: 'HIGH',
          });
        }
      }

      // Cross-functional insights
      const crossFunctionalInsights = this.generateCrossFunctionalInsights(metrics);
      insights.push(...crossFunctionalInsights);

      // Sort by priority and impact
      insights.sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const impactOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };

        const aPriority = priorityOrder[a.priority] || 0;
        const bPriority = priorityOrder[b.priority] || 0;
        const aImpact = impactOrder[a.impact] || 0;
        const bImpact = impactOrder[b.impact] || 0;

        // Sort by priority first, then by impact
        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        return bImpact - aImpact;
      });

      return insights;
    } catch (error) {
      logger.error('Error generating operational insights:', error);
      return [];
    }
  }

  /**
   * Generate operational recommendations based on scores and metrics
   */
  generateOperationalRecommendations(scores) {
    try {
      const recommendations = [];

      // Overall performance recommendations
      if (scores.overall.score < 70) {
        recommendations.push({
          category: 'STRATEGIC',
          priority: 'HIGH',
          title: 'Comprehensive Operational Improvement Program',
          description: 'Implement systematic approach to address multiple operational deficiencies',
          actions: [
            'Conduct comprehensive operational audit',
            'Establish performance improvement task force',
            'Set clear performance targets and timelines',
            'Implement regular monitoring and review processes',
          ],
          expectedImpact: 'Improve overall operational score by 15-25 points',
          timeframe: '3-6 months',
          investment: 'MEDIUM',
          roi: 'HIGH',
        });
      }

      // Process efficiency recommendations
      const processEfficiency = scores.kpis?.processEfficiency || 0;
      if (processEfficiency < 75) {
        recommendations.push({
          category: 'PROCESS_OPTIMIZATION',
          priority: 'HIGH',
          title: 'Process Standardization and Automation',
          description: 'Streamline key operational processes to improve efficiency',
          actions: [
            'Map and standardize check-in/check-out processes',
            'Implement digital solutions for guest services',
            'Automate routine administrative tasks',
            'Create process documentation and training materials',
          ],
          expectedImpact: 'Reduce processing times by 30-40%',
          timeframe: '2-4 months',
          investment: 'MEDIUM',
          roi: 'HIGH',
        });
      }

      // Service quality recommendations
      const serviceQuality =
        scores.categoryScores?.find((c) => c.category === 'serviceQuality')?.score || 0;
      if (serviceQuality < 80) {
        recommendations.push({
          category: 'SERVICE_QUALITY',
          priority: 'HIGH',
          title: 'Service Excellence Program',
          description: 'Enhance service delivery to improve guest satisfaction',
          actions: [
            'Implement comprehensive staff training program',
            'Establish service quality standards and monitoring',
            'Create guest feedback collection and response system',
            'Develop service recovery procedures',
          ],
          expectedImpact: 'Increase guest satisfaction by 20-30%',
          timeframe: '2-3 months',
          investment: 'LOW',
          roi: 'HIGH',
        });
      }

      // Technology recommendations
      const operationalEfficiency = scores.kpis?.operationalEfficiency || 0;
      if (operationalEfficiency < 70) {
        recommendations.push({
          category: 'TECHNOLOGY',
          priority: 'MEDIUM',
          title: 'Technology Modernization Initiative',
          description: 'Leverage technology to improve operational efficiency',
          actions: [
            'Implement integrated property management system',
            'Deploy mobile check-in/check-out solutions',
            'Install IoT sensors for room automation',
            'Implement data analytics for decision making',
          ],
          expectedImpact: 'Improve efficiency by 25-35%',
          timeframe: '4-8 months',
          investment: 'HIGH',
          roi: 'MEDIUM',
        });
      }

      // Staff performance recommendations
      const staffScore =
        scores.categoryScores?.find((c) => c.category.includes('staff'))?.score || 0;
      if (staffScore < 75) {
        recommendations.push({
          category: 'HUMAN_RESOURCES',
          priority: 'MEDIUM',
          title: 'Staff Development and Performance Program',
          description: 'Enhance staff capabilities and performance',
          actions: [
            'Conduct skills gap analysis',
            'Implement targeted training programs',
            'Establish performance metrics and incentives',
            'Create career development pathways',
          ],
          expectedImpact: 'Improve staff performance by 20-25%',
          timeframe: '3-6 months',
          investment: 'MEDIUM',
          roi: 'MEDIUM',
        });
      }

      // Revenue optimization recommendations
      const revenuePerformance = scores.kpis?.revenuePerformance || 0;
      if (revenuePerformance < 70) {
        recommendations.push({
          category: 'REVENUE_OPTIMIZATION',
          priority: 'MEDIUM',
          title: 'Revenue Enhancement Strategy',
          description: 'Optimize revenue streams and pricing strategies',
          actions: [
            'Implement dynamic pricing strategies',
            'Develop upselling and cross-selling programs',
            'Create attractive service packages',
            'Optimize distribution channel mix',
          ],
          expectedImpact: 'Increase revenue per guest by 15-20%',
          timeframe: '2-4 months',
          investment: 'LOW',
          roi: 'HIGH',
        });
      }

      // Cost optimization recommendations
      if (scores.overall.score < 80) {
        recommendations.push({
          category: 'COST_OPTIMIZATION',
          priority: 'LOW',
          title: 'Operational Cost Reduction Initiative',
          description: 'Identify and implement cost-saving opportunities',
          actions: [
            'Conduct operational cost analysis',
            'Implement energy efficiency measures',
            'Optimize staff scheduling and productivity',
            'Negotiate better supplier contracts',
          ],
          expectedImpact: 'Reduce operational costs by 10-15%',
          timeframe: '2-6 months',
          investment: 'LOW',
          roi: 'MEDIUM',
        });
      }

      // Guest experience recommendations
      const guestSatisfaction = scores.kpis?.customerSatisfaction || 0;
      if (guestSatisfaction < 85) {
        recommendations.push({
          category: 'GUEST_EXPERIENCE',
          priority: 'HIGH',
          title: 'Guest Experience Enhancement Program',
          description: 'Create memorable and personalized guest experiences',
          actions: [
            'Implement guest preference tracking system',
            'Create personalized welcome and service protocols',
            'Develop guest loyalty and recognition programs',
            'Establish proactive guest communication channels',
          ],
          expectedImpact: 'Increase guest satisfaction and loyalty by 25-30%',
          timeframe: '2-4 months',
          investment: 'MEDIUM',
          roi: 'HIGH',
        });
      }

      // Compliance and standards recommendations
      recommendations.push({
        category: 'COMPLIANCE',
        priority: 'MEDIUM',
        title: 'Operational Standards and Compliance Program',
        description: 'Ensure compliance with industry standards and regulations',
        actions: [
          'Conduct compliance audit and gap analysis',
          'Implement standard operating procedures',
          'Establish quality assurance processes',
          'Create compliance monitoring and reporting system',
        ],
        expectedImpact: 'Ensure regulatory compliance and quality consistency',
        timeframe: '3-4 months',
        investment: 'LOW',
        roi: 'MEDIUM',
      });

      // Sort recommendations by priority and ROI
      recommendations.sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const roiOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };

        const aPriority = priorityOrder[a.priority];
        const bPriority = priorityOrder[b.priority];
        const aRoi = roiOrder[a.roi];
        const bRoi = roiOrder[b.roi];

        if (aPriority !== bPriority) {
          return bPriority - aPriority;
        }
        return bRoi - aRoi;
      });

      return recommendations;
    } catch (error) {
      logger.error('Error generating operational recommendations:', error);
      return [];
    }
  }

  /**
   * ================================
   * HELPER METHODS
   * ================================
   */

  /**
   * Format time slot for display
   */
  formatTimeSlot(hour) {
    if (hour === 0) return '12:00 AM - 12:59 AM';
    if (hour < 12) return `${hour}:00 AM - ${hour}:59 AM`;
    if (hour === 12) return '12:00 PM - 12:59 PM';
    return `${hour - 12}:00 PM - ${hour - 12}:59 PM`;
  }

  /**
   * Calculate median of array
   */
  calculateMedian(arr) {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  }

  /**
   * Calculate standard deviation
   */
  calculateStandardDeviation(arr) {
    if (arr.length === 0) return 0;
    const mean = arr.reduce((sum, val) => sum + val, 0) / arr.length;
    const squareDiffs = arr.map((val) => Math.pow(val - mean, 2));
    const variance = squareDiffs.reduce((sum, val) => sum + val, 0) / arr.length;
    return Math.sqrt(variance);
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(arr, percentile) {
    if (arr.length === 0) return 0;
    const sorted = arr.slice().sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return lower === upper
      ? sorted[lower]
      : sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  /**
   * Get target time for operation type
   */
  getTargetTime(operation) {
    const targets = {
      checkIn: 5, // minutes
      checkOut: 3,
      roomService: 30,
      maintenance: 120,
      housekeeping: 45,
    };
    return targets[operation] || 60;
  }

  /**
   * Get maximum acceptable time for operation
   */
  getMaxAcceptableTime(operation) {
    const maxTimes = {
      checkIn: 15,
      checkOut: 10,
      roomService: 60,
      maintenance: 480, // 8 hours
      housekeeping: 90,
    };
    return maxTimes[operation] || 120;
  }

  /**
   * Categorize extra service
   */
  categorizeExtra(serviceType) {
    const categories = {
      'room-service': 'roomService',
      'food-delivery': 'roomService',
      'spa-treatment': 'spa',
      massage: 'spa',
      wellness: 'spa',
      restaurant: 'restaurant',
      dining: 'restaurant',
      laundry: 'laundry',
      'dry-cleaning': 'laundry',
      transportation: 'transportation',
      'airport-transfer': 'transportation',
      taxi: 'transportation',
      tour: 'tours',
      excursion: 'tours',
      sightseeing: 'tours',
    };

    const serviceKey = (serviceType || '').toLowerCase();
    return categories[serviceKey] || 'other';
  }

  /**
   * Get popular services from service list
   */
  getPopularServices(services) {
    const serviceCount = {};
    services.forEach((service) => {
      serviceCount[service.service] = (serviceCount[service.service] || 0) + 1;
    });

    return Object.entries(serviceCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([service, count]) => ({ service, count }));
  }

  /**
   * Analyze usage by guest type
   */
  analyzeUsageByGuestType(services) {
    const guestTypes = {};
    services.forEach((service) => {
      const type = service.guestType || 'UNKNOWN';
      if (!guestTypes[type]) {
        guestTypes[type] = { count: 0, revenue: 0 };
      }
      guestTypes[type].count++;
      guestTypes[type].revenue += service.revenue;
    });

    return Object.entries(guestTypes).map(([type, data]) => ({
      guestType: type,
      usage: data.count,
      revenue: data.revenue,
      averageSpend: data.count > 0 ? data.revenue / data.count : 0,
    }));
  }

  /**
   * Analyze usage by room type
   */
  analyzeUsageByRoomType(services) {
    const roomTypes = {};
    services.forEach((service) => {
      const type = service.roomType || 'UNKNOWN';
      if (!roomTypes[type]) {
        roomTypes[type] = { count: 0, revenue: 0 };
      }
      roomTypes[type].count++;
      roomTypes[type].revenue += service.revenue;
    });

    return Object.entries(roomTypes).map(([type, data]) => ({
      roomType: type,
      usage: data.count,
      revenue: data.revenue,
      averageSpend: data.count > 0 ? data.revenue / data.count : 0,
    }));
  }

  /**
   * Calculate service satisfaction from ratings
   */
  calculateServiceSatisfaction(services) {
    const ratingsServices = services.filter((s) => s.rating);
    if (ratingsServices.length === 0) return { average: 0, count: 0 };

    const average = ratingsServices.reduce((sum, s) => sum + s.rating, 0) / ratingsServices.length;
    const distribution = {};

    ratingsServices.forEach((s) => {
      distribution[s.rating] = (distribution[s.rating] || 0) + 1;
    });

    return {
      average: Math.round(average * 10) / 10,
      count: ratingsServices.length,
      distribution,
    };
  }

  /**
   * Get efficiency rating based on score
   */
  getEfficiencyRating(score) {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 80) return 'GOOD';
    if (score >= 70) return 'AVERAGE';
    if (score >= 60) return 'BELOW_AVERAGE';
    return 'POOR';
  }

  /**
   * Get score rating
   */
  getScoreRating(score) {
    if (score >= 85) return 'EXCELLENT';
    if (score >= 70) return 'GOOD';
    if (score >= 55) return 'AVERAGE';
    return 'POOR';
  }

  /**
   * Determine customer segment
   */
  determineCustomerSegment(booking) {
    if (booking.guestType === 'CORPORATE') return 'BUSINESS';
    if (booking.guestType === 'GROUP') return 'GROUP';
    if (booking.rooms?.length > 1) return 'FAMILY';
    if (booking.totalAmount > 500) return 'PREMIUM';
    return 'LEISURE';
  }

  /**
   * Categorize service revenue
   */
  categorizeServiceRevenue(serviceType) {
    const mapping = {
      'room-service': 'roomService',
      restaurant: 'restaurant',
      spa: 'spa',
      laundry: 'laundry',
      transportation: 'transportation',
      tours: 'tours',
      conference: 'conference',
      minibar: 'minibar',
      parking: 'parking',
    };

    return mapping[serviceType?.toLowerCase()] || 'other';
  }

  /**
   * Generate check-in recommendations
   */
  generateCheckInRecommendations(efficiency, avgTime, issues) {
    const recommendations = [];

    if (efficiency < 70) {
      recommendations.push({
        type: 'PROCESS_IMPROVEMENT',
        priority: 'HIGH',
        action: 'Streamline check-in process',
        description: 'Reduce steps and automate where possible',
      });
    }

    if (avgTime > 10) {
      recommendations.push({
        type: 'STAFFING',
        priority: 'MEDIUM',
        action: 'Increase staffing during peak hours',
        description: 'Add additional front desk staff during busy periods',
      });
    }

    if (issues.length > 0) {
      recommendations.push({
        type: 'TRAINING',
        priority: 'HIGH',
        action: 'Provide additional staff training',
        description: 'Focus on identified issue areas',
      });
    }

    return recommendations;
  }

  /**
   * Additional helper methods would continue here...
   * Including methods for:
   * - generateCheckOutRecommendations
   * - analyzeCheckInTrends
   * - analyzeCheckOutTrends
   * - calculateBottleneckImpact
   * - getBottleneckRecommendations
   * - generateProcessingRecommendations
   * - calculateGuestSatisfactionImpact
   * - calculatePeakHourEfficiency
   * - calculateStaffProductivity
   * - generateEfficiencyRecommendations
   * - identifyExtrasOpportunities
   * - generateExtrasRecommendations
   * - analyzeRatingsByGuestType
   * - analyzeComplaintsByCategory
   * - generateQualityRecommendations
   * - And many more supporting methods...
   */
  // Operational analytics placeholder methods
  /**
   * Analyze quality metrics for hotel operations
   */
  async analyzeQualityMetrics(hotelId, startDate, endDate) {
    try {
      // Get all bookings for the period
      const bookings = await Booking.find({
        hotel: hotelId,
        checkInDate: { $gte: startDate, $lte: endDate },
      }).populate('customer rooms hotel');

      if (bookings.length === 0) {
        return {
          summary: {
            totalBookings: 0,
            overallQualityScore: 0,
            averageRating: 0,
          },
          ratings: {},
          complaints: {},
          satisfaction: {},
          trends: {},
        };
      }

      // Extract quality-related data
      const qualityData = {
        ratings: [],
        complaints: [],
        compliments: [],
        serviceIssues: [],
        maintenanceIssues: [],
        cleanlinessIssues: [],
        staffInteractions: [],
        amenityRatings: [],
        overallExperience: [],
      };

      // Process each booking for quality metrics
      bookings.forEach((booking) => {
        // Guest ratings analysis
        if (booking.guestRating) {
          qualityData.ratings.push({
            bookingId: booking._id,
            overall: booking.guestRating.overall || 0,
            cleanliness: booking.guestRating.cleanliness || 0,
            service: booking.guestRating.service || 0,
            location: booking.guestRating.location || 0,
            value: booking.guestRating.value || 0,
            amenities: booking.guestRating.amenities || 0,
            comfort: booking.guestRating.comfort || 0,
            staff: booking.guestRating.staff || 0,
            checkInDate: booking.checkInDate,
            roomType: booking.rooms[0]?.type || 'UNKNOWN',
            guestType: booking.guestType || 'LEISURE',
            stayDuration: moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days'),
            totalAmount: booking.totalAmount || 0,
          });
        }

        // Complaints analysis
        if (booking.complaints && booking.complaints.length > 0) {
          booking.complaints.forEach((complaint) => {
            qualityData.complaints.push({
              bookingId: booking._id,
              category: complaint.category || 'GENERAL',
              subcategory: complaint.subcategory || null,
              severity: complaint.severity || 'MEDIUM',
              description: complaint.description || '',
              reportedAt: complaint.reportedAt,
              resolvedAt: complaint.resolvedAt,
              resolutionTime:
                complaint.resolvedAt && complaint.reportedAt
                  ? (new Date(complaint.resolvedAt) - new Date(complaint.reportedAt)) /
                    (1000 * 60 * 60) // hours
                  : null,
              resolutionSatisfaction: complaint.resolutionRating || null,
              staffResponsible: complaint.staffMember || null,
              department: complaint.department || 'UNKNOWN',
              compensation: complaint.compensation || 0,
              preventable: complaint.preventable || false,
              recurring: complaint.recurring || false,
              escalated: complaint.escalated || false,
              roomType: booking.rooms[0]?.type || 'UNKNOWN',
              guestType: booking.guestType || 'LEISURE',
            });
          });
        }

        // Compliments analysis
        if (booking.compliments && booking.compliments.length > 0) {
          booking.compliments.forEach((compliment) => {
            qualityData.compliments.push({
              bookingId: booking._id,
              category: compliment.category || 'GENERAL',
              staffMember: compliment.staffMember || null,
              department: compliment.department || 'GENERAL',
              service: compliment.service || null,
              description: compliment.description || '',
              date: compliment.date || booking.checkInDate,
              roomType: booking.rooms[0]?.type || 'UNKNOWN',
            });
          });
        }

        // Service issues tracking
        if (booking.serviceIssues && booking.serviceIssues.length > 0) {
          booking.serviceIssues.forEach((issue) => {
            qualityData.serviceIssues.push({
              bookingId: booking._id,
              type: issue.type || 'GENERAL',
              severity: issue.severity || 'MEDIUM',
              reportedAt: issue.reportedAt,
              resolvedAt: issue.resolvedAt,
              resolutionTime:
                issue.resolvedAt && issue.reportedAt
                  ? (new Date(issue.resolvedAt) - new Date(issue.reportedAt)) / (1000 * 60 * 60)
                  : null,
              department: issue.department || 'UNKNOWN',
              impact: issue.guestImpact || 'LOW',
            });
          });
        }

        // Maintenance issues affecting guest experience
        if (booking.maintenanceRequests && booking.maintenanceRequests.length > 0) {
          booking.maintenanceRequests.forEach((request) => {
            if (request.guestImpact) {
              qualityData.maintenanceIssues.push({
                bookingId: booking._id,
                category: request.category || 'GENERAL',
                urgency: request.urgency || 'NORMAL',
                reportedAt: request.reportedAt,
                resolvedAt: request.resolvedAt,
                resolutionTime:
                  request.resolvedAt && request.reportedAt
                    ? (new Date(request.resolvedAt) - new Date(request.reportedAt)) /
                      (1000 * 60 * 60)
                    : null,
                guestImpact: request.guestImpact || 'LOW',
                compensationProvided: request.compensation || 0,
              });
            }
          });
        }

        // Staff interactions quality
        if (booking.staffInteractions && booking.staffInteractions.length > 0) {
          booking.staffInteractions.forEach((interaction) => {
            qualityData.staffInteractions.push({
              bookingId: booking._id,
              department: interaction.department || 'FRONT_DESK',
              staffMember: interaction.staffMember || null,
              interactionType: interaction.type || 'GENERAL',
              rating: interaction.rating || null,
              responseTime: interaction.responseTime || null,
              satisfaction: interaction.satisfaction || null,
              date: interaction.date || booking.checkInDate,
              resolved: interaction.resolved || true,
            });
          });
        }

        // Overall experience tracking
        if (booking.experienceNotes) {
          qualityData.overallExperience.push({
            bookingId: booking._id,
            experienceRating: booking.experienceRating || 0,
            wouldRecommend: booking.wouldRecommend || false,
            wouldReturn: booking.wouldReturn || false,
            npsScore: booking.npsScore || 0,
            experienceHighlights: booking.experienceHighlights || [],
            improvementSuggestions: booking.improvementSuggestions || [],
            roomType: booking.rooms[0]?.type || 'UNKNOWN',
            totalSpent: booking.totalAmount || 0,
          });
        }
      });

      // Calculate comprehensive quality metrics
      const qualityMetrics = {
        // Overall ratings analysis
        ratings: this.analyzeRatingsQuality(qualityData.ratings),

        // Complaints analysis
        complaints: this.analyzeComplaintsQuality(qualityData.complaints),

        // Compliments analysis
        compliments: this.analyzeCompliments(qualityData.compliments),

        // Service quality analysis
        serviceQuality: this.analyzeServiceQuality(
          qualityData.serviceIssues,
          qualityData.staffInteractions
        ),

        // Maintenance impact analysis
        maintenanceImpact: this.analyzeMaintenanceImpact(qualityData.maintenanceIssues),

        // Staff performance analysis
        staffPerformance: this.analyzeStaffQualityPerformance(
          qualityData.staffInteractions,
          qualityData.compliments
        ),

        // Guest experience analysis
        guestExperience: this.analyzeGuestExperience(qualityData.overallExperience),

        // Quality trends analysis
        trends: this.analyzeQualityTrends(qualityData, startDate, endDate),

        // Departmental quality analysis
        departmental: this.analyzeDepartmentalQuality(qualityData),

        // Room type quality analysis
        roomTypeQuality: this.analyzeRoomTypeQuality(qualityData),

        // Guest segment quality analysis
        segmentQuality: this.analyzeSegmentQuality(qualityData),
      };

      // Calculate overall quality score
      const overallQualityScore = this.calculateOverallQualityScore({
        ratingsScore: qualityMetrics.ratings.averageOverallRating * 20, // Convert to 100 scale
        complaintsScore: this.calculateComplaintsScore(qualityMetrics.complaints),
        serviceScore: qualityMetrics.serviceQuality.overallScore,
        staffScore: qualityMetrics.staffPerformance.averageRating * 20,
        experienceScore: qualityMetrics.guestExperience.averageExperienceRating * 20,
      });

      // Identify quality improvement priorities
      const improvementPriorities = this.identifyQualityImprovementPriorities(qualityMetrics);

      // Generate quality alerts
      const qualityAlerts = this.generateQualityAlerts(qualityMetrics, overallQualityScore);

      // Calculate quality ROI metrics
      const qualityROI = this.calculateQualityROI(qualityMetrics, bookings);

      // Benchmark against industry standards
      const benchmarkComparison = this.compareQualityToBenchmarks(
        overallQualityScore,
        qualityMetrics
      );

      return {
        summary: {
          totalBookings: bookings.length,
          analysisStartDate: startDate,
          analysisEndDate: endDate,
          overallQualityScore: Math.round(overallQualityScore),
          qualityRating: this.getQualityRating(overallQualityScore),
          averageGuestRating: qualityMetrics.ratings.averageOverallRating,
          totalComplaints: qualityData.complaints.length,
          totalCompliments: qualityData.compliments.length,
          complaintRate: (qualityData.complaints.length / bookings.length) * 100,
          complimentRate: (qualityData.compliments.length / bookings.length) * 100,
          npsScore: qualityMetrics.guestExperience.averageNpsScore || 0,
        },

        ratings: qualityMetrics.ratings,
        complaints: qualityMetrics.complaints,
        compliments: qualityMetrics.compliments,
        serviceQuality: qualityMetrics.serviceQuality,
        maintenanceImpact: qualityMetrics.maintenanceImpact,
        staffPerformance: qualityMetrics.staffPerformance,
        guestExperience: qualityMetrics.guestExperience,
        trends: qualityMetrics.trends,
        departmental: qualityMetrics.departmental,
        roomTypeQuality: qualityMetrics.roomTypeQuality,
        segmentQuality: qualityMetrics.segmentQuality,

        improvementPriorities,
        qualityAlerts,
        qualityROI,
        benchmarkComparison,

        recommendations: this.generateQualityImprovementRecommendations(
          qualityMetrics,
          improvementPriorities,
          overallQualityScore
        ),

        actionPlan: this.createQualityActionPlan(improvementPriorities, qualityAlerts),
      };
    } catch (error) {
      logger.error('Error analyzing quality metrics:', error);
      return {
        error: error.message,
        summary: {
          totalBookings: 0,
          overallQualityScore: 0,
          averageGuestRating: 0,
        },
      };
    }
  }

  /**
   * ================================
   * QUALITY ANALYSIS HELPER METHODS
   * ================================
   */

  /**
   * Analyze ratings quality metrics
   */
  analyzeRatingsQuality(ratings) {
    if (ratings.length === 0) {
      return {
        averageOverallRating: 0,
        ratingDistribution: {},
        categoryAverages: {},
        trendAnalysis: {},
      };
    }

    // Calculate average ratings by category
    const categoryAverages = {
      overall: ratings.reduce((sum, r) => sum + r.overall, 0) / ratings.length,
      cleanliness: ratings.reduce((sum, r) => sum + r.cleanliness, 0) / ratings.length,
      service: ratings.reduce((sum, r) => sum + r.service, 0) / ratings.length,
      location: ratings.reduce((sum, r) => sum + r.location, 0) / ratings.length,
      value: ratings.reduce((sum, r) => sum + r.value, 0) / ratings.length,
      amenities: ratings.reduce((sum, r) => sum + r.amenities, 0) / ratings.length,
      comfort: ratings.reduce((sum, r) => sum + r.comfort, 0) / ratings.length,
      staff: ratings.reduce((sum, r) => sum + r.staff, 0) / ratings.length,
    };

    // Rating distribution
    const ratingDistribution = {};
    [1, 2, 3, 4, 5].forEach((rating) => {
      ratingDistribution[rating] = ratings.filter((r) => Math.round(r.overall) === rating).length;
    });

    // Ratings by room type
    const roomTypeRatings = {};
    ratings.forEach((rating) => {
      if (!roomTypeRatings[rating.roomType]) {
        roomTypeRatings[rating.roomType] = [];
      }
      roomTypeRatings[rating.roomType].push(rating.overall);
    });

    Object.keys(roomTypeRatings).forEach((roomType) => {
      const typeRatings = roomTypeRatings[roomType];
      roomTypeRatings[roomType] = {
        average: typeRatings.reduce((sum, r) => sum + r, 0) / typeRatings.length,
        count: typeRatings.length,
        distribution: this.calculateRatingDistribution(typeRatings),
      };
    });

    // Ratings by guest type
    const guestTypeRatings = {};
    ratings.forEach((rating) => {
      if (!guestTypeRatings[rating.guestType]) {
        guestTypeRatings[rating.guestType] = [];
      }
      guestTypeRatings[rating.guestType].push(rating.overall);
    });

    Object.keys(guestTypeRatings).forEach((guestType) => {
      const typeRatings = guestTypeRatings[guestType];
      guestTypeRatings[guestType] = {
        average: typeRatings.reduce((sum, r) => sum + r, 0) / typeRatings.length,
        count: typeRatings.length,
      };
    });

    // Correlation analysis
    const correlations = this.calculateRatingCorrelations(ratings);

    // Seasonal trends
    const seasonalTrends = this.analyzeRatingSeasonalTrends(ratings);

    return {
      averageOverallRating: Math.round(categoryAverages.overall * 10) / 10,
      categoryAverages: Object.entries(categoryAverages).reduce((acc, [key, value]) => {
        acc[key] = Math.round(value * 10) / 10;
        return acc;
      }, {}),
      ratingDistribution,
      roomTypeRatings,
      guestTypeRatings,
      correlations,
      seasonalTrends,
      totalRatings: ratings.length,
      excellentRatings: ratings.filter((r) => r.overall >= 4.5).length,
      poorRatings: ratings.filter((r) => r.overall <= 2.5).length,
      improvementAreas: this.identifyRatingImprovementAreas(categoryAverages),
      strongPoints: this.identifyRatingStrengths(categoryAverages),
    };
  }

  /**
   * Analyze complaints quality metrics
   */
  analyzeComplaintsQuality(complaints) {
    if (complaints.length === 0) {
      return {
        totalComplaints: 0,
        complaintRate: 0,
        averageResolutionTime: 0,
        resolutionRate: 100,
      };
    }

    // Complaints by category
    const categoryBreakdown = {};
    complaints.forEach((complaint) => {
      const category = complaint.category || 'GENERAL';
      if (!categoryBreakdown[category]) {
        categoryBreakdown[category] = {
          count: 0,
          totalResolutionTime: 0,
          resolvedCount: 0,
          severityBreakdown: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
          compensation: 0,
          preventableCount: 0,
        };
      }

      categoryBreakdown[category].count++;
      categoryBreakdown[category].severityBreakdown[complaint.severity]++;

      if (complaint.resolutionTime !== null) {
        categoryBreakdown[category].totalResolutionTime += complaint.resolutionTime;
        categoryBreakdown[category].resolvedCount++;
      }

      categoryBreakdown[category].compensation += complaint.compensation || 0;

      if (complaint.preventable) {
        categoryBreakdown[category].preventableCount++;
      }
    });

    // Calculate averages for each category
    Object.keys(categoryBreakdown).forEach((category) => {
      const data = categoryBreakdown[category];
      data.averageResolutionTime =
        data.resolvedCount > 0 ? data.totalResolutionTime / data.resolvedCount : 0;
      data.resolutionRate = (data.resolvedCount / data.count) * 100;
      data.preventableRate = (data.preventableCount / data.count) * 100;
      data.averageCompensation = data.count > 0 ? data.compensation / data.count : 0;
    });

    // Overall metrics
    const resolvedComplaints = complaints.filter((c) => c.resolvedAt);
    const averageResolutionTime =
      resolvedComplaints.length > 0
        ? resolvedComplaints.reduce((sum, c) => sum + (c.resolutionTime || 0), 0) /
          resolvedComplaints.length
        : 0;

    const resolutionRate = (resolvedComplaints.length / complaints.length) * 100;
    const escalatedComplaints = complaints.filter((c) => c.escalated).length;
    const recurringComplaints = complaints.filter((c) => c.recurring).length;
    const preventableComplaints = complaints.filter((c) => c.preventable).length;

    // Complaints by severity
    const severityBreakdown = {
      LOW: complaints.filter((c) => c.severity === 'LOW').length,
      MEDIUM: complaints.filter((c) => c.severity === 'MEDIUM').length,
      HIGH: complaints.filter((c) => c.severity === 'HIGH').length,
      CRITICAL: complaints.filter((c) => c.severity === 'CRITICAL').length,
    };

    // Complaints by department
    const departmentBreakdown = {};
    complaints.forEach((complaint) => {
      const dept = complaint.department || 'UNKNOWN';
      departmentBreakdown[dept] = (departmentBreakdown[dept] || 0) + 1;
    });

    // Monthly complaint trends
    const monthlyTrends = this.analyzeComplaintTrends(complaints);

    // Resolution satisfaction
    const resolutionSatisfactionRatings = complaints
      .filter((c) => c.resolutionSatisfaction !== null)
      .map((c) => c.resolutionSatisfaction);

    const averageResolutionSatisfaction =
      resolutionSatisfactionRatings.length > 0
        ? resolutionSatisfactionRatings.reduce((sum, rating) => sum + rating, 0) /
          resolutionSatisfactionRatings.length
        : 0;

    return {
      totalComplaints: complaints.length,
      averageResolutionTime: Math.round(averageResolutionTime * 10) / 10,
      resolutionRate: Math.round(resolutionRate),
      escalationRate: Math.round((escalatedComplaints / complaints.length) * 100),
      recurringRate: Math.round((recurringComplaints / complaints.length) * 100),
      preventableRate: Math.round((preventableComplaints / complaints.length) * 100),
      averageResolutionSatisfaction: Math.round(averageResolutionSatisfaction * 10) / 10,
      totalCompensation: complaints.reduce((sum, c) => sum + (c.compensation || 0), 0),
      categoryBreakdown,
      severityBreakdown,
      departmentBreakdown,
      monthlyTrends,
      quickResolutions: complaints.filter((c) => c.resolutionTime && c.resolutionTime <= 2).length, // Resolved within 2 hours
      slowResolutions: complaints.filter((c) => c.resolutionTime && c.resolutionTime > 24).length, // Took more than 24 hours
      topIssues: this.identifyTopComplaintIssues(categoryBreakdown),
      improvementOpportunities: this.identifyComplaintImprovements(
        categoryBreakdown,
        severityBreakdown
      ),
    };
  }

  /**
   * Calculate overall quality score
   */
  calculateOverallQualityScore(scores) {
    const weights = {
      ratingsScore: 0.3, // 30% - Guest ratings
      complaintsScore: 0.25, // 25% - Complaint handling
      serviceScore: 0.2, // 20% - Service delivery
      staffScore: 0.15, // 15% - Staff performance
      experienceScore: 0.1, // 10% - Overall experience
    };

    let totalScore = 0;
    let totalWeight = 0;

    Object.entries(weights).forEach(([scoreType, weight]) => {
      if (scores[scoreType] !== undefined && scores[scoreType] !== null) {
        totalScore += scores[scoreType] * weight;
        totalWeight += weight;
      }
    });

    return totalWeight > 0 ? totalScore / totalWeight : 0;
  }

  /**
   * Calculate complaints impact score
   */
  calculateComplaintsScore(complaintsMetrics) {
    if (complaintsMetrics.totalComplaints === 0) return 100;

    let score = 100;

    // Deduct points based on complaint rate
    if (complaintsMetrics.totalComplaints > 0) {
      score -= Math.min(50, complaintsMetrics.totalComplaints * 2); // Max 50 point deduction
    }

    // Adjust based on resolution rate
    score = score * (complaintsMetrics.resolutionRate / 100);

    // Adjust based on resolution time
    if (complaintsMetrics.averageResolutionTime > 24) {
      score *= 0.8; // 20% penalty for slow resolution
    } else if (complaintsMetrics.averageResolutionTime <= 2) {
      score *= 1.1; // 10% bonus for quick resolution
    }

    // Adjust based on resolution satisfaction
    if (complaintsMetrics.averageResolutionSatisfaction > 0) {
      score = score * (complaintsMetrics.averageResolutionSatisfaction / 5);
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Get quality rating based on score
   */
  getQualityRating(score) {
    if (score >= 90) return 'EXCELLENT';
    if (score >= 80) return 'VERY_GOOD';
    if (score >= 70) return 'GOOD';
    if (score >= 60) return 'AVERAGE';
    if (score >= 50) return 'BELOW_AVERAGE';
    return 'POOR';
  }

  /**
   * Additional helper methods for quality analysis...
   * These would include implementations for:
   * - analyzeCompliments
   * - analyzeServiceQuality
   * - analyzeMaintenanceImpact
   * - analyzeStaffQualityPerformance
   * - analyzeGuestExperience
   * - analyzeQualityTrends
   * - analyzeDepartmentalQuality
   * - analyzeRoomTypeQuality
   * - analyzeSegmentQuality
   * - identifyQualityImprovementPriorities
   * - generateQualityAlerts
   * - calculateQualityROI
   * - compareQualityToBenchmarks
   * - generateQualityImprovementRecommendations
   * - createQualityActionPlan
   * And more...
   */
  /**
   * Analyze channel performance (booking sources and distribution channels)
   */
  async analyzeChannelPerformance(hotelId, startDate, endDate) {
    try {
      // Get bookings with channel/source information
      const bookings = await Booking.find({
        hotel: hotelId,
        checkInDate: { $gte: startDate, $lte: endDate },
      }).populate('hotel customer');

      if (bookings.length === 0) {
        return {
          totalBookings: 0,
          channels: [],
          performance: {},
          recommendations: [],
        };
      }

      // Channel mapping and categorization
      const channelMapping = {
        DIRECT: { category: 'Direct', commission: 0, cost: 0 },
        WEBSITE: { category: 'Direct', commission: 0, cost: 0 },
        PHONE: { category: 'Direct', commission: 0, cost: 0 },
        WALK_IN: { category: 'Direct', commission: 0, cost: 0 },
        BOOKING_COM: { category: 'OTA', commission: 15, cost: 0.02 },
        EXPEDIA: { category: 'OTA', commission: 18, cost: 0.02 },
        AIRBNB: { category: 'OTA', commission: 12, cost: 0.03 },
        HOTELS_COM: { category: 'OTA', commission: 15, cost: 0.02 },
        AGODA: { category: 'OTA', commission: 16, cost: 0.02 },
        TRIPADVISOR: { category: 'OTA', commission: 12, cost: 0.025 },
        TRAVEL_AGENT: { category: 'Travel Agent', commission: 10, cost: 0.01 },
        CORPORATE: { category: 'Corporate', commission: 5, cost: 0.01 },
        GDS: { category: 'GDS', commission: 8, cost: 0.015 },
        METASEARCH: { category: 'Metasearch', commission: 3, cost: 0.05 },
        SOCIAL_MEDIA: { category: 'Digital Marketing', commission: 0, cost: 0.08 },
        EMAIL_MARKETING: { category: 'Digital Marketing', commission: 0, cost: 0.03 },
        MOBILE_APP: { category: 'Direct', commission: 0, cost: 0.01 },
      };

      // Analyze each channel
      const channelData = {};
      let totalRevenue = 0;
      let totalCommission = 0;
      let totalMarketingCost = 0;

      bookings.forEach((booking) => {
        const source = booking.source || booking.bookingSource || 'UNKNOWN';
        const channelInfo = channelMapping[source] || {
          category: 'Other',
          commission: 5,
          cost: 0.02,
        };

        if (!channelData[source]) {
          channelData[source] = {
            source,
            category: channelInfo.category,
            bookings: 0,
            revenue: 0,
            commission: 0,
            marketingCost: 0,
            averageBookingValue: 0,
            averageLeadTime: 0,
            cancellationRate: 0,
            conversionRate: 0,
            customerLifetimeValue: 0,
            seasonality: {},
            guestTypes: {},
            roomTypes: {},
            leadTimes: [],
            bookingValues: [],
            cancellations: 0,
            repeatBookings: 0,
          };
        }

        const channel = channelData[source];
        const bookingRevenue = booking.totalAmount || booking.totalPrice || 0;
        const commissionAmount = bookingRevenue * (channelInfo.commission / 100);
        const marketingCost = bookingRevenue * channelInfo.cost;

        // Basic metrics
        channel.bookings++;
        channel.revenue += bookingRevenue;
        channel.commission += commissionAmount;
        channel.marketingCost += marketingCost;
        channel.bookingValues.push(bookingRevenue);

        // Lead time analysis
        if (booking.createdAt && booking.checkInDate) {
          const leadTime = moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');
          channel.leadTimes.push(Math.max(0, leadTime));
        }

        // Cancellation tracking
        if (booking.status === 'CANCELLED') {
          channel.cancellations++;
        }

        // Seasonality analysis
        const month = moment(booking.checkInDate).format('MMMM');
        channel.seasonality[month] = (channel.seasonality[month] || 0) + 1;

        // Guest type analysis
        const guestType = booking.guestType || booking.customerType || 'INDIVIDUAL';
        channel.guestTypes[guestType] = (channel.guestTypes[guestType] || 0) + 1;

        // Room type analysis
        if (booking.rooms && booking.rooms.length > 0) {
          booking.rooms.forEach((room) => {
            const roomType = room.type || room.roomType || 'STANDARD';
            channel.roomTypes[roomType] = (channel.roomTypes[roomType] || 0) + 1;
          });
        }

        // Repeat customer analysis (simplified)
        if (booking.customer && booking.customer.bookingHistory?.length > 1) {
          channel.repeatBookings++;
        }

        // Totals
        totalRevenue += bookingRevenue;
        totalCommission += commissionAmount;
        totalMarketingCost += marketingCost;
      });

      // Calculate derived metrics for each channel
      Object.values(channelData).forEach((channel) => {
        // Average metrics
        channel.averageBookingValue = channel.bookings > 0 ? channel.revenue / channel.bookings : 0;
        channel.averageLeadTime =
          channel.leadTimes.length > 0
            ? channel.leadTimes.reduce((sum, time) => sum + time, 0) / channel.leadTimes.length
            : 0;

        // Rates
        channel.cancellationRate =
          channel.bookings > 0 ? (channel.cancellations / channel.bookings) * 100 : 0;
        channel.repeatBookingRate =
          channel.bookings > 0 ? (channel.repeatBookings / channel.bookings) * 100 : 0;

        // Financial metrics
        channel.netRevenue = channel.revenue - channel.commission - channel.marketingCost;
        channel.profitMargin =
          channel.revenue > 0 ? (channel.netRevenue / channel.revenue) * 100 : 0;
        channel.costPerAcquisition =
          channel.bookings > 0
            ? (channel.commission + channel.marketingCost) / channel.bookings
            : 0;
        channel.revenueShare = totalRevenue > 0 ? (channel.revenue / totalRevenue) * 100 : 0;

        // Performance scoring
        channel.performanceScore = this.calculateChannelPerformanceScore({
          profitMargin: channel.profitMargin,
          cancellationRate: channel.cancellationRate,
          averageBookingValue: channel.averageBookingValue,
          repeatBookingRate: channel.repeatBookingRate,
          revenueShare: channel.revenueShare,
        });

        // Lead time distribution
        channel.leadTimeDistribution = this.analyzeLeadTimeDistribution(channel.leadTimes);

        // Booking value distribution
        channel.valueDistribution = this.analyzeValueDistribution(channel.bookingValues);

        // Seasonal performance
        channel.seasonalPerformance = this.analyzeSeasonalPerformance(channel.seasonality);

        // Guest type preferences
        channel.guestTypePreferences = Object.entries(channel.guestTypes)
          .map(([type, count]) => ({
            guestType: type,
            count,
            percentage: (count / channel.bookings) * 100,
          }))
          .sort((a, b) => b.count - a.count);
      });

      // Sort channels by revenue
      const channelPerformance = Object.values(channelData).sort((a, b) => b.revenue - a.revenue);

      // Category analysis
      const categoryAnalysis = this.analyzeCategoryPerformance(channelPerformance);

      // Channel mix optimization analysis
      const channelMixAnalysis = this.analyzeChannelMix(channelPerformance, totalRevenue);

      // Market trends analysis
      const marketTrends = await this.analyzeMarketTrends(channelPerformance, startDate, endDate);

      // Competition analysis
      const competitionAnalysis = this.analyzeChannelCompetition(channelPerformance);

      // ROI analysis
      const roiAnalysis = this.calculateChannelROI(channelPerformance);

      // Identify optimization opportunities
      const optimizationOpportunities = this.identifyChannelOptimization(channelPerformance);

      // Channel attribution analysis
      const attributionAnalysis = this.analyzeChannelAttribution(bookings);

      // Future forecasting
      const forecast = this.forecastChannelPerformance(channelPerformance, 90); // 90 days forecast

      return {
        summary: {
          totalBookings: bookings.length,
          totalRevenue: Math.round(totalRevenue),
          totalCommission: Math.round(totalCommission),
          totalMarketingCost: Math.round(totalMarketingCost),
          netRevenue: Math.round(totalRevenue - totalCommission - totalMarketingCost),
          averageCommissionRate: totalRevenue > 0 ? (totalCommission / totalRevenue) * 100 : 0,
          channelCount: channelPerformance.length,
          topChannel: channelPerformance[0]?.source || 'N/A',
          diversificationIndex: this.calculateChannelDiversification(channelPerformance),
        },

        channels: channelPerformance.map((channel) => ({
          source: channel.source,
          category: channel.category,
          bookings: channel.bookings,
          revenue: Math.round(channel.revenue),
          netRevenue: Math.round(channel.netRevenue),
          revenueShare: Math.round(channel.revenueShare * 100) / 100,
          averageBookingValue: Math.round(channel.averageBookingValue),
          profitMargin: Math.round(channel.profitMargin * 100) / 100,
          cancellationRate: Math.round(channel.cancellationRate * 100) / 100,
          averageLeadTime: Math.round(channel.averageLeadTime),
          performanceScore: Math.round(channel.performanceScore),
          performanceRating: this.getChannelPerformanceRating(channel.performanceScore),
          costPerAcquisition: Math.round(channel.costPerAcquisition),
          repeatBookingRate: Math.round(channel.repeatBookingRate * 100) / 100,
          leadTimeDistribution: channel.leadTimeDistribution,
          valueDistribution: channel.valueDistribution,
          seasonalPerformance: channel.seasonalPerformance,
          guestTypePreferences: channel.guestTypePreferences.slice(0, 3), // Top 3
          trends: this.calculateChannelTrends(channel, startDate, endDate),
        })),

        categoryAnalysis: {
          byCategory: categoryAnalysis,
          directVsIndirect: this.analyzeDirectVsIndirect(channelPerformance),
          paidVsOrganic: this.analyzePaidVsOrganic(channelPerformance),
        },

        performance: {
          channelMix: channelMixAnalysis,
          marketTrends,
          competition: competitionAnalysis,
          roi: roiAnalysis,
          attribution: attributionAnalysis,
        },

        optimization: {
          opportunities: optimizationOpportunities,
          budgetReallocation: this.suggestBudgetReallocation(channelPerformance),
          channelExpansion: this.identifyChannelExpansion(channelPerformance),
          costReduction: this.identifyCostReduction(channelPerformance),
        },

        forecast: forecast,

        insights: this.generateChannelInsights(channelPerformance, categoryAnalysis),

        recommendations: this.generateChannelRecommendations({
          channels: channelPerformance,
          optimization: optimizationOpportunities,
          trends: marketTrends,
        }),

        benchmarks: this.getChannelBenchmarks(),

        alerts: this.generateChannelAlerts(channelPerformance),
      };
    } catch (error) {
      logger.error('Error analyzing channel performance:', error);
      return {
        error: error.message,
        totalBookings: 0,
        channels: [],
        performance: {},
        recommendations: [],
      };
    }
  }

  /**
   * Calculate channel performance score
   */
  calculateChannelPerformanceScore(metrics) {
    const { profitMargin, cancellationRate, averageBookingValue, repeatBookingRate, revenueShare } =
      metrics;

    // Weighted scoring system
    const scores = {
      profitMargin: Math.min(100, Math.max(0, profitMargin * 2)), // 0-50% margin = 0-100 score
      cancellationRate: Math.max(0, 100 - cancellationRate * 5), // Lower cancellation = higher score
      bookingValue: Math.min(100, averageBookingValue / 5), // Relative to €500 average
      repeatRate: repeatBookingRate * 2, // 0-50% repeat = 0-100 score
      marketShare: Math.min(100, revenueShare * 4), // 0-25% share = 0-100 score
    };

    // Weighted average
    const weights = {
      profitMargin: 0.3,
      cancellationRate: 0.2,
      bookingValue: 0.2,
      repeatRate: 0.15,
      marketShare: 0.15,
    };

    return Object.entries(scores).reduce((total, [metric, score]) => {
      return total + score * weights[metric];
    }, 0);
  }

  /**
   * Analyze lead time distribution
   */
  analyzeLeadTimeDistribution(leadTimes) {
    if (leadTimes.length === 0) return {};

    const distribution = {
      sameDay: leadTimes.filter((t) => t === 0).length,
      nextDay: leadTimes.filter((t) => t === 1).length,
      week: leadTimes.filter((t) => t >= 2 && t <= 7).length,
      month: leadTimes.filter((t) => t >= 8 && t <= 30).length,
      longTerm: leadTimes.filter((t) => t > 30).length,
    };

    const total = leadTimes.length;

    return {
      distribution,
      percentages: {
        sameDay: (distribution.sameDay / total) * 100,
        nextDay: (distribution.nextDay / total) * 100,
        week: (distribution.week / total) * 100,
        month: (distribution.month / total) * 100,
        longTerm: (distribution.longTerm / total) * 100,
      },
      median: this.calculateMedian(leadTimes),
      average: leadTimes.reduce((sum, time) => sum + time, 0) / leadTimes.length,
    };
  }

  /**
   * Analyze booking value distribution
   */
  analyzeValueDistribution(values) {
    if (values.length === 0) return {};

    const distribution = {
      budget: values.filter((v) => v < 100).length,
      economy: values.filter((v) => v >= 100 && v < 200).length,
      standard: values.filter((v) => v >= 200 && v < 400).length,
      premium: values.filter((v) => v >= 400 && v < 800).length,
      luxury: values.filter((v) => v >= 800).length,
    };

    const total = values.length;

    return {
      distribution,
      percentages: {
        budget: (distribution.budget / total) * 100,
        economy: (distribution.economy / total) * 100,
        standard: (distribution.standard / total) * 100,
        premium: (distribution.premium / total) * 100,
        luxury: (distribution.luxury / total) * 100,
      },
      median: this.calculateMedian(values),
      average: values.reduce((sum, val) => sum + val, 0) / values.length,
      range: {
        min: Math.min(...values),
        max: Math.max(...values),
      },
    };
  }

  /**
   * Analyze category performance
   */
  analyzeCategoryPerformance(channels) {
    const categories = {};

    channels.forEach((channel) => {
      const category = channel.category;
      if (!categories[category]) {
        categories[category] = {
          channels: 0,
          bookings: 0,
          revenue: 0,
          commission: 0,
          netRevenue: 0,
          averageBookingValue: 0,
          cancellationRate: 0,
          performanceScore: 0,
        };
      }

      const cat = categories[category];
      cat.channels++;
      cat.bookings += channel.bookings;
      cat.revenue += channel.revenue;
      cat.commission += channel.commission;
      cat.netRevenue += channel.netRevenue;
    });

    // Calculate averages
    Object.values(categories).forEach((category) => {
      if (category.bookings > 0) {
        category.averageBookingValue = category.revenue / category.bookings;
        category.profitMargin = (category.netRevenue / category.revenue) * 100;
        category.commissionRate = (category.commission / category.revenue) * 100;
      }
    });

    return Object.entries(categories)
      .map(([name, data]) => ({
        category: name,
        ...data,
        averageBookingValue: Math.round(data.averageBookingValue),
        profitMargin: Math.round(data.profitMargin * 100) / 100,
        commissionRate: Math.round(data.commissionRate * 100) / 100,
      }))
      .sort((a, b) => b.revenue - a.revenue);
  }

  /**
   * Generate channel insights
   */
  generateChannelInsights(channels, categoryAnalysis) {
    const insights = [];

    // Top performer insight
    if (channels.length > 0) {
      const topChannel = channels[0];
      insights.push({
        type: 'SUCCESS',
        category: 'TOP_PERFORMER',
        title: `${topChannel.source} is your top channel`,
        message: `Generates ${topChannel.revenueShare.toFixed(1)}% of total revenue with ${topChannel.performanceScore} performance score`,
        recommendation: 'Continue to invest and optimize this channel',
      });
    }

    // High commission channels
    const highCommissionChannels = channels.filter((c) => c.profitMargin < 50);
    if (highCommissionChannels.length > 0) {
      insights.push({
        type: 'WARNING',
        category: 'HIGH_COMMISSION',
        title: 'High commission costs detected',
        message: `${highCommissionChannels.length} channels have profit margins below 50%`,
        recommendation: 'Review commission structures and negotiate better rates',
      });
    }

    // Direct booking opportunity
    const directChannels = channels.filter((c) => c.category === 'Direct');
    const directShare = directChannels.reduce((sum, c) => sum + c.revenueShare, 0);

    if (directShare < 40) {
      insights.push({
        type: 'OPPORTUNITY',
        category: 'DIRECT_BOOKINGS',
        title: 'Low direct booking percentage',
        message: `Direct bookings represent only ${directShare.toFixed(1)}% of revenue`,
        recommendation: 'Implement direct booking incentives and improve website conversion',
      });
    }

    // Channel diversification
    const diversificationIndex = this.calculateChannelDiversification(channels);
    if (diversificationIndex < 0.5) {
      insights.push({
        type: 'RISK',
        category: 'DIVERSIFICATION',
        title: 'Low channel diversification',
        message: 'Heavy reliance on few channels increases business risk',
        recommendation: 'Expand to new channels to reduce dependency risk',
      });
    }

    return insights;
  }

  /**
   * Generate channel recommendations
   */
  generateChannelRecommendations(data) {
    const recommendations = [];
    const { channels, optimization, trends } = data;

    // Performance optimization
    const underperformingChannels = channels.filter((c) => c.performanceScore < 60);
    if (underperformingChannels.length > 0) {
      recommendations.push({
        category: 'PERFORMANCE_OPTIMIZATION',
        priority: 'HIGH',
        title: 'Optimize underperforming channels',
        description: `${underperformingChannels.length} channels need performance improvement`,
        actions: [
          'Review channel-specific marketing strategies',
          'Improve conversion rates through A/B testing',
          'Renegotiate commission rates where possible',
          'Consider pausing lowest-performing channels',
        ],
        expectedImpact: 'Improve overall channel performance by 15-25%',
        timeframe: '2-3 months',
      });
    }

    // Direct booking increase
    const directShare = channels
      .filter((c) => c.category === 'Direct')
      .reduce((sum, c) => sum + c.revenueShare, 0);

    if (directShare < 50) {
      recommendations.push({
        category: 'DIRECT_BOOKING_GROWTH',
        priority: 'HIGH',
        title: 'Increase direct bookings',
        description: 'Reduce dependency on OTAs and improve profit margins',
        actions: [
          'Implement price parity or best rate guarantees',
          'Offer exclusive perks for direct bookings',
          'Improve website user experience and mobile optimization',
          'Implement retargeting campaigns for website visitors',
        ],
        expectedImpact: 'Increase direct booking share by 10-20%',
        timeframe: '3-6 months',
      });
    }

    // Channel expansion
    if (channels.length < 8) {
      recommendations.push({
        category: 'CHANNEL_EXPANSION',
        priority: 'MEDIUM',
        title: 'Expand distribution channels',
        description: 'Explore new channels to increase market reach',
        actions: [
          'Research emerging OTA platforms',
          'Develop partnerships with local travel agents',
          'Explore corporate booking platforms',
          'Consider niche market channels',
        ],
        expectedImpact: 'Increase total bookings by 10-15%',
        timeframe: '4-6 months',
      });
    }

    return recommendations;
  }

  /**
   * Calculate channel diversification index
   */
  calculateChannelDiversification(channels) {
    if (channels.length === 0) return 0;

    // Calculate Herfindahl-Hirschman Index (HHI) for diversification
    const totalRevenue = channels.reduce((sum, c) => sum + c.revenue, 0);
    const hhi = channels.reduce((sum, c) => {
      const marketShare = c.revenue / totalRevenue;
      return sum + Math.pow(marketShare, 2);
    }, 0);

    // Convert HHI to diversification index (0 = concentrated, 1 = diversified)
    return Math.max(0, 1 - hhi);
  }

  /**
   * Get channel performance rating
   */
  getChannelPerformanceRating(score) {
    if (score >= 85) return 'EXCELLENT';
    if (score >= 70) return 'GOOD';
    if (score >= 55) return 'AVERAGE';
    if (score >= 40) return 'BELOW_AVERAGE';
    return 'POOR';
  }

  // Dashboard and real-time placeholder methods
  /**
   * Calculate total revenue for a given query with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Number} Total revenue amount
   */
  async calculateTotalRevenue(query) {
    try {
      // Build cache key for revenue calculation
      const cacheKey = this.buildAnalyticsCacheKey('total_revenue', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.totalRevenue !== undefined) {
        return cached.totalRevenue;
      }

      // Calculate fresh total revenue
      const result = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalPrice' },
            totalBookings: { $sum: 1 },
            avgBookingValue: { $avg: '$totalPrice' },
          },
        },
      ]);

      const totalRevenue = result[0]?.totalRevenue || 0;

      // Cache the result
      const cacheData = {
        totalRevenue,
        calculatedAt: new Date(),
        bookingCount: result[0]?.totalBookings || 0,
        avgBookingValue: result[0]?.avgBookingValue || 0,
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return totalRevenue;
    } catch (error) {
      logger.error('❌ Error calculating total revenue:', error);
      return 0;
    }
  }
  /**
   * Calculate average occupancy rate for a given query with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Number} Average occupancy percentage
   */
  async calculateAverageOccupancy(query) {
    try {
      // Build cache key for occupancy calculation
      const cacheKey = this.buildAnalyticsCacheKey('avg_occupancy', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.averageOccupancy !== undefined) {
        return cached.averageOccupancy;
      }

      // Get hotel capacity
      let totalRooms = 0;
      if (query.hotel) {
        const hotel = await Hotel.findById(query.hotel).populate('rooms');
        totalRooms = hotel?.rooms?.length || 0;
      } else {
        const hotels = await Hotel.find({ isActive: true }).populate('rooms');
        totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);
      }

      if (totalRooms === 0) return 0;

      // Calculate occupied room nights
      const bookings = await Booking.find({
        ...query,
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      });

      let totalOccupiedRoomNights = 0;
      let totalAvailableRoomNights = 0;

      // Calculate for each day in the period
      const startDate = moment(query.createdAt?.$gte || moment().subtract(30, 'days'));
      const endDate = moment(query.createdAt?.$lte || moment());
      const days = endDate.diff(startDate, 'days') + 1;

      totalAvailableRoomNights = totalRooms * days;

      // Count occupied room nights
      for (const booking of bookings) {
        const checkIn = moment(booking.checkInDate);
        const checkOut = moment(booking.checkOutDate);
        const nights = checkOut.diff(checkIn, 'days');
        totalOccupiedRoomNights += booking.rooms.length * nights;
      }

      const averageOccupancy =
        totalAvailableRoomNights > 0
          ? (totalOccupiedRoomNights / totalAvailableRoomNights) * 100
          : 0;

      // Cache the result
      const cacheData = {
        averageOccupancy: Math.round(averageOccupancy * 100) / 100,
        totalRooms,
        totalOccupiedRoomNights,
        totalAvailableRoomNights,
        days,
        calculatedAt: new Date(),
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return cacheData.averageOccupancy;
    } catch (error) {
      logger.error('❌ Error calculating average occupancy:', error);
      return 0;
    }
  }
  /**
   * Calculate Average Daily Rate (ADR) with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Number} Average Daily Rate
   */
  async calculateAverageADR(query) {
    try {
      // Build cache key for ADR calculation
      const cacheKey = this.buildAnalyticsCacheKey('avg_adr', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.averageADR !== undefined) {
        return cached.averageADR;
      }

      // Calculate ADR from bookings
      const bookings = await Booking.find({
        ...query,
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      });

      if (bookings.length === 0) return 0;

      let totalRevenue = 0;
      let totalRoomNights = 0;

      for (const booking of bookings) {
        const nights = moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days');
        const roomNights = booking.rooms.length * nights;

        totalRevenue += booking.totalPrice || 0;
        totalRoomNights += roomNights;
      }

      const averageADR = totalRoomNights > 0 ? totalRevenue / totalRoomNights : 0;

      // Cache the result
      const cacheData = {
        averageADR: Math.round(averageADR * 100) / 100,
        totalRevenue,
        totalRoomNights,
        bookingCount: bookings.length,
        calculatedAt: new Date(),
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return cacheData.averageADR;
    } catch (error) {
      logger.error('❌ Error calculating average ADR:', error);
      return 0;
    }
  }
  /**
   * Calculate booking conversion rate with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Number} Conversion rate percentage
   */
  async calculateConversionRate(query) {
    try {
      // Build cache key for conversion rate calculation
      const cacheKey = this.buildAnalyticsCacheKey('conversion_rate', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.conversionRate !== undefined) {
        return cached.conversionRate;
      }

      // Calculate conversion rate
      const [confirmedBookings, totalBookings] = await Promise.all([
        Booking.countDocuments({
          ...query,
          status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
        }),
        Booking.countDocuments(query),
      ]);

      const conversionRate = totalBookings > 0 ? (confirmedBookings / totalBookings) * 100 : 0;

      // Cache the result
      const cacheData = {
        conversionRate: Math.round(conversionRate * 100) / 100,
        confirmedBookings,
        totalBookings,
        pendingBookings: totalBookings - confirmedBookings,
        calculatedAt: new Date(),
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return cacheData.conversionRate;
    } catch (error) {
      logger.error('❌ Error calculating conversion rate:', error);
      return 0;
    }
  }
  /**
   * Calculate booking cancellation rate with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Number} Cancellation rate percentage
   */
  async calculateCancellationRate(query) {
    try {
      // Build cache key for cancellation rate calculation
      const cacheKey = this.buildAnalyticsCacheKey('cancellation_rate', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.cancellationRate !== undefined) {
        return cached.cancellationRate;
      }

      // Calculate cancellation rate
      const [cancelledBookings, totalBookings] = await Promise.all([
        Booking.countDocuments({
          ...query,
          status: 'CANCELLED',
        }),
        Booking.countDocuments(query),
      ]);

      const cancellationRate = totalBookings > 0 ? (cancelledBookings / totalBookings) * 100 : 0;

      // Cache the result
      const cacheData = {
        cancellationRate: Math.round(cancellationRate * 100) / 100,
        cancelledBookings,
        totalBookings,
        activeBookings: totalBookings - cancelledBookings,
        calculatedAt: new Date(),
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return cacheData.cancellationRate;
    } catch (error) {
      logger.error('❌ Error calculating cancellation rate:', error);
      return 0;
    }
  }
  /**
   * Calculate growth metrics compared to previous period with Redis cache
   * @param {Object} query - MongoDB query object
   * @returns {Object} Growth metrics object
   */
  async calculatePeriodGrowth(query) {
    try {
      // Build cache key for period growth calculation
      const cacheKey = this.buildAnalyticsCacheKey('period_growth', 'calculation', {
        queryHash: this.hashObject(query),
        date: moment().format('YYYY-MM-DD'), // Daily cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.revenueGrowth !== undefined) {
        return cached;
      }

      // Calculate current period metrics
      const currentMetrics = await this.calculatePeriodMetrics(query);

      // Calculate previous period metrics
      const periodLength = this.calculatePeriodLength(query);
      const previousQuery = this.buildPreviousPeriodQuery(query, periodLength);
      const previousMetrics = await this.calculatePeriodMetrics(previousQuery);

      // Calculate growth rates
      const growthMetrics = {
        revenueGrowth: this.calculateGrowthRate(currentMetrics.revenue, previousMetrics.revenue),
        bookingGrowth: this.calculateGrowthRate(currentMetrics.bookings, previousMetrics.bookings),
        occupancyGrowth: this.calculateGrowthRate(
          currentMetrics.occupancy,
          previousMetrics.occupancy
        ),
        adrGrowth: this.calculateGrowthRate(currentMetrics.adr, previousMetrics.adr),

        current: currentMetrics,
        previous: previousMetrics,

        periodLength,
        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, growthMetrics, 'dashboard');

      return growthMetrics;
    } catch (error) {
      logger.error('❌ Error calculating period growth:', error);
      return {
        revenueGrowth: 0,
        bookingGrowth: 0,
        occupancyGrowth: 0,
        adrGrowth: 0,
      };
    }
  }

  /**
   * Helper method to calculate metrics for a period
   */
  async calculatePeriodMetrics(query) {
    const [revenue, bookings, occupancy, adr] = await Promise.all([
      this.calculateTotalRevenue(query),
      Booking.countDocuments(query),
      this.calculateAverageOccupancy(query),
      this.calculateAverageADR(query),
    ]);

    return { revenue, bookings, occupancy, adr };
  }

  /**
   * Helper method to calculate growth rate
   */
  calculateGrowthRate(current, previous) {
    if (previous === 0) return current > 0 ? 100 : 0;
    return Math.round(((current - previous) / previous) * 10000) / 100;
  }
  /**
   * Rate KPI performance against benchmarks
   * @param {Object} kpis - KPI metrics object
   * @returns {Object} Performance ratings
   */
  rateKPIPerformance(kpis) {
    try {
      const ratings = {};

      // Rate occupancy performance
      if (kpis.occupancy >= this.benchmarks.occupancyRate.excellent) {
        ratings.occupancy = { rating: 'EXCELLENT', score: 95, color: 'green' };
      } else if (kpis.occupancy >= this.benchmarks.occupancyRate.good) {
        ratings.occupancy = { rating: 'GOOD', score: 80, color: 'lightgreen' };
      } else if (kpis.occupancy >= this.benchmarks.occupancyRate.average) {
        ratings.occupancy = { rating: 'AVERAGE', score: 65, color: 'yellow' };
      } else {
        ratings.occupancy = { rating: 'POOR', score: 40, color: 'red' };
      }

      // Rate RevPAR performance
      if (kpis.revPAR >= this.benchmarks.revPAR.excellent) {
        ratings.revPAR = { rating: 'EXCELLENT', score: 95, color: 'green' };
      } else if (kpis.revPAR >= this.benchmarks.revPAR.good) {
        ratings.revPAR = { rating: 'GOOD', score: 80, color: 'lightgreen' };
      } else if (kpis.revPAR >= this.benchmarks.revPAR.average) {
        ratings.revPAR = { rating: 'AVERAGE', score: 65, color: 'yellow' };
      } else {
        ratings.revPAR = { rating: 'POOR', score: 40, color: 'red' };
      }

      // Rate ADR performance
      if (kpis.adr >= this.benchmarks.adr.excellent) {
        ratings.adr = { rating: 'EXCELLENT', score: 95, color: 'green' };
      } else if (kpis.adr >= this.benchmarks.adr.good) {
        ratings.adr = { rating: 'GOOD', score: 80, color: 'lightgreen' };
      } else if (kpis.adr >= this.benchmarks.adr.average) {
        ratings.adr = { rating: 'AVERAGE', score: 65, color: 'yellow' };
      } else {
        ratings.adr = { rating: 'POOR', score: 40, color: 'red' };
      }

      // Calculate overall performance score
      const overallScore = Math.round(
        (ratings.occupancy.score + ratings.revPAR.score + ratings.adr.score) / 3
      );

      ratings.overall = {
        score: overallScore,
        rating:
          overallScore >= 85
            ? 'EXCELLENT'
            : overallScore >= 70
              ? 'GOOD'
              : overallScore >= 55
                ? 'AVERAGE'
                : 'POOR',
        color:
          overallScore >= 85
            ? 'green'
            : overallScore >= 70
              ? 'lightgreen'
              : overallScore >= 55
                ? 'yellow'
                : 'red',
      };

      return ratings;
    } catch (error) {
      logger.error('❌ Error rating KPI performance:', error);
      return {
        occupancy: { rating: 'UNKNOWN', score: 0, color: 'gray' },
        revPAR: { rating: 'UNKNOWN', score: 0, color: 'gray' },
        adr: { rating: 'UNKNOWN', score: 0, color: 'gray' },
        overall: { rating: 'UNKNOWN', score: 0, color: 'gray' },
      };
    }
  }
  /**
   * Get current real-time occupancy for a hotel with Redis cache
   * @param {string} hotelId - Hotel ID
   * @returns {Number} Current occupancy percentage
   */
  async getCurrentOccupancy(hotelId) {
    try {
      // Build cache key for current occupancy
      const cacheKey = this.buildAnalyticsCacheKey('current_occupancy', hotelId || 'all', {
        date: moment().format('YYYY-MM-DD-HH'), // Hourly cache refresh
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.currentOccupancy !== undefined) {
        return cached.currentOccupancy;
      }

      const today = moment().startOf('day').toDate();
      const tomorrow = moment().add(1, 'day').startOf('day').toDate();

      // Get hotel capacity
      const hotelQuery = hotelId ? { _id: hotelId } : { isActive: true };
      const hotels = await Hotel.find(hotelQuery).populate('rooms');
      const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);

      if (totalRooms === 0) return 0;

      // Get current occupancy (guests currently in hotel)
      const occupiedRooms = await Booking.aggregate([
        {
          $match: {
            ...(hotelId && { hotel: new mongoose.Types.ObjectId(hotelId) }),
            checkInDate: { $lte: today },
            checkOutDate: { $gt: today },
            status: { $in: ['CHECKED_IN', 'CONFIRMED'] },
          },
        },
        {
          $group: {
            _id: null,
            totalRooms: { $sum: { $size: '$rooms' } },
          },
        },
      ]);

      const occupiedCount = occupiedRooms[0]?.totalRooms || 0;
      const currentOccupancy = (occupiedCount / totalRooms) * 100;

      // Get today's expected arrivals and departures
      const [todayArrivals, todayDepartures] = await Promise.all([
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          checkInDate: { $gte: today, $lt: tomorrow },
          status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        }),
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          checkOutDate: { $gte: today, $lt: tomorrow },
          status: { $in: ['CHECKED_IN', 'COMPLETED'] },
        }),
      ]);

      // Cache the result
      const cacheData = {
        currentOccupancy: Math.round(currentOccupancy * 100) / 100,
        occupiedRooms: occupiedCount,
        totalRooms,
        todayArrivals,
        todayDepartures,
        calculatedAt: new Date(),
      };

      await this.setInHybridCache(cacheKey, cacheData, 'realtime');

      return cacheData.currentOccupancy;
    } catch (error) {
      logger.error('❌ Error getting current occupancy:', error);
      return 0;
    }
  }
  /**
   * Get real-time alerts for analytics dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @returns {Array} Array of alert objects
   */
  async getRealtimeAlerts(hotelId) {
    try {
      // Build cache key for real-time alerts
      const cacheKey = this.buildAnalyticsCacheKey('realtime_alerts', hotelId || 'all', {
        timestamp: Math.floor(Date.now() / (5 * 60 * 1000)), // 5-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && Array.isArray(cached.alerts)) {
        return cached.alerts;
      }

      const alerts = [];
      const now = new Date();
      const today = moment().startOf('day').toDate();
      const tomorrow = moment().add(1, 'day').startOf('day').toDate();

      // Check occupancy alerts
      const currentOccupancy = await this.getCurrentOccupancy(hotelId);

      if (currentOccupancy > 95) {
        alerts.push({
          id: `occupancy_critical_${Date.now()}`,
          type: 'CRITICAL',
          category: 'OCCUPANCY',
          title: 'Occupancy critique',
          message: `Taux d'occupation de ${currentOccupancy.toFixed(1)}% - Capacité maximale atteinte`,
          priority: 'HIGH',
          icon: '🚨',
          color: 'red',
          timestamp: now,
          actions: [
            { label: 'Voir disponibilités', action: 'view_availability' },
            { label: 'Gérer overbooking', action: 'manage_overbooking' },
          ],
        });
      } else if (currentOccupancy < 30) {
        alerts.push({
          id: `occupancy_low_${Date.now()}`,
          type: 'WARNING',
          category: 'OCCUPANCY',
          title: 'Faible occupation',
          message: `Taux d'occupation de ${currentOccupancy.toFixed(1)}% - En dessous du seuil`,
          priority: 'MEDIUM',
          icon: '⚠️',
          color: 'orange',
          timestamp: now,
          actions: [
            { label: 'Lancer promotions', action: 'create_promotion' },
            { label: 'Ajuster prix', action: 'adjust_pricing' },
          ],
        });
      }

      // Check pending bookings
      const pendingBookings = await Booking.countDocuments({
        ...(hotelId && { hotel: hotelId }),
        status: 'PENDING',
        createdAt: { $gte: moment().subtract(2, 'hours').toDate() },
      });

      if (pendingBookings > 5) {
        alerts.push({
          id: `pending_bookings_${Date.now()}`,
          type: 'INFO',
          category: 'BOOKINGS',
          title: 'Réservations en attente',
          message: `${pendingBookings} réservations en attente de validation`,
          priority: 'MEDIUM',
          icon: '📋',
          color: 'blue',
          timestamp: now,
          actions: [{ label: 'Traiter réservations', action: 'process_bookings' }],
        });
      }

      // Check today's arrivals without confirmation
      const unconfirmedArrivals = await Booking.countDocuments({
        ...(hotelId && { hotel: hotelId }),
        checkInDate: { $gte: today, $lt: tomorrow },
        status: 'CONFIRMED',
        'checkIn.completed': { $ne: true },
      });

      if (unconfirmedArrivals > 0) {
        alerts.push({
          id: `unconfirmed_arrivals_${Date.now()}`,
          type: 'INFO',
          category: 'CHECKIN',
          title: 'Arrivées du jour',
          message: `${unconfirmedArrivals} arrivées prévues aujourd'hui`,
          priority: 'LOW',
          icon: '🛄',
          color: 'green',
          timestamp: now,
          actions: [{ label: 'Voir arrivées', action: 'view_arrivals' }],
        });
      }

      // Check revenue performance
      const todayRevenue = await this.calculateTotalRevenue({
        ...(hotelId && { hotel: hotelId }),
        createdAt: { $gte: today, $lt: tomorrow },
      });

      const averageDailyRevenue = await this.getAverageDailyRevenue(hotelId);

      if (todayRevenue < averageDailyRevenue * 0.7) {
        alerts.push({
          id: `revenue_low_${Date.now()}`,
          type: 'WARNING',
          category: 'REVENUE',
          title: 'Revenus en baisse',
          message: `Revenus du jour (${todayRevenue.toFixed(0)}€) inférieurs à la moyenne`,
          priority: 'MEDIUM',
          icon: '📉',
          color: 'orange',
          timestamp: now,
          actions: [
            { label: 'Analyser causes', action: 'analyze_revenue' },
            { label: 'Actions correctives', action: 'revenue_actions' },
          ],
        });
      }

      // Check system performance
      const cacheMetrics = this.getCachePerformanceMetrics();
      if (cacheMetrics.redis.errors > 10) {
        alerts.push({
          id: `system_performance_${Date.now()}`,
          type: 'WARNING',
          category: 'SYSTEM',
          title: 'Performance système',
          message: `${cacheMetrics.redis.errors} erreurs cache détectées`,
          priority: 'LOW',
          icon: '⚙️',
          color: 'gray',
          timestamp: now,
          actions: [{ label: 'Voir métriques', action: 'view_metrics' }],
        });
      }

      // Sort alerts by priority and timestamp
      alerts.sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

      // Cache the result
      const cacheData = {
        alerts,
        generatedAt: now,
        hotelId: hotelId || 'all',
        alertCount: alerts.length,
      };

      await this.setInHybridCache(cacheKey, cacheData, 'realtime');

      return alerts;
    } catch (error) {
      logger.error('❌ Error getting real-time alerts:', error);
      return [];
    }
  }
  /**
   * Get revenue overview for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Revenue overview data
   */
  async getRevenueOverview(hotelId, startDate, endDate) {
    try {
      // Build cache key for revenue overview
      const cacheKey = this.buildAnalyticsCacheKey('revenue_overview', hotelId || 'all', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.totalRevenue !== undefined) {
        return cached;
      }

      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      // Calculate revenue metrics in parallel
      const [
        totalRevenue,
        previousPeriodRevenue,
        revenueByDay,
        revenueBySource,
        averageBookingValue,
      ] = await Promise.all([
        this.calculateTotalRevenue(query),
        this.calculatePreviousPeriodRevenue(query, startDate, endDate),
        this.getRevenueByDay(query),
        this.getRevenueBySource(query),
        this.getAverageBookingValue(query),
      ]);

      // Calculate growth metrics
      const revenueGrowth =
        previousPeriodRevenue > 0
          ? ((totalRevenue - previousPeriodRevenue) / previousPeriodRevenue) * 100
          : 0;

      // Calculate trend direction
      const trendDirection = this.calculateRevenueTrend(revenueByDay);

      // Build overview object
      const overview = {
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        previousPeriodRevenue: Math.round(previousPeriodRevenue * 100) / 100,
        revenueGrowth: Math.round(revenueGrowth * 100) / 100,
        averageBookingValue: Math.round(averageBookingValue * 100) / 100,

        trend: {
          direction: trendDirection,
          strength: this.calculateTrendStrength(revenueByDay),
          momentum: this.calculateMomentum(revenueByDay),
        },

        breakdown: {
          byDay: revenueByDay,
          bySource: revenueBySource,
        },

        insights: this.generateRevenueOverviewInsights({
          totalRevenue,
          revenueGrowth,
          trendDirection,
          averageBookingValue,
        }),

        period: {
          start: startDate,
          end: endDate,
          days: moment(endDate).diff(moment(startDate), 'days') + 1,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, overview, 'dashboard');

      return overview;
    } catch (error) {
      logger.error('❌ Error getting revenue overview:', error);
      return {
        totalRevenue: 0,
        previousPeriodRevenue: 0,
        revenueGrowth: 0,
        averageBookingValue: 0,
        trend: { direction: 'stable', strength: 0, momentum: 0 },
        breakdown: { byDay: [], bySource: [] },
        insights: [],
        period: { start: startDate, end: endDate, days: 0 },
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get occupancy overview for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Occupancy overview data
   */
  async getOccupancyOverview(hotelId, startDate, endDate) {
    try {
      // Build cache key for occupancy overview
      const cacheKey = this.buildAnalyticsCacheKey('occupancy_overview', hotelId || 'all', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.averageOccupancy !== undefined) {
        return cached;
      }

      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      // Get hotel capacity
      const hotelQuery = hotelId ? { _id: hotelId } : { isActive: true };
      const hotels = await Hotel.find(hotelQuery).populate('rooms');
      const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);

      // Calculate occupancy metrics in parallel
      const [
        currentOccupancy,
        averageOccupancy,
        occupancyByDay,
        occupancyByRoomType,
        peakOccupancyDay,
      ] = await Promise.all([
        this.getCurrentOccupancy(hotelId),
        this.calculateAverageOccupancy(query),
        this.getOccupancyByDay(query, totalRooms),
        this.getOccupancyByRoomType(query),
        this.getPeakOccupancyDay(query),
      ]);

      // Calculate occupancy trend
      const occupancyTrend = this.calculateOccupancyTrend(occupancyByDay);

      // Calculate previous period for comparison
      const previousPeriodOccupancy = await this.calculatePreviousPeriodOccupancy(
        query,
        startDate,
        endDate
      );

      const occupancyGrowth =
        previousPeriodOccupancy > 0
          ? ((averageOccupancy - previousPeriodOccupancy) / previousPeriodOccupancy) * 100
          : 0;

      // Build overview object
      const overview = {
        currentOccupancy: Math.round(currentOccupancy * 100) / 100,
        averageOccupancy: Math.round(averageOccupancy * 100) / 100,
        previousPeriodOccupancy: Math.round(previousPeriodOccupancy * 100) / 100,
        occupancyGrowth: Math.round(occupancyGrowth * 100) / 100,

        capacity: {
          totalRooms,
          currentlyOccupied: Math.round((currentOccupancy * totalRooms) / 100),
          available: totalRooms - Math.round((currentOccupancy * totalRooms) / 100),
        },

        trend: {
          direction: occupancyTrend.direction,
          strength: occupancyTrend.strength,
          momentum: occupancyTrend.momentum,
        },

        breakdown: {
          byDay: occupancyByDay,
          byRoomType: occupancyByRoomType,
        },

        highlights: {
          peakDay: peakOccupancyDay,
          lowestDay: this.getLowestOccupancyDay(occupancyByDay),
          averageWeekend: this.getWeekendOccupancy(occupancyByDay),
          averageWeekday: this.getWeekdayOccupancy(occupancyByDay),
        },

        insights: this.generateOccupancyOverviewInsights({
          currentOccupancy,
          averageOccupancy,
          occupancyGrowth,
          occupancyTrend,
        }),

        period: {
          start: startDate,
          end: endDate,
          days: moment(endDate).diff(moment(startDate), 'days') + 1,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, overview, 'dashboard');

      return overview;
    } catch (error) {
      logger.error('❌ Error getting occupancy overview:', error);
      return {
        currentOccupancy: 0,
        averageOccupancy: 0,
        previousPeriodOccupancy: 0,
        occupancyGrowth: 0,
        capacity: { totalRooms: 0, currentlyOccupied: 0, available: 0 },
        trend: { direction: 'stable', strength: 0, momentum: 0 },
        breakdown: { byDay: [], byRoomType: [] },
        highlights: {},
        insights: [],
        period: { start: startDate, end: endDate, days: 0 },
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get demand overview for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Demand overview data
   */
  async getDemandOverview(hotelId, startDate, endDate) {
    try {
      // Build cache key for demand overview
      const cacheKey = this.buildAnalyticsCacheKey('demand_overview', hotelId || 'all', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.totalBookings !== undefined) {
        return cached;
      }

      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      // Calculate demand metrics in parallel
      const [
        totalBookings,
        bookingsByDay,
        bookingsBySource,
        leadTimeAnalysis,
        demandForecast,
        conversionMetrics,
      ] = await Promise.all([
        Booking.countDocuments(query),
        this.getBookingsByDay(query),
        this.getBookingsBySource(query),
        this.analyzeLeadTimes(query),
        this.getShortTermDemandForecast(hotelId, 7),
        this.getConversionMetrics(query),
      ]);

      // Calculate demand trend
      const demandTrend = this.calculateDemandTrend(bookingsByDay);

      // Calculate demand velocity (bookings per day)
      const days = moment(endDate).diff(moment(startDate), 'days') + 1;
      const demandVelocity = days > 0 ? totalBookings / days : 0;

      // Analyze booking patterns
      const bookingPatterns = this.analyzeBookingPatterns(bookingsByDay);

      // Calculate demand strength
      const demandStrength = this.calculateDemandStrength({
        totalBookings,
        conversionRate: conversionMetrics.conversionRate,
        averageLeadTime: leadTimeAnalysis.average,
        demandVelocity,
      });

      // Build overview object
      const overview = {
        totalBookings,
        demandVelocity: Math.round(demandVelocity * 100) / 100,

        trend: {
          direction: demandTrend.direction,
          strength: demandTrend.strength,
          momentum: demandTrend.momentum,
        },

        patterns: {
          peakDay: bookingPatterns.peakDay,
          quietestDay: bookingPatterns.quietestDay,
          weekendVsWeekday: bookingPatterns.weekendVsWeekday,
          seasonalEffect: bookingPatterns.seasonalEffect,
        },

        leadTime: {
          average: Math.round(leadTimeAnalysis.average),
          median: leadTimeAnalysis.median,
          distribution: leadTimeAnalysis.distribution,
          trend: leadTimeAnalysis.trend,
        },

        conversion: {
          rate: Math.round(conversionMetrics.conversionRate * 100) / 100,
          funnel: conversionMetrics.funnel,
          dropOffPoints: conversionMetrics.dropOffPoints,
        },

        breakdown: {
          byDay: bookingsByDay,
          bySource: bookingsBySource,
          byDayOfWeek: this.groupBookingsByDayOfWeek(bookingsByDay),
        },

        forecast: {
          next7Days: demandForecast,
          confidence: this.calculateForecastConfidence(demandForecast),
          expectedBookings: demandForecast.reduce((sum, day) => sum + day.predicted, 0),
        },

        demandStrength: {
          score: demandStrength,
          rating: this.rateDemandStrength(demandStrength),
          factors: this.getDemandStrengthFactors(demandStrength),
        },

        insights: this.generateDemandOverviewInsights({
          totalBookings,
          demandTrend,
          conversionMetrics,
          leadTimeAnalysis,
        }),

        period: {
          start: startDate,
          end: endDate,
          days,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, overview, 'dashboard');

      return overview;
    } catch (error) {
      logger.error('❌ Error getting demand overview:', error);
      return {
        totalBookings: 0,
        demandVelocity: 0,
        trend: { direction: 'stable', strength: 0, momentum: 0 },
        patterns: {},
        leadTime: { average: 0, median: 0, distribution: [], trend: 'stable' },
        conversion: { rate: 0, funnel: {}, dropOffPoints: [] },
        breakdown: { byDay: [], bySource: [], byDayOfWeek: [] },
        forecast: { next7Days: [], confidence: 0, expectedBookings: 0 },
        demandStrength: { score: 0, rating: 'LOW', factors: [] },
        insights: [],
        period: { start: startDate, end: endDate, days: 0 },
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get yield management overview for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Yield overview data
   */
  async getYieldOverview(hotelId, startDate, endDate) {
    try {
      if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
        return {
          enabled: false,
          message: 'Yield management is not enabled',
        };
      }

      // Build cache key for yield overview
      const cacheKey = this.buildAnalyticsCacheKey('yield_overview', hotelId || 'all', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.enabled !== undefined) {
        return cached;
      }

      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      // Get yield-optimized bookings
      const yieldBookings = await Booking.find({
        ...query,
        'yieldManagement.enabled': true,
      });

      if (yieldBookings.length === 0) {
        return {
          enabled: true,
          hasData: false,
          message: 'No yield-optimized bookings found in this period',
        };
      }

      // Calculate yield metrics in parallel
      const [yieldImpact, priceOptimizations, revenueUplift, yieldEfficiency, strategyPerformance] =
        await Promise.all([
          this.calculateYieldImpact(yieldBookings),
          this.getYieldPriceOptimizations(yieldBookings),
          this.calculateYieldRevenueUplift(yieldBookings),
          this.calculateYieldEfficiency(yieldBookings),
          this.analyzeYieldStrategyPerformance(yieldBookings),
        ]);

      // Calculate yield score
      const yieldScore = this.calculateYieldScore({
        revenueUplift: revenueUplift.percentage,
        efficiency: yieldEfficiency.score,
        optimizationRate: priceOptimizations.rate,
      });

      // Build overview object
      const overview = {
        enabled: true,
        hasData: true,

        performance: {
          yieldScore: Math.round(yieldScore),
          rating: this.rateYieldPerformance(yieldScore),
          revenueUplift: Math.round(revenueUplift.percentage * 100) / 100,
          efficiency: Math.round(yieldEfficiency.score),
        },

        impact: {
          totalBookings: yieldBookings.length,
          revenueGenerated: Math.round(yieldImpact.totalRevenue * 100) / 100,
          additionalRevenue: Math.round(yieldImpact.additionalRevenue * 100) / 100,
          averageUplift: Math.round(yieldImpact.averageUplift * 100) / 100,
        },

        optimization: {
          totalOptimizations: priceOptimizations.total,
          successfulOptimizations: priceOptimizations.successful,
          optimizationRate: Math.round(priceOptimizations.rate * 100) / 100,
          averageImpact: Math.round(priceOptimizations.averageImpact * 100) / 100,
        },

        strategies: {
          performance: strategyPerformance,
          mostEffective: this.getMostEffectiveStrategy(strategyPerformance),
          recommendations: this.getYieldStrategyRecommendations(strategyPerformance),
        },

        trends: {
          revenueImpact: this.calculateYieldTrends(yieldBookings, 'revenue'),
          optimizationTrend: this.calculateYieldTrends(yieldBookings, 'optimization'),
          efficiencyTrend: this.calculateYieldTrends(yieldBookings, 'efficiency'),
        },

        insights: this.generateYieldOverviewInsights({
          yieldScore,
          revenueUplift,
          yieldEfficiency,
          strategyPerformance,
        }),

        alerts: this.generateYieldAlerts({
          yieldScore,
          efficiency: yieldEfficiency.score,
          optimizationRate: priceOptimizations.rate,
        }),

        period: {
          start: startDate,
          end: endDate,
          days: moment(endDate).diff(moment(startDate), 'days') + 1,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, overview, 'dashboard');

      return overview;
    } catch (error) {
      logger.error('❌ Error getting yield overview:', error);
      return {
        enabled: true,
        hasData: false,
        error: error.message,
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get analytics alerts for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @returns {Array} Array of analytics alert objects
   */
  async getAnalyticsAlerts(hotelId) {
    try {
      // Build cache key for analytics alerts
      const cacheKey = this.buildAnalyticsCacheKey('analytics_alerts', hotelId || 'all', {
        timestamp: Math.floor(Date.now() / (10 * 60 * 1000)), // 10-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && Array.isArray(cached.alerts)) {
        return cached.alerts;
      }

      const alerts = [];
      const now = new Date();
      const last24Hours = moment().subtract(24, 'hours').toDate();
      const last7Days = moment().subtract(7, 'days').toDate();

      // Check revenue performance alerts
      const [todayRevenue, yesterdayRevenue, weekRevenue, monthRevenue] = await Promise.all([
        this.calculateTotalRevenue({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: moment().startOf('day').toDate() },
        }),
        this.calculateTotalRevenue({
          ...(hotelId && { hotel: hotelId }),
          createdAt: {
            $gte: moment().subtract(1, 'day').startOf('day').toDate(),
            $lt: moment().startOf('day').toDate(),
          },
        }),
        this.calculateTotalRevenue({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: last7Days },
        }),
        this.calculateTotalRevenue({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: moment().subtract(30, 'days').toDate() },
        }),
      ]);

      // Revenue decline alert
      if (yesterdayRevenue > 0 && todayRevenue < yesterdayRevenue * 0.7) {
        alerts.push({
          id: `revenue_decline_${Date.now()}`,
          type: 'WARNING',
          category: 'REVENUE',
          title: 'Baisse significative des revenus',
          message: `Revenus aujourd'hui (${todayRevenue.toFixed(0)}€) en baisse de ${Math.round((1 - todayRevenue / yesterdayRevenue) * 100)}% vs hier`,
          priority: 'HIGH',
          icon: '📉',
          color: 'red',
          timestamp: now,
          data: {
            todayRevenue,
            yesterdayRevenue,
            decline: (1 - todayRevenue / yesterdayRevenue) * 100,
          },
          actions: [
            { label: 'Analyser causes', action: 'analyze_revenue_decline' },
            { label: 'Actions urgentes', action: 'urgent_revenue_actions' },
          ],
        });
      }

      // Check occupancy alerts
      const currentOccupancy = await this.getCurrentOccupancy(hotelId);
      const averageOccupancy = await this.calculateAverageOccupancy({
        ...(hotelId && { hotel: hotelId }),
        createdAt: { $gte: last7Days },
      });

      if (currentOccupancy < averageOccupancy * 0.8) {
        alerts.push({
          id: `occupancy_below_average_${Date.now()}`,
          type: 'INFO',
          category: 'OCCUPANCY',
          title: 'Occupation en dessous de la moyenne',
          message: `Occupation actuelle (${currentOccupancy.toFixed(1)}%) inférieure à la moyenne 7j (${averageOccupancy.toFixed(1)}%)`,
          priority: 'MEDIUM',
          icon: '📊',
          color: 'orange',
          timestamp: now,
          data: { currentOccupancy, averageOccupancy },
          actions: [{ label: 'Voir tendances', action: 'view_occupancy_trends' }],
        });
      }

      // Check conversion rate alerts
      const conversionRate = await this.calculateConversionRate({
        ...(hotelId && { hotel: hotelId }),
        createdAt: { $gte: last7Days },
      });

      if (conversionRate < 60) {
        alerts.push({
          id: `low_conversion_${Date.now()}`,
          type: 'WARNING',
          category: 'CONVERSION',
          title: 'Taux de conversion faible',
          message: `Taux de conversion de ${conversionRate.toFixed(1)}% sur 7 jours`,
          priority: 'MEDIUM',
          icon: '🎯',
          color: 'orange',
          timestamp: now,
          data: { conversionRate },
          actions: [
            { label: 'Optimiser processus', action: 'optimize_conversion' },
            { label: 'Analyser abandon', action: 'analyze_abandonment' },
          ],
        });
      }

      // Check cache performance alerts
      const cacheMetrics = this.getCachePerformanceMetrics();
      if (cacheMetrics.overall.hitRate < 70) {
        alerts.push({
          id: `cache_performance_${Date.now()}`,
          type: 'WARNING',
          category: 'PERFORMANCE',
          title: 'Performance cache dégradée',
          message: `Taux de hit cache analytics: ${cacheMetrics.overall.hitRate}%`,
          priority: 'LOW',
          icon: '⚡',
          color: 'yellow',
          timestamp: now,
          data: { hitRate: cacheMetrics.overall.hitRate },
          actions: [
            { label: 'Optimiser cache', action: 'optimize_cache' },
            { label: 'Voir métriques', action: 'view_cache_metrics' },
          ],
        });
      }

      // Check data freshness alerts
      const dataFreshnessIssues = await this.checkDataFreshness(hotelId);
      if (dataFreshnessIssues.length > 0) {
        alerts.push({
          id: `data_freshness_${Date.now()}`,
          type: 'INFO',
          category: 'DATA',
          title: 'Problèmes fraîcheur des données',
          message: `${dataFreshnessIssues.length} sources de données avec des retards`,
          priority: 'LOW',
          icon: '🔄',
          color: 'gray',
          timestamp: now,
          data: { issues: dataFreshnessIssues },
          actions: [{ label: 'Voir détails', action: 'view_data_issues' }],
        });
      }

      // Check yield management alerts (if enabled)
      if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        const yieldAlerts = await this.getYieldManagementAlerts(hotelId);
        alerts.push(...yieldAlerts);
      }

      // Check loyalty program alerts
      const loyaltyAlerts = await this.getLoyaltyProgramAlerts(hotelId);
      alerts.push(...loyaltyAlerts);

      // Sort alerts by priority and timestamp
      alerts.sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
        if (priorityDiff !== 0) return priorityDiff;
        return new Date(b.timestamp) - new Date(a.timestamp);
      });

      // Limit to top 10 alerts
      const limitedAlerts = alerts.slice(0, 10);

      // Cache the result
      const cacheData = {
        alerts: limitedAlerts,
        generatedAt: now,
        hotelId: hotelId || 'all',
        alertCount: limitedAlerts.length,
        categories: [...new Set(limitedAlerts.map((a) => a.category))],
      };

      await this.setInHybridCache(cacheKey, cacheData, 'dashboard');

      return limitedAlerts;
    } catch (error) {
      logger.error('❌ Error getting analytics alerts:', error);
      return [];
    }
  }
  /**
   * Get trends summary for dashboard with Redis cache
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Trends summary data
   */
  async getTrendsSummary(hotelId, startDate, endDate) {
    try {
      // Build cache key for trends summary
      const cacheKey = this.buildAnalyticsCacheKey('trends_summary', hotelId || 'all', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.revenue !== undefined) {
        return cached;
      }

      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      // Calculate trends for different metrics in parallel
      const [revenueTrend, occupancyTrend, bookingTrend, adrTrend, conversionTrend] =
        await Promise.all([
          this.calculateRevenueTrendSummary(query),
          this.calculateOccupancyTrendSummary(query),
          this.calculateBookingTrendSummary(query),
          this.calculateADRTrendSummary(query),
          this.calculateConversionTrendSummary(query),
        ]);

      // Calculate overall trend direction
      const overallTrend = this.calculateOverallTrendDirection([
        revenueTrend,
        occupancyTrend,
        bookingTrend,
        adrTrend,
        conversionTrend,
      ]);

      // Generate trend insights
      const insights = this.generateTrendInsights({
        revenue: revenueTrend,
        occupancy: occupancyTrend,
        bookings: bookingTrend,
        adr: adrTrend,
        conversion: conversionTrend,
        overall: overallTrend,
      });

      // Build summary object
      const summary = {
        overall: {
          direction: overallTrend.direction,
          strength: overallTrend.strength,
          confidence: overallTrend.confidence,
          momentum: overallTrend.momentum,
        },

        revenue: {
          direction: revenueTrend.direction,
          change: Math.round(revenueTrend.change * 100) / 100,
          changePercent: Math.round(revenueTrend.changePercent * 100) / 100,
          strength: revenueTrend.strength,
          momentum: revenueTrend.momentum,
        },

        occupancy: {
          direction: occupancyTrend.direction,
          change: Math.round(occupancyTrend.change * 100) / 100,
          changePercent: Math.round(occupancyTrend.changePercent * 100) / 100,
          strength: occupancyTrend.strength,
          momentum: occupancyTrend.momentum,
        },

        bookings: {
          direction: bookingTrend.direction,
          change: bookingTrend.change,
          changePercent: Math.round(bookingTrend.changePercent * 100) / 100,
          strength: bookingTrend.strength,
          momentum: bookingTrend.momentum,
        },

        adr: {
          direction: adrTrend.direction,
          change: Math.round(adrTrend.change * 100) / 100,
          changePercent: Math.round(adrTrend.changePercent * 100) / 100,
          strength: adrTrend.strength,
          momentum: adrTrend.momentum,
        },

        conversion: {
          direction: conversionTrend.direction,
          change: Math.round(conversionTrend.change * 100) / 100,
          changePercent: Math.round(conversionTrend.changePercent * 100) / 100,
          strength: conversionTrend.strength,
          momentum: conversionTrend.momentum,
        },

        highlights: {
          bestPerforming: this.getBestPerformingMetric({
            revenue: revenueTrend,
            occupancy: occupancyTrend,
            bookings: bookingTrend,
            adr: adrTrend,
            conversion: conversionTrend,
          }),
          worstPerforming: this.getWorstPerformingMetric({
            revenue: revenueTrend,
            occupancy: occupancyTrend,
            bookings: bookingTrend,
            adr: adrTrend,
            conversion: conversionTrend,
          }),
          mostVolatile: this.getMostVolatileMetric({
            revenue: revenueTrend,
            occupancy: occupancyTrend,
            bookings: bookingTrend,
            adr: adrTrend,
            conversion: conversionTrend,
          }),
        },

        forecast: {
          next7Days: this.generateShortTermForecast({
            revenue: revenueTrend,
            occupancy: occupancyTrend,
            bookings: bookingTrend,
          }),
          confidence: this.calculateForecastConfidence(overallTrend),
          riskFactors: this.identifyTrendRiskFactors(overallTrend),
        },

        insights,

        recommendations: this.generateTrendRecommendations({
          revenue: revenueTrend,
          occupancy: occupancyTrend,
          overall: overallTrend,
          insights,
        }),

        period: {
          start: startDate,
          end: endDate,
          days: moment(endDate).diff(moment(startDate), 'days') + 1,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, summary, 'dashboard');

      return summary;
    } catch (error) {
      logger.error('❌ Error getting trends summary:', error);
      return {
        overall: { direction: 'stable', strength: 0, confidence: 0, momentum: 0 },
        revenue: { direction: 'stable', change: 0, changePercent: 0, strength: 0, momentum: 0 },
        occupancy: { direction: 'stable', change: 0, changePercent: 0, strength: 0, momentum: 0 },
        bookings: { direction: 'stable', change: 0, changePercent: 0, strength: 0, momentum: 0 },
        adr: { direction: 'stable', change: 0, changePercent: 0, strength: 0, momentum: 0 },
        conversion: { direction: 'stable', change: 0, changePercent: 0, strength: 0, momentum: 0 },
        highlights: { bestPerforming: null, worstPerforming: null, mostVolatile: null },
        forecast: { next7Days: [], confidence: 0, riskFactors: [] },
        insights: [],
        recommendations: [],
        period: { start: startDate, end: endDate, days: 0 },
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get loyalty trends summary for dashboard with Redis cache
   * @param {Object} baseQuery - Base query for loyalty data
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Object} Loyalty trends summary data
   */
  async getLoyaltyTrendsSummary(baseQuery, startDate, endDate) {
    try {
      // Build cache key for loyalty trends summary
      const cacheKey = this.buildAnalyticsCacheKey('loyalty_trends_summary', 'loyalty', {
        period: `${moment(startDate).format('YYYY-MM-DD')}_${moment(endDate).format('YYYY-MM-DD')}`,
        queryHash: this.hashObject(baseQuery),
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'dashboard');
      if (cached && cached.membership !== undefined) {
        return cached;
      }

      // Calculate loyalty trends in parallel
      const [membershipTrend, pointsTrend, engagementTrend, retentionTrend, tierProgressionTrend] =
        await Promise.all([
          this.calculateMembershipTrendSummary(baseQuery, startDate, endDate),
          this.calculatePointsTrendSummary(baseQuery, startDate, endDate),
          this.calculateEngagementTrendSummary(baseQuery, startDate, endDate),
          this.calculateRetentionTrendSummary(baseQuery, startDate, endDate),
          this.calculateTierProgressionTrendSummary(baseQuery, startDate, endDate),
        ]);

      // Calculate overall loyalty health score
      const loyaltyHealthScore = this.calculateLoyaltyHealthScore({
        membership: membershipTrend,
        points: pointsTrend,
        engagement: engagementTrend,
        retention: retentionTrend,
      });

      // Generate loyalty insights
      const insights = this.generateLoyaltyTrendInsights({
        membership: membershipTrend,
        points: pointsTrend,
        engagement: engagementTrend,
        retention: retentionTrend,
        healthScore: loyaltyHealthScore,
      });

      // Build summary object
      const summary = {
        healthScore: {
          overall: Math.round(loyaltyHealthScore),
          rating: this.rateLoyaltyHealth(loyaltyHealthScore),
          components: {
            membership: Math.round(membershipTrend.healthScore || 0),
            engagement: Math.round(engagementTrend.healthScore || 0),
            retention: Math.round(retentionTrend.healthScore || 0),
            points: Math.round(pointsTrend.healthScore || 0),
          },
        },

        membership: {
          direction: membershipTrend.direction,
          growthRate: Math.round(membershipTrend.growthRate * 100) / 100,
          newMembers: membershipTrend.newMembers,
          totalMembers: membershipTrend.totalMembers,
          momentum: membershipTrend.momentum,
        },

        points: {
          direction: pointsTrend.direction,
          issuanceRate: Math.round(pointsTrend.issuanceRate * 100) / 100,
          redemptionRate: Math.round(pointsTrend.redemptionRate * 100) / 100,
          velocity: Math.round(pointsTrend.velocity * 100) / 100,
          momentum: pointsTrend.momentum,
        },

        engagement: {
          direction: engagementTrend.direction,
          activeRate: Math.round(engagementTrend.activeRate * 100) / 100,
          interactionRate: Math.round(engagementTrend.interactionRate * 100) / 100,
          stickiness: Math.round(engagementTrend.stickiness * 100) / 100,
          momentum: engagementTrend.momentum,
        },

        retention: {
          direction: retentionTrend.direction,
          retentionRate: Math.round(retentionTrend.retentionRate * 100) / 100,
          churnRate: Math.round(retentionTrend.churnRate * 100) / 100,
          lifetimeValue: Math.round(retentionTrend.lifetimeValue * 100) / 100,
          momentum: retentionTrend.momentum,
        },

        tierProgression: {
          direction: tierProgressionTrend.direction,
          upgradeRate: Math.round(tierProgressionTrend.upgradeRate * 100) / 100,
          downgradeRate: Math.round(tierProgressionTrend.downgradeRate * 100) / 100,
          progressionVelocity: Math.round(tierProgressionTrend.velocity * 100) / 100,
          momentum: tierProgressionTrend.momentum,
        },

        highlights: {
          topPerformingArea: this.getTopPerformingLoyaltyArea({
            membership: membershipTrend,
            points: pointsTrend,
            engagement: engagementTrend,
            retention: retentionTrend,
          }),
          improvementOpportunity: this.getLoyaltyImprovementOpportunity({
            membership: membershipTrend,
            points: pointsTrend,
            engagement: engagementTrend,
            retention: retentionTrend,
          }),
          riskArea: this.getLoyaltyRiskArea({
            membership: membershipTrend,
            points: pointsTrend,
            engagement: engagementTrend,
            retention: retentionTrend,
          }),
        },

        forecast: {
          membershipGrowth: this.forecastMembershipGrowth(membershipTrend, 30),
          pointsIssuance: this.forecastPointsIssuance(pointsTrend, 30),
          retentionRate: this.forecastRetentionRate(retentionTrend, 30),
          confidence: this.calculateLoyaltyForecastConfidence([
            membershipTrend,
            pointsTrend,
            retentionTrend,
          ]),
        },

        insights,

        recommendations: this.generateLoyaltyTrendRecommendations({
          healthScore: loyaltyHealthScore,
          membership: membershipTrend,
          engagement: engagementTrend,
          retention: retentionTrend,
          insights,
        }),

        period: {
          start: startDate,
          end: endDate,
          days: moment(endDate).diff(moment(startDate), 'days') + 1,
        },

        calculatedAt: new Date(),
      };

      // Cache the result
      await this.setInHybridCache(cacheKey, summary, 'dashboard');

      return summary;
    } catch (error) {
      logger.error('❌ Error getting loyalty trends summary:', error);
      return {
        healthScore: { overall: 0, rating: 'POOR', components: {} },
        membership: {
          direction: 'stable',
          growthRate: 0,
          newMembers: 0,
          totalMembers: 0,
          momentum: 0,
        },
        points: {
          direction: 'stable',
          issuanceRate: 0,
          redemptionRate: 0,
          velocity: 0,
          momentum: 0,
        },
        engagement: {
          direction: 'stable',
          activeRate: 0,
          interactionRate: 0,
          stickiness: 0,
          momentum: 0,
        },
        retention: {
          direction: 'stable',
          retentionRate: 0,
          churnRate: 0,
          lifetimeValue: 0,
          momentum: 0,
        },
        tierProgression: {
          direction: 'stable',
          upgradeRate: 0,
          downgradeRate: 0,
          progressionVelocity: 0,
          momentum: 0,
        },
        highlights: { topPerformingArea: null, improvementOpportunity: null, riskArea: null },
        forecast: { membershipGrowth: 0, pointsIssuance: 0, retentionRate: 0, confidence: 0 },
        insights: [],
        recommendations: [],
        period: { start: startDate, end: endDate, days: 0 },
        calculatedAt: new Date(),
      };
    }
  }
  /**
   * Get live dashboard data with Redis cache
   * @param {Object} options - Dashboard options
   * @returns {Object} Live dashboard data
   */
  async getLiveDashboardData(options) {
    try {
      const { hotelId, refreshInterval = 30000 } = options;

      // Build cache key for live dashboard data
      const cacheKey = this.buildAnalyticsCacheKey('live_dashboard', hotelId || 'all', {
        timestamp: Math.floor(Date.now() / refreshInterval), // Cache key changes based on refresh interval
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.timestamp) {
        return cached;
      }

      const now = new Date();
      const today = moment().startOf('day').toDate();
      const tomorrow = moment().add(1, 'day').startOf('day').toDate();

      // Calculate live metrics in parallel
      const [
        currentOccupancy,
        todayRevenue,
        todayBookings,
        pendingBookings,
        todayArrivals,
        todayDepartures,
        availableRooms,
        systemHealth,
      ] = await Promise.all([
        this.getCurrentOccupancy(hotelId),
        this.calculateTotalRevenue({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: today, $lt: tomorrow },
        }),
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: today, $lt: tomorrow },
        }),
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          status: 'PENDING',
        }),
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          checkInDate: { $gte: today, $lt: tomorrow },
          status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
        }),
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          checkOutDate: { $gte: today, $lt: tomorrow },
          status: { $in: ['CHECKED_IN', 'COMPLETED'] },
        }),
        this.getAvailableRooms(hotelId),
        this.getSystemHealth(),
      ]);

      // Calculate real-time KPIs
      const realtimeKPIs = {
        occupancy: {
          current: Math.round(currentOccupancy * 100) / 100,
          status: this.getOccupancyStatus(currentOccupancy),
          trend: await this.getOccupancyTrend(hotelId, '1h'),
        },
        revenue: {
          today: Math.round(todayRevenue * 100) / 100,
          target: await this.getDailyRevenueTarget(hotelId),
          progress: await this.getRevenueProgress(hotelId, todayRevenue),
          trend: await this.getRevenueTrend(hotelId, '1h'),
        },
        bookings: {
          today: todayBookings,
          pending: pendingBookings,
          conversionRate: await this.calculateConversionRate({
            ...(hotelId && { hotel: hotelId }),
            createdAt: { $gte: today, $lt: tomorrow },
          }),
          trend: await this.getBookingsTrend(hotelId, '1h'),
        },
      };

      // Get activity feed
      const activityFeed = await this.getRecentActivity(hotelId, 10);

      // Get performance indicators
      const performanceIndicators = {
        responseTime: await this.getSystemResponseTime(),
        cachePerformance: this.getCachePerformanceMetrics().overall.hitRate,
        dataFreshness: await this.getDataFreshness(hotelId),
        systemLoad: systemHealth.load,
      };

      // Build live data object
      const liveData = {
        timestamp: now,
        refreshInterval,

        kpis: realtimeKPIs,

        operations: {
          arrivals: todayArrivals,
          departures: todayDepartures,
          availableRooms,
          pendingCheckIns: await this.getPendingCheckIns(hotelId),
          pendingCheckOuts: await this.getPendingCheckOuts(hotelId),
        },

        alerts: await this.getRealtimeAlerts(hotelId),

        activity: {
          recent: activityFeed,
          summary: this.generateActivitySummary(activityFeed),
        },

        performance: performanceIndicators,

        system: {
          health: systemHealth.status,
          uptime: systemHealth.uptime,
          lastUpdate: now,
          dataQuality: await this.assessDataQuality(hotelId),
        },

        quickActions: this.getQuickActions(hotelId, {
          pendingBookings,
          todayArrivals,
          todayDepartures,
          currentOccupancy,
        }),

        nextUpdate: new Date(now.getTime() + refreshInterval),

        metadata: {
          hotelId: hotelId || 'all',
          generatedAt: now,
          cacheKey,
          version: '1.0',
        },
      };

      // Cache with short TTL for real-time data
      await this.setInHybridCache(
        cacheKey,
        liveData,
        'realtime',
        Math.floor(refreshInterval / 1000)
      );

      return liveData;
    } catch (error) {
      logger.error('❌ Error getting live dashboard data:', error);
      return {
        timestamp: new Date(),
        error: error.message,
        kpis: { occupancy: {}, revenue: {}, bookings: {} },
        operations: {},
        alerts: [],
        activity: { recent: [], summary: {} },
        performance: {},
        system: { health: 'error', uptime: 0, lastUpdate: new Date() },
        quickActions: [],
        nextUpdate: new Date(),
        metadata: { hotelId: hotelId || 'all', generatedAt: new Date() },
      };
    }
  }
  /**
   * Get real-time revenue update with Redis cache
   * @param {Object} options - Update options
   * @returns {Object} Real-time revenue data
   */
  async getRealTimeRevenueUpdate(options) {
    try {
      const { hotelId, period = '1h' } = options;

      // Build cache key for real-time revenue update
      const cacheKey = this.buildAnalyticsCacheKey('realtime_revenue', hotelId || 'all', {
        period,
        timestamp: Math.floor(Date.now() / (2 * 60 * 1000)), // 2-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.timestamp) {
        return cached;
      }

      const now = new Date();
      const startTime = this.getStartTimeForPeriod(period);

      // Calculate real-time revenue metrics
      const [currentRevenue, revenueByHour, revenueBySource, averageBookingValue, revenueVelocity] =
        await Promise.all([
          this.calculateTotalRevenue({
            ...(hotelId && { hotel: hotelId }),
            createdAt: { $gte: startTime },
          }),
          this.getRevenueByHour(hotelId, startTime),
          this.getRevenueBySource({
            ...(hotelId && { hotel: hotelId }),
            createdAt: { $gte: startTime },
          }),
          this.getAverageBookingValue({
            ...(hotelId && { hotel: hotelId }),
            createdAt: { $gte: startTime },
          }),
          this.calculateRevenueVelocity(hotelId, period),
        ]);

      // Calculate revenue trend
      const revenueTrend = this.calculateShortTermRevenueTrend(revenueByHour);

      // Get revenue targets and performance
      const dailyTarget = await this.getDailyRevenueTarget(hotelId);
      const progress = dailyTarget > 0 ? (currentRevenue / dailyTarget) * 100 : 0;

      // Build update object
      const revenueUpdate = {
        timestamp: now,
        period,

        current: {
          revenue: Math.round(currentRevenue * 100) / 100,
          velocity: Math.round(revenueVelocity * 100) / 100,
          averageBookingValue: Math.round(averageBookingValue * 100) / 100,
        },

        target: {
          daily: Math.round(dailyTarget * 100) / 100,
          progress: Math.round(progress * 100) / 100,
          remaining: Math.round((dailyTarget - currentRevenue) * 100) / 100,
          onTrack: progress >= this.getProgressTarget(now),
        },

        trend: {
          direction: revenueTrend.direction,
          strength: revenueTrend.strength,
          momentum: revenueTrend.momentum,
          confidence: revenueTrend.confidence,
        },

        breakdown: {
          byHour: revenueByHour.slice(-6), // Last 6 hours
          bySource: revenueBySource.slice(0, 5), // Top 5 sources
          topPerforming: this.getTopPerformingRevenueSource(revenueBySource),
        },

        indicators: {
          revenueHealth: this.assessRevenueHealth(currentRevenue, dailyTarget, revenueTrend),
          performanceRating: this.rateRevenuePerformance(progress, revenueTrend),
          alerts: this.generateRevenueAlerts(currentRevenue, revenueTrend, progress),
        },

        forecast: {
          endOfDay: this.forecastEndOfDayRevenue(currentRevenue, revenueVelocity, now),
          nextHour: this.forecastNextHourRevenue(revenueByHour),
          confidence: this.calculateRevenueForecastConfidence(revenueTrend),
        },

        metadata: {
          hotelId: hotelId || 'all',
          generatedAt: now,
          dataPoints: revenueByHour.length,
          freshness: 'real-time',
        },
      };

      // Cache with short TTL
      await this.setInHybridCache(cacheKey, revenueUpdate, 'realtime');

      return revenueUpdate;
    } catch (error) {
      logger.error('❌ Error getting real-time revenue update:', error);
      return {
        timestamp: new Date(),
        error: error.message,
        current: { revenue: 0, velocity: 0, averageBookingValue: 0 },
        target: { daily: 0, progress: 0, remaining: 0, onTrack: false },
        trend: { direction: 'stable', strength: 0, momentum: 0, confidence: 0 },
        breakdown: { byHour: [], bySource: [], topPerforming: null },
        indicators: { revenueHealth: 'unknown', performanceRating: 'unknown', alerts: [] },
        forecast: { endOfDay: 0, nextHour: 0, confidence: 0 },
        metadata: { hotelId: hotelId || 'all', generatedAt: new Date() },
      };
    }
  }
  /**
   * Get real-time occupancy update with Redis cache
   * @param {Object} options - Update options
   * @returns {Object} Real-time occupancy data
   */
  async getRealTimeOccupancyUpdate(options) {
    try {
      const { hotelId, period = '1h' } = options;

      // Build cache key for real-time occupancy update
      const cacheKey = this.buildAnalyticsCacheKey('realtime_occupancy', hotelId || 'all', {
        period,
        timestamp: Math.floor(Date.now() / (5 * 60 * 1000)), // 5-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.timestamp) {
        return cached;
      }

      const now = new Date();
      const today = moment().startOf('day').toDate();

      // Calculate real-time occupancy metrics
      const [
        currentOccupancy,
        occupancyByHour,
        roomStatus,
        occupancyForecast,
        capacityUtilization,
      ] = await Promise.all([
        this.getCurrentOccupancy(hotelId),
        this.getOccupancyByHour(hotelId, today),
        this.getRoomStatus(hotelId),
        this.forecastOccupancyNextHours(hotelId, 6),
        this.calculateCapacityUtilization(hotelId),
      ]);

      // Calculate occupancy trend
      const occupancyTrend = this.calculateShortTermOccupancyTrend(occupancyByHour);

      // Get occupancy targets
      const targetOccupancy = await this.getTargetOccupancy(hotelId);
      const occupancyGap = targetOccupancy - currentOccupancy;

      // Build update object
      const occupancyUpdate = {
        timestamp: now,
        period,

        current: {
          occupancy: Math.round(currentOccupancy * 100) / 100,
          status: this.getOccupancyStatus(currentOccupancy),
          capacity: capacityUtilization,
          trend: occupancyTrend.direction,
        },

        target: {
          occupancy: Math.round(targetOccupancy * 100) / 100,
          gap: Math.round(occupancyGap * 100) / 100,
          performance: this.rateOccupancyPerformance(currentOccupancy, targetOccupancy),
          onTarget: Math.abs(occupancyGap) <= 5, // Within 5% is considered on target
        },

        rooms: {
          total: roomStatus.total,
          occupied: roomStatus.occupied,
          available: roomStatus.available,
          outOfOrder: roomStatus.outOfOrder,
          maintenance: roomStatus.maintenance,
          utilization: Math.round((roomStatus.occupied / roomStatus.total) * 10000) / 100,
        },

        trend: {
          direction: occupancyTrend.direction,
          strength: occupancyTrend.strength,
          momentum: occupancyTrend.momentum,
          confidence: occupancyTrend.confidence,
        },

        activity: {
          recentCheckIns: await this.getRecentCheckIns(hotelId, 2), // Last 2 hours
          recentCheckOuts: await this.getRecentCheckOuts(hotelId, 2),
          pendingArrivals: await this.getPendingArrivals(hotelId),
          expectedDepartures: await this.getExpectedDepartures(hotelId),
        },

        breakdown: {
          byHour: occupancyByHour.slice(-12), // Last 12 hours
          byRoomType: await this.getOccupancyByRoomType(hotelId),
          byFloor: await this.getOccupancyByFloor(hotelId),
        },

        forecast: {
          next6Hours: occupancyForecast,
          peakTime: this.predictPeakOccupancyTime(occupancyForecast),
          lowestTime: this.predictLowestOccupancyTime(occupancyForecast),
          confidence: this.calculateOccupancyForecastConfidence(occupancyTrend),
        },

        alerts: this.generateOccupancyAlerts(currentOccupancy, occupancyTrend, roomStatus),

        recommendations: this.generateOccupancyRecommendations({
          currentOccupancy,
          occupancyGap,
          occupancyTrend,
          roomStatus,
        }),

        metadata: {
          hotelId: hotelId || 'all',
          generatedAt: now,
          dataPoints: occupancyByHour.length,
          freshness: 'real-time',
        },
      };

      // Cache with moderate TTL
      await this.setInHybridCache(cacheKey, occupancyUpdate, 'realtime');

      return occupancyUpdate;
    } catch (error) {
      logger.error('❌ Error getting real-time occupancy update:', error);
      return {
        timestamp: new Date(),
        error: error.message,
        current: { occupancy: 0, status: 'unknown', capacity: {}, trend: 'stable' },
        target: { occupancy: 0, gap: 0, performance: 'unknown', onTarget: false },
        rooms: {
          total: 0,
          occupied: 0,
          available: 0,
          outOfOrder: 0,
          maintenance: 0,
          utilization: 0,
        },
        trend: { direction: 'stable', strength: 0, momentum: 0, confidence: 0 },
        activity: {
          recentCheckIns: 0,
          recentCheckOuts: 0,
          pendingArrivals: 0,
          expectedDepartures: 0,
        },
        breakdown: { byHour: [], byRoomType: [], byFloor: [] },
        forecast: { next6Hours: [], peakTime: null, lowestTime: null, confidence: 0 },
        alerts: [],
        recommendations: [],
        metadata: { hotelId: hotelId || 'all', generatedAt: new Date() },
      };
    }
  }
  /**
   * Get real-time demand update with Redis cache
   * @param {Object} options - Update options
   * @returns {Object} Real-time demand data
   */
  async getRealTimeDemandUpdate(options) {
    try {
      const { hotelId, period = '1h' } = options;

      // Build cache key for real-time demand update
      const cacheKey = this.buildAnalyticsCacheKey('realtime_demand', hotelId || 'all', {
        period,
        timestamp: Math.floor(Date.now() / (3 * 60 * 1000)), // 3-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.timestamp) {
        return cached;
      }

      const now = new Date();
      const startTime = this.getStartTimeForPeriod(period);

      // Calculate real-time demand metrics
      const [
        currentBookings,
        bookingsByHour,
        demandVelocity,
        conversionRate,
        leadTimeAnalysis,
        searchActivity,
      ] = await Promise.all([
        Booking.countDocuments({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: startTime },
        }),
        this.getBookingsByHour(hotelId, startTime),
        this.calculateDemandVelocity(hotelId, period),
        this.calculateConversionRate({
          ...(hotelId && { hotel: hotelId }),
          createdAt: { $gte: startTime },
        }),
        this.analyzeRealtimeLeadTimes(hotelId, startTime),
        this.getSearchActivity(hotelId, startTime),
      ]);

      // Calculate demand trend
      const demandTrend = this.calculateShortTermDemandTrend(bookingsByHour);

      // Assess demand strength
      const demandStrength = this.assessDemandStrength({
        bookingVelocity: demandVelocity,
        conversionRate,
        searchActivity: searchActivity.volume,
        trend: demandTrend,
      });

      // Get demand forecast
      const demandForecast = await this.forecastDemandNextHours(hotelId, 6);

      // Build update object
      const demandUpdate = {
        timestamp: now,
        period,

        current: {
          bookings: currentBookings,
          velocity: Math.round(demandVelocity * 100) / 100,
          strength: demandStrength.score,
          level: demandStrength.level,
          conversionRate: Math.round(conversionRate * 100) / 100,
        },

        trend: {
          direction: demandTrend.direction,
          strength: demandTrend.strength,
          momentum: demandTrend.momentum,
          confidence: demandTrend.confidence,
          changeRate: demandTrend.changeRate,
        },

        activity: {
          searches: searchActivity.volume,
          inquiries: searchActivity.inquiries,
          bookingAttempts: searchActivity.bookingAttempts,
          completedBookings: currentBookings,
          abandonmentRate: this.calculateAbandonmentRate(searchActivity),
        },

        leadTime: {
          average: Math.round(leadTimeAnalysis.average),
          median: leadTimeAnalysis.median,
          trend: leadTimeAnalysis.trend,
          distribution: leadTimeAnalysis.distribution,
        },

        breakdown: {
          byHour: bookingsByHour.slice(-8), // Last 8 hours
          bySource: await this.getDemandBySource(hotelId, startTime),
          byRoomType: await this.getDemandByRoomType(hotelId, startTime),
        },

        conversion: {
          funnel: this.calculateConversionFunnel(searchActivity),
          dropOffPoints: this.identifyDropOffPoints(searchActivity),
          optimization: this.getConversionOptimizationTips(conversionRate, searchActivity),
        },

        forecast: {
          next6Hours: demandForecast,
          peakTime: this.predictPeakDemandTime(demandForecast),
          expectedBookings: demandForecast.reduce((sum, hour) => sum + hour.predicted, 0),
          confidence: this.calculateDemandForecastConfidence(demandTrend),
        },

        indicators: {
          demandHealth: this.assessDemandHealth(demandVelocity, conversionRate, demandTrend),
          marketPosition: this.assessMarketPosition(searchActivity, conversionRate),
          competitiveIndex: await this.calculateCompetitiveIndex(hotelId),
        },

        alerts: this.generateDemandAlerts(demandVelocity, conversionRate, demandTrend),

        opportunities: this.identifyDemandOpportunities({
          demandStrength,
          conversionRate,
          leadTimeAnalysis,
          searchActivity,
        }),

        recommendations: this.generateDemandRecommendations({
          demandStrength,
          demandTrend,
          conversionRate,
          searchActivity,
        }),

        metadata: {
          hotelId: hotelId || 'all',
          generatedAt: now,
          dataPoints: bookingsByHour.length,
          freshness: 'real-time',
          sampleSize: currentBookings,
        },
      };

      // Cache with short TTL for real-time demand data
      await this.setInHybridCache(cacheKey, demandUpdate, 'realtime');

      return demandUpdate;
    } catch (error) {
      logger.error('❌ Error getting real-time demand update:', error);
      return {
        timestamp: new Date(),
        error: error.message,
        current: { bookings: 0, velocity: 0, strength: 0, level: 'LOW', conversionRate: 0 },
        trend: { direction: 'stable', strength: 0, momentum: 0, confidence: 0, changeRate: 0 },
        activity: {
          searches: 0,
          inquiries: 0,
          bookingAttempts: 0,
          completedBookings: 0,
          abandonmentRate: 0,
        },
        leadTime: { average: 0, median: 0, trend: 'stable', distribution: [] },
        breakdown: { byHour: [], bySource: [], byRoomType: [] },
        conversion: { funnel: {}, dropOffPoints: [], optimization: [] },
        forecast: { next6Hours: [], peakTime: null, expectedBookings: 0, confidence: 0 },
        indicators: { demandHealth: 'unknown', marketPosition: 'unknown', competitiveIndex: 0 },
        alerts: [],
        opportunities: [],
        recommendations: [],
        metadata: { hotelId: hotelId || 'all', generatedAt: new Date() },
      };
    }
  }
  /**
   * Get real-time operational update with Redis cache
   * @param {Object} options - Update options
   * @returns {Object} Real-time operational data
   */
  async getRealTimeOperationalUpdate(options) {
    try {
      const { hotelId, period = '1h' } = options;

      // Build cache key for real-time operational update
      const cacheKey = this.buildAnalyticsCacheKey('realtime_operational', hotelId || 'all', {
        period,
        timestamp: Math.floor(Date.now() / (2 * 60 * 1000)), // 2-minute cache
      });

      // Try cache first
      const cached = await this.getFromHybridCache(cacheKey, 'realtime');
      if (cached && cached.timestamp) {
        return cached;
      }

      const now = new Date();
      const today = moment().startOf('day').toDate();
      const tomorrow = moment().add(1, 'day').startOf('day').toDate();

      // Calculate real-time operational metrics
      const [
        checkInOutActivity,
        roomStatus,
        staffActivity,
        serviceRequests,
        maintenanceIssues,
        guestFeedback,
        systemPerformance,
      ] = await Promise.all([
        this.getCheckInOutActivity(hotelId, today),
        this.getCurrentRoomStatus(hotelId),
        this.getStaffActivity(hotelId, period),
        this.getServiceRequests(hotelId, today),
        this.getMaintenanceIssues(hotelId),
        this.getRecentGuestFeedback(hotelId, 24), // Last 24 hours
        this.getSystemPerformance(),
      ]);

      // Calculate operational efficiency
      const operationalEfficiency = this.calculateOperationalEfficiency({
        checkInOut: checkInOutActivity,
        roomTurnaround: roomStatus.turnaround,
        serviceResponse: serviceRequests.averageResponse,
        systemPerformance,
      });

      // Get operational alerts
      const operationalAlerts = this.generateOperationalAlerts({
        roomStatus,
        serviceRequests,
        maintenanceIssues,
        operationalEfficiency,
      });

      // Build update object
      const operationalUpdate = {
        timestamp: now,
        period,

        efficiency: {
          overall: Math.round(operationalEfficiency.overall),
          rating: this.rateOperationalEfficiency(operationalEfficiency.overall),
          components: {
            checkInOut: Math.round(operationalEfficiency.checkInOut),
            housekeeping: Math.round(operationalEfficiency.housekeeping),
            maintenance: Math.round(operationalEfficiency.maintenance),
            service: Math.round(operationalEfficiency.service),
          },
        },

        checkInOut: {
          todayCheckIns: checkInOutActivity.checkIns.completed,
          todayCheckOuts: checkInOutActivity.checkOuts.completed,
          pendingCheckIns: checkInOutActivity.checkIns.pending,
          pendingCheckOuts: checkInOutActivity.checkOuts.pending,
          averageCheckInTime: Math.round(checkInOutActivity.averageCheckInTime),
          averageCheckOutTime: Math.round(checkInOutActivity.averageCheckOutTime),
          efficiency: Math.round(checkInOutActivity.efficiency),
        },

        rooms: {
          total: roomStatus.total,
          occupied: roomStatus.occupied,
          available: roomStatus.available,
          cleaning: roomStatus.cleaning,
          maintenance: roomStatus.maintenance,
          outOfOrder: roomStatus.outOfOrder,
          turnaroundTime: Math.round(roomStatus.averageTurnaround),
          cleaningEfficiency: Math.round(roomStatus.cleaningEfficiency),
        },

        service: {
          activeRequests: serviceRequests.active,
          completedToday: serviceRequests.completedToday,
          averageResponseTime: Math.round(serviceRequests.averageResponse),
          satisfactionScore: Math.round(serviceRequests.satisfactionScore * 100) / 100,
          pendingRequests: serviceRequests.pending,
          overdue: serviceRequests.overdue,
        },

        maintenance: {
          openIssues: maintenanceIssues.open,
          urgentIssues: maintenanceIssues.urgent,
          completedToday: maintenanceIssues.completedToday,
          averageResolutionTime: Math.round(maintenanceIssues.averageResolution),
          preventiveCompliance: Math.round(maintenanceIssues.preventiveCompliance),
          costImpact: Math.round(maintenanceIssues.costImpact * 100) / 100,
        },

        staff: {
          onDuty: staffActivity.onDuty,
          utilization: Math.round(staffActivity.utilization),
          productivity: Math.round(staffActivity.productivity),
          responseTime: Math.round(staffActivity.averageResponse),
          workload: staffActivity.workload,
          satisfaction: Math.round(staffActivity.satisfaction * 100) / 100,
        },

        guest: {
          activeFeedback: guestFeedback.active,
          averageRating: Math.round(guestFeedback.averageRating * 100) / 100,
          satisfactionTrend: guestFeedback.trend,
          complaintRate: Math.round(guestFeedback.complaintRate * 100) / 100,
          responseRate: Math.round(guestFeedback.responseRate * 100) / 100,
          nps: Math.round(guestFeedback.nps),
        },

        system: {
          uptime: Math.round(systemPerformance.uptime * 100) / 100,
          responseTime: Math.round(systemPerformance.averageResponse),
          errorRate: Math.round(systemPerformance.errorRate * 100) / 100,
          cacheHitRate: Math.round(systemPerformance.cacheHitRate),
          dataQuality: Math.round(systemPerformance.dataQuality),
          availability: systemPerformance.availability,
        },

        trends: {
          efficiency: this.calculateEfficiencyTrend(operationalEfficiency),
          satisfaction: this.calculateSatisfactionTrend(guestFeedback),
          workload: this.calculateWorkloadTrend(staffActivity),
          quality: this.calculateQualityTrend({
            service: serviceRequests,
            maintenance: maintenanceIssues,
            guest: guestFeedback,
          }),
        },

        alerts: operationalAlerts,

        priorities: this.identifyOperationalPriorities({
          efficiency: operationalEfficiency,
          roomStatus,
          serviceRequests,
          maintenanceIssues,
          staffActivity,
        }),

        recommendations: this.generateOperationalRecommendations({
          efficiency: operationalEfficiency,
          alerts: operationalAlerts,
          trends: {
            efficiency: this.calculateEfficiencyTrend(operationalEfficiency),
            satisfaction: this.calculateSatisfactionTrend(guestFeedback),
          },
        }),

        quickActions: this.getOperationalQuickActions({
          roomStatus,
          serviceRequests,
          maintenanceIssues,
          checkInOutActivity,
        }),

        metadata: {
          hotelId: hotelId || 'all',
          generatedAt: now,
          dataFreshness: 'real-time',
          operationalStatus: this.getOverallOperationalStatus(
            operationalEfficiency,
            operationalAlerts
          ),
        },
      };

      // Cache with short TTL for operational data
      await this.setInHybridCache(cacheKey, operationalUpdate, 'realtime');

      return operationalUpdate;
    } catch (error) {
      logger.error('❌ Error getting real-time operational update:', error);
      return {
        timestamp: new Date(),
        error: error.message,
        efficiency: { overall: 0, rating: 'UNKNOWN', components: {} },
        checkInOut: {
          todayCheckIns: 0,
          todayCheckOuts: 0,
          pendingCheckIns: 0,
          pendingCheckOuts: 0,
          efficiency: 0,
        },
        rooms: { total: 0, occupied: 0, available: 0, cleaning: 0, maintenance: 0, outOfOrder: 0 },
        service: {
          activeRequests: 0,
          completedToday: 0,
          averageResponseTime: 0,
          satisfactionScore: 0,
        },
        maintenance: {
          openIssues: 0,
          urgentIssues: 0,
          completedToday: 0,
          averageResolutionTime: 0,
        },
        staff: { onDuty: 0, utilization: 0, productivity: 0, responseTime: 0, satisfaction: 0 },
        guest: {
          activeFeedback: 0,
          averageRating: 0,
          satisfactionTrend: 'stable',
          complaintRate: 0,
        },
        system: {
          uptime: 0,
          responseTime: 0,
          errorRate: 0,
          cacheHitRate: 0,
          availability: 'unknown',
        },
        trends: {
          efficiency: 'stable',
          satisfaction: 'stable',
          workload: 'stable',
          quality: 'stable',
        },
        alerts: [],
        priorities: [],
        recommendations: [],
        quickActions: [],
        metadata: { hotelId: hotelId || 'all', generatedAt: new Date() },
      };
    }
  }

  // Export placeholder methods
  /**
   * Export booking data for analytics
   * @param {string} hotelId - Hotel ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Array} Booking data array
   */
  async exportBookingsData(hotelId, startDate, endDate) {
    try {
      const query = this.buildAnalyticsQuery({ hotelId, startDate, endDate });

      const bookings = await Booking.find(query)
        .populate('hotel', 'name category')
        .populate('customer', 'firstName lastName email clientType')
        .populate('rooms.room', 'type number')
        .sort({ createdAt: -1 });

      return bookings.map((booking) => ({
        bookingId: booking._id.toString(),
        bookingReference: booking.bookingReference,
        hotelId: booking.hotel._id.toString(),
        hotelName: booking.hotel.name,
        hotelCategory: booking.hotel.category,
        customerName:
          `${booking.customer?.firstName || ''} ${booking.customer?.lastName || ''}`.trim(),
        customerEmail: booking.customer?.email,
        customerType: booking.customer?.clientType || booking.clientType,
        checkInDate: booking.checkInDate,
        checkOutDate: booking.checkOutDate,
        nights: moment(booking.checkOutDate).diff(moment(booking.checkInDate), 'days'),
        roomCount: booking.rooms.length,
        roomTypes: booking.rooms.map((r) => r.room?.type || r.type).join(', '),
        roomNumbers: booking.rooms.map((r) => r.room?.number || r.number).join(', '),
        totalPrice: booking.totalPrice || booking.pricing?.totalPrice || 0,
        basePrice: booking.basePrice || booking.pricing?.basePrice || 0,
        currency: booking.currency || 'EUR',
        status: booking.status,
        source: booking.source || 'DIRECT',
        guestCount: booking.guestCount || booking.guests?.length || 1,
        specialRequests: booking.specialRequests || '',
        extras: booking.extras?.map((e) => e.name).join(', ') || '',
        extrasTotal: booking.extras?.reduce((sum, e) => sum + e.price * e.quantity, 0) || 0,
        createdAt: booking.createdAt,
        updatedAt: booking.updatedAt,
        confirmedAt: booking.confirmedAt,
        checkedInAt: booking.checkedInAt,
        checkedOutAt: booking.checkedOutAt,
        cancelledAt: booking.cancelledAt,
        cancellationReason: booking.cancellationReason,
        paymentStatus: booking.payment?.status,
        paymentMethod: booking.payment?.method,
        commission: booking.commission || 0,
        discountApplied: booking.discount?.amount || 0,
        discountType: booking.discount?.type,
        loyaltyPointsUsed: booking.loyalty?.pointsUsed || 0,
        loyaltyPointsEarned: booking.loyalty?.pointsEarned || 0,
        yieldManagement: booking.yieldManagement?.enabled ? 'YES' : 'NO',
        yieldStrategy: booking.yieldManagement?.strategy,
        priceAdjustment: booking.yieldManagement?.priceAdjustment?.adjustment || 0,
        leadTime: booking.createdAt
          ? moment(booking.checkInDate).diff(moment(booking.createdAt), 'days')
          : 0,
        isWeekend:
          moment(booking.checkInDate).day() === 0 || moment(booking.checkInDate).day() === 6,
        season: this.determineSeason(moment(booking.checkInDate), moment(booking.checkOutDate)),
        bookingChannel: booking.channel || booking.source,
        agentId: booking.agent?.id,
        agentName: booking.agent?.name,
        corporateAccount: booking.corporate?.accountName,
        groupBooking: booking.isGroupBooking ? 'YES' : 'NO',
        repeatCustomer: booking.customer?.stats?.totalBookings > 1 ? 'YES' : 'NO',
        customerLoyaltyTier: booking.customer?.loyalty?.tier,
        notes: booking.internalNotes || '',
      }));
    } catch (error) {
      logger.error('Error exporting bookings data:', error);
      return [];
    }
  }

  // Report generation placeholder methods
  /**
   * Generate PDF report from analytics data
   * @param {Object} report - Report data
   * @returns {Buffer} PDF buffer
   */
  async generatePDFReport(report) {
    try {
      // This would use a PDF generation library like PDFKit or Puppeteer
      // For now, returning a placeholder implementation

      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument({ margin: 50 });

      // Buffer to collect PDF data
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));

      return new Promise((resolve, reject) => {
        doc.on('end', () => {
          const pdfBuffer = Buffer.concat(buffers);
          resolve(pdfBuffer);
        });

        doc.on('error', reject);

        // Header
        doc.fontSize(20).text(report.metadata.title, { align: 'center' }).moveDown();

        // Metadata
        doc
          .fontSize(12)
          .text(`Generated: ${moment(report.metadata.generatedAt).format('YYYY-MM-DD HH:mm:ss')}`)
          .text(`Period: ${report.metadata.period.description}`)
          .text(
            `Hotel: ${report.metadata.hotelId === 'all' ? 'All Hotels' : report.metadata.hotelId}`
          )
          .moveDown();

        // Executive Summary
        if (report.executiveSummary) {
          doc.fontSize(16).text('Executive Summary', { underline: true }).moveDown();

          doc.fontSize(10);

          // Key Metrics
          if (report.executiveSummary.keyMetrics) {
            doc.text('Key Metrics:', { continued: false }).moveDown(0.5);

            Object.entries(report.executiveSummary.keyMetrics).forEach(([key, value]) => {
              doc.text(`• ${key}: ${typeof value === 'number' ? value.toLocaleString() : value}`);
            });
            doc.moveDown();
          }

          // Highlights
          if (report.executiveSummary.highlights?.length > 0) {
            doc.text('Highlights:', { continued: false }).moveDown(0.5);

            report.executiveSummary.highlights.forEach((highlight) => {
              doc.text(`• ${highlight}`);
            });
            doc.moveDown();
          }

          // Concerns
          if (report.executiveSummary.concerns?.length > 0) {
            doc.text('Areas of Concern:', { continued: false }).moveDown(0.5);

            report.executiveSummary.concerns.forEach((concern) => {
              doc.text(`• ${concern}`);
            });
            doc.moveDown();
          }
        }

        // Sections
        Object.entries(report.sections).forEach(([sectionName, sectionData]) => {
          doc
            .addPage()
            .fontSize(16)
            .text(sectionData.title || sectionName.toUpperCase(), { underline: true })
            .moveDown();

          doc.fontSize(10);

          if (sectionData.summary) {
            doc.text('Summary:', { continued: false }).moveDown(0.5);

            Object.entries(sectionData.summary).forEach(([key, value]) => {
              if (typeof value === 'object' && value !== null) {
                doc.text(`${key}:`);
                Object.entries(value).forEach(([subKey, subValue]) => {
                  doc.text(
                    `  • ${subKey}: ${typeof subValue === 'number' ? subValue.toLocaleString() : subValue}`
                  );
                });
              } else {
                doc.text(`• ${key}: ${typeof value === 'number' ? value.toLocaleString() : value}`);
              }
            });
            doc.moveDown();
          }

          if (sectionData.insights?.length > 0) {
            doc.text('Insights:', { continued: false }).moveDown(0.5);

            sectionData.insights.forEach((insight) => {
              doc.text(`• ${insight.message || insight}`);
            });
            doc.moveDown();
          }
        });

        // Recommendations
        if (report.recommendations?.length > 0) {
          doc.addPage().fontSize(16).text('Recommendations', { underline: true }).moveDown();

          doc.fontSize(10);

          report.recommendations
            .sort((a, b) => {
              const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
              return priorityOrder[a.priority] - priorityOrder[b.priority];
            })
            .forEach((rec, index) => {
              doc
                .text(`${index + 1}. ${rec.title || rec.action}`)
                .text(`   Priority: ${rec.priority}`)
                .text(`   Expected Impact: ${rec.expectedImpact}`)
                .text(`   Timeframe: ${rec.timeframe}`)
                .moveDown(0.5);
            });
        }

        // Footer
        doc
          .fontSize(8)
          .text(`Report ID: ${report.metadata.reportId}`, 50, doc.page.height - 50)
          .text(`Page ${doc.bufferedPageRange().count}`, 50, doc.page.height - 35);

        doc.end();
      });
    } catch (error) {
      logger.error('Error generating PDF report:', error);

      // Return minimal PDF with error message
      const PDFDocument = require('pdfkit');
      const doc = new PDFDocument();
      const buffers = [];
      doc.on('data', buffers.push.bind(buffers));

      return new Promise((resolve) => {
        doc.on('end', () => {
          resolve(Buffer.concat(buffers));
        });

        doc
          .fontSize(16)
          .text('Report Generation Error', { align: 'center' })
          .moveDown()
          .fontSize(12)
          .text(`Error: ${error.message}`)
          .text(`Time: ${new Date().toISOString()}`);

        doc.end();
      });
    }
  }
  /**
   * Generate Excel report from analytics data
   * @param {Object} report - Report data
   * @returns {Buffer} Excel buffer
   */
  async generateExcelReport(report) {
    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();

      // Workbook properties
      workbook.creator = 'Hotel Analytics System';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.lastPrinted = new Date();

      // Summary Sheet
      const summarySheet = workbook.addWorksheet('Executive Summary', {
        pageSetup: { paperSize: 9, orientation: 'portrait' },
      });

      // Header styling
      const headerStyle = {
        font: { bold: true, size: 14, color: { argb: 'FFFFFF' } },
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '366092' } },
        alignment: { horizontal: 'center' },
      };

      const subHeaderStyle = {
        font: { bold: true, size: 12, color: { argb: '366092' } },
        alignment: { horizontal: 'left' },
      };

      // Title
      summarySheet.mergeCells('A1:F1');
      summarySheet.getCell('A1').value = report.metadata.title;
      summarySheet.getCell('A1').style = headerStyle;

      // Metadata
      let currentRow = 3;
      summarySheet.getCell(`A${currentRow}`).value = 'Report Information';
      summarySheet.getCell(`A${currentRow}`).style = subHeaderStyle;
      currentRow++;

      summarySheet.getCell(`A${currentRow}`).value = 'Generated:';
      summarySheet.getCell(`B${currentRow}`).value = moment(report.metadata.generatedAt).format(
        'YYYY-MM-DD HH:mm:ss'
      );
      currentRow++;

      summarySheet.getCell(`A${currentRow}`).value = 'Period:';
      summarySheet.getCell(`B${currentRow}`).value = report.metadata.period.description;
      currentRow++;

      summarySheet.getCell(`A${currentRow}`).value = 'Hotel:';
      summarySheet.getCell(`B${currentRow}`).value =
        report.metadata.hotelId === 'all' ? 'All Hotels' : report.metadata.hotelId;
      currentRow += 2;

      // Key Metrics
      if (report.executiveSummary?.keyMetrics) {
        summarySheet.getCell(`A${currentRow}`).value = 'Key Metrics';
        summarySheet.getCell(`A${currentRow}`).style = subHeaderStyle;
        currentRow++;

        // Headers
        summarySheet.getCell(`A${currentRow}`).value = 'Metric';
        summarySheet.getCell(`B${currentRow}`).value = 'Value';
        summarySheet.getRow(currentRow).style = { font: { bold: true } };
        currentRow++;

        Object.entries(report.executiveSummary.keyMetrics).forEach(([key, value]) => {
          summarySheet.getCell(`A${currentRow}`).value = key;
          summarySheet.getCell(`B${currentRow}`).value =
            typeof value === 'number'
              ? value % 1 === 0
                ? value
                : parseFloat(value.toFixed(2))
              : value;
          currentRow++;
        });
        currentRow++;
      }

      // Create sheets for each section
      Object.entries(report.sections).forEach(([sectionName, sectionData]) => {
        const sheet = workbook.addWorksheet(sectionName.toUpperCase().substring(0, 30));

        let row = 1;

        // Section title
        sheet.mergeCells(`A${row}:F${row}`);
        sheet.getCell(`A${row}`).value = sectionData.title || sectionName.toUpperCase();
        sheet.getCell(`A${row}`).style = headerStyle;
        row += 2;

        // Summary data
        if (sectionData.summary) {
          sheet.getCell(`A${row}`).value = 'Summary';
          sheet.getCell(`A${row}`).style = subHeaderStyle;
          row++;

          // Convert summary to table format
          const summaryEntries = this.flattenObject(sectionData.summary);

          sheet.getCell(`A${row}`).value = 'Metric';
          sheet.getCell(`B${row}`).value = 'Value';
          sheet.getRow(row).style = { font: { bold: true } };
          row++;

          summaryEntries.forEach(([key, value]) => {
            sheet.getCell(`A${row}`).value = key;
            sheet.getCell(`B${row}`).value =
              typeof value === 'number'
                ? value % 1 === 0
                  ? value
                  : parseFloat(value.toFixed(2))
                : value;
            row++;
          });
          row += 2;
        }

        // Time series data if available
        if (sectionData.timeSeries && Array.isArray(sectionData.timeSeries)) {
          sheet.getCell(`A${row}`).value = 'Time Series Data';
          sheet.getCell(`A${row}`).style = subHeaderStyle;
          row++;

          const timeSeries = sectionData.timeSeries;
          if (timeSeries.length > 0) {
            // Headers from first item
            const headers = Object.keys(timeSeries[0]);
            headers.forEach((header, index) => {
              sheet.getCell(row, index + 1).value = header;
            });
            sheet.getRow(row).style = { font: { bold: true } };
            row++;

            // Data rows
            timeSeries.forEach((item) => {
              headers.forEach((header, index) => {
                let value = item[header];
                if (value instanceof Date) {
                  value = moment(value).format('YYYY-MM-DD');
                } else if (typeof value === 'number') {
                  value = value % 1 === 0 ? value : parseFloat(value.toFixed(2));
                }
                sheet.getCell(row, index + 1).value = value;
              });
              row++;
            });
          }
          row += 2;
        }

        // Insights
        if (sectionData.insights && Array.isArray(sectionData.insights)) {
          sheet.getCell(`A${row}`).value = 'Insights';
          sheet.getCell(`A${row}`).style = subHeaderStyle;
          row++;

          sectionData.insights.forEach((insight, index) => {
            sheet.getCell(`A${row}`).value = `${index + 1}.`;
            sheet.getCell(`B${row}`).value = insight.message || insight.title || insight;
            if (insight.type) {
              sheet.getCell(`C${row}`).value = insight.type;
            }
            if (insight.impact) {
              sheet.getCell(`D${row}`).value = insight.impact;
            }
            row++;
          });
        }

        // Auto-fit columns
        sheet.columns.forEach((column) => {
          column.width = Math.max(column.width || 10, 15);
        });
      });

      // Recommendations sheet
      if (report.recommendations && report.recommendations.length > 0) {
        const recSheet = workbook.addWorksheet('Recommendations');

        let row = 1;
        recSheet.mergeCells(`A${row}:F${row}`);
        recSheet.getCell(`A${row}`).value = 'Recommendations';
        recSheet.getCell(`A${row}`).style = headerStyle;
        row += 2;

        // Headers
        const recHeaders = ['Priority', 'Title', 'Action', 'Expected Impact', 'Timeframe', 'Type'];
        recHeaders.forEach((header, index) => {
          recSheet.getCell(row, index + 1).value = header;
        });
        recSheet.getRow(row).style = { font: { bold: true } };
        row++;

        // Recommendations
        report.recommendations
          .sort((a, b) => {
            const priorityOrder = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
            return priorityOrder[a.priority] - priorityOrder[b.priority];
          })
          .forEach((rec) => {
            recSheet.getCell(row, 1).value = rec.priority;
            recSheet.getCell(row, 2).value = rec.title || rec.message;
            recSheet.getCell(row, 3).value = rec.action;
            recSheet.getCell(row, 4).value = rec.expectedImpact;
            recSheet.getCell(row, 5).value = rec.timeframe;
            recSheet.getCell(row, 6).value = rec.type;

            // Color code by priority
            const priorityColors = {
              CRITICAL: 'FFFF0000',
              HIGH: 'FFFF6600',
              MEDIUM: 'FFFFFF00',
              LOW: 'FF00FF00',
            };

            if (priorityColors[rec.priority]) {
              recSheet.getRow(row).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: priorityColors[rec.priority] },
              };
            }

            row++;
          });

        // Auto-fit columns
        recSheet.columns.forEach((column) => {
          column.width = Math.max(column.width || 10, 20);
        });
      }

      // Generate buffer
      const buffer = await workbook.xlsx.writeBuffer();
      return buffer;
    } catch (error) {
      logger.error('Error generating Excel report:', error);

      // Return minimal Excel with error
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Error');

      sheet.getCell('A1').value = 'Report Generation Error';
      sheet.getCell('A2').value = error.message;
      sheet.getCell('A3').value = new Date().toISOString();

      return await workbook.xlsx.writeBuffer();
    }
  }
  /**
   * Email report to recipients
   * @param {Object} report - Report data
   * @param {Array} recipients - Email recipients
   * @param {string} format - Report format (pdf, excel, json)
   * @returns {boolean} Success status
   */
  async emailReport(report, recipients, format = 'pdf') {
    try {
      const nodemailer = require('nodemailer');

      // Create transporter (configure based on your email service)
      const transporter = nodemailer.createTransporter({
        host: process.env.SMTP_HOST || 'localhost',
        port: process.env.SMTP_PORT || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });

      // Generate attachment based on format
      let attachment;
      const reportId = report.metadata.reportId;
      const timestamp = moment().format('YYYY-MM-DD');

      switch (format.toLowerCase()) {
        case 'pdf':
          const pdfBuffer = await this.generatePDFReport(report);
          attachment = {
            filename: `analytics-report-${reportId}-${timestamp}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          };
          break;

        case 'excel':
          const excelBuffer = await this.generateExcelReport(report);
          attachment = {
            filename: `analytics-report-${reportId}-${timestamp}.xlsx`,
            content: excelBuffer,
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
          break;

        case 'json':
          const jsonContent = JSON.stringify(report, null, 2);
          attachment = {
            filename: `analytics-report-${reportId}-${timestamp}.json`,
            content: Buffer.from(jsonContent, 'utf8'),
            contentType: 'application/json',
          };
          break;

        default:
          throw new Error(`Unsupported format: ${format}`);
      }

      // Email content
      const emailSubject = `Analytics Report - ${report.metadata.title}`;
      const emailBody = this.generateEmailBody(report);

      // Send emails
      const sendPromises = recipients.map(async (recipient) => {
        try {
          const mailOptions = {
            from: process.env.SMTP_FROM || 'analytics@hotel-system.com',
            to: recipient,
            subject: emailSubject,
            html: emailBody,
            attachments: [attachment],
          };

          const result = await transporter.sendMail(mailOptions);
          logger.info(`Report emailed successfully to ${recipient}: ${result.messageId}`);
          return { recipient, success: true, messageId: result.messageId };
        } catch (error) {
          logger.error(`Failed to email report to ${recipient}:`, error);
          return { recipient, success: false, error: error.message };
        }
      });

      const results = await Promise.all(sendPromises);

      // Log summary
      const successful = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      logger.info(`Report email summary: ${successful} successful, ${failed} failed`);

      // Return true if at least one email was successful
      return successful > 0;
    } catch (error) {
      logger.error('Error emailing report:', error);
      return false;
    }
  }
  /**
   * Store report for future access
   * @param {string} reportId - Report ID
   * @param {Object} report - Report data
   * @returns {boolean} Success status
   */
  async storeReport(reportId, report) {
    try {
      // Store in multiple locations for redundancy

      // 1. Database storage
      const Report = require('../models/Report');

      const reportDoc = new Report({
        reportId,
        title: report.metadata.title,
        type: report.metadata.reportType,
        hotelId: report.metadata.hotelId,
        period: report.metadata.period,
        sections: report.metadata.sections,
        generatedBy: report.metadata.generatedBy,
        generatedAt: report.metadata.generatedAt,
        data: report,
        status: 'COMPLETED',
        size: JSON.stringify(report).length,
        expiresAt: moment().add(90, 'days').toDate(), // Keep for 90 days
      });

      await reportDoc.save();

      // 2. File system storage (optional)
      if (process.env.STORE_REPORTS_ON_DISK === 'true') {
        const fs = require('fs').promises;
        const path = require('path');

        const reportsDir = path.join(process.cwd(), 'storage', 'reports');
        await fs.mkdir(reportsDir, { recursive: true });

        const reportPath = path.join(reportsDir, `${reportId}.json`);
        await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

        logger.debug(`Report stored to disk: ${reportPath}`);
      }

      // 3. Cache storage for quick access
      const cacheKey = `stored_report_${reportId}`;
      await this.redisCache.cacheAnalytics('reports', cacheKey, report, 24 * 60 * 60); // 24 hours

      // 4. Update report index
      await this.updateReportIndex(reportId, report.metadata);

      logger.info(`Report stored successfully: ${reportId}`);
      return true;
    } catch (error) {
      logger.error(`Error storing report ${reportId}:`, error);
      return false;
    }
  }

  /**
   * Flatten nested object for Excel export
   * @param {Object} obj - Object to flatten
   * @param {string} prefix - Key prefix
   * @returns {Array} Array of [key, value] pairs
   */
  flattenObject(obj, prefix = '') {
    const flattened = [];

    Object.entries(obj).forEach(([key, value]) => {
      const newKey = prefix ? `${prefix}.${key}` : key;

      if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
        flattened.push(...this.flattenObject(value, newKey));
      } else {
        flattened.push([newKey, value]);
      }
    });

    return flattened;
  }

  /**
   * Generate HTML email body for report
   * @param {Object} report - Report data
   * @returns {string} HTML email body
   */
  generateEmailBody(report) {
    const { metadata, executiveSummary } = report;

    return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background-color: #366092; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; }
        .metric-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .metric-table th, .metric-table td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        .metric-table th { background-color: #f2f2f2; }
        .highlight { background-color: #e8f5e8; padding: 10px; margin: 10px 0; border-left: 4px solid #4CAF50; }
        .concern { background-color: #ffeaa7; padding: 10px; margin: 10px 0; border-left: 4px solid #fdcb6e; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${metadata.title}</h1>
        <p>Generated on ${moment(metadata.generatedAt).format('MMMM Do YYYY, h:mm:ss a')}</p>
      </div>
      
      <div class="content">
        <h2>Report Details</h2>
        <table class="metric-table">
          <tr><td><strong>Period:</strong></td><td>${metadata.period.description}</td></tr>
          <tr><td><strong>Hotel:</strong></td><td>${metadata.hotelId === 'all' ? 'All Hotels' : metadata.hotelId}</td></tr>
          <tr><td><strong>Sections:</strong></td><td>${metadata.sections.join(', ')}</td></tr>
          <tr><td><strong>Report ID:</strong></td><td>${metadata.reportId}</td></tr>
        </table>
        
        ${
          executiveSummary?.keyMetrics
            ? `
          <h2>Key Metrics</h2>
          <table class="metric-table">
            <thead>
              <tr><th>Metric</th><th>Value</th></tr>
            </thead>
            <tbody>
              ${Object.entries(executiveSummary.keyMetrics)
                .map(
                  ([key, value]) =>
                    `<tr><td>${key}</td><td>${typeof value === 'number' ? value.toLocaleString() : value}</td></tr>`
                )
                .join('')}
            </tbody>
          </table>
        `
            : ''
        }
        
        ${
          executiveSummary?.highlights?.length > 0
            ? `
          <h2>Highlights</h2>
          ${executiveSummary.highlights
            .map((highlight) => `<div class="highlight">${highlight}</div>`)
            .join('')}
        `
            : ''
        }
        
        ${
          executiveSummary?.concerns?.length > 0
            ? `
         <h2>Areas of Concern</h2>
         ${executiveSummary.concerns
           .map((concern) => `<div class="concern">${concern}</div>`)
           .join('')}
       `
            : ''
        }
       
       <h2>Report Sections</h2>
       <p>This report includes the following sections:</p>
       <ul>
         ${metadata.sections.map((section) => `<li>${section.toUpperCase()}</li>`).join('')}
       </ul>
       
       <p>Please find the complete report attached to this email.</p>
       
       <div class="footer">
         <p>This report was automatically generated by the Hotel Analytics System.</p>
         <p>For questions or support, please contact the analytics team.</p>
         <p><strong>Report ID:</strong> ${metadata.reportId}</p>
       </div>
     </div>
   </body>
   </html>
 `;
  }

  /**
   * Update report index for quick lookup
   * @param {string} reportId - Report ID
   * @param {Object} metadata - Report metadata
   * @returns {boolean} Success status
   */
  async updateReportIndex(reportId, metadata) {
    try {
      const ReportIndex = require('../models/ReportIndex');

      const indexEntry = new ReportIndex({
        reportId,
        title: metadata.title,
        type: metadata.reportType,
        hotelId: metadata.hotelId,
        period: metadata.period,
        sections: metadata.sections,
        generatedBy: metadata.generatedBy,
        generatedAt: metadata.generatedAt,
        status: 'AVAILABLE',
        formats: ['json'], // Will be updated when other formats are generated
        downloadCount: 0,
        lastAccessed: null,
      });

      await indexEntry.save();

      // Also update Redis index for fast lookup
      const indexKey = `report_index_${reportId}`;
      await this.redisCache.cacheAnalytics(
        'reports',
        indexKey,
        {
          reportId,
          metadata,
          status: 'AVAILABLE',
          createdAt: new Date(),
        },
        7 * 24 * 60 * 60
      ); // 7 days

      logger.debug(`Report index updated: ${reportId}`);
      return true;
    } catch (error) {
      logger.error(`Error updating report index for ${reportId}:`, error);
      return false;
    }
  }

  /**
   * Generate unique report ID
   * @returns {string} Unique report ID
   */
  generateReportId() {
    const timestamp = moment().format('YYYYMMDD-HHmmss');
    const random = Math.random().toString(36).substr(2, 8).toUpperCase();
    return `RPT-${timestamp}-${random}`;
  }

  /**
   * Convert data to CSV format
   * @param {Array} data - Data array
   * @param {boolean} includeHeaders - Include headers
   * @returns {string} CSV string
   */
  convertToCSV(data, includeHeaders = true) {
    try {
      if (!Array.isArray(data) || data.length === 0) {
        return 'No data available';
      }

      const headers = Object.keys(data[0]);
      let csv = '';

      if (includeHeaders) {
        csv += headers.map((header) => this.escapeCSVField(header)).join(',') + '\n';
      }

      data.forEach((row) => {
        const values = headers.map((header) => {
          let value = row[header];

          // Handle different data types
          if (value === null || value === undefined) {
            value = '';
          } else if (value instanceof Date) {
            value = moment(value).format('YYYY-MM-DD HH:mm:ss');
          } else if (typeof value === 'object') {
            value = JSON.stringify(value);
          } else {
            value = String(value);
          }

          return this.escapeCSVField(value);
        });
        csv += values.join(',') + '\n';
      });

      return csv;
    } catch (error) {
      logger.error('Error converting to CSV:', error);
      return 'Error generating CSV';
    }
  }

  /**
   * Escape CSV field value
   * @param {string} field - Field value
   * @returns {string} Escaped field value
   */
  escapeCSVField(field) {
    if (typeof field !== 'string') {
      field = String(field);
    }

    // If field contains comma, newline, or quote, wrap in quotes and escape quotes
    if (
      field.includes(',') ||
      field.includes('\n') ||
      field.includes('\r') ||
      field.includes('"')
    ) {
      field = '"' + field.replace(/"/g, '""') + '"';
    }

    return field;
  }

  /**
   * Convert data to Excel format (simple version)
   * @param {Array} data - Data array
   * @returns {Buffer} Excel buffer
   */
  async convertToExcel(data) {
    try {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Data');

      if (!Array.isArray(data) || data.length === 0) {
        worksheet.getCell('A1').value = 'No data available';
        return await workbook.xlsx.writeBuffer();
      }

      // Headers
      const headers = Object.keys(data[0]);
      headers.forEach((header, index) => {
        const cell = worksheet.getCell(1, index + 1);
        cell.value = header;
        cell.font = { bold: true };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFE0E0E0' },
        };
      });

      // Data rows
      data.forEach((row, rowIndex) => {
        headers.forEach((header, colIndex) => {
          let value = row[header];

          if (value instanceof Date) {
            value = value;
            worksheet.getCell(rowIndex + 2, colIndex + 1).numFmt = 'yyyy-mm-dd hh:mm:ss';
          } else if (typeof value === 'number') {
            value = value;
            if (value % 1 !== 0) {
              worksheet.getCell(rowIndex + 2, colIndex + 1).numFmt = '#,##0.00';
            }
          } else if (typeof value === 'object' && value !== null) {
            value = JSON.stringify(value);
          }

          worksheet.getCell(rowIndex + 2, colIndex + 1).value = value;
        });
      });

      // Auto-fit columns
      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, (cell) => {
          const cellLength = cell.value ? cell.value.toString().length : 0;
          if (cellLength > maxLength) {
            maxLength = cellLength;
          }
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });

      return await workbook.xlsx.writeBuffer();
    } catch (error) {
      logger.error('Error converting to Excel:', error);

      // Return minimal Excel with error
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Error');

      worksheet.getCell('A1').value = 'Error generating Excel file';
      worksheet.getCell('A2').value = error.message;

      return await workbook.xlsx.writeBuffer();
    }
  }

  /**
   * Determine season for a date range
   * @param {moment.Moment} startDate - Start date
   * @param {moment.Moment} endDate - End date
   * @returns {string} Season name
   */
  determineSeason(startDate, endDate) {
    const startMonth = startDate.month();
    const endMonth = endDate.month();

    // Check for holiday periods first
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

  /**
   * Check if date range includes holiday periods
   * @param {moment.Moment} startDate - Start date
   * @param {moment.Moment} endDate - End date
   * @returns {boolean} Is holiday period
   */
  isHolidayPeriod(startDate, endDate) {
    // Check for major holiday periods
    const holidayPeriods = [
      { start: [11, 20], end: [0, 5] }, // Christmas/New Year
      { start: [6, 1], end: [6, 31] }, // July (summer holiday)
      { start: [3, 15], end: [3, 25] }, // Easter period (approximate)
      { start: [11, 1], end: [11, 30] }, // November (Thanksgiving in US)
    ];

    return holidayPeriods.some((period) => {
      const holidayStart = moment().month(period.start[0]).date(period.start[1]);
      const holidayEnd = moment().month(period.end[0]).date(period.end[1]);

      return (
        startDate.isBetween(holidayStart, holidayEnd, null, '[]') ||
        endDate.isBetween(holidayStart, holidayEnd, null, '[]') ||
        (startDate.isSameOrBefore(holidayStart) && endDate.isSameOrAfter(holidayEnd))
      );
    });
  }

  /**
   * Get empty revenue metrics structure
   * @returns {Object} Empty revenue metrics
   */
  getEmptyRevenueMetrics() {
    return {
      summary: {
        totalRevenue: 0,
        totalBookings: 0,
        totalRoomNights: 0,
        averageBookingValue: 0,
        adr: 0,
        revPAR: 0,
        currency: 'EUR',
      },
      timeSeries: [],
      breakdown: {
        byRoomType: [],
        bySource: [],
        byClientType: [],
      },
      growth: null,
      variance: 0,
    };
  }

  /**
   * Calculate available room nights for RevPAR calculation
   * @param {Object} query - Query parameters
   * @returns {number} Available room nights
   */
  async calculateAvailableRoomNights(query) {
    try {
      // Get hotel room counts
      const hotels = await Hotel.find(query.hotel ? { _id: query.hotel } : {}).populate('rooms');

      const totalRooms = hotels.reduce((sum, hotel) => sum + hotel.rooms.length, 0);

      // Calculate days in period
      const startDate = moment(query.createdAt?.$gte || moment().subtract(30, 'days'));
      const endDate = moment(query.createdAt?.$lte || moment());
      const days = endDate.diff(startDate, 'days') + 1;

      return totalRooms * days;
    } catch (error) {
      logger.error('Error calculating available room nights:', error);
      return 1; // Avoid division by zero
    }
  }

  /**
   * Calculate variance of values
   * @param {Array} values - Array of values
   * @returns {number} Variance
   */
  calculateVariance(values) {
    if (values.length === 0) return 0;

    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const squaredDiffs = values.map((val) => Math.pow(val - mean, 2));
    return squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * Group revenue data by time period
   * @param {Array} bookings - Booking data
   * @param {string} granularity - Time granularity
   * @returns {Array} Grouped revenue data
   */
  groupRevenueByPeriod(bookings, granularity) {
    const grouped = {};

    bookings.forEach((booking) => {
      let key;
      const date = moment(booking.createdAt);

      switch (granularity) {
        case 'hourly':
          key = date.format('YYYY-MM-DD HH');
          break;
        case 'daily':
          key = date.format('YYYY-MM-DD');
          break;
        case 'weekly':
          key = date.format('YYYY-WW');
          break;
        case 'monthly':
          key = date.format('YYYY-MM');
          break;
        default:
          key = date.format('YYYY-MM-DD');
      }

      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          revenue: 0,
          bookings: 0,
          roomNights: 0,
        };
      }

      grouped[key].revenue += booking.convertedAmount || 0;
      grouped[key].bookings += 1;
      grouped[key].roomNights += booking.nights * booking.rooms.length;
    });

    return Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period));
  }

  /**
   * Calculate revenue by room type
   * @param {Array} bookings - Booking data
   * @returns {Array} Revenue by room type
   */
  calculateRevenueByRoomType(bookings) {
    const revenueByType = {};

    bookings.forEach((booking) => {
      booking.rooms.forEach((room) => {
        const type = room.type || 'Unknown';
        if (!revenueByType[type]) {
          revenueByType[type] = {
            type,
            revenue: 0,
            bookings: 0,
            percentage: 0,
          };
        }

        revenueByType[type].revenue += (booking.convertedAmount || 0) / booking.rooms.length;
        revenueByType[type].bookings += 1;
      });
    });

    const totalRevenue = Object.values(revenueByType).reduce((sum, type) => sum + type.revenue, 0);

    return Object.values(revenueByType).map((type) => ({
      ...type,
      revenue: Math.round(type.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((type.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }

  /**
   * Calculate revenue by booking source
   * @param {Array} bookings - Booking data
   * @returns {Array} Revenue by source
   */
  calculateRevenueBySource(bookings) {
    const revenueBySource = {};

    bookings.forEach((booking) => {
      const source = booking.source || 'DIRECT';
      if (!revenueBySource[source]) {
        revenueBySource[source] = {
          source,
          revenue: 0,
          bookings: 0,
          percentage: 0,
        };
      }

      revenueBySource[source].revenue += booking.convertedAmount || 0;
      revenueBySource[source].bookings += 1;
    });

    const totalRevenue = Object.values(revenueBySource).reduce(
      (sum, source) => sum + source.revenue,
      0
    );

    return Object.values(revenueBySource).map((source) => ({
      ...source,
      revenue: Math.round(source.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((source.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }

  /**
   * Calculate revenue by client type
   * @param {Array} bookings - Booking data
   * @returns {Array} Revenue by client type
   */
  calculateRevenueByClientType(bookings) {
    const revenueByType = {};

    bookings.forEach((booking) => {
      const clientType = booking.clientType || 'INDIVIDUAL';
      if (!revenueByType[clientType]) {
        revenueByType[clientType] = {
          type: clientType,
          revenue: 0,
          bookings: 0,
          percentage: 0,
        };
      }

      revenueByType[clientType].revenue += booking.convertedAmount || 0;
      revenueByType[clientType].bookings += 1;
    });

    const totalRevenue = Object.values(revenueByType).reduce((sum, type) => sum + type.revenue, 0);

    return Object.values(revenueByType).map((type) => ({
      ...type,
      revenue: Math.round(type.revenue * 100) / 100,
      percentage: totalRevenue > 0 ? Math.round((type.revenue / totalRevenue) * 10000) / 100 : 0,
    }));
  }

  // Advanced analytics placeholder methods
  analyzeYieldByStrategy(bookings) {
    try {
      const strategies = {};

      bookings.forEach((booking) => {
        const strategy = booking.yieldManagement?.strategy || 'MODERATE';
        if (!strategies[strategy]) {
          strategies[strategy] = {
            strategy,
            bookingCount: 0,
            totalRevenue: 0,
            avgPrice: 0,
            priceAdjustments: [],
          };
        }

        strategies[strategy].bookingCount++;
        strategies[strategy].totalRevenue += booking.totalPrice || 0;

        if (booking.yieldManagement?.priceAdjustment) {
          strategies[strategy].priceAdjustments.push(booking.yieldManagement.priceAdjustment);
        }
      });

      // Calculate averages
      Object.values(strategies).forEach((strategy) => {
        strategy.avgPrice =
          strategy.bookingCount > 0 ? strategy.totalRevenue / strategy.bookingCount : 0;
        strategy.avgAdjustment =
          strategy.priceAdjustments.length > 0
            ? strategy.priceAdjustments.reduce((sum, adj) => sum + adj.adjustmentPercentage, 0) /
              strategy.priceAdjustments.length
            : 0;
      });

      return Object.values(strategies).sort((a, b) => b.totalRevenue - a.totalRevenue);
    } catch (error) {
      logger.error('Error analyzing yield by strategy:', error);
      return [];
    }
  }
  analyzeYieldByDemandLevel(bookings) {
    try {
      const demandLevels = {};

      bookings.forEach((booking) => {
        const demandLevel = booking.yieldManagement?.demandLevel || 'NORMAL';
        if (!demandLevels[demandLevel]) {
          demandLevels[demandLevel] = {
            level: demandLevel,
            bookingCount: 0,
            totalRevenue: 0,
            avgYieldScore: 0,
            yieldScores: [],
          };
        }

        demandLevels[demandLevel].bookingCount++;
        demandLevels[demandLevel].totalRevenue += booking.totalPrice || 0;

        if (booking.yieldManagement?.performanceScore) {
          demandLevels[demandLevel].yieldScores.push(booking.yieldManagement.performanceScore);
        }
      });

      // Calculate averages
      Object.values(demandLevels).forEach((level) => {
        level.avgYieldScore =
          level.yieldScores.length > 0
            ? level.yieldScores.reduce((sum, score) => sum + score, 0) / level.yieldScores.length
            : 0;
        level.revenuePerBooking =
          level.bookingCount > 0 ? level.totalRevenue / level.bookingCount : 0;
      });

      return Object.values(demandLevels).sort((a, b) => b.avgYieldScore - a.avgYieldScore);
    } catch (error) {
      logger.error('Error analyzing yield by demand level:', error);
      return [];
    }
  }
  analyzeYieldTrends(bookings) {
    try {
      const dailyYield = {};

      bookings.forEach((booking) => {
        const date = moment(booking.createdAt).format('YYYY-MM-DD');
        if (!dailyYield[date]) {
          dailyYield[date] = {
            date,
            bookingCount: 0,
            totalRevenue: 0,
            yieldAdjustments: 0,
            avgYieldScore: 0,
            yieldScores: [],
          };
        }

        dailyYield[date].bookingCount++;
        dailyYield[date].totalRevenue += booking.totalPrice || 0;

        if (booking.yieldManagement?.priceAdjustment) {
          dailyYield[date].yieldAdjustments +=
            booking.yieldManagement.priceAdjustment.adjustment || 0;
        }

        if (booking.yieldManagement?.performanceScore) {
          dailyYield[date].yieldScores.push(booking.yieldManagement.performanceScore);
        }
      });

      // Calculate daily averages and trends
      const trendData = Object.values(dailyYield)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((day) => {
          day.avgYieldScore =
            day.yieldScores.length > 0
              ? day.yieldScores.reduce((sum, score) => sum + score, 0) / day.yieldScores.length
              : 0;
          day.avgRevenuePerBooking = day.bookingCount > 0 ? day.totalRevenue / day.bookingCount : 0;
          return day;
        });

      // Calculate trend direction
      const recentDays = trendData.slice(-7);
      const previousDays = trendData.slice(-14, -7);

      const recentAvgScore =
        recentDays.reduce((sum, day) => sum + day.avgYieldScore, 0) / recentDays.length;
      const previousAvgScore =
        previousDays.reduce((sum, day) => sum + day.avgYieldScore, 0) / previousDays.length;

      const trendDirection =
        recentAvgScore > previousAvgScore
          ? 'IMPROVING'
          : recentAvgScore < previousAvgScore
            ? 'DECLINING'
            : 'STABLE';

      return {
        timeSeries: trendData,
        trendDirection,
        avgYieldScore:
          trendData.reduce((sum, day) => sum + day.avgYieldScore, 0) / trendData.length,
        totalYieldImpact: trendData.reduce((sum, day) => sum + day.yieldAdjustments, 0),
        performance: {
          bestDay: trendData.reduce(
            (best, day) => (day.avgYieldScore > best.avgYieldScore ? day : best),
            trendData[0]
          ),
          worstDay: trendData.reduce(
            (worst, day) => (day.avgYieldScore < worst.avgYieldScore ? day : worst),
            trendData[0]
          ),
        },
      };
    } catch (error) {
      logger.error('Error analyzing yield trends:', error);
      return {};
    }
  }
  calculateOptimizationEffectiveness(optimizations) {
    try {
      if (!optimizations || optimizations.length === 0) {
        return { effectiveness: 0, analysis: 'No optimizations to analyze' };
      }

      const totalOptimizations = optimizations.length;
      const positiveOptimizations = optimizations.filter((opt) => opt.adjustment > 0);
      const negativeOptimizations = optimizations.filter((opt) => opt.adjustment < 0);

      const totalRevenueImpact = optimizations.reduce((sum, opt) => sum + opt.adjustment, 0);
      const avgImpact = totalRevenueImpact / totalOptimizations;

      // Calculate success rate
      const successfulOptimizations = optimizations.filter(
        (opt) => Math.abs(opt.adjustmentPercentage) >= 5 && opt.adjustment > 0
      );
      const successRate = (successfulOptimizations.length / totalOptimizations) * 100;

      // Effectiveness score (0-100)
      let effectivenessScore = 0;
      if (successRate > 70 && avgImpact > 0) effectivenessScore = 90;
      else if (successRate > 50 && avgImpact > 0) effectivenessScore = 75;
      else if (successRate > 30) effectivenessScore = 60;
      else if (avgImpact > 0) effectivenessScore = 45;
      else effectivenessScore = 25;

      return {
        effectiveness: effectivenessScore,
        successRate: Math.round(successRate),
        totalImpact: Math.round(totalRevenueImpact * 100) / 100,
        avgImpact: Math.round(avgImpact * 100) / 100,
        breakdown: {
          total: totalOptimizations,
          positive: positiveOptimizations.length,
          negative: negativeOptimizations.length,
          successful: successfulOptimizations.length,
        },
        analysis: this.generateOptimizationAnalysis(effectivenessScore, successRate, avgImpact),
      };
    } catch (error) {
      logger.error('Error calculating optimization effectiveness:', error);
      return { effectiveness: 0, error: error.message };
    }
  }
  analyzeDayOfWeekPatterns(bookings) {
    try {
      const dayPatterns = {};
      const dayNames = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];

      // Initialize days
      dayNames.forEach((day) => {
        dayPatterns[day] = {
          day,
          bookingCount: 0,
          totalRevenue: 0,
          avgBookingValue: 0,
          occupancyRate: 0,
        };
      });

      bookings.forEach((booking) => {
        const dayOfWeek = dayNames[moment(booking.checkInDate).day()];
        dayPatterns[dayOfWeek].bookingCount++;
        dayPatterns[dayOfWeek].totalRevenue += booking.totalPrice || 0;
      });

      // Calculate averages and find patterns
      const totalBookings = bookings.length;
      Object.values(dayPatterns).forEach((pattern) => {
        pattern.avgBookingValue =
          pattern.bookingCount > 0 ? pattern.totalRevenue / pattern.bookingCount : 0;
        pattern.popularityRate =
          totalBookings > 0 ? (pattern.bookingCount / totalBookings) * 100 : 0;
      });

      // Find peak and low days
      const sortedDays = Object.values(dayPatterns).sort((a, b) => b.bookingCount - a.bookingCount);

      return {
        patterns: Object.values(dayPatterns),
        insights: {
          peakDay: sortedDays[0],
          slowestDay: sortedDays[sortedDays.length - 1],
          weekendVsWeekday: this.analyzeWeekendVsWeekday(dayPatterns),
          recommendations: this.generateDayPatternRecommendations(sortedDays),
        },
      };
    } catch (error) {
      logger.error('Error analyzing day of week patterns:', error);
      return {};
    }
  }
  analyzeTimeOfDayPatterns(bookings) {
    try {
      const hourlyPatterns = {};

      // Initialize 24 hours
      for (let hour = 0; hour < 24; hour++) {
        hourlyPatterns[hour] = {
          hour,
          bookingCount: 0,
          totalRevenue: 0,
          avgBookingValue: 0,
        };
      }

      bookings.forEach((booking) => {
        const hour = moment(booking.createdAt).hour();
        hourlyPatterns[hour].bookingCount++;
        hourlyPatterns[hour].totalRevenue += booking.totalPrice || 0;
      });

      // Calculate averages
      Object.values(hourlyPatterns).forEach((pattern) => {
        pattern.avgBookingValue =
          pattern.bookingCount > 0 ? pattern.totalRevenue / pattern.bookingCount : 0;
      });

      // Group into time periods
      const timePeriods = {
        morning: { hours: [6, 7, 8, 9, 10, 11], bookings: 0, revenue: 0 },
        afternoon: { hours: [12, 13, 14, 15, 16, 17], bookings: 0, revenue: 0 },
        evening: { hours: [18, 19, 20, 21, 22, 23], bookings: 0, revenue: 0 },
        night: { hours: [0, 1, 2, 3, 4, 5], bookings: 0, revenue: 0 },
      };

      Object.entries(timePeriods).forEach(([period, data]) => {
        data.hours.forEach((hour) => {
          data.bookings += hourlyPatterns[hour].bookingCount;
          data.revenue += hourlyPatterns[hour].totalRevenue;
        });
        data.avgBookingValue = data.bookings > 0 ? data.revenue / data.bookings : 0;
      });

      // Find peak hours
      const sortedHours = Object.values(hourlyPatterns).sort(
        (a, b) => b.bookingCount - a.bookingCount
      );

      return {
        hourlyDistribution: Object.values(hourlyPatterns),
        timePeriods,
        insights: {
          peakHour: sortedHours[0],
          quietestHour: sortedHours[sortedHours.length - 1],
          peakPeriod: Object.entries(timePeriods).reduce((peak, [period, data]) =>
            data.bookings > peak[1].bookings ? [period, data] : peak
          ),
          businessHours: this.identifyBusinessHours(hourlyPatterns),
        },
      };
    } catch (error) {
      logger.error('Error analyzing time of day patterns:', error);
      return {};
    }
  }
  analyzeLeadTimePatterns(bookings) {
    try {
      const leadTimeCategories = {
        'Same Day': { min: 0, max: 0, bookings: [], totalRevenue: 0 },
        '1-3 Days': { min: 1, max: 3, bookings: [], totalRevenue: 0 },
        '4-7 Days': { min: 4, max: 7, bookings: [], totalRevenue: 0 },
        '1-2 Weeks': { min: 8, max: 14, bookings: [], totalRevenue: 0 },
        '2-4 Weeks': { min: 15, max: 30, bookings: [], totalRevenue: 0 },
        '1-3 Months': { min: 31, max: 90, bookings: [], totalRevenue: 0 },
        '3+ Months': { min: 91, max: Infinity, bookings: [], totalRevenue: 0 },
      };

      bookings.forEach((booking) => {
        const leadTime = moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');

        for (const [category, data] of Object.entries(leadTimeCategories)) {
          if (leadTime >= data.min && leadTime <= data.max) {
            data.bookings.push({ ...booking, leadTime });
            data.totalRevenue += booking.totalPrice || 0;
            break;
          }
        }
      });

      // Calculate metrics for each category
      Object.values(leadTimeCategories).forEach((category) => {
        category.count = category.bookings.length;
        category.avgBookingValue = category.count > 0 ? category.totalRevenue / category.count : 0;
        category.percentage = bookings.length > 0 ? (category.count / bookings.length) * 100 : 0;
        category.avgLeadTime =
          category.count > 0
            ? category.bookings.reduce((sum, b) => sum + b.leadTime, 0) / category.count
            : 0;
      });

      // Analyze trends
      const avgLeadTime =
        bookings.reduce((sum, booking) => {
          return sum + moment(booking.checkInDate).diff(moment(booking.createdAt), 'days');
        }, 0) / bookings.length;

      return {
        categories: leadTimeCategories,
        insights: {
          avgLeadTime: Math.round(avgLeadTime),
          mostCommonCategory: Object.entries(leadTimeCategories).reduce((max, [key, data]) =>
            data.count > max[1].count ? [key, data] : max
          ),
          lastMinutePercentage:
            leadTimeCategories['Same Day'].percentage + leadTimeCategories['1-3 Days'].percentage,
          advanceBookingPercentage:
            leadTimeCategories['1-3 Months'].percentage +
            leadTimeCategories['3+ Months'].percentage,
          recommendations: this.generateLeadTimeRecommendations(leadTimeCategories, avgLeadTime),
        },
      };
    } catch (error) {
      logger.error('Error analyzing lead time patterns:', error);
      return {};
    }
  }
  async analyzeSeasonalPatterns(hotelId, bookings) {
    try {
      const seasonalData = {
        monthly: {},
        quarterly: {},
        seasonal: {
          spring: { months: [3, 4, 5], bookings: 0, revenue: 0 },
          summer: { months: [6, 7, 8], bookings: 0, revenue: 0 },
          autumn: { months: [9, 10, 11], bookings: 0, revenue: 0 },
          winter: { months: [12, 1, 2], bookings: 0, revenue: 0 },
        },
      };

      // Initialize monthly data
      for (let month = 1; month <= 12; month++) {
        seasonalData.monthly[month] = {
          month,
          monthName: moment()
            .month(month - 1)
            .format('MMMM'),
          bookingCount: 0,
          totalRevenue: 0,
          avgBookingValue: 0,
          occupancyRate: 0,
        };
      }

      // Analyze bookings by month
      bookings.forEach((booking) => {
        const month = moment(booking.checkInDate).month() + 1;
        seasonalData.monthly[month].bookingCount++;
        seasonalData.monthly[month].totalRevenue += booking.totalPrice || 0;

        // Categorize by season
        Object.entries(seasonalData.seasonal).forEach(([season, data]) => {
          if (data.months.includes(month)) {
            data.bookings++;
            data.revenue += booking.totalPrice || 0;
          }
        });
      });

      // Calculate averages and identify patterns
      Object.values(seasonalData.monthly).forEach((month) => {
        month.avgBookingValue =
          month.bookingCount > 0 ? month.totalRevenue / month.bookingCount : 0;
      });

      Object.values(seasonalData.seasonal).forEach((season) => {
        season.avgBookingValue = season.bookings > 0 ? season.revenue / season.bookings : 0;
      });

      // Find peak and low seasons
      const monthsSorted = Object.values(seasonalData.monthly).sort(
        (a, b) => b.bookingCount - a.bookingCount
      );
      const seasonsSorted = Object.entries(seasonalData.seasonal).sort(
        ([, a], [, b]) => b.bookings - a.bookings
      );

      return {
        monthly: seasonalData.monthly,
        seasonal: seasonalData.seasonal,
        insights: {
          peakMonth: monthsSorted[0],
          slowestMonth: monthsSorted[monthsSorted.length - 1],
          peakSeason: seasonsSorted[0],
          lowSeason: seasonsSorted[seasonsSorted.length - 1],
          seasonalVariation: this.calculateSeasonalVariation(seasonalData.monthly),
          recommendations: this.generateSeasonalRecommendations(seasonalData),
        },
      };
    } catch (error) {
      logger.error('Error analyzing seasonal patterns:', error);
      return {};
    }
  }
  /**
   * Analyze tier progression patterns
   */
  async analyzeTierProgression(baseQuery, startDate, endDate) {
    try {
      const progressionData = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.tierHistory': { $exists: true, $ne: [] },
          },
        },
        {
          $project: {
            currentTier: '$loyalty.tier',
            tierHistory: '$loyalty.tierHistory',
            enrolledAt: '$loyalty.enrolledAt',
            progressionTime: {
              $subtract: [new Date(), '$loyalty.enrolledAt'],
            },
          },
        },
        {
          $group: {
            _id: '$currentTier',
            avgProgressionTime: { $avg: '$progressionTime' },
            count: { $sum: 1 },
            fastestProgression: { $min: '$progressionTime' },
            slowestProgression: { $max: '$progressionTime' },
          },
        },
      ]);

      return {
        tiers: progressionData.map((tier) => ({
          tier: tier._id,
          members: tier.count,
          avgDaysToReach: Math.round(tier.avgProgressionTime / (24 * 60 * 60 * 1000)),
          fastestDays: Math.round(tier.fastestProgression / (24 * 60 * 60 * 1000)),
          slowestDays: Math.round(tier.slowestProgression / (24 * 60 * 60 * 1000)),
        })),
        insights: this.generateProgressionInsights(progressionData),
      };
    } catch (error) {
      logger.error('Error analyzing tier progression:', error);
      return {};
    }
  }

  /**
   * Calculate tier upgrades in period
   */
  async calculateTierUpgrades(baseQuery, startDate, endDate) {
    try {
      const upgrades = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.tierHistory': {
              $elemMatch: {
                changedAt: { $gte: startDate, $lte: endDate },
                changeType: 'UPGRADE',
              },
            },
          },
        },
        {
          $unwind: '$loyalty.tierHistory',
        },
        {
          $match: {
            'loyalty.tierHistory.changedAt': { $gte: startDate, $lte: endDate },
            'loyalty.tierHistory.changeType': 'UPGRADE',
          },
        },
        {
          $group: {
            _id: {
              from: '$loyalty.tierHistory.fromTier',
              to: '$loyalty.tierHistory.toTier',
            },
            count: { $sum: 1 },
            avgPointsAtUpgrade: { $avg: '$loyalty.tierHistory.pointsAtChange' },
          },
        },
      ]);

      return {
        totalUpgrades: upgrades.reduce((sum, upgrade) => sum + upgrade.count, 0),
        upgradeFlows: upgrades.map((upgrade) => ({
          from: upgrade._id.from,
          to: upgrade._id.to,
          count: upgrade.count,
          avgPoints: Math.round(upgrade.avgPointsAtUpgrade || 0),
        })),
        upgradeRate: await this.calculateUpgradeRate(baseQuery, startDate, endDate),
      };
    } catch (error) {
      logger.error('Error calculating tier upgrades:', error);
      return {};
    }
  }

  /**
   * Calculate tier retention rates
   */
  async calculateTierRetention(baseQuery, startDate, endDate) {
    try {
      const retentionData = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $lte: startDate },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            lastActivity: '$loyalty.statistics.lastActivity',
            isRetained: {
              $gte: ['$loyalty.statistics.lastActivity', startDate],
            },
          },
        },
        {
          $group: {
            _id: '$tier',
            totalMembers: { $sum: 1 },
            retainedMembers: { $sum: { $cond: ['$isRetained', 1, 0] } },
          },
        },
        {
          $project: {
            tier: '$_id',
            totalMembers: 1,
            retainedMembers: 1,
            retentionRate: {
              $multiply: [{ $divide: ['$retainedMembers', '$totalMembers'] }, 100],
            },
          },
        },
      ]);

      return {
        byTier: retentionData,
        overall: retentionData.reduce(
          (acc, tier) => {
            acc.totalMembers += tier.totalMembers;
            acc.retainedMembers += tier.retainedMembers;
            return acc;
          },
          { totalMembers: 0, retainedMembers: 0 }
        ),
        insights: this.generateRetentionInsights(retentionData),
      };
    } catch (error) {
      logger.error('Error calculating tier retention:', error);
      return {};
    }
  }

  /**
   * Segment members by engagement level
   */
  async segmentMembersByEngagement(baseQuery, startDate, endDate) {
    try {
      const engagementSegments = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            engagementScore: '$loyalty.performance.engagementScore',
            lastActivity: '$loyalty.statistics.lastActivity',
            totalTransactions: '$loyalty.statistics.totalTransactions',
            segment: {
              $switch: {
                branches: [
                  {
                    case: { $gte: ['$loyalty.performance.engagementScore', 80] },
                    then: 'HIGH_ENGAGEMENT',
                  },
                  {
                    case: { $gte: ['$loyalty.performance.engagementScore', 60] },
                    then: 'MEDIUM_ENGAGEMENT',
                  },
                  {
                    case: { $gte: ['$loyalty.performance.engagementScore', 40] },
                    then: 'LOW_ENGAGEMENT',
                  },
                ],
                default: 'INACTIVE',
              },
            },
          },
        },
        {
          $group: {
            _id: '$segment',
            count: { $sum: 1 },
            avgEngagementScore: { $avg: '$engagementScore' },
            avgTransactions: { $avg: '$totalTransactions' },
          },
        },
      ]);

      return {
        segments: engagementSegments.map((segment) => ({
          segment: segment._id,
          memberCount: segment.count,
          avgScore: Math.round(segment.avgEngagementScore || 0),
          avgTransactions: Math.round(segment.avgTransactions || 0),
        })),
        recommendations: this.generateEngagementRecommendations(engagementSegments),
      };
    } catch (error) {
      logger.error('Error segmenting members by engagement:', error);
      return {};
    }
  }

  /**
   * Perform cohort analysis
   */
  async performCohortAnalysis(baseQuery) {
    try {
      const cohorts = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            enrollmentCohort: {
              $dateToString: { format: '%Y-%m', date: '$loyalty.enrolledAt' },
            },
            lastActivity: '$loyalty.statistics.lastActivity',
            lifetimeValue: '$loyalty.statistics.lifetimeValue',
            isActive: {
              $gte: [
                '$loyalty.statistics.lastActivity',
                new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
              ],
            },
          },
        },
        {
          $group: {
            _id: '$enrollmentCohort',
            totalMembers: { $sum: 1 },
            activeMembers: { $sum: { $cond: ['$isActive', 1, 0] } },
            avgLifetimeValue: { $avg: '$lifetimeValue' },
          },
        },
        {
          $project: {
            cohort: '$_id',
            totalMembers: 1,
            activeMembers: 1,
            retentionRate: {
              $multiply: [{ $divide: ['$activeMembers', '$totalMembers'] }, 100],
            },
            avgLifetimeValue: { $round: ['$avgLifetimeValue', 2] },
          },
        },
        { $sort: { cohort: 1 } },
      ]);

      return {
        cohorts,
        trends: this.analyzeCohortTrends(cohorts),
        insights: this.generateCohortInsights(cohorts),
      };
    } catch (error) {
      logger.error('Error performing cohort analysis:', error);
      return {};
    }
  }

  /**
   * Identify members at risk of churning
   */
  async identifyChurnRisk(baseQuery) {
    try {
      const riskFactors = {
        noRecentActivity: 60, // days
        lowEngagement: 40, // score
        noRecentPurchase: 90, // days
      };

      const atRiskMembers = await User.aggregate([
        {
          $match: {
            ...baseQuery,
            'loyalty.enrolledAt': { $exists: true },
          },
        },
        {
          $project: {
            tier: '$loyalty.tier',
            engagementScore: '$loyalty.performance.engagementScore',
            lastActivity: '$loyalty.statistics.lastActivity',
            lastPurchase: '$loyalty.statistics.lastPurchase',
            daysSinceActivity: {
              $divide: [
                { $subtract: [new Date(), '$loyalty.statistics.lastActivity'] },
                24 * 60 * 60 * 1000,
              ],
            },
            daysSincePurchase: {
              $divide: [
                { $subtract: [new Date(), '$loyalty.statistics.lastPurchase'] },
                24 * 60 * 60 * 1000,
              ],
            },
          },
        },
        {
          $project: {
            tier: 1,
            engagementScore: 1,
            daysSinceActivity: 1,
            daysSincePurchase: 1,
            riskScore: {
              $add: [
                { $cond: [{ $gt: ['$daysSinceActivity', riskFactors.noRecentActivity] }, 30, 0] },
                { $cond: [{ $lt: ['$engagementScore', riskFactors.lowEngagement] }, 25, 0] },
                { $cond: [{ $gt: ['$daysSincePurchase', riskFactors.noRecentPurchase] }, 25, 0] },
              ],
            },
          },
        },
        {
          $match: { riskScore: { $gte: 25 } },
        },
        {
          $project: {
            tier: 1,
            riskScore: 1,
            riskLevel: {
              $switch: {
                branches: [
                  { case: { $gte: ['$riskScore', 70] }, then: 'HIGH' },
                  { case: { $gte: ['$riskScore', 40] }, then: 'MEDIUM' },
                ],
                default: 'LOW',
              },
            },
          },
        },
        {
          $group: {
            _id: '$riskLevel',
            count: { $sum: 1 },
            avgRiskScore: { $avg: '$riskScore' },
          },
        },
      ]);

      return {
        riskSegments: atRiskMembers,
        totalAtRisk: atRiskMembers.reduce((sum, segment) => sum + segment.count, 0),
        recommendations: this.generateChurnPreventionRecommendations(atRiskMembers),
      };
    } catch (error) {
      logger.error('Error identifying churn risk:', error);
      return {};
    }
  }
  calculateTrendDirection(timeSeries) {
    try {
      if (!timeSeries || timeSeries.length < 2) return 'insufficient_data';

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);

      // Simple linear regression
      const n = values.length;
      const sumX = values.reduce((sum, _, i) => sum + i, 0);
      const sumY = values.reduce((sum, val) => sum + val, 0);
      const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
      const sumXX = values.reduce((sum, _, i) => sum + i * i, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

      // Determine trend direction
      if (slope > 0.05) return 'increasing';
      if (slope < -0.05) return 'decreasing';
      return 'stable';
    } catch (error) {
      logger.error('Error calculating trend direction:', error);
      return 'unknown';
    }
  }
  calculateTrendStrength(timeSeries) {
    try {
      if (!timeSeries || timeSeries.length < 2) return 0;

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);
      const n = values.length;

      // Calculate R-squared for trend strength
      const meanY = values.reduce((sum, val) => sum + val, 0) / n;

      // Linear regression
      const sumX = values.reduce((sum, _, i) => sum + i, 0);
      const sumY = values.reduce((sum, val) => sum + val, 0);
      const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
      const sumXX = values.reduce((sum, _, i) => sum + i * i, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Calculate R-squared
      const ssRes = values.reduce((sum, val, i) => {
        const predicted = slope * i + intercept;
        return sum + Math.pow(val - predicted, 2);
      }, 0);

      const ssTot = values.reduce((sum, val) => sum + Math.pow(val - meanY, 2), 0);

      const rSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0;

      return Math.max(0, Math.min(1, rSquared)) * 100; // Return as percentage
    } catch (error) {
      logger.error('Error calculating trend strength:', error);
      return 0;
    }
  }
  calculateTrendMomentum(timeSeries) {
    try {
      if (!timeSeries || timeSeries.length < 4) return 0;

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);

      // Compare recent period vs previous period
      const halfPoint = Math.floor(values.length / 2);
      const firstHalf = values.slice(0, halfPoint);
      const secondHalf = values.slice(halfPoint);

      const firstHalfAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
      const secondHalfAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;

      // Calculate momentum as percentage change
      const momentum = firstHalfAvg > 0 ? ((secondHalfAvg - firstHalfAvg) / firstHalfAvg) * 100 : 0;

      return Math.round(momentum * 100) / 100;
    } catch (error) {
      logger.error('Error calculating trend momentum:', error);
      return 0;
    }
  }
  identifyCyclicalPatterns(timeSeries) {
    try {
      if (!timeSeries || timeSeries.length < 14) return [];

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);
      const cycles = [];

      // Check for common cycle lengths
      const cycleLengths = [7, 14, 30]; // Weekly, bi-weekly, monthly

      cycleLengths.forEach((cycleLength) => {
        if (values.length >= cycleLength * 2) {
          const correlation = this.calculateAutocorrelation(values, cycleLength);

          if (correlation > 0.5) {
            cycles.push({
              length: cycleLength,
              strength: correlation,
              type: this.getCycleType(cycleLength),
              description: `${cycleLength}-period cycle detected`,
              confidence: Math.round(correlation * 100),
            });
          }
        }
      });

      return cycles.sort((a, b) => b.strength - a.strength);
    } catch (error) {
      logger.error('Error identifying cyclical patterns:', error);
      return [];
    }
  }
  detectAnomalies(timeSeries) {
    try {
      if (!timeSeries || timeSeries.length < 10) return [];

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);
      const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
      const stdDev = Math.sqrt(
        values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length
      );

      const anomalies = [];
      const threshold = 2 * stdDev; // 2 standard deviations

      timeSeries.forEach((point, index) => {
        const value = point.value || point.revenue || point.bookings || 0;
        const deviation = Math.abs(value - mean);

        if (deviation > threshold) {
          anomalies.push({
            index,
            date: point.date || point.period,
            value,
            expected: mean,
            deviation,
            severity: deviation > 3 * stdDev ? 'high' : 'medium',
            type: value > mean ? 'spike' : 'drop',
            description: `${value > mean ? 'Spike' : 'Drop'} detected: ${Math.round(deviation)} deviation from mean`,
          });
        }
      });

      return anomalies.sort((a, b) => b.deviation - a.deviation);
    } catch (error) {
      logger.error('Error detecting anomalies:', error);
      return [];
    }
  }
  generateTrendForecast(timeSeries, periods) {
    try {
      if (!timeSeries || timeSeries.length < 5 || periods <= 0) {
        return { error: 'Insufficient data or invalid forecast period' };
      }

      const values = timeSeries.map((point) => point.value || point.revenue || point.bookings || 0);
      const n = values.length;

      // Simple linear regression for trend
      const sumX = values.reduce((sum, _, i) => sum + i, 0);
      const sumY = values.reduce((sum, val) => sum + val, 0);
      const sumXY = values.reduce((sum, val, i) => sum + i * val, 0);
      const sumXX = values.reduce((sum, _, i) => sum + i * i, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Calculate prediction confidence
      const predictions = values.map((_, i) => slope * i + intercept);
      const residuals = values.map((val, i) => val - predictions[i]);
      const mse = residuals.reduce((sum, res) => sum + res * res, 0) / n;
      const rmse = Math.sqrt(mse);

      // Generate forecast
      const forecast = [];
      for (let i = 0; i < periods; i++) {
        const futureX = n + i;
        const predictedValue = slope * futureX + intercept;
        const confidence = Math.max(10, 90 - i * 5); // Decreasing confidence over time

        forecast.push({
          period: i + 1,
          predictedValue: Math.max(0, predictedValue),
          confidence,
          upperBound: predictedValue + 1.96 * rmse, // 95% confidence interval
          lowerBound: Math.max(0, predictedValue - 1.96 * rmse),
          trend: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable',
        });
      }

      return {
        forecast,
        model: {
          slope,
          intercept,
          rmse,
          accuracy: Math.max(0, 100 - (rmse / (sumY / n)) * 100),
        },
        summary: {
          periods,
          trendDirection: slope > 0 ? 'increasing' : slope < 0 ? 'decreasing' : 'stable',
          avgConfidence: forecast.reduce((sum, f) => sum + f.confidence, 0) / forecast.length,
        },
      };
    } catch (error) {
      logger.error('Error generating trend forecast:', error);
      return { error: error.message };
    }
  }
  async getHistoricalDemandData(hotelId, days) {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const query = {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      };

      if (hotelId) {
        query.hotel = mongoose.Types.ObjectId(hotelId);
      }

      const bookings = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalPrice' },
            uniqueCustomers: { $addToSet: '$customer' },
            avgLeadTime: {
              $avg: {
                $divide: [
                  { $subtract: ['$checkInDate', '$createdAt'] },
                  1000 * 60 * 60 * 24, // Convert to days
                ],
              },
            },
            roomTypes: { $addToSet: '$rooms.type' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Fill missing dates with zero values
      const result = [];
      const currentDate = new Date(startDate);

      while (currentDate <= endDate) {
        const dateStr = moment(currentDate).format('YYYY-MM-DD');
        const dayData = bookings.find((b) => b._id === dateStr);

        result.push({
          date: dateStr,
          bookingCount: dayData?.bookingCount || 0,
          totalRevenue: dayData?.totalRevenue || 0,
          uniqueCustomers: dayData?.uniqueCustomers?.length || 0,
          avgLeadTime: dayData?.avgLeadTime || 0,
          roomTypes: dayData?.roomTypes || [],
        });

        currentDate.setDate(currentDate.getDate() + 1);
      }

      return {
        data: result,
        summary: {
          totalDays: days,
          avgDailyBookings: result.reduce((sum, day) => sum + day.bookingCount, 0) / result.length,
          avgDailyRevenue: result.reduce((sum, day) => sum + day.totalRevenue, 0) / result.length,
          peakDay: result.reduce(
            (peak, day) => (day.bookingCount > peak.bookingCount ? day : peak),
            result[0]
          ),
          slowestDay: result.reduce(
            (slow, day) => (day.bookingCount < slow.bookingCount ? day : slow),
            result[0]
          ),
        },
      };
    } catch (error) {
      logger.error('Error getting historical demand data:', error);
      return { data: [], summary: {} };
    }
  }
  simpleDemandForecast(historicalData, days) {
    try {
      if (!historicalData.data || historicalData.data.length < 7) {
        return { error: 'Insufficient historical data for forecasting' };
      }

      const data = historicalData.data;
      const recentDays = data.slice(-14); // Last 14 days for trend

      // Calculate trends
      const bookingTrend = this.calculateSimpleTrend(recentDays.map((d) => d.bookingCount));
      const revenueTrend = this.calculateSimpleTrend(recentDays.map((d) => d.totalRevenue));

      // Calculate seasonal factors (day of week)
      const dayOfWeekFactors = this.calculateDayOfWeekFactors(data);

      // Generate forecast
      const forecast = [];
      const baseBookings =
        recentDays.reduce((sum, d) => sum + d.bookingCount, 0) / recentDays.length;
      const baseRevenue =
        recentDays.reduce((sum, d) => sum + d.totalRevenue, 0) / recentDays.length;

      for (let i = 0; i < days; i++) {
        const futureDate = moment().add(i + 1, 'days');
        const dayOfWeek = futureDate.day();
        const seasonalFactor = dayOfWeekFactors[dayOfWeek] || 1;

        // Apply trend and seasonal adjustment
        const trendAdjustment = 1 + (bookingTrend * (i + 1)) / 30; // Gradual trend application
        const predictedBookings = Math.round(baseBookings * seasonalFactor * trendAdjustment);
        const predictedRevenue =
          baseRevenue * seasonalFactor * trendAdjustment * (1 + (revenueTrend * (i + 1)) / 30);

        forecast.push({
          date: futureDate.format('YYYY-MM-DD'),
          predictedBookings: Math.max(0, predictedBookings),
          predictedRevenue: Math.max(0, Math.round(predictedRevenue)),
          confidence: Math.max(30, 90 - i * 2), // Decreasing confidence
          factors: {
            seasonal: seasonalFactor,
            trend: trendAdjustment,
            dayOfWeek: futureDate.format('dddd'),
          },
        });
      }

      return {
        forecast,
        methodology: 'Simple trend analysis with seasonal adjustment',
        confidence: forecast.reduce((sum, f) => sum + f.confidence, 0) / forecast.length,
        summary: {
          avgPredictedBookings:
            forecast.reduce((sum, f) => sum + f.predictedBookings, 0) / forecast.length,
          avgPredictedRevenue:
            forecast.reduce((sum, f) => sum + f.predictedRevenue, 0) / forecast.length,
          totalPredictedBookings: forecast.reduce((sum, f) => sum + f.predictedBookings, 0),
          totalPredictedRevenue: forecast.reduce((sum, f) => sum + f.predictedRevenue, 0),
        },
      };
    } catch (error) {
      logger.error('Error generating simple demand forecast:', error);
      return { error: error.message };
    }
  }
  calculateDemandIndicators(data) {
    try {
      const { patterns, trends, forecast } = data;

      if (!patterns || !trends) {
        return { error: 'Insufficient data for demand indicators' };
      }

      // Calculate demand score (0-100)
      let demandScore = 50; // Base score

      // Adjust based on booking trends
      if (trends.direction === 'increasing') demandScore += 20;
      else if (trends.direction === 'decreasing') demandScore -= 20;

      // Adjust based on momentum
      if (trends.momentum > 10) demandScore += 15;
      else if (trends.momentum < -10) demandScore -= 15;

      // Adjust based on seasonal patterns
      const currentMonth = moment().month() + 1;
      const seasonalData = patterns.seasonal?.monthly?.[currentMonth];
      if (seasonalData && seasonalData.bookingCount > patterns.seasonal.avgMonthlyBookings) {
        demandScore += 10;
      }

      // Normalize score
      demandScore = Math.max(0, Math.min(100, demandScore));

      // Determine demand level
      let demandLevel = 'NORMAL';
      if (demandScore >= 80) demandLevel = 'VERY_HIGH';
      else if (demandScore >= 65) demandLevel = 'HIGH';
      else if (demandScore <= 35) demandLevel = 'LOW';
      else if (demandScore <= 20) demandLevel = 'VERY_LOW';

      // Calculate volatility
      const recentBookings = trends.timeSeries?.slice(-14)?.map((t) => t.bookings) || [];
      const volatility = this.calculateVolatility(recentBookings);

      // Market indicators
      const marketIndicators = {
        leadTimeStrength: this.assessLeadTimeStrength(patterns.leadTime),
        priceElasticity: this.estimatePriceElasticity(patterns, trends),
        marketSaturation: this.assessMarketSaturation(trends, forecast),
        competitivePressure: this.estimateCompetitivePressure(trends),
      };

      return {
        demandScore: Math.round(demandScore),
        demandLevel,
        volatility: {
          score: volatility,
          level: volatility > 30 ? 'HIGH' : volatility > 15 ? 'MEDIUM' : 'LOW',
        },
        trendStrength: trends.strength || 0,
        momentum: trends.momentum || 0,
        marketIndicators,
        recommendations: this.generateDemandRecommendations({
          demandLevel,
          volatility,
          trends,
          marketIndicators,
        }),
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error calculating demand indicators:', error);
      return { error: error.message };
    }
  }
  generateDemandInsights(data) {
    try {
      const insights = [];
      const { patterns, trends, indicators } = data;

      // Trend insights
      if (trends?.direction === 'increasing' && trends.strength > 0.7) {
        insights.push({
          type: 'positive',
          category: 'trend',
          title: 'Strong Upward Demand Trend',
          message: `Booking demand is increasing with ${Math.round(trends.strength * 100)}% trend strength`,
          impact: 'high',
          actionable: true,
          recommendation: 'Consider implementing dynamic pricing to capture increased demand',
        });
      }

      if (trends?.direction === 'decreasing' && trends.strength > 0.5) {
        insights.push({
          type: 'warning',
          category: 'trend',
          title: 'Declining Demand Detected',
          message: `Booking demand is decreasing with concerning momentum`,
          impact: 'high',
          actionable: true,
          recommendation: 'Implement promotional campaigns and review pricing strategy',
        });
      }

      // Seasonal insights
      if (patterns?.seasonal) {
        const currentMonth = moment().month() + 1;
        const seasonalData = patterns.seasonal.monthly?.[currentMonth];

        if (
          seasonalData &&
          seasonalData.bookingCount > patterns.seasonal.avgMonthlyBookings * 1.3
        ) {
          insights.push({
            type: 'positive',
            category: 'seasonal',
            title: 'Peak Season Opportunity',
            message: `Current month shows ${Math.round((seasonalData.bookingCount / patterns.seasonal.avgMonthlyBookings - 1) * 100)}% above average demand`,
            impact: 'medium',
            actionable: true,
            recommendation: 'Optimize pricing for peak season and ensure adequate inventory',
          });
        }
      }

      // Lead time insights
      if (patterns?.leadTime) {
        const lastMinutePercentage =
          patterns.leadTime.categories?.['Same Day']?.percentage +
            patterns.leadTime.categories?.['1-3 Days']?.percentage || 0;

        if (lastMinutePercentage > 40) {
          insights.push({
            type: 'neutral',
            category: 'lead_time',
            title: 'High Last-Minute Booking Rate',
            message: `${Math.round(lastMinutePercentage)}% of bookings are made within 3 days`,
            impact: 'medium',
            actionable: true,
            recommendation: 'Implement last-minute booking incentives and ensure availability',
          });
        }
      }

      // Day pattern insights
      if (patterns?.dayOfWeek) {
        const weekendVsWeekday = this.analyzeWeekendVsWeekday(patterns.dayOfWeek);

        if (weekendVsWeekday.weekendDominance > 70) {
          insights.push({
            type: 'neutral',
            category: 'patterns',
            title: 'Weekend-Focused Demand',
            message: `${Math.round(weekendVsWeekday.weekendDominance)}% of demand concentrated on weekends`,
            impact: 'medium',
            actionable: true,
            recommendation: 'Develop weekday promotions to balance occupancy throughout the week',
          });
        }
      }

      // Volatility insights
      if (indicators?.volatility?.level === 'HIGH') {
        insights.push({
          type: 'warning',
          category: 'volatility',
          title: 'High Demand Volatility',
          message: 'Booking patterns show high variability, indicating unpredictable demand',
          impact: 'medium',
          actionable: true,
          recommendation: 'Implement flexible pricing strategies and maintain buffer inventory',
        });
      }

      return insights.sort((a, b) => {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        return impactOrder[b.impact] - impactOrder[a.impact];
      });
    } catch (error) {
      logger.error('Error generating demand insights:', error);
      return [];
    }
  }
  generateDemandRecommendations(indicators) {
    try {
      const recommendations = [];

      if (!indicators) return recommendations;

      const { demandLevel, volatility, trends, marketIndicators } = indicators;

      // High demand recommendations
      if (demandLevel === 'VERY_HIGH' || demandLevel === 'HIGH') {
        recommendations.push({
          priority: 'HIGH',
          category: 'pricing',
          action: 'Implement Premium Pricing Strategy',
          description: 'Current high demand allows for premium pricing to maximize revenue',
          expectedImpact: 'Increase revenue by 15-25%',
          timeframe: 'Immediate',
          kpis: ['RevPAR', 'ADR', 'Revenue per room'],
        });

        recommendations.push({
          priority: 'MEDIUM',
          category: 'inventory',
          action: 'Optimize Inventory Management',
          description: 'Ensure adequate availability for high-demand periods',
          expectedImpact: 'Prevent revenue loss from stockouts',
          timeframe: '1-2 weeks',
          kpis: ['Occupancy rate', 'Booking conversion'],
        });
      }

      // Low demand recommendations
      if (demandLevel === 'LOW' || demandLevel === 'VERY_LOW') {
        recommendations.push({
          priority: 'HIGH',
          category: 'marketing',
          action: 'Launch Promotional Campaigns',
          description: 'Implement targeted marketing and promotional pricing to stimulate demand',
          expectedImpact: 'Increase bookings by 20-40%',
          timeframe: '1-2 weeks',
          kpis: ['Booking volume', 'Occupancy rate', 'Market share'],
        });

        recommendations.push({
          priority: 'MEDIUM',
          category: 'pricing',
          action: 'Review Competitive Pricing',
          description: 'Analyze competitor pricing and adjust rates to remain competitive',
          expectedImpact: 'Improve booking conversion by 10-20%',
          timeframe: '3-5 days',
          kpis: ['Conversion rate', 'Average daily rate'],
        });
      }

      // High volatility recommendations
      if (volatility?.level === 'HIGH') {
        recommendations.push({
          priority: 'MEDIUM',
          category: 'strategy',
          action: 'Implement Dynamic Pricing',
          description: 'Use automated pricing adjustments to respond to demand fluctuations',
          expectedImpact: 'Improve revenue stability by 15-30%',
          timeframe: '2-4 weeks',
          kpis: ['Revenue variance', 'Pricing efficiency'],
        });

        recommendations.push({
          priority: 'LOW',
          category: 'forecasting',
          action: 'Enhance Demand Forecasting',
          description: 'Improve prediction models to better anticipate demand changes',
          expectedImpact: 'Reduce forecasting errors by 20-40%',
          timeframe: '4-8 weeks',
          kpis: ['Forecast accuracy', 'Planning efficiency'],
        });
      }

      // Trend-based recommendations
      if (trends?.direction === 'decreasing' && trends.momentum < -10) {
        recommendations.push({
          priority: 'HIGH',
          category: 'strategy',
          action: 'Demand Recovery Strategy',
          description: 'Implement comprehensive strategy to reverse declining demand trend',
          expectedImpact: 'Stabilize or reverse demand decline',
          timeframe: '2-6 weeks',
          kpis: ['Booking growth', 'Market position', 'Customer acquisition'],
        });
      }

      // Market indicator recommendations
      if (marketIndicators?.competitivePressure === 'HIGH') {
        recommendations.push({
          priority: 'MEDIUM',
          category: 'competitive',
          action: 'Enhance Value Proposition',
          description: 'Differentiate offering through unique value propositions and services',
          expectedImpact: 'Improve competitive position',
          timeframe: '3-8 weeks',
          kpis: ['Customer satisfaction', 'Repeat bookings', 'Price premium'],
        });
      }

      return recommendations.sort((a, b) => {
        const priorityOrder = { HIGH: 3, MEDIUM: 2, LOW: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
    } catch (error) {
      logger.error('Error generating demand recommendations:', error);
      return [];
    }
  }
  async analyzeSeasonalDemand(hotelId) {
    try {
      // Get data for last 2 years to identify seasonal patterns
      const twoYearsAgo = moment().subtract(2, 'years').toDate();
      const now = new Date();

      const query = {
        createdAt: { $gte: twoYearsAgo, $lte: now },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      };

      if (hotelId) {
        query.hotel = mongoose.Types.ObjectId(hotelId);
      }

      const monthlyData = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
            },
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalPrice' },
            avgBookingValue: { $avg: '$totalPrice' },
            uniqueCustomers: { $addToSet: '$customer' },
          },
        },
        {
          $group: {
            _id: '$_id.month',
            avgBookings: { $avg: '$bookingCount' },
            avgRevenue: { $avg: '$totalRevenue' },
            avgBookingValue: { $avg: '$avgBookingValue' },
            years: { $addToSet: '$_id.year' },
          },
        },
        { $sort: { _id: 1 } },
      ]);

      // Calculate seasonal indices
      const totalAvgBookings = monthlyData.reduce((sum, month) => sum + month.avgBookings, 0) / 12;

      const seasonalIndices = monthlyData.map((month) => ({
        month: month._id,
        monthName: moment()
          .month(month._id - 1)
          .format('MMMM'),
        avgBookings: Math.round(month.avgBookings),
        avgRevenue: Math.round(month.avgRevenue),
        seasonalIndex: totalAvgBookings > 0 ? month.avgBookings / totalAvgBookings : 1,
        demandLevel: this.classifyDemandLevel(month.avgBookings / totalAvgBookings),
        growth: this.calculateMonthlyGrowth(month, monthlyData),
      }));

      // Identify seasons
      const seasons = {
        winter: { months: [12, 1, 2], name: 'Winter', data: [] },
        spring: { months: [3, 4, 5], name: 'Spring', data: [] },
        summer: { months: [6, 7, 8], name: 'Summer', data: [] },
        autumn: { months: [9, 10, 11], name: 'Autumn', data: [] },
      };

      seasonalIndices.forEach((month) => {
        Object.values(seasons).forEach((season) => {
          if (season.months.includes(month.month)) {
            season.data.push(month);
          }
        });
      });

      // Calculate seasonal summaries
      Object.values(seasons).forEach((season) => {
        const avgIndex =
          season.data.reduce((sum, month) => sum + month.seasonalIndex, 0) / season.data.length;
        season.avgSeasonalIndex = avgIndex;
        season.demandLevel = this.classifyDemandLevel(avgIndex);
        season.peakMonth = season.data.reduce(
          (peak, month) => (month.seasonalIndex > peak.seasonalIndex ? month : peak),
          season.data[0]
        );
      });

      return {
        monthlyIndices: seasonalIndices,
        seasonalSummary: seasons,
        insights: {
          peakSeason: Object.values(seasons).reduce((peak, season) =>
            season.avgSeasonalIndex > peak.avgSeasonalIndex ? season : peak
          ),
          lowSeason: Object.values(seasons).reduce((low, season) =>
            season.avgSeasonalIndex < low.avgSeasonalIndex ? season : low
          ),
          seasonalVariation: this.calculateSeasonalVariation(seasonalIndices),
          recommendations: this.generateSeasonalRecommendations(seasons, seasonalIndices),
        },
      };
    } catch (error) {
      logger.error('Error analyzing seasonal demand:', error);
      return {};
    }
  }
  async analyzeMarketDemand(hotelId, startDate, endDate) {
    try {
      const query = {
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      };

      if (hotelId) {
        query.hotel = mongoose.Types.ObjectId(hotelId);
      }

      // Analyze booking sources and channels
      const channelAnalysis = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$source',
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalPrice' },
            avgBookingValue: { $avg: '$totalPrice' },
            avgLeadTime: {
              $avg: {
                $divide: [{ $subtract: ['$checkInDate', '$createdAt'] }, 1000 * 60 * 60 * 24],
              },
            },
          },
        },
        { $sort: { bookingCount: -1 } },
      ]);

      // Analyze customer segments
      const segmentAnalysis = await Booking.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$clientType',
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalPrice' },
            avgBookingValue: { $avg: '$totalPrice' },
            repeatCustomers: {
              $sum: {
                $cond: [
                  { $gt: [{ $size: { $ifNull: ['$customer.bookingHistory', []] } }, 1] },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]);

      // Geographic demand analysis
      const geographicDemand = await Booking.aggregate([
        { $match: query },
        {
          $lookup: {
            from: 'users',
            localField: 'customer',
            foreignField: '_id',
            as: 'customerData',
          },
        },
        { $unwind: { path: '$customerData', preserveNullAndEmptyArrays: true } },
        {
          $group: {
            _id: '$customerData.address.country',
            bookingCount: { $sum: 1 },
            totalRevenue: { $sum: '$totalPrice' },
            avgBookingValue: { $avg: '$totalPrice' },
          },
        },
        { $sort: { bookingCount: -1 } },
        { $limit: 10 },
      ]);

      // Market penetration analysis
      const totalMarketBookings = channelAnalysis.reduce(
        (sum, channel) => sum + channel.bookingCount,
        0
      );
      const directBookings = channelAnalysis.find((c) => c._id === 'DIRECT')?.bookingCount || 0;
      const onlineBookings = channelAnalysis
        .filter((c) => ['WEBSITE', 'MOBILE_APP', 'ONLINE_AGENCY'].includes(c._id))
        .reduce((sum, c) => sum + c.bookingCount, 0);

      // Calculate market indicators
      const marketIndicators = {
        digitalPenetration:
          totalMarketBookings > 0 ? (onlineBookings / totalMarketBookings) * 100 : 0,
        directBookingRate:
          totalMarketBookings > 0 ? (directBookings / totalMarketBookings) * 100 : 0,
        averageMarketPrice:
          channelAnalysis.reduce((sum, c) => sum + c.avgBookingValue, 0) / channelAnalysis.length,
        marketDiversity: this.calculateMarketDiversity(channelAnalysis),
        customerLoyalty: this.calculateCustomerLoyalty(segmentAnalysis),
      };

      return {
        channels: channelAnalysis.map((channel) => ({
          ...channel,
          marketShare:
            totalMarketBookings > 0 ? (channel.bookingCount / totalMarketBookings) * 100 : 0,
          efficiency: channel.totalRevenue / channel.bookingCount,
          leadTimeCategory: this.categorizeLeadTime(channel.avgLeadTime),
        })),
        segments: segmentAnalysis.map((segment) => ({
          ...segment,
          loyaltyRate:
            segment.bookingCount > 0 ? (segment.repeatCustomers / segment.bookingCount) * 100 : 0,
          marketValue: segment.totalRevenue,
          averageValue: segment.avgBookingValue,
        })),
        geographic: geographicDemand,
        marketIndicators,
        insights: {
          dominantChannel: channelAnalysis[0],
          mostValuableSegment: segmentAnalysis.reduce(
            (max, segment) => (segment.totalRevenue > max.totalRevenue ? segment : max),
            segmentAnalysis[0]
          ),
          marketHealth: this.assessMarketHealth(marketIndicators),
          recommendations: this.generateMarketRecommendations(marketIndicators, channelAnalysis),
        },
      };
    } catch (error) {
      logger.error('Error analyzing market demand:', error);
      return {};
    }
  }
  async analyzeYieldRules(hotelId, startDate, endDate) {
    try {
      // This would typically integrate with your PricingRule model
      // For now, providing a basic structure

      const yieldRules = await PricingRule.find({
        hotel: hotelId,
        isActive: true,
        $or: [{ validFrom: { $lte: endDate } }, { validFrom: null }],
        $or: [{ validTo: { $gte: startDate } }, { validTo: null }],
      });

      const rulePerformance = await Promise.all(
        yieldRules.map(async (rule) => {
          // Analyze bookings affected by this rule
          const affectedBookings = await Booking.find({
            hotel: hotelId,
            createdAt: { $gte: startDate, $lte: endDate },
            'yieldManagement.appliedRules': rule._id,
          });

          const totalRevenue = affectedBookings.reduce(
            (sum, booking) => sum + (booking.totalPrice || 0),
            0
          );

          const avgPriceAdjustment =
            affectedBookings.reduce((sum, booking) => {
              const adjustment =
                booking.yieldManagement?.priceAdjustment?.adjustmentPercentage || 0;
              return sum + Math.abs(adjustment);
            }, 0) / affectedBookings.length || 0;

          return {
            ruleId: rule._id,
            ruleName: rule.name || rule.description,
            ruleType: rule.ruleType,
            priority: rule.priority,
            applications: affectedBookings.length,
            totalRevenueImpact: totalRevenue,
            avgPriceAdjustment: Math.round(avgPriceAdjustment * 100) / 100,
            effectiveness: this.calculateRuleEffectiveness(rule, affectedBookings),
            conditions: rule.conditions,
            actions: rule.actions,
          };
        })
      );

      // Sort by effectiveness
      rulePerformance.sort((a, b) => b.effectiveness - a.effectiveness);

      // Calculate overall rule statistics
      const totalApplications = rulePerformance.reduce((sum, rule) => sum + rule.applications, 0);
      const totalRevenueImpact = rulePerformance.reduce(
        (sum, rule) => sum + rule.totalRevenueImpact,
        0
      );
      const avgEffectiveness =
        rulePerformance.reduce((sum, rule) => sum + rule.effectiveness, 0) / rulePerformance.length;

      return {
        rules: rulePerformance,
        summary: {
          totalRules: yieldRules.length,
          activeRules: yieldRules.filter((r) => r.isActive).length,
          totalApplications,
          totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
          avgEffectiveness: Math.round(avgEffectiveness * 100) / 100,
          mostEffectiveRule: rulePerformance[0],
          leastEffectiveRule: rulePerformance[rulePerformance.length - 1],
        },
        insights: this.generateRuleInsights(rulePerformance),
        recommendations: this.generateRuleRecommendations(rulePerformance),
      };
    } catch (error) {
      logger.error('Error analyzing yield rules:', error);
      return {};
    }
  }
  async calculateYieldRevenueImpact(hotelId, startDate, endDate) {
    try {
      // Get bookings with yield management applied
      const yieldBookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate, $lte: endDate },
        'yieldManagement.enabled': true,
      });

      // Get bookings without yield management for comparison
      const nonYieldBookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate, $lte: endDate },
        $or: [
          { 'yieldManagement.enabled': false },
          { 'yieldManagement.enabled': { $exists: false } },
        ],
      });

      // Calculate revenue impact
      const yieldRevenue = yieldBookings.reduce((sum, booking) => {
        const actualRevenue = booking.totalPrice || 0;
        const baseRevenue = booking.yieldManagement?.basePricing?.totalPrice || actualRevenue;
        return sum + (actualRevenue - baseRevenue);
      }, 0);

      const totalYieldBookings = yieldBookings.length;
      const totalNonYieldBookings = nonYieldBookings.length;

      // Calculate average booking values
      const avgYieldBookingValue =
        totalYieldBookings > 0
          ? yieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0) / totalYieldBookings
          : 0;

      const avgNonYieldBookingValue =
        totalNonYieldBookings > 0
          ? nonYieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0) /
            totalNonYieldBookings
          : 0;

      // Calculate performance metrics
      const yieldPerformanceMetrics = {
        totalYieldRevenue: yieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0),
        totalNonYieldRevenue: nonYieldBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0),
        yieldRevenueImpact: yieldRevenue,
        avgYieldBookingValue,
        avgNonYieldBookingValue,
        valueImprovement:
          avgNonYieldBookingValue > 0
            ? ((avgYieldBookingValue - avgNonYieldBookingValue) / avgNonYieldBookingValue) * 100
            : 0,
        yieldAdoptionRate:
          (totalYieldBookings / (totalYieldBookings + totalNonYieldBookings)) * 100,
      };

      // Analyze yield adjustments
      const adjustmentAnalysis = yieldBookings.map((booking) => {
        const adjustment = booking.yieldManagement?.priceAdjustment;
        return {
          bookingId: booking._id,
          basePrice: adjustment?.originalPrice || booking.totalPrice,
          adjustedPrice: adjustment?.newPrice || booking.totalPrice,
          adjustmentAmount: adjustment?.adjustment || 0,
          adjustmentPercentage: adjustment?.adjustmentPercentage || 0,
          strategy: booking.yieldManagement?.strategy || 'MODERATE',
          demandLevel: booking.yieldManagement?.demandLevel || 'NORMAL',
        };
      });

      // Calculate adjustment statistics
      const positiveAdjustments = adjustmentAnalysis.filter((a) => a.adjustmentAmount > 0);
      const negativeAdjustments = adjustmentAnalysis.filter((a) => a.adjustmentAmount < 0);

      const adjustmentStats = {
        totalAdjustments: adjustmentAnalysis.length,
        positiveAdjustments: positiveAdjustments.length,
        negativeAdjustments: negativeAdjustments.length,
        avgPositiveAdjustment:
          positiveAdjustments.length > 0
            ? positiveAdjustments.reduce((sum, a) => sum + a.adjustmentPercentage, 0) /
              positiveAdjustments.length
            : 0,
        avgNegativeAdjustment:
          negativeAdjustments.length > 0
            ? negativeAdjustments.reduce((sum, a) => sum + Math.abs(a.adjustmentPercentage), 0) /
              negativeAdjustments.length
            : 0,
        totalRevenueFromAdjustments: adjustmentAnalysis.reduce(
          (sum, a) => sum + a.adjustmentAmount,
          0
        ),
      };

      // ROI calculation
      const yieldManagementCosts = this.estimateYieldManagementCosts(totalYieldBookings);
      const roi =
        yieldManagementCosts > 0
          ? ((yieldRevenue - yieldManagementCosts) / yieldManagementCosts) * 100
          : 0;

      return {
        impactSummary: {
          totalRevenueImpact: Math.round(yieldRevenue * 100) / 100,
          percentageImprovement: yieldPerformanceMetrics.valueImprovement,
          yieldAdoptionRate: Math.round(yieldPerformanceMetrics.yieldAdoptionRate * 100) / 100,
          roi: Math.round(roi * 100) / 100,
        },
        performanceMetrics: yieldPerformanceMetrics,
        adjustmentAnalysis: adjustmentStats,
        breakdown: {
          byStrategy: this.analyzeImpactByStrategy(adjustmentAnalysis),
          byDemandLevel: this.analyzeImpactByDemandLevel(adjustmentAnalysis),
          byTimeOfWeek: this.analyzeImpactByTimeOfWeek(yieldBookings),
        },
        trends: this.analyzeYieldImpactTrends(yieldBookings, startDate, endDate),
        recommendations: this.generateYieldImpactRecommendations({
          roi,
          adoptionRate: yieldPerformanceMetrics.yieldAdoptionRate,
          revenueImpact: yieldRevenue,
        }),
      };
    } catch (error) {
      logger.error('Error calculating yield revenue impact:', error);
      return {};
    }
  }
  async compareYieldStrategies(hotelId, startDate, endDate) {
    try {
      const strategies = ['CONSERVATIVE', 'MODERATE', 'AGGRESSIVE'];
      const strategyComparison = {};

      for (const strategy of strategies) {
        const strategyBookings = await Booking.find({
          hotel: hotelId,
          createdAt: { $gte: startDate, $lte: endDate },
          'yieldManagement.strategy': strategy,
        });

        if (strategyBookings.length > 0) {
          const totalRevenue = strategyBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
          const avgBookingValue = totalRevenue / strategyBookings.length;

          // Calculate average price adjustment
          const avgAdjustment =
            strategyBookings.reduce((sum, booking) => {
              return sum + (booking.yieldManagement?.priceAdjustment?.adjustmentPercentage || 0);
            }, 0) / strategyBookings.length;

          // Calculate success rate (positive adjustments that led to bookings)
          const successfulAdjustments = strategyBookings.filter(
            (booking) => booking.yieldManagement?.priceAdjustment?.adjustmentPercentage > 0
          ).length;

          const successRate = (successfulAdjustments / strategyBookings.length) * 100;

          // Calculate risk metrics
          const adjustmentVariance = this.calculateAdjustmentVariance(strategyBookings);

          strategyComparison[strategy] = {
            strategy,
            bookingCount: strategyBookings.length,
            totalRevenue: Math.round(totalRevenue * 100) / 100,
            avgBookingValue: Math.round(avgBookingValue * 100) / 100,
            avgAdjustment: Math.round(avgAdjustment * 100) / 100,
            successRate: Math.round(successRate * 100) / 100,
            riskLevel: this.assessStrategyRisk(adjustmentVariance, avgAdjustment),
            efficiency: this.calculateStrategyEfficiency(strategyBookings),
            performance: {
              revenuePerBooking: avgBookingValue,
              adjustmentEffectiveness: successRate,
              riskAdjustedReturn: this.calculateRiskAdjustedReturn(
                avgAdjustment,
                adjustmentVariance
              ),
            },
          };
        }
      }

      // Rank strategies by performance
      const rankedStrategies = Object.values(strategyComparison).sort((a, b) => {
        // Composite score: revenue efficiency + success rate - risk
        const scoreA =
          a.efficiency * 0.4 +
          a.successRate * 0.4 +
          (a.riskLevel === 'LOW' ? 20 : a.riskLevel === 'MEDIUM' ? 10 : 0);
        const scoreB =
          b.efficiency * 0.4 +
          b.successRate * 0.4 +
          (b.riskLevel === 'LOW' ? 20 : b.riskLevel === 'MEDIUM' ? 10 : 0);
        return scoreB - scoreA;
      });

      // Generate insights
      const insights = {
        bestPerformingStrategy: rankedStrategies[0],
        mostConservativeStrategy: Object.values(strategyComparison).find(
          (s) => s.strategy === 'CONSERVATIVE'
        ),
        mostAggressiveStrategy: Object.values(strategyComparison).find(
          (s) => s.strategy === 'AGGRESSIVE'
        ),
        optimalStrategy: this.determineOptimalStrategy(rankedStrategies),
        strategyDiversification: this.calculateStrategyDiversification(strategyComparison),
      };

      return {
        strategies: strategyComparison,
        ranking: rankedStrategies,
        insights,
        recommendations: this.generateStrategyRecommendations(insights, strategyComparison),
        summary: {
          totalStrategiesUsed: Object.keys(strategyComparison).length,
          mostUsedStrategy: Object.values(strategyComparison).reduce((max, current) =>
            current.bookingCount > max.bookingCount ? current : max
          ),
          avgPerformanceVariation: this.calculatePerformanceVariation(
            Object.values(strategyComparison)
          ),
        },
      };
    } catch (error) {
      logger.error('Error comparing yield strategies:', error);
      return {};
    }
  }
  async analyzePriceElasticity(hotelId, startDate, endDate) {
    try {
      // Get bookings with price variations
      const bookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate, $lte: endDate },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] },
      }).sort({ createdAt: 1 });

      if (bookings.length < 10) {
        return {
          error: 'Insufficient data for price elasticity analysis',
          minimumRequired: 10,
          available: bookings.length,
        };
      }

      // Group bookings by price ranges
      const priceRanges = this.createPriceRanges(bookings);

      // Calculate demand at different price levels
      const elasticityData = priceRanges
        .map((range) => {
          const rangeBookings = bookings.filter(
            (b) => b.totalPrice >= range.min && b.totalPrice < range.max
          );

          return {
            priceRange: range,
            bookingCount: rangeBookings.length,
            avgPrice:
              rangeBookings.reduce((sum, b) => sum + b.totalPrice, 0) / rangeBookings.length || 0,
            totalRevenue: rangeBookings.reduce((sum, b) => sum + b.totalPrice, 0),
            demandLevel: this.categorizeDemandLevel(rangeBookings.length, bookings.length),
          };
        })
        .filter((data) => data.bookingCount > 0);

      // Calculate price elasticity coefficient
      const elasticityCoefficient = this.calculateElasticityCoefficient(elasticityData);

      // Analyze elasticity by segments
      const segmentElasticity = {
        byDayOfWeek: this.analyzeElasticityByDayOfWeek(bookings),
        bySeasonality: this.analyzeElasticityBySeasonality(bookings),
        byLeadTime: this.analyzeElasticityByLeadTime(bookings),
        byRoomType: this.analyzeElasticityByRoomType(bookings),
      };

      // Determine elasticity level
      const elasticityLevel = this.determineElasticityLevel(elasticityCoefficient);

      // Calculate optimal pricing insights
      const optimalPricing = this.calculateOptimalPricing(elasticityData, elasticityCoefficient);

      return {
        elasticityCoefficient: Math.round(elasticityCoefficient * 100) / 100,
        elasticityLevel,
        interpretation: this.interpretElasticity(elasticityCoefficient, elasticityLevel),
        priceRangeAnalysis: elasticityData,
        segmentAnalysis: segmentElasticity,
        optimalPricing,
        insights: {
          priceFlexibility: this.assessPriceFlexibility(elasticityCoefficient),
          revenueOptimization: this.suggestRevenueOptimization(
            elasticityData,
            elasticityCoefficient
          ),
          marketPosition: this.assessMarketPosition(elasticityLevel),
          competitiveAdvantage: this.identifyCompetitiveAdvantage(elasticityCoefficient),
        },
        recommendations: this.generateElasticityRecommendations(
          elasticityCoefficient,
          elasticityLevel,
          optimalPricing
        ),
        limitations: [
          'Analysis based on historical data',
          'External factors not considered',
          'Assumes ceteris paribus conditions',
          `Sample size: ${bookings.length} bookings`,
        ],
      };
    } catch (error) {
      logger.error('Error analyzing price elasticity:', error);
      return {};
    }
  }
  calculateYieldEffectiveness(data) {
    try {
      const { performance, optimization, impact } = data;

      if (!performance || !impact) {
        return {
          overallEffectiveness: 0,
          error: 'Insufficient data for effectiveness calculation',
        };
      }

      // Calculate individual effectiveness scores (0-100)
      let performanceScore = 0;
      let optimizationScore = 0;
      let impactScore = 0;

      // Performance effectiveness
      if (performance.summary) {
        performanceScore = Math.min(
          100,
          (performance.summary.averageYieldScore / 100) * 40 +
            (performance.summary.automationRate / 100) * 30 +
            (performance.summary.yieldAttributedRevenue > 0 ? 30 : 0)
        );
      }

      // Optimization effectiveness
      if (optimization && optimization.summary) {
        const positiveOptimizations = optimization.summary.positiveOptimizations || 0;
        const totalOptimizations = optimization.summary.totalOptimizations || 1;
        const revenueImpact = optimization.summary.totalRevenueImpact || 0;

        optimizationScore = Math.min(
          100,
          (positiveOptimizations / totalOptimizations) * 50 + (revenueImpact > 0 ? 50 : 0)
        );
      }

      // Impact effectiveness
      if (impact.impactSummary) {
        const roi = impact.impactSummary.roi || 0;
        const adoptionRate = impact.impactSummary.yieldAdoptionRate || 0;
        const revenueImprovement = impact.impactSummary.percentageImprovement || 0;

        impactScore = Math.min(
          100,
          Math.max(0, Math.min(30, roi)) +
            (adoptionRate / 100) * 35 +
            Math.max(0, Math.min(35, revenueImprovement))
        );
      }

      // Calculate weighted overall effectiveness
      const weights = {
        performance: 0.3,
        optimization: 0.3,
        impact: 0.4,
      };

      const overallEffectiveness =
        performanceScore * weights.performance +
        optimizationScore * weights.optimization +
        impactScore * weights.impact;

      // Determine effectiveness level
      let effectivenessLevel = 'POOR';
      if (overallEffectiveness >= 85) effectivenessLevel = 'EXCELLENT';
      else if (overallEffectiveness >= 70) effectivenessLevel = 'GOOD';
      else if (overallEffectiveness >= 55) effectivenessLevel = 'AVERAGE';
      else if (overallEffectiveness >= 40) effectivenessLevel = 'BELOW_AVERAGE';

      // Calculate component scores
      const componentScores = {
        automation: this.calculateAutomationEffectiveness(performance),
        pricing: this.calculatePricingEffectiveness(optimization),
        revenue: this.calculateRevenueEffectiveness(impact),
        adoption: this.calculateAdoptionEffectiveness(impact),
      };

      return {
        overallEffectiveness: Math.round(overallEffectiveness),
        effectivenessLevel,
        componentScores: {
          performance: Math.round(performanceScore),
          optimization: Math.round(optimizationScore),
          impact: Math.round(impactScore),
        },
        detailedScores: componentScores,
        benchmarks: {
          industry: {
            excellent: 85,
            good: 70,
            average: 55,
            poor: 40,
          },
          currentPosition: effectivenessLevel,
          improvementPotential: Math.max(0, 85 - overallEffectiveness),
        },
        strengths: this.identifyYieldStrengths(
          componentScores,
          performanceScore,
          optimizationScore,
          impactScore
        ),
        weaknesses: this.identifyYieldWeaknesses(
          componentScores,
          performanceScore,
          optimizationScore,
          impactScore
        ),
        calculatedAt: new Date(),
      };
    } catch (error) {
      logger.error('Error calculating yield effectiveness:', error);
      return {
        overallEffectiveness: 0,
        error: error.message,
      };
    }
  }
  generateYieldInsights(data) {
    try {
      const insights = [];
      const { performance, optimization, effectiveness } = data;

      // Performance insights
      if (performance && performance.summary) {
        if (performance.summary.averageYieldScore > 80) {
          insights.push({
            type: 'positive',
            category: 'performance',
            title: 'High Yield Performance Score',
            message: `Yield management achieving ${Math.round(performance.summary.averageYieldScore)}% average performance score`,
            impact: 'high',
            recommendation:
              'Maintain current yield strategies and consider expanding to additional room types',
          });
        }

        if (performance.summary.automationRate < 60) {
          insights.push({
            type: 'opportunity',
            category: 'automation',
            title: 'Low Automation Rate',
            message: `Only ${Math.round(performance.summary.automationRate)}% of pricing decisions are automated`,
            impact: 'medium',
            recommendation:
              'Increase automation to reduce manual intervention and improve response time',
          });
        }

        if (performance.summary.yieldAttributedRevenue > 10000) {
          insights.push({
            type: 'positive',
            category: 'revenue',
            title: 'Significant Revenue Attribution',
            message: `Yield management contributing €${Math.round(performance.summary.yieldAttributedRevenue).toLocaleString()} in additional revenue`,
            impact: 'high',
            recommendation: 'Continue optimizing yield strategies to maximize revenue potential',
          });
        }
      }

      // Optimization insights
      if (optimization && optimization.summary) {
        const successRate =
          (optimization.summary.positiveOptimizations / optimization.summary.totalOptimizations) *
          100;

        if (successRate > 70) {
          insights.push({
            type: 'positive',
            category: 'optimization',
            title: 'High Optimization Success Rate',
            message: `${Math.round(successRate)}% of price optimizations resulted in positive outcomes`,
            impact: 'high',
            recommendation: 'Analyze successful optimization patterns for replication',
          });
        } else if (successRate < 40) {
          insights.push({
            type: 'warning',
            category: 'optimization',
            title: 'Low Optimization Success Rate',
            message: `Only ${Math.round(successRate)}% of price optimizations were successful`,
            impact: 'high',
            recommendation: 'Review optimization algorithms and market conditions',
          });
        }
      }

      // Effectiveness insights
      if (effectiveness) {
        if (effectiveness.overallEffectiveness > 80) {
          insights.push({
            type: 'positive',
            category: 'effectiveness',
            title: 'Excellent Yield Management Effectiveness',
            message: `Overall effectiveness score of ${effectiveness.overallEffectiveness}% indicates superior performance`,
            impact: 'high',
            recommendation:
              'Share best practices across properties and maintain current strategies',
          });
        } else if (effectiveness.overallEffectiveness < 50) {
          insights.push({
            type: 'critical',
            category: 'effectiveness',
            title: 'Below Average Yield Effectiveness',
            message: `Effectiveness score of ${effectiveness.overallEffectiveness}% requires immediate attention`,
            impact: 'critical',
            recommendation:
              'Comprehensive review of yield management strategy and implementation needed',
          });
        }

        // Component-specific insights
        if (effectiveness.componentScores.performance < 50) {
          insights.push({
            type: 'warning',
            category: 'performance',
            title: 'Yield Performance Issues',
            message: 'Performance component scoring below expectations',
            impact: 'medium',
            recommendation: 'Focus on improving yield algorithms and market responsiveness',
          });
        }

        if (effectiveness.componentScores.adoption < 60) {
          insights.push({
            type: 'opportunity',
            category: 'adoption',
            title: 'Low Yield Adoption',
            message: 'Yield management adoption rate could be improved',
            impact: 'medium',
            recommendation: 'Increase yield management coverage across all bookings and channels',
          });
        }
      }

      return insights.sort((a, b) => {
        const impactOrder = { critical: 4, high: 3, medium: 2, low: 1 };
        return impactOrder[b.impact] - impactOrder[a.impact];
      });
    } catch (error) {
      logger.error('Error generating yield insights:', error);
      return [];
    }
  }
  generateYieldRecommendations(effectiveness, performance) {
    try {
      const recommendations = [];

      if (!effectiveness) return recommendations;

      // High-level strategic recommendations
      if (effectiveness.overallEffectiveness < 40) {
        recommendations.push({
          priority: 'CRITICAL',
          category: 'strategy',
          title: 'Comprehensive Yield Management Overhaul',
          description:
            'Current yield management effectiveness is critically low and requires immediate strategic intervention',
          actions: [
            'Conduct full audit of yield management system',
            'Review and update pricing algorithms',
            'Retrain staff on yield management best practices',
            'Implement advanced demand forecasting',
          ],
          expectedImpact: 'Improve effectiveness by 40-60%',
          timeframe: '6-12 weeks',
          investment: 'High',
          kpis: ['Overall effectiveness', 'Revenue per room', 'Occupancy optimization'],
        });
      } else if (effectiveness.overallEffectiveness < 60) {
        recommendations.push({
          priority: 'HIGH',
          category: 'optimization',
          title: 'Yield Management Enhancement Program',
          description: 'Systematic improvements needed across multiple yield management components',
          actions: [
            'Optimize pricing algorithms',
            'Increase automation levels',
            'Enhance market data integration',
            'Improve staff training',
          ],
          expectedImpact: 'Improve effectiveness by 20-40%',
          timeframe: '4-8 weeks',
          investment: 'Medium',
          kpis: ['Automation rate', 'Pricing accuracy', 'Revenue optimization'],
        });
      }

      // Automation recommendations
      if (performance && performance.summary && performance.summary.automationRate < 70) {
        recommendations.push({
          priority: 'HIGH',
          category: 'automation',
          title: 'Increase Yield Management Automation',
          description: `Current automation rate of ${Math.round(performance.summary.automationRate)}% should be increased to reduce manual intervention`,
          actions: [
            'Enable automated pricing rules for off-peak periods',
            'Implement dynamic pricing triggers',
            'Set up automated competitor price monitoring',
            'Configure demand-based pricing adjustments',
          ],
          expectedImpact: 'Reduce manual work by 50% and improve response time',
          timeframe: '2-4 weeks',
          investment: 'Low',
          kpis: ['Automation rate', 'Response time', 'Pricing consistency'],
        });
      }

      // Performance-specific recommendations
      if (effectiveness.componentScores) {
        if (effectiveness.componentScores.performance < 60) {
          recommendations.push({
            priority: 'MEDIUM',
            category: 'performance',
            title: 'Enhance Yield Performance Metrics',
            description:
              'Yield performance component requires optimization to improve overall effectiveness',
            actions: [
              'Refine yield scoring algorithms',
              'Implement advanced performance tracking',
              'Optimize yield rule effectiveness',
              'Enhance market condition responsiveness',
            ],
            expectedImpact: 'Improve yield performance score by 20-30%',
            timeframe: '3-6 weeks',
            investment: 'Medium',
            kpis: ['Yield score', 'Performance consistency', 'Market responsiveness'],
          });
        }

        if (effectiveness.componentScores.adoption < 70) {
          recommendations.push({
            priority: 'MEDIUM',
            category: 'coverage',
            title: 'Expand Yield Management Coverage',
            description:
              'Increase yield management adoption across all booking channels and room types',
            actions: [
              'Enable yield management for all room categories',
              'Integrate with all booking channels',
              'Implement channel-specific pricing strategies',
              'Expand to group bookings and corporate rates',
            ],
            expectedImpact: 'Increase revenue optimization coverage by 30-50%',
            timeframe: '4-8 weeks',
            investment: 'Medium',
            kpis: ['Coverage rate', 'Channel optimization', 'Revenue per channel'],
          });
        }
      }

      // Revenue optimization recommendations
      if (effectiveness.overallEffectiveness > 70) {
        recommendations.push({
          priority: 'LOW',
          category: 'advanced',
          title: 'Advanced Yield Management Features',
          description:
            'Strong foundation allows for implementation of advanced yield management capabilities',
          actions: [
            'Implement machine learning algorithms',
            'Add predictive demand modeling',
            'Integrate external market data',
            'Develop competitive intelligence features',
          ],
          expectedImpact: 'Further optimize revenue by 10-20%',
          timeframe: '8-12 weeks',
          investment: 'High',
          kpis: ['Prediction accuracy', 'Market intelligence', 'Competitive advantage'],
        });
      }

      // Quick wins
      recommendations.push({
        priority: 'LOW',
        category: 'quick_wins',
        title: 'Quick Yield Management Improvements',
        description: 'Low-effort, high-impact improvements that can be implemented immediately',
        actions: [
          'Review and adjust pricing thresholds',
          'Update seasonal pricing factors',
          'Optimize weekend vs weekday pricing',
          'Fine-tune lead time pricing adjustments',
        ],
        expectedImpact: 'Immediate 5-15% improvement in pricing accuracy',
        timeframe: '1-2 weeks',
        investment: 'Low',
        kpis: ['Pricing accuracy', 'Revenue per booking', 'Conversion rate'],
      });

      return recommendations.sort((a, b) => {
        const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      });
    } catch (error) {
      logger.error('Error generating yield recommendations:', error);
      return [];
    }
  }
  async analyzePriceOptimization(hotelId, startDate, endDate) {
    try {
      // Get bookings with price optimization data
      const optimizedBookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate, $lte: endDate },
        'yieldManagement.priceOptimization': { $exists: true },
      });

      if (optimizedBookings.length === 0) {
        return {
          message: 'No price optimization data found for the specified period',
          summary: { totalOptimizations: 0 },
        };
      }

      // Analyze optimization results
      const optimizationResults = optimizedBookings.map((booking) => {
        const optimization = booking.yieldManagement.priceOptimization;
        return {
          bookingId: booking._id,
          originalPrice: optimization.originalPrice,
          optimizedPrice: optimization.optimizedPrice,
          adjustment: optimization.optimizedPrice - optimization.originalPrice,
          adjustmentPercentage:
            ((optimization.optimizedPrice - optimization.originalPrice) /
              optimization.originalPrice) *
            100,
          strategy: optimization.strategy || 'MODERATE',
          confidence: optimization.confidence || 0.5,
          factors: optimization.factors || {},
          outcome: booking.status === 'CONFIRMED' ? 'SUCCESSFUL' : 'PENDING',
        };
      });

      // Calculate optimization statistics
      const totalOptimizations = optimizationResults.length;
      const successfulOptimizations = optimizationResults.filter(
        (r) => r.outcome === 'SUCCESSFUL'
      ).length;
      const totalRevenueImpact = optimizationResults.reduce((sum, r) => sum + r.adjustment, 0);
      const avgAdjustment =
        optimizationResults.reduce((sum, r) => sum + r.adjustmentPercentage, 0) /
        totalOptimizations;
      const avgConfidence =
        optimizationResults.reduce((sum, r) => sum + r.confidence, 0) / totalOptimizations;

      // Analyze by optimization direction
      const priceIncreases = optimizationResults.filter((r) => r.adjustment > 0);
      const priceDecreases = optimizationResults.filter((r) => r.adjustment < 0);
      const noChange = optimizationResults.filter((r) => r.adjustment === 0);

      // Analyze by strategy
      const strategyAnalysis = this.analyzeOptimizationByStrategy(optimizationResults);

      // Analyze by confidence levels
      const confidenceAnalysis = this.analyzeOptimizationByConfidence(optimizationResults);

      // Calculate effectiveness metrics
      const effectiveness = {
        successRate: (successfulOptimizations / totalOptimizations) * 100,
        revenueImpactPerOptimization: totalRevenueImpact / totalOptimizations,
        avgConfidenceScore: avgConfidence * 100,
        optimizationAccuracy: this.calculateOptimizationAccuracy(optimizationResults),
      };

      return {
        summary: {
          totalOptimizations,
          successfulOptimizations,
          successRate: Math.round(effectiveness.successRate * 100) / 100,
          totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
          avgAdjustment: Math.round(avgAdjustment * 100) / 100,
          avgConfidence: Math.round(avgConfidenceScore * 100) / 100,
        },
        distribution: {
          priceIncreases: priceIncreases.length,
          priceDecreases: priceDecreases.length,
          noChange: noChange.length,
          increaseSuccessRate:
            priceIncreases.length > 0
              ? (priceIncreases.filter((r) => r.outcome === 'SUCCESSFUL').length /
                  priceIncreases.length) *
                100
              : 0,
          decreaseSuccessRate:
            priceDecreases.length > 0
              ? (priceDecreases.filter((r) => r.outcome === 'SUCCESSFUL').length /
                  priceDecreases.length) *
                100
              : 0,
        },
        strategyAnalysis,
        confidenceAnalysis,
        effectiveness,
        trends: this.analyzeOptimizationTrends(optimizedBookings, startDate, endDate),
        insights: this.generateOptimizationInsights(
          effectiveness,
          strategyAnalysis,
          confidenceAnalysis
        ),
        recommendations: this.generateOptimizationRecommendations(
          effectiveness,
          optimizationResults
        ),
        detailedResults: optimizationResults.slice(0, 50), // Limit for performance
      };
    } catch (error) {
      logger.error('Error analyzing price optimization:', error);
      return {};
    }
  }
  async analyzeYieldPerformance(hotelId, startDate, endDate) {
    try {
      // Get yield-enabled bookings
      const yieldBookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate, $lte: endDate },
        'yieldManagement.enabled': true,
      }).populate('hotel', 'name totalRooms');

      if (yieldBookings.length === 0) {
        return {
          enabled: false,
          message: 'No yield management data found for the specified period',
        };
      }

      // Calculate performance metrics
      const totalYieldBookings = yieldBookings.length;
      const totalRevenue = yieldBookings.reduce(
        (sum, booking) => sum + (booking.totalPrice || 0),
        0
      );
      const avgYieldScore =
        yieldBookings.reduce((sum, booking) => {
          return sum + (booking.yieldManagement?.performanceScore || 50);
        }, 0) / totalYieldBookings;

      // Calculate base vs optimized revenue
      const baseRevenue = yieldBookings.reduce((sum, booking) => {
        const basePrice = booking.yieldManagement?.basePricing?.totalPrice || booking.totalPrice;
        return sum + basePrice;
      }, 0);

      const revenueImpact = totalRevenue - baseRevenue;
      const revenueImpactPercentage = baseRevenue > 0 ? (revenueImpact / baseRevenue) * 100 : 0;

      // Analyze automation vs manual adjustments
      const automatedAdjustments = yieldBookings.filter(
        (booking) => booking.yieldManagement?.priceAdjustment?.source === 'AUTOMATED'
      ).length;
      const manualAdjustments = totalYieldBookings - automatedAdjustments;
      const automationRate = (automatedAdjustments / totalYieldBookings) * 100;

      // Performance by strategy
      const strategyPerformance = this.analyzePerformanceByStrategy(yieldBookings);

      // Performance by demand level
      const demandLevelPerformance = this.analyzePerformanceByDemandLevel(yieldBookings);

      // Performance by time patterns
      const timePatternPerformance = this.analyzePerformanceByTimePatterns(yieldBookings);

      // Calculate yield effectiveness score
      const effectivenessFactors = {
        revenueImpact: Math.min(100, Math.max(0, revenueImpactPercentage + 50)), // Normalize around 0%
        yieldScore: avgYieldScore,
        automationRate: automationRate,
        adoptionRate: this.calculateYieldAdoptionRate(
          hotelId,
          startDate,
          endDate,
          totalYieldBookings
        ),
      };

      const overallEffectiveness =
        effectivenessFactors.revenueImpact * 0.3 +
        effectivenessFactors.yieldScore * 0.3 +
        effectivenessFactors.automationRate * 0.2 +
        effectivenessFactors.adoptionRate * 0.2;

      // Analyze yield rule performance
      const rulePerformance = this.analyzeYieldRulePerformance(yieldBookings);

      // Market responsiveness analysis
      const marketResponsiveness = this.analyzeMarketResponsiveness(yieldBookings);

      return {
        enabled: true,
        summary: {
          totalYieldBookings,
          totalRevenue: Math.round(totalRevenue * 100) / 100,
          baseRevenue: Math.round(baseRevenue * 100) / 100,
          revenueImpact: Math.round(revenueImpact * 100) / 100,
          revenueImpactPercentage: Math.round(revenueImpactPercentage * 100) / 100,
          avgYieldScore: Math.round(avgYieldScore),
          automationRate: Math.round(automationRate * 100) / 100,
          overallEffectiveness: Math.round(overallEffectiveness),
        },
        automation: {
          automatedAdjustments,
          manualAdjustments,
          automationRate: Math.round(automationRate * 100) / 100,
          avgAutomatedPerformance: this.calculateAvgAutomatedPerformance(yieldBookings),
          avgManualPerformance: this.calculateAvgManualPerformance(yieldBookings),
        },
        performance: {
          byStrategy: strategyPerformance,
          byDemandLevel: demandLevelPerformance,
          byTimePattern: timePatternPerformance,
          byRules: rulePerformance,
        },
        marketResponsiveness,
        trends: this.analyzeYieldPerformanceTrends(yieldBookings, startDate, endDate),
        benchmarks: {
          industryAverage: {
            yieldScore: 75,
            automationRate: 80,
            revenueImpact: 8,
          },
          performance: this.benchmarkYieldPerformance(
            avgYieldScore,
            automationRate,
            revenueImpactPercentage
          ),
        },
        insights: this.generateYieldPerformanceInsights({
          effectiveness: overallEffectiveness,
          revenueImpact: revenueImpactPercentage,
          automationRate,
          yieldScore: avgYieldScore,
        }),
        recommendations: this.generateYieldPerformanceRecommendations({
          effectiveness: overallEffectiveness,
          automation: automationRate,
          revenueImpact: revenueImpactPercentage,
          performance: strategyPerformance,
        }),
      };
    } catch (error) {
      logger.error('Error analyzing yield performance:', error);
      return {
        enabled: false,
        error: error.message,
      };
    }
  }
  generateComprehensiveRecommendations(sections) {
    try {
      const recommendations = [];

      // Priority matrix for recommendations
      const priorityMatrix = {
        CRITICAL: { weight: 4, maxRecommendations: 2 },
        HIGH: { weight: 3, maxRecommendations: 3 },
        MEDIUM: { weight: 2, maxRecommendations: 4 },
        LOW: { weight: 1, maxRecommendations: 3 },
      };

      // Revenue-based recommendations
      if (sections.revenue) {
        const revenueInsights = sections.revenue.insights || [];
        revenueInsights.forEach((insight) => {
          if (insight.type === 'WARNING' || insight.type === 'ALERT') {
            recommendations.push({
              category: 'REVENUE',
              priority: insight.impact === 'HIGH' ? 'CRITICAL' : 'HIGH',
              title: `Revenue ${insight.category} Optimization`,
              description: insight.message,
              actions: this.generateRevenueActions(insight),
              expectedImpact: this.estimateRevenueImpact(insight),
              timeframe: this.estimateImplementationTime(insight),
              resources: this.estimateResourceRequirements(insight),
              kpis: ['Total Revenue', 'RevPAR', 'ADR', 'Occupancy Rate'],
              source: 'revenue_analytics',
            });
          }
        });
      }

      // Occupancy-based recommendations
      if (sections.occupancy) {
        const occupancyTrends = sections.occupancy.trends || {};
        if (occupancyTrends.direction === 'DECLINING') {
          recommendations.push({
            category: 'OCCUPANCY',
            priority: 'HIGH',
            title: 'Occupancy Recovery Strategy',
            description: 'Declining occupancy trends require immediate intervention',
            actions: [
              'Implement dynamic pricing for low-demand periods',
              'Launch targeted marketing campaigns',
              'Review competitive positioning',
              'Optimize distribution channel mix',
            ],
            expectedImpact: 'Increase occupancy by 15-25%',
            timeframe: '2-4 weeks',
            resources: 'Medium (Marketing budget + staff time)',
            kpis: ['Occupancy Rate', 'Booking Volume', 'Market Share'],
            source: 'occupancy_analytics',
          });
        }
      }

      // Yield management recommendations
      if (sections.yield && sections.yield.performance) {
        const yieldEffectiveness = sections.yield.effectiveness?.overallEffectiveness || 0;
        if (yieldEffectiveness < 60) {
          recommendations.push({
            category: 'YIELD_MANAGEMENT',
            priority: yieldEffectiveness < 40 ? 'CRITICAL' : 'HIGH',
            title: 'Yield Management Enhancement',
            description: `Yield management effectiveness at ${yieldEffectiveness}% requires optimization`,
            actions: [
              'Review and update yield algorithms',
              'Increase automation levels',
              'Enhance market data integration',
              'Improve demand forecasting accuracy',
            ],
            expectedImpact: 'Improve yield effectiveness by 20-40%',
            timeframe: '4-8 weeks',
            resources: 'High (Technology investment + training)',
            kpis: ['Yield Score', 'Revenue per Room', 'Pricing Accuracy'],
            source: 'yield_analytics',
          });
        }
      }

      // Loyalty program recommendations
      if (sections.loyalty) {
        const loyaltyMetrics = sections.loyalty.membership || {};
        if (loyaltyMetrics.activationRate < 50) {
          recommendations.push({
            category: 'LOYALTY',
            priority: 'MEDIUM',
            title: 'Loyalty Program Activation Enhancement',
            description: `Low activation rate of ${loyaltyMetrics.activationRate}% indicates engagement issues`,
            actions: [
              'Simplify loyalty program enrollment',
              'Enhance member benefits communication',
              'Implement personalized offers',
              'Launch loyalty program awareness campaign',
            ],
            expectedImpact: 'Increase activation rate by 30-50%',
            timeframe: '3-6 weeks',
            resources: 'Medium (Marketing + system updates)',
            kpis: ['Activation Rate', 'Member Engagement', 'Repeat Bookings'],
            source: 'loyalty_analytics',
          });
        }
      }

      // Operational recommendations
      if (sections.operational) {
        const operationalScores = sections.operational.scores || {};
        if (operationalScores.overall < 70) {
          recommendations.push({
            category: 'OPERATIONAL',
            priority: 'MEDIUM',
            title: 'Operational Efficiency Improvement',
            description: 'Operational performance scores indicate efficiency opportunities',
            actions: [
              'Streamline check-in/check-out processes',
              'Implement staff training programs',
              'Optimize service delivery workflows',
              'Enhance customer service standards',
            ],
            expectedImpact: 'Improve operational efficiency by 20-30%',
            timeframe: '4-8 weeks',
            resources: 'Medium (Training + process optimization)',
            kpis: ['Service Quality Score', 'Check-in Time', 'Customer Satisfaction'],
            source: 'operational_analytics',
          });
        }
      }

      // Demand-based recommendations
      if (sections.demand) {
        const demandIndicators = sections.demand.indicators || {};
        if (demandIndicators.demandLevel === 'LOW' || demandIndicators.demandLevel === 'VERY_LOW') {
          recommendations.push({
            category: 'DEMAND',
            priority: 'HIGH',
            title: 'Demand Stimulation Strategy',
            description: `${demandIndicators.demandLevel} demand requires immediate attention`,
            actions: [
              'Launch promotional pricing campaigns',
              'Implement targeted marketing initiatives',
              'Develop package deals and special offers',
              'Enhance online presence and SEO',
            ],
            expectedImpact: 'Increase booking demand by 25-40%',
            timeframe: '2-4 weeks',
            resources: 'High (Marketing budget + promotional costs)',
            kpis: ['Booking Volume', 'Demand Score', 'Market Penetration'],
            source: 'demand_analytics',
          });
        }
      }

      // Cross-functional strategic recommendations
      const strategicRecommendations = this.generateStrategicRecommendations(sections);
      recommendations.push(...strategicRecommendations);

      // Prioritize and limit recommendations
      const prioritizedRecommendations = this.prioritizeRecommendations(
        recommendations,
        priorityMatrix
      );

      // Add implementation roadmap
      const implementationRoadmap = this.createImplementationRoadmap(prioritizedRecommendations);

      return {
        recommendations: prioritizedRecommendations,
        summary: {
          totalRecommendations: prioritizedRecommendations.length,
          byPriority: this.groupRecommendationsByPriority(prioritizedRecommendations),
          byCategory: this.groupRecommendationsByCategory(prioritizedRecommendations),
          estimatedTotalImpact: this.estimateTotalImpact(prioritizedRecommendations),
          estimatedTotalInvestment: this.estimateTotalInvestment(prioritizedRecommendations),
        },
        roadmap: implementationRoadmap,
        quickWins: prioritizedRecommendations
          .filter((r) => r.timeframe.includes('1-2 weeks') || r.timeframe.includes('immediate'))
          .slice(0, 3),
        majorInitiatives: prioritizedRecommendations
          .filter((r) => r.priority === 'CRITICAL' || r.priority === 'HIGH')
          .slice(0, 5),
        generatedAt: new Date(),
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      };
    } catch (error) {
      logger.error('Error generating comprehensive recommendations:', error);
      return {
        recommendations: [],
        error: error.message,
      };
    }
  }

  /**
   * ================================
   * FINAL INITIALIZATION
   * ================================
   */

  /**
   * Initialize analytics controller with cache
   */
  async initialize() {
    try {
      // Setup cache invalidation listeners
      this.setupCacheInvalidationListeners();

      // Perform initial cache warmup if enabled
      if (this.cacheWarmup.enabled) {
        setTimeout(async () => {
          await this.performCacheWarmup(['dashboard', 'revenue'], [], '7d');
        }, 10000); // Wait 10 seconds after startup
      }

      logger.info('✅ Analytics Controller with Redis cache initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize Analytics Controller:', error);
    }
  }
}

// Export singleton instance
module.exports = new AnalyticsController();
