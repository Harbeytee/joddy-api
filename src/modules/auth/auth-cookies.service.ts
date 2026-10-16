import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import type { IssuedTokens } from './auth.service';
import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from './auth.constants';

@Injectable()
export class AuthCookiesService {
  constructor(private readonly config: AppConfigService) {}

  set(res: Response, tokens: IssuedTokens): void {
    // The cookie outlives the short-lived JWT inside it, so @OptionalAuth routes see an expired
    // token (401, client refreshes) rather than no token (served as a guest).
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...this.base(),
      path: '/',
      expires: tokens.refreshExpiresAt,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...this.base(),
      path: REFRESH_COOKIE_PATH,
      expires: tokens.refreshExpiresAt,
    });
  }

  clear(res: Response): void {
    res.clearCookie(ACCESS_COOKIE, { ...this.base(), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.base(), path: REFRESH_COOKIE_PATH });
  }

  private base(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'lax',
      domain: this.config.get('COOKIE_DOMAIN'),
    };
  }
}
