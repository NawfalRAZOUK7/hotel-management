/**
 * Real-time Configuration for Hotel Management System
 * Socket.io settings, performance tuning, and real-time features configuration
 */

const { logger } = require('../utils/logger');

// Environment-based configuration
const environment = process.env.NODE_ENV || 'development';
const isProduction = environment === 'production';
const isDevelopment = environment === 'development';

/**
 * Socket.io Server Configuration
 */
const socketConfig = {
    // CORS Configuration
    cors: {
        origin: process.env.CORS_ORIGIN ? 
            process.env.CORS_ORIGIN.split(',').map(origin => origin.trim()) : 
            ['http://localhost:4200', 'http://localhost:3000'],
        methods: ['GET', 'POST'],
        credentials: true,
        allowedHeaders: ['Content-Type', 'Authorization'],
        optionsSuccessStatus: 200
    },

    // Transport Configuration
    transports: ['websocket', 'polling'],
    
    // Connection Settings
    pingTimeout: parseInt(process.env.SOCKET_PING_TIMEOUT) || 60000, // 60 seconds
    pingInterval: parseInt(process.env.SOCKET_PING_INTERVAL) || 25000, // 25 seconds
    upgradeTimeout: parseInt(process.env.SOCKET_UPGRADE_TIMEOUT) || 10000, // 10 seconds
    maxHttpBufferSize: parseInt(process.env.SOCKET_MAX_BUFFER_SIZE) || 1e6, // 1MB
    
    // Connection Limits
    connectTimeout: parseInt(process.env.SOCKET_CONNECT_TIMEOUT) || 45000, // 45 seconds
    serveClient: isDevelopment, // Serve socket.io client in development only
    
    // Compression
    compression: isProduction, // Enable compression in production
    httpCompression: {
        threshold: 1024, // Compress responses larger than 1KB
        level: 6, // Compression level (1-9)
        chunkSize: 1024
    },

    // Performance Settings
    perMessageDeflate: {
        threshold: 1024,
        concurrencyLimit: 10,
        memLevel: 7
    },

    // Cookie Settings (for session persistence)
    cookie: {
        name: 'io',
        httpOnly: true,
        path: '/',
        secure: isProduction, // HTTPS only in production
        sameSite: isProduction ? 'strict' : 'lax'
    },

    // Engine.io Settings
    allowEIO3: false, // Disable Engine.io v3 for security
    destroyUpgrade: true,
    destroyUpgradeTimeout: 1000
};

/**
 * Real-time Features Configuration
 */
const realtimeFeatures = {
    // Live Availability Settings
    availability: {
        enabled: process.env.REALTIME_AVAILABILITY_ENABLED !== 'false',
        updateInterval: parseInt(process.env.AVAILABILITY_UPDATE_INTERVAL) || 5000, // 5 seconds
        batchSize: parseInt(process.env.AVAILABILITY_BATCH_SIZE) || 50,
        cacheTimeout: parseInt(process.env.AVAILABILITY_CACHE_TIMEOUT) || 30000, // 30 seconds
        throttleMs: parseInt(process.env.AVAILABILITY_THROTTLE) || 1000 // 1 second throttle
    },

    // Instant Booking Configuration
    booking: {
        enabled: process.env.REALTIME_BOOKING_ENABLED !== 'false',
        confirmationTimeout: parseInt(process.env.BOOKING_CONFIRMATION_TIMEOUT) || 300000, // 5 minutes
        validationTimeout: parseInt(process.env.BOOKING_VALIDATION_TIMEOUT) || 600000, // 10 minutes
        retryAttempts: parseInt(process.env.BOOKING_RETRY_ATTEMPTS) || 3,
        retryDelay: parseInt(process.env.BOOKING_RETRY_DELAY) || 5000, // 5 seconds
        queueLimit: parseInt(process.env.BOOKING_QUEUE_LIMIT) || 1000
    },

    // Admin Notifications Configuration
    admin: {
        enabled: process.env.REALTIME_ADMIN_ENABLED !== 'false',
        notificationBatchSize: parseInt(process.env.ADMIN_NOTIFICATION_BATCH_SIZE) || 20,
        priorityLevels: ['low', 'medium', 'high', 'critical'],
        autoRefreshInterval: parseInt(process.env.ADMIN_AUTO_REFRESH) || 15000, // 15 seconds
        dashboardUpdateInterval: parseInt(process.env.DASHBOARD_UPDATE_INTERVAL) || 10000 // 10 seconds
    },

    // Messaging & Chat Configuration
    messaging: {
        enabled: process.env.REALTIME_MESSAGING_ENABLED !== 'false',
        maxMessageLength: parseInt(process.env.MAX_MESSAGE_LENGTH) || 1000,
        typingTimeout: parseInt(process.env.TYPING_TIMEOUT) || 3000, // 3 seconds
        messageRetention: parseInt(process.env.MESSAGE_RETENTION) || 86400000, // 24 hours
        rateLimitMessages: parseInt(process.env.MESSAGE_RATE_LIMIT) || 60 // 60 messages per minute
    },

    // Service Requests Configuration
    serviceRequests: {
        enabled: process.env.REALTIME_SERVICE_REQUESTS_ENABLED !== 'false',
        priorityLevels: ['LOW', 'NORMAL', 'HIGH', 'URGENT'],
        responseTimeout: parseInt(process.env.SERVICE_REQUEST_TIMEOUT) || 1800000, // 30 minutes
        escalationTime: parseInt(process.env.SERVICE_ESCALATION_TIME) || 900000, // 15 minutes
        maxActiveRequests: parseInt(process.env.MAX_ACTIVE_SERVICE_REQUESTS) || 100
    }
};

/**
 * Performance and Scaling Configuration
 */
const performanceConfig = {
    // Connection Management
    maxConnections: parseInt(process.env.MAX_SOCKET_CONNECTIONS) || (isProduction ? 10000 : 1000),
    connectionLimit: {
        perUser: parseInt(process.env.MAX_CONNECTIONS_PER_USER) || 5,
        perIP: parseInt(process.env.MAX_CONNECTIONS_PER_IP) || 10,
        checkInterval: parseInt(process.env.CONNECTION_CHECK_INTERVAL) || 60000 // 1 minute
    },

    // Memory Management
    memoryThreshold: {
        warning: parseInt(process.env.MEMORY_WARNING_THRESHOLD) || 512, // MB
        critical: parseInt(process.env.MEMORY_CRITICAL_THRESHOLD) || 768, // MB
        cleanup: parseInt(process.env.MEMORY_CLEANUP_THRESHOLD) || 1024 // MB
    },

    // Rate Limiting
    rateLimiting: {
        enabled: process.env.SOCKET_RATE_LIMITING_ENABLED !== 'false',
        points: parseInt(process.env.SOCKET_RATE_LIMIT_POINTS) || 100,
        duration: parseInt(process.env.SOCKET_RATE_LIMIT_DURATION) || 60, // seconds
        blockDuration: parseInt(process.env.SOCKET_RATE_LIMIT_BLOCK) || 300, // 5 minutes
        skipSuccessfulRequests: true,
        skipFailedRequests: false
    },

    // Event Broadcasting Limits
    broadcasting: {
        maxRoomSize: parseInt(process.env.MAX_ROOM_SIZE) || 1000,
        broadcastTimeout: parseInt(process.env.BROADCAST_TIMEOUT) || 5000, // 5 seconds
        batchSize: parseInt(process.env.BROADCAST_BATCH_SIZE) || 100,
        throttleInterval: parseInt(process.env.BROADCAST_THROTTLE) || 100 // ms
    },

    // Redis Configuration (for scaling)
    redis: {
        enabled: process.env.REDIS_ENABLED === 'true',
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        db: parseInt(process.env.REDIS_DB) || 0,
        keyPrefix: process.env.REDIS_KEY_PREFIX || 'hotel_realtime:',
        retryDelayOnFailover: parseInt(process.env.REDIS_RETRY_DELAY) || 100,
        maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES) || 3,
        lazyConnect: true,
        keepAlive: 30000
    },

    // Clustering Configuration
    cluster: {
        enabled: process.env.CLUSTER_ENABLED === 'true',
        workers: parseInt(process.env.CLUSTER_WORKERS) || require('os').cpus().length,
        sticky: true, // Sticky sessions for Socket.io
        redisAdapter: process.env.REDIS_ENABLED === 'true'
    }
};

/**
 * Security Configuration
 */
const securityConfig = {
    // Authentication
    authentication: {
        required: process.env.SOCKET_AUTH_REQUIRED !== 'false',
        tokenHeader: 'authorization',
        tokenPrefix: 'Bearer ',
        tokenExpiry: parseInt(process.env.SOCKET_TOKEN_EXPIRY) || 86400, // 24 hours
        renewalThreshold: parseInt(process.env.TOKEN_RENEWAL_THRESHOLD) || 3600 // 1 hour
    },

    // Authorization
    authorization: {
        strictMode: isProduction,
        roleBasedAccess: true,
        roomPermissions: true,
        adminOnly: {
            rooms: ['admin-dashboard', 'system-alerts', 'admin-chat'],
            events: ['admin-notification', 'system-alert', 'user-management']
        }
    },

    // Input Validation
    validation: {
        sanitizeInput: true,
        maxEventData: parseInt(process.env.MAX_EVENT_DATA_SIZE) || 32768, // 32KB
        allowedEvents: [
            // Client events
            'join-room', 'leave-room', 'send-message', 'typing',
            'check-availability', 'service-request', 'booking-update',
            
            // Admin events
            'join-admin-room', 'admin-action', 'validate-booking',
            'update-status', 'broadcast-alert',
            
            // System events
            'heartbeat', 'disconnect', 'reconnect'
        ],
        eventRateLimit: {
            'send-message': 10, // per minute
            'service-request': 5,
            'check-availability': 30,
            'admin-action': 20
        }
    },

    // DDoS Protection
    ddosProtection: {
        enabled: isProduction,
        maxConnections: performanceConfig.maxConnections,
        checkInterval: 30000, // 30 seconds
        banDuration: 3600000, // 1 hour
        whitelist: process.env.IP_WHITELIST ? process.env.IP_WHITELIST.split(',') : [],
        blacklist: process.env.IP_BLACKLIST ? process.env.IP_BLACKLIST.split(',') : []
    }
};

/**
 * Monitoring and Logging Configuration
 */
const monitoringConfig = {
    // Metrics Collection
    metrics: {
        enabled: process.env.METRICS_ENABLED !== 'false',
        interval: parseInt(process.env.METRICS_INTERVAL) || 60000, // 1 minute
        retention: parseInt(process.env.METRICS_RETENTION) || 86400000, // 24 hours
        includeSystemMetrics: true,
        includeCustomMetrics: true
    },

    // Health Checks
    healthCheck: {
        enabled: true,
        interval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
        timeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT) || 5000, // 5 seconds
        endpoint: '/health/realtime',
        checks: ['memory', 'connections', 'redis', 'database']
    },

    // Logging Configuration
    logging: {
        level: process.env.REALTIME_LOG_LEVEL || (isDevelopment ? 'debug' : 'info'),
        includeEvents: isDevelopment,
        includeConnections: true,
        includeErrors: true,
        includePerformance: isProduction,
        rotateFiles: isProduction,
        maxFileSize: '100MB',
        maxFiles: 10
    },

    // Alerting
    alerting: {
        enabled: isProduction,
        thresholds: {
            connectionCount: performanceConfig.maxConnections * 0.8,
            memoryUsage: performanceConfig.memoryThreshold.warning,
            errorRate: 0.05, // 5%
            responseTime: 5000 // 5 seconds
        },
        webhookUrl: process.env.ALERT_WEBHOOK_URL,
        emailAlerts: process.env.ALERT_EMAIL_ENABLED === 'true'
    }
};

/**
 * Room Configuration
 */
const roomConfig = {
    // Default Rooms
    defaultRooms: {
        clients: 'clients',
        admins: 'admins',
        receptionists: 'receptionists',
        notifications: 'global-notifications'
    },

    // Room Limits
    limits: {
        maxRoomsPerUser: parseInt(process.env.MAX_ROOMS_PER_USER) || 10,
        maxUsersPerRoom: parseInt(process.env.MAX_USERS_PER_ROOM) || 1000,
        roomNameMaxLength: parseInt(process.env.ROOM_NAME_MAX_LENGTH) || 50,
        roomDescriptionMaxLength: parseInt(process.env.ROOM_DESC_MAX_LENGTH) || 200
    },

    // Room Types
    roomTypes: {
        booking: {
            prefix: 'booking-',
            persistent: false,
            autoJoin: false,
            maxUsers: 50
        },
        hotel: {
            prefix: 'hotel-',
            persistent: true,
            autoJoin: true,
            maxUsers: 500
        },
        admin: {
            prefix: 'admin-',
            persistent: true,
            autoJoin: false,
            maxUsers: 100,
            requiresPermission: true
        },
        user: {
            prefix: 'user-',
            persistent: false,
            autoJoin: true,
            maxUsers: 1
        }
    },

    // Room Management
    management: {
        autoCleanup: true,
        cleanupInterval: parseInt(process.env.ROOM_CLEANUP_INTERVAL) || 3600000, // 1 hour
        emptyRoomTimeout: parseInt(process.env.EMPTY_ROOM_TIMEOUT) || 300000, // 5 minutes
        maxIdleTime: parseInt(process.env.ROOM_MAX_IDLE_TIME) || 1800000 // 30 minutes
    }
};

/**
 * Get configuration based on feature
 */
function getConfig(feature = 'all') {
    const configs = {
        socket: socketConfig,
        features: realtimeFeatures,
        performance: performanceConfig,
        security: securityConfig,
        monitoring: monitoringConfig,
        rooms: roomConfig,
        all: {
            socket: socketConfig,
            features: realtimeFeatures,
            performance: performanceConfig,
            security: securityConfig,
            monitoring: monitoringConfig,
            rooms: roomConfig,
            environment: {
                nodeEnv: environment,
                isProduction,
                isDevelopment,
                version: process.env.npm_package_version || '1.0.0'
            }
        }
    };

    return configs[feature] || configs.all;
}

/**
 * Validate configuration
 */
function validateConfig() {
    const errors = [];
    const warnings = [];

    // Check required environment variables
    const requiredEnvVars = [
        'JWT_SECRET',
        'MONGODB_URI'
    ];

    requiredEnvVars.forEach(envVar => {
        if (!process.env[envVar]) {
            errors.push(`Missing required environment variable: ${envVar}`);
        }
    });

    // Check Redis configuration if enabled
    if (performanceConfig.redis.enabled) {
        if (!process.env.REDIS_HOST) {
            warnings.push('Redis enabled but REDIS_HOST not specified, using localhost');
        }
    }

    // Check production-specific settings
    if (isProduction) {
        if (!socketConfig.cookie.secure) {
            warnings.push('Production environment should use secure cookies');
        }
        
        if (socketConfig.cors.origin.includes('localhost')) {
            warnings.push('Production CORS allows localhost origins');
        }
    }

    // Log validation results
    if (errors.length > 0) {
        logger.error('Real-time configuration validation errors:', errors);
        throw new Error(`Configuration validation failed: ${errors.join(', ')}`);
    }

    if (warnings.length > 0) {
        logger.warn('Real-time configuration warnings:', warnings);
    }

    logger.info('Real-time configuration validation completed successfully');
    return true;
}

/**
 * Get Redis configuration for Socket.io adapter
 */
function getRedisAdapterConfig() {
    if (!performanceConfig.redis.enabled) {
        return null;
    }

    return {
        host: performanceConfig.redis.host,
        port: performanceConfig.redis.port,
        password: performanceConfig.redis.password,
        db: performanceConfig.redis.db,
        key: `${performanceConfig.redis.keyPrefix}adapter`,
        retryDelayOnFailover: performanceConfig.redis.retryDelayOnFailover,
        maxRetriesPerRequest: performanceConfig.redis.maxRetriesPerRequest
    };
}

/**
 * Export configuration
 */
module.exports = {
    // Main configuration getter
    getConfig,
    
    // Individual configurations
    socketConfig,
    realtimeFeatures,
    performanceConfig,
    securityConfig,
    monitoringConfig,
    roomConfig,
    
    // Utility functions
    validateConfig,
    getRedisAdapterConfig,
    
    // Environment info
    environment,
    isProduction,
    isDevelopment,
    
    // Constants
    constants: {
        EVENTS: {
            CONNECTION: 'connection',
            DISCONNECT: 'disconnect',
            JOIN_ROOM: 'join-room',
            LEAVE_ROOM: 'leave-room',
            NOTIFICATION: 'notification',
            BOOKING_UPDATE: 'booking-update',
            AVAILABILITY_UPDATE: 'availability-update',
            ADMIN_NOTIFICATION: 'admin-notification',
            SERVICE_REQUEST: 'service-request',
            MESSAGE: 'message',
            TYPING: 'typing',
            ERROR: 'error'
        },
        
        ROOMS: {
            CLIENTS: 'clients',
            ADMINS: 'admins',
            RECEPTIONISTS: 'receptionists',
            GLOBAL_NOTIFICATIONS: 'global-notifications'
        },
        
        PRIORITIES: {
            LOW: 'low',
            MEDIUM: 'medium',
            HIGH: 'high',
            CRITICAL: 'critical'
        },
        
        USER_ROLES: {
            CLIENT: 'CLIENT',
            RECEPTIONIST: 'RECEPTIONIST',
            ADMIN: 'ADMIN'
        }
    }
};