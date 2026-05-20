import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  await page.addInitScript(() => {
    window.localStorage.setItem('codeux:onboarding-complete:v1', 'true');
    window.localStorage.setItem('sprintos_onboarding_completed', 'true');
    window.localStorage.setItem('sprintos_tour_completed', 'true');
    window.matchMedia = window.matchMedia || function() {
        return {
            matches: true, // prefers-reduced-motion: reduce
            addListener: function() {},
            removeListener: function() {}
        };
    };
  });

  try {
    await page.goto('http://localhost:4444/sprints?sprintKey=SPR-18', { waitUntil: 'domcontentloaded' });

    // forcefully hide the top nav if it's intercepting clicks
    await page.evaluate(() => {
      const header = document.querySelector('header');
      if (header) header.style.display = 'none';
      window.localStorage.setItem('sprintos_active_project', 'system-repo'); // ensure active project
    });

    // reload with proper local storage
    await page.goto('http://localhost:4444/sprints?sprintKey=SPR-18', { waitUntil: 'load', timeout: 30000 });

    // Stop animations manually if any are left
    await page.evaluate(() => {
        const style = document.createElement('style');
        style.innerHTML = `
            * {
                animation: none !important;
                transition: none !important;
            }
        `;
        document.head.appendChild(style);
    });

    await page.waitForTimeout(1000);
    // don't use fullPage since it fails
    await page.screenshot({ path: '/app/verify-search-state.png' });
    console.log('Successfully captured screenshot to /app/verify-search-state.png');
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await browser.close();
  }
})();
