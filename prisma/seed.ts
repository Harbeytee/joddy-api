import 'dotenv/config';
import * as argon2 from 'argon2';
import { PrismaClient } from '../src/generated/prisma/client';
import { prismaAdapter } from '../src/prisma/adapter';

const DEMO_EMAIL = 'demo@joddy.app';
const DEMO_PASSWORD = 'joddy-demo-2026';

async function main() {
  const prisma = new PrismaClient({
    adapter: prismaAdapter(process.env.DATABASE_URL),
  });

  try {
    await prisma.user.deleteMany({ where: { email: DEMO_EMAIL } });

    const skills = [
      'TypeScript',
      'Vue',
      'Nuxt',
      'React',
      'Node.js',
      'PostgreSQL',
      'GraphQL',
      'AWS',
    ];
    const user = await prisma.user.create({
      data: {
        email: DEMO_EMAIL,
        name: 'Ada Okafor',
        headline: 'Frontend Engineer',
        location: 'London, UK',
        passwordHash: await argon2.hash(DEMO_PASSWORD),
        skills,
      },
    });

    const resume = await prisma.resume.create({
      data: {
        userId: user.id,
        title: 'Frontend Engineer',
        isDefault: true,
        content: {
          personal: {
            fullName: 'Ada Okafor',
            headline: 'Frontend Engineer',
            email: DEMO_EMAIL,
            phone: '+44 7700 900123',
            location: 'London, UK',
            linkedin: 'linkedin.com/in/adaokafor',
          },
          summary:
            'Frontend engineer with 4 years of experience building fast, accessible products in fintech. I care about design systems, performance and shipping small, reviewable changes.',
          experience: [
            {
              position: 'Frontend Engineer',
              company: 'Monzo',
              location: 'London',
              startDate: '2023-02',
              current: true,
              description:
                '- Led the migration of the savings dashboard to Vue 3 and TypeScript\n- Cut page load time by 38% with route-level code splitting\n- Built the shared component library used by 6 product teams',
            },
            {
              position: 'Software Engineer',
              company: 'Paystack',
              location: 'Lagos',
              startDate: '2021-01',
              endDate: '2023-01',
              description:
                '- Shipped the merchant onboarding flow in React and Node.js\n- Introduced end-to-end tests that caught 40+ regressions before release',
            },
          ],
          education: [
            {
              degree: 'BSc Computer Science',
              school: 'University of Lagos',
              startDate: '2016',
              endDate: '2020',
            },
          ],
          skills,
        },
      },
    });

    await prisma.agentSettings.create({
      data: {
        userId: user.id,
        enabled: true,
        mode: 'REVIEW',
        dailyLimit: 10,
        minMatchScore: 25,
        keywords: ['frontend', 'front-end', 'full stack', 'software engineer'],
        excludedKeywords: ['principal', 'director', 'manager'],
        locations: ['London', 'Remote'],
        resumeId: resume.id,
      },
    });

    const day = 86_400_000;
    const apps = [
      {
        role: 'Frontend Engineer',
        company: 'Monzo',
        status: 'INTERVIEW',
        daysAgo: 3,
        source: 'Company site',
      },
      {
        role: 'Software Engineer, Web',
        company: 'Wise',
        status: 'APPLIED',
        daysAgo: 5,
        source: 'LinkedIn',
      },
      {
        role: 'Frontend Developer',
        company: 'Deliveroo',
        status: 'REJECTED',
        daysAgo: 12,
        source: 'Greenhouse',
      },
      {
        role: 'Product Engineer',
        company: 'Linear',
        status: 'APPLIED',
        daysAgo: 16,
        source: 'Ashby',
      },
      {
        role: 'Senior Frontend Engineer',
        company: 'Revolut',
        status: 'GHOSTED',
        daysAgo: 30,
        source: 'LinkedIn',
      },
      {
        role: 'Full Stack Engineer',
        company: 'Pleo',
        status: 'OFFER',
        daysAgo: 24,
        source: 'Referral',
      },
      {
        role: 'UI Engineer',
        company: 'GoCardless',
        status: 'APPLIED',
        daysAgo: 1,
        source: 'Lever',
      },
    ] as const;
    await prisma.application.createMany({
      data: apps.map((a) => ({
        userId: user.id,
        role: a.role,
        company: a.company,
        status: a.status,
        source: a.source,
        jobType: 'FULL_TIME' as const,
        location: 'London, UK',
        resumeId: resume.id,
        appliedAt: new Date(Date.now() - a.daysAgo * day),
      })),
    });

    console.log(`Seeded demo user ${DEMO_EMAIL} / ${DEMO_PASSWORD}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
