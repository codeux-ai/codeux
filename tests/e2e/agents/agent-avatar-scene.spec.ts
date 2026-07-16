import { test, expect } from '@playwright/test';
import { completeOnboarding, createE2EAgentPreset, ensureSelectedProject } from '../helpers/prepare-app';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

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

  test('should render the WebGL canvas or the accessible fallback when the context pool is unavailable', async ({ page }) => {
    await page.goto('/agents');
    await page.getByRole('button', { name: new RegExp(escapeRegExp(agentName)) }).click();

    await expect(page.locator('h2').filter({ hasText: agentName })).toBeVisible();

    const avatarScene = page.locator('[data-testid="agent-avatar-scene"]');
    const fallback = page.locator('[data-testid="agent-avatar-fallback"]');
    await expect(avatarScene.or(fallback).first()).toBeVisible();
    if (await avatarScene.isVisible()) {
      await expect(avatarScene.locator('canvas')).toBeVisible();
    } else {
      await expect(fallback).toHaveRole('img');
      await expect(fallback).toHaveAccessibleName(/Agent avatar preview/i);
    }
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
    await page.getByRole('button', { name: new RegExp(escapeRegExp(agentName)) }).click();

    // Verify that the fallback SVG container is rendered instead of the WebGL canvas
    const fallbackSvg = page.locator('[data-testid="agent-avatar-fallback"]');
    await expect(fallbackSvg).toBeVisible();

    const avatarScene = page.locator('[data-testid="agent-avatar-scene"]');
    await expect(avatarScene).not.toBeVisible();
  });

  test('should preserve forced tool selection across WebGL, fallback, swaps, and unmount', async ({ page }) => {
    await page.goto('/chat?stageTool=wrench');

    const avatarScene = page.locator('[data-testid="agent-avatar-scene"]');
    const initialFallback = page.locator('[data-testid="agent-avatar-fallback"]');
    const initialAvatar = avatarScene.or(initialFallback).first();
    await expect(initialAvatar).toBeVisible();
    await expect(initialAvatar).toHaveAttribute('data-tool', 'wrench');

    await page.emulateMedia({ reducedMotion: 'reduce' });
    const fallback = page.locator('[data-testid="agent-avatar-fallback"]');
    await expect(fallback).toBeVisible();
    await expect(fallback).toHaveAttribute('data-tool', 'wrench');
    await expect(page.getByTestId('agent-avatar-static-tool')).toHaveText('Open-end wrench');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/chat?stageTool=torch');
    const torchScene = page.locator('[data-testid="agent-avatar-scene"]');
    const torchFallback = page.locator('[data-testid="agent-avatar-fallback"]');
    await expect(torchScene.or(torchFallback).first()).toHaveAttribute('data-tool', 'torch');

    await page.goto('/agents');
    await expect(page.locator('[data-testid="agent-avatar-scene"][data-tool]')).toHaveCount(0);
  });
});
