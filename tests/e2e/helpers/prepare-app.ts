import type { APIRequestContext } from '@playwright/test';

// A freshly-checked-out server (as in CI) starts with the first-run onboarding
// overlay open, no projects, and no selected project. The overlay is a
// full-screen layer that intercepts pointer events, and most app UI (e.g. the
// "New Agent" button) is disabled until a project is selected. These helpers
// drive the same server APIs the dashboard uses, so the state is applied before
// the page loads it.

export async function completeOnboarding(request: APIRequestContext): Promise<void> {
  // Marks onboarding complete server-side; GET /api/user/onboarding then reports
  // `completed: true`, so OnboardingExperience never opens the overlay.
  await request.post('/api/user/onboarding/complete');
}

// Ensures the server has a project AND that it is the selected one. Idempotent:
// safe to call from every spec's beforeEach even with parallel workers sharing
// one server (selection is global server state, and all specs only need *some*
// project selected, not an exclusive one).
export async function ensureSelectedProject(request: APIRequestContext): Promise<string> {
  const res = await request.get('/api/projects');
  const body = (await res.json()) as { projects?: Array<{ id: string }>; selectedProjectId?: string | null };

  if (body.selectedProjectId) {
    return body.selectedProjectId;
  }

  let projectId = body.projects?.[0]?.id;
  if (!projectId) {
    // The repo checkout itself is a valid local source for an "existing" project.
    const created = await request.post('/api/projects', {
      data: { name: 'E2E Test Project', sourceType: 'local', sourceRef: process.cwd() },
    });
    projectId = ((await created.json()) as { id: string }).id;
  }

  await request.put(`/api/projects/${projectId}/select`);
  return projectId;
}

export async function createE2EAgentPreset(
  request: APIRequestContext,
  projectId: string,
): Promise<{ id: string; name: string }> {
  const name = `E2E Avatar Agent ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await request.post(`/api/projects/${projectId}/agent-presets`, {
    data: {
      name,
      description: 'E2E avatar rendering fixture',
      instructionMarkdown: '',
      labels: ['e2e'],
      avatarConfig: {
        chassis: 'classic',
        eyes: 'smile',
        antenna: 'jewel',
        wings: 'none',
        headphones: 'bumper',
        accent: 'jade',
        baseColor: 'pearl',
      },
    },
  });

  if (!created.ok()) {
    throw new Error(`Failed to create E2E agent preset: ${created.status()} ${await created.text()}`);
  }

  const body = (await created.json()) as { id: string; name: string };
  return { id: body.id, name: body.name };
}
