import { durationToMs } from './duration';

describe('durationToMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
    [' 5 m ', 300_000],
  ])('parses %p', (input, expected) => {
    expect(durationToMs(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '1.5h', '10w', '-5m'])('rejects %p', (input) => {
    expect(() => durationToMs(input)).toThrow(/Invalid duration/);
  });
});
