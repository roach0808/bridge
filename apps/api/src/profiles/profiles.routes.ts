import {
  TEAM_TIME_ZONE,
  isAvatarForAudience,
  listProfilesQuerySchema,
  profileActiveSchema,
  profilePlatformStatusSchema,
  profileSchema,
  rejectProfileSchema,
  updateProfileSchema,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { Router } from 'express';
import { DateTime } from 'luxon';
import { actorOf, requireAuth, requireRole, type Actor } from '../auth/middleware';
import { prisma, type Tx } from '../db';
import { badRequest, conflict, forbidden, notFound } from '../errors';
import { fromDateOnly, idParam, parseBody, parseQuery } from '../http';
import { notify } from '../notifications/notify';
import {
  platformRefOrder,
  platformRefSelect,
  profileFounderCounts,
  profileInclude,
  toProfileDTO,
  type PlatformRef,
} from '../serializers';

export const profilesRouter = Router();

/** Bank counts are Founder-only data (§ banks). */
const includeFor = (actor: Pick<Actor, 'role'>) =>
  (actor.role === 'founder' ? { ...profileInclude, ...profileFounderCounts } : profileInclude) as typeof profileInclude;
profilesRouter.use('/profiles', requireAuth);

export const platformRefs = () => prisma.platform.findMany({ select: platformRefSelect, orderBy: platformRefOrder });

/** Experts see personal details only; everyone else also sees platform statuses. */
const platformsFor = (actor: Pick<Actor, 'role'>): Promise<PlatformRef[] | null> =>
  actor.role === 'expert' ? Promise.resolve(null) : platformRefs();

/**
 * Approved profiles are shared. Pending and rejected ones are visible to the
 * Founder, the author, and the author's Manager (§6.4). Experts see only the
 * profiles of calls they are assigned to.
 */
function visibleProfilesWhere(actor: Actor): Prisma.ProfileWhereInput {
  // Deactivated Profiles are the Founder's business only.
  if (actor.role === 'founder') return {};
  if (actor.role === 'expert') return { isActive: true, calls: { some: { expertId: actor.id } } };
  const own: Prisma.ProfileWhereInput[] = [{ createdById: actor.id }];
  if (actor.role === 'manager') own.push({ createdBy: { managerId: actor.id } });
  return { isActive: true, OR: [{ status: 'approved' }, ...own] };
}

async function loadVisible(actor: Actor, id: string | null) {
  if (!id) throw notFound('Profile');
  const profile = await prisma.profile.findFirst({
    where: { AND: [{ id }, visibleProfilesWhere(actor)] },
    include: includeFor(actor),
  });
  if (!profile) throw notFound('Profile');
  return profile;
}

function assertProfileAvatar(avatarId: string | undefined) {
  if (avatarId !== undefined && !isAvatarForAudience(avatarId, 'profile')) {
    throw badRequest('Choose an avatar from the profile set', { issues: [{ path: 'avatarId', message: 'Wrong avatar set' }] });
  }
}

profilesRouter.get('/profiles', async (req, res) => {
  const actor = actorOf(req);
  const { q, status } = parseQuery(listProfilesQuerySchema, req);
  const profiles = await prisma.profile.findMany({
    where: {
      AND: [
        visibleProfilesWhere(actor),
        status ? { status } : {},
        q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { briefExperience: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
      ],
    },
    include: includeFor(actor),
    orderBy: [{ status: 'asc' }, { name: 'asc' }],
  });
  const platforms = await platformsFor(actor);
  res.json(profiles.map((p) => toProfileDTO(p, platforms)));
});

profilesRouter.get('/profiles/:id', async (req, res) => {
  const actor = actorOf(req);
  res.json(toProfileDTO(await loadVisible(actor, idParam(req)), await platformsFor(actor)));
});

const addressRows = (list: Array<{ label: string; address: string }>) =>
  list.map((a, i) => ({ label: a.label, address: a.address, sortOrder: i }));

/** Today's date in team time, as a date-only value. */
const teamToday = () => fromDateOnly(DateTime.now().setZone(TEAM_TIME_ZONE).toISODate()!);

/** Tells every active Founder that a profile is waiting for review. */
async function notifyFounders(tx: Tx, actor: Actor, profile: { id: string; name: string }, resubmitted: boolean) {
  const founders = await tx.user.findMany({ where: { role: 'founder', isActive: true }, select: { id: true } });
  return notify(tx, founders.map((f) => f.id), 'profile.submitted', {
    profileId: profile.id,
    actor: { nickname: actor.nickname, role: actor.role },
    summary: `Profile “${profile.name}” was ${resubmitted ? 'resubmitted' : 'submitted'} for review`,
  });
}

/** The Founder's profiles are approved at once; an Associate's or Manager's wait for a Founder's review. */
profilesRouter.post('/profiles', requireRole('founder', 'manager', 'associate'), async (req, res) => {
  const actor = actorOf(req);
  const input = parseBody(profileSchema, req);
  assertProfileAvatar(input.avatarId);
  const isFounder = actor.role === 'founder';
  const now = new Date();
  const { profile, deliver } = await prisma.$transaction(async (tx) => {
    const profile = await tx.profile.create({
      data: {
        name: input.name,
        linkedinUrl: input.linkedinUrl ?? null,
        briefExperience: input.briefExperience,
        ...personalDetails(input, actor),
        avatarId: input.avatarId,
        createdById: actor.id,
        ...(isFounder
          ? {
              status: 'approved',
              reviewedById: actor.id,
              reviewedAt: now,
              onboardedAt: input.onboardedAt ? fromDateOnly(input.onboardedAt) : teamToday(),
              ...(input.addresses ? { addresses: { create: addressRows(input.addresses) } } : {}),
            }
          : { status: 'pending' }),
      },
      include: includeFor(actor),
    });
    const deliver = isFounder ? () => {} : await notifyFounders(tx, actor, profile, false);
    return { profile, deliver };
  });
  deliver();
  res.status(201).json(toProfileDTO(profile, await platformRefs()));
});

function personalDetails(input: Partial<z.output<typeof profileSchema>>, actor: Pick<Actor, 'role'>) {
  const founder = actor.role === 'founder';
  return {
    email: input.email,
    phone: input.phone,
    // Only the Founder decides the onboard date; anyone else's value is ignored.
    onboardedAt: !founder || input.onboardedAt === undefined ? undefined : input.onboardedAt && fromDateOnly(input.onboardedAt),
    dateOfBirth: input.dateOfBirth === undefined ? undefined : input.dateOfBirth && fromDateOnly(input.dateOfBirth),
    gender: input.gender,
    nationality: input.nationality,
    location: input.location,
    education: input.education,
    careerHistory: input.careerHistory,
  };
}

profilesRouter.patch('/profiles/:id', async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  const input = parseBody(updateProfileSchema, req);
  assertProfileAvatar(input.avatarId);

  const isFounder = actor.role === 'founder';
  if (!isFounder && profile.createdById !== actor.id) {
    throw forbidden('Only the Founder edits profiles');
  }
  if (!isFounder && profile.status === 'approved') {
    throw forbidden('Only the Founder edits approved profiles');
  }
  const { updated, deliver } = await prisma.$transaction(async (tx) => {
    // The list is replaced as a whole, keeping the order it was sent in.
    if (isFounder && input.addresses) {
      await tx.profileAddress.deleteMany({ where: { profileId: profile.id } });
      await tx.profileAddress.createMany({ data: addressRows(input.addresses).map((a) => ({ ...a, profileId: profile.id })) });
    }
    const updated = await tx.profile.update({
      where: { id: profile.id },
      data: {
        name: input.name,
        linkedinUrl: input.linkedinUrl === undefined ? undefined : input.linkedinUrl,
        briefExperience: input.briefExperience,
        ...personalDetails(input, actor),
        avatarId: input.avatarId,
        // An author's edit sends their submission back for review.
        ...(isFounder ? {} : { status: 'pending', reviewedById: null, reviewedAt: null, rejectionReason: null }),
      },
      include: includeFor(actor),
    });
    const deliver = isFounder ? () => {} : await notifyFounders(tx, actor, updated, true);
    return { updated, deliver };
  });
  deliver();
  res.json(toProfileDTO(updated, await platformsFor(actor)));
});

async function review(actor: Actor, id: string | null, decision: 'approved' | 'rejected', reason?: string) {
  const profile = await loadVisible(actor, id);
  if (profile.status !== 'pending') throw conflict('Only pending profiles can be reviewed');
  const { updated, deliver } = await prisma.$transaction(async (tx) => {
    const updated = await tx.profile.update({
      where: { id: profile.id },
      data: {
        status: decision,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        rejectionReason: decision === 'rejected' ? reason : null,
        // Approval is when a Profile is onboarded, unless the Founder already set a date.
        ...(decision === 'approved' && !profile.onboardedAt ? { onboardedAt: teamToday() } : {}),
      },
      include: includeFor(actor),
    });
    const deliver =
      profile.createdById === actor.id
        ? () => {}
        : await notify(tx, [profile.createdById], decision === 'approved' ? 'profile.approved' : 'profile.rejected', {
            profileId: profile.id,
            actor: { nickname: actor.nickname, role: actor.role },
            summary: `Profile “${profile.name}” was ${decision}${reason ? `: ${reason}` : ''}`,
          });
    return { updated, deliver };
  });
  deliver();
  return toProfileDTO(updated, await platformRefs());
}

/** Founder deactivates a Profile (hidden from everyone else, and unbookable) or brings it back. */
profilesRouter.patch('/profiles/:id/active', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  const { isActive } = parseBody(profileActiveSchema, req);
  const updated = await prisma.profile.update({
    where: { id: profile.id },
    data: { isActive },
    include: includeFor(actor),
  });
  res.json(toProfileDTO(updated, await platformRefs()));
});

/** Founder sets a profile's standing and rate on one platform. */
profilesRouter.put('/profiles/:id/platforms/:platformId', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  const platformId = idParam(req, 'platformId');
  const platform = platformId && (await prisma.platform.findUnique({ where: { id: platformId }, select: { id: true } }));
  if (!platform) throw notFound('Platform');
  const { status, rate } = parseBody(profilePlatformStatusSchema, req);
  const existing = await prisma.profilePlatformStatus.findUnique({
    where: { profileId_platformId: { profileId: profile.id, platformId: platform.id } },
    select: { status: true, rate: true },
  });
  // A registered Profile must have a rate; it stays editable afterwards.
  const nextStatus = status ?? existing?.status ?? 'not_registered';
  const nextRate = rate !== undefined ? rate : (existing?.rate ?? null);
  if (nextStatus === 'registered' && nextRate === null) {
    throw badRequest('Set the hourly rate to mark this profile registered', {
      issues: [{ path: 'rate', message: 'A rate is required once registered (you can change it later)' }],
    });
  }
  await prisma.profilePlatformStatus.upsert({
    where: { profileId_platformId: { profileId: profile.id, platformId: platform.id } },
    create: { profileId: profile.id, platformId: platform.id, status: nextStatus, rate: nextRate },
    update: { status, rate },
  });
  res.json(toProfileDTO(await loadVisible(actor, profile.id), await platformRefs()));
});

profilesRouter.post('/profiles/:id/approve', requireRole('founder'), async (req, res) => {
  res.json(await review(actorOf(req), idParam(req), 'approved'));
});

profilesRouter.post('/profiles/:id/reject', requireRole('founder'), async (req, res) => {
  const { reason } = parseBody(rejectProfileSchema, req);
  res.json(await review(actorOf(req), idParam(req), 'rejected', reason));
});
