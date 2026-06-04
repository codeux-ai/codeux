/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { AttentionLedger } from "../../../dashboard/src/v2/components/AttentionLedger.js";
import { useExecutionTimeline } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
import gsap from "gsap";

vi.mock("../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
    useExecutionTimeline: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/components/ui/WaveFluid.js", () => ({
    WaveFluid: () => null,
}));

vi.mock("../../../dashboard/src/v2/components/ui/BorderTrace.js", () => ({
    BorderTrace: () => null,
}));

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn(),
        killTweensOf: vi.fn(),
        to: vi.fn(),
        context: vi.fn(() => ({ revert: vi.fn() })),
    },
}));

describe("AttentionLedger", () => {
    const baseContext = {
        execution: {
            attentionItems: [
                {
                    id: "item-1",
                    status: "open",
                    ownerType: "worker",
                    title: "Wait",
                    severity: "medium",
                    attentionType: "test",
                    updatedAt: Date.now(),
                    summaryMarkdown: "First summary",
                },
                {
                    id: "item-2",
                    status: "claimed",
                    ownerType: "worker",
                    title: "Claimed",
                    severity: "medium",
                    attentionType: "test",
                    updatedAt: Date.now(),
                    summaryMarkdown: "Second summary",
                },
            ],
            primaryAssignedWorker: {
                workerEndpointId: "worker-1",
                workerDisplayName: "Worker One",
            },
            overflowAssignedWorkers: [],
            projectId: "proj-1",
        },
        onClaimAttentionItem: vi.fn(),
        onResolveAttentionItem: vi.fn(),
        onDismissAttentionItem: vi.fn(),
        pendingActionIds: new Set<string>(),
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        cleanup();
        vi.spyOn(useReducedMotionModule, "useReducedMotion").mockReturnValue(false);
        vi.mocked(useExecutionTimeline).mockReturnValue(baseContext as never);
    });

    it("renders the standalone card chrome by default", () => {
        render(<AttentionLedger />);

        expect(screen.getByText("Attention Queue")).toBeInTheDocument();
        expect(screen.getByText("open 1")).toBeInTheDocument();
        expect(screen.getByText("claimed 1")).toBeInTheDocument();
        expect(screen.getByText("First summary")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Claim" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Attention Queue/i })).toBeNull();
    });

    it("renders a collapsible header when requested", () => {
        render(<AttentionLedger collapsible />);

        const headerButton = screen.getByRole("button", { name: /Attention Queue/i });
        expect(headerButton).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(headerButton);

        expect(headerButton).toHaveAttribute("aria-expanded", "false");
    });

    it("skips entry animation when reduced motion is enabled", () => {
        vi.spyOn(useReducedMotionModule, "useReducedMotion").mockReturnValue(true);

        render(<AttentionLedger />);

        expect(gsap.fromTo).not.toHaveBeenCalled();
        expect(screen.getByText("Attention Queue")).toBeInTheDocument();
    });

    it("returns null without an execution snapshot", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            ...baseContext,
            execution: null,
        } as never);

        render(<AttentionLedger />);

        expect(screen.queryByText("Attention Queue")).toBeNull();
    });
});
