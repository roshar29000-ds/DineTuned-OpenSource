import { test, expect, type Page } from '@playwright/test';
import type { MealCombinationResult, RecommendationSession } from '../../lib/contracts';
import { money } from '../../lib/preferences';
import { returningUser } from './session-helpers';

async function menu(page: Page) {
  await returningUser(page);
  await page.goto('/restaurant/saigon-table');
  await expect(page.locator('[data-dish-id]')).toHaveCount(6);
  await expect(page.locator('.menu-picks-top button')).toBeEnabled();
}
async function picks(page: Page): Promise<RecommendationSession> {
  const pending = page.waitForResponse(res => res.url().endsWith('/recommendation-sessions') && res.request().method() === 'POST');
  await page.locator('.menu-picks-top button').click();
  const response = await pending; expect(response.status()).toBe(200);
  const result: RecommendationSession = await response.json();
  await expect(page.locator('.signature-pick')).toHaveCount(result.recommendations.length);
  return result;
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(await page.locator('.complete-table').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  for (const element of await page.locator('.ct-table-panel:not([hidden]), .ct-options button').all()) {
    expect(await element.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
}
const activePanel = (page: Page) => page.locator('.ct-table-panel:not([hidden])');
const shotStyle = '.site-header, .mobile-nav, .skip-link { visibility: hidden !important; }';

test('Complete My Table renders real prices, supported pairings and accessible alternatives after Picks', async ({ page }, info) => {
  const errors: Error[] = []; page.on('pageerror', error => errors.push(error));
  await menu(page);
  const session = await picks(page);
  const combinations = session.meal_combinations!.combinations;
  expect(combinations.length).toBe(3);
  await expect(page.locator('.complete-table')).toHaveAttribute('data-table-count', '3');
  expect(await page.evaluate(() => {
    const main = document.querySelector('.signature-collection')!, table = document.querySelector('.complete-table')!, controls = document.querySelector('.pp-current-preferences')!;
    return !!(main.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      && !!(table.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  await expect(page.getByRole('heading', { name: 'Complete My Table', exact: true })).toBeVisible();
  await expect(page.locator('.ct-introduction')).toContainText('Your $30 target is per dish, not per meal');
  const tabs = page.getByRole('tablist', { name: 'Choose a meal combination' }).getByRole('tab');
  for (let index = 0; index < combinations.length; index++) {
    await tabs.nth(index).click();
    const combination = combinations[index], panel = activePanel(page);
    await expect(panel).toHaveAttribute('data-combination-id', combination.id);
    await expect(panel.locator('.ct-subtotal > strong')).toHaveText(money(combination.subtotal_minor));
    await expect(panel.locator('.ct-subtotal')).toContainText('Tax, tip & other fees excluded');
    for (const part of [combination.main, ...combination.additions]) {
      const row = panel.locator(`[data-table-item="${part.item_id}"]`);
      await expect(row.getByRole('heading')).toHaveText(part.name);
      await expect(row.locator('.ct-item-price')).toHaveText(money(part.price_minor));
      await expect(row.locator('.ct-kicker')).toContainText(part.category_name);
    }
    await expect(panel.locator('.ct-connection')).toHaveText(combination.claims[0].text);
    await expect(panel.locator('figcaption')).toHaveText('Menu illustrations · not restaurant photography');
    await fits(page);
  }
  await tabs.first().focus(); await page.keyboard.press('End');
  await expect(tabs.last()).toBeFocused(); await expect(tabs.last()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowRight'); await expect(tabs.first()).toBeFocused();
  await expect(tabs.first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Tab'); await expect(activePanel(page)).toBeFocused();
  const summary = activePanel(page).locator('.ct-details > summary');
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(activePanel(page).locator('.ct-details')).toHaveAttribute('open', '');
  await expect(activePanel(page).locator('.ct-details-body')).toContainText(combinations[0].rationale);
  await expect(activePanel(page).locator('.ct-details-body')).toContainText('allergy-safety');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await activePanel(page).evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await fits(page); await page.keyboard.press('Space');
  await expect(activePanel(page).locator('.ct-details')).not.toHaveAttribute('open');
  await expect(activePanel(page).locator('.ct-unillustrated')).toHaveCount(0);
  await page.locator('.complete-table').screenshot({ path: `test-results/complete-table-${info.project.name}.png`, scale: 'css', style: shotStyle });
  const pending = page.waitForResponse(res => res.url().endsWith('/recommendation-sessions') && res.request().postDataJSON()?.constraints.max_price_minor === 1899);
  await page.locator('.pp-current-preferences > summary').click();
  await page.getByLabel('Budget per dish', { exact: true }).fill('18.99');
  const updated: RecommendationSession = await (await pending).json();
  await expect(page.locator('.ct-introduction')).toContainText('Your $18.99 target is per dish');
  for (let index = 0; index < updated.meal_combinations!.combinations.length; index++) {
    await tabs.nth(index).click();
    const combination = updated.meal_combinations!.combinations[index];
    await expect(activePanel(page).locator('.ct-subtotal > strong')).toHaveText(money(combination.subtotal_minor));
    for (const part of [combination.main, ...combination.additions]) {
      const row = activePanel(page).locator(`[data-table-item="${part.item_id}"]`);
      if (part.budget.status === 'above_target') await expect(row.locator('.ct-overage')).toHaveText(`${money(part.budget.overage_minor)} above your $18.99 per-dish target`);
      else await expect(row.locator('.ct-overage')).toHaveCount(0);
    }
  }
  for (const subtotal of await page.locator('.ct-subtotal').all()) await expect(subtotal).not.toContainText('above');
  expect(errors).toEqual([]);
});

test('Complete My Table supports one and two meals, long copy, unknown portions and narrow phones', async ({ page }, info) => {
  let count = 2;
  await menu(page);
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch();
    const data: RecommendationSession = await response.json();
    const result = data.meal_combinations!;
    result.status = 'limited'; result.combinations = result.combinations.slice(0, count);
    const combo = result.combinations[0];
    const name = `${combo.main.name} — ${combo.main.name} — ${combo.main.name}`;
    data.recommendations.find(rec => rec.dish.id === combo.main.item_id)!.dish.name = name;
    combo.main.name = name;
    combo.claims[0].text = Array(3).fill(combo.claims[0].text).join(' ');
    combo.rationale = Array(3).fill(combo.rationale).join(' ');
    // Presentation fixtures exercise explicit hearty and missing portion evidence.
    if (count === 2) combo.evidence.find(fact => fact.item_id === combo.additions[0].item_id && fact.attribute === 'portion')!.value = 'hearty';
    else combo.evidence = combo.evidence.filter(fact => fact.attribute !== 'portion');
    await route.fulfill({ json: data });
  });
  await picks(page);
  await expect(page.locator('.complete-table')).toHaveAttribute('data-table-count', '2');
  await expect(activePanel(page)).toContainText('Substantial additional dish');
  await fits(page);
  count = 1; await page.reload();
  await expect(page.locator('.complete-table')).toHaveAttribute('data-table-count', '1');
  await expect(activePanel(page).locator('.ct-portion')).toHaveText(['Portion not specified', 'Portion not specified']);
  await expect(page.locator('.ct-footnote')).toContainText('A smaller selection');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 800 });
  await activePanel(page).locator('.ct-details > summary').click();
  await fits(page);
  await activePanel(page).locator('.ct-details > summary').click();
  await page.locator('.complete-table').screenshot({ path: `test-results/complete-table-long-${info.project.name}.png`, scale: 'css', style: shotStyle });
});

test('Complete My Table falls back for missing, unavailable, unsupported and stale data without hiding Picks', async ({ page }) => {
  await menu(page);
  let variant = 'missing';
  await page.route('**/api/dinetuned/recommendation-sessions', async route => {
    const response = await route.fetch(); const data: RecommendationSession = await response.json();
    const result = data.meal_combinations!;
    if (variant === 'missing') delete data.meal_combinations;
    else if (variant === 'wrong_restaurant') result.restaurant_id = 'another-branch';
    else if (variant === 'wrong_version') result.combinations.forEach(combo => { combo.menu_version = 'stale'; });
    else if (variant === 'missing_evidence') result.combinations.forEach(combo => { combo.evidence = []; });
    else if (variant === 'wrong_preference') result.combinations.forEach(combo => { combo.additions[0].budget.target_minor = 1234; });
    else { result.status = 'unavailable'; result.combinations = []; result.unavailable_reason = variant as MealCombinationResult['unavailable_reason']; }
    await route.fulfill({ json: data });
  });
  await picks(page);
  for (const reason of ['missing', 'provider_unavailable', 'insufficient_menu_evidence', 'invalid_proposal', 'wrong_restaurant', 'wrong_version', 'missing_evidence', 'wrong_preference']) {
    if (reason !== 'missing') { variant = reason; await page.reload(); }
    await expect(page.locator('.complete-table')).toHaveAttribute('data-table-count', '0');
    await expect(page.locator('.ct-empty')).toBeVisible();
    await expect(page.locator('.ct-table-panel')).toHaveCount(0);
    await expect(page.locator('.signature-pick')).toHaveCount(3);
    await expect(page.locator('.taste-bridge')).toHaveCount(3);
    if (reason === 'provider_unavailable') await expect(page.locator('.ct-empty')).toContainText('temporarily unavailable');
    await fits(page);
  }
});

test('Complete My Table tolerates missing illustrations and rejects a changed menu snapshot', async ({ page }) => {
  await menu(page);
  let stale = false;
  await page.route('**/api/dinetuned/restaurants/saigon-table/menu', async route => {
    if (!stale) await route.fulfill({ status: 503, json: { detail: 'Menu artwork unavailable' } });
    else { const response = await route.fetch(); const data = await response.json(); data.version = 'new-menu'; await route.fulfill({ json: data }); }
  });
  const session = await picks(page);
  await expect(page.locator('.complete-table')).toHaveAttribute('data-table-count', '3');
  // An addition that is also a primary legitimately reuses that primary's art.
  // Exercise a separate accompaniment, whose artwork needs the menu response.
  const unillustrated = session.meal_combinations!.combinations.findIndex(combo => combo.additions.some(part => !session.recommendations.some(rec => rec.dish.id === part.item_id)));
  expect(unillustrated).toBeGreaterThanOrEqual(0);
  await page.getByRole('tablist', { name: 'Choose a meal combination' }).getByRole('tab').nth(unillustrated).click();
  await expect(activePanel(page).locator('.ct-unillustrated').first()).toBeVisible();
  await expect(activePanel(page).locator('.ct-subtotal > strong')).toBeVisible();
  stale = true; await page.reload();
  await expect(page.locator('.ct-empty')).toContainText('This menu has changed');
  await expect(page.locator('.ct-table-panel')).toHaveCount(0);
  await expect(page.locator('.signature-pick')).toHaveCount(3);
});
