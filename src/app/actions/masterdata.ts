"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { organizationSchema, customerSchema, productSchema } from "@/schemas";
import { parseEuroToCents } from "@/lib/money";
import type { ActionResult } from "./result";

function str(fd: FormData, key: string): string | undefined {
  const v = fd.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? undefined : s;
}
function firstError(issues: { message: string; path: PropertyKey[] }[]): string {
  const i = issues[0];
  return i ? `${i.path.join(".") || "Eingabe"}: ${i.message}` : "Ungültige Eingabe";
}

// ── Organisation ─────────────────────────────────────────────────────────
export async function saveOrganization(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const parsed = organizationSchema.safeParse({
    legalName: str(fd, "legalName"),
    addressLine1: str(fd, "addressLine1"),
    addressLine2: str(fd, "addressLine2"),
    postalCode: str(fd, "postalCode"),
    city: str(fd, "city"),
    country: str(fd, "country") ?? "DE",
    email: str(fd, "email") ?? "",
    phone: str(fd, "phone"),
    website: str(fd, "website"),
    taxNumber: str(fd, "taxNumber"),
    vatId: str(fd, "vatId"),
    kuIdNr: str(fd, "kuIdNr"),
    smallBusiness: fd.get("smallBusiness") === "on",
    defaultTaxScheme: str(fd, "defaultTaxScheme") ?? "REGULAR",
    iban: str(fd, "iban"),
    bic: str(fd, "bic"),
    bankName: str(fd, "bankName"),
    electronicAddress: str(fd, "electronicAddress"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };
  const v = parsed.data;
  const data = {
    legalName: v.legalName,
    addressLine1: v.addressLine1,
    addressLine2: v.addressLine2 ?? null,
    postalCode: v.postalCode,
    city: v.city,
    country: v.country,
    email: v.email || null,
    phone: v.phone ?? null,
    website: v.website ?? null,
    taxNumber: v.taxNumber ?? null,
    vatId: v.vatId ?? null,
    kuIdNr: v.kuIdNr ?? null,
    smallBusiness: v.smallBusiness,
    defaultTaxScheme: v.defaultTaxScheme,
    iban: v.iban ?? null,
    bic: v.bic ?? null,
    bankName: v.bankName ?? null,
    electronicAddress: v.electronicAddress ?? null,
  };

  try {
    const existing = await dbInternal.organization.findFirst();
    const org = existing
      ? await dbInternal.organization.update({ where: { id: existing.id }, data })
      : await dbInternal.organization.create({ data });
    // idempotent: Bestandsorganisationen ohne Systemdaten bekommen sie beim naechsten Speichern
    await ensureOrgMasterdata(dbInternal, org.id);
  } catch (e) {
    console.error("saveOrganization:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/einstellungen");
  revalidatePath("/");
  redirect("/einstellungen?saved=1");
}

// ── Kunde ────────────────────────────────────────────────────────────────
export async function saveCustomer(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  const parsed = customerSchema.safeParse({
    type: str(fd, "type") ?? "BUSINESS",
    name: str(fd, "name"),
    contactName: str(fd, "contactName"),
    addressLine1: str(fd, "addressLine1"),
    addressLine2: str(fd, "addressLine2"),
    postalCode: str(fd, "postalCode"),
    city: str(fd, "city"),
    countryCode: str(fd, "countryCode") ?? "DE",
    email: str(fd, "email") ?? "",
    phone: str(fd, "phone"),
    vatId: str(fd, "vatId"),
    leitwegId: str(fd, "leitwegId"),
    peppolId: str(fd, "peppolId"),
    defaultPaymentTermsDays: Number(str(fd, "defaultPaymentTermsDays") ?? "14"),
    defaultPaymentMethodId: str(fd, "defaultPaymentMethodId"),
    notes: str(fd, "notes"),
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };
  const v = parsed.data;

  try {
    const org = await getActiveOrg();
    // G — defaultPaymentMethodId kam ungeprueft aus dem Formular: eine fremde
    // Organisation haette (per manipuliertem Request) die ID einer Zahlungsmethode
    // einer ANDEREN Organisation eintragen koennen (Prisma prueft nur, dass die ID
    // existiert, nicht die orgId). Jetzt Mandanten-Pruefung wie bei allen anderen
    // Fremdschluessel-Feldern.
    if (v.defaultPaymentMethodId) {
      const method = await dbInternal.paymentMethod.findFirst({
        where: { id: v.defaultPaymentMethodId, orgId: org.id },
        select: { id: true },
      });
      if (!method) return { ok: false, error: "Zahlungsmethode nicht gefunden." };
    }
    const data = {
      type: v.type,
      name: v.name,
      contactName: v.contactName ?? null,
      addressLine1: v.addressLine1,
      addressLine2: v.addressLine2 ?? null,
      postalCode: v.postalCode,
      city: v.city,
      countryCode: v.countryCode,
      email: v.email || null,
      phone: v.phone ?? null,
      vatId: v.vatId ?? null,
      leitwegId: v.leitwegId ?? null,
      defaultPaymentTermsDays: v.defaultPaymentTermsDays,
      defaultPaymentMethodId: v.defaultPaymentMethodId ?? null,
      notes: v.notes ?? null,
    };
    // peppolId wird (mangels Formularfeld) NICHT geschrieben, damit ein bestehender Wert beim Bearbeiten erhalten bleibt.
    if (id) {
      const res = await dbInternal.customer.updateMany({ where: { id, orgId: org.id }, data });
      if (res.count === 0) return { ok: false, error: "Kunde nicht gefunden." };
    } else {
      await dbInternal.customer.create({ data: { ...data, orgId: org.id } });
    }
  } catch (e) {
    console.error("saveCustomer:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/kunden");
  redirect("/kunden");
}

export async function archiveCustomer(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  const org = await getActiveOrg();
  await dbInternal.customer.updateMany({ where: { id, orgId: org.id }, data: { isArchived: true } });
  revalidatePath("/kunden");
}

// ── Produkt ──────────────────────────────────────────────────────────────
export async function saveProduct(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const id = str(fd, "id");
  const priceRaw = str(fd, "netPrice") ?? "0";
  let netPriceCents: number;
  try {
    netPriceCents = parseEuroToCents(priceRaw);
  } catch {
    return { ok: false, error: "Ungültiger Nettopreis." };
  }
  const taxRate = Number(str(fd, "taxRate") ?? "19");
  const parsed = productSchema.safeParse({
    name: str(fd, "name"),
    description: str(fd, "description"),
    unit: str(fd, "unit") ?? "C62",
    netPriceCents,
    taxRate,
    taxCategory: taxRate === 0 ? "Z" : "S",
    differential: fd.get("differential") === "on",
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };
  const v = parsed.data;

  try {
    const org = await getActiveOrg();
    const data = {
      name: v.name,
      description: v.description ?? null,
      unit: v.unit,
      netPriceCents: v.netPriceCents,
      taxRate: v.taxRate,
      taxCategory: v.taxCategory,
      differential: v.differential,
    };
    if (id) {
      const res = await dbInternal.product.updateMany({ where: { id, orgId: org.id }, data });
      if (res.count === 0) return { ok: false, error: "Produkt nicht gefunden." };
    } else {
      await dbInternal.product.create({ data: { ...data, orgId: org.id } });
    }
  } catch (e) {
    console.error("saveProduct:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/produkte");
  redirect("/produkte");
}

export async function archiveProduct(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  const org = await getActiveOrg();
  await dbInternal.product.updateMany({ where: { id, orgId: org.id }, data: { isArchived: true } });
  revalidatePath("/produkte");
}
