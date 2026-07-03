/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Bot, Code2, GitBranch, Zap } from "lucide-preact";
import { ReliabilityStudio } from "../components/ReliabilityStudio.js";
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
    models: [
      {
        id: "model-qwen",
        provider: "provider-qwen",
        model: "qwen2.5-coder",
        label: "Qwen 2.5 Coder",
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
        statusCounts: { completed: 6, failed: 0, cancelled: 0, running: 0, paused: 0 },
        successRate: 1,
        duration: { sampleCount: 6, avgMs: 40_000, p50Ms: 38_000, p95Ms: 60_000, maxMs: 65_000 },
        lastActivityAt: null,
      },
      {
        id: "model-open",
        provider: "provider-open",
        model: "default",
        label: "OpenCode Default",
        usage: {
          totalTokens: 600,
          invocationCount: 4,
          activeTimeMs: 180000,
          wallTimeMs: 210000,
          inputTokens: 280,
          cachedInputTokens: 50,
          outputTokens: 220,
          reasoningOutputTokens: 50,
          reportedInvocationCount: 0,
          estimatedInvocationCount: 0,
          unavailableInvocationCount: 0,
          unsupportedInvocationCount: 0,
        },
        statusCounts: { completed: 3, failed: 1, cancelled: 0, running: 0, paused: 0 },
        successRate: 0.75,
        duration: { sampleCount: 4, avgMs: 45_000, p50Ms: 42_000, p95Ms: 70_000, maxMs: 72_000 },
        lastActivityAt: null,
      },
      {
        id: "model-anti",
        provider: "provider-anti",
        model: "experimental",
        label: "Antigravity Experimental",
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
        statusCounts: { completed: 1, failed: 1, cancelled: 0, running: 0, paused: 0 },
        successRate: 0.5,
        duration: { sampleCount: 2, avgMs: 60_000, p50Ms: 60_000, p95Ms: 80_000, maxMs: 82_000 },
        lastActivityAt: null,
      },
    ],
    statusCounts: {
      completed: 9,
      failed: 2,
      cancelled: 1,
      running: 0,
      paused: 0,
    },
    duration: {
      sampleCount: 12,
      avgMs: 45_000,
      p50Ms: 40_000,
      p95Ms: 80_000,
      maxMs: 95_000,
    },
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
    const providerShare = screen.getAllByText("Provider Share").at(-1);
    const confidenceBoard = screen.getByText("Confidence Board");
    const auditNotes = screen.getByText("Audit Notes");
    const providerBreakdown = screen.getByText("Provider Breakdown");

    expect(providerShare).toBeDefined();
    expect(telemetrySourceMix.compareDocumentPosition(providerShare!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(providerShare!.compareDocumentPosition(confidenceBoard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(confidenceBoard.compareDocumentPosition(auditNotes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(auditNotes.compareDocumentPosition(providerBreakdown) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText("Per-provider token anatomy, invocation volume, compute time, and telemetry reliability for the selected window.")).toBeInTheDocument();

    expect(screen.getByTitle("Qwen Code")).toBeInTheDocument();
    expect(screen.getByTitle("OpenCode")).toBeInTheDocument();
    expect(screen.getByTitle("Antigravity")).toBeInTheDocument();
    expect(screen.getAllByText("150/call").length).toBeGreaterThan(0);
    expect(screen.getByText("6 completed")).toBeInTheDocument();
    expect(screen.getAllByText("Reported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estimated").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Input: 50.0%").length).toBeGreaterThan(0);
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

    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
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
