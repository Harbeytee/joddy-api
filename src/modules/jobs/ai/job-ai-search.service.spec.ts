import { ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { AiBusyError, AiQuotaError, AiUnavailableError } from '../../ai/ai-errors';
import type { GeminiClient } from '../../ai/gemini.client';
import { JobAiSearchService } from './job-ai-search.service';

// Unit tests can't load Nest's ES modules; these stand-ins cover what the service uses.
jest.mock('@nestjs/common', () => ({
  HttpException: class HttpException extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  },
  HttpStatus: { TOO_MANY_REQUESTS: 429 },
  Injectable: () => () => undefined,
  Logger: class {
    warn() {}
    error() {}
  },
  ServiceUnavailableException: class ServiceUnavailableException extends Error {},
  UnprocessableEntityException: class UnprocessableEntityException extends Error {},
}));
jest.mock('../../ai/gemini.client', () => ({ GeminiClient: class {} }));

const ANSWER = {
  title: ['nurse', 'nursing'],
  company: null,
  country: ['GB'],
  region: [],
  workplaceType: [],
  jobType: ['PART_TIME'],
  seniority: [],
  postedWithinDays: null,
  salaryMin: null,
  salaryMax: null,
  hasSalary: false,
  summary: 'Part-time nursing jobs in the UK',
};

function setup(reply: () => Promise<unknown>, enabled = true) {
  const generateJson = jest.fn(reply);
  const gemini = { enabled, model: 'test-model', generateJson } as unknown as GeminiClient;
  return { service: new JobAiSearchService(gemini), generateJson };
}

const USER = 'user-1';

describe('JobAiSearchService', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('turns a prompt into filters, passing the date and country to the model', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER));
    await expect(
      service.interpret(USER, 'part time nursing jobs near me', 'GB', now),
    ).resolves.toMatchObject({
      title: ['nurse', 'nursing'],
      country: ['GB'],
      jobType: ['PART_TIME'],
      summary: 'Part-time nursing jobs in the UK',
    });
    const [{ system, prompt, userId }] = generateJson.mock.calls[0] as unknown as [
      { system: string; prompt: string; userId: string },
    ];
    expect(userId).toBe(USER);
    expect(prompt).toBe('part time nursing jobs near me');
    expect(system).toContain('Today is 2026-10-18');
    expect(system).toContain("The user's country is GB");
  });

  it('answers the same prompt from cache on the same day', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER));
    await service.interpret(USER, 'Part time  nursing', 'GB', now);
    await service.interpret(USER, 'part time nursing ', 'GB', now);
    expect(generateJson).toHaveBeenCalledTimes(1);
    await service.interpret(USER, 'part time nursing', 'NG', now);
    await service.interpret(USER, 'part time nursing', 'GB', new Date('2026-10-19T12:00:00Z'));
    expect(generateJson).toHaveBeenCalledTimes(3);
  });

  it('falls back to the prompt when the model gives no summary', async () => {
    const { service } = setup(() => Promise.resolve({ ...ANSWER, summary: '' }));
    await expect(
      service.interpret(USER, 'nursing in the UK', undefined, now),
    ).resolves.toMatchObject({
      summary: 'nursing in the UK',
    });
  });

  it('rejects prompts that are not job searches, without caching them', async () => {
    const { service, generateJson } = setup(() =>
      Promise.resolve({ title: [], summary: 'A poem about cats' }),
    );
    await expect(service.interpret(USER, 'write me a poem', undefined, now)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.interpret(USER, 'write me a poem', undefined, now)).rejects.toThrow();
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it('says AI search is unavailable when no key is set, without calling Gemini', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER), false);
    await expect(service.interpret(USER, 'nursing', undefined, now)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('turns Gemini failures into messages for users', async () => {
    const busy = setup(() => Promise.reject(new AiBusyError('quota')));
    await expect(busy.service.interpret(USER, 'nursing', undefined, now)).rejects.toThrow(/busy/);

    const down = setup(() =>
      Promise.reject(new AiUnavailableError('Gemini returned 500: secret details')),
    );
    const error = await down.service
      .interpret(USER, 'nursing', undefined, now)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect((error as Error).message).not.toContain('secret details');
  });

  it("explains when the user's or the app's daily AI limit is used up", async () => {
    const mine = setup(() => Promise.reject(new AiQuotaError('user')));
    const error = await mine.service
      .interpret(USER, 'nursing', undefined, now)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 429,
      message: expect.stringContaining('today’s limit') as string,
    });

    const everyone = setup(() => Promise.reject(new AiQuotaError('all')));
    await expect(
      everyone.service.interpret(USER, 'nursing', undefined, now),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
