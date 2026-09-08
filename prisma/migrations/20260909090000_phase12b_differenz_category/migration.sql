-- Phase 12b — Differenzbesteuerung (§ 25a UStG): Steuerkategorie S -> E.
-- Kategorie S mit Satz 0 verletzt EN 16931 BR-S-05 und macht die XRechnung ungueltig.
-- NUR Entwuerfe: festgeschriebene Belege bleiben unveraendert (GoBD, Lastenheft § 51).
UPDATE "InvoiceLine" SET "taxCategory" = 'E'
 WHERE "taxCategory" = 'S'
   AND "invoiceId" IN (SELECT "id" FROM "Invoice" WHERE "taxScheme" = 'DIFFERENZ' AND "status" = 'DRAFT');

UPDATE "QuoteLine" SET "taxCategory" = 'E'
 WHERE "taxCategory" = 'S'
   AND "quoteId" IN (SELECT "id" FROM "Quote" WHERE "taxScheme" = 'DIFFERENZ' AND "status" = 'DRAFT');

-- RecurringInvoice ist eine Vorlage ohne GoBD-Charakter (status: ACTIVE|PAUSED|ENDED,
-- kein DRAFT) -> alle Zeilen der betroffenen Abos.
UPDATE "RecurringInvoiceLine" SET "taxCategory" = 'E'
 WHERE "taxCategory" = 'S'
   AND "recurringInvoiceId" IN (SELECT "id" FROM "RecurringInvoice" WHERE "taxScheme" = 'DIFFERENZ');
