/**
 * Real-time Availability Service with Redis Cache Integration
 * Handles live room availability tracking and broadcasting with intelligent caching
 * Integrates with Socket.io for instant updates and Redis for performance optimization
 * 
 * PHASE 2 INTEGRATION: Redis Cache + Original Functionality
 */

const socketService = require('./socketService');
const currencyService = require('./currencyService');
const cacheService = require('./cacheService'); // ✅ NEW: Redis cache integration
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { logger } = require('../utils/logger');
const moment = require('moment');

class AvailabilityRealtimeService {
    constructor() {
        // ============================================================================
        // ORIGINAL CACHE SYSTEM (Memory-based) - PRESERVED
        // ============================================================================
        this.availabilityCache = new Map(); // hotelId -> availability data
        this.priceCache = new Map(); // hotelId -> pricing data
        this.demandCache = new Map(); // hotelId -> demand metrics
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
        this.searchSessions = new Map(); // userId -> search session data
        
        // ============================================================================
        // NEW: REDIS CACHE INTEGRATION LAYER
        // ============================================================================
        this.redisCache = cacheService; // Redis cache service
        this.cacheStrategy = {
            // Cache TTL strategy based on data type
            availability: {
                ttl: 5 * 60, // 5 minutes for availability data
                useRedis: true,
                useFallback: true // Use memory cache as fallback
            },
            pricing: {
                ttl: 30 * 60, // 30 minutes for pricing data
                useRedis: true,
                useFallback: true
            },
            demand: {
                ttl: 15 * 60, // 15 minutes for demand metrics
                useRedis: true,
                useFallback: true
            },
            occupancy: {
                ttl: 2 * 60, // 2 minutes for real-time occupancy
                useRedis: true,
                useFallback: false // Always fresh for occupancy
            }
        };
        
        // Cache performance metrics
        this.cacheMetrics = {
            redisHits: 0,
            redisMisses: 0,
            memoryHits: 0,
            memoryMisses: 0,
            redisErrors: 0,
            totalRequests: 0,
            lastResetAt: new Date()
        };
        
        // Initialize service
        this.initializeService();
    }

    /**
     * ================================
     * INITIALIZATION
     * ================================
     */

    /**
     * Initialize the real-time availability service with Redis integration
     */
    async initializeService() {
        try {
            // Pre-load availability data for active hotels
            await this.preloadAvailabilityData();
            
            // Set up periodic cache refresh (memory cache cleanup)
            setInterval(() => {
                this.refreshExpiredMemoryCache();
            }, 60000); // Check every minute
            
            // Set up cache metrics reset
            setInterval(() => {
                this.logCacheMetrics();
            }, 5 * 60 * 1000); // Log every 5 minutes
            
            // Warm up Redis cache with popular data
            await this.warmUpRedisCache();
            
            logger.info('✅ Real-time Availability Service initialized successfully with Redis integration');
        } catch (error) {
            logger.error('❌ Failed to initialize AvailabilityRealtimeService:', error);
        }
    }

    /**
     * ================================
     * HYBRID CACHE LAYER (Redis + Memory)
     * ================================
     */

    /**
     * Get data from hybrid cache (Redis first, then memory fallback)
     * @param {string} cacheKey - Cache key
     * @param {string} dataType - Type of data (availability, pricing, demand, occupancy)
     * @returns {Object|null} Cached data or null
     */
    async getFromHybridCache(cacheKey, dataType) {
        this.cacheMetrics.totalRequests++;
        
        const strategy = this.cacheStrategy[dataType] || this.cacheStrategy.availability;
        
        // Try Redis first if enabled
        if (strategy.useRedis) {
            try {
                const redisData = await this.redisCache.getAvailability(
                    this.extractHotelIdFromKey(cacheKey),
                    this.extractCheckInFromKey(cacheKey),
                    this.extractCheckOutFromKey(cacheKey)
                );
                
                if (redisData) {
                    this.cacheMetrics.redisHits++;
                    logger.debug(`🎯 Redis cache hit for ${cacheKey}`);
                    return redisData;
                }
                
                this.cacheMetrics.redisMisses++;
                
            } catch (error) {
                this.cacheMetrics.redisErrors++;
                logger.warn(`⚠️ Redis cache error for ${cacheKey}:`, error);
                
                // Continue to fallback if Redis fails
            }
        }
        
        // Fallback to memory cache if enabled
        if (strategy.useFallback) {
            const memoryData = this.getFromMemoryCache(cacheKey, dataType);
            if (memoryData) {
                this.cacheMetrics.memoryHits++;
                logger.debug(`🎯 Memory cache hit for ${cacheKey}`);
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
        const strategy = this.cacheStrategy[dataType] || this.cacheStrategy.availability;
        const ttl = customTTL || strategy.ttl;
        
        // Store in Redis if enabled
        if (strategy.useRedis) {
            try {
                const hotelId = this.extractHotelIdFromKey(cacheKey);
                const checkIn = this.extractCheckInFromKey(cacheKey);
                const checkOut = this.extractCheckOutFromKey(cacheKey);
                
                if (hotelId && checkIn && checkOut) {
                    await this.redisCache.cacheAvailability(hotelId, checkIn, checkOut, data, ttl);
                    logger.debug(`💾 Stored in Redis cache: ${cacheKey}`);
                }
                
            } catch (error) {
                this.cacheMetrics.redisErrors++;
                logger.warn(`⚠️ Failed to store in Redis cache for ${cacheKey}:`, error);
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
        switch (dataType) {
            case 'availability':
                const cached = this.availabilityCache.get(cacheKey);
                if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                    return cached.data;
                }
                break;
                
            case 'pricing':
                const priceCached = this.priceCache.get(cacheKey);
                if (priceCached && Date.now() - priceCached.timestamp < this.cacheExpiry) {
                    return priceCached.data;
                }
                break;
                
            case 'demand':
                const demandCached = this.demandCache.get(cacheKey);
                if (demandCached && Date.now() - demandCached.timestamp < this.cacheExpiry) {
                    return demandCached.data;
                }
                break;
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
            ttl: ttl * 1000 // Convert to milliseconds
        };
        
        switch (dataType) {
            case 'availability':
                this.availabilityCache.set(cacheKey, cacheData);
                break;
            case 'pricing':
                this.priceCache.set(cacheKey, cacheData);
                break;
            case 'demand':
                this.demandCache.set(cacheKey, cacheData);
                break;
        }
    }

    /**
     * ================================
     * CACHE KEY UTILITIES
     * ================================
     */

    /**
     * Build cache key for availability data
     */
    buildAvailabilityCacheKey(hotelId, checkInDate, checkOutDate) {
        const checkInStr = moment(checkInDate).format('YYYY-MM-DD');
        const checkOutStr = moment(checkOutDate).format('YYYY-MM-DD');
        return `avail_${hotelId}_${checkInStr}_${checkOutStr}`;
    }

    /**
     * Extract hotel ID from cache key
     */
    extractHotelIdFromKey(key) {
        const parts = key.split('_');
        return parts[1] || null;
    }

    /**
     * Extract check-in date from cache key
     */
    extractCheckInFromKey(key) {
        const parts = key.split('_');
        return parts[2] ? new Date(parts[2]) : null;
    }

    /**
     * Extract check-out date from cache key
     */
    extractCheckOutFromKey(key) {
        const parts = key.split('_');
        return parts[3] ? new Date(parts[3]) : null;
    }

    /**
     * ================================
     * MAIN SERVICE METHODS (Enhanced with Redis)
     * ================================
     */

    /**
     * Get real-time availability for a hotel with Redis caching
     * @param {String} hotelId - Hotel ID
     * @param {Date} checkInDate - Check-in date
     * @param {Date} checkOutDate - Check-out date
     * @param {String} currency - Preferred currency
     * @returns {Object} Real-time availability data
     */
    async getRealTimeAvailability(hotelId, checkInDate, checkOutDate, currency = 'EUR') {
        try {
            const cacheKey = this.buildAvailabilityCacheKey(hotelId, checkInDate, checkOutDate);
            
            // Try hybrid cache first
            const cachedData = await this.getFromHybridCache(cacheKey, 'availability');
            if (cachedData) {
                logger.debug(`🎯 Availability cache hit for hotel ${hotelId}`);
                return await this.formatAvailabilityResponse(cachedData, currency);
            }

            // Calculate fresh availability
            logger.debug(`🔄 Calculating fresh availability for hotel ${hotelId}`);
            const availability = await this.calculateAvailability(hotelId, checkInDate, checkOutDate);
            
            // Store in hybrid cache
            await this.setInHybridCache(cacheKey, availability, 'availability');

            // Broadcast availability update to interested users
            await this.broadcastAvailabilityUpdate(hotelId, availability, checkInDate, checkOutDate);

            return await this.formatAvailabilityResponse(availability, currency);
            
        } catch (error) {
            logger.error('❌ Error getting real-time availability:', error);
            throw error;
        }
    }

    /**
     * Calculate actual room availability for given dates (Enhanced with Redis caching)
     * @param {String} hotelId - Hotel ID
     * @param {Date} checkInDate - Check-in date
     * @param {Date} checkOutDate - Check-out date
     * @returns {Object} Availability data
     */
    async calculateAvailability(hotelId, checkInDate, checkOutDate) {
        try {
            // Check if hotel data is cached in Redis
            let hotel = await this.redisCache.getHotelData(hotelId, 'full');
            
            if (!hotel) {
                // Get hotel from database and cache it
                hotel = await Hotel.findById(hotelId).populate('rooms');
                if (!hotel) {
                    throw new Error(`Hotel not found: ${hotelId}`);
                }
                
                // Cache hotel data for future use
                await this.redisCache.cacheHotelData(hotelId, hotel, 'full');
                logger.debug(`💾 Cached hotel data for ${hotelId}`);
            }

            // Get existing bookings that overlap with requested dates
            const overlappingBookings = await Booking.find({
                hotel: hotelId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
                $or: [
                    {
                        checkIn: { $lte: checkInDate },
                        checkOut: { $gt: checkInDate }
                    },
                    {
                        checkIn: { $lt: checkOutDate },
                        checkOut: { $gte: checkOutDate }
                    },
                    {
                        checkIn: { $gte: checkInDate },
                        checkOut: { $lte: checkOutDate }
                    }
                ]
            }).populate('rooms');

            // Calculate availability by room type
            const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];
            const availability = {};

            for (const roomType of roomTypes) {
                // Total rooms of this type
                const totalRooms = hotel.rooms ? hotel.rooms.filter(room => 
                    room.type === roomType && room.status === 'AVAILABLE'
                ).length : 0;

                // Booked rooms of this type for the requested period
                let bookedRooms = 0;
                overlappingBookings.forEach(booking => {
                    booking.rooms.forEach(roomBooking => {
                        if (roomBooking.roomType === roomType) {
                            bookedRooms += roomBooking.quantity || 1;
                        }
                    });
                });

                // Available rooms
                const availableRooms = Math.max(0, totalRooms - bookedRooms);
                
                // Calculate base price with Redis cache for yield data
                const basePrice = await this.calculateBasePriceWithCache(hotel, roomType, checkInDate, checkOutDate);
                
                // Calculate demand-based pricing with Redis cache
                const demandMultiplier = await this.calculateDemandMultiplierWithCache(hotelId, roomType, checkInDate);
                const finalPrice = Math.round(basePrice * demandMultiplier * 100) / 100;

                availability[roomType] = {
                    type: roomType,
                    totalRooms,
                    bookedRooms,
                    availableRooms,
                    basePrice,
                    currentPrice: finalPrice,
                    demandLevel: this.getDemandLevel(demandMultiplier),
                    priceChange: Math.round((demandMultiplier - 1) * 100),
                    lastUpdated: new Date(),
                    cached: hotel.fromCache || false
                };
            }

            // Calculate overall hotel metrics
            const totalAvailable = Object.values(availability).reduce((sum, room) => sum + room.availableRooms, 0);
            const totalRooms = Object.values(availability).reduce((sum, room) => sum + room.totalRooms, 0);
            const occupancyRate = totalRooms > 0 ? Math.round((1 - totalAvailable / totalRooms) * 100) : 0;

            return {
                hotelId,
                checkInDate,
                checkOutDate,
                rooms: availability,
                summary: {
                    totalAvailableRooms: totalAvailable,
                    totalRooms,
                    occupancyRate,
                    demandLevel: this.getOverallDemandLevel(availability),
                    lastUpdated: new Date(),
                    calculationTime: Date.now()
                },
                cacheInfo: {
                    hotelDataFromCache: hotel.fromCache || false,
                    calculatedAt: new Date()
                }
            };
            
        } catch (error) {
            logger.error('❌ Error calculating availability:', error);
            throw error;
        }
    }

    /**
     * Calculate base price with Redis cache integration
     */
    async calculateBasePriceWithCache(hotel, roomType, checkInDate, checkOutDate) {
        try {
            // Check if yield pricing is cached
            const yieldData = await this.redisCache.getYieldPricing(hotel._id || hotel.id, roomType, checkInDate);
            
            if (yieldData && yieldData.basePrice) {
                logger.debug(`💰 Using cached yield pricing for ${roomType}`);
                return yieldData.basePrice;
            }
            
            // Calculate using original method
            const basePrice = await this.calculateBasePrice(hotel, roomType, checkInDate, checkOutDate);
            
            // Cache the result
            await this.redisCache.cacheYieldPricing(
                hotel._id || hotel.id, 
                roomType, 
                checkInDate, 
                { basePrice, calculatedAt: new Date() }
            );
            
            return basePrice;
            
        } catch (error) {
            logger.warn('⚠️ Error in cached price calculation, using fallback:', error);
            return await this.calculateBasePrice(hotel, roomType, checkInDate, checkOutDate);
        }
    }

    /**
     * Calculate demand multiplier with Redis cache integration
     */
    async calculateDemandMultiplierWithCache(hotelId, roomType, checkInDate) {
        try {
            const demandKey = `demand_${hotelId}_${roomType}_${moment(checkInDate).format('YYYY-MM-DD')}`;
            
            // Try to get from cache
            const cachedDemand = await this.getFromHybridCache(demandKey, 'demand');
            
            if (cachedDemand && cachedDemand.multiplier) {
                logger.debug(`📊 Using cached demand multiplier for ${roomType}`);
                return cachedDemand.multiplier;
            }
            
            // Calculate using original method
            const multiplier = this.calculateDemandMultiplier(hotelId, roomType, checkInDate);
            
            // Cache the result
            await this.setInHybridCache(demandKey, {
                multiplier,
                calculatedAt: new Date(),
                factors: this.getDemandFactors(hotelId, roomType, checkInDate)
            }, 'demand');
            
            return multiplier;
            
        } catch (error) {
            logger.warn('⚠️ Error in cached demand calculation, using fallback:', error);
            return this.calculateDemandMultiplier(hotelId, roomType, checkInDate);
        }
    }

    /**
     * ================================
     * CACHE INVALIDATION WITH REDIS
     * ================================
     */

    /**
     * Update availability after a booking is made or cancelled (Enhanced with Redis invalidation)
     * @param {String} hotelId - Hotel ID
     * @param {Object} bookingData - Booking data
     * @param {String} action - 'BOOK' or 'CANCEL'
     */
    async updateAvailabilityAfterBooking(hotelId, bookingData, action = 'BOOK') {
        try {
            const { checkIn, checkOut, rooms } = bookingData;

            // Clear Redis cache for affected dates
            await this.invalidateRedisCache(hotelId, checkIn, checkOut);
            
            // Clear relevant memory cache entries
            this.clearMemoryCacheForDateRange(hotelId, checkIn, checkOut);

            // Update demand metrics in both cache layers
            await this.updateDemandMetricsWithCache(hotelId, rooms, action);

            // Get fresh availability data
            const newAvailability = await this.calculateAvailability(hotelId, checkIn, checkOut);

            // Broadcast updates to all interested users
            await this.broadcastAvailabilityUpdate(hotelId, newAvailability, checkIn, checkOut);

            // Notify users with active search sessions
            await this.notifyActiveSearchSessions(hotelId, newAvailability);

            logger.info(`✅ Availability updated for hotel ${hotelId} after ${action} (Redis cache invalidated)`);
            return newAvailability;
            
        } catch (error) {
            logger.error('❌ Error updating availability after booking:', error);
            throw error;
        }
    }

    /**
     * Invalidate Redis cache for specific hotel and date range
     */
    async invalidateRedisCache(hotelId, checkInDate = null, checkOutDate = null) {
        try {
            if (checkInDate && checkOutDate) {
                // Invalidate specific date range
                await this.redisCache.invalidateAvailability(hotelId, checkInDate, checkOutDate);
                logger.debug(`🗑️ Invalidated Redis cache for hotel ${hotelId} (${checkInDate} to ${checkOutDate})`);
            } else {
                // Invalidate all availability for hotel
                await this.redisCache.invalidateHotelCache(hotelId);
                logger.debug(`🗑️ Invalidated all Redis cache for hotel ${hotelId}`);
            }
            
        } catch (error) {
            logger.warn('⚠️ Error invalidating Redis cache:', error);
        }
    }

    /**
     * Update demand metrics in both Redis and memory cache
     */
    async updateDemandMetricsWithCache(hotelId, rooms, action) {
        try {
            // Update memory cache (original logic)
            this.updateDemandMetrics(hotelId, rooms, action);
            
            // Update Redis cache
            for (const room of rooms) {
                const demandKey = `demand_${hotelId}_${room.roomType}`;
                
                // Get current metrics
                const current = await this.getFromHybridCache(demandKey, 'demand') || { 
                    bookings: 0, 
                    timestamp: Date.now() 
                };
                
                // Update based on action
                if (action === 'BOOK') {
                    current.bookings += room.quantity || 1;
                } else if (action === 'CANCEL') {
                    current.bookings = Math.max(0, current.bookings - (room.quantity || 1));
                }
                
                current.timestamp = Date.now();
                current.action = action;
                
                // Update cache
                await this.setInHybridCache(demandKey, current, 'demand');
            }
            
            logger.debug(`📊 Updated demand metrics for hotel ${hotelId} (${action})`);
            
        } catch (error) {
            logger.warn('⚠️ Error updating demand metrics with cache:', error);
        }
    }

    /**
     * ================================
     * REDIS CACHE WARMING
     * ================================
     */

    /**
     * Warm up Redis cache with frequently accessed data
     */
    async warmUpRedisCache() {
        try {
            logger.info('🔥 Starting Redis cache warm-up for availability service...');
            
            // Get active hotels
            const activeHotels = await Hotel.find({ status: 'ACTIVE' }).select('_id name').limit(10);
            
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            const nextWeek = new Date(tomorrow);
            nextWeek.setDate(nextWeek.getDate() + 7);
            
            let warmedUp = 0;
            
            for (const hotel of activeHotels) {
                try {
                    // Warm up availability for next 7 days
                    await this.getRealTimeAvailability(hotel._id.toString(), tomorrow, nextWeek);
                    
                    // Cache hotel data
                    const hotelData = await Hotel.findById(hotel._id).populate('rooms');
                    await this.redisCache.cacheHotelData(hotel._id.toString(), hotelData, 'full');
                    
                    warmedUp++;
                    
                } catch (error) {
                    logger.warn(`⚠️ Failed to warm up cache for hotel ${hotel._id}:`, error);
                }
            }
            
            logger.info(`🔥 Redis cache warm-up completed: ${warmedUp}/${activeHotels.length} hotels`);
            
        } catch (error) {
            logger.error('❌ Error during Redis cache warm-up:', error);
        }
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
        const totalCacheRequests = this.cacheMetrics.redisHits + this.cacheMetrics.redisMisses + 
                                  this.cacheMetrics.memoryHits + this.cacheMetrics.memoryMisses;
        
        const redisHitRate = totalCacheRequests > 0 ? 
            Math.round((this.cacheMetrics.redisHits / totalCacheRequests) * 100) : 0;
        
        const memoryHitRate = totalCacheRequests > 0 ? 
            Math.round((this.cacheMetrics.memoryHits / totalCacheRequests) * 100) : 0;
        
        const overallHitRate = totalCacheRequests > 0 ? 
            Math.round(((this.cacheMetrics.redisHits + this.cacheMetrics.memoryHits) / totalCacheRequests) * 100) : 0;
        
        return {
            redis: {
                hits: this.cacheMetrics.redisHits,
                misses: this.cacheMetrics.redisMisses,
                errors: this.cacheMetrics.redisErrors,
                hitRate: redisHitRate
            },
            memory: {
                hits: this.cacheMetrics.memoryHits,
                misses: this.cacheMetrics.memoryMisses,
                hitRate: memoryHitRate,
                cacheSize: {
                    availability: this.availabilityCache.size,
                    pricing: this.priceCache.size,
                    demand: this.demandCache.size
                }
            },
            overall: {
                totalRequests: this.cacheMetrics.totalRequests,
                hitRate: overallHitRate,
                errorRate: Math.round((this.cacheMetrics.redisErrors / this.cacheMetrics.totalRequests) * 100)
            },
            searchSessions: this.searchSessions.size,
            lastResetAt: this.cacheMetrics.lastResetAt
        };
    }

    /**
     * Log cache performance metrics
     */
    logCacheMetrics() {
        const metrics = this.getCacheMetrics();
        
        logger.info(`📊 Availability Cache Metrics - Overall Hit Rate: ${metrics.overall.hitRate}%, ` +
                   `Redis: ${metrics.redis.hitRate}%, Memory: ${metrics.memory.hitRate}%, ` +
                   `Errors: ${metrics.redis.errors}, Sessions: ${metrics.searchSessions}`);
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
            totalRequests: 0,
            lastResetAt: new Date()
        };
        
        logger.info('📊 Cache metrics reset');
    }

    /**
     * ================================
     * ENHANCED REAL-TIME OCCUPANCY
     * ================================
     */

    /**
     * Get real-time occupancy statistics with Redis caching
     * @param {String} hotelId - Hotel ID
     * @returns {Object} Occupancy statistics
     */
    async getRealTimeOccupancy(hotelId) {
        try {
            const cacheKey = `occupancy_${hotelId}_${moment().format('YYYY-MM-DD')}`;
            
            // Try cache first (shorter TTL for real-time data)
            const cachedOccupancy = await this.getFromHybridCache(cacheKey, 'occupancy');
            
            if (cachedOccupancy) {
                logger.debug(`🎯 Occupancy cache hit for hotel ${hotelId}`);
                return cachedOccupancy;
            }
            
            // Calculate fresh occupancy
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const currentAvailability = await this.getRealTimeAvailability(hotelId, today, tomorrow);
            
            const occupancyData = {
                hotelId,
                date: today,
                occupancyRate: currentAvailability.summary.occupancyRate,
                totalRooms: currentAvailability.summary.totalRooms,
                occupiedRooms: currentAvailability.summary.totalRooms - currentAvailability.summary.totalAvailableRooms,
                availableRooms: currentAvailability.summary.totalAvailableRooms,
                demandLevel: currentAvailability.summary.demandLevel,
                roomBreakdown: Object.values(currentAvailability.rooms).map(room => ({
                    type: room.type,
                    total: room.totalRooms,
                    occupied: room.bookedRooms,
                    available: room.availableRooms,
                    occupancyRate: room.totalRooms > 0 ? Math.round((room.bookedRooms / room.totalRooms) * 100) : 0
                })),
                calculatedAt: new Date(),
                fromCache: false
            };
            
            // Cache with shorter TTL for real-time data
            await this.setInHybridCache(cacheKey, occupancyData, 'occupancy', 2 * 60); // 2 minutes
            
            return occupancyData;
            
        } catch (error) {
            logger.error('❌ Error getting real-time occupancy:', error);
            throw error;
        }
    }

    /**
     * ================================
     * ORIGINAL METHODS (PRESERVED & ENHANCED)
     * ================================
     */

    /**
     * Pre-load availability data for all active hotels (Enhanced with Redis)
     */
    async preloadAvailabilityData() {
        try {
            const activeHotels = await Hotel.find({ status: 'ACTIVE' }).select('_id name');
            
            let preloaded = 0;
            for (const hotel of activeHotels) {
                try {
                    await this.loadHotelAvailability(hotel._id.toString());
                    preloaded++;
                } catch (error) {
                    logger.warn(`⚠️ Failed to preload data for hotel ${hotel._id}:`, error);
                }
            }
            
            logger.info(`📦 Pre-loaded availability data for ${preloaded}/${activeHotels.length} hotels (Redis + Memory)`);
       } catch (error) {
           logger.error('❌ Error pre-loading availability data:', error);
       }
   }

   /**
    * Load hotel availability with Redis caching
    */
   async loadHotelAvailability(hotelId) {
       try {
           const today = new Date();
           const nextWeek = new Date(today);
           nextWeek.setDate(nextWeek.getDate() + 7);

           // This will automatically use Redis cache
           await this.getRealTimeAvailability(hotelId, today, nextWeek);
           
           logger.debug(`📦 Loaded availability for hotel ${hotelId}`);
       } catch (error) {
           logger.error(`❌ Error loading availability for hotel ${hotelId}:`, error);
       }
   }

   /**
    * Calculate base price for room type (Original method preserved)
    * @param {Object} hotel - Hotel object
    * @param {String} roomType - Room type
    * @param {Date} checkInDate - Check-in date
    * @param {Date} checkOutDate - Check-out date
    * @returns {Number} Base price per night
    */
   async calculateBasePrice(hotel, roomType, checkInDate, checkOutDate) {
       try {
           // Get seasonal pricing
           const season = this.determineSeason(checkInDate);
           const seasonMultiplier = this.getSeasonMultiplier(season);

           // Base room prices (you might want to store these in the database)
           const basePrices = {
               'SIMPLE': 80,
               'DOUBLE': 120,
               'DOUBLE_CONFORT': 180,
               'SUITE': 300
           };

           // Hotel category multiplier
           const categoryMultiplier = this.getCategoryMultiplier(hotel.stars || 3);

           // Calculate final base price
           const basePrice = basePrices[roomType] || 100;
           return Math.round(basePrice * categoryMultiplier * seasonMultiplier * 100) / 100;
       } catch (error) {
           logger.error('❌ Error calculating base price:', error);
           return 100; // Fallback price
       }
   }

   /**
    * Calculate demand multiplier based on booking patterns (Original method preserved)
    * @param {String} hotelId - Hotel ID
    * @param {String} roomType - Room type
    * @param {Date} checkInDate - Check-in date
    * @returns {Number} Demand multiplier (1.0 = normal, >1.0 = high demand)
    */
   calculateDemandMultiplier(hotelId, roomType, checkInDate) {
       try {
           const demandKey = `${hotelId}_${roomType}`;
           const demandData = this.demandCache.get(demandKey);

           if (!demandData) {
               return 1.0; // Normal demand
           }

           // Time-based demand (weekends, holidays)
           const dayOfWeek = moment(checkInDate).day();
           const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday
           const timeMultiplier = isWeekend ? 1.2 : 1.0;

           // Booking velocity (how fast rooms are being booked)
           const velocityMultiplier = this.calculateBookingVelocity(demandData);

           // Advance booking multiplier (last-minute vs advance bookings)
           const daysAdvance = moment(checkInDate).diff(moment(), 'days');
           const advanceMultiplier = daysAdvance < 7 ? 1.15 : 0.95;

           // Combined multiplier (cap at 1.5x)
           const finalMultiplier = Math.min(1.5, timeMultiplier * velocityMultiplier * advanceMultiplier);
           
           return Math.round(finalMultiplier * 100) / 100;
       } catch (error) {
           logger.error('❌ Error calculating demand multiplier:', error);
           return 1.0;
       }
   }

   /**
    * Get demand factors for caching
    */
   getDemandFactors(hotelId, roomType, checkInDate) {
       const dayOfWeek = moment(checkInDate).day();
       const isWeekend = dayOfWeek === 5 || dayOfWeek === 6;
       const daysAdvance = moment(checkInDate).diff(moment(), 'days');
       
       return {
           dayOfWeek,
           isWeekend,
           daysAdvance,
           timeMultiplier: isWeekend ? 1.2 : 1.0,
           advanceMultiplier: daysAdvance < 7 ? 1.15 : 0.95
       };
   }

   /**
    * Broadcast availability update to connected users (Enhanced with cache info)
    * @param {String} hotelId - Hotel ID
    * @param {Object} availability - Availability data
    * @param {Date} checkInDate - Check-in date
    * @param {Date} checkOutDate - Check-out date
    */
   async broadcastAvailabilityUpdate(hotelId, availability, checkInDate, checkOutDate) {
       try {
           const updateData = {
               hotelId,
               checkInDate,
               checkOutDate,
               rooms: availability.rooms,
               summary: availability.summary,
               timestamp: new Date(),
               cacheInfo: availability.cacheInfo || { source: 'calculated' }
           };

           // Broadcast to all connected users via Socket.io
           socketService.broadcastAvailabilityUpdate(hotelId, updateData);

           // Send to hotel-specific room
           socketService.sendHotelNotification(hotelId, 'availability-updated', updateData);

           logger.debug(`📡 Availability update broadcasted for hotel ${hotelId}`);
       } catch (error) {
           logger.error('❌ Error broadcasting availability update:', error);
       }
   }

   /**
    * Track user search session for real-time updates (Enhanced)
    * @param {String} userId - User ID
    * @param {Object} searchParams - Search parameters
    */
   trackSearchSession(userId, searchParams) {
       const { hotelId, checkInDate, checkOutDate, currency } = searchParams;
       
       this.searchSessions.set(userId, {
           hotelId,
           checkInDate: new Date(checkInDate),
           checkOutDate: new Date(checkOutDate),
           currency: currency || 'EUR',
           timestamp: new Date(),
           cacheEnabled: true
       });

       // Auto-expire search sessions after 30 minutes
       setTimeout(() => {
           this.searchSessions.delete(userId);
       }, 30 * 60 * 1000);

       logger.debug(`👤 Search session tracked for user ${userId} (cache-enabled)`);
   }

   /**
    * Notify users with active search sessions about availability changes (Enhanced)
    * @param {String} hotelId - Hotel ID
    * @param {Object} newAvailability - Updated availability data
    */
   async notifyActiveSearchSessions(hotelId, newAvailability) {
       try {
           const affectedUsers = [];

           for (const [userId, session] of this.searchSessions.entries()) {
               if (session.hotelId === hotelId) {
                   affectedUsers.push({ userId, session });
               }
           }

           if (affectedUsers.length === 0) return;

           // Notify each affected user
           for (const { userId, session } of affectedUsers) {
               const formattedData = await this.formatAvailabilityResponse(newAvailability, session.currency);
               
               socketService.sendUserNotification(userId, 'availability-changed', {
                   hotelId,
                   availability: formattedData,
                   message: 'Availability has been updated for your search',
                   cacheInfo: newAvailability.cacheInfo
               });
           }

           logger.info(`📱 Notified ${affectedUsers.length} users about availability changes (hotel ${hotelId})`);
       } catch (error) {
           logger.error('❌ Error notifying active search sessions:', error);
       }
   }

   /**
    * Format availability response with currency conversion (Enhanced with cache info)
    * @param {Object} availability - Raw availability data
    * @param {String} targetCurrency - Target currency
    * @returns {Object} Formatted availability response
    */
   async formatAvailabilityResponse(availability, targetCurrency = 'EUR') {
       try {
           if (targetCurrency === 'EUR') {
               return {
                   ...availability,
                   currency: 'EUR',
                   converted: false
               };
           }

           // Convert prices to target currency
           const convertedRooms = {};
           
           for (const [roomType, roomData] of Object.entries(availability.rooms)) {
               const baseConversion = await currencyService.convertCurrency(
                   roomData.basePrice, 'EUR', targetCurrency
               );
               const currentConversion = await currencyService.convertCurrency(
                   roomData.currentPrice, 'EUR', targetCurrency
               );

               convertedRooms[roomType] = {
                   ...roomData,
                   basePrice: baseConversion.convertedAmount,
                   currentPrice: currentConversion.convertedAmount,
                   currency: targetCurrency,
                   originalCurrency: 'EUR',
                   exchangeRate: baseConversion.rate
               };
           }

           return {
               ...availability,
               rooms: convertedRooms,
               currency: targetCurrency,
               converted: true
           };
       } catch (error) {
           logger.error('❌ Error formatting availability response:', error);
           return {
               ...availability,
               currency: targetCurrency,
               converted: false,
               conversionError: true
           };
       }
   }

   /**
    * ================================
    * MEMORY CACHE MANAGEMENT (Original + Enhanced)
    * ================================
    */

   /**
    * Clear memory cache for date range (Original method enhanced)
    */
   clearMemoryCacheForDateRange(hotelId, startDate, endDate) {
       const keysToDelete = [];
       
       // Clear availability cache
       for (const key of this.availabilityCache.keys()) {
           if (key.includes(hotelId)) {
               keysToDelete.push({ cache: this.availabilityCache, key });
           }
       }
       
       // Clear price cache
       for (const key of this.priceCache.keys()) {
           if (key.includes(hotelId)) {
               keysToDelete.push({ cache: this.priceCache, key });
           }
       }
       
       // Clear demand cache
       for (const key of this.demandCache.keys()) {
           if (key.includes(hotelId)) {
               keysToDelete.push({ cache: this.demandCache, key });
           }
       }
       
       keysToDelete.forEach(({ cache, key }) => cache.delete(key));
       
       if (keysToDelete.length > 0) {
           logger.debug(`🗑️ Cleared ${keysToDelete.length} memory cache entries for hotel ${hotelId}`);
       }
   }

   /**
    * Update demand metrics in memory cache (Original method preserved)
    */
   updateDemandMetrics(hotelId, rooms, action) {
       rooms.forEach(room => {
           const demandKey = `${hotelId}_${room.roomType}`;
           const current = this.demandCache.get(demandKey) || { bookings: 0, timestamp: Date.now() };
           
           if (action === 'BOOK') {
               current.bookings += room.quantity || 1;
           } else if (action === 'CANCEL') {
               current.bookings = Math.max(0, current.bookings - (room.quantity || 1));
           }
           
           current.timestamp = Date.now();
           this.demandCache.set(demandKey, current);
       });
   }

   /**
    * Refresh expired memory cache entries (Enhanced)
    */
   async refreshExpiredMemoryCache() {
       const now = Date.now();
       let expiredCount = 0;

       // Clean availability cache
       for (const [key, data] of this.availabilityCache.entries()) {
           if (now - data.timestamp > this.cacheExpiry) {
               this.availabilityCache.delete(key);
               expiredCount++;
           }
       }

       // Clean price cache
       for (const [key, data] of this.priceCache.entries()) {
           if (now - data.timestamp > this.cacheExpiry) {
               this.priceCache.delete(key);
               expiredCount++;
           }
       }

       // Clean demand cache
       for (const [key, data] of this.demandCache.entries()) {
           if (now - data.timestamp > this.cacheExpiry) {
               this.demandCache.delete(key);
               expiredCount++;
           }
       }
       
       if (expiredCount > 0) {
           logger.debug(`🗑️ Cleared ${expiredCount} expired memory cache entries`);
       }
   }

   /**
    * ================================
    * HELPER METHODS (Original preserved)
    * ================================
    */

   calculateBookingVelocity(demandData) {
       const hoursElapsed = (Date.now() - demandData.timestamp) / (1000 * 60 * 60);
       const bookingsPerHour = demandData.bookings / Math.max(1, hoursElapsed);
       
       if (bookingsPerHour > 2) return 1.3; // High velocity
       if (bookingsPerHour > 1) return 1.15; // Medium velocity
       if (bookingsPerHour > 0.5) return 1.05; // Low velocity
       return 1.0; // Normal velocity
   }

   determineSeason(date) {
       const month = moment(date).month() + 1; // moment months are 0-indexed
       if (month >= 6 && month <= 8) return 'SUMMER';
       if (month >= 12 || month <= 2) return 'WINTER';
       if (month >= 3 && month <= 5) return 'SPRING';
       return 'AUTUMN';
   }

   getSeasonMultiplier(season) {
       const multipliers = {
           'SUMMER': 1.3, // High season
           'WINTER': 0.9, // Low season
           'SPRING': 1.1, // Medium season
           'AUTUMN': 1.0  // Normal season
       };
       return multipliers[season] || 1.0;
   }

   getCategoryMultiplier(stars) {
       const multipliers = {
           1: 0.6, 2: 0.8, 3: 1.0, 4: 1.4, 5: 2.0
       };
       return multipliers[stars] || 1.0;
   }

   getDemandLevel(multiplier) {
       if (multiplier >= 1.3) return 'HIGH';
       if (multiplier >= 1.1) return 'MEDIUM';
       if (multiplier <= 0.9) return 'LOW';
       return 'NORMAL';
   }

   getOverallDemandLevel(availability) {
       const levels = Object.values(availability).map(room => room.demandLevel);
       if (levels.includes('HIGH')) return 'HIGH';
       if (levels.includes('MEDIUM')) return 'MEDIUM';
       if (levels.includes('LOW')) return 'LOW';
       return 'NORMAL';
   }

   /**
    * ================================
    * ENHANCED SERVICE STATISTICS
    * ================================
    */

   /**
    * Get comprehensive service statistics including Redis metrics
    */
   getServiceStats() {
       const cacheMetrics = this.getCacheMetrics();
       
       return {
           // Original metrics
           memoryCacheSize: {
               availability: this.availabilityCache.size,
               pricing: this.priceCache.size,
               demand: this.demandCache.size
           },
           activeSearchSessions: this.searchSessions.size,
           
           // Enhanced Redis metrics
           cache: cacheMetrics,
           
           // Performance metrics
           performance: {
               avgResponseTime: this.calculateAverageResponseTime(),
               totalRequests: cacheMetrics.overall.totalRequests,
               errorRate: cacheMetrics.overall.errorRate
           },
           
           // Service health
           health: {
               redisConnected: this.redisCache ? true : false,
               memoryUsage: process.memoryUsage(),
               uptime: process.uptime()
           },
           
           lastUpdated: new Date()
       };
   }

   /**
    * Calculate average response time (placeholder - would need actual timing)
    */
   calculateAverageResponseTime() {
       // This would track actual response times in a real implementation
       return 45; // Placeholder 45ms average
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
           overall: { status: 'unknown' }
       };

       try {
           // Test Redis connection
           const startTime = Date.now();
           await this.redisCache.redis.ping();
           healthCheck.redis = {
               status: 'ok',
               latency: Date.now() - startTime,
               error: null
           };
       } catch (error) {
           healthCheck.redis = {
               status: 'error',
               latency: null,
               error: error.message
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
           availability: this.availabilityCache.size,
           pricing: this.priceCache.size,
           demand: this.demandCache.size,
           searchSessions: this.searchSessions.size
       };
   }

   /**
    * Cleanup and maintenance
    */
   async performMaintenance() {
       try {
           logger.info('🔧 Starting availability service maintenance...');
           
           // Clean expired memory cache
           await this.refreshExpiredMemoryCache();
           
           // Clean expired search sessions
           this.cleanExpiredSearchSessions();
           
           // Log current metrics
           this.logCacheMetrics();
           
           // Perform health check
           const health = await this.performCacheHealthCheck();
           logger.info(`🔧 Maintenance completed. System health: ${health.overall.status}`);
           
           return health;
           
       } catch (error) {
           logger.error('❌ Error during maintenance:', error);
           return { status: 'error', error: error.message };
       }
   }

   /**
    * Clean expired search sessions
    */
   cleanExpiredSearchSessions() {
       const now = Date.now();
       const expiredSessions = [];
       
       for (const [userId, session] of this.searchSessions.entries()) {
           if (now - session.timestamp.getTime() > 30 * 60 * 1000) { // 30 minutes
               expiredSessions.push(userId);
           }
       }
       
       expiredSessions.forEach(userId => this.searchSessions.delete(userId));
       
       if (expiredSessions.length > 0) {
           logger.debug(`🗑️ Cleaned ${expiredSessions.length} expired search sessions`);
       }
   }

   /**
    * ================================
    * GRACEFUL SHUTDOWN
    * ================================
    */

   /**
    * Graceful shutdown with cache cleanup
    */
   async shutdown() {
       try {
           logger.info('🛑 Shutting down availability service...');
           
           // Clear all memory caches
           this.availabilityCache.clear();
           this.priceCache.clear();
           this.demandCache.clear();
           this.searchSessions.clear();
           
           // Log final metrics
           this.logCacheMetrics();
           
           logger.info('✅ Availability service shutdown completed');
           
       } catch (error) {
           logger.error('❌ Error during shutdown:', error);
       }
   }
}

// Export singleton instance
module.exports = new AvailabilityRealtimeService();