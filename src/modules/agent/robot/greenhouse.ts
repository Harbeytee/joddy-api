/// <reference lib="dom" />
import type { Page } from 'playwright';
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

/**
 * The hosted Greenhouse form for a job. Boards on a company's own careers site
 * redirect away from job-boards.greenhouse.io, so those use the embeddable form.
 */
export function greenhouseFormUrl(job: Pick<RobotJob, 'externalId' | 'url'>): string | null {
  const [, board, id] = job.externalId.split(':');
  if (!board || !id || !/^\d+$/.test(id)) return null;
  let host = '';
  try {
    host = new URL(job.url).hostname;
  } catch {
    // fall through to the embed form
  }
  if (/(^|\.)greenhouse\.io$/.test(host)) {
    const base = /\.eu\.greenhouse\.io$/.test(host)
      ? 'job-boards.eu.greenhouse.io'
      : 'job-boards.greenhouse.io';
    return `https://${base}/${encodeURIComponent(board)}/jobs/${id}`;
  }
  return `https://job-boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${id}`;
}

interface ScannedField {
  ref: string;
  id: string;
  label: string;
  kind: QuestionKind | 'combobox';
  required: boolean;
  options: string[];
  isCv: boolean;
}

/**
 * Runs in the page: lists the form's questions. Refs use element ids because
 * React re-creates fields as the form changes, dropping anything added to them.
 */
function scan(form: string): ScannedField[] {
  const root = document.querySelector(form);
  if (!root) return [];
  const out: ScannedField[] = [];
  const byId = (id: string) => `${form} #${CSS.escape(id)}`;
  const text = (el: Element | null | undefined) => (el?.textContent ?? '').trim();
  const labelFor = (id: string) => text(root.querySelector(`label[for="${CSS.escape(id)}"]`));
  const isRequired = (el: Element, label: string) =>
    el.getAttribute('aria-required') === 'true' ||
    (el as HTMLInputElement).required ||
    /\*\s*$/.test(label);

  for (const el of Array.from(root.querySelectorAll('input, textarea'))) {
    const input = el as HTMLInputElement;
    if (input.closest('.iti__dropdown-content') || input.tabIndex === -1) continue;
    if (['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(input.type)) continue;
    if (!input.id) continue;
    let label = labelFor(input.id) || input.getAttribute('aria-label') || '';
    let kind: ScannedField['kind'] = 'text';
    if (input.getAttribute('role') === 'combobox') kind = 'combobox';
    else if (input.type === 'file') kind = 'file';
    else if (input.tagName === 'TEXTAREA') kind = 'textarea';
    // File inputs are labelled by their upload group ("Resume/CV", "Cover Letter").
    if (kind === 'file') {
      const group = input.closest('.file-upload, [role="group"], fieldset, .field-wrapper');
      label =
        text(group?.querySelector('.label, .upload-label, legend, label:not([for])')) || label;
    }
    out.push({
      ref: byId(input.id),
      id: input.id,
      label,
      kind,
      required: isRequired(input, label) || (kind === 'file' && /\*\s*$/.test(label)),
      options: [],
      isCv: input.id === 'resume',
    });
  }

  for (const fieldset of Array.from(root.querySelectorAll('fieldset'))) {
    const boxes = Array.from(
      fieldset.querySelectorAll<HTMLInputElement>('input[type=checkbox], input[type=radio]'),
    );
    if (!boxes.length || !boxes[0].id) continue;
    const legend = text(fieldset.querySelector('legend'));
    out.push({
      ref: `${form} fieldset:has(#${CSS.escape(boxes[0].id)})`,
      id: '',
      label: legend,
      kind: boxes[0].type === 'radio' ? 'radio' : 'checkbox',
      required:
        boxes.some((b) => b.required || b.getAttribute('aria-required') === 'true') ||
        /\*\s*$/.test(legend),
      options: boxes.map((b) => labelFor(b.id) || text(b.closest('label'))),
      isCv: false,
    });
  }
  return out;
}

/** Greenhouse question ids are plain ([\w-]+), but keep selectors safe regardless. */
const cssEscape = (id: string) => id.replace(/[^\w-]/g, (c) => `\\${c}`);

const optionLocator = (page: Page, id: string) =>
  page.locator(`[id^="react-select-${cssEscape(id)}-option"]`);

/** Opens a combobox and returns its options; none for type-to-search ones. */
async function openCombobox(page: Page, ref: string, id: string): Promise<string[]> {
  await page.locator(ref).click();
  const options = optionLocator(page, id);
  const listed = await options
    .first()
    .waitFor({ timeout: 2_500 })
    .then(() => true)
    .catch(() => false);
  if (!listed) return [];
  return (await options.allInnerTexts()).map((o) => o.trim()).filter(Boolean);
}

async function closeCombobox(page: Page) {
  await page.keyboard.press('Escape');
}

/** The value a react-select combobox currently shows. */
const comboboxValue = (page: Page, ref: string) =>
  page
    .locator(ref)
    .evaluate(
      (el) => el.closest('.select-shell')?.querySelector('[class*="single-value"]')?.textContent,
    )
    .then((v) => (v ?? '').trim());

export const greenhouse: SiteForm = {
  async open(page, job) {
    const url = greenhouseFormUrl(job);
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
    const fields: FormField[] = [];
    for (const f of scanned) {
      const label = cleanLabel(f.label);
      if (f.kind !== 'combobox') {
        fields.push({ ...f, label, kind: f.kind });
        continue;
      }
      const options = await openCombobox(page, f.ref, f.id);
      await closeCombobox(page);
      // A combobox without a fixed list (e.g. "Location (City)") suggests matches as you type.
      fields.push({ ...f, label, kind: options.length ? 'select' : 'search', options });
    }
    return fields;
  },

  async attachCv(page, field, cv) {
    await page
      .locator(field.ref)
      .setInputFiles({ name: cv.fileName, mimeType: cv.mimeType, buffer: cv.data });
    return page
      .getByText(cv.fileName, { exact: false })
      .first()
      .waitFor({ timeout: 10_000 })
      .then(() => true)
      .catch(() => false);
  },

  async fill(page, field, answer) {
    const id = (await page.locator(field.ref).getAttribute('id')) ?? '';
    switch (field.kind) {
      case 'text':
      case 'textarea': {
        await page.locator(field.ref).fill(answer);
        return (await page.locator(field.ref).inputValue()) === answer;
      }
      case 'select': {
        const index = (await openCombobox(page, field.ref, id)).indexOf(answer);
        if (index < 0) {
          await closeCombobox(page);
          return false;
        }
        await optionLocator(page, id).nth(index).click();
        return (await comboboxValue(page, field.ref)) === answer;
      }
      case 'search': {
        const input = page.locator(field.ref);
        await input.click();
        await input.pressSequentially(searchText(answer), { delay: 60 });
        const suggestions = optionLocator(page, id);
        const found = await suggestions
          .first()
          .waitFor({ timeout: 8_000 })
          .then(() => true)
          .catch(() => false);
        const index = found ? pickSuggestion(await suggestions.allInnerTexts(), answer) : -1;
        if (index < 0) {
          await closeCombobox(page);
          return false;
        }
        await suggestions.nth(index).click();
        return (await comboboxValue(page, field.ref)) !== '';
      }
      case 'checkbox':
      case 'radio': {
        const group = page.locator(field.ref);
        const boxes = group.locator(`input[type=${field.kind}]`);
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
    await page.locator(`${FORM} button[type=submit]`).first().click();
    return waitForOutcome(page, {
      successUrl: /\/confirmation(\b|$)/,
      successText:
        /thank you for (applying|your (application|interest))|application (has been )?(submitted|received)/i,
      errors: `${FORM} [aria-invalid="true"], ${FORM} .error, ${FORM} [id$="-error"]:not(:empty), [role="alert"]`,
    });
  },
};
