const mongoose = require('mongoose');

/**
 * PricingRule Schema for Yield Management System
 * Supports dynamic pricing, seasonal adjustments, demand-based pricing
 */
const pricingRuleSchema = new mongoose.Schema({
    // Basic Rule Information
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        maxlength: 500
    },
    ruleType: {
        type: String,
        required: true,
        enum: [
            'SEASONAL',           // Seasonal pricing (summer, winter, etc.)
            'DEMAND_BASED',       // Based on occupancy/demand
            'LEAD_TIME',          // Based on booking advance time
            'DAY_OF_WEEK',        // Weekend/weekday pricing
            'EVENT_BASED',        // Local events, holidays
            'COMPETITOR',         // Competitor-based pricing
            'OCCUPANCY',          // Current occupancy-based
            'DURATION',           // Length of stay pricing
            'CUSTOMER_SEGMENT',   // Loyalty, corporate, etc.
            'PROMOTIONAL'         // Special promotions
        ],
        index: true
    },
    
    // Rule Scope
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        index: true
    },
    roomTypes: [{
        type: String,
        enum: ['SIMPLE', 'DOUBLE', 'DOUBLE_CONFORT', 'SUITE']
    }], // Empty array means applies to all room types
    
    // Rule Priority & Status
    priority: {
        type: Number,
        default: 1,
        min: 1,
        max: 10 // Higher number = higher priority
    },
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Validity Period
    validFrom: {
        type: Date,
        required: true
    },
    validUntil: {
        type: Date,
        required: true
    },
    
    // Pricing Adjustment Configuration
    adjustmentType: {
        type: String,
        required: true,
        enum: ['PERCENTAGE', 'FIXED_AMOUNT', 'ABSOLUTE_PRICE', 'MULTIPLIER']
    },
    adjustmentValue: {
        type: Number,
        required: true
    },
    
    // Minimum and Maximum Price Constraints
    minPrice: {
        type: Number,
        min: 0
    },
    maxPrice: {
        type: Number,
        min: 0
    },
    
    // Seasonal Pricing Configuration
    seasonalConfig: {
        seasons: [{
            name: {
                type: String,
                required: true // e.g., 'High Season', 'Low Season'
            },
            startDate: {
                type: Date,
                required: true
            },
            endDate: {
                type: Date,
                required: true
            },
            adjustmentMultiplier: {
                type: Number,
                required: true,
                min: 0.1,
                max: 5.0
            },
            isRecurring: {
                type: Boolean,
                default: true // Repeats every year
            }
        }],
        holidayPremium: {
            type: Number,
            default: 1.0,
            min: 1.0,
            max: 3.0
        },
        weekendMultiplier: {
            type: Number,
            default: 1.0,
            min: 0.5,
            max: 2.0
        }
    },
    
    // Demand-Based Pricing Configuration
    demandConfig: {
        thresholds: [{
            occupancyMin: {
                type: Number,
                required: true,
                min: 0,
                max: 100
            },
            occupancyMax: {
                type: Number,
                required: true,
                min: 0,
                max: 100
            },
            priceMultiplier: {
                type: Number,
                required: true,
                min: 0.1,
                max: 5.0
            }
        }],
        demandWindow: {
            type: Number,
            default: 30, // Days to look ahead for demand
            min: 1,
            max: 365
        },
        updateFrequency: {
            type: String,
            enum: ['HOURLY', 'DAILY', 'WEEKLY'],
            default: 'DAILY'
        }
    },
    
    // Lead Time Pricing Configuration
    leadTimeConfig: {
        intervals: [{
            daysInAdvance: {
                type: Number,
                required: true,
                min: 0
            },
            priceMultiplier: {
                type: Number,
                required: true,
                min: 0.1,
                max: 3.0
            }
        }],
        lastMinuteThreshold: {
            type: Number,
            default: 7, // Days considered "last minute"
            min: 1,
            max: 30
        },
        earlyBirdThreshold: {
            type: Number,
            default: 60, // Days considered "early bird"
            min: 30,
            max: 365
        }
    },
    
    // Day of Week Configuration
    dayOfWeekConfig: {
        weekdayMultiplier: {
            type: Number,
            default: 1.0,
            min: 0.1,
            max: 3.0
        },
        weekendMultiplier: {
            type: Number,
            default: 1.2,
            min: 0.1,
            max: 3.0
        },
        customDays: [{
            day: {
                type: String,
                enum: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']
            },
            multiplier: {
                type: Number,
                min: 0.1,
                max: 3.0
            }
        }]
    },
    
    // Event-Based Pricing Configuration
    eventConfig: {
        events: [{
            eventName: {
                type: String,
                required: true
            },
            startDate: {
                type: Date,
                required: true
            },
            endDate: {
                type: Date,
                required: true
            },
            impactRadius: {
                type: Number,
                default: 50, // km radius
                min: 1,
                max: 500
            },
            priceMultiplier: {
                type: Number,
                required: true,
                min: 1.0,
                max: 5.0
            },
            autoDetect: {
                type: Boolean,
                default: false
            }
        }],
        nationalHolidays: {
            enabled: {
                type: Boolean,
                default: true
            },
            multiplier: {
                type: Number,
                default: 1.3,
                min: 1.0,
                max: 3.0
            }
        }
    },
    
    // Length of Stay Configuration
    lengthOfStayConfig: {
        tiers: [{
            minNights: {
                type: Number,
                required: true,
                min: 1
            },
            maxNights: {
                type: Number,
                required: true,
                min: 1
            },
            discountPercentage: {
                type: Number,
                required: true,
                min: 0,
                max: 50
            }
        }],
        extendedStayBonus: {
            threshold: {
                type: Number,
                default: 7 // Nights
            },
            bonusDiscount: {
                type: Number,
                default: 10 // Percentage
            }
        }
    },
    
    // Customer Segment Pricing
    customerSegmentConfig: {
        segments: [{
            segmentType: {
                type: String,
                enum: ['LOYALTY_GOLD', 'LOYALTY_SILVER', 'CORPORATE', 'GROUP', 'RETURNING', 'FIRST_TIME'],
                required: true
            },
            discountPercentage: {
                type: Number,
                required: true,
                min: 0,
                max: 50
            },
            minimumStay: {
                type: Number,
                default: 1
            }
        }]
    },
    
    // Competitor Pricing Configuration
    competitorConfig: {
        competitors: [{
            competitorName: {
                type: String,
                required: true
            },
            baseUrl: {
                type: String // For API integration
            },
            priceOffset: {
                type: Number,
                default: 0 // How much below/above competitor
            },
            offsetType: {
                type: String,
                enum: ['PERCENTAGE', 'FIXED_AMOUNT'],
                default: 'PERCENTAGE'
            }
        }],
        updateFrequency: {
            type: String,
            enum: ['HOURLY', 'DAILY', 'WEEKLY'],
            default: 'DAILY'
        },
        enabled: {
            type: Boolean,
            default: false
        }
    },
    
    // Advanced Constraints and Conditions
    conditions: {
        minimumOccupancy: {
            type: Number,
            min: 0,
            max: 100
        },
        maximumOccupancy: {
            type: Number,
            min: 0,
            max: 100
        },
        weatherConditions: [{
            condition: {
                type: String,
                enum: ['SUNNY', 'RAINY', 'SNOWY', 'CLOUDY', 'STORMY']
            },
            multiplier: {
                type: Number,
                min: 0.5,
                max: 2.0
            }
        }],
        temperatureRange: {
            minTemp: Number,
            maxTemp: Number,
            multiplier: {
                type: Number,
                min: 0.5,
                max: 2.0
            }
        }
    },
    
    // Revenue Targets and Performance
    revenueTargets: {
        dailyTarget: {
            type: Number,
            min: 0
        },
        weeklyTarget: {
            type: Number,
            min: 0
        },
        monthlyTarget: {
            type: Number,
            min: 0
        },
        adjustmentTrigger: {
            type: Number,
            default: 80, // Percentage of target to trigger adjustments
            min: 50,
            max: 100
        }
    },
    
    // Automation Settings
    automation: {
        autoApply: {
            type: Boolean,
            default: false
        },
        requireApproval: {
            type: Boolean,
            default: true
        },
        maxAdjustmentPerDay: {
            type: Number,
            default: 20, // Maximum percentage change per day
            min: 1,
            max: 50
        },
        notificationThreshold: {
            type: Number,
            default: 15, // Notify when price changes exceed this percentage
            min: 5,
            max: 50
        }
    },
    
    // Performance Tracking
    performance: {
        applicationsCount: {
            type: Number,
            default: 0
        },
        revenueImpact: {
            type: Number,
            default: 0
        },
        lastApplied: {
            type: Date
        },
        averageRevenueLift: {
            type: Number,
            default: 0
        },
        successRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        }
    },
    
    // Audit Trail
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    lastModifiedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    approvedAt: {
        type: Date
    },
    
    // Metadata
    tags: [{
        type: String,
        trim: true
    }],
    notes: {
        type: String,
        maxlength: 1000
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Indexes for Performance
pricingRuleSchema.index({ hotelId: 1, isActive: 1, ruleType: 1 });
pricingRuleSchema.index({ validFrom: 1, validUntil: 1 });
pricingRuleSchema.index({ priority: -1, isActive: 1 });
pricingRuleSchema.index({ ruleType: 1, isActive: 1 });
pricingRuleSchema.index({ 'automation.autoApply': 1, isActive: 1 });

// Virtual for checking if rule is currently valid
pricingRuleSchema.virtual('isCurrentlyValid').get(function() {
    const now = new Date();
    return this.isActive && now >= this.validFrom && now <= this.validUntil;
});

// Virtual for days until expiration
pricingRuleSchema.virtual('daysUntilExpiration').get(function() {
    const now = new Date();
    const diffTime = this.validUntil - now;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for rule effectiveness score
pricingRuleSchema.virtual('effectivenessScore').get(function() {
    if (this.performance.applicationsCount === 0) return 0;
    return (this.performance.successRate * 0.7) + (this.performance.averageRevenueLift * 0.3);
});

// Pre-save middleware for validation
pricingRuleSchema.pre('save', function(next) {
    // Validate date ranges
    if (this.validFrom >= this.validUntil) {
        return next(new Error('Valid from date must be before valid until date'));
    }
    
    // Validate price constraints
    if (this.minPrice && this.maxPrice && this.minPrice >= this.maxPrice) {
        return next(new Error('Minimum price must be less than maximum price'));
    }
    
    // Validate seasonal config dates
    if (this.seasonalConfig && this.seasonalConfig.seasons) {
        for (const season of this.seasonalConfig.seasons) {
            if (season.startDate >= season.endDate) {
                return next(new Error(`Season ${season.name}: start date must be before end date`));
            }
        }
    }
    
    // Validate demand config thresholds
    if (this.demandConfig && this.demandConfig.thresholds) {
        for (const threshold of this.demandConfig.thresholds) {
            if (threshold.occupancyMin >= threshold.occupancyMax) {
                return next(new Error('Occupancy min must be less than occupancy max'));
            }
        }
    }
    
    next();
});

// Static method to find active rules for a hotel
pricingRuleSchema.statics.findActiveRulesForHotel = function(hotelId, date = new Date()) {
    return this.find({
        $or: [
            { hotelId: hotelId },
            { hotelId: { $exists: false } } // Global rules
        ],
        isActive: true,
        validFrom: { $lte: date },
        validUntil: { $gte: date }
    }).sort({ priority: -1 });
};

// Static method to find rules by type
pricingRuleSchema.statics.findByType = function(ruleType, hotelId = null) {
    const query = {
        ruleType: ruleType,
        isActive: true,
        validFrom: { $lte: new Date() },
        validUntil: { $gte: new Date() }
    };
    
    if (hotelId) {
        query.$or = [
            { hotelId: hotelId },
            { hotelId: { $exists: false } }
        ];
    }
    
    return this.find(query).sort({ priority: -1 });
};

// Instance method to check if rule applies to specific conditions
pricingRuleSchema.methods.appliesTo = function(conditions) {
    const { roomType, occupancy, leadDays, dayOfWeek, customerSegment } = conditions;
    
    // Check room type
    if (this.roomTypes.length > 0 && !this.roomTypes.includes(roomType)) {
        return false;
    }
    
    // Check occupancy constraints
    if (this.conditions.minimumOccupancy && occupancy < this.conditions.minimumOccupancy) {
        return false;
    }
    if (this.conditions.maximumOccupancy && occupancy > this.conditions.maximumOccupancy) {
        return false;
    }
    
    return true;
};

// Instance method to calculate price adjustment
pricingRuleSchema.methods.calculateAdjustment = function(basePrice, conditions = {}) {
    let adjustedPrice = basePrice;
    let appliedMultipliers = [];
    
    switch (this.adjustmentType) {
        case 'PERCENTAGE':
            adjustedPrice = basePrice * (1 + this.adjustmentValue / 100);
            break;
        case 'FIXED_AMOUNT':
            adjustedPrice = basePrice + this.adjustmentValue;
            break;
        case 'ABSOLUTE_PRICE':
            adjustedPrice = this.adjustmentValue;
            break;
        case 'MULTIPLIER':
            adjustedPrice = basePrice * this.adjustmentValue;
            break;
    }
    
    // Apply additional multipliers based on rule type
    if (this.ruleType === 'SEASONAL' && this.seasonalConfig) {
        const multiplier = this._getSeasonalMultiplier(conditions.date);
        adjustedPrice *= multiplier;
        appliedMultipliers.push({ type: 'seasonal', value: multiplier });
    }
    
    if (this.ruleType === 'DAY_OF_WEEK' && this.dayOfWeekConfig) {
        const multiplier = this._getDayOfWeekMultiplier(conditions.dayOfWeek);
        adjustedPrice *= multiplier;
        appliedMultipliers.push({ type: 'dayOfWeek', value: multiplier });
    }
    
    // Apply constraints
    if (this.minPrice && adjustedPrice < this.minPrice) {
        adjustedPrice = this.minPrice;
    }
    if (this.maxPrice && adjustedPrice > this.maxPrice) {
        adjustedPrice = this.maxPrice;
    }
    
    return {
        originalPrice: basePrice,
        adjustedPrice: Math.round(adjustedPrice * 100) / 100,
        appliedMultipliers,
        ruleName: this.name,
        ruleType: this.ruleType
    };
};

// Helper method for seasonal multiplier
pricingRuleSchema.methods._getSeasonalMultiplier = function(date) {
    if (!this.seasonalConfig || !this.seasonalConfig.seasons) return 1;
    
    const currentDate = new Date(date);
    for (const season of this.seasonalConfig.seasons) {
        let startDate = new Date(season.startDate);
        let endDate = new Date(season.endDate);
        
        // Handle recurring seasons
        if (season.isRecurring) {
            startDate.setFullYear(currentDate.getFullYear());
            endDate.setFullYear(currentDate.getFullYear());
        }
        
        if (currentDate >= startDate && currentDate <= endDate) {
            return season.adjustmentMultiplier;
        }
    }
    
    return 1;
};

// Helper method for day of week multiplier
pricingRuleSchema.methods._getDayOfWeekMultiplier = function(dayOfWeek) {
    if (!this.dayOfWeekConfig) return 1;
    
    const isWeekend = dayOfWeek === 'SATURDAY' || dayOfWeek === 'SUNDAY';
    
    // Check custom day configuration first
    const customDay = this.dayOfWeekConfig.customDays.find(d => d.day === dayOfWeek);
    if (customDay) {
        return customDay.multiplier;
    }
    
    // Apply weekend/weekday multiplier
    return isWeekend ? this.dayOfWeekConfig.weekendMultiplier : this.dayOfWeekConfig.weekdayMultiplier;
};

// Instance method to update performance metrics
pricingRuleSchema.methods.updatePerformance = function(revenueImpact, success = true) {
    this.performance.applicationsCount += 1;
    this.performance.revenueImpact += revenueImpact;
    this.performance.lastApplied = new Date();
    
    // Update success rate
    const successCount = this.performance.successRate * (this.performance.applicationsCount - 1) / 100;
    const newSuccessCount = success ? successCount + 1 : successCount;
    this.performance.successRate = (newSuccessCount / this.performance.applicationsCount) * 100;
    
    // Update average revenue lift
    this.performance.averageRevenueLift = this.performance.revenueImpact / this.performance.applicationsCount;
    
    return this.save();
};

module.exports = mongoose.model('PricingRule', pricingRuleSchema);