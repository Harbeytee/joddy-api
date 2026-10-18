/**
 * Runs the auto-apply robot against real job forms with a sample applicant. It
 * never submits: it fills each form, saves a screenshot and prints what it
 * would hand back to the user.
 *
 *   npm run robot:dry-run -- --source greenhouse --count 3
 *   npm run robot:dry-run -- --job <job uuid>[,<job uuid>...] [--out /tmp/joddy-robot]
 */
import 'dotenv/config';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { PrismaClient } from '../src/generated/prisma/client';
import { prismaAdapter } from '../src/prisma/adapter';
import { questionKey, type Applicant } from '../src/modules/agent/robot/answers';
import { SITE_FORMS } from '../src/modules/agent/robot/index';
import { fillApplication } from '../src/modules/agent/robot/run';

const { values } = parseArgs({
  options: {
    source: { type: 'string', default: 'greenhouse' },
    count: { type: 'string', default: '3' },
    job: { type: 'string' },
    out: { type: 'string', default: '/tmp/joddy-robot' },
    /** JSON file of { "question text": "answer" }, used as the applicant's saved answers. */
    answers: { type: 'string' },
  },
});

const sample: Applicant = {
  firstName: 'Test',
  lastName: 'Applicant',
  email: 'test.applicant@example.com',
  phone: '+44 7700 900123',
  city: 'London',
  country: 'United Kingdom',
  linkedinUrl: 'https://www.linkedin.com/in/test-applicant',
  websiteUrl: null,
  workCountries: ['United Kingdom'],
  noticePeriod: '1 month',
  salaryExpectation: null,
  saved: {},
};

/** A one-page PDF that says "Test Applicant". */
function samplePdf(): Buffer {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length 44 >>\nstream\nBT /F1 24 Tf 72 700 Td (Test Applicant) Tj ET\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function main() {
  if (values.answers) {
    const given = JSON.parse(await readFile(values.answers, 'utf8')) as Record<string, string>;
    sample.saved = Object.fromEntries(
      Object.entries(given).map(([label, answer]) => [questionKey(label), answer]),
    );
  }
  const prisma = new PrismaClient({
    adapter: prismaAdapter(process.env.DATABASE_URL),
  });
  const select = {
    id: true,
    title: true,
    companyName: true,
    source: true,
    externalId: true,
    companySlug: true,
    url: true,
    applyUrl: true,
  };
  const jobs = values.job
    ? await prisma.job.findMany({ where: { id: { in: values.job.split(',') } }, select })
    : await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM jobs WHERE source = ${values.source} AND "isActive" ORDER BY random() LIMIT ${Number(values.count)}`.then(
        (rows) => prisma.job.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select }),
      );

  await mkdir(values.out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const cv = { fileName: 'test-applicant-cv.pdf', mimeType: 'application/pdf', data: samplePdf() };

  for (const job of jobs) {
    const site = SITE_FORMS[job.source];
    console.log(`\n${job.source} · ${job.companyName} · ${job.title}\n  ${job.url}`);
    if (!site) {
      console.log('  → no robot for this source');
      continue;
    }
    const context = await browser.newContext({
      locale: 'en-GB',
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(15_000);
    const page = await context.newPage();
    const started = Date.now();
    try {
      const result = await fillApplication(page, site, {
        job,
        applicant: sample,
        cv,
        submit: false,
      });
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (result.outcome === 'handoff') {
        console.log(
          `  → ${result.reason} in ${seconds}s${result.detail ? ` (${result.detail})` : ''}`,
        );
        for (const q of result.missing) {
          console.log(
            `     ? [${q.kind}] ${q.label}${q.options.length ? `  {${q.options.slice(0, 6).join(' | ')}}` : ''}`,
          );
        }
      } else {
        console.log('  → submitted (should never happen in a dry run)');
      }
    } catch (err) {
      console.log(`  → error: ${String(err)}`);
    } finally {
      const shot = join(values.out, `${job.source}-${job.id}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
      console.log(`  screenshot: ${shot}`);
      await context.close();
    }
  }
  await browser.close();
  await prisma.$disconnect();
}

void main();
