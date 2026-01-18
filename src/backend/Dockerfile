# backend Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# install deps (network-hardy)
COPY package.json package-lock.json* ./
RUN npm config set registry https://registry.npmjs.org/ \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && npm config set audit false \
 && npm config set fund false \
 && if [ -f package-lock.json ]; then npm ci; else npm install; fi

# prisma
COPY prisma ./prisma
RUN npx prisma generate

# sources
COPY tsconfig.json ./tsconfig.json
COPY src ./src

RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# runtime deps for prisma (openssl) and certs
RUN apk add --no-cache openssl ca-certificates

# copy generated files and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
