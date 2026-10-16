import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate } from '../../common/dto/pagination.dto';
import {
  AgentMode,
  AgentTaskStatus,
  AppliedVia,
  type AgentSettings,
  type Prisma,
} from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { matchJob } from '../jobs/matching';
import type { AgentTasksQueryDto, UpdateAgentSettingsDto } from './dto/agent.dto';

/** How far back the agent looks for postings, and how many it scores per run. */
const LOOKBACK_DAYS = 14;
const CANDIDATE_POOL = 500;

const TASK_INCLUDE = {
  job: {
    select: {
      id: true,
      title: true,
      companyName: true,
      location: true,
      workplaceType: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryInterval: true,
      url: true,
      applyUrl: true,
      postedAt: true,
    },
  },
} satisfies Prisma.AgentTaskInclude;

@Injectable()
export class AgentService {
  constructor(private readonly prisma: PrismaService) {}

  getSettings(userId: string): Promise<AgentSettings> {
    return this.prisma.agentSettings.upsert({ where: { userId }, create: { userId }, update: {} });
  }

  async updateSettings(userId: string, dto: UpdateAgentSettingsDto): Promise<AgentSettings> {
    if (dto.resumeId) {
      const resume = await this.prisma.resume.findFirst({ where: { id: dto.resumeId, userId } });
      if (!resume) throw new BadRequestException('Resume not found');
    }
    return this.prisma.agentSettings.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async summary(userId: string) {
    const groups = await this.prisma.agentTask.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(Object.values(AgentTaskStatus).map((s) => [s, 0])) as Record<
      AgentTaskStatus,
      number
    >;
    for (const g of groups) counts[g.status] = g._count._all;
    return { ...counts, today: await this.createdToday(userId) };
  }

  async listTasks(userId: string, q: AgentTasksQueryDto) {
    const where: Prisma.AgentTaskWhereInput = { userId, ...(q.status ? { status: q.status } : {}) };
    const [items, total] = await Promise.all([
      this.prisma.agentTask.findMany({
        where,
        include: TASK_INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { matchScore: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.agentTask.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  /**
   * Finds recent jobs matching the user's targeting rules, scores them against
   * their skills and queues the best ones, up to the daily limit.
   */
  async run(userId: string) {
    const settings = await this.getSettings(userId);
    if (!settings.enabled) throw new BadRequestException('Turn on auto-apply first');
    if (!settings.keywords.length) {
      throw new BadRequestException(
        'Add the job titles you want in Job preferences so Joddy knows what to look for',
      );
    }

    const remaining = settings.dailyLimit - (await this.createdToday(userId));
    if (remaining <= 0) return { queued: 0, scanned: 0, reason: 'daily-limit-reached' as const };

    const skills = await this.skillsFor(userId, settings.resumeId);
    if (!skills.length) {
      throw new BadRequestException(
        'Add your skills in Settings so Joddy can find jobs that fit you',
      );
    }

    const candidates = await this.prisma.job.findMany({
      where: this.candidateWhere(userId, settings),
      select: { id: true, title: true, description: true },
      orderBy: { postedAt: 'desc' },
      take: CANDIDATE_POOL,
    });

    const picks = candidates
      .map((job) => ({ job, match: matchJob(skills, job)! }))
      .filter((c) => c.match.score >= settings.minMatchScore)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, remaining);

    const status =
      settings.mode === AgentMode.AUTO ? AgentTaskStatus.QUEUED : AgentTaskStatus.NEEDS_REVIEW;
    const { count } = await this.prisma.agentTask.createMany({
      data: picks.map((p) => ({
        userId,
        jobId: p.job.id,
        status,
        matchScore: p.match.score,
        matched: p.match.matched,
      })),
      skipDuplicates: true,
    });
    return { queued: count, scanned: candidates.length, reason: null };
  }

  approve(userId: string, id: string) {
    return this.transition(userId, id, [AgentTaskStatus.NEEDS_REVIEW], AgentTaskStatus.QUEUED);
  }

  skip(userId: string, id: string) {
    return this.transition(
      userId,
      id,
      [AgentTaskStatus.NEEDS_REVIEW, AgentTaskStatus.QUEUED, AgentTaskStatus.FAILED],
      AgentTaskStatus.SKIPPED,
    );
  }

  /** For when the user applies themselves from the queue; records it in their tracker. */
  async markApplied(userId: string, id: string) {
    const task = await this.findTask(userId, id);
    if (task.status === AgentTaskStatus.SUBMITTED) return task;

    const settings = await this.getSettings(userId);
    const job = await this.prisma.job.findUniqueOrThrow({ where: { id: task.jobId } });
    const [, updated] = await this.prisma.$transaction([
      this.prisma.application.create({
        data: {
          userId,
          jobId: job.id,
          resumeId: settings.resumeId,
          role: job.title,
          company: job.companyName,
          location: job.location,
          url: job.url,
          source: job.source,
          appliedVia: AppliedVia.AGENT,
        },
      }),
      this.prisma.agentTask.update({
        where: { id },
        data: { status: AgentTaskStatus.SUBMITTED, submittedAt: new Date(), error: null },
        include: TASK_INCLUDE,
      }),
    ]);
    return updated;
  }

  private async transition(
    userId: string,
    id: string,
    from: AgentTaskStatus[],
    to: AgentTaskStatus,
  ) {
    const task = await this.findTask(userId, id);
    if (!from.includes(task.status)) {
      throw new BadRequestException(
        `Cannot move a ${task.status.toLowerCase()} task to ${to.toLowerCase()}`,
      );
    }
    return this.prisma.agentTask.update({
      where: { id },
      data: { status: to },
      include: TASK_INCLUDE,
    });
  }

  private async findTask(userId: string, id: string) {
    const task = await this.prisma.agentTask.findFirst({ where: { id, userId } });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  private candidateWhere(userId: string, s: AgentSettings): Prisma.JobWhereInput {
    const and: Prisma.JobWhereInput[] = [
      { isActive: true },
      { postedAt: { gte: new Date(Date.now() - LOOKBACK_DAYS * 86_400_000) } },
      { OR: s.keywords.map((k) => ({ title: { contains: k, mode: 'insensitive' as const } })) },
      { agentTasks: { none: { userId } } },
      { applications: { none: { userId } } },
      { hiddenBy: { none: { userId } } },
    ];
    for (const ex of s.excludedKeywords) {
      and.push({ NOT: { title: { contains: ex, mode: 'insensitive' } } });
    }
    if (s.remoteOnly) and.push({ workplaceType: 'REMOTE' });
    if (s.locations.length) {
      and.push({
        OR: s.locations.map((l) => ({ location: { contains: l, mode: 'insensitive' as const } })),
      });
    }
    return { AND: and };
  }

  private async skillsFor(userId: string, resumeId: string | null): Promise<string[]> {
    const [user, resume] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { skills: true } }),
      resumeId
        ? this.prisma.resume.findFirst({
            where: { id: resumeId, userId },
            select: { content: true },
          })
        : this.prisma.resume.findFirst({
            where: { userId, isDefault: true },
            select: { content: true },
          }),
    ]);
    const resumeSkills = (resume?.content as { skills?: string[] } | null)?.skills ?? [];
    return [...new Set([...(user?.skills ?? []), ...resumeSkills])];
  }

  private createdToday(userId: string): Promise<number> {
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    return this.prisma.agentTask.count({ where: { userId, createdAt: { gte: start } } });
  }
}
