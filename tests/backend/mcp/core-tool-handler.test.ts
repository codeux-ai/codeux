import { describe, expect, it, vi, beforeEach } from "vitest";
import { CoreToolHandler } from "../../../src/mcp/core-tool-handler.js";

describe("CoreToolHandler coverage", () => {
    let defaultDeps: any;

    beforeEach(() => {
        defaultDeps = {
            julesApi: {
                getSession: vi.fn().mockResolvedValue({ id: "1", state: "COMPLETED" }),
            },
            activitySummary: {
                toSessionSummary: vi.fn(x => x),
                getActivityRecentLimit: vi.fn().mockReturnValue(1),
            },
            isJulesApiConfigured: vi.fn().mockReturnValue(true),
            normalizeName: vi.fn(x => x),
            getMissingJulesApiKeyInstruction: vi.fn().mockReturnValue("Jules API err"),
            isTrackedCliSession: vi.fn().mockReturnValue(false),
            getTrackedSession: vi.fn(),
            getDashboardSettings: vi.fn().mockReturnValue({ sprintLoopSteps: { watchLoopOutputIntervalSeconds: 300 } }),
            connectionChatRepository: {
                startListen: vi.fn().mockReturnValue({ connection: { id: "conn-1", connectionKey: "listener-1" }, inbox: [] }),
                pullInbox: vi.fn().mockReturnValue([{ id: "msg-1" }]),
                getConnectionByKey: vi.fn().mockImplementation((connectionKey: string) => ({
                    id: connectionKey === "worker-1" ? "conn-worker-1" : "conn-1",
                    connectionKey,
                    role: connectionKey === "worker-1" ? "worker" : "listener",
                })),
                postListenReply: vi.fn().mockReturnValue({ id: "reply-1", threadId: "thread-1", deliveryStatus: "processed" }),
            },
            workerEndpointRepository: {
                getWorkerEndpointByConnectionId: vi.fn().mockImplementation((connectionId: string) => (
                    connectionId === "conn-worker-1"
                        ? { id: "worker-endpoint-1" }
                        : null
                )),
            },
            projectWorkerAssignmentService: {
                ensureWorkerAssignment: vi.fn(),
            },
            projectAttentionService: {
                claimItem: vi.fn().mockReturnValue({
                    id: "attention-1",
                    status: "claimed",
                    assignedWorkerEndpointId: "worker-endpoint-1",
                    claimedAt: "2026-03-13T00:00:00.000Z",
                }),
                resolveItem: vi.fn().mockReturnValue({
                    id: "attention-1",
                    status: "resolved",
                    resolvedAt: "2026-03-13T00:00:00.000Z",
                }),
            },
            workerAttentionOutcomeService: {
                reportOutcome: vi.fn().mockReturnValue({
                    sourceItem: {
                        id: "attention-1",
                        status: "resolved",
                        resolvedAt: "2026-03-13T00:00:00.000Z",
                    },
                    handoffItem: {
                        id: "attention-2",
                    },
                    threadId: "thread-1",
                    threadMessageId: "message-1",
                }),
            },
            workerTaskDispatchService: {
                pullNextDispatch: vi.fn().mockReturnValue({ dispatch: { id: "dispatch-1" }, leaseToken: "lease-1" }),
                updateDispatch: vi.fn().mockReturnValue({ id: "dispatch-1", status: "completed" }),
            },
            workerListenEventService: {
                pullNextEvent: vi.fn().mockReturnValue(null),
            },
            resolveSessionName: vi.fn(),
            fetchRecentActivities: vi.fn().mockResolvedValue([]),
            logger: { warn: vi.fn() },
        };
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

    it("handleStartListen", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleStartListen({ connection_key: "listener-1", project_id: "project-1" });
        expect(defaultDeps.connectionChatRepository.startListen).toHaveBeenCalledWith({
            connectionKey: "listener-1",
            displayName: undefined,
            role: undefined,
            projectId: "project-1",
            projectIds: undefined,
            activeProjectIds: undefined,
            transport: undefined,
            capabilities: undefined,
            maxMessages: undefined,
        });
    });

    it("handleStartListen ensures worker assignments for worker listeners", async () => {
        defaultDeps.connectionChatRepository.startListen.mockReturnValue({
            connection: {
                id: "conn-worker-1",
                connectionKey: "worker-1",
                role: "worker",
                projectIds: ["project-1"],
                activeProjectIds: ["project-1"],
            },
            inbox: [],
        });

        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleStartListen({
            connection_key: "worker-1",
            project_id: "project-1",
            role: "worker",
        });

        expect(defaultDeps.projectWorkerAssignmentService.ensureWorkerAssignment).toHaveBeenCalledWith(
            "project-1",
            "worker-endpoint-1",
        );
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
        expect(parsed.message.threadId).toBe("thread-1");
        expect(parsed.message.projectId).toBe("project-1");
        expect(parsed.message.threadTitle).toBeUndefined();
        expect(parsed.connection).toBeUndefined();
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handleListen returns a task dispatch event for worker listeners", async () => {
        defaultDeps.connectionChatRepository.pullInbox.mockReturnValue([]);
        defaultDeps.workerListenEventService.pullNextEvent.mockReturnValue(null);
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
        expect(parsed.connection).toBeUndefined();
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handleListen returns an attention item event for worker listeners before dispatch pickup", async () => {
        defaultDeps.connectionChatRepository.pullInbox.mockReturnValue([]);
        defaultDeps.workerListenEventService.pullNextEvent.mockReturnValue({
            kind: "attention_item",
            item: {
                id: "attention-1",
                projectId: "project-1",
                sprintId: null,
                taskId: null,
                sprintRunId: null,
                dispatchId: null,
                attentionType: "merge_required",
                severity: "high",
                ownerType: "worker",
                status: "open",
                assignedWorkerEndpointId: "worker-endpoint-1",
                title: "Merge required",
                summaryMarkdown: "Needs merge handling.",
                payload: { repoPath: "/repo" },
                openedAt: "2026-03-10T00:00:00.000Z",
                updatedAt: "2026-03-10T00:00:00.000Z",
            },
            project: {
                id: "project-1",
                name: "Project 1",
                repoPath: "/repo",
                defaultBranch: "main",
                featureBranch: "feature/test",
            },
            workingDirectoryHint: "cd /repo",
            contextDigest: {
                activeSprintId: null,
                activeSprintName: null,
                activeSprintNumber: null,
                unresolvedAttentionCount: 1,
                unresolvedAttentionTitles: ["Merge required"],
                recentEventTypes: [],
            },
            continuation: {
                nextTool: "listen",
                instruction: "Call listen again.",
            },
        });

        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleListen({
            connection_key: "worker-1",
            project_id: "project-1",
            role: "worker",
            include_attention_items: true,
            include_task_dispatch: true,
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(parsed.kind).toBe("attention_item");
        expect(parsed.project.repoPath).toBe("/repo");
        expect(defaultDeps.workerTaskDispatchService.pullNextDispatch).not.toHaveBeenCalled();
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
        expect(parsed.connection).toBeUndefined();
        expect(parsed.continuation.nextTool).toBe("listen");
    });

    it("handleListen omits internal polling metadata from compact responses", async () => {
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

        expect(parsed.pollIntervalMs).toBeUndefined();
        expect(parsed.timeoutSeconds).toBeUndefined();
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

    it("handleListenForRuntime forces worker identity on worker gateway", async () => {
        defaultDeps.connectionChatRepository.startListen.mockReturnValue({
            connection: {
                id: "conn-1",
                connectionKey: "worker-1",
                activeProjectIds: ["project-1"],
                projectIds: ["project-1"],
            },
            inbox: [],
        });
        defaultDeps.connectionChatRepository.pullInbox.mockReturnValue([]);
        defaultDeps.workerTaskDispatchService.pullNextDispatch.mockReturnValue(null);

        const handler = new CoreToolHandler(defaultDeps);
        await handler.handleListenForRuntime({
            connection_key: "worker-1",
            project_id: "project-1",
            role: "listener",
            transport: "stdio",
            timeout_seconds: 0.01,
            poll_interval_ms: 1,
        }, "worker_gateway");

        expect(defaultDeps.connectionChatRepository.startListen).toHaveBeenCalledWith(expect.objectContaining({
            connectionKey: "worker-1",
            role: "worker",
            transport: "streamable_http",
        }));
    });

    it("handlePostListenReply", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handlePostListenReply({
            connection_key: "listener-1",
            thread_id: "thread-1",
            body_markdown: "reply",
            reply_to_message_id: "message-1",
        });
        const parsed = JSON.parse(response.content[0].text as string);
        expect(defaultDeps.connectionChatRepository.postListenReply).toHaveBeenCalledWith({
            connectionKey: "listener-1",
            threadId: "thread-1",
            bodyMarkdown: "reply",
            replyToMessageId: "message-1",
        });
        expect(parsed).toEqual({
            threadId: "thread-1",
            deliveryStatus: "processed",
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

    it("handleClaimAttentionItem claims through the project attention service", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleClaimAttentionItem({
            connection_key: "worker-1",
            attention_item_id: "attention-1",
            claim_reason: "worker_started_investigation",
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(defaultDeps.projectAttentionService.claimItem).toHaveBeenCalledWith(
            "attention-1",
            "worker-endpoint-1",
            "worker_started_investigation",
        );
        expect(parsed).toEqual({
            itemId: "attention-1",
            status: "claimed",
            assignedWorkerEndpointId: "worker-endpoint-1",
            claimedAt: "2026-03-13T00:00:00.000Z",
        });
    });

    it("handleResolveAttentionItem resolves with worker ownership when called by a worker", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleResolveAttentionItem({
            connection_key: "worker-1",
            attention_item_id: "attention-1",
            resolution_status: "dismissed",
            resolution_reason: "merge_superseded",
            resolution_summary_markdown: "Handled outside the worker queue.",
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(defaultDeps.projectAttentionService.resolveItem).toHaveBeenCalledWith("attention-1", {
            status: "dismissed",
            reason: "merge_superseded",
            resolutionSummaryMarkdown: "Handled outside the worker queue.",
            workerEndpointId: "worker-endpoint-1",
        });
        expect(parsed).toEqual({
            itemId: "attention-1",
            status: "resolved",
            resolvedAt: "2026-03-13T00:00:00.000Z",
        });
    });

    it("handleReportAttentionOutcome routes worker outcomes through the outcome service", async () => {
        const handler = new CoreToolHandler(defaultDeps);
        const response = await handler.handleReportAttentionOutcome({
            connection_key: "worker-1",
            attention_item_id: "attention-1",
            outcome: "needs_dashboard_reply",
            summary_markdown: "Need an operator response before proceeding.",
            thread_title: "Worker follow-up",
        });
        const parsed = JSON.parse(response.content[0].text as string);

        expect(defaultDeps.workerAttentionOutcomeService.reportOutcome).toHaveBeenCalledWith({
            attentionItemId: "attention-1",
            workerEndpointId: "worker-endpoint-1",
            connectionId: "conn-worker-1",
            outcome: "needs_dashboard_reply",
            summaryMarkdown: "Need an operator response before proceeding.",
            resolutionReason: undefined,
            threadTitle: "Worker follow-up",
        });
        expect(parsed).toEqual({
            itemId: "attention-1",
            status: "resolved",
            outcome: "needs_dashboard_reply",
            handoffAttentionItemId: "attention-2",
            threadId: "thread-1",
            threadMessageId: "message-1",
            resolvedAt: "2026-03-13T00:00:00.000Z",
        });
    });
});
