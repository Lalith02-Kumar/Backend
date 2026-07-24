import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { env } from './config/env';
import { logger } from './utils/logger';
import { prisma } from './lib/prisma';
import { redis } from './lib/redis';
import { initQueues } from './queues';
import { runGeminiDiagnostic } from './lib/gemini';

// Initialize BullMQ workers & Gemini AI Diagnostic
initQueues().catch((err) => {
  logger.error('Failed to initialize queues', err);
});

runGeminiDiagnostic().catch((err) => {
  logger.warn({ err: err?.message || err }, 'Gemini startup diagnostic completed with warning');
});

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server running in ${env.NODE_ENV} mode on port ${env.PORT}`);
});

const gracefulShutdown = async (signal: string) => {
  logger.info(`\n${signal} received. Shutting down gracefully...`);
  
  server.close(async () => {
    logger.info('HTTP server closed.');
    await prisma.$disconnect();
    logger.info('Database disconnected.');
    try {
      await redis.quit();
      logger.info('Redis disconnected.');
    } catch (e) {
      // Redis may already be disconnected
    }
    process.exit(0);
  });

  setTimeout(() => {
    logger.error('Forcefully shutting down due to timeout.');
    process.exit(1);
  }, 10000);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
