import { test, expect } from '@playwright/test';
import { initialState, STORAGE_KEY } from '../../lib/storage';

const USER = '11111111-1111-4111-8111-111111111111';
const PROJECT = 'https://offline-project.supabase.co';
const KEY = 'sb_publishable_offline_test_key_only_12345';
const NOW = '2026-10-28T12:00:00Z';
const local = initialState();
local.taste.complete = true;
local.taste.favorites = 'My smoky grilled chicken';
local.feedback = [{ id: 'prior-memory', restaurant_id: 'casa-sol', restaurant_name: 'Casa Sol', dish_id: 'taco', dish_name: 'My remembered tacos',
  liked: true, note: 'Keep this memory', date: NOW, menu_version: 'demo-v1' }];

test.beforeEach(async ({ page }) => {
  // All external traffic is blocked unless a test explicitly fulfills it below.
  await page.route('https://**', route => route.abort());
  await page.route(/\/api\/dinetuned\/memory\/(events|feedback|history)(\?|$)/, route => route.fulfill({ json: { records: [] } }));
  await page.addInitScript(({ key, value }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, value);
  }, { key: STORAGE_KEY, value: JSON.stringify(local) });
});

test('unconfigured cloud preserves local Taste DNA and dining diary', async ({ page }) => {
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode: 'local' } }));
  await page.goto('/memory');
  await expect(page.getByText(/Local-only mode/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My remembered tacos' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Back up Taste DNA/ })).toHaveCount(0);
  await page.reload();
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), STORAGE_KEY);
  expect(stored.taste.favorites).toBe(local.taste.favorites);
  expect(stored.feedback).toEqual(local.feedback);
});

test('guest session survives reload; explicit cloud backup preserves local data and lost identity is not replaced', async ({ page }, testInfo) => {
  let signups = 0, writes = 0;
  let backup: unknown = null;
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sub: USER, exp, aud: 'authenticated', role: 'authenticated', is_anonymous: true })).toString('base64url'), 'offline-signature'].join('.');
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: NOW, app_metadata: {}, user_metadata: {}, identities: [] };
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode: 'supabase', url: PROJECT, publishable_key: KEY } }));
  await page.route(`${PROJECT}/auth/v1/**`, route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/signup')) {
      signups++;
      return route.fulfill({ json: { access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user } });
    }
    if (pathname.endsWith('/user')) return route.fulfill({ json: user });
    return route.abort();
  });
  await page.route('**/api/dinetuned/memory/profile', async route => {
    expect(route.request().headers().authorization).toBe('Bearer ' + token);
    if (route.request().method() === 'POST') {
      writes++;
      const payload = route.request().postDataJSON();
      expect(payload.expected_revision).toBeNull();
      expect(payload.user_id).toBeUndefined();
      backup = { id: USER, user_id: USER, document: payload.document, revision: 1, source: 'user_reported', created_at: NOW, updated_at: NOW };
      return route.fulfill({ json: backup });
    }
    return route.fulfill({ json: { profile: backup } });
  });
  await page.goto('/memory');
  const save = page.getByRole('button', { name: 'Back up Taste DNA', exact: true });
  await expect(save).toBeEnabled();
  expect(signups).toBe(1); expect(writes).toBe(0);
  await save.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('status')).toContainText('Taste DNA snapshot saved');
  expect(writes).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Update Taste DNA backup' })).toBeEnabled();
  expect(signups).toBe(1); expect(writes).toBe(1);
  await expect(page.getByRole('heading', { name: 'My remembered tacos' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath(`memory-${testInfo.project.name}.png`), fullPage: true });
  const before = await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY);
  await page.evaluate(() => localStorage.removeItem('dinetuned-supabase-offline-project.supabase.co'));
  await page.reload();
  await expect(page.getByText(/session is missing/)).toBeVisible();
  expect(signups).toBe(1);
  expect(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY)).toBe(before);
});
