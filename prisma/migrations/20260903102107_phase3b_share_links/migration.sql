-- CreateTable
CREATE TABLE "QuoteShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "revokedAt" DATETIME,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" DATETIME,
    "decidedAt" DATETIME,
    "decision" TEXT,
    "deciderName" TEXT,
    "deciderEmail" TEXT,
    "deciderComment" TEXT,
    "deciderIp" TEXT,
    CONSTRAINT "QuoteShareLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DocumentSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "orgId" TEXT NOT NULL,
    "onQuoteAccept" TEXT NOT NULL DEFAULT 'NONE',
    "shareLinkDays" INTEGER NOT NULL DEFAULT 30,
    "storeAcceptIp" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DocumentSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteShareLink_tokenHash_key" ON "QuoteShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteShareLink_orgId_quoteId_idx" ON "QuoteShareLink"("orgId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSettings_orgId_key" ON "DocumentSettings"("orgId");
