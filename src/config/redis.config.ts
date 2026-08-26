import { RedisOptions } from 'ioredis';

export function buildRedisOptions(): RedisOptions {
    return {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
        // Batches commands issued in the same tick into one round trip; this is
        // the single biggest Redis win under high concurrency.
        enableAutoPipelining: true,
        maxRetriesPerRequest: null,
        lazyConnect: false,
    };
}