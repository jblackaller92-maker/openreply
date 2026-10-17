-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "company" TEXT,
ADD COLUMN     "data" JSONB,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "origin" TEXT;

-- CreateIndex
CREATE INDEX "Lead_workspaceId_origin_idx" ON "Lead"("workspaceId", "origin");
