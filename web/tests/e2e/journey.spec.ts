import { test, expect, type Page } from '@playwright/test';
import { completeTastingNotes } from './taste-helpers';
import { returningUser, openMenuFilters as openFilters, closeMenuFilters } from './session-helpers';
async function openMenu(page: Page) {
  await page.goto('/restaurant/saigon-table');
  await expect(page.getByRole('heading', { name: 'Saigon Table.' })).toBeVisible();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
}

test('new user completes guided journey and sees every menu category before picks', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Find my taste' }).click();
  await completeTastingNotes(page);
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  await page.locator('.v3-dimension').filter({ has: page.locator('summary strong', { hasText: 'Heat' }) }).locator('summary').click();
  await expect(page.getByLabel('Heat', { exact: true })).toHaveValue('18');
  await page.getByRole('link', { name: 'Find a restaurant', exact: true }).click();
  await page.getByRole('button', { name: /Fictional demo/ }).click();
  await page.getByLabel('Restaurant name or neighborhood').fill('Saigon');
  await page.getByRole('option').filter({ hasText: 'Downtown' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.getByRole('heading', { name: 'Small plates', exact: true })).toBeVisible();
  const recommendation = page.waitForRequest(request => request.url().endsWith('/recommendation-sessions'));
  await page.locator('.menu-picks-top button').click();
  const notes = (await recommendation).postDataJSON().taste_evidence;
  expect(notes.favorite_dishes).toEqual(['tacos']);
  expect(notes.textures).toContain('crisp');
  expect(notes.cooking_methods).toContain('fried');
  expect(notes.disliked_ingredients).toContain('sweet');
  // This rich, mild, crisp profile has just one strong match here; never pad the list.
  await expect(page.locator('.v2-pick')).toHaveCount(1);
  await expect(page.locator('.v2-pick')).toContainText('Bánh Mì');
});

test('returning users go to search; direct picks never default to a restaurant', async ({ page }) => {
  await returningUser(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/discover$/);
  await page.goto('/picks');
  await expect(page.getByRole('heading', { name: 'The menu comes first.' })).toBeVisible();
  await expect(page.locator('.v2-pick')).toHaveCount(0);
});

test('menu filters combine, exact budgets persist, complete menu remains accessible', async ({ page }) => {
  await returningUser(page);
  await openMenu(page);
  await openFilters(page);
  await page.getByLabel('Budget per dish', { exact: true }).fill('18.99');
  await page.getByLabel('Vegetarian', { exact: true }).check();
  await page.getByLabel('No pork', { exact: true }).check();
  await closeMenuFilters(page);
  await expect(page.locator('[data-dish-id]')).toHaveCount(2);
  await expect(page.getByText('2 of 6 dishes shown', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Complete menu 6', exact: true }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await openFilters(page);
  await expect(page.getByLabel('Vegetarian', { exact: true })).toBeChecked();
  await closeMenuFilters(page);
  await page.locator('.menu-picks-top button').click();
  await expect(page.locator('.v2-pick')).toHaveCount(2);
  await expect(page.locator('.pp-budget-bar')).toContainText('$18.99');
  await page.locator('.pp-current-preferences > summary').click();
  await expect(page.getByLabel('Budget per dish', { exact: true })).toHaveValue('18.99');
  await page.reload();
  await expect(page.locator('.v2-pick')).toHaveCount(2);
  await page.locator('.pp-current-preferences > summary').click();
  await expect(page.getByLabel('Budget per dish', { exact: true })).toHaveValue('18.99');
});

test('allergy uncertainty excludes picks without hiding the complete menu', async ({ page }) => {
  await returningUser(page);
  await openMenu(page);
  await openFilters(page);
  await page.locator('.allergy-panel > summary').click();
  await page.getByLabel('Peanuts', { exact: true }).check();
  await closeMenuFilters(page);
  await expect(page.getByRole('heading', { name: 'Nothing fits every filter yet.' })).toBeVisible();
  await expect(page.locator('.menu-picks-top button')).toBeDisabled();
  await page.getByRole('button', { name: 'Complete menu 6', exact: true }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.getByText('Restaurant confirmation is needed.')).toBeVisible();
  await openFilters(page);
  await expect(page.getByLabel('Peanuts', { exact: true })).toBeChecked();
});

test('invalid restaurant and failed API are recoverable and never substitute a venue', async ({ page }) => {
  await returningUser(page);
  await page.goto('/restaurant/does-not-exist');
  await expect(page.getByText('Restaurant not found. Choose a restaurant from search.')).toBeVisible();
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  await page.route('**/api/dinetuned/restaurants/saigon-table/menu', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'The dining service is unavailable.' }) }));
  await page.goto('/restaurant/saigon-table');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await page.unroute('**/api/dinetuned/restaurants/saigon-table/menu');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
});

test('feedback is idempotent and visible in dining memories', async ({ page }) => {
  await returningUser(page);
  const requests: unknown[] = [];
  page.on('request', request => { if (request.url().endsWith('/recommendation-sessions')) requests.push(request.postDataJSON()); });
  await openMenu(page);
  await page.locator('.menu-picks-top button').click();
  const card = page.locator('.v2-pick').first();
  await card.locator('.feedback-sheet summary').click();
  await expect(card.getByRole('button', { name: 'Loved it', exact: true })).toBeDisabled();
  await card.getByLabel('I confirm I tried this dish').check();
  await card.getByLabel('What stood out?', { exact: false }).fill('Wonderful texture');
  await card.getByRole('button', { name: 'Loved it' }).click();
  await expect(card.getByRole('status')).toContainText('Saved in this browser only.');
  await expect(card.getByRole('button', { name: 'Loved it', exact: true })).toHaveCount(0);
  const history = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).feedback);
  expect(history[0].menu_version).toMatch(/^demo-/);
  const nav = page.getByRole('navigation', { name: test.info().project.name === 'mobile' ? 'Mobile navigation' : 'Main navigation', exact: true });
  await nav.getByRole('link', { name: 'Memories' }).click();
  await expect(page.getByText('“Wonderful texture”')).toBeVisible();
  await expect(page.locator('.memory-item')).toHaveCount(2); // Separate tried-dish event and rating.
  await expect(page.locator('.memory-item-date').filter({ hasText: 'Tried' })).toHaveCount(1);
  await expect(page.locator('.memory-item-date').filter({ hasText: 'Rated' })).toHaveCount(1);
  expect(requests).toHaveLength(1); // Saving feedback does not regenerate this session.
  const nextRequest = page.waitForRequest(request => request.url().endsWith('/recommendation-sessions'));
  await page.goto('/picks');
  const sent = (await nextRequest).postDataJSON();
  expect(sent.bridge_feedback).toHaveLength(1);
  expect(sent.bridge_feedback[0].menu_version).toBe(history[0].menu_version);
  expect(sent.bridge_feedback[0]).not.toHaveProperty('note');
  await expect(page.locator('.v2-pick')).toHaveCount(3);
});

test('menu remains readable without external images and has no horizontal overflow', async ({ page }) => {
  await returningUser(page);
  await openMenu(page);
  await expect(page.getByRole('img', { name: /Illustrated placeholder for/ })).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
  await page.screenshot({ path: 'test-results/menu-'+test.info().project.name+'.png', fullPage: true });
});

test('reset clears the saved profile before returning to welcome', async ({ page }) => {
  await returningUser(page);
  await page.goto('/how-it-works');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset demo' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Find my taste' })).toBeVisible();
});

test('nearby sorting requires an explicit request and never selects a venue', async ({ page, context }) => {
  await returningUser(page);
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 41.895, longitude: -87.635 });
  const nearbyRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/api/dinetuned/restaurants?') && request.url().includes('latitude=')) nearbyRequests.push(request.url());
  });
  await page.goto('/discover');
  await page.getByLabel('Restaurant name or neighborhood').fill('Saigon Table');
  await expect(page.locator('.restaurant-card')).toHaveCount(2);
  expect(nearbyRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Use my location' }).click();
  await expect(page.locator('.restaurant-card').first()).toHaveAttribute('href', '/restaurant/saigon-table-river-north');
  await page.getByRole('combobox').focus();
  await expect(page.getByRole('option').first()).toContainText('River North');
  await expect.poll(() => nearbyRequests.length).toBeGreaterThan(0);
  await expect(page).toHaveURL(/\/discover$/);
});

test('menu and expanded controls fit narrow phones, tablets, and wide desktops', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Additional viewport coverage runs once.');
  await returningUser(page);
  await openMenu(page);
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await openFilters(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.getByLabel('Budget per dish', { exact: true })).toBeVisible();
    await closeMenuFilters(page);
  }
});
