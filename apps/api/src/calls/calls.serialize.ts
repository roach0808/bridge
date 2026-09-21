import {
  FINANCE_STATUSES,
  expectedPrice,
  shareOf,
  statusForRole,
  type CallDTO,
  type CallPayouts,
  type CallStatus,
  type Payee,
  type Role,
} from '@god/shared';
import type { Prisma } from '@prisma/client';
import type { Actor } from '../auth/middleware';
import { iso, isoOrNull } from '../http';
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
      // Shares are copied onto the call when it is paid to bank.
      managerSharePercent: true,
      // Open bank accounts, for the Founder's "no bank yet" warning before invoicing.
      _count: { select: { banks: { where: { isActive: true } } } },
    },
  },
  associate: { select: { ...userRefSelect, managerId: true, sharePercent: true, manager: { select: userRefSelect } } },
  expert: { select: { ...userRefSelect, timeZone: true, hourlyRate: true } },
  payeeManager: { select: userRefSelect },
  createdBy: { select: userRefSelect },
} satisfies Prisma.CallInclude;

export type CallRow = Prisma.CallGetPayload<{ include: typeof callInclude }>;

/** Experts see invoiced calls as finished, without invoice figures. */
export function toCallDTO(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>): CallDTO {
  // Experts see no money at all, and only the Founder and the Expert see the GPT link.
  const hideMoney = viewer.role === 'expert';
  const { platformStatuses, managerSharePercent: _share, _count, ...profile } = call.profile;
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
    payouts: payoutsFor(call, viewer),
    bankReady: viewer.role === 'founder' ? _count.banks > 0 : null,
    createdBy: toUserRef(call.createdBy),
    createdAt: iso(call.createdAt),
    updatedAt: iso(call.updatedAt),
  };
}

const num = (d: { toString(): string } | null): number | null => (d === null ? null : Number(d));

/**
 * Who is paid what for the call, as far as the viewer may know (§3.1): the
 * Founder sees every line, each payee their own, and the Manager also the
 * Associate's part they pass on.
 */
export function payoutsFor(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>): CallPayouts {
  const status = call.status as CallStatus;
  const founder = viewer.role === 'founder';
  const isPayee = call.payeeManagerId !== null && call.payeeManagerId === viewer.id;
  const took = FINANCE_STATUSES.includes(status);
  const banked = status === 'process_to_bank';

  const expertRate = num(call.expertRate);
  const expert =
    took && call.expert && (founder || call.expertId === viewer.id)
      ? {
          user: toUserRef(call.expert),
          rate: expertRate,
          minutes: call.actualDurationMinutes,
          amount: expectedPrice(expertRate, call.actualDurationMinutes),
          paidAt: isoOrNull(call.expertPaidAt),
        }
      : null;

  const income = num(call.realIncome);
  const managerPercent = num(call.managerSharePercent);
  const associatePercent = num(call.associateSharePercent);
  const managerAmount = banked && income !== null && managerPercent !== null ? shareOf(income, managerPercent) : null;
  const associateAmount = banked && income !== null && associatePercent !== null ? shareOf(income, associatePercent) : null;

  const manager =
    banked && managerPercent !== null && (founder || isPayee)
      ? {
          user: call.payeeManager ? toUserRef(call.payeeManager) : null,
          percent: managerPercent,
          amount: managerAmount,
          keeps: managerAmount === null ? null : Math.round((managerAmount - (associateAmount ?? 0)) * 100) / 100,
          paidAt: isoOrNull(call.managerPaidAt),
        }
      : null;
  const associate =
    banked && associatePercent !== null && associatePercent > 0 && (founder || isPayee || call.associateId === viewer.id)
      ? {
          user: toUserRef(call.associate),
          percent: associatePercent,
          amount: associateAmount,
          paidAt: isoOrNull(call.associatePaidAt),
        }
      : null;

  // The Founder pays the Expert and the Manager (and may settle anything); the Manager pays the Associate.
  const canMark: Payee[] = [];
  if (founder) {
    if (expert && expert.amount !== null) canMark.push('expert');
    if (manager?.user) canMark.push('manager');
    if (associate) canMark.push('associate');
  } else if (isPayee && associate) {
    canMark.push('associate');
  }
  return { expert, manager, associate, canMark };
}

export interface Participant {
  id: string;
  role: Role;
}
