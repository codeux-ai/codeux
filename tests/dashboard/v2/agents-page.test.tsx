/** @vitest-environment jsdom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import { act } from "preact/test-utils";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// Mock GSAP to avoid tricky animation timings in tests
vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    set: vi.fn(),
    context: (fn: () => void) => {
      fn();
      return { revert: vi.fn() };
    },
  },
}));

import * as agentPresetApi from "../../../dashboard/src/v2/lib/agent-preset-api.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import { ProjectDataProvider } from "../../../dashboard/src/v2/context/project-data.js";
import { AgentsPage } from "../../../dashboard/src/v2/AgentsPage.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

vi.mock("../../../dashboard/src/v2/lib/agent-preset-api.js");
vi.mock("../../../dashboard/src/v2/lib/settings-api.js");

// Let's not mock the child components so we can test the full integration
// Just mock wavefluid and scene to avoid complex WebGL/Canvas rendering
vi.mock("../../../dashboard/src/v2/components/ui/WaveFluid.js", () => ({
  WaveFluid: () => <div data-testid="wave-fluid" />
}));
vi.mock("../../../dashboard/src/v2/components/ui/BorderTrace.js", () => ({
  BorderTrace: () => <div data-testid="border-trace" />
}));

let mockProjectData = {
  projects: [
    { id: "project-1", name: "Test Project", status: "ready" },
  ],
  selectedProject: { id: "project-1", name: "Test Project", status: "ready" },
  loading: false,
  error: null,
  selectProject: vi.fn(),
  refresh: vi.fn(),
  fetchCollection: vi.fn(),
};

vi.mock("../../../dashboard/src/v2/context/project-data.js", async () => {
  const { h, Fragment } = await import("preact");
  const actual = await vi.importActual<any>("../../../dashboard/src/v2/context/project-data.js");
  return {
    ...actual,
    ProjectDataProvider: ({ children }: any) => h(Fragment, null, children),


  useProjectData: vi.fn(() => mockProjectData),
  };
});

vi.mock("../../../dashboard/src/v2/components/agents/AgentsHero.js", async () => {
  const { h } = await import("preact");
  return {
    AgentsHero: (props: any) => h("div", { "data-testid": "agents-hero" },
      h("button", { onClick: props.onCreate }, "New Agent")
    )
  };
});

vi.mock("../../../dashboard/src/v2/components/agents/AgentPresetShowcaseCard.js", async () => {
  const { h } = await import("preact");
  return {
    AgentPresetShowcaseCard: (props: any) => h("button", {
      "data-testid": "showcase-card",
      onClick: props.onClick
    }, props.preset.name)
  };
});

vi.mock("../../../dashboard/src/v2/components/agents/AgentPresetDetailPanel.js", async () => {
  const { h } = await import("preact");
  return {
    AgentPresetDetailPanel: (props: any) => h("div", { "data-testid": "detail-panel" },
      h("h2", null, props.preset.name),
      h("div", null, props.preset.instructionMarkdown),
      h("button", { onClick: props.onEdit }, "Edit Agent")
    )
  };
});

vi.mock("../../../dashboard/src/v2/components/agents/AgentPresetEditorPanel.js", async () => {
  const { h, Component } = await import("preact");
  class MockEditor extends Component<any, any> {
    constructor(props: any) {
      super(props);
      this.state = { override: !!props.preset.memoryTemplateOverrideEnabled };
    }
    render() {
      const { props, state } = this;
      return h("div", { "data-testid": "editor-panel" },
        h("h2", null, "Edit Agent"),
        h("input", { defaultValue: props.preset.name, "aria-label": "Name" }),
        h("input", {
          type: "checkbox",
          "aria-label": "Enable Memory Template Override",
          checked: state.override,
          onChange: (e: any) => this.setState({ override: e.target.checked })
        }),
        state.override && h("textarea", { placeholder: "Override the default memory prompt template for this agent." }),
        h("button", { onClick: () => props.onSave(props.preset.id, {}) }, "Save Agent"),
        h("button", { onClick: props.onCancel }, "Cancel")
      );
    }
  }
  return {
    AgentPresetEditorPanel: (props: any) => h(MockEditor, props)
  };
});

vi.mock("../../../dashboard/src/v2/components/agents/AgentAvatarScene.js", () => ({
  AgentAvatarScene: () => <div data-testid="avatar-scene" />
}));

// Mock ResizeObserver before rendering
if (typeof global !== 'undefined') {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(), // Deprecated
      removeListener: vi.fn(), // Deprecated
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

Object.defineProperty(global, 'matchMedia', {
  writable: true,
  value: window.matchMedia,
});

// Mock SVG element getTotalLength for sparklines or standard SVG animations if they exist
if (typeof window !== 'undefined') {
  window.SVGElement.prototype.getTotalLength = () => 100;
}

const createEffectiveSettings = () => ({
  settings: JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS)),
  sources: {},
});

describe("AgentsPage", () => {
  let mockPresets: any[];

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();

    if (!window.matchMedia) {
      window.matchMedia = vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // Deprecated
        removeListener: vi.fn(), // Deprecated
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    }

    mockPresets = [
      {
        id: "agent-1",
        projectId: "project-1",
        name: "Planning Agent",
        labels: ["planning"],
        instructionMarkdown: "Do some planning",
        syncStatus: "synced",
        sourcePath: ".sprint-os/agents/planning.md",
        sourceScope: "project",
        sourceExists: true,
        avatarConfig: { body: "male" },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      },
      {
        id: "agent-2",
        projectId: "project-1",
        name: "Review Agent",
        labels: ["review"],
        instructionMarkdown: "Review code",
        syncStatus: "synced",
        sourcePath: null,
        sourceScope: null,
        sourceExists: false,
        avatarConfig: { body: "female" },
        createdAt: "2023-01-01T00:00:00.000Z",
        updatedAt: "2023-01-01T00:00:00.000Z",
      },
    ];

    // Reset ResizeObserver mock per test
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    vi.mocked(agentPresetApi.fetchAgentPresets).mockResolvedValue(mockPresets as any);
    vi.mocked(settingsApi.fetchProjectEffectiveSettings).mockResolvedValue(createEffectiveSettings() as any);

    mockProjectData.projects = [{ id: "project-1", name: "Test Project", status: "ready" }];
    mockProjectData.selectedProject = { id: "project-1", name: "Test Project", status: "ready" };

    // Ensure matchMedia is available for AgentAvatarScene hooks
    if (!window.matchMedia) {
      Object.defineProperty(window, 'matchMedia', {
        writable: true,
        value: vi.fn().mockImplementation(query => ({
          matches: false,
          media: query,
          onchange: null,
          addListener: vi.fn(), // Deprecated
          removeListener: vi.fn(), // Deprecated
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      });
    }
  });

  const renderPage = async () => {
    const res = render(
      <ProjectDataProvider>
        <AgentsPage />
      </ProjectDataProvider>
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    await waitFor(() => {
      expect(agentPresetApi.fetchAgentPresets).toHaveBeenCalled();
    });
    return res;
  };

  it("loads and displays agents in master-detail showcase layout", async () => {
    await renderPage();
    screen.debug();

    await waitFor(() => {
      expect(screen.getAllByText("Planning Agent")[0]).toBeInTheDocument();
    });

    expect(screen.getByText("Review Agent")).toBeInTheDocument();

    // Both cards in the list should be visible
    const cards = screen.getAllByRole("button", { name: /Planning Agent|Review Agent/i });
    expect(cards).toHaveLength(2);

    // Detail panel for "Planning Agent" (the first one) should be visible
    expect(screen.getByText("Do some planning")).toBeInTheDocument();

    // Switch to "Review Agent"
    fireEvent.click(cards[1]);
    await waitFor(() => {
      expect(screen.getByText("Review code")).toBeInTheDocument();
    });
  });

  it("creates a new agent with a random avatar and enters edit mode", async () => {
    vi.mocked(agentPresetApi.createAgentPreset).mockResolvedValue({
      id: "agent-new",
      projectId: "project-1",
      name: "Agent 3",
      labels: [],
      instructionMarkdown: "",
      syncStatus: "manual",
      sourcePath: null,
      sourceScope: null,
      sourceExists: false,
      avatarConfig: { body: "female", face: "style1" }, // Mock random avatar
      createdAt: "2023-01-01T00:00:00.000Z",
      updatedAt: "2023-01-01T00:00:00.000Z",
    } as any);

    await renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("Planning Agent")[0]).toBeInTheDocument();
    });

    const newAgentBtn = screen.getByText("New Agent");
    fireEvent.click(newAgentBtn);

    await waitFor(() => {
      expect(agentPresetApi.createAgentPreset).toHaveBeenCalledWith("project-1", expect.objectContaining({
        name: "Agent 3",
        avatarConfig: expect.any(Object),
      }));
    });

    // Should enter edit mode
    await waitFor(() => {
      expect(screen.getByText("Edit Agent")).toBeInTheDocument();
    });

    // Check if name input is focused/editable
    const nameInput = screen.getByDisplayValue("Agent 3");
    expect(nameInput).toBeInTheDocument();
  });

  it("toggles edit mode via Edit button", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("Planning Agent")[0]).toBeInTheDocument();
    });

    const editBtn = screen.getByText("Edit Agent");
    fireEvent.click(editBtn);

    // Now in edit mode
    await waitFor(() => {
      expect(screen.getByText("Save Agent")).toBeInTheDocument();
    });

    // Cancel edit
    const cancelBtn = screen.getByText("Cancel");
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText("Save Agent")).not.toBeInTheDocument();
      expect(screen.getByText("Edit Agent")).toBeInTheDocument();
    });
  });

  it("conditionally shows memory override textarea", async () => {
    await renderPage();
    await waitFor(() => {
      expect(screen.getAllByText("Planning Agent")[0]).toBeInTheDocument();
    });

    // Enter edit mode
    const editBtn = screen.getByText("Edit Agent");
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText("Save Agent")).toBeInTheDocument();
    });

    const overrideCheckbox = screen.getByRole("checkbox", { name: /Enable Memory Template Override/i });
    expect(overrideCheckbox).not.toBeChecked();

    // Textarea should not be visible
    expect(screen.queryByPlaceholderText("Override the default memory prompt template for this agent.")).not.toBeInTheDocument();

    // Enable override
    fireEvent.click(overrideCheckbox);

    await waitFor(() => {
      expect(overrideCheckbox).toBeChecked();
    });

    // Textarea should now be visible
    const textarea = screen.getByPlaceholderText("Override the default memory prompt template for this agent.");
    expect(textarea).toBeInTheDocument();
  });
});
