import * as fs from "fs/promises";
import * as path from "path";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";

export interface RuntimeProcessLockRecord {
  pid: number;
  projectRoot: string;
  startedAt: string;
}

export interface RuntimeProcessLockOptions {
  lockPath?: string;
  projectRoot: string;
  isProcessAlive?: (pid: number) => boolean;
}

export type RuntimeProcessLockRelease = () => Promise<void>;

export class RuntimeProcessLockError extends Error {
  constructor(
    message: string,
    readonly lockPath: string,
    readonly existing: RuntimeProcessLockRecord | null,
  ) {
    super(message);
    this.name = "RuntimeProcessLockError";
  }
}

export function defaultRuntimeProcessLockPath(): string {
  return getHomeCodeUxPath("runtime", "project-manager.lock");
}

export async function acquireRuntimeProcessLock(
  options: RuntimeProcessLockOptions,
): Promise<RuntimeProcessLockRelease> {
  if (process.env.CODE_UX_ALLOW_MULTIPLE_RUNTIMES === "1") {
    return async () => undefined;
  }

  const lockPath = options.lockPath ?? defaultRuntimeProcessLockPath();
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const record: RuntimeProcessLockRecord = {
    pid: process.pid,
    projectRoot: path.resolve(options.projectRoot),
    startedAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(lockPath), { recursive: true });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
      } finally {
        await handle.close();
      }
      return async () => releaseRuntimeProcessLock(lockPath, process.pid);
    } catch (error) {
      if (!isFileExistsError(error)) {
        throw error;
      }
    }

    const existing = await readLockRecord(lockPath);
    if (existing?.pid === process.pid) {
      return async () => undefined;
    }
    if (existing?.pid && isProcessAlive(existing.pid)) {
      throw new RuntimeProcessLockError(
        `Code UX project-manager runtime is already running (pid ${existing.pid}). Stop it before starting another runtime.`,
        lockPath,
        existing,
      );
    }

    await fs.rm(lockPath, { force: true });
  }

  throw new RuntimeProcessLockError(
    "Code UX project-manager runtime lock could not be acquired after removing a stale lock.",
    lockPath,
    null,
  );
}

async function releaseRuntimeProcessLock(lockPath: string, pid: number): Promise<void> {
  const existing = await readLockRecord(lockPath);
  if (!existing || existing.pid === pid) {
    await fs.rm(lockPath, { force: true });
  }
}

async function readLockRecord(lockPath: string): Promise<RuntimeProcessLockRecord | null> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<RuntimeProcessLockRecord>;
    if (typeof parsed.pid !== "number" || !Number.isInteger(parsed.pid) || parsed.pid <= 0) {
      return null;
    }
    return {
      pid: parsed.pid,
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : "",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

function isFileExistsError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "EEXIST";
}
