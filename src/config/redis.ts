// Re-export the canonical Redis client from lib/redis
// This ensures a single shared Redis connection across the app
import { redis } from '../lib/redis';
export const redisClient = redis;
