import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InstructionRepository } from "../../../../src/instructions/instruction-template-repository.js";
import { FileTemplateRepository } from "../../../../src/infrastructure/repositories/file-template-repository.js";
import { GuideRepository } from "../../../../src/repositories/guide-repository.js";

const tempDirs: string[] = [];
const originalHomeEnv = process.env.HOME;

async function createTempDirectory(prefix: string): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(tempDir);
  return tempDir;
}

async function writeFixture(root: string, relativeDirectory: string, name: string, content: string): Promise<void> {
  const filePath = path.join(root, relativeDirectory, name);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalHomeEnv === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHomeEnv;
  }
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("FileTemplateRepository", () => {
  it("resolves templates with Repo > CWD > Project > Home precedence", async () => {
    const sandbox = await createTempDirectory("file-template-repository-");
    const repoRoot = path.join(sandbox, "repo");
    const cwdRoot = path.join(sandbox, "cwd");
    const projectRoot = path.join(sandbox, "project");
    const homeRoot = path.join(sandbox, "home");

    const relativeDirectory = path.join(".jules-subagents", "agents");
    const fileName = "worker.md";

    await writeFixture(homeRoot, relativeDirectory, fileName, "home");
    await writeFixture(projectRoot, relativeDirectory, fileName, "project");
    await writeFixture(cwdRoot, relativeDirectory, fileName, "cwd");
    await writeFixture(repoRoot, relativeDirectory, fileName, "repo");

    process.env.HOME = homeRoot;
    vi.spyOn(process, "cwd").mockReturnValue(cwdRoot);

    const repository = new FileTemplateRepository(projectRoot, [relativeDirectory]);

    await expect(repository.loadFile(fileName, repoRoot)).resolves.toBe("repo");
    await expect(repository.loadFile(fileName)).resolves.toBe("cwd");

    await fs.rm(path.join(cwdRoot, relativeDirectory), { recursive: true, force: true });
    await expect(repository.loadFile(fileName)).resolves.toBe("project");

    await fs.rm(path.join(projectRoot, relativeDirectory), { recursive: true, force: true });
    await expect(repository.loadFile(fileName)).resolves.toBe("home");
  });

  it("supports typo-tolerant directory candidates within each root", async () => {
    const sandbox = await createTempDirectory("file-template-repository-");
    const repoRoot = path.join(sandbox, "repo");
    const cwdRoot = path.join(sandbox, "cwd");
    const projectRoot = path.join(sandbox, "project");
    const homeRoot = path.join(sandbox, "home");
    const relativeInstructionPath = path.join("sprint-main-loop", "guards", "branch-missing.md");

    process.env.HOME = homeRoot;
    vi.spyOn(process, "cwd").mockReturnValue(cwdRoot);

    const repository = new FileTemplateRepository(projectRoot, [
      path.join(".jules-subagents", "instructions"),
      path.join(".jules-subagents", "intructions"),
    ]);

    await writeFixture(cwdRoot, path.join(".jules-subagents", "intructions"), relativeInstructionPath, "legacy typo");
    await expect(repository.loadFile(relativeInstructionPath, repoRoot)).resolves.toBe("legacy typo");

    await writeFixture(cwdRoot, path.join(".jules-subagents", "instructions"), relativeInstructionPath, "canonical");
    await expect(repository.loadFile(relativeInstructionPath, repoRoot)).resolves.toBe("canonical");
  });
});

describe("Repository adapters", () => {
  it("loads guides through the shared file template repository", async () => {
    const sandbox = await createTempDirectory("guide-repository-");
    const repoRoot = path.join(sandbox, "repo");
    const projectRoot = path.join(sandbox, "project");
    const guideName = "worker.md";

    await writeFixture(repoRoot, path.join(".jules-subagents", "agents"), guideName, "Guide Content");

    const repository = new GuideRepository(projectRoot);
    await expect(repository.getGuideContent(guideName, repoRoot)).resolves.toBe("Guide Content");
  });

  it("loads instruction templates from both instructions and intructions directories", async () => {
    const sandbox = await createTempDirectory("instruction-repository-");
    const repoRoot = path.join(sandbox, "repo");
    const projectRoot = path.join(sandbox, "project");
    const instructionPath = path.join("sprint-main-loop", "guards", "planning-missing.md");

    await writeFixture(repoRoot, path.join(".jules-subagents", "intructions"), instructionPath, "Typo fallback");

    const repository = new InstructionRepository(projectRoot);
    await expect(repository.loadInstruction(instructionPath, repoRoot)).resolves.toBe("Typo fallback");
  });
});
