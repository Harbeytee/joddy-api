import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../prisma/prisma.service';
import { toPublicUser, type PublicUser } from '../users/users.mapper';
import type { LoginDto, RegisterDto } from './dto/auth.dto';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface ClientInfo {
  userAgent?: string;
  ip?: string;
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const REUSE_GRACE_MS = 30_000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async register(dto: RegisterDto, client: ClientInfo) {
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('An account with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: await argon2.hash(dto.password),
        agentSettings: { create: {} },
      },
    });
    return { user: toPublicUser(user), tokens: await this.issueTokens(user, client) };
  }

  async login(dto: LoginDto, client: ClientInfo) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    // Verify against a dummy hash when the user is missing so timing doesn't reveal which emails exist.
    const valid = user
      ? await argon2.verify(user.passwordHash, dto.password)
      : await argon2.verify(await this.dummyHash(), dto.password).then(() => false);
    if (!user || !valid) throw new UnauthorizedException('Incorrect email or password');

    return { user: toPublicUser(user), tokens: await this.issueTokens(user, client) };
  }

  /** Rotates the refresh token. Reusing an already-rotated token revokes every session for that user. */
  async refresh(refreshToken: string | undefined, client: ClientInfo) {
    if (!refreshToken) throw new UnauthorizedException('Not signed in');

    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!session) throw new UnauthorizedException('Session expired');

    if (session.revokedAt) {
      // Two tabs refreshing at once is normal; only treat older reuse as token theft.
      const isConcurrentRefresh = Date.now() - session.revokedAt.getTime() < REUSE_GRACE_MS;
      if (!isConcurrentRefresh) {
        await this.prisma.session.updateMany({
          where: { userId: session.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedException('Session expired');
    }
    if (session.expiresAt < new Date()) throw new UnauthorizedException('Session expired');

    await this.prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    return {
      user: toPublicUser(session.user),
      tokens: await this.issueTokens(session.user, client),
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.session.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('Account no longer exists');
    return toPublicUser(user);
  }

  private async issueTokens(
    user: { id: string; email: string },
    client: ClientInfo,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get('JWT_ACCESS_TTL') as `${number}m`,
      },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshExpiresAt = new Date(
      Date.now() + this.config.get('JWT_REFRESH_TTL_DAYS') * 86_400_000,
    );
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: client.userAgent?.slice(0, 500),
        ip: client.ip,
      },
    });

    return { accessToken, refreshToken, refreshExpiresAt };
  }

  private dummyHashPromise?: Promise<string>;
  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= argon2.hash(randomBytes(16).toString('hex'));
    return this.dummyHashPromise;
  }
}
