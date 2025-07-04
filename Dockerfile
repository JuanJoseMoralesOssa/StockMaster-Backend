# Multi-stage build for production optimization
FROM docker.io/library/node:22-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including devDependencies needed for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM docker.io/library/node:22-alpine AS production

# Install security updates and curl for health checks
RUN apk update && \
  apk upgrade && \
  apk add --no-cache curl && \
  rm -rf /var/cache/apk/* && \
  addgroup -g 1001 -S nodeuser && \
  adduser -S nodeuser -u 1001

# Create app directory
WORKDIR /home/nodeuser/app

# Copy package files first for better caching
COPY --from=builder /app/package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application and other necessary files
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/certs ./src/certs

# Change ownership to non-root user
RUN chown -R nodeuser:nodeuser /home/nodeuser/app

# Switch to non-root user
USER nodeuser

# Environment variables
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/ping || exit 1

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "dist/index.js"]
