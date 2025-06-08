/**
 * Advanced Yield Manager Service - Week 3 with Dependencies Integration
 * Dynamic pricing algorithms and revenue optimization for hotel management
 * Implements real-time pricing based on demand, occupancy, and market conditions
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
    PRICING_ACTIONS
} = require('../utils/constants');

class YieldManager extends EventEmitter {
    constructor() {
        super();
        
        this.pricingStrategies = {
            CONSERVATIVE: { multiplier: 0.8, volatility: 0.1, riskTolerance: 'low' },
            MODERATE: { multiplier: 1.0, volatility: 0.2, riskTolerance: 'medium' },
            AGGRESSIVE: { multiplier: 1.2, volatility: 0.3, riskTolerance: 'high' }
        };

        // Use constants from utils/constants.js
        this.seasonalFactors = SEASONAL_MULTIPLIERS;
        this.occupancyThresholds = this.convertOccupancyThresholds();
        this.leadTimeFactors = ADVANCE_BOOKING_MULTIPLIERS;
        this.dayOfWeekFactors = DAY_OF_WEEK_MULTIPLIERS;
        this.demandFactors = DEMAND_PRICE_MULTIPLIERS;

        // Cache for performance
        this.priceCache = new Map();
        this.demandCache = new Map();
        this.cacheExpiry = parseInt(process.env.YIELD_CACHE_TTL || '300000'); // 5 minutes

        // Initialization flag
        this.initialized = false;

        // Statistics
        this.stats = {
            priceCalculations: 0,
            cacheHits: 0,
            cacheMisses: 0,
            lastCalculation: null,
            averageCalculationTime: 0
        };

        logger.info('Yield Manager constructed, waiting for initialization');
    }

    /**
     * Initialize the yield manager
     */
    async initialize() {
        if (this.initialized) {
            logger.warn('Yield Manager already initialized');
            return;
        }

        try {
            // Verify dependencies
            await this.verifyDependencies();

            // Load pricing rules from database
            await this.loadPricingRules();

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

            this.initialized = true;
            logger.info('Yield Manager initialized successfully');

        } catch (error) {
            logger.error('Failed to initialize Yield Manager:', error);
            throw error;
        }
    }

    /**
     * Verify all required dependencies are available
     */
    async verifyDependencies() {
        const dependencies = [
            { name: 'Booking Model', check: () => Booking !== undefined },
            { name: 'Hotel Model', check: () => Hotel !== undefined },
            { name: 'Room Model', check: () => Room !== undefined },
            { name: 'PricingRule Model', check: () => PricingRule !== undefined },
            { name: 'Currency Service', check: () => currencyService && typeof currencyService.getServiceStatus === 'function' },
            { name: 'Logger', check: () => logger && typeof logger.info === 'function' },
            { name: 'Constants', check: () => OCCUPANCY_THRESHOLDS && YIELD_LIMITS }
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

        logger.info('All Yield Manager dependencies verified successfully');
    }

    /**
     * Convert constants to internal format for backward compatibility
     */
    convertOccupancyThresholds() {
        return {
            VERY_LOW: { max: OCCUPANCY_THRESHOLDS.LOW, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.VERY_LOW] },
            LOW: { min: OCCUPANCY_THRESHOLDS.LOW, max: OCCUPANCY_THRESHOLDS.MEDIUM, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.LOW] },
            MODERATE: { min: OCCUPANCY_THRESHOLDS.MEDIUM, max: OCCUPANCY_THRESHOLDS.HIGH, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.MEDIUM] },
            HIGH: { min: OCCUPANCY_THRESHOLDS.HIGH, max: OCCUPANCY_THRESHOLDS.VERY_HIGH, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.HIGH] },
            VERY_HIGH: { min: OCCUPANCY_THRESHOLDS.VERY_HIGH, max: OCCUPANCY_THRESHOLDS.CRITICAL, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.VERY_HIGH] },
            CRITICAL: { min: OCCUPANCY_THRESHOLDS.CRITICAL, factor: OCCUPANCY_PRICE_MULTIPLIERS[OCCUPANCY_THRESHOLDS.CRITICAL] }
        };
    }

    /**
     * Load pricing rules from database
     */
    async loadPricingRules() {
        try {
            const rules = await PricingRule.find({ isActive: true });
            this.pricingRules = rules;
            logger.info(`Loaded ${rules.length} active pricing rules`);
        } catch (error) {
            logger.error('Error loading pricing rules:', error);
            this.pricingRules = [];
        }
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for booking events to trigger price updates
        this.on('booking:created', async (data) => {
            await this.triggerDemandAnalysis(data.hotelId);
        });

        this.on('booking:confirmed', async (data) => {
            await this.updatePricingForHotel(data.hotelId);
        });

        // Clear cache when pricing rules are updated
        this.on('pricing:rules_updated', () => {
            this.clearCache();
            this.loadPricingRules();
        });
    }

    /**
     * Calculate dynamic price for a room based on multiple factors
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
            strategy = 'MODERATE'
        } = params;

        try {
            this.stats.priceCalculations++;

            // Generate cache key
            const cacheKey = `price_${hotelId}_${roomType}_${checkInDate}_${checkOutDate}_${strategy}`;
            const cached = this.priceCache.get(cacheKey);

            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                this.stats.cacheHits++;
                return cached.data;
            }

            this.stats.cacheMisses++;

            // Get base price from hotel/room configuration
            const basePrice = await this.getBasePrice(hotelId, roomType);
            if (!basePrice) {
                throw new Error(`Base price not found for ${roomType} in hotel ${hotelId}`);
            }

            // Calculate all pricing factors
            const factors = await this.calculatePricingFactors({
                hotelId,
                roomType,
                checkInDate,
                checkOutDate,
                guestCount,
                strategy
            });

            // Apply pricing rules if any
            const rulesAdjustment = await this.applyPricingRules({
                hotelId,
                roomType,
                checkInDate,
                factors
            });

            // Apply all factors to base price
            const dynamicPrice = this.applyPricingFactors(basePrice, factors, rulesAdjustment);

            // Calculate price for entire stay
            const nights = moment(checkOutDate).diff(moment(checkInDate), 'days');
            const totalPrice = dynamicPrice * nights;

            // Convert currency if needed
            const convertedPrice = baseCurrency !== 'EUR' ? 
                await currencyService.convertCurrency(totalPrice, 'EUR', baseCurrency) : totalPrice;

            const result = {
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
                    currencyConversion: baseCurrency !== 'EUR' ? convertedPrice - totalPrice : 0
                },
                recommendations: this.generatePricingRecommendations(factors, strategy),
                confidence: this.calculateConfidenceScore(factors)
            };

            // Cache the result
            this.priceCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            // Update statistics
            const executionTime = Date.now() - startTime;
            this.stats.lastCalculation = new Date();
            this.stats.averageCalculationTime = 
                ((this.stats.averageCalculationTime * (this.stats.priceCalculations - 1)) + executionTime) / this.stats.priceCalculations;

            logger.info(`Dynamic price calculated for ${roomType}: ${basePrice} → ${dynamicPrice} (${factors.totalFactor.toFixed(2)}x) in ${executionTime}ms`);
            
            // Emit pricing event for monitoring
            this.emit('price:calculated', {
                hotelId,
                roomType,
                basePrice,
                dynamicPrice,
                factor: factors.totalFactor,
                executionTime
            });

            return result;

        } catch (error) {
            logger.error('Error calculating dynamic price:', error);
            
            // Emit error event
            this.emit('price:calculation_failed', {
                hotelId,
                roomType,
                error: error.message
            });
            
            throw error;
        }
    }

    /**
     * Apply pricing rules from database
     */
    async applyPricingRules(params) {
        const { hotelId, roomType, checkInDate, factors } = params;
        
        if (!this.pricingRules || this.pricingRules.length === 0) {
            return { factor: 1.0, rulesApplied: [], description: 'No pricing rules active' };
        }

        const applicableRules = this.pricingRules.filter(rule => {
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
                effect: ruleEffect.description
            });

            // Respect rule limits
            if (appliedRules.length >= 5) break; // Max 5 rules to prevent over-optimization
        }

        return {
            factor: totalFactor,
            rulesApplied: appliedRules,
            description: `${appliedRules.length} pricing rules applied`
        };
    }

    /**
     * Evaluate if rule conditions are met
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
            if (daysAhead < conditions.advanceBookingDays.min || daysAhead > conditions.advanceBookingDays.max) {
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
     * Calculate the effect of a pricing rule
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
                    factor *= (1 + action.value / 100);
                    description += `+${action.value}%, `;
                    break;
                case PRICING_ACTIONS.DECREASE:
                    factor *= (1 - action.value / 100);
                    description += `-${action.value}%, `;
                    break;
            }
        }

        return {
            factor,
            description: description.slice(0, -2) || 'Rule applied'
        };
    }

    /**
     * Calculate confidence score for the pricing calculation
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
     * Calculate all pricing factors that influence final price
     */
    async calculatePricingFactors(params) {
        const { hotelId, roomType, checkInDate, checkOutDate, strategy } = params;

        // 1. Occupancy-based factor
        const occupancyFactor = await this.calculateOccupancyFactor(hotelId, checkInDate, checkOutDate);

        // 2. Seasonal factor
        const seasonalFactor = this.calculateSeasonalFactor(checkInDate, checkOutDate, hotelId);

        // 3. Lead time factor
        const leadTimeFactor = this.calculateLeadTimeFactor(checkInDate);

        // 4. Day of week factor
        const dayOfWeekFactor = this.calculateDayOfWeekFactor(checkInDate, checkOutDate);

        // 5. Demand trend factor
        const demandFactor = await this.calculateDemandFactor(hotelId, roomType, checkInDate);

        // 6. Competition factor
        const competitionFactor = await this.calculateCompetitionFactor(hotelId, checkInDate);

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
            lengthOfStayFactor
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
            weights: this.getFactorWeights(strategy)
        };
    }

    /**
     * Calculate occupancy-based pricing factor
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
                if (threshold.max && avgOccupancy <= threshold.max && 
                    (!threshold.min || avgOccupancy >= threshold.min)) {
                    return {
                        factor: threshold.factor,
                        occupancy: avgOccupancy,
                        level,
                        description: `${avgOccupancy.toFixed(1)}% occupancy (${level.toLowerCase()})`
                    };
                } else if (!threshold.max && avgOccupancy >= threshold.min) {
                    return {
                        factor: threshold.factor,
                        occupancy: avgOccupancy,
                        level,
                        description: `${avgOccupancy.toFixed(1)}% occupancy (${level.toLowerCase()})`
                    };
                }
            }

            // Default moderate factor
            return {
                factor: 1.0,
                occupancy: avgOccupancy,
                level: 'MODERATE',
                description: `${avgOccupancy.toFixed(1)}% occupancy (moderate)`
            };

        } catch (error) {
            logger.error('Error calculating occupancy factor:', error);
            return { factor: 1.0, occupancy: 0, level: 'UNKNOWN', description: 'Occupancy data unavailable' };
        }
    }

    /**
     * Calculate seasonal pricing factor using constants
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
            period: `${startDate.format('MMM DD')} - ${endDate.format('MMM DD')}`
        };
    }

    /**
     * Calculate lead time factor using constants
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
            description: `${daysAhead} days lead time (${category.toLowerCase().replace('_', ' ')})`
        };
    }

    /**
     * Calculate day of week factor using constants
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
            description: `Average day-of-week factor: ${avgFactor.toFixed(2)}`
        };
    }

    /**
     * Calculate demand trend factor using demand analyzer
     */
    async calculateDemandFactor(hotelId, roomType, checkInDate) {
        try {
            if (demandAnalyzer && demandAnalyzer.analyzeDemandForDate) {
                const demandAnalysis = await demandAnalyzer.analyzeDemandForDate(hotelId, roomType, checkInDate);
                const demandLevel = demandAnalysis.level || 'NORMAL';
                const factor = this.demandFactors[demandLevel] || 1.0;

                return {
                    factor,
                    level: demandLevel,
                    confidence: demandAnalysis.confidence || 0.5,
                    description: `${demandLevel.toLowerCase()} demand predicted`
                };
            }

            // Fallback to simple historical analysis
            return await this.calculateSimpleDemandFactor(hotelId, roomType, checkInDate);

        } catch (error) {
            logger.error('Error calculating demand factor:', error);
            return { factor: 1.0, description: 'Demand data unavailable' };
        }
    }

    /**
     * Simple demand factor calculation as fallback
     */
    async calculateSimpleDemandFactor(hotelId, roomType, checkInDate) {
        try {
            const cacheKey = `demand_${hotelId}_${roomType}_${moment(checkInDate).format('YYYY-MM-DD')}`;
            const cached = this.demandCache.get(cacheKey);

            if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
                return cached.data;
            }

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
                        { $gte: moment(lastYear).subtract(7, 'days').toDate(), 
                          $lte: moment(lastYear).add(7, 'days').toDate() },
                        { $gte: moment(twoYearsAgo).subtract(7, 'days').toDate(), 
                          $lte: moment(twoYearsAgo).add(7, 'days').toDate() }
                    ]
                },
                status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
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

            const result = {
                factor,
                level: demandLevel,
                historicalBookings: bookingCount,
                description: `${bookingCount} historical bookings (${demandLevel.toLowerCase()} demand)`
            };

            // Cache the result
            this.demandCache.set(cacheKey, {
                data: result,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            logger.error('Error calculating simple demand factor:', error);
            return { factor: 1.0, description: 'Historical demand data unavailable' };
        }
    }

    /**
     * Calculate competition factor (enhanced for future API integration)
     */
    async calculateCompetitionFactor(hotelId, checkInDate) {
        // This would integrate with competitor pricing APIs in a real implementation
        // For now, we'll use market volatility based on hotel location and category
        
        try {
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return { factor: 1.0, description: 'Hotel not found for competition analysis' };
            }

            // Base competition factor on hotel category and location
            let baseCompetitionFactor = 1.0;
            
            // Adjust based on hotel star rating (higher category = more competition)
            if (hotel.starRating >= 4) {
                baseCompetitionFactor = 1.05; // 5% premium for luxury hotels
            } else if (hotel.starRating <= 2) {
                baseCompetitionFactor = 0.95; // 5% discount for budget hotels
            }

            // Add some market volatility
            const marketVolatility = Math.random() * 0.1 - 0.05; // ±5% randomness
            const factor = Math.max(0.8, Math.min(1.2, baseCompetitionFactor + marketVolatility));

            return {
                factor,
                baseCompetitionFactor,
                marketVolatility,
                hotelCategory: hotel.starRating,
                description: `${hotel.starRating}-star hotel market adjustment`,
                note: 'Enhanced competition analysis with external APIs planned'
            };

        } catch (error) {
            logger.error('Error calculating competition factor:', error);
            return { factor: 1.0, description: 'Competition data unavailable' };
        }
    }

    /**
     * Calculate length of stay factor (longer stays get discounts)
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
            description
        };
    }

    /**
     * Calculate weighted total factor from all individual factors
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
        const maxIncrease = 1 + (YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT / 100);
        const maxDecrease = 1 - (YIELD_LIMITS.MIN_PRICE_DECREASE_PERCENT / 100);
        
        return Math.max(maxDecrease, Math.min(maxIncrease, result));
    }

    /**
     * Apply calculated factors to base price with rules adjustment
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
            rulesAdjustment: rulesAdjustment.factor
        });

        return adjustedPrice;
    }

    /**
     * Generate pricing recommendations based on factors
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
                expectedImpact: 'Increase bookings by 15-25%'
            });
        }

        // High demand recommendations
        if (factors.occupancyFactor.factor > 1.2) {
            recommendations.push({
                type: 'REVENUE',
                message: 'High demand period - maximize revenue potential with premium pricing',
                action: 'INCREASE_PRICE',
                priority: 'HIGH',
                expectedImpact: 'Increase revenue by 10-20%'
            });
        }

        // Last-minute booking recommendations
        if (factors.leadTimeFactor.daysAhead < 3) {
            recommendations.push({
                type: 'URGENCY',
                message: 'Last-minute booking window - premium pricing justified by urgency',
                action: 'MAINTAIN_PREMIUM',
                priority: 'MEDIUM',
                expectedImpact: 'Capture urgent demand premium'
            });
        }

        // Extended stay recommendations
        if (factors.lengthOfStayFactor.nights >= 7) {
            recommendations.push({
                type: 'LOYALTY',
                message: 'Extended stay opportunity - consider value-added packages',
                action: 'ADD_VALUE',
                priority: 'LOW',
                expectedImpact: 'Improve guest satisfaction and loyalty'
            });
        }

        // Seasonal recommendations
        if (factors.seasonalFactor.season === 'LOW_SEASON') {
            recommendations.push({
                type: 'SEASONAL',
                message: 'Low season period - focus on local market and special packages',
                action: 'TARGETED_PROMOTION',
                priority: 'MEDIUM',
                expectedImpact: 'Maintain occupancy during slow period'
            });
        }

        return recommendations;
    }

    /**
     * Trigger demand analysis for a hotel
     */
    async triggerDemandAnalysis(hotelId) {
        try {
            if (demandAnalyzer && demandAnalyzer.triggerAnalysis) {
                await demandAnalyzer.triggerAnalysis(hotelId);
            }
            
            this.emit('demand:analysis_triggered', { hotelId, timestamp: new Date() });
            logger.info(`Demand analysis triggered for hotel ${hotelId}`);
            
        } catch (error) {
            logger.error('Error triggering demand analysis:', error);
        }
    }

    /**
     * Update pricing for all rooms in a hotel
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
                        strategy: pricing.strategy
                    };
                    
                    await room.save();
                    updatedRooms.push(room);
                    
                } catch (roomError) {
                    logger.error(`Error updating pricing for room ${room._id}:`, roomError);
                }
            }

            this.emit('pricing:hotel_updated', { 
                hotelId, 
                updatedRoomsCount: updatedRooms.length,
                timestamp: new Date() 
            });

            logger.info(`Updated pricing for ${updatedRooms.length} rooms in hotel ${hotelId}`);
            return updatedRooms;

        } catch (error) {
            logger.error('Error updating hotel pricing:', error);
            throw error;
        }
    }

    /**
     * Get dynamic pricing for a specific room type and date
     */
    async getDynamicPricing(hotelId, roomType, date) {
        const checkInDate = moment(date).format('YYYY-MM-DD');
        const checkOutDate = moment(date).add(1, 'day').format('YYYY-MM-DD');

        return await this.calculateDynamicPrice({
            hotelId,
            roomType,
            checkInDate,
            checkOutDate,
            strategy: 'MODERATE'
        });
    }

    /**
     * Get booking yield data for analytics
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
                originalPrice: booking.originalPrice || booking.totalAmount,
                finalPrice: booking.totalAmount,
                priceAdjustment: booking.totalAmount - (booking.originalPrice || booking.totalAmount),
                adjustmentPercentage: booking.originalPrice ? 
                    ((booking.totalAmount - booking.originalPrice) / booking.originalPrice * 100).toFixed(2) : 0,
                bookingDate: booking.createdAt,
                checkInDate: booking.checkInDate,
                leadTime: moment(booking.checkInDate).diff(moment(booking.createdAt), 'days'),
                roomTypes: booking.rooms.map(room => room.roomType),
                yieldStrategy: booking.yieldStrategy || 'MODERATE',
                revenue: booking.totalAmount,
                calculatedAt: new Date()
            };

            return yieldData;

        } catch (error) {
            logger.error('Error getting booking yield data:', error);
            throw error;
        }
    }

    /**
     * Get dashboard data for yield management
     */
    async getDashboardData() {
        try {
            const dashboardData = {
                timestamp: new Date(),
                statistics: this.getSystemStats(),
                recentPriceChanges: await this.getRecentPriceChanges(),
                occupancyTrends: await this.getOccupancyTrends(),
                revenueForecast: await this.getRevenueForecast(),
                recommendations: await this.getSystemRecommendations()
            };

            return dashboardData;

        } catch (error) {
            logger.error('Error getting dashboard data:', error);
            throw error;
        }
    }

    /**
     * Get recent price changes across all hotels
     */
    async getRecentPriceChanges(limit = 10) {
        try {
            // This would typically come from a price change log
            // For now, we'll return sample data structure
            return {
                changes: [],
                totalChanges: 0,
                averageChange: 0,
                lastUpdate: new Date()
            };
        } catch (error) {
            logger.error('Error getting recent price changes:', error);
            return { changes: [], totalChanges: 0, averageChange: 0 };
        }
    }

    /**
     * Get occupancy trends for analytics
     */
    async getOccupancyTrends() {
        try {
            if (revenueAnalytics && revenueAnalytics.getOccupancyTrends) {
                return await revenueAnalytics.getOccupancyTrends();
            }
            
            return { trends: [], averageOccupancy: 0, growth: 0 };
        } catch (error) {
            logger.error('Error getting occupancy trends:', error);
            return { trends: [], averageOccupancy: 0, growth: 0 };
        }
    }

    /**
     * Get revenue forecast
     */
    async getRevenueForecast() {
        try {
            if (revenueAnalytics && revenueAnalytics.getRevenueForecast) {
                return await revenueAnalytics.getRevenueForecast();
            }
            
            return { forecast: [], expectedRevenue: 0, confidence: 0 };
        } catch (error) {
            logger.error('Error getting revenue forecast:', error);
            return { forecast: [], expectedRevenue: 0, confidence: 0 };
        }
    }

    /**
     * Get system-wide recommendations
     */
    async getSystemRecommendations() {
        try {
            const recommendations = [];
            
            // Add cache-based recommendations
            if (this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) < 0.7) {
                recommendations.push({
                    type: 'PERFORMANCE',
                    message: 'Cache hit rate is low - consider increasing cache TTL',
                    priority: 'LOW'
                });
            }

            return recommendations;
        } catch (error) {
            logger.error('Error getting system recommendations:', error);
            return [];
        }
    }

    /**
     * Helper methods
     */
    async getBasePrice(hotelId, roomType) {
        try {
            const room = await Room.findOne({ hotel: hotelId, type: roomType });
            return room ? room.basePrice || room.pricePerNight : null;
        } catch (error) {
            logger.error('Error getting base price:', error);
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
                checkInDate: { $lte: endOfDay },
                checkOutDate: { $gt: startOfDay },
                status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
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
            logger.error('Error calculating occupancy rate:', error);
            return 0;
        }
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
            { start: [6, 1], end: [6, 31] },  // July (summer holiday)
            // Add more holiday periods as needed
        ];

        return holidayPeriods.some(period => {
            const holidayStart = moment().month(period.start[0]).date(period.start[1]);
            const holidayEnd = moment().month(period.end[0]).date(period.end[1]);
            
            return startDate.isBetween(holidayStart, holidayEnd, null, '[]') ||
                   endDate.isBetween(holidayStart, holidayEnd, null, '[]');
        });
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
            lengthOfStayFactor: 0.05
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

    /**
     * Clear pricing cache (useful for testing or forced updates)
     */
    clearCache() {
        this.priceCache.clear();
        this.demandCache.clear();
        logger.info('Yield manager cache cleared');
        this.emit('cache:cleared', { timestamp: new Date() });
    }

    /**
     * Get system statistics
     */
    getSystemStats() {
        return {
            ...this.stats,
            cacheStats: {
                priceCache: this.priceCache.size,
                demandCache: this.demandCache.size,
                hitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) || 0
            },
            initialized: this.initialized,
            pricingRulesCount: this.pricingRules ? this.pricingRules.length : 0
        };
    }

    /**
     * Get service status and health information
     */
    async getHealthStatus() {
        try {
            const health = {
                status: this.initialized ? 'healthy' : 'initializing',
                initialized: this.initialized,
                dependencies: {
                    database: 'connected',
                    currencyService: currencyService.getServiceStatus(),
                    demandAnalyzer: demandAnalyzer ? 'available' : 'unavailable',
                    revenueAnalytics: revenueAnalytics ? 'available' : 'unavailable'
                },
                statistics: this.getSystemStats(),
                lastActivity: this.stats.lastCalculation
            };

            return health;
        } catch (error) {
            return {
                status: 'error',
                error: error.message,
                initialized: this.initialized
            };
        }
    }

    /**
     * Get service status for external monitoring
     */
    getServiceStatus() {
        return {
            initialized: this.initialized,
            strategies: Object.keys(this.pricingStrategies),
            cacheSize: {
                prices: this.priceCache.size,
                demand: this.demandCache.size
            },
            factors: {
                seasonal: Object.keys(this.seasonalFactors),
                occupancy: Object.keys(this.occupancyThresholds),
                leadTime: Object.keys(this.leadTimeFactors)
            },
            statistics: this.stats,
            health: this.initialized ? 'operational' : 'starting'
        };
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Shutting down Yield Manager...');
        
        // Clear caches
        this.clearCache();
        
        // Remove all listeners
        this.removeAllListeners();
        
        this.initialized = false;
        
        logger.info('Yield Manager shutdown completed');
        this.emit('shutdown:completed');
    }
}

// Export singleton instance
module.exports = new YieldManager();