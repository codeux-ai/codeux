import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  acquireRuntimeProcessLock,
  RuntimeProcessLockError,
} from "../../../src/services/runtime-process-lock.js";

describe("runtime process lock", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  async function createLockPath(): Promise<string> {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-runtime-lock-"));
    return path.join(tempDir, "runtime", "project-manager.lock");
  }

  it("creates and releases the project-manager lock", async () => {
    const lockPath = await createLockPath();

    const release = await acquireRuntimeProcessLock({
      lockPath,
      projectRoot: process.cwd(),
      isProcessAlive: () => false,
    });

    const raw = await fs.readFile(lockPath, "utf8");
    expect(JSON.parse(raw)).toEqual(expect.objectContaining({
      pid: process.pid,
      projectRoot: path.resolve(process.cwd()),
    }));

    await release();

    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects startup when another recorded runtime pid is still alive", async () => {
    const lockPath = await createLockPath();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 12345,
      projectRoot: "/tmp/live-runtime",
      startedAt: "2026-07-05T00:00:00.000Z",
    }));

    await expect(acquireRuntimeProcessLock({
      lockPath,
      projectRoot: process.cwd(),
      isProcessAlive: (pid) => pid === 12345,
    })).rejects.toBeInstanceOf(RuntimeProcessLockError);

    const raw = await fs.readFile(lockPath, "utf8");
    expect(JSON.parse(raw).pid).toBe(12345);
  });

  it("replaces a stale lock when the recorded pid is gone", async () => {
    const lockPath = await createLockPath();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, JSON.stringify({
      pid: 12345,
      projectRoot: "/tmp/stale-runtime",
      startedAt: "2026-07-05T00:00:00.000Z",
    }));

    const release = await acquireRuntimeProcessLock({
      lockPath,
      projectRoot: process.cwd(),
      isProcessAlive: () => false,
    });

    const raw = await fs.readFile(lockPath, "utf8");
    expect(JSON.parse(raw).pid).toBe(process.pid);

    await release();
  });

  it("replaces a malformed stale lock", async () => {
    const lockPath = await createLockPath();
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "not-json");

    const release = await acquireRuntimeProcessLock({
      lockPath,
      projectRoot: process.cwd(),
      isProcessAlive: () => true,
    });

    const raw = await fs.readFile(lockPath, "utf8");
    expect(JSON.parse(raw).pid).toBe(process.pid);

    await release();
  });
});
