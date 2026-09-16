import { Router } from 'express';
import { actorOf, requireAuth, requireRole } from '../auth/middleware';
import { notFound } from '../errors';
import { idParam } from '../http';
import { logger } from '../logger';
import { createDump, listDumps, readDump } from './dumps';

export const dumpsRouter = Router();
dumpsRouter.use('/db-dumps', requireAuth, requireRole('founder'));

dumpsRouter.get('/db-dumps', async (_req, res) => {
  res.json(await listDumps());
});

/** "Run now" from the Founder dashboard. */
dumpsRouter.post('/db-dumps', async (req, res) => {
  logger.info({ userId: actorOf(req).id }, 'manual database dump requested');
  res.status(201).json(await createDump('manual'));
});

dumpsRouter.get('/db-dumps/:id/download', async (req, res) => {
  const id = idParam(req);
  const dump = id ? await readDump(id) : null;
  if (!dump?.data) throw notFound('Dump');
  const date = dump.createdAt.toISOString().replace(/[:.]/g, '-');
  res.setHeader('Content-Type', 'application/gzip');
  res.setHeader('Content-Disposition', `attachment; filename="god-dump-${date}.json.gz"`);
  res.send(Buffer.from(dump.data));
});
