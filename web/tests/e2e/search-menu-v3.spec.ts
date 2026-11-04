import { expect, test, type Page } from '@playwright/test';
import type { RestaurantMenu, RestaurantSearch } from '../../lib/contracts';
import { returningUser } from './session-helpers';

async function readyMenu(page: Page) {
  await page.goto('/restaurant/saigon-table');
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
}
async function previewRecovery(page: Page, status = 'missing') {
  await page.locator('.mr-receipt > summary').click();
  await page.locator('.mr-demo-scenarios > summary').click();
  await page.getByRole('button', { name: `Preview ${status} menu`, exact: true }).click();
  await expect(page.getByText('SIMULATED RECOVERY STATE · INTERFACE PREVIEW')).toBeVisible();
}
async function menuImage(page: Page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 220;
    const context = canvas.getContext('2d')!; context.fillStyle = '#fffdf6'; context.fillRect(0, 0, 320, 220);
    context.fillStyle = '#203f33'; context.font = '22px serif'; context.fillText('Local test menu', 30, 55);
    context.font = '14px sans-serif'; context.fillText('No extraction is performed', 30, 100);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return { name: 'sample-menu.png', mimeType: 'image/png', buffer: Buffer.from(base64, 'base64') };
}

test('autocomplete is branch-specific and requires an explicit keyboard selection', async ({ page }) => {
  await returningUser(page); await page.goto('/discover');
  await expect(page.locator('.rs-section-heading h2')).toHaveText('Different kitchens. Your taste.');
  const search = page.getByRole('combobox', { name: 'Restaurant name or neighborhood' });
  await search.fill('Saigon');
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page.locator('.rs-section-heading h2')).toHaveText('Find your table.');
  await expect(page.getByRole('option').first()).toContainText('12 Lantern Lane, Chicago');
  await expect(page.getByRole('option').first()).toContainText('Vietnamese');
  await search.press('Enter'); await expect(page).toHaveURL(/\/discover$/);
  await search.press('ArrowDown');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await search.press('ArrowDown');
  await expect(page.getByRole('option').last()).toHaveAttribute('aria-selected', 'true');
  await search.press('Escape'); await expect(search).toHaveAttribute('aria-expanded', 'false');
  await search.press('ArrowUp'); await search.press('Enter');
  await expect(page).toHaveURL(/\/restaurant\/saigon-table-river-north$/);
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.venue-facts')).toContainText('River North');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).selection)).toBeNull();
});

test('nearby autocomplete is opt-in and location denial retains name search', async ({ page }) => {
  await returningUser(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition: (_success: unknown, failure: (reason: unknown) => void) => failure({ code: 1 }) } });
  });
  await page.goto('/discover');
  await page.getByRole('combobox').fill('Saigon');
  await expect(page.getByRole('option')).toHaveCount(2);
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.getByText('Location wasn’t shared.', { exact: false })).toBeVisible();
  await page.getByRole('combobox').focus();
  await expect(page.getByRole('option')).toHaveCount(2);
  await expect(page).toHaveURL(/\/discover$/);
});

test('a delayed old query cannot replace newer results; errors and no results recover', async ({ page }) => {
  await returningUser(page);
  const all = await (await page.request.get('/api/dinetuned/restaurants')).json() as RestaurantSearch;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/restaurants?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    if (query === 'Saigon') await gate;
    if (query === 'failure') { await route.fulfill({ status: 503, json: { detail: 'Search paused. Please retry.' } }); return; }
    await route.fulfill({ json: { ...all, restaurants: all.restaurants.filter(item => item.name.toLowerCase().includes(query.toLowerCase())) } }).catch(() => {});
  });
  await page.goto('/discover');
  const search = page.getByRole('combobox');
  const oldRequest = page.waitForRequest(request => request.url().includes('/api/dinetuned/restaurants?') && new URL(request.url()).searchParams.get('q') === 'Saigon');
  await search.fill('Saigon');
  await oldRequest;
  await expect(page.locator('.rs-dropdown-message')).toContainText('Looking');
  await search.fill('Luna'); await expect(page.getByRole('option')).toHaveCount(1);
  await expect(page.getByRole('option')).toContainText('Luna Trattoria');
  release(); await expect(page.getByRole('option')).toContainText('Luna Trattoria');
  await search.fill('failure'); await expect(page.getByRole('button', { name: 'Retry search' })).toBeVisible();
  await page.unroute('**/api/dinetuned/restaurants?*');
  await page.getByRole('button', { name: 'Retry search' }).click();
  await expect(page.locator('.rs-dropdown-message')).toContainText('No matching sample venues');
  await search.fill('not-a-demo-venue'); await expect(page.locator('.rs-dropdown-message')).toContainText('No matching sample venues');
  await page.getByRole('button', { name: 'Clear restaurant search' }).click();
  await expect(page.locator('.restaurant-card')).toHaveCount(6);
});

test('leaving a slow retrieval cannot substitute its menu for the next restaurant', async ({ page }) => {
  await returningUser(page);
  const oldMenu = await (await page.request.get('/api/dinetuned/restaurants/saigon-table/menu')).json();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/restaurants/saigon-table/menu', async route => {
    await gate; await route.fulfill({ json: oldMenu }).catch(() => {});
  });
  await page.goto('/restaurant/saigon-table');
  await expect(page.getByRole('heading', { name: /A little closer/ })).toBeVisible();
  await page.getByRole('link', { name: 'Back to restaurants' }).click();
  await page.getByRole('combobox').fill('Luna');
  await page.getByRole('option').click();
  await expect(page.getByRole('heading', { name: 'Luna Trattoria.' })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: 'Saigon Table.' })).toHaveCount(0);
  await expect(page.locator('.menu-masthead h1')).toHaveText('Luna Trattoria.');
});

test('real retrieval exposes honest stages and preserves constraints through the full menu', async ({ page }, info) => {
  await returningUser(page); await page.goto('/discover');
  await expect(page.getByRole('combobox')).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dinetuned-v2')!);
    state.constraints = { ...state.constraints, max_price_minor: 1899, dietary_restrictions: ['vegetarian'], allergies: { allergens: ['peanut'], other: 'kiwi' }, mood: 'fresh', appetite: 'light' };
    state.taste.dietary_restrictions = state.constraints.dietary_restrictions; state.taste.allergies = state.constraints.allergies;
    localStorage.setItem('dinetuned-v2', JSON.stringify(state));
  });
  await page.reload();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/dinetuned/restaurants/saigon-table/menu', async route => { await gate; await route.continue(); });
  await page.getByRole('combobox').fill('Saigon');
  await page.getByRole('option').filter({ hasText: 'Downtown' }).click();
  await expect(page.getByRole('heading', { name: /A little closer/ })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Menu preparation stages' }).locator('li')).toHaveCount(4);
  await expect(page.getByText('No AI extraction is taking place.', { exact: false })).toBeVisible();
  await expect(page.locator('.mr-paper h2')).toHaveText('Saigon Table');
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  await page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' });
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: `test-results/menu-loading-v3-${info.project.name}.png`, fullPage: true, scale: 'css' });
  release();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toHaveText('No matching picks yet');
  await expect(page.locator('.menu-picks-top button')).toBeDisabled();
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
  expect(state.constraints).toMatchObject({ max_price_minor: 1899, dietary_restrictions: ['vegetarian'], allergies: { allergens: ['peanut'], other: 'kiwi' }, mood: 'fresh', appetite: 'light' });
  expect(state.selection).toBeNull();
  await page.locator('.mr-receipt > summary').click();
  await expect(page.locator('.mr-evidence')).toContainText('Every item declared by this sample is present.');
});

test('incomplete, outdated and mismatched menus are blocked without evaluation or substitute dishes', async ({ page }) => {
  await returningUser(page);
  const source = await (await page.request.get('/api/dinetuned/restaurants/saigon-table/menu')).json() as RestaurantMenu;
  let variant = 'incomplete', evaluations = 0;
  page.on('request', request => { if (request.url().includes('/menu/evaluate')) evaluations++; });
  await page.route('**/api/dinetuned/restaurants/saigon-table/menu', route => {
    const menu = structuredClone(source);
    if (variant === 'incomplete') menu.source.completeness = 'partial';
    if (variant === 'outdated') menu.source.retrieved_at = '2020-01-01T00:00:00Z';
    if (variant === 'unreliable') menu.restaurant.id = 'another-branch';
    if (variant === 'missing') { menu.categories = []; menu.total_items = 0; menu.restaurant.item_count = 0; }
    return route.fulfill({ json: menu });
  });
  await page.goto('/restaurant/saigon-table');
  await expect(page.getByRole('heading', { name: 'A few pages are missing.' })).toBeVisible();
  variant = 'outdated'; await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Let’s find a fresher edition.' })).toBeVisible();
  variant = 'unreliable'; await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'This menu needs a closer look.' })).toBeVisible();
  variant = 'missing'; await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'A menu worth waiting for.' })).toBeVisible();
  await expect(page.locator('[data-dish-id]')).toHaveCount(0); expect(evaluations).toBe(0);
  await page.unroute('**/api/dinetuned/restaurants/saigon-table/menu');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
});

test('upload and camera sources preview locally without creating extracted dishes', async ({ page }) => {
  await returningUser(page); await readyMenu(page); await previewRecovery(page, 'incomplete');
  const image = await menuImage(page);
  await page.getByLabel('Upload menu file').setInputFiles(image);
  await expect(page.getByRole('img', { name: /Your selected local menu/ })).toBeVisible();
  await expect(page.getByText('Your file has not been uploaded.', { exact: false })).toBeVisible();
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear and close' }).click();
  await page.getByLabel('Capture menu photo').setInputFiles(image);
  await expect(page.getByText('This captures an image; it does not read menu text.', { exact: false })).toBeVisible();
  await page.getByLabel('Upload menu file').setInputFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF') });
  await expect(page.getByText('File selected · no page extraction')).toBeVisible();
  await page.getByLabel('Upload menu file').setInputFiles({ name: 'bad.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('region', { name: 'Menu source options' }).getByRole('alert')).toContainText('format could not be confirmed');
  await page.getByRole('button', { name: 'Return to available sample menu' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
});

test('QR links are validated locally, with a graceful unsupported-browser fallback', async ({ page }) => {
  await returningUser(page);
  await page.addInitScript(() => { Object.defineProperty(globalThis, 'BarcodeDetector', { configurable: true, value: undefined }); });
  await readyMenu(page); await previewRecovery(page);
  await page.getByRole('button', { name: 'Scan QR Code', exact: false }).click();
  await page.getByLabel('Choose QR image').setInputFiles(await menuImage(page));
  await expect(page.getByText('This browser cannot decode QR images.', { exact: false })).toBeVisible();
  await page.getByLabel('Or paste the menu’s web address').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Check link' }).click();
  await expect(page.getByRole('link', { name: 'Open link in new tab' })).toHaveCount(0);
  await page.getByLabel('Or paste the menu’s web address').fill('https://example.com/menu');
  await page.getByRole('button', { name: 'Check link' }).click();
  await expect(page.getByRole('link', { name: 'Open link in new tab' })).toHaveAttribute('href', 'https://example.com/menu');
  await expect(page.getByText('The website and its menu have not been checked.', { exact: false })).toBeVisible();
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/restaurant\/saigon-table$/);
});

test('supported QR adapter decodes a URL without fetching or opening it', async ({ page }) => {
  await returningUser(page);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'BarcodeDetector', { configurable: true, value: class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return [{ rawValue: 'https://example.com/qr-menu' }]; }
    } });
  });
  const externalRequests: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://example.com')) externalRequests.push(request.url()); });
  await readyMenu(page); await previewRecovery(page);
  await page.getByLabel('Choose QR image').setInputFiles(await menuImage(page));
  await expect(page.getByRole('link', { name: 'Open link in new tab' })).toHaveAttribute('href', 'https://example.com/qr-menu');
  await expect(page.getByText('A web address was decoded locally.', { exact: false })).toBeVisible();
  expect(externalRequests).toHaveLength(0);
});

test('a late QR decode cannot replace a newer pasted link', async ({ page }) => {
  await returningUser(page);
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'BarcodeDetector', { configurable: true, value: class {
      static async getSupportedFormats() { return ['qr_code']; }
      async detect() { return new Promise(resolve => { Object.assign(globalThis, { releaseTestQr: () => resolve([{ rawValue: 'https://example.com/old-menu' }]) }); }); }
    } });
  });
  await readyMenu(page); await previewRecovery(page);
  await page.getByLabel('Choose QR image').setInputFiles(await menuImage(page));
  await expect.poll(() => page.evaluate(() => 'releaseTestQr' in globalThis)).toBe(true);
  await page.getByLabel('Or paste the menu’s web address').fill('https://example.com/new-menu');
  await page.getByRole('button', { name: 'Check link' }).click();
  await page.evaluate(() => (globalThis as unknown as { releaseTestQr: () => void }).releaseTestQr());
  await expect(page.getByRole('link', { name: 'Open link in new tab' })).toHaveAttribute('href', 'https://example.com/new-menu');
});

test('search, dropdown and recovery options fit phone and desktop widths', async ({ page }, info) => {
  await returningUser(page); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto('/discover');
  await page.getByRole('combobox').fill('Saigon'); await expect(page.getByRole('option')).toHaveCount(2);
  const widths = info.project.name === 'desktop' ? [320, 768, 1440] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `test-results/search-v3-${info.project.name}.png`, fullPage: true, scale: 'css' });
  await page.getByRole('option').filter({ hasText: 'Downtown' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await previewRecovery(page, 'unreliable');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.screenshot({ path: `test-results/menu-recovery-v3-${info.project.name}.png`, fullPage: true, scale: 'css' });
});
