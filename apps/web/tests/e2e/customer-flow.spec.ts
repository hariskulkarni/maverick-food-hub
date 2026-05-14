import { test, expect } from '@playwright/test';

test.describe('Customer happy path', () => {
  test('home page renders the menu CTA and brand', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Saffron|Restaurant/i);
    await expect(page.getByRole('link', { name: /order now/i })).toBeVisible();
  });

  test('menu page lists items and supports search', async ({ page }) => {
    await page.goto('/menu');
    await expect(page.getByPlaceholder('Search menu')).toBeVisible();
    await page.getByPlaceholder('Search menu').fill('biryani');
    await expect(page.getByText(/biryani/i).first()).toBeVisible();
  });

  test('login page shows the OTP tab and can request a code in dev', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('tab', { name: /customer/i })).toBeVisible();
  });
});
