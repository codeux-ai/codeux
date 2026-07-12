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

    const tokenAnatomy = screen.getByRole("heading", { name: "How the window was consumed" });
    const providerShare = screen.getByRole("heading", { name: "Where usage landed" });
    const purposeLanes = screen.getByRole("heading", { name: "Why tokens were spent" });
    const runtimeContext = screen.getByRole("heading", { name: "Efficiency at a glance" });
    const providerActivity = screen.getByRole("heading", { name: "Provider detail" });

    expect(tokenAnatomy.compareDocumentPosition(providerShare) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(providerShare.compareDocumentPosition(purposeLanes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(purposeLanes.compareDocumentPosition(runtimeContext) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(runtimeContext.compareDocumentPosition(providerActivity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByLabelText("Composition breakdown")).toBeInTheDocument();
    expect(screen.getAllByText("20.0%").length).toBeGreaterThan(0);
    expect(screen.getByText(/250 tokens were served from cache/i)).toBeInTheDocument();
    expect(screen.getByText("Cached input")).toBeInTheDocument();
    expect(screen.getByText("Reasoning")).toBeInTheDocument();
    expect(screen.getByText("Total cost")).toBeInTheDocument();
    expect(screen.getAllByText("$12.35").length).toBeGreaterThan(0);
    expect(screen.getByText("2 calls · 1m 0s active")).toBeInTheDocument();
    expect(screen.getByText("11% share")).toBeInTheDocument();
    expect(screen.getByText("9m 0s")).toBeInTheDocument();
    expect(screen.getByText("0s")).toBeInTheDocument();
    expect(screen.queryByText("Token Flight")).not.toBeInTheDocument();

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

    expect(screen.getByText("0 total")).toBeInTheDocument();
    expect(screen.getAllByText("No volume")).toHaveLength(4);
    expect(screen.getAllByText("No provider data for this window.")).toHaveLength(2);
    expect(screen.getByText("No purpose data for this window.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "No token flow data available." })).toBeInTheDocument();
  });
});
