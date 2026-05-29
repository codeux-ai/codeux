import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InstructionFileService } from "../../../src/services/instruction-file-service.js";
import type { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(): Promise<{ service: InstructionFileService; baseDir: string }> {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), "instruction-files-"));
  tmpDirs.push(baseDir);
  const repo = {
    getProject: (projectId: string) =>
      projectId === "p1" ? ({ id: "p1", baseDir } as { id: string; baseDir: string }) : null,
  } as unknown as ProjectManagementRepository;
  const service = new InstructionFileService({ projectManagementRepository: repo });
  return { service, baseDir };
}

describe("InstructionFileService", () => {
  it("lists the catalogue and reports which files exist", async () => {
    const { service, baseDir } = await createService();
    await writeFile(path.join(baseDir, "CLAUDE.md"), "# Claude\n", "utf8");

    const files = await service.listInstructionFiles("p1");
    const byId = Object.fromEntries(files.map((f) => [f.id, f]));

    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(byId.claude.exists).toBe(true);
    expect(byId.claude.size).toBeGreaterThan(0);
    expect(byId.gemini.exists).toBe(false);
    expect(byId.copilot.relativePath).toBe(".github/copilot-instructions.md");
  });

  it("detects existing files written with a different case via aliases", async () => {
    const { service, baseDir } = await createService();
    await writeFile(path.join(baseDir, "gemini.md"), "lower", "utf8");

    const read = await service.readInstructionFile("p1", "gemini");
    expect(read.exists).toBe(true);
    expect(read.content).toBe("lower");
    expect(read.relativePath).toBe("gemini.md");
  });

  it("returns empty content for a file that does not exist yet", async () => {
    const { service } = await createService();
    const read = await service.readInstructionFile("p1", "agents");
    expect(read.exists).toBe(false);
    expect(read.content).toBe("");
  });

  it("creates the canonical file on write, including nested directories", async () => {
    const { service, baseDir } = await createService();

    const saved = await service.writeInstructionFile("p1", "copilot", "# Copilot rules\n");
    expect(saved.exists).toBe(true);
    expect(saved.content).toBe("# Copilot rules\n");

    const onDisk = await readFile(path.join(baseDir, ".github", "copilot-instructions.md"), "utf8");
    expect(onDisk).toBe("# Copilot rules\n");
  });

  it("overwrites the existing alias file rather than creating a duplicate", async () => {
    const { service, baseDir } = await createService();
    await writeFile(path.join(baseDir, "claude.md"), "old", "utf8");

    const saved = await service.writeInstructionFile("p1", "claude", "new");
    expect(saved.relativePath).toBe("claude.md");
    expect(await readFile(path.join(baseDir, "claude.md"), "utf8")).toBe("new");
  });

  it("rejects unknown file ids", async () => {
    const { service } = await createService();
    await expect(service.readInstructionFile("p1", "../secrets")).rejects.toThrow(/Unknown instruction file/);
  });

  it("rejects projects without a base directory", async () => {
    const { service } = await createService();
    await expect(service.listInstructionFiles("missing")).rejects.toThrow(/not found/);
  });

  it("rejects content over the size ceiling", async () => {
    const { service } = await createService();
    const huge = "x".repeat(1_000_001);
    await expect(service.writeInstructionFile("p1", "agents", huge)).rejects.toThrow(/byte limit/);
  });

  // Ensure mkdir is exercised for nested paths even when the dir pre-exists.
  it("writes a top-level file when its directory already exists", async () => {
    const { service, baseDir } = await createService();
    await mkdir(path.join(baseDir, ".github"), { recursive: true });
    const saved = await service.writeInstructionFile("p1", "agents", "hello");
    expect(saved.exists).toBe(true);
    expect(await readFile(path.join(baseDir, "AGENTS.md"), "utf8")).toBe("hello");
  });
});
