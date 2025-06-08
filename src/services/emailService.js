const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');
const handlebars = require('handlebars');
const moment = require('moment');
const QRCode = require('qrcode');
const { logger } = require('../utils/logger');

class EmailService {
    constructor() {
        this.transporter = null;
        this.templates = new Map();
        this.initializeTransporter();
        this.loadTemplates();
    }

    /**
     * Initialize email transporter based on environment
     */
    initializeTransporter() {
        // Use your existing Gmail configuration
        const config = {
            service: process.env.EMAIL_SERVICE || 'gmail',
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: process.env.EMAIL_PORT || 587,
            secure: false, // Use STARTTLS
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        };
        this.transporter = nodemailer.createTransporter(config);

        // Verify connection
        this.transporter.verify((error, success) => {
            if (error) {
                logger.error('Email service connection failed:', error);
            } else {
                logger.info('Email service ready');
            }
        });
    }

    /**
     * Load and compile email templates
     */
    async loadTemplates() {
        const templateDir = path.join(__dirname, '../templates/emails');
        const templateFiles = [
            'booking-confirmation-advanced.html',
            'booking-modification.html',
            'booking-cancellation.html',
            'payment-reminder.html',
            'checkin-reminder.html',
            'checkout-confirmation.html',
            'loyalty-points.html',
            'promotional-offer.html',
            'welcome-enterprise.html',
            'booking-approved.html',
            'booking-rejected.html',
            'invoice-generated.html'
        ];

        try {
            for (const templateFile of templateFiles) {
                const templatePath = path.join(templateDir, templateFile);
                const templateContent = await fs.readFile(templatePath, 'utf8');
                const templateName = templateFile.replace('.html', '');
                this.templates.set(templateName, handlebars.compile(templateContent));
            }
            logger.info(`Loaded ${this.templates.size} email templates`);
        } catch (error) {
            logger.error('Failed to load email templates:', error);
        }
    }

    /**
     * Send booking confirmation email with QR code
     */
    async sendBookingConfirmation(booking, user, hotel) {
        try {
            // Generate QR code for mobile check-in
            const qrData = {
                bookingId: booking._id,
                hotelId: hotel._id,
                guestEmail: user.email,
                checkIn: booking.checkInDate,
                checkOut: booking.checkOutDate
            };
            const qrCodeBuffer = await QRCode.toBuffer(JSON.stringify(qrData));

            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    email: user.email
                },
                booking: {
                    id: booking._id,
                    confirmationNumber: booking.confirmationNumber,
                    checkInDate: moment(booking.checkInDate).format('DD/MM/YYYY'),
                    checkOutDate: moment(booking.checkOutDate).format('DD/MM/YYYY'),
                    totalAmount: booking.totalAmount,
                    currency: booking.currency || 'EUR',
                    rooms: booking.rooms.map(room => ({
                        type: room.roomType,
                        count: room.quantity,
                        pricePerNight: room.pricePerNight
                    })),
                    nights: booking.numberOfNights,
                    guests: booking.guests,
                    status: booking.status
                },
                hotel: {
                    name: hotel.name,
                    address: hotel.address,
                    city: hotel.city,
                    phone: hotel.phone,
                    email: hotel.email,
                    stars: hotel.stars,
                    checkInTime: hotel.checkInTime || '15:00',
                    checkOutTime: hotel.checkOutTime || '11:00'
                },
                qrCode: `data:image/png;base64,${qrCodeBuffer.toString('base64')}`,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('booking-confirmation-advanced')(templateData);

            const mailOptions = {
                from: `"${hotel.name}" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `Confirmation de réservation - ${hotel.name} - ${booking.confirmationNumber}`,
                html: htmlContent,
                attachments: [
                    {
                        filename: 'qr-checkin.png',
                        content: qrCodeBuffer,
                        cid: 'qrcode'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Booking confirmation sent to ${user.email} for booking ${booking._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send booking confirmation:', error);
            throw error;
        }
    }

    /**
     * Send booking approval/rejection notification
     */
    async sendBookingStatusUpdate(booking, user, hotel, status, adminComment = null) {
        try {
            const templateName = status === 'CONFIRMED' ? 'booking-approved' : 'booking-rejected';
            
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                booking: {
                    id: booking._id,
                    confirmationNumber: booking.confirmationNumber,
                    checkInDate: moment(booking.checkInDate).format('DD/MM/YYYY'),
                    checkOutDate: moment(booking.checkOutDate).format('DD/MM/YYYY'),
                    totalAmount: booking.totalAmount,
                    currency: booking.currency || 'EUR'
                },
                hotel: {
                    name: hotel.name,
                    phone: hotel.phone,
                    email: hotel.email
                },
                status,
                adminComment,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get(templateName)(templateData);

            const subject = status === 'CONFIRMED' 
                ? `Réservation confirmée - ${hotel.name} - ${booking.confirmationNumber}`
                : `Réservation annulée - ${hotel.name} - ${booking.confirmationNumber}`;

            const mailOptions = {
                from: `"${hotel.name}" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Booking status update sent to ${user.email} for booking ${booking._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send booking status update:', error);
            throw error;
        }
    }

    /**
     * Send payment reminder email
     */
    async sendPaymentReminder(booking, user, hotel, daysUntilDue = 3) {
        try {
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                booking: {
                    id: booking._id,
                    confirmationNumber: booking.confirmationNumber,
                    checkInDate: moment(booking.checkInDate).format('DD/MM/YYYY'),
                    totalAmount: booking.totalAmount,
                    currency: booking.currency || 'EUR',
                    amountDue: booking.totalAmount - (booking.paidAmount || 0)
                },
                hotel: {
                    name: hotel.name,
                    phone: hotel.phone,
                    email: hotel.email
                },
                daysUntilDue,
                paymentLink: `${process.env.FRONTEND_URL}/booking/${booking._id}/payment`,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('payment-reminder')(templateData);

            const mailOptions = {
                from: `"${hotel.name}" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `Rappel de paiement - ${hotel.name} - ${booking.confirmationNumber}`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Payment reminder sent to ${user.email} for booking ${booking._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send payment reminder:', error);
            throw error;
        }
    }

    /**
     * Send check-in reminder 24h before arrival
     */
    async sendCheckInReminder(booking, user, hotel) {
        try {
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                booking: {
                    id: booking._id,
                    confirmationNumber: booking.confirmationNumber,
                    checkInDate: moment(booking.checkInDate).format('DD/MM/YYYY'),
                    checkOutDate: moment(booking.checkOutDate).format('DD/MM/YYYY'),
                    rooms: booking.rooms
                },
                hotel: {
                    name: hotel.name,
                    address: hotel.address,
                    city: hotel.city,
                    phone: hotel.phone,
                    checkInTime: hotel.checkInTime || '15:00',
                    checkInInstructions: hotel.checkInInstructions || 'Présentez-vous à la réception avec une pièce d\'identité'
                },
                mobileCheckInLink: `${process.env.FRONTEND_URL}/mobile-checkin/${booking._id}`,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('checkin-reminder')(templateData);

            const mailOptions = {
                from: `"${hotel.name}" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `Rappel d'arrivée demain - ${hotel.name}`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Check-in reminder sent to ${user.email} for booking ${booking._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send check-in reminder:', error);
            throw error;
        }
    }

    /**
     * Send promotional offer email
     */
    async sendPromotionalOffer(user, promotion, hotels = []) {
        try {
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                promotion: {
                    title: promotion.title,
                    description: promotion.description,
                    discountType: promotion.discountType,
                    discountValue: promotion.discountValue,
                    code: promotion.code,
                    validFrom: moment(promotion.validFrom).format('DD/MM/YYYY'),
                    validUntil: moment(promotion.validUntil).format('DD/MM/YYYY'),
                    minimumStay: promotion.minimumStay,
                    termsAndConditions: promotion.termsAndConditions
                },
                hotels: hotels.map(hotel => ({
                    name: hotel.name,
                    city: hotel.city,
                    stars: hotel.stars,
                    image: hotel.images?.[0] || '/default-hotel.jpg'
                })),
                bookingLink: `${process.env.FRONTEND_URL}/search?promo=${promotion.code}`,
                year: new Date().getFullYear(),
                unsubscribeLink: `${process.env.FRONTEND_URL}/unsubscribe/${user._id}`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('promotional-offer')(templateData);

            const mailOptions = {
                from: `"Offres Spéciales" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `🎉 ${promotion.title} - Offre exclusive !`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Promotional offer sent to ${user.email} for promotion ${promotion._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send promotional offer:', error);
            throw error;
        }
    }

    /**
     * Send loyalty points notification
     */
    async sendLoyaltyPointsUpdate(user, pointsEarned, totalPoints, booking = null) {
        try {
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                points: {
                    earned: pointsEarned,
                    total: totalPoints,
                    nextRewardThreshold: this.calculateNextRewardThreshold(totalPoints)
                },
                booking: booking ? {
                    confirmationNumber: booking.confirmationNumber,
                    hotelName: booking.hotelName,
                    totalAmount: booking.totalAmount
                } : null,
                rewards: this.getAvailableRewards(totalPoints),
                accountLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('loyalty-points')(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `🎁 Vous avez gagné ${pointsEarned} points fidélité !`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Loyalty points update sent to ${user.email}`);
            return result;
        } catch (error) {
            logger.error('Failed to send loyalty points update:', error);
            throw error;
        }
    }

    /**
     * Send enterprise welcome email
     */
    async sendEnterpriseWelcome(company, adminUser) {
        try {
            const templateData = {
                company: {
                    name: company.name,
                    siret: company.siret,
                    address: company.address
                },
                admin: {
                    firstName: adminUser.firstName,
                    lastName: adminUser.lastName,
                    email: adminUser.email
                },
                features: [
                    'Facturation centralisée',
                    'Gestion des employés autorisés',
                    'Rapports de dépenses détaillés',
                    'Conditions tarifaires préférentielles',
                    'Support prioritaire'
                ],
                loginLink: `${process.env.FRONTEND_URL}/enterprise/login`,
                documentationLink: `${process.env.FRONTEND_URL}/docs/enterprise`,
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('welcome-enterprise')(templateData);

            const mailOptions = {
                from: `"Équipe Entreprise" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: adminUser.email,
                subject: `Bienvenue ${company.name} - Votre compte entreprise est activé`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Enterprise welcome sent to ${adminUser.email} for company ${company._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send enterprise welcome:', error);
            throw error;
        }
    }

    /**
     * Send invoice by email
     */
    async sendInvoice(invoice, user, hotel, pdfBuffer) {
        try {
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName
                },
                invoice: {
                    number: invoice.invoiceNumber,
                    date: moment(invoice.date).format('DD/MM/YYYY'),
                    totalAmount: invoice.totalAmount,
                    currency: invoice.currency || 'EUR'
                },
                hotel: {
                    name: hotel.name,
                    address: hotel.address,
                    city: hotel.city
                },
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const htmlContent = this.templates.get('invoice-generated')(templateData);

            const mailOptions = {
                from: `"${hotel.name}" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `Facture ${invoice.invoiceNumber} - ${hotel.name}`,
                html: htmlContent,
                attachments: [
                    {
                        filename: `facture-${invoice.invoiceNumber}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }
                ]
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Invoice sent to ${user.email} for invoice ${invoice._id}`);
            return result;
        } catch (error) {
            logger.error('Failed to send invoice:', error);
            throw error;
        }
    }

    /**
     * Bulk email sending for marketing campaigns
     */
    async sendBulkEmails(recipients, template, templateData, subject) {
        const results = [];
        const batchSize = 50; // Send in batches to avoid rate limits

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);
            const batchPromises = batch.map(async (recipient) => {
                try {
                    const personalizedData = {
                        ...templateData,
                        user: recipient
                    };

                    const htmlContent = this.templates.get(template)(personalizedData);

                    const mailOptions = {
                        from: process.env.EMAIL_FROM || 'noreply@hotelmanagement.com',
                        to: recipient.email,
                        subject,
                        html: htmlContent
                    };

                    return await this.transporter.sendMail(mailOptions);
                } catch (error) {
                    logger.error(`Failed to send bulk email to ${recipient.email}:`, error);
                    return { error: error.message, recipient: recipient.email };
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);

            // Add delay between batches
            if (i + batchSize < recipients.length) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        return results;
    }

    /**
     * Helper methods
     */
    calculateNextRewardThreshold(currentPoints) {
        const thresholds = [100, 250, 500, 1000, 2500, 5000];
        return thresholds.find(threshold => threshold > currentPoints) || 5000;
    }

    getAvailableRewards(points) {
        const rewards = [];
        if (points >= 100) rewards.push({ name: 'Surclassement gratuit', points: 100 });
        if (points >= 250) rewards.push({ name: 'Petit-déjeuner offert', points: 250 });
        if (points >= 500) rewards.push({ name: 'Nuit gratuite', points: 500 });
        return rewards;
    }
}

module.exports = new EmailService();