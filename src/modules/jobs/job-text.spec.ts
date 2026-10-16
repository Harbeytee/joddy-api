import { descriptionSnippet, seniorityFromTitle } from './job-text';

describe('seniorityFromTitle', () => {
  it.each([
    ['Software Engineering Intern', 'INTERN'],
    ['Junior Frontend Developer', 'JUNIOR'],
    ['Associate Product Manager', 'JUNIOR'],
    ['Mid-level Backend Engineer', 'MID'],
    ['Senior Product Designer', 'SENIOR'],
    ['Sr. Data Analyst', 'SENIOR'],
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

  it('handles empty descriptions', () => {
    expect(descriptionSnippet('')).toBe('');
    expect(descriptionSnippet(null)).toBe('');
  });
});
