/**
 * Hotel Management System - Swagger API Documentation Configuration
 * Author: Nawfal Razouk
 * Description: OpenAPI/Swagger configuration for API documentation
 */

const swaggerJsdoc = require('swagger-jsdoc');

// Basic API information
const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Hotel Management System API',
    version: '1.0.0',
    description: `
      A comprehensive hotel management system API that provides endpoints for managing hotels, rooms, bookings, and user authentication.
      
      ## Features
      - 🏨 Hotel and room management
      - 👤 User authentication with JWT
      - 📅 Booking system with availability checking
      - 💳 Payment integration with Stripe
      - 📊 Admin dashboard with analytics
      - 🔔 Real-time notifications
      - 📧 Email notifications
      - 🔐 Role-based access control
      
      ## Authentication
      Most endpoints require authentication. Include the JWT token in the Authorization header:
      \`Authorization: Bearer <your-jwt-token>\`
      
      ## Rate Limiting
      API requests are limited to 100 requests per 15-minute window per IP address.
      Authentication endpoints are more strictly limited to 5 requests per 15 minutes.
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
      // Error responses
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
        },
      },
      
      // Success responses
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

      // User schemas
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

      // Hotel schemas
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

      // Room schemas
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

      // Booking schemas
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
          consumptions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                item: {
                  type: 'string',
                  example: 'Mini-bar',
                },
                quantity: {
                  type: 'integer',
                  example: 2,
                },
                price: {
                  type: 'number',
                  example: 15.00,
                },
                addedBy: {
                  type: 'string',
                  example: '64a1b2c3d4e5f6789012349',
                },
              },
            },
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
          default: 10,
        },
      },
      OffsetParam: {
        name: 'offset',
        in: 'query',
        description: 'Number of items to skip',
        schema: {
          type: 'integer',
          minimum: 0,
          default: 0,
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
      name: 'Hotels',
      description: 'Hotel management endpoints',
    },
    {
      name: 'Rooms',
      description: 'Room management and availability endpoints',
    },
    {
      name: 'Bookings',
      description: 'Booking management endpoints',
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
};

// Options for swagger-jsdoc
const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/models/*.js',
  ],
};

// Generate swagger specification
const swaggerSpec = swaggerJsdoc(swaggerOptions);

module.exports = {
  swaggerSpec,
  swaggerDefinition,
};