/**
 * Admin Routes with Complete Yield Management Integration
 * Hotel Management System - Week 3 Advanced Features
 * Routes pour administration avec outils yield management complets
 */

const express = require('express');
const router = express.Router();

// Import controllers and services
const adminController = require('../controllers/adminController');
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const revenueAnalytics = require('../services/revenueAnalytics');
const schedulerService = require('../services/scheduler');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');

// Import middleware
const auth = require('../middleware/auth');
const validation = require('../middleware/validation');
const rateLimiter = require('../middleware/rateLimiter');

// Import models
const Hotel = require('../models/Hotel');
const Booking = require('../models/Booking');
const PricingRule = require('../models/PricingRule');

// Import constants
const { 
    YIELD_LIMITS,
    DEMAND_LEVELS,
    PRICING_RULE_TYPES,
    PRICING_ACTIONS,
    JOB_TYPES,
    PERFORMANCE_METRICS,
    ANALYSIS_PERIODS
} = require('../utils/constants');

const { logger } = require('../utils/logger');

// ================================
// ENHANCED DASHBOARD WITH YIELD MANAGEMENT
// ================================

/**
 * @swagger
 * /api/admin/dashboard:
 *   get:
 *     summary: Dashboard administrateur avec yield management
 *     tags: [Admin - Dashboard]
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: timeframe
 *         schema:
 *           type: string
 *           enum: [24h, 7d, 30d]
 *           default: 24h
 *       - in: query
 *         name: currency
 *         schema:
 *           type: string
 *           default: EUR
 *       - in: query
 *         name: includeYield
 *         schema:
 *           type: boolean
 *           default: true
 *     responses:
 *       200:
 *         description: Données dashboard avec métriques yield
 */
router.get('/dashboard', 
    auth.adminRequired,
    rateLimiter(100, 15 * 60 * 1000), // 100 requests per 15min
    adminController.getDashboardData
);

// ================================
// YIELD MANAGEMENT DASHBOARD ROUTES
// ================================

/**
 * Dashboard yield management complet
 * GET /api/admin/yield/dashboard
 */
router.get('/yield/dashboard',
    auth.adminRequired,
    async (req, res) => {
        try {
            if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
                return res.status(400).json({
                    success: false,
                    message: 'Yield management is not enabled'
                });
            }

            const { timeframe = '24h', currency = 'EUR' } = req.query;
            
            // Get comprehensive yield dashboard data
            const [
                yieldPerformance,
                revenueOptimization,
                demandAnalysis,
                pricingEffectiveness,
                systemHealth,
                activeOptimizations,
                recentAlerts
            ] = await Promise.all([
                adminController.getYieldPerformanceMetrics(
                    new Date(Date.now() - (timeframe === '24h' ? 24 * 60 * 60 * 1000 : 
                              timeframe === '7d' ? 7 * 24 * 60 * 60 * 1000 : 
                              30 * 24 * 60 * 60 * 1000)), 
                    currency
                ),
                adminController.getRevenueOptimizationData(new Date(Date.now() - 24 * 60 * 60 * 1000)),
                adminController.getCurrentDemandAnalysis(),
                adminController.getPricingEffectivenessData(new Date(Date.now() - 24 * 60 * 60 * 1000)),
                yieldManager.getHealthStatus(),
                yieldManager.getActiveOptimizations ? yieldManager.getActiveOptimizations() : [],
                adminController.getYieldManagementAlerts()
            ]);

            const dashboardData = {
                timeframe,
                currency,
                lastUpdated: new Date(),
                yieldPerformance,
                revenueOptimization,
                demandAnalysis,
                pricingEffectiveness,
                systemHealth,
                activeOptimizations,
                alerts: recentAlerts,
                quickActions: {
                    triggerDemandAnalysis: '/api/admin/yield/demand/trigger',
                    optimizePricing: '/api/admin/yield/optimize/pricing',
                    managePricingRules: '/api/admin/yield/pricing-rules',
                    controlJobs: '/api/admin/yield/jobs/control',
                    generateReport: '/api/admin/yield/reports/generate'
                }
            };

            res.json({
                success: true,
                data: dashboardData
            });

        } catch (error) {
            logger.error('Error getting yield dashboard:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield dashboard',
                error: error.message
            });
        }
    }
);

/**
 * Métriques de performance yield en temps réel
 * GET /api/admin/yield/performance
 */
router.get('/yield/performance',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { timeframe = '7d', hotelId, currency = 'EUR' } = req.query;
            
            const startDate = new Date(Date.now() - (
                timeframe === '24h' ? 24 * 60 * 60 * 1000 :
                timeframe === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                30 * 24 * 60 * 60 * 1000
            ));

            let performanceData;
            
            if (hotelId) {
                // Performance pour un hôtel spécifique
                performanceData = await getHotelYieldPerformance(hotelId, startDate, currency);
            } else {
                // Performance globale
                performanceData = await adminController.getYieldPerformanceMetrics(startDate, currency);
            }

            // Ajouter données temps réel
            performanceData.realTimeMetrics = {
                activeOptimizations: await yieldManager.getActiveOptimizations ? 
                    await yieldManager.getActiveOptimizations() : 0,
                systemLoad: process.cpuUsage(),
                memoryUsage: process.memoryUsage(),
                lastUpdate: new Date()
            };

            res.json({
                success: true,
                data: performanceData,
                metadata: {
                    timeframe,
                    hotelId: hotelId || 'ALL',
                    currency,
                    generatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting yield performance:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield performance metrics',
                error: error.message
            });
        }
    }
);

/**
 * Métriques en temps réel
 * GET /api/admin/yield/metrics
 */
router.get('/yield/metrics',
    auth.adminRequired,
    async (req, res) => {
        try {
            const metrics = {
                timestamp: new Date(),
                system: {
                    yieldManagerStatus: await yieldManager.getHealthStatus(),
                    schedulerStatus: schedulerService.getYieldManagementStatus(),
                    demandAnalyzerStatus: demandAnalyzer.getStatus ? demandAnalyzer.getStatus() : 'OPERATIONAL',
                    revenueAnalyticsStatus: revenueAnalytics.getServiceStats()
                },
                performance: {
                    totalOptimizations: await getTotalOptimizationsToday(),
                    activeRules: await PricingRule.countDocuments({ isActive: true }),
                    averageResponseTime: await getAverageOptimizationTime(),
                    systemEfficiency: await calculateSystemEfficiency()
                },
                alerts: await adminController.getYieldManagementAlerts(),
                trends: {
                    hourlyOptimizations: await getHourlyOptimizationTrend(),
                    demandSurges: await getDemandSurgeCount(),
                    revenueImpact: await getTodayRevenueImpact()
                }
            };

            res.json({
                success: true,
                data: metrics
            });

        } catch (error) {
            logger.error('Error getting yield metrics:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get real-time metrics',
                error: error.message
            });
        }
    }
);

/**
 * Mettre à jour les paramètres yield
 * POST /api/admin/yield/settings
 */
router.post('/yield/settings',
    auth.adminRequired,
    validation.validateYieldSettings,
    async (req, res) => {
        try {
            const { 
                maxPriceIncrease,
                minPriceDecrease,
                demandThresholds,
                automationLevel,
                notificationSettings 
            } = req.body;

            // Valider les limites
            if (maxPriceIncrease > YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT) {
                return res.status(400).json({
                    success: false,
                    message: `Maximum price increase cannot exceed ${YIELD_LIMITS.MAX_PRICE_INCREASE_PERCENT}%`
                });
            }

            // Mettre à jour les paramètres système
            const settings = {
                maxPriceIncrease,
                minPriceDecrease,
                demandThresholds,
                automationLevel,
                notificationSettings,
                updatedBy: req.user.userId,
                updatedAt: new Date()
            };

            // Sauvegarder les paramètres (dans Redis ou base de données)
            await saveYieldSettings(settings);

            // Notifier le système des changements
            yieldManager.emit('settings:updated', settings);

            // Broadcast aux autres admins
            socketService.sendAdminNotification('yield-settings-updated', {
                settings,
                updatedBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Yield management settings updated successfully',
                data: settings
            });

        } catch (error) {
            logger.error('Error updating yield settings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update yield settings',
                error: error.message
            });
        }
    }
);

// ================================
// PRICING MANAGEMENT ROUTES
// ================================

/**
 * Obtenir toutes les règles de pricing
 * GET /api/admin/yield/pricing-rules
 */
router.get('/yield/pricing-rules',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                page = 1, 
                limit = 20, 
                hotelId, 
                ruleType, 
                isActive,
                sortBy = 'priority',
                sortOrder = 'desc' 
            } = req.query;

            // Construire la requête
            const query = {};
            if (hotelId) query.hotelId = hotelId;
            if (ruleType) query.ruleType = ruleType;
            if (isActive !== undefined) query.isActive = isActive === 'true';

            const sort = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
            const skip = (page - 1) * limit;

            const [rules, totalCount] = await Promise.all([
                PricingRule.find(query)
                    .populate('hotelId', 'name city')
                    .populate('createdBy', 'firstName lastName')
                    .populate('lastModifiedBy', 'firstName lastName')
                    .sort(sort)
                    .skip(skip)
                    .limit(parseInt(limit)),
                PricingRule.countDocuments(query)
            ]);

            // Enrichir avec statistiques performance
            const enrichedRules = await Promise.all(
                rules.map(async (rule) => {
                    const performance = await calculateRulePerformance(rule._id);
                    return {
                        ...rule.toObject(),
                        performance,
                        isCurrentlyValid: rule.isCurrentlyValid,
                        daysUntilExpiration: rule.daysUntilExpiration,
                        effectivenessScore: rule.effectivenessScore
                    };
                })
            );

            res.json({
                success: true,
                data: {
                    rules: enrichedRules,
                    pagination: {
                        currentPage: parseInt(page),
                        totalPages: Math.ceil(totalCount / limit),
                        totalCount,
                        hasNextPage: page * limit < totalCount,
                        hasPrevPage: page > 1
                    },
                    summary: {
                        totalRules: totalCount,
                        activeRules: await PricingRule.countDocuments({ isActive: true }),
                        ruleTypes: await PricingRule.distinct('ruleType'),
                        averageEffectiveness: await calculateAverageRuleEffectiveness()
                    }
                }
            });

        } catch (error) {
            logger.error('Error getting pricing rules:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get pricing rules',
                error: error.message
            });
        }
    }
);

/**
 * Créer une nouvelle règle de pricing
 * POST /api/admin/yield/pricing-rules
 */
router.post('/yield/pricing-rules',
    auth.adminRequired,
    validation.validatePricingRule,
    async (req, res) => {
        try {
            const ruleData = {
                ...req.body,
                createdBy: req.user.userId,
                performance: {
                    applicationsCount: 0,
                    revenueImpact: 0,
                    successRate: 0,
                    averageRevenueLift: 0
                }
            };

            const rule = new PricingRule(ruleData);
            await rule.save();

            // Recharger les règles dans le yield manager
            yieldManager.emit('pricing:rules_updated');

            // Notifier les autres admins
            socketService.sendAdminNotification('pricing-rule-created', {
                rule: {
                    id: rule._id,
                    name: rule.name,
                    ruleType: rule.ruleType,
                    priority: rule.priority
                },
                createdBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.status(201).json({
                success: true,
                message: 'Pricing rule created successfully',
                data: rule
            });

        } catch (error) {
            logger.error('Error creating pricing rule:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to create pricing rule',
                error: error.message
            });
        }
    }
);

/**
 * Mettre à jour une règle de pricing
 * PUT /api/admin/yield/pricing-rules/:id
 */
router.put('/yield/pricing-rules/:id',
    auth.adminRequired,
    validation.validatePricingRule,
    async (req, res) => {
        try {
            const { id } = req.params;
            const updateData = {
                ...req.body,
                lastModifiedBy: req.user.userId,
                updatedAt: new Date()
            };

            const rule = await PricingRule.findByIdAndUpdate(
                id,
                updateData,
                { new: true, runValidators: true }
            );

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    message: 'Pricing rule not found'
                });
            }

            // Recharger les règles
            yieldManager.emit('pricing:rules_updated');

            // Notifier les changements
            socketService.sendAdminNotification('pricing-rule-updated', {
                rule: {
                    id: rule._id,
                    name: rule.name,
                    ruleType: rule.ruleType
                },
                updatedBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Pricing rule updated successfully',
                data: rule
            });

        } catch (error) {
            logger.error('Error updating pricing rule:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update pricing rule',
                error: error.message
            });
        }
    }
);

/**
 * Supprimer une règle de pricing
 * DELETE /api/admin/yield/pricing-rules/:id
 */
router.delete('/yield/pricing-rules/:id',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id } = req.params;

            const rule = await PricingRule.findByIdAndDelete(id);

            if (!rule) {
                return res.status(404).json({
                    success: false,
                    message: 'Pricing rule not found'
                });
            }

            // Recharger les règles
            yieldManager.emit('pricing:rules_updated');

            // Notifier la suppression
            socketService.sendAdminNotification('pricing-rule-deleted', {
                rule: {
                    id: rule._id,
                    name: rule.name,
                    ruleType: rule.ruleType
                },
                deletedBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Pricing rule deleted successfully'
            });

        } catch (error) {
            logger.error('Error deleting pricing rule:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to delete pricing rule',
                error: error.message
            });
        }
    }
);

// ================================
// REVENUE OPTIMIZATION ROUTES
// ================================

/**
 * Prévision de revenus
 * GET /api/admin/yield/revenue-forecast
 */
router.get('/yield/revenue-forecast',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                hotelId, 
                period = '30',
                currency = 'EUR',
                includeConfidence = true 
            } = req.query;

            const forecastDays = parseInt(period);
            
            if (forecastDays < 1 || forecastDays > 365) {
                return res.status(400).json({
                    success: false,
                    message: 'Forecast period must be between 1 and 365 days'
                });
            }

            let forecast;
            
            if (hotelId) {
                // Prévision pour un hôtel spécifique
                forecast = await revenueAnalytics.generateRevenueForecast(hotelId, forecastDays, currency);
            } else {
                // Prévision globale (tous les hôtels)
                const hotels = await Hotel.find({ isActive: true }).select('_id name');
                const hotelForecasts = await Promise.all(
                    hotels.map(hotel => 
                        revenueAnalytics.generateRevenueForecast(hotel._id, forecastDays, currency)
                    )
                );
                
                forecast = aggregateForecasts(hotelForecasts, hotels);
            }

            // Ajouter recommandations basées sur la prévision
            const recommendations = generateForecastRecommendations(forecast);

            res.json({
                success: true,
                data: {
                    forecast,
                    recommendations,
                    metadata: {
                        hotelId: hotelId || 'ALL',
                        period: forecastDays,
                        currency,
                        includeConfidence,
                        generatedAt: new Date()
                    }
                }
            });

        } catch (error) {
            logger.error('Error generating revenue forecast:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate revenue forecast',
                error: error.message
            });
        }
    }
);

/**
 * Optimisation de revenus
 * GET /api/admin/yield/optimization
 */
router.get('/yield/optimization',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelId, timeframe = '7d' } = req.query;
            
            const optimizationData = await adminController.getRevenueOptimizationData(
                new Date(Date.now() - (timeframe === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000))
            );

            // Ajouter des opportunités spécifiques par hôtel si demandé
            if (hotelId) {
                optimizationData.hotelSpecific = await getHotelOptimizationOpportunities(hotelId);
            }

            // Ajouter des recommandations d'actions immédiates
            optimizationData.immediateActions = await getImmediateOptimizationActions(hotelId);

            res.json({
                success: true,
                data: optimizationData
            });

        } catch (error) {
            logger.error('Error getting revenue optimization data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get optimization data',
                error: error.message
            });
        }
    }
);

/**
 * Déclencher l'optimisation pour un hôtel
 * POST /api/admin/yield/optimize/:hotelId
 */
router.post('/yield/optimize/:hotelId',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { 
                strategy = 'MODERATE',
                dateRange,
                forceUpdate = false,
                notifyStaff = true 
            } = req.body;

            // Valider l'hôtel
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Déclencher l'optimisation
            const optimization = await yieldManager.updatePricingForHotel(hotelId, {
                strategy,
                dateRange,
                triggeredBy: req.user.userId,
                forceUpdate,
                source: 'ADMIN_MANUAL'
            });

            // Notifier le personnel si demandé
            if (notifyStaff) {
                await notifyHotelStaff(hotelId, optimization, req.user);
            }

            // Broadcast en temps réel
            socketService.sendAdminNotification('hotel-optimization-completed', {
                hotelId,
                hotelName: hotel.name,
                optimization,
                strategy,
                triggeredBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: `Pricing optimization completed for ${hotel.name}`,
                data: {
                    hotelId,
                    hotelName: hotel.name,
                    optimization,
                    strategy,
                    triggeredBy: req.user.userId,
                    timestamp: new Date()
                }
            });

        } catch (error) {
            logger.error('Error triggering hotel optimization:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to trigger optimization',
                error: error.message
            });
        }
    }
);

/**
 * Obtenir les recommandations d'optimisation
 * GET /api/admin/yield/recommendations
 */
router.get('/yield/recommendations',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelId, priority, type, limit = 10 } = req.query;

            // Obtenir les recommandations basées sur l'analyse actuelle
            const recommendations = await generateYieldRecommendations({
                hotelId,
                priority,
                type,
                limit: parseInt(limit)
            });

            // Enrichir avec des données contextuelles
            const enrichedRecommendations = await Promise.all(
                recommendations.map(async (rec) => {
                    const context = await getRecommendationContext(rec);
                    return {
                        ...rec,
                        context,
                        estimatedImpact: await calculateRecommendationImpact(rec),
                        urgency: calculateRecommendationUrgency(rec),
                        implementationComplexity: assessImplementationComplexity(rec)
                    };
                })
            );

            res.json({
                success: true,
                data: {
                    recommendations: enrichedRecommendations,
                    summary: {
                        total: enrichedRecommendations.length,
                        byPriority: groupRecommendationsByPriority(enrichedRecommendations),
                        byType: groupRecommendationsByType(enrichedRecommendations),
                        avgImpact: calculateAverageImpact(enrichedRecommendations)
                    },
                    generatedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error getting yield recommendations:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get recommendations',
                error: error.message
            });
        }
    }
);

// ================================
// DEMAND ANALYSIS ROUTES
// ================================

/**
 * Analyse de la demande
 * GET /api/admin/yield/demand-analysis
 */
router.get('/yield/demand-analysis',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelId, period = '7d', detailed = false } = req.query;

            let demandAnalysis;

            if (hotelId) {
                // Analyse pour un hôtel spécifique
                demandAnalysis = await getDemandAnalysisForHotel(hotelId, period, detailed);
            } else {
                // Analyse globale
                demandAnalysis = await adminController.getCurrentDemandAnalysis();
            }

            // Ajouter prévisions de demande
            if (detailed === 'true') {
                demandAnalysis.forecasts = await getDemandForecasts(hotelId, 14);
                demandAnalysis.trends = await analyzeDemandTrends(hotelId, period);
                demandAnalysis.seasonalPatterns = await identifySeasonalDemandPatterns(hotelId);
            }

            res.json({
                success: true,
                data: demandAnalysis
            });

        } catch (error) {
            logger.error('Error getting demand analysis:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get demand analysis',
                error: error.message
            });
        }
    }
);

/**
 * Déclencher l'analyse de la demande
 * POST /api/admin/yield/demand/trigger
 */
router.post('/yield/demand/trigger',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelIds, priority = 'high', analysisType = 'FULL' } = req.body;

            const results = [];
            const hotels = hotelIds || await Hotel.find({ isActive: true }).distinct('_id');

            for (const hotelId of hotels) {
                try {
                    const analysis = await yieldManager.triggerDemandAnalysis(hotelId, {
                        priority,
                        analysisType,
                        triggeredBy: req.user.userId,
                        manual: true
                    });

                    results.push({
                        hotelId,
                        status: 'completed',
                        analysis
                    });

                } catch (hotelError) {
                    results.push({
                        hotelId,
                        status: 'failed',
                        error: hotelError.message
                    });
                }
            }

            // Broadcast results
            socketService.sendAdminNotification('demand-analysis-bulk-completed', {
                results,
                triggeredBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Demand analysis triggered for selected hotels',
                data: {
                    results,
                    summary: {
                        total: hotels.length,
                        successful: results.filter(r => r.status === 'completed').length,
                        failed: results.filter(r => r.status === 'failed').length
                    }
                }
            });

        } catch (error) {
            logger.error('Error triggering demand analysis:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to trigger demand analysis',
                error: error.message
            });
        }
    }
);

/**
 * Prévision de la demande
 * GET /api/admin/yield/demand/forecast
 */
router.get('/yield/demand/forecast',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { hotelId, days = 14, includeConfidence = true } = req.query;

            const forecast = await demandAnalyzer.getDemandForecast(hotelId, parseInt(days));

            // Enrichir avec des données complémentaires
            const enrichedForecast = {
                ...forecast,
                confidence: includeConfidence === 'true' ? await calculateForecastConfidence(forecast) : undefined,
                factors: await getFactorsInfluencingDemand(hotelId),
                recommendations: await generateDemandForecastRecommendations(forecast, hotelId)
            };

            res.json({
                success: true,
                data: enrichedForecast
            });

        } catch (error) {
            logger.error('Error getting demand forecast:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get demand forecast',
                error: error.message
            });
        }
    }
);

/**
 * Analyse des tendances du marché
 * GET /api/admin/yield/market-trends
 */
router.get('/yield/market-trends',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                region, 
                hotelCategory, 
                timeframe = '30d',
                competitors = true 
            } = req.query;

            const marketAnalysis = await analyzeMarketTrends({
                region,
                hotelCategory,
                timeframe,
                includeCompetitors: competitors === 'true'
            });

            // Ajouter insights et opportunités
            marketAnalysis.insights = await generateMarketInsights(marketAnalysis);
            marketAnalysis.opportunities = await identifyMarketOpportunities(marketAnalysis);

            res.json({
                success: true,
                data: marketAnalysis
            });

        } catch (error) {
            logger.error('Error analyzing market trends:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to analyze market trends',
                error: error.message
            });
        }
    }
);

// ================================
// BULK OPERATIONS ROUTES
// ================================

/**
 * Optimisation en masse
 * POST /api/admin/yield/bulk-optimize
 */
router.post('/yield/bulk-optimize',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                hotelIds,
                strategy = 'MODERATE',
                dateRange,
                criteria = {},
                dryRun = false 
            } = req.body;

            if (!hotelIds || hotelIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Hotel IDs are required for bulk optimization'
                });
            }

            const optimizationResults = [];
            let totalRevenueImpact = 0;

            for (const hotelId of hotelIds) {
                try {
                    // Vérifier les critères avant optimisation
                    const meetsCriteria = await checkOptimizationCriteria(hotelId, criteria);
                    
                    if (!meetsCriteria.eligible) {
                        optimizationResults.push({
                            hotelId,
                            status: 'skipped',
                            reason: meetsCriteria.reason
                        });
                        continue;
                    }

                    let result;
                    if (dryRun) {
                        // Simulation sans application
                        result = await simulateOptimization(hotelId, strategy, dateRange);
                        result.simulated = true;
                    } else {
                        // Optimisation réelle
                        result = await yieldManager.updatePricingForHotel(hotelId, {
                            strategy,
                            dateRange,
                            triggeredBy: req.user.userId,
                            source: 'BULK_ADMIN'
                        });
                    }

                    optimizationResults.push({
                        hotelId,
                        status: 'completed',
                        result,
                        revenueImpact: result.revenueImpact || 0
                    });

                    totalRevenueImpact += result.revenueImpact || 0;

                } catch (hotelError) {
                    optimizationResults.push({
                        hotelId,
                        status: 'failed',
                        error: hotelError.message
                    });
                }
            }

            // Statistiques finales
            const summary = {
                total: hotelIds.length,
                completed: optimizationResults.filter(r => r.status === 'completed').length,
                skipped: optimizationResults.filter(r => r.status === 'skipped').length,
                failed: optimizationResults.filter(r => r.status === 'failed').length,
                totalRevenueImpact: Math.round(totalRevenueImpact * 100) / 100,
                averageImpact: optimizationResults.length > 0 ? 
                    totalRevenueImpact / optimizationResults.filter(r => r.status === 'completed').length : 0
            };

            // Broadcast notification
            socketService.sendAdminNotification('bulk-optimization-completed', {
                summary,
                dryRun,
                strategy,
                triggeredBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: `Bulk optimization ${dryRun ? 'simulation' : 'execution'} completed`,
                data: {
                    results: optimizationResults,
                    summary,
                    dryRun,
                    strategy,
                    executedAt: new Date()
                }
            });

        } catch (error) {
            logger.error('Error in bulk optimization:', error);
            res.status(500).json({
                success: false,
                message: 'Bulk optimization failed',
                error: error.message
            });
        }
    }
);

/**
 * Mise à jour des prix en masse
 * POST /api/admin/yield/bulk-pricing
 */
router.post('/yield/bulk-pricing',
    auth.adminRequired,
    async (req, res) => {
        try {
            const {
                updates, // Array of { hotelId, roomType, priceAdjustment, dateRange }
                reason,
                notifyStaff = false,
                validateLimits = true
            } = req.body;

            const results = [];
            
            for (const update of updates) {
                try {
                    const { hotelId, roomType, priceAdjustment, dateRange } = update;

                    // Validation des limites si demandée
                    if (validateLimits) {
                        const limitCheck = validatePriceAdjustmentLimits(priceAdjustment);
                        if (!limitCheck.valid) {
                            results.push({
                                ...update,
                                status: 'rejected',
                                reason: limitCheck.reason
                            });
                            continue;
                        }
                    }

                    // Appliquer la mise à jour
                    const result = await applyBulkPriceUpdate(hotelId, roomType, priceAdjustment, dateRange, {
                        reason,
                        updatedBy: req.user.userId,
                        source: 'BULK_ADMIN'
                    });

                    results.push({
                        ...update,
                        status: 'completed',
                        result
                    });

                    // Notifier le personnel si demandé
                    if (notifyStaff) {
                        await notifyHotelStaffPriceChange(hotelId, result, req.user);
                    }

                } catch (updateError) {
                    results.push({
                        ...update,
                        status: 'failed',
                        error: updateError.message
                    });
                }
            }

            res.json({
                success: true,
                message: 'Bulk pricing update completed',
                data: {
                    results,
                    summary: {
                        total: updates.length,
                        successful: results.filter(r => r.status === 'completed').length,
                        rejected: results.filter(r => r.status === 'rejected').length,
                        failed: results.filter(r => r.status === 'failed').length
                    }
                }
            });

        } catch (error) {
            logger.error('Error in bulk pricing update:', error);
            res.status(500).json({
                success: false,
                message: 'Bulk pricing update failed',
                error: error.message
            });
        }
    }
);

/**
 * Gestion des règles en masse
 * POST /api/admin/yield/bulk-rules
 */
router.post('/yield/bulk-rules',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                action, // 'activate', 'deactivate', 'delete', 'duplicate'
                ruleIds,
                targetHotels, // Pour duplication
                modifications = {} // Pour modifications en masse
            } = req.body;

            const results = await adminController.managePricingRules({
                body: { action, ruleIds, ruleData: modifications, targetHotels },
                user: req.user
            });

            res.json({
                success: true,
                message: `Bulk rules ${action} completed`,
                data: results
            });

        } catch (error) {
            logger.error('Error in bulk rules management:', error);
            res.status(500).json({
                success: false,
                message: 'Bulk rules operation failed',
                error: error.message
            });
        }
    }
);

/**
 * Statut des opérations en masse
 * GET /api/admin/yield/bulk-status
 */
router.get('/yield/bulk-status',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { operationId, type } = req.query;

            // Récupérer le statut des opérations en cours
            const status = await getBulkOperationStatus(operationId, type);

            res.json({
                success: true,
                data: status
            });

        } catch (error) {
            logger.error('Error getting bulk operation status:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get bulk operation status',
                error: error.message
            });
        }
    }
);

// ================================
// HOTEL-LEVEL YIELD MANAGEMENT ROUTES
// ================================

/**
 * Paramètres yield d'un hôtel
 * GET /api/admin/hotels/:id/yield
 */
router.get('/hotels/:id/yield',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id: hotelId } = req.params;

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Obtenir les paramètres yield de l'hôtel
            const yieldSettings = await getHotelYieldSettings(hotelId);
            const activeRules = await PricingRule.find({ hotelId, isActive: true });
            const performance = await getHotelYieldPerformance(hotelId);
            const currentDemand = await demandAnalyzer.getCurrentDemandLevel(hotelId);

            res.json({
                success: true,
                data: {
                    hotel: {
                        id: hotel._id,
                        name: hotel.name,
                        city: hotel.city,
                        category: hotel.starRating
                    },
                    yieldSettings,
                    activeRules: activeRules.length,
                    performance,
                    currentDemand,
                    lastOptimization: await getLastOptimizationTime(hotelId)
                }
            });

        } catch (error) {
            logger.error('Error getting hotel yield settings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get hotel yield settings',
                error: error.message
            });
        }
    }
);

/**
 * Mettre à jour les paramètres yield d'un hôtel
 * PUT /api/admin/hotels/:id/yield
 */
router.put('/hotels/:id/yield',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id: hotelId } = req.params;
            const yieldSettings = req.body;

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Mettre à jour les paramètres yield
            const updatedSettings = await updateHotelYieldSettings(hotelId, {
                ...yieldSettings,
                updatedBy: req.user.userId,
                updatedAt: new Date()
            });

            // Notifier les changements
            socketService.sendAdminNotification('hotel-yield-settings-updated', {
                hotelId,
                hotelName: hotel.name,
                settings: updatedSettings,
                updatedBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Hotel yield settings updated successfully',
                data: updatedSettings
            });

        } catch (error) {
            logger.error('Error updating hotel yield settings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update hotel yield settings',
                error: error.message
            });
        }
    }
);

/**
 * Statistiques yield d'un hôtel
 * GET /api/admin/hotels/:id/yield/stats
 */
router.get('/hotels/:id/yield/stats',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id: hotelId } = req.params;
            const { period = '30d', currency = 'EUR' } = req.query;

            const startDate = new Date(Date.now() - (
                period === '7d' ? 7 * 24 * 60 * 60 * 1000 :
                period === '30d' ? 30 * 24 * 60 * 60 * 1000 :
                90 * 24 * 60 * 60 * 1000
            ));

            const stats = await getHotelYieldStats(hotelId, startDate, currency);

            res.json({
                success: true,
                data: stats
            });

        } catch (error) {
            logger.error('Error getting hotel yield stats:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get hotel yield statistics',
                error: error.message
            });
        }
    }
);

/**
 * Réinitialiser les paramètres yield d'un hôtel
 * POST /api/admin/hotels/:id/yield/reset
 */
router.post('/hotels/:id/yield/reset',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id: hotelId } = req.params;
            const { confirmReset = false, backupSettings = true } = req.body;

            if (!confirmReset) {
                return res.status(400).json({
                    success: false,
                    message: 'Reset confirmation required',
                    hint: 'Set confirmReset to true to proceed'
                });
            }

            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({
                    success: false,
                    message: 'Hotel not found'
                });
            }

            // Sauvegarder les paramètres actuels si demandé
            if (backupSettings) {
                await backupHotelYieldSettings(hotelId, req.user.userId);
            }

            // Réinitialiser aux paramètres par défaut
            const defaultSettings = await resetHotelYieldSettings(hotelId, req.user.userId);

            // Désactiver toutes les règles spécifiques à cet hôtel
            await PricingRule.updateMany(
                { hotelId },
                { 
                    isActive: false,
                    lastModifiedBy: req.user.userId,
                    updatedAt: new Date()
                }
            );

            // Notifier la réinitialisation
            socketService.sendAdminNotification('hotel-yield-reset', {
                hotelId,
                hotelName: hotel.name,
                backupCreated: backupSettings,
                resetBy: req.user.firstName + ' ' + req.user.lastName,
                timestamp: new Date()
            });

            res.json({
                success: true,
                message: 'Hotel yield settings reset to defaults',
                data: {
                    defaultSettings,
                    backupCreated: backupSettings,
                    rulesDeactivated: true
                }
            });

        } catch (error) {
            logger.error('Error resetting hotel yield settings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to reset hotel yield settings',
                error: error.message
            });
        }
    }
);

// ================================
// REPORTS & ANALYTICS ROUTES
// ================================

/**
 * Rapports yield
 * GET /api/admin/yield/reports
 */
router.get('/yield/reports',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                type = 'performance',
                period = '30d',
                hotelId,
                format = 'json' 
            } = req.query;

            let report;

            switch (type) {
                case 'performance':
                    report = await generateYieldPerformanceReport(hotelId, period);
                    break;
                case 'revenue-impact':
                    report = await generateRevenueImpactReport(hotelId, period);
                    break;
                case 'pricing-effectiveness':
                    report = await generatePricingEffectivenessReport(hotelId, period);
                    break;
                case 'demand-analysis':
                    report = await generateDemandAnalysisReport(hotelId, period);
                    break;
                case 'comparative':
                    report = await generateComparativeReport(hotelId, period);
                    break;
                default:
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid report type',
                        availableTypes: ['performance', 'revenue-impact', 'pricing-effectiveness', 'demand-analysis', 'comparative']
                    });
            }

            if (format === 'pdf') {
                // Générer PDF (implementation future)
                return res.status(501).json({
                    success: false,
                    message: 'PDF format not yet implemented'
                });
            }

            res.json({
                success: true,
                data: report
            });

        } catch (error) {
            logger.error('Error generating yield report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate report',
                error: error.message
            });
        }
    }
);

/**
 * Générer un rapport personnalisé
 * POST /api/admin/yield/reports/generate
 */
router.post('/yield/reports/generate',
    auth.adminRequired,
    async (req, res) => {
        try {
            const {
                reportConfig,
                deliveryMethod = 'immediate', // 'immediate', 'email', 'scheduled'
                recipients = []
            } = req.body;

            // Valider la configuration du rapport
            const validationResult = validateReportConfig(reportConfig);
            if (!validationResult.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid report configuration',
                    errors: validationResult.errors
                });
            }

            if (deliveryMethod === 'immediate') {
                // Générer et retourner immédiatement
                const report = await generateCustomYieldReport(reportConfig, req.user.userId);
                
                res.json({
                    success: true,
                    message: 'Custom report generated successfully',
                    data: report
                });

            } else if (deliveryMethod === 'email') {
                // Générer en arrière-plan et envoyer par email
                const jobId = await scheduleReportGeneration(reportConfig, recipients, req.user.userId);
                
                res.json({
                    success: true,
                    message: 'Report generation scheduled',
                    data: {
                        jobId,
                        estimatedCompletionTime: calculateEstimatedCompletionTime(reportConfig),
                        recipients
                    }
                });

            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid delivery method'
                });
            }

        } catch (error) {
            logger.error('Error generating custom report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to generate custom report',
                error: error.message
            });
        }
    }
);

/**
 * Obtenir un rapport spécifique
 * GET /api/admin/yield/reports/:id
 */
router.get('/yield/reports/:id',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { id: reportId } = req.params;

            const report = await getGeneratedReport(reportId);

            if (!report) {
                return res.status(404).json({
                    success: false,
                    message: 'Report not found'
                });
            }

            // Vérifier les permissions d'accès
            if (report.createdBy !== req.user.userId && req.user.role !== 'ADMIN') {
                return res.status(403).json({
                    success: false,
                    message: 'Access denied to this report'
                });
            }

            res.json({
                success: true,
                data: report
            });

        } catch (error) {
            logger.error('Error getting report:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get report',
                error: error.message
            });
        }
    }
);

/**
 * Exporter les données yield
 * GET /api/admin/yield/export
 */
router.get('/yield/export',
    auth.adminRequired,
    async (req, res) => {
        try {
            const {
                format = 'csv', // 'csv', 'excel', 'json'
                dataType = 'performance', // 'performance', 'pricing', 'demand', 'all'
                period = '30d',
                hotelId
            } = req.query;

            const exportData = await prepareYieldExportData(dataType, period, hotelId);

            // Générer le fichier selon le format demandé
            let result;
            switch (format) {
                case 'csv':
                    result = await generateCSVExport(exportData);
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename="yield-data-${Date.now()}.csv"`);
                    res.send(result);
                    break;

                case 'excel':
                    result = await generateExcelExport(exportData);
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.setHeader('Content-Disposition', `attachment; filename="yield-data-${Date.now()}.xlsx"`);
                    res.send(result);
                    break;

                case 'json':
                default:
                    res.json({
                        success: true,
                        data: exportData,
                        metadata: {
                            exportedAt: new Date(),
                            format,
                            dataType,
                            period,
                            hotelId: hotelId || 'ALL'
                        }
                    });
                    break;
            }

        } catch (error) {
            logger.error('Error exporting yield data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to export yield data',
                error: error.message
            });
        }
    }
);

// ================================
// MONITORING & ALERTS ROUTES
// ================================

/**
 * Alertes actives
 * GET /api/admin/yield/alerts
 */
router.get('/yield/alerts',
    auth.adminRequired,
    async (req, res) => {
        try {
            const { 
                severity, 
                type, 
                hotelId,
                limit = 50,
                acknowledged = false 
            } = req.query;

            const alerts = await getYieldAlerts({
                severity,
                type,
                hotelId,
                limit: parseInt(limit),
                acknowledged: acknowledged === 'true'
            });

            // Enrichir avec des actions recommandées
            const enrichedAlerts = alerts.map(alert => ({
                ...alert,
                recommendedActions: getRecommendedActionsForAlert(alert),
                estimatedImpact: estimateAlertImpact(alert),
                urgency: calculateAlertUrgency(alert)
            }));

            res.json({
                success: true,
                data: {
                    alerts: enrichedAlerts,
                    summary: {
                        total: enrichedAlerts.length,
                        bySeverity: groupAlertsBySeverity(enrichedAlerts),
                        byType: groupAlertsByType(enrichedAlerts),
                        unacknowledged: enrichedAlerts.filter(a => !a.acknowledged).length
                    }
                }
            });

        } catch (error) {
            logger.error('Error getting yield alerts:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get yield alerts',
                error: error.message
            });
        }
    }
);

/**
 * Paramètres d'alertes
 * POST /api/admin/yield/alerts/settings
 */
router.post('/yield/alerts/settings',
    auth.adminRequired,
    async (req, res) => {
        try {
            const alertSettings = req.body;

            // Valider les paramètres
            const validation = validateAlertSettings(alertSettings);
            if (!validation.valid) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid alert settings',
                    errors: validation.errors
                });
            }

            // Sauvegarder les paramètres
            const savedSettings = await updateYieldAlertSettings({
                ...alertSettings,
                updatedBy: req.user.userId,
                updatedAt: new Date()
            });

            res.json({
                success: true,
                message: 'Alert settings updated successfully',
                data: savedSettings
            });

        } catch (error) {
            logger.error('Error updating alert settings:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to update alert settings',
                error: error.message
            });
        }
    }
);

/**
 * Surveillance en temps réel
 * GET /api/admin/yield/monitoring
 */
router.get('/yield/monitoring',
    auth.adminRequired,
    async (req, res) => {
        try {
            const monitoringData = {
                timestamp: new Date(),
                systemHealth: await yieldManager.getHealthStatus(),
                activeJobs: schedulerService.getActiveJobs(),
                performanceMetrics: await getRealtimePerformanceMetrics(),
                resourceUsage: {
                    cpu: process.cpuUsage(),
                    memory: process.memoryUsage(),
                    connections: socketService.getConnectionStats()
                },
                alerts: await getActiveAlerts(),
                trends: await getRealtimeTrends()
            };

            res.json({
                success: true,
                data: monitoringData
            });

        } catch (error) {
            logger.error('Error getting monitoring data:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to get monitoring data',
                error: error.message
            });
        }
    }
);

/**
 * Envoyer des notifications yield
 * POST /api/admin/yield/notifications
 */
router.post('/yield/notifications',
    auth.adminRequired,
    async (req, res) => {
        try {
            const {
                type,
                message,
                recipients, // 'all', 'admins', 'hotel_staff', or specific user IDs
                priority = 'medium',
                hotelId,
                scheduledFor
            } = req.body;

            let notification;

            if (scheduledFor) {
                // Notification programmée
                notification = await scheduleYieldNotification({
                    type,
                    message,
                    recipients,
                    priority,
                    hotelId,
                    scheduledFor: new Date(scheduledFor),
                    createdBy: req.user.userId
                });
            } else {
                // Notification immédiate
                notification = await sendYieldNotification({
                    type,
                    message,
                    recipients,
                    priority,
                    hotelId,
                    sentBy: req.user.userId
                });
            }

            res.json({
                success: true,
                message: scheduledFor ? 'Notification scheduled successfully' : 'Notification sent successfully',
                data: notification
            });

        } catch (error) {
            logger.error('Error sending yield notification:', error);
            res.status(500).json({
                success: false,
                message: 'Failed to send notification',
                error: error.message
            });
        }
    }
);

// ================================
// JOB MANAGEMENT ROUTES
// ================================

/**
 * Statut des jobs yield
 * GET /api/admin/yield/jobs/status
 */
router.get('/yield/jobs/status',
    auth.adminRequired,
    adminController.getYieldJobsStatus
);

/**
 * Contrôler les jobs yield
 * POST /api/admin/yield/jobs/control
 */
router.post('/yield/jobs/control',
    auth.adminRequired,
    adminController.controlYieldJobs
);

// ================================
// ENHANCED BOOKING VALIDATION WITH YIELD
// ================================

/**
 * Validation de réservation avec optimisation yield
 * POST /api/admin/bookings/:id/validate
 */
router.post('/bookings/:id/validate',
    auth.adminRequired,
    validation.validateBookingValidation,
    adminController.validateBooking
);

/**
 * Validation en masse avec yield
 * POST /api/admin/bookings/bulk-validate
 */
router.post('/bookings/bulk-validate',
    auth.adminRequired,
    adminController.bulkValidateBookings
);

// ================================
// UTILITY AND HELPER FUNCTIONS
// ================================

/**
 * Helper functions pour les calculs et analyses
 */

async function getHotelYieldPerformance(hotelId, startDate, currency) {
    // Implementation of hotel-specific yield performance calculation
    return await adminController.getYieldPerformanceMetrics(startDate, currency);
}

async function getTotalOptimizationsToday() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    return await Booking.countDocuments({
        'yieldManagement.lastOptimization.optimizedAt': { $gte: today },
        'yieldManagement.enabled': true
    });
}

async function getAverageOptimizationTime() {
    // Calculate average response time for yield optimizations
    const stats = yieldManager.getSystemStats();
    return stats.averageCalculationTime || 0;
}

async function calculateSystemEfficiency() {
    // Calculate overall system efficiency based on various metrics
    const totalOptimizations = await getTotalOptimizationsToday();
    const successfulOptimizations = totalOptimizations; // Simplified for now
    const systemUptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    
    // Basic efficiency calculation
    const efficiency = totalOptimizations > 0 ? 
        (successfulOptimizations / totalOptimizations) * 100 : 100;
    
    return Math.min(100, efficiency);
}

async function getHourlyOptimizationTrend() {
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const hourlyData = await Booking.aggregate([
        {
            $match: {
                'yieldManagement.lastOptimization.optimizedAt': { $gte: last24Hours },
                'yieldManagement.enabled': true
            }
        },
        {
            $group: {
                _id: {
                    hour: { $hour: '$yieldManagement.lastOptimization.optimizedAt' }
                },
                count: { $sum: 1 }
            }
        },
        {
            $sort: { '_id.hour': 1 }
        }
    ]);

    return hourlyData;
}

async function getDemandSurgeCount() {
    // Count demand surges in the last 24 hours
    const alerts = await adminController.getYieldManagementAlerts();
    return alerts.filter(alert => 
        alert.category === 'demand_surge' && 
        new Date(alert.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
    ).length;
}

async function getTodayRevenueImpact() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const yieldBookings = await Booking.find({
        createdAt: { $gte: today },
        'yieldManagement.enabled': true,
        'yieldManagement.priceAdjustment': { $exists: true }
    });

    return yieldBookings.reduce((total, booking) => {
        return total + (booking.yieldManagement.priceAdjustment || 0);
    }, 0);
}

async function saveYieldSettings(settings) {
    // Save yield settings to database or Redis
    // Implementation depends on storage choice
    return settings;
}

async function calculateRulePerformance(ruleId) {
    const rule = await PricingRule.findById(ruleId);
    if (!rule || !rule.performance) {
        return {
            applicationsCount: 0,
            revenueImpact: 0,
            successRate: 0,
            averageRevenueLift: 0
        };
    }
    
    return rule.performance;
}

async function calculateAverageRuleEffectiveness() {
    const rules = await PricingRule.find({ isActive: true });
    if (rules.length === 0) return 0;
    
    const totalEffectiveness = rules.reduce((sum, rule) => {
        return sum + (rule.effectivenessScore || 0);
    }, 0);
    
    return totalEffectiveness / rules.length;
}

function aggregateForecasts(hotelForecasts, hotels) {
    // Aggregate multiple hotel forecasts into a global forecast
    const aggregated = {
        model: 'AGGREGATED',
        totalHotels: hotels.length,
        forecast: []
    };

    // Simple aggregation - sum all forecasts by day
    const maxDays = Math.max(...hotelForecasts.map(f => f.forecast?.length || 0));
    
    for (let day = 0; day < maxDays; day++) {
        let totalRevenue = 0;
        let contributingHotels = 0;
        
        hotelForecasts.forEach(forecast => {
            if (forecast.forecast && forecast.forecast[day]) {
                totalRevenue += forecast.forecast[day].predictedRevenue || 0;
                contributingHotels++;
            }
        });
        
        aggregated.forecast.push({
            date: moment().add(day, 'days').format('YYYY-MM-DD'),
            predictedRevenue: totalRevenue,
            contributingHotels
        });
    }
    
    return aggregated;
}

function generateForecastRecommendations(forecast) {
    const recommendations = [];
    
    if (!forecast.forecast || forecast.error) {
        return [{
            type: 'DATA_QUALITY',
            priority: 'HIGH',
            message: 'Insufficient data for accurate forecasting',
            action: 'Collect more historical booking data'
        }];
    }
    
    // Analyze forecast trends
    const revenueValues = forecast.forecast.map(day => day.predictedRevenue);
    const avgRevenue = revenueValues.reduce((sum, val) => sum + val, 0) / revenueValues.length;
    const trend = revenueValues[revenueValues.length - 1] - revenueValues[0];
    
    if (trend > avgRevenue * 0.1) {
        recommendations.push({
            type: 'GROWTH_OPPORTUNITY',
            priority: 'MEDIUM',
            message: 'Forecast shows positive revenue trend',
            action: 'Consider capacity expansion or premium pricing'
        });
    } else if (trend < -avgRevenue * 0.1) {
        recommendations.push({
            type: 'REVENUE_DECLINE',
            priority: 'HIGH',
            message: 'Forecast shows declining revenue trend',
            action: 'Implement promotional pricing or marketing campaigns'
        });
    }
    
    return recommendations;
}

async function getHotelOptimizationOpportunities(hotelId) {
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) return [];
    
    const opportunities = [];
    
    // Check current occupancy
    const currentOccupancy = await getCurrentHotelOccupancy(hotelId);
    if (currentOccupancy < 60) {
        opportunities.push({
            type: 'LOW_OCCUPANCY',
            priority: 'HIGH',
            message: `Current occupancy at ${currentOccupancy}% - consider promotional pricing`,
            estimatedImpact: '15-25% increase in bookings'
        });
    }
    
    // Check pricing competitiveness
    const pricingAnalysis = await analyzePricingCompetitiveness(hotelId);
    if (pricingAnalysis.position === 'OVERPRICED') {
        opportunities.push({
            type: 'PRICING_ADJUSTMENT',
            priority: 'MEDIUM',
            message: 'Pricing appears high compared to market',
            estimatedImpact: '10-20% increase in demand'
        });
    }
    
    return opportunities;
}

async function getImmediateOptimizationActions(hotelId) {
    const actions = [];
    
    // Get current demand level
    const demandAnalysis = hotelId ? 
        await demandAnalyzer.getCurrentDemandLevel(hotelId) :
        await adminController.getCurrentDemandAnalysis();
    
    if (demandAnalysis.level === 'HIGH' || demandAnalysis.level === 'VERY_HIGH') {
        actions.push({
            action: 'INCREASE_PRICES',
            priority: 'HIGH',
            description: 'High demand detected - increase prices by 10-20%',
            timeframe: 'Immediate'
        });
    } else if (demandAnalysis.level === 'LOW' || demandAnalysis.level === 'VERY_LOW') {
        actions.push({
            action: 'PROMOTIONAL_PRICING',
            priority: 'MEDIUM',
            description: 'Low demand - consider promotional offers',
            timeframe: '1-2 hours'
        });
    }
    
    return actions;
}

async function notifyHotelStaff(hotelId, optimization, adminUser) {
    // Send notification to hotel staff about optimization
    const hotel = await Hotel.findById(hotelId);
    if (!hotel) return;
    
    const notification = {
        type: 'YIELD_OPTIMIZATION',
        hotelId,
        message: `Pricing optimization completed by ${adminUser.firstName} ${adminUser.lastName}`,
        data: optimization,
        timestamp: new Date()
    };
    
    // Send to hotel staff (implementation depends on notification system)
    return await notificationService.sendToHotelStaff(hotelId, notification);
}

async function generateYieldRecommendations(params) {
    const { hotelId, priority, type, limit } = params;
    const recommendations = [];
    
    // Get current metrics for analysis
    const currentMetrics = hotelId ? 
        await getHotelYieldPerformance(hotelId, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'EUR') :
        await adminController.getYieldPerformanceMetrics(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 'EUR');
    
    // Generate recommendations based on performance
    if (currentMetrics.averageYieldScore < 70) {
        recommendations.push({
            id: 'yield_performance_low',
            type: 'PERFORMANCE',
            priority: 'HIGH',
            title: 'Low Yield Performance',
            description: 'Average yield score is below target',
            impact: 'HIGH',
            effort: 'MEDIUM'
        });
    }
    
    if (currentMetrics.optimizationRate < 50) {
        recommendations.push({
            id: 'optimization_rate_low',
            type: 'AUTOMATION',
            priority: 'MEDIUM',
            title: 'Increase Automation',
            description: 'Many bookings are not being optimized automatically',
            impact: 'MEDIUM',
            effort: 'LOW'
        });
    }
    
    // Filter by type and priority if specified
    let filtered = recommendations;
    if (type) filtered = filtered.filter(r => r.type === type);
    if (priority) filtered = filtered.filter(r => r.priority === priority);
    
    return filtered.slice(0, limit);
}

async function getRecommendationContext(recommendation) {
    // Get additional context for a recommendation
    return {
        relatedMetrics: await getRelatedMetrics(recommendation),
        historicalData: await getHistoricalDataForRecommendation(recommendation),
        marketConditions: await getCurrentMarketConditions()
    };
}

async function calculateRecommendationImpact(recommendation) {
    // Calculate estimated impact of implementing recommendation
    const baseImpact = {
        HIGH: { revenue: 15, efficiency: 20 },
        MEDIUM: { revenue: 8, efficiency: 12 },
        LOW: { revenue: 3, efficiency: 5 }
    };
    
    return baseImpact[recommendation.impact] || baseImpact.MEDIUM;
}

function calculateRecommendationUrgency(recommendation) {
    const urgencyFactors = {
        CRITICAL: 10,
        HIGH: 8,
        MEDIUM: 5,
        LOW: 2
    };
    
    return urgencyFactors[recommendation.priority] || 5;
}

function assessImplementationComplexity(recommendation) {
    const complexityMapping = {
        AUTOMATION: 'LOW',
        PERFORMANCE: 'MEDIUM',
        INTEGRATION: 'HIGH',
        STRATEGY: 'MEDIUM'
    };
    
    return complexityMapping[recommendation.type] || 'MEDIUM';
}

function groupRecommendationsByPriority(recommendations) {
    return recommendations.reduce((groups, rec) => {
        groups[rec.priority] = (groups[rec.priority] || 0) + 1;
        return groups;
    }, {});
}

function groupRecommendationsByType(recommendations) {
    return recommendations.reduce((groups, rec) => {
        groups[rec.type] = (groups[rec.type] || 0) + 1;
        return groups;
    }, {});
}

function calculateAverageImpact(recommendations) {
    if (recommendations.length === 0) return 0;
    
    const impacts = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    const totalImpact = recommendations.reduce((sum, rec) => {
        return sum + (impacts[rec.impact] || 2);
    }, 0);
    
    return totalImpact / recommendations.length;
}

async function getDemandAnalysisForHotel(hotelId, period, detailed) {
    const demand = await demandAnalyzer.getCurrentDemandLevel(hotelId);
    
    if (detailed) {
        // Add detailed analysis
        demand.historicalTrends = await getDemandHistoricalTrends(hotelId, period);
        demand.competitorComparison = await getCompetitorDemandComparison(hotelId);
        demand.seasonalFactors = await getSeasonalDemandFactors(hotelId);
    }
    
    return demand;
}

async function getDemandForecasts(hotelId, days) {
    return await demandAnalyzer.getDemandForecast(hotelId, days);
}

async function analyzeDemandTrends(hotelId, period) {
    // Analyze demand trends over the specified period
    const startDate = new Date(Date.now() - (period === '7d' ? 7 : 30) * 24 * 60 * 60 * 1000);
    
    const bookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: startDate },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
    });
    
    // Simple trend analysis
    const dailyBookings = {};
    bookings.forEach(booking => {
        const day = moment(booking.createdAt).format('YYYY-MM-DD');
        dailyBookings[day] = (dailyBookings[day] || 0) + 1;
    });
    
    const dates = Object.keys(dailyBookings).sort();
    const values = dates.map(date => dailyBookings[date]);
    
    // Calculate trend direction
    let trendDirection = 'STABLE';
    if (values.length >= 2) {
        const firstHalf = values.slice(0, Math.floor(values.length / 2));
        const secondHalf = values.slice(Math.floor(values.length / 2));
        
        const firstAvg = firstHalf.reduce((sum, val) => sum + val, 0) / firstHalf.length;
        const secondAvg = secondHalf.reduce((sum, val) => sum + val, 0) / secondHalf.length;
        
        if (secondAvg > firstAvg * 1.1) trendDirection = 'INCREASING';
        else if (secondAvg < firstAvg * 0.9) trendDirection = 'DECREASING';
    }
    
    return {
        trendDirection,
        dailyData: dates.map(date => ({
            date,
            bookings: dailyBookings[date]
        })),
        averageDaily: values.reduce((sum, val) => sum + val, 0) / values.length
    };
}

async function identifySeasonalDemandPatterns(hotelId) {
    // Identify seasonal patterns in demand
    const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    
    const bookings = await Booking.find({
        hotel: hotelId,
        createdAt: { $gte: oneYearAgo },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
    });
    
    const monthlyPatterns = {};
    const dayOfWeekPatterns = {};
    
    bookings.forEach(booking => {
        const month = moment(booking.checkInDate).format('MMMM');
        const dayOfWeek = moment(booking.checkInDate).format('dddd');
        
        monthlyPatterns[month] = (monthlyPatterns[month] || 0) + 1;
        dayOfWeekPatterns[dayOfWeek] = (dayOfWeekPatterns[dayOfWeek] || 0) + 1;
    });
    
    return {
        monthly: monthlyPatterns,
        dayOfWeek: dayOfWeekPatterns,
        peakMonths: Object.entries(monthlyPatterns)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([month]) => month),
        peakDays: Object.entries(dayOfWeekPatterns)
            .sort(([,a], [,b]) => b - a)
            .slice(0, 3)
            .map(([day]) => day)
    };
}

async function analyzeMarketTrends(params) {
    const { region, hotelCategory, timeframe, includeCompetitors } = params;
    
    // Market trend analysis (simplified implementation)
    const analysis = {
        region: region || 'ALL',
        hotelCategory: hotelCategory || 'ALL',
        timeframe,
        trends: {
            occupancyTrend: 'STABLE',
            pricingTrend: 'INCREASING',
            demandTrend: 'STABLE'
        },
        marketIndicators: {
            averageOccupancy: 72,
            averageDailyRate: 150,
            revPAR: 108
        }
    };
    
    if (includeCompetitors) {
        analysis.competitorInsights = {
            averageCompetitorRate: 145,
            pricingPosition: 'COMPETITIVE',
            marketShare: '12%'
        };
    }
    
    return analysis;
}

async function generateMarketInsights(marketAnalysis) {
    const insights = [];
    
    if (marketAnalysis.trends.demandTrend === 'INCREASING') {
        insights.push({
            type: 'OPPORTUNITY',
            message: 'Market demand is trending upward',
            recommendation: 'Consider increasing rates gradually'
        });
    }
    
    if (marketAnalysis.competitorInsights?.pricingPosition === 'BELOW_MARKET') {
        insights.push({
            type: 'PRICING',
            message: 'Your rates are below market average',
            recommendation: 'Opportunity to increase pricing'
        });
    }
    
    return insights;
}

async function identifyMarketOpportunities(marketAnalysis) {
    const opportunities = [];
    
    // Market gap analysis
    if (marketAnalysis.marketIndicators.averageOccupancy < 70) {
        opportunities.push({
            type: 'MARKET_PENETRATION',
            description: 'Low market occupancy presents opportunity',
            potential: 'HIGH'
        });
    }
    
    return opportunities;
}

// Error handling middleware for yield routes
router.use((error, req, res, next) => {
    logger.error('Yield management route error:', error);
    
    res.status(500).json({
        success: false,
        message: 'Yield management operation failed',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
        timestamp: new Date()
    });
});

// Export router
module.exports = router;