/// <reference lib="dom" />
import type { Locator, Page } from 'playwright';
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

const FORM = '.ashby-application-form-container';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** jobs.ashbyhq.com/{board}/{id}/application, from the job's links or else its id. */
export function ashbyFormUrl(
  job: Pick<RobotJob, 'externalId' | 'applyUrl' | 'url'>,
): string | null {
  for (const candidate of [job.applyUrl, job.url]) {
    try {
      const url = new URL(candidate);
      if (url.hostname !== 'jobs.ashbyhq.com') continue;
      const [board, id] = url.pathname.split('/').filter(Boolean);
      if (board && id && UUID.test(id)) return `https://${url.hostname}/${board}/${id}/application`;
    } catch {
      // not a URL; try the next one
    }
  }
  const [, board, id] = job.externalId.split(':');
  if (!board || !id || !UUID.test(id)) return null;
  return `https://jobs.ashbyhq.com/${encodeURIComponent(board)}/${id}/application`;
}

interface ScannedField extends Omit<FormField, 'kind'> {
  kind: QuestionKind | 'combobox';
}

/**
 * Runs in the page: lists the form's questions. Each one is referenced by its entry's
 * data-field-path, the question's id; data-field-entry-id changes on every page load.
 */
function scan(form: string): ScannedField[] {
  const out: ScannedField[] = [];
  const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();

  for (const entry of Array.from(document.querySelectorAll(`${form} [data-field-path]`))) {
    const path = entry.getAttribute('data-field-path') ?? '';
    const title = entry.querySelector('.ashby-application-form-question-title');
    // Consent boxes can leave the title empty and ask the question in the description.
    const label =
      text(title) || text(entry.querySelector('.ashby-application-form-question-description'));
    const inputs = Array.from(entry.querySelectorAll<HTMLInputElement>('input, textarea, select'));
    if (!path || !inputs.length) continue;
    // Ashby marks required questions with a hashed "_required_…" class on the title.
    const required =
      /(^|\s)_required_/.test(title?.className ?? '') || inputs.some((el) => el.required);
    const labels = (selector: string) => Array.from(entry.querySelectorAll(selector)).map(text);

    let kind: ScannedField['kind'] = 'text';
    let options: string[] = [];
    if (entry.querySelector('.ashby-application-form-input-yesno')) {
      kind = 'radio';
      options = labels('.ashby-application-form-input-yesno-option');
    } else if (entry.querySelector('.ashby-application-form-input-radio-group')) {
      kind = 'radio';
      options = labels('.ashby-application-form-input-radio-group-option-label');
    } else if (entry.querySelector('.ashby-application-form-input-checkbox-group')) {
      kind = 'checkbox';
      options = labels('.ashby-application-form-input-checkbox-group-option-label');
    } else if (entry.querySelector('input[role=combobox]')) kind = 'combobox';
    else if (entry.querySelector('input[type=file]')) kind = 'file';
    else if (entry.querySelector('select')) {
      kind = 'select';
      options = Array.from(entry.querySelector('select')!.options)
        .filter((o) => o.value)
        .map(text);
    } else if (entry.querySelector('textarea')) kind = 'textarea';
    else if (entry.querySelector('input[type=checkbox]')) {
      kind = 'checkbox';
      options = [label];
    }

    out.push({
      ref: `${form} [data-field-path="${path.replace(/["\\]/g, '\\$&')}"]`,
      label,
      kind,
      required,
      options,
      isCv: path === '_systemfield_resume',
    });
  }
  return out;
}

/** Suggestions of the combobox that is open, whichever element Ashby renders them in. */
const suggestions = (page: Page) => page.locator('[role="option"]:visible');

async function listed(options: Locator, timeout: number): Promise<boolean> {
  return options
    .first()
    .waitFor({ timeout })
    .then(() => true)
    .catch(() => false);
}

/** Waits for a combobox to show `choice`: Ashby puts it in the value attribute and empties the input. */
async function shows(page: Page, input: Locator, choice: string): Promise<boolean> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    if ((await input.getAttribute('value'))?.trim() === choice.trim()) return true;
    await page.waitForTimeout(100);
  }
  return false;
}

/**
 * Opens a combobox with its arrow button and returns the options it lists. A plain click or
 * focus lists nothing; type-to-search ones like the location list nothing until typed into.
 */
async function openCombobox(page: Page, item: Locator): Promise<string[]> {
  await item.locator('input[role=combobox] + button').click();
  const options = suggestions(page);
  const found = await listed(options, 2_500);
  return found ? (await options.allInnerTexts()).map((o) => o.trim()) : [];
}

export const ashby: SiteForm = {
  async open(page, job) {
    const url = ashbyFormUrl(job);
    if (!url) return HANDOFF.unsupportedSite;
    const response = await page.goto(url, { waitUntil: 'domcontentloaded' });
    if (response?.status() === 404) return HANDOFF.closed;
    const form = await page
      .waitForSelector(`${FORM} [data-field-path]`, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (form) return null;
    return (await looksClosed(page)) ? HANDOFF.closed : HANDOFF.unsupportedSite;
  },

  async fields(page) {
    const scanned = await inPage(page, scan, FORM);
    const fields: FormField[] = [];
    for (const f of scanned) {
      const label = cleanLabel(f.label);
      if (f.kind !== 'combobox') {
        fields.push({ ...f, label, kind: f.kind });
        continue;
      }
      const options = await openCombobox(page, page.locator(f.ref));
      await page.keyboard.press('Escape');
      fields.push({ ...f, label, kind: options.length ? 'select' : 'search', options });
    }
    return fields;
  },

  async attachCv(page, field, cv) {
    const item = page.locator(field.ref);
    await item
      .locator('input[type=file]')
      .setInputFiles({ name: cv.fileName, mimeType: cv.mimeType, buffer: cv.data });
    return item
      .getByText(cv.fileName, { exact: false })
      .first()
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  },

  async fill(page, field, answer) {
    const item = page.locator(field.ref);
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        const input = item
          .locator('input:not([type=hidden]):not([type=checkbox]), textarea')
          .first();
        // Number inputs (some forms use one for the phone) refuse anything but a plain number.
        const numeric = (await input.getAttribute('type')) === 'number';
        if (numeric && !/^-?\d+(\.\d+)?$/.test(answer)) return false;
        await input.fill(answer);
        return (await input.inputValue()) === answer;
      }
      case 'select': {
        if (await item.locator('select').count()) {
          const select = item.locator('select').first();
          await select.selectOption({ label: answer });
          return (
            (await select.evaluate((el: HTMLSelectElement) =>
              el.selectedOptions[0]?.textContent?.trim(),
            )) === answer
          );
        }
        const index = (await openCombobox(page, item)).indexOf(answer);
        if (index < 0) {
          await page.keyboard.press('Escape');
          return false;
        }
        await suggestions(page).nth(index).click();
        return shows(page, item.locator('input[role=combobox]'), answer);
      }
      case 'search': {
        const input = item.locator('input[role=combobox]');
        await input.fill('');
        await input.pressSequentially(searchText(answer), { delay: 60 });
        const options = suggestions(page);
        if (!(await listed(options, 8_000))) return false;
        const texts = await options.allInnerTexts();
        const index = pickSuggestion(texts, answer);
        if (index < 0) {
          await page.keyboard.press('Escape');
          return false;
        }
        await options.nth(index).click();
        return shows(page, input, texts[index]);
      }
      case 'radio': {
        const index = field.options.indexOf(answer);
        if (index < 0) return false;
        const yesNo = item.locator('.ashby-application-form-input-yesno-option');
        if (await yesNo.count()) {
          await yesNo.nth(index).click();
          return (await yesNo.nth(index).getAttribute('aria-pressed')) === 'true';
        }
        const radios = item.locator('input[type=radio]');
        await radios.nth(index).check({ force: true });
        return radios.nth(index).isChecked();
      }
      case 'checkbox': {
        const boxes = item.locator('input[type=checkbox]');
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
    await page.locator('.ashby-application-form-submit-button').click();
    return waitForOutcome(page, {
      successUrl: /\/application\/(success|submitted|thanks)(\b|$)/,
      successText:
        /application (has been |was )?(successfully )?(submitted|received)|thanks? (you )?for (applying|your application)/i,
      errors: `${FORM} [class*="_error"], .ashby-application-form-failure-container, [role="alert"]`,
    });
  },
};
