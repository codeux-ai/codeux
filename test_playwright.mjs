import { chromium, devices } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext(devices['Desktop Chrome']);
  const page = await context.newPage();

  await page.goto('http://localhost:4444/sprints');
  await page.waitForLoadState('networkidle');

  await page.screenshot({ path: 'desktop_sprints_with_data.png', fullPage: true });

  // Mobile context
  const mobileContext = await browser.newContext(devices['iPhone 12']);
  const mobilePage = await mobileContext.newPage();
  await mobilePage.goto('http://localhost:4444/sprints');
  await mobilePage.waitForLoadState('networkidle');
  await mobilePage.screenshot({ path: 'mobile_sprints_with_data.png', fullPage: true });

  await browser.close();
})();
