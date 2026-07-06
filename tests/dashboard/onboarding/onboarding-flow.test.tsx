/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/preact";
import { cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useOnboardingState } from "../../../dashboard/src/v2/hooks/useOnboardingState.js";
import { OnboardingExperience } from "../../../dashboard/src/v2/components/onboarding/OnboardingExperience.js";
import { GuidedDashboardTour } from "../../../dashboard/src/v2/components/onboarding/GuidedDashboardTour.js";
import { DASHBOARD_TOUR_START_EVENT } from "../../../dashboard/src/v2/lib/onboarding-control.js";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import type { SystemSettings } from "../../../dashboard/src/types.js";
import {
  createInitialOnboardingFlowState,
  defaultOnboardingReadiness,
  onboardingFlowReducer,
} from "../../../dashboard/src/v2/components/onboarding/use-onboarding-step-flow.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Mock OnboardingIntro to fire callbacks immediately via microtask,
// avoiding dependency on GSAP timers in JSDOM (which caused CI timeouts).
vi.mock("gsap", () => ({ default: { set: vi.fn(), to: vi.fn(), fromTo: vi.fn(), killTweensOf: vi.fn(), timeline: vi.fn(() => ({ to: vi.fn() })), context: (cb: any) => { cb(); return { revert: vi.fn() }; } } }));
vi.mock("../../../dashboard/src/v2/components/onboarding/OnboardingIntro.js", () => ({
  OnboardingIntro: ({ onExitStart, onComplete }: { onExitStart?: () => void; onComplete?: () => void }) => {
    queueMicrotask(() => onExitStart?.());
    queueMicrotask(() => onComplete?.());
    return null;
  },
}));

vi.mock("../../../dashboard/src/v2/components/chat/DeepOceanBackground.js", () => ({
  DeepOceanBackground: () => null,
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
}));

const createSystemSettings = (): SystemSettings => {
  const defaultSettings = cloneDefaultSettings();
  return {
    runtime: {
      dashboardPort: defaultSettings.dashboardPort,
      consoleLogLevel: defaultSettings.consoleLogLevel,
      debugLogFileLevel: defaultSettings.debugLogFileLevel,
      consoleLogMode: defaultSettings.consoleLogMode,
      dbAutoVacuumOnStartup: true,
      dbPruningEnabled: true,
      dbRetentionDays: 30,
    },
    integrations: {
      providers: {
        jules: { provider: "jules", name: "Jules Primary", apiKey: "", mountAuth: false, authPath: "" },
        codex: { provider: "codex", name: "Codex Primary", apiKey: "", mountAuth: false, authPath: "" },
      },
      githubToken: "",
      gitlabToken: "",
      jira: {
        host: "",
        email: "",
        apiToken: "",
        autoCloseLinkedIssues: false,
        defaultProject: "",
        closeTransitionName: "Done",
      },
    },
    defaults: {
      ...defaultSettings,
      aiProvider: {
        ...defaultSettings.aiProvider,
        providers: {
          jules: { provider: "jules", name: "Jules Primary", enabled: true, model: "", weight: 1, thinkingMode: "default", maxConcurrentTasks: 1 },
          codex: { provider: "codex", name: "Codex Primary", enabled: false, model: "", weight: 1, thinkingMode: "default", maxConcurrentTasks: 1 },
        },
      },
    },
    mcpTools: [],
    customMcpServers: [],
    modelPricing: { items: [] },
  } as SystemSettings;
};

const HookProbe = () => {
  const { state, loading, markCompleted } = useOnboardingState();

  if (loading) {
    return <div>loading</div>;
  }

  return (
    <div>
      <div data-testid="completed">{String(state.completed)}</div>
      <button type="button" onClick={() => void markCompleted("complete")}>complete</button>
      <button type="button" onClick={() => void markCompleted("cancel")}>cancel</button>
    </div>
  );
};

describe("onboarding flow reducer", () => {
  it("tracks provider selection and step navigation", () => {
    let state = createInitialOnboardingFlowState();

    state = onboardingFlowReducer(state, { type: "select-provider", provider: "codex" });
    state = onboardingFlowReducer(state, { type: "select-provider", provider: "codex" });
    expect(state.selectedProviders).toEqual(["codex"]);

    state = onboardingFlowReducer(state, { type: "toggle-provider", provider: "codex" });
    expect(state.selectedProviders).toEqual([]);

    state = onboardingFlowReducer(state, { type: "set-active-step", step: 2 });
    state = onboardingFlowReducer(state, { type: "go-next" });
    state = onboardingFlowReducer(state, { type: "go-previous" });
    expect(state.activeStep).toBe(2);

    state = onboardingFlowReducer(state, { type: "set-active-step", step: 99 });
    expect(state.activeStep).toBe(8);
  });

  it("updates the settings draft without mutating the loaded settings object", () => {
    const settings = createSystemSettings();
    let state = onboardingFlowReducer(createInitialOnboardingFlowState(), {
      type: "load-success",
      readiness: defaultOnboardingReadiness,
      settings,
    });

    state = onboardingFlowReducer(state, {
      type: "update-settings",
      recipe: (current) => ({
        ...current,
        integrations: {
          ...current.integrations,
          githubToken: "draft-token",
        },
      }),
    });

    expect(state.settings?.integrations.githubToken).toBe("draft-token");
    expect(settings.integrations.githubToken).toBe("");
    expect(state.settings).not.toBe(settings);
  });
});

describe("onboarding state hook", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("suppresses onboarding when persisted completion exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      completed: true,
      onboardingCompletedAt: "2026-05-31T00:00:00.000Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    render(<HookProbe />);
    await waitFor(() => expect(screen.getByTestId("completed").textContent).toBe("true"));
  });

  it("marks completion for both finish and cancel actions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/user/onboarding/complete") || url.endsWith("/api/user/onboarding/cancel")) {
        return new Response(JSON.stringify({ completed: true, onboardingCompletedAt: "2026-05-31T00:00:00.000Z" }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<HookProbe />);
    await waitFor(() => expect(screen.getByTestId("completed").textContent).toBe("false"));

    await userEvent.click(screen.getByRole("button", { name: "complete" }));
    await waitFor(() => expect(screen.getByTestId("completed").textContent).toBe("true"));

    await userEvent.click(screen.getByRole("button", { name: "cancel" }));
    await waitFor(() => expect(screen.getByTestId("completed").textContent).toBe("true"));

    expect(fetchMock).toHaveBeenCalledWith("/api/user/onboarding/complete", expect.objectContaining({ method: "POST" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/user/onboarding/cancel", expect.objectContaining({ method: "POST" }));
  });
});

describe("GuidedDashboardTour integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    document.body.innerHTML = "";
  });

  it("handles tour start with unavailable targets gracefully", async () => {
    const { queryByRole } = render(<GuidedDashboardTour />);
    window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(queryByRole("dialog")).toBeNull();
  });

  it("restores focus after Escape closes the tour", async () => {
    const launcher = document.createElement("button");
    launcher.textContent = "Start tour";
    document.body.appendChild(launcher);
    launcher.focus();

    const target = document.createElement("button");
    target.setAttribute("data-tour-id", "project-selector");
    target.getBoundingClientRect = () => ({
      top: 80,
      left: 80,
      width: 120,
      height: 44,
      right: 200,
      bottom: 124,
      x: 80,
      y: 80,
      toJSON: () => ({}),
    });
    document.body.appendChild(target);

    render(<GuidedDashboardTour />);
    window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));

    expect(await screen.findByRole("dialog", { name: /Projects/i })).not.toBeNull();
    expect(screen.getByText("Step 1 of 1")).not.toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });
});

describe("OnboardingExperience integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("shows step navigation labels and readiness pending/error states accessibly", async () => {
    const defaultSettings = cloneDefaultSettings();
    const systemSettings = {
      runtime: { dashboardPort: defaultSettings.dashboardPort, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: { julesApiKey: "", geminiApiKey: "", codexApiKey: "", claudeCodeApiKey: "", githubToken: "" },
      defaults: defaultSettings,
    };
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings as any);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "blocked", label: "Unhealthy", detail: "Docker is not running." },
          dependencies: [], providers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    const activeStepBtn = await screen.findByRole("button", { name: /Installation/i, current: "step" });
    expect(activeStepBtn).not.toBeNull();

    const readinessRegion = await screen.findAllByText("Blocked");
    expect(readinessRegion.length).toBeGreaterThan(0);
    expect(readinessRegion[0]!.getAttribute("aria-live")).toBe("polite");
  });

  it("toggles Git onboarding between remote and local modes", async () => {
    const defaultSettings = cloneDefaultSettings();
    const systemSettings = {
      runtime: {
        dashboardPort: defaultSettings.dashboardPort,
        consoleLogLevel: defaultSettings.consoleLogLevel,
        debugLogFileLevel: defaultSettings.debugLogFileLevel,
        consoleLogMode: defaultSettings.consoleLogMode,
      },
      integrations: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
        gitlabToken: "",
      },
      defaults: defaultSettings,
    };
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings as any);
    vi.mocked(settingsApi.saveSystemSettings).mockResolvedValue(systemSettings as any);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(
          JSON.stringify({
            checkedAt: "2026-06-01T00:00:00.000Z",
            cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
            dependencies: [],
            providers: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await waitFor(() => expect(settingsApi.fetchSystemSettings).toHaveBeenCalled());
    const nextButton = await screen.findByRole("button", { name: "Next" });
    await userEvent.click(nextButton);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByText("Git mode");
    expect(screen.getByText("GitHub token")).not.toBeNull();
    expect(screen.getByText("GitLab token")).not.toBeNull();
    expect(screen.queryByText("Local mode does not support automatic CI or pull requests. Remote mode is recommended for full feature access.")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /^Local\b/i }));

    expect(screen.queryByText("GitHub token")).toBeNull();
    expect(screen.queryByText("GitLab token")).toBeNull();
    expect(screen.getByText("Git identity")).not.toBeNull();
    expect(screen.getByText("Local mode does not support automatic CI or pull requests. Remote mode is recommended for full feature access.")).not.toBeNull();
  });

  it("initializes autoApprovePlan as true by default in settings", async () => {
    const defaultSettings = cloneDefaultSettings();
    const systemSettings = {
      runtime: {
        dashboardPort: defaultSettings.dashboardPort,
        consoleLogLevel: defaultSettings.consoleLogLevel,
        debugLogFileLevel: defaultSettings.debugLogFileLevel,
        consoleLogMode: defaultSettings.consoleLogMode,
      },
      integrations: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
      },
      defaults: defaultSettings,
    };
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings as any);
    vi.mocked(settingsApi.saveSystemSettings).mockResolvedValue(systemSettings as any);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(
          JSON.stringify({
            checkedAt: "2026-06-01T00:00:00.000Z",
            cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
            dependencies: [],
            providers: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await waitFor(() => expect(settingsApi.fetchSystemSettings).toHaveBeenCalled());
    expect(systemSettings.defaults.automationInterventions.autoApprovePlan).toBe(true);
  });

  it("saves settings and completes onboarding from the final step", async () => {
    const systemSettings = createSystemSettings();
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    vi.mocked(settingsApi.saveSystemSettings).mockResolvedValue(systemSettings);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/user/onboarding/complete")) {
        return new Response(JSON.stringify({ completed: true, onboardingCompletedAt: "2026-06-01T00:00:00.000Z" }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
          dependencies: [],
          providers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Appearance" });
    await userEvent.click(screen.getByRole("button", { name: "Go to Appearance" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(settingsApi.saveSystemSettings).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/user/onboarding/complete", expect.objectContaining({ method: "POST" })));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a save failure and leaves onboarding open", async () => {
    const systemSettings = createSystemSettings();
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    vi.mocked(settingsApi.saveSystemSettings).mockRejectedValue(new Error("Save failed"));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
          dependencies: [],
          providers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Appearance" });
    await userEvent.click(screen.getByRole("button", { name: "Go to Appearance" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByText("Save failed")).not.toBeNull();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("focuses the first invalid Jira field when Jira fields are partially configured", async () => {
    const systemSettings = createSystemSettings();
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    vi.mocked(settingsApi.saveSystemSettings).mockResolvedValue(systemSettings);
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
          dependencies: [],
          providers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Providers" });
    await userEvent.click(screen.getByRole("button", { name: "Go to Providers" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.type(screen.getByLabelText("Jira site URL"), "https://example.atlassian.net");
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Enter a Jira API token");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Jira API token")));
  });

  it("announces pending save state on the final onboarding action", async () => {
    const systemSettings = createSystemSettings();
    let resolveSave: (value: SystemSettings) => void = () => {};
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    vi.mocked(settingsApi.saveSystemSettings).mockReturnValue(new Promise((resolve) => {
      resolveSave = resolve;
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/user/onboarding/complete")) {
        return new Response(JSON.stringify({ completed: true, onboardingCompletedAt: "2026-06-01T00:00:00.000Z" }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
          dependencies: [],
          providers: [],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Appearance" });
    await userEvent.click(screen.getByRole("button", { name: "Go to Appearance" }));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(await screen.findByRole("button", { name: "Saving" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Saving onboarding settings")).not.toBeNull();
    resolveSave(systemSettings);
  });

  it("mentions Knowledge Base in the introduction step", async () => {
    const defaultSettings = cloneDefaultSettings();
    const systemSettings = {
      runtime: {
        dashboardPort: defaultSettings.dashboardPort,
        consoleLogLevel: defaultSettings.consoleLogLevel,
        debugLogFileLevel: defaultSettings.debugLogFileLevel,
        consoleLogMode: defaultSettings.consoleLogMode,
      },
      integrations: {
        julesApiKey: "",
        geminiApiKey: "",
        codexApiKey: "",
        claudeCodeApiKey: "",
        githubToken: "",
      },
      defaults: defaultSettings,
    };
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings as any);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(
          JSON.stringify({
            checkedAt: "2026-06-01T00:00:00.000Z",
            cluster: { status: "ready", label: "Healthy", detail: "Runtime environment is ready." },
            dependencies: [],
            providers: [],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await waitFor(() => expect(settingsApi.fetchSystemSettings).toHaveBeenCalled());
    // Introduction is step 2 (idx 1), navigate to it
    const nextButton = await screen.findByRole("button", { name: "Next" });
    await userEvent.click(nextButton);

    await screen.findByText("Welcome to Code UX.");
    const elements = screen.queryAllByText(/knowledge base/i);
    if (elements.length < 3) {
      console.log('Found knowledge base elements:', elements.map(e => e.textContent));
    }
    expect(elements.length).toBeGreaterThanOrEqual(3);
  });
});

describe("onboarding appearance step", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    delete (globalThis.window as any).codeUxDesktop;
  });

  it("renders remaining appearance controls and omits removed background controls", async () => {
    globalThis.window.codeUxDesktop = {
      setZoom: vi.fn(),
    } as any;

    const mockSystemSettings = {
      runtime: { dashboardPort: 4444, consoleLogLevel: "info", debugLogFileLevel: "error", consoleLogMode: "standard" },
      integrations: {
        providers: {},
        githubToken: "",
        jira: {
          host: "",
          email: "",
          apiToken: "",
          autoCloseLinkedIssues: false,
          defaultProject: "",
          closeTransitionName: "Done"
        }
      },
      defaults: {
        ...DEFAULT_DASHBOARD_SETTINGS,
        appearance: {
          theme: "DARK",
          navigationMode: "SIDEBAR",
          reducedMotion: "NONE",
          zoomLevel: 1,
          backgroundMode: "ANIMATED",
          animatedBackground: "deep-ocean",
          backgroundPattern: "NONE",
          backgroundImage: null,
          staticBackgroundColor: "#0d0f12"
        }
      },
      mcpTools: [],
    };

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready" },
          dependencies: [],
          providers: []
        }), { status: 200 });
      }
      if (url.endsWith("/api/system-settings")) {
        return new Response(JSON.stringify(mockSystemSettings), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    // Wait for onboarding to load and render the first step, then navigate to Appearance step
    await screen.findByRole("button", { name: "Go to Appearance" });

    const appearanceDotButton = screen.getByRole("button", { name: "Go to Appearance" });
    await userEvent.click(appearanceDotButton);

    // Verify remaining appearance controls are rendered
    await screen.findByText("Theme");
    expect(screen.queryByText("Navigation Mode")).not.toBeNull();
    expect(screen.queryByText("Reduced Motion")).not.toBeNull();
    // Zoom level omitted due to codeUxDesktop missing
    // Background Mode omitted

    // Verify removed controls/options are ABSENT
    expect(screen.queryByText("Animation Style")).toBeNull();
    expect(screen.queryByText("Aurora Borealis")).toBeNull();
    expect(screen.queryByText("Pattern Overlay")).toBeNull();
    expect(screen.queryByText("Hexagons")).toBeNull();
    expect(screen.queryByText("Custom Background Image")).toBeNull();
    expect(screen.queryByText("Upload Image")).toBeNull();
  });
});
