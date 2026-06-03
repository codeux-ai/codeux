/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";

expect.extend(matchers);

import { ConnectionRuntimePanel } from "../../../../../dashboard/src/v2/components/live-session/ExecutionRuntimePanel.js";
import { useExecutionTimeline } from "../../../../../dashboard/src/hooks/ExecutionTimelineContext.js";

vi.mock("../../../../../dashboard/src/hooks/ExecutionTimelineContext.js", () => ({
    useExecutionTimeline: vi.fn(),
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
});
