import Redis from 'ioredis';
import { logger } from '../utils/logger';

const createRedisClient = (): Redis => {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    // Upstash requires TLS — ioredis auto-detects from rediss:// but we ensure it
    ...(url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}),
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 500, 3000);
    },
  });

  client.on('connect', () => logger.info('✅ Redis connected'));
  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

  return client;
};

const globalForRedis = globalThis as unknown as { redisClient: Redis };

export const redis = globalForRedis.redisClient || createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redisClient = redis;
}
