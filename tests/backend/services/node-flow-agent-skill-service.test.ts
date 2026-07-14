import { describe, expect, it, vi } from "vitest";
import { NodeFlowAgentSkillService } from "../../../src/services/node-flow-agent-skill-service.js";

describe("NodeFlowAgentSkillService", () => {
  it("advertises only narrow capability metadata and records initiating context", async () => {
    const runFlow = vi.fn(async () => ({ run: { id: "run-1" }, nodeRuns: [], output: { ok: true } }));
    const nodeFlowService = {
      listAgentSkillsForAgent: vi.fn(() => [{ flowId: "flow-1", skillName: "Review", description: "Review input" }]),
      get: vi.fn(() => ({ id: "flow-1", projectId: "project-1", graph: { nodes: [], edges: [], schemas: { input: { type: "object", properties: { prompt: { type: "string" } } } } } })),
      validateDraft: vi.fn(() => ({ publishedVersion: 2, requiredCredentials: [] })),
      runFlow,
    };
    const service = new NodeFlowAgentSkillService(nodeFlowService as never);

    expect(service.listCapabilities("project-1", "agent-1")).toEqual([{
      flowId: "flow-1", name: "Review", description: "Review input",
      inputSchema: { type: "object", properties: { prompt: { type: "string" } } }, operation: "run_attached_flow",
    }]);
    await service.runAttachedFlow({ projectId: "project-1", flowId: "flow-1", agentPresetId: "agent-1", conversationId: "thread-1", parameters: { prompt: "safe" } });
    expect(runFlow).toHaveBeenCalledWith("project-1", "flow-1", { prompt: "safe" }, expect.objectContaining({
      triggerType: "attached_flow",
      triggerPayload: { initiatingAgentId: "agent-1", conversationId: "thread-1", operation: "run_attached_flow" },
    }));
    expect(JSON.stringify(service.listCapabilities("project-1", "agent-1"))).not.toContain("credential");
  });

  it("rejects unattached, unpublished, and credential-blocked flows", async () => {
    const base = { get: vi.fn(() => ({ id: "flow-1", projectId: "project-1", graph: { nodes: [], edges: [] } })), runFlow: vi.fn() };
    await expect(new NodeFlowAgentSkillService({ ...base, listAgentSkillsForAgent: () => [] } as never).runAttachedFlow({ projectId: "project-1", flowId: "flow-1", agentPresetId: "agent-1" })).rejects.toThrow(/not attached/i);
    await expect(new NodeFlowAgentSkillService({ ...base, listAgentSkillsForAgent: () => [{ flowId: "flow-1", skillName: "x", description: "" }], validateDraft: () => ({ publishedVersion: null, requiredCredentials: [] }) } as never).runAttachedFlow({ projectId: "project-1", flowId: "flow-1", agentPresetId: "agent-1" })).rejects.toThrow(/not been published/i);
    await expect(new NodeFlowAgentSkillService({ ...base, listAgentSkillsForAgent: () => [{ flowId: "flow-1", skillName: "x", description: "" }], validateDraft: () => ({ publishedVersion: 1, requiredCredentials: [{ required: true, status: "missing" }] }) } as never).runAttachedFlow({ projectId: "project-1", flowId: "flow-1", agentPresetId: "agent-1" })).rejects.toThrow(/credential policy/i);
    await expect(new NodeFlowAgentSkillService({ ...base, listAgentSkillsForAgent: () => [{ flowId: "flow-1", skillName: "x", description: "" }], validateDraft: () => ({ publishedVersion: 1, requiredCredentials: [{ required: false, status: "denied" }] }) } as never).runAttachedFlow({ projectId: "project-1", flowId: "flow-1", agentPresetId: "agent-1" })).rejects.toThrow(/credential policy/i);
    expect(base.runFlow).not.toHaveBeenCalled();
  });

  it("executes a published attached flow when an optional credential slot is unbound", async () => {
    const runFlow = vi.fn(async () => ({ run: { id: "run-optional" }, nodeRuns: [], output: { ok: true } }));
    const service = new NodeFlowAgentSkillService({
      listAgentSkillsForAgent: () => [{ flowId: "flow-1", skillName: "x", description: "" }],
      get: () => ({ id: "flow-1", projectId: "project-1", graph: { nodes: [], edges: [] } }),
      validateDraft: () => ({
        publishedVersion: 1,
        requiredCredentials: [{ required: false, status: "missing" }],
      }),
      runFlow,
    } as never);

    await expect(service.runAttachedFlow({
      projectId: "project-1",
      flowId: "flow-1",
      agentPresetId: "agent-1",
      parameters: { prompt: "safe" },
    })).resolves.toMatchObject({ run: { id: "run-optional" } });
    expect(runFlow).toHaveBeenCalledOnce();
  });
});
