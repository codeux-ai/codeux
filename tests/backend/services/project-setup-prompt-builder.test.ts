import { describe, expect, it } from "vitest";
import type { AgentPresetRecord } from "../../../src/contracts/agent-preset-types.js";
import type { DesignGuidanceSettings } from "../../../src/contracts/app-types.js";
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
  docs: false,
});

const designGuidance: DesignGuidanceSettings = {
  selectedTechStackId: "setup-stack",
  selectedStyleguideId: "setup-style",
  hideDefaultStyleguides: false,
  customTechStacks: [
    {
      id: "setup-stack",
      name: "Setup TypeScript Stack",
      summary: "Generate setup artifacts for a typed Preact service.",
      instructionMarkdown: "Use pnpm, strict TypeScript, and Vitest-backed workflows.",
    },
  ],
  customStyleguides: [
    {
      id: "setup-style",
      name: "Setup Product Style",
      summary: "Generate setup artifacts with compact product UI guidance.",
      instructionMarkdown: "Preserve existing design tokens, interaction states, and responsive behavior.",
    },
  ],
};

const noneStyleguideGuidance: DesignGuidanceSettings = {
  ...designGuidance,
  selectedStyleguideId: "none",
};

const noDesignGuidance: DesignGuidanceSettings = {
  selectedTechStackId: "none",
  selectedStyleguideId: "none",
  hideDefaultStyleguides: false,
  customTechStacks: designGuidance.customTechStacks,
  customStyleguides: designGuidance.customStyleguides,
};

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

  it("labels docs embedding as a Code UX-applied setup option", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      options: { ...options(false), docs: true },
    });

    expect(prompt).toContain("Requested artifacts: Docs Embedding");
    expect(prompt).toContain("Code UX will automatically discover repository documentation and embed it into the Knowledge docs library");
    expect(prompt).toContain("### Docs Embedding Rules");
    expect(prompt).toContain("Do not include embedded documents, document contents, or knowledge-library writes in the JSON output.");
  });

  it("includes selected project guidance before setup task instructions", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      designGuidance,
      options: options(false),
    });

    expect(prompt).toContain("## Project Guidance");
    expect(prompt).toContain("### Selected Tech Stack");
    expect(prompt).toContain("Name: Setup TypeScript Stack");
    expect(prompt).toContain("Summary: Generate setup artifacts for a typed Preact service.");
    expect(prompt).toContain("Use pnpm, strict TypeScript, and Vitest-backed workflows.");
    expect(prompt).toContain("### Selected Styleguide");
    expect(prompt).toContain("Name: Setup Product Style");
    expect(prompt).toContain("Preserve existing design tokens, interaction states, and responsive behavior.");
    expect(prompt).not.toContain("No active styleguide guidance is selected.");
    expect(prompt.indexOf("## Project Guidance")).toBeLessThan(prompt.indexOf("## Task"));
  });

  it("omits none styleguide text but tells setup to inspect existing styling before replacing it", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      designGuidance: noneStyleguideGuidance,
      options: options(false),
    });

    expect(prompt).toContain("## Project Guidance");
    expect(prompt).toContain("Name: Setup TypeScript Stack");
    expect(prompt).not.toContain("Name: None");
    expect(prompt).not.toContain("No additional project guidance is selected.");
    expect(prompt).not.toContain("Do not apply extra tech stack or styleguide guidance");
    expect(prompt).toContain("No active styleguide guidance is selected.");
    expect(prompt).toContain("investigate the repository's existing styling, brand assets, design tokens, components, layouts, and user-facing interaction patterns");
  });

  it("tells setup to inspect existing styling when both setup selections are none", () => {
    const prompt = buildProjectSetupPrompt({
      project,
      setupAgent,
      designGuidance: noDesignGuidance,
      options: options(false),
    });

    expect(prompt).toContain("## Project Guidance");
    expect(prompt).toContain("### Styleguide Selection");
    expect(prompt).not.toContain("Setup TypeScript Stack");
    expect(prompt).not.toContain("Setup Product Style");
    expect(prompt).toContain("No active styleguide guidance is selected.");
    expect(prompt).toContain("investigate the repository's existing styling, brand assets, design tokens, components, layouts, and user-facing interaction patterns");
    expect(prompt).not.toContain("No additional project guidance is selected.");
  });
});
