/// <reference lib="dom" />
import type { QuestionKind } from './answers';
import {
  choiceIndex,
  cleanLabel,
  inPage,
  looksClosed,
  pickSuggestion,
  searchText,
  waitForOutcome,
} from './page';
import { HANDOFF } from './sites';
import type { FormField, RobotJob, SiteForm } from './types';

const FORM = '#application-form';

/** jobs.lever.co/{company}/{id}/apply (or jobs.eu.lever.co for EU accounts). */
export function leverFormUrl(job: Pick<RobotJob, 'applyUrl' | 'url'>): string | null {
  for (const candidate of [job.applyUrl, job.url]) {
    try {
      const url = new URL(candidate);
      if (!/^jobs(\.eu)?\.lever\.co$/.test(url.hostname)) continue;
      const [company, id] = url.pathname.split('/').filter(Boolean);
      if (company && id) return `https://${url.hostname}/${company}/${id}/apply`;
    } catch {
      // not a URL; try the next one
    }
  }
  return null;
}

/** Runs in the page: lists the form's questions, each referenced by its input's name. */
function scan(form: string): Array<FormField & { kind: QuestionKind }> {
  const root = document.querySelector(form);
  if (!root) return [];
  const out: Array<FormField & { kind: QuestionKind }> = [];
  const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

  for (const item of Array.from(root.querySelectorAll('li.application-question'))) {
    const inputs = Array.from(
      item.querySelectorAll<HTMLInputElement>('input:not([type=hidden]), textarea, select'),
    ).filter((el) => el.id !== 'customPronounsTextField');
    if (!inputs.length) continue;
    const first = inputs[0];
    const labelEl = item.querySelector('.application-label');
    const label = text(labelEl?.querySelector('.text') ?? labelEl) || first.name;
    // The office picker is required, though only its styling says so.
    const required =
      !!item.querySelector('.required') ||
      inputs.some((el) => el.required) ||
      first.name === 'opportunityLocationId';

    let kind: QuestionKind = 'text';
    let options: string[] = [];
    if (first.type === 'file') kind = 'file';
    else if (first.tagName === 'SELECT') {
      kind = 'select';
      options = Array.from((first as unknown as HTMLSelectElement).options)
        .filter((o) => o.value)
        .map((o) => text(o));
    } else if (first.type === 'radio' || first.type === 'checkbox') {
      kind = first.type;
      options = inputs.map((el) => text(el.closest('label')));
    } else if (first.id === 'location-input') kind = 'search';
    else if (first.tagName === 'TEXTAREA') kind = 'textarea';

    if (!first.name) continue;
    out.push({
      ref: `${form} li.application-question:has([name="${first.name.replace(/["\\]/g, '\\$&')}"])`,
      label,
      kind,
      required,
      options,
      isCv: first.name === 'resume',
    });
  }
  return out;
}

export const lever: SiteForm = {
  async open(page, job) {
    const url = leverFormUrl(job);
    if (!url) return HANDOFF.unsupportedSite;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (response?.status() === 404) return HANDOFF.closed;
    const form = await page
      .waitForSelector(FORM, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (form) return null;
    return (await looksClosed(page)) ? HANDOFF.closed : HANDOFF.unsupportedSite;
  },

  async fields(page) {
    const scanned = await inPage(page, scan, FORM);
    return scanned.map((f) => ({ ...f, label: cleanLabel(f.label) }));
  },

  async attachCv(page, field, cv) {
    await page
      .locator(`${field.ref} input[type=file]`)
      .setInputFiles({ name: cv.fileName, mimeType: cv.mimeType, buffer: cv.data });
    // Lever reads the CV and pre-fills fields from it, so let that finish before typing.
    const done = await page
      .locator(`${field.ref} .resume-upload-success, ${field.ref} .filename`)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    await page
      .locator(`${field.ref} .resume-upload-working`)
      .waitFor({ state: 'hidden', timeout: 20_000 })
      .catch(() => undefined);
    return done;
  },

  async fill(page, field, answer) {
    const item = page.locator(field.ref);
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        const input = item.locator('input:not([type=hidden]), textarea').first();
        await input.fill(answer);
        return (await input.inputValue()) === answer;
      }
      case 'select': {
        const select = item.locator('select').first();
        await select.selectOption({ label: answer });
        return (
          (await select.evaluate((el: HTMLSelectElement) =>
            el.selectedOptions[0]?.textContent?.trim(),
          )) === answer
        );
      }
      case 'search': {
        const input = item.locator('#location-input');
        await input.fill('');
        await input.pressSequentially(searchText(answer), { delay: 60 });
        const suggestions = item.locator('.dropdown-location');
        const found = await suggestions
          .first()
          .waitFor({ timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        if (!found) return false;
        const index = pickSuggestion(await suggestions.allInnerTexts(), answer);
        if (index < 0) return false;
        await suggestions.nth(index).click();
        return (await item.locator('#selected-location').inputValue()) !== '';
      }
      case 'radio':
      case 'checkbox': {
        const boxes = item.locator(`input[type=${field.kind}]`);
        const index = choiceIndex(field, answer);
        if (index < 0) return false;
        await boxes.nth(index).check({ force: true });
        return boxes.nth(index).isChecked();
      }
      default:
        return false;
    }
  },

  async submit(page) {
    await page.locator('#btn-submit').click();
    return waitForOutcome(page, {
      successUrl: /\/thanks(\b|$)/,
      successText:
        /application (has been )?(submitted|received)|thanks? (you )?for (applying|your application)/i,
      errors: `${FORM} .error-message, ${FORM} .application-error, .error-banner, [role="alert"]`,
    });
  },
};
