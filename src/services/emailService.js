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
            'tier-upgrade.html',
            'loyalty-welcome.html',
            'points-expiry-warning.html',
            'birthday-bonus.html',
            'referral-bonus.html',
            'review-bonus.html',
            'anniversary-bonus.html',
            'loyalty-digest.html',
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
     * Send loyalty points notification (ORIGINAL METHOD - UPDATED)
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

    // ============================================================================
    // NOUVELLES MÉTHODES LOYALTY AVANCÉES
    // ============================================================================

    /**
     * Send loyalty points earned email with enhanced template (NOUVELLE VERSION COMPLÈTE)
     */
    async sendLoyaltyPointsEmail(user, loyaltyData) {
        try {
            // Calculer données dynamiques pour le template
            const tierBenefits = this.getTierBenefitsDescription(user.loyalty.tier);
            const expiringPoints = await this.getExpiringPoints(user._id);
            const socialShareUrls = this.generateSocialShareUrls(user, loyaltyData.points.earned);
            
            const templateData = {
                // Données utilisateur enrichies
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    tier: user.loyalty.tier,
                    tierBenefits: tierBenefits.description,
                    tierProgress: {
                        nextTier: user.loyalty.tierProgress.nextTier,
                        pointsToNextTier: user.loyalty.tierProgress.pointsToNextTier,
                        progressPercentage: user.loyalty.tierProgress.progressPercentage
                    },
                    activeBenefits: this.formatActiveBenefits(user.loyalty.activeBenefits),
                    personalGoals: user.loyalty.personalGoals || null,
                    memberSince: moment(user.loyalty.enrolledAt).format('MMMM YYYY'),
                    lifetimePoints: user.loyalty.lifetimePoints
                },
                
                // Données points enrichies
                points: {
                    earned: loyaltyData.points.earned,
                    total: loyaltyData.points.total,
                    bonusMultiplier: loyaltyData.bonusMultiplier || 1,
                    basePoints: loyaltyData.basePoints || loyaltyData.points.earned,
                    bonusPoints: loyaltyData.bonusPoints || 0
                },
                
                // Points qui expirent (NOUVEAU)
                pointsExpiring: expiringPoints ? {
                    amount: expiringPoints.amount,
                    date: moment(expiringPoints.earliestDate).format('DD/MM/YYYY')
                } : null,
                
                // Récompenses disponibles mises à jour
                rewards: this.getAvailableRewardsEnhanced(loyaltyData.points.total),
                
                // Données réservation (si applicable)
                booking: loyaltyData.booking ? {
                    confirmationNumber: loyaltyData.booking.confirmationNumber || loyaltyData.booking.bookingNumber,
                    hotelName: loyaltyData.booking.hotel?.name || loyaltyData.booking.hotelName,
                    totalAmount: loyaltyData.booking.totalAmount || loyaltyData.booking.totalPrice,
                    checkInDate: loyaltyData.booking.checkInDate ? moment(loyaltyData.booking.checkInDate).format('DD/MM/YYYY') : null
                } : null,
                
                // Partage social (NOUVEAU)
                socialShare: socialShareUrls,
                
                // Liens et métadonnées
                accountLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                historyLink: `${process.env.FRONTEND_URL}/account/loyalty/history`,
                redeemLink: `${process.env.FRONTEND_URL}/account/loyalty/redeem`,
                FRONTEND_URL: process.env.FRONTEND_URL,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com',
                unsubscribeLink: `${process.env.FRONTEND_URL}/unsubscribe/loyalty/${user._id}`,
                privacyLink: `${process.env.FRONTEND_URL}/privacy`,
                termsLink: `${process.env.FRONTEND_URL}/terms`,
                year: new Date().getFullYear()
            };

            const htmlContent = this.templates.get('loyalty-points')(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `🎉 ${loyaltyData.points.earned} points gagnés ! Total: ${loyaltyData.points.total} points`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Enhanced loyalty points email sent to ${user.email}`);
            return result;
        } catch (error) {
            logger.error('Failed to send enhanced loyalty points email:', error);
            throw error;
        }
    }

    /**
     * Send tier upgrade celebration email (VERSION AMÉLIORÉE)
     */
    async sendTierUpgradeEmail(user, upgradeData) {
        try {
            const oldBenefits = this.getTierBenefitsDescription(upgradeData.oldTier);
            const newBenefits = this.getTierBenefitsDescription(upgradeData.newTier);
            const unlockedBenefits = this.getUnlockedBenefits(upgradeData.oldTier, upgradeData.newTier);
            const celebrationData = this.getTierCelebrationData(upgradeData.newTier);
            
            const templateData = {
                user: {
                    firstName: user.firstName,
                    lastName: user.lastName,
                    tier: upgradeData.newTier,
                    lifetimePoints: user.loyalty.lifetimePoints
                },
                upgrade: {
                    oldTier: upgradeData.oldTier,
                    newTier: upgradeData.newTier,
                    oldTierDisplay: this.getTierDisplayName(upgradeData.oldTier),
                    newTierDisplay: this.getTierDisplayName(upgradeData.newTier),
                    newTierIcon: this.getTierIcon(upgradeData.newTier),
                    bonusPoints: upgradeData.bonusPoints || 0,
                    achievementDate: moment().format('DD/MM/YYYY')
                },
                benefits: {
                    old: oldBenefits.benefits,
                    new: newBenefits.benefits,
                    unlocked: unlockedBenefits
                },
                celebration: celebrationData,
                links: {
                    loyaltyDashboard: `${process.env.FRONTEND_URL}/account/loyalty`,
                    benefitsGuide: `${process.env.FRONTEND_URL}/loyalty/benefits/${upgradeData.newTier.toLowerCase()}`,
                    newBooking: `${process.env.FRONTEND_URL}/search`
                },
                year: new Date().getFullYear(),
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            // Utiliser template spécialisé ou fallback sur loyalty-points
            const templateName = this.templates.has('tier-upgrade') ? 'tier-upgrade' : 'loyalty-points';
            const htmlContent = this.templates.get(templateName)(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: user.email,
                subject: `🏆 Promotion niveau ${this.getTierDisplayName(upgradeData.newTier)} - Félicitations !`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Enhanced tier upgrade email sent to ${user.email} for ${upgradeData.newTier}`);
            return result;
        } catch (error) {
            logger.error('Failed to send enhanced tier upgrade email:', error);
            throw error;
        }
    }

    /**
     * Send loyalty program welcome email
     */
    async sendLoyaltyWelcomeEmail(userEmail, userData) {
        try {
            const templateData = {
                user: userData,
                welcome: {
                    title: 'Bienvenue dans notre programme de fidélité !',
                    message: 'Commencez à gagner des points dès votre première réservation',
                    startingPoints: userData.welcomePoints || 100
                },
                program: {
                    tiers: this.getAllTiersInfo(),
                    earningRules: [
                        { action: 'Réservation', points: '1 point par euro dépensé' },
                        { action: 'Avis client', points: '100 points' },
                        { action: 'Parrainage ami', points: '500 points' },
                        { action: 'Anniversaire', points: '250 points' }
                    ],
                    redemptionOptions: [
                        { option: 'Réduction', rate: '100 points = 1€' },
                        { option: 'Upgrade chambre', points: '1000 points' },
                        { option: 'Nuit gratuite', points: '5000 points' },
                        { option: 'Petit-déjeuner', points: '250 points' }
                    ]
                },
                gettingStarted: [
                    'Effectuez votre première réservation pour gagner des points',
                    'Consultez votre solde dans votre espace personnel',
                    'Utilisez vos points pour des réductions ou upgrades',
                    'Progressez vers les niveaux supérieurs'
                ],
                year: new Date().getFullYear(),
                loyaltyDashboardLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                firstBookingLink: `${process.env.FRONTEND_URL}/search`,
                loyaltyGuideLink: `${process.env.FRONTEND_URL}/loyalty/guide`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            // Utiliser template spécialisé ou adapter un existant
            const templateName = this.templates.has('loyalty-welcome') ? 'loyalty-welcome' : 'welcome-enterprise';
            const htmlContent = this.templates.get(templateName)(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: userEmail,
                subject: '🎁 Bienvenue dans notre programme de fidélité !',
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Loyalty welcome email sent to ${userEmail}`);
            return result;
        } catch (error) {
            logger.error('Failed to send loyalty welcome email:', error);
            throw error;
        }
    }

    /**
     * Send points expiry warning email
     */
    async sendPointsExpiryWarning(userEmail, expiryData) {
        try {
            const templateData = {
                user: expiryData.user,
                expiry: {
                    pointsExpiring: expiryData.pointsExpiring,
                    expiryDate: moment(expiryData.earliestExpiry).format('DD/MM/YYYY'),
                    daysRemaining: Math.ceil((expiryData.earliestExpiry - new Date()) / (24 * 60 * 60 * 1000)),
                    urgency: expiryData.pointsExpiring >= 1000 ? 'HIGH' : 'MEDIUM'
                },
                redemptionOptions: expiryData.redemptionOptions.slice(0, 4), // Top 4 options
                quickActions: [
                    {
                        action: 'Réserver maintenant',
                        link: `${process.env.FRONTEND_URL}/search`,
                        description: 'Utilisez vos points pour une réduction'
                    },
                    {
                        action: 'Voir toutes les options',
                        link: `${process.env.FRONTEND_URL}/account/loyalty/redeem`,
                        description: 'Explorez toutes les façons d\'utiliser vos points'
                    }
                ],
                year: new Date().getFullYear(),
                loyaltyDashboardLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                redeemPointsLink: `${process.env.FRONTEND_URL}/account/loyalty/redeem`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            // Utiliser template spécialisé ou adapter
            const templateName = this.templates.has('points-expiry-warning') ? 'points-expiry-warning' : 'promotional-offer';
            const htmlContent = this.templates.get(templateName)(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: userEmail,
                subject: `⏰ ${expiryData.pointsExpiring} points expirent bientôt !`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Points expiry warning sent to ${userEmail}`);
            return result;
        } catch (error) {
            logger.error('Failed to send points expiry warning:', error);
            throw error;
        }
    }

    /**
     * Send bonus points email (birthday, referral, etc.)
     */
    async sendBonusPointsEmail(userEmail, bonusData) {
        try {
            const bonusMessages = {
                'EARN_BIRTHDAY': {
                    title: '🎂 Joyeux anniversaire !',
                    message: 'Nous vous offrons des points bonus pour votre anniversaire',
                    icon: '🎂'
                },
                'EARN_REFERRAL': {
                    title: '👥 Merci pour le parrainage !',
                    message: 'Votre ami(e) s\'est inscrit grâce à vous',
                    icon: '👥'
                },
                'EARN_REVIEW': {
                    title: '⭐ Merci pour votre avis !',
                    message: 'Votre avis nous aide à améliorer nos services',
                    icon: '⭐'
                },
                'EARN_ANNIVERSARY': {
                    title: '🎉 Anniversaire de fidélité !',
                    message: 'Cela fait un an que vous êtes membre fidèle',
                    icon: '🎉'
                }
            };

            const bonusInfo = bonusMessages[bonusData.type] || {
                title: '🎁 Points bonus !',
                message: 'Vous avez reçu des points bonus',
                icon: '🎁'
            };

            const templateData = {
                user: bonusData.user,
                bonus: {
                    ...bonusInfo,
                    amount: bonusData.amount,
                    description: bonusData.description,
                    type: bonusData.type
                },
                points: {
                    total: bonusData.points.total,
                    tier: bonusData.tier
                },
                celebration: {
                    specialMessage: this.getSpecialBonusMessage(bonusData.type),
                    nextSteps: this.getBonusNextSteps(bonusData.type)
                },
                year: new Date().getFullYear(),
                loyaltyDashboardLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            // Choisir le bon template selon le type
            const templateName = this.getBonusEmailTemplate(bonusData.type);
            const htmlContent = this.templates.get(templateName)(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: userEmail,
                subject: `${bonusInfo.icon} ${bonusInfo.title} +${bonusData.amount} points`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Bonus points email sent to ${userEmail} for ${bonusData.type}`);
            return result;
        } catch (error) {
            logger.error('Failed to send bonus points email:', error);
            throw error;
        }
    }

    /**
     * Send loyalty program newsletter/digest
     */
    async sendLoyaltyDigest(userEmail, digestData) {
        try {
            const templateData = {
                user: digestData.user,
                period: digestData.period,
                summary: {
                    pointsEarned: digestData.summary.pointsEarned,
                    pointsRedeemed: digestData.summary.pointsRedeemed,
                    bookings: digestData.summary.bookings,
                    currentBalance: digestData.summary.currentBalance
                },
                highlights: digestData.highlights,
                recommendations: digestData.recommendations,
                tier: {
                    current: digestData.user.tier,
                    progress: digestData.progress,
                    nextMilestone: digestData.nextMilestone
                },
                offers: digestData.specialOffers || [],
                year: new Date().getFullYear(),
                loyaltyDashboardLink: `${process.env.FRONTEND_URL}/account/loyalty`,
                unsubscribeLink: `${process.env.FRONTEND_URL}/unsubscribe/loyalty/${digestData.user._id}`,
                supportEmail: process.env.SUPPORT_EMAIL || 'support@hotelmanagement.com'
            };

            const templateName = this.templates.has('loyalty-digest') ? 'loyalty-digest' : 'promotional-offer';
            const htmlContent = this.templates.get(templateName)(templateData);

            const mailOptions = {
                from: `"Programme Fidélité" <${process.env.EMAIL_FROM || 'noreply@hotelmanagement.com'}>`,
                to: userEmail,
                subject: `📊 Votre résumé fidélité - ${digestData.period}`,
                html: htmlContent
            };

            const result = await this.transporter.sendMail(mailOptions);
            logger.info(`Loyalty digest sent to ${userEmail}`);
            return result;
        } catch (error) {
            logger.error('Failed to send loyalty digest:', error);
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

    // ============================================================================
    // MÉTHODES HELPER POUR LOYALTY
    // ============================================================================

    /**
     * Get tier benefits description (NOUVELLE MÉTHODE)
     */
    getTierBenefitsDescription(tier) {
        const descriptions = {
            'BRONZE': {
                description: 'Membre Bronze - Gagnez des points sur chaque réservation',
                benefits: ['Points sur réservations', 'Offres exclusives']
            },
            'SILVER': {
                description: 'Membre Argent - Bénéfices privilégiés et check-in prioritaire',
                benefits: ['20% bonus points', 'Check-in prioritaire', '1 upgrade gratuit/an']
            },
            'GOLD': {
                description: 'Membre Or - Accès aux services premium et petit-déjeuner gratuit',
                benefits: ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades/an', 'Check-out tardif']
            },
            'PLATINUM': {
                description: 'Membre Platine - Statut VIP avec accès lounge exclusif',
                benefits: ['Double points', 'Accès lounge VIP', '1 nuit gratuite/an', 'Upgrade automatique']
            },
            'DIAMOND': {
                description: 'Membre Diamant - Le niveau le plus prestigieux avec service concierge',
                benefits: ['2.5x points', 'Suite upgrade automatique', '2 nuits gratuites/an', 'Service concierge dédié']
            }
        };
        return descriptions[tier] || descriptions['BRONZE'];
    }

    /**
     * Format active benefits for email display (NOUVELLE MÉTHODE)
     */
    formatActiveBenefits(activeBenefits) {
        if (!activeBenefits || activeBenefits.length === 0) return [];
        
        return activeBenefits.filter(benefit => 
            benefit.isActive && 
            benefit.validUntil > new Date() &&
            benefit.usageCount < benefit.maxUsage
        ).map(benefit => ({
            type: benefit.type,
            description: benefit.description,
            icon: this.getBenefitIcon(benefit.type),
            validUntil: moment(benefit.validUntil).format('DD/MM/YYYY'),
            usageCount: benefit.usageCount,
            maxUsage: benefit.maxUsage
        }));
    }

    /**
     * Get benefit icon (NOUVELLE MÉTHODE)
     */
    getBenefitIcon(benefitType) {
        const icons = {
            'DISCOUNT': '💰',
            'UPGRADE': '⬆️',
            'FREE_NIGHT': '🏨',
            'EARLY_CHECKIN': '🕐',
            'LATE_CHECKOUT': '🕕',
            'BONUS_POINTS': '⭐',
            'FREE_BREAKFAST': '🍳',
            'LOUNGE_ACCESS': '🥂',
            'FREE_WIFI': '📶',
            'ROOM_SERVICE_DISCOUNT': '🍽️',
            'SPA_DISCOUNT': '💆',
            'PARKING_FREE': '🚗',
            'AIRPORT_TRANSFER': '✈️'
        };
        return icons[benefitType] || '🎁';
    }

    /**
     * Get expiring points for a user (NOUVELLE MÉTHODE)
     */
    async getExpiringPoints(userId) {
        try {
            const LoyaltyTransaction = require('../models/LoyaltyTransaction');
            
            // Chercher les points qui expirent dans les 30 prochains jours
            const thirtyDaysFromNow = new Date();
            thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
            
            const expiringTransactions = await LoyaltyTransaction.find({
                user: userId,
                pointsAmount: { $gt: 0 }, // Seulement les gains
                status: 'COMPLETED',
                expiresAt: { 
                    $gte: new Date(), 
                    $lte: thirtyDaysFromNow 
                }
            }).sort({ expiresAt: 1 });
            
            if (expiringTransactions.length === 0) return null;
            
            const totalExpiring = expiringTransactions.reduce((sum, tx) => sum + tx.pointsAmount, 0);
            const earliestExpiry = expiringTransactions[0].expiresAt;
            
            return {
                amount: totalExpiring,
                earliestDate: earliestExpiry,
                transactions: expiringTransactions.length
            };
        } catch (error) {
            logger.error('Error getting expiring points:', error);
            return null;
        }
    }

    /**
     * Generate social share URLs (NOUVELLE MÉTHODE)
     */
    generateSocialShareUrls(user, pointsEarned) {
        const shareText = `Je viens de gagner ${pointsEarned} points fidélité ! Niveau ${user.loyalty.tier} 🏆`;
        const shareUrl = `${process.env.FRONTEND_URL}/loyalty/share/${user._id}`;
        
        return {
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`,
            twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`,
            linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}&summary=${encodeURIComponent(shareText)}`
        };
    }

    /**
     * Get enhanced available rewards (AMÉLIORATION DE LA MÉTHODE EXISTANTE)
     */
    getAvailableRewardsEnhanced(points) {
        const rewards = [
            {
                name: 'Réduction 1€',
                points: 100,
                type: 'discount',
                icon: '💰',
                available: points >= 100,
                pointsNeeded: points < 100 ? 100 - points : 0
            },
            {
                name: 'Petit-déjeuner',
                points: 250,
                type: 'breakfast',
                icon: '🍳',
                available: points >= 250,
                pointsNeeded: points < 250 ? 250 - points : 0
            },
            {
                name: 'Réduction 5€',
                points: 500,
                type: 'discount',
                icon: '💰',
                available: points >= 500,
                pointsNeeded: points < 500 ? 500 - points : 0
            },
            {
                name: 'Upgrade chambre',
                points: 1000,
                type: 'upgrade',
                icon: '⬆️',
                available: points >= 1000,
                pointsNeeded: points < 1000 ? 1000 - points : 0
            },
            {
                name: 'Accès Spa',
                points: 1500,
                type: 'spa',
                icon: '💆',
                available: points >= 1500,
                pointsNeeded: points < 1500 ? 1500 - points : 0
            },
            {
                name: 'Nuit gratuite',
                points: 5000,
                type: 'free_night',
                icon: '🏨',
                available: points >= 5000,
                pointsNeeded: points < 5000 ? 5000 - points : 0
            }
        ];
        
        return rewards;
    }

    /**
     * Get tier celebration data (NOUVELLE MÉTHODE)
     */
    getTierCelebrationData(tier) {
        const celebrations = {
            'SILVER': {
                title: '🥈 Bienvenue au niveau Argent !',
                message: 'Vous accédez maintenant aux avantages privilégiés et au check-in prioritaire !',
                badge: `${process.env.FRONTEND_URL}/images/badges/silver-badge.png`,
                achievement: 'Première promotion ! Continuez sur cette voie !'
            },
            'GOLD': {
                title: '🥇 Félicitations, vous êtes Or !',
                message: 'Bienvenue dans l\'élite ! Profitez du petit-déjeuner gratuit et de vos upgrades !',
                badge: `${process.env.FRONTEND_URL}/images/badges/gold-badge.png`,
                achievement: 'Excellent ! Vous faites partie des membres privilégiés !'
            },
            'PLATINUM': {
                title: '💎 Niveau Platine atteint !',
                message: 'Vous faites maintenant partie du cercle VIP avec accès lounge exclusif !',
                badge: `${process.env.FRONTEND_URL}/images/badges/platinum-badge.png`,
                achievement: 'Exceptionnel ! Statut VIP confirmé !'
            },
            'DIAMOND': {
                title: '💠 Diamant - Le Summum !',
                message: 'Félicitations ! Vous avez atteint notre niveau le plus prestigieux !',
                badge: `${process.env.FRONTEND_URL}/images/badges/diamond-badge.png`,
                achievement: 'Legendary ! Vous êtes dans le top 1% de nos membres !'
            }
        };
        return celebrations[tier] || celebrations['SILVER'];
    }

    /**
     * Get tier display name
     */
    getTierDisplayName(tier) {
        const names = {
            'BRONZE': 'Bronze',
            'SILVER': 'Argent',
            'GOLD': 'Or',
            'PLATINUM': 'Platine',
            'DIAMOND': 'Diamant'
        };
        return names[tier] || 'Bronze';
    }

    /**
     * Get tier icon
     */
    getTierIcon(tier) {
        const icons = {
            'BRONZE': '🥉',
            'SILVER': '🥈',
            'GOLD': '🥇',
            'PLATINUM': '💎',
            'DIAMOND': '💠'
        };
        return icons[tier] || '🥉';
    }

    /**
     * Get tier badge URL
     */
    getTierBadgeUrl(tier) {
        return `${process.env.FRONTEND_URL}/images/badges/${tier.toLowerCase()}-badge.png`;
    }

    /**
     * Get motivational message based on points earned
     */
    getMotivationalMessage(pointsEarned) {
        if (pointsEarned >= 1000) return 'Fantastique ! Vous êtes sur la bonne voie !';
        if (pointsEarned >= 500) return 'Excellent ! Continuez comme ça !';
        if (pointsEarned >= 200) return 'Très bien ! Chaque point compte !';
        return 'Bon début ! Vos points s\'accumulent !';
    }

    /**
     * Calculate next milestone
     */
    calculateNextMilestone(currentTier, progress) {
        const milestones = {
            'BRONZE': { next: 'SILVER', points: 1000 },
            'SILVER': { next: 'GOLD', points: 5000 },
            'GOLD': { next: 'PLATINUM', points: 15000 },
            'PLATINUM': { next: 'DIAMOND', points: 50000 },
            'DIAMOND': { next: null, points: null }
        };

        const milestone = milestones[currentTier];
        if (!milestone.next) return null;

        return {
            nextTier: milestone.next,
            nextTierDisplay: this.getTierDisplayName(milestone.next),
            pointsNeeded: progress.pointsToNextTier,
            progressPercentage: progress.progressPercentage
        };
    }

    /**
     * Get all tiers info for welcome email
     */
    getAllTiersInfo() {
        return [
            {
                name: 'Bronze',
                icon: '🥉',
                threshold: '0 points',
                benefits: ['Points sur réservations', 'Offres exclusives']
            },
            {
                name: 'Argent',
                icon: '🥈',
                threshold: '1 000 points',
                benefits: ['20% bonus points', 'Check-in prioritaire', '1 upgrade/an']
            },
            {
                name: 'Or',
                icon: '🥇',
                threshold: '5 000 points',
                benefits: ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades/an']
            },
            {
                name: 'Platine',
                icon: '💎',
                threshold: '15 000 points',
                benefits: ['Double points', 'Accès lounge', '1 nuit gratuite/an']
            },
            {
                name: 'Diamant',
                icon: '💠',
                threshold: '50 000 points',
                benefits: ['2.5x points', 'Suite upgrade', '2 nuits gratuites/an']
            }
        ];
    }

    /**
     * Get unlocked benefits between tier upgrade
     */
    getUnlockedBenefits(oldTier, newTier) {
        const allBenefits = {
            'SILVER': ['20% bonus points', 'Check-in prioritaire', '1 upgrade gratuit/an'],
            'GOLD': ['50% bonus points', 'Petit-déjeuner gratuit', '2 upgrades/an', 'Check-out tardif'],
            'PLATINUM': ['Double points', 'Accès lounge VIP', '1 nuit gratuite/an', 'Upgrade automatique'],
            'DIAMOND': ['2.5x points', 'Suite upgrade', '2 nuits gratuites/an', 'Service concierge']
        };

        const oldBenefits = allBenefits[oldTier] || [];
        const newBenefits = allBenefits[newTier] || [];
        
        return newBenefits.filter(benefit => !oldBenefits.includes(benefit));
    }

    /**
     * Get tier upgrade message
     */
    getTierUpgradeMessage(tier) {
        const messages = {
            'SILVER': 'Vous accédez maintenant aux avantages privilégiés !',
            'GOLD': 'Bienvenue dans l\'élite de nos membres fidèles !',
            'PLATINUM': 'Vous faites maintenant partie de notre cercle VIP !',
            'DIAMOND': 'Félicitations ! Vous avez atteint le niveau le plus prestigieux !'
        };
        return messages[tier] || 'Félicitations pour votre promotion !';
    }

    /**
     * Get special bonus message by type
     */
    getSpecialBonusMessage(type) {
        const messages = {
            'EARN_BIRTHDAY': 'Nous espérons que vous passez une merveilleuse journée !',
            'EARN_REFERRAL': 'Merci de faire découvrir nos services à vos proches !',
            'EARN_REVIEW': 'Votre avis compte énormément pour nous !',
            'EARN_ANNIVERSARY': 'Merci pour votre fidélité durant cette année !'
        };
        return messages[type] || 'Merci de faire partie de notre programme !';
    }

    /**
     * Get next steps after bonus
     */
    getBonusNextSteps(type) {
        const steps = {
            'EARN_BIRTHDAY': ['Profitez de votre journée spéciale', 'Planifiez votre prochaine escapade'],
            'EARN_REFERRAL': ['Invitez d\'autres amis', 'Planifiez un voyage ensemble'],
            'EARN_REVIEW': ['Partagez votre expérience', 'Découvrez nos autres hôtels'],
            'EARN_ANNIVERSARY': ['Célébrez avec une nouvelle réservation', 'Explorez nos destinations']
        };
        return steps[type] || ['Utilisez vos points', 'Continuez à accumuler'];
    }

    /**
     * Get bonus email template name
     */
    getBonusEmailTemplate(type) {
        const templates = {
            'EARN_BIRTHDAY': this.templates.has('birthday-bonus') ? 'birthday-bonus' : 'loyalty-points',
            'EARN_REFERRAL': this.templates.has('referral-bonus') ? 'referral-bonus' : 'loyalty-points',
            'EARN_REVIEW': this.templates.has('review-bonus') ? 'review-bonus' : 'loyalty-points',
            'EARN_ANNIVERSARY': this.templates.has('anniversary-bonus') ? 'anniversary-bonus' : 'loyalty-points'
        };
        return templates[type] || 'loyalty-points';
    }

    /**
     * Updated method to work with new loyalty system
     */
    calculateNextRewardThreshold(currentPoints) {
        const thresholds = [100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000];
        return thresholds.find(threshold => threshold > currentPoints) || 50000;
    }

    /**
     * Updated method to work with new loyalty system
     */
    getAvailableRewards(points) {
        const rewards = [];
        if (points >= 100) rewards.push({ name: 'Réduction 1€', points: 100, type: 'discount' });
        if (points >= 250) rewards.push({ name: 'Petit-déjeuner gratuit', points: 250, type: 'breakfast' });
        if (points >= 500) rewards.push({ name: 'Réduction 5€', points: 500, type: 'discount' });
        if (points >= 1000) rewards.push({ name: 'Upgrade chambre', points: 1000, type: 'upgrade' });
        if (points >= 5000) rewards.push({ name: 'Nuit gratuite', points: 5000, type: 'free_night' });
        return rewards;
    }

    // ============================================================================
    // MÉTHODE D'INTÉGRATION PRINCIPALE
    // ============================================================================

    /**
     * Main method to integrate with loyalty service (NOUVELLE MÉTHODE PRINCIPALE)
     */
    async sendLoyaltyNotification(type, user, data) {
        try {
            switch (type) {
                case 'POINTS_EARNED':
                    return await this.sendLoyaltyPointsEmail(user, data);
                
                case 'TIER_UPGRADE':
                    return await this.sendTierUpgradeEmail(user, data);
                
                case 'POINTS_EXPIRING':
                    return await this.sendPointsExpiryWarning(user.email, data);
                
                case 'WELCOME':
                    return await this.sendLoyaltyWelcomeEmail(user.email, user);
                
                case 'BONUS_POINTS':
                    return await this.sendBonusPointsEmail(user.email, data);
                
                case 'MONTHLY_DIGEST':
                    return await this.sendLoyaltyDigest(user.email, data);
                
                default:
                    logger.warn(`Unknown loyalty notification type: ${type}`);
                    return false;
            }
        } catch (error) {
            logger.error(`Failed to send loyalty notification ${type}:`, error);
            throw error;
        }
    }
}

module.exports = new EmailService();