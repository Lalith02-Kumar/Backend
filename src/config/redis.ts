import Redis from 'ioredis';
import { env } from './env';
import { logger } from '../utils/logger';

export const redisClient = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    if (times > 3) {
      return null;
    }
    return Math.min(times * 500, 3000);
  },
  lazyConnect: true,
});

redisClient.on('error', (err) => logger.error({ err: err.message }, 'Redis Client Error'));

