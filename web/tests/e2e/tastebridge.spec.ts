import { test, expect, type Page } from '@playwright/test';
import type { RecommendationSession, RestaurantMenu, StructuredTasteBridge } from '../../lib/contracts';
import { initialState } from '../../lib/storage';
import { returningUser } from './session-helpers';

// Element screenshots should capture the card, without fixed site navigation
// overlaying it when Playwright scrolls a tall card into the viewport.
const screenshotStyle = '.site-header, .mobile-nav, .skip-link { visibility: hidden !important; }';

async function openPicks(page: Page, restaurant = 'saigon-table') {
  await page.goto('/restaurant/' + restaurant);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
  const pending = page.waitForResponse(response => response.url().endsWith('/recommendation-sessions') && response.request().method() === 'POST');
  await page.locator('.menu-picks-top button').click();
  const response = await pending;
  expect(response.status()).toBe(200);
  const session: RecommendationSession = await response.json();
  await expect(page.locator('.signature-pick')).toHaveCount(session.recommendations.length);
  return session;
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const bridge of await page.locator('.taste-bridge').all()) {
    expect(await bridge.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
}

test('TasteBridge connects actual cross-cuisine memories with keyboard-accessible evidence', async ({ page }, info) => {
  const response = await page.request.get('/api/dinetuned/restaurants/saigon-table/menu');
  expect(response.ok()).toBe(true);
  const familiarMenu: RestaurantMenu = await response.json();
  const state = initialState();
  state.taste.complete = true;
  state.taste.axes = { spice: .6, richness: .9, crunch: .2, aromatic: .85, freshness: null, sweetness: null, umami: null };
  state.feedback = [{ id: 'pho-memory', restaurant_id: 'saigon-table', restaurant_name: familiarMenu.restaurant.name,
    dish_id: 'pho', dish_name: 'Pho Gà', menu_version: familiarMenu.version, liked: true, note: '', date: '2026-10-20T12:00:00Z' }];
  await page.addInitScript(value => localStorage.setItem('dinetuned-v2', JSON.stringify(value)), state);
  const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
  const session = await openPicks(page, 'sora-kitchen');
  const rec = session.recommendations.find(item => item.dish.id === 'miso-ramen')!;
  const bridge = rec.taste_bridge!;
  expect(bridge.status).toBe('grounded');
  const card = page.locator('[data-pick-id="miso-ramen"]');
  const panel = card.getByRole('region', { name: 'TasteBridge', exact: true });
  await expect(panel.locator('.tb-origin')).toContainText(bridge.anchor!.label);
  await expect(panel.locator('.tb-destination p')).toHaveText(rec.dish.name);
  await expect(panel.locator('.tb-insight p')).toHaveText(bridge.shared[0].text);
  await expect(panel.locator('.tb-difference p')).toHaveText(bridge.differences[0].text);
  await expect(panel).not.toContainText(/\d+%/);
  await expect(panel.locator('.tb-details')).not.toHaveAttribute('open');
  await noOverflow(page);
  await card.screenshot({ path: `test-results/tastebridge-card-${info.project.name}.png`, scale: 'css', style: screenshotStyle });
  const summary = panel.locator('.tb-details > summary');
  await summary.focus(); await expect(summary).toBeFocused(); await page.keyboard.press('Enter');
  await expect(panel.locator('.tb-details')).toHaveAttribute('open', '');
  await expect(panel.locator('.tb-curator-note p')).toHaveText(bridge.explanation);
  await expect(panel.locator('.tb-comparisons > li')).toHaveCount(bridge.shared.length + bridge.differences.length);
  await expect(panel.locator('.tb-sources > li')).toHaveCount(bridge.evidence.length);
  await expect(panel.locator('.tb-limits')).toContainText('A positive rating does not tell us which qualities you liked');
  const citation = panel.locator('.tb-citations a').first();
  const sourceId = (await citation.getAttribute('href'))!.slice(1);
  await citation.focus(); await page.keyboard.press('Enter');
  expect(await page.evaluate(() => document.activeElement?.id)).toBe(sourceId);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await panel.locator('.tb-details-body').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await noOverflow(page);
  await summary.focus(); await page.keyboard.press('Space');
  await expect(panel.locator('.tb-details')).not.toHaveAttribute('open');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 800 });
  await noOverflow(page);
  await panel.screenshot({ path: `test-results/tastebridge-connection-${info.project.name}.png`, scale: 'css', style: screenshotStyle });
  expect(errors).toEqual([]);
});

test('TasteBridge presents saved preferences as a partial connection without invented favorites', async ({ page }, info) => {
  await returningUser(page);
  const session = await openPicks(page);
  await expect(page.locator('.taste-bridge')).toHaveCount(3);
  for (const rec of session.recommendations) {
    const bridge = rec.taste_bridge!;
    expect(bridge.status).toBe('limited');
    const panel = page.locator(`[data-pick-id="${rec.dish.id}"] .taste-bridge`);
    await expect(panel.locator('.tb-origin')).toContainText('YOUR STARTING POINT');
    await expect(panel.locator('.tb-origin p')).toHaveText(bridge.anchor!.label);
    await expect(panel.locator('.tb-insight p')).toHaveText(bridge.shared[0].text);
    await expect(panel).not.toContainText('YOU ENJOYED');
    await expect(panel.locator('.tb-scope')).toContainText('partial connection');
    await expect(panel.locator('.tb-difference')).toHaveCount(bridge.differences.length ? 1 : 0);
  }
  await noOverflow(page);
  await page.locator('.signature-collection').screenshot({ path: `test-results/tastebridge-selection-${info.project.name}.png`, scale: 'css', style: screenshotStyle });
});

test('TasteBridge missing, rejected and unavailable comparisons preserve picks but never bypass core validation', async ({ page }) => {
  await returningUser(page);
  let scenario = 0;
  const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch();
    const session: RecommendationSession = await response.json();
    session.recommendations.forEach((rec, index) => {
      if (scenario === 0) {
        if (index === 0) delete (rec as Partial<typeof rec>).taste_bridge;
        if (index === 1) rec.taste_bridge = null;
        if (index === 2) {
          rec.taste_bridge!.shared[0].anchor_fact_id = 'unsupported';
          rec.taste_bridge!.shared[0].text = 'FABRICATED COMPARISON MUST NEVER DISPLAY';
        }
      } else if (scenario < 3) {
        const reasons: StructuredTasteBridge['unavailable_reason'][] = scenario === 1
          ? ['insufficient_evidence', 'contradictory_evidence', 'ineligible']
          : ['invalid_proposal', 'provider_unavailable', null];
        rec.taste_bridge = { ...rec.taste_bridge!, status: 'unavailable', anchor: null, shared: [], differences: [],
          explanation: '', evidence: [], uncertainties: ['No supported comparison is available.'], unavailable_reason: reasons[index] };
      } else rec.dish.price.amount_minor = -1;
    });
    await route.fulfill({ json: session });
  });
  await openPicks(page);
  await expect(page.locator('.tb-unavailable')).toHaveCount(3);
  await expect(page.locator('.tb-journey')).toHaveCount(0);
  await expect(page.locator('.signature-collection')).not.toContainText('FABRICATED');
  await page.locator('.pp-evidence > summary').first().click();
  await expect(page.getByRole('heading', { name: 'Why this pick' }).first()).toBeVisible();
  for (scenario = 1; scenario <= 2; scenario++) {
    await page.reload();
    await expect(page.locator('.tb-unavailable')).toHaveCount(3);
    const expected = scenario === 1 ? ['more taste clues', 'conflict', 'current restrictions'] : ['couldn’t support', 'temporarily unavailable', 'supported taste connection'];
    for (let i = 0; i < 3; i++) await expect(page.locator('.tb-fallback').nth(i)).toContainText(expected[i]);
    await expect(page.locator('.tb-journey')).toHaveCount(0);
    await page.locator('.tb-details > summary').first().click();
    await expect(page.locator('.tb-limits').first()).toContainText('No supported comparison');
    await noOverflow(page);
  }
  await page.reload(); // scenario = 3: a malformed price is NOT an optional bridge failure.
  await expect(page.getByText('We received an unexpected response. Please refresh and try again.')).toBeVisible();
  await expect(page.locator('.signature-pick')).toHaveCount(0);
  expect(errors).toEqual([]);
});
