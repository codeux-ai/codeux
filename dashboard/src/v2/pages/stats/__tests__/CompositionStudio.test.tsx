/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { CompositionStudio } from "../components/CompositionStudio.js";

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

describe("CompositionStudio", () => {
  it("renders the composition flow in the expected order with provider activity sorted by token volume", () => {
    const { container } = render(
      <CompositionStudio
        stats={
          {
            usage: {
              inputTokens: 1000,
              cachedInputTokens: 250,
              inputCostUsd: 0,
              outputCostUsd: 0,
              cachedInputCostUsd: 0,
              totalCostUsd: 12.3456,
              outputTokens: 500,
              reasoningOutputTokens: 125,
              totalTokens: 1875,
              invocationCount: 9,
              activeTimeMs: 540000,
              wallTimeMs: undefined,
              reportedInvocationCount: 6,
              estimatedInvocationCount: 2,
              unavailableInvocationCount: 1,
              unsupportedInvocationCount: 0,
            },
            providers: [
              {
                id: "provider-b",
                provider: "claude-code",
                label: "Claude Code",
                secondaryLabel: "sonnet-4",
                usage: {
                  inputTokens: 400,
                  cachedInputTokens: 100,
                  inputCostUsd: 0,
                  outputCostUsd: 0,
                  cachedInputCostUsd: 0,
                  totalCostUsd: 10.0,
                  outputTokens: 200,
                  reasoningOutputTokens: 50,
                  totalTokens: 750,
                  invocationCount: 3,
                  activeTimeMs: 120000,
                  wallTimeMs: 150000,
                },
              },
              {
                id: "provider-a",
                provider: "gemini-cli",
                label: "Gemini CLI",
                secondaryLabel: "flash",
                usage: {
                  inputTokens: 600,
                  cachedInputTokens: 150,
                  inputCostUsd: 0,
                  outputCostUsd: 0,
                  cachedInputCostUsd: 0,
                  totalCostUsd: 20.0,
                  outputTokens: 300,
                  reasoningOutputTokens: 75,
                  totalTokens: 1125,
                  invocationCount: 6,
                  activeTimeMs: 240000,
                  wallTimeMs: 300000,
                },
              },
            ],
            purposes: [
              {
                id: "planning",
                label: "Planning",
                usage: {
                  inputTokens: 100,
                  cachedInputTokens: 25,
                  inputCostUsd: 0,
                  outputCostUsd: 0,
                  cachedInputCostUsd: 0,
                  totalCostUsd: 0.5,
                  outputTokens: 75,
                  reasoningOutputTokens: 0,
                  totalTokens: 200,
                  invocationCount: 2,
                  activeTimeMs: 60000,
                  wallTimeMs: 70000,
                },
              },
            ],
            models: [],
            git: {
              totals: { insertions: 120, deletions: 20, filesChanged: 7, prCount: 2, mergedCount: 1, mergeConflictCount: 1 },
              buckets: [], tasks: [], sprints: [],
            },
          } as any
        }
        providerSegments={[
          { label: "Gemini CLI", value: 1125, color: "#00E0A0", textClassName: "text-slate-900" },
          { label: "Claude Code", value: 750, color: "#FFB800", textClassName: "text-slate-900" },
        ]}
        tokenSegments={[
          { label: "Input", value: 1000, color: "#00E0A0", textClassName: "text-slate-900" },
          { label: "Cached", value: 250, color: "#0EA5E9", textClassName: "text-slate-900" },
          { label: "Output", value: 500, color: "#FFB800", textClassName: "text-slate-900" },
          { label: "Reasoning", value: 125, color: "#F43F5E", textClassName: "text-slate-900" },
        ]}
      />,
    );

    const providerShare = screen.getAllByText("Provider Share").at(-1);
    const tokenAnatomy = screen.getByText("Token Anatomy");
    const sourceConfidence = screen.getByText("Source Confidence");
    const purposeActivity = screen.getByText("Purpose Activity");
    const providerActivity = screen.getByText("Provider Activity");

    expect(providerShare).toBeDefined();
    expect(providerShare!.compareDocumentPosition(tokenAnatomy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tokenAnatomy.compareDocumentPosition(sourceConfidence) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sourceConfidence.compareDocumentPosition(purposeActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(purposeActivity.compareDocumentPosition(providerActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getAllByText("20.0%").length).toBeGreaterThan(0);
    expect(screen.getByText("Mixed confidence")).toBeInTheDocument();
    expect(screen.getByText("Git Context")).toBeInTheDocument();
    expect(screen.getByText("Merge blockers")).toBeInTheDocument();
    expect(screen.getAllByText("Cache rate").length).toBeGreaterThan(0);
    expect(screen.getByText("Cache Efficiency")).toBeInTheDocument();
    expect(screen.getAllByText("$12.35").length).toBeGreaterThan(0);
    expect(screen.getByText("2 calls / 1m 0s active")).toBeInTheDocument();
    expect(screen.getByText("11% token share")).toBeInTheDocument();
    expect(screen.getByText("Dominant")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Provider Share" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Token Anatomy" })).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: /Input .*cached .*output .*reasoning .*total/i }).length).toBeGreaterThan(0);

    const providerLedger = screen.getByTestId("composition-provider-activity");
    const geminiLabel = within(providerLedger).getByText("Gemini CLI");
    const claudeLabel = within(providerLedger).getByText("Claude Code");

    expect(geminiLabel.compareDocumentPosition(claudeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("No provider data for this window.");
  });

  it("renders explicit empty states when provider and token segments are unavailable", () => {
    render(
      <CompositionStudio
        stats={
          {
            usage: {
              inputTokens: 0,
              cachedInputTokens: 0,
              inputCostUsd: 0,
              outputCostUsd: 0,
              cachedInputCostUsd: 0,
              totalCostUsd: 0,
              outputTokens: 0,
              reasoningOutputTokens: 0,
              totalTokens: 0,
              invocationCount: 0,
              activeTimeMs: 0,
              wallTimeMs: 0,
            },
            providers: [],
            purposes: [],
            models: [],
          } as any
        }
        providerSegments={[]}
        tokenSegments={[]}
      />,
    );

    expect(screen.getAllByText("No telemetry landed in this composition yet.")).toHaveLength(2);
    expect(screen.getByText("No purpose data for this window.")).toBeInTheDocument();
    expect(screen.getByText("No provider data for this window.")).toBeInTheDocument();
    expect(screen.getByText("No source signal")).toBeInTheDocument();
    expect(screen.getByText("No Git activity was recorded in this window.")).toHaveAttribute("role", "status");
  });

  it("keeps long provider content contained in flat comparison rows", () => {
    const longName = "provider-family-preview-2026-with-a-very-long-operational-routing-name";
    const { container } = render(
      <CompositionStudio
        stats={{
          usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2, invocationCount: 1, activeTimeMs: 1, wallTimeMs: 0, totalCostUsd: 0, reportedInvocationCount: 0, estimatedInvocationCount: 1, unavailableInvocationCount: 0, unsupportedInvocationCount: 0 },
          providers: [{ id: "long", provider: "codex", label: longName, secondaryLabel: `${longName}-secondary`, usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningOutputTokens: 0, totalTokens: 2, invocationCount: 1, activeTimeMs: 1, wallTimeMs: 0, totalCostUsd: 0 } }],
          purposes: [], models: [],
        } as any}
        providerSegments={[]}
        tokenSegments={[]}
      />,
    );

    const row = screen.getByRole("article", { name: `${longName} provider activity` });
    expect(within(row).getByText(longName)).toHaveClass("break-words");
    expect(row.className).toContain("min-w-0");
    expect(container.innerHTML).not.toMatch(/shadow|backdrop-blur|hover:-?translate|hover:scale/);
    expect(within(row).getByRole("img", { name: /Input 1; cached 0; output 1/i })).toBeInTheDocument();
  });
});
