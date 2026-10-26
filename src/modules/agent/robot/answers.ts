/**
 * Maps application-form questions to answers from the applicant's profile.
 * Returns null whenever the answer isn't certain: the robot then hands the job
 * back to the user instead of guessing on their behalf.
 */

export interface Applicant {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  city: string;
  country: string;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  /** Countries the applicant may work in without sponsorship. */
  workCountries: string[];
  noticePeriod: string | null;
  salaryExpectation: string | null;
  /** Answers the applicant gave to earlier questions, keyed by questionKey(label). */
  saved: Record<string, string>;
}

/**
 * text/textarea: typed. select/radio: one of `options`. checkbox: ticked or not.
 * search: typed, then the first matching suggestion is picked (e.g. a city autocomplete).
 */
export type QuestionKind =
  'text' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'search' | 'file';

export interface Question {
  label: string;
  kind: QuestionKind;
  required: boolean;
  /** Choices for select / radio / checkbox groups, as shown to the applicant. */
  options: string[];
}

/** All-caps aliases (US, UK...) only match in capitals, so "work with us" isn't read as the United States. */
const COUNTRY_ALIASES: Record<string, string[]> = {
  'united states': ['united states', 'united states of america', 'USA', 'U.S.', 'U.S.A.', 'US'],
  'united kingdom': [
    'united kingdom',
    'UK',
    'U.K.',
    'GBR',
    'great britain',
    'britain',
    'england',
    'scotland',
  ],
  canada: ['canada'],
  ireland: ['ireland', 'IRL'],
  germany: ['germany', 'deutschland', 'DEU'],
  france: ['france', 'FRA'],
  netherlands: ['netherlands', 'the netherlands', 'holland', 'NLD'],
  spain: ['spain', 'ESP'],
  portugal: ['portugal', 'PRT'],
  italy: ['italy', 'ITA'],
  poland: ['poland'],
  sweden: ['sweden'],
  denmark: ['denmark'],
  norway: ['norway'],
  finland: ['finland'],
  switzerland: ['switzerland'],
  austria: ['austria'],
  belgium: ['belgium'],
  israel: ['israel'],
  'united arab emirates': ['united arab emirates', 'UAE'],
  india: ['india'],
  singapore: ['singapore'],
  australia: ['australia', 'AUS'],
  'new zealand': ['new zealand'],
  japan: ['japan'],
  'south korea': ['south korea', 'korea'],
  nigeria: ['nigeria', 'NGA'],
  ghana: ['ghana'],
  kenya: ['kenya'],
  'south africa': ['south africa'],
  egypt: ['egypt'],
  brazil: ['brazil'],
  mexico: ['mexico'],
  argentina: ['argentina'],
  colombia: ['colombia'],
};

const EU = new Set([
  'ireland',
  'germany',
  'france',
  'netherlands',
  'spain',
  'portugal',
  'italy',
  'poland',
  'sweden',
  'denmark',
  'finland',
  'austria',
  'belgium',
]);

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ALIAS_PATTERNS = Object.entries(COUNTRY_ALIASES).flatMap(([country, aliases]) =>
  aliases.map((a) => ({
    country,
    re: new RegExp(`(^|[^a-zA-Z])${escape(a)}($|[^a-zA-Z])`, a === a.toUpperCase() ? '' : 'i'),
  })),
);

/** Canonical country name for free text ("UK", "Lagos, Nigeria"), or null. */
export function findCountry(text: string): string | null {
  return ALIAS_PATTERNS.find((p) => p.re.test(text))?.country ?? null;
}

/** Like findCountry, for what the user typed: "uk" counts as well as "UK". */
const userCountry = (text: string) => findCountry(text) ?? findCountry(text.toUpperCase());

/** Stable key for a question, so a saved answer is reused when the same question comes up again. */
export const questionKey = (label: string) =>
  label
    .toLowerCase()
    .replace(/^\s*(\d{1,2}|[a-z])[.)]\s+/, '')
    .replace(/\*/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .slice(0, 300);

/**
 * Whether the applicant may work in the place a question names without sponsorship.
 * Null when the question names no place Joddy can recognise.
 */
function mayWorkIn(label: string, a: Applicant): boolean | null {
  const unknown = a.workCountries.filter((c) => c.length > 3 && !userCountry(c));
  if (unknown.some((c) => new RegExp(`(^|[^\\p{L}])${escape(c)}($|[^\\p{L}])`, 'iu').test(label)))
    return true;
  const countries = a.workCountries.map(userCountry).filter((c): c is string => !!c);
  if (/european union|\beu\b|\beea\b/i.test(label)) return countries.some((c) => EU.has(c));
  const place = findCountry(label);
  return place ? countries.includes(place) : null;
}

const DECLINE =
  /decline|prefer not|rather not|do(n['’]t| not) wish|not (to )?(say|answer|disclose|specify)|choose not|don['’]t want to/i;

function pickOption(options: string[], re: RegExp): string | null {
  return options.find((o) => re.test(o.trim())) ?? null;
}

/**
 * For a yes/no question, the matching option (or plain "Yes"/"No" for text fields).
 * Null when several options start that way ("Yes, I'm a citizen" / "Yes, I have a visa"):
 * choosing between them needs facts Joddy doesn't have.
 */
function yesNo(q: Question, yes: boolean | null): string | null {
  if (yes === null) return null;
  if (q.kind === 'text' || q.kind === 'textarea') return yes ? 'Yes' : 'No';
  const matches = q.options.filter((o) => (yes ? /^yes\b/i : /^no\b/i).test(o.trim()));
  return matches.length === 1 ? matches[0] : null;
}

const isTyped = (q: Question) => q.kind === 'text' || q.kind === 'textarea' || q.kind === 'search';
const text = (q: Question, value: string | null | undefined) =>
  value && isTyped(q) ? value : null;

const MARKETING =
  /future (roles|opportunit|vacanc|positions|openings)|contact(ing)? me (in|about) (the )?future|contact (me|you) about (other |new )?(job )?opportunit|talent (pool|community|network)|newsletter|marketing|job alerts|retain my (data|information|details|materials)|future (hiring|recruitment)/;
const ACKNOWLEDGE = /(read|understood|understand|acknowledge|agree|accept|confirm)/;
const POLICY = /privacy|notice|policy|terms|data protection|gdpr/;

function savedAnswer(q: Question, a: Applicant): string | null {
  const saved = a.saved[questionKey(q.label)];
  if (saved === undefined || saved === '') return null;
  if (q.kind === 'select' || q.kind === 'radio') return q.options.includes(saved) ? saved : null;
  return saved;
}

export function answerFor(q: Question, a: Applicant): string | null {
  // Joddy only has the CV, which the robot attaches separately.
  if (q.kind === 'file') return null;
  const saved = savedAnswer(q, a);
  if (saved !== null) return saved;

  const label = q.label.toLowerCase().replace(/\s+/g, ' ').replace(/\*$/, '').trim();

  // Minimum-age requirements up to 18: applicants confirm they're 18 or over when they turn on auto-apply.
  if (
    /\b(1[4-8]|sixteen|eighteen) (years|yrs)( of age| old| or older)?\b|over (the age of )?1[4-8]\b|at least 1[4-8]\b/.test(
      label,
    )
  ) {
    return yesNo(q, true);
  }

  // Voluntary equal-opportunity questions: always decline to disclose, never guess.
  if (
    /gender|\bsex\b|race|ethnic|veteran|disabilit|pronoun|sexual orientation|hispanic|latin[oax]|transgender|\bage\b|date of birth|religio|armed forces|military|caring responsibilit|social mobility|socio-?economic/.test(
      label,
    )
  ) {
    return q.kind === 'select' || q.kind === 'radio' ? pickOption(q.options, DECLINE) : null;
  }

  if (/sponsor|visa|immigration (assistance|support)/.test(label)) {
    const allowed = mayWorkIn(q.label, a);
    return yesNo(q, allowed === null ? null : !allowed);
  }
  if (
    /(authori[sz]ed|eligible|legally (able|permitted|entitled)|right) to work|work (permit|authori[sz]ation)/.test(
      label,
    )
  ) {
    return yesNo(q, mayWorkIn(q.label, a));
  }
  // Never opt into marketing or talent pools; a required one is left to the applicant.
  if (MARKETING.test(label)) {
    if (q.kind === 'checkbox') return null;
    return q.kind === 'select' || q.kind === 'radio' ? yesNo(q, false) : null;
  }
  // Required acknowledgements of the employer's privacy notice.
  if (q.required && ACKNOWLEDGE.test(label) && POLICY.test(label)) {
    if (q.kind === 'checkbox') return 'true';
    if (q.kind === 'select' || q.kind === 'radio') {
      return q.options.length === 1 ? q.options[0] : yesNo(q, true);
    }
  }
  // The applicant confirming their own answers are accurate; Joddy only sends what they gave it.
  if (
    q.required &&
    /information (i('| ha)ve |you('| ha)ve )?(provided|given|submitted)( here)? is (true|accurate|correct)/.test(
      label,
    )
  ) {
    if (q.kind === 'checkbox') return 'true';
    if (q.kind === 'select' || q.kind === 'radio') {
      return q.options.length === 1 ? q.options[0] : yesNo(q, true);
    }
  }
  if (q.kind === 'checkbox') return null;

  if (
    /how did you (hear|find|learn)|where did you (hear|find|see)|^source\b|referral source|(which|what) (job )?(site|website|board|platform) did you (find|see|hear)/.test(
      label,
    )
  ) {
    if (q.kind === 'select' || q.kind === 'radio') {
      return pickOption(q.options, /job board|online|internet|website|search|other/i);
    }
    return text(q, 'Online job board');
  }

  if (/preferred (first )?name/.test(label)) return q.required ? text(q, a.firstName) : null;
  if (/first name|given name|forename/.test(label)) return text(q, a.firstName);
  if (/last name|surname|family name/.test(label)) return text(q, a.lastName);
  if (/^(full )?name$|^your name$|^legal name$/.test(label))
    return text(q, `${a.firstName} ${a.lastName}`.trim());
  if (/e-?mail/.test(label)) return text(q, a.email);
  if (/phone|mobile|telephone/.test(label)) return text(q, a.phone);
  if (/linkedin/.test(label)) return text(q, a.linkedinUrl);
  if (/website|portfolio|personal (site|url)/.test(label)) return text(q, a.websiteUrl);
  if (
    /^(current )?location|(what is|what's) your (current )?location|where are you (currently )?(based|located)|^city\b|location \(city\)/.test(
      label,
    )
  ) {
    // Autocompletes get "City, Country" so the robot can pick the right London.
    const cityOnly = q.kind !== 'search' && /city/.test(label) && !/country/.test(label);
    return text(q, cityOnly ? a.city : [a.city, a.country].filter(Boolean).join(', '));
  }
  if (
    /^country\b|country of residence|(which|what) country (are|do) you (currently )?(a )?(live|resid|based|located)/.test(
      label,
    )
  ) {
    if (q.kind === 'select' || q.kind === 'radio') {
      const target = userCountry(a.country);
      return target ? (q.options.find((o) => findCountry(o) === target) ?? null) : null;
    }
    return text(q, a.country);
  }
  if (
    /notice period|when (can|could|would) you (be available to )?start|earliest (possible |available )?start|availab(le|ility) to start/.test(
      label,
    )
  ) {
    return text(q, a.noticePeriod);
  }
  if (
    /salary|compensation expectation|expected (pay|compensation)|desired (pay|compensation)/.test(
      label,
    )
  ) {
    return text(q, a.salaryExpectation);
  }

  // "If you are based outside the US, select 'I am not located in the US'".
  const notInUs = q.options.find((o) =>
    /not (currently )?(located|based|living|residing) in the (us|usa|u\.s\.|united states)/i.test(
      o,
    ),
  );
  if (notInUs && /\bstate\b/.test(label) && userCountry(a.country) !== null) {
    return userCountry(a.country) === 'united states' ? null : notInUs;
  }

  // A required choice with a single option leaves nothing to decide.
  if ((q.kind === 'select' || q.kind === 'radio') && q.required && q.options.length === 1) {
    return q.options[0];
  }
  return null;
}
