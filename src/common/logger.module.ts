import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '../config/app-config.service';

/** Pino logging shared by the API and the apply worker. */
export const AppLoggerModule = LoggerModule.forRootAsync({
  inject: [AppConfigService],
  useFactory: (config: AppConfigService) => ({
    pinoHttp: {
      level: config.get('LOG_LEVEL'),
      transport: config.isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-ingest-key"]',
        'res.headers["set-cookie"]',
      ],
      autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
    },
  }),
});
