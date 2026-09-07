-- CreateTable
CREATE TABLE "QuoteShareLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "quoteId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "decision" TEXT,
    "deciderName" TEXT,
    "deciderEmail" TEXT,
    "deciderComment" TEXT,
    "deciderIp" TEXT,

    CONSTRAINT "QuoteShareLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSettings" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "onQuoteAccept" TEXT NOT NULL DEFAULT 'NONE',
    "shareLinkDays" INTEGER NOT NULL DEFAULT 30,
    "storeAcceptIp" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuoteShareLink_tokenHash_key" ON "QuoteShareLink"("tokenHash");

-- CreateIndex
CREATE INDEX "QuoteShareLink_orgId_quoteId_idx" ON "QuoteShareLink"("orgId", "quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSettings_orgId_key" ON "DocumentSettings"("orgId");

-- AddForeignKey
ALTER TABLE "QuoteShareLink" ADD CONSTRAINT "QuoteShareLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSettings" ADD CONSTRAINT "DocumentSettings_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
