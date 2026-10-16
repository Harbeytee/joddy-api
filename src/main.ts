import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';
import { API_PREFIX, setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.useBodyParser('json', { limit: '25mb' });
  setupApp(app);

  const config = app.get(AppConfigService);
  if (!config.isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('Joddy API')
      .setVersion('1.0')
      .addCookieAuth('joddy_at')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));
  }

  await app.listen(config.get('PORT'));
  app.get(Logger).log(`Joddy API listening on :${config.get('PORT')}/${API_PREFIX}`);
}

void bootstrap();
