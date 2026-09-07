// ── Mahnwesen ──────────────────────────────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { dbInternal } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { createDunning, DunningError } from "@/domain/dunning/create";
import { sendDunning } from "@/domain/dunning/send";
import { setDunningState } from "@/domain/dunning/state";
import { loadDunningOverview } from "@/domain/dunning/overview";
import { listDunningStages, updateDunningStage, DunningStageError } from "@/domain/dunning/stages";
import { MailNotConfiguredError } from "@/domain/email/settings";
import { NotFoundError } from "@/domain/errors";
import { dunningStageFieldsSchema } from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerDunningTools(server: McpServer, ctx: McpToolsContext): void {
  // ── create_dunning ───────────────────────────────────────────────────────────
  server.registerTool(
    "create_dunning",
    {
      title: "Mahnung / Zahlungserinnerung erstellen",
      description:
        "Erstellt die nächste konfigurierte Mahnstufe (Zahlungserinnerung → 1./2./…​ Mahnung) zu einer überfälligen, offenen Rechnung. Ab Stufe ≥ 2 mit Mahnkosten, je nach Stufe mit Verzugszins (§ 288 BGB) und 40-€-Pauschale (nur B2B). Ist die Stufe noch nicht fällig, schlägt der Aufruf fehl — mit force=true trotzdem erzwingen.",
      inputSchema: {
        invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
        force: z.boolean().optional().describe("Erstellung vor Fälligkeit der nächsten Stufe erzwingen"),
      },
    },
    async ({ invoice, force }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, invoice);
        const res = await createDunning(inv.id, { force, createdBy: "mcp", orgId: org.id });
        return ctx.ok(`${res.stage.name} ${res.dunning.number} erstellt · offen ${formatCents(res.openAmountCents)} · Gesamtforderung ${formatCents(res.totalCents)}.`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof DunningError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── send_dunning ──────────────────────────────────────────────────────────────
  server.registerTool(
    "send_dunning",
    {
      title: "Mahnung per E-Mail versenden",
      description: "Versendet eine bereits erstellte Mahnung per E-Mail an den Kunden (Vorlage der zugehörigen Mahnstufe).",
      inputSchema: {
        dunning: z.string().describe("Mahnungs-ID oder -Nummer"),
        to: z.email().optional().describe("Empfänger ueberschreiben (sonst Kundenstamm/Snapshot)"),
      },
    },
    async ({ dunning, to }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const d = await ctx.resolveDunning(org.id, dunning);
        const result = await sendDunning(org.id, d.id, { actor: "mcp", to });
        if (result.status === "FAILED") return ctx.fail(result.error ?? "Versand fehlgeschlagen.");
        return ctx.ok(`Mahnung ${d.number ?? d.id} versendet.`);
      } catch (e) {
        if (e instanceof MailNotConfiguredError) return ctx.fail(e.message);
        if (e instanceof DunningError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── set_dunning_state ─────────────────────────────────────────────────────────
  server.registerTool(
    "set_dunning_state",
    {
      title: "Mahnprozess-Status setzen",
      description: "Setzt den Mahnprozess einer Rechnung auf ACTIVE (normal), PAUSED (bis pausedUntil ausgesetzt, z.B. Ratenzahlung) oder STOPPED (dauerhaft angehalten, z.B. Inkasso).",
      inputSchema: {
        invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
        state: z.enum(["ACTIVE", "PAUSED", "STOPPED"]),
        pausedUntil: z.iso.date().optional().describe("Nur bei state=PAUSED"),
        note: z.string().max(500).optional(),
      },
    },
    async ({ invoice, state, pausedUntil, note }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, invoice);
        const res = await setDunningState(org.id, inv.id, { state, pausedUntil, note }, "mcp");
        return ctx.ok(`Mahnprozess-Status: ${res.state}${res.pausedUntil ? ` bis ${res.pausedUntil.toISOString().slice(0, 10)}` : ""}.`);
      } catch (e) {
        if (e instanceof DunningError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_overdue_invoices ──────────────────────────────────────────────────────
  server.registerTool(
    "list_overdue_invoices",
    {
      title: "Überfällige Rechnungen auflisten (Mahnwesen-Übersicht)",
      description: "Listet überfällige, offene Rechnungen mit Mahnstatus (aktuelle/nächste Mahnstufe, fällig ab, pausiert bis, letzter Kontakt) — dieselben Daten wie /mahnwesen.",
      inputSchema: { state: z.enum(["ACTIVE", "PAUSED", "STOPPED"]).optional() },
    },
    async ({ state }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const overview = await loadDunningOverview(org.id, new Date(), { state });
        return ctx.ok(
          JSON.stringify(
            {
              widgets: overview.widgets,
              rows: overview.rows.map((r) => ({
                invoice: r.number ?? r.invoiceId,
                customer: r.customerName,
                openAmount: formatCents(r.openCents),
                daysOverdue: r.daysOverdue,
                currentStage: r.currentStage?.name ?? null,
                nextStage: r.nextStage?.name ?? null,
                nextDunningAt: r.nextDunningAt ? r.nextDunningAt.toISOString().slice(0, 10) : null,
                dunningState: r.dunningState,
                pausedUntil: r.pausedUntil ? r.pausedUntil.toISOString().slice(0, 10) : null,
              })),
            },
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

  // ── list_dunning_stages ─────────────────────────────────────────────────────────
  server.registerTool(
    "list_dunning_stages",
    {
      title: "Mahnstufen auflisten",
      description: "Listet alle Mahnstufen der Organisation, aufsteigend nach Reihenfolge (Nachtrag Phase 7/§55).",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const stages = await listDunningStages(org.id);
        return ctx.ok(JSON.stringify(stages, null, 2));
      } catch (e) {
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── update_dunning_stage ────────────────────────────────────────────────────────
  server.registerTool(
    "update_dunning_stage",
    {
      title: "Mahnstufe aktualisieren",
      description:
        "Aktualisiert eine bestehende Mahnstufe (Name/Fristen/Mahnkosten/Zinsen/Pauschale/Auto-Versand/aktiv). Mahnkosten sind erst ab der 3. Stufe zulaessig (order >= 2, COMPLIANCE §12). Nicht angegebene Felder bleiben unveraendert (Merge mit dem aktuellen Stand). Nachtrag Phase 7/§55.",
      inputSchema: {
        id: z.string().describe("Mahnstufen-ID"),
        ...dunningStageFieldsSchema.partial().shape,
      },
    },
    async ({ id, ...args }): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const existing = await dbInternal.dunningStage.findFirst({ where: { id, orgId: org.id } });
        if (!existing) return ctx.fail(`Mahnstufe "${id}" nicht gefunden.`);
        const merged = {
          name: args.name ?? existing.name,
          daysAfterDue: args.daysAfterDue ?? existing.daysAfterDue,
          newDueDays: args.newDueDays ?? existing.newDueDays,
          feeCents: args.feeCents ?? existing.feeCents,
          calculateInterest: args.calculateInterest ?? existing.calculateInterest,
          includeB2BFlatFee: args.includeB2BFlatFee ?? existing.includeB2BFlatFee,
          emailTemplateId: args.emailTemplateId !== undefined ? args.emailTemplateId : existing.emailTemplateId,
          autoSend: args.autoSend ?? existing.autoSend,
          enabled: args.enabled ?? existing.enabled,
        };
        const saved = await updateDunningStage(org.id, id, merged);
        return ctx.ok(`Mahnstufe "${saved.name}" gespeichert: ${JSON.stringify(saved)}`);
      } catch (e) {
        if (e instanceof z.ZodError) return ctx.fail(`Validierung fehlgeschlagen: ${e.issues.map((i) => i.message).join("; ")}`);
        if (e instanceof DunningStageError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );
}
