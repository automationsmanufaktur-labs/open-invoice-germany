# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Wie in der CI (.github/workflows/ci.yml) npm install statt npm ci: die
# committete package-lock.json ist nicht deckungsgleich mit package.json
# (fehlend: @emnapi/core, @emnapi/runtime, magicast).
# --ignore-scripts, weil postinstall "prisma generate" aufruft — das Schema
# liegt in dieser Stage noch nicht vor. Die build-Stage generiert den Client
# ohnehin explizit.
RUN npm install --no-audit --no-fund --ignore-scripts

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
# Fix-Welle (Blocking 3): src/app/api/v1/openapi.json/route.ts liest die Datei zur
# Laufzeit relativ zu process.cwd() (`path.join(process.cwd(), "openapi", "openapi.json")`)
# — ohne diese Zeile fehlte das Verzeichnis in der runner-Stage komplett, /api/docs und
# GET /api/v1/openapi.json warfen ENOENT -> 500 auf jeder Produktivinstanz.
COPY --from=build /app/openapi ./openapi
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
COPY --from=build /app/prisma.postgres.config.ts ./prisma.postgres.config.ts
COPY --from=build /app/scripts ./scripts
EXPOSE 3000
CMD ["sh", "./scripts/docker-entrypoint.sh"]
