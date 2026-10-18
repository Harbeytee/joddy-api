import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { AiBusyError, AiUnavailableError } from './ai-errors';
import { AiQuotaService } from './ai-quota.service';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 15_000;

interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
}

/** Minimal Gemini API client (REST, no SDK): one structured-output call per request. */
@Injectable()
export class GeminiClient {
  constructor(
    private readonly config: AppConfigService,
    private readonly quota: AiQuotaService,
  ) {}

  get enabled(): boolean {
    return !!this.config.get('GEMINI_API_KEY');
  }

  get model(): string {
    return this.config.get('GEMINI_MODEL');
  }

  /**
   * Returns the model's reply parsed as JSON. The schema guides the model but isn't a guarantee: validate the result.
   * Counts against `userId`'s daily AI limit and the app's (AiQuotaError when either is used up).
   */
  async generateJson(input: {
    system: string;
    prompt: string;
    schema: object;
    userId: string;
  }): Promise<unknown> {
    const key = this.config.get('GEMINI_API_KEY');
    if (!key) throw new AiUnavailableError('GEMINI_API_KEY is not set');
    await this.quota.consume(input.userId);

    let res: Response;
    try {
      res = await fetch(`${ENDPOINT}/${encodeURIComponent(this.model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseJsonSchema: input.schema,
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new AiUnavailableError(`Gemini request failed: ${String(err)}`);
    }

    if (res.status === 429) throw new AiBusyError('Gemini rate limit or quota reached');
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 500);
      throw new AiUnavailableError(`Gemini returned ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GenerateContentResponse;
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
      ?.filter((p) => !p.thought)
      .map((p) => p.text ?? '')
      .join('');
    if (!text) {
      const reason = data.promptFeedback?.blockReason ?? candidate?.finishReason ?? 'no candidates';
      throw new AiUnavailableError(`Gemini returned no content (${reason})`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AiUnavailableError(
        `Gemini returned invalid JSON (${candidate?.finishReason ?? 'unknown'})`,
      );
    }
  }
}
