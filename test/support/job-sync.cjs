/**
 * Runs the compiled job sync once over the test database (scrape + import if due), then exits.
 * Prints the finished run as JSON, or `null` when no sync was due.
 */
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppConfigModule } = require('../../dist/config/config.module');
const { PrismaModule } = require('../../dist/prisma/prisma.module');
const { JobSyncModule } = require('../../dist/modules/job-sync/job-sync.module');
const { JobSyncWorker } = require('../../dist/modules/job-sync/job-sync.worker');

class SyncModule {}
Module({ imports: [AppConfigModule, PrismaModule, JobSyncModule] })(SyncModule);

(async () => {
  const app = await NestFactory.createApplicationContext(SyncModule, { logger: false });
  const run = await app.get(JobSyncWorker).runIfDue();
  await app.close();
  process.stdout.write(JSON.stringify(run));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
