import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { returningUser } from './session-helpers';
import type { MenuDiscoveryHandoff } from '../../lib/contracts';
import path from 'node:path';
import { money } from '../../lib/preferences';

const API = process.env.E2E_API_URL || 'http://127.0.0.1:8126';
if (new URL(API).hostname !== '127.0.0.1') throw new Error('Real-menu tests require the offline loopback fixture backend.');
const PROJECT = 'https://offline-menu.supabase.co';
const SESSION = '22222222-2222-4222-8222-222222222222';

async function setup(page: Page, request: APIRequestContext, scenario = 'orchard', personalized = false) {
  const response = await request.get(`${API}/__fixtures/menu/${scenario}`);
  expect(response.ok()).toBe(true);
  const context: { user_id: string; website_url: string; handoff: MenuDiscoveryHandoff } = await response.json();
  const { handoff } = context;
  await returningUser(page);
  if (personalized) {
    await page.addInitScript(() => {
      const state = JSON.parse(localStorage.getItem('dinetuned-v2')!);
      state.taste.favorites = 'Grilled chicken with lemon, mushroom rice and tomato soup';
      state.constraints.max_price_minor = 2200;
      localStorage.setItem('dinetuned-v2', JSON.stringify(state));
    });
    await page.route('**/api/dinetuned/real-picks/config', route => route.fulfill({ json: {
      available: true, mode: 'mock', message: 'Offline SDK fixture only',
    } }));
  }
  await page.route('https://**', route => route.abort());
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode: 'supabase', url: PROJECT, publishable_key: 'sb_publishable_offline_only_123456' } }));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: context.user_id, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: '2026-10-30T00:00:00Z', app_metadata: {}, user_metadata: {}, identities: [] };
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated', is_anonymous: true })).toString('base64url'), 'offline-signature'].join('.');
  await page.route(`${PROJECT}/auth/v1/**`, route => route.fulfill({ json: route.request().url().endsWith('/user') ? user : {
    access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
  } }));
  await page.route('**/api/dinetuned/memory/**', route => route.fulfill({ json: { records: [] } }));
  await page.route('**/api/dinetuned/discovery/config', route => route.fulfill({ json: { google_enabled: true, message: 'Offline fixture discovery', minimum_query_length: 3 } }));
  await page.route('**/api/dinetuned/discovery/sessions', route => route.fulfill({ json: { session_token: SESSION, expires_at: '2099-01-01T00:00:00Z', request_limit: 8 } }));
  await page.route('**/api/dinetuned/discovery/autocomplete', route => route.fulfill({ json: { provider: 'google_places', session_token: SESSION, location_mode: 'global', predictions: [{
    provider: 'google_places', place_id: handoff.restaurant.place_id, name: handoff.restaurant.display_name, address: handoff.restaurant.formatted_address, types: ['restaurant'], distance_meters: null,
  }] } }));
  await page.route('**/api/dinetuned/discovery/selection', route => route.fulfill({ json: handoff }));
  // Website discovery + extraction go through Next.js and the actual FastAPI
  // routes/parsers. Only the fixture server's outbound websites/Auth are mocked.
  await page.goto('/discover');
  await page.getByRole('combobox').fill(handoff.restaurant.display_name);
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await page.getByRole('option').click();
  await page.getByLabel('Restaurant website URL').fill(context.website_url);
  return context;
}

async function discover(page: Page) {
  await page.getByRole('button', { name: 'Find menu sources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Menu sources to explore.' })).toBeVisible();
}

test.beforeEach(async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
});

test('multiple HTML sources render every category, literal prices and uncertainty without activating picks', async ({ page, request }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  let extractions = 0, picks = 0;
  page.on('request', req => { if (req.url().endsWith('/menu-extraction/extract')) extractions++; if (req.url().endsWith('/recommendation-sessions')) picks++; });
  await setup(page, request); await discover(page);
  const button = page.getByRole('button', { name: 'Extract selected menus', exact: true });
  await expect(button).toBeDisabled(); expect(extractions).toBe(0);
  await page.getByRole('button', { name: 'Select all 2 supported sources' }).click();
  await button.focus(); await page.keyboard.press('Enter');
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu).toBeVisible(); await expect(menu.locator('.real-menu-item')).toHaveCount(13);
  await expect(menu.locator('.real-menu-category')).toHaveCount(4);
  await expect(menu.getByText('This is not a guarantee', { exact: false })).toBeVisible();
  const ice = menu.locator('.real-menu-item').filter({ has: page.getByRole('heading', { name: 'Vanilla ice cream', exact: true }) });
  await expect(ice.locator('.real-menu-price')).toContainText(/Small\s*USD\s*5\.00/); await expect(ice.locator('.real-menu-price')).toContainText(/Large\s*USD\s*8\.00/);
  await expect(menu.locator('.real-menu-price strong').filter({ hasText: /^EUR\s*14\.50$/ })).toBeVisible();
  await expect(menu.locator('.real-menu-price strong').filter({ hasText: /^JPY\s*1,200$/ })).toBeVisible();
  await expect(menu.locator('.real-menu-price strong').filter({ hasText: /^KWD\s*3\.250$/ })).toBeVisible();
  const tea = menu.locator('.real-menu-item').filter({ has: page.getByRole('heading', { name: 'Ambiguous dollar tea', exact: true }) });
  await expect(tea).toContainText('$5'); await expect(tea).toContainText('Price unconfirmed'); await expect(tea).toContainText('No description was extracted.');
  await expect(menu.getByRole('complementary', { name: 'Personalization availability' })).toContainText('allergen cross-contact have not been verified');
  await expect(page.getByRole('button', { name: /Find My Personal Picks/ })).toHaveCount(0);
  expect(extractions).toBe(1); expect(picks).toBe(0);
  await menu.locator('.real-menu-verification > summary').click();
  await expect(menu.locator('.real-menu-verification')).toContainText('Document SHA-256');
  await menu.locator('.real-menu-verification > summary').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await menu.locator('.real-menu-category').first().scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath(`real-menu-${info.project.name}.png`), scale: 'css' });
  const stored = await page.evaluate(() => localStorage.getItem('dinetuned-v2')!);
  expect(stored).not.toContain('menus.example.org'); expect(stored).not.toContain('Charred chicken'); expect(stored).toContain('Crispy tacos');
  expect(errors).toEqual([]);
});

test('text PDF shows all eighteen dishes and source page references', async ({ page, request }) => {
  await setup(page, request, 'cedar'); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(18);
  const fruit = menu.locator('.real-menu-item').filter({ has: page.getByRole('heading', { name: 'Fruit plate', exact: true }) });
  await fruit.locator('summary').click();
  await expect(fruit.getByRole('link', { name: 'View source · page 3' }).first()).toHaveAttribute('href', /dinner\.pdf#page=3$/);
  await expect(fruit).toContainText('PDF layout and item boundaries need review.');
});

test('user text-PDF upload reaches categorized menu with honest provenance', async ({ page, request }) => {
  await setup(page, request, 'cedar', true);
  await page.getByText('Have a menu file or QR code instead?').click();
  await page.getByLabel('Upload menu file').setInputFiles(path.join(process.cwd(), '../api/tests/fixtures/menu_extraction/cedar-three-pages.pdf'));
  await expect(page.getByRole('button', { name: 'Extract this menu file' })).toBeEnabled();
  await page.getByRole('button', { name: 'Extract this menu file' }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(18);
  await expect(menu).toContainText('Its official origin and connection to this branch have not been independently verified.');
  await expect(menu.locator('.real-menu-verification').first()).toContainText('User-supplied document');
  await expect(menu.locator('a[href^="urn:"]')).toHaveCount(0);
  await expect(menu.locator('.real-menu-count')).toContainText('18');
  await expect(menu.getByText('META MUSE SPARK', { exact: false })).toHaveCount(0);
});

test('user HTML upload reaches mocked Meta Picks without an official-source claim', async ({ page, request }) => {
  await setup(page, request, 'orchard', true);
  await page.getByText('Have a menu file or QR code instead?').click();
  await page.getByLabel('Upload menu file').setInputFiles(path.join(process.cwd(), '../api/tests/fixtures/menu_extraction/orchard-menu.html'));
  await page.getByRole('button', { name: 'Extract this menu file' }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(7);
  await expect(menu.getByRole('button', { name: 'Find My Personal Picks' })).toBeEnabled();
  await menu.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks(?:#reveal)?$/);
  await expect(page.locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(3);
  await expect(page.locator('body')).toContainText('MOCKED / OFFLINE');
  await expect(page.locator('a[href^="urn:"]')).toHaveCount(0);
});

test('one visible footer address verifies the selected branch and permits extraction', async ({ page, request }) => {
  await setup(page, request, 'footer');
  await discover(page);
  const source = page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true });
  await expect(source).toBeEnabled();
  await source.check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Extracted restaurant menu' }).locator('.real-menu-item')).toHaveCount(7);
});

test('source subset is honest and changing selection invalidates the previous menu', async ({ page, request }) => {
  await setup(page, request); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.locator('.real-menu-item')).toHaveCount(7);
  await page.locator('.real-menu-verification > summary').click();
  await expect(page.locator('.real-menu-verification')).toContainText('Only part of the discovered source set was requested');
  await page.getByRole('button', { name: 'Review or change menu sources' }).click();
  await page.getByRole('checkbox', { name: 'Select Additional menu', exact: true }).check();
  await expect(page.locator('.real-menu')).toHaveCount(0);
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.locator('.real-menu-item')).toHaveCount(13);
});

for (const scenario of ['scanned', 'empty']) test(`${scenario} menus preserve honest recovery and local file preview`, async ({ page, request }) => {
  await setup(page, request, scenario); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.getByRole('heading', { name: scenario === 'scanned' ? 'This menu needs image reading.' : 'No reliable dish records were recovered.' })).toBeVisible();
  await expect(page.locator('.real-menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Upload Menu/ })).toBeVisible();
  await page.getByLabel('Upload menu file', { exact: true }).setInputFiles(path.resolve('../api/tests/fixtures/menu_extraction/blank-image-page.pdf'));
  await expect(page.getByText('Ready to read this user-supplied file with DineTuned’s text parser.', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: /Open PDF in browser/ })).toHaveAttribute('href', /^blob:/);
});

test('errors, expired authorizations and mismatched responses do not substitute dishes or retry', async ({ page, request }) => {
  await setup(page, request); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  let calls = 0;
  await page.route('**/menu-extraction/extract', route => { calls++; return route.fulfill({ status: 409, json: { detail: 'Menu sources expired. Recheck sources.' } }); });
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.locator('.source-results').getByRole('alert')).toContainText('Menu sources expired'); expect(calls).toBe(1);
  await page.route('**/menu-extraction/extract', route => { calls++; return route.abort(); });
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.locator('.source-results').getByRole('alert')).toContainText('could not connect'); expect(calls).toBe(2);
  await page.route('**/menu-extraction/extract', async route => { calls++; const response = await route.fetch(); const data = await response.json(); data.restaurant_id = 'wrong_branch'; await route.fulfill({ json: data }); });
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect(page.locator('.source-results').getByRole('alert')).toContainText('did not match this branch'); expect(calls).toBe(3);
  await expect(page.locator('.real-menu')).toHaveCount(0);
});

test('duplicate clicks and late responses cannot replace changed source or restaurant state', async ({ page, request }) => {
  await setup(page, request); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  let release!: () => void, calls = 0, ready = false;
  const deferred = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/menu-extraction/extract', async route => {
    calls++; const response = await route.fetch(); const data = await response.json(); ready = true; await deferred;
    await route.fulfill({ json: data }).catch(() => {});
  });
  const button = page.getByRole('button', { name: 'Extract selected menus', exact: true });
  await button.evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
  await expect.poll(() => ready).toBe(true); expect(calls).toBe(1);
  await expect(page.getByText(/Retrieving your selected documents/)).toBeVisible();
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).uncheck();
  release(); await expect(page.locator('.real-menu')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Extract selected menus', exact: true })).toBeDisabled();
  let releaseSecond!: () => void, secondReady = false;
  const second = new Promise<void>(resolve => { releaseSecond = resolve; });
  await page.route('**/menu-extraction/extract', async route => {
    const response = await route.fetch(); const data = await response.json(); secondReady = true; await second;
    await route.fulfill({ json: data }).catch(() => {});
  });
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await expect.poll(() => secondReady).toBe(true);
  await page.getByRole('button', { name: 'Change restaurant', exact: true }).click();
  releaseSecond();
  await expect(page.locator('.source-discovery')).toHaveCount(0);
  await expect(page.locator('.real-menu')).toHaveCount(0);
});

test('older source manifests cannot initiate extraction', async ({ page, request }) => {
  await setup(page, request);
  await page.route('**/menu-sources/discover', async route => { const response = await route.fetch(); const data = await response.json(); delete data.extraction_token; await route.fulfill({ json: data }); });
  await discover(page);
  await expect(page.getByText(/This source check has no extraction authorization/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Extract selected menus', exact: true })).toBeDisabled();
  await expect(page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true })).toBeDisabled();
});


test('real extracted menu leads to mocked Meta Picks with exact overages and hard safety', async ({ page, request }, info) => {
  await setup(page, request, 'orchard', true); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(7);
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  await expect(picks.getByRole('button', { name: 'Find My Personal Picks' })).toBeVisible();
  let calls = 0; page.on('request', request => { if (request.url().endsWith('/real-picks/sessions')) calls++; });
  const button = picks.getByRole('button', { name: 'Find My Personal Picks' });
  await button.evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(picks.locator('.real-pick')).toHaveCount(3); expect(calls).toBe(1);
  await expect(picks.locator('.real-pick-media')).toHaveCount(3);
  await expect(picks.locator('.real-pick-media').first()).toContainText('no restaurant photo claimed');
  await expect(picks.locator('.real-pick').first()).toContainText('Mushroom rice');
  await expect(picks.locator('.real-pick').last()).toContainText(`${money(200)} above your per-dish target`);
  await expect(picks.locator('.real-pick').last()).toContainText('Grilled chicken, lemon and potatoes.');
  await page.screenshot({ path: info.outputPath(`dedicated-real-picks-${info.project.name}.png`), fullPage: true, scale: 'css', animations: 'disabled' });
  await picks.getByLabel('Hide above-budget alternatives').check();
  await expect(picks.locator('.real-pick')).toHaveCount(0); expect(calls).toBe(1);
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click(); await expect(picks.locator('.real-pick')).toHaveCount(2);
  await picks.getByText('Budget, restrictions & allergies', { exact: true }).click();
  await picks.getByText('Food allergies', { exact: true }).click();
  await picks.getByLabel('Milk', { exact: true }).check();
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click(); await expect(picks.locator('.real-pick')).toHaveCount(0);
  await expect(picks.getByRole('status')).toContainText('No dishes have enough verified price and restriction evidence');
  expect(calls).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const stored = await page.evaluate(() => localStorage.getItem('dinetuned-v2')!);
  expect(stored).not.toContain('menus.example.org'); expect(stored).not.toContain('dish_');
});

test('an existing signed menu can recheck provider availability without rediscovery', async ({ page, request }, info) => {
  await setup(page, request, 'orchard', false); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-category')).toHaveCount(3);
  await expect(menu.getByRole('complementary', { name: 'Personalization availability' })).toBeVisible();
  let extractions = 0;
  page.on('request', value => { if (value.url().endsWith('/menu-extraction/extract')) extractions++; });
  await page.route('**/api/dinetuned/real-picks/config', route => route.fulfill({ json: {
    available: true, mode: 'mock', message: 'Offline fixture provider',
  } }));
  await menu.getByRole('button', { name: 'Recheck Picks availability' }).click();
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  await expect(picks.getByRole('button', { name: 'Find My Personal Picks' })).toBeVisible();
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(picks.locator('.real-pick')).toHaveCount(3);
  expect(extractions).toBe(0);
});

test('guest keeps the selected branch, extracted menu and Picks through navigation while Google is paused', async ({ page, request }) => {
  await setup(page, request, 'orchard', true); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(7);
  await menu.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(page.locator('.real-pick')).toHaveCount(3);
  let repeated = 0;
  page.on('request', value => { if (/\/(?:discovery\/(?:sessions|autocomplete|selection)|menu-extraction\/extract|real-picks\/sessions)$/.test(value.url())) repeated++; });
  await page.route('**/api/dinetuned/real-picks/config', route => route.fulfill({ json: {
    available: false, mode: 'disabled', message: 'Live retuning paused for this test',
  } }));
  await page.route('**/api/dinetuned/discovery/config', route => route.fulfill({ json: {
    google_enabled: false, message: 'Google paused for this test', minimum_query_length: 3,
  } }));
  for (const destination of ['My taste', 'Memories', 'My picks']) {
    await page.getByRole('link', { name: destination, exact: true }).click();
    if (destination !== 'My picks') {
      await page.getByRole('link', { name: 'Explore', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Orchard Kitchen', exact: true })).toBeVisible();
      await expect(page.getByText('New Google searches are paused.')).toBeVisible();
      await expect(page.getByRole('region', { name: 'Extracted restaurant menu' }).locator('.real-menu-category .real-menu-item')).toHaveCount(7);
      await expect(page.locator('.real-pick')).toHaveCount(0);
    } else {
      await expect(page).toHaveURL(/\/picks$/);
      await expect(page.locator('.real-pick')).toHaveCount(3);
      await expect(page.getByText('Fresh AI retuning is paused', { exact: false })).toBeVisible();
    }
  }
  expect(repeated).toBe(0);
});

test('private guest table restores full menu and Picks after reload and in a new tab without paid requests', async ({ page, request }) => {
  test.setTimeout(60000);
  const fixture = await setup(page, request, 'orchard', true); await discover(page);
  const tinyWebp = Buffer.from('UklGRjIAAABXRUJQVlA4ICYAAACwAQCdASoCAAIAAgA0JYgCdLoABDAAAP7wUx/N9j2eD4tikNSAAA==', 'base64');
  await page.context().route('**/api/dinetuned/real-picks/illustrations/**', route => route.fulfill({
    status: 200, contentType: 'image/webp', body: tinyWebp,
  }));
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  await page.getByRole('region', { name: 'Extracted restaurant menu' }).getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(page.locator('.real-pick')).toHaveCount(3);
  await expect(page.locator('.real-picks-page > .real-picks-list .real-pick-media img')).toHaveCount(3);
  await expect(page.locator('.real-pick-media figcaption').first()).toContainText(/AI-generated.*actual presentation may vary/i);
  let repeated = 0;
  page.context().on('request', value => {
    if (/\/(?:discovery\/(?:sessions|autocomplete|selection)|menu-extraction\/(?:extract|upload)|real-picks\/sessions)$/.test(value.url())) repeated++;
  });
  await page.reload();
  await expect(page.locator('.real-pick')).toHaveCount(3);
  await page.getByRole('link', { name: 'Back to the complete menu' }).click();
  await expect(page.getByRole('region', { name: 'Extracted restaurant menu' }).locator('.real-menu-category .real-menu-item')).toHaveCount(7);

  const user = { id: fixture.user_id, aud: 'authenticated', role: 'authenticated', is_anonymous: true,
    created_at: '2026-10-30T00:00:00Z', app_metadata: {}, user_metadata: {}, identities: [] };
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = [Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated', is_anonymous: true })).toString('base64url'),
    'offline-signature'].join('.');
  await page.context().route('**/api/identity/config', route => route.fulfill({ json: {
    mode: 'supabase', url: PROJECT, publishable_key: 'sb_publishable_offline_only_123456',
  } }));
  await page.context().route(`${PROJECT}/auth/v1/**`, route => route.fulfill({ json: route.request().url().endsWith('/user') ? user : {
    access_token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
  } }));
  await page.context().route('**/api/dinetuned/real-picks/config', route => route.fulfill({ json: {
    available: false, mode: 'disabled', message: 'Live requests are paused for this test',
  } }));
  const second = await page.context().newPage();
  await second.goto('/picks');
  await expect(second.locator('.real-pick')).toHaveCount(3);
  await expect(second.locator('.real-picks-page > .real-picks-list .real-pick-media img')).toHaveCount(3);
  await expect(second.getByText('Orchard Kitchen', { exact: true }).first()).toBeVisible();
  await second.getByText('Budget, restrictions & allergies', { exact: true }).click();
  await second.getByLabel('Budget per dish', { exact: true }).fill('19');
  await expect(second.locator('.real-pick')).toHaveCount(3);
  await expect(second.getByText('Saved selection from an earlier taste', { exact: false })).toBeVisible();
  await expect(second.locator('.real-dish-experience')).toHaveCount(0);
  expect(repeated).toBe(0);
});

test('offline real-table journey goes from signed branch to Picks and saved Taste Memory', async ({ page, request }) => {
  const fixture = await setup(page, request, 'orchard', true);
  const records: Record<string, Array<Record<string, unknown>>> = { events: [], feedback: [], history: [] };
  await page.route('**/api/dinetuned/memory/**', route => {
    const endpoint = new URL(route.request().url()).pathname.split('/memory/')[1] || '';
    const kind = endpoint.split('/')[0];
    if (route.request().method() === 'GET') return route.fulfill({ json: kind === 'profile'
      ? { profile: null } : { records: records[kind] || [] } });
    if (route.request().method() !== 'POST' || !records[kind]) return route.fulfill({ status: 404 });
    const body = route.request().postDataJSON() as Record<string, unknown>;
    let row = records[kind].find(value => value.id === body.id);
    if (!row) {
      row = { ...body, user_id: fixture.user_id, source: 'user_reported', ...(kind === 'history' ? {} : { revision: 1 }),
        created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      records[kind].push(row);
    }
    return route.fulfill({ status: 201, json: row });
  });
  await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-category .real-menu-item')).toHaveCount(7);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/real-picks/sessions', async route => {
    const response = await route.fetch(); await pending; await route.fulfill({ response }).catch(() => {});
  });
  await menu.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page.getByRole('dialog', { name: 'Personalized Picks are being prepared' })).toBeVisible();
  release();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  await expect(picks.locator('.real-pick')).toHaveCount(3);
  await expect(picks.locator('.real-pick-bridge').first()).toBeVisible();
  await expect(picks.getByRole('region', { name: 'Complete My Table' })).toBeVisible();
  const first = picks.locator('.real-pick').first();
  await first.getByRole('button', { name: 'Save dish' }).click();
  await expect(first.getByRole('status')).toContainText('Saved to your private dining history');
  await first.getByRole('button', { name: 'More about this pick' }).click();
  await first.getByRole('button', { name: 'I tried this' }).click();
  await first.locator('.real-dish-rating summary').click();
  await first.getByLabel('Rating (optional)').selectOption('5');
  await first.getByLabel('What stood out?').fill('Loved the smoky flavor');
  await first.getByRole('button', { name: 'Loved it' }).click();
  await expect.poll(() => records.feedback.length).toBe(1);
  await page.getByRole('link', { name: 'Memories', exact: true }).first().click();
  await expect(page.getByText('Loved the smoky flavor')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Loved the smoky flavor')).toBeVisible();
  await page.getByRole('link', { name: 'My picks', exact: true }).first().click();
  await expect(picks.locator('.real-pick')).toHaveCount(3);
});

test('real-menu bridge, table, stretch and temporary refinements use one mocked provider', async ({ page, request }, info) => {
  await setup(page, request, 'orchard', true); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(picks.locator('.real-pick')).toHaveCount(3);
  await expect(picks).toContainText('MOCKED / OFFLINE · Fixture responses, not real Meta inference.');
  await expect(picks).not.toContainText('CURATED WITH META MUSE SPARK 1.3');
  await expect(picks.locator('.real-pick-bridge').first()).toContainText('TASTEBRIDGE');
  await expect(picks.locator('.real-pick-reason').first()).not.toContainText(/You told us|Taste DNA|caught our eye/);
  await page.screenshot({ path: info.outputPath(`real-picks-layout-${info.project.name}.png`), animations: 'disabled' });
  const table = picks.getByRole('region', { name: 'Complete My Table' });
  await expect(table).toContainText('Mushroom rice');
  await expect(table).toContainText('Garden leaves');
  await expect(table.locator('.real-table-total')).toHaveCount(0);
  await table.getByRole('button', { name: 'Choose this table' }).click();
  await expect(table.locator('.real-table-total')).toContainText(money(4550));
  await expect(table.getByText('No order has been placed.')).toBeVisible();
  await table.getByRole('button', { name: 'Remove from my table' }).click();
  await picks.getByRole('button', { name: 'Something lighter' }).click();
  await expect(picks.getByText('Saved selection from an earlier taste', { exact: false })).toBeVisible();
  await picks.getByRole('button', { name: 'Update My Picks' }).click();
  await expect(picks.getByRole('region', { name: 'Worth the Stretch' })).toContainText(`${money(200)} above your per-dish target`);
  await picks.getByRole('button', { name: 'Try another dish' }).click();
  await expect(picks.getByText('Saved selection from an earlier taste', { exact: false })).toBeVisible();
  await picks.getByRole('button', { name: 'Update My Picks' }).click();
  await expect(picks.locator('.real-pick')).toHaveCount(1);
  await expect(picks.locator('.real-pick').first()).toContainText('Charred chicken');
  await picks.getByRole('button', { name: 'Reset refinements' }).click();
  await expect(picks.getByText('Saved selection from an earlier taste', { exact: false })).toBeVisible();
  await expect(picks.getByRole('button', { name: 'Update My Picks' })).toBeEnabled();
  let newRequests = 0;
  page.on('request', request => { if (request.url().endsWith('/real-picks/sessions')) newRequests++; });
  await picks.getByPlaceholder('For example, something lighter').fill('more spicy');
  expect(newRequests).toBe(0);
  const updated = page.waitForRequest(request => request.url().endsWith('/real-picks/sessions') &&
    request.postDataJSON().refinements.preferences.includes('spicier'));
  await picks.getByRole('button', { name: 'Update My Picks' }).click();
  await updated;
  await expect(picks.locator('.real-pick').first()).toBeVisible();
  expect(newRequests).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('changing the budget or restaurant discards pending real Picks without an automatic retry', async ({ page, request }, info) => {
  await setup(page, request, 'orchard', true); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  let release!: () => void, started = false, calls = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/real-picks/sessions', async route => {
    calls++; const response = await route.fetch(); started = true; await pending;
    await route.fulfill({ response }).catch(() => {});
  });
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect.poll(() => started).toBe(true);
  await expect(page.getByRole('dialog', { name: 'Personalized Picks are being prepared' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Cooking up your picks' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Personalized Picks are being prepared' }).getByRole('status')).toContainText('Reading the menu');
  await expect(page.getByRole('dialog', { name: 'Personalized Picks are being prepared' })).toContainText('dishes');
  await page.screenshot({ path: info.outputPath(`muse-loading-${info.project.name}.png`), animations: 'disabled' });
  await page.getByRole('button', { name: 'Keep browsing the menu' }).click();
  await picks.getByText('Budget, restrictions & allergies', { exact: true }).click();
  await picks.getByLabel('Budget per dish', { exact: true }).fill('12');
  release(); await expect(picks.locator('.real-pick')).toHaveCount(0);
  await page.waitForTimeout(150); expect(calls).toBe(1);
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/);
  await expect(picks.locator('.real-pick')).toHaveCount(3);
  await expect(picks).toContainText(`${money(1200)} above your per-dish target`);
  await page.getByRole('link', { name: 'Back to the complete menu' }).click();
  await page.getByRole('button', { name: 'Change restaurant' }).click();
  await expect(page.locator('.real-pick')).toHaveCount(0); expect(calls).toBe(2);
});

test('a failed Picks request keeps the table and only retries when the guest asks', async ({ page, request }) => {
  await setup(page, request, 'orchard', true); await discover(page);
  await page.getByRole('checkbox', { name: 'Select Dinner menu', exact: true }).check();
  await page.getByRole('button', { name: 'Extract selected menus', exact: true }).click();
  const picks = page.getByRole('region', { name: 'Personalized Picks from extracted menu' });
  const target = await picks.locator('.real-picks-target').innerText();
  let calls = 0;
  await page.route('**/api/dinetuned/real-picks/sessions', async route => {
    calls++;
    if (calls <= 2) return route.fulfill({ status: 503, json: { detail: 'The kitchen is unavailable.' } });
    return route.fallback();
  });
  const orbit = page.getByRole('dialog', { name: 'Personalized Picks are being prepared' });
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(orbit.getByRole('alert')).toContainText('The kitchen is unavailable.');
  await expect(orbit.getByRole('alert').getByRole('button', { name: 'Try again' })).toBeFocused();
  await page.waitForTimeout(400); expect(calls).toBe(1);
  await orbit.getByRole('button', { name: 'Back to the menu' }).click();
  await expect(orbit).toHaveCount(0);
  await expect(picks.locator('.real-picks-target')).toHaveText(target);
  await picks.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(orbit.getByRole('alert')).toBeVisible(); expect(calls).toBe(2);
  await orbit.getByRole('button', { name: 'Try again' }).click();
  await expect(page).toHaveURL(/\/picks#reveal$/); expect(calls).toBe(3);
  await expect(picks.locator('.real-pick')).toHaveCount(3);
});
