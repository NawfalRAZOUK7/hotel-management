// src/jobs/enterpriseJobs.js - Jobs Automatiques Entreprise
const cron = require('node-cron');
const Company = require('../models/Company');
const User = require('../models/User');
const ApprovalRequest = require('../models/ApprovalRequest');
const enterpriseInvoicingService = require('../services/enterpriseInvoicingService');
const enterpriseNotificationService = require('../services/enterpriseNotificationService');
const approvalService = require('../services/approvalService');
const queueService = require('../services/queueService');
const emailService = require('../services/emailService');
const mongoose = require('mongoose');

class EnterpriseJobs {
  constructor() {
    this.isInitialized = false;
    this.runningJobs = new Map();
    this.jobStats = {
      monthlyInvoicing: { lastRun: null, successCount: 0, errorCount: 0 },
      approvalReminders: { lastRun: null, successCount: 0, errorCount: 0 },
      cleanupExpired: { lastRun: null, successCount: 0, errorCount: 0 },
      weeklyReports: { lastRun: null, successCount: 0, errorCount: 0 },
      contractAlerts: { lastRun: null, successCount: 0, errorCount: 0 },
      overdueInvoices: { lastRun: null, successCount: 0, errorCount: 0 }
    };
  }

  // ===== INITIALISATION =====

  /**
   * Initialiser tous les jobs automatiques
   */
  initializeAll() {
    try {
      if (this.isInitialized) {
        console.log('⚠️ Jobs entreprise déjà initialisés');
        return;
      }

      console.log('🚀 Initialisation des jobs entreprise...');

      // Jobs de facturation
      this.scheduleMonthlyInvoicing();
      this.scheduleOverdueInvoiceCheck();

      // Jobs d'approbation
      this.scheduleApprovalReminders();
      this.scheduleCleanupExpiredApprovals();

      // Jobs de reporting
      this.scheduleWeeklyReports();
      this.scheduleContractExpiryAlerts();

      // Jobs de maintenance
      this.scheduleDataCleanup();
      this.scheduleStatsUpdate();

      // Jobs de monitoring
      this.scheduleHealthCheck();

      this.isInitialized = true;
      console.log('✅ Jobs entreprise initialisés avec succès');

    } catch (error) {
      console.error('❌ Erreur initialisation jobs:', error.message);
      throw error;
    }
  }

  /**
   * Arrêter tous les jobs
   */
  stopAll() {
    try {
      this.runningJobs.forEach((job, name) => {
        if (job && job.destroy) {
          job.destroy();
          console.log(`🛑 Job ${name} arrêté`);
        }
      });

      this.runningJobs.clear();
      this.isInitialized = false;
      console.log('✅ Tous les jobs arrêtés');

    } catch (error) {
      console.error('❌ Erreur arrêt jobs:', error.message);
    }
  }

  // ===== JOBS DE FACTURATION =====

  /**
   * Générer factures mensuelles automatiquement
   * Exécution: 1er de chaque mois à 09:00
   */
  scheduleMonthlyInvoicing() {
    const job = cron.schedule('0 9 1 * *', async () => {
      await this.executeJob('monthlyInvoicing', async () => {
        console.log('🏢 Début génération factures mensuelles automatiques');

        const lastMonth = new Date();
        lastMonth.setMonth(lastMonth.getMonth() - 1);
        const year = lastMonth.getFullYear();
        const month = lastMonth.getMonth() + 1;

        const companies = await Company.find({
          'settings.autoInvoicing': true,
          'settings.invoicingFrequency': 'monthly',
          'contract.isActive': true,
          status: 'active'
        });

        const results = {
          success: 0,
          failed: 0,
          skipped: 0,
          total: companies.length,
          details: []
        };

        for (const company of companies) {
          try {
            const result = await enterpriseInvoicingService.generateMonthlyInvoice(
              company._id,
              year,
              month,
              { 
                automatic: true,
                sendEmail: true,
                userId: null // Génération automatique
              }
            );

            if (result.success) {
              results.success++;
              results.details.push({
                companyId: company._id,
                companyName: company.name,
                status: 'success',
                invoiceNumber: result.invoice.number,
                amount: result.invoice.amount
              });
              console.log(`✅ Facture générée: ${company.name} - ${result.invoice.number}`);
            } else {
              results.skipped++;
              results.details.push({
                companyId: company._id,
                companyName: company.name,
                status: 'skipped',
                reason: result.message
              });
              console.log(`⏭️ Ignorée: ${company.name} - ${result.message}`);
            }

          } catch (error) {
            results.failed++;
            results.details.push({
              companyId: company._id,
              companyName: company.name,
              status: 'failed',
              error: error.message
            });
            console.error(`❌ Erreur ${company.name}: ${error.message}`);
          }
        }

        // Envoyer rapport de génération aux admins
        await this.sendInvoicingReport(results, year, month);

        console.log(`📊 Facturation terminée: ${results.success} succès, ${results.failed} erreurs, ${results.skipped} ignorées`);
        return results;
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('monthlyInvoicing', job);
    console.log('📅 Job facturation mensuelle programmé: 1er de chaque mois à 09:00');
  }

  /**
   * Vérifier les factures impayées
   * Exécution: Tous les jours à 10:00
   */
  scheduleOverdueInvoiceCheck() {
    const job = cron.schedule('0 10 * * *', async () => {
      await this.executeJob('overdueInvoices', async () => {
        console.log('💰 Vérification des factures impayées');

        const overdueInvoices = await this.getOverdueInvoices();
        let processedCount = 0;

        for (const invoice of overdueInvoices) {
          try {
            await enterpriseInvoicingService.handleOverdueInvoices(invoice._id);
            processedCount++;
          } catch (error) {
            console.error(`❌ Erreur traitement impayé ${invoice.invoiceNumber}: ${error.message}`);
          }
        }

        console.log(`💳 ${processedCount} factures impayées traitées`);
        return { processedCount, totalOverdue: overdueInvoices.length };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('overdueInvoices', job);
    console.log('📅 Job vérification impayés programmé: tous les jours à 10:00');
  }

  // ===== JOBS D'APPROBATION =====

  /**
   * Envoyer rappels d'approbation
   * Exécution: Tous les jours à 09:00 et 15:00
   */
  scheduleApprovalReminders() {
    const job = cron.schedule('0 9,15 * * *', async () => {
      await this.executeJob('approvalReminders', async () => {
        console.log('⏰ Envoi des rappels d\'approbation');

        const pendingApprovals = await ApprovalRequest.find({
          finalStatus: 'pending',
          createdAt: { $lt: new Date(Date.now() - 12 * 60 * 60 * 1000) } // Plus de 12h
        }).populate('approvalChain.approver requester');

        let remindersSent = 0;
        let escalationsSent = 0;

        for (const approval of pendingApprovals) {
          try {
            const currentStep = approval.approvalChain.find(
              step => step.level === approval.currentLevel && step.status === 'pending'
            );

            if (!currentStep || !currentStep.approver) continue;

            const daysPending = Math.floor(
              (new Date() - approval.createdAt) / (1000 * 60 * 60 * 24)
            );

            // Escalation automatique après 48h
            if (daysPending >= 2) {
              await approvalService.autoEscalate(approval._id);
              escalationsSent++;
              console.log(`🚨 Escalation: ${approval._id} (${daysPending} jours)`);
            } else {
              // Rappel simple
              await approvalService.sendReminder(approval._id, daysPending);
              remindersSent++;
            }

          } catch (error) {
            console.error(`❌ Erreur rappel ${approval._id}: ${error.message}`);
          }
        }

        console.log(`📨 ${remindersSent} rappels et ${escalationsSent} escalations envoyés`);
        return { remindersSent, escalationsSent };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('approvalReminders', job);
    console.log('📅 Job rappels d\'approbation programmé: 09:00 et 15:00');
  }

  /**
   * Nettoyer les approbations expirées
   * Exécution: Tous les dimanches à 02:00
   */
  scheduleCleanupExpiredApprovals() {
    const job = cron.schedule('0 2 * * 0', async () => {
      await this.executeJob('cleanupExpired', async () => {
        console.log('🧹 Nettoyage des approbations expirées');

        const cleanedCount = await approvalService.cleanupExpiredRequests();

        console.log(`🧹 ${cleanedCount} approbations expirées nettoyées`);
        return { cleanedCount };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('cleanupExpired', job);
    console.log('📅 Job nettoyage programmé: dimanches à 02:00');
  }

  // ===== JOBS DE REPORTING =====

  /**
   * Générer rapports hebdomadaires
   * Exécution: Lundis à 08:00
   */
  scheduleWeeklyReports() {
    const job = cron.schedule('0 8 * * 1', async () => {
      await this.executeJob('weeklyReports', async () => {
        console.log('📊 Génération des rapports hebdomadaires');

        const companies = await Company.find({ 
          'contract.isActive': true,
          status: 'active'
        });

        let reportsSent = 0;

        for (const company of companies) {
          try {
            const report = await this.generateWeeklyReport(company._id);
            
            await enterpriseNotificationService.sendWeeklyReport({
              company,
              report
            });

            reportsSent++;
            console.log(`📈 Rapport envoyé: ${company.name}`);

          } catch (error) {
            console.error(`❌ Erreur rapport ${company.name}: ${error.message}`);
          }
        }

        console.log(`📊 ${reportsSent} rapports hebdomadaires envoyés`);
        return { reportsSent };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('weeklyReports', job);
    console.log('📅 Job rapports hebdomadaires programmé: lundis à 08:00');
  }

  /**
   * Alertes d'expiration de contrats
   * Exécution: Tous les jours à 08:00
   */
  scheduleContractExpiryAlerts() {
    const job = cron.schedule('0 8 * * *', async () => {
      await this.executeJob('contractAlerts', async () => {
        console.log('📋 Vérification des expirations de contrats');

        const expiringContracts = await Company.find({
          'contract.isActive': true,
          'contract.endDate': {
            $gte: new Date(),
            $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // Dans les 90 jours
          }
        }).populate('assignedSalesRep');

        let alertsSent = 0;

        for (const company of expiringContracts) {
          try {
            const daysToExpiry = Math.ceil(
              (company.contract.endDate - new Date()) / (1000 * 60 * 60 * 24)
            );

            await enterpriseNotificationService.sendContractExpiryAlert({
              company,
              daysToExpiry
            });

            alertsSent++;
            console.log(`⚠️ Alerte contrat: ${company.name} (${daysToExpiry} jours)`);

          } catch (error) {
            console.error(`❌ Erreur alerte contrat ${company.name}: ${error.message}`);
          }
        }

        console.log(`📋 ${alertsSent} alertes de contrat envoyées`);
        return { alertsSent };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('contractAlerts', job);
    console.log('📅 Job alertes contrats programmé: tous les jours à 08:00');
  }

  // ===== JOBS DE MAINTENANCE =====

  /**
   * Nettoyage des données obsolètes
   * Exécution: 1er dimanche de chaque mois à 03:00
   */
  scheduleDataCleanup() {
    const job = cron.schedule('0 3 1-7 * 0', async () => {
      await this.executeJob('dataCleanup', async () => {
        console.log('🧹 Nettoyage des données obsolètes');

        const results = {
          oldInvoices: 0,
          expiredTokens: 0,
          oldNotifications: 0,
          inactiveUsers: 0
        };

        try {
          // Nettoyer anciennes factures (36 mois)
          results.oldInvoices = await enterpriseInvoicingService.cleanupOldInvoices(36);

          // Nettoyer tokens d'invitation expirés
          results.expiredTokens = await this.cleanupExpiredTokens();

          // Nettoyer anciennes notifications
          results.oldNotifications = await this.cleanupOldNotifications();

          // Nettoyer utilisateurs inactifs depuis longtemps
          results.inactiveUsers = await this.cleanupInactiveUsers();

          console.log('🧹 Nettoyage terminé:', results);
          return results;

        } catch (error) {
          console.error('❌ Erreur nettoyage:', error.message);
          throw error;
        }
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('dataCleanup', job);
    console.log('📅 Job nettoyage données programmé: 1er dimanche à 03:00');
  }

  /**
   * Mise à jour des statistiques
   * Exécution: Tous les jours à 23:00
   */
  scheduleStatsUpdate() {
    const job = cron.schedule('0 23 * * *', async () => {
      await this.executeJob('statsUpdate', async () => {
        console.log('📊 Mise à jour des statistiques');

        const companies = await Company.find({ status: 'active' });
        let updatedCount = 0;

        for (const company of companies) {
          try {
            await this.updateCompanyStats(company._id);
            updatedCount++;
          } catch (error) {
            console.error(`❌ Erreur stats ${company.name}: ${error.message}`);
          }
        }

        console.log(`📊 Statistiques mises à jour pour ${updatedCount} entreprises`);
        return { updatedCount };
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('statsUpdate', job);
    console.log('📅 Job mise à jour stats programmé: tous les jours à 23:00');
  }

  /**
   * Vérification de santé système
   * Exécution: Toutes les heures
   */
  scheduleHealthCheck() {
    const job = cron.schedule('0 * * * *', async () => {
      await this.executeJob('healthCheck', async () => {
        console.log('🔍 Vérification de santé système');

        const health = {
          database: false,
          services: false,
          memory: false,
          jobs: false
        };

        try {
          // Vérifier la base de données
          await mongoose.connection.db.admin().ping();
          health.database = true;

          // Vérifier les services
          health.services = await this.checkServicesHealth();

          // Vérifier la mémoire
          const memUsage = process.memoryUsage();
          health.memory = (memUsage.heapUsed / memUsage.heapTotal) < 0.9;

          // Vérifier les jobs
          health.jobs = this.checkJobsHealth();

          // Alerter si problème
          if (!Object.values(health).every(h => h)) {
            await this.sendHealthAlert(health);
          }

          return health;

        } catch (error) {
          console.error('❌ Erreur health check:', error.message);
          await this.sendHealthAlert(health);
          throw error;
        }
      });
    }, {
      scheduled: false,
      timezone: "Europe/Paris"
    });

    job.start();
    this.runningJobs.set('healthCheck', job);
    console.log('📅 Job health check programmé: toutes les heures');
  }

  // ===== MÉTHODES UTILITAIRES =====

  /**
   * Exécuter un job avec gestion d'erreurs et stats
   */
  async executeJob(jobName, jobFunction) {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Début job: ${jobName}`);
      
      const result = await jobFunction();
      
      // Mettre à jour les statistiques
      this.jobStats[jobName].lastRun = new Date();
      this.jobStats[jobName].successCount++;
      
      const duration = Date.now() - startTime;
      console.log(`✅ Job ${jobName} terminé en ${duration}ms`);
      
      return result;

    } catch (error) {
      // Mettre à jour les statistiques d'erreur
      this.jobStats[jobName].errorCount++;
      
      const duration = Date.now() - startTime;
      console.error(`❌ Job ${jobName} échoué après ${duration}ms:`, error.message);
      
      // Notifier l'erreur critique
      await this.notifyJobError(jobName, error);
      
      throw error;
    }
  }

  /**
   * Générer rapport hebdomadaire pour une entreprise
   */
  async generateWeeklyReport(companyId) {
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);

    const [bookings, approvals, invoices] = await Promise.all([
      // Réservations de la semaine
      mongoose.model('Booking').aggregate([
        {
          $match: {
            'guestInfo.company': new mongoose.Types.ObjectId(companyId),
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$totalAmount' }
          }
        }
      ]),
      
      // Approbations de la semaine
      ApprovalRequest.aggregate([
        {
          $match: {
            company: new mongoose.Types.ObjectId(companyId),
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: '$finalStatus',
            count: { $sum: 1 },
            avgProcessingTime: { $avg: '$timeline.processingTime' }
          }
        }
      ]),
      
      // Factures récentes
      mongoose.model('Invoice').countDocuments({
        company: companyId,
        'dates.issueDate': { $gte: startDate, $lte: endDate }
      })
    ]);

    return {
      period: `${startDate.toLocaleDateString('fr-FR')} - ${endDate.toLocaleDateString('fr-FR')}`,
      bookings: {
        total: bookings.reduce((sum, b) => sum + b.count, 0),
        amount: bookings.reduce((sum, b) => sum + b.totalAmount, 0),
        breakdown: bookings
      },
      approvals: {
        total: approvals.reduce((sum, a) => sum + a.count, 0),
        breakdown: approvals,
        avgProcessingTime: approvals.reduce((sum, a) => sum + (a.avgProcessingTime || 0), 0) / approvals.length || 0
      },
      invoices: invoices,
      generatedAt: new Date()
    };
  }

  /**
   * Obtenir factures impayées
   */
  async getOverdueInvoices() {
    const Invoice = mongoose.model('Invoice');
    return await Invoice.find({
      status: 'sent',
      'dates.dueDate': { $lt: new Date() }
    }).populate('company');
  }

  /**
   * Nettoyer tokens d'invitation expirés
   */
  async cleanupExpiredTokens() {
    const result = await User.updateMany(
      {
        invitationExpires: { $lt: new Date() },
        invitationToken: { $exists: true }
      },
      {
        $unset: {
          invitationToken: 1,
          invitationExpires: 1
        }
      }
    );

    return result.modifiedCount;
  }

  /**
   * Nettoyer anciennes notifications
   */
  async cleanupOldNotifications() {
    // Si vous avez un modèle Notification
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 6); // 6 mois

    try {
      const Notification = mongoose.model('Notification');
      const result = await Notification.deleteMany({
        createdAt: { $lt: cutoffDate },
        isRead: true
      });
      return result.deletedCount;
    } catch (error) {
      // Modèle n'existe pas encore
      return 0;
    }
  }

  /**
   * Nettoyer utilisateurs inactifs
   */
  async cleanupInactiveUsers() {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - 12); // 12 mois

    const result = await User.updateMany(
      {
        lastLogin: { $lt: cutoffDate },
        isActive: true,
        userType: 'employee' // Ne pas désactiver les admins
      },
      {
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: 'Inactivité prolongée (automatique)'
      }
    );

    return result.modifiedCount;
  }

  /**
   * Mettre à jour statistiques entreprise
   */
  async updateCompanyStats(companyId) {
    const company = await Company.findById(companyId);
    if (!company) return;

    // Statistiques des 30 derniers jours
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const stats = await mongoose.model('Booking').aggregate([
      {
        $match: {
          'guestInfo.company': new mongoose.Types.ObjectId(companyId),
          status: 'confirmed',
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: null,
          totalBookings: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
          totalNights: { $sum: '$numberOfNights' }
        }
      }
    ]);

    const data = stats[0] || { totalBookings: 0, totalAmount: 0, totalNights: 0 };

    // Mettre à jour les statistiques
    company.statistics.totalBookings += data.totalBookings;
    company.statistics.totalSpent += data.totalAmount;
    
    if (company.statistics.totalBookings > 0) {
      company.statistics.averageStayValue = 
        company.statistics.totalSpent / company.statistics.totalBookings;
    }

    company.lastActivity = new Date();
    await company.save({ validateBeforeSave: false });
  }

  /**
   * Vérifier santé des services
   */
  async checkServicesHealth() {
    try {
      // Test simple des services principaux
      const testCompany = await Company.findOne().limit(1);
      return !!testCompany;
    } catch (error) {
      return false;
    }
  }

  /**
   * Vérifier santé des jobs
   */
  checkJobsHealth() {
    const now = new Date();
    const maxAge = 25 * 60 * 60 * 1000; // 25 heures

    for (const [jobName, stats] of Object.entries(this.jobStats)) {
      if (stats.lastRun && (now - stats.lastRun) > maxAge) {
        console.warn(`⚠️ Job ${jobName} n'a pas été exécuté depuis ${Math.floor((now - stats.lastRun) / (60 * 60 * 1000))}h`);
        return false;
      }
    }

    return true;
  }

  /**
   * Envoyer alerte de santé système
   */
  async sendHealthAlert(health) {
    try {
      const alertData = {
        to: process.env.ADMIN_EMAIL || 'admin@hotel.com',
        subject: '🚨 Alerte Santé Système - Jobs Entreprise',
        template: 'system-health-alert',
        data: {
          timestamp: new Date().toISOString(),
          health,
          jobStats: this.jobStats,
          serverInfo: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.version
          }
        },
        priority: 'high'
      };

      await emailService.sendEmail(alertData);
    } catch (error) {
      console.error('❌ Erreur envoi alerte santé:', error.message);
    }
  }

  /**
   * Notifier erreur de job
   */
  async notifyJobError(jobName, error) {
    try {
      const alertData = {
        to: process.env.ADMIN_EMAIL || 'admin@hotel.com',
        subject: `❌ Erreur Job Enterprise: ${jobName}`,
        template: 'job-error-alert',
        data: {
          jobName,
          error: error.message,
          stack: error.stack,
          timestamp: new Date().toISOString(),
          stats: this.jobStats[jobName]
        },
        priority: 'high'
      };

      await emailService.sendEmail(alertData);
    } catch (emailError) {
      console.error('❌ Erreur envoi notification job:', emailError.message);
    }
  }

  /**
   * Envoyer rapport de facturation
   */
  async sendInvoicingReport(results, year, month) {
    try {
      const admins = await User.find({ 
        role: 'ADMIN', 
        isActive: true 
      });

      for (const admin of admins) {
        const reportData = {
          to: admin.email,
          subject: `📊 Rapport Facturation Automatique - ${month}/${year}`,
          template: 'monthly-invoicing-report',
          data: {
            adminName: admin.firstName,
            period: `${month}/${year}`,
            results,
            timestamp: new Date().toISOString()
          }
        };

        await emailService.sendEmail(reportData);
      }
    } catch (error) {
      console.error('❌ Erreur rapport facturation:', error.message);
    }
  }

  /**
   * Obtenir statistiques des jobs
   */
  getJobStats() {
    return {
      initialized: this.isInitialized,
      runningJobs: Array.from(this.runningJobs.keys()),
      stats: this.jobStats,
      systemInfo: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        timestamp: new Date()
      }
    };
  }

  /**
   * Exécuter un job manuellement (pour tests/debug)
   */
  async runJobManually(jobName) {
    const jobMethods = {
      monthlyInvoicing: () => this.generateAllMonthlyInvoices(),
      approvalReminders: () => this.sendApprovalReminders(),
      cleanupExpired: () => this.cleanupExpiredApprovals(),
      weeklyReports: () => this.generateWeeklyReports(),
      contractAlerts: () => this.checkContractExpiry(),
      overdueInvoices: () => this.checkOverdueInvoices(),
      dataCleanup: () => this.performDataCleanup(),
      statsUpdate: () => this.updateAllStats(),
      healthCheck: () => this.performHealthCheck()
    };

    const method = jobMethods[jobName];
    if (!method) {
     throw new Error(`Job inconnu: ${jobName}. Jobs disponibles: ${Object.keys(jobMethods).join(', ')}`);
   }

   console.log(`🔧 Exécution manuelle du job: ${jobName}`);
   return await this.executeJob(jobName, method);
 }

 // ===== MÉTHODES D'EXÉCUTION DIRECTE =====

 /**
  * Générer toutes les factures mensuelles (méthode directe)
  */
 async generateAllMonthlyInvoices() {
   const lastMonth = new Date();
   lastMonth.setMonth(lastMonth.getMonth() - 1);
   
   return await enterpriseInvoicingService.generateAllMonthlyInvoices(
     lastMonth.getFullYear(),
     lastMonth.getMonth() + 1
   );
 }

 /**
  * Envoyer tous les rappels d'approbation (méthode directe)
  */
 async sendApprovalReminders() {
   const pendingApprovals = await ApprovalRequest.find({
     finalStatus: 'pending',
     createdAt: { $lt: new Date(Date.now() - 6 * 60 * 60 * 1000) } // Plus de 6h
   });

   let remindersSent = 0;
   let escalationsSent = 0;

   for (const approval of pendingApprovals) {
     try {
       const daysPending = Math.floor(
         (new Date() - approval.createdAt) / (1000 * 60 * 60 * 24)
       );

       if (daysPending >= 2) {
         await approvalService.autoEscalate(approval._id);
         escalationsSent++;
       } else {
         await approvalService.sendReminder(approval._id, daysPending);
         remindersSent++;
       }
     } catch (error) {
       console.error(`❌ Erreur rappel ${approval._id}: ${error.message}`);
     }
   }

   return { remindersSent, escalationsSent };
 }

 /**
  * Nettoyer les approbations expirées (méthode directe)
  */
 async cleanupExpiredApprovals() {
   return await approvalService.cleanupExpiredRequests();
 }

 /**
  * Générer tous les rapports hebdomadaires (méthode directe)
  */
 async generateWeeklyReports() {
   const companies = await Company.find({ 
     'contract.isActive': true,
     status: 'active'
   });

   let reportsSent = 0;

   for (const company of companies) {
     try {
       const report = await this.generateWeeklyReport(company._id);
       
       await enterpriseNotificationService.sendWeeklyReport({
         company,
         report
       });

       reportsSent++;
     } catch (error) {
       console.error(`❌ Erreur rapport ${company.name}: ${error.message}`);
     }
   }

   return { reportsSent, totalCompanies: companies.length };
 }

 /**
  * Vérifier les expirations de contrats (méthode directe)
  */
 async checkContractExpiry() {
   const expiringContracts = await Company.find({
     'contract.isActive': true,
     'contract.endDate': {
       $gte: new Date(),
       $lte: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 90 jours
     }
   }).populate('assignedSalesRep');

   let alertsSent = 0;

   for (const company of expiringContracts) {
     try {
       const daysToExpiry = Math.ceil(
         (company.contract.endDate - new Date()) / (1000 * 60 * 60 * 24)
       );

       await enterpriseNotificationService.sendContractExpiryAlert({
         company,
         daysToExpiry
       });

       alertsSent++;
     } catch (error) {
       console.error(`❌ Erreur alerte contrat ${company.name}: ${error.message}`);
     }
   }

   return { alertsSent, totalExpiring: expiringContracts.length };
 }

 /**
  * Vérifier les factures impayées (méthode directe)
  */
 async checkOverdueInvoices() {
   const overdueInvoices = await this.getOverdueInvoices();
   let processedCount = 0;

   for (const invoice of overdueInvoices) {
     try {
       await enterpriseInvoicingService.handleOverdueInvoices(invoice._id);
       processedCount++;
     } catch (error) {
       console.error(`❌ Erreur traitement impayé ${invoice.invoiceNumber}: ${error.message}`);
     }
   }

   return { processedCount, totalOverdue: overdueInvoices.length };
 }

 /**
  * Effectuer nettoyage des données (méthode directe)
  */
 async performDataCleanup() {
   const results = {
     oldInvoices: 0,
     expiredTokens: 0,
     oldNotifications: 0,
     inactiveUsers: 0
   };

   try {
     results.oldInvoices = await enterpriseInvoicingService.cleanupOldInvoices(36);
     results.expiredTokens = await this.cleanupExpiredTokens();
     results.oldNotifications = await this.cleanupOldNotifications();
     results.inactiveUsers = await this.cleanupInactiveUsers();

     return results;
   } catch (error) {
     console.error('❌ Erreur nettoyage données:', error.message);
     throw error;
   }
 }

 /**
  * Mettre à jour toutes les statistiques (méthode directe)
  */
 async updateAllStats() {
   const companies = await Company.find({ status: 'active' });
   let updatedCount = 0;

   for (const company of companies) {
     try {
       await this.updateCompanyStats(company._id);
       updatedCount++;
     } catch (error) {
       console.error(`❌ Erreur stats ${company.name}: ${error.message}`);
     }
   }

   return { updatedCount, totalCompanies: companies.length };
 }

 /**
  * Effectuer vérification de santé (méthode directe)
  */
 async performHealthCheck() {
   const health = {
     database: false,
     services: false,
     memory: false,
     jobs: false,
     timestamp: new Date()
   };

   try {
     // Vérifier la base de données
     await mongoose.connection.db.admin().ping();
     health.database = true;

     // Vérifier les services
     health.services = await this.checkServicesHealth();

     // Vérifier la mémoire
     const memUsage = process.memoryUsage();
     health.memory = (memUsage.heapUsed / memUsage.heapTotal) < 0.9;

     // Vérifier les jobs
     health.jobs = this.checkJobsHealth();

     // Alerter si problème critique
     const criticalIssues = Object.entries(health).filter(([key, value]) => 
       key !== 'timestamp' && !value
     );

     if (criticalIssues.length > 0) {
       await this.sendHealthAlert(health);
       console.warn(`⚠️ Problèmes détectés: ${criticalIssues.map(([k]) => k).join(', ')}`);
     }

     return health;

   } catch (error) {
     health.error = error.message;
     await this.sendHealthAlert(health);
     throw error;
   }
 }

 // ===== MÉTHODES DE MONITORING =====

 /**
  * Obtenir le statut détaillé des jobs
  */
 getDetailedStatus() {
   const status = {
     initialized: this.isInitialized,
     activeJobs: this.runningJobs.size,
     lastErrors: {},
     uptime: process.uptime(),
     memory: process.memoryUsage(),
     timestamp: new Date()
   };

   // Ajouter les dernières erreurs par job
   Object.entries(this.jobStats).forEach(([jobName, stats]) => {
     if (stats.errorCount > 0) {
       status.lastErrors[jobName] = {
         errorCount: stats.errorCount,
         successCount: stats.successCount,
         lastRun: stats.lastRun,
         successRate: stats.successCount > 0 
           ? ((stats.successCount / (stats.successCount + stats.errorCount)) * 100).toFixed(1)
           : 0
       };
     }
   });

   return status;
 }

 /**
  * Redémarrer un job spécifique
  */
 restartJob(jobName) {
   try {
     // Arrêter le job existant
     const existingJob = this.runningJobs.get(jobName);
     if (existingJob && existingJob.destroy) {
       existingJob.destroy();
       this.runningJobs.delete(jobName);
     }

     // Redémarrer selon le type
     const jobMethods = {
       monthlyInvoicing: () => this.scheduleMonthlyInvoicing(),
       approvalReminders: () => this.scheduleApprovalReminders(),
       cleanupExpired: () => this.scheduleCleanupExpiredApprovals(),
       weeklyReports: () => this.scheduleWeeklyReports(),
       contractAlerts: () => this.scheduleContractExpiryAlerts(),
       overdueInvoices: () => this.scheduleOverdueInvoiceCheck(),
       dataCleanup: () => this.scheduleDataCleanup(),
       statsUpdate: () => this.scheduleStatsUpdate(),
       healthCheck: () => this.scheduleHealthCheck()
     };

     const method = jobMethods[jobName];
     if (method) {
       method();
       console.log(`🔄 Job ${jobName} redémarré avec succès`);
       return true;
     } else {
       throw new Error(`Job inconnu: ${jobName}`);
     }

   } catch (error) {
     console.error(`❌ Erreur redémarrage job ${jobName}: ${error.message}`);
     return false;
   }
 }

 /**
  * Obtenir les prochaines exécutions programmées
  */
 getNextExecutions() {
   const schedules = {
     monthlyInvoicing: '1er de chaque mois à 09:00',
     approvalReminders: 'Tous les jours à 09:00 et 15:00',
     cleanupExpired: 'Dimanches à 02:00',
     weeklyReports: 'Lundis à 08:00',
     contractAlerts: 'Tous les jours à 08:00',
     overdueInvoices: 'Tous les jours à 10:00',
     dataCleanup: '1er dimanche de chaque mois à 03:00',
     statsUpdate: 'Tous les jours à 23:00',
     healthCheck: 'Toutes les heures'
   };

   return Object.entries(schedules).map(([jobName, schedule]) => ({
     jobName,
     schedule,
     isActive: this.runningJobs.has(jobName),
     lastRun: this.jobStats[jobName]?.lastRun,
     successCount: this.jobStats[jobName]?.successCount || 0,
     errorCount: this.jobStats[jobName]?.errorCount || 0
   }));
 }

 // ===== MÉTHODES DE CONFIGURATION =====

 /**
  * Configurer les paramètres des jobs
  */
 configureJob(jobName, config) {
   // Cette méthode permettrait de configurer dynamiquement les jobs
   // Par exemple, changer les horaires d'exécution
   console.log(`⚙️ Configuration job ${jobName}:`, config);
   
   // Implementation future pour la configuration dynamique
   // Actuellement, les horaires sont définis en dur dans le code
 }

 /**
  * Obtenir la configuration actuelle
  */
 getConfiguration() {
   return {
     timezone: 'Europe/Paris',
     jobs: {
       monthlyInvoicing: { 
         enabled: true, 
         schedule: '0 9 1 * *',
         description: 'Génération automatique des factures mensuelles'
       },
       approvalReminders: { 
         enabled: true, 
         schedule: '0 9,15 * * *',
         description: 'Rappels et escalations d\'approbation'
       },
       cleanupExpired: { 
         enabled: true, 
         schedule: '0 2 * * 0',
         description: 'Nettoyage des approbations expirées'
       },
       weeklyReports: { 
         enabled: true, 
         schedule: '0 8 * * 1',
         description: 'Génération des rapports hebdomadaires'
       },
       contractAlerts: { 
         enabled: true, 
         schedule: '0 8 * * *',
         description: 'Alertes d\'expiration de contrats'
       },
       overdueInvoices: { 
         enabled: true, 
         schedule: '0 10 * * *',
         description: 'Traitement des factures impayées'
       },
       dataCleanup: { 
         enabled: true, 
         schedule: '0 3 1-7 * 0',
         description: 'Nettoyage des données obsolètes'
       },
       statsUpdate: { 
         enabled: true, 
         schedule: '0 23 * * *',
         description: 'Mise à jour des statistiques'
       },
       healthCheck: { 
         enabled: true, 
         schedule: '0 * * * *',
         description: 'Vérification de santé système'
       }
     },
     notifications: {
       adminEmail: process.env.ADMIN_EMAIL || 'admin@hotel.com',
       sendHealthAlerts: true,
       sendJobErrorAlerts: true,
       sendReports: true
     }
   };
 }
}

// Export instance singleton
const enterpriseJobs = new EnterpriseJobs();

// Gestion propre de l'arrêt du processus
process.on('SIGTERM', () => {
 console.log('🛑 Signal SIGTERM reçu, arrêt des jobs...');
 enterpriseJobs.stopAll();
 process.exit(0);
});

process.on('SIGINT', () => {
 console.log('🛑 Signal SIGINT reçu, arrêt des jobs...');
 enterpriseJobs.stopAll();
 process.exit(0);
});

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason, promise) => {
 console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
 // Ne pas arrêter le processus pour les jobs, juste logger
});

process.on('uncaughtException', (error) => {
 console.error('❌ Uncaught Exception:', error);
 // Arrêter proprement en cas d'exception critique
 enterpriseJobs.stopAll();
 process.exit(1);
});

module.exports = enterpriseJobs;