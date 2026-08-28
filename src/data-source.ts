import { DataSource } from 'typeorm';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import 'dotenv/config';

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  username: process.env.DB_USER ?? 'admin',
  password: process.env.DB_PASS ?? 'password',
  database: process.env.DB_NAME ?? 'flashsale',
  entities: [Product, Order],
  migrations: [__dirname + '/migrations/*.ts'],
  synchronize: false,
});
