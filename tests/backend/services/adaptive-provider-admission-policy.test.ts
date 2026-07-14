import { describe, expect, it, vi } from "vitest";
import type { ProviderInvocationUsageRecord } from "../../../src/contracts/execution-types.js";
import {
  AdaptiveProviderAdmissionPolicy,
  type ProviderAdmissionResourceSnapshot,
} from "../../../src/services/adaptive-provider-admission-policy.js";

const GIB = 1024 ** 3;

function invocation(purpose: ProviderInvocationUsageRecord["purpose"]): ProviderInvocationUsageRecord {
  return { purpose } as ProviderInvocationUsageRecord;
}

function createPolicy(snapshot: ProviderAdmissionResourceSnapshot, running: ProviderInvocationUsageRecord[] = []) {
  const sample = vi.fn(() => snapshot);
  const listRunningProviderInvocationUsages = vi.fn(() => running);
  const logger = { info: vi.fn() };
  const policy = new AdaptiveProviderAdmissionPolicy({
    executionRepository: { listRunningProviderInvocationUsages },
    resourceSource: { sample },
    logger,
    now: () => snapshot.sampledAtMs,
  });
  return { policy, sample, listRunningProviderInvocationUsages, logger };
}

const healthy = (): ProviderAdmissionResourceSnapshot => ({
  cpuCount: 32,
  loadOneMinute: 8,
  totalMemoryBytes: 32 * GIB,
  freeMemoryBytes: 16 * GIB,
  sampledAtMs: 1_000,
});

describe("AdaptiveProviderAdmissionPolicy", () => {
  it("derives a bounded automatic limit and reserves one background slot", () => {
    const { policy } = createPolicy(healthy());

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "task_coding" })).toBe(9);
    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "dashboard_reply" })).toBe(10);
  });

  it("keeps an explicit provider cap as a hard ceiling", () => {
    const { policy } = createPolicy(healthy());

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 5, purpose: "task_coding" })).toBe(4);
    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 5, purpose: "worker_reply" })).toBe(5);
  });

  it("freezes background expansion under pressure but admits one interactive reply", () => {
    const snapshot = { ...healthy(), loadOneMinute: 32 };
    const running = Array.from({ length: 6 }, () => invocation("task_coding"));
    const { policy } = createPolicy(snapshot, running);

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "task_coding" })).toBe(6);
    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "clarification_reply" })).toBe(7);
  });

  it("does not add an interactive slot under critical memory pressure", () => {
    const snapshot = { ...healthy(), freeMemoryBytes: GIB };
    const running = Array.from({ length: 6 }, () => invocation("task_coding"));
    const { policy } = createPolicy(snapshot, running);

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "dashboard_reply" })).toBe(6);
  });

  it("preserves the interactive reservation during a CPU/load burst when memory is safe", () => {
    const snapshot = { ...healthy(), loadOneMinute: 64 };
    const running = Array.from({ length: 6 }, () => invocation("task_coding"));
    const { policy } = createPolicy(snapshot, running);

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "worker_reply" })).toBe(7);
    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "task_coding" })).toBe(6);
  });

  it("pauses a new background launch when pressure is already high and nothing is running", () => {
    const snapshot = { ...healthy(), freeMemoryBytes: GIB };
    const { policy } = createPolicy(snapshot);

    expect(policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0, purpose: "task_coding" })).toBe(-1);
  });

  it("does not apply local resource admission to hosted Jules work", () => {
    const { policy, sample } = createPolicy({ ...healthy(), freeMemoryBytes: 1 });

    expect(policy.getEffectiveLimit({ provider: "jules", configuredLimit: 0, purpose: "task_coding" })).toBe(0);
    expect(policy.getEffectiveLimit({ provider: "jules", configuredLimit: 12, purpose: "task_coding" })).toBe(12);
    expect(sample).not.toHaveBeenCalled();
  });

  it("reuses the resource sample within the cache window", () => {
    const { policy, sample } = createPolicy(healthy());

    policy.getEffectiveLimit({ provider: "codex", configuredLimit: 0 });
    policy.getEffectiveLimit({ provider: "gemini", configuredLimit: 0 });

    expect(sample).toHaveBeenCalledTimes(1);
  });
});
