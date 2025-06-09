// src/services/enterpriseInvoicingService.js - Service Facturation Entreprise
const Company = require('../models/Company');
const User = require('../models/User');
const Booking = require('../models/Booking');
const invoiceGenerator = require('../utils/invoiceGenerator');
const emailService = require('./emailService');
const notificationService = require('./notificationService');
const queueService = require('./queueService');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs').promises;

// Modèle Invoice intégré
const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { 
    type: String, 
    unique: true, 
    required: true,
    index: true
  },
  company: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true,
    index: true
  },
  period: {
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    quarter: Number,
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true }
  },
  bookings: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Booking' }],
  financial: {
    subtotal: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, default: 0, min: 0 },
    discountRate: { type: Number, default: 0, min: 0, max: 100 },
    netAmount: { type: Number, required: true, min: 0 },
    vatAmount: { type: Number, required: true, min: 0 },
    vatRate: { type: Number, default: 20, min: 0 },
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'EUR', enum: ['EUR', 'USD', 'GBP'] }
  },
  breakdown: {
    accommodation: { type: Number, default: 0 },
    taxes: { type: Number, default: 0 },
    extras: { type: Number, default: 0 },
    fees: { type: Number, default: 0 }
  },
  departmentBreakdown: [{
    department: { type: String, required: true },
    bookingCount: { type: Number, default: 0 },
    subtotal: { type: Number, default: 0 },
    employeeCount: { type: Number, default: 0 },
    employees: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
  }],
  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft',
    index: true
  },
  dates: {
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    sentDate: Date,
    paidDate: Date,
    reminderDate: Date
  },
  payment: {
    method: { type: String, enum: ['bank_transfer', 'credit_card', 'check', 'cash'] },
    reference: String,
    transactionId: String,
    paidAmount: { type: Number, min: 0 }
  },
  files: {
    pdfPath: String,
    pdfUrl: String,
    excelPath: String,
    csvPath: String
  },
  metadata: {
    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    automaticallyGenerated: { type: Boolean, default: false },
    notes: String,
    tags: [String],
    version: { type: Number, default: 1 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Index composés pour performance
invoiceSchema.index({ company: 1, 'period.year': 1, 'period.month': 1 });
invoiceSchema.index({ status: 1, 'dates.dueDate': 1 });
invoiceSchema.index({ 'dates.issueDate': -1 });

// Virtual pour jours de retard
invoiceSchema.virtual('daysOverdue').get(function() {
  if (this.status !== 'overdue') return 0;
  return Math.floor((new Date() - this.dates.dueDate) / (1000 * 60 * 60 * 24));
});

const Invoice = mongoose.model('Invoice', invoiceSchema);

class EnterpriseInvoicingService {
  constructor() {
    this.invoiceDir = path.join(__dirname, '../../uploads/invoices');
    this.ensureDirectories();
  }

  // ===== INITIALISATION =====
  
  async ensureDirectories() {
    try {
      const dirs = ['pdf', 'excel', 'csv'].map(type => 
        path.join(this.invoiceDir, type)
      );
      
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }
    } catch (error) {
      console.error('❌ Erreur création dossiers:', error.message);
    }
  }

  // ===== GÉNÉRATION FACTURES =====

  /**
   * Générer facture mensuelle pour une entreprise
   */
  async generateMonthlyInvoice(companyId, year, month, options = {}) {
    try {
      console.log(`📄 Génération facture ${month}/${year} pour entreprise ${companyId}`);
      
      // 1. Validations
      this.validateInvoiceData(companyId, year, month);
      
      // 2. Récupérer l'entreprise
      const company = await Company.findById(companyId);
      if (!company) {
        throw new Error('Entreprise introuvable');
      }

      if (!company.contract?.isActive) {
        return {
          success: false,
          message: 'Contrat entreprise inactif',
          company: company.name
        };
      }

      // 3. Calculer la période
      const period = this.calculatePeriod(year, month, company.settings?.invoicingFrequency);
      
      // 4. Vérifier facture existante (sauf si regenerate)
      if (!options.regenerate) {
        const existingInvoice = await Invoice.findOne({
          company: companyId,
          'period.year': year,
          'period.month': month,
          status: { $ne: 'cancelled' }
        });

        if (existingInvoice) {
          return {
            success: false,
            message: 'Facture déjà générée pour cette période',
            existingInvoice: existingInvoice.invoiceNumber
          };
        }
      }

      // 5. Récupérer les réservations confirmées
      const bookings = await this.getBookingsForPeriod(companyId, period.startDate, period.endDate);
      
      if (bookings.length === 0) {
        return {
          success: false,
          message: 'Aucune réservation confirmée pour cette période',
          period: { year, month }
        };
      }

      console.log(`📊 ${bookings.length} réservation(s) trouvée(s)`);

      // 6. Analyser les données
      const analysis = await this.analyzeBookings(bookings, company);
      
      // 7. Calculer les totaux financiers
      const financial = this.calculateFinancialTotals(analysis.totals, company);
      
      // 8. Créer la facture
      const invoice = await this.createInvoiceRecord(
        companyId, 
        year, 
        month, 
        period, 
        bookings, 
        financial, 
        analysis, 
        options
      );

      // 9. Générer les fichiers
      const files = await this.generateInvoiceFiles(invoice, company, analysis);
      
      // 10. Mettre à jour les chemins
      invoice.files = files;
      await invoice.save();

      // 11. Envoyer par email si demandé
      if (options.sendEmail !== false) {
        await this.sendInvoiceEmail(invoice, company, files);
      }

      // 12. Mettre à jour les stats entreprise
      await this.updateCompanyStats(company, financial.totalAmount, bookings.length);

      // 13. Programmer rappels paiement
      if (invoice.status === 'sent') {
        await this.schedulePaymentReminders(invoice);
      }

      console.log(`✅ Facture ${invoice.invoiceNumber} générée avec succès`);

      return {
        success: true,
        invoice: {
          id: invoice._id,
          number: invoice.invoiceNumber,
          amount: invoice.financial.totalAmount,
          status: invoice.status,
          dueDate: invoice.dates.dueDate
        },
        files,
        analysis: {
          bookingCount: analysis.totals.bookingCount,
          departmentCount: analysis.departmentBreakdown.length,
          savings: financial.discountAmount
        },
        message: `Facture ${invoice.invoiceNumber} générée avec succès`
      };

    } catch (error) {
      console.error(`❌ Erreur génération facture: ${error.message}`);
      throw new Error(`Erreur génération facture: ${error.message}`);
    }
  }

  /**
   * Générer facture trimestrielle
   */
  async generateQuarterlyInvoice(companyId, year, quarter, options = {}) {
    if (quarter < 1 || quarter > 4) {
      throw new Error('Trimestre invalide (1-4)');
    }

    const quarterMonths = {
      1: { start: 0, end: 2 },   // Jan-Mar
      2: { start: 3, end: 5 },   // Apr-Jun  
      3: { start: 6, end: 8 },   // Jul-Sep
      4: { start: 9, end: 11 }   // Oct-Dec
    };

    const { start, end } = quarterMonths[quarter];
    const startDate = new Date(year, start, 1);
    const endDate = new Date(year, end + 1, 0, 23, 59, 59);

    return await this.generateCustomPeriodInvoice(companyId, startDate, endDate, {
      ...options,
      type: 'quarterly',
      quarter
    });
  }

  /**
   * Générer facture pour période personnalisée
   */
  async generateCustomPeriodInvoice(companyId, startDate, endDate, options = {}) {
    try {
      const company = await Company.findById(companyId);
      if (!company) throw new Error('Entreprise introuvable');

      const bookings = await this.getBookingsForPeriod(companyId, startDate, endDate);
      if (bookings.length === 0) {
        return { 
          success: false, 
          message: 'Aucune réservation pour cette période' 
        };
      }

      const analysis = await this.analyzeBookings(bookings, company);
      const financial = this.calculateFinancialTotals(analysis.totals, company);

      const invoiceNumber = this.generateInvoiceNumber(
        company, 
        startDate.getFullYear(), 
        startDate.getMonth() + 1, 
        options.type || 'custom'
      );

      const invoice = new Invoice({
        invoiceNumber,
        company: companyId,
        period: {
          year: startDate.getFullYear(),
          month: startDate.getMonth() + 1,
          quarter: options.quarter,
          startDate,
          endDate
        },
        bookings: bookings.map(b => b._id),
        financial,
        breakdown: analysis.breakdown,
        departmentBreakdown: analysis.departmentBreakdown,
        dates: {
          issueDate: new Date(),
          dueDate: this.calculateDueDate(company.billing?.paymentTerms)
        },
        metadata: {
          generatedBy: options.userId,
          automaticallyGenerated: options.automatic || false,
          notes: options.notes,
          tags: [options.type || 'custom']
        }
      });

      await invoice.save();

      const files = await this.generateInvoiceFiles(invoice, company, analysis);
      invoice.files = files;
      await invoice.save();

      if (options.sendEmail !== false) {
        await this.sendInvoiceEmail(invoice, company, files);
      }

      return {
        success: true,
        invoice,
        files,
        analysis
      };

    } catch (error) {
      console.error(`❌ Erreur facture période: ${error.message}`);
      throw error;
    }
  }

  // ===== ANALYSE DES DONNÉES =====

  /**
   * Récupérer réservations pour période
   */
  async getBookingsForPeriod(companyId, startDate, endDate) {
    const query = {
      'guestInfo.company': companyId,
      status: 'confirmed',
      checkInDate: { $gte: startDate, $lte: endDate }
    };

    return await Booking.find(query)
      .populate('hotel', 'name address.city address.country category')
      .populate('room', 'number type category')
      .populate('user', 'firstName lastName email department jobTitle employeeId')
      .sort({ checkInDate: 1 })
      .lean(); // Optimisation performance
  }

  /**
   * Analyser les réservations en détail
   */
  async analyzeBookings(bookings, company) {
    const analysis = {
      totals: {
        bookingCount: bookings.length,
        totalNights: 0,
        subtotal: 0,
        accommodation: 0,
        taxes: 0,
        extras: 0,
        fees: 0
      },
      breakdown: {},
      departmentBreakdown: [],
      hotelBreakdown: [],
      employeeBreakdown: [],
      monthlyBreakdown: [],
      categoryBreakdown: {}
    };

    // Structures pour regroupement
    const groups = {
      departments: new Map(),
      hotels: new Map(),
      employees: new Map(),
      months: new Map(),
      categories: new Map()
    };

    // Traiter chaque réservation
    for (const booking of bookings) {
      const amount = booking.totalAmount || 0;
      const nights = booking.numberOfNights || 1;
      
      // Totaux généraux
      analysis.totals.totalNights += nights;
      analysis.totals.subtotal += amount;
      analysis.totals.accommodation += booking.baseAmount || 0;
      analysis.totals.taxes += booking.taxAmount || 0;
      analysis.totals.extras += booking.extrasAmount || 0;
      analysis.totals.fees += booking.feesAmount || 0;

      // Groupement par département
      const dept = booking.user?.department || 'Non spécifié';
      this.updateGroup(groups.departments, dept, {
        bookingCount: 1,
        totalNights: nights,
        subtotal: amount,
        employees: new Set([booking.user?._id?.toString()]),
        bookings: [booking._id]
      });

      // Groupement par hôtel
      if (booking.hotel) {
        const hotelKey = booking.hotel._id.toString();
        this.updateGroup(groups.hotels, hotelKey, {
          hotel: booking.hotel,
          bookingCount: 1,
          totalNights: nights,
          subtotal: amount,
          uniqueEmployees: new Set([booking.user?._id?.toString()])
        });
      }

      // Groupement par employé
      if (booking.user) {
        const empKey = booking.user._id.toString();
        this.updateGroup(groups.employees, empKey, {
          employee: booking.user,
          bookingCount: 1,
          totalNights: nights,
          subtotal: amount,
          hotels: new Set([booking.hotel?._id?.toString()])
        });
      }

      // Groupement par mois
      const monthKey = `${booking.checkInDate.getFullYear()}-${String(booking.checkInDate.getMonth() + 1).padStart(2, '0')}`;
      this.updateGroup(groups.months, monthKey, {
        month: monthKey,
        bookingCount: 1,
        totalNights: nights,
        subtotal: amount,
        uniqueEmployees: new Set([booking.user?._id?.toString()]),
        departments: new Set([dept])
      });

      // Groupement par catégorie d'hôtel
      const category = booking.hotel?.category || 'Non classé';
      this.updateGroup(groups.categories, category, {
        category,
        bookingCount: 1,
        subtotal: amount,
        hotels: new Set([booking.hotel?._id?.toString()])
      });
    }

    // Convertir les Maps en arrays avec statistiques
    analysis.departmentBreakdown = this.processDepartmentGroups(groups.departments);
    analysis.hotelBreakdown = this.processHotelGroups(groups.hotels);
    analysis.employeeBreakdown = this.processEmployeeGroups(groups.employees);
    analysis.monthlyBreakdown = this.processMonthlyGroups(groups.months);
    analysis.categoryBreakdown = this.processCategoryGroups(groups.categories);

    // Breakdown par type de coût
    analysis.breakdown = {
      accommodation: analysis.totals.accommodation,
      taxes: analysis.totals.taxes,
      extras: analysis.totals.extras,
      fees: analysis.totals.fees
    };

    return analysis;
  }

  /**
   * Mettre à jour un groupe avec accumulation
   */
  updateGroup(groupMap, key, data) {
    if (!groupMap.has(key)) {
      groupMap.set(key, { ...data });
    } else {
      const existing = groupMap.get(key);
      existing.bookingCount += data.bookingCount || 0;
      existing.totalNights += data.totalNights || 0;
      existing.subtotal += data.subtotal || 0;
      
      if (data.employees && existing.employees) {
        data.employees.forEach(emp => existing.employees.add(emp));
      }
      if (data.uniqueEmployees && existing.uniqueEmployees) {
        data.uniqueEmployees.forEach(emp => existing.uniqueEmployees.add(emp));
      }
      if (data.hotels && existing.hotels) {
        data.hotels.forEach(hotel => existing.hotels.add(hotel));
      }
      if (data.departments && existing.departments) {
        data.departments.forEach(dept => existing.departments.add(dept));
      }
      if (data.bookings && existing.bookings) {
        existing.bookings.push(...data.bookings);
      }
    }
  }

  /**
   * Traiter les groupes par département
   */
  processDepartmentGroups(departments) {
    return Array.from(departments.entries()).map(([dept, data]) => ({
      department: dept,
      bookingCount: data.bookingCount,
      totalNights: data.totalNights,
      subtotal: data.subtotal,
      employees: Array.from(data.employees),
      employeeCount: data.employees.size,
      averagePerEmployee: data.subtotal / data.employees.size,
      averagePerBooking: data.subtotal / data.bookingCount,
      bookings: data.bookings
    })).sort((a, b) => b.subtotal - a.subtotal);
  }

  /**
   * Traiter les groupes par hôtel
   */
  processHotelGroups(hotels) {
    return Array.from(hotels.entries()).map(([_, data]) => ({
      hotel: {
        id: data.hotel._id,
        name: data.hotel.name,
        city: data.hotel.address?.city,
        category: data.hotel.category
      },
      bookingCount: data.bookingCount,
      totalNights: data.totalNights,
      subtotal: data.subtotal,
      uniqueEmployees: data.uniqueEmployees.size,
      averagePerEmployee: data.subtotal / data.uniqueEmployees.size,
      averagePerBooking: data.subtotal / data.bookingCount
    })).sort((a, b) => b.bookingCount - a.bookingCount);
  }

  /**
   * Traiter les groupes par employé
   */
  processEmployeeGroups(employees) {
    return Array.from(employees.entries()).map(([_, data]) => ({
      employee: {
        id: data.employee._id,
        name: `${data.employee.firstName} ${data.employee.lastName}`,
        email: data.employee.email,
        department: data.employee.department,
        employeeId: data.employee.employeeId
      },
      bookingCount: data.bookingCount,
      totalNights: data.totalNights,
      subtotal: data.subtotal,
      uniqueHotels: data.hotels.size,
      averagePerBooking: data.subtotal / data.bookingCount,
      averagePerNight: data.subtotal / data.totalNights
    })).sort((a, b) => b.subtotal - a.subtotal);
  }

  /**
   * Traiter les groupes mensuels
   */
  processMonthlyGroups(months) {
    return Array.from(months.entries()).map(([month, data]) => ({
      month,
      bookingCount: data.bookingCount,
      totalNights: data.totalNights,
      subtotal: data.subtotal,
      uniqueEmployees: data.uniqueEmployees.size,
      departments: data.departments.size,
      averagePerEmployee: data.subtotal / data.uniqueEmployees.size,
      averagePerBooking: data.subtotal / data.bookingCount
    })).sort((a, b) => a.month.localeCompare(b.month));
  }

  /**
   * Traiter les groupes par catégorie
   */
  processCategoryGroups(categories) {
    return Array.from(categories.entries()).map(([category, data]) => ({
      category,
      bookingCount: data.bookingCount,
      subtotal: data.subtotal,
      uniqueHotels: data.hotels.size,
      averagePerBooking: data.subtotal / data.bookingCount
    })).sort((a, b) => b.subtotal - a.subtotal);
  }

  // ===== CALCULS FINANCIERS =====

  /**
   * Calculer totaux financiers avec remises entreprise
   */
  calculateFinancialTotals(totals, company) {
    const subtotal = Number(totals.subtotal) || 0;
    const discountRate = Number(company.contract?.discountRate) || 0;
    
    // Remises par volume si configurées
    let finalDiscountRate = discountRate;
    if (company.contract?.volumeDiscounts?.length > 0) {
      const applicableDiscount = company.contract.volumeDiscounts
        .filter(vd => subtotal >= vd.threshold)
        .sort((a, b) => b.threshold - a.threshold)[0];
      
      if (applicableDiscount) {
        finalDiscountRate = Math.max(discountRate, applicableDiscount.discountRate);
      }
    }

    const discountAmount = subtotal * (finalDiscountRate / 100);
    const netAmount = subtotal - discountAmount;
    const vatRate = 20; // TVA française standard
    const vatAmount = netAmount * (vatRate / 100);
    const totalAmount = netAmount + vatAmount;

    return {
      subtotal: this.roundAmount(subtotal),
      discountAmount: this.roundAmount(discountAmount),
      discountRate: finalDiscountRate,
      netAmount: this.roundAmount(netAmount),
      vatAmount: this.roundAmount(vatAmount),
      vatRate,
      totalAmount: this.roundAmount(totalAmount),
      currency: 'EUR'
    };
  }

  /**
   * Arrondir montant à 2 décimales
   */
  roundAmount(amount) {
    return Math.round((Number(amount) || 0) * 100) / 100;
  }

  /**
   * Calculer date d'échéance
   */
  calculateDueDate(paymentTerms = 30) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + paymentTerms);
    return dueDate;
  }

  /**
   * Générer numéro de facture unique
   */
  generateInvoiceNumber(company, year, month, type = 'monthly') {
    const prefix = company.name.substring(0, 3).toUpperCase();
    const yearShort = year.toString().slice(-2);
    const monthPadded = String(month).padStart(2, '0');
    const timestamp = Date.now().toString().slice(-6);

    const typeCode = {
      monthly: 'M',
      quarterly: 'Q',
      yearly: 'Y',
      custom: 'C'
    }[type] || 'M';

    return `INV-${prefix}-${yearShort}${monthPadded}-${typeCode}-${timestamp}`;
  }

  /**
   * Calculer période selon fréquence
   */
  calculatePeriod(year, month, frequency = 'monthly') {
    let startDate, endDate;

    switch (frequency) {
      case 'weekly':
        // Premier jour du mois au dernier
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(year, month, 0, 23, 59, 59);
        break;

      case 'quarterly':
        const quarterStart = Math.floor((month - 1) / 3) * 3;
        startDate = new Date(year, quarterStart, 1);
        endDate = new Date(year, quarterStart + 3, 0, 23, 59, 59);
        break;

      case 'yearly':
        startDate = new Date(year, 0, 1);
        endDate = new Date(year, 11, 31, 23, 59, 59);
        break;

      default: // monthly
        startDate = new Date(year, month - 1, 1);
        endDate = new Date(year, month, 0, 23, 59, 59);
    }

    return { startDate, endDate };
  }

  // ===== CRÉATION ENREGISTREMENT =====

  /**
   * Créer l'enregistrement facture en base
   */
  async createInvoiceRecord(companyId, year, month, period, bookings, financial, analysis, options) {
    const invoiceNumber = this.generateInvoiceNumber(
      await Company.findById(companyId), 
      year, 
      month, 
      options.type
    );

    const invoice = new Invoice({
      invoiceNumber,
      company: companyId,
      period: {
        year,
        month,
        quarter: Math.ceil(month / 3),
        startDate: period.startDate,
        endDate: period.endDate
      },
      bookings: bookings.map(b => b._id),
      financial,
      breakdown: analysis.breakdown,
      departmentBreakdown: analysis.departmentBreakdown.map(dept => ({
        department: dept.department,
        bookingCount: dept.bookingCount,
        subtotal: dept.subtotal,
        employeeCount: dept.employeeCount,
        employees: dept.employees
      })),
      status: options.sendEmail === false ? 'draft' : 'sent',
      dates: {
        issueDate: new Date(),
        dueDate: this.calculateDueDate(
          (await Company.findById(companyId)).billing?.paymentTerms
        )
      },
      metadata: {
        generatedBy: options.userId,
        automaticallyGenerated: options.automatic || false,
        notes: options.notes,
        tags: options.tags || []
      }
    });

    return await invoice.save();
  }

  // ===== GÉNÉRATION FICHIERS =====

  /**
   * Générer tous les fichiers de facture
   */
  async generateInvoiceFiles(invoice, company, analysis) {
    try {
      console.log(`📄 Génération fichiers facture ${invoice.invoiceNumber}`);

      const files = {};

      // 1. PDF principal
      const pdfResult = await this.generatePDFInvoice(invoice, company, analysis);
      files.pdfPath = pdfResult.filePath;
      files.pdfUrl = pdfResult.url;

      // 2. Excel détaillé
      const excelResult = await this.generateExcelReport(invoice, company, analysis);
      files.excelPath = excelResult.filePath;

      // 3. CSV comptabilité
      const csvResult = await this.generateCSVReport(invoice, analysis);
      files.csvPath = csvResult.filePath;

      console.log(`✅ Fichiers générés: PDF, Excel, CSV`);
      return files;

    } catch (error) {
      console.error(`❌ Erreur génération fichiers: ${error.message}`);
      throw error;
    }
  }

  /**
   * Générer PDF de facture
   */
  async generatePDFInvoice(invoice, company, analysis) {
    const data = {
      invoice: {
        number: invoice.invoiceNumber,
        issueDate: invoice.dates.issueDate,
        dueDate: invoice.dates.dueDate,
        period: invoice.period,
        financial: invoice.financial,
        breakdown: invoice.breakdown
      },
      company: {
        name: company.name,
        address: company.address,
        contact: company.contact,
        siret: company.siret,
        vatNumber: company.vatNumber
      },
      analysis: {
        totals: analysis.totals,
        departmentBreakdown: analysis.departmentBreakdown,
        bookingCount: analysis.totals.bookingCount
      },
      template: 'enterprise-invoice'
    };

    const fileName = `${invoice.invoiceNumber}.pdf`;
    const filePath = path.join(this.invoiceDir, 'pdf', fileName);

    // Utiliser le service de génération PDF existant
    const pdfBuffer = await invoiceGenerator.generatePDF(data);
    await fs.writeFile(filePath, pdfBuffer);

    return {
      filePath,
      fileName,
      url: `/api/files/invoices/pdf/${fileName}`
    };
  }

  /**
   * Générer rapport Excel
   */
  async generateExcelReport(invoice, company, analysis) {
    const fileName = `${invoice.invoiceNumber}.xlsx`;
    const filePath = path.join(this.invoiceDir, 'excel', fileName);

    // Créer le contenu Excel (simulation - vous pouvez utiliser ExcelJS)
    const excelData = {
      summary: {
        invoice: invoice.invoiceNumber,
        company: company.name,
        period: `${invoice.period.month}/${invoice.period.year}`,
        totalAmount: invoice.financial.totalAmount,
        bookingCount: analysis.totals.bookingCount
      },
      departments: analysis.departmentBreakdown,
      employees: analysis.employeeBreakdown,
      hotels: analysis.hotelBreakdown
    };

    // Écrire le fichier (ici en JSON pour simplification)
    await fs.writeFile(filePath, JSON.stringify(excelData, null, 2));

    return { filePath, fileName };
  }

  /**
   * Générer rapport CSV
   */
  async generateCSVReport(invoice, analysis) {
    const fileName = `${invoice.invoiceNumber}.csv`;
    const filePath = path.join(this.invoiceDir, 'csv', fileName);

    // Créer CSV des départements
    const csvLines = ['Département,Réservations,Employés,Montant HT,Moyenne/Employé'];
    
    analysis.departmentBreakdown.forEach(dept => {
      csvLines.push([
        dept.department,
        dept.bookingCount,
        dept.employeeCount,
        dept.subtotal,
        dept.averagePerEmployee.toFixed(2)
      ].join(','));
    });

    await fs.writeFile(filePath, csvLines.join('\n'));

    return { filePath, fileName };
  }

  // ===== ENVOI ET NOTIFICATIONS =====

  /**
   * Envoyer facture par email
   */
  async sendInvoiceEmail(invoice, company, files) {
    try {
      console.log(`📧 Envoi facture ${invoice.invoiceNumber} à ${company.contact.email}`);

      const emailData = {
        to: company.contact.email,
        subject: `Facture ${invoice.invoiceNumber} - ${company.name}`,
        template: 'enterprise-monthly-invoice',
        data: {
          companyName: company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.financial.totalAmount,
          currency: invoice.financial.currency,
          dueDate: invoice.dates.dueDate.toLocaleDateString('fr-FR'),
          period: `${invoice.period.month}/${invoice.period.year}`,
          bookingCount: invoice.bookings.length,
          loginUrl: `${process.env.FRONTEND_URL}/enterprise/invoices`
        },
        attachments: [{
          filename: `Facture-${invoice.invoiceNumber}.pdf`,
          path: files.pdfPath,
          contentType: 'application/pdf'
        }]
      };

      await emailService.sendEmail(emailData);

      // Marquer comme envoyée
      invoice.status = 'sent';
      invoice.dates.sentDate = new Date();
      await invoice.save();

      console.log(`✅ Facture envoyée avec succès`);

    } catch (error) {
      console.error(`❌ Erreur envoi email: ${error.message}`);
      throw error;
    }
  }

  // ===== GESTION PAIEMENTS =====

  /**
   * Marquer facture comme payée
   */
  async markInvoiceAsPaid(invoiceId, paymentData) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('company');
      if (!invoice) {
        throw new Error('Facture introuvable');
      }

      if (invoice.status === 'paid') {
        return {
          success: false,
          message: 'Facture déjà marquée comme payée'
        };
      }

      // Mettre à jour la facture
      invoice.status = 'paid';
      invoice.dates.paidDate = new Date();
      invoice.payment = {
        method: paymentData.method,
        reference: paymentData.reference,
        transactionId: paymentData.transactionId,
        paidAmount: paymentData.amount || invoice.financial.totalAmount
      };

      await invoice.save();

      // Mettre à jour le crédit entreprise
      await Company.findByIdAndUpdate(invoice.company._id, {
        $inc: { 'billing.currentCredit': -invoice.financial.totalAmount }
      });

      // Notifier le paiement
      await this.notifyPaymentReceived(invoice);

      console.log(`💰 Facture ${invoice.invoiceNumber} marquée comme payée`);

      return {
        success: true,
        invoice,
        message: 'Facture marquée comme payée avec succès'
      };

    } catch (error) {
      console.error(`❌ Erreur marquage paiement: ${error.message}`);
      throw error;
    }
  }

  /**
   * Programmer rappels de paiement
   */
  async schedulePaymentReminders(invoice) {
    try {
      const reminderDays = [7, 3, 1]; // Jours avant échéance
      const now = new Date();

      for (const days of reminderDays) {
        const reminderDate = new Date(invoice.dates.dueDate);
        reminderDate.setDate(reminderDate.getDate() - days);

        if (reminderDate > now) {
          await queueService.scheduleJob('payment-reminder', {
            invoiceId: invoice._id,
            daysBefore: days,
            type: 'reminder'
          }, reminderDate.getTime() - now.getTime());
        }
      }

      // Rappel d'impayé après échéance
      const overdueDate = new Date(invoice.dates.dueDate);
      overdueDate.setDate(overdueDate.getDate() + 1);

      if (overdueDate > now) {
        await queueService.scheduleJob('payment-overdue', {
          invoiceId: invoice._id,
          type: 'overdue'
        }, overdueDate.getTime() - now.getTime());
      }

      console.log(`⏰ Rappels programmés pour facture ${invoice.invoiceNumber}`);

    } catch (error) {
      console.error(`❌ Erreur programmation rappels: ${error.message}`);
    }
  }

  /**
   * Envoyer rappel de paiement
   */
  async sendPaymentReminder(invoiceId, daysBefore) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('company');
      if (!invoice || invoice.status === 'paid') {
        return;
      }

      const emailData = {
        to: invoice.company.contact.email,
        subject: `Rappel - Facture ${invoice.invoiceNumber} échéance dans ${daysBefore} jour(s)`,
        template: 'payment-reminder',
        data: {
          companyName: invoice.company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.financial.totalAmount,
          dueDate: invoice.dates.dueDate.toLocaleDateString('fr-FR'),
          daysBefore,
          paymentUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}/payment`
        }
      };

      await emailService.sendEmail(emailData);

      invoice.dates.reminderDate = new Date();
      await invoice.save();

      console.log(`🔔 Rappel ${daysBefore}j envoyé pour facture ${invoice.invoiceNumber}`);

    } catch (error) {
      console.error(`❌ Erreur rappel paiement: ${error.message}`);
    }
  }

  /**
   * Traiter factures impayées
   */
  async handleOverdueInvoices(invoiceId) {
    try {
      const invoice = await Invoice.findById(invoiceId).populate('company');
      if (!invoice || invoice.status === 'paid') {
        return;
      }

      // Marquer comme impayée
      invoice.status = 'overdue';
      await invoice.save();

      // Calculer montant total impayé
      const totalOverdue = await this.getOverdueAmount(invoice.company._id);

      // Notifier l'impayé
      await this.notifyOverdueInvoice(invoice, totalOverdue);

      // Suspendre réservations si limite atteinte
      const creditLimit = invoice.company.billing.creditLimit;
      if (totalOverdue > creditLimit * 0.8) {
        await this.suspendCompanyBookings(invoice.company._id, 'Factures impayées');
      }

      console.log(`⚠️ Facture ${invoice.invoiceNumber} marquée impayée`);

    } catch (error) {
      console.error(`❌ Erreur traitement impayé: ${error.message}`);
    }
  }

  /**
   * Calculer montant total impayé
   */
  async getOverdueAmount(companyId) {
    const result = await Invoice.aggregate([
      {
        $match: {
          company: new mongoose.Types.ObjectId(companyId),
          status: 'overdue'
        }
      },
      {
        $group: {
          _id: null,
          totalOverdue: { $sum: '$financial.totalAmount' },
          invoiceCount: { $sum: 1 }
        }
      }
    ]);

    return result[0]?.totalOverdue || 0;
  }

  // ===== RAPPORTS ET STATISTIQUES =====

  /**
   * Historique des factures
   */
  async getInvoiceHistory(companyId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        status,
        year,
        startDate,
        endDate,
        sortBy = 'dates.issueDate',
        sortOrder = -1
      } = options;

      const query = { company: companyId };

      if (status) query.status = status;
      if (year) query['period.year'] = parseInt(year);

      if (startDate && endDate) {
        query['dates.issueDate'] = {
          $gte: new Date(startDate),
          $lte: new Date(endDate)
        };
      }

      const invoices = await Invoice.find(query)
        .sort({ [sortBy]: sortOrder })
        .limit(parseInt(limit))
        .skip((parseInt(page) - 1) * parseInt(limit))
        .populate('company', 'name')
        .populate('metadata.generatedBy', 'firstName lastName')
        .lean();

      const total = await Invoice.countDocuments(query);

      // Statistiques résumées
      const stats = await Invoice.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financial.totalAmount' },
            avgAmount: { $avg: '$financial.totalAmount' }
          }
        }
      ]);

      return {
        invoices: invoices.map(inv => ({
          id: inv._id,
          number: inv.invoiceNumber,
          period: inv.period,
          amount: inv.financial.totalAmount,
          status: inv.status,
          issueDate: inv.dates.issueDate,
          dueDate: inv.dates.dueDate,
          paidDate: inv.dates.paidDate,
          bookingCount: inv.bookings.length,
          departmentCount: inv.departmentBreakdown.length
        })),
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        },
        statistics: stats.reduce((acc, stat) => {
          acc[stat._id] = {
            count: stat.count,
            totalAmount: stat.totalAmount,
            avgAmount: stat.avgAmount
          };
          return acc;
        }, {})
      };

    } catch (error) {
      console.error(`❌ Erreur historique factures: ${error.message}`);
      throw error;
    }
  }

  /**
   * Statistiques de facturation
   */
  async getInvoicingStats(companyId, year) {
    try {
      const matchQuery = { company: new mongoose.Types.ObjectId(companyId) };
      if (year) matchQuery['period.year'] = parseInt(year);

      // Stats mensuelles
      const monthlyStats = await Invoice.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              year: '$period.year',
              month: '$period.month'
            },
            invoiceCount: { $sum: 1 },
            totalAmount: { $sum: '$financial.totalAmount' },
            paidAmount: {
              $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$financial.totalAmount', 0] }
            },
            bookingCount: { $sum: { $size: '$bookings' } },
            avgAmount: { $avg: '$financial.totalAmount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]);

      // Stats par statut
      const statusStats = await Invoice.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financial.totalAmount' }
          }
        }
      ]);

      // Top départements facturés
      const departmentStats = await Invoice.aggregate([
        { $match: matchQuery },
        { $unwind: '$departmentBreakdown' },
        {
          $group: {
            _id: '$departmentBreakdown.department',
            invoiceCount: { $sum: 1 },
            totalAmount: { $sum: '$departmentBreakdown.subtotal' },
            bookingCount: { $sum: '$departmentBreakdown.bookingCount' },
            employeeCount: { $avg: '$departmentBreakdown.employeeCount' }
          }
        },
        { $sort: { totalAmount: -1 } }
      ]);

      // Évolution des remises
      const discountTrends = await Invoice.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: {
              year: '$period.year',
              month: '$period.month'
            },
            avgDiscountRate: { $avg: '$financial.discountRate' },
            totalDiscountAmount: { $sum: '$financial.discountAmount' },
            totalSubtotal: { $sum: '$financial.subtotal' }
          }
        },
        {
          $addFields: {
            actualDiscountRate: {
              $multiply: [
                { $divide: ['$totalDiscountAmount', '$totalSubtotal'] },
                100
              ]
            }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } }
      ]);

      return {
        monthly: monthlyStats.map(m => ({
          period: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
          invoiceCount: m.invoiceCount,
          totalAmount: m.totalAmount,
          paidAmount: m.paidAmount,
          bookingCount: m.bookingCount,
          avgAmount: m.avgAmount,
          paymentRate: ((m.paidAmount / m.totalAmount) * 100).toFixed(1)
        })),
        byStatus: statusStats,
        byDepartment: departmentStats,
        discountTrends: discountTrends.map(d => ({
          period: `${d._id.year}-${String(d._id.month).padStart(2, '0')}`,
          avgDiscountRate: d.avgDiscountRate,
          actualDiscountRate: d.actualDiscountRate,
          totalSavings: d.totalDiscountAmount
        })),
        summary: {
          totalInvoices: monthlyStats.reduce((sum, m) => sum + m.invoiceCount, 0),
          totalAmount: monthlyStats.reduce((sum, m) => sum + m.totalAmount, 0),
          totalPaid: monthlyStats.reduce((sum, m) => sum + m.paidAmount, 0),
          totalBookings: monthlyStats.reduce((sum, m) => sum + m.bookingCount, 0),
          avgInvoiceAmount: monthlyStats.length > 0
            ? monthlyStats.reduce((sum, m) => sum + m.avgAmount, 0) / monthlyStats.length
            : 0
        }
      };

    } catch (error) {
      console.error(`❌ Erreur stats facturation: ${error.message}`);
      throw error;
    }
  }

  /**
   * Résumé financier entreprise
   */
  async getCompanyFinancialSummary(companyId) {
    try {
      const company = await Company.findById(companyId);
      if (!company) throw new Error('Entreprise introuvable');

      // Stats factures
      const invoiceStats = await Invoice.aggregate([
        { $match: { company: new mongoose.Types.ObjectId(companyId) } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$financial.totalAmount' }
          }
        }
      ]);

      // Montant impayé
      const overdueAmount = await this.getOverdueAmount(companyId);

      // Prochaine facturation
      const nextInvoicingDate = this.calculateNextInvoicingDate(company);

      // Dernière facture
      const lastInvoice = await Invoice.findOne({
        company: companyId
      }).sort({ 'dates.issueDate': -1 });

      return {
        company: {
          name: company.name,
          creditLimit: company.billing.creditLimit,
          currentCredit: company.billing.currentCredit,
          availableCredit: company.availableCredit,
          paymentTerms: company.billing.paymentTerms
        },
        invoices: invoiceStats.reduce((acc, stat) => {
          acc[stat._id] = {
            count: stat.count,
            amount: stat.totalAmount
          };
          return acc;
        }, {}),
        overdue: {
          amount: overdueAmount,
          isOverLimit: overdueAmount > company.billing.creditLimit * 0.8
        },
        nextInvoicingDate,
        lastInvoice: lastInvoice ? {
          number: lastInvoice.invoiceNumber,
          amount: lastInvoice.financial.totalAmount,
          status: lastInvoice.status,
          date: lastInvoice.dates.issueDate
        } : null
      };

    } catch (error) {
      console.error(`❌ Erreur résumé financier: ${error.message}`);
      throw error;
    }
  }

  // ===== UTILITAIRES =====

  /**
   * Mettre à jour statistiques entreprise
   */
  async updateCompanyStats(company, invoiceAmount, bookingCount) {
    try {
      // Utiliser les statistiques facturées plutôt que directement les réservations
      company.statistics.totalSpent += invoiceAmount;
      company.statistics.totalBookings += bookingCount;
      
      if (company.statistics.totalBookings > 0) {
        company.statistics.averageStayValue = 
          company.statistics.totalSpent / company.statistics.totalBookings;
      }
      
      await company.save({ validateBeforeSave: false });

      console.log(`📊 Stats entreprise mises à jour: +${invoiceAmount}€, +${bookingCount} réservations`);

    } catch (error) {
      console.error(`❌ Erreur mise à jour stats: ${error.message}`);
    }
  }

  /**
   * Notifier paiement reçu
   */
  async notifyPaymentReceived(invoice) {
    try {
      const emailData = {
        to: invoice.company.contact.email,
        subject: `Paiement reçu - Facture ${invoice.invoiceNumber}`,
        template: 'payment-confirmation',
        data: {
          companyName: invoice.company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.financial.totalAmount,
          paidDate: invoice.dates.paidDate.toLocaleDateString('fr-FR'),
          paymentMethod: invoice.payment.method,
          reference: invoice.payment.reference
        }
      };

      await emailService.sendEmail(emailData);

    } catch (error) {
      console.error(`❌ Erreur notification paiement: ${error.message}`);
    }
  }

  /**
   * Notifier facture impayée
   */
  async notifyOverdueInvoice(invoice, totalOverdue) {
    try {
      const emailData = {
        to: invoice.company.contact.email,
        subject: `URGENT - Facture impayée ${invoice.invoiceNumber}`,
        template: 'invoice-overdue',
        data: {
          companyName: invoice.company.name,
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.financial.totalAmount,
          dueDate: invoice.dates.dueDate.toLocaleDateString('fr-FR'),
          daysOverdue: invoice.daysOverdue,
          totalOverdue,
          paymentUrl: `${process.env.FRONTEND_URL}/enterprise/invoices/${invoice._id}/payment`
        }
      };

      await emailService.sendEmail(emailData);

    } catch (error) {
      console.error(`❌ Erreur notification impayé: ${error.message}`);
    }
  }

  /**
   * Suspendre réservations entreprise
   */
  async suspendCompanyBookings(companyId, reason) {
    try {
      await Company.findByIdAndUpdate(companyId, {
        status: 'suspended',
        'metadata.suspensionReason': reason,
        'metadata.suspendedAt': new Date()
      });

      // Notifier tous les utilisateurs
      const users = await User.find({ 
        company: companyId, 
        isActive: true 
      }).select('email firstName lastName');

      for (const user of users) {
        await notificationService.sendInAppNotification({
          userId: user._id,
          type: 'account_suspended',
          title: 'Compte suspendu',
          message: `Les réservations sont suspendues: ${reason}`,
          urgency: 'high'
        });
      }

      console.log(`🚫 Réservations suspendues pour entreprise ${companyId}: ${reason}`);

    } catch (error) {
      console.error(`❌ Erreur suspension: ${error.message}`);
    }
  }

  /**
   * Calculer prochaine date de facturation
   */
  calculateNextInvoicingDate(company) {
    const frequency = company.settings?.invoicingFrequency || 'monthly';
    const day = company.settings?.invoicingDay || 1;
    
    const now = new Date();
    let nextDate = new Date();

    switch (frequency) {
      case 'weekly':
        nextDate.setDate(now.getDate() + 7);
        break;
      case 'quarterly':
        nextDate.setMonth(now.getMonth() + 3, day);
        break;
      case 'yearly':
        nextDate.setFullYear(now.getFullYear() + 1, 0, day);
        break;
      default: // monthly
        nextDate.setMonth(now.getMonth() + 1, day);
        if (nextDate <= now) {
          nextDate.setMonth(nextDate.getMonth() + 1);
        }
    }

    return nextDate;
  }

  /**
   * Valider données de facture
   */
  validateInvoiceData(companyId, year, month) {
    if (!companyId || !mongoose.Types.ObjectId.isValid(companyId)) {
      throw new Error('ID entreprise invalide');
    }

    const currentYear = new Date().getFullYear();
    if (!year || year < 2020 || year > currentYear + 1) {
      throw new Error(`Année invalide (2020-${currentYear + 1})`);
    }

    if (!month || month < 1 || month > 12) {
      throw new Error('Mois invalide (1-12)');
    }

    // Vérifier que la période n'est pas dans le futur
    const requestedDate = new Date(year, month - 1, 1);
    const now = new Date();
    now.setDate(1); // Premier du mois actuel
    
    if (requestedDate > now) {
      throw new Error('Impossible de générer une facture pour une période future');
    }

    return true;
  }

  // ===== JOBS AUTOMATIQUES =====

  /**
   * Générer toutes les factures mensuelles
   */
  async generateAllMonthlyInvoices(year, month) {
    console.log(`🏢 Génération automatique factures ${month}/${year}`);

    try {
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
          const result = await this.generateMonthlyInvoice(
            company._id,
            year,
            month,
            { automatic: true, sendEmail: true }
          );

          if (result.success) {
            results.success++;
            results.details.push({
              company: company.name,
              status: 'success',
              invoice: result.invoice.number
            });
          } else {
            results.skipped++;
            results.details.push({
              company: company.name,
              status: 'skipped',
              reason: result.message
            });
          }

        } catch (error) {
          results.failed++;
          results.details.push({
            company: company.name,
            status: 'failed',
            error: error.message
          });
        }
      }

      console.log(`📊 Génération terminée: ${results.success} succès, ${results.failed} erreurs, ${results.skipped} ignorées`);
      return results;

    } catch (error) {
      console.error(`❌ Erreur génération automatique: ${error.message}`);
      throw error;
    }
  }

  /**
   * Nettoyer anciennes factures
   */
  async cleanupOldInvoices(retentionMonths = 36) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

      const oldInvoices = await Invoice.find({
        'dates.issueDate': { $lt: cutoffDate },
        status: { $in: ['paid', 'cancelled'] }
      });

      let cleanedCount = 0;

      for (const invoice of oldInvoices) {
        try {
          // Archiver les fichiers
          await this.archiveInvoiceFiles(invoice);
          
          // Supprimer l'enregistrement
          await Invoice.findByIdAndDelete(invoice._id);
          cleanedCount++;

        } catch (error) {
          console.error(`❌ Erreur suppression facture ${invoice.invoiceNumber}: ${error.message}`);
        }
      }

      console.log(`🧹 ${cleanedCount} anciennes factures nettoyées`);
      return cleanedCount;

    } catch (error) {
      console.error(`❌ Erreur nettoyage: ${error.message}`);
      throw error;
    }
  }

  /**
   * Archiver fichiers de facture
   */
  async archiveInvoiceFiles(invoice) {
    // Ici vous pouvez implémenter l'archivage vers un service cloud
    // comme AWS S3, Google Cloud Storage, etc.
    console.log(`📦 Archivage fichiers facture ${invoice.invoiceNumber}`);
    
    try {
      // Supprimer les fichiers locaux après archivage
      if (invoice.files.pdfPath) {
        await fs.unlink(invoice.files.pdfPath).catch(() => {});
      }
      if (invoice.files.excelPath) {
        await fs.unlink(invoice.files.excelPath).catch(() => {});
      }
      if (invoice.files.csvPath) {
        await fs.unlink(invoice.files.csvPath).catch(() => {});
      }
    } catch (error) {
      console.error(`❌ Erreur suppression fichiers: ${error.message}`);
    }
  }
}

module.exports = new EnterpriseInvoicingService();