/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

import { AttentionLedger, AttentionQueueItemsList } from "../../../dashboard/src/v2/components/AttentionLedger.js";
import { useExecutionTimeline } from "../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import type { ExecutionAttentionItemSummary } from "../../../dashboard/src/types.js";
import * as useReducedMotionModule from "../../../dashboard/src/v2/hooks/use-reduced-motion.js";
import gsap from "gsap";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

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
        expect(screen.getByRole("button", { name: "Claim attention item: Wait" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /Attention Queue/i })).toBeNull();
    });


    it("shows loading states for claim, resolve, and dismiss actions", () => {
        const customContext = {
            ...baseContext,
            pendingActionIds: new Set(["attention-claim:item-1", "attention-resolve:item-1", "attention-dismiss:item-1"])
        };
        vi.mocked(useExecutionTimeline).mockReturnValue(customContext as never);

        render(<AttentionLedger />);

        expect(screen.getByRole("button", { name: /Claim attention item: Wait/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Resolve attention item: Wait/i })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: /Dismiss attention item: Wait/i })).toBeInTheDocument();

        expect(screen.getByRole("button", { name: /Claim attention item: Wait/i })).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("button", { name: /Resolve attention item: Wait/i })).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByRole("button", { name: /Dismiss attention item: Wait/i })).toHaveAttribute("aria-disabled", "true");
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

    it("renders queue rows in read-only mode without action controls", () => {
        const attentionItem: ExecutionAttentionItemSummary = {
            id: "item-readonly",
            sprintId: "sprint-1",
            taskId: "task-1",
            sprintRunId: "run-1",
            dispatchId: "dispatch-1",
            attentionType: "merge_required",
            severity: "high",
            ownerType: "worker",
            status: "open",
            assignedWorkerEndpointId: null,
            title: "Read-only blocker",
            summaryMarkdown: "Shared rendering without duplicate actions.",
            payload: null,
            openedAt: "2024-01-01T00:00:00Z",
            claimedAt: null,
            resolvedAt: null,
            updatedAt: "2024-01-01T00:01:00Z",
        };

        render(
            <AttentionQueueItemsList
                attentionItems={[attentionItem]}
                snapshot={baseContext.execution as any}
                showActions={false}
                listLabel="Overview scoped attention items"
            />,
        );

        expect(screen.getByRole("list", { name: "Overview scoped attention items" })).toBeInTheDocument();
        expect(screen.getByText("Read-only blocker")).toBeInTheDocument();
        expect(screen.getByText("Shared rendering without duplicate actions.")).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: /attention item/i })).not.toBeInTheDocument();
    });

    it("localizes German queue controls and metadata without changing attention content", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            ...baseContext,
            execution: {
                ...baseContext.execution,
                attentionItems: [{
                    ...baseContext.execution.attentionItems[0],
                    attentionType: "merge_required",
                    severity: "high",
                    title: "Keep THIS attention title verbatim",
                    summaryMarkdown: "Keep THIS intervention summary verbatim.",
                }],
            },
        } as never);

        render(
            <DashboardI18nProvider initialLocale="de" storage={null}>
                <AttentionLedger />
            </DashboardI18nProvider>,
        );

        expect(screen.getByText("Aufmerksamkeitswarteschlange")).toBeInTheDocument();
        expect(screen.getByText("Hoch")).toBeInTheDocument();
        expect(screen.getByText("Zusammenführung erforderlich")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Aufmerksamkeitseintrag übernehmen: Keep THIS attention title verbatim" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Aufmerksamkeitseintrag lösen: Keep THIS attention title verbatim" })).toBeInTheDocument();
        expect(screen.getByText("Keep THIS attention title verbatim")).toBeInTheDocument();
        expect(screen.getByText("Keep THIS intervention summary verbatim.")).toBeInTheDocument();
    });
});
