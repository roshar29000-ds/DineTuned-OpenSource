import type { Page } from '@playwright/test';
export const savedProfile = {
  version: 2, taste: { schema_version: 2, complete: true, favorites: 'Crispy tacos', axes: { spice: .18, richness: .7, freshness: .5, crunch: .8, aromatic: null, sweetness: null, umami: null },
    exploration: .5, dietary_restrictions: [], allergies: { allergens: [], other: '' }, updated_at: null, source: 'guided_demo' },
  constraints: { max_price_minor: 3000, currency: 'USD', dietary_restrictions: [], allergies: { allergens: [], other: '' }, mood: 'open', appetite: 'any' },
  selection: null, feedback: [],
};
export async function returningUser(page: Page) {
  await page.addInitScript(state => {
    if (!sessionStorage.getItem('dinetuned-test-seeded')) {
      localStorage.setItem('dinetuned-v2', JSON.stringify(state));
      sessionStorage.setItem('dinetuned-test-seeded', 'true');
    }
  }, savedProfile);
}
export async function openMenuFilters(page: Page) {
  if (!await page.getByLabel('Budget per dish', { exact: true }).isVisible()) await page.locator('.menu-filter-trigger').click();
}
export async function closeMenuFilters(page: Page) {
  const close = page.getByRole('button', { name: 'Close preferences', exact: true });
  if (await close.isVisible()) await close.click();
}
