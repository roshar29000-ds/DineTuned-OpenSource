import { test, expect, type Page } from '@playwright/test';
import { returningUser } from './session-helpers';
import fixture from '../fixtures/menu-source-result.json';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'https://offline-menu-sources.supabase.co';
const NOW = '2026-10-29T12:00:00Z';
const handoff = { schema_version: 1, menu_status: 'not_retrieved', limitations: [], source_discovery_token: 'offline-source-verification-token', restaurant: {
  provider: 'google_places', place_id: 'cedar_river', display_name: 'Cedar & Salt', formatted_address: '123 N River St, Chicago, IL 60607',
  location: null, business_status: 'OPERATIONAL', types: ['restaurant'], attributions: [], source: { provider: 'google_places', api: 'places_new', place_id: 'cedar_river', retrieved_at: NOW },
} };

async function selectRestaurant(page: Page) {
  await page.goto('/discover');
  await page.getByRole('combobox').fill('Cedar & Salt');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await page.getByRole('option').click();
  await expect(page.getByRole('heading', { name: 'Cedar & Salt', exact: true })).toBeVisible();
  await expect(page.getByLabel('Restaurant website URL')).toBeVisible();
}

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await returningUser(page);
  await page.route('https://**', route => route.abort());
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode: 'supabase', url: PROJECT, publishable_key: 'sb_publishable_offline_key_only_123456' } }));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: NOW, app_metadata: {}, user_metadata: {}, identities: [] };
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: USER, exp, role: 'authenticated', is_anonymous: true })).toString('base64url'), 'offline-signature'].join('.');
  await page.route(`${PROJECT}/auth/v1/**`, route => route.fulfill({ json: route.request().url().endsWith('/user') ? user : {
    access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
  } }));
  await page.route('**/api/dinetuned/memory/**', route => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/dinetuned/discovery/config', route => route.fulfill({ json: { google_enabled: true, message: 'Mocked discovery', minimum_query_length: 3 } }));
  await page.route('**/api/dinetuned/discovery/sessions', route => route.fulfill({ json: { session_token: SESSION, expires_at: '2099-01-01T00:00:00Z', request_limit: 8 } }));
  await page.route('**/api/dinetuned/discovery/autocomplete', route => route.fulfill({ json: { provider: 'google_places', session_token: SESSION, location_mode: 'global', predictions: [{
    provider: 'google_places', place_id: 'cedar_river', name: 'Cedar & Salt', address: handoff.restaurant.formatted_address, types: ['restaurant'], distance_meters: null,
  }] } }));
  await page.route('**/api/dinetuned/discovery/selection', route => route.fulfill({ json: handoff }));
  await page.route('**/api/dinetuned/menu-sources/discover', route => route.fulfill({ json: { ...fixture, request_id: route.request().postDataJSON().request_id } }));
});

test('selected branch discovers attributed source candidates without creating dishes', async ({ page }, info) => {
  let calls = 0;
  await page.route('**/api/dinetuned/menu-sources/discover', route => {
    calls++; const data = route.request().postDataJSON();
    expect(data.restaurant.place_id).toBe('cedar_river'); expect(data.website_url).toBe('https://cedar.example.org/');
    expect(data.selection_token).toBe(handoff.source_discovery_token); expect(data.taste).toBeUndefined();
    return route.fulfill({ json: { ...fixture, request_id: data.request_id } });
  });
  await selectRestaurant(page); expect(calls).toBe(0);
  await page.getByLabel('Restaurant website URL').fill('https://cedar.example.org/');
  await page.getByRole('button', { name: 'Find menu sources', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Menu sources to explore.' })).toBeVisible(); expect(calls).toBe(1);
  await expect(page.locator('.source-candidate')).toHaveCount(2);
  await expect(page.locator('.source-candidate').first()).toContainText('Selected branch linked');
  await expect(page.getByRole('button', { name: /Find My Personal Picks/ })).toHaveCount(0);
  await page.getByText('Evidence & limitations', { exact: true }).first().click();
  await expect(page.getByText('The website names Cedar & Salt at 123 North River Street, Chicago, 60607.')).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.source-results').scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`menu-sources-${info.project.name}.png`), scale: 'css' });
  const stored = await page.evaluate(() => localStorage.getItem('dinetuned-v2')!);
  expect(stored).not.toContain('cedar.example.org'); expect(stored).not.toContain('offline-source-verification-token');
});

test('untrusted or blocked sources offer honest upload camera and QR fallback', async ({ page }) => {
  await page.route('**/api/dinetuned/menu-sources/discover', route => route.fulfill({ json: { ...fixture, request_id: route.request().postDataJSON().request_id,
    status: 'access_limited', candidates: [], recommended_candidate_id: null, limitations: ['The website robots rules prevent crawling.'] } }));
  await selectRestaurant(page); await page.getByLabel('Restaurant website URL').fill('https://cedar.example.org/');
  await page.getByRole('button', { name: 'Find menu sources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A trustworthy menu source isn’t available yet.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Upload Menu/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Scan Menu with Camera/ })).toBeVisible();
  await page.getByRole('button', { name: /Scan QR Code/ }).click();
  await expect(page.getByLabel('Or paste the menu’s web address')).toBeVisible();
});

test('editing the source or changing restaurants suppresses delayed source results', async ({ page }) => {
  let release!: () => void, started = false;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/menu-sources/discover', async route => {
    started = true; const id = route.request().postDataJSON().request_id; await delayed;
    await route.fulfill({ json: { ...fixture, request_id: id } }).catch(() => {});
  });
  await selectRestaurant(page); const input = page.getByLabel('Restaurant website URL');
  await input.fill('https://cedar.example.org/'); await page.getByRole('button', { name: 'Find menu sources', exact: true }).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.getByText('Checking the website, branch evidence and menu links…')).toBeVisible();
  await input.fill('https://another.example.org/'); release();
  await expect(page.locator('.source-results')).toHaveCount(0);
  await page.getByRole('button', { name: 'Change restaurant', exact: true }).click();
  await expect(page.locator('.source-discovery')).toHaveCount(0);
});

test('older handoffs stay readable and cannot trigger unverified source checks', async ({ page }) => {
  await page.route('**/api/dinetuned/discovery/selection', route => route.fulfill({ json: { ...handoff, source_discovery_token: null } }));
  let calls = 0; page.on('request', req => { if (req.url().endsWith('/menu-sources/discover')) calls++; });
  await selectRestaurant(page);
  await expect(page.getByText(/This older or expired selection needs a fresh server verification/)).toBeVisible();
  await page.getByLabel('Restaurant website URL').fill('https://cedar.example.org/');
  await expect(page.getByRole('button', { name: 'Find menu sources', exact: true })).toBeDisabled(); expect(calls).toBe(0);
});

test('API identity mismatch and expired proof are surfaced with no automatic retries', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/dinetuned/menu-sources/discover', route => { calls++; return route.fulfill({ json: { ...fixture, request_id: route.request().postDataJSON().request_id, restaurant_id: 'wrong_branch' } }); });
  await selectRestaurant(page); await page.getByLabel('Restaurant website URL').fill('https://cedar.example.org/');
  await page.getByRole('button', { name: 'Find menu sources', exact: true }).click();
  await expect(page.locator('.source-discovery').getByRole('alert')).toContainText('did not match this restaurant');
  await expect(page.locator('.source-candidate')).toHaveCount(0); expect(calls).toBe(1);
  await page.route('**/api/dinetuned/menu-sources/discover', route => { calls++; return route.fulfill({ status: 409, json: { detail: 'This branch selection has expired. No Google request was made.' } }); });
  await page.getByRole('button', { name: 'Find menu sources', exact: true }).click();
  await expect(page.locator('.source-discovery').getByRole('alert')).toContainText('selection has expired'); expect(calls).toBe(2);
});
