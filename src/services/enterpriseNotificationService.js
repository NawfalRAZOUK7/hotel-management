// src/services/enterpriseNotificationService.js - Service Notifications Entreprise
const emailService = require('./emailService');
const smsService = require('./smsService');
const notificationService = require('./notificationService');
const User = require('../models/User');
const Company = require('../models/Company');
const path = require('path');

class EnterpriseNotificationService {
  constructor() {
    this.templates = {
      email: {
        approvalRequest: 'approval-request',
        approvalGranted: 'approval-granted', 
        approvalRejected: 'approval-rejected',
        approvalReminder: 'approval-reminder',
        approvalEscalated: 'approval-escalated',
        approvalDelegated: 'approval-delegated',
        monthlyInvoice: 'enterprise-monthly-invoice',
        paymentReminder: 'payment-reminder',
        paymentConfirmation: 'payment-confirmation',
        invoiceOverdue: 'invoice-overdue',
        employeeInvitation: 'employee-invitation',
        contractExpiry: 'contract-expiry',
        accountSuspension: 'account-suspension',
        weeklyReport: 'weekly-report'
      },
      sms: {
        approvalUrgent: 'approval-urgent',
        paymentDue: 'payment-due',
        accountSuspended: 'account-suspended'
      }
    };
  }

  // ===== NOTIFICATIONS D'APPROBATION =====

  /**
   * Envoyer demande d'approbation
   */
  async sendApprovalRequest(data) {
    try {
      const { 
        approver, 
        requester, 
        booking, 
        amount, 
        purpose, 
        approvalId, 
        urgency = 'medium',
        deadline 
      } = data;

      console.log(`📧 Envoi demande approbation à ${approver.email} - ${amount}€`);

      // Email principal
      const emailData = {
        to: approver.email,
        subject: this.getApprovalSubject(urgency, amount, requester),
        template: this.templates.email.approvalRequest,
        data: {
          approverName: approver.firstName,
          requesterName: `${requester.firstName} ${requester.lastName}`,
          requesterDepartment: requester.department,
          amount: this.formatAmount(amount),
          currency: 'EUR',
          purpose,
          urgencyLevel: urgency,
          urgencyLabel: this.getUrgencyLabel(urgency),
          hotelName: booking?.hotel?.name || 'Non spécifié',
          checkInDate: booking?.checkInDate ? this.formatDate(booking.checkInDate) : null,
          checkOutDate: booking?.checkOutDate ? this.formatDate(booking.checkOutDate) : null,
          deadline: deadline ? this.formatDate(deadline) : null,
          approvalUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approvalId}`,
          approveUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approvalId}?action=approve`,
          rejectUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approvalId}?action=reject`,
          dashboardUrl: `${process.env.FRONTEND_URL}/enterprise/dashboard`,
          pendingUrl: `${process.env.FRONTEND_URL}/enterprise/approvals`
        },
        priority: urgency === 'critical' ? 'high' : 'normal'
      };

      await emailService.sendEmail(emailData);

      // Notification in-app
      await notificationService.sendInAppNotification({
        userId: approver._id,
        type: 'approval_request',
        title: 'Nouvelle demande d\'approbation',
        message: `${requester.firstName} ${requester.lastName} demande votre approbation pour ${this.formatAmount(amount)}€`,
        data: {
          approvalId,
          amount,
          urgency,
          requesterName: `${requester.firstName} ${requester.lastName}`
        },
        urgency: urgency
      });

      // SMS si urgence critique ou montant élevé
      if (urgency === 'critical' || amount > 5000) {
        await this.sendApprovalSMS(approver, requester, amount, approvalId);
      }

      console.log(`✅ Demande d'approbation envoyée avec succès`);

    } catch (error) {
      console.error(`❌ Erreur envoi demande approbation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer approbation accordée
   */
  async sendApprovalGranted(data) {
    try {
      const { requester, approver, booking, approval, comments } = data;

      console.log(`📧 Envoi confirmation approbation à ${requester.email}`);

      const emailData = {
        to: requester.email,
        subject: `✅ Demande approuvée - Réservation ${booking?.reference || 'confirmée'}`,
        template: this.templates.email.approvalGranted,
        data: {
          guestName: requester.firstName,
          approverName: `${approver.firstName} ${approver.lastName}`,
          approverTitle: approver.jobTitle,
          amount: this.formatAmount(approval.financialInfo.totalAmount),
          purpose: approval.businessJustification.purpose,
          hotelName: booking?.hotel?.name,
          bookingReference: booking?.reference,
          checkInDate: booking?.checkInDate ? this.formatDate(booking.checkInDate) : null,
          checkOutDate: booking?.checkOutDate ? this.formatDate(booking.checkOutDate) : null,
          approvedAt: this.formatDateTime(new Date()),
          comments: comments || 'Aucun commentaire',
          bookingUrl: `${process.env.FRONTEND_URL}/bookings/${booking?._id}`,
          dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
        }
      };

      await emailService.sendEmail(emailData);

      // Notification in-app
      await notificationService.sendInAppNotification({
        userId: requester._id,
        type: 'approval_granted',
        title: '✅ Demande approuvée',
        message: `Votre demande de ${this.formatAmount(approval.financialInfo.totalAmount)}€ a été approuvée par ${approver.firstName} ${approver.lastName}`,
        data: {
          approvalId: approval._id,
          bookingId: booking?._id,
          approverName: `${approver.firstName} ${approver.lastName}`
        },
        urgency: 'medium'
      });

    } catch (error) {
      console.error(`❌ Erreur envoi approbation accordée: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer approbation rejetée
   */
  async sendApprovalRejected(data) {
    try {
      const { requester, approver, booking, approval, reason } = data;

      console.log(`📧 Envoi rejet approbation à ${requester.email}`);

      const emailData = {
        to: requester.email,
        subject: `❌ Demande rejetée - ${approval.businessJustification.purpose}`,
        template: this.templates.email.approvalRejected,
        data: {
          guestName: requester.firstName,
          approverName: `${approver.firstName} ${approver.lastName}`,
          approverTitle: approver.jobTitle,
          amount: this.formatAmount(approval.financialInfo.totalAmount),
          purpose: approval.businessJustification.purpose,
          reason: reason || 'Aucune raison spécifiée',
          rejectedAt: this.formatDateTime(new Date()),
          canResubmit: true,
          contactApprover: approver.email,
          newRequestUrl: `${process.env.FRONTEND_URL}/bookings/new`,
          dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`,
          supportUrl: `${process.env.FRONTEND_URL}/support`
        }
      };

      await emailService.sendEmail(emailData);

      // Notification in-app
      await notificationService.sendInAppNotification({
        userId: requester._id,
        type: 'approval_rejected',
        title: '❌ Demande rejetée',
        message: `Votre demande a été rejetée par ${approver.firstName} ${approver.lastName}: ${reason}`,
        data: {
          approvalId: approval._id,
          reason: reason,
          approverName: `${approver.firstName} ${approver.lastName}`
        },
        urgency: 'medium'
      });

    } catch (error) {
      console.error(`❌ Erreur envoi rejet: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer rappel d'approbation
   */
  async sendApprovalReminder(data) {
    try {
      const { approver, approval, daysPending, reminderNumber = 1 } = data;

      console.log(`🔔 Envoi rappel ${reminderNumber} à ${approver.email} - ${daysPending} jours`);

      const emailData = {
        to: approver.email,
        subject: `⏰ Rappel ${reminderNumber} - Approbation en attente (${daysPending} jours)`,
        template: this.templates.email.approvalReminder,
        data: {
          approverName: approver.firstName,
          daysPending,
          reminderNumber,
          requesterName: `${approval.requester.firstName} ${approval.requester.lastName}`,
          amount: this.formatAmount(approval.financialInfo.totalAmount),
          purpose: approval.businessJustification.purpose,
          urgencyLevel: approval.businessJustification.urgencyLevel,
          deadline: approval.timeline.requiredBy ? this.formatDate(approval.timeline.requiredBy) : null,
          isOverdue: approval.isOverdue,
          approvalUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approval._id}`,
          allPendingUrl: `${process.env.FRONTEND_URL}/enterprise/approvals?status=pending`,
          escalationWarning: daysPending >= 2
        },
        priority: daysPending >= 2 ? 'high' : 'normal'
      };

      await emailService.sendEmail(emailData);

      // Notification in-app urgente si > 2 jours
      if (daysPending >= 2) {
        await notificationService.sendInAppNotification({
          userId: approver._id,
          type: 'approval_reminder_urgent',
          title: `⚠️ Approbation urgente (${daysPending} jours)`,
          message: `Demande de ${approval.requester.firstName} ${approval.requester.lastName} en attente depuis ${daysPending} jours`,
          data: {
            approvalId: approval._id,
            daysPending,
            amount: approval.financialInfo.totalAmount
          },
          urgency: 'high'
        });
      }

    } catch (error) {
      console.error(`❌ Erreur rappel approbation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer notification d'escalation
   */
  async sendEscalationNotification(data) {
    try {
      const { target, approval, originalApprover, escalationLevel } = data;

      console.log(`🚨 Envoi escalation niveau ${escalationLevel} à ${target.email}`);

      const emailData = {
        to: target.email,
        subject: `🚨 Escalation Niveau ${escalationLevel} - Approbation urgente requise`,
        template: this.templates.email.approvalEscalated,
        data: {
          targetName: target.firstName,
          escalationLevel,
          originalApproverName: originalApprover ? `${originalApprover.firstName} ${originalApprover.lastName}` : 'Non spécifié',
          requesterName: `${approval.requester.firstName} ${approval.requester.lastName}`,
          amount: this.formatAmount(approval.financialInfo.totalAmount),
          purpose: approval.businessJustification.purpose,
          daysPending: Math.floor((new Date() - approval.createdAt) / (1000 * 60 * 60 * 24)),
          urgencyLevel: 'critical',
          deadline: approval.timeline.requiredBy ? this.formatDate(approval.timeline.requiredBy) : null,
          approvalUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approval._id}`,
          emergencyContact: process.env.SUPPORT_PHONE || '+33 1 XX XX XX XX'
        },
        priority: 'high'
      };

      await emailService.sendEmail(emailData);

      // Notification in-app critique
      await notificationService.sendInAppNotification({
        userId: target._id,
        type: 'approval_escalated',
        title: `🚨 Escalation Niveau ${escalationLevel}`,
        message: `Approbation urgente requise - Escaladée depuis ${originalApprover?.firstName || 'un autre approbateur'}`,
        data: {
          approvalId: approval._id,
          escalationLevel,
          amount: approval.financialInfo.totalAmount
        },
        urgency: 'critical'
      });

      // SMS pour escalations critiques
      if (escalationLevel >= 2) {
        await this.sendEscalationSMS(target, approval, escalationLevel);
      }

    } catch (error) {
      console.error(`❌ Erreur escalation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer notification de délégation
   */
  async sendDelegationNotification(data) {
    try {
      const { delegate, delegator, approval, comments } = data;

      console.log(`🔄 Envoi délégation à ${delegate.email}`);

      const emailData = {
        to: delegate.email,
        subject: `🔄 Délégation d'approbation de ${delegator.firstName} ${delegator.lastName}`,
        template: this.templates.email.approvalDelegated,
        data: {
          delegateName: delegate.firstName,
          delegatorName: `${delegator.firstName} ${delegator.lastName}`,
          delegatorTitle: delegator.jobTitle,
          requesterName: `${approval.requester.firstName} ${approval.requester.lastName}`,
          amount: this.formatAmount(approval.financialInfo.totalAmount),
          purpose: approval.businessJustification.purpose,
          comments: comments || 'Aucun commentaire de délégation',
          delegatedAt: this.formatDateTime(new Date()),
          approvalUrl: `${process.env.FRONTEND_URL}/enterprise/approvals/${approval._id}`,
          contactDelegator: delegator.email
        }
      };

      await emailService.sendEmail(emailData);

      // Notification in-app
      await notificationService.sendInAppNotification({
        userId: delegate._id,
        type: 'approval_delegated',
        title: `🔄 Approbation déléguée`,
        message: `${delegator.firstName} ${delegator.lastName} vous a délégué une approbation de ${this.formatAmount(approval.financialInfo.totalAmount)}€`,
        data: {
          approvalId: approval._id,
          delegatorName: `${delegator.firstName} ${delegator.lastName}`,
          amount: approval.financialInfo.totalAmount
        },
        urgency: 'medium'
      });

    } catch (error) {
      console.error(`❌ Erreur délégation: ${error.message}`);
      throw error;
    }
  }

  // ===== NOTIFICATIONS FACTURATION =====

  /**
   * Envoyer facture mensuelle
   */
  async sendMonthlyInvoice(data) {
    try {
      const { company, invoice, files } = data;

      console.log(`📄 Envoi facture ${invoice.invoiceNumber} à ${company.contact.email}`);

      const emailData = {
        to: company.contact.email,
        cc: company.billing?.alternateEmail ? [company.billing.alternateEmail] : [],
        subject: `Facture ${invoice.invoiceNumber} - ${company.name} - ${this.formatAmount(invoice.financial.totalAmount)}€`,
        template: this.templates.email.monthlyInvoice,
        data: {
          companyName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: this.formatAmount(invoice.financial.totalAmount),
          currency: invoice.financial.currency,
          period: `${this.getMonthName(invoice.period.month)} ${invoice.period.year}`,
          issueDate: this.formatDate(invoice.dates.issueDate),
          dueDate: this.formatDate(invoice.dates.dueDate),
          paymentTerms: company.billing?.paymentTerms || 30,
          bookingCount: invoice.bookings.length,
          departmentCount: invoice.departmentBreakdown.length,
          subtotal: this.formatAmount(invoice.financial.subtotal),
          discountAmount: this.formatAmount(invoice.financial.discountAmount),
          discountRate: invoice.financial.discountRate,
          vatAmount: this.formatAmount(invoice.financial.vatAmount),
          totalAmount: this.formatAmount(invoice.financial.totalAmount),
          paymentInstructions: this.getPaymentInstructions(company),
          invoiceUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}`,
          dashboardUrl: `${process.env.FRONTEND_URL}/enterprise/dashboard`,
          contactSupport: process.env.SUPPORT_EMAIL || 'support@hotel.com'
        },
        attachments: [{
          filename: `Facture-${invoice.invoiceNumber}.pdf`,
          path: files.pdfPath,
          contentType: 'application/pdf'
        }]
      };

      await emailService.sendEmail(emailData);

      // Notifier les admins entreprise
      const companyAdmins = await User.find({
        company: company._id,
        userType: 'company_admin',
        isActive: true
      });

      for (const admin of companyAdmins) {
        await notificationService.sendInAppNotification({
          userId: admin._id,
          type: 'invoice_generated',
          title: `💰 Nouvelle facture disponible`,
          message: `Facture ${invoice.invoiceNumber} générée - ${this.formatAmount(invoice.financial.totalAmount)}€`,
          data: {
            invoiceId: invoice._id,
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.financial.totalAmount
          },
          urgency: 'low'
        });
      }

    } catch (error) {
      console.error(`❌ Erreur envoi facture: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer rappel de paiement
   */
  async sendPaymentReminder(data) {
    try {
      const { invoice, company, daysBefore } = data;

      console.log(`💰 Envoi rappel paiement ${daysBefore}j pour ${invoice.invoiceNumber}`);

      const emailData = {
        to: company.contact.email,
        subject: `💳 Rappel - Facture ${invoice.invoiceNumber} échéance dans ${daysBefore} jour(s)`,
        template: this.templates.email.paymentReminder,
        data: {
          companyName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: this.formatAmount(invoice.financial.totalAmount),
          currency: invoice.financial.currency,
          dueDate: this.formatDate(invoice.dates.dueDate),
          daysBefore,
          isUrgent: daysBefore <= 1,
          paymentInstructions: this.getPaymentInstructions(company),
          invoiceUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}`,
          paymentUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}/payment`,
          contactFinance: process.env.FINANCE_EMAIL || 'finance@hotel.com'
        },
        priority: daysBefore <= 1 ? 'high' : 'normal'
      };

      await emailService.sendEmail(emailData);

      // SMS si échéance demain
      if (daysBefore === 1) {
        await this.sendPaymentReminderSMS(company, invoice);
      }

    } catch (error) {
      console.error(`❌ Erreur rappel paiement: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer confirmation de paiement
   */
  async sendPaymentConfirmation(data) {
    try {
      const { invoice, company } = data;

      console.log(`✅ Envoi confirmation paiement pour ${invoice.invoiceNumber}`);

      const emailData = {
        to: company.contact.email,
        subject: `✅ Paiement reçu - Facture ${invoice.invoiceNumber}`,
        template: this.templates.email.paymentConfirmation,
        data: {
          companyName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: this.formatAmount(invoice.financial.totalAmount),
          currency: invoice.financial.currency,
          paidDate: this.formatDate(invoice.dates.paidDate),
          paymentMethod: this.getPaymentMethodLabel(invoice.payment?.method),
          reference: invoice.payment?.reference,
          receiptUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}/receipt`,
          dashboardUrl: `${process.env.FRONTEND_URL}/enterprise/dashboard`
        }
      };

      await emailService.sendEmail(emailData);

    } catch (error) {
      console.error(`❌ Erreur confirmation paiement: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer notification facture impayée
   */
  async sendOverdueNotification(data) {
    try {
      const { invoice, company, totalOverdue } = data;

      console.log(`⚠️ Envoi notification impayé pour ${invoice.invoiceNumber}`);

      const emailData = {
        to: company.contact.email,
        subject: `🚨 URGENT - Facture impayée ${invoice.invoiceNumber}`,
        template: this.templates.email.invoiceOverdue,
        data: {
          companyName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: this.formatAmount(invoice.financial.totalAmount),
          currency: invoice.financial.currency,
          dueDate: this.formatDate(invoice.dates.dueDate),
          daysOverdue: invoice.daysOverdue,
          totalOverdue: this.formatAmount(totalOverdue),
          interestCharges: this.calculateInterestCharges(invoice),
          suspensionWarning: totalOverdue > company.billing.creditLimit * 0.8,
          paymentUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}/payment`,
          contactUrgent: process.env.FINANCE_PHONE || '+33 1 XX XX XX XX'
        },
        priority: 'high'
      };

      await emailService.sendEmail(emailData);

      // SMS urgent
      await this.sendOverdueSMS(company, invoice);

    } catch (error) {
      console.error(`❌ Erreur notification impayé: ${error.message}`);
      throw error;
    }
  }

  // ===== NOTIFICATIONS EMPLOYÉS =====

  /**
   * Envoyer invitation employé
   */
  async sendEmployeeInvitation(data) {
    try {
      const { employee, company, invitedBy, invitationUrl } = data;

      console.log(`👋 Envoi invitation employé à ${employee.email}`);

      const emailData = {
        to: employee.email,
        subject: `Invitation à rejoindre ${company.name} - Plateforme de réservation`,
        template: this.templates.email.employeeInvitation,
        data: {
          employeeName: employee.firstName,
          companyName: company.name,
          invitedByName: `${invitedBy.firstName} ${invitedBy.lastName}`,
          invitedByTitle: invitedBy.jobTitle,
          department: employee.department,
          jobTitle: employee.jobTitle,
          employeeId: employee.employeeId,
          invitationUrl,
          expiryDate: this.formatDate(employee.invitationExpires),
          platformFeatures: [
            'Réservation d\'hôtels en ligne',
            'Gestion des demandes d\'approbation',
            'Suivi des dépenses et budgets',
            'Accès mobile 24/7'
          ],
          supportEmail: process.env.SUPPORT_EMAIL || 'support@hotel.com',
          helpUrl: `${process.env.FRONTEND_URL}/help`
        }
      };

      await emailService.sendEmail(emailData);

    } catch (error) {
      console.error(`❌ Erreur invitation employé: ${error.message}`);
      throw error;
    }
  }

  // ===== NOTIFICATIONS ADMINISTRATIVES =====

  /**
   * Envoyer alerte expiration contrat
   */
  async sendContractExpiryAlert(data) {
    try {
      const { company, daysToExpiry } = data;

      console.log(`📅 Alerte expiration contrat ${company.name} - ${daysToExpiry} jours`);

      // Notifier le commercial assigné
      if (company.assignedSalesRep) {
        const emailData = {
          to: company.assignedSalesRep.email,
          subject: `⚠️ Contrat ${company.name} expire dans ${daysToExpiry} jours`,
          template: this.templates.email.contractExpiry,
          data: {
            salesRepName: company.assignedSalesRep.firstName,
            companyName: company.name,
            contractEndDate: this.formatDate(company.contract.endDate),
            daysToExpiry,
            isUrgent: daysToExpiry <= 30,
            contractValue: company.statistics.totalSpent,
            renewalUrl: `${process.env.ADMIN_URL}/companies/${company._id}/contract`,
            contactPerson: company.contact.contactPerson?.firstName || 'Non spécifié'
          },
          priority: daysToExpiry <= 30 ? 'high' : 'normal'
        };

        await emailService.sendEmail(emailData);
      }

      // Notifier l'entreprise
      const companyEmailData = {
        to: company.contact.email,
        subject: `📋 Votre contrat expire dans ${daysToExpiry} jours`,
        template: 'contract-expiry-client',
        data: {
          companyName: company.name,
          contractEndDate: this.formatDate(company.contract.endDate),
          daysToExpiry,
          renewalContact: company.assignedSalesRep?.email || process.env.SALES_EMAIL
        }
      };

      await emailService.sendEmail(companyEmailData);

    } catch (error) {
      console.error(`❌ Erreur alerte contrat: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer notification suspension compte
   */
  async sendAccountSuspensionNotification(data) {
    try {
      const { user, reason } = data;

      console.log(`🚫 Notification suspension à ${user.email}`);

      const emailData = {
        to: user.email,
        subject: `🚫 Compte suspendu - ${reason}`,
        template: this.templates.email.accountSuspension,
        data: {
          userName: user.firstName,
          reason,
          suspendedAt: this.formatDateTime(new Date()),
          contactSupport: process.env.SUPPORT_EMAIL || 'support@hotel.com',
          supportPhone: process.env.SUPPORT_PHONE || '+33 1 XX XX XX XX',
          canAppeal: true,
          appealUrl: `${process.env.FRONTEND_URL}/support/appeal`
        },
        priority: 'high'
      };

      await emailService.sendEmail(emailData);

      // Notification in-app
      await notificationService.sendInAppNotification({
        userId: user._id,
        type: 'account_suspended',
        title: '🚫 Compte suspendu',
        message: `Votre compte a été suspendu: ${reason}`,
        data: { reason },
        urgency: 'critical'
      });

    } catch (error) {
      console.error(`❌ Erreur suspension: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer rapport hebdomadaire
   */
  async sendWeeklyReport(data) {
    try {
      const { company, report } = data;

      console.log(`📊 Envoi rapport hebdomadaire à ${company.name}`);

      // Trouver les destinataires (admins + managers)
      const recipients = await User.find({
        company: company._id,
        userType: { $in: ['company_admin', 'manager'] },
        'permissions.canViewReports': true,
        isActive: true
      });

      for (const recipient of recipients) {
        const emailData = {
          to: recipient.email,
          subject: `📊 Rapport hebdomadaire - ${company.name}`,
          template: this.templates.email.weeklyReport,
          data: {
            recipientName: recipient.firstName,
            companyName: company.name,
            weekPeriod: report.period,
            summary: {
              totalBookings: report.bookings.total,
              totalAmount: this.formatAmount(report.bookings.amount),
              approvals: report.approvals,
              topSpender: report.topSpender,
              savings: this.formatAmount(report.savings)
            },
            trends: report.trends,
            dashboardUrl: `${process.env.FRONTEND_URL}/enterprise/dashboard`,
            detailedReportUrl: `${process.env.FRONTEND_URL}/enterprise/reports/weekly`
          }
        };

        await emailService.sendEmail(emailData);
      }

    } catch (error) {
      console.error(`❌ Erreur rapport hebdomadaire: ${error.message}`);
      throw error;
    }
  }

  // ===== NOTIFICATIONS SMS =====

  /**
   * Envoyer SMS d'approbation urgente
   */
  async sendApprovalSMS(approver, requester, amount, approvalId) {
    try {
      if (!approver.phone || !approver.preferences?.notifications?.sms) {
        return; // SMS désactivé
      }

      const message = `🏨 APPROBATION URGENTE: ${requester.firstName} ${requester.lastName} demande votre approbation pour ${this.formatAmount(amount)}€. Répondez OUI ou NON au ${process.env.SMS_REPLY_NUMBER}`;

      await smsService.sendSMS({
        to: approver.phone,
        message,
        type: this.templates.sms.approvalUrgent,
        data: { approvalId, amount }
      });

      console.log(`📱 SMS approbation envoyé à ${approver.phone}`);

    } catch (error) {
      console.error(`❌ Erreur SMS approbation: ${error.message}`);
    }
  }

  /**
   * Envoyer SMS d'escalation
   */
  async sendEscalationSMS(target, approval, escalationLevel) {
    try {
      if (!target.phone || !target.preferences?.notifications?.sms) {
        return;
      }

      const message = `🚨 ESCALATION NIVEAU ${escalationLevel}: Approbation urgente requise pour ${this.formatAmount(approval.financialInfo.totalAmount)}€. Connectez-vous immédiatement: ${process.env.FRONTEND_URL}`;

      await smsService.sendSMS({
        to: target.phone,
        message,
        type: 'escalation',
        data: { approvalId: approval._id, escalationLevel }
      });

      console.log(`📱 SMS escalation envoyé à ${target.phone}`);

    } catch (error) {
      console.error(`❌ Erreur SMS escalation: ${error.message}`);
    }
  }

  /**
   * Envoyer SMS rappel paiement
   */
  async sendPaymentReminderSMS(company, invoice) {
    try {
      const phone = company.contact.phone;
      if (!phone) return;

      const message = `💳 RAPPEL: Facture ${invoice.invoiceNumber} de ${this.formatAmount(invoice.financial.totalAmount)}€ échoit demain. Payez sur: ${process.env.FRONTEND_URL}/pay/${invoice._id}`;

      await smsService.sendSMS({
        to: phone,
        message,
        type: this.templates.sms.paymentDue,
        data: { invoiceId: invoice._id }
      });

      console.log(`📱 SMS rappel paiement envoyé à ${phone}`);

    } catch (error) {
      console.error(`❌ Erreur SMS paiement: ${error.message}`);
    }
  }

  /**
   * Envoyer SMS facture impayée
   */
  async sendOverdueSMS(company, invoice) {
    try {
      const phone = company.contact.phone;
      if (!phone) return;

      const message = `🚨 URGENT: Facture ${invoice.invoiceNumber} impayée depuis ${invoice.daysOverdue} jour(s). Risque de suspension. Contactez-nous: ${process.env.SUPPORT_PHONE}`;

      await smsService.sendSMS({
        to: phone,
        message,
        type: this.templates.sms.accountSuspended,
        data: { invoiceId: invoice._id }
      });

      console.log(`📱 SMS impayé envoyé à ${phone}`);

    } catch (error) {
      console.error(`❌ Erreur SMS impayé: ${error.message}`);
    }
  }

  // ===== NOTIFICATIONS GROUPÉES =====

  /**
   * Envoyer notifications à toute l'équipe
   */
  async sendTeamNotification(companyId, notification) {
    try {
      const users = await User.find({
        company: companyId,
        isActive: true
      });

      console.log(`📢 Envoi notification équipe à ${users.length} utilisateurs`);

      const promises = users.map(user => 
        notificationService.sendInAppNotification({
          userId: user._id,
          ...notification
        })
      );

      await Promise.allSettled(promises);

    } catch (error) {
      console.error(`❌ Erreur notification équipe: ${error.message}`);
      throw error;
    }
  }

  /**
   * Envoyer notifications aux managers
   */
  async sendManagerNotification(companyId, notification) {
    try {
      const managers = await User.find({
        company: companyId,
        userType: { $in: ['manager', 'company_admin'] },
        isActive: true
      });

      console.log(`👔 Envoi notification managers à ${managers.length} utilisateurs`);

      const promises = managers.map(manager => 
        notificationService.sendInAppNotification({
          userId: manager._id,
          ...notification
        })
      );

      await Promise.allSettled(promises);

    } catch (error) {
      console.error(`❌ Erreur notification managers: ${error.message}`);
      throw error;
    }
  }

  // ===== MÉTHODES UTILITAIRES =====

  /**
   * Générer sujet d'email d'approbation selon urgence
   */
  getApprovalSubject(urgency, amount, requester) {
    const urgencyEmoji = {
      low: '📝',
      medium: '⏰',
      high: '🚨',
      critical: '🔥'
    };

    const emoji = urgencyEmoji[urgency] || '📝';
    return `${emoji} Approbation ${urgency.toUpperCase()} - ${requester.firstName} ${requester.lastName} - ${this.formatAmount(amount)}€`;
  }

  /**
   * Obtenir label d'urgence
   */
  getUrgencyLabel(urgency) {
    const labels = {
      low: 'Faible',
      medium: 'Normale',
      high: 'Élevée',
      critical: 'Critique'
    };
    return labels[urgency] || 'Normale';
  }

  /**
   * Obtenir instructions de paiement
   */
  getPaymentInstructions(company) {
    const method = company.billing?.preferredPaymentMethod || 'bank_transfer';
    
    const instructions = {
      bank_transfer: {
        title: 'Virement bancaire',
        details: [
          'IBAN: FR76 1234 5678 9012 3456 7890 123',
          'BIC: BANKFRPP',
          `Référence: ${company.name} - À mentionner obligatoirement`
        ]
      },
      credit_card: {
        title: 'Carte bancaire',
        details: [
          'Paiement sécurisé en ligne',
          'Cartes acceptées: Visa, Mastercard, Amex',
          'Paiement immédiat'
        ]
      },
      check: {
        title: 'Chèque',
        details: [
          'À l\'ordre de: HOTEL MANAGEMENT SAS',
          'Adresse: 123 Rue de la Paix, 75001 Paris',
          'Mentionner le numéro de facture au dos'
        ]
      }
    };

    return instructions[method] || instructions.bank_transfer;
  }

  /**
   * Obtenir label méthode de paiement
   */
  getPaymentMethodLabel(method) {
    const labels = {
      bank_transfer: 'Virement bancaire',
      credit_card: 'Carte bancaire',
      check: 'Chèque',
      cash: 'Espèces',
      direct_debit: 'Prélèvement automatique'
    };
    return labels[method] || 'Non spécifiée';
  }

  /**
   * Calculer intérêts de retard
   */
  calculateInterestCharges(invoice) {
    if (!invoice.daysOverdue || invoice.daysOverdue <= 0) return 0;
    
    const principal = invoice.financial.totalAmount;
    const dailyRate = 0.03 / 100; // 3% annuel / 365 jours
    const interest = principal * dailyRate * invoice.daysOverdue;
    
    return this.roundAmount(interest);
  }

  /**
   * Obtenir nom du mois en français
   */
  getMonthName(monthNumber) {
    const months = [
      'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
      'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'
    ];
    return months[monthNumber - 1] || 'Mois inconnu';
  }

  /**
   * Formater montant
   */
  formatAmount(amount) {
    return new Intl.NumberFormat('fr-FR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount || 0);
  }

  /**
   * Arrondir montant
   */
  roundAmount(amount) {
    return Math.round((Number(amount) || 0) * 100) / 100;
  }

  /**
   * Formater date
   */
  formatDate(date) {
    if (!date) return null;
    return new Date(date).toLocaleDateString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  /**
   * Formater date et heure
   */
  formatDateTime(date) {
    if (!date) return null;
    return new Date(date).toLocaleString('fr-FR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }

  /**
   * Formater durée relative
   */
  formatRelativeTime(date) {
    if (!date) return null;
    
    const now = new Date();
    const diff = now - new Date(date);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
    if (hours > 0) return `il y a ${hours} heure${hours > 1 ? 's' : ''}`;
    if (minutes > 0) return `il y a ${minutes} minute${minutes > 1 ? 's' : ''}`;
    return 'À l\'instant';
  }

  // ===== MÉTHODES DE BATCH =====

  /**
   * Envoyer notifications en lot avec gestion d'erreurs
   */
  async sendBatchNotifications(notifications) {
    const results = {
      success: 0,
      failed: 0,
      errors: []
    };

    for (const notification of notifications) {
      try {
        switch (notification.type) {
          case 'approval_request':
            await this.sendApprovalRequest(notification.data);
            break;
          case 'payment_reminder':
            await this.sendPaymentReminder(notification.data);
            break;
          case 'invoice_overdue':
            await this.sendOverdueNotification(notification.data);
            break;
          default:
            throw new Error(`Type de notification non supporté: ${notification.type}`);
        }
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          notification: notification.id || 'unknown',
          error: error.message
        });
        console.error(`❌ Erreur notification batch: ${error.message}`);
      }
    }

    console.log(`📊 Batch terminé: ${results.success} succès, ${results.failed} erreurs`);
    return results;
  }

  /**
   * Envoyer rappels programmés
   */
  async sendScheduledReminders() {
    try {
      const now = new Date();
      
      // Rappels d'approbation
      const overdueApprovals = await this.getOverdueApprovals();
      for (const approval of overdueApprovals) {
        await this.sendApprovalReminder({
          approver: approval.currentApprover,
          approval,
          daysPending: Math.floor((now - approval.createdAt) / (1000 * 60 * 60 * 24))
        });
      }

      // Rappels de paiement
      const upcomingPayments = await this.getUpcomingPayments();
      for (const payment of upcomingPayments) {
        const daysUntilDue = Math.ceil((payment.dueDate - now) / (1000 * 60 * 60 * 24));
        if ([7, 3, 1].includes(daysUntilDue)) {
          await this.sendPaymentReminder({
            invoice: payment,
            company: payment.company,
            daysBefore: daysUntilDue
          });
        }
      }

      console.log(`⏰ Rappels programmés envoyés`);

    } catch (error) {
      console.error(`❌ Erreur rappels programmés: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtenir approbations en retard
   */
  async getOverdueApprovals() {
    const ApprovalRequest = require('../models/ApprovalRequest');
    return await ApprovalRequest.find({
      finalStatus: 'pending',
      'timeline.requiredBy': { $lt: new Date() }
    }).populate('approvalChain.approver requester');
  }

  /**
   * Obtenir paiements à venir
   */
  async getUpcomingPayments() {
    const Invoice = require('../models/Invoice');
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);

    return await Invoice.find({
      status: 'sent',
      'dates.dueDate': { $lte: nextWeek, $gte: new Date() }
    }).populate('company');
  }

  // ===== MÉTRIQUES ET ANALYTICS =====

  /**
   * Obtenir statistiques de notifications
   */
  async getNotificationStats(companyId, startDate, endDate) {
    try {
      // Cette méthode nécessiterait un modèle NotificationLog
      // pour tracker les notifications envoyées
      
      return {
        sent: {
          emails: 0,
          sms: 0,
          inApp: 0
        },
        types: {
          approvals: 0,
          invoices: 0,
          reminders: 0,
          alerts: 0
        },
        success_rate: 95.5,
        avg_response_time: '2.3 heures'
      };

    } catch (error) {
      console.error(`❌ Erreur stats notifications: ${error.message}`);
      throw error;
    }
  }

  /**
   * Obtenir préférences de notification utilisateur
   */
  async getUserNotificationPreferences(userId) {
    try {
      const user = await User.findById(userId);
      if (!user) throw new Error('Utilisateur introuvable');

      return {
        email: user.preferences?.notifications?.email ?? true,
        sms: user.preferences?.notifications?.sms ?? false,
        inApp: user.preferences?.notifications?.inApp ?? true,
        frequency: user.enterpriseSettings?.notifications?.frequency || 'immediate',
        quiet_hours: {
          enabled: false,
          start: '22:00',
          end: '08:00'
        }
      };

    } catch (error) {
      console.error(`❌ Erreur préférences: ${error.message}`);
      throw error;
    }
  }

  /**
   * Mettre à jour préférences de notification
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      await User.findByIdAndUpdate(userId, {
        'preferences.notifications': {
          email: preferences.email ?? true,
          sms: preferences.sms ?? false,
          inApp: preferences.inApp ?? true
        },
        'enterpriseSettings.notifications': {
          frequency: preferences.frequency || 'immediate',
          approvalRequests: preferences.approvalRequests ?? true,
          teamBookings: preferences.teamBookings ?? false,
          budgetAlerts: preferences.budgetAlerts ?? true,
          contractUpdates: preferences.contractUpdates ?? true
        }
      });

      console.log(`✅ Préférences mises à jour pour utilisateur ${userId}`);

    } catch (error) {
      console.error(`❌ Erreur mise à jour préférences: ${error.message}`);
      throw error;
    }
  }

  // ===== TEMPLATES ET PERSONNALISATION =====

  /**
   * Obtenir template personnalisé pour entreprise
   */
  getCustomTemplate(companyId, templateType) {
    // Ici vous pourriez avoir des templates personnalisés par entreprise
    // stockés en base de données ou dans des fichiers
    return this.templates.email[templateType];
  }

  /**
   * Valider données de notification
   */
  validateNotificationData(type, data) {
    const requiredFields = {
      approval_request: ['approver', 'requester', 'amount', 'purpose'],
      monthly_invoice: ['company', 'invoice', 'files'],
      payment_reminder: ['invoice', 'company', 'daysBefore'],
      employee_invitation: ['employee', 'company', 'invitedBy']
    };

    const required = requiredFields[type];
    if (!required) {
      throw new Error(`Type de notification non supporté: ${type}`);
    }

    for (const field of required) {
      if (!data[field]) {
        throw new Error(`Champ requis manquant: ${field}`);
      }
    }

    return true;
  }
}

module.exports = new EnterpriseNotificationService();