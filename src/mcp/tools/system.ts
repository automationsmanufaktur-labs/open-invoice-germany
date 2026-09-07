// ── System / Dashboard / Benachrichtigungen ──────────────────────────────────
// Reiner Move aus src/mcp/server.ts (Phase 9, Task 1) — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { ensureOrgMasterdata } from "@/domain/masterdata/ensure";
import { dashboardSummary } from "@/domain/dashboard/summary";
import { buildTimeline, type TimelineKind } from "@/domain/timeline/build";
import { listNotifications, markRead } from "@/domain/notifications/create";
import { organizationSchema, TaxScheme } from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerSystemTools(server: McpServer, ctx: McpToolsContext): void {
  // ── get_status ──────────────────────────────────────────────────────────────
  server.registerTool(
    "get_status",
    {
      title: "Status / Orientierung",
      description:
        "Zeigt, ob das eigene Unternehmen eingerichtet ist, und Zähler (Kunden, Produkte, Rechnungen). Immer ZUERST aufrufen, um den Zustand zu verstehen.",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      // Testbarkeit-Fix (Task 2): dbInternal.organization.findFirst() (ohne orderBy/Scope)
      // fand in der geteilten Test-DB die frueheste je angelegte Organisation ueber ALLE
      // Testdateien hinweg, nicht die per getActiveOrg (in Tests gemockte) aktive Org —
      // dadurch waren companyConfigured/Zaehler in Tests nicht deterministisch pruefbar.
      // ctx.requireOrg() nutzt dieselbe Query wie getActiveOrg (findFirst orderBy createdAt
      // asc) — Produktivverhalten identisch (Single-Tenant, § getActiveOrg-Kommentar) —,
      // wirft aber, wenn (noch) kein Unternehmen existiert; das faengt get_status ab, um
      // wie bisher graceful companyConfigured=false statt eines Fehlers zu liefern. Die
      // Zaehler waren zudem NIE nach orgId gefiltert (globaler Count ueber alle Organisationen) —
      // ebenfalls behoben. ctx.requireOrg() (getActiveOrg) liefert in Tests nur { id } (Mock-
      // Rueckgabe) — vollen Datensatz separat laden statt auf Company-Felder aus dem Mock zu
      // vertrauen.
      let org: Awaited<ReturnType<typeof dbInternal.organization.findUnique>> | null = null;
      try {
        const active = await ctx.requireOrg();
        org = await dbInternal.organization.findUnique({ where: { id: active.id } });
      } catch {
        org = null;
      }
      const [customers, products, invoices, drafts] = org
        ? await Promise.all([
            dbInternal.customer.count({ where: { orgId: org.id, isArchived: false } }),
            dbInternal.product.count({ where: { orgId: org.id, isArchived: false } }),
            dbInternal.invoice.count({ where: { orgId: org.id } }),
            dbInternal.invoice.count({ where: { orgId: org.id, status: "DRAFT" } }),
          ])
        : [0, 0, 0, 0];
      return ctx.ok(
        JSON.stringify(
          {
            companyConfigured: Boolean(org),
            company: org ? { legalName: org.legalName, taxId: org.vatId ?? org.taxNumber, scheme: org.defaultTaxScheme } : null,
            counts: { customers, products, invoices, drafts },
            hint: org ? "Bereit. Kunden/Produkte mit upsert_* anlegen, dann create_invoice." : "Zuerst setup_company aufrufen.",
          },
          null,
          2,
        ),
      );
    },
  );

  // ── setup_company ────────────────────────────────────────────────────────────
  server.registerTool(
    "setup_company",
    {
      title: "Eigenes Unternehmen einrichten/ändern",
      description:
        "Legt die Absender-Stammdaten an oder aktualisiert sie (erscheinen als Pflichtangaben auf jeder Rechnung, § 14 UStG). Steuernummer ODER USt-IdNr. ist Pflicht.",
      inputSchema: {
        legalName: z.string().describe("Firmenname"),
        addressLine1: z.string().describe("Straße und Hausnummer"),
        postalCode: z.string(),
        city: z.string(),
        country: z.string().length(2).default("DE"),
        taxNumber: z.string().optional().describe("Steuernummer (alternativ zur USt-IdNr.)"),
        vatId: z.string().optional().describe("USt-IdNr., z. B. DE123456789"),
        email: z.string().optional(),
        phone: z.string().optional(),
        iban: z.string().optional(),
        bic: z.string().optional(),
        bankName: z.string().optional(),
        smallBusiness: z.boolean().default(false).describe("Kleinunternehmer nach § 19 UStG"),
        defaultTaxScheme: TaxScheme.default("REGULAR"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const v = organizationSchema.parse({ ...args, email: args.email ?? "" });
        // Fix-Welle Punkt 7: dieselbe Org-Aufloesung wie ctx.requireOrg() (getActiveOrg,
        // findFirst orderBy createdAt asc) statt eines eigenen ungescopten/ungeordneten
        // dbInternal.organization.findFirst() — sonst kann (in der geteilten Test-DB, aber
        // im Multi-Org-Fall grundsaetzlich) eine ANDERE Organisation "gefunden" und
        // ueberschrieben werden statt der aktiven. Ohne Org (noch keine eingerichtet):
        // weiterhin anlegen (bestehendes Verhalten).
        let existing: Awaited<ReturnType<typeof dbInternal.organization.findUnique>> | null = null;
        try {
          const active = await ctx.requireOrg();
          existing = await dbInternal.organization.findUnique({ where: { id: active.id } });
        } catch {
          existing = null;
        }
        const data = {
          legalName: v.legalName,
          addressLine1: v.addressLine1,
          postalCode: v.postalCode,
          city: v.city,
          country: v.country,
          email: v.email || null,
          phone: v.phone ?? null,
          taxNumber: v.taxNumber ?? null,
          vatId: v.vatId ?? null,
          smallBusiness: v.smallBusiness,
          defaultTaxScheme: v.defaultTaxScheme,
          iban: v.iban ?? null,
          bic: v.bic ?? null,
          bankName: v.bankName ?? null,
          electronicAddress: v.email || null,
        };
        const org = existing
          ? await dbInternal.organization.update({ where: { id: existing.id }, data })
          : await dbInternal.organization.create({ data });
        // idempotent, deshalb unabhaengig von Create/Update sicher aufrufbar
        await ensureOrgMasterdata(dbInternal, org.id);
        return ctx.ok(`Unternehmen ${existing ? "aktualisiert" : "angelegt"}: ${org.legalName} (${org.id}).`);
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── get_dashboard ────────────────────────────────────────────────────────────
  server.registerTool(
    "get_dashboard",
    {
      title: "Dashboard-Kennzahlen abrufen",
      description:
        "Liefert die Dashboard-Kennzahlen der Organisation (offene/faellige/ueberfaellige Rechnungen, Aging, Umsatz laufender Monat, letzte Belege, offene Angebote).",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const summary = await dashboardSummary(org.id);
        return ctx.ok(JSON.stringify(summary, null, 2));
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── get_timeline ─────────────────────────────────────────────────────────────
  server.registerTool(
    "get_timeline",
    {
      title: "Beleg-Zeitstrahl abrufen",
      description: "Liefert den Zeitstrahl (ActivityLog + E-Mail + Zahlungen + Mahnungen + Meilensteine) einer Rechnung, eines Angebots/AB/Proforma oder eines Lieferscheins.",
      inputSchema: {
        kind: z.enum(["INVOICE", "QUOTE", "DELIVERY_NOTE"]),
        doc: z.string().describe("Belegnummer oder -ID"),
      },
    },
    async ({ kind, doc }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        let id: string;
        if (kind === "INVOICE") id = (await ctx.resolveInvoice(org.id, doc)).id;
        else if (kind === "QUOTE") id = (await ctx.resolveDocument(org.id, doc)).id;
        else id = (await ctx.resolveDeliveryNote(org.id, doc)).id;
        const entries = await buildTimeline(org.id, { kind: kind as TimelineKind, id });
        return ctx.ok(
          JSON.stringify(
            entries.map((e) => ({ at: e.at.toISOString(), kind: e.kind, label: e.label, detail: e.detail, actor: e.actor })),
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_notifications ───────────────────────────────────────────────────────
  server.registerTool(
    "list_notifications",
    {
      title: "Benachrichtigungen auflisten",
      description: "Listet In-App-Benachrichtigungen der Organisation, neueste zuerst.",
      inputSchema: {
        unreadOnly: z.boolean().default(false),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ unreadOnly, limit }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const notifications = await listNotifications(org.id, { unreadOnly, limit });
        return ctx.ok(
          JSON.stringify(
            notifications.map((n) => ({
              id: n.id,
              type: n.type,
              title: n.title,
              body: n.body,
              link: n.link,
              createdAt: n.createdAt.toISOString(),
              read: n.readAt !== null,
            })),
            null,
            2,
          ),
        );
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── mark_notifications_read ──────────────────────────────────────────────────
  server.registerTool(
    "mark_notifications_read",
    {
      title: "Benachrichtigungen als gelesen markieren",
      description: "Markiert einzelne (ids) oder alle (all=true) Benachrichtigungen der Organisation als gelesen.",
      inputSchema: {
        ids: z.array(z.string().min(1)).optional(),
        all: z.boolean().optional(),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const count = await markRead(org.id, args);
        return ctx.ok(`${count} Benachrichtigung(en) als gelesen markiert.`);
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
