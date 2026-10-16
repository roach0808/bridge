import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { markActivity, markConnected, markDisconnected, presenceFor, presenceOf } from '../src/realtime/presence';
import { as, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('presence', () => {
  const socketId = (n: number) => `socket-${n}`;

  it('reports online, away and offline, and only to people who may chat', async () => {
    expect(presenceOf(fx.a1.id)).toBe('offline');
    await markConnected(fx.a1, socketId(1));
    expect(presenceOf(fx.a1.id)).toBe('online');

    // A tab that went to the background is away; coming back makes it online again.
    markActivity(fx.a1.id, true);
    expect(presenceOf(fx.a1.id)).toBe('away');
    markActivity(fx.a1.id, false);
    expect(presenceOf(fx.a1.id)).toBe('online');

    // Another tab keeps them online until the last one closes.
    await markConnected(fx.a1, socketId(2));
    markDisconnected(fx.a1.id, socketId(1));
    expect(presenceOf(fx.a1.id)).toBe('online');
    markDisconnected(fx.a1.id, socketId(2));
    expect(presenceOf(fx.a1.id)).toBe('offline');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.a1.id } })).lastSeenAt.getTime()).toBeGreaterThan(Date.now() - 60_000);

    // The list follows the chat rules: an Expert learns about Founders, Managers and Associates.
    await markConnected(fx.a1, socketId(3));
    const forExpert = await presenceFor(fx.e1);
    expect(forExpert.map((p) => p.userId).sort()).toEqual([fx.founder.id, fx.m1.id, fx.m2.id, fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id].sort());
    const forManager = await presenceFor(fx.m1);
    expect(forManager.find((p) => p.userId === fx.a1.id)?.status).toBe('online');
    // Their own team, the other Managers, the Founder and the Experts — never another team's Associates.
    expect(forManager.map((p) => p.userId).sort()).toEqual([fx.founder.id, fx.m2.id, fx.a1.id, fx.a2.id, fx.e1.id, fx.e2.id, fx.e3.id].sort());
    // An Associate: their Manager, their teammate, the Founder and the Experts.
    const forAssociate = await presenceFor(fx.a3);
    expect(forAssociate.map((p) => p.userId).sort()).toEqual([fx.founder.id, fx.m2.id, fx.a4.id, fx.e1.id, fx.e2.id, fx.e3.id].sort());
    // Offline people come with a last-seen time.
    expect(forManager.find((p) => p.userId === fx.a2.id)).toMatchObject({ status: 'offline' });
    expect(forManager.find((p) => p.userId === fx.a2.id)?.lastSeenAt).not.toBeNull();
    markDisconnected(fx.a1.id, socketId(3));
  });

  it('GET /presence answers per role', async () => {
    await markConnected(fx.founder, socketId(9));
    const list = (await (await as(fx.e1)).get('/presence')).body as Array<{ userId: string; status: string }>;
    expect(list.find((p) => p.userId === fx.founder.id)).toEqual({ userId: fx.founder.id, status: 'online', lastSeenAt: null });
    expect(list.map((p) => p.userId).sort()).toEqual([fx.founder.id, fx.m1.id, fx.m2.id, fx.a1.id, fx.a2.id, fx.a3.id, fx.a4.id].sort());
    const asFounder = (await (await as(fx.founder)).get('/presence')).body;
    expect(asFounder).toHaveLength(fx.users.length - 1);
    markDisconnected(fx.founder.id, socketId(9));
  });
});
