import {
  BadRequestException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AiBusyError, AiQuotaError, AiUnavailableError } from '../../ai/ai-errors';
import type { GeminiClient } from '../../ai/gemini.client';
import { ResumeAiService } from './resume-ai.service';

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
  BadRequestException: class BadRequestException extends Error {},
  ServiceUnavailableException: class ServiceUnavailableException extends Error {},
  UnprocessableEntityException: class UnprocessableEntityException extends Error {},
}));
jest.mock('../../ai/gemini.client', () => ({ GeminiClient: class {} }));

const ANSWER = {
  suggestions: [
    { style: 'polished', text: 'Built the new checkout flow\nCut page load time' },
    { style: 'concise', text: 'Built checkout\nFaster pages' },
  ],
};

function setup(reply: () => Promise<unknown>, enabled = true) {
  const generateJson = jest.fn(reply);
  const gemini = { enabled, model: 'test-model', generateJson } as unknown as GeminiClient;
  return { service: new ResumeAiService(gemini), generateJson };
}

const USER = 'user-1';

describe('ResumeAiService', () => {
  const input = {
    field: 'highlights' as const,
    text: 'built the checkout\nmade pages load faster',
    context: { position: 'Engineer', company: 'Monzo' },
  };

  it('returns both suggestions, sending the field rules and context', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER));
    await expect(service.refine(USER, input)).resolves.toEqual({
      suggestions: ANSWER.suggestions,
    });
    const [{ system, prompt, userId }] = generateJson.mock.calls[0] as unknown as [
      { system: string; prompt: string; userId: string },
    ];
    expect(userId).toBe(USER);
    expect(system).toContain('bullet points under one job');
    expect(prompt).toContain('Role: Engineer at Monzo');
    expect(prompt).toContain('built the checkout');
  });

  it('reuses the answer for the same text', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER));
    await service.refine(USER, input);
    await service.refine(USER, { ...input, text: `  ${input.text} ` });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it('is unavailable without a key and never calls Gemini', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER), false);
    await expect(service.refine(USER, input)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('rejects text longer than the field allows', async () => {
    const { service, generateJson } = setup(() => Promise.resolve(ANSWER));
    await expect(
      service.refine(USER, { field: 'education', text: 'x'.repeat(2001) }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.refine(USER, { ...input, text: 'x'.repeat(301), maxLength: 300 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(generateJson).not.toHaveBeenCalled();
  });

  it('says so when there is nothing better to suggest', async () => {
    const { service } = setup(() => Promise.resolve({ suggestions: [] }));
    await expect(service.refine(USER, input)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('turns Gemini failures into messages for users', async () => {
    const busy = setup(() => Promise.reject(new AiBusyError('quota')));
    await expect(busy.service.refine(USER, input)).rejects.toThrow('busy');
    const down = setup(() => Promise.reject(new AiUnavailableError('500 from Gemini')));
    await expect(down.service.refine(USER, input)).rejects.toThrow('aren’t available');
  });

  it("explains when the user's or the app's daily AI limit is used up", async () => {
    const mine = setup(() => Promise.reject(new AiQuotaError('user')));
    await expect(mine.service.refine(USER, input)).rejects.toMatchObject({ status: 429 });
    const everyone = setup(() => Promise.reject(new AiQuotaError('all')));
    await expect(everyone.service.refine(USER, input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
