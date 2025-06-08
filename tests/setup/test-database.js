const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Instance globale du serveur MongoDB en mémoire
let mongoServer;

/**
 * Connexion à la base de données de test
 * Utilise MongoDB Memory Server pour des tests isolés et rapides
 */
const connectTestDB = async () => {
  try {
    // Créer une nouvelle instance MongoDB Memory Server
    mongoServer = await MongoMemoryServer.create({
      binary: {
        version: '6.0.0', // Version MongoDB compatible
      },
      instance: {
        dbName: 'hotel-management-test',
      },
    });

    // Obtenir l'URI de connexion
    const mongoUri = mongoServer.getUri();

    // Configuration optimisée pour les tests
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      maxPoolSize: 10, // Limite des connexions simultanées
      serverSelectionTimeoutMS: 5000, // Timeout rapide pour les tests
      socketTimeoutMS: 45000,
      bufferMaxEntries: 0, // Désactiver le buffering pour les tests
      bufferCommands: false,
    };

    // Connexion à MongoDB
    await mongoose.connect(mongoUri, options);

    console.log(`✅ Test Database connected: ${mongoUri}`);
    return mongoUri;

  } catch (error) {
    console.error('❌ Error connecting to test database:', error);
    throw error;
  }
};

/**
 * Fermeture de la connexion et arrêt du serveur
 */
const disconnectTestDB = async () => {
  try {
    // Fermer la connexion Mongoose
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close();
    }

    // Arrêter le serveur MongoDB Memory Server
    if (mongoServer) {
      await mongoServer.stop();
    }

    console.log('✅ Test Database disconnected');

  } catch (error) {
    console.error('❌ Error disconnecting test database:', error);
    throw error;
  }
};

/**
 * Nettoyage de toutes les collections
 * Utile entre les tests pour éviter les interférences
 */
const clearTestDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      throw new Error('Database not connected');
    }

    // Obtenir toutes les collections
    const collections = mongoose.connection.collections;

    // Vider chaque collection
    const clearPromises = Object.values(collections).map(collection => 
      collection.deleteMany({})
    );

    await Promise.all(clearPromises);

    console.log('🧹 Test Database cleared');

  } catch (error) {
    console.error('❌ Error clearing test database:', error);
    throw error;
  }
};

/**
 * Suppression complète de toutes les collections
 * Plus radical que clearTestDB, supprime aussi les indexes
 */
const dropTestDB = async () => {
  try {
    if (mongoose.connection.readyState === 0) {
      throw new Error('Database not connected');
    }

    // Supprimer complètement la base de données
    await mongoose.connection.dropDatabase();

    console.log('🗑️ Test Database dropped');

  } catch (error) {
    console.error('❌ Error dropping test database:', error);
    throw error;
  }
};

/**
 * Création de données de test standard
 * Utilisé pour initialiser les tests avec des données cohérentes
 */
const seedTestData = async () => {
  try {
    const User = require('../models/User');
    const Hotel = require('../models/Hotel');
    const Room = require('../models/Room');

    // Utilisateurs de test
    const adminUser = new User({
      firstName: 'Admin',
      lastName: 'Test',
      email: 'admin@test.com',
      password: 'password123',
      phone: '0123456789',
      role: 'ADMIN',
      isEmailVerified: true,
      isActive: true
    });

    const receptionistUser = new User({
      firstName: 'Receptionist',
      lastName: 'Test',
      email: 'receptionist@test.com',
      password: 'password123',
      phone: '0123456790',
      role: 'RECEPTIONIST',
      isEmailVerified: true,
      isActive: true
    });

    const clientUser = new User({
      firstName: 'Client',
      lastName: 'Test',
      email: 'client@test.com',
      password: 'password123',
      phone: '0123456791',
      role: 'CLIENT',
      isEmailVerified: true,
      isActive: true
    });

    const companyUser = new User({
      firstName: 'Company',
      lastName: 'Manager',
      email: 'company@test.com',
      password: 'password123',
      phone: '0123456792',
      role: 'CLIENT',
      companyName: 'Test Company SARL',
      siret: '12345678901234',
      isEmailVerified: true,
      isActive: true
    });

    // Sauvegarder les utilisateurs
    await Promise.all([
      adminUser.save(),
      receptionistUser.save(),
      clientUser.save(),
      companyUser.save()
    ]);

    // Hôtel de test
    const testHotel = new Hotel({
      code: 'HTL001',
      name: 'Hotel Test Palace',
      address: {
        street: '123 Rue de Test',
        city: 'Paris',
        postalCode: '75001',
        country: 'France',
        coordinates: {
          latitude: 48.8566,
          longitude: 2.3522
        }
      },
      stars: 4,
      contact: {
        phone: '0140000000',
        email: 'contact@hoteltest.com',
        website: 'https://hoteltest.com'
      },
      manager: adminUser._id,
      isActive: true,
      isPublished: true,
      seasonalPricing: [
        {
          name: 'HAUTE_SAISON',
          startDate: new Date('2025-07-01'),
          endDate: new Date('2025-08-31'),
          multiplier: 1.5
        },
        {
          name: 'BASSE_SAISON',
          startDate: new Date('2025-11-01'),
          endDate: new Date('2025-03-31'),
          multiplier: 0.8
        }
      ]
    });

    await testHotel.save();

    // Chambres de test
    const rooms = [
      {
        number: '101',
        floor: 1,
        type: 'Simple',
        hotel: testHotel._id,
        basePrice: 80,
        status: 'AVAILABLE',
        isActive: true
      },
      {
        number: '102',
        floor: 1,
        type: 'Double',
        hotel: testHotel._id,
        basePrice: 120,
        status: 'AVAILABLE',
        isActive: true
      },
      {
        number: '201',
        floor: 2,
        type: 'Double Confort',
        hotel: testHotel._id,
        basePrice: 160,
        status: 'AVAILABLE',
        isActive: true
      },
      {
        number: '301',
        floor: 3,
        type: 'Suite',
        hotel: testHotel._id,
        basePrice: 300,
        status: 'AVAILABLE',
        isActive: true
      }
    ];

    const createdRooms = await Room.insertMany(rooms);

    console.log('🌱 Test data seeded successfully');

    return {
      users: {
        admin: adminUser,
        receptionist: receptionistUser,
        client: clientUser,
        company: companyUser
      },
      hotel: testHotel,
      rooms: createdRooms
    };

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    throw error;
  }
};

/**
 * Vérification de l'état de la connexion
 */
const getConnectionState = () => {
  const states = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  return {
    state: states[mongoose.connection.readyState],
    readyState: mongoose.connection.readyState,
    host: mongoose.connection.host,
    port: mongoose.connection.port,
    name: mongoose.connection.name
  };
};

/**
 * Attendre que la base de données soit prête
 */
const waitForConnection = async (timeout = 10000) => {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const checkConnection = () => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Database connection timeout'));
      } else {
        setTimeout(checkConnection, 100);
      }
    };

    checkConnection();
  });
};

/**
 * Configuration Jest pour les tests
 */
const setupJest = () => {
  // Timeout plus long pour les tests avec base de données
  jest.setTimeout(30000);

  // Variables globales pour les tests
  global.testDB = {
    connect: connectTestDB,
    disconnect: disconnectTestDB,
    clear: clearTestDB,
    drop: dropTestDB,
    seed: seedTestData,
    getState: getConnectionState,
    waitForConnection
  };
};

/**
 * Utilitaires pour les hooks Jest
 */
const testHooks = {
  // Hook à utiliser dans beforeAll
  beforeAll: async () => {
    await connectTestDB();
    await clearTestDB();
  },

  // Hook à utiliser dans afterAll
  afterAll: async () => {
    await disconnectTestDB();
  },

  // Hook à utiliser dans beforeEach
  beforeEach: async () => {
    await clearTestDB();
  },

  // Hook à utiliser dans afterEach
  afterEach: async () => {
    // Optionnel : nettoyer après chaque test
    // await clearTestDB();
  }
};

/**
 * Helper pour créer une suite de tests avec base de données
 */
const createTestSuite = (suiteName, testFn) => {
  describe(suiteName, () => {
    beforeAll(testHooks.beforeAll);
    afterAll(testHooks.afterAll);
    beforeEach(testHooks.beforeEach);

    testFn();
  });
};

/**
 * Statistiques de la base de données de test
 */
const getTestDBStats = async () => {
  try {
    const stats = await mongoose.connection.db.stats();
    
    return {
      collections: stats.collections,
      documents: stats.objects,
      indexes: stats.indexes,
      dataSize: `${(stats.dataSize / 1024).toFixed(2)} KB`,
      indexSize: `${(stats.indexSize / 1024).toFixed(2)} KB`,
      totalSize: `${(stats.storageSize / 1024).toFixed(2)} KB`
    };
  } catch (error) {
    console.error('❌ Error getting database stats:', error);
    return null;
  }
};

module.exports = {
  // Fonctions principales
  connectTestDB,
  disconnectTestDB,
  clearTestDB,
  dropTestDB,
  seedTestData,
  
  // Utilitaires
  getConnectionState,
  waitForConnection,
  getTestDBStats,
  
  // Configuration Jest
  setupJest,
  testHooks,
  createTestSuite,
  
  // Instance du serveur (pour debug)
  getMongoServer: () => mongoServer
};