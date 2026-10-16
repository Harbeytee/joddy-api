import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { ACCESS_COOKIE } from '../../modules/auth/auth.constants';
import type { AuthenticatedRequest } from '../decorators/current-user.decorator';
import { IS_OPTIONAL_AUTH_KEY, IS_PUBLIC_KEY } from '../decorators/public.decorator';

interface AccessPayload {
  sub: string;
  email: string;
}

/** Global guard: every route needs a valid access token unless marked @Public() or @OptionalAuth(). */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    const isOptional = this.reflector.getAllAndOverride<boolean>(IS_OPTIONAL_AUTH_KEY, targets);

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(req);
    if (!token) {
      if (isOptional) return true;
      throw new UnauthorizedException('Not signed in');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessPayload>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET'),
      });
      req.user = { id: payload.sub, email: payload.email };
      return true;
    } catch {
      throw new UnauthorizedException('Session expired');
    }
  }
}

function extractToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const [scheme, value] = req.headers.authorization?.split(' ') ?? [];
  return scheme === 'Bearer' ? value : undefined;
}
