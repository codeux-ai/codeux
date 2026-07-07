import { describe, expect, it } from "vitest";
import type { AgentPresetRecord } from "../../../src/contracts/agent-preset-types.js";
import type { ProjectSetupOptions, ProjectSummary } from "../../../src/contracts/project-management-types.js";
import { buildProjectSetupPrompt } from "../../../src/services/project-setup-prompt-builder.js";

const project: ProjectSummary = {
  id: "project-1",
  slug: "project-one",
  name: "Project One",
  baseDir: "/workspace/project-one",
  repoUrl: null,
  sourceType: "local",
  sourceRef: "/workspace/project-one",
  gitProvider: "local",
  gitHostDomain: null,
  defaultBranch: null,
  featureBranchPrefix: null,
  status: "idle",
  sprintsCount: 0,
  openTasks: 0,
  completedTasks: 0,
  isRunning: false,
  settingsOverrides: {},
  agentBindings: [],
  lastRunAt: null,
  lastRunStatus: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const setupAgent: AgentPresetRecord = {
  id: "agent-setup",
  projectId: project.id,
  name: "Project Setup Agent",
  description: "Sets up project artifacts.",
  instructionMarkdown: "Inspect the repository and return JSON.",
  labels: ["planning", "setup"],
  sourcePath: null,
  sourceScope: null,
  sourceUpdatedAt: null,
  sourceImportedAt: null,
  sourceExists: false,
  syncStatus: "manual",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const options = (techstack: boolean): ProjectSetupOptions => ({
  agents: false,
  quicksprints: false,
  previewScript: false,
  ci: false,
  techstack,
});

describe("buildProjectSetupPrompt", () => {
  it("includes package-manifest techstack detection instructions when enabled", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      options: options(true),
    });

    expect(prompt).toContain("Requested artifacts: Techstack Detection");
    expect(prompt).toContain("### Techstack Detection Rules");
    expect(prompt).toContain("especially package.json dependency sections");
    expect(prompt).toContain('"detectedFrameworks": ["Vite", "React"]');
    expect(prompt).toContain('"detectedLibraries": ["TypeScript", "Vitest", "Tailwind CSS"]');
  });

  it("omits techstack detection rules and asks for null when disabled", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      options: options(false),
    });

    expect(prompt).toContain("Requested artifacts: none");
    expect(prompt).not.toContain("### Techstack Detection Rules");
    expect(prompt).not.toContain('"detectedFrameworks": ["Vite", "React"]');
    expect(prompt).toContain('"techstack": null');
    expect(prompt).toContain("Set `techstack` to null.");
  });
});
