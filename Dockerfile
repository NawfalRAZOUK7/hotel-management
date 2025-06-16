# Hotel Management System - Production Dockerfile
# Multi-stage build optimized for QR + Redis + Cache System
# Version: C1 Environment Setup - QR + Redis Production Ready
# ================================
# Stage 1: Dependencies & Build Tools
# ================================
FROM node:18-alpine AS dependencies

# Metadata
LABEL maintainer="Nawfal Razouk <nawfal.razouk@enim.ac.ma>"
LABEL description="Hotel Management System Backend API with QR + Redis"
LABEL version="1.0.0"
LABEL stage="dependencies"

# Install build dependencies for QR + Redis native modules
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    musl-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for native builds)
RUN npm ci --only=production && \
    npm rebuild && \
    npm cache clean --force

# ================================
# Stage 2: QR + Redis Tools Installation
# ================================
FROM node:18-alpine AS tools

# Install Redis tools and QR dependencies
RUN apk add --no-cache \
    redis \
    redis-cli \
    curl \
    wget \
    jq \
    cairo \
    jpeg \
    pango \
    musl \
    giflib \
    pixman \
    pangomm \
    libjpeg-turbo \
    freetype

# Install QR debugging tools
RUN npm install -g qrcode-terminal

# ================================
# Stage 3: Production Runtime
# ================================
FROM node:18-alpine AS production

# Metadata for production
LABEL maintainer="Nawfal Razouk <nawfal.razouk@enim.ac.ma>"
LABEL description="Hotel Management System Backend API - Production QR + Redis"
LABEL version="1.0.0"
LABEL stage="production"
LABEL features="qr-codes,redis-cache,yield-management,real-time"

# Install production system dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    tzdata \
    redis-cli \
    cairo \
    jpeg \
    pango \
    musl \
    giflib \
    pixman \
    pangomm \
    libjpeg-turbo \
    freetype \
    jq \
    && rm -rf /var/cache/apk/*

# Set timezone for yield management
ENV TZ=Europe/Paris

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hotel -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy dependencies from dependencies stage
COPY --from=dependencies --chown=hotel:nodejs /app/node_modules ./node_modules

# Copy Redis CLI from tools stage
COPY --from=tools /usr/bin/redis-cli /usr/local/bin/redis-cli

# Copy application code
COPY --chown=hotel:nodejs . .

# Create necessary directories for QR + Cache + Logs
RUN mkdir -p \
    logs \
    uploads \
    uploads/qr \
    uploads/logos \
    invoices \
    exports \
    temp \
    cache \
    qr-codes \
    && chown -R hotel:nodejs \
    logs \
    uploads \
    uploads/qr \
    uploads/logos \
    invoices \
    exports \
    temp \
    cache \
    qr-codes

# Create production scripts directory
RUN mkdir -p scripts/production && \
    chown -R hotel:nodejs scripts/

# Create health check scripts for QR + Redis
COPY --chown=hotel:nodejs <<EOF /app/scripts/production/health-check.sh
#!/bin/sh
# Health check script for QR + Redis system

echo "🔍 Checking application health..."

# Check main application
APP_HEALTH=\$(curl -sf http://localhost:\${PORT:-5000}/health || echo "FAIL")
if [ "\$APP_HEALTH" = "FAIL" ]; then
    echo "❌ Application health check failed"
    exit 1
fi

# Check Redis connection if Redis is enabled
if [ "\${REDIS_HOST}" != "" ]; then
    echo "🔍 Checking Redis connection..."
    REDIS_HEALTH=\$(curl -sf http://localhost:\${PORT:-5000}/health/redis || echo "FAIL")
    if [ "\$REDIS_HEALTH" = "FAIL" ]; then
        echo "❌ Redis health check failed"
        exit 1
    fi
fi

# Check QR system if QR is enabled
if [ "\${QR_JWT_SECRET}" != "" ]; then
    echo "🔍 Checking QR system..."
    QR_HEALTH=\$(curl -sf http://localhost:\${PORT:-5000}/health/qr || echo "FAIL")
    if [ "\$QR_HEALTH" = "FAIL" ]; then
        echo "❌ QR system health check failed"
        exit 1
    fi
fi

echo "✅ All systems healthy"
exit 0
EOF

# Make health check script executable
RUN chmod +x /app/scripts/production/health-check.sh

# Create Redis connection test script
COPY --chown=hotel:nodejs <<EOF /app/scripts/production/test-redis.sh
#!/bin/sh
# Test Redis connection

if [ "\${REDIS_HOST}" = "" ]; then
    echo "⚠️  Redis not configured"
    exit 0
fi

echo "🔍 Testing Redis connection to \${REDIS_HOST}:\${REDIS_PORT}..."

if [ "\${REDIS_PASSWORD}" != "" ]; then
    redis-cli -h \${REDIS_HOST} -p \${REDIS_PORT} -a \${REDIS_PASSWORD} ping
else
    redis-cli -h \${REDIS_HOST} -p \${REDIS_PORT} ping
fi

if [ \$? -eq 0 ]; then
    echo "✅ Redis connection successful"
else
    echo "❌ Redis connection failed"
    exit 1
fi
EOF

RUN chmod +x /app/scripts/production/test-redis.sh

# Create QR system test script
COPY --chown=hotel:nodejs <<EOF /app/scripts/production/test-qr.js
// Test QR system functionality
const QRCode = require('qrcode');

async function testQRSystem() {
    try {
        console.log('🔍 Testing QR code generation...');
        
        const testData = JSON.stringify({
            hotelId: 'test-hotel',
            roomNumber: '101',
            timestamp: Date.now(),
            type: 'check-in'
        });
        
        const qrCode = await QRCode.toDataURL(testData);
        
        if (qrCode && qrCode.startsWith('data:image/png;base64,')) {
            console.log('✅ QR code generation successful');
            console.log('📊 QR code length:', qrCode.length);
            process.exit(0);
        } else {
            throw new Error('Invalid QR code generated');
        }
        
    } catch (error) {
        console.error('❌ QR system test failed:', error.message);
        process.exit(1);
    }
}

testQRSystem();
EOF

# Create performance monitoring script
COPY --chown=hotel:nodejs <<EOF /app/scripts/production/monitor.sh
#!/bin/sh
# Performance monitoring script

echo "📊 System Performance Monitor"
echo "=============================="

# Memory usage
echo "🧠 Memory Usage:"
free -h

# Disk usage
echo "💾 Disk Usage:"
df -h /app

# Process info
echo "🔄 Node.js Processes:"
ps aux | grep node

# Network connections
echo "🌐 Network Connections:"
netstat -tlnp | grep :5000

# Redis connection (if available)
if command -v redis-cli >/dev/null 2>&1 && [ "\${REDIS_HOST}" != "" ]; then
    echo "🔗 Redis Info:"
    if [ "\${REDIS_PASSWORD}" != "" ]; then
        redis-cli -h \${REDIS_HOST} -p \${REDIS_PORT} -a \${REDIS_PASSWORD} info memory | head -5
    else
        redis-cli -h \${REDIS_HOST} -p \${REDIS_PORT} info memory | head -5
    fi
fi

echo "=============================="
EOF

RUN chmod +x /app/scripts/production/monitor.sh

# Remove development files and optimize for production
RUN rm -rf \
    .git \
    .gitignore \
    .env.development \
    .env.example \
    tests/ \
    docs/ \
    README.md \
    docker-compose.yml \
    Dockerfile \
    *.md

# Set environment variables for production
ENV NODE_ENV=production
ENV NPM_CONFIG_PRODUCTION=true

# Optimize for QR + Redis performance
ENV UV_THREADPOOL_SIZE=20
ENV NODE_OPTIONS="--max-old-space-size=1024"

# Redis client optimizations
ENV REDIS_LAZY_CONNECT=true
ENV REDIS_ENABLE_OFFLINE_QUEUE=false

# QR system optimizations
ENV QR_CONCURRENT_LIMIT=10
ENV QR_MEMORY_LIMIT=50mb

# Comprehensive health check for QR + Redis system
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD /app/scripts/production/health-check.sh

# Switch to non-root user
USER hotel

# Expose ports
EXPOSE 5000 3001

# Create startup script with pre-flight checks
COPY --chown=hotel:nodejs <<EOF /app/scripts/production/startup.sh
#!/bin/sh
echo "🚀 Starting Hotel Management System with QR + Redis..."

# Pre-flight checks
echo "🔍 Running pre-flight checks..."

# Check environment variables
if [ "\${NODE_ENV}" != "production" ]; then
    echo "⚠️  Warning: NODE_ENV is not set to production"
fi

# Test Redis connection if configured
if [ "\${REDIS_HOST}" != "" ]; then
    echo "🔍 Testing Redis connection..."
    /app/scripts/production/test-redis.sh
    if [ \$? -ne 0 ]; then
        echo "❌ Redis connection test failed - continuing without cache"
    fi
fi

# Test QR system
if [ "\${QR_JWT_SECRET}" != "" ]; then
    echo "🔍 Testing QR system..."
    node /app/scripts/production/test-qr.js
    if [ \$? -ne 0 ]; then
        echo "❌ QR system test failed - check configuration"
        exit 1
    fi
fi

echo "✅ Pre-flight checks completed"
echo "🎯 Starting application..."

# Start the application
exec node server.js
EOF

RUN chmod +x /app/scripts/production/startup.sh

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start with startup script that includes checks
CMD ["/app/scripts/production/startup.sh"]

# Production labels for monitoring
LABEL com.hotel.system="production"
LABEL com.hotel.features="qr-codes,redis-cache,yield-management"
LABEL com.hotel.version="1.0.0"
LABEL com.hotel.stage="C1-environment-setup"