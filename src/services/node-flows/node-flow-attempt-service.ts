import { createHash } from "crypto";
import type { NodeFlowRepository } from "../../repositories/node-flow-repository.js";
import type { NodeFlowJsonObject, NodeFlowNodeAttemptRecord, NodeFlowNodeRunRecord } from "../../contracts/node-flow-types.js";
import type { NodeFlowFailureClassification } from "../../contracts/node-flow-execution-policy-types.js";

export class NodeFlowAttemptService {
  constructor(private readonly repository: NodeFlowRepository) {}

  start(nodeRun: NodeFlowNodeRunRecord, executorId: string, input: NodeFlowJsonObject, credentialIds: string[]): NodeFlowNodeAttemptRecord {
    const attemptNumber = this.repository.listNodeAttempts(nodeRun.runId)
      .filter((attempt) => attempt.nodeId === nodeRun.nodeId && attempt.logicalItem === nodeRun.logicalItem).length + 1;
    return this.repository.createNodeAttempt({ runId: nodeRun.runId, nodeRunId: nodeRun.id, nodeId: nodeRun.nodeId, logicalItem: nodeRun.logicalItem, attemptNumber, status: "running", executorId, invocationId: null, artifactDigest: null, input, output: null, credentialIds, failureClassification: null, retryDecision: null, errorMessage: null, startedAt: new Date().toISOString(), finishedAt: null });
  }

  succeed(attempt: NodeFlowNodeAttemptRecord, output: NodeFlowJsonObject, invocationId?: string | null): NodeFlowNodeAttemptRecord {
    return this.repository.updateNodeAttempt(attempt.id, { status: "succeeded", invocationId: invocationId ?? null, output, artifactDigest: createHash("sha256").update(JSON.stringify(output)).digest("hex"), retryDecision: "stop", finishedAt: new Date().toISOString() });
  }

  fail(attempt: NodeFlowNodeAttemptRecord, classification: NodeFlowFailureClassification, errorMessage: string, retry: boolean, invocationId?: string | null): NodeFlowNodeAttemptRecord {
    return this.repository.updateNodeAttempt(attempt.id, { status: classification === "cancelled" ? "cancelled" : "failed", invocationId: invocationId ?? attempt.invocationId, failureClassification: classification, retryDecision: classification === "unknown_side_effect" ? "attention_required" : retry ? "retry" : "stop", errorMessage, finishedAt: new Date().toISOString() });
  }
}
