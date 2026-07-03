/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { Bot, Code2, GitBranch, Zap } from "lucide-preact";
import { ReliabilityStudio } from "../components/ReliabilityStudio.js";
import { getProviderIcon } from "../components/stats-ui-primitives.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

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

const usage = {
  totalTokens: 1800,
  invocationCount: 12,
  activeTimeMs: 540000,
  wallTimeMs: 600000,
  inputTokens: 900,
  cachedInputTokens: 150,
  outputTokens: 600,
  reasoningOutputTokens: 150,
  inputCostUsd: 0,
  outputCostUsd: 0,
  cachedInputCostUsd: 0,
  totalCostUsd: 0,
  reportedInvocationCount: 8,
  estimatedInvocationCount: 3,
  unavailableInvocationCount: 1,
  unsupportedInvocationCount: 0,
};

const baseStats = {
  usage,
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
      status: null,
      purpose: null,
      lastActivityAt: null,
      usage: {
        ...usage,
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
      status: null,
      purpose: null,
      lastActivityAt: null,
      usage: {
        ...usage,
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
    },
    {
      id: "provider-anti",
      provider: "antigravity",
      label: "Antigravity",
      secondaryLabel: "experimental",
      status: null,
      purpose: null,
      lastActivityAt: null,
      usage: {
        ...usage,
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
        ...usage,
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
        ...usage,
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
        ...usage,
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

const providerSegments = [
  { label: "Qwen Code", value: 900, color: "rgba(0,224,160,0.9)", textClassName: "text-signal-600" },
  { label: "OpenCode", value: 600, color: "rgba(255,184,0,0.88)", textClassName: "text-amber-600" },
  { label: "Antigravity", value: 300, color: "rgba(0,170,255,0.9)", textClassName: "text-cyan-600" },
];

const sourceSegments = [
  { label: "reported", value: 8, color: "rgba(0,224,160,0.9)", textClassName: "text-signal-600" },
  { label: "estimated", value: 3, color: "rgba(255,184,0,0.9)", textClassName: "text-amber-600" },
  { label: "unavailable", value: 1, color: "rgba(248,113,113,0.88)", textClassName: "text-rose-600" },
];

describe("ReliabilityStudio", () => {
  it("renders the reliability summary, source mix, provider board, and audit sections", () => {
    render(
      <ReliabilityStudio
        stats={baseStats as any}
        providerSegments={providerSegments}
        sourceSegments={sourceSegments}
      />,
    );

    const summary = screen.getByText("Provider confidence & failure risk");
    const telemetrySourceMix = screen.getByText("Telemetry Source Mix");
    const sourceCountBoard = screen.getByText("Source Count Board");
    const providerConfidenceBoard = screen.getByText("Provider Confidence Board");
    const audit = screen.getByText("Fallback & Error Audit");

    expect(summary.compareDocumentPosition(telemetrySourceMix) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(telemetrySourceMix.compareDocumentPosition(sourceCountBoard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sourceCountBoard.compareDocumentPosition(providerConfidenceBoard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(providerConfidenceBoard.compareDocumentPosition(audit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText("Telemetry Confidence")).toBeInTheDocument();
    expect(screen.getByText("Fallback Usage")).toBeInTheDocument();
    expect(screen.getByText("Failure Pressure")).toBeInTheDocument();
    expect(screen.getAllByText("Reported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Estimated").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unsupported").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("sorts provider cards by failure/source risk before token volume", () => {
    render(
      <ReliabilityStudio
        stats={baseStats as any}
        providerSegments={providerSegments}
        sourceSegments={sourceSegments}
      />,
    );

    const antigravity = screen.getAllByTitle("Antigravity").at(-1)!;
    const openCode = screen.getAllByTitle("OpenCode").at(-1)!;
    const qwen = screen.getAllByTitle("Qwen Code").at(-1)!;

    expect(antigravity.compareDocumentPosition(openCode) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(openCode.compareDocumentPosition(qwen) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("high risk").length).toBeGreaterThan(0);
    expect(screen.getAllByText("150/call").length).toBeGreaterThan(0);
    expect(screen.getAllByTitle("Input: 50.0%").length).toBeGreaterThan(0);
  });

  it("renders reported, estimated, unavailable, unsupported, and unknown source counts distinctly", () => {
    render(
      <ReliabilityStudio
        stats={
          {
            ...baseStats,
            usage: {
              ...baseStats.usage,
              invocationCount: 10,
              reportedInvocationCount: 1,
              estimatedInvocationCount: 6,
              unavailableInvocationCount: 1,
              unsupportedInvocationCount: 1,
            },
            tokenSources: [
              { source: "reported", count: 1 },
              { source: "estimated", count: 6 },
              { source: "unavailable", count: 1 },
              { source: "unsupported", count: 1 },
            ],
          } as any
        }
        providerSegments={providerSegments}
        sourceSegments={sourceSegments}
      />,
    );

    const board = screen.getByText("Source Count Board").closest(".stats-surface-panel") ?? document.body;
    expect(within(board as HTMLElement).getByText("Reported")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Estimated")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Unavailable")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Unsupported")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("Unknown")).toBeInTheDocument();
    expect(within(board as HTMLElement).getByText("6")).toBeInTheDocument();
    expect(within(board as HTMLElement).getAllByText("1").length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText("7 invocations relied on estimated or unknown source counters. Estimates remain usable, but precision is lower than provider-reported counts.")).toBeInTheDocument();
  });

  it("shows empty states when provider or source segments are missing", () => {
    render(
      <ReliabilityStudio
        stats={
          {
            ...baseStats,
            usage: {
              ...baseStats.usage,
              invocationCount: 0,
              reportedInvocationCount: 0,
              estimatedInvocationCount: 0,
              unavailableInvocationCount: 0,
              unsupportedInvocationCount: 0,
            },
            providers: [],
            models: [],
            tokenSources: [],
          } as any
        }
        providerSegments={[]}
        sourceSegments={[]}
      />,
    );

    expect(screen.getByText("No telemetry source segments for this window.")).toBeInTheDocument();
    expect(screen.getByText("No provider segments for this window.")).toBeInTheDocument();
    expect(screen.getByText("No provider telemetry for this window.")).toBeInTheDocument();
  });

  it("uses calm warning and critical tones for success-rate states", () => {
    render(
      <ReliabilityStudio
        stats={
          {
            ...baseStats,
            statusCounts: {
              ...baseStats.statusCounts,
              completed: 10,
              failed: 2,
              cancelled: 0,
            },
          } as any
        }
        providerSegments={providerSegments}
        sourceSegments={sourceSegments}
      />,
    );

    const fiftyPercent = screen.getByText("50%");
    const eightyThreePercent = screen.getByText(/83%/);

    expect(fiftyPercent.className).toContain("text-rose");
    expect(eightyThreePercent.className).toContain("text-amber");
  });

  it("uses dedicated icons for the newer provider names", () => {
    expect(getProviderIcon("qwen-code").icon).toBe(Code2);
    expect(getProviderIcon("opencode").icon).toBe(GitBranch);
    expect(getProviderIcon("antigravity").icon).toBe(Zap);
    expect(getProviderIcon("unknown-provider").icon).toBe(Bot);
  });
});
