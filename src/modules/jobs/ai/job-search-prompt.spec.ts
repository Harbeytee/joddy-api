import {
  AI_SEARCH_SCHEMA,
  isEmptySearch,
  searchInstructions,
  toAiJobSearch,
} from './job-search-prompt';

describe('toAiJobSearch', () => {
  it('keeps a well-formed answer', () => {
    expect(
      toAiJobSearch({
        title: ['frontend', 'front-end', 'react developer'],
        company: null,
        country: ['gb'],
        region: ['EUROPE'],
        workplaceType: ['REMOTE'],
        jobType: [],
        seniority: ['SENIOR'],
        postedWithinDays: 7,
        salaryMin: 80000,
        salaryMax: null,
        hasSalary: false,
        summary: 'Remote senior frontend roles in Europe paying £80K+',
      }),
    ).toEqual({
      summary: 'Remote senior frontend roles in Europe paying £80K+',
      q: null,
      title: ['frontend', 'front-end', 'react developer'],
      country: ['GB'],
      region: ['EUROPE'],
      workplaceType: ['REMOTE'],
      jobType: [],
      seniority: ['SENIOR'],
      postedWithinDays: 7,
      hasSalary: false,
      salaryMin: 80000,
      salaryMax: null,
    });
  });

  it('drops values the search does not accept', () => {
    const s = toAiJobSearch({
      title: ['  Data   Engineer ', 'data engineer', 'x', 42, 'a, b'],
      country: ['XX', 'NG', 'NG', 7],
      region: ['MARS', 'AFRICA'],
      workplaceType: ['remote', 'HYBRID'],
      jobType: ['GIG'],
      seniority: ['NINJA', 'LEAD'],
      hasSalary: 'yes',
    });
    expect(s.title).toEqual(['data engineer', 'a b']);
    expect(s.country).toEqual(['NG']);
    expect(s.region).toEqual(['AFRICA']);
    expect(s.workplaceType).toEqual(['HYBRID']);
    expect(s.jobType).toEqual([]);
    expect(s.seniority).toEqual(['LEAD']);
    expect(s.hasSalary).toBe(false);
  });

  it('caps the number of title phrases', () => {
    const s = toAiJobSearch({ title: Array.from({ length: 20 }, (_, i) => `role ${i}`) });
    expect(s.title).toHaveLength(10);
  });

  it('snaps the date window to the ones the job board offers', () => {
    expect(toAiJobSearch({ postedWithinDays: 2 }).postedWithinDays).toBe(3);
    expect(toAiJobSearch({ postedWithinDays: 14 }).postedWithinDays).toBe(30);
    expect(toAiJobSearch({ postedWithinDays: 90 }).postedWithinDays).toBeNull();
    expect(toAiJobSearch({ postedWithinDays: 0 }).postedWithinDays).toBeNull();
  });

  it('cleans up salaries', () => {
    expect(toAiJobSearch({ salaryMin: 120000.4, salaryMax: 90000 })).toMatchObject({
      salaryMin: 90000,
      salaryMax: 120000,
    });
    expect(toAiJobSearch({ salaryMin: -5, salaryMax: 'lots' })).toMatchObject({
      salaryMin: null,
      salaryMax: null,
    });
  });

  it('uses a named company as search keywords', () => {
    expect(toAiJobSearch({ company: ' Stripe ' }).q).toBe('Stripe');
  });

  it('survives a reply that is not an object', () => {
    expect(isEmptySearch(toAiJobSearch('nope'))).toBe(true);
    expect(isEmptySearch(toAiJobSearch(null))).toBe(true);
  });
});

describe('isEmptySearch', () => {
  it('is false as soon as any filter is set', () => {
    expect(isEmptySearch(toAiJobSearch({ workplaceType: ['REMOTE'] }))).toBe(false);
    expect(isEmptySearch(toAiJobSearch({ salaryMin: 50000 }))).toBe(false);
    expect(isEmptySearch(toAiJobSearch({ summary: 'Something' }))).toBe(true);
  });
});

describe('the prompt sent to Gemini', () => {
  it('asks for every field it validates', () => {
    expect([...AI_SEARCH_SCHEMA.required].sort()).toEqual(
      Object.keys(AI_SEARCH_SCHEMA.properties).sort(),
    );
  });

  it('tells the model the date and where the user is', () => {
    const text = searchInstructions({ today: '2026-10-18', homeCountry: 'NG' });
    expect(text).toContain('Today is 2026-10-18');
    expect(text).toContain("The user's country is NG");
    expect(searchInstructions({ today: '2026-10-18' })).toContain('is unknown');
  });
});
