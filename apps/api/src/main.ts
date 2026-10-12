import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { APP_CONFIG, AppConfig } from './core/config/app-config';
import { requestId } from './core/errors/request-id.middleware';

/** Settings shared by the running server and the tests. */
export function configureApp(app: INestApplication): void {
  app.use(requestId);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Dubai Real Estate CRM API')
    .setVersion('1.2.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  return SwaggerModule.createDocument(app, config);
}

async function bootstrap(): Promise<void> {
  // rawBody: webhook signatures are checked over the exact bytes received.
  const app = await NestFactory.create(AppModule, { rawBody: true });
  configureApp(app);
  const config = app.get<AppConfig>(APP_CONFIG);
  if (config.NODE_ENV !== 'production') SwaggerModule.setup('api/docs', app, buildOpenApi(app));
  await app.listen(config.PORT);
}

if (require.main === module) void bootstrap();
