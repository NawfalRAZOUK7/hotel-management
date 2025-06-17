#!/usr/bin/env node

/**
 * Hotel Management System - Main Server Entry Point
 * Author: Nawfal Razouk
 * Description: Main server file with advanced real-time features + Yield Management
 */

console.log('=== DEBUT EXECUTION SERVER.JS ===');
console.log('process.env.NODE_ENV =', process.env.NODE_ENV);
console.log('process.env.MONGODB_URI =', process.env.MONGODB_URI);
console.log('process.cwd() =', process.cwd());

// Load environment variables first
require('dotenv').config();
console.log('✅ dotenv chargé');

console.log('🟢 Après chargement .env: process.env.NODE_ENV =', process.env.NODE_ENV);
console.log('🟢 Après chargement .env: process.env.MONGODB_URI =', process.env.MONGODB_URI);

const http = require('http');
console.log('✅ http chargé');
const app = require('./app');
console.log('✅ app chargé');
const { connectDatabase } = require('./src/config/database');
console.log('✅ connectDatabase chargé');

// Import real-time services
const socketService = require('./src/services/socketService');
console.log('✅ socketService chargé');
const notificationService = require('./src/services/notificationService');
console.log('✅ notificationService chargé');
const emailService = require('./src/services/emailService');
console.log('✅ emailService chargé');
const smsService = require('./src/services/smsService');
console.log('✅ smsService chargé');
const currencyService = require('./src/services/currencyService');
console.log('✅ currencyService chargé');

// Import Yield Management services
const schedulerService = require('./src/services/scheduler');
console.log('✅ schedulerService chargé');
const yieldManager = require('./src/services/yieldManager');
console.log('✅ yieldManager chargé');
const demandAnalyzer = require('./src/services/demandAnalyzer');
console.log('✅ demandAnalyzer chargé');
const revenueAnalytics = require('./src/services/revenueAnalytics');
console.log('✅ revenueAnalytics chargé');

// Get port from environment
const port = normalizePort(process.env.PORT || '5000');
app.set('port', port);

// Create HTTP server
const server = http.createServer(app);

// Initialize Socket.io with our advanced socketService
const io = socketService.initialize(server);

// Make services available to the app for controllers
app.set('io', io);
app.set('socketService', socketService);
app.set('notificationService', notificationService);
app.set('yieldManager', yieldManager);
app.set('schedulerService', schedulerService);
app.set('revenueAnalytics', revenueAnalytics);

// ================================
// YIELD MANAGEMENT INITIALIZATION
// ================================

/**
 * Initialize Yield Management System
 */
async function initializeYieldManagement() {
  try {
    console.log('📊 Initializing Yield Management System...');
    
    // Check if yield management is enabled
    if (process.env.YIELD_MANAGEMENT_ENABLED !== 'true') {
      console.log('⚠️  Yield Management disabled in configuration');
      return false;
    }
    
    // Initialize scheduler service
    console.log('⏰ Starting Scheduler Service...');
    await schedulerService.initialize();
    console.log('✅ Scheduler Service initialized');
    
    // Initialize yield manager
    console.log('💰 Starting Yield Manager...');
    await yieldManager.initialize();
    console.log('✅ Yield Manager initialized');
    
    // Initialize demand analyzer
    console.log('📈 Starting Demand Analyzer...');
    await demandAnalyzer.initialize();
    console.log('✅ Demand Analyzer initialized');
    
    // Initialize revenue analytics
    console.log('📊 Starting Revenue Analytics...');
    await revenueAnalytics.initialize();
    console.log('✅ Revenue Analytics initialized');
    
    // Schedule yield management jobs
    if (process.env.YIELD_JOBS_ENABLED === 'true') {
      console.log('🔄 Scheduling Yield Management Jobs...');
      await scheduleYieldJobs();
      console.log('✅ Yield Management Jobs scheduled');
    }
    
    console.log('🎯 Yield Management System fully operational!');
    return true;
    
  } catch (error) {
    console.error('❌ Failed to initialize Yield Management:', error.message);
    return false;
  }
}

/**
 * Schedule all yield management jobs
 */
async function scheduleYieldJobs() {
  const yieldJobs = require('./src/jobs/yieldJobs');
  
  try {
    // Schedule demand analysis (every 5 minutes)
    await schedulerService.scheduleJob('demand-analysis', '*/5 * * * *', async () => {
      console.log('🔍 Running demand analysis...');
      await yieldJobs.analyzeDemand();
    });
    
    // Schedule price updates (every 10 minutes)
    await schedulerService.scheduleJob('price-updates', '*/10 * * * *', async () => {
      console.log('💰 Running price updates...');
      await yieldJobs.updatePrices();
    });
    
    // Schedule occupancy analysis (every 30 minutes)
    await schedulerService.scheduleJob('occupancy-analysis', '*/30 * * * *', async () => {
      console.log('🏨 Running occupancy analysis...');
      await yieldJobs.analyzeOccupancy();
    });
    
    // Schedule revenue optimization (hourly)
    await schedulerService.scheduleJob('revenue-optimization', '0 * * * *', async () => {
      console.log('📊 Running revenue optimization...');
      await yieldJobs.optimizeRevenue();
    });
    
    // Schedule performance monitoring (every 2 hours)
    await schedulerService.scheduleJob('performance-monitoring', '0 */2 * * *', async () => {
      console.log('📈 Running performance monitoring...');
      await yieldJobs.monitorPerformance();
    });
    
    // Schedule daily reports (every day at 6 AM)
    await schedulerService.scheduleJob('daily-reports', '0 6 * * *', async () => {
      console.log('📋 Generating daily yield reports...');
      await yieldJobs.generateDailyReports();
    });
    
    // Schedule weekly forecasting (every Sunday at 8 AM)
    await schedulerService.scheduleJob('weekly-forecasting', '0 8 * * 0', async () => {
      console.log('🔮 Running weekly forecasting...');
      await yieldJobs.generateForecasts();
    });
    
    console.log('⏰ All yield management jobs scheduled successfully');
    
  } catch (error) {
    console.error('❌ Error scheduling yield jobs:', error);
    throw error;
  }
}

// ================================
// REAL-TIME SERVICES INITIALIZATION
// ================================

/**
 * Initialize all real-time services
 */
async function initializeServices() {
  try {
    console.log('🔧 Initializing real-time services...');
    
    // Initialize notification service event listeners
    notificationService.setupEventListeners();
    
    // Test service connections
    const emailStatus = emailService ? '✅ Connected' : '❌ Failed';
    const smsStatus = smsService.getServiceStatus();
    const currencyStatus = currencyService.getServiceStatus();
    
    console.log('📧 Email Service:', emailStatus);
    console.log('📱 SMS Service:', smsStatus.enabled ? '✅ Connected' : '❌ Disabled');
    console.log('💱 Currency Service:', currencyStatus.apiKey ? '✅ Connected' : '❌ No API Key');
    console.log('🔌 Socket Service: ✅ Initialized');
    console.log('🔔 Notification Service: ✅ Ready');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    return false;
  }
}

// ================================
// ENHANCED SOCKET.IO EVENT HANDLERS WITH YIELD MANAGEMENT
// ================================

/**
 * Setup additional real-time event handlers including yield management
 */
function setupRealtimeEventHandlers() {
  // Real-time booking events
  notificationService.on('booking:created', (data) => {
    console.log('📝 Real-time booking created:', data.bookingId);
    socketService.sendBookingNotification(data.bookingId, 'created', data);
    
    // Trigger demand analysis after new booking
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      setTimeout(() => {
        yieldManager.triggerDemandAnalysis(data.hotelId);
      }, 1000);
    }
  });
  
  notificationService.on('booking:confirmed', (data) => {
    console.log('✅ Real-time booking confirmed:', data.bookingId);
    socketService.sendBookingNotification(data.bookingId, 'confirmed', data);
    
    // Trigger price updates after confirmation
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      setTimeout(() => {
        yieldManager.updatePricingForHotel(data.hotelId);
      }, 2000);
    }
  });
  
  notificationService.on('booking:rejected', (data) => {
    console.log('❌ Real-time booking rejected:', data.bookingId);
    socketService.sendBookingNotification(data.bookingId, 'rejected', data);
  });
  
  // Yield Management real-time events
  yieldManager.on('price:updated', (data) => {
    console.log('💰 Price updated for hotel:', data.hotelId);
    socketService.broadcastPriceUpdate(data.hotelId, data);
  });
  
  yieldManager.on('demand:surge', (data) => {
    console.log('📈 Demand surge detected:', data.hotelId);
    socketService.sendAdminNotification('demand_surge', data);
  });
  
  yieldManager.on('occupancy:critical', (data) => {
    console.log('🚨 Critical occupancy alert:', data.hotelId);
    socketService.sendAdminNotification('occupancy_critical', data);
  });
  
  // Real-time admin alerts
  notificationService.on('system:alert', (data) => {
    console.log('🚨 System alert:', data.message);
    socketService.sendAdminNotification('system_alert', data);
  });
  
  // Real-time availability updates with yield pricing
  app.on('availability:updated', (data) => {
    console.log('🏨 Availability updated for hotel:', data.hotelId);
    
    // Include dynamic pricing in availability update
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      yieldManager.getDynamicPricing(data.hotelId, data.roomType, data.date)
        .then(pricing => {
          data.dynamicPricing = pricing;
          socketService.broadcastAvailabilityUpdate(data.hotelId, data);
        })
        .catch(error => {
          console.error('Error getting dynamic pricing:', error);
          socketService.broadcastAvailabilityUpdate(data.hotelId, data);
        });
    } else {
      socketService.broadcastAvailabilityUpdate(data.hotelId, data);
    }
  });
  
  console.log('⚡ Real-time event handlers configured');
}

// ================================
// ENHANCED PERIODIC TASKS WITH YIELD MANAGEMENT
// ================================

/**
 * Setup periodic real-time tasks including yield management monitoring
 */
function setupPeriodicTasks() {
  // Send booking reminders every hour
  setInterval(async () => {
    try {
      await notificationService.scheduleBookingReminders();
      console.log('⏰ Booking reminders checked');
    } catch (error) {
      console.error('❌ Error in booking reminders:', error);
    }
  }, 60 * 60 * 1000); // Every hour
  
  // Update currency rates every 6 hours
  setInterval(async () => {
    try {
      currencyService.clearCache();
      console.log('💱 Currency cache cleared for fresh rates');
    } catch (error) {
      console.error('❌ Error clearing currency cache:', error);
    }
  }, 6 * 60 * 60 * 1000); // Every 6 hours
  
  // Log connection statistics every 5 minutes
  setInterval(() => {
    const stats = socketService.getConnectionStats();
    console.log('📊 Socket connections:', stats);
  }, 5 * 60 * 1000); // Every 5 minutes
  
  // Yield Management monitoring every 15 minutes
  if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
    setInterval(async () => {
      try {
        const yieldStats = await yieldManager.getSystemStats();
        console.log('📈 Yield Management stats:', yieldStats);
        
        // Broadcast yield stats to admin dashboard
        socketService.sendAdminNotification('yield_stats', yieldStats);
      } catch (error) {
        console.error('❌ Error getting yield stats:', error);
      }
    }, 15 * 60 * 1000); // Every 15 minutes
  }
  
  console.log('⏱️  Periodic tasks scheduled');
}

// ================================
// SERVER STARTUP
// ================================

// Listen on provided port
server.listen(port, async () => {
  console.log('🏨 =======================================');
  console.log('🏨    HOTEL MANAGEMENT SYSTEM API');
  console.log('🏨    REAL-TIME + YIELD MANAGEMENT');
  console.log('🏨 =======================================');
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📡 Socket.io running on port ${port}`);
  
  // Connect to database
  try {
    await connectDatabase();
    console.log('✅ Database connected successfully');
    
    // Initialize real-time services
    const servicesReady = await initializeServices();
    if (servicesReady) {
      console.log('✅ Real-time services initialized');
      
      // Initialize Yield Management System
      const yieldReady = await initializeYieldManagement();
      if (yieldReady) {
        console.log('✅ Yield Management System operational');
      } else {
        console.warn('⚠️  Yield Management initialization failed, continuing...');
      }
      
      // Setup real-time event handlers
      setupRealtimeEventHandlers();
      
      // Setup periodic tasks
      setupPeriodicTasks();
    } else {
      console.warn('⚠️  Some services failed to initialize, continuing...');
    }
    
    // Show available endpoints
    console.log('\n📋 Available endpoints:');
    console.log(`   🌐 API: http://localhost:${port}/api`);
    console.log(`   📚 Docs: http://localhost:${port}/api-docs`);
    console.log(`   ❤️  Health: http://localhost:${port}/health`);
    console.log(`   🔌 Socket.io: ws://localhost:${port}`);
    console.log(`   📊 Yield API: http://localhost:${port}/api/yield`);
    
    console.log('\n🎯 Real-time features ready:');
    console.log('   ⚡ Live availability updates');
    console.log('   📱 Instant booking confirmations');
    console.log('   👑 Admin validation notifications');
    console.log('   📧 Multi-channel notifications');
    console.log('   💱 Real-time currency conversion');
    
    if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
      console.log('\n💰 Yield Management features:');
      console.log('   📊 Dynamic pricing optimization');
      console.log('   📈 Real-time demand analysis');
      console.log('   🎯 Revenue optimization');
      console.log('   🔄 Automated pricing jobs');
      console.log('   📋 Performance monitoring');
      console.log('   🔮 Revenue forecasting');
    }
    
    console.log('\n🎯 Ready to accept connections!');
    console.log('=======================================\n');
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
});

// Event listeners
server.on('error', onError);
server.on('listening', onListening);

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

/**
 * Normalize a port into a number, string, or false
 */
function normalizePort(val) {
  const port = parseInt(val, 10);
  
  if (isNaN(port)) {
    return val; // named pipe
  }
  
  if (port >= 0) {
    return port; // port number
  }
  
  return false;
}

/**
 * Event listener for HTTP server "error" event
 */
function onError(error) {
  if (error.syscall !== 'listen') {
    throw error;
  }
  
  const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port;
  
  // Handle specific listen errors with friendly messages
  switch (error.code) {
    case 'EACCES':
      console.error(`❌ ${bind} requires elevated privileges`);
      process.exit(1);
      break;
    case 'EADDRINUSE':
      console.error(`❌ ${bind} is already in use`);
      process.exit(1);
      break;
    default:
      throw error;
  }
}

/**
 * Event listener for HTTP server "listening" event
 */
function onListening() {
  const addr = server.address();
  const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port;
  console.log(`📡 Server listening on ${bind}`);
}

/**
 * Enhanced graceful shutdown handler with yield management cleanup
 */
async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Starting graceful shutdown...`);
  
  // Close server
  server.close(async () => {
    console.log('🚪 HTTP server closed');
    
    try {
      // Shutdown yield management services
      if (process.env.YIELD_MANAGEMENT_ENABLED === 'true') {
        console.log('📊 Shutting down Yield Management services...');
        await schedulerService.shutdown();
        await yieldManager.shutdown();
        console.log('✅ Yield Management services closed');
      }
      
      // Shutdown real-time services
      console.log('🔌 Shutting down real-time services...');
      
      // Close Socket.io gracefully
      socketService.shutdown();
      console.log('📡 Socket.io server closed');
      
      // Close database connection
      const mongoose = require('mongoose');
      await mongoose.connection.close();
      console.log('🗄️  Database connection closed');
      
      console.log('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      console.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force close after 15 seconds (increased for real-time cleanup)
  setTimeout(() => {
    console.error('⏰ Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 15000);
}

// ================================
// ERROR HANDLING
// ================================

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('💥 Uncaught Exception:', error);
  
  // Try to notify admins of system crash
  try {
    socketService.sendAdminNotification('system_crash', {
      error: error.message,
      stack: error.stack,
      timestamp: new Date()
    });
  } catch (notifyError) {
    console.error('Failed to notify admins of crash:', notifyError);
  }
  
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  
  // Try to notify admins
  try {
    socketService.sendAdminNotification('unhandled_rejection', {
      reason: reason.toString(),
      timestamp: new Date()
    });
  } catch (notifyError) {
    console.error('Failed to notify admins of rejection:', notifyError);
  }
  
  process.exit(1);
});

// ================================
// ENHANCED HEALTH CHECK WITH YIELD MANAGEMENT
// ================================

// Enhanced health check endpoint for real-time services
app.get('/health/realtime', (req, res) => {
  const realtimeHealth = {
    socketService: socketService.getConnectionStats(),
    notificationService: notificationService.getServiceStatus(),
    emailService: emailService ? 'Connected' : 'Disconnected',
    smsService: smsService.getServiceStatus(),
    currencyService: currencyService.getServiceStatus(),
    timestamp: new Date().toISOString()
  };
  
  res.status(200).json(realtimeHealth);
});

// Yield Management health check endpoint
app.get('/health/yield', async (req, res) => {
  try {
    const yieldHealth = {
      enabled: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
      schedulerService: schedulerService.getStatus(),
      yieldManager: await yieldManager.getHealthStatus(),
      demandAnalyzer: demandAnalyzer.getStatus(),
      revenueAnalytics: revenueAnalytics.getStatus(),
      activeJobs: schedulerService.getActiveJobs(),
      timestamp: new Date().toISOString()
    };
    
    res.status(200).json(yieldHealth);
  } catch (error) {
    res.status(500).json({
      error: 'Yield Management health check failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = server;