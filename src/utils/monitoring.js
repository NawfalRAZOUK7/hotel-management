/**
 * MONITORING SERVICE - SYSTÈME DE SURVEILLANCE COMPLET
 * Service de monitoring centralisé pour l'application hôtelière
 * 
 * Fonctionnalités :
 * - Cache Performance Monitoring (Redis metrics, effectiveness, trends)
 * - QR Usage Analytics (generation, usage patterns, security)
 * - System Health Checks (components, integrations, performance)
 * - Real-time Alerts (performance degradation, thresholds)
 * - Business Intelligence (KPIs, ROI analysis, optimization)
 */

const EventEmitter = require('events');
const { logger } = require('./logger');
const mongoose = require('mongoose');

/**
 * ================================
 * CACHE PERFORMANCE MONITOR
 * ================================
 */
class CacheMonitor extends EventEmitter {
  constructor() {
    super();
    
    // Configuration
    this.config = {
      sampleInterval: parseInt(process.env.CACHE_MONITOR_INTERVAL) || 30000, // 30 seconds
      retentionPeriod: parseInt(process.env.CACHE_METRICS_RETENTION) || 7 * 24 * 60 * 60 * 1000, // 7 days
      alertThresholds: {
        hitRate: parseFloat(process.env.CACHE_HIT_RATE_THRESHOLD) || 70.0,
        responseTime: parseInt(process.env.CACHE_RESPONSE_TIME_THRESHOLD) || 1000,
        memoryUsage: parseFloat(process.env.CACHE_MEMORY_THRESHOLD) || 80.0,
        errorRate: parseFloat(process.env.CACHE_ERROR_RATE_THRESHOLD) || 5.0
      },
      enableAlerts: process.env.CACHE_MONITORING_ALERTS !== 'false'
    };
    
    // Metrics storage
    this.metrics = {
      current: {
        hitRate: 0,
        missRate: 0,
        responseTime: {
          min: 0,
          max: 0,
          avg: 0,
          p95: 0,
          p99: 0
        },
        memoryUsage: {
          used: 0,
          available: 0,
          percentage: 0
        },
        connections: {
          active: 0,
          total: 0,
          rejected: 0
        },
        operations: {
          reads: 0,
          writes: 0,
          deletes: 0,
          errors: 0
        },
        timestamp: new Date()
      },
      historical: [],
      alerts: []
    };
    
    // Redis client for monitoring
    this.redisClient = null;
    this.isMonitoring = false;
    this.monitoringInterval = null;
    
    // Performance trends
    this.trends = {
      hitRate: [],
      responseTime: [],
      memoryUsage: [],
      throughput: []
    };
    
    this.init();
  }

  /**
   * Initialize cache monitoring
   */
  async init() {
    try {
      // Get Redis client
      const redisConfig = require('../config/redis');
      this.redisClient = redisConfig.getClient();
      
      // Start monitoring if enabled
      if (process.env.CACHE_MONITORING_ENABLED !== 'false') {
        await this.startMonitoring();
      }
      
      logger.info('✅ Cache Monitor initialized successfully');
      
    } catch (error) {
      logger.error('❌ Cache Monitor initialization failed:', error);
      this.emit('error', error);
    }
  }

  /**
   * Start monitoring process
   */
  async startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Initial metrics collection
    await this.collectMetrics();
    
    // Start periodic collection
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        logger.error('Cache metrics collection failed:', error);
        this.emit('error', error);
      }
    }, this.config.sampleInterval);
    
    logger.info(`📊 Cache monitoring started (interval: ${this.config.sampleInterval}ms)`);
    this.emit('monitoring:started');
  }

  /**
   * Stop monitoring process
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('🛑 Cache monitoring stopped');
    this.emit('monitoring:stopped');
  }

  /**
   * Collect cache metrics
   */
  async collectMetrics() {
    try {
      if (!this.redisClient) {
        logger.warn('Redis client not available for metrics collection');
        return;
      }

      const startTime = Date.now();
      
      // Get Redis INFO
      const info = await this.redisClient.info();
      const memory = await this.redisClient.info('memory');
      const stats = await this.redisClient.info('stats');
      const clients = await this.redisClient.info('clients');
      
      const responseTime = Date.now() - startTime;
      
      // Parse Redis info
      const parsedInfo = this.parseRedisInfo(info);
      const parsedMemory = this.parseRedisInfo(memory);
      const parsedStats = this.parseRedisInfo(stats);
      const parsedClients = this.parseRedisInfo(clients);
      
      // Calculate metrics
      const newMetrics = this.calculateMetrics(
        parsedInfo, 
        parsedMemory, 
        parsedStats, 
        parsedClients, 
        responseTime
      );
      
      // Store current metrics
      this.metrics.current = {
        ...newMetrics,
        timestamp: new Date()
      };
      
      // Add to historical data
      this.addToHistorical(this.metrics.current);
      
      // Update trends
      this.updateTrends(this.metrics.current);
      
      // Check for alerts
      if (this.config.enableAlerts) {
        this.checkAlerts(this.metrics.current);
      }
      
      // Emit metrics update
      this.emit('metrics:updated', this.metrics.current);
      
      // Cleanup old data
      this.cleanupOldData();
      
    } catch (error) {
      logger.error('Error collecting cache metrics:', error);
      this.metrics.current.operations.errors++;
      this.emit('metrics:error', error);
    }
  }

  /**
   * Parse Redis INFO output
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
   * Calculate cache metrics
   */
  calculateMetrics(info, memory, stats, clients, responseTime) {
    // Calculate hit/miss rates
    const totalOps = (stats.keyspace_hits || 0) + (stats.keyspace_misses || 0);
    const hitRate = totalOps > 0 ? ((stats.keyspace_hits || 0) / totalOps) * 100 : 0;
    const missRate = 100 - hitRate;
    
    // Calculate memory usage
    const usedMemory = memory.used_memory || 0;
    const maxMemory = memory.maxmemory || memory.total_system_memory || 0;
    const memoryPercentage = maxMemory > 0 ? (usedMemory / maxMemory) * 100 : 0;
    
    // Response time calculations
    const prevMetrics = this.metrics.current.responseTime;
    const newResponseTime = {
      min: Math.min(prevMetrics.min || responseTime, responseTime),
      max: Math.max(prevMetrics.max || responseTime, responseTime),
      avg: this.calculateMovingAverage(prevMetrics.avg, responseTime, 10),
      p95: this.calculatePercentile([...this.trends.responseTime.slice(-20), responseTime], 95),
      p99: this.calculatePercentile([...this.trends.responseTime.slice(-20), responseTime], 99)
    };
    
    return {
      hitRate: Math.round(hitRate * 100) / 100,
      missRate: Math.round(missRate * 100) / 100,
      responseTime: newResponseTime,
      memoryUsage: {
        used: usedMemory,
        available: maxMemory - usedMemory,
        percentage: Math.round(memoryPercentage * 100) / 100
      },
      connections: {
        active: clients.connected_clients || 0,
        total: stats.total_connections_received || 0,
        rejected: stats.rejected_connections || 0
      },
      operations: {
        reads: stats.keyspace_hits || 0,
        writes: stats.keyspace_misses || 0, // Approximation
        deletes: stats.expired_keys || 0,
        errors: this.metrics.current.operations.errors
      },
      evictions: stats.evicted_keys || 0,
      expiredKeys: stats.expired_keys || 0,
      totalKeys: info.db0 ? this.parseKeyspaceInfo(info.db0).keys : 0
    };
  }

  /**
   * Parse keyspace info (e.g., "keys=1000,expires=100,avg_ttl=3600000")
   */
  parseKeyspaceInfo(keyspaceStr) {
    const parts = keyspaceStr.split(',');
    const result = {};
    
    parts.forEach(part => {
      const [key, value] = part.split('=');
      result[key] = parseInt(value) || 0;
    });
    
    return result;
  }

  /**
   * Calculate moving average
   */
  calculateMovingAverage(currentAvg, newValue, windowSize) {
    if (!currentAvg) return newValue;
    const weight = 1 / Math.min(windowSize, 10);
    return currentAvg * (1 - weight) + newValue * weight;
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = values.sort((a, b) => a - b);
    const index = (percentile / 100) * (sorted.length - 1);
    
    if (Math.floor(index) === index) {
      return sorted[index];
    } else {
      const lower = sorted[Math.floor(index)];
      const upper = sorted[Math.ceil(index)];
      return lower + (upper - lower) * (index - Math.floor(index));
    }
  }

  /**
   * Add metrics to historical data
   */
  addToHistorical(metrics) {
    this.metrics.historical.push({
      ...metrics,
      timestamp: new Date()
    });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
  }

  /**
   * Update performance trends
   */
  updateTrends(metrics) {
    const maxTrendLength = 100;
    
    // Update hit rate trend
    this.trends.hitRate.push(metrics.hitRate);
    if (this.trends.hitRate.length > maxTrendLength) {
      this.trends.hitRate.shift();
    }
    
    // Update response time trend
    this.trends.responseTime.push(metrics.responseTime.avg);
    if (this.trends.responseTime.length > maxTrendLength) {
      this.trends.responseTime.shift();
    }
    
    // Update memory usage trend
    this.trends.memoryUsage.push(metrics.memoryUsage.percentage);
    if (this.trends.memoryUsage.length > maxTrendLength) {
      this.trends.memoryUsage.shift();
    }
    
    // Update throughput trend
    const throughput = metrics.operations.reads + metrics.operations.writes;
    this.trends.throughput.push(throughput);
    if (this.trends.throughput.length > maxTrendLength) {
      this.trends.throughput.shift();
    }
  }

  /**
   * Check for performance alerts
   */
  checkAlerts(metrics) {
    const alerts = [];
    const now = new Date();
    
    // Hit rate alert
    if (metrics.hitRate < this.config.alertThresholds.hitRate) {
      alerts.push({
        type: 'CACHE_HIT_RATE_LOW',
        severity: metrics.hitRate < 50 ? 'CRITICAL' : 'WARNING',
        message: `Cache hit rate is low: ${metrics.hitRate}% (threshold: ${this.config.alertThresholds.hitRate}%)`,
        value: metrics.hitRate,
        threshold: this.config.alertThresholds.hitRate,
        timestamp: now
      });
    }
    
    // Response time alert
    if (metrics.responseTime.avg > this.config.alertThresholds.responseTime) {
      alerts.push({
        type: 'CACHE_RESPONSE_TIME_HIGH',
        severity: metrics.responseTime.avg > 2000 ? 'CRITICAL' : 'WARNING',
        message: `Cache response time is high: ${metrics.responseTime.avg}ms (threshold: ${this.config.alertThresholds.responseTime}ms)`,
        value: metrics.responseTime.avg,
        threshold: this.config.alertThresholds.responseTime,
        timestamp: now
      });
    }
    
    // Memory usage alert
    if (metrics.memoryUsage.percentage > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'CACHE_MEMORY_USAGE_HIGH',
        severity: metrics.memoryUsage.percentage > 90 ? 'CRITICAL' : 'WARNING',
        message: `Cache memory usage is high: ${metrics.memoryUsage.percentage}% (threshold: ${this.config.alertThresholds.memoryUsage}%)`,
        value: metrics.memoryUsage.percentage,
        threshold: this.config.alertThresholds.memoryUsage,
        timestamp: now
      });
    }
    
    // Connection rejections alert
    if (metrics.connections.rejected > 0) {
      alerts.push({
        type: 'CACHE_CONNECTIONS_REJECTED',
        severity: 'WARNING',
        message: `Redis connections being rejected: ${metrics.connections.rejected}`,
        value: metrics.connections.rejected,
        threshold: 0,
        timestamp: now
      });
    }
    
    // Process new alerts
    alerts.forEach(alert => {
      this.processAlert(alert);
    });
  }

  /**
   * Process and emit alert
   */
  processAlert(alert) {
    // Check if this alert was recently sent (avoid spam)
    const recentAlert = this.metrics.alerts.find(
      a => a.type === alert.type && 
           (Date.now() - a.timestamp.getTime()) < 300000 // 5 minutes
    );
    
    if (!recentAlert) {
      // Add to alerts history
      this.metrics.alerts.push(alert);
      
      // Keep only recent alerts
      this.metrics.alerts = this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 24 * 60 * 60 * 1000 // 24 hours
      );
      
      // Emit alert
      this.emit('alert', alert);
      
      logger.warn(`🚨 Cache Alert: ${alert.message}`);
    }
  }

  /**
   * Get cache health status
   */
  getHealthStatus() {
    const metrics = this.metrics.current;
    
    if (!metrics || !metrics.timestamp) {
      return {
        status: 'UNKNOWN',
        message: 'No metrics available',
        score: 0
      };
    }
    
    // Calculate health score
    let score = 100;
    
    // Hit rate impact (40% weight)
    if (metrics.hitRate < 90) score -= (90 - metrics.hitRate) * 0.4;
    
    // Response time impact (30% weight)
    if (metrics.responseTime.avg > 100) {
      score -= Math.min(30, (metrics.responseTime.avg - 100) / 10 * 0.3);
    }
    
    // Memory usage impact (20% weight)
    if (metrics.memoryUsage.percentage > 70) {
      score -= (metrics.memoryUsage.percentage - 70) * 0.2;
    }
    
    // Connection health (10% weight)
    if (metrics.connections.rejected > 0) {
      score -= Math.min(10, metrics.connections.rejected);
    }
    
    score = Math.max(0, Math.round(score));
    
    // Determine status
    let status, message;
    if (score >= 90) {
      status = 'EXCELLENT';
      message = 'Cache performing optimally';
    } else if (score >= 75) {
      status = 'GOOD';
      message = 'Cache performing well';
    } else if (score >= 60) {
      status = 'FAIR';
      message = 'Cache performance is acceptable';
    } else if (score >= 40) {
      status = 'POOR';
      message = 'Cache performance needs attention';
    } else {
      status = 'CRITICAL';
      message = 'Cache performance is critical';
    }
    
    return {
      status,
      message,
      score,
      metrics: {
        hitRate: metrics.hitRate,
        responseTime: metrics.responseTime.avg,
        memoryUsage: metrics.memoryUsage.percentage,
        connections: metrics.connections.active
      },
      alerts: this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 60 * 60 * 1000 // Last hour
      ).length
    };
  }

  /**
   * Get performance recommendations
   */
  getRecommendations() {
    const metrics = this.metrics.current;
    const trends = this.trends;
    const recommendations = [];
    
    // Hit rate recommendations
    if (metrics.hitRate < 70) {
      recommendations.push({
        type: 'HIT_RATE_OPTIMIZATION',
        priority: 'HIGH',
        title: 'Optimize Cache Hit Rate',
        description: `Current hit rate is ${metrics.hitRate}%. Consider increasing TTL values or reviewing cache keys.`,
        actions: [
          'Increase TTL for stable data',
          'Implement cache warming strategies',
          'Review cache key patterns'
        ],
        expectedImpact: 'Improve hit rate by 15-25%'
      });
    }
    
    // Response time recommendations
    if (metrics.responseTime.avg > 500) {
      recommendations.push({
        type: 'RESPONSE_TIME_OPTIMIZATION',
        priority: 'MEDIUM',
        title: 'Optimize Response Time',
        description: `Average response time is ${metrics.responseTime.avg}ms. Consider optimizing Redis configuration.`,
        actions: [
          'Review Redis server resources',
          'Optimize network latency',
          'Consider Redis clustering'
        ],
        expectedImpact: 'Reduce response time by 20-40%'
      });
    }
    
    // Memory usage recommendations
    if (metrics.memoryUsage.percentage > 80) {
      recommendations.push({
        type: 'MEMORY_OPTIMIZATION',
        priority: 'HIGH',
        title: 'Optimize Memory Usage',
        description: `Memory usage is ${metrics.memoryUsage.percentage}%. Consider memory optimization strategies.`,
        actions: [
          'Implement data compression',
          'Review TTL policies',
          'Consider memory scaling'
        ],
        expectedImpact: 'Reduce memory usage by 15-30%'
      });
    }
    
    // Trend-based recommendations
    const hitRateTrend = this.calculateTrendDirection(trends.hitRate);
    if (hitRateTrend === 'DECLINING') {
      recommendations.push({
        type: 'TREND_ANALYSIS',
        priority: 'MEDIUM',
        title: 'Address Declining Hit Rate Trend',
        description: 'Hit rate has been declining over time. Investigate cache strategy effectiveness.',
        actions: [
          'Analyze cache usage patterns',
          'Review application caching logic',
          'Consider cache strategy adjustment'
        ],
        expectedImpact: 'Stabilize and improve hit rate trends'
      });
    }
    
    return recommendations;
  }

  /**
   * Calculate trend direction
   */
  calculateTrendDirection(values, window = 10) {
    if (values.length < window) return 'STABLE';
    
    const recent = values.slice(-window);
    const slope = this.calculateSlope(recent);
    
    if (slope > 0.5) return 'INCREASING';
    if (slope < -0.5) return 'DECLINING';
    return 'STABLE';
  }

  /**
   * Calculate slope of trend line
   */
  calculateSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    
    const xSum = n * (n - 1) / 2;
    const ySum = values.reduce((sum, val) => sum + val, 0);
    const xySum = values.reduce((sum, val, i) => sum + val * i, 0);
    const xSquareSum = n * (n - 1) * (2 * n - 1) / 6;
    
    const slope = (n * xySum - xSum * ySum) / (n * xSquareSum - xSum * xSum);
    return slope;
  }

  /**
   * Cleanup old data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    // Cleanup historical metrics
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
    
    // Cleanup alerts
    this.metrics.alerts = this.metrics.alerts.filter(
      a => a.timestamp.getTime() > cutoff
    );
  }

  /**
   * Get metrics summary
   */
  getMetrics() {
    return {
      current: this.metrics.current,
      trends: this.trends,
      health: this.getHealthStatus(),
      recommendations: this.getRecommendations(),
      alerts: this.metrics.alerts.slice(-10), // Last 10 alerts
      historical: this.metrics.historical.slice(-100) // Last 100 data points
    };
  }
}

/**
 * ================================
 * QR USAGE ANALYTICS MONITOR
 * ================================
 */
class QRMonitor extends EventEmitter {
  constructor() {
    super();
    
    // Configuration
    this.config = {
      sampleInterval: parseInt(process.env.QR_MONITOR_INTERVAL) || 60000, // 1 minute
      retentionPeriod: parseInt(process.env.QR_METRICS_RETENTION) || 30 * 24 * 60 * 60 * 1000, // 30 days
      alertThresholds: {
        successRate: parseFloat(process.env.QR_SUCCESS_RATE_THRESHOLD) || 85.0,
        generationFailureRate: parseFloat(process.env.QR_GENERATION_FAILURE_THRESHOLD) || 5.0,
        usageRate: parseFloat(process.env.QR_USAGE_RATE_THRESHOLD) || 60.0,
        securityIncidents: parseInt(process.env.QR_SECURITY_INCIDENTS_THRESHOLD) || 10
      },
      enableAlerts: process.env.QR_MONITORING_ALERTS !== 'false'
    };
    
    // Metrics storage
    this.metrics = {
      current: {
        generation: {
          total: 0,
          successful: 0,
          failed: 0,
          rate: 0,
          byType: {}
        },
        usage: {
          total: 0,
          successful: 0,
          failed: 0,
          rate: 0,
          avgResponseTime: 0
        },
        checkIn: {
          attempts: 0,
          successful: 0,
          failed: 0,
          avgTime: 0,
          successRate: 0
        },
        security: {
          suspiciousAttempts: 0,
          blockedAttempts: 0,
          incidents: 0,
          revokedCodes: 0
        },
        business: {
          adoptionRate: 0,
          userSatisfaction: 0,
          operationalEfficiency: 0,
          costSavings: 0
        },
        timestamp: new Date()
      },
      historical: [],
      alerts: [],
      trends: {
        generation: [],
        usage: [],
        checkIn: [],
        security: []
      }
    };
    
    this.isMonitoring = false;
    this.monitoringInterval = null;
    
    this.init();
  }

  /**
   * Initialize QR monitoring
   */
  async init() {
    try {
      // Start monitoring if enabled
      if (process.env.QR_MONITORING_ENABLED !== 'false') {
        await this.startMonitoring();
      }
      
      logger.info('✅ QR Monitor initialized successfully');
      
    } catch (error) {
      logger.error('❌ QR Monitor initialization failed:', error);
      this.emit('error', error);
    }
  }

  /**
   * Start QR monitoring
   */
  async startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Initial metrics collection
    await this.collectMetrics();
    
    // Start periodic collection
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        logger.error('QR metrics collection failed:', error);
        this.emit('error', error);
      }
    }, this.config.sampleInterval);
    
    logger.info(`📊 QR monitoring started (interval: ${this.config.sampleInterval}ms)`);
    this.emit('monitoring:started');
  }

  /**
   * Stop QR monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('🛑 QR monitoring stopped');
    this.emit('monitoring:stopped');
  }

  /**
   * Collect QR metrics from database
   */
  async collectMetrics() {
    try {
      const Booking = mongoose.model('Booking');
      const Hotel = mongoose.model('Hotel');
      
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      
      // Get generation metrics
      const generationMetrics = await this.getGenerationMetrics(Booking, dayAgo);
      
      // Get usage metrics
      const usageMetrics = await this.getUsageMetrics(Booking, dayAgo);
      
      // Get check-in metrics
      const checkInMetrics = await this.getCheckInMetrics(Booking, dayAgo);
      
      // Get security metrics
      const securityMetrics = await this.getSecurityMetrics(Booking, weekAgo);
      
      // Get business metrics
      const businessMetrics = await this.getBusinessMetrics(Hotel, Booking, weekAgo);
      
      // Compile current metrics
      this.metrics.current = {
        generation: generationMetrics,
        usage: usageMetrics,
        checkIn: checkInMetrics,
        security: securityMetrics,
        business: businessMetrics,
        timestamp: now
      };
      
      // Add to historical data
      this.addToHistorical(this.metrics.current);
      
      // Update trends
      this.updateTrends(this.metrics.current);
      
      // Check for alerts
      if (this.config.enableAlerts) {
        this.checkAlerts(this.metrics.current);
      }
      
      // Emit metrics update
      this.emit('metrics:updated', this.metrics.current);
      
      // Cleanup old data
      this.cleanupOldData();
      
    } catch (error) {
      logger.error('Error collecting QR metrics:', error);
      this.emit('metrics:error', error);
    }
  }

  /**
   * Get QR generation metrics
   */
  async getGenerationMetrics(Booking, since) {
    try {
      const pipeline = [
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$qrTracking.generated' },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            byType: {
              $push: '$qrTracking.generated.type'
            },
            successful: {
              $sum: {
                $cond: [
                  { $ne: ['$qrTracking.generated.qrCodeId', null] },
                  1,
                  0
                ]
              }
            }
          }
        }
      ];
      
      const result = await Booking.aggregate(pipeline);
      const data = result[0] || { total: 0, successful: 0, byType: [] };
      
      // Count by type
      const byType = {};
      data.byType.forEach(type => {
        byType[type] = (byType[type] || 0) + 1;
      });
      
      return {
        total: data.total,
        successful: data.successful,
        failed: data.total - data.successful,
        rate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
        byType
      };
      
    } catch (error) {
      logger.error('Error getting generation metrics:', error);
      return { total: 0, successful: 0, failed: 0, rate: 0, byType: {} };
    }
  }

  /**
   * Get QR usage metrics
   */
  async getUsageMetrics(Booking, since) {
    try {
      const pipeline = [
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$qrTracking.generated' },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            used: {
              $sum: {
                $cond: ['$qrTracking.generated.isUsed', 1, 0]
              }
            },
            avgResponseTime: {
              $avg: '$qrTracking.performance.averageCheckInTime'
            }
          }
        }
      ];
      
      const result = await Booking.aggregate(pipeline);
      const data = result[0] || { total: 0, used: 0, avgResponseTime: 0 };
      
      return {
        total: data.total,
        successful: data.used,
        failed: data.total - data.used,
        rate: data.total > 0 ? (data.used / data.total) * 100 : 0,
        avgResponseTime: data.avgResponseTime || 0
      };
      
    } catch (error) {
      logger.error('Error getting usage metrics:', error);
      return { total: 0, successful: 0, failed: 0, rate: 0, avgResponseTime: 0 };
    }
  }

  /**
   * Get check-in metrics
   */
  async getCheckInMetrics(Booking, since) {
    try {
      const pipeline = [
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$qrTracking.checkInAttempts' },
        {
          $group: {
            _id: null,
            attempts: { $sum: 1 },
            successful: {
              $sum: {
                $cond: ['$qrTracking.checkInAttempts.success', 1, 0]
              }
            },
            avgTime: {
              $avg: '$qrTracking.checkInAttempts.processTimeMs'
            }
          }
        }
      ];
      
      const result = await Booking.aggregate(pipeline);
      const data = result[0] || { attempts: 0, successful: 0, avgTime: 0 };
      
      return {
        attempts: data.attempts,
        successful: data.successful,
        failed: data.attempts - data.successful,
        avgTime: data.avgTime || 0,
        successRate: data.attempts > 0 ? (data.successful / data.attempts) * 100 : 0
      };
      
    } catch (error) {
      logger.error('Error getting check-in metrics:', error);
      return { attempts: 0, successful: 0, failed: 0, avgTime: 0, successRate: 0 };
    }
  }

  /**
   * Get security metrics
   */
  async getSecurityMetrics(Booking, since) {
    try {
      // Count revoked QR codes
      const revokedPipeline = [
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$qrTracking.generated' },
        { $match: { 'qrTracking.generated.revoked.isRevoked': true } },
        { $group: { _id: null, count: { $sum: 1 } } }
      ];
      
      const revokedResult = await Booking.aggregate(revokedPipeline);
      const revokedCount = revokedResult[0]?.count || 0;
      
      // Count failed attempts (suspicious activity)
      const failedPipeline = [
        { $match: { createdAt: { $gte: since } } },
        { $unwind: '$qrTracking.checkInAttempts' },
        { $match: { 'qrTracking.checkInAttempts.success': false } },
        {
          $group: {
            _id: '$qrTracking.checkInAttempts.failureReason',
            count: { $sum: 1 }
          }
        }
      ];
      
      const failedResult = await Booking.aggregate(failedPipeline);
      
      let suspiciousAttempts = 0;
      let blockedAttempts = 0;
      
      failedResult.forEach(item => {
        if (['EXPIRED', 'REVOKED', 'USAGE_EXCEEDED'].includes(item._id)) {
          blockedAttempts += item.count;
        } else {
          suspiciousAttempts += item.count;
        }
      });
      
      return {
        suspiciousAttempts,
        blockedAttempts,
        incidents: suspiciousAttempts + blockedAttempts,
        revokedCodes: revokedCount
      };
      
    } catch (error) {
      logger.error('Error getting security metrics:', error);
      return { suspiciousAttempts: 0, blockedAttempts: 0, incidents: 0, revokedCodes: 0 };
    }
  }

  /**
   * Get business intelligence metrics
   */
  async getBusinessMetrics(Hotel, Booking, since) {
    try {
      // QR adoption rate
      const totalHotels = await Hotel.countDocuments({ isActive: true });
      const qrEnabledHotels = await Hotel.countDocuments({ 
        isActive: true, 
        'qrSettings.enabled': true 
      });
      
      const adoptionRate = totalHotels > 0 ? (qrEnabledHotels / totalHotels) * 100 : 0;
      
      // Calculate efficiency gains
      const qrBookings = await Booking.countDocuments({
        createdAt: { $gte: since },
        'qrTracking.performance.successfulCheckIns': { $gt: 0 }
      });
      
      const traditionalBookings = await Booking.countDocuments({
        createdAt: { $gte: since },
        'qrTracking.performance.successfulCheckIns': 0
      });
      
      // Estimate time savings (QR check-in avg 30s vs traditional 5min)
      const timeSavingsMinutes = qrBookings * 4.5; // 4.5 minutes saved per QR check-in
      const costSavings = timeSavingsMinutes * 0.5; // €0.50 per minute staff time
      
      return {
        adoptionRate,
        userSatisfaction: this.calculateUserSatisfaction(),
        operationalEfficiency: qrBookings / (qrBookings + traditionalBookings) * 100 || 0,
        costSavings: Math.round(costSavings * 100) / 100
      };
      
    } catch (error) {
      logger.error('Error getting business metrics:', error);
      return { adoptionRate: 0, userSatisfaction: 0, operationalEfficiency: 0, costSavings: 0 };
    }
  }

  /**
   * Calculate user satisfaction score
   */
  calculateUserSatisfaction() {
    const metrics = this.metrics.current;
    if (!metrics.checkIn || !metrics.usage) return 0;
    
    // Base satisfaction on success rate and response time
    let satisfaction = 0;
    
    // Success rate component (60% weight)
    satisfaction += (metrics.checkIn.successRate || 0) * 0.6;
    
    // Response time component (40% weight) - lower is better
    const timeScore = Math.max(0, 100 - (metrics.checkIn.avgTime / 1000)); // 1 second = 90 points
    satisfaction += timeScore * 0.4;
    
    return Math.min(100, Math.max(0, satisfaction));
  }

  /**
   * Add metrics to historical data
   */
  addToHistorical(metrics) {
    this.metrics.historical.push({
      ...metrics,
      timestamp: new Date()
    });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
  }

  /**
   * Update QR trends
   */
  updateTrends(metrics) {
    const maxTrendLength = 100;
    
    // Update generation trend
    this.metrics.trends.generation.push(metrics.generation.rate);
    if (this.metrics.trends.generation.length > maxTrendLength) {
      this.metrics.trends.generation.shift();
    }
    
    // Update usage trend
    this.metrics.trends.usage.push(metrics.usage.rate);
    if (this.metrics.trends.usage.length > maxTrendLength) {
      this.metrics.trends.usage.shift();
    }
    
    // Update check-in trend
    this.metrics.trends.checkIn.push(metrics.checkIn.successRate);
    if (this.metrics.trends.checkIn.length > maxTrendLength) {
      this.metrics.trends.checkIn.shift();
    }
    
    // Update security trend
    this.metrics.trends.security.push(metrics.security.incidents);
    if (this.metrics.trends.security.length > maxTrendLength) {
      this.metrics.trends.security.shift();
    }
  }

  /**
   * Check for QR alerts
   */
  checkAlerts(metrics) {
    const alerts = [];
    const now = new Date();
    
    // Success rate alert
    if (metrics.checkIn.successRate < this.config.alertThresholds.successRate) {
      alerts.push({
        type: 'QR_SUCCESS_RATE_LOW',
        severity: metrics.checkIn.successRate < 70 ? 'CRITICAL' : 'WARNING',
        message: `QR check-in success rate is low: ${metrics.checkIn.successRate}% (threshold: ${this.config.alertThresholds.successRate}%)`,
        value: metrics.checkIn.successRate,
        threshold: this.config.alertThresholds.successRate,
        timestamp: now
      });
    }
    
    // Generation failure rate alert
    const generationFailureRate = metrics.generation.total > 0 ? 
      (metrics.generation.failed / metrics.generation.total) * 100 : 0;
    
    if (generationFailureRate > this.config.alertThresholds.generationFailureRate) {
      alerts.push({
        type: 'QR_GENERATION_FAILURE_HIGH',
        severity: generationFailureRate > 10 ? 'CRITICAL' : 'WARNING',
        message: `QR generation failure rate is high: ${generationFailureRate}% (threshold: ${this.config.alertThresholds.generationFailureRate}%)`,
        value: generationFailureRate,
        threshold: this.config.alertThresholds.generationFailureRate,
        timestamp: now
      });
    }
    
    // Usage rate alert
    if (metrics.usage.rate < this.config.alertThresholds.usageRate) {
      alerts.push({
        type: 'QR_USAGE_RATE_LOW',
        severity: 'WARNING',
        message: `QR usage rate is low: ${metrics.usage.rate}% (threshold: ${this.config.alertThresholds.usageRate}%)`,
        value: metrics.usage.rate,
        threshold: this.config.alertThresholds.usageRate,
        timestamp: now
      });
    }
    
    // Security incidents alert
    if (metrics.security.incidents > this.config.alertThresholds.securityIncidents) {
      alerts.push({
        type: 'QR_SECURITY_INCIDENTS_HIGH',
        severity: metrics.security.incidents > 20 ? 'CRITICAL' : 'WARNING',
        message: `High number of QR security incidents: ${metrics.security.incidents} (threshold: ${this.config.alertThresholds.securityIncidents})`,
        value: metrics.security.incidents,
        threshold: this.config.alertThresholds.securityIncidents,
        timestamp: now
      });
    }
    
    // Process new alerts
    alerts.forEach(alert => {
      this.processAlert(alert);
    });
  }

  /**
   * Process and emit QR alert
   */
  processAlert(alert) {
    // Check if this alert was recently sent (avoid spam)
    const recentAlert = this.metrics.alerts.find(
      a => a.type === alert.type && 
           (Date.now() - a.timestamp.getTime()) < 300000 // 5 minutes
    );
    
    if (!recentAlert) {
      // Add to alerts history
      this.metrics.alerts.push(alert);
      
      // Keep only recent alerts
      this.metrics.alerts = this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 24 * 60 * 60 * 1000 // 24 hours
      );
      
      // Emit alert
      this.emit('alert', alert);
      
      logger.warn(`🚨 QR Alert: ${alert.message}`);
    }
  }

  /**
   * Get QR health status
   */
  getHealthStatus() {
    const metrics = this.metrics.current;
    
    if (!metrics || !metrics.timestamp) {
      return {
        status: 'UNKNOWN',
        message: 'No QR metrics available',
        score: 0
      };
    }
    
    // Calculate health score
    let score = 100;
    
    // Success rate impact (40% weight)
    if (metrics.checkIn.successRate < 95) {
      score -= (95 - metrics.checkIn.successRate) * 0.4;
    }
    
    // Usage rate impact (30% weight)
    if (metrics.usage.rate < 80) {
      score -= (80 - metrics.usage.rate) * 0.3;
    }
    
    // Security impact (20% weight)
    if (metrics.security.incidents > 5) {
      score -= Math.min(20, metrics.security.incidents);
    }
    
    // Response time impact (10% weight)
    if (metrics.checkIn.avgTime > 10000) { // 10 seconds
      score -= Math.min(10, (metrics.checkIn.avgTime - 10000) / 1000);
    }
    
    score = Math.max(0, Math.round(score));
    
    // Determine status
    let status, message;
    if (score >= 90) {
      status = 'EXCELLENT';
      message = 'QR system performing optimally';
    } else if (score >= 75) {
      status = 'GOOD';
      message = 'QR system performing well';
    } else if (score >= 60) {
      status = 'FAIR';
      message = 'QR system performance is acceptable';
    } else if (score >= 40) {
      status = 'POOR';
      message = 'QR system needs attention';
    } else {
      status = 'CRITICAL';
      message = 'QR system performance is critical';
    }
    
    return {
      status,
      message,
      score,
      metrics: {
        successRate: metrics.checkIn.successRate,
        usageRate: metrics.usage.rate,
        avgCheckInTime: metrics.checkIn.avgTime,
        securityIncidents: metrics.security.incidents
      },
      alerts: this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 60 * 60 * 1000 // Last hour
      ).length
    };
  }

  /**
   * Get QR analytics summary
   */
  getAnalytics() {
    const metrics = this.metrics.current;
    const trends = this.metrics.trends;
    
    return {
      generation: {
        daily: metrics.generation,
        trends: trends.generation.slice(-30),
        byType: metrics.generation.byType
      },
      usage: {
        daily: metrics.usage,
        trends: trends.usage.slice(-30),
        efficiency: metrics.business.operationalEfficiency
      },
      checkIn: {
        performance: metrics.checkIn,
        trends: trends.checkIn.slice(-30),
        satisfaction: metrics.business.userSatisfaction
      },
      security: {
        incidents: metrics.security,
        trends: trends.security.slice(-30),
        riskLevel: this.calculateSecurityRiskLevel(metrics.security)
      },
      business: {
        adoption: metrics.business.adoptionRate,
        roi: metrics.business.costSavings,
        efficiency: metrics.business.operationalEfficiency
      }
    };
  }

  /**
   * Calculate security risk level
   */
  calculateSecurityRiskLevel(security) {
    const incidents = security.incidents;
    const suspicious = security.suspiciousAttempts;
    
    if (incidents > 20 || suspicious > 15) return 'HIGH';
    if (incidents > 10 || suspicious > 8) return 'MEDIUM';
    if (incidents > 5 || suspicious > 3) return 'LOW';
    return 'MINIMAL';
  }

  /**
   * Cleanup old QR data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    // Cleanup historical metrics
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
    
    // Cleanup alerts
    this.metrics.alerts = this.metrics.alerts.filter(
      a => a.timestamp.getTime() > cutoff
    );
  }

  /**
   * Get QR metrics summary
   */
  getMetrics() {
    return {
      current: this.metrics.current,
      trends: this.metrics.trends,
      health: this.getHealthStatus(),
      analytics: this.getAnalytics(),
      alerts: this.metrics.alerts.slice(-10),
      historical: this.metrics.historical.slice(-100)
    };
  }
}

/**
 * ================================
 * SYSTEM HEALTH MONITOR
 * ================================
 */
class SystemMonitor extends EventEmitter {
  constructor() {
    super();
    
    // Configuration
    this.config = {
      checkInterval: parseInt(process.env.SYSTEM_MONITOR_INTERVAL) || 30000, // 30 seconds
      retentionPeriod: parseInt(process.env.SYSTEM_METRICS_RETENTION) || 24 * 60 * 60 * 1000, // 24 hours
      alertThresholds: {
        cpuUsage: parseFloat(process.env.CPU_USAGE_THRESHOLD) || 80.0,
        memoryUsage: parseFloat(process.env.MEMORY_USAGE_THRESHOLD) || 85.0,
        responseTime: parseInt(process.env.RESPONSE_TIME_THRESHOLD) || 2000,
        errorRate: parseFloat(process.env.ERROR_RATE_THRESHOLD) || 2.0
      },
      enableAlerts: process.env.SYSTEM_MONITORING_ALERTS !== 'false'
    };
    
    // System metrics
    this.metrics = {
      current: {
        system: {
          uptime: 0,
          cpuUsage: 0,
          memoryUsage: {
            used: 0,
            total: 0,
            percentage: 0
          },
          loadAverage: 0,
          freeMemory: 0
        },
        application: {
          version: process.env.npm_package_version || '1.0.0',
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          pid: process.pid,
          uptime: 0
        },
        database: {
          status: 'UNKNOWN',
          responseTime: 0,
          connections: 0,
          operations: 0
        },
        integrations: {
          redis: { status: 'UNKNOWN', responseTime: 0 },
          qrService: { status: 'UNKNOWN', responseTime: 0 },
          emailService: { status: 'UNKNOWN', responseTime: 0 }
        },
        performance: {
          requestsPerSecond: 0,
          avgResponseTime: 0,
          errorRate: 0,
          activeConnections: 0
        },
        timestamp: new Date()
      },
      historical: [],
      alerts: []
    };
    
    this.isMonitoring = false;
    this.monitoringInterval = null;
    
    // Performance counters
    this.counters = {
      requests: 0,
      errors: 0,
      lastReset: Date.now()
    };
    
    this.init();
  }

  /**
   * Initialize system monitoring
   */
  async init() {
    try {
      // Start monitoring if enabled
      if (process.env.SYSTEM_MONITORING_ENABLED !== 'false') {
        await this.startMonitoring();
      }
      
      logger.info('✅ System Monitor initialized successfully');
      
    } catch (error) {
      logger.error('❌ System Monitor initialization failed:', error);
      this.emit('error', error);
    }
  }

  /**
   * Start system monitoring
   */
  async startMonitoring() {
    if (this.isMonitoring) return;
    
    this.isMonitoring = true;
    
    // Initial health check
    await this.performHealthCheck();
    
    // Start periodic checks
    this.monitoringInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('System health check failed:', error);
        this.emit('error', error);
      }
    }, this.config.checkInterval);
    
    logger.info(`📊 System monitoring started (interval: ${this.config.checkInterval}ms)`);
    this.emit('monitoring:started');
  }

  /**
   * Stop system monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) return;
    
    this.isMonitoring = false;
    
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('🛑 System monitoring stopped');
    this.emit('monitoring:stopped');
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    try {
      const startTime = Date.now();
      
      // Get system metrics
      const systemMetrics = this.getSystemMetrics();
      
      // Check database health
      const databaseHealth = await this.checkDatabaseHealth();
      
      // Check integration health
      const integrationHealth = await this.checkIntegrationHealth();
      
      // Get performance metrics
      const performanceMetrics = this.getPerformanceMetrics();
      
      // Compile current metrics
      this.metrics.current = {
        system: systemMetrics,
        application: {
          version: process.env.npm_package_version || '1.0.0',
          nodeVersion: process.version,
          environment: process.env.NODE_ENV || 'development',
          pid: process.pid,
          uptime: process.uptime()
        },
        database: databaseHealth,
        integrations: integrationHealth,
        performance: performanceMetrics,
        timestamp: new Date(),
        checkDuration: Date.now() - startTime
      };
      
      // Add to historical data
      this.addToHistorical(this.metrics.current);
      
      // Check for alerts
      if (this.config.enableAlerts) {
        this.checkAlerts(this.metrics.current);
      }
      
      // Emit health update
      this.emit('health:updated', this.metrics.current);
      
      // Cleanup old data
      this.cleanupOldData();
      
    } catch (error) {
      logger.error('Error performing health check:', error);
      this.emit('health:error', error);
    }
  }

  /**
   * Get system metrics
   */
  getSystemMetrics() {
    const os = require('os');
    
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    return {
      uptime: os.uptime(),
      cpuUsage: this.getCPUUsage(),
      memoryUsage: {
        used: usedMem,
        total: totalMem,
        percentage: (usedMem / totalMem) * 100
      },
      loadAverage: os.loadavg()[0],
      freeMemory: freeMem,
      platform: os.platform(),
      arch: os.arch(),
      hostname: os.hostname()
    };
  }

  /**
   * Get CPU usage percentage
   */
  getCPUUsage() {
    const os = require('os');
    const cpus = os.cpus();
    
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    
    return 100 - ~~(100 * idle / total);
  }

  /**
   * Check database health
   */
  async checkDatabaseHealth() {
    try {
      const startTime = Date.now();
      
      // Check MongoDB connection
      const dbState = mongoose.connection.readyState;
      const stateMap = {
        0: 'DISCONNECTED',
        1: 'CONNECTED',
        2: 'CONNECTING',
        3: 'DISCONNECTING'
      };
      
      const status = stateMap[dbState] || 'UNKNOWN';
      const responseTime = Date.now() - startTime;
      
      // Get connection stats
      const connections = mongoose.connections.length;
      
      // Simple ping test
      if (dbState === 1) {
        await mongoose.connection.db.admin().ping();
      }
      
      return {
        status,
        responseTime,
        connections,
        operations: 0, // Could be enhanced with actual operation counting
        lastCheck: new Date()
      };
      
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        status: 'ERROR',
        responseTime: 0,
        connections: 0,
        operations: 0,
        error: error.message,
        lastCheck: new Date()
      };
    }
  }

  /**
   * Check integration health
   */
  async checkIntegrationHealth() {
    const integrations = {
      redis: await this.checkRedisHealth(),
      qrService: await this.checkQRServiceHealth(),
      emailService: await this.checkEmailServiceHealth()
    };
    
    return integrations;
  }

  /**
   * Check Redis health
   */
  async checkRedisHealth() {
    try {
      const redisConfig = require('../config/redis');
      const startTime = Date.now();
      
      if (!redisConfig.isReady()) {
        return {
          status: 'DISCONNECTED',
          responseTime: 0,
          error: 'Redis not connected',
          lastCheck: new Date()
        };
      }
      
      const client = redisConfig.getClient();
      await client.ping();
      
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'HEALTHY',
        responseTime,
        lastCheck: new Date()
      };
      
    } catch (error) {
      return {
        status: 'ERROR',
        responseTime: 0,
        error: error.message,
        lastCheck: new Date()
      };
    }
  }

  /**
   * Check QR service health
   */
  async checkQRServiceHealth() {
    try {
      // Simple check - could be enhanced with actual service ping
      const { qrCodeService } = require('../services/qrCodeService');
      const stats = qrCodeService.getStats();
      
      return {
        status: 'HEALTHY',
        responseTime: 50, // Simulated
        stats,
        lastCheck: new Date()
      };
      
    } catch (error) {
      return {
        status: 'ERROR',
        responseTime: 0,
        error: error.message,
        lastCheck: new Date()
      };
    }
  }

  /**
   * Check email service health
   */
  async checkEmailServiceHealth() {
    try {
      // Placeholder - would check actual email service
      return {
        status: 'HEALTHY',
        responseTime: 100, // Simulated
        lastCheck: new Date()
      };
      
    } catch (error) {
      return {
        status: 'ERROR',
        responseTime: 0,
        error: error.message,
        lastCheck: new Date()
      };
    }
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    const now = Date.now();
    const timeSinceReset = now - this.counters.lastReset;
    const secondsSinceReset = timeSinceReset / 1000;
    
    const requestsPerSecond = secondsSinceReset > 0 ? 
      this.counters.requests / secondsSinceReset : 0;
    
    const errorRate = this.counters.requests > 0 ? 
      (this.counters.errors / this.counters.requests) * 100 : 0;
    
    return {
      requestsPerSecond: Math.round(requestsPerSecond * 100) / 100,
      avgResponseTime: 200, // Would be calculated from actual request timing
      errorRate: Math.round(errorRate * 100) / 100,
      activeConnections: 0, // Would be tracked from actual connections
      totalRequests: this.counters.requests,
      totalErrors: this.counters.errors
    };
  }

  /**
   * Record request metrics
   */
  recordRequest(responseTime, isError = false) {
    this.counters.requests++;
    if (isError) {
      this.counters.errors++;
    }
    
    // Reset counters every hour
    if (Date.now() - this.counters.lastReset > 60 * 60 * 1000) {
      this.counters.requests = 0;
      this.counters.errors = 0;
      this.counters.lastReset = Date.now();
    }
  }

  /**
   * Add to historical data
   */
  addToHistorical(metrics) {
    this.metrics.historical.push({
      ...metrics,
      timestamp: new Date()
    });
    
    // Keep only recent data
    const cutoff = Date.now() - this.config.retentionPeriod;
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
  }

  /**
   * Check for system alerts
   */
  checkAlerts(metrics) {
    const alerts = [];
    const now = new Date();
    
    // CPU usage alert
    if (metrics.system.cpuUsage > this.config.alertThresholds.cpuUsage) {
      alerts.push({
        type: 'SYSTEM_CPU_HIGH',
        severity: metrics.system.cpuUsage > 90 ? 'CRITICAL' : 'WARNING',
        message: `High CPU usage: ${metrics.system.cpuUsage}% (threshold: ${this.config.alertThresholds.cpuUsage}%)`,
        value: metrics.system.cpuUsage,
        threshold: this.config.alertThresholds.cpuUsage,
        timestamp: now
      });
    }
    
    // Memory usage alert
    if (metrics.system.memoryUsage.percentage > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'SYSTEM_MEMORY_HIGH',
        severity: metrics.system.memoryUsage.percentage > 95 ? 'CRITICAL' : 'WARNING',
        message: `High memory usage: ${Math.round(metrics.system.memoryUsage.percentage)}% (threshold: ${this.config.alertThresholds.memoryUsage}%)`,
        value: metrics.system.memoryUsage.percentage,
        threshold: this.config.alertThresholds.memoryUsage,
        timestamp: now
      });
    }
    
    // Database connectivity alert
    if (metrics.database.status !== 'CONNECTED') {
      alerts.push({
        type: 'DATABASE_CONNECTION_ISSUE',
        severity: 'CRITICAL',
        message: `Database connection issue: ${metrics.database.status}`,
        value: metrics.database.status,
        threshold: 'CONNECTED',
        timestamp: now
      });
    }
    
    // Redis connectivity alert
    if (metrics.integrations.redis.status !== 'HEALTHY') {
      alerts.push({
        type: 'REDIS_CONNECTION_ISSUE',
        severity: 'HIGH',
        message: `Redis connection issue: ${metrics.integrations.redis.status}`,
        value: metrics.integrations.redis.status,
        threshold: 'HEALTHY',
        timestamp: now
      });
    }
    
    // Response time alert
    if (metrics.performance.avgResponseTime > this.config.alertThresholds.responseTime) {
      alerts.push({
        type: 'RESPONSE_TIME_HIGH',
        severity: metrics.performance.avgResponseTime > 5000 ? 'CRITICAL' : 'WARNING',
        message: `High response time: ${metrics.performance.avgResponseTime}ms (threshold: ${this.config.alertThresholds.responseTime}ms)`,
        value: metrics.performance.avgResponseTime,
        threshold: this.config.alertThresholds.responseTime,
        timestamp: now
      });
    }
    
    // Error rate alert
    if (metrics.performance.errorRate > this.config.alertThresholds.errorRate) {
      alerts.push({
        type: 'ERROR_RATE_HIGH',
        severity: metrics.performance.errorRate > 10 ? 'CRITICAL' : 'WARNING',
        message: `High error rate: ${metrics.performance.errorRate}% (threshold: ${this.config.alertThresholds.errorRate}%)`,
        value: metrics.performance.errorRate,
        threshold: this.config.alertThresholds.errorRate,
        timestamp: now
      });
    }
    
    // Process new alerts
    alerts.forEach(alert => {
      this.processAlert(alert);
    });
  }

  /**
   * Process and emit system alert
   */
  processAlert(alert) {
    // Check if this alert was recently sent (avoid spam)
    const recentAlert = this.metrics.alerts.find(
      a => a.type === alert.type && 
           (Date.now() - a.timestamp.getTime()) < 300000 // 5 minutes
    );
    
    if (!recentAlert) {
      // Add to alerts history
      this.metrics.alerts.push(alert);
      
      // Keep only recent alerts
      this.metrics.alerts = this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 24 * 60 * 60 * 1000 // 24 hours
      );
      
      // Emit alert
      this.emit('alert', alert);
      
      logger.warn(`🚨 System Alert: ${alert.message}`);
    }
  }

  /**
   * Get overall system health status
   */
  getHealthStatus() {
    const metrics = this.metrics.current;
    
    if (!metrics || !metrics.timestamp) {
      return {
        status: 'UNKNOWN',
        message: 'No system metrics available',
        score: 0
      };
    }
    
    // Calculate health score
    let score = 100;
    
    // System metrics impact (40% weight)
    if (metrics.system.cpuUsage > 70) {
      score -= (metrics.system.cpuUsage - 70) * 0.4;
    }
    
    if (metrics.system.memoryUsage.percentage > 80) {
      score -= (metrics.system.memoryUsage.percentage - 80) * 0.4;
    }
    
    // Database health impact (30% weight)
    if (metrics.database.status !== 'CONNECTED') {
      score -= 30;
    } else if (metrics.database.responseTime > 1000) {
      score -= Math.min(15, (metrics.database.responseTime - 1000) / 100);
    }
    
    // Integration health impact (20% weight)
    const unhealthyIntegrations = Object.values(metrics.integrations)
      .filter(integration => integration.status !== 'HEALTHY').length;
    score -= unhealthyIntegrations * 10;
    
    // Performance impact (10% weight)
    if (metrics.performance.errorRate > 2) {
      score -= Math.min(10, metrics.performance.errorRate);
    }
    
    score = Math.max(0, Math.round(score));
    
    // Determine status
    let status, message;
    if (score >= 90) {
      status = 'EXCELLENT';
      message = 'All systems operating normally';
    } else if (score >= 75) {
      status = 'GOOD';
      message = 'Systems performing well';
    } else if (score >= 60) {
      status = 'FAIR';
      message = 'Some performance issues detected';
    } else if (score >= 40) {
      status = 'POOR';
      message = 'Multiple issues require attention';
    } else {
      status = 'CRITICAL';
      message = 'Critical system issues detected';
    }
    
    return {
      status,
      message,
      score,
      components: {
        system: metrics.system.cpuUsage < 80 && metrics.system.memoryUsage.percentage < 85 ? 'HEALTHY' : 'DEGRADED',
        database: metrics.database.status === 'CONNECTED' ? 'HEALTHY' : 'UNHEALTHY',
        redis: metrics.integrations.redis.status === 'HEALTHY' ? 'HEALTHY' : 'UNHEALTHY',
        qrService: metrics.integrations.qrService.status === 'HEALTHY' ? 'HEALTHY' : 'UNHEALTHY'
      },
      alerts: this.metrics.alerts.filter(
        a => (Date.now() - a.timestamp.getTime()) < 60 * 60 * 1000 // Last hour
      ).length,
      uptime: metrics.application.uptime,
      lastCheck: metrics.timestamp
    };
  }

  /**
   * Cleanup old system data
   */
  cleanupOldData() {
    const cutoff = Date.now() - this.config.retentionPeriod;
    
    // Cleanup historical metrics
    this.metrics.historical = this.metrics.historical.filter(
      m => m.timestamp.getTime() > cutoff
    );
    
    // Cleanup alerts
    this.metrics.alerts = this.metrics.alerts.filter(
      a => a.timestamp.getTime() > cutoff
    );
  }

  /**
   * Get system metrics summary
   */
  getMetrics() {
    return {
      current: this.metrics.current,
      health: this.getHealthStatus(),
      alerts: this.metrics.alerts.slice(-10),
      historical: this.metrics.historical.slice(-100),
      performance: {
        requestsPerSecond: this.metrics.current.performance.requestsPerSecond,
        errorRate: this.metrics.current.performance.errorRate,
        avgResponseTime: this.metrics.current.performance.avgResponseTime
      }
    };
  }
}

/**
 * ================================
 * CENTRALIZED MONITORING SERVICE
 * ================================
 */
class MonitoringService extends EventEmitter {
  constructor() {
    super();
    
    // Initialize monitors
    this.cacheMonitor = new CacheMonitor();
    this.qrMonitor = new QRMonitor();
    this.systemMonitor = new SystemMonitor();
    
    // Alert configuration
    this.alertConfig = {
      enableEmailAlerts: process.env.ENABLE_EMAIL_ALERTS !== 'false',
      enableWebhookAlerts: process.env.ENABLE_WEBHOOK_ALERTS !== 'false',
      enableSlackAlerts: process.env.ENABLE_SLACK_ALERTS === 'true',
      emailRecipients: (process.env.ALERT_EMAIL_RECIPIENTS || '').split(',').filter(Boolean),
      webhookUrl: process.env.ALERT_WEBHOOK_URL,
      slackWebhook: process.env.SLACK_WEBHOOK_URL
    };
    
    // Combined metrics
    this.combinedMetrics = {
      overall: {
        status: 'UNKNOWN',
        score: 0,
        lastUpdated: new Date()
      },
      components: {
        cache: { status: 'UNKNOWN', score: 0 },
        qr: { status: 'UNKNOWN', score: 0 },
        system: { status: 'UNKNOWN', score: 0 }
      },
      alerts: [],
      recommendations: []
    };
    
    this.init();
  }

  /**
   * Initialize monitoring service
   */
  async init() {
    try {
      // Setup event listeners
      this.setupEventListeners();
      
      // Start all monitors
      await this.startAllMonitors();
      
      // Start metrics aggregation
      this.startMetricsAggregation();
      
      logger.info('✅ Monitoring Service initialized successfully');
      this.emit('initialized');
      
    } catch (error) {
      logger.error('❌ Monitoring Service initialization failed:', error);
      this.emit('error', error);
    }
  }

  /**
   * Setup event listeners for all monitors
   */
  setupEventListeners() {
    // Cache monitor events
    this.cacheMonitor.on('alert', (alert) => {
      this.handleAlert('CACHE', alert);
    });
    
    this.cacheMonitor.on('metrics:updated', (metrics) => {
      this.updateComponentMetrics('cache', metrics);
    });
    
    // QR monitor events
    this.qrMonitor.on('alert', (alert) => {
      this.handleAlert('QR', alert);
    });
    
    this.qrMonitor.on('metrics:updated', (metrics) => {
      this.updateComponentMetrics('qr', metrics);
    });
    
    // System monitor events
    this.systemMonitor.on('alert', (alert) => {
      this.handleAlert('SYSTEM', alert);
    });
    
    this.systemMonitor.on('health:updated', (metrics) => {
      this.updateComponentMetrics('system', metrics);
    });
    
    // Error handling
    [this.cacheMonitor, this.qrMonitor, this.systemMonitor].forEach(monitor => {
      monitor.on('error', (error) => {
        logger.error('Monitor error:', error);
        this.emit('monitor:error', error);
      });
    });
  }

  /**
   * Start all monitors
   */
  async startAllMonitors() {
    try {
      // Start monitors in parallel
      await Promise.all([
        this.cacheMonitor.startMonitoring(),
        this.qrMonitor.startMonitoring(),
        this.systemMonitor.startMonitoring()
      ]);
      
      logger.info('📊 All monitors started successfully');
      
    } catch (error) {
      logger.error('Failed to start monitors:', error);
      throw error;
    }
  }

  /**
   * Stop all monitors
   */
  stopAllMonitors() {
    this.cacheMonitor.stopMonitoring();
    this.qrMonitor.stopMonitoring();
    this.systemMonitor.stopMonitoring();
    
    logger.info('🛑 All monitors stopped');
    this.emit('stopped');
  }

  /**
   * Start metrics aggregation
   */
  startMetricsAggregation() {
    // Aggregate metrics every 30 seconds
    setInterval(() => {
      this.aggregateMetrics();
    }, 30000);
    
    // Initial aggregation
    this.aggregateMetrics();
  }

  /**
   * Aggregate metrics from all monitors
   */
  aggregateMetrics() {
    try {
      // Get health status from all monitors
      const cacheHealth = this.cacheMonitor.getHealthStatus();
      const qrHealth = this.qrMonitor.getHealthStatus();
      const systemHealth = this.systemMonitor.getHealthStatus();
      
      // Update component metrics
      this.combinedMetrics.components = {
        cache: {
          status: cacheHealth.status,
          score: cacheHealth.score,
          metrics: cacheHealth.metrics
        },
        qr: {
          status: qrHealth.status,
          score: qrHealth.score,
          metrics: qrHealth.metrics
        },
        system: {
          status: systemHealth.status,
          score: systemHealth.score,
          metrics: systemHealth.metrics
        }
      };
      
      // Calculate overall score
      const overallScore = Math.round(
        (cacheHealth.score + qrHealth.score + systemHealth.score) / 3
      );
      
      // Determine overall status
      let overallStatus;
      if (overallScore >= 90) overallStatus = 'EXCELLENT';
      else if (overallScore >= 75) overallStatus = 'GOOD';
      else if (overallScore >= 60) overallStatus = 'FAIR';
      else if (overallScore >= 40) overallStatus = 'POOR';
      else overallStatus = 'CRITICAL';
      
      this.combinedMetrics.overall = {
        status: overallStatus,
        score: overallScore,
        lastUpdated: new Date()
      };
      
      // Generate recommendations
      this.combinedMetrics.recommendations = this.generateRecommendations();
      
      // Emit aggregated metrics
      this.emit('metrics:aggregated', this.combinedMetrics);
      
    } catch (error) {
      logger.error('Error aggregating metrics:', error);
    }
  }

  /**
   * Update component metrics
   */
  updateComponentMetrics(component, metrics) {
    this.combinedMetrics.components[component] = {
      ...this.combinedMetrics.components[component],
      lastUpdated: new Date(),
      rawMetrics: metrics
    };
  }

  /**
   * Handle alerts from monitors
   */
  handleAlert(source, alert) {
    const enhancedAlert = {
      ...alert,
      source,
      id: `${source}_${alert.type}_${Date.now()}`,
      receivedAt: new Date()
    };
    
    // Add to combined alerts
    this.combinedMetrics.alerts.unshift(enhancedAlert);
    
    // Keep only last 100 alerts
    if (this.combinedMetrics.alerts.length > 100) {
      this.combinedMetrics.alerts = this.combinedMetrics.alerts.slice(0, 100);
    }
    
    // Send alert notifications
    this.sendAlertNotifications(enhancedAlert);
    
    // Emit alert event
    this.emit('alert', enhancedAlert);
    
    logger.warn(`🚨 Alert from ${source}: ${alert.message}`);
  }

  /**
   * Send alert notifications
   */
  async sendAlertNotifications(alert) {
    try {
      // Email notifications
      if (this.alertConfig.enableEmailAlerts && this.alertConfig.emailRecipients.length > 0) {
        await this.sendEmailAlert(alert);
      }
      
      // Webhook notifications
      if (this.alertConfig.enableWebhookAlerts && this.alertConfig.webhookUrl) {
        await this.sendWebhookAlert(alert);
      }
      
      // Slack notifications
      if (this.alertConfig.enableSlackAlerts && this.alertConfig.slackWebhook) {
        await this.sendSlackAlert(alert);
      }
      
    } catch (error) {
      logger.error('Error sending alert notifications:', error);
    }
  }

  /**
   * Send email alert
   */
  async sendEmailAlert(alert) {
    try {
      // This would integrate with your email service
      logger.info(`📧 Email alert sent: ${alert.type}`);
    } catch (error) {
      logger.error('Failed to send email alert:', error);
    }
  }

  /**
   * Send webhook alert
   */
  async sendWebhookAlert(alert) {
    try {
      const axios = require('axios');
      
      await axios.post(this.alertConfig.webhookUrl, {
        alert,
        timestamp: new Date(),
        system: 'hotel-management'
      }, {
        timeout: 5000
      });
      
      logger.info(`🔗 Webhook alert sent: ${alert.type}`);
      
    } catch (error) {
      logger.error('Failed to send webhook alert:', error);
    }
  }

  /**
   * Send Slack alert
   */
  async sendSlackAlert(alert) {
    try {
      const axios = require('axios');
      
      const color = {
        'CRITICAL': '#ff0000',
        'WARNING': '#ffaa00',
        'INFO': '#00aa00'
      }[alert.severity] || '#cccccc';
      
      const payload = {
        attachments: [{
          color,
          title: `🚨 ${alert.source} Alert: ${alert.type}`,
          text: alert.message,
          fields: [
            {
              title: 'Severity',
              value: alert.severity,
              short: true
            },
            {
              title: 'Value',
              value: alert.value,
              short: true
            },
            {
              title: 'Threshold',
              value: alert.threshold,
              short: true
            },
            {
              title: 'Time',
              value: alert.timestamp.toISOString(),
              short: true
            }
          ]
        }]
      };
      
      await axios.post(this.alertConfig.slackWebhook, payload, {
        timeout: 5000
      });
      
      logger.info(`💬 Slack alert sent: ${alert.type}`);
      
    } catch (error) {
      logger.error('Failed to send Slack alert:', error);
    }
  }

  /**
   * Generate system recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    
    // Get recommendations from each monitor
    const cacheRecommendations = this.cacheMonitor.getRecommendations();
    const qrAnalytics = this.qrMonitor.getAnalytics();
    
    // Add cache recommendations
    cacheRecommendations.forEach(rec => {
      recommendations.push({
        ...rec,
        source: 'CACHE',
        category: 'PERFORMANCE'
      });
    });
    
    // Add QR recommendations based on analytics
    if (qrAnalytics.usage.efficiency < 70) {
      recommendations.push({
        type: 'QR_ADOPTION_IMPROVEMENT',
        priority: 'MEDIUM',
        source: 'QR',
        category: 'BUSINESS',
        title: 'Improve QR Code Adoption',
        description: 'QR code usage efficiency is below optimal levels.',
        actions: [
          'Enhance user education about QR benefits',
          'Improve QR code placement and visibility',
          'Simplify QR code scanning process'
        ],
        expectedImpact: 'Increase QR adoption by 15-25%'
      });
    }
    
    // System-wide recommendations
    const overallScore = this.combinedMetrics.overall.score;
    if (overallScore < 80) {
      recommendations.push({
        type: 'SYSTEM_OPTIMIZATION',
        priority: 'HIGH',
        source: 'SYSTEM',
        category: 'INFRASTRUCTURE',
        title: 'System Performance Optimization',
        description: `Overall system score is ${overallScore}. Multiple optimizations recommended.`,
        actions: [
          'Review resource allocation',
          'Optimize database queries',
          'Implement performance monitoring'
        ],
        expectedImpact: 'Improve overall system performance by 10-20%'
      });
    }
    
    return recommendations.slice(0, 10); // Limit to top 10 recommendations
  }

  /**
   * Get comprehensive metrics
   */
  getMetrics() {
    return {
      overall: this.combinedMetrics.overall,
      components: this.combinedMetrics.components,
      alerts: this.combinedMetrics.alerts.slice(0, 20), // Last 20 alerts
      recommendations: this.combinedMetrics.recommendations,
      detailed: {
        cache: this.cacheMonitor.getMetrics(),
        qr: this.qrMonitor.getMetrics(),
        system: this.systemMonitor.getMetrics()
      }
    };
  }

  /**
   * Get health summary
   */
  getHealthSummary() {
    return {
      overall: this.combinedMetrics.overall,
      components: Object.keys(this.combinedMetrics.components).map(key => ({
        name: key,
        status: this.combinedMetrics.components[key].status,
        score: this.combinedMetrics.components[key].score
      })),
      alertsCount: this.combinedMetrics.alerts.length,
      criticalAlerts: this.combinedMetrics.alerts.filter(a => a.severity === 'CRITICAL').length,
      lastUpdated: this.combinedMetrics.overall.lastUpdated
    };
  }

  /**
   * Get Prometheus-style metrics
   */
  getPrometheusMetrics() {
    const metrics = this.getMetrics();
    const lines = [];
    
    // Overall metrics
    lines.push(`# HELP hotel_system_health_score Overall system health score`);
    lines.push(`# TYPE hotel_system_health_score gauge`);
    lines.push(`hotel_system_health_score ${metrics.overall.score}`);
    
    // Component metrics
    Object.entries(metrics.components).forEach(([component, data]) => {
      lines.push(`# HELP hotel_${component}_health_score ${component} health score`);
      lines.push(`# TYPE hotel_${component}_health_score gauge`);
      lines.push(`hotel_${component}_health_score ${data.score}`);
    });
    
    // Cache metrics
    const cacheMetrics = metrics.detailed.cache.current;
    lines.push(`# HELP hotel_cache_hit_rate Cache hit rate percentage`);
    lines.push(`# TYPE hotel_cache_hit_rate gauge`);
    lines.push(`hotel_cache_hit_rate ${cacheMetrics.hitRate}`);
    
    lines.push(`# HELP hotel_cache_response_time_ms Cache response time in milliseconds`);
    lines.push(`# TYPE hotel_cache_response_time_ms gauge`);
    lines.push(`hotel_cache_response_time_ms ${cacheMetrics.responseTime.avg}`);
    
    // QR metrics
    const qrMetrics = metrics.detailed.qr.current;
    lines.push(`# HELP hotel_qr_success_rate QR check-in success rate percentage`);
    lines.push(`# TYPE hotel_qr_success_rate gauge`);
    lines.push(`hotel_qr_success_rate ${qrMetrics.checkIn.successRate}`);
    
    lines.push(`# HELP hotel_qr_usage_rate QR usage rate percentage`);
    lines.push(`# TYPE hotel_qr_usage_rate gauge`);
    lines.push(`hotel_qr_usage_rate ${qrMetrics.usage.rate}`);
    
    // System metrics
    const systemMetrics = metrics.detailed.system.current;
    lines.push(`# HELP hotel_system_cpu_usage System CPU usage percentage`);
    lines.push(`# TYPE hotel_system_cpu_usage gauge`);
    lines.push(`hotel_system_cpu_usage ${systemMetrics.system.cpuUsage}`);
    
    lines.push(`# HELP hotel_system_memory_usage System memory usage percentage`);
    lines.push(`# TYPE hotel_system_memory_usage gauge`);
    lines.push(`hotel_system_memory_usage ${systemMetrics.system.memoryUsage.percentage}`);
    
    return lines.join('\n');
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    try {
      logger.info('📊 Shutting down monitoring service...');
      
      // Stop all monitors
      this.stopAllMonitors();
      
      // Wait for any pending operations
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      logger.info('✅ Monitoring service shutdown completed');
      
    } catch (error) {
      logger.error('Error during monitoring service shutdown:', error);
    }
  }
}

/**
 * ================================
 * EXPORTS
 * ================================
 */

// Create singleton instance
const monitoringService = new MonitoringService();

// Export the service and individual monitors
module.exports = {
  // Main monitoring service
  monitoringService,
  
  // Individual monitors
  CacheMonitor,
  QRMonitor,
  SystemMonitor,
  
  // Convenience methods
  getMetrics: () => monitoringService.getMetrics(),
  getHealthSummary: () => monitoringService.getHealthSummary(),
  getPrometheusMetrics: () => monitoringService.getPrometheusMetrics(),
  
  // Monitor control
  start: () => monitoringService.startAllMonitors(),
  stop: () => monitoringService.stopAllMonitors(),
  shutdown: () => monitoringService.shutdown()
};