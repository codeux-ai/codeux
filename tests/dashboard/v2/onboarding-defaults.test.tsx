/** @vitest-environment happy-dom */
/** @jsx h */
/** @jsxFrag Fragment */
import { h, Fragment } from "preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { OnboardingExperience } from "../../../dashboard/src/v2/components/onboarding/OnboardingExperience.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import * as settingsApi from "../../../dashboard/src/v2/lib/settings-api.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    context: (callback: () => void) => {
      callback();
      return { revert: vi.fn() };
    },
    fromTo: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../dashboard/src/v2/components/onboarding/OnboardingIntro.js", () => ({
  OnboardingIntro: ({ onComplete }: { onComplete: () => void }) => {
    onComplete();
    return null;
  },
}));

vi.mock("../../../dashboard/src/v2/components/chat/DeepOceanBackground.js", () => ({
  DeepOceanBackground: () => null,
}));

vi.mock("../../../dashboard/src/v2/hooks/useOnboardingState.js", () => ({
  useOnboardingState: () => ({
    state: { completed: false, onboardingCompletedAt: null },
    loading: false,
    markCompleted: vi.fn(async () => ({ completed: true, onboardingCompletedAt: null })),
    reset: vi.fn(async () => ({ completed: false, onboardingCompletedAt: null })),
  }),
}));

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
  fetchOnboardingReadiness: vi.fn(async () => ({
    checkedAt: new Date().toISOString(),
    cluster: { status: "ready", label: "Ready", detail: "Runtime is ready." },
    dependencies: [],
    providers: [],
  })),
}));

vi.mock("../../../dashboard/src/v2/lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
}));

const getToggleInRow = (rowLabel: string): HTMLButtonElement => {
  const label = screen.getByText(rowLabel);
  let scope: HTMLElement | null = label.parentElement;
  while (scope && !scope.querySelector("button[aria-pressed]")) {
    scope = scope.parentElement;
  }
  if (!scope) throw new Error(`Missing row for ${rowLabel}`);
  const toggle = scope.querySelector("button[aria-pressed]") as HTMLButtonElement | null;
  if (!toggle) throw new Error(`Missing toggle for ${rowLabel}`);
  return toggle;
};

const getChoiceButton = (choiceTitle: string, optionLabel: string): HTMLButtonElement => {
  const title = screen.getByText(choiceTitle);
  let scope: HTMLElement | null = title.parentElement;
  while (scope && scope.querySelectorAll("button").length === 0) {
    scope = scope.parentElement;
  }
  if (!scope) throw new Error(`Missing choice group for ${choiceTitle}`);
  return within(scope).getByRole("button", { name: new RegExp(`^${optionLabel}$`, "i") });
};

describe("Onboarding automation defaults", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const settings = JSON.parse(JSON.stringify(DEFAULT_DASHBOARD_SETTINGS));
    vi.mocked(settingsApi.fetchSystemSettings).mockResolvedValue({
      runtime: { dashboardPort: 4444, enableDebugLogFile: false, consoleLogLevel: "standard" },
      integrations: {
        providers: {
          jules: { provider: "jules", name: "Jules Primary", apiKey: "" },
          gemini: { provider: "gemini", name: "Gemini Primary", apiKey: "" },
          codex: { provider: "codex", name: "Codex Primary", apiKey: "" },
          "claude-code": { provider: "claude-code", name: "Claude Primary", apiKey: "" },
        },
        githubToken: "",
      },
      defaults: settings,
      mcpTools: [],
      customMcpServers: [],
    } as any);
    vi.mocked(settingsApi.saveSystemSettings).mockResolvedValue({} as any);
  });

  it("shows requested defaults and allows editing", async () => {
    render(<OnboardingExperience />);

    const automationNav = await screen.findByRole("button", { name: "Automation" });
    fireEvent.click(automationNav);

    await waitFor(() => {
      expect(screen.getByText("Feature PR automerge")).toBeInTheDocument();
    });

    expect(getChoiceButton("Feature PR automerge", "Always").className).toContain("border-signal-500/30");
    expect(getChoiceButton("Main PR automerge", "Create PR").className).toContain("border-signal-500/30");
    expect(getToggleInRow("Resolve main merge conflicts")).toHaveAttribute("aria-pressed", "true");
    expect(getToggleInRow("Resolve feature merge conflicts")).toHaveAttribute("aria-pressed", "true");
    expect(getToggleInRow("Memory system")).toHaveAttribute("aria-pressed", "true");
    expect(getToggleInRow("Enable QA agent")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(getChoiceButton("Feature PR automerge", "Off"));
    fireEvent.click(getChoiceButton("Main PR automerge", "Always"));
    fireEvent.click(getToggleInRow("Resolve main merge conflicts"));
    fireEvent.click(getToggleInRow("Resolve feature merge conflicts"));
    fireEvent.click(getToggleInRow("Memory system"));
    fireEvent.click(getToggleInRow("Enable QA agent"));

    expect(getChoiceButton("Feature PR automerge", "Off").className).toContain("border-signal-500/30");
    expect(getChoiceButton("Main PR automerge", "Always").className).toContain("border-signal-500/30");
    expect(getToggleInRow("Resolve main merge conflicts")).toHaveAttribute("aria-pressed", "false");
    expect(getToggleInRow("Resolve feature merge conflicts")).toHaveAttribute("aria-pressed", "false");
    expect(getToggleInRow("Memory system")).toHaveAttribute("aria-pressed", "false");
    expect(getToggleInRow("Enable QA agent")).toHaveAttribute("aria-pressed", "false");
  });
});
