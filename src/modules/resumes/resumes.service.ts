import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  CreateResumeDto,
  ResumeContentDto,
  ResumeDesignDto,
  UpdateResumeDto,
} from './dto/resumes.dto';

const EMPTY_CONTENT: ResumeContentDto = {
  personal: {},
  summary: '',
  experience: [],
  education: [],
  skills: [],
  projects: [],
  certifications: [],
  languages: [],
  interests: [],
  custom: [],
};

@Injectable()
export class ResumesService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.resume.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  async get(userId: string, id: string) {
    const resume = await this.prisma.resume.findFirst({ where: { id, userId } });
    if (!resume) throw new NotFoundException('Resume not found');
    return resume;
  }

  async create(userId: string, dto: CreateResumeDto) {
    const isFirst = (await this.prisma.resume.count({ where: { userId } })) === 0;
    return this.prisma.resume.create({
      data: {
        userId,
        title: dto.title,
        template: dto.template,
        isDefault: isFirst,
        content: withDefaults(dto.content ?? {}),
        design: toJson(dto.design ?? {}),
      },
    });
  }

  async update(userId: string, id: string, dto: UpdateResumeDto) {
    await this.get(userId, id);
    return this.prisma.resume.update({
      where: { id },
      data: {
        title: dto.title,
        template: dto.template,
        content: dto.content ? withDefaults(dto.content) : undefined,
        design: dto.design ? toJson(dto.design) : undefined,
      },
    });
  }

  async duplicate(userId: string, id: string) {
    const source = await this.get(userId, id);
    return this.prisma.resume.create({
      data: {
        userId,
        title: `${source.title} (copy)`.slice(0, 100),
        template: source.template,
        content: source.content as Prisma.InputJsonValue,
        design: source.design as Prisma.InputJsonValue,
      },
    });
  }

  async setDefault(userId: string, id: string) {
    await this.get(userId, id);
    const [, resume] = await this.prisma.$transaction([
      this.prisma.resume.updateMany({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      }),
      this.prisma.resume.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return resume;
  }

  async remove(userId: string, id: string): Promise<void> {
    const resume = await this.get(userId, id);
    await this.prisma.resume.delete({ where: { id } });
    if (resume.isDefault) {
      const next = await this.prisma.resume.findFirst({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
      });
      if (next)
        await this.prisma.resume.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  }
}

/** Round-trips through JSON so class-transformer instances and undefined keys don't reach Prisma. */
const toJson = (value: ResumeContentDto | ResumeDesignDto) =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** DTO instances carry every declared field, set to undefined when omitted, so strip those before merging. */
function withDefaults(content: ResumeContentDto) {
  const ids = (content.custom ?? []).map((s) => s.id);
  if (new Set(ids).size !== ids.length)
    throw new BadRequestException('Each custom section needs its own id');
  return toJson({ ...EMPTY_CONTENT, ...(toJson(content) as ResumeContentDto) });
}
