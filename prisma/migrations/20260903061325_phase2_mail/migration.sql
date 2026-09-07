-- CreateTable
CREATE TABLE "MailSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "security" TEXT NOT NULL,
    "username" TEXT,
    "passwordEnc" TEXT,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "defaultCc" TEXT NOT NULL DEFAULT '',
    "defaultBcc" TEXT NOT NULL DEFAULT '',
    "copyToSelf" BOOLEAN NOT NULL DEFAULT false,
    "lastTestAt" DATETIME,
    "lastTestOk" BOOLEAN,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MailSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EmailLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "templateId" TEXT,
    "toJson" TEXT NOT NULL DEFAULT '[]',
    "ccJson" TEXT NOT NULL DEFAULT '[]',
    "bccJson" TEXT NOT NULL DEFAULT '[]',
    "fromEmail" TEXT NOT NULL DEFAULT '',
    "replyTo" TEXT,
    "subject" TEXT NOT NULL,
    "bodySnapshot" TEXT NOT NULL,
    "attachmentsJson" TEXT NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerId" TEXT,
    "error" TEXT,
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "resendOfId" TEXT,
    "sentByUserId" TEXT,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailLog_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EmailLog" ("attachmentsJson", "bccJson", "bodySnapshot", "ccJson", "createdAt", "docId", "docType", "error", "id", "orgId", "providerId", "sentAt", "status", "subject", "templateId", "toJson") SELECT "attachmentsJson", "bccJson", "bodySnapshot", "ccJson", "createdAt", "docId", "docType", "error", "id", "orgId", "providerId", "sentAt", "status", "subject", "templateId", "toJson" FROM "EmailLog";
DROP TABLE "EmailLog";
ALTER TABLE "new_EmailLog" RENAME TO "EmailLog";
CREATE INDEX "EmailLog_orgId_idx" ON "EmailLog"("orgId");
CREATE INDEX "EmailLog_docType_docId_idx" ON "EmailLog"("docType", "docId");
CREATE TABLE "new_EmailTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "signature" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EmailTemplate_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_EmailTemplate" ("body", "createdAt", "docType", "id", "isDefault", "name", "orgId", "signature", "subject", "updatedAt") SELECT "body", "createdAt", "docType", "id", "isDefault", "name", "orgId", "signature", "subject", "updatedAt" FROM "EmailTemplate";
DROP TABLE "EmailTemplate";
ALTER TABLE "new_EmailTemplate" RENAME TO "EmailTemplate";
CREATE INDEX "EmailTemplate_orgId_docType_idx" ON "EmailTemplate"("orgId", "docType");
CREATE UNIQUE INDEX "EmailTemplate_orgId_docType_name_key" ON "EmailTemplate"("orgId", "docType", "name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "MailSettings_orgId_key" ON "MailSettings"("orgId");
