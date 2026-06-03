/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Bot, Code2, GitBranch, Zap } from "lucide-preact";
import { ReliabilityStudio } from "../components/StatsShared.js";
import { getProviderIcon } from "../components/stats-ui-primitives.js";

expect.extend(matchers);

vi.mock("gsap", () => ({
  default: {
    killTweensOf: vi.fn(),
    fromTo: vi.fn(),
    to: vi.fn(),
    set: vi.fn(),
    context: vi.fn(() => ({ revert: vi.fn() })),
    registerPlugin: vi.fn(),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      kill: vi.fn(),
    })),
  },
}));

describe("ReliabilityStudio", () => {
  const baseStats = {
    usage: {
      totalTokens: 1800,
      invocationCount: 12,
      activeTimeMs: 540000,
      wallTimeMs: 600000,
      inputTokens: 900,
      cachedInputTokens: 150,
      outputTokens: 600,
      reasoningOutputTokens: 150,
      reportedInvocationCount: 8,
      estimatedInvocationCount: 3,
      unavailableInvocationCount: 1,
      unsupportedInvocationCount: 0,
    },
    tokenSources: [
      { source: "reported", count: 8 },
      { source: "estimated", count: 3 },
      { source: "unsupported", count: 0 },
      { source: "unavailable", count: 1 },
    ],
    providers: [
      {
        id: "provider-qwen",
        provider: "qwen-code",
        label: "Qwen Code",
        secondaryLabel: "qwen2.5-coder",
        usage: {
          totalTokens: 900,
          invocationCount: 6,
          activeTimeMs: 240000,
          wallTimeMs: 270000,
          inputTokens: 450,
          cachedInputTokens: 75,
          outputTokens: 300,
          reasoningOutputTokens: 75,
          reportedInvocationCount: 6,
          estimatedInvocationCount: 0,
          unavailableInvocationCount: 0,
          unsupportedInvocationCount: 0,
        },
      },
      {
        id: "provider-open",
        provider: "opencode",
        label: "OpenCode",
        secondaryLabel: "default",
        usage: {
          totalTokens: 600,
          invocationCount: 4,
          activeTimeMs: 180000,
          wallTimeMs: 210000,
          inputTokens: 280,
          cachedInputTokens: 50,
          outputTokens: 220,
          reasoningOutputTokens: 50,
        },
      },
      {
        id: "provider-anti",
        provider: "antigravity",
        label: "Antigravity",
        secondaryLabel: "experimental",
        usage: {
          totalTokens: 300,
          invocationCount: 2,
          activeTimeMs: 120000,
          wallTimeMs: 150000,
          inputTokens: 170,
          cachedInputTokens: 25,
          outputTokens: 90,
          reasoningOutputTokens: 15,
          reportedInvocationCount: 0,
          estimatedInvocationCount: 2,
          unavailableInvocationCount: 0,
          unsupportedInvocationCount: 0,
        },
      },
    ],
  } as const;

  it("renders the existing reliability panels followed by a provider breakdown grid", () => {
    render(
      <ReliabilityStudio
        stats={baseStats as any}
        providerSegments={[]}
        sourceSegments={[]}
      />,
    );

    const telemetrySourceMix = screen.getByText("Telemetry Source Mix");
    const providerShare = screen.getByText("Provider Share");
    const confidenceBoard = screen.getByText("Confidence Board");
    const auditNotes = screen.getByText("Audit Notes");
    const providerBreakdown = screen.getByText("Provider Breakdown");

    expect(telemetrySourceMix.compareDocumentPosition(providerShare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(providerShare.compareDocumentPosition(confidenceBoard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confidenceBoard.compareDocumentPosition(auditNotes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(auditNotes.compareDocumentPosition(providerBreakdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText("Per-provider token anatomy, invocation volume, compute time, and telemetry reliability for the selected window.")).toBeInTheDocument();

    const getCard = (label: string): HTMLElement => {
      const card = screen.getByText(label).closest('div[class*="rounded-[1.9rem]"]');
      expect(card).not.toBeNull();
      return card as HTMLElement;
    };

    const qwenCard = getCard("Qwen Code");
    expect(qwenCard).not.toBeNull();
    expect(within(qwenCard).getByText("900")).toBeInTheDocument();
    expect(within(qwenCard).getByText("150/call")).toBeInTheDocument();
    expect(within(qwenCard as HTMLElement).getByText("Reported")).toBeInTheDocument();
    expect(within(qwenCard as HTMLElement).getByTitle("Input: 50.0%")).toBeInTheDocument();

    const openCard = getCard("OpenCode");
    expect(within(openCard).getByText("Reported")).toBeInTheDocument();

    const antiCard = getCard("Antigravity");
    expect(within(antiCard).getByText("Estimated")).toBeInTheDocument();
  });

  it("falls back to unknown source quality when no telemetry source signal exists", () => {
    render(
      <ReliabilityStudio
        stats={
          {
            ...baseStats,
            tokenSources: [],
            providers: [
              {
                id: "provider-unknown",
                provider: "mystery-provider",
                label: "Mystery",
                secondaryLabel: null,
                usage: {
                  totalTokens: 120,
                  invocationCount: 1,
                  activeTimeMs: 60000,
                  wallTimeMs: 60000,
                  inputTokens: 60,
                  cachedInputTokens: 0,
                  outputTokens: 40,
                  reasoningOutputTokens: 20,
                  reportedInvocationCount: 0,
                  estimatedInvocationCount: 0,
                  unavailableInvocationCount: 0,
                  unsupportedInvocationCount: 0,
                },
              },
            ],
          } as any
        }
        providerSegments={[]}
        sourceSegments={[]}
      />,
    );

    expect(screen.getByText("Unknown")).toBeInTheDocument();
  });

  it("renders an empty state when no providers are present", () => {
    render(
      <ReliabilityStudio
        stats={
          {
            ...baseStats,
            providers: [],
          } as any
        }
        providerSegments={[]}
        sourceSegments={[]}
      />,
    );

    expect(screen.getByText("No provider telemetry for this window.")).toBeInTheDocument();
  });

  it("uses dedicated icons for the newer provider names", () => {
    expect(getProviderIcon("qwen-code").icon).toBe(Code2);
    expect(getProviderIcon("opencode").icon).toBe(GitBranch);
    expect(getProviderIcon("antigravity").icon).toBe(Zap);
    expect(getProviderIcon("unknown-provider").icon).toBe(Bot);
  });
});
