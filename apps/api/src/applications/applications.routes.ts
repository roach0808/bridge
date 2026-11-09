import { applicationSchema, applicationsQuerySchema, displayZoneFor, ERROR_CODES, type ApplicationBoard, type ApplicationCell } from '@god/shared';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { fromDateOnly, idParam, isoOrNull, param, parseBody, parseQuery } from '../http';
import { visibleProfilesWhere } from '../profiles/profiles.routes';
import { canEditProfilePlatforms, platformRefOrder, platformRefSelect, toUserRef, userRefSelect } from '../serializers';

/**
 * The project applications board (§6.19). Each day the team enters, for every
 * Profile they handle and every platform it is registered on, how many projects
 * it applied for. A day nobody filled in stays "not updated" — no row — which is
 * not the same as zero.
 */
export const applicationsRouter = Router();
applicationsRouter.use('/applications', requireAuth);

const todayFor = (actor: Actor) => DateTime.now().setZone(displayZoneFor(actor)).toISODate()!;

/** Approved Profiles that are in use, in the viewer's scope: the Founder all, a team its own. */
const boardProfilesWhere = (actor: Actor) => ({ AND: [visibleProfilesWhere(actor), { status: 'approved' as const, isActive: true }] });

applicationsRouter.get('/applications', requireRole('founder', 'manager', 'associate'), async (req, res) => {
  const actor = actorOf(req);
  const { date: asked } = parseQuery(applicationsQuerySchema, req);
  const today = todayFor(actor);
  const date = asked ?? today;
  const [platforms, profiles] = await Promise.all([
    prisma.platform.findMany({ select: platformRefSelect, orderBy: platformRefOrder }),
    prisma.profile.findMany({
      where: boardProfilesWhere(actor),
      select: {
        id: true,
        name: true,
        avatarId: true,
        photoId: true,
        manager: { select: userRefSelect },
        platformStatuses: { select: { platformId: true, status: true } },
        applications: { where: { date: fromDateOnly(date) }, select: { platformId: true, applied: true, updatedAt: true, updatedBy: { select: userRefSelect } } },
      },
      orderBy: { name: 'asc' },
    }),
  ]);
  const body: ApplicationBoard = {
    zone: displayZoneFor(actor),
    date,
    today,
    canEdit: canEditProfilePlatforms(actor),
    platforms,
    rows: profiles.map((p) => ({
      profile: { id: p.id, name: p.name, avatarId: p.avatarId, photoId: p.photoId },
      manager: p.manager ? toUserRef(p.manager) : null,
      cells: platforms.map((platform): ApplicationCell => {
        const entry = p.applications.find((a) => a.platformId === platform.id);
        return {
          status: p.platformStatuses.find((s) => s.platformId === platform.id)?.status ?? 'not_registered',
          applied: entry?.applied ?? null,
          updatedBy: entry?.updatedBy ? toUserRef(entry.updatedBy) : null,
          updatedAt: isoOrNull(entry?.updatedAt ?? null),
        };
      }),
    })),
  };
  res.json(body);
});

/**
 * Sets how many projects a Profile applied for on a platform on a day, or clears
 * it back to "not updated" (null). The Founder and the team handling the Profile;
 * only where it is registered, and never for a day still to come.
 */
applicationsRouter.put(
  '/profiles/:id/platforms/:platformId/applications/:date',
  requireAuth,
  requireRole('founder', 'manager', 'associate'),
  async (req, res) => {
    const actor = actorOf(req);
    if (!canEditProfilePlatforms(actor)) throw forbidden('Experts cannot record applications');
    const date = param(req, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !DateTime.fromISO(date).isValid) throw badRequest('The day must be in yyyy-mm-dd form');
    if (date > todayFor(actor)) throw badRequest('That day has not come yet');
    const { applied } = parseBody(applicationSchema, req);
    const profileId = idParam(req);
    const platformId = idParam(req, 'platformId');
    const profile = profileId && (await prisma.profile.findFirst({ where: { AND: [{ id: profileId }, boardProfilesWhere(actor)] }, select: { id: true } }));
    if (!profile) throw notFound('Profile');
    const platform = platformId && (await prisma.platform.findUnique({ where: { id: platformId }, select: { id: true } }));
    if (!platform) throw notFound('Platform');
    const standing = await prisma.profilePlatformStatus.findUnique({ where: { profileId_platformId: { profileId: profile.id, platformId: platform.id } }, select: { status: true } });
    const status = standing?.status ?? 'not_registered';
    const key = { profileId_platformId_date: { profileId: profile.id, platformId: platform.id, date: fromDateOnly(date) } };
    if (applied === null) {
      await prisma.projectApplication.deleteMany({ where: { profileId: profile.id, platformId: platform.id, date: fromDateOnly(date) } });
      const cell: ApplicationCell = { status, applied: null, updatedBy: null, updatedAt: null };
      res.json(cell);
      return;
    }
    if (status !== 'registered') throw conflict('The profile is not registered on this platform', ERROR_CODES.notRegistered);
    const saved = await prisma.projectApplication.upsert({
      where: key,
      create: { profileId: profile.id, platformId: platform.id, date: fromDateOnly(date), applied, updatedById: actor.id },
      update: { applied, updatedById: actor.id },
      select: { applied: true, updatedAt: true, updatedBy: { select: userRefSelect } },
    });
    const cell: ApplicationCell = { status, applied: saved.applied, updatedBy: saved.updatedBy ? toUserRef(saved.updatedBy) : null, updatedAt: isoOrNull(saved.updatedAt) };
    res.json(cell);
  },
);
