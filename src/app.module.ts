import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [OrdersModule,
    AuthModule,
    HealthModule,
    ProductsModule,],
})
export class AppModule { }