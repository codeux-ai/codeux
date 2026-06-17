/**
 * IPC protocol between the main process and the dedicated command-spawner host process.
 *
 * Why a separate process: `child_process.spawn` performs `fork()` of the calling process inline on
 * the event-loop thread, and `fork()` cost scales with the process's resident memory. The main Code
 * UX process is large (~500MB+ under load), so the constant churn of short docker/git commands during
 * sprints stalled the event loop (every HTTP request, even 404s, queued behind it). The spawner host
 * is a small, freshly-forked Node process: it owns all child-process spawning, so the expensive
 * `fork()` happens from a tiny address space and entirely off the main process's event loop.
 *
 * env handling: the host inherits the main process's environment at fork time and caches it as a
 * base. Per job we only send a small diff (changed/added keys + keys to unset) so `process.send`
 * never has to JSON-serialize the entire (large) environment on the main thread for every command.
 */

export interface SpawnerCommandOptions {
  cwd?: string;
  /** Keys whose values differ from / are absent in the host's base env (captured at fork time). */
  envOverride?: Record<string, string>;
  /** Keys present in the host base env that must be removed for this job. */
  envUnset?: string[];
  /** When true the job's env is exactly the host base env (no diff needed). */
  useBaseEnv?: boolean;
  timeout?: number;
  stdinFile?: string;
  trimOutput?: boolean;
  maxStdoutChars?: number;
  maxStderrChars?: number;
  /** Whether the main side registered an onStdoutLine callback (host streams lines back if so). */
  streamStdoutLines?: boolean;
  streamStderrLines?: boolean;
}

export interface SpawnerRunMessage {
  type: "run";
  id: number;
  command: string;
  args: string[];
  options: SpawnerCommandOptions;
}

export interface SpawnerAbortMessage {
  type: "abort";
  id: number;
}

export type SpawnerRequest = SpawnerRunMessage | SpawnerAbortMessage;

export interface SpawnerLineMessage {
  type: "stdoutLine" | "stderrLine";
  id: number;
  line: string;
}

/**
 * Raw, unshaped result. trim/clip/container-path mapping is applied on the main side so all of that
 * (host-path-aware) logic stays in CommandRunner and the host stays a generic command executor.
 */
export interface SpawnerRawResult {
  code: number | null;
  stdout: string;
  stderr: string;
  stdoutClipped?: boolean;
  stderrClipped?: boolean;
  timedOut: boolean;
  aborted: boolean;
  /** Set when the child could not be spawned at all (e.g. ENOENT); becomes a failed CommandResult. */
  spawnError?: string;
}

export interface SpawnerResultMessage {
  type: "result";
  id: number;
  result: SpawnerRawResult;
}

export interface SpawnerReadyMessage {
  type: "ready";
}

export type SpawnerResponse = SpawnerLineMessage | SpawnerResultMessage | SpawnerReadyMessage;
