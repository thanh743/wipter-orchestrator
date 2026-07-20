import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const corsOrigins = config.get<string>('CORS_ORIGIN')?.split(',').map((origin) => origin.trim()).filter(Boolean)
    ?? ['http://localhost:5173', 'http://127.0.0.1:5173'];
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableShutdownHooks();
  await app.listen(config.get<number>('APP_PORT', 4000), config.get<string>('APP_HOST', '0.0.0.0'));
}

void bootstrap();
