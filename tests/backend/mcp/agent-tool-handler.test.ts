import { describe, expect, it, vi } from "vitest";
import { AgentToolHandler } from "../../../src/mcp/agent-tool-handler.js";

describe("AgentToolHandler", () => {
    const defaultDeps = {
        sprintOrchestrator: { execute: vi.fn() } as any,
        taskService: { createTaskAgentSession: vi.fn() } as any,
        workerDispatchExecutionService: {
            executeDispatch: vi.fn().mockResolvedValue({ dispatchId: "dispatch-1" }),
            cancelLocalDispatch: vi.fn().mockResolvedValue({ accepted: true }),
        } as any,
        workerInboxReplyService: {
            generateReply: vi.fn().mockResolvedValue({ bodyMarkdown: "reply" }),
        } as any,
        getDashboardSettings: vi.fn().mockReturnValue({ git: { sprintBranchScheme: "sprint" } }),
        formatSprintBranch: vi.fn().mockReturnValue("branch-x"),
        getConsecutiveFailures: vi.fn().mockReturnValue(0),
        setConsecutiveFailures: vi.fn(),
        getMaxFailures: vi.fn().mockReturnValue(3),
        waitForSessionCompletion: vi.fn().mockResolvedValue({ wait: true }),
    };

    it("handleSprintAgent uses resolved args", async () => {
        const handler = new AgentToolHandler(defaultDeps);
        await handler.handleSprintAgent({ sprint_number: 1, repo_path: "repo", feature_branch: "" } as any);
        expect(defaultDeps.sprintOrchestrator.execute).toHaveBeenCalledWith(expect.objectContaining({ feature_branch: "branch-x" }));
    });

    it("handleTaskAgent prevents execution on max fails", async () => {
        const handler = new AgentToolHandler({ ...defaultDeps, getConsecutiveFailures: () => 3, getMaxFailures: () => 3 });
        await expect(handler.handleTaskAgent({ prompt: "p" })).rejects.toThrow(/CRITICAL: Emergency stop active/);
    });

    it("handleTaskAgent returns wait result if true", async () => {
        const deps = { ...defaultDeps, taskService: { createTaskAgentSession: vi.fn().mockResolvedValue({ id: "1" }) } as any };
        const handler = new AgentToolHandler(deps);
        const res = await handler.handleTaskAgent({ prompt: "p", wait: true });
        expect(res).toEqual({ wait: true });
    });

    it("handleTaskAgent returns session summary and resets fails", async () => {
        const deps = { ...defaultDeps, taskService: { createTaskAgentSession: vi.fn().mockResolvedValue({ id: "1", outputs: [{ pullRequest: { url: "http" } }] }) } as any };
        const handler = new AgentToolHandler(deps);
        const res = await handler.handleTaskAgent({ prompt: "p" });
        expect(deps.setConsecutiveFailures).toHaveBeenCalledWith(0);
        expect((res as any).content[0].text).toContain("http");
    });

    it("handleTaskAgent increments fails on error", async () => {
        const error = new Error("failed");
        let fails = 0;
        const deps = { ...defaultDeps, taskService: { createTaskAgentSession: vi.fn().mockRejectedValue(error) } as any, getConsecutiveFailures: () => fails, setConsecutiveFailures: vi.fn(val => fails = val) };
        const handler = new AgentToolHandler(deps);
        await expect(handler.handleTaskAgent({ prompt: "p" })).rejects.toThrow(error);
        expect(deps.setConsecutiveFailures).toHaveBeenCalledWith(1);
    });

    it("toSessionSummary handles empty outputs", async () => {
        const deps = { ...defaultDeps, taskService: { createTaskAgentSession: vi.fn().mockResolvedValue({ id: "1", outputs: [{}, { pullRequest: {} }] }) } as any };
        const handler = new AgentToolHandler(deps);
        const res = await handler.handleTaskAgent({ prompt: "p" });
        expect(deps.setConsecutiveFailures).toHaveBeenCalledWith(0);
        expect((res as any).content[0].text).toContain('"hasPullRequest": false');
    });

    it("handleTaskAgent forwards repo_path when provided", async () => {
        const deps = { ...defaultDeps, taskService: { createTaskAgentSession: vi.fn().mockResolvedValue({ id: "1" }) } as any };
        const handler = new AgentToolHandler(deps);
        await handler.handleTaskAgent({ prompt: "p", repo_path: "/tmp/project" });
        expect(deps.taskService.createTaskAgentSession).toHaveBeenCalledWith(expect.objectContaining({
            repo_path: "/tmp/project",
        }));
    });

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
