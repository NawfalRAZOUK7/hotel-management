/**
 * CACHE MIDDLEWARE - HTTP RESPONSE CACHING
 * Middleware pour cache automatique des réponses HTTP avec gestion intelligente
 * 
 * Fonctionnalités :
 * - Response caching middleware automatique
 * - Cache headers intelligents (ETag, Last-Modified, Cache-Control)
 * - Conditional caching basé sur routes et contenus
 * - Cache warming proactif
 * - Invalidation automatique
 * - Compression intégrée
 * - Cache bypass pour développement
 * - Monitoring et métriques
 */

const cacheService = require('../services/cacheService');
const { CacheKeys, TTL } = require('../utils/cacheKeys');
const { logger } = require('../utils/logger');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

// Promisify compression
const gzip = promisify(zlib.gzip);

/**
 * ================================
 * CACHE CONFIGURATION
 * ================================
 */
const CACHE_CONFIG = {
  // Cache behavior
  defaultTTL: 5 * 60, // 5 minutes
  maxAge: 24 * 60 * 60, // 24 hours max
  staleWhileRevalidate: 60, // 1 minute stale
  
  // Cache conditions
  minResponseSize: 100, // Minimum 100 bytes to cache
  maxResponseSize: 10 * 1024 * 1024, // Max 10MB response
  
  // Headers
  cacheHeader: 'X-Cache',
  etagHeader: 'ETag',
  lastModifiedHeader: 'Last-Modified',
  
  // Environment
  enabled: process.env.HTTP_CACHE_ENABLED !== 'false',
  bypassInDev: process.env.NODE_ENV === 'development' && process.env.CACHE_IN_DEV !== 'true',
  
  // Routes configuration
  routes: {
    // High cache (6 hours)
    longCache: [
      '/api/hotels/search',
      '/api/hotels/:id',
      '/api/analytics/stats'
    ],
    
    // Medium cache (30 minutes)
    mediumCache: [
      '/api/availability',
      '/api/yield/pricing',
      '/api/analytics/dashboard'
    ],
    
    // Short cache (5 minutes)
    shortCache: [
      '/api/bookings/stats',
      '/api/hotels/:id/occupancy',
      '/api/realtime/metrics'
    ],
    
    // No cache
    noCache: [
      '/api/auth/*',
      '/api/bookings/create',
      '/api/payments/*',
      '/api/admin/actions/*',
      '/api/qr/*'
    ]
  }
};

/**
 * ================================
 * CACHE STRATEGY DETECTOR
 * ================================
 */
class CacheStrategyDetector {
  constructor() {
    this.strategies = new Map();
  }

  /**
   * Détermine la stratégie de cache pour une route
   */
  detectStrategy(req) {
    const { method, path, route } = req;
    const routePath = route?.path || path;
    
    // Skip non-GET requests
    if (method !== 'GET') {
      return { strategy: 'none', reason: 'non-GET request' };
    }
    
    // Check no-cache routes
    if (this.matchesRoutes(routePath, CACHE_CONFIG.routes.noCache)) {
      return { strategy: 'none', reason: 'no-cache route' };
    }
    
    // Check specific cache routes
    if (this.matchesRoutes(routePath, CACHE_CONFIG.routes.longCache)) {
      return { 
        strategy: 'long', 
        ttl: TTL.HOTEL_DATA.CONFIGURATION,
        maxAge: 6 * 60 * 60,
        reason: 'long-cache route'
      };
    }
    
    if (this.matchesRoutes(routePath, CACHE_CONFIG.routes.mediumCache)) {
      return { 
        strategy: 'medium', 
        ttl: TTL.YIELD_PRICING.CALCULATION,
        maxAge: 30 * 60,
        reason: 'medium-cache route'
      };
    }
    
    if (this.matchesRoutes(routePath, CACHE_CONFIG.routes.shortCache)) {
      return { 
        strategy: 'short', 
        ttl: TTL.AVAILABILITY.SHORT,
        maxAge: 5 * 60,
        reason: 'short-cache route'
      };
    }
    
    // Default strategy based on content type
    return this.detectByContent(req);
  }

  /**
   * Détecte la stratégie basée sur le contenu
   */
  detectByContent(req) {
    const { query, params } = req;
    
    // Analytics queries - medium cache
    if (query.analytics || query.stats || query.metrics) {
      return { 
        strategy: 'medium', 
        ttl: TTL.ANALYTICS.REPORTS,
        maxAge: 30 * 60,
        reason: 'analytics content'
      };
    }
    
    // Real-time data - short cache
    if (query.realtime || query.live) {
      return { 
        strategy: 'short', 
        ttl: TTL.REAL_TIME.LIVE_METRICS,
        maxAge: 2 * 60,
        reason: 'realtime content'
      };
    }
    
    // Hotel/availability data - medium cache
    if (params.hotelId || query.hotelId || query.availability) {
      return { 
        strategy: 'medium', 
        ttl: TTL.AVAILABILITY.MEDIUM,
        maxAge: 15 * 60,
        reason: 'hotel/availability content'
      };
    }
    
    // Default short cache
    return { 
      strategy: 'short', 
      ttl: CACHE_CONFIG.defaultTTL,
      maxAge: 5 * 60,
      reason: 'default strategy'
    };
  }

  /**
   * Vérifie si le path correspond aux routes données
   */
  matchesRoutes(path, routes) {
    return routes.some(route => {
      // Convert Express route to regex
      const pattern = route
        .replace(/:[^\s/]+/g, '[^/]+')  // :id -> [^/]+
        .replace(/\*/g, '.*');          // * -> .*
      
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(path);
    });
  }
}

/**
 * ================================
 * CACHE KEY GENERATOR
 * ================================
 */
class HttpCacheKeyGenerator {
  /**
   * Génère une clé de cache pour la requête HTTP
   */
  generateKey(req, strategy) {
    const { method, path, query, user, headers } = req;
    
    // Base components
    const components = [
      'http_cache',
      method.toLowerCase(),
      this.sanitizePath(path)
    ];
    
    // Add query parameters (sorted for consistency)
    if (query && Object.keys(query).length > 0) {
      const sortedQuery = this.sortAndStringifyQuery(query);
      components.push('q' + this.hashString(sortedQuery));
    }
    
    // Add user context for personalized responses
    if (user && this.requiresUserContext(req)) {
      components.push('u' + user.id);
      
      // Add role if relevant
      if (user.role && user.role !== 'CLIENT') {
        components.push('r' + user.role.toLowerCase());
      }
    }
    
    // Add content negotiation
    const acceptHeader = headers.accept || headers['content-type'];
    if (acceptHeader && acceptHeader !== 'application/json') {
      components.push('ct' + this.hashString(acceptHeader));
    }
    
    // Add language if present
    const language = headers['accept-language'] || query.lang;
    if (language) {
      components.push('l' + language.substring(0, 2));
    }
    
    // Build final key
    const key = CacheKeys.generateKey('http', ...components);
    
    logger.debug(`Generated cache key: ${key} (strategy: ${strategy.strategy})`);
    
    return key;
  }

  /**
   * Sanitize le path pour utilisation en clé
   */
  sanitizePath(path) {
    return path
      .replace(/^\/api\//, '')  // Remove /api/ prefix
      .replace(/\//g, '_')      // Replace slashes with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove special chars
      .substring(0, 50);        // Limit length
  }

  /**
   * Trie et stringify les paramètres de query
   */
  sortAndStringifyQuery(query) {
    const sorted = {};
    Object.keys(query).sort().forEach(key => {
      sorted[key] = query[key];
    });
    return JSON.stringify(sorted);
  }

  /**
   * Hash une chaîne
   */
  hashString(str) {
    return crypto.createHash('md5').update(str).digest('hex').substring(0, 8);
  }

  /**
   * Détermine si la requête nécessite un contexte utilisateur
   */
  requiresUserContext(req) {
    const { path } = req;
    
    // Personalised routes
    const personalizedRoutes = [
      '/api/bookings',
      '/api/user/',
      '/api/dashboard',
      '/api/analytics/personal'
    ];
    
    return personalizedRoutes.some(route => path.includes(route));
  }
}

/**
 * ================================
 * CACHE HEADERS MANAGER
 * ================================
 */
class CacheHeadersManager {
  /**
   * Génère les headers de cache appropriés
   */
  generateHeaders(strategy, data, req) {
    const headers = {};
    const now = new Date();
    
    // ETag based on content
    if (data && typeof data === 'object') {
      headers[CACHE_CONFIG.etagHeader] = this.generateETag(data);
    }
    
    // Last-Modified
    if (data && data.updatedAt) {
      headers[CACHE_CONFIG.lastModifiedHeader] = new Date(data.updatedAt).toUTCString();
    } else {
      headers[CACHE_CONFIG.lastModifiedHeader] = now.toUTCString();
    }
    
    // Cache-Control
    headers['Cache-Control'] = this.generateCacheControl(strategy);
    
    // Expires header
    const expiresDate = new Date(now.getTime() + strategy.maxAge * 1000);
    headers['Expires'] = expiresDate.toUTCString();
    
    // Custom cache header
    headers[CACHE_CONFIG.cacheHeader] = 'MISS';
    
    // Vary header for content negotiation
    headers['Vary'] = 'Accept, Accept-Language, Authorization';
    
    return headers;
  }

  /**
   * Génère Cache-Control header
   */
  generateCacheControl(strategy) {
    const directives = [];
    
    switch (strategy.strategy) {
      case 'long':
        directives.push('public');
        directives.push(`max-age=${strategy.maxAge}`);
        directives.push(`s-maxage=${Math.floor(strategy.maxAge * 1.2)}`); // CDN cache longer
        break;
        
      case 'medium':
        directives.push('public');
        directives.push(`max-age=${strategy.maxAge}`);
        directives.push(`stale-while-revalidate=${CACHE_CONFIG.staleWhileRevalidate}`);
        break;
        
      case 'short':
        directives.push('public');
        directives.push(`max-age=${strategy.maxAge}`);
        directives.push('must-revalidate');
        break;
        
      default:
        directives.push('no-cache');
        directives.push('no-store');
        directives.push('must-revalidate');
    }
    
    return directives.join(', ');
  }

  /**
   * Génère un ETag basé sur le contenu
   */
  generateETag(data) {
    const content = JSON.stringify(data);
    const hash = crypto.createHash('md5').update(content).digest('hex');
    return `"${hash.substring(0, 16)}"`;
  }

  /**
   * Vérifie les headers conditionnels
   */
  checkConditionalHeaders(req, cachedHeaders) {
    const { headers } = req;
    
    // If-None-Match (ETag)
    if (headers['if-none-match'] && cachedHeaders[CACHE_CONFIG.etagHeader]) {
      const clientETag = headers['if-none-match'];
      const cachedETag = cachedHeaders[CACHE_CONFIG.etagHeader];
      
      if (clientETag === cachedETag) {
        return { notModified: true, reason: 'ETag match' };
      }
    }
    
    // If-Modified-Since
    if (headers['if-modified-since'] && cachedHeaders[CACHE_CONFIG.lastModifiedHeader]) {
      const clientDate = new Date(headers['if-modified-since']);
      const cachedDate = new Date(cachedHeaders[CACHE_CONFIG.lastModifiedHeader]);
      
      if (clientDate >= cachedDate) {
        return { notModified: true, reason: 'Not modified since' };
      }
    }
    
    return { notModified: false };
  }
}

/**
 * ================================
 * MAIN CACHE MIDDLEWARE
 * ================================
 */
class HttpCacheMiddleware {
  constructor() {
    this.strategyDetector = new CacheStrategyDetector();
    this.keyGenerator = new HttpCacheKeyGenerator();
    this.headersManager = new CacheHeadersManager();
    
    // Statistics
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      bypassed: 0,
      totalRequests: 0
    };
    
    // Warm-up queue
    this.warmupQueue = new Set();
  }

  /**
   * Middleware principal de cache
   */
  middleware() {
    return async (req, res, next) => {
      // Skip if caching disabled
      if (!CACHE_CONFIG.enabled || CACHE_CONFIG.bypassInDev) {
        this.stats.bypassed++;
        return next();
      }
      
      this.stats.totalRequests++;
      
      try {
        // Detect cache strategy
        const strategy = this.strategyDetector.detectStrategy(req);
        
        // Skip if no caching strategy
        if (strategy.strategy === 'none') {
          this.stats.bypassed++;
          return next();
        }
        
        // Generate cache key
        const cacheKey = this.keyGenerator.generateKey(req, strategy);
        
        // Try to get from cache
        const cached = await this.getCachedResponse(cacheKey);
        
        if (cached) {
          return this.serveCachedResponse(req, res, cached, strategy);
        }
        
        // Cache miss - intercept response
        return this.interceptResponse(req, res, next, cacheKey, strategy);
        
      } catch (error) {
        this.stats.errors++;
        logger.error('Cache middleware error:', error);
        
        // Continue without caching on error
        return next();
      }
    };
  }

  /**
   * Récupère la réponse cachée
   */
  async getCachedResponse(cacheKey) {
    try {
      const cachedData = await cacheService.redis.get(cacheKey);
      
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        
        // Check if not expired
        if (new Date(parsed.expiresAt) > new Date()) {
          return parsed;
        } else {
          // Remove expired cache
          await cacheService.redis.del(cacheKey);
        }
      }
      
      return null;
      
    } catch (error) {
      logger.error('Error getting cached response:', error);
      return null;
    }
  }

  /**
   * Sert la réponse cachée
   */
  serveCachedResponse(req, res, cached, strategy) {
    this.stats.hits++;
    
    // Check conditional headers
    const conditional = this.headersManager.checkConditionalHeaders(req, cached.headers);
    
    if (conditional.notModified) {
      // Return 304 Not Modified
      res.status(304);
      res.set(cached.headers);
      res.set(CACHE_CONFIG.cacheHeader, 'HIT-304');
      return res.end();
    }
    
    // Serve cached response
    res.status(cached.statusCode);
    res.set(cached.headers);
    res.set(CACHE_CONFIG.cacheHeader, 'HIT');
    
    // Handle different content types
    if (cached.compressed) {
      res.set('Content-Encoding', 'gzip');
      return res.end(Buffer.from(cached.body, 'base64'));
    } else {
      return res.json(cached.body);
    }
  }

  /**
   * Intercepte la réponse pour la mettre en cache
   */
  interceptResponse(req, res, next, cacheKey, strategy) {
    this.stats.misses++;
    
    // Store original methods
    const originalJson = res.json;
    const originalSend = res.send;
    const originalEnd = res.end;
    
    let responseBody = null;
    let responseSent = false;
    
    // Override json method
    res.json = (data) => {
      if (!responseSent) {
        responseBody = data;
        this.cacheResponse(cacheKey, res.statusCode, data, res.getHeaders(), strategy);
        responseSent = true;
      }
      return originalJson.call(res, data);
    };
    
    // Override send method
    res.send = (data) => {
      if (!responseSent) {
        responseBody = data;
        this.cacheResponse(cacheKey, res.statusCode, data, res.getHeaders(), strategy);
        responseSent = true;
      }
      return originalSend.call(res, data);
    };
    
    // Add cache headers
    const headers = this.headersManager.generateHeaders(strategy, null, req);
    res.set(headers);
    
    // Continue to next middleware
    next();
  }

  /**
   * Met en cache la réponse
   */
  async cacheResponse(cacheKey, statusCode, body, headers, strategy) {
    try {
      // Only cache successful responses
      if (statusCode < 200 || statusCode >= 300) {
        return;
      }
      
      // Check response size
      const bodySize = JSON.stringify(body).length;
      if (bodySize < CACHE_CONFIG.minResponseSize || bodySize > CACHE_CONFIG.maxResponseSize) {
        return;
      }
      
      // Prepare cache data
      const cacheData = {
        statusCode,
        body,
        headers: { ...headers },
        cachedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + strategy.ttl * 1000).toISOString(),
        strategy: strategy.strategy,
        compressed: false
      };
      
      // Compress large responses
      if (bodySize > 1024) {
        try {
          const compressed = await gzip(JSON.stringify(body));
          if (compressed.length < bodySize) {
            cacheData.body = compressed.toString('base64');
            cacheData.compressed = true;
          }
        } catch (compressionError) {
          logger.warn('Response compression failed:', compressionError);
        }
      }
      
      // Update cache headers
      cacheData.headers[CACHE_CONFIG.cacheHeader] = 'MISS';
      
      // Store in cache
      await cacheService.redis.setEx(cacheKey, strategy.ttl, JSON.stringify(cacheData));
      
      logger.debug(`Cached response: ${cacheKey} (${strategy.strategy}, ${strategy.ttl}s)`);
      
    } catch (error) {
      logger.error('Error caching response:', error);
    }
  }

  /**
   * ================================
   * CACHE WARMING
   * ================================
   */

  /**
   * Préchauffe le cache pour les routes importantes
   */
  async warmupCache(routes = []) {
    logger.info('🔥 Starting HTTP cache warmup...');
    
    try {
      for (const route of routes) {
        if (!this.warmupQueue.has(route.path)) {
          this.warmupQueue.add(route.path);
          await this.warmupRoute(route);
        }
      }
      
      logger.info(`🔥 HTTP cache warmup completed for ${routes.length} routes`);
      
    } catch (error) {
      logger.error('❌ Error during cache warmup:', error);
    }
  }

  /**
   * Préchauffe une route spécifique
   */
  async warmupRoute(route) {
    try {
      // This would make internal requests to warm up the cache
      // Implementation depends on your internal request system
      logger.debug(`🔥 Warming up route: ${route.path}`);
      
      // Simulate warmup delay
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      logger.error(`❌ Error warming up route ${route.path}:`, error);
    } finally {
      this.warmupQueue.delete(route.path);
    }
  }

  /**
   * ================================
   * UTILITIES & MONITORING
   * ================================
   */

  /**
   * Invalide le cache HTTP pour un pattern
   */
  async invalidatePattern(pattern) {
    try {
      const keys = await cacheService.redis.keys(`*http_cache*${pattern}*`);
      
      if (keys.length > 0) {
        await cacheService.redis.del(keys);
        logger.info(`🗑️ Invalidated ${keys.length} HTTP cache entries for pattern: ${pattern}`);
      }
      
      return keys.length;
      
    } catch (error) {
      logger.error('Error invalidating HTTP cache pattern:', error);
      return 0;
    }
  }

  /**
   * Invalide le cache pour un hôtel
   */
  async invalidateHotelCache(hotelId) {
    const patterns = [
      `*hotel*${hotelId}*`,
      `*availability*${hotelId}*`,
      `*yield*${hotelId}*`,
      `*analytics*${hotelId}*`
    ];
    
    let totalInvalidated = 0;
    
    for (const pattern of patterns) {
      totalInvalidated += await this.invalidatePattern(pattern);
    }
    
    return totalInvalidated;
  }

  /**
   * Statistiques du cache HTTP
   */
  getStats() {
    const hitRate = this.stats.totalRequests > 0 
      ? Math.round((this.stats.hits / this.stats.totalRequests) * 100) 
      : 0;
    
    return {
      ...this.stats,
      hitRate,
      missRate: 100 - hitRate,
      warmupQueue: this.warmupQueue.size,
      config: {
        enabled: CACHE_CONFIG.enabled,
        bypassInDev: CACHE_CONFIG.bypassInDev,
        defaultTTL: CACHE_CONFIG.defaultTTL
      }
    };
  }

  /**
   * Reset des statistiques
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      errors: 0,
      bypassed: 0,
      totalRequests: 0
    };
  }
}

/**
 * ================================
 * EXPORTS
 * ================================
 */

// Create singleton instance
const httpCache = new HttpCacheMiddleware();

module.exports = {
  // Main middleware
  cache: httpCache.middleware.bind(httpCache),
  
  // Utility methods
  invalidatePattern: httpCache.invalidatePattern.bind(httpCache),
  invalidateHotelCache: httpCache.invalidateHotelCache.bind(httpCache),
  warmupCache: httpCache.warmupCache.bind(httpCache),
  
  // Monitoring
  getStats: httpCache.getStats.bind(httpCache),
  resetStats: httpCache.resetStats.bind(httpCache),
  
  // Classes for custom instances
  HttpCacheMiddleware,
  CacheStrategyDetector,
  HttpCacheKeyGenerator,
  CacheHeadersManager,
  
  // Configuration
  CACHE_CONFIG
};