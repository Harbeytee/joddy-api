import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AgentService } from '../agent/agent.service';
import { ApplicationsService } from '../applications/applications.service';
import { JobsService } from '../jobs/jobs.service';
import { matchJob } from '../jobs/matching';

const WEEKS = 8;
const RECOMMENDATION_POOL = 300;

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly applications: ApplicationsService,
    private readonly agent: AgentService,
    private readonly jobs: JobsService,
  ) {}

  async summary(userId: string) {
    const since = startOfWeek(new Date(Date.now() - (WEEKS - 1) * 7 * 86_400_000));

    const [stats, agent, savedJobs, recent, applied, recommended] = await Promise.all([
      this.applications.stats(userId),
      this.agent.summary(userId),
      this.prisma.savedJob.count({ where: { userId } }),
      this.prisma.application.findMany({
        where: { userId },
        orderBy: { appliedAt: 'desc' },
        take: 5,
        select: {
          id: true,
          role: true,
          company: true,
          status: true,
          appliedAt: true,
          appliedVia: true,
        },
      }),
      this.prisma.application.findMany({
        where: { userId, appliedAt: { gte: since } },
        select: { appliedAt: true },
      }),
      this.recommended(userId),
    ]);

    const weekly = Array.from({ length: WEEKS }, (_, i) => ({
      weekStart: new Date(since.getTime() + i * 7 * 86_400_000).toISOString(),
      count: 0,
    }));
    for (const a of applied) {
      const idx = Math.floor((a.appliedAt.getTime() - since.getTime()) / (7 * 86_400_000));
      if (weekly[idx]) weekly[idx].count++;
    }

    const responded = stats.INTERVIEW + stats.OFFER + stats.REJECTED;
    return {
      applications: {
        ...stats,
        responseRate: stats.ALL ? Math.round((responded / stats.ALL) * 100) : 0,
        thisWeek: weekly[weekly.length - 1].count,
      },
      agent,
      savedJobs,
      weekly,
      recentApplications: recent,
      recommendedJobs: recommended,
    };
  }

  /** Best skill matches among the newest postings the user hasn't acted on. */
  private async recommended(userId: string) {
    const skills = await this.jobs.userSkills(userId);
    if (!skills.length) return [];

    const pool = await this.prisma.job.findMany({
      where: {
        isActive: true,
        applications: { none: { userId } },
        savedBy: { none: { userId } },
      },
      orderBy: { postedAt: { sort: 'desc', nulls: 'last' } },
      take: RECOMMENDATION_POOL,
      select: {
        id: true,
        title: true,
        companyName: true,
        location: true,
        workplaceType: true,
        postedAt: true,
        description: true,
      },
    });

    return pool
      .map(({ description, ...job }) => ({
        ...job,
        match: matchJob(skills, { title: job.title, description })!,
      }))
      .filter((j) => j.match.score > 0)
      .sort((a, b) => b.match.score - a.match.score)
      .slice(0, 5);
  }
}

function startOfWeek(d: Date): Date {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (date.getUTCDay() + 6) % 7; // Monday = 0
  date.setUTCDate(date.getUTCDate() - day);
  return date;
}
