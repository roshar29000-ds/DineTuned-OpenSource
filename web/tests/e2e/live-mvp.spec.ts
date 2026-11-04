import { test, expect } from '@playwright/test';
import path from 'node:path';

// Explicitly gated: this test uses real Supabase, Google and Meta APIs. It must
// never run in the ordinary offline suite. No Playwright retries are permitted.
test.skip(process.env.DINETUNED_LIVE_MVP_TEST !== 'approved', 'Requires owner-approved bounded live validation.');
test.describe.configure({ retries: 0 });

test('fresh real guest reaches a grounded table and restores it without paid replay', async ({ page, context }) => {
  test.setTimeout(180_000);
  const requests = { autocomplete: 0, details: 0, picks: 0 };
  const track = (request: { url(): string }) => {
    const url = request.url();
    if (url.endsWith('/discovery/autocomplete')) requests.autocomplete++;
    if (url.endsWith('/discovery/selection')) requests.details++;
    if (url.endsWith('/real-picks/sessions')) requests.picks++;
  };
  page.on('request', track);
  await page.goto('/');
  await page.getByRole('link', { name: 'Find my taste' }).click();
  await page.getByRole('button', { name: 'Crispy tacos', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Rich, cozy flavors', 'Velvety & comforting', 'Keep it mellow', 'Crisp & crackly']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByRole('group', { name: 'Response choices', exact: true }).getByRole('button', { name: 'Chili', exact: true }).click();
  await page.getByRole('group', { name: 'Ingredients to enjoy less' }).getByRole('button', { name: 'Mushrooms', exact: true }).click();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  for (const name of ['Crisped & fried', 'One foot in the familiar']) {
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
  }
  await page.getByLabel('No beef', { exact: true }).check();
  await page.getByLabel('No pork', { exact: true }).check();
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  await page.getByRole('link', { name: 'Find a restaurant', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Search Restaurants' })).toBeVisible();
  await page.getByLabel('City or area').fill('West Loop, Chicago, IL');
  await page.getByRole('combobox').fill('Girl & the Goat');
  await page.getByRole('button', { name: 'Search Restaurants' }).click();
  await expect(page.getByRole('option').filter({ hasText: 'West Randolph' }).first()).toBeVisible();
  await page.getByRole('option').filter({ hasText: 'West Randolph' }).first().click();
  await expect(page.getByText('809 W Randolph', { exact: false }).first()).toBeVisible();
  await page.getByText('Have a menu file or QR code instead?').click();
  await page.getByLabel('Upload menu file').setInputFiles(path.resolve('../.local/menu-uploads/girl-and-the-goat-menu-USD-user-confirmed.pdf'));
  await page.getByRole('button', { name: 'Extract this menu file' }).click();
  const menu = page.getByRole('region', { name: 'Extracted restaurant menu' });
  await expect(menu.locator('.real-menu-item')).toHaveCount(23);
  await expect(menu.getByRole('button', { name: 'Find My Personal Picks' })).toBeEnabled();
  await menu.getByRole('button', { name: 'Find My Personal Picks' }).click();
  await expect(page).toHaveURL(/\/picks$/, { timeout: 90_000 });
  await expect.poll(() => page.locator('.real-pick:not(.real-pick-stretch)').count(), { timeout: 90_000 }).toBeGreaterThan(0);
  expect(await page.locator('.real-pick:not(.real-pick-stretch)').count()).toBeLessThanOrEqual(3);
  await expect(page.getByText('TECHNICAL TEST ONLY', { exact: false }).first()).toBeVisible();
  await expect(page.locator('.real-pick-media img').first()).toBeVisible({ timeout: 45_000 });
  expect(requests).toEqual({ autocomplete: 1, details: 1, picks: 1 });
  const names = await page.locator('.real-pick:not(.real-pick-stretch) h3').allTextContents();
  console.log('LIVE_MVP_PICKS', JSON.stringify(names));
  await page.reload();
  await expect(page.locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(names.length);
  const second = await context.newPage();
  second.on('request', track);
  await second.goto('/picks');
  await expect(second.locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(names.length);
  expect(requests.picks).toBe(1);
  await second.setViewportSize({ width: 320, height: 740 });
  await expect.poll(() => second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await expect(second.locator('.real-pick:not(.real-pick-stretch) .real-pick-media img')).toHaveCount(names.length, { timeout: 45_000 });
  const card = second.locator('.real-pick:not(.real-pick-stretch)').first();
  await card.getByRole('button', { name: 'Save dish' }).click();
  await expect(card.getByRole('status').last()).toContainText('Saved to your private dining history.');
  await card.getByRole('button', { name: 'I tried this' }).click();
  await expect(card.getByRole('status').last()).toContainText('Saved to your private dining history.');
  await card.getByText('Rate this dish after trying it').click();
  await card.getByLabel('Rating (optional)').selectOption('5');
  await card.getByLabel('What stood out?').fill('QA TEST: crisp texture and satisfying flavor');
  await card.getByRole('button', { name: 'Loved it' }).click();
  await expect(card.getByText('Experience recorded')).toBeVisible();
  await second.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Memories' }).click();
  await expect(second.getByText('QA TEST: crisp texture and satisfying flavor', { exact: false })).toBeVisible();
  await second.reload();
  await second.getByRole('button', { name: 'Refresh dining history' }).click();
  await expect(second.getByText('QA TEST: crisp texture and satisfying flavor', { exact: false })).toBeVisible();
  await second.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'My picks' }).click();
  await expect(second.locator('.real-pick:not(.real-pick-stretch)')).toHaveCount(names.length);
  expect(requests.picks).toBe(1);
  await second.getByRole('button', { name: 'Something lighter' }).click();
  await expect(second.getByRole('button', { name: 'Tune My Table' })).toBeVisible();
  await second.getByRole('button', { name: 'Tune My Table' }).click();
  await expect.poll(() => requests.picks, { timeout: 30_000 }).toBe(2);
  await expect(second.getByText('TECHNICAL TEST ONLY', { exact: false }).first()).toBeVisible({ timeout: 90_000 });
  expect(requests.autocomplete).toBe(1);
  expect(requests.details).toBe(1);
});
