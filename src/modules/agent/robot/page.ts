import type { Page } from 'playwright';
import { findCountry } from './answers';
import { HANDOFF } from './sites';
import type { FormField, SubmitOutcome } from './types';

const CLOSED =
  /no longer (open|accepting|available|active)|job (is )?not found|position has been filled|page (you('| a)re looking for )?(cannot|can['’]t|could not) be found|job (has )?(expired|closed)/i;

/** Visible CAPTCHA challenges. Joddy never tries to solve these; the job goes back to the user. */
const CAPTCHA_CHALLENGES = [
  'iframe[src*="recaptcha"][src*="bframe"]',
  'iframe[src*="hcaptcha"][src*="frame=challenge"]',
  'iframe[title*="challenge" i][src*="captcha"]',
  'iframe[src*="challenges.cloudflare.com"]',
];

export async function looksClosed(page: Page): Promise<boolean> {
  const text = await page
    .locator('body')
    .innerText({ timeout: 5_000 })
    .catch(() => '');
  return CLOSED.test(text);
}

async function captchaShowing(page: Page): Promise<boolean> {
  for (const selector of CAPTCHA_CHALLENGES) {
    const frames = page.locator(selector);
    const count = await frames.count();
    for (let i = 0; i < count; i++) {
      if (await frames.nth(i).isVisible()) return true;
    }
  }
  return false;
}

interface OutcomeSignals {
  successUrl: RegExp;
  successText: RegExp;
  /** Selector matching visible validation errors on the form. */
  errors: string;
  timeoutMs?: number;
}

/** After clicking submit: waits until the page shows success, a CAPTCHA challenge or form errors. */
export async function waitForOutcome(page: Page, signals: OutcomeSignals): Promise<SubmitOutcome> {
  const deadline = Date.now() + (signals.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    if (signals.successUrl.test(page.url())) return { submitted: true };
    const text = await page
      .locator('body')
      .innerText({ timeout: 2_000 })
      .catch(() => '');
    if (signals.successText.test(text)) return { submitted: true };
    if (await captchaShowing(page)) return { submitted: false, reason: HANDOFF.captcha };

    const errors = page.locator(signals.errors);
    const visible: string[] = [];
    for (let i = 0; i < Math.min(await errors.count(), 10); i++) {
      const el = errors.nth(i);
      if (await el.isVisible()) visible.push((await el.innerText()).trim());
    }
    const messages = visible.filter(Boolean);
    if (messages.length) {
      return {
        submitted: false,
        reason: HANDOFF.formRejected,
        detail: messages.join('; ').slice(0, 500),
      };
    }
    await page.waitForTimeout(500);
  }
  return {
    submitted: false,
    reason: HANDOFF.formRejected,
    detail: 'No confirmation after submitting',
  };
}

/**
 * Runs `fn` in the page. esbuild-based runners (tsx) wrap named functions in
 * __name(), which doesn't exist in the page, so a no-op one is defined first.
 */
export async function inPage<R>(page: Page, fn: (arg: string) => R, arg: string): Promise<R> {
  await page.evaluate('globalThis.__name ??= (f) => f');
  return page.evaluate(fn, arg);
}

/** For "City, Country" answers to location autocompletes: what to type. */
export const searchText = (answer: string) => answer.split(',')[0].trim();

/**
 * Which autocomplete suggestion matches a "City, Country" answer: one naming the
 * city in that country. -1 rather than a same-named city elsewhere.
 */
export function pickSuggestion(suggestions: string[], answer: string): number {
  const [city, ...rest] = answer.split(',').map((s) => s.trim());
  const country = rest.length ? findCountry(rest.join(', ')) : null;
  const named = new RegExp(`(^|[^\\p{L}])${escapeRegExp(city)}($|[^\\p{L}])`, 'iu');
  return suggestions.findIndex((s) => named.test(s) && (!country || findCountry(s) === country));
}

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const AGREE = /^(yes|i agree|agree|accept|i acknowledge|acknowledge|i confirm|confirm)\b/i;

/**
 * Which input of a radio/checkbox group to tick: the chosen option for radios;
 * for an acknowledgement checkbox, its only box or the "Yes / I agree" one.
 */
export function choiceIndex(field: FormField, answer: string): number {
  if (field.kind === 'radio') return field.options.indexOf(answer);
  if (field.options.length === 1) return 0;
  return field.options.findIndex((o) => AGREE.test(o));
}

/** Clean label text: collapsed whitespace, no trailing required markers. */
export const cleanLabel = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/[*✱]\s*$/, '')
    .trim();
