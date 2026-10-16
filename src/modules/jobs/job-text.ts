import { JobType, Seniority } from '../../generated/prisma/enums';

/**
 * ATSs report employment type as free text ("Full-time", "fulltime permanent", "FULL_TIME").
 * Keep in sync with the backfill in the `job_type_and_geo` migration.
 */
export function jobTypeFromText(raw: string | null | undefined): JobType | null {
  const s = raw?.toLowerCase().replace(/[^a-z]/g, '') ?? '';
  if (s.startsWith('fulltime') || s === 'permanent') return JobType.FULL_TIME;
  if (s.startsWith('parttime')) return JobType.PART_TIME;
  if (s.startsWith('contract') || s.startsWith('freelance')) return JobType.CONTRACT;
  if (s.startsWith('intern')) return JobType.INTERNSHIP;
  if (s.startsWith('temp') || s.startsWith('seasonal') || s.includes('fixedterm')) {
    return JobType.TEMPORARY;
  }
  return null;
}

const STAFF_ROLES =
  'software|engineer|data|machine|ml|ai|product|designer|scientist|developer|backend|frontend|full[- ]?stack|platform|security|infrastructure|site|research|mobile|ios|android';

/**
 * Checked in order, so "Senior Director" is a director and "Associate Director" isn't entry level.
 * Roman numerals must be upper case and follow a word ("Engineer III"), so "IV Nurse" isn't level four.
 *
 * Keep in sync with the backfill in the `job_seniority` migration; re-ingesting refreshes every row.
 */
const SENIORITY_RULES: [Seniority, RegExp[]][] = [
  [
    Seniority.INTERN,
    [/\b(intern|internship|co-?op|trainee|apprentice(ship)?|working student|placement student)\b/i],
  ],
  [Seniority.GRADUATE, [/\b(graduate|new grad|recent grad|early career|university grad)\b/i]],
  [Seniority.EXECUTIVE, [/\b(chief|c[etfo]o|s?vp|evp|vice president)\b/i]],
  [Seniority.DIRECTOR, [/\b(director|head of)\b/i]],
  [Seniority.PRINCIPAL, [/\bprincipal\b/i]],
  // "Staff Accountant" or "Staff Nurse" aren't the senior IC "staff" level.
  [Seniority.STAFF, [new RegExp(`\\bstaff (${STAFF_ROLES})\\b`, 'i')]],
  [Seniority.LEAD, [/\b(lead|team lead|tech lead)\b/i]],
  [Seniority.SENIOR, [/\b(senior|sr)\b/i, /\s(III|IV)\b/]],
  [Seniority.MID, [/\b(mid[- ]?level|intermediate)\b/i, /\sII\b/]],
  [Seniority.ENTRY, [/\b(junior|jr|entry[- ]level|associate)\b/i]],
];

/** Best-effort level from the job title; null when the title doesn't say. */
export function seniorityFromTitle(title: string): Seniority | null {
  for (const [level, patterns] of SENIORITY_RULES) {
    if (patterns.some((re) => re.test(title))) return level;
  }
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
