# Bekannte Einschränkungen (MVP)

Damit niemand böse Überraschungen erlebt: Das hier ist (noch) **nicht** abgedeckt oder nur eingeschränkt. Status: 2026-06-09.

## Betrieb & Sicherheit
- **Anmeldung vorhanden, aber Single-User.** Ein Admin-Konto schützt App **und** API (signiertes Session-Cookie). Mehrbenutzer, Rollen, Passwort-Reset und 2FA sind Roadmap. In Produktion `AUTH_SECRET` setzen + hinter HTTPS betreiben.
- **Single-Tenant.** Das Datenmodell trägt `orgId`, die App nutzt aber eine aktive Organisation. Schreibpfade (Stammdaten) sind org-gescoped; eine vollständige Mehrmandanten-Trennung (inkl. Lese-Pfade, Postgres-RLS) ist Roadmap.

## E-Rechnung
- **ZUGFeRD/Factur-X** wird erzeugt: Hybrid-PDF mit eingebettetem **EN-16931-CII-XML** (offiziell Schematron-validiert, `factur-x.xml`, AFRelationship). Einschränkung: der PDF-Container ist **kein striktes PDF/A-3** (pdf-lib setzt keine PDF/A-3-Konformität durch) — für strenge PDF/A-3-Validierung den Mustang-Sidecar/veraPDF nutzen. Der eingebettete XML-Teil ist führend.
- **Validierung:** Die erzeugte XRechnung besteht die **offiziellen Schematron-Regeln** — EN-16931-UBL **und** XRechnung-CIUS (BR-DE) — lokal & in CI via SaxonJS (`npm run validate:erechnung`, ohne Java). Der KoSIT-Validator (Java) läuft als unabhängiger Cross-Check in der CI. Die vorgelagerte **XSD-Prüfung** deckt nur der KoSIT-Lauf ab (SaxonJS prüft „nur" Schematron — in der Praxis aber der entscheidende Teil).
- **Storno/Gutschrift als E-Rechnung:** wird als korrektes UBL-`CreditNote`-Dokument (Typ 381, positive Beträge) mit `BillingReference` (BG-3, Bezug zur Originalrechnung, § 31 Abs. 5 UStDV) erzeugt. ✓
- **EndpointID** wird als E-Mail (`EM`) ausgegeben. Leitweg-/Peppol-Schemacodes (EAS) werden noch nicht differenziert.
- **PaymentMeans** wird nur bei hinterlegter IBAN ausgegeben.
- **Positions-Rabatte** (AllowanceCharge BG-27/28) und strukturierte Skonto-Angaben (BT-20) sind noch nicht modelliert.

## Zahlung, Mahnwesen & Abos
- **Mahnwesen** vorhanden: Zahlungseingänge erfassen, gestufte Mahnungen (Zahlungserinnerung → 1./2. Mahnung) mit Verzugszins (§ 288 BGB, taggenau) + 40-€-Pauschale (nur B2B, einmal). Der **Basiszinssatz ist als Default hinterlegt** (1,27 % für 2026) und muss zum jeweiligen Halbjahr gepflegt/übergeben werden — keine automatische Aktualisierung.
- **Wiederkehrende Rechnungen/Abos** vorhanden: Vorlage mit Rhythmus (wöchentlich–jährlich), optional Auto-Festschreiben. Der Lauf erzeugt fällige Rechnungen — manuell (UI/MCP) oder per Cron (`npm run recurring:run`, bzw. `GET /api/cron/run-recurring` mit `CRON_SECRET`). Es gibt **keinen eingebauten Scheduler**; der Cron-/Timer-Aufruf muss self-hosted eingerichtet werden. Mengen/Preise sind je Lauf fix (keine nutzungsbasierte Abrechnung).

## E-Mail-Versand
- **Nur SMTP.** Es gibt genau einen Provider (`src/lib/mail/smtp.ts`); Resend/SES o. Ä. sind nicht angebunden (siehe `docs/ARCHITEKTUR.md`).
- **Kein Zustell-/Bounce-Tracking.** Der Versandstatus bleibt nach erfolgreichem SMTP-Aufruf dauerhaft `SENT` — die Werte `DELIVERED`/`BOUNCED` sind im Schema reserviert, werden aber mangels Provider-Webhook nicht gesetzt.
- **QUEUED-Eintraege ohne Abgleich.** Bricht der Prozess waehrend des SMTP-Versands ab, bleibt der `EmailLog`-Eintrag dauerhaft auf `QUEUED` stehen, ohne dass ein ChangeLog-Satz nachgezogen wird; ein Abgleich (Scheduler) folgt in Phase 6.
- **Nur Text/plain**, kein HTML-Mailversand.
- **Lieferschein-Versand** ist noch nicht angebunden (kein PDF-Rendering für `DELIVERY_NOTE`); folgt mit der Lieferschein-UI in Phase 3.
- **`AUTH_SECRET`-Wechsel invalidiert das gespeicherte SMTP-Passwort** (Verschlüsselung per HKDF aus `AUTH_SECRET`, siehe `src/lib/crypto/secrets.ts`) — nach einem Secret-Wechsel muss das Passwort in den Mail-Einstellungen neu eingetragen werden.
- **Zusatzanhänge werden nicht persistiert.** Im `EmailLog` werden nur Dateiname, Größe und SHA-256-Hash protokolliert, nicht der Dateiinhalt.

## Daten & Recht
- **PostgreSQL** nutzt echte Migrationen (`prisma/migrations-postgres/`, angewendet beim Containerstart). Bestehende Instanzen, die noch mit `prisma db push` angelegt wurden, müssen einmalig eine Baseline verbuchen — der Container bricht mit der nötigen Anweisung ab, statt die Datenbank anzufassen.
- **Nummernkreise** sind standardmäßig jahresbasiert; eine UI zum Vorkonfigurieren (Präfix/Muster/jahresunabhängig) fehlt noch.
- **Feld-Validierung** von IBAN/BIC/USt-IdNr. ist bewusst locker (keine Prüfziffer/Mod-97). Offensichtlich falsche Werte können durchrutschen.
- **GoBD:** Die Software ermöglicht Unveränderbarkeit + Audit-Chain, ersetzt aber **nicht** die anwenderseitige **Verfahrensdokumentation**.
- **Beleg-Snapshots:** Seit Phase 0 speichern festgeschriebene Rechnungen und nummerierte Geschäftsdokumente Käufer-/Verkäuferdaten als Snapshot; Stammdatenänderungen wirken nicht mehr zurück. Belege aus der Zeit davor wurden per Migration aus dem damals aktuellen Stamm eingefroren (`snapshotSource = MIGRATION`) — ihr Snapshot entspricht dem Stand zum Migrationszeitpunkt, nicht zwingend dem Ausstellungszeitpunkt. Storno und Gutschrift erben den Snapshot des Originalbelegs (`INHERITED`). **Mahnungen** werden noch nicht gesnapshottet — der PDF-Nachdruck einer Mahnung liest weiterhin den aktuellen Stamm (Organisation/Kunde) live; das folgt erst in Phase 6 (Mahnwesen).
- **Phase 1:** Verknüpfungen zwischen Belegen (Umwandlung, Storno, Gutschrift, Abo-Erzeugung) werden zusätzlich in `DocumentRelation` gespiegelt; Zahlungsmethoden und Mahnstufen sind Stammdaten (noch ohne UI, Phasen 4/6); Lieferscheine existieren als Datenmodell + Service, UI folgt in Phase 3.

## Funktionsumfang (geplant)
DATEV-/CSV-Export, OSS/ZM, USt-Voranmeldungs-Auswertung, VIES-Prüfung, Mehrbenutzer/Auth, eingebauter Scheduler, nutzungsbasierte Abo-Abrechnung.

---

Etwas davon blockiert dich? → [Issue eröffnen](https://github.com/automationsmanufaktur-labs/open-invoice-germany/issues). Rechtliche Grundlagen: [COMPLIANCE.md](../COMPLIANCE.md).
