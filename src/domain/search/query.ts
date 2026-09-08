/**
 * Globale Suche (Phase 11a, Spec Abschnitt 2 "Globale Suche"): Rechnungen/Gutschriften,
 * Angebote/AB/Proforma, Lieferscheine, Kunden, Produkte — je Gruppe max. `limit` Treffer,
 * org-gescoped, case-insensitiv ueber `ciContains` (Postgres `mode: insensitive`, SQLite
 * nativ). Es werden NUR Nummer, Kundenname, Name, Artikel-/Kundennummer und E-Mail
 * durchsucht — nie interne Notizen (§48).
 */
import { dbInternal, ciContains } from "@/lib/db";
import type { SearchQuery } from "@/schemas/search";

export type SearchGroupKey = "invoices" | "documents" | "deliveryNotes" | "customers" | "products";

export interface SearchHit {
  id: string;
  title: string;
  subtitle: string | null;
  href: string;
}

export interface SearchGroup {
  key: SearchGroupKey;
  label: string;
  hits: SearchHit[];
}

export interface SearchResult {
  groups: SearchGroup[];
}

const KIND_LABEL: Record<string, string> = {
  ANGEBOT: "Angebot",
  AUFTRAGSBESTAETIGUNG: "Auftragsbestätigung",
  PROFORMA: "Proforma",
};

const INVOICE_TYPE_LABEL: Record<string, string> = {
  INVOICE: "Rechnung",
  CREDIT_NOTE: "Gutschrift",
  CORRECTION: "Korrekturrechnung",
};

export async function globalSearch(orgId: string, input: SearchQuery): Promise<SearchResult> {
  const q = ciContains(input.q);
  const take = input.limit;

  const [invoices, documents, deliveryNotes, customers, products] = await Promise.all([
    dbInternal.invoice.findMany({
      where: { orgId, OR: [{ number: q }, { customer: { name: q } }] },
      select: { id: true, number: true, type: true, status: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take,
    }),
    dbInternal.quote.findMany({
      where: { orgId, OR: [{ number: q }, { customer: { name: q } }] },
      select: { id: true, number: true, kind: true, status: true, customer: { select: { name: true } } },
      orderBy: { issueDate: "desc" },
      take,
    }),
    dbInternal.deliveryNote.findMany({
      where: { orgId, OR: [{ number: q }, { customer: { name: q } }] },
      select: { id: true, number: true, status: true, customer: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take,
    }),
    dbInternal.customer.findMany({
      where: { orgId, OR: [{ name: q }, { customerNumber: q }, { email: q }] },
      select: { id: true, name: true, customerNumber: true, email: true },
      orderBy: { name: "asc" },
      take,
    }),
    dbInternal.product.findMany({
      where: { orgId, OR: [{ name: q }, { articleNumber: q }] },
      select: { id: true, name: true, articleNumber: true },
      orderBy: { name: "asc" },
      take,
    }),
  ]);

  return {
    groups: [
      {
        key: "invoices",
        label: "Rechnungen",
        hits: invoices.map((i) => ({
          id: i.id,
          title: i.number ?? "Entwurf",
          subtitle: `${INVOICE_TYPE_LABEL[i.type] ?? i.type} · ${i.customer.name} · ${i.status}`,
          href: `/rechnungen/${i.id}`,
        })),
      },
      {
        key: "documents",
        label: "Angebote & Aufträge",
        hits: documents.map((d) => ({
          id: d.id,
          title: d.number ?? "Entwurf",
          subtitle: `${KIND_LABEL[d.kind] ?? d.kind} · ${d.customer.name} · ${d.status}`,
          href: `/dokumente/${d.id}`,
        })),
      },
      {
        key: "deliveryNotes",
        label: "Lieferscheine",
        hits: deliveryNotes.map((n) => ({
          id: n.id,
          title: n.number ?? "Entwurf",
          subtitle: `${n.customer.name} · ${n.status}`,
          href: `/lieferscheine/${n.id}`,
        })),
      },
      {
        key: "customers",
        label: "Kunden",
        hits: customers.map((c) => ({
          id: c.id,
          title: c.name,
          subtitle: [c.customerNumber, c.email].filter(Boolean).join(" · ") || null,
          href: `/kunden/${c.id}`,
        })),
      },
      {
        key: "products",
        label: "Produkte",
        hits: products.map((p) => ({
          id: p.id,
          title: p.name,
          subtitle: p.articleNumber ?? null,
          href: `/produkte/${p.id}`,
        })),
      },
    ],
  };
}
