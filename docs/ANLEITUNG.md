# Anleitung — OpenInvoice Germany

Diese Anleitung führt dich von der Installation bis zur ersten fertigen, rechtssicheren Rechnung.

> ⚠️ Keine Steuer-/Rechtsberatung. Rechtliche Grundlagen mit Quellen: [COMPLIANCE.md](../COMPLIANCE.md).

---

## 1. Installation (Solo, ohne Server)

Voraussetzung: [Node.js](https://nodejs.org) ≥ 20.

```bash
git clone https://github.com/automationsmanufaktur-labs/open-invoice-germany.git
cd open-invoice-germany
npm install
cp .env.example .env        # Default: SQLite-Datei prisma/dev.db
npm run db:migrate          # legt die Datenbank an
npm run dev                 # startet http://localhost:3000
```

Optional Demo-Daten: `npm run db:seed` (1 Beispiel-Unternehmen, 1 Kunde, Produkte, eine festgeschriebene Rechnung).

Deine Daten liegen in `prisma/dev.db` — eine einzige Datei, die nur dir gehört. **Sichere sie regelmäßig** (kopieren genügt).

---

## 2. Erste Schritte in der App

### Schritt 1 — Unternehmen einrichten (`Einstellungen`)
Beim ersten Start wirst du hierher geführt. Trage deine Firmendaten ein. Pflicht für rechtskonforme Rechnungen (§ 14 UStG):
- **Firmenname + vollständige Anschrift**
- **Steuernummer ODER USt-IdNr.** (mindestens eines)
- Bankverbindung (für den Zahlungshinweis)

Wähle dein **Standard-Steuerschema** (Regelbesteuerung oder Kleinunternehmer § 19). Speichern → fertig.

### Schritt 2 — Kunden anlegen (`Kunden → Neuer Kunde`)
Name, Anschrift, Typ (B2B/B2C). Die USt-IdNr. ist nur bei innergemeinschaftlichen Lieferungen/Leistungen Pflicht. Für Behörden trägst du die **Leitweg-ID** ein.

### Schritt 3 — (optional) Produkte anlegen (`Produkte`)
Ein Katalog spart Tipparbeit — du kannst Positionen aber auch direkt in der Rechnung eintippen.

### Schritt 4 — Rechnung erstellen (`Neue Rechnung`)
Kunde wählen, Steuerschema, Leistungsdatum, Positionen erfassen. Die Summe wird live berechnet. „**Als Entwurf anlegen**" speichert die Rechnung als **Entwurf** — frei änder- und löschbar, noch **ohne Rechnungsnummer**.

### Schritt 5 — Festschreiben
Auf der Rechnungs-Detailseite: „**Festschreiben**". Dabei passiert (GoBD-konform):
- Die Pflichtangaben werden geprüft (fehlt etwas, bekommst du eine klare Meldung).
- Eine **fortlaufende Rechnungsnummer** wird vergeben (z. B. `RE-2026-0001`).
- Die Rechnung wird **unveränderbar**. Änderungen sind ab jetzt gesperrt.

### Schritt 6 — Exportieren
- **PDF** — die klassische „sonstige Rechnung" für E-Mail/Druck.
- **XRechnung (XML)** — die strukturierte E-Rechnung nach EN 16931 für B2B/Behörden.
- **ZUGFeRD (PDF)** — Hybrid: lesbares PDF mit eingebettetem E-Rechnungs-XML.

### Schritt 7 — Zahlung & Mahnwesen (Rechnungs-Detailseite, `/mahnwesen`)
Unter „**Zahlung & Mahnwesen**" auf der Rechnungs-Detailseite:
- **Zahlung buchen** — Teil- oder Vollzahlung; der Status springt auf *teilbezahlt* bzw. *bezahlt*.
- **Nächste Mahnstufe** — erzeugt die nächste fällige Mahnung nach den unter „Einstellungen → Mahnwesen" konfigurierten **Mahnstufen** (frei editierbar: Name, Tage nach Fälligkeit, neue Zahlungsfrist, Mahnkosten, Zinsberechnung an/aus, 40-€-Pauschale an/aus — vier Standardstufen sind vorbelegt, entsprechen aber keiner gesetzlichen Vorgabe). Mahnkosten sind erst ab der 2. Stufe zulässig (§ 288 Abs. 5 BGB, siehe [COMPLIANCE.md](../COMPLIANCE.md) Abschnitt 12); **Verzugszins** (taggenau, 5 Pp B2C/9 Pp B2B über dem unter „Einstellungen → Mahnwesen" gepflegten Basiszins) und **40-€-Pauschale** (nur B2B, einmalig je Rechnung) greifen, wenn die jeweilige Stufe das vorsieht. Jede Mahnung gibt es als PDF. Über **Mahnprozess pausieren/beenden** lässt sich eine Rechnung vorübergehend (mit Datum) oder dauerhaft von weiteren automatischen Mahnungen ausnehmen.
- Die Seite **`/mahnwesen`** zeigt eine Übersicht aller überfälligen, offenen Rechnungen (Fälligkeits-„Aging" in Tagesgruppen, Summe offener Beträge, nächste fällige Stufe je Rechnung) über alle Kunden hinweg.
- **Automatisierung:** Unter „Einstellungen → Mahnwesen" steuerst du **Auto-Erstellung** (Default an) und **Auto-Versand** (Default **aus** — bewusst konservativ, erst nach Prüfung der Vorlagen/Mahnstufen aktivieren) global sowie je Stufe (`Auto-Versand` als Schalter an der einzelnen Mahnstufe). Ist beides aktiv, verschickt der eingebaute Scheduler (siehe Schritt 8) fällige Mahnungen ohne manuelles Zutun per E-Mail.

### Schritt 8 — Eingebauter Scheduler, wiederkehrende Rechnungen / Abos (`Abos`, „Einstellungen → Automatisierung")
Die App bringt einen **eingebauten Scheduler** mit: im laufenden Prozess (`npm run dev`/`next start`, auch im Docker-Image) prüft ein Intervall-Loop automatisch alle paar Minuten, ob Mahnungen fällig sind oder Abo-Rechnungen erzeugt werden müssen (Steuerung über `SCHEDULER_ENABLED`/`SCHEDULER_INTERVAL_MINUTES`, siehe `.env.example`). Unter „Einstellungen → Automatisierung" siehst du die letzten Läufe (Zeitpunkt, Status, Zusammenfassung) und kannst per Knopf **„Jetzt prüfen"** sofort einen Lauf anstoßen.

Für regelmäßige Leistungen (Wartung, Retainer, Miete): Lege ein **Abo** an — Kunde, Positionen, Rhythmus (wöchentlich bis jährlich), Startdatum, optional Enddatum. Wahlweise werden die erzeugten Rechnungen **automatisch festgeschrieben**. **Jetzt Rechnung erzeugen** auf der Abo-Seite erstellt sofort die nächste Rechnung.

**Cron-Alternative** — wer den eingebauten Loop nicht nutzen will (z. B. `SCHEDULER_ENABLED=false`, oder mehrere App-Instanzen ohne Loop), kann denselben Vorgang per Cron/CLI anstoßen — der DB-Mutex (`SchedulerLock`) sorgt dafür, dass sich Loop, Cron und manuelle Läufe nie überschneiden:

```bash
npm run recurring:run        # erzeugt alle fälligen Abo-Rechnungen
npm run dunning:run          # erzeugt (und ggf. versendet) alle fälligen Mahnungen
npm run scheduler:run        # beide Jobs in einem Lauf (Reihenfolge: recurring, dann dunning)
```

Beispiel-Crontab (täglich 06:00, alle drei Jobs):
```
0 6 * * *  cd /pfad/zur/app && /usr/bin/npm run scheduler:run >> scheduler.log 2>&1
```
Alternativ per HTTP (mit Header `Authorization: Bearer $CRON_SECRET`, sofern `CRON_SECRET` gesetzt ist): `GET/POST /api/cron/run-recurring` (nur Abos), `GET/POST /api/cron/run-dunning` (nur Mahnwesen), `GET/POST /api/cron/run-all` (beide Jobs seriell, wie `scheduler:run`). Ohne gesetztes `CRON_SECRET` sind alle drei Routen gesperrt (503) — siehe `.env.example`.

**Erst-Deploy auf einen Bestand mit bereits festgeschriebenen Rechnungen:** Neu angelegte Organisationen bekommen `autoCreate: true` (Scheduler mahnt automatisch), Bestandsorganisationen (mindestens eine festgeschriebene Rechnung zum Zeitpunkt, an dem die Mahnwesen-Einstellungen zum ersten Mal angelegt werden) automatisch `autoCreate: false` — der eingebaute Loop erzeugt dann keine Mahnungen über den Altbestand, ohne dass das jemand konfigurieren müsste. `/mahnwesen` zeigt einen Hinweis, solange `autoCreate` aus ist. Für ein erstes Docker-Deployment auf einen bestehenden Datenbestand zusätzlich empfohlen: `SCHEDULER_ENABLED=false` beim allerersten Start setzen, nach dem Rollout `/mahnwesen` sichten (überfällige Rechnungen, aktuelle Mahnstufen) und danach bewusst `SCHEDULER_ENABLED=true` (oder unset, das ist der Default) setzen und neu starten.

---

## 3. Wichtige Begriffe

| Begriff | Bedeutung |
|---|---|
| **Entwurf** | Editier-/löschbar, keine Nummer. Hier passiert das Erfassen. |
| **Festgeschrieben** | Unveränderbar, Nummer vergeben. GoBD-konform. |
| **Storno** | Eine festgeschriebene Rechnung wird nicht gelöscht, sondern durch eine **Storno-Gutschrift** neutralisiert. Das Original bleibt erhalten. |
| **Nummernkreis** | Fortlaufende, einmalige Nummern. Verworfene Entwürfe verbrauchen **keine** Nummer. |
| **Abo** | Vorlage, aus der nach Plan Rechnungs-Entwürfe (oder direkt festgeschriebene Rechnungen) entstehen. Das Abo selbst ist kein Beleg. |
| **Verzugszins** | Zins ab Stufe 1 der Mahnung nach § 288 BGB (Basiszins + 5 Pp B2C / 9 Pp B2B), taggenau auf den offenen Betrag. |

---

## 4. E-Rechnung — was du wissen musst

- Seit **2025** musst du im B2B E-Rechnungen **empfangen** können; **versenden** wird ab 2027/2028 Pflicht (Details + Quellen: [COMPLIANCE.md](../COMPLIANCE.md)).
- Der **XRechnung-XML-Teil ist führend** — das PDF ist nur die menschenlesbare Beilage.
- Die App validiert jede XRechnung gegen die EN-16931-Kernregeln, bevor sie ausgeliefert wird. Die vollständige amtliche Prüfung (KoSIT-Validator) läuft im CI.
- **ZUGFeRD/Factur-X** (PDF mit eingebettetem XML) ist über den optionalen Mustang-Sidecar geplant (siehe [ARCHITEKTUR.md](ARCHITEKTUR.md)).

---

## 5. Datensicherung & Betrieb

- **Backup**: Die SQLite-Datei `prisma/dev.db` (bzw. die PostgreSQL-Datenbank) regelmäßig sichern. Aufbewahrungsfrist beachten (siehe COMPLIANCE.md).
- **Mehrbenutzer/Internet**: Das MVP hat noch **keine eingebaute Anmeldung**. Betreibe es lokal oder hinter einem Auth-Proxy. Siehe [SECURITY.md](../SECURITY.md).
- **PostgreSQL/Docker**: `docker compose up --build` (siehe README).
- **API-Dokumentation im Container**: `/api/docs` (Swagger UI) und `GET /api/v1/openapi.json` lesen die committete Datei `openapi/openapi.json` zur Laufzeit relativ zu `process.cwd()` — das Docker-Image kopiert dieses Verzeichnis in die runner-Stage (`Dockerfile`, Fix-Welle Phase 10). Bei einem selbst angepassten Dockerfile darauf achten, `openapi/` mit auszuliefern, sonst liefert `/api/docs` einen 500er.

---

## 6. Briefpapier, Nummernkreise, Druckoptionen & GiroCode

Unter **„Einstellungen"** findest du seit Phase 7 vier zusätzliche Seiten für das Erscheinungsbild und die Nummerierung deiner Belege.

### Briefpapier einrichten (`Einstellungen → Briefpapier`)
- **Logo hochladen**: PNG oder JPEG, max. **2 MB**. Wird oben rechts auf jedem Beleg-PDF angezeigt, Breite über **„Logo-Breite (mm)"** einstellbar (10–100 mm).
- **Hintergrundbild** (optional): PNG oder JPEG, max. **5 MB**, ganzseitig hinter dem Beleginhalt — nur sichtbar, wenn „Hintergrund anzeigen" aktiv ist.
- **Primärfarbe**, **Ränder** (oben/rechts/unten/links, mm) und **Schriftgröße** (pt) bestimmen Layout und Optik.
- **Absenderzeile** und dreispaltige **Fußzeile** (links/mittig/rechts) — freier Text, z. B. Bankverbindung/Handelsregister links, Kontakt mittig, USt-IdNr. rechts.
- Es gibt **ein** Briefpapier je Organisation (kein separates Layout je Belegtyp/Kunde).
- **Vorschau**: Link auf der Seite öffnet eine Musterrechnung/-lieferschein mit dem aktuell gespeicherten Layout.
- Änderungen wirken sofort auf **alle** künftigen PDF-Abrufe, auch bei bereits festgeschriebenen Belegen (Nachdruck) — der rechtlich maßgebliche Beleginhalt (Zahlen, Positionen, Nummer) bleibt davon unberührt (siehe [COMPLIANCE.md](../COMPLIANCE.md) Abschnitt 6).

### Nummernkreise (`Einstellungen → Nummernkreise`)
Tabelle mit **neun** Nummernkreisen: Angebote, Auftragsbestätigungen, Proforma-Rechnungen, Lieferscheine, Rechnungen, Gutschriften, Mahnungen sowie **Kundennummern** und **Artikelnummern**. Je Zeile editierbar:
- **Muster** — z. B. `RE-{YYYY}-{SEQ:5}` (Jahr + 5-stellig auf 0 aufgefüllt) oder `KD-{SEQ:5}` (ohne Jahr). Der Platzhalter `{SEQ}`/`{SEQ:n}` ist Pflicht.
- **Präfix**, **Nachkommastellen der laufenden Nummer** (Padding), **jahresabhängig zurücksetzen** (an/aus).
- **Nächste Nummer** — die App zeigt zur Kontrolle eine Vorschau der als Nächstes vergebenen Nummer.
- **Zurückdrehen ist gesperrt**: eine bereits vergebene Nummer kann nicht erneut ausgegeben werden (GoBD/§ 14 Abs. 4 Nr. 4 UStG für Rechnungen; bei den übrigen Nummernkreisen aus Nachvollziehbarkeitsgründen ebenso gesperrt). Jede Änderung wird protokolliert.
- Rechnungs-/Gutschriftnummern bleiben weiterhin **erst beim Festschreiben** vergeben; Angebots-/AB-/Lieferschein- sowie Kunden-/Artikelnummern **bei Erstellung** — siehe [COMPLIANCE.md](../COMPLIANCE.md) Abschnitt 6.

### Druckoptionen (`Einstellungen → Druckoptionen`)
Zehn globale Schalter für Beleg-PDFs: Fußzeile, Seitenzahlen, Falz-/Lochmarken (DIN 5008), Artikelnummer-/Beschreibungs-/Steuersatz-/Zeilensummen-Spalte, Absenderzeile, **GiroCode**. Auf einem einzelnen **Entwurf** (Rechnung/Angebot/Lieferschein) lässt sich im Editor unter „Druckoptionen" gezielt von den globalen Werten abweichen — nur die tatsächlich angehakten Felder werden je Beleg überschrieben. Nach dem Festschreiben ist diese Beleg-Auswahl nicht mehr änderbar.

### GiroCode-Voraussetzungen
Der GiroCode (QR-Code für „Scannen & Bezahlen" in Banking-Apps, Standard EPC069-12) erscheint auf einer Rechnung nur, wenn **alle** Punkte erfüllt sind:
- „GiroCode anzeigen" ist unter **Druckoptionen** aktiv,
- eine **IBAN** ist hinterlegt (Organisation oder Zahlungsmethode),
- die Rechnungswährung ist **EUR**,
- es besteht noch ein **offener Betrag** (> 0 €),
- der Belegtyp ist zahlungsrelevant (reguläre Rechnung, Teil-/Abschlags-/Schlussrechnung, Korrektur — nicht Gutschrift).
Fehlt eine Voraussetzung, erscheint der Beleg einfach **ohne** GiroCode — kein Fehler, kein blockierter Druck.

---

## 6a. Kundenkomfort — Adressen, Ansprechpartner, Kundenfelder, Letztes Dokument übernehmen

Auf der Kunden-Detailseite (`Kunden → <Kunde>`) gibt es seit Phase 8a vier zusätzliche Reiter.

### Adressen (Reiter „Adressen")
Ein Kunde kann beliebig viele Adressen führen — jede vom Typ **Rechnung**, **Lieferung** oder **Sonstige**, mit optionalem Label (z. B. „Zweigstelle Nord"). Über „Als Standard setzen" legst du je Typ genau eine Standardadresse fest — diese wird bei einer neuen Rechnung/einem neuen Angebot automatisch vorbelegt (aber jederzeit im Formular überschreibbar). Löschen entfernt nur die Adresse selbst; bereits erstellte Belege behalten ihren eingefrorenen Adress-Snapshot unverändert.

### Ansprechpartner (Reiter „Ansprechpartner")
Analog zu Adressen, aber kundenweit ein Standard (nicht je Typ). Vorname/Nachname sind Pflicht, Rolle/Telefon/Mobil/E-Mail optional. Der Standard-Ansprechpartner erscheint als Vorbelegung in Beleg-Formularen und wird beim Anlegen als Snapshot eingefroren — spätere Änderungen am Ansprechpartner wirken nicht auf bereits erstellte Belege zurück. In PDF-Kopf-/Fußtexten und E-Mail-Vorlagen stehen die Platzhalter `{{contact.firstName}}`, `{{contact.lastName}}`, `{{contact.role}}`, `{{contact.email}}`, `{{contact.phone}}` zur Verfügung.

### Vorgaben (Reiter „Vorgaben")
Zehn kundenspezifische Vorgaben, die bei einer neuen Rechnung/einem neuen Angebot automatisch greifen, sofern das Formular das Feld nicht selbst befüllt (Priorität: **deine Eingabe > Kundenvorgabe > Zahlungsmethode/Einstellungen > Systemdefault**): Standardwährung, Standard-Rabatt (Promille), Rechnungs-/Angebots-E-Mail + CC (für den Versand), „E-Rechnung bevorzugt" (schaltet die Org-weite Vorbelegung nur ein, nie aus), Standard-Bestellreferenz (wird zu BT-13 in der E-Rechnung), Standard-Liefer-/Zahlungsbedingungstext, Sprache (aktuell nur gespeichert, siehe [LIMITATIONEN.md](LIMITATIONEN.md)). Das Formular ist ein **Vollersatz** — ein leer gelassenes Feld setzt eine vorher gespeicherte Vorgabe zurück.

### Kundenfelder (`Einstellungen → Kundenfelder` + Reiter „Kundenfelder" beim Kunden)
Unter „Einstellungen → Kundenfelder" definierst du organisationsweite, benutzerdefinierte Felder für Kunden: Schlüssel (nur Kleinbuchstaben/Ziffern/Unterstrich, muss mit einem Buchstaben beginnen), Anzeigename, Typ (**Text**, **Zahl**, **Datum**, **Ja/Nein**, **Auswahl** mit bis zu 50 Optionen), Pflichtfeld an/aus, Reihenfolge (per Hoch/Runter). Auf der Kunden-Detailseite trägst du im Reiter „Kundenfelder" die Werte je Kunde ein. Die Werte stehen in Texten/Mail-Vorlagen als `{{customField.<Schlüssel>}}` zur Verfügung. Löschst du eine Definition, bleiben bereits gespeicherte Werte im Hintergrund erhalten (siehe [LIMITATIONEN.md](LIMITATIONEN.md)) — legst du den gleichen Schlüssel erneut an, sind sie wieder sichtbar.

### Letztes Dokument übernehmen (§32)
Ist unter „Einstellungen → Belege" die Option **„Letztes Dokument als Vorlage anbieten"** aktiv, erscheint beim Anlegen einer neuen Rechnung/eines neuen Angebots/einer neuen AB für einen Kunden mit passendem Vorgängerbeleg ein Hinweis „**<Belegart> <Nummer> vom <Datum> übernehmen?**". Du wählst per Checkbox, was übernommen wird: **Positionen**, **Texte**, **Bedingungen** (Zahlungs-/Lieferbedingungen), **Preise** (nur zusammen mit Positionen wählbar — ohne Positionen gibt es nichts, dessen Preise übernommen werden könnten). „Übernehmen" befüllt das Formular sofort; „Dokument duplizieren" öffnet stattdessen den gefundenen Vorgängerbeleg zum regulären Duplizieren. Interne Notizen werden **nie** übernommen.

---

## 6b. Dashboard, Filter, Schnellaktionen, Benachrichtigungen & Abo-Bearbeiten (Phase 8b)

### Dashboard (Startseite nach Anmeldung)
Bist du angemeldet, zeigt die Startseite (`/`) statt der Marketingseite dein **Dashboard**: offene, fällige und überfällige Beträge, „fällig diese Woche", teilbezahlte Rechnungen, wie viele Rechnungen ein Mahnschreiben benötigen würden, ein Aging-Diagramm (0–7 / 8–30 / 31–60 / 61–90 / über 90 Tage überfällig), Umsatz im laufenden Monat, die letzten fünf Belege und die Anzahl offener Angebote. Das Aging auf dem Dashboard zählt den heutigen Fälligkeitstag bereits mit (Frühwarnung) — die Mahnübersicht unter `/mahnwesen` zählt erst ab dem Folgetag (Eskalationslogik); beide zeigen deshalb bei derselben Rechnung leicht unterschiedliche Buckets, siehe [LIMITATIONEN.md](LIMITATIONEN.md).

### Filter & Suche (Rechnungen, Angebote/AB/Proforma, Lieferscheine, Abos)
Jede Listenseite (`/rechnungen`, `/dokumente`, `/lieferscheine`, `/abos`) hat oben eine Filterleiste: Status, Belegtyp, Kunde, Zeitraum (von/bis), Betrag (min/max), Nummer, Zahlungsart, E-Rechnung ja/nein, Währung sowie ein Freitextfeld für die Suche über Nummer/Bestellnummer/Kundenname (bei Rechnungen zusätzlich über Positionsbeschreibungen). Die Filterleiste ist ein einfaches Formular (funktioniert auch ohne JavaScript) — jeder Filter landet in der URL und lässt sich damit als Lesezeichen speichern oder teilen. Gutschriften findest du über `/rechnungen?type=CREDIT_NOTE` (kein eigener Menüpunkt).

### Zeilen-Schnellaktionen
In jeder Zeile einer Liste öffnet das „⋮"-Menü die für **diesen** Beleg im aktuellen Status verfügbaren Aktionen (öffnen, bearbeiten, duplizieren, PDF, XRechnung, per E-Mail senden/erneut senden, Zahlung buchen, Zahlungserinnerung, nächste Mahnstufe, in Lieferschein umwandeln, stornieren) — nicht verfügbare Aktionen erscheinen gar nicht erst, kein Rätselraten über deaktivierte Buttons. Zahlung und Versand lassen sich direkt aus der Liste heraus erledigen, ohne die Detailseite zu öffnen.

### Kundendetailseite
`Kunden → <Kunde>` zeigt jetzt zuerst eine Übersicht: offener Betrag, überfälliger Betrag, Gesamtumsatz, letzte Aktivität, sowie Reiter für alle Rechnungen/Angebote/Lieferscheine/Abos dieses Kunden. Die bisherigen Stammdatenformulare (Adressen, Ansprechpartner, Vorgaben, Kundenfelder) findest du unverändert unter „Bearbeiten" auf dieser Seite.

### Zeitstrahl (Rechnungs-/Angebots-/Lieferschein-Detailseite)
Jede Belegdetailseite zeigt unter „Zeitstrahl" eine chronologische Historie: Anlage, Änderungen, Festschreibung, Versand, Zahlungen, Mahnungen, Statuswechsel, Duplizierung, Umwandlung — alles an einem Ort statt über mehrere Karten verstreut. Diese Historie beginnt erst mit Phase 8b; für ältere Belege fehlen entsprechend frühere Ereignisse, siehe [LIMITATIONEN.md](LIMITATIONEN.md).

### Benachrichtigungen (Glocke oben rechts, `/benachrichtigungen`)
Die Glocke im Kopfbereich zeigt die Anzahl ungelesener Benachrichtigungen und eine Kurzliste; „**Alle anzeigen**" führt zur vollständigen Liste. Benachrichtigt wirst du u. a. bei: Rechnung heute fällig, Rechnung überfällig, nächste Mahnstufe erreicht, Angebot läuft bald ab, E-Mail nicht zustellbar, wiederkehrende Rechnung fehlgeschlagen, ungültige E-Rechnung. Unter „**Einstellungen → Benachrichtigungen**" schaltest du jeden dieser sieben Typen einzeln an/aus und aktivierst optional einen **täglichen E-Mail-Digest** (eine Sammel-E-Mail statt einzelner Benachrichtigungen). Erzeugt werden Benachrichtigungen von einem dritten Scheduler-Job (`notifications`, nach `recurring`/`dunning`) — läuft automatisch mit dem eingebauten Scheduler/Cron aus Schritt 8, kein separater Aufruf nötig.

### Abo bearbeiten (`/abos/[id]/bearbeiten`)
Über „Bearbeiten" auf der Abo-Detailseite (oder das „⋮"-Menü in der Abo-Liste) änderst du ein bestehendes Abo: Titel, Rhythmus (inkl. **täglich**), Start-/Enddatum, maximale Anzahl Läufe, Zahlungsfrist, Positionen, Auto-Festschreiben/-Versand, E-Mail-Vorlage, Leistungszeitraum-Text. Der Kunde selbst ist nicht änderbar — für einen anderen Kunden legst du ein neues Abo an. Änderst du das Startdatum eines Abos, das noch **keine** Rechnung erzeugt hat, zieht das nächste Erzeugungsdatum automatisch mit; hat das Abo bereits mindestens einen Lauf hinter sich, bleibt der bestehende Erzeugungsplan unangetastet (eine nachträgliche Korrektur soll den laufenden Plan nicht zurückspulen).

---

## 7. Per Sprache mit Claude Code (MCP)

Statt Formulare auszufüllen, kannst du OpenInvoice auch **per Sprache** über einen mitgelieferten **MCP-Server** bedienen — z. B. mit Claude Code oder Claude Desktop. Einrichtung, Datenschutz-Hinweise (DSGVO/Art. 28) und die vollständige Tool-Liste stehen in **[docs/MCP.md](MCP.md)**; lies das dort zuerst, bevor du echte Kundendaten per Cloud-LLM verarbeiten lässt.

Alle wichtigen Funktionen aus dieser Anleitung sind auch als MCP-Tool erreichbar — Claude ruft dieselben, gleich validierten Funktionen auf wie UI und API (§55 des Lastenhefts, keine Bypass-Pfade). Beispielsätze:

> **„Erstelle für Müller GmbH ein Angebot über 10 Stunden Beratung zu 95 Euro."** → `create_document`

> **„Erzeuge aus Angebot ANG-2026-00123 eine Auftragsbestätigung."** → `convert_document`

> **„Erstelle aus dem Auftrag einen Lieferschein."** → `create_delivery_note`

> **„Erstelle eine Abschlagsrechnung über 30 Prozent."** → `create_downpayment_invoice`

> **„Welche Rechnungen sind überfällig?"** → `list_overdue_invoices`

> **„Sende für RE-2026-00342 eine Zahlungserinnerung."** → `send_dunning`

> **„Buche auf RE-2026-00342 eine Zahlung von 500 Euro."** → `record_payment`

> **„Erstelle die nächste Mahnstufe."** → `create_dunning`

Vollständige Tool-Referenz (alle 80 Tools, nach Bereichen gruppiert, je ein Beispielkommando): [docs/MCP.md](MCP.md#3-verfügbare-tools).

---

## 8. Problembehebung

| Problem | Lösung |
|---|---|
| „Kein Unternehmen eingerichtet" | Zuerst unter **Einstellungen** die Firmendaten speichern. |
| Festschreiben schlägt fehl | Die Meldung nennt die fehlende Pflichtangabe (z. B. Leistungszeitpunkt, Steuernummer). Ergänzen und erneut versuchen. |
| „Unable to open the database file" | `npm run db:migrate` ausführen; DATABASE_URL in `.env` prüfen. |
| Reverse Charge / Kleinunternehmer | Schema in der Rechnung wählen — der Pflichthinweis wird automatisch ergänzt und kein USt-Satz ausgewiesen. |

---

Fragen oder Fehler? → [Issues auf GitHub](https://github.com/automationsmanufaktur-labs/open-invoice-germany/issues) · Beitragen: [CONTRIBUTING.md](../CONTRIBUTING.md)
