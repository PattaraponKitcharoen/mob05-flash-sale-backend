import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { Order } from '../entities/order.entity';
import { Product } from '../entities/product.entity';

import { getEnv, getEnvNumber } from './env.utils';

export function buildTypeOrmOptions(): TypeOrmModuleOptions {
  return {
    type: 'postgres',
    host: getEnv('DB_HOST'),
    port: getEnvNumber('DB_PORT'),
    username: getEnv('DB_USER'),
    password: getEnv('DB_PASS'),
    database: getEnv('DB_NAME'),
    entities: [Product, Order],
    // Schema is created once by the seed container, never by the API pods.
    synchronize: false,
    logging: false,
    extra: {
      // An oversized pool makes Postgres slower, not faster: it just adds
      // context switching. 20 per container across 6 containers = 120 conns.
      max: getEnvNumber('DB_POOL_MAX'),
      min: 2,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    },
  };
}
