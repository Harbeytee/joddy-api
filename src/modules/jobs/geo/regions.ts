import { Region } from '../../../generated/prisma/enums';

/** Widest first; also the order the filter UI lists them in. */
export const REGION_ORDER: Region[] = [
  Region.WORLDWIDE,
  Region.AMERICAS,
  Region.NORTH_AMERICA,
  Region.LATAM,
  Region.EMEA,
  Region.EUROPE,
  Region.MIDDLE_EAST,
  Region.AFRICA,
  Region.APAC,
];

const PARENT: Partial<Record<Region, Region>> = {
  [Region.AMERICAS]: Region.WORLDWIDE,
  [Region.EMEA]: Region.WORLDWIDE,
  [Region.APAC]: Region.WORLDWIDE,
  [Region.NORTH_AMERICA]: Region.AMERICAS,
  [Region.LATAM]: Region.AMERICAS,
  [Region.EUROPE]: Region.EMEA,
  [Region.MIDDLE_EAST]: Region.EMEA,
  [Region.AFRICA]: Region.EMEA,
};

/** Countries of each smallest region. A few (TR, EG) sit in two, as job posts use both. */
const LEAF_COUNTRIES: Partial<Record<Region, string>> = {
  [Region.NORTH_AMERICA]: 'US CA BM GL',
  [Region.LATAM]:
    'AG AI AR AW BB BO BR BS BZ CL CO CR CU CW DM DO EC GD GP GT GY HN HT JM KN KY LC MQ MX NI PA PE PR PY SR SV TT UY VE VG VI',
  [Region.EUROPE]:
    'AD AL AM AT AX AZ BA BE BG BY CH CY CZ DE DK EE ES FI FO FR GB GE GG GI GR HR HU IE IM IS IT JE LI LT LU LV MC MD ME MK MT NL NO PL PT RO RS RU SE SI SK SM TR UA XK',
  [Region.MIDDLE_EAST]: 'AE BH EG IL IQ IR JO KW LB OM PS QA SA SY TR YE',
  [Region.AFRICA]:
    'AO BF BI BJ BW CD CF CG CI CM CV DJ DZ EG ER ET GA GH GM GN GQ GW KE KM LR LS LY MA MG ML MR MU MW MZ NA NE NG RE RW SC SD SL SN SO SS SZ TD TG TN TZ UG ZA ZM ZW',
  [Region.APAC]:
    'AF AS AU BD BN BT CN FJ GU HK ID IN JP KG KH KI KP KR KZ LA LK MH MM MN MO MV MY NC NP NZ PF PG PH PK SB SG TH TJ TL TM TO TW UZ VN VU WS',
};

const LEAVES_BY_COUNTRY = new Map<string, Region[]>();
for (const [region, codes] of Object.entries(LEAF_COUNTRIES) as [Region, string][]) {
  for (const code of codes.split(' ')) {
    LEAVES_BY_COUNTRY.set(code, [...(LEAVES_BY_COUNTRY.get(code) ?? []), region]);
  }
}

/** The region itself and every region containing it, up to WORLDWIDE. */
function withAncestors(region: Region): Region[] {
  const chain = [region];
  for (let r = PARENT[region]; r; r = PARENT[r]) chain.push(r);
  return chain;
}

/** The region itself and every region inside it. */
function withDescendants(region: Region): Region[] {
  return REGION_ORDER.filter((r) => withAncestors(r).includes(region));
}

/** Smallest regions a country belongs to; empty for codes we don't place. */
export function leafRegions(country: string): Region[] {
  return LEAVES_BY_COUNTRY.get(country) ?? [];
}

/**
 * What a job's `countries`/`regions` must overlap for it to be relevant to someone
 * picking these places in the location filter:
 * - a country matches jobs in that country, or open to a region that contains it ("Remote, EMEA" for DE);
 * - a region matches jobs in its countries, or open to it, a region inside it, or a region containing it;
 * - WORLDWIDE only matches jobs open to anyone, not every job on earth.
 */
export function locationMatch(
  countries: readonly string[],
  regions: readonly Region[],
): { countries: string[]; regions: Region[] } {
  const matchCountries = new Set(countries);
  const matchRegions = new Set<Region>();

  for (const country of countries) {
    matchRegions.add(Region.WORLDWIDE);
    for (const leaf of leafRegions(country))
      withAncestors(leaf).forEach((r) => matchRegions.add(r));
  }
  for (const region of regions) {
    matchRegions.add(Region.WORLDWIDE);
    if (region === Region.WORLDWIDE) continue;
    const inside = withDescendants(region);
    [...inside, ...withAncestors(region)].forEach((r) => matchRegions.add(r));
    for (const [country, leaves] of LEAVES_BY_COUNTRY) {
      if (leaves.some((l) => inside.includes(l))) matchCountries.add(country);
    }
  }
  return {
    countries: [...matchCountries].sort(),
    regions: REGION_ORDER.filter((r) => matchRegions.has(r)),
  };
}
