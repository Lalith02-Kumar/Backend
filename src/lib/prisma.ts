import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

const createPrismaClient = () => {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  client.$on('error', (e: any) => {
    logger.error('Prisma error', e);
  });

  client.$on('warn', (e: any) => {
    logger.warn('Prisma warning', { message: e?.message });
  });

  return client.$extends({
    query: {
      user: {
        async findUnique({ args, query }) {
          args.where = { ...args.where, isActive: true };
          return query(args);
        },
        async findFirst({ args, query }) {
          args.where = { ...args.where, isActive: true };
          return query(args);
        },
        async findMany({ args, query }) {
          args.where = { ...args.where, isActive: true };
          return query(args);
        }
      }
    }
  });
};

const globalForPrisma = globalThis as unknown as { prisma: ReturnType<typeof createPrismaClient> };

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

