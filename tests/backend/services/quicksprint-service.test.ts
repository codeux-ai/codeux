import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { QuicksprintService } from "../../../src/services/quicksprint-service.js";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../../../src/domain/quicksprint/quicksprint-catalog.js";
import type { CreateSprintInput, PlanSprintOptions, SprintRecord } from "../../../src/contracts/project-management-types.js";

vi.mock("fs");
vi.mock("crypto", () => ({
  randomUUID: () => "mocked-uuid-123",
}));

describe("QuicksprintService", () => {
  let service: QuicksprintService;
  let createSprintMock: ReturnType<typeof vi.fn>;
  let planSprintMock: ReturnType<typeof vi.fn>;

  const projectId = "test-project-id";
  const projectBaseDirResolver = (id: string) => `/mocked/base/dir/${id}`;

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mock behavior for fs.existsSync to be true for dir
    (fs.existsSync as any).mockReturnValue(true);

    createSprintMock = vi.fn().mockImplementation((pId, input) => ({
      id: "mocked-sprint-id",
      projectId: pId,
      ...input,
    } as SprintRecord));

    planSprintMock = vi.fn().mockResolvedValue({ status: "accepted" });

    service = new QuicksprintService(projectBaseDirResolver, createSprintMock, planSprintMock);
  });

  describe("listTemplates", () => {
    it("should return built-in templates and custom templates if present", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["template1.json"]);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({
        id: "qs-custom-template1",
        projectId,
        name: "Custom Template",
        isBuiltIn: false,
      }));

      const templates = service.listTemplates(projectId);
      expect(templates.length).toBe(BUILTIN_QUICKSPRINT_TEMPLATES.length + 1);
      expect(templates.find(t => t.id === "qs-custom-template1")).toBeDefined();
    });

    it("should safely handle errors reading templates directory", () => {
      (fs.readdirSync as any).mockImplementation(() => { throw new Error("Permission denied"); });

      const templates = service.listTemplates(projectId);
      expect(templates.length).toBe(BUILTIN_QUICKSPRINT_TEMPLATES.length);
    });
  });

  describe("getTemplate", () => {
    it("should return a built-in template by id", () => {
      const template = service.getTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id);
      expect(template).toBeDefined();
      expect(template?.id).toBe(BUILTIN_QUICKSPRINT_TEMPLATES[0].id);
    });

    it("should return a custom template by id", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({
        id: "qs-custom-test",
        name: "Test",
      }));

      const template = service.getTemplate(projectId, "qs-custom-test");
      expect(template?.name).toBe("Test");
    });

    it("should return null if template not found", () => {
      (fs.existsSync as any).mockReturnValue(false);
      const template = service.getTemplate(projectId, "non-existent-id");
      expect(template).toBeNull();
    });
  });

  describe("createCustomTemplate", () => {
    it("should write a new template to disk and return it", () => {
      (fs.existsSync as any).mockReturnValue(true);

      const input = {
        name: "My custom template",
        description: "Desc",
        icon: "Icon",
        category: "cat",
        agentInstructionMarkdown: "Markdown here",
      };

      const template = service.createCustomTemplate(projectId, input);

      expect(template.id).toBe("qs-custom-mocked-uuid-123");
      expect(template.name).toBe(input.name);
      expect(template.isBuiltIn).toBe(false);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join(`/mocked/base/dir/${projectId}/.quicksprints`, `${template.id}.json`),
        expect.any(String)
      );
    });
  });

  describe("updateCustomTemplate", () => {
    it("should update an existing custom template", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({
        id: "qs-custom-123",
        name: "Old Name",
        description: "Old Desc",
      }));

      const input = {
        name: "New Name",
      };

      const template = service.updateCustomTemplate(projectId, "qs-custom-123", input);

      expect(template.name).toBe("New Name");
      expect(template.description).toBe("Old Desc");
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should throw if trying to update a built-in template", () => {
      expect(() => {
        service.updateCustomTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id, { name: "test" });
      }).toThrowError(/Cannot update built-in templates/);
    });

    it("should throw if custom template not found", () => {
      (fs.existsSync as any).mockReturnValue(false); // Make getQuicksprintsDir happy somehow, actually getQuicksprintsDir creates if false but let's see.
      // The updateCustomTemplate checks if the specific file exists.

      // Let's mock existsSync carefully
      (fs.existsSync as any).mockImplementation((pathStr: string) => {
        if (pathStr.endsWith(".json")) return false; // File doesn't exist
        return true; // Dir exists
      });

      expect(() => {
        service.updateCustomTemplate(projectId, "qs-custom-123", { name: "test" });
      }).toThrowError(/not found/);
    });
  });

  describe("deleteCustomTemplate", () => {
    it("should unlink the file", () => {
      (fs.existsSync as any).mockReturnValue(true);
      service.deleteCustomTemplate(projectId, "qs-custom-123");
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("should throw if trying to delete a built-in template", () => {
      expect(() => {
        service.deleteCustomTemplate(projectId, BUILTIN_QUICKSPRINT_TEMPLATES[0].id);
      }).toThrowError(/Cannot delete built-in templates/);
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
      });

      expect(planSprintMock).toHaveBeenCalledWith(projectId, sprint.id, {
        autoStart: true,
        replan: false,
        overrides: {
          virtualModel: "gpt-4",
        }
      });
    });

    it("should throw if template does not exist", async () => {
      (fs.existsSync as any).mockReturnValue(false);
      await expect(
        service.executeQuicksprint(projectId, {
          templateId: "non-existent",
          taskCount: 1,
          submitMode: "plan_only",
        })
      ).rejects.toThrowError(/not found/);
    });
  });
  describe("Directory Creation", () => {
    it("should create directory if it doesn't exist", () => {
      (fs.existsSync as any).mockImplementation((pathStr: string) => {
        if (pathStr.includes(".quicksprints")) return false;
        return true;
      });

      service.listTemplates(projectId);
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        path.join(`/mocked/base/dir/${projectId}`, ".quicksprints"),
        { recursive: true }
      );
    });
  });

  describe("Error branches during read", () => {
    it("should ignore JSON parse errors in getTemplate", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue("invalid json");

      const template = service.getTemplate(projectId, "qs-custom-invalid");
      expect(template).toBeNull();
    });

    it("should ignore non-JSON files in listTemplates", () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue(["template1.json", "notjson.txt"]);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify({
        id: "qs-custom-template1",
        projectId,
        name: "Custom Template",
        isBuiltIn: false,
      }));

      const templates = service.listTemplates(projectId);
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
      });
    });
  });
});
