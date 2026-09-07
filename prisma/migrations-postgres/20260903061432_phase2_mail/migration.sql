/*
  Warnings:

  - A unique constraint covering the columns `[orgId,docType,name]` on the table `EmailTemplate` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "EmailLog" ADD COLUMN     "fromEmail" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "replyTo" TEXT,
ADD COLUMN     "resendOfId" TEXT,
ADD COLUMN     "sentByUserId" TEXT,
ADD COLUMN     "warningsJson" TEXT NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "EmailTemplate" ADD COLUMN     "isSystem" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MailSettings" (
    "id" TEXT NOT NULL,
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
    "lastTestAt" TIMESTAMP(3),
    "lastTestOk" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailSettings_orgId_key" ON "MailSettings"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_orgId_docType_name_key" ON "EmailTemplate"("orgId", "docType", "name");

-- AddForeignKey
ALTER TABLE "MailSettings" ADD CONSTRAINT "MailSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
