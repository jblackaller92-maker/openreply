-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "collectEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leadLocale" TEXT;

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "automationId" TEXT,
    "source" TEXT NOT NULL,
    "igUserId" TEXT,
    "igUsername" TEXT,
    "email" TEXT NOT NULL,
    "countryA2" TEXT,
    "countryRaw" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'es',
    "newsletterOptIn" BOOLEAN NOT NULL DEFAULT false,
    "token" TEXT NOT NULL,
    "messageId" TEXT,
    "ipHash" TEXT,
    "emailSentAt" TIMESTAMP(3),
    "emailError" TEXT,
    "dmConfirmedAt" TIMESTAMP(3),
    "reportOpenedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lead_token_key" ON "Lead"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_messageId_key" ON "Lead"("messageId");

-- CreateIndex
CREATE INDEX "Lead_workspaceId_createdAt_idx" ON "Lead"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_instagramAccountId_fkey" FOREIGN KEY ("instagramAccountId") REFERENCES "InstagramAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Turn lead capture on for the two ISO Survey 2025 campaigns that already exist
-- in production (fvr.mx in Spanish, fvr.usa in English). A no-op anywhere else.
UPDATE "Automation" SET "collectEmail" = true, "leadLocale" = 'es' WHERE "id" = 'cmv52jn34000t1zmotby696zd';
UPDATE "Automation" SET "collectEmail" = true, "leadLocale" = 'en' WHERE "id" = 'cmv52nway000v1zmonlev3rnd';
