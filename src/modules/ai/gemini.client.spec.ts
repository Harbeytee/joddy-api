import type { AppConfigService } from '../../config/app-config.service';
import { AiBusyError, AiQuotaError, AiUnavailableError } from './ai-errors';
import type { AiQuotaService } from './ai-quota.service';
import { GeminiClient } from './gemini.client';

// Unit tests can't load Nest's ES modules.
jest.mock('@nestjs/common', () => ({ Injectable: () => () => undefined }));
jest.mock('../../config/app-config.service', () => ({ AppConfigService: class {} }));
jest.mock('./ai-quota.service', () => ({ AiQuotaService: class {} }));

const config = (key?: string) =>
  ({
    get: (name: string) => ({ GEMINI_API_KEY: key, GEMINI_MODEL: 'gemini-3.5-flash-lite' })[name],
  }) as unknown as AppConfigService;

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

const answer = (text: string, extra: object = {}) => ({
  candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }],
});

describe('GeminiClient', () => {
  const fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
  const consume = jest.fn<Promise<void>, [string]>();
  const quota = { consume } as unknown as AiQuotaService;
  const client = (key?: string) => new GeminiClient(config(key), quota);
  const input = {
    system: 'You turn requests into filters.',
    prompt: 'remote nurse jobs',
    schema: { type: 'object' },
    userId: 'user-1',
  };

  beforeEach(() => {
    fetchMock.mockReset();
    consume.mockReset().mockResolvedValue(undefined);
    global.fetch = fetchMock;
  });

  it('is off without a key and never calls the API or counts usage', async () => {
    const off = client();
    expect(off.enabled).toBe(false);
    await expect(off.generateJson(input)).rejects.toBeInstanceOf(AiUnavailableError);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
  });

  it("counts each call against the user's daily limit, and stops when it's reached", async () => {
    fetchMock.mockResolvedValue(reply(200, answer('{}')));
    await client('k').generateJson(input);
    expect(consume).toHaveBeenCalledWith('user-1');

    consume.mockRejectedValueOnce(new AiQuotaError('user'));
    await expect(client('k').generateJson(input)).rejects.toBeInstanceOf(AiQuotaError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('asks for structured JSON, sending the key in a header rather than the URL', async () => {
    fetchMock.mockResolvedValue(reply(200, answer('{"title":["nurse"]}')));
    await expect(client('test-key').generateJson(input)).resolves.toEqual({ title: ['nurse'] });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    );
    expect(init?.headers).toMatchObject({ 'x-goog-api-key': 'test-key' });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init?.body as string)).toEqual({
      systemInstruction: { parts: [{ text: input.system }] },
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: input.schema },
    });
  });

  it('ignores thought parts and joins the rest', async () => {
    fetchMock.mockResolvedValue(
      reply(200, {
        candidates: [
          {
            content: {
              parts: [{ text: 'thinking…', thought: true }, { text: '{"a":' }, { text: '1}' }],
            },
          },
        ],
      }),
    );
    await expect(client('k').generateJson(input)).resolves.toEqual({ a: 1 });
  });

  it('reports rate limits separately from other failures', async () => {
    const gemini = client('k');
    fetchMock.mockResolvedValueOnce(reply(429, { error: { message: 'Quota exceeded' } }));
    await expect(gemini.generateJson(input)).rejects.toBeInstanceOf(AiBusyError);

    fetchMock.mockResolvedValueOnce(reply(400, { error: { message: 'API key not valid' } }));
    await expect(gemini.generateJson(input)).rejects.toThrow(/400.*API key not valid/);

    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    await expect(gemini.generateJson(input)).rejects.toBeInstanceOf(AiUnavailableError);
  });

  it('fails cleanly on blocked, empty or malformed replies', async () => {
    const gemini = client('k');
    fetchMock.mockResolvedValueOnce(reply(200, { promptFeedback: { blockReason: 'SAFETY' } }));
    await expect(gemini.generateJson(input)).rejects.toThrow(/SAFETY/);

    fetchMock.mockResolvedValueOnce(
      reply(200, answer('{"title": [', { finishReason: 'MAX_TOKENS' })),
    );
    await expect(gemini.generateJson(input)).rejects.toThrow(/invalid JSON \(MAX_TOKENS\)/);
  });
});
