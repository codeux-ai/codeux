import { describe, expect, it } from "vitest";
import { CATEGORIES } from "../../../dashboard/src/v2/components/settings/SettingsCategoryRail.js";
import {
  buildSettingsSearchIndex,
  getSettingsSearchMatchPreview,
  searchSettingsCategories,
} from "../../../dashboard/src/v2/lib/settings-search-index.js";
import {
  providerDescriptions,
  providerLabels,
} from "../../../dashboard/src/v2/lib/onboarding-provider-settings.js";
import type { IntegrationDefinition } from "../../../dashboard/src/v2/hooks/use-settings-page-state.js";

const integrations: IntegrationDefinition[] = [
  { id: "jules", label: providerLabels.jules, description: providerDescriptions.jules },
  { id: "gemini", label: providerLabels.gemini, description: providerDescriptions.gemini },
  { id: "antigravity", label: providerLabels.antigravity, description: providerDescriptions.antigravity },
  { id: "codex", label: providerLabels.codex, description: providerDescriptions.codex },
  { id: "claude-code", label: providerLabels["claude-code"], description: providerDescriptions["claude-code"] },
  { id: "qwen-code", label: providerLabels["qwen-code"], description: providerDescriptions["qwen-code"] },
  { id: "opencode", label: providerLabels.opencode, description: providerDescriptions.opencode },
  { id: "github", label: "GitHub", description: "Repository, pull request, branch, and CI integration" },
  { id: "gitlab", label: "GitLab", description: "GitLab repository, merge request, and CI token integration" },
  { id: "jira", label: "Jira", description: "Atlassian Jira issue search, sprint linking, and completion transitions" },
];

const index = buildSettingsSearchIndex({
  categories: CATEGORIES,
  providerLabels,
  integrations,
  invocationRouteDefinitions: [
    { id: "task_coding", label: "Task coding", description: "Primary coding execution for provider-routed task work." },
    { id: "qa_review", label: "QA review", description: "Completion-time quality assurance reviews." },
  ],
  agentInstructionTemplateOptions: [
    { value: "branchMissing", label: "Branch Missing", description: "Shown when the sprint feature branch must be created first." },
  ],
  thinkingModeOptions: [
    { value: "SMALL", label: "Small" },
    { value: "MEDIUM", label: "Medium" },
    { value: "HIGH", label: "High" },
  ],
});

describe("settings search index", () => {
  it("finds the Claude Code provider in model and integration settings", () => {
    const matches = searchSettingsCategories(index, "claude");

    expect(matches.models?.matchedLabels).toContain("Claude Code");
    expect(matches.integrations?.matchedLabels).toContain("Claude Code");
    expect(getSettingsSearchMatchPreview(matches.integrations)).toContain("Claude Code");
  });

  it.each([
    ["provider", ["models", "integrations"]],
    ["jira", ["integrations"]],
    ["github", ["integrations"]],
    ["model", ["models"]],
    ["mcp", ["mcp"]],
    ["qa", ["models", "sprint"]],
    ["branch", ["sprint", "agents"]],
    ["browser", ["browser"]],
    ["memory", ["memory"]],
  ] as const)("resolves %s to the expected settings categories", (query, expectedCategoryIds) => {
    const matches = searchSettingsCategories(index, query);

    for (const categoryId of expectedCategoryIds) {
      expect(matches[categoryId], `${query} should match ${categoryId}`).toBeDefined();
    }
  });
});
