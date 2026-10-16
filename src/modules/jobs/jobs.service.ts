import { Injectable, NotFoundException } from '@nestjs/common';
import { paginate, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { Prisma, type Job } from '../../generated/prisma/client';
import { Seniority, WorkplaceType } from '../../generated/prisma/enums';
import { PrismaService } from '../../prisma/prisma.service';
import type { DeactivateStaleDto, IngestJobDto } from './dto/ingest.dto';
import type { JobsQueryDto } from './dto/jobs-query.dto';
import { COUNTRY_CODES } from './geo/countries';
import { locationScope, looksRemote } from './geo/location-scope';
import { locationMatch, REGION_ORDER } from './geo/regions';
import { descriptionSnippet, jobTypeFromText, seniorityFromTitle } from './job-text';
import { matchJob } from './matching';

const LIST_SELECT = {
  id: true,
  source: true,
  companySlug: true,
  companyName: true,
  title: true,
  department: true,
  location: true,
  locations: true,
  workplaceType: true,
  employmentType: true,
  jobType: true,
  seniority: true,
  countries: true,
  regions: true,
  salaryMin: true,
  salaryMax: true,
  salaryCurrency: true,
  salaryInterval: true,
  url: true,
  applyUrl: true,
  postedAt: true,
  firstSeenAt: true,
  // Needed for match scoring and the snippet; stripped before the list is returned.
  description: true,
} satisfies Prisma.JobSelect;

type ListedJob = Prisma.JobGetPayload<{ select: typeof LIST_SELECT }>;

/** Everything the location filter accepts, so the UI and validation can't drift apart. */
const LOCATIONS = { regions: REGION_ORDER, countries: [...COUNTRY_CODES].sort() };

@Injectable()
export class JobsService {
  constructor(private readonly prisma: PrismaService) {}

  locations() {
    return LOCATIONS;
  }

  /**
   * How many jobs each filter option would return. Each group ignores its own filter
   * (so ticking "Part-time" doesn't zero out "Full-time") but applies all the others.
   */
  async facets(userId: string, q: JobsQueryDto) {
    const without = (key: 'workplaceType' | 'jobType' | 'seniority') =>
      this.buildWhere(userId, { ...q, [key]: undefined });
    const [total, workplace, jobType, seniority] = await Promise.all([
      this.prisma.job.count({ where: this.buildWhere(userId, q) }),
      this.prisma.job.groupBy({
        by: ['workplaceType'],
        where: without('workplaceType'),
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['jobType'],
        where: without('jobType'),
        _count: { _all: true },
      }),
      this.prisma.job.groupBy({
        by: ['seniority'],
        where: without('seniority'),
        _count: { _all: true },
      }),
    ]);

    const counts = <K extends string>(rows: { key: K | null; n: number }[]) =>
      Object.fromEntries(rows.filter((r) => r.key).map((r) => [r.key, r.n])) as Partial<
        Record<K, number>
      >;
    const seniorityCounts = counts(seniority.map((r) => ({ key: r.seniority, n: r._count._all })));
    // Matches the filter: MID includes titles that state no level.
    const unstated = seniority.find((r) => r.seniority === null)?._count._all ?? 0;
    seniorityCounts.MID = (seniorityCounts.MID ?? 0) + unstated;

    return {
      total,
      workplaceType: counts(workplace.map((r) => ({ key: r.workplaceType, n: r._count._all }))),
      jobType: counts(jobType.map((r) => ({ key: r.jobType, n: r._count._all }))),
      seniority: seniorityCounts,
    };
  }

  async list(userId: string, q: JobsQueryDto) {
    const where = this.buildWhere(userId, q);
    const [rows, total, skills] = await Promise.all([
      this.prisma.job.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [
          { postedAt: { sort: q.sort === 'oldest' ? 'asc' : 'desc', nulls: 'last' } },
          { id: 'asc' },
        ],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.job.count({ where }),
      this.userSkills(userId),
    ]);
    return paginate(await this.decorate(userId, rows, skills), total, q);
  }

  async listSaved(userId: string, q: PaginationQueryDto) {
    const where: Prisma.SavedJobWhereInput = { userId };
    const [saved, total, skills] = await Promise.all([
      this.prisma.savedJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: { job: { select: LIST_SELECT } },
      }),
      this.prisma.savedJob.count({ where }),
      this.userSkills(userId),
    ]);
    return paginate(
      await this.decorate(
        userId,
        saved.map((s) => s.job),
        skills,
      ),
      total,
      q,
    );
  }

  async get(userId: string, id: string) {
    const job = await this.prisma.job.findUnique({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');

    const [skills, saved, application] = await Promise.all([
      this.userSkills(userId),
      this.prisma.savedJob.findUnique({ where: { userId_jobId: { userId, jobId: id } } }),
      this.prisma.application.findFirst({
        where: { userId, jobId: id },
        select: { id: true, status: true, appliedAt: true },
      }),
    ]);
    return { ...job, match: matchJob(skills, job), isSaved: !!saved, application };
  }

  async save(userId: string, jobId: string): Promise<void> {
    await this.ensureExists(jobId);
    await this.prisma.savedJob.upsert({
      where: { userId_jobId: { userId, jobId } },
      create: { userId, jobId },
      update: {},
    });
  }

  async unsave(userId: string, jobId: string): Promise<void> {
    await this.prisma.savedJob.deleteMany({ where: { userId, jobId } });
  }

  /** "Not interested": also drops it from saved jobs so it disappears everywhere. */
  async hide(userId: string, jobId: string): Promise<void> {
    await this.ensureExists(jobId);
    await this.prisma.$transaction([
      this.prisma.hiddenJob.upsert({
        where: { userId_jobId: { userId, jobId } },
        create: { userId, jobId },
        update: {},
      }),
      this.prisma.savedJob.deleteMany({ where: { userId, jobId } }),
    ]);
  }

  async unhide(userId: string, jobId: string): Promise<void> {
    await this.prisma.hiddenJob.deleteMany({ where: { userId, jobId } });
  }

  /**
   * Bulk upsert from the scraper in a single statement. Row-by-row upserts are
   * far too slow for the ~250k jobs a full scrape produces.
   */
  async ingest(jobs: IngestJobDto[]): Promise<{ upserted: number }> {
    const rows = jobs.map((j) => {
      const places = [j.location, ...(j.locations ?? [])];
      const workplaceType = j.workplaceType
        ? j.workplaceType.toUpperCase()
        : looksRemote(places)
          ? WorkplaceType.REMOTE
          : null;
      return {
        externalId: j.id,
        source: j.source,
        companySlug: j.company,
        companyName: j.companyName,
        title: j.title,
        department: j.department ?? null,
        location: j.location ?? null,
        locations: j.locations ?? [],
        workplaceType,
        employmentType: j.employmentType ?? null,
        jobType: jobTypeFromText(j.employmentType),
        seniority: seniorityFromTitle(j.title),
        ...locationScope(places),
        salaryMin: roundOrNull(j.salary?.min),
        salaryMax: roundOrNull(j.salary?.max),
        salaryCurrency: j.salary?.currency ?? null,
        salaryInterval: j.salary?.interval ?? null,
        description: j.description ?? '',
        url: j.url,
        applyUrl: j.applyUrl ?? j.url,
        postedAt: j.postedAt ?? null,
      };
    });

    const upserted = await this.prisma.$executeRaw`
      INSERT INTO jobs (
        id, "externalId", source, "companySlug", "companyName", title, department, location, locations,
        "workplaceType", "employmentType", "jobType", seniority, countries, regions,
        "salaryMin", "salaryMax", "salaryCurrency", "salaryInterval",
        description, url, "applyUrl", "postedAt", "firstSeenAt", "lastSeenAt", "isActive"
      )
      SELECT
        gen_random_uuid(), r."externalId", r.source, r."companySlug", r."companyName", r.title, r.department,
        r.location, r.locations, r."workplaceType"::"WorkplaceType", r."employmentType",
        r."jobType"::"JobType", r.seniority::"Seniority", r.countries, r.regions::"Region"[],
        r."salaryMin", r."salaryMax", r."salaryCurrency", r."salaryInterval", r.description, r.url,
        r."applyUrl", r."postedAt", now(), now(), true
      FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS r(
        "externalId" text, source text, "companySlug" text, "companyName" text, title text,
        department text, location text, locations text[], "workplaceType" text, "employmentType" text,
        "jobType" text, seniority text, countries text[], regions text[],
        "salaryMin" int, "salaryMax" int, "salaryCurrency" text, "salaryInterval" text,
        description text, url text, "applyUrl" text, "postedAt" timestamptz
      )
      ON CONFLICT ("externalId") DO UPDATE SET
        "companyName" = EXCLUDED."companyName",
        title = EXCLUDED.title,
        department = EXCLUDED.department,
        location = EXCLUDED.location,
        locations = EXCLUDED.locations,
        "workplaceType" = EXCLUDED."workplaceType",
        "employmentType" = EXCLUDED."employmentType",
        "jobType" = EXCLUDED."jobType",
        seniority = EXCLUDED.seniority,
        countries = EXCLUDED.countries,
        regions = EXCLUDED.regions,
        "salaryMin" = EXCLUDED."salaryMin",
        "salaryMax" = EXCLUDED."salaryMax",
        "salaryCurrency" = EXCLUDED."salaryCurrency",
        "salaryInterval" = EXCLUDED."salaryInterval",
        description = EXCLUDED.description,
        url = EXCLUDED.url,
        "applyUrl" = EXCLUDED."applyUrl",
        "postedAt" = COALESCE(EXCLUDED."postedAt", jobs."postedAt"),
        "lastSeenAt" = now(),
        "isActive" = true
    `;
    return { upserted };
  }

  async deactivateStale(dto: DeactivateStaleDto): Promise<{ deactivated: number }> {
    const { count } = await this.prisma.job.updateMany({
      where: {
        isActive: true,
        lastSeenAt: { lt: new Date(dto.notSeenSince) },
        ...(dto.source ? { source: dto.source } : {}),
      },
      data: { isActive: false },
    });
    return { deactivated: count };
  }

  async userSkills(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { skills: true },
    });
    return user?.skills ?? [];
  }

  private buildWhere(userId: string, q: Omit<JobsQueryDto, 'skip'>): Prisma.JobWhereInput {
    const and: Prisma.JobWhereInput[] = [{ isActive: true }, { hiddenBy: { none: { userId } } }];

    const terms = q.q?.trim().split(/\s+/).filter(Boolean).slice(0, 8) ?? [];
    for (const term of terms) {
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { companyName: { contains: term, mode: 'insensitive' } },
        ],
      });
    }
    if (q.location?.trim()) {
      and.push({ location: { contains: q.location.trim(), mode: 'insensitive' } });
    }
    if (q.seniority?.length) {
      // Most titles don't state a level ("Product Designer"); those read as mid level.
      and.push({
        OR: [
          { seniority: { in: q.seniority } },
          ...(q.seniority.includes(Seniority.MID) ? [{ seniority: null }] : []),
        ],
      });
    }
    if (q.workplaceType?.length) and.push({ workplaceType: { in: q.workplaceType } });
    if (q.jobType?.length) and.push({ jobType: { in: q.jobType } });
    if (q.country?.length || q.region?.length) {
      const match = locationMatch(q.country ?? [], q.region ?? []);
      and.push({
        OR: [
          ...(match.countries.length ? [{ countries: { hasSome: match.countries } }] : []),
          { regions: { hasSome: match.regions } },
        ],
      });
    }
    if (q.source) and.push({ source: q.source });
    if (q.postedWithinDays) {
      and.push({ postedAt: { gte: new Date(Date.now() - q.postedWithinDays * 86_400_000) } });
    }
    if (q.hasSalary) and.push({ salaryMax: { not: null } });
    // A range matches when it overlaps the job's own range.
    if (q.salaryMin) and.push({ salaryInterval: 'year', salaryMax: { gte: q.salaryMin } });
    if (q.salaryMax) {
      and.push({
        salaryInterval: 'year',
        OR: [
          { salaryMin: { lte: q.salaryMax } },
          { salaryMin: null, salaryMax: { lte: q.salaryMax } },
        ],
      });
    }

    return { AND: and };
  }

  private async decorate(userId: string, jobs: ListedJob[], skills: string[]) {
    const ids = jobs.map((j) => j.id);
    const [saved, applied] = await Promise.all([
      this.prisma.savedJob.findMany({
        where: { userId, jobId: { in: ids } },
        select: { jobId: true },
      }),
      this.prisma.application.findMany({
        where: { userId, jobId: { in: ids } },
        select: { jobId: true, status: true },
      }),
    ]);
    const savedSet = new Set(saved.map((s) => s.jobId));
    const appliedMap = new Map(applied.map((a) => [a.jobId, a.status]));

    return jobs.map(({ description, ...job }) => ({
      ...job,
      snippet: descriptionSnippet(description),
      match: matchJob(skills, { title: job.title, description }),
      isSaved: savedSet.has(job.id),
      applicationStatus: appliedMap.get(job.id) ?? null,
    }));
  }

  private async ensureExists(id: string): Promise<Pick<Job, 'id'>> {
    const job = await this.prisma.job.findUnique({ where: { id }, select: { id: true } });
    if (!job) throw new NotFoundException('Job not found');
    return job;
  }
}

function roundOrNull(n: number | null | undefined): number | null {
  return n == null ? null : Math.round(n);
}
