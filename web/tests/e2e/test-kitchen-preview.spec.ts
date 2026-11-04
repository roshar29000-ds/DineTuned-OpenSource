import { test, expect } from '@playwright/test';

test('offline Culinary Orbit stays honest through waiting, ready and error without provider requests', async ({ page }, info) => {
  test.skip(process.env.E2E_TEST_KITCHEN_PREVIEW !== 'true', 'Local-only preview opt-in required');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  let paidRequests = 0;
  page.on('request', request => { if (/\/(?:discovery\/(?:sessions|autocomplete|selection)|real-picks\/(?:sessions|illustrations))/.test(request.url())) paidRequests++; });
  await page.goto('/culinary-orbit-preview');
  const orbit = page.getByRole('dialog', { name: 'Personalized Picks are being prepared' });
  await expect(orbit).toContainText('FICTIONAL FIXTURE · OFFLINE REPLAY');
  await expect(orbit.getByRole('heading', { name: 'Muse is cooking up your picks' })).toBeVisible();
  await expect(orbit).toContainText('Orchard Kitchen · 7 dishes');
  await expect(orbit.getByRole('status')).toContainText('Reading the menu');
  await expect(orbit).not.toContainText('%');
  await expect(orbit).not.toContainText('ready');
  await page.waitForTimeout(10500);
  await expect(orbit.getByRole('status')).toContainText('Curating your picks');
  await expect(orbit).not.toContainText('Your picks are ready');
  await expect(orbit.locator('.co-orb img:not([style*="display"])').first()).toBeAttached();
  await page.screenshot({ path: info.outputPath(`orbit-dishes-${info.project.name}.png`) });
  if (info.project.name === 'mobile') await page.getByRole('button', { name: 'Preview controls' }).click();
  await page.getByRole('button', { name: 'Simulate error' }).click();
  const alert = orbit.getByRole('alert');
  await expect(alert).toContainText('No automatic retry was made');
  await expect(alert.getByRole('button', { name: 'Try again' })).toBeFocused();
  await expect(alert.getByRole('button', { name: 'Back to the menu' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`orbit-error-${info.project.name}.png`) });
  await alert.getByRole('button', { name: 'Try again' }).click();
  await expect(orbit.getByRole('heading', { name: 'Muse is cooking up your picks' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(paidRequests).toBe(0);
});

test('the orbit waits for the response and hands off as soon as it arrives', async ({ page }) => {
  test.skip(process.env.E2E_TEST_KITCHEN_PREVIEW !== 'true', 'Local-only preview opt-in required');
  await page.goto('/culinary-orbit-preview?ready=2');
  const orbit = page.getByRole('dialog', { name: 'Personalized Picks are being prepared' });
  await expect(orbit.getByRole('heading', { name: 'Muse is cooking up your picks' })).toBeVisible();
  await expect(orbit.getByRole('heading', { name: /Your picks are ready/ })).toBeVisible({ timeout: 4000 });
  await expect(page).toHaveURL(/\/picks-preview#reveal$/, { timeout: 4000 });
});

test('reduced motion keeps the same words without moving anything', async ({ browser }) => {
  test.skip(process.env.E2E_TEST_KITCHEN_PREVIEW !== 'true', 'Local-only preview opt-in required');
  const context = await browser.newContext({ reducedMotion: 'reduce', baseURL: process.env.E2E_BASE_URL || 'http://127.0.0.1:3100' });
  const page = await context.newPage();
  await page.goto('/culinary-orbit-preview');
  await page.waitForTimeout(500);
  const first = await page.locator('.co-orb').first().getAttribute('style');
  await page.waitForTimeout(1500);
  expect(await page.locator('.co-orb').first().getAttribute('style')).toBe(first);
  await expect(page.getByRole('heading', { name: 'Muse is cooking up your picks' })).toBeVisible();
  await context.close();
});

test('complete Picks preview reuses the real cards while keeping all actions isolated', async ({ page }, info) => {
  test.skip(process.env.E2E_TEST_KITCHEN_PREVIEW !== 'true', 'Local-only preview opt-in required');
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
  await page.addInitScript(() => localStorage.setItem('dinetuned-v2', 'untouched-preview-sentinel'));
  let apiCalls = 0;
  page.on('request', request => { if (/\/api\/(?:dinetuned|identity)/.test(request.url())) apiCalls++; });
  await page.goto('/picks-preview');
  await expect(page.getByRole('region', { name: 'Offline Personalized Picks preview' }).locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(3);
  await expect(page.locator('.real-picks-page > .real-picks-list .preview-pick-media img')).toHaveCount(3);
  await expect.poll(() => page.locator('.real-picks-page > .real-picks-list .preview-pick-media img').evaluateAll(images =>
    images.every(image => image instanceof HTMLImageElement && image.complete && image.naturalWidth > 0))).toBe(true);
  await expect(page.getByRole('region', { name: 'Complete My Table' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Worth the Stretch' })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`picks-overview-${info.project.name}.png`), animations: 'disabled' });
  const first = page.locator('.real-pick:not(.real-pick-stretch)').first();
  await first.getByRole('button', { name: 'More about this pick' }).click();
  await expect(first.locator('.real-pick-detail-bridge')).toBeVisible();
  await first.screenshot({ path: info.outputPath(`picks-expanded-${info.project.name}.png`), animations: 'disabled' });
  await first.getByRole('button', { name: 'Save dish' }).click();
  await expect(page.getByText('Your real dining history was not changed.', { exact: false })).toBeVisible();
  await first.getByRole('button', { name: 'I tried this' }).click();
  await first.getByText('Rate this dish · preview').click();
  await first.getByLabel('Rating').selectOption('5');
  await first.getByRole('button', { name: 'Record preview rating' }).click();
  await page.getByRole('region', { name: 'Make It More Me preview' }).getByRole('button', { name: 'More spicy' }).click();
  await expect(page.getByText('The sample Picks stay fixed.', { exact: false })).toBeVisible();
  await page.getByRole('region', { name: 'Complete My Table' }).getByRole('button', { name: 'Choose this table' }).click();
  await expect(page.getByRole('region', { name: 'Complete My Table' })).toContainText('Selected meal subtotal');
  await page.getByRole('region', { name: 'Complete My Table' }).screenshot({ path: info.outputPath(`picks-table-${info.project.name}.png`), animations: 'disabled' });
  await page.getByRole('region', { name: 'Worth the Stretch' }).screenshot({ path: info.outputPath(`picks-stretch-${info.project.name}.png`), animations: 'disabled' });
  await page.getByRole('region', { name: 'Make It More Me preview' }).getByPlaceholder('For example, something lighter').fill('something lighter');
  await page.getByRole('region', { name: 'Make It More Me preview' }).getByRole('button', { name: 'Update My Picks' }).click();
  await expect(page.getByRole('region', { name: 'Make It More Me preview' })).toContainText('The sample Picks stay fixed');
  await page.getByRole('region', { name: 'Make It More Me preview' }).screenshot({ path: info.outputPath(`picks-refinements-${info.project.name}.png`), animations: 'disabled' });
  await page.screenshot({ path: info.outputPath(`picks-preview-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  expect(await page.evaluate(() => localStorage.getItem('dinetuned-v2'))).toBe('untouched-preview-sentinel');
  expect(apiCalls).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('clean cinematic capture reveals the isolated Picks page without provider calls', async ({ page }) => {
  test.skip(process.env.E2E_TEST_KITCHEN_PREVIEW !== 'true', 'Local-only preview opt-in required');
  let apiCalls = 0;
  page.on('request', request => { if (/\/api\//.test(request.url())) apiCalls++; });
  await page.goto('/culinary-orbit-preview?capture=1');
  await expect(page.getByRole('dialog', { name: 'Personalized Picks are being prepared' })).toContainText('FICTIONAL FIXTURE · OFFLINE REPLAY');
  await expect(page).toHaveURL(/\/picks-preview#reveal$/, { timeout: 20_000 });
  await expect(page.locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(3);
  expect(apiCalls).toBe(0);
});
