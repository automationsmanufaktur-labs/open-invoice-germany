# Mitmachen bei OpenInvoice Germany

Danke, dass du beitragen willst! Ziel des Projekts: rechtssichere Rechnungsstellung für Deutschland **kostenlos und frei** halten.

## Entwicklungs-Setup

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run db:seed
npm run dev
```

Schemaänderungen betreffen **beide** Schemadateien. `prisma/schema.postgres.prisma`
unterscheidet sich von `prisma/schema.prisma` nur in der Provider-Zeile und wird
abgeleitet:

```bash
sed 's/provider = "sqlite"/provider = "postgresql"/' prisma/schema.prisma \
  > prisma/schema.postgres.prisma
```

Danach je eine Migration pro Provider erzeugen. Für SQLite genügt:

```bash
npm run db:migrate -- --name <beschreibung>
```

Für PostgreSQL braucht es eine vom Host erreichbare Datenbank. Der `db`-Service in
`docker-compose.yml` veröffentlicht bewusst keinen Port (er läuft mit
`POSTGRES_HOST_AUTH_METHOD: trust`), deshalb dafür einen Wegwerf-Container nutzen:

```bash
docker run -d --name oig-migrate \
  -e POSTGRES_USER=oig -e POSTGRES_PASSWORD=test -e POSTGRES_DB=openinvoice \
  -p 55432:5432 postgres:16-alpine
export DATABASE_URL="postgresql://oig:test@localhost:55432/openinvoice?schema=public"
npx prisma migrate deploy --config prisma.postgres.config.ts   # Baseline anwenden
npm run db:migrate:pg -- --name <beschreibung>
docker rm -f oig-migrate
```

`migrate dev` erzeugt am Ende den Prisma-Client neu. Weil beide Schemadateien in
denselben Pfad (`src/generated/prisma`) generieren, ruft `db:migrate:pg` über
`scripts/migrate-postgres.sh` anschließend `prisma generate` auf und stellt den
SQLite-Client wieder her — sonst schlagen danach `npm test` und `npm run dev` mit
einem irreführenden Protokollfehler fehl.

Der CI-Job `schema-drift` schlägt fehl, wenn die beiden Dateien auseinanderlaufen.

## Vor jedem Pull Request

```bash
npm run typecheck   # tsc --noEmit
npm run lint
npm test            # alle Tests müssen grün sein
npm run build       # Production-Build muss durchlaufen
```

## Konventionen

- **TypeScript strict**, kein `any` (nutze `unknown` + Narrowing).
- **Zod an jedem Boundary** (API-Routes, Formulare). DB-„Enums" sind Strings + Zod.
- **Geld als Integer-Cent**, **Mengen als Integer-Milliunits** — keine Floats für Beträge.
- **Prisma** immer mit `select`/`include` (kein N+1). Festgeschriebene Rechnungen niemals direkt mutieren — nur über die Domain-Services (`finalize`, `cancel`, `recordPayment`).
- Domain-Logik in `src/domain/` bleibt **rein und testbar**; alles mit DB-/Framework-Bezug klar getrennt.
- Dateien kebab-case, Komponenten PascalCase, Konstanten UPPER_SNAKE_CASE.

## Rechtliche Änderungen

Korrekturen an Pflichtangaben, Fristen, Steuerlogik etc. **immer mit Quelle** (Norm, BMF-Schreiben, KoSIT-Spezifikation) und als Update an **[COMPLIANCE.md](COMPLIANCE.md)**. Bitte markiere Unsicheres als `[ungesichert]`. Dies ist keine Steuerberatung — wir bilden geltendes Recht nach bestem Wissen ab.

## Developer Certificate of Origin (DCO)

Bitte signiere deine Commits (`git commit -s`). Damit bestätigst du das [DCO](https://developercertificate.org/): Du hast das Recht, den Beitrag einzureichen, und reichst ihn unter der Projektlizenz ein. Das DCO überträgt kein Copyright — dein Beitrag bleibt deiner und steht wie das übrige Projekt unter AGPL-3.0.

## Größere Beiträge

Ein ganzes Feature oder ein umgebauter Fork ist willkommen, aber bitte nicht als ein einziger Monster-PR. Schneide ihn in thematische PRs, die einzeln lauffähig und einzeln sinnvoll sind (z. B. „E-Mail-Versand", „Belegfluss", „REST-API"). Jeder PR gegen den aktuellen `main`, mit Tests für neue Logik und den vier Gates von oben.

Am besten vorher kurz ein Issue aufmachen und den geplanten Schnitt beschreiben — dann klären wir Reihenfolge und Überschneidungen, bevor du Arbeit in etwas steckst, das so nicht passt.

Bei rechtsnahen Änderungen (Pflichtangaben, Steuerlogik, Nummernkreis, Festschreibung, Hash-Chain) rechne mit einer gründlicheren Runde. Das ist die Stelle, an der ein Fehler beim Nutzer teuer wird.

Reviews können ein paar Tage dauern. Wenn du nach einer Woche nichts gehört hast, ping im PR oder schreib an info@automationsmanufaktur.de.

## Tests

- Reine Logik (Money, Steuer, Nummernformat, Hash-Chain, Pflichtangaben): Unit-Tests in `test/unit/`.
- DB-/GoBD-Verhalten (Nummernkreis, Unveränderbarkeit, Storno): Integrationstests in `test/integration/` (eigene SQLite-`test.db`).
- Neue rechtliche Regeln bitte mit einem Test absichern.
