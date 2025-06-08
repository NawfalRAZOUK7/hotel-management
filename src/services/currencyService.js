const axios = require('axios');
const { logger } = require('../utils/logger');

class CurrencyService {
    constructor() {
        this.apiKey = process.env.CURRENCY_API_KEY;
        this.baseUrl = process.env.CURRENCY_API_URL;
        this.cache = new Map();
        this.cacheExpiry = 6 * 60 * 60 * 1000; // 6 hours cache
        this.supportedCurrencies = ['EUR', 'USD', 'MAD', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'];
        this.baseCurrency = 'EUR'; // Hotel system base currency
    }

    /**
     * Get current exchange rates from cache or API
     */
    async getExchangeRates(baseCurrency = 'EUR') {
        const cacheKey = `rates_${baseCurrency}`;
        const cached = this.cache.get(cacheKey);

        // Return cached data if still valid
        if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
            return cached.data;
        }

        try {
            const url = `${this.baseUrl}/${this.apiKey}/latest/${baseCurrency}`;
            const response = await axios.get(url, { timeout: 5000 });

            if (response.data.result === 'success') {
                const ratesData = {
                    base: response.data.base_code,
                    date: response.data.time_last_update_utc,
                    rates: response.data.conversion_rates,
                    timestamp: Date.now()
                };

                // Cache the results
                this.cache.set(cacheKey, {
                    data: ratesData,
                    timestamp: Date.now()
                });

                logger.info(`Exchange rates updated for ${baseCurrency}`);
                return ratesData;
            } else {
                throw new Error(`API Error: ${response.data['error-type']}`);
            }
        } catch (error) {
            logger.error('Failed to fetch exchange rates:', error.message);
            
            // Return cached data even if expired, better than nothing
            if (cached) {
                logger.warn('Using expired exchange rate cache');
                return cached.data;
            }
            
            throw error;
        }
    }

    /**
     * Convert amount from one currency to another
     */
    async convertCurrency(amount, fromCurrency, toCurrency) {
        if (fromCurrency === toCurrency) {
            return {
                originalAmount: amount,
                convertedAmount: amount,
                fromCurrency,
                toCurrency,
                rate: 1,
                date: new Date().toISOString()
            };
        }

        try {
            const rates = await this.getExchangeRates(fromCurrency);
            const rate = rates.rates[toCurrency];

            if (!rate) {
                throw new Error(`Exchange rate not available for ${fromCurrency} to ${toCurrency}`);
            }

            const convertedAmount = Math.round((amount * rate) * 100) / 100; // Round to 2 decimals

            return {
                originalAmount: amount,
                convertedAmount,
                fromCurrency,
                toCurrency,
                rate,
                date: rates.date
            };
        } catch (error) {
            logger.error(`Currency conversion failed (${fromCurrency} to ${toCurrency}):`, error.message);
            throw error;
        }
    }

    /**
     * Get price in multiple currencies for display
     */
    async getMultiCurrencyPrices(baseAmount, baseCurrency = 'EUR') {
        try {
            const rates = await this.getExchangeRates(baseCurrency);
            const prices = {};

            for (const currency of this.supportedCurrencies) {
                if (currency === baseCurrency) {
                    prices[currency] = {
                        amount: baseAmount,
                        formatted: this.formatCurrency(baseAmount, currency),
                        rate: 1
                    };
                } else if (rates.rates[currency]) {
                    const convertedAmount = Math.round((baseAmount * rates.rates[currency]) * 100) / 100;
                    prices[currency] = {
                        amount: convertedAmount,
                        formatted: this.formatCurrency(convertedAmount, currency),
                        rate: rates.rates[currency]
                    };
                }
            }

            return {
                base: {
                    amount: baseAmount,
                    currency: baseCurrency
                },
                prices,
                lastUpdated: rates.date
            };
        } catch (error) {
            logger.error('Failed to get multi-currency prices:', error.message);
            throw error;
        }
    }

    /**
     * Format currency amount with proper symbols and locale
     */
    formatCurrency(amount, currency, locale = 'fr-FR') {
        try {
            return new Intl.NumberFormat(locale, {
                style: 'currency',
                currency: currency,
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            }).format(amount);
        } catch (error) {
            // Fallback formatting
            const symbols = {
                'EUR': '€',
                'USD': '$',
                'MAD': 'DH',
                'GBP': '£',
                'CAD': 'C$',
                'AUD': 'A$',
                'JPY': '¥',
                'CHF': 'CHF'
            };
            
            const symbol = symbols[currency] || currency;
            return `${amount.toFixed(2)} ${symbol}`;
        }
    }

    /**
     * Get user's preferred currency based on location/profile
     */
    getUserPreferredCurrency(user, clientCountry = null) {
        // Priority: User profile > Client location > Default
        if (user.preferredCurrency && this.supportedCurrencies.includes(user.preferredCurrency)) {
            return user.preferredCurrency;
        }

        // Detect currency by country
        const countryToCurrency = {
            'MA': 'MAD', // Morocco
            'US': 'USD', // United States
            'GB': 'GBP', // United Kingdom
            'CA': 'CAD', // Canada
            'AU': 'AUD', // Australia
            'JP': 'JPY', // Japan
            'CH': 'CHF', // Switzerland
            'FR': 'EUR', // France
            'DE': 'EUR', // Germany
            'ES': 'EUR', // Spain
            'IT': 'EUR', // Italy
        };

        if (clientCountry && countryToCurrency[clientCountry]) {
            return countryToCurrency[clientCountry];
        }

        // Default to EUR (hotel system base currency)
        return 'EUR';
    }

    /**
     * Convert booking prices to user's preferred currency
     */
    async convertBookingPrices(booking, targetCurrency) {
        if (booking.currency === targetCurrency) {
            return booking;
        }

        try {
            const totalConversion = await this.convertCurrency(
                booking.totalAmount, 
                booking.currency, 
                targetCurrency
            );

            const convertedBooking = {
                ...booking,
                originalCurrency: booking.currency,
                originalAmount: booking.totalAmount,
                currency: targetCurrency,
                totalAmount: totalConversion.convertedAmount,
                conversionRate: totalConversion.rate,
                conversionDate: totalConversion.date,
                rooms: await Promise.all(booking.rooms.map(async (room) => {
                    const roomConversion = await this.convertCurrency(
                        room.pricePerNight,
                        booking.currency,
                        targetCurrency
                    );
                    return {
                        ...room,
                        pricePerNight: roomConversion.convertedAmount,
                        originalPricePerNight: room.pricePerNight
                    };
                }))
            };

            return convertedBooking;
        } catch (error) {
            logger.error('Failed to convert booking prices:', error.message);
            return booking; // Return original if conversion fails
        }
    }

    /**
     * Get historical exchange rates (for analytics)
     */
    async getHistoricalRates(baseCurrency, targetCurrency, date) {
        try {
            // Note: Free tier of ExchangeRate-API doesn't support historical data
            // This would require a paid plan or different API
            logger.warn('Historical rates require paid API plan');
            return null;
        } catch (error) {
            logger.error('Failed to get historical rates:', error.message);
            return null;
        }
    }

    /**
     * Get currency conversion for hotel revenue analytics
     */
    async convertRevenueData(revenueData, targetCurrency = 'EUR') {
        try {
            const conversions = await Promise.all(
                revenueData.map(async (item) => {
                    if (item.currency === targetCurrency) {
                        return item;
                    }

                    const conversion = await this.convertCurrency(
                        item.amount,
                        item.currency,
                        targetCurrency
                    );

                    return {
                        ...item,
                        originalAmount: item.amount,
                        originalCurrency: item.currency,
                        amount: conversion.convertedAmount,
                        currency: targetCurrency,
                        conversionRate: conversion.rate
                    };
                })
            );

            return conversions;
        } catch (error) {
            logger.error('Failed to convert revenue data:', error.message);
            return revenueData;
        }
    }

    /**
     * Get real-time rate alerts (for revenue management)
     */
    async checkRateAlerts(targetRates) {
        try {
            const currentRates = await this.getExchangeRates();
            const alerts = [];

            for (const target of targetRates) {
                const currentRate = currentRates.rates[target.currency];
                if (currentRate && 
                    ((target.type === 'above' && currentRate >= target.threshold) ||
                     (target.type === 'below' && currentRate <= target.threshold))) {
                    alerts.push({
                        currency: target.currency,
                        currentRate,
                        threshold: target.threshold,
                        type: target.type,
                        triggered: true
                    });
                }
            }

            return alerts;
        } catch (error) {
            logger.error('Failed to check rate alerts:', error.message);
            return [];
        }
    }

    /**
     * Get service status and supported currencies
     */
    getServiceStatus() {
        return {
            apiKey: this.apiKey ? `${this.apiKey.substring(0, 8)}...` : 'Not configured',
            baseCurrency: this.baseCurrency,
            supportedCurrencies: this.supportedCurrencies,
            cacheEntries: this.cache.size,
            lastUpdate: Array.from(this.cache.values())[0]?.timestamp || null
        };
    }

    /**
     * Clear exchange rate cache
     */
    clearCache() {
        this.cache.clear();
        logger.info('Currency exchange cache cleared');
    }
}

module.exports = new CurrencyService();