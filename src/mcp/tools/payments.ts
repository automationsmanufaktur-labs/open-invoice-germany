// ── Zahlungen / Zahlungsmethoden ──────────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { formatCents } from "@/lib/money";
import { recordPayment, PaymentError } from "@/domain/invoice/payment";
import { NotFoundError } from "@/domain/errors";
import { listPaymentMethods } from "@/domain/payment-method/manage";
import { recordPaymentSchema, PaymentMethod } from "@/schemas";
import { ToolError, type McpToolsContext, type Result } from "./context";

export function registerPaymentTools(server: McpServer, ctx: McpToolsContext): void {
  // ── record_payment ───────────────────────────────────────────────────────────
  server.registerTool(
    "record_payment",
    {
      title: "Zahlung erfassen",
      description:
        "Erfasst einen Zahlungseingang auf eine festgeschriebene Rechnung und aktualisiert offenen Betrag + Status (bezahlt/teilbezahlt). " +
        "Faellt die Zahlung in eine Skontofrist der Rechnung, wird ein Vorschlag zurueckgegeben; mit applySkonto=true wird der verbleibende " +
        "Rest sofort als zweite Zahlung (Skontoabzug) gebucht.",
      inputSchema: {
        invoice: z.string().describe("Rechnungs-ID oder -Nummer"),
        amountEuro: z.number().describe("Gezahlter Betrag in Euro"),
        paidAt: z.string().optional().describe("Zahlungsdatum YYYY-MM-DD oder 'heute' (Default: heute)"),
        method: PaymentMethod.default("TRANSFER"),
        reference: z.string().optional(),
        note: z.string().optional().describe("Freitext-Notiz zur Zahlung (Task 4)"),
        applySkonto: z.boolean().default(false).describe("Erkannten Skontoabzug sofort als zweite Zahlung buchen"),
      },
    },
    async (args): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const inv = await ctx.resolveInvoice(org.id, args.invoice);
        const result = await recordPayment(
          inv.id,
          recordPaymentSchema.parse({
            amountCents: ctx.euroToCents(args.amountEuro),
            paidAt: ctx.parseDateInput(args.paidAt),
            method: args.method,
            reference: args.reference,
            note: args.note,
            applySkonto: args.applySkonto,
          }),
          { orgId: org.id },
        );
        const updated = result.payment;
        const open = updated.grossTotalCents - updated.paidAmountCents;
        const skontoNote = result.skontoPayment
          ? ` Skontoabzug ${formatCents(result.skontoPayment.amountCents)} automatisch gebucht — Rechnung vollstaendig bezahlt.`
          : result.skontoSuggestion
            ? ` Skonto moeglich bis ${result.skontoSuggestion.dueDate.toISOString().slice(0, 10)} (${formatCents(result.skontoSuggestion.restCents)}) — mit applySkonto=true buchen.`
            : "";
        return ctx.ok(`Zahlung erfasst. Status: ${updated.status} · offen: ${formatCents(open)}.${skontoNote}`);
      } catch (e) {
        if (e instanceof NotFoundError) return ctx.fail(e.message);
        if (e instanceof PaymentError) return ctx.fail(e.message);
        if (e instanceof ToolError) return ctx.fail(e.message);
        return ctx.failUnknown(e);
      }
    },
  );

  // ── list_payment_methods ────────────────────────────────────────────────────
  server.registerTool(
    "list_payment_methods",
    {
      title: "Zahlungsmethoden auflisten",
      description: "Listet die Zahlungsmethoden der Organisation (Code, Name, Zahlungsziel, aktiv/System) — nuetzlich, um Codes fuer create_invoice/record_payment nachzuschlagen.",
      inputSchema: {},
    },
    async (): Promise<Result> => {
      try {
        const org = await ctx.requireOrg();
        const methods = await listPaymentMethods(org.id);
        return ctx.ok(
          JSON.stringify(
            methods.map((m) => ({
              id: m.id,
              code: m.code,
              name: m.name,
              paymentTermsDays: m.paymentTermsDays,
              isSystem: m.isSystem,
              isActive: m.isActive,
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
}
