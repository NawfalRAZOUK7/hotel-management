/**
 * Dynamic Pricing Service - Week 3
 * Real-time pricing engine with demand-based pricing, yield management
 * Supports live price broadcasting and intelligent pricing algorithms
 */

const socketService = require('./socketService');
const currencyService = require('./currencyService');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { logger } = require('../utils/logger');
const moment = require('moment');

class DynamicPricingService {
    constructor() {
        this.priceCache = new Map(); // hotelId-roomType-date -> price
        this.demandCache = new Map(); // hotelId-date -> demand level
        this.competitorCache = new Map(); // hotelId -> competitor prices
        this.pricingRules = new Map(); // hotelId -> pricing rules
        
        // Pricing configuration
        this.config = {
            baseMultipliers: {
                'VERY_LOW': 0.7,    // 30% discount
                'LOW': 0.85,        // 15% discount  
                'NORMAL': 1.0,      // Base price
                'HIGH': 1.25,       // 25% increase
                'VERY_HIGH': 1.5,   // 50% increase
                'PEAK': 2.0         // 100% increase (special events)
            },
            seasonalMultipliers: {
                'LOW_SEASON': 0.8,
                'SHOULDER_SEASON': 1.0,
                'HIGH_SEASON': 1.3,
                'PEAK_SEASON': 1.6
            },
            dayOfWeekMultipliers: {
                'SUNDAY': 0.9,
                'MONDAY': 0.85,
                'TUESDAY': 0.85,
                'WEDNESDAY': 0.9,
                'THURSDAY': 0.95,
                'FRIDAY': 1.15,
                'SATURDAY': 1.25
            },
            advanceBookingDiscounts: {
                '90_DAYS': 0.2,     // 20% discount for 90+ days advance
                '60_DAYS': 0.15,    // 15% discount for 60+ days advance
                '30_DAYS': 0.1,     // 10% discount for 30+ days advance
                '7_DAYS': 0.05,     // 5% discount for 7+ days advance
                'LAST_MINUTE': 1.1  // 10% premium for same-day booking
            },
            lengthOfStayDiscounts: {
                '1_NIGHT': 1.0,
                '2_3_NIGHTS': 0.95,
                '4_6_NIGHTS': 0.9,
                '7_13_NIGHTS': 0.85,
                '14_PLUS_NIGHTS': 0.8
            }
        };

        // Initialize pricing engine
        this.initializePricingEngine();
        logger.info('Dynamic Pricing Service initialized');
    }

    /**
     * Initialize pricing engine with periodic updates
     */
    initializePricingEngine() {
        // Update demand levels every 15 minutes
        setInterval(() => {
            this.updateDemandLevels();
        }, 15 * 60 * 1000);

        // Update competitor prices every hour
        setInterval(() => {
            this.updateCompetitorPrices();
        }, 60 * 60 * 1000);

        // Clear old cache entries daily
        setInterval(() => {
            this.cleanupCache();
        }, 24 * 60 * 60 * 1000);

        // Initial data load
        this.loadPricingRules();
        this.updateDemandLevels();
    }

    /**
     * Calculate dynamic price for a room
     * @param {Object} params - Pricing parameters
     * @returns {Object} Price calculation result
     */
    async calculateDynamicPrice(params) {
        try {
            const {
                hotelId,
                roomType,
                checkInDate,
                checkOutDate,
                guestCount = 1,
                advanceBookingDays = 0,
                isLoyaltyMember = false,
                promotionCode = null,
                currency = 'EUR'
            } = params;

            // Get base price from database
            const room = await Room.findOne({ hotel: hotelId, type: roomType });
            if (!room) {
                throw new Error(`Room type ${roomType} not found for hotel ${hotelId}`);
            }

            let basePrice = room.basePrice;
            const numberOfNights = moment(checkOutDate).diff(moment(checkInDate), 'days');

            // Apply pricing factors
            const pricingFactors = await this.calculatePricingFactors({
                hotelId,
                roomType,
                checkInDate,
                checkOutDate,
                numberOfNights,
                advanceBookingDays,
                guestCount,
                isLoyaltyMember
            });

            // Calculate final price
            const calculatedPrice = this.applyPricingFactors(basePrice, pricingFactors);

            // Apply promotion if provided
            let finalPrice = calculatedPrice;
            if (promotionCode) {
                finalPrice = await this.applyPromotionCode(calculatedPrice, promotionCode, hotelId);
            }

            // Convert currency if needed
            if (currency !== 'EUR') {
                const conversion = await currencyService.convertCurrency(finalPrice, 'EUR', currency);
                finalPrice = conversion.convertedAmount;
            }

            const priceResult = {
                hotelId,
                roomType,
                checkInDate,
                checkOutDate,
                numberOfNights,
                basePrice,
                finalPrice: Math.round(finalPrice * 100) / 100,
                currency,
                pricingFactors,
                savings: basePrice > finalPrice ? basePrice - finalPrice : 0,
                priceIncrease: finalPrice > basePrice ? finalPrice - basePrice : 0,
                calculatedAt: new Date(),
                validUntil: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes validity
            };

            // Cache the result
            this.cachePriceResult(priceResult);

            // Broadcast price update if significant change
            await this.broadcastPriceUpdate(hotelId, roomType, priceResult);

            return priceResult;

        } catch (error) {
            logger.error('Error calculating dynamic price:', error);
            throw error;
        }
    }

    /**
     * Calculate all pricing factors
     * @param {Object} params - Calculation parameters
     * @returns {Object} Pricing factors
     */
    async calculatePricingFactors(params) {
        const {
            hotelId,
            roomType,
            checkInDate,
            numberOfNights,
            advanceBookingDays,
            isLoyaltyMember
        } = params;

        const factors = {
            demand: await this.getDemandMultiplier(hotelId, checkInDate),
            seasonal: this.getSeasonalMultiplier(checkInDate),
            dayOfWeek: this.getDayOfWeekMultiplier(checkInDate),
            advanceBooking: this.getAdvanceBookingMultiplier(advanceBookingDays),
            lengthOfStay: this.getLengthOfStayMultiplier(numberOfNights),
            occupancy: await this.getOccupancyMultiplier(hotelId, checkInDate),
            competitor: await this.getCompetitorMultiplier(hotelId, roomType),
            loyalty: isLoyaltyMember ? 0.95 : 1.0, // 5% loyalty discount
            lastMinute: this.getLastMinuteMultiplier(advanceBookingDays),
            eventBased: await this.getEventBasedMultiplier(hotelId, checkInDate)
        };

        return factors;
    }

    /**
     * Apply all pricing factors to base price
     * @param {Number} basePrice - Base room price
     * @param {Object} factors - Pricing factors
     * @returns {Number} Final calculated price
     */
    applyPricingFactors(basePrice, factors) {
        let price = basePrice;

        // Apply multiplicative factors
        price *= factors.demand;
        price *= factors.seasonal;
        price *= factors.dayOfWeek;
        price *= factors.occupancy;
        price *= factors.competitor;
        price *= factors.loyalty;
        price *= factors.eventBased;

        // Apply additive discounts
        if (factors.advanceBooking < 1.0) {
            price = price * factors.advanceBooking;
        }

        if (factors.lengthOfStay < 1.0) {
            price = price * factors.lengthOfStay;
        }

        // Apply last minute premium/discount
        price *= factors.lastMinute;

        return Math.max(price, basePrice * 0.5); // Never go below 50% of base price
    }

    /**
     * Get demand multiplier based on current bookings and search volume
     * @param {String} hotelId - Hotel ID
     * @param {Date} date - Check-in date
     * @returns {Number} Demand multiplier
     */
    async getDemandMultiplier(hotelId, date) {
        try {
            const cacheKey = `${hotelId}-${moment(date).format('YYYY-MM-DD')}`;
            const cached = this.demandCache.get(cacheKey);
            
            if (cached && Date.now() - cached.timestamp < 15 * 60 * 1000) {
                return this.config.baseMultipliers[cached.level];
            }

            // Calculate demand based on bookings and searches
            const startDate = moment(date).startOf('day').toDate();
            const endDate = moment(date).endOf('day').toDate();

            // Get booking count for the date
            const bookingCount = await Booking.countDocuments({
                hotel: hotelId,
                checkInDate: { $lte: endDate },
                checkOutDate: { $gte: startDate },
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });

            // Get total rooms for hotel
            const totalRooms = await Room.aggregate([
                { $match: { hotel: hotelId } },
                { $group: { _id: null, total: { $sum: '$quantity' } } }
            ]);

            const totalRoomsCount = totalRooms[0]?.total || 1;
            const occupancyRate = bookingCount / totalRoomsCount;

            // Determine demand level
            let demandLevel;
            if (occupancyRate >= 0.95) demandLevel = 'PEAK';
            else if (occupancyRate >= 0.85) demandLevel = 'VERY_HIGH';
            else if (occupancyRate >= 0.70) demandLevel = 'HIGH';
            else if (occupancyRate >= 0.50) demandLevel = 'NORMAL';
            else if (occupancyRate >= 0.30) demandLevel = 'LOW';
            else demandLevel = 'VERY_LOW';

            // Cache result
            this.demandCache.set(cacheKey, {
                level: demandLevel,
                occupancyRate,
                timestamp: Date.now()
            });

            return this.config.baseMultipliers[demandLevel];

        } catch (error) {
            logger.error('Error calculating demand multiplier:', error);
            return 1.0; // Default to no change
        }
    }

    /**
     * Get seasonal pricing multiplier
     * @param {Date} date - Check-in date
     * @returns {Number} Seasonal multiplier
     */
    getSeasonalMultiplier(date) {
        const month = moment(date).month() + 1; // moment months are 0-indexed
        
        // Define seasons (can be customized per hotel/region)
        if ([12, 1, 2].includes(month)) return this.config.seasonalMultipliers.HIGH_SEASON; // Winter
        if ([6, 7, 8].includes(month)) return this.config.seasonalMultipliers.PEAK_SEASON; // Summer
        if ([3, 4, 5, 9, 10, 11].includes(month)) return this.config.seasonalMultipliers.SHOULDER_SEASON; // Spring/Fall
        
        return this.config.seasonalMultipliers.LOW_SEASON;
    }

    /**
     * Get day of week pricing multiplier
     * @param {Date} date - Check-in date
     * @returns {Number} Day of week multiplier
     */
    getDayOfWeekMultiplier(date) {
        const dayName = moment(date).format('dddd').toUpperCase();
        return this.config.dayOfWeekMultipliers[dayName] || 1.0;
    }

    /**
     * Get advance booking multiplier
     * @param {Number} advanceBookingDays - Days in advance
     * @returns {Number} Advance booking multiplier
     */
    getAdvanceBookingMultiplier(advanceBookingDays) {
        if (advanceBookingDays >= 90) return 1 - this.config.advanceBookingDiscounts['90_DAYS'];
        if (advanceBookingDays >= 60) return 1 - this.config.advanceBookingDiscounts['60_DAYS'];
        if (advanceBookingDays >= 30) return 1 - this.config.advanceBookingDiscounts['30_DAYS'];
        if (advanceBookingDays >= 7) return 1 - this.config.advanceBookingDiscounts['7_DAYS'];
        if (advanceBookingDays <= 1) return this.config.advanceBookingDiscounts['LAST_MINUTE'];
        
        return 1.0;
    }

    /**
     * Get length of stay multiplier
     * @param {Number} numberOfNights - Number of nights
     * @returns {Number} Length of stay multiplier
     */
    getLengthOfStayMultiplier(numberOfNights) {
        if (numberOfNights >= 14) return this.config.lengthOfStayDiscounts['14_PLUS_NIGHTS'];
        if (numberOfNights >= 7) return this.config.lengthOfStayDiscounts['7_13_NIGHTS'];
        if (numberOfNights >= 4) return this.config.lengthOfStayDiscounts['4_6_NIGHTS'];
        if (numberOfNights >= 2) return this.config.lengthOfStayDiscounts['2_3_NIGHTS'];
        
        return this.config.lengthOfStayDiscounts['1_NIGHT'];
    }

    /**
     * Get occupancy-based multiplier
     * @param {String} hotelId - Hotel ID
     * @param {Date} date - Check-in date
     * @returns {Number} Occupancy multiplier
     */
    async getOccupancyMultiplier(hotelId, date) {
        try {
            // Get current occupancy for the week
            const weekStart = moment(date).startOf('week').toDate();
            const weekEnd = moment(date).endOf('week').toDate();

            const weeklyBookings = await Booking.countDocuments({
                hotel: hotelId,
                checkInDate: { $gte: weekStart },
                checkOutDate: { $lte: weekEnd },
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
            });

            const totalRooms = await Room.aggregate([
                { $match: { hotel: hotelId } },
                { $group: { _id: null, total: { $sum: '$quantity' } } }
            ]);

            const totalRoomsCount = totalRooms[0]?.total || 1;
            const weeklyCapacity = totalRoomsCount * 7;
            const occupancyRate = weeklyBookings / weeklyCapacity;

            // Adjust pricing based on weekly occupancy trend
            if (occupancyRate >= 0.9) return 1.3; // High occupancy premium
            if (occupancyRate >= 0.7) return 1.1; // Moderate premium
            if (occupancyRate <= 0.3) return 0.9; // Low occupancy discount
            
            return 1.0;

        } catch (error) {
            logger.error('Error calculating occupancy multiplier:', error);
            return 1.0;
        }
    }

    /**
     * Get competitor-based pricing multiplier
     * @param {String} hotelId - Hotel ID
     * @param {String} roomType - Room type
     * @returns {Number} Competitor multiplier
     */
    async getCompetitorMultiplier(hotelId, roomType) {
        try {
            const competitorData = this.competitorCache.get(hotelId);
            if (!competitorData) return 1.0;

            // Simple competitor-based adjustment
            // In real implementation, this would integrate with competitor price APIs
            const ourPrice = competitorData.ourPrice || 0;
            const avgCompetitorPrice = competitorData.avgPrice || ourPrice;

            if (ourPrice > avgCompetitorPrice * 1.2) return 0.95; // We're too expensive, discount
            if (ourPrice < avgCompetitorPrice * 0.8) return 1.05; // We're too cheap, increase
            
            return 1.0;

        } catch (error) {
            logger.error('Error calculating competitor multiplier:', error);
            return 1.0;
        }
    }

    /**
     * Get last minute pricing multiplier
     * @param {Number} advanceBookingDays - Days in advance
     * @returns {Number} Last minute multiplier
     */
    getLastMinuteMultiplier(advanceBookingDays) {
        if (advanceBookingDays <= 0) return 1.2; // Same day premium
        if (advanceBookingDays <= 3) return 1.1; // 3-day premium
        return 1.0;
    }

    /**
     * Get event-based pricing multiplier
     * @param {String} hotelId - Hotel ID
     * @param {Date} date - Check-in date
     * @returns {Number} Event-based multiplier
     */
    async getEventBasedMultiplier(hotelId, date) {
        try {
            // Check for special events (holidays, conferences, etc.)
            // This would integrate with event APIs or predefined event calendar
            
            const dateStr = moment(date).format('MM-DD');
            const specialEvents = {
                '12-25': 2.0,  // Christmas
                '12-31': 1.8,  // New Year's Eve
                '01-01': 1.5,  // New Year's Day
                '07-04': 1.3,  // Independence Day (if applicable)
                // Add more events as needed
            };

            return specialEvents[dateStr] || 1.0;

        } catch (error) {
            logger.error('Error calculating event-based multiplier:', error);
            return 1.0;
        }
    }

    /**
     * Apply promotion code discount
     * @param {Number} price - Current price
     * @param {String} promotionCode - Promotion code
     * @param {String} hotelId - Hotel ID
     * @returns {Number} Discounted price
     */
    async applyPromotionCode(price, promotionCode, hotelId) {
        try {
            // This would integrate with your promotion system
            // For now, using mock promotion logic
            const promotions = {
                'EARLY20': 0.8,    // 20% off
                'WEEKEND15': 0.85, // 15% off
                'LOYALTY10': 0.9,  // 10% off
                'SUMMER25': 0.75   // 25% off
            };

            const discount = promotions[promotionCode];
            if (discount) {
                logger.info(`Applied promotion ${promotionCode} to hotel ${hotelId}`);
                return price * discount;
            }

            return price;

        } catch (error) {
            logger.error('Error applying promotion code:', error);
            return price;
        }
    }

    /**
     * Broadcast price update to connected clients
     * @param {String} hotelId - Hotel ID
     * @param {String} roomType - Room type
     * @param {Object} priceResult - Price calculation result
     */
    async broadcastPriceUpdate(hotelId, roomType, priceResult) {
        try {
            const updateData = {
                hotelId,
                roomType,
                newPrice: priceResult.finalPrice,
                oldPrice: priceResult.basePrice,
                currency: priceResult.currency,
                validUntil: priceResult.validUntil,
                pricingFactors: priceResult.pricingFactors,
                timestamp: new Date()
            };

            // Broadcast to all clients viewing this hotel
            socketService.sendHotelNotification(hotelId, 'price-update', updateData);

            // Broadcast to clients with active searches
            socketService.broadcastAvailabilityUpdate(hotelId, {
                type: 'price-update',
                roomType,
                priceData: updateData
            });

            logger.info(`Price update broadcasted for hotel ${hotelId}, room type ${roomType}`);

        } catch (error) {
            logger.error('Error broadcasting price update:', error);
        }
    }

    /**
     * Update demand levels for all hotels
     */
    async updateDemandLevels() {
        try {
            const hotels = await Hotel.find({}, '_id').lean();
            const today = new Date();
            const next30Days = moment().add(30, 'days').toDate();

            for (const hotel of hotels) {
                // Update demand for next 30 days
                for (let d = new Date(today); d <= next30Days; d.setDate(d.getDate() + 1)) {
                    await this.getDemandMultiplier(hotel._id, new Date(d));
                }
            }

            logger.info('Demand levels updated for all hotels');

        } catch (error) {
            logger.error('Error updating demand levels:', error);
        }
    }

    /**
     * Update competitor prices (mock implementation)
     */
    async updateCompetitorPrices() {
        try {
            const hotels = await Hotel.find({}, '_id name').lean();

            for (const hotel of hotels) {
                // Mock competitor price data
                // In real implementation, this would call competitor APIs
                this.competitorCache.set(hotel._id.toString(), {
                    ourPrice: 150,
                    avgPrice: 145,
                    minPrice: 120,
                    maxPrice: 180,
                    lastUpdated: new Date()
                });
            }

            logger.info('Competitor prices updated');

        } catch (error) {
            logger.error('Error updating competitor prices:', error);
        }
    }

    /**
     * Load pricing rules for hotels
     */
    async loadPricingRules() {
        try {
            const hotels = await Hotel.find({}, '_id pricingRules').lean();

            for (const hotel of hotels) {
                if (hotel.pricingRules) {
                    this.pricingRules.set(hotel._id.toString(), hotel.pricingRules);
                }
            }

            logger.info('Pricing rules loaded for all hotels');

        } catch (error) {
            logger.error('Error loading pricing rules:', error);
        }
    }

    /**
     * Cache price result
     * @param {Object} priceResult - Price calculation result
     */
    cachePriceResult(priceResult) {
        const cacheKey = `${priceResult.hotelId}-${priceResult.roomType}-${moment(priceResult.checkInDate).format('YYYY-MM-DD')}`;
        this.priceCache.set(cacheKey, {
            ...priceResult,
            cachedAt: Date.now()
        });
    }

    /**
     * Get cached price if available and valid
     * @param {String} hotelId - Hotel ID
     * @param {String} roomType - Room type
     * @param {Date} checkInDate - Check-in date
     * @returns {Object|null} Cached price result
     */
    getCachedPrice(hotelId, roomType, checkInDate) {
        const cacheKey = `${hotelId}-${roomType}-${moment(checkInDate).format('YYYY-MM-DD')}`;
        const cached = this.priceCache.get(cacheKey);

        if (cached && Date.now() - cached.cachedAt < 30 * 60 * 1000) { // 30 minutes validity
            return cached;
        }

        return null;
    }

    /**
     * Clean up old cache entries
     */
    cleanupCache() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        // Clean price cache
        for (const [key, value] of this.priceCache.entries()) {
            if (now - value.cachedAt > maxAge) {
                this.priceCache.delete(key);
            }
        }

        // Clean demand cache
        for (const [key, value] of this.demandCache.entries()) {
            if (now - value.timestamp > maxAge) {
                this.demandCache.delete(key);
            }
        }

        logger.info('Cache cleanup completed');
    }

    /**
     * Get pricing analytics for admin dashboard
     * @param {String} hotelId - Hotel ID
     * @param {Number} days - Number of days to analyze
     * @returns {Object} Pricing analytics
     */
    async getPricingAnalytics(hotelId, days = 30) {
        try {
            const analytics = {
                averagePrices: {},
                demandTrends: {},
                occupancyRates: {},
                revenueProjections: {},
                competitorComparison: this.competitorCache.get(hotelId),
                pricingRecommendations: []
            };

            // Calculate analytics for the specified period
            const startDate = moment().toDate();
            const endDate = moment().add(days, 'days').toDate();

            // Get room types for hotel
            const rooms = await Room.find({ hotel: hotelId }, 'type basePrice').lean();

            for (const room of rooms) {
                // Calculate average prices and demand for each room type
                let totalPrice = 0;
                let priceCount = 0;

                for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
                    const priceResult = await this.calculateDynamicPrice({
                        hotelId,
                        roomType: room.type,
                        checkInDate: new Date(d),
                        checkOutDate: moment(d).add(1, 'day').toDate()
                    });

                    totalPrice += priceResult.finalPrice;
                    priceCount++;
                }

                analytics.averagePrices[room.type] = {
                    basePrice: room.basePrice,
                    averagePrice: totalPrice / priceCount,
                    priceIncrease: ((totalPrice / priceCount) - room.basePrice) / room.basePrice * 100
                };
            }

            return analytics;

        } catch (error) {
            logger.error('Error getting pricing analytics:', error);
            throw error;
        }
    }

    /**
     * Get service status
     * @returns {Object} Service status
     */
    getServiceStatus() {
        return {
            isActive: true,
            cacheSize: {
                prices: this.priceCache.size,
                demand: this.demandCache.size,
                competitors: this.competitorCache.size
            },
            lastUpdate: new Date(),
            configuration: {
                updateInterval: '15 minutes',
                cacheExpiry: '30 minutes',
                demandLevels: Object.keys(this.config.baseMultipliers)
            }
        };
    }
}

// Export singleton instance
module.exports = new DynamicPricingService();