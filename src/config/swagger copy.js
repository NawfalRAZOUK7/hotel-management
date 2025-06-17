/**
 * Hotel Management System - Enhanced Swagger Documentation with QR + Cache APIs
 * Author: Nawfal Razouk
 * Description: Complete OpenAPI/Swagger configuration including QR codes and Redis caching
 */

const swaggerJsdoc = require('swagger-jsdoc');

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Hotel Management System API - QR + Cache Enhanced',
    version: '2.1.0',
    description: `
      Système de gestion hôtelière complet avec QR codes sécurisés et cache Redis optimisé.
      
      ## Nouvelles Fonctionnalités Phase C3
      - 🔐 **QR Codes sécurisés** : Génération, validation, check-in automatisé
      - ⚡ **Redis Caching** : Performance optimisée avec TTL intelligents
      - 📊 **Monitoring avancé** : Health checks et métriques temps réel
      - 🏨 **Programme fidélité** : Système de points et avantages complet
      - 📈 **Analytics** : Tableaux de bord et rapports détaillés
      
      ## QR Codes System Overview
      Le système QR permet :
      - **Check-in contactless** : QR sécurisés avec JWT + expiration
      - **Validation temps réel** : Vérification instantanée avec audit
      - **Tracking complet** : Analytics usage, performance, sécurité
      - **Multi-styles** : QR personnalisés (hôtel, mobile, impression)
      - **Sécurité avancée** : Rate limiting, révocation, anti-fraude
      
      ## Redis Cache System Overview
      Le cache Redis optimise :
      - **Disponibilités** : Cache 5min pour données temps réel
      - **Tarification** : Cache 30min pour pricing dynamique
      - **Analytics** : Cache 1h pour rapports et métriques
      - **Données hôtel** : Cache 6h pour infos statiques
      - **Invalidation intelligente** : Triggers automatiques sur changements
      
      ## Authentication
      La plupart des endpoints nécessitent l'authentification JWT :
      \`Authorization: Bearer <your-jwt-token>\`
      
      ## Rate Limiting
      - Endpoints généraux : 100 requêtes/15min
      - Auth endpoints : 5 requêtes/15min
      - QR endpoints : 10 requêtes/minute
      - Cache endpoints : 30 requêtes/minute
    `,
    contact: {
      name: 'Nawfal Razouk',
      email: 'nawfal.razouk@enim.ac.ma',
      url: 'https://github.com/nawfalrazouk',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url:
        process.env.NODE_ENV === 'production'
          ? 'https://your-hotel-api.com/api'
          : `http://localhost:${process.env.PORT || 5000}/api`,
      description:
        process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
    },
  ],

  // Ajout des nouveaux schemas QR + Cache
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter JWT token obtained from login endpoint',
      },
    },
    schemas: {
      // ============================================================================
      // EXISTING SCHEMAS PRESERVED (Error, Success, User, Hotel, etc.)
      // ============================================================================

      // All existing schemas from loyalty program are kept as-is

      // ============================================================================
      // NEW QR CODES SCHEMAS
      // ============================================================================

      QRCodeGeneration: {
        type: 'object',
        properties: {
          qrCodeId: {
            type: 'string',
            example: 'qr_64a1b2c3d4e5f6789012345',
            description: 'Identifiant unique du QR code',
          },
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            description: 'Token JWT sécurisé du QR code',
          },
          qrCode: {
            type: 'object',
            properties: {
              dataURL: {
                type: 'string',
                example: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...',
                description: 'QR code en format Base64 Data URL',
              },
              svg: {
                type: 'string',
                example: '<svg width="300" height="300">...</svg>',
                description: 'QR code en format SVG vectoriel',
              },
              metadata: {
                type: 'object',
                properties: {
                  format: { type: 'string', example: 'image/png' },
                  width: { type: 'integer', example: 300 },
                  height: { type: 'integer', example: 300 },
                  size: { type: 'integer', example: 15420 },
                  style: { type: 'string', example: 'hotel' },
                },
              },
            },
          },
          validity: {
            type: 'object',
            properties: {
              expiresAt: {
                type: 'string',
                format: 'date-time',
                example: '2025-06-16T14:00:00Z',
              },
              maxUsage: {
                type: 'integer',
                example: 5,
                description: "Nombre maximum d'utilisations",
              },
              hoursValid: {
                type: 'integer',
                example: 24,
                description: 'Durée de validité en heures',
              },
            },
          },
        },
      },

      QRCodeValidation: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          data: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: [
                  'CHECK_IN',
                  'CHECK_OUT',
                  'ROOM_ACCESS',
                  'PAYMENT',
                  'MENU',
                  'WIFI',
                  'FEEDBACK',
                ],
                example: 'CHECK_IN',
              },
              identifier: {
                type: 'string',
                example: 'checkin_64a1b2c3d4e5f6789012348',
              },
              usageCount: {
                type: 'integer',
                example: 1,
              },
              remainingUsage: {
                type: 'integer',
                example: 4,
              },
              payload: {
                type: 'object',
                description: 'Données originales du QR code',
              },
            },
          },
          validation: {
            type: 'object',
            properties: {
              validatedBy: {
                type: 'string',
                example: '64a1b2c3d4e5f6789012345',
              },
              validatedAt: {
                type: 'string',
                format: 'date-time',
              },
              method: {
                type: 'string',
                example: 'validate',
              },
            },
          },
        },
      },

      QRCodeCheckIn: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Check-in QR traité avec succès',
          },
          data: {
            type: 'object',
            properties: {
              booking: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  customer: { type: 'string', example: 'John Doe' },
                  hotel: { type: 'string', example: 'Grand Hotel Palace' },
                  checkInTime: { type: 'string', format: 'date-time' },
                  status: { type: 'string', example: 'CHECKED_IN' },
                },
              },
              qrProcessing: {
                type: 'object',
                properties: {
                  tokenUsed: { type: 'string' },
                  remainingUsage: { type: 'integer', example: 4 },
                  method: { type: 'string', example: 'QR_CODE' },
                  processedAt: { type: 'string', format: 'date-time' },
                },
              },
              roomInfo: {
                type: 'object',
                properties: {
                  assigned: { type: 'integer', example: 2 },
                  total: { type: 'integer', example: 2 },
                  assignmentStatus: { type: 'string', example: 'COMPLETED' },
                },
              },
              nextSteps: {
                type: 'object',
                properties: {
                  staff: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Remettez les clés au client', 'Vérifiez la propreté des chambres'],
                  },
                  guest: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Récupération des clés', 'Installation en chambre'],
                  },
                },
              },
            },
          },
        },
      },

      QRCodeStats: {
        type: 'object',
        properties: {
          service: {
            type: 'object',
            properties: {
              rateLimitCache: { type: 'integer', example: 15 },
              auditLogSize: { type: 'integer', example: 500 },
              activeProcesses: { type: 'integer', example: 8 },
              queueSize: { type: 'integer', example: 3 },
            },
          },
          events: {
            type: 'object',
            properties: {
              QR_GENERATED: { type: 'integer', example: 45 },
              QR_VALIDATED: { type: 'integer', example: 38 },
              QR_USED: { type: 'integer', example: 35 },
              QR_VALIDATION_FAILED: { type: 'integer', example: 3 },
            },
          },
          types: {
            type: 'object',
            properties: {
              CHECK_IN: { type: 'integer', example: 30 },
              CHECK_OUT: { type: 'integer', example: 8 },
              ROOM_ACCESS: { type: 'integer', example: 5 },
              PAYMENT: { type: 'integer', example: 2 },
            },
          },
          performance: {
            type: 'object',
            properties: {
              generationRate: { type: 'number', example: 6.4 },
              validationRate: { type: 'number', example: 5.4 },
              errorRate: { type: 'number', example: 2.1 },
            },
          },
        },
      },

      // ============================================================================
      // NEW CACHE MANAGEMENT SCHEMAS
      // ============================================================================

      CacheHealthStatus: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL'],
            example: 'GOOD',
          },
          score: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            example: 87,
          },
          message: {
            type: 'string',
            example: 'Cache performing well',
          },
          metrics: {
            type: 'object',
            properties: {
              hitRate: { type: 'number', example: 85.3 },
              responseTime: { type: 'integer', example: 45 },
              memoryUsage: { type: 'number', example: 68.2 },
              connections: { type: 'integer', example: 12 },
            },
          },
          alerts: {
            type: 'integer',
            example: 1,
            description: "Nombre d'alertes actives",
          },
        },
      },

      CacheMetrics: {
        type: 'object',
        properties: {
          current: {
            type: 'object',
            properties: {
              hitRate: { type: 'number', example: 85.3 },
              missRate: { type: 'number', example: 14.7 },
              responseTime: {
                type: 'object',
                properties: {
                  min: { type: 'integer', example: 12 },
                  max: { type: 'integer', example: 156 },
                  avg: { type: 'integer', example: 45 },
                  p95: { type: 'integer', example: 89 },
                  p99: { type: 'integer', example: 134 },
                },
              },
              memoryUsage: {
                type: 'object',
                properties: {
                  used: { type: 'integer', example: 167772160 },
                  available: { type: 'integer', example: 78643200 },
                  percentage: { type: 'number', example: 68.2 },
                },
              },
              operations: {
                type: 'object',
                properties: {
                  reads: { type: 'integer', example: 1547 },
                  writes: { type: 'integer', example: 234 },
                  deletes: { type: 'integer', example: 89 },
                  errors: { type: 'integer', example: 3 },
                },
              },
            },
          },
          trends: {
            type: 'object',
            properties: {
              hitRate: {
                type: 'array',
                items: { type: 'number' },
                example: [85.3, 86.1, 84.7, 87.2, 85.9],
              },
              responseTime: {
                type: 'array',
                items: { type: 'number' },
                example: [45, 42, 48, 41, 46],
              },
              memoryUsage: {
                type: 'array',
                items: { type: 'number' },
                example: [68.2, 69.1, 67.8, 70.3, 68.9],
              },
            },
          },
        },
      },

      CacheInvalidation: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Cache invalidated successfully',
          },
          data: {
            type: 'object',
            properties: {
              patterns: {
                type: 'array',
                items: { type: 'string' },
                example: ['hotel:64a1b2c3d4e5f6789012346:*', 'availability:*'],
              },
              keysInvalidated: {
                type: 'integer',
                example: 47,
              },
              invalidationTime: {
                type: 'integer',
                example: 156,
                description: "Temps d'invalidation en millisecondes",
              },
              affectedSystems: {
                type: 'array',
                items: { type: 'string' },
                example: ['availability', 'pricing', 'analytics'],
              },
            },
          },
        },
      },

      // ============================================================================
      // NEW HEALTH & MONITORING SCHEMAS
      // ============================================================================

      SystemHealthOverview: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            enum: ['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CRITICAL', 'UNKNOWN'],
            example: 'GOOD',
          },
          score: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            example: 87,
          },
          message: {
            type: 'string',
            example: 'Systems performing well',
          },
          components: {
            type: 'object',
            properties: {
              cache: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'GOOD' },
                  score: { type: 'integer', example: 85 },
                },
              },
              qr: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'EXCELLENT' },
                  score: { type: 'integer', example: 94 },
                },
              },
              system: {
                type: 'object',
                properties: {
                  status: { type: 'string', example: 'GOOD' },
                  score: { type: 'integer', example: 82 },
                },
              },
            },
          },
          alerts: {
            type: 'object',
            properties: {
              total: { type: 'integer', example: 3 },
              critical: { type: 'integer', example: 0 },
            },
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
          },
          responseTime: {
            type: 'string',
            example: '45ms',
          },
        },
      },
    },
  },

  // Tags et sécurité mis à jour
  security: [
    {
      BearerAuth: [],
    },
  ],
  tags: [
    // Tags existants préservés
    {
      name: 'Authentication',
      description: 'User authentication and authorization endpoints',
    },
    {
      name: 'Loyalty Program',
      description: 'Complete loyalty program management with points, tiers, and benefits',
    },
    {
      name: 'Hotels',
      description: 'Hotel management endpoints',
    },
    {
      name: 'Bookings',
      description: 'Booking management endpoints with loyalty integration',
    },

    // Nouveaux tags pour QR + Cache
    {
      name: 'QR Codes',
      description: `
        Système QR codes sécurisé pour check-in contactless.
        
        **Fonctionnalités principales :**
        - Génération QR avec JWT sécurisé
        - Validation multi-niveaux avec audit
        - Check-in automatisé et workflow complet
        - Tracking usage et analytics détaillées
        - Sécurité avancée et rate limiting
        
        **Types supportés :** Check-in, Check-out, Accès chambre, Paiement, Menu, WiFi
      `,
    },
    {
      name: 'Cache Management',
      description: `
        Gestion du cache Redis pour optimisation performance.
        
        **Stratégies de cache :**
        - Disponibilités : 5min TTL
        - Pricing dynamique : 30min TTL  
        - Analytics : 1h TTL
        - Données hôtel : 6h TTL
        
        **Fonctionnalités :**
        - Invalidation intelligente par patterns
        - Monitoring performance temps réel
        - Health checks et alertes
        - Optimisation automatique TTL
      `,
    },
    {
      name: 'Health & Monitoring',
      description: `
        Surveillance système et métriques de performance.
        
        **Endpoints de monitoring :**
        - Health checks globaux et par composant
        - Métriques Prometheus pour Grafana
        - Probes Kubernetes (liveness/readiness)
        - Alertes et notifications automatiques
        
        **Métriques surveillées :**
        - Performance cache (hit rate, latency)
        - Usage QR codes (génération, succès)
        - Santé système (CPU, mémoire, I/O)
      `,
    },
    {
      name: 'Admin',
      description: 'Administrative endpoints (Admin only)',
    },
    {
      name: 'Reception',
      description: 'Reception desk operations (Reception/Admin only)',
    },
    {
      name: 'Users',
      description: 'User profile management endpoints',
    },
  ],

  // Nouveaux paths pour QR Codes
  paths: {
    // ============================================================================
    // QR CODES ENDPOINTS
    // ============================================================================

    '/qr/generate/checkin': {
      post: {
        tags: ['QR Codes'],
        summary: 'Generate QR code for hotel check-in',
        description: `
        Génère un QR code sécurisé pour le check-in d'une réservation.
        
        **Fonctionnalités :**
        - Token JWT sécurisé avec expiration
        - Styling personnalisé (hotel, mobile, print)
        - Tracking d'usage et analytics
        - Validation temporelle (48h avant check-in)
        - Rate limiting et sécurité anti-fraude
        
        **Workflow :**
        1. Validation de la réservation et permissions
        2. Génération du token JWT avec métadonnées
        3. Création du QR code avec styling
        4. Stockage en cache pour tracking
        5. Notifications temps réel
      `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['bookingId'],
                properties: {
                  bookingId: {
                    type: 'string',
                    example: '64a1b2c3d4e5f6789012348',
                    description: 'ID de la réservation',
                  },
                  style: {
                    type: 'string',
                    enum: ['default', 'hotel', 'mobile', 'print'],
                    default: 'hotel',
                    example: 'hotel',
                    description: 'Style du QR code',
                  },
                  expiresIn: {
                    type: 'integer',
                    minimum: 3600,
                    maximum: 604800,
                    default: 86400,
                    example: 86400,
                    description: 'Durée de validité en secondes (1h à 7j)',
                  },
                },
              },
              examples: {
                standardCheckIn: {
                  summary: 'Check-in standard',
                  value: {
                    bookingId: '64a1b2c3d4e5f6789012348',
                    style: 'hotel',
                    expiresIn: 86400,
                  },
                },
                mobileOptimized: {
                  summary: 'Optimisé mobile',
                  value: {
                    bookingId: '64a1b2c3d4e5f6789012348',
                    style: 'mobile',
                    expiresIn: 43200,
                  },
                },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'QR code généré avec succès',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QRCodeGeneration',
                },
              },
            },
          },
          400: {
            description: 'Erreur de validation ou timing',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: {
                      type: 'string',
                      example: 'QR code disponible 48h avant le check-in',
                    },
                    code: { type: 'string', example: 'QR_TOO_EARLY' },
                    availableAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          403: {
            description: 'Accès non autorisé à la réservation',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
          429: {
            description: 'Rate limit dépassé',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Limite de génération QR atteinte' },
                    code: { type: 'string', example: 'QR_GENERATION_RATE_LIMITED' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/qr/validate': {
      post: {
        tags: ['QR Codes'],
        summary: 'Validate QR code token',
        description: `
        Valide un token QR code avec vérifications sécurisées complètes.
        
        **Vérifications effectuées :**
        - Signature JWT et intégrité
        - Expiration et fenêtre de validité
        - Limites d'usage et révocation
        - Contrôles contextuels (IP, hôtel)
        - Rate limiting et audit trail
        
        **Utilisé par :**
        - Personnel de réception pour validation
        - Applications mobiles pour check-in
        - Systèmes automatisés de contrôle
      `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: {
                    type: 'string',
                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    description: 'Token JWT du QR code à valider',
                  },
                  action: {
                    type: 'string',
                    enum: ['validate', 'check_in', 'access'],
                    default: 'validate',
                    example: 'validate',
                    description: "Type d'action de validation",
                  },
                  context: {
                    type: 'object',
                    properties: {
                      hotelId: {
                        type: 'string',
                        example: '64a1b2c3d4e5f6789012346',
                        description: "ID de l'hôtel pour validation contextuelle",
                      },
                      ipAddress: {
                        type: 'string',
                        example: '192.168.1.100',
                        description: 'Adresse IP pour vérification sécurité',
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'QR code validé avec succès',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QRCodeValidation',
                },
              },
            },
          },
          400: {
            description: 'QR code invalide ou expiré',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'QR code invalide' },
                    error: { type: 'string', example: 'Token has expired' },
                    code: { type: 'string', example: 'QR_EXPIRED' },
                  },
                },
              },
            },
          },
          403: {
            description: 'Validation contextuelle échouée',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'QR code ne correspond pas à cet hôtel' },
                    code: { type: 'string', example: 'CONTEXT_VALIDATION_FAILED' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/qr/checkin/process': {
      post: {
        tags: ['QR Codes'],
        summary: 'Process complete QR check-in workflow',
        description: `
        Traite un check-in complet via QR code avec workflow automatisé.
        
        **Workflow automatisé :**
        1. Validation du token QR avec sécurité
        2. Vérification de la réservation et statut
        3. Attribution automatique des chambres
        4. Mise à jour du statut de réservation
        5. Notifications temps réel multi-canaux
        6. Génération des rapports de performance
        
        **Intégrations :**
        - Système de réservation temps réel
        - Notifications Socket.io
        - Analytics et tracking
        - Audit trail complet
      `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['token'],
                properties: {
                  token: {
                    type: 'string',
                    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
                    description: 'Token JWT du QR code check-in',
                  },
                  hotelId: {
                    type: 'string',
                    example: '64a1b2c3d4e5f6789012346',
                    description: "ID de l'hôtel (validation sécurité)",
                  },
                  roomAssignments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        roomId: { type: 'string' },
                        guestId: { type: 'string' },
                        floor: { type: 'integer' },
                      },
                    },
                    example: [{ roomId: '64a1b2c3d4e5f6789012349', guestId: 'guest1', floor: 3 }],
                    description: 'Attribution des chambres',
                  },
                  guestNotes: {
                    type: 'string',
                    maxLength: 500,
                    example: 'Client VIP, préfère étage élevé',
                    description: 'Notes sur les préférences client',
                  },
                  additionalServices: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        serviceId: { type: 'string' },
                        serviceName: { type: 'string' },
                        price: { type: 'number' },
                      },
                    },
                    example: [
                      { serviceId: 'breakfast', serviceName: 'Petit-déjeuner', price: 25.0 },
                    ],
                    description: 'Services additionnels à ajouter',
                  },
                  skipRoomAssignment: {
                    type: 'boolean',
                    default: false,
                    example: false,
                    description: "Reporter l'attribution des chambres",
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Check-in QR traité avec succès',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QRCodeCheckIn',
                },
              },
            },
          },
          400: {
            description: 'Erreur de traitement check-in',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: "Ce QR code n'est pas pour un check-in" },
                    code: { type: 'string', example: 'INVALID_QR_TYPE' },
                    expectedType: { type: 'string', example: 'CHECK_IN' },
                    actualType: { type: 'string', example: 'ROOM_ACCESS' },
                  },
                },
              },
            },
          },
          500: {
            description: 'Erreur système pendant le check-in',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Erreur lors du traitement du check-in' },
                    code: { type: 'string', example: 'CHECKIN_PROCESSING_FAILED' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // Nouveaux paths pour Cache Management
    // ============================================================================
    // CACHE MANAGEMENT ENDPOINTS
    // ============================================================================

    '/health/cache': {
      get: {
        tags: ['Cache Management'],
        summary: 'Get Redis cache health status',
        description: `
      Retourne l'état de santé détaillé du système de cache Redis.
      
      **Métriques incluses :**
      - Hit/Miss rates et performance
      - Utilisation mémoire et connexions
      - Temps de réponse et latence
      - Alertes et recommandations
      - Tendances et optimisations
    `,
        responses: {
          200: {
            description: 'État de santé du cache récupéré',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CacheHealthStatus',
                },
              },
            },
          },
          503: {
            description: 'Cache indisponible ou critique',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'CRITICAL' },
                    message: { type: 'string', example: 'Redis connection failed' },
                    error: { type: 'string', example: 'Connection timeout' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/metrics/cache': {
      get: {
        tags: ['Cache Management'],
        summary: 'Get detailed cache performance metrics',
        description: `
     Retourne les métriques détaillées de performance du cache Redis.
     
     **Données fournies :**
     - Métriques temps réel (hit rate, response time, memory)
     - Tendances historiques et patterns
     - Alertes de performance et recommandations
     - Opérations détaillées (reads, writes, deletes)
     - Analyse de stratégies d'invalidation
   `,
        parameters: [
          {
            name: 'period',
            in: 'query',
            description: 'Période pour les tendances',
            schema: {
              type: 'string',
              enum: ['1h', '6h', '24h', '7d'],
              default: '24h',
            },
          },
          {
            name: 'includeDetails',
            in: 'query',
            description: 'Inclure les détails techniques',
            schema: {
              type: 'boolean',
              default: false,
            },
          },
        ],
        responses: {
          200: {
            description: 'Métriques cache récupérées avec succès',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CacheMetrics',
                },
              },
            },
          },
        },
      },
    },

    '/cache/invalidate': {
      post: {
        tags: ['Cache Management'],
        summary: 'Invalidate cache patterns',
        description: `
     Invalide le cache selon des patterns spécifiques avec tracking complet.
     
     **Patterns supportés :**
     - \`hotel:{hotelId}:*\` - Toutes les données d'un hôtel
     - \`availability:*\` - Toutes les disponibilités
     - \`pricing:{hotelId}:*\` - Tarification d'un hôtel
     - \`user:{userId}:*\` - Données utilisateur
     - \`analytics:*\` - Toutes les analytics
     
     **Fonctionnalités :**
     - Invalidation en cascade intelligente
     - Tracking des performances d'invalidation
     - Notifications temps réel
     - Audit trail complet
   `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['patterns'],
                properties: {
                  patterns: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['hotel:64a1b2c3d4e5f6789012346:*', 'availability:*'],
                    description: 'Patterns Redis à invalider',
                  },
                  reason: {
                    type: 'string',
                    maxLength: 200,
                    example: "Mise à jour des tarifs de l'hôtel",
                    description: "Raison de l'invalidation",
                  },
                  cascade: {
                    type: 'object',
                    properties: {
                      analytics: { type: 'boolean', default: true },
                      availability: { type: 'boolean', default: true },
                      pricing: { type: 'boolean', default: true },
                    },
                    description: 'Invalidation en cascade',
                  },
                  notifyUsers: {
                    type: 'boolean',
                    default: false,
                    description: 'Notifier les utilisateurs concernés',
                  },
                },
              },
              examples: {
                hotelUpdate: {
                  summary: 'Mise à jour hôtel complète',
                  value: {
                    patterns: ['hotel:64a1b2c3d4e5f6789012346:*'],
                    reason: 'Mise à jour des informations hôtel',
                    cascade: {
                      analytics: true,
                      availability: true,
                      pricing: true,
                    },
                    notifyUsers: true,
                  },
                },
                availabilityRefresh: {
                  summary: 'Rafraîchissement disponibilités',
                  value: {
                    patterns: ['availability:*'],
                    reason: 'Synchronisation disponibilités temps réel',
                    cascade: {
                      analytics: false,
                      availability: true,
                      pricing: false,
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Invalidation réussie',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/CacheInvalidation',
                },
              },
            },
          },
          400: {
            description: 'Patterns invalides ou erreur',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Pattern invalide' },
                    code: { type: 'string', example: 'INVALID_CACHE_PATTERN' },
                    details: {
                      type: 'array',
                      items: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          403: {
            description: 'Permissions insuffisantes',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },

    // ============================================================================
    // QR ANALYTICS & ADMIN ENDPOINTS
    // ============================================================================

    '/qr/admin/stats': {
      get: {
        tags: ['QR Codes'],
        summary: 'Get comprehensive QR system statistics',
        description: `
     Retourne les statistiques complètes du système QR codes.
     
     **Données incluses :**
     - Statistiques de génération et usage
     - Performance par type de QR
     - Taux de succès et échecs
     - Top utilisateurs et patterns
     - Métriques de sécurité
     - Alertes système
   `,
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'period',
            in: 'query',
            description: "Période d'analyse",
            schema: {
              type: 'string',
              enum: ['1h', '24h', '7d', '30d'],
              default: '7d',
            },
          },
          {
            name: 'hotelId',
            in: 'query',
            description: 'Filtrer par hôtel spécifique',
            schema: {
              type: 'string',
              example: '64a1b2c3d4e5f6789012346',
            },
          },
          {
            name: 'includeDetails',
            in: 'query',
            description: 'Inclure les détails administrateur',
            schema: {
              type: 'boolean',
              default: false,
            },
          },
        ],
        responses: {
          200: {
            description: 'Statistiques QR récupérées avec succès',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/QRCodeStats',
                },
              },
            },
          },
          403: {
            description: 'Accès réservé aux administrateurs',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/Error',
                },
              },
            },
          },
        },
      },
    },

    '/qr/admin/revoke': {
      post: {
        tags: ['QR Codes'],
        summary: 'Revoke QR code token (Admin only)',
        description: `
     Révoque un token QR code avec audit trail complet.
     
     **Utilisations :**
     - Sécurité : QR compromis ou suspect
     - Support client : Problème technique
     - Maintenance : Mise à jour système
     - Audit : Contrôle qualité
     
     **Effets :**
     - Token immédiatement inutilisable
     - Notifications automatiques
     - Audit trail complet
     - Possibilité de remplacement
   `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['tokenId', 'reason'],
                properties: {
                  tokenId: {
                    type: 'string',
                    example: 'qr_64a1b2c3d4e5f6789012345',
                    description: 'ID unique du token à révoquer',
                  },
                  reason: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 200,
                    example: 'Token compromis - demande client',
                    description: 'Raison de la révocation',
                  },
                  notifyUser: {
                    type: 'boolean',
                    default: true,
                    example: true,
                    description: "Notifier l'utilisateur propriétaire",
                  },
                  generateReplacement: {
                    type: 'boolean',
                    default: false,
                    example: false,
                    description: 'Générer automatiquement un QR de remplacement',
                  },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'QR code révoqué avec succès',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'QR code révoqué avec succès' },
                    data: {
                      type: 'object',
                      properties: {
                        tokenId: { type: 'string' },
                        reason: { type: 'string' },
                        revokedBy: { type: 'string' },
                        revokedAt: { type: 'string', format: 'date-time' },
                        userNotified: { type: 'boolean' },
                        replacementGenerated: { type: 'boolean' },
                        replacementTokenId: { type: 'string', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Token non trouvé',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: false },
                    message: { type: 'string', example: 'Token non trouvé' },
                    code: { type: 'string', example: 'TOKEN_NOT_FOUND' },
                  },
                },
              },
            },
          },
        },
      },
    },

    // ============================================================================
    // HEALTH & MONITORING ENDPOINTS
    // ============================================================================

    '/health': {
      get: {
        tags: ['Health & Monitoring'],
        summary: 'Overall system health check',
        description: `
     Point de contrôle global de la santé du système.
     
     **Composants vérifiés :**
     - Base de données MongoDB
     - Cache Redis
     - Système QR codes
     - Services externes
     - Performance générale
     
     **Codes de statut :**
     - 200: Système en bon état
     - 503: Problèmes critiques détectés
   `,
        responses: {
          200: {
            description: 'Système en bon état',
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/SystemHealthOverview',
                },
              },
            },
          },
          503: {
            description: 'Problèmes système détectés',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/SystemHealthOverview' },
                    {
                      type: 'object',
                      properties: {
                        issues: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              component: { type: 'string' },
                              severity: { type: 'string' },
                              message: { type: 'string' },
                              since: { type: 'string', format: 'date-time' },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },

    '/health/live': {
      get: {
        tags: ['Health & Monitoring'],
        summary: 'Kubernetes liveness probe',
        description: 'Endpoint de vérification basique pour Kubernetes/Docker orchestration',
        responses: {
          200: {
            description: 'Service vivant',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'ALIVE' },
                    timestamp: { type: 'string', format: 'date-time' },
                    uptime: { type: 'number', example: 3664.5 },
                    pid: { type: 'integer', example: 1234 },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/health/ready': {
      get: {
        tags: ['Health & Monitoring'],
        summary: 'Kubernetes readiness probe',
        description: 'Endpoint de vérification de disponibilité pour load balancing',
        responses: {
          200: {
            description: 'Service prêt à recevoir du trafic',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'READY' },
                    score: { type: 'integer', example: 87 },
                    criticalAlerts: { type: 'integer', example: 0 },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          503: {
            description: 'Service non prêt',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', example: 'NOT_READY' },
                    reason: { type: 'string', example: 'Cache unavailable' },
                    timestamp: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },

    '/metrics': {
      get: {
        tags: ['Health & Monitoring'],
        summary: 'Prometheus metrics endpoint',
        description: 'Métriques au format Prometheus pour monitoring externe',
        responses: {
          200: {
            description: 'Métriques Prometheus',
            content: {
              'text/plain': {
                schema: {
                  type: 'string',
                  example: `# HELP hotel_system_health_score Overall system health score
# TYPE hotel_system_health_score gauge
hotel_system_health_score 87
# HELP hotel_cache_hit_rate Cache hit rate percentage
# TYPE hotel_cache_hit_rate gauge
hotel_cache_hit_rate 85.3
# HELP hotel_qr_success_rate QR check-in success rate percentage
# TYPE hotel_qr_success_rate gauge
hotel_qr_success_rate 94.2`,
                },
              },
            },
          },
        },
      },
    },
  },
};

// Options pour swagger-jsdoc avec nouveaux fichiers
const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/models/*.js',
    './src/routes/qr.js', // Routes QR codes
    './src/routes/health.js', // Routes health & monitoring
    './src/controllers/qrController.js', // Controller QR
    './src/services/qrCodeService.js', // Service QR
    './src/services/cacheService.js', // Service Cache
    './src/utils/monitoring.js', // Monitoring utils
  ],
};

// Génération de la spécification Swagger
const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ============================================================================
// EXEMPLES D'USAGE ET NOTES DE DOCUMENTATION
// ============================================================================

/*
EXEMPLES D'USAGE QR CODES:

1. GÉNÉRATION QR CHECK-IN:
   POST /api/qr/generate/checkin
   Headers: Authorization: Bearer <token>
   Body: {
     "bookingId": "64a1b2c3d4e5f6789012348",
     "style": "hotel",
     "expiresIn": 86400
   }
   
   Response: QR code avec token JWT sécurisé

2. VALIDATION QR:
   POST /api/qr/validate
   Body: {
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "context": {
       "hotelId": "64a1b2c3d4e5f6789012346"
     }
   }

3. CHECK-IN COMPLET:
   POST /api/qr/checkin/process
   Body: {
     "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
     "hotelId": "64a1b2c3d4e5f6789012346",
     "roomAssignments": [...]
   }

EXEMPLES D'USAGE CACHE:

1. SANTÉ CACHE:
   GET /api/health/cache
   Response: Métriques hit rate, mémoire, performance

2. INVALIDATION CACHE:
   POST /api/cache/invalidate
   Body: {
     "patterns": ["hotel:64a1b2c3d4e5f6789012346:*"],
     "reason": "Mise à jour hôtel",
     "cascade": {"analytics": true}
   }

3. MÉTRIQUES CACHE:
   GET /api/metrics/cache?period=24h&includeDetails=true

INTÉGRATION NOTES:

1. Authentification: Tous les endpoints QR/Cache nécessitent JWT token
2. Rate Limiting: Limites spécifiques par type d'endpoint
3. Monitoring: Métriques Prometheus disponibles
4. Alertes: Notifications temps réel via Socket.io
5. Audit: Trail complet pour sécurité et compliance
6. Performance: Cache optimisé avec TTL intelligents
7. Sécurité: QR avec JWT + validation contextuelle
8. Scalabilité: Redis cluster support + load balancing

DÉPLOIEMENT:
- Docker: Health checks intégrés
- Kubernetes: Probes liveness/readiness
- Monitoring: Grafana + Prometheus compatible
- Alerting: Email/SMS/Slack notifications
- Backup: Redis persistence + snapshot
*/

module.exports = {
  swaggerSpec,
  swaggerDefinition,
};
