import { test, expect } from '@playwright/test';

test('Global accessibility elements are present and have correct roles', async ({ page }) => {
  await page.goto('/');

  // 1. Verify skip link
  const skipLink = page.getByRole('link', { name: /skip to main content/i });
  await expect(skipLink).toBeAttached();

  // 2. Verify primary navigation
  const nav = page.getByRole('navigation', { name: /primary navigation/i });
  await expect(nav).toBeAttached();

  // 3. Verify global search
  const search = page.getByRole('search');
  await expect(search).toBeAttached();

  // 4. Verify project selector
  const combobox = page.getByRole('button', { name: /selected project:/i });
  // The trigger has aria-haspopup="listbox" but is a button, so getByRole('button') is more precise. We can also verify aria-haspopup.
  await expect(combobox).toBeAttached();
  await expect(combobox).toHaveAttribute('aria-haspopup', 'listbox');
});
