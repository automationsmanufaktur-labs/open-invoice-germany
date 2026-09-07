<div align="center">

<img src="https://raw.githubusercontent.com/automationsmanufaktur-labs/open-invoice-germany/main/assets/banner.svg" alt="OpenInvoice Germany — kostenlose self-hostbare Rechnungssoftware mit XRechnung / EN 16931, GoBD und § 14 UStG" width="100%" />

# OpenInvoice Germany

**Kostenlose, self-hostbare Open-Source-Rechnungssoftware für Deutschland.**
E-Rechnung (XRechnung / ZUGFeRD) · GoBD · § 14 UStG · Kleinunternehmer § 19 · DSGVO

[![CI](https://github.com/automationsmanufaktur-labs/open-invoice-germany/actions/workflows/ci.yml/badge.svg)](https://github.com/automationsmanufaktur-labs/open-invoice-germany/actions/workflows/ci.yml)
&nbsp;·&nbsp; Lizenz: **AGPL-3.0** &nbsp;·&nbsp; [English](README.md) · **Deutsch**

</div>

> **Warum?** Ab 2025 gilt die E-Rechnungs-Empfangspflicht im B2B, ab 2027/2028 die Versandpflicht. Viele Selbstständige und KMU zahlen monatlich für Rechnungssoftware, nur um rechtskonform zu bleiben. Dieses Projekt macht das **kostenlos und frei** — du hostest es selbst, deine Daten bleiben bei dir.

> ⚠️ **Keine Steuer- oder Rechtsberatung.** GoBD-Konformität erfordert zusätzlich eine Verfahrensdokumentation des Anwenders. Alle rechtlichen Grundlagen mit Quellen stehen in **[COMPLIANCE.md](COMPLIANCE.md)** (Single Source of Truth). Ohne Gewähr.

---

## 🗣️ Mit Claude Code per Sprache (MCP)

Verbinde deine lokale Instanz mit **Claude Code** oder Claude Desktop und erstelle rechtssichere Rechnungen, indem du sie einfach beschreibst:

> „Erstelle eine Rechnung an Müller GmbH über 3 Stunden Beratung à 95 €, Leistung heute, schreib sie fest und exportier die XRechnung."

Claude ruft die passenden Tools auf (Kunde/Leistung anlegen → Rechnung → festschreiben → PDF + XRechnung). Das Festschreiben **erzwingt** die § 14-Pflichtangaben — nicht-konforme Rechnungen sind ausgeschlossen. Die Rechnung wird lokal erstellt und gespeichert. Setup + Beispiele: **[docs/MCP.md](docs/MCP.md)**.

```bash
npm run mcp   # MCP-Server (stdio) starten / in Claude Code via .mcp.json einbinden
```

> 🔒 **Datenschutz (DSGVO).** Der App-Kern läuft **zu 100 % lokal**, das MCP-Feature ist aber optional und **nicht automatisch DSGVO-konform**: Sobald ein **Cloud-LLM** (z. B. Claude) die Rechnung erstellt, werden die beschriebenen Inhalte (Kundenname, Leistungen, Beträge = personenbezogene Daten) an den Anbieter übermittelt und in deinem Auftrag verarbeitet (Auftragsverarbeitung, Art. 28 DSGVO). Für den geschäftlichen Einsatz mit echten Personendaten entweder ein **lokales Modell** nutzen (der MCP-Server ist anbieterneutral) oder einen **API-Zugang mit AVV** — beachte: Claude **Code/Desktop** nutzen immer die Anthropic-Cloud, und das Consumer-**Abo (Pro/Max) hat keinen AVV**. Den Anbieter als Sub-Auftragsverarbeiter im Verarbeitungsverzeichnis und in der Datenschutzerklärung führen. Details: **[docs/MCP.md](docs/MCP.md)**. Keine Rechtsberatung.

## Funktionen

- **Sprachsteuerung via MCP** (Claude Code/Desktop) — siehe oben.
- **GoBD-Kern**: Festschreibung (Entwurf → unveränderbar), lückenlose Nummernkreise, append-only Audit-**Hash-Chain**, Storno statt Löschung.
- **§ 14 UStG**: Pflichtangaben-Prüfung blockt das Festschreiben bei fehlenden Angaben.
- **Steuerschemata**: Regelbesteuerung (19/7/0), Kleinunternehmer (§ 19), Reverse Charge (§ 13b), ig. Lieferung, Differenzbesteuerung (§ 25a), Kleinbetrag (§ 33).
- **E-Rechnung**: **XRechnung** (UBL, EN 16931) — Export inkl. EN-16931-Kernregel-Validierung. ZUGFeRD/Factur-X über Mustang-Sidecar (Docker).
- **PDF-Export** ("sonstige Rechnung") mit allen Pflichtangaben.
- **Positions-Editor**: Drag-and-Drop zum Umordnen, Positionen duplizieren, Überschriften/Textblöcke/berechnete Zwischensummen neben regulären Positionen (nur reguläre Positionen landen im E-Rechnung-XML), Rich-Text (eingeschränktes Markdown — fett/kursiv/unterstrichen, eine Listenebene, Links) in Positionsbeschreibungen, Artikelnummern sowie Kopffelder (Betreff, Bestellnummer, interne Referenz, Ansprechpartner, Liefer-/Rechnungsadresse).
- **Beleganhänge**: Dateien an jeden Beleg (Rechnung, Angebot, Lieferschein, Mahnung, Abo) anhängen — 10 MB je Datei, 50 MB je Beleg, MIME-Whitelist + Magic-Bytes-Prüfung, hash-adressierte Ablage mit Dedup, auswählbar als Zusatzanhang beim Mailversand.
- **Teil-, Abschlags- und Schlussrechnungen** (§ 14 Abs. 5 UStG): Teilrechnung über Prozent/Betrag/einzelne Positionen aus Angebot oder Lieferschein, Abschlagsrechnung vor Leistungserbringung (E-Rechnung-Typcode 386), abschließende Schlussrechnung, die die Abschläge samt Steuer automatisch absetzt (unveränderlicher Abzugs-Snapshot, BT-113/BT-115/BG-3 in der E-Rechnung, passender PDF-Abzugsblock).
- **Briefpapier, Druckoptionen & Nummernkreise**: Briefpapier je Organisation (Logo, Farbe, Ränder, Absender-/Fußzeile) mit Live-Vorschau; zehn globale Druckschalter (Fußzeile, Seitenzahlen, Falz-/Lochmarken, welche Spalten erscheinen) mit Beleg-Override im Entwurf; neun konfigurierbare Nummernkreise (Angebote, Auftragsbestätigungen, Proforma, Lieferscheine, Rechnungen, Gutschriften, Mahnungen sowie Kunden-/Artikelnummern) mit Muster/Präfix/Reset und Rückdreh-Sperre.
- **EPC-QR-Code („GiroCode")** auf Rechnungen — Scannen & Bezahlen in jeder Banking-App, aus denselben IBAN-/Betragsdaten der Rechnung erzeugt; entfällt ohne Fehler, wenn eine Voraussetzung fehlt (Fremdwährung, keine IBAN, kein offener Betrag).
- **Self-hosted**: SQLite-Solo ohne Server **oder** PostgreSQL via Docker.
- **Anmeldung**: eingebautes Admin-Konto (scrypt-Hash + signiertes Session-Cookie) — App und API geschützt.

### Status

MVP. Was funktioniert: Stammdaten/Kunden/Produkte, Angebots-/Rechnungsmodell, Entwurf→Festschreiben→Storno, Teilgutschriften, **stufen-getriebenes Mahnwesen mit eingebautem Scheduler (§ 288 BGB)**, **wiederkehrende Rechnungen/Abos**, PDF- + **XRechnung- + ZUGFeRD**-Export, GoBD-Nummernkreis + Audit. Auf der Roadmap: DATEV-Export, B2G/Leitweg-ID, OSS/ZM, Multi-User. Siehe [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) (MVP / Stufe 2 / Stufe 3) und die ehrliche Liste der **[bekannten Einschränkungen](docs/LIMITATIONEN.md)**.

## Dokumentworkflow

Angebot → Auftragsbestätigung → Lieferschein → Rechnung, alles verknüpft:

1. **Angebot** anlegen (Entwurf, editierbar), versenden — Status `DRAFT → SENT`.
2. Auf `ACCEPTED` setzen (oder direkt in eine **Auftragsbestätigung** umwandeln).
3. In einen **Lieferschein** umwandeln (Mengen aus Angebot/AB, Überlieferung blockiert) und/oder in einen **Rechnungsentwurf**.
4. Jede Umwandlung wird als Dokumentverknüpfung gespeichert; die **Dokumentkette** (auf jeder Angebots-/Rechnungs-/Lieferschein-Seite sichtbar) zeigt die volle Historie — Angebot → AB → Lieferschein → Rechnung → Zahlungen/Mahnungen.
5. Der Abrechnungsstand (keine/teilweise/voll) wird aus diesen Verknüpfungen abgeleitet, nicht gespeichert.
6. Statt (oder zusätzlich zu) einer vollen Rechnung: **Teilrechnung** (Prozent/Betrag/einzelne Positionen) oder **Abschlagsrechnung** aus Angebot/AB, danach **Schlussrechnung** — Abschläge samt Steuer werden automatisch abgesetzt (§ 14 Abs. 5 UStG).

Dieselben Aktionen auch per MCP: `convert_document`, `create_delivery_note`, `set_document_status`, `duplicate_document`, `create_partial_invoice`, `create_downpayment_invoice`, `create_final_invoice`, `get_billing_state`. Details: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md), Einschränkungen: [docs/LIMITATIONEN.md](docs/LIMITATIONEN.md).

### Angebot online annehmen lassen

Auf der Angebots-Detailseite (`Dokumente → Angebot`) unter „Annahme-Link" einen Link erzeugen — die URL wird **einmalig** angezeigt (Kopieren-Button), danach nicht mehr abrufbar. Der Kunde öffnet den Link ohne Login, sieht Angebot + PDF-Download und kann annehmen oder ablehnen (Name Pflicht, E-Mail/Kommentar optional). Nach der Entscheidung: Status `ACCEPTED`/`REJECTED`, eine interne Benachrichtigungsmail, und je nach Einstellung (**Einstellungen → Dokumente**) automatisch eine Auftragsbestätigung oder ein Rechnungsentwurf. Der Link kann jederzeit widerrufen werden. Für den Platzhalter `{{offer.link}}` in der Angebots-Mailvorlage `APP_BASE_URL` setzen (`.env`) — sonst bleibt er leer.

## Tech-Stack

Next.js 16 (App Router) · TypeScript (strict) · Prisma 6 · SQLite/PostgreSQL · TailwindCSS · Zod · Vitest.
Geldbeträge als Integer-Cent, Mengen als Integer-Milliunits, Steuer pro EN-16931-Gruppe — siehe [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Schnellstart (Solo / SQLite — kein Server nötig)

```bash
git clone https://github.com/automationsmanufaktur-labs/open-invoice-germany.git
cd open-invoice-germany
npm install
cp .env.example .env            # DATABASE_URL="file:./dev.db" ist Default
npm run db:migrate              # Schema anlegen
npm run db:seed                 # optionale Demo-Daten
npm run dev                     # http://localhost:3000
```

Die SQLite-Datei liegt unter `prisma/dev.db` und gehört nur dir. Beim ersten Start legst du unter **`/setup`** dein Admin-Konto an (nach `npm run db:seed` gibt es einen Demo-Login `admin@example.com` / `demo1234` — bitte ändern). Für **Produktion**: `AUTH_SECRET` in `.env` setzen (`openssl rand -base64 32`) und hinter HTTPS betreiben.

**In der App:** `Einstellungen` (Unternehmen anlegen) → `Kunden` → `Neue Rechnung` → Position erfassen → **Festschreiben** (vergibt die Nummer, macht GoBD-konform unveränderbar) → **PDF**- und **XRechnung**-Export. Komplette Schritt-für-Schritt-Anleitung: **[docs/ANLEITUNG.md](docs/ANLEITUNG.md)**.

## Mit Docker (PostgreSQL + ZUGFeRD-Sidecar)

```bash
cp .env.example .env            # DATABASE_URL auf die postgresql://-Zeile umstellen
docker compose up --build
```

`docker-compose.yml` mountet ein benanntes Volume (`oig-attachments`) unter `/app/data/attachments` für Beleganhänge (`ATTACHMENTS_DIR`); beim Sichern zusammen mit `oig-db` mitnehmen.

**Bestehende Instanz aktualisieren.** Wurde die Datenbank mit einer älteren Version
per `prisma db push` angelegt, fehlt ihr die Migrationshistorie. Der Container
startet dann nicht, sondern nennt den einmalig nötigen Befehl. Vorher ein Backup
ziehen.

**`migrate resolve` nicht blind ausfuehren.** Die Baseline `0_init` bildet den
aktuellen Stand ab, inklusive `RecurringInvoice`, `RecurringInvoiceLine` und
`Invoice.recurringInvoiceId`. Eine ältere Bestandsinstanz kennt diese Tabellen und
Spalten unter Umständen nicht. Wird die Baseline ungeprüft als angewendet
markiert, glaubt Prisma, das Schema sei vollständig, und spätere Abfragen
scheitern mit `column ... does not exist`. Vorher prüfen:

```bash
docker compose run --rm app \
  npx prisma migrate diff --from-url "$DATABASE_URL" \
    --to-schema-datamodel prisma/schema.postgres.prisma --script
```

**Wichtig:** `--to-schema-datamodel` vergleicht gegen den aktuellen Modellstand
(Head), nicht gegen die Baseline `0_init`. Referenz für den Baseline-Stand ist
ausschließlich `prisma/migrations-postgres/0_init/migration.sql`. Der Diff kann
daher auch Tabellen oder Spalten zeigen, die erst in einer **späteren**
Migration unter `prisma/migrations-postgres/` eingeführt wurden (z. B. die
Phase-0-Snapshot-Spalten) — diese gehören **nicht** von Hand eingespielt,
sondern werden nach dem `resolve` automatisch von `migrate deploy` nachgezogen.
Ob eine Spalte/Tabelle zur Baseline gehört, zeigt
`grep -l "<spaltenname>" prisma/migrations-postgres/*/migration.sql`: taucht sie
nur in `0_init` auf, gehört sie zur Baseline; taucht sie (auch) in einer
späteren Migration auf, stammt sie von dort und wird nicht per Hand angelegt.

- **Ausgabe leer** (nur der Kommentar "This is an empty migration"): die
  Datenbank entspricht bereits der Baseline. `migrate resolve --applied 0_init`
  unten ist sicher.
- **Ausgabe enthält nur `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` /
  `CREATE INDEX` / `ALTER TABLE … ADD CONSTRAINT` (Fremdschlüssel)**: nur die
  Anweisungen einspielen, die zu `0_init` gehören (siehe `grep`-Regel oben);
  Anweisungen zu Spalten/Tabellen aus späteren Migrationen weglassen. Geprüftes
  SQL mit `docker compose run --rm app npx prisma db execute --url
  "$DATABASE_URL" --stdin` einspielen, danach mit `migrate resolve` fortfahren.
- **Ausgabe enthält irgendein `DROP`**: abbrechen. Nicht anwenden, kein
  `migrate resolve` ausführen. Die Datenbank enthält Daten, die die Baseline
  nicht kennt — vorher Rücksprache halten.

Ist der Diff sauber (oder wurde eingespielt):

```bash
docker compose run --rm app \
  npx prisma migrate resolve --config prisma.postgres.config.ts --applied 0_init
```

Danach startet der Container normal; künftige Schemaänderungen laufen über
`prisma migrate deploy`.

**Ist ein Migrationseintrag in `_prisma_migrations` als fehlgeschlagen markiert**,
verweigert `migrate deploy` die Ausführung und der Container startet nicht. Das
ist gewollt (fail-closed) statt bei unsicherem Schemazustand einfach
weiterzulaufen. Prüfen, was die Migration teilweise angerichtet hat, dann mit
`prisma migrate resolve --rolled-back <name>` auflösen.

`docker-compose.yml` startet App + PostgreSQL. Der **Mustang**-Sidecar (XRechnung-/ZUGFeRD-Erzeugung & -Validierung) ist ein optionaler, auskommentierter Block (`einvoice-service/` wird nicht mitgeliefert) — siehe Abschnitt oben. Das Postgres-Schema liegt in `prisma/schema.postgres.prisma` (modellidentisch, nur andere Datasource).

## Tests

```bash
npm test          # Vitest: Money, Steuer, Nummernkreis, GoBD-Unveränderbarkeit, Hash-Chain, EN-16931
```

Die Integrationstests beweisen u. a. **lückenlose, unveränderbare Nummernkreise** und dass festgeschriebene Rechnungen nicht editierbar sind.

## E-Rechnung-Validierung

```bash
npm run validate:erechnung      # offizielle Schematron-Regeln, ohne Java
```
Prüft die erzeugte XRechnung gegen die **offiziellen Schematron-Regeln** in purem Node via SaxonJS:
- **EN-16931-UBL-Schematron** (ConnectingEurope) und
- **XRechnung-CIUS / BR-DE** (offizielle KoSIT-Konfiguration 3.0.2; benötigt `unzip`).

Das ist im Kern dieselbe Schematron-Prüfung wie der **[KoSIT-Validator](https://github.com/itplr-kosit/validator)** — und läuft als **harter Gate in der CI**. Der KoSIT-Validator (Java) läuft dort zusätzlich als unabhängiger Cross-Check (deckt auch die vorgelagerte XSD-Prüfung ab). Schnelle Kernregeln sind Teil von `npm test`.

## Mitmachen

Beiträge willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md). Rechtliche Korrekturen bitte mit Quelle (Norm/BMF-Schreiben) gegen [COMPLIANCE.md](COMPLIANCE.md).

## Wartung

Gebaut und gepflegt von [AutomationsManufaktur](https://automationsmanufaktur.de), Bardowick.
Fragen zur E-Rechnungspflicht: info@automationsmanufaktur.de

## Lizenz

**[AGPL-3.0](LICENSE).** Du darfst die Software nutzen, ändern und selbst hosten. Wer sie als Netzwerk-Dienst betreibt, muss den (modifizierten) Quellcode den Nutzern verfügbar machen — so bleibt das Projekt für alle frei. Begründung der Lizenzwahl: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md#3-lizenz-empfehlung).
