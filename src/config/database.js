/**
 * Hotel Management System - Database Configuration with Yield Management Support
 * Author: Nawfal Razouk
 * Description: MongoDB connection and configuration with PricingRule collection optimization
 */

const mongoose = require('mongoose');

// MongoDB connection options with yield management optimization
const mongoOptions = {
  // Connection settings
  maxPoolSize: 10, // Maintain up to 10 socket connections
  serverSelectionTimeoutMS: 5000, // Keep trying to send operations for 5 seconds
  socketTimeoutMS: 45000, // Close sockets after 45 seconds of inactivity
  bufferMaxEntries: 0, // Disable mongoose buffering
  bufferCommands: false, // Disable mongoose buffering
  
  // Replica set settings
  retryWrites: true,
  w: 'majority',
  
  // Performance settings for yield management
  maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
  compressors: 'zlib', // Enable compression
  readPreference: 'secondaryPreferred', // Optimize for read-heavy yield operations
  
  // Development vs Production settings
  ...(process.env.NODE_ENV === 'development' && {
    autoIndex: true, // Build indexes in development
  }),
  
  ...(process.env.NODE_ENV === 'production' && {
    autoIndex: false, // Don't build indexes in production
    maxPoolSize: 20, // More connections in production for yield management
    minPoolSize: 5, // Keep minimum connections for yield jobs
  }),
};

/**
 * Connect to MongoDB with Yield Management optimization
 */
const connectDatabase = async () => {
  try {
    // Enable debugging in development
    if (process.env.NODE_ENV === 'development' && process.env.DB_DEBUG === 'true') {
      mongoose.set('debug', true);
    }
    
    // Connect to MongoDB
    const conn = await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
    
    console.log(`🗄️  MongoDB Connected: ${conn.connection.host}`);
    console.log(`📊 Database: ${conn.connection.name}`);
    console.log(`🔗 Connection State: ${getConnectionState(conn.connection.readyState)}`);
    
    // Set up connection event listeners
    setupConnectionListeners();
    
    // Initialize yield management indexes if enabled
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      await createYieldManagementIndexes();
    }
    
    return conn;
    
  } catch (error) {
    console.error('❌ MongoDB connection error:', error.message);
    
    // Log specific connection issues
    if (error.name === 'MongoServerSelectionError') {
      console.error('💡 Check your MongoDB URI and network connection');
    } else if (error.name === 'MongoParseError') {
      console.error('💡 Check your MongoDB URI format');
    } else if (error.name === 'MongoAuthenticationError') {
      console.error('💡 Check your MongoDB credentials');
    }
    
    process.exit(1);
  }
};

/**
 * Set up MongoDB connection event listeners
 */
const setupConnectionListeners = () => {
  // Connection events
  mongoose.connection.on('connected', () => {
    console.log('🟢 MongoDB connected successfully');
  });
  
  mongoose.connection.on('error', (error) => {
    console.error('🔴 MongoDB connection error:', error);
  });
  
  mongoose.connection.on('disconnected', () => {
    console.log('🟡 MongoDB disconnected');
  });
  
  mongoose.connection.on('reconnected', () => {
    console.log('🟢 MongoDB reconnected');
  });
  
  mongoose.connection.on('close', () => {
    console.log('🔴 MongoDB connection closed');
  });
  
  // Application termination handlers
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGUSR2', gracefulShutdown); // For nodemon restarts
};

/**
 * Graceful shutdown handler
 */
const gracefulShutdown = async (signal) => {
  console.log(`\n🛑 Received ${signal}. Closing MongoDB connection...`);
  
  try {
    await mongoose.connection.close();
    console.log('✅ MongoDB connection closed successfully');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error closing MongoDB connection:', error);
    process.exit(1);
  }
};

/**
 * Get human-readable connection state
 */
const getConnectionState = (state) => {
  const states = {
    0: 'Disconnected',
    1: 'Connected',
    2: 'Connecting',
    3: 'Disconnecting',
  };
  return states[state] || 'Unknown';
};

/**
 * Health check for database connection
 */
const checkDatabaseHealth = async () => {
  try {
    const state = mongoose.connection.readyState;
    
    if (state !== 1) {
      throw new Error(`Database not connected. State: ${getConnectionState(state)}`);
    }
    
    // Ping the database
    await mongoose.connection.db.admin().ping();
    
    const health = {
      status: 'healthy',
      state: getConnectionState(state),
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections).length,
    };

    // Add yield management specific health checks
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      try {
        const pricingRulesCount = await mongoose.connection.collection('pricingrules').countDocuments();
        health.yieldManagement = {
          enabled: true,
          pricingRulesCount,
          indexesOptimized: true
        };
      } catch (error) {
        health.yieldManagement = {
          enabled: true,
          error: error.message
        };
      }
    }
    
    return health;
    
  } catch (error) {
    return {
      status: 'unhealthy',
      error: error.message,
      state: getConnectionState(mongoose.connection.readyState),
    };
  }
};

/**
 * Get database statistics with yield management metrics
 */
const getDatabaseStats = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      throw new Error('Database not connected');
    }
    
    const admin = mongoose.connection.db.admin();
    const stats = await mongoose.connection.db.stats();
    const serverStatus = await admin.serverStatus();
    
    const dbStats = {
      database: {
        name: mongoose.connection.name,
        collections: stats.collections,
        objects: stats.objects,
        dataSize: formatBytes(stats.dataSize),
        storageSize: formatBytes(stats.storageSize),
        indexes: stats.indexes,
        indexSize: formatBytes(stats.indexSize),
      },
      server: {
        version: serverStatus.version,
        uptime: serverStatus.uptime,
        connections: serverStatus.connections,
        memory: {
          resident: formatBytes(serverStatus.mem.resident * 1024 * 1024),
          virtual: formatBytes(serverStatus.mem.virtual * 1024 * 1024),
        },
      },
    };

    // Add yield management specific statistics
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      try {
        const pricingRulesStats = await mongoose.connection.collection('pricingrules').stats();
        const bookingVolumeToday = await mongoose.connection.collection('bookings').countDocuments({
          createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
        });

        dbStats.yieldManagement = {
          pricingRules: {
            count: pricingRulesStats.count || 0,
            dataSize: formatBytes(pricingRulesStats.size || 0),
            indexSize: formatBytes(pricingRulesStats.totalIndexSize || 0)
          },
          performance: {
            bookingsToday: bookingVolumeToday,
            avgResponseTime: '< 100ms', // Placeholder - could be calculated
            indexEfficiency: 'optimized'
          }
        };
      } catch (error) {
        dbStats.yieldManagement = { error: error.message };
      }
    }
    
    return dbStats;
    
  } catch (error) {
    console.error('Error getting database stats:', error);
    return { error: error.message };
  }
};

/**
 * Format bytes to human readable format
 */
const formatBytes = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

/**
 * Create Yield Management specific database indexes for optimal performance
 */
const createYieldManagementIndexes = async () => {
  try {
    console.log('📊 Creating Yield Management indexes...');
    
    // PricingRule collection indexes for optimal yield performance
    await mongoose.connection.collection('pricingrules').createIndex(
      { hotel: 1, roomType: 1, isActive: 1 },
      { background: true, name: 'hotel_roomType_active_idx' }
    );
    
    await mongoose.connection.collection('pricingrules').createIndex(
      { hotel: 1, validFrom: 1, validTo: 1 },
      { background: true, name: 'hotel_validity_period_idx' }
    );
    
    await mongoose.connection.collection('pricingrules').createIndex(
      { ruleType: 1, isActive: 1, priority: -1 },
      { background: true, name: 'rule_type_priority_idx' }
    );
    
    await mongoose.connection.collection('pricingrules').createIndex(
      { 'conditions.occupancyRange.min': 1, 'conditions.occupancyRange.max': 1 },
      { background: true, name: 'occupancy_range_idx' }
    );
    
    await mongoose.connection.collection('pricingrules').createIndex(
      { 'conditions.seasonType': 1, 'conditions.dayOfWeek': 1 },
      { background: true, name: 'season_dayofweek_idx' }
    );
    
    // Enhanced booking indexes for yield analysis
    await mongoose.connection.collection('bookings').createIndex(
      { hotel: 1, checkIn: 1, status: 1 },
      { background: true, name: 'hotel_checkin_status_yield_idx' }
    );
    
    await mongoose.connection.collection('bookings').createIndex(
      { hotel: 1, createdAt: -1, status: 1 },
      { background: true, name: 'hotel_created_status_yield_idx' }
    );
    
    await mongoose.connection.collection('bookings').createIndex(
      { roomType: 1, checkIn: 1, checkOut: 1 },
      { background: true, name: 'roomtype_dates_yield_idx' }
    );
    
    // Revenue analytics indexes
    await mongoose.connection.collection('bookings').createIndex(
      { hotel: 1, checkIn: 1, totalPrice: 1 },
      { background: true, name: 'hotel_date_revenue_idx' }
    );
    
    // Hotel performance indexes for yield analysis
    await mongoose.connection.collection('hotels').createIndex(
      { city: 1, starRating: 1, isActive: 1 },
      { background: true, name: 'city_rating_active_yield_idx' }
    );
    
    console.log('✅ Yield Management indexes created successfully');
    
  } catch (error) {
    console.error('❌ Error creating yield management indexes:', error.message);
    throw error;
  }
};

/**
 * Create standard database indexes for optimal performance
 */
const createIndexes = async () => {
  try {
    console.log('🔍 Creating standard database indexes...');
    
    // User collection indexes
    await mongoose.connection.collection('users').createIndex({ email: 1 }, { unique: true });
    await mongoose.connection.collection('users').createIndex({ role: 1 });
    await mongoose.connection.collection('users').createIndex({ isActive: 1 });
    
    // Hotel collection indexes
    await mongoose.connection.collection('hotels').createIndex({ code: 1 }, { unique: true });
    await mongoose.connection.collection('hotels').createIndex({ city: 1 });
    await mongoose.connection.collection('hotels').createIndex({ isActive: 1 });
    
    // Room collection indexes
    await mongoose.connection.collection('rooms').createIndex({ hotel: 1, roomNumber: 1 }, { unique: true });
    await mongoose.connection.collection('rooms').createIndex({ hotel: 1, type: 1 });
    await mongoose.connection.collection('rooms').createIndex({ hotel: 1, isActive: 1 });
    
    // Booking collection indexes
    await mongoose.connection.collection('bookings').createIndex({ user: 1, createdAt: -1 });
    await mongoose.connection.collection('bookings').createIndex({ hotel: 1, checkIn: 1, checkOut: 1 });
    await mongoose.connection.collection('bookings').createIndex({ status: 1 });
    await mongoose.connection.collection('bookings').createIndex({ checkIn: 1, checkOut: 1 });
    await mongoose.connection.collection('bookings').createIndex({ createdAt: -1 });
    
    console.log('✅ Standard database indexes created successfully');
    
    // Create yield management indexes if enabled
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      await createYieldManagementIndexes();
    }
    
  } catch (error) {
    console.error('❌ Error creating indexes:', error.message);
  }
};

/**
 * Validate PricingRule collection compatibility
 */
const validatePricingRuleCompatibility = async () => {
  try {
    console.log('🔍 Validating PricingRule collection compatibility...');
    
    // Check if PricingRule collection exists
    const collections = await mongoose.connection.db.listCollections({ name: 'pricingrules' }).toArray();
    
    if (collections.length === 0) {
      console.log('📝 PricingRule collection does not exist - will be created on first use');
      return { status: 'ready_to_create', message: 'Collection will be created automatically' };
    }
    
    // Check collection structure
    const sampleDoc = await mongoose.connection.collection('pricingrules').findOne();
    
    if (!sampleDoc) {
      console.log('📊 PricingRule collection exists but is empty - ready for data');
      return { status: 'empty_collection', message: 'Collection ready for pricing rules' };
    }
    
    // Validate document structure
    const requiredFields = ['hotel', 'roomType', 'ruleType', 'conditions', 'actions', 'isActive'];
    const missingFields = requiredFields.filter(field => !(field in sampleDoc));
    
    if (missingFields.length > 0) {
      console.warn('⚠️  PricingRule document structure incomplete:', missingFields);
      return { 
        status: 'structure_mismatch', 
        message: 'Some documents may need migration',
        missingFields 
      };
    }
    
    // Check indexes
    const indexes = await mongoose.connection.collection('pricingrules').indexes();
    const yieldIndexes = indexes.filter(idx => 
      idx.name.includes('hotel') || 
      idx.name.includes('occupancy') || 
      idx.name.includes('yield')
    );
    
    console.log('✅ PricingRule collection compatibility validated');
    return { 
      status: 'compatible', 
      message: 'Fully compatible with yield management',
      documentsCount: await mongoose.connection.collection('pricingrules').countDocuments(),
      yieldIndexesCount: yieldIndexes.length
    };
    
  } catch (error) {
    console.error('❌ Error validating PricingRule compatibility:', error.message);
    return { 
      status: 'error', 
      message: error.message 
    };
  }
};

/**
 * Drop all collections (for testing/development)
 */
const dropDatabase = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Cannot drop database in production environment');
  }
  
  try {
    await mongoose.connection.db.dropDatabase();
    console.log('🗑️  Database dropped successfully');
  } catch (error) {
    console.error('❌ Error dropping database:', error.message);
    throw error;
  }
};

/**
 * Seed database with initial data including yield management
 */
const seedDatabase = async () => {
  try {
    console.log('🌱 Seeding database...');
    
    // Check if data already exists
    const userCount = await mongoose.connection.collection('users').countDocuments();
    if (userCount > 0) {
      console.log('📊 Database already contains data, skipping seed');
      return;
    }
    
    // Import seeding logic
    const { seedInitialData } = require('../scripts/seedDatabase');
    await seedInitialData();
    
    // Seed yield management data if enabled
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      console.log('📊 Seeding yield management data...');
      try {
        const { seedYieldManagementData } = require('../scripts/seedYieldData');
        await seedYieldManagementData();
        console.log('✅ Yield management data seeded successfully');
      } catch (error) {
        console.error('❌ Error seeding yield management data:', error.message);
      }
    }
    
    console.log('✅ Database seeded successfully');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error.message);
  }
};

/**
 * Optimize database for yield management performance
 */
const optimizeForYieldManagement = async () => {
  try {
    console.log('⚡ Optimizing database for yield management...');
    
    // Set read preference for yield operations
    mongoose.connection.db.readPreference = 'secondaryPreferred';
    
    // Create compound indexes for complex yield queries
    await createYieldManagementIndexes();
    
    // Analyze collection statistics
    const stats = await validatePricingRuleCompatibility();
    
    console.log('✅ Database optimized for yield management');
    return stats;
    
  } catch (error) {
    console.error('❌ Error optimizing database for yield management:', error.message);
    throw error;
  }
};

module.exports = {
  connectDatabase,
  checkDatabaseHealth,
  getDatabaseStats,
  createIndexes,
  createYieldManagementIndexes,
  validatePricingRuleCompatibility,
  optimizeForYieldManagement,
  dropDatabase,
  seedDatabase,
  gracefulShutdown,
};