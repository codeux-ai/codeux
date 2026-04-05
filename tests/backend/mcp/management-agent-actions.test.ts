import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentActions } from "../../../src/mcp/management/agent-actions.js";
import type { AgentPresetSyncService } from "../../../src/services/agent-preset-sync-service.js";

describe("AgentActions", () => {
  let agentPresetSyncService: unknown;
  let actions: AgentActions;

  beforeEach(() => {
    agentPresetSyncService = {
      listAgentPresets: vi.fn().mockResolvedValue([
        { id: "agent-1", name: "Worker" },
        { id: "agent-2", name: "Planner" },
      ]),
      syncProjectAgents: vi.fn().mockResolvedValue(undefined),
      createAgentPreset: vi.fn().mockResolvedValue({ id: "agent-3", name: "New Agent" }),
      updateAgentPreset: vi.fn().mockResolvedValue({ id: "agent-1", name: "Updated Worker" }),
      deleteAgentPreset: vi.fn().mockResolvedValue(undefined),
    };

    actions = new AgentActions(agentPresetSyncService as unknown as AgentPresetSyncService);
  });

  it("handles getting an agent by ID", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "get",
      payload: { projectId: "proj-1", presetId: "agent-1" },
    });
    expect(res.result).toEqual({ agent: { id: "agent-1", name: "Worker" } });
  });

  it("handles syncing agents", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "sync",
      payload: { projectId: "proj-1" },
    });
    expect(res.result).toEqual({ success: true });
    expect(agentPresetSyncService.syncProjectAgents).toHaveBeenCalledWith("proj-1");
  });

  it("handles creating an agent", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "create",
      payload: { projectId: "proj-1", name: "New Agent" },
    });
    expect(res.result).toEqual({ agent: { id: "agent-3", name: "New Agent" } });
    expect(agentPresetSyncService.createAgentPreset).toHaveBeenCalled();
  });

  it("handles updating an agent", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "update",
      payload: { projectId: "proj-1", presetId: "agent-1", name: "Updated Worker" },
    });
    expect(res.result).toEqual({ agent: { id: "agent-1", name: "Updated Worker" } });
  });

  it("requires approval for deleting an agent", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "delete",
      payload: { projectId: "proj-1", presetId: "agent-1" },
    });
    expect(res.approvalRequired).toBe(true);
    expect(agentPresetSyncService.deleteAgentPreset).not.toHaveBeenCalled();
  });

  it("allows deleting an agent with explicit approval", async () => {
    const res = await actions.handleAgentAction({
      domain: "agents",
      action: "delete",
      payload: { projectId: "proj-1", presetId: "agent-1" },
      approval: { confirmed: true },
    });
    expect(res.result).toEqual({ success: true });
    expect(agentPresetSyncService.deleteAgentPreset).toHaveBeenCalledWith("agent-1");
  });
});
