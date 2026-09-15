import { statusForRole, type CallDTO, type CallStatus, type Role } from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/middleware';
import { iso } from '../http';
import { toUserRef, userRefSelect } from '../serializers';
import { allowedTransitionsFor, callPermissions } from './calls.access';

export const callInclude = {
  platform: { select: { id: true, name: true, country: true, priority: true } },
  profile: { select: { id: true, name: true, linkedinUrl: true, briefExperience: true, avatarId: true, photoId: true } },
  associate: { select: { ...userRefSelect, managerId: true, manager: { select: userRefSelect } } },
  expert: { select: { ...userRefSelect, timeZone: true } },
  createdBy: { select: userRefSelect },
} satisfies Prisma.CallInclude;

export type CallRow = Prisma.CallGetPayload<{ include: typeof callInclude }>;

/** Experts see invoiced calls as finished, without invoice figures. */
export function toCallDTO(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>): CallDTO {
  const hideInvoicing = viewer.role === 'expert';
  return {
    id: call.id,
    status: statusForRole(viewer.role, call.status as CallStatus),
    platform: call.platform,
    profile: call.profile,
    associate: toUserRef(call.associate),
    manager: call.associate.manager ? toUserRef(call.associate.manager) : null,
    expert: call.expert ? { ...toUserRef(call.expert), timeZone: call.expert.timeZone } : null,
    scheduledAt: iso(call.scheduledAt),
    durationMinutes: call.durationMinutes,
    endsAt: iso(call.endsAt),
    notes: call.notes,
    projectDetails: call.projectDetails,
    platformAssociateName: call.platformAssociateName,
    invoiceAmount: !hideInvoicing && call.invoiceAmount ? call.invoiceAmount.toFixed(2) : null,
    invoiceCurrency: hideInvoicing ? null : call.invoiceCurrency,
    ninjaLink: call.ninjaLink,
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
