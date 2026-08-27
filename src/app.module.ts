import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrdersModule } from './orders/orders.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [OrdersModule, 
            AuthModule,
            HealthModule,
            ProductsModule,],
  controllers: [AppController],
  providers: [AppService],
  
  
})
export class AppModule {}
