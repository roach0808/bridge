import { randomUUID } from 'node:crypto';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { auditRequests } from './audit/audit';
import { auditRouter } from './audit/audit.routes';
import { authRouter } from './auth/auth.routes';
import { avatarsRouter } from './avatars/avatars.routes';
import { banksRouter } from './banks/banks.routes';
import { calendarRouter } from './calendar/calendar.routes';
import { callsRouter } from './calls/calls.routes';
import { chatRouter } from './chat/chat.routes';
import { dumpsRouter } from './backup/dumps.routes';
import { presenceRouter } from './presence/presence.routes';
import { config } from './config';
import { dashboardRouter } from './dashboard/dashboard.routes';
import { financeRouter } from './finance/finance.routes';
import { prisma } from './db';
import { errorHandler, notFoundHandler } from './errors';
import { camelizeBody } from './http';
import { logger } from './logger';
import { notificationsRouter } from './notifications/notifications.routes';
import { photosRouter } from './photos/photos.routes';
import { platformsRouter } from './platforms/platforms.routes';
import { profilesRouter } from './profiles/profiles.routes';
import { statsRouter } from './stats/stats.routes';
import { usersRouter } from './users/users.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url === '/healthz' || /\/(avatars|photos)\//.test(req.url ?? '') },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || config.CORS_ORIGINS.includes(origin)),
      credentials: true,
      exposedHeaders: ['X-Unread-Count', 'X-Request-Id'],
    }),
  );
  // Chat pictures (up to 1 MB, base64-encoded) are the largest bodies.
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());
  app.use(camelizeBody);

  app.get('/healthz', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ status: 'ok', db: 'ok', uptime: Math.round(process.uptime()) });
    } catch {
      res.status(503).json({ status: 'degraded', db: 'unreachable' });
    }
  });

  const api = Router();
  // Records changes and sensitive reads once each response is known.
  api.use(auditRequests);
  api.use(authRouter);
  api.use(avatarsRouter);
  api.use(usersRouter);
  api.use(platformsRouter);
  api.use(photosRouter);
  api.use(banksRouter);
  api.use(profilesRouter);
  api.use(callsRouter);
  api.use(financeRouter);
  api.use(chatRouter);
  api.use(presenceRouter);
  api.use(dumpsRouter);
  api.use(calendarRouter);
  api.use(notificationsRouter);
  api.use(dashboardRouter);
  api.use(statsRouter);
  api.use(auditRouter);
  app.use('/api/v1', api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
