import { expect, test, type Page } from '@playwright/test';
import type { RecommendationSession } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { savedProfile } from './session-helpers';

async function menu(page: Page, restaurant = 'saigon-table') {
  const state = { ...structuredClone(savedProfile), taste: { ...savedProfile.taste,
    axes: { ...savedProfile.taste.axes, spice: .45, richness: .6, freshness: .6, crunch: .5, aromatic: .8 } } };
  state.constraints.max_price_minor = 2099;
  await page.addInitScript(value => {
    if (!sessionStorage.getItem('stretch-seeded')) {
      localStorage.setItem('dinetuned-v2', JSON.stringify(value));
      sessionStorage.setItem('stretch-seeded', 'true');
    }
  }, state);
  await page.goto(`/restaurant/${restaurant}`);
  await expect(page.locator('[data-dish-id]')).toHaveCount(restaurant === 'saigon-table' ? 6 : 4);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
}
async function picks(page: Page): Promise<RecommendationSession> {
  const pending = page.waitForResponse(res => res.url().endsWith('/recommendation-sessions'));
  await page.locator('.menu-picks-top button').click();
  const response = await pending;
  expect(response.status()).toBe(200);
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  return response.json();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  for (const element of await page.locator('.worth-the-stretch, .stretch-dish, .stretch-story').all()) {
    expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
}
const shotStyle = '.site-header, .mobile-nav, .skip-link { visibility: hidden !important; }';

test('two real stretch dishes follow the table, show exact overages and hide on request', async ({ page }, info) => {
  const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
  await menu(page); const session = await picks(page);
  await expect(page.locator('.worth-the-stretch')).toHaveAttribute('data-stretch-count', '2');
  expect(await page.evaluate(() => {
    const table = document.querySelector('.complete-table')!, stretch = document.querySelector('.worth-the-stretch')!, prefs = document.querySelector('.pp-current-preferences')!;
    return !!(table.compareDocumentPosition(stretch) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(stretch.compareDocumentPosition(prefs) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  const primary = new Set(session.recommendations.map(rec => rec.dish.id));
  for (const rec of session.worth_the_stretch!.picks) {
    expect(primary.has(rec.dish.id)).toBe(false);
    const card = page.locator(`[data-stretch-id="${rec.dish.id}"]`);
    await expect(card.getByRole('heading', { name: rec.dish.name, exact: true })).toBeVisible();
    await expect(card.locator('.stretch-price strong')).toHaveText(money(rec.dish.price.amount_minor));
    await expect(card.locator('.stretch-overage')).toHaveText(`${money(rec.budget.overage_minor)} above your $20.99 target`);
    await expect(card.locator('.stretch-reason > p')).toHaveText(rec.why);
    await expect(card.locator('figcaption')).toHaveText('Illustration · not restaurant photography');
    await expect(card.locator('.taste-bridge')).toHaveAttribute('data-bridge-status', rec.taste_bridge!.status);
  }
  await expect(page.locator('.stretch-overage').first()).toHaveText('$0.01 above your $20.99 target');
  const summary = page.locator('.stretch-evidence > summary').first();
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.stretch-evidence').first()).toHaveAttribute('open', '');
  await expect(page.locator('.stretch-evidence').first()).toContainText(session.worth_the_stretch!.picks[0].compatibility.evidence[0].observation);
  await page.keyboard.press('Space');
  await expect(page.locator('.stretch-evidence').first()).not.toHaveAttribute('open');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.locator('.stretch-dish').first().evaluate(node => getComputedStyle(node).animationName)).toBe('none');
  await fits(page);
  await page.locator('.worth-the-stretch').screenshot({ path: `test-results/stretch-${info.project.name}.png`, scale: 'css', style: shotStyle });
  await page.getByLabel('Hide above-budget alternatives').check();
  await expect(page.locator('.pp-loading')).toHaveCount(0);
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel('Hide above-budget alternatives')).toBeChecked();
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.getByLabel('Hide above-budget alternatives').uncheck();
  await expect(page.locator('.stretch-dish')).toHaveCount(2);
  await page.locator('.pp-current-preferences > summary').click();
  await page.getByLabel('Budget per dish', { exact: true }).fill('30');
  await expect(page.locator('.pp-budget-bar')).toContainText('$30');
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a single actual alternative handles long copy and a narrow phone without a second filler', async ({ page }, info) => {
  await menu(page, 'casa-sol');
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch(); const data: RecommendationSession = await response.json();
    const rec = data.worth_the_stretch!.picks[0];
    rec.dish.name = Array(4).fill(rec.dish.name).join(' — ');
    rec.why = Array(3).fill(rec.why).join(' ');
    await route.fulfill({ json: data });
  });
  await picks(page);
  await expect(page.locator('.worth-the-stretch')).toHaveAttribute('data-stretch-count', '1');
  await expect(page.locator('.stretch-overage')).toHaveText('$0.01 above your $20.99 target');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 800 });
  await page.locator('.stretch-evidence > summary').click();
  await page.locator('.worth-the-stretch .tb-details > summary').click();
  await fits(page);
  await page.locator('.stretch-evidence > summary').click();
  await page.locator('.worth-the-stretch .tb-details > summary').click();
  await page.locator('.worth-the-stretch').screenshot({ path: `test-results/stretch-narrow-${info.project.name}.png`, scale: 'css', style: shotStyle });
});

test('missing, unavailable comparison and stale extension data preserve primary picks', async ({ page }) => {
  await menu(page);
  let variant = 'missing';
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch(); const data: RecommendationSession = await response.json();
    if (variant === 'missing') delete data.worth_the_stretch;
    if (variant === 'stale') data.worth_the_stretch!.menu_version = 'old-menu';
    if (variant === 'no-bridge') data.worth_the_stretch!.picks.forEach(rec => { rec.taste_bridge = null; });
    if (variant === 'duplicate') data.worth_the_stretch!.picks[0].dish.id = data.recommendations[0].dish.id;
    await route.fulfill({ json: data });
  });
  await picks(page);
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  for (variant of ['stale', 'duplicate', 'no-bridge']) {
    await page.reload(); await expect(page.locator('.signature-pick')).toHaveCount(3);
    if (variant === 'no-bridge') {
      await expect(page.locator('.stretch-dish')).toHaveCount(2);
      await expect(page.locator('.worth-the-stretch .taste-bridge')).toHaveCount(0);
      await expect(page.locator('.stretch-reason').first()).toBeVisible();
    } else await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  }
});

test('old in-flight stretch results cannot replace newer budget preferences', async ({ page }) => {
  await menu(page); await picks(page);
  await expect(page.locator('.stretch-dish')).toHaveCount(2);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delivered!: () => void;
  const done = new Promise<void>(resolve => { delivered = resolve; });
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch();
    if (route.request().postDataJSON().constraints.max_price_minor === 1800) {
      await gate; await route.fulfill({ response }).catch(() => {}); delivered();
    } else await route.fulfill({ response });
  });
  await page.locator('.pp-current-preferences > summary').click();
  const pending = page.waitForRequest(req => req.url().endsWith('/recommendation-sessions') && req.postDataJSON().constraints.max_price_minor === 1800);
  await page.getByLabel('Budget per dish', { exact: true }).fill('18'); await pending;
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await page.getByLabel('Budget per dish', { exact: true }).fill('30');
  await expect(page.locator('.signature-pick')).toHaveCount(3);
  release(); await done;
  await expect(page.locator('.worth-the-stretch')).toHaveCount(0);
  await expect(page.locator('.pp-budget-bar')).toContainText('$30');
});
