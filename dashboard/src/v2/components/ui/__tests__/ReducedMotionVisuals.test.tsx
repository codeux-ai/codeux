// @vitest-environment jsdom
import { render } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sparkline } from "../Sparkline.js";
import { WaveFluid } from "../WaveFluid.js";
import { BorderTrace } from "../BorderTrace.js";
import { ContainerShip } from "../PlanningShip.js";
import { LiveDurationBadge } from "../LiveDurationBadge.js";
import { CanvasBackground } from "../../CanvasBackground.js";
import { RuntimeEventFeed } from "../../RuntimeEventFeed.js";
import { SkeletonLoader, SkeletonPanel } from "../../layout/SkeletonLoader.js";
import type { ExecutionRuntimeEventSummary } from "../../../../types.js";
import gsap from "gsap";
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: vi.fn().mockReturnValue(true),
    useResolvedMotionDuration: vi.fn((duration: string | number) => typeof duration === "number" ? 0 : "0ms")
}));

vi.mock("gsap", () => {
    const timeline = {
        to: vi.fn().mockReturnThis(),
        kill: vi.fn()
    };
    const gsapMock = {
        timeline: vi.fn(() => timeline),
        fromTo: vi.fn(),
        set: vi.fn()
    };
    return { default: gsapMock, ...gsapMock };
});

import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

const runtimeEvent: ExecutionRuntimeEventSummary = {
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-1",
    sprintRunId: null,
    dispatchId: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Sprint One",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-1",
    taskKey: "TASK-1",
    taskTitle: "Implement reduced motion",
    taskRunState: "running",
    eventType: "task_started",
    originator: "worker",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "session-1",
    sessionName: "Worker session",
    workerBranch: "feature/reduced-motion",
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2026-07-05T10:00:00.000Z",
    payload: null
};

describe("Reduced Motion Visuals", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        document.documentElement.removeAttribute("data-reduced-motion");
        vi.mocked(useReducedMotion).mockReturnValue(true);
    });

    it("WaveFluid disables inline animation", () => {
        const { container } = render(<WaveFluid accentHex="#000" isActive />);
        const svg = container.querySelector("svg");
        expect(svg).toHaveStyle({ animation: "none" });
        expect(container.firstElementChild).toHaveAttribute("data-active", "true");
        expect(container.firstElementChild).toHaveClass("opacity-[0.65]");
    });

    it("BorderTrace uses tokenized transition classes", () => {
        const { container } = render(<BorderTrace accentHex="#000" />);
        const trace = container.querySelector(".origin-center");
        expect(trace).toHaveClass("motion-safe:transition-transform");
        expect(trace).toHaveStyle({
            transition: "transform var(--interaction-control-feedback-duration) var(--interaction-control-feedback-ease)"
        });
    });

    it("Sparkline renders static path with stronger opacity", () => {
        const { container } = render(<Sparkline points={[1, 2, 3]} color="#000" />);
        const svg = container.querySelector("svg");
        const path = container.querySelector("path[d]");
        expect(svg).toHaveStyle({ opacity: "0.32" });
        expect(path).toBeInTheDocument();
    });

    it("PlanningShip does not render animate when reduced motion", () => {
        const { container } = render(<ContainerShip accentColor="#000" isMoving={true} isDark={false} />);
        const animate = container.querySelector("animate");
        expect(animate).toBeNull();
    });

    it("CanvasBackground skips GSAP loops and resolves ambient transitions through motion tokens", () => {
        const { container } = render(<CanvasBackground />);

        expect(gsap.timeline).not.toHaveBeenCalled();
        expect(container.querySelector("svg path")).toBeInTheDocument();
        expect(container.querySelector(".transition-colors")).toHaveClass("duration-[var(--motion-slow)]");
        expect(container.querySelector(".transition-colors")).toHaveClass("motion-reduce:transition-none");
    });

    it("RuntimeEventFeed keeps loading status and aria-busy when animation is removed", () => {
        const { rerender } = render(<RuntimeEventFeed events={undefined} />);

        const loading = document.body.querySelector('[role="status"]');
        expect(loading).toHaveTextContent("Loading runtime events");
        expect(loading).toHaveAttribute("aria-busy", "true");

        rerender(<RuntimeEventFeed events={[runtimeEvent]} />);
        const feed = document.body.querySelector('[role="log"][aria-label="Runtime feed"]');
        expect(feed).toHaveAttribute("aria-live", "polite");
        expect(feed).toHaveAttribute("aria-busy", "false");
        expect(gsap.fromTo).not.toHaveBeenCalled();
        expect(document.body).toHaveTextContent("task started");
    });

    it("LiveDurationBadge keeps a static reduced-motion status affordance and accessible text", () => {
        const { getByLabelText } = render(<LiveDurationBadge durationText="2m 10s" flashTriggerCount={1} />);

        const badge = getByLabelText("Live duration: 2m 10s");
        expect(badge).toHaveClass("live-duration-badge");
        expect(badge).toHaveClass("motion-reduce:ring-[color:var(--status-static-running-ring)]");
        expect(badge).toHaveTextContent("2m 10s");
    });

    it("SkeletonLoader removes shimmer animation but preserves loading semantics", () => {
        const { container, getByText } = render(
            <SkeletonLoader show loadingLabel="Loading dashboard metrics">
                <SkeletonPanel />
            </SkeletonLoader>
        );

        expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
        expect(getByText("Loading dashboard metrics")).toHaveClass("sr-only");
        expect(container.querySelector(".animate-skeleton-shimmer")).toBeNull();
    });
});
