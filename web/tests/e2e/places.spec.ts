import { test, expect, type Page } from '@playwright/test';
import { returningUser } from './session-helpers';

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const PROJECT = 'https://offline-places.supabase.co';
const NOW = '2026-10-29T12:00:00Z';
const north = { provider: 'google_places', place_id: 'north', name: 'Juniper Kitchen', address: '10 North Avenue, Chicago, IL', types: ['korean_restaurant'], distance_meters: null };
const south = { ...north, place_id: 'south', address: '92 South Avenue, Chicago, IL' };
const handoff = (id = 'south', status = 'OPERATIONAL') => ({ schema_version: 1, menu_status: 'not_retrieved', limitations: ['Menu discovery is not connected. No menu or dietary information has been retrieved.'], restaurant: {
  provider: 'google_places', place_id: id, display_name: 'Juniper Kitchen', formatted_address: id === 'south' ? south.address : north.address,
  location: { latitude: 41.9, longitude: -87.6 }, business_status: status, types: ['korean_restaurant'], attributions: [],
  source: { provider: 'google_places', api: 'places_new', place_id: id, retrieved_at: NOW },
} });

async function mockedIdentity(page: Page) {
  await page.route('https://**', route => route.abort());
  await page.route('**/api/identity/config', route => route.fulfill({ json: { mode: 'supabase', url: PROJECT, publishable_key: 'sb_publishable_offline_key_only_123456' } }));
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const user = { id: USER, aud: 'authenticated', role: 'authenticated', is_anonymous: true, created_at: NOW, app_metadata: {}, user_metadata: {}, identities: [] };
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: USER, exp, role: 'authenticated', is_anonymous: true })).toString('base64url'), 'offline-signature'].join('.');
  await page.route(`${PROJECT}/auth/v1/**`, route => route.request().url().endsWith('/user') ? route.fulfill({ json: user }) : route.fulfill({ json: {
    access_token: token, refresh_token: 'offline-refresh', token_type: 'bearer', expires_in: 3600, expires_at: exp, user,
  } }));
  await page.route('**/api/dinetuned/memory/**', route => route.fulfill({ json: { records: [] } }));
}

test.beforeEach(async ({ page }) => {
  await returningUser(page); await mockedIdentity(page);
  await page.route('**/api/dinetuned/discovery/config', route => route.fulfill({ json: { google_enabled: true, message: 'Real restaurant discovery uses Google Maps.', minimum_query_length: 3 } }));
  let sessions = 0;
  await page.route('**/api/dinetuned/discovery/sessions', route => {
    const token = ++sessions === 1 ? SESSION : `22222222-2222-4222-8222-${String(sessions).padStart(12, '0')}`;
    return route.fulfill({ json: { session_token: token, expires_at: '2099-01-01T00:00:00Z', request_limit: 8 } });
  });
  await page.route('**/api/dinetuned/discovery/autocomplete', route => route.fulfill({ json: { provider: 'google_places', session_token: route.request().postDataJSON().session_token, location_mode: 'global', predictions: [north, south] } }));
  await page.route('**/api/dinetuned/discovery/selection', route => route.fulfill({ json: handoff(route.request().postDataJSON().place_id) }));
});

test('failed Details keeps the same query ready for one deliberate fresh search', async ({ page }) => {
  let sessions = 0, searches = 0, details = 0;
  await page.route('**/api/dinetuned/discovery/sessions', route => {
    const token = ++sessions === 1 ? SESSION : `22222222-2222-4222-8222-${String(sessions).padStart(12, '0')}`;
    return route.fulfill({ json: { session_token: token, expires_at: '2099-01-01T00:00:00Z', request_limit: 1 } });
  });
  await page.route('**/api/dinetuned/discovery/autocomplete', route => {
    searches++;
    return route.fulfill({ json: { provider: 'google_places', session_token: route.request().postDataJSON().session_token,
      location_mode: 'area', predictions: [north, south] } });
  });
  await page.route('**/api/dinetuned/discovery/selection', route => {
    details++;
    return details === 1 ? route.fulfill({ status: 429, json: { detail: 'Restaurant search has reached its request limit.' } })
      : route.fulfill({ json: handoff('south') });
  });
  await page.goto('/discover');
  await page.getByLabel('City or area').fill('Chicago, IL');
  await page.getByRole('combobox').fill('Juniper Kitchen');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option').filter({ hasText: south.address }).click();
  await expect(page.locator('.rs-empty[role="alert"]')).toContainText('request limit');
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  expect({ sessions, searches, details }).toEqual({ sessions: 1, searches: 1, details: 1 });
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  expect({ sessions, searches, details }).toEqual({ sessions: 2, searches: 2, details: 1 });
  await page.getByRole('option').filter({ hasText: south.address }).click();
  await expect(page.locator('.places-address')).toContainText(south.address);
  expect(details).toBe(2);
});

test('exact branch via keyboard, attributed suggestions, ephemeral identity and no fabricated menu', async ({ page }, info) => {
  let searches = 0, selections = 0, menus = 0;
  page.on('request', request => { if (request.url().endsWith('/autocomplete')) searches++; if (/\/restaurants\/.+\/menu/.test(request.url())) menus++; });
  await page.route('**/api/dinetuned/discovery/selection', route => {
    selections++; expect(route.request().postDataJSON()).toEqual({ place_id: 'south', session_token: SESSION });
    return route.fulfill({ json: handoff() });
  });
  await page.goto('/discover');
  await expect(page.getByRole('button', { name: /Real restaurants/ })).toHaveAttribute('aria-pressed', 'true');
  const search = page.getByRole('combobox'); await search.fill('Ju'); await page.waitForTimeout(450); expect(searches).toBe(0);
  await search.fill('Juniper'); expect(searches).toBe(0);
  await page.getByRole('button', { name: 'Search Restaurants' }).click(); await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByRole('option').first()).toContainText(north.address);
  await expect(page.getByAltText('Google Maps')).toBeVisible();
  await search.press('Enter'); expect(selections).toBe(0);
  await search.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`places-suggestions-${info.project.name}.png`), fullPage: true });
  await search.press('ArrowDown'); await search.press('ArrowDown'); await search.press('Enter');
  await expect(page.getByRole('heading', { name: 'Juniper Kitchen' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Menu sources. Then the dishes.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find menu sources', exact: true })).toBeDisabled(); // Older handoff has no signed source proof.
  await expect(page.locator('.places-address')).toContainText(south.address);
  expect(menus).toBe(0); expect(selections).toBe(1);
  const stored = await page.evaluate(() => localStorage.getItem('dinetuned-v2')!);
  expect(stored).not.toContain('Juniper Kitchen'); expect(JSON.parse(stored).selection).toBeNull();
  await page.locator('.places-handoff').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`places-identity-${info.project.name}.png`), fullPage: true });
  if (info.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.locator('.places-identity').scrollIntoViewIfNeeded();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // A viewport capture avoids Chrome's full-page tiling artifact after resizing a high-DPI phone.
    await page.screenshot({ path: info.outputPath('places-narrow-320.png'), scale: 'css' });
    await page.locator('.places-next').scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('places-narrow-next-320.png'), scale: 'css' });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.reload(); await expect(page.locator('.places-handoff')).toHaveCount(0); expect(selections).toBe(1);
});

test('Girl & the Goat result survives an input-context change and yields its signed Chicago branch once', async ({ page }) => {
  const girl = { ...north, place_id: 'girl-chicago', name: 'Girl & the Goat', address: '809 W Randolph St, Chicago, IL 60607', types: ['restaurant'] };
  let sessions = 0, searches = 0, details = 0;
  await page.route('**/api/dinetuned/discovery/sessions', route => {
    sessions++;
    return route.fulfill({ json: { session_token: SESSION, expires_at: '2099-01-01T00:00:00Z', request_limit: 1 } });
  });
  await page.route('**/api/dinetuned/discovery/autocomplete', route => {
    searches++;
    expect(route.request().postDataJSON()).toMatchObject({ query: 'Girl & the Goat', area: 'West Loop, Chicago, IL', session_token: SESSION });
    return route.fulfill({ json: { provider: 'google_places', session_token: SESSION, location_mode: 'area', predictions: [girl] } });
  });
  await page.route('**/api/dinetuned/discovery/selection', route => {
    details++;
    expect(route.request().postDataJSON()).toEqual({ place_id: girl.place_id, session_token: SESSION });
    const value = handoff(girl.place_id);
    return route.fulfill({ json: { ...value, source_discovery_token: 'signed-offline-selection', restaurant: {
      ...value.restaurant, display_name: girl.name, formatted_address: girl.address, source: { ...value.restaurant.source, place_id: girl.place_id }, place_id: girl.place_id,
    } } });
  });
  await page.goto('/discover');
  await page.getByLabel('City or area').fill('West Loop, Chicago, IL');
  await page.getByRole('combobox').fill('Girl & the Goat');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toContainText(girl.address);
  await page.getByLabel('City or area').fill('Chicago, IL'); // Reproduce a late input-context update after success.
  await expect(page.getByRole('option')).toContainText(girl.address);
  await expect(page.getByText(/Your inputs changed/)).toBeVisible();
  await expect(page.getByText(/Results for Girl & the Goat · West Loop, Chicago, IL/)).toBeVisible();
  await expect(page.getByLabel('City or area')).toBeVisible();
  await page.getByRole('option').evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await expect(page.locator('.places-address')).toHaveText(girl.address);
  await page.getByLabel('Restaurant website URL').fill('https://www.girlandthegoat.com/chicago');
  await expect(page.getByText(/older or expired selection/)).toHaveCount(0);
  await expect(page.getByLabel('Restaurant website URL')).toHaveValue('https://www.girlandthegoat.com/chicago');
  await expect(page.getByRole('button', { name: 'Find menu sources', exact: true })).toBeEnabled();
  expect({ sessions, searches, details }).toEqual({ sessions: 1, searches: 1, details: 1 });
});

test('optional location, denied permission, manual area and nearby bias', async ({ page, context }) => {
  const bodies: Array<{ query: string; area: string; location: unknown }> = [];
  await page.route('**/api/dinetuned/discovery/autocomplete', route => {
    bodies.push(route.request().postDataJSON()); return route.fulfill({ json: { provider: 'google_places', session_token: route.request().postDataJSON().session_token, predictions: [north], location_mode: bodies.at(-1)?.area ? 'area' : bodies.at(-1)?.location ? 'nearby' : 'global' } });
  });
  await page.addInitScript(() => {
    const original = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    let denied = false;
    navigator.geolocation.getCurrentPosition = (success, error, options) => {
      if (!denied) { denied = true; error?.({ code: 1, message: 'Denied', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 }); }
      else original(success, error, options);
    };
  });
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 41.9, longitude: -87.6 });
  await page.goto('/discover'); await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText(/Location wasn’t shared/)).toBeVisible();
  await page.getByRole('combobox').fill('Juniper'); await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(1);
  expect(bodies.at(-1)?.location).toBeNull();
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText(/Your inputs changed/)).toBeVisible();
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect.poll(() => bodies.at(-1)?.location).toEqual({ latitude: 41.9, longitude: -87.6 });
  await page.getByLabel('City or area').fill('Tokyo');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect.poll(() => bodies.at(-1)?.area).toBe('Tokyo');
  await expect(page.getByText(/typed area takes priority/)).toBeVisible();
});

test('fast typing and changed selection discard stale responses', async ({ page }) => {
  let releaseSearch!: () => void, releaseDetails!: () => void;
  const delayedSearch = new Promise<void>(resolve => { releaseSearch = resolve; });
  const delayedDetails = new Promise<void>(resolve => { releaseDetails = resolve; });
  let oldStarted = false, detailsStarted = false;
  await page.route('**/api/dinetuned/discovery/autocomplete', async route => {
    const old = route.request().postDataJSON().query === 'Old';
    if (old) { oldStarted = true; await delayedSearch; }
    await route.fulfill({ json: { provider: 'google_places', session_token: route.request().postDataJSON().session_token, location_mode: 'global', predictions: [{ ...north, name: old ? 'Old place' : 'Current place' }] } }).catch(() => {});
  });
  await page.route('**/api/dinetuned/discovery/selection', async route => {
    detailsStarted = true; await delayedDetails;
    await route.fulfill({ json: handoff('north') }).catch(() => {});
  });
  await page.goto('/discover'); const input = page.getByRole('combobox');
  await input.fill('Old'); await page.getByRole('button', { name: 'Search Restaurants' }).click(); await expect.poll(() => oldStarted).toBe(true);
  await input.fill('Current'); await input.press('Enter'); await expect(page.getByRole('option')).toContainText('Current place');
  releaseSearch(); await expect(page.getByRole('option')).not.toContainText('Old place');
  await page.getByRole('option').click(); await expect.poll(() => detailsStarted).toBe(true);
  await expect(page.getByLabel('City or area')).toBeDisabled(); releaseDetails();
  await expect(page.locator('.places-handoff')).toBeVisible();
  await expect(input).toBeDisabled();
});

test('empty and failed searches never substitute demo results or automatically retry', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/dinetuned/discovery/autocomplete', route => {
    calls++; return route.fulfill(calls === 1 ? { json: { provider: 'google_places', session_token: route.request().postDataJSON().session_token, location_mode: 'global', predictions: [] } }
      : { status: 409, json: { detail: 'This search session ended. Start a new search.' } });
  });
  await page.goto('/discover'); await page.getByRole('combobox').fill('Nowhere');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByText(/No matching dining locations/)).toBeVisible();
  await page.getByRole('combobox').fill('Another');
  await expect(page.getByText(/Your inputs changed/)).toBeVisible();
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByText(/This search session ended/)).toBeVisible();
  await page.waitForTimeout(450); expect(calls).toBe(2);
  await expect(page.getByRole('option')).toHaveCount(0); await expect(page.locator('.rs-directory')).toHaveCount(0);
  await page.getByRole('button', { name: 'Start a new search' }).click(); await expect.poll(() => calls).toBe(3);
});

test('returning to an earlier query never restores its old selected identity', async ({ page }) => {
  let selections = 0;
  await page.route('**/api/dinetuned/discovery/selection', route => { selections++; return route.fulfill({ json: handoff('north') }); });
  await page.goto('/discover'); const input = page.getByRole('combobox');
  await input.fill('Juniper'); await page.getByRole('button', { name: 'Search Restaurants' }).click(); await page.getByRole('option').first().click();
  await expect(page.locator('.places-handoff')).toBeVisible();
  await expect(input).toBeDisabled(); await page.getByRole('button', { name: 'Change restaurant', exact: true }).click();
  await input.fill('Other'); await expect(page.locator('.places-handoff')).toHaveCount(0);
  await input.fill('Juniper'); await expect(page.getByRole('option')).toHaveCount(0);
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.locator('.places-handoff')).toHaveCount(0); expect(selections).toBe(1);
});

test('closed and incomplete locations are honest, long content fits narrow screens', async ({ page }, info) => {
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  let status = 'CLOSED_TEMPORARILY';
  await page.route('**/api/dinetuned/discovery/selection', route => {
    const value = handoff('north', status);
    return route.fulfill({ json: { ...value, restaurant: { ...value.restaurant, display_name: 'Juniper Kitchen — The Original Riverside Dining Room and Garden', formatted_address: null, location: null } } });
  });
  await page.goto('/discover');
  for (const [value, label] of [['CLOSED_TEMPORARILY', 'Reported temporarily closed'], ['CLOSED_PERMANENTLY', 'Reported permanently closed'], ['UNKNOWN', 'Business status unavailable']]) {
    status = value; await page.getByRole('combobox').fill('Juniper');
    await page.getByRole('button', { name: 'Search Restaurants' }).click(); await page.getByRole('option').first().click();
    await expect(page.locator('.places-business-status')).toContainText(label);
    await expect(page.locator('.places-address')).toHaveText('Address unavailable');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByText('Source & available details').click(); await expect(page.getByText('Place ID: north')).toBeVisible();
    await page.getByRole('button', { name: 'Change restaurant', exact: true }).click();
  }
});

test('disabled integration offers explicit separate demo journey and retains full menu first', async ({ page }) => {
  await page.route('**/api/dinetuned/discovery/config', route => route.fulfill({ json: { google_enabled: false, message: 'Real restaurant search is not enabled.', minimum_query_length: 3 } }));
  let paid = 0; page.on('request', request => { if (/discovery\/(sessions|autocomplete|selection)$/.test(request.url())) paid++; });
  await page.goto('/discover');
  await expect(page.getByRole('button', { name: /Real restaurants/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /Real restaurants/ })).toContainText('Live search paused');
  await expect(page.getByText('Real restaurant search is not enabled.')).toBeVisible();
  await page.getByRole('link', { name: 'My picks', exact: true }).first().click();
  await expect(page).toHaveURL(/\/picks$/);
  await expect(page.getByRole('heading', { name: 'The menu comes first.' })).toBeVisible();
  await page.getByRole('link', { name: 'Find a restaurant' }).click();
  await page.getByRole('button', { name: 'Explore fictional demo menus' }).click();
  await page.getByRole('combobox').fill('Saigon'); await page.getByRole('option').first().click();
  await expect(page).toHaveURL(/\/restaurant\/saigon-table/);
  await expect(page.getByRole('button', { name: /Find My Personal Picks/ }).first()).toBeVisible(); expect(paid).toBe(0);
});


// Use the SDK's real cross-tab notification path; only Auth HTTP is mocked.
async function authEvent(page: Page, event: string, update?: { token?: string; userId?: string }) {
  await page.evaluate(({ event, update }) => {
    const namespace = 'dinetuned-supabase-offline-places.supabase.co';
    const session = JSON.parse(localStorage.getItem(namespace)!);
    if (update?.token) session.access_token = update.token;
    if (update?.userId) session.user.id = update.userId;
    if (update) localStorage.setItem(namespace, JSON.stringify(session));
    const channel = new BroadcastChannel(namespace);
    channel.postMessage({ event, session: event === 'SIGNED_OUT' ? null : session });
    channel.close();
  }, { event, update });
}

test('visibility, same-user auth refresh and search remount preserve submitted results', async ({ page }) => {
  let sessions = 0, searches = 0, verifications = 0;
  page.on('request', request => {
    if (request.url().endsWith('/sessions')) sessions++;
    if (request.url().endsWith('/autocomplete')) searches++;
    if (request.url() === `${PROJECT}/auth/v1/user`) verifications++;
  });
  await page.goto('/discover'); await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  for (const event of ['SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED', 'visibility']) {
    const before = verifications;
    if (event === 'visibility') await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
    else await authEvent(page, event);
    await expect.poll(() => verifications).toBeGreaterThan(before);
    await page.waitForTimeout(450); // Past the former debounce window: nothing may be scheduled.
    await expect(page.getByRole('combobox')).toHaveValue('Juniper');
    await expect(page.getByRole('option')).toHaveCount(2);
    expect(sessions).toBe(1); expect(searches).toBe(1);
  }
  // Unmount and remount PlacesSearch without replacing the root identity provider.
  await page.getByRole('button', { name: /Fictional demo/ }).click();
  await page.getByRole('button', { name: /Real restaurants/ }).click();
  await expect(page.getByRole('combobox')).toHaveValue('Juniper');
  await expect(page.getByRole('option')).toHaveCount(2);
  expect(sessions).toBe(1); expect(searches).toBe(1);
});

test('slow typing makes no Google request until explicit submit; edits keep prior results', async ({ page }) => {
  const queries: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/autocomplete')) queries.push(request.postDataJSON().query);
  });
  await page.goto('/discover');
  const name = page.getByRole('combobox');
  await name.fill('Girl');
  await page.waitForTimeout(450);
  expect(queries).toEqual([]);
  await name.fill('Girl & the Goat');
  await page.waitForTimeout(450);
  expect(queries).toEqual([]);
  await name.press('Enter');
  await expect.poll(() => queries).toEqual(['Girl & the Goat']);
  await expect(page.getByRole('option')).toHaveCount(2);
  await name.fill('Girl & the Goat Chicago');
  await page.waitForTimeout(450);
  expect(queries).toEqual(['Girl & the Goat']);
  await expect(page.getByText(/Your inputs changed/)).toBeVisible();
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect.poll(() => queries).toEqual(['Girl & the Goat', 'Girl & the Goat Chicago']);
});

test('one complete-name entry with area set first uses exactly one Autocomplete across auth and remount', async ({ page }) => {
  let sessions = 0; const queries: string[] = [];
  page.on('request', request => {
    if (request.url().endsWith('/sessions')) sessions++;
    if (request.url().endsWith('/autocomplete')) queries.push(request.postDataJSON().query);
  });
  await page.goto('/discover');
  await page.getByLabel('City or area').fill('West Loop, Chicago, IL');
  await page.getByRole('combobox').fill('Girl & the Goat');
  expect(queries).toEqual([]);
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await authEvent(page, 'TOKEN_REFRESHED');
  await page.getByRole('button', { name: /Fictional demo/ }).click();
  await page.getByRole('button', { name: /Real restaurants/ }).click();
  await expect(page.getByRole('combobox')).toHaveValue('Girl & the Goat');
  await page.waitForTimeout(450);
  expect(queries).toEqual(['Girl & the Goat']);
  expect(sessions).toBe(1);
});

test('typed city followed by a real clipboard paste keeps one unchanged search context', async ({ page, context }) => {
  const requests: Array<{ query: string; area: string }> = [];
  page.on('request', request => {
    if (request.url().endsWith('/autocomplete')) requests.push(request.postDataJSON());
  });
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/discover');
  await page.getByLabel('City or area').pressSequentially('West Loop, Chicago, IL', { delay: 20 });
  await page.getByRole('combobox').focus();
  await page.evaluate(() => navigator.clipboard.writeText('Girl & the Goat'));
  await page.getByRole('combobox').press('Meta+V');
  expect(requests).toHaveLength(0);
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.getByText(/Your inputs changed/)).toHaveCount(0);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({ query: 'Girl & the Goat', area: 'West Loop, Chicago, IL' });
});

test('full page reload never replays a search, but an explicit new submit can start one', async ({ page }) => {
  let sessions = 0, searches = 0;
  page.on('request', request => {
    if (request.url().endsWith('/sessions')) sessions++;
    if (request.url().endsWith('/autocomplete')) searches++;
  });
  await page.goto('/discover');
  await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await authEvent(page, 'TOKEN_REFRESHED');
  await page.getByRole('button', { name: /Fictional demo/ }).click();
  await page.getByRole('button', { name: /Real restaurants/ }).click();
  await page.getByRole('combobox').fill('Juniper');
  await expect(page.getByRole('option')).toHaveCount(2);
  expect({ sessions, searches }).toEqual({ sessions: 1, searches: 1 });
  await page.reload(); // Same browser origin and guest, but a new in-memory Places client.
  await page.getByRole('combobox').fill('Juniper');
  await page.waitForTimeout(450);
  expect({ sessions, searches }).toEqual({ sessions: 1, searches: 1 });
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  expect({ sessions, searches }).toEqual({ sessions: 2, searches: 2 });
});

test('one-use backend guard blocks extra provider work after reload and duplicate interactions', async ({ page }) => {
  let sessionAttempts = 0, acceptedSessions = 0, searches = 0, details = 0;
  await page.route('**/api/dinetuned/discovery/sessions', route => {
    sessionAttempts++;
    if (acceptedSessions) return route.fulfill({ status: 429, json: { detail: 'This controlled Google test already used its one search session. No further Google request was made.' } });
    acceptedSessions++;
    return route.fulfill({ json: { session_token: SESSION, expires_at: '2099-01-01T00:00:00Z', request_limit: 1 } });
  });
  await page.route('**/api/dinetuned/discovery/autocomplete', route => {
    searches++;
    if (searches > 1) return route.fulfill({ status: 429, json: { detail: 'Controlled test request already used.' } });
    return route.fulfill({ json: { provider: 'google_places', session_token: SESSION, location_mode: 'global', predictions: [north, south] } });
  });
  await page.route('**/api/dinetuned/discovery/selection', route => {
    details++;
    return route.fulfill({ json: handoff(route.request().postDataJSON().place_id) });
  });
  await page.goto('/discover');
  await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await authEvent(page, 'TOKEN_REFRESHED');
  await page.getByRole('button', { name: /Fictional demo/ }).click();
  await page.getByRole('button', { name: /Real restaurants/ }).click();
  await page.getByRole('combobox').fill('Juniper');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('option').first().evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await expect(page.locator('.places-handoff')).toBeVisible();
  expect({ acceptedSessions, searches, details }).toEqual({ acceptedSessions: 1, searches: 1, details: 1 });
  await page.reload();
  await page.getByRole('combobox').fill('Juniper');
  await page.waitForTimeout(450);
  expect({ acceptedSessions, searches, details }).toEqual({ acceptedSessions: 1, searches: 1, details: 1 });
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByText(/controlled Google test already used its one search session/)).toBeVisible();
  await page.getByRole('button', { name: 'Start a new search' }).click();
  await expect.poll(() => sessionAttempts).toBe(3);
  expect({ acceptedSessions, searches, details }).toEqual({ acceptedSessions: 1, searches: 1, details: 1 });
});

test('rotated token is used for one Details request; repeated clicks and auth refresh retain branch', async ({ page }) => {
  let details = 0, searches = 0, release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const exp = Math.floor(Date.now() / 1000) + 7200;
  const token = [Buffer.from('{"alg":"HS256"}').toString('base64url'), Buffer.from(JSON.stringify({ sub: USER, exp, role: 'authenticated', is_anonymous: true })).toString('base64url'), 'rotated-offline-signature'].join('.');
  page.on('request', request => { if (request.url().endsWith('/autocomplete')) searches++; });
  await page.route('**/api/dinetuned/discovery/selection', async route => {
    details++; expect(route.request().headers().authorization).toBe('Bearer ' + token);
    await pending; await route.fulfill({ json: handoff('north') });
  });
  await page.goto('/discover'); await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  await authEvent(page, 'TOKEN_REFRESHED', { token });
  await page.getByRole('option').first().evaluate(el => { (el as HTMLElement).click(); (el as HTMLElement).click(); });
  await expect.poll(() => details).toBe(1); release();
  await expect(page.locator('.places-handoff')).toBeVisible();
  await authEvent(page, 'SIGNED_IN'); await page.waitForTimeout(500);
  await expect(page.locator('.places-address')).toHaveText(north.address);
  expect(details).toBe(1); expect(searches).toBe(1);
});

test('auth loss and recovery require an explicit search restart, never replay previous input', async ({ page }) => {
  let searches = 0;
  page.on('request', request => { if (request.url().endsWith('/autocomplete')) searches++; });
  await page.goto('/discover'); await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2);
  const savedSession = await page.evaluate(() => localStorage.getItem('dinetuned-supabase-offline-places.supabase.co')!);
  await authEvent(page, 'SIGNED_OUT');
  await expect(page.getByText(/Your cloud session ended/)).toBeVisible();
  // Supabase removes its stored token on sign-out. Simulate an explicit recovery
  // of that same identity, rather than sending SIGNED_IN with a null session.
  await page.evaluate(value => localStorage.setItem('dinetuned-supabase-offline-places.supabase.co', value), savedSession);
  await authEvent(page, 'SIGNED_IN');
  await expect(page.getByRole('combobox')).toHaveValue(''); // Old identity's private search stays discarded.
  await page.waitForTimeout(450); expect(searches).toBe(1);
  await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option')).toHaveCount(2); expect(searches).toBe(2);
});

test('actual user change discards pending branch, prevents replay and never creates a replacement guest', async ({ page }) => {
  let release!: () => void, details = 0, searches = 0, signups = 0;
  const pending = new Promise<void>(resolve => { release = resolve; });
  page.on('request', request => {
    if (request.url().endsWith('/autocomplete')) searches++;
    if (request.url().endsWith('/signup')) signups++;
  });
  await page.route('**/api/dinetuned/discovery/selection', async route => {
    details++; await pending; await route.fulfill({ json: handoff('north') }).catch(() => {});
  });
  await page.goto('/discover'); await page.getByRole('combobox').fill('Juniper');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await page.getByRole('option').first().click(); await expect.poll(() => details).toBe(1);
  await authEvent(page, 'SIGNED_IN', { userId: '33333333-3333-4333-8333-333333333333' });
  await expect(page.getByRole('heading', { name: 'Your guest session is needed.' })).toBeVisible();
  release(); await page.waitForTimeout(450);
  await expect(page.locator('.places-handoff')).toHaveCount(0);
  expect(searches).toBe(1); expect(details).toBe(1); expect(signups).toBe(1);
});
