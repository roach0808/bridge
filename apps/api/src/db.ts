import { Prisma, PrismaClient } from '@prisma/client';
import { config } from './config';

export const prisma = new PrismaClient({
  datasourceUrl: config.DATABASE_URL,
  log: config.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  // Interactive transactions run several round trips; a hosted database (e.g. Aiven)
  // adds latency to each, so the 5s Prisma default is too tight.
  transactionOptions: { maxWait: 10_000, timeout: 20_000 },
});

export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;
