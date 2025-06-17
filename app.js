/**
 * Hotel Management System - Express Application Configuration
 * Author: Nawfal Razouk
 * Description: Main Express app configuration with middleware and routes
 */

console.log('=== DEBUT APP.JS ===');


const express = require('express');
console.log('✅ express chargé');
const cors = require('cors');
console.log('✅ cors chargé');
const helmet = require('helmet');
console.log('✅ helmet chargé');
const compression = require('compression');
console.log('✅ compression chargé');
const rateLimit = require('express-rate-limit');
console.log('✅ express-rate-limit chargé');
const mongoSanitize = require('express-mongo-sanitize');
console.log('✅ express-mongo-sanitize chargé');
const path = require('path');
console.log('✅ path chargé');

// Import middleware
const errorHandler = require('./src/middleware/errorHandler');
console.log('✅ errorHandler chargé');
const logger = require('./src/middleware/logger');
console.log('✅ logger chargé');

// Import route modules
//const authRoutes = require('./src/routes/auth');
const routes = require('./src/routes');
app.use('/api', routes);

console.log('✅ authRoutes chargé');
const hotelRoutes = require('./src/routes/hotels');
console.log('✅ hotelRoutes chargé');
const roomRoutes = require('./src/routes/rooms');
console.log('✅ roomRoutes chargé');
const bookingRoutes = require('./src/routes/bookings');
console.log('✅ bookingRoutes chargé');
const adminRoutes = require('./src/routes/admin');
console.log('✅ adminRoutes chargé');
const receptionRoutes = require('./src/routes/reception');
console.log('✅ receptionRoutes chargé');
const userRoutes = require('./src/routes/users');
console.log('✅ userRoutes chargé');
const paymentRoutes = require('./src/routes/payments');
console.log('✅ paymentRoutes chargé');

// Swagger documentation
const swaggerUi = require('swagger-ui-express');
console.log('✅ swagger-ui-express chargé');
const { swaggerSpec } = require('./src/config/swagger');
console.log('✅ swaggerSpec chargé');

// Create Express app
const app = express();

// ================================
// SECURITY MIDDLEWARE
// ================================

// Helmet for security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      scriptSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// CORS configuration
const corsOptions = {
  origin: process.env.CORS_ORIGIN?.split(',') || ['http://localhost:4200'],
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
    'Cache-Control',
    'Pragma',
  ],
};

app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: (process.env.RATE_LIMIT_WINDOW || 15) * 60 * 1000, // 15 minutes
  max: process.env.RATE_LIMIT_MAX || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health' || req.path === '/api/health';
  },
});

app.use('/api/', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // limit each IP to 5 auth requests per windowMs
  message: {
    error: 'Too many authentication attempts, please try again later.',
    retryAfter: '15 minutes'
  },
  skipSuccessfulRequests: true,
});

app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);

// ================================
// GENERAL MIDDLEWARE
// ================================

// Compression
app.use(compression());

// Body parsing middleware
app.use(express.json({ 
  limit: '10mb',
  type: 'application/json'
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb'
}));

// Sanitize user input
app.use(mongoSanitize());

// Custom logger middleware
app.use(logger);

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use('/invoices', express.static(path.join(__dirname, 'invoices')));

// ================================
// API DOCUMENTATION
// ================================

// Swagger API documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  explorer: true,
  customCss: '.swagger-ui .topbar { display: none }',
  customSiteTitle: 'Hotel Management API Documentation',
}));

// ================================
// HEALTH CHECK
// ================================

app.get('/health', (req, res) => {
  const healthCheck = {
    uptime: process.uptime(),
    message: 'Hotel Management API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    memory: process.memoryUsage(),
    pid: process.pid,
  };
  
  res.status(200).json(healthCheck);
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    message: 'Hotel Management System API',
    version: '1.0.0',
    author: 'Nawfal Razouk',
    documentation: '/api-docs',
    endpoints: {
      auth: '/api/auth',
      hotels: '/api/hotels',
      rooms: '/api/rooms',
      bookings: '/api/bookings',
      payments: '/api/payments',
      admin: '/api/admin',
      reception: '/api/reception',
      users: '/api/users',
    },
  });
});

// ================================
// API ROUTES
// ================================

const API_VERSION = '/api';

// Mount routes
app.use(`${API_VERSION}/auth`, authRoutes);
app.use(`${API_VERSION}/hotels`, hotelRoutes);
app.use(`${API_VERSION}/rooms`, roomRoutes);
app.use(`${API_VERSION}/bookings`, bookingRoutes);
app.use(`${API_VERSION}/payments`, paymentRoutes);
app.use(`${API_VERSION}/admin`, adminRoutes);
app.use(`${API_VERSION}/reception`, receptionRoutes);
app.use(`${API_VERSION}/users`, userRoutes);

// ================================
// ERROR HANDLING
// ================================

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    message: `The endpoint ${req.originalUrl} does not exist`,
    availableEndpoints: [
      '/api/auth',
      '/api/hotels',
      '/api/rooms', 
      '/api/bookings',
      '/api/payments',
      '/api/admin',
      '/api/reception',
      '/api/users',
    ],
  });
});

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to Hotel Management System API',
    version: '1.0.0',
    documentation: '/api-docs',
    health: '/health',
    api: '/api',
  });
});

// Catch-all 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    suggestion: 'Check the API documentation at /api-docs',
  });
});

// Global error handler (must be last)
app.use(errorHandler);

// ================================
// MODULE EXPORTS
// ================================

module.exports = app;