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
| `record_payment` | Zahlungseingang erfassen → Status (bezahlt/teilbezahlt); optional `note` (Freitext, z. B. „telefonisch avisiert") |
| `create_dunning` | Nächste fällige Mahnstufe erzeugen (frei konfigurierbare Stufen, Verzugszins § 288 BGB + Mahnkosten ab Stufe 2 + 40-€-Pauschale B2B, `force` überspringt die Fälligkeitsprüfung) |
| `send_dunning` | Eine erstellte Mahnung per E-Mail versenden (dieselbe Mailpipeline wie Rechnungen/Angebote) |
| `set_dunning_state` | Mahnprozess einer Rechnung pausieren (mit Datum), beenden oder wieder aktivieren |
| `list_overdue_invoices` | Mahnübersicht: alle überfälligen, offenen Rechnungen (Widgets + Zeilen, Fälligkeits-Aging), optional nach Mahnprozess-Status gefiltert |
| `run_scheduler_job` | Scheduler-Job(s) manuell anstoßen (`dunning`, `recurring`, oder beide — dieselbe Runner-Funktion wie der eingebaute Loop/Cron) |
| `get_invoice` | Anzeigen |
| `list_invoices` | Auflisten mit Filter (Status inkl. wirksamem Status fällig/überfällig, Belegtyp, Kunde, Zeitraum, Betrag, Nummer, Zahlungsart, E-Rechnung, Währung, Freitextsuche, Paginierung) — ersetzt die frühere primitive Version ohne Org-Scoping/Filter |
| `export_invoice` | PDF + XRechnung + ZUGFeRD in Datei + Validierungsreport |
| `create_document` / `list_documents` | Angebot / Auftragsbestätigung / Proforma |
| `convert_document_to_invoice` | Dokument → Rechnungs-Entwurf |
| `convert_document` | Generische Umwandlung: Angebot → AB, Angebot/AB/Proforma → Rechnung, Angebot/AB/Rechnung → Lieferschein (optional Teilmengen) |
| `create_delivery_note` | Lieferschein ohne Quelldokument anlegen (Direktlieferung) |
| `set_document_status` | Status eines Angebots/einer AB oder eines Lieferscheins setzen (MARK_SENT/MARK_ACCEPTED/MARK_REJECTED/MARK_CREATED/MARK_DELIVERED/CANCEL/ARCHIVE/UNARCHIVE) |
| `duplicate_document` | Angebot/AB/Proforma, Lieferschein oder Rechnung als neuen Entwurf duplizieren |
| `create_recurring` / `list_recurring` | Abo / wiederkehrende Rechnung anlegen & auflisten |
| `run_recurring` | Fällige Abo-Rechnungen erzeugen (alle, oder ein Abo sofort) |
| `create_share_link` | Angebots-Annahmelink (ohne Login) erzeugen — liefert die URL einmalig in der Antwort |
| `revoke_share_link` | Angebots-Annahmelink widerrufen |
| `list_share_links` | Annahme-Links eines Angebots auflisten (Status/Aufrufe/Entscheidung, nie der Klartext-Token) |
| `update_invoice_draft` | Rechnungsentwurf bearbeiten (nur `DRAFT`) — Kopffelder (Betreff, Bestellnummer BT-13, interne Referenz, Ansprechpartner, Rechnungs-/Lieferadresse) sowie Positionen inkl. `lineType` (ITEM/HEADING/TEXT/SUBTOTAL); Rechnungstyp bleibt unveränderbar |
| `get_settings` | Einstellungen lesen (`area`: `documents`/`print`/`branding`/`numberRanges`/`dunning`; bei `numberRanges` optional `year`) |
| `update_document_settings` | Belegeinstellungen teilweise aktualisieren (u. a. Fälligkeitstage, Standardwährung, Angebotsgültigkeit, Automatik-Festschreiben/-Versand) — Merge mit dem aktuellen Stand, nicht angegebene Felder bleiben unverändert; ersetzt das frühere `save_document_settings` vollständig |
| `update_print_settings` | Globale Druckoptionen teilweise aktualisieren (Fußzeile, Seitenzahlen, Falz-/Lochmarken, Spalten, GiroCode) — Merge |
| `update_branding_settings` | Briefpapier teilweise aktualisieren (Farbe, Ränder, Schriftgröße, Absender-/Fußzeile) — Merge; `logoPath`/`backgroundPath` werden verworfen, Datei-Upload läuft ausschließlich über die HTTP-Route `/api/settings/branding/upload` |
| `update_number_range` | Einen Nummernkreis aktualisieren (`docType`, Muster/Präfix/Padding/`yearlyReset`/nächste Nummer) — Merge mit dem laufenden Jahr; lehnt ein Zurückdrehen unterhalb bereits vergebener Nummern ab |
| `update_dunning_settings` | Org-weite Mahnwesen-Einstellungen teilweise aktualisieren (Auto-Erstellung/-Versand, Basiszins) — Merge |
| `list_dunning_stages` | Konfigurierte Mahnstufen einer Organisation auflisten |
| `update_dunning_stage` | Eine Mahnstufe teilweise aktualisieren (`id` + Felder) — Merge mit dem aktuellen Stand |
| `add_attachment` / `list_attachments` / `remove_attachment` | Beleganhänge verwalten (Rechnung/Angebot/Lieferschein/Abo/Mahnung) — Upload als Base64, dieselben Grenzen wie im UI (10 MB je Datei, 50 MB je Beleg) |
| `create_partial_invoice` | Teilrechnung aus einem Angebot/einer AB oder einem Lieferschein — Prozent, Netto-/Bruttobetrag, oder einzelne Positionen/Mengen |
| `create_downpayment_invoice` | Abschlagsrechnung vor Leistungserbringung (nur aus Angebot/AB) — Prozent oder Betrag, netto oder brutto; löst § 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG aus |
| `create_final_invoice` | Schlussrechnung über die Gesamtleistung — setzt mindestens eine festgeschriebene, nicht stornierte Abschlagsrechnung voraus; setzt die Abschläge samt darauf entfallender Steuer automatisch ab (§ 14 Abs. 5 UStG) |
| `get_billing_state` | Abrechnungsstand eines Angebots/einer AB (NONE/PARTIAL/FULL, abgerechnetes Promille, Summe der Abschläge) |
| `list_customer_addresses` | Alle Adressen eines Kunden auflisten (Typ Rechnung/Lieferung/Sonstige, Label, Standard-Kennzeichen) |
| `upsert_customer_address` | Adresse anlegen oder ändern (`id` optional — ohne `id` neu, mit `id` Update); `isDefault: true` setzt sie zum Standard des jeweiligen Typs |
| `delete_customer_address` | Adresse löschen (bestehende Beleg-Snapshots bleiben unverändert, Beleg-Referenzen werden auf leer gesetzt) |
| `list_contact_persons` | Alle Ansprechpartner eines Kunden auflisten |
| `upsert_contact_person` | Ansprechpartner anlegen oder ändern (`id` optional); `isDefault: true` setzt ihn zum kundenweiten Standard |
| `delete_contact_person` | Ansprechpartner löschen (analog Adresse) |
| `update_customer_defaults` | Die zehn Kundenvorgaben (Standardwährung, Standard-Rabatt, Rechnungs-/Angebots-E-Mail + CC, E-Rechnung bevorzugt, Bestellreferenz, Liefer-/Zahlungsbedingungstext, Sprache) als **Vollersatz** setzen — ein weggelassenes Feld wird zurückgesetzt |
| `list_custom_fields` | Organisationsweite Kundenfeld-Definitionen auflisten (Schlüssel, Typ, Pflicht, Reihenfolge) |
| `upsert_custom_field` | Kundenfeld-Definition anlegen oder ändern (`id` optional); Schlüssel-Konflikt innerhalb derselben Organisation liefert einen Fehler |
| `set_customer_custom_fields` | Kundenfeldwerte eines Kunden setzen — validiert strikt gegen die aktiven Definitionen (unbekannte Schlüssel werden abgelehnt) |
| `take_over_last_document` | Letzten passenden Vorgängerbeleg (Rechnung/Angebot/AB) eines Kunden finden und daraus Positionen/Texte/Bedingungen/Preise als Vorschlag liefern (§32) — meldet in Klartext, wenn kein Vorgängerbeleg existiert |
| `get_dashboard` | Dashboard-Kennzahlen: offen/fällig/überfällig, „fällig diese Woche", teilbezahlt, Anzahl mahnwürdiger Rechnungen, Aging-Buckets, Umsatz laufender Monat, letzte Belege, offene Angebote |
| `get_customer_overview` | Kunden-KPIs (offen/überfällig/Gesamtumsatz/letzte Aktivität) eines einzelnen Kunden |
| `get_timeline` | Chronologische Historie eines Belegs (`kind`: Rechnung/Angebot/Lieferschein + `doc`-ID) — Anlage, Änderungen, Festschreibung, Versand, Zahlungen, Mahnungen, Statuswechsel |
| `list_notifications` | Benachrichtigungen auflisten (optional nur ungelesen, `limit`) |
| `mark_notifications_read` | Benachrichtigungen als gelesen markieren (einzelne IDs oder alle) |
| `update_recurring_invoice` | Bestehendes Abo teilweise aktualisieren (Titel, Rhythmus inkl. täglich, Start-/Enddatum, maximale Läufe, Zahlungsfrist, Positionen, Auto-Festschreiben/-Versand, E-Mail-Vorlage, Leistungszeitraum-Text) — Merge, kein Kundenwechsel möglich |

## 4. Was die KI **nicht** kaputt machen kann

- **Festschreiben blockt** bei fehlenden Pflichtangaben (z. B. Leistungsdatum, Steuernummer) und liefert die genaue Liste zurück — Claude ergänzt und versucht es erneut.
- **Festgeschriebene Rechnungen sind unveränderbar** (GoBD) — Korrektur nur per Storno.
- **Steuerschema** (Kleinunternehmer, Reverse Charge …) ergänzt automatisch den Pflichthinweis und weist keine USt aus.

## 5. Grenzen

Jede exportierte XRechnung besteht die **offiziellen Schematron-Regeln** (EN-16931 + XRechnung-CIUS/BR-DE) — `npm run validate:erechnung`, via SaxonJS, ohne Java; in CI hart geprüft. Siehe [LIMITATIONEN.md](LIMITATIONEN.md) — u. a. Single-User-Anmeldung (Admin-Konto; Multi-User/Rollen Roadmap), XRechnung statt ZUGFeRD-Hybrid. Keine Steuerberatung — [COMPLIANCE.md](../COMPLIANCE.md).
