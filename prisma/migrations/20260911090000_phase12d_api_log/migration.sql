-- Phase 12d — Anfrageprotokoll der REST-API. Zwei neue Tabellen, kein Bestandsdatensatz
-- wird angefasst; ohne ApiSettings-Zeile gelten die Defaults (Protokoll AUS).
-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "apiKeyId" TEXT,
    "requestId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "query" TEXT,
    "status" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "errorCode" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestBody" TEXT,
    "responseBody" TEXT,
    "bodyTruncated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ApiSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "logRequests" BOOLEAN NOT NULL DEFAULT false,
    "logBodies" BOOLEAN NOT NULL DEFAULT false,
    "retentionDays" INTEGER NOT NULL DEFAULT 7,
    "maxRows" INTEGER NOT NULL DEFAULT 2000,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ApiRequestLog_orgId_createdAt_idx" ON "ApiRequestLog"("orgId", "createdAt");
CREATE INDEX "ApiRequestLog_orgId_status_createdAt_idx" ON "ApiRequestLog"("orgId", "status", "createdAt");
CREATE INDEX "ApiRequestLog_createdAt_idx" ON "ApiRequestLog"("createdAt");
CREATE UNIQUE INDEX "ApiSettings_orgId_key" ON "ApiSettings"("orgId");
