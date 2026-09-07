/**
 * Phase 10, Task 5 — Webhooks (10b). Testjahr 2077 (plan-header.md), eigener
 * NumberRange-Praefix "WH77-" fuer alle beteiligten docTypes (Invoice.number ist
 * global eindeutig).
 */
import { beforeAll, describe, it, expect } from "vitest";
import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { updateNumberRange } from "@/domain/numbering/ranges";
import { saveMailSettings } from "@/domain/email/settings";
import { createMemoryProvider } from "@/lib/mail/memory";

import { createDraftInvoice } from "@/domain/invoice/create";
import { finalizeInvoice } from "@/domain/invoice/finalize";
import { cancelInvoice } from "@/domain/invoice/cancel";
import { recordPayment } from "@/domain/invoice/payment";
import { createDunning } from "@/domain/dunning/create";
import { createDeliveryNote } from "@/domain/delivery-note/create";
import { sendDocumentEmail } from "@/domain/email/send";
import { createBusinessDocument } from "@/domain/document/create";
import { setQuoteStatus } from "@/domain/document/status";
import { createShareLink } from "@/domain/quote-share/link";
import { decideOffer } from "@/domain/quote-share/decide";

import { createWebhookEndpoint, updateWebhookEndpoint, getWebhookEndpoint, listWebhookEndpoints } from "@/domain/webhook/endpoints";
import { emitEvent } from "@/domain/webhook/emit";
import { attemptDelivery, runWebhookDeliveries, BACKOFF_MINUTES, type FetchLike } from "@/domain/webhook/deliver";
import { sendTestDelivery, replayWebhookDelivery } from "@/domain/webhook/actions";
import { assertPublicHttpsUrl, SsrfBlockedError } from "@/domain/webhook/ssrf";
import { buildSignatureHeader, verifySignatureHeader } from "@/domain/webhook/sign";

import type { CreateInvoiceInput } from "@/schemas";

const FIX_DATE = new Date("2077-06-09T10:00:00.000Z");

let orgId: string;
let customerId: string;

beforeAll(async () => {
  // Muster: quote-share.test.ts/email.test.ts — createWebhookEndpoint verschluesselt das
  // Secret per AES-GCM (src/lib/crypto/secrets.ts), das braucht AUTH_SECRET.
  process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-mindestens-16-zeichen";

  const org = await dbInternal.organization.create({
    data: {
      legalName: "Webhooks Test GmbH",
      addressLine1: "Hauptstr. 1",
      postalCode: "21339",
      city: "Lueneburg",
      vatId: "DE999888777",
      taxNumber: "33/999/88877",
    },
  });
  orgId = org.id;
  const customer = await dbInternal.customer.create({
    data: { orgId, name: "Kunde WH AG", addressLine1: "Marktplatz 2", postalCode: "20095", city: "Hamburg", type: "BUSINESS", email: "kunde@example.org" },
  });
  customerId = customer.id;
  await ensureOrgMasterdata(dbInternal, orgId);
  await saveMailSettings(orgId, {
    host: "localhost",
    port: 2525,
    security: "NONE",
    fromName: "Webhooks Test GmbH",
    fromEmail: "rechnung@example.org",
    defaultCc: "",
    defaultBcc: "",
    copyToSelf: false,
  });

  for (const [docType, prefix] of [
    ["INVOICE", "WH77-RE-"],
    ["CREDIT_NOTE", "WH77-GS-"],
    ["DUNNING", "WH77-MA-"],
    ["DELIVERY_NOTE", "WH77-LS-"],
    ["ANGEBOT", "WH77-AN-"],
    ["AUFTRAGSBESTAETIGUNG", "WH77-AB-"],
  ] as const) {
    await updateNumberRange(orgId, docType, { pattern: "{PREFIX}{YYYY}-{SEQ}", prefix, seqPadding: 4, yearlyReset: true, nextValue: 1 }, "test", FIX_DATE);
  }
});

function invoiceInput(extra: Partial<CreateInvoiceInput> = {}): CreateInvoiceInput {
  return {
    customerId,
    type: "INVOICE",
    taxScheme: "REGULAR",
    currency: "EUR",
    deliveryDate: FIX_DATE,
    dueDate: FIX_DATE,
    lines: [{ description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    ...extra,
  } as CreateInvoiceInput;
}

async function makeActiveEndpoint(events: string[], url = "https://93.184.216.34/hook") {
  const created = await createWebhookEndpoint(orgId, { url, events }, { now: FIX_DATE });
  return created;
}

function okFetch(status = 200, body = "ok"): FetchLike {
  return async () => new Response(body, { status });
}

function failFetch(status = 500, body = "boom"): FetchLike {
  return async () => new Response(body, { status });
}

async function loadEndpointRaw(id: string) {
  return dbInternal.webhookEndpoint.findUniqueOrThrow({ where: { id } });
}

describe("SSRF-Schutz (ssrf.ts) — assertPublicHttpsUrl", () => {
  it("http:// wird abgelehnt", async () => {
    await expect(assertPublicHttpsUrl("http://93.184.216.34/hook")).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  const privateHosts = [
    "https://10.0.0.5/hook",
    "https://172.16.0.5/hook",
    "https://192.168.1.5/hook",
    "https://127.0.0.1/hook",
    "https://169.254.1.1/hook",
    "https://[::1]/hook",
    // Fix-Welle (Nit 13): zuvor luekenhafte SSRF-Liste — CGNAT/Benchmarking (IPv4) fehlten.
    // (Die IPv6-Ergaenzungen — ::, 64:ff9b::/96, 2002::/16, fe80::/10-Bitbereich — werden
    // in test/unit/ssrf.test.ts direkt gegen isPrivateIPv6 geprueft: `new URL(...).hostname`
    // fuer IPv6-Literale liefert die Klammerform "[::1]", die `dns.lookup` grundsaetzlich
    // NICHT aufloesen kann — der Aufruf hier wuerde also so oder so mit SsrfBlockedError
    // scheitern, unabhaengig davon, ob die Adresse tatsaechlich privat ist. Das ist ein
    // separates, vorbestehendes Verhalten ausserhalb des Nit-13-Scopes.)
    "https://100.64.0.1/hook",
    "https://100.100.100.100/hook", // Mitte von 100.64.0.0/10
    "https://198.18.0.1/hook",
    "https://198.19.255.254/hook",
  ];
  for (const url of privateHosts) {
    it(`private/lokale Adresse wird abgelehnt: ${url}`, async () => {
      await expect(assertPublicHttpsUrl(url)).rejects.toBeInstanceOf(SsrfBlockedError);
    });
  }

  it("oeffentliche https-Adresse ist erlaubt", async () => {
    await expect(assertPublicHttpsUrl("https://93.184.216.34/hook")).resolves.toBeUndefined();
  });
});

describe("Webhook-Endpunkte (endpoints.ts) — Anlage lehnt SSRF-Verstoesse ab (400)", () => {
  it("http-URL bei Anlage -> SsrfBlockedError", async () => {
    await expect(createWebhookEndpoint(orgId, { url: "http://example.org/hook", events: ["invoice.finalized"] })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("private IP bei Anlage -> SsrfBlockedError", async () => {
    await expect(createWebhookEndpoint(orgId, { url: "https://192.168.0.5/hook", events: ["invoice.finalized"] })).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it("gueltige https-URL: Secret nur in der Antwort, nie in listWebhookEndpoints", async () => {
    const created = await makeActiveEndpoint(["invoice.finalized"]);
    expect(created.secret).toBeTruthy();
    const fetched = await getWebhookEndpoint(orgId, created.id);
    expect(fetched).not.toHaveProperty("secret");
    expect(fetched).not.toHaveProperty("secretEnc");
  });

  // Fix-Welle (Nit 14): DB-seitige Pagination (take/skip/count) statt alles zu laden und
  // in-memory zu slicen; ohne `opts` (Session-Route/MCP) bleibt das Verhalten "alles laden".
  it("listWebhookEndpoints paginiert per limit/offset auf DB-Ebene, ohne opts laedt sie alles", async () => {
    const before = await listWebhookEndpoints(orgId);
    await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.60/hook");
    await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.61/hook");
    const all = await listWebhookEndpoints(orgId);
    expect(all.total).toBe(before.total + 2);
    expect(all.rows.length).toBe(all.total);

    const page1 = await listWebhookEndpoints(orgId, { limit: 1, offset: 0 });
    expect(page1.rows.length).toBe(1);
    expect(page1.total).toBe(all.total);
    const page2 = await listWebhookEndpoints(orgId, { limit: 1, offset: 1 });
    expect(page2.rows.length).toBe(1);
    expect(page2.rows[0].id).not.toBe(page1.rows[0].id);
  });
});

describe("Signatur (sign.ts)", () => {
  it("verifySignatureHeader akzeptiert eine korrekt berechnete Signatur", () => {
    const secret = "mein-geheimnis";
    const ts = 1700000000;
    const body = JSON.stringify({ hallo: "welt" });
    const header = buildSignatureHeader(secret, ts, body);
    expect(header).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verifySignatureHeader(header, secret, body)).toBe(true);
  });

  it("lehnt eine manipulierte Signatur/Body ab", () => {
    const secret = "mein-geheimnis";
    const ts = 1700000000;
    const body = JSON.stringify({ hallo: "welt" });
    const header = buildSignatureHeader(secret, ts, body);
    expect(verifySignatureHeader(header, secret, body + "x")).toBe(false);
    expect(verifySignatureHeader(header, "falsches-secret", body)).toBe(false);
    expect(verifySignatureHeader("t=abc,v1=00", secret, body)).toBe(false);
  });
});

describe("Outbox-Transaktion (emit.ts) — Rollback-Test", () => {
  it("schlaegt die umgebende Tx fehl, verschwindet die angelegte WebhookDelivery-Zeile", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"]);
    const before = await dbInternal.webhookDelivery.count({ where: { orgId, endpointId: endpoint.id } });

    await expect(
      dbInternal.$transaction(async (tx) => {
        await emitEvent(tx, { orgId, type: "invoice.finalized", objectName: "Invoice", objectId: "test-rollback", data: { hallo: "welt" }, now: FIX_DATE });
        throw new Error("erzwungener Rollback");
      }),
    ).rejects.toThrow("erzwungener Rollback");

    const after = await dbInternal.webhookDelivery.count({ where: { orgId, endpointId: endpoint.id } });
    expect(after).toBe(before);
  });

  it("committete Tx: die Zeile bleibt bestehen", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"]);
    await dbInternal.$transaction(async (tx) => {
      await emitEvent(tx, { orgId, type: "invoice.finalized", objectName: "Invoice", objectId: "test-commit", data: { hallo: "welt" }, now: FIX_DATE });
    });
    const row = await dbInternal.webhookDelivery.findFirst({ where: { orgId, endpointId: endpoint.id, objectId: "test-commit" } });
    expect(row).not.toBeNull();
    expect(row!.status).toBe("PENDING");
  });

  it("nur aktive Endpunkte mit passendem Event bekommen eine Zeile", async () => {
    const matching = await makeActiveEndpoint(["invoice.cancelled"]);
    const wrongEvent = await makeActiveEndpoint(["dunning.created"]);
    const inactive = await createWebhookEndpoint(orgId, { url: "https://93.184.216.35/hook", events: ["invoice.cancelled"], active: false });

    await dbInternal.$transaction(async (tx) => {
      await emitEvent(tx, { orgId, type: "invoice.cancelled", objectName: "Invoice", objectId: "test-filter", data: {}, now: FIX_DATE });
    });

    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: matching.id, objectId: "test-filter" } })).toBe(1);
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: wrongEvent.id, objectId: "test-filter" } })).toBe(0);
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: inactive.id, objectId: "test-filter" } })).toBe(0);
  });
});

describe("Zustellung (deliver.ts) — attemptDelivery", () => {
  it("Erfolg (2xx) -> DELIVERED, genau 1 Versuch", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"]);
    const delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d1", dataJson: JSON.stringify({ a: 1 }), status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(endpoint.id);
    const result = await attemptDelivery({ ...delivery, endpoint: raw }, okFetch(200), FIX_DATE);
    expect(result.outcome).toBe("delivered");

    const updated = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.status).toBe("DELIVERED");
    expect(updated.attempts).toBe(1);
    expect(updated.responseCode).toBe(200);
    expect(updated.deliveredAt).not.toBeNull();
  });

  it("Backoff-Zeiten 1/5/30/120/600 Minuten (Erstversuch + 5 Wiederholungen), DEAD nach dem 6. Versuch", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"]);
    let delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d2", dataJson: JSON.stringify({ a: 1 }), status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(endpoint.id);

    const expectedMinutes = [BACKOFF_MINUTES[0], BACKOFF_MINUTES[1], BACKOFF_MINUTES[2], BACKOFF_MINUTES[3], BACKOFF_MINUTES[4]];
    for (let i = 0; i < 5; i++) {
      const now = new Date(FIX_DATE.getTime() + i * 1000);
      const result = await attemptDelivery({ ...delivery, endpoint: raw }, failFetch(500), now);
      expect(result.outcome).toBe("retry");
      delivery = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
      expect(delivery.attempts).toBe(i + 1);
      expect(delivery.status).toBe("FAILED");
      expect(delivery.nextAttemptAt.getTime()).toBe(now.getTime() + expectedMinutes[i] * 60_000);
    }

    // 6. Versuch -> DEAD.
    const finalNow = new Date(FIX_DATE.getTime() + 10 * 1000);
    const result = await attemptDelivery({ ...delivery, endpoint: raw }, failFetch(503), finalNow);
    expect(result.outcome).toBe("dead");
    delivery = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(delivery.attempts).toBe(6);
    expect(delivery.status).toBe("DEAD");
  });

  it("SSRF-Skip bei Zustellung: URL zeigt zwischenzeitlich auf ein privates Netz -> sofort DEAD, kein fetch-Aufruf", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"]);
    // Simuliert DNS-Rebinding: die URL war bei Anlage oeffentlich, wird direkt in der DB
    // auf ein privates Ziel geaendert (Domain-Validierung umgangen — genau der Fall, den
    // die erneute SSRF-Pruefung bei Zustellung abfangen soll).
    await dbInternal.webhookEndpoint.update({ where: { id: endpoint.id }, data: { url: "https://10.1.2.3/hook" } });
    const delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d3", dataJson: "{}", status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(endpoint.id);

    let fetchCalled = false;
    const trackingFetch: FetchLike = async () => {
      fetchCalled = true;
      return new Response("", { status: 200 });
    };
    const result = await attemptDelivery({ ...delivery, endpoint: raw }, trackingFetch, FIX_DATE);
    expect(result.outcome).toBe("dead");
    expect(fetchCalled).toBe(false);

    const updated = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.status).toBe("DEAD");
    expect(updated.lastError).toMatch(/privaten|lokalen/i);
  });

  // Fix-Welle (Blocking 2): ein oeffentlich erreichbarer Endpunkt koennte per 307 auf eine
  // private Adresse umleiten (z. B. Cloud-Metadata) — die SSRF-Pruefung oben deckt nur die
  // urspruengliche URL ab. `redirect: "manual"` MUSS verhindern, dass der signierte Request
  // ein zweites Mal (ans Redirect-Ziel) gesendet wird.
  it("Redirect (307) wird NICHT gefolgt — genau 1 fetch-Aufruf, Zustellung gilt als fehlgeschlagen", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.40/hook");
    const delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d-redirect", dataJson: "{}", status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(endpoint.id);

    let callCount = 0;
    const redirectFetch: FetchLike = async () => {
      callCount += 1;
      return new Response(null, { status: 307, headers: { Location: "http://169.254.169.254/latest/meta-data/" } });
    };
    const result = await attemptDelivery({ ...delivery, endpoint: raw }, redirectFetch, FIX_DATE);
    expect(callCount).toBe(1);
    expect(result.outcome).toBe("retry");
    expect(result.error).toBe("Redirect nicht erlaubt.");

    const updated = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(updated.status).toBe("FAILED");
    expect(updated.lastError).toBe("Redirect nicht erlaubt.");
  });

  it("deaktivierter Endpunkt -> sofort DEAD, kein fetch-Aufruf", async () => {
    const created = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.36/hook");
    await updateWebhookEndpoint(orgId, created.id, { active: false });
    const delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: created.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d4", dataJson: "{}", status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(created.id);
    let called = false;
    const result = await attemptDelivery({ ...delivery, endpoint: raw }, async () => {
      called = true;
      return new Response("", { status: 200 });
    }, FIX_DATE);
    expect(result.outcome).toBe("dead");
    expect(called).toBe(false);
  });

  it("Signatur der gesendeten Anfrage ist mit dem Klartext-Secret verifizierbar", async () => {
    const created = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.37/hook");
    const delivery = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: created.id, event: "invoice.finalized", objectName: "Invoice", objectId: "d5", dataJson: JSON.stringify({ x: 1 }), status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    const raw = await loadEndpointRaw(created.id);

    let seenHeaders: Headers | undefined;
    let seenBody = "";
    const capturingFetch: FetchLike = async (_url, init) => {
      seenHeaders = new Headers(init.headers as HeadersInit);
      seenBody = String(init.body);
      return new Response("", { status: 200 });
    };
    await attemptDelivery({ ...delivery, endpoint: raw }, capturingFetch, FIX_DATE);

    expect(seenHeaders?.get("X-OIG-Event")).toBe("invoice.finalized");
    expect(seenHeaders?.get("X-OIG-Delivery")).toBe(delivery.id);
    const sig = seenHeaders?.get("X-OIG-Signature");
    expect(sig).toBeTruthy();
    expect(verifySignatureHeader(sig!, created.secret, seenBody)).toBe(true);

    const parsedBody = JSON.parse(seenBody) as { id: string; type: string; createdAt: string; data: unknown };
    expect(parsedBody.id).toBe(delivery.id);
    expect(parsedBody.type).toBe("invoice.finalized");
    expect(parsedBody.data).toEqual({ x: 1 });
  });
});

describe("Scheduler-Job 'webhooks' (runWebhookDeliveries)", () => {
  it("liefert faellige PENDING/FAILED-Deliveries seriell aus", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.38/hook");
    await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "job1", dataJson: "{}", status: "PENDING", nextAttemptAt: FIX_DATE },
    });
    await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: endpoint.id, event: "invoice.finalized", objectName: "Invoice", objectId: "job2", dataJson: "{}", status: "PENDING", nextAttemptAt: new Date(FIX_DATE.getTime() + 60_000) }, // nicht faellig
    });
    const result = await runWebhookDeliveries({ fetchImpl: okFetch(200), now: FIX_DATE });
    // runWebhookDeliveries verarbeitet ALLE faelligen Zeilen der gesamten Instanz (kein
    // Scoping) — andere Tests dieser Datei koennen bereits eigene PENDING-Zeilen mit
    // nextAttemptAt <= FIX_DATE hinterlassen haben. Die Kernaussage dieses Tests (job1
    // wird ausgeliefert, job2 NICHT, weil noch nicht faellig) wird unten je Zeile geprueft.
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(result.delivered).toBeGreaterThanOrEqual(1);

    const job1 = await dbInternal.webhookDelivery.findFirst({ where: { objectId: "job1" } });
    expect(job1!.status).toBe("DELIVERED");
    const job2 = await dbInternal.webhookDelivery.findFirst({ where: { objectId: "job2" } });
    expect(job2!.status).toBe("PENDING"); // unveraendert, noch nicht faellig
  });
});

describe("Test-Zustellung und Replay (actions.ts)", () => {
  it("sendTestDelivery: legt eine Delivery an und versucht sie sofort", async () => {
    const created = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.39/hook");
    const result = await sendTestDelivery(orgId, created.id, { fetchImpl: okFetch(200), now: FIX_DATE });
    expect(result.attempt.outcome).toBe("delivered");
    expect(result.delivery.event).toBe("webhook.test");
    expect(result.delivery.status).toBe("DELIVERED");
  });

  it("replayWebhookDelivery: erzeugt eine NEUE Delivery mit demselben Ereignis/Payload, aendert das Original nicht", async () => {
    const created = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.40/hook");
    const original = await dbInternal.webhookDelivery.create({
      data: { orgId, endpointId: created.id, event: "invoice.finalized", objectName: "Invoice", objectId: "replay-src", dataJson: JSON.stringify({ y: 2 }), status: "DEAD", attempts: 5, nextAttemptAt: FIX_DATE, lastError: "HTTP 500" },
    });

    const result = await replayWebhookDelivery(orgId, original.id, { fetchImpl: okFetch(200), now: FIX_DATE });
    expect(result.delivery.id).not.toBe(original.id);
    expect(result.delivery.replayOfId).toBe(original.id);
    expect(result.delivery.event).toBe("invoice.finalized");
    expect(JSON.parse(result.delivery.dataJson)).toEqual({ y: 2 });
    expect(result.attempt.outcome).toBe("delivered");

    const unchangedOriginal = await dbInternal.webhookDelivery.findUniqueOrThrow({ where: { id: original.id } });
    expect(unchangedOriginal.status).toBe("DEAD");
    expect(unchangedOriginal.attempts).toBe(5);
  });
});

describe("Emit-Aufrufe in den Domain-Funktionen", () => {
  it("finalizeInvoice -> invoice.finalized, Payload ohne internalNotes", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.finalized"], "https://93.184.216.41/hook");
    const draft = await createDraftInvoice(orgId, invoiceInput({ internalNotes: "GEHEIME INTERNE NOTIZ 12345" }));
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const delivery = await dbInternal.webhookDelivery.findFirst({ where: { endpointId: endpoint.id, event: "invoice.finalized", objectId: finalized.id } });
    expect(delivery).not.toBeNull();
    expect(delivery!.dataJson).not.toContain("GEHEIME INTERNE NOTIZ");
    expect(delivery!.dataJson).not.toContain("internalNotes");
    const data = JSON.parse(delivery!.dataJson) as { objectName: string; number: string | null };
    expect(data.objectName).toBe("Invoice");
    expect(data.number).toBe(finalized.number);
  });

  it("cancelInvoice -> invoice.cancelled auf dem Original (die Storno-Gutschrift selbst loest zusaetzlich invoice.finalized aus)", async () => {
    const endpoint = await makeActiveEndpoint(["invoice.cancelled"], "https://93.184.216.42/hook");
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const cancelResult = await cancelInvoice(finalized.id, { now: FIX_DATE });

    const delivery = await dbInternal.webhookDelivery.findFirst({ where: { endpointId: endpoint.id, event: "invoice.cancelled", objectId: finalized.id } });
    expect(delivery).not.toBeNull();
    const data = JSON.parse(delivery!.dataJson) as { status: string };
    expect(data.status).toBe("CANCELLED");
    expect(cancelResult.creditNote.status).toBe("FINALIZED");
  });

  it("recordPayment: Teilzahlung -> nur payment.recorded; Vollzahlung -> zusaetzlich invoice.paid", async () => {
    const endpoint = await makeActiveEndpoint(["payment.recorded", "invoice.paid"], "https://93.184.216.43/hook");
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    await recordPayment(finalized.id, { amountCents: 1000, method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    const paymentDeliveries1 = await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "payment.recorded" } });
    expect(paymentDeliveries1).toBe(1);
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "invoice.paid" } })).toBe(0);

    const rest = finalized.grossTotalCents - 1000;
    await recordPayment(finalized.id, { amountCents: rest, method: "TRANSFER", isSkonto: false, applySkonto: false }, { now: FIX_DATE });
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "payment.recorded" } })).toBe(2);
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "invoice.paid" } })).toBe(1);
  });

  it("createDunning -> dunning.created", async () => {
    const endpoint = await makeActiveEndpoint(["dunning.created"], "https://93.184.216.44/hook");
    const draft = await createDraftInvoice(orgId, invoiceInput({ dueDate: new Date(FIX_DATE.getTime() - 30 * 24 * 60 * 60 * 1000) }));
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });
    const dunningResult = await createDunning(finalized.id, { now: FIX_DATE, force: true });

    const delivery = await dbInternal.webhookDelivery.findFirst({ where: { endpointId: endpoint.id, event: "dunning.created", objectId: dunningResult.dunning.id } });
    expect(delivery).not.toBeNull();
  });

  it("createDeliveryNote -> delivery_note.created", async () => {
    const endpoint = await makeActiveEndpoint(["delivery_note.created"], "https://93.184.216.45/hook");
    const note = await createDeliveryNote(orgId, {
      customerId,
      deliveryDate: FIX_DATE,
      shippingDate: FIX_DATE,
      lines: [{ description: "Warensendung", quantityMilli: 1000, unit: "C62", unitNetPriceCents: 5000, taxRate: 19 }],
    }, { now: FIX_DATE });

    const delivery = await dbInternal.webhookDelivery.findFirst({ where: { endpointId: endpoint.id, event: "delivery_note.created", objectId: note.id } });
    expect(delivery).not.toBeNull();
  });

  it("sendDocumentEmail: SENT -> email.sent; Provider-Fehler -> email.failed", async () => {
    const endpoint = await makeActiveEndpoint(["email.sent", "email.failed"], "https://93.184.216.46/hook");
    const draft = await createDraftInvoice(orgId, invoiceInput());
    const finalized = await finalizeInvoice(draft.id, { now: FIX_DATE });

    const ok = createMemoryProvider();
    const sentResult = await sendDocumentEmail(orgId, "system", {
      docType: "INVOICE", docId: finalized.id, to: "kunde@example.org", cc: "", bcc: "", subject: "Ihre Rechnung", body: "Anbei die Rechnung.", signature: "", standardAttachments: [],
    }, [], ok);
    expect(sentResult.status).toBe("SENT");
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "email.sent", objectId: sentResult.logId } })).toBe(1);

    const failing = createMemoryProvider();
    failing.failNext("550 Mailbox unavailable");
    const failedResult = await sendDocumentEmail(orgId, "system", {
      docType: "INVOICE", docId: finalized.id, to: "kunde@example.org", cc: "", bcc: "", subject: "Ihre Rechnung", body: "Anbei die Rechnung.", signature: "", standardAttachments: [],
    }, [], failing);
    expect(failedResult.status).toBe("FAILED");
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "email.failed", objectId: failedResult.logId } })).toBe(1);
  });

  it("Angebot: SENT/ACCEPTED/REJECTED -> quote.sent/accepted/rejected (nur kind=ANGEBOT, nicht AUFTRAGSBESTAETIGUNG)", async () => {
    const endpoint = await makeActiveEndpoint(["quote.sent", "quote.accepted", "quote.rejected"], "https://93.184.216.47/hook");
    const quote = await createBusinessDocument(orgId, {
      kind: "ANGEBOT", customerId, taxScheme: "REGULAR", currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    }, { now: FIX_DATE });

    await setQuoteStatus(orgId, quote.id, "SENT", { now: FIX_DATE });
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "quote.sent", objectId: quote.id } })).toBe(1);

    const { token } = await createShareLink(orgId, quote.id, {}, { now: FIX_DATE });
    await decideOffer(token, { decision: "ACCEPTED", name: "Erika Musterfrau", email: "erika@example.org" }, { now: FIX_DATE });
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "quote.accepted", objectId: quote.id } })).toBe(1);

    // AUFTRAGSBESTAETIGUNG durchlaeuft dieselbe Statusmaschine, darf aber KEIN quote.*-Ereignis ausloesen.
    const ab = await createBusinessDocument(orgId, {
      kind: "AUFTRAGSBESTAETIGUNG", customerId, taxScheme: "REGULAR", currency: "EUR",
      lines: [{ lineType: "ITEM", description: "Beratung", quantityMilli: 1000, unit: "HUR", unitNetPriceCents: 10000, taxRate: 19, taxCategory: "S", discountPermille: 0, discountCents: 0 }],
    }, { now: FIX_DATE });
    await setQuoteStatus(orgId, ab.id, "SENT", { now: FIX_DATE });
    expect(await dbInternal.webhookDelivery.count({ where: { endpointId: endpoint.id, event: "quote.sent", objectId: ab.id } })).toBe(0);
  });
});
