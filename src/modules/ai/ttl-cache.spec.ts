import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('returns values until they expire', () => {
    const cache = new TtlCache<string>(1000, 10);
    cache.set('a', 'one', 0);
    expect(cache.get('a', 999)).toBe('one');
    expect(cache.get('a', 1000)).toBeUndefined();
    expect(cache.get('missing', 0)).toBeUndefined();
  });

  it('drops the oldest entry once full, counting a re-set entry as new', () => {
    const cache = new TtlCache<number>(60_000, 2);
    cache.set('a', 1, 0);
    cache.set('b', 2, 0);
    cache.set('a', 3, 0);
    cache.set('c', 4, 0);
    expect(cache.get('b', 0)).toBeUndefined();
    expect(cache.get('a', 0)).toBe(3);
    expect(cache.get('c', 0)).toBe(4);
  });
});
