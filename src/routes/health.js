/**
 * HEALTH & METRICS ROUTES - API ENDPOINTS
 * Routes pour health checks, métriques et dashboards de monitoring
 * 
 * Fonctionnalités :
 * - Health check endpoints (system, redis, qr, database)
 * - Metrics API (Prometheus-style, custom formats)
 * - Dashboard data endpoints (real-time, historical, executive)
 * - Alert management endpoints
 * - Performance analytics
 */

const express = require('express');
const router = express.Router();
const { logger } = require('../utils/logger');
const { monitoringService } = require('../utils/monitoring');
const auth = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

/**
 * ================================
 * RATE LIMITING MIDDLEWARE
 * ================================
 */

// Basic rate limiting for health endpoints
const healthRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: {
    error: 'Too many health check requests',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

// More restrictive rate limiting for metrics endpoints
const metricsRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 requests per minute
  message: {
    error: 'Too many metrics requests',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Admin-only rate limiting for sensitive endpoints
const adminRateLimit = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 requests per minute
  message: {
    error: 'Too many admin requests',
    retryAfter: 60
  },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * ================================
 * MIDDLEWARE HELPERS
 * ================================
 */

// Middleware to check if monitoring is enabled
const checkMonitoringEnabled = (req, res, next) => {
  if (process.env.MONITORING_ENABLED === 'false') {
    return res.status(503).json({
      error: 'Monitoring service is disabled',
      message: 'Monitoring functionality is currently unavailable'
    });
  }
  next();
};

// Middleware to add response headers
const addResponseHeaders = (req, res, next) => {
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    'X-Monitoring-Version': '1.0.0'
  });
  next();
};

// Apply middleware to all routes
router.use(healthRateLimit);
router.use(checkMonitoringEnabled);
router.use(addResponseHeaders);

/**
 * ================================
 * BASIC HEALTH CHECK ENDPOINTS
 * ================================
 */

/**
 * @route   GET /health
 * @desc    Overall system health check
 * @access  Public
 */
router.get('/', async (req, res) => {
  try {
    const startTime = Date.now();
    const healthSummary = monitoringService.getHealthSummary();
    const responseTime = Date.now() - startTime;
    
    // Determine HTTP status based on health
    let httpStatus = 200;
    if (healthSummary.overall.status === 'CRITICAL') {
      httpStatus = 503; // Service Unavailable
    } else if (healthSummary.overall.status === 'POOR') {
      httpStatus = 503; // Service Unavailable
    } else if (healthSummary.overall.status === 'FAIR') {
      httpStatus = 200; // OK but with warnings
    }
    
    const response = {
      status: healthSummary.overall.status,
      score: healthSummary.overall.score,
      message: getHealthMessage(healthSummary.overall.status),
      components: healthSummary.components,
      alerts: {
        total: healthSummary.alertsCount,
        critical: healthSummary.criticalAlerts
      },
      timestamp: new Date(),
      responseTime: `${responseTime}ms`,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development'
    };
    
    res.status(httpStatus).json(response);
    
  } catch (error) {
    logger.error('Health check error:', error);
    res.status(500).json({
      status: 'ERROR',
      message: 'Health check failed',
      error: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /health/live
 * @desc    Kubernetes-style liveness probe
 * @access  Public
 */
router.get('/live', (req, res) => {
  // Simple liveness check - just verify the service is running
  res.status(200).json({
    status: 'ALIVE',
    timestamp: new Date(),
    uptime: process.uptime(),
    pid: process.pid
  });
});

/**
 * @route   GET /health/ready
 * @desc    Kubernetes-style readiness probe
 * @access  Public
 */
router.get('/ready', async (req, res) => {
  try {
    const healthSummary = monitoringService.getHealthSummary();
    
    // Service is ready if overall score > 60 and no critical alerts
    const isReady = healthSummary.overall.score > 60 && healthSummary.criticalAlerts === 0;
    
    const response = {
      status: isReady ? 'READY' : 'NOT_READY',
      score: healthSummary.overall.score,
      criticalAlerts: healthSummary.criticalAlerts,
      timestamp: new Date()
    };
    
    res.status(isReady ? 200 : 503).json(response);
    
  } catch (error) {
    logger.error('Readiness check error:', error);
    res.status(503).json({
      status: 'NOT_READY',
      error: 'Readiness check failed',
      timestamp: new Date()
    });
  }
});

/**
 * ================================
 * COMPONENT-SPECIFIC HEALTH CHECKS
 * ================================
 */

/**
 * @route   GET /health/redis
 * @desc    Redis-specific health check
 * @access  Public
 */
router.get('/redis', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const cacheHealth = metrics.components.cache;
    
    const response = {
      status: cacheHealth.status,
      score: cacheHealth.score,
      metrics: cacheHealth.metrics,
      details: metrics.detailed.cache.health,
      lastCheck: cacheHealth.lastUpdated,
      timestamp: new Date()
    };
    
    const httpStatus = cacheHealth.status === 'CRITICAL' ? 503 : 200;
    res.status(httpStatus).json(response);
    
  } catch (error) {
    logger.error('Redis health check error:', error);
    res.status(503).json({
      status: 'ERROR',
      error: 'Redis health check failed',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /health/qr
 * @desc    QR system health check
 * @access  Public
 */
router.get('/qr', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const qrHealth = metrics.components.qr;
    
    const response = {
      status: qrHealth.status,
      score: qrHealth.score,
      metrics: qrHealth.metrics,
      performance: metrics.detailed.qr.current,
      lastCheck: qrHealth.lastUpdated,
      timestamp: new Date()
    };
    
    const httpStatus = qrHealth.status === 'CRITICAL' ? 503 : 200;
    res.status(httpStatus).json(response);
    
  } catch (error) {
    logger.error('QR health check error:', error);
    res.status(503).json({
      status: 'ERROR',
      error: 'QR health check failed',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /health/database
 * @desc    Database health check
 * @access  Public
 */
router.get('/database', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const systemMetrics = metrics.detailed.system.current;
    const dbHealth = systemMetrics.database;
    
    const response = {
      status: dbHealth.status,
      responseTime: `${dbHealth.responseTime}ms`,
      connections: dbHealth.connections,
      lastCheck: dbHealth.lastCheck,
      timestamp: new Date()
    };
    
    const httpStatus = dbHealth.status !== 'CONNECTED' ? 503 : 200;
    res.status(httpStatus).json(response);
    
  } catch (error) {
    logger.error('Database health check error:', error);
    res.status(503).json({
      status: 'ERROR',
      error: 'Database health check failed',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /health/integrations
 * @desc    All integrations health check
 * @access  Public
 */
router.get('/integrations', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const systemMetrics = metrics.detailed.system.current;
    const integrations = systemMetrics.integrations;
    
    const response = {
      integrations: Object.entries(integrations).map(([name, health]) => ({
        name,
        status: health.status,
        responseTime: `${health.responseTime}ms`,
        lastCheck: health.lastCheck,
        error: health.error || null
      })),
      summary: {
        total: Object.keys(integrations).length,
        healthy: Object.values(integrations).filter(i => i.status === 'HEALTHY').length,
        unhealthy: Object.values(integrations).filter(i => i.status !== 'HEALTHY').length
      },
      timestamp: new Date()
    };
    
    const allHealthy = response.summary.unhealthy === 0;
    res.status(allHealthy ? 200 : 503).json(response);
    
  } catch (error) {
    logger.error('Integrations health check error:', error);
    res.status(503).json({
      status: 'ERROR',
      error: 'Integrations health check failed',
      timestamp: new Date()
    });
  }
});

/**
 * ================================
 * METRICS API ENDPOINTS
 * ================================
 */

// Apply metrics rate limiting to these endpoints
router.use('/metrics', metricsRateLimit);

/**
 * @route   GET /metrics
 * @desc    Prometheus-style metrics endpoint
 * @access  Public
 */
router.get('/metrics', async (req, res) => {
  try {
    const prometheusMetrics = monitoringService.getPrometheusMetrics();
    
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(prometheusMetrics);
    
  } catch (error) {
    logger.error('Prometheus metrics error:', error);
    res.status(500).send('# Error generating metrics\n');
  }
});

/**
 * @route   GET /metrics/json
 * @desc    JSON format metrics
 * @access  Public
 */
router.get('/metrics/json', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    
    const response = {
      timestamp: new Date(),
      overall: metrics.overall,
      components: metrics.components,
      summary: {
        alerts: metrics.alerts.length,
        recommendations: metrics.recommendations.length,
        criticalIssues: metrics.alerts.filter(a => a.severity === 'CRITICAL').length
      }
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('JSON metrics error:', error);
    res.status(500).json({
      error: 'Failed to generate metrics',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /metrics/cache
 * @desc    Cache-specific metrics
 * @access  Public
 */
router.get('/metrics/cache', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const cacheMetrics = metrics.detailed.cache;
    
    const response = {
      current: cacheMetrics.current,
      health: cacheMetrics.health,
      trends: cacheMetrics.trends,
      recommendations: cacheMetrics.recommendations,
      alerts: metrics.alerts.filter(a => a.source === 'CACHE'),
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Cache metrics error:', error);
    res.status(500).json({
      error: 'Failed to generate cache metrics',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /metrics/qr
 * @desc    QR-specific metrics
 * @access  Public
 */
router.get('/metrics/qr', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const qrMetrics = metrics.detailed.qr;
    
    const response = {
      current: qrMetrics.current,
      health: qrMetrics.health,
      analytics: qrMetrics.analytics,
      trends: qrMetrics.trends,
      alerts: metrics.alerts.filter(a => a.source === 'QR'),
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('QR metrics error:', error);
    res.status(500).json({
      error: 'Failed to generate QR metrics',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /metrics/performance
 * @desc    Performance metrics
 * @access  Public
 */
router.get('/metrics/performance', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const systemMetrics = metrics.detailed.system;
    
    const response = {
      system: {
        cpu: systemMetrics.current.system.cpuUsage,
        memory: systemMetrics.current.system.memoryUsage,
        uptime: systemMetrics.current.application.uptime,
        loadAverage: systemMetrics.current.system.loadAverage
      },
      application: {
        requestsPerSecond: systemMetrics.current.performance.requestsPerSecond,
        avgResponseTime: systemMetrics.current.performance.avgResponseTime,
        errorRate: systemMetrics.current.performance.errorRate,
        activeConnections: systemMetrics.current.performance.activeConnections
      },
      cache: {
        hitRate: metrics.detailed.cache.current.hitRate,
        responseTime: metrics.detailed.cache.current.responseTime.avg,
        memoryUsage: metrics.detailed.cache.current.memoryUsage.percentage
      },
      qr: {
        successRate: metrics.detailed.qr.current.checkIn.successRate,
        usageRate: metrics.detailed.qr.current.usage.rate,
        avgCheckInTime: metrics.detailed.qr.current.checkIn.avgTime
      },
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Performance metrics error:', error);
    res.status(500).json({
      error: 'Failed to generate performance metrics',
      timestamp: new Date()
    });
  }
});

/**
 * ================================
 * DASHBOARD DATA ENDPOINTS
 * ================================
 */

// Apply admin authentication to dashboard endpoints
router.use('/dashboard', auth, adminRateLimit);

/**
 * @route   GET /dashboard/realtime
 * @desc    Real-time dashboard data
 * @access  Admin
 */
router.get('/dashboard/realtime', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    
    const response = {
      overview: {
        status: metrics.overall.status,
        score: metrics.overall.score,
        lastUpdated: metrics.overall.lastUpdated
      },
      components: metrics.components,
      recentAlerts: metrics.alerts.slice(0, 10),
      criticalAlerts: metrics.alerts.filter(a => a.severity === 'CRITICAL').slice(0, 5),
      systemLoad: {
        cpu: metrics.detailed.system.current.system.cpuUsage,
        memory: metrics.detailed.system.current.system.memoryUsage.percentage,
        requests: metrics.detailed.system.current.performance.requestsPerSecond
      },
      cachePerformance: {
        hitRate: metrics.detailed.cache.current.hitRate,
        responseTime: metrics.detailed.cache.current.responseTime.avg,
        operations: metrics.detailed.cache.current.operations
      },
      qrActivity: {
        successRate: metrics.detailed.qr.current.checkIn.successRate,
        usageRate: metrics.detailed.qr.current.usage.rate,
        recentActivity: metrics.detailed.qr.current.generation.total
      },
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Real-time dashboard error:', error);
    res.status(500).json({
      error: 'Failed to generate real-time dashboard data',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /dashboard/historical
 * @desc    Historical trends dashboard data
 * @access  Admin
 */
router.get('/dashboard/historical', async (req, res) => {
  try {
    const period = req.query.period || '24h';
    const metrics = monitoringService.getMetrics();
    
    const response = {
      period,
      trends: {
        cache: {
          hitRate: metrics.detailed.cache.trends.hitRate.slice(-24),
          responseTime: metrics.detailed.cache.trends.responseTime.slice(-24),
          memoryUsage: metrics.detailed.cache.trends.memoryUsage.slice(-24)
        },
        qr: {
          usage: metrics.detailed.qr.trends.usage.slice(-24),
          checkIn: metrics.detailed.qr.trends.checkIn.slice(-24),
          generation: metrics.detailed.qr.trends.generation.slice(-24)
        },
        system: {
          performance: metrics.detailed.system.historical.slice(-24).map(h => ({
            timestamp: h.timestamp,
            cpu: h.system.cpuUsage,
            memory: h.system.memoryUsage.percentage,
            responseTime: h.performance.avgResponseTime
          }))
        }
      },
      alerts: {
        byHour: groupAlertsByTime(metrics.alerts, 'hour'),
        byDay: groupAlertsByTime(metrics.alerts, 'day'),
        bySeverity: groupAlertsBySeverity(metrics.alerts)
      },
      recommendations: metrics.recommendations,
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Historical dashboard error:', error);
    res.status(500).json({
      error: 'Failed to generate historical dashboard data',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /dashboard/executive
 * @desc    Executive-level KPI dashboard
 * @access  Admin
 */
router.get('/dashboard/executive', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    
    // Calculate KPIs
    const systemUptime = (metrics.detailed.system.current.application.uptime / 3600).toFixed(1);
    const overallEfficiency = calculateSystemEfficiency(metrics);
    const costSavings = calculateCostSavings(metrics);
    
    const response = {
      kpis: {
        systemHealth: {
          score: metrics.overall.score,
          status: metrics.overall.status,
          uptime: `${systemUptime} hours`
        },
        performance: {
          efficiency: `${overallEfficiency}%`,
          cacheHitRate: `${metrics.detailed.cache.current.hitRate}%`,
          qrSuccessRate: `${metrics.detailed.qr.current.checkIn.successRate}%`
        },
        business: {
          qrAdoption: `${metrics.detailed.qr.current.business.adoptionRate}%`,
          costSavings: `€${costSavings}`,
          userSatisfaction: `${metrics.detailed.qr.current.business.userSatisfaction}%`
        },
        reliability: {
          errorRate: `${metrics.detailed.system.current.performance.errorRate}%`,
          alertsCount: metrics.alerts.length,
          criticalIssues: metrics.alerts.filter(a => a.severity === 'CRITICAL').length
        }
      },
      trends: {
        systemHealth: calculateTrend(metrics.components, 'score'),
        performance: calculateTrend(metrics.detailed.cache.trends, 'hitRate'),
        adoption: calculateTrend(metrics.detailed.qr.trends, 'usage')
      },
      recommendations: metrics.recommendations.filter(r => r.priority === 'HIGH'),
      alerts: {
        recent: metrics.alerts.slice(0, 5),
        critical: metrics.alerts.filter(a => a.severity === 'CRITICAL')
      },
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Executive dashboard error:', error);
    res.status(500).json({
      error: 'Failed to generate executive dashboard data',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /dashboard/technical
 * @desc    Technical operations dashboard
 * @access  Admin
 */
router.get('/dashboard/technical', async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    
    const response = {
      systemStatus: {
        components: metrics.components,
        integrations: metrics.detailed.system.current.integrations,
        database: metrics.detailed.system.current.database
      },
      performance: {
        system: {
          cpu: metrics.detailed.system.current.system.cpuUsage,
          memory: metrics.detailed.system.current.system.memoryUsage,
          loadAverage: metrics.detailed.system.current.system.loadAverage
        },
        cache: {
          current: metrics.detailed.cache.current,
          health: metrics.detailed.cache.health
        },
        qr: {
          current: metrics.detailed.qr.current,
          health: metrics.detailed.qr.health
        }
      },
      operations: {
        alerts: metrics.alerts,
        recommendations: metrics.recommendations,
        recentEvents: getRecentOperationalEvents(metrics)
      },
      configuration: {
        environment: process.env.NODE_ENV,
        version: process.env.npm_package_version,
        features: {
          caching: metrics.detailed.cache.current ? 'ENABLED' : 'DISABLED',
          qrCodes: metrics.detailed.qr.current ? 'ENABLED' : 'DISABLED',
          monitoring: 'ENABLED'
        }
      },
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Technical dashboard error:', error);
    res.status(500).json({
      error: 'Failed to generate technical dashboard data',
      timestamp: new Date()
    });
  }
});

/**
 * ================================
 * ALERT MANAGEMENT ENDPOINTS
 * ================================
 */

/**
 * @route   GET /alerts
 * @desc    Get system alerts
 * @access  Admin
 */
router.get('/alerts', auth, async (req, res) => {
  try {
    const { severity, source, limit = 50, offset = 0 } = req.query;
    const metrics = monitoringService.getMetrics();
    
    let alerts = metrics.alerts;
    
    // Filter by severity
    if (severity) {
      alerts = alerts.filter(a => a.severity === severity.toUpperCase());
    }
    
    // Filter by source
    if (source) {
      alerts = alerts.filter(a => a.source === source.toUpperCase());
    }
    
    // Pagination
    const total = alerts.length;
    const paginatedAlerts = alerts.slice(parseInt(offset), parseInt(offset) + parseInt(limit));
    
    const response = {
      alerts: paginatedAlerts,
      pagination: {
        total,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: total > parseInt(offset) + parseInt(limit)
      },
      summary: {
        bySeverity: groupAlertsBySeverity(alerts),
        bySource: groupAlertsBySource(alerts),
        recent: alerts.filter(a => 
          (Date.now() - new Date(a.timestamp).getTime()) < 60 * 60 * 1000
        ).length
      },
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Alerts endpoint error:', error);
    res.status(500).json({
      error: 'Failed to retrieve alerts',
      timestamp: new Date()
    });
  }
});

/**
 * @route   GET /alerts/critical
 * @desc    Get critical alerts only
 * @access  Admin
 */
router.get('/alerts/critical', auth, async (req, res) => {
  try {
    const metrics = monitoringService.getMetrics();
    const criticalAlerts = metrics.alerts.filter(a => a.severity === 'CRITICAL');
    
    const response = {
      alerts: criticalAlerts,
      count: criticalAlerts.length,
      timestamp: new Date()
    };
    
    res.json(response);
    
  } catch (error) {
    logger.error('Critical alerts endpoint error:', error);
    res.status(500).json({
      error: 'Failed to retrieve critical alerts',
      timestamp: new Date()
    });
  }
});

/**
 * ================================
 * UTILITY FUNCTIONS
 * ================================
 */

/**
 * Get health message based on status
 */
function getHealthMessage(status) {
  const messages = {
    'EXCELLENT': 'All systems operating optimally',
    'GOOD': 'Systems performing well',
    'FAIR': 'Some performance issues detected',
    'POOR': 'Multiple issues require attention',
    'CRITICAL': 'Critical system issues detected',
    'UNKNOWN': 'Health status unavailable'
  };
  
  return messages[status] || 'Unknown health status';
}

/**
 * Group alerts by time period
 */
function groupAlertsByTime(alerts, period) {
  const grouped = {};
  
  alerts.forEach(alert => {
    const date = new Date(alert.timestamp);
    let key;
    
    if (period === 'hour') {
      key = `${date.getHours()}:00`;
    } else if (period === 'day') {
      key = date.toISOString().split('T')[0];
    } else {
      key = date.toISOString();
    }
    
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(alert);
  });
  
  return grouped;
}

/**
 * Group alerts by severity
 */
function groupAlertsBySeverity(alerts) {
  return alerts.reduce((acc, alert) => {
    const severity = alert.severity || 'UNKNOWN';
    acc[severity] = (acc[severity] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Group alerts by source
 */
function groupAlertsBySource(alerts) {
  return alerts.reduce((acc, alert) => {
    const source = alert.source || 'UNKNOWN';
    acc[source] = (acc[source] || 0) + 1;
    return acc;
  }, {});
}

/**
 * Calculate system efficiency
 */
function calculateSystemEfficiency(metrics) {
  const cacheEfficiency = metrics.detailed.cache.current.hitRate || 0;
  const qrEfficiency = metrics.detailed.qr.current.checkIn.successRate || 0;
  const systemEfficiency = 100 - (metrics.detailed.system.current.performance.errorRate || 0);
  
  return Math.round((cacheEfficiency + qrEfficiency + systemEfficiency) / 3);
}

/**
 * Calculate cost savings
 */
function calculateCostSavings(metrics) {
  const qrCostSavings = metrics.detailed.qr.current.business.costSavings || 0;
  const cacheEfficiencySavings = (metrics.detailed.cache.current.hitRate || 0) * 0.1; // Estimate
  
  return Math.round((qrCostSavings + cacheEfficiencySavings) * 100) / 100;
}

/**
 * Calculate trend direction
 */
function calculateTrend(data, field) {
  if (!data || !Array.isArray(data) || data.length < 2) return 'STABLE';
  
  const recent = data.slice(-5);
  const older = data.slice(-10, -5);
  
  if (recent.length === 0 || older.length === 0) return 'STABLE';
  
  const recentAvg = recent.reduce((sum, item) => {
    const value = typeof item === 'object' ? item[field] : item;
    return sum + (value || 0);
  }, 0) / recent.length;
  
  const olderAvg = older.reduce((sum, item) => {
    const value = typeof item === 'object' ? item[field] : item;
    return sum + (value || 0);
  }, 0) / older.length;
  
  const change = ((recentAvg - olderAvg) / olderAvg) * 100;
  
  if (change > 5) return 'IMPROVING';
  if (change < -5) return 'DECLINING';
  return 'STABLE';
}

/**
 * Get recent operational events
 */
function getRecentOperationalEvents(metrics) {
  const events = [];
  
  // Add recent alerts as events
  metrics.alerts.slice(0, 5).forEach(alert => {
    events.push({
      type: 'ALERT',
      severity: alert.severity,
      message: alert.message,
      timestamp: alert.timestamp,
      source: alert.source
    });
  });
  
  // Add system events
  if (metrics.detailed.system.current.application.uptime < 3600) {
    events.push({
      type: 'SYSTEM_START',
      severity: 'INFO',
      message: 'System recently started',
      timestamp: new Date(Date.now() - metrics.detailed.system.current.application.uptime * 1000),
      source: 'SYSTEM'
    });
  }
  
  // Sort by timestamp
  return events.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
}

/**
 * ================================
 * ERROR HANDLING MIDDLEWARE
 * ================================
 */

// Global error handler for this router
router.use((error, req, res, next) => {
  logger.error('Health/Metrics route error:', error);
  
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'An unexpected error occurred',
    timestamp: new Date(),
    path: req.path
  });
});

module.exports = router;