import {
  FINANCE_STATUSES,
  associateShareOf,
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

const num = (d: { toString(): string } | null): number | null => (d === null ? null : Number(d));

/**
 * A call as one viewer may see it. Experts see invoiced calls as finished and
 * Associates and Managers a call whose research data is ready as confirmed.
 * Neither Experts nor Associates see what a call brings in, or its rate; the
 * research data and Ninja links go to the Founder and the Expert only.
 */
export function toCallDTO(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>): CallDTO {
  const hideMoney = viewer.role === 'expert' || viewer.role === 'associate';
  const insider = viewer.role === 'founder' || viewer.role === 'expert';
  const { platformStatuses, managerSharePercent: _share, _count, ...profile } = call.profile;
  const platformRate = num(platformStatuses.find((s) => s.platformId === call.platformId)?.rate ?? null);
  // A special rate on the call wins over the Profile's rate on the platform.
  const rate = num(call.rateOverride) ?? platformRate;
  const price = expectedPrice(rate, call.actualDurationMinutes);
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
    meetingDetails: call.meetingDetails,
    expectedPrice: hideMoney ? null : price,
    realIncome: hideMoney ? null : num(call.realIncome),
    // The meeting itself and the research behind it: only the Expert on it and the Founder.
    ninjaLink: insider ? call.ninjaLink : null,
    researchLink: insider ? call.researchLink : null,
    platformRate: hideMoney ? null : platformRate,
    rateOverride: hideMoney ? null : num(call.rateOverride),
    actualDurationMinutes: call.actualDurationMinutes,
    rating: call.rating,
    feedback: call.feedback,
    allowedTransitions: allowedTransitionsFor(viewer, call),
    permissions: callPermissions(viewer, call),
    payouts: payoutsFor(call, viewer, price),
    bankReady: viewer.role === 'founder' ? _count.banks > 0 : null,
    createdBy: toUserRef(call.createdBy),
    createdAt: iso(call.createdAt),
    updatedAt: iso(call.updatedAt),
  };
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Who is paid what for the call, as far as the viewer may know (§3.1). From
 * the moment the call took place: the Expert's pay, and the Manager's and the
 * Associate's shares as they should come out of the expected price. Once the
 * bank has paid, the shares are settled on the call and worked out from the
 * real income. The Founder sees every line; the Expert their own; the Manager
 * paid for the call their share and the Associate's part; the Associate their
 * part and their Manager's share (not its percent, which would give away the income).
 */
export function payoutsFor(call: CallRow, viewer: Pick<Actor, 'id' | 'role'>, price: number | null): CallPayouts {
  const none: CallPayouts = { expert: null, manager: null, associate: null, canMark: [] };
  if (!FINANCE_STATUSES.includes(call.status as CallStatus)) return none;
  const founder = viewer.role === 'founder';
  const banked = call.status === 'process_to_bank';
  const settled = banked && call.managerSharePercent !== null;

  // Before the bank pays, the shares follow today's settings; afterwards they are fixed on the call.
  const runByAssociate = call.associate.role === 'associate';
  const payee = settled
    ? call.payeeManager
    : runByAssociate
      ? call.associate.manager
      : call.associate;
  const isPayee = payee !== null && payee.id === viewer.id;
  const isCallAssociate = runByAssociate && call.associateId === viewer.id;
  const managerPercent = settled ? Number(call.managerSharePercent) : Number(call.profile.managerSharePercent);
  const associatePercent = !runByAssociate
    ? 0
    : settled
      ? Number(call.associateSharePercent ?? 0)
      : Number(call.associate.sharePercent ?? 0);

  const income = banked ? num(call.realIncome) : null;
  const managerExpected = price === null ? null : shareOf(price, managerPercent);
  const managerAmount = income === null ? null : shareOf(income, managerPercent);
  const associateExpected = price === null ? null : associateShareOf(price, managerPercent, associatePercent);
  const associateAmount = income === null ? null : associateShareOf(income, managerPercent, associatePercent);
  const managerBase = managerAmount ?? managerExpected;
  const associateBase = associateAmount ?? associateExpected ?? 0;

  const expertRate = num(call.expertRate);
  const expertPay = expectedPrice(expertRate, call.actualDurationMinutes);
  const expert =
    call.expert && (founder || call.expertId === viewer.id)
      ? {
          user: toUserRef(call.expert),
          rate: expertRate,
          minutes: call.actualDurationMinutes,
          amount: expertPay,
          expected: expertPay,
          paidAt: isoOrNull(call.expertPaidAt),
        }
      : null;
  const manager =
    founder || isPayee || isCallAssociate
      ? {
          user: payee ? toUserRef(payee) : null,
          percent: isCallAssociate && !founder ? null : managerPercent,
          expected: managerExpected,
          amount: managerAmount,
          keeps: managerBase === null ? null : round(managerBase - associateBase),
          settled,
          paidAt: isoOrNull(call.managerPaidAt),
        }
      : null;
  const associate =
    runByAssociate && associatePercent > 0 && (founder || isPayee || isCallAssociate)
      ? {
          user: toUserRef(call.associate),
          percent: associatePercent,
          expected: associateExpected,
          amount: associateAmount,
          paidAt: isoOrNull(call.associatePaidAt),
        }
      : null;

  // The Founder pays the Expert and the Manager (and may settle anything); the Manager pays the Associate.
  // Shares are paid once the bank has paid; the Expert once their pay is known.
  const canMark: Payee[] = [];
  if (founder) {
    if (expert && expert.amount !== null) canMark.push('expert');
    if (settled && manager?.user && managerAmount !== null) canMark.push('manager');
    if (settled && associate) canMark.push('associate');
  } else if (isPayee && settled && associate) {
    canMark.push('associate');
  }
  return { expert, manager, associate, canMark };
}

export interface Participant {
  id: string;
  role: Role;
}
