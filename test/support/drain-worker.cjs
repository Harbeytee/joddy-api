/**
 * Runs the compiled apply worker once over the test database, with a scripted
 * robot instead of a browser, then exits. The job id decides what the robot
 * reports: "submit", "question", "captcha" or "crash".
 */
const { Module } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { AppConfigModule } = require('../../dist/config/config.module');
const { PrismaModule } = require('../../dist/prisma/prisma.module');
const { AgentModule } = require('../../dist/modules/agent/agent.module');
const { ApplyWorker } = require('../../dist/modules/agent/apply.worker');
const { ROBOT } = require('../../dist/modules/agent/robot/robot');

const scriptedRobot = {
  apply({ job, applicant, cv }) {
    if (!applicant.email || !cv.data.length) throw new Error('robot got no applicant or CV');
    const id = job.externalId;
    if (id.includes('submit')) return Promise.resolve({ outcome: 'submitted' });
    if (id.includes('captcha')) {
      return Promise.resolve({ outcome: 'handoff', reason: 'captcha', missing: [] });
    }
    if (id.includes('crash')) return Promise.reject(new Error('browser crashed'));
    const label = 'Are you open to relocation?';
    if (applicant.saved['are you open to relocation'] === 'No') {
      return Promise.resolve({ outcome: 'submitted' });
    }
    return Promise.resolve({
      outcome: 'handoff',
      reason: 'missing-answers',
      missing: [{ label, kind: 'select', required: true, options: ['Yes', 'No'] }],
    });
  },
};

class DrainModule {}
Module({
  imports: [AppConfigModule, PrismaModule, AgentModule],
  providers: [{ provide: ROBOT, useValue: scriptedRobot }, ApplyWorker],
})(DrainModule);

(async () => {
  const app = await NestFactory.createApplicationContext(DrainModule, { logger: false });
  await app.get(ApplyWorker).drain();
  await app.close();
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
