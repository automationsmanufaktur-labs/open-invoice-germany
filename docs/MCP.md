# Rechnungen per Sprache erstellen — mit Claude Code

OpenInvoice Germany bringt einen **MCP-Server** mit. Damit verbindest du deine lokale Instanz mit **Claude Code** (oder Claude Desktop) und erstellst rechtssichere Rechnungen, indem du einfach **sagst, was du willst**.

> Die Tools setzen auf den GoBD-/EN-16931-gehärteten Kern auf: Das Festschreiben **erzwingt** die § 14-Pflichtangaben, festgeschriebene Rechnungen sind unveränderbar. Die KI kann also keine *nicht*-konforme Rechnung erzeugen.

## 🔒 Datenschutz (DSGVO) — bevor du echte Kundendaten nutzt

Der **Rechnungs-Kern von OpenInvoice läuft zu 100 % lokal** (deine Datenbank, dein Rechner). Das MCP-Feature ist **optional**.

Sobald du eine Rechnung von einem **Cloud-LLM** (z. B. Claude) erstellen lässt, werden die Inhalte, die du beschreibst — Kundenname, Adresse, Leistungen, Beträge = **personenbezogene Daten** — an den LLM-Anbieter **übermittelt** und dort in deinem Auftrag verarbeitet (**Auftragsverarbeitung, Art. 28 DSGVO**). Der „lokal"-Charakter gilt also für die App, **nicht** automatisch für den KI-Pfad.

Für den geschäftlichen Einsatz mit echten Personendaten gibt es zwei saubere Wege:

| Weg | Datenfluss | DSGVO-Status |
|-----|-----------|--------------|
| **Lokales Modell** — den MCP-Server von einem MCP-Client betreiben lassen, der ein **lokales Modell** nutzt (z. B. via Ollama/LM Studio); MCP ist anbieterneutral | bleibt auf deinem Rechner | kein Drittanbieter, kein AVV nötig |
| **Cloud-LLM mit AVV** — z. B. die **Claude API** (Anthropic Commercial Terms: DPA inklusive, kein Training, SCCs für den US-Transfer) | geht an den Anbieter | AVV vorhanden; Anbieter als Sub-Auftragsverarbeiter dokumentieren |

> ⚠️ **Claude Code / Claude Desktop** routen immer an die Anthropic-Cloud. Das **Consumer-Abo (Claude Pro/Max) hat keinen AVV** und ist für fremde Personendaten nicht geeignet — wer Claude nutzen will, sollte den **API-Zugang** (Commercial Terms) verwenden. Für einen rein lokalen Datenfluss einen MCP-Client mit lokalem Modell wählen.

Nimm den genutzten LLM-Anbieter in dein **Verzeichnis von Verarbeitungstätigkeiten** und deine **Datenschutzerklärung** auf. Dies ist **keine Rechtsberatung**; rechtliche Grundlagen in [COMPLIANCE.md](../COMPLIANCE.md).

## 1. Einrichten

```bash
git clone https://github.com/automationsmanufaktur-labs/open-invoice-germany.git
cd open-invoice-germany
npm install
cp .env.example .env
npm run db:migrate
```

Teste den Server kurz: `npm run mcp` (er meldet „MCP-Server bereit" auf stderr; mit Strg+C beenden).

### In Claude Code registrieren

Lege im Projekt (oder global) eine `.mcp.json` an — **absoluten Pfad** einsetzen:

```json
{
  "mcpServers": {
    "open-invoice-germany": {
      "command": "npx",
      "args": ["tsx", "src/mcp/server.ts"],
      "cwd": "/ABSOLUTER/PFAD/zu/open-invoice-germany"
    }
  }
}
```

In Claude Code mit `/mcp` prüfen, dass `open-invoice-germany` verbunden ist. (Claude Desktop: denselben Block in die `claude_desktop_config.json` eintragen.)

## 2. So redest du mit ihm

> **„Richte mein Unternehmen ein: Müller Handwerk GmbH, Lindenstr. 5, 21337 Lüneburg, Steuernummer 33/123/45678, IBAN DE02 1203 0000 0000 2020 51."**

> **„Leg den Kunden ‚Sparkasse Lüneburg' an, Adresse An der Münze 4–6, 21335 Lüneburg, USt-IdNr. DE811…"**

> **„Speichere die Leistung ‚Beratung' zu 95 € pro Stunde."**

> **„Erstelle eine Rechnung an Müller über 3 Stunden Beratung, Leistung heute — und schreib sie fest."**

> **„Exportier die XRechnung und das PDF."**

> **„Leg einen monatlichen Wartungsvertrag für Müller über 99 € an, ab dem 1. des nächsten Monats, und schreib die Rechnungen automatisch fest."**

> **„Welche Abos sind fällig? Erzeuge die fälligen Rechnungen."**

Claude ruft im Hintergrund die passenden Tools auf (`setup_company` → `upsert_customer` → `upsert_product` → `create_invoice` → `finalize_invoice` → `export_invoice`) und legt die Dateien unter `exports/` ab — inkl. EN-16931-Validierung.

## 3. Verfügbare Tools

| Tool | Zweck |
|---|---|
| `get_status` | Zustand (Unternehmen eingerichtet? Zähler) |
| `setup_company` | Eigene Stammdaten anlegen/ändern (§ 14-Pflichtangaben) |
| `list_customers` / `upsert_customer` | Kunden verwalten |
| `list_products` / `upsert_product` | Leistungen/Produkte im Katalog speichern |
| `create_invoice` | Rechnung als Entwurf (Kunde per Name, Positionen in €/Menge oder via gespeicherter Leistung) |
| `finalize_invoice` | Festschreiben — prüft Pflichtangaben, vergibt Nummer, macht unveränderbar |
| `cancel_invoice` | Storno-Gutschrift (Original bleibt erhalten) |
| `credit_invoice` | Teilgutschrift / Teilerstattung (Original bleibt festgeschrieben) |
| `record_payment` | Zahlungseingang erfassen → Status (bezahlt/teilbezahlt) |
| `create_dunning` | Nächste Mahnstufe (Zahlungserinnerung → 1./2. Mahnung, Verzugszins § 288 BGB + 40-€-Pauschale B2B) |
| `get_invoice` / `list_invoices` | Anzeigen/Auflisten |
| `export_invoice` | PDF + XRechnung + ZUGFeRD in Datei + Validierungsreport |
| `create_document` / `list_documents` | Angebot / Auftragsbestätigung / Proforma |
| `convert_document_to_invoice` | Dokument → Rechnungs-Entwurf |
| `create_recurring` / `list_recurring` | Abo / wiederkehrende Rechnung anlegen & auflisten |
| `run_recurring` | Fällige Abo-Rechnungen erzeugen (alle, oder ein Abo sofort) |

## 4. Was die KI **nicht** kaputt machen kann

- **Festschreiben blockt** bei fehlenden Pflichtangaben (z. B. Leistungsdatum, Steuernummer) und liefert die genaue Liste zurück — Claude ergänzt und versucht es erneut.
- **Festgeschriebene Rechnungen sind unveränderbar** (GoBD) — Korrektur nur per Storno.
- **Steuerschema** (Kleinunternehmer, Reverse Charge …) ergänzt automatisch den Pflichthinweis und weist keine USt aus.

## 5. Grenzen

Jede exportierte XRechnung besteht die **offiziellen Schematron-Regeln** (EN-16931 + XRechnung-CIUS/BR-DE) — `npm run validate:erechnung`, via SaxonJS, ohne Java; in CI hart geprüft. Siehe [LIMITATIONEN.md](LIMITATIONEN.md) — u. a. Single-User-Anmeldung (Admin-Konto; Multi-User/Rollen Roadmap), XRechnung statt ZUGFeRD-Hybrid. Keine Steuerberatung — [COMPLIANCE.md](../COMPLIANCE.md).
