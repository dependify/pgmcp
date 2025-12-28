FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy server files
COPY server-http.js ./

# Create non-root user
RUN addgroup -g 1001 -S nodeuser && \
    adduser -S nodeuser -u 1001 && \
    chown -R nodeuser:nodeuser /app
USER nodeuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start HTTP server
CMD ["node", "server-http.js"]