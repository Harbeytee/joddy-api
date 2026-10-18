import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateApplicantProfileDto } from './dto/applicant.dto';
import { questionKey, type Applicant } from './robot/answers';
import type { RobotCv } from './robot/types';

export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const PROFILE_SELECT = {
  firstName: true,
  lastName: true,
  phone: true,
  city: true,
  country: true,
  linkedinUrl: true,
  websiteUrl: true,
  workCountries: true,
  noticePeriod: true,
  salaryExpectation: true,
  answers: true,
  consentAt: true,
  updatedAt: true,
  cv: { select: { fileName: true, mimeType: true, size: true, uploadedAt: true } },
} satisfies Prisma.ApplicantProfileSelect;

type ProfileRow = Prisma.ApplicantProfileGetPayload<{ select: typeof PROFILE_SELECT }>;

/** The fields a new profile is seeded with from the user's account. */
type ProfileSeed = Pick<
  ProfileRow,
  'firstName' | 'lastName' | 'phone' | 'city' | 'country' | 'workCountries'
>;

/** The parts of a multer upload the service reads. */
export interface UploadedCv {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/** What has to be filled in before Joddy may apply for someone. */
export type ApplicantGap = 'firstName' | 'lastName' | 'phone' | 'cv' | 'consent';

/** Saved answers as stored: question key → answer. */
export type SavedAnswers = Record<string, string>;

@Injectable()
export class ApplicantService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string) {
    const [user, row] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { email: true, name: true, location: true },
      }),
      this.prisma.applicantProfile.findUnique({ where: { userId }, select: PROFILE_SELECT }),
    ]);
    const profile = row
      ? { ...row, answers: savedAnswers(row.answers) }
      : {
          ...seedFrom(user),
          linkedinUrl: null,
          websiteUrl: null,
          noticePeriod: null,
          salaryExpectation: null,
          answers: {},
          consentAt: null,
          updatedAt: null,
          cv: null,
        };
    const missing = gaps(profile);
    return { ...profile, email: user.email, missing, ready: missing.length === 0 };
  }

  async update(userId: string, dto: UpdateApplicantProfileDto) {
    const { consent, answers, ...fields } = dto;
    const current = await this.prisma.applicantProfile.findUnique({
      where: { userId },
      select: { consentAt: true },
    });
    const consentAt =
      consent === undefined ? undefined : consent ? (current?.consentAt ?? new Date()) : null;
    // Fields the request left out must not override the seed values below.
    const given = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
    const data = {
      ...given,
      ...(answers ? { answers: normaliseAnswers(answers) } : {}),
    };
    await this.prisma.applicantProfile.upsert({
      where: { userId },
      create: {
        ...(current ? {} : seedFrom(await this.userBasics(userId))),
        ...data,
        consentAt: consentAt ?? null,
        userId,
      },
      update: { ...data, consentAt },
    });
    return this.get(userId);
  }

  /** Adds answers to the user's saved answers, replacing any for the same questions. */
  async saveAnswers(userId: string, answers: Record<string, string>) {
    await this.ensureProfile(userId);
    const row = await this.prisma.applicantProfile.findUniqueOrThrow({
      where: { userId },
      select: { answers: true },
    });
    const merged = { ...savedAnswers(row.answers), ...normaliseAnswers(answers) };
    await this.prisma.applicantProfile.update({ where: { userId }, data: { answers: merged } });
  }

  async uploadCv(userId: string, file: UploadedCv | undefined) {
    if (!file) throw new BadRequestException('Choose a file to upload');
    if (!CV_MIME_TYPES.has(file.mimetype))
      throw new BadRequestException('Upload your CV as a PDF or Word document');
    if (file.size > CV_MAX_BYTES) throw new BadRequestException('Your CV must be 5 MB or smaller');

    await this.ensureProfile(userId);
    const cv = {
      fileName: file.originalname.slice(0, 200),
      mimeType: file.mimetype,
      size: file.size,
      data: new Uint8Array(file.buffer),
      uploadedAt: new Date(),
    };
    await this.prisma.applicantCv.upsert({
      where: { userId },
      create: { userId, ...cv },
      update: cv,
    });
    return this.get(userId);
  }

  async getCv(userId: string) {
    const cv = await this.prisma.applicantCv.findUnique({ where: { userId } });
    if (!cv) throw new NotFoundException('No CV uploaded');
    return cv;
  }

  async deleteCv(userId: string) {
    await this.prisma.applicantCv.deleteMany({ where: { userId } });
    return this.get(userId);
  }

  /** Everything the robot needs to apply for this user, or null if they aren't ready. */
  async forRobot(userId: string): Promise<{ applicant: Applicant; cv: RobotCv } | null> {
    const row = await this.prisma.applicantProfile.findUnique({
      where: { userId },
      include: { cv: true, user: { select: { email: true } } },
    });
    if (!row?.cv || gaps({ ...row, cv: row.cv }).length) return null;
    return {
      applicant: {
        firstName: row.firstName,
        lastName: row.lastName,
        email: row.user.email,
        phone: row.phone,
        city: row.city,
        country: row.country,
        linkedinUrl: row.linkedinUrl,
        websiteUrl: row.websiteUrl,
        workCountries: row.workCountries,
        noticePeriod: row.noticePeriod,
        salaryExpectation: row.salaryExpectation,
        saved: savedAnswers(row.answers),
      },
      cv: {
        fileName: row.cv.fileName,
        mimeType: row.cv.mimeType,
        data: Buffer.from(row.cv.data),
      },
    };
  }

  private async ensureProfile(userId: string) {
    const exists = await this.prisma.applicantProfile.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!exists) {
      await this.prisma.applicantProfile.create({
        data: { ...seedFrom(await this.userBasics(userId)), userId },
      });
    }
  }

  private userBasics(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, location: true },
    });
  }
}

/** A starting profile from the account: "Ada Okafor" in "Lagos, Nigeria". */
function seedFrom(user: { name: string; location: string | null }): ProfileSeed {
  const [firstName = '', ...rest] = user.name.trim().split(/\s+/);
  const parts = (user.location ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const country = parts.at(-1) ?? '';
  return {
    firstName,
    lastName: rest.join(' '),
    phone: '',
    city: parts.length > 1 ? parts[0] : '',
    country,
    workCountries: country ? [country] : [],
  };
}

function gaps(
  p: Pick<ProfileRow, 'firstName' | 'lastName' | 'phone' | 'consentAt'> & { cv: unknown },
): ApplicantGap[] {
  const missing: ApplicantGap[] = [];
  if (!p.firstName.trim()) missing.push('firstName');
  if (!p.lastName.trim()) missing.push('lastName');
  if (!p.phone.trim()) missing.push('phone');
  if (!p.cv) missing.push('cv');
  if (!p.consentAt) missing.push('consent');
  return missing;
}

function savedAnswers(json: Prisma.JsonValue): SavedAnswers {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  return Object.fromEntries(
    Object.entries(json).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
}

/** Keys answers by questionKey and drops blank ones. */
function normaliseAnswers(answers: Record<string, string>): SavedAnswers {
  return Object.fromEntries(
    Object.entries(answers)
      .map(([label, answer]) => [questionKey(label), answer.trim()] as const)
      .filter(([key, answer]) => key && answer),
  );
}
