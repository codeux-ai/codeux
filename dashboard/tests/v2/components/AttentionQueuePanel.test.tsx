/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/preact";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { AttentionQueuePanel } from "../../../src/v2/components/live-session/AttentionQueuePanel.js";

expect.extend(matchers);

vi.mock("../../../src/hooks/ExecutionTimelineContext.js", () => ({
  useExecutionTimeline: () => ({
    execution: { attentionItems: [] },
    onClaimAttentionItem: vi.fn(),
    onResolveAttentionItem: vi.fn(),
    onDismissAttentionItem: vi.fn(),
    pendingActionIds: new Set(),
  }),
}));

describe("AttentionQueuePanel", () => {
  afterEach(() => cleanup());

  it("renders empty state when there are no items", () => {
    render(<AttentionQueuePanel />);
    expect(screen.getByText("Attention Queue Empty")).toBeInTheDocument();
    expect(screen.getByText("All tasks and workers are proceeding normally.")).toBeInTheDocument();
  });
});
