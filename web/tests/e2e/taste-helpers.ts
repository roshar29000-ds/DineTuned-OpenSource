import { expect, type Page } from '@playwright/test';
export async function nextAnswer(page: Page) { await page.getByRole('button', { name: 'Continue', exact: true }).click(); }
export async function completeTastingNotes(page: Page, aromatic = false) {
  await page.getByRole('button', { name: aromatic ? 'A fragrant curry' : 'Crispy tacos', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Rich, cozy flavors', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Velvety & comforting', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Keep it mellow', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Crisp & crackly', exact: true }).click();
  await nextAnswer(page);
  if (aromatic) {
    await expect(page.getByRole('heading', { name: /A fragrant detour/ })).toBeVisible();
    await page.getByRole('button', { name: 'Warm, toasted spices', exact: true }).click();
    await nextAnswer(page);
  }
  await page.getByRole('group', { name: 'Response choices', exact: true }).getByRole('button', { name: 'Chili', exact: true }).click();
  await page.getByRole('group', { name: 'Ingredients to enjoy less' }).getByRole('button', { name: 'Sweet glazes', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'Crisped & fried', exact: true }).click();
  await nextAnswer(page);
  await page.getByRole('button', { name: 'One foot in the familiar', exact: true }).click();
  await nextAnswer(page);
  await expect(page.getByRole('heading', { name: 'A good host remembers the essentials.' })).toBeVisible();
  await nextAnswer(page);
  await expect(page.getByRole('button', { name: 'Create my Taste DNA' })).toBeVisible();
}
