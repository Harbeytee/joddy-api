/**
 * Runs one pass of the compiled match worker over the test database, i.e. searches for every
 * user who is due, then exits. Prints how many users were searched.
 */
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppConfigModule } = require('../../dist/config/config.module');
const { PrismaModule } = require('../../dist/prisma/prisma.module');
const { AgentModule } = require('../../dist/modules/agent/agent.module');
const { MatchWorker } = require('../../dist/modules/agent/match.worker');

class MatchModule {}
Module({
  imports: [AppConfigModule, PrismaModule, AgentModule],
  providers: [MatchWorker],
})(MatchModule);

(async () => {
  const app = await NestFactory.createApplicationContext(MatchModule, { logger: false });
  const searched = await app.get(MatchWorker).runDue();
  await app.close();
  process.stdout.write(String(searched));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
