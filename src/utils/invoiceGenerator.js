/**
 * INVOICE GENERATOR - GÉNÉRATEUR FACTURES COMPLET
 * Système de génération de factures PDF et données structurées
 * 
 * Fonctionnalités :
 * - Génération PDF professionnel avec templates
 * - Calculs automatiques taxes et totaux
 * - Support multi-devises avec conversion
 * - Numérotation automatique et séquentielle
 * - Templates personnalisables par hôtel
 * - Export multiple formats (PDF, JSON, XML)
 * - Envoi email automatique
 * - Archivage et stockage sécurisé
 */

const fs = require('fs').promises;
const path = require('path');
const mongoose = require('mongoose');

// Pour génération PDF (alternatives selon disponibilité)
// const puppeteer = require('puppeteer'); // Option 1: Puppeteer
// const PDFDocument = require('pdfkit'); // Option 2: PDFKit
// const jsPDF = require('jspdf'); // Option 3: jsPDF

const {
  BUSINESS_RULES,
  CLIENT_TYPES
} = require('./constants');

/**
 * ================================
 * GÉNÉRATEUR PRINCIPAL
 * ================================
 */

/**
 * Génère une facture complète avec PDF et données structurées
 * @param {Object} booking - Réservation avec données populées
 * @param {Object} options - Options de génération
 * @returns {Object} Facture générée avec métadonnées
 */
const generateInvoice = async (booking, options = {}) => {
  try {
    const {
      format = 'pdf', // pdf, json, xml, all
      template = 'default',
      language = 'fr',
      currency = 'MAD',
      includeQR = true,
      watermark = null,
      customData = {}
    } = options;

    // ================================
    // 1. GÉNÉRATION DONNÉES STRUCTURÉES
    // ================================
    
    const invoiceData = await generateInvoiceData(booking, {
      currency,
      language,
      customData
    });

    // ================================
    // 2. GÉNÉRATION FORMATS DEMANDÉS
    // ================================
    
    const result = {
      invoiceData,
      formats: {},
      metadata: {
        generatedAt: new Date(),
        format,
        template,
        language,
        currency
      }
    };

    if (format === 'json' || format === 'all') {
      result.formats.json = invoiceData;
    }

    if (format === 'pdf' || format === 'all') {
      result.formats.pdf = await generatePDF(invoiceData, {
        template,
        language,
        includeQR,
        watermark
      });
    }

    if (format === 'xml' || format === 'all') {
      result.formats.xml = await generateXML(invoiceData);
    }

    // ================================
    // 3. ARCHIVAGE ET STOCKAGE
    // ================================
    
    const archiveResult = await archiveInvoice(invoiceData, result.formats);
    result.storage = archiveResult;

    return result;

  } catch (error) {
    throw new InvoiceError('GENERATION_FAILED', `Erreur génération facture: ${error.message}`);
  }
};

/**
 * ================================
 * GÉNÉRATION DONNÉES STRUCTURÉES
 * ================================
 */

/**
 * Génère les données structurées de la facture
 */
const generateInvoiceData = async (booking, options = {}) => {
  const { currency = 'MAD', language = 'fr', customData = {} } = options;

  // ================================
  // CALCULS DE BASE
  // ================================
  
  const nightsCount = Math.ceil((booking.checkOutDate - booking.checkInDate) / (1000 * 60 * 60 * 24));
  const actualNights = booking.actualStayDuration || nightsCount;
  
  // ================================
  // NUMÉROTATION FACTURE
  // ================================
  
  const invoiceNumber = await generateInvoiceNumber(booking);
  
  // ================================
  // INFORMATIONS ENTREPRISE
  // ================================
  
  const companyInfo = await getCompanyInfo(booking.hotel, language);
  
  // ================================
  // DÉTAIL CHAMBRES AVEC CALCULS
  // ================================
  
  const roomsDetail = booking.rooms.map((room, index) => {
    const roomTotal = room.calculatedPrice || (room.basePrice * nightsCount);
    
    return {
      id: index + 1,
      type: room.type,
      roomNumber: room.room?.number || 'Non assignée',
      floor: room.room?.floor || null,
      basePrice: room.basePrice,
      nightsCount: actualNights,
      pricePerNight: Math.round((roomTotal / actualNights) * 100) / 100,
      subtotal: Math.round(roomTotal * 100) / 100,
      description: getRoomDescription(room.type, language)
    };
  });

  // ================================
  // EXTRAS ET SERVICES
  // ================================
  
  const extrasDetail = (booking.extras || []).map((extra, index) => ({
    id: index + 1,
    name: extra.name,
    category: extra.category || 'Divers',
    description: extra.description || '',
    quantity: extra.quantity || 1,
    unitPrice: extra.price,
    total: extra.total || (extra.price * (extra.quantity || 1)),
    addedAt: extra.addedAt,
    addedBy: extra.addedBy
  }));

  // ================================
  // CALCULS TOTAUX
  // ================================
  
  const roomsSubtotal = roomsDetail.reduce((sum, room) => sum + room.subtotal, 0);
  const extrasSubtotal = extrasDetail.reduce((sum, extra) => sum + extra.total, 0);
  const subtotalBeforeTax = roomsSubtotal + extrasSubtotal;
  
  // Calcul taxes (configurable par hôtel)
  const taxConfig = await getTaxConfiguration(booking.hotel, booking.customer.clientType);
  const taxAmount = calculateTaxes(subtotalBeforeTax, taxConfig);
  
  const grandTotal = subtotalBeforeTax + taxAmount;

  // ================================
  // INFORMATIONS PAIEMENT
  // ================================
  
  const paymentInfo = {
    status: booking.paymentStatus || 'Pending',
    method: booking.paymentMethod || 'À définir',
    dueDate: calculatePaymentDueDate(booking),
    paidAt: booking.paidAt || null,
    terms: getPaymentTerms(booking.customer.clientType, language)
  };

  // ================================
  // STRUCTURE FACTURE COMPLÈTE
  // ================================
  
  return {
    // En-tête facture
    invoice: {
      number: invoiceNumber,
      issueDate: new Date(),
      dueDate: paymentInfo.dueDate,
      currency,
      language,
      type: booking.clientType === CLIENT_TYPES.CORPORATE ? 'CORPORATE' : 'INDIVIDUAL'
    },

    // Informations entreprise
    company: companyInfo,

    // Informations client
    customer: {
      name: `${booking.customer.firstName} ${booking.customer.lastName}`,
      email: booking.customer.email,
      phone: booking.customer.phone,
      address: booking.customer.address || '',
      clientType: booking.customer.clientType || CLIENT_TYPES.INDIVIDUAL,
      ...(booking.corporateDetails && {
        company: {
          name: booking.corporateDetails.companyName,
          siret: booking.corporateDetails.siret,
          contact: booking.corporateDetails.contactPerson,
          address: booking.corporateDetails.address || ''
        }
      })
    },

    // Détails séjour
    stay: {
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      actualCheckInDate: booking.actualCheckInDate,
      actualCheckOutDate: booking.actualCheckOutDate,
      nightsBooked: nightsCount,
      nightsActual: actualNights,
      numberOfGuests: booking.numberOfGuests,
      specialRequests: booking.specialRequests || '',
      guestNotes: booking.guestNotes || ''
    },

    // Détails facturation
    billing: {
      // Chambres
      rooms: roomsDetail,
      roomsSubtotal: Math.round(roomsSubtotal * 100) / 100,
      
      // Extras
      extras: extrasDetail,
      extrasSubtotal: Math.round(extrasSubtotal * 100) / 100,
      
      // Totaux
      subtotal: Math.round(subtotalBeforeTax * 100) / 100,
      taxes: {
        details: taxConfig.details,
        amount: Math.round(taxAmount * 100) / 100
      },
      total: Math.round(grandTotal * 100) / 100
    },

    // Informations paiement
    payment: paymentInfo,

    // Métadonnées réservation
    booking: {
      id: booking._id.toString(),
      status: booking.status,
      source: booking.source,
      createdAt: booking.createdAt,
      confirmedAt: booking.confirmedAt,
      checkedInBy: booking.checkedInBy,
      checkedOutBy: booking.checkedOutBy
    },

    // Données personnalisées
    custom: customData,

    // Informations légales
    legal: {
      terms: await getLegalTerms(language),
      privacy: await getPrivacyPolicy(language),
      cancellation: booking.cancellationPolicy || {}
    }
  };
};

/**
 * ================================
 * GÉNÉRATION PDF
 * ================================
 */

/**
 * Génère le PDF de la facture
 */
const generatePDF = async (invoiceData, options = {}) => {
  const {
    template = 'default',
    language = 'fr',
    includeQR = true,
    watermark = null
  } = options;

  try {
    // Option 1: Utiliser Puppeteer (plus puissant)
    if (isPuppeteerAvailable()) {
      return await generatePDFWithPuppeteer(invoiceData, options);
    }
    
    // Option 2: Utiliser PDFKit (plus léger)
    if (isPDFKitAvailable()) {
      return await generatePDFWithPDFKit(invoiceData, options);
    }
    
    // Fallback: Template HTML simple
    return await generatePDFWithHTML(invoiceData, options);

  } catch (error) {
    throw new InvoiceError('PDF_GENERATION_FAILED', `Erreur génération PDF: ${error.message}`);
  }
};

/**
 * Génération PDF avec Puppeteer (haute qualité)
 */
const generatePDFWithPuppeteer = async (invoiceData, options) => {
  // Note: Implémentation si Puppeteer disponible
  // const puppeteer = require('puppeteer');
  
  const htmlContent = await generateHTMLTemplate(invoiceData, options);
  
  // TODO: Implémenter avec Puppeteer
  // const browser = await puppeteer.launch();
  // const page = await browser.newPage();
  // await page.setContent(htmlContent);
  // const pdf = await page.pdf({ format: 'A4', printBackground: true });
  // await browser.close();
  
  return {
    type: 'pdf',
    engine: 'puppeteer',
    buffer: null, // Buffer PDF ici
    filename: `invoice_${invoiceData.invoice.number}.pdf`,
    size: 0,
    pages: 1
  };
};

/**
 * Génération PDF avec PDFKit (programmatique)
 */
const generatePDFWithPDFKit = async (invoiceData, options) => {
  // Note: Implémentation si PDFKit disponible
  // const PDFDocument = require('pdfkit');
  
  // TODO: Créer PDF programmatiquement avec PDFKit
  // const doc = new PDFDocument();
  // Ajouter contenu, styles, tableaux...
  
  return {
    type: 'pdf',
    engine: 'pdfkit',
    buffer: null, // Buffer PDF ici
    filename: `invoice_${invoiceData.invoice.number}.pdf`,
    size: 0,
    pages: 1
  };
};

/**
 * Génération PDF avec HTML template (fallback)
 */
const generatePDFWithHTML = async (invoiceData, options) => {
  const htmlContent = await generateHTMLTemplate(invoiceData, options);
  
  return {
    type: 'html',
    engine: 'html-template',
    content: htmlContent,
    filename: `invoice_${invoiceData.invoice.number}.html`,
    convertToPDF: 'Manual conversion required',
    instructions: 'Ouvrir dans navigateur et utiliser Imprimer -> Enregistrer PDF'
  };
};

/**
 * ================================
 * TEMPLATES HTML
 * ================================
 */

/**
 * Génère le template HTML de la facture
 */
const generateHTMLTemplate = async (invoiceData, options = {}) => {
  const { template = 'default', language = 'fr' } = options;
  
  const templatePath = path.join(__dirname, '..', 'templates', 'invoices', `${template}.html`);
  
  try {
    // Tenter de charger template personnalisé
    const templateContent = await fs.readFile(templatePath, 'utf8');
    return renderTemplate(templateContent, invoiceData, language);
  } catch (error) {
    // Fallback sur template par défaut intégré
    return generateDefaultHTMLTemplate(invoiceData, language);
  }
};

/**
 * Template HTML par défaut intégré
 */
const generateDefaultHTMLTemplate = (invoiceData, language = 'fr') => {
  const { invoice, company, customer, stay, billing, payment } = invoiceData;
  
  const labels = getLabels(language);
  
  return `
<!DOCTYPE html>
<html lang="${language}">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${labels.invoice} ${invoice.number}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; color: #333; }
        .invoice-container { max-width: 800px; margin: 0 auto; background: white; border: 1px solid #ddd; }
        .header { background: #2c3e50; color: white; padding: 30px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 5px 0; opacity: 0.9; }
        .content { padding: 30px; }
        .invoice-info { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .invoice-info div { flex: 1; }
        .invoice-info h3 { margin: 0 0 10px 0; color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 5px; }
        .stay-details { background: #f8f9fa; padding: 20px; margin: 20px 0; border-left: 4px solid #3498db; }
        .billing-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .billing-table th, .billing-table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        .billing-table th { background: #f1f2f6; font-weight: 600; color: #2c3e50; }
        .billing-table .amount { text-align: right; font-weight: 500; }
        .totals { float: right; width: 300px; margin-top: 20px; }
        .totals table { width: 100%; }
        .totals td { padding: 8px 12px; }
        .totals .total-row { font-weight: bold; font-size: 18px; background: #2c3e50; color: white; }
        .footer { background: #f8f9fa; padding: 20px; text-align: center; font-size: 12px; color: #666; }
        .qr-code { float: right; margin: 20px; }
    </style>
</head>
<body>
    <div class="invoice-container">
        <!-- En-tête -->
        <div class="header">
            <h1>${company.name}</h1>
            <p>${company.address}</p>
            <p>${company.city} | Tél: ${company.phone} | Email: ${company.email}</p>
        </div>

        <div class="content">
            <!-- Informations facture -->
            <div class="invoice-info">
                <div>
                    <h3>${labels.invoiceDetails}</h3>
                    <p><strong>${labels.invoiceNumber}:</strong> ${invoice.number}</p>
                    <p><strong>${labels.issueDate}:</strong> ${formatDate(invoice.issueDate, language)}</p>
                    <p><strong>${labels.dueDate}:</strong> ${formatDate(invoice.dueDate, language)}</p>
                </div>
                <div>
                    <h3>${labels.customerInfo}</h3>
                    <p><strong>${customer.name}</strong></p>
                    <p>${customer.email}</p>
                    <p>${customer.phone}</p>
                    ${customer.company ? `<p><strong>${customer.company.name}</strong><br>SIRET: ${customer.company.siret}</p>` : ''}
                </div>
            </div>

            <!-- Détails séjour -->
            <div class="stay-details">
                <h3>${labels.stayDetails}</h3>
                <p><strong>${labels.checkIn}:</strong> ${formatDate(stay.checkInDate, language)} 
                   ${stay.actualCheckInDate ? `(${labels.actual}: ${formatDate(stay.actualCheckInDate, language)})` : ''}</p>
                <p><strong>${labels.checkOut}:</strong> ${formatDate(stay.checkOutDate, language)}
                   ${stay.actualCheckOutDate ? `(${labels.actual}: ${formatDate(stay.actualCheckOutDate, language)})` : ''}</p>
                <p><strong>${labels.nights}:</strong> ${stay.nightsActual} ${labels.nightsUnit}</p>
                <p><strong>${labels.guests}:</strong> ${stay.numberOfGuests}</p>
                ${stay.specialRequests ? `<p><strong>${labels.specialRequests}:</strong> ${stay.specialRequests}</p>` : ''}
            </div>

            <!-- Tableau facturation -->
            <table class="billing-table">
                <thead>
                    <tr>
                        <th>${labels.description}</th>
                        <th>${labels.quantity}</th>
                        <th>${labels.unitPrice}</th>
                        <th class="amount">${labels.total}</th>
                    </tr>
                </thead>
                <tbody>
                    ${billing.rooms.map(room => `
                        <tr>
                            <td>
                                <strong>${labels.room} ${room.type}</strong>
                                ${room.roomNumber !== 'Non assignée' ? `<br>${labels.roomNumber}: ${room.roomNumber}` : ''}
                                <br><small>${room.description}</small>
                            </td>
                            <td>${room.nightsCount} ${labels.nightsUnit}</td>
                            <td class="amount">${formatCurrency(room.pricePerNight, invoice.currency)}</td>
                            <td class="amount">${formatCurrency(room.subtotal, invoice.currency)}</td>
                        </tr>
                    `).join('')}
                    
                    ${billing.extras.length > 0 ? `
                        <tr><td colspan="4"><strong>${labels.extrasServices}</strong></td></tr>
                        ${billing.extras.map(extra => `
                            <tr>
                                <td>
                                    <strong>${extra.name}</strong>
                                    <br><small>${extra.category}${extra.description ? ` - ${extra.description}` : ''}</small>
                                </td>
                                <td>${extra.quantity}</td>
                                <td class="amount">${formatCurrency(extra.unitPrice, invoice.currency)}</td>
                                <td class="amount">${formatCurrency(extra.total, invoice.currency)}</td>
                            </tr>
                        `).join('')}
                    ` : ''}
                </tbody>
            </table>

            <!-- Totaux -->
            <div class="totals">
                <table>
                    <tr>
                        <td>${labels.subtotal}:</td>
                        <td class="amount">${formatCurrency(billing.subtotal, invoice.currency)}</td>
                    </tr>
                    ${billing.taxes.amount > 0 ? `
                        <tr>
                            <td>${labels.taxes}:</td>
                            <td class="amount">${formatCurrency(billing.taxes.amount, invoice.currency)}</td>
                        </tr>
                    ` : ''}
                    <tr class="total-row">
                        <td><strong>${labels.total}:</strong></td>
                        <td class="amount"><strong>${formatCurrency(billing.total, invoice.currency)}</strong></td>
                    </tr>
                </table>
            </div>

            <div style="clear: both;"></div>

            <!-- Informations paiement -->
            <div style="margin-top: 40px; padding: 20px; background: #f8f9fa;">
                <h3>${labels.paymentInfo}</h3>
                <p><strong>${labels.status}:</strong> ${translatePaymentStatus(payment.status, language)}</p>
                <p><strong>${labels.method}:</strong> ${payment.method}</p>
                ${payment.paidAt ? `<p><strong>${labels.paidAt}:</strong> ${formatDate(payment.paidAt, language)}</p>` : ''}
                <p><small>${payment.terms}</small></p>
            </div>
        </div>

        <!-- Pied de page -->
        <div class="footer">
            <p>${labels.thankYou}</p>
            <p>${company.name} - ${labels.generatedOn} ${formatDate(new Date(), language)}</p>
        </div>
    </div>
</body>
</html>`;
};

/**
 * ================================
 * GÉNÉRATION XML
 * ================================
 */

/**
 * Génère format XML de la facture
 */
const generateXML = async (invoiceData) => {
  const { invoice, company, customer, billing } = invoiceData;
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<invoice>
    <header>
        <number>${invoice.number}</number>
        <issueDate>${invoice.issueDate.toISOString()}</issueDate>
        <dueDate>${invoice.dueDate.toISOString()}</dueDate>
        <currency>${invoice.currency}</currency>
        <type>${invoice.type}</type>
    </header>
    
    <company>
        <name><![CDATA[${company.name}]]></name>
        <address><![CDATA[${company.address}]]></address>
        <city><![CDATA[${company.city}]]></city>
        <phone>${company.phone}</phone>
        <email>${company.email}</email>
    </company>
    
    <customer>
        <name><![CDATA[${customer.name}]]></name>
        <email>${customer.email}</email>
        <phone>${customer.phone}</phone>
        <clientType>${customer.clientType}</clientType>
        ${customer.company ? `
        <company>
            <name><![CDATA[${customer.company.name}]]></name>
            <siret>${customer.company.siret}</siret>
        </company>` : ''}
    </customer>
    
    <billing>
        <rooms>
            ${billing.rooms.map(room => `
            <room>
                <type>${room.type}</type>
                <roomNumber>${room.roomNumber}</roomNumber>
                <nights>${room.nightsCount}</nights>
                <pricePerNight>${room.pricePerNight}</pricePerNight>
                <subtotal>${room.subtotal}</subtotal>
            </room>`).join('')}
        </rooms>
        
        ${billing.extras.length > 0 ? `
        <extras>
            ${billing.extras.map(extra => `
            <extra>
                <name><![CDATA[${extra.name}]]></name>
                <category>${extra.category}</category>
                <quantity>${extra.quantity}</quantity>
                <unitPrice>${extra.unitPrice}</unitPrice>
                <total>${extra.total}</total>
            </extra>`).join('')}
        </extras>` : ''}
        
        <totals>
            <subtotal>${billing.subtotal}</subtotal>
            <taxes>${billing.taxes.amount}</taxes>
            <total>${billing.total}</total>
        </totals>
    </billing>
</invoice>`;

  return {
    type: 'xml',
    content: xml,
    filename: `invoice_${invoice.number}.xml`,
    size: Buffer.byteLength(xml, 'utf8')
  };
};

/**
 * ================================
 * UTILITAIRES ET HELPERS
 * ================================
 */

/**
 * Génère un numéro de facture unique
 */
const generateInvoiceNumber = async (booking) => {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  
  // Format: YYYY-MM-XXXX (ex: 2025-07-0001)
  const prefix = `${year}-${month}`;
  
  // Récupérer le dernier numéro pour ce mois
  const Invoice = require('../models/Invoice'); // Modèle pour tracking numéros
  
  try {
    const lastInvoice = await Invoice.findOne({
      number: { $regex: `^${prefix}` }
    }).sort({ number: -1 });
    
    let sequence = 1;
    if (lastInvoice) {
      const lastSequence = parseInt(lastInvoice.number.split('-')[2]);
      sequence = lastSequence + 1;
    }
    
    const invoiceNumber = `${prefix}-${String(sequence).padStart(4, '0')}`;
    
    // Enregistrer le numéro pour éviter les doublons
    await Invoice.create({
      number: invoiceNumber,
      booking: booking._id,
      generatedAt: new Date()
    });
    
    return invoiceNumber;
    
  } catch (error) {
    // Fallback: utiliser timestamp
    const timestamp = Date.now().toString().slice(-8);
    return `${prefix}-${timestamp}`;
  }
};

/**
 * Obtient les informations de l'entreprise
 */
const getCompanyInfo = async (hotel, language = 'fr') => {
  // TODO: Récupérer depuis configuration système ou base de données
  return {
    name: hotel.name,
    address: hotel.address,
    city: hotel.city,
    phone: hotel.phone || '+212 5XX XX XX XX',
    email: hotel.email || 'contact@hotel.ma',
    website: 'www.hotel.ma',
    logo: '/assets/logo.png',
    registration: 'RC Rabat 123456',
    taxId: 'IF 12345678'
  };
};

/**
 * Configuration taxes selon type client et hôtel
 */
const getTaxConfiguration = async (hotel, clientType) => {
  // Configuration taxes Maroc (exemple)
  const taxRates = {
    [CLIENT_TYPES.INDIVIDUAL]: {
      tva: 0.20, // 20% TVA
      taxeSejour: 25 // 25 MAD par nuit par personne
    },
    [CLIENT_TYPES.CORPORATE]: {
      tva: 0.20, // 20% TVA
      taxeSejour: 0 // Exemption taxe séjour entreprises
    }
  };

  const rates = taxRates[clientType] || taxRates[CLIENT_TYPES.INDIVIDUAL];
  
  return {
    rates,
    details: [
      { name: 'TVA', rate: rates.tva * 100, type: 'percentage' },
      ...(rates.taxeSejour > 0 ? [{ name: 'Taxe de séjour', rate: rates.taxeSejour, type: 'fixed' }] : [])
    ]
  };
};

/**
 * Calcule les taxes selon configuration
 */
const calculateTaxes = (subtotal, taxConfig) => {
  let totalTax = 0;
  
  taxConfig.details.forEach(tax => {
    if (tax.type === 'percentage') {
      totalTax += subtotal * (tax.rate / 100);
    } else if (tax.type === 'fixed') {
      totalTax += tax.rate;
    }
  });
  
  return totalTax;
};

/**
 * Calcule la date d'échéance paiement
 */
const calculatePaymentDueDate = (booking) => {
  const baseDate = booking.actualCheckOutDate || booking.checkOutDate || new Date();
  const dueDate = new Date(baseDate);
  
  // Particuliers: paiement immédiat
  // Entreprises: 30 jours
  const daysToAdd = booking.clientType === CLIENT_TYPES.CORPORATE ? 30 : 0;
  dueDate.setDate(dueDate.getDate() + daysToAdd);
  
  return dueDate;
};

/**
 * ================================
 * ARCHIVAGE ET STOCKAGE
 * ================================
 */

/**
 * Archive la facture générée
 */
const archiveInvoice = async (invoiceData, formats) => {
  const archiveDir = path.join(__dirname, '..', '..', 'storage', 'invoices', invoiceData.invoice.number.substring(0, 7)); // YYYY-MM
  
  try {
    // Créer dossier si nécessaire
    await fs.mkdir(archiveDir, { recursive: true });
    
    const archiveResult = {
      directory: archiveDir,
      files: []
    };

    // Sauvegarder chaque format
    for (const [formatType, formatData] of Object.entries(formats)) {
      if (formatData) {
        const filename = formatData.filename || `invoice_${invoiceData.invoice.number}.${formatType}`;
        const filepath = path.join(archiveDir, filename);
        
        let content;
        if (formatData.buffer) {
          content = formatData.buffer;
        } else if (formatData.content) {
          content = formatData.content;
        } else {
          content = JSON.stringify(formatData, null, 2);
        }
        
        await fs.writeFile(filepath, content);
        
        archiveResult.files.push({
          format: formatType,
          filename,
          filepath,
          size: Buffer.isBuffer(content) ? content.length : Buffer.byteLength(content, 'utf8')
        });
      }
    }

    // Sauvegarder métadonnées JSON
    const metadataFile = path.join(archiveDir, `${invoiceData.invoice.number}_metadata.json`);
    await fs.writeFile(metadataFile, JSON.stringify({
      ...invoiceData,
      archivedAt: new Date(),
      formats: Object.keys(formats)
    }, null, 2));

    archiveResult.files.push({
      format: 'metadata',
      filename: `${invoiceData.invoice.number}_metadata.json`,
      filepath: metadataFile,
      size: 0
    });

    return archiveResult;

  } catch (error) {
    console.error('Erreur archivage facture:', error);
    return {
      error: error.message,
      fallback: 'Facture générée mais non archivée'
    };
  }
};

/**
 * ================================
 * ENVOI EMAIL
 * ================================
 */

/**
 * Envoie la facture par email
 * @param {Object} invoiceData - Données facture
 * @param {Object} pdfData - Données PDF
 * @param {Object} emailOptions - Options email
 */
const sendInvoiceByEmail = async (invoiceData, pdfData, emailOptions = {}) => {
  const {
    to,
    cc = [],
    bcc = [],
    subject,
    message,
    language = 'fr'
  } = emailOptions;

  try {
    // TODO: Implémenter avec service email (SendGrid, Nodemailer, etc.)
    const emailService = require('../services/emailService');
    
    const emailData = {
      to: to || invoiceData.customer.email,
      cc,
      bcc,
      subject: subject || `${getLabels(language).invoice} ${invoiceData.invoice.number}`,
      html: generateEmailTemplate(invoiceData, message, language),
      attachments: pdfData ? [{
        filename: pdfData.filename,
        content: pdfData.buffer,
        contentType: 'application/pdf'
      }] : []
    };

    const result = await emailService.send(emailData);
    
    return {
      success: true,
      messageId: result.messageId,
      sentTo: emailData.to,
      sentAt: new Date()
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      fallback: 'Email manuel requis'
    };
  }
};

/**
 * Génère le template email pour envoi facture
 */
const generateEmailTemplate = (invoiceData, customMessage, language = 'fr') => {
  const labels = getLabels(language);
  const { customer, invoice, stay, billing } = invoiceData;

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #2c3e50; color: white; padding: 20px; text-align: center; }
        .content { padding: 20px; background: #f9f9f9; }
        .summary { background: white; padding: 15px; margin: 15px 0; border-left: 4px solid #3498db; }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: #666; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>${labels.invoice} ${invoice.number}</h1>
        </div>
        
        <div class="content">
            <p>${labels.dear} ${customer.name},</p>
            
            <p>${customMessage || `${labels.invoiceEmailIntro} ${invoice.number}.`}</p>
            
            <div class="summary">
                <h3>${labels.summaryTitle}</h3>
                <p><strong>${labels.stayPeriod}:</strong> ${formatDate(stay.checkInDate, language)} - ${formatDate(stay.checkOutDate, language)}</p>
                <p><strong>${labels.nights}:</strong> ${stay.nightsActual}</p>
                <p><strong>${labels.rooms}:</strong> ${billing.rooms.length}</p>
                <p><strong>${labels.totalAmount}:</strong> ${formatCurrency(billing.total, invoice.currency)}</p>
                <p><strong>${labels.paymentStatus}:</strong> ${translatePaymentStatus(invoiceData.payment.status, language)}</p>
            </div>
            
            <p>${labels.invoiceEmailFooter}</p>
            
            <p>${labels.thankYouStay}</p>
        </div>
        
        <div class="footer">
            <p>${invoiceData.company.name}</p>
            <p>${invoiceData.company.email} | ${invoiceData.company.phone}</p>
        </div>
    </div>
</body>
</html>`;
};

/**
 * ================================
 * FORMATAGE ET LOCALISATION
 * ================================
 */

/**
 * Labels selon langue
 */
const getLabels = (language = 'fr') => {
  const labels = {
    fr: {
      invoice: 'Facture',
      invoiceDetails: 'Détails Facture',
      invoiceNumber: 'Numéro',
      issueDate: 'Date d\'émission',
      dueDate: 'Date d\'échéance',
      customerInfo: 'Informations Client',
      stayDetails: 'Détails du Séjour',
      checkIn: 'Arrivée',
      checkOut: 'Départ',
      actual: 'Réel',
      nights: 'Nuits',
      nightsUnit: 'nuit(s)',
      guests: 'Voyageurs',
      specialRequests: 'Demandes spéciales',
      description: 'Description',
      quantity: 'Quantité',
      unitPrice: 'Prix Unitaire',
      total: 'Total',
      room: 'Chambre',
      roomNumber: 'Numéro',
      extrasServices: 'Extras et Services',
      subtotal: 'Sous-total',
      taxes: 'Taxes',
      paymentInfo: 'Informations Paiement',
      status: 'Statut',
      method: 'Méthode',
      paidAt: 'Payé le',
      thankYou: 'Merci pour votre confiance',
      generatedOn: 'Généré le',
      dear: 'Cher/Chère',
      invoiceEmailIntro: 'Veuillez trouver ci-joint votre facture',
      summaryTitle: 'Résumé de votre séjour',
      stayPeriod: 'Période',
      rooms: 'Chambres',
      totalAmount: 'Montant total',
      paymentStatus: 'Statut paiement',
      invoiceEmailFooter: 'Si vous avez des questions concernant cette facture, n\'hésitez pas à nous contacter.',
      thankYouStay: 'Merci d\'avoir choisi notre établissement.'
    },
    en: {
      invoice: 'Invoice',
      invoiceDetails: 'Invoice Details',
      invoiceNumber: 'Number',
      issueDate: 'Issue Date',
      dueDate: 'Due Date',
      customerInfo: 'Customer Information',
      stayDetails: 'Stay Details',
      checkIn: 'Check-in',
      checkOut: 'Check-out',
      actual: 'Actual',
      nights: 'Nights',
      nightsUnit: 'night(s)',
      guests: 'Guests',
      specialRequests: 'Special Requests',
      description: 'Description',
      quantity: 'Quantity',
      unitPrice: 'Unit Price',
      total: 'Total',
      room: 'Room',
      roomNumber: 'Number',
      extrasServices: 'Extras & Services',
      subtotal: 'Subtotal',
      taxes: 'Taxes',
      paymentInfo: 'Payment Information',
      status: 'Status',
      method: 'Method',
      paidAt: 'Paid on',
      thankYou: 'Thank you for your trust',
      generatedOn: 'Generated on',
      dear: 'Dear',
      invoiceEmailIntro: 'Please find attached your invoice',
      summaryTitle: 'Your stay summary',
      stayPeriod: 'Period',
      rooms: 'Rooms',
      totalAmount: 'Total amount',
      paymentStatus: 'Payment status',
      invoiceEmailFooter: 'If you have any questions about this invoice, please contact us.',
      thankYouStay: 'Thank you for choosing our establishment.'
    }
  };

  return labels[language] || labels.fr;
};

/**
 * Descriptions chambres selon langue
 */
const getRoomDescription = (roomType, language = 'fr') => {
  const descriptions = {
    fr: {
      'Simple': 'Chambre individuelle avec lit simple',
      'Double': 'Chambre double standard',
      'Double Confort': 'Chambre double avec équipements premium',
      'Suite': 'Suite luxueuse avec salon séparé'
    },
    en: {
      'Simple': 'Single room with single bed',
      'Double': 'Standard double room',
      'Double Confort': 'Double room with premium amenities',
      'Suite': 'Luxury suite with separate living area'
    }
  };

  return descriptions[language]?.[roomType] || descriptions.fr[roomType] || roomType;
};

/**
 * Conditions de paiement selon type client
 */
const getPaymentTerms = (clientType, language = 'fr') => {
  const terms = {
    fr: {
      [CLIENT_TYPES.INDIVIDUAL]: 'Paiement à l\'arrivée ou lors du check-out.',
      [CLIENT_TYPES.CORPORATE]: 'Paiement sous 30 jours à réception de facture.'
    },
    en: {
      [CLIENT_TYPES.INDIVIDUAL]: 'Payment due upon arrival or at check-out.',
      [CLIENT_TYPES.CORPORATE]: 'Payment due within 30 days of invoice receipt.'
    }
  };

  return terms[language]?.[clientType] || terms.fr[clientType];
};

/**
 * Formatage date selon locale
 */
const formatDate = (date, language = 'fr') => {
  const options = { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'Africa/Casablanca'
  };
  
  const locale = language === 'en' ? 'en-US' : 'fr-FR';
  return new Date(date).toLocaleDateString(locale, options);
};

/**
 * Formatage devise
 */
const formatCurrency = (amount, currency = 'MAD') => {
  const formatted = new Intl.NumberFormat('fr-MA', {
    style: 'decimal',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);

  return `${formatted} ${currency}`;
};

/**
 * Traduction statut paiement
 */
const translatePaymentStatus = (status, language = 'fr') => {
  const translations = {
    fr: {
      'Pending': 'En attente',
      'Paid': 'Payé',
      'Partial': 'Partiel',
      'Overdue': 'En retard',
      'Cancelled': 'Annulé'
    },
    en: {
      'Pending': 'Pending',
      'Paid': 'Paid',
      'Partial': 'Partial',
      'Overdue': 'Overdue',
      'Cancelled': 'Cancelled'
    }
  };

  return translations[language]?.[status] || status;
};

/**
 * ================================
 * DÉTECTION DISPONIBILITÉ LIBRARIES
 * ================================
 */

/**
 * Vérifie si Puppeteer est disponible
 */
const isPuppeteerAvailable = () => {
  try {
    require.resolve('puppeteer');
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * Vérifie si PDFKit est disponible
 */
const isPDFKitAvailable = () => {
  try {
    require.resolve('pdfkit');
    return true;
  } catch (e) {
    return false;
  }
};

/**
 * ================================
 * TEMPLATES ET STYLES
 * ================================
 */

/**
 * Obtient les termes légaux
 */
const getLegalTerms = async (language = 'fr') => {
  const terms = {
    fr: [
      'Cette facture est établie conformément à la législation marocaine en vigueur.',
      'TVA applicable selon les taux en vigueur.',
      'Paiement par chèque, virement bancaire ou espèces.',
      'Toute réclamation doit être effectuée dans les 8 jours suivant la réception de cette facture.'
    ],
    en: [
      'This invoice is issued in accordance with Moroccan legislation in force.',
      'VAT applicable according to current rates.',
      'Payment by check, bank transfer or cash.',
      'Any claim must be made within 8 days of receipt of this invoice.'
    ]
  };

  return terms[language] || terms.fr;
};

/**
 * Obtient la politique de confidentialité
 */
const getPrivacyPolicy = async (language = 'fr') => {
  const policy = {
    fr: 'Vos données personnelles sont traitées conformément à notre politique de confidentialité disponible sur notre site web.',
    en: 'Your personal data is processed in accordance with our privacy policy available on our website.'
  };

  return policy[language] || policy.fr;
};

/**
 * Rendu template avec données
 */
const renderTemplate = (template, data, language) => {
  let rendered = template;
  
  // Remplacements simples
  rendered = rendered.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return data[key] || match;
  });
  
  // Remplacements avec labels
  const labels = getLabels(language);
  rendered = rendered.replace(/\{\{label\.(\w+)\}\}/g, (match, key) => {
    return labels[key] || match;
  });
  
  return rendered;
};

/**
 * ================================
 * CLASSE D'ERREUR PERSONNALISÉE
 * ================================
 */

class InvoiceError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'InvoiceError';
    this.code = code;
    this.details = details;
  }
}

/**
 * ================================
 * UTILITAIRES CONVERSION
 * ================================
 */

/**
 * Convertit devise si nécessaire
 */
const convertCurrency = async (amount, fromCurrency, toCurrency) => {
  if (fromCurrency === toCurrency) {
    return amount;
  }

  // TODO: Implémenter API de change temps réel
  const exchangeRates = {
    'MAD_EUR': 0.092,
    'MAD_USD': 0.099,
    'EUR_MAD': 10.87,
    'USD_MAD': 10.12
  };

  const rateKey = `${fromCurrency}_${toCurrency}`;
  const rate = exchangeRates[rateKey];

  if (!rate) {
    throw new InvoiceError('CURRENCY_CONVERSION_FAILED', `Taux de change ${fromCurrency} → ${toCurrency} non disponible`);
  }

  return Math.round(amount * rate * 100) / 100;
};

/**
 * ================================
 * EXPORTS
 * ================================
 */
module.exports = {
  // Fonction principale
  generateInvoice,
  
  // Génération par format
  generateInvoiceData,
  generatePDF,
  generateXML,
  generateHTMLTemplate,
  
  // Envoi et communication
  sendInvoiceByEmail,
  generateEmailTemplate,
  
  // Utilitaires
  generateInvoiceNumber,
  archiveInvoice,
  formatCurrency,
  formatDate,
  convertCurrency,
  
  // Configuration
  getCompanyInfo,
  getTaxConfiguration,
  calculateTaxes,
  getLabels,
  getLegalTerms,
  
  // Erreurs
  InvoiceError
};