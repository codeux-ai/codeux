import { randomUUID } from "crypto";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { TaskExecutorType, TaskPriority } from "../contracts/project-management-types.js";
import type { McpConnectionRecord, McpConnectionRole } from "../contracts/connection-chat-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ExecutionControlService } from "./execution-control-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import { buildReadFileRetryPrompt, isReadFileNotFoundToolError } from "./cli-workflow-text-utils.js";
import { ProviderRunner, type IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";

interface PlanningAgentServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  connectionChatRepository: ConnectionChatRepository;
  settingsRepository: SettingsRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionControlService: ExecutionControlService;
  providerRunner?: IProviderRunner;
  logger?: Logger;
}

interface ImprovePromptInput {
  name: string;
  goal: string;
}

interface ImprovePromptResult {
  goal: string;
  threadId: string;
  agentId: string;
  workerConnectionId: string | null;
}

interface PlanSprintResult {
  ok: true;
  threadId: string;
  agentId: string;
  createdTaskIds: string[];
  started: boolean;
}

interface PlannedTaskDraft {
  key: string;
  title: string;
  description: string;
  promptMarkdown: string;
  priority?: TaskPriority;
  executorType?: TaskExecutorType;
  dependsOn?: string[];
}

interface PlannedSprintPayload {
  goal?: string;
  tasks: PlannedTaskDraft[];
}

function extractJsonLikeBlock(bodyMarkdown: string): string {
  const trimmed = bodyMarkdown.trim();
  const fencedMatch = trimmed.match(/```[a-zA-Z0-9_-]*\s*([\s\S]*?)```/);
  if (fencedMatch?.[1]?.trim()) {
    return fencedMatch[1].trim();
  }

  const tryBalanced = (openChar: "{" | "[", closeChar: "}" | "]"): string | null => {
    const start = trimmed.indexOf(openChar);
    if (start < 0) {
      return null;
    }
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index]!;
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }
      if (char === openChar) {
        depth += 1;
        continue;
      }
      if (char === closeChar) {
        depth -= 1;
        if (depth === 0) {
          return trimmed.slice(start, index + 1);
        }
      }
    }
    return null;
  };

  return tryBalanced("{", "}") || tryBalanced("[", "]") || trimmed;
}

export class PlanningAgentService {
  private readonly providerRunner: IProviderRunner;

  constructor(private readonly deps: PlanningAgentServiceDeps) {
    this.providerRunner = deps.providerRunner || new ProviderRunner(new DockerRunner());
  }

  async improveSprintPrompt(projectId: string, input: ImprovePromptInput): Promise<ImprovePromptResult> {
    const project = this.requireProject(projectId);
    const planningAgent = await this.deps.agentPresetSyncService.getPlanningAgent(projectId);
    const runtime = this.resolvePlanningRuntime(projectId);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;
    const thread = this.deps.connectionChatRepository.createThread(projectId, {
      title: `Planning agent · ${input.name.trim() || "Untitled sprint"} · Improve`,
      connectionId: worker?.id,
    });

    const prompt = this.buildImprovePrompt({
      projectName: project.name,
      planningAgent,
      sprintName: input.name,
      goal: input.goal,
    });
    const reply = worker
      ? await this.postRequestAndWaitForReply(projectId, thread.id, worker.id, prompt)
      : await this.runVirtualPlanningRequest({
        projectId,
        threadId: thread.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
      });
    const payload = this.parseJsonReply<{ goal?: string }>(reply.bodyMarkdown);
    const goal = String(payload.goal || "").trim();
    if (!goal) {
      throw new Error("Planning agent reply did not include an improved sprint prompt.");
    }

    return {
      goal,
      threadId: thread.id,
      agentId: planningAgent.id,
      workerConnectionId: worker?.id || null,
    };
  }

  async planSprint(projectId: string, sprintId: string, options: { autoStart: boolean }): Promise<PlanSprintResult> {
    const project = this.requireProject(projectId);
    const sprint = this.requireSprint(projectId, sprintId);
    const planningAgent = await this.deps.agentPresetSyncService.getPlanningAgent(projectId);
    const runtime = this.resolvePlanningRuntime(projectId);
    const worker = runtime.mode === "CONNECTED_MCP" ? runtime.connection : null;
    const existingTasks = this.deps.projectManagementRepository.listTasks(projectId, sprintId);
    if (existingTasks.length > 0) {
      throw new Error(`Sprint ${sprint.name} already has ${existingTasks.length} task(s). Clear or edit them before running Planning agent.`);
    }

    const thread = this.deps.connectionChatRepository.createThread(projectId, {
      title: `Planning agent · ${sprint.name} · Plan`,
      connectionId: worker?.id,
    });

    const prompt = this.buildPlanPrompt({
      projectName: project.name,
      planningAgent,
      sprintNumber: sprint.number,
      sprintName: sprint.name,
      goal: sprint.goal,
    });
    const reply = worker
      ? await this.postRequestAndWaitForReply(projectId, thread.id, worker.id, prompt)
      : await this.runVirtualPlanningRequest({
        projectId,
        threadId: thread.id,
        repoPath: project.baseDir,
        settings: runtime.settings,
        rawPrompt: prompt,
      });
    const payload = this.parsePlannedSprintReply(reply.bodyMarkdown);
    if (payload.goal && payload.goal.trim() && payload.goal.trim() !== sprint.goal.trim()) {
      this.deps.projectManagementRepository.updateSprint(sprint.id, {
        goal: payload.goal.trim(),
      });
    }

    const createdTaskIds: string[] = [];
    const taskIdsByKey = new Map<string, string>();
    for (let index = 0; index < payload.tasks.length; index += 1) {
      const task = payload.tasks[index]!;
      const dependsOnTaskIds = (task.dependsOn || []).map((dependencyKey) => {
        const dependencyId = taskIdsByKey.get(dependencyKey);
        if (!dependencyId) {
          throw new Error(`Planning agent returned dependency "${dependencyKey}" before defining it.`);
        }
        return dependencyId;
      });

      const created = this.deps.projectManagementRepository.createTask(projectId, {
        sprintId,
        title: task.title.trim(),
        description: task.description.trim(),
        promptMarkdown: task.promptMarkdown.trim(),
        priority: this.normalizePriority(task.priority),
        executorType: this.normalizeExecutor(task.executorType),
        dependsOnTaskIds,
        sortOrder: index,
        status: "pending",
        isIndependent: dependsOnTaskIds.length === 0,
      });
      createdTaskIds.push(created.id);
      taskIdsByKey.set(task.key, created.id);
    }

    if (options.autoStart) {
      await this.deps.executionControlService.orchestrateSprint(projectId, sprintId);
    }

    return {
      ok: true,
      threadId: thread.id,
      agentId: planningAgent.id,
      createdTaskIds,
      started: options.autoStart,
    };
  }

  private async postRequestAndWaitForReply(
    projectId: string,
    threadId: string,
    connectionId: string,
    bodyMarkdown: string,
  ): Promise<{ bodyMarkdown: string }> {
    const sentMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, {
      threadId,
      connectionId,
      bodyMarkdown,
    });
    const timeoutAt = Date.now() + 45_000;

    while (Date.now() < timeoutAt) {
      const reply = this.deps.connectionChatRepository
        .listMessages(threadId)
        .find((message) => (
          message.direction === "connection_to_dashboard"
          && new Date(message.createdAt).getTime() >= new Date(sentMessage.createdAt).getTime()
        ));
      if (reply) {
        return reply;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error(`Planning agent request timed out while waiting for worker reply in thread ${threadId}.`);
  }

  private resolvePlanningRuntime(projectId: string): {
    mode: "CONNECTED_MCP" | "VIRTUAL";
    settings: DashboardSettings;
    connection: McpConnectionRecord | null;
  } {
    const settings = this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
    if (settings.workers.executionMode === "VIRTUAL") {
      return {
        mode: "VIRTUAL",
        settings,
        connection: null,
      };
    }

    return {
      mode: "CONNECTED_MCP",
      settings,
      connection: this.requirePlanningWorker(projectId),
    };
  }

  private async runVirtualPlanningRequest(args: {
    projectId: string;
    threadId: string;
    repoPath: string;
    settings: DashboardSettings;
    rawPrompt: string;
  }): Promise<{ bodyMarkdown: string }> {
    const provider = args.settings.workers.virtualWorkerProvider;
    const providerSettings = args.settings.aiProvider.providers[provider];
    if (!providerSettings) {
      throw new Error(`Virtual worker provider "${provider}" is not configured. Check AI Provider settings.`);
    }
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...args.settings.cliWorkflow,
    };
    const sessionId = `planning-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const providerPrompt = buildProviderPrompt(args.rawPrompt, providerSettings.thinkingMode);

    this.deps.connectionChatRepository.postSystemMessage(args.projectId, {
      threadId: args.threadId,
      bodyMarkdown: `Planning request routed through virtual ${this.getProviderLabel(provider)} worker.`,
    });

    let result = await this.providerRunner.runProviderForText({
      provider,
      prompt: providerPrompt,
      cwd: args.repoPath,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      sessionId,
      workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.settings.git.githubToken,
      onActivity: (description, originator) => {
        this.deps.logger?.debug("Virtual planning worker activity", {
          projectId: args.projectId,
          threadId: args.threadId,
          provider,
          originator: originator || "system",
          description,
        });
      },
    });

    if (!result.ok && workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(result)) {
      this.deps.logger?.info("Retrying virtual planning request with file-discovery guidance", {
        projectId: args.projectId,
        threadId: args.threadId,
        provider,
      });
      result = await this.providerRunner.runProviderForText({
        provider,
        prompt: buildReadFileRetryPrompt(providerPrompt),
        cwd: args.repoPath,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        sessionId: `${sessionId}-retry`,
        workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.settings.git.githubToken,
        onActivity: (description, originator) => {
          this.deps.logger?.debug("Virtual planning worker retry activity", {
            projectId: args.projectId,
            threadId: args.threadId,
            provider,
            originator: originator || "system",
            description,
          });
        },
      });
    }

    const bodyMarkdown = result.text.trim();
    if (!result.ok) {
      const classification = classifyProviderError(provider, result);
      this.deps.logger?.error("Virtual planning provider failed", {
        projectId: args.projectId,
        provider,
        exitCode: result.code,
        errorCategory: classification.category,
        resetAfter: classification.resetAfter,
        stderr: result.stderr?.slice(0, 500),
        stdout: result.stdout?.slice(0, 500),
      });
      if (classification.category !== "UNKNOWN") {
        throw new ProviderQuotaError(classification);
      }
      throw new Error(classification.userMessage);
    }
    if (!bodyMarkdown) {
      throw new Error(`Virtual ${this.getProviderLabel(provider)} worker returned an empty Planning agent reply.`);
    }

    this.deps.connectionChatRepository.postSystemMessage(args.projectId, {
      threadId: args.threadId,
      bodyMarkdown: [
        `Virtual ${this.getProviderLabel(provider)} worker reply:`,
        "",
        bodyMarkdown,
      ].join("\n"),
    });

    return { bodyMarkdown };
  }

  private buildImprovePrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintName: string;
    goal: string;
  }): string {
    return [
      "You are Sprint OS's Planning agent.",
      "",
      "## Planning Agent Instructions",
      args.planningAgent.instructionMarkdown.trim() || "Refine sprint prompts into crisp, implementation-ready scopes.",
      "",
      "## Task",
      "Improve the sprint prompt only. Do not break it into tasks yet.",
      `Project: ${args.projectName}`,
      `Sprint: ${args.sprintName.trim() || "Untitled sprint"}`,
      "",
      "## Current Prompt",
      args.goal.trim() || "No prompt provided.",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Improved sprint prompt"}',
    ].join("\n");
  }

  private buildPlanPrompt(args: {
    projectName: string;
    planningAgent: AgentPresetRecord;
    sprintNumber: number | null;
    sprintName: string;
    goal: string;
  }): string {
    return [
      "You are Sprint OS's Planning agent.",
      "",
      "## Planning Agent Instructions",
      args.planningAgent.instructionMarkdown.trim() || "Break sprint goals into actionable subtasks.",
      "",
      "## Task",
      "Plan the sprint into implementation-ready subtasks.",
      `Project: ${args.projectName}`,
      `Sprint: ${args.sprintNumber ? `SPR-${args.sprintNumber}` : args.sprintName}`,
      `Sprint Name: ${args.sprintName}`,
      "",
      "## Sprint Goal",
      args.goal.trim() || "No sprint goal provided.",
      "",
      "## Constraints",
      "- Plan as a DAG, not as a flat checklist.",
      "- Prefer 3 to 8 tasks unless the scope clearly demands more or fewer.",
      "- Maximize parallelism; add dependencies only for true code blockers.",
      "- Each task must be independently understandable and self-contained.",
      "- Each task key must use `T01`, `T02`, `T03`, ... in topological order.",
      "- Dependencies must only reference keys defined earlier in the task list.",
      "- Do not create branch, PR, merge, coordination, analysis-only, or placeholder tasks.",
      "- Use `auto` executor unless a task clearly needs `mcp_worker`, `docker_cli`, or `jules`.",
      "- `description` must be one concise sentence.",
      "- `promptMarkdown` must use this exact section order: `## Objective`, `## Scope`, `## Implementation Requirements`, `## Constraints`, `## Verification`.",
      "- `promptMarkdown` must name exact files, modules, or symbols whenever they can be inferred.",
      "",
      "## Output Rules",
      "- Return JSON only.",
      "- Return one top-level object with `goal` and `tasks`.",
      "- Return one ordered `tasks` array for the full DAG.",
      "- Do not wrap the JSON in prose.",
      "",
      "## Task Object Schema",
      "{",
      '  "key": "T01",',
      '  "title": "Short imperative title",',
      '  "description": "One-sentence outcome statement.",',
      '  "promptMarkdown": "## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...",',
      '  "priority": "medium",',
      '  "executorType": "auto",',
      '  "dependsOn": []',
      "}",
      "",
      "## Example Output A",
      "{",
      '  "goal": "Add project override indicators and keep inherited fields unbadged.",',
      '  "tasks": [',
      "    {",
      '      "key": "T01",',
      '      "title": "Add override metadata helper",',
      '      "description": "Create a shared helper that resolves whether each settings field is overridden at project scope.",',
      '      "promptMarkdown": "## Objective\\nAdd a shared helper that converts effective settings source metadata into per-field override display state for the project settings UI.\\n\\n## Scope\\n- dashboard/src/v2/lib/settings-view-models.ts\\n- tests/dashboard/lib/settings-view-models.test.ts\\n\\n## Implementation Requirements\\n1. Add a helper that determines whether a field is overridden or inherited.\\n2. Return no badge state for inherited values.\\n3. Cover overridden and inherited cases with focused tests.\\n\\n## Constraints\\n- Keep source resolution centralized.\\n- Preserve existing effective settings contracts.\\n\\n## Verification\\n- Run the focused settings view-model test file.\\n- Confirm overridden fields resolve to override state and inherited fields resolve to no badge state.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": []',
      "    },",
      "    {",
      '      "key": "T02",',
      '      "title": "Render override badges in settings UI",',
      '      "description": "Apply the shared override metadata to the project settings controls.",',
      '      "promptMarkdown": "## Objective\\nUse the shared override metadata helper to render the project override badge only on overridden settings controls.\\n\\n## Scope\\n- dashboard/src/v2/SettingsPage.tsx\\n- dashboard/src/v2/components/settings/ProjectSettingsEditor.tsx\\n\\n## Implementation Requirements\\n1. Read per-field override metadata from the shared helper.\\n2. Show the badge only for overridden controls.\\n3. Keep inherited controls free of placeholder badge UI.\\n\\n## Constraints\\n- Reuse existing settings row patterns.\\n- Keep layout stable when no badge is present.\\n\\n## Verification\\n- Verify overridden controls show the badge and inherited controls do not.\\n- Run relevant dashboard tests if present.",',
      '      "priority": "medium",',
      '      "executorType": "auto",',
      '      "dependsOn": ["T01"]',
      "    }",
      "  ]",
      "}",
      "",
      "## Example Output B",
      "{",
      '  "goal": "Fix sprint finalization so no-output tasks do not block completion.",',
      '  "tasks": [',
      "    {",
      '      "key": "T01",',
      '      "title": "Centralize merge settlement rules",',
      '      "description": "Create a shared helper that classifies whether a completed task still has merge work outstanding.",',
      '      "promptMarkdown": "## Objective\\nIntroduce one shared helper for deciding whether a completed task is coding-complete only or fully complete, including the no-output case.\\n\\n## Scope\\n- src/domain/sprint/task-merge-state.ts\\n- src/domain/sprint/ci/feature-pr-gate.ts\\n- tests/backend/domain/sprint/ci/feature-pr-gate.test.ts\\n\\n## Implementation Requirements\\n1. Add a reusable helper for merge settlement classification.\\n2. Treat completed tasks with no PR URL and no worker branch as settled.\\n3. Cover the no-output case with regression tests.\\n\\n## Constraints\\n- Preserve existing behavior for PR-backed tasks.\\n- Keep the helper side-effect free.\\n\\n## Verification\\n- Run focused backend tests for feature PR gating.\\n- Confirm no-output tasks are treated as settled while PR-backed tasks still wait for merge when required.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": []',
      "    },",
      "    {",
      '      "key": "T02",',
      '      "title": "Use merge settlement helper in sprint completion",',
      '      "description": "Apply the shared settlement rules to watch-loop and status-derivation completion decisions.",',
      '      "promptMarkdown": "## Objective\\nUpdate sprint finalization so tasks without merge work advance cleanly to final completion and do not block sprint completion.\\n\\n## Scope\\n- src/domain/sprint/orchestrator/watch-loop-runner.ts\\n- src/sprint/steps/status-derivation-step.ts\\n- src/sprint/steps/protocol-step.ts\\n- tests/backend/sprint/watch-loop-core.test.ts\\n\\n## Implementation Requirements\\n1. Replace duplicated merge-wait logic with the shared helper.\\n2. Auto-complete tasks that have no merge work after coding is done.\\n3. Add regression coverage for sprint completion with no-output tasks.\\n\\n## Constraints\\n- Do not mark PR-backed tasks complete before merge conditions are satisfied.\\n- Keep dependency unlock behavior consistent.\\n\\n## Verification\\n- Run focused sprint runtime tests.\\n- Confirm no-output tasks complete automatically and real merge-backed tasks still wait when required.",',
      '      "priority": "high",',
      '      "executorType": "auto",',
      '      "dependsOn": ["T01"]',
      "    }",
      "  ]",
      "}",
      "",
      "## Required Output",
      "Return JSON only with this exact shape and no surrounding commentary:",
      '{"goal":"Optional refined sprint goal","tasks":[{"key":"T01","title":"Task title","description":"Short intent","promptMarkdown":"## Objective\\n...\\n\\n## Scope\\n- ...\\n\\n## Implementation Requirements\\n1. ...\\n\\n## Constraints\\n- ...\\n\\n## Verification\\n- ...","priority":"medium","executorType":"auto","dependsOn":[]}]}',
    ].join("\n");
  }

  private parsePlannedSprintReply(bodyMarkdown: string): PlannedSprintPayload {
    const payload = this.parseJsonReply<PlannedSprintPayload & { subtasks?: unknown[] }>(bodyMarkdown);
    const rawTasks = Array.isArray(payload.tasks)
      ? payload.tasks
      : Array.isArray(payload.subtasks)
        ? payload.subtasks
        : [];
    if (rawTasks.length === 0) {
      throw new Error("Planning agent reply did not include any tasks.");
    }

    const tasks = rawTasks.map((task, index) => {
      const draft = task as PlannedTaskDraft & {
        id?: string;
        name?: string;
        prompt?: string;
        instructions?: string;
        depends_on?: string[];
        dependencies?: string[];
      };
      const key = String(draft.key || draft.id || "").trim() || `T${String(index + 1).padStart(2, "0")}`;
      const title = String(draft.title || draft.name || "").trim();
      const description = String(draft.description || "").trim();
      const promptMarkdown = String(draft.promptMarkdown || draft.prompt || draft.instructions || draft.description || "").trim();
      if (!title || !promptMarkdown) {
        throw new Error(`Planning agent returned an incomplete task for key ${key}.`);
      }
      return {
        key,
        title,
        description,
        promptMarkdown,
        priority: draft.priority,
        executorType: draft.executorType,
        dependsOn: Array.isArray(draft.dependsOn)
          ? draft.dependsOn.map((dependency) => String(dependency || "").trim()).filter(Boolean)
          : Array.isArray(draft.depends_on)
            ? draft.depends_on.map((dependency) => String(dependency || "").trim()).filter(Boolean)
            : Array.isArray(draft.dependencies)
              ? draft.dependencies.map((dependency) => String(dependency || "").trim()).filter(Boolean)
          : [],
      };
    });

    return {
      goal: typeof payload.goal === "string" ? payload.goal : undefined,
      tasks,
    };
  }

  private parseJsonReply<T>(bodyMarkdown: string): T {
    const rawJson = extractJsonLikeBlock(bodyMarkdown);

    try {
      return JSON.parse(rawJson) as T;
    } catch (error) {
      this.deps.logger?.warn("Failed to parse Planning agent reply", {
        bodyMarkdown,
        rawJson,
        error: error instanceof Error ? error.message : String(error),
      });
      throw new Error("Planning agent reply was not valid JSON.");
    }
  }

  private normalizePriority(value: string | undefined): TaskPriority {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "critical" || normalized === "high" || normalized === "medium" || normalized === "low") {
      return normalized;
    }
    return "medium";
  }

  private normalizeExecutor(value: string | undefined): TaskExecutorType {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === "auto" || normalized === "mcp_worker" || normalized === "docker_cli" || normalized === "jules") {
      return normalized;
    }
    return "auto";
  }

  private requirePlanningWorker(projectId: string): McpConnectionRecord {
    const connections = this.deps.connectionChatRepository.listConnections(projectId);
    const preferredRoles: McpConnectionRole[] = ["worker", "listener"];
    const worker = preferredRoles
      .flatMap((role) => connections.filter((connection) => connection.role === role))
      .find((connection) => (
        connection.capabilities.listenMode === true
        && ["connected", "listening", "idle"].includes(connection.status)
      ));
    if (!worker) {
      throw new Error("No connected listen-mode planning connection is available for this project.");
    }
    return worker;
  }

  private getProviderLabel(provider: DashboardSettings["workers"]["virtualWorkerProvider"]): string {
    switch (provider) {
      case "gemini":
        return "Gemini";
      case "claude-code":
        return "Claude Code";
      case "codex":
      default:
        return "Codex";
    }
  }

  private requireProject(projectId: string): NonNullable<ReturnType<ProjectManagementRepository["getProject"]>> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(
    projectId: string,
    sprintId: string,
  ): NonNullable<ReturnType<ProjectManagementRepository["getSprint"]>> {
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }
    return sprint;
  }
}
