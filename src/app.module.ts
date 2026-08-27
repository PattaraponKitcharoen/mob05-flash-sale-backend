import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildBullConnection } from './config/redis.config';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { HealthModule } from './health/health.module';
import { RedisModule } from './redis/redis.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot(buildTypeOrmOptions()),
    BullModule.forRoot({ connection: buildBullConnection() }),
    RedisModule,
    OrdersModule,
    AuthModule,
    HealthModule,
    ProductsModule
  ],
})
export class AppModule { }