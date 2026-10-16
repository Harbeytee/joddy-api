import { Region } from '../../../generated/prisma/enums';
import { COUNTRIES, COUNTRY_ABBREVIATIONS, IMPLIED_COUNTRY, SUBDIVISION_CODES } from './countries';

const REGION_NAMES: Record<Region, string[]> = {
  [Region.WORLDWIDE]: [
    'worldwide',
    'world wide',
    'world-wide',
    'world',
    'anywhere',
    'global',
    'globally',
    'international',
  ],
  [Region.AMERICAS]: ['americas'],
  [Region.NORTH_AMERICA]: ['north america', 'northern america'],
  [Region.LATAM]: ['latam', 'lat am', 'latin america', 'south america', 'central america'],
  [Region.EMEA]: ['emea'],
  [Region.EUROPE]: ['europe', 'european union', 'dach', 'nordics', 'benelux'],
  [Region.MIDDLE_EAST]: ['middle east', 'mena', 'gcc'],
  [Region.AFRICA]: ['africa', 'sub-saharan africa'],
  [Region.APAC]: [
    'apac',
    'asia',
    'asia pacific',
    'asia-pacific',
    'southeast asia',
    'south east asia',
    'oceania',
  ],
};

type Hit =
  | { kind: 'country'; code: string }
  | { kind: 'region'; region: Region }
  | { kind: 'implied'; code: string };

const normalize = (s: string) =>
  s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[’`]/g, "'").replace(/&/g, ' and ');

const NAMES = new Map<string, Hit>();
for (const [code, ...names] of COUNTRIES) {
  for (const n of names) NAMES.set(normalize(n).toLowerCase(), { kind: 'country', code });
}
for (const [name, code] of Object.entries(IMPLIED_COUNTRY)) {
  NAMES.set(normalize(name).toLowerCase(), { kind: 'implied', code });
}
for (const [region, names] of Object.entries(REGION_NAMES) as [Region, string[]][]) {
  for (const n of names) NAMES.set(n, { kind: 'region', region });
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Longest names first, so "New Jersey" wins over "Jersey" and "South Africa" over "Africa". */
const NAME_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${[...NAMES.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);
const ABBREVIATION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(COUNTRY_ABBREVIATIONS).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);
const SUBDIVISION_RE = /,\s*([A-Z]{2})(?![\p{L}\p{N}])/gu;
/** Upper-case only, so "eu" or "amer" inside prose doesn't count. */
const REGION_ABBREVIATIONS: Record<string, Region> = {
  EU: Region.EUROPE,
  AMER: Region.AMERICAS,
  NAMER: Region.NORTH_AMERICA,
  NORAM: Region.NORTH_AMERICA,
};
const REGION_ABBREVIATION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(${Object.keys(REGION_ABBREVIATIONS).join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

export interface LocationScope {
  /** ISO 3166-1 alpha-2 codes the job is located in or open to */
  countries: string[];
  regions: Region[];
}

function scopeOf(raw: string): LocationScope {
  const text = normalize(raw)
    .replace(/\bU\.S\.A?\.?/g, 'USA')
    .replace(/\bU\.K\.?/g, 'UK');
  const countries = new Set<string>();
  const regions = new Set<Region>();
  const implied = new Set<string>();

  for (const [, name] of text.toLowerCase().matchAll(NAME_RE)) {
    const hit = NAMES.get(name)!;
    if (hit.kind === 'country') countries.add(hit.code);
    else if (hit.kind === 'region') regions.add(hit.region);
    else implied.add(hit.code);
  }
  for (const [, abbr] of text.matchAll(ABBREVIATION_RE)) countries.add(COUNTRY_ABBREVIATIONS[abbr]);
  for (const [, abbr] of text.matchAll(REGION_ABBREVIATION_RE)) {
    regions.add(REGION_ABBREVIATIONS[abbr]);
  }

  // "Anywhere in the US" is not worldwide.
  if (countries.size) regions.delete(Region.WORLDWIDE);
  // States, provinces and cities only count when no country is named ("Madrid, MD, Spain").
  if (!countries.size) {
    for (const code of implied) countries.add(code);
    for (const [, sub] of text.matchAll(SUBDIVISION_RE)) {
      if (SUBDIVISION_CODES[sub]) countries.add(SUBDIVISION_CODES[sub]);
    }
  }
  return { countries: [...countries], regions: [...regions] };
}

/** Countries and regions named across a job's location strings. Best effort; unknown places are ignored. */
export function locationScope(locations: (string | null | undefined)[]): LocationScope {
  const countries = new Set<string>();
  const regions = new Set<Region>();
  for (const loc of new Set(locations.filter((l): l is string => !!l?.trim()))) {
    const scope = scopeOf(loc);
    scope.countries.forEach((c) => countries.add(c));
    scope.regions.forEach((r) => regions.add(r));
  }
  return { countries: [...countries].sort(), regions: [...regions].sort() };
}

const REMOTE_RE = /\b(remote|work from home|wfh|anywhere)\b/i;

/** ATSs often leave workplace type empty but say "Remote" in the location. */
export function looksRemote(locations: (string | null | undefined)[]): boolean {
  return locations.some((l) => !!l && REMOTE_RE.test(l));
}
