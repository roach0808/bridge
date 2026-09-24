import { listAuditQuerySchema, type AuditEntryDTO, type Paginated } from '@god/shared';
import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { actorOf, requireAuth, requireRole } from '../auth/middleware';
import { isOwner } from '../auth/owner';
import { prisma } from '../db';
import { iso, parseQuery } from '../http';

export const auditRouter = Router();

// The trail is the Founder's: it names who did what, across everyone.
auditRouter.use('/audit', requireAuth, requireRole('founder'));

/**
 * Email addresses are never returned by the API (§ anonymity). A failed
 * sign-in keeps the attempted address in the database; the Founder sees it
 * shortened, which is enough to recognise it.
 */
function maskEmails(meta: AuditEntryDTO['meta']): AuditEntryDTO['meta'] {
  if (!meta || typeof meta.email !== 'string') return meta;
  const [name = '', domain = ''] = meta.email.split('@');
  return { ...meta, email: `${name.slice(0, 2)}***@${domain}` };
}

type AuditRow = Prisma.AuditLogGetPayload<{ include: { device: { select: { label: true } } } }>;

/** `showDevice`: only the owner is told which browser an action came from. */
const toDTO = (a: AuditRow, showDevice: boolean): AuditEntryDTO => ({
  id: a.id,
  userId: a.userId,
  actorName: a.actorName,
  actorRole: a.actorRole,
  action: a.action,
  summary: a.summary,
  entityType: a.entityType,
  entityId: a.entityId,
  method: a.method,
  path: a.path,
  statusCode: a.statusCode,
  ip: a.ip,
  country: a.country,
  deviceType: a.deviceType,
  device: showDevice ? (a.device?.label ?? null) : null,
  meta: maskEmails((a.meta as AuditEntryDTO['meta']) ?? null),
  createdAt: iso(a.createdAt),
});

auditRouter.get('/audit', async (req, res) => {
  const { userId, action, from, to, q, page, pageSize } = parseQuery(listAuditQuerySchema, req);
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      userId ? { userId } : {},
      // `action` filters by family: `call` matches `call.transition`, `call.update`…
      action ? { action: { startsWith: action } } : {},
      from ? { createdAt: { gte: new Date(from) } } : {},
      to ? { createdAt: { lt: new Date(to) } } : {},
      q
        ? {
            OR: [
              { summary: { contains: q, mode: 'insensitive' } },
              { actorName: { contains: q, mode: 'insensitive' } },
              { path: { contains: q, mode: 'insensitive' } },
              { action: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {},
    ],
  };
  const [total, rows, showDevice] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { device: { select: { label: true } } },
    }),
    isOwner(actorOf(req).id),
  ]);
  const body: Paginated<AuditEntryDTO> = { items: rows.map((r) => toDTO(r, showDevice)), page, pageSize, total };
  res.json(body);
});

/** The distinct action names in the trail, for the filter menu. */
auditRouter.get('/audit/actions', async (_req, res) => {
  const rows = await prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } });
  res.json([...new Set(rows.map((r) => r.action.split('.').slice(0, 2).join('.')))]);
});
