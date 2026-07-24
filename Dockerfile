# ─── Stage 1: Builder ────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies (no secrets needed at build time)
COPY package*.json ./
RUN npm ci --prefer-offline

# Copy source
COPY tsconfig.json ./
COPY prisma ./prisma/
COPY src ./src/

# Generate Prisma client (no secrets needed)
RUN npx prisma generate

# Compile TypeScript
RUN npm run build 2>/dev/null || npx tsc

# ─── Stage 2: Production runtime ─────────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev --prefer-offline

# Copy compiled output and prisma client
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma/

# All sensitive variables are injected at RUNTIME by Railway (not baked into image)
# See: https://docs.railway.app/guides/variables
# Never use ARG/ENV for: DATABASE_URL, REDIS_URL, GEMINI_API_KEY,
# CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, FIREBASE_PRIVATE_KEY,
# GITHUB_TOKEN, JWT_SECRET — set them in the Railway dashboard instead.

EXPOSE 8080

CMD ["node", "dist/index.js"]
