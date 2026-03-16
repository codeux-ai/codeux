import { randomUUID } from "crypto";
import type { DashboardSettings, JulesSession, WorkerExecutionMode } from "../contracts/app-types.js";
import type { WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { ProjectAttentionItemRecord } from "../contracts/project-attention-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildTaskRunKey } from "./task-run-key.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS, sanitizeToken } from "./cli-workflow-utils.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { WorkerTaskDispatchService } from "./worker-task-dispatch-service.js";
import { CliWorkflowService } from "./cli-workflow-service.js";

const VIRTUAL_WORKER_RECONCILE_MS = 3_000;
const VIRTUAL_WORKER_SESSION_POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalSessionState(state: string | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "QUOTA";
}

function extractPullRequest(session: JulesSession): { url?: string; workerBranch?: string } | null {
  const output = (session.outputs || [])
    .map((entry) => entry.pullRequest)
    .find((entry): entry is { url?: string; workerBranch?: string } => Boolean(entry));
  return output || null;
}

function resolveTerminalDispatchState(session: JulesSession): "COMPLETED" | "FAILED" | "QUOTA" | null {
  if (extractPullRequest(session) || session.state === "COMPLETED") {
    return "COMPLETED";
  }
  if (session.state === "QUOTA") {
    return "QUOTA";
  }
  if (session.state === "FAILED" || session.state === "CANCELLED") {
    return "FAILED";
  }
  return null;
}

export interface VirtualWorkerServiceDependencies {
  settingsRepository: SettingsRepository;
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionService: ProjectAttentionService;
  workerTaskDispatchService: WorkerTaskDispatchService;
  cliWorkflowService: CliWorkflowService;
  logger?: Logger;
}

export class VirtualWorkerService {
  private readonly workspaceManager = new WorkspaceManager();

  private readonly providerRunner = new ProviderRunner(new DockerRunner());

  private readonly activeCycles = new Map<string, Promise<void>>();

  private readonly scheduledProjects = new Set<string>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: VirtualWorkerServiceDependencies) {}

  start(): void {
    if (this.reconcileTimer) {
      return;
    }

    this.cleanupOrphanedVirtualWorkers();
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((error) => {
        this.deps.logger?.error("Virtual worker reconcile failed", { error });
      });
    }, VIRTUAL_WORKER_RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  scheduleProject(projectId: string, reason: string): void {
    if (!this.projectNeedsVirtualWorker(projectId)) {
      return;
    }
    if (this.activeCycles.has(projectId) || this.scheduledProjects.has(projectId)) {
      return;
    }

    this.scheduledProjects.add(projectId);
    queueMicrotask(() => {
      this.scheduledProjects.delete(projectId);
      if (this.activeCycles.has(projectId) || !this.projectNeedsVirtualWorker(projectId)) {
        return;
      }

      const cycle = this.runProjectCycle(projectId, reason)
        .catch((error) => {
          this.deps.logger?.error("Virtual worker cycle failed", { projectId, reason, error });
        })
        .finally(() => {
          this.activeCycles.delete(projectId);
          if (this.projectNeedsVirtualWorker(projectId)) {
            this.scheduleProject(projectId, "remaining_worker_work");
          }
        });

      this.activeCycles.set(projectId, cycle);
    });
  }

  async reconcile(): Promise<void> {
    for (const project of this.deps.projectManagementRepository.listProjects().projects) {
      if (this.projectNeedsVirtualWorker(project.id)) {
        this.scheduleProject(project.id, "reconcile");
      }
    }
  }

  private projectUsesVirtualWorkers(projectId: string, sprintId?: string | null): boolean {
    return this.resolveWorkerExecutionMode(projectId, sprintId) === "VIRTUAL";
  }

  private resolveWorkerExecutionMode(projectId: string, sprintId?: string | null): WorkerExecutionMode {
    if (sprintId) {
      return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode;
    }
    return this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode;
  }

  private resolveDashboardSettings(projectId: string, sprintId?: string | null): DashboardSettings {
    if (sprintId) {
      return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings;
    }
    return this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
  }

  private projectNeedsVirtualWorker(projectId: string): boolean {
    if (!this.projectUsesVirtualWorkers(projectId)) {
      return false;
    }

    const openWorkerAttention = this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .some((item) => item.ownerType === "worker");
    if (openWorkerAttention) {
      return true;
    }

    return this.deps.executionRepository.listTaskDispatches({ projectId })
      .some((dispatch) => (
        dispatch.executorType === "mcp_worker"
        && dispatch.status === "queued"
        && this.projectUsesVirtualWorkers(dispatch.projectId, dispatch.sprintId)
      ));
  }

  private async runProjectCycle(projectId: string, reason: string): Promise<void> {
    const cycleSettings = this.resolveCycleSettings(projectId);
    const endpoint = this.deps.workerEndpointRepository.createVirtualEndpoint({
      endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${sanitizeToken(randomUUID().slice(0, 8))}`,
      displayName: `Virtual ${this.getProviderLabel(cycleSettings.workers.virtualWorkerProvider)} Worker`,
      status: "connected",
      transport: "internal",
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: true,
      },
    });

    this.deps.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, endpoint.id);

    try {
      const attentionItem = this.pickNextWorkerAttention(projectId);
      if (attentionItem) {
        await this.handleAttentionItem(endpoint.id, attentionItem, reason);
        return;
      }

      const dispatchClaim = this.deps.workerTaskDispatchService.claimNextDispatchForWorker({
        projectId,
        workerEndpointId: endpoint.id,
        executionMode: "VIRTUAL",
        ownerKey: endpoint.endpointKey,
      });
      if (dispatchClaim) {
        await this.handleTaskDispatch(endpoint.id, dispatchClaim);
      }
    } finally {
      this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(projectId, endpoint.id, "virtual_worker_cycle_complete");
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private pickNextWorkerAttention(projectId: string): ProjectAttentionItemRecord | null {
    return this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .find((item) => (
        item.ownerType === "worker"
        && (item.status === "open" || (item.status === "claimed" && !item.assignedWorkerEndpointId))
      )) || null;
  }

  private async handleTaskDispatch(workerEndpointId: string, claim: WorkerTaskDispatchClaim): Promise<void> {
    const settings = this.resolveDashboardSettings(claim.project.id, claim.sprint.id);
    const provider = settings.workers.virtualWorkerProvider;
    const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${claim.dispatch.id}`);
    }

    const session = await this.deps.cliWorkflowService.startTask({
      provider,
      task: {
        record_id: claim.task.id,
        project_id: claim.project.id,
        sprint_id: claim.sprint.id,
        id: claim.task.taskKey,
        title: claim.task.title,
        prompt: claim.task.promptMarkdown,
        depends_on: [...claim.task.dependsOnTaskIds],
        is_independent: true,
        status: "PENDING",
      },
      repoPath: claim.executionContext.repoPath,
      featureBranch: claim.executionContext.featureBranch,
      sprintNumber: claim.sprint.number ?? 0,
      dispatchId: claim.dispatch.id,
      taskRunId: taskRun.id,
    });
    const pullRequest = extractPullRequest(session);

    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");
    this.deps.workerTaskDispatchService.updateDispatchForWorker({
      workerEndpointId,
      dispatchId: claim.dispatch.id,
      leaseToken: claim.leaseToken,
      state: "RUNNING",
      provider,
      sessionId: session.id,
      sessionName: session.name,
      workerBranch: pullRequest?.workerBranch || claim.executionContext.featureBranch,
      prUrl: pullRequest?.url,
    });

    while (true) {
      await sleep(VIRTUAL_WORKER_SESSION_POLL_MS);
      this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

      const currentSession = this.deps.sessionTracking.getSession(session.id) || session;
      const persistedTaskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
      const terminalState = persistedTaskRun?.state === "COMPLETED"
        ? "COMPLETED"
        : persistedTaskRun?.state === "FAILED"
          ? "FAILED"
          : persistedTaskRun?.state === "QUOTA"
            ? "QUOTA"
            : persistedTaskRun?.state === "BLOCKED"
              ? "BLOCKED"
              : resolveTerminalDispatchState(currentSession);
      const currentPullRequest = extractPullRequest(currentSession);
      const update = this.deps.workerTaskDispatchService.updateDispatchForWorker({
        workerEndpointId,
        dispatchId: claim.dispatch.id,
        leaseToken: claim.leaseToken,
        state: terminalState || "RUNNING",
        provider,
        sessionId: currentSession.id,
        sessionName: currentSession.name,
        workerBranch: currentPullRequest?.workerBranch || claim.executionContext.featureBranch,
        prUrl: currentPullRequest?.url,
        summaryMarkdown: terminalState ? this.buildDispatchSummary(claim, currentSession) : undefined,
        errorMessage: terminalState === "FAILED"
          ? `Virtual worker session ended in state ${currentSession.state || "FAILED"}`
          : undefined,
      });

      if (terminalState || update.controlAction === "cancel" || isTerminalSessionState(currentSession.state)) {
        return;
      }
    }
  }

  private buildDispatchSummary(claim: WorkerTaskDispatchClaim, session: JulesSession): string {
    const pullRequest = extractPullRequest(session);
    return [
      `Project: ${claim.project.name}`,
      `Sprint: ${claim.sprint.name}`,
      `Task: ${claim.task.taskKey} ${claim.task.title}`,
      `Worker mode: virtual`,
      `Provider: ${session.provider || "unknown"}`,
      `State: ${session.state || "UNKNOWN"}`,
      pullRequest?.workerBranch ? `Worker branch: ${pullRequest.workerBranch}` : null,
      pullRequest?.url ? `Pull request: ${pullRequest.url}` : null,
    ].filter(Boolean).join("\n");
  }

  private resolveCycleSettings(projectId: string): DashboardSettings {
    const attentionItem = this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .find((item) => item.ownerType === "worker" && this.projectUsesVirtualWorkers(item.projectId, item.sprintId));
    if (attentionItem) {
      return this.resolveDashboardSettings(projectId, attentionItem.sprintId);
    }

    const queuedDispatch = this.deps.executionRepository.listTaskDispatches({ projectId })
      .find((dispatch) => dispatch.executorType === "mcp_worker" && dispatch.status === "queued" && this.projectUsesVirtualWorkers(dispatch.projectId, dispatch.sprintId));
    if (queuedDispatch) {
      return this.resolveDashboardSettings(projectId, queuedDispatch.sprintId);
    }

    return this.resolveDashboardSettings(projectId);
  }

  private async handleAttentionItem(workerEndpointId: string, item: ProjectAttentionItemRecord, reason: string): Promise<void> {
    const claimed = item.status === "claimed"
      ? this.deps.projectAttentionService.claimItem(item.id, workerEndpointId, `virtual_worker_reclaimed:${reason}`)
      : this.deps.projectAttentionService.claimItem(item.id, workerEndpointId, `virtual_worker_claimed:${reason}`);
    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

    if (claimed.attentionType === "merge_conflict") {
      await this.resolveMergeConflictAttention(workerEndpointId, claimed);
      return;
    }

    this.escalateAttentionToHuman(workerEndpointId, claimed, [
      "Virtual worker cannot handle this worker-owned attention item automatically.",
      "",
      claimed.summaryMarkdown.trim(),
    ].join("\n"));
  }

  private async resolveMergeConflictAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const provider = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[provider];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const conflictingBranches = this.asRecord(payload.conflictingBranches);
    const sourceBranch = this.readRequiredString(conflictingBranches?.source ?? payload.workerBranch, "sourceBranch");
    const targetBranch = this.readRequiredString(conflictingBranches?.target ?? payload.featureBranch, "targetBranch");
    const sessionId = `virtual-merge-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let worktreePath = this.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;

    this.deps.sessionTracking.createSession({
      id: sessionId,
      provider,
      taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
      title,
      prompt: item.summaryMarkdown,
      state: "RUNNING",
      featureBranch: sourceBranch,
      workerBranch: sourceBranch,
      repoPath,
    });
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Virtual worker claimed merge conflict between ${sourceBranch} and ${targetBranch}.`,
    });

    let cleanedUp = false;
    try {
      const prepared = await this.workspaceManager.prepareWorktree(repoPath, worktreePath, sourceBranch, sourceBranch);
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      const hasConflicts = await this.runMergeIntoSource(finalWorktreePath, targetBranch, sessionId);
      if (hasConflicts) {
        const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
        const providerPrompt = buildProviderPrompt(this.buildMergeConflictPrompt(item, sourceBranch, targetBranch, workspaceGuidance), providerSettings.thinkingMode);
        await this.runProviderWithRetry({
          provider,
          providerPrompt,
          workflowSettings,
          repoPath,
          worktreePath: finalWorktreePath,
          sessionId,
          model: providerSettings.model,
          apiKey: providerSettings.apiKey,
          githubToken: settings.git.githubToken,
        });
      }
      await this.ensureMergeConflictResolved(finalWorktreePath);
      await this.finalizeMergeCommit(finalWorktreePath, sourceBranch, targetBranch);
      await runCommandStrict("git", ["push", "origin", `HEAD:${sourceBranch}`], finalWorktreePath);

      const headSha = (await runCommandStrict("git", ["rev-parse", "HEAD"], finalWorktreePath)).stdout.trim();
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Pushed resolved merge conflict to ${sourceBranch} at ${headSha}.`,
      });
      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_merge_conflict_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker resolved the merge conflict and pushed the updated source branch.`,
          `Source branch: ${sourceBranch}`,
          `Target branch: ${targetBranch}`,
          `Head SHA: ${headSha}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          sourceBranch,
          targetBranch,
          headSha,
        },
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to resolve merge conflict: ${message}`,
      });
      this.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.getProviderLabel(provider)} worker failed to resolve the merge conflict automatically.`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      const shouldCleanup = succeeded
        ? workflowSettings.cleanupWorktreeOnSuccess
        : workflowSettings.cleanupWorktreeOnFailure;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved merge-resolution worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private async runMergeIntoSource(worktreePath: string, targetBranch: string, sessionId: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["merge", "--no-ff", "--no-commit", `origin/${targetBranch}`], worktreePath);
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Prepared merge of origin/${targetBranch} into the source branch without conflicts.`,
      });
      return false;
    } catch (error) {
      const unresolved = await this.listUnresolvedFiles(worktreePath);
      if (unresolved.length === 0) {
        throw error;
      }
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Merge produced conflicts in: ${unresolved.join(", ")}`,
      });
      return true;
    }
  }

  private async runProviderWithRetry(args: {
    provider: DashboardSettings["workers"]["virtualWorkerProvider"];
    providerPrompt: string;
    workflowSettings: DashboardSettings["cliWorkflow"];
    repoPath: string;
    worktreePath: string;
    sessionId: string;
    model: string;
    apiKey: string;
    githubToken: string;
  }): Promise<void> {
    const runProvider = async (prompt: string) => await this.providerRunner.runProvider({
      provider: args.provider,
      prompt,
      cwd: args.worktreePath,
      model: args.model,
      apiKey: args.apiKey,
      sessionId: args.sessionId,
      workflowSettings: args.workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
      onActivity: (description, originator) => {
        this.deps.sessionTracking.appendActivity(args.sessionId, {
          originator: originator || "system",
          description,
        });
      },
    });

    let result = await runProvider(args.providerPrompt);
    if (!result.ok && args.workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(result)) {
      this.deps.sessionTracking.appendActivity(args.sessionId, {
        originator: "system",
        description: "Retrying merge-conflict resolution with file-discovery guidance.",
      });
      result = await runProvider(buildReadFileRetryPrompt(args.providerPrompt));
    }
    if (!result.ok) {
      const classification = classifyProviderError(args.provider, result);
      if (classification.category !== "UNKNOWN") {
        throw new ProviderQuotaError(classification);
      }
      throw new Error(classification.userMessage);
    }
  }

  private async ensureMergeConflictResolved(worktreePath: string): Promise<void> {
    const unresolved = await this.listUnresolvedFiles(worktreePath);
    if (unresolved.length > 0) {
      throw new Error(`Unresolved merge conflicts remain: ${unresolved.join(", ")}`);
    }
  }

  private async listUnresolvedFiles(worktreePath: string): Promise<string[]> {
    const result = await runCommandStrict("git", ["diff", "--name-only", "--diff-filter=U"], worktreePath);
    return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
  }

  private async finalizeMergeCommit(worktreePath: string, sourceBranch: string, targetBranch: string): Promise<void> {
    const mergeHead = await this.hasMergeHead(worktreePath);
    const status = (await runCommandStrict("git", ["status", "--porcelain"], worktreePath)).stdout.trim();
    if (!mergeHead && status.length === 0) {
      return;
    }

    await runCommandStrict("git", ["add", "-A"], worktreePath);
    try {
      await runCommandStrict(
        "git",
        ["commit", "-m", `Resolve merge conflict: ${targetBranch} into ${sourceBranch}`],
        worktreePath,
      );
    } catch (error) {
      const nextStatus = (await runCommandStrict("git", ["status", "--porcelain"], worktreePath)).stdout.trim();
      if (nextStatus.length > 0 || await this.hasMergeHead(worktreePath)) {
        throw error;
      }
    }
  }

  private async hasMergeHead(worktreePath: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], worktreePath);
      return true;
    } catch {
      return false;
    }
  }

  private buildMergeConflictPrompt(
    item: ProjectAttentionItemRecord,
    sourceBranch: string,
    targetBranch: string,
    workspaceGuidance: string,
  ): string {
    const payload = item.payload || {};
    const mergedTaskPrompts = this.extractMergeConflictTaskPrompts(
      Array.isArray(payload.mergedTaskPrompts)
        ? payload.mergedTaskPrompts
        : Array.isArray(payload.featureBranchTaskContexts)
          ? payload.featureBranchTaskContexts
          : [],
    );
    const currentTaskPrompt = this.extractCurrentTaskPrompt(payload);

    return [
      "Resolve the active Git merge conflict already present in this worktree.",
      `Source branch: ${sourceBranch}`,
      `Target branch: ${targetBranch}`,
      "",
      "Requirements:",
      "- Preserve the intended work from both branches.",
      "- Resolve only the conflict and any directly related fallout.",
      "- Leave the branch in a clean, committed, pushable state.",
      "- Do not open a new pull request or rewrite history.",
      "",
      currentTaskPrompt ? "Current task prompt:" : null,
      currentTaskPrompt || null,
      mergedTaskPrompts.length > 0 ? "\nMerged task prompts already present on the target branch:" : null,
      mergedTaskPrompts.length > 0 ? mergedTaskPrompts.join("\n\n") : null,
      "",
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private extractCurrentTaskPrompt(payload: Record<string, unknown>): string {
    if (typeof payload.currentTaskPrompt === "string" && payload.currentTaskPrompt.trim()) {
      return payload.currentTaskPrompt.trim();
    }

    const currentTask = this.asRecord(payload.currentTask);
    if (typeof currentTask?.taskPrompt === "string" && currentTask.taskPrompt.trim()) {
      return currentTask.taskPrompt.trim();
    }

    if (typeof payload.taskPrompt === "string" && payload.taskPrompt.trim()) {
      return payload.taskPrompt.trim();
    }

    return "";
  }

  private extractMergeConflictTaskPrompts(entries: unknown[]): string[] {
    return entries
      .map((entry) => this.asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        const taskKey = typeof entry.taskKey === "string" ? entry.taskKey : "task";
        const title = typeof entry.taskTitle === "string"
          ? entry.taskTitle
          : typeof entry.title === "string"
            ? entry.title
            : taskKey;
        const prompt = typeof entry.taskPrompt === "string"
          ? entry.taskPrompt
          : typeof entry.prompt === "string"
            ? entry.prompt
            : "";
        return `${taskKey} ${title}\n\n${prompt}`.trim();
      })
      .filter(Boolean);
  }

  private escalateAttentionToHuman(workerEndpointId: string, item: ProjectAttentionItemRecord, summaryMarkdown: string): void {
    this.deps.projectAttentionService.openItem({
      projectId: item.projectId,
      sprintId: item.sprintId,
      taskId: item.taskId,
      sprintRunId: item.sprintRunId,
      dispatchId: item.dispatchId,
      attentionType: "human_escalation_required",
      severity: item.severity,
      ownerType: "human",
      title: `Virtual worker escalation: ${item.title}`,
      summaryMarkdown,
      payload: {
        ...(item.payload || {}),
        sourceAttentionItemId: item.id,
        sourceAttentionType: item.attentionType,
        escalatedBy: "virtual_worker",
      },
    });
    this.deps.projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: "virtual_worker_escalated",
      resolutionSummaryMarkdown: summaryMarkdown,
      workerEndpointId,
      payloadPatch: {
        workerOutcome: "needs_human_escalation",
      },
    });
  }

  private cleanupOrphanedVirtualWorkers(): void {
    const orphaned = this.deps.workerEndpointRepository.listWorkerEndpoints()
      .filter((endpoint) => endpoint.endpointType === "virtual_cli");

    for (const endpoint of orphaned) {
      for (const assignment of this.deps.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(endpoint.id)) {
        this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(assignment.projectId, endpoint.id, "virtual_worker_startup_prune");
      }
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private getProviderLabel(provider: DashboardSettings["workers"]["virtualWorkerProvider"]): string {
    switch (provider) {
      case "claude-code":
        return "Claude Code";
      case "gemini":
        return "Gemini";
      case "codex":
      default:
        return "Codex";
    }
  }

  private readRequiredString(value: unknown, label: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new Error(`Missing ${label} in virtual worker attention payload.`);
    }
    return normalized;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }
}
