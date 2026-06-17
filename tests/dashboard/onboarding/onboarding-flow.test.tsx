/**
 * @vitest-environment jsdom
 */
import { render, screen, waitFor } from "@testing-library/preact";
import { cleanup } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useOnboardingState } from "../../../dashboard/src/v2/hooks/useOnboardingState.js";
import { OnboardingExperience } from "../../../dashboard/src/v2/components/onboarding/OnboardingExperience.js";
import { cloneDefaultSettings } from "../../../dashboard/src/lib/settings.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Mock OnboardingIntro to fire callbacks immediately via microtask,
// avoiding dependency on GSAP timers in JSDOM (which caused CI timeouts).
vi.mock("gsap", () => ({ default: { set: vi.fn(), to: vi.fn(), fromTo: vi.fn(), timeline: vi.fn(() => ({ to: vi.fn() })), context: (cb: any) => { cb(); return { revert: vi.fn() }; } } }));
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

describe("OnboardingExperience integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
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

    const nextButton = await screen.findByRole("button", { name: "Next" });
    await userEvent.click(nextButton);
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByText("Git mode");
    expect(screen.getByText("GitHub token")).not.toBeNull();
    expect(screen.getByText("GitLab token")).not.toBeNull();
    expect(screen.queryByText("Local mode does not support automatic CI or pull requests. Remote mode is recommended for full feature access.")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^Local\b/i }));

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

    // Introduction is step 2 (idx 1), navigate to it
    const nextButton = await screen.findByRole("button", { name: "Next" });
    await userEvent.click(nextButton);

    await screen.findByText("Welcome to Code UX.");
    expect(screen.getAllByText(/knowledge base/i).length).toBeGreaterThanOrEqual(3);
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
          navigationMode: "DOCK",
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
    expect(screen.queryByText("Zoom Level")).not.toBeNull();
    expect(screen.queryByText("Background Mode")).not.toBeNull();

    // Verify removed controls/options are ABSENT
    expect(screen.queryByText("Animation Style")).toBeNull();
    expect(screen.queryByText("Aurora Borealis")).toBeNull();
    expect(screen.queryByText("Pattern Overlay")).toBeNull();
    expect(screen.queryByText("Hexagons")).toBeNull();
    expect(screen.queryByText("Custom Background Image")).toBeNull();
    expect(screen.queryByText("Upload Image")).toBeNull();
  });
});
