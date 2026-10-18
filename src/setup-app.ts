import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppConfigService } from './config/app-config.service';

export const API_PREFIX = 'api/v1';

/** Larger request bodies allowed under these paths; everything else gets DEFAULT_BODY_LIMIT. */
const BODY_LIMITS: [path: string, limit: string][] = [
  ['jobs/ingest', '25mb'], // the scraper's job batches
  ['resumes', '5mb'], // a resume filled to every field's maximum
];
const DEFAULT_BODY_LIMIT = '1mb';

/** The app's middleware and pipes. Create the app with `bodyParser: false`: request bodies are parsed here. */
export function setupApp(app: INestApplication): void {
  const config = app.get(AppConfigService);

  (app as NestExpressApplication).set('trust proxy', 1);
  app.setGlobalPrefix(API_PREFIX);
  app.use(helmet());
  app.use(compression());
  app.use(cookieParser());
  for (const [path, limit] of BODY_LIMITS) app.use(`/${API_PREFIX}/${path}`, json({ limit }));
  app.use(json({ limit: DEFAULT_BODY_LIMIT }));
  app.use(urlencoded({ extended: true, limit: DEFAULT_BODY_LIMIT }));
  app.enableCors({
    origin: config.get('CORS_ORIGINS'),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableShutdownHooks();
}
