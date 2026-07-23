import Redis from 'ioredis';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
  if (!redisClient) {
    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = new Redis(url, {
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

    redisClient.on('connect', () => logger.info('✅ Redis connected'));
    redisClient.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
  }
  return redisClient;
}

export const redis = getRedis();
