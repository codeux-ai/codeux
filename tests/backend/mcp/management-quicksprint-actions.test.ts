import { describe, expect, it, vi, beforeEach } from "vitest";
import { QuicksprintActions } from "../../../src/mcp/management/quicksprint-actions.js";
import type { ManageCodeUxArgs } from "../../../src/contracts/internal-management-types.js";
import type { QuicksprintService } from "../../../src/services/quicksprint-service.js";

describe("QuicksprintActions", () => {
  let quicksprintService: QuicksprintService;
  let actions: QuicksprintActions;

  const makeArgs = (action: string, payload: Record<string, unknown>, approval?: { confirmed: boolean }): ManageCodeUxArgs => ({
    domain: "quicksprints",
    action,
    payload,
    approval,
  });

  beforeEach(() => {
    quicksprintService = {
      listTemplates: vi.fn(),
      getTemplate: vi.fn(),
      createCustomTemplate: vi.fn(),
      updateCustomTemplate: vi.fn(),
      deleteCustomTemplate: vi.fn(),
      executeQuicksprint: vi.fn(),
    } as unknown as QuicksprintService;
    actions = new QuicksprintActions(quicksprintService);
  });

  it("lists quicksprint templates", async () => {
    vi.mocked(quicksprintService.listTemplates).mockResolvedValue([{ id: "t1" } as any]);

    const result = await actions.handleQuicksprintAction(makeArgs("list_templates", { projectId: "p1" }));

    expect(quicksprintService.listTemplates).toHaveBeenCalledWith("p1");
    expect(result.result).toEqual({ templates: [{ id: "t1" }] });
  });

  it("creates custom templates with normalized input", async () => {
    vi.mocked(quicksprintService.createCustomTemplate).mockResolvedValue({ id: "t1" } as any);

    const result = await actions.handleQuicksprintAction(makeArgs("create_template", {
      projectId: "p1",
      name: " Cleanup ",
      description: "Improve code",
      icon: "sparkles",
      category: "maintenance",
      categoryColor: "blue",
      agentInstructionMarkdown: "Split cleanup work",
      defaultTaskCount: 3.8,
      agentPresetId: "agent-1",
    }));

    expect(quicksprintService.createCustomTemplate).toHaveBeenCalledWith("p1", {
      name: "Cleanup",
      description: "Improve code",
      icon: "sparkles",
      category: "maintenance",
      categoryColor: "blue",
      agentInstructionMarkdown: "Split cleanup work",
      defaultTaskCount: 3,
      agentPresetId: "agent-1",
    });
    expect(result.result).toEqual({ template: { id: "t1" } });
  });

  it("requires approval before deleting a template", async () => {
    const result = await actions.handleQuicksprintAction(makeArgs("delete_template", { projectId: "p1", templateId: "t1" }));

    expect(result.approvalRequired).toBe(true);
    expect(quicksprintService.deleteCustomTemplate).not.toHaveBeenCalled();
  });

  it("deletes a template with approval", async () => {
    const result = await actions.handleQuicksprintAction(makeArgs("delete_template", { projectId: "p1", templateId: "t1" }, { confirmed: true }));

    expect(quicksprintService.deleteCustomTemplate).toHaveBeenCalledWith("p1", "t1");
    expect(result.result).toEqual({ status: "success", deletedTemplateId: "t1" });
  });

  it("starts quicksprints with plan_and_start by default", async () => {
    vi.mocked(quicksprintService.executeQuicksprint).mockResolvedValue({ id: "s1" } as any);

    const result = await actions.handleQuicksprintAction(makeArgs("start", {
      projectId: "p1",
      templateId: "builtin-maintenance",
      taskCount: 4.9,
      additionalPrompt: "Focus API",
    }));

    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", {
      templateId: "builtin-maintenance",
      taskCount: 4,
      submitMode: "plan_and_start",
      additionalPrompt: "Focus API",
    });
    expect(result.result).toEqual({ status: "success", sprint: { id: "s1" } });
  });

  it("accepts string taskCount values for quicksprint execution", async () => {
    vi.mocked(quicksprintService.executeQuicksprint).mockResolvedValue({ id: "s1" } as any);

    await actions.handleQuicksprintAction(makeArgs("execute", {
      projectId: "p1",
      templateId: "builtin-maintenance",
      taskCount: "6",
    }));

    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", {
      templateId: "builtin-maintenance",
      taskCount: 6,
      submitMode: "plan_only",
    });
  });

  it("gets a template by id", async () => {
    vi.mocked(quicksprintService.getTemplate).mockResolvedValue({ id: "t1" } as any);
    const result = await actions.handleQuicksprintAction(makeArgs("get_template", { projectId: "p1", templateId: "t1" }));
    expect(quicksprintService.getTemplate).toHaveBeenCalledWith("p1", "t1");
    expect(result.result).toEqual({ template: { id: "t1" } });
  });

  it("throws when a template is not found", async () => {
    vi.mocked(quicksprintService.getTemplate).mockResolvedValue(null as any);
    await expect(
      actions.handleQuicksprintAction(makeArgs("get_template", { projectId: "p1", templateId: "missing" })),
    ).rejects.toThrow(/Template not found: missing/);
  });

  it("creates a template including the optional fields", async () => {
    vi.mocked(quicksprintService.createCustomTemplate).mockResolvedValue({ id: "t1" } as any);
    await actions.handleQuicksprintAction(makeArgs("create_template", {
      projectId: "p1",
      name: "N",
      description: "D",
      icon: "I",
      category: "C",
      agentInstructionMarkdown: "MD",
      categoryColor: "#fff",
      defaultTaskCount: 3.9,
      agentPresetId: "preset-1",
    }));
    expect(quicksprintService.createCustomTemplate).toHaveBeenCalledWith("p1", {
      name: "N",
      description: "D",
      icon: "I",
      category: "C",
      agentInstructionMarkdown: "MD",
      categoryColor: "#fff",
      defaultTaskCount: 3,
      agentPresetId: "preset-1",
    });
  });

  it("rejects template creation that is missing required fields", async () => {
    await expect(
      actions.handleQuicksprintAction(makeArgs("create_template", { projectId: "p1", name: "N" })),
    ).rejects.toThrow(/description is required/);
  });

  it("updates a template with only the provided string and count fields", async () => {
    vi.mocked(quicksprintService.updateCustomTemplate).mockResolvedValue({ id: "t1" } as any);
    await actions.handleQuicksprintAction(makeArgs("update_template", {
      projectId: "p1",
      templateId: "t1",
      name: "New Name",
      description: "  ", // blank → ignored
      defaultTaskCount: 7,
    }));
    expect(quicksprintService.updateCustomTemplate).toHaveBeenCalledWith("p1", "t1", {
      name: "New Name",
      defaultTaskCount: 7,
    });
  });

  it("passes through all execution overrides and an explicit submit mode", async () => {
    vi.mocked(quicksprintService.executeQuicksprint).mockResolvedValue({ id: "s1" } as any);
    await actions.handleQuicksprintAction(makeArgs("execute", {
      projectId: "p1",
      templateId: "t1",
      submitMode: "plan_and_start",
      routeOverride: "route",
      modelOverride: "model",
      agentPresetId: "preset",
      additionalPrompt: "prompt",
      planningOverrides: { foo: "bar" },
    }));
    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", {
      templateId: "t1",
      taskCount: 5,
      submitMode: "plan_and_start",
      routeOverride: "route",
      modelOverride: "model",
      agentPresetId: "preset",
      additionalPrompt: "prompt",
      planningOverrides: { foo: "bar" },
    });
  });

  it("falls back to the default task count when the value is unparseable", async () => {
    vi.mocked(quicksprintService.executeQuicksprint).mockResolvedValue({ id: "s1" } as any);
    await actions.handleQuicksprintAction(makeArgs("execute", { projectId: "p1", templateId: "t1", taskCount: "not-a-number" }));
    expect(quicksprintService.executeQuicksprint).toHaveBeenCalledWith("p1", expect.objectContaining({ taskCount: 5 }));
  });

  it("throws for an unknown quicksprint action", async () => {
    await expect(
      actions.handleQuicksprintAction(makeArgs("frobnicate", { projectId: "p1" })),
    ).rejects.toThrow(/Unknown quicksprint action: frobnicate/);
  });
});
