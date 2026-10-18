import { greenhouseFormUrl } from './greenhouse';
import { SITE_FORMS } from './index';
import { leverFormUrl } from './lever';
import { choiceIndex, pickSuggestion, searchText } from './page';
import { AUTO_APPLY_SOURCES } from './sites';
import type { FormField } from './types';

describe('auto-apply sites', () => {
  it('has a form filler for every source it claims to support', () => {
    expect(Object.keys(SITE_FORMS).sort()).toEqual([...AUTO_APPLY_SOURCES].sort());
  });
});

describe('greenhouseFormUrl', () => {
  it.each([
    [
      'https://job-boards.greenhouse.io/acme/jobs/123',
      'https://job-boards.greenhouse.io/acme/jobs/123',
    ],
    [
      'https://boards.greenhouse.io/acme/jobs/123?gh_jid=123',
      'https://job-boards.greenhouse.io/acme/jobs/123',
    ],
    [
      'https://job-boards.eu.greenhouse.io/acme/jobs/123',
      'https://job-boards.eu.greenhouse.io/acme/jobs/123',
    ],
    [
      'https://www.acme.com/careers/?gh_jid=123',
      'https://job-boards.greenhouse.io/embed/job_app?for=acme&token=123',
    ],
  ])('%s → %s', (url, expected) => {
    expect(greenhouseFormUrl({ externalId: 'greenhouse:acme:123', url })).toBe(expected);
  });

  it('refuses ids it cannot parse', () => {
    expect(greenhouseFormUrl({ externalId: 'greenhouse:acme', url: 'https://x.y' })).toBeNull();
  });
});

describe('leverFormUrl', () => {
  it('points at the apply page on the right region', () => {
    expect(
      leverFormUrl({
        applyUrl: 'https://jobs.eu.lever.co/xm/9d56a38a/apply',
        url: 'https://jobs.eu.lever.co/xm/9d56a38a',
      }),
    ).toBe('https://jobs.eu.lever.co/xm/9d56a38a/apply');
    expect(leverFormUrl({ applyUrl: '', url: 'https://jobs.lever.co/acme/abc' })).toBe(
      'https://jobs.lever.co/acme/abc/apply',
    );
    expect(leverFormUrl({ applyUrl: 'https://acme.com/jobs/1', url: '' })).toBeNull();
  });
});

describe('location autocompletes', () => {
  const suggestions = [
    'London, ON, CAN',
    'London, Greater London, England, GBR',
    'Londonderry, NH, USA',
  ];

  it('types the city and picks it in the applicant’s country', () => {
    expect(searchText('London, United Kingdom')).toBe('London');
    expect(pickSuggestion(suggestions, 'London, United Kingdom')).toBe(1);
  });

  it('never settles for a same-named city elsewhere', () => {
    expect(pickSuggestion(suggestions, 'London, Nigeria')).toBe(-1);
  });
});

describe('choiceIndex', () => {
  const field = (kind: FormField['kind'], options: string[]): FormField => ({
    ref: '',
    label: '',
    kind,
    required: true,
    options,
  });

  it('ticks the chosen radio, or the agreeing checkbox', () => {
    expect(choiceIndex(field('radio', ['Yes', 'No']), 'No')).toBe(1);
    expect(choiceIndex(field('checkbox', ['Yes']), 'true')).toBe(0);
    expect(choiceIndex(field('checkbox', ['No thanks', 'I agree']), 'true')).toBe(1);
    expect(choiceIndex(field('checkbox', ['Email', 'Phone']), 'true')).toBe(-1);
  });
});
