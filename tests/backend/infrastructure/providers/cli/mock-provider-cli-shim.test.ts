import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const SHIM_PATH = path.resolve(process.cwd(), "scripts/e2e/mock-provider-cli.mjs");

describe("mock provider CLI shim", () => {
  it("reads a large prompt from stdin when argv omits --prompt", async () => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "codeux-provider-shim-"));
    const prompt = `[mock-provider:write=stdin-result.txt]\n${"large context ".repeat(15_000)}`;
    try {
      const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
        const child = spawn(process.execPath, [SHIM_PATH, "--provider", "codex", "--model", "default"], {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
        });
        const stdout: Buffer[] = [];
        const stderr: Buffer[] = [];
        child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
        child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
        child.on("error", reject);
        child.on("close", (code) => resolve({
          code,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        }));
        child.stdin.end(prompt, "utf8");
      });

      expect(result.code).toBe(0);
      expect(result.stderr).toContain("provider=codex model=default");
      expect(result.stdout).toContain('"type":"turn.completed"');
      expect(await fs.readFile(path.join(cwd, "stdin-result.txt"), "utf8")).toContain("Code UX mock provider output");
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
