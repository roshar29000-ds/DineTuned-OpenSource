import { test, expect } from '@playwright/test';

test('welcome offers a clearly labeled offline demo without provider access', async ({ page }) => {
  await page.route('**/api/dinetuned/discovery/**', route => route.abort());
  await page.route('**/api/dinetuned/real-picks/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('link', { name: 'Try DineTuned Demo' }).click();
  await expect(page.getByRole('heading', { name: 'A table set for discovery.' })).toBeVisible();
  await expect(page.getByText('No Google or paid AI call is needed.')).toBeVisible();
});

test('How It Works distinguishes offline fixtures from the implemented Meta models', async ({ page }) => {
  await page.goto('/how-it-works#what-powers-this');
  const workflow = page.getByRole('region', { name: 'What powers DineTuned' });
  await expect(workflow).toContainText('Muse Spark 1.3');
  await expect(workflow).toContainText('Muse Image 1.0');
  await expect(workflow).toContainText('Python enforces menu identity');
  await workflow.getByText('What the models receive—and what the demo replays').click();
  await expect(workflow).toContainText('makes no Meta or Google request');
});
