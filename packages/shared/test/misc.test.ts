import { describe, expect, it } from 'vitest';
import {
  ACTIVE_STATUSES,
  AVATAR_CATALOG,
  FINANCE_STATUSES,
  associateShareOf,
  shareOf,
  canChat,
  canPutInGroup,
  chatModeOf,
  type ChatMode,
  TODO_STATUSES,
  canGiveTask,
  canNoteTask,
  canRemoveTask,
  canDeleteTaskNote,
  canEditTaskNote,
  isSelfTask,
  supervisesWork,
  sameTeam,
  teamIdOf,
  type TeamMember,
  expectedPrice,
  transitionSchema,
  stagesForRole,
  hiddenStatusesFor,
  stageStatusesForRole,
  statusFilterForRole,
  statusForRole,
  statusSince,
  type CallStatus,
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
    expect([...CANCELLABLE_STATUSES].sort()).toEqual(['confirmed', 'on_rescheduling', 'on_scheduling', 'research_ready', 'scheduled']);
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

// Two teams: Manager m with Associates a and b, Manager m2 with Associate c.
const people = {
  f: { id: 'f', role: 'founder', managerId: null },
  m: { id: 'm', role: 'manager', managerId: null },
  a: { id: 'a', role: 'associate', managerId: 'm' },
  b: { id: 'b', role: 'associate', managerId: 'm' },
  m2: { id: 'm2', role: 'manager', managerId: null },
  c: { id: 'c', role: 'associate', managerId: 'm2' },
  e: { id: 'e', role: 'expert', managerId: null },
  e2: { id: 'e2', role: 'expert', managerId: null },
} as const satisfies Record<string, TeamMember>;
type Who = keyof typeof people;

describe('teams', () => {
  it('a team is named by its Manager; the Founder and Experts are in none', () => {
    expect(teamIdOf(people.m)).toBe('m');
    expect(teamIdOf(people.a)).toBe('m');
    expect(teamIdOf(people.f)).toBeNull();
    expect(teamIdOf(people.e)).toBeNull();
    expect(sameTeam(people.a, people.b)).toBe(true);
    expect(sameTeam(people.m, people.a)).toBe(true);
    expect(sameTeam(people.a, people.c)).toBe(false);
    expect(sameTeam(people.f, people.f)).toBe(false);
    expect(sameTeam(people.e, people.e2)).toBe(false);
  });
});

describe('canChat', () => {
  it.each<[Who, Who, ChatMode | null]>([
    ['f', 'm', 'free'],
    ['f', 'c', 'free'],
    ['f', 'e', 'free'],
    // Managers with Managers; everyone in a team with their own team.
    ['m', 'm2', 'free'],
    ['m', 'a', 'free'],
    ['a', 'b', 'free'],
    // Never into another team.
    ['m', 'c', null],
    ['m2', 'a', null],
    ['a', 'c', null],
    // Experts work for every team, to schedule calls only.
    ['m', 'e', 'scheduling'],
    ['c', 'e', 'scheduling'],
    ['e', 'e2', null],
  ])('%s ↔ %s chat as %s', (x, y, mode) => {
    expect(chatModeOf(people[x], people[y])).toBe(mode);
    expect(chatModeOf(people[y], people[x])).toBe(mode);
    expect(canChat(people[x], people[y])).toBe(mode !== null);
  });
  it('nobody chats with themselves', () => {
    expect(canChat(people.f, people.f)).toBe(false);
  });
});

describe('canPutInGroup', () => {
  it('Founders, Managers and Associates by anyone who starts groups; an Expert by a Founder only', () => {
    for (const who of [people.f, people.m, people.a]) {
      expect(canPutInGroup(who, people.b)).toBe(true);
      expect(canPutInGroup(who, people.m2)).toBe(true);
    }
    expect(canPutInGroup(people.f, people.e)).toBe(true);
    expect(canPutInGroup(people.m, people.e)).toBe(false);
    expect(canPutInGroup(people.a, people.e)).toBe(false);
    expect(canPutInGroup(people.e, people.a)).toBe(false);
  });
});

describe('canGiveTask', () => {
  it('the founder gives tasks to anyone', () => {
    for (const who of Object.values(people)) expect(canGiveTask(people.f, who)).toBe(true);
  });
  it('a manager gives tasks to their own team’s associates, and to nobody else', () => {
    expect(canGiveTask(people.m, people.a)).toBe(true);
    expect(canGiveTask(people.m, people.b)).toBe(true);
    expect(canGiveTask(people.m, people.c)).toBe(false);
    expect(canGiveTask(people.m, people.m2)).toBe(false);
    expect(canGiveTask(people.m, people.e)).toBe(false);
  });
  it('anyone gives themselves a task, whatever their role', () => {
    for (const who of Object.values(people)) expect(canGiveTask(who, who)).toBe(true);
    expect(isSelfTask({ assignee: { id: 'x' }, createdBy: { id: 'x' } })).toBe(true);
    expect(isSelfTask({ assignee: { id: 'x' }, createdBy: { id: 'y' } })).toBe(false);
  });

  it('supervisesWork: the founder over everyone, a manager over their own team’s associates and their own work', () => {
    expect(supervisesWork(people.f, people.m2)).toBe(true);
    expect(supervisesWork(people.m, people.a)).toBe(true);
    expect(supervisesWork(people.m, people.m)).toBe(true);
    expect(supervisesWork(people.m, people.c)).toBe(false);
    expect(supervisesWork(people.m, people.m2)).toBe(false);
    expect(supervisesWork(people.m, people.e)).toBe(false);
    expect(supervisesWork(people.a, people.b)).toBe(false);
  });
  it('associates and experts give no tasks', () => {
    expect(canGiveTask(people.a, people.b)).toBe(false);
    expect(canGiveTask(people.e, people.f)).toBe(false);
  });
});

describe('statusSince', () => {
  const at = (day: number) => `2027-02-${String(day).padStart(2, '0')}T09:00:00.000Z`;
  const path = (...steps: CallStatus[]) => steps.map((toStatus, i) => ({ toStatus, createdAt: at(i + 1) }));
  const done = path('on_scheduling', 'scheduled', 'confirmed', 'research_ready', 'ongoing', 'finished', 'invoice_submit', 'invoice_approve');

  it('is when the call entered its status', () => {
    expect(statusSince('founder', done)).toBe(at(8));
    expect(statusSince('founder', path('on_scheduling'))).toBe(at(1));
    expect(statusSince('founder', [])).toBeNull();
  });
  it('an Expert’s call stays finished since it finished while it is invoiced', () => {
    expect(statusSince('expert', done)).toBe(at(6));
  });
  it('an Associate’s or Manager’s call stays confirmed since it was confirmed when the research data is ready', () => {
    const ready = path('on_scheduling', 'scheduled', 'confirmed', 'research_ready');
    expect(statusSince('associate', ready)).toBe(at(3));
    expect(statusSince('manager', ready)).toBe(at(3));
    expect(statusSince('founder', ready)).toBe(at(4));
    expect(statusSince('expert', ready)).toBe(at(4));
  });
  it('a status come back to counts from its latest return', () => {
    expect(statusSince('founder', path('on_scheduling', 'scheduled', 'on_rescheduling', 'scheduled'))).toBe(at(4));
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

describe('Associates and Managers do not see the research step', () => {
  it('a call with its research data ready reads as confirmed to them only', () => {
    expect(statusForRole('associate', 'research_ready')).toBe('confirmed');
    expect(statusForRole('manager', 'research_ready')).toBe('confirmed');
    expect(statusForRole('expert', 'research_ready')).toBe('research_ready');
    expect(statusForRole('founder', 'research_ready')).toBe('research_ready');
    expect(hiddenStatusesFor('manager')).toEqual(['research_ready']);
  });
  it('filters and stages', () => {
    expect(statusFilterForRole('associate', ['confirmed']).sort()).toEqual(['confirmed', 'research_ready']);
    expect(statusFilterForRole('manager', ['research_ready'])).toEqual([]);
    expect(statusFilterForRole('expert', ['research_ready'])).toEqual(['research_ready']);
    expect(stageStatusesForRole('associate', 'scheduling')).not.toContain('research_ready');
    expect(stageStatusesForRole('expert', 'scheduling')).toContain('research_ready');
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

  it('takes the Associate’s part out of the Manager’s share', () => {
    // 50% of a 15% share of $1,000.
    expect(associateShareOf(1000, 15, 50)).toBe(75);
    expect(associateShareOf(1000, 15, 100)).toBe(150);
    expect(associateShareOf(999.99, 15, 33.33)).toBe(49.99);
    expect(associateShareOf(1000, 15, 0)).toBe(0);
  });

  it('splits the Calls page between calls on their way and calls that took place', () => {
    expect([...ACTIVE_STATUSES, ...FINANCE_STATUSES, 'cancelled'].sort()).toEqual([...CALL_STATUSES].sort());
    expect(ACTIVE_STATUSES.some((s) => FINANCE_STATUSES.includes(s))).toBe(false);
  });
});

describe('removing a task and writing notes on it', () => {
  const { f: founder, m: manager, m2: otherManager, a: associate } = people;
  const task = (status: (typeof TODO_STATUSES)[number]) => ({ status, assignee: associate, createdBy: manager });

  it('the Founder removes any task; the giver and the owner only once it is completed', () => {
    for (const status of TODO_STATUSES) {
      expect(canRemoveTask(founder, task(status))).toBe(true);
      const completed = status === 'completed';
      expect(canRemoveTask(manager, task(status))).toBe(completed);
      expect(canRemoveTask(associate, task(status))).toBe(completed);
      expect(canRemoveTask(otherManager, task(status))).toBe(false);
    }
  });

  it('notes are for the owner, the giver and anyone above the owner', () => {
    const t = { assignee: associate, createdBy: founder };
    expect([associate, founder, manager].every((u) => canNoteTask(u, t))).toBe(true);
    // Another team's Manager is not above them.
    expect(canNoteTask(otherManager, t)).toBe(false);
    expect(canNoteTask(people.b, t)).toBe(false);
    expect(canNoteTask(people.e, t)).toBe(false);
  });

  it('a note is its writer’s to change; the Founder may also delete it', () => {
    const note = { author: { id: 'a' } };
    expect(canEditTaskNote(associate, note)).toBe(true);
    expect(canEditTaskNote(founder, note)).toBe(false);
    expect(canDeleteTaskNote(founder, note)).toBe(true);
    expect(canDeleteTaskNote(manager, note)).toBe(false);
  });
});
