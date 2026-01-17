# backend Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app

# install deps
COPY package.json package-lock.json* ./
RUN npm install

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

# copy generated files and node_modules
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
