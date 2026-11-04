import { test, expect } from '@playwright/test';
import { nextAnswer } from './taste-helpers';

test('saved sparse Detective answers reach Python and render qualified Picks after reload', async ({ page }) => {
  // Actual interview/storage/request path, without injecting an invented profile.
  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'A fragrant curry', exact: true }).click();
  await nextAnswer(page);
  for (let i = 0; i < 4; i++) await page.getByRole('button', { name: 'Leave open', exact: true }).click();
  await page.getByRole('button', { name: 'Warm, toasted spices', exact: true }).click();
  await nextAnswer(page);
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Leave open', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page).toHaveURL(/\/taste$/);
  await page.reload();
  await expect(page.locator('.v3-coverage strong')).toHaveText('1/7');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('dinetuned-v2')!));
  await page.goto('/restaurant/spice-garden');
  await expect(page.locator('[data-dish-id]')).toHaveCount(4);
  const response = page.waitForResponse(res => res.url().endsWith('/recommendation-sessions') && res.request().method() === 'POST');
  await page.locator('.menu-picks-top button').click();
  const received = await response;
  expect(received.status()).toBe(200);
  const sent = received.request().postDataJSON();
  expect(sent.profile).toEqual(saved.taste);
  expect(sent.constraints).toEqual(saved.constraints);
  expect(sent.taste_evidence.favorite_dishes).toEqual(['curry']);
  expect(sent.profile.axes.aromatic).toBe(.85);
  expect(sent.profile.axes.spice).toBeNull();
  expect((await received.json()).recommendations.map((r: { dish: { id: string } }) => r.dish.id)).toEqual(['chana-masala', 'butter-chicken']);
  await expect(page.locator('.signature-pick')).toHaveCount(2);
  await expect(page.locator('.signature-pick').first()).toContainText('Chana Masala');
  await page.locator('.pp-evidence > summary').first().click();
  await expect(page.locator('.signature-pick').first()).toContainText('Limited taste coverage');
});
