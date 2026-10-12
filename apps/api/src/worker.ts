import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { QueueService } from './core/queue/queue.service';

// Worker start mode (architecture §2): same code as the API, runs background jobs and schedules instead of HTTP.
async function bootstrap(): Promise<void> {
  process.env.APP_MODE = 'worker';
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  await app.get(QueueService).startWorker();
}

void bootstrap();
