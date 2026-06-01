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

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

// Mock OnboardingIntro to fire callbacks immediately via microtask,
// avoiding dependency on GSAP timers in JSDOM (which caused CI timeouts).
vi.mock("../../../dashboard/src/v2/components/onboarding/OnboardingIntro.js", () => ({
  OnboardingIntro: ({ onExitStart, onComplete }: { onExitStart?: () => void; onComplete?: () => void }) => {
    queueMicrotask(() => onExitStart?.());
    queueMicrotask(() => onComplete?.());
    return null;
  },
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

  it("initializes autoApprovePlan as true by default in settings", async () => {
    const defaultSettings = cloneDefaultSettings();
    const systemSettings = {
      runtime: {
        dashboardPort: defaultSettings.dashboardPort,
        enableDebugLogFile: defaultSettings.enableDebugLogFile,
        consoleLogLevel: defaultSettings.consoleLogLevel,
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

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
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
      if (url.endsWith("/api/system-settings")) {
        return new Response(JSON.stringify(systemSettings), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 404 });
    });

    render(<OnboardingExperience />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/system-settings", undefined));
    expect(systemSettings.defaults.automationInterventions.autoApprovePlan).toBe(true);
  });
});

