/**
 * Job-Registry des Scheduler-Runners (Phase 6, Task 3) — bildet den Namen eines Jobs auf
 * die tatsaechlich auszufuehrende Domain-Funktion ab. `runner.ts` kennt nur die Namen und
 * die feste Reihenfolge, nicht die Implementierung — neue Jobs kommen ausschliesslich hier
 * dazu.
 */
import { runDueRecurring } from "@/domain/recurring/run";
import { runDunningJob } from "@/domain/dunning/auto";
import { runNotificationsJob } from "@/domain/notifications/job";
import { runWebhookDeliveries } from "@/domain/webhook/deliver";
import { runCleanupJob } from "./cleanup";
import type { SchedulerJob } from "./runner";

export const jobs: Record<SchedulerJob, (now: Date) => Promise<Record<string, unknown>>> = {
  recurring: async (now) => {
    const summaries = await runDueRecurring({ now });
    const generated = summaries.reduce((n, s) => n + s.emitted.length, 0);
    return { generated, abos: summaries };
  },
  dunning: async (now) => {
    const result = await runDunningJob(now);
    return { ...result };
  },
  notifications: async (now) => {
    const result = await runNotificationsJob(now);
    return { ...result };
  },
  webhooks: async (now) => {
    const result = await runWebhookDeliveries({ now });
    return { ...result };
  },
  cleanup: async (now) => {
    const result = await runCleanupJob(now);
    return { ...result };
  },
};
