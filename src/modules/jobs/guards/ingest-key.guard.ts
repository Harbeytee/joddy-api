import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '../../../config/app-config.service';

/** Machine-to-machine auth for the scraper, via the x-ingest-key header. */
@Injectable()
export class IngestKeyGuard implements CanActivate {
  constructor(private readonly config: AppConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const provided = context.switchToHttp().getRequest<Request>().header('x-ingest-key') ?? '';
    const expected = this.config.get('INGEST_API_KEY');
    const a = Buffer.from(provided);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException('Invalid ingest key');
    }
    return true;
  }
}
