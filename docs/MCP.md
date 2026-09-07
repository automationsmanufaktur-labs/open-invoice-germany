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

Claude ruft im Hintergrund die passenden Tools auf (`setup_company` → `upsert_customer` → `upsert_product` → `create_invoice` → `finalize_invoice` → `export_invoice`) und legt die Dateien unter `exports/` ab — inkl. EN-16931-Validierung. Weitere Beispiele wie im Lastenheft (§55) gefordert: siehe [ANLEITUNG.md](ANLEITUNG.md#7-per-sprache-mit-claude-code-mcp).

## 3. Verfügbare Tools

80 Tools, registriert in `src/mcp/server.ts` über 12 Bereichsmodule unter `src/mcp/tools/` (siehe [ARCHITEKTUR.md](ARCHITEKTUR.md) für die Modulstruktur). Alle Tools rufen dieselben Domain-Funktionen und Zod-Schemas wie UI/API auf — keine Bypass-Pfade (§55).

### System

| Tool | Zweck | Beispiel |
|---|---|---|
| `get_status` | Zustand der aktiven Organisation (Unternehmen eingerichtet? Kunden-/Produkt-/Rechnungszähler) | „Wie ist der Status meiner Instanz?" |
| `setup_company` | Eigene Stammdaten anlegen/ändern (§ 14-Pflichtangaben: Name, Anschrift, Steuernummer/USt-IdNr., IBAN) | „Richte mein Unternehmen ein: Müller Handwerk GmbH, Lindenstr. 5, 21337 Lüneburg, Steuernummer 33/123/45678." |

### Kunden

| Tool | Zweck | Beispiel |
|---|---|---|
| `list_customers` | Kunden auflisten | „Zeig mir alle Kunden." |
| `upsert_customer` | Kunde anlegen oder aktualisieren — Match per exaktem Namen (kein `id`-Parameter); gezieltes Ändern per ID: `update_customer` | „Leg den Kunden ‚Sparkasse Lüneburg' an, Adresse An der Münze 4–6, 21335 Lüneburg." |
| `update_customer` | Kunde gezielt per ID/Name patchen (anders als `upsert_customer` **kein** Anlegen; nur angegebene Felder ändern sich) | „Ändere bei Müller GmbH die E-Mail auf buchhaltung@mueller.de." |
| `archive_customer` | Kunde archivieren (verschwindet aus `list_customers`/Picker, bleibt in Beleg-Snapshots erhalten) | „Archiviere den Kunden Alt-Kunde GmbH." |
| `get_customer_overview` | Kunden-KPIs (offen/überfällig/Gesamtumsatz/letzte Aktivität) eines einzelnen Kunden | „Wie ist der Kontostand von Müller GmbH?" |
| `list_customer_addresses` | Alle Adressen eines Kunden auflisten (Typ Rechnung/Lieferung/Sonstige, Standard-Kennzeichen) | „Welche Adressen hat Müller GmbH hinterlegt?" |
| `upsert_customer_address` | Adresse anlegen (`id` weglassen) oder ändern (`id` angeben); `isDefault: true` setzt sie zum Standard des Typs | „Leg für Müller GmbH eine Lieferadresse an: Hafenstr. 2, 21335 Lüneburg." |
| `delete_customer_address` | Adresse löschen (bestehende Beleg-Snapshots bleiben unverändert) | „Lösche die alte Lieferadresse von Müller GmbH." |
| `set_default_address` | Zusatzadresse als Default ihres Typs setzen (verdrängt den bisherigen Default) | „Setze die Hafenstraße als Standard-Lieferadresse von Müller GmbH." |
| `list_contact_persons` | Alle Ansprechpartner eines Kunden auflisten | „Wer sind die Ansprechpartner bei Müller GmbH?" |
| `upsert_contact_person` | Ansprechpartner anlegen (`id` weglassen) oder ändern (`id` angeben); `isDefault: true` setzt ihn zum kundenweiten Standard | „Leg Frau Meyer als Ansprechpartnerin bei Müller GmbH an." |
| `delete_contact_person` | Ansprechpartner löschen | „Lösche Herrn Schmidt als Ansprechpartner bei Müller GmbH." |
| `set_default_contact` | Ansprechpartner als kundenweiten Default setzen | „Setze Frau Meyer als Standard-Ansprechpartnerin bei Müller GmbH." |
| `update_customer_defaults` | Die zehn Kundenvorgaben (Standardwährung, Standard-Rabatt, Rechnungs-/Angebots-E-Mail + CC, E-Rechnung bevorzugt, Bestellreferenz, Liefer-/Zahlungsbedingungstext, Sprache) als **Vollersatz** setzen — weggelassene Felder werden zurückgesetzt | „Setze bei Müller GmbH einen Standard-Rabatt von 5 % und XRechnung als bevorzugtes Format." |
| `list_custom_fields` | Organisationsweite Kundenfeld-Definitionen auflisten (Schlüssel, Typ, Pflicht, Reihenfolge) | „Welche eigenen Kundenfelder habe ich definiert?" |
| `upsert_custom_field` | Kundenfeld-Definition anlegen (`id` weglassen) oder ändern (`id` angeben); Schlüssel-Konflikt liefert Fehler | „Leg ein Kundenfeld ‚Kundennummer im alten System' vom Typ Text an." |
| `delete_custom_field` | Kundenfeld-Definition löschen (bereits gespeicherte Werte bleiben im JSON stehen, werden aber still ignoriert) | „Lösche das Kundenfeld ‚Fax-Nummer'." |
| `reorder_custom_fields` | Reihenfolge aller Kundenfeld-Definitionen neu setzen (`ids` muss genau die vorhandene Menge enthalten) | „Sortiere die Kundenfelder so, dass ‚Kundennummer im alten System' zuerst kommt." |
| `set_customer_custom_fields` | Kundenfeldwerte eines Kunden setzen — validiert strikt gegen die aktiven Definitionen (unbekannte Schlüssel werden abgelehnt) | „Setze bei Müller GmbH das Kundenfeld ‚Kundennummer im alten System' auf 4711." |

### Produkte

| Tool | Zweck | Beispiel |
|---|---|---|
| `list_products` | Leistungen/Produkte im Katalog auflisten | „Zeig mir alle gespeicherten Leistungen." |
| `upsert_product` | Produkt anlegen oder aktualisieren — Match per exaktem Namen (kein `id`-Parameter, inkl. §25a Differenzbesteuerung); gezieltes Ändern per ID: `update_product` | „Speichere die Leistung ‚Beratung' zu 95 € pro Stunde." |
| `update_product` | Produkt gezielt per ID/Name patchen (anders als `upsert_product` **kein** Anlegen) | „Ändere den Preis von ‚Beratung' auf 105 € pro Stunde." |
| `archive_product` | Produkt archivieren (verschwindet aus `list_products`/Picker, bleibt in Beleg-Snapshots erhalten) | „Archiviere die Leistung ‚Altprodukt'." |

### Angebote / Auftragsbestätigungen / Lieferscheine

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_document` | Angebot / Auftragsbestätigung / Proforma anlegen | „Erstelle für Müller GmbH ein Angebot über 10 Stunden Beratung zu 95 Euro." |
| `list_documents` | Angebote/AB/Proformas auflisten (Filter u. a. Status, Kunde) | „Welche Angebote sind noch offen?" |
| `get_quote` | Details eines Angebots/einer AB/Proforma anzeigen | „Zeig mir Angebot ANG-2026-00123." |
| `get_delivery_note` | Details eines Lieferscheins anzeigen | „Zeig mir Lieferschein LS-2026-00045." |
| `convert_document_to_invoice` | Dokument → Rechnungs-Entwurf | „Erstelle aus Angebot ANG-2026-00123 eine Rechnung." |
| `convert_document` | Generische Umwandlung: Angebot → AB, Angebot/AB/Proforma → Rechnung, Angebot/AB/Rechnung → Lieferschein (optional Teilmengen) | „Erzeuge aus Angebot ANG-2026-00123 eine Auftragsbestätigung." |
| `create_delivery_note` | Lieferschein ohne Quelldokument anlegen (Direktlieferung) | „Erstelle aus dem Auftrag einen Lieferschein." |
| `set_document_status` | Status eines Angebots/einer AB oder eines Lieferscheins setzen (MARK_SENT/MARK_ACCEPTED/MARK_REJECTED/MARK_CREATED/MARK_DELIVERED/CANCEL/ARCHIVE/UNARCHIVE) | „Markiere Angebot ANG-2026-00123 als angenommen." |
| `duplicate_document` | Angebot/AB/Proforma, Lieferschein oder Rechnung als neuen Entwurf duplizieren | „Dupliziere Angebot ANG-2026-00123 als neuen Entwurf." |
| `take_over_last_document` | Letzten passenden Vorgängerbeleg eines Kunden finden und daraus Positionen/Texte/Bedingungen/Preise als Vorschlag liefern (§32) | „Übernimm die Positionen aus dem letzten Angebot an Müller GmbH." |

### Rechnungen

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_invoice` | Rechnung als Entwurf (Kunde per Name, Positionen in €/Menge oder via gespeicherter Leistung) | „Erstelle eine Rechnung an Müller über 3 Stunden Beratung, Leistung heute." |
| `finalize_invoice` | Festschreiben — prüft Pflichtangaben, vergibt Nummer, macht unveränderbar | „Schreib die Rechnung fest." |
| `update_invoice_draft` | Rechnungsentwurf bearbeiten (nur `DRAFT`) — Kopffelder (Betreff, Bestellnummer BT-13, interne Referenz, Ansprechpartner, Rechnungs-/Lieferadresse) sowie Positionen inkl. `lineType`; Rechnungstyp bleibt unveränderbar | „Setze bei der Entwurfsrechnung die Bestellnummer auf PO-4711." |
| `get_invoice` | Rechnung anzeigen | „Zeig mir Rechnung RE-2026-00342." |
| `list_invoices` | Auflisten mit Filter (Status inkl. wirksamem Status fällig/überfällig, Belegtyp, Kunde, Zeitraum, Betrag, Nummer, Zahlungsart, E-Rechnung, Währung, Freitextsuche, Paginierung) | „Welche Rechnungen sind überfällig?" |
| `export_invoice` | PDF + XRechnung + ZUGFeRD in Datei (`exports/`) + Validierungsreport | „Exportier die XRechnung und das PDF." |
| `credit_invoice` | Teilgutschrift / Teilerstattung (Original bleibt festgeschrieben) | „Erstelle eine Teilgutschrift über 50 Euro zu RE-2026-00342." |
| `cancel_invoice` | Storno-Gutschrift (Original bleibt erhalten) | „Storniere RE-2026-00342." |

### Teil-/Abschlags-/Schlussrechnungen

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_partial_invoice` | Teilrechnung aus einem Angebot/einer AB oder einem Lieferschein — Prozent, Netto-/Bruttobetrag, oder einzelne Positionen/Mengen | „Erstelle eine Teilrechnung über 30 Prozent aus Angebot ANG-2026-00123." |
| `create_downpayment_invoice` | Abschlagsrechnung vor Leistungserbringung (nur aus Angebot/AB) — löst § 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG aus | „Erstelle eine Abschlagsrechnung über 30 Prozent." |
| `create_final_invoice` | Schlussrechnung über die Gesamtleistung — setzt mindestens eine festgeschriebene, nicht stornierte Abschlagsrechnung voraus; setzt die Abschläge samt Steuer automatisch ab (§ 14 Abs. 5 UStG) | „Erstelle die Schlussrechnung für den Auftrag von Müller GmbH." |
| `get_billing_state` | Abrechnungsstand eines Angebots/einer AB (NONE/PARTIAL/FULL, abgerechnetes Promille, Summe der Abschläge) | „Wie viel ist von Angebot ANG-2026-00123 schon abgerechnet?" |

### Zahlungen

| Tool | Zweck | Beispiel |
|---|---|---|
| `record_payment` | Zahlungseingang erfassen → Status (bezahlt/teilbezahlt); optional `note` (Freitext) | „Buche auf RE-2026-00342 eine Zahlung von 500 Euro." |
| `list_payment_methods` | Zahlungsmethoden der Organisation auflisten (Code, Name, Zahlungsziel, aktiv/System) — nützlich für Codes bei `create_invoice`/`record_payment` | „Welche Zahlungsmethoden habe ich hinterlegt?" |

### Mahnwesen

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_dunning` | Nächste fällige Mahnstufe erzeugen (Verzugszins § 288 BGB + Mahnkosten ab Stufe 2 + 40-€-Pauschale B2B, `force` überspringt die Fälligkeitsprüfung) | „Erstelle die nächste Mahnstufe." |
| `send_dunning` | Eine erstellte Mahnung per E-Mail versenden (dieselbe Mailpipeline wie Rechnungen/Angebote) | „Sende für RE-2026-00342 eine Zahlungserinnerung." |
| `set_dunning_state` | Mahnprozess einer Rechnung pausieren (mit Datum), beenden oder wieder aktivieren | „Pausiere den Mahnprozess für RE-2026-00342 bis Monatsende." |
| `list_overdue_invoices` | Mahnübersicht: alle überfälligen, offenen Rechnungen (Widgets + Zeilen, Fälligkeits-Aging), optional nach Mahnprozess-Status gefiltert | „Welche Rechnungen sind überfällig?" |
| `list_dunning_stages` | Konfigurierte Mahnstufen einer Organisation auflisten | „Zeig mir meine Mahnstufen." |
| `update_dunning_stage` | Eine Mahnstufe teilweise aktualisieren (`id` + Felder) — Merge mit dem aktuellen Stand | „Setze bei Mahnstufe 2 die Mahnkosten auf 8 Euro." |

### E-Mail

| Tool | Zweck | Beispiel |
|---|---|---|
| `send_email` | Beleg (Angebot/AB/Proforma, Rechnung/Gutschrift, Lieferschein, Mahnung) per E-Mail versenden — `docId` per Nummer oder ID, Betreff/Text/Empfänger frei wählbar. Ein Rechnungs-/Gutschrift-**Entwurf** wird je nach Einstellung `autoFinalizeOnSend` (§33) vor dem Versand automatisch festgeschrieben oder unverändert als Entwurf verschickt | „Sende RE-2026-00342 per E-Mail an buchhaltung@mueller.de." |

### Dateien

| Tool | Zweck | Beispiel |
|---|---|---|
| `get_document_file` | Beleg (Rechnung/Angebot-AB-Proforma/Lieferschein/Mahnung) als Base64-Datei zurückgeben — PDF für alle vier Belegarten, XRechnung/ZUGFeRD nur für festgeschriebene Rechnungen (`kind=INVOICE`); Antworten über 10 MB werden abgelehnt | „Gib mir das PDF von Angebot ANG-2026-00123 als Datei." |

### Anhänge

| Tool | Zweck | Beispiel |
|---|---|---|
| `add_attachment` | Beleganhang hochladen (Rechnung/Angebot/Lieferschein/Abo/Mahnung), Dateiinhalt als Base64, gleiche Grenzen wie im UI (10 MB je Datei, 50 MB je Beleg) | „Hänge dieses PDF als Anhang an RE-2026-00342 an." |
| `list_attachments` | Anhänge eines Belegs auflisten | „Welche Anhänge hat RE-2026-00342?" |
| `remove_attachment` | Anhang von einem Beleg entfernen | „Entferne den zweiten Anhang von RE-2026-00342." |

### Einstellungen

| Tool | Zweck | Beispiel |
|---|---|---|
| `get_settings` | Einstellungen lesen (`area`: `documents`/`print`/`branding`/`numberRanges`/`dunning`; bei `numberRanges` optional `year`) | „Zeig mir meine Beleg-Einstellungen." |
| `update_document_settings` | Belegeinstellungen teilweise aktualisieren (u. a. Fälligkeitstage, Standardwährung, Angebotsgültigkeit, Automatik-Festschreiben/-Versand) — Merge | „Setze die Fälligkeitstage für Rechnungen auf 14." |
| `update_print_settings` | Globale Druckoptionen teilweise aktualisieren (Fußzeile, Seitenzahlen, Falz-/Lochmarken, Spalten, GiroCode) — Merge | „Aktiviere den GiroCode auf Rechnungen." |
| `update_branding_settings` | Briefpapier teilweise aktualisieren (Farbe, Ränder, Schriftgröße, Absender-/Fußzeile) — Merge; Logo-Upload nur über die HTTP-Route | „Setze die Akzentfarbe im Briefpapier auf #1A237E." |
| `update_number_range` | Einen Nummernkreis aktualisieren (`docType`, Muster/Präfix/Padding/`yearlyReset`/nächste Nummer) — Merge mit dem laufenden Jahr; lehnt ein Zurückdrehen unterhalb bereits vergebener Nummern ab | „Setze das Rechnungspräfix auf RE-2026-." |
| `update_dunning_settings` | Org-weite Mahnwesen-Einstellungen teilweise aktualisieren (Auto-Erstellung/-Versand, Basiszins) — Merge | „Aktiviere automatischen Mahnungsversand." |
| `set_print_options` | Beleg-individuelle Überschreibung der globalen Druckoptionen (§36) setzen — nur solange der Beleg noch `DRAFT` ist; ersetzt die bisherige Überschreibung (kein Merge) | „Schalte für diese eine Rechnung die Seitenzahlen aus." |

### API-Schluessel

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_api_key` | Neuen API-Schluessel fuer `/api/v1` erzeugen (Name, Scopes read/write/send/admin, optional Ablauf) — das Klartext-Token wird NUR in dieser Antwort angezeigt | „Erzeuge einen API-Schluessel ‚Buchhaltung' mit Lese- und Schreibrechten." |
| `revoke_api_key` | API-Schluessel unwiderruflich widerrufen (idempotent) | „Widerrufe den API-Schluessel ‚Buchhaltung'." |
| `list_api_keys` | API-Schluessel auflisten (Name, Praefix, Scopes, zuletzt genutzt, Ablauf, Widerruf) — nie das Klartext-Token | „Welche API-Schluessel gibt es?" |

### Webhooks

| Tool | Zweck | Beispiel |
|---|---|---|
| `list_webhooks` | Webhook-Endpunkte auflisten (URL, abonnierte Ereignisse, aktiv) — nie das Secret | „Welche Webhooks sind eingerichtet?" |
| `upsert_webhook` | Webhook-Endpunkt anlegen oder aendern (URL, Events, aktiv) — Klartext-Secret nur bei Neuanlage/Rotation sichtbar | „Lege einen Webhook auf https://example.com/hook fuer invoice.finalized und payment.recorded an." |
| `test_webhook` | Synthetische Test-Zustellung an einen Endpunkt senden und Ergebnis melden | „Teste den Webhook ‚https://example.com/hook'." |
| `replay_webhook_delivery` | Eine bestehende Zustellung als NEUE Zustellung erneut versuchen (Original bleibt unveraendert) | „Wiederhole die fehlgeschlagene Zustellung xyz." |

### Abos (wiederkehrende Rechnungen)

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_recurring` | Abo / wiederkehrende Rechnung anlegen | „Leg einen monatlichen Wartungsvertrag für Müller über 99 € an, ab dem 1. des nächsten Monats." |
| `list_recurring` | Abos auflisten (Filter u. a. Status) | „Welche Abos sind fällig?" |
| `run_recurring` | Fällige Abo-Rechnungen erzeugen (alle, oder ein Abo sofort) | „Erzeuge die fälligen Rechnungen." |
| `update_recurring_invoice` | Bestehendes Abo teilweise aktualisieren (Titel, Rhythmus inkl. täglich, Start-/Enddatum, maximale Läufe, Zahlungsfrist, Positionen, Auto-Festschreiben/-Versand, E-Mail-Vorlage, Leistungszeitraum-Text) — Merge, kein Kundenwechsel möglich | „Ändere beim Wartungsvertrag von Müller den Preis auf 109 €." |
| `set_recurring_state` | Status eines Abos auf `ACTIVE`/`PAUSED`/`ENDED` setzen (dünner Wrapper um `update_recurring_invoice`) | „Pausiere den Wartungsvertrag von Müller GmbH." |

### Scheduler

| Tool | Zweck | Beispiel |
|---|---|---|
| `run_scheduler_job` | Scheduler-Job(s) manuell anstoßen (`dunning`, `recurring`, oder beide — dieselbe Runner-Funktion wie der eingebaute Loop/Cron) | „Führe jetzt den Mahnlauf aus." |

### Dashboard, Timeline, Benachrichtigungen

| Tool | Zweck | Beispiel |
|---|---|---|
| `get_dashboard` | Dashboard-Kennzahlen: offen/fällig/überfällig, „fällig diese Woche", teilbezahlt, Anzahl mahnwürdiger Rechnungen, Aging-Buckets, Umsatz laufender Monat, letzte Belege, offene Angebote | „Wie ist die Lage — was ist offen und überfällig?" |
| `get_timeline` | Chronologische Historie eines Belegs (`kind`: Rechnung/Angebot/Lieferschein + `doc`-ID) — Anlage, Änderungen, Festschreibung, Versand, Zahlungen, Mahnungen, Statuswechsel | „Zeig mir die Historie von RE-2026-00342." |
| `list_notifications` | Benachrichtigungen auflisten (optional nur ungelesen, `limit`) | „Welche ungelesenen Benachrichtigungen habe ich?" |
| `mark_notifications_read` | Benachrichtigungen als gelesen markieren (einzelne IDs oder alle) | „Markiere alle Benachrichtigungen als gelesen." |

### Freigabelinks (Angebots-Annahme)

| Tool | Zweck | Beispiel |
|---|---|---|
| `create_share_link` | Angebots-Annahmelink (ohne Login) erzeugen — liefert die URL einmalig in der Antwort | „Erstelle einen Annahmelink für Angebot ANG-2026-00123." |
| `list_share_links` | Annahme-Links eines Angebots auflisten (Status/Aufrufe/Entscheidung, nie der Klartext-Token) | „Welche Annahmelinks gibt es für Angebot ANG-2026-00123?" |
| `revoke_share_link` | Angebots-Annahmelink widerrufen | „Widerrufe den Annahmelink für Angebot ANG-2026-00123." |

## 4. Was die KI **nicht** kaputt machen kann

- **Festschreiben blockt** bei fehlenden Pflichtangaben (z. B. Leistungsdatum, Steuernummer) und liefert die genaue Liste zurück — Claude ergänzt und versucht es erneut.
- **Festgeschriebene Rechnungen sind unveränderbar** (GoBD) — Korrektur nur per Storno/Gutschrift/Korrekturrechnung.
- **Steuerschema** (Kleinunternehmer, Reverse Charge …) ergänzt automatisch den Pflichthinweis und weist keine USt aus.

## 5. Grenzen

Jede exportierte XRechnung besteht die **offiziellen Schematron-Regeln** (EN-16931 + XRechnung-CIUS/BR-DE) — `npm run validate:erechnung`, via SaxonJS, ohne Java; in CI hart geprüft. Siehe [LIMITATIONEN.md](LIMITATIONEN.md) — u. a. Single-User-Anmeldung (Admin-Konto; Multi-User/Rollen Roadmap), XRechnung statt ZUGFeRD-Hybrid. Keine Steuerberatung — [COMPLIANCE.md](../COMPLIANCE.md).

## Entfernt

Frühere Toolnamen, die es nicht mehr gibt (Aufrufe darauf schlagen fehl):

- `save_document_settings` — ersetzt durch `update_document_settings`.
