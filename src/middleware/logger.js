/**
 * Ultimate Hotel Management Logger - Winston + Yield Management Integration
 * Author: Nawfal Razouk
 * Description: Professional logging system combining Winston architecture with advanced yield management
 * Features: Winston transports + Yield operations + HTTP middleware + Performance monitoring
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const moment = require('moment');

// ================================
// DIRECTORY STRUCTURE SETUP
// ================================

/**
 * Ensure comprehensive logs directory structure
 */
const ensureLogDirectories = () => {
  const baseLogDir = path.join(process.cwd(), 'logs');
  const directories = [
    baseLogDir,
    path.join(baseLogDir, 'yield'),
    path.join(baseLogDir, 'business'),
    path.join(baseLogDir, 'security'),
    path.join(baseLogDir, 'archive')
  ];

  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
};

// Initialize directories
ensureLogDirectories();

// ================================
// CUSTOM LOG LEVELS & COLORS
// ================================

const customLevels = {
  fatal: 0,
  error: 1,
  warn: 2,
  info: 3,
  http: 4,
  booking: 5,
  yield: 6,
  security: 7,
  performance: 8,
  debug: 9
};

const customColors = {
  fatal: 'red bold',
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  booking: 'cyan',
  yield: 'blue bold',
  security: 'red bold',
  performance: 'yellow bold',
  debug: 'gray'
};

winston.addColors(customColors);

// ================================
// WINSTON FORMATS
// ================================

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    let metaStr = '';
    if (Object.keys(meta).length > 0) {
      metaStr = ` ${JSON.stringify(meta, null, 2)}`;
    }
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
  winston.format.json()
);

// ================================
// WINSTON TRANSPORTS CONFIGURATION
// ================================

const createTransports = () => {
  const logsDir = path.join(process.cwd(), 'logs');
  const yieldDir = path.join(logsDir, 'yield');
  const businessDir = path.join(logsDir, 'business');
  const securityDir = path.join(logsDir, 'security');

  const transports = [];

  // Console transport
  if (process.env.NODE_ENV !== 'production' || process.env.ENABLE_CONSOLE_LOGS === 'true') {
    transports.push(
      new winston.transports.Console({
        format: consoleFormat,
        level: process.env.LOG_LEVEL || 'debug'
      })
    );
  }

  // Standard file transports
  transports.push(
    // Combined logs
    new winston.transports.File({
      filename: path.join(logsDir, 'combined.log'),
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: fileFormat
    }),

    // Error logs
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: fileFormat
    }),

    // HTTP/API logs
    new winston.transports.File({
      filename: path.join(logsDir, 'api.log'),
      level: 'http',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
      format: fileFormat
    })
  );

  // Yield Management transports
  transports.push(
    new winston.transports.File({
      filename: path.join(yieldDir, 'yield-operations.log'),
      level: 'yield',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: fileFormat
    }),

    new winston.transports.File({
      filename: path.join(yieldDir, 'yield-performance.log'),
      level: 'performance',
      maxsize: 5 * 1024 * 1024,
      maxFiles: 3,
      format: fileFormat
    })
  );

  // Business & Security transports
  transports.push(
    new winston.transports.File({
      filename: path.join(businessDir, 'booking.log'),
      level: 'booking',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      format: fileFormat
    }),

    new winston.transports.File({
      filename: path.join(securityDir, 'security.log'),
      level: 'security',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 10,
      format: fileFormat
    })
  );

  return transports;
};

// ================================
// WINSTON LOGGER INSTANCE
// ================================

const winstonLogger = winston.createLogger({
  levels: customLevels,
  level: process.env.LOG_LEVEL || 'info',
  format: fileFormat,
  defaultMeta: {
    service: 'hotel-management-system',
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid,
    hostname: require('os').hostname()
  },
  transports: createTransports(),
  exitOnError: false
});

// ================================
// UTILITY FUNCTIONS
// ================================

/**
 * Get client IP address from request
 */
const getClientIP = (req) => {
  return (
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
};

/**
 * Get user agent from request
 */
const getUserAgent = (req) => {
  return req.headers['user-agent'] || 'Unknown';
};

/**
 * Format response time
 */
const formatResponseTime = (startTime) => {
  const diff = process.hrtime(startTime);
  return Math.round((diff[0] * 1e3) + (diff[1] * 1e-6));
};

/**
 * Sanitize sensitive data
 */
const sanitizeData = (data) => {
  if (!data || typeof data !== 'object') return data;

  const sensitiveFields = ['password', 'token', 'secret', 'key', 'authorization', 'creditCard'];
  const sanitized = { ...data };

  Object.keys(sanitized).forEach(key => {
    if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
      sanitized[key] = '[REDACTED]';
    }
  });

  return sanitized;
};

/**
 * Detect yield management requests
 */
const isYieldManagementRequest = (req) => {
  const yieldPaths = [
    '/api/yield',
    '/api/analytics',
    '/api/bookings/yield',
    '/api/pricing',
    '/api/revenue',
    '/api/demand'
  ];
  
  return yieldPaths.some(path => req.originalUrl.includes(path)) ||
         req.headers['x-yield-operation'] ||
         req.body?.yieldOperation ||
         req.query?.yieldAnalysis;
};

/**
 * Extract yield operation type
 */
const extractYieldOperation = (req) => {
  if (req.headers['x-yield-operation']) return req.headers['x-yield-operation'];
  if (req.body?.yieldOperation) return req.body.yieldOperation;
  
  // Infer from URL patterns
  if (req.originalUrl.includes('/api/yield/calculate')) return 'PRICE_CALCULATION';
  if (req.originalUrl.includes('/api/yield/optimize')) return 'REVENUE_OPTIMIZATION';
  if (req.originalUrl.includes('/api/analytics/yield')) return 'YIELD_ANALYTICS';
  if (req.originalUrl.includes('/api/bookings/yield')) return 'BOOKING_YIELD_UPDATE';
  if (req.originalUrl.includes('/api/demand/analyze')) return 'DEMAND_ANALYSIS';
  if (req.originalUrl.includes('/api/pricing/rules')) return 'PRICING_RULES';
  
  return 'YIELD_GENERAL';
};

// ================================
// ULTIMATE HOTEL LOGGER CLASS
// ================================

class UltimateHotelLogger {
  constructor(winstonInstance) {
    this.winston = winstonInstance;
    this.requestIdGenerator = () => require('crypto').randomUUID();
  }

  // ================================
  // STANDARD LOGGING METHODS
  // ================================

  fatal(message, meta = {}) {
    this.winston.log('fatal', message, this.enrichContext(meta, 'fatal'));
  }

  error(message, meta = {}) {
    this.winston.error(message, this.enrichContext(meta, 'error'));
  }

  warn(message, meta = {}) {
    this.winston.warn(message, this.enrichContext(meta, 'warn'));
  }

  info(message, meta = {}) {
    this.winston.info(message, this.enrichContext(meta, 'info'));
  }

  debug(message, meta = {}) {
    this.winston.debug(message, this.enrichContext(meta, 'debug'));
  }

  // ================================
  // SPECIALIZED HOTEL LOGGING METHODS
  // ================================

  /**
   * Log booking operations with comprehensive context
   */
  booking(message, bookingData = {}) {
    const context = {
      category: 'booking',
      bookingId: bookingData.id || bookingData._id,
      hotelId: bookingData.hotelId || bookingData.hotel,
      customerId: bookingData.customerId || bookingData.customer,
      confirmationNumber: bookingData.confirmationNumber,
      status: bookingData.status,
      source: bookingData.source,
      totalAmount: bookingData.totalAmount,
      checkInDate: bookingData.checkInDate,
      checkOutDate: bookingData.checkOutDate,
      roomCount: bookingData.rooms?.length || 0,
      guestCount: bookingData.numberOfGuests,
      yieldOptimized: bookingData.yieldManagement?.enabled || false
    };
    
    this.winston.log('booking', message, this.enrichContext(context, 'booking'));
    
    // Also write to specific yield booking log if yield-related
    if (context.yieldOptimized) {
      this.writeToYieldLog('booking-yield', message, context);
    }
  }

  /**
   * Log yield management operations with detailed factors
   */
  yield(message, yieldData = {}) {
    const context = {
      category: 'yield',
      operation: yieldData.operation || 'GENERAL',
      hotelId: yieldData.hotelId,
      roomType: yieldData.roomType,
      strategy: yieldData.strategy,
      basePrice: yieldData.basePrice,
      dynamicPrice: yieldData.dynamicPrice,
      priceChange: yieldData.dynamicPrice && yieldData.basePrice ? 
        yieldData.dynamicPrice - yieldData.basePrice : 0,
      priceChangePercentage: yieldData.dynamicPrice && yieldData.basePrice ?
        ((yieldData.dynamicPrice - yieldData.basePrice) / yieldData.basePrice * 100).toFixed(2) : 0,
      occupancyRate: yieldData.occupancyRate,
      demandLevel: yieldData.demandLevel,
      factors: yieldData.factors || {},
      executionTime: yieldData.executionTime,
      cacheHit: yieldData.cacheHit || false,
      source: yieldData.source,
      confidence: yieldData.confidence
    };
    
    this.winston.log('yield', message, this.enrichContext(context, 'yield'));
    this.writeToYieldLog('yield-operations', message, context);

    // Alert for significant changes
    const priceChangePercent = Math.abs(parseFloat(context.priceChangePercentage));
    if (priceChangePercent > 30) {
      this.writeToYieldLog('yield-alerts', `SIGNIFICANT PRICE CHANGE: ${message}`, {
        ...context,
        alert: 'SIGNIFICANT_PRICE_CHANGE',
        threshold: 30,
        actualChange: priceChangePercent
      });
    }
  }

  /**
   * Log price calculation with detailed breakdown
   */
  priceCalculation(calculationData, result, performance = {}) {
    const context = {
      category: 'price-calculation',
      operation: 'PRICE_CALCULATION',
      input: {
        hotelId: calculationData.hotelId,
        roomType: calculationData.roomType,
        checkInDate: calculationData.checkInDate,
        checkOutDate: calculationData.checkOutDate,
        basePrice: calculationData.basePrice,
        strategy: calculationData.strategy || 'MODERATE',
        guestCount: calculationData.guestCount
      },
      factors: {
        occupancyFactor: result.factors?.occupancyFactor?.factor,
        seasonalFactor: result.factors?.seasonalFactor?.factor,
        demandFactor: result.factors?.demandFactor?.factor,
        leadTimeFactor: result.factors?.leadTimeFactor?.factor,
        totalFactor: result.factors?.totalFactor
      },
      result: {
        basePrice: result.basePrice,
        dynamicPrice: result.dynamicPrice,
        totalPrice: result.totalPrice,
        priceChange: result.dynamicPrice - result.basePrice,
        priceChangePercentage: ((result.dynamicPrice - result.basePrice) / result.basePrice * 100).toFixed(2)
      },
      performance: {
        calculationTime: performance.calculationTime || 0,
        cacheUsed: performance.cacheUsed || false,
        factorsCalculated: Object.keys(result.factors || {}).length
      },
      metadata: {
        currency: result.currency || 'EUR',
        confidence: result.confidence || 0,
        recommendations: result.recommendations?.length || 0
      }
    };

    const message = `Price calculated: ${context.input.basePrice} → ${context.result.dynamicPrice} (${context.result.priceChangePercentage}%)`;
    
    this.winston.log('yield', message, this.enrichContext(context, 'yield'));
    this.writeToYieldLog('yield-pricing', message, context);
  }

  /**
   * Log revenue optimization operations
   */
  revenueOptimization(hotelId, optimizationData, results, context = {}) {
    const logContext = {
      category: 'revenue-optimization',
      operation: 'REVENUE_OPTIMIZATION',
      hotelId,
      optimization: {
        strategy: optimizationData.strategy,
        timeHorizon: optimizationData.timeHorizon,
        roomTypes: optimizationData.roomTypes,
        currentOccupancy: optimizationData.currentOccupancy,
        targetOccupancy: optimizationData.targetOccupancy
      },
      results: {
        recommendationsCount: results.recommendations?.length || 0,
        potentialRevenueIncrease: results.potentialRevenueIncrease || 0,
        estimatedImpact: results.estimatedImpact || 'LOW',
        implementationComplexity: results.implementationComplexity || 'MEDIUM'
      },
      recommendations: results.recommendations?.map(rec => ({
        type: rec.type,
        priority: rec.priority,
        expectedImpact: rec.expectedImpact,
        roomType: rec.roomType
      })) || [],
      context: {
        triggeredBy: context.triggeredBy || 'MANUAL',
        userId: context.userId,
        automated: context.automated || false
      },
      performance: {
        analysisTime: results.analysisTime || 0,
        dataPoints: results.dataPoints || 0
      }
    };

    const message = `Revenue optimization: ${results.recommendations?.length || 0} recommendations, ${results.potentialRevenueIncrease || 0}% potential increase`;
    
    this.winston.log('yield', message, this.enrichContext(logContext, 'yield'));
    this.writeToYieldLog('yield-revenue', message, logContext);

    // Alert for high-impact opportunities
    if (results.potentialRevenueIncrease > 15) {
      this.writeToYieldLog('yield-opportunities', `HIGH REVENUE OPPORTUNITY: ${message}`, {
        ...logContext,
        alert: 'HIGH_REVENUE_OPPORTUNITY',
        threshold: 15,
        actualIncrease: results.potentialRevenueIncrease
      });
    }
  }

  /**
   * Log security events with yield context
   */
  security(message, securityData = {}) {
    const isYieldSecurity = securityData.yieldContext || 
                           securityData.url?.includes('/yield') ||
                           securityData.url?.includes('/analytics');

    const context = {
      category: 'security',
      userId: securityData.userId,
      userRole: securityData.userRole,
      ip: securityData.ip,
      userAgent: securityData.userAgent,
      action: securityData.action,
      resource: securityData.resource,
      success: securityData.success,
      failureReason: securityData.failureReason,
      sessionId: securityData.sessionId,
      url: securityData.url,
      method: securityData.method,
      yieldSecurity: isYieldSecurity,
      yieldOperation: isYieldSecurity ? extractYieldOperation({ originalUrl: securityData.url || '' }) : null,
      riskLevel: securityData.riskLevel || 'MEDIUM'
    };
    
    this.winston.log('security', message, this.enrichContext(context, 'security'));
    
    // Write to yield security log if applicable
    if (isYieldSecurity) {
      this.writeToYieldLog('yield-security', message, context);
    }
  }

  /**
   * Log performance metrics with yield awareness
   */
  performance(message, performanceData = {}) {
    const context = {
      category: 'performance',
      operation: performanceData.operation,
      duration: performanceData.duration,
      endpoint: performanceData.endpoint,
      statusCode: performanceData.statusCode,
      responseTime: performanceData.responseTime,
      memoryUsage: performanceData.memoryUsage,
      cpuUsage: performanceData.cpuUsage,
      yieldOperation: performanceData.yieldOperation,
      cacheHit: performanceData.cacheHit
    };
    
    this.winston.log('performance', message, this.enrichContext(context, 'performance'));
    
    // Write to yield performance log if yield-related
    if (context.yieldOperation) {
      this.writeToYieldLog('yield-performance', message, context);
    }
  }

  /**
   * Log analytics operations
   */
  analytics(message, analyticsData = {}) {
    const context = {
      category: 'analytics',
      queryType: analyticsData.queryType,
      hotelId: analyticsData.hotelId,
      period: analyticsData.period,
      granularity: analyticsData.granularity,
      dataPoints: analyticsData.dataPoints,
      includeYield: analyticsData.includeYield,
      queryTime: analyticsData.queryTime,
      cacheHit: analyticsData.cacheHit
    };
    
    this.winston.info(message, this.enrichContext(context, 'analytics'));
    this.writeToYieldLog('yield-analytics', message, context);
  }

  // ================================
  // HTTP MIDDLEWARE INTEGRATION
  // ================================

  /**
   * Express middleware for comprehensive request logging
   */
  requestLogger() {
    return (req, res, next) => {
      const startTime = process.hrtime();
      const requestId = this.requestIdGenerator();
      const ip = getClientIP(req);
      const userAgent = getUserAgent(req);
      const isYieldRequest = isYieldManagementRequest(req);
      const yieldOperation = isYieldRequest ? extractYieldOperation(req) : null;

      // Store request metadata
      req.requestId = requestId;
      req.startTime = startTime;
      req.isYieldRequest = isYieldRequest;
      req.yieldOperation = yieldOperation;

      // Enhanced logging for yield operations
      if (isYieldRequest) {
        this.yield(`🔄 YIELD ${req.method} ${req.originalUrl}`, {
          operation: 'HTTP_REQUEST_START',
          method: req.method,
          url: req.originalUrl,
          yieldOperation,
          ip,
          userAgent,
          requestId,
          userId: req.user?.id,
          userRole: req.user?.role,
          body: Object.keys(req.body || {}).length > 0 ? sanitizeData(req.body) : undefined,
          query: Object.keys(req.query || {}).length > 0 ? req.query : undefined
        });
      } else {
        this.winston.http(`HTTP Request Started: ${req.method} ${req.originalUrl}`, 
          this.enrichContext({
            method: req.method,
            url: req.originalUrl,
            ip,
            userAgent,
            requestId,
            userId: req.user?.id,
            userRole: req.user?.role
          }, 'http')
        );
      }

      // Override res.json to capture response data
      const originalJson = res.json;
      let responseData = null;

      res.json = function(data) {
        responseData = data;
        return originalJson.call(this, data);
      };

      // Capture response
      res.on('finish', () => {
        const responseTime = formatResponseTime(startTime);
        const { statusCode } = res;

        const logData = {
          method: req.method,
          url: req.originalUrl,
          statusCode,
          responseTime: `${responseTime}ms`,
          ip,
          userAgent,
          requestId,
          userId: req.user?.id,
          userRole: req.user?.role,
          yieldRequest: isYieldRequest,
          yieldOperation,
          hasError: statusCode >= 400
        };

        // Log completion based on request type
        if (isYieldRequest) {
          this.yield(`✅ YIELD ${req.method} ${req.originalUrl} completed`, {
            ...logData,
            operation: 'HTTP_REQUEST_COMPLETE',
            yieldData: responseData?.data?.yieldData,
            performance: responseData?.data?.performance
          });
          
          // Auto-log yield performance data if available
          if (responseData?.data?.yieldData || responseData?.data?.performance) {
            this.performance('Yield request performance captured', {
              ...logData,
              yieldOperation,
              yieldData: responseData.data.yieldData,
              performanceMetrics: responseData.data.performance
            });
          }
        } else {
          this.winston.http(`HTTP Request Completed: ${req.method} ${req.originalUrl}`, 
            this.enrichContext(logData, 'http')
          );
        }

        // Alert for slow requests (enhanced threshold for yield)
        const slowThreshold = isYieldRequest ? 2000 : 1000;
        if (responseTime > slowThreshold) {
          this.warn(`⚠️ Slow ${isYieldRequest ? 'yield ' : ''}request detected`, {
            ...logData,
            threshold: slowThreshold,
            category: 'slow-request'
          });
        }
      });

      // Handle errors
      res.on('error', (error) => {
        const responseTime = formatResponseTime(startTime);
        
        const errorData = {
          method: req.method,
          url: req.originalUrl,
          error: error.message,
          stack: error.stack,
          responseTime: `${responseTime}ms`,
          ip,
          userAgent,
          requestId,
          userId: req.user?.id,
          userRole: req.user?.role,
          yieldRequest: isYieldRequest,
          yieldOperation
        };

        if (isYieldRequest) {
          this.yield(`🔴 YIELD ERROR: ${req.method} ${req.originalUrl}`, {
            ...errorData,
            operation: 'HTTP_REQUEST_ERROR'
          });
          this.writeToYieldLog('yield-errors', `HTTP Error: ${error.message}`, errorData);
        } else {
          this.error(`HTTP Request Error: ${req.method} ${req.originalUrl}`, errorData);
        }
      });

      next();
    };
  }

  /**
   * Error handling middleware
   */
  errorLogger() {
    return (err, req, res, next) => {
      const errorData = {
        error: err.message,
        stack: err.stack,
        method: req.method,
        url: req.originalUrl,
        ip: getClientIP(req),
        requestId: req.requestId,
        userId: req.user?.id,
        userRole: req.user?.role,
        statusCode: err.statusCode || 500,
        yieldRequest: req.isYieldRequest,
        yieldOperation: req.yieldOperation
      };

      if (req.isYieldRequest) {
        this.yield('🚨 YIELD REQUEST ERROR', {
          ...errorData,
          operation: 'HTTP_ERROR_HANDLER'
        });
        this.writeToYieldLog('yield-errors', `Middleware Error: ${err.message}`, errorData);
      } else {
        this.error('HTTP Request Error (Middleware)', errorData);
      }

      next(err);
    };
  }

  // ================================
  // SPECIALIZED YIELD LOGGING
  // ================================

  /**
   * Write to specific yield log files
   */
  writeToYieldLog(logType, message, context) {
    const yieldLogPath = path.join(process.cwd(), 'logs', 'yield', `${logType}.log`);
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'yield',
      message,
      ...context,
      environment: process.env.NODE_ENV,
      service: 'hotel-management-yield'
    };

    fs.appendFile(yieldLogPath, JSON.stringify(logEntry) + '\n', (err) => {
      if (err && process.env.NODE_ENV === 'development') {
        console.error(`Failed to write to yield log ${logType}:`, err);
      }
    });
  }

  /**
   * Log yield audit trail
   */
  yieldAudit(changes, user, impact = {}, context = {}) {
    const auditData = {
      category: 'yield-audit',
      user: {
        id: user.id,
        role: user.role,
        email: user.email,
        ip: context.ip,
        userAgent: context.userAgent
      },
      changes: {
        type: changes.type,
        entity: changes.entity,
        entityId: changes.entityId,
        oldValues: changes.oldValues,
        newValues: changes.newValues,
        reason: changes.reason
      },
      impact: {
        revenueImpact: impact.revenueImpact || 0,
        affectedBookings: impact.affectedBookings || 0,
        timeframeAffected: impact.timeframeAffected,
        riskLevel: impact.riskLevel || 'LOW'
      },
      context: {
        source: context.source || 'WEB',
        method: context.method,
        url: context.url,
        sessionId: context.sessionId,
        transactionId: context.transactionId
      }
    };

    const message = `Yield audit: ${changes.type} by ${user.email}`;
    this.winston.log('yield', message, this.enrichContext(auditData, 'yield'));
    this.writeToYieldLog('yield-audit', message, auditData);

    // High-risk changes get special attention
    if (impact.riskLevel === 'HIGH') {
      this.writeToYieldLog('yield-risk', `HIGH RISK: ${message}`, {
        ...auditData,
        riskFlag: 'HIGH_RISK_CHANGE'
      });
    }
  }

  /**
   * Log yield job execution
   */
  yieldJob(jobData, execution = {}, results = {}) {
    const jobContext = {
      category: 'yield-job',
      job: {
        id: jobData.id,
        type: jobData.type,
        priority: jobData.priority,
        scheduled: jobData.scheduled,
        triggered: jobData.triggered || 'AUTOMATIC'
      },
      execution: {
        startTime: execution.startTime,
        endTime: execution.endTime,
        duration: execution.duration || 0,
        status: execution.status || 'COMPLETED',
        attempts: execution.attempts || 1,
        worker: execution.worker
      },
      results: {
        success: results.success || true,
        recordsProcessed: results.recordsProcessed || 0,
        updates: results.updates || 0,
        errors: results.errors || 0,
        warnings: results.warnings || 0
      },
      performance: {
        memoryUsage: execution.memoryUsage,
        cpuUsage: execution.cpuUsage,
        throughput: results.recordsProcessed / (execution.duration / 1000) || 0
      }
    };

    const message = `Yield job ${execution.status}: ${jobData.type} (${execution.duration}ms)`;
    this.winston.log('yield', message, this.enrichContext(jobContext, 'yield'));
    this.writeToYieldLog('yield-jobs', message, jobContext);

    // Failed jobs get error logging
    if (!results.success) {
      this.writeToYieldLog('yield-job-errors', `JOB FAILED: ${message}`, {
        ...jobContext,
        failureReason: results.error,
        retryNeeded: execution.attempts < 3
      });
    }
  }

  // ================================
  // UTILITY AND HELPER METHODS
  // ================================

  /**
   * Enrich context with common metadata
   */
  enrichContext(meta, level) {
    return {
      ...meta,
      timestamp: new Date().toISOString(),
      level,
      requestId: this.getCurrentRequestId(),
      // Add tracing information if available
      traceId: this.getCurrentTraceId()
    };
  }

  /**
   * Get current request ID from async context
   */
  getCurrentRequestId() {
    // This could be implemented with async_hooks or cls-hooked
    return null;
  }

  /**
   * Get current trace ID for distributed tracing
   */
  getCurrentTraceId() {
    // This could be implemented with OpenTelemetry or similar
    return null;
  }

  /**
   * Performance measurement wrapper
   */
  async measureTime(operation, asyncFunction, context = {}) {
    const start = Date.now();
    let result, error;

    try {
      result = await asyncFunction();
      return result;
    } catch (err) {
      error = err;
      throw err;
    } finally {
      const duration = Date.now() - start;
      
      if (error) {
        this.error(`Operation failed: ${operation}`, {
          ...context,
          duration,
          operation,
          error: error.message,
          category: 'performance-failure'
        });
      } else {
        this.performance(`Operation completed: ${operation}`, {
          ...context,
          duration,
          operation,
          category: 'performance-success'
        });
      }
    }
  }

  /**
   * Business operation logging
   */
  business(message, businessData = {}) {
    const context = {
      category: 'business',
      operation: businessData.operation,
      entityType: businessData.entityType,
      entityId: businessData.entityId,
      userId: businessData.userId,
      result: businessData.result,
      impact: businessData.impact,
      revenue: businessData.revenue,
      yieldImpact: businessData.yieldImpact
    };
    
    this.winston.info(message, this.enrichContext(context, 'business'));
  }

  /**
   * Database operation logging
   */
  database(message, dbData = {}) {
    const context = {
      category: 'database',
      operation: dbData.operation,
      collection: dbData.collection,
      query: dbData.query,
      duration: dbData.duration,
      recordsAffected: dbData.recordsAffected,
      userId: dbData.userId
    };
    
    this.winston.debug(message, this.enrichContext(context, 'database'));
  }

  /**
   * Payment logging
   */
  payment(message, paymentData = {}) {
    const context = {
      category: 'payment',
      bookingId: paymentData.bookingId,
      amount: paymentData.amount,
      currency: paymentData.currency,
      method: paymentData.method,
      transactionId: paymentData.transactionId,
      status: paymentData.status,
      provider: paymentData.provider,
      userId: paymentData.userId
    };
    
    this.winston.info(message, this.enrichContext(context, 'payment'));
  }

  // ================================
  // SYSTEM MONITORING
  // ================================

  /**
   * Log system health with yield management status
   */
  systemHealth(healthData, alerts = [], context = {}) {
    const healthContext = {
      category: 'system-health',
      system: {
        yieldManagerStatus: healthData.yieldManagerStatus || 'UNKNOWN',
        schedulerStatus: healthData.schedulerStatus || 'UNKNOWN',
        cacheStatus: healthData.cacheStatus || 'UNKNOWN',
        databaseStatus: healthData.databaseStatus || 'UNKNOWN'
      },
      performance: {
        cpuUsage: healthData.cpuUsage || 0,
        memoryUsage: healthData.memoryUsage || 0,
        responseTime: healthData.responseTime || 0,
        throughput: healthData.throughput || 0
      },
      yield: {
        activeJobs: healthData.activeJobs || 0,
        queuedJobs: healthData.queuedJobs || 0,
        cacheHitRate: healthData.cacheHitRate || 0,
        optimizationRate: healthData.optimizationRate || 0
      },
      alerts: alerts.map(alert => ({
        type: alert.type,
        severity: alert.severity,
        message: alert.message,
        threshold: alert.threshold,
        value: alert.value
      })),
      context: {
        checkType: context.checkType || 'SCHEDULED',
        triggeredBy: context.triggeredBy || 'SYSTEM'
      }
    };

    const message = `System health check: ${alerts.length} alerts detected`;
    this.winston.info(message, this.enrichContext(healthContext, 'info'));
    this.writeToYieldLog('yield-health', message, healthContext);

    // Critical health alerts
    const criticalAlerts = alerts.filter(alert => alert.severity === 'CRITICAL');
    if (criticalAlerts.length > 0) {
      this.fatal('CRITICAL SYSTEM ALERTS', {
        ...healthContext,
        criticalAlerts,
        alertLevel: 'CRITICAL'
      });
      this.writeToYieldLog('yield-critical', 'Critical system alerts detected', {
        ...healthContext,
        criticalAlerts
      });
    }
  }

  /**
   * Log configuration changes
   */
  configChange(configType, changes, user, impact = {}) {
    const configContext = {
      category: 'configuration',
      configType,
      changes: {
        previousValues: changes.previousValues || {},
        newValues: changes.newValues || {}
      },
      user: {
        id: user.id,
        role: user.role,
        email: user.email
      },
      impact: {
        scope: impact.scope || 'UNKNOWN',
        affectedHotels: impact.affectedHotels || 0,
        riskLevel: impact.riskLevel || 'MEDIUM',
        requiresRestart: impact.requiresRestart || false
      }
    };

    const message = `Configuration changed: ${configType} by ${user.email}`;
    this.winston.info(message, this.enrichContext(configContext, 'info'));
    this.writeToYieldLog('yield-config', message, configContext);

    // High-risk configuration changes
    if (impact.riskLevel === 'HIGH') {
      this.warn('HIGH RISK CONFIGURATION CHANGE', {
        ...configContext,
        riskFlag: 'HIGH_RISK_CONFIG_CHANGE'
      });
    }
  }

  // ================================
  // APPLICATION LIFECYCLE
  // ================================

  /**
   * Log application startup
   */
  startup(message, startupData = {}) {
    const context = {
      category: 'startup',
      port: startupData.port,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
      mongoUri: startupData.mongoUri ? 'Connected' : 'Not configured',
      yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
      features: startupData.features || [],
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
    
    this.winston.info(`🚀 ${message}`, this.enrichContext(context, 'info'));
    this.writeToYieldLog('yield-system', `Application startup: ${message}`, context);
  }

  /**
   * Log application shutdown
   */
  shutdown(message, shutdownData = {}) {
    const context = {
      category: 'shutdown',
      reason: shutdownData.reason,
      graceful: shutdownData.graceful,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
    
    this.winston.info(`🛑 ${message}`, this.enrichContext(context, 'info'));
    this.writeToYieldLog('yield-system', `Application shutdown: ${message}`, context);
  }

  // ================================
  // LOG MANAGEMENT
  // ================================

  /**
   * Set log level dynamically
   */
  setLevel(level) {
    this.winston.level = level;
    this.info(`Log level changed to: ${level}`);
  }

  /**
   * Get current log level
   */
  getLevel() {
    return this.winston.level;
  }

  /**
   * Health check for logging system
   */
  healthCheck() {
    try {
      this.info('Logger health check performed');
      return {
        status: 'healthy',
        level: this.winston.level,
        transports: this.winston.transports.length,
        yieldLogging: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get logging statistics
   */
  getStats() {
    return {
      level: this.winston.level,
      transports: this.winston.transports.length,
      yieldLogging: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
      environment: process.env.NODE_ENV,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage()
    };
  }

  // ================================
  // LOG ROTATION AND CLEANUP
  // ================================

  /**
   * Setup automatic log rotation
   */
  setupLogRotation() {
    const rotationInterval = parseInt(process.env.LOG_ROTATION_INTERVAL || '86400000'); // 24 hours
    
    setInterval(() => {
      this.rotateLogsNow();
    }, rotationInterval);

    this.info('Log rotation scheduled', { interval: rotationInterval });
  }

  /**
   * Perform log rotation immediately
   */
  rotateLogsNow() {
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      const archiveDir = path.join(logsDir, 'archive', moment().format('YYYY-MM-DD'));
      
      // Create archive directory
      if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
      }

      // Rotate main logs
      this.rotateLogFiles(logsDir, archiveDir);
      
      // Rotate yield logs
      const yieldDir = path.join(logsDir, 'yield');
      const yieldArchiveDir = path.join(archiveDir, 'yield');
      if (!fs.existsSync(yieldArchiveDir)) {
        fs.mkdirSync(yieldArchiveDir, { recursive: true });
      }
      this.rotateLogFiles(yieldDir, yieldArchiveDir);

      this.info('Log rotation completed successfully');
      
    } catch (error) {
      this.error('Log rotation failed', { error: error.message });
    }
  }

  /**
   * Rotate log files in a directory
   */
  rotateLogFiles(sourceDir, archiveDir) {
    const logFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.log'));
    
    logFiles.forEach(file => {
      const source = path.join(sourceDir, file);
      const destination = path.join(archiveDir, `${moment().format('HH-mm-ss')}-${file}`);
      
      try {
        fs.copyFileSync(source, destination);
        fs.writeFileSync(source, ''); // Clear the original file
      } catch (error) {
        this.error(`Failed to rotate log file ${file}`, { error: error.message });
      }
    });
  }

  // ================================
  // INITIALIZATION
  // ================================

  /**
   * Initialize the ultimate logging system
   */
  initialize() {
    ensureLogDirectories();
    
    // Setup log rotation if enabled
    if (process.env.LOG_ROTATION === 'true') {
      this.setupLogRotation();
    }

    // Log initialization
    this.startup('Ultimate Hotel Logger initialized', {
      yieldManagement: process.env.YIELD_MANAGEMENT_ENABLED === 'true',
      logLevel: this.winston.level,
      version: '2.0.0',
      features: [
        'winston-integration',
        'yield-management',
        'http-middleware',
        'log-rotation',
        'performance-monitoring',
        'security-logging'
      ]
    });

    return this;
  }
}

// ================================
// SINGLETON INSTANCE
// ================================

const ultimateLogger = new UltimateHotelLogger(winstonLogger);

// ================================
// GRACEFUL SHUTDOWN HANDLING
// ================================

process.on('SIGINT', () => {
  ultimateLogger.shutdown('Application shutting down (SIGINT)', { 
    graceful: true, 
    reason: 'SIGINT' 
  });
  winstonLogger.end();
});

process.on('SIGTERM', () => {
  ultimateLogger.shutdown('Application shutting down (SIGTERM)', { 
    graceful: true, 
    reason: 'SIGTERM' 
  });
  winstonLogger.end();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  ultimateLogger.fatal('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
    category: 'fatal'
  });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  ultimateLogger.fatal('Unhandled Promise Rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack,
    category: 'promise-rejection'
  });
});

// ================================
// EXPORTS
// ================================

module.exports = {
  // Main logger instance
  logger: ultimateLogger,
  
  // Initialize the logging system
  initializeLogging: () => ultimateLogger.initialize(),
  
  // Winston instance for direct access if needed
  winston: winstonLogger,
  
  // Middleware functions
  requestLogger: () => ultimateLogger.requestLogger(),
  errorLogger: () => ultimateLogger.errorLogger(),
  
  // Utility functions for external use
  isYieldManagementRequest,
  extractYieldOperation,
  sanitizeData,
  getClientIP,
  getUserAgent,
  formatResponseTime,
  
  // Direct access to specialized logging methods
  yieldLogger: ultimateLogger.yield.bind(ultimateLogger),
  priceCalculationLogger: ultimateLogger.priceCalculation.bind(ultimateLogger),
  revenueOptimizationLogger: ultimateLogger.revenueOptimization.bind(ultimateLogger),
  yieldPerformanceLogger: ultimateLogger.performance.bind(ultimateLogger),
  yieldAuditLogger: ultimateLogger.yieldAudit.bind(ultimateLogger),
  yieldJobLogger: ultimateLogger.yieldJob.bind(ultimateLogger),
  
  // Business logging
  bookingLogger: ultimateLogger.booking.bind(ultimateLogger),
  securityLogger: ultimateLogger.security.bind(ultimateLogger),
  analyticsLogger: ultimateLogger.analytics.bind(ultimateLogger),
  
  // System monitoring
  systemHealthLogger: ultimateLogger.systemHealth.bind(ultimateLogger),
  
  // Configuration
  setLogLevel: ultimateLogger.setLevel.bind(ultimateLogger),
  getLogLevel: ultimateLogger.getLevel.bind(ultimateLogger),
  healthCheck: ultimateLogger.healthCheck.bind(ultimateLogger)
};