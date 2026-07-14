#!/usr/bin/env node
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { TaskRunState, WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { WorkerEndpointRecord } from "../contracts/worker-types.js";
import { loadWorkerConfig, type WorkerConfig } from "./worker-config.js";

type WorkerUpdateState = Extract<TaskRunState, "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "QUOTA">;

export interface WorkerRegistrationResult {
  endpoint?: WorkerEndpointRecord;
}

export interface WorkerDispatchUpdateResult {
  controlAction: "cancel" | null;
  dispatch?: WorkerTaskDispatchClaim["dispatch"];
}

export interface LocalWorkerSession {
  id: string;
  name?: string | null;
  provider?: string | null;
  state?: TaskRunState | string | null;
  workerBranch?: string | null;
  prUrl?: string | null;
  summaryMarkdown?: string | null;
  errorMessage?: string | null;
}

export interface WorkerControlPlaneClient {
  registerWorker(config: WorkerConfig): Promise<WorkerRegistrationResult>;
  pullTaskDispatch(args: { connectionKey: string; projectId?: string; sprintId?: string }): Promise<WorkerTaskDispatchClaim | null>;
  updateTaskDispatch(args: {
    connectionKey: string;
    dispatchId: string;
    leaseToken: string;
    state: WorkerUpdateState;
    provider?: string;
    sessionId?: string;
    sessionName?: string;
    workerBranch?: string;
    prUrl?: string;
    summaryMarkdown?: string;
    errorMessage?: string;
  }): Promise<WorkerDispatchUpdateResult>;
  close?(): Promise<void>;
}

export interface LocalWorkerExecutionClient {
  executeWorkerDispatch(claim: WorkerTaskDispatchClaim): Promise<LocalWorkerSession>;
  getSession(sessionId: string): Promise<LocalWorkerSession | null>;
  cancelLocalDispatch(dispatchId: string, reason: string): Promise<void>;
  close?(): Promise<void>;
}

export interface WorkerClientLogger {
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
  debug?(message: string, metadata?: Record<string, unknown>): void;
}

export interface RunWorkerClientOptions {
  controlPlaneClient?: WorkerControlPlaneClient;
  localClient?: LocalWorkerExecutionClient;
  sleep?: (ms: number) => Promise<void>;
  logger?: WorkerClientLogger;
  signal?: AbortSignal;
  maxIterations?: number;
  maxRetryAttempts?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
}

interface ToolClient {
  callTool(args: { name: string; arguments?: Record<string, unknown> }): Promise<unknown>;
  close?(): Promise<void>;
}

const TERMINAL_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const consoleLogger: WorkerClientLogger = {
  info: (message, metadata) => console.log(message, metadata ? sanitizeLogMetadata(metadata) : ""),
  warn: (message, metadata) => console.warn(message, metadata ? sanitizeLogMetadata(metadata) : ""),
  error: (message, metadata) => console.error(message, metadata ? sanitizeLogMetadata(metadata) : ""),
  debug: () => undefined,
};

function sanitizeLogMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    sanitized[key] = key.toLowerCase().includes("token") || key.toLowerCase().includes("secret")
      ? "[REDACTED]"
      : value;
  }
  return sanitized;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readToolPayload(result: unknown): unknown {
  if (!isObjectRecord(result)) {
    return result;
  }
  const content = result.content;
  if (!Array.isArray(content)) {
    return result;
  }
  const firstText = content.find((entry) =>
    isObjectRecord(entry) && entry.type === "text" && typeof entry.text === "string"
  ) as { text: string } | undefined;
  if (!firstText) {
    return result;
  }
  try {
    return JSON.parse(firstText.text) as unknown;
  } catch {
    return firstText.text;
  }
}

function asDispatchClaim(value: unknown): WorkerTaskDispatchClaim | null {
  const payload = readToolPayload(value);
  if (!isObjectRecord(payload)) {
    return null;
  }
  const candidate = isObjectRecord(payload.result) ? payload.result : payload;
  if (!isObjectRecord(candidate.dispatch) || typeof candidate.leaseToken !== "string") {
    return null;
  }
  return candidate as unknown as WorkerTaskDispatchClaim;
}

function asUpdateResult(value: unknown): WorkerDispatchUpdateResult {
  const payload = readToolPayload(value);
  const candidate = isObjectRecord(payload) && isObjectRecord(payload.result) ? payload.result : payload;
  if (!isObjectRecord(candidate)) {
    return { controlAction: null };
  }
  return {
    controlAction: candidate.controlAction === "cancel" ? "cancel" : null,
    dispatch: isObjectRecord(candidate.dispatch)
      ? candidate.dispatch as unknown as WorkerTaskDispatchClaim["dispatch"]
      : undefined,
  };
}

function asSession(value: unknown): LocalWorkerSession | null {
  const payload = readToolPayload(value);
  const candidate = isObjectRecord(payload) && isObjectRecord(payload.result) ? payload.result : payload;
  if (!isObjectRecord(candidate) || typeof candidate.id !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    name: typeof candidate.name === "string" ? candidate.name : null,
    provider: typeof candidate.provider === "string" ? candidate.provider : null,
    state: typeof candidate.state === "string" ? candidate.state : null,
    workerBranch: typeof candidate.workerBranch === "string" ? candidate.workerBranch : null,
    prUrl: typeof candidate.prUrl === "string" ? candidate.prUrl : null,
    summaryMarkdown: typeof candidate.summaryMarkdown === "string" ? candidate.summaryMarkdown : null,
    errorMessage: typeof candidate.errorMessage === "string" ? candidate.errorMessage : null,
  };
}

async function callFirstAvailableTool(
  client: ToolClient,
  toolNames: string[],
  args: Record<string, unknown>,
): Promise<unknown> {
  let lastError: unknown;
  for (const name of toolNames) {
    try {
      return await client.callTool({ name, arguments: args });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Error) || !/not found|method not found|unknown tool/i.test(error.message)) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`No worker tool available: ${toolNames.join(", ")}`);
}

export class McpWorkerControlPlaneClient implements WorkerControlPlaneClient {
  constructor(private readonly client: ToolClient) {}

  async registerWorker(config: WorkerConfig): Promise<WorkerRegistrationResult> {
    const args = {
      connectionKey: config.connectionKey,
      displayName: config.displayName,
      transport: "streamable-http",
      projectIds: config.projectIds ?? [],
      activeProjectIds: config.activeProjectIds ?? [],
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: true,
      },
      metadata: {
        hostname: os.hostname(),
        platform: process.platform,
        arch: process.arch,
        localExecutionRuntime: "worker_host",
      },
    };
    const result = await callFirstAvailableTool(this.client, ["register_worker_endpoint", "start_listen", "listen"], args);
    const payload = readToolPayload(result);
    const endpoint = isObjectRecord(payload) && isObjectRecord(payload.endpoint)
      ? payload.endpoint as unknown as WorkerEndpointRecord
      : undefined;
    return { endpoint };
  }

  async pullTaskDispatch(args: { connectionKey: string; projectId?: string; sprintId?: string }): Promise<WorkerTaskDispatchClaim | null> {
    const result = await this.client.callTool({
      name: "pull_task_dispatch",
      arguments: args,
    });
    return asDispatchClaim(result);
  }

  async updateTaskDispatch(args: {
    connectionKey: string;
    dispatchId: string;
    leaseToken: string;
    state: WorkerUpdateState;
    provider?: string;
    sessionId?: string;
    sessionName?: string;
    workerBranch?: string;
    prUrl?: string;
    summaryMarkdown?: string;
    errorMessage?: string;
  }): Promise<WorkerDispatchUpdateResult> {
    const result = await this.client.callTool({
      name: "update_task_dispatch",
      arguments: args,
    });
    return asUpdateResult(result);
  }

  async close(): Promise<void> {
    await this.client.close?.();
  }
}

export class McpLocalWorkerExecutionClient implements LocalWorkerExecutionClient {
  constructor(private readonly client: ToolClient) {}

  async executeWorkerDispatch(claim: WorkerTaskDispatchClaim): Promise<LocalWorkerSession> {
    const session = asSession(await this.client.callTool({
      name: "execute_worker_dispatch",
      arguments: {
        dispatchId: claim.dispatch.id,
        leaseToken: claim.leaseToken,
        claim: claim as unknown as Record<string, unknown>,
      },
    }));
    if (!session) {
      throw new Error(`Local worker-host did not return a session for dispatch ${claim.dispatch.id}`);
    }
    return session;
  }

  async getSession(sessionId: string): Promise<LocalWorkerSession | null> {
    return asSession(await this.client.callTool({
      name: "get_session",
      arguments: { sessionId },
    }));
  }

  async cancelLocalDispatch(dispatchId: string, reason: string): Promise<void> {
    await this.client.callTool({
      name: "cancel_local_dispatch",
      arguments: { dispatchId, reason },
    });
  }

  async close(): Promise<void> {
    await this.client.close?.();
  }
}

function resolvePollProjectIds(config: WorkerConfig): Array<string | undefined> {
  const activeProjectIds = config.activeProjectIds?.filter((value) => value.trim().length > 0) ?? [];
  if (activeProjectIds.length > 0) {
    return activeProjectIds;
  }
  const projectIds = config.projectIds?.filter((value) => value.trim().length > 0) ?? [];
  return projectIds.length > 0 ? projectIds : [undefined];
}

async function withRetry<T>(
  label: string,
  operation: () => Promise<T>,
  options: Required<Pick<RunWorkerClientOptions, "maxRetryAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs">> & {
    sleep: (ms: number) => Promise<void>;
    logger: WorkerClientLogger;
  },
): Promise<T> {
  let attempt = 0;
  let delayMs = options.retryBaseDelayMs;
  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (attempt >= options.maxRetryAttempts) {
        throw error;
      }
      options.logger.warn("Worker operation failed; retrying", {
        operation: label,
        attempt,
        retryDelayMs: delayMs,
        error: error instanceof Error ? error.message : String(error),
      });
      await options.sleep(delayMs);
      delayMs = Math.min(options.retryMaxDelayMs, delayMs * 2);
    }
  }
}

function resolveTerminalState(session: LocalWorkerSession): WorkerUpdateState | null {
  const state = typeof session.state === "string" ? session.state.toUpperCase() : "";
  return TERMINAL_STATES.has(state) ? state as WorkerUpdateState : null;
}

function buildSummary(claim: WorkerTaskDispatchClaim, session: LocalWorkerSession): string {
  return session.summaryMarkdown?.trim() || [
    `Project: ${claim.project.name}`,
    `Sprint: ${claim.sprint.name}`,
    `Task: ${claim.task.taskKey} ${claim.task.title}`,
    `Provider: ${session.provider || "unknown"}`,
    `State: ${session.state || "unknown"}`,
    session.workerBranch ? `Worker branch: ${session.workerBranch}` : null,
    session.prUrl ? `Pull request: ${session.prUrl}` : null,
  ].filter(Boolean).join("\n");
}

async function runClaim(
  config: WorkerConfig,
  claim: WorkerTaskDispatchClaim,
  controlPlaneClient: WorkerControlPlaneClient,
  localClient: LocalWorkerExecutionClient,
  retryOptions: Required<Pick<RunWorkerClientOptions, "maxRetryAttempts" | "retryBaseDelayMs" | "retryMaxDelayMs">> & {
    sleep: (ms: number) => Promise<void>;
    logger: WorkerClientLogger;
  },
  signal?: AbortSignal,
): Promise<void> {
  if (!claim.leaseToken || claim.leaseToken.trim().length === 0) {
    throw new Error(`Refusing to execute dispatch ${claim.dispatch.id} without a lease token.`);
  }

  const session = await localClient.executeWorkerDispatch(claim);
  const updateRunning = async (currentSession: LocalWorkerSession): Promise<WorkerDispatchUpdateResult> => withRetry(
    "update_task_dispatch",
    () => controlPlaneClient.updateTaskDispatch({
      connectionKey: config.connectionKey,
      dispatchId: claim.dispatch.id,
      leaseToken: claim.leaseToken,
      state: "RUNNING",
      provider: currentSession.provider || undefined,
      sessionId: currentSession.id,
      sessionName: currentSession.name || undefined,
      workerBranch: currentSession.workerBranch || undefined,
      prUrl: currentSession.prUrl || undefined,
    }),
    retryOptions,
  );

  let currentUpdate = await updateRunning(session);
  let currentSession = session;

  while (!signal?.aborted) {
    if (currentUpdate.controlAction === "cancel") {
      await localClient.cancelLocalDispatch(claim.dispatch.id, "Dispatch cancellation requested by control plane.");
      await withRetry(
        "update_task_dispatch_cancelled",
        () => controlPlaneClient.updateTaskDispatch({
          connectionKey: config.connectionKey,
          dispatchId: claim.dispatch.id,
          leaseToken: claim.leaseToken,
          state: "FAILED",
          provider: currentSession.provider || undefined,
          sessionId: currentSession.id,
          sessionName: currentSession.name || undefined,
          workerBranch: currentSession.workerBranch || undefined,
          prUrl: currentSession.prUrl || undefined,
          errorMessage: "Dispatch cancellation requested by control plane.",
        }),
        retryOptions,
      );
      return;
    }

    await retryOptions.sleep(config.sessionPollIntervalMs);
    currentSession = await localClient.getSession(session.id) || currentSession;
    const terminalState = resolveTerminalState(currentSession);
    if (terminalState) {
      await withRetry(
        "update_task_dispatch_terminal",
        () => controlPlaneClient.updateTaskDispatch({
          connectionKey: config.connectionKey,
          dispatchId: claim.dispatch.id,
          leaseToken: claim.leaseToken,
          state: terminalState,
          provider: currentSession.provider || undefined,
          sessionId: currentSession.id,
          sessionName: currentSession.name || undefined,
          workerBranch: currentSession.workerBranch || undefined,
          prUrl: currentSession.prUrl || undefined,
          summaryMarkdown: buildSummary(claim, currentSession),
          errorMessage: terminalState === "FAILED" ? currentSession.errorMessage || "Worker session failed." : undefined,
        }),
        retryOptions,
      );
      return;
    }

    currentUpdate = await updateRunning(currentSession);
  }
}

export async function runWorkerClient(config: WorkerConfig, options: RunWorkerClientOptions = {}): Promise<void> {
  const logger = options.logger ?? consoleLogger;
  const sleeper = options.sleep ?? sleep;
  const retryOptions = {
    sleep: sleeper,
    logger,
    maxRetryAttempts: options.maxRetryAttempts ?? DEFAULT_MAX_RETRY_ATTEMPTS,
    retryBaseDelayMs: options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    retryMaxDelayMs: options.retryMaxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS,
  };
  const controlPlaneClient = options.controlPlaneClient ?? await createRemoteControlPlaneClient(config);
  const localClient = options.localClient ?? await createLocalWorkerExecutionClient(config);
  const pollProjectIds = resolvePollProjectIds(config);
  let iteration = 0;

  try {
    await withRetry("register_worker_endpoint", () => controlPlaneClient.registerWorker(config), retryOptions);
    logger.info("Code UX worker registered", {
      connectionKey: config.connectionKey,
      displayName: config.displayName,
      projectCount: config.projectIds?.length ?? 0,
      activeProjectCount: config.activeProjectIds?.length ?? 0,
    });

    while (!options.signal?.aborted) {
      if (options.maxIterations !== undefined && iteration >= options.maxIterations) {
        return;
      }
      iteration += 1;
      let claimed = false;

      for (const projectId of pollProjectIds) {
        const claim = await withRetry(
          "pull_task_dispatch",
          () => controlPlaneClient.pullTaskDispatch({
            connectionKey: config.connectionKey,
            projectId,
            sprintId: config.sprintId,
          }),
          retryOptions,
        );
        if (!claim) {
          continue;
        }
        claimed = true;
        logger.info("Worker claimed task dispatch", {
          dispatchId: claim.dispatch.id,
          projectId: claim.dispatch.projectId,
          sprintId: claim.dispatch.sprintId,
        });
        await runClaim(config, claim, controlPlaneClient, localClient, retryOptions, options.signal);
        break;
      }

      if (!claimed) {
        await sleeper(config.dispatchPollIntervalMs);
      }
    }
  } finally {
    await Promise.all([
      controlPlaneClient.close?.().catch(() => undefined),
      localClient.close?.().catch(() => undefined),
    ]);
  }
}

async function createMcpClient(
  name: string,
  transport: StreamableHTTPClientTransport | StdioClientTransport,
): Promise<ToolClient> {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(transport);
  return {
    callTool: (args) => client.callTool(args),
    close: async () => {
      await transport.close();
    },
  };
}

async function createRemoteControlPlaneClient(config: WorkerConfig): Promise<WorkerControlPlaneClient> {
  if (!config.controlPlaneUrl) {
    throw new Error("Worker control-plane --server-url is required.");
  }
  if (!config.controlPlaneAuthToken) {
    throw new Error("Worker control-plane --auth-token is required.");
  }
  const transport = new StreamableHTTPClientTransport(
    new URL(config.controlPlaneUrl),
    {
      requestInit: {
        headers: {
          Authorization: `Bearer ${config.controlPlaneAuthToken}`,
          ...(config.serviceIdentityId ? { "X-Code-UX-Service-Id": config.serviceIdentityId } : {}),
        },
      },
    },
  );
  return new McpWorkerControlPlaneClient(await createMcpClient("codeux-worker-control-plane", transport));
}

async function createLocalWorkerExecutionClient(config: WorkerConfig): Promise<LocalWorkerExecutionClient> {
  const transport = new StdioClientTransport({
    command: config.serverCommand,
    args: config.serverArgs,
    cwd: config.serverCwd,
  });
  return new McpLocalWorkerExecutionClient(await createMcpClient("codeux-worker-host", transport));
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const config = loadWorkerConfig(argv);
  await runWorkerClient(config);
}

if (process.env.NODE_ENV !== "test") {
  main().catch((error) => {
    console.error("Fatal error running Code UX worker:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
