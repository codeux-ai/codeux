import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { JulesSession } from "../contracts/app-types.js";
import type { ListenDashboardMessageEvent, ListenResponse } from "../contracts/connection-chat-types.js";
import type { WorkerConfig } from "./worker-config.js";

interface ExecuteWorkerDispatchResponse {
  dispatchId: string;
  taskRunId: string;
  session: {
    id: string;
    name: string;
    title?: string;
    state?: string;
    provider?: string;
    createTime?: string;
    workerBranch?: string | null;
    prUrl?: string | null;
  };
}

interface UpdateWorkerDispatchResponse {
  dispatch: {
    id: string;
    status: string;
  };
  controlAction: "cancel" | null;
}

interface GenerateDashboardReplyResponse {
  bodyMarkdown: string;
  provider: string;
  model: string;
}

const ACTION_REQUIRED_STATES = new Set(["AWAITING_PLAN_APPROVAL", "AWAITING_USER_FEEDBACK", "PAUSED"]);
const FAILED_STATES = new Set(["FAILED", "CANCELLED"]);

const delay = async (ms: number, signal?: AbortSignal): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const abortHandler = () => {
      clearTimeout(timer);
      reject(new Error("Worker loop aborted"));
    };

    if (signal?.aborted) {
      abortHandler();
      return;
    }

    signal?.addEventListener("abort", abortHandler, { once: true });
  }).finally(() => {
    if (signal) {
      signal.onabort = null;
    }
  });
};

export class SprintOsWorker {
  constructor(private readonly config: WorkerConfig) {}

  async run(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      let transport: StdioClientTransport | null = null;
      try {
        transport = new StdioClientTransport({
          command: this.config.serverCommand,
          args: this.config.serverArgs,
          cwd: this.config.serverCwd,
          stderr: "inherit",
        });
        const client = new Client({
          name: "sprint-os-worker",
          version: "1.2.0",
        });
        client.onerror = (error) => {
          console.error("[sprint-os-worker] MCP client error", error);
        };

        await client.connect(transport);
        await this.runListenLoop(client, signal);
      } catch (error) {
        if (signal?.aborted) {
          break;
        }
        console.error("[sprint-os-worker] Worker loop error", error);
        await delay(3_000, signal).catch(() => undefined);
      } finally {
        if (transport) {
          await transport.close().catch(() => undefined);
        }
      }
    }
  }

  private async runListenLoop(client: Client, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const response = await this.callJsonTool<ListenResponse>(client, "listen", {
        connection_key: this.config.connectionKey,
        display_name: this.config.displayName,
        role: "worker",
        project_id: this.config.projectId,
        transport: "stdio",
        include_task_dispatch: true,
        capabilities: {
          instruction: "Claims Sprint OS worker dispatches and executes them locally through the worker-host runtime.",
          listenMode: true,
          labels: ["worker"],
        },
      });

      if (response.kind === "dashboard_message") {
        await this.processInboxMessage(client, response);
        continue;
      }

      if (response.kind === "task_dispatch") {
        await this.processDispatch(client, response.dispatch, signal);
        continue;
      }

      if (response.kind === "noop_timeout") {
        await delay(this.config.dispatchPollIntervalMs, signal).catch(() => undefined);
        continue;
      }
    }
  }

  private async processDispatch(
    client: Client,
    claim: WorkerTaskDispatchClaim,
    signal?: AbortSignal,
  ): Promise<void> {
    let execution: ExecuteWorkerDispatchResponse | null = null;
    let cancelRequested = false;

    try {
      execution = await this.callJsonTool<ExecuteWorkerDispatchResponse>(client, "execute_worker_dispatch", {
        dispatch_id: claim.dispatch.id,
      });

      let session = await this.getSession(client, execution.session.id);
      while (!signal?.aborted) {
        const pullRequest = this.extractPullRequest(session);
        const terminalState = this.resolveTerminalTaskState(session);
        const update = await this.callJsonTool<UpdateWorkerDispatchResponse>(client, "update_task_dispatch", {
          connection_key: this.config.connectionKey,
          dispatch_id: claim.dispatch.id,
          lease_token: claim.leaseToken,
          state: terminalState || "RUNNING",
          provider: session.provider || execution.session.provider,
          session_id: session.id,
          session_name: session.name,
          worker_branch: pullRequest?.workerBranch || claim.executionContext.featureBranch,
          pr_url: pullRequest?.url,
          summary_markdown: terminalState ? this.buildSessionSummary(session, claim) : undefined,
          error_message: terminalState === "FAILED" ? `Session ended in state ${session.state || "FAILED"}` : undefined,
        });

        if (update.controlAction === "cancel" && !cancelRequested) {
          cancelRequested = true;
          await this.callJsonTool(client, "cancel_local_dispatch", {
            dispatch_id: claim.dispatch.id,
            reason: "Dashboard requested cancellation for the active worker dispatch.",
          }).catch((error) => {
            console.error("[sprint-os-worker] Failed to cancel local dispatch", error);
          });
        }

        if (terminalState) {
          return;
        }

        await delay(this.config.sessionPollIntervalMs, signal).catch(() => undefined);
        session = await this.getSession(client, execution.session.id);
      }
    } catch (error) {
      if (!execution) {
        await this.failDispatch(client, claim, error);
        return;
      }
      throw error;
    }
  }

  private async failDispatch(
    client: Client,
    claim: WorkerTaskDispatchClaim,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    await this.callJsonTool<UpdateWorkerDispatchResponse>(client, "update_task_dispatch", {
      connection_key: this.config.connectionKey,
      dispatch_id: claim.dispatch.id,
      lease_token: claim.leaseToken,
      state: "FAILED",
      worker_branch: claim.executionContext.featureBranch,
      error_message: message,
      summary_markdown: `Worker dispatch failed before execution completed.\n\n${message}`,
    }).catch((updateError) => {
      console.error("[sprint-os-worker] Failed to persist dispatch failure", updateError);
    });
  }

  private async processInboxMessage(client: Client, event: ListenDashboardMessageEvent): Promise<void> {
    try {
      const reply = await this.callJsonTool<GenerateDashboardReplyResponse>(client, "generate_dashboard_reply", {
        project_id: event.message.projectId,
        thread_id: event.message.threadId,
        thread_title: event.message.threadTitle,
        body_markdown: event.message.bodyMarkdown,
      });
      await this.callJsonTool(client, "post_listen_reply", {
        connection_key: this.config.connectionKey,
        thread_id: event.message.threadId,
        body_markdown: reply.bodyMarkdown,
        reply_to_message_id: event.message.id,
      });
    } catch (error) {
      console.error("[sprint-os-worker] Failed to process inbox message", {
        threadId: event.message.threadId,
        messageId: event.message.id,
        error,
      });
    }
  }

  private resolveTerminalTaskState(session: JulesSession): "COMPLETED" | "FAILED" | "BLOCKED" | null {
    if (this.extractPullRequest(session) || session.state === "COMPLETED") {
      return "COMPLETED";
    }
    if (session.state && ACTION_REQUIRED_STATES.has(session.state)) {
      return "BLOCKED";
    }
    if (session.state && FAILED_STATES.has(session.state)) {
      return "FAILED";
    }
    return null;
  }

  private buildSessionSummary(session: JulesSession, claim: WorkerTaskDispatchClaim): string {
    const pullRequest = this.extractPullRequest(session);
    const lines = [
      `Project: ${claim.project.name}`,
      `Sprint: ${claim.sprint.name}`,
      `Task: ${claim.task.taskKey} ${claim.task.title}`,
      `State: ${session.state || "UNKNOWN"}`,
      `Provider: ${session.provider || "unknown"}`,
    ];

    if (pullRequest?.workerBranch) {
      lines.push(`Worker branch: ${pullRequest.workerBranch}`);
    }
    if (pullRequest?.url) {
      lines.push(`Pull request: ${pullRequest.url}`);
    }

    return lines.join("\n");
  }

  private extractPullRequest(session: JulesSession): { url?: string; workerBranch?: string } | null {
    const output = (session.outputs || [])
      .map((entry) => entry.pullRequest)
      .find((entry): entry is { url?: string; workerBranch?: string } => !!entry);

    return output || null;
  }

  private async getSession(client: Client, sessionId: string): Promise<JulesSession> {
    return await this.callJsonTool<JulesSession>(client, "get_session", {
      session_id: sessionId,
    });
  }

  private async callJsonTool<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
    const result = await client.request({
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    }, CallToolResultSchema);

    return this.parseToolResult<T>(name, result);
  }

  private parseToolResult<T>(toolName: string, result: CallToolResult): T {
    if (result.isError) {
      const message = result.content
        .filter((entry): entry is { type: "text"; text: string } => entry.type === "text")
        .map((entry) => entry.text)
        .join("\n")
        .trim();
      throw new Error(message || `${toolName} failed`);
    }

    const text = result.content.find((entry): entry is { type: "text"; text: string } => entry.type === "text")?.text;
    if (!text) {
      throw new Error(`${toolName} did not return JSON text content.`);
    }

    return JSON.parse(text) as T;
  }
}
