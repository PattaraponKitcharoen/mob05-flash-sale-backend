import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
import { RedisService } from '../redis/redis.service';

@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    private readonly redis: RedisService,
  ) {}

  @Get('health')
  @HealthCheck()
  async healthCheck() {
    const result = await this.health.check([
      () => this.db.pingCheck('database'),
      async (): Promise<HealthIndicatorResult> => {
        try {
          await this.redis.client.ping();
          return { redis: { status: 'up' } };
        } catch (e: any) {
          throw new HealthCheckError('Redis check failed', {
            redis: { status: 'down', message: e.message },
          });
        }
      },
    ]);
    return {
      ...result,
      instance: process.env.HOSTNAME ?? 'local',
    };
  }

  /** Cache hit / miss ratio for the report's observability section. */
  @Get('metrics/cache')
  cache() {
    return this.redis.cacheStats();
  }

  @Get('metrics/cache/reset')
  async reset() {
    await this.redis.client.del(
      RedisService.CACHE_HIT_KEY,
      RedisService.CACHE_MISS_KEY,
    );
    return { status: 'success' };
  }
}
