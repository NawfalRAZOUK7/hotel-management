// Script création d'index pour optimisation performance
const mongoose = require('mongoose');

const createIndexes = async () => {
  try {
    console.log('🔄 Création des index de performance...');
    
    const db = mongoose.connection.db;
    
    // Index Companies
    await db.collection('companies').createIndex({ "siret": 1 }, { unique: true });
    await db.collection('companies').createIndex({ "vatNumber": 1 }, { unique: true });
    await db.collection('companies').createIndex({ "status": 1 });
    await db.collection('companies').createIndex({ "industry": 1 });
    console.log('✅ Index companies créés');
    
    // Index Users étendus
    await db.collection('users').createIndex({ "company": 1, "userType": 1 });
    await db.collection('users').createIndex({ "company": 1, "department": 1 });
    await db.collection('users').createIndex({ "hierarchy.manager": 1 });
    await db.collection('users').createIndex({ "permissions.canApprove": 1 });
    await db.collection('users').createIndex({ "employeeId": 1, "company": 1 }, { unique: true, sparse: true });
    console.log('✅ Index users étendus créés');
    
    // Index ApprovalRequests
    await db.collection('approvalrequests').createIndex({ "company": 1, "finalStatus": 1 });
    await db.collection('approvalrequests').createIndex({ "approvalChain.approver": 1, "approvalChain.status": 1 });
    await db.collection('approvalrequests').createIndex({ "timeline.requiredBy": 1 });
    await db.collection('approvalrequests').createIndex({ "escalation.isEscalated": 1 });
    console.log('✅ Index approvalrequests créés');
    
    // Index Bookings entreprise
    await db.collection('bookings').createIndex({ "guestInfo.company": 1, "status": 1 });
    await db.collection('bookings').createIndex({ "guestInfo.company": 1, "createdAt": -1 });
    await db.collection('bookings').createIndex({ "user": 1, "guestInfo.company": 1 });
    console.log('✅ Index bookings entreprise créés');
    
    // Index Invoices (si modèle existe)
    await db.collection('invoices').createIndex({ "company": 1, "status": 1 });
    await db.collection('invoices').createIndex({ "company": 1, "period.year": 1, "period.month": 1 });
    await db.collection('invoices').createIndex({ "dates.dueDate": 1, "status": 1 });
    console.log('✅ Index invoices créés');
    
    console.log('🎉 Tous les index créés avec succès !');
    
  } catch (error) {
    console.error('❌ Erreur création index:', error);
    throw error;
  }
};

module.exports = { createIndexes };

// Si exécuté directement
if (require.main === module) {
  mongoose.connect(process.env.DATABASE_URL || 'mongodb://localhost:27017/hotel-management')
    .then(() => {
      console.log('📊 Connexion MongoDB établie');
      return createIndexes();
    })
    .then(() => {
      console.log('✅ Index créés');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Erreur:', error);
      process.exit(1);
    });
}