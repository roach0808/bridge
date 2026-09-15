import { platformSchema, updatePlatformSchema } from '@god/shared';
import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware';
import { prisma } from '../db';
import { notFound } from '../errors';
import { idParam, parseBody } from '../http';
import { toPlatformDTO } from '../serializers';

export const platformsRouter = Router();
platformsRouter.use('/platforms', requireAuth);

platformsRouter.get('/platforms', async (_req, res) => {
  const platforms = await prisma.platform.findMany({ orderBy: [{ priority: 'asc' }, { name: 'asc' }] });
  res.json(platforms.map(toPlatformDTO));
});

platformsRouter.post('/platforms', requireRole('founder', 'manager'), async (req, res) => {
  const input = parseBody(platformSchema, req);
  const platform = await prisma.platform.create({ data: input });
  res.status(201).json(toPlatformDTO(platform));
});

platformsRouter.patch('/platforms/:id', requireRole('founder', 'manager'), async (req, res) => {
  const id = idParam(req);
  if (!id) throw notFound('Platform');
  const input = parseBody(updatePlatformSchema, req);
  const platform = await prisma.platform.update({ where: { id }, data: input });
  res.json(toPlatformDTO(platform));
});
