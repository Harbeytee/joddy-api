export const SENIORITIES = [
  'INTERN',
  'JUNIOR',
  'MID',
  'SENIOR',
  'LEAD',
  'STAFF',
  'PRINCIPAL',
  'DIRECTOR',
  'EXECUTIVE',
] as const;
export type Seniority = (typeof SENIORITIES)[number];

/** Checked in order, so "Senior Director" is a director and "Associate Director" isn't junior. */
const SENIORITY_RULES: [Seniority, RegExp][] = [
  ['INTERN', /\b(intern|internship|co-?op|trainee|apprentice(ship)?)\b/i],
  ['EXECUTIVE', /\b(chief|c[etfo]o|s?vp|evp|vice president)\b/i],
  ['DIRECTOR', /\b(director|head of)\b/i],
  ['PRINCIPAL', /\bprincipal\b/i],
  // "Staff Accountant" or "Staff Nurse" aren't the senior IC "staff" level.
  [
    'STAFF',
    /\bstaff (software|engineer|data|machine|ml|ai|product|designer|scientist|developer|backend|frontend|full[- ]?stack|platform|security|infrastructure|site|research|mobile|ios|android)\b/i,
  ],
  ['LEAD', /\b(lead|team lead|tech lead)\b/i],
  ['SENIOR', /\b(senior|sr)\b/i],
  ['MID', /\b(mid[- ]?level|intermediate)\b/i],
  ['JUNIOR', /\b(junior|jr|entry[- ]level|graduate|new grad|associate)\b/i],
];

/** Best-effort level from the job title; null when the title doesn't say. */
export function seniorityFromTitle(title: string): Seniority | null {
  for (const [level, re] of SENIORITY_RULES) if (re.test(title)) return level;
  return null;
}

const SNIPPET_LENGTH = 220;
/** Paragraphs shorter than this are usually headings ("About us", "Location") rather than prose. */
const MIN_PARAGRAPH = 60;

/** First real paragraph of a plain-text description, cut at a word boundary. */
export function descriptionSnippet(description: string | null | undefined): string {
  if (!description) return '';
  const lines = description
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const text = lines.find((l) => l.length >= MIN_PARAGRAPH) ?? lines.join(' ');
  if (text.length <= SNIPPET_LENGTH) return text;

  const cut = text.slice(0, SNIPPET_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > SNIPPET_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,;:.–-]+$/, '')}…`;
}
