import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUSES,
  AVATAR_CATALOG,
  FINANCE_STATUSES,
  associateShareWithin,
  shareOf,
  canChat,
  canGiveTask,
  isSelfTask,
  supervisesWork,
  expectedPrice,
  transitionSchema,
  stagesForRole,
  statusFilterForRole,
  statusForRole,
  type Role,
  AVATAR_AUDIENCES,
  BLOCKING_STATUSES,
  CALL_DURATIONS,
  CALL_STATUSES,
  CREATABLE_ROLES,
  STAGE_STATUSES,
  STATUS_STAGE,
  TEAM_TIME_ZONE,
  blockPatchSchema,
  calendarQuerySchema,
  createCallSchema,
  defaultAvatarFor,
  displayZoneFor,
  isAvatarForAudience,
  isBlockingStatus,
  CANCELLABLE_STATUSES,
  TERMINAL_STATUSES,
  TRACK_STAGES,
  isValidTimeZone,
  repeatSchema,
  updateCallSchema,
  zoneAbbreviation,
} from '../src';

describe('call status constants', () => {
  /** A call holds the Expert's time from the moment it has one, until it is called off. */
  const FREE: readonly string[] = ['on_scheduling', 'cancelled'];

  it('blocking statuses are every status but on_scheduling and cancelled', () => {
    expect([...BLOCKING_STATUSES].sort()).toEqual(CALL_STATUSES.filter((s) => !FREE.includes(s)).sort());
  });

  it.each(CALL_STATUSES)('isBlockingStatus(%s)', (s) => {
    expect(isBlockingStatus(s)).toBe(!FREE.includes(s));
  });

  it('cancelled is terminal and is a stage of its own', () => {
    expect([...TERMINAL_STATUSES].sort()).toEqual(['cancelled', 'process_to_bank']);
    expect(STATUS_STAGE.cancelled).toBe('cancelled');
    expect(TRACK_STAGES).toEqual(['scheduling', 'execution', 'invoicing']);
    expect([...CANCELLABLE_STATUSES].sort()).toEqual(['confirmed', 'on_rescheduling', 'on_scheduling', 'scheduled']);
  });

  it('stage mapping agrees with STAGE_STATUSES', () => {
    for (const [stage, statuses] of Object.entries(STAGE_STATUSES)) {
      for (const s of statuses) expect(STATUS_STAGE[s]).toBe(stage);
    }
    expect(Object.values(STAGE_STATUSES).flat().sort()).toEqual([...CALL_STATUSES].sort());
  });

  it('durations are 15/30/45/60', () => {
    expect([...CALL_DURATIONS]).toEqual([15, 30, 45, 60]);
  });
});

describe('roles', () => {
  it('who creates whom', () => {
    expect(CREATABLE_ROLES).toEqual({ founder: ['manager', 'associate', 'expert'], manager: ['associate'], associate: [], expert: [] });
  });
});

describe('time zones', () => {
  it.each([['Asia/Seoul', true], ['Europe/London', true], ['America/New_York', true], ['UTC', true], ['Not/AZone', false], ['', false], ['+05:00', false], ['UTC+3', false], ['gmt-1', false]])(
    'isValidTimeZone(%j) = %s',
    (z, ok) => {
      expect(isValidTimeZone(z)).toBe(ok);
    },
  );

  it('experts see their own zone, everyone else team time', () => {
    expect(displayZoneFor({ role: 'expert', timeZone: 'Asia/Seoul' })).toBe('Asia/Seoul');
    for (const role of ['founder', 'manager', 'associate'] as const) {
      expect(displayZoneFor({ role, timeZone: 'Asia/Seoul' })).toBe(TEAM_TIME_ZONE);
    }
  });

  it('zone abbreviations follow DST', () => {
    expect(zoneAbbreviation('America/New_York', '2026-01-15T12:00:00Z')).toBe('EST');
    expect(zoneAbbreviation('America/New_York', '2026-07-15T12:00:00Z')).toBe('EDT');
  });
});

describe('avatars', () => {
  it('24 unique avatars per audience', () => {
    expect(AVATAR_CATALOG).toHaveLength(24 * AVATAR_AUDIENCES.length);
    expect(new Set(AVATAR_CATALOG.map((a) => a.id)).size).toBe(AVATAR_CATALOG.length);
  });

  it.each(AVATAR_AUDIENCES)('default avatar for %s belongs to that audience only', (aud) => {
    expect(isAvatarForAudience(defaultAvatarFor(aud), aud)).toBe(true);
    for (const other of AVATAR_AUDIENCES.filter((a) => a !== aud)) {
      expect(isAvatarForAudience(defaultAvatarFor(aud), other)).toBe(false);
    }
  });
});

describe('schemas', () => {
  const base = {
    platformId: '00000000-0000-4000-8000-000000000001',
    profileId: '00000000-0000-4000-8000-000000000002',
    scheduledAt: '2026-10-01T14:00:00Z',
    durationMinutes: 30,
    projectDetails: 'Details',
    platformAssociateName: 'Pat',
  };

  it.each([[15, true], [30, true], [45, true], [60, true], ['45', true], [20, false], [90, false], [0, false]])(
    'createCallSchema duration %j valid=%s',
    (durationMinutes, ok) => {
      expect(createCallSchema.safeParse({ ...base, durationMinutes }).success).toBe(ok);
    },
  );

  it('createCallSchema rejects blank project details', () => {
    expect(createCallSchema.safeParse({ ...base, projectDetails: '   ' }).success).toBe(false);
  });

  it('createCallSchema turns blank notes into null', () => {
    expect(createCallSchema.parse({ ...base, notes: '  ' }).notes).toBeNull();
  });

  it('updateCallSchema rejects an empty object', () => {
    expect(updateCallSchema.safeParse({}).success).toBe(false);
  });

  it('real income is a non-negative amount with cents, required to process a call to bank', () => {
    expect(updateCallSchema.parse({ realIncome: '942.50' }).realIncome).toBe(942.5);
    expect(updateCallSchema.safeParse({ realIncome: -1 }).success).toBe(false);
    expect(updateCallSchema.safeParse({ realIncome: 1.234 }).success).toBe(false);
    expect(transitionSchema.safeParse({ to: 'process_to_bank' }).success).toBe(false);
    expect(transitionSchema.safeParse({ to: 'process_to_bank', realIncome: 0 }).success).toBe(true);
  });

  it('expected price is the hourly rate for the real minutes, in cents', () => {
    expect(expectedPrice(1200, 45)).toBe(900);
    expect(expectedPrice(1000, 7)).toBe(116.67);
    expect(expectedPrice(null, 30)).toBeNull();
    expect(expectedPrice(900, null)).toBeNull();
  });

  it.each([
    ['2026-01-01T00:00:00Z', '2026-03-04T00:00:00Z', true],
    ['2026-01-01T00:00:00Z', '2026-03-05T00:00:00Z', false],
    ['2026-01-02T00:00:00Z', '2026-01-01T00:00:00Z', false],
    ['2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', false],
  ])('calendarQuerySchema %s → %s valid=%s', (from, to, ok) => {
    expect(calendarQuerySchema.safeParse({ from, to }).success).toBe(ok);
  });

  it('repeatSchema defaults', () => {
    expect(repeatSchema.parse({})).toEqual({ frequency: 'none', interval: 1, weekdays: [], monthDay: null, setPosition: null, weekday: null, month: null, untilDate: null });
  });

  it('blockPatchSchema defaults scope to all and keeps partial repeat partial', () => {
    const parsed = blockPatchSchema.parse({ changes: { repeat: { weekdays: [1] } } });
    expect(parsed.scope).toBe('all');
    expect(parsed.changes.repeat).toEqual({ weekdays: [1] });
  });
});

describe('canChat', () => {
  const u = (id: string, role: Role) => ({ id, role });
  it.each<[Role, Role, boolean]>([
    ['founder', 'founder', true],
    ['founder', 'manager', true],
    ['founder', 'associate', true],
    ['founder', 'expert', true],
    ['manager', 'manager', true],
    ['associate', 'associate', false],
    ['expert', 'expert', false],
    ['associate', 'manager', true],
    ['manager', 'associate', true],
    ['associate', 'expert', false],
    ['manager', 'expert', true],
    ['expert', 'associate', false],
    ['expert', 'manager', true],
  ])('%s ↔ %s → %s', (a, b, expected) => {
    expect(canChat(u('a', a), u('b', b))).toBe(expected);
    expect(canChat(u('b', b), u('a', a))).toBe(expected);
  });
  it('nobody chats with themselves', () => {
    expect(canChat(u('a', 'founder'), u('a', 'founder'))).toBe(false);
  });
});

describe('canGiveTask', () => {
  it('the founder gives tasks to anyone', () => {
    for (const role of ['founder', 'manager', 'associate', 'expert'] as const) {
      expect(canGiveTask({ id: 'f', role: 'founder' }, { id: 'x', role })).toBe(true);
    }
  });
  it('a manager gives tasks to any associate, and to nobody else', () => {
    const m = { id: 'm', role: 'manager' as const };
    expect(canGiveTask(m, { id: 'a', role: 'associate' })).toBe(true);
    expect(canGiveTask(m, { id: 'b', role: 'associate' })).toBe(true);
    expect(canGiveTask(m, { id: 'm2', role: 'manager' })).toBe(false);
    expect(canGiveTask(m, { id: 'e', role: 'expert' })).toBe(false);
  });
  it('anyone gives themselves a task, whatever their role', () => {
    for (const role of ['founder', 'manager', 'associate', 'expert'] as const) {
      expect(canGiveTask({ id: 'x', role }, { id: 'x', role })).toBe(true);
      expect(isSelfTask({ assignee: { id: 'x' }, createdBy: { id: 'x' } })).toBe(true);
      expect(isSelfTask({ assignee: { id: 'x' }, createdBy: { id: 'y' } })).toBe(false);
    }
  });

  it('supervisesWork: the founder over everyone, a manager over associates and their own work', () => {
    const m = { id: 'm', role: 'manager' as const };
    expect(supervisesWork({ id: 'f', role: 'founder' }, { id: 'm2', role: 'manager' })).toBe(true);
    expect(supervisesWork(m, { id: 'a', role: 'associate' })).toBe(true);
    expect(supervisesWork(m, m)).toBe(true);
    expect(supervisesWork(m, { id: 'm2', role: 'manager' })).toBe(false);
    expect(supervisesWork(m, { id: 'e', role: 'expert' })).toBe(false);
    expect(supervisesWork({ id: 'a', role: 'associate' }, { id: 'b', role: 'associate' })).toBe(false);
  });
  it('associates and experts give no tasks', () => {
    expect(canGiveTask({ id: 'a', role: 'associate' }, { id: 'b', role: 'associate' })).toBe(false);
    expect(canGiveTask({ id: 'e', role: 'expert' }, { id: 'f', role: 'founder' })).toBe(false);
  });
});

describe('experts do not see invoicing', () => {
  it('invoicing statuses read as finished for experts only', () => {
    for (const s of ['invoice_submit', 'invoice_approve', 'process_to_bank'] as const) {
      expect(statusForRole('expert', s)).toBe('finished');
      expect(statusForRole('founder', s)).toBe(s);
      expect(statusForRole('associate', s)).toBe(s);
    }
    expect(statusForRole('expert', 'confirmed')).toBe('confirmed');
  });
  it('stages and status filters', () => {
    expect(stagesForRole('expert')).toEqual(['scheduling', 'execution', 'cancelled']);
    expect(stagesForRole('manager')).toEqual(['scheduling', 'execution', 'invoicing', 'cancelled']);
    expect(statusFilterForRole('expert', ['finished']).sort()).toEqual(['finished', 'invoice_approve', 'invoice_submit', 'process_to_bank']);
    expect(statusFilterForRole('expert', ['invoice_submit'])).toEqual([]);
    expect(statusFilterForRole('founder', ['invoice_submit'])).toEqual(['invoice_submit']);
  });
});

describe('payouts', () => {
  it('takes a share to the cent', () => {
    expect(shareOf(1000, 15)).toBe(150);
    expect(shareOf(1000, 10)).toBe(100);
    expect(shareOf(1234.56, 15)).toBe(185.18);
    expect(shareOf(999.99, 12.5)).toBe(125);
    expect(shareOf(0, 15)).toBe(0);
  });

  it('keeps the Associate’s part within the Manager’s share', () => {
    expect(associateShareWithin(10, 15)).toBe(10);
    expect(associateShareWithin(20, 15)).toBe(15);
    expect(associateShareWithin(0, 15)).toBe(0);
  });

  it('splits the Calls page between calls on their way and calls that took place', () => {
    expect([...ACTIVE_STATUSES, ...FINANCE_STATUSES, 'cancelled'].sort()).toEqual([...CALL_STATUSES].sort());
    expect(ACTIVE_STATUSES.some((s) => FINANCE_STATUSES.includes(s))).toBe(false);
  });
});
