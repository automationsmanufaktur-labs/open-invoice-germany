# Rechnungen per Sprache erstellen — mit Claude Code

OpenInvoice Germany bringt einen **MCP-Server** mit. Damit verbindest du deine lokale Instanz mit **Claude Code** (oder Claude Desktop) und erstellst rechtssichere Rechnungen, indem du einfach **sagst, was du willst** — die Daten bleiben komplett bei dir.

> Die Tools setzen auf den GoBD-/EN-16931-gehärteten Kern auf: Das Festschreiben **erzwingt** die § 14-Pflichtangaben, festgeschriebene Rechnungen sind unveränderbar. Die KI kann also keine *nicht*-konforme Rechnung erzeugen.

## 1. Einrichten

```bash
git clone https://github.com/juli1111/open-invoice-germany.git
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
| `get_invoice` / `list_invoices` | Anzeigen/Auflisten |
| `export_invoice` | PDF + XRechnung in Datei + Validierungsreport |

## 4. Was die KI **nicht** kaputt machen kann

- **Festschreiben blockt** bei fehlenden Pflichtangaben (z. B. Leistungsdatum, Steuernummer) und liefert die genaue Liste zurück — Claude ergänzt und versucht es erneut.
- **Festgeschriebene Rechnungen sind unveränderbar** (GoBD) — Korrektur nur per Storno.
- **Steuerschema** (Kleinunternehmer, Reverse Charge …) ergänzt automatisch den Pflichthinweis und weist keine USt aus.

## 5. Grenzen

Siehe [LIMITATIONEN.md](LIMITATIONEN.md) — u. a. keine eingebaute Auth (lokal/Solo betreiben), XRechnung statt ZUGFeRD-Hybrid, Storno-E-Rechnung als Invoice-381. Keine Steuerberatung — [COMPLIANCE.md](../COMPLIANCE.md).
