/**
 * Kunden-Zusatzadressen (Phase 8a, Task 1, §29) — CRUD + Default-Verwaltung je Typ
 * (BILLING/SHIPPING/OTHER). Stammdaten, kein Beleg, daher kein ChangeLog. Loeschen wirkt
 * sich nie auf bestehende Belege aus: die FKs auf Invoice/Quote/DeliveryNote sind
 * `onDelete: SetNull`, und die Belege tragen die Adresse bereits als Snapshot
 * (buyerSnapshotJson) — ein geloeschtes CustomerAddress-Feld veraendert keinen
 * festgeschriebenen Beleg (GoBD).
 */
import { dbInternal } from "@/lib/db";
import { NotFoundError } from "@/domain/errors";
import { customerAddressInputSchema, type AddressType } from "@/schemas";

async function requireCustomer(orgId: string, customerId: string) {
  const customer = await dbInternal.customer.findFirst({ where: { id: customerId, orgId } });
  if (!customer) throw new NotFoundError("Kunde nicht gefunden.");
  return customer;
}

async function requireAddress(orgId: string, customerId: string, id: string) {
  const existing = await dbInternal.customerAddress.findFirst({ where: { id, orgId, customerId } });
  if (!existing) throw new NotFoundError("Adresse nicht gefunden.");
  return existing;
}

/** Alle Zusatzadressen eines Kunden, gruppiert nach Typ (BILLING vor SHIPPING vor OTHER). */
export async function listAddresses(orgId: string, customerId: string) {
  await requireCustomer(orgId, customerId);
  return dbInternal.customerAddress.findMany({
    where: { orgId, customerId },
    orderBy: [{ type: "asc" }, { createdAt: "asc" }],
  });
}

/** Legt eine neue Adresse an. `isDefault: true` setzt den bisherigen Default desselben Typs zurueck (Tx). */
export async function createAddress(orgId: string, customerId: string, rawInput: unknown) {
  await requireCustomer(orgId, customerId);
  const input = customerAddressInputSchema.parse(rawInput);
  return dbInternal.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.customerAddress.updateMany({
        where: { orgId, customerId, type: input.type, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.create({ data: { orgId, customerId, ...input } });
  });
}

/** Aktualisiert eine bestehende Adresse; `isDefault: true` verdraengt den bisherigen Default desselben Typs (Tx). */
export async function updateAddress(orgId: string, customerId: string, id: string, rawInput: unknown) {
  await requireCustomer(orgId, customerId);
  await requireAddress(orgId, customerId, id);
  const input = customerAddressInputSchema.parse(rawInput);
  return dbInternal.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.customerAddress.updateMany({
        where: { orgId, customerId, type: input.type, isDefault: true, id: { not: id } },
        data: { isDefault: false },
      });
    }
    return tx.customerAddress.update({ where: { id }, data: input });
  });
}

/**
 * Loescht eine Adresse. Kein Snapshot-Effekt (siehe Modulkommentar) und keine
 * "in Verwendung"-Sperre — anders als bei Mahnstufen gibt es hier keinen laufenden
 * Prozess, der eine geloeschte Adresse spaeter noch braeuchte.
 */
export async function deleteAddress(orgId: string, customerId: string, id: string): Promise<void> {
  await requireCustomer(orgId, customerId);
  await requireAddress(orgId, customerId, id);
  await dbInternal.customerAddress.delete({ where: { id } });
}

/** Setzt eine Adresse als Default ihres Typs; verdraengt den bisherigen Default (Tx). */
export async function setDefaultAddress(orgId: string, customerId: string, id: string) {
  await requireCustomer(orgId, customerId);
  const existing = await requireAddress(orgId, customerId, id);
  return dbInternal.$transaction(async (tx) => {
    await tx.customerAddress.updateMany({
      where: { orgId, customerId, type: existing.type, isDefault: true },
      data: { isDefault: false },
    });
    return tx.customerAddress.update({ where: { id }, data: { isDefault: true } });
  });
}

/** Die Default-Adresse eines Kunden fuer einen Adresstyp, oder null. */
export async function defaultAddressFor(orgId: string, customerId: string, type: AddressType) {
  return dbInternal.customerAddress.findFirst({ where: { orgId, customerId, type, isDefault: true } });
}
