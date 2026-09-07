"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { dbInternal } from "@/lib/db";
import { getActiveOrg } from "@/lib/org";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { organizationSchema, customerSchema, productSchema } from "@/schemas";
import { parseEuroToCents } from "@/lib/money";
import { archiveCustomer as archiveCustomerDomain } from "@/domain/customer/archive";
import { createCustomer, updateCustomer, CustomerValidationError } from "@/domain/customer/save";
import { archiveProduct as archiveProductDomain } from "@/domain/product/archive";
import { createProduct, updateProduct } from "@/domain/product/save";
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
    // Fix-Runde 1 (Koordinator-Ruling a, 2026-09-04): Anlage-/Aenderungslogik
    // (Nummernkreis, defaultPaymentMethodId-Mandantenpruefung) lebt jetzt ausschliesslich
    // in src/domain/customer/save.ts — dieselbe Funktion nutzen MCP-Tools und die v1-API.
    if (id) {
      const res = await dbInternal.customer.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
      if (!res) return { ok: false, error: "Kunde nicht gefunden." };
      // peppolId wird (mangels Formularfeld) hier immer als Schluessel VORHANDEN (aber
      // undefined) mitgefuehrt, da str(fd,"peppolId") ohne echtes Formularfeld immer
      // undefined liefert. Beim Aufruf von updateCustomer MUSS der Schluessel deshalb
      // explizit entfernt werden (nicht nur auf undefined gesetzt) -- eine PATCH-Semantik
      // schreibt sonst ueber "Schluessel vorhanden" einen bestehenden Wert auf null.
      const { peppolId: _peppolIdIgnored, ...updatePayload } = v;
      void _peppolIdIgnored;
      await updateCustomer(org.id, id, updatePayload);
    } else {
      await createCustomer(org.id, v);
    }
  } catch (e) {
    if (e instanceof CustomerValidationError) return { ok: false, error: e.message };
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
    // Fix-Runde 1 (Koordinator-Ruling a, 2026-09-04): Anlage-/Aenderungslogik lebt jetzt
    // ausschliesslich in src/domain/product/save.ts — dieselbe Funktion nutzen MCP-Tools
    // und die v1-API.
    if (id) {
      const res = await dbInternal.product.findFirst({ where: { id, orgId: org.id }, select: { id: true } });
      if (!res) return { ok: false, error: "Produkt nicht gefunden." };
      await updateProduct(org.id, id, v);
    } else {
      await createProduct(org.id, v);
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
    const product = await createProduct(org.id, v);
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
