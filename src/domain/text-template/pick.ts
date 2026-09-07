/**
 * Waehlt den Text einer Textvorlage fuer (docType, position) aus: die als Standard
 * markierte Vorlage, sonst die aelteste vorhandene. Liefert `null`, wenn keine Vorlage
 * existiert (Aufrufer laesst das Feld dann leer statt einen Fehler zu werfen).
 */
import type { Prisma, PrismaClient } from "@/generated/prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

export async function pickTextTemplate(db: Db, orgId: string, docType: string, position: string): Promise<string | null> {
  const found = await db.textTemplate.findFirst({
    where: { orgId, docType, position },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
  });
  return found?.body ?? null;
}
