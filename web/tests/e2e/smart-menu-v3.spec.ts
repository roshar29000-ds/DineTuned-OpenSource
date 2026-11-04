import { expect, test, type Page } from '@playwright/test';
import { closeMenuFilters, openMenuFilters, returningUser } from './session-helpers';

async function menu(page: Page, id = 'saigon-table') {
  await page.goto('/restaurant/' + id);
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
}

test('top, bottom and mobile Picks actions use the same branch, DNA and current preferences', async ({ page }, info) => {
  await returningUser(page);
  const source = await (await page.request.get('/api/dinetuned/restaurants/saigon-table-river-north/menu')).json();
  let requests = 0;
  page.on('request', request => { if (request.url().endsWith('/recommendation-sessions')) requests++; });
  const actions = ['.menu-picks-top', '.menu-next-step', ...(info.project.name === 'mobile' ? ['.menu-mobile-dock'] : [])];
  for (const action of actions) {
    await menu(page, 'saigon-table-river-north');
    await expect(page.locator('.mr-receipt')).not.toHaveAttribute('open');
    await expect(page.locator('.mr-evidence')).not.toBeVisible();
    await openMenuFilters(page);
    await page.getByLabel('Budget per dish', { exact: true }).fill('18.99');
    await page.getByLabel('Vegetarian', { exact: true }).check();
    await page.getByLabel('No pork', { exact: true }).check();
    await page.getByLabel('In the mood for', { exact: true }).selectOption('fresh');
    await page.getByLabel('My appetite', { exact: true }).selectOption('light');
    await closeMenuFilters(page);
    await expect(page.locator('.menu-picks-top .menu-picks-context')).toContainText('2 eligible dishes');
    await page.getByRole('button', { name: 'Complete menu 6', exact: true }).click();
    await expect(page.locator('[data-dish-id]')).toHaveCount(6);
    const expected = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
    expect(requests).toBe(actions.indexOf(action));
    const request = page.waitForRequest(request => request.url().endsWith('/recommendation-sessions'));
    if (action === '.menu-mobile-dock') await page.locator('.menu-next-step').scrollIntoViewIfNeeded();
    await page.locator(action).getByRole('button', { name: 'Find My Personal Picks', exact: true }).click();
    const sent = (await request).postDataJSON();
    expect(sent.restaurant_id).toBe('saigon-table-river-north');
    expect(sent.menu_version).toBe(source.version);
    expect(sent.constraints).toEqual(expected.constraints);
    expect(sent.profile).toEqual(expected.taste);
    await expect(page.locator('.v2-pick')).toHaveCount(2);
  }
});

test('menu slider uses whole dollars while typed exact limits and existing Picks controls stay precise', async ({ page }) => {
  await returningUser(page); await menu(page); await openMenuFilters(page);
  const input = page.getByLabel('Budget per dish', { exact: true });
  const slider = page.getByRole('slider', { name: 'Budget per dish slider', exact: true });
  await expect(slider).toHaveAttribute('step', '100');
  await slider.focus(); await slider.press('ArrowLeft');
  await expect(input).toHaveValue('29');
  await input.fill('18.99'); await closeMenuFilters(page); await page.reload();
  await expect(page.locator('.menu-picks-top button')).toBeEnabled(); await openMenuFilters(page);
  await expect(input).toHaveValue('18.99');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).constraints.max_price_minor)).toBe(1899);
  await slider.focus(); await slider.press('ArrowRight');
  await expect(input).toHaveValue('19');
  await input.fill('1001'); await expect(input).toHaveAttribute('aria-invalid', 'true');
  await slider.focus(); await expect(input).toHaveValue('19');
  await input.fill('18.99'); await closeMenuFilters(page);
  await page.locator('.menu-picks-top button').click();
  await page.locator('.pp-current-preferences > summary').click();
  await expect(page.getByRole('slider', { name: 'Budget per dish slider', exact: true })).toHaveAttribute('step', '1');
  await expect(page.getByLabel('Budget per dish', { exact: true })).toHaveValue('18.99');
});

test('pending, stale, failed and mismatched evaluations never enable a Picks action', async ({ page }) => {
  await returningUser(page); await menu(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let fail = false, wrongBranch = false;
  await page.route('**/api/dinetuned/menu/evaluate', async route => {
    const budget = route.request().postDataJSON().constraints.max_price_minor;
    if (fail) { await route.fulfill({ status: 503, json: { detail: 'Preference checks paused.' } }); return; }
    if (budget === 1899) await gate;
    const response = await route.fetch();
    const result = await response.json();
    if (wrongBranch) result.restaurant_id = 'another-branch';
    await route.fulfill({ json: result }).catch(() => {});
  });
  await openMenuFilters(page);
  const pending = page.waitForRequest(request => request.url().endsWith('/menu/evaluate') && request.postDataJSON().constraints.max_price_minor === 1899);
  await page.getByLabel('Budget per dish', { exact: true }).fill('18.99'); await pending;
  await closeMenuFilters(page);
  for (const button of await page.locator('.menu-picks-button').all()) await expect(button).toBeDisabled();
  await openMenuFilters(page); await page.getByLabel('Budget per dish', { exact: true }).fill('0'); await closeMenuFilters(page);
  await expect(page.locator('.menu-picks-top .menu-picks-context')).toContainText('Above-budget alternatives may qualify');
  release();
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  fail = true;
  await openMenuFilters(page); await page.getByLabel('Budget per dish', { exact: true }).fill('30'); await closeMenuFilters(page);
  await expect(page.locator('.inline-error')).toContainText('Preference checks paused.');
  await expect(page.getByRole('heading', { name: 'Your menu is still here.' })).toBeVisible();
  await page.getByRole('button', { name: 'Browse the complete menu' }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.dish-eligibility').first()).toContainText('Preference check unavailable');
  fail = false; wrongBranch = true;
  await page.getByRole('button', { name: 'Retry preference check' }).click();
  await expect(page.locator('.inline-error')).toContainText('does not match this menu');
  for (const button of await page.locator('.menu-picks-button').all()) await expect(button).toBeDisabled();
  wrongBranch = false; await page.getByRole('button', { name: 'Retry preference check' }).click();
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
});

test('preferences stay accessible while browsing, with keyboard dismissal and unclipped layouts', async ({ page }, info) => {
  await returningUser(page); await menu(page);
  await expect(page.locator('.mr-menu-arrival')).toHaveCSS('transform', 'none');
  await expect(page.locator('.menu-picks-top .menu-picks-context')).toContainText('6 eligible dishes');
  if (info.project.name === 'mobile') await expect(page.locator('.menu-mobile-dock')).not.toBeVisible();
  await page.screenshot({ path: `test-results/smart-menu-v3-${info.project.name}-top.png`, scale: 'css' });
  await page.locator('.menu-next-step').scrollIntoViewIfNeeded();
  if (info.project.name === 'mobile') {
    const dock = page.locator('.menu-mobile-dock');
    await expect(dock).toBeInViewport();
    const bounds = await dock.boundingBox();
    const nav = await page.getByRole('navigation', { name: 'Mobile navigation', exact: true }).boundingBox();
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(nav!.y + 1);
    const opener = dock.getByRole('button', { name: 'Open budget and preferences' });
    await opener.click();
    const sheet = page.getByRole('dialog', { name: 'Budget & preferences' });
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close preferences' })).toBeFocused();
    await page.getByRole('button', { name: 'Back to menu' }).focus(); await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close preferences' })).toBeFocused();
    await page.screenshot({ path: 'test-results/smart-menu-v3-mobile-filters.png', scale: 'css' });
    await page.keyboard.press('Escape'); await expect(sheet).not.toBeVisible(); await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
  } else {
    await expect(page.locator('.menu-filter-aside')).toBeInViewport();
    await page.locator('.menu-filter-trigger').click();
    await expect(page.getByLabel('Budget per dish', { exact: true })).toBeFocused();
  }
  await openMenuFilters(page); await page.getByLabel('Budget per dish', { exact: true }).fill('0'); await closeMenuFilters(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-dish-id]')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Menu categories' }).getByRole('link').first().click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).constraints.max_price_minor)).toBe(0);
  await expect(page.locator('.menu-category-section').first()).toBeFocused();
  await page.screenshot({ path: `test-results/smart-menu-v3-${info.project.name}-dishes.png`, scale: 'css' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
