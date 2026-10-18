/** Gemini can't be used: no key, network failure, bad reply. Details are for logs, not users. */
export class AiUnavailableError extends Error {}

/** Gemini refused for now because the project hit its rate limit or daily quota. */
export class AiBusyError extends Error {}

/** Our own daily cap was reached before calling Gemini: this user's (`user`) or the whole app's (`all`). */
export class AiQuotaError extends Error {
  constructor(readonly scope: 'user' | 'all') {
    super(scope === 'user' ? 'User daily AI limit reached' : 'App daily AI limit reached');
  }
}
