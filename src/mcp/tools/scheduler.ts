// ── Scheduler ──────────────────────────────────────────────────────────────────
// Task 1 (Phase 9): reiner Move aus server.ts — Verhalten unveraendert.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { runScheduledJobs, type SchedulerJob } from "@/domain/scheduler/runner";
import type { McpToolsContext, Result } from "./context";

export function registerSchedulerTools(server: McpServer, ctx: McpToolsContext): void {
  // ── run_scheduler_job ─────────────────────────────────────────────────────────
  server.registerTool(
    "run_scheduler_job",
    {
      title: "Scheduler-Job manuell anstoßen",
      description: "Stößt den Mahn-Scheduler ('dunning', automatischer Mahnlauf) und/oder den Abo-Scheduler ('recurring') sofort an, statt auf den nächsten Intervall-Lauf zu warten.",
      inputSchema: { job: z.enum(["dunning", "recurring"]).optional().describe("Nur diesen Job ausführen (sonst beide, Reihenfolge recurring → dunning)") },
    },
    async ({ job }): Promise<Result> => {
      try {
        const jobs: SchedulerJob[] | undefined = job ? [job] : undefined;
        const results = await runScheduledJobs({ jobs, trigger: "MANUAL" });
        const lines = results.map((r) => `${r.job}: ${r.ok ? "OK" : `FEHLER (${r.error})`} · ${JSON.stringify(r.summary)}`);
        return ctx.ok(lines.join("\n"));
      } catch (e) {
        return ctx.failUnknown(e);
      }
    },
  );
}
