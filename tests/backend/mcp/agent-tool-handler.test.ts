import { describe, expect, it, vi } from "vitest";
import { AgentToolHandler } from "../../../src/mcp/agent-tool-handler.js";

describe("AgentToolHandler", () => {
    const defaultDeps = {
        workerDispatchExecutionService: {
            executeDispatch: vi.fn().mockResolvedValue({ dispatchId: "dispatch-1" }),
            cancelLocalDispatch: vi.fn().mockResolvedValue({ accepted: true }),
        } as any,
        workerInboxReplyService: {
            generateReply: vi.fn().mockResolvedValue({ bodyMarkdown: "reply" }),
        } as any,
    };

    it("handleExecuteWorkerDispatch proxies execution response", async () => {
        const handler = new AgentToolHandler(defaultDeps);
        const res = await handler.handleExecuteWorkerDispatch({ dispatch_id: "dispatch-1" });
        expect(defaultDeps.workerDispatchExecutionService.executeDispatch).toHaveBeenCalledWith("dispatch-1");
        expect((res as any).content[0].text).toContain("dispatch-1");
    });

    it("handleCancelLocalDispatch proxies cancellation response", async () => {
        const handler = new AgentToolHandler(defaultDeps);
        const res = await handler.handleCancelLocalDispatch({ dispatch_id: "dispatch-1", reason: "stop" });
        expect(defaultDeps.workerDispatchExecutionService.cancelLocalDispatch).toHaveBeenCalledWith("dispatch-1", "stop");
        expect((res as any).content[0].text).toContain("accepted");
    });

    it("handleGenerateDashboardReply proxies reply generation", async () => {
        const handler = new AgentToolHandler(defaultDeps);
        const res = await handler.handleGenerateDashboardReply({
            project_id: "project-1",
            thread_id: "thread-1",
            thread_title: "Status",
            body_markdown: "What is running?",
        });
        expect(defaultDeps.workerInboxReplyService.generateReply).toHaveBeenCalledWith({
            projectId: "project-1",
            threadId: "thread-1",
            threadTitle: "Status",
            bodyMarkdown: "What is running?",
        });
        expect((res as any).content[0].text).toContain("reply");
    });
});
