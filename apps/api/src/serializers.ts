import type { Prisma } from '@prisma/client';
import { BLOCKING_STATUSES, statusForRole } from '@god/shared';
import type {
  MeDTO,
  MessageDTO,
  PlatformDTO,
  ProfileDTO,
  Role,
  StatusHistoryDTO,
  UserDTO,
  UserRef,
} from '@god/shared';
import { dateOnly, iso, isoOrNull } from './http';

/** The only user columns ever selected for display about someone else. */
export const userRefSelect = {
  id: true,
  nickname: true,
  role: true,
  avatarId: true,
  photoId: true,
} satisfies Prisma.UserSelect;

export type UserRefRow = Prisma.UserGetPayload<{ select: typeof userRefSelect }>;

export const toUserRef = (u: UserRefRow): UserRef => ({
  id: u.id,
  nickname: u.nickname,
  role: u.role as Role,
  avatarId: u.avatarId,
  photoId: u.photoId,
});

export const userSelect = {
  ...userRefSelect,
  managerId: true,
  isActive: true,
  timeZone: true,
  hourlyRate: true,
  sharePercent: true,
  createdAt: true,
  updatedAt: true,
  manager: { select: userRefSelect },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/**
 * What someone is paid is shown to the Founder, who sets it, and to the person
 * themselves; an Associate's share also to their own Manager, who sets it too.
 */
export const toUserDTO = (u: UserRow, viewer: { id: string; role: Role }): UserDTO => {
  const all = viewer.role === 'founder' || viewer.id === u.id;
  const ownManager = viewer.role === 'manager' && u.managerId === viewer.id;
  return {
    ...toUserRef(u),
    managerId: u.managerId,
    manager: u.manager ? toUserRef(u.manager) : null,
    isActive: u.isActive,
    timeZone: u.timeZone,
    hourlyRate: all && u.hourlyRate !== null ? Number(u.hourlyRate) : null,
    sharePercent: (all || ownManager) && u.sharePercent !== null ? Number(u.sharePercent) : null,
    createdAt: iso(u.createdAt),
    updatedAt: iso(u.updatedAt),
  };
};

export const meSelect = { ...userSelect, email: true } satisfies Prisma.UserSelect;
export type MeRow = Prisma.UserGetPayload<{ select: typeof meSelect }>;
export const toMeDTO = (u: MeRow): MeDTO => ({ ...toUserDTO(u, { id: u.id, role: u.role as Role }), email: u.email });

export const toPlatformDTO = (p: Prisma.PlatformGetPayload<object>): PlatformDTO => ({
  id: p.id,
  name: p.name,
  url: p.url,
  priority: p.priority,
  country: p.country,
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
});

export const profileInclude = {
  createdBy: { select: userRefSelect },
  associate: { select: { ...userRefSelect, managerId: true, manager: { select: userRefSelect } } },
  reviewedBy: { select: userRefSelect },
  platformStatuses: { select: { platformId: true, status: true, rate: true } },
} satisfies Prisma.ProfileInclude;

export const platformRefSelect = { id: true, name: true, priority: true } satisfies Prisma.PlatformSelect;
export type PlatformRef = Prisma.PlatformGetPayload<{ select: typeof platformRefSelect }>;
export const platformRefOrder = [{ priority: 'asc' }, { name: 'asc' }] satisfies Prisma.PlatformOrderByWithRelationInput[];

export type ProfileRow = Prisma.ProfileGetPayload<{ include: typeof profileInclude }>;

/**
 * The Manager a Profile sits under. A Manager who looks after a Profile himself
 * is its Manager; otherwise it is the Associate's own Manager, and a Profile
 * nobody looks after has none.
 */
const managerOf = (associate: ProfileRow['associate']): UserRef | null =>
  !associate ? null
  : associate.role === 'manager' ? toUserRef(associate)
  : associate.manager ? toUserRef(associate.manager)
  : null;

/** Relation counts only the Founder receives (bank data is Founder-only). */
export const profileFounderCounts = {
  addresses: { select: { id: true, label: true, address: true }, orderBy: { sortOrder: 'asc' } },
  _count: {
    select: {
      banks: { where: { isActive: true } },
      calls: { where: { status: { in: [...BLOCKING_STATUSES] } } },
    },
  },
} satisfies Prisma.ProfileInclude;

type ProfileCounts = {
  _count?: { banks: number; calls: number };
  addresses?: Array<{ id: string; label: string; address: string }>;
};

/**
 * Who may hand a Profile to another Associate: the Founder, and a Manager for a
 * Profile their own team looks after (or that nobody looks after yet).
 */
export function canAssignProfile(
  viewer: { id: string; role: Role },
  associate: { id: string; managerId: string | null } | null,
): boolean {
  if (viewer.role === 'founder') return true;
  if (viewer.role !== 'manager') return false;
  return associate === null || associate.id === viewer.id || associate.managerId === viewer.id;
}

/**
 * Who may set a Profile's status on the platforms: the Founder, the Associate
 * looking after it, and the Manager of that Associate's team (§6.4).
 */
export function canEditProfilePlatforms(
  viewer: { id: string; role: Role },
  associate: { id: string; managerId: string | null } | null,
): boolean {
  if (viewer.role === 'founder') return true;
  if (viewer.role === 'associate') return associate?.id === viewer.id;
  if (viewer.role === 'manager') return associate !== null && (associate.id === viewer.id || associate.managerId === viewer.id);
  return false;
}

/**
 * `platforms` lists every platform for viewers who may see platform statuses;
 * pass null for Experts, who only get the personal details. Rates are for the
 * Founder and Managers: an Associate never sees what a Profile earns.
 */
export const toProfileDTO = (
  p: ProfileRow & ProfileCounts,
  platforms: PlatformRef[] | null,
  viewer: { id: string; role: Role },
): ProfileDTO => ({
  id: p.id,
  name: p.name,
  linkedinUrl: p.linkedinUrl,
  briefExperience: p.briefExperience,
  dateOfBirth: p.dateOfBirth ? dateOnly(p.dateOfBirth) : null,
  gender: p.gender,
  nationality: p.nationality,
  location: p.location,
  education: p.education,
  careerHistory: p.careerHistory,
  // Experts get no platforms, and no contact details either.
  email: platforms ? p.email : null,
  phone: platforms ? p.phone : null,
  onboardedAt: platforms && p.onboardedAt ? dateOnly(p.onboardedAt) : null,
  // Addresses are only loaded for the Founder (see profileFounderCounts).
  addresses: p.addresses ?? null,
  avatarId: p.avatarId,
  photoId: p.photoId,
  status: p.status,
  isActive: p.isActive,
  platformStatuses: platforms
    ? platforms.map((platform) => {
        const row = p.platformStatuses.find((s) => s.platformId === platform.id);
        return {
          platform,
          status: row?.status ?? 'not_registered',
          rate: row?.rate == null || viewer.role === 'associate' ? null : Number(row.rate),
        };
      })
    : null,
  bankCount: p._count ? p._count.banks : null,
  needsBank: p._count ? p._count.calls > 0 && p._count.banks === 0 : null,
  associate: platforms && p.associate ? toUserRef(p.associate) : null,
  manager: platforms ? managerOf(p.associate) : null,
  canAssign: canAssignProfile(viewer, p.associate),
  canEditPlatforms: Boolean(platforms) && canEditProfilePlatforms(viewer, p.associate),
  managerSharePercent: viewer.role === 'founder' || viewer.role === 'manager' ? Number(p.managerSharePercent) : null,
  createdBy: toUserRef(p.createdBy),
  reviewedBy: p.reviewedBy ? toUserRef(p.reviewedBy) : null,
  reviewedAt: isoOrNull(p.reviewedAt),
  rejectionReason: p.rejectionReason,
  createdAt: iso(p.createdAt),
  updatedAt: iso(p.updatedAt),
});

export const messageInclude = { sender: { select: userRefSelect } } satisfies Prisma.MessageInclude;
export type MessageRow = Prisma.MessageGetPayload<{ include: typeof messageInclude }>;
export const toMessageDTO = (m: MessageRow): MessageDTO => ({
  id: m.id,
  callId: m.callId,
  sender: toUserRef(m.sender),
  body: m.body,
  createdAt: iso(m.createdAt),
});

export const historyInclude = { actor: { select: userRefSelect } } satisfies Prisma.CallStatusHistoryInclude;
export type HistoryRow = Prisma.CallStatusHistoryGetPayload<{ include: typeof historyInclude }>;
/** A history row as the viewer's role sees its statuses (rows ending in a hidden step are left out upstream). */
export const toHistoryDTO = (h: HistoryRow, role: Role): StatusHistoryDTO => ({
  id: h.id,
  callId: h.callId,
  fromStatus: h.fromStatus === null ? null : statusForRole(role, h.fromStatus),
  toStatus: statusForRole(role, h.toStatus),
  actor: toUserRef(h.actor),
  isOverride: h.isOverride,
  comment: h.comment,
  createdAt: iso(h.createdAt),
});
