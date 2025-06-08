/**
 * Advanced Scheduler Service - Week 3 with YieldJobs Integration
 * Comprehensive job scheduling system for yield management, pricing updates, and market analysis
 * Handles complex scheduling scenarios with priority queues, retry logic, and monitoring
 */

const cron = require('node-cron');
const moment = require('moment');
const EventEmitter = require('events');
const notificationService = require('./notificationService');
const socketService = require('./socketService');
const { logger } = require('../utils/logger');
const { JOB_TYPES, JOB_FREQUENCIES } = require('../utils/constants');

class SchedulerService extends EventEmitter {
    constructor() {
        super();
        
        // Job queues by priority
        this.queues = {
            critical: [], // System critical jobs (immediate execution)
            high: [],     // High priority jobs (within 5 minutes)
            medium: [],   // Medium priority jobs (within 30 minutes)
            low: []       // Low priority jobs (within 2 hours)
        };

        // Active scheduled jobs
        this.scheduledJobs = new Map();
        
        // Job execution history
        this.jobHistory = [];
        this.maxHistorySize = 1000;

        // Scheduler configuration
        this.config = {
            maxConcurrentJobs: parseInt(process.env.SCHEDULER_MAX_CONCURRENT || '5'),
            defaultTimeout: parseInt(process.env.SCHEDULER_DEFAULT_TIMEOUT || '300000'), // 5 minutes
            retryAttempts: parseInt(process.env.SCHEDULER_RETRY_ATTEMPTS || '3'),
            retryDelay: parseInt(process.env.SCHEDULER_RETRY_DELAY || '60000'), // 1 minute
            cleanupInterval: parseInt(process.env.SCHEDULER_CLEANUP_INTERVAL || '3600000'), // 1 hour
            monitoringEnabled: process.env.SCHEDULER_MONITORING === 'true'
        };

        // Execution statistics
        this.stats = {
            totalJobs: 0,
            completedJobs: 0,
            failedJobs: 0,
            activeJobs: 0,
            queuedJobs: 0,
            averageExecutionTime: 0,
            lastCleanup: null,
            yieldJobsExecuted: 0,
            lastYieldJobExecution: null
        };

        // Currently executing jobs
        this.executingJobs = new Map();

        // Job definitions registry
        this.jobDefinitions = new Map();

        // Yield jobs instance (will be injected)
        this.yieldJobs = null;

        // Initialization flag
        this.initialized = false;

        logger.info('Scheduler Service constructed, waiting for initialization');
    }

    /**
     * Initialize the scheduler with yield jobs integration
     */
    async initialize() {
        if (this.initialized) {
            logger.warn('Scheduler already initialized');
            return;
        }

        try {
            // Dynamic import of yieldJobs to avoid circular dependencies
            this.yieldJobs = require('../jobs/yieldJobs');

            // Register job definitions
            this.registerJobDefinitions();

            // Start cleanup interval
            this.startCleanupInterval();

            // Start queue processor
            this.startQueueProcessor();

            // Set up event listeners
            this.setupEventListeners();

            // Start monitoring if enabled
            if (this.config.monitoringEnabled) {
                this.startMonitoring();
            }

            // Schedule default yield management jobs if enabled
            if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
                await this.scheduleDefaultYieldJobs();
            }

            this.initialized = true;
            logger.info('Scheduler Service initialized successfully with yield management integration');

        } catch (error) {
            logger.error('Failed to initialize scheduler service:', error);
            throw error;
        }
    }

    /**
     * Register default job definitions including yield management
     */
    registerJobDefinitions() {
        // Yield management jobs
        this.registerJob(JOB_TYPES.DEMAND_ANALYSIS, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.analyzeDemand(data);
            },
            timeout: 300000, // 5 minutes
            priority: 'high',
            retryAttempts: 2,
            description: 'Analyze demand patterns and market conditions'
        });

        this.registerJob(JOB_TYPES.PRICE_UPDATE, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.updatePrices(data);
            },
            timeout: 300000, // 5 minutes
            priority: 'high',
            retryAttempts: 2,
            description: 'Update dynamic pricing based on current market conditions'
        });

        this.registerJob(JOB_TYPES.OCCUPANCY_ANALYSIS, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.analyzeOccupancy(data);
            },
            timeout: 600000, // 10 minutes
            priority: 'medium',
            retryAttempts: 3,
            description: 'Analyze occupancy trends and forecast capacity'
        });

        this.registerJob(JOB_TYPES.REVENUE_OPTIMIZATION, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.optimizeRevenue(data);
            },
            timeout: 900000, // 15 minutes
            priority: 'medium',
            retryAttempts: 3,
            description: 'Optimize revenue through dynamic pricing strategies'
        });

        this.registerJob(JOB_TYPES.PERFORMANCE_MONITORING, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.monitorPerformance(data);
            },
            timeout: 300000, // 5 minutes
            priority: 'low',
            retryAttempts: 2,
            description: 'Monitor yield management performance metrics'
        });

        this.registerJob(JOB_TYPES.DAILY_REPORT, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.generateDailyReports(data);
            },
            timeout: 600000, // 10 minutes
            priority: 'medium',
            retryAttempts: 3,
            description: 'Generate daily yield management reports'
        });

        this.registerJob(JOB_TYPES.WEEKLY_FORECAST, {
            handler: async (data) => {
                this.stats.yieldJobsExecuted++;
                this.stats.lastYieldJobExecution = new Date();
                return await this.yieldJobs.generateForecasts(data);
            },
            timeout: 1200000, // 20 minutes
            priority: 'low',
            retryAttempts: 2,
            description: 'Generate weekly revenue forecasts'
        });

        // System maintenance jobs
        this.registerJob('system.cleanup', {
            handler: this.systemCleanup.bind(this),
            timeout: 600000, // 10 minutes
            priority: 'low',
            retryAttempts: 1,
            description: 'System cleanup and maintenance'
        });

        this.registerJob('system.health_check', {
            handler: this.systemHealthCheck.bind(this),
            timeout: 60000, // 1 minute
            priority: 'medium',
            retryAttempts: 1,
            description: 'System health monitoring'
        });

        logger.info(`Registered ${this.jobDefinitions.size} job definitions including yield management jobs`);
    }

    /**
     * Schedule default yield management jobs
     */
    async scheduleDefaultYieldJobs() {
        try {
            // Schedule demand analysis
            const demandAnalysisId = this.scheduleRecurringJob(
                JOB_TYPES.DEMAND_ANALYSIS,
                JOB_FREQUENCIES[JOB_TYPES.DEMAND_ANALYSIS],
                {},
                { priority: 'high', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule price updates
            const priceUpdateId = this.scheduleRecurringJob(
                JOB_TYPES.PRICE_UPDATE,
                JOB_FREQUENCIES[JOB_TYPES.PRICE_UPDATE],
                {},
                { priority: 'high', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule occupancy analysis
            const occupancyAnalysisId = this.scheduleRecurringJob(
                JOB_TYPES.OCCUPANCY_ANALYSIS,
                JOB_FREQUENCIES[JOB_TYPES.OCCUPANCY_ANALYSIS],
                {},
                { priority: 'medium', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule revenue optimization
            const revenueOptimizationId = this.scheduleRecurringJob(
                JOB_TYPES.REVENUE_OPTIMIZATION,
                JOB_FREQUENCIES[JOB_TYPES.REVENUE_OPTIMIZATION],
                {},
                { priority: 'medium', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule performance monitoring
            const performanceMonitoringId = this.scheduleRecurringJob(
                JOB_TYPES.PERFORMANCE_MONITORING,
                JOB_FREQUENCIES[JOB_TYPES.PERFORMANCE_MONITORING],
                {},
                { priority: 'low', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule daily reports
            const dailyReportId = this.scheduleRecurringJob(
                JOB_TYPES.DAILY_REPORT,
                JOB_FREQUENCIES[JOB_TYPES.DAILY_REPORT],
                {},
                { priority: 'medium', metadata: { automated: true, category: 'yield' } }
            );

            // Schedule weekly forecasts
            const weeklyForecastId = this.scheduleRecurringJob(
                JOB_TYPES.WEEKLY_FORECAST,
                JOB_FREQUENCIES[JOB_TYPES.WEEKLY_FORECAST],
                {},
                { priority: 'low', metadata: { automated: true, category: 'yield' } }
            );

            // Start all yield management jobs
            const yieldJobIds = [
                demandAnalysisId,
                priceUpdateId,
                occupancyAnalysisId,
                revenueOptimizationId,
                performanceMonitoringId,
                dailyReportId,
                weeklyForecastId
            ];

            for (const jobId of yieldJobIds) {
                this.startRecurringJob(jobId);
            }

            logger.info(`Scheduled and started ${yieldJobIds.length} default yield management jobs`);

            // Emit event for monitoring
            this.emit('yield:jobs_scheduled', { jobIds: yieldJobIds, count: yieldJobIds.length });

        } catch (error) {
            logger.error('Failed to schedule default yield jobs:', error);
            throw error;
        }
    }

    /**
     * Register a new job definition
     */
    registerJob(jobType, definition) {
        const jobDef = {
            type: jobType,
            handler: definition.handler,
            timeout: definition.timeout || this.config.defaultTimeout,
            priority: definition.priority || 'medium',
            retryAttempts: definition.retryAttempts || this.config.retryAttempts,
            description: definition.description || '',
            metadata: definition.metadata || {}
        };

        this.jobDefinitions.set(jobType, jobDef);
        logger.debug(`Registered job definition: ${jobType}`);
        return jobDef;
    }

    /**
     * Schedule a one-time job
     */
    async scheduleJob(jobType, data = {}, options = {}) {
        if (!this.initialized) {
            throw new Error('Scheduler not initialized. Call initialize() first.');
        }

        const jobDef = this.jobDefinitions.get(jobType);
        if (!jobDef) {
            throw new Error(`Job type ${jobType} not registered`);
        }

        const job = {
            id: this.generateJobId(),
            type: jobType,
            data,
            priority: options.priority || jobDef.priority,
            timeout: options.timeout || jobDef.timeout,
            retryAttempts: options.retryAttempts !== undefined ? options.retryAttempts : jobDef.retryAttempts,
            scheduledAt: options.scheduledAt || new Date(),
            executeAt: options.executeAt || new Date(),
            createdAt: new Date(),
            attempts: 0,
            status: 'queued',
            metadata: { ...jobDef.metadata, ...options.metadata }
        };

        // Add to appropriate queue
        this.addToQueue(job);
        
        this.stats.totalJobs++;
        this.stats.queuedJobs++;

        logger.info(`Scheduled job ${job.id} (${jobType}) for execution at ${job.executeAt}`);
        this.emit('job:scheduled', job);

        return job;
    }

    /**
     * Schedule a recurring job using cron syntax
     */
    scheduleRecurringJob(jobType, cronExpression, data = {}, options = {}) {
        if (!this.initialized) {
            throw new Error('Scheduler not initialized. Call initialize() first.');
        }

        const jobDef = this.jobDefinitions.get(jobType);
        if (!jobDef) {
            throw new Error(`Job type ${jobType} not registered`);
        }

        const scheduledJob = cron.schedule(cronExpression, async () => {
            try {
                await this.scheduleJob(jobType, data, options);
            } catch (error) {
                logger.error(`Error scheduling recurring job ${jobType}:`, error);
            }
        }, {
            scheduled: false,
            timezone: options.timezone || process.env.SCHEDULER_TIMEZONE || 'Europe/Paris'
        });

        const jobId = this.generateJobId();
        this.scheduledJobs.set(jobId, {
            id: jobId,
            type: jobType,
            cronExpression,
            cronJob: scheduledJob,
            data,
            options,
            createdAt: new Date(),
            isActive: false
        });

        logger.info(`Scheduled recurring job ${jobId} (${jobType}) with cron: ${cronExpression}`);
        return jobId;
    }

    /**
     * Start a recurring job
     */
    startRecurringJob(jobId) {
        const job = this.scheduledJobs.get(jobId);
        if (!job) {
            throw new Error(`Recurring job ${jobId} not found`);
        }

        job.cronJob.start();
        job.isActive = true;
        
        logger.info(`Started recurring job ${jobId} (${job.type})`);
        this.emit('recurring:started', job);
    }

    /**
     * Stop a recurring job
     */
    stopRecurringJob(jobId) {
        const job = this.scheduledJobs.get(jobId);
        if (!job) {
            throw new Error(`Recurring job ${jobId} not found`);
        }

        job.cronJob.stop();
        job.isActive = false;
        
        logger.info(`Stopped recurring job ${jobId} (${job.type})`);
        this.emit('recurring:stopped', job);
    }

    /**
     * Add job to appropriate priority queue
     */
    addToQueue(job) {
        const queue = this.queues[job.priority] || this.queues.medium;
        
        // Insert job in chronological order
        const insertIndex = queue.findIndex(queuedJob => queuedJob.executeAt > job.executeAt);
        if (insertIndex === -1) {
            queue.push(job);
        } else {
            queue.splice(insertIndex, 0, job);
        }

        this.emit('job:queued', job);
    }

    /**
     * Start the queue processor
     */
    startQueueProcessor() {
        setInterval(async () => {
            await this.processQueues();
        }, 1000); // Check every second

        logger.info('Queue processor started');
    }

    /**
     * Process all priority queues
     */
    async processQueues() {
        if (this.executingJobs.size >= this.config.maxConcurrentJobs) {
            return; // Max concurrent jobs reached
        }

        const now = new Date();
        
        // Process queues by priority
        for (const priority of ['critical', 'high', 'medium', 'low']) {
            const queue = this.queues[priority];
            
            while (queue.length > 0 && this.executingJobs.size < this.config.maxConcurrentJobs) {
                const job = queue[0];
                
                // Check if job is ready to execute
                if (job.executeAt <= now) {
                    queue.shift(); // Remove from queue
                    this.stats.queuedJobs--;
                    await this.executeJob(job);
                } else {
                    break; // Jobs are sorted by executeAt, so no need to check further
                }
            }
        }
    }

    /**
     * Execute a job
     */
    async executeJob(job) {
        const jobDef = this.jobDefinitions.get(job.type);
        if (!jobDef) {
            logger.error(`Job definition not found for type: ${job.type}`);
            return;
        }

        job.status = 'executing';
        job.startTime = new Date();
        job.attempts++;
        
        this.executingJobs.set(job.id, job);
        this.stats.activeJobs++;

        logger.info(`Executing job ${job.id} (${job.type}) - Attempt ${job.attempts}`);
        this.emit('job:started', job);

        try {
            // Set up timeout
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Job timeout')), job.timeout);
            });

            // Execute job with timeout
            const result = await Promise.race([
                jobDef.handler(job.data),
                timeoutPromise
            ]);

            // Job completed successfully
            await this.handleJobSuccess(job, result);
            
        } catch (error) {
            // Job failed
            await this.handleJobFailure(job, error);
        }
    }

    /**
     * Handle successful job completion
     */
    async handleJobSuccess(job, result) {
        job.status = 'completed';
        job.endTime = new Date();
        job.executionTime = job.endTime - job.startTime;
        job.result = result;

        this.executingJobs.delete(job.id);
        this.stats.activeJobs--;
        this.stats.completedJobs++;

        // Update average execution time
        const totalCompleted = this.stats.completedJobs;
        this.stats.averageExecutionTime = 
            ((this.stats.averageExecutionTime * (totalCompleted - 1)) + job.executionTime) / totalCompleted;

        this.addToHistory(job);

        logger.info(`Job ${job.id} (${job.type}) completed successfully in ${job.executionTime}ms`);
        this.emit('job:completed', job);

        // Send real-time notification for important jobs
        if (job.priority === 'critical' || job.priority === 'high') {
            try {
                socketService.sendAdminNotification('JOB_COMPLETED', {
                    jobId: job.id,
                    jobType: job.type,
                    executionTime: job.executionTime,
                    timestamp: job.endTime,
                    isYieldJob: Object.values(JOB_TYPES).includes(job.type)
                });
            } catch (error) {
                logger.error('Failed to send job completion notification:', error);
            }
        }

        // Emit specific event for yield jobs
        if (Object.values(JOB_TYPES).includes(job.type)) {
            this.emit('yield:job_completed', job);
        }
    }

    /**
     * Handle job failure
     */
    async handleJobFailure(job, error) {
        job.status = 'failed';
        job.endTime = new Date();
        job.executionTime = job.endTime - job.startTime;
        job.error = error.message;
        job.errorStack = error.stack;

        this.executingJobs.delete(job.id);
        this.stats.activeJobs--;

        logger.error(`Job ${job.id} (${job.type}) failed: ${error.message}`);

        // Retry logic
        if (job.attempts < job.retryAttempts) {
            await this.scheduleRetry(job);
        } else {
            // Final failure
            this.stats.failedJobs++;
            this.addToHistory(job);
            this.emit('job:failed', job);

            // Send failure notification
            await this.notifyJobFailure(job, error);

            // Emit specific event for yield job failures
            if (Object.values(JOB_TYPES).includes(job.type)) {
                this.emit('yield:job_failed', job);
            }
        }
    }

    /**
     * Schedule job retry
     */
    async scheduleRetry(job) {
        const retryDelay = this.config.retryDelay * Math.pow(2, job.attempts - 1); // Exponential backoff
        const retryAt = new Date(Date.now() + retryDelay);

        job.status = 'retrying';
        job.executeAt = retryAt;

        this.addToQueue(job);
        this.stats.queuedJobs++;

        logger.info(`Scheduled retry for job ${job.id} (${job.type}) in ${retryDelay}ms (attempt ${job.attempts + 1})`);
        this.emit('job:retry', job);
    }

    /**
     * Add job to execution history
     */
    addToHistory(job) {
        this.jobHistory.unshift(job);
        
        // Limit history size
        if (this.jobHistory.length > this.maxHistorySize) {
            this.jobHistory = this.jobHistory.slice(0, this.maxHistorySize);
        }
    }

    /**
     * Start cleanup interval
     */
    startCleanupInterval() {
        setInterval(async () => {
            await this.cleanup();
        }, this.config.cleanupInterval);

        logger.info('Cleanup interval started');
    }

    /**
     * Cleanup old jobs and optimize memory
     */
    async cleanup() {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 24 hours ago

        // Clean up old job history
        const initialHistorySize = this.jobHistory.length;
        this.jobHistory = this.jobHistory.filter(job => 
            job.endTime && job.endTime > cutoffTime
        );

        const removedHistoryItems = initialHistorySize - this.jobHistory.length;

        // Clean up old queued jobs
        let removedQueuedJobs = 0;
        for (const priority in this.queues) {
            const initialQueueSize = this.queues[priority].length;
            this.queues[priority] = this.queues[priority].filter(job => 
                job.executeAt > cutoffTime || job.status === 'executing'
            );
            removedQueuedJobs += initialQueueSize - this.queues[priority].length;
        }

        this.stats.lastCleanup = now;

        if (removedHistoryItems > 0 || removedQueuedJobs > 0) {
            logger.info(`Cleanup completed: removed ${removedHistoryItems} history items and ${removedQueuedJobs} old queued jobs`);
        }

        this.emit('cleanup:completed', { removedHistoryItems, removedQueuedJobs });
    }

    /**
     * Start monitoring and health checks
     */
    startMonitoring() {
        // Schedule health check every 5 minutes
        const healthCheckId = this.scheduleRecurringJob('system.health_check', '*/5 * * * *', {}, {
            priority: 'medium'
        });

        // Schedule cleanup every hour
        const cleanupId = this.scheduleRecurringJob('system.cleanup', '0 * * * *', {}, {
            priority: 'low'
        });

        // Start monitoring jobs
        this.startRecurringJob(healthCheckId);
        this.startRecurringJob(cleanupId);

        logger.info('Monitoring started with health checks and cleanup jobs');
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        this.on('job:failed', async (job) => {
            if (job.priority === 'critical') {
                await this.handleCriticalJobFailure(job);
            }
        });

        this.on('yield:job_completed', (job) => {
            logger.info(`Yield job completed: ${job.type} in ${job.executionTime}ms`);
        });

        this.on('yield:job_failed', (job) => {
            logger.error(`Yield job failed: ${job.type} - ${job.error}`);
        });
    }

    /**
     * Handle critical job failures
     */
    async handleCriticalJobFailure(job) {
        logger.error(`CRITICAL JOB FAILURE: ${job.id} (${job.type})`);
        
        // Send immediate alerts to all admins
        try {
            await notificationService.emit('system:alert', {
                message: `Critical job failure: ${job.type}`,
                severity: 'CRITICAL',
                targetRoles: ['ADMIN'],
                data: {
                    jobId: job.id,
                    jobType: job.type,
                    error: job.error,
                    attempts: job.attempts
                }
            });
        } catch (error) {
            logger.error('Failed to send critical job failure notification:', error);
        }
    }

    /**
     * System health check job
     */
    async systemHealthCheck() {
        const health = {
            timestamp: new Date(),
            scheduler: {
                initialized: this.initialized,
                activeJobs: this.stats.activeJobs,
                queuedJobs: this.stats.queuedJobs,
                yieldJobsExecuted: this.stats.yieldJobsExecuted,
                lastYieldJobExecution: this.stats.lastYieldJobExecution,
                memoryUsage: process.memoryUsage(),
                uptime: process.uptime()
            },
            queues: Object.fromEntries(
                Object.entries(this.queues).map(([priority, queue]) => [priority, queue.length])
            ),
            executingJobs: Array.from(this.executingJobs.values()).map(job => ({
                id: job.id,
                type: job.type,
                duration: new Date() - job.startTime,
                isYieldJob: Object.values(JOB_TYPES).includes(job.type)
            }))
        };

        // Check for stuck jobs (running too long)
        const stuckJobs = health.executingJobs.filter(job => job.duration > 600000); // 10 minutes
        
        if (stuckJobs.length > 0) {
            logger.warn(`Found ${stuckJobs.length} potentially stuck jobs`);
            health.alerts = [`${stuckJobs.length} jobs running longer than 10 minutes`];
        }

        // Check yield management specific health
        if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
            const yieldJobs = this.getYieldJobs();
            health.yieldManagement = {
                enabled: true,
                activeYieldJobs: yieldJobs.active,
                scheduledYieldJobs: yieldJobs.scheduled,
                lastExecution: this.stats.lastYieldJobExecution
            };
        }

        this.emit('health:check', health);
        return health;
    }

    /**
     * System cleanup job
     */
    async systemCleanup() {
        await this.cleanup();
        
        // Force garbage collection if available
        if (global.gc) {
            global.gc();
            logger.debug('Forced garbage collection');
        }

        return { status: 'completed', timestamp: new Date() };
    }

    /**
     * Get yield management jobs status
     */
    getYieldJobs() {
        const scheduledYieldJobs = Array.from(this.scheduledJobs.values())
            .filter(job => Object.values(JOB_TYPES).includes(job.type));

        const activeYieldJobs = Array.from(this.executingJobs.values())
            .filter(job => Object.values(JOB_TYPES).includes(job.type));

        return {
            scheduled: scheduledYieldJobs.length,
            active: activeYieldJobs.length,
            types: scheduledYieldJobs.map(job => ({
                id: job.id,
                type: job.type,
                isActive: job.isActive,
                cronExpression: job.cronExpression
            }))
        };
    }

    /**
     * Trigger immediate yield job execution (for testing/manual triggers)
     */
    async triggerYieldJob(jobType, data = {}) {
        if (!Object.values(JOB_TYPES).includes(jobType)) {
            throw new Error(`Invalid yield job type: ${jobType}`);
        }

        return await this.scheduleJob(jobType, data, {
            priority: 'high',
            executeAt: new Date(),
            metadata: { manual: true, triggered: new Date() }
        });
    }

    /**
     * Notify job failure to administrators
     */
    async notifyJobFailure(job, error) {
        try {
            const isYieldJob = Object.values(JOB_TYPES).includes(job.type);
            
            await notificationService.emit('system:alert', {
                message: `${isYieldJob ? 'Yield Management' : 'System'} job failure: ${job.type} (${job.id})`,
                severity: job.priority === 'critical' ? 'CRITICAL' : 'HIGH',
                details: {
                    jobId: job.id,
                    jobType: job.type,
                    isYieldJob,
                    attempts: job.attempts,
                    error: error.message,
                    executionTime: job.executionTime
                },
                targetRoles: ['ADMIN']
            });
        } catch (notificationError) {
            logger.error('Failed to send job failure notification:', notificationError);
        }
    }

    /**
     * Utility methods
     */
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get scheduler statistics with yield management metrics
     */
    getStatistics() {
        return {
            ...this.stats,
            queueSizes: Object.fromEntries(
                Object.entries(this.queues).map(([priority, queue]) => [priority, queue.length])
            ),
            executingJobsCount: this.executingJobs.size,
            scheduledJobsCount: this.scheduledJobs.size,
            jobDefinitionsCount: this.jobDefinitions.size,
            yieldManagement: {
                enabled: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
                jobsExecuted: this.stats.yieldJobsExecuted,
                lastExecution: this.stats.lastYieldJobExecution,
                activeYieldJobs: this.getYieldJobs().active,
                scheduledYieldJobs: this.getYieldJobs().scheduled
            }
        };
    }

    /**
     * Get all scheduled jobs with yield management categorization
     */
    getScheduledJobs() {
        return Array.from(this.scheduledJobs.values()).map(job => ({
            id: job.id,
            type: job.type,
            cronExpression: job.cronExpression,
            isActive: job.isActive,
            createdAt: job.createdAt,
            category: Object.values(JOB_TYPES).includes(job.type) ? 'yield' : 'system',
            isYieldJob: Object.values(JOB_TYPES).includes(job.type)
        }));
    }

    /**
     * Get job history with filtering options
     */
    getJobHistory(limit = 50, filter = {}) {
        let filteredHistory = this.jobHistory;

        // Filter by job type category
        if (filter.category === 'yield') {
            filteredHistory = filteredHistory.filter(job => 
                Object.values(JOB_TYPES).includes(job.type)
            );
        } else if (filter.category === 'system') {
            filteredHistory = filteredHistory.filter(job => 
                !Object.values(JOB_TYPES).includes(job.type)
            );
        }

        // Filter by status
        if (filter.status) {
            filteredHistory = filteredHistory.filter(job => job.status === filter.status);
        }

        // Filter by date range
        if (filter.fromDate) {
            filteredHistory = filteredHistory.filter(job => 
                job.createdAt >= new Date(filter.fromDate)
            );
        }

        if (filter.toDate) {
            filteredHistory = filteredHistory.filter(job => 
                job.createdAt <= new Date(filter.toDate)
            );
        }

        return filteredHistory.slice(0, limit);
    }

    /**
     * Cancel a queued job
     */
    cancelJob(jobId) {
        for (const priority in this.queues) {
            const queue = this.queues[priority];
            const jobIndex = queue.findIndex(job => job.id === jobId);
            
            if (jobIndex !== -1) {
                const job = queue.splice(jobIndex, 1)[0];
                job.status = 'cancelled';
                job.cancelledAt = new Date();
                this.stats.queuedJobs--;
                this.addToHistory(job);
                
                logger.info(`Cancelled job ${jobId} (${job.type})`);
                this.emit('job:cancelled', job);
                
                // Emit specific event for yield jobs
                if (Object.values(JOB_TYPES).includes(job.type)) {
                    this.emit('yield:job_cancelled', job);
                }
                
                return true;
            }
        }
        
        return false;
    }

    /**
     * Pause all yield management jobs
     */
    pauseYieldJobs() {
        let pausedCount = 0;
        
        this.scheduledJobs.forEach((job, jobId) => {
            if (Object.values(JOB_TYPES).includes(job.type) && job.isActive) {
                this.stopRecurringJob(jobId);
                pausedCount++;
            }
        });

        logger.info(`Paused ${pausedCount} yield management jobs`);
        this.emit('yield:jobs_paused', { count: pausedCount });
        
        return pausedCount;
    }

    /**
     * Resume all yield management jobs
     */
    resumeYieldJobs() {
        let resumedCount = 0;
        
        this.scheduledJobs.forEach((job, jobId) => {
            if (Object.values(JOB_TYPES).includes(job.type) && !job.isActive) {
                this.startRecurringJob(jobId);
                resumedCount++;
            }
        });

        logger.info(`Resumed ${resumedCount} yield management jobs`);
        this.emit('yield:jobs_resumed', { count: resumedCount });
        
        return resumedCount;
    }

    /**
     * Get detailed status of yield management system
     */
    getYieldManagementStatus() {
        if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
            return {
                enabled: false,
                message: 'Yield management is disabled'
            };
        }

        const yieldJobs = this.getYieldJobs();
        const yieldHistory = this.getJobHistory(20, { category: 'yield' });
        
        const successfulYieldJobs = yieldHistory.filter(job => job.status === 'completed').length;
        const failedYieldJobs = yieldHistory.filter(job => job.status === 'failed').length;
        const totalYieldJobs = successfulYieldJobs + failedYieldJobs;
        
        return {
            enabled: true,
            initialized: this.initialized,
            statistics: {
                totalExecuted: this.stats.yieldJobsExecuted,
                lastExecution: this.stats.lastYieldJobExecution,
                successRate: totalYieldJobs > 0 ? (successfulYieldJobs / totalYieldJobs * 100).toFixed(2) : 0,
                activeJobs: yieldJobs.active,
                scheduledJobs: yieldJobs.scheduled
            },
            jobs: yieldJobs.types,
            recentHistory: yieldHistory.slice(0, 10).map(job => ({
                id: job.id,
                type: job.type,
                status: job.status,
                executionTime: job.executionTime,
                createdAt: job.createdAt,
                error: job.error
            }))
        };
    }

    /**
     * Restart all yield management jobs (useful for configuration changes)
     */
    async restartYieldJobs() {
        logger.info('Restarting yield management jobs...');
        
        // Stop all yield jobs
        const pausedCount = this.pauseYieldJobs();
        
        // Wait a moment for jobs to stop
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Clear any existing yield job schedules
        const yieldJobIds = [];
        this.scheduledJobs.forEach((job, jobId) => {
            if (Object.values(JOB_TYPES).includes(job.type)) {
                yieldJobIds.push(jobId);
            }
        });
        
        yieldJobIds.forEach(jobId => {
            const job = this.scheduledJobs.get(jobId);
            if (job) {
                job.cronJob.destroy();
                this.scheduledJobs.delete(jobId);
            }
        });
        
        // Reschedule yield jobs with current configuration
        await this.scheduleDefaultYieldJobs();
        
        logger.info('Yield management jobs restarted successfully');
        this.emit('yield:jobs_restarted', { previousCount: pausedCount });
        
        return this.getYieldJobs();
    }

    /**
     * Get service status for health checks
     */
    getStatus() {
        return {
            initialized: this.initialized,
            isRunning: this.initialized,
            stats: this.getStatistics(),
            yieldManagement: this.getYieldManagementStatus(),
            health: 'operational'
        };
    }

    /**
     * Get active jobs information
     */
    getActiveJobs() {
        return Array.from(this.executingJobs.values()).map(job => ({
            id: job.id,
            type: job.type,
            priority: job.priority,
            startTime: job.startTime,
            duration: new Date() - job.startTime,
            attempts: job.attempts,
            isYieldJob: Object.values(JOB_TYPES).includes(job.type),
            status: job.status
        }));
    }

    /**
     * Graceful shutdown with yield jobs cleanup
     */
    async shutdown() {
        logger.info('Shutting down scheduler with yield management...');
        
        // Stop all recurring jobs
        this.scheduledJobs.forEach((job, jobId) => {
            if (job.isActive) {
                this.stopRecurringJob(jobId);
            }
        });

        // Wait for executing jobs to complete (with timeout)
        const shutdownTimeout = 30000; // 30 seconds
        const shutdownStart = Date.now();
        
        while (this.executingJobs.size > 0 && (Date.now() - shutdownStart) < shutdownTimeout) {
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        if (this.executingJobs.size > 0) {
            logger.warn(`Shutdown timeout: ${this.executingJobs.size} jobs still executing`);
            
            // Cancel remaining jobs
            this.executingJobs.forEach((job, jobId) => {
                job.status = 'cancelled';
                job.error = 'Shutdown timeout';
                this.addToHistory(job);
            });
            
            this.executingJobs.clear();
        }

        // Clean up resources
        this.scheduledJobs.clear();
        Object.keys(this.queues).forEach(priority => {
            this.queues[priority] = [];
        });

        this.initialized = false;
        
        logger.info('Scheduler shutdown completed');
        this.emit('shutdown:completed');
    }
}

// Create singleton instance
const schedulerService = new SchedulerService();

module.exports = schedulerService;