import { expect, test, type Page } from '@playwright/test';
import { returningUser, savedProfile, openMenuFilters, closeMenuFilters } from './session-helpers';
import type { TasteProfile } from '../../lib/contracts';

async function menu(page: Page) {
  await page.goto('/restaurant/saigon-table');
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
}
async function picks(page: Page, count: number) {
  await page.locator('.menu-picks-top button').click();
  await expect(page.locator('.signature-pick')).toHaveCount(count);
  await expect(page.locator('.pp-loading')).toHaveCount(0);
}

test('three, two, one and zero picks stay honest about budget and fit both viewports', async ({ page }, info) => {
  await returningUser(page); await menu(page); await picks(page, 3);
  await expect(page.locator('.signature-collection')).toHaveAttribute('data-count', '3');
  await expect(page.locator('.pp-dish-visual .art-caption')).toHaveCount(3);
  for (const indicator of await page.locator('.pp-compatibility').all()) await expect(indicator).not.toContainText(/\d+%/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/signature-picks-${info.project.name}.png`, fullPage: true, scale: 'css' });
  await page.getByRole('link', { name: 'Back to the complete menu', exact: true }).click();
  await openMenuFilters(page);
  await page.getByLabel('Budget per dish', { exact: true }).fill('18.99');
  await page.getByLabel('Vegetarian', { exact: true }).check();
  await page.getByLabel('No pork', { exact: true }).check();
  await closeMenuFilters(page); await picks(page, 2);
  await expect(page.locator('.pp-budget-position.above')).toHaveText('$0.01 above your $18.99 target');
  await expect(page.locator('.signature-collection')).toHaveAttribute('data-count', '2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByLabel('Hide above-budget alternatives').check();
  await expect(page.locator('.signature-pick')).toHaveCount(1);
  await expect(page.locator('.signature-collection')).toHaveAttribute('data-count', '1');
  await expect(page.locator('.signature-pick')).toContainText('Bánh Mì');
  await page.reload();
  await expect(page.getByLabel('Hide above-budget alternatives')).toBeChecked();
  await expect(page.locator('.signature-pick')).toHaveCount(1);
  await page.locator('.pp-current-preferences > summary').click();
  await page.getByLabel('Budget per dish', { exact: true }).fill('0');
  await expect(page.getByRole('heading', { name: 'Your closest matches sit above the target.' })).toBeVisible();
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show above-budget alternatives' }).click();
  await expect(page.locator('.signature-pick')).toHaveCount(2);
  await expect(page.locator('.pp-budget-position.above').first()).toContainText('above your $0 target');
  await page.locator('.pp-evidence > summary').first().click();
  await expect(page.getByText('Where the evidence ends').first()).toBeVisible();
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'Back to the complete menu', exact: true }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
  await openMenuFilters(page);
  await page.locator('.allergy-panel > summary').click();
  await page.getByLabel('Peanuts', { exact: true }).check();
  await closeMenuFilters(page);
  await expect(page.locator('.menu-picks-top button')).toBeDisabled();
  await page.goto('/picks');
  await expect(page.getByRole('heading', { name: 'A little care before a recommendation.' })).toBeVisible();
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
});

test('late responses cannot replace new preferences; meal protein never mutates saved DNA', async ({ page }) => {
  await returningUser(page); await menu(page); await picks(page, 3);
  const dna = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).taste);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let released!: () => void;
  const delivered = new Promise<void>(resolve => { released = resolve; });
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const body = route.request().postDataJSON();
    const response = await route.fetch();
    if (body.constraints.max_price_minor === 1899) {
      await gate;
      await route.fulfill({ response }).catch(() => {});
      released();
    } else await route.fulfill({ response });
  });
  await page.locator('.pp-current-preferences > summary').click();
  const pending = page.waitForRequest(r => r.url().endsWith('/recommendation-sessions') && r.postDataJSON().constraints.max_price_minor === 1899);
  await page.getByLabel('Budget per dish', { exact: true }).fill('18.99'); await pending;
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  await expect(page.locator('.complete-table')).toHaveCount(0);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.getByLabel('Budget per dish', { exact: true }).fill('0');
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  release(); await delivered;
  await expect(page.locator('.pp-budget-position.above')).toHaveCount(3);
  for (const badge of await page.locator('.pp-budget-position.above').all()) await expect(badge).toContainText('above your $0 target');
  await expect(page.locator('.ct-introduction')).toContainText('Your $0 target is per dish');
  const changed = page.waitForRequest(r => r.url().endsWith('/recommendation-sessions') && r.postDataJSON().options.protein_preference === 'chicken');
  await page.getByLabel('Protein preference for this meal', { exact: true }).selectOption('chicken');
  expect((await changed).postDataJSON().constraints.max_price_minor).toBe(0);
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).taste)).toEqual(dna);
});

test('wrong response identity fails closed and a new branch requires another full menu review', async ({ page }) => {
  await returningUser(page); await menu(page);
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch();
    const data = await response.json(); data.menu_version = 'obsolete-version';
    await route.fulfill({ json: data });
  });
  await page.locator('.menu-picks-top button').click();
  await expect(page.getByText('These picks do not match your current restaurant and preferences. Please retry.')).toBeVisible();
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  await expect(page.locator('.complete-table')).toHaveCount(0);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.unroute('**/api/dinetuned/recommendation-sessions');
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  await page.goto('/restaurant/saigon-table-river-north');
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await page.goto('/picks');
  await expect(page.getByRole('heading', { name: 'The menu comes first.' })).toBeVisible();
  await page.goto('/restaurant/saigon-table-river-north');
  await picks(page, 3);
  await expect(page.locator('.pp-venue')).toContainText('River North');
});

test('unknown Taste DNA never creates invented compatibility or filler picks', async ({ page }) => {
  const state = { ...structuredClone(savedProfile), taste: { ...savedProfile.taste, axes: { spice: null, richness: null, freshness: null, crunch: null, aromatic: null, sweetness: null, umami: null } as TasteProfile['axes'] } };
  await page.addInitScript(value => localStorage.setItem('dinetuned-v2', JSON.stringify(value)), state);
  await menu(page);
  await page.locator('.menu-picks-top button').click();
  await expect(page.getByRole('heading', { name: 'A few more clues. A better pick.' })).toBeVisible();
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
