import os from "os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { JulesSession } from "../contracts/app-types.js";
import type {
  ListenAssignmentChangedEvent,
  ListenAttentionItemEvent,
  ListenDashboardMessageEvent,
  ListenResponse,
} from "../contracts/connection-chat-types.js";
import type { WorkerConfig } from "./worker-config.js";
import { WorkerSupervisionState } from "./worker-supervision-state.js";

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

interface ClaimAttentionItemResponse {
  itemId: string;
  status: string;
  assignedWorkerEndpointId: string | null;
  claimedAt: string | null;
}

interface ReportAttentionOutcomeResponse {
  itemId: string;
  status: string;
  outcome: "handled_locally" | "needs_dashboard_reply" | "needs_human_escalation";
  handoffAttentionItemId: string | null;
  threadId: string | null;
  threadMessageId: string | null;
  resolvedAt: string | null;
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
  private readonly supervisionState: WorkerSupervisionState;

  constructor(private readonly config: WorkerConfig) {
    this.supervisionState = new WorkerSupervisionState(config.activeProjectIds || []);
  }

  async run(signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      let closeClients: (() => Promise<void>) | null = null;
      try {
        const clients = await this.connectClients();
        closeClients = clients.close;
        await this.runListenLoop(clients.controlPlaneClient, clients.localExecutorClient, signal);
      } catch (error) {
        if (signal?.aborted) {
          break;
        }
        console.error("[sprint-os-worker] Worker loop error", error);
        await delay(3_000, signal).catch(() => undefined);
      } finally {
        if (closeClients) {
          await closeClients().catch(() => undefined);
        }
      }
    }
  }

  private async connectClients(): Promise<{
    controlPlaneClient: Client;
    localExecutorClient: Client;
    close: () => Promise<void>;
  }> {
    const localTransport = new StdioClientTransport({
      command: this.config.serverCommand,
      args: this.config.serverArgs,
      cwd: this.config.serverCwd,
      stderr: "inherit",
    });
    const localExecutorClient = this.createClient("sprint-os-worker-local-executor");
    await localExecutorClient.connect(localTransport);

    if (!this.config.controlPlaneUrl) {
      return {
        controlPlaneClient: localExecutorClient,
        localExecutorClient,
        close: async () => {
          await localTransport.close().catch(() => undefined);
        },
      };
    }

    const headers: Record<string, string> = {};
    if (this.config.controlPlaneAuthToken) {
      headers.Authorization = `Bearer ${this.config.controlPlaneAuthToken}`;
    }

    const controlPlaneTransport = new StreamableHTTPClientTransport(
      new URL(this.config.controlPlaneUrl),
      {
        requestInit: {
          headers,
        },
      },
    );
    const controlPlaneClient = this.createClient("sprint-os-worker-control-plane");
    await controlPlaneClient.connect(controlPlaneTransport);

    return {
      controlPlaneClient,
      localExecutorClient,
      close: async () => {
        await Promise.all([
          controlPlaneTransport.close().catch(() => undefined),
          localTransport.close().catch(() => undefined),
        ]);
      },
    };
  }

  private createClient(name: string): Client {
    const client = new Client({
      name,
      version: "1.2.0",
    });
    client.onerror = (error) => {
      console.error("[sprint-os-worker] MCP client error", error);
    };
    return client;
  }

  private async runListenLoop(controlPlaneClient: Client, localExecutorClient: Client, signal?: AbortSignal): Promise<void> {
    while (!signal?.aborted) {
      const response = await this.callJsonTool<ListenResponse>(controlPlaneClient, "listen", {
        connection_key: this.config.connectionKey,
        display_name: this.config.displayName,
        role: "worker",
        project_id: this.config.projectId,
        project_ids: this.config.projectIds,
        active_project_ids: this.resolveActiveProjectIds(),
        transport: this.config.controlPlaneUrl ? "streamable_http" : "stdio",
        include_task_dispatch: true,
        include_attention_items: true,
        capabilities: {
          instruction: this.config.controlPlaneUrl
            ? "Claims Sprint OS worker dispatches from the remote control plane and executes them on the local worker host."
            : "Claims Sprint OS worker dispatches and executes them locally through the worker-host runtime.",
          listenMode: true,
          labels: ["worker"],
          machineName: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          localExecutionRuntime: "worker_host",
        },
      });

      if (response.kind === "dashboard_message") {
        await this.processInboxMessage(controlPlaneClient, localExecutorClient, response);
        continue;
      }

      if (response.kind === "task_dispatch") {
        await this.processDispatch(controlPlaneClient, localExecutorClient, response.dispatch, signal);
        continue;
      }

      if (response.kind === "assignment_changed") {
        this.processAssignmentChanged(response);
        continue;
      }

      if (response.kind === "attention_item") {
        await this.processAttentionItem(controlPlaneClient, response);
        continue;
      }

      if (response.kind === "noop_timeout") {
        await delay(this.config.dispatchPollIntervalMs, signal).catch(() => undefined);
        continue;
      }
    }
  }

  private async processDispatch(
    controlPlaneClient: Client,
    localExecutorClient: Client,
    claim: WorkerTaskDispatchClaim,
    signal?: AbortSignal,
  ): Promise<void> {
    let execution: ExecuteWorkerDispatchResponse | null = null;
    let cancelRequested = false;

    try {
      execution = await this.callJsonTool<ExecuteWorkerDispatchResponse>(localExecutorClient, "execute_worker_dispatch", {
        dispatch_id: claim.dispatch.id,
      });

      let session = await this.getSession(localExecutorClient, execution.session.id);
      while (!signal?.aborted) {
        const pullRequest = this.extractPullRequest(session);
        const terminalState = this.resolveTerminalTaskState(session);
        const update = await this.callJsonTool<UpdateWorkerDispatchResponse>(controlPlaneClient, "update_task_dispatch", {
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
          await this.callJsonTool(localExecutorClient, "cancel_local_dispatch", {
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
        session = await this.getSession(localExecutorClient, execution.session.id);
      }
    } catch (error) {
      if (!execution) {
        await this.failDispatch(controlPlaneClient, claim, error);
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

  private async processInboxMessage(
    controlPlaneClient: Client,
    localExecutorClient: Client,
    event: ListenDashboardMessageEvent,
  ): Promise<void> {
    try {
      const reply = await this.callJsonTool<GenerateDashboardReplyResponse>(localExecutorClient, "generate_dashboard_reply", {
        project_id: event.message.projectId,
        thread_id: event.message.threadId,
        body_markdown: event.message.bodyMarkdown,
      });
      await this.callJsonTool(controlPlaneClient, "post_listen_reply", {
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

  private processAssignmentChanged(event: ListenAssignmentChangedEvent): void {
    this.supervisionState.noteAssignmentChanged(event);
    console.info("[sprint-os-worker] Assignment changed", {
      projectId: event.project.id,
      projectName: event.project.name,
      repoPath: event.project.repoPath,
      assignmentRole: event.assignment.assignmentRole,
      status: event.assignment.status,
      activeProjectIds: this.resolveActiveProjectIds(),
    });
  }

  private async processAttentionItem(
    controlPlaneClient: Client,
    event: ListenAttentionItemEvent,
  ): Promise<void> {
    this.supervisionState.noteAttentionItem(event);

    const logPayload = {
      projectId: event.project.id,
      projectName: event.project.name,
      repoPath: event.project.repoPath,
      workingDirectoryHint: event.workingDirectoryHint,
      attentionItemId: event.item.id,
      attentionType: event.item.attentionType,
      severity: event.item.severity,
      status: event.item.status,
      title: event.item.title,
      unresolvedAttentionCount: event.contextDigest.unresolvedAttentionCount,
      activeProjectIds: this.resolveActiveProjectIds(),
    };

    if (event.item.ownerType !== "worker") {
      console.warn("[sprint-os-worker] Attention item requires non-worker handling", logPayload);
      return;
    }

    if (event.item.status === "open") {
      try {
        const claimed = await this.callJsonTool<ClaimAttentionItemResponse>(controlPlaneClient, "claim_attention_item", {
          connection_key: this.config.connectionKey,
          attention_item_id: event.item.id,
          claim_reason: "worker_listen_claimed",
        });
        this.supervisionState.markAttentionItemClaimed(event.project.id, event.item.id);
        console.warn("[sprint-os-worker] Claimed attention item", {
          ...logPayload,
          assignedWorkerEndpointId: claimed.assignedWorkerEndpointId,
          claimedAt: claimed.claimedAt,
        });
        await this.reportAttentionOutcome(controlPlaneClient, event);
      } catch (error) {
        console.error("[sprint-os-worker] Failed to claim attention item", {
          ...logPayload,
          error,
        });
      }
      return;
    }

    if (event.item.status === "claimed") {
      this.supervisionState.markAttentionItemClaimed(event.project.id, event.item.id);
      await this.reportAttentionOutcome(controlPlaneClient, event);
    }

    console.warn("[sprint-os-worker] Attention item requires worker supervision", logPayload);
  }

  private async reportAttentionOutcome(
    controlPlaneClient: Client,
    event: ListenAttentionItemEvent,
  ): Promise<void> {
    const outcome = this.classifyAttentionOutcome(event);
    const summaryMarkdown = this.buildAttentionOutcomeSummary(event, outcome);

    try {
      const reported = await this.callJsonTool<ReportAttentionOutcomeResponse>(controlPlaneClient, "report_attention_outcome", {
        connection_key: this.config.connectionKey,
        attention_item_id: event.item.id,
        outcome,
        summary_markdown: summaryMarkdown,
      });

      if (reported.status === "resolved" || reported.status === "dismissed") {
        this.supervisionState.markAttentionItemResolved(event.project.id, event.item.id);
      }

      console.info("[sprint-os-worker] Reported attention outcome", {
        projectId: event.project.id,
        repoPath: event.project.repoPath,
        attentionItemId: event.item.id,
        attentionType: event.item.attentionType,
        outcome: reported.outcome,
        handoffAttentionItemId: reported.handoffAttentionItemId,
        threadId: reported.threadId,
      });
    } catch (error) {
      console.error("[sprint-os-worker] Failed to report attention outcome", {
        projectId: event.project.id,
        repoPath: event.project.repoPath,
        attentionItemId: event.item.id,
        attentionType: event.item.attentionType,
        outcome,
        error,
      });
    }
  }

  private classifyAttentionOutcome(
    event: ListenAttentionItemEvent,
  ): "needs_dashboard_reply" | "needs_human_escalation" {
    switch (event.item.attentionType) {
      case "merge_required":
      case "action_required":
      case "manual_attention":
        return "needs_human_escalation";
      default:
        return "needs_dashboard_reply";
    }
  }

  private buildAttentionOutcomeSummary(
    event: ListenAttentionItemEvent,
    outcome: "needs_dashboard_reply" | "needs_human_escalation",
  ): string {
    const lines = [
      `Worker acknowledged ${event.item.attentionType} for ${event.project.name}.`,
      `Repo path: ${event.project.repoPath}`,
      `Working directory hint: ${event.workingDirectoryHint}`,
      `Recommended outcome: ${outcome === "needs_dashboard_reply" ? "dashboard reply" : "human escalation"}.`,
      "",
      "Current blocker:",
      event.item.summaryMarkdown.trim(),
    ];

    if (event.contextDigest.unresolvedAttentionTitles.length > 0) {
      lines.push("", `Open supervision items: ${event.contextDigest.unresolvedAttentionTitles.join(", ")}`);
    }

    return lines.join("\n");
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

  private resolveActiveProjectIds(): string[] | undefined {
    const activeProjectIds = this.supervisionState.getActiveProjectIds();
    return activeProjectIds.length > 0 ? activeProjectIds : undefined;
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
