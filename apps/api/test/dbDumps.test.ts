import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createDump, listDumps } from '../src/backup/dumps';
import { as, expectError, prisma, seedFixtures, type Fixtures } from './helpers';

let fx: Fixtures;
beforeEach(async () => {
  fx = await seedFixtures();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('database dumps', () => {
  it('a dump stores every table, and the founder alone can list, run and download it', async () => {
    const dump = await createDump('manual');
    expect(dump.succeeded).toBe(true);
    expect(dump.byteSize).toBeGreaterThan(0);
    expect(dump.tableCounts.users).toBe(fx.users.length);
    expect(dump.tableCounts.profiles).toBe(3);
    // Session secrets are deliberately left out.
    expect(Object.keys(dump.tableCounts)).not.toContain('refresh_tokens');

    const f = await as(fx.founder);
    const list = await f.get('/db-dumps');
    expect(list.status).toBe(200);
    expect(list.body[0].id).toBe(dump.id);

    const file = await f.get(`/db-dumps/${dump.id}/download`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('gzip');
    expect(file.headers['content-disposition']).toContain('.json.gz');

    const ran = await f.post('/db-dumps');
    expect(ran.status).toBe(201);
    expect(ran.body.trigger).toBe('manual');

    for (const who of ['m1', 'a1', 'e1'] as const) {
      expectError(await (await as(fx[who])).get('/db-dumps'), 403);
      expectError(await (await as(fx[who])).post('/db-dumps'), 403);
      expectError(await (await as(fx[who])).get(`/db-dumps/${dump.id}/download`), 403);
    }
  });

  it('keeps only the newest dumps', async () => {
    for (let i = 0; i < 9; i++) await createDump('scheduled');
    const kept = await listDumps();
    expect(kept).toHaveLength(7);
    expect(await prisma.dbDump.count()).toBe(7);
  });
});
