import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { getEnvNumber } from './config/env.utils';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['error', 'warn'] },
  );
  
  app.setGlobalPrefix('api/v1');

  const port = getEnvNumber('PORT');
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
