import { locationScope, looksRemote } from './location-scope';

const scope = (...locations: string[]) => locationScope(locations);

describe('locationScope', () => {
  it.each([
    ['Remote - USA', ['US']],
    ['Remote - United States', ['US']],
    ['US Remote', ['US']],
    ['Remote (US)', ['US']],
    ['Remote, , India', ['IN']],
    ['United Kingdom - London', ['GB']],
    ['London, England, United Kingdom', ['GB']],
    ['Warsaw, Masovian Voivodeship, Poland', ['PL']],
    ['Seoul, Korea', ['KR']],
    ['Bogotá, Bogota, Colombia', ['CO']],
    ['Remote Estonia ', ['EE']],
    ['South Africa - Cape Town', ['ZA']],
    ['Americas (USA or Canada)', ['CA', 'US']],
    ['Anywhere in the United States', ['US']],
  ])('%s → %j', (location, countries) => {
    expect(scope(location).countries).toEqual(countries);
  });

  it('infers the country from states, provinces and well-known cities', () => {
    expect(scope('Chicago, IL').countries).toEqual(['US']);
    expect(scope('Newark, New Jersey').countries).toEqual(['US']);
    expect(scope('Toronto, ON').countries).toEqual(['CA']);
    expect(scope('San Francisco').countries).toEqual(['US']);
    expect(scope('London').countries).toEqual(['GB']);
  });

  it('prefers a named country over state-like codes', () => {
    expect(scope('Madrid, MD, Spain').countries).toEqual(['ES']);
    expect(scope('Albuquerque, New Mexico').countries).toEqual(['US']);
  });

  it.each([
    ['World Wide - Remote', ['WORLDWIDE']],
    ['Remote, Global', ['WORLDWIDE']],
    ['Remote (world)', ['WORLDWIDE']],
    ['Remote - EMEA', ['EMEA']],
    ['Remote - European Union', ['EUROPE']],
    ['Remote EU', ['EUROPE']],
    ['LatAm', ['LATAM']],
    ['Remote - APAC', ['APAC']],
    ['North America Remote / San Francisco, CA', ['NORTH_AMERICA']],
    ['Remote | North America or Europe', ['EUROPE', 'NORTH_AMERICA']],
    ['Americas Remote', ['AMERICAS']],
    ['Remote, AMER', ['AMERICAS']],
    ['Remote-NAMER', ['NORTH_AMERICA']],
  ])('%s → regions %j', (location, regions) => {
    expect(scope(location).regions).toEqual(regions);
  });

  it('does not read a country as its region', () => {
    expect(scope('South Africa')).toEqual({ countries: ['ZA'], regions: [] });
    expect(scope('Latin America')).toEqual({ countries: [], regions: ['LATAM'] });
  });

  it('is not worldwide when "anywhere" is limited to a country', () => {
    expect(scope('Anywhere in the United States').regions).toEqual([]);
  });

  it('ignores lower-case words that look like country codes', () => {
    expect(scope('Join us, remote').countries).toEqual([]);
  });

  it('merges every location and ignores blanks', () => {
    expect(locationScope(['Remote', 'Berlin, Germany', null, '', 'Paris, France'])).toEqual({
      countries: ['DE', 'FR'],
      regions: [],
    });
  });
});

describe('looksRemote', () => {
  it('spots remote locations', () => {
    expect(looksRemote(['Remote - US'])).toBe(true);
    expect(looksRemote([null, 'Work from home'])).toBe(true);
    expect(looksRemote(['Berlin, Germany'])).toBe(false);
  });
});
