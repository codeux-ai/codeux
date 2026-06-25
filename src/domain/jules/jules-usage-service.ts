import { getEncoding, type Tiktoken } from "js-tiktoken";
import type { JulesClient } from "./jules-client.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { Logger } from "../../shared/logging/logger.js";
import type {
  CreateProviderInvocationUsageInput,
  UpdateProviderInvocationUsageInput,
} from "../../contracts/execution-types.js";
import type { AppendExecutionInvocationMessageInput } from "../../contracts/invocation-types.js";
import type { JulesActivity, JulesSession } from "../../contracts/app-types.js";
import { estimateJulesUsage, type JulesUsageEstimate } from "./jules-usage-estimator.js";
import {
  MAX_MESSAGE_CONTENT_CHARS,
  truncateForStorage,
} from "../../services/invocation-message-limits.js";
import { isNotFoundError } from "../../integrations/jules-api-client.js";

type GitMetrics = { insertions?: number; deletions?: number; filesChanged?: number } | null | undefined;

/** Minimum interval between live (non-terminal) syncs for the same session, so
 *  the live conversation refreshes without hammering the Jules API on every
 *  sprint sync tick. Terminal syncs bypass this throttle. */
const LIVE_SYNC_THROTTLE_MS = 8_000;

/**
 * Estimates and persists Jules token usage and the conversation transcript.
 *
 * The Jules Agent API reports no token usage, so usage is **estimated** from
 * the activity stream (see {@link estimateJulesUsage}). This service both
 * computes that estimate and mirrors the conversation into an execution
 * invocation so the dashboard renders Jules sessions with the same rich,
 * per-message chat indicators as the CLI providers — live during the run and
 * authoritatively at completion.
 */
export class JulesUsageService {
  private encoder: Tiktoken | null = null;
  private readonly lastLiveSyncMsBySession = new Map<string, number>();

  constructor(
    private readonly julesClient: JulesClient,
    private readonly executionRepository: ExecutionRepository,
    private readonly logger: Logger
  ) {}

  private countTokens(text: string): number {
    if (!text) {
      return 0;
    }
    if (!this.encoder) {
      this.encoder = getEncoding("cl100k_base");
    }
    return this.encoder.encode(text).length;
  }

  /**
   * Terminal sync: recomputes the authoritative usage estimate and rebuilds the
   * conversation once a session reaches a terminal state. Skips work when a
   * non-zero estimate was already saved (the previous behaviour callers rely on).
   */
  async calculateAndSaveUsageForTask(
    projectId: string,
    taskId: string,
    sessionId: string,
    passedPrompt?: string,
    gitMetrics?: GitMetrics
  ): Promise<void> {
    try {
      const existingRecord = this.executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding");
      if (existingRecord && existingRecord.totalTokens && existingRecord.totalTokens > 0) {
        this.logger.info("Jules usage telemetry already calculated and saved for session", { sessionId });
        return;
      }

      const hasSafeContext = Boolean(passedPrompt || existingRecord);
      let activities: JulesActivity[];
      try {
        activities = await this.julesClient.getFullConversation(sessionId);
      } catch (error) {
        if (isNotFoundError(error)) {
          if (!hasSafeContext) {
            this.logger.info("Skipping Jules usage telemetry for missing session (no existing prompt/record)", { sessionId });
            return;
          }
          activities = [];
        } else {
          throw error;
        }
      }

      const resolved = await this.resolvePromptAndGitMetrics(sessionId, passedPrompt, gitMetrics);

      this.persist({
        projectId,
        taskId,
        sessionId,
        activities,
        prompt: resolved.prompt,
        gitMetrics: resolved.gitMetrics,
        final: true,
      });
    } catch (error) {
      this.logger.error("Failed to calculate and save Jules usage telemetry", {
        error,
        projectId,
        taskId,
        sessionId,
      });
    }
  }

  /**
   * Live sync: refreshes the running usage estimate and conversation while a
   * session is still active, so the dashboard shows messages and token counts
   * in real time. Throttled per session to bound Jules API traffic.
   */
  async syncLiveInvocation(
    projectId: string,
    taskId: string,
    sessionId: string,
    prompt?: string,
    gitMetrics?: GitMetrics
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastLiveSyncMsBySession.get(sessionId) ?? 0;
    if (now - last < LIVE_SYNC_THROTTLE_MS) {
      return;
    }
    this.lastLiveSyncMsBySession.set(sessionId, now);

    try {
      const activities = await this.julesClient.getFullConversation(sessionId);
      if (activities.length === 0 && !prompt) {
        return;
      }
      this.persist({
        projectId,
        taskId,
        sessionId,
        activities,
        prompt: prompt || "",
        gitMetrics,
        final: false,
      });
    } catch (error) {
      if (isNotFoundError(error)) {
        this.logger.debug("Live Jules session is not available (404), skipping live sync", { sessionId });
      } else {
        this.logger.warn("Failed live Jules invocation sync", { error, sessionId });
      }
    }
  }

  /** Resolves the session prompt and PR git stats, fetching the session only
   *  when the caller did not already provide them. */
  private async resolvePromptAndGitMetrics(
    sessionId: string,
    passedPrompt: string | undefined,
    gitMetrics: GitMetrics,
  ): Promise<{ prompt: string; gitMetrics: { insertions: number; deletions: number; filesChanged: number } }> {
    let prompt = passedPrompt || "";
    let insertions = gitMetrics?.insertions ?? 0;
    let deletions = gitMetrics?.deletions ?? 0;
    let filesChanged = gitMetrics?.filesChanged ?? 0;

    if (!passedPrompt && !gitMetrics) {
      try {
        const session = await this.julesClient.getSession(sessionId);
        prompt = session.prompt || "";
        const pr = extractPullRequest(session);
        if (pr) {
          insertions = parseStat(pr.insertions);
          deletions = parseStat(pr.deletions);
          filesChanged = parseStat(pr.filesChanged);
        }
      } catch (err) {
        if (isNotFoundError(err)) {
          this.logger.debug("Failed to fetch Jules session details (404/not found)", { sessionId });
        } else {
          this.logger.warn("Failed to fetch Jules session details", { sessionId, error: err });
        }
      }
    }

    return { prompt, gitMetrics: { insertions, deletions, filesChanged } };
  }

  /** Upserts the usage record + execution invocation, rebuilds the conversation,
   *  and writes the (re)computed estimate. Idempotent: safe to call repeatedly. */
  private persist(args: {
    projectId: string;
    taskId: string;
    sessionId: string;
    activities: JulesActivity[];
    prompt: string;
    gitMetrics: GitMetrics;
    final: boolean;
  }): void {
    const { projectId, taskId, sessionId, activities, prompt, gitMetrics, final } = args;

    const estimate = estimateJulesUsage({
      prompt,
      activities,
      gitMetrics,
      countTokens: (text) => this.countTokens(text),
    });

    const status = final ? "completed" : "running";

    let record = this.executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding");
    if (!record) {
      const createInput: CreateProviderInvocationUsageInput = {
        projectId,
        taskId,
        sessionId,
        provider: "jules",
        purpose: "task_coding",
        status,
        invocationSource: "EXTERNAL_API",
      };
      record = this.executionRepository.createProviderInvocationUsage(createInput);
    }

    const updateInput: UpdateProviderInvocationUsageInput = {
      status,
      inputTokens: estimate.inputTokens,
      cachedInputTokens: estimate.cachedInputTokens,
      outputTokens: estimate.outputTokens,
      reasoningOutputTokens: estimate.reasoningOutputTokens,
      totalTokens: estimate.totalTokens,
      toolCallCount: estimate.toolCallCount,
      julesTokens: estimate.totalTokens,
      usageSource: "estimated",
      transcriptChars: estimate.transcriptChars,
      invocationSource: "EXTERNAL_API",
      rawUsageJson: {
        estimator: "turn-accumulation-v1",
        gitMetrics: {
          insertions: gitMetrics?.insertions ?? 0,
          deletions: gitMetrics?.deletions ?? 0,
          filesChanged: gitMetrics?.filesChanged ?? 0,
        },
      },
    };
    this.executionRepository.updateProviderInvocationUsage(record.id, updateInput);

    const execInvocations = this.executionRepository.listExecutionInvocationsByProviderInvocationId(record.id);
    let execInvocation = execInvocations.length > 0 ? execInvocations[0] : null;
    if (!execInvocation) {
      execInvocation = this.executionRepository.createExecutionInvocation({
        projectId,
        taskId,
        providerInvocationId: record.id,
        type: "task_coding",
        status,
        provider: "jules",
        model: "jules-agent",
        invocationSource: "EXTERNAL_API",
        startedAt: record.createdAt,
      });
    } else {
      this.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status,
        finishedAt: final ? new Date().toISOString() : null,
      });
    }

    // Rebuild the transcript in chronological order. Clearing first keeps the
    // message list authoritative on every (live or final) sync.
    this.executionRepository.clearExecutionInvocationMessages(execInvocation.id);
    for (const message of this.buildConversationMessages(activities, prompt, record.createdAt)) {
      this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, message);
    }

    this.logger.info("Saved Jules usage telemetry and conversation transcript for task", {
      projectId,
      taskId,
      sessionId,
      final,
      inputTokens: estimate.inputTokens,
      outputTokens: estimate.outputTokens,
      totalTokens: estimate.totalTokens,
      toolCallCount: estimate.toolCallCount,
    });
  }

  /** Maps the activity stream to invocation messages with the same chat-indicator
   *  kinds the dashboard uses for CLI providers (user / assistant / tool_call /
   *  tool_result / system). Content is truncated for storage. */
  private buildConversationMessages(
    activities: JulesActivity[],
    prompt: string,
    promptCreatedAt: string,
  ): AppendExecutionInvocationMessageInput[] {
    const messages: AppendExecutionInvocationMessageInput[] = [];
    const base = { provider: "jules", model: "jules-agent" };

    if (prompt) {
      messages.push({
        role: "user",
        contentMarkdown: truncateForStorage(prompt, MAX_MESSAGE_CONTENT_CHARS),
        metadata: base,
        createdAt: promptCreatedAt,
      });
    }

    const sorted = activities
      .slice()
      .sort((a, b) => new Date(a.createTime || 0).getTime() - new Date(b.createTime || 0).getTime());

    for (const activity of sorted) {
      const createdAt = activity.createTime || undefined;
      const push = (message: Omit<AppendExecutionInvocationMessageInput, "createdAt">) =>
        messages.push({ ...message, createdAt });

      if (activity.userMessaged?.userMessage) {
        const text = activity.userMessaged.userMessage;
        if (text !== prompt) {
          push({ role: "user", contentMarkdown: cap(text), metadata: base });
        }
      } else if (activity.agentMessaged?.agentMessage) {
        push({ role: "assistant", contentMarkdown: cap(activity.agentMessaged.agentMessage), metadata: base });
      } else if (activity.planGenerated?.plan?.steps) {
        const stepsMarkdown = activity.planGenerated.plan.steps
          .map((step, index) => `- Step ${index + 1}: ${step.title || "Untitled step"}`)
          .join("\n");
        push({
          role: "assistant",
          contentMarkdown: cap(`Proposed plan:\n\n${stepsMarkdown}`),
          metadata: { ...base, kind: "plan" },
        });
      } else if (activity.planApproved?.planId) {
        push({
          role: "user",
          contentMarkdown: `Approved plan (ID: ${activity.planApproved.planId})`,
          metadata: base,
        });
      } else if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
        const title = activity.progressUpdated.title || "";
        const desc = activity.progressUpdated.description || "";
        push({
          role: "tool",
          contentMarkdown: cap(desc ? `**${title}**\n${desc}` : `**${title}**`),
          metadata: { ...base, kind: "tool_call", toolName: title || "progress" },
        });
      } else if (activity.sessionCompleted !== undefined && activity.sessionCompleted !== null) {
        push({ role: "system", contentMarkdown: "Jules session completed successfully.", metadata: base });
      } else if (activity.sessionFailed?.reason) {
        push({
          role: "system",
          contentMarkdown: cap(`Jules session failed: ${activity.sessionFailed.reason}`),
          metadata: base,
        });
      } else if (activity.description) {
        push({ role: "system", contentMarkdown: cap(activity.description), metadata: base });
      }

      // Code artifacts render as tool results (the patch the agent produced).
      for (const art of activity.artifacts || []) {
        const patch = art.changeSet?.gitPatch?.unidiffPatch;
        if (patch) {
          push({
            role: "tool",
            contentMarkdown: cap(`\`\`\`diff\n${patch}\n\`\`\``),
            toolCallsJson: { output: truncateForStorage(patch, MAX_MESSAGE_CONTENT_CHARS) },
            metadata: { ...base, kind: "tool_result", toolName: "apply_patch" },
          });
        }
      }
    }

    return messages;
  }
}

function cap(text: string): string {
  return truncateForStorage(text, MAX_MESSAGE_CONTENT_CHARS);
}

function extractPullRequest(session: JulesSession): Record<string, unknown> | null {
  const pullRequestOutput = Array.isArray(session.outputs)
    ? session.outputs.find((entry) => entry && typeof entry === "object" && "pullRequest" in entry)
    : undefined;
  return pullRequestOutput && typeof pullRequestOutput.pullRequest === "object"
    ? (pullRequestOutput.pullRequest as Record<string, unknown>)
    : null;
}

function parseStat(val: unknown): number {
  if (typeof val === "number" && !isNaN(val)) {
    return val;
  }
  if (typeof val === "string") {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export type { JulesUsageEstimate };
