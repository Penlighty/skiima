# ==========================================
# STAGE 1: Build Compilation Pipeline
# ==========================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency definition manifest and lock files
COPY package*.json ./

# Install all build dependencies
RUN npm ci

# Copy TypeScript source and configurations
COPY tsconfig.json ./
COPY src/ ./src/

# Compile down to raw optimized ES2022 JavaScript in dist/
RUN npm run build

# ==========================================
# STAGE 2: Secure Production Runtime
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

# Copy production package definition and copy compiled source
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist/ ./dist/

# Install only production dependencies, excluding heavy development build packages
RUN npm ci --omit=dev

# Run with non-root security privileges for peak containerized container isolation
USER node

EXPOSE 3000

CMD ["node", "dist/server.js"]
