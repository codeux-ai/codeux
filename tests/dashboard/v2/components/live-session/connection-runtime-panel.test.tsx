/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import gsap from "gsap";
import { ConnectionRuntimePanel, ExecutionRuntimePanel } from "../../../../../dashboard/src/v2/components/live-session/ExecutionRuntimePanel.js";
import { useExecutionTimeline } from "../../../../../dashboard/src/hooks/ExecutionTimelineContext.js";
import type { ExecutionDashboardSnapshot, ExecutionRuntimeEventSummary } from "../../../../../dashboard/src/types.js";

vi.mock("../../../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
    useExecutionTimeline: vi.fn(),
}));

vi.mock("../../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => true,
    useResolvedMotionDuration: (duration: number | string) => typeof duration === "number" ? 0 : "0ms",
}));

vi.mock("gsap", () => ({
    default: {
        killTweensOf: vi.fn(),
        fromTo: vi.fn(),
        to: vi.fn(),
        set: vi.fn(),
    },
}));

vi.mock("../../../../../dashboard/src/v2/components/ui/WaveFluid.js", () => ({
    WaveFluid: () => null,
}));

vi.mock("../../../../../dashboard/src/v2/components/ui/BorderTrace.js", () => ({
    BorderTrace: () => null,
}));

const createRuntimeEvent = (payload: Record<string, unknown>): ExecutionRuntimeEventSummary => ({
    id: "event-1",
    scopeType: "task_run",
    taskRunId: "task-run-1",
    sprintRunId: "sprint-run-1",
    dispatchId: "dispatch-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    sprintName: "Runtime Sprint",
    sprintNumber: 1,
    sprintRunStatus: "running",
    taskId: "task-1",
    taskKey: "T-1",
    taskTitle: "Build cached image",
    taskRunState: "RUNNING",
    eventType: "setup_image_build_progress",
    originator: "system",
    sourceEventKey: null,
    provider: "codex",
    sessionId: "session-1",
    sessionName: null,
    workerBranch: null,
    prUrl: null,
    connectionId: null,
    connectionDisplayName: null,
    connectionRole: null,
    createdAt: "2024-01-01T10:00:00.000Z",
    payload,
});

const createExecutionSnapshot = (
    events: ExecutionRuntimeEventSummary[] = [],
): ExecutionDashboardSnapshot => ({
    projectId: "project-1",
    projectName: "Project 1",
    sprintRuns: [],
    taskDispatches: [],
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: events,
    recentInvocations: [],
    updatedAt: "2024-01-01T10:00:00.000Z",
});

describe("ConnectionRuntimePanel", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        cleanup();
    });

    it("renders standalone chrome and counts listener, worker, and manager connections", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: {
                connections: [
                    {
                        id: "conn-listener",
                        role: "listener",
                        status: "listening",
                        listenMode: true,
                        displayName: "Primary Listener",
                        transport: "streamable_http",
                        model: "gpt-5",
                        connectionKey: "listener-key",
                        lastHeartbeatAt: "2024-01-01T11:04:30Z",
                        pendingInboxCount: 1,
                        activeDispatchCount: 1,
                        threadCount: 3,
                        tasksRunCount: 4,
                        labels: ["runtime"],
                        instruction: "Handle live task orchestration updates.",
                        machineName: "runner-a",
                        platform: "linux",
                        arch: "x64",
                        localExecutionRuntime: "host",
                    },
                    {
                        id: "conn-worker",
                        role: "worker",
                        status: "online",
                        listenMode: false,
                        displayName: "Internal Worker",
                        transport: "streamable_http",
                        model: "gpt-5",
                        connectionKey: "worker-key",
                        lastHeartbeatAt: "2024-01-01T11:04:45Z",
                        pendingInboxCount: 2,
                        activeDispatchCount: 3,
                        threadCount: 5,
                        tasksRunCount: 7,
                        labels: [],
                        instruction: null,
                        machineName: "worker-b",
                        platform: "linux",
                        arch: "arm64",
                        localExecutionRuntime: "container",
                    },
                    {
                        id: "conn-manager",
                        role: "project_manager",
                        status: "listening",
                        listenMode: true,
                        displayName: "Dashboard Manager",
                        transport: "websocket",
                        model: "gpt-5",
                        connectionKey: "manager-key",
                        lastHeartbeatAt: "2024-01-01T11:04:50Z",
                        pendingInboxCount: 0,
                        activeDispatchCount: 0,
                        threadCount: 1,
                        tasksRunCount: 2,
                        labels: ["dashboard"],
                        instruction: "Keep the operator view synchronized.",
                        machineName: "dashboard",
                        platform: "linux",
                        arch: "x64",
                        localExecutionRuntime: "browser",
                    },
                ],
            },
        } as never);

        render(<ConnectionRuntimePanel />);

        expect(screen.getByText("Live Connections")).toBeInTheDocument();
        expect(screen.getByText("active 3")).toBeInTheDocument();
        expect(screen.getByText("listening 2")).toBeInTheDocument();
        expect(screen.getByText("workers 1")).toBeInTheDocument();
        expect(screen.getByText("manager 1")).toBeInTheDocument();

        expect(screen.getByText("Primary Listener")).toBeInTheDocument();
        expect(screen.getByText("Internal Worker")).toBeInTheDocument();
        expect(screen.getByText("Dashboard Manager")).toBeInTheDocument();
        expect(screen.getAllByText("Listening")).toHaveLength(2);
        expect(screen.getByText("Manager")).toBeInTheDocument();
    });

    it("exposes collapsible state and snaps reduced-motion expansion without tweening", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: {
                connections: [],
            },
        } as never);

        render(<ConnectionRuntimePanel collapsible defaultOpen={false} />);

        const toggle = screen.getByRole("button", { name: /Live Connections/i });
        const panelId = toggle.getAttribute("aria-controls");
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(panelId).toBeTruthy();
        expect(document.getElementById(panelId ?? "")).toHaveAttribute("aria-hidden", "true");
        expect(gsap.set).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ height: 0, overflow: "hidden" }));
        expect(gsap.to).not.toHaveBeenCalled();

        toggle.focus();
        fireEvent.click(toggle);

        expect(toggle).toHaveAttribute("aria-expanded", "true");
        expect(document.activeElement).toBe(toggle);
        expect(document.getElementById(panelId ?? "")).not.toHaveAttribute("aria-hidden");
    });

    it("renders pending runtime action labels with busy state", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: {
                projectId: "project-1",
                projectName: "Project 1",
                sprintRuns: [],
                taskDispatches: [{
                    id: "dispatch-1",
                    projectId: "project-1",
                    sprintId: "sprint-1",
                    sprintRunId: "run-1",
                    sprintName: "Runtime Sprint",
                    taskId: "task-1",
                    taskKey: "T-1",
                    taskTitle: "Repair runtime action feedback",
                    taskRunId: "task-run-1",
                    status: "failed",
                    taskRunState: "FAILED",
                    executorType: "docker_cli",
                    connectionDisplayName: "Worker One",
                    sessionId: null,
                    workerBranch: null,
                    activeLeaseOwnerKey: null,
                    errorMessage: "Provider failed",
                    startedAt: "2024-01-01T10:00:00.000Z",
                    finishedAt: "2024-01-01T10:02:00.000Z",
                }],
                connections: [],
                primaryAssignedWorker: null,
                overflowAssignedWorkers: [],
                attentionItems: [],
                recentEvents: [],
                recentInvocations: [],
                updatedAt: "2024-01-01T10:02:00.000Z",
            },
            onRetryTaskDispatch: vi.fn(),
            pendingActionIds: new Set(["dispatch-retry:dispatch-1"]),
        } as never);

        render(<ExecutionRuntimePanel />);

        const retry = screen.getByRole("button", { name: "Retry dispatch dispatch-1. Retrying is already in progress." });
        expect(retry).toHaveTextContent("Retrying");
        expect(retry).toHaveAttribute("aria-busy", "true");
        expect(retry).toHaveAttribute("aria-disabled", "true");
        expect(retry).toHaveAttribute("data-action-state", "pending");
        expect(retry).toHaveAttribute("title", "Retrying is already in progress.");
        expect(retry.getAttribute("aria-describedby")).toBeTruthy();
        expect(screen.getByText("Retrying in progress.")).toBeInTheDocument();
        expect(screen.getByText("Retrying is already in progress.")).toBeInTheDocument();
    });

    it("renders container build progress with accessible progress semantics", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: createExecutionSnapshot([
                createRuntimeEvent({
                    kind: "build_step",
                    imageTag: "code-ux-setup-cache-node-24-bookworm:abc123",
                    baseImage: "node:24-bookworm",
                    message: "Docker setup image build: RUN pnpm install",
                    progressPercent: 47,
                    stepText: "RUN pnpm install",
                }),
            ]),
        } as never);

        render(<ExecutionRuntimePanel />);

        expect(screen.getByText("Building container image")).toBeInTheDocument();
        expect(screen.getByText("This container needs to be built. The first build can take time; future invocations will use the cached image.")).toBeInTheDocument();
        expect(screen.getByText("RUN pnpm install")).toBeInTheDocument();
        expect(screen.getByText("47% complete")).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: "setup-cache image build progress" }))
            .toHaveAttribute("aria-valuenow", "47");
    });

    it("updates visible progress as runtime events change", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: createExecutionSnapshot([
                createRuntimeEvent({
                    kind: "build_step",
                    imageTag: "code-ux-setup-cache-node-24-bookworm:abc123",
                    baseImage: "node:24-bookworm",
                    message: "Docker setup image build: COPY setup.sh",
                    progressPercent: 20,
                    stepText: "COPY setup.sh",
                }),
            ]),
        } as never);

        const { unmount } = render(<ExecutionRuntimePanel />);
        expect(screen.getByText("20% complete")).toBeInTheDocument();
        unmount();

        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: createExecutionSnapshot([
                createRuntimeEvent({
                    kind: "build_step",
                    imageTag: "code-ux-setup-cache-node-24-bookworm:abc123",
                    baseImage: "node:24-bookworm",
                    message: "Docker setup image build: RUN bash setup.sh",
                    progressPercent: 80,
                    stepText: "RUN bash setup.sh",
                }),
            ]),
        } as never);

        render(<ExecutionRuntimePanel />);
        expect(screen.getByText("80% complete")).toBeInTheDocument();
        expect(screen.getByText("RUN bash setup.sh")).toBeInTheDocument();
    });

    it("renders a visible no-progress fallback without aria-valuenow", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: createExecutionSnapshot([
                createRuntimeEvent({
                    kind: "lock_wait",
                    imageTag: "code-ux-setup-cache-node-24-bookworm:abc123",
                    baseImage: "node:24-bookworm",
                    message: "Waiting for cached Docker setup image to finish building.",
                }),
            ]),
        } as never);

        render(<ExecutionRuntimePanel />);

        expect(screen.getByText("Waiting for container image build")).toBeInTheDocument();
        expect(screen.getByText("Progress is not available yet.")).toBeInTheDocument();
        expect(screen.getByRole("progressbar", { name: "setup-cache image build progress" }))
            .not.toHaveAttribute("aria-valuenow");
    });

    it("does not render a build infobox when cached images are reused", () => {
        vi.mocked(useExecutionTimeline).mockReturnValue({
            execution: createExecutionSnapshot([
                createRuntimeEvent({
                    description: "Using cached Docker setup image code-ux-setup-cache-node:abc.",
                }),
            ]),
        } as never);

        render(<ExecutionRuntimePanel />);

        expect(screen.queryByText("Building container image")).not.toBeInTheDocument();
        expect(screen.queryByText(/This container needs to be built/)).not.toBeInTheDocument();
        expect(screen.queryByRole("progressbar", { name: /build progress/i })).not.toBeInTheDocument();
    });
});
