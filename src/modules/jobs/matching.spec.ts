import { matchJob } from './matching';

describe('matchJob', () => {
  it('returns null when the user has no skills', () => {
    expect(matchJob([], { title: 'Engineer' })).toBeNull();
    expect(matchJob(['  ', ''], { title: 'Engineer' })).toBeNull();
  });

  it('scores the share of skills mentioned in the title or description', () => {
    const result = matchJob(['TypeScript', 'Vue', 'Go', 'AWS'], {
      title: 'Frontend Engineer (Vue)',
      description: 'You will write TypeScript every day.',
    });
    expect(result).toEqual({ score: 50, matched: ['TypeScript', 'Vue'], missing: ['Go', 'AWS'] });
  });

  it('is case-insensitive and ignores duplicate skills', () => {
    const result = matchJob(['react', 'React', ' react '], { title: 'REACT developer' });
    expect(result).toEqual({ score: 100, matched: ['react', 'React'], missing: [] });
  });

  it('respects word boundaries', () => {
    expect(matchJob(['Go'], { title: 'Google Ads specialist' })?.score).toBe(0);
    expect(matchJob(['Java'], { title: 'JavaScript engineer' })?.score).toBe(0);
    expect(
      matchJob(['Go'], { title: 'Backend engineer', description: 'We use Go and Postgres.' })
        ?.score,
    ).toBe(100);
  });

  it('handles skills with symbols', () => {
    const job = { title: 'Engineer', description: 'Experience with C++, C# and Node.js required.' };
    expect(matchJob(['C++', 'C#', 'Node.js', 'C'], job)?.matched).toEqual(['C++', 'C#', 'Node.js']);
  });

  it('does not treat "C" inside "C++" as a match', () => {
    expect(matchJob(['C'], { title: 'C++ developer' })?.score).toBe(0);
  });
});
