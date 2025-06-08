# Hotel Management System - Production Dockerfile
# Multi-stage build for optimized production image

# ================================
# Stage 1: Build dependencies
# ================================
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci --only=production && npm cache clean --force

# ================================
# Stage 2: Production runtime
# ================================
FROM node:18-alpine AS production

# Metadata
LABEL maintainer="Nawfal Razouk <nawfal.razouk@enim.ac.ma>"
LABEL description="Hotel Management System Backend API"
LABEL version="1.0.0"

# Install system dependencies
RUN apk add --no-cache \
    dumb-init \
    curl \
    tzdata \
    && rm -rf /var/cache/apk/*

# Set timezone
ENV TZ=Europe/Paris

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S hotel -u 1001 -G nodejs

# Set working directory
WORKDIR /app

# Copy built dependencies from builder stage
COPY --from=builder --chown=hotel:nodejs /app/node_modules ./node_modules

# Copy application code
COPY --chown=hotel:nodejs . .

# Create necessary directories
RUN mkdir -p logs uploads invoices exports temp && \
    chown -R hotel:nodejs logs uploads invoices exports temp

# Remove development files
RUN rm -rf \
    .git \
    .gitignore \
    .env.development \
    .env.example \
    tests/ \
    docs/ \
    README.md \
    docker-compose.yml \
    Dockerfile

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${PORT:-5000}/health || exit 1

# Switch to non-root user
USER hotel

# Expose port
EXPOSE 5000

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "server.js"]