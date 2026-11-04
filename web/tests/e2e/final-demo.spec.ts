import { expect, test } from '@playwright/test';

for (const variant of ['crisp with unknowns', 'aromatic and spicy']) test(`Taste Detective publishes the same evidence shown in its preview: ${variant}`, async ({ page }) => {
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Meet Taste Detective' }).click();
  await page.getByRole('button', { name: variant === 'crisp with unknowns' ? 'Crispy tacos' : 'A fragrant curry' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: variant === 'crisp with unknowns' ? 'That first crunch' : 'The aroma' }).click();
  if (variant === 'aromatic and spicy') {
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Bright & lively' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Bring the heat' }).click();
  }
  for (let i = 0; i < 12 && !(await page.getByRole('button', { name: 'Create my Taste DNA' }).isVisible().catch(() => false)); i++)
    await page.getByRole('button', { name: 'Continue' }).click();
  const preview = Number(await page.locator('.v3-portrait-foot b').innerText());
  expect(preview).toBeGreaterThan(0);
  if (variant === 'crisp with unknowns') expect(preview).toBeLessThan(7);
  await page.getByRole('button', { name: 'Create my Taste DNA' }).click();
  await expect(page.getByRole('heading', { name: 'Your Taste DNA.' })).toBeVisible();
  await expect(page.locator('.v3-coverage strong')).toContainText(`${preview}/7`);
  await page.reload();
  await expect(page.locator('.v3-coverage strong')).toContainText(`${preview}/7`);
});

test('isolated guided sample uses original Explore, menu and Picks pages', async ({ page }, info) => {
  const paid: string[] = [];
  page.on('request', request => { if (/discovery\/(sessions|autocomplete|selection)|real-picks\/sessions|menu-sources|menu-extraction/.test(request.url())) paid.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem('dinetuned-v2', 'real-guest-sentinel'));
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Use a clearly labeled sample palate' }).click();
  await expect(page.getByRole('heading', { name: 'Your Taste DNA.' })).toBeVisible();
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-taste-dna-current.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Find a restaurant' }).click();
  await expect(page).toHaveURL(/\/discover$/);
  await expect(page.getByRole('heading', { name: /Where shall we set your table/ })).toBeVisible();
  await expect(page.locator('.rs-card')).toHaveCount(6);
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-explore-current.png'), fullPage: true, animations: 'disabled' });
  await page.locator('.rs-card').first().click();
  await expect(page.locator('.smart-menu-page')).toBeVisible();
  await expect(page.locator('.smart-dish-card')).toHaveCount(20);
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-menu-current.png'), animations: 'disabled' });
  if (info.project.name === 'desktop') {
    await page.locator('.menu-category-section').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath('demo-menu-items-current.png'), animations: 'disabled' });
  }
  await page.getByRole('button', { name: 'Find My Personal Picks' }).first().click();
  await expect(page).toHaveURL(/\/picks$/);
  await expect(page.getByRole('heading', { name: 'Muse is cooking up your picks' })).toBeVisible();
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-test-kitchen-current.png'), animations: 'disabled' });
  await page.getByRole('button', { name: /Skip|Open.*Picks/ }).click();
  await expect(page.locator('.signature-collection .signature-pick').first()).toBeVisible();
  await expect(page.locator('.signature-collection .dish-art-photo img')).toHaveCount(3);
  await expect.poll(() => page.locator('.signature-collection .dish-art-photo img').evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-picks-current.png'), fullPage: true, animations: 'disabled' });
  const pick = page.locator('.signature-collection .signature-pick').first();
  const dishName = await pick.locator('h2').first().innerText();
  await pick.getByRole('button', { name: 'Select dish' }).click();
  await pick.getByRole('button', { name: 'Save dish' }).click();
  await pick.getByText('Evidence & unknowns').click();
  await expect(pick.getByText('Why this pick')).toBeVisible();
  await pick.getByRole('button', { name: 'I tried this' }).click();
  await pick.getByText('Tried this? Tell us how it went').click();
  await pick.getByLabel('Your rating').selectOption('5');
  await pick.getByLabel('What stood out?').fill('Bright and satisfying.');
  await pick.getByRole('button', { name: 'Loved it' }).click();
  await expect(page.locator('.complete-table')).toBeVisible();
  await page.getByRole('button', { name: 'More spicy' }).click();
  await expect(page.getByRole('button', { name: 'More spicy' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'Reset refinements' }).click();
  await page.screenshot({ path: info.outputPath(`final-demo-${info.project.name}.png`), fullPage: true, animations: 'disabled' });
  await page.reload();
  await expect(page.locator('.signature-collection')).toBeVisible();
  await page.getByRole('link', { name: /Memories/ }).first().click();
  await expect(page).toHaveURL(/\/memory$/);
  await expect(page.getByText(dishName, { exact: true }).first()).toBeVisible();
  if (info.project.name === 'desktop') await page.screenshot({ path: info.outputPath('demo-memory-current.png'), animations: 'disabled' });
  await page.getByRole('button', { name: 'Restart demo' }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole('heading', { name: 'A table set for discovery.' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('dinetuned-v2'))).toBe('real-guest-sentinel');
  expect(paid).toEqual([]);
});

test('all six fictional restaurants have full menus and grounded offline Picks', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('/demo');
  await page.getByRole('button', { name: 'Use a clearly labeled sample palate' }).click();
  await page.getByRole('button', { name: 'Find a restaurant' }).click();
  await expect(page.locator('.rs-card')).toHaveCount(6);
  const links = await page.locator('.rs-card').evaluateAll(cards => cards.map(card => (card as HTMLAnchorElement).getAttribute('href')));
  expect(links).toHaveLength(6);
  for (const href of links) {
    await page.goto(href!);
    await expect(page.locator('.smart-dish-card')).toHaveCount(20);
    await expect(page.locator('.menu-category-section')).toHaveCount(7);
    await page.getByRole('button', { name: 'Find My Personal Picks' }).first().click();
    await page.getByRole('button', { name: 'Open sample Picks now →' }).click();
    await expect(page.locator('.signature-pick').first()).toBeVisible();
    await expect(page.locator('.signature-pick').first().locator('.dish-art-photo img')).toBeVisible();
    await page.goto('/discover');
  }
});
