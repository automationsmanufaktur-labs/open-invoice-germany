-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NumberRange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "prefix" TEXT NOT NULL DEFAULT '',
    "pattern" TEXT NOT NULL DEFAULT '{PREFIX}{YYYY}-{SEQ}',
    "seqPadding" INTEGER NOT NULL DEFAULT 4,
    "year" INTEGER NOT NULL DEFAULT 0,
    "currentValue" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NumberRange_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_NumberRange" ("createdAt", "currentValue", "docType", "id", "orgId", "pattern", "prefix", "seqPadding", "updatedAt", "year") SELECT "createdAt", "currentValue", "docType", "id", "orgId", "pattern", "prefix", "seqPadding", "updatedAt", "year" FROM "NumberRange";
DROP TABLE "NumberRange";
ALTER TABLE "new_NumberRange" RENAME TO "NumberRange";
CREATE INDEX "NumberRange_orgId_idx" ON "NumberRange"("orgId");
CREATE UNIQUE INDEX "NumberRange_orgId_docType_year_key" ON "NumberRange"("orgId", "docType", "year");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
