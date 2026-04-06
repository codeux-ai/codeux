import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

  await page.route('**/api/projects', async (route) => {
    console.log("Intercepted: ", route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        projects: [{
          id: 'p-1',
          name: 'Project Test',
          key: 'TEST',
          description: 'A test project',
          hasGitStatus: false
        }],
        selectedProjectId: 'p-1'
      })
    });
  });

  await page.route('**/api/projects/p-1/sprints', async (route) => {
    console.log("Intercepted: ", route.request().url());
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sprints: [
          {
            id: 's-1',
            projectId: 'p-1',
            name: 'Missing sprintNumber',
            number: 42,
            status: 'active',
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString()
          },
          {
            id: 's-2',
            projectId: 'p-1',
            name: 'Has both',
            sprintNumber: 43,
            number: 43,
            status: 'planned',
            startDate: new Date().toISOString(),
            endDate: new Date().toISOString()
          }
        ],
        selectedSprintId: null
      })
    });
  });

  await page.route('**/api/settings', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} })
    });
  });

  await page.route('**/api/me', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: "1" })
    });
  });

  try {
    await page.goto('http://localhost:4446/');

    await page.waitForTimeout(2000); // Give it time to load data and render

    // Check if the sprint selector is visible directly
    const sprintSelector = page.locator('button:has-text("All Sprints"), button:has-text("SPR-")').first();

    if (await sprintSelector.isVisible()) {
        console.log("Sprint selector is directly visible!");
        await sprintSelector.click();
        console.log("Clicked Sprint selector. Waiting for drop down items...");
        await page.waitForTimeout(1000);
    } else {
        console.log("Sprint selector not found. Trying to select project from dropdown...");
        const projectSelector = page.getByRole('button', { name: /Select Project/i });
        if (await projectSelector.isVisible()) {
            await projectSelector.click();
            await page.waitForTimeout(500);

            // There might be multiple Project Test texts. Click the one in the dropdown list.
            const projectOption = page.locator('button:has-text("Project Test")');
            if (await projectOption.count() > 0) {
               await projectOption.first().click();
            } else {
               const anyProjectOption = page.getByText('Project Test').first();
               await anyProjectOption.click();
            }
            await page.waitForTimeout(1500);
            await sprintSelector.waitFor({ state: 'visible', timeout: 5000 });
            await sprintSelector.click();
            await page.waitForTimeout(1000);
        } else {
            console.log("Project selector not visible either.");
        }
    }

    // Take a screenshot of the open dropdown
    await page.screenshot({ path: '/app/sprint-selector.png', fullPage: true });
    console.log('Successfully captured screenshot to /app/sprint-selector.png');

  } catch (err) {
    console.error('Test failed:', err);
    await page.screenshot({ path: '/app/error-sprint.png', fullPage: true });
  } finally {
    await browser.close();
  }
})();
