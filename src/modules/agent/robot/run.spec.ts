import type { Page } from 'playwright';
import type { Applicant } from './answers';
import { fillApplication } from './run';
import { HANDOFF } from './sites';
import type { FormField, RobotInput, SiteForm, SubmitOutcome } from './types';

const applicant: Applicant = {
  firstName: 'Ada',
  lastName: 'Okafor',
  email: 'ada@example.com',
  phone: '+44 7700 900123',
  city: 'London',
  country: 'United Kingdom',
  linkedinUrl: null,
  websiteUrl: null,
  workCountries: ['United Kingdom'],
  noticePeriod: null,
  salaryExpectation: null,
  saved: {},
};

const field = (label: string, extra: Partial<FormField> = {}): FormField => ({
  ref: label,
  label,
  kind: 'text',
  required: true,
  options: [],
  ...extra,
});

const cvField = field('Resume/CV', { kind: 'file', isCv: true });

/** A form held in memory that records what the robot did to it. */
function fakeSite(fields: FormField[], outcome: SubmitOutcome = { submitted: true }) {
  const filled = new Map<string, string>();
  const calls = { cv: 0, submit: 0 };
  const site: SiteForm = {
    open: () => Promise.resolve(null),
    fields: () => Promise.resolve(fields),
    attachCv: () => {
      calls.cv++;
      return Promise.resolve(true);
    },
    fill: (_page, f, answer) => {
      filled.set(f.label, answer);
      return Promise.resolve(true);
    },
    submit: () => {
      calls.submit++;
      return Promise.resolve(outcome);
    },
  };
  return { site, filled, calls };
}

const page = {} as Page;
const input = (submit: boolean): RobotInput => ({
  job: { source: 'greenhouse', externalId: '', companySlug: '', url: '', applyUrl: '' },
  applicant,
  cv: { fileName: 'cv.pdf', mimeType: 'application/pdf', data: Buffer.from('') },
  submit,
});

describe('fillApplication', () => {
  it('fills every answerable field, attaches the CV and submits', async () => {
    const { site, filled, calls } = fakeSite([
      cvField,
      field('First Name'),
      field('Email'),
      field('Website', { required: false }),
    ]);
    await expect(fillApplication(page, site, input(true))).resolves.toEqual({
      outcome: 'submitted',
    });
    expect(Object.fromEntries(filled)).toEqual({ 'First Name': 'Ada', Email: 'ada@example.com' });
    expect(calls).toEqual({ cv: 1, submit: 1 });
  });

  it('stops before typing anything when a required question has no certain answer', async () => {
    const { site, filled, calls } = fakeSite([
      cvField,
      field('First Name'),
      field('Why do you want to work here?', { kind: 'textarea' }),
    ]);
    const result = await fillApplication(page, site, input(true));
    expect(result).toEqual({
      outcome: 'handoff',
      reason: HANDOFF.missingAnswers,
      missing: [
        { label: 'Why do you want to work here?', kind: 'textarea', required: true, options: [] },
      ],
    });
    expect(filled.size).toBe(0);
    expect(calls.submit).toBe(0);
  });

  it('never submits in a dry run', async () => {
    const { site, calls } = fakeSite([cvField, field('First Name')]);
    await expect(fillApplication(page, site, input(false))).resolves.toMatchObject({
      outcome: 'handoff',
      reason: HANDOFF.dryRun,
    });
    expect(calls.submit).toBe(0);
  });

  it('hands back CAPTCHAs instead of solving them', async () => {
    const { site } = fakeSite([cvField, field('First Name')], {
      submitted: false,
      reason: HANDOFF.captcha,
    });
    await expect(fillApplication(page, site, input(true))).resolves.toMatchObject({
      outcome: 'handoff',
      reason: HANDOFF.captcha,
    });
  });

  it('hands back forms without a CV upload', async () => {
    const { site } = fakeSite([field('First Name')]);
    await expect(fillApplication(page, site, input(true))).resolves.toMatchObject({
      reason: HANDOFF.formRejected,
    });
  });
});
