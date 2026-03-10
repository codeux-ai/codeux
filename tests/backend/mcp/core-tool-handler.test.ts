import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoreToolHandler } from "../../../src/mcp/core-tool-handler.js";

describe("CoreToolHandler coverage", () => {
    let defaultDeps: any;

    beforeEach(() => {
        defaultDeps = {
            julesApi: {
                getSource: vi.fn(),
                listSources: vi.fn().mockResolvedValue({}),
                listAllSources: vi.fn().mockResolvedValue([]),
                createSession: vi.fn().mockResolvedValue({ id: "1" }),
                getSession: vi.fn().mockResolvedValue({ id: "1", state: "COMPLETED" }),
                listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
                approveSessionPlan: vi.fn().mockResolvedValue({}),
                sendSessionMessage: vi.fn().mockResolvedValue({}),
                getActivity: vi.fn().mockResolvedValue({}),
                listActivities: vi.fn().mockResolvedValue({}),
                listAllActivities: vi.fn().mockResolvedValue([]),
            },
            activitySummary: {
                toSourceSummary: vi.fn(),
                toSourcePageSummary: vi.fn(),
                extractSourceListResponse: vi.fn().mockReturnValue({ sources: [], nextPageToken: undefined }),
                toSessionSummary: vi.fn(x => x),
                toActionResponseSummary: vi.fn(),
                toActivitySummary: vi.fn(),
                toActivityPageSummary: vi.fn(),
                toActivityCollectionSummary: vi.fn(),
                getActivityRecentLimit: vi.fn().mockReturnValue(1),
            },
            isJulesApiConfigured: vi.fn().mockReturnValue(true),
            normalizeName: vi.fn(x => x),
            getConsecutiveFailures: vi.fn().mockReturnValue(0), getMissingJulesApiKeyInstruction: vi.fn().mockReturnValue("Jules API err"),
            setConsecutiveFailures: vi.fn(),
            getMaxFailures: vi.fn().mockReturnValue(3),
            isTrackedCliSession: vi.fn().mockReturnValue(false),
            getTrackedSession: vi.fn(),
            listTrackedSessions: vi.fn().mockReturnValue({ sessions: [] }),
            listAllTrackedActivities: vi.fn(),
            listTrackedActivities: vi.fn(),
            getDashboardSettings: vi.fn().mockReturnValue({ sprintLoopSteps: { watchLoopOutputIntervalSeconds: 300 } }),
            connectionChatRepository: {
                startListen: vi.fn().mockReturnValue({ connection: { id: "conn-1", connectionKey: "listener-1" }, inbox: [] }),
                pullInbox: vi.fn().mockReturnValue([{ id: "msg-1" }]),
                getConnectionByKey: vi.fn().mockReturnValue({ id: "conn-1", connectionKey: "listener-1" }),
                postListenReply: vi.fn().mockReturnValue({ id: "reply-1" }),
            },
            workerTaskDispatchService: {
                pullNextDispatch: vi.fn().mockReturnValue({ dispatch: { id: "dispatch-1" }, leaseToken: "lease-1" }),
                updateDispatch: vi.fn().mockReturnValue({ id: "dispatch-1", status: "completed" }),
            },
            resolveSessionName: vi.fn(),
            fetchRecentActivities: vi.fn().mockResolvedValue([]),
            isActionRequiredState: vi.fn().mockReturnValue(false),
            logger: { warn: vi.fn() },
        };
    });

    it("handleGetSource throws if not configured", async () => {
        defaultDeps.isJulesApiConfigured.mockReturnValue(false);
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleGetSource({ source_id: "s" })).rejects.toThrow("Jules API");
    });

    it("handleListSources", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListSources({});
        expect(defaultDeps.julesApi.listSources).toHaveBeenCalled();
    });

    it("handleListAllSources", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListAllSources({});
        expect(defaultDeps.julesApi.listAllSources).toHaveBeenCalled();
    });

    it("handleCreateSession with args", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleCreateSession({ prompt: "p", source: "s", starting_branch: "b", title: "t", require_plan_approval: true, automation_mode: "m" });
        expect(defaultDeps.julesApi.createSession).toHaveBeenCalledWith(expect.objectContaining({
            title: "t", requirePlanApproval: true, automationMode: "m"
        }));
    });

    it("handleCreateSession fails on max", async () => {
        defaultDeps.getConsecutiveFailures.mockReturnValue(3);
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleCreateSession({ prompt: "p", source: "s" })).rejects.toThrow("Emergency stop");
    });

    it("handleCreateSession increments fail", async () => {
        defaultDeps.julesApi.createSession.mockRejectedValue(new Error());
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleCreateSession({ prompt: "p", source: "s" })).rejects.toThrow();
        expect(defaultDeps.setConsecutiveFailures).toHaveBeenCalledWith(1);
    });

    it("handleGetSession tracked", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.getTrackedSession.mockReturnValue({ id: "1" });
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleGetSession({ session_id: "1" });
        expect(defaultDeps.activitySummary.toSessionSummary).toHaveBeenCalledWith({ id: "1" });
    });

    it("handleGetSession tracked not found", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.getTrackedSession.mockReturnValue(undefined);
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleGetSession({ session_id: "1" })).rejects.toThrow("not found");
    });

    it("handleGetSession fetch activities error", async () => {
        defaultDeps.fetchRecentActivities.mockRejectedValue(new Error());
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleGetSession({ session_id: "1" });
        expect(defaultDeps.logger.warn).toHaveBeenCalled();
    });

    it("handleListSessions unconfigured", async () => {
        defaultDeps.isJulesApiConfigured.mockReturnValue(false);
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListSessions({});
        expect(defaultDeps.julesApi.listSessions).not.toHaveBeenCalled();
    });

    it("handleApproveSessionPlan", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleApproveSessionPlan({ session_id: "1" });
        expect(defaultDeps.julesApi.approveSessionPlan).toHaveBeenCalled();
    });

    it("handleSendSessionMessage", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleSendSessionMessage({ session_id: "1", prompt: "p" });
        expect(defaultDeps.julesApi.sendSessionMessage).toHaveBeenCalled();
    });

    it("handleWaitForSessionCompletion handles track error", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.getTrackedSession.mockReturnValue(undefined);
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleWaitForSessionCompletion({ session_id: "1", poll_interval: 0.01, timeout: 0.05 })).rejects.toThrow("not found");
    });

    it("handleWaitForSessionCompletion handles timeout", async () => {
        defaultDeps.julesApi.getSession.mockResolvedValue({ id: "1", state: "PENDING" });
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleWaitForSessionCompletion({ session_id: "1", poll_interval: 0.01, timeout: 0.05 })).rejects.toThrow("Timeout waiting for");
    });

    it("handleGetActivity tracked", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.listAllTrackedActivities.mockReturnValue([{ id: "activities/a" }]);
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleGetActivity({ session_id: "1", activity_id: "a" });
        expect(defaultDeps.activitySummary.toActivitySummary).toHaveBeenCalled();
    });

    it("handleGetActivity tracked not found", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.listAllTrackedActivities.mockReturnValue([]);
        const handler = new CoreToolHandler(defaultDeps);
        await expect(handler.handleGetActivity({ session_id: "1", activity_id: "a" })).rejects.toThrow("not found");
    });

    it("handleGetActivity not tracked", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleGetActivity({ session_id: "1", activity_id: "a" });
        expect(defaultDeps.julesApi.getActivity).toHaveBeenCalled();
    });

    it("handleListActivities tracked", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.listTrackedActivities.mockReturnValue({});
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListActivities({ session_id: "1" });
        expect(defaultDeps.activitySummary.toActivityPageSummary).toHaveBeenCalled();
    });

    it("handleListActivities not tracked", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListActivities({ session_id: "1" });
        expect(defaultDeps.julesApi.listActivities).toHaveBeenCalled();
    });

    it("handleListAllActivities tracked", async () => {
        defaultDeps.isTrackedCliSession.mockReturnValue(true);
        defaultDeps.listAllTrackedActivities.mockReturnValue([]);
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListAllActivities({ session_id: "1" });
        expect(defaultDeps.activitySummary.toActivityCollectionSummary).toHaveBeenCalled();
    });

    it("handleListAllActivities not tracked", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListAllActivities({ session_id: "1" });
        expect(defaultDeps.julesApi.listAllActivities).toHaveBeenCalled();
    });

    it("handleStartListen", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleStartListen({ connection_key: "listener-1", project_id: "project-1" });
        expect(defaultDeps.connectionChatRepository.startListen).toHaveBeenCalledWith({
            connectionKey: "listener-1",
            displayName: undefined,
            role: undefined,
            projectId: "project-1",
            transport: undefined,
            capabilities: undefined,
            maxMessages: undefined,
        });
    });

    it("handleListen returns a dashboard message event", async () => {
        defaultDeps.connectionChatRepository.startListen.mockReturnValue({
            connection: { id: "conn-1", connectionKey: "listener-1" },
            inbox: [{
                id: "message-1",
                threadId: "thread-1",
                threadTitle: "Inbox",
                projectId: "project-1",
                bodyMarkdown: "Hello from dashboard",
                createdAt: "2026-03-10T00:00:00.000Z",
                deliveryStatus: "delivered",
            }],
        });

        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleListen({ connection_key: "listener-1", project_id: "project-1" });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(parsed.kind).toBe("dashboard_message");
        expect(parsed.message.bodyMarkdown).toBe("Hello from dashboard");
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handleListen returns a task dispatch event for worker listeners", async () => {
        defaultDeps.connectionChatRepository.pullInbox.mockReturnValue([]);
        defaultDeps.workerTaskDispatchService.pullNextDispatch.mockReturnValue({
            dispatch: { id: "dispatch-1" },
            leaseToken: "lease-1",
            project: { id: "project-1" },
            sprint: { id: "sprint-1" },
            task: { id: "task-1" },
            executionContext: { repoPath: "/repo", defaultBranch: "main", featureBranch: "feature/test" },
        });

        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleListen({
            connection_key: "worker-1",
            project_id: "project-1",
            role: "worker",
            include_task_dispatch: true,
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(parsed.kind).toBe("task_dispatch");
        expect(parsed.dispatch.dispatch.id).toBe("dispatch-1");
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handleListen returns noop timeout when no work arrives", async () => {
        defaultDeps.connectionChatRepository.pullInbox.mockReturnValue([]);
        defaultDeps.workerTaskDispatchService.pullNextDispatch.mockReturnValue(null);

        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleListen({
            connection_key: "listener-1",
            project_id: "project-1",
            timeout_seconds: 0.01,
            poll_interval_ms: 1,
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(parsed.kind).toBe("noop_timeout");
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handlePullInbox", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handlePullInbox({ connection_key: "listener-1", max_messages: 5 });
        expect(defaultDeps.connectionChatRepository.pullInbox).toHaveBeenCalledWith({
            connectionKey: "listener-1",
            projectId: undefined,
            maxMessages: 5,
        });
    });

    it("handlePostListenReply", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handlePostListenReply({
            connection_key: "listener-1",
            thread_id: "thread-1",
            body_markdown: "reply",
            reply_to_message_id: "message-1",
        });
        expect(defaultDeps.connectionChatRepository.postListenReply).toHaveBeenCalledWith({
            connectionKey: "listener-1",
            threadId: "thread-1",
            bodyMarkdown: "reply",
            replyToMessageId: "message-1",
        });
    });

    it("handlePullTaskDispatch", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handlePullTaskDispatch({
            connection_key: "worker-1",
            project_id: "project-1",
            sprint_id: "sprint-1",
        });
        expect(defaultDeps.workerTaskDispatchService.pullNextDispatch).toHaveBeenCalledWith({
            connectionKey: "worker-1",
            projectId: "project-1",
            sprintId: "sprint-1",
        });
    });

    it("handleUpdateTaskDispatch", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleUpdateTaskDispatch({
            connection_key: "worker-1",
            dispatch_id: "dispatch-1",
            lease_token: "lease-1",
            state: "COMPLETED",
            summary_markdown: "done",
        });
        expect(defaultDeps.workerTaskDispatchService.updateDispatch).toHaveBeenCalledWith({
            connectionKey: "worker-1",
            dispatchId: "dispatch-1",
            leaseToken: "lease-1",
            state: "COMPLETED",
            provider: undefined,
            sessionId: undefined,
            sessionName: undefined,
            workerBranch: undefined,
            prUrl: undefined,
            summaryMarkdown: "done",
            errorMessage: undefined,
        });
    });
});
