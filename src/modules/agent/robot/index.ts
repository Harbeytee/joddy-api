import { ashby } from './ashby';
import { greenhouse } from './greenhouse';
import { lever } from './lever';
import type { SiteForm } from './types';

/** Form fillers by job source. Keep in step with AUTO_APPLY_SOURCES in sites.ts. */
export const SITE_FORMS: Readonly<Record<string, SiteForm>> = { ashby, greenhouse, lever };
