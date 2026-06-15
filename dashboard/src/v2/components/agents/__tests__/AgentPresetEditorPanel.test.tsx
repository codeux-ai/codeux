/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { describe, expect, afterEach, vi, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AgentPresetEditorPanel } from "../AgentPresetEditorPanel.js";
import { DEFAULT_AGENT_MEMORY_CONFIG, type AgentMemoryConfig } from "../../../memory-types.js";
import type { AgentPreset } from "../../../types.js";
import * as knowledgeApi from "../../../lib/knowledge-api.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    to: vi.fn().mockImplementation((_, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    fromTo: vi.fn().mockImplementation((_, __, config) => {
      if (config?.onComplete) config.onComplete();
    }),
    context: vi.fn().mockImplementation((fn) => {
      if (fn) fn();
      return { revert: vi.fn() };
    }),
  },
}));

vi.mock("../AgentAvatarStage.js", () => ({
  AgentAvatarStage: () => <div data-testid="avatar-stage" />,
}));

vi.mock("../AgentAvatarCustomizer.js", () => ({
  AgentAvatarCustomizer: () => <div data-testid="avatar-customizer" />,
}));

vi.mock("../AgentMcpManageModal.js", () => ({
  AgentMcpManagePanel: () => <div data-testid="mcp-manage-panel" />,
}));

vi.mock("../../providers/ProviderBrandIcon.js", () => ({
  ProviderBrandIcon: () => <div data-testid="provider-brand-icon" />,
}));

vi.mock("../../ui/BorderTrace.js", () => ({
  BorderTrace: () => null,
}));

vi.mock("../../ui/ConfirmDialog.js", () => ({
  ConfirmDialog: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <div data-testid="confirm-dialog" /> : null),
}));

vi.mock("../../ui/MarkdownEditorField.js", () => ({
  MarkdownEditorField: ({
    id,
    value,
    onChange,
    onBlur,
    placeholder,
  }: {
    id: string;
    value: string;
    onChange: (next: string) => void;
    onBlur?: () => void;
    placeholder?: string;
  }) => (
    <textarea
      id={id}
      aria-label={id}
      value={value}
      onInput={(event) => onChange(event.currentTarget.value)}
      onBlur={onBlur}
      placeholder={placeholder}
    />
  ),
  MARKDOWN_PROSE_CLASS: "prose",
}));

vi.mock("../../ui/AvantgardeSelect.js", () => ({
  AvantgardeSelect: ({
    value,
    onChange,
    placeholder,
    options,
    ...rest
  }: {
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    options: Array<{ value: string; label: string }>;
    [key: string]: unknown;
  }) => (
    <select
      {...rest}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      aria-label={(rest["aria-label"] as string) ?? "select"}
    >
      <option value="">{placeholder ?? "Select"}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("../../../lib/knowledge-api.js", () => ({
  fetchKnowledgeDocuments: vi.fn(async () => [
    {
      id: "doc_codeux",
      projectId: "project_1",
      title: "Code UX Docs",
      sourceType: "repo_path",
      sourceRef: "codeux/internaldocs",
      mimeType: "text/markdown",
      byteSize: 1200,
      charCount: 1200,
      tokenCount: 300,
      summary: "Internal product and architecture documentation",
      contentHash: "hash_codeux",
      status: "ready",
      embeddingModel: "bge-small-en-v1.5",
      chunkCount: 4,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      subscriberAgentIds: [],
    },
    {
      id: "doc_runbook",
      projectId: "project_1",
      title: "Deploy Runbook",
      sourceType: "paste",
      sourceRef: null,
      mimeType: "text/markdown",
      byteSize: 600,
      charCount: 600,
      tokenCount: 150,
      summary: "Deployment notes and release checklist",
      contentHash: "hash_runbook",
      status: "ready",
      embeddingModel: "bge-small-en-v1.5",
      chunkCount: 2,
      errorMessage: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      subscriberAgentIds: [],
    },
  ]),
  fetchAgentKnowledgeSubscriptions: vi.fn(async () => []),
  setAgentKnowledgeSubscriptions: vi.fn(async (_agentPresetId: string, documentIds: string[]) => documentIds),
}));

function makePreset(overrides: Partial<AgentPreset> = {}): AgentPreset {
  return {
    id: "preset_1",
    projectId: "project_1",
    name: "Planning Agent",
    description: "Plan the work",
    instructionMarkdown: "Base instructions",
    labels: [],
    sourcePath: null,
    sourceScope: null,
    sourceUpdatedAt: null,
    sourceImportedAt: null,
    sourceExists: false,
    syncStatus: "manual",
    avatarConfig: {},
    providerConfigId: null,
    model: null,
    memoryTemplateOverrideEnabled: false,
    memoryTemplateMarkdown: "",
    memoryConfig: { ...DEFAULT_AGENT_MEMORY_CONFIG },
    mcpAccess: {
      codeUxEnabled: false,
      codeUxToolToggles: [],
      linkedServerIds: [],
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("AgentPresetEditorPanel", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the active memory summary, opens the memory popover, and persists the selected config", async () => {
    const onSave = vi.fn();
    const preset = makePreset();

    render(
      <AgentPresetEditorPanel
        preset={preset}
        saving={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText("Both tiers · All categories")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Manage Memory" })[0]);

    const longTermButton = await screen.findByRole("button", { name: "Long Term" });
    fireEvent.click(longTermButton);

    expect(screen.getByText("Long term · All categories")).toBeInTheDocument();

    const saveButton = screen.getByRole("button", { name: "Save Agent" });
    expect(saveButton).toBeEnabled();

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      "preset_1",
      expect.objectContaining({
        memoryConfig: expect.objectContaining({
          tier: "long_term",
          categories: [],
          minStrength: 0,
          minStrengthPerCategory: {},
          maxShortTerm: 0,
          maxLongTerm: 0,
        }) as AgentMemoryConfig,
      })
    );
  });

  it("marks the editor dirty when knowledge subscriptions change", async () => {
    const onSave = vi.fn();

    render(
      <AgentPresetEditorPanel
        preset={makePreset()}
        saving={false}
        onSave={onSave}
        onCancel={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: /Code UX Docs/ });
    const saveButton = screen.getByRole("button", { name: "Save Agent" });
    expect(saveButton).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Code UX Docs/ }));

    await waitFor(() => {
      expect(knowledgeApi.setAgentKnowledgeSubscriptions).toHaveBeenCalledWith("preset_1", ["doc_codeux"]);
      expect(saveButton).toBeEnabled();
    });

    fireEvent.click(saveButton);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith("preset_1", expect.objectContaining({ name: "Planning Agent" }));
  });

  it("filters knowledge documents and bulk selects the visible matches", async () => {
    render(
      <AgentPresetEditorPanel
        preset={makePreset()}
        saving={false}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await screen.findByRole("button", { name: /Code UX Docs/ });

    fireEvent.input(screen.getByPlaceholderText("Search knowledge"), {
      target: { value: "deploy" },
    });

    expect(screen.queryByRole("button", { name: /Code UX Docs/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deploy Runbook/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Select all" }));

    await waitFor(() => {
      expect(knowledgeApi.setAgentKnowledgeSubscriptions).toHaveBeenCalledWith("preset_1", ["doc_runbook"]);
    });
  });
});
