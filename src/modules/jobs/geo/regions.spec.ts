import { Region } from '../../../generated/prisma/enums';
import { COUNTRY_CODES } from './countries';
import { leafRegions, locationMatch } from './regions';

describe('leafRegions', () => {
  it('places every known country', () => {
    const unplaced = [...COUNTRY_CODES].filter((c) => !leafRegions(c).length);
    expect(unplaced).toEqual([]);
  });

  it('puts transcontinental countries in both regions', () => {
    expect(leafRegions('TR')).toEqual([Region.EUROPE, Region.MIDDLE_EAST]);
    expect(leafRegions('EG')).toEqual([Region.MIDDLE_EAST, Region.AFRICA]);
  });
});

describe('locationMatch', () => {
  it('matches a country plus remote jobs open to any region containing it', () => {
    expect(locationMatch(['NG'], [])).toEqual({
      countries: ['NG'],
      regions: [Region.WORLDWIDE, Region.EMEA, Region.AFRICA],
    });
  });

  it('matches a region by its countries and by overlapping regions, but not siblings', () => {
    const { countries, regions } = locationMatch([], [Region.EUROPE]);
    expect(countries).toEqual(expect.arrayContaining(['DE', 'GB', 'FR']));
    expect(countries).not.toContain('NG');
    expect(regions).toEqual([Region.WORLDWIDE, Region.EMEA, Region.EUROPE]);
  });

  it('includes sub-regions of a wide region', () => {
    const { countries, regions } = locationMatch([], [Region.AMERICAS]);
    expect(countries).toEqual(expect.arrayContaining(['US', 'BR', 'MX']));
    expect(regions).toEqual([
      Region.WORLDWIDE,
      Region.AMERICAS,
      Region.NORTH_AMERICA,
      Region.LATAM,
    ]);
  });

  it('treats WORLDWIDE as "open to anyone", not "everywhere"', () => {
    expect(locationMatch([], [Region.WORLDWIDE])).toEqual({
      countries: [],
      regions: [Region.WORLDWIDE],
    });
  });

  it('combines several picks', () => {
    const { countries, regions } = locationMatch(['US', 'GB'], []);
    expect(countries).toEqual(['GB', 'US']);
    expect(regions).toEqual([
      Region.WORLDWIDE,
      Region.AMERICAS,
      Region.NORTH_AMERICA,
      Region.EMEA,
      Region.EUROPE,
    ]);
  });
});
