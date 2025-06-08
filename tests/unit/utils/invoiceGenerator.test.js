/**
 * TESTS INVOICE GENERATOR - VALIDATION COMPLÈTE SYSTÈME FACTURES
 * Tests critiques pour génération factures PDF, calculs fiscaux, archivage
 * 
 * Coverage :
 * - Génération données structurées
 * - Calculs taxes et totaux
 * - Numérotation séquentielle
 * - Templates HTML/XML
 * - Archivage et stockage
 * - Formatage multi-langues
 * - Gestion erreurs
 */

const {
  generateInvoice,
  generateInvoiceData,
  generateInvoiceNumber,
  generateXML,
  generateHTMLTemplate,
  calculateTaxes,
  getTaxConfiguration,
  formatCurrency,
  formatDate,
  getLabels,
  archiveInvoice,
  InvoiceError
} = require('../../../src/utils/invoiceGenerator');

const { CLIENT_TYPES } = require('../../../src/utils/constants');

// Mocks
const fs = require('fs').promises;
const path = require('path');

jest.mock('fs', () => ({
  promises: {
    writeFile: jest.fn(),
    readFile: jest.fn(),
    mkdir: jest.fn()
  }
}));

jest.mock('../../../src/models/Invoice', () => ({
  findOne: jest.fn(),
  create: jest.fn()
}));

describe('Invoice Generator Utils', () => {
  let mockBooking;
  let mockHotel;
  let mockCustomer;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock booking complet avec toutes les données
    mockCustomer = {
      _id: 'customer123',
      firstName: 'Ahmed',
      lastName: 'Bennani',
      email: 'ahmed@example.com',
      phone: '+212661234567',
      address: '123 Rue Mohammed V, Rabat',
      clientType: CLIENT_TYPES.INDIVIDUAL
    };

    mockHotel = {
      _id: 'hotel123',
      name: 'Hôtel Atlas Rabat',
      code: 'RAB001',
      address: 'Avenue Mohammed V',
      city: 'Rabat',
      phone: '+212537123456',
      email: 'contact@atlas-rabat.ma',
      category: 4
    };

    mockBooking = {
      _id: 'booking123',
      hotel: mockHotel,
      customer: mockCustomer,
      checkInDate: new Date('2025-07-15'),
      checkOutDate: new Date('2025-07-18'),
      actualCheckInDate: new Date('2025-07-15T14:00:00Z'),
      actualCheckOutDate: new Date('2025-07-18T11:00:00Z'),
      status: 'Completed',
      source: 'Web',
      clientType: CLIENT_TYPES.INDIVIDUAL,
      numberOfGuests: 2,
      specialRequests: 'Chambre avec vue sur mer',
      guestNotes: 'Clients VIP',
      rooms: [
        {
          type: 'Double Confort',
          basePrice: 350,
          calculatedPrice: 1260, // 3 nuits × 420 MAD (avec multiplicateurs)
          room: {
            _id: 'room123',
            number: '301',
            floor: 3
          }
        }
      ],
      extras: [
        {
          name: 'Mini-bar',
          category: 'Boissons',
          price: 150,
          quantity: 1,
          total: 150,
          description: 'Consommation mini-bar',
          addedAt: new Date('2025-07-16'),
          addedBy: 'staff123'
        },
        {
          name: 'Room service',
          category: 'Restauration',
          price: 280,
          quantity: 2,
          total: 560,
          description: 'Petit-déjeuner en chambre',
          addedAt: new Date('2025-07-17'),
          addedBy: 'staff123'
        }
      ],
      totalPrice: 1970, // 1260 + 150 + 560
      extrasTotal: 710,
      paymentStatus: 'Paid',
      paymentMethod: 'Carte bancaire',
      paidAt: new Date('2025-07-18T12:00:00Z'),
      createdAt: new Date('2025-07-10'),
      confirmedAt: new Date('2025-07-11'),
      checkedInBy: 'receptionist123',
      checkedOutBy: 'receptionist123'
    };
  });

  /**
   * ================================
   * TESTS GÉNÉRATION DONNÉES STRUCTURÉES
   * ================================
   */
  describe('generateInvoiceData', () => {
    it('devrait générer des données de facture complètes', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData).toHaveProperty('invoice');
      expect(invoiceData).toHaveProperty('company');
      expect(invoiceData).toHaveProperty('customer');
      expect(invoiceData).toHaveProperty('stay');
      expect(invoiceData).toHaveProperty('billing');
      expect(invoiceData).toHaveProperty('payment');
      expect(invoiceData).toHaveProperty('booking');
      expect(invoiceData).toHaveProperty('legal');
    });

    it('devrait calculer correctement les détails du séjour', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.stay.nightsBooked).toBe(3);
      expect(invoiceData.stay.nightsActual).toBe(3);
      expect(invoiceData.stay.numberOfGuests).toBe(2);
      expect(invoiceData.stay.checkInDate).toEqual(mockBooking.checkInDate);
      expect(invoiceData.stay.checkOutDate).toEqual(mockBooking.checkOutDate);
      expect(invoiceData.stay.actualCheckInDate).toEqual(mockBooking.actualCheckInDate);
      expect(invoiceData.stay.actualCheckOutDate).toEqual(mockBooking.actualCheckOutDate);
    });

    it('devrait traiter correctement les détails des chambres', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.billing.rooms).toHaveLength(1);
      
      const room = invoiceData.billing.rooms[0];
      expect(room.type).toBe('Double Confort');
      expect(room.roomNumber).toBe('301');
      expect(room.floor).toBe(3);
      expect(room.basePrice).toBe(350);
      expect(room.nightsCount).toBe(3);
      expect(room.subtotal).toBe(1260);
      expect(room.pricePerNight).toBe(420); // 1260 / 3
    });

    it('devrait traiter correctement les extras', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.billing.extras).toHaveLength(2);
      
      const minibar = invoiceData.billing.extras[0];
      expect(minibar.name).toBe('Mini-bar');
      expect(minibar.category).toBe('Boissons');
      expect(minibar.unitPrice).toBe(150);
      expect(minibar.quantity).toBe(1);
      expect(minibar.total).toBe(150);

      const roomService = invoiceData.billing.extras[1];
      expect(roomService.name).toBe('Room service');
      expect(roomService.category).toBe('Restauration');
      expect(roomService.unitPrice).toBe(280);
      expect(roomService.quantity).toBe(2);
      expect(roomService.total).toBe(560);
    });

    it('devrait calculer correctement les totaux avec taxes', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.billing.roomsSubtotal).toBe(1260);
      expect(invoiceData.billing.extrasSubtotal).toBe(710);
      expect(invoiceData.billing.subtotal).toBe(1970);
      
      // Vérifier calcul taxes (20% TVA + taxe séjour si applicable)
      expect(invoiceData.billing.taxes.amount).toBeGreaterThan(0);
      expect(invoiceData.billing.total).toBeGreaterThan(1970);
    });

    it('devrait gérer les réservations corporate', async () => {
      mockBooking.clientType = CLIENT_TYPES.CORPORATE;
      mockBooking.corporateDetails = {
        companyName: 'Tech Solutions Maroc',
        siret: '12345678901234',
        contactPerson: 'Directeur Commercial',
        address: '456 Boulevard Zerktouni, Casablanca'
      };

      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.invoice.type).toBe('CORPORATE');
      expect(invoiceData.customer.company).toBeDefined();
      expect(invoiceData.customer.company.name).toBe('Tech Solutions Maroc');
      expect(invoiceData.customer.company.siret).toBe('12345678901234');
    });

    it('devrait gérer les options de langue et devise', async () => {
      const invoiceData = await generateInvoiceData(mockBooking, {
        language: 'en',
        currency: 'EUR',
        customData: { project: 'Mission Casablanca' }
      });

      expect(invoiceData.invoice.language).toBe('en');
      expect(invoiceData.invoice.currency).toBe('EUR');
      expect(invoiceData.custom.project).toBe('Mission Casablanca');
    });
  });

  /**
   * ================================
   * TESTS NUMÉROTATION FACTURES
   * ================================
   */
  describe('generateInvoiceNumber', () => {
    const Invoice = require('../../../src/models/Invoice');

    beforeEach(() => {
      // Mock date pour tests prévisibles
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-07-15'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('devrait générer un numéro séquentiel pour le premier invoice du mois', async () => {
      Invoice.findOne.mockResolvedValue(null);
      Invoice.create.mockResolvedValue({ number: '2025-07-0001' });

      const number = await generateInvoiceNumber(mockBooking);

      expect(number).toBe('2025-07-0001');
      expect(Invoice.findOne).toHaveBeenCalledWith({
        number: { $regex: '^2025-07' }
      });
      expect(Invoice.create).toHaveBeenCalledWith({
        number: '2025-07-0001',
        booking: mockBooking._id,
        generatedAt: expect.any(Date)
      });
    });

    it('devrait incrémenter le numéro séquentiel', async () => {
      Invoice.findOne.mockResolvedValue({ number: '2025-07-0042' });
      Invoice.create.mockResolvedValue({ number: '2025-07-0043' });

      const number = await generateInvoiceNumber(mockBooking);

      expect(number).toBe('2025-07-0043');
    });

    it('devrait utiliser un fallback timestamp en cas d\'erreur', async () => {
      Invoice.findOne.mockRejectedValue(new Error('DB Error'));

      const number = await generateInvoiceNumber(mockBooking);

      expect(number).toMatch(/^2025-07-\d{8}$/);
    });

    it('devrait gérer le changement de mois', async () => {
      jest.setSystemTime(new Date('2025-08-01'));
      Invoice.findOne.mockResolvedValue(null);
      Invoice.create.mockResolvedValue({ number: '2025-08-0001' });

      const number = await generateInvoiceNumber(mockBooking);

      expect(number).toBe('2025-08-0001');
    });
  });

  /**
   * ================================
   * TESTS CALCULS FISCAUX
   * ================================
   */
  describe('Tax Calculations', () => {
    describe('getTaxConfiguration', () => {
      it('devrait retourner la config taxes pour particuliers', async () => {
        const config = await getTaxConfiguration(mockHotel, CLIENT_TYPES.INDIVIDUAL);

        expect(config.rates.tva).toBe(0.20);
        expect(config.rates.taxeSejour).toBe(25);
        expect(config.details).toHaveLength(2);
        expect(config.details[0].name).toBe('TVA');
        expect(config.details[0].rate).toBe(20);
        expect(config.details[1].name).toBe('Taxe de séjour');
      });

      it('devrait retourner la config taxes pour entreprises', async () => {
        const config = await getTaxConfiguration(mockHotel, CLIENT_TYPES.CORPORATE);

        expect(config.rates.tva).toBe(0.20);
        expect(config.rates.taxeSejour).toBe(0); // Exemption entreprises
        expect(config.details).toHaveLength(1); // Seulement TVA
        expect(config.details[0].name).toBe('TVA');
      });
    });

    describe('calculateTaxes', () => {
      it('devrait calculer TVA 20% correctement', () => {
        const taxConfig = {
          details: [
            { name: 'TVA', rate: 20, type: 'percentage' }
          ]
        };

        const result = calculateTaxes(1000, taxConfig);
        expect(result).toBe(200); // 20% de 1000
      });

      it('devrait calculer taxes mixtes (pourcentage + fixe)', () => {
        const taxConfig = {
          details: [
            { name: 'TVA', rate: 20, type: 'percentage' },
            { name: 'Taxe fixe', rate: 50, type: 'fixed' }
          ]
        };

        const result = calculateTaxes(1000, taxConfig);
        expect(result).toBe(250); // 200 (TVA) + 50 (fixe)
      });

      it('devrait gérer les taxes à 0', () => {
        const taxConfig = { details: [] };

        const result = calculateTaxes(1000, taxConfig);
        expect(result).toBe(0);
      });
    });
  });

  /**
   * ================================
   * TESTS GÉNÉRATION XML
   * ================================
   */
  describe('generateXML', () => {
    it('devrait générer XML valide avec structure complète', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);
      const xmlResult = await generateXML(invoiceData);

      expect(xmlResult.type).toBe('xml');
      expect(xmlResult.content).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(xmlResult.content).toContain('<invoice>');
      expect(xmlResult.content).toContain('<header>');
      expect(xmlResult.content).toContain('<company>');
      expect(xmlResult.content).toContain('<customer>');
      expect(xmlResult.content).toContain('<billing>');
      expect(xmlResult.content).toContain('</invoice>');
      expect(xmlResult.filename).toMatch(/^invoice_.*\.xml$/);
    });

    it('devrait inclure toutes les données de facturation', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);
      const xmlResult = await generateXML(invoiceData);

      expect(xmlResult.content).toContain('<n><![CDATA[Ahmed Bennani]]></n>');
      expect(xmlResult.content).toContain('<email>ahmed@example.com</email>');
      expect(xmlResult.content).toContain('<type>Double Confort</type>');
      expect(xmlResult.content).toContain('<roomNumber>301</roomNumber>');
      expect(xmlResult.content).toContain('<nights>3</nights>');
    });

    it('devrait gérer les données corporate dans XML', async () => {
      mockBooking.clientType = CLIENT_TYPES.CORPORATE;
      mockBooking.corporateDetails = {
        companyName: 'Tech Solutions Maroc',
        siret: '12345678901234'
      };

      const invoiceData = await generateInvoiceData(mockBooking);
      const xmlResult = await generateXML(invoiceData);

      expect(xmlResult.content).toContain('<clientType>Corporate</clientType>');
      expect(xmlResult.content).toContain('<n><![CDATA[Tech Solutions Maroc]]></n>');
      expect(xmlResult.content).toContain('<siret>12345678901234</siret>');
    });
  });

  /**
   * ================================
   * TESTS TEMPLATES HTML
   * ================================
   */
  describe('generateHTMLTemplate', () => {
    it('devrait générer template HTML complet', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);
      const html = await generateHTMLTemplate(invoiceData);

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('Hôtel Atlas Rabat');
      expect(html).toContain('Ahmed Bennani');
      expect(html).toContain('Double Confort');
      expect(html).toContain('Mini-bar');
      expect(html).toContain('Room service');
    });

    it('devrait supporter la localisation anglaise', async () => {
      const invoiceData = await generateInvoiceData(mockBooking, { language: 'en' });
      const html = await generateHTMLTemplate(invoiceData, { language: 'en' });

      expect(html).toContain('<html lang="en">');
      expect(html).toContain('Invoice Details');
      expect(html).toContain('Customer Information');
      expect(html).toContain('Stay Details');
      expect(html).toContain('Check-in');
      expect(html).toContain('Check-out');
    });

    it('devrait inclure les styles CSS intégrés', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);
      const html = await generateHTMLTemplate(invoiceData);

      expect(html).toContain('<style>');
      expect(html).toContain('font-family:');
      expect(html).toContain('.invoice-container');
      expect(html).toContain('.billing-table');
      expect(html).toContain('.totals');
    });

    it('devrait formater correctement les montants', async () => {
      const invoiceData = await generateInvoiceData(mockBooking);
      const html = await generateHTMLTemplate(invoiceData);

      // Vérifier format devise MAD
      expect(html).toContain('350,00 MAD');
      expect(html).toContain('150,00 MAD');
      expect(html).toContain('280,00 MAD');
    });
  });

  /**
   * ================================
   * TESTS ARCHIVAGE ET STOCKAGE
   * ================================
   */
  describe('archiveInvoice', () => {
    const mockFormats = {
      pdf: {
        buffer: Buffer.from('fake pdf content'),
        filename: 'invoice_2025-07-0001.pdf'
      },
      json: {
        content: '{"test": "data"}',
        filename: 'invoice_2025-07-0001.json'
      }
    };

    beforeEach(() => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
    });

    it('devrait créer la structure de dossiers correcte', async () => {
      const invoiceData = { 
        invoice: { number: '2025-07-0001' } 
      };

      await archiveInvoice(invoiceData, mockFormats);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('2025-07'),
        { recursive: true }
      );
    });

    it('devrait sauvegarder tous les formats', async () => {
      const invoiceData = { 
        invoice: { number: '2025-07-0001' } 
      };

      const result = await archiveInvoice(invoiceData, mockFormats);

      expect(fs.writeFile).toHaveBeenCalledTimes(3); // pdf + json + metadata
      expect(result.files).toHaveLength(3);
      
      const pdfFile = result.files.find(f => f.format === 'pdf');
      expect(pdfFile.filename).toBe('invoice_2025-07-0001.pdf');
      
      const jsonFile = result.files.find(f => f.format === 'json');
      expect(jsonFile.filename).toBe('invoice_2025-07-0001.json');
    });

    it('devrait sauvegarder les métadonnées', async () => {
      const invoiceData = { 
        invoice: { number: '2025-07-0001' },
        customer: { name: 'Test Customer' }
      };

      await archiveInvoice(invoiceData, mockFormats);

      const metadataCall = fs.writeFile.mock.calls.find(call => 
        call[0].includes('_metadata.json')
      );
      expect(metadataCall).toBeDefined();
      
      const metadataContent = JSON.parse(metadataCall[1]);
      expect(metadataContent.customer.name).toBe('Test Customer');
      expect(metadataContent.archivedAt).toBeDefined();
    });

    it('devrait gérer les erreurs d\'archivage', async () => {
      fs.mkdir.mockRejectedValue(new Error('Disk full'));

      const invoiceData = { 
        invoice: { number: '2025-07-0001' } 
      };

      const result = await archiveInvoice(invoiceData, mockFormats);

      expect(result.error).toBeDefined();
      expect(result.fallback).toBe('Facture générée mais non archivée');
    });
  });

  /**
   * ================================
   * TESTS FORMATAGE ET LOCALISATION
   * ================================
   */
  describe('Formatting and Localization', () => {
    describe('formatCurrency', () => {
      it('devrait formater les montants en MAD', () => {
        expect(formatCurrency(1234.56)).toBe('1 234,56 MAD');
        expect(formatCurrency(0)).toBe('0,00 MAD');
        expect(formatCurrency(999999.99)).toBe('999 999,99 MAD');
      });

      it('devrait gérer les devises différentes', () => {
        expect(formatCurrency(1234.56, 'EUR')).toBe('1 234,56 EUR');
        expect(formatCurrency(1234.56, 'USD')).toBe('1 234,56 USD');
      });
    });

    describe('formatDate', () => {
      it('devrait formater les dates en français', () => {
        const date = new Date('2025-07-15');
        const formatted = formatDate(date, 'fr');
        expect(formatted).toContain('juillet');
        expect(formatted).toContain('2025');
      });

      it('devrait formater les dates en anglais', () => {
        const date = new Date('2025-07-15');
        const formatted = formatDate(date, 'en');
        expect(formatted).toContain('July');
        expect(formatted).toContain('2025');
      });
    });

    describe('getLabels', () => {
      it('devrait retourner les labels français par défaut', () => {
        const labels = getLabels();
        expect(labels.invoice).toBe('Facture');
        expect(labels.total).toBe('Total');
        expect(labels.customerInfo).toBe('Informations Client');
      });

      it('devrait retourner les labels anglais', () => {
        const labels = getLabels('en');
        expect(labels.invoice).toBe('Invoice');
        expect(labels.total).toBe('Total');
        expect(labels.customerInfo).toBe('Customer Information');
      });

      it('devrait fallback sur français pour langue inconnue', () => {
        const labels = getLabels('es');
        expect(labels.invoice).toBe('Facture');
      });
    });
  });

  /**
   * ================================
   * TESTS GÉNÉRATION COMPLÈTE
   * ================================
   */
  describe('generateInvoice - Integration', () => {
    beforeEach(() => {
      fs.mkdir.mockResolvedValue();
      fs.writeFile.mockResolvedValue();
    });

    it('devrait générer une facture complète avec tous les formats', async () => {
      const result = await generateInvoice(mockBooking, {
        format: 'all',
        template: 'default',
        language: 'fr',
        currency: 'MAD'
      });

      expect(result.invoiceData).toBeDefined();
      expect(result.formats.json).toBeDefined();
      expect(result.formats.pdf).toBeDefined();
      expect(result.formats.xml).toBeDefined();
      expect(result.storage).toBeDefined();
      expect(result.metadata.generatedAt).toBeDefined();
    });

    it('devrait générer uniquement le format demandé', async () => {
      const result = await generateInvoice(mockBooking, {
        format: 'json'
      });

      expect(result.formats.json).toBeDefined();
      expect(result.formats.pdf).toBeUndefined();
      expect(result.formats.xml).toBeUndefined();
    });

    it('devrait inclure les données personnalisées', async () => {
      const customData = {
        project: 'Mission Casablanca',
        poNumber: 'PO-2025-007'
      };

      const result = await generateInvoice(mockBooking, {
        format: 'json',
        customData
      });

      expect(result.invoiceData.custom.project).toBe('Mission Casablanca');
      expect(result.invoiceData.custom.poNumber).toBe('PO-2025-007');
    });
  });

  /**
   * ================================
   * TESTS GESTION D'ERREURS
   * ================================
   */
  describe('Error Handling', () => {
    it('devrait lever InvoiceError pour booking invalide', async () => {
      await expect(generateInvoice(null)).rejects.toThrow(InvoiceError);
    });

    it('devrait lever InvoiceError pour données manquantes', async () => {
      const invalidBooking = { ...mockBooking };
      delete invalidBooking.customer;

      await expect(generateInvoiceData(invalidBooking)).rejects.toThrow();
    });

    it('devrait gérer les erreurs de génération PDF', async () => {
      // Simuler erreur lors génération PDF
      const mockBookingWithError = {
        ...mockBooking,
        rooms: null // Invalid data
      };

      const result = await generateInvoice(mockBookingWithError, {
        format: 'pdf'
      });

      // Devrait fallback sur HTML template
      expect(result.formats.pdf.engine).toBe('html-template');
    });
  });

  /**
   * ================================
   * TESTS EDGE CASES
   * ================================
   */
  describe('Edge Cases', () => {
    it('devrait gérer booking sans extras', async () => {
      mockBooking.extras = [];
      mockBooking.extrasTotal = 0;
      mockBooking.totalPrice = 1260;

      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.billing.extras).toHaveLength(0);
      expect(invoiceData.billing.extrasSubtotal).toBe(0);
      expect(invoiceData.billing.subtotal).toBe(1260);
    });

    it('devrait gérer chambres non assignées', async () => {
      mockBooking.rooms[0].room = null;

      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.billing.rooms[0].roomNumber).toBe('Non assignée');
      expect(invoiceData.billing.rooms[0].floor).toBeNull();
    });

    it('devrait gérer dates de check-in/out manquantes', async () => {
      delete mockBooking.actualCheckInDate;
      delete mockBooking.actualCheckOutDate;

      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.stay.actualCheckInDate).toBeUndefined();
      expect(invoiceData.stay.actualCheckOutDate).toBeUndefined();
    });

    it('devrait calculer duration avec dates réelles si disponibles', async () => {
      // Séjour plus court que prévu
      mockBooking.actualCheckOutDate = new Date('2025-07-17T10:00:00Z'); // 1 jour plus tôt
      mockBooking.actualStayDuration = 2;

      const invoiceData = await generateInvoiceData(mockBooking);

      expect(invoiceData.stay.nightsBooked).toBe(3);
      expect(invoiceData.stay.nightsActual).toBe(2);
    });
  });
});

/**
 * ================================
 * TESTS PERFORMANCE ET STRESS
 * ================================
 */
describe('Invoice Generator Performance', () => {
  it('devrait générer une facture en moins de 500ms', async () => {
    const start = Date.now();
    
    await generateInvoice({
      _id: 'test',
      hotel: { name: 'Test Hotel' },
      customer: { firstName: 'Test', lastName: 'User', email: 'test@example.com' },
      checkInDate: new Date(),
      checkOutDate: new Date(),
      rooms: [{ type: 'Simple', basePrice: 100, calculatedPrice: 300 }],
      extras: [],
      totalPrice: 300
    }, { format: 'json' });
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
  });

  it('devrait gérer la génération de multiples factures simultanées', async () => {
    const bookings = Array(10).fill(null).map((_, i) => ({
      _id: `booking${i}`,
      hotel: { name: `Hotel ${i}` },
      customer: { firstName: 'Test', lastName: `User${i}`, email: `test${i}@example.com` },
      checkInDate: new Date(),
      checkOutDate: new Date(),
      rooms: [{ type: 'Simple', basePrice: 100, calculatedPrice: 300 }],
      extras: [],
      totalPrice: 300
    }));

    const start = Date.now();
    
    const promises = bookings.map(booking => 
      generateInvoice(booking, { format: 'json' })
    );
    
    const results = await Promise.all(promises);
    
    const duration = Date.now() - start;
    
    expect(results).toHaveLength(10);
    expect(results.every(r => r.invoiceData)).toBe(true);
    expect(duration).toBeLessThan(2000); // 10 factures en moins de 2s
  });
});

/**
 * ================================
 * TESTS SÉCURITÉ
 * ================================
 */
describe('Invoice Generator Security', () => {
  it('devrait échapper les caractères dangereux dans HTML', async () => {
    const maliciousBooking = {
      _id: 'test',
      hotel: { 
        name: '<script>alert("hack")</script>Hotel',
        address: 'Address<img src=x onerror=alert(1)>'
      },
      customer: { 
        firstName: '<script>evil()</script>',
        lastName: 'User',
        email: 'test@example.com'
      },
      checkInDate: new Date(),
      checkOutDate: new Date(),
      rooms: [{ 
        type: 'Simple', 
        basePrice: 100, 
        calculatedPrice: 300,
        room: { number: '<script>hack()</script>' }
      }],
      extras: [{
        name: '<script>steal()</script>Service',
        category: 'Evil<script>',
        price: 100,
        quantity: 1,
        total: 100
      }],
      totalPrice: 400
    };

    const invoiceData = await generateInvoiceData(maliciousBooking);
    const html = await generateHTMLTemplate(invoiceData);

    // Vérifier que les scripts sont échappés
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('onerror=');
    expect(html).toContain('&lt;script&gt;'); // Échappé
  });

  it('devrait valider les montants pour éviter les valeurs négatives', async () => {
    const invalidBooking = {
      _id: 'test',
      hotel: { name: 'Test Hotel' },
      customer: { firstName: 'Test', lastName: 'User', email: 'test@example.com' },
      checkInDate: new Date(),
      checkOutDate: new Date(),
      rooms: [{ type: 'Simple', basePrice: -100, calculatedPrice: -300 }],
      extras: [{ name: 'Invalid', price: -50, quantity: 1, total: -50 }],
      totalPrice: -350
    };

    await expect(generateInvoiceData(invalidBooking)).rejects.toThrow();
  });

  it('devrait limiter la taille des descriptions pour éviter DoS', async () => {
    const longDescription = 'A'.repeat(10000); // Description très longue
    
    const bookingWithLongData = {
      _id: 'test',
      hotel: { name: 'Test Hotel' },
      customer: { firstName: 'Test', lastName: 'User', email: 'test@example.com' },
      checkInDate: new Date(),
      checkOutDate: new Date(),
      rooms: [{ type: 'Simple', basePrice: 100, calculatedPrice: 300 }],
      extras: [{
        name: 'Service',
        description: longDescription,
        price: 100,
        quantity: 1,
        total: 100
      }],
      totalPrice: 400
    };

    const invoiceData = await generateInvoiceData(bookingWithLongData);
    
    // Vérifier que la description est tronquée
    const extra = invoiceData.billing.extras[0];
    expect(extra.description.length).toBeLessThan(1000);
  });
});

/**
 * ================================
 * TESTS INTEGRATION AVEC MODELS
 * ================================
 */
describe('Invoice Generator Model Integration', () => {
  const Invoice = require('../../../src/models/Invoice');

  it('devrait créer un enregistrement Invoice lors de la génération', async () => {
    Invoice.findOne.mockResolvedValue(null);
    Invoice.create.mockResolvedValue({ number: '2025-07-0001' });

    await generateInvoiceNumber({
      _id: 'booking123'
    });

    expect(Invoice.create).toHaveBeenCalledWith({
      number: '2025-07-0001',
      booking: 'booking123',
      generatedAt: expect.any(Date)
    });
  });

  it('devrait gérer les conflits de numérotation', async () => {
    // Simuler conflit (deux créations simultanées)
    Invoice.findOne.mockResolvedValue({ number: '2025-07-0042' });
    Invoice.create
      .mockRejectedValueOnce(new Error('Duplicate key'))
      .mockResolvedValueOnce({ number: '2025-07-0043' });

    const number = await generateInvoiceNumber({
      _id: 'booking123'
    });

    // Devrait utiliser le fallback timestamp
    expect(number).toMatch(/^2025-07-\d{8}$/);
  });
});

/**
 * ================================
 * TESTS HELPERS ET UTILITAIRES
 * ================================
 */
describe('Invoice Utilities', () => {
  describe('Helper Functions', () => {
    it('devrait calculer correctement la date d\'échéance', async () => {
      const booking = {
        clientType: CLIENT_TYPES.INDIVIDUAL,
        checkOutDate: new Date('2025-07-18')
      };

      const invoiceData = await generateInvoiceData(booking);
      
      // Particuliers : paiement immédiat
      expect(invoiceData.payment.dueDate).toEqual(booking.checkOutDate);
    });

    it('devrait calculer date échéance pour entreprises', async () => {
      const booking = {
        clientType: CLIENT_TYPES.CORPORATE,
        checkOutDate: new Date('2025-07-18')
      };

      const invoiceData = await generateInvoiceData(booking);
      
      // Entreprises : 30 jours
      const expectedDueDate = new Date('2025-08-17'); // 30 jours après
      expect(invoiceData.payment.dueDate.getTime()).toBe(expectedDueDate.getTime());
    });

    it('devrait générer les termes de paiement appropriés', async () => {
      const individualBooking = {
        clientType: CLIENT_TYPES.INDIVIDUAL,
        customer: { firstName: 'Test', lastName: 'User' }
      };

      const corporateBooking = {
        clientType: CLIENT_TYPES.CORPORATE,
        customer: { firstName: 'Test', lastName: 'User' }
      };

      const individualInvoice = await generateInvoiceData(individualBooking);
      const corporateInvoice = await generateInvoiceData(corporateBooking);

      expect(individualInvoice.payment.terms).toContain('arrivée');
      expect(corporateInvoice.payment.terms).toContain('30 jours');
    });
  });

  describe('Data Validation', () => {
    it('devrait valider les données obligatoires', async () => {
      const incompleteBooking = {
        _id: 'test'
        // Manque hotel, customer, etc.
      };

      await expect(generateInvoiceData(incompleteBooking)).rejects.toThrow();
    });

    it('devrait valider les formats de dates', async () => {
      const invalidBooking = {
        hotel: { name: 'Test' },
        customer: { firstName: 'Test', lastName: 'User' },
        checkInDate: 'invalid-date',
        checkOutDate: new Date(),
        rooms: [],
        totalPrice: 100
      };

      await expect(generateInvoiceData(invalidBooking)).rejects.toThrow();
    });

    it('devrait valider les montants', async () => {
      const invalidBooking = {
        hotel: { name: 'Test' },
        customer: { firstName: 'Test', lastName: 'User' },
        checkInDate: new Date(),
        checkOutDate: new Date(),
        rooms: [{ basePrice: 'invalid' }],
        totalPrice: 'not-a-number'
      };

      await expect(generateInvoiceData(invalidBooking)).rejects.toThrow();
    });
  });
});

/**
 * ================================
 * TESTS EDGE CASES AVANCÉS
 * ================================
 */
describe('Advanced Edge Cases', () => {
  it('devrait gérer un séjour de 0 nuit (same day checkout)', async () => {
    const sameDayBooking = {
      ...mockBooking,
      checkInDate: new Date('2025-07-15T14:00:00Z'),
      checkOutDate: new Date('2025-07-15T18:00:00Z'), // Même jour
      actualStayDuration: 1 // Facturé 1 nuit minimum
    };

    const invoiceData = await generateInvoiceData(sameDayBooking);

    expect(invoiceData.stay.nightsBooked).toBe(1); // Minimum 1 nuit facturée
    expect(invoiceData.stay.nightsActual).toBe(1);
  });

  it('devrait gérer les séjours très longs (> 30 jours)', async () => {
    const longStayBooking = {
      ...mockBooking,
      checkInDate: new Date('2025-07-01'),
      checkOutDate: new Date('2025-08-15'), // 45 jours
      rooms: [{
        type: 'Suite',
        basePrice: 500,
        calculatedPrice: 22500 // 45 × 500
      }],
      totalPrice: 22500
    };

    const invoiceData = await generateInvoiceData(longStayBooking);

    expect(invoiceData.stay.nightsBooked).toBe(45);
    expect(invoiceData.billing.total).toBeGreaterThan(22500); // Avec taxes
  });

  it('devrait gérer les montants très élevés', async () => {
    const expensiveBooking = {
      ...mockBooking,
      rooms: [{
        type: 'Suite Presidential',
        basePrice: 50000,
        calculatedPrice: 150000 // 3 nuits × 50k
      }],
      totalPrice: 150000
    };

    const invoiceData = await generateInvoiceData(expensiveBooking);
    const formatted = formatCurrency(invoiceData.billing.total);

    expect(formatted).toContain('150 000'); // Formatage correct des grands nombres
    expect(formatted).toContain('MAD');
  });

  it('devrait gérer les devises avec centimes', async () => {
    const bookingWithCents = {
      ...mockBooking,
      rooms: [{
        type: 'Double',
        basePrice: 299.99,
        calculatedPrice: 899.97 // 3 × 299.99
      }],
      totalPrice: 899.97
    };

    const invoiceData = await generateInvoiceData(bookingWithCents);

    expect(invoiceData.billing.rooms[0].pricePerNight).toBe(299.99);
    expect(invoiceData.billing.roomsSubtotal).toBe(899.97);
  });
});

/**
 * ================================
 * TESTS COMPATIBILITÉ VERSIONS
 * ================================
 */
describe('Backward Compatibility', () => {
  it('devrait gérer les anciens formats de booking', async () => {
    const legacyBooking = {
      _id: 'legacy123',
      hotel: { name: 'Old Hotel' },
      customer: { firstName: 'Old', lastName: 'Customer', email: 'old@example.com' },
      checkIn: new Date('2025-07-15'), // Ancien format sans 'Date'
      checkOut: new Date('2025-07-18'),
      room: { // Format singulier au lieu de 'rooms'
        type: 'Double',
        price: 300
      },
      total: 300 // Au lieu de 'totalPrice'
    };

    // Le système devrait soit convertir automatiquement, soit lever une erreur claire
    await expect(generateInvoiceData(legacyBooking)).rejects.toThrow();
  });

  it('devrait maintenir la compatibilité des numéros de facture', async () => {
    const Invoice = require('../../../src/models/Invoice');
    
    // Simuler ancien format de numéro
    Invoice.findOne.mockResolvedValue({ number: 'INV-2025-001' });
    Invoice.create.mockResolvedValue({ number: '2025-07-0001' });

    const number = await generateInvoiceNumber(mockBooking);

    // Nouveau format même si ancien existe
    expect(number).toMatch(/^\d{4}-\d{2}-\d{4}$/);
  });
});

module.exports = {
  // Export pour réutilisation dans d'autres tests
  mockBooking: () => mockBooking,
  mockHotel: () => mockHotel,
  mockCustomer: () => mockCustomer
};