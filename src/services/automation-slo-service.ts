import type { AutomationSloSnapshot } from "../contracts/headless-security-types.js";

export class AutomationSloService {
  private readonly windowStartedAt = new Date().toISOString();
  private readonly managementLatencies: number[] = [];
  private managementErrors = 0;
  private runAttempts = 0;
  private outboxDeliveries = 0;
  private outboxDeliveryErrors = 0;

  observeManagementRequest(durationMs: number, statusCode: number): void {
    this.managementLatencies.push(Math.max(0, durationMs));
    if (this.managementLatencies.length > 10_000) this.managementLatencies.shift();
    if (statusCode >= 500) this.managementErrors += 1;
  }

  observeRunAttempt(): void {
    this.runAttempts += 1;
  }

  observeOutboxDelivery(succeeded: boolean): void {
    this.outboxDeliveries += 1;
    if (!succeeded) this.outboxDeliveryErrors += 1;
  }

  snapshot(): AutomationSloSnapshot {
    const sorted = [...this.managementLatencies].sort((left, right) => left - right);
    const p95Index = sorted.length === 0 ? 0 : Math.ceil(sorted.length * 0.95) - 1;
    return {
      windowStartedAt: this.windowStartedAt,
      sampledAt: new Date().toISOString(),
      managementRequestCount: sorted.length,
      managementErrorRate: sorted.length === 0 ? 0 : this.managementErrors / sorted.length,
      managementLatencyP95Ms: sorted[p95Index] ?? 0,
      runAttemptCount: this.runAttempts,
      outboxDeliveryErrorRate: this.outboxDeliveries === 0 ? 0 : this.outboxDeliveryErrors / this.outboxDeliveries,
    };
  }
}
