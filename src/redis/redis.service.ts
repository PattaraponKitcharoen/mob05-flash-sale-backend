import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { buildRedisOptions } from '../config/redis.config';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  /**
   * Push-based mirror of products:ver.
   *
   * Reading the version from Redis on every request would double the round
   * trips on the hottest path in the system. Instead the worker publishes
   * each bump and every API instance keeps a local copy, with a one second
   * poll as a safety net in case a message is ever missed.
   */
  private cachedVersion = '1';
  private subscriber?: Redis;
  private refreshTimer?: NodeJS.Timeout;

  constructor() {
    this.client = new Redis(buildRedisOptions());
  }

  static readonly VERSION_KEY = 'products:ver';
  static readonly VERSION_CHANNEL = 'products:ver:changed';
  static readonly CACHE_HIT_KEY = 'metrics:cache:hit';
  static readonly CACHE_MISS_KEY = 'metrics:cache:miss';

  async onModuleInit() {
    await this.client.set(RedisService.VERSION_KEY, '1', 'NX');
    await this.syncVersion();

    this.subscriber = new Redis(buildRedisOptions());
    await this.subscriber.subscribe(RedisService.VERSION_CHANNEL);
    this.subscriber.on('message', (_channel, message) => {
      if (message) this.cachedVersion = message;
    });

    this.refreshTimer = setInterval(() => {
      void this.syncVersion();
    }, 1000);
    this.refreshTimer.unref();
  }

  private async syncVersion() {
    const v = await this.client.get(RedisService.VERSION_KEY);
    if (v !== null) this.cachedVersion = v;
  }

  /**
   * Cache invalidation by version bump: O(1), and it never runs KEYS/SCAN,
   * which would block Redis for every other request in flight. Stale entries
   * simply fall out on their own TTL because nothing reads the old version.
   */
  async bumpProductsVersion(): Promise<number> {
    const next = await this.client.incr(RedisService.VERSION_KEY);
    await this.client.publish(RedisService.VERSION_CHANNEL, String(next));
    return next;
  }

  /** Local, allocation-free read of the current cache generation. */
  productsVersion(): string {
    return this.cachedVersion;
  }

  async cacheStats() {
    const [hit, miss] = await this.client.mget(
      RedisService.CACHE_HIT_KEY,
      RedisService.CACHE_MISS_KEY,
    );
    const h = Number(hit ?? 0);
    const m = Number(miss ?? 0);
    const total = h + m;
    return {
      hits: h,
      misses: m,
      total,
      hitRatio: total === 0 ? 0 : Number(((h / total) * 100).toFixed(2)),
    };
  }

  async onModuleDestroy() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    await this.subscriber?.quit().catch(() => undefined);
    await this.client.quit().catch(() => undefined);
  }
}
