/**
 * Hotel Management System - Enhanced Swagger Documentation with Loyalty Program
 * Author: Nawfal Razouk
 * Description: Complete OpenAPI/Swagger configuration including Loyalty Program endpoints
 */

const swaggerJsdoc = require('swagger-jsdoc');

// Basic API information
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Hotel Management System API with Loyalty Program',
    version: '2.0.0',
    description: `
      A comprehensive hotel management system API with advanced loyalty program features.
      
      ## Features
      - 🏨 Hotel and room management
      - 👤 User authentication with JWT
      - 📅 Booking system with availability checking
      - 🏆 **Complete Loyalty Program** with points, tiers, and benefits
      - 💳 Payment integration with Stripe
      - 📊 Admin dashboard with analytics
      - 🔔 Real-time notifications
      - 📧 Email notifications
      - 🔐 Role-based access control
      
      ## Loyalty Program Overview
      The loyalty program includes 5 tiers (Bronze → Silver → Gold → Platinum → Diamond) with:
      - **Points earning**: 1 point per €1 spent + tier multipliers
      - **Point redemption**: Discounts, upgrades, free nights, benefits
      - **Tier benefits**: Welcome bonuses, room upgrades, exclusive perks
      - **Real-time tracking**: Live notifications and dashboard updates
      - **Advanced analytics**: Member insights and campaign management
      
      ## Authentication
      Most endpoints require authentication. Include the JWT token in the Authorization header:
      \`Authorization: Bearer <your-jwt-token>\`
      
      ## Rate Limiting
      - General endpoints: 100 requests per 15 minutes
      - Auth endpoints: 5 requests per 15 minutes
      - Loyalty endpoints: 50 requests per 15 minutes
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
      url: process.env.NODE_ENV === 'production' 
        ? 'https://your-hotel-api.com/api' 
        : `http://localhost:${process.env.PORT || 5000}/api`,
      description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server',
    },
  ],
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
      // ERROR AND SUCCESS SCHEMAS
      // ============================================================================
      Error: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: false,
          },
          error: {
            type: 'string',
            example: 'Bad Request',
          },
          message: {
            type: 'string',
            example: 'Validation error occurred',
          },
          details: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                message: { type: 'string' }
              }
            }
          }
        },
      },
      
      Success: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Operation completed successfully',
          },
          data: {
            type: 'object',
          },
        },
      },

      // ============================================================================
      // LOYALTY PROGRAM SCHEMAS
      // ============================================================================
      
      LoyaltyUser: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012345'
          },
          name: {
            type: 'string',
            example: 'John Doe'
          },
          tier: {
            type: 'string',
            enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
            example: 'GOLD'
          },
          tierDisplay: {
            type: 'string',
            example: 'Or'
          },
          currentPoints: {
            type: 'integer',
            example: 2450
          },
          lifetimePoints: {
            type: 'integer',
            example: 8750
          },
          memberSince: {
            type: 'string',
            format: 'date-time',
            example: '2023-03-15T10:30:00Z'
          },
          tierProgress: {
            $ref: '#/components/schemas/TierProgress'
          }
        }
      },

      TierProgress: {
        type: 'object',
        properties: {
          pointsToNextTier: {
            type: 'integer',
            example: 2550
          },
          nextTier: {
            type: 'string',
            example: 'PLATINUM'
          },
          progressPercentage: {
            type: 'integer',
            minimum: 0,
            maximum: 100,
            example: 65
          }
        }
      },

      LoyaltyTransaction: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012348'
          },
          type: {
            type: 'string',
            enum: [
              'EARN_BOOKING', 'EARN_REVIEW', 'EARN_REFERRAL', 'EARN_BONUS', 
              'EARN_BIRTHDAY', 'REDEEM_DISCOUNT', 'REDEEM_UPGRADE', 
              'REDEEM_FREE_NIGHT', 'TIER_BONUS', 'EXPIRE'
            ],
            example: 'EARN_BOOKING'
          },
          typeDisplay: {
            type: 'string',
            example: 'Points de réservation'
          },
          pointsAmount: {
            type: 'integer',
            example: 150
          },
          description: {
            type: 'string',
            example: 'Points réservation HTL001-240315 - Grand Hotel Palace'
          },
          previousBalance: {
            type: 'integer',
            example: 2300
          },
          newBalance: {
            type: 'integer',
            example: 2450
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
            example: 'COMPLETED'
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2025-06-15T14:30:00Z'
          },
          expiresAt: {
            type: 'string',
            format: 'date-time',
            example: '2027-06-15T14:30:00Z'
          },
          booking: {
            $ref: '#/components/schemas/BookingReference'
          },
          hotel: {
            $ref: '#/components/schemas/HotelReference'
          },
          earnedFrom: {
            type: 'object',
            properties: {
              bookingAmount: { type: 'number', example: 450.00 },
              pointsRate: { type: 'number', example: 1.0 },
              bonusMultiplier: { type: 'number', example: 1.5 },
              tierAtEarning: { type: 'string', example: 'GOLD' }
            }
          },
          redeemedFor: {
            type: 'object',
            properties: {
              discountAmount: { type: 'number', example: 25.00 },
              upgradeType: { type: 'string', example: 'ROOM_CATEGORY' },
              benefitDescription: { type: 'string', example: 'Upgrade catégorie supérieure' }
            }
          }
        }
      },

      LoyaltyStatus: {
        type: 'object',
        properties: {
          user: {
            $ref: '#/components/schemas/LoyaltyUser'
          },
          benefits: {
            type: 'object',
            properties: {
              current: {
                type: 'object',
                properties: {
                  pointsMultiplier: { type: 'number', example: 1.5 },
                  benefits: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades gratuits/an']
                  },
                  upgradesPerYear: { type: 'integer', example: 2 },
                  freeBreakfast: { type: 'boolean', example: true }
                }
              },
              active: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/ActiveBenefit'
                }
              },
              next: {
                type: 'object',
                properties: {
                  tier: { type: 'string', example: 'PLATINUM' },
                  tierDisplay: { type: 'string', example: 'Platine' },
                  threshold: { type: 'integer', example: 15000 },
                  benefits: {
                    type: 'array',
                    items: { type: 'string' },
                    example: ['Double points', 'Accès lounge VIP', '1 nuit gratuite/an']
                  }
                }
              }
            }
          },
          transactions: {
            type: 'object',
            properties: {
              recent: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/LoyaltyTransaction'
                }
              },
              summary: {
                $ref: '#/components/schemas/TransactionSummary'
              }
            }
          },
          redemption: {
            type: 'object',
            properties: {
              options: {
                type: 'array',
                items: {
                  $ref: '#/components/schemas/RedemptionOption'
                }
              },
              pointsValue: {
                type: 'number',
                example: 24.50,
                description: 'Valeur estimée des points en euros'
              }
            }
          },
          alerts: {
            type: 'object',
            properties: {
              expiringPoints: {
                type: 'object',
                properties: {
                  totalPoints: { type: 'integer', example: 500 },
                  nextExpiryDate: { type: 'string', format: 'date-time' }
                }
              },
              nearTierUpgrade: { type: 'boolean', example: true },
              specialOffers: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string', example: 'Bonus été x2' },
                    description: { type: 'string', example: 'Double points sur toutes réservations' },
                    validUntil: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          }
        }
      },

      ActiveBenefit: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'DISCOUNT', 'UPGRADE', 'FREE_NIGHT', 'EARLY_CHECKIN',
              'LATE_CHECKOUT', 'FREE_BREAKFAST', 'LOUNGE_ACCESS'
            ],
            example: 'UPGRADE'
          },
          value: {
            type: 'number',
            example: 2
          },
          description: {
            type: 'string',
            example: '2 upgrades gratuits par an'
          },
          validUntil: {
            type: 'string',
            format: 'date-time',
            example: '2025-12-31T23:59:59Z'
          },
          usageCount: {
            type: 'integer',
            example: 0
          },
          maxUsage: {
            type: 'integer',
            example: 2
          },
          isActive: {
            type: 'boolean',
            example: true
          }
        }
      },

      RedemptionOption: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['DISCOUNT', 'UPGRADE', 'FREE_NIGHT', 'BREAKFAST', 'LATE_CHECKOUT', 'LOUNGE_ACCESS'],
            example: 'DISCOUNT'
          },
          pointsRequired: {
            type: 'integer',
            example: 500
          },
          maxPoints: {
            type: 'integer',
            example: 2000
          },
          value: {
            type: 'string',
            example: 'Jusqu\'à 20€ de réduction'
          },
          description: {
            type: 'string',
            example: '100 points = 1€'
          },
          available: {
            type: 'boolean',
            example: true
          },
          exclusive: {
            type: 'boolean',
            example: false,
            description: 'Disponible uniquement pour certains niveaux'
          }
        }
      },

      TransactionSummary: {
        type: 'object',
        properties: {
          totalTransactions: {
            type: 'integer',
            example: 15
          },
          totalEarned: {
            type: 'integer',
            example: 3200
          },
          totalRedeemed: {
            type: 'integer',
            example: 800
          },
          currentBalance: {
            type: 'integer',
            example: 2400
          },
          lifetimePoints: {
            type: 'integer',
            example: 8750
          },
          averageEarning: {
            type: 'number',
            example: 213.33
          },
          redemptionRate: {
            type: 'number',
            example: 25.0,
            description: 'Pourcentage de points utilisés'
          }
        }
      },

      RedeemDiscountRequest: {
        type: 'object',
        required: ['pointsToRedeem', 'bookingId', 'discountAmount'],
        properties: {
          pointsToRedeem: {
            type: 'integer',
            minimum: 100,
            maximum: 5000,
            example: 500,
            description: 'Points à utiliser pour la réduction'
          },
          bookingId: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012348',
            description: 'ID de la réservation'
          },
          discountAmount: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            example: 5.00,
            description: 'Montant de la réduction en euros'
          },
          applyImmediately: {
            type: 'boolean',
            default: false,
            example: true,
            description: 'Appliquer immédiatement à la réservation'
          }
        }
      },

      RedeemUpgradeRequest: {
        type: 'object',
        required: ['upgradeType', 'bookingId'],
        properties: {
          upgradeType: {
            type: 'string',
            enum: ['ROOM_CATEGORY', 'VIEW', 'FLOOR_HIGH', 'SUITE'],
            example: 'ROOM_CATEGORY',
            description: 'Type d\'upgrade demandé'
          },
          bookingId: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012348',
            description: 'ID de la réservation'
          },
          requestUpgrade: {
            type: 'boolean',
            default: false,
            example: true,
            description: 'Demander traitement immédiat de l\'upgrade'
          }
        }
      },

      RedeemFreeNightRequest: {
        type: 'object',
        required: ['hotelId', 'checkInDate', 'checkOutDate', 'roomType'],
        properties: {
          hotelId: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012346',
            description: 'ID de l\'hôtel'
          },
          checkInDate: {
            type: 'string',
            format: 'date',
            example: '2025-08-15',
            description: 'Date d\'arrivée'
          },
          checkOutDate: {
            type: 'string',
            format: 'date',
            example: '2025-08-16',
            description: 'Date de départ'
          },
          roomType: {
            type: 'string',
            enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'],
            example: 'DOUBLE',
            description: 'Type de chambre demandé'
          }
        }
      },

      LoyaltyDashboard: {
        type: 'object',
        properties: {
          overview: {
            type: 'object',
            properties: {
              currentPoints: { type: 'integer', example: 2450 },
              tier: { type: 'string', example: 'GOLD' },
              tierDisplay: { type: 'string', example: 'Or' },
              progressToNext: { $ref: '#/components/schemas/TierProgress' },
              memberSince: { type: 'string', format: 'date-time' },
              estimatedValue: { type: 'number', example: 24.50 }
            }
          },
          activity: {
            type: 'object',
            properties: {
              recent: {
                type: 'array',
                items: { $ref: '#/components/schemas/LoyaltyTransaction' }
              },
              analytics: {
                type: 'object',
                properties: {
                  period: { type: 'object' },
                  daily: { type: 'array', items: { type: 'object' } },
                  totals: { type: 'object' }
                }
              }
            }
          },
          opportunities: {
            type: 'object',
            properties: {
              recommendations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', example: 'redemption' },
                    title: { type: 'string', example: 'Utilisez vos points' },
                    message: { type: 'string', example: 'Vous pouvez obtenir jusqu\'à 24€ de réduction' },
                    action: { type: 'string', example: 'Utiliser mes points' },
                    priority: { type: 'string', example: 'medium' }
                  }
                }
              },
              upcoming: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string', example: 'expiry' },
                    title: { type: 'string', example: 'Expiration de points' },
                    date: { type: 'string', format: 'date-time' },
                    daysUntil: { type: 'integer', example: 45 }
                  }
                }
              }
            }
          }
        }
      },

      AdminPointsAdjustment: {
        type: 'object',
        required: ['userId', 'pointsAmount', 'reason', 'type'],
        properties: {
          userId: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012345',
            description: 'ID de l\'utilisateur'
          },
          pointsAmount: {
            type: 'integer',
            minimum: -10000,
            maximum: 10000,
            example: 500,
            description: 'Montant de points (positif = ajout, négatif = déduction)'
          },
          reason: {
            type: 'string',
            minLength: 10,
            maxLength: 500,
            example: 'Compensation pour incident lors de la réservation HTL001-240315',
            description: 'Raison de l\'ajustement'
          },
          type: {
            type: 'string',
            enum: ['ADJUSTMENT_ADMIN', 'ADJUSTMENT_ERROR', 'CAMPAIGN_BONUS'],
            example: 'ADJUSTMENT_ADMIN',
            description: 'Type d\'ajustement'
          },
          notifyUser: {
            type: 'boolean',
            default: true,
            example: true,
            description: 'Notifier l\'utilisateur par email/SMS'
          }
        }
      },

      LoyaltyAnalytics: {
        type: 'object',
        properties: {
          period: {
            type: 'object',
            properties: {
              startDate: { type: 'string', format: 'date-time' },
              endDate: { type: 'string', format: 'date-time' },
              days: { type: 'integer', example: 30 }
            }
          },
          transactions: {
            type: 'object',
            properties: {
              daily: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string', example: '2025-06-15' },
                    transactions: { type: 'array' },
                    dailyTotal: { type: 'integer', example: 1250 },
                    dailyTransactions: { type: 'integer', example: 8 }
                  }
                }
              },
              summary: {
                type: 'object',
                properties: {
                  totalTransactions: { type: 'integer', example: 240 },
                  totalPoints: { type: 'integer', example: 37500 },
                  avgTransactionsPerDay: { type: 'integer', example: 8 },
                  peakDay: {
                    type: 'object',
                    properties: {
                      date: { type: 'string', example: '2025-06-15' },
                      transactions: { type: 'integer', example: 15 },
                      points: { type: 'integer', example: 2100 }
                    }
                  }
                }
              }
            }
          },
          users: {
            type: 'object',
            properties: {
              totalMembers: { type: 'integer', example: 1250 },
              activeMembers: { type: 'integer', example: 890 },
              totalPoints: { type: 'integer', example: 125000 },
              totalLifetimePoints: { type: 'integer', example: 750000 }
            }
          },
          tiers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                tier: { type: 'string', example: 'GOLD' },
                count: { type: 'integer', example: 89 },
                avgPoints: { type: 'number', example: 3250.50 },
                avgLifetimePoints: { type: 'number', example: 12750.25 }
              }
            }
          }
        }
      },

      CampaignRequest: {
        type: 'object',
        required: ['name', 'type', 'value', 'startDate', 'endDate'],
        properties: {
          name: {
            type: 'string',
            minLength: 3,
            maxLength: 100,
            example: 'Bonus Été 2025',
            description: 'Nom de la campagne'
          },
          description: {
            type: 'string',
            maxLength: 500,
            example: 'Double points sur toutes les réservations pendant l\'été',
            description: 'Description détaillée'
          },
          type: {
            type: 'string',
            enum: ['MULTIPLIER', 'BONUS_FIXED', 'TIER_UPGRADE'],
            example: 'MULTIPLIER',
            description: 'Type de campagne'
          },
          value: {
            type: 'number',
            minimum: 0.1,
            maximum: 10,
            example: 2.0,
            description: 'Valeur du multiplicateur ou montant fixe'
          },
          startDate: {
            type: 'string',
            format: 'date-time',
            example: '2025-06-21T00:00:00Z',
            description: 'Date de début'
          },
          endDate: {
            type: 'string',
            format: 'date-time',
            example: '2025-09-21T23:59:59Z',
            description: 'Date de fin'
          },
          targetTiers: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['ALL', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']
            },
            default: ['ALL'],
            example: ['GOLD', 'PLATINUM', 'DIAMOND'],
            description: 'Niveaux éligibles'
          },
          targetHotels: {
            type: 'array',
            items: { type: 'string' },
            example: ['64a1b2c3d4e5f6789012346'],
            description: 'Hôtels participants (vide = tous)'
          },
          minimumBookingAmount: {
            type: 'number',
            minimum: 0,
            default: 0,
            example: 100,
            description: 'Montant minimum de réservation'
          },
          maxUsagePerUser: {
            type: 'integer',
            minimum: 1,
            example: 3,
            description: 'Utilisation maximum par utilisateur'
          },
          autoApply: {
            type: 'boolean',
            default: true,
            example: true,
            description: 'Application automatique'
          }
        }
      },

      // ============================================================================
      // EXISTING SCHEMAS (Updated with loyalty integration)
      // ============================================================================
      
      User: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012345',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'john.doe@example.com',
          },
          firstName: {
            type: 'string',
            example: 'John',
          },
          lastName: {
            type: 'string',
            example: 'Doe',
          },
          phone: {
            type: 'string',
            example: '+33123456789',
          },
          role: {
            type: 'string',
            enum: ['CLIENT', 'RECEPTIONIST', 'ADMIN'],
            example: 'CLIENT',
          },
          loyalty: {
            type: 'object',
            properties: {
              currentPoints: { type: 'integer', example: 2450 },
              lifetimePoints: { type: 'integer', example: 8750 },
              tier: { 
                type: 'string', 
                enum: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
                example: 'GOLD' 
              },
              enrolledAt: { type: 'string', format: 'date-time' },
              tierProgress: { $ref: '#/components/schemas/TierProgress' }
            }
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2025-01-15T10:30:00Z',
          },
        },
      },

      BookingReference: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '64a1b2c3d4e5f6789012348' },
          bookingNumber: { type: 'string', example: 'HTL001-240315' },
          totalPrice: { type: 'number', example: 450.00 },
          checkInDate: { type: 'string', format: 'date', example: '2025-06-15' },
          hotelName: { type: 'string', example: 'Grand Hotel Palace' }
        }
      },

      HotelReference: {
        type: 'object',
        properties: {
          id: { type: 'string', example: '64a1b2c3d4e5f6789012346' },
          name: { type: 'string', example: 'Grand Hotel Palace' },
          code: { type: 'string', example: 'HTL001' },
          city: { type: 'string', example: 'Paris' }
        }
      },

      // Original schemas maintained for compatibility
      Hotel: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012346',
          },
          code: {
            type: 'string',
            example: 'HTL001',
          },
          name: {
            type: 'string',
            example: 'Grand Hotel Palace',
          },
          address: {
            type: 'string',
            example: '123 Main Street',
          },
          city: {
            type: 'string',
            example: 'Paris',
          },
          stars: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            example: 4,
          },
          description: {
            type: 'string',
            example: 'Luxury hotel in the heart of Paris',
          },
          amenities: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['WiFi', 'Pool', 'Spa', 'Restaurant'],
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
        },
      },

      Room: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012347',
          },
          hotel: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012346',
          },
          roomNumber: {
            type: 'string',
            example: '101',
          },
          type: {
            type: 'string',
            enum: ['Simple', 'Double', 'Double Confort', 'Suite'],
            example: 'Double',
          },
          floor: {
            type: 'integer',
            example: 1,
          },
          basePrice: {
            type: 'number',
            example: 150.00,
          },
          capacity: {
            type: 'integer',
            example: 2,
          },
          amenities: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['TV', 'Mini-bar', 'Air conditioning'],
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
        },
      },

      Booking: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012348',
          },
          user: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012345',
          },
          hotel: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012346',
          },
          rooms: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['64a1b2c3d4e5f6789012347'],
          },
          checkIn: {
            type: 'string',
            format: 'date',
            example: '2025-06-15',
          },
          checkOut: {
            type: 'string',
            format: 'date',
            example: '2025-06-18',
          },
          totalPrice: {
            type: 'number',
            example: 450.00,
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
            example: 'PENDING',
          },
          loyaltyPointsEarned: {
            type: 'integer',
            example: 450,
            description: 'Points de fidélité gagnés pour cette réservation'
          },
          loyaltyDiscountApplied: {
            type: 'number',
            example: 25.00,
            description: 'Réduction fidélité appliquée'
          },
          guestDetails: {
            type: 'object',
            properties: {
              adults: {
                type: 'integer',
                example: 2,
              },
              children: {
                type: 'integer',
                example: 1,
              },
            },
          },
        },
      },

      UserRegistration: {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'john.doe@example.com',
          },
          password: {
            type: 'string',
            minLength: 6,
            example: 'securePassword123',
          },
          firstName: {
            type: 'string',
            example: 'John',
          },
          lastName: {
            type: 'string',
            example: 'Doe',
          },
          phone: {
            type: 'string',
            example: '+33123456789',
          },
          enrollInLoyalty: {
            type: 'boolean',
            default: true,
            example: true,
            description: 'Adhérer automatiquement au programme de fidélité'
          }
        },
      },

      UserLogin: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'john.doe@example.com',
          },
          password: {
            type: 'string',
            example: 'securePassword123',
          },
        },
      },

      BookingRequest: {
        type: 'object',
        required: ['hotelId', 'roomIds', 'checkIn', 'checkOut', 'guestDetails'],
        properties: {
          hotelId: {
            type: 'string',
            example: '64a1b2c3d4e5f6789012346',
          },
          roomIds: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['64a1b2c3d4e5f6789012347'],
          },
          checkIn: {
            type: 'string',
            format: 'date',
            example: '2025-06-15',
          },
          checkOut: {
            type: 'string',
            format: 'date',
            example: '2025-06-18',
          },
          guestDetails: {
            type: 'object',
            required: ['adults'],
            properties: {
              adults: {
                type: 'integer',
                minimum: 1,
                example: 2,
              },
              children: {
                type: 'integer',
                minimum: 0,
                example: 1,
              },
            },
          },
          useLoyaltyPoints: {
            type: 'boolean',
            default: false,
            example: true,
            description: 'Utiliser les points de fidélité pour une réduction'
          },
          loyaltyPointsToUse: {
            type: 'integer',
            minimum: 100,
            example: 500,
            description: 'Nombre de points à utiliser'
          }
        },
      },
    },
    responses: {
      UnauthorizedError: {
        description: 'Authentication required',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Unauthorized',
              message: 'No token provided',
            },
          },
        },
      },
      ForbiddenError: {
        description: 'Insufficient permissions',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Forbidden',
              message: 'Access denied',
            },
          },
        },
      },
      NotFoundError: {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Not Found',
              message: 'Resource not found',
            },
          },
        },
      },
      ValidationError: {
        description: 'Validation error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Validation Error',
              message: 'Required fields are missing',
              details: [
                {
                  field: 'pointsToRedeem',
                  message: 'Points à utiliser requis (100-5000)'
                }
              ]
            },
          },
        },
      },
      ServerError: {
        description: 'Internal server error',
        content: {
          'application/json': {
            schema: {
              $ref: '#/components/schemas/Error',
            },
            example: {
              success: false,
              error: 'Server Error',
              message: 'Internal server error',
            },
          },
        },
      },
    },
    parameters: {
      LimitParam: {
        name: 'limit',
        in: 'query',
        description: 'Number of items to return',
        schema: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          default: 20,
        },
      },
      PageParam: {
        name: 'page',
        in: 'query',
        description: 'Page number',
        schema: {
          type: 'integer',
          minimum: 1,
          default: 1,
        },
      },
      SortParam: {
        name: 'sort',
        in: 'query',
        description: 'Sort field and direction (e.g., createdAt:desc)',
        schema: {
          type: 'string',
          default: 'createdAt:desc',
        },
      },
      PeriodParam: {
        name: 'period',
        in: 'query',
        description: 'Analytics period',
        schema: {
          type: 'string',
          enum: ['7d', '30d', '90d', '1y'],
          default: '30d',
        },
      },
      TierParam: {
        name: 'tier',
        in: 'query',
        description: 'Filter by loyalty tier',
        schema: {
          type: 'string',
          enum: ['ALL', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'],
          default: 'ALL',
        },
      },
      TransactionTypeParam: {
        name: 'type',
        in: 'query',
        description: 'Filter by transaction type',
        schema: {
          type: 'string',
          enum: ['ALL', 'EARNINGS', 'REDEMPTIONS', 'EARN_BOOKING', 'REDEEM_DISCOUNT', 'TIER_BONUS'],
          default: 'ALL',
        },
      }
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication and authorization endpoints',
    },
    {
      name: 'Loyalty Program',
      description: 'Complete loyalty program management with points, tiers, and benefits',
    },
    {
      name: 'Loyalty - User',
      description: 'User-facing loyalty program endpoints (status, history, redemption)',
    },
    {
      name: 'Loyalty - Admin',
      description: 'Administrative loyalty program endpoints (analytics, adjustments, campaigns)',
    },
    {
      name: 'Hotels',
      description: 'Hotel management endpoints',
    },
    {
      name: 'Rooms',
      description: 'Room management and availability endpoints',
    },
    {
      name: 'Bookings',
      description: 'Booking management endpoints with loyalty integration',
    },
    {
      name: 'Payments',
      description: 'Payment processing endpoints',
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

  // ============================================================================
  // LOYALTY PROGRAM PATHS
  // ============================================================================
  
  paths: {
    // ============================================================================
    // USER LOYALTY ENDPOINTS
    // ============================================================================
    
    '/loyalty/status': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get user loyalty status',
        description: `
          Retrieve complete loyalty program status for the authenticated user including:
          - Current points balance and tier information
          - Available benefits and redemption options
          - Recent transaction history
          - Tier progression and next level requirements
          - Active alerts (expiring points, special offers)
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'skipCache',
            in: 'query',
            description: 'Skip cache and fetch fresh data',
            schema: {
              type: 'boolean',
              default: false
            }
          }
        ],
        responses: {
          200: {
            description: 'Loyalty status retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/LoyaltyStatus' },
                    meta: {
                      type: 'object',
                      properties: {
                        version: { type: 'string', example: '2.0' },
                        features: {
                          type: 'array',
                          items: { type: 'string' },
                          example: ['points', 'tiers', 'benefits', 'redemption', 'analytics']
                        }
                      }
                    }
                  }
                },
                examples: {
                  goldMember: {
                    summary: 'Gold tier member with active benefits',
                    value: {
                      success: true,
                      data: {
                        user: {
                          name: 'John Doe',
                          tier: 'GOLD',
                          tierDisplay: 'Or',
                          currentPoints: 2450,
                          lifetimePoints: 8750,
                          memberSince: '2023-03-15T10:30:00Z',
                          tierProgress: {
                            pointsToNextTier: 6550,
                            nextTier: 'PLATINUM',
                            progressPercentage: 65
                          }
                        },
                        benefits: {
                          current: {
                            pointsMultiplier: 1.5,
                            benefits: ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades gratuits/an'],
                            upgradesPerYear: 2,
                            freeBreakfast: true
                          }
                        },
                        redemption: {
                          pointsValue: 24.50
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          404: {
            description: 'User not enrolled in loyalty program',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Not Found',
                  message: 'Utilisateur non inscrit au programme fidélité'
                }
              }
            }
          },
          500: { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/loyalty/dashboard': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get personalized loyalty dashboard',
        description: `
          Retrieve a comprehensive loyalty dashboard with personalized insights including:
          - Points overview and tier progression
          - Recent activity and analytics
          - Personalized recommendations
          - Upcoming events (expiration dates, anniversaries)
          - Quick action suggestions
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PeriodParam' }
        ],
        responses: {
          200: {
            description: 'Dashboard data retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/LoyaltyDashboard' },
                    generatedAt: { type: 'string', format: 'date-time' }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          500: { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/loyalty/summary': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get loyalty summary for widgets/headers',
        description: 'Quick loyalty summary for display in application headers or widgets',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Summary retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        enrolled: { type: 'boolean', example: true },
                        user: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', example: 'John' },
                            tier: { type: 'string', example: 'GOLD' },
                            tierDisplay: { type: 'string', example: 'Or' },
                            tierIcon: { type: 'string', example: '🥇' }
                          }
                        },
                        points: {
                          type: 'object',
                          properties: {
                            current: { type: 'integer', example: 2450 },
                            lifetime: { type: 'integer', example: 8750 },
                            estimatedValue: { type: 'number', example: 24.50 },
                            expiring: { type: 'integer', example: 500 },
                            nextExpiry: { type: 'string', format: 'date-time' }
                          }
                        },
                        quickActions: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              type: { type: 'string', example: 'redeem' },
                              title: { type: 'string', example: 'Utiliser points' },
                              description: { type: 'string', example: 'Obtenir une réduction' },
                              icon: { type: 'string', example: '💰' },
                              link: { type: 'string', example: '/loyalty/redeem' }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    },

    '/loyalty/history': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get loyalty transaction history',
        description: `
          Retrieve detailed transaction history with filtering and pagination options.
          Supports grouping by month or transaction type for better visualization.
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          { $ref: '#/components/parameters/TransactionTypeParam' },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by transaction status',
            schema: {
              type: 'string',
              enum: ['ALL', 'COMPLETED', 'PENDING', 'CANCELLED', 'EXPIRED'],
              default: 'COMPLETED'
            }
          },
          {
            name: 'startDate',
            in: 'query',
            description: 'Filter from date (ISO 8601)',
            schema: {
              type: 'string',
              format: 'date-time',
              example: '2025-01-01T00:00:00Z'
            }
          },
          {
            name: 'endDate',
            in: 'query',
            description: 'Filter to date (ISO 8601)',
            schema: {
              type: 'string',
              format: 'date-time',
              example: '2025-06-30T23:59:59Z'
            }
          },
          {
            name: 'groupBy',
            in: 'query',
            description: 'Group transactions by',
            schema: {
              type: 'string',
              enum: ['none', 'month', 'type'],
              default: 'none'
            }
          }
        ],
        responses: {
          200: {
            description: 'Transaction history retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        transactions: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/LoyaltyTransaction' }
                        },
                        grouped: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              month: { type: 'string', example: '2025-06' },
                              transactions: { type: 'array' },
                              totalEarned: { type: 'integer', example: 850 },
                              totalRedeemed: { type: 'integer', example: 200 },
                              netChange: { type: 'integer', example: 650 }
                            }
                          }
                        },
                        summary: { $ref: '#/components/schemas/TransactionSummary' }
                      }
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        currentPage: { type: 'integer', example: 1 },
                        totalPages: { type: 'integer', example: 5 },
                        totalItems: { type: 'integer', example: 87 },
                        itemsPerPage: { type: 'integer', example: 20 },
                        hasNext: { type: 'boolean', example: true },
                        hasPrev: { type: 'boolean', example: false }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          400: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    '/loyalty/transaction/{transactionId}': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get transaction details',
        description: 'Retrieve detailed information about a specific loyalty transaction',
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'transactionId',
            in: 'path',
            required: true,
            description: 'Transaction ID',
            schema: {
              type: 'string',
              example: '64a1b2c3d4e5f6789012348'
            }
          }
        ],
        responses: {
          200: {
            description: 'Transaction details retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        transaction: { $ref: '#/components/schemas/LoyaltyTransaction' },
                        related: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/LoyaltyTransaction' },
                          description: 'Related transactions (cancellations, adjustments)'
                        },
                        metadata: {
                          type: 'object',
                          properties: {
                            canCancel: { type: 'boolean', example: false },
                            canRefund: { type: 'boolean', example: false },
                            hasReceipt: { type: 'boolean', example: true }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          404: { $ref: '#/components/responses/NotFoundError' }
        }
      }
    },

    '/loyalty/redemption/options': {
      get: {
        tags: ['Loyalty - User'],
        summary: 'Get available redemption options',
        description: `
          Retrieve all available ways to use loyalty points based on current balance,
          tier level, and optional booking context.
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: 'bookingId',
            in: 'query',
            description: 'Booking ID for context-specific options',
            schema: {
              type: 'string',
              example: '64a1b2c3d4e5f6789012348'
            }
          },
          {
            name: 'category',
            in: 'query',
            description: 'Filter options by category',
            schema: {
              type: 'string',
              enum: ['ALL', 'DISCOUNT', 'UPGRADE', 'BENEFITS', 'EXPERIENCES'],
              default: 'ALL'
            }
          }
        ],
        responses: {
          200: {
            description: 'Redemption options retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        currentPoints: { type: 'integer', example: 2450 },
                        tier: { type: 'string', example: 'GOLD' },
                        options: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/RedemptionOption' }
                        },
                        categories: {
                          type: 'array',
                          items: { type: 'string' },
                          example: ['DISCOUNT', 'UPGRADE', 'BENEFITS', 'EXPERIENCES']
                        },
                        savings: {
                          type: 'object',
                          properties: {
                            maxDiscount: { type: 'integer', example: 24 },
                            upgradeCount: { type: 'integer', example: 2 },
                            freeNights: { type: 'integer', example: 0 },
                            totalValue: { type: 'number', example: 24.50 }
                          }
                        },
                        recommendations: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              type: { type: 'string', example: 'upgrade' },
                              title: { type: 'string', example: 'Upgrade recommandé' },
                              description: { type: 'string', example: 'Surclassez votre prochaine réservation' },
                              pointsRequired: { type: 'integer', example: 1000 },
                              priority: { type: 'string', example: 'medium' }
                            }
                          }
                        }
                      }
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        pointsValue: { type: 'number', example: 24.50 },
                        tier: { type: 'string', example: 'GOLD' },
                        hasBookingContext: { type: 'boolean', example: false }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          404: {
            description: 'User not enrolled in loyalty program',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' }
              }
            }
          }
        }
      }
    },

    '/loyalty/redeem/discount': {
      post: {
        tags: ['Loyalty - User'],
        summary: 'Redeem points for discount',
        description: `
          Use loyalty points to get a discount on a booking.
          The discount can be applied immediately or saved for later use.
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RedeemDiscountRequest' },
              examples: {
                immediateDiscount: {
                  summary: 'Apply discount immediately to booking',
                  value: {
                    pointsToRedeem: 500,
                    bookingId: '64a1b2c3d4e5f6789012348',
                    discountAmount: 5.00,
                    applyImmediately: true
                  }
                },
                futureDiscount: {
                  summary: 'Generate discount voucher for later use',
                  value: {
                    pointsToRedeem: 1000,
                    bookingId: '64a1b2c3d4e5f6789012348',
                    discountAmount: 10.00,
                    applyImmediately: false
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Points redeemed successfully for discount',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        redemption: {
                          type: 'object',
                          properties: {
                            transactionId: { type: 'string', example: '64a1b2c3d4e5f6789012349' },
                            pointsRedeemed: { type: 'integer', example: 500 },
                            remainingPoints: { type: 'integer', example: 1950 }
                          }
                        },
                        booking: {
                          type: 'object',
                          nullable: true,
                          description: 'Updated booking if discount applied immediately'
                        },
                        savings: { type: 'number', example: 5.00 }
                      }
                    },
                    message: { type: 'string', example: '5€ de réduction obtenue avec 500 points' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid request or insufficient points',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  insufficientPoints: {
                    summary: 'Not enough points',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Points insuffisants',
                      details: {
                        currentPoints: 300,
                        pointsRequired: 500,
                        shortfall: 200
                      }
                    }
                  },
                  invalidBooking: {
                    summary: 'Invalid booking',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Réservation non trouvée ou non autorisée'
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    '/loyalty/redeem/upgrade': {
      post: {
        tags: ['Loyalty - User'],
        summary: 'Redeem points for room upgrade',
        description: `
          Use loyalty points to upgrade room category, view, floor level, or to suite.
          The upgrade can be requested for immediate processing.
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RedeemUpgradeRequest' },
              examples: {
                roomCategoryUpgrade: {
                  summary: 'Upgrade to higher room category',
                  value: {
                    upgradeType: 'ROOM_CATEGORY',
                    bookingId: '64a1b2c3d4e5f6789012348',
                    requestUpgrade: true
                  }
                },
                suiteUpgrade: {
                  summary: 'Upgrade to suite',
                  value: {
                    upgradeType: 'SUITE',
                    bookingId: '64a1b2c3d4e5f6789012348',
                    requestUpgrade: false
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Points redeemed successfully for upgrade',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        redemption: {
                          type: 'object',
                          properties: {
                            transactionId: { type: 'string', example: '64a1b2c3d4e5f6789012350' },
                            pointsRedeemed: { type: 'integer', example: 1000 },
                            remainingPoints: { type: 'integer', example: 1450 }
                          }
                        },
                        upgradeRequested: { type: 'boolean', example: true }
                      }
                    },
                    message: { type: 'string', example: 'Upgrade ROOM_CATEGORY obtenu !' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Upgrade not available or insufficient points',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Bad Request',
                  message: 'Upgrade non disponible pour cette réservation'
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    '/loyalty/redeem/free-night': {
      post: {
        tags: ['Loyalty - User'],
        summary: 'Redeem points for free night',
        description: `
          Use loyalty points to get a free night at a participating hotel.
          Available for Gold tier members and above.
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/RedeemFreeNightRequest' },
              examples: {
                weekendStay: {
                  summary: 'Free weekend night',
                  value: {
                    hotelId: '64a1b2c3d4e5f6789012346',
                    checkInDate: '2025-08-15',
                    checkOutDate: '2025-08-16',
                    roomType: 'DOUBLE'
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Free night redeemed successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        hotelName: { type: 'string', example: 'Grand Hotel Palace' },
                        voucherCode: { type: 'string', example: 'LOYAL1J2K3L4M5N6' },
                        pointsRedeemed: { type: 'integer', example: 5000 },
                        remainingPoints: { type: 'integer', example: 3450 },
                        transactionId: { type: 'string', example: '64a1b2c3d4e5f6789012351' },
                        instructions: { type: 'string', example: 'Utilisez ce code lors de votre réservation' },
                        voucher: {
                          type: 'object',
                          properties: {
                            code: { type: 'string', example: 'LOYAL1J2K3L4M5N6' },
                            type: { type: 'string', example: 'FREE_NIGHT' },
                            hotelName: { type: 'string', example: 'Grand Hotel Palace' },
                            roomType: { type: 'string', example: 'DOUBLE' },
                            expiresAt: { type: 'string', format: 'date-time' },
                            terms: {
                              type: 'array',
                              items: { type: 'string' },
                              example: [
                                'Sous réserve de disponibilité',
                                'Non remboursable et non transférable',
                                'Valable 1 an à partir de la date d\'émission'
                              ]
                            }
                          }
                        },
                        hotel: {
                          type: 'object',
                          properties: {
                            name: { type: 'string', example: 'Grand Hotel Palace' },
                            address: { type: 'string', example: '123 Main Street' },
                            city: { type: 'string', example: 'Paris' },
                            phone: { type: 'string', example: '+33123456789' }
                          }
                        }
                      }
                    },
                    message: { type: 'string', example: 'Nuit gratuite réservée avec succès !' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Insufficient points or hotel unavailable',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  insufficientPoints: {
                    summary: 'Not enough points for free night',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Points insuffisants. Requis: 5000, Disponible: 2450'
                    }
                  },
                  hotelNotFound: {
                    summary: 'Hotel not available',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Hôtel non trouvé'
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          403: {
            description: 'Tier level insufficient',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Forbidden',
                  message: 'Nuit gratuite disponible à partir du niveau Or'
                }
              }
            }
          },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    // ============================================================================
    // ADMIN LOYALTY ENDPOINTS
    // ============================================================================

    '/loyalty/admin/analytics': {
      get: {
        tags: ['Loyalty - Admin'],
        summary: 'Get global loyalty analytics (Admin only)',
        description: `
          Comprehensive analytics dashboard for loyalty program administrators including:
          - Transaction trends and patterns
          - Member engagement metrics
          - Tier distribution analysis
          - Top performing members
          - System health indicators
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PeriodParam' },
          {
            name: 'hotelId',
            in: 'query',
            description: 'Filter analytics by specific hotel',
            schema: {
              type: 'string',
              example: '64a1b2c3d4e5f6789012346'
            }
          }
        ],
        responses: {
          200: {
            description: 'Analytics data retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        analytics: { $ref: '#/components/schemas/LoyaltyAnalytics' },
                        insights: {
                          type: 'object',
                          properties: {
                            topUsers: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  id: { type: 'string' },
                                  firstName: { type: 'string', example: 'John' },
                                  lastName: { type: 'string', example: 'Doe' },
                                  email: { type: 'string', example: 'john.doe@example.com' },
                                  tier: { type: 'string', example: 'DIAMOND' },
                                  lifetimePoints: { type: 'integer', example: 75000 },
                                  currentPoints: { type: 'integer', example: 12450 }
                                }
                              }
                            },
                            recentActivity: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  type: { type: 'string', example: 'EARN_BOOKING' },
                                  pointsAmount: { type: 'integer', example: 450 },
                                  user: {
                                    type: 'object',
                                    properties: {
                                      firstName: { type: 'string', example: 'Jane' },
                                      lastName: { type: 'string', example: 'Smith' }
                                    }
                                  },
                                  hotel: {
                                    type: 'object',
                                    properties: {
                                      name: { type: 'string', example: 'Hotel Riviera' }
                                    }
                                  },
                                  createdAt: { type: 'string', format: 'date-time' }
                                }
                              }
                            },
                            systemHealth: {
                              type: 'object',
                              properties: {
                                totalMembers: { type: 'integer', example: 1250 },
                                activeToday: { type: 'integer', example: 89 },
                                totalTransactions: { type: 'integer', example: 15670 },
                                errorRate: { type: 'number', example: 0.2 },
                                status: { type: 'string', example: 'healthy' },
                                uptime: { type: 'number', example: 864000 },
                                lastUpdated: { type: 'string', format: 'date-time' }
                              }
                            }
                          }
                        },
                        recommendations: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              type: { type: 'string', example: 'engagement' },
                              priority: { type: 'string', example: 'high' },
                              title: { type: 'string', example: 'Améliorer l\'engagement' },
                              description: { type: 'string', example: 'Moins de 30% des membres sont actifs' },
                              actions: {
                                type: 'array',
                                items: { type: 'string' },
                                example: ['Campagne de réactivation', 'Bonus spéciaux', 'Communication ciblée']
                              }
                            }
                          }
                        }
                      }
                    },
                    meta: {
                      type: 'object',
                      properties: {
                        period: { type: 'string', example: '30d' },
                        hotelFilter: { type: 'string', example: 'ALL' },
                        generatedAt: { type: 'string', format: 'date-time' }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          403: { $ref: '#/components/responses/ForbiddenError' },
          500: { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/loyalty/admin/adjust-points': {
      post: {
        tags: ['Loyalty - Admin'],
        summary: 'Manually adjust user points (Admin only)',
        description: `
          Manually add or remove points from a user's account with full audit trail.
          Used for customer service compensations, error corrections, or special bonuses.
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/AdminPointsAdjustment' },
              examples: {
                compensation: {
                  summary: 'Customer service compensation',
                  value: {
                    userId: '64a1b2c3d4e5f6789012345',
                    pointsAmount: 1000,
                    reason: 'Compensation pour incident lors de la réservation HTL001-240315 - Room service défaillant',
                    type: 'ADJUSTMENT_ADMIN',
                    notifyUser: true
                  }
                },
                errorCorrection: {
                  summary: 'Correction of system error',
                  value: {
                    userId: '64a1b2c3d4e5f6789012345',
                    pointsAmount: -500,
                    reason: 'Correction erreur système - Points dupliqués lors de la réservation',
                    type: 'ADJUSTMENT_ERROR',
                    notifyUser: false
                  }
                },
                campaignBonus: {
                  summary: 'Special campaign bonus',
                  value: {
                    userId: '64a1b2c3d4e5f6789012345',
                    pointsAmount: 2000,
                    reason: 'Bonus membre VIP - Campagne fidélité été 2025',
                    type: 'CAMPAIGN_BONUS',
                    notifyUser: true
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Points adjusted successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        transactionId: { type: 'string', example: '64a1b2c3d4e5f6789012352' },
                        previousBalance: { type: 'integer', example: 2450 },
                        adjustment: { type: 'integer', example: 1000 },
                        newBalance: { type: 'integer', example: 3450 },
                        userNotified: { type: 'boolean', example: true }
                      }
                    },
                    message: { type: 'string', example: 'Ajustement de 1000 points effectué avec succès' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid adjustment request',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Bad Request',
                  message: 'Utilisateur non trouvé'
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          403: { $ref: '#/components/responses/ForbiddenError' },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    '/loyalty/admin/users': {
      get: {
        tags: ['Loyalty - Admin'],
        summary: 'Get loyalty members list (Admin only)',
        description: `
          Retrieve paginated list of loyalty program members with filtering options.
          Includes member statistics and last activity information.
        `,
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          {
            name: 'limit',
            in: 'query',
            description: 'Number of users per page',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 100,
              default: 50
            }
          },
          { $ref: '#/components/parameters/TierParam' },
          {
            name: 'sortBy',
            in: 'query',
            description: 'Sort field',
            schema: {
              type: 'string',
              enum: ['lifetimePoints', 'currentPoints', 'memberSince', 'lastActivity'],
              default: 'lifetimePoints'
            }
          },
          {
            name: 'sortOrder',
            in: 'query',
            description: 'Sort direction',
            schema: {
              type: 'string',
              enum: ['asc', 'desc'],
              default: 'desc'
            }
          },
          {
            name: 'search',
            in: 'query',
            description: 'Search in names and email',
            schema: {
              type: 'string',
              example: 'john.doe'
            }
          },
          {
            name: 'minPoints',
            in: 'query',
            description: 'Minimum current points',
            schema: {
              type: 'integer',
              minimum: 0,
              example: 1000
            }
          },
          {
            name: 'maxPoints',
            in: 'query',
            description: 'Maximum current points',
            schema: {
              type: 'integer',
              minimum: 0,
              example: 10000
            }
          },
          {
            name: 'status',
            in: 'query',
            description: 'User status filter',
            schema: {
              type: 'string',
              enum: ['all', 'active', 'inactive'],
              default: 'active'
            }
          }
        ],
        responses: {
          200: {
            description: 'Users list retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        users: {
                          type: 'array',
                          items: {
                            type: 'object',
                            properties: {
                              id: { type: 'string', example: '64a1b2c3d4e5f6789012345' },
                              firstName: { type: 'string', example: 'John' },
                              lastName: { type: 'string', example: 'Doe' },
                              email: { type: 'string', example: 'john.doe@example.com' },
                              loyalty: {
                                type: 'object',
                                properties: {
                                  tier: { type: 'string', example: 'GOLD' },
                                  tierDisplay: { type: 'string', example: 'Or' },
                                  currentPoints: { type: 'integer', example: 2450 },
                                  lifetimePoints: { type: 'integer', example: 8750 },
                                  enrolledAt: { type: 'string', format: 'date-time' }
                                }
                              },
                              isActive: { type: 'boolean', example: true },
                              lastLogin: { type: 'string', format: 'date-time' },
                              lastLoyaltyActivity: { type: 'string', format: 'date-time' },
                              lastTransactionType: { type: 'string', example: 'EARN_BOOKING' },
                              pointsValue: { type: 'number', example: 24.50 }
                            }
                          }
                        },
                        summary: {
                          type: 'object',
                          properties: {
                            totalUsers: { type: 'integer', example: 1250 },
                            averagePoints: { type: 'number', example: 1847.5 },
                            tierDistribution: {
                              type: 'object',
                              properties: {
                                BRONZE: { type: 'integer', example: 650 },
                                SILVER: { type: 'integer', example: 320 },
                                GOLD: { type: 'integer', example: 180 },
                                PLATINUM: { type: 'integer', example: 75 },
                                DIAMOND: { type: 'integer', example: 25 }
                              }
                            }
                          }
                        }
                      }
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        currentPage: { type: 'integer', example: 1 },
                        totalPages: { type: 'integer', example: 25 },
                        totalItems: { type: 'integer', example: 1250 },
                        itemsPerPage: { type: 'integer', example: 50 }
                      }
                    },
                    filters: {
                      type: 'object',
                      properties: {
                        tier: { type: 'string', example: 'ALL' },
                        sortBy: { type: 'string', example: 'lifetimePoints' },
                        sortOrder: { type: 'string', example: 'desc' },
                        search: { type: 'string', example: '' },
                        status: { type: 'string', example: 'active' }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          403: { $ref: '#/components/responses/ForbiddenError' },
          500: { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/loyalty/admin/campaign': {
      post: {
        tags: ['Loyalty - Admin'],
        summary: 'Create loyalty campaign (Admin only)',
        description: `
          Create and launch loyalty campaigns with custom rules, target audiences,
          and automatic or manual activation.
        `,
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/CampaignRequest' },
              examples: {
                summerBonus: {
                  summary: 'Summer 2x points campaign',
                  value: {
                    name: 'Bonus Été 2025',
                    description: 'Double points sur toutes les réservations pendant l\'été',
                    type: 'MULTIPLIER',
                    value: 2.0,
                    startDate: '2025-06-21T00:00:00Z',
                    endDate: '2025-09-21T23:59:59Z',
                    targetTiers: ['ALL'],
                    targetHotels: [],
                    minimumBookingAmount: 100,
                    maxUsagePerUser: null,
                    autoApply: true
                  }
                },
                vipBonus: {
                  summary: 'VIP members fixed bonus',
                  value: {
                    name: 'Bonus VIP Automne',
                    description: '1000 points bonus pour les membres Platine et Diamant',
                    type: 'BONUS_FIXED',
                    value: 1000,
                    startDate: '2025-09-01T00:00:00Z',
                    endDate: '2025-11-30T23:59:59Z',
                    targetTiers: ['PLATINUM', 'DIAMOND'],
                    targetHotels: [],
                    minimumBookingAmount: 0,
                    maxUsagePerUser: 1,
                    autoApply: false
                  }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Campaign created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        campaign: {
                          type: 'object',
                          properties: {
                            id: { type: 'string', example: 'BON1J2K3L4M5N6' },
                            name: { type: 'string', example: 'Bonus Été 2025' },
                            description: { type: 'string', example: 'Double points sur toutes les réservations pendant l\'été' },
                            code: { type: 'string', example: 'BON1J2K3L4M5N6' },
                            type: { type: 'string', example: 'MULTIPLIER' },
                            value: { type: 'number', example: 2.0 },
                            startDate: { type: 'string', format: 'date-time' },
                            endDate: { type: 'string', format: 'date-time' },
                            targetTiers: {
                              type: 'array',
                              items: { type: 'string' },
                              example: ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND']
                            },
                            isActive: { type: 'boolean', example: true },
                            usageStats: {
                              type: 'object',
                              properties: {
                                totalUsers: { type: 'integer', example: 0 },
                                totalPointsIssued: { type: 'integer', example: 0 },
                                totalBookings: { type: 'integer', example: 0 }
                              }
                            }
                          }
                        }
                      }
                    },
                    message: { type: 'string', example: 'Campagne "Bonus Été 2025" créée avec succès' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid campaign data',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Bad Request',
                  message: 'Date de fin doit être après la date de début'
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          403: { $ref: '#/components/responses/ForbiddenError' },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      }
    },

    // ============================================================================
    // EXISTING PATHS UPDATED WITH LOYALTY INTEGRATION
    // ============================================================================

    '/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register new user with optional loyalty enrollment',
        description: 'Create a new user account with automatic loyalty program enrollment option',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserRegistration' },
              examples: {
                withLoyalty: {
                  summary: 'Registration with loyalty enrollment',
                  value: {
                    email: 'john.doe@example.com',
                    password: 'securePassword123',
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '+33123456789',
                    enrollInLoyalty: true
                  }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'User registered successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' },
                        token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
                        loyalty: {
                          type: 'object',
                          properties: {
                            enrolled: { type: 'boolean', example: true },
                            welcomeBonus: { type: 'integer', example: 100 },
                            tier: { type: 'string', example: 'BRONZE' }
                          }
                        }
                      }
                    },
                    message: { type: 'string', example: 'Compte créé avec succès. Bienvenue dans le programme de fidélité !' }
                  }
                }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          409: {
            description: 'Email already exists',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                example: {
                  success: false,
                  error: 'Conflict',
                  message: 'Email already registered'
                }
              }
            }
          }
        }
      }
    },

    '/bookings': {
      post: {
        tags: ['Bookings'],
        summary: 'Create new booking with loyalty points options',
        description: 'Create a new booking with optional loyalty points usage for discounts',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/BookingRequest' },
              examples: {
                withLoyaltyDiscount: {
                  summary: 'Booking with loyalty points discount',
                  value: {
                    hotelId: '64a1b2c3d4e5f6789012346',
                    roomIds: ['64a1b2c3d4e5f6789012347'],
                    checkIn: '2025-06-15',
                    checkOut: '2025-06-18',
                    guestDetails: {
                      adults: 2,
                      children: 1
                    },
                    useLoyaltyPoints: true,
                    loyaltyPointsToUse: 500
                  }
                },
                standardBooking: {
                  summary: 'Standard booking without loyalty',
                  value: {
                    hotelId: '64a1b2c3d4e5f6789012346',
                    roomIds: ['64a1b2c3d4e5f6789012347'],
                    checkIn: '2025-06-15',
                    checkOut: '2025-06-18',
                    guestDetails: {
                      adults: 2,
                      children: 0
                    },
                    useLoyaltyPoints: false
                  }
                }
              }
            }
          }
        },
        responses: {
          201: {
            description: 'Booking created successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        booking: { $ref: '#/components/schemas/Booking' },
                        loyalty: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            pointsEarned: { type: 'integer', example: 450 },
                            pointsUsed: { type: 'integer', example: 500 },
                            discountApplied: { type: 'number', example: 5.00 },
                            newBalance: { type: 'integer', example: 1950 },
                            tierProgress: { $ref: '#/components/schemas/TierProgress' }
                          }
                        },
                        payment: {
                          type: 'object',
                          properties: {
                            originalAmount: { type: 'number', example: 450.00 },
                            discountAmount: { type: 'number', example: 5.00 },
                            finalAmount: { type: 'number', example: 445.00 }
                          }
                        }
                      }
                    },
                    message: { type: 'string', example: 'Réservation créée avec succès. 450 points gagnés !' }
                  }
                }
              }
            }
          },
          400: {
            description: 'Invalid booking request or insufficient loyalty points',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Error' },
                examples: {
                  insufficientPoints: {
                    summary: 'Not enough loyalty points',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Points insuffisants pour la réduction demandée',
                      details: {
                        currentPoints: 300,
                        pointsRequired: 500
                      }
                    }
                  },
                  unavailableRoom: {
                    summary: 'Room not available',
                    value: {
                      success: false,
                      error: 'Bad Request',
                      message: 'Chambre non disponible pour les dates sélectionnées'
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          422: { $ref: '#/components/responses/ValidationError' }
        }
      },
      get: {
        tags: ['Bookings'],
        summary: 'Get user bookings with loyalty information',
        description: 'Retrieve user\'s bookings including loyalty points earned and used',
        security: [{ BearerAuth: [] }],
        parameters: [
          { $ref: '#/components/parameters/PageParam' },
          { $ref: '#/components/parameters/LimitParam' },
          {
            name: 'status',
            in: 'query',
            description: 'Filter by booking status',
            schema: {
              type: 'string',
              enum: ['ALL', 'PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'],
              default: 'ALL'
            }
          },
          {
            name: 'includeLoyalty',
            in: 'query',
            description: 'Include loyalty information in response',
            schema: {
              type: 'boolean',
              default: true
            }
          }
        ],
        responses: {
          200: {
            description: 'Bookings retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        bookings: {
                          type: 'array',
                          items: { $ref: '#/components/schemas/Booking' }
                        },
                        loyaltySummary: {
                          type: 'object',
                          properties: {
                            totalPointsEarned: { type: 'integer', example: 2450 },
                            totalPointsUsed: { type: 'integer', example: 800 },
                            totalSavings: { type: 'number', example: 8.00 },
                            averagePointsPerBooking: { type: 'number', example: 306.25 }
                          }
                        }
                      }
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        currentPage: { type: 'integer', example: 1 },
                        totalPages: { type: 'integer', example: 3 },
                        totalItems: { type: 'integer', example: 8 }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    },

    // ============================================================================
    // EXISTING HOTEL ENDPOINTS (Enhanced with loyalty context)
    // ============================================================================

    '/hotels': {
      get: {
        tags: ['Hotels'],
        summary: 'Get hotels list with loyalty member benefits',
        description: 'Retrieve hotels list with additional loyalty member pricing and benefits information',
        parameters: [
          { $ref: '#/components/parameters/LimitParam' },
          {
            name: 'city',
            in: 'query',
            description: 'Filter by city',
            schema: {
              type: 'string',
              example: 'Paris'
            }
          },
          {
            name: 'stars',
            in: 'query',
            description: 'Filter by star rating',
            schema: {
              type: 'integer',
              minimum: 1,
              maximum: 5,
              example: 4
            }
          },
          {
            name: 'showLoyaltyBenefits',
            in: 'query',
            description: 'Include loyalty member benefits and pricing',
            schema: {
              type: 'boolean',
              default: false
            }
          }
        ],
        responses: {
          200: {
            description: 'Hotels list retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        hotels: {
                          type: 'array',
                          items: {
                            allOf: [
                              { $ref: '#/components/schemas/Hotel' },
                              {
                                type: 'object',
                                properties: {
                                  loyaltyBenefits: {
                                    type: 'object',
                                    nullable: true,
                                    properties: {
                                      memberDiscount: { type: 'number', example: 10.0 },
                                      pointsMultiplier: { type: 'number', example: 1.5 },
                                      exclusiveAmenities: {
                                        type: 'array',
                                        items: { type: 'string' },
                                        example: ['Petit-déjeuner gratuit', 'Wi-Fi premium', 'Check-out tardif']
                                      },
                                      upgradeAvailable: { type: 'boolean', example: true }
                                    }
                                  }
                                }
                              }
                            ]
                          }
                        },
                        totalHotels: { type: 'integer', example: 156 }
                      }
                    }
                  }
                }
              }
            }
          },
          500: { $ref: '#/components/responses/ServerError' }
        }
      }
    },

    '/hotels/{hotelId}': {
      get: {
        tags: ['Hotels'],
        summary: 'Get hotel details with loyalty benefits',
        description: 'Retrieve detailed hotel information including loyalty member benefits and exclusive offers',
        parameters: [
          {
            name: 'hotelId',
            in: 'path',
            required: true,
            description: 'Hotel ID',
            schema: {
              type: 'string',
              example: '64a1b2c3d4e5f6789012346'
            }
          },
          {
            name: 'includeLoyaltyBenefits',
            in: 'query',
            description: 'Include detailed loyalty benefits for authenticated users',
            schema: {
              type: 'boolean',
              default: true
            }
          }
        ],
        responses: {
          200: {
            description: 'Hotel details retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        hotel: { $ref: '#/components/schemas/Hotel' },
                        loyaltyBenefits: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            userTier: { type: 'string', example: 'GOLD' },
                            memberDiscount: { type: 'number', example: 15.0 },
                            pointsMultiplier: { type: 'number', example: 1.5 },
                            availableBenefits: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  type: { type: 'string', example: 'FREE_BREAKFAST' },
                                  description: { type: 'string', example: 'Petit-déjeuner continental gratuit' },
                                  available: { type: 'boolean', example: true }
                                }
                              }
                            },
                            exclusiveOffers: {
                              type: 'array',
                              items: {
                                type: 'object',
                                properties: {
                                  title: { type: 'string', example: 'Séjour Or - 20% de réduction' },
                                  description: { type: 'string', example: 'Réduction exclusive pour les membres Or' },
                                  validUntil: { type: 'string', format: 'date-time' },
                                  minNights: { type: 'integer', example: 2 }
                                }
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' },
          404: { $ref: '#/components/responses/NotFoundError' }
        }
      }
    },

    '/users/profile': {
      get: {
        tags: ['Users'],
        summary: 'Get user profile with loyalty information',
        description: 'Retrieve complete user profile including loyalty program status and preferences',
        security: [{ BearerAuth: [] }],
        responses: {
          200: {
            description: 'Profile retrieved successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' },
                        loyaltyQuickStatus: {
                          type: 'object',
                          nullable: true,
                          properties: {
                            enrolled: { type: 'boolean', example: true },
                            tier: { type: 'string', example: 'GOLD' },
                            currentPoints: { type: 'integer', example: 2450 },
                            pointsValue: { type: 'number', example: 24.50 },
                            nextTierProgress: { type: 'integer', example: 65 }
                          }
                        },
                        recentActivity: {
                          type: 'object',
                          properties: {
                            lastBooking: { type: 'string', format: 'date-time' },
                            lastLoyaltyActivity: { type: 'string', format: 'date-time' },
                            totalBookings: { type: 'integer', example: 8 },
                            memberSince: { type: 'string', format: 'date-time' }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      },
      put: {
        tags: ['Users'],
        summary: 'Update user profile and loyalty preferences',
        description: 'Update user profile information including loyalty program communication preferences',
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  firstName: { type: 'string', example: 'John' },
                  lastName: { type: 'string', example: 'Doe' },
                  phone: { type: 'string', example: '+33123456789' },
                  loyaltyPreferences: {
                    type: 'object',
                    properties: {
                      communicationPreferences: {
                        type: 'object',
                        properties: {
                          email: { type: 'boolean', example: true },
                          sms: { type: 'boolean', example: true },
                          push: { type: 'boolean', example: true },
                          newsletter: { type: 'boolean', example: true },
                          promotions: { type: 'boolean', example: true }
                        }
                      },
                      roomType: {
                        type: 'string',
                        enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE'],
                        example: 'DOUBLE'
                      },
                      floorPreference: {
                        type: 'string',
                        enum: ['LOW', 'MEDIUM', 'HIGH'],
                        example: 'HIGH'
                      },
                      amenities: {
                        type: 'array',
                        items: { type: 'string' },
                        example: ['WiFi', 'Parking', 'Piscine', 'Spa']
                      }
                    }
                  }
                }
              }
            }
          }
        },
        responses: {
          200: {
            description: 'Profile updated successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'object',
                      properties: {
                        user: { $ref: '#/components/schemas/User' }
                      }
                    },
                    message: { type: 'string', example: 'Profil mis à jour avec succès' }
                  }
                }
              }
            }
          },
          400: { $ref: '#/components/responses/ValidationError' },
          401: { $ref: '#/components/responses/UnauthorizedError' }
        }
      }
    }
  }
};

// Options for swagger-jsdoc
const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/models/*.js',
    './src/routes/loyaltyRoutes.js', // Specific loyalty routes file
  ],
};

// Generate swagger specification
const swaggerSpec = swaggerJsdoc(swaggerOptions);

// ============================================================================
// ADDITIONAL DOCUMENTATION EXAMPLES AND NOTES
// ============================================================================

/*
USAGE EXAMPLES FOR LOYALTY ENDPOINTS:

1. GET USER LOYALTY STATUS:
   GET /api/loyalty/status
   Headers: Authorization: Bearer <token>
   
   Response: Complete loyalty status with points, tier, benefits, and alerts

2. REDEEM POINTS FOR DISCOUNT:
   POST /api/loyalty/redeem/discount
   Body: {
     "pointsToRedeem": 500,
     "bookingId": "64a1b2c3d4e5f6789012348",
     "discountAmount": 5.00,
     "applyImmediately": true
   }

3. CREATE BOOKING WITH LOYALTY DISCOUNT:
   POST /api/bookings
   Body: {
     "hotelId": "64a1b2c3d4e5f6789012346",
     "roomIds": ["64a1b2c3d4e5f6789012347"],
     "checkIn": "2025-06-15",
     "checkOut": "2025-06-18",
     "guestDetails": { "adults": 2 },
     "useLoyaltyPoints": true,
     "loyaltyPointsToUse": 500
   }

4. ADMIN: ADJUST USER POINTS:
   POST /api/loyalty/admin/adjust-points
   Body: {
     "userId": "64a1b2c3d4e5f6789012345",
     "pointsAmount": 1000,
     "reason": "Compensation client",
     "type": "ADJUSTMENT_ADMIN"
   }

5. GET LOYALTY ANALYTICS (ADMIN):
   GET /api/loyalty/admin/analytics?period=30d&hotelId=64a1b2c3d4e5f6789012346

INTEGRATION NOTES:

1. Authentication: All loyalty endpoints require valid JWT token
2. Role-based access: Admin endpoints check for ADMIN role
3. Real-time notifications: Points transactions trigger socket notifications
4. Email integration: Tier upgrades and bonus points send emails
5. Cache optimization: Status endpoints use 5-minute cache
6. Error handling: Comprehensive error responses with details
7. Validation: Request validation with detailed error messages
8. Audit trail: All point adjustments logged with admin info
9. Rate limiting: Loyalty endpoints have specific rate limits
10. Pagination: History and admin endpoints support pagination

WEBHOOK INTEGRATION:
- Points earned: webhook fired on successful booking
- Tier upgrade: webhook fired on tier change
- Points expiry: webhook fired 30 days before expiration
- Campaign activation: webhook fired when user eligible for campaign

API VERSIONING:
- Current version: 2.0.0 (includes loyalty features)
- Backward compatibility: v1 endpoints still supported
- Deprecation notices: v1 loyalty endpoints deprecated in favor of v2

SECURITY CONSIDERATIONS:
- JWT token validation on all endpoints
- Rate limiting per user and endpoint
- Input sanitization and validation
- Audit logging for admin actions
- Encrypted sensitive data in database
- HTTPS required for production

MONITORING AND ANALYTICS:
- Response time monitoring
- Error rate tracking
- Loyalty engagement metrics
- Performance optimization
- Cache hit rates
- Database query optimization
*/

module.exports = {
  swaggerSpec,
  swaggerDefinition,
};