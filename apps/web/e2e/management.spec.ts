import { expect, request, test, type Browser, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

async function apiAs(email: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const { accessToken, user } = await res.json();
  const headers = { Authorization: `Bearer ${accessToken}` };
  return {
    user: user as { id: string },
    get: async (path: string) => (await ctx.get(`${API}${path}`, { headers })).json(),
    patch: (path: string, data: unknown) => ctx.patch(`${API}${path}`, { headers, data }),
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

test('Expert adds time off from the calendar', async ({ browser }) => {
  const api = await apiAs('ember@god.local');
  const from = new Date(Date.now() - 86_400_000).toISOString();
  const to = new Date(Date.now() + 40 * 86_400_000).toISOString();
  const before = (await api.get(`/calendar?from=${from}&to=${to}`)).rules as Array<{ id: string }>;

  const page = await signIn(browser, 'ember@god.local');
  await page.goto('/calendar');
  await page.getByRole('button', { name: 'Add time off' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Note (optional)').fill('e2e time off');
  await dialog.getByRole('button', { name: 'Add time off' }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  const after = (await api.get(`/calendar?from=${from}&to=${to}`)).rules as Array<{ id: string; note: string | null }>;
  const created = after.filter((r) => !before.some((b) => b.id === r.id));
  expect(created).toHaveLength(1);
  expect(created[0]!.note).toBe('e2e time off');
  expect((await api.del(`/schedule-blocks/${created[0]!.id}?scope=all`)).ok()).toBeTruthy();
});

test('Founder creates a user and approves a pending profile', async ({ browser }) => {
  const api = await apiAs('founder@god.local');
  const nickname = `zz-e2e-${Date.now().toString(36)}`;

  const page = await signIn(browser, 'founder@god.local');
  await page.goto('/users');
  await page.getByRole('button', { name: 'Create user' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nickname').fill(nickname);
  await dialog.getByLabel('Email').fill(`${nickname}@god.local`);
  await dialog.getByLabel('Temporary password').fill('Temporary-Password-1');
  await dialog.getByRole('button', { name: /^Create / }).click();
  await expect(page.getByText(nickname).first()).toBeVisible({ timeout: 20_000 });

  const users = (await api.get(`/users?q=${nickname}`)) as Array<{ id: string; nickname: string; email?: string }>;
  expect(users).toHaveLength(1);
  expect(users[0]!.email).toBeUndefined();
  expect((await api.patch(`/users/${users[0]!.id}`, { isActive: false })).ok()).toBeTruthy();

  const pending = (await api.get('/profiles?status=pending')) as Array<{ id: string; name: string }>;
  test.skip(pending.length === 0, 'No pending profile in the seed data');
  await page.goto('/profiles');
  const card = page.locator('.MuiCard-root', { hasText: pending[0]!.name });
  await card.getByRole('button', { name: 'Approve' }).click();
  await expect
    .poll(async () => (await api.get(`/profiles/${pending[0]!.id}`)).status, { timeout: 20_000 })
    .toBe('approved');
});
