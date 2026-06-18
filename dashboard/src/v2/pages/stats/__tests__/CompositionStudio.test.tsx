/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { CompositionStudio } from "../components/StatsShared.js";

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
              totalCostUsd: 0,
              outputTokens: 500,
              reasoningOutputTokens: 125,
              totalTokens: 1875,
              invocationCount: 9,
              activeTimeMs: 540000,
              wallTimeMs: undefined,
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
                  totalCostUsd: 0,
                  outputTokens: 75,
                  reasoningOutputTokens: 0,
                  totalTokens: 200,
                  invocationCount: 2,
                  activeTimeMs: 60000,
                  wallTimeMs: 70000,
                },
              },
            ],
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

    const providerShare = screen.getByText("Provider Share");
    const tokenAnatomy = screen.getByText("Token Anatomy");
    const purposeRibbon = screen.getByText("Planning");
    const tokenFlight = screen.getByText("Token Flight");
    const cacheEfficiency = screen.getByText("Cache Efficiency");
    const providerActivity = screen.getByText("Provider Activity");

    expect(providerShare.compareDocumentPosition(tokenAnatomy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText("cost").length).toBeGreaterThan(0);
    expect(tokenAnatomy.compareDocumentPosition(purposeRibbon) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(purposeRibbon.compareDocumentPosition(tokenFlight) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(tokenFlight.compareDocumentPosition(cacheEfficiency) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cacheEfficiency.compareDocumentPosition(providerActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByText("20.0%")).toBeInTheDocument();

    expect(screen.getByText("~250 tokens saved")).toBeInTheDocument();
    expect(screen.getByText("9m 0s")).toBeInTheDocument();
    expect(screen.getByText("0s")).toBeInTheDocument();

    const providerLedger = screen.getByText("Provider Activity").closest("div.space-y-4");
    expect(providerLedger).not.toBeNull();

    const geminiLabel = within(providerLedger as HTMLElement).getByText("Gemini CLI");
    const claudeLabel = within(providerLedger as HTMLElement).getByText("Claude Code");

    expect(geminiLabel.compareDocumentPosition(claudeLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.textContent).not.toContain("No provider data for this window.");
  });
});
