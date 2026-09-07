"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { assignCustomerNumber, assignArticleNumber } from "@/domain/numbering/ranges";
import { organizationSchema, customerSchema, productSchema } from "@/schemas";
import { parseEuroToCents } from "@/lib/money";
import { archiveCustomer as archiveCustomerDomain } from "@/domain/customer/archive";
import { archiveProduct as archiveProductDomain } from "@/domain/product/archive";
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
    // S1 (Fix-Welle Phase 7): leeres Feld = kein Kunden-Override (null), NICHT der
    // bisherige Zwangs-Default 14 — sonst wuerde ein zufaellig auf 14 gesetzter Wert weiter
    // die Zahlungsmethode/DocumentSettings.invoiceDueDays-Kaskade unterbrechen.
    defaultPaymentTermsDays: str(fd, "defaultPaymentTermsDays") ? Number(str(fd, "defaultPaymentTermsDays")) : null,
    defaultPaymentMethodId: str(fd, "defaultPaymentMethodId"),
    customerNumber: str(fd, "customerNumber"),
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
      defaultPaymentTermsDays: v.defaultPaymentTermsDays ?? null,
      defaultPaymentMethodId: v.defaultPaymentMethodId ?? null,
      notes: v.notes ?? null,
    };
    // peppolId wird (mangels Formularfeld) NICHT geschrieben, damit ein bestehender Wert beim Bearbeiten erhalten bleibt.
    if (id) {
      // customerNumber nur schreiben, wenn im Formular gesetzt (Bearbeitung) — sonst bleibt
      // eine bereits vergebene Nummer beim Speichern anderer Felder erhalten.
      const updateData = v.customerNumber ? { ...data, customerNumber: v.customerNumber } : data;
      const res = await dbInternal.customer.updateMany({ where: { id, orgId: org.id }, data: updateData });
      if (res.count === 0) return { ok: false, error: "Kunde nicht gefunden." };
    } else {
      // Kundennummer (Phase 7, §34): frei im Formular vergeben, sonst Selbstheilung ueber
      // den Nummernkreis CUSTOMER (assignCustomerNumber) — atomar mit der Anlage.
      await dbInternal.$transaction(async (tx) => {
        const customerNumber = v.customerNumber ?? (await assignCustomerNumber(tx, org.id));
        await tx.customer.create({ data: { ...data, customerNumber, orgId: org.id } });
      });
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
  try {
    await archiveCustomerDomain(org.id, id);
  } catch {
    // Unbekannte/fremde ID: wie zuvor stillschweigend ignorieren (Server Action ohne Rueckgabewert).
  }
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
    articleNumber: str(fd, "articleNumber"),
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
      articleNumber: v.articleNumber ?? null,
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
      // Artikelnummer (Phase 7, §34): nur belegen, wenn im Formular leer gelassen.
      await dbInternal.$transaction(async (tx) => {
        const articleNumber = data.articleNumber ?? (await assignArticleNumber(tx, org.id));
        await tx.product.create({ data: { ...data, articleNumber, orgId: org.id } });
      });
    }
  } catch (e) {
    console.error("saveProduct:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
  revalidatePath("/produkte");
  redirect("/produkte");
}

export interface CreateProductInlineInput {
  name: string;
  description?: string;
  articleNumber?: string;
  unit: string;
  netPrice: string; // Euro, Komma oder Punkt (wie ProductForm)
  taxRate: number;
  differential: boolean;
}
export type CreateProductInlineResult =
  | { ok: true; product: { id: string; name: string; unit: string; netPriceCents: number; taxRate: number } }
  | { ok: false; error: string };

/**
 * Inline-Anlage eines Produkts aus dem Positions-Editor (Phase 4b, Produkt-Picker
 * „Neues Produkt"). Nutzt dieselbe Domain/Zod wie saveProduct — anders als saveProduct
 * jedoch KEIN redirect, sondern Rueckgabe des angelegten Produkts, damit der Aufrufer
 * es sofort in die gerade bearbeitete Position uebernehmen kann.
 */
export async function createProductInline(input: CreateProductInlineInput): Promise<CreateProductInlineResult> {
  let netPriceCents: number;
  try {
    netPriceCents = parseEuroToCents(input.netPrice);
  } catch {
    return { ok: false, error: "Ungültiger Nettopreis." };
  }
  const parsed = productSchema.safeParse({
    name: input.name,
    description: input.description,
    articleNumber: input.articleNumber,
    unit: input.unit || "C62",
    netPriceCents,
    taxRate: input.taxRate,
    taxCategory: input.taxRate === 0 ? "Z" : "S",
    differential: input.differential,
  });
  if (!parsed.success) return { ok: false, error: firstError(parsed.error.issues) };
  const v = parsed.data;

  try {
    const org = await getActiveOrg();
    const product = await dbInternal.$transaction(async (tx) => {
      const articleNumber = v.articleNumber ?? (await assignArticleNumber(tx, org.id));
      return tx.product.create({
        data: {
          orgId: org.id,
          name: v.name,
          description: v.description ?? null,
          articleNumber,
          unit: v.unit,
          netPriceCents: v.netPriceCents,
          taxRate: v.taxRate,
          taxCategory: v.taxCategory,
          differential: v.differential,
        },
      });
    });
    revalidatePath("/produkte");
    return { ok: true, product: { id: product.id, name: product.name, unit: product.unit, netPriceCents: product.netPriceCents, taxRate: product.taxRate } };
  } catch (e) {
    console.error("createProductInline:", e);
    return { ok: false, error: "Speichern fehlgeschlagen." };
  }
}

export async function archiveProduct(fd: FormData): Promise<void> {
  const id = str(fd, "id");
  if (!id) return;
  const org = await getActiveOrg();
  try {
    await archiveProductDomain(org.id, id);
  } catch {
    // Unbekannte/fremde ID: wie zuvor stillschweigend ignorieren (Server Action ohne Rueckgabewert).
  }
  revalidatePath("/produkte");
}
