import { expect, request, test, type Browser, type Page } from '@playwright/test';

const API = process.env.E2E_API_URL ?? 'http://localhost:4000/api/v1';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Password123!';

async function apiLogin(email: string) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API}/auth/login`, { data: { email, password: PASSWORD } });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return { ctx, token: body.accessToken as string, user: body.user as { id: string } };
}

async function signIn(browser: Browser, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  await page.locator('input[type=email]').fill(email);
  await page.locator('input[autocomplete=current-password]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/');
  return page;
}

async function transition(page: Page, button: string, fill?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.getByRole('button', { name: button }).click();
  if (fill) await fill(page.getByRole('dialog'));
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

test('Associate schedules → Expert finishes → Founder invoices, observed live', async ({ browser }) => {
  // Arrange: a fresh call for pixel with quill, far in the future so it never clashes.
  const assoc = await apiLogin('pixel@god.local');
  const auth = { Authorization: `Bearer ${assoc.token}` };
  const experts = await (await assoc.ctx.get(`${API}/calendar/experts?from=2030-01-01T00:00:00Z&to=2030-01-02T00:00:00Z`, { headers: auth })).json();
  const quill = experts.experts.find((e: { expert: { nickname: string } }) => e.expert.nickname === 'quill').expert;
  const platforms = await (await assoc.ctx.get(`${API}/platforms`, { headers: auth })).json();
  const profiles = await (await assoc.ctx.get(`${API}/profiles?status=approved`, { headers: auth })).json();
  const day = 400 + Math.floor(Math.random() * 3000);
  const minute = [0, 15, 30, 45][Math.floor(Math.random() * 4)];
  const scheduledAt = new Date(Date.UTC(2027, 0, 1, 15, minute) + day * 86_400_000).toISOString();
  const created = await assoc.ctx.post(`${API}/calls`, {
    headers: auth,
    data: {
      platformId: platforms[0].id,
      profileId: profiles[0].id,
      expertId: quill.id,
      scheduledAt,
      durationMinutes: 15,
      projectDetails: 'E2E workflow check',
      platformAssociateName: 'E2E contact',
    },
  });
  expect(created.status()).toBe(201);
  const call = await created.json();
  const url = `/calls/${call.id}`;

  // The observer (pixel's Manager by default) keeps the call open the whole time.
  const observer = await signIn(browser, process.env.E2E_OBSERVER ?? 'atlas@god.local');
  await observer.goto(url);
  const observed = observer.getByTestId('call-status');
  await expect(observed).toHaveAttribute('data-status', 'on_scheduling');

  // 1. Associate schedules.
  const associate = await signIn(browser, 'pixel@god.local');
  await associate.goto(url);
  await transition(associate, 'Mark scheduled');
  await expect(associate.getByTestId('call-status')).toHaveAttribute('data-status', 'scheduled');
  await expect(observed).toHaveAttribute('data-status', 'scheduled', { timeout: 5_000 });

  // 2. Expert finishes.
  const expert = await signIn(browser, 'quill@god.local');
  await expert.goto(url);
  // The expert confirms the time first; only a confirmed call can be finished.
  await transition(expert, 'Confirm time');
  await expect(observed).toHaveAttribute('data-status', 'confirmed', { timeout: 5_000 });
  // Finishing asks only for the real duration (prefilled with the booking).
  await expert.getByRole('button', { name: 'Mark finished' }).click();
  await expert.getByRole('dialog').getByLabel('Actual duration (minutes)').fill('');
  await expect(expert.getByRole('dialog').getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await expert.getByRole('button', { name: 'Cancel' }).click();
  await transition(expert, 'Mark finished', async (dialog) => {
    await dialog.getByLabel('Actual duration (minutes)').fill('14');
  });
  await expect(expert.getByText('14 minutes')).toBeVisible();
  await expect(observed).toHaveAttribute('data-status', 'finished', { timeout: 5_000 });
  // The Associate's open screen updates too, and no longer offers actions.
  await expect(associate.getByTestId('call-status')).toHaveAttribute('data-status', 'finished');
  await expect(associate.getByText('No actions for you at this stage.')).toBeVisible();

  // 3. Founder invoices through to the bank.
  const founder = await signIn(browser, 'founder@god.local');
  await founder.goto(url);
  await transition(founder, 'Mark invoice submitted');
  await expect(observed).toHaveAttribute('data-status', 'invoice_submit', { timeout: 5_000 });
  await transition(founder, 'Mark invoice approved');
  await expect(observed).toHaveAttribute('data-status', 'invoice_approve', { timeout: 5_000 });
  await transition(founder, 'Mark processed to bank');
  await expect(observed).toHaveAttribute('data-status', 'process_to_bank', { timeout: 5_000 });
  await expect(founder.getByText('This call is complete.')).toBeVisible();

  // History is complete and attributed.
  const history = await (await assoc.ctx.get(`${API}/calls/${call.id}/history`, { headers: auth })).json();
  expect(history.map((h: { toStatus: string }) => h.toStatus)).toEqual([
    'on_scheduling',
    'scheduled',
    'confirmed',
    'finished',
    'invoice_submit',
    'invoice_approve',
    'process_to_bank',
  ]);
  expect(history.every((h: { isOverride: boolean }) => !h.isOverride)).toBe(true);
});
