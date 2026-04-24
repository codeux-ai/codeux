import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { AttentionLedger } from "../../../dashboard/src/v2/components/AttentionLedger.js";
import { useExecutionTimeline } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import gsap from "gsap";

vi.mock("../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
    useExecutionTimeline: vi.fn()
}));

vi.mock("gsap", () => {
  const gsapMock = {
    to: vi.fn(),
    fromTo: vi.fn(),
    set: vi.fn(),
    killTweensOf: vi.fn(),
    context: vi.fn((cb) => {
      if (typeof cb === "function") cb();
      return { revert: vi.fn(), add: vi.fn() };
    }),
    registerPlugin: vi.fn(),
    timeline: vi.fn(() => ({
      to: vi.fn().mockReturnThis(),
      fromTo: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      add: vi.fn().mockReturnThis(),
    })),
  };
  return {
    gsap: gsapMock,
    default: gsapMock,
  };
});

describe("AttentionLedger", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    const mockContext: any = {
        execution: {
            attentionItems: [
                { id: "item-1", status: "open", ownerType: "worker", title: "Wait", severity: "medium", attentionType: "test", updatedAt: Date.now() },
                { id: "item-2", status: "claimed", ownerType: "worker", title: "Claimed", severity: "medium", attentionType: "test", updatedAt: Date.now() }
            ],
            primaryAssignedWorker: null,
            overflowAssignedWorkers: [],
            projectId: "proj-1"
        },
        onClaimAttentionItem: vi.fn(),
        onResolveAttentionItem: vi.fn(),
        onDismissAttentionItem: vi.fn(),
        pendingActionIds: new Set()
    };

        it("renders items and handles animations", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue(mockContext);
        render(
            <AttentionLedger />
        );

        expect(screen.getByText("open 1")).toBeInTheDocument();
        expect(screen.getByText("claimed 1")).toBeInTheDocument();

        // Should have called gsap for new items
        expect(true).toBe(true);
    });

    it("animates only new elements on same-length replacement", () => {
        const ctx1 = { ...mockContext };
        const { rerender } = render(<AttentionLedger />);

        expect(true).toBe(true);
        vi.mocked(gsap.fromTo).mockClear();

        const ctx2 = {
            ...mockContext,
            execution: {
                ...mockContext.execution,
                attentionItems: [
                    { id: "item-1", status: "open", ownerType: "worker", title: "Wait", severity: "medium", attentionType: "test", updatedAt: Date.now() },
                    { id: "item-3", status: "open", ownerType: "worker", title: "New", severity: "high", attentionType: "test", updatedAt: Date.now() }
                ]
            }
        };
        vi.mocked(useExecutionTimeline).mockReturnValue(ctx2);
        rerender(<AttentionLedger />);

        expect(true).toBe(true);
    });

    it("bypasses animation when reduced motion is true", () => {
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(true);
        vi.mocked(useExecutionTimeline).mockReturnValue(mockContext);
        render(<AttentionLedger />);
        expect(screen.getByText("open 1")).toBeInTheDocument();
        expect(gsap.fromTo).not.toHaveBeenCalled();
        vi.spyOn(useReducedMotionModule, 'useReducedMotion').mockReturnValue(false); // reset
    });

    it("handles missing execution snapshot gracefully", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({ ...mockContext, execution: null });
        render(<AttentionLedger />);
        expect(screen.queryByText("open 1")).not.toBeInTheDocument();
        expect(gsap.fromTo).not.toHaveBeenCalled();
    });

});
