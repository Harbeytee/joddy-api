import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client';

/** Maps known Prisma errors to HTTP responses instead of leaking 500s. */
@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const map: Record<string, [HttpStatus, string]> = {
      P2002: [HttpStatus.CONFLICT, 'A record with these details already exists'],
      P2003: [HttpStatus.BAD_REQUEST, 'Referenced record does not exist'],
      P2025: [HttpStatus.NOT_FOUND, 'Record not found'],
    };
    const [status, message] = map[exception.code] ?? [
      HttpStatus.INTERNAL_SERVER_ERROR,
      'Internal server error',
    ];
    if (status === HttpStatus.INTERNAL_SERVER_ERROR) this.logger.error(exception);
    res.status(status).json({ statusCode: status, message });
  }
}
