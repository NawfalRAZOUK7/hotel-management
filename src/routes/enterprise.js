// src/routes/enterprise.js - Routes Entreprise Complètes
const express = require('express');
const router = express.Router();
const enterpriseController = require('../controllers/enterpriseController');
const { auth, isCompanyAdmin, isManager, checkApprovalLimit } = require('../middleware/auth');
const { validateCompanyAccess, validateApprovalAccess } = require('../middleware/validation');
const rateLimit = require('express-rate-limit');

// ===== MIDDLEWARE DE RATE LIMITING =====

// Rate limiting général pour les API entreprise
const enterpriseRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requêtes par fenêtre
  message: {
    success: false,
    error: 'Trop de requêtes. Réessayez dans 15 minutes.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Rate limiting strict pour les opérations sensibles
const strictRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 requêtes par fenêtre
  message: {
    success: false,
    error: 'Limite de requêtes atteinte pour cette opération sensible.'
  }
});

// Rate limiting pour les exports
const exportRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 heure
  max: 5, // 5 exports par heure
  message: {
    success: false,
    error: 'Limite d\'exports atteinte. Réessayez dans 1 heure.'
  }
});

// Appliquer le rate limiting général à toutes les routes
router.use(enterpriseRateLimit);

// ===== DASHBOARD ET VUES GÉNÉRALES =====

/**
 * Dashboard principal entreprise
 * GET /api/enterprise/dashboard/:companyId
 * Permissions: Tous les utilisateurs de l'entreprise
 */
router.get('/dashboard/:companyId', 
  auth, 
  validateCompanyAccess, 
  enterpriseController.getDashboard
);

/**
 * Dashboard manager simplifié
 * GET /api/enterprise/dashboard/:companyId/manager
 * Permissions: Managers et admins entreprise uniquement
 */
router.get('/dashboard/:companyId/manager',
  auth,
  validateCompanyAccess,
  isManager,
  enterpriseController.getManagerDashboard
);

// ===== GESTION DES APPROBATIONS =====

/**
 * Obtenir les demandes d'approbation en attente
 * GET /api/enterprise/approvals/:companyId
 * Query params: page, limit, urgency, department, minAmount, maxAmount, sortBy, sortOrder
 */
router.get('/approvals/:companyId',
  auth,
  validateCompanyAccess,
  enterpriseController.getPendingApprovalsEndpoint
);

/**
 * Traiter une approbation (approuver/rejeter)
 * POST /api/enterprise/approvals/:approvalId/process
 * Body: { decision: 'approved'|'rejected', comments: string }
 */
router.post('/approvals/:approvalId/process',
  auth,
  strictRateLimit,
  validateApprovalAccess,
  checkApprovalLimit,
  enterpriseController.processApproval
);

/**
 * Déléguer une approbation
 * POST /api/enterprise/approvals/:approvalId/delegate
 * Body: { delegateToId: string, comments?: string }
 */
router.post('/approvals/:approvalId/delegate',
  auth,
  validateApprovalAccess,
  enterpriseController.delegateApproval
);

/**
 * Obtenir l'historique d'une demande d'approbation
 * GET /api/enterprise/approvals/:approvalId/history
 */
router.get('/approvals/:approvalId/history',
  auth,
  validateApprovalAccess,
  enterpriseController.getApprovalHistory
);

/**
 * Annuler une demande d'approbation
 * POST /api/enterprise/approvals/:approvalId/cancel
 * Body: { reason: string }
 */
router.post('/approvals/:approvalId/cancel',
  auth,
  validateApprovalAccess,
  enterpriseController.cancelApproval
);

// ===== GESTION DE LA FACTURATION =====

/**
 * Générer facture mensuelle
 * POST /api/enterprise/invoices/:companyId/generate
 * Body: { year: number, month: number, sendEmail?: boolean, notes?: string, regenerate?: boolean }
 */
router.post('/invoices/:companyId/generate',
  auth,
  strictRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.generateMonthlyInvoice
);

/**
 * Générer facture trimestrielle
 * POST /api/enterprise/invoices/:companyId/generate-quarterly
 * Body: { year: number, quarter: number, sendEmail?: boolean, notes?: string }
 */
router.post('/invoices/:companyId/generate-quarterly',
  auth,
  strictRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.generateQuarterlyInvoice
);

/**
 * Obtenir l'historique des factures
 * GET /api/enterprise/invoices/:companyId
 * Query params: page, limit, status, year, startDate, endDate
 */
router.get('/invoices/:companyId',
  auth,
  validateCompanyAccess,
  enterpriseController.getInvoiceHistory
);

/**
 * Obtenir les statistiques de facturation
 * GET /api/enterprise/invoices/:companyId/stats
 * Query params: year
 */
router.get('/invoices/:companyId/stats',
  auth,
  validateCompanyAccess,
  enterpriseController.getInvoicingStats
);

/**
 * Marquer une facture comme payée
 * POST /api/enterprise/invoices/:invoiceId/payment
 * Body: { method: string, reference: string, transactionId?: string, amount?: number }
 */
router.post('/invoices/:invoiceId/payment',
  auth,
  strictRateLimit,
  isCompanyAdmin,
  enterpriseController.markInvoiceAsPaid
);

// ===== GESTION DES EMPLOYÉS =====

/**
 * Liste des employés de l'entreprise
 * GET /api/enterprise/employees/:companyId
 * Query params: page, limit, department, userType, search, sortBy, sortOrder
 */
router.get('/employees/:companyId',
  auth,
  validateCompanyAccess,
  enterpriseController.getEmployees
);

/**
 * Inviter un nouvel employé
 * POST /api/enterprise/employees/:companyId/invite
 * Body: { firstName, lastName, email, department, jobTitle?, userType?, managerId?, permissions? }
 */
router.post('/employees/:companyId/invite',
  auth,
  strictRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.inviteEmployee
);

/**
 * Mettre à jour un employé
 * PUT /api/enterprise/employees/:employeeId
 * Body: { department?, jobTitle?, userType?, permissions?, hierarchy? }
 */
router.put('/employees/:employeeId',
  auth,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.updateEmployee
);

/**
 * Désactiver un employé
 * DELETE /api/enterprise/employees/:employeeId
 * Body: { reason?: string }
 */
router.delete('/employees/:employeeId',
  auth,
  strictRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.deactivateEmployee
);

// ===== CONTRATS ET TARIFS =====

/**
 * Obtenir le contrat entreprise
 * GET /api/enterprise/contract/:companyId
 */
router.get('/contract/:companyId',
  auth,
  validateCompanyAccess,
  enterpriseController.getContract
);

/**
 * Mettre à jour le contrat (ADMIN uniquement)
 * PUT /api/enterprise/contract/:companyId
 * Body: { contract?, billing?, settings? }
 */
router.put('/contract/:companyId',
  auth,
  strictRateLimit,
  enterpriseController.updateContract // Vérification ADMIN dans le controller
);

// ===== REPORTING ET ANALYTICS =====

/**
 * Générer rapport personnalisé
 * POST /api/enterprise/reports/:companyId/custom
 * Body: { startDate, endDate, groupBy?, includeDetails?, format? }
 */
router.post('/reports/:companyId/custom',
  auth,
  exportRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.generateCustomReport
);

/**
 * Statistiques d'approbation
 * GET /api/enterprise/reports/:companyId/approvals
 * Query params: startDate, endDate
 */
router.get('/reports/:companyId/approvals',
  auth,
  validateCompanyAccess,
  isManager,
  enterpriseController.getApprovalStats
);

/**
 * Export des données entreprise
 * GET /api/enterprise/export/:companyId
 * Query params: format (excel|csv|pdf), type (all|bookings|employees|approvals|invoices), startDate, endDate
 */
router.get('/export/:companyId',
  auth,
  exportRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.exportCompanyData
);

// ===== ROUTES ADMINISTRATIVES (ADMIN SYSTÈME) =====

/**
 * Rechercher des entreprises (ADMIN uniquement)
 * GET /api/enterprise/search
 * Query params: query, industry, status, page, limit, sortBy, sortOrder
 */
router.get('/search',
  auth,
  enterpriseController.searchCompanies // Vérification ADMIN dans le controller
);

/**
 * Créer une nouvelle entreprise (ADMIN uniquement)
 * POST /api/enterprise/companies
 * Body: { name, siret, vatNumber, industry, address, contact, billing?, contract?, settings? }
 */
router.post('/companies',
  auth,
  strictRateLimit,
  enterpriseController.createCompany // Vérification ADMIN dans le controller
);

/**
 * Statistiques globales (ADMIN uniquement)
 * GET /api/enterprise/stats/global
 * Query params: period
 */
router.get('/stats/global',
  auth,
  enterpriseController.getGlobalStats // Vérification ADMIN dans le controller
);

/**
 * Envoyer notification personnalisée
 * POST /api/enterprise/notifications/:companyId/send
 * Body: { type, recipients, subject, message, urgency? }
 */
router.post('/notifications/:companyId/send',
  auth,
  strictRateLimit,
  validateCompanyAccess,
  isCompanyAdmin,
  enterpriseController.sendCustomNotification
);

// ===== MIDDLEWARE DE GESTION D'ERREURS =====

/**
 * Middleware de gestion d'erreurs spécifique aux routes entreprise
 */
router.use((error, req, res, next) => {
  console.error('❌ Erreur route entreprise:', {
    error: error.message,
    stack: error.stack,
    url: req.originalUrl,
    method: req.method,
    user: req.user?.id,
    company: req.params?.companyId
  });

  // Erreurs de validation
  if (error.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error: 'Données invalides',
      details: error.message
    });
  }

  // Erreurs de cast MongoDB
  if (error.name === 'CastError') {
    return res.status(400).json({
      success: false,
      error: 'ID invalide',
      details: 'Format d\'identifiant incorrect'
    });
  }

  // Erreurs d'autorisation
  if (error.status === 403) {
    return res.status(403).json({
      success: false,
      error: 'Accès refusé',
      details: error.message
    });
  }

  // Erreur générique
  res.status(500).json({
    success: false,
    error: 'Erreur serveur interne',
    details: process.env.NODE_ENV === 'development' ? error.message : 'Une erreur inattendue s\'est produite'
  });
});

// ===== ROUTES DE DOCUMENTATION (Développement uniquement) =====

if (process.env.NODE_ENV === 'development') {
  /**
   * Documentation des routes entreprise
   * GET /api/enterprise/docs
   */
  router.get('/docs', (req, res) => {
    const routes = [
      {
        section: 'Dashboard',
        routes: [
          'GET /dashboard/:companyId - Dashboard principal',
          'GET /dashboard/:companyId/manager - Dashboard manager'
        ]
      },
      {
        section: 'Approbations',
        routes: [
          'GET /approvals/:companyId - Liste des approbations',
          'POST /approvals/:approvalId/process - Traiter approbation',
          'POST /approvals/:approvalId/delegate - Déléguer approbation',
          'GET /approvals/:approvalId/history - Historique approbation',
          'POST /approvals/:approvalId/cancel - Annuler approbation'
        ]
      },
      {
        section: 'Facturation',
        routes: [
          'POST /invoices/:companyId/generate - Générer facture mensuelle',
          'POST /invoices/:companyId/generate-quarterly - Générer facture trimestrielle',
          'GET /invoices/:companyId - Historique factures',
          'GET /invoices/:companyId/stats - Statistiques facturation',
          'POST /invoices/:invoiceId/payment - Marquer comme payée'
        ]
      },
      {
        section: 'Employés',
        routes: [
          'GET /employees/:companyId - Liste employés',
          'POST /employees/:companyId/invite - Inviter employé',
          'PUT /employees/:employeeId - Modifier employé',
          'DELETE /employees/:employeeId - Désactiver employé'
        ]
      },
      {
        section: 'Contrats',
        routes: [
          'GET /contract/:companyId - Obtenir contrat',
          'PUT /contract/:companyId - Modifier contrat (ADMIN)'
        ]
      },
      {
        section: 'Reporting',
        routes: [
          'POST /reports/:companyId/custom - Rapport personnalisé',
          'GET /reports/:companyId/approvals - Stats approbations',
          'GET /export/:companyId - Export données'
        ]
      },
      {
        section: 'Administration',
        routes: [
          'GET /search - Rechercher entreprises (ADMIN)',
          'POST /companies - Créer entreprise (ADMIN)',
          'GET /stats/global - Stats globales (ADMIN)',
          'POST /notifications/:companyId/send - Notification personnalisée'
        ]
      }
    ];

    res.json({
      success: true,
      message: 'Documentation des routes API Enterprise',
      version: '2.0.0',
      baseUrl: '/api/enterprise',
      authentication: 'Bearer token requis pour toutes les routes',
      rateLimit: {
        general: '100 requêtes / 15 minutes',
        strict: '20 requêtes / 15 minutes (opérations sensibles)',
        export: '5 requêtes / 1 heure (exports)'
      },
      routes
    });
  });
}

module.exports = router;