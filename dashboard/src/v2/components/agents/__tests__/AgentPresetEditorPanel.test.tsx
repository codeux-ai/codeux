/** @vitest-environment jsdom */
/// <reference types="@testing-library/jest-dom" />
import { h } from "preact";
import { describe, expect, afterEach, vi, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AgentPresetEditorPanel } from "../AgentPresetEditorPanel.js";
import { DEFAULT_AGENT_MEMORY_CONFIG, type AgentMemoryConfig } from "../../../memory-types.js";
import type { AgentPreset } from "../../../types.js";

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

    fireEvent.click(screen.getByRole("button", { name: "Manage Memory" }));

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
});
