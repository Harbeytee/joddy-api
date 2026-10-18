import type { Page } from 'playwright';
import { answerFor, type Question } from './answers';
import { HANDOFF } from './sites';
import type { FormField, RobotInput, RobotResult, SiteForm } from './types';

const asQuestion = ({ label, kind, required, options }: FormField): Question => ({
  label,
  kind,
  required,
  options,
});

/**
 * Fills one application form. Every required question must have a certain
 * answer before anything is typed; otherwise the job goes back to the user with
 * the list of questions to answer. Submits only when `input.submit` is true.
 */
export async function fillApplication(
  page: Page,
  site: SiteForm,
  input: RobotInput,
): Promise<RobotResult> {
  const closed = await site.open(page, input.job);
  if (closed) return { outcome: 'handoff', reason: closed, missing: [] };

  const fields = await site.fields(page);
  const cvField = fields.find((f) => f.isCv);
  if (!cvField) {
    return {
      outcome: 'handoff',
      reason: HANDOFF.formRejected,
      missing: [],
      detail: 'No CV upload on the form',
    };
  }

  const plan = fields
    .filter((f) => !f.isCv)
    .map((field) => ({ field, answer: answerFor(field, input.applicant) }));
  const missing = plan.filter((p) => p.field.required && p.answer === null).map((p) => p.field);
  if (missing.length) {
    return { outcome: 'handoff', reason: HANDOFF.missingAnswers, missing: missing.map(asQuestion) };
  }

  if (!(await site.attachCv(page, cvField, input.cv))) {
    return {
      outcome: 'handoff',
      reason: HANDOFF.formRejected,
      missing: [],
      detail: 'The form did not accept the CV',
    };
  }

  const rejected: FormField[] = [];
  for (const { field, answer } of plan) {
    if (answer === null) continue;
    const ok = await site.fill(page, field, answer);
    if (!ok && field.required) rejected.push(field);
  }
  if (rejected.length) {
    return {
      outcome: 'handoff',
      reason: HANDOFF.missingAnswers,
      missing: rejected.map(asQuestion),
    };
  }

  if (!input.submit) return { outcome: 'handoff', reason: HANDOFF.dryRun, missing: [] };

  const result = await site.submit(page);
  return result.submitted
    ? { outcome: 'submitted' }
    : { outcome: 'handoff', reason: result.reason, missing: [], detail: result.detail };
}
