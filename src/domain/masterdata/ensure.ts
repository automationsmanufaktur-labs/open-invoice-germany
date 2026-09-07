import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { SYSTEM_PAYMENT_METHODS, DEFAULT_DUNNING_STAGES } from "./defaults";

type Db = PrismaClient | Prisma.TransactionClient;

/** Legt Systemzahlungsmethoden und Standard-Mahnstufen fuer eine Organisation an (idempotent). */
export async function ensureOrgMasterdata(db: Db, orgId: string): Promise<void> {
  for (const m of SYSTEM_PAYMENT_METHODS) {
    await db.paymentMethod.upsert({
      where: { orgId_code: { orgId, code: m.code } },
      create: { orgId, code: m.code, name: m.name, untdidCode: m.untdidCode, isSystem: true, sortOrder: m.sortOrder },
      update: {},
    });
  }
  for (const s of DEFAULT_DUNNING_STAGES) {
    await db.dunningStage.upsert({
      where: { orgId_order: { orgId, order: s.order } },
      create: { orgId, ...s },
      update: {},
    });
  }
}
