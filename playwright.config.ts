import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codeux-e2e-home-'));
const runId = (process.env.CODEUX_E2E_RUN_ID
  ?? process.env.GITHUB_RUN_ID
  ?? `local-${new Date().toISOString()}`)
  .replace(/[^a-zA-Z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

process.env.CODEUX_E2E_RUN_ID = runId;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  outputDir: 'test-results',
  /* Run tests in files in parallel */
  fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  /* Keep browser tests serialized because they share one local server and DB. */
  workers: 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env.CI
    ? [['github'], ['html', { outputFolder: 'playwright-report', open: 'never' }]]
    : [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL: 'http://127.0.0.1:4444',

    /* Preserve failure artifacts without producing heavy output for passing runs. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'node dist/index.js',
    // Poll the liveness probe (/health) rather than the readiness probe (/ready).
    // /ready only returns 200 once a project has a live-status timestamp, which
    // never happens in a clean CI checkout, so it would hang until timeout.
    url: 'http://127.0.0.1:4444/health',
    reuseExistingServer: false,
    timeout: 60000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      HOME: tempHome,
      USERPROFILE: tempHome,
      CODEUX_E2E_RUN_ID: runId,
    },
  },
});
