import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { corsOptions, trustProxy } from './http-config';
import { setupSwagger } from './swagger';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', trustProxy(process.env));
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors(corsOptions(process.env));
  const docs = setupSwagger(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Listening on port ${port}${docs ? `; API docs at /api/docs` : ''}`, 'Bootstrap');
}

bootstrap();
