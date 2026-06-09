<div align="center">

# OpenInvoice Germany

**Kostenlose, self-hostbare Open-Source-Rechnungssoftware für Deutschland.**
E-Rechnung (XRechnung / ZUGFeRD) · GoBD · § 14 UStG · Kleinunternehmer § 19 · DSGVO

[![CI](https://github.com/juli1111/open-invoice-germany/actions/workflows/ci.yml/badge.svg)](https://github.com/juli1111/open-invoice-germany/actions/workflows/ci.yml)
&nbsp;·&nbsp; Lizenz: **AGPL-3.0** &nbsp;·&nbsp; [English](README.en.md)

</div>

> **Warum?** Ab 2025 gilt die E-Rechnungs-Empfangspflicht im B2B, ab 2027/2028 die Versandpflicht. Viele Selbstständige und KMU zahlen monatlich für Rechnungssoftware, nur um rechtskonform zu bleiben. Dieses Projekt macht das **kostenlos und frei** — du hostest es selbst, deine Daten bleiben bei dir.

> ⚠️ **Keine Steuer- oder Rechtsberatung.** GoBD-Konformität erfordert zusätzlich eine Verfahrensdokumentation des Anwenders. Alle rechtlichen Grundlagen mit Quellen stehen in **[COMPLIANCE.md](COMPLIANCE.md)** (Single Source of Truth). Ohne Gewähr.

---

## 🗣️ Mit Claude Code per Sprache (MCP)

Verbinde deine lokale Instanz mit **Claude Code** oder Claude Desktop und erstelle rechtssichere Rechnungen, indem du sie einfach beschreibst:

> „Erstelle eine Rechnung an Müller GmbH über 3 Stunden Beratung à 95 €, Leistung heute, schreib sie fest und exportier die XRechnung."

Claude ruft die passenden Tools auf (Kunde/Leistung anlegen → Rechnung → festschreiben → PDF + XRechnung). Das Festschreiben **erzwingt** die § 14-Pflichtangaben — nicht-konforme Rechnungen sind ausgeschlossen, alles bleibt lokal. Setup + Beispiele: **[docs/MCP.md](docs/MCP.md)**.

```bash
npm run mcp   # MCP-Server (stdio) starten / in Claude Code via .mcp.json einbinden
```

## Funktionen

- **Sprachsteuerung via MCP** (Claude Code/Desktop) — siehe oben.
- **GoBD-Kern**: Festschreibung (Entwurf → unveränderbar), lückenlose Nummernkreise, append-only Audit-**Hash-Chain**, Storno statt Löschung.
- **§ 14 UStG**: Pflichtangaben-Prüfung blockt das Festschreiben bei fehlenden Angaben.
- **Steuerschemata**: Regelbesteuerung (19/7/0), Kleinunternehmer (§ 19), Reverse Charge (§ 13b), ig. Lieferung, Differenzbesteuerung (§ 25a), Kleinbetrag (§ 33).
- **E-Rechnung**: **XRechnung** (UBL, EN 16931) — Export inkl. EN-16931-Kernregel-Validierung. ZUGFeRD/Factur-X über Mustang-Sidecar (Docker).
- **PDF-Export** ("sonstige Rechnung") mit allen Pflichtangaben.
- **Self-hosted**: SQLite-Solo ohne Server **oder** PostgreSQL via Docker.

### Status

MVP. Was funktioniert: Stammdaten/Kunden/Produkte, Angebots-/Rechnungsmodell, Entwurf→Festschreiben→Storno, PDF- + XRechnung-Export, GoBD-Nummernkreis + Audit. Auf der Roadmap: Mahnwesen-UI, wiederkehrende Rechnungen, ZUGFeRD-Hybrid, DATEV-Export, B2G/Leitweg-ID, OSS/ZM, Multi-User. Siehe [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md) (MVP / Stufe 2 / Stufe 3) und die ehrliche Liste der **[bekannten Einschränkungen](docs/LIMITATIONEN.md)**.

## Tech-Stack

Next.js 16 (App Router) · TypeScript (strict) · Prisma 6 · SQLite/PostgreSQL · TailwindCSS · Zod · Vitest.
Geldbeträge als Integer-Cent, Mengen als Integer-Milliunits, Steuer pro EN-16931-Gruppe — siehe [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md).

## Schnellstart (Solo / SQLite — kein Server nötig)

```bash
git clone https://github.com/juli1111/open-invoice-germany.git
cd open-invoice-germany
npm install
cp .env.example .env            # DATABASE_URL="file:./dev.db" ist Default
npm run db:migrate              # Schema anlegen
npm run db:seed                 # optionale Demo-Daten
npm run dev                     # http://localhost:3000
```

Die SQLite-Datei liegt unter `prisma/dev.db` und gehört nur dir.

**In der App:** `Einstellungen` (Unternehmen anlegen) → `Kunden` → `Neue Rechnung` → Position erfassen → **Festschreiben** (vergibt die Nummer, macht GoBD-konform unveränderbar) → **PDF**- und **XRechnung**-Export. Komplette Schritt-für-Schritt-Anleitung: **[docs/ANLEITUNG.md](docs/ANLEITUNG.md)**.

## Mit Docker (PostgreSQL + ZUGFeRD-Sidecar)

```bash
cp .env.example .env            # DATABASE_URL auf die postgresql://-Zeile umstellen
docker compose up --build
```

`docker-compose.yml` startet App + PostgreSQL + den **Mustang**-Sidecar (XRechnung-/ZUGFeRD-Erzeugung & -Validierung). Das Postgres-Schema liegt in `prisma/schema.postgres.prisma` (modellidentisch, nur andere Datasource).

## Tests

```bash
npm test          # Vitest: Money, Steuer, Nummernkreis, GoBD-Unveränderbarkeit, Hash-Chain, EN-16931
```

Die Integrationstests beweisen u. a. **lückenlose, unveränderbare Nummernkreise** und dass festgeschriebene Rechnungen nicht editierbar sind.

## E-Rechnung-Validierung

- **Lokal / im Test**: EN-16931-Kernregeln (Pflichtfelder + Rechenregeln BR-CO-*) in reinem JavaScript — kein Java nötig.
- **Im CI (autoritativ)**: der offizielle **[KoSIT-Validator](https://github.com/itplr-kosit/validator)** prüft eine erzeugte XRechnung gegen die EN-16931-/XRechnung-Schematron-Regeln (siehe `.github/workflows/ci.yml`). Versions-Pins ggf. anpassen.

## Mitmachen

Beiträge willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md). Rechtliche Korrekturen bitte mit Quelle (Norm/BMF-Schreiben) gegen [COMPLIANCE.md](COMPLIANCE.md).

## Lizenz

**[AGPL-3.0](LICENSE).** Du darfst die Software nutzen, ändern und selbst hosten. Wer sie als Netzwerk-Dienst betreibt, muss den (modifizierten) Quellcode den Nutzern verfügbar machen — so bleibt das Projekt für alle frei. Begründung der Lizenzwahl: [docs/ARCHITEKTUR.md](docs/ARCHITEKTUR.md#3-lizenz-empfehlung).
