/**
 * Yield Management Controller
 * Handles dynamic pricing, revenue optimization, and yield analytics
 * Week 3 - Advanced Business Features
 */

const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const revenueAnalytics = require('../services/revenueAnalytics');
const currencyService = require('../services/currencyService');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const PricingRule = require('../models/PricingRule');
const { validationResult } = require('express-validator');
const { logger } = require('../utils/logger');
const socketService = require('../services/socketService');

class YieldController {
    /**
     * Get current yield status for a hotel
     * GET /api/yield/hotel/:hotelId/status
     */
    async getYieldStatus(req, res) {
        try {
            const { hotelId } = req.params;
            const { startDate, endDate } = req.query;

            // Validate dates
            const start = startDate ? new Date(startDate) : new Date();
            const end = endDate ? new Date(endDate) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

            // Get hotel and verify access
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Check permissions
            if (req.user.role === 'RECEPTIONIST' && req.user.hotelId?.toString() !== hotelId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this hotel'
                });
            }

            // Get current yield status
            const yieldStatus = await yieldManager.getHotelYieldStatus(hotelId, start, end);

            // Get demand analysis
            const demandData = await demandAnalyzer.analyzeDemand(hotelId, start, end);

            // Get revenue analytics
            const revenueData = await revenueAnalytics.getRevenueAnalytics(hotelId, start, end);

            res.json({
                success: true,
                data: {
                    hotel: {
                        id: hotel._id,
                        name: hotel.name,
                        yieldManagementEnabled: hotel.yieldManagementEnabled || false
                    },
                    period: {
                        startDate: start,
                        endDate: end
                    },
                    yieldStatus,
                    demandAnalysis: demandData,
                    revenueAnalytics: revenueData,
                    lastUpdated: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting yield status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield status',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get dynamic pricing for specific dates and room types
     * POST /api/yield/pricing/calculate
     */
    async calculateDynamicPricing(req, res) {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({
                    success: false,
                    message: 'Validation errors',
                    errors: errors.array()
                });
            }

            const {
                hotelId,
                roomType,
                checkInDate,
                checkOutDate,
                guestCount = 1,
                includeDemandFactors = true,
                currency = 'EUR'
            } = req.body;

            // Validate dates
            const checkIn = new Date(checkInDate);
            const checkOut = new Date(checkOutDate);

            if (checkIn >= checkOut) {
                return res.status(400).json({
                    success: false,
                    message: 'Check-out date must be after check-in date'
                });
            }

            // Calculate dynamic pricing
            const pricingResult = await yieldManager.calculateDynamicPrice({
                hotelId,
                roomType,
                checkInDate: checkIn,
                checkOutDate: checkOut,
                guestCount,
                includeDemandFactors
            });

            // Convert to requested currency if needed
            let convertedPricing = pricingResult;
            if (currency !== 'EUR') {
                convertedPricing = await this.convertPricingToCurrency(pricingResult, currency);
            }

            res.json({
                success: true,
                data: {
                    hotelId,
                    roomType,
                    period: {
                        checkInDate: checkIn,
                        checkOutDate: checkOut,
                        nights: Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24))
                    },
                    pricing: convertedPricing,
                    currency,
                    calculatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error calculating dynamic pricing:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to calculate dynamic pricing',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Update pricing rules for a hotel
     * PUT /api/yield/hotel/:hotelId/rules
     */
    async updatePricingRules(req, res) {
        try {
            const { hotelId } = req.params;
            const { rules, enableYieldManagement } = req.body;

            // Check admin permissions
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            // Validate hotel exists
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Update yield management settings
            if (enableYieldManagement !== undefined) {
                hotel.yieldManagementEnabled = enableYieldManagement;
                await hotel.save();
            }

            // Update or create pricing rules
            const updatedRules = [];
            for (const rule of rules) {
                const pricingRule = await PricingRule.findOneAndUpdate(
                    {
                        hotelId,
                        ruleType: rule.ruleType,
                        roomType: rule.roomType
                    },
                    {
                        ...rule,
                        hotelId,
                        updatedBy: req.user._id,
                        updatedAt: new Date()
                    },
                    {
                        upsert: true,
                        new: true
                    }
                );
                updatedRules.push(pricingRule);
            }

            // Trigger immediate price recalculation
            await yieldManager.recalculateHotelPrices(hotelId);

            // Notify real-time clients
            socketService.sendHotelNotification(hotelId, 'pricing-rules-updated', {
                rulesCount: updatedRules.length,
                yieldManagementEnabled: hotel.yieldManagementEnabled
            });

            res.json({
                success: true,
                message: 'Pricing rules updated successfully',
                data: {
                    hotel: {
                        id: hotel._id,
                        name: hotel.name,
                        yieldManagementEnabled: hotel.yieldManagementEnabled
                    },
                    rules: updatedRules,
                    updatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error updating pricing rules:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update pricing rules',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get demand forecast for a hotel
     * GET /api/yield/hotel/:hotelId/demand-forecast
     */
    async getDemandForecast(req, res) {
        try {
            const { hotelId } = req.params;
            const { days = 30, includeEvents = true } = req.query;

            // Validate hotel and access
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            if (req.user.role === 'RECEPTIONIST' && req.user.hotelId?.toString() !== hotelId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this hotel'
                });
            }

            // Generate demand forecast
            const forecast = await demandAnalyzer.generateDemandForecast(hotelId, {
                days: parseInt(days),
                includeEvents: includeEvents === 'true'
            });

            res.json({
                success: true,
                data: {
                    hotelId,
                    hotel: {
                        name: hotel.name,
                        location: `${hotel.city}, ${hotel.country || 'France'}`
                    },
                    forecast,
                    generatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting demand forecast:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get demand forecast',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Manual price adjustment
     * POST /api/yield/hotel/:hotelId/manual-adjustment
     */
    async manualPriceAdjustment(req, res) {
        try {
            const { hotelId } = req.params;
            const {
                roomType,
                adjustmentType, // 'PERCENTAGE' or 'FIXED'
                adjustmentValue,
                startDate,
                endDate,
                reason
            } = req.body;

            // Check admin permissions
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            // Validate dates
            const start = new Date(startDate);
            const end = new Date(endDate);

            if (start >= end) {
                return res.status(400).json({
                    success: false,
                    message: 'End date must be after start date'
                });
            }

            // Apply manual adjustment
            const adjustment = await yieldManager.applyManualAdjustment({
                hotelId,
                roomType,
                adjustmentType,
                adjustmentValue,
                startDate: start,
                endDate: end,
                reason,
                appliedBy: req.user._id
            });

            // Log the manual adjustment
            logger.info(`Manual price adjustment applied by ${req.user.email}`, {
                hotelId,
                roomType,
                adjustmentType,
                adjustmentValue,
                startDate: start,
                endDate: end,
                reason
            });

            // Notify real-time clients
            socketService.sendHotelNotification(hotelId, 'manual-price-adjustment', {
                roomType,
                adjustmentType,
                adjustmentValue,
                appliedBy: `${req.user.firstName} ${req.user.lastName}`
            });

            res.json({
                success: true,
                message: 'Manual price adjustment applied successfully',
                data: adjustment
            });

        } catch (error) {
            logger.error('Error applying manual price adjustment:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to apply manual price adjustment',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get revenue optimization recommendations
     * GET /api/yield/hotel/:hotelId/recommendations
     */
    async getRevenueRecommendations(req, res) {
        try {
            const { hotelId } = req.params;
            const { horizon = 14 } = req.query; // Days to look ahead

            // Validate hotel and access
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            if (req.user.role === 'RECEPTIONIST' && req.user.hotelId?.toString() !== hotelId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this hotel'
                });
            }

            // Generate recommendations
            const recommendations = await yieldManager.generateRevenueRecommendations(hotelId, {
                horizon: parseInt(horizon)
            });

            res.json({
                success: true,
                data: {
                    hotelId,
                    hotel: { name: hotel.name },
                    horizon: parseInt(horizon),
                    recommendations,
                    generatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting revenue recommendations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get revenue recommendations',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get yield performance analytics
     * GET /api/yield/hotel/:hotelId/performance
     */
    async getYieldPerformance(req, res) {
        try {
            const { hotelId } = req.params;
            const { startDate, endDate, granularity = 'daily' } = req.query;

            // Validate dates
            const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const end = endDate ? new Date(endDate) : new Date();

            // Validate hotel and access
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            if (req.user.role === 'RECEPTIONIST' && req.user.hotelId?.toString() !== hotelId) {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this hotel'
                });
            }

            // Get performance analytics
            const performance = await revenueAnalytics.getYieldPerformance(hotelId, {
                startDate: start,
                endDate: end,
                granularity
            });

            res.json({
                success: true,
                data: {
                    hotelId,
                    hotel: { name: hotel.name },
                    period: { startDate: start, endDate: end },
                    granularity,
                    performance,
                    generatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting yield performance:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield performance',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Get competitive pricing analysis
     * GET /api/yield/hotel/:hotelId/competitive-analysis
     */
    async getCompetitiveAnalysis(req, res) {
        try {
            const { hotelId } = req.params;
            const { checkInDate, checkOutDate, radius = 10 } = req.query;

            // Admin only feature
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            // Validate dates
            const checkIn = checkInDate ? new Date(checkInDate) : new Date(Date.now() + 24 * 60 * 60 * 1000);
            const checkOut = checkOutDate ? new Date(checkOutDate) : new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);

            // Get competitive analysis (placeholder implementation)
            const analysis = await this.performCompetitiveAnalysis(hotelId, {
                checkInDate: checkIn,
                checkOutDate: checkOut,
                radius: parseInt(radius)
            });

            res.json({
                success: true,
                data: analysis
            });

        } catch (error) {
            logger.error('Error getting competitive analysis:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get competitive analysis',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    /**
     * Trigger immediate yield recalculation
     * POST /api/yield/hotel/:hotelId/recalculate
     */
    async triggerRecalculation(req, res) {
        try {
            const { hotelId } = req.params;
            const { force = false } = req.body;

            // Admin only
            if (req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Admin access required'
                });
            }

            // Trigger recalculation
            const result = await yieldManager.recalculateHotelPrices(hotelId, { force });

            // Notify real-time clients
            socketService.sendHotelNotification(hotelId, 'yield-recalculation', {
                triggeredBy: `${req.user.firstName} ${req.user.lastName}`,
                roomsUpdated: result.roomsUpdated
            });

            res.json({
                success: true,
                message: 'Yield recalculation completed',
                data: result
            });

        } catch (error) {
            logger.error('Error triggering yield recalculation:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to trigger yield recalculation',
                error: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // ================================
    // HELPER METHODS
    // ================================

    /**
     * Convert pricing data to different currency
     */
    async convertPricingToCurrency(pricingData, targetCurrency) {
        try {
            const convertedPricing = { ...pricingData };
            
            // Convert base prices
            if (pricingData.basePrice) {
                const conversion = await currencyService.convertCurrency(
                    pricingData.basePrice,
                    'EUR',
                    targetCurrency
                );
                convertedPricing.basePrice = conversion.convertedAmount;
            }

            // Convert final prices
            if (pricingData.finalPrice) {
                const conversion = await currencyService.convertCurrency(
                    pricingData.finalPrice,
                    'EUR',
                    targetCurrency
                );
                convertedPricing.finalPrice = conversion.convertedAmount;
            }

            // Convert nightly breakdown
            if (pricingData.nightlyBreakdown) {
                convertedPricing.nightlyBreakdown = await Promise.all(
                    pricingData.nightlyBreakdown.map(async (night) => {
                        const conversion = await currencyService.convertCurrency(
                            night.price,
                            'EUR',
                            targetCurrency
                        );
                        return {
                            ...night,
                            price: conversion.convertedAmount
                        };
                    })
                );
            }

            convertedPricing.currency = targetCurrency;
            return convertedPricing;

        } catch (error) {
            logger.error('Error converting pricing to currency:', error);
            return pricingData; // Return original if conversion fails
        }
    }

    /**
     * Perform competitive pricing analysis (placeholder)
     */
    async performCompetitiveAnalysis(hotelId, options) {
        // This would integrate with external APIs like OTA APIs, web scraping, etc.
        // For now, return mock data
        return {
            hotelId,
            competitorsFound: 5,
            averageMarketPrice: 120.00,
            pricePosition: 'COMPETITIVE', // BELOW_MARKET, COMPETITIVE, ABOVE_MARKET
            recommendations: [
                {
                    type: 'PRICE_INCREASE',
                    reason: 'Prices 15% below market average',
                    suggestedAdjustment: 15,
                    potentialRevenue: 2500
                }
            ],
            lastUpdated: new Date()
        };
    }
}

module.exports = new YieldController();