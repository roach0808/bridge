import { createServer } from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { logger } from './logger';
import { createSocketServer } from './realtime/socket';

const app = createApp();
const server = createServer(app);
const io = createSocketServer(server);

server.listen(config.PORT, config.HOST, () => {
  logger.info(`God System API listening on http://${config.HOST}:${config.PORT}`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, 'shutting down');
  io.close();
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
