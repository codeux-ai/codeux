import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  // Bypass onboarding
  await page.addInitScript(() => {
    window.localStorage.setItem('codeux:onboarding-complete:v1', 'true');
    window.localStorage.setItem('sprintos_onboarding_completed', 'true');
    window.localStorage.setItem('sprintos_tour_completed', 'true');
  });

  try {
    await page.goto('http://localhost:4444/sprints?sprintKey=SPR-18');
    await page.waitForTimeout(2000);

    const projectSelector = page.getByRole('button', { name: /Select Project/i });
    if (await projectSelector.isVisible()) {
        await projectSelector.click();
        await page.waitForTimeout(500);

        const anyProjectOption = page.getByText('system-repo').first();
        if (await anyProjectOption.isVisible()) {
            await anyProjectOption.click();
        } else {
            const fallbackOption = page.locator('button[role="menuitem"]').first();
            await fallbackOption.click();
        }
        await page.waitForTimeout(2000);
    }

    await page.screenshot({ path: '/app/verify-search-project.png', fullPage: true });
    console.log('Successfully captured screenshot to /app/verify-search-project.png');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
})();
