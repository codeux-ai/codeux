import { describe, expect, it, vi } from "vitest";
import { normalizeQaReviewResult } from "../../../src/domain/qa-review/qa-review-result-normalizer.js";
import { parsePlannedSprintReply } from "../../../src/services/planning-json-extractor.js";
import { StructuredAgentRequestService } from "../../../src/services/structured-agent-request-service.js";
import { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import type { ProviderExecutionService } from "../../../src/services/provider-execution-service.js";

const validPromptMarkdown = [
  "## Objective",
  "Complete the requested change.",
  "",
  "## Scope",
  "- src/example.ts",
  "",
  "## Implementation Requirements",
  "1. Implement the requested behavior.",
  "",
  "## Constraints",
  "- Keep the change scoped.",
  "",
  "## Verification",
  "- Run focused tests.",
].join("\n");

const planningPayload = (title: string): string => JSON.stringify({
  goal: "Plan the integration task.",
  tasks: [
    {
      key: "T01",
      title,
      description: `${title}.`,
      promptMarkdown: validPromptMarkdown,
      priority: "medium",
      executorType: "auto",
      dependsOn: [],
    },
  ],
});

const reflectionFail = JSON.stringify({
  criteria: [
    {
      id: "coverage",
      score: 5,
      rationale: "The plan misses an integration contract.",
      improvementInstructions: "Add the persistent skills and reflection contract coverage.",
    },
  ],
});

const reflectionPass = JSON.stringify({
  criteria: [
    {
      id: "coverage",
      score: 9,
      rationale: "The plan covers the required integration contracts.",
      improvementInstructions: "",
    },
  ],
});

const settingsWithPlanningReflection = {
  cliWorkflow: {
    maxParsingRetries: 0,
    maxPlanningJsonRetries: 0,
  },
  agents: {
    selfReflection: {
      planning: {
        enabled: true,
        criteria: [
          {
            id: "coverage",
            label: "Coverage",
            prompt: "The plan covers the requested persistent skills and reflection contracts.",
            threshold: 0.8,
          },
        ],
        maxImprovementAttempts: 1,
      },
      qualityAssurance: {
        enabled: false,
        criteria: [
          {
            id: "coverage",
            label: "Coverage",
            prompt: "The QA review is complete.",
            threshold: 0.8,
          },
        ],
        maxImprovementAttempts: 1,
      },
    },
  },
};

describe("self-reflection loop integration", () => {
  it("improves below-threshold planning output until an accepted plan passes reflection", async () => {
    const executionRepository = {
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "inv-planning-reflection" }),
      appendExecutionInvocationMessage: vi.fn(),
      listExecutionInvocationMessages: vi.fn().mockReturnValue([]),
    };
    const providerExecutionService = {
      executeProvider: vi.fn()
        .mockResolvedValueOnce({ ok: true, text: planningPayload("Draft integration plan"), nativeSessionId: "native-plan-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionFail, nativeSessionId: "native-plan-1" })
        .mockResolvedValueOnce({ ok: true, text: planningPayload("Accepted integration plan"), nativeSessionId: "native-plan-1" })
        .mockResolvedValueOnce({ ok: true, text: reflectionPass, nativeSessionId: "native-plan-1" }),
    } as unknown as ProviderExecutionService;
    const service = new StructuredAgentRequestService({
      executionRepository: executionRepository as never,
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService,
      }),
    });

    const result = await service.executeRequest({
      projectId: "project-reflection-integration",
      purpose: "planning",
      type: "planning",
      provider: "claude-code",
      model: "test-model",
      apiKey: "test-key",
      providerPrompt: "Plan the integration task.",
      repoPath: "/workspace/reflection-integration",
      settings: settingsWithPlanningReflection as never,
      maxRetries: 0,
      parseFn: (text) => parsePlannedSprintReply(text),
      buildRetryPrompt: () => "Return valid planning JSON.",
      providerLabel: "Claude",
      sessionIdPrefix: "planning-reflection",
    });

    expect(result.parsed.tasks[0]?.title).toBe("Accepted integration plan");
    expect(vi.mocked(providerExecutionService.executeProvider)).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(providerExecutionService.executeProvider).mock.calls;
    expect(calls[1]?.[0].continueSessionId).toBe("native-plan-1");
    expect(calls[2]?.[0].prompt).toContain("Improve your previous structured JSON output");
    expect(calls[3]?.[0].prompt).toContain("structured output");
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith("inv-planning-reflection", expect.objectContaining({
      metadata: expect.objectContaining({
        reflection: expect.objectContaining({
          event: "reflection_evaluated",
          finalDecision: "passed",
        }),
      }),
    }));
  });

  it("keeps QA self-reflection disabled by default and passes through the normalized review", async () => {
    const providerExecutionService = {
      executeProvider: vi.fn().mockResolvedValue({
        ok: true,
        text: JSON.stringify({ verdict: "pass", summary: "No blocking issues.", findings: [] }),
        nativeSessionId: "native-qa-1",
      }),
    } as unknown as ProviderExecutionService;
    const service = new StructuredAgentRequestService({
      structuredProviderResponseService: new StructuredProviderResponseService({
        providerExecutionService,
      }),
    });

    const result = await service.executeRequest({
      projectId: "project-reflection-integration",
      purpose: "qa_review",
      type: "qa_review",
      provider: "claude-code",
      model: "test-model",
      apiKey: "test-key",
      providerPrompt: "Review the completed task.",
      repoPath: "/workspace/reflection-integration",
      settings: settingsWithPlanningReflection as never,
      maxRetries: 0,
      parseFn: (text) => normalizeQaReviewResult(text),
      buildRetryPrompt: () => "Return valid QA JSON.",
      providerLabel: "QA",
      sessionIdPrefix: "qa-reflection",
    });

    expect(result.parsed.verdict).toBe("pass");
    expect(result.parsed.summary).toBe("No blocking issues.");
    expect(vi.mocked(providerExecutionService.executeProvider)).toHaveBeenCalledTimes(1);
  });
});
