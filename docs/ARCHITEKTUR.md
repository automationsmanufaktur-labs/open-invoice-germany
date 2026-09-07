# ARCHITEKTUR-Vorschlag: Open-Source-Rechnungssoftware DE

> **Stand 2026-09-02.** Dieses Dokument beschreibt den **implementierten** Stand. Frühere
> Fassungen enthielten Entwurfsvorschläge (Decimal-Preise, Mustang-Sidecar, Dunning-Enum,
> EmailLog), die nie umgesetzt wurden — sie sind entweder entfernt oder ausdrücklich als
> historisch gekennzeichnet. Wo Code und Dokument abweichen,
> gilt der Code. Roadmap: `docs/superpowers/requirements/` (Branch `specs`).

> Begleitdokument zu `COMPLIANCE.md`.

Stack (fix): Next.js 16 (App Router) · TS strict · Prisma · PostgreSQL (Docker) / SQLite-Solo · Tailwind · Zod an jedem Boundary · React Hook Form. Rechtlicher Rahmen: §14/§14a/§19/§14b UStG, §§33/34/34a UStDV, GoBD (§146 AO, §239 HGB), DSGVO.

---

## 1. Domänen-Datenmodell

### Entitäten + Schlüsselfelder

**Organization (Mandant/Unternehmen)** — der ausstellende Unternehmer
`id` · `legalName` · `address` (struct) · `taxNumber?` · `vatId?` (USt-IdNr.) · `kuIdNr?` (§19a) · `smallBusiness` (bool, §19) · `defaultTaxScheme` (REGULAR | KLEINUNTERNEHMER | DIFFERENZ) · `iban` · `bic` · `bankName` · `electronicAddress?` (Peppol) · `createdAt`
→ Tenancy-Diskriminator auf **allen** belegführenden Tabellen (`orgId`), App-seitig erzwungen; bei Multi-Tenant zusätzlich Postgres RLS.

**Customer (Kunde)**
`id` · `orgId` · `type` (BUSINESS | CONSUMER) — steuert §286-Verzugslogik, 40-€-Pauschale, B2B-E-Rechnungspflicht · `name` · `address` · `vatId?` · `vatIdValidatedAt?` (VIES/§18e) · `countryCode` · `leitwegId?` (B2G, BT-10) · `peppolId?` · `defaultPaymentTermsDays` (Default 14) · `isArchived` (Soft-Delete, **kein** Hard-Delete bei Belegbezug)

**Product (Produkt/Leistung)** — Katalog, frei editierbar (kein Beleg)
`id` · `orgId` · `name` · `description` · `unit` (EN-16931 UN/ECE Rec 20, z.B. `C62`, `HUR`) · `netPriceCents` (Integer-Cent, kein Decimal) · `taxRate` (Integer-Prozent: 19/7/0) · `taxCategory` (S | AE | K | G | E | Z — EN-16931 UNTDID 5305) · `differential` (bool, §25a)

**NumberRange (Nummernkreis)** — eigene Tabelle, transaktionaler Zähler
`id` · `orgId` · `docType` (QUOTE | INVOICE | CREDIT_NOTE | DUNNING) · `prefix` · `pattern` (z.B. `RE-{YYYY}-{SEQ:5}`) · `year?` (für jahresbasierte Kreise) · `currentValue` (Int) · `@@unique([orgId, docType, year])`

**Quote (Angebot)** — kein Beleg i.S.d. GoBD, frei editier-/löschbar
`id` · `orgId` · `customerId` · `kind` (ANGEBOT | AUFTRAGSBESTAETIGUNG | PROFORMA) · `number?` · `status` (DRAFT | SENT | ACCEPTED | DECLINED | EXPIRED | CONVERTED) · `validUntil` · `lines[]` · Summenfelder (`…Cents`) · `internalNotes?` (nur intern, nie in PDF/Mail) · `sellerSnapshotJson?` / `buyerSnapshotJson?` / `snapshotSource?` / `snapshotAt?` (Phase 0, siehe Invoice) · `convertedToInvoiceId?`

**Invoice (Rechnung)** — der GoBD-relevante Beleg
`id` · `orgId` · `customerId` · `number?` (NULL bis Festschreibung) · **`status`** (DRAFT | FINALIZED | SENT | PAID | PARTIALLY_PAID | CANCELLED) · `type` (INVOICE | CREDIT_NOTE | CORRECTION) · `taxScheme` · `issueDate` · `deliveryDate`/`deliveryStart`/`deliveryEnd` (§14 Abs.4 Nr.6) · `dueDate` · `currency` · `lines[]` · `netTotalCents` · `taxBreakdownJson` (JSON: pro Satz Netto/Steuer) · `grossTotalCents` · `paidAmountCents` · `notes` (Skonto-Freitext §14.5(19), Reverse-Charge-/§25a-Hinweis) · `internalNotes?` (nur intern sichtbar — nie in PDF, XRechnung, ZUGFeRD oder Mails) · `sellerSnapshotJson?` / `buyerSnapshotJson?` (Käufer-/Verkäufer-Snapshot zum Festschreibungs-/Erstellungszeitpunkt, Phase 0; JSON, per Zod gelesen) · `snapshotSource?` (FINALIZE | CREATE | MIGRATION) · `snapshotAt?` · `consumerRetentionHint` (bool, §14b Abs.1 S.5) · `reversedByInvoiceId?` / `correctsInvoiceId?` · `xmlFormat?` (XRECHNUNG | ZUGFERD) · `xmlHash?` · `pdfPath?` · `finalizedAt?` · `createdAt`

**InvoiceLine (Rechnungsposition)**
`id` · `invoiceId` · `position` · `productId?` (Snapshot — kein Live-Lookup) · `description` · `quantityMilli` (Integer-Milliunits, 1/1000) · `unit` · `unitNetPriceCents` (Integer-Cent) · `taxRate` (Integer-Prozent) · `taxCategory` · `discountPermille?` · `lineNetCents`
→ Alle steuer-/preisrelevanten Werte werden bei Festschreibung **eingefroren** (Snapshot), nie per Relation auf den Live-Katalog aufgelöst. Kein `Decimal`-Typ im Schema (siehe `prisma/schema.prisma`-Kopfkommentar).

**Payment (Zahlung)**
`id` · `invoiceId` · `amountCents` · `paidAt` · `method` (TRANSFER | CASH | CARD | SEPA) · `reference` · `isSkonto` (bool — §17-Fall, **keine** Rechnungsberichtigung nötig) · `createdAt`

**Dunning (Mahnung)**
`id` · `invoiceId` · `level` (`Int`, kein Enum: 0 = Zahlungserinnerung, 1 = 1. Mahnung, 2 = 2. Mahnung, 3 = 3. Mahnung — Titel in `src/lib/dunning.ts`) · `sentAt` · `dueDate` · `baseInterestRatePermille?` (Snapshot Basiszins zum Verzugsstichtag) · `interestRatePoints?` (5 oder 9 Pp, abhängig `Customer.type`) · `interestAmountCents` · `lateFeeCents` (nur konkrete Porto-/Materialkosten, **nicht** Pauschale) · `flatFee40Cents` (nur `type=BUSINESS`, §288 Abs.5) · `pdfPath?`
→ Verzugslogik: Level-0-Erinnerung kostenfrei (verzugsbegründend, h.M. nicht ersatzfähig); ab Level-1 Verzugsschaden.

**ChangeLog (append-only Änderungsprotokoll)** — GoBD-Kern
`id` · `orgId` · `entity` (INVOICE | PAYMENT | …) · `entityId` · `action` (CREATE | UPDATE | FINALIZE | CANCEL | DELETE_PRE_FINALIZE) · `actorId` · `at` · `diff` (JSON: alte→neue Werte) · `prevHash` · `hash`
→ Append-only: **kein** UPDATE/DELETE-Recht (DB-User ohne diese Grants + App-Layer), Hash-Chain (`hash = sha256(prevHash + canonical(diff))`) macht Manipulation erkennbar.

**Phase 1: Verknüpfungen, Stammdaten, Lieferschein** — zehn zusätzliche Tabellen. `DocumentRelation` bildet Beleg-zu-Beleg-Verknüpfungen (Umwandlung, Storno, Korrektur, Abo-Erzeugung) explizit ab, ergänzend zu den bisherigen Fremdschlüsseln. `DeliveryNote`/`DeliveryNoteLine` bilden den Lieferschein als eigenes, nummeriertes Dokument mit Snapshot ab (Service `createDeliveryNote`, noch ohne UI). `TextTemplate` und `EmailTemplate` speichern wiederverwendbare Text-/Mailvorlagen je Organisation, `EmailLog` protokolliert versendete Mails. `CustomerAddress` und `ContactPerson` erlauben mehrere Adressen/Ansprechpartner je Kunde zusätzlich zur Stammadresse. `PaymentMethod` und `DunningStage` sind Organisations-Stammdaten (Systemzahlungsmethoden bzw. Mahnstufen), die per Migration und bei Organisationsanlage (`ensureOrgMasterdata`) angelegt werden; `Dunning.stageId` verweist künftig auf `DunningStage` statt nur auf `level`.

### GoBD-Unveränderbarkeit + lückenloser Nummernkreis — technisch erzwungen

**Status-Maschine `draft → finalized`:**
- **DRAFT**: voll editierbar/löschbar, `number = NULL`, keine ChangeLog-FINALIZE-Pflicht, kein XML/PDF. Hier passiert das gesamte Erfassen/Korrigieren.
- **Übergang `finalize()` in EINER `prisma.$transaction`** (Serializable):
  1. `SELECT ... FOR UPDATE` auf `NumberRange` → `currentValue++` → Nummer atomar vergeben (verhindert Doppelvergabe bei Nebenläufigkeit; `@@unique` als zweite Verteidigungslinie).
  2. `Invoice.status = FINALIZED`, `number` setzen, `finalizedAt = now()`, Zeilen-Snapshots fixieren.
  3. XML (XRechnung/ZUGFeRD) + PDF erzeugen, `xmlHash` speichern.
  4. `ChangeLog`-FINALIZE-Eintrag (Hash-Chain) schreiben.
  - Schlägt ein Schritt fehl → Rollback, **Nummer bleibt unverbraucht** (Zähler nur in derselben Tx erhöht).
- **FINALIZED ist append-only**: Prisma-Middleware (`$extends`/`$use`) blockt jedes `update`/`delete` auf `Invoice`/`InvoiceLine` mit `status != DRAFT`. Erlaubt sind nur: `status`-Übergänge SENT/PAID, `paidAmount`, sowie der Sondereintrag CANCEL.

**Keine Hard-Deletes nach Festschreibung / Storno statt Löschung:**
- `delete` auf FINALIZED → Middleware wirft Fehler. Korrektur ausschließlich über:
  - **Storno** = neue Invoice `type=CREDIT_NOTE`, `reversedByInvoiceId`-Verknüpfung, eigene Nummer aus dem Kreis, betragsspiegelbildlich. Original bleibt unverändert bestehen.
  - **Korrekturrechnung** (`type=CORRECTION`, `correctsInvoiceId`, §31 Abs.5 UStDV: eindeutiger Bezug auf Original-Nr.+Datum).
- DSGVO-Konflikt (Art. 17 vs. §147 AO): rechnungsbezogene Kunden werden bei Löschverlangen **archiviert/gesperrt** (`isArchived`, Art. 18), nicht hart gelöscht, bis Aufbewahrungsfrist (8 J., §14b Abs.1) abläuft. Hard-Delete nur für Quotes/Drafts ohne Belegbezug.

**Lückenloser Nummernkreis (gesetzeskonform „einmalig", nicht zwingend lückenlos):**
- Vergabe **nur** beim Festschreiben, transaktional, monoton steigend pro `(orgId, docType, year)`. Drafts haben keine Nummer → kein „Loch" durch verworfene Entwürfe.
- Stornos verbrauchen reguläre Nummern aus dem Kreis → entstehende „Sprünge" sind systemdokumentiert (ChangeLog), damit bei BP erklärbar (UStAE 14.5(10): Einmaligkeit zwingend, Lückenlosigkeit nicht; unerklärte Lücken = Schätzungsrisiko).

---

## 2. E-Rechnung: Erzeugung & Validierung

### Anforderung
EN-16931-konform: **XRechnung** (UBL oder CII, reines XML) und **ZUGFeRD/Factur-X** (PDF/A-3 mit eingebettetem CII-XML, Profil ≥ EN16931/COMFORT — **niemals** MINIMUM/BASIC-WL, gelten nicht als E-Rechnung). Bei Hybrid ist der XML-Teil führend (BMF 15.10.2025) → 14c-Risiko bei Divergenz, daher PDF deterministisch aus denselben Daten rendern.

### Optionen bewertet (historische Abwägung 2026-06 — nicht umgesetzt, siehe unten)

| Schicht | Optionen | Bewertung |
|---|---|---|
| **XML-Erzeugung** | (a) eigene Templates · (b) JS-Lib (`node-zugferd`, WIP v0.1) · (c) **Mustangproject** (Java, Apache-2.0) | Eigene Templates = Wartungslast bei jeder EN-16931/XRechnung-Versionsdrift, fehleranfällig → **nein**. node-zugferd zu unreif für Rechtssicherheit. Mustang reif, erzeugt+embedded+validiert. |
| **PDF/A-3-Embedding** | reine Node-PDF-Libs · Mustang/horstoeko | Node-Ökosystem für korrektes PDF/A-3 (XMP, ICC, AFRelationship) **dünn** → hohes Risiko formal ungültiger Container. |
| **Validierung CI/Test** | **KoSIT-Validator** (Java, offizielle Referenz) + `validator-configuration-xrechnung` · **veraPDF** (PDF/A-3) | De-facto-Standard. Zwei Ebenen: KoSIT = XML/Schematron, veraPDF = PDF/A-Container. Reine JS-Validierung deckt EN-16931-Schematron **nicht** vollständig ab. |

### Umgesetzt: eigener Generator (kein JVM-Sidecar)

Die oben skizzierte Mustang-Sidecar-Empfehlung wurde **nicht** umgesetzt. Stattdessen erzeugt die App die E-Rechnungsformate selbst, ohne JVM-Abhängigkeit zur Laufzeit:

1. **UBL** (XRechnung 3.0 CIUS) — `src/lib/einvoice/xrechnung.ts`, per `xmlbuilder2`.
2. **CII** (Factur-X/EN-16931-Profil) — `src/lib/einvoice/cii.ts`, ebenfalls per `xmlbuilder2`; Gutschriften mit positiven Beträgen + TypeCode 381.
3. **ZUGFeRD-Einbettung** — `src/lib/einvoice/zugferd.ts` bettet das CII-XML per `pdf-lib` als Anhang (`factur-x.xml`, `AFRelationship`) in das PDF ein. **Kein striktes PDF/A-3** (`pdf-lib` erzwingt keine Farbprofil-/XMP-Konformität) — der eingebettete XML-Teil ist führend (BMF 15.10.2025).
4. **Kernregelprüfung** — `src/lib/einvoice/en16931-core.ts` prüft die wichtigsten EN-16931-Geschäftsregeln lokal, ohne Java.
5. **Schematron-Validierung in CI** — per SaxonJS (`npm run validate:erechnung`, `scripts/validate-erechnung.ts`), gegen die offiziellen EN-16931/XRechnung-CIUS-Regeln, ohne Java-Laufzeit.
6. **KoSIT-Validator** (Java) läuft in CI als unabhängiger Cross-Check zusätzlich zu SaxonJS.

Damit entfällt der JVM-Sidecar vollständig; die einzige Einschränkung gegenüber der ursprünglichen Empfehlung ist das fehlende strenge PDF/A-3 (siehe `docs/LIMITATIONEN.md`).

---

## 3. Lizenz-Empfehlung

Ziel: (a) niemand zahlt mehr für Rechnungssoftware, (b) keine proprietäre Closed-Source-SaaS-Abzweigung, (c) maximale Community-Beiträge.

### EMPFEHLUNG: **AGPL-3.0**

Begründung:
- **MIT/Apache-2.0** erlauben jedem, den Code zu nehmen, als gehostete SaaS zu schließen und nichts zurückzugeben — das verletzt Ziel (b) direkt. Apache bringt zwar expliziten Patent-Grant (gut), schützt aber nicht gegen Closed-SaaS.
- **AGPL-3.0** schließt die „SaaS-Lücke" der GPL: Wer den Code als Netzwerk-Dienst betreibt, muss den (modifizierten) Quellcode den Nutzern verfügbar machen. Genau der Hebel gegen die proprietäre Closed-Source-SaaS.
- Für ein **Self-Hosting-First**-Tool ist AGPL natürlich: der typische Nutzer hostet selbst und ist durch die Copyleft-Pflicht ohnehin nicht belastet; nur der Trittbrettfahrer, der zumacht, wird getroffen.
- Community-Beiträge: starkes Copyleft + glaubwürdige „bleibt-frei"-Garantie zieht beitragswillige Entwickler an, die nicht wollen, dass ihre Arbeit in einem geschlossenen Produkt verschwindet.

**Gegenrede:** AGPL schreckt Unternehmens-Integratoren ab (viele Corporate-Policies verbieten AGPL-Abhängigkeiten), was die Adoption und damit indirekt den Beitragsstrom dämpfen kann. Außerdem ist die „Netzwerk-Nutzung löst Offenlegung aus"-Pflicht in der Praxis schwer durchzusetzen. **Mitigation:** CLA/DCO einsammeln, um eine spätere Lizenz-Nachjustierung oder ein optionales kommerzielles Dual-Licensing offenzuhalten — falls breitere kommerzielle Einbettung gewünscht wird, ohne das Closed-SaaS-Schutzziel aufzugeben.

---

## 4. Ordner-/Modulstruktur

```
src/
  app/                    # Next.js App Router: Routen + api/ + actions/
    api/                  # auth/, cron/, documents/, dunnings/, invoices/, recurring/
    actions/              # invoices.ts, masterdata.ts, result.ts (Server Actions)
    rechnungen/ dokumente/ kunden/ produkte/ abos/ einstellungen/ setup/ login/
  components/             # UI-Komponenten (12 Dateien), inkl. forms/ (CustomerForm.tsx,
                           # OrganizationForm.tsx, ProductForm.tsx, fields.tsx)
  proxy.ts                # Next.js Middleware: Session-Prüfung, öffentliche Pfade (/login, /api/cron, …)
  domain/                 # framework-frei, testbar
    audit.ts
    changelog.ts          # Hash-Chain
    numbering.ts
    snapshot.ts           # Käufer-/Verkäufer-Snapshot (Phase 0)
    document/              # convert.ts, create.ts, pdf-data.ts
    dunning/                # create.ts
    invoice/                # cancel.ts, create.ts, credit.ts, finalize.ts, mandatory.ts, payment.ts
    recurring/              # create.ts, run.ts
  lib/
    db.ts                 # Prisma-Client
    org.ts
    money.ts               # Integer-Cent-Arithmetik
    tax.ts
    dunning.ts             # §288-Verzugszins, DUNNING_LEVEL_TITLE
    recurring.ts
    auth/                  # password.ts, server.ts, session.ts
    einvoice/               # xrechnung.ts, cii.ts, zugferd.ts, en16931-core.ts, mapper.ts, load.ts, types.ts
    pdf/                    # invoice-pdf.ts, dunning-pdf.ts
  schemas/
    index.ts               # Zod — DTOs, EN-16931-Mapping, API-Boundaries
  mcp/                     # bootstrap.ts, server.ts
  generated/prisma/        # generierter Prisma-Client (nicht im Repo versioniert editieren)
prisma/
  schema.prisma            # SQLite (Solo/Dev)
  schema.postgres.prisma   # PostgreSQL (Docker/Prod)
  migrations/               # SQLite-Migrationen
  migrations-postgres/      # PostgreSQL-Migrationen
scripts/                  # db-prepare.sh, migrate-postgres.sh, test-postgres-migrations.sh,
                           # validate-erechnung.ts, generate-sample-xrechnung.ts, run-recurring.ts, …
test/
  unit/
  integration/
docker-compose.yml       # db + app für Docker-Betrieb; enthält einen auskommentierten,
                          # optionalen Mustang-Sidecar-Block (Profil "einvoice", Build-Pfad
                          # einvoice-service/ existiert nicht) — nicht aktiv genutzt
```

---

## 5. Roadmap (historisch)

Die verbindliche Planung ist das Lastenheft; dieser Abschnitt bleibt als ursprüngliche Stufenidee erhalten.

### MVP (zuerst — deckt den B2C/Solo-/§19-Fall vollständig)
- **Org-Setup**, Kunden, Produkte, Angebot → Rechnung.
- **Festschreibung + Nummernkreise + ChangeLog (Hash-Chain) + Storno** — der nicht verhandelbare GoBD-Kern.
- **Standard-Rechnung Regelbesteuerung 19/7/0** + **Kleinunternehmer §19** (Pflichthinweis §34a, kein USt-Ausweis) + **§33 Kleinbetrag**.
- **PDF (PDF/A-3-fähig) + ZUGFeRD-Export** via Sidecar; einfaches PDF („sonstige Rechnung") für B2C/§19 ohne Sidecar.
- Zahlungserfassung, Mahn-Basis (Erinnerung + Verzugszins B2C 5 Pp).
- SQLite-Solo-Modus lauffähig ohne Docker/Sidecar.

### Stufe 2 (E-Rechnung B2B scharf)
- **XRechnung** (UBL+CII) + **ZUGFeRD EN16931/EXTENDED**, KoSIT/veraPDF-CI-Gate produktiv.
- B2B-Verzugslogik: **9 Pp + 40-€-Pauschale (§288 Abs.5)**, halbjahresgenaue Basiszins-Tabelle.
- **VIES/§18e**-Validierung, **Reverse Charge §13b** (Pflichthinweis, kein USt-Ausweis), ig. Lieferung §6a + Hinweise §14a.
- Korrekturrechnung §31 Abs.5 als E-Rechnung (PDF-Korrektur einer E-Rechnung unzulässig).

### Stufe 3 (Spezialfälle + Komfort)
- **Differenzbesteuerung §25a** (Refurb/Gebrauchtwaren, Marker „Gebrauchtgegenstände/Sonderregelung", Margenlogik, Gesamtdifferenz ≤750 €).
- **B2G**: Leitweg-ID (BT-10), Peppol-Versand, OZG-RE.
- **ZM §18a**, **OSS §18j** (EU-B2C-Fernverkauf).
- Mehrstufiges automatisiertes Mahnwesen, wiederkehrende Rechnungen/Abos, DATEV-Export, Multi-Tenant-RLS, revisionssichere Langzeit-Archivierung (8 J., §14b).
