import { AutomationOutboxRepository, type AutomationOutboxRecord } from "../../repositories/automation-outbox-repository.js";
import type { NodeFlowJsonObject } from "../../contracts/node-flow-types.js";

export interface SideEffectProviderResult { providerMessageId: string }
export interface SideEffectProvider { send(effectType: string, payload: NodeFlowJsonObject, idempotencyKey: string): Promise<SideEffectProviderResult> }

export class OutboxService {
  constructor(private readonly repository: AutomationOutboxRepository, private readonly provider: SideEffectProvider) {
    this.repository.recoverSending();
  }

  async dispatch(input: {
    projectId: string; flowId: string; publicationId: string; runId: string; nodeId: string;
    logicalItem?: string; effectType: string; payload: NodeFlowJsonObject;
  }): Promise<AutomationOutboxRecord> {
    const record = this.repository.enqueue({ ...input, logicalItem: input.logicalItem?.trim() || "default" });
    if (record.status === "sent" || record.status === "attention_required") return record;
    const claimed = this.repository.claim(record.id);
    if (!claimed) return this.repository.get(record.id)!;
    try {
      const result = await this.provider.send(claimed.effectType, claimed.payload, claimed.idempotencyKey);
      return this.repository.markSent(claimed.id, result.providerMessageId);
    } catch (error) {
      const unknownOutcome = error instanceof UnknownSideEffectOutcomeError;
      return this.repository.markFailed(claimed.id, error instanceof Error ? error.message : String(error), unknownOutcome);
    }
  }
}

export class UnknownSideEffectOutcomeError extends Error {
  constructor(message = "The provider may have accepted the side effect, so automatic replay is disabled.") {
    super(message); this.name = "UnknownSideEffectOutcomeError";
  }
}

export class MockSideEffectProvider implements SideEffectProvider {
  readonly sends: Array<{ effectType: string; payload: NodeFlowJsonObject; idempotencyKey: string }> = [];
  async send(effectType: string, payload: NodeFlowJsonObject, idempotencyKey: string): Promise<SideEffectProviderResult> {
    this.sends.push({ effectType, payload, idempotencyKey });
    return { providerMessageId: `mock-${idempotencyKey.slice(0, 16)}` };
  }
}
