/**
 * Small in-memory cache for AI answers, so repeating a request doesn't spend the free quota again.
 * Per process: each API instance keeps its own. Oldest entries are dropped first once full.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { at: number; value: T }>();

  constructor(
    private readonly ttlMs: number,
    private readonly max: number,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (now - hit.at >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    this.entries.delete(key);
    if (this.entries.size >= this.max) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { at: now, value });
  }
}
