/**
 * Demo-Daten: 1 Unternehmen, 1 Kunde, 2 Produkte, 1 Entwurf, 1 festgeschriebene
 * Rechnung. Nutzt die echten Domain-Services (Nummernkreis + Audit-Hash-Chain).
 *
 * Start: npm run db:seed
 */
import "dotenv/config";
import { dbInternal } from "@/lib/db";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createInvoiceSchema } from "@/schemas";
import { hashPassword } from "@/lib/auth/password";

async function main() {
  if (!(await dbInternal.user.findFirst())) {
    await dbInternal.user.create({ data: { email: "admin@example.com", passwordHash: hashPassword("demo1234") } });
    console.log("Demo-Admin angelegt: admin@example.com / demo1234 (bitte ändern!)");
  }

  const existing = await dbInternal.organization.findFirst();
  if (existing) {
    console.log("Es sind bereits Daten vorhanden — Seed übersprungen.");
    return;
  }

  const org = await dbInternal.organization.create({
    data: {
      legalName: "Muster Handwerk GmbH",
      addressLine1: "Lindenstr. 5",
      postalCode: "21337",
      city: "Lüneburg",
      country: "DE",
      vatId: "DE123456789",
      taxNumber: "33/123/45678",
      email: "info@muster-handwerk.de",
      phone: "+49 4131 999000",
      iban: "DE02120300000000202051",
      bic: "BYLADEM1001",
      bankName: "Muster Bank",
      electronicAddress: "info@muster-handwerk.de",
    },
  });

  const customer = await dbInternal.customer.create({
    data: {
      orgId: org.id,
      type: "BUSINESS",
      name: "Beispiel AG",
      addressLine1: "Hafenstr. 12",
      postalCode: "20457",
      city: "Hamburg",
      countryCode: "DE",
      vatId: "DE987654321",
      email: "buchhaltung@beispiel.de",
      defaultPaymentTermsDays: 14,
    },
  });

  await dbInternal.product.createMany({
    data: [
      { orgId: org.id, name: "Beratung (Stunde)", unit: "HUR", netPriceCents: 9500, taxRate: 19, taxCategory: "S" },
      { orgId: org.id, name: "Wartungspauschale", unit: "C62", netPriceCents: 14900, taxRate: 19, taxCategory: "S" },
    ],
  });

  await createDraftInvoice(
    org.id,
    createInvoiceSchema.parse({
      customerId: customer.id,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      deliveryDate: "2026-06-01",
      notes: "Vielen Dank für Ihren Auftrag.",
      paymentTerms: "Zahlbar innerhalb von 14 Tagen ohne Abzug.",
      lines: [
        { description: "Beratung vor Ort", quantityMilli: 3000, unit: "HUR", unitNetPriceCents: 9500, taxRate: 19, taxCategory: "S", discountPermille: 0 },
      ],
    }),
  );

  const draft2 = await createDraftInvoice(
    org.id,
    createInvoiceSchema.parse({
      customerId: customer.id,
      type: "INVOICE",
      taxScheme: "REGULAR",
      currency: "EUR",
      deliveryDate: "2026-05-15",
      dueDate: "2026-06-12",
      notes: "Wartung Mai 2026.",
      paymentTerms: "Zahlbar bis 12.06.2026.",
      lines: [
        { description: "Wartungspauschale", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 14900, taxRate: 19, taxCategory: "S", discountPermille: 0 },
        { description: "Materialaufschlag", quantityMilli: 2000, unit: "C62", unitNetPriceCents: 2500, taxRate: 19, taxCategory: "S", discountPermille: 0 },
      ],
    }),
  );
  await finalizeInvoice(draft2.id, { now: new Date("2026-05-20") });

  console.log("Seed fertig: 1 Unternehmen, 1 Kunde, 2 Produkte, 1 Entwurf, 1 festgeschriebene Rechnung.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => dbInternal.$disconnect());
