import type { Prisma } from '@prisma/client';
import { BLOCKING_STATUSES } from '@god/shared';
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
  createdAt: true,
  updatedAt: true,
  manager: { select: userRefSelect },
} satisfies Prisma.UserSelect;

export type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

export const toUserDTO = (u: UserRow): UserDTO => ({
  ...toUserRef(u),
  managerId: u.managerId,
  manager: u.manager ? toUserRef(u.manager) : null,
  isActive: u.isActive,
  timeZone: u.timeZone,
  createdAt: iso(u.createdAt),
  updatedAt: iso(u.updatedAt),
});

export const meSelect = { ...userSelect, email: true } satisfies Prisma.UserSelect;
export type MeRow = Prisma.UserGetPayload<{ select: typeof meSelect }>;
export const toMeDTO = (u: MeRow): MeDTO => ({ ...toUserDTO(u), email: u.email });

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
  reviewedBy: { select: userRefSelect },
  platformStatuses: { select: { platformId: true, status: true, rate: true } },
} satisfies Prisma.ProfileInclude;

export const platformRefSelect = { id: true, name: true, priority: true } satisfies Prisma.PlatformSelect;
export type PlatformRef = Prisma.PlatformGetPayload<{ select: typeof platformRefSelect }>;
export const platformRefOrder = [{ priority: 'asc' }, { name: 'asc' }] satisfies Prisma.PlatformOrderByWithRelationInput[];

export type ProfileRow = Prisma.ProfileGetPayload<{ include: typeof profileInclude }>;

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
 * `platforms` lists every platform for viewers who may see platform statuses;
 * pass null for Experts, who only get the personal details.
 */
export const toProfileDTO = (p: ProfileRow & ProfileCounts, platforms: PlatformRef[] | null): ProfileDTO => ({
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
          rate: row?.rate == null ? null : Number(row.rate),
        };
      })
    : null,
  bankCount: p._count ? p._count.banks : null,
  needsBank: p._count ? p._count.calls > 0 && p._count.banks === 0 : null,
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
export const toHistoryDTO = (h: HistoryRow): StatusHistoryDTO => ({
  id: h.id,
  callId: h.callId,
  fromStatus: h.fromStatus,
  toStatus: h.toStatus,
  actor: toUserRef(h.actor),
  isOverride: h.isOverride,
  comment: h.comment,
  createdAt: iso(h.createdAt),
});
