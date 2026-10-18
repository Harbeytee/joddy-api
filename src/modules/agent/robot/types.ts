import type { Page } from 'playwright';
import type { Applicant, Question } from './answers';
import type { Handoff } from './sites';

/** A question as found on a live form, with what the site adapter needs to fill it in. */
export interface FormField extends Question {
  /** CSS selector of the field (or its group) on the page. */
  ref: string;
  /** Set on the field the CV goes into. */
  isCv?: boolean;
}

export interface RobotJob {
  source: string;
  externalId: string;
  companySlug: string;
  url: string;
  applyUrl: string;
}

export interface RobotCv {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

export type SubmitOutcome =
  { submitted: true } | { submitted: false; reason: Handoff; detail?: string };

/** What the robot needs to know about one ATS's application form. */
export interface SiteForm {
  /** Opens the form. Returns a handoff reason when there is no form to fill. */
  open(page: Page, job: RobotJob): Promise<Handoff | null>;
  fields(page: Page): Promise<FormField[]>;
  attachCv(page: Page, field: FormField, cv: RobotCv): Promise<boolean>;
  /** Puts `answer` into the field; false when the page didn't accept it. */
  fill(page: Page, field: FormField, answer: string): Promise<boolean>;
  submit(page: Page): Promise<SubmitOutcome>;
}

export type RobotResult =
  | { outcome: 'submitted' }
  | { outcome: 'handoff'; reason: Handoff; missing: Question[]; detail?: string };

export interface RobotInput {
  job: RobotJob;
  applicant: Applicant;
  cv: RobotCv;
  /** When false, the robot fills the form and stops short of submitting it. */
  submit: boolean;
}
