import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

import { getEnv } from '../config/env.utils';

@Global()
@Module({
  imports: [
    JwtModule.register({
      global: true,
      secret: getEnv('JWT_SECRET'),
      signOptions: {
        algorithm: 'HS256',
        // @nestjs/jwt types expiresIn as a ms template literal; the value
        // comes from the environment, so widen it once here.
        expiresIn: getEnv('JWT_EXPIRES_IN') as unknown as number,
      },
    }),
  ],
  controllers: [AuthController],
  providers: [JwtAuthGuard],
  exports: [JwtAuthGuard, JwtModule],
})
export class AuthModule { }
