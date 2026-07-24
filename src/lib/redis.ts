import Redis from 'ioredis';
import { logger } from '../utils/logger';

const createRedisClient = (): Redis => {
  const url = process.env.REDIS_URL || 'redis://default:WPfXajl1bdEu6QN7K2p6ELmRTttGSa2s@liquid-iced-branch-55187.db.redis.io:15593';

  try {
    const parsedUrl = new URL(url);
    const maskedUrl = `${parsedUrl.protocol}//${parsedUrl.username ? parsedUrl.username + ':****@' : ''}${parsedUrl.hostname}:${parsedUrl.port}`;
    logger.info({
      REDIS_URL: maskedUrl,
      host: parsedUrl.hostname,
      port: parsedUrl.port || '6379',
      protocol: parsedUrl.protocol.replace(':', ''),
      NODE_ENV: process.env.NODE_ENV || 'development',
    }, '🔌 Initializing Redis Client');
  } catch (e) {
    logger.warn('Failed to parse REDIS_URL string for startup debug logging');
  }
  
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

  client.on('connect', async () => {
    logger.info('✅ Redis connected');
    try {
      const ping = await client.ping();
      const clientId = await client.client('ID');
      const dbSize = await client.dbsize();
      logger.info({ ping, clientId, dbSize }, '📊 Active Redis Connection Verified');
    } catch (err: any) {
      logger.error({ err: err.message }, '❌ Redis post-connect verification failed');
    }
  });

  client.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

  return client;
};

const globalForRedis = globalThis as unknown as { redisClient: Redis };

export const redis = globalForRedis.redisClient || createRedisClient();

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redisClient = redis;
}
