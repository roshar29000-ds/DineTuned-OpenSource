import { test, expect } from '@playwright/test';
import { openMenuFilters } from './session-helpers';
import { completeTastingNotes, nextAnswer } from './taste-helpers';

test('adaptive conversation persists drafts, supports review edits, and saves real API profile', async ({ page }) => {
  await page.goto('/onboarding');
  await completeTastingNotes(page, true);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Create my Taste DNA' })).toBeVisible();
  await page.getByRole('button', { name: 'Revise Your kind of heat' }).click();
  await expect(page.getByRole('button', { name: 'Keep it mellow', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'A gentle glow', exact: true }).click();
  await page.getByRole('button', { name: 'Save answer', exact: true }).click();
  const response = page.waitForResponse(res => res.url().endsWith('/taste/profile') && res.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/taste$/);
  await expect(page.locator('.v3-evidence-value strong')).toHaveText('55');
  await expect(page.locator('.v3-evidence-lines')).toContainText('outweighs ingredient clues');
  await expect(page.getByText('Sweet glazes', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.locator('.v3-evidence-value strong')).toHaveText('55');
  await page.getByRole('link', { name: 'Revisit my answers' }).click();
  await expect(page.getByRole('button', { name: 'A fragrant curry', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('unknowns and API failures remain honest through publishing', async ({ page }) => {
  await page.goto('/onboarding');
  for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Leave open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A good host remembers the essentials.' })).toBeVisible();
  await nextAnswer(page);
  await page.route('**/api/dinetuned/taste/profile', route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Please try again shortly.' }) }));
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page.getByRole('region', { name: 'Taste Detective conversation' }).getByRole('alert')).toContainText('Your tasting notes are still here');
  await page.unroute('**/api/dinetuned/taste/profile');
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  await expect(page.locator('.v3-coverage strong')).toHaveText('0/7');
  await expect(page.locator('.v3-confidence')).toHaveText('Open');
  await expect(page.getByText('Not answered', { exact: true })).toBeVisible();
  const sweetness = page.locator('.v3-dimension').filter({ has: page.locator('summary strong', { hasText: 'Sweetness' }) });
  await sweetness.locator('summary').click();
  await page.getByLabel('Sweetness', { exact: true }).focus();
  await page.getByLabel('Sweetness', { exact: true }).press('ArrowRight');
  await expect(sweetness.locator('summary small')).toHaveText('Edited by you');
  await page.reload();
  await sweetness.locator('summary').click();
  await expect(page.getByLabel('Sweetness', { exact: true })).toHaveValue('51');
  await page.getByRole('button', { name: 'Leave sweetness unknown' }).click();
  await expect(sweetness.locator('summary small')).toHaveText('Open');
});

test('editing an anchor removes its adaptive branch and ingredient choices are exclusive', async ({ page }) => {
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'A bowl of ramen', exact: true }).click();
  await nextAnswer(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: /linger on a bowl of ramen/ })).toBeVisible();
  await page.locator('.v3-answer-drawer summary').click();
  await page.getByRole('button', { name: 'Edit Your favorites' }).click();
  await page.getByRole('button', { name: 'A bowl of ramen', exact: true }).click();
  await page.getByRole('button', { name: 'Crispy tacos', exact: true }).click();
  await nextAnswer(page);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Leave open', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Which little details make a dish yours?' })).toBeVisible();
  const yes = page.getByRole('group', { name: 'Response choices', exact: true }).getByRole('button', { name: 'Garlic', exact: true });
  const less = page.getByRole('group', { name: 'Ingredients to enjoy less' }).getByRole('button', { name: 'Garlic', exact: true });
  await yes.click(); await less.click();
  await expect(yes).toHaveAttribute('aria-pressed', 'false');
  await expect(less).toHaveAttribute('aria-pressed', 'true');
});

test('V3 screens fit small phones and desktops, with keyboard and reduced-motion support', async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Crispy tacos', exact: true }).focus();
  await page.getByRole('button', { name: 'Crispy tacos', exact: true }).press('Space');
  await expect(page.getByRole('button', { name: 'Crispy tacos', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const widths = info.project.name === 'desktop' ? [320, 768, 1440] : [390];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `test-results/detective-v3-${info.project.name}-viewport.png`, scale: 'css' });
  await page.screenshot({ path: `test-results/detective-v3-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Crispy tacos', exact: true }).click();
  await completeTastingNotes(page);
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  }
  const mapAroma = page.getByRole('button', { name: /^Aromatics: unknown/ });
  await mapAroma.focus(); await mapAroma.press('Enter');
  await expect(page.locator('.v3-evidence-title h2')).toHaveText('Aromatics');
  await expect(page.locator('.v3-confidence')).toHaveText('Open');
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.screenshot({ path: `test-results/dna-v3-${info.project.name}-viewport.png`, scale: 'css' });
  await page.screenshot({ path: `test-results/dna-v3-${info.project.name}.png`, fullPage: true });
});

test('editing DNA preserves V2 profiles until publish and keeps restaurant context separate', async ({ page }) => {
  await page.goto('/onboarding');
  await expect(page.getByRole('button', { name: 'Crispy tacos', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('dinetuned-v2')!);
    state.taste.complete = true;
    state.taste.favorites = 'My V2 food story';
    state.taste.axes.spice = .4;
    state.taste.dietary_restrictions = ['vegetarian'];
    state.taste.allergies = { allergens: ['peanut'], other: '' };
    state.constraints = { ...state.constraints, max_price_minor: 1899, mood: 'cozy', appetite: 'light', dietary_restrictions: ['vegetarian'], allergies: state.taste.allergies };
    localStorage.setItem('dinetuned-v2', JSON.stringify(state));
  });
  await page.reload();
  await completeTastingNotes(page);
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
  expect(before.taste.favorites).toBe('My V2 food story');
  expect(before.taste.axes.spice).toBe(.4);
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
  expect(after.constraints).toEqual(before.constraints);
  expect(after.taste.axes.spice).toBe(.18);
  expect(after.taste.allergies.allergens).toEqual(['peanut']);
  expect(after.detectiveDraft).toBeNull();
  await page.goto('/restaurant/saigon-table');
  await expect(page.locator('.menu-picks-top')).toBeVisible();
  await openMenuFilters(page);
  await page.getByLabel('In the mood for', { exact: true }).selectOption('fresh');
  await page.getByLabel('My appetite', { exact: true }).selectOption('hearty');
  const changed = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
  expect(changed.taste.axes).toEqual(after.taste.axes);
  expect(changed.detective).toEqual(after.detective);
});
