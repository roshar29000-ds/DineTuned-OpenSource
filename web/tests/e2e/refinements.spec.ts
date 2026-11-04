import { test, expect, type Page } from '@playwright/test';
import type { RecommendationSession } from '../../lib/contracts';
import { savedProfile } from './session-helpers';

async function start(page: Page, restaurant = 'saigon-table') {
  const state = { ...structuredClone(savedProfile), taste: { ...savedProfile.taste,
    axes: { ...savedProfile.taste.axes, spice: .45, richness: .6, freshness: .6, crunch: .5, aromatic: .8 } } };
  await page.addInitScript(value => {
    if (!sessionStorage.getItem('refinements-seeded')) {
      localStorage.setItem('dinetuned-v2', JSON.stringify(value));
      sessionStorage.setItem('refinements-seeded', 'true');
    }
  }, state);
  await page.goto(`/restaurant/${restaurant}`);
  await expect(page.locator('[data-dish-id]')).toHaveCount(restaurant === 'saigon-table' ? 6 : 4);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
  return recompute(page, () => page.locator('.menu-picks-top button').click());
}
async function recompute(page: Page, action: () => Promise<unknown>): Promise<RecommendationSession> {
  const pending = page.waitForResponse(res => res.url().endsWith('/recommendation-sessions') && res.request().method() === 'POST');
  await action(); const response = await pending; expect(response.status()).toBe(200);
  const session: RecommendationSession = await response.json();
  await expect(page.locator('.pp-loading')).toHaveCount(0);
  await expect(page.locator('.signature-pick')).toHaveCount(session.recommendations.length);
  return session;
}
const ids = (session: RecommendationSession) => session.recommendations.map(rec => rec.dish.id);
async function consistent(page: Page, session: RecommendationSession) {
  expect(await page.locator('.signature-pick').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-pick-id')))).toEqual(ids(session));
  const primary = new Set(ids(session)), skipped = new Set(session.refinement_result!.request.avoid_dish_ids);
  for (const rec of session.recommendations) {
    expect(skipped.has(rec.dish.id)).toBe(false);
    expect(rec.taste_bridge?.dish_id).toBe(rec.dish.id);
    expect(rec.taste_bridge?.menu_version).toBe(session.menu_version);
    const bridge = page.locator(`[data-pick-id="${rec.dish.id}"] .taste-bridge`);
    await expect(bridge).toHaveAttribute('data-bridge-status', rec.taste_bridge!.status);
    if (rec.taste_bridge!.status === 'unavailable') {
      await expect(bridge.locator('.tb-destination')).toHaveCount(0);
      await expect(bridge.locator('.tb-fallback')).toContainText('A few more taste clues');
    } else await expect(bridge.locator('.tb-destination')).toContainText(rec.dish.name);
  }
  for (const rec of session.worth_the_stretch!.picks) {
    expect(primary.has(rec.dish.id) || skipped.has(rec.dish.id)).toBe(false);
    await expect(page.locator(`[data-stretch-id="${rec.dish.id}"]`)).toBeVisible();
  }
  for (const combination of session.meal_combinations!.combinations) {
    expect(primary.has(combination.main.item_id)).toBe(true);
    for (const item of [combination.main, ...combination.additions]) expect(skipped.has(item.item_id)).toBe(false);
    expect(combination.subtotal_minor).toBe(combination.main.price_minor + combination.additions.reduce((sum, part) => sum + part.price_minor, 0));
  }
}

test('one-tap refinements genuinely change picks, combine, reset and leave DNA unchanged', async ({ page }, info) => {
  const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
  const original = await start(page);
  const dna = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).taste);
  await expect(page.getByRole('button', { name: 'Reset refinements', exact: true })).toBeDisabled();
  let session = await recompute(page, () => page.getByRole('button', { name: 'Something lighter', exact: true }).click());
  expect(ids(session)).toEqual(['banh-mi', 'spring-rolls', 'lemongrass']);
  await expect(page.getByRole('button', { name: 'Something lighter', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await consistent(page, session);
  session = await recompute(page, () => page.getByRole('button', { name: 'More spicy', exact: true }).click());
  expect(session.refinement_result!.request.preferences).toEqual(['lighter', 'spicier']);
  expect(session.profile).toEqual(original.profile);
  await consistent(page, session);
  const button = page.getByRole('button', { name: 'Something lighter', exact: true });
  await button.focus();
  session = await recompute(page, () => page.keyboard.press('Space'));
  expect(ids(session)).toEqual(['bun-bo', 'lemongrass', 'banh-mi']);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  await expect(button).toBeFocused();
  await recompute(page, () => page.getByRole('button', { name: 'More adventurous', exact: true }).click());
  session = await recompute(page, () => page.getByRole('button', { name: 'More spicy', exact: true }).click());
  expect(ids(session)).toEqual(['bun-bo', 'banh-mi', 'tofu-bun']);
  await consistent(page, session);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await button.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 800 });
  await page.locator('.mm-limits summary').click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.make-it-more-me').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await page.locator('.make-it-more-me').screenshot({ path: `test-results/refinements-${info.project.name}.png`, scale: 'css',
    style: '.site-header, .mobile-nav, .skip-link { visibility: hidden !important; }' });
  session = await recompute(page, () => page.getByRole('button', { name: 'Reset refinements', exact: true }).click());
  expect(session.recommendations).toEqual(original.recommendations);
  expect(session.meal_combinations).toEqual(original.meal_combinations);
  expect(session.worth_the_stretch).toEqual(original.worth_the_stretch);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!).taste)).toEqual(dna);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('dinetuned-v2')!)))).not.toContain('refinements');
  expect(errors).toEqual([]);
});

test('less creamy uses menu evidence and try another exhausts strong alternatives honestly', async ({ page }) => {
  const original = await start(page, 'casa-sol');
  let session = await recompute(page, () => page.getByRole('button', { name: 'Less creamy', exact: true }).click());
  expect(ids(session)).toEqual(['mushroom-taco', 'chicken-tinga', 'birria']);
  await page.locator('.mm-limits summary').click();
  await expect(page.locator('.mm-limits')).toContainText("Other dishes' creaminess is unknown");
  await consistent(page, session);
  const prior = ids(session);
  session = await recompute(page, () => page.getByRole('button', { name: 'Try another dish', exact: true }).click());
  expect(ids(session)).toEqual(['elote']);
  expect(prior.some(id => ids(session).includes(id))).toBe(false);
  await expect(page.locator('.mm-set-aside')).toContainText('3 earlier picks set aside');
  await expect(page.locator('.pp-evidence').first()).toContainText('explicitly labeled creamy');
  await consistent(page, session);
  session = await recompute(page, () => page.getByRole('button', { name: 'Try another dish', exact: true }).click());
  expect(session.empty_reason).toBe('no_alternatives');
  await expect(page.getByRole('heading', { name: 'Every good possibility has had its turn.' })).toBeVisible();
  await expect(page.locator('.mm-response')).toContainText('No other strong dishes');
  await expect(page.getByRole('button', { name: 'Try another dish', exact: true })).toBeDisabled();
  await expect(page.locator('.stretch-dish, .ct-table-panel')).toHaveCount(0);
  session = await recompute(page, () => page.getByRole('button', { name: 'Bring back earlier picks', exact: true }).click());
  expect(ids(session)).toEqual(['mushroom-taco', 'chicken-tinga', 'birria']);
  session = await recompute(page, () => page.getByRole('button', { name: 'Reset refinements', exact: true }).click());
  expect(session.recommendations).toEqual(original.recommendations);
});

test('refinement loading, rapid changes and reset reject old responses without stale related sections', async ({ page }) => {
  const original = await start(page);
  let release!: () => void, delivered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { delivered = resolve; });
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON().refinements.preferences.includes('spicier')) {
      await gate; await route.fulfill({ response }).catch(() => {}); delivered();
    } else await route.fulfill({ response });
  });
  const pending = page.waitForRequest(req => req.url().endsWith('/recommendation-sessions') && req.postDataJSON().refinements.preferences.includes('spicier'));
  await page.getByRole('button', { name: 'More spicy', exact: true }).click(); await pending;
  await expect(page.locator('.mm-response')).toContainText('Tuning Your Table');
  await expect(page.locator('.signature-pick, .complete-table, .worth-the-stretch')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Try another dish', exact: true })).toBeDisabled();
  const reset = await recompute(page, () => page.getByRole('button', { name: 'Reset refinements', exact: true }).click());
  expect(reset.recommendations).toEqual(original.recommendations);
  release(); await done;
  await consistent(page, reset);
  await expect(page.getByRole('button', { name: 'More spicy', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.unroute('**/api/dinetuned/recommendation-sessions');
  // Well-shaped but stale refinement metadata must fail response binding too.
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch(); const data: RecommendationSession = await response.json();
    data.refinement_result!.request.preferences = [];
    await route.fulfill({ json: data });
  });
  await page.getByRole('button', { name: 'Something lighter', exact: true }).click();
  await expect(page.getByText('These picks do not match your current restaurant and preferences. Please retry.')).toBeVisible();
  await expect(page.locator('.mm-response')).toHaveAttribute('data-refinement-status', 'error');
  await expect(page.locator('.signature-pick, .complete-table, .worth-the-stretch')).toHaveCount(0);
});

test('temporary intent survives the same menu, preserves soft budgets and clears on another branch', async ({ page }) => {
  await start(page);
  await recompute(page, () => page.getByRole('button', { name: 'More spicy', exact: true }).click());
  await page.locator('.pp-current-preferences > summary').click();
  let session = await recompute(page, () => page.getByLabel('Budget per dish', { exact: true }).fill('18.99'));
  await consistent(page, session);
  expect(session.worth_the_stretch!.picks.length).toBeGreaterThan(0);
  expect(session.worth_the_stretch!.picks.every(rec => rec.budget.overage_minor === rec.dish.price.amount_minor! - 1899)).toBe(true);
  session = await recompute(page, () => page.getByLabel('Hide above-budget alternatives').check());
  expect(session.recommendations.every(rec => rec.budget.overage_minor === 0)).toBe(true);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to the complete menu', exact: true }).click();
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  session = await recompute(page, () => page.locator('.menu-picks-top button').click());
  expect(session.refinement_result!.request.preferences).toEqual(['spicier']);
  await page.getByRole('link', { name: 'Back to the complete menu', exact: true }).click();
  await page.locator('.menu-breadcrumb').getByRole('link', { name: 'Restaurants', exact: true }).click();
  await page.getByRole('combobox', { name: 'Restaurant name or neighborhood' }).fill('Saigon');
  await page.getByRole('option').filter({ hasText: 'River North' }).click();
  await expect(page).toHaveURL(/\/restaurant\/saigon-table-river-north$/);
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  session = await recompute(page, () => page.locator('.menu-picks-top button').click());
  expect(session.restaurant.id).toBe('saigon-table-river-north');
  expect(session.refinement_result!.request).toEqual({ preferences: [], avoid_dish_ids: [] });
});
