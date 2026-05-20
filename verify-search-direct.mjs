import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  // Bypass onboarding and set project directly
  await page.addInitScript(() => {
    window.localStorage.setItem('codeux:onboarding-complete:v1', 'true');
    window.localStorage.setItem('sprintos_onboarding_completed', 'true');
    window.localStorage.setItem('sprintos_tour_completed', 'true');
    // We don't set active project so it hopefully defaults to something.
  });

  try {
    await page.goto('http://localhost:4444/sprints?sprintKey=SPR-18');
    await page.waitForTimeout(3000);

    // forcefully hide the top nav if it's intercepting clicks, just for visual check
    await page.evaluate(() => {
      const header = document.querySelector('header');
      if (header) header.style.display = 'none';
    });

    // Now wait a bit and screenshot
    await page.waitForTimeout(1000);
    await page.screenshot({ path: '/app/verify-search-direct.png', fullPage: true });
    console.log('Successfully captured screenshot to /app/verify-search-direct.png');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
})();
