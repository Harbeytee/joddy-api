import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AppConfigService } from '../../config/app-config.service';

const KILL_GRACE_MS = 10_000;
const ERROR_TAIL_LINES = 15;
/** The scraper only needs to reach the job boards: none of the API's secrets go to it. */
const PASSED_ENV = ['PATH', 'HOME', 'TMPDIR', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY'];

/** Runs the job-scraper project (`src/scrape.js --feed-only`) and returns the path of the feed it wrote. */
@Injectable()
export class ScraperRunner {
  private readonly logger = new Logger('Scraper');

  constructor(private readonly config: AppConfigService) {}

  async run(signal: AbortSignal): Promise<string> {
    const dir = this.config.get('JOB_SYNC_SCRAPER_DIR');
    if (!dir) throw new Error('JOB_SYNC_SCRAPER_DIR is not set');
    const timeoutMinutes = this.config.get('JOB_SYNC_TIMEOUT_MINUTES');

    const child = spawn(
      process.execPath,
      [
        `--max-old-space-size=${this.config.get('JOB_SYNC_SCRAPER_MEMORY_MB')}`,
        'src/scrape.js',
        '--feed-only',
        '--out',
        'data',
      ],
      {
        cwd: dir,
        env: Object.fromEntries(
          PASSED_ENV.flatMap((k) => (process.env[k] ? [[k, process.env[k]]] : [])),
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const tail: string[] = [];
    for (const stream of [child.stdout, child.stderr]) {
      createInterface({ input: stream }).on('line', (line) => {
        if (!line.trim()) return;
        this.logger.log(line);
        tail.push(line);
        if (tail.length > ERROR_TAIL_LINES) tail.shift();
      });
    }

    let stopReason: string | undefined;
    const stop = (reason: string) => {
      if (stopReason || child.exitCode !== null) return;
      stopReason = reason;
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), KILL_GRACE_MS).unref();
    };
    const timer = setTimeout(
      () => stop(`timed out after ${timeoutMinutes} minutes`),
      timeoutMinutes * 60_000,
    );
    const onAbort = () => stop('stopped because the worker is shutting down');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();

    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject);
        child.once('close', resolve);
      });
      if (stopReason) throw new Error(`Scraper ${stopReason}`);
      if (code !== 0) {
        throw new Error(`Scraper exited with code ${code}: ${tail.slice(-5).join(' | ')}`);
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    }

    const feed = join(dir, 'data', 'jobs.jsonl');
    await access(feed);
    return feed;
  }
}
