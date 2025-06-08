/**
 * Hotel Management System - Global Error Handler Middleware
 * Author: Nawfal Razouk
 * Description: Centralized error handling for all API endpoints
 */

/**
 * Global error handling middleware
 * Must be the last middleware in the chain
 */
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error for debugging
  console.error('🔴 Error:', {
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.originalUrl,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString(),
  });

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id: ${err.value}`;
    error = {
      message,
      statusCode: 404,
      error: 'Not Found',
    };
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    const message = `Duplicate value for ${field}: ${value}`;
    error = {
      message,
      statusCode: 400,
      error: 'Bad Request',
    };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors)
      .map((val) => val.message)
      .join(', ');
    error = {
      message,
      statusCode: 400,
      error: 'Validation Error',
    };
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = {
      message: 'Invalid token',
      statusCode: 401,
      error: 'Unauthorized',
    };
  }

  if (err.name === 'TokenExpiredError') {
    error = {
      message: 'Token expired',
      statusCode: 401,
      error: 'Unauthorized',
    };
  }

  // Multer file upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = {
      message: 'File too large',
      statusCode: 400,
      error: 'Bad Request',
    };
  }

  if (err.code === 'LIMIT_FILE_COUNT') {
    error = {
      message: 'Too many files',
      statusCode: 400,
      error: 'Bad Request',
    };
  }

  // Stripe errors
  if (err.type === 'StripeCardError') {
    error = {
      message: err.message,
      statusCode: 400,
      error: 'Payment Error',
    };
  }

  if (err.type === 'StripeInvalidRequestError') {
    error = {
      message: 'Invalid payment request',
      statusCode: 400,
      error: 'Payment Error',
    };
  }

  // MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoServerSelectionError') {
    error = {
      message: 'Database connection error',
      statusCode: 503,
      error: 'Service Unavailable',
    };
  }

  // Rate limit errors
  if (err.statusCode === 429) {
    error = {
      message: 'Too many requests, please try again later',
      statusCode: 429,
      error: 'Too Many Requests',
    };
  }

  // Default error response
  const statusCode = error.statusCode || err.statusCode || 500;
  const message = error.message || 'Internal Server Error';

  // Build error response
  const errorResponse = {
    success: false,
    error: error.error || 'Server Error',
    message,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      originalError: err,
    }),
  };

  // Add request context in development
  if (process.env.NODE_ENV === 'development') {
    errorResponse.request = {
      method: req.method,
      url: req.originalUrl,
      headers: req.headers,
      body: req.body,
      params: req.params,
      query: req.query,
    };
  }

  // Log critical errors (500+)
  if (statusCode >= 500) {
    console.error('💥 Critical Error:', {
      message,
      statusCode,
      stack: err.stack,
      url: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString(),
    });
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Handle async errors
 * Wrapper function to catch async errors and pass them to error handler
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Custom error class for API errors
 */
class APIError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.error = this.getErrorType(statusCode);
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
  }

  getErrorType(statusCode) {
    if (statusCode >= 400 && statusCode < 500) {
      return 'Client Error';
    }
    if (statusCode >= 500) {
      return 'Server Error';
    }
    return 'Unknown Error';
  }
}

/**
 * Not found middleware
 * Handle 404 errors for routes that don't exist
 */
const notFound = (req, res, next) => {
  const error = new APIError(`Route ${req.originalUrl} not found`, 404);
  next(error);
};

module.exports = {
  errorHandler,
  asyncHandler,
  APIError,
  notFound,
};