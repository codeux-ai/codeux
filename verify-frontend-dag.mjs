import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  try {
    await page.goto('http://localhost:4444/dashboard/');

    await page.waitForTimeout(2000);

    // Navigate to a project and sprint to render the DAG
    console.log("Looking for sprint or project selectors...");

    // Simplistic click-through to try and trigger DAG rendering if available
    // Assuming UI has "View DAG" or similar, or it's rendered natively.
    // We'll just take a screenshot of whatever is there.

    await page.screenshot({ path: '/app/dag-overview.png', fullPage: true });
    console.log('Successfully captured screenshot to /app/dag-overview.png');

  } catch (err) {
    console.error('Test failed:', err);
    await page.screenshot({ path: '/app/error-dag.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
