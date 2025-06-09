// src/controllers/enterpriseController.js - Contrôleur Entreprise Mis à Jour
const Company = require('../models/Company');
const User = require('../models/User');
const Booking = require('../models/Booking');
const ApprovalRequest = require('../models/ApprovalRequest');
const approvalService = require('../services/approvalService');
const enterpriseInvoicingService = require('../services/enterpriseInvoicingService');
const enterpriseNotificationService = require('../services/enterpriseNotificationService');
const mongoose = require('mongoose');

class EnterpriseController {
  
  // ===== DASHBOARD ENTREPRISE =====
  
  /**
   * Dashboard principal entreprise
   * GET /api/enterprise/dashboard/:companyId
   */
  async getDashboard(req, res) {
    try {
      const { companyId } = req.params;
      const { period = '30', department, userId } = req.query;
      
      console.log(`📊 Dashboard entreprise ${companyId} - période: ${period}j`);
      
      // 1. Vérifier l'entreprise
      const company = await Company.findById(companyId)
        .populate('assignedSalesRep', 'firstName lastName email');
      
      if (!company) {
        return res.status(404).json({ 
          success: false, 
          error: 'Entreprise introuvable' 
        });
      }
      
      // 2. Calculer la période
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(endDate.getDate() - parseInt(period));
      
      // 3. Récupérer les données en parallèle
      const [
        kpis,
        pendingApprovals,
        recentBookings,
        topStats,
        trends,
        budgetAnalysis,
        alerts,
        invoiceSummary,
        employeeStats
      ] = await Promise.all([
        this.calculateKPIs(companyId, startDate, endDate, department),
        this.getPendingApprovalsData(companyId, userId),
        this.getRecentBookings(companyId, 10),
        this.getTopStats(companyId, startDate, endDate),
        this.getBookingTrends(companyId),
        this.getBudgetAnalysis(companyId, startDate, endDate),
        this.generateAlerts(company),
        this.getInvoiceSummary(companyId),
        this.getEmployeeStats(companyId, startDate, endDate)
      ]);
      
      // 4. Calculer les économies réalisées
      const savings = await this.calculateSavings(companyId, startDate, endDate);
      
      // 5. Obtenir les prochaines échéances
      const upcomingDeadlines = await this.getUpcomingDeadlines(companyId);
      
      res.json({
        success: true,
        data: {
          company: {
            id: company._id,
            name: company.name,
            industry: company.industry,
            contract: {
              type: company.contract?.contractType,
              discountRate: company.contract?.discountRate,
              endDate: company.contract?.endDate,
              status: company.contractStatus
            },
            settings: company.settings,
            creditInfo: {
              limit: company.billing?.creditLimit || 0,
              current: company.billing?.currentCredit || 0,
              available: company.availableCredit || 0,
              utilizationRate: company.billing?.creditLimit > 0 
                ? ((company.billing.currentCredit / company.billing.creditLimit) * 100).toFixed(1)
                : 0
            }
          },
          period: { 
            startDate, 
            endDate, 
            days: period 
          },
          kpis,
          pendingApprovals,
          recentBookings,
          topStats,
          trends,
          budgetAnalysis,
          savings,
          alerts,
          invoiceSummary,
          employeeStats,
          upcomingDeadlines
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur dashboard entreprise:', error);
      res.status(500).json({ 
        success: false, 
        error: 'Erreur serveur', 
        details: error.message 
      });
    }
  }
  
  /**
   * Dashboard simplifié pour managers
   * GET /api/enterprise/dashboard/:companyId/manager
   */
  async getManagerDashboard(req, res) {
    try {
      const { companyId } = req.params;
      const userId = req.user.id;
      
      // Vérifier que l'utilisateur est manager
      const user = await User.findById(userId);
      if (!user || !['manager', 'company_admin'].includes(user.userType)) {
        return res.status(403).json({ 
          success: false, 
          error: 'Accès réservé aux managers' 
        });
      }
      
      // Récupérer les données spécifiques manager
      const [
        teamStats,
        pendingApprovals,
        teamBookings,
        budgetUtilization
      ] = await Promise.all([
        this.getTeamStats(userId, companyId),
        approvalService.getPendingApprovalsForUser(userId),
        this.getTeamBookings(userId, companyId),
        this.getTeamBudgetUtilization(userId, companyId)
      ]);
      
      res.json({
        success: true,
        data: {
          manager: {
            id: user._id,
            name: user.fullName,
            department: user.department,
            approvalLimit: user.hierarchy?.approvalLimit || 0
          },
          teamStats,
          pendingApprovals: {
            count: pendingApprovals.pagination?.totalItems || 0,
            urgent: pendingApprovals.summary?.urgent || 0,
            overdue: pendingApprovals.summary?.overdue || 0,
            items: pendingApprovals.approvals?.slice(0, 5) || []
          },
          teamBookings,
          budgetUtilization
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur dashboard manager:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  // ===== GESTION DES APPROBATIONS =====
  
  /**
   * Obtenir les demandes d'approbation en attente
   * GET /api/enterprise/approvals/:companyId
   */
  async getPendingApprovalsEndpoint(req, res) {
    try {
      const { companyId } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        urgency, 
        department,
        minAmount,
        maxAmount,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = req.query;
      
      const userId = req.user.id;
      
      // Vérifier les permissions
      const user = await User.findById(userId);
      if (!user.permissions?.canApprove && user.userType !== 'company_admin') {
        return res.status(403).json({ 
          success: false, 
          error: 'Permissions d\'approbation requises' 
        });
      }
      
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        urgency,
        department,
        minAmount: minAmount ? parseFloat(minAmount) : undefined,
        maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
        sortBy,
        sortOrder: sortOrder === 'desc' ? -1 : 1
      };
      
      const result = await approvalService.getPendingApprovalsForUser(userId, options);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur approbations en attente:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Traiter une approbation (approuver/rejeter)
   * POST /api/enterprise/approvals/:approvalId/process
   */
  async processApproval(req, res) {
    try {
      const { approvalId } = req.params;
      const { decision, comments } = req.body;
      const approverId = req.user.id;
      
      // Validation
      if (!['approved', 'rejected'].includes(decision)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Décision invalide. Utilisez "approved" ou "rejected"' 
        });
      }
      
      if (decision === 'rejected' && !comments) {
        return res.status(400).json({ 
          success: false, 
          error: 'Commentaires requis pour un rejet' 
        });
      }
      
      console.log(`🔄 Traitement approbation ${approvalId}: ${decision} par ${approverId}`);
      
      const result = await approvalService.processApproval(
        approvalId, 
        approverId, 
        decision, 
        comments
      );
      
      res.json({
        success: true,
        message: result.message,
        data: {
          status: result.status,
          nextLevel: result.nextLevel,
          nextApprovers: result.nextApprovers,
          approval: result.approval
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur traitement approbation:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Déléguer une approbation
   * POST /api/enterprise/approvals/:approvalId/delegate
   */
  async delegateApproval(req, res) {
    try {
      const { approvalId } = req.params;
      const { delegateToId, comments } = req.body;
      const fromUserId = req.user.id;
      
      if (!delegateToId) {
        return res.status(400).json({ 
          success: false, 
          error: 'ID du destinataire requis' 
        });
      }
      
      const result = await approvalService.delegateApproval(
        approvalId,
        fromUserId,
        delegateToId,
        comments
      );
      
      res.json({
        success: true,
        message: result.message,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur délégation:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Historique d'une demande d'approbation
   * GET /api/enterprise/approvals/:approvalId/history
   */
  async getApprovalHistory(req, res) {
    try {
      const { approvalId } = req.params;
      
      const result = await approvalService.getApprovalHistory(approvalId);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur historique approbation:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Annuler une demande d'approbation
   * POST /api/enterprise/approvals/:approvalId/cancel
   */
  async cancelApproval(req, res) {
    try {
      const { approvalId } = req.params;
      const { reason } = req.body;
      const userId = req.user.id;
      
      const result = await approvalService.cancelApprovalRequest(
        approvalId,
        userId,
        reason
      );
      
      res.json({
        success: result.success,
        message: result.message,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur annulation approbation:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  // ===== FACTURATION =====
  
  /**
   * Générer facture mensuelle
   * POST /api/enterprise/invoices/:companyId/generate
   */
  async generateMonthlyInvoice(req, res) {
    try {
      const { companyId } = req.params;
      const { year, month, sendEmail = true, notes, regenerate = false } = req.body;
      
      // Validation
      if (!year || !month) {
        return res.status(400).json({ 
          success: false, 
          error: 'Année et mois requis' 
        });
      }
      
      if (month < 1 || month > 12) {
        return res.status(400).json({ 
          success: false, 
          error: 'Mois invalide (1-12)' 
        });
      }
      
      console.log(`📄 Génération facture ${month}/${year} pour ${companyId}`);
      
      const result = await enterpriseInvoicingService.generateMonthlyInvoice(
        companyId,
        parseInt(year),
        parseInt(month),
        {
          sendEmail,
          notes,
          regenerate,
          userId: req.user.id
        }
      );
      
      res.json({
        success: result.success,
        message: result.message,
        data: result.success ? {
          invoice: result.invoice,
          files: result.files,
          analysis: result.analysis
        } : result
      });
      
    } catch (error) {
      console.error('❌ Erreur génération facture:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Générer facture trimestrielle
   * POST /api/enterprise/invoices/:companyId/generate-quarterly
   */
  async generateQuarterlyInvoice(req, res) {
    try {
      const { companyId } = req.params;
      const { year, quarter, sendEmail = true, notes } = req.body;
      
      if (!year || !quarter || quarter < 1 || quarter > 4) {
        return res.status(400).json({ 
          success: false, 
          error: 'Année et trimestre (1-4) requis' 
        });
      }
      
      const result = await enterpriseInvoicingService.generateQuarterlyInvoice(
        companyId,
        parseInt(year),
        parseInt(quarter),
        {
          sendEmail,
          notes,
          userId: req.user.id
        }
      );
      
      res.json({
        success: result.success,
        message: result.message || 'Facture trimestrielle générée',
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur génération facture trimestrielle:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Historique des factures
   * GET /api/enterprise/invoices/:companyId
   */
  async getInvoiceHistory(req, res) {
    try {
      const { companyId } = req.params;
      const { 
        page = 1, 
        limit = 20, 
        status, 
        year, 
        startDate, 
        endDate 
      } = req.query;
      
      const options = {
        page: parseInt(page),
        limit: parseInt(limit),
        status,
        year: year ? parseInt(year) : undefined,
        startDate,
        endDate
      };
      
      const result = await enterpriseInvoicingService.getInvoiceHistory(companyId, options);
      
      res.json({
        success: true,
        data: result
      });
      
    } catch (error) {
      console.error('❌ Erreur historique factures:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Statistiques de facturation
   * GET /api/enterprise/invoices/:companyId/stats
   */
  async getInvoicingStats(req, res) {
    try {
      const { companyId } = req.params;
      const { year } = req.query;
      
      const stats = await enterpriseInvoicingService.getInvoicingStats(
        companyId, 
        year ? parseInt(year) : undefined
      );
      
      res.json({
        success: true,
        data: stats
      });
      
    } catch (error) {
      console.error('❌ Erreur stats facturation:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Marquer facture comme payée
   * POST /api/enterprise/invoices/:invoiceId/payment
   */
  async markInvoiceAsPaid(req, res) {
    try {
      const { invoiceId } = req.params;
      const { method, reference, transactionId, amount } = req.body;
      
      if (!method || !reference) {
        return res.status(400).json({ 
          success: false, 
          error: 'Méthode et référence de paiement requises' 
        });
      }
      
      const result = await enterpriseInvoicingService.markInvoiceAsPaid(invoiceId, {
        method,
        reference,
        transactionId,
        amount: amount ? parseFloat(amount) : undefined
      });
      
      res.json({
        success: result.success,
        message: result.message || 'Facture marquée comme payée',
        data: result.invoice
      });
      
    } catch (error) {
      console.error('❌ Erreur marquage paiement:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  // ===== GESTION DES EMPLOYÉS =====
  
  /**
   * Liste des employés de l'entreprise
   * GET /api/enterprise/employees/:companyId
   */
  async getEmployees(req, res) {
    try {
      const { companyId } = req.params;
      const { 
        page = 1, 
        limit = 50, 
        department, 
        userType, 
        search,
        sortBy = 'firstName',
        sortOrder = 'asc'
      } = req.query;
      
      const query = { 
        company: companyId, 
        isActive: true 
      };
      
      if (department) query.department = department;
      if (userType) query.userType = userType;
      if (search) {
        query.$or = [
          { firstName: { $regex: search, $options: 'i' } },
          { lastName: { $regex: search, $options: 'i' } },
          { email: { $regex: search, $options: 'i' } },
          { employeeId: { $regex: search, $options: 'i' } }
        ];
      }
      
      const employees = await User.find(query)
        .populate('hierarchy.manager', 'firstName lastName jobTitle')
        .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit));
      
      const total = await User.countDocuments(query);
      
      // Statistiques par département
      const departmentStats = await User.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
        {
          $group: {
            _id: '$department',
            count: { $sum: 1 },
            managers: { $sum: { $cond: [{ $eq: ['$userType', 'manager'] }, 1, 0] } },
            totalSpent: { $sum: '$stats.totalSpent' }
          }
        },
        { $sort: { count: -1 } }
      ]);
      
      res.json({
        success: true,
        data: {
          employees: employees.map(emp => ({
            id: emp._id,
            fullName: emp.fullName,
            email: emp.email,
            department: emp.department,
            jobTitle: emp.jobTitle,
            employeeId: emp.employeeId,
            userType: emp.userType,
            manager: emp.hierarchy?.manager,
            permissions: emp.permissions,
            stats: emp.stats,
            lastLogin: emp.lastLogin,
            createdAt: emp.createdAt
          })),
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / parseInt(limit)),
            totalItems: total,
            itemsPerPage: parseInt(limit)
          },
          departmentStats
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur liste employés:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Inviter un nouvel employé
   * POST /api/enterprise/employees/:companyId/invite
   */
  async inviteEmployee(req, res) {
    try {
      const { companyId } = req.params;
      const { 
        firstName, 
        lastName, 
        email, 
        department, 
        jobTitle,
        userType = 'employee',
        managerId,
        permissions = {}
      } = req.body;
      
      // Validation
      if (!firstName || !lastName || !email || !department) {
        return res.status(400).json({ 
          success: false, 
          error: 'Informations obligatoires manquantes (firstName, lastName, email, department)' 
        });
      }
      
      // Vérifier que l'email n'existe pas
      const existingUser = await User.findOne({ email: email.toLowerCase() });
      if (existingUser) {
        return res.status(409).json({ 
          success: false, 
          error: 'Un utilisateur avec cet email existe déjà' 
        });
      }
      
      // Vérifier l'entreprise
      const company = await Company.findById(companyId);
      if (!company) {
        return res.status(404).json({ 
          success: false, 
          error: 'Entreprise introuvable' 
        });
      }
      
      // Générer un employeeId automatique
      const employeeCount = await User.countDocuments({ company: companyId });
      const employeeId = `${company.name.substring(0, 3).toUpperCase()}${String(employeeCount + 1).padStart(4, '0')}`;
      
      // Créer l'utilisateur
      const newEmployee = new User({
        firstName,
        lastName,
        email: email.toLowerCase(),
        password: 'ChangeMe123!', // Mot de passe temporaire
        phone: '0000000000', // Téléphone temporaire
        userType,
        company: companyId,
        department,
        jobTitle,
        employeeId,
        hierarchy: {
          manager: managerId || null,
          canApprove: userType === 'manager' || userType === 'company_admin',
          approvalLimit: userType === 'manager' ? 5000 : userType === 'company_admin' ? 50000 : 0
        },
        permissions: {
          canBook: true,
          canApprove: userType === 'manager' || userType === 'company_admin',
          canViewReports: ['manager', 'company_admin'].includes(userType),
          canManageTeam: userType === 'company_admin',
          maxBookingAmount: userType === 'company_admin' ? 50000 : userType === 'manager' ? 10000 : 5000,
          ...permissions
        },
        invitedBy: req.user.id,
        invitationToken: require('crypto').randomBytes(32).toString('hex'),
        invitationExpires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
      });
      
      await newEmployee.save();
      
      // Envoyer l'invitation par email
      await enterpriseNotificationService.sendEmployeeInvitation({
        employee: newEmployee,
        company,
        invitedBy: req.user,
        invitationUrl: `${process.env.FRONTEND_URL}/invitation/${newEmployee.invitationToken}`
      });
      
      res.status(201).json({
        success: true,
        message: 'Invitation envoyée avec succès',
        data: {
          employee: {
            id: newEmployee._id,
            fullName: newEmployee.fullName,
            email: newEmployee.email,
            department: newEmployee.department,
            employeeId: newEmployee.employeeId,
            userType: newEmployee.userType,
            invitationToken: newEmployee.invitationToken
          }
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur invitation employé:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Mettre à jour un employé
   * PUT /api/enterprise/employees/:employeeId
   */
  async updateEmployee(req, res) {
    try {
      const { employeeId } = req.params;
      const updates = req.body;
      
      // Champs autorisés à la modification
      const allowedUpdates = [
        'department', 'jobTitle', 'userType', 'permissions', 
        'hierarchy.manager', 'hierarchy.approvalLimit', 'hierarchy.canApprove'
      ];
      
      const updateData = {};
      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          if (key.includes('.')) {
            // Gestion des nested fields
            const [parent, child] = key.split('.');
            if (!updateData[parent]) updateData[parent] = {};
            updateData[parent][child] = updates[key];
          } else {
            updateData[key] = updates[key];
          }
        }
      });
      
      const employee = await User.findByIdAndUpdate(
        employeeId,
        updateData,
        { new: true, runValidators: true }
      ).populate('hierarchy.manager', 'firstName lastName');
      
      if (!employee) {
        return res.status(404).json({ 
          success: false, 
          error: 'Employé introuvable' 
        });
      }
      
      res.json({
        success: true,
        message: 'Employé mis à jour avec succès',
        data: { employee }
      });
      
    } catch (error) {
      console.error('❌ Erreur mise à jour employé:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Désactiver un employé
   * DELETE /api/enterprise/employees/:employeeId
   */
  async deactivateEmployee(req, res) {
    try {
      const { employeeId } = req.params;
      const { reason } = req.body;
      
      const employee = await User.findByIdAndUpdate(
        employeeId,
        { 
          isActive: false,
          deactivatedAt: new Date(),
          deactivatedBy: req.user.id,
          deactivationReason: reason || 'Non spécifiée'
        },
        { new: true }
      );
      
      if (!employee) {
        return res.status(404).json({ 
          success: false, 
          error: 'Employé introuvable' 
        });
      }
      
      res.json({
        success: true,
        message: 'Employé désactivé avec succès',
        data: { employee }
      });
      
    } catch (error) {
      console.error('❌ Erreur désactivation employé:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  // ===== CONTRATS ET TARIFS =====
  
  /**
   * Obtenir le contrat entreprise
   * GET /api/enterprise/contract/:companyId
   */
  async getContract(req, res) {
    try {
      const { companyId } = req.params;
      
      const company = await Company.findById(companyId)
        .populate('assignedSalesRep', 'firstName lastName email phone');
      
      if (!company) {
        return res.status(404).json({ 
          success: false, 
          error: 'Entreprise introuvable' 
        });
      }
      
      // Calculer les métriques du contrat
      const contractMetrics = await this.calculateContractMetrics(companyId);
      
      res.json({
        success: true,
        data: {
          contract: company.contract,
          billing: company.billing,
          settings: company.settings,
          assignedSalesRep: company.assignedSalesRep,
          metrics: contractMetrics,
          nextRenewalDate: company.contract?.renewalDate,
          contractStatus: company.contractStatus
        }
      });
      
    } catch (error) {
      console.error('❌ Erreur contrat:', error);
      res.status(500).json({ 
        success: false, 
        error: error.message 
      });
    }
  }
  
  /**
   * Mettre à jour le contrat
   * PUT /api/enterprise/contract/:companyId
   */
  async updateContract(req, res) {
    try {
      const { companyId } = req.params;
      const updates = req.body;
      
      // Seuls les admins peuvent modifier les contrats
      if (req.user.role !== 'ADMIN') {
        return res.status(403).json({ 
          success: false, 
          error: 'Accès refusé - Admin requis' 
        });
      }
      
      const company = await Company.findById(companyId);
      if (!company) {
        return res.status(404).json({ 
          success: false, 
          error: 'Entreprise introuvable' 
        });
      }
      
      // Mise à jour des champs autorisés
     if (updates.contract) {
       Object.assign(company.contract, updates.contract);
     }
     if (updates.billing) {
       Object.assign(company.billing, updates.billing);
     }
     if (updates.settings) {
       Object.assign(company.settings, updates.settings);
     }
     
     await company.save();
     
     // Logger la modification
     if (company.addNote) {
       await company.addNote(
         `Contrat modifié par ${req.user.fullName || req.user.firstName + ' ' + req.user.lastName}`,
         'commercial',
         req.user.id
       );
     }
     
     res.json({
       success: true,
       message: 'Contrat mis à jour avec succès',
       data: { 
         contract: company.contract,
         billing: company.billing,
         settings: company.settings
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur mise à jour contrat:', error);
     res.status(500).json({ 
       success: false, 
       error: error.message 
     });
   }
 }
 
 // ===== REPORTING AVANCÉ =====
 
 /**
  * Rapport personnalisé
  * POST /api/enterprise/reports/:companyId/custom
  */
 async generateCustomReport(req, res) {
   try {
     const { companyId } = req.params;
     const reportConfig = req.body;
     
     // Validation des paramètres
     if (!reportConfig.startDate || !reportConfig.endDate) {
       return res.status(400).json({
         success: false,
         error: 'Dates de début et fin requises'
       });
     }
     
     const result = await enterpriseInvoicingService.generateCustomReport(companyId, reportConfig);
     
     res.json({
       success: result.success,
       data: result
     });
     
   } catch (error) {
     console.error('❌ Erreur rapport personnalisé:', error);
     res.status(500).json({ 
       success: false, 
       error: error.message 
     });
   }
 }
 
 /**
  * Statistiques d'approbation
  * GET /api/enterprise/reports/:companyId/approvals
  */
 async getApprovalStats(req, res) {
   try {
     const { companyId } = req.params;
     const { startDate, endDate } = req.query;
     
     const stats = await approvalService.getCompanyApprovalStats(
       companyId, 
       startDate, 
       endDate
     );
     
     res.json({
       success: true,
       data: stats
     });
     
   } catch (error) {
     console.error('❌ Erreur stats approbations:', error);
     res.status(500).json({ 
       success: false, 
       error: error.message 
     });
   }
 }
 
 /**
  * Export données entreprise
  * GET /api/enterprise/export/:companyId
  */
 async exportCompanyData(req, res) {
   try {
     const { companyId } = req.params;
     const { format = 'excel', type = 'all', startDate, endDate } = req.query;
     
     // Vérifier permissions
     const user = await User.findById(req.user.id);
     if (user.userType !== 'company_admin' && req.user.role !== 'ADMIN') {
       return res.status(403).json({
         success: false,
         error: 'Permissions insuffisantes pour l\'export'
       });
     }
     
     const exportData = await this.generateExportData(companyId, type, startDate, endDate);
     
     // Ici vous pourriez utiliser un service d'export pour générer le fichier
     res.json({
       success: true,
       message: 'Export généré avec succès',
       data: {
         downloadUrl: `/api/files/exports/${companyId}-${Date.now()}.${format}`,
         recordCount: exportData.length,
         format,
         generatedAt: new Date()
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur export:', error);
     res.status(500).json({
       success: false,
       error: error.message
     });
   }
 }
 
 // ===== MÉTHODES UTILITAIRES PRIVÉES =====
 
 /**
  * Calculer les KPIs de l'entreprise
  */
 async calculateKPIs(companyId, startDate, endDate, department = null) {
   const matchQuery = {
     'guestInfo.company': new mongoose.Types.ObjectId(companyId),
     createdAt: { $gte: startDate, $lte: endDate }
   };
   
   if (department) {
     const users = await User.find({ company: companyId, department });
     matchQuery.user = { $in: users.map(u => u._id) };
   }
   
   const bookingStats = await Booking.aggregate([
     { $match: matchQuery },
     {
       $group: {
         _id: null,
         totalBookings: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' },
         confirmedBookings: {
           $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
         },
         pendingBookings: {
           $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
         },
         cancelledBookings: {
           $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
         },
         averageStayDuration: { $avg: '$numberOfNights' },
         averageBookingValue: { $avg: '$totalAmount' },
         totalNights: { $sum: '$numberOfNights' }
       }
     }
   ]);
   
   const stats = bookingStats[0] || {
     totalBookings: 0,
     totalAmount: 0,
     confirmedBookings: 0,
     pendingBookings: 0,
     cancelledBookings: 0,
     averageStayDuration: 0,
     averageBookingValue: 0,
     totalNights: 0
   };
   
   // Calculs supplémentaires
   stats.confirmationRate = stats.totalBookings > 0 
     ? ((stats.confirmedBookings / stats.totalBookings) * 100).toFixed(1)
     : 0;
   
   stats.cancellationRate = stats.totalBookings > 0
     ? ((stats.cancelledBookings / stats.totalBookings) * 100).toFixed(1)
     : 0;
   
   // Comparaison avec période précédente
   const periodDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
   const previousStartDate = new Date(startDate);
   previousStartDate.setDate(previousStartDate.getDate() - periodDays);
   
   const previousStats = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: previousStartDate, $lt: startDate }
       }
     },
     {
       $group: {
         _id: null,
         totalBookings: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' }
       }
     }
   ]);
   
   const prevStats = previousStats[0] || { totalBookings: 0, totalAmount: 0 };
   
   stats.trends = {
     bookingsGrowth: prevStats.totalBookings > 0 
       ? (((stats.totalBookings - prevStats.totalBookings) / prevStats.totalBookings) * 100).toFixed(1)
       : stats.totalBookings > 0 ? 100 : 0,
     amountGrowth: prevStats.totalAmount > 0
       ? (((stats.totalAmount - prevStats.totalAmount) / prevStats.totalAmount) * 100).toFixed(1)
       : stats.totalAmount > 0 ? 100 : 0
   };
   
   return stats;
 }
 
 /**
  * Obtenir les demandes d'approbation en attente (pour dashboard)
  */
 async getPendingApprovalsData(companyId, userId = null) {
   const query = {
     company: companyId,
     finalStatus: 'pending'
   };
   
   if (userId) {
     query['approvalChain.approver'] = userId;
     query['approvalChain.status'] = 'pending';
   }
   
   const approvals = await ApprovalRequest.find(query)
     .populate('requester', 'firstName lastName department')
     .populate('booking', 'reference checkInDate totalAmount')
     .sort({ createdAt: -1 })
     .limit(10);
   
   return {
     count: approvals.length,
     urgent: approvals.filter(a => 
       ['high', 'critical'].includes(a.businessJustification?.urgencyLevel)
     ).length,
     overdue: approvals.filter(a => a.isOverdue).length,
     items: approvals.map(a => ({
       id: a._id,
       requester: a.requester,
       purpose: a.businessJustification?.purpose,
       amount: a.financialInfo?.totalAmount,
       urgency: a.businessJustification?.urgencyLevel,
       isOverdue: a.isOverdue,
       timeRemaining: a.timeRemaining,
       createdAt: a.createdAt,
       booking: a.booking
     }))
   };
 }
 
 /**
  * Obtenir les réservations récentes
  */
 async getRecentBookings(companyId, limit = 10) {
   const bookings = await Booking.find({
     'guestInfo.company': companyId
   })
   .populate('user', 'firstName lastName department')
   .populate('hotel', 'name city')
   .populate('room', 'number type')
   .sort({ createdAt: -1 })
   .limit(limit);
   
   return bookings.map(booking => ({
     id: booking._id,
     reference: booking.reference,
     user: booking.user,
     hotel: booking.hotel,
     room: booking.room,
     checkIn: booking.checkInDate,
     checkOut: booking.checkOutDate,
     amount: booking.totalAmount,
     status: booking.status,
     createdAt: booking.createdAt
   }));
 }
 
 /**
  * Obtenir les statistiques top
  */
 async getTopStats(companyId, startDate, endDate) {
   // Top départements
   const topDepartments = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startDate, $lte: endDate },
         status: 'confirmed'
       }
     },
     {
       $lookup: {
         from: 'users',
         localField: 'user',
         foreignField: '_id',
         as: 'userInfo'
       }
     },
     { $unwind: '$userInfo' },
     {
       $group: {
         _id: '$userInfo.department',
         bookingCount: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' },
         uniqueUsers: { $addToSet: '$user' }
       }
     },
     {
       $project: {
         department: '$_id',
         bookingCount: 1,
         totalAmount: 1,
         userCount: { $size: '$uniqueUsers' },
         averagePerUser: { $divide: ['$totalAmount', { $size: '$uniqueUsers' }] }
       }
     },
     { $sort: { totalAmount: -1 } },
     { $limit: 5 }
   ]);
   
   // Top utilisateurs
   const topUsers = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startDate, $lte: endDate },
         status: 'confirmed'
       }
     },
     {
       $group: {
         _id: '$user',
         bookingCount: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' },
         averageAmount: { $avg: '$totalAmount' }
       }
     },
     {
       $lookup: {
         from: 'users',
         localField: '_id',
         foreignField: '_id',
         as: 'userInfo'
       }
     },
     { $unwind: '$userInfo' },
     {
       $project: {
         user: {
           id: '$userInfo._id',
           name: { $concat: ['$userInfo.firstName', ' ', '$userInfo.lastName'] },
           department: '$userInfo.department'
         },
         bookingCount: 1,
         totalAmount: 1,
         averageAmount: 1
       }
     },
     { $sort: { totalAmount: -1 } },
     { $limit: 5 }
   ]);
   
   // Top hôtels
   const topHotels = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startDate, $lte: endDate },
         status: 'confirmed'
       }
     },
     {
       $group: {
         _id: '$hotel',
         bookingCount: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' },
         uniqueUsers: { $addToSet: '$user' }
       }
     },
     {
       $lookup: {
         from: 'hotels',
         localField: '_id',
         foreignField: '_id',
         as: 'hotelInfo'
       }
     },
     { $unwind: '$hotelInfo' },
     {
       $project: {
         hotel: {
           id: '$hotelInfo._id',
           name: '$hotelInfo.name',
           city: '$hotelInfo.address.city'
         },
         bookingCount: 1,
         totalAmount: 1,
         uniqueUsers: { $size: '$uniqueUsers' }
       }
     },
     { $sort: { bookingCount: -1 } },
     { $limit: 5 }
   ]);
   
   return {
     departments: topDepartments,
     users: topUsers,
     hotels: topHotels
   };
 }
 
 /**
  * Obtenir les tendances de réservation
  */
 async getBookingTrends(companyId) {
   const sixMonthsAgo = new Date();
   sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
   
   const trends = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: sixMonthsAgo }
       }
     },
     {
       $group: {
         _id: {
           year: { $year: '$createdAt' },
           month: { $month: '$createdAt' }
         },
         bookingCount: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' },
         confirmedCount: {
           $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] }
         }
       }
     },
     { $sort: { '_id.year': 1, '_id.month': 1 } }
   ]);
   
   return trends.map(trend => ({
     period: `${trend._id.year}-${String(trend._id.month).padStart(2, '0')}`,
     bookingCount: trend.bookingCount,
     totalAmount: trend.totalAmount,
     confirmedCount: trend.confirmedCount,
     confirmationRate: trend.bookingCount > 0 
       ? ((trend.confirmedCount / trend.bookingCount) * 100).toFixed(1)
       : 0
   }));
 }
 
 /**
  * Analyser le budget
  */
 async getBudgetAnalysis(companyId, startDate, endDate) {
   const company = await Company.findById(companyId);
   
   const currentSpending = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startDate, $lte: endDate },
         status: { $in: ['confirmed', 'pending'] }
       }
     },
     {
       $group: {
         _id: null,
         totalSpent: { $sum: '$totalAmount' },
         confirmedSpent: {
           $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, '$totalAmount', 0] }
         },
         pendingSpent: {
           $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$totalAmount', 0] }
         }
       }
     }
   ]);
   
   const spending = currentSpending[0] || { 
     totalSpent: 0, 
     confirmedSpent: 0, 
     pendingSpent: 0 
   };
   
   const creditLimit = company.billing?.creditLimit || 0;
   const currentCredit = company.billing?.currentCredit || 0;
   const availableCredit = company.availableCredit || 0;
   
   return {
     creditLimit,
     currentCredit,
     availableCredit,
     currentPeriodSpending: spending.totalSpent,
     confirmedSpending: spending.confirmedSpent,
     pendingSpending: spending.pendingSpent,
     utilizationRate: creditLimit > 0 
       ? ((currentCredit / creditLimit) * 100).toFixed(1)
       : 0,
     projectedMonthlySpending: spending.totalSpent > 0 
       ? (spending.totalSpent / ((endDate - startDate) / (1000 * 60 * 60 * 24))) * 30
       : 0
   };
 }
 
 /**
  * Générer des alertes intelligentes
  */
 async generateAlerts(company) {
   const alerts = [];
   
   // Alerte limite de crédit
   const creditLimit = company.billing?.creditLimit || 0;
   const currentCredit = company.billing?.currentCredit || 0;
   const utilizationRate = creditLimit > 0 ? (currentCredit / creditLimit) * 100 : 0;
   
   if (utilizationRate > 80) {
     alerts.push({
       type: utilizationRate > 95 ? 'error' : 'warning',
       title: 'Limite de crédit proche',
       message: `Utilisation actuelle: ${utilizationRate.toFixed(1)}% de la limite`,
       action: 'Contacter le service commercial',
       priority: utilizationRate > 95 ? 'high' : 'medium'
     });
   }
   
   // Alertes contrat
   if (company.contract?.endDate) {
     const daysToExpiry = Math.ceil((company.contract.endDate - new Date()) / (1000 * 60 * 60 * 24));
     if (daysToExpiry <= 90 && daysToExpiry > 0) {
       alerts.push({
         type: daysToExpiry <= 30 ? 'error' : 'warning',
         title: 'Contrat arrivant à échéance',
         message: `Le contrat expire dans ${daysToExpiry} jours`,
         action: 'Planifier le renouvellement',
         priority: daysToExpiry <= 30 ? 'high' : 'medium'
       });
     }
   }
   
   // Alertes approbations en retard
   const overdueApprovals = await ApprovalRequest.countDocuments({
     company: company._id,
     finalStatus: 'pending',
     'timeline.requiredBy': { $lt: new Date() }
   });
   
   if (overdueApprovals > 0) {
     alerts.push({
       type: 'warning',
       title: 'Approbations en retard',
       message: `${overdueApprovals} demande(s) en retard`,
       action: 'Traiter les demandes urgentes',
       priority: 'high'
     });
   }
   
   // Alertes factures impayées
   try {
     const overdueInvoices = await enterpriseInvoicingService.getOverdueAmount(company._id);
     if (overdueInvoices > 0) {
       alerts.push({
         type: 'error',
         title: 'Factures impayées',
         message: `${overdueInvoices}€ en retard de paiement`,
         action: 'Régulariser les paiements',
         priority: 'high'
       });
     }
   } catch (error) {
     console.error('Erreur calcul factures impayées:', error);
   }
   
   return alerts.sort((a, b) => {
     const priority = { high: 3, medium: 2, low: 1 };
     return priority[b.priority] - priority[a.priority];
   });
 }
 
 /**
  * Résumé des factures
  */
 async getInvoiceSummary(companyId) {
   try {
     const invoiceSummary = await enterpriseInvoicingService.getCompanyFinancialSummary(companyId);
     return invoiceSummary;
   } catch (error) {
     console.error('Erreur résumé factures:', error);
     return {
       company: { name: 'Inconnu', creditLimit: 0, currentCredit: 0 },
       invoices: {},
       overdue: { amount: 0, isOverLimit: false },
       nextInvoicingDate: null,
       lastInvoice: null
     };
   }
 }
 
 /**
  * Statistiques des employés
  */
 async getEmployeeStats(companyId, startDate, endDate) {
   const stats = await User.aggregate([
     { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
     {
       $group: {
         _id: '$userType',
         count: { $sum: 1 },
         totalSpent: { $sum: '$stats.totalSpent' },
         totalBookings: { $sum: '$stats.totalBookings' }
       }
     }
   ]);
   
   const departmentStats = await User.aggregate([
     { $match: { company: new mongoose.Types.ObjectId(companyId), isActive: true } },
     {
       $group: {
         _id: '$department',
         employeeCount: { $sum: 1 },
         totalSpent: { $sum: '$stats.totalSpent' },
         totalBookings: { $sum: '$stats.totalBookings' },
         averageSpentPerEmployee: { $avg: '$stats.totalSpent' }
       }
     },
     { $sort: { totalSpent: -1 } }
   ]);
   
   return {
     byType: stats,
     byDepartment: departmentStats,
     totalEmployees: stats.reduce((sum, s) => sum + s.count, 0)
   };
 }
 
 /**
  * Calculer les économies réalisées
  */
 async calculateSavings(companyId, startDate, endDate) {
   const company = await Company.findById(companyId);
   const discountRate = company.contract?.discountRate || 0;
   
   const bookings = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startDate, $lte: endDate },
         status: 'confirmed'
       }
     },
     {
       $group: {
         _id: null,
         totalAmount: { $sum: '$totalAmount' },
         bookingCount: { $sum: 1 }
       }
     }
   ]);
   
   const data = bookings[0] || { totalAmount: 0, bookingCount: 0 };
   const savings = data.totalAmount * (discountRate / 100);
   
   return {
     discountRate,
     totalSpent: data.totalAmount,
     savingsAmount: savings,
     bookingCount: data.bookingCount,
     averageSavingsPerBooking: data.bookingCount > 0 ? savings / data.bookingCount : 0
   };
 }
 
 /**
  * Obtenir les prochaines échéances
  */
 async getUpcomingDeadlines(companyId) {
   const deadlines = [];
   
   // Échéances d'approbation
   const approvalDeadlines = await ApprovalRequest.find({
     company: companyId,
     finalStatus: 'pending',
     'timeline.requiredBy': { 
       $gte: new Date(), 
       $lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) 
     }
   }).populate('requester', 'firstName lastName');
   
   approvalDeadlines.forEach(approval => {
     deadlines.push({
       type: 'approval',
       title: `Approbation - ${approval.requester.firstName} ${approval.requester.lastName}`,
       date: approval.timeline.requiredBy,
       urgency: approval.businessJustification?.urgencyLevel || 'medium',
       amount: approval.financialInfo?.totalAmount || 0
     });
   });
   
   // Échéances de facturation
   try {
     const company = await Company.findById(companyId);
     const nextInvoicingDate = enterpriseInvoicingService.calculateNextInvoicingDate(company);
     if (nextInvoicingDate <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)) {
       deadlines.push({
         type: 'invoicing',
         title: 'Facturation automatique',
         date: nextInvoicingDate,
         urgency: 'medium'
       });
     }
   } catch (error) {
     console.error('Erreur calcul prochaine facturation:', error);
   }
   
   return deadlines.sort((a, b) => new Date(a.date) - new Date(b.date));
 }
 
 /**
  * Calculer les métriques du contrat
  */
 async calculateContractMetrics(companyId) {
   const company = await Company.findById(companyId);
   const startOfYear = new Date(new Date().getFullYear(), 0, 1);
   
   const yearlyStats = await Booking.aggregate([
     { 
       $match: {
         'guestInfo.company': new mongoose.Types.ObjectId(companyId),
         createdAt: { $gte: startOfYear },
         status: 'confirmed'
       }
     },
     {
       $group: {
         _id: null,
         totalSpent: { $sum: '$totalAmount' },
         totalBookings: { $sum: 1 },
         totalNights: { $sum: '$numberOfNights' }
       }
     }
   ]);
   
   const stats = yearlyStats[0] || { totalSpent: 0, totalBookings: 0, totalNights: 0 };
   const discountRate = company.contract?.discountRate || 0;
   const savingsAmount = stats.totalSpent * (discountRate / 100);
   
   return {
     yearlySpending: stats.totalSpent,
     yearlyBookings: stats.totalBookings,
     yearlyNights: stats.totalNights,
     savingsRealized: savingsAmount,
     contractUtilization: company.billing?.creditLimit > 0 
       ? ((stats.totalSpent / company.billing.creditLimit) * 100).toFixed(1)
       : 0,
     averageMonthlySpending: stats.totalSpent / (new Date().getMonth() + 1)
   };
 }
 
 /**
  * Statistiques de l'équipe (pour managers)
  */
 async getTeamStats(managerId, companyId) {
   const teamMembers = await User.find({
     'hierarchy.manager': managerId,
     company: companyId,
     isActive: true
   });
   
   const teamIds = teamMembers.map(member => member._id);
   
   const stats = await Booking.aggregate([
     { 
       $match: {
         user: { $in: teamIds },
         createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
       }
     },
     {
       $group: {
         _id: '$user',
         bookingCount: { $sum: 1 },
         totalAmount: { $sum: '$totalAmount' }
       }
     },
     {
       $lookup: {
         from: 'users',
         localField: '_id',
         foreignField: '_id',
         as: 'userInfo'
       }
     },
     { $unwind: '$userInfo' }
   ]);
   
   return {
     teamSize: teamMembers.length,
     activeMembers: stats.length,
     totalTeamSpending: stats.reduce((sum, s) => sum + s.totalAmount, 0),
     totalTeamBookings: stats.reduce((sum, s) => sum + s.bookingCount, 0),
     memberStats: stats.map(s => ({
       user: {
         id: s.userInfo._id,
         name: `${s.userInfo.firstName} ${s.userInfo.lastName}`,
         department: s.userInfo.department
       },
       bookings: s.bookingCount,
       amount: s.totalAmount
     }))
   };
 }
 
 /**
  * Réservations de l'équipe
  */
 async getTeamBookings(managerId, companyId) {
   const teamMembers = await User.find({
     'hierarchy.manager': managerId,
     company: companyId,
     isActive: true
   });
   
   const bookings = await Booking.find({
     user: { $in: teamMembers.map(m => m._id) },
     createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
   })
   .populate('user', 'firstName lastName')
   .populate('hotel', 'name city')
   .sort({ createdAt: -1 })
   .limit(10);
   
   return bookings;
 }
 
 /**
  * Utilisation budget équipe
  */
 async getTeamBudgetUtilization(managerId, companyId) {
   const teamMembers = await User.find({
     'hierarchy.manager': managerId,
     company: companyId,
     isActive: true
   });
   
   const utilization = await Booking.aggregate([
     { 
       $match: {
         user: { $in: teamMembers.map(m => m._id) },
         createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
       }
     },
     {
       $group: {
         _id: '$user',
         spent: { $sum: '$totalAmount' }
       }
     },
     {
       $lookup: {
         from: 'users',
         localField: '_id',
         foreignField: '_id',
         as: 'userInfo'
       }
     },
     { $unwind: '$userInfo' }
   ]);
   
   return {
     totalBudgetUsed: utilization.reduce((sum, u) => sum + u.spent, 0),
     memberUtilization: utilization.map(u => ({
       user: `${u.userInfo.firstName} ${u.userInfo.lastName}`,
       spent: u.spent,
       limit: u.userInfo.permissions?.maxBookingAmount || 5000,
       utilizationRate: u.userInfo.permissions?.maxBookingAmount > 0 
         ? ((u.spent / u.userInfo.permissions.maxBookingAmount) * 100).toFixed(1)
         : 0
     }))
   };
 }
 
 /**
  * Générer données d'export
  */
 async generateExportData(companyId, type, startDate, endDate) {
   const query = { company: companyId };
   
   if (startDate && endDate) {
     query.createdAt = { 
       $gte: new Date(startDate), 
       $lte: new Date(endDate) 
     };
   }
   
   switch (type) {
     case 'bookings':
       return await Booking.find(query)
         .populate('user', 'firstName lastName department')
         .populate('hotel', 'name city')
         .populate('room', 'number type')
         .sort({ createdAt: -1 });
         
     case 'employees':
       return await User.find({ company: companyId, isActive: true })
         .populate('hierarchy.manager', 'firstName lastName')
         .sort({ firstName: 1 });
         
     case 'approvals':
       return await ApprovalRequest.find(query)
         .populate('requester', 'firstName lastName department')
         .populate('approvalChain.approver', 'firstName lastName')
         .sort({ createdAt: -1 });
         
     case 'invoices':
       const Invoice = require('../models/Invoice');
       return await Invoice.find(query)
         .populate('company', 'name')
         .sort({ 'dates.issueDate': -1 });
         
     default:
       // Export complet
       const [bookings, employees, approvals] = await Promise.all([
         this.generateExportData(companyId, 'bookings', startDate, endDate),
         this.generateExportData(companyId, 'employees', startDate, endDate),
         this.generateExportData(companyId, 'approvals', startDate, endDate)
       ]);
       
       return {
         bookings: bookings.slice(0, 1000), // Limiter pour éviter surcharge
         employees,
         approvals: approvals.slice(0, 500)
       };
   }
 }
 
 // ===== MÉTHODES UTILITAIRES SUPPLÉMENTAIRES =====
 
 /**
  * Rechercher entreprises (pour admins)
  * GET /api/enterprise/search
  */
 async searchCompanies(req, res) {
   try {
     // Vérifier permissions admin
     if (req.user.role !== 'ADMIN') {
       return res.status(403).json({
         success: false,
         error: 'Accès réservé aux administrateurs'
       });
     }
     
     const { 
       query = '', 
       industry, 
       status = 'active',
       page = 1, 
       limit = 20,
       sortBy = 'name',
       sortOrder = 'asc'
     } = req.query;
     
     const searchQuery = {
       status,
       $or: [
         { name: { $regex: query, $options: 'i' } },
         { siret: { $regex: query, $options: 'i' } },
         { 'contact.email': { $regex: query, $options: 'i' } }
       ]
     };
     
     if (industry) {
       searchQuery.industry = industry;
     }
     
     const companies = await Company.find(searchQuery)
       .populate('assignedSalesRep', 'firstName lastName email')
       .sort({ [sortBy]: sortOrder === 'desc' ? -1 : 1 })
       .limit(parseInt(limit))
       .skip((parseInt(page) - 1) * parseInt(limit));
     
     const total = await Company.countDocuments(searchQuery);
     
     res.json({
       success: true,
       data: {
         companies: companies.map(company => ({
           id: company._id,
           name: company.name,
           industry: company.industry,
           status: company.status,
           contractType: company.contract?.contractType,
           employeeCount: 0, // À calculer si nécessaire
           totalSpent: company.statistics?.totalSpent || 0,
           lastActivity: company.lastActivity,
           assignedSalesRep: company.assignedSalesRep
         })),
         pagination: {
           currentPage: parseInt(page),
           totalPages: Math.ceil(total / parseInt(limit)),
           totalItems: total,
           itemsPerPage: parseInt(limit)
         }
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur recherche entreprises:', error);
     res.status(500).json({
       success: false,
       error: error.message
     });
   }
 }
 
 /**
  * Créer nouvelle entreprise (pour admins)
  * POST /api/enterprise/companies
  */
 async createCompany(req, res) {
   try {
     // Vérifier permissions admin
     if (req.user.role !== 'ADMIN') {
       return res.status(403).json({
         success: false,
         error: 'Accès réservé aux administrateurs'
       });
     }
     
     const {
       name,
       siret,
       vatNumber,
       industry,
       address,
       contact,
       billing = {},
       contract = {},
       settings = {}
     } = req.body;
     
     // Validation des champs obligatoires
     if (!name || !siret || !vatNumber || !industry) {
       return res.status(400).json({
         success: false,
         error: 'Champs obligatoires manquants (name, siret, vatNumber, industry)'
       });
     }
     
     // Vérifier unicité SIRET
     const existingCompany = await Company.findOne({ siret });
     if (existingCompany) {
       return res.status(409).json({
         success: false,
         error: 'Une entreprise avec ce SIRET existe déjà'
       });
     }
     
     const newCompany = new Company({
       name,
       siret,
       vatNumber,
       industry,
       address: {
         street: address?.street || '',
         city: address?.city || '',
         zipCode: address?.zipCode || '',
         country: address?.country || 'France'
       },
       contact: {
         email: contact?.email || '',
         phone: contact?.phone || '',
         contactPerson: contact?.contactPerson || {}
       },
       billing: {
         paymentTerms: billing.paymentTerms || 30,
         creditLimit: billing.creditLimit || 50000,
         preferredPaymentMethod: billing.preferredPaymentMethod || 'bank_transfer',
         ...billing
       },
       contract: {
         contractType: contract.contractType || 'standard',
         discountRate: contract.discountRate || 0,
         isActive: contract.isActive !== undefined ? contract.isActive : true,
         startDate: contract.startDate || new Date(),
         ...contract
       },
       settings: {
         requireApproval: settings.requireApproval !== undefined ? settings.requireApproval : true,
         approvalLimit: settings.approvalLimit || 1000,
         autoInvoicing: settings.autoInvoicing !== undefined ? settings.autoInvoicing : true,
         invoicingFrequency: settings.invoicingFrequency || 'monthly',
         ...settings
       },
       assignedSalesRep: req.user.id
     });
     
     await newCompany.save();
     
     res.status(201).json({
       success: true,
       message: 'Entreprise créée avec succès',
       data: {
         company: {
           id: newCompany._id,
           name: newCompany.name,
           siret: newCompany.siret,
           status: newCompany.status,
           contractNumber: newCompany.contract.contractNumber
         }
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur création entreprise:', error);
     res.status(500).json({
       success: false,
       error: error.message
     });
   }
 }
 
 /**
  * Obtenir statistiques globales (pour admins)
  * GET /api/enterprise/stats/global
  */
 async getGlobalStats(req, res) {
   try {
     // Vérifier permissions admin
     if (req.user.role !== 'ADMIN') {
       return res.status(403).json({
         success: false,
         error: 'Accès réservé aux administrateurs'
       });
     }
     
     const { period = '30' } = req.query;
     const endDate = new Date();
     const startDate = new Date();
     startDate.setDate(endDate.getDate() - parseInt(period));
     
     // Statistiques entreprises
     const companyStats = await Company.aggregate([
       {
         $group: {
           _id: '$status',
           count: { $sum: 1 },
           totalRevenue: { $sum: '$statistics.totalSpent' }
         }
       }
     ]);
     
     // Statistiques réservations
     const bookingStats = await Booking.aggregate([
       {
         $match: {
           createdAt: { $gte: startDate, $lte: endDate },
           'guestInfo.company': { $exists: true, $ne: null }
         }
       },
       {
         $group: {
           _id: '$status',
           count: { $sum: 1 },
           totalAmount: { $sum: '$totalAmount' }
         }
       }
     ]);
     
     // Statistiques approbations
     const approvalStats = await ApprovalRequest.aggregate([
       {
         $match: {
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
     ]);
     
     res.json({
       success: true,
       data: {
         period: { startDate, endDate, days: period },
         companies: companyStats,
         bookings: bookingStats,
         approvals: approvalStats,
         summary: {
           totalCompanies: companyStats.reduce((sum, stat) => sum + stat.count, 0),
           totalRevenue: companyStats.reduce((sum, stat) => sum + (stat.totalRevenue || 0), 0),
           totalBookings: bookingStats.reduce((sum, stat) => sum + stat.count, 0),
           totalApprovals: approvalStats.reduce((sum, stat) => sum + stat.count, 0)
         }
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur stats globales:', error);
     res.status(500).json({
       success: false,
       error: error.message
     });
   }
 }
 
 /**
  * Envoyer notification personnalisée
  * POST /api/enterprise/notifications/:companyId/send
  */
 async sendCustomNotification(req, res) {
   try {
     const { companyId } = req.params;
     const { type, recipients, subject, message, urgency = 'medium' } = req.body;
     
     // Vérifier permissions
     const user = await User.findById(req.user.id);
     if (user.userType !== 'company_admin' && req.user.role !== 'ADMIN') {
       return res.status(403).json({
         success: false,
         error: 'Permissions insuffisantes'
       });
     }
     
     // Validation
     if (!type || !recipients || !subject || !message) {
       return res.status(400).json({
         success: false,
         error: 'Champs requis: type, recipients, subject, message'
       });
     }
     
     let targetUsers = [];
     
     // Déterminer les destinataires
     if (recipients === 'all') {
       targetUsers = await User.find({ company: companyId, isActive: true });
     } else if (recipients === 'managers') {
       targetUsers = await User.find({ 
         company: companyId, 
         userType: { $in: ['manager', 'company_admin'] },
         isActive: true 
       });
     } else if (Array.isArray(recipients)) {
       targetUsers = await User.find({ 
         _id: { $in: recipients },
         company: companyId,
         isActive: true 
       });
     }
     
     // Envoyer notifications
     const results = [];
     for (const targetUser of targetUsers) {
       try {
         await enterpriseNotificationService.sendTeamNotification(companyId, {
           type: 'custom_announcement',
           title: subject,
           message: message,
           data: { 
             sender: req.user.fullName || `${req.user.firstName} ${req.user.lastName}`,
             customType: type
           },
           urgency
         });
         
         results.push({
           userId: targetUser._id,
           status: 'sent',
           email: targetUser.email
         });
         
       } catch (error) {
         results.push({
           userId: targetUser._id,
           status: 'failed',
           error: error.message,
           email: targetUser.email
         });
       }
     }
     
     res.json({
       success: true,
       message: `Notification envoyée à ${results.filter(r => r.status === 'sent').length} utilisateur(s)`,
       data: {
         sent: results.filter(r => r.status === 'sent').length,
         failed: results.filter(r => r.status === 'failed').length,
         details: results
       }
     });
     
   } catch (error) {
     console.error('❌ Erreur notification personnalisée:', error);
     res.status(500).json({
       success: false,
       error: error.message
     });
   }
 }
}

module.exports = new EnterpriseController();