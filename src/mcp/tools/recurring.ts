// ── Abos / wiederkehrende Rechnungen ───────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts + neuer Tool set_recurring_state.
// Facts Task 1: update_recurring/set_recurring_state existieren im Kern bereits als
// update_recurring_invoice (updateRecurringSchema traegt schon "status") — status ist
// also NICHT dupliziert, sondern set_recurring_state ist nur ein duenner Wrapper
// (dieselbe Domain-Funktion updateRecurringInvoice) fuer eine bequemere, dedizierte
// Pause/Fortsetzen/Beenden-Aktion (analog set_dunning_state). Kein zweites "update_recurring"
// Tool — waere reine Dopplung von update_recurring_invoice (CLAUDE.md "Nichts doppelt bauen").
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { createRecurring, RecurringError } from "@/domain/recurring/create";
import { emitRecurringNow, runDueRecurring } from "@/domain/recurring/run";
import { updateRecurringInvoice } from "@/domain/recurring/update";
import { intervalLabel } from "@/lib/recurring";
import { NotFoundError, InvalidOperationError } from "@/domain/errors";
import { createRecurringSchema, updateRecurringSchema } from "@/schemas";
import { docLineSchema, ToolError, type McpToolsContext, type Result } from "./context";

export function registerRecurringTools(server: McpServer, ctx: McpToolsContext): void {
  // ── create_recurring ─────────────────────────────────────────────────────────
  server.registerTool(
    "create_recurring",
    {
      title: "Abo / wiederkehrende Rechnung anlegen",
      description:
        "Legt ein Abo an, aus dem nach Plan automatisch Rechnungen entstehen (z. B. monatlicher Wartungsvertrag). Kunde per Name, Positionen wie bei create_invoice. Mit run_recurring oder dem Cron-Lauf werden die fälligen Rechnungen erzeugt.",
      inputSchema: {
        customer: z.string().describe("Kundenname oder -ID"),
        title: z.string().describe("Interne Bezeichnung, z. B. 'Wartungsvertrag Mustermann'"),
        lines: z.array(docLineSchema).min(1),
        interval: z.enum(["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"]).default("MONTHLY"),
        intervalCount: z.number().int().min(1).max(48).default(1).describe("alle N Intervalle (z. B. 2 = alle 2 Monate)"),
        startDate: z.string().describe("Erster Stichtag YYYY-MM-DD oder 'heute'"),
        endDate: z.string().optional().describe("Letzter Stichtag YYYY-MM-DD (optional)"),
        anchorDay: z.number().int().min(1).max(28).optional().describe("Fester Tag im Monat (1..28)"),
        paymentTermsDays: z.number().int().min(0).max(365).default(14),
        autoFinalize: z.boolean().optional().describe("true = erzeugte Rechnungen sofort festschreiben (ohne Angabe: Org-Standard aus den Einstellungen)"),
        autoSend: z.boolean().optional().describe("true = erzeugte Rechnungen automatisch per E-Mail versenden (ohne Angabe: Org-Standard aus den Einstellungen)"),
        notes: z.string().optional(),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const customer = await ctx.resolveCustomer(org.id, args.customer);
        const lines = await ctx.buildSimpleLines(org.id, args.lines);
        const start = ctx.parseDateInput(args.startDate);
        if (!start) throw new ToolError("startDate konnte nicht gelesen werden (YYYY-MM-DD oder 'heute').");
        const input = createRecurringSchema.parse({
          customerId: customer.id,
          title: args.title,
          interval: args.interval,
          intervalCount: args.intervalCount,
          anchorDay: args.anchorDay,
          startDate: start,
          endDate: ctx.parseDateInput(args.endDate),
          paymentTermsDays: args.paymentTermsDays,
          autoFinalize: args.autoFinalize,
          autoSend: args.autoSend,
          taxScheme: "REGULAR",
          currency: "EUR",
          notes: args.notes,
          lines,
        });
        const rec = await createRecurring(org.id, input);
        return ctx.ok(
          `Abo angelegt: "${rec.title}" für ${customer.name} · ${intervalLabel(rec.interval, rec.intervalCount)} · ` +
            `erste Rechnung ab ${rec.nextRunDate.toISOString().slice(0, 10)}${rec.autoFinalize ? " (auto-festschreiben)" : ""}.\n` +
            `ID: ${rec.id}. Erzeugen: run_recurring (alle fälligen) oder warten auf den Cron-Lauf.`,
        );
      } catch (e) {
        if (e instanceof RecurringError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_recurring ───────────────────────────────────────────────────────────
  server.registerTool(
    "list_recurring",
    {
      title: "Abos auflisten",
      description: "Listet die Abos / wiederkehrenden Rechnungen mit Status, Rhythmus und nächstem Stichtag.",
      inputSchema: { status: z.enum(["ACTIVE", "PAUSED", "ENDED"]).optional() },
    },
    async ({ status }): Promise<Result> => {
      // Testbarkeit-Fix (Task 2, wie get_status in system.ts): ctx.requireOrg() statt
      // ungescoptem dbInternal.organization.findFirst() — respektiert die in Tests gemockte
      // aktive Org, Produktivverhalten (Single-Tenant) identisch.
      let org: Awaited<ReturnType<typeof ctx.requireOrg>>;
      try {
        org = await ctx.requireOrg();
      } catch {
        return ctx.fail("Kein Unternehmen eingerichtet. Zuerst setup_company.");
      }
      const recs = await dbInternal.recurringInvoice.findMany({
        where: { orgId: org.id, ...(status ? { status } : {}) },
        include: { customer: { select: { name: true } }, _count: { select: { invoices: true } } },
        orderBy: { nextRunDate: "asc" },
      });
      return ctx.ok(
        JSON.stringify(
          recs.map((r) => ({
            id: r.id,
            title: r.title,
            customer: r.customer.name,
            rhythm: intervalLabel(r.interval, r.intervalCount),
            status: r.status,
            nextRunDate: r.status === "ENDED" ? null : r.nextRunDate.toISOString().slice(0, 10),
            issued: r._count.invoices,
            autoFinalize: r.autoFinalize,
          })),
          null,
          2,
        ),
      );
    },
  );

  // ── run_recurring ────────────────────────────────────────────────────────────
  server.registerTool(
    "run_recurring",
    {
      title: "Fällige Abo-Rechnungen erzeugen",
      description:
        "Erzeugt alle aktuell fälligen Rechnungen aus den Abos (wie der Cron-Lauf). Mit 'recurring' kann gezielt EIN Abo (per ID/Name) sofort abgerechnet werden, auch wenn der Stichtag noch nicht erreicht ist.",
      inputSchema: {
        recurring: z.string().optional().describe("Optional: ein bestimmtes Abo (ID oder Titel) sofort abrechnen"),
      },
    },
    async ({ recurring }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        if (recurring) {
          const match = await ctx.resolveRecurring(org.id, recurring);
          const res = await emitRecurringNow(match.id);
          return ctx.ok(
            `Rechnung erzeugt für Abo "${match.title}": ${res.number ?? "Entwurf " + res.invoiceId.slice(0, 8)}` +
              `${res.finalized ? " (festgeschrieben)" : " (Entwurf — finalize_invoice zum Festschreiben)"}.`,
          );
        }
        const summaries = await runDueRecurring({ orgId: org.id });
        const total = summaries.reduce((n, s) => n + s.emitted.length, 0);
        if (total === 0) return ctx.ok("Keine fälligen Abos.");
        const lines = summaries.flatMap((s) =>
          s.emitted.map((e) => `• ${s.title}: ${e.number ?? "Entwurf " + e.invoiceId.slice(0, 8)} (Periode ${e.periodDate.toISOString().slice(0, 10)})`),
        );
        return ctx.ok(`${total} Rechnung(en) aus ${summaries.length} Abo(s) erzeugt:\n${lines.join("\n")}`);
      } catch (e) {
        if (e instanceof RecurringError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_recurring_invoice ─────────────────────────────────────────────────
  server.registerTool(
    "update_recurring_invoice",
    {
      title: "Abo / wiederkehrende Rechnung aendern",
      description: "Aendert ein bestehendes Abo (Titel, Rhythmus, Enddatum, maxRuns, Zahlungsziel, autoFinalize/autoSend, E-Mail-Vorlage, Leistungszeitraum-Text, Notizen, Status, Positionen).",
      inputSchema: { ...updateRecurringSchema.shape, recurring: z.string().describe("Abo-ID") },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const { recurring, ...patch } = args;
        const updated = await updateRecurringInvoice(org.id, recurring, patch, "mcp");
        return ctx.ok(`Abo aktualisiert: ${updated.title} (${updated.status}).`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof RecurringError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_recurring_state ──────────────────────────────────────────────────────
  // Facts Task 1: duenner Wrapper um updateRecurringInvoice (status ist bereits Teil von
  // updateRecurringSchema/update_recurring_invoice) — bequemere, dedizierte Aktion analog
  // set_dunning_state, KEINE zweite Statuslogik.
  server.registerTool(
    "set_recurring_state",
    {
      title: "Abo-Status setzen (pausieren/fortsetzen/beenden)",
      description:
        "Setzt den Status eines Abos auf ACTIVE (laeuft normal weiter), PAUSED (keine Rechnungen bis zum erneuten Aktivieren) oder ENDED (dauerhaft beendet). Duenner Wrapper um update_recurring_invoice — identische Domain-Funktion, kein Bypass.",
      inputSchema: {
        recurring: z.string().describe("Abo-ID oder -Titel"),
        state: z.enum(["ACTIVE", "PAUSED", "ENDED"]),
      },
    },
    async ({ recurring, state }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const match = await ctx.resolveRecurring(org.id, recurring);
        const updated = await updateRecurringInvoice(org.id, match.id, { status: state }, "mcp");
        return ctx.ok(`Abo-Status gesetzt: "${updated.title}" ist jetzt ${updated.status}.`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof InvalidOperationError) return ctx.fail(e.message);
        if (e instanceof RecurringError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
