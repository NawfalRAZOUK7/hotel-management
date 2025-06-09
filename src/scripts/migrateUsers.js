// Script de migration pour utilisateurs existants
const mongoose = require('mongoose');
const User = require('../models/User');
const Company = require('../models/Company');

const migrateUsers = async () => {
  try {
    console.log('🔄 Début migration utilisateurs...');
    
    // 1. Mettre userType par défaut pour utilisateurs existants
    const result1 = await User.updateMany(
      { userType: { $exists: false } },
      { $set: { userType: 'individual' } }
    );
    console.log(`✅ ${result1.modifiedCount} utilisateurs mis à jour avec userType: individual`);
    
    // 2. Ajouter permissions par défaut
    const result2 = await User.updateMany(
      { permissions: { $exists: false } },
      { 
        $set: { 
          permissions: {
            canBook: true,
            canApprove: false,
            canViewReports: false,
            canManageTeam: false,
            maxBookingAmount: 5000
          }
        }
      }
    );
    console.log(`✅ ${result2.modifiedCount} utilisateurs avec permissions par défaut`);
    
    // 3. Ajouter hiérarchie par défaut
    const result3 = await User.updateMany(
      { hierarchy: { $exists: false } },
      { 
        $set: { 
          hierarchy: {
            canApprove: false,
            approvalLimit: 0,
            level: 1
          }
        }
      }
    );
    console.log(`✅ ${result3.modifiedCount} utilisateurs avec hiérarchie par défaut`);
    
    console.log('🎉 Migration terminée avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur migration:', error);
    throw error;
  }
};

module.exports = { migrateUsers };

// Si exécuté directement
if (require.main === module) {
  mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/hotel-management')
    .then(() => {
      console.log('📊 Connexion MongoDB établie');
      return migrateUsers();
    })
    .then(() => {
      console.log('✅ Migration terminée');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erreur:', error);
      process.exit(1);
    });
}