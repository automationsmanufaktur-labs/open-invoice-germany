/**
 * Kundenvorgaben (Phase 8a, Task 1, §28) — die zehn Felder auf Customer
 * (defaultCurrency, defaultDiscountPermille, invoiceEmail, invoiceCc, quoteEmail,
 * eInvoicePreferred, orderReference, deliveryTermsText, paymentTermsText, language).
 *
 * saveCustomerDefaults ersetzt IMMER den vollstaendigen Satz (wie die uebrigen
 * Settings-Speicherfunktionen in Phase 7) statt nur die im Payload vorhandenen Felder
 * zu mergen: ein weggelassenes optionales Feld bedeutet "kein Override" (NULL), nicht
 * "unveraendert lassen" — sonst liesse sich ein einmal gesetzter Override nie wieder
 * loeschen, ohne den kompletten Datensatz zu kennen.
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { customerDefaultsInputSchema } from "@/schemas";
import { defaultAddressFor } from "./addresses";
import { defaultContactFor } from "./contacts";

async function requireCustomer(orgId: string, customerId: string) {
  const customer = await dbInternal.customer.findFirst({ where: { id: customerId, orgId } });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
  return customer;
}

/** Validiert und speichert die zehn Kundenvorgaben-Felder (voller Ersatz, siehe Modulkommentar). */
export async function saveCustomerDefaults(orgId: string, customerId: string, rawInput: unknown) {
  await requireCustomer(orgId, customerId);
  const v = customerDefaultsInputSchema.parse(rawInput);
  return dbInternal.customer.update({
    where: { id: customerId },
    data: {
      defaultCurrency: v.defaultCurrency ?? null,
      defaultDiscountPermille: v.defaultDiscountPermille,
      invoiceEmail: v.invoiceEmail ?? null,
      invoiceCc: v.invoiceCc ?? null,
      quoteEmail: v.quoteEmail ?? null,
      eInvoicePreferred: v.eInvoicePreferred,
      orderReference: v.orderReference ?? null,
      deliveryTermsText: v.deliveryTermsText ?? null,
      paymentTermsText: v.paymentTermsText ?? null,
      language: v.language,
    },
  });
}

export interface CustomerDefaultsView {
  defaultCurrency: string | null;
  defaultDiscountPermille: number;
  invoiceEmail: string | null;
  invoiceCc: string | null;
  quoteEmail: string | null;
  eInvoicePreferred: boolean;
  orderReference: string | null;
  deliveryTermsText: string | null;
  paymentTermsText: string | null;
  language: string;
  defaultBillingAddress: Awaited<ReturnType<typeof defaultAddressFor>>;
  defaultShippingAddress: Awaited<ReturnType<typeof defaultAddressFor>>;
  defaultContact: Awaited<ReturnType<typeof defaultContactFor>>;
}

/** Liest die Kundenvorgaben inkl. der aktuellen Default-Adressen/-Ansprechpartner (§28-§30 kombiniert). */
export async function customerDefaultsFor(orgId: string, customerId: string): Promise<CustomerDefaultsView> {
  const customer = await requireCustomer(orgId, customerId);
  const [defaultBillingAddress, defaultShippingAddress, defaultContact] = await Promise.all([
    defaultAddressFor(orgId, customerId, "BILLING"),
    defaultAddressFor(orgId, customerId, "SHIPPING"),
    defaultContactFor(orgId, customerId),
  ]);
  return {
    defaultCurrency: customer.defaultCurrency,
    defaultDiscountPermille: customer.defaultDiscountPermille,
    invoiceEmail: customer.invoiceEmail,
    invoiceCc: customer.invoiceCc,
    quoteEmail: customer.quoteEmail,
    eInvoicePreferred: customer.eInvoicePreferred,
    orderReference: customer.orderReference,
    deliveryTermsText: customer.deliveryTermsText,
    paymentTermsText: customer.paymentTermsText,
    language: customer.language,
    defaultBillingAddress,
    defaultShippingAddress,
    defaultContact,
  };
}
