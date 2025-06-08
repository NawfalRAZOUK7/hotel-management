/**
 * Queue Service - Real-time Booking Queue Management
 * Handles booking queues, priority processing, and real-time queue management
 * Supports multiple queue types with different priorities and processing strategies
 */

const EventEmitter = require('events');
const Redis = require('redis');
const socketService = require('./socketService');
const notificationService = require('./notificationService');
const { logger } = require('../utils/logger');

class QueueService extends EventEmitter {
    constructor() {
        super();
        this.queues = new Map(); // In-memory queues for real-time processing
        this.redisClient = null;
        this.processors = new Map(); // Queue processors
        this.queueStats = new Map(); // Queue statistics
        
        // Queue configurations
        this.queueConfigs = {
            'booking-validation': {
                priority: 'HIGH',
                maxConcurrent: 5,
                timeout: 30000, // 30 seconds
                retryAttempts: 3,
                retryDelay: 5000
            },
            'payment-processing': {
                priority: 'CRITICAL',
                maxConcurrent: 10,
                timeout: 60000, // 1 minute
                retryAttempts: 5,
                retryDelay: 2000
            },
            'email-notifications': {
                priority: 'MEDIUM',
                maxConcurrent: 20,
                timeout: 15000, // 15 seconds
                retryAttempts: 2,
                retryDelay: 3000
            },
            'sms-notifications': {
                priority: 'MEDIUM',
                maxConcurrent: 15,
                timeout: 10000, // 10 seconds
                retryAttempts: 3,
                retryDelay: 2000
            },
            'availability-updates': {
                priority: 'HIGH',
                maxConcurrent: 30,
                timeout: 5000, // 5 seconds
                retryAttempts: 1,
                retryDelay: 1000
            },
            'admin-alerts': {
                priority: 'CRITICAL',
                maxConcurrent: 5,
                timeout: 10000, // 10 seconds
                retryAttempts: 2,
                retryDelay: 1000
            },
            'background-reports': {
                priority: 'LOW',
                maxConcurrent: 2,
                timeout: 300000, // 5 minutes
                retryAttempts: 1,
                retryDelay: 60000
            },
            'cleanup-tasks': {
                priority: 'LOW',
                maxConcurrent: 1,
                timeout: 600000, // 10 minutes
                retryAttempts: 1,
                retryDelay: 300000
            }
        };

        this.initialize();
    }

    /**
     * Initialize queue service with Redis connection
     */
    async initialize() {
        try {
            // Initialize Redis client for persistent queues
            if (process.env.REDIS_URL) {
                this.redisClient = Redis.createClient({
                    url: process.env.REDIS_URL
                });
                
                await this.redisClient.connect();
                logger.info('Queue Service: Redis connected successfully');
            }

            // Initialize in-memory queues
            Object.keys(this.queueConfigs).forEach(queueName => {
                this.queues.set(queueName, []);
                this.queueStats.set(queueName, {
                    processed: 0,
                    failed: 0,
                    pending: 0,
                    lastProcessed: null,
                    averageProcessingTime: 0
                });
            });

            // Start queue processors
            this.startQueueProcessors();

            // Setup event listeners
            this.setupEventListeners();

            logger.info('Queue Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize Queue Service:', error);
            throw error;
        }
    }

    /**
     * Add job to queue with priority handling
     * @param {String} queueName - Name of the queue
     * @param {Object} jobData - Job data to process
     * @param {Object} options - Job options (priority, delay, etc.)
     */
    async addJob(queueName, jobData, options = {}) {
        try {
            if (!this.queueConfigs[queueName]) {
                throw new Error(`Unknown queue: ${queueName}`);
            }

            const job = {
                id: this.generateJobId(),
                queueName,
                data: jobData,
                priority: options.priority || this.queueConfigs[queueName].priority,
                attempts: 0,
                maxAttempts: options.maxAttempts || this.queueConfigs[queueName].retryAttempts,
                delay: options.delay || 0,
                timeout: options.timeout || this.queueConfigs[queueName].timeout,
                createdAt: new Date(),
                scheduledAt: new Date(Date.now() + (options.delay || 0)),
                status: 'PENDING',
                metadata: options.metadata || {}
            };

            // Add to appropriate queue based on priority and delay
            if (job.delay > 0) {
                await this.scheduleDelayedJob(job);
            } else {
                await this.addToQueue(queueName, job);
            }

            // Emit job added event
            this.emit('job:added', { queueName, jobId: job.id, job });

            // Notify real-time dashboard
            this.broadcastQueueUpdate(queueName);

            logger.info(`Job ${job.id} added to queue ${queueName}`);
            return job.id;

        } catch (error) {
            logger.error('Failed to add job to queue:', error);
            throw error;
        }
    }

    /**
     * Add job to in-memory queue with priority sorting
     */
    async addToQueue(queueName, job) {
        const queue = this.queues.get(queueName);
        
        // Insert job based on priority
        const priorityOrder = { 'CRITICAL': 0, 'HIGH': 1, 'MEDIUM': 2, 'LOW': 3 };
        const jobPriority = priorityOrder[job.priority] || 2;
        
        let insertIndex = queue.length;
        for (let i = 0; i < queue.length; i++) {
            if (priorityOrder[queue[i].priority] > jobPriority) {
                insertIndex = i;
                break;
            }
        }
        
        queue.splice(insertIndex, 0, job);
        
        // Update stats
        const stats = this.queueStats.get(queueName);
        stats.pending = queue.length;
        
        // Persist to Redis if available
        if (this.redisClient) {
            await this.redisClient.lPush(`queue:${queueName}`, JSON.stringify(job));
        }
    }

    /**
     * Schedule delayed job execution
     */
    async scheduleDelayedJob(job) {
        setTimeout(async () => {
            await this.addToQueue(job.queueName, job);
        }, job.delay);
        
        logger.info(`Job ${job.id} scheduled for execution in ${job.delay}ms`);
    }

    /**
     * Start queue processors for all configured queues
     */
    startQueueProcessors() {
        Object.keys(this.queueConfigs).forEach(queueName => {
            const config = this.queueConfigs[queueName];
            
            // Start multiple concurrent processors based on configuration
            for (let i = 0; i < config.maxConcurrent; i++) {
                this.startQueueProcessor(queueName, i);
            }
        });
    }

    /**
     * Start individual queue processor
     */
    async startQueueProcessor(queueName, processorId) {
        const processJob = async () => {
            try {
                const job = await this.getNextJob(queueName);
                if (!job) {
                    // No jobs available, wait and try again
                    setTimeout(processJob, 1000);
                    return;
                }

                // Process the job
                await this.executeJob(job);
                
                // Continue processing
                setImmediate(processJob);

            } catch (error) {
                logger.error(`Queue processor ${queueName}:${processorId} error:`, error);
                // Continue processing after error
                setTimeout(processJob, 5000);
            }
        };

        // Start processing
        processJob();
        logger.info(`Queue processor ${queueName}:${processorId} started`);
    }

    /**
     * Get next job from queue (priority-based)
     */
    async getNextJob(queueName) {
        const queue = this.queues.get(queueName);
        if (!queue || queue.length === 0) {
            return null;
        }

        // Get job with highest priority (first in queue due to sorting)
        const job = queue.shift();
        
        // Update stats
        const stats = this.queueStats.get(queueName);
        stats.pending = queue.length;
        
        return job;
    }

    /**
     * Execute job with timeout and retry logic
     */
    async executeJob(job) {
        const startTime = Date.now();
        job.status = 'PROCESSING';
        job.startedAt = new Date();
        job.attempts++;

        try {
            // Emit job started event
            this.emit('job:started', { jobId: job.id, job });

            // Execute job with timeout
            const result = await this.executeWithTimeout(job);
            
            // Job completed successfully
            job.status = 'COMPLETED';
            job.completedAt = new Date();
            job.result = result;
            
            const processingTime = Date.now() - startTime;
            this.updateStats(job.queueName, 'completed', processingTime);
            
            // Emit job completed event
            this.emit('job:completed', { jobId: job.id, job, result });
            
            logger.info(`Job ${job.id} completed successfully in ${processingTime}ms`);

        } catch (error) {
            // Job failed
            job.status = 'FAILED';
            job.error = error.message;
            job.failedAt = new Date();
            
            // Retry logic
            if (job.attempts < job.maxAttempts) {
                job.status = 'RETRYING';
                const retryDelay = this.calculateRetryDelay(job);
                
                logger.warn(`Job ${job.id} failed, retrying in ${retryDelay}ms (attempt ${job.attempts}/${job.maxAttempts})`);
                
                // Schedule retry
                setTimeout(async () => {
                    await this.addToQueue(job.queueName, job);
                }, retryDelay);
                
                this.emit('job:retry', { jobId: job.id, job, attempt: job.attempts });
            } else {
                // Max retries exceeded
                this.updateStats(job.queueName, 'failed');
                this.emit('job:failed', { jobId: job.id, job, error });
                
                logger.error(`Job ${job.id} failed permanently after ${job.attempts} attempts:`, error);
                
                // Handle permanent failure
                await this.handlePermanentFailure(job, error);
            }
        }

        // Broadcast queue update
        this.broadcastQueueUpdate(job.queueName);
    }

    /**
     * Execute job with timeout protection
     */
    async executeWithTimeout(job) {
        return new Promise(async (resolve, reject) => {
            // Set timeout
            const timeoutId = setTimeout(() => {
                reject(new Error(`Job ${job.id} timed out after ${job.timeout}ms`));
            }, job.timeout);

            try {
                // Execute job based on type
                const result = await this.processJobByType(job);
                clearTimeout(timeoutId);
                resolve(result);
            } catch (error) {
                clearTimeout(timeoutId);
                reject(error);
            }
        });
    }

    /**
     * Process job based on queue type
     */
    async processJobByType(job) {
        switch (job.queueName) {
            case 'booking-validation':
                return await this.processBookingValidation(job);
                
            case 'payment-processing':
                return await this.processPayment(job);
                
            case 'email-notifications':
                return await this.processEmailNotification(job);
                
            case 'sms-notifications':
                return await this.processSMSNotification(job);
                
            case 'availability-updates':
                return await this.processAvailabilityUpdate(job);
                
            case 'admin-alerts':
                return await this.processAdminAlert(job);
                
            case 'background-reports':
                return await this.processBackgroundReport(job);
                
            case 'cleanup-tasks':
                return await this.processCleanupTask(job);
                
            default:
                throw new Error(`Unknown job type: ${job.queueName}`);
        }
    }

    /**
     * Job processors for different queue types
     */
    async processBookingValidation(job) {
        const { bookingId, adminId, action, comment } = job.data;
        
        // Simulate booking validation logic
        logger.info(`Processing booking validation: ${bookingId}, action: ${action}`);
        
        // Emit notification to user
        notificationService.emit('booking:' + action.toLowerCase(), {
            bookingId,
            adminId,
            comment
        });
        
        // Broadcast to admin dashboard
        socketService.sendAdminNotification('booking-validated', {
            bookingId,
            action,
            processedBy: adminId
        });
        
        return { bookingId, action, processedAt: new Date() };
    }

    async processPayment(job) {
        const { bookingId, amount, paymentMethod, userId } = job.data;
        
        logger.info(`Processing payment: ${bookingId}, amount: ${amount}`);
        
        // Simulate payment processing
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Emit payment processed event
        notificationService.emit('payment:received', {
            bookingId,
            userId,
            amount,
            paymentMethod
        });
        
        return { transactionId: `tx_${Date.now()}`, amount, status: 'completed' };
    }

    async processEmailNotification(job) {
        const { type, userId, data } = job.data;
        
        logger.info(`Processing email notification: ${type} for user ${userId}`);
        
        // Send notification through notification service
        await notificationService.sendNotification({
            type,
            userId,
            channels: ['email'],
            data
        });
        
        return { sent: true, type, userId };
    }

    async processSMSNotification(job) {
        const { type, userId, data } = job.data;
        
        logger.info(`Processing SMS notification: ${type} for user ${userId}`);
        
        // Send notification through notification service
        await notificationService.sendNotification({
            type,
            userId,
            channels: ['sms'],
            data
        });
        
        return { sent: true, type, userId };
    }

    async processAvailabilityUpdate(job) {
        const { hotelId, roomType, availabilityData } = job.data;
        
        logger.info(`Processing availability update: ${hotelId}, ${roomType}`);
        
        // Broadcast availability update
        socketService.broadcastAvailabilityUpdate(hotelId, {
            roomType,
            ...availabilityData
        });
        
        return { updated: true, hotelId, roomType };
    }

    async processAdminAlert(job) {
        const { alertType, data, severity } = job.data;
        
        logger.info(`Processing admin alert: ${alertType}, severity: ${severity}`);
        
        // Send to all admins
        socketService.sendAdminNotification(alertType, {
            ...data,
            severity,
            timestamp: new Date()
        });
        
        return { alerted: true, alertType, severity };
    }

    async processBackgroundReport(job) {
        const { reportType, parameters } = job.data;
        
        logger.info(`Processing background report: ${reportType}`);
        
        // Simulate report generation
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        return { reportGenerated: true, type: reportType, completedAt: new Date() };
    }

    async processCleanupTask(job) {
        const { taskType, parameters } = job.data;
        
        logger.info(`Processing cleanup task: ${taskType}`);
        
        // Simulate cleanup task
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return { cleaned: true, type: taskType, itemsProcessed: Math.floor(Math.random() * 100) };
    }

    /**
     * Handle permanent job failure
     */
    async handlePermanentFailure(job, error) {
        // Log to dead letter queue
        if (this.redisClient) {
            await this.redisClient.lPush(`dlq:${job.queueName}`, JSON.stringify({
                job,
                error: error.message,
                failedAt: new Date()
            }));
        }

        // Notify admins for critical jobs
        if (job.priority === 'CRITICAL') {
            socketService.sendAdminNotification('job-failed', {
                jobId: job.id,
                queueName: job.queueName,
                error: error.message,
                attempts: job.attempts
            });
        }
    }

    /**
     * Calculate retry delay with exponential backoff
     */
    calculateRetryDelay(job) {
        const baseDelay = this.queueConfigs[job.queueName].retryDelay;
        return baseDelay * Math.pow(2, job.attempts - 1);
    }

    /**
     * Update queue statistics
     */
    updateStats(queueName, type, processingTime = null) {
        const stats = this.queueStats.get(queueName);
        
        if (type === 'completed') {
            stats.processed++;
            if (processingTime) {
                stats.averageProcessingTime = 
                    (stats.averageProcessingTime * (stats.processed - 1) + processingTime) / stats.processed;
            }
            stats.lastProcessed = new Date();
        } else if (type === 'failed') {
            stats.failed++;
        }
    }

    /**
     * Broadcast queue updates to real-time dashboard
     */
    broadcastQueueUpdate(queueName) {
        const stats = this.queueStats.get(queueName);
        const queue = this.queues.get(queueName);
        
        socketService.sendAdminNotification('queue-update', {
            queueName,
            stats: {
                ...stats,
                pending: queue.length
            },
            timestamp: new Date()
        });
    }

    /**
     * Setup event listeners
     */
    setupEventListeners() {
        // Listen for booking events
        notificationService.on('booking:created', (data) => {
            this.addJob('booking-validation', data, { priority: 'HIGH' });
        });

        // Listen for payment events
        notificationService.on('payment:pending', (data) => {
            this.addJob('payment-processing', data, { priority: 'CRITICAL' });
        });

        // Listen for notification events
        this.on('notification:email', (data) => {
            this.addJob('email-notifications', data, { priority: 'MEDIUM' });
        });

        this.on('notification:sms', (data) => {
            this.addJob('sms-notifications', data, { priority: 'MEDIUM' });
        });
    }

    /**
     * Utility methods
     */
    generateJobId() {
        return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Get queue statistics
     */
    getQueueStats(queueName = null) {
        if (queueName) {
            const stats = this.queueStats.get(queueName);
            const queue = this.queues.get(queueName);
            return {
                ...stats,
                pending: queue ? queue.length : 0
            };
        }
        
        const allStats = {};
        for (const [name, stats] of this.queueStats.entries()) {
            const queue = this.queues.get(name);
            allStats[name] = {
                ...stats,
                pending: queue ? queue.length : 0
            };
        }
        return allStats;
    }

    /**
     * Pause/Resume queue processing
     */
    pauseQueue(queueName) {
        // Implementation for pausing queue
        logger.info(`Queue ${queueName} paused`);
    }

    resumeQueue(queueName) {
        // Implementation for resuming queue
        logger.info(`Queue ${queueName} resumed`);
    }

    /**
     * Clear queue
     */
    async clearQueue(queueName) {
        const queue = this.queues.get(queueName);
        if (queue) {
            queue.length = 0;
            this.queueStats.get(queueName).pending = 0;
            
            if (this.redisClient) {
                await this.redisClient.del(`queue:${queueName}`);
            }
            
            logger.info(`Queue ${queueName} cleared`);
        }
    }

    /**
     * Graceful shutdown
     */
    async shutdown() {
        logger.info('Queue Service shutting down...');
        
        // Wait for current jobs to complete (with timeout)
        const shutdownTimeout = 30000; // 30 seconds
        const startTime = Date.now();
        
        while (Date.now() - startTime < shutdownTimeout) {
            let allEmpty = true;
            for (const queue of this.queues.values()) {
                if (queue.length > 0) {
                    allEmpty = false;
                    break;
                }
            }
            
            if (allEmpty) break;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        // Close Redis connection
        if (this.redisClient) {
            await this.redisClient.quit();
        }
        
        logger.info('Queue Service shutdown completed');
    }
}

// Create singleton instance
const queueService = new QueueService();

module.exports = queueService;