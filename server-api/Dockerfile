FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json yarn.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN yarn install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN yarn build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/generated ./generated
COPY prisma ./prisma
COPY package.json ./
COPY prisma.config.ts ./
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
