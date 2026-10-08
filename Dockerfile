# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# postinstall führt `prisma generate` aus und braucht dafür Config + Schema
COPY prisma.config.ts ./
COPY prisma/schema.prisma ./prisma/
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# PostgreSQL-Client generieren + Production-Build (force-dynamic Seiten -> kein DB-Zugriff im Build)
RUN npx prisma generate --schema=prisma/schema.postgres.prisma \
  && npx next build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/src/generated ./src/generated
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
# Schema in PostgreSQL anlegen (db push) und App starten.
# Hinweis: Für produktive Migrationsverwaltung später eigene Postgres-Migrationen statt db push.
CMD ["sh", "-c", "npx prisma db push --schema=prisma/schema.postgres.prisma --skip-generate --accept-data-loss && npx next start -p 3000"]
