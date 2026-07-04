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

        const retry = screen.getByRole("button", { name: "Retry dispatch dispatch-1" });
        expect(retry).toHaveTextContent("Retrying");
        expect(retry).toHaveAttribute("aria-busy", "true");
        expect(retry).toHaveAttribute("aria-disabled", "true");
        expect(retry).toHaveAttribute("data-action-state", "pending");
        expect(retry).toHaveAttribute("title", "Retrying is already in progress.");
        expect(retry.getAttribute("aria-describedby")).toBeTruthy();
        expect(screen.getByText("Retrying in progress.")).toBeInTheDocument();
        expect(screen.getByText("Retrying is already in progress.")).toBeInTheDocument();
    });
});
