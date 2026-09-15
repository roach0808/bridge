import { deflateSync } from 'node:zlib';
import { expect, request, test, type Browser, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

async function apiAs(email: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await res.json()).accessToken}` };
  return {
    get: async (path: string) => (await ctx.get(`${API}${path}`, { headers })).json(),
    del: (path: string) => ctx.delete(`${API}${path}`, { headers }),
  };
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[autocomplete=current-password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
  return page;
}

/** A 64×64 solid PNG. */
function png(): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (b: Buffer) => {
    let c = 0xffffffff;
    for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), 8 + data.length);
    return out;
  };
  const size = 64;
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, 0x7a)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(Array(size).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

test('a user uploads and removes their own photo in Settings', async ({ browser }) => {
  const api = await apiAs('pixel@god.local');
  const page = await signIn(browser, 'pixel@god.local');
  await page.goto('/settings');
  await page.locator('input[type=file]').first().setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: png() });
  await expect.poll(async () => (await api.get('/me')).photoId, { timeout: 30_000 }).toBeTruthy();
  const photoId = (await api.get('/me')).photoId as string;
  // The header avatar now points at the uploaded picture.
  await expect(page.locator(`img[src*="/photos/${photoId}"]`).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect.poll(async () => (await api.get('/me')).photoId, { timeout: 30_000 }).toBeNull();
});

test('the Founder adds a bank from the pending tasks and the task clears', async ({ browser }) => {
  const api = await apiAs('founder@god.local');
  const before = (await api.get('/dashboard')).tasks.profilesNeedingBank as Array<{ profile: { id: string; name: string } }>;
  test.skip(before.length === 0, 'No profile needs a bank in the current data');
  const target = before[0]!.profile;

  const page = await signIn(browser, 'founder@god.local');
  const row = page.locator('div', { has: page.getByText(target.name, { exact: true }) }).filter({ has: page.getByRole('button', { name: 'Add bank' }) }).last();
  await row.getByRole('button', { name: 'Add bank' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Bank name').fill('E2E Bank');
  await dialog.getByLabel('Account number or IBAN').fill('GB29NWBK60161331926819');
  await dialog.getByRole('button', { name: 'Add bank' }).click();
  await expect(dialog.getByText('E2E Bank')).toBeVisible({ timeout: 20_000 });

  const banks = (await api.get(`/profiles/${target.id}/banks`)) as Array<{ id: string; bankName: string; isPrimary: boolean }>;
  expect(banks).toHaveLength(1);
  expect(banks[0]).toMatchObject({ bankName: 'E2E Bank', isPrimary: true });
  const after = (await api.get('/dashboard')).tasks.profilesNeedingBank as Array<{ profile: { id: string } }>;
  expect(after.some((p) => p.profile.id === target.id)).toBe(false);

  expect((await api.del(`/banks/${banks[0]!.id}`)).ok()).toBeTruthy();
});
