# ARCHITEKTUR-Vorschlag: Open-Source-Rechnungssoftware DE

> **Stand 2026-09-04.** Dieses Dokument beschreibt den **implementierten** Stand. Frühere
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
`id` · `orgId` · `customerId` · `number?` (NULL bis Festschreibung) · **`status`** (DRAFT | FINALIZED | SENT | PAID | PARTIALLY_PAID | CANCELLED) · `type` (INVOICE | CREDIT_NOTE | CORRECTION | PARTIAL | DOWNPAYMENT | FINAL — die letzten drei seit Phase 5, siehe unten) · `taxScheme` · `issueDate` · `deliveryDate`/`deliveryStart`/`deliveryEnd` (§14 Abs.4 Nr.6) · `dueDate` · `currency` · `lines[]` · `netTotalCents` · `taxBreakdownJson` (JSON: pro Satz Netto/Steuer) · `grossTotalCents` · `paidAmountCents` · `prepaidCents` (Phase 5, Σ Abschläge brutto — nur `type=FINAL`) · `payableCents?` (Phase 5, Rest nach Abzug — NULL = `grossTotalCents`) · `sourceType?`/`sourceId?` (Phase 5, Quelle einer Teil-/Abschlags-/Schlussrechnung) · `notes` (Skonto-Freitext §14.5(19), Reverse-Charge-/§25a-Hinweis) · `internalNotes?` (nur intern sichtbar — nie in PDF, XRechnung, ZUGFeRD oder Mails) · `sellerSnapshotJson?` / `buyerSnapshotJson?` (Käufer-/Verkäufer-Snapshot zum Festschreibungs-/Erstellungszeitpunkt, Phase 0; JSON, per Zod gelesen) · `snapshotSource?` (FINALIZE | CREATE | MIGRATION) · `snapshotAt?` · `consumerRetentionHint` (bool, §14b Abs.1 S.5) · `reversedByInvoiceId?` / `correctsInvoiceId?` · `xmlFormat?` (XRECHNUNG | ZUGFERD) · `xmlHash?` · `pdfPath?` · `finalizedAt?` · `createdAt`

**InvoiceLine (Rechnungsposition)**
`id` · `invoiceId` · `position` · `productId?` (Snapshot — kein Live-Lookup) · `description` · `quantityMilli` (Integer-Milliunits, 1/1000) · `unit` · `unitNetPriceCents` (Integer-Cent) · `taxRate` (Integer-Prozent) · `taxCategory` · `discountPermille?` · `lineNetCents`
→ Alle steuer-/preisrelevanten Werte werden bei Festschreibung **eingefroren** (Snapshot), nie per Relation auf den Live-Katalog aufgelöst. Kein `Decimal`-Typ im Schema (siehe `prisma/schema.prisma`-Kopfkommentar).

**FinalInvoiceDeduction (Phase 5, Abzugs-Snapshot einer Schlussrechnung)**
`id` · `finalInvoiceId` · `downpaymentInvoiceId` · `number` · `issueDate` · `netCents` · `taxCents` · `grossCents` · `taxRate` · `taxCategory` — je Abschlagsrechnung/Steuersatz eine Zeile, beim Festschreiben der Schlussrechnung einmalig erzeugt und danach nie geändert; `@@unique([finalInvoiceId, downpaymentInvoiceId, taxRate, taxCategory])`. Details siehe „Teil-, Abschlags- und Schlussrechnungen" unten.

**Payment (Zahlung)**
`id` · `invoiceId` · `amountCents` · `paidAt` · `method` (TRANSFER | CASH | CARD | SEPA) · `reference` · `isSkonto` (bool — §17-Fall, **keine** Rechnungsberichtigung nötig) · `createdAt`

**Dunning (Mahnung)**
`id` · `invoiceId` · `level` (`Int`, kein Enum: 0 = Zahlungserinnerung, 1 = 1. Mahnung, 2 = 2. Mahnung, 3 = 3. Mahnung — Titel in `src/lib/dunning.ts`) · `sentAt` · `dueDate` · `baseInterestRatePermille?` (Snapshot Basiszins zum Verzugsstichtag) · `interestRatePoints?` (5 oder 9 Pp, abhängig `Customer.type`) · `interestAmountCents` · `lateFeeCents` (nur konkrete Porto-/Materialkosten, **nicht** Pauschale) · `flatFee40Cents` (nur `type=BUSINESS`, §288 Abs.5) · `pdfPath?`
→ Verzugslogik: Level-0-Erinnerung kostenfrei (verzugsbegründend, h.M. nicht ersatzfähig); ab Level-1 Verzugsschaden.

**ChangeLog (append-only Änderungsprotokoll)** — GoBD-Kern
`id` · `orgId` · `entity` (INVOICE | PAYMENT | …) · `entityId` · `action` (CREATE | UPDATE | FINALIZE | CANCEL | DELETE_PRE_FINALIZE) · `actorId` · `at` · `diff` (JSON: alte→neue Werte) · `prevHash` · `hash`
→ Append-only: **kein** UPDATE/DELETE-Recht (DB-User ohne diese Grants + App-Layer), Hash-Chain (`hash = sha256(prevHash + canonical(diff))`) macht Manipulation erkennbar.

**Phase 1: Verknüpfungen, Stammdaten, Lieferschein** — zehn zusätzliche Tabellen. `DocumentRelation` bildet Beleg-zu-Beleg-Verknüpfungen (Umwandlung, Storno, Korrektur, Abo-Erzeugung) explizit ab, ergänzend zu den bisherigen Fremdschlüsseln. `DeliveryNote`/`DeliveryNoteLine` bilden den Lieferschein als eigenes, nummeriertes Dokument mit Snapshot ab (Service `createDeliveryNote`, UI seit Phase 3a). `TextTemplate` und `EmailTemplate` speichern wiederverwendbare Text-/Mailvorlagen je Organisation, `EmailLog` protokolliert versendete Mails. `CustomerAddress` und `ContactPerson` erlauben mehrere Adressen/Ansprechpartner je Kunde zusätzlich zur Stammadresse. `PaymentMethod` und `DunningStage` sind Organisations-Stammdaten (Systemzahlungsmethoden bzw. Mahnstufen), die per Migration und bei Organisationsanlage (`ensureOrgMasterdata`) angelegt werden; `Dunning.stageId` verweist künftig auf `DunningStage` statt nur auf `level`.

### Dokumentworkflow (Phase 3a): Zustandsmaschinen, abgeleiteter Abrechnungsstand, Kette, Textvorlagen

Angebot/Auftragsbestätigung (`Quote`) und Lieferschein (`DeliveryNote`) sind — anders als `Invoice` — **keine** GoBD-Belege und bleiben frei editier-/löschbar; sie haben aber eigene Statusmaschinen mit fester Übergangstabelle (`src/domain/document/status.ts`), gegen die jeder Wechsel geprüft wird (`assertTransition`), transaktional läuft und einen `ChangeLog`-Eintrag schreibt (Nachvollziehbarkeit, auch ohne GoBD-Pflicht):

- **Quote**: `DRAFT → {SENT, ACCEPTED, REJECTED, CANCELLED}`, `SENT → {ACCEPTED, REJECTED, CANCELLED}`, `ACCEPTED → {CANCELLED}`, `EXPIRED → {SENT, ACCEPTED}`, `REJECTED`/`CANCELLED` terminal. `EXPIRED` ist **kein** gespeicherter Wert und kann **nicht** aktiv als Ziel gesetzt werden (`setQuoteStatus(..., "EXPIRED")` wirft `StatusTransitionError`) — er wird bei jedem Lesezugriff aus `validUntil` abgeleitet (`effectiveQuoteStatus`, `src/domain/document/status.ts`) und bleibt nur als QUELLZUSTAND in der Übergangstabelle. DRAFT/SENT gilt als abgelaufen, wenn `validUntil` in der Vergangenheit liegt. Beim Übergang nach `SENT` wird — falls noch kein Snapshot existiert oder er aus `CREATE` stammt — ein neuer Käufer-/Verkäufer-Snapshot (Quelle `SENT`) eingefroren; `ACCEPTED`/`REJECTED` setzen `decidedAt`/`decisionNote`.
- **DeliveryNote**: `DRAFT → {CREATED, CANCELLED}`, `CREATED → {SENT, DELIVERED, CANCELLED}`, `SENT → {DELIVERED, CANCELLED}`, `DELIVERED → {CANCELLED}`. Der Übergang `DRAFT → CREATED` vergibt — falls noch keine Nummer existiert (z. B. bei einem duplizierten Entwurf) — erst hier eine Nummer aus dem Nummernkreis `DELIVERY_NOTE`, da `DRAFT` als reiner Entwurf nicht zählt. `INVOICED` ist im Schema als möglicher Statuswert vermerkt, aber **nicht** Teil der Übergangstabelle (siehe `docs/LIMITATIONEN.md`) — ob ein Lieferschein bereits abgerechnet ist, ergibt sich aus der Relation, nicht aus dem Status.
- **Archivieren** (`setArchived`, für `QUOTE`/`DELIVERY_NOTE`) ist rein organisatorisch (`archivedAt`), kein Statuswechsel, ebenfalls mit `ChangeLog`-Eintrag.

**Abgeleiteter Abrechnungsstand** (`src/domain/document/billing-state.ts`, `billingStateFor`): Ob ein Angebot/eine AB bereits (teilweise) abgerechnet ist, wird **nicht** gespeichert, sondern bei jeder Abfrage aus den `DocumentRelation`-Einträgen berechnet (Datenmodell aus Phase 3a vorbereitet, Erzeugung seit Phase 5 — Details inkl. `hasActiveFinal` siehe „Teil-, Abschlags- und Schlussrechnungen" unten, Abschnitt „Abrechnungsstand").

**Dokumentkette** (`src/domain/document/chain.ts`, `buildDocumentChain`): baut für einen beliebigen Beleg den vollständigen Beziehungsbaum. Zuerst wird rückwärts über `DocumentRelation` der am weitesten zurückverfolgbare Vorgänger gesucht (`findRoot`, max. `MAX_ROOT_DEPTH = 6` Ebenen, Zyklenerkennung per besuchte-Knoten-Set), dann rekursiv vorwärts der Baum aus allen ausgehenden Relationen aufgebaut, inklusive `Payment`/`Dunning` als Blattknoten unter einer `Invoice`. `DUPLICATED_FROM`-Relationen zählen dabei **nicht** als Vorgänger (`findRoot` überspringt sie, sonst würde das Öffnen des Originals fälschlich eine später davon gezogene Kopie als Wurzel behandeln) und werden im Vorwärtsbaum nur als nicht weiter expandiertes Blatt angehängt (Label `Kopie`/`Kopie von`, je nach Blickrichtung). Mandantengeprüft (`orgId`-Filter in jedem Teilschritt); ein Knoten, dessen Beleg laut Relation existiert, aber nicht (mehr) sichtbar ist, wird als Platzhalter (`status: "UNBEKANNT"`) angezeigt statt den Aufbau abzubrechen. Wird auf allen Belegdetailseiten (Angebot, Rechnung, Lieferschein) angezeigt; `internalNotes` fließt **nie** in einen Kettenknoten ein.

**Generische Konvertierung** (`src/domain/document/convert.ts`, `convertDocument`): ein Einstiegspunkt, der per Zod (`convertDocumentSchema`) parst und nach `toKind` verzweigt — Angebot/AB/Proforma → Rechnung (`convertDocumentToInvoice`, neue `Invoice` im Status `DRAFT`, Positionen kopiert, Kopf-/Fußtext/Zahlungsbedingungen vom Quelldokument oder per Selbstheilung aus der `INVOICE`-Textvorlage), Angebot → AB (`convertQuoteToOrderConfirmation`, setzt das Angebot bei Bedarf auf `ACCEPTED`, kopiert die Positionen in ein neues Geschäftsdokument über `createBusinessDocumentWithinTx`; nur `kind=ANGEBOT` ist zulässige Quelle), Angebot/AB/Rechnung → Lieferschein (`convertToDeliveryNote`, Mengen aus Eingabe oder Restmenge, `assertNoOverDelivery` verhindert Überlieferung anhand `remainingQuantities`, Laden und Prüfung laufen innerhalb derselben Transaktion wie das Anlegen). Jede Zielkonvertierung prüft zusätzlich den effektiven Quellstatus (`effectiveQuoteStatus`) — Angebot→AB und Angebot→Rechnung nur aus `DRAFT/SENT/ACCEPTED/EXPIRED`, AB→Rechnung nur aus `DRAFT/SENT`, →Lieferschein Quote `DRAFT/SENT/ACCEPTED/EXPIRED` bzw. Invoice `!= CANCELLED`; sonst `ConvertError` (409). Jede Variante schreibt Erzeugung, `DocumentRelation` (`CONVERTED_TO` bzw. `DELIVERED_BY`) und `ChangeLog` in **einer** Transaktion (Lastenheft 50).

**Duplizieren** (Relation `DUPLICATED_FROM`) und **Standard-Dokumenttexte**: `TextTemplate` (Positionen `HEAD`/`FOOT`/`TERMS_DELIVERY`/`TERMS_PAYMENT`, `@@unique([orgId, docType, position, name])`) liefert per `pickTextTemplate` (`src/domain/text-template/pick.ts`) die als Standard markierte oder älteste passende Vorlage; neue Belege übernehmen den Text als Snapshot (Selbstheilung — fehlt eine Vorlage, bleibt das Feld leer statt einen Fehler zu werfen). Kopf-/Fußtexte erscheinen im PDF, **nicht** im XRechnung-/ZUGFeRD-XML.

**MCP-Tools** (`src/mcp/server.ts`, Lastenheft 55, gleiche Zod-Validierung wie die UI/API-Pfade — keine Bypass-Pfade): `convert_document`, `create_delivery_note`, `set_document_status`, `duplicate_document`, ergänzend zu `convert_document_to_invoice`. Fehlt ein Beleg, wirft die Domain `NotFoundError` (`src/domain/errors.ts`), das API-/MCP-Boundary mappt das auf HTTP 404.

### Online-Angebotsannahme (Phase 3b): öffentlicher Pfad, Token-Hashing, Rate-Limit

Ein **Angebotslink** (`QuoteShareLink`, `src/domain/quote-share/link.ts`) erlaubt einem Kunden, ein Angebot **ohne Login** anzusehen, als PDF herunterzuladen und anzunehmen/abzulehnen — der einzige öffentliche Schreibpfad der Anwendung.

- **Öffentlicher Pfad ohne Navigation**: `src/proxy.ts` lässt zwei Präfixe ohne Session durch — `/angebot/` (Seite) und `/api/public/` (PDF) — und markiert beide zusätzlich mit dem Request-Header `x-oig-public: 1` (`NextResponse.next({ request: { headers } })`). Das Root-Layout (`src/app/layout.tsx`) liest diesen Header und rendert für diese Anfragen nur eine schlanke Hülle (Logo, kein Menü, kein Logout) — bewusst **kein** eigenes Route-Group-Layout, da ein verschachteltes Layout die im Root-Layout gerenderte interne Navigation nicht entfernen kann.
- **Token-Hashing + verschlüsselter Wiederabruf** (Adjudikation Task-1-Fix-Runde): `src/domain/quote-share/token.ts` erzeugt ein 256-Bit-Zufallstoken (`generateToken`); gespeichert wird `SHA-256(token)` (`QuoteShareLink.tokenHash`, `@unique`) **und** zusätzlich `AES-256-GCM(token)` mit einem aus `AUTH_SECRET` abgeleiteten Schlüssel (`QuoteShareLink.tokenEnc`, `src/lib/crypto/secrets.ts`). Alle öffentlichen Pfade (`resolveShareToken`, `resolveShareLinkForDecision`, `/api/public/…`) lösen ausschließlich über `tokenHash` auf und rühren `tokenEnc` nie an. Der Wiederabruf läuft ausschließlich über `revealShareLinkToken(orgId, linkId)` (`src/domain/quote-share/link.ts`) — ein authentifizierter, org-geprüfter Pfad, genutzt vom Betreiber-Panel (`GET /api/documents/[id]/share-links/[linkId]/token`) und von `{{offer.link}}` beim Vorbelegen (`src/domain/email/compose.ts`, `resolveOfferLink`): existiert für ein Angebot ein gültiger, nicht entschiedener Link, wird dessen URL eingesetzt; sonst bleibt die Platzhalter-Zeile leer — es wird beim Vorbelegen **kein** neuer Link mehr automatisch erzeugt (siehe `docs/LIMITATIONEN.md`).
- **Einheitliches 404**: `resolveShareToken` liefert für jeden Ungültigkeitsfall (unbekanntes, widerrufenes, abgelaufenes Token; archiviertes/storniertes Angebot) einheitlich `null` — die öffentliche Seite und die PDF-Route unterscheiden nicht, welcher Fall vorliegt (keine Information für einen Angreifer, ob ein Token je existiert hat).
- **Rate-Limit** (`src/lib/rate-limit.ts`, In-Memory, prozesslokal — siehe `docs/LIMITATIONEN.md`): die PDF-Route begrenzt auf 30 Aufrufe/Minute je Token-Hash; die Entscheidung (`decideOffer`, `src/domain/quote-share/decide.ts`) auf 10/Minute je IP **und** je Token-Hash — verhindert sowohl das Durchprobieren vieler Tokens von einer IP als auch wiederholte Angriffe auf ein Token über wechselnde IPs.
- **Einzige öffentliche Schreibaktion**: die Server Action `decideOfferAction` (`src/app/angebot/[token]/actions.ts`) ruft ausschließlich `decideOffer` auf; IP-Ermittlung aus `cf-connecting-ip` (Cloudflare, bevorzugt) bzw. dem ersten Eintrag aus `x-forwarded-for` (`src/lib/http/client-ip.ts`) — nur gespeichert, wenn `DocumentSettings.storeAcceptIp` aktiviert ist, nie im `ChangeLog`.
- **Automatik nach Annahme**: `DocumentSettings.onQuoteAccept` (`NONE`/`ORDER_CONFIRMATION`/`INVOICE`) steuert, ob `decideOffer` nach einer Annahme automatisch `convertDocument` aufruft; ein Fehler dort bleibt am Angebot als `automationError` hängen, ohne die bereits verbuchte Entscheidung zurückzunehmen (eigene Transaktion, siehe `src/domain/quote-share/decide.ts`).
- **Betreiber-Sicht**: `ShareLinkPanel`/`ShareLinkPanelClient` (`src/components/`) auf `dokumente/[id]` (nur `kind=ANGEBOT`, Status DRAFT/SENT/EXPIRED) erzeugen/widerrufen Links über `/api/documents/[id]/share-links(/[linkId])`; über „Link anzeigen" (`GET .../share-links/[linkId]/token`) kann der Klartext-Link jedes noch gültigen Links jederzeit erneut im selben Dialog mit Kopieren-Button abgerufen werden — kein Einmal-Link mehr.

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

### Pricing-Modul (Phase 4a): Rabatte, Skonto, Zahlungsmethoden

**Rabatt/Aufschlag** (`src/lib/pricing/`, reine Funktionen, kein DB-Zugriff):

- **Positionsrabatt** (`line.ts`, `computeLineNet`): Prozent (`discountPermille`, 0..1000) **und** Festbetrag (`discountCents`) kombinierbar, in dieser Reihenfolge auf den Bruttozeilenwert angewandt. Uebersteigt die Kombination aus Prozent- und Festbetragsrabatt den Bruttozeilenwert, wird `lineNetCents` still auf 0 gekappt (`Math.max(0, …)`) — **kein** `PricingError` (Ruling Fix-Welle Phase 4a: bewusst kappen statt ablehnen, damit z. B. ein grosszuegig gerundeter Festbetragsrabatt keine Position blockiert). `PricingError` wird nur bei strukturell ungueltigen Eingaben geworfen (negative Menge/Preis, `discountPermille` ausserhalb 0..1000, negativer `discountCents`).
- **Belegrabatt/-aufschlag** (`allocate.ts`, `applyDocumentAdjustments`): wird proportional auf die Steuersatz-Buckets (19 %/7 %/0 %) verteilt, nach dem **Largest-Remainder-Verfahren** (`allocateProportional`) — Rundungsdifferenzen landen deterministisch beim Bucket mit dem größten Bruchteil (bei Gleichstand beim kleineren Index), sodass die Summe der Buckets exakt dem Gesamtbetrag entspricht.
- **Vorzeichen-Invarianz**: Bei Storno/Gutschrift sind die Steuersatz-Buckets negativ (gespiegelte Originalrechnung); `applyDocumentAdjustments` rechnet intern auf den negierten (positiven) Beträgen wie bei einer regulären Rechnung und negiert das Ergebnis zurück — Rabatt-/Aufschlagsbeträge bleiben dadurch für Storno und Gutschrift exakt spiegelbildlich zur Originalrechnung. Gemischte Vorzeichen über die Buckets hinweg sind bei einer Anpassung ≠ 0 unzulässig (`PricingError`).
- **Teilgutschrift**: Festbetragsrabatte (Positions- wie Belegebene) werden proportional zur erstatteten Menge/den erstatteten Positionen herunterskaliert, nie 1:1 vom Originalbeleg übernommen — sonst würde eine Teilgutschrift über mehrere Festbetragsrabatte hinweg mehr erstatten als ursprünglich gewährt.
- **E-Rechnung-Mapping**: Positionsrabatt → `AllowanceCharge` auf Zeilenebene, Belegrabatt/-aufschlag → `AllowanceCharge` auf Dokumentebene je Steuersatz (EN 16931 BG-27/BG-28 Zeile, BG-20/BG-21 Dokument; BT-107/BT-108 Netto-Summenfelder) — sowohl UBL (`xrechnung.ts`) als auch CII (`cii.ts`).

**Skonto** (`src/lib/pricing/skonto.ts`): bis zu zwei Skontoziele (`skonto1…`/`skonto2…Permille`/`…Days`) je Rechnung; Ziel 2 ist nur zusammen mit Ziel 1 und mit einer längeren Frist zulässig (Zod-Validierung, `documentAdjustmentFields` in `src/schemas/index.ts`). `computeSkontoTerms` berechnet Fälligkeitsdatum, Skontobetrag und Zahlbetrag je Ziel; die BT-20-Freitext-Syntax `#SKONTO#TAGE=n#PROZENT=x.xx#` (eine Zeile je Ziel) wird sowohl in den PDF-Zahlungsbedingungen als auch im UBL-/CII-`PaymentTerms`-Feld ausgegeben (Details + Quelle: `COMPLIANCE.md` Abschnitt 11). Der Zahlungseingang (`src/domain/invoice/payment.ts`) erkennt anhand `paidAt` und Zahlbetrag automatisch einen möglichen Skontoabzug, schlägt ihn im Formular vor und markiert die Zahlung bei Bestätigung als `isSkonto = true`; eine Überzahlung über den offenen Betrag hinaus wird gesperrt.

**Zahlungsmethoden** (`PaymentMethod`, `src/domain/payment-method/manage.ts`): Organisations-Stammdaten mit UI-CRUD (`/einstellungen/zahlungsmethoden`), Systemcodes (u. a. `SKONTO`, per Backfill/`ensureOrgMasterdata` je Organisation angelegt) und einem optionalen Kunden-Default (`Customer.defaultPaymentMethodId`). Beim Festschreiben einer Rechnung wird die gewählte Zahlungsmethode als Snapshot auf die Rechnung übernommen (unabhängig von späteren Änderungen an der Stammdaten-Zahlungsmethode) und liefert den `PaymentMeansCode` (UNTDID 4461, z. B. `58` SEPA-Überweisung) fürs XML; ohne hinterlegte IBAN fällt der Export auf Code `1` („Nicht näher spezifiziert") zurück, statt eine ungültige/leere `PaymentMeans`-Angabe zu erzeugen.

### Editor (Phase 4b): Positionsbloecke, Rich-Text, Beleganhaenge

**Positionstypen** (`QuoteLine.lineType` / `InvoiceLine.lineType`, `String @default("ITEM")`, §8): `ITEM` (regulaere Position, wie bisher), `HEADING` (Zwischenueberschrift), `TEXT` (Textblock ohne Betrag) und `SUBTOTAL` (Zwischensumme). `HEADING`/`TEXT`/`SUBTOTAL` tragen nie Menge/Preis/Betrag und werden **nicht** in der Datenbank als Summenwert gespeichert — eine `SUBTOTAL`-Zeile wird bei jeder Anzeige/PDF-/XML-Erzeugung aus den vorangehenden `ITEM`-Zeilen desselben Abschnitts neu berechnet (kein „Menge-0"-Workaround, kein gespeicherter Zwischensummenwert, der veralten koennte). Im E-Rechnung-Export (XRechnung/ZUGFeRD) erscheinen **ausschliesslich `ITEM`-Zeilen** als `InvoiceLine`/`CrossIndustryInvoice`-Position — `HEADING`/`TEXT`/`SUBTOTAL` sind reine Anzeige-/Gliederungshilfen fuer PDF und Editor und fliessen nicht ins strukturierte XML (BR-16 zaehlt entsprechend nur `ITEM`-Zeilen, siehe Commit `d1e24ba`).

**Rich-Text** (`src/lib/richtext/`, reine Funktionen, kein DB-Zugriff): Positionsbeschreibungen (BT-154, Freitext-Detailbeschreibung) koennen eine eingeschraenkte Markdown-Teilmenge nutzen — Absaetze, `\n`-Zeilenumbrueche, `**fett**`/`_kursiv_`/`__unterstrichen__` (auch verschachtelt), eine Ebene ungeordneter/geordneter Listen sowie Links (`[Text](https://…)` oder `mailto:…`; andere Schemata werden zu Klartext). Gespeichert wird immer die Markdown-Teilmenge selbst (nie HTML) — `parse.ts` baut daraus eine Zwischendarstellung (`Block[]`/`Run[]`, `types.ts`), aus der drei Renderer erzeugen: `render-html.ts` (Editor-Vorschau, mit Escaping — kein rohes HTML wird je durchgereicht), `render-pdf.ts` (Text-Runs fuers PDF) und `plain-text.ts` (Klartext fuer BT-154 im E-Rechnung-XML, das kein Markup kennt). `sanitize.ts` prueft erlaubte Link-Schemata.

**Artikelnummer** (`Product.articleNumber` als Stammdaten-Default, `QuoteLine.articleNumber` / `InvoiceLine.articleNumber` je Position uebernehmbar/ueberschreibbar): wird als BT-155 (Kaeuferidentifikation des Artikels bzw. Verkaeufer-Artikelnummer je nach Mapping) ins E-Rechnung-XML uebernommen, sofern gesetzt.

**Rechnungs-Kopffelder**: Betreff, Bestellnummer (`orderNumber`, BT-13 „Referenz der Bestellung"), interne Referenz, Ansprechpartner sowie eine von der Stammdaten-Rechnungsadresse abweichende Liefer-/Rechnungsadresse je Beleg — Freitextfelder auf `Invoice`/`Quote`, editierbar ueber `updateDraftInvoice` (`src/domain/invoice/`) bzw. das Editor-UI.

**Rechnungsentwurf bearbeiten** (`updateDraftInvoice`): nur `DRAFT`-Rechnungen sind aenderbar (GoBD, festgeschriebene Rechnungen bleiben unveraenderbar); der Rechnungstyp (Standard/Storno/Gutschrift) ist beim Bearbeiten fix. Nicht uebergebene Felder bleiben unveraendert; wird `lines` uebergeben, werden alle Positionen ersetzt.

**Beleganhaenge** (`DocumentAttachment`, `src/domain/attachment/manage.ts`, `src/lib/attachments/`): Datei-Upload je Beleg (Rechnung/Angebot/Lieferschein/Abo/Mahnung ueber `docType`/`docId`). Speicherpfad `<ATTACHMENTS_DIR>/<orgId>/<sha256[0:2]>/<sha256>` — org-getrennt, hash-adressiert (Dedup: derselbe Inhalt landet je Organisation immer unter demselben Pfad, ein zweites Speichern schreibt nichts erneut); der in der DB gespeicherte `storagePath` ist relativ zu `ATTACHMENTS_DIR`, sodass ein Wechsel des Verzeichnisses (z. B. Docker-Volume) bestehende Zeilen nicht invalidiert. Zwei unabhaengige Pruefungen vor dem Speichern (`src/lib/attachments/mime.ts`): Whitelist des behaupteten MIME-Typs (Zod) **und** Magic-Bytes-Erkennung des tatsaechlichen Inhalts (`sniffMime`) muessen uebereinstimmen — verhindert sowohl eine umbenannte ausfuehrbare Datei unter erlaubter Endung als auch eine echte Datei unter nicht erlaubter Endung. Grenzen: 10 MB je Datei, 50 MB Summe je Beleg (`MAX_ATTACHMENT_FILE_BYTES`/`MAX_ATTACHMENT_TOTAL_BYTES_PER_DOC`, `src/lib/attachments/mime.ts`). Hinzufuegen/Entfernen wird ins `ChangeLog` geschrieben (Aktion ADD/REMOVE) — Anhaenge sind kein GoBD-Beleg selbst, aber die Aktion am Beleg ist auditierbar. Anhaenge lassen sich beim Mailversand als Zusatzanhang auswaehlen (`src/domain/email/attachments.ts`).

**Editor-UI**: Drag-and-Drop zum Umordnen von Positionen/Bloecken, Positionen duplizieren (inkl. `lineType`), Produkt-Picker mit Inline-Anlage eines neuen Produkts ohne Verlassen des Editors, Anhang-Panel mit Drag-and-Drop-Upload (`src/components/AttachmentPanel.tsx`).

**MCP**: `update_invoice_draft` (Kopffelder + Positionen inkl. `lineType`, nur `DRAFT`), `add_attachment` / `list_attachments` / `remove_attachment` (Datei als Base64, dieselben Validierungen/Grenzen wie das UI — kein Bypass-Pfad) — siehe `docs/MCP.md`.

### Teil-, Abschlags- und Schlussrechnungen (Phase 5)

**Drei neue Rechnungstypen** (`Invoice.type`: `PARTIAL`, `DOWNPAYMENT`, `FINAL`), alle regulär GoBD-Rechnungen (Entwurf → `finalizeWithinTx` → Storno/Gutschrift, kein Sonderpfad):

- **`PARTIAL`** (`src/domain/invoice/partial.ts`, `createPartialInvoice`): Teilrechnung über eine bereits erbrachte Teilleistung, Quelle Angebot/AB (`sourceType: "QUOTE"`) oder Lieferschein (`sourceType: "DELIVERY_NOTE"`). Fünf Modi: `PERCENT`/`NET_AMOUNT`/`GROSS_AMOUNT` (Anteil je Steuersatz-Bucket über `splitByTaxRate`, `src/lib/pricing/partial.ts`) sowie `POSITIONS`/`QUANTITIES` (Positionskopien mit Überberechnungsschutz über `billedQuantities`, `src/domain/invoice/billed-quantities.ts` — analog `remainingQuantities` bei Lieferscheinen).
- **`DOWNPAYMENT`** (`src/domain/invoice/downpayment.ts`, `createDownpaymentInvoice`): Abschlagsrechnung **vor** Leistungserbringung, nur aus Angebot/AB, Modi `PERCENT`/`AMOUNT`. Löst § 13 Abs. 1 Nr. 1 Buchst. a Satz 4 UStG aus (Steuerentstehung bei Vereinnahmung) — PDF trägt den entsprechenden Pflichthinweis, E-Rechnung setzt `InvoiceTypeCode`/`TypeCode` **386** (UNTDID 1001). Prüft beim Anlegen, dass Σ festgeschriebener, nicht stornierter Abschläge (brutto) + neuer Abschlag ≤ Gesamtleistung der Quelle bleibt.
- **`FINAL`** (`src/domain/invoice/final.ts`, `createFinalInvoice`): Schlussrechnung über die **Gesamtleistung** — kopiert alle Zeilen (inkl. HEADING/TEXT/SUBTOTAL) sowie Beleg-Rabatt/-Aufschlag der Quelle 1:1. Setzt mindestens eine festgeschriebene, nicht stornierte Abschlagsrechnung voraus und verweigert eine zweite Schlussrechnung auf derselben Quelle.
- **Anteilsbasis ist immer die Gesamtleistung NACH Beleg-Rabatt/-Aufschlag der Quelle** — `bucketsFromLines`/`splitByTaxRate` bauen die Steuersatz-Buckets über `computeTaxBreakdown` (`src/lib/tax.ts`) mit den `documentDiscount…`/`documentCharge…`-Feldern der Quelle, nicht über die rohe Positionssumme (Fix-Runde 2, Task 2).
- **Mischverbot**: eine Quelle darf entweder Teilrechnungen **oder** Abschlagsrechnungen tragen, nie beide — `createPartialInvoice`/`createDownpaymentInvoice` prüfen das jeweils gegenseitig.

**Abzugs-Snapshot** (`FinalInvoiceDeduction`, Migration `phase5_partial_invoices`): beim Festschreiben (`finalizeWithinTx`, `type === "FINAL"`) werden alle festgeschriebenen, nicht stornierten `DOWNPAYMENT`-Rechnungen der Quelle geladen (Relation `DOWNPAYMENT_OF`), ihre Steuersatz-Buckets über `deductionsFor` (`src/lib/pricing/partial.ts`) den aktuellen Gesamtleistungs-Buckets gegenübergestellt und je Abschlagsrechnung/Steuersatz eine unveränderliche Zeile geschrieben (Nummer/Datum der Abschlagsrechnung, netto/USt/brutto — Abschn. 14.8 UStAE). `prepaidCents = Σ Abschläge brutto`, `payableCents = grossTotalCents − prepaidCents` (Fehler bei negativem Rest). Die Zeilen werden **nie** nachträglich verändert oder aus laufenden Abschlagsrechnungen neu berechnet — Storno einer Abschlagsrechnung nach der Schlussrechnung wirkt sich auf den Snapshot nicht mehr aus (siehe `docs/LIMITATIONEN.md`). `src/lib/db.ts` blockt update/delete/updateMany/deleteMany auf `FinalInvoiceDeduction` über den geschützten `prisma`-Client vollständig (Fix-Welle, B9) — Zeilen entstehen ausschließlich einmalig per `createMany` innerhalb von `finalizeWithinTx`. Der `FINALIZE`-ChangeLog-Eintrag einer Schlussrechnung trägt zusätzlich `prepaidCents`, `payableCents` und die Nummern der abgezogenen Abschlagsrechnungen (`deductedInvoiceNumbers`) — der rechtlich entscheidende Abzug ist damit Teil der Hash-Kette, nicht nur der (davon unabhängigen) `FinalInvoiceDeduction`-Tabelle.

**Abrechnungsstand** (`billingStateFor`, `src/domain/document/billing-state.ts`): `BillingStateResult` trägt zusätzlich `billedPermille`, `downpaymentGrossCents` und (Fix-Welle, B8) `hasActiveFinal`. `FULL` gilt bei festgeschriebener `FINAL_FOR`-Rechnung, oder wenn Σ aktiver Teil-/Abschlagsrechnungen (brutto) ≥ 100 % der Quote-Bruttosumme, oder wenn alle Positionsmengen über `billedQuantities` gedeckt sind — `FULL` allein bedeutet dabei **nicht**, dass bereits eine Schlussrechnung existiert (100 % Abschlagsdeckung erreicht `FULL`, obwohl § 14 Abs. 5 UStG weiterhin eine Schlussrechnung verlangt). `hasActiveFinal` unterscheidet diese beiden Fälle explizit und steuert in der UI (`ConvertMenu`), ob „Schlussrechnung erzeugen" noch angeboten wird — unabhängig vom Gesamtstatus FULL/PARTIAL, einzige harte Grenze ist eine bereits bestehende, nicht stornierte Schlussrechnung.

**Relationen** (`DocumentRelation`): `PARTIAL_OF`/`DOWNPAYMENT_OF`/`FINAL_FOR` zeigen **from Rechnung, to Quelle** — umgekehrt zu `CONVERTED_TO` (from Quelle, to Rechnung). `src/domain/document/chain.ts` (`findRoot`/`buildNode`) behandelt diese drei Relationstypen deshalb über einen eigenen, gegenläufigen Pfad, damit die Wurzelsuche für eine geöffnete Abschlags-/Schlussrechnung korrekt beim Angebot/Lieferschein landet und `DocumentChain` die verknüpften Belege als Kinder der Quelle anzeigt. `listRelations` (`src/domain/relations.ts`) akzeptiert seit der Fix-Welle (B13) einen optionalen Transaktions-Client — `partial.ts`/`downpayment.ts`/`final.ts` lesen die Mischverbots-/100-%-/"keine zweite Schlussrechnung"-Guards damit auf demselben Snapshot, auf dem sie auch schreiben (Restrisiko unter Postgres READ COMMITTED bei echter Nebenläufigkeit bleibt, siehe `docs/LIMITATIONEN.md`).

**Zahlungen** (`recordPayment`, `payableBaseCents`/`openAmountCents` in `src/domain/invoice/amounts.ts`): Bemessungsgrundlage für offenen Betrag, PAID-Grenze und Skonto ist `payableCents ?? grossTotalCents` — bei einer Schlussrechnung also der Rest nach Abzug der Abschläge, nicht die Gesamtleistung. Dieselbe Basis nutzen seit der Fix-Welle auch die Skonto-Vorschau (`GET /api/invoices/[id]/skonto-check`, B4), der E-Mail-Platzhalter `{{invoice.openAmount}}` (`src/domain/email/context.ts`, B2) und die Mahnung (`createDunning`, `src/domain/dunning/create.ts`, B7 — PARTIAL/DOWNPAYMENT/FINAL sind seither ebenso mahnbar wie INVOICE/CORRECTION).

**Storno einer Schlussrechnung** (`cancelInvoice`, `src/domain/invoice/cancel.ts`): baut genau eine Summenzeile je Steuersatz/-kategorie direkt aus dem beim Festschreiben gespeicherten `taxBreakdownJson` (bereits nach Beleganpassung) minus der `FinalInvoiceDeduction`-Beträge, geglättet über `reconcileNetsForGross` (`src/lib/pricing/partial.ts`, Fix-Welle B6), sodass die Storno-Gutschrift in Summe `-payableCents` ergibt (nicht `-grossTotalCents`) — auch bei Beleg-Rabatt und gemischten Steuersätzen. Bei **mehreren** Steuersätzen ist das in der großen Mehrheit der Fälle exakt; bei **genau einem** Steuersatz bleibt rechnerisch bedingt eine Abweichung von ±1 Cent möglich (siehe `docs/LIMITATIONEN.md`).

**E-Rechnung** (`src/lib/einvoice/`): `EInvoiceData.deductions`/`precedingInvoices` (mehrfaches BG-3) nur bei `type === "FINAL"`, ausschließlich aus dem `FinalInvoiceDeduction`-Snapshot (nie live aus den Abschlagsrechnungen). BT-113 (Paid amount) = Σ Abschläge brutto, BT-115 = Restbetrag, BT-22 zusätzlicher Freitext mit der Abzugsaufstellung. CII bekam dabei erstmals `ram:InvoiceReferencedDocument` (BG-3), analog zum bestehenden UBL-`cac:BillingReference`. Details + Rechtsgrundlagen: `COMPLIANCE.md` Abschnitt 14.

**Nicht duplizierbar**: `duplicateInvoice` lehnt `PARTIAL`/`DOWNPAYMENT`/`FINAL` mit `InvalidOperationError` (409) ab.

**UI**: `ConvertMenu` auf der Angebots-/AB-Seite bietet „Teilrechnung…"/„Abschlagsrechnung…"/„Schlussrechnung erzeugen"; die Lieferschein-Detailseite bietet seit der Fix-Welle (B11) ebenfalls „Teilrechnung…" (`GET /api/delivery-notes/[id]/billing`, Anteils-Modi PERCENT/NET_AMOUNT/GROSS_AMOUNT nur, wenn alle Positionen einen Preis tragen — sonst nur POSITIONS/QUANTITIES). Die Rechnungsseite zeigt bei `FINAL` einen Abzugsblock (je Abschlag eine Zeile, danach fett der Restbetrag) und einen Bezug-Link zur Quelle.

**MCP**: `create_partial_invoice`, `create_downpayment_invoice`, `create_final_invoice`, `get_billing_state` (`src/mcp/server.ts`) — dieselben Domain-Funktionen/Zod-Schemas wie die Routen, keine Bypass-Pfade (siehe `docs/MCP.md`).

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

## 3. E-Mail

Belegversand per E-Mail (Lastenheft 17–22): Vorlagen, Rendering, SMTP-Versand, Historie.

### Module
- `src/lib/mail/provider.ts` — `MailProvider`-Interface (`send(mail): Promise<{ providerId }>`), providerunabhängig.
- `src/lib/mail/smtp.ts` — Produktiv-Implementierung (nodemailer/SMTP); `src/lib/mail/memory.ts` — In-Memory-Implementierung für Tests. Aktuell einziger Produktivweg ist SMTP; das Interface ist bewusst so geschnitten, dass ein späterer Resend-/SES-Provider ohne Änderungen an `domain/email` andockt.
- `src/lib/template/` — Platzhalter-Definition (`placeholders.ts`), Rendering (`render.ts`) und Formatierung (`format.ts`) der Vorlagentexte (`{{document.number}}` u. Ä.).
- `src/lib/crypto/secrets.ts` — AES-256-GCM-Verschlüsselung des SMTP-Passworts; Schlüssel per HKDF-SHA256 aus `AUTH_SECRET` (Info `oig-mail-settings-v1`). Ein Wechsel von `AUTH_SECRET` macht gespeicherte Passwörter unlesbar (siehe `docs/LIMITATIONEN.md`).
- `src/domain/email/` — reine Domain-Logik: `settings.ts` (Laden/Speichern `MailSettings`, Testmail), `context.ts` (Platzhalter-Kontext aus dem Beleg bauen, wirft bei Fremd-Org/falschem Typ), `attachments.ts` (Standardanhänge, u. a. PDF/XRechnung), `compose.ts` (Vorbelegung aus Vorlage), `send.ts` (eigentlicher Versand).

### Ablauf (`sendDocumentEmail`, `src/domain/email/send.ts`)
1. Mail-Einstellungen laden (`MailNotConfiguredError`, falls keine SMTP-Konfiguration hinterlegt ist).
2. Mandanten-Gate: Beleg über `buildTemplateContext` laden — wirft bei Fremd-Org, falschem Belegtyp oder Nichtexistenz, **bevor** ein Log-Eintrag entsteht.
3. `EmailLog` mit Status `QUEUED` anlegen (persistiert, bevor der SMTP-Aufruf startet, damit bei einem Prozessabbruch ein Log existiert).
4. SMTP-Versand außerhalb jeder Prisma-Transaktion (kein Netzwerkaufruf innerhalb einer SQLite-Transaktion).
5. Ergebnis in EINER Transaktion verbuchen: `EmailLog` auf `SENT`/`FAILED` aktualisieren **und** `ChangeLog`-Eintrag (`entity: "EMAIL"`) anhängen — damit der Versand Teil der Hash-Chain ist wie jede andere belegrelevante Aktion.

`EmailLog` speichert Betreff/Text/Empfänger/CC/BCC/Zeitpunkt vollständig; Zusatzanhänge nur als Name/Größe/SHA-256 (Betreiberentscheidung, kein Dateiinhalt im Log).

### Snapshot-Regel
Der Mailkontext (Platzhalter wie Kundenname/-adresse) wird aus dem **Beleg-Snapshot** (Phase 0) gebaut, nicht live aus dem Kundenstamm — Rechtskonformität mit den übrigen Belegausgaben (PDF, XRechnung). Der XRechnung-Anhang wird deterministisch aus denselben Belegdaten erzeugt wie beim Festschreiben, nicht neu berechnet.

### Historisch
Frühere Planungsnotizen zu einem Resend-basierten Mailversand (falls in älteren Entwürfen erwähnt) sind überholt — umgesetzt ist ausschließlich SMTP über das `MailProvider`-Interface.

---

## 4. Lizenz-Empfehlung

Ziel: (a) niemand zahlt mehr für Rechnungssoftware, (b) keine proprietäre Closed-Source-SaaS-Abzweigung, (c) maximale Community-Beiträge.

### EMPFEHLUNG: **AGPL-3.0**

Begründung:
- **MIT/Apache-2.0** erlauben jedem, den Code zu nehmen, als gehostete SaaS zu schließen und nichts zurückzugeben — das verletzt Ziel (b) direkt. Apache bringt zwar expliziten Patent-Grant (gut), schützt aber nicht gegen Closed-SaaS.
- **AGPL-3.0** schließt die „SaaS-Lücke" der GPL: Wer den Code als Netzwerk-Dienst betreibt, muss den (modifizierten) Quellcode den Nutzern verfügbar machen. Genau der Hebel gegen die proprietäre Closed-Source-SaaS.
- Für ein **Self-Hosting-First**-Tool ist AGPL natürlich: der typische Nutzer hostet selbst und ist durch die Copyleft-Pflicht ohnehin nicht belastet; nur der Trittbrettfahrer, der zumacht, wird getroffen.
- Community-Beiträge: starkes Copyleft + glaubwürdige „bleibt-frei"-Garantie zieht beitragswillige Entwickler an, die nicht wollen, dass ihre Arbeit in einem geschlossenen Produkt verschwindet.

**Gegenrede:** AGPL schreckt Unternehmens-Integratoren ab (viele Corporate-Policies verbieten AGPL-Abhängigkeiten), was die Adoption und damit indirekt den Beitragsstrom dämpfen kann. Außerdem ist die „Netzwerk-Nutzung löst Offenlegung aus"-Pflicht in der Praxis schwer durchzusetzen. **Mitigation:** CLA/DCO einsammeln, um eine spätere Lizenz-Nachjustierung oder ein optionales kommerzielles Dual-Licensing offenzuhalten — falls breitere kommerzielle Einbettung gewünscht wird, ohne das Closed-SaaS-Schutzziel aufzugeben.

---

## 5. Ordner-/Modulstruktur

```
src/
  app/                    # Next.js App Router: Routen + api/ + actions/
    api/                  # auth/, cron/, documents/, dunnings/, invoices/, recurring/,
                           # emails/ (send, preview, prefill, [id])
    actions/              # invoices.ts, masterdata.ts, email.ts, templates.ts, result.ts (Server Actions)
    rechnungen/ dokumente/ lieferscheine/ kunden/ produkte/ abos/ einstellungen/ setup/ login/
                           # einstellungen/email (MailSettings + Testmail), einstellungen/vorlagen (EmailTemplate)
  components/             # UI-Komponenten, inkl. forms/ (CustomerForm.tsx, OrganizationForm.tsx,
                           # ProductForm.tsx, MailSettingsForm.tsx, EmailTemplateForm.tsx,
                           # TemplateRowActions.tsx, TestMailForm.tsx, fields.tsx)
  proxy.ts                # Next.js Middleware: Session-Prüfung, öffentliche Pfade (/login, /api/cron, …)
  domain/                 # framework-frei, testbar
    audit.ts
    changelog.ts          # Hash-Chain
    numbering.ts
    snapshot.ts           # Käufer-/Verkäufer-Snapshot (Phase 0)
    document/              # convert.ts, create.ts, update.ts, duplicate.ts, status.ts, chain.ts,
                           # billing-state.ts, pdf-data.ts, snapshot-input.ts
    delivery-note/          # create.ts, quantities.ts
    text-template/          # pick.ts
    relations.ts            # DocumentRelation (Phase 1), genutzt von convert.ts/chain.ts
    dunning/                # create.ts
    invoice/                # cancel.ts, create.ts, credit.ts, finalize.ts, mandatory.ts, payment.ts
    recurring/              # create.ts, run.ts
    email/                  # settings.ts, context.ts, attachments.ts, compose.ts, send.ts (siehe Abschnitt 3)
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
    mail/                   # provider.ts (Interface), smtp.ts (Produktiv), memory.ts (Tests)
    template/               # placeholders.ts, render.ts, format.ts (Mailvorlagen-Platzhalter)
    crypto/                 # secrets.ts (AES-256-GCM, Schluessel per HKDF aus AUTH_SECRET)
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

## 6. Roadmap (historisch)

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
