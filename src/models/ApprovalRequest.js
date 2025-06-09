// models/ApprovalRequest.js - Modèle Workflow d'Approbation Complet
const mongoose = require('mongoose');

const approvalRequestSchema = new mongoose.Schema({
  // ===== RÉFÉRENCES PRINCIPALES =====
  booking: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Booking', 
    required: [true, 'La réservation est requise'],
    unique: true // Une seule demande d'approbation par réservation
  },
  
  requester: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: [true, 'Le demandeur est requis']
  },
  
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: [true, 'L\'entreprise est requise']
  },

  // ===== CHAÎNE D'APPROBATION =====
  approvalChain: [{
    // Approbateur pour ce niveau
    approver: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User',
      required: true
    },
    
    // Niveau dans la hiérarchie (1, 2, 3...)
    level: { 
      type: Number, 
      required: true,
      min: [1, 'Le niveau doit être au minimum 1'],
      max: [10, 'Le niveau ne peut excéder 10']
    },
    
    // Statut de cette étape
    status: { 
      type: String, 
      enum: ['pending', 'approved', 'rejected', 'skipped'], 
      default: 'pending' 
    },
    
    // Dates importantes
    assignedAt: { 
      type: Date, 
      default: Date.now 
    },
    
    approvedAt: Date,
    
    // Commentaires de l'approbateur
    comments: {
      type: String,
      maxlength: [1000, 'Les commentaires ne peuvent excéder 1000 caractères']
    },
    
    // Quand l'approbateur a été notifié
    notifiedAt: Date,
    
    // Nombre de rappels envoyés
    reminderCount: { 
      type: Number, 
      default: 0 
    },
    
    // Dernier rappel envoyé
    lastReminderAt: Date,
    
    // Délégation (si l'approbation a été déléguée)
    delegatedTo: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    
    delegatedAt: Date,
    
    // Urgence de cette étape
    urgency: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium'
    }
  }],
  
  // ===== ÉTAT GLOBAL =====
  currentLevel: { 
    type: Number, 
    default: 1,
    min: [1, 'Le niveau actuel doit être au minimum 1']
  },
  
  finalStatus: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected', 'cancelled', 'expired'], 
    default: 'pending',
    index: true
  },
  
  // ===== JUSTIFICATION MÉTIER =====
  businessJustification: {
    // Objet du voyage/réservation
    purpose: { 
      type: String, 
      required: [true, 'L\'objet de la réservation est requis'],
      maxlength: [500, 'L\'objet ne peut excéder 500 caractères']
    },
    
    // Bénéfice attendu
    expectedBenefit: {
      type: String,
      maxlength: [1000, 'Le bénéfice attendu ne peut excéder 1000 caractères']
    },
    
    // Niveau d'urgence
    urgencyLevel: { 
      type: String, 
      enum: ['low', 'medium', 'high', 'critical'], 
      default: 'medium' 
    },
    
    // Raison de l'urgence
    urgencyReason: {
      type: String,
      maxlength: [500, 'La raison d\'urgence ne peut excéder 500 caractères']
    },
    
    // Client/projet concerné
    clientName: String,
    projectName: String,
    
    // Alternative considérées
    alternativesConsidered: {
      type: String,
      maxlength: [1000, 'Les alternatives ne peuvent excéder 1000 caractères']
    },
    
    // Impact si refusé
    impactIfRejected: {
      type: String,
      maxlength: [1000, 'L\'impact ne peut excéder 1000 caractères']
    }
  },
  
  // ===== INFORMATIONS FINANCIÈRES =====
  financialInfo: {
    // Montant total de la réservation
    totalAmount: { 
      type: Number, 
      required: [true, 'Le montant total est requis'],
      min: [0, 'Le montant ne peut être négatif']
    },
    
    // Devise
    currency: {
      type: String,
      enum: ['EUR', 'USD', 'GBP', 'CHF'],
      default: 'EUR'
    },
    
    // Code budgétaire
    budgetCode: {
      type: String,
      maxlength: [50, 'Le code budget ne peut excéder 50 caractères']
    },
    
    // Centre de coût
    costCenter: {
      type: String,
      maxlength: [50, 'Le centre de coût ne peut excéder 50 caractères']
    },
    
    // Code projet
    projectCode: {
      type: String,
      maxlength: [50, 'Le code projet ne peut excéder 50 caractères']
    },
    
    // Budget disponible
    availableBudget: {
      type: Number,
      min: [0, 'Le budget disponible ne peut être négatif']
    },
    
    // Pourcentage du budget utilisé
    budgetUtilization: {
      type: Number,
      min: [0, 'L\'utilisation budget ne peut être négative'],
      max: [100, 'L\'utilisation budget ne peut excéder 100%']
    },
    
    // Détail des coûts
    breakdown: {
      accommodation: Number,
      taxes: Number,
      extras: Number,
      fees: Number
    },
    
    // Remises appliquées
    discounts: [{
      type: String, // 'corporate', 'volume', 'seasonal', 'promotional'
      amount: Number,
      percentage: Number,
      description: String
    }]
  },
  
  // ===== CHRONOLOGIE =====
  timeline: {
    // Quand la demande a été créée
    requestedAt: { 
      type: Date, 
      default: Date.now 
    },
    
    // Date limite pour approbation
    requiredBy: {
      type: Date,
      required: [true, 'La date limite est requise']
    },
    
    // Date d'approbation finale
    approvedAt: Date,
    
    // Date de rejet
    rejectedAt: Date,
    
    // Date d'expiration
    expiredAt: Date,
    
    // Date d'annulation
    cancelledAt: Date,
    
    // Première notification envoyée
    firstNotificationAt: Date,
    
    // Dernière activité
    lastActivityAt: { 
      type: Date, 
      default: Date.now 
    },
    
    // Temps total de traitement (en minutes)
    processingTime: Number,
    
    // SLA (Service Level Agreement) en heures
    slaTarget: {
      type: Number,
      default: 24 // 24h par défaut
    },
    
    // SLA respecté ?
    slaCompliant: Boolean
  },
  
  // ===== ESCALATION =====
  escalation: {
    // Escaladé automatiquement ?
    isEscalated: { 
      type: Boolean, 
      default: false 
    },
    
    // Date d'escalation
    escalatedAt: Date,
    
    // Niveau d'escalation (1, 2, 3...)
    escalationLevel: {
      type: Number,
      default: 0,
      min: [0, 'Le niveau d\'escalation ne peut être négatif']
    },
    
    // Raison de l'escalation
    escalationReason: {
      type: String,
      enum: ['timeout', 'manual', 'high_amount', 'repeated_rejection', 'system'],
      default: 'timeout'
    },
    
    // Escaladé vers qui
    escalatedTo: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    
    // Historique des escalations
    escalationHistory: [{
      level: Number,
      escalatedAt: Date,
      escalatedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      reason: String,
      resolvedAt: Date
    }]
  },
  
  // ===== ATTACHMENTS =====
  attachments: [{
    // Type de document
    type: {
      type: String,
      enum: ['quote', 'invoice', 'receipt', 'authorization', 'other'],
      required: true
    },
    
    // Nom du fichier
    filename: {
      type: String,
      required: true,
      maxlength: [255, 'Le nom de fichier ne peut excéder 255 caractères']
    },
    
    // URL ou path du fichier
    url: {
      type: String,
      required: true
    },
    
    // Taille en bytes
    size: {
      type: Number,
      min: [0, 'La taille ne peut être négative']
    },
    
    // Type MIME
    mimeType: String,
    
    // Qui a uploadé
    uploadedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    
    uploadedAt: { 
      type: Date, 
      default: Date.now 
    },
    
    // Description
    description: {
      type: String,
      maxlength: [500, 'La description ne peut excéder 500 caractères']
    }
  }],
  
  // ===== COMMUNICATION =====
  communications: [{
    // Type de communication
    type: {
      type: String,
      enum: ['email', 'sms', 'in_app', 'phone', 'meeting'],
      required: true
    },
    
    // Direction
    direction: {
      type: String,
      enum: ['inbound', 'outbound'],
      required: true
    },
    
    // Expéditeur
    from: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    
    // Destinataire
    to: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'User' 
    },
    
    // Sujet/Titre
    subject: String,
    
    // Contenu
    content: {
      type: String,
      maxlength: [2000, 'Le contenu ne peut excéder 2000 caractères']
    },
    
    // Date d'envoi
    sentAt: { 
      type: Date, 
      default: Date.now 
    },
    
    // Date de lecture
    readAt: Date,
    
    // Statut de livraison
    deliveryStatus: {
      type: String,
      enum: ['pending', 'sent', 'delivered', 'read', 'failed'],
      default: 'pending'
    },
    
    // Template utilisé
    template: String,
    
    // ID externe (pour tracking)
    externalId: String
  }],
  
  // ===== RÈGLES MÉTIER =====
  rules: {
    // Auto-approbation possible ?
    allowAutoApproval: { 
      type: Boolean, 
      default: false 
    },
    
    // Montant auto-approbation
    autoApprovalThreshold: {
      type: Number,
      default: 0,
      min: [0, 'Le seuil ne peut être négatif']
    },
    
    // Approbation parallèle (tous les niveaux en même temps)
    parallelApproval: { 
      type: Boolean, 
      default: false 
    },
    
    // Consensus requis (tous doivent approuver)
    requireConsensus: { 
      type: Boolean, 
      default: false 
    },
    
    // Nombre minimum d'approbations
    minimumApprovals: {
      type: Number,
      default: 1,
      min: [1, 'Au moins une approbation est requise']
    },
    
    // Délai d'escalation automatique (en heures)
    autoEscalationDelay: {
      type: Number,
      default: 24,
      min: [1, 'Le délai minimum est 1 heure']
    },
    
    // Remplacements automatiques des approbateurs absents
    autoSubstitution: { 
      type: Boolean, 
      default: true 
    }
  },
  
  // ===== MÉTADONNÉES =====
  metadata: {
    // Source de la demande
    source: {
      type: String,
      enum: ['web', 'mobile', 'api', 'import', 'system'],
      default: 'web'
    },
    
    // User agent / device info
    userAgent: String,
    
    // IP address
    ipAddress: String,
    
    // Version de l'application
    appVersion: String,
    
    // Référence externe
    externalReference: String,
    
    // Tags pour classification
    tags: [String],
    
    // Priorité système
    systemPriority: {
      type: Number,
      default: 5,
      min: [1, 'Priorité minimum: 1'],
      max: [10, 'Priorité maximum: 10']
    },
    
    // Flags spéciaux
    flags: {
      isTestRequest: { type: Boolean, default: false },
      isUrgent: { type: Boolean, default: false },
      requiresSpecialApproval: { type: Boolean, default: false },
      hasComplexRules: { type: Boolean, default: false }
    }
  }
  
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      delete ret.__v;
      return ret;
    }
  },
  toObject: { virtuals: true }
});

// ============================================================================
// INDEXES POUR PERFORMANCE
// ============================================================================

// Index principaux
approvalRequestSchema.index({ company: 1, finalStatus: 1 });
approvalRequestSchema.index({ requester: 1, createdAt: -1 });
approvalRequestSchema.index({ 'approvalChain.approver': 1, 'approvalChain.status': 1 });
approvalRequestSchema.index({ finalStatus: 1, 'timeline.requiredBy': 1 });
approvalRequestSchema.index({ createdAt: -1 });

// Index composés pour requêtes complexes
approvalRequestSchema.index({ 
  company: 1, 
  finalStatus: 1, 
  'businessJustification.urgencyLevel': 1 
});

approvalRequestSchema.index({
  'financialInfo.totalAmount': 1,
  'timeline.requestedAt': -1
});

// Index pour escalation
approvalRequestSchema.index({ 
  'escalation.isEscalated': 1, 
  'escalation.escalationLevel': 1 
});

// Index pour recherche full-text
approvalRequestSchema.index({
  'businessJustification.purpose': 'text',
  'businessJustification.expectedBenefit': 'text',
  'financialInfo.projectCode': 'text'
});

// ============================================================================
// VIRTUALS
// ============================================================================

// Approbateur actuel
approvalRequestSchema.virtual('currentApprover').get(function() {
  const currentStep = this.approvalChain.find(step => step.level === this.currentLevel);
  return currentStep ? currentStep.approver : null;
});

// Étape actuelle
approvalRequestSchema.virtual('currentStep').get(function() {
  return this.approvalChain.find(step => step.level === this.currentLevel);
});

// Temps restant avant expiration
approvalRequestSchema.virtual('timeRemaining').get(function() {
  if (!this.timeline.requiredBy) return null;
  const now = new Date();
  const remaining = this.timeline.requiredBy.getTime() - now.getTime();
  return Math.max(0, Math.floor(remaining / (1000 * 60 * 60))); // en heures
});

// Est en retard ?
approvalRequestSchema.virtual('isOverdue').get(function() {
  return this.timeline.requiredBy && new Date() > this.timeline.requiredBy;
});

// Temps écoulé depuis création
approvalRequestSchema.virtual('ageInHours').get(function() {
  const now = new Date();
  const created = this.timeline.requestedAt || this.createdAt;
  return Math.floor((now.getTime() - created.getTime()) / (1000 * 60 * 60));
});

// Progression en pourcentage
approvalRequestSchema.virtual('progressPercentage').get(function() {
  if (this.finalStatus === 'approved') return 100;
  if (this.finalStatus === 'rejected' || this.finalStatus === 'cancelled') return 0;
  
  const totalLevels = this.approvalChain.length;
  const completedLevels = this.approvalChain.filter(step => 
    step.status === 'approved' || step.status === 'skipped'
  ).length;
  
  return totalLevels > 0 ? Math.floor((completedLevels / totalLevels) * 100) : 0;
});

// Relations virtuelles
approvalRequestSchema.virtual('requesterDetails', {
  ref: 'User',
  localField: 'requester',
  foreignField: '_id',
  justOne: true
});

approvalRequestSchema.virtual('companyDetails', {
  ref: 'Company',
  localField: 'company',
  foreignField: '_id',
  justOne: true
});

approvalRequestSchema.virtual('bookingDetails', {
  ref: 'Booking',
  localField: 'booking',
  foreignField: '_id',
  justOne: true
});

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Pre-save middleware
approvalRequestSchema.pre('save', function(next) {
  // Mettre à jour lastActivityAt
  this.timeline.lastActivityAt = new Date();
  
  // Calculer le temps de traitement si finalisé
  if (this.finalStatus !== 'pending' && !this.timeline.processingTime) {
    const start = this.timeline.requestedAt || this.createdAt;
    const end = this.timeline.approvedAt || this.timeline.rejectedAt || new Date();
    this.timeline.processingTime = Math.floor((end.getTime() - start.getTime()) / (1000 * 60));
  }
  
  // Vérifier SLA compliance
  if (this.timeline.processingTime && this.timeline.slaTarget) {
    const slaMinutes = this.timeline.slaTarget * 60;
    this.timeline.slaCompliant = this.timeline.processingTime <= slaMinutes;
  }
  
  // Mettre à jour les flags d'urgence
  if (this.businessJustification.urgencyLevel === 'critical' || 
      this.businessJustification.urgencyLevel === 'high') {
    this.metadata.flags.isUrgent = true;
  }
  
  next();
});

// Pre-validate middleware
approvalRequestSchema.pre('validate', function(next) {
  // Vérifier que requiredBy est dans le futur
  if (this.timeline.requiredBy && this.timeline.requiredBy <= new Date()) {
    return next(new Error('La date limite doit être dans le futur'));
  }
  
  // Vérifier la cohérence de la chaîne d'approbation
  if (this.approvalChain && this.approvalChain.length > 0) {
    const levels = this.approvalChain.map(step => step.level).sort((a, b) => a - b);
    for (let i = 0; i < levels.length; i++) {
      if (levels[i] !== i + 1) {
        return next(new Error('Les niveaux d\'approbation doivent être consécutifs en commençant par 1'));
      }
    }
  }
  
  next();
});

// Post-save middleware
approvalRequestSchema.post('save', function(doc) {
  // Log pour audit
  console.log(`Demande d'approbation ${doc._id} mise à jour - Statut: ${doc.finalStatus}`);
});

// ============================================================================
// MÉTHODES D'INSTANCE
// ============================================================================

// Obtenir l'étape actuelle
approvalRequestSchema.methods.getCurrentStep = function() {
  return this.approvalChain.find(step => step.level === this.currentLevel);
};

// Obtenir l'approbateur actuel
approvalRequestSchema.methods.getCurrentApprover = function() {
  const currentStep = this.getCurrentStep();
  return currentStep ? currentStep.approver : null;
};

// Passer au niveau suivant
approvalRequestSchema.methods.moveToNextLevel = function() {
  const nextLevel = this.currentLevel + 1;
  const nextStep = this.approvalChain.find(step => step.level === nextLevel);
  
  if (nextStep) {
    this.currentLevel = nextLevel;
    return true;
  }
  
  return false; // Plus de niveaux
};

// Approuver à un niveau
approvalRequestSchema.methods.approveAtLevel = function(level, approverId, comments = '') {
  const step = this.approvalChain.find(s => s.level === level);
  
  if (!step) {
    throw new Error(`Niveau ${level} introuvable`);
  }
  
  if (!step.approver.equals(approverId)) {
    throw new Error('Utilisateur non autorisé pour ce niveau');
  }
  
  step.status = 'approved';
  step.approvedAt = new Date();
  step.comments = comments;
  
  // Enregistrer communication
  this.communications.push({
    type: 'in_app',
    direction: 'inbound',
    from: approverId,
    subject: 'Approbation accordée',
    content: comments || 'Demande approuvée'
  });
  
  return this.save();
};

// Rejeter la demande
approvalRequestSchema.methods.reject = function(approverId, reason) {
  const currentStep = this.getCurrentStep();
  
  if (!currentStep || !currentStep.approver.equals(approverId)) {
    throw new Error('Utilisateur non autorisé pour rejeter');
  }
  
  currentStep.status = 'rejected';
  currentStep.approvedAt = new Date();
  currentStep.comments = reason;
  
  this.finalStatus = 'rejected';
  this.timeline.rejectedAt = new Date();
  
  // Enregistrer communication
  this.communications.push({
    type: 'in_app',
    direction: 'inbound',
    from: approverId,
    subject: 'Demande rejetée',
    content: reason
  });
  
  return this.save();
};

// Déléguer à un autre utilisateur
approvalRequestSchema.methods.delegateToUser = function(fromUserId, toUserId, level) {
  const step = this.approvalChain.find(s => s.level === level);
  
  if (!step || !step.approver.equals(fromUserId)) {
    throw new Error('Délégation non autorisée');
  }
  
  step.delegatedTo = toUserId;
  step.delegatedAt = new Date();
  
  // Enregistrer communication
  this.communications.push({
    type: 'in_app',
    direction: 'outbound',
    from: fromUserId,
    to: toUserId,
    subject: 'Délégation d\'approbation',
    content: `Demande d'approbation déléguée pour ${this.businessJustification.purpose}`
  });
  
  return this.save();
};

// Escalader automatiquement
approvalRequestSchema.methods.escalate = function(reason = 'timeout') {
  this.escalation.isEscalated = true;
  this.escalation.escalatedAt = new Date();
  this.escalation.escalationLevel += 1;
  this.escalation.escalationReason = reason;
  
  // Ajouter à l'historique
  this.escalation.escalationHistory.push({
    level: this.escalation.escalationLevel,
    escalatedAt: new Date(),
    reason: reason
  });
  
  return this.save();
};

// Ajouter une communication
approvalRequestSchema.methods.addCommunication = function(type, direction, from, to, subject, content) {
  this.communications.push({
    type,
    direction,
    from,
    to,
    subject,
    content,
    sentAt: new Date()
  });
  
  return this.save();
};

// Vérifier si en retard
approvalRequestSchema.methods.checkOverdue = function() {
  return this.timeline.requiredBy && new Date() > this.timeline.requiredBy;
};

// Obtenir le résumé
approvalRequestSchema.methods.getSummary = function() {
  return {
    id: this._id,
    purpose: this.businessJustification.purpose,
    amount: this.financialInfo.totalAmount,
    requester: this.requester,
    status: this.finalStatus,
    currentLevel: this.currentLevel,
    totalLevels: this.approvalChain.length,
    isOverdue: this.isOverdue,
    progress: this.progressPercentage,
    createdAt: this.createdAt,
    requiredBy: this.timeline.requiredBy
  };
};

// ============================================================================
// MÉTHODES STATIQUES
// ============================================================================

// Trouver les demandes en attente pour un approbateur
approvalRequestSchema.statics.findPendingForApprover = function(approverId) {
  return this.find({
    'approvalChain.approver': approverId,
    'approvalChain.status': 'pending',
    finalStatus: 'pending'
  }).populate('requester booking company');
};

// Statistiques par entreprise
approvalRequestSchema.statics.getCompanyStats = function(companyId, startDate, endDate) {
  const matchQuery = { company: companyId };
  
  if (startDate && endDate) {
    matchQuery.createdAt = { $gte: startDate, $lte: endDate };
  }
  
  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: '$finalStatus',
        count: { $sum: 1 },
        totalAmount: { $sum: '$financialInfo.totalAmount' },
        avgProcessingTime: { $avg: '$timeline.processingTime' }
      }
    }
  ]);
};

// Trouver les demandes expirées
approvalRequestSchema.statics.findExpired = function() {
  return this.find({
    finalStatus: 'pending',
    'timeline.requiredBy': { $lt: new Date() }
  });
};

// Recherche avancée
approvalRequestSchema.statics.advancedSearch = function(filters = {}) {
  const query = {};
  
  if (filters.company) query.company = filters.company;
  if (filters.status) query.finalStatus = filters.status;
  if (filters.urgency) query['businessJustification.urgencyLevel'] = filters.urgency;
  if (filters.minAmount) query['financialInfo.totalAmount'] = { $gte: filters.minAmount };
  if (filters.maxAmount) {
    query['financialInfo.totalAmount'] = query['financialInfo.totalAmount'] || {};
    query['financialInfo.totalAmount'].$lte = filters.maxAmount;
  }
  
  return this.find(query)
    .populate('requester', 'firstName lastName email')
    .populate('company', 'name')
    .populate('booking', 'reference checkInDate checkOutDate')
    .sort({ createdAt: -1 });
};

// ============================================================================
// EXPORT
// ============================================================================

const ApprovalRequest = mongoose.model('ApprovalRequest', approvalRequestSchema);

module.exports = ApprovalRequest;