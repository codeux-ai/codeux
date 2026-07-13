/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor } from "@testing-library/preact";
import { fireEvent } from "@testing-library/preact";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ProjectSettingsEditor } from "../../dashboard/src/v2/components/settings/ProjectSettingsEditor.jsx";
import { SettingsModelsPanel } from "../../dashboard/src/v2/components/settings/panels/SettingsModelsPanel.js";
import { TextInput } from "../../dashboard/src/v2/components/settings/SettingsFormFields.js";
import { fetchLocalFiles } from "../../dashboard/src/v2/lib/project-api.js";
import { cloneProjectSettings } from "../../dashboard/src/v2/lib/settings/project-overrides.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../src/repositories/settings-defaults.js";
import * as matchers from '@testing-library/jest-dom/matchers';
import type { SettingsPageState } from "../../dashboard/src/v2/hooks/use-settings-page-state.js";
import type { ProjectSettings, SystemSettings } from "../../dashboard/src/types.js";
expect.extend(matchers);

vi.mock("../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchLocalFiles: vi.fn(),
}));

describe("ProjectSettingsEditor", () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    cleanup();
    window.matchMedia = originalMatchMedia;
    vi.mocked(fetchLocalFiles).mockReset();
  });

  it("renders Max Parsing Retries input and passes updates correctly", async () => {
    const mockOnChange = vi.fn();
    const mockSettings = {
      cliWorkflow: {
        ...cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS).cliWorkflow,
        maxParsingRetries: 3
      },
      workers: {
        executionMode: "CONTAINERS",
        virtualWorkerProvider: "jules"
      },
      agents: {
        qualityAssurance: {
          enabled: false
        }
      },
      aiProvider: {
        providers: {
          jules: { provider: "jules" }
        }
      },
      git: {},
      memory: {},
      automationInterventions: {},
      ciIntelligence: {},
      sprintLoopSteps: {},
      sprintPreview: {
        enabled: false
      },
      skills: [],
      mcpTools: []
    };

    render(
      <ProjectSettingsEditor
        settings={mockSettings as any}
        onChange={mockOnChange}
      />
    );

    const inputs = screen.getAllByRole("spinbutton");
    const input = inputs.find(i => (i as HTMLInputElement).value === "3");

    expect(input).toBeInTheDocument();

    fireEvent.input(input!, { target: { value: "5" } });

    expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
        cliWorkflow: expect.objectContaining({ maxParsingRetries: 5 })
    }));
  });

  it("keeps helper text wired until validation is revealed by explicit submit", async () => {
    const { rerender } = render(
      <TextInput
        value=""
        onChange={vi.fn()}
        aria-label="Provider display name"
        helperText="Used in provider route summaries."
        errorText="Display name is required."
      />
    );

    const input = screen.getByLabelText("Provider display name");
    expect(input).toHaveAccessibleDescription("Used in provider route summaries.");
    expect(input).not.toHaveAttribute("aria-errormessage");
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(
      <TextInput
        value=""
        onChange={vi.fn()}
        aria-label="Provider display name"
        helperText="Used in provider route summaries."
        errorText="Display name is required."
        forceValidation
      />
    );

    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription("Display name is required.");
    expect(input).toHaveAttribute("aria-errormessage", expect.stringContaining("error"));
    expect(screen.getByRole("alert")).toHaveTextContent("Display name is required.");
  });

  it("resolves validation feedback duration to zero when reduced motion is preferred", () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as any;

    render(
      <TextInput
        value="1234567890"
        onChange={vi.fn()}
        maxLength={10}
        aria-label="Reduced motion counter"
      />
    );

    const counter = screen.getByText("10 / 10");
    expect(counter).toHaveStyle({ animationDuration: "0ms" });
  });

  it("uses the local file picker for setup script path updates", async () => {
    const settings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS);
    settings.cliWorkflow.containerSetupScriptPath = ".code-ux/container/setup.sh";
    const mockOnChange = vi.fn();
    vi.mocked(fetchLocalFiles).mockResolvedValueOnce({
      currentPath: "/workspace/test-project",
      parentPath: "/workspace",
      rootPath: "/",
      homePath: "/home/user",
      directories: [],
      files: [{ name: "setup.sh", path: "/workspace/test-project/setup.sh" }],
    });

    render(
      <ProjectSettingsEditor
        settings={settings}
        onChange={mockOnChange}
      />
    );

    fireEvent.input(screen.getByLabelText("Setup script path"), {
      target: { value: "scripts/container/setup.sh" },
    });
    expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
      cliWorkflow: expect.objectContaining({ containerSetupScriptPath: "scripts/container/setup.sh" }),
    }));

    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(await screen.findByText("/workspace/test-project")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "setup.sh" }));

    expect(mockOnChange).toHaveBeenCalledWith(expect.objectContaining({
      cliWorkflow: expect.objectContaining({ containerSetupScriptPath: "/workspace/test-project/setup.sh" }),
    }));
  });

  it("renders provider-specific thinking selections in the AI models panel", async () => {
    const settings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS) as ProjectSettings;
    settings.aiProvider.provider = "codex";
    settings.workers.virtualWorkerProvider = "codex";
    settings.aiProvider.providers.codex.enabled = true;
    settings.aiProvider.providers.codex.thinkingMode = "HIGH";
    const systemSettings = {
      runtime: {} as SystemSettings["runtime"],
      integrations: { providers: {}, githubToken: "" } as SystemSettings["integrations"],
      defaults: settings,
      mcpTools: [],
      customMcpServers: [],
      modelPricing: { overrides: {} },
    } as SystemSettings;
    const state = {
      activeScope: "system",
      editableSettings: settings,
      projectSources: {},
      systemSettings,
      externalHints: {
        env: {},
        settingsJson: {},
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          qwenCodeApiKey: "",
          openCodeApiKey: "",
          antigravityApiKey: "",
          githubToken: "",
        },
        providerAvailability: {},
      },
      activeInvocationRoute: "task_coding",
      setActiveInvocationRoute: vi.fn(),
      invocationRouteDefinitions: [
        { id: "task_coding", label: "Task coding", description: "Task coding route." },
      ],
      routingProfileOptions: [
        { value: "GLOBAL", label: "Global defaults" },
        { value: "WORKER", label: "Worker defaults" },
      ],
      updateEditableSettings: vi.fn(),
      updateSystem: vi.fn(),
    } as unknown as SettingsPageState;

    render(<SettingsModelsPanel state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Expand Codex Primary settings" }));
    const codexThinking = screen.getByRole("button", { name: "Codex Primary base thinking" });
    expect(codexThinking).toHaveTextContent("High");

    fireEvent.click(codexThinking);

    expect(await screen.findByRole("option", { name: "Extra High" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Max" })).not.toBeInTheDocument();
  });

  it("can clear stale route thinking overrides back to inherited provider thinking", async () => {
    const settings = cloneProjectSettings(DEFAULT_DASHBOARD_SETTINGS) as ProjectSettings;
    settings.aiProvider.provider = "codex";
    settings.workers.virtualWorkerProvider = "codex";
    settings.aiProvider.providers.codex.enabled = true;
    settings.aiProvider.providers.codex.thinkingMode = "xhigh";
    settings.aiProvider.invocationRouting.task_coding.provider = "codex";
    settings.aiProvider.invocationRouting.task_coding.providers.codex = {
      enabled: true,
      model: "gpt-5.6-sol",
      thinkingMode: "high",
    };
    const systemSettings = {
      runtime: {} as SystemSettings["runtime"],
      integrations: { providers: {}, githubToken: "" } as SystemSettings["integrations"],
      defaults: settings,
      mcpTools: [],
      customMcpServers: [],
      modelPricing: { overrides: {} },
    } as SystemSettings;
    const updateEditableSettings = vi.fn();
    const state = {
      activeScope: "system",
      editableSettings: settings,
      projectSources: {},
      systemSettings,
      externalHints: {
        env: {},
        settingsJson: {},
        resolved: {
          julesApiKey: "",
          geminiApiKey: "",
          codexApiKey: "",
          claudeCodeApiKey: "",
          qwenCodeApiKey: "",
          openCodeApiKey: "",
          antigravityApiKey: "",
          githubToken: "",
        },
        providerAvailability: {},
      },
      activeInvocationRoute: "task_coding",
      setActiveInvocationRoute: vi.fn(),
      invocationRouteDefinitions: [
        { id: "task_coding", label: "Task coding", description: "Task coding route." },
      ],
      routingProfileOptions: [
        { value: "GLOBAL", label: "Global defaults" },
        { value: "WORKER", label: "Worker defaults" },
      ],
      updateEditableSettings,
      updateSystem: vi.fn(),
    } as unknown as SettingsPageState;

    render(<SettingsModelsPanel state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Expand Codex Primary overrides" }));
    const routeThinking = screen.getByRole("button", { name: "Codex Primary thinking override for Task coding" });
    expect(routeThinking).toHaveTextContent("High");

    fireEvent.click(routeThinking);
    expect(await screen.findByRole("option", { name: "Max" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Ultra" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("option", { name: "Inherit base thinking (Extra High)" }));

    expect(updateEditableSettings).toHaveBeenCalled();
    const recipe = updateEditableSettings.mock.calls.at(-1)?.[0] as (current: ProjectSettings) => ProjectSettings;
    const next = recipe(settings);
    expect(next.aiProvider.invocationRouting.task_coding.providers.codex).toEqual({
      enabled: true,
      model: "gpt-5.6-sol",
    });
  });
});
