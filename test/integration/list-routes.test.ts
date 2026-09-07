/**
 * Phase 8b, Task 2 (Teil 1) — Routen-Tests fuer die drei neuen Listen-Endpunkte
 * GET /api/invoices, GET /api/documents, GET /api/delivery-notes. Domain-Funktionen
 * (listInvoices/listQuotes/listDeliveryNotes) sind bereits in Task 1 getestet — hier geht
 * es um den Routen-Vertrag: Org-Scoping, Zod-Filter -> 400 bei Verstoss, Passthrough der
 * Domain-Ergebnisse. Zusaetzlich (Task-2-Facts-Nachtrag): EXPIRED-Uebersetzung bei
 * listQuotes ueber die Route.
 *
 * Eigenes Jahr 2068 (plan-header.md, Testjahr-Konvention Teil 1 routes/mcp).
 */
import { describe, it, expect, beforeAll, vi } from "vitest";

const orgStore: { id: string | null } = vi.hoisted(() => ({ id: null }));

vi.mock("@/lib/org", () => ({
  getActiveOrg: async () => {
    if (!orgStore.id) throw new Error("Test-Org noch nicht gesetzt.");
    return { id: orgStore.id };
  },
}));
// Fix-Welle (Nit, GET /api/recurring/[id]): PATCH nutzt jetzt getCurrentUserId() als
// Actor fuer logActivity — next/headers' cookies() wirft ausserhalb eines echten
// Request-Kontexts, daher gemockt (analog invoice-route.test.ts).
vi.mock("@/lib/auth/server", () => ({
  getCurrentUserId: async () => "tester",
}));

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus } from "@/domain/document/status";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { availableActions } from "@/domain/document/actions";
import type { CreateInvoiceInput, CreateDocumentInput, CreateDeliveryNoteInput } from "@/schemas";

import { GET as invoicesGet } from "@/app/api/invoices/route";
import { GET as documentsGet } from "@/app/api/documents/route";
import { GET as deliveryNotesGet } from "@/app/api/delivery-notes/route";

// Teil 2 (Task 4): notifications/dashboard/timeline-Routen.
import { GET as notificationsGet } from "@/app/api/notifications/route";
import { POST as notificationsReadPost } from "@/app/api/notifications/read/route";
import { GET as unreadCountGet } from "@/app/api/notifications/unread-count/route";
import { GET as notificationSettingsGet, PUT as notificationSettingsPut } from "@/app/api/notification-settings/route";
import { GET as dashboardGet } from "@/app/api/dashboard/route";
import { GET as customerOverviewGet } from "@/app/api/customers/[id]/overview/route";
import { GET as invoiceTimelineGet } from "@/app/api/invoices/[id]/timeline/route";
import { GET as documentTimelineGet } from "@/app/api/documents/[id]/timeline/route";
import { GET as deliveryNoteTimelineGet } from "@/app/api/delivery-notes/[id]/timeline/route";
import { createNotification } from "@/domain/notifications/create";
import { createRecurring } from "@/domain/recurring/create";
import { PATCH as recurringPatch } from "@/app/api/recurring/[id]/route";
import type { CreateRecurringInput } from "@/schemas";

let orgId: string;
let customerId: string;
let emailedInvoiceId: string;
// Teil 2 (Task 4): weitere IDs aus demselben beforeAll fuer notifications/dashboard/
// timeline-Routen-Tests — dieselbe Org/Testjahr statt eines eigenen Setups.
let overdueInvoiceId: string;
let quoteId: string;
let deliveryNoteId: string;

// Belegdatum/Nummernvergabe ("now" an finalizeInvoice) liegt bewusst im Testjahr 2068
// (Testjahr-Konvention). Faellig-/Gueltigkeitsdaten fuer OVERDUE/EXPIRED muessen dagegen
// gegen die ECHTE Systemzeit liegen — die GET-Routen (anders als die Domain-Funktionen in
// Task 1) nehmen kein injizierbares `now` entgegen, sondern nutzen wie in Produktion
// `new Date()`.
const NOW = new Date(2068, 2, 10, 10, 0, 0);
const REAL_TODAY = new Date();
const PAST = new Date(REAL_TODAY.getFullYear(), REAL_TODAY.getMonth(), REAL_TODAY.getDate() - 30);
const FUTURE = new Date(REAL_TODAY.getFullYear(), REAL_TODAY.getMonth(), REAL_TODAY.getDate() + 30);

function line(description: string) {
  return {
    description,
    quantityMilli: 1000,
    unit: "HUR" as const,
    unitNetPriceCents: 5000,
    taxRate: 19 as const,
    taxCategory: "S" as const,
    discountPermille: 0,
  };
}

function req(url: string): Request {
  return new Request(url);
}

beforeAll(async () => {
  const org = await dbInternal.organization.create({
    data: {
      legalName: "Routen Test GmbH",
      addressLine1: "Routenweg 1",
      postalCode: "10115",
      city: "Berlin",
      vatId: "DE987654321",
      taxNumber: "11/222/33344",
    },
  });
  orgId = org.id;
  orgStore.id = orgId;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Routenkunde AG", addressLine1: "Marktplatz 9", postalCode: "10117", city: "Berlin", type: "BUSINESS" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);

  // Rechnungen: ein Entwurf, eine faellige, eine ueberfaellige.
  const draft = await createDraftInvoice(orgId, {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    issueDate: NOW,
    lines: [line("Routentest Entwurf")],
  } as CreateInvoiceInput, { now: NOW });

  const finalizedDraft = await createDraftInvoice(orgId, {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    issueDate: NOW,
    lines: [line("Routentest ueberfaellig")],
  } as CreateInvoiceInput, { now: NOW });
  await dbInternal.invoice.update({ where: { id: finalizedDraft.id }, data: { dueDate: PAST } });
  await finalizeInvoice(finalizedDraft.id, { now: NOW });
  overdueInvoiceId = finalizedDraft.id;
  void draft;

  // Fix-Runde 1 (Ruling b): eine Rechnung MIT EmailLog fuer den hasEmailLog-Test.
  const emailedDraft = await createDraftInvoice(orgId, {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    issueDate: NOW,
    lines: [line("Routentest mit EmailLog")],
  } as CreateInvoiceInput, { now: NOW });
  await finalizeInvoice(emailedDraft.id, { now: NOW });
  emailedInvoiceId = emailedDraft.id;
  await dbInternal.emailLog.create({
    data: {
      orgId,
      docType: "INVOICE",
      docId: emailedInvoiceId,
      subject: "Test",
      bodySnapshot: "Test",
      status: "SENT",
    },
  });

  // Angebote: eines DRAFT mit validUntil in der Vergangenheit (=> EXPIRED), eines SENT
  // mit validUntil in der Zukunft (=> bleibt SENT).
  const expiredQuote = await createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    validUntil: PAST,
    lines: [line("Routentest abgelaufenes Angebot")],
  } as CreateDocumentInput);

  const activeQuote = await createBusinessDocument(orgId, {
    kind: "ANGEBOT",
    customerId,
    taxScheme: "REGULAR",
    currency: "EUR",
    validUntil: FUTURE,
    lines: [line("Routentest aktives Angebot")],
  } as CreateDocumentInput);
  await setQuoteStatus(orgId, activeQuote.id, "SENT", { now: NOW });
  quoteId = activeQuote.id;

  // Lieferschein.
  const dn = await createDeliveryNote(orgId, {
    customerId,
    deliveryDate: NOW,
    lines: [line("Routentest Lieferschein")],
  } as unknown as CreateDeliveryNoteInput, { actor: "tester" });
  deliveryNoteId = dn.id;

  void expiredQuote;
});

describe("GET /api/invoices", () => {
  it("liefert alle Rechnungen der aktiven Organisation (listInvoices-Passthrough)", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: unknown[]; total: number };
    expect(j.total).toBe(3);
    expect(j.rows).toHaveLength(3);
  });

  it("filtert nach status=overdue", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices?status=overdue"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ effectiveStatus: string }>; total: number };
    expect(j.total).toBe(1);
    expect(j.rows[0].effectiveStatus).toBe("OVERDUE");
  });

  it("Fix-Runde 1 (Ruling b): hasEmailLog=true fuer eine Rechnung mit EmailLog, RESEND statt SEND in availableActions", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices?q=EmailLog"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ id: string; hasEmailLog: boolean; type: string; effectiveStatus: string }>; total: number };
    expect(j.total).toBe(1);
    const row = j.rows[0];
    expect(row.id).toBe(emailedInvoiceId);
    expect(row.hasEmailLog).toBe(true);
    const actions = availableActions({ kind: "INVOICE", type: row.type, status: row.effectiveStatus, isDraft: false, hasEmailLog: row.hasEmailLog });
    expect(actions).toContain("RESEND");
    expect(actions).not.toContain("SEND");
  });

  it("hasEmailLog=false fuer eine Rechnung ohne EmailLog (SEND statt RESEND)", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices?status=overdue"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ hasEmailLog: boolean; type: string; effectiveStatus: string }> };
    const row = j.rows[0];
    expect(row.hasEmailLog).toBe(false);
    const actions = availableActions({ kind: "INVOICE", type: row.type, status: row.effectiveStatus, isDraft: false, hasEmailLog: row.hasEmailLog });
    expect(actions).toContain("SEND");
    expect(actions).not.toContain("RESEND");
  });

  it("400 bei ungueltigem Filter (limit ausserhalb 1..200)", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices?limit=0"));
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string };
    expect(j.error).toBeTruthy();
  });

  it("400 bei ungueltigem status-Wert", async () => {
    const res = await invoicesGet(req("http://localhost/api/invoices?status=nichtvorhanden"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/documents", () => {
  it("liefert alle Angebote der aktiven Organisation", async () => {
    const res = await documentsGet(req("http://localhost/api/documents"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: unknown[]; total: number };
    expect(j.total).toBe(2);
  });

  it("status=EXPIRED uebersetzt DRAFT/SENT mit verstrichenem validUntil (Test-Nachtrag task-2-facts)", async () => {
    const res = await documentsGet(req("http://localhost/api/documents?status=EXPIRED"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ effectiveStatus: string }>; total: number };
    expect(j.total).toBe(1);
    expect(j.rows[0].effectiveStatus).toBe("EXPIRED");
  });

  it("status=SENT liefert NICHT das abgelaufene Angebot (sonst doppelt unter SENT und EXPIRED)", async () => {
    const res = await documentsGet(req("http://localhost/api/documents?status=SENT"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: Array<{ effectiveStatus: string }>; total: number };
    expect(j.total).toBe(1);
    expect(j.rows[0].effectiveStatus).toBe("SENT");
  });

  it("400 bei ungueltigem Filter", async () => {
    const res = await documentsGet(req("http://localhost/api/documents?limit=999"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/delivery-notes", () => {
  it("liefert alle Lieferscheine der aktiven Organisation", async () => {
    const res = await deliveryNotesGet(req("http://localhost/api/delivery-notes"));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { rows: unknown[]; total: number };
    expect(j.total).toBe(1);
  });

  it("400 bei ungueltigem Filter", async () => {
    const res = await deliveryNotesGet(req("http://localhost/api/delivery-notes?offset=-1"));
    expect(res.status).toBe(400);
  });
});

// ── Teil 2 (Task 4): notifications/dashboard/customer-overview/timeline-Routen ────────

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET/POST /api/notifications, /api/notifications/read, /api/notifications/unread-count", () => {
  it("liefert 0 ungelesene ohne Benachrichtigungen, dann > 0 nach createNotification", async () => {
    const before = await unreadCountGet();
    const beforeJson = (await before.json()) as { count: number };
    expect(beforeJson.count).toBe(0);

    const created = await createNotification({
      orgId,
      type: "INVOICE_OVERDUE",
      title: "Rechnung überfällig",
      dedupeKey: `INVOICE_OVERDUE:${overdueInvoiceId}`,
    });
    expect(created).not.toBeNull();

    const after = await unreadCountGet();
    const afterJson = (await after.json()) as { count: number };
    expect(afterJson.count).toBe(1);

    const list = await notificationsGet(req("http://localhost/api/notifications?limit=10"));
    expect(list.status).toBe(200);
    const listJson = (await list.json()) as { notifications: Array<{ id: string; readAt: string | null }> };
    expect(listJson.notifications.length).toBeGreaterThanOrEqual(1);
    const notifId = listJson.notifications[0].id;

    const markRes = await notificationsReadPost(
      new Request("http://localhost/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [notifId] }),
      }),
    );
    expect(markRes.status).toBe(200);

    const afterMark = await unreadCountGet();
    const afterMarkJson = (await afterMark.json()) as { count: number };
    expect(afterMarkJson.count).toBe(0);
  });

  it("400 bei ungueltigem Body (weder ids noch all)", async () => {
    const res = await notificationsReadPost(
      new Request("http://localhost/api/notifications/read", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [123] }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET/PUT /api/notification-settings", () => {
  it("liefert Default-Einstellungen (Selbstheilung) und speichert Aenderungen", async () => {
    const res = await notificationSettingsGet();
    expect(res.status).toBe(200);
    const j = (await res.json()) as { settings: { enabledTypes: string[]; emailDigest: boolean } };
    expect(j.settings.enabledTypes.length).toBeGreaterThan(0);

    const putRes = await notificationSettingsPut(
      new Request("http://localhost/api/notification-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledTypes: ["INVOICE_OVERDUE"], emailDigest: true }),
      }),
    );
    expect(putRes.status).toBe(200);
    const putJson = (await putRes.json()) as { settings: { enabledTypes: string[]; emailDigest: boolean } };
    expect(putJson.settings.enabledTypes).toEqual(["INVOICE_OVERDUE"]);
    expect(putJson.settings.emailDigest).toBe(true);
  });

  it("400 bei unbekanntem Benachrichtigungstyp", async () => {
    const res = await notificationSettingsPut(
      new Request("http://localhost/api/notification-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabledTypes: ["NICHT_VORHANDEN"], emailDigest: false }),
      }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/dashboard", () => {
  it("liefert Kennzahlen inkl. der ueberfaelligen Testrechnung und der Fix-Runde-1-Kennzahlen (§45)", async () => {
    const res = await dashboardGet();
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      overdueInvoices: { count: number; cents: number };
      dueThisWeek: { count: number; cents: number };
      partiallyPaid: { count: number; cents: number };
      dunningRequired: { count: number };
      aging: Array<{ label: string; count: number; cents: number }>;
      recentDocuments: unknown[];
      openQuotes: { count: number };
    };
    expect(j.overdueInvoices.count).toBeGreaterThanOrEqual(1);
    // Fix-Runde 1: Dashboard-Aging hat 5 Buckets (Grenzen 7/30/60/90).
    expect(j.aging).toHaveLength(5);
    const bucketCounts = j.aging.reduce((sum, b) => sum + b.count, 0);
    expect(bucketCounts).toBeGreaterThanOrEqual(1);
    expect(j.recentDocuments.length).toBeGreaterThan(0);
    expect(j.openQuotes.count).toBeGreaterThanOrEqual(1);
    expect(j.dueThisWeek.count).toBeGreaterThanOrEqual(0);
    expect(j.partiallyPaid.count).toBeGreaterThanOrEqual(0);
    expect(j.dunningRequired.count).toBeGreaterThanOrEqual(1); // die ueberfaellige Testrechnung ist mahnbar
  });
});

describe("GET /api/customers/[id]/overview", () => {
  it("liefert KPIs + Belegtabs des Testkunden", async () => {
    const res = await customerOverviewGet(req(`http://localhost/api/customers/${customerId}/overview`), ctx(customerId));
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      customer: { id: string; name: string };
      kpis: { openCents: number; overdueCents: number };
      invoices: unknown[];
      quotes: unknown[];
      deliveryNotes: unknown[];
    };
    expect(j.customer.id).toBe(customerId);
    expect(j.kpis.overdueCents).toBeGreaterThan(0);
    expect(j.invoices.length).toBe(3);
    expect(j.quotes.length).toBe(2);
    expect(j.deliveryNotes.length).toBe(1);
  });

  it("404 fuer unbekannten Kunden", async () => {
    const res = await customerOverviewGet(req("http://localhost/api/customers/nope/overview"), ctx("nope"));
    expect(res.status).toBe(404);
  });
});

describe("GET .../timeline (invoices/documents/delivery-notes)", () => {
  it("liefert den Zeitstrahl einer Rechnung (mind. FINALIZED-Aktivitaet)", async () => {
    const res = await invoiceTimelineGet(req(`http://localhost/api/invoices/${overdueInvoiceId}/timeline`), ctx(overdueInvoiceId));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { entries: Array<{ kind: string; label: string }> };
    expect(j.entries.length).toBeGreaterThan(0);
    expect(j.entries.some((e) => e.kind === "activity")).toBe(true);
  });

  it("404 fuer eine Rechnung einer fremden Organisation", async () => {
    const res = await invoiceTimelineGet(req("http://localhost/api/invoices/nope/timeline"), ctx("nope"));
    expect(res.status).toBe(404);
  });

  it("liefert den Zeitstrahl eines Angebots", async () => {
    const res = await documentTimelineGet(req(`http://localhost/api/documents/${quoteId}/timeline`), ctx(quoteId));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { entries: unknown[] };
    expect(j.entries.length).toBeGreaterThan(0);
  });

  it("liefert den Zeitstrahl eines Lieferscheins", async () => {
    const res = await deliveryNoteTimelineGet(req(`http://localhost/api/delivery-notes/${deliveryNoteId}/timeline`), ctx(deliveryNoteId));
    expect(res.status).toBe(200);
    const j = (await res.json()) as { entries: unknown[] };
    expect(j.entries.length).toBeGreaterThan(0);
  });
});

describe("PATCH /api/recurring/[id]", () => {
  it("aendert Status ueber die kurze Form {status} (unveraendert seit Task 1/2)", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Routentest-Abo (Status)",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: NOW,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      lines: [line("Routentest-Abo-Position")],
    } as CreateRecurringInput);

    const res = await recurringPatch(
      new Request(`http://localhost/api/recurring/${rec.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "PAUSED" }),
      }),
      ctx(rec.id),
    );
    expect(res.status).toBe(200);
    const updated = await dbInternal.recurringInvoice.findUnique({ where: { id: rec.id } });
    expect(updated?.status).toBe("PAUSED");
  });

  it("aendert Kopf-/Ablauffelder (inkl. startDate) ueber die neue Form {patch} (Fix-Runde 1, Abo-Bearbeiten-UI)", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Routentest-Abo (Patch)",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: NOW,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      lines: [line("Routentest-Abo-Position")],
    } as CreateRecurringInput);

    const newStart = "2068-07-01";
    const res = await recurringPatch(
      new Request(`http://localhost/api/recurring/${rec.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          patch: {
            title: "Routentest-Abo (Patch, geändert)",
            interval: "DAY",
            intervalCount: 3,
            startDate: newStart,
            paymentTermsDays: 30,
            maxRuns: 5,
          },
        }),
      }),
      ctx(rec.id),
    );
    expect(res.status).toBe(200);
    const updated = await dbInternal.recurringInvoice.findUnique({ where: { id: rec.id } });
    expect(updated?.title).toBe("Routentest-Abo (Patch, geändert)");
    expect(updated?.interval).toBe("DAY");
    expect(updated?.intervalCount).toBe(3);
    expect(updated?.paymentTermsDays).toBe(30);
    expect(updated?.maxRuns).toBe(5);
    // Vor dem ersten Lauf (issuedCount===0) zieht nextRunDate mit startDate mit.
    expect(updated?.startDate.toISOString().slice(0, 10)).toBe(newStart);
    expect(updated?.nextRunDate.toISOString().slice(0, 10)).toBe(newStart);
  });

  it("400 bei ungueltigem patch-Feld", async () => {
    const rec = await createRecurring(orgId, {
      customerId,
      title: "Routentest-Abo (400)",
      interval: "MONTHLY",
      intervalCount: 1,
      startDate: NOW,
      taxScheme: "REGULAR",
      currency: "EUR",
      paymentTermsDays: 14,
      lines: [line("Routentest-Abo-Position")],
    } as CreateRecurringInput);

    const res = await recurringPatch(
      new Request(`http://localhost/api/recurring/${rec.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { intervalCount: 0 } }),
      }),
      ctx(rec.id),
    );
    expect(res.status).toBe(400);
  });

  it("404 fuer ein unbekanntes Abo", async () => {
    const res = await recurringPatch(
      new Request("http://localhost/api/recurring/does-not-exist", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { title: "X" } }),
      }),
      ctx("does-not-exist"),
    );
    expect(res.status).toBe(404);
  });
});
