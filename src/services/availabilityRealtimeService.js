/**
 * Real-time Availability Service
 * Handles live room availability tracking and broadcasting
 * Integrates with Socket.io for instant updates
 */

const socketService = require('./socketService');
const currencyService = require('./currencyService');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const { logger } = require('../utils/logger');
const moment = require('moment');

class AvailabilityRealtimeService {
    constructor() {
        this.availabilityCache = new Map(); // hotelId -> availability data
        this.priceCache = new Map(); // hotelId -> pricing data
        this.demandCache = new Map(); // hotelId -> demand metrics
        this.cacheExpiry = 5 * 60 * 1000; // 5 minutes cache
        this.searchSessions = new Map(); // userId -> search session data
        
        // Initialize service
        this.initializeService();
    }

    /**
     * Initialize the real-time availability service
     */
    async initializeService() {
        try {
            // Pre-load availability data for active hotels
            await this.preloadAvailabilityData();
            
            // Set up periodic cache refresh
            setInterval(() => {
                this.refreshExpiredCache();
            }, 60000); // Check every minute
            
            logger.info('Real-time Availability Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize AvailabilityRealtimeService:', error);
        }
    }

    /**
     * Pre-load availability data for all active hotels
     */
    async preloadAvailabilityData() {
        try {
            const activeHotels = await Hotel.find({ status: 'ACTIVE' }).select('_id name');
            
            for (const hotel of activeHotels) {
                await this.loadHotelAvailability(hotel._id.toString());
            }
            
            logger.info(`Pre-loaded availability data for ${activeHotels.length} hotels`);
        } catch (error) {
            logger.error('Error pre-loading availability data:', error);
        }
    }

    /**
     * Get real-time availability for a hotel
     * @param {String} hotelId - Hotel ID
     * @param {Date} checkInDate - Check-in date
     * @param {Date} checkOutDate - Check-out date
     * @param {String} currency - Preferred currency
     * @returns {Object} Real-time availability data
     */
    async getRealTimeAvailability(hotelId, checkInDate, checkOutDate, currency = 'EUR') {
        try {
            const cacheKey = `${hotelId}_${checkInDate}_${checkOutDate}`;
            const cached = this.availabilityCache.get(cacheKey);
            
            // Return cached data if still valid
            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                return await this.formatAvailabilityResponse(cached.data, currency);
            }

            // Calculate fresh availability
            const availability = await this.calculateAvailability(hotelId, checkInDate, checkOutDate);
            
            // Cache the results
            this.availabilityCache.set(cacheKey, {
                data: availability,
                timestamp: Date.now()
            });

            // Broadcast availability update to interested users
            await this.broadcastAvailabilityUpdate(hotelId, availability, checkInDate, checkOutDate);

            return await this.formatAvailabilityResponse(availability, currency);
        } catch (error) {
            logger.error('Error getting real-time availability:', error);
            throw error;
        }
    }

    /**
     * Calculate actual room availability for given dates
     * @param {String} hotelId - Hotel ID
     * @param {Date} checkInDate - Check-in date
     * @param {Date} checkOutDate - Check-out date
     * @returns {Object} Availability data
     */
    async calculateAvailability(hotelId, checkInDate, checkOutDate) {
        try {
            // Get hotel with rooms
            const hotel = await Hotel.findById(hotelId).populate('rooms');
            if (!hotel) {
                throw new Error(`Hotel not found: ${hotelId}`);
            }

            // Get existing bookings that overlap with requested dates
            const overlappingBookings = await Booking.find({
                hotel: hotelId,
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] },
                $or: [
                    {
                        checkInDate: { $lte: checkInDate },
                        checkOutDate: { $gt: checkInDate }
                    },
                    {
                        checkInDate: { $lt: checkOutDate },
                        checkOutDate: { $gte: checkOutDate }
                    },
                    {
                        checkInDate: { $gte: checkInDate },
                        checkOutDate: { $lte: checkOutDate }
                    }
                ]
            }).populate('rooms');

            // Calculate availability by room type
            const roomTypes = ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'];
            const availability = {};

            for (const roomType of roomTypes) {
                // Total rooms of this type
                const totalRooms = hotel.rooms.filter(room => 
                    room.type === roomType && room.status === 'AVAILABLE'
                ).length;

                // Booked rooms of this type for the requested period
                let bookedRooms = 0;
                overlappingBookings.forEach(booking => {
                    booking.rooms.forEach(roomBooking => {
                        if (roomBooking.roomType === roomType) {
                            bookedRooms += roomBooking.quantity;
                        }
                    });
                });

                // Available rooms
                const availableRooms = Math.max(0, totalRooms - bookedRooms);
                
                // Calculate base price
                const basePrice = await this.calculateBasePrice(hotel, roomType, checkInDate, checkOutDate);
                
                // Calculate demand-based pricing
                const demandMultiplier = this.calculateDemandMultiplier(hotelId, roomType, checkInDate);
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
                    lastUpdated: new Date()
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
                    lastUpdated: new Date()
                }
            };
        } catch (error) {
            logger.error('Error calculating availability:', error);
            throw error;
        }
    }

    /**
     * Calculate base price for room type
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
            const categoryMultiplier = this.getCategoryMultiplier(hotel.stars);

            // Calculate final base price
            const basePrice = basePrices[roomType] || 100;
            return Math.round(basePrice * categoryMultiplier * seasonMultiplier * 100) / 100;
        } catch (error) {
            logger.error('Error calculating base price:', error);
            return 100; // Fallback price
        }
    }

    /**
     * Calculate demand multiplier based on booking patterns
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
            logger.error('Error calculating demand multiplier:', error);
            return 1.0;
        }
    }

    /**
     * Update availability after a booking is made or cancelled
     * @param {String} hotelId - Hotel ID
     * @param {Object} bookingData - Booking data
     * @param {String} action - 'BOOK' or 'CANCEL'
     */
    async updateAvailabilityAfterBooking(hotelId, bookingData, action = 'BOOK') {
        try {
            const { checkInDate, checkOutDate, rooms } = bookingData;

            // Clear relevant cache entries
            this.clearCacheForDateRange(hotelId, checkInDate, checkOutDate);

            // Update demand metrics
            this.updateDemandMetrics(hotelId, rooms, action);

            // Get fresh availability data
            const newAvailability = await this.calculateAvailability(hotelId, checkInDate, checkOutDate);

            // Broadcast updates to all interested users
            await this.broadcastAvailabilityUpdate(hotelId, newAvailability, checkInDate, checkOutDate);

            // Notify users with active search sessions
            await this.notifyActiveSearchSessions(hotelId, newAvailability);

            logger.info(`Availability updated for hotel ${hotelId} after ${action}`);
            return newAvailability;
        } catch (error) {
            logger.error('Error updating availability after booking:', error);
            throw error;
        }
    }

    /**
     * Broadcast availability update to connected users
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
                timestamp: new Date()
            };

            // Broadcast to all connected users via Socket.io
            socketService.broadcastAvailabilityUpdate(hotelId, updateData);

            // Send to hotel-specific room
            socketService.sendHotelNotification(hotelId, 'availability-updated', updateData);

            logger.info(`Availability update broadcasted for hotel ${hotelId}`);
        } catch (error) {
            logger.error('Error broadcasting availability update:', error);
        }
    }

    /**
     * Track user search session for real-time updates
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
            timestamp: new Date()
        });

        // Auto-expire search sessions after 30 minutes
        setTimeout(() => {
            this.searchSessions.delete(userId);
        }, 30 * 60 * 1000);

        logger.info(`Search session tracked for user ${userId}`);
    }

    /**
     * Notify users with active search sessions about availability changes
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
                    message: 'Availability has been updated for your search'
                });
            }

            logger.info(`Notified ${affectedUsers.length} users about availability changes`);
        } catch (error) {
            logger.error('Error notifying active search sessions:', error);
        }
    }

    /**
     * Format availability response with currency conversion
     * @param {Object} availability - Raw availability data
     * @param {String} targetCurrency - Target currency
     * @returns {Object} Formatted availability response
     */
    async formatAvailabilityResponse(availability, targetCurrency = 'EUR') {
        try {
            if (targetCurrency === 'EUR') {
                return availability; // No conversion needed
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
                currency: targetCurrency
            };
        } catch (error) {
            logger.error('Error formatting availability response:', error);
            return availability; // Return original if conversion fails
        }
    }

    /**
     * Get real-time occupancy statistics
     * @param {String} hotelId - Hotel ID
     * @returns {Object} Occupancy statistics
     */
    async getRealTimeOccupancy(hotelId) {
        try {
            const today = new Date();
            const tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);

            const currentAvailability = await this.getRealTimeAvailability(hotelId, today, tomorrow);
            
            return {
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
                }))
            };
        } catch (error) {
            logger.error('Error getting real-time occupancy:', error);
            throw error;
        }
    }

    /**
     * Helper methods
     */
    clearCacheForDateRange(hotelId, startDate, endDate) {
        const keysToDelete = [];
        for (const key of this.availabilityCache.keys()) {
            if (key.startsWith(hotelId)) {
                keysToDelete.push(key);
            }
        }
        keysToDelete.forEach(key => this.availabilityCache.delete(key));
    }

    updateDemandMetrics(hotelId, rooms, action) {
        rooms.forEach(room => {
            const demandKey = `${hotelId}_${room.roomType}`;
            const current = this.demandCache.get(demandKey) || { bookings: 0, timestamp: Date.now() };
            
            if (action === 'BOOK') {
                current.bookings += room.quantity;
            } else if (action === 'CANCEL') {
                current.bookings = Math.max(0, current.bookings - room.quantity);
            }
            
            current.timestamp = Date.now();
            this.demandCache.set(demandKey, current);
        });
    }

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

    async refreshExpiredCache() {
        const now = Date.now();
        const expiredKeys = [];

        for (const [key, data] of this.availabilityCache.entries()) {
            if (now - data.timestamp > this.cacheExpiry) {
                expiredKeys.push(key);
            }
        }

        expiredKeys.forEach(key => this.availabilityCache.delete(key));
        
        if (expiredKeys.length > 0) {
            logger.info(`Cleared ${expiredKeys.length} expired cache entries`);
        }
    }

    async loadHotelAvailability(hotelId) {
        try {
            const today = new Date();
            const nextWeek = new Date(today);
            nextWeek.setDate(nextWeek.getDate() + 7);

            await this.getRealTimeAvailability(hotelId, today, nextWeek);
        } catch (error) {
            logger.error(`Error loading availability for hotel ${hotelId}:`, error);
        }
    }

    /**
     * Get service statistics
     */
    getServiceStats() {
        return {
            availabilityCacheSize: this.availabilityCache.size,
            priceCacheSize: this.priceCache.size,
            demandCacheSize: this.demandCache.size,
            activeSearchSessions: this.searchSessions.size,
            cacheHitRate: this.calculateCacheHitRate(),
            lastUpdated: new Date()
        };
    }

    calculateCacheHitRate() {
        // This would track actual cache hits/misses in a real implementation
        return 0.85; // Placeholder 85% hit rate
    }
}

// Export singleton instance
module.exports = new AvailabilityRealtimeService();