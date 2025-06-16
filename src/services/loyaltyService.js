/**
 * LOYALTY SERVICE - SERVICE COMPLET PROGRAMME DE FIDÉLITÉ
 * 
 * Fonctionnalités principales :
 * - Attribution automatique de points
 * - Gestion niveaux et promotions
 * - Utilisation de points (réductions, upgrades, nuits gratuites)
 * - Notifications temps réel
 * - Analytics et reporting
 * - Campagnes et promotions
 * - Intégration workflow réservation
 */

const mongoose = require('mongoose');

// Modèles
const User = require('../models/User');
const LoyaltyTransaction = require('../models/LoyaltyTransaction');
const Booking = require('../models/Booking');
const Hotel = require('../models/Hotel');

// Services existants
const socketService = require('./socketService');
const emailService = require('./emailService');
const smsService = require('./smsService');

// Configuration
const { logger } = require('../middleware/logger');

class LoyaltyService {
  constructor() {
    // Configuration du programme de fidélité
    this.config = {
      // Seuils de niveaux (en points lifetime)
      tierThresholds: {
        BRONZE: 0,
        SILVER: 1000,
        GOLD: 5000,
        PLATINUM: 15000,
        DIAMOND: 50000
      },
      
      // Bénéfices par niveau avec multiplicateurs
      tierBenefits: {
        BRONZE: {
          pointsMultiplier: 1.0,
          benefits: ['Points sur réservations'],
          welcomeBonus: 100,
          birthdayBonus: 100
        },
        SILVER: {
          pointsMultiplier: 1.2,
          benefits: [
            '20% bonus points', 
            'Check-in prioritaire', 
            '1 upgrade gratuit/an',
            'Wi-Fi premium gratuit'
          ],
          welcomeBonus: 200,
          birthdayBonus: 200,
          upgradesPerYear: 1
        },
        GOLD: {
          pointsMultiplier: 1.5,
          benefits: [
            '50% bonus points', 
            'Petit-déjeuner gratuit', 
            '2 upgrades gratuits/an',
            'Check-out tardif gratuit',
            'Accès Wi-Fi premium'
          ],
          welcomeBonus: 500,
          birthdayBonus: 300,
          upgradesPerYear: 2,
          freeBreakfast: true
        },
        PLATINUM: {
          pointsMultiplier: 2.0,
          benefits: [
            'Double points', 
            'Room upgrade automatique', 
            'Accès lounge VIP', 
            '1 nuit gratuite/an',
            'Room service 25% réduction',
            'Transfert aéroport prioritaire'
          ],
          welcomeBonus: 1000,
          birthdayBonus: 500,
          upgradesPerYear: 5,
          freeNightsPerYear: 1,
          loungeAccess: true
        },
        DIAMOND: {
          pointsMultiplier: 2.5,
          benefits: [
            '2.5x points', 
            'Suite upgrade automatique', 
            'Accès VIP premium', 
            '2 nuits gratuites/an',
            'Service concierge dédié',
            'Transfert aéroport premium',
            'Spa 50% réduction'
          ],
          welcomeBonus: 2000,
          birthdayBonus: 750,
          upgradesPerYear: 10,
          freeNightsPerYear: 2,
          vipStatus: true,
          conciergeService: true
        }
      },
      
      // Règles de gains de points
      earningRules: {
        bookingBase: 1, // 1 point par euro dépensé
        reviewBonus: 100,
        referralBonus: 500,
        birthdayBonus: 250,
        anniversaryBonus: 500,
        surveyBonus: 50,
        socialShareBonus: 25,
        checkInBonus: 10, // Points bonus au check-in
        multipleBookingsBonus: 0.1 // 10% bonus si plusieurs réservations/mois
      },
      
      // Règles d'utilisation des points
      redemptionRules: {
        discountRate: 100, // 100 points = 1 euro de réduction
        upgradeRoomCost: 1000, // 1000 points pour upgrade chambre
        freeNightCost: 5000, // 5000 points pour nuit gratuite
        breakfastCost: 250, // 250 points pour petit-déjeuner
        lateCheckoutCost: 150, // 150 points pour check-out tardif
        earlyCheckinCost: 150, // 150 points pour check-in précoce
        loungeAccessCost: 300, // 300 points pour accès lounge
        spaDiscountCost: 200, // 200 points pour 20% réduction spa
        minimumRedemption: 100, // Minimum 100 points pour utiliser
        maximumRedemptionPerBooking: 5000 // Maximum 5000 points par réservation
      },
      
      // Expiration des points
      pointsExpiry: {
        enabled: true,
        monthsToExpire: 24, // 24 mois
        warningMonths: 3 // Avertir 3 mois avant expiration
      },
      
      // Campagnes et promotions
      campaigns: {
        newMemberBonus: 200, // Bonus adhésion
        firstBookingBonus: 300, // Bonus première réservation
        seasonalMultipliers: {
          SUMMER: 1.5, // Été : 50% bonus
          WINTER: 1.2, // Hiver : 20% bonus
          SPRING: 1.1, // Printemps : 10% bonus
          AUTUMN: 1.0  // Automne : standard
        }
      }
    };
    
    // Cache pour optimiser les performances
    this.cache = new Map();
    this.cacheExpiry = 10 * 60 * 1000; // 10 minutes
    
    // Statistiques en temps réel
    this.stats = {
      dailyTransactions: 0,
      dailyPointsIssued: 0,
      dailyPointsRedeemed: 0,
      activeCampaigns: 0
    };
    
    logger.info('LoyaltyService initialized');
  }

  // ============================================================================
  // GESTION DES POINTS - ATTRIBUTION
  // ============================================================================

  /**
   * Attribuer des points pour une réservation
   * Méthode principale appelée après création/confirmation de réservation
   */
  async awardBookingPoints(bookingId, userId, options = {}) {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        // Récupérer booking et user
        const [booking, user] = await Promise.all([
          Booking.findById(bookingId)
            .populate('hotel', 'name code category')
            .session(session),
          User.findById(userId).session(session)
        ]);

        if (!booking || !user) {
          throw new Error('Booking ou utilisateur non trouvé');
        }

        // Vérifier si points déjà attribués
        const existingTransaction = await LoyaltyTransaction.findOne({
          user: userId,
          booking: bookingId,
          type: 'EARN_BOOKING'
        }).session(session);

        if (existingTransaction) {
          logger.warn(`Points déjà attribués pour booking ${bookingId}`);
          return { 
            success: false, 
            message: 'Points déjà attribués',
            existingPoints: existingTransaction.pointsAmount 
          };
        }

        // Calculer points de base
        const basePoints = Math.floor(booking.totalPrice * this.config.earningRules.bookingBase);
        
        // Appliquer multiplicateur de niveau
        const tierMultiplier = this.config.tierBenefits[user.loyalty.tier].pointsMultiplier;
        
        // Bonus campagne saisonnière
        const seasonMultiplier = this.getSeasonalMultiplier();
        
        // Bonus réservations multiples
        const multipleBookingsMultiplier = await this.calculateMultipleBookingsBonus(userId);
        
        // Calcul final
        const totalMultiplier = tierMultiplier * seasonMultiplier * multipleBookingsMultiplier;
        const finalPoints = Math.floor(basePoints * totalMultiplier);

        // Créer transaction
        const transactionData = {
          user: userId,
          booking: bookingId,
          hotel: booking.hotel._id,
          type: 'EARN_BOOKING',
          pointsAmount: finalPoints,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints + finalPoints,
          description: `Points réservation ${booking.bookingNumber} - ${booking.hotel.name}`,
          earnedFrom: {
            bookingAmount: booking.totalPrice,
            pointsRate: this.config.earningRules.bookingBase,
            bonusMultiplier: totalMultiplier,
            tierAtEarning: user.loyalty.tier
          },
          source: options.source || 'SYSTEM',
          expiresAt: new Date(Date.now() + this.config.pointsExpiry.monthsToExpire * 30 * 24 * 60 * 60 * 1000)
        };

        const transaction = new LoyaltyTransaction(transactionData);
        await transaction.save({ session });

        // Mettre à jour utilisateur
        const loyaltyUpdate = user.addLoyaltyPoints(finalPoints, `Réservation ${booking.bookingNumber}`);
        await user.save({ session });

        // Notifications temps réel
        await this.sendPointsEarnedNotifications(user, finalPoints, booking, loyaltyUpdate);

        // Vérifier promotion de niveau
        if (loyaltyUpdate.tierUpgrade.upgraded) {
          await this.handleTierUpgrade(user, loyaltyUpdate.tierUpgrade, session);
        }

        // Statistiques
        this.updateDailyStats('earned', finalPoints);

        logger.info(`Points attribués: ${finalPoints} pour user ${userId}, booking ${bookingId}`);

        return {
          success: true,
          pointsAwarded: finalPoints,
          newBalance: user.loyalty.currentPoints,
          tierUpgrade: loyaltyUpdate.tierUpgrade,
          transaction: transaction._id,
          breakdown: {
            basePoints,
            tierMultiplier,
            seasonMultiplier,
            totalMultiplier,
            finalPoints
          }
        };
      });
    } catch (error) {
      logger.error('Erreur attribution points:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Attribuer points bonus (anniversaire, parrainage, etc.)
   */
  async awardBonusPoints(userId, type, amount, description, metadata = {}) {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        
        if (!user) {
          throw new Error('Utilisateur non trouvé');
        }

        // Vérifier si bonus déjà attribué (pour anniversaires, etc.)
        if (type === 'EARN_BIRTHDAY') {
          const today = new Date();
          const startOfYear = new Date(today.getFullYear(), 0, 1);
          
          const existingBonus = await LoyaltyTransaction.findOne({
            user: userId,
            type: 'EARN_BIRTHDAY',
            createdAt: { $gte: startOfYear }
          }).session(session);
          
          if (existingBonus) {
            return { success: false, message: 'Bonus anniversaire déjà attribué cette année' };
          }
        }

        // Créer transaction
        const transaction = new LoyaltyTransaction({
          user: userId,
          type,
          pointsAmount: amount,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints + amount,
          description,
          earnedFrom: {
            bonusMultiplier: 1,
            tierAtEarning: user.loyalty.tier,
            bonusDetails: JSON.stringify(metadata)
          },
          source: 'SYSTEM',
          expiresAt: new Date(Date.now() + this.config.pointsExpiry.monthsToExpire * 30 * 24 * 60 * 60 * 1000)
        });

        await transaction.save({ session });

        // Mettre à jour utilisateur
        const loyaltyUpdate = user.addLoyaltyPoints(amount, description);
        await user.save({ session });

        // Notifications
        await this.sendBonusPointsNotifications(user, amount, type, description);

        // Vérifier promotion de niveau
        if (loyaltyUpdate.tierUpgrade.upgraded) {
          await this.handleTierUpgrade(user, loyaltyUpdate.tierUpgrade, session);
        }

        this.updateDailyStats('earned', amount);

        return {
          success: true,
          pointsAwarded: amount,
          newBalance: user.loyalty.currentPoints,
          tierUpgrade: loyaltyUpdate.tierUpgrade,
          transaction: transaction._id
        };
      });
    } catch (error) {
      logger.error('Erreur attribution bonus points:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // ============================================================================
  // GESTION DES POINTS - UTILISATION
  // ============================================================================

  /**
   * Utiliser des points pour une réduction
   */
  async redeemPointsForDiscount(userId, pointsToRedeem, bookingId, options = {}) {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        
        if (!user || user.loyalty.currentPoints < pointsToRedeem) {
          throw new Error('Points insuffisants');
        }
        
        if (pointsToRedeem < this.config.redemptionRules.minimumRedemption) {
          throw new Error(`Minimum ${this.config.redemptionRules.minimumRedemption} points requis`);
        }

        if (pointsToRedeem > this.config.redemptionRules.maximumRedemptionPerBooking) {
          throw new Error(`Maximum ${this.config.redemptionRules.maximumRedemptionPerBooking} points par réservation`);
        }

        // Calculer réduction
        const discountAmount = pointsToRedeem / this.config.redemptionRules.discountRate;

        // Créer transaction
        const transaction = new LoyaltyTransaction({
          user: userId,
          booking: bookingId,
          type: 'REDEEM_DISCOUNT',
          pointsAmount: -pointsToRedeem,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints - pointsToRedeem,
          description: `Réduction de ${discountAmount}€ avec ${pointsToRedeem} points`,
          redeemedFor: {
            discountAmount,
            benefitDescription: `Réduction fidélité ${pointsToRedeem} points`,
            appliedToBooking: bookingId,
            equivalentValue: discountAmount
          },
          source: options.source || 'WEB'
        });

        await transaction.save({ session });

        // Mettre à jour solde utilisateur
        user.redeemLoyaltyPoints(pointsToRedeem, `Réduction ${discountAmount}€`);
        await user.save({ session });

        // Notification standard (conservée)
        socketService.sendUserNotification(userId, 'POINTS_REDEEMED', {
          pointsUsed: pointsToRedeem,
          discountAmount,
          remainingPoints: user.loyalty.currentPoints,
          transactionId: transaction._id,
          message: `${pointsToRedeem} points utilisés pour ${discountAmount}€ de réduction`
        });

        // NOUVEAU : Notification loyalty spécialisée
        socketService.notifyPointsRedeemed(userId, {
          pointsUsed: pointsToRedeem,
          benefit: `Réduction ${discountAmount}€`,
          value: discountAmount,
          remainingPoints: user.loyalty.currentPoints,
          type: 'DISCOUNT'
        });

        this.updateDailyStats('redeemed', pointsToRedeem);

        return {
          success: true,
          discountAmount,
          pointsRedeemed: pointsToRedeem,
          remainingPoints: user.loyalty.currentPoints,
          transactionId: transaction._id
        };
      });
    } catch (error) {
      logger.error('Erreur utilisation points:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Utiliser des points pour un upgrade de chambre
   */
  async redeemPointsForUpgrade(userId, upgradeType, bookingId, options = {}) {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        const pointsCost = this.config.redemptionRules.upgradeRoomCost;
        
        if (!user || user.loyalty.currentPoints < pointsCost) {
          throw new Error('Points insuffisants pour upgrade');
        }

        // Types d'upgrade disponibles
        const upgradeTypes = {
          'ROOM_CATEGORY': { cost: 1000, description: 'Upgrade catégorie supérieure' },
          'VIEW': { cost: 500, description: 'Upgrade vue mer/montagne' },
          'FLOOR_HIGH': { cost: 300, description: 'Étage élevé' },
          'SUITE': { cost: 2000, description: 'Upgrade vers suite' }
        };

        const upgrade = upgradeTypes[upgradeType];
        if (!upgrade) {
          throw new Error('Type d\'upgrade invalide');
        }

        // Créer transaction
        const transaction = new LoyaltyTransaction({
          user: userId,
          booking: bookingId,
          type: 'REDEEM_UPGRADE',
          pointsAmount: -upgrade.cost,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints - upgrade.cost,
          description: `Upgrade: ${upgrade.description}`,
          redeemedFor: {
            upgradeType,
            benefitDescription: upgrade.description,
            appliedToBooking: bookingId,
            equivalentValue: upgrade.cost / this.config.redemptionRules.discountRate
          },
          source: options.source || 'WEB'
        });

        await transaction.save({ session });

        // Mettre à jour utilisateur
        user.redeemLoyaltyPoints(upgrade.cost, upgrade.description);
        await user.save({ session });

        // Notification standard (conservée)
        socketService.sendUserNotification(userId, 'UPGRADE_REDEEMED', {
          upgradeType,
          upgradeDescription: upgrade.description,
          pointsUsed: upgrade.cost,
          remainingPoints: user.loyalty.currentPoints,
          bookingId
        });

        // NOUVEAU : Notification loyalty spécialisée
        socketService.notifyPointsRedeemed(userId, {
          pointsUsed: upgrade.cost,
          benefit: upgrade.description,
          value: upgrade.cost / this.config.redemptionRules.discountRate,
          remainingPoints: user.loyalty.currentPoints,
          type: 'UPGRADE'
        });

        this.updateDailyStats('redeemed', upgrade.cost);

        return {
          success: true,
          upgradeType,
          upgradeDescription: upgrade.description,
          pointsRedeemed: upgrade.cost,
          remainingPoints: user.loyalty.currentPoints,
          transactionId: transaction._id
        };
      });
    } catch (error) {
      logger.error('Erreur upgrade points:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  /**
   * Utiliser des points pour une nuit gratuite
   */
  async redeemPointsForFreeNight(userId, hotelId, checkInDate, checkOutDate, roomType = 'DOUBLE') {
    const session = await mongoose.startSession();
    
    try {
      return await session.withTransaction(async () => {
        const user = await User.findById(userId).session(session);
        const pointsCost = this.config.redemptionRules.freeNightCost;
        
        if (!user || user.loyalty.currentPoints < pointsCost) {
          throw new Error('Points insuffisants pour nuit gratuite');
        }

        // Vérifier disponibilité (interface avec système de réservation)
        const hotel = await Hotel.findById(hotelId).session(session);
        if (!hotel) {
          throw new Error('Hôtel non trouvé');
        }

        // Créer transaction
        const transaction = new LoyaltyTransaction({
          user: userId,
          hotel: hotelId,
          type: 'REDEEM_FREE_NIGHT',
          pointsAmount: -pointsCost,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints - pointsCost,
          description: `Nuit gratuite - ${hotel.name}`,
          redeemedFor: {
            benefitDescription: `Nuit gratuite ${roomType}`,
            equivalentValue: pointsCost / this.config.redemptionRules.discountRate
          },
          source: 'WEB'
        });

        await transaction.save({ session });

        // Mettre à jour utilisateur
        user.redeemLoyaltyPoints(pointsCost, `Nuit gratuite ${hotel.name}`);
        await user.save({ session });

        // Créer voucher ou réservation
        const voucherCode = this.generateVoucherCode();

        // Notification standard (conservée)
        socketService.sendUserNotification(userId, 'FREE_NIGHT_REDEEMED', {
          hotelName: hotel.name,
          checkInDate,
          checkOutDate,
          roomType,
          pointsUsed: pointsCost,
          voucherCode,
          remainingPoints: user.loyalty.currentPoints
        });

        // NOUVEAU : Notification loyalty spécialisée
        socketService.notifyPointsRedeemed(userId, {
          pointsUsed: pointsCost,
          benefit: `Nuit gratuite - ${hotel.name}`,
          value: pointsCost / this.config.redemptionRules.discountRate,
          remainingPoints: user.loyalty.currentPoints,
          type: 'FREE_NIGHT'
        });

        this.updateDailyStats('redeemed', pointsCost);

        return {
          success: true,
          hotelName: hotel.name,
          voucherCode,
          pointsRedeemed: pointsCost,
          remainingPoints: user.loyalty.currentPoints,
          transactionId: transaction._id,
          instructions: 'Utilisez ce code lors de votre réservation'
        };
      });
    } catch (error) {
      logger.error('Erreur nuit gratuite:', error);
      throw error;
    } finally {
      await session.endSession();
    }
  }

  // ============================================================================
  // GESTION DES NIVEAUX
  // ============================================================================

  /**
   * Gérer promotion de niveau
   */
  async handleTierUpgrade(user, tierUpgrade, session) {
    try {
      const { oldTier, newTier } = tierUpgrade;
      
      // Points bonus pour promotion
      const welcomeBonus = this.config.tierBenefits[newTier].welcomeBonus;
      
      if (welcomeBonus > 0) {
        const bonusTransaction = new LoyaltyTransaction({
          user: user._id,
          type: 'TIER_BONUS',
          pointsAmount: welcomeBonus,
          previousBalance: user.loyalty.currentPoints,
          newBalance: user.loyalty.currentPoints + welcomeBonus,
          description: `Bonus promotion niveau ${newTier}`,
          earnedFrom: {
            bonusMultiplier: 1,
            bonusDetails: `Promotion ${oldTier} → ${newTier}`
          },
          source: 'SYSTEM',
          expiresAt: new Date(Date.now() + this.config.pointsExpiry.monthsToExpire * 30 * 24 * 60 * 60 * 1000)
        });

        await bonusTransaction.save({ session });
        user.loyalty.currentPoints += welcomeBonus;
        user.loyalty.lifetimePoints += welcomeBonus;
      }

      // Activer nouveaux bénéfices
      await this.activateTierBenefits(user, newTier);
      
      // Marquer célébration comme envoyée
      const lastTierHistory = user.loyalty.tierHistory[user.loyalty.tierHistory.length - 1];
      if (lastTierHistory) {
        lastTierHistory.celebrationSent = true;
      }

      await user.save({ session });

      // Notifications de promotion
      await this.sendTierUpgradeNotifications(user, oldTier, newTier, welcomeBonus);

      logger.info(`Tier upgrade: User ${user._id} promoted from ${oldTier} to ${newTier}`);

    } catch (error) {
      logger.error('Erreur gestion promotion niveau:', error);
      throw error;
    }
  }

  /**
   * Activer les bénéfices selon le niveau
   */
  async activateTierBenefits(user, tier) {
    const benefits = this.config.tierBenefits[tier];
    const newBenefits = [];

    // Calculer date d'expiration (fin d'année)
    const nextYear = new Date();
    nextYear.setFullYear(nextYear.getFullYear() + 1, 0, 1);

    // Activer bénéfices selon niveau
    if (benefits.upgradesPerYear) {
      newBenefits.push({
        type: 'UPGRADE',
        value: benefits.upgradesPerYear,
        description: `${benefits.upgradesPerYear} upgrade(s) gratuit(s) par an`,
        validUntil: nextYear,
        maxUsage: benefits.upgradesPerYear,
        usageCount: 0,
        autoRenew: true
      });
    }

    if (benefits.freeNightsPerYear) {
      newBenefits.push({
        type: 'FREE_NIGHT',
        value: benefits.freeNightsPerYear,
        description: `${benefits.freeNightsPerYear} nuit(s) gratuite(s) par an`,
        validUntil: nextYear,
        maxUsage: benefits.freeNightsPerYear,
        usageCount: 0,
        autoRenew: true
      });
    }

    if (benefits.freeBreakfast) {
      newBenefits.push({
        type: 'FREE_BREAKFAST',
        value: 100,
        description: 'Petit-déjeuner gratuit',
        validUntil: nextYear,
        maxUsage: 999,
        usageCount: 0,
        autoRenew: true
      });
    }

    if (benefits.loungeAccess) {
      newBenefits.push({
        type: 'LOUNGE_ACCESS',
        value: 100,
        description: 'Accès lounge VIP',
        validUntil: nextYear,
        maxUsage: 999,
        usageCount: 0,
        autoRenew: true
      });
    }

    // Remplacer les anciens bénéfices
    user.loyalty.activeBenefits = newBenefits;
  }

  // ============================================================================
  // STATUT ET INFORMATIONS UTILISATEUR
  // ============================================================================

  /**
   * Obtenir statut complet loyalty d'un utilisateur
   */
  async getLoyaltyStatus(userId, options = {}) {
    try {
      const cacheKey = `loyalty_status_${userId}`;
      
      // Vérifier cache
      if (!options.skipCache) {
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;
      }

      const user = await User.findById(userId)
        .select('firstName lastName loyalty preferences')
        .lean();
      
      if (!user) {
        throw new Error('Utilisateur non trouvé');
      }

      // Récupérer transactions récentes
      const recentTransactions = await LoyaltyTransaction.find({
        user: userId
      })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate('booking', 'bookingNumber totalPrice checkInDate')
      .populate('hotel', 'name code')
      .lean();

      // Calculer statistiques
      const stats = await this.calculateUserLoyaltyStats(userId);

      // Obtenir options d'utilisation
      const redemptionOptions = this.getRedemptionOptions(user.loyalty.currentPoints, user.loyalty.tier);

      // Prochains bénéfices disponibles
      const nextTierBenefits = this.getNextTierBenefits(user.loyalty.tier);

      // Points qui expirent bientôt
      const expiringPoints = await this.getExpiringPoints(userId);

      const result = {
        user: {
          name: `${user.firstName} ${user.lastName}`,
          tier: user.loyalty.tier,
          tierDisplay: this.getTierDisplayName(user.loyalty.tier),
          currentPoints: user.loyalty.currentPoints,
          lifetimePoints: user.loyalty.lifetimePoints,
          tierProgress: user.loyalty.tierProgress,
          memberSince: user.loyalty.enrolledAt,
          preferences: user.loyalty.preferences
        },
        benefits: {
          current: this.config.tierBenefits[user.loyalty.tier],
          active: user.loyalty.activeBenefits?.filter(b => 
            b.isActive && 
            b.validUntil > new Date() &&
            b.usageCount < b.maxUsage
          ) || [],
          next: nextTierBenefits
        },
        transactions: {
          recent: recentTransactions,
          summary: stats
        },
        redemption: {
          options: redemptionOptions,
          pointsValue: Math.round((user.loyalty.currentPoints / this.config.redemptionRules.discountRate) * 100) / 100
        },
        alerts: {
          expiringPoints: expiringPoints,
          nearTierUpgrade: user.loyalty.tierProgress?.progressPercentage >= 80,
          specialOffers: user.loyalty.specialStatus?.specialOffers?.filter(o => 
            o.validUntil > new Date() && !o.used
          ) || []
        },
        performance: user.loyalty.performance || {}
      };

      // Mettre en cache
      this.setCache(cacheKey, result);

      return result;
    } catch (error) {
      logger.error('Erreur récupération statut loyalty:', error);
      throw error;
    }
  }

  /**
   * Obtenir historique détaillé des transactions
   */
  async getLoyaltyHistory(userId, options = {}) {
    try {
      const {
        page = 1,
        limit = 20,
        type = null,
        startDate = null,
        endDate = null,
        status = 'COMPLETED'
      } = options;

      const query = { user: userId };
      
      if (type) query.type = type;
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const [transactions, totalCount] = await Promise.all([
        LoyaltyTransaction.find(query)
          .sort({ createdAt: -1 })
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .populate('booking', 'bookingNumber totalPrice checkInDate hotelName')
          .populate('hotel', 'name code')
          .lean(),
        LoyaltyTransaction.countDocuments(query)
      ]);

      // Grouper par mois pour affichage
      const groupedByMonth = this.groupTransactionsByMonth(transactions);

      return {
        transactions,
        groupedByMonth,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / limit),
          totalTransactions: totalCount,
          hasMore: page * limit < totalCount
        },
        summary: await this.calculatePeriodSummary(userId, startDate, endDate)
      };
    } catch (error) {
      logger.error('Erreur historique loyalty:', error);
      throw error;
    }
  }

  // ============================================================================
  // NOTIFICATIONS ET COMMUNICATIONS
  // ============================================================================

  /**
   * Envoyer notifications pour points gagnés
   */
  async sendPointsEarnedNotifications(user, pointsEarned, booking, loyaltyUpdate) {
    try {
      // Notification temps réel standard
      socketService.sendUserNotification(user._id, 'POINTS_EARNED', {
        pointsEarned,
        totalPoints: user.loyalty.currentPoints,
        bookingNumber: booking.bookingNumber,
        hotelName: booking.hotel.name,
        tier: user.loyalty.tier,
        tierProgress: user.loyalty.tierProgress,
        message: `Vous avez gagné ${pointsEarned} points !`,
        estimatedValue: Math.round((pointsEarned / this.config.redemptionRules.discountRate) * 100) / 100
      });

      // NOUVEAU : Notification loyalty spécialisée via socketService
      socketService.notifyPointsEarned(user._id, {
        amount: pointsEarned,
        booking: {
          number: booking.bookingNumber,
          hotelName: booking.hotel.name,
          amount: booking.totalPrice
        },
        tier: user.loyalty.tier,
        breakdown: {
          basePoints: Math.floor(booking.totalPrice * this.config.earningRules.bookingBase),
          multiplier: loyaltyUpdate.tierUpgrade ? 'with_tier_bonus' : 'standard'
        }
      });

      // Email avec template loyalty-points.html
      const emailData = {
        user: {
          firstName: user.firstName,
          lastName: user.lastName,
          tier: user.loyalty.tier,
          tierDisplay: this.getTierDisplayName(user.loyalty.tier)
        },
        points: {
          earned: pointsEarned,
          total: user.loyalty.currentPoints,
          estimatedValue: Math.round((pointsEarned / this.config.redemptionRules.discountRate) * 100) / 100
        },
        booking: {
          number: booking.bookingNumber,
          hotelName: booking.hotel.name,
          amount: booking.totalPrice
        },
        progress: user.loyalty.tierProgress,
        benefits: this.config.tierBenefits[user.loyalty.tier].benefits,
        redemptionOptions: this.getRedemptionOptions(user.loyalty.currentPoints, user.loyalty.tier).slice(0, 3)
      };

      await emailService.sendLoyaltyPointsEmail(user.email, emailData);

      // SMS si préférence activée
      if (user.loyalty.preferences?.communicationPreferences?.sms) {
        const smsMessage = `🎉 ${pointsEarned} points gagnés ! Total: ${user.loyalty.currentPoints} pts (≈${emailData.points.estimatedValue}€). Voir vos bénéfices sur votre compte.`;
        await smsService.sendSMS(user.phone, smsMessage);
      }

      // Notification push si mobile
      if (user.loyalty.preferences?.communicationPreferences?.push) {
        socketService.sendPushNotification(user._id, {
          title: '🏆 Points de fidélité gagnés !',
          body: `+${pointsEarned} points pour votre réservation`,
          data: {
            type: 'loyalty_points',
            points: pointsEarned,
            total: user.loyalty.currentPoints
          }
        });
      }

    } catch (error) {
      logger.error('Erreur envoi notifications points:', error);
    }
  }

  /**
   * Envoyer notifications pour bonus
   */
  async sendBonusPointsNotifications(user, amount, type, description) {
    try {
      const typeMessages = {
        'EARN_BIRTHDAY': '🎂 Joyeux anniversaire !',
        'EARN_REFERRAL': '👥 Merci pour le parrainage !',
        'EARN_REVIEW': '⭐ Merci pour votre avis !',
        'EARN_ANNIVERSARY': '🎉 Anniversaire de fidélité !',
        'EARN_SURVEY': '📋 Merci pour le sondage !',
        'EARN_SOCIAL': '📱 Merci pour le partage !'
      };

      const title = typeMessages[type] || '🎁 Points bonus !';

      // Notification temps réel standard
      socketService.sendUserNotification(user._id, 'BONUS_POINTS_EARNED', {
        type,
        amount,
        description,
        totalPoints: user.loyalty.currentPoints,
        title,
        message: `${amount} points bonus ajoutés à votre compte`
      });

      // NOUVEAU : Notification bonus spécialisée
      socketService.notifyPointsEarned(user._id, {
        amount,
        bonusType: type,
        description,
        tier: user.loyalty.tier,
        celebration: amount >= 500 // Animation si gros bonus
      });

      // Email spécialisé selon le type
      const emailTemplate = this.getBonusEmailTemplate(type);
      if (emailTemplate) {
        await emailService.sendEmail({
          to: user.email,
          template: emailTemplate,
          data: {
            user: { firstName: user.firstName, lastName: user.lastName },
            bonus: { amount, description, type },
            points: { total: user.loyalty.currentPoints },
            tier: user.loyalty.tier
          }
        });
      }

    } catch (error) {
      logger.error('Erreur notifications bonus:', error);
    }
  }

  /**
   * Envoyer notifications promotion de niveau
   */
  async sendTierUpgradeNotifications(user, oldTier, newTier, bonusPoints) {
    try {
      const newBenefits = this.config.tierBenefits[newTier];

      // Notification temps réel avec animation standard
      socketService.sendUserNotification(user._id, 'TIER_UPGRADED', {
        oldTier,
        newTier,
        newTierDisplay: this.getTierDisplayName(newTier),
        bonusPoints,
        newBenefits: newBenefits.benefits,
        multiplier: newBenefits.pointsMultiplier,
        congratulations: `Félicitations ! Vous êtes maintenant niveau ${this.getTierDisplayName(newTier)} !`,
        animation: 'tier_upgrade_celebration'
      });

      // NOUVEAU : Notification tier upgrade spécialisée
      socketService.notifyTierUpgrade(user._id, {
        oldTier,
        newTier,
        bonusPoints,
        newBenefits: newBenefits.benefits,
        celebration: true
      });

      // Email de félicitations avec nouveau tier
      await emailService.sendEmail({
        to: user.email,
        template: 'tier-upgrade',
        data: {
          user: {
            firstName: user.firstName,
            oldTier: this.getTierDisplayName(oldTier),
            newTier: this.getTierDisplayName(newTier)
          },
          benefits: {
            old: this.config.tierBenefits[oldTier].benefits,
            new: newBenefits.benefits,
            bonus: bonusPoints
          },
          welcome: {
            message: `Bienvenue dans le niveau ${this.getTierDisplayName(newTier)} !`,
            perks: newBenefits.benefits
          }
        }
      });

      // SMS de félicitations
      if (user.loyalty.preferences?.communicationPreferences?.sms) {
        const smsMessage = `🎉 FÉLICITATIONS ! Vous êtes maintenant niveau ${this.getTierDisplayName(newTier)} ! ${bonusPoints} points bonus ajoutés. Découvrez vos nouveaux avantages.`;
        await smsService.sendSMS(user.phone, smsMessage);
      }

      // Badge/achievement unlock notification
      socketService.sendUserNotification(user._id, 'ACHIEVEMENT_UNLOCKED', {
        achievement: `tier_${newTier.toLowerCase()}`,
        title: `Niveau ${this.getTierDisplayName(newTier)} débloqué !`,
        description: `Vous avez atteint le niveau ${this.getTierDisplayName(newTier)}`,
        icon: this.getTierIcon(newTier),
        rarity: this.getTierRarity(newTier)
      });

    } catch (error) {
      logger.error('Erreur notifications promotion:', error);
    }
  }

  /**
   * Diffuser une campagne loyalty
   */
  async broadcastLoyaltyCampaign(campaignData) {
    try {
      const { campaignId, name, type, value, eligibleTiers, hotelIds, message } = campaignData;
      
      // Utiliser socketService pour diffuser
      socketService.broadcastCampaign(campaignId, {
        name,
        type,
        value,
        eligibleTiers,
        hotelIds,
        message,
        createdAt: new Date()
      });

      logger.info(`Loyalty campaign broadcast: ${name} (${campaignId})`);
      return { success: true, campaignId, broadcastAt: new Date() };
    } catch (error) {
      logger.error('Erreur diffusion campagne loyalty:', error);
      throw error;
    }
  }

  /**
   * Envoyer promotion personnalisée
   */
  async sendPersonalizedLoyaltyPromotion(userId, promotionData) {
    try {
      const user = await User.findById(userId).select('loyalty').lean();
      if (!user?.loyalty) return false;

      const enrichedPromotion = {
        ...promotionData,
        tier: user.loyalty.tier,
        personalizedReason: `Offre spéciale niveau ${this.getTierDisplayName(user.loyalty.tier)}`,
        validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 jours
      };

      return socketService.sendPersonalPromotion(userId, enrichedPromotion);
    } catch (error) {
      logger.error('Erreur promotion personnalisée:', error);
      return false;
    }
  }

  /**
   * Surveiller santé système loyalty et envoyer alertes
   */
  async monitorLoyaltySystemHealth() {
    try {
      // Vérifier métriques système
      const dailyTransactions = this.stats.dailyTransactions;
      const activeMembers = await User.countDocuments({ 
        'loyalty.enrolledAt': { $exists: true },
        'loyalty.statistics.lastActivity': { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      });

      // Alertes de performance
      if (dailyTransactions < 10 && new Date().getHours() > 12) {
        socketService.sendLoyaltySystemAlert('low_activity', {
          severity: 'warning',
          message: `Faible activité loyalty aujourd'hui: ${dailyTransactions} transactions`,
          recommendation: 'Vérifier campagnes actives'
        });
      }

      // Alerte membres inactifs
      if (activeMembers < 50) {
        socketService.sendLoyaltySystemAlert('low_engagement', {
          severity: 'medium',
          message: `Seulement ${activeMembers} membres actifs`,
          recommendation: 'Lancer campagne de réactivation'
        });
      }

      return { healthy: true, dailyTransactions, activeMembers };
    } catch (error) {
      socketService.sendLoyaltySystemAlert('system_error', {
        severity: 'critical',
        message: 'Erreur monitoring système loyalty',
        error: error.message
      });
      return { healthy: false, error: error.message };
    }
  }

  // ============================================================================
  // ANALYTICS ET STATISTIQUES
  // ============================================================================

  /**
   * Calculer statistiques détaillées utilisateur
   */
  async calculateUserLoyaltyStats(userId) {
    try {
      const pipeline = [
        { $match: { user: new mongoose.Types.ObjectId(userId) } },
        {
          $group: {
            _id: null,
            totalTransactions: { $sum: 1 },
            totalEarned: {
              $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] }
            },
            totalRedeemed: {
              $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] }
            },
            averageEarning: {
              $avg: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', null] }
            },
            lastTransaction: { $max: '$createdAt' },
            mostRecentBooking: { $max: '$booking' },
            transactionsByType: {
              $push: {
                type: '$type',
                amount: '$pointsAmount',
                date: '$createdAt'
              }
            }
          }
        }
      ];

      const stats = await LoyaltyTransaction.aggregate(pipeline);
      const result = stats[0] || {
        totalTransactions: 0,
        totalEarned: 0,
        totalRedeemed: 0,
        averageEarning: 0,
        lastTransaction: null,
        transactionsByType: []
      };

      // Calculer métriques additionnelles
      const user = await User.findById(userId).select('loyalty').lean();
      if (user?.loyalty) {
        result.currentBalance = user.loyalty.currentPoints;
        result.lifetimePoints = user.loyalty.lifetimePoints;
        result.tier = user.loyalty.tier;
        result.memberSince = user.loyalty.enrolledAt;
        result.daysSinceMember = Math.floor((Date.now() - user.loyalty.enrolledAt) / (24 * 60 * 60 * 1000));
        result.pointsPerDay = result.daysSinceMember > 0 ? result.totalEarned / result.daysSinceMember : 0;
        result.redemptionRate = result.totalEarned > 0 ? (result.totalRedeemed / result.totalEarned) * 100 : 0;
      }

      return result;
    } catch (error) {
      logger.error('Erreur calcul stats loyalty:', error);
      return {};
    }
  }

  /**
   * Obtenir analytics globaux du programme
   */
  async getGlobalLoyaltyAnalytics(period = '30d', hotelId = null) {
    try {
      const endDate = new Date();
      const daysMap = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };
      const days = daysMap[period] || 30;
      const startDate = new Date(endDate.getTime() - days * 24 * 60 * 60 * 1000);

      const matchStage = {
        createdAt: { $gte: startDate, $lte: endDate }
      };

      if (hotelId) {
        matchStage.hotel = new mongoose.Types.ObjectId(hotelId);
      }

      const [transactionStats, userStats, tierDistribution] = await Promise.all([
        // Statistiques des transactions
        LoyaltyTransaction.aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: {
                date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                type: '$type'
              },
              count: { $sum: 1 },
              totalPoints: { $sum: '$pointsAmount' },
              uniqueUsers: { $addToSet: '$user' }
            }
          },
          {
            $group: {
              _id: '$_id.date',
              transactions: {
                $push: {
                  type: '$_id.type',
                  count: '$count',
                  totalPoints: '$totalPoints',
                  uniqueUsers: { $size: '$uniqueUsers' }
                }
              },
              dailyTotal: { $sum: '$totalPoints' },
              dailyTransactions: { $sum: '$count' }
            }
          },
          { $sort: { _id: 1 } }
        ]),

        // Statistiques des utilisateurs
        User.aggregate([
          { $match: { 'loyalty.enrolledAt': { $exists: true } } },
          {
            $group: {
              _id: null,
              totalMembers: { $sum: 1 },
              activeMembers: {
                $sum: {
                  $cond: [
                    { $gte: ['$loyalty.statistics.lastActivity', startDate] },
                    1,
                    0
                  ]
                }
              },
              totalPoints: { $sum: '$loyalty.currentPoints' },
              totalLifetimePoints: { $sum: '$loyalty.lifetimePoints' }
            }
          }
        ]),

        // Distribution des niveaux
        User.aggregate([
          { $match: { 'loyalty.enrolledAt': { $exists: true } } },
          {
            $group: {
              _id: '$loyalty.tier',
              count: { $sum: 1 },
              avgPoints: { $avg: '$loyalty.currentPoints' },
              avgLifetimePoints: { $avg: '$loyalty.lifetimePoints' }
            }
          },
          { $sort: { '_id': 1 } }
        ])
      ]);

      return {
        period: { startDate, endDate, days },
        transactions: {
          daily: transactionStats,
          summary: this.summarizeTransactionStats(transactionStats)
        },
        users: userStats[0] || {
          totalMembers: 0,
          activeMembers: 0,
          totalPoints: 0,
          totalLifetimePoints: 0
        },
        tiers: tierDistribution,
        insights: this.generateLoyaltyInsights(transactionStats, userStats[0], tierDistribution)
      };
    } catch (error) {
      logger.error('Erreur analytics loyalty:', error);
      throw error;
    }
  }

  // ============================================================================
  // FONCTIONS UTILITAIRES
  // ============================================================================

  /**
   * Obtenir multiplicateur saisonnier
   */
  getSeasonalMultiplier() {
    const month = new Date().getMonth() + 1;
    
    if (month >= 6 && month <= 8) return this.config.campaigns.seasonalMultipliers.SUMMER;
    if (month >= 12 || month <= 2) return this.config.campaigns.seasonalMultipliers.WINTER;
    if (month >= 3 && month <= 5) return this.config.campaigns.seasonalMultipliers.SPRING;
    return this.config.campaigns.seasonalMultipliers.AUTUMN;
  }

  /**
   * Calculer bonus réservations multiples
   */
  async calculateMultipleBookingsBonus(userId) {
    try {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const bookingsThisMonth = await Booking.countDocuments({
        customer: userId,
        createdAt: { $gte: startOfMonth },
        status: { $in: ['CONFIRMED', 'CHECKED_IN', 'COMPLETED'] }
      });

      if (bookingsThisMonth >= 3) {
        return 1 + this.config.earningRules.multipleBookingsBonus;
      }

      return 1.0;
    } catch (error) {
      return 1.0;
    }
  }

  /**
   * Obtenir options d'utilisation selon solde et niveau
   */
  getRedemptionOptions(currentPoints, tier) {
    const options = [];
    const rules = this.config.redemptionRules;
    const benefits = this.config.tierBenefits[tier];

    // Réductions
    if (currentPoints >= rules.minimumRedemption) {
      const maxDiscount = Math.floor(currentPoints / rules.discountRate);
      options.push({
        type: 'DISCOUNT',
        pointsRequired: rules.minimumRedemption,
        maxPoints: Math.min(currentPoints, rules.maximumRedemptionPerBooking),
        value: `Jusqu'à ${maxDiscount}€ de réduction`,
        description: `${rules.discountRate} points = 1€`,
        available: true
      });
    }

    // Upgrade chambre
    if (currentPoints >= rules.upgradeRoomCost) {
      options.push({
        type: 'UPGRADE',
        pointsRequired: rules.upgradeRoomCost,
        value: 'Upgrade chambre',
        description: 'Surclassement vers catégorie supérieure',
        available: true
      });
    }

    // Petit-déjeuner
    if (currentPoints >= rules.breakfastCost) {
      options.push({
        type: 'BREAKFAST',
        pointsRequired: rules.breakfastCost,
        value: 'Petit-déjeuner gratuit',
        description: 'Petit-déjeuner continental',
        available: true
      });
    }

    // Check-out tardif
    if (currentPoints >= rules.lateCheckoutCost) {
      options.push({
        type: 'LATE_CHECKOUT',
        pointsRequired: rules.lateCheckoutCost,
        value: 'Check-out tardif',
        description: 'Prolongation jusqu\'à 14h',
        available: true
      });
    }

    // Nuit gratuite (membres Gold+)
    if (currentPoints >= rules.freeNightCost && ['GOLD', 'PLATINUM', 'DIAMOND'].includes(tier)) {
      options.push({
        type: 'FREE_NIGHT',
        pointsRequired: rules.freeNightCost,
        value: 'Nuit gratuite',
        description: 'Une nuit offerte dans nos hôtels',
        available: true,
        exclusive: true
      });
    }

    // Accès lounge (membres Platinum+)
    if (currentPoints >= rules.loungeAccessCost && ['PLATINUM', 'DIAMOND'].includes(tier)) {
      options.push({
        type: 'LOUNGE_ACCESS',
        pointsRequired: rules.loungeAccessCost,
        value: 'Accès lounge VIP',
        description: 'Accès salon VIP pour la journée',
        available: true,
        exclusive: true
      });
    }

    return options.sort((a, b) => a.pointsRequired - b.pointsRequired);
  }

  /**
   * Obtenir bénéfices du niveau suivant
   */
  getNextTierBenefits(currentTier) {
    const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
    const currentIndex = tiers.indexOf(currentTier);
    
    if (currentIndex < tiers.length - 1) {
      const nextTier = tiers[currentIndex + 1];
      return {
        tier: nextTier,
        tierDisplay: this.getTierDisplayName(nextTier),
        threshold: this.config.tierThresholds[nextTier],
        benefits: this.config.tierBenefits[nextTier]
      };
    }
    
    return null; // Niveau maximum atteint
  }

  /**
   * Obtenir points qui expirent bientôt
   */
  async getExpiringPoints(userId, daysWarning = 90) {
    try {
      const warningDate = new Date();
      warningDate.setDate(warningDate.getDate() + daysWarning);

      const expiringTransactions = await LoyaltyTransaction.find({
        user: userId,
        pointsAmount: { $gt: 0 },
        status: 'COMPLETED',
        expiresAt: { $lte: warningDate, $gt: new Date() }
      })
      .sort({ expiresAt: 1 })
      .select('pointsAmount expiresAt description');

      const totalExpiring = expiringTransactions.reduce((sum, t) => sum + t.pointsAmount, 0);

      return {
        transactions: expiringTransactions,
        totalPoints: totalExpiring,
        nextExpiryDate: expiringTransactions.length > 0 ? expiringTransactions[0].expiresAt : null,
        warningDays: daysWarning
      };
    } catch (error) {
      logger.error('Erreur points expirants:', error);
      return { transactions: [], totalPoints: 0, nextExpiryDate: null };
    }
  }

  /**
   * Grouper transactions par mois
   */
  groupTransactionsByMonth(transactions) {
    const grouped = {};
    
    transactions.forEach(transaction => {
      const monthKey = transaction.createdAt.toISOString().slice(0, 7); // YYYY-MM
      
      if (!grouped[monthKey]) {
        grouped[monthKey] = {
          month: monthKey,
          transactions: [],
          totalEarned: 0,
          totalRedeemed: 0,
          netChange: 0
        };
      }
      
      grouped[monthKey].transactions.push(transaction);
      
      if (transaction.pointsAmount > 0) {
        grouped[monthKey].totalEarned += transaction.pointsAmount;
      } else {
        grouped[monthKey].totalRedeemed += Math.abs(transaction.pointsAmount);
      }
      
      grouped[monthKey].netChange += transaction.pointsAmount;
    });
    
    return Object.values(grouped).sort((a, b) => b.month.localeCompare(a.month));
  }

  /**
   * Générer code voucher unique
   */
  generateVoucherCode() {
    const prefix = 'LOYAL';
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 4);
    return `${prefix}${timestamp}${random}`.toUpperCase();
  }

  /**
   * Obtenir nom d'affichage du niveau
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
   * Obtenir icône du niveau
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
   * Obtenir rareté du niveau
   */
  getTierRarity(tier) {
    const rarities = {
      'BRONZE': 'common',
      'SILVER': 'uncommon',
      'GOLD': 'rare',
      'PLATINUM': 'epic',
      'DIAMOND': 'legendary'
    };
    return rarities[tier] || 'common';
  }

  /**
   * Obtenir template email selon type bonus
   */
  getBonusEmailTemplate(type) {
    const templates = {
      'EARN_BIRTHDAY': 'birthday-bonus',
      'EARN_REFERRAL': 'referral-bonus',
      'EARN_REVIEW': 'review-bonus',
      'EARN_ANNIVERSARY': 'anniversary-bonus'
    };
    return templates[type] || 'bonus-points';
  }

  /**
   * Mettre à jour statistiques quotidiennes
   */
  updateDailyStats(type, points) {
    if (type === 'earned') {
      this.stats.dailyPointsIssued += points;
    } else if (type === 'redeemed') {
      this.stats.dailyPointsRedeemed += points;
    }
    this.stats.dailyTransactions += 1;
    
    // NOUVEAU : Notifier dashboard admin en temps réel
    socketService.updateLoyaltyAdminDashboard('daily_stats_update', {
      type,
      points,
      newTotals: {
        dailyTransactions: this.stats.dailyTransactions,
        dailyPointsIssued: this.stats.dailyPointsIssued,
        dailyPointsRedeemed: this.stats.dailyPointsRedeemed
      }
    });
  }

  /**
   * Gestion du cache
   */
  getFromCache(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    this.cache.delete(key);
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Nettoyer cache si trop d'entrées
    if (this.cache.size > 1000) {
      const oldestKeys = Array.from(this.cache.keys()).slice(0, 200);
      oldestKeys.forEach(key => this.cache.delete(key));
    }
  }

  /**
   * Calculer résumé période
   */
  async calculatePeriodSummary(userId, startDate, endDate) {
    try {
      const query = { user: userId };
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = new Date(startDate);
        if (endDate) query.createdAt.$lte = new Date(endDate);
      }

      const summary = await LoyaltyTransaction.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            totalEarned: { $sum: { $cond: [{ $gt: ['$pointsAmount', 0] }, '$pointsAmount', 0] } },
            totalRedeemed: { $sum: { $cond: [{ $lt: ['$pointsAmount', 0] }, { $abs: '$pointsAmount' }, 0] } },
            transactionCount: { $sum: 1 },
            avgTransaction: { $avg: '$pointsAmount' }
          }
        }
      ]);

      return summary[0] || {
        totalEarned: 0,
        totalRedeemed: 0,
        transactionCount: 0,
        avgTransaction: 0
      };
    } catch (error) {
      return { totalEarned: 0, totalRedeemed: 0, transactionCount: 0, avgTransaction: 0 };
    }
  }

  /**
   * Résumer statistiques transactions
   */
  summarizeTransactionStats(transactionStats) {
    const summary = {
      totalDays: transactionStats.length,
      totalTransactions: 0,
      totalPoints: 0,
      avgTransactionsPerDay: 0,
      avgPointsPerDay: 0,
      peakDay: null,
      trends: {}
    };

    if (transactionStats.length === 0) return summary;

    let maxTransactions = 0;
    let maxPoints = 0;

    transactionStats.forEach(day => {
      summary.totalTransactions += day.dailyTransactions;
      summary.totalPoints += day.dailyTotal;

      if (day.dailyTransactions > maxTransactions) {
        maxTransactions = day.dailyTransactions;
        summary.peakDay = {
          date: day._id,
          transactions: day.dailyTransactions,
          points: day.dailyTotal
        };
      }
    });

    summary.avgTransactionsPerDay = Math.round(summary.totalTransactions / summary.totalDays);
    summary.avgPointsPerDay = Math.round(summary.totalPoints / summary.totalDays);

    return summary;
  }

  /**
   * Générer insights loyalty
   */
  generateLoyaltyInsights(transactionStats, userStats, tierDistribution) {
    const insights = [];

    // Insight activation
    if (userStats) {
      const activationRate = userStats.totalMembers > 0 ? (userStats.activeMembers / userStats.totalMembers) * 100 : 0;
      
      if (activationRate > 80) {
        insights.push({
          type: 'success',
          title: 'Excellent engagement',
          message: `${activationRate.toFixed(1)}% des membres sont actifs`,
          priority: 'high'
        });
      } else if (activationRate < 50) {
        insights.push({
          type: 'warning',
          title: 'Engagement faible',
          message: `Seulement ${activationRate.toFixed(1)}% des membres sont actifs`,
          recommendation: 'Considérer campagne de réactivation',
          priority: 'high'
        });
      }
    }

    // Insight distribution niveaux
    const diamondMembers = tierDistribution.find(t => t._id === 'DIAMOND');
    if (diamondMembers && diamondMembers.count > 0) {
      const totalMembers = tierDistribution.reduce((sum, tier) => sum + tier.count, 0);
      const diamondPercentage = (diamondMembers.count / totalMembers) * 100;
      
      insights.push({
        type: 'info',
        title: 'Membres VIP',
        message: `${diamondPercentage.toFixed(1)}% des membres ont atteint le niveau Diamant`,
        priority: 'medium'
      });
    }

    return insights;
  }
}

// ============================================================================
// FONCTIONS GLOBALES ET UTILITAIRES
// ============================================================================

/**
 * Job de nettoyage des points expirés (à exécuter quotidiennement)
 */
const expirePointsJob = async () => {
  try {
    const expiredTransactions = await LoyaltyTransaction.find({
      pointsAmount: { $gt: 0 },
      status: 'COMPLETED',
      expiresAt: { $lte: new Date() }
    }).populate('user', 'firstName lastName email');

    for (const transaction of expiredTransactions) {
      const session = await mongoose.startSession();
      
      try {
        await session.withTransaction(async () => {
          // Marquer transaction comme expirée
          transaction.status = 'EXPIRED';
          await transaction.save({ session });

          // Déduire points du solde utilisateur
          const user = await User.findById(transaction.user._id).session(session);
          if (user && user.loyalty.currentPoints >= transaction.pointsAmount) {
            user.loyalty.currentPoints -= transaction.pointsAmount;
            await user.save({ session });

            // Créer transaction d'expiration
            const expireTransaction = new LoyaltyTransaction({
              user: user._id,
              type: 'EXPIRE',
              pointsAmount: -transaction.pointsAmount,
              previousBalance: user.loyalty.currentPoints + transaction.pointsAmount,
              newBalance: user.loyalty.currentPoints,
              description: `Expiration points - ${transaction.description}`,
              parentTransaction: transaction._id,
              source: 'SYSTEM'
            });

            await expireTransaction.save({ session });

            // Notification standard (conservée)
            socketService.sendUserNotification(user._id, 'POINTS_EXPIRED', {
              pointsExpired: transaction.pointsAmount,
              description: transaction.description,
              remainingPoints: user.loyalty.currentPoints,
              message: `${transaction.pointsAmount} points ont expiré`
            });

            // NOUVEAU : Notification expiration spécialisée
            socketService.notifyPointsExpiry(user._id, {
              pointsExpiring: transaction.pointsAmount,
              daysUntilExpiry: 0, // Déjà expiré
              urgency: 'expired',
              remainingPoints: user.loyalty.currentPoints
            });

            logger.info(`Points expirés: ${transaction.pointsAmount} pour user ${user._id}`);
          }
        });
      } catch (error) {
        logger.error(`Erreur expiration points transaction ${transaction._id}:`, error);
      } finally {
        await session.endSession();
      }
    }

    logger.info(`Job expiration points terminé: ${expiredTransactions.length} transactions traitées`);
  } catch (error) {
    logger.error('Erreur job expiration points:', error);
  }
};

/**
 * Job d'alerte points proche expiration (à exécuter hebdomadairement)
 */
const pointsExpiryWarningJob = async () => {
  try {
    const loyaltyService = new LoyaltyService();
    const warningDate = new Date();
    warningDate.setDate(warningDate.getDate() + loyaltyService.config.pointsExpiry.warningMonths * 30);

    const soonExpiringTransactions = await LoyaltyTransaction.find({
      pointsAmount: { $gt: 0 },
      status: 'COMPLETED',
      expiresAt: { $lte: warningDate, $gt: new Date() }
    })
    .populate('user', 'firstName lastName email loyalty')
    .lean();

    // Grouper par utilisateur
    const userExpiringPoints = {};
    soonExpiringTransactions.forEach(transaction => {
      const userId = transaction.user._id.toString();
      if (!userExpiringPoints[userId]) {
        userExpiringPoints[userId] = {
          user: transaction.user,
          transactions: [],
          totalExpiring: 0
        };
      }
      userExpiringPoints[userId].transactions.push(transaction);
      userExpiringPoints[userId].totalExpiring += transaction.pointsAmount;
    });

    // Envoyer alertes
    for (const [userId, data] of Object.entries(userExpiringPoints)) {
      if (data.totalExpiring >= 100) { // Seuil minimum pour alerte
        // Email d'alerte
        await emailService.sendEmail({
          to: data.user.email,
          template: 'points-expiry-warning',
          data: {
            user: data.user,
            pointsExpiring: data.totalExpiring,
            earliestExpiry: data.transactions[0].expiresAt,
            redemptionOptions: loyaltyService.getRedemptionOptions(
              data.user.loyalty.currentPoints, 
              data.user.loyalty.tier
            )
          }
        });

        // Notification standard (conservée)
        socketService.sendUserNotification(userId, 'POINTS_EXPIRY_WARNING', {
          pointsExpiring: data.totalExpiring,
          daysUntilExpiry: Math.ceil((data.transactions[0].expiresAt - new Date()) / (24 * 60 * 60 * 1000)),
          message: `${data.totalExpiring} points expirent bientôt`,
          action: 'Utilisez vos points avant expiration'
        });

        // NOUVEAU : Notification expiration spécialisée avec détails
        const daysUntil = Math.ceil((data.transactions[0].expiresAt - new Date()) / (24 * 60 * 60 * 1000));
        const urgency = daysUntil <= 7 ? 'critical' : daysUntil <= 30 ? 'high' : 'medium';

        socketService.notifyPointsExpiry(userId, {
          pointsExpiring: data.totalExpiring,
          daysUntilExpiry: daysUntil,
          urgency,
          redemptionSuggestions: ['discount', 'upgrade']
        });
      }
    }

    logger.info(`Alertes expiration envoyées à ${Object.keys(userExpiringPoints).length} utilisateurs`);
  } catch (error) {
    logger.error('Erreur job alerte expiration:', error);
  }
};

/**
 * Job anniversaires membres (à exécuter quotidiennement)
 */
const birthdayBonusJob = async () => {
  try {
    const loyaltyService = new LoyaltyService();
    const today = new Date();
    const todayMonth = today.getMonth() + 1;
    const todayDay = today.getDate();

    // Trouver membres avec anniversaire aujourd'hui
    const birthdayMembers = await User.find({
      'loyalty.enrolledAt': { $exists: true },
      isActive: true,
      $expr: {
        $and: [
          { $eq: [{ $month: '$createdAt' }, todayMonth] },
          { $eq: [{ $dayOfMonth: '$createdAt' }, todayDay] }
        ]
      }
    });

    for (const member of birthdayMembers) {
      try {
        const bonusAmount = loyaltyService.config.tierBenefits[member.loyalty.tier].birthdayBonus;
        
        await loyaltyService.awardBonusPoints(
          member._id,
          'EARN_BIRTHDAY',
          bonusAmount,
          `Bonus anniversaire ${new Date().getFullYear()}`,
          { birthdayYear: new Date().getFullYear() }
        );

        logger.info(`Bonus anniversaire attribué: ${bonusAmount} points à ${member.email}`);
      } catch (error) {
        logger.error(`Erreur bonus anniversaire pour ${member._id}:`, error);
      }
    }

    logger.info(`Job anniversaires terminé: ${birthdayMembers.length} bonus attribués`);
  } catch (error) {
    logger.error('Erreur job anniversaires:', error);
  }
};

/**
 * Job nettoyage performances et cache
 */
const cleanupJob = async () => {
  try {
    // Nettoyer anciennes transactions (garde 2 ans)
    const twoYearsAgo = new Date();
    twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

    const deletedCount = await LoyaltyTransaction.deleteMany({
      createdAt: { $lt: twoYearsAgo },
      status: { $in: ['CANCELLED', 'EXPIRED'] }
    });

    logger.info(`Cleanup: ${deletedCount.deletedCount} anciennes transactions supprimées`);
  } catch (error) {
    logger.error('Erreur job cleanup:', error);
  }
};

// ============================================================================
// SINGLETON ET EXPORT
// ============================================================================

// Instance singleton du service
let loyaltyServiceInstance = null;

/**
 * Obtenir instance singleton du service loyalty
 */
const getLoyaltyService = () => {
  if (!loyaltyServiceInstance) {
    loyaltyServiceInstance = new LoyaltyService();
  }
  return loyaltyServiceInstance;
};

/**
 * Initialiser le service loyalty (jobs, cache, etc.)
 */
const initializeLoyaltyService = async () => {
  try {
    const service = getLoyaltyService();
    
    // Programmer les jobs périodiques
    if (process.env.NODE_ENV === 'production') {
      // Job expiration quotidien à 2h du matin
      setInterval(expirePointsJob, 24 * 60 * 60 * 1000);
      
      // Job alerte hebdomadaire le dimanche
      setInterval(pointsExpiryWarningJob, 7 * 24 * 60 * 60 * 1000);
      
      // Job anniversaires quotidien à 9h
      setInterval(birthdayBonusJob, 24 * 60 * 60 * 1000);
      
      // Job cleanup mensuel
      setInterval(cleanupJob, 30 * 24 * 60 * 60 * 1000);
    }

    logger.info('LoyaltyService initialized with scheduled jobs');
    return service;
  } catch (error) {
    logger.error('Erreur initialisation LoyaltyService:', error);
    throw error;
  }
};

// ============================================================================
// FONCTIONS D'INTÉGRATION RAPIDE
// ============================================================================

/**
 * Attribution rapide de points (utilisée dans bookingController)
 */
const quickAwardPoints = async (userId, bookingId, options = {}) => {
  const service = getLoyaltyService();
  return await service.awardBookingPoints(bookingId, userId, options);
};

/**
 * Utilisation rapide de points (utilisée dans bookingController)
 */
const quickRedeemPoints = async (userId, pointsToRedeem, bookingId, options = {}) => {
  const service = getLoyaltyService();
  return await service.redeemPointsForDiscount(userId, pointsToRedeem, bookingId, options);
};

/**
 * Statut rapide loyalty (utilisé dans dashboard)
 */
const quickGetStatus = async (userId, skipCache = false) => {
  const service = getLoyaltyService();
  return await service.getLoyaltyStatus(userId, { skipCache });
};

/**
 * Vérification éligibilité réduction
 */
const checkDiscountEligibility = async (userId, requestedDiscount) => {
  try {
    const user = await User.findById(userId).select('loyalty').lean();
    if (!user?.loyalty) return { eligible: false, reason: 'Non membre programme fidélité' };

    const service = getLoyaltyService();
    const pointsNeeded = requestedDiscount * service.config.redemptionRules.discountRate;
    
    if (user.loyalty.currentPoints < pointsNeeded) {
      return {
        eligible: false,
        reason: 'Points insuffisants',
        currentPoints: user.loyalty.currentPoints,
        pointsNeeded,
        shortfall: pointsNeeded - user.loyalty.currentPoints
      };
    }

    return {
      eligible: true,
      pointsNeeded,
      currentPoints: user.loyalty.currentPoints,
      remainingAfter: user.loyalty.currentPoints - pointsNeeded
    };
  } catch (error) {
    logger.error('Erreur vérification éligibilité:', error);
    return { eligible: false, reason: 'Erreur système' };
  }
};

/**
 * NOUVEAU : Diffuser campagne loyalty
 */
const broadcastCampaign = async (campaignData) => {
  const service = getLoyaltyService();
  return await service.broadcastLoyaltyCampaign(campaignData);
};

/**
 * NOUVEAU : Envoyer promotion personnalisée
 */
const sendPersonalizedPromotion = async (userId, promotionData) => {
  const service = getLoyaltyService();
  return await service.sendPersonalizedLoyaltyPromotion(userId, promotionData);
};

/**
 * NOUVEAU : Surveiller santé système
 */
const monitorSystemHealth = async () => {
  const service = getLoyaltyService();
  return await service.monitorLoyaltySystemHealth();
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Classe principale
  LoyaltyService,
  
  // Instance singleton
  getLoyaltyService,
  initializeLoyaltyService,
  
  // Fonctions d'intégration rapide
  quickAwardPoints,
  quickRedeemPoints,
  quickGetStatus,
  checkDiscountEligibility,
  
  // NOUVEAU : Fonctions campagnes et promotions
  broadcastCampaign,
  sendPersonalizedPromotion,
  monitorSystemHealth,
  
  // Jobs (pour configuration manuelle si besoin)
  expirePointsJob,
  pointsExpiryWarningJob,
  birthdayBonusJob,
  cleanupJob,
  
  // Constantes de configuration (pour référence externe)
  TIER_THRESHOLDS: {
    BRONZE: 0,
    SILVER: 1000,
    GOLD: 5000,
    PLATINUM: 15000,
    DIAMOND: 50000
  },
  
  REDEMPTION_RATES: {
    DISCOUNT: 100, // 100 points = 1€
    UPGRADE: 1000,
    FREE_NIGHT: 5000
  }
};