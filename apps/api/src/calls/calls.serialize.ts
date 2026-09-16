import { expectedPrice, statusForRole, type CallDTO, type CallStatus, type Role } from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/middleware';
import { iso } from '../http';
import { toUserRef, userRefSelect } from '../serializers';
import { allowedTransitionsFor, callPermissions } from './calls.access';

export const callInclude = {
  platform: { select: { id: true, name: true, country: true, priority: true } },
  profile: {
    select: {
      id: true,
      name: true,
      linkedinUrl: true,
      briefExperience: true,
      avatarId: true,
      photoId: true,
      // The rate that applies to this call comes from the row for its platform.
      platformStatuses: { select: { platformId: true, rate: true } },
    },
  },
  associate: { select: { ...userRefSelect, managerId: true, manager: { select: userRefSelect } } },
  expert: { select: { ...userRefSelect, timeZone: true } },
  createdBy: { select: userRefSelect },
} satisfies Prisma.CallInclude;

export type CallRow = Prisma.CallGetPayload<{ include: typeof callInclude }>;

/** Experts see invoiced calls as finished, without invoice figures. */
export function toCallDTO(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>): CallDTO {
  // Experts see no money at all, and only the Founder and the Expert see the GPT link.
  const hideMoney = viewer.role === 'expert';
  const { platformStatuses, ...profile } = call.profile;
  const platformRate = platformStatuses.find((s) => s.platformId === call.platformId)?.rate ?? null;
  // A special rate on the call wins over the Profile's rate on the platform.
  const rate = call.rateOverride ?? platformRate;
  return {
    id: call.id,
    status: statusForRole(viewer.role, call.status as CallStatus),
    platform: call.platform,
    profile,
    associate: toUserRef(call.associate),
    manager: call.associate.manager ? toUserRef(call.associate.manager) : null,
    expert: call.expert ? { ...toUserRef(call.expert), timeZone: call.expert.timeZone } : null,
    scheduledAt: iso(call.scheduledAt),
    durationMinutes: call.durationMinutes,
    endsAt: iso(call.endsAt),
    notes: call.notes,
    projectDetails: call.projectDetails,
    platformAssociateName: call.platformAssociateName,
    expectedPrice: hideMoney ? null : expectedPrice(rate === null ? null : Number(rate), call.actualDurationMinutes),
    realIncome: hideMoney || call.realIncome === null ? null : Number(call.realIncome),
    ninjaLink: call.ninjaLink,
    gptLink: viewer.role === 'founder' || viewer.role === 'expert' ? call.gptLink : null,
    platformRate: hideMoney || platformRate === null ? null : Number(platformRate),
    rateOverride: hideMoney || call.rateOverride === null ? null : Number(call.rateOverride),
    actualDurationMinutes: call.actualDurationMinutes,
    rating: call.rating,
    feedback: call.feedback,
    allowedTransitions: allowedTransitionsFor(viewer, call),
    permissions: callPermissions(viewer, call),
    createdBy: toUserRef(call.createdBy),
    createdAt: iso(call.createdAt),
    updatedAt: iso(call.updatedAt),
  };
}

export interface Participant {
  id: string;
  role: Role;
}
