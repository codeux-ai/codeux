/**
 * @vitest-environment jsdom
 */
import { fireEvent, render as testingLibraryRender, screen, waitFor } from "@testing-library/preact";
import { cleanup } from "@testing-library/preact";
import type { ComponentChildren } from "preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { useOnboardingState } from "../../../dashboard/src/v2/hooks/useOnboardingState.js";
import { OnboardingExperience } from "../../../dashboard/src/v2/components/onboarding/OnboardingExperience.js";
import { GuidedDashboardTour } from "../../../dashboard/src/v2/components/onboarding/GuidedDashboardTour.js";
import { DASHBOARD_TOUR_START_EVENT } from "../../../dashboard/src/v2/lib/onboarding-control.js";
import { APPEARANCE_PREVIEW_EVENT } from "../../../dashboard/src/v2/lib/appearance-preview.js";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { clearLivePayloadCacheForTests } from "../../../dashboard/src/lib/api/dashboard-api.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";
import type {
  OnboardingDependencyCheck,
  OnboardingDependencyInstallMode,
  OnboardingDependencyInstallerResult,
  OnboardingRuntimeReadiness,
  SystemSettings,
} from "../../../dashboard/src/types.js";
import {
  createInitialOnboardingFlowState,
  defaultOnboardingReadiness,
  easyOnboardingSteps,
  onboardingFlowReducer,
} from "../../../dashboard/src/v2/components/onboarding/use-onboarding-step-flow.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

const render = (children: ComponentChildren) => testingLibraryRender(
  <DashboardI18nProvider initialLocale="en" storage={null}>{children}</DashboardI18nProvider>,
);

const { navigateMock } = vi.hoisted(() => ({
  navigateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigateMock,
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

const deepOceanBackgroundMock = vi.hoisted(() => vi.fn());

vi.mock("../../../dashboard/src/v2/components/chat/DeepOceanBackground.js", () => ({
  DeepOceanBackground: (props: { forceDark?: boolean; className?: string }) => {
    deepOceanBackgroundMock(props);
    return null;
  },
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
}));

afterEach(() => {
  navigateMock.mockClear();
});

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
        autoTransitionLinkedIssuesOnImport: true,
        importTransitionName: "In Work",
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

const createDependencyCheck = (
  id: string,
  label: string,
  status: OnboardingDependencyCheck["status"],
): OnboardingDependencyCheck => ({
  id,
  label,
  status,
  required: true,
  description: `${label} check`,
  resolution: `Install ${label} and recheck readiness.`,
  detail: `${label} is ${status}.`,
});

const createInstallerReadiness = (
  recommendedMode: OnboardingDependencyInstallMode = "docker-engine-git",
): OnboardingRuntimeReadiness => ({
  checkedAt: "2026-07-07T00:00:00.000Z",
  cluster: {
    status: "not_ready",
    label: "Cluster not ready",
    detail: "Docker is required before local container execution.",
  },
  dependencies: [
    createDependencyCheck("docker-cli", "Docker CLI", "missing"),
    createDependencyCheck("docker-daemon", "Docker daemon", "missing"),
  ],
  providers: [],
  installers: {
    platform: "linux",
    recommendedMode,
    options: [
      {
        mode: "docker-desktop-git",
        label: "Docker Desktop",
        platform: "linux",
        recommended: recommendedMode === "docker-desktop-git",
        automation: "partial",
        description: "Provides official Docker Desktop download guidance.",
        dependencyIds: ["docker-cli", "docker-daemon"],
        requiresPrivilege: true,
        requiresManualDownload: true,
        available: true,
        guidance: ["Download Docker Desktop manually for this Linux distribution, then start the desktop app."],
      },
      {
        mode: "docker-engine-git",
        label: "Docker Engine",
        platform: "linux",
        recommended: recommendedMode === "docker-engine-git",
        automation: "automated",
        description: "Installs Docker Engine packages through the detected Linux package manager.",
        dependencyIds: ["docker-cli", "docker-daemon"],
        requiresPrivilege: true,
        requiresManualDownload: false,
        available: true,
        guidance: ["The Docker service may need to be started after installation."],
      },
    ],
  },
});

const createInstallerResult = (): OnboardingDependencyInstallerResult => ({
  mode: "docker-engine-git",
  platform: "linux",
  status: "partial",
  commands: [
    {
      id: "apt-install-docker",
      groupId: "docker-engine",
      label: "Install Docker Engine",
      command: "sudo",
      args: ["-n", "apt-get", "install", "-y", "docker.io"],
      displayCommand: "sudo -n apt-get install -y docker.io",
      status: "skipped",
      timeoutMs: 120000,
      maxStdoutChars: 4000,
      maxStderrChars: 4000,
      code: null,
      stdoutSummary: "",
      stderrSummary: "",
      message: "Passwordless sudo is required to run package-manager commands noninteractively.",
    },
  ],
  skippedDependencyGroups: [],
  requiresPrivilege: true,
  requiresManualDownload: true,
  postInstallGuidance: [
    "Restart the terminal after installation so PATH changes are visible.",
    "Start Docker manually, then rerun readiness checks.",
  ],
  message: "Installer completed with follow-up guidance.",
});

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

const createTourTarget = (targetId: string): HTMLElement => {
  const target = document.createElement("button");
  target.setAttribute("data-tour-id", targetId);
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
  return target;
};

describe("onboarding flow reducer", () => {
  it("keeps the introduction in the short Easy path", () => {
    expect(easyOnboardingSteps.map((step) => step.id)).toEqual([
      "mode",
      "installation",
      "introduction",
      "provider-setup",
      "git",
    ]);
  });

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
    expect(state.activeStep).toBe(9);
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

    createTourTarget("project-selector");

    render(<GuidedDashboardTour />);
    window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));

    expect(await screen.findByRole("dialog", { name: /Projects/i })).not.toBeNull();
    expect(screen.getByText("Step 1 of 1")).not.toBeNull();

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(launcher));
  });

  it("walks Schedule, Knowledge, and Docs in navigation order", async () => {
    [
      "project-selector",
      "docker-containers",
      "active-sessions",
      "nav-chat",
      "nav-overview",
      "nav-sprints",
      "nav-tasks",
      "nav-agents",
      "nav-nodes",
      "nav-stats",
      "nav-schedule",
      "nav-memory",
      "nav-knowledge",
      "nav-browser",
      "nav-files",
      "nav-live",
      "nav-docs",
      "nav-config",
    ].forEach(createTourTarget);

    render(<GuidedDashboardTour />);
    window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));

    const expectedTitles = [
      "Projects",
      "Docker Containers",
      "Active Sessions",
      "Chat",
      "Overview",
      "Sprints",
      "Tasks",
      "Agents",
      "Nodes",
      "Stats",
      "Schedule",
      "Memory",
      "Knowledge",
      "Browser Preview",
      "Files",
      "Live",
      "Docs",
      "Settings",
    ];

    for (const [index, title] of expectedTitles.entries()) {
      expect(await screen.findByRole("dialog", { name: title })).not.toBeNull();
      expect(screen.getByText(`Step ${index + 1} of ${expectedTitles.length}`)).not.toBeNull();
      if (index < expectedTitles.length - 1) {
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`Next tour step: ${expectedTitles[index + 1]}`) }));
      }
    }
  });

  it("skips missing navigation targets without breaking the remaining order", async () => {
    [
      "project-selector",
      "nav-schedule",
      "nav-memory",
      "nav-docs",
      "nav-config",
    ].forEach(createTourTarget);

    render(<GuidedDashboardTour />);
    window.dispatchEvent(new CustomEvent(DASHBOARD_TOUR_START_EVENT));

    const expectedTitles = ["Projects", "Schedule", "Memory", "Docs", "Settings"];

    for (const [index, title] of expectedTitles.entries()) {
      expect(await screen.findByRole("dialog", { name: title })).not.toBeNull();
      expect(screen.getByText(`Step ${index + 1} of ${expectedTitles.length}`)).not.toBeNull();
      if (index < expectedTitles.length - 1) {
        await userEvent.click(screen.getByRole("button", { name: new RegExp(`Next tour step: ${expectedTitles[index + 1]}`) }));
      }
    }

    expect(screen.queryByRole("dialog", { name: "Knowledge" })).toBeNull();
  });
});

describe("OnboardingExperience integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearLivePayloadCacheForTests();
    cleanup();
  });

  it("shows step navigation labels without compact sidebar status cards", async () => {
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
      if (url.endsWith("/api/runtime-assets/status")) {
        return new Response(JSON.stringify({
          managedRuntime: { state: "ready", stepText: "Managed runtime is ready." },
          providers: [
            { provider: "codex", state: "ready", installedVersion: "1.0.0", targetVersion: "1.0.0", progressPercent: 100, stepText: "codex 1.0.0 is ready.", error: null, retryable: true, updatedAt: new Date().toISOString() },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url.includes("/api/provider-tools/") && url.endsWith("/prepare")) {
        const provider = url.split("/api/provider-tools/")[1].split("/")[0];
        return new Response(JSON.stringify({ provider, state: "queued", stepText: `Preparing ${provider}.` }), { status: 202, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    const activeStepBtn = await screen.findByRole("button", { name: /Setup mode/i, current: "step" });
    expect(activeStepBtn).not.toBeNull();
    expect(screen.getByRole("button", { name: "Go to Providers" })).not.toBeNull();
    expect(screen.queryByText(/Configure containers, provider auth, automation, and the workspace shell/i)).toBeNull();
    expect(screen.queryByText("Blocked")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Go to Installation" }));

    expect(await screen.findByRole("button", { name: /Installation/i, current: "step" })).not.toBeNull();
  });

  it("runs the recommended dependency installer and refreshes readiness after completion", async () => {
    const systemSettings = createSystemSettings();
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    const installResult = createInstallerResult();
    let resolveInstall: (response: Response) => void = () => {};
    const installResponse = new Promise<Response>((resolve) => {
      resolveInstall = resolve;
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify(createInstallerReadiness()), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith("/api/onboarding/dependencies/install")) {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          mode: "docker-engine-git",
          confirmInstall: true,
        });
        return installResponse;
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });
    const user = userEvent.setup();

    render(<OnboardingExperience />);

    await user.click(await screen.findByRole("button", { name: "Go to Installation" }));
    const autoInstallButton = await screen.findByRole("button", { name: "Auto Install dependencies" });
    await user.click(autoInstallButton);

    expect(await screen.findByText("Installing Docker Engine")).not.toBeNull();
    resolveInstall(new Response(JSON.stringify(installResult), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    expect(await screen.findByRole("heading", { name: "Latest install result" })).not.toBeNull();
    expect(screen.getByText("Installer completed with follow-up guidance.")).not.toBeNull();
    expect(screen.getByText(/Administrator privileges or passwordless sudo are required/i)).not.toBeNull();
    expect(screen.getByText(/Manual Docker download is still required/i)).not.toBeNull();
    expect(screen.getByText(/Restart the terminal after installation/i)).not.toBeNull();
    expect(screen.getByText(/Start Docker manually/i)).not.toBeNull();

    await waitFor(() => {
      const readinessCalls = fetchMock.mock.calls.filter(([input]) => {
        const url = typeof input === "string" ? input : input.url;
        return url.endsWith("/api/onboarding/readiness");
      });
      expect(readinessCalls).toHaveLength(2);
    });
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
    await userEvent.click(await screen.findByRole("button", { name: "Go to Git" }));

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

  it("runs the short Easy onboarding flow, saves the selected mode, and lands on Chat", async () => {
    const systemSettings = createSystemSettings();
    systemSettings.integrations.providers.codex = {
      ...systemSettings.integrations.providers.codex!,
      authType: "localAuth",
      mountAuth: true,
      authPath: "~/.codex",
    };
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(systemSettings);
    vi.mocked(settingsApi.saveSystemSettings).mockImplementation(async (nextSettings) => nextSettings);
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
          providers: [
            { provider: "codex", available: true, mountEnabled: false, authPath: "~/.codex", detectedFiles: ["auth.json"] },
          ],
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await userEvent.click(await screen.findByRole("radio", { name: /Easy/i }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Runtime environment is ready.")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Welcome to Code UX.")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Choose one provider login")).not.toBeNull();
    for (const providerName of ["Antigravity", "Codex", "Claude Code", "Qwen Code", "OpenCode"]) {
      expect(screen.getByText(providerName)).not.toBeNull();
    }
    expect(screen.queryByText("Gemini")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Connect and log in to/i })).toHaveLength(5);
    const authModeSelects = screen.getAllByRole("button", { name: /authentication mode/i });
    expect(authModeSelects).toHaveLength(5);
    for (const authModeSelect of authModeSelects) {
      expect(authModeSelect.textContent).toContain("Dashboard Login");
    }
    expect(screen.queryByText("Add instance")).toBeNull();
    expect(screen.queryByText("API key")).toBeNull();
    expect(screen.queryByText(/~\/\.code-ux\/credentials/)).toBeNull();
    expect(screen.queryByText("Connect this provider through Code UX and save the login under the dashboard credentials directory.")).toBeNull();
    expect(screen.queryByText("Local auth path")).toBeNull();
    expect(screen.queryByText("Deprecated")).toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: "Select Claude Code" }));
    expect(screen.getByRole("radio", { name: "Selected Claude Code" }).getAttribute("aria-checked")).toBe("true");
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/provider-tools/"), expect.objectContaining({ method: "POST" }));
    await userEvent.click(screen.getByRole("radio", { name: "Select Codex" }));

    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    const githubCheckboxes = screen.getAllByRole("checkbox");
    expect(githubCheckboxes).toHaveLength(2);
    expect((screen.getByRole("checkbox", { name: /Use GitHub for this workspace/i }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: /Let Code UX create and manage GitHub PR workflow defaults/i }) as HTMLInputElement).checked).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Finish" }));

    await waitFor(() => expect(settingsApi.saveSystemSettings).toHaveBeenCalled());
    const saveCalls = vi.mocked(settingsApi.saveSystemSettings).mock.calls;
    const savedSettings = saveCalls[saveCalls.length - 1]![0] as SystemSettings;
    expect(savedSettings.defaults.appearance.experienceMode).toBe("EASY");
    expect(savedSettings.defaults.cliWorkflow.executionMode).toBe("DOCKER");
    expect(savedSettings.defaults.aiProvider.provider).toBe("codex");
    expect(savedSettings.defaults.cliWorkflow.gitMode).toBe("local");
    expect(savedSettings.defaults.git.githubMode).toBe("LOCAL");
    expect(savedSettings.defaults.git.autoCreatePr).toBe(false);
    expect(savedSettings.integrations.providers.codex?.authType).toBe("dashboardAuth");
    expect(savedSettings.integrations.providers.codex?.authPath).toBe("~/.code-ux/credentials/codex");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/user/onboarding/complete", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: "/chat" }));
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
    await userEvent.click(await screen.findByRole("button", { name: "Go to Introduction" }));

    await screen.findByText("Welcome to Code UX.");
    const elements = screen.queryAllByText(/knowledge base/i);
    if (elements.length < 3) {
      console.log('Found knowledge base elements:', elements.map(e => e.textContent));
    }
    expect(elements.length).toBeGreaterThanOrEqual(3);
  });
});

describe("onboarding appearance step", () => {
  beforeEach(() => {
    deepOceanBackgroundMock.mockClear();
    document.documentElement.className = "";
    document.documentElement.style.background = "";
    document.body.style.background = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
    delete (globalThis.window as any).codeUxDesktop;
    document.documentElement.className = "";
    document.documentElement.style.background = "";
    document.body.style.background = "";
  });

  it("renders onboarding appearance controls and omits settings-only background controls", async () => {
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
          autoTransitionLinkedIssuesOnImport: true,
          importTransitionName: "In Work",
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

    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(mockSystemSettings as SystemSettings);

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
    expect(screen.queryByText("Zoom Level")).not.toBeNull();
    expect(screen.queryByText("Background Mode")).not.toBeNull();

    await userEvent.click(screen.getByRole("radio", { name: /^Static\b/i }));
    expect(await screen.findByText("Static Color")).not.toBeNull();

    // Verify removed controls/options are ABSENT
    expect(screen.queryByText("Animation Style")).toBeNull();
    expect(screen.queryByText("Aurora Borealis")).toBeNull();
    expect(screen.queryByText("Pattern Overlay")).toBeNull();
    expect(screen.queryByText("Hexagons")).toBeNull();
    expect(screen.queryByText("Custom Background Image")).toBeNull();
    expect(screen.queryByText("Upload Image")).toBeNull();
  });

  it("previews Light theme immediately without leaking dark-mode onboarding background state", async () => {
    const mockSystemSettings = createSystemSettings();
    mockSystemSettings.defaults.appearance = {
      ...mockSystemSettings.defaults.appearance,
      theme: "DARK",
      backgroundMode: "ANIMATED",
      staticBackgroundColor: "#0d0f12",
    };
    const previews: Array<SystemSettings["defaults"]["appearance"] | null> = [];
    const listener = (event: Event) => {
      previews.push((event as CustomEvent<{ appearance: SystemSettings["defaults"]["appearance"] | null }>).detail.appearance);
    };
    window.addEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(mockSystemSettings);

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/user/onboarding")) {
        return new Response(JSON.stringify({ completed: false, onboardingCompletedAt: null }), { status: 200 });
      }
      if (url.endsWith("/api/user/onboarding/cancel")) {
        return new Response(JSON.stringify({ completed: true, onboardingCompletedAt: "2026-06-01T00:00:00.000Z" }), { status: 200 });
      }
      if (url.endsWith("/api/onboarding/readiness")) {
        return new Response(JSON.stringify({
          checkedAt: "2026-06-01T00:00:00.000Z",
          cluster: { status: "ready" },
          dependencies: [],
          providers: [],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Appearance" });
    await waitFor(() => {
      expect(previews.some((appearance) => appearance?.theme === "DARK")).toBe(true);
    });
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(true);
    });

    await userEvent.click(screen.getByRole("button", { name: "Go to Appearance" }));
    await userEvent.click(await screen.findByRole("radio", { name: /^Light\b/i }));
    await waitFor(() => {
      expect(previews.some((appearance) => appearance?.theme === "LIGHT")).toBe(true);
    });
    await waitFor(() => {
      expect(document.documentElement.classList.contains("dark")).toBe(false);
      expect(deepOceanBackgroundMock.mock.calls.some(([props]) => props.forceDark === false)).toBe(true);
    });

    await userEvent.click(screen.getByRole("button", { name: "Close onboarding" }));
    await waitFor(() => {
      expect(previews[previews.length - 1]).toBeNull();
    });
    window.removeEventListener(APPEARANCE_PREVIEW_EVENT, listener);
  });

  it("publishes static background previews from unsaved onboarding changes", async () => {
    const mockSystemSettings = createSystemSettings();
    mockSystemSettings.defaults.appearance = {
      ...mockSystemSettings.defaults.appearance,
      theme: "LIGHT",
      backgroundMode: "ANIMATED",
      staticBackgroundColor: "#0d0f12",
    };
    const previewDetails: Array<{ appearance: SystemSettings["defaults"]["appearance"] | null }> = [];
    const listener = (event: Event) => {
      previewDetails.push((event as CustomEvent<{ appearance: SystemSettings["defaults"]["appearance"] | null }>).detail);
    };
    window.addEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue(mockSystemSettings);

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
          providers: [],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await screen.findByRole("button", { name: "Go to Appearance" });
    await userEvent.click(screen.getByRole("button", { name: "Go to Appearance" }));
    await userEvent.click(await screen.findByRole("radio", { name: /^Static\b/i }));

    await waitFor(() => {
      expect(previewDetails.some(({ appearance }) => (
        appearance?.backgroundMode === "STATIC"
          && appearance.staticBackgroundColor === "#0d0f12"
      ))).toBe(true);
    });

    const staticColorInput = document.querySelector<HTMLInputElement>('input[type="color"]');
    expect(staticColorInput).not.toBeNull();
    fireEvent.input(staticColorInput!, { target: { value: "#123456" } });

    await waitFor(() => {
      expect(previewDetails.some(({ appearance }) => (
        appearance?.backgroundMode === "STATIC"
          && appearance.staticBackgroundColor === "#123456"
      ))).toBe(true);
    });

    window.removeEventListener(APPEARANCE_PREVIEW_EVENT, listener);
  });

  it("emits a null appearance preview when onboarding unmounts before settings finish loading", async () => {
    const mockSystemSettings = createSystemSettings();
    mockSystemSettings.defaults.appearance = {
      ...mockSystemSettings.defaults.appearance,
      theme: "LIGHT",
    };
    let resolveSettings: (settings: SystemSettings) => void = () => {};
    const delayedSettings = new Promise<SystemSettings>((resolve) => {
      resolveSettings = resolve;
    });
    const previews: Array<SystemSettings["defaults"]["appearance"] | null> = [];
    const listener = (event: Event) => {
      previews.push((event as CustomEvent<{ appearance: SystemSettings["defaults"]["appearance"] | null }>).detail.appearance);
    };
    window.addEventListener(APPEARANCE_PREVIEW_EVENT, listener);
    vi.mocked(settingsApi.fetchSystemSettings).mockReturnValue(delayedSettings);

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
          providers: [],
        }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    const { unmount } = render(<OnboardingExperience />);

    await waitFor(() => expect(settingsApi.fetchSystemSettings).toHaveBeenCalled());
    unmount();
    resolveSettings(mockSystemSettings);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(previews.length).toBeGreaterThan(0);
    expect(previews[previews.length - 1]).toBeNull();
    expect(previews.every((appearance) => appearance === null)).toBe(true);
    window.removeEventListener(APPEARANCE_PREVIEW_EVENT, listener);
  });
});
