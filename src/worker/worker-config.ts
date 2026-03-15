import os from "os";
import * as path from "path";
import { fileURLToPath } from "url";

export interface WorkerConfig {
  connectionKey: string;
  displayName: string;
  projectId?: string;
  projectIds?: string[];
  activeProjectIds?: string[];
  sprintId?: string;
  listenTimeoutSeconds: number;
  listenPollIntervalMs: number;
  dispatchPollIntervalMs: number;
  sessionPollIntervalMs: number;
  controlPlaneUrl?: string;
  controlPlaneAuthToken?: string;
  serverCommand: string;
  serverArgs: string[];
  serverCwd?: string;
}

const DEFAULT_DISPATCH_POLL_INTERVAL_MS = 5_000;
const DEFAULT_SESSION_POLL_INTERVAL_MS = 10_000;
const DEFAULT_LISTEN_TIMEOUT_SECONDS = 30;
const DEFAULT_LISTEN_POLL_INTERVAL_MS = 1_000;

const parseStringFlag = (argv: string[], flagName: string): string | null => {
  const args = argv.slice(2);
  const inlineArg = args.find((arg) => arg.startsWith(`${flagName}=`));
  if (inlineArg) {
    return inlineArg.slice(flagName.length + 1) || null;
  }

  const index = args.indexOf(flagName);
  if (index !== -1 && args[index + 1] && !args[index + 1].startsWith("-")) {
    return args[index + 1];
  }

  return null;
};

const parseRepeatedStringFlag = (argv: string[], flagName: string): string[] => {
  const args = argv.slice(2);
  const values: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith(`${flagName}=`)) {
      values.push(arg.slice(flagName.length + 1));
      continue;
    }
    if (arg === flagName && args[index + 1] && !args[index + 1].startsWith("-")) {
      values.push(args[index + 1]);
      index += 1;
    }
  }

  return values.filter((value) => value.trim().length > 0);
};

const parseIntegerFlag = (argv: string[], flagName: string, fallback: number): number => {
  const value = parseStringFlag(argv, flagName);
  const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

function resolveDefaultServerArgs(): { command: string; args: string[] } {
  const filename = fileURLToPath(import.meta.url);
  const dirname = path.dirname(filename);
  const serverEntry = path.resolve(dirname, "..", "index.js");

  return {
    command: process.execPath,
    args: [serverEntry, "--runtime-role", "worker-host"],
  };
}

export function loadWorkerConfig(argv: string[] = process.argv): WorkerConfig {
  const defaultServer = resolveDefaultServerArgs();
  const connectionKey = parseStringFlag(argv, "--connection-key")?.trim()
    || `worker:${os.hostname()}:${process.pid}`;
  const displayName = parseStringFlag(argv, "--display-name")?.trim()
    || `Sprint OS Worker ${os.hostname()}`;
  const serverArgs = parseRepeatedStringFlag(argv, "--server-arg");

  return {
    connectionKey,
    displayName,
    projectId: parseStringFlag(argv, "--project-id")?.trim() || undefined,
    projectIds: parseRepeatedStringFlag(argv, "--project-id"),
    activeProjectIds: parseRepeatedStringFlag(argv, "--active-project-id"),
    sprintId: parseStringFlag(argv, "--sprint-id")?.trim() || undefined,
    listenTimeoutSeconds: parseIntegerFlag(argv, "--listen-timeout-seconds", DEFAULT_LISTEN_TIMEOUT_SECONDS),
    listenPollIntervalMs: parseIntegerFlag(argv, "--listen-poll-interval-ms", DEFAULT_LISTEN_POLL_INTERVAL_MS),
    dispatchPollIntervalMs: parseIntegerFlag(argv, "--dispatch-poll-interval-ms", DEFAULT_DISPATCH_POLL_INTERVAL_MS),
    sessionPollIntervalMs: parseIntegerFlag(argv, "--session-poll-interval-ms", DEFAULT_SESSION_POLL_INTERVAL_MS),
    controlPlaneUrl: parseStringFlag(argv, "--server-url")?.trim() || undefined,
    controlPlaneAuthToken: parseStringFlag(argv, "--auth-token")?.trim()
      || process.env.MCP_HTTP_AUTH_TOKEN?.trim()
      || undefined,
    serverCommand: parseStringFlag(argv, "--server-command")?.trim() || defaultServer.command,
    serverArgs: serverArgs.length > 0 ? serverArgs : defaultServer.args,
    serverCwd: parseStringFlag(argv, "--server-cwd")?.trim() || undefined,
  };
}
