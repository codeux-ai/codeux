import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId } from "../../contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../contracts/project-attention-types.js";
import type { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import type { WorkspaceManager } from "../../infrastructure/providers/cli/workspace-manager.js";
import type { WorkspaceArtifactService } from "../../infrastructure/providers/cli/workspace-artifact-service.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "../cli-workflow-utils.js";
import { buildTaskRunKey } from "../task-run-key.js";
import { resolveProviderForInvocation } from "../provider-routing.js";

export interface CiAutofixManagerDependencies {
  workspaceManager: WorkspaceManager;
  workspaceArtifactService: WorkspaceArtifactService;
  sessionTracking: SessionTrackingRepository;
  projectAttentionService: {
    resolveItem(id: string, resolution: any): void;
  };
  escalateAttentionToHuman: (workerEndpointId: string, item: ProjectAttentionItemRecord, summaryMarkdown: string) => void;
  getProviderLabel: (provider: ProviderId) => string;
  resolveDashboardSettings: (projectId: string, sprintId?: string | null) => DashboardSettings;
  runProviderWithRetry: (args: {
    provider: Exclude<ProviderId, "jules">;
    providerPrompt: string;
    workflowSettings: DashboardSettings["cliWorkflow"];
    repoPath: string;
    worktreePath: string;
    sessionId: string;
    attentionItem: ProjectAttentionItemRecord;
    purpose: "ci_fix" | "merge_conflict";
    model: string;
    apiKey: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    githubToken: string;
  }) => Promise<void>;
  runWorkspaceCommand: (worktreePath: string, command: string, args: string[]) => Promise<{ stdout: string, stderr: string }>;
  readRequiredString: (value: unknown, label: string) => string;
}

export class CiAutofixManager {
  private readonly ciAutofixRetryCounts = new Map<string, number>();

  constructor(private readonly deps: CiAutofixManagerDependencies) {}

  async resolveCiFixAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.deps.resolveDashboardSettings(item.projectId, item.sprintId);
    const route = resolveProviderForInvocation(settings, {
      invocation: "ci_fix",
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: ["gemini", "codex", "claude-code"],
    });
    const provider = route.provider as Exclude<ProviderId, "jules">;
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.deps.readRequiredString(payload.repoPath, "repoPath");
    const branchName = this.deps.readRequiredString(
      payload.workerBranch ?? payload.branchName,
      "branchName",
    );

    const retryKey = item.taskId || item.id;
    const retryCount = this.ciAutofixRetryCounts.get(retryKey) || 0;
    const maxRetries = settings.ciIntelligence.julesCiAutofixMaxRetries || 3;

    if (retryCount >= maxRetries) {
      this.deps.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker reached maximum CI autofix retries (${maxRetries}). Escalating to human.`);
      return;
    }

    const sessionId = `virtual-cifix-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let worktreePath = this.deps.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;
    let initialHead = "";

    this.deps.sessionTracking.createSession({
      id: sessionId,
      provider,
      taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
      title,
      prompt: item.summaryMarkdown,
      state: "RUNNING",
      featureBranch: branchName,
      workerBranch: branchName,
      repoPath,
    });
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Virtual worker claimed CI fix for branch ${branchName} (Attempt ${retryCount + 1}/${maxRetries}).`,
    });

    let cleanedUp = false;
    try {
      const prepared = await this.deps.workspaceManager.prepareWorktree(repoPath, worktreePath, branchName, branchName);
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      initialHead = (await this.deps.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();

      const workspaceGuidance = await this.deps.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
      const providerPrompt = buildProviderPrompt(this.buildCiFixPrompt(item, branchName, workspaceGuidance), providerSettings.thinkingMode);
      await this.deps.runProviderWithRetry({
        provider,
        providerPrompt,
        workflowSettings,
        repoPath,
        worktreePath: finalWorktreePath,
        sessionId,
        attentionItem: item,
        purpose: "ci_fix",
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
        githubToken: settings.git.githubToken,
      });

      const patchText = await this.deps.workspaceArtifactService.exportBinaryPatch(finalWorktreePath, initialHead);
      const applyResult = await this.deps.workspaceArtifactService.applyPatchToBranch({
        repoPath,
        baseRef: initialHead,
        workerBranch: branchName,
        patchText,
        commitMessage: `fix(ci): resolve failing checks on ${branchName}`,
      });
      const headSha = applyResult.commitSha || initialHead;
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Pushed CI fix to ${branchName} at ${headSha}.`,
      });

      this.ciAutofixRetryCounts.set(retryKey, retryCount + 1);

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_ci_fix_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.deps.getProviderLabel(provider)} worker fixed CI issues and pushed the updated branch.`,
          `Branch: ${branchName}`,
          `Head SHA: ${headSha}`,
          `Attempt: ${retryCount + 1}/${maxRetries}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          branchName,
          headSha,
          attempt: retryCount + 1,
        },
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to fix CI issues: ${message}`,
      });
      this.deps.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.deps.getProviderLabel(provider)} worker failed to fix CI issues automatically.`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      const shouldCleanup = succeeded
        ? workflowSettings.cleanupWorktreeOnSuccess
        : true;
      if (shouldCleanup) {
        await this.deps.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved CI-fix worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private buildCiFixPrompt(
    item: ProjectAttentionItemRecord,
    branchName: string,
    workspaceGuidance: string,
  ): string {
    const payload = item.payload || {};
    const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks as string[] : [];
    const failedJobLabels = Array.isArray(payload.failedJobLabels) ? payload.failedJobLabels as string[] : [];
    const failedLogSnippets = Array.isArray(payload.failedLogSnippets) ? payload.failedLogSnippets as string[] : [];
    const prUrl = typeof payload.prUrl === "string" ? payload.prUrl : "";
    const prNumber = typeof payload.prNumber === "number" ? payload.prNumber : 0;
    const taskPrompt = typeof payload.taskPrompt === "string" ? payload.taskPrompt.trim() : "";

    return [
      `CI checks have failed for PR #${prNumber} on branch \`${branchName}\`.`,
      prUrl ? `PR URL: ${prUrl}` : null,
      "",
      "Failed checks: " + (failedChecks.length > 0 ? failedChecks.join(", ") : "unknown"),
      failedJobLabels.length > 0 ? "Failed jobs: " + failedJobLabels.join(", ") : null,
      "",
      "Requirements:",
      "- Investigate the CI failures and fix the root cause.",
      "- Commit the necessary changes and leave the branch in a pushable state.",
      "- Do not open a new pull request or rewrite history.",
      "- Continue until the issues causing CI failures are resolved.",
      "",
      failedLogSnippets.length > 0
        ? "Failed job logs (excerpt):\n" + failedLogSnippets.join("\n\n")
        : "Failed job logs were not available from CI metadata. Use `gh run view <run-id> --log-failed` to fetch logs.",
      "",
      taskPrompt ? "Original task prompt:\n" + taskPrompt : null,
      "",
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }
}
