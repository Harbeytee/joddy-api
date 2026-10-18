import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { AgentTaskStatus, type Prisma } from '../../generated/prisma/client';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentService } from './agent.service';
import { ApplicantService } from './applicant.service';
import type { Question } from './robot/answers';
import { ROBOT, type Robot } from './robot/robot';
import type { RobotResult } from './robot/types';
import { HANDOFF, canAutoApply, type Handoff } from './robot/sites';

/** Tries per task before it goes back to the user. */
export const MAX_ATTEMPTS = 3;
/** A task left APPLYING this long belongs to a worker that died; it can be claimed again. */
const STALE_MINUTES = 15;

/**
 * Applies to queued jobs in the background. Several workers can run at once:
 * each claims one task at a time with FOR UPDATE SKIP LOCKED. A task is only
 * claimed for users who turned the agent on, uploaded a CV and gave consent.
 */
@Injectable()
export class ApplyWorker implements OnApplicationShutdown {
  private readonly logger = new Logger(ApplyWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> = Promise.resolve();
  private stopping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly applicant: ApplicantService,
    private readonly agent: AgentService,
    private readonly config: AppConfigService,
    @Inject(ROBOT) private readonly robot: Robot,
  ) {}

  start() {
    const submit = this.config.get('AUTO_APPLY_SUBMIT');
    this.logger.log(
      submit
        ? 'Apply worker started: applications will be submitted'
        : 'Apply worker started in dry run: forms are filled but never submitted (set AUTO_APPLY_SUBMIT=true to submit)',
    );
    this.schedule(0);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    clearTimeout(this.timer);
    await this.running;
  }

  /** Works through the queue until it's empty. */
  async drain() {
    while (!this.stopping && (await this.tick())) {
      // keep going
    }
  }

  /** Claims and processes one task. False when there was nothing to do. */
  async tick(): Promise<boolean> {
    await this.giveUpOnStuckTasks();
    const id = await this.claim();
    if (!id) return false;
    return this.process(id);
  }

  private schedule(ms: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.drain()
        .catch((err: unknown) => this.logger.error(`Apply loop failed: ${String(err)}`))
        .finally(() => this.schedule(this.config.get('AUTO_APPLY_POLL_MS')));
    }, ms);
  }

  private async claim(): Promise<string | null> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE agent_tasks
      SET status = 'APPLYING',
          "startedAt" = now() AT TIME ZONE 'UTC',
          attempts = attempts + 1,
          "updatedAt" = now() AT TIME ZONE 'UTC'
      WHERE id = (
        SELECT t.id
        FROM agent_tasks t
        JOIN agent_settings s ON s."userId" = t."userId" AND s.enabled
        JOIN applicant_profiles p ON p."userId" = t."userId"
          AND p."consentAt" IS NOT NULL
          AND btrim(p."firstName") <> '' AND btrim(p."lastName") <> '' AND btrim(p.phone) <> ''
        JOIN applicant_cvs c ON c."userId" = t."userId"
        WHERE t.attempts < ${MAX_ATTEMPTS}
          AND (
            t.status = 'QUEUED'
            OR (t.status = 'APPLYING'
                AND t."startedAt" < now() AT TIME ZONE 'UTC' - make_interval(mins => ${STALE_MINUTES}))
          )
        ORDER BY t."createdAt"
        LIMIT 1
        FOR UPDATE OF t SKIP LOCKED
      )
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  /** Tasks whose last try crashed the worker and that have no tries left go back to the user. */
  private async giveUpOnStuckTasks() {
    const { count } = await this.prisma.agentTask.updateMany({
      where: {
        status: AgentTaskStatus.APPLYING,
        attempts: { gte: MAX_ATTEMPTS },
        startedAt: { lt: new Date(Date.now() - STALE_MINUTES * 60_000) },
      },
      data: { status: AgentTaskStatus.FAILED, error: HANDOFF.error, startedAt: null },
    });
    if (count) this.logger.warn(`Gave up on ${count} task(s) that kept failing`);
  }

  /** Applies to one claimed task. False when the queue should be left alone until the next poll. */
  private async process(id: string): Promise<boolean> {
    const task = await this.prisma.agentTask.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            source: true,
            externalId: true,
            companySlug: true,
            url: true,
            applyUrl: true,
            isActive: true,
          },
        },
      },
    });
    if (!task) return true;
    if (!task.job.isActive || !canAutoApply(task.job.source)) {
      await this.handBack(id, task.job.isActive ? HANDOFF.unsupportedSite : HANDOFF.closed);
      return true;
    }

    const ready = await this.applicant.forRobot(task.userId);
    if (!ready) {
      // The profile changed after the claim (e.g. consent withdrawn). Put the task back and
      // end this pass, so a profile the claim query still accepts can't loop forever.
      await this.update(id, {
        status: AgentTaskStatus.QUEUED,
        startedAt: null,
        attempts: { decrement: 1 },
      });
      return false;
    }

    let result: RobotResult;
    try {
      result = await this.robot.apply(
        {
          job: task.job,
          applicant: ready.applicant,
          cv: ready.cv,
          submit: this.config.get('AUTO_APPLY_SUBMIT'),
        },
        id,
      );
    } catch (err) {
      this.logger.warn(`Task ${id} attempt ${task.attempts} failed: ${String(err)}`);
      if (task.attempts >= MAX_ATTEMPTS) await this.handBack(id, HANDOFF.error);
      else await this.update(id, { status: AgentTaskStatus.QUEUED, startedAt: null });
      return true;
    }

    if (result.outcome === 'handoff') {
      if (result.detail) this.logger.log(`Task ${id} handed back: ${result.detail}`);
      await this.handBack(id, result.reason, result.missing);
      return true;
    }

    this.logger.log(`Submitted application for task ${id}`);
    try {
      await this.agent.recordSubmitted(id, true);
    } catch (err) {
      // The application went out, so the task must never be retried.
      this.logger.error(`Task ${id} was submitted but not recorded: ${String(err)}`);
      await this.update(id, {
        status: AgentTaskStatus.SUBMITTED,
        submittedAt: new Date(),
        submittedByAgent: true,
        startedAt: null,
      });
    }
    return true;
  }

  private async handBack(id: string, reason: Handoff, missing: Question[] = []) {
    await this.update(id, {
      status: AgentTaskStatus.FAILED,
      error: reason,
      missing: missing as unknown as Prisma.InputJsonValue,
      startedAt: null,
    });
  }

  /** Updates a task unless it was deleted meanwhile (e.g. the user closed their account). */
  private async update(id: string, data: Prisma.AgentTaskUpdateManyMutationInput) {
    await this.prisma.agentTask.updateMany({ where: { id }, data });
  }
}
