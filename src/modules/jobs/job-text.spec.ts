import { descriptionSnippet, jobTypeFromText, seniorityFromTitle } from './job-text';

describe('jobTypeFromText', () => {
  it.each([
    ['Full-time', 'FULL_TIME'],
    ['fulltime permanent', 'FULL_TIME'],
    ['FULL_TIME', 'FULL_TIME'],
    ['Part-Time', 'PART_TIME'],
    ['parttime fixed term', 'PART_TIME'],
    ['contract', 'CONTRACT'],
    ['Freelance', 'CONTRACT'],
    ['Intern', 'INTERNSHIP'],
    ['Seasonal', 'TEMPORARY'],
    ['Other', null],
    [null, null],
  ])('%p → %p', (raw, expected) => {
    expect(jobTypeFromText(raw)).toBe(expected);
  });
});

describe('seniorityFromTitle', () => {
  it.each([
    ['Software Engineering Intern', 'INTERN'],
    ['Summer Internship 2027', 'INTERN'],
    ['Graduate Software Engineer', 'GRADUATE'],
    ['New Grad Data Scientist', 'GRADUATE'],
    ['Junior Frontend Developer', 'ENTRY'],
    ['Entry-Level Analyst', 'ENTRY'],
    ['Associate Product Manager', 'ENTRY'],
    ['Mid-level Backend Engineer', 'MID'],
    ['Software Engineer II', 'MID'],
    ['Senior Product Designer', 'SENIOR'],
    ['Sr. Data Analyst', 'SENIOR'],
    ['Software Engineer III', 'SENIOR'],
    ['Senior Associate, Audit', 'SENIOR'],
    ['Lead Product Designer', 'LEAD'],
    ['Staff Software Engineer', 'STAFF'],
    ['Principal Engineer, Payments', 'PRINCIPAL'],
    ['Senior Director, Marketing', 'DIRECTOR'],
    ['Associate Director of Finance', 'DIRECTOR'],
    ['Head of Design', 'DIRECTOR'],
    ['VP, Product Management', 'EXECUTIVE'],
    ['Chief Technology Officer', 'EXECUTIVE'],
  ])('%s → %s', (title, level) => {
    expect(seniorityFromTitle(title)).toBe(level);
  });

  it('returns null when the title does not say', () => {
    expect(seniorityFromTitle('Product Designer')).toBeNull();
    expect(seniorityFromTitle('Staff Accountant')).toBeNull();
    expect(seniorityFromTitle('Leadership Development Coach')).toBeNull();
    expect(seniorityFromTitle('Postgraduate Researcher')).toBeNull();
  });

  it('only reads upper-case roman numerals after a word as levels', () => {
    expect(seniorityFromTitle('Data Engineer IV, Platform')).toBe('SENIOR');
    expect(seniorityFromTitle('IV Infusion Nurse')).toBeNull();
    expect(seniorityFromTitle('Infusion Nurse (iv)')).toBeNull();
  });
});

describe('descriptionSnippet', () => {
  it('skips short heading lines and uses the first real paragraph', () => {
    const text =
      'About us\n\nWe are building the essential digital health partner of tomorrow for millions of people.\n\nMore';
    expect(descriptionSnippet(text)).toBe(
      'We are building the essential digital health partner of tomorrow for millions of people.',
    );
  });

  it('truncates long text at a word boundary with an ellipsis', () => {
    const snippet = descriptionSnippet('word '.repeat(100));
    expect(snippet.endsWith('word…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(221);
  });

  it('ignores image and link URLs left in ATS plain text', () => {
    const text =
      '[https://app.ashbyhq.com/api/images/user-content/a/b/COVER_1.png]\n\nABOUT US:\n\n' +
      'Read [our story](https://acme.com/story) about how we help millions of people every day [https://acme.com].';
    expect(descriptionSnippet(text)).toBe(
      'Read our story about how we help millions of people every day.',
    );
  });

  it('handles empty descriptions', () => {
    expect(descriptionSnippet('')).toBe('');
    expect(descriptionSnippet(null)).toBe('');
  });
});
