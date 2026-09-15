import { describe, expect, it } from 'vitest';
import {
  AVATAR_CATALOG,
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
  isValidTimeZone,
  repeatSchema,
  updateCallSchema,
  zoneAbbreviation,
} from '../src';

describe('call status constants', () => {
  it('blocking statuses are every status except on_scheduling', () => {
    expect([...BLOCKING_STATUSES].sort()).toEqual(CALL_STATUSES.filter((s) => s !== 'on_scheduling').sort());
  });

  it.each(CALL_STATUSES)('isBlockingStatus(%s)', (s) => {
    expect(isBlockingStatus(s)).toBe(s !== 'on_scheduling');
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

  it('updateCallSchema upper-cases currency and validates format', () => {
    expect(updateCallSchema.parse({ invoiceCurrency: 'usd' }).invoiceCurrency).toBe('USD');
    expect(updateCallSchema.safeParse({ invoiceCurrency: 'US' }).success).toBe(false);
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
