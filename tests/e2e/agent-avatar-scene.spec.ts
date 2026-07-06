import { test, expect } from '@playwright/test';
import { completeOnboarding, createE2EAgentPreset, ensureSelectedProject } from './helpers/prepare-app';

test.describe('AgentAvatarScene E2E Tests', () => {
  let agentName: string;

  test.beforeEach(async ({ request }, testInfo) => {
    await completeOnboarding(request);
    // Agents are project-scoped; the create button is disabled without a
    // selected project, so seed one before the page loads.
    const project = await ensureSelectedProject(request, { testInfo, fixtureKey: 'agents' });
    const agent = await createE2EAgentPreset(request, project.id);
    agentName = agent.name;
  });

  test('should render the WebGL canvas when WebGL is supported', async ({ page }) => {
    await page.goto('/agents');
    await page.getByRole('button', { name: new RegExp(agentName) }).click();

    // The 3D scene is lazy-loaded when its portrait host intersects the
    // viewport. Bring the host into view before asserting the WebGL renderer.
    await page.locator('[data-testid="lazy-agent-avatar-scene"]').first().scrollIntoViewIfNeeded();

    // Assert that the 3D scene container is rendered and contains a canvas
    const avatarScene = page.locator('[data-testid="agent-avatar-scene"]');
    await expect(avatarScene).toBeVisible();

    const canvas = avatarScene.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('should render fallback UI (SVG) when WebGL is unsupported or fails', async ({ page }) => {
    // Inject script to disable WebGL support before the page loads
    await page.addInitScript(() => {
      // Mock HTMLCanvasElement.prototype.getContext to return null for webgl/webgl2 contexts
      const originalGetContext = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') {
          return null;
        }
        return originalGetContext.apply(this, [type, ...args]);
      } as any;
    });

    await page.goto('/agents');
    await page.getByRole('button', { name: new RegExp(agentName) }).click();

    // Verify that the fallback SVG container is rendered instead of the WebGL canvas
    const fallbackSvg = page.locator('[data-testid="agent-avatar-fallback"]');
    await expect(fallbackSvg).toBeVisible();

    const avatarScene = page.locator('[data-testid="agent-avatar-scene"]');
    await expect(avatarScene).not.toBeVisible();
  });
});
