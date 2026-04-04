import * as fs from "fs";

let content = fs.readFileSync('src/services/planning-agent-service.ts', 'utf8');

content = content.replace(
  'import { ProviderExecutionService } from "./provider-execution-service.js";',
  'import { ProviderExecutionService } from "./provider-execution-service.js";\nimport { StructuredProviderResponseService, type StructuredProviderResult } from "./structured-provider-response-service.js";'
);

content = content.replace(
  '  providerRunner?: IProviderRunner;\n}',
  '  providerRunner?: IProviderRunner;\n  providerExecutionService?: ProviderExecutionService;\n  structuredProviderResponseService?: StructuredProviderResponseService;\n  logger?: Logger;\n  sessionTracking?: any;\n  getGithubToken?: () => string | undefined;\n}'
);

content = content.replace(
  'interface VirtualPlanningResult {',
  'interface PlanningResultContext {'
);
content = content.replace(
  '  bodyMarkdown: string;\n  nativeSessionId: string | null;\n  provider: DashboardSettings["workers"]["virtualWorkerProvider"];',
  '  provider: DashboardSettings["workers"]["virtualWorkerProvider"];'
);

content = content.replace(
  '  private readonly providerExecutionService: ProviderExecutionService;\n\n  constructor(private readonly deps: PlanningAgentServiceDeps) {',
  '  private readonly providerExecutionService: ProviderExecutionService;\n  private readonly structuredProviderResponseService: StructuredProviderResponseService;\n\n  constructor(private readonly deps: PlanningAgentServiceDeps) {'
);

content = content.replace(
  '    this.providerExecutionService = new ProviderExecutionService({\n      executionRepository: deps.executionRepository,\n      providerRunner: this.providerRunner,\n    });\n  }',
  '    this.providerExecutionService = deps.providerExecutionService || new ProviderExecutionService({\n      executionRepository: deps.executionRepository,\n      providerRunner: this.providerRunner,\n      sessionTracking: deps.sessionTracking,\n      logger: deps.logger,\n      getGithubToken: deps.getGithubToken,\n    });\n    this.structuredProviderResponseService = deps.structuredProviderResponseService || new StructuredProviderResponseService({\n      providerExecutionService: this.providerExecutionService,\n      executionRepository: deps.executionRepository,\n      logger: deps.logger,\n    });\n  }'
);

content = content.replace(
  '  }): Promise<VirtualPlanningResult> {',
  '  }): Promise<StructuredProviderResult<PlannedSprintPayload> & PlanningResultContext> {'
);


let regex = /    const result = await this\.providerExecutionService\.executeProvider\(\{[\s\S]*?    \}\);\n\n    if \(\!result\.ok\) \{[\s\S]*?      \},[\s\S]*?    \};\n  \}/;

let replacement = `    try {
      const result = await this.structuredProviderResponseService.executeAndParse<PlannedSprintPayload>({
        projectId: args.projectId,
        sprintId: args.sprintId,
        purpose: "planning",
        type: "planning",
        provider,
        prompt: args.rawPrompt,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        sessionId,
        workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.settings.git.githubToken,
        signal: args.signal,
        invocationId: args.invocationId,
        onActivity: (description, originator) => {
          this.deps.logger?.debug("Virtual planning worker activity", {
            projectId: args.projectId,
            invocationId: args.invocationId,
            provider,
            originator: originator || "system",
            description,
          });
        },
        settings: args.settings,
        maxRetries: args.settings.cliWorkflow?.maxPlanningJsonRetries ?? 3,
        providerLabel: this.getProviderLabel(provider),
        parseFn: (bodyMarkdown) => this.parsePlannedSprintReply(bodyMarkdown),
        buildRetryPrompt: (lastError) => [
          "Your previous output could not be parsed as valid JSON.",
          \`Parse error: \${lastError.message}\`,
          "",
          "Please output ONLY the valid JSON sprint definition. Requirements:",
          "- Output raw JSON only — no markdown fences, no commentary, no prose before or after.",
          "- Ensure all string values are properly escaped (especially quotes and newlines inside promptMarkdown).",
          "- Use the exact schema from the original instructions: {\\"goal\\":\\"...\\",\\"tasks\\":[...]}"
        ].join("\\n"),
      });

      return {
        ...result,
        provider,
        sessionId,
        workflowSettings,
        providerSettings: {
          model: providerSettings.model,
          apiKey: providerSettings.apiKey,
          thinkingMode: providerSettings.thinkingMode,
        },
      };
    } catch (error) {
      if (args.invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(args.invocationId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  }`;

content = content.replace(regex, replacement);

content = content.replace(/  private async runVirtualPlanningFollowUp\([\s\S]*?    \};\n  \}\n\n  private async parseWithJsonRetry[\s\S]*?    throw lastError \|\| new Error\("Planning agent reply was not valid JSON\."\);\n  \}\n/g, '');


content = content.replace(
  /        const virtualResult = await this\.runVirtualPlanningRequest\(\{[\s\S]*?        \}\);\n\n        payload = await this\.parseWithJsonRetry\(\{[\s\S]*?        \}\);/g,
  `        const virtualResult = await this.runVirtualPlanningRequest({
          projectId,
          sprintId,
          invocationId: invocation?.id,
          repoPath: project.repoPath,
          settings: runtime.settings,
          rawPrompt: prompt,
          overrides: options.overrides,
          signal,
        });\n\n        payload = virtualResult.parsed;`
);

fs.writeFileSync('src/services/planning-agent-service.ts', content);
