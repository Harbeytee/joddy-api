import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginate } from '../../common/dto/pagination.dto';
import { ApplicationStatus, Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ApplicationsQueryDto,
  CreateApplicationDto,
  UpdateApplicationDto,
} from './dto/applications.dto';

const INCLUDE = {
  resume: { select: { id: true, title: true } },
  job: { select: { id: true, url: true, applyUrl: true, companySlug: true } },
} satisfies Prisma.ApplicationInclude;

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, q: ApplicationsQueryDto) {
    const where: Prisma.ApplicationWhereInput = {
      userId,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q?.trim()
        ? {
            OR: [
              { role: { contains: q.q.trim(), mode: 'insensitive' } },
              { company: { contains: q.q.trim(), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: INCLUDE,
        orderBy: { appliedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.application.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async stats(userId: string): Promise<Record<ApplicationStatus | 'ALL', number>> {
    const groups = await this.prisma.application.groupBy({
      by: ['status'],
      where: { userId },
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      Object.values(ApplicationStatus).map((s) => [s, 0]),
    ) as Record<ApplicationStatus, number>;
    for (const g of groups) counts[g.status] = g._count._all;
    return { ALL: Object.values(counts).reduce((a, b) => a + b, 0), ...counts };
  }

  async get(userId: string, id: string) {
    const app = await this.prisma.application.findFirst({
      where: { id, userId },
      include: INCLUDE,
    });
    if (!app) throw new NotFoundException('Application not found');
    return app;
  }

  async create(userId: string, dto: CreateApplicationDto) {
    const fromJob = dto.jobId ? await this.jobDefaults(dto.jobId) : undefined;
    await this.assertOwnResume(userId, dto.resumeId);

    const role = dto.role ?? fromJob?.role;
    const company = dto.company ?? fromJob?.company;
    if (!role || !company) throw new BadRequestException('Role and company are required');

    return this.prisma.application.create({
      data: { ...fromJob, ...stripUndefined(dto), role, company, userId },
      include: INCLUDE,
    });
  }

  async update(userId: string, id: string, dto: UpdateApplicationDto) {
    await this.get(userId, id);
    await this.assertOwnResume(userId, dto.resumeId);
    return this.prisma.application.update({
      where: { id },
      data: stripUndefined(dto),
      include: INCLUDE,
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.application.deleteMany({ where: { id, userId } });
    if (!count) throw new NotFoundException('Application not found');
  }

  private async jobDefaults(jobId: string) {
    const job = await this.prisma.job.findUnique({ where: { id: jobId } });
    if (!job) throw new BadRequestException('Job not found');
    return {
      role: job.title,
      company: job.companyName,
      location: job.location ?? undefined,
      url: job.url,
      source: job.source,
    };
  }

  private async assertOwnResume(userId: string, resumeId?: string): Promise<void> {
    if (!resumeId) return;
    const resume = await this.prisma.resume.findFirst({ where: { id: resumeId, userId } });
    if (!resume) throw new BadRequestException('Resume not found');
  }
}

function stripUndefined<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}
