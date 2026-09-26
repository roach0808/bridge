import {
  TEAM_TIME_ZONE,
  isAvatarForAudience,
  listProfilesQuerySchema,
  profileActiveSchema,
  profileAssociateSchema,
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
  canAssignProfile,
  canEditProfile,
  canEditProfilePlatforms,
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
  // Deleted Profiles are gone for everyone; only their past calls still name them.
  if (actor.role === 'founder') return { deletedAt: null };
  if (actor.role === 'expert') return { deletedAt: null, isActive: true, calls: { some: { expertId: actor.id } } };
  const own: Prisma.ProfileWhereInput[] = [{ createdById: actor.id }, { associateId: actor.id }];
  if (actor.role === 'manager') own.push({ createdBy: { managerId: actor.id } }, { associate: { managerId: actor.id } });
  return { deletedAt: null, isActive: true, OR: [{ status: 'approved' }, ...own] };
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
  res.json(profiles.map((p) => toProfileDTO(p, platforms, actor)));
});

profilesRouter.get('/profiles/:id', async (req, res) => {
  const actor = actorOf(req);
  res.json(toProfileDTO(await loadVisible(actor, idParam(req)), await platformsFor(actor), actor));
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
        // Whoever adds a Profile looks after it, until someone hands it on.
        associateId: isFounder ? null : actor.id,
        ...(isFounder && input.managerSharePercent !== undefined ? { managerSharePercent: input.managerSharePercent } : {}),
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
  res.status(201).json(toProfileDTO(profile, await platformRefs(), actor));
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
  if (!canEditProfile(actor)) throw forbidden('Experts cannot change a profile');
  /**
   * An edit to a Profile still waiting on review, or one that was turned down,
   * puts it back in the queue. An approved Profile stays approved: keeping its
   * details current is the team's job, and sending it back would take it out of
   * use for calls over a corrected phone number.
   */
  const resubmit = !isFounder && profile.status !== 'approved';
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
        // Only the Founder decides the Manager's share.
        managerSharePercent: isFounder ? input.managerSharePercent : undefined,
        ...(resubmit ? { status: 'pending', reviewedById: null, reviewedAt: null, rejectionReason: null } : {}),
      },
      include: includeFor(actor),
    });
    const deliver = resubmit ? await notifyFounders(tx, actor, updated, true) : () => {};
    return { updated, deliver };
  });
  deliver();
  res.json(toProfileDTO(updated, await platformsFor(actor), actor));
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
  return toProfileDTO(updated, await platformRefs(), actor);
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
  res.json(toProfileDTO(updated, await platformRefs(), actor));
});

/**
 * Founder deletes a Profile. Without calls it is removed entirely. With past calls, its
 * personal details, banks and addresses are erased and it leaves every list, while its
 * calls and income stay under a removed name. Unfinished calls block it.
 */
profilesRouter.delete('/profiles/:id', requireRole('founder'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  const [open, total] = await Promise.all([
    prisma.call.count({
      where: { profileId: profile.id, status: { notIn: ['finished', 'invoice_submit', 'invoice_approve', 'process_to_bank', 'cancelled'] } },
    }),
    prisma.call.count({ where: { profileId: profile.id } }),
  ]);
  if (open) throw conflict(`“${profile.name}” still has ${open} call${open === 1 ? '' : 's'} to finish or move to another Profile`);

  await prisma.$transaction(async (tx) => {
    if (total === 0) {
      // Banks, addresses and platform statuses go with it (cascade).
      await tx.profile.delete({ where: { id: profile.id } });
    } else {
      await tx.profileBank.deleteMany({ where: { profileId: profile.id } });
      await tx.profileAddress.deleteMany({ where: { profileId: profile.id } });
      await tx.profile.update({
        where: { id: profile.id },
        data: {
          deletedAt: new Date(),
          isActive: false,
          name: 'Removed profile',
          linkedinUrl: null,
          briefExperience: '',
          dateOfBirth: null,
          gender: null,
          nationality: null,
          location: null,
          education: null,
          careerHistory: null,
          currentAddress: null,
          email: null,
          phone: null,
          photoId: null,
        },
      });
    }
    if (profile.photoId) await tx.photo.deleteMany({ where: { id: profile.photoId } });
  });
  res.status(204).end();
});

/**
 * A Profile's standing on one platform: the Founder, the Associate looking after
 * it and that Associate's Manager set it. The rate is the Founder's alone; a call
 * cannot be invoiced without one (409 rate_required).
 */
profilesRouter.put('/profiles/:id/platforms/:platformId', requireRole('founder', 'manager', 'associate'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  if (!canEditProfilePlatforms(actor, profile.associate)) {
    throw forbidden('Only the Founder, or the Associate looking after this profile and their Manager, set its platforms');
  }
  const platformId = idParam(req, 'platformId');
  const platform = platformId && (await prisma.platform.findUnique({ where: { id: platformId }, select: { id: true } }));
  if (!platform) throw notFound('Platform');
  const { status, rate } = parseBody(profilePlatformStatusSchema, req);
  if (rate !== undefined && actor.role !== 'founder') throw forbidden('Only the Founder sets a profile’s rate');
  await prisma.profilePlatformStatus.upsert({
    where: { profileId_platformId: { profileId: profile.id, platformId: platform.id } },
    create: { profileId: profile.id, platformId: platform.id, status: status ?? 'not_registered', rate: rate ?? null },
    update: { status, rate },
  });
  res.json(toProfileDTO(await loadVisible(actor, profile.id), await platformsFor(actor), actor));
});

/**
 * Hands the Profile to the Associate (or Manager) who looks after it from now on.
 * The Founder chooses anyone; a Manager moves a Profile their team looks after
 * (or nobody does yet) between themselves and their own Associates.
 */
profilesRouter.put('/profiles/:id/associate', requireRole('founder', 'manager'), async (req, res) => {
  const actor = actorOf(req);
  const profile = await loadVisible(actor, idParam(req));
  const { associateId } = parseBody(profileAssociateSchema, req);
  if (!canAssignProfile(actor, profile.associate)) {
    throw forbidden('Only the Founder, or the Manager of the team looking after it, can hand this profile on');
  }
  if (associateId !== null) {
    const next = await prisma.user.findUnique({
      where: { id: associateId },
      select: { id: true, role: true, managerId: true, isActive: true, deletedAt: true },
    });
    if (!next || !next.isActive || next.deletedAt || (next.role !== 'associate' && next.role !== 'manager')) {
      throw badRequest('Choose an active Associate or Manager', { issues: [{ path: 'associateId', message: 'Not an active Associate or Manager' }] });
    }
    if (actor.role === 'manager' && next.id !== actor.id && next.managerId !== actor.id) {
      throw forbidden('Managers hand profiles to themselves or to Associates on their own team');
    }
  } else if (actor.role !== 'founder') {
    throw forbidden('Only the Founder leaves a profile without an Associate');
  }
  const updated = await prisma.profile.update({
    where: { id: profile.id },
    data: { associateId },
    include: includeFor(actor),
  });
  res.json(toProfileDTO(updated, await platformsFor(actor), actor));
});

profilesRouter.post('/profiles/:id/approve', requireRole('founder'), async (req, res) => {
  res.json(await review(actorOf(req), idParam(req), 'approved'));
});

profilesRouter.post('/profiles/:id/reject', requireRole('founder'), async (req, res) => {
  const { reason } = parseBody(rejectProfileSchema, req);
  res.json(await review(actorOf(req), idParam(req), 'rejected', reason));
});
