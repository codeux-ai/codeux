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

vi.mock("gsap", () => ({
    default: {
        fromTo: vi.fn()
    }
}));
vi.mock("../../../dashboard/src/hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false
}));

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
        expect(gsap.fromTo).toHaveBeenCalled();
    });
});
