/**
 * Yield Management Jobs Service - Week 3
 * Automated price adjustments, daily/hourly yield calculations, and seasonal pricing updates
 * Handles background jobs for dynamic pricing optimization
 */

const cron = require('node-cron');
const moment = require('moment');
const Hotel = require('../models/Hotel');
const Room = require('../models/Room');
const Booking = require('../models/Booking');
const PricingRule = require('../models/PricingRule');
const yieldManager = require('../services/yieldManager');
const demandAnalyzer = require('../services/demandAnalyzer');
const socketService = require('../services/socketService');
const notificationService = require('../services/notificationService');
const { logger } = require('../utils/logger');

class YieldJobs {
    constructor() {
        this.jobs = new Map();
        this.isRunning = false;
        this.jobStats = {
            totalRuns: 0,
            successfulRuns: 0,
            failedRuns: 0,
            lastRunTime: null,
            averageExecutionTime: 0
        };
        
        // Job configurations
        this.jobConfig = {
            // Hourly price adjustments (every hour during business hours)
            hourlyPriceUpdate: {
                enabled: process.env.HOURLY_YIELD_ENABLED === 'true',
                schedule: '0 * 6-23 * * *', // Every hour from 6 AM to 11 PM
                description: 'Hourly price adjustments based on real-time demand'
            },
            
            // Daily yield calculations (every day at 2 AM)
            dailyYieldCalculation: {
                enabled: process.env.DAILY_YIELD_ENABLED === 'true',
                schedule: '0 0 2 * * *', // Daily at 2 AM
                description: 'Daily yield analysis and price optimization'
            },
            
            // Weekly demand analysis (every Sunday at 3 AM)
            weeklyDemandAnalysis: {
                enabled: process.env.WEEKLY_ANALYSIS_ENABLED === 'true',
                schedule: '0 0 3 * * 0', // Every Sunday at 3 AM
                description: 'Weekly demand pattern analysis'
            },
            
            // Monthly seasonal adjustments (1st of every month at 4 AM)
            monthlySeasonalUpdate: {
                enabled: process.env.SEASONAL_UPDATE_ENABLED === 'true',
                schedule: '0 0 4 1 * *', // 1st of every month at 4 AM
                description: 'Monthly seasonal pricing updates'
            },
            
            // Real-time high-demand adjustments (every 15 minutes during peak hours)
            realTimeAdjustments: {
                enabled: process.env.REALTIME_YIELD_ENABLED === 'true',
                schedule: '*/15 18-22 * * *', // Every 15 minutes from 6 PM to 10 PM
                description: 'Real-time pricing adjustments during peak booking hours'
            },
            
            // Performance monitoring (every 6 hours)
            performanceMonitoring: {
                enabled: process.env.YIELD_MONITORING_ENABLED === 'true',
                schedule: '0 0 */6 * * *', // Every 6 hours
                description: 'Yield management performance monitoring'
            }
        };

        logger.info('Yield Jobs service initialized');
    }

    /**
     * Start all automated yield management jobs
     */
    startJobs() {
        if (this.isRunning) {
            logger.warn('Yield jobs are already running');
            return;
        }

        try {
            // Schedule hourly price updates
            if (this.jobConfig.hourlyPriceUpdate.enabled) {
                this.jobs.set('hourlyPriceUpdate', cron.schedule(
                    this.jobConfig.hourlyPriceUpdate.schedule,
                    () => this.runJob('hourlyPriceUpdate', this.hourlyPriceUpdate.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Schedule daily yield calculations
            if (this.jobConfig.dailyYieldCalculation.enabled) {
                this.jobs.set('dailyYieldCalculation', cron.schedule(
                    this.jobConfig.dailyYieldCalculation.schedule,
                    () => this.runJob('dailyYieldCalculation', this.dailyYieldCalculation.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Schedule weekly demand analysis
            if (this.jobConfig.weeklyDemandAnalysis.enabled) {
                this.jobs.set('weeklyDemandAnalysis', cron.schedule(
                    this.jobConfig.weeklyDemandAnalysis.schedule,
                    () => this.runJob('weeklyDemandAnalysis', this.weeklyDemandAnalysis.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Schedule monthly seasonal updates
            if (this.jobConfig.monthlySeasonalUpdate.enabled) {
                this.jobs.set('monthlySeasonalUpdate', cron.schedule(
                    this.jobConfig.monthlySeasonalUpdate.schedule,
                    () => this.runJob('monthlySeasonalUpdate', this.monthlySeasonalUpdate.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Schedule real-time adjustments
            if (this.jobConfig.realTimeAdjustments.enabled) {
                this.jobs.set('realTimeAdjustments', cron.schedule(
                    this.jobConfig.realTimeAdjustments.schedule,
                    () => this.runJob('realTimeAdjustments', this.realTimeAdjustments.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Schedule performance monitoring
            if (this.jobConfig.performanceMonitoring.enabled) {
                this.jobs.set('performanceMonitoring', cron.schedule(
                    this.jobConfig.performanceMonitoring.schedule,
                    () => this.runJob('performanceMonitoring', this.performanceMonitoring.bind(this)),
                    { scheduled: false, timezone: 'Europe/Paris' }
                ));
            }

            // Start all scheduled jobs
            this.jobs.forEach((job, name) => {
                job.start();
                logger.info(`Started yield job: ${name}`);
            });

            this.isRunning = true;
            logger.info(`Started ${this.jobs.size} yield management jobs`);

        } catch (error) {
            logger.error('Error starting yield jobs:', error);
            this.stopJobs();
        }
    }

    /**
     * Stop all automated jobs
     */
    stopJobs() {
        this.jobs.forEach((job, name) => {
            job.destroy();
            logger.info(`Stopped yield job: ${name}`);
        });
        
        this.jobs.clear();
        this.isRunning = false;
        logger.info('All yield management jobs stopped');
    }

    /**
     * Generic job runner with error handling and monitoring
     */
    async runJob(jobName, jobFunction) {
        const startTime = Date.now();
        
        try {
            logger.info(`Starting yield job: ${jobName}`);
            await jobFunction();
            
            const executionTime = Date.now() - startTime;
            this.updateJobStats(true, executionTime);
            
            logger.info(`Completed yield job: ${jobName} in ${executionTime}ms`);
            
        } catch (error) {
            const executionTime = Date.now() - startTime;
            this.updateJobStats(false, executionTime);
            
            logger.error(`Failed yield job: ${jobName} after ${executionTime}ms:`, error);
            
            // Notify admins of job failure
            await this.notifyJobFailure(jobName, error);
        }
    }

    /**
     * Hourly price adjustments based on real-time demand
     */
    async hourlyPriceUpdate() {
        const hotels = await Hotel.find({ 
            'yieldManagement.enabled': true,
            'yieldManagement.automationSettings.hourlyUpdates': true
        });

        let totalAdjustments = 0;
        const adjustmentSummary = [];

        for (const hotel of hotels) {
            try {
                const hotelAdjustments = await this.processHotelHourlyUpdate(hotel);
                totalAdjustments += hotelAdjustments.count;
                adjustmentSummary.push(hotelAdjustments);
                
                // Broadcast price updates via Socket.io
                if (hotelAdjustments.count > 0) {
                    socketService.sendHotelNotification(hotel._id, 'PRICE_UPDATE', {
                        type: 'HOURLY_ADJUSTMENT',
                        adjustments: hotelAdjustments.count,
                        timestamp: new Date()
                    });
                }
                
            } catch (error) {
                logger.error(`Error in hourly update for hotel ${hotel._id}:`, error);
            }
        }

        logger.info(`Hourly price update completed: ${totalAdjustments} adjustments across ${hotels.length} hotels`);
        return { totalAdjustments, hotels: adjustmentSummary };
    }

    /**
     * Process hourly price update for a specific hotel
     */
    async processHotelHourlyUpdate(hotel) {
        const rooms = await Room.find({ hotel: hotel._id });
        let adjustmentCount = 0;
        const adjustments = [];

        for (const room of rooms) {
            // Skip if room doesn't have yield management enabled
            if (!room.yieldManagement?.enabled) continue;

            // Calculate current occupancy rate
            const occupancyRate = await this.calculateCurrentOccupancyRate(hotel._id, room.type);
            
            // Get demand prediction for next 24 hours
            const demandForecast = await demandAnalyzer.predictDemand(hotel._id, room.type, 24);
            
            // Calculate optimal price
            const currentPrice = room.currentDynamicPrice?.price || room.basePrice;
            const optimalPrice = await yieldManager.calculateOptimalPrice({
                hotelId: hotel._id,
                roomType: room.type,
                currentPrice,
                occupancyRate,
                demandForecast,
                strategy: hotel.yieldManagement.strategy
            });

            // Apply price change if significant difference (>5%)
            const priceDifference = Math.abs(optimalPrice - currentPrice);
            const percentageChange = (priceDifference / currentPrice) * 100;

            if (percentageChange >= 5) {
                await room.applyDynamicPrice(
                    optimalPrice,
                    new Date(),
                    moment().add(1, 'hour').toDate(),
                    null, // Automated
                    `Hourly adjustment: ${percentageChange.toFixed(1)}% change based on ${occupancyRate}% occupancy`
                );

                adjustments.push({
                    roomType: room.type,
                    oldPrice: currentPrice,
                    newPrice: optimalPrice,
                    change: percentageChange.toFixed(1),
                    reason: 'occupancy_based'
                });

                adjustmentCount++;
            }
        }

        return {
            hotelId: hotel._id,
            hotelName: hotel.name,
            count: adjustmentCount,
            adjustments
        };
    }

    /**
     * Daily yield calculations and optimization
     */
    async dailyYieldCalculation() {
        const hotels = await Hotel.find({ 'yieldManagement.enabled': true });
        const dailyResults = [];

        for (const hotel of hotels) {
            try {
                const result = await this.processDailyYieldCalculation(hotel);
                dailyResults.push(result);
                
                // Update hotel analytics
                await this.updateHotelYieldAnalytics(hotel, result);
                
            } catch (error) {
                logger.error(`Error in daily yield calculation for hotel ${hotel._id}:`, error);
            }
        }

        logger.info(`Daily yield calculation completed for ${hotels.length} hotels`);
        return dailyResults;
    }

    /**
     * Process daily yield calculation for a specific hotel
     */
    async processDailyYieldCalculation(hotel) {
        const today = moment().startOf('day');
        const yesterday = moment().subtract(1, 'day').startOf('day');
        
        // Calculate yesterday's performance
        const yesterdayBookings = await Booking.find({
            hotel: hotel._id,
            checkInDate: {
                $gte: yesterday.toDate(),
                $lt: today.toDate()
            },
            status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
        });

        // Calculate metrics
        const totalRooms = await Room.countDocuments({ hotel: hotel._id });
        const occupiedRooms = yesterdayBookings.reduce((sum, booking) => sum + booking.rooms.length, 0);
        const occupancyRate = (occupiedRooms / totalRooms) * 100;
        
        const totalRevenue = yesterdayBookings.reduce((sum, booking) => sum + booking.totalAmount, 0);
        const averageDailyRate = occupiedRooms > 0 ? totalRevenue / occupiedRooms : 0;
        const revPAR = totalRevenue / totalRooms;

        // Analyze pricing effectiveness
        const pricingEffectiveness = await this.analyzePricingEffectiveness(hotel, yesterdayBookings);
        
        // Generate recommendations
        const recommendations = await this.generateDailyRecommendations(hotel, {
            occupancyRate,
            averageDailyRate,
            revPAR,
            pricingEffectiveness
        });

        return {
            hotelId: hotel._id,
            date: yesterday.format('YYYY-MM-DD'),
            metrics: {
                occupancyRate,
                averageDailyRate,
                revPAR,
                totalRevenue,
                totalBookings: yesterdayBookings.length
            },
            pricingEffectiveness,
            recommendations
        };
    }

    /**
     * Weekly demand analysis and pattern recognition
     */
    async weeklyDemandAnalysis() {
        const hotels = await Hotel.find({ 'yieldManagement.enabled': true });
        const weeklyResults = [];

        for (const hotel of hotels) {
            try {
                const result = await demandAnalyzer.analyzeWeeklyDemand(hotel._id);
                weeklyResults.push(result);
                
                // Update demand patterns
                await this.updateDemandPatterns(hotel, result);
                
            } catch (error) {
                logger.error(`Error in weekly demand analysis for hotel ${hotel._id}:`, error);
            }
        }

        logger.info(`Weekly demand analysis completed for ${hotels.length} hotels`);
        return weeklyResults;
    }

    /**
     * Monthly seasonal pricing updates
     */
    async monthlySeasonalUpdate() {
        const hotels = await Hotel.find({ 'yieldManagement.enabled': true });
        const currentMonth = moment().month();
        const currentYear = moment().year();

        for (const hotel of hotels) {
            try {
                await this.updateSeasonalPricing(hotel, currentMonth, currentYear);
                
                // Notify hotel admins of seasonal updates
                const admins = await this.getHotelAdmins(hotel._id);
                for (const admin of admins) {
                    await notificationService.sendNotification({
                        type: 'SEASONAL_PRICING_UPDATE',
                        userId: admin._id,
                        channels: ['email', 'socket'],
                        data: {
                            hotel,
                            month: moment().format('MMMM YYYY'),
                            message: 'Seasonal pricing has been updated for your hotel'
                        }
                    });
                }
                
            } catch (error) {
                logger.error(`Error in seasonal update for hotel ${hotel._id}:`, error);
            }
        }

        logger.info(`Monthly seasonal updates completed for ${hotels.length} hotels`);
    }

    /**
     * Real-time pricing adjustments during peak hours
     */
    async realTimeAdjustments() {
        const hotels = await Hotel.find({ 
            'yieldManagement.enabled': true,
            'yieldManagement.automationSettings.realTimeAdjustments': true
        });

        for (const hotel of hotels) {
            try {
                // Check for sudden demand spikes
                const demandSpike = await this.detectDemandSpike(hotel._id);
                
                if (demandSpike.detected) {
                    await this.handleDemandSpike(hotel, demandSpike);
                    
                    // Notify relevant stakeholders
                    socketService.sendHotelNotification(hotel._id, 'DEMAND_SPIKE', {
                        spike: demandSpike,
                        timestamp: new Date()
                    });
                }
                
            } catch (error) {
                logger.error(`Error in real-time adjustments for hotel ${hotel._id}:`, error);
            }
        }
    }

    /**
     * Performance monitoring and alerting
     */
    async performanceMonitoring() {
        const hotels = await Hotel.find({ 'yieldManagement.enabled': true });
        const performanceAlerts = [];

        for (const hotel of hotels) {
            try {
                const performance = await this.analyzeYieldPerformance(hotel);
                
                // Check for performance issues
                if (performance.alerts.length > 0) {
                    performanceAlerts.push({
                        hotelId: hotel._id,
                        hotelName: hotel.name,
                        alerts: performance.alerts
                    });
                    
                    // Send alerts to admins
                    await this.sendPerformanceAlerts(hotel, performance.alerts);
                }
                
            } catch (error) {
                logger.error(`Error in performance monitoring for hotel ${hotel._id}:`, error);
            }
        }

        if (performanceAlerts.length > 0) {
            logger.warn(`Performance alerts generated for ${performanceAlerts.length} hotels`);
        }

        return performanceAlerts;
    }

    /**
     * Helper methods
     */
    async calculateCurrentOccupancyRate(hotelId, roomType = null) {
        const today = moment().startOf('day');
        const tomorrow = moment().add(1, 'day').startOf('day');

        const query = {
            hotel: hotelId,
            checkInDate: { $lte: today.toDate() },
            checkOutDate: { $gt: today.toDate() },
            status: { $in: ['CONFIRMED', 'CHECKED_IN'] }
        };

        const bookings = await Booking.find(query);
        const occupiedRooms = bookings.reduce((sum, booking) => {
            return sum + booking.rooms.filter(room => 
                !roomType || room.roomType === roomType
            ).length;
        }, 0);

        const totalRoomsQuery = { hotel: hotelId };
        if (roomType) totalRoomsQuery.type = roomType;
        
        const totalRooms = await Room.countDocuments(totalRoomsQuery);
        
        return totalRooms > 0 ? (occupiedRooms / totalRooms) * 100 : 0;
    }

    async detectDemandSpike(hotelId) {
        const lastHour = moment().subtract(1, 'hour');
        const recentBookings = await Booking.find({
            hotel: hotelId,
            createdAt: { $gte: lastHour.toDate() },
            status: { $ne: 'CANCELLED' }
        });

        // Get historical average for same hour/day
        const historicalAverage = await this.getHistoricalBookingAverage(hotelId, moment());
        
        const currentHourBookings = recentBookings.length;
        const spikeThreshold = historicalAverage * 2; // 200% of normal

        return {
            detected: currentHourBookings >= spikeThreshold,
            currentBookings: currentHourBookings,
            historicalAverage,
            spikeMultiplier: historicalAverage > 0 ? currentHourBookings / historicalAverage : 0
        };
    }

    async handleDemandSpike(hotel, demandSpike) {
        const rooms = await Room.find({ 
            hotel: hotel._id,
            'yieldManagement.enabled': true 
        });

        for (const room of rooms) {
            const currentPrice = room.currentDynamicPrice?.price || room.basePrice;
            const spikeMultiplier = Math.min(1.5, 1 + (demandSpike.spikeMultiplier - 1) * 0.3); // Cap at 50% increase
            const newPrice = currentPrice * spikeMultiplier;

            await room.applyDynamicPrice(
                newPrice,
                new Date(),
                moment().add(2, 'hours').toDate(),
                null,
                `Demand spike adjustment: ${((spikeMultiplier - 1) * 100).toFixed(1)}% increase`
            );
        }

        logger.info(`Applied demand spike pricing for hotel ${hotel._id}: ${demandSpike.spikeMultiplier.toFixed(2)}x normal demand`);
    }

    updateJobStats(success, executionTime) {
        this.jobStats.totalRuns++;
        this.jobStats.lastRunTime = new Date();
        
        if (success) {
            this.jobStats.successfulRuns++;
        } else {
            this.jobStats.failedRuns++;
        }
        
        // Update average execution time
        const currentAvg = this.jobStats.averageExecutionTime;
        const totalRuns = this.jobStats.totalRuns;
        this.jobStats.averageExecutionTime = ((currentAvg * (totalRuns - 1)) + executionTime) / totalRuns;
    }

    async notifyJobFailure(jobName, error) {
        const admins = await User.find({ role: 'ADMIN' });
        
        for (const admin of admins) {
            await notificationService.sendNotification({
                type: 'SYSTEM_ALERT',
                userId: admin._id,
                channels: ['email', 'socket'],
                data: {
                    alertType: 'YIELD_JOB_FAILURE',
                    jobName,
                    error: error.message,
                    timestamp: new Date()
                },
                priority: 'high'
            });
        }
    }

    /**
     * Get job status and statistics
     */
    getJobStatus() {
        return {
            isRunning: this.isRunning,
            activeJobs: Array.from(this.jobs.keys()),
            jobConfiguration: this.jobConfig,
            statistics: this.jobStats
        };
    }

    /**
     * Manual job execution for testing
     */
    async executeJob(jobName) {
        const jobFunction = this[jobName];
        if (!jobFunction) {
            throw new Error(`Job ${jobName} not found`);
        }

        return await this.runJob(jobName, jobFunction.bind(this));
    }
}

// Create singleton instance
const yieldJobs = new YieldJobs();

module.exports = yieldJobs;