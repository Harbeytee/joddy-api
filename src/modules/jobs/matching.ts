export interface MatchResult {
  /** 0-100, share of the user's skills mentioned in the posting */
  score: number;
  matched: string[];
  missing: string[];
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patternCache = new Map<string, RegExp>();

/** Word-boundary match that still works for skills like "C++", "C#" and "Node.js". */
function skillPattern(skill: string): RegExp {
  const key = skill.toLowerCase();
  let re = patternCache.get(key);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9+#.])${escapeRe(key)}(?![a-z0-9+#])`, 'i');
    if (patternCache.size > 5000) patternCache.clear();
    patternCache.set(key, re);
  }
  return re;
}

export function matchJob(
  skills: string[],
  job: { title: string; description?: string },
): MatchResult | null {
  const unique = [...new Set(skills.map((s) => s.trim()).filter(Boolean))];
  if (!unique.length) return null;

  const text = `${job.title}\n${job.description ?? ''}`;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const skill of unique) (skillPattern(skill).test(text) ? matched : missing).push(skill);

  return { score: Math.round((matched.length / unique.length) * 100), matched, missing };
}
