import { writeFileSync } from "node:fs";
import { buildFacturXCII } from "@/lib/einvoice/cii";
import type { EInvoiceData } from "@/lib/einvoice/types";

const data: EInvoiceData = {
  number: "RE-2026-0001",
  type: "INVOICE",
  issueDate: new Date("2026-06-09"),
  dueDate: new Date("2026-06-23"),
  deliveryDate: new Date("2026-06-01"),
  currency: "EUR",
  buyerReference: "RE-2026-0001",
  paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
  notes: "Vielen Dank für Ihren Auftrag.",
  seller: {
    name: "Muster Handwerk GmbH",
    addressLine1: "Lindenstr. 5",
    postalCode: "21337",
    city: "Lüneburg",
    countryCode: "DE",
    vatId: "DE123456789",
    email: "info@muster-handwerk.de",
    phone: "+49 4131 999000",
    contactName: "Erika Muster",
  },
  buyer: {
    name: "Beispiel AG",
    addressLine1: "Hafenstr. 12",
    postalCode: "20457",
    city: "Hamburg",
    countryCode: "DE",
    vatId: "DE987654321",
    email: "buchhaltung@beispiel.de",
  },
  lines: [
    { id: "1", description: "Beratung vor Ort", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, lineNetCents: 28500, taxRate: 19, taxCategory: "S" },
    { id: "2", description: "Wartungspauschale", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 14900, lineNetCents: 14900, taxRate: 19, taxCategory: "S" },
  ],
  taxSubtotals: [{ taxCategory: "S", taxRate: 19, netCents: 43400, taxCents: 8246 }],
  netTotalCents: 43400,
  taxTotalCents: 8246,
  grossTotalCents: 51646,
  payableCents: 51646,
  iban: "DE02120300000000202051",
  bic: "BYLADEM1001",
  bankName: "Muster Bank",
};

const out = process.argv[2] ?? "/tmp/cii.xml";
writeFileSync(out, buildFacturXCII(data), "utf8");
console.log("CII geschrieben:", out);
