/**
 * Command-spawner host process. Forked once by {@link CommandSpawnerClient}; receives run/abort
 * requests over IPC, spawns the actual child processes here (so `fork()` happens from this small
 * address space and off the main process's event loop), streams output lines back, and returns a
 * raw result. See command-spawner-protocol.ts for the rationale and message shapes.
 */
import { spawn, type ChildProcess } from "child_process";
import { createReadStream } from "fs";
import type {
  SpawnerRequest,
  SpawnerRunMessage,
  SpawnerRawResult,
} from "./command-spawner-protocol.js";

const KILL_GRACE_MS = 2_000;

// Environment inherited from the main process at fork time. Per-job env is reconstructed by applying
// the small diff the main side sends, so the full environment never has to cross the IPC channel.
const baseEnv: NodeJS.ProcessEnv = { ...process.env };

interface JobControl {
  child: ChildProcess;
  /** Set when the main side requested an abort, so the close handler reports it as aborted. */
  aborted: boolean;
}

const activeJobs = new Map<number, JobControl>();

function send(message: unknown): void {
  process.send?.(message);
}

function buildJobEnv(options: SpawnerRunMessage["options"]): NodeJS.ProcessEnv {
  if (options.useBaseEnv) {
    return baseEnv;
  }
  const env: NodeJS.ProcessEnv = { ...baseEnv };
  if (options.envOverride) {
    for (const [key, value] of Object.entries(options.envOverride)) {
      env[key] = value;
    }
  }
  if (options.envUnset) {
    for (const key of options.envUnset) {
      delete env[key];
    }
  }
  return env;
}

function runJob(message: SpawnerRunMessage): void {
  const { id, command, args, options } = message;

  let child: ChildProcess;
  try {
    child = spawn(command, args, {
      cwd: options.cwd,
      env: buildJobEnv(options),
      stdio: [options.stdinFile ? "pipe" : "ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const result: SpawnerRawResult = {
      code: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      aborted: false,
      spawnError: error instanceof Error ? error.message : String(error),
    };
    send({ type: "result", id, result });
    return;
  }

  const control: JobControl = { child, aborted: false };
  activeJobs.set(id, control);

  let stdout = "";
  let stderr = "";
  let stdoutLineBuffer = "";
  let stderrLineBuffer = "";
  let stdoutClipped = false;
  let stderrClipped = false;
  let timedOut = false;
  let settled = false;
  let killTimer: NodeJS.Timeout | null = null;

  const timer = options.timeout
    ? setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (!settled) {
            child.kill("SIGKILL");
          }
        }, KILL_GRACE_MS);
      }, options.timeout)
    : null;

  const flushLineBuffer = (buffer: string, stream: "stdoutLine" | "stderrLine"): void => {
    const trimmed = buffer.trim();
    if (trimmed.length > 0) {
      send({ type: stream, id, line: trimmed });
    }
  };

  const handleData = (
    data: Buffer,
    appendTo: "stdout" | "stderr",
    stream: "stdoutLine" | "stderrLine",
    streamLines: boolean | undefined,
  ): void => {
    const text = data.toString();
    if (appendTo === "stdout") {
      stdout += text;
      if (options.maxStdoutChars !== undefined && stdout.length > options.maxStdoutChars) {
        stdout = stdout.slice(-options.maxStdoutChars);
        stdoutClipped = true;
      }
    } else {
      stderr += text;
      if (options.maxStderrChars !== undefined && stderr.length > options.maxStderrChars) {
        stderr = stderr.slice(-options.maxStderrChars);
        stderrClipped = true;
      }
    }
    if (!streamLines) {
      return;
    }
    let pending = (appendTo === "stdout" ? stdoutLineBuffer : stderrLineBuffer) + text;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    if (appendTo === "stdout") {
      stdoutLineBuffer = pending;
    } else {
      stderrLineBuffer = pending;
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0) {
        send({ type: stream, id, line: trimmed });
      }
    }
  };

  child.stdout?.on("data", (data: Buffer) => handleData(data, "stdout", "stdoutLine", options.streamStdoutLines));
  child.stderr?.on("data", (data: Buffer) => handleData(data, "stderr", "stderrLine", options.streamStderrLines));

  const finish = (result: SpawnerRawResult): void => {
    if (stdoutClipped) result.stdoutClipped = true;
    if (stderrClipped) result.stderrClipped = true;
    if (settled) {
      return;
    }
    settled = true;
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    activeJobs.delete(id);
    send({ type: "result", id, result });
  };

  child.on("error", (error: Error) => {
    finish({
      code: null,
      stdout,
      stderr,
      timedOut,
      aborted: control.aborted,
      spawnError: error.message,
    });
  });

  child.on("close", (code: number | null) => {
    if (options.streamStdoutLines) flushLineBuffer(stdoutLineBuffer, "stdoutLine");
    if (options.streamStderrLines) flushLineBuffer(stderrLineBuffer, "stderrLine");
    finish({ code, stdout, stderr, timedOut, aborted: control.aborted });
  });

  if (options.stdinFile) {
    const stdinStream = createReadStream(options.stdinFile);
    stdinStream.on("error", (error: Error) => {
      child.kill("SIGTERM");
      finish({ code: null, stdout, stderr, timedOut, aborted: control.aborted, spawnError: error.message });
    });
    child.stdin?.on("error", () => {
      // The child may exit before consuming all input; the close handler reports the result.
    });
    if (child.stdin) {
      stdinStream.pipe(child.stdin);
    } else {
      finish({ code: null, stdout, stderr, timedOut, aborted: control.aborted, spawnError: "Command stdin is unavailable" });
    }
  }
}

function abortJob(id: number): void {
  const control = activeJobs.get(id);
  if (!control) {
    return;
  }
  control.aborted = true;
  control.child.kill("SIGTERM");
  setTimeout(() => {
    if (activeJobs.has(id)) {
      control.child.kill("SIGKILL");
    }
  }, KILL_GRACE_MS);
}

process.on("message", (message: SpawnerRequest) => {
  if (!message || typeof message !== "object") {
    return;
  }
  if (message.type === "run") {
    runJob(message);
  } else if (message.type === "abort") {
    abortJob(message.id);
  }
});

// If the IPC channel drops (main process gone), there is nothing left to serve — exit so we don't
// leak an orphaned host with detached children.
process.on("disconnect", () => {
  for (const control of activeJobs.values()) {
    control.child.kill("SIGTERM");
  }
  process.exit(0);
});

send({ type: "ready" });
