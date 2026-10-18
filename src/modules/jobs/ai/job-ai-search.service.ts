import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiBusyError, AiQuotaError, AiUnavailableError } from '../../ai/ai-errors';
import { GeminiClient } from '../../ai/gemini.client';
import { TtlCache } from '../../ai/ttl-cache';
import {
  AI_SEARCH_SCHEMA,
  isEmptySearch,
  searchInstructions,
  toAiJobSearch,
  type AiJobSearch,
} from './job-search-prompt';

/** "Ask AI" search: Gemini turns a prompt into job search filters; the normal search then finds the jobs. */
@Injectable()
export class JobAiSearchService {
  private readonly logger = new Logger(JobAiSearchService.name);
  /** Same prompt, same day: reuse the answer. */
  private readonly cache = new TtlCache<AiJobSearch>(6 * 60 * 60_000, 500);

  constructor(private readonly gemini: GeminiClient) {}

  async interpret(
    userId: string,
    prompt: string,
    homeCountry?: string,
    now = new Date(),
  ): Promise<AiJobSearch> {
    if (!this.gemini.enabled) {
      throw new ServiceUnavailableException(
        'AI search isn’t available right now. Use the filters instead.',
      );
    }
    const today = now.toISOString().slice(0, 10);
    const key = JSON.stringify([
      this.gemini.model,
      today,
      homeCountry ?? '',
      prompt.trim().toLowerCase().replace(/\s+/g, ' '),
    ]);
    const cached = this.cache.get(key, now.getTime());
    if (cached) return cached;

    let raw: unknown;
    try {
      raw = await this.gemini.generateJson({
        system: searchInstructions({ today, homeCountry }),
        prompt,
        schema: AI_SEARCH_SCHEMA,
        userId,
      });
    } catch (err) {
      if (err instanceof AiQuotaError) {
        this.logger.warn(err.message);
        throw err.scope === 'user'
          ? new HttpException(
              'You’ve reached today’s limit for AI search. Try again tomorrow, or use the filters.',
              HttpStatus.TOO_MANY_REQUESTS,
            )
          : new ServiceUnavailableException(
              'AI search has reached its limit for today. Try again tomorrow, or use the filters.',
            );
      }
      if (err instanceof AiBusyError) {
        this.logger.warn(err.message);
        throw new ServiceUnavailableException(
          'AI search is busy right now. Try again in a minute, or use the filters.',
        );
      }
      if (err instanceof AiUnavailableError) {
        this.logger.error(err.message);
        throw new ServiceUnavailableException(
          'AI search isn’t available right now. Use the filters instead.',
        );
      }
      throw err;
    }

    const search = toAiJobSearch(raw);
    if (isEmptySearch(search)) {
      throw new UnprocessableEntityException(
        'That doesn’t look like a job search. Try describing the role, place or salary you want.',
      );
    }
    search.summary ||= prompt.trim().slice(0, 160);

    this.cache.set(key, search, now.getTime());
    return search;
  }
}
