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

## 7. Problembehebung

| Problem | Lösung |
|---|---|
| „Kein Unternehmen eingerichtet" | Zuerst unter **Einstellungen** die Firmendaten speichern. |
| Festschreiben schlägt fehl | Die Meldung nennt die fehlende Pflichtangabe (z. B. Leistungszeitpunkt, Steuernummer). Ergänzen und erneut versuchen. |
| „Unable to open the database file" | `npm run db:migrate` ausführen; DATABASE_URL in `.env` prüfen. |
| Reverse Charge / Kleinunternehmer | Schema in der Rechnung wählen — der Pflichthinweis wird automatisch ergänzt und kein USt-Satz ausgewiesen. |

---

Fragen oder Fehler? → [Issues auf GitHub](https://github.com/automationsmanufaktur-labs/open-invoice-germany/issues) · Beitragen: [CONTRIBUTING.md](../CONTRIBUTING.md)
