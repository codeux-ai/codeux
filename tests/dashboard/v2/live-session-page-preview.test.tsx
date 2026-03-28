/** @jsx h */
// @vitest-environment jsdom
import { h } from "preact";
import { render, screen, cleanup } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { LiveSessionPage } from "../../../dashboard/src/v2/LiveSessionPage.js";
import { usePreviewSessions } from "../../../dashboard/src/v2/hooks/use-preview-sessions.js";

expect.extend(matchers);

vi.mock("../../../dashboard/src/v2/context/project-data.js", () => ({
    useProjectData: vi.fn(() => ({
        projects: [],
        selectedProjectId: "proj-1"
    }))
}));

vi.mock("../../../dashboard/src/hooks/use-dashboard-runtime-data.js", () => ({
    useDashboardRuntimeData: vi.fn(() => ({
        sprintEvents: [],
        taskEvents: [],

        error: null,
        execution: { projectId: "proj-1", sprintRuns: [], taskDispatches: [], attentionItems: [], sprintNumber: 1, runtimeEvents: [], recentEvents: [], connections: [], overflowAssignedWorkers: [], primaryAssignedWorker: null },
        gitStatus: null,
        gitStatusError: null,
        initialLoadComplete: true,
        refreshRuntimeStatus: vi.fn(),
        refreshGitStatus: vi.fn(),
        status: { project_id: "proj-1", tasks: [], reportText: "", runtimeEvents: [], feature_branch: null },
        tasksWithLiveActivities: [],
        sprintDispatches: [],
        pendingActionIds: []
    }))
}));

vi.mock("../../../dashboard/src/v2/hooks/useSprints.js", () => ({
    useSprints: vi.fn(() => ({
        data: [],
        selectedSprintId: "sprint-1",
        loading: false
    }))
}));


vi.mock("../../../dashboard/src/v2/hooks/use-preview-sessions.js", () => ({
    usePreviewSessions: vi.fn()
}));


describe("LiveSessionPage Preview Link CTA", () => {
    beforeEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it("does not render preview link when session status is stopped", () => {

        (usePreviewSessions as any).mockReturnValue({
            selectedSession: {
                id: "sess-1",
                projectId: "proj-1",
                sprintId: "sprint-1",
                status: "stopped",
                hostPort: 3000,
                lastKnownPath: "/"
            }
        });

        render(<LiveSessionPage />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });

    it("does not render preview link when session has no hostPort", () => {

        (usePreviewSessions as any).mockReturnValue({
            selectedSession: {
                id: "sess-1",
                projectId: "proj-1",
                sprintId: "sprint-1",
                status: "running",
                hostPort: null,
                lastKnownPath: "/"
            }
        });

        render(<LiveSessionPage />);
        expect(screen.queryByRole("link", { name: /Live Preview/i })).not.toBeInTheDocument();
    });

    it("renders preview link when session is running and has hostPort", () => {

        (usePreviewSessions as any).mockReturnValue({
            selectedSession: {
                id: "sess-1",
                projectId: "proj-1",
                sprintId: "sprint-1",
                status: "running",
                hostPort: 3000,
                lastKnownPath: "/test-path"
            }
        });

        render(<LiveSessionPage />);
        const link = screen.getByRole("link", { name: /Live Preview/i });
        expect(link).toBeInTheDocument();
        expect(link.getAttribute("href")).toContain("/test-path");
        expect(link.getAttribute("href")).toContain("preview-sess-1");
    });
});
