import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTemplateRepository } from "../../../../src/infrastructure/repositories/file-template-repository.js";
import { InstructionRepository } from "../../../../src/instructions/instruction-template-repository.js";
import { GuideRepository } from "../../../../src/repositories/guide-repository.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

interface SearchRoots {
  repoRoot: string;
  cwdRoot: string;
  projectRoot: string;
  homeRoot: string;
}

const createFile = async (filePath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
};

const createSearchRoots = async (): Promise<SearchRoots> => {
  const baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-template-repository-"));
  tempDirs.push(baseDir);

  const roots: SearchRoots = {
    repoRoot: path.join(baseDir, "repo"),
    cwdRoot: path.join(baseDir, "cwd"),
    projectRoot: path.join(baseDir, "project"),
    homeRoot: path.join(baseDir, "home"),
  };

  await Promise.all(
    Object.values(roots).map(async (root) => {
      await fs.mkdir(root, { recursive: true });
    })
  );

  vi.spyOn(process, "cwd").mockReturnValue(roots.cwdRoot);
  process.env.HOME = roots.homeRoot;
  process.env.USERPROFILE = roots.homeRoot;

  return roots;
};

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map(async (dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("FileTemplateRepository", () => {
  it("prefers repoPath over cwd, project root, and home", async () => {
    const roots = await createSearchRoots();
    const repository = new FileTemplateRepository(roots.projectRoot, [path.join(".jules-subagents", "agents")]);

    await createFile(path.join(roots.homeRoot, ".jules-subagents", "agents", "worker.md"), "from-home");
    await createFile(path.join(roots.projectRoot, ".jules-subagents", "agents", "worker.md"), "from-project");
    await createFile(path.join(roots.cwdRoot, ".jules-subagents", "agents", "worker.md"), "from-cwd");
    await createFile(path.join(roots.repoRoot, ".jules-subagents", "agents", "worker.md"), "from-repo");

    await expect(repository.loadFile("worker.md", roots.repoRoot)).resolves.toBe("from-repo");
  });

  it("respects search directory order for compatibility fallbacks", async () => {
    const roots = await createSearchRoots();
    const repository = new FileTemplateRepository(roots.projectRoot, [
      path.join(".jules-subagents", "instructions"),
      path.join(".jules-subagents", "intructions"),
    ]);

    await createFile(
      path.join(roots.projectRoot, ".jules-subagents", "intructions", "sprint-main-loop", "guards", "branch-missing.md"),
      "from-legacy-directory"
    );

    await expect(repository.loadFile(path.join("sprint-main-loop", "guards", "branch-missing.md"))).resolves.toBe(
      "from-legacy-directory"
    );
  });

  it("throws a not-found error when no candidate path exists", async () => {
    const roots = await createSearchRoots();
    const repository = new FileTemplateRepository(roots.projectRoot, [path.join(".jules-subagents", "agents")]);

    await expect(repository.loadFile("missing.md", roots.repoRoot)).rejects.toThrow("Template file not found: missing.md");
  });
});

describe("repository integrations", () => {
  it("GuideRepository locates guides in standard candidate roots", async () => {
    const roots = await createSearchRoots();
    const repository = new GuideRepository(roots.projectRoot);

    await createFile(path.join(roots.cwdRoot, ".jules-subagents", "agents", "worker.md"), "guide-content");

    await expect(repository.getGuideContent("worker.md")).resolves.toBe("guide-content");
  });

  it("InstructionRepository supports the typo-tolerant intructions fallback", async () => {
    const roots = await createSearchRoots();
    const repository = new InstructionRepository(roots.projectRoot);
    const relativeTemplatePath = path.join("sprint-main-loop", "guards", "branch-missing.md");

    await createFile(
      path.join(roots.repoRoot, ".jules-subagents", "intructions", relativeTemplatePath),
      "legacy-instructions-content"
    );

    await expect(repository.loadInstruction(relativeTemplatePath, roots.repoRoot)).resolves.toBe("legacy-instructions-content");
  });
});
