-- AlterTable
ALTER TABLE "agent_settings" ADD COLUMN "lastRunAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "agent_settings_enabled_lastRunAt_idx" ON "agent_settings"("enabled", "lastRunAt");
