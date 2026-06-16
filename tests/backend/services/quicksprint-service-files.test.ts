import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { QuicksprintService } from "../../../src/services/quicksprint-service.js";
import { formatQuicksprintTemplateMarkdown } from "../../../src/domain/quicksprint/quicksprint-template-markdown.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

const template = (input: { id: string; name: string; instruction?: string }) => ({
  id: input.id,
  projectId: null,
  name: input.name,
  description: `${input.name} description`,
  icon: "Sparkles",
  category: "engineering",
  categoryColor: "#22c55e",
  agentInstructionMarkdown: input.instruction || `Plan ${input.name}.`,
  defaultTaskCount: 4,
  isBuiltIn: true,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
});

async function writeTemplate(root: string, input: { id: string; name: string; instruction?: string }): Promise<void> {
  const dir = path.join(root, ".code-ux", "quicksprints", "templates");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${input.id}.md`), formatQuicksprintTemplateMarkdown(template(input)), "utf8");
}

describe("QuicksprintService file-backed templates", () => {
  beforeEach(async () => {
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-qs-home-"));
    tempDirs.push(homeDir);
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
  });

  afterEach(async () => {
    process.env.HOME = originalHome;
    if (originalUserProfile === undefined) {
      delete process.env.USERPROFILE;
    } else {
      process.env.USERPROFILE = originalUserProfile;
    }
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("resolves templates from project, home, and bundled default directories by precedence", async () => {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-qs-root-"));
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-qs-repo-"));
    tempDirs.push(projectRoot, repoRoot);

    await writeTemplate(projectRoot, { id: "qs-shared", name: "Default Shared" });
    await writeTemplate(projectRoot, { id: "qs-default-only", name: "Default Only" });
    await writeTemplate(os.homedir(), { id: "qs-shared", name: "Home Shared" });
    await writeTemplate(os.homedir(), { id: "qs-home-only", name: "Home Only" });
    await writeTemplate(repoRoot, { id: "qs-shared", name: "Project Shared" });
    await writeTemplate(repoRoot, { id: "qs-project-only", name: "Project Only" });

    const service = new QuicksprintService(
      () => repoRoot,
      (_projectId, input) => ({ id: "sprint-1", projectId: "project-1", ...input } as any),
      async () => undefined,
      undefined,
      { projectRoot },
    );

    const templates = await service.listTemplates("project-1");
    const byId = new Map(templates.map((item) => [item.id, item]));

    expect(byId.get("qs-shared")?.name).toBe("Project Shared");
    expect(byId.get("qs-shared")?.isBuiltIn).toBe(false);
    expect(byId.get("qs-home-only")?.name).toBe("Home Only");
    expect(byId.get("qs-home-only")?.isBuiltIn).toBe(true);
    expect(byId.get("qs-default-only")?.name).toBe("Default Only");
    expect(byId.get("qs-default-only")?.isBuiltIn).toBe(true);
    expect(byId.get("qs-project-only")?.projectId).toBe("project-1");
  });

  it("ignores JSON files in quicksprint template directories", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-qs-json-ignored-"));
    tempDirs.push(repoRoot);
    const dir = path.join(repoRoot, ".code-ux", "quicksprints", "templates");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "qs-json-only.json"), JSON.stringify(template({
      id: "qs-json-only",
      name: "JSON Only",
    })), "utf8");

    const service = new QuicksprintService(
      () => repoRoot,
      (_projectId, input) => ({ id: "sprint-1", projectId: "project-1", ...input } as any),
      async () => undefined,
    );

    const resolved = await service.getTemplate("project-1", "qs-json-only");
    expect(resolved).toBeNull();
  });

  it("writes custom templates to project .code-ux quicksprint templates", async () => {
    const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-qs-write-"));
    tempDirs.push(repoRoot);
    const service = new QuicksprintService(
      () => repoRoot,
      (_projectId, input) => ({ id: "sprint-1", projectId: "project-1", ...input } as any),
      async () => undefined,
    );

    const created = await service.createCustomTemplate("project-1", {
      name: "Custom Review",
      description: "Custom review template",
      icon: "Sparkles",
      category: "engineering",
      agentInstructionMarkdown: "Plan custom review work.",
    });

    const filePath = path.join(repoRoot, ".code-ux", "quicksprints", "templates", `${created.id}.md`);
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("Custom Review");
    await expect(fs.readFile(filePath, "utf8")).resolves.toContain("Plan custom review work.");
  });
});
