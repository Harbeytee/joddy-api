import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthCookiesService } from './auth-cookies.service';
import { REFRESH_COOKIE } from './auth.constants';
import { AuthService, type ClientInfo } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';

const clientInfo = (req: Request): ClientInfo => ({
  userAgent: req.headers['user-agent'],
  ip: req.ip,
});

const refreshTokenOf = (req: Request): string | undefined =>
  (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];

@ApiTags('auth')
@Controller('auth')
@Throttle({ default: { limit: 10, ttl: 60_000 } })
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Public()
  @Post('register')
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.register(dto, clientInfo(req));
    this.cookies.set(res, tokens);
    return user;
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { user, tokens } = await this.auth.login(dto, clientInfo(req));
    this.cookies.set(res, tokens);
    return user;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const { user, tokens } = await this.auth.refresh(refreshTokenOf(req), clientInfo(req));
      this.cookies.set(res, tokens);
      return user;
    } catch (err) {
      this.cookies.clear(res);
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(refreshTokenOf(req));
    this.cookies.clear(res);
  }

  /** Called on every page load, so it can't share the credential endpoints' tight limit. */
  @Get('me')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
