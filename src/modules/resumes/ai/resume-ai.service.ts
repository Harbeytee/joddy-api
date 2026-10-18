import {
  BadRequestException,
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
  REFINE_MAX_LENGTH,
  REFINE_SCHEMA,
  refineInstructions,
  refinePrompt,
  toSuggestions,
  type RefineContext,
  type RefineField,
  type RefineSuggestion,
} from './refine-prompt';

export interface RefineInput {
  field: RefineField;
  text: string;
  maxLength?: number;
  context?: RefineContext;
}

/** Suggests better wording for text the user already wrote on their resume. They choose whether to use it. */
@Injectable()
export class ResumeAiService {
  private readonly logger = new Logger(ResumeAiService.name);
  /** Asking again for the same text (e.g. a double click) reuses the answer. */
  private readonly cache = new TtlCache<RefineSuggestion[]>(60 * 60_000, 500);

  constructor(private readonly gemini: GeminiClient) {}

  async refine(
    userId: string,
    { field, text, maxLength, context = {} }: RefineInput,
  ): Promise<{
    suggestions: RefineSuggestion[];
  }> {
    if (!this.gemini.enabled) {
      throw new ServiceUnavailableException('AI suggestions aren’t available right now.');
    }
    const limit = Math.min(REFINE_MAX_LENGTH[field], maxLength ?? Infinity);
    const original = text.trim();
    if (original.length > limit) {
      throw new BadRequestException(`text must be at most ${limit} characters for ${field}`);
    }

    const key = JSON.stringify([this.gemini.model, field, limit, context, original]);
    const cached = this.cache.get(key);
    if (cached) return { suggestions: cached };

    let raw: unknown;
    try {
      raw = await this.gemini.generateJson({
        system: refineInstructions(field),
        prompt: refinePrompt(original, context),
        schema: REFINE_SCHEMA,
        userId,
      });
    } catch (err) {
      if (err instanceof AiQuotaError) {
        this.logger.warn(err.message);
        throw err.scope === 'user'
          ? new HttpException(
              'You’ve reached today’s limit for AI suggestions. Try again tomorrow.',
              HttpStatus.TOO_MANY_REQUESTS,
            )
          : new ServiceUnavailableException(
              'AI suggestions have reached their limit for today. Try again tomorrow.',
            );
      }
      if (err instanceof AiBusyError) {
        this.logger.warn(err.message);
        throw new ServiceUnavailableException('AI is busy right now. Try again in a minute.');
      }
      if (err instanceof AiUnavailableError) {
        this.logger.error(err.message);
        throw new ServiceUnavailableException(
          'AI suggestions aren’t available right now. Try again later.',
        );
      }
      throw err;
    }

    const suggestions = toSuggestions(raw, field, original, limit);
    if (!suggestions.length) {
      throw new UnprocessableEntityException(
        'We couldn’t suggest a better version. Try adding a little more detail.',
      );
    }
    this.cache.set(key, suggestions);
    return { suggestions };
  }
}
