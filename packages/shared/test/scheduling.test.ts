import { describe, expect, it } from 'vitest';
import {
  SCHEDULING_TEMPLATE_KEYS,
  SCHEDULING_TEMPLATES,
  renderSchedulingMessage,
  schedulingMessageSchema,
  schedulingTemplatesFor,
} from '../src/scheduling';
import { chatMessageSchema } from '../src/schemas';

describe('the scheduling sentences', () => {
  it('every blank in a sentence is declared, and every declared blank is used', () => {
    for (const key of SCHEDULING_TEMPLATE_KEYS) {
      const { text, slots } = SCHEDULING_TEMPLATES[key];
      const used = [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(used, key).toEqual(Object.keys(slots).sort());
    }
  });

  it('each side gets its own sentences and the shared ones', () => {
    const expert = schedulingTemplatesFor('expert');
    const team = schedulingTemplatesFor('team');
    expect(expert).toContain('confirmed');
    expect(expert).not.toContain('call_scheduled');
    expect(team).toContain('call_scheduled');
    expect(team).not.toContain('confirmed');
    for (const both of ['ok_thanks', 'how_about'] as const) {
      expect(expert).toContain(both);
      expect(team).toContain(both);
    }
  });
});

describe('schedulingMessageSchema', () => {
  const ok = (m: unknown) => schedulingMessageSchema.safeParse(m).success;

  it('accepts a sentence with its blanks filled', () => {
    expect(ok({ key: 'ok_thanks' })).toBe(true);
    expect(ok({ key: 'ask_available', params: { duration: 45, at: '2026-10-07T18:00:00Z' } })).toBe(true);
    expect(ok({ key: 'available_slots', params: { slots: ['2026-10-07T18:00:00Z', '2026-10-08T18:00:00Z'] } })).toBe(true);
    expect(ok({ key: 'available_window', params: { range: { start: '2026-10-07T13:00:00Z', end: '2026-10-07T17:00:00Z' } } })).toBe(true);
    expect(ok({ key: 'ask_availability', params: { days: { from: '2026-10-07', to: '2026-10-10' } } })).toBe(true);
    expect(ok({ key: 'reschedule_reason', params: { reason: 'travel' } })).toBe(true);
  });

  it.each([
    [{ key: 'tell_them_anything' }],
    [{ key: 'ask_available', params: { at: '2026-10-07T18:00:00Z' } }],
    [{ key: 'ask_available', params: { duration: 90, at: '2026-10-07T18:00:00Z' } }],
    [{ key: 'ok_thanks', params: { note: 'whatsapp me' } }],
    [{ key: 'available_slots', params: { slots: [] } }],
    [{ key: 'available_slots', params: { slots: Array(4).fill('2026-10-07T18:00:00Z') } }],
    [{ key: 'available_window', params: { range: { start: '2026-10-07T17:00:00Z', end: '2026-10-07T13:00:00Z' } } }],
    [{ key: 'available_window', params: { range: { start: '2026-10-01T13:00:00Z', end: '2026-10-20T13:00:00Z' } } }],
    [{ key: 'ask_availability', params: { days: { from: '2026-10-10', to: '2026-10-07' } } }],
    [{ key: 'not_available_day', params: { day: '2026-02-30' } }],
    [{ key: 'reschedule_reason', params: { reason: 'call me at 555-0100' } }],
    [{ key: 'running_late', params: { late: 7 } }],
  ])('refuses %j', (m) => {
    expect(ok(m)).toBe(false);
  });

  it('goes alone in a chat message', () => {
    expect(chatMessageSchema.safeParse({ scheduling: { key: 'received' } }).success).toBe(true);
    expect(chatMessageSchema.safeParse({ body: 'and also…', scheduling: { key: 'received' } }).success).toBe(false);
  });
});

describe('renderSchedulingMessage', () => {
  const at = '2026-10-07T18:00:00Z';

  it('writes a time out on the reader’s own clock', () => {
    expect(renderSchedulingMessage({ key: 'call_scheduled', params: { at } }, 'America/New_York')).toBe('Your call is scheduled for Wed, Oct 7 at 2 PM EDT.');
    expect(renderSchedulingMessage({ key: 'call_scheduled', params: { at } }, 'Asia/Seoul')).toBe('Your call is scheduled for Thu, Oct 8 at 3 AM GMT+9.');
  });

  it('fills every kind of blank', () => {
    const ny = 'America/New_York';
    expect(renderSchedulingMessage({ key: 'ask_available', params: { duration: 30, at: '2026-10-07T18:30:00Z' } }, ny)).toBe(
      'Are you available for a 30-minute call on Wed, Oct 7 at 2:30 PM EDT?',
    );
    expect(renderSchedulingMessage({ key: 'available_slots', params: { slots: [at, '2026-10-08T14:00:00Z', '2026-10-09T14:00:00Z'] } }, ny)).toBe(
      'I’m available at any of these times: Wed, Oct 7 at 2 PM EDT; Thu, Oct 8 at 10 AM EDT or Fri, Oct 9 at 10 AM EDT.',
    );
    expect(renderSchedulingMessage({ key: 'available_window', params: { range: { start: '2026-10-07T13:00:00Z', end: '2026-10-07T17:00:00Z' } } }, ny)).toBe(
      'I’m available on Wed, Oct 7 from 9 AM to 1 PM EDT.',
    );
    expect(renderSchedulingMessage({ key: 'ask_availability', params: { days: { from: '2026-10-07', to: '2026-10-10' } } }, ny)).toBe(
      'Please share your availability for Wed, Oct 7 – Sat, Oct 10.',
    );
    expect(renderSchedulingMessage({ key: 'not_available_day', params: { day: '2026-10-07' } }, 'Asia/Seoul')).toBe('I’m not available on Wed, Oct 7.');
    expect(renderSchedulingMessage({ key: 'reschedule_reason', params: { reason: 'conflict' } }, ny)).toBe('I need to reschedule because of a schedule conflict.');
    expect(renderSchedulingMessage({ key: 'client_late', params: { late: 5 } }, ny)).toBe('The client is running 5 minutes late.');
  });

  it('knows nothing of a sentence from a newer version', () => {
    expect(renderSchedulingMessage({ key: 'from_the_future', params: {} }, 'UTC')).toBeNull();
  });
});
