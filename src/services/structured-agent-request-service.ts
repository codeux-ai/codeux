import { randomUUID } from "crypto";
import type { AgentSelfReflectionLoopSettings, DashboardSettings, ProviderId, QwenModelProviderSettings, VirtualWorkerProvider } from "../contracts/app-types.js";
import type { ProviderInvocationPurpose } from "../contracts/execution-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import { StructuredProviderResponseService, type StructuredExecutionArgs, type StructuredProviderResult } from "./structured-provider-response-service.js";
import { extractJsonFromText } from "../domain/llm/json-extraction.js";

export interface StructuredRequestArgs<T> {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  taskRunId?: string | null;
  purpose: ProviderInvocationPurpose;
  type: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  maxConcurrentTasks?: number;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  customBaseUrl?: string;
  customModel?: string;
  providerPrompt: string;
  repoPath: string;
  cwd?: string;
  workspaceSessionId?: string;
  settings: DashboardSettings;
  parseFn: (text: string) => T;
  buildRetryPrompt: (error: Error) => string;
  providerLabel: string;
  sessionIdPrefix: string;
  logicalSessionId?: string;
  continueSessionId?: string | null;
  openCodeBaselineRawUsageJson?: Record<string, unknown> | null;
  invocationId?: string;
  systemRoutingMessage?: string;
  maxRetries?: number;
  githubToken?: string;
  signal?: AbortSignal;
  onActivity?: (description: string, originator?: string) => void;
  agentMcpAccess?: AgentMcpAccessConfig | null;
  mcpAgentId?: string | null;
}

export interface StructuredAgentRequestResult<T> extends StructuredProviderResult<T> {
  sessionId: string;
  invocationId: string;
}

interface ReflectionCriterionResult {
  id: string;
  label: string;
  score: number;
  rationale: string;
  improvementInstructions: string;
  threshold: number;
  passed: boolean;
}

interface ReflectionEvaluation {
  criteria: ReflectionCriterionResult[];
  passed: boolean;
}

interface ReflectionRunState {
  parsed: unknown;
  bodyMarkdown: string;
  nativeSessionId: string | null;
  continueSessionId: string | null;
  openCodeBaselineRawUsageJson: Record<string, unknown> | null;
  attemptCount: number;
  finalDecision: "passed" | "max_attempts_reached" | "reflection_failed" | "improvement_failed";
}

export interface StructuredAgentRequestServiceDeps {
  executionRepository?: ExecutionRepository;
  structuredProviderResponseService: StructuredProviderResponseService;
  logger?: Logger;
}

export class StructuredAgentRequestService {
  constructor(private readonly deps: StructuredAgentRequestServiceDeps) {}

  async executeRequest<T>(args: StructuredRequestArgs<T>): Promise<StructuredAgentRequestResult<T>> {
    const sessionId = args.logicalSessionId || `${args.sessionIdPrefix}-${args.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const maxRetries = this.resolveStructuredRetryCount(args);
    const maxProviderAttempts = this.resolveMaxProviderAttempts(args, maxRetries);

    let invocationId = args.invocationId;
    if (!invocationId) {
      const invocation = this.deps.executionRepository?.createExecutionInvocation({
        projectId: args.projectId,
        skipValidation: true,
        sprintId: args.sprintId || null,
        taskId: args.taskId || null,
        sprintRunId: args.sprintRunId || null,
        taskRunId: args.taskRunId || null,
        type: args.type,
        provider: args.provider,
        model: args.model,
        startedAt: new Date().toISOString(),
      });
      invocationId = invocation?.id;
    } else {
      this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
        provider: args.provider,
        model: args.model,
      });
    }

    if (invocationId && args.systemRoutingMessage) {
      const existingMessages = this.deps.executionRepository?.listExecutionInvocationMessages(invocationId) || [];
      const hasRouteMessage = existingMessages.some(
        msg => msg.role === "system" &&
               msg.contentMarkdown === args.systemRoutingMessage &&
               msg.metadata?.routeKind === "virtual"
      );

      if (!hasRouteMessage) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(invocationId, {
          role: "system",
          contentMarkdown: args.systemRoutingMessage,
          metadata: {
            provider: args.provider,
            model: args.model,
            routeKind: "virtual",
          },
        });
      }
    }

    const result = await this.deps.structuredProviderResponseService.executeAndParse<T>({
      projectId: args.projectId,
      sprintId: args.sprintId || null,
      taskId: args.taskId || null,
      sprintRunId: args.sprintRunId || null,
      taskRunId: args.taskRunId || null,
      purpose: args.purpose,
      type: args.type,
      provider: args.provider as VirtualWorkerProvider,
      maxConcurrentTasks: args.maxConcurrentTasks,
      prompt: args.providerPrompt,
      cwd: args.cwd,
      model: args.model,
      apiKey: args.apiKey,
      qwenAuthMode: args.qwenAuthMode,
      qwenRegion: args.qwenRegion,
      qwenBaseUrl: args.qwenBaseUrl,
      qwenEnvKey: args.qwenEnvKey,
      qwenModelId: args.qwenModelId,
      qwenProtocol: args.qwenProtocol,
      qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
      providerMountAuth: args.providerMountAuth,
      providerAuthPath: args.providerAuthPath,
      customBaseUrl: args.customBaseUrl,
      customModel: args.customModel,
      sessionId,
      workspaceSessionId: args.workspaceSessionId,
      workflowSettings: args.settings.cliWorkflow,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
      signal: args.signal,
      invocationId,
      continueSessionId: args.continueSessionId,
      openCodeBaselineRawUsageJson: args.openCodeBaselineRawUsageJson,
      onActivity: args.onActivity,
      agentMcpAccess: args.agentMcpAccess,
      mcpAgentId: args.mcpAgentId,
      settings: args.settings,
      maxRetries,
      maxProviderAttempts,
      retryProviderFailures: args.purpose === "planning",
      providerLabel: args.providerLabel,
      parseFn: args.parseFn,
      buildRetryPrompt: args.buildRetryPrompt,
    });

    const reflected = await this.runSelfReflectionIfEnabled(args, {
      parsed: result.parsed,
      bodyMarkdown: result.bodyMarkdown,
      nativeSessionId: result.nativeSessionId,
      continueSessionId: result.nativeSessionId || sessionId,
      openCodeBaselineRawUsageJson: result.openCodeBaselineRawUsageJson || args.openCodeBaselineRawUsageJson || null,
      attemptCount: 0,
      finalDecision: "passed",
    }, sessionId, invocationId, maxRetries);

    return {
      parsed: reflected.parsed as T,
      bodyMarkdown: reflected.bodyMarkdown,
      nativeSessionId: reflected.nativeSessionId,
      sessionId,
      invocationId: invocationId || "",
    };
  }

  private async runSelfReflectionIfEnabled<T>(
    args: StructuredRequestArgs<T>,
    initial: ReflectionRunState,
    sessionId: string,
    invocationId: string | undefined,
    maxRetries: number,
  ): Promise<ReflectionRunState> {
    const settings = this.resolveReflectionSettings(args);
    if (!settings || !settings.enabled || settings.criteria.length === 0) {
      return initial;
    }

    let state = initial;
    let evaluation: ReflectionEvaluation | null = null;
    const maxImprovementAttempts = Math.max(0, Math.floor(settings.maxImprovementAttempts));

    for (let attempt = 0; attempt <= maxImprovementAttempts; attempt += 1) {
      try {
        evaluation = await this.evaluateReflection(args, settings, state, sessionId, invocationId, attempt, maxRetries);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn(`${args.purpose} self-reflection failed; keeping last valid output`, {
          projectId: args.projectId,
          sprintId: args.sprintId || null,
          taskId: args.taskId || null,
          attempt,
          error: message,
        });
        this.persistReflectionMetadata(invocationId, {
          event: "reflection_failed",
          purpose: args.purpose,
          attempt,
          criteria: settings.criteria,
          passed: false,
          finalDecision: "reflection_failed",
          errorMessage: message,
        });
        return {
          ...state,
          attemptCount: attempt,
          finalDecision: "reflection_failed",
        };
      }

      this.persistReflectionMetadata(invocationId, {
        event: "reflection_evaluated",
        purpose: args.purpose,
        attempt,
        criteria: settings.criteria,
        scores: evaluation.criteria,
        passed: evaluation.passed,
        finalDecision: evaluation.passed ? "passed" : attempt >= maxImprovementAttempts ? "max_attempts_reached" : "improvement_requested",
      });

      if (evaluation.passed) {
        return {
          ...state,
          attemptCount: attempt,
          finalDecision: "passed",
        };
      }

      if (attempt >= maxImprovementAttempts) {
        return {
          ...state,
          attemptCount: attempt,
          finalDecision: "max_attempts_reached",
        };
      }

      try {
        const improved = await this.requestReflectionImprovement(args, evaluation, state, sessionId, invocationId, maxRetries);
        state = {
          parsed: improved.parsed,
          bodyMarkdown: improved.bodyMarkdown,
          nativeSessionId: improved.nativeSessionId,
          continueSessionId: improved.nativeSessionId || state.continueSessionId || sessionId,
          openCodeBaselineRawUsageJson: improved.openCodeBaselineRawUsageJson || state.openCodeBaselineRawUsageJson,
          attemptCount: attempt + 1,
          finalDecision: "passed",
        };
        this.persistReflectionMetadata(invocationId, {
          event: "reflection_improved",
          purpose: args.purpose,
          attempt: attempt + 1,
          criteria: settings.criteria,
          passed: false,
          finalDecision: "improvement_parsed",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.logger?.warn(`${args.purpose} self-reflection improvement failed; keeping last valid output`, {
          projectId: args.projectId,
          sprintId: args.sprintId || null,
          taskId: args.taskId || null,
          attempt: attempt + 1,
          error: message,
        });
        this.persistReflectionMetadata(invocationId, {
          event: "reflection_improvement_failed",
          purpose: args.purpose,
          attempt: attempt + 1,
          criteria: settings.criteria,
          scores: evaluation.criteria,
          passed: false,
          finalDecision: "improvement_failed",
          errorMessage: message,
        });
        return {
          ...state,
          attemptCount: attempt + 1,
          finalDecision: "improvement_failed",
        };
      }
    }

    return state;
  }

  private resolveReflectionSettings<T>(args: StructuredRequestArgs<T>): AgentSelfReflectionLoopSettings | null {
    if (args.purpose === "planning") {
      return args.settings.agents?.selfReflection?.planning || null;
    }
    if (args.purpose === "qa_review") {
      return args.settings.agents?.selfReflection?.qualityAssurance || null;
    }
    return null;
  }

  private async evaluateReflection<T>(
    args: StructuredRequestArgs<T>,
    settings: AgentSelfReflectionLoopSettings,
    state: ReflectionRunState,
    sessionId: string,
    invocationId: string | undefined,
    attempt: number,
    maxRetries: number,
  ): Promise<ReflectionEvaluation> {
    const prompt = this.buildReflectionEvaluationPrompt(args.purpose, args.providerPrompt, state.parsed, settings, attempt);
    const result = await this.deps.structuredProviderResponseService.executeAndParse<ReflectionEvaluation>({
      ...this.buildReflectionExecutionArgs(args, sessionId, invocationId, state.continueSessionId, state.openCodeBaselineRawUsageJson, maxRetries),
      prompt,
      parseFn: (text) => this.parseReflectionEvaluation(text, settings),
      buildRetryPrompt: (error) => [
        "Your previous self-reflection response was not valid JSON.",
        `Validation error: ${error.message}`,
        "",
        "Return JSON only with the requested criteria ratings.",
      ].join("\n"),
      retryProviderFailures: false,
      maxProviderAttempts: undefined,
    });
    state.continueSessionId = result.nativeSessionId || state.continueSessionId || sessionId;
    state.openCodeBaselineRawUsageJson = result.openCodeBaselineRawUsageJson || state.openCodeBaselineRawUsageJson;
    return result.parsed;
  }

  private async requestReflectionImprovement<T>(
    args: StructuredRequestArgs<T>,
    evaluation: ReflectionEvaluation,
    state: ReflectionRunState,
    sessionId: string,
    invocationId: string | undefined,
    maxRetries: number,
  ): Promise<StructuredProviderResult<T>> {
    const prompt = this.buildReflectionImprovementPrompt(args.purpose, args.providerPrompt, state.parsed, evaluation);
    return await this.deps.structuredProviderResponseService.executeAndParse<T>({
      ...this.buildReflectionExecutionArgs(args, sessionId, invocationId, state.continueSessionId, state.openCodeBaselineRawUsageJson, maxRetries),
      prompt,
      parseFn: args.parseFn,
      buildRetryPrompt: args.buildRetryPrompt,
      retryProviderFailures: false,
      maxProviderAttempts: undefined,
    });
  }

  private buildReflectionExecutionArgs<T>(
    args: StructuredRequestArgs<T>,
    sessionId: string,
    invocationId: string | undefined,
    continueSessionId: string | null,
    openCodeBaselineRawUsageJson: Record<string, unknown> | null,
    maxRetries: number,
  ): StructuredExecutionArgs<unknown> {
    return {
      projectId: args.projectId,
      sprintId: args.sprintId || null,
      taskId: args.taskId || null,
      sprintRunId: args.sprintRunId || null,
      taskRunId: args.taskRunId || null,
      purpose: args.purpose,
      type: args.type,
      provider: args.provider as VirtualWorkerProvider,
      maxConcurrentTasks: args.maxConcurrentTasks,
      prompt: "",
      cwd: args.cwd,
      model: args.model,
      apiKey: args.apiKey,
      qwenAuthMode: args.qwenAuthMode,
      qwenRegion: args.qwenRegion,
      qwenBaseUrl: args.qwenBaseUrl,
      qwenEnvKey: args.qwenEnvKey,
      qwenModelId: args.qwenModelId,
      qwenProtocol: args.qwenProtocol,
      qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
      openCodeAuthMode: args.openCodeAuthMode,
      openCodeProviderId: args.openCodeProviderId,
      openCodeModelId: args.openCodeModelId,
      openCodeBaseUrl: args.openCodeBaseUrl,
      openCodeEnvKey: args.openCodeEnvKey,
      openCodePackage: args.openCodePackage,
      providerMountAuth: args.providerMountAuth,
      providerAuthPath: args.providerAuthPath,
      customBaseUrl: args.customBaseUrl,
      customModel: args.customModel,
      sessionId,
      workspaceSessionId: args.workspaceSessionId,
      workflowSettings: args.settings.cliWorkflow,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
      signal: args.signal,
      invocationId,
      continueSessionId,
      openCodeBaselineRawUsageJson: args.provider === "opencode" ? openCodeBaselineRawUsageJson : undefined,
      onActivity: args.onActivity,
      settings: args.settings,
      maxRetries,
      providerLabel: args.providerLabel,
      parseFn: (text: string) => text,
      buildRetryPrompt: (error: Error) => error.message,
    };
  }

  private buildReflectionEvaluationPrompt(
    purpose: ProviderInvocationPurpose,
    originalPrompt: string,
    parsedOutput: unknown,
    settings: AgentSelfReflectionLoopSettings,
    attempt: number,
  ): string {
    return [
      "You are evaluating your own structured output for Code UX.",
      `Invocation purpose: ${purpose}.`,
      `Reflection attempt: ${attempt}.`,
      "",
      "Rate the parsed output against each criterion from 1 to 10. Use the threshold as the minimum passing score after converting it to a 10-point scale.",
      "",
      "## Original Prompt",
      originalPrompt,
      "",
      "## Parsed Output",
      JSON.stringify(parsedOutput, null, 2),
      "",
      "## Criteria",
      ...settings.criteria.map((criterion) => `- ${criterion.id} (${criterion.label}): ${criterion.prompt} Threshold: ${(criterion.threshold * 10).toFixed(1)}/10.`),
      "",
      "## Required Output",
      "Return JSON only with this exact shape:",
      "{\"criteria\":[{\"id\":\"criterion_id\",\"score\":8,\"rationale\":\"Brief reason\",\"improvementInstructions\":\"Specific instruction if below threshold, otherwise empty string\"}]}",
    ].join("\n");
  }

  private buildReflectionImprovementPrompt(
    purpose: ProviderInvocationPurpose,
    originalPrompt: string,
    parsedOutput: unknown,
    evaluation: ReflectionEvaluation,
  ): string {
    const failed = evaluation.criteria.filter((criterion) => !criterion.passed);
    return [
      "Improve your previous structured JSON output for Code UX.",
      `Invocation purpose: ${purpose}.`,
      "",
      "Keep the original output contract exactly. Return only the improved JSON payload for the original request, with no markdown fences or commentary.",
      "",
      "## Original Prompt",
      originalPrompt,
      "",
      "## Previous Parsed Output",
      JSON.stringify(parsedOutput, null, 2),
      "",
      "## Required Improvements",
      ...failed.map((criterion) => [
        `- ${criterion.id} (${criterion.label}) scored ${criterion.score}/10; threshold ${(criterion.threshold * 10).toFixed(1)}/10.`,
        `  Rationale: ${criterion.rationale}`,
        `  Improvement: ${criterion.improvementInstructions || "Raise this criterion while preserving the requested JSON schema."}`,
      ].join("\n")),
    ].join("\n");
  }

  private parseReflectionEvaluation(text: string, settings: AgentSelfReflectionLoopSettings): ReflectionEvaluation {
    const extraction = extractJsonFromText(text);
    if (!extraction.success) {
      throw new Error("Self-reflection reply was not valid JSON.");
    }
    const payload = extraction.data;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("Self-reflection payload must be a JSON object.");
    }
    const criteriaPayload = (payload as Record<string, unknown>).criteria;
    if (!Array.isArray(criteriaPayload)) {
      throw new Error("Self-reflection payload must include a criteria array.");
    }

    const byId = new Map(settings.criteria.map((criterion) => [criterion.id, criterion]));
    const results: ReflectionCriterionResult[] = [];
    for (const entry of criteriaPayload) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        continue;
      }
      const input = entry as Record<string, unknown>;
      const id = typeof input.id === "string" ? input.id.trim() : "";
      const setting = byId.get(id);
      if (!setting) {
        continue;
      }
      const score = typeof input.score === "number" && Number.isFinite(input.score)
        ? Math.max(1, Math.min(10, input.score))
        : Number.NaN;
      if (!Number.isFinite(score)) {
        throw new Error(`Self-reflection criterion "${id}" is missing a numeric score.`);
      }
      results.push({
        id,
        label: setting.label,
        score,
        rationale: typeof input.rationale === "string" ? input.rationale.trim() : "",
        improvementInstructions: typeof input.improvementInstructions === "string" ? input.improvementInstructions.trim() : "",
        threshold: setting.threshold,
        passed: score / 10 >= setting.threshold,
      });
    }

    const missing = settings.criteria.filter((criterion) => !results.some((result) => result.id === criterion.id));
    if (missing.length > 0) {
      throw new Error(`Self-reflection payload is missing criteria: ${missing.map((criterion) => criterion.id).join(", ")}`);
    }

    return {
      criteria: results,
      passed: results.every((result) => result.passed),
    };
  }

  private persistReflectionMetadata(
    invocationId: string | undefined,
    metadata: {
      event: string;
      purpose: ProviderInvocationPurpose;
      attempt: number;
      criteria: AgentSelfReflectionLoopSettings["criteria"];
      scores?: ReflectionCriterionResult[];
      passed: boolean;
      finalDecision: string;
      errorMessage?: string;
    },
  ): void {
    if (!invocationId) {
      return;
    }
    this.deps.executionRepository?.appendExecutionInvocationMessage(invocationId, {
      role: "system",
      contentMarkdown: `Self-reflection ${metadata.event} for ${metadata.purpose}: ${metadata.finalDecision}.`,
      metadata: {
        reflection: {
          event: metadata.event,
          purpose: metadata.purpose,
          attempt: metadata.attempt,
          criteria: metadata.criteria.map((criterion) => ({
            id: criterion.id,
            label: criterion.label,
            threshold: criterion.threshold,
          })),
          scores: metadata.scores?.map((score) => ({
            id: score.id,
            label: score.label,
            score: score.score,
            threshold: score.threshold,
            passed: score.passed,
            rationale: score.rationale,
            improvementInstructions: score.improvementInstructions,
          })) || [],
          passed: metadata.passed,
          finalDecision: metadata.finalDecision,
          errorMessage: metadata.errorMessage,
        },
      },
    });
  }

  private resolveStructuredRetryCount<T>(args: StructuredRequestArgs<T>): number {
    if (args.maxRetries !== undefined) {
      return args.maxRetries;
    }
    if (args.purpose === "planning") {
      return args.settings.cliWorkflow?.maxPlanningJsonRetries
        ?? args.settings.cliWorkflow?.maxParsingRetries
        ?? 3;
    }
    return args.settings.cliWorkflow?.maxParsingRetries ?? 3;
  }

  private resolveMaxProviderAttempts<T>(args: StructuredRequestArgs<T>, maxRetries: number): number | undefined {
    if (args.purpose !== "planning") {
      return undefined;
    }
    const planningCap = args.settings.guardrails?.enabled
      ? args.settings.guardrails.jobs?.planning?.cap
      : 0;
    if (planningCap && planningCap > 0) {
      return planningCap;
    }
    return maxRetries + 1;
  }
}
