/**
 * CACHE SERVICE - REDIS CACHING SYSTEM
 * Service cache principal pour optimiser les performances de l'application hôtelière
 * 
 * Fonctionnalités :
 * - Cache availability avec TTL 5min
 * - Cache yield pricing avec TTL 30min  
 * - Cache analytics avec TTL 1h
 * - Cache hotel data avec TTL 6h
 * - Invalidation intelligente
 * - Stats et monitoring complets
 * - Compression des données
 * - Cache warming et prefetching
 */

const redisConfig = require('../config/redis');
const { logger } = require('../utils/logger');
const zlib = require('zlib');
const { promisify } = require('util');

// Promisify compression functions
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class CacheService {
  constructor() {
    // TTL Configuration (en secondes)
    this.ttl = {
      availability: 5 * 60,        // 5 minutes
      yieldPricing: 30 * 60,       // 30 minutes
      analytics: 60 * 60,          // 1 heure
      hotelData: 6 * 60 * 60,      // 6 heures
      userSessions: 24 * 60 * 60,  // 24 heures
      bookingData: 15 * 60,        // 15 minutes
      realtimeData: 2 * 60         // 2 minutes
    };

    // Key Prefixes pour organisation
    this.prefixes = {
      availability: 'avail:',
      pricing: 'price:',
      yield: 'yield:',
      analytics: 'analytics:',
      hotel: 'hotel:',
      booking: 'booking:',
      user: 'user:',
      realtime: 'rt:',
      stats: 'stats:',
      locks: 'lock:'
    };

    // Cache Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      compressionSaved: 0,
      totalOperations: 0
    };

    // Configuration
    this.config = {
      enableCompression: process.env.REDIS_ENABLE_COMPRESSION !== 'false',
      compressionThreshold: parseInt(process.env.REDIS_COMPRESSION_THRESHOLD) || 1024,
      maxValueSize: parseInt(process.env.REDIS_MAX_VALUE_SIZE) || 100 * 1024 * 1024, // 100MB
      enableStats: process.env.REDIS_ENABLE_STATS !== 'false'
    };

    // Initialize Redis connection
    this.initializeRedis();
  }

  /**
   * ================================
   * INITIALIZATION
   * ================================
   */

  async initializeRedis() {
    try {
      await redisConfig.connect();
      this.redis = redisConfig.getClient();
      
      logger.info('✅ Cache Service initialized with Redis');
      
      // Setup periodic stats logging
      if (this.config.enableStats) {
        setInterval(() => {
          this.logStats();
        }, 60000); // Every minute
      }
      
    } catch (error) {
      logger.error('❌ Failed to initialize Cache Service:', error);
      throw error;
    }
  }

  /**
   * ================================
   * AVAILABILITY CACHING (TTL: 5min)
   * ================================
   */

  /**
   * Cache availability data
   * @param {string} hotelId - Hotel ID
   * @param {Date} checkIn - Check-in date
   * @param {Date} checkOut - Check-out date
   * @param {Object} availabilityData - Availability data to cache
   * @param {number} customTTL - Custom TTL (optional)
   */
  async cacheAvailability(hotelId, checkIn, checkOut, availabilityData, customTTL = null) {
    try {
      const key = this.buildAvailabilityKey(hotelId, checkIn, checkOut);
      const ttl = customTTL || this.ttl.availability;
      
      const cacheData = {
        data: availabilityData,
        hotelId,
        checkIn: checkIn.toISOString(),
        checkOut: checkOut.toISOString(),
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
        version: '1.0'
      };

      const success = await this.setWithCompression(key, cacheData, ttl);
      
      if (success) {
        // Add to availability index for batch invalidation
        await this.addToIndex(`${this.prefixes.availability}index:${hotelId}`, key, ttl + 60);
        
        // Track in hotel availability index by date
        const dateKey = checkIn.toISOString().split('T')[0];
        await this.addToIndex(`${this.prefixes.availability}date:${dateKey}`, key, ttl + 60);
        
        this.incrementStat('sets');
        logger.debug(`📦 Cached availability: ${hotelId} for ${checkIn.toDateString()}`);
      }

      return success;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error caching availability:', error);
      return false;
    }
  }

  /**
   * Get cached availability data
   */
  async getAvailability(hotelId, checkIn, checkOut) {
    try {
      const key = this.buildAvailabilityKey(hotelId, checkIn, checkOut);
      const cached = await this.getWithDecompression(key);
      
      if (cached) {
        // Validate data integrity
        if (this.validateAvailabilityData(cached, hotelId, checkIn, checkOut)) {
          this.incrementStat('hits');
          logger.debug(`📦 Cache hit - availability: ${hotelId}`);
          return {
            ...cached.data,
            fromCache: true,
            cachedAt: cached.cachedAt
          };
        } else {
          // Invalid cache, delete it
          await this.invalidateAvailability(hotelId, checkIn, checkOut);
        }
      }
      
      this.incrementStat('misses');
      return null;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error getting cached availability:', error);
      return null;
    }
  }

  /**
   * Invalidate availability cache for specific dates or hotel
   */
  async invalidateAvailability(hotelId, checkIn = null, checkOut = null) {
    try {
      let deletedCount = 0;
      
      if (checkIn && checkOut) {
        // Invalidate specific date range
        const key = this.buildAvailabilityKey(hotelId, checkIn, checkOut);
        const deleted = await this.redis.del(key);
        deletedCount += deleted;
        
        // Remove from indexes
        await this.removeFromIndex(`${this.prefixes.availability}index:${hotelId}`, key);
        
      } else {
        // Invalidate all availability for hotel
        const indexKey = `${this.prefixes.availability}index:${hotelId}`;
        const keys = await this.redis.sMembers(indexKey);
        
        if (keys.length > 0) {
          deletedCount = await this.redis.del(keys);
          await this.redis.del(indexKey);
        }
      }
      
      this.incrementStat('deletes', deletedCount);
      logger.info(`🗑️ Invalidated ${deletedCount} availability cache entries for hotel ${hotelId}`);
      
      return deletedCount;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error invalidating availability cache:', error);
      return 0;
    }
  }

  /**
   * ================================
   * YIELD PRICING CACHING (TTL: 30min)
   * ================================
   */

  /**
   * Cache yield pricing data
   */
  async cacheYieldPricing(hotelId, roomType, date, pricingData, customTTL = null) {
    try {
      const key = this.buildYieldKey(hotelId, roomType, date);
      const ttl = customTTL || this.ttl.yieldPricing;
      
      const cacheData = {
        pricing: pricingData,
        hotelId,
        roomType,
        date: date.toISOString(),
        calculatedAt: new Date().toISOString(),
        strategy: pricingData.strategy || 'MODERATE',
        factors: pricingData.factors || {},
        version: '1.0'
      };

      const success = await this.setWithCompression(key, cacheData, ttl);
      
      if (success) {
        // Add to yield index
        await this.addToIndex(`${this.prefixes.yield}index:${hotelId}`, key, ttl + 60);
        
        // Track by room type
        await this.addToIndex(`${this.prefixes.yield}type:${roomType}`, key, ttl + 60);
        
        this.incrementStat('sets');
        logger.debug(`💰 Cached yield pricing: ${hotelId}-${roomType}-${date.toDateString()}`);
      }

      return success;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error caching yield pricing:', error);
      return false;
    }
  }

  /**
   * Get cached yield pricing
   */
  async getYieldPricing(hotelId, roomType, date) {
    try {
      const key = this.buildYieldKey(hotelId, roomType, date);
      const cached = await this.getWithDecompression(key);
      
      if (cached && this.validateYieldData(cached, hotelId, roomType, date)) {
        this.incrementStat('hits');
        logger.debug(`💰 Cache hit - yield pricing: ${hotelId}-${roomType}`);
        return {
          ...cached.pricing,
          fromCache: true,
          calculatedAt: cached.calculatedAt
        };
      }
      
      this.incrementStat('misses');
      return null;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error getting cached yield pricing:', error);
      return null;
    }
  }

  /**
   * Invalidate yield pricing cache
   */
  async invalidateYieldPricing(hotelId, roomType = null, date = null) {
    try {
      let deletedCount = 0;
      
      if (roomType && date) {
        // Specific room type and date
        const key = this.buildYieldKey(hotelId, roomType, date);
        deletedCount = await this.redis.del(key);
        
      } else if (roomType) {
        // All dates for specific room type
        const pattern = `${this.prefixes.yield}${hotelId}:${roomType}:*`;
        const keys = await this.redis.keys(pattern);
        if (keys.length > 0) {
          deletedCount = await this.redis.del(keys);
        }
        
      } else {
        // All yield pricing for hotel
        const indexKey = `${this.prefixes.yield}index:${hotelId}`;
        const keys = await this.redis.sMembers(indexKey);
        
        if (keys.length > 0) {
          deletedCount = await this.redis.del(keys);
          await this.redis.del(indexKey);
        }
      }
      
      this.incrementStat('deletes', deletedCount);
      logger.info(`🗑️ Invalidated ${deletedCount} yield pricing cache entries`);
      
      return deletedCount;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error invalidating yield pricing cache:', error);
      return 0;
    }
  }

  /**
   * ================================
   * ANALYTICS CACHING (TTL: 1h)
   * ================================
   */

  /**
   * Cache analytics data
   */
  async cacheAnalytics(type, identifier, analyticsData, customTTL = null) {
    try {
      const key = `${this.prefixes.analytics}${type}:${identifier}`;
      const ttl = customTTL || this.ttl.analytics;
      
      const cacheData = {
        analytics: analyticsData,
        type,
        identifier,
        generatedAt: new Date().toISOString(),
        dataPoints: Array.isArray(analyticsData) ? analyticsData.length : Object.keys(analyticsData).length,
        version: '1.0'
      };

      const success = await this.setWithCompression(key, cacheData, ttl);
      
      if (success) {
        // Add to analytics index
        await this.addToIndex(`${this.prefixes.analytics}index:${type}`, key, ttl + 60);
        
        this.incrementStat('sets');
        logger.debug(`📊 Cached analytics: ${type}-${identifier}`);
      }

      return success;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error caching analytics:', error);
      return false;
    }
  }

  /**
   * Get cached analytics
   */
  async getAnalytics(type, identifier) {
    try {
      const key = `${this.prefixes.analytics}${type}:${identifier}`;
      const cached = await this.getWithDecompression(key);
      
      if (cached) {
        this.incrementStat('hits');
        logger.debug(`📊 Cache hit - analytics: ${type}-${identifier}`);
        return {
          ...cached.analytics,
          fromCache: true,
          generatedAt: cached.generatedAt,
          dataPoints: cached.dataPoints
        };
      }
      
      this.incrementStat('misses');
      return null;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error getting cached analytics:', error);
      return null;
    }
  }

  /**
   * Invalidate analytics cache
   */
  async invalidateAnalytics(type, identifier = null) {
    try {
      let deletedCount = 0;
      
      if (identifier) {
        // Specific analytics
        const key = `${this.prefixes.analytics}${type}:${identifier}`;
        deletedCount = await this.redis.del(key);
        
      } else {
        // All analytics of type
        const indexKey = `${this.prefixes.analytics}index:${type}`;
        const keys = await this.redis.sMembers(indexKey);
        
        if (keys.length > 0) {
          deletedCount = await this.redis.del(keys);
          await this.redis.del(indexKey);
        }
      }
      
      this.incrementStat('deletes', deletedCount);
      logger.info(`🗑️ Invalidated ${deletedCount} analytics cache entries`);
      
      return deletedCount;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error invalidating analytics cache:', error);
      return 0;
    }
  }

  /**
   * ================================
   * HOTEL DATA CACHING (TTL: 6h)
   * ================================
   */

  /**
   * Cache hotel data
   */
  async cacheHotelData(hotelId, hotelData, dataType = 'full', customTTL = null) {
    try {
      const key = `${this.prefixes.hotel}${hotelId}:${dataType}`;
      const ttl = customTTL || this.ttl.hotelData;
      
      const cacheData = {
        hotel: hotelData,
        hotelId,
        dataType,
        cachedAt: new Date().toISOString(),
        roomCount: hotelData.stats?.totalRooms || 0,
        lastUpdated: hotelData.updatedAt || new Date().toISOString(),
        version: '1.0'
      };

      const success = await this.setWithCompression(key, cacheData, ttl);
      
      if (success) {
        // Add to hotel index
        await this.addToIndex(`${this.prefixes.hotel}index:all`, key, ttl + 60);
        
        this.incrementStat('sets');
        logger.debug(`🏨 Cached hotel data: ${hotelId}-${dataType}`);
      }

      return success;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error caching hotel data:', error);
      return false;
    }
  }

  /**
   * Get cached hotel data
   */
  async getHotelData(hotelId, dataType = 'full') {
    try {
      const key = `${this.prefixes.hotel}${hotelId}:${dataType}`;
      const cached = await this.getWithDecompression(key);
      
      if (cached) {
        this.incrementStat('hits');
        logger.debug(`🏨 Cache hit - hotel data: ${hotelId}-${dataType}`);
        return {
          ...cached.hotel,
          fromCache: true,
          cachedAt: cached.cachedAt
        };
      }
      
      this.incrementStat('misses');
      return null;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error getting cached hotel data:', error);
      return null;
    }
  }

  /**
   * Invalidate hotel data cache
   */
  async invalidateHotelData(hotelId, dataType = null) {
    try {
      let deletedCount = 0;
      
      if (dataType) {
        // Specific data type
        const key = `${this.prefixes.hotel}${hotelId}:${dataType}`;
        deletedCount = await this.redis.del(key);
        
      } else {
        // All hotel data
        const pattern = `${this.prefixes.hotel}${hotelId}:*`;
        const keys = await this.redis.keys(pattern);
        
        if (keys.length > 0) {
          deletedCount = await this.redis.del(keys);
        }
      }
      
      this.incrementStat('deletes', deletedCount);
      logger.info(`🗑️ Invalidated ${deletedCount} hotel data cache entries for ${hotelId}`);
      
      return deletedCount;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error invalidating hotel data cache:', error);
      return 0;
    }
  }

  /**
   * ================================
   * GLOBAL INVALIDATION METHODS
   * ================================
   */

  /**
   * Invalidate all cache for a hotel
   */
  async invalidateHotelCache(hotelId) {
    try {
      const results = await Promise.allSettled([
        this.invalidateAvailability(hotelId),
        this.invalidateYieldPricing(hotelId),
        this.invalidateHotelData(hotelId),
        this.invalidateAnalytics('hotel', hotelId)
      ]);
      
      const totalDeleted = results
        .filter(result => result.status === 'fulfilled')
        .reduce((sum, result) => sum + result.value, 0);
      
      logger.info(`🗑️ Total cache invalidated for hotel ${hotelId}: ${totalDeleted} entries`);
      
      return totalDeleted;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error invalidating hotel cache:', error);
      return 0;
    }
  }

  /**
   * Clear all cache (use with caution)
   */
  async clearAllCache() {
    try {
      await this.redis.flushDb();
      
      // Reset stats
      this.resetStats();
      
      logger.warn('🗑️ All cache cleared!');
      return true;
      
    } catch (error) {
      this.incrementStat('errors');
      logger.error('❌ Error clearing all cache:', error);
      return false;
    }
  }

  /**
   * ================================
   * COMPRESSION & UTILITIES
   * ================================
   */

  /**
   * Set data with optional compression
   */
  async setWithCompression(key, data, ttl) {
    try {
      let serialized = JSON.stringify(data);
      let compressed = false;
      
      // Compress if data is large enough
      if (this.config.enableCompression && serialized.length > this.config.compressionThreshold) {
        const compressedData = await gzip(serialized);
        
        if (compressedData.length < serialized.length) {
          serialized = compressedData.toString('base64');
          compressed = true;
          
          const savedBytes = serialized.length - compressedData.length;
          this.stats.compressionSaved += savedBytes;
          
          logger.debug(`📦 Compressed cache data: ${savedBytes} bytes saved`);
        }
      }
      
      // Check size limit
      if (serialized.length > this.config.maxValueSize) {
        logger.warn(`⚠️ Cache value too large: ${serialized.length} bytes (max: ${this.config.maxValueSize})`);
        return false;
      }
      
      // Add compression flag
      const finalData = {
        __compressed: compressed,
        __data: compressed ? serialized : data
      };
      
      await this.redis.setEx(key, ttl, JSON.stringify(finalData));
      this.incrementStat('totalOperations');
      
      return true;
      
    } catch (error) {
      logger.error('❌ Error setting compressed cache:', error);
      return false;
    }
  }

  /**
   * Get data with decompression
   */
  async getWithDecompression(key) {
    try {
      const cached = await this.redis.get(key);
      if (!cached) return null;
      
      const parsedData = JSON.parse(cached);
      
      // Handle compressed data
      if (parsedData.__compressed) {
        const compressedBuffer = Buffer.from(parsedData.__data, 'base64');
        const decompressed = await gunzip(compressedBuffer);
        return JSON.parse(decompressed.toString());
      }
      
      // Handle uncompressed data
      return parsedData.__data || parsedData;
      
    } catch (error) {
      logger.error('❌ Error getting decompressed cache:', error);
      return null;
    }
  }

  /**
   * ================================
   * INDEX MANAGEMENT
   * ================================
   */

  /**
   * Add key to index set
   */
  async addToIndex(indexKey, key, ttl) {
    try {
      await this.redis.sAdd(indexKey, key);
      await this.redis.expire(indexKey, ttl);
    } catch (error) {
      logger.error('❌ Error adding to index:', error);
    }
  }

  /**
   * Remove key from index set
   */
  async removeFromIndex(indexKey, key) {
    try {
      await this.redis.sRem(indexKey, key);
    } catch (error) {
      logger.error('❌ Error removing from index:', error);
    }
  }

  /**
   * ================================
   * KEY BUILDERS
   * ================================
   */

  buildAvailabilityKey(hotelId, checkIn, checkOut) {
    const checkInStr = checkIn.toISOString().split('T')[0];
    const checkOutStr = checkOut.toISOString().split('T')[0];
    return `${this.prefixes.availability}${hotelId}:${checkInStr}:${checkOutStr}`;
  }

  buildYieldKey(hotelId, roomType, date) {
    const dateStr = date.toISOString().split('T')[0];
    return `${this.prefixes.yield}${hotelId}:${roomType}:${dateStr}`;
  }

  /**
   * ================================
   * VALIDATION METHODS
   * ================================
   */

  validateAvailabilityData(cached, hotelId, checkIn, checkOut) {
    return cached.hotelId === hotelId &&
           cached.checkIn === checkIn.toISOString() &&
           cached.checkOut === checkOut.toISOString() &&
           cached.data && 
           typeof cached.data === 'object';
  }

  validateYieldData(cached, hotelId, roomType, date) {
    return cached.hotelId === hotelId &&
           cached.roomType === roomType &&
           cached.date === date.toISOString() &&
           cached.pricing &&
           typeof cached.pricing === 'object';
  }

  /**
   * ================================
   * STATS & MONITORING
   * ================================
   */

  incrementStat(statName, value = 1) {
    if (this.config.enableStats) {
      this.stats[statName] = (this.stats[statName] || 0) + value;
      this.stats.totalOperations++;
    }
  }

  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      compressionSaved: 0,
      totalOperations: 0
    };
  }

  async getStats() {
    try {
      const redisInfo = await redisConfig.getHealthInfo();
      const hitRate = this.stats.totalOperations > 0 ? 
        Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100) : 0;
      
      return {
        cache: {
          ...this.stats,
          hitRate: hitRate || 0,
          missRate: 100 - hitRate,
          compressionSavedMB: Math.round(this.stats.compressionSaved / 1024 / 1024 * 100) / 100
        },
        redis: redisInfo,
        config: {
          enableCompression: this.config.enableCompression,
          compressionThreshold: this.config.compressionThreshold,
          maxValueSize: this.config.maxValueSize
        },
        ttl: this.ttl
      };
    } catch (error) {
      logger.error('❌ Error getting cache stats:', error);
      return { error: error.message };
    }
  }

  logStats() {
    if (this.stats.totalOperations > 0) {
      const hitRate = Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100) || 0;
      logger.info(`📊 Cache Stats - Hit Rate: ${hitRate}%, Operations: ${this.stats.totalOperations}, Errors: ${this.stats.errors}`);
    }
  }

  /**
   * ================================
   * CACHE WARMING
   * ================================
   */

  /**
   * Warm up cache with frequently accessed data
   */
  async warmUpCache(hotelIds = []) {
    logger.info('🔥 Starting cache warm-up...');
    
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const dayAfter = new Date(tomorrow);
      dayAfter.setDate(dayAfter.getDate() + 1);
      
      for (const hotelId of hotelIds) {
        // Warm up availability for next few days
        await this.warmUpAvailability(hotelId, tomorrow, dayAfter);
        
        // Warm up hotel data
        await this.warmUpHotelData(hotelId);
      }
      
      logger.info(`🔥 Cache warm-up completed for ${hotelIds.length} hotels`);
      
    } catch (error) {
      logger.error('❌ Error during cache warm-up:', error);
    }
  }

  async warmUpAvailability(hotelId, checkIn, checkOut) {
    // This would typically fetch and cache availability data
    // Implementation depends on your availability service
    logger.debug(`🔥 Warming up availability cache for hotel ${hotelId}`);
  }

  async warmUpHotelData(hotelId) {
    // This would typically fetch and cache hotel data
    // Implementation depends on your hotel service
    logger.debug(`🔥 Warming up hotel data cache for hotel ${hotelId}`);
  }
}

// Export singleton instance
module.exports = new CacheService();