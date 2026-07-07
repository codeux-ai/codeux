/** @jsx h */
// @vitest-environment happy-dom
import { h } from "preact";
import { cleanup, fireEvent, render, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ToolCallWidget } from "../../../dashboard/src/v2/components/chat/widgets/ToolCallWidget.js";
import { ReasoningWidget } from "../../../dashboard/src/v2/components/chat/widgets/ReasoningWidget.js";
import {
  classifyToolHumorCategory,
  selectAgentHumorMessage,
} from "../../../dashboard/src/v2/lib/agent-humor-messages.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => true,
}));

const expectedToolLine = (toolName: string, callId: string, status = "completed"): string => (
  selectAgentHumorMessage({
    category: classifyToolHumorCategory(toolName),
    seed: `${toolName}|${callId}|${status}`,
    nowMs: 0,
  })
);

const stableTextHash = (value: string): string => {
  let hash = 2_166_136_261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16_777_619) >>> 0;
  }
  return hash.toString(36);
};

const expectedThinkingLine = (text: string, providerLabel = "", modelLabel = ""): string => (
  selectAgentHumorMessage({
    category: "thinking",
    seed: `reasoning|${stableTextHash(text.trim())}|${providerLabel}|${modelLabel}`,
    nowMs: 0,
  })
);

describe("tool and reasoning humor widgets", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders distinct contextual lines for every tool humor category without hiding transcript details", () => {
    const tools = [
      { toolName: "exec_command", callId: "call-exec-123456", args: "{\"cmd\":\"pnpm test\"}" },
      { toolName: "apply_patch", callId: "call-edit-123456", args: "*** Update File: dashboard/src/example.ts" },
      { toolName: "read_file", callId: "call-read-123456", args: "{\"path\":\"dashboard/src/example.ts\"}" },
      { toolName: "rg_search", callId: "call-search-123456", args: "{\"query\":\"ToolCallWidget\"}" },
      { toolName: "web.run", callId: "call-web-123456", args: "{\"url\":\"https://example.com\"}" },
      { toolName: "surprise_helper", callId: "call-generic-123456", args: "{\"request\":\"do useful work\"}" },
    ];
    const expectedLines = tools.map(({ toolName, callId }) => expectedToolLine(toolName, callId));

    const { container } = render(
      <div>
        {tools.map(({ toolName, callId, args }) => (
          <ToolCallWidget
            key={toolName}
            toolName={toolName}
            status="completed"
            args={args}
            output="tool output"
            tokens={{ input: 4, output: 8 }}
            callId={callId}
          />
        ))}
      </div>
    );
    const view = within(container);

    expect(new Set(expectedLines).size).toBe(tools.length);
    for (const { toolName, callId, args } of tools) {
      expect(view.getByText(toolName)).toBeInTheDocument();
      expect(view.getByText(expectedToolLine(toolName, callId))).toBeInTheDocument();
      expect(view.getAllByText("done").length).toBeGreaterThan(0);
      expect(view.getAllByText("12").length).toBeGreaterThan(0);
      expect(view.getByText(callId.slice(0, 8))).toBeInTheDocument();
      expect(container.textContent).toContain(args.replace(/\s+/g, " ").trim().slice(0, 12));
    }

    fireEvent.click(view.getAllByRole("button")[0]!);
    const expandedPanel = container.querySelector('div[aria-hidden="false"]');
    expect(expandedPanel).toBeInTheDocument();
    expect(expandedPanel).toHaveTextContent("Input");
    expect(expandedPanel).toHaveTextContent("Output");
    expect(expandedPanel).toHaveTextContent("tool output");
  });

  it("renders a stable thinking line while preserving reasoning expand and collapse behavior", () => {
    const longReasoning = [
      "First pass through the plan.",
      "Second pass validates the constraints.",
      "Third pass checks the implementation shape.",
      "Fourth pass keeps the transcript readable.",
      "Fifth pass preserves the existing expand and collapse behavior.",
      "Sixth pass confirms the detailed text remains available.",
    ].join(" ");
    const expectedLine = expectedThinkingLine(longReasoning, "codex", "gpt-5");

    const { getByRole, getByText, queryByText } = render(
      <ReasoningWidget
        text={longReasoning}
        providerLabel="codex"
        modelLabel="gpt-5"
        tokens={{ reasoning: 84 }}
        createdAtLabel="12:34 PM"
      />
    );

    expect(getByText(expectedLine)).toBeInTheDocument();
    expect(getByText("codex")).toBeInTheDocument();
    expect(getByText("gpt-5")).toBeInTheDocument();
    expect(getByText("84 tok")).toBeInTheDocument();
    expect(queryByText(longReasoning)).not.toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: /Show reasoning/i }));
    expect(getByText(longReasoning)).toBeInTheDocument();

    fireEvent.click(getByRole("button", { name: /Hide reasoning/i }));
    expect(queryByText(longReasoning)).not.toBeInTheDocument();
    expect(getByText(expectedLine)).toBeInTheDocument();
  });
});
