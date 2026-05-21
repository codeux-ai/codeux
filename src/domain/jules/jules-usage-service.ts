import { getEncoding } from "js-tiktoken";
import type { JulesClient } from "./jules-client.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { Logger } from "../../shared/logging/logger.js";
import type { CreateProviderInvocationUsageInput, UpdateProviderInvocationUsageInput } from "../../contracts/execution-types.js";

export class JulesUsageService {
  constructor(
    private readonly julesClient: JulesClient,
    private readonly executionRepository: ExecutionRepository,
    private readonly logger: Logger
  ) {}

  async calculateAndSaveUsageForTask(projectId: string, taskId: string, sessionId: string): Promise<void> {
    try {
      const activities = await this.julesClient.getFullConversation(sessionId);

      let sessionPrompt = "";
      try {
        const session = await this.julesClient.getSession(sessionId);
        sessionPrompt = session.prompt || "";
      } catch (err) {
        this.logger.warn("Failed to fetch Jules session details", { sessionId, error: err });
      }

      let inputTokens = 0;
      let outputTokens = 0;
      let promptChars = 0;
      let transcriptChars = 0;

      const encoder = getEncoding("cl100k_base");

      if (sessionPrompt) {
        promptChars += sessionPrompt.length;
        inputTokens += encoder.encode(sessionPrompt).length;
      }

      for (const activity of activities) {
        if (activity.userMessaged?.userMessage) {
          const text = activity.userMessaged.userMessage;
          promptChars += text.length;
          inputTokens += encoder.encode(text).length;
        }
        if (activity.agentMessaged?.agentMessage) {
          const text = activity.agentMessaged.agentMessage;
          transcriptChars += text.length;
          outputTokens += encoder.encode(text).length;
        }
      }

      const totalTokens = inputTokens + outputTokens;

      let record = this.executionRepository.getLatestProviderInvocationUsageBySession(sessionId, "task_coding");

      if (!record) {
        const createInput: CreateProviderInvocationUsageInput = {
          projectId,
          taskId,
          sessionId,
          provider: "jules",
          purpose: "task_coding",
          status: "completed",
          invocationSource: "EXTERNAL_API"
        };
        record = this.executionRepository.createProviderInvocationUsage(createInput);
      }

      const updateInput: UpdateProviderInvocationUsageInput = {
        status: "completed",
        inputTokens,
        outputTokens,
        totalTokens,
        julesTokens: totalTokens,
        usageSource: "estimated",
        transcriptChars,
        invocationSource: "EXTERNAL_API"
      };

      this.executionRepository.updateProviderInvocationUsage(record.id, updateInput);

      // Create or retrieve corresponding ExecutionInvocationRecord
      const execInvocations = this.executionRepository.listExecutionInvocationsByProviderInvocationId(record.id);
      let execInvocation = execInvocations.length > 0 ? execInvocations[0] : null;

      if (!execInvocation) {
        execInvocation = this.executionRepository.createExecutionInvocation({
          projectId,
          taskId,
          providerInvocationId: record.id,
          type: "task_coding",
          status: "completed",
          provider: "jules",
          model: "jules-agent",
          invocationSource: "EXTERNAL_API",
          startedAt: record.createdAt,
        });
      } else {
        this.executionRepository.updateExecutionInvocation(execInvocation.id, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      // Clear existing messages to prevent duplicates and rebuild transcript in order
      this.executionRepository.clearExecutionInvocationMessages(execInvocation.id);

      // Append initial prompt as first user message
      if (sessionPrompt) {
        this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
          role: "user",
          contentMarkdown: sessionPrompt,
          createdAt: record.createdAt,
        });
      }

      // Map conversation activities chronologically
      for (const activity of activities) {
        const activityTime = activity.createTime || new Date().toISOString();

        if (activity.userMessaged?.userMessage) {
          const text = activity.userMessaged.userMessage;
          // Avoid duplicating initial prompt
          if (text !== sessionPrompt) {
            this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
              role: "user",
              contentMarkdown: text,
              createdAt: activityTime,
            });
          }
        } else if (activity.agentMessaged?.agentMessage) {
          const text = activity.agentMessaged.agentMessage;
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "assistant",
            contentMarkdown: text,
            createdAt: activityTime,
          });
        } else if (activity.planGenerated?.plan?.steps) {
          const steps = activity.planGenerated.plan.steps;
          const stepsMarkdown = steps
            .map((step, index) => `- Step ${index + 1}: ${step.title || "Untitled step"}`)
            .join("\n");
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "assistant",
            contentMarkdown: `Proposed plan:\n\n${stepsMarkdown}`,
            createdAt: activityTime,
          });
        } else if (activity.planApproved?.planId) {
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "user",
            contentMarkdown: `Approved plan (ID: ${activity.planApproved.planId})`,
            createdAt: activityTime,
          });
        } else if (activity.progressUpdated?.title || activity.progressUpdated?.description) {
          const title = activity.progressUpdated.title || "";
          const desc = activity.progressUpdated.description || "";
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "system",
            contentMarkdown: `Progress updated: **${title}**\n${desc}`,
            createdAt: activityTime,
          });
        } else if (activity.sessionCompleted !== undefined && activity.sessionCompleted !== null) {
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "system",
            contentMarkdown: "Jules session completed successfully.",
            createdAt: activityTime,
          });
        } else if (activity.sessionFailed?.reason) {
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "system",
            contentMarkdown: `Jules session failed: ${activity.sessionFailed.reason}`,
            createdAt: activityTime,
          });
        } else if (activity.description) {
          this.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: "system",
            contentMarkdown: activity.description,
            createdAt: activityTime,
          });
        }
      }

      this.logger.info("Saved Jules usage telemetry and conversation transcript for task", {
        projectId,
        taskId,
        sessionId,
        inputTokens,
        outputTokens,
        totalTokens
      });

    } catch (error) {
      this.logger.error("Failed to calculate and save Jules usage telemetry", {
        error,
        projectId,
        taskId,
        sessionId
      });
    }
  }
}
