const twilio = require('twilio');
const moment = require('moment');
const { logger } = require('../utils/logger');

class SMSService {
    constructor() {
        this.client = null;
        this.fromNumber = process.env.TWILIO_PHONE_NUMBER;
        this.enabled = process.env.TWILIO_ENABLED === 'true';
        this.initializeTwilio();
    }

    /**
     * Initialize Twilio client
     */
    initializeTwilio() {
        if (!this.enabled) {
            logger.info('SMS Service disabled in configuration');
            return;
        }

        try {
            const accountSid = process.env.TWILIO_ACCOUNT_SID;
            const authToken = process.env.TWILIO_AUTH_TOKEN;

            if (!accountSid || !authToken || !this.fromNumber) {
                throw new Error('Missing Twilio credentials in environment variables');
            }

            this.client = twilio(accountSid, authToken);
            logger.info('SMS Service initialized successfully');
        } catch (error) {
            logger.error('Failed to initialize SMS Service:', error);
            this.enabled = false;
        }
    }

    /**
     * Send SMS with error handling and logging
     */
    async sendSMS(to, message, options = {}) {
        if (!this.enabled || !this.client) {
            logger.warn('SMS Service not available, skipping SMS send');
            return { success: false, reason: 'SMS Service not enabled' };
        }

        try {
            // Format phone number for international use
            const formattedPhone = this.formatPhoneNumber(to);
            
            const smsOptions = {
                body: message,
                from: this.fromNumber,
                to: formattedPhone,
                ...options
            };

            const result = await this.client.messages.create(smsOptions);
            
            logger.info(`SMS sent successfully to ${formattedPhone}`, {
                messageSid: result.sid,
                status: result.status
            });

            return {
                success: true,
                messageSid: result.sid,
                status: result.status,
                to: formattedPhone
            };
        } catch (error) {
            logger.error(`Failed to send SMS to ${to}:`, error);
            return {
                success: false,
                error: error.message,
                code: error.code
            };
        }
    }

    /**
     * Send booking confirmation SMS
     */
    async sendBookingConfirmation(booking, user, hotel) {
        const message = `🏨 Réservation confirmée!
${hotel.name}
📅 ${moment(booking.checkInDate).format('DD/MM/YY')} - ${moment(booking.checkOutDate).format('DD/MM/YY')}
🎫 N° ${booking.confirmationNumber}
💰 ${booking.totalAmount}€
✉️ Un email avec les détails a été envoyé.`;

        return await this.sendSMS(user.phone, message, {
            statusCallback: `${process.env.BACKEND_URL}/api/sms/status-callback`
        });
    }

    /**
     * Send booking status update SMS
     */
    async sendBookingStatusUpdate(booking, user, hotel, status, adminComment = null) {
        let message;
        
        if (status === 'CONFIRMED') {
            message = `✅ Réservation CONFIRMÉE!
${hotel.name}
📅 ${moment(booking.checkInDate).format('DD/MM/YY')} - ${moment(booking.checkOutDate).format('DD/MM/YY')}
🎫 ${booking.confirmationNumber}
📧 Détails par email envoyés.`;
        } else if (status === 'REJECTED') {
            message = `❌ Réservation ANNULÉE
${hotel.name}
🎫 ${booking.confirmationNumber}
${adminComment ? `📝 ${adminComment}` : ''}
📞 Contactez-nous: ${hotel.phone}`;
        }

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send check-in reminder SMS (24h before)
     */
    async sendCheckInReminder(booking, user, hotel) {
        const message = `🏨 Rappel Check-in DEMAIN!
${hotel.name}
📅 ${moment(booking.checkInDate).format('DD/MM/YYYY')}
⏰ Arrivée: ${hotel.checkInTime || '15:00'}
📍 ${hotel.address}, ${hotel.city}
🎫 N°: ${booking.confirmationNumber}
📱 Check-in mobile disponible`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send payment reminder SMS
     */
    async sendPaymentReminder(booking, user, hotel, daysUntilDue = 3) {
        const amountDue = booking.totalAmount - (booking.paidAmount || 0);
        
        const message = `💳 Rappel de paiement
${hotel.name}
🎫 ${booking.confirmationNumber}
💰 Solde: ${amountDue}€
⏰ Échéance: ${daysUntilDue} jour(s)
🌐 Lien de paiement par email envoyé`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send check-in instructions SMS (day of arrival)
     */
    async sendCheckInInstructions(booking, user, hotel, roomNumber = null) {
        const message = `🔑 Instructions Check-in
${hotel.name}
📅 Aujourd'hui - ${moment(booking.checkInDate).format('DD/MM')}
⏰ Dès ${hotel.checkInTime || '15:00'}
${roomNumber ? `🚪 Chambre: ${roomNumber}` : ''}
📍 Réception: ${hotel.address}
🆔 Pièce d'identité requise
🎫 N°: ${booking.confirmationNumber}`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send promotional offer SMS
     */
    async sendPromotionalOffer(user, promotion, hotel = null) {
        const message = `🎉 OFFRE SPÉCIALE!
${promotion.title}
💯 -${promotion.discountValue}${promotion.discountType === 'PERCENTAGE' ? '%' : '€'}
🏷️ Code: ${promotion.code}
⏰ Valide jusqu'au ${moment(promotion.validUntil).format('DD/MM/YY')}
${hotel ? `🏨 ${hotel.name}` : ''}
🌐 Réservez maintenant!`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send loyalty points notification SMS
     */
    async sendLoyaltyPointsUpdate(user, pointsEarned, totalPoints) {
        const message = `🎁 Points Fidélité!
➕ +${pointsEarned} points gagnés
🏆 Total: ${totalPoints} points
${totalPoints >= 500 ? '🎊 Nuit gratuite disponible!' : ''}
📱 Consultez vos récompenses sur l'app`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send emergency or urgent notification
     */
    async sendUrgentNotification(user, message, hotel = null) {
        const urgentMessage = `⚠️ URGENT - ${hotel ? hotel.name : 'Hotel Management'}
${message}
📞 Contact: ${hotel ? hotel.phone : process.env.SUPPORT_PHONE || '📧 support@hotelmanagement.com'}`;

        return await this.sendSMS(user.phone, urgentMessage, {
            priority: 'high'
        });
    }

    /**
     * Send checkout confirmation SMS
     */
    async sendCheckoutConfirmation(booking, user, hotel, finalAmount = null) {
        const message = `✅ Check-out confirmé
${hotel.name}
📅 ${moment().format('DD/MM/YYYY')}
🎫 ${booking.confirmationNumber}
${finalAmount ? `💰 Total: ${finalAmount}€` : ''}
📧 Facture envoyée par email
🌟 Merci de votre séjour!`;

        return await this.sendSMS(user.phone, message);
    }

    /**
     * Send group booking notification SMS
     */
    async sendGroupBookingNotification(groupBooking, contactPerson, hotel) {
        const message = `👥 Réservation Groupe
${hotel.name}
📅 ${moment(groupBooking.checkInDate).format('DD/MM/YY')} - ${moment(groupBooking.checkOutDate).format('DD/MM/YY')}
🏠 ${groupBooking.totalRooms} chambres
👤 ${groupBooking.totalGuests} personnes
🎫 Groupe: ${groupBooking.groupCode}
📧 Détails envoyés par email`;

        return await this.sendSMS(contactPerson.phone, message);
    }

    /**
     * Bulk SMS sending for marketing campaigns
     */
    async sendBulkSMS(recipients, message, options = {}) {
        if (!this.enabled) {
            return { success: false, reason: 'SMS Service not enabled' };
        }

        const results = [];
        const batchSize = 10; // Send in smaller batches for SMS
        const delay = 1000; // 1 second delay between batches

        for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);
            
            const batchPromises = batch.map(async (recipient) => {
                try {
                    return await this.sendSMS(recipient.phone, message, options);
                } catch (error) {
                    logger.error(`Bulk SMS failed for ${recipient.phone}:`, error);
                    return { success: false, error: error.message, phone: recipient.phone };
                }
            });

            const batchResults = await Promise.allSettled(batchPromises);
            results.push(...batchResults);

            // Add delay between batches to avoid rate limits
            if (i + batchSize < recipients.length) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }

        const successCount = results.filter(r => r.value?.success).length;
        logger.info(`Bulk SMS campaign completed: ${successCount}/${recipients.length} sent successfully`);

        return {
            success: true,
            totalSent: successCount,
            totalFailed: recipients.length - successCount,
            results
        };
    }

    /**
     * Get SMS delivery status
     */
    async getSMSStatus(messageSid) {
        if (!this.enabled || !this.client) {
            return null;
        }

        try {
            const message = await this.client.messages(messageSid).fetch();
            return {
                sid: message.sid,
                status: message.status,
                direction: message.direction,
                dateSent: message.dateSent,
                price: message.price,
                priceUnit: message.priceUnit
            };
        } catch (error) {
            logger.error(`Failed to get SMS status for ${messageSid}:`, error);
            return null;
        }
    }

    /**
     * Format phone number for international SMS
     */
    formatPhoneNumber(phone) {
        if (!phone) return null;

        // Remove all non-digit characters
        let cleaned = phone.replace(/\D/g, '');

        // Handle Morocco numbers (+212)
        if (cleaned.startsWith('212') && cleaned.length === 12) {
            return `+${cleaned}`;
        }
        
        // Handle Morocco numbers without country code (0XXXXXXXXX)
        if (cleaned.startsWith('0') && cleaned.length === 10) {
            return `+212${cleaned.substring(1)}`;
        }

        // Handle international numbers
        if (cleaned.length >= 10 && !cleaned.startsWith('+')) {
            // If no country code detected, assume Morocco for local numbers
            if (cleaned.length === 9) {
                return `+212${cleaned}`;
            }
            return `+${cleaned}`;
        }

        // Return as-is if already formatted
        return phone.startsWith('+') ? phone : `+${cleaned}`;
    }

    /**
     * Validate phone number format
     */
    isValidPhoneNumber(phone) {
        if (!phone) return false;
        
        const formatted = this.formatPhoneNumber(phone);
        // Basic validation: should start with + and have 10-15 digits
        const phoneRegex = /^\+\d{10,15}$/;
        return phoneRegex.test(formatted);
    }

    /**
     * Get SMS service status and statistics
     */
    getServiceStatus() {
        return {
            enabled: this.enabled,
            fromNumber: this.fromNumber,
            provider: 'Twilio',
            accountSid: process.env.TWILIO_ACCOUNT_SID ? 
                `${process.env.TWILIO_ACCOUNT_SID.substring(0, 10)}...` : null
        };
    }
}

module.exports = new SMSService();