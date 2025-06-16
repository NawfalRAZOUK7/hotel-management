/**
 * REDIS CONFIGURATION - PRODUCTION READY
 * Configuration complète Redis avec retry logic, health checks et monitoring
 * 
 * Fonctionnalités :
 * - Client Redis avec reconnexion automatique
 * - Retry logic intelligent avec backoff exponentiel
 * - Health checks et monitoring
 * - Error handling robuste
 * - Events management pour debugging
 * - Connection pooling pour performance
 * - Graceful shutdown
 */

const redis = require('redis');
const EventEmitter = require('events');

class RedisConfig extends EventEmitter {
  constructor() {
    super();
    
    // Configuration
    this.config = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || null,
      db: parseInt(process.env.REDIS_DB) || 0,
      
      // Connection settings
      connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT) || 10000,
      lazyConnect: true,
      
      // Retry configuration
      maxRetriesPerRequest: 5,
      retryDelayOnFailover: 500,
      maxRetryDelay: 5000,
      
      // Health check settings
      healthCheckInterval: parseInt(process.env.REDIS_HEALTH_CHECK_INTERVAL) || 30000, // 30 seconds
      healthCheckTimeout: 5000,
      
      // Performance settings
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'hotel:',
      enableOfflineQueue: false
    };
    
    // State management
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.connectionAttempts = 0;
    this.maxConnectionAttempts = parseInt(process.env.REDIS_MAX_RETRIES) || 10;
    this.lastConnectionError = null;
    this.healthCheckTimer = null;
    this.connectionStats = {
      totalConnections: 0,
      totalDisconnections: 0,
      totalErrors: 0,
      lastConnectedAt: null,
      lastDisconnectedAt: null,
      uptime: 0
    };
    
    // Bind methods
    this.connect = this.connect.bind(this);
    this.disconnect = this.disconnect.bind(this);
    this.healthCheck = this.healthCheck.bind(this);
    this.handleConnectionEvents = this.handleConnectionEvents.bind(this);
  }

  /**
   * ================================
   * CONNECTION MANAGEMENT
   * ================================
   */

  /**
   * Établit la connexion Redis avec retry logic
   */
  async connect() {
    if (this.isConnected) {
      console.log('✅ Redis already connected');
      return this.client;
    }

    if (this.isConnecting) {
      console.log('⏳ Redis connection in progress...');
      return new Promise((resolve, reject) => {
        this.once('connected', resolve);
        this.once('connection_failed', reject);
      });
    }

    this.isConnecting = true;
    console.log(`🔄 Connecting to Redis at ${this.config.host}:${this.config.port}...`);

    try {
      // Create Redis client with configuration
      this.client = redis.createClient({
        socket: {
          host: this.config.host,
          port: this.config.port,
          connectTimeout: this.config.connectTimeout,
          lazyConnect: this.config.lazyConnect,
          reconnectStrategy: (retries) => this.getReconnectDelay(retries)
        },
        password: this.config.password,
        database: this.config.db,
        
        // Performance options
        isolationPoolOptions: {
          min: 2,
          max: 10
        }
      });

      // Setup event handlers
      this.handleConnectionEvents();

      // Attempt connection
      await this.client.connect();
      
      return this.client;

    } catch (error) {
      this.isConnecting = false;
      this.lastConnectionError = error;
      this.connectionStats.totalErrors++;
      
      console.error('❌ Redis connection failed:', error.message);
      
      // Emit error event
      this.emit('connection_failed', error);
      
      // Retry logic
      if (this.connectionAttempts < this.maxConnectionAttempts) {
        const retryDelay = this.getRetryDelay();
        console.log(`🔄 Retrying Redis connection in ${retryDelay}ms (attempt ${this.connectionAttempts + 1}/${this.maxConnectionAttempts})`);
        
        setTimeout(() => {
          this.connectionAttempts++;
          this.connect();
        }, retryDelay);
      } else {
        console.error(`💥 Redis connection failed after ${this.maxConnectionAttempts} attempts`);
        this.emit('max_retries_reached', error);
        throw new Error(`Redis connection failed after ${this.maxConnectionAttempts} attempts: ${error.message}`);
      }
    }
  }

  /**
   * Ferme la connexion Redis proprement
   */
  async disconnect() {
    if (!this.client) {
      console.log('✅ Redis client already disconnected');
      return;
    }

    console.log('🔄 Disconnecting from Redis...');

    try {
      // Stop health checks
      this.stopHealthCheck();

      // Close connection gracefully
      if (this.isConnected) {
        await this.client.quit();
      } else {
        await this.client.disconnect();
      }

      this.client = null;
      this.isConnected = false;
      this.isConnecting = false;
      
      this.connectionStats.totalDisconnections++;
      this.connectionStats.lastDisconnectedAt = new Date();

      console.log('✅ Redis disconnected successfully');
      this.emit('disconnected');

    } catch (error) {
      console.error('❌ Error during Redis disconnection:', error.message);
      
      // Force close if graceful shutdown fails
      if (this.client) {
        try {
          await this.client.disconnect();
        } catch (forceError) {
          console.error('❌ Force disconnect also failed:', forceError.message);
        }
      }
      
      this.client = null;
      this.isConnected = false;
      
      throw error;
    }
  }

  /**
   * ================================
   * EVENT HANDLING
   * ================================
   */

  /**
   * Configure les event handlers pour le client Redis
   */
  handleConnectionEvents() {
    if (!this.client) return;

    // Connection successful
    this.client.on('connect', () => {
      console.log('🔗 Redis client connecting...');
    });

    this.client.on('ready', () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.connectionAttempts = 0;
      this.lastConnectionError = null;
      
      this.connectionStats.totalConnections++;
      this.connectionStats.lastConnectedAt = new Date();
      
      console.log('✅ Redis connected and ready');
      
      // Start health checks
      this.startHealthCheck();
      
      this.emit('connected', this.client);
    });

    // Connection lost
    this.client.on('end', () => {
      this.isConnected = false;
      this.connectionStats.lastDisconnectedAt = new Date();
      
      console.log('🔌 Redis connection ended');
      this.emit('disconnected');
    });

    // Errors
    this.client.on('error', (error) => {
      this.isConnected = false;
      this.lastConnectionError = error;
      this.connectionStats.totalErrors++;
      
      console.error('❌ Redis error:', error.message);
      this.emit('error', error);
      
      // Log critical errors
      if (error.code === 'ECONNREFUSED') {
        console.error('💥 Redis server connection refused - check if Redis is running');
      } else if (error.code === 'ENOTFOUND') {
        console.error('💥 Redis server not found - check host configuration');
      } else if (error.code === 'ETIMEDOUT') {
        console.error('💥 Redis connection timeout - check network connectivity');
      }
    });

    // Reconnecting
    this.client.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
      this.emit('reconnecting');
    });
  }

  /**
   * ================================
   * RETRY LOGIC
   * ================================
   */

  /**
   * Calcule le délai de retry avec backoff exponentiel
   */
  getRetryDelay() {
    const baseDelay = 1000; // 1 second
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, this.connectionAttempts), this.config.maxRetryDelay);
    const jitter = Math.random() * 1000; // Add jitter to prevent thundering herd
    
    return exponentialDelay + jitter;
  }

  /**
   * Strategy de reconnexion pour le client Redis
   */
  getReconnectDelay(retries) {
    if (retries > this.maxConnectionAttempts) {
      console.error(`💥 Redis max reconnection attempts reached (${retries})`);
      return new Error('Max reconnection attempts reached');
    }

    const delay = Math.min(retries * 50, 500);
    console.log(`🔄 Redis reconnecting in ${delay}ms (attempt ${retries})`);
    
    return delay;
  }

  /**
   * ================================
   * HEALTH CHECKS
   * ================================
   */

  /**
   * Démarre les health checks périodiques
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(async () => {
      try {
        await this.healthCheck();
      } catch (error) {
        console.error('❌ Health check failed:', error.message);
      }
    }, this.config.healthCheckInterval);

    console.log(`💓 Redis health checks started (interval: ${this.config.healthCheckInterval}ms)`);
  }

  /**
   * Arrête les health checks
   */
  stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      console.log('🛑 Redis health checks stopped');
    }
  }

  /**
   * Effectue un health check de la connexion Redis
   */
  async healthCheck() {
    if (!this.client || !this.isConnected) {
      throw new Error('Redis client not connected');
    }

    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      const pingResult = await Promise.race([
        this.client.ping(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Health check timeout')), this.config.healthCheckTimeout)
        )
      ]);

      const responseTime = Date.now() - startTime;

      if (pingResult !== 'PONG') {
        throw new Error(`Unexpected ping response: ${pingResult}`);
      }

      // Test basic operations
      const testKey = `${this.config.keyPrefix}health_check:${Date.now()}`;
      await this.client.set(testKey, 'ok', { EX: 10 });
      const testValue = await this.client.get(testKey);
      await this.client.del(testKey);

      if (testValue !== 'ok') {
        throw new Error('Redis read/write test failed');
      }

      // Update uptime
      if (this.connectionStats.lastConnectedAt) {
        this.connectionStats.uptime = Date.now() - this.connectionStats.lastConnectedAt.getTime();
      }

      // Emit health check success
      this.emit('health_check_success', {
        responseTime,
        timestamp: new Date(),
        uptime: this.connectionStats.uptime
      });

      return {
        status: 'healthy',
        responseTime,
        uptime: this.connectionStats.uptime,
        timestamp: new Date()
      };

    } catch (error) {
      this.emit('health_check_failed', {
        error: error.message,
        responseTime: Date.now() - startTime,
        timestamp: new Date()
      });

      throw error;
    }
  }

  /**
   * ================================
   * CLIENT ACCESS & UTILITIES
   * ================================
   */

  /**
   * Retourne le client Redis (avec vérification de connexion)
   */
  getClient() {
    if (!this.client) {
      throw new Error('Redis client not initialized');
    }

    if (!this.isConnected) {
      throw new Error('Redis client not connected');
    }

    return this.client;
  }

  /**
   * Vérifie si Redis est connecté
   */
  isReady() {
    return this.isConnected && this.client && this.client.isReady;
  }

  /**
   * Execute une commande avec retry automatique
   */
  async executeWithRetry(operation, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        if (!this.isReady()) {
          await this.connect();
        }
        
        return await operation(this.client);
        
      } catch (error) {
        lastError = error;
        console.error(`❌ Redis operation failed (attempt ${attempt}/${maxRetries}):`, error.message);
        
        if (attempt < maxRetries) {
          const delay = Math.min(attempt * 500, 2000);
          console.log(`🔄 Retrying Redis operation in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw new Error(`Redis operation failed after ${maxRetries} attempts: ${lastError.message}`);
  }

  /**
   * ================================
   * MONITORING & STATS
   * ================================
   */

  /**
   * Retourne les statistiques de connexion
   */
  getConnectionStats() {
    return {
      ...this.connectionStats,
      isConnected: this.isConnected,
      isConnecting: this.isConnecting,
      connectionAttempts: this.connectionAttempts,
      lastConnectionError: this.lastConnectionError?.message || null,
      config: {
        host: this.config.host,
        port: this.config.port,
        db: this.config.db,
        keyPrefix: this.config.keyPrefix
      }
    };
  }

  /**
   * Retourne les informations de santé Redis
   */
  async getHealthInfo() {
    try {
      if (!this.isReady()) {
        return {
          status: 'disconnected',
          error: 'Redis not connected'
        };
      }

      // Get Redis info
      const info = await this.client.info();
      const memory = await this.client.info('memory');
      const stats = await this.client.info('stats');

      return {
        status: 'healthy',
        connection: this.getConnectionStats(),
        server: this.parseRedisInfo(info),
        memory: this.parseRedisInfo(memory),
        stats: this.parseRedisInfo(stats),
        lastHealthCheck: await this.healthCheck()
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        connection: this.getConnectionStats()
      };
    }
  }

  /**
   * Parse les informations Redis
   */
  parseRedisInfo(info) {
    const parsed = {};
    const lines = info.split('\r\n');
    
    lines.forEach(line => {
      if (line && !line.startsWith('#') && line.includes(':')) {
        const [key, value] = line.split(':');
        parsed[key] = isNaN(value) ? value : Number(value);
      }
    });
    
    return parsed;
  }

  /**
   * ================================
   * GRACEFUL SHUTDOWN
   * ================================
   */

  /**
   * Arrêt propre du service Redis
   */
  async gracefulShutdown() {
    console.log('🔄 Redis graceful shutdown initiated...');
    
    try {
      // Stop health checks
      this.stopHealthCheck();
      
      // Wait for pending operations to complete
      if (this.client && this.isConnected) {
        console.log('⏳ Waiting for pending Redis operations...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Disconnect
      await this.disconnect();
      
      console.log('✅ Redis graceful shutdown completed');
      
    } catch (error) {
      console.error('❌ Error during Redis graceful shutdown:', error.message);
      throw error;
    }
  }
}

// Create singleton instance
const redisConfig = new RedisConfig();

// Handle process termination
process.on('SIGTERM', async () => {
  console.log('📡 SIGTERM received, shutting down Redis...');
  try {
    await redisConfig.gracefulShutdown();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during Redis shutdown:', error);
    process.exit(1);
  }
});

process.on('SIGINT', async () => {
  console.log('📡 SIGINT received, shutting down Redis...');
  try {
    await redisConfig.gracefulShutdown();
    process.exit(0);
  } catch (error) {
    console.error('❌ Error during Redis shutdown:', error);
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught exception:', error);
  try {
    await redisConfig.gracefulShutdown();
  } catch (shutdownError) {
    console.error('❌ Error during emergency shutdown:', shutdownError);
  }
  process.exit(1);
});

module.exports = redisConfig;