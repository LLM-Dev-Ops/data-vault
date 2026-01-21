# LLM-Data-Vault: Production Dockerfile
# Unified service for Data Access Control and Dataset Anonymization agents

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production=false

# Copy source
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production && npm cache clean --force

# Set ownership
RUN chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:8080/health').then(r => process.exit(r.ok ? 0 : 1))"

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Start with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/functions/server.js"]
