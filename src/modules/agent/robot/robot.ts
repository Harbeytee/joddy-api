import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser, type Page } from 'playwright';
import { AppConfigService } from '../../../config/app-config.service';
import { SITE_FORMS } from './index';
import { fillApplication } from './run';
import { HANDOFF } from './sites';
import type { RobotInput, RobotResult } from './types';

/** Longest one application may take before the robot gives up on it. */
const RUN_TIMEOUT_MS = 4 * 60_000;

export const ROBOT = Symbol('ROBOT');

/** Fills (and, when allowed, submits) one application form. */
export interface Robot {
  apply(input: RobotInput, taskId: string): Promise<RobotResult>;
}

/** The real robot: a headless Chromium driven by Playwright. */
@Injectable()
export class PlaywrightRobot implements Robot, OnModuleDestroy {
  private readonly logger = new Logger(PlaywrightRobot.name);
  private browser: Promise<Browser> | null = null;

  constructor(private readonly config: AppConfigService) {}

  async apply(input: RobotInput, taskId: string): Promise<RobotResult> {
    const site = SITE_FORMS[input.job.source];
    if (!site) return { outcome: 'handoff', reason: HANDOFF.unsupportedSite, missing: [] };

    const browser = await this.launch();
    const context = await browser.newContext({
      locale: 'en-GB',
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultTimeout(15_000);
    context.setDefaultNavigationTimeout(45_000);
    const page = await context.newPage();
    try {
      return await withTimeout(fillApplication(page, site, input), RUN_TIMEOUT_MS);
    } finally {
      await this.screenshot(page, taskId);
      await context.close();
    }
  }

  async onModuleDestroy() {
    const browser = await this.browser?.catch(() => null);
    await browser?.close();
  }

  private async launch(): Promise<Browser> {
    const current = await this.browser?.catch(() => null);
    if (current?.isConnected()) return current;
    this.browser = chromium.launch({ headless: true });
    this.browser.catch(() => (this.browser = null));
    return this.browser;
  }

  private async screenshot(page: Page, taskId: string) {
    const dir = this.config.get('AUTO_APPLY_ARTIFACTS_DIR');
    if (!dir || page.isClosed()) return;
    try {
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${taskId}-${Date.now()}.png`), fullPage: true });
    } catch (err) {
      this.logger.warn(`Could not save screenshot for task ${taskId}: ${String(err)}`);
    }
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Gave up after ${ms / 1000}s`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
