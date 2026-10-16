import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { CreateResumeDto, ResumeContentDto, UpdateResumeDto } from './dto/resumes.dto';

const EMPTY_CONTENT: ResumeContentDto = {
  personal: {},
  summary: '',
  experience: [],
  education: [],
  skills: [],
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
        content: toJson({ ...EMPTY_CONTENT, ...dto.content }),
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
        content: dto.content ? toJson({ ...EMPTY_CONTENT, ...dto.content }) : undefined,
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

const toJson = (content: ResumeContentDto) =>
  JSON.parse(JSON.stringify(content)) as Prisma.InputJsonValue;
