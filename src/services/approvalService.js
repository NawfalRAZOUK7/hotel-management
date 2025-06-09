// services/approvalService.js - Service Workflow d'Approbation Complet
const ApprovalRequest = require('../models/ApprovalRequest');
const User = require('../models/User');
const Company = require('../models/Company');
const Booking = require('../models/Booking');
const NotificationService = require('./notificationService');
const EmailService = require('./emailService');
const EnterpriseNotificationService = require('./enterpriseNotificationService');
const QueueService = require('./queueService');

class ApprovalService {
  
  // ===== CRÉATION DE DEMANDE D'APPROBATION =====
  
  /**
   * Créer une nouvelle demande d'approbation
   * @param {Object} bookingData - Données de réservation
   * @param {String} requesterId - ID du demandeur
   * @param {Object} justification - Justification métier
   * @returns {Object} Résultat de la création
   */
  async createApprovalRequest(bookingData, requesterId, justification) {
    try {
      console.log(`🔄 Création demande approbation pour ${requesterId}`);
      
      // 1. Récupérer les informations du demandeur
      const requester = await User.findById(requesterId).populate('company');
      if (!requester) {
        throw new Error('Demandeur introuvable');
      }
      
      if (!requester.company) {
        return { 
          requiresApproval: false, 
          reason: 'Utilisateur individuel - pas d\'approbation requise' 
        };
      }
      
      const company = requester.company;
      
      // 2. Vérifier si approbation nécessaire
      const approvalCheck = this.shouldRequireApproval(company, bookingData.totalAmount, requester);
      if (!approvalCheck.required) {
        console.log(`✅ Pas d'approbation requise: ${approvalCheck.reason}`);
        return { 
          requiresApproval: false, 
          reason: approvalCheck.reason 
        };
      }
      
      // 3. Construire la chaîne d'approbation
      const approvalChain = await this.buildApprovalChain(
        requester, 
        bookingData.totalAmount, 
        justification.urgencyLevel
      );
      
      if (approvalChain.length === 0) {
        throw new Error('Aucun approbateur trouvé pour ce montant');
      }
      
      // 4. Calculer la date limite
      const requiredBy = this.calculateDeadline(
        bookingData.checkInDate,
        justification.urgencyLevel,
        company.settings?.approvalDeadline || 24
      );
      
      // 5. Créer la demande d'approbation
      const approvalRequest = new ApprovalRequest({
        booking: bookingData.bookingId,
        requester: requesterId,
        company: company._id,
        approvalChain,
        currentLevel: 1,
        
        businessJustification: {
          purpose: justification.purpose,
          expectedBenefit: justification.expectedBenefit,
          urgencyLevel: justification.urgencyLevel,
          urgencyReason: justification.urgencyReason,
          clientName: justification.clientName,
          projectName: justification.projectName,
          alternativesConsidered: justification.alternativesConsidered,
          impactIfRejected: justification.impactIfRejected
        },
        
        financialInfo: {
          totalAmount: bookingData.totalAmount,
          currency: bookingData.currency || 'EUR',
          budgetCode: justification.budgetCode,
          costCenter: justification.costCenter,
          projectCode: justification.projectCode,
          availableBudget: justification.availableBudget,
          breakdown: {
            accommodation: bookingData.baseAmount || 0,
            taxes: bookingData.taxAmount || 0,
            extras: bookingData.extrasAmount || 0,
            fees: bookingData.feesAmount || 0
          }
        },
        
        timeline: {
          requiredBy,
          slaTarget: this.calculateSLA(justification.urgencyLevel)
        },
        
        rules: {
          allowAutoApproval: company.settings?.allowAutoApproval || false,
          autoApprovalThreshold: company.settings?.autoApprovalThreshold || 0,
          parallelApproval: justification.urgencyLevel === 'critical',
          autoEscalationDelay: this.getEscalationDelay(justification.urgencyLevel),
          requireConsensus: bookingData.totalAmount > 10000 // Consensus pour montants élevés
        },
        
        metadata: {
          source: bookingData.source || 'web',
          userAgent: bookingData.userAgent,
          ipAddress: bookingData.ipAddress,
          flags: {
            isUrgent: ['high', 'critical'].includes(justification.urgencyLevel),
            requiresSpecialApproval: bookingData.totalAmount > company.billing?.creditLimit * 0.5
          }
        }
      });
      
      await approvalRequest.save();
      console.log(`✅ Demande d'approbation créée: ${approvalRequest._id}`);
      
      // 6. Notifier le(s) premier(s) approbateur(s)
      await this.notifyNextApprovers(approvalRequest);
      
      // 7. Programmer les rappels et escalations
      await this.scheduleReminders(approvalRequest);
      
      // 8. Mettre à jour le booking
      await Booking.findByIdAndUpdate(bookingData.bookingId, {
        status: 'pending_approval',
        approvalRequest: approvalRequest._id,
        approvalRequiredBy: requiredBy
      });
      
      return { 
        requiresApproval: true, 
        approvalId: approvalRequest._id,
        estimatedTime: this.calculateApprovalTime(approvalChain.length, justification.urgencyLevel),
        nextApprovers: approvalChain.filter(step => step.level === 1).map(step => step.approver),
        deadline: requiredBy
      };
      
    } catch (error) {
      console.error(`❌ Erreur création demande approbation: ${error.message}`);
      throw new Error(`Erreur création demande approbation: ${error.message}`);
    }
  }
  
  // ===== TRAITEMENT DES APPROBATIONS =====
  
  /**
   * Traiter une décision d'approbation
   * @param {String} approvalId - ID de la demande
   * @param {String} approverId - ID de l'approbateur
   * @param {String} decision - 'approved' ou 'rejected'
   * @param {String} comments - Commentaires
   * @returns {Object} Résultat du traitement
   */
  async processApproval(approvalId, approverId, decision, comments = '') {
    try {
      console.log(`🔄 Traitement approbation ${approvalId} par ${approverId}: ${decision}`);
      
      // 1. Récupérer la demande avec toutes les relations
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('booking')
        .populate('requester')
        .populate('company')
        .populate('approvalChain.approver');
      
      if (!approval) {
        throw new Error('Demande d\'approbation introuvable');
      }
      
      if (approval.finalStatus !== 'pending') {
        throw new Error(`Demande déjà ${approval.finalStatus}`);
      }
      
      // 2. Vérifier les permissions de l'approbateur
      const canApprove = await this.verifyApproverPermissions(approval, approverId);
      if (!canApprove.allowed) {
        throw new Error(canApprove.reason);
      }
      
      // 3. Traiter selon la décision
      if (decision === 'rejected') {
        return await this.handleRejection(approval, approverId, comments);
      } else if (decision === 'approved') {
        return await this.handleApproval(approval, approverId, comments);
      } else {
        throw new Error('Décision invalide. Utilisez "approved" ou "rejected"');
      }
      
    } catch (error) {
      console.error(`❌ Erreur traitement approbation: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Gérer l'approbation
   */
  async handleApproval(approval, approverId, comments) {
    // 1. Mettre à jour l'étape actuelle
    const currentStep = approval.approvalChain.find(
      step => step.level === approval.currentLevel && 
              (step.approver.equals(approverId) || step.delegatedTo?.equals(approverId))
    );
    
    if (!currentStep) {
      throw new Error('Étape d\'approbation introuvable pour cet utilisateur');
    }
    
    currentStep.status = 'approved';
    currentStep.approvedAt = new Date();
    currentStep.comments = comments;
    
    // 2. Enregistrer la communication
    approval.addCommunication(
      'in_app', 'inbound', approverId, approval.requester,
      'Approbation accordée', comments || 'Demande approuvée'
    );
    
    // 3. Vérifier s'il y a d'autres niveaux
    const nextLevel = approval.currentLevel + 1;
    const nextSteps = approval.approvalChain.filter(step => step.level === nextLevel);
    
    if (nextSteps.length > 0) {
      // Passer au niveau suivant
      approval.currentLevel = nextLevel;
      await approval.save();
      
      console.log(`➡️ Passage au niveau ${nextLevel}`);
      
      // Notifier les prochains approbateurs
      await this.notifyNextApprovers(approval);
      
      return {
        status: 'approved_partial',
        message: `Approbation niveau ${approval.currentLevel - 1} accordée. En attente niveau ${nextLevel}.`,
        nextLevel: nextLevel,
        nextApprovers: nextSteps.map(step => step.approver),
        approval: approval
      };
      
    } else {
      // Approbation finale
      approval.finalStatus = 'approved';
      approval.timeline.approvedAt = new Date();
      await approval.save();
      
      console.log(`✅ Approbation finale accordée`);
      
      // Confirmer le booking
      await Booking.findByIdAndUpdate(approval.booking._id, {
        status: 'confirmed',
        approvedBy: approverId,
        approvedAt: new Date(),
        finalAmount: approval.financialInfo.totalAmount
      });
      
      // Notifier le demandeur
      await this.notifyFinalApproval(approval, 'approved');
      
      // Mettre à jour les statistiques
      await this.updateApprovalStats(approval, 'approved');
      
      return {
        status: 'approved_final',
        message: 'Demande entièrement approuvée. Réservation confirmée.',
        approval: approval
      };
    }
  }
  
  /**
   * Gérer le rejet
   */
  async handleRejection(approval, approverId, comments) {
    // 1. Mettre à jour l'étape actuelle
    const currentStep = approval.approvalChain.find(
      step => step.level === approval.currentLevel && 
              (step.approver.equals(approverId) || step.delegatedTo?.equals(approverId))
    );
    
    if (!currentStep) {
      throw new Error('Étape d\'approbation introuvable pour cet utilisateur');
    }
    
    currentStep.status = 'rejected';
    currentStep.approvedAt = new Date();
    currentStep.comments = comments;
    
    // 2. Finaliser le rejet
    approval.finalStatus = 'rejected';
    approval.timeline.rejectedAt = new Date();
    await approval.save();
    
    console.log(`❌ Demande rejetée par ${approverId}`);
    
    // 3. Enregistrer la communication
    approval.addCommunication(
      'in_app', 'inbound', approverId, approval.requester,
      'Demande rejetée', comments || 'Demande rejetée sans commentaire'
    );
    
    // 4. Mettre à jour le booking
    await Booking.findByIdAndUpdate(approval.booking._id, {
      status: 'rejected',
      rejectionReason: comments,
      rejectedBy: approverId,
      rejectedAt: new Date()
    });
    
    // 5. Notifier le demandeur
    await this.notifyFinalApproval(approval, 'rejected');
    
    // 6. Mettre à jour les statistiques
    await this.updateApprovalStats(approval, 'rejected');
    
    return {
      status: 'rejected',
      message: 'Demande rejetée.',
      reason: comments,
      approval: approval
    };
  }
  
  // ===== CONSTRUCTION DE LA CHAÎNE D'APPROBATION =====
  
  /**
   * Construire la chaîne hiérarchique d'approbation
   */
  async buildApprovalChain(requester, amount, urgencyLevel = 'medium') {
    const chain = [];
    let currentUser = requester;
    let level = 1;
    
    console.log(`🔗 Construction chaîne d'approbation pour ${amount}€`);
    
    try {
      // Remonter la hiérarchie jusqu'à trouver les approbateurs appropriés
      while (level <= 5) { // Maximum 5 niveaux
        // Trouver le manager du niveau actuel
        if (!currentUser.hierarchy?.manager) {
          console.log(`⛔ Pas de manager trouvé au niveau ${level}`);
          break;
        }
        
        const manager = await User.findById(currentUser.hierarchy.manager)
          .populate('company');
        
        if (!manager) {
          console.log(`⛔ Manager introuvable au niveau ${level}`);
          break;
        }
        
        // Vérifier que le manager peut approuver
        if (!manager.permissions.canApprove || !manager.hierarchy.canApprove) {
          console.log(`⛔ Manager ${manager.fullName} ne peut pas approuver`);
          currentUser = manager;
          continue;
        }
        
        // Vérifier la limite d'approbation
        if (manager.hierarchy.approvalLimit < amount) {
          console.log(`⚠️ Manager ${manager.fullName} limite trop basse: ${manager.hierarchy.approvalLimit}€ < ${amount}€`);
          
          // Ajouter quand même si urgence critique et dernier recours
          if (urgencyLevel === 'critical' && level >= 3) {
            chain.push({
              approver: manager._id,
              level: level,
              urgency: 'critical'
            });
            console.log(`🚨 Ajouté malgré limite (urgence critique): ${manager.fullName}`);
          }
          
          currentUser = manager;
          level++;
          continue;
        }
        
        // Ajouter à la chaîne
        chain.push({
          approver: manager._id,
          level: level,
          urgency: this.getStepUrgency(urgencyLevel, level)
        });
        
        console.log(`✅ Niveau ${level}: ${manager.fullName} (limite: ${manager.hierarchy.approvalLimit}€)`);
        
        // Si le manager peut approuver largement ce montant, on peut s'arrêter
        if (manager.hierarchy.approvalLimit >= amount * 2 || 
            manager.userType === 'company_admin') {
          console.log(`🎯 Limite suffisante atteinte au niveau ${level}`);
          break;
        }
        
        currentUser = manager;
        level++;
      }
      
      // Si montant très élevé, ajouter l'admin de l'entreprise
      if (amount > 10000) {
        const companyAdmin = await User.findOne({
          company: requester.company._id,
          userType: 'company_admin',
          isActive: true
        });
        
        if (companyAdmin && !chain.find(step => step.approver.equals(companyAdmin._id))) {
          chain.push({
            approver: companyAdmin._id,
            level: chain.length + 1,
            urgency: 'high'
          });
          console.log(`👑 Admin entreprise ajouté: ${companyAdmin.fullName}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Erreur construction chaîne: ${error.message}`);
      throw error;
    }
    
    if (chain.length === 0) {
      // Fallback: chercher tous les approbateurs disponibles
      const fallbackApprovers = await User.find({
        company: requester.company._id,
        'permissions.canApprove': true,
        'hierarchy.approvalLimit': { $gte: amount },
        isActive: true
      }).sort({ 'hierarchy.level': -1 }).limit(1);
      
      if (fallbackApprovers.length > 0) {
        chain.push({
          approver: fallbackApprovers[0]._id,
          level: 1,
          urgency: urgencyLevel
        });
        console.log(`🔄 Fallback approbateur: ${fallbackApprovers[0].fullName}`);
      }
    }
    
    console.log(`🔗 Chaîne construite: ${chain.length} niveau(x)`);
    return chain;
  }
  
  // ===== NOTIFICATIONS =====
  
  /**
   * Notifier les prochains approbateurs
   */
  async notifyNextApprovers(approval) {
    const currentSteps = approval.approvalChain.filter(
      step => step.level === approval.currentLevel
    );
    
    for (const step of currentSteps) {
      try {
        const approver = await User.findById(step.approver);
        if (!approver) continue;
        
        // Notification email
        await EnterpriseNotificationService.sendApprovalRequest({
          approver,
          requester: approval.requester,
          booking: approval.booking,
          amount: approval.financialInfo.totalAmount,
          purpose: approval.businessJustification.purpose,
          approvalId: approval._id,
          urgency: step.urgency,
          deadline: approval.timeline.requiredBy
        });
        
        // Notification in-app
        await NotificationService.sendInAppNotification({
          userId: approver._id,
          type: 'approval_request',
          title: 'Nouvelle demande d\'approbation',
          message: `${approval.requester.fullName} demande votre approbation pour ${approval.financialInfo.totalAmount}€`,
          data: { 
            approvalId: approval._id,
            amount: approval.financialInfo.totalAmount,
            urgency: step.urgency
          },
          urgency: step.urgency
        });
        
        // Marquer comme notifié
        step.notifiedAt = new Date();
        
        console.log(`📧 Notification envoyée à ${approver.fullName}`);
        
      } catch (error) {
        console.error(`❌ Erreur notification ${step.approver}: ${error.message}`);
      }
    }
    
    approval.timeline.firstNotificationAt = approval.timeline.firstNotificationAt || new Date();
    await approval.save();
  }
  
  /**
   * Notifier l'approbation/rejet final
   */
  async notifyFinalApproval(approval, status) {
    try {
      const template = status === 'approved' ? 'approval-granted' : 'approval-rejected';
      
      await EnterpriseNotificationService.sendApprovalResult({
        requester: approval.requester,
        approval,
        status,
        booking: approval.booking
      });
      
      // Notification in-app
      const message = status === 'approved' 
        ? `Votre demande de réservation a été approuvée`
        : `Votre demande de réservation a été rejetée`;
        
      await NotificationService.sendInAppNotification({
        userId: approval.requester._id,
        type: `approval_${status}`,
        title: status === 'approved' ? 'Demande approuvée' : 'Demande rejetée',
        message,
        data: { 
          approvalId: approval._id,
          bookingId: approval.booking._id,
          status
        }
      });
      
      console.log(`📧 Notification finale envoyée à ${approval.requester.fullName}: ${status}`);
      
    } catch (error) {
      console.error(`❌ Erreur notification finale: ${error.message}`);
    }
  }
  
  // ===== RAPPELS ET ESCALATIONS =====
  
  /**
   * Programmer les rappels automatiques
   */
  async scheduleReminders(approval) {
    const urgencyDelays = {
      low: [24, 48], // Rappels après 24h et 48h
      medium: [12, 24], // Rappels après 12h et 24h
      high: [6, 12], // Rappels après 6h et 12h
      critical: [2, 4] // Rappels après 2h et 4h
    };
    
    const delays = urgencyDelays[approval.businessJustification.urgencyLevel] || urgencyDelays.medium;
    
    for (const delay of delays) {
      await QueueService.scheduleJob('approval-reminder', {
        approvalId: approval._id,
        reminderNumber: delays.indexOf(delay) + 1
      }, delay * 60 * 60 * 1000); // Convertir en millisecondes
    }
    
    // Programmer l'escalation automatique
    const escalationDelay = approval.rules.autoEscalationDelay || 24;
    await QueueService.scheduleJob('approval-escalation', {
      approvalId: approval._id
    }, escalationDelay * 60 * 60 * 1000);
    
    console.log(`⏰ Rappels programmés: ${delays.join('h, ')}h`);
  }
  
  /**
   * Envoyer un rappel
   */
  async sendReminder(approvalId, reminderNumber) {
    try {
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('approvalChain.approver');
      
      if (!approval || approval.finalStatus !== 'pending') {
        return; // Plus besoin de rappel
      }
      
      const currentStep = approval.getCurrentStep();
      if (!currentStep || currentStep.status !== 'pending') {
        return;
      }
      
      const approver = currentStep.approver;
      const daysPending = Math.floor((new Date() - approval.createdAt) / (1000 * 60 * 60 * 24));
      
      await EnterpriseNotificationService.sendApprovalReminder({
        approver,
        approval,
        daysPending,
        reminderNumber
      });
      
      // Mettre à jour le compteur
      currentStep.reminderCount = (currentStep.reminderCount || 0) + 1;
      currentStep.lastReminderAt = new Date();
      await approval.save();
      
      console.log(`🔔 Rappel ${reminderNumber} envoyé à ${approver.fullName}`);
      
    } catch (error) {
      console.error(`❌ Erreur envoi rappel: ${error.message}`);
    }
  }
  
  /**
   * Escalader automatiquement
   */
  async autoEscalate(approvalId) {
    try {
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('company');
      
      if (!approval || approval.finalStatus !== 'pending') {
        return;
      }
      
      console.log(`🚨 Escalation automatique: ${approvalId}`);
      
      // Marquer comme escaladé
      await approval.escalate('timeout');
      
      // Trouver l'escalation target (niveau supérieur ou admin)
      const escalationTarget = await this.findEscalationTarget(approval);
      
      if (escalationTarget) {
        // Ajouter le nouvel approbateur
        approval.approvalChain.push({
          approver: escalationTarget._id,
          level: approval.approvalChain.length + 1,
          urgency: 'high'
        });
        
        approval.escalation.escalatedTo = escalationTarget._id;
        await approval.save();
        
        // Notifier l'escalation
        await this.notifyEscalation(approval, escalationTarget);
      }
      
    } catch (error) {
      console.error(`❌ Erreur escalation automatique: ${error.message}`);
    }
  }
  
  // ===== UTILITAIRES =====
  
  /**
   * Vérifier si approbation requise
   */
  shouldRequireApproval(company, amount, requester) {
    if (!company.settings?.requireApproval) {
      return { required: false, reason: 'Approbation désactivée pour cette entreprise' };
    }
    
    if (amount < company.settings.approvalLimit) {
      return { required: false, reason: `Montant sous le seuil (${company.settings.approvalLimit}€)` };
    }
    
    if (requester.userType === 'company_admin') {
      return { required: false, reason: 'Administrateur entreprise - auto-approbation' };
    }
    
    return { required: true, reason: 'Approbation requise selon les règles entreprise' };
  }
  
  /**
   * Vérifier les permissions d'approbateur
   */
  async verifyApproverPermissions(approval, approverId) {
    const currentStep = approval.approvalChain.find(
      step => step.level === approval.currentLevel
    );
    
    if (!currentStep) {
      return { allowed: false, reason: 'Aucune étape d\'approbation active' };
    }
    
    // Vérifier si c'est l'approbateur assigné ou un délégué
    const isAssignedApprover = currentStep.approver.equals(approverId);
    const isDelegated = currentStep.delegatedTo?.equals(approverId);
    
    if (!isAssignedApprover && !isDelegated) {
      return { allowed: false, reason: 'Non autorisé à approuver à ce niveau' };
    }
    
    // Vérifier que l'utilisateur est actif
    const approver = await User.findById(approverId);
    if (!approver || !approver.isActive) {
      return { allowed: false, reason: 'Approbateur inactif' };
    }
    
    // Vérifier les permissions
    if (!approver.permissions.canApprove) {
      return { allowed: false, reason: 'Permissions d\'approbation insuffisantes' };
    }
    
    // Vérifier la limite d'approbation
    if (approver.hierarchy.approvalLimit < approval.financialInfo.totalAmount) {
      return { allowed: false, reason: 'Montant dépasse la limite d\'approbation' };
    }
    
    return { allowed: true };
  }
  
  /**
   * Calculer la deadline
   */
  calculateDeadline(checkInDate, urgencyLevel, defaultHours = 24) {
    const urgencyHours = {
      low: 48,
      medium: 24,
      high: 12,
      critical: 6
    };
    
    const hours = urgencyHours[urgencyLevel] || defaultHours;
    const deadline = new Date();
    deadline.setHours(deadline.getHours() + hours);
    
    // Ne pas dépasser la date de check-in moins 24h
    const checkInLimit = new Date(checkInDate);
    checkInLimit.setHours(checkInLimit.getHours() - 24);
    
    return deadline < checkInLimit ? deadline : checkInLimit;
  }
  
  /**
   * Calculer le SLA en heures
   */
  calculateSLA(urgencyLevel) {
    const slaHours = {
      low: 48,
      medium: 24,
      high: 8,
      critical: 4
    };
    
    return slaHours[urgencyLevel] || 24;
  }
  
  /**
   * Obtenir le délai d'escalation
   */
  getEscalationDelay(urgencyLevel) {
    const delays = {
      low: 48,
      medium: 24,
      high: 12,
      critical: 4
    };
    
    return delays[urgencyLevel] || 24;
  }
  
  /**
   * Calculer le temps d'approbation estimé
   */
  calculateApprovalTime(levels, urgencyLevel) {
    const baseHoursPerLevel = {
      low: 12,
      medium: 8,
      high: 4,
      critical: 2
    };
    
    const hoursPerLevel = baseHoursPerLevel[urgencyLevel] || 8;
    return levels * hoursPerLevel;
  }
  
  /**
   * Obtenir l'urgence d'une étape
   */
  getStepUrgency(globalUrgency, level) {
    if (globalUrgency === 'critical') return 'high';
    if (globalUrgency === 'high' && level === 1) return 'high';
    return 'medium';
  }
  
  /**
   * Trouver une cible d'escalation
   */
  async findEscalationTarget(approval) {
    // Chercher un admin de l'entreprise
    const companyAdmin = await User.findOne({
      company: approval.company,
      userType: 'company_admin',
      isActive: true
    });
    
    if (companyAdmin) return companyAdmin;
    
    // Sinon, chercher le manager avec la plus haute limite
    const topManager = await User.findOne({
      company: approval.company,
      'permissions.canApprove': true,
      isActive: true
    }).sort({ 'hierarchy.approvalLimit': -1 });
    
    return topManager;
  }
  
  /**
   * Notifier une escalation
   */
  async notifyEscalation(approval, escalationTarget) {
    try {
      await EnterpriseNotificationService.sendEscalationNotification({
        target: escalationTarget,
        approval,
        originalApprover: approval.getCurrentStep()?.approver,
        escalationLevel: approval.escalation.escalationLevel
      });
      
      console.log(`🚨 Notification escalation envoyée à ${escalationTarget.fullName}`);
      
    } catch (error) {
      console.error(`❌ Erreur notification escalation: ${error.message}`);
    }
  }
  
  /**
   * Mettre à jour les statistiques
   */
  async updateApprovalStats(approval, finalStatus) {
    try {
      // Mettre à jour stats du demandeur
      const requester = await User.findById(approval.requester);
      if (requester) {
        requester.stats.approvalsReceived = (requester.stats.approvalsReceived || 0) + 1;
        await requester.save({ validateBeforeSave: false });
      }
      
      // Mettre à jour stats des approbateurs
      for (const step of approval.approvalChain) {
        if (step.status === 'approved') {
          const approver = await User.findById(step.approver);
          if (approver) {
            approver.stats.approvalsGiven = (approver.stats.approvalsGiven || 0) + 1;
            await approver.save({ validateBeforeSave: false });
          }
        }
      }
      
      // Mettre à jour stats de l'entreprise
      const company = await Company.findById(approval.company);
      if (company) {
        company.statistics.totalBookings += 1;
        if (finalStatus === 'approved') {
          company.statistics.totalSpent += approval.financialInfo.totalAmount;
          company.statistics.averageStayValue = 
            company.statistics.totalSpent / company.statistics.totalBookings;
        }
        await company.save({ validateBeforeSave: false });
      }
      
      console.log(`📊 Statistiques mises à jour pour ${finalStatus}`);
      
    } catch (error) {
      console.error(`❌ Erreur mise à jour stats: ${error.message}`);
    }
  }
  
  // ===== MÉTHODES DE GESTION =====
  
  /**
   * Obtenir les demandes en attente pour un approbateur
   */
  async getPendingApprovalsForUser(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        sortBy = 'createdAt',
        sortOrder = -1,
        urgency,
        minAmount,
        maxAmount
      } = options;
      
      const query = {
        'approvalChain.approver': userId,
        'approvalChain.status': 'pending',
        finalStatus: 'pending'
      };
      
      if (urgency) {
        query['businessJustification.urgencyLevel'] = urgency;
      }
      
      if (minAmount !== undefined) {
        query['financialInfo.totalAmount'] = { $gte: minAmount };
      }
      
      if (maxAmount !== undefined) {
        query['financialInfo.totalAmount'] = query['financialInfo.totalAmount'] || {};
        query['financialInfo.totalAmount'].$lte = maxAmount;
      }
      
      const approvals = await ApprovalRequest.find(query)
        .populate('requester', 'firstName lastName email jobTitle department')
        .populate('company', 'name')
        .populate('booking', 'reference checkInDate checkOutDate hotel')
        .sort({ [sortBy]: sortOrder })
        .limit(limit * 1)
        .skip((page - 1) * limit);
      
      const total = await ApprovalRequest.countDocuments(query);
      
      // Enrichir avec des métadonnées
      const enrichedApprovals = approvals.map(approval => ({
        ...approval.toObject(),
        isOverdue: approval.isOverdue,
        timeRemaining: approval.timeRemaining,
        progressPercentage: approval.progressPercentage,
        currentUserLevel: approval.approvalChain.find(
          step => step.approver.equals(userId)
        )?.level,
        canApprove: approval.approvalChain.some(
          step => step.approver.equals(userId) && 
                  step.level === approval.currentLevel &&
                  step.status === 'pending'
        )
      }));
      
      return {
        approvals: enrichedApprovals,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        },
        summary: {
          total: total,
          overdue: approvals.filter(a => a.isOverdue).length,
          urgent: approvals.filter(a => 
            ['high', 'critical'].includes(a.businessJustification.urgencyLevel)
          ).length
        }
      };
      
    } catch (error) {
      console.error(`❌ Erreur récupération demandes: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Obtenir les statistiques d'approbation pour une entreprise
   */
  async getCompanyApprovalStats(companyId, startDate, endDate) {
    try {
      const matchQuery = { company: companyId };
      
      if (startDate && endDate) {
        matchQuery.createdAt = { $gte: new Date(startDate), $lte: new Date(endDate) };
      }
      
      const stats = await ApprovalRequest.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$finalStatus',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financialInfo.totalAmount' },
            avgProcessingTime: { $avg: '$timeline.processingTime' },
            avgApprovalChainLength: { $avg: { $size: '$approvalChain' } }
          }
        }
      ]);
      
      // Statistiques par urgence
      const urgencyStats = await ApprovalRequest.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$businessJustification.urgencyLevel',
            count: { $sum: 1 },
            avgProcessingTime: { $avg: '$timeline.processingTime' }
          }
        }
      ]);
      
      // Statistiques par département
      const departmentStats = await ApprovalRequest.aggregate([
        { $match: matchQuery },
        {
          $lookup: {
            from: 'users',
            localField: 'requester',
            foreignField: '_id',
            as: 'requesterInfo'
          }
        },
        { $unwind: '$requesterInfo' },
        {
          $group: {
            _id: '$requesterInfo.department',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financialInfo.totalAmount' },
            approvedCount: {
              $sum: { $cond: [{ $eq: ['$finalStatus', 'approved'] }, 1, 0] }
            }
          }
        }
      ]);
      
      // SLA compliance
      const slaStats = await ApprovalRequest.aggregate([
        { $match: { ...matchQuery, finalStatus: { $ne: 'pending' } } },
        {
          $group: {
            _id: null,
            totalCompleted: { $sum: 1 },
            slaCompliant: { $sum: { $cond: ['$timeline.slaCompliant', 1, 0] } }
          }
        }
      ]);
      
      return {
        overview: stats,
        byUrgency: urgencyStats,
        byDepartment: departmentStats,
        slaCompliance: slaStats[0] ? {
          total: slaStats[0].totalCompleted,
          compliant: slaStats[0].slaCompliant,
          rate: ((slaStats[0].slaCompliant / slaStats[0].totalCompleted) * 100).toFixed(1)
        } : null
      };
      
    } catch (error) {
      console.error(`❌ Erreur stats entreprise: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Déléguer une approbation
   */
  async delegateApproval(approvalId, fromUserId, toUserId, comments = '') {
    try {
      console.log(`🔄 Délégation approbation ${approvalId}: ${fromUserId} → ${toUserId}`);
      
      const approval = await ApprovalRequest.findById(approvalId);
      if (!approval) {
        throw new Error('Demande d\'approbation introuvable');
      }
      
      // Vérifier que l'utilisateur peut déléguer
      const currentStep = approval.approvalChain.find(
        step => step.level === approval.currentLevel && step.approver.equals(fromUserId)
      );
      
      if (!currentStep) {
        throw new Error('Vous n\'êtes pas autorisé à déléguer cette approbation');
      }
      
      if (currentStep.status !== 'pending') {
        throw new Error('Cette étape a déjà été traitée');
      }
      
      // Vérifier que le destinataire peut approuver
      const delegate = await User.findById(toUserId);
      if (!delegate || !delegate.permissions.canApprove) {
        throw new Error('Le destinataire ne peut pas approuver');
      }
      
      if (delegate.hierarchy.approvalLimit < approval.financialInfo.totalAmount) {
        throw new Error('Le destinataire n\'a pas une limite suffisante');
      }
      
      // Effectuer la délégation
      await approval.delegateToUser(fromUserId, toUserId, approval.currentLevel);
      
      // Notifier le destinataire
      await EnterpriseNotificationService.sendDelegationNotification({
        delegate,
        delegator: await User.findById(fromUserId),
        approval,
        comments
      });
      
      console.log(`✅ Délégation effectuée avec succès`);
      
      return {
        success: true,
        message: 'Approbation déléguée avec succès',
        delegatedTo: delegate.fullName,
        approval
      };
      
    } catch (error) {
      console.error(`❌ Erreur délégation: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Annuler une demande d'approbation
   */
  async cancelApprovalRequest(approvalId, userId, reason) {
    try {
      console.log(`🔄 Annulation demande ${approvalId} par ${userId}`);
      
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('requester');
      
      if (!approval) {
        throw new Error('Demande d\'approbation introuvable');
      }
      
      if (approval.finalStatus !== 'pending') {
        throw new Error('Demande déjà traitée, impossible d\'annuler');
      }
      
      // Vérifier les permissions (demandeur ou admin)
      const user = await User.findById(userId);
      const canCancel = approval.requester._id.equals(userId) || 
                       user.userType === 'company_admin' ||
                       user.role === 'ADMIN';
      
      if (!canCancel) {
        throw new Error('Vous n\'êtes pas autorisé à annuler cette demande');
      }
      
      // Annuler la demande
      approval.finalStatus = 'cancelled';
      approval.timeline.cancelledAt = new Date();
      
      // Ajouter communication
      approval.addCommunication(
        'in_app', 'inbound', userId, approval.requester._id,
        'Demande annulée', reason || 'Demande annulée par l\'utilisateur'
      );
      
      await approval.save();
      
      // Annuler le booking associé
      await Booking.findByIdAndUpdate(approval.booking, {
        status: 'cancelled',
        cancellationReason: reason || 'Demande d\'approbation annulée',
        cancelledBy: userId,
        cancelledAt: new Date()
      });
      
      // Notifier les approbateurs en attente
      await this.notifyApprovalCancellation(approval, reason);
      
      console.log(`✅ Demande annulée avec succès`);
      
      return {
        success: true,
        message: 'Demande d\'approbation annulée',
        approval
      };
      
    } catch (error) {
      console.error(`❌ Erreur annulation: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Notifier l'annulation d'une demande
   */
  async notifyApprovalCancellation(approval, reason) {
    try {
      // Notifier tous les approbateurs en attente
      const pendingSteps = approval.approvalChain.filter(step => step.status === 'pending');
      
      for (const step of pendingSteps) {
        const approver = await User.findById(step.approver);
        if (approver) {
          await NotificationService.sendInAppNotification({
            userId: approver._id,
            type: 'approval_cancelled',
            title: 'Demande d\'approbation annulée',
            message: `La demande de ${approval.requester.fullName} a été annulée`,
            data: { 
              approvalId: approval._id,
              reason: reason
            }
          });
        }
      }
      
    } catch (error) {
      console.error(`❌ Erreur notification annulation: ${error.message}`);
    }
  }
  
  /**
   * Obtenir l'historique d'une demande
   */
  async getApprovalHistory(approvalId) {
    try {
      const approval = await ApprovalRequest.findById(approvalId)
        .populate('requester', 'firstName lastName email jobTitle')
        .populate('company', 'name')
        .populate('booking', 'reference checkInDate checkOutDate')
        .populate('approvalChain.approver', 'firstName lastName email jobTitle')
        .populate('communications.from', 'firstName lastName')
        .populate('communications.to', 'firstName lastName');
      
      if (!approval) {
        throw new Error('Demande d\'approbation introuvable');
      }
      
      // Construire la timeline
      const timeline = [];
      
      // Création de la demande
      timeline.push({
        date: approval.createdAt,
        type: 'created',
        actor: approval.requester,
        action: 'Demande créée',
        details: approval.businessJustification.purpose
      });
      
      // Étapes d'approbation
      for (const step of approval.approvalChain) {
        if (step.status !== 'pending') {
          timeline.push({
            date: step.approvedAt,
            type: step.status,
            actor: step.approver,
            action: step.status === 'approved' ? 'Approuvé' : 'Rejeté',
            details: step.comments,
            level: step.level
          });
        }
      }
      
      // Communications
      for (const comm of approval.communications) {
        timeline.push({
          date: comm.sentAt,
          type: 'communication',
          actor: comm.from,
          action: `${comm.type} envoyé`,
          details: comm.subject,
          target: comm.to
        });
      }
      
      // Escalations
      for (const escalation of approval.escalation.escalationHistory) {
        timeline.push({
          date: escalation.escalatedAt,
          type: 'escalation',
          action: `Escaladé niveau ${escalation.level}`,
          details: escalation.reason,
          target: escalation.escalatedTo
        });
      }
      
      // Trier par date
      timeline.sort((a, b) => new Date(a.date) - new Date(b.date));
      
      return {
        approval,
        timeline,
        summary: approval.getSummary()
      };
      
    } catch (error) {
      console.error(`❌ Erreur historique: ${error.message}`);
      throw error;
    }
  }
  
  // ===== JOBS AUTOMATIQUES =====
  
  /**
   * Nettoyer les demandes expirées
   */
  async cleanupExpiredRequests() {
    try {
      console.log('🧹 Nettoyage des demandes expirées...');
      
      const expiredApprovals = await ApprovalRequest.find({
        finalStatus: 'pending',
        'timeline.requiredBy': { $lt: new Date() }
      });
      
      for (const approval of expiredApprovals) {
        approval.finalStatus = 'expired';
        approval.timeline.expiredAt = new Date();
        
        // Annuler le booking
        await Booking.findByIdAndUpdate(approval.booking, {
          status: 'cancelled',
          cancellationReason: 'Délai d\'approbation dépassé'
        });
        
        await approval.save();
        
        // Notifier l'expiration
        await this.notifyApprovalExpiration(approval);
      }
      
      console.log(`🧹 ${expiredApprovals.length} demandes expirées nettoyées`);
      return expiredApprovals.length;
      
    } catch (error) {
      console.error(`❌ Erreur nettoyage: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * Notifier l'expiration d'une demande
   */
  async notifyApprovalExpiration(approval) {
    try {
      await NotificationService.sendInAppNotification({
        userId: approval.requester._id,
        type: 'approval_expired',
        title: 'Demande d\'approbation expirée',
        message: 'Votre demande de réservation a expiré faute d\'approbation dans les délais',
        data: { 
          approvalId: approval._id,
          bookingId: approval.booking
        }
      });
      
    } catch (error) {
      console.error(`❌ Erreur notification expiration: ${error.message}`);
    }
  }
}

module.exports = new ApprovalService();