/** Job sources whose application forms the robot can fill in. */
export const AUTO_APPLY_SOURCES: ReadonlySet<string> = new Set(['greenhouse', 'lever']);

export const canAutoApply = (source: string) => AUTO_APPLY_SOURCES.has(source);

/** Why the robot handed a job back to the user. Stored in AgentTask.error. */
export const HANDOFF = {
  unsupportedSite: 'unsupported-site',
  missingAnswers: 'missing-answers',
  captcha: 'captcha',
  formRejected: 'form-rejected',
  closed: 'job-closed',
  dryRun: 'dry-run',
  error: 'error',
} as const;

export type Handoff = (typeof HANDOFF)[keyof typeof HANDOFF];
