import { describe, expect, it } from 'vitest';
import { canJoinGroups, canRemoveFromGroup, mentionedIn, runsGroup } from '../src/chat';

const people = [
  { id: 'p', nickname: 'pixel' },
  { id: 's', nickname: 'Sprout.2' },
  { id: 'm', nickname: 'mango-lee' },
];

describe('mentionedIn', () => {
  it.each([
    ['@pixel can you take it?', ['p']],
    ['thanks @PIXEL.', ['p']],
    ['@Sprout.2 and @mango-lee, both of you', ['s', 'm']],
    ['ping @mango-lee-', ['m']],
    ['@pixel @pixel twice', ['p']],
    ['email pixel@example.com', []],
    ['@nobody here', []],
    ['no mention at all', []],
  ])('%j mentions %j', (body, ids) => {
    expect(mentionedIn(body, people)).toEqual(ids);
  });
});

describe('group roles', () => {
  it('owners take anyone out, admins plain members only, members nobody', () => {
    expect(canRemoveFromGroup('owner', 'admin')).toBe(true);
    expect(canRemoveFromGroup('owner', 'member')).toBe(true);
    expect(canRemoveFromGroup('owner', 'owner')).toBe(false);
    expect(canRemoveFromGroup('admin', 'member')).toBe(true);
    expect(canRemoveFromGroup('admin', 'admin')).toBe(false);
    expect(canRemoveFromGroup('admin', 'owner')).toBe(false);
    expect(canRemoveFromGroup('member', 'member')).toBe(false);
    expect([runsGroup('owner'), runsGroup('admin'), runsGroup('member'), runsGroup(null)]).toEqual([true, true, false, false]);
  });

  it('everyone but Experts is in groups', () => {
    expect((['founder', 'manager', 'associate', 'expert'] as const).map(canJoinGroups)).toEqual([true, true, true, false]);
  });
});
