// Script principal de setup database
const mongoose = require('mongoose');
const { migrateUsers } = require('./migrateUsers');
const { createIndexes } = require('./createIndexes');

const setupDatabase = async () => {
  try {
    console.log('🚀 Début setup database entreprise...');
    
    // 1. Migration des données
    console.log('\n📋 ÉTAPE 1: Migration des utilisateurs');
    await migrateUsers();
    
    // 2. Création des index
    console.log('\n📋 ÉTAPE 2: Création des index de performance');
    await createIndexes();
    
    console.log('\n🎉 Setup database terminé avec succès !');
    console.log('✅ Votre base est prête pour les fonctionnalités entreprise');
    
  } catch (error) {
    console.error('❌ Erreur setup database:', error);
    throw error;
  }
};

module.exports = { setupDatabase };

// Si exécuté directement
if (require.main === module) {
  mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/hotel-management')
    .then(() => {
      console.log('📊 Connexion MongoDB établie');
      return setupDatabase();
    })
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erreur:', error);
      process.exit(1);
    });
}