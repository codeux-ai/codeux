import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { QuicksprintService } from "../../../src/services/quicksprint-service.js";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../../../src/domain/quicksprint/quicksprint-catalog.js";
import type { CreateSprintInput, PlanSprintOptions, SprintRecord } from "../../../src/contracts/project-management-types.js";

vi.mock("fs/promises");
vi.mock("crypto", () => ({
  randomUUID: () => "mocked-uuid-123",
}));

describe("QuicksprintService", () => {
  let service: QuicksprintService;
  let createSprintMock: ReturnType<typeof vi.fn>;
  let planSprintMock: ReturnType<typeof vi.fn>;
  let loggerWarnMock: ReturnType<typeof vi.fn>;

  const projectId = "test-project-id";
  const projectBaseDirResolver = (id: string) => `/mocked/base/dir/${id}`;
  const templatesDir = path.join(`/mocked/base/dir/${projectId}`, ".code-ux", "quicksprints", "templates");
  const customTemplatePayload = {
    id: "qs-custom-template1",
    projectId,
    name: "Custom Template",
    description: "Custom description",
    icon: "Sparkles",
    category: "engineering",
    agentInstructionMarkdown: "Plan useful custom quicksprint work.",
    defaultTaskCount: 4,
    isBuiltIn: false,
  };
  const templateFileContent = (payload: typeof customTemplatePayload | {
    id: string;
    name: string;
    description?: string;
    agentInstructionMarkdown: string;
  }) => {
    const { agentInstructionMarkdown, ...metadata } = payload;
    return `---json\n${JSON.stringify(metadata, null, 2)}\n---\n${agentInstructionMarkdown}\n`;
  };

  beforeEach(() => {
    vi.resetAllMocks();

    (fs.mkdir as any).mockResolvedValue(undefined);
    (fs.stat as any).mockResolvedValue({ mtimeMs: 1000 });
    (fs.readdir as any).mockResolvedValue([]);
    (fs.readFile as any).mockResolvedValue("");
    (fs.writeFile as any).mockResolvedValue(undefined);
    (fs.unlink as any).mockResolvedValue(undefined);

    createSprintMock = vi.fn().mockImplementation((pId, input) => ({
      id: "mocked-sprint-id",
      projectId: pId,
      ...input,
    } as SprintRecord));

    planSprintMock = vi.fn().mockResolvedValue({ status: "accepted" });
    loggerWarnMock = vi.fn();

    service = new QuicksprintService(
      projectBaseDirResolver,
      createSprintMock,
      planSprintMock,
      undefined,
      { logger: { info: vi.fn(), warn: loggerWarnMock } },
    );
  });

  describe("listTemplates", () => {
    it("should return built-in templates and custom templates if present", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      const templates = await service.listTemplates(projectId);
      expect(templates.length).toBe(BUILTIN_QUICKSPRINT_TEMPLATES.length + 1);
      expect(templates.find(t => t.id === "qs-custom-template1")).toBeDefined();
    });

    it("should return cached result if mtimeMs is unchanged", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      // First call reads from disk
      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(1);

      // Second call should return cached result
      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(1); // Not called again

      // Update mtimeMs, should read from disk again
      (fs.stat as any).mockResolvedValue({ mtimeMs: 2000 });
      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });

    it("should safely handle errors reading templates directory", async () => {
      (fs.stat as any).mockRejectedValue(new Error("Permission denied"));

      const templates = await service.listTemplates(projectId);
      expect(templates.length).toBe(BUILTIN_QUICKSPRINT_TEMPLATES.length);
    });
  });

  describe("getTemplate", () => {
    it("should return a built-in template by id", async () => {
      const template = await service.getTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id);
      expect(template).toBeDefined();
      expect(template?.id).toBe(BUILTIN_QUICKSPRINT_TEMPLATES[0].id);
    });

    it("should return a custom template by id", async () => {
      (fs.readdir as any).mockResolvedValue(["qs-custom-test.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent({
        id: "qs-custom-test",
        name: "Test",
        agentInstructionMarkdown: "Plan test work.",
      }));

      const template = await service.getTemplate(projectId, "qs-custom-test");
      expect(template?.name).toBe("Test");
    });

    it("should return null if template not found", async () => {
      (fs.readFile as any).mockRejectedValue(new Error("ENOENT"));
      const template = await service.getTemplate(projectId, "non-existent-id");
      expect(template).toBeNull();
    });
  });

  describe("createCustomTemplate", () => {
    it("should write a new template to disk and return it", async () => {
      const input = {
        name: "My custom template",
        description: "Desc",
        icon: "Icon",
        category: "cat",
        agentInstructionMarkdown: "Markdown here",
      };

      const template = await service.createCustomTemplate(projectId, input);

      expect(template.id).toBe("qs-custom-mocked-uuid-123");
      expect(template.name).toBe(input.name);
      expect(template.isBuiltIn).toBe(false);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(templatesDir, `${template.id}.md`),
        expect.stringContaining("---json"),
        "utf8",
      );
    });

    it("should invalidate the cache", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(1);

      await service.createCustomTemplate(projectId, { name: "Test", agentInstructionMarkdown: "Test" });

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });
  });

  describe("updateCustomTemplate", () => {
    it("should update an existing custom template", async () => {
      (fs.readdir as any).mockResolvedValue(["qs-custom-123.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent({
        id: "qs-custom-123",
        name: "Old Name",
        description: "Old Desc",
        agentInstructionMarkdown: "Plan old work.",
      }));

      const input = {
        name: "New Name",
      };

      const template = await service.updateCustomTemplate(projectId, "qs-custom-123", input);

      expect(template.name).toBe("New Name");
      expect(template.description).toBe("Old Desc");
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should invalidate the cache", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(1);

      await service.updateCustomTemplate(projectId, "qs-custom-template1", { name: "Test" });

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });

    it("should throw if trying to update a built-in template", async () => {
      await expect(
        service.updateCustomTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id, { name: "test" })
      ).rejects.toThrowError(/Cannot update built-in templates/);
    });

    it("should throw if custom template not found", async () => {
      (fs.readFile as any).mockRejectedValue(new Error("ENOENT"));

      await expect(
        service.updateCustomTemplate(projectId, "qs-custom-123", { name: "test" })
      ).rejects.toThrowError(/not found/);
    });
  });

  describe("deleteCustomTemplate", () => {
    it("should unlink the file", async () => {
      await service.deleteCustomTemplate(projectId, "qs-custom-123");
      expect(fs.unlink).toHaveBeenCalled();
    });

    it("should invalidate the cache", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(1);

      await service.deleteCustomTemplate(projectId, "qs-custom-123");

      await service.listTemplates(projectId);
      expect(fs.readFile).toHaveBeenCalledTimes(2);
    });

    it("should throw if trying to delete a built-in template", async () => {
      await service.deleteCustomTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id);

      expect(fs.writeFile).toHaveBeenCalledWith(
        path.join(templatesDir, `${BUILTIN_QUICKSPRINT_TEMPLATES[0].id}.md`),
        expect.stringContaining('"hidden": true'),
        "utf8",
      );
    });

    it("should hide a built-in template when a project tombstone exists", async () => {
      const hiddenTemplateId = BUILTIN_QUICKSPRINT_TEMPLATES[0].id;
      (fs.readdir as any).mockResolvedValue([`${hiddenTemplateId}.md`]);
      (fs.readFile as any).mockResolvedValue(`---json\n${JSON.stringify({ id: hiddenTemplateId, hidden: true })}\n---\nHidden.\n`);

      const templates = await service.listTemplates(projectId);

      expect(templates.some((template) => template.id === hiddenTemplateId)).toBe(false);
    });
  });

  describe("executeQuicksprint", () => {
    it("should create and plan a sprint", async () => {
      const templateId = BUILTIN_QUICKSPRINT_TEMPLATES[0].id;
      const sprint = await service.executeQuicksprint(projectId, {
        templateId,
        taskCount: 3,
        submitMode: "plan_and_start",
        modelOverride: "gpt-4",
      });

      expect(createSprintMock).toHaveBeenCalledWith(projectId, {
        name: `QS: ${BUILTIN_QUICKSPRINT_TEMPLATES[0].name}`,
        goal: `${BUILTIN_QUICKSPRINT_TEMPLATES[0].agentInstructionMarkdown}\n\nProduce exactly 3 subtasks.`,
        showcasePinned: true,
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, sprint.id, {
        autoStart: true,
        replan: false,
        overrides: {
          virtualModel: "gpt-4",
        }
      }, undefined);
    });

    it("should still wait for planning before returning", async () => {
      let resolvePlanning: (() => void) | undefined;
      planSprintMock.mockReturnValueOnce(new Promise((resolve) => {
        resolvePlanning = () => resolve({ status: "accepted" });
      }));

      let returned = false;
      const promise = service.executeQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 3,
        submitMode: "plan_only",
      }).then(() => {
        returned = true;
      });

      await vi.waitFor(() => expect(planSprintMock).toHaveBeenCalledTimes(1));
      expect(returned).toBe(false);

      resolvePlanning?.();
      await promise;
      expect(returned).toBe(true);
    });

    it("should let the planner choose the number of subtasks when noTaskLimit is set", async () => {
      const templateId = BUILTIN_QUICKSPRINT_TEMPLATES[0].id;

      await service.executeQuicksprint(projectId, {
        templateId,
        taskCount: 3,
        noTaskLimit: true,
        submitMode: "plan_only",
      });

      expect(createSprintMock).toHaveBeenCalledWith(projectId, {
        name: `QS: ${BUILTIN_QUICKSPRINT_TEMPLATES[0].name}`,
        goal: `${BUILTIN_QUICKSPRINT_TEMPLATES[0].agentInstructionMarkdown}\n\nDecide the appropriate number of subtasks needed for full coverage. Do not impose an artificial cap.`,
        showcasePinned: true,
      });
    });

    it("should throw if template does not exist", async () => {
      (fs.readFile as any).mockRejectedValue(new Error("ENOENT"));
      await expect(
        service.executeQuicksprint(projectId, {
          templateId: "non-existent",
          taskCount: 1,
          submitMode: "plan_only",
        })
      ).rejects.toThrowError(/not found/);
    });
  });

  describe("launchDetachedQuicksprint", () => {
    it("should return the created sprint before planning finishes", async () => {
      planSprintMock.mockReturnValueOnce(new Promise(() => undefined));

      const result = await service.launchDetachedQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 2,
        submitMode: "plan_only",
      });

      expect(result.sprint.id).toBe("mocked-sprint-id");
      expect(result.planningRequest).toEqual({
        projectId,
        sprintId: "mocked-sprint-id",
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        submitMode: "plan_only",
        clientRequestId: "quicksprint:mocked-sprint-id:planning",
        planOptions: {
          autoStart: false,
          replan: false,
          clientRequestId: "quicksprint:mocked-sprint-id:planning",
          overrides: undefined,
        },
      });
      expect(result.planningPromise).toBeInstanceOf(Promise);
      expect(planSprintMock).toHaveBeenCalledWith(projectId, "mocked-sprint-id", {
        autoStart: false,
        replan: false,
        clientRequestId: "quicksprint:mocked-sprint-id:planning",
        overrides: undefined,
      });
    });

    it("should set autoStart for plan_and_start launches", async () => {
      await service.launchDetachedQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 2,
        submitMode: "plan_and_start",
        clientRequestId: "request-123",
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, "mocked-sprint-id", {
        autoStart: true,
        replan: false,
        clientRequestId: "request-123",
        overrides: undefined,
      });
    });

    it("should compose additionalPrompt into the same sprint goal used by awaited execution", async () => {
      const templateId = BUILTIN_QUICKSPRINT_TEMPLATES[0].id;
      const additionalPrompt = "Focus on API reliability.";

      await service.launchDetachedQuicksprint(projectId, {
        templateId,
        taskCount: 4,
        submitMode: "plan_only",
        additionalPrompt,
      });

      expect(createSprintMock).toHaveBeenCalledWith(projectId, {
        name: `QS: ${BUILTIN_QUICKSPRINT_TEMPLATES[0].name}`,
        goal: `${BUILTIN_QUICKSPRINT_TEMPLATES[0].agentInstructionMarkdown}\n\n## Additional Instructions\n\n${additionalPrompt}\n\nProduce exactly 4 subtasks.`,
        showcasePinned: true,
      });
    });

    it("should preserve planningOverrides and modelOverride precedence for detached planning", async () => {
      const planningOverrides = {
        virtualProvider: "codex",
        virtualModel: "gpt-5",
      } as const;

      await service.launchDetachedQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 2,
        submitMode: "plan_only",
        modelOverride: "ignored-model",
        planningOverrides,
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, "mocked-sprint-id", {
        autoStart: false,
        replan: false,
        clientRequestId: "quicksprint:mocked-sprint-id:planning",
        overrides: planningOverrides,
      });
    });

    it("should use modelOverride for detached planning when planningOverrides are absent", async () => {
      await service.launchDetachedQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 2,
        submitMode: "plan_only",
        modelOverride: "gpt-4.1",
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, "mocked-sprint-id", {
        autoStart: false,
        replan: false,
        clientRequestId: "quicksprint:mocked-sprint-id:planning",
        overrides: {
          virtualModel: "gpt-4.1",
        },
      });
    });

    it("should log detached planning failures without rejecting the launch", async () => {
      const planningError = new Error("Planning failed");
      planSprintMock.mockRejectedValueOnce(planningError);

      await expect(service.launchDetachedQuicksprint(projectId, {
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        taskCount: 2,
        submitMode: "plan_only",
      })).resolves.toMatchObject({
        sprint: { id: "mocked-sprint-id" },
      });

      await Promise.resolve();
      expect(loggerWarnMock).toHaveBeenCalledWith("Detached quicksprint planning failed", {
        error: planningError,
        projectId,
        sprintId: "mocked-sprint-id",
        templateId: BUILTIN_QUICKSPRINT_TEMPLATES[0].id,
        clientRequestId: "quicksprint:mocked-sprint-id:planning",
      });
    });
  });

  describe("Directory Creation", () => {
    it("should create directory if it doesn't exist", async () => {
      await service.listTemplates(projectId);
      expect(fs.mkdir).toHaveBeenCalledWith(
        templatesDir,
        { recursive: true }
      );
    });
  });

  describe("Error branches during read", () => {
    it("should ignore malformed template files in getTemplate", async () => {
      (fs.readFile as any).mockResolvedValue("invalid json");

      const template = await service.getTemplate(projectId, "qs-custom-invalid");
      expect(template).toBeNull();
    });

    it("should ignore unsupported files in listTemplates", async () => {
      (fs.readdir as any).mockResolvedValue(["template1.md", "notjson.txt"]);
      (fs.readFile as any).mockResolvedValue(templateFileContent(customTemplatePayload));

      const templates = await service.listTemplates(projectId);
      expect(templates.length).toBe(BUILTIN_QUICKSPRINT_TEMPLATES.length + 1);
    });

    it("should execute plan with modelOverride missing", async () => {
      const templateId = BUILTIN_QUICKSPRINT_TEMPLATES[0].id;
      const sprint = await service.executeQuicksprint(projectId, {
        templateId,
        taskCount: 3,
        submitMode: "plan_only",
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, sprint.id, {
        autoStart: false,
        replan: false,
        overrides: undefined,
      }, undefined);
    });
  });
});
