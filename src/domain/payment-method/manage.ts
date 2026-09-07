/**
 * Verwaltung der Zahlungsmethoden (Phase 4a): auflisten, anlegen/aendern, loeschen.
 * Systemmethoden (isSystem, aus SYSTEM_PAYMENT_METHODS/ensureOrgMasterdata) sind vor
 * Loeschen geschuetzt und duerfen nur in einer eingeschraenkten Feldmenge geaendert
 * werden — Code, untdidCode und sortOrder bleiben Herkunft der Systemstammdaten.
 */
import { Prisma } from "@/generated/prisma/client";
import type { PaymentMethod } from "@/generated/prisma/client";
import { dbInternal } from "@/lib/db";
import { paymentMethodSchema, type PaymentMethodInput } from "@/schemas";

export class PaymentMethodNotFoundError extends Error {}
/** Systemmethoden (isSystem) duerfen nur in name/description/paymentTermsDays/invoiceText/
 *  bank-Feldern/isActive geaendert werden — code/untdidCode/sortOrder bleiben unveraendert. */
export class SystemPaymentMethodProtectedError extends Error {}
/** orgId/code ist eindeutig — statt des rohen Prisma-P2002-Fehlertexts eine fuer
 *  Anwender verstaendliche Meldung. */
export class PaymentMethodCodeConflictError extends Error {}
/** Eine referenzierte Zahlungsmethode (Rechnung oder Kunden-Default) darf nicht
 *  geloescht werden — sonst haengen Fremdschluessel/Snapshots ins Leere. */
export class PaymentMethodInUseError extends Error {}

export async function listPaymentMethods(orgId: string): Promise<PaymentMethod[]> {
  return dbInternal.paymentMethod.findMany({ where: { orgId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

/**
 * Legt eine Zahlungsmethode an (kein `id`) oder aendert sie (`id` gesetzt). Bei einer
 * Systemmethode werden code/untdidCode/sortOrder aus der Eingabe ignoriert — diese
 * bleiben aus den Systemstammdaten (SYSTEM_PAYMENT_METHODS) bestehen.
 */
export async function savePaymentMethod(orgId: string, id: string | null, rawInput: unknown): Promise<PaymentMethod> {
  const input: PaymentMethodInput = paymentMethodSchema.parse(rawInput);

  try {
    return await dbInternal.$transaction(async (tx) => {
      if (id) {
        const existing = await tx.paymentMethod.findFirst({ where: { id, orgId } });
        if (!existing) throw new PaymentMethodNotFoundError("Zahlungsmethode nicht gefunden.");

        const data: Prisma.PaymentMethodUncheckedUpdateInput = {
          name: input.name,
          description: input.description,
          paymentTermsDays: input.paymentTermsDays,
          invoiceText: input.invoiceText,
          bankAccountRef: input.bankAccountRef,
          bankIban: input.bankIban,
          bankBic: input.bankBic,
          bankName: input.bankName,
          isActive: input.isActive,
        };
        // Nur eine Nicht-Systemmethode darf Code/UNTDID-Code/Sortierung aendern.
        if (!existing.isSystem) {
          data.code = input.code;
          data.untdidCode = input.untdidCode;
          data.sortOrder = input.sortOrder;
        }
        return tx.paymentMethod.update({ where: { id: existing.id }, data });
      }

      return tx.paymentMethod.create({
        data: {
          orgId,
          code: input.code,
          name: input.name,
          description: input.description,
          paymentTermsDays: input.paymentTermsDays,
          invoiceText: input.invoiceText,
          bankAccountRef: input.bankAccountRef,
          bankIban: input.bankIban,
          bankBic: input.bankBic,
          bankName: input.bankName,
          untdidCode: input.untdidCode,
          isSystem: false,
          isActive: input.isActive,
          sortOrder: input.sortOrder,
        },
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new PaymentMethodCodeConflictError("Es gibt bereits eine Zahlungsmethode mit diesem Code.");
    }
    throw e;
  }
}

/**
 * Loescht eine Zahlungsmethode. Systemmethoden sind geschuetzt; ebenso Methoden, die
 * an einer Rechnung (paymentMethodId) oder als Kunden-Default referenziert werden —
 * die Rechnung behaelt ihren Snapshot, aber der Fremdschluessel selbst darf nicht ins
 * Leere zeigen (Invoice.paymentMethod ist SetNull, das waere technisch moeglich, aber
 * fachlich unerwuenscht: die laufende Referenz soll erst durch Aendern der Rechnung
 * geloest werden, nicht implizit durchs Loeschen der Methode).
 */
export async function deletePaymentMethod(orgId: string, id: string): Promise<void> {
  await dbInternal.$transaction(async (tx) => {
    const method = await tx.paymentMethod.findFirst({ where: { id, orgId } });
    if (!method) throw new PaymentMethodNotFoundError("Zahlungsmethode nicht gefunden.");
    if (method.isSystem) {
      throw new SystemPaymentMethodProtectedError("Systemzahlungsmethode kann nicht geloescht werden.");
    }

    const [invoiceCount, customerCount] = await Promise.all([
      tx.invoice.count({ where: { paymentMethodId: id } }),
      tx.customer.count({ where: { defaultPaymentMethodId: id } }),
    ]);
    if (invoiceCount > 0 || customerCount > 0) {
      throw new PaymentMethodInUseError("Zahlungsmethode wird noch von Rechnungen oder Kunden referenziert.");
    }

    await tx.paymentMethod.delete({ where: { id: method.id } });
  });
}
