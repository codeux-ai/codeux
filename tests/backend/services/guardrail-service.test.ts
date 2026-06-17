import { describe, expect, it, vi } from "vitest";
import { GuardrailService } from "../../../src/services/guardrail-service.js";
import type { GuardrailRepository } from "../../../src/repositories/guardrail-repository.js";
import type { GuardrailSettings } from "../../../src/contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const scope = { projectId: "proj-1", sprintId: "sprint-1" };

function makeRepo(initial: Record<string, number> = {}) {
  const counts = new Map<string, number>(Object.entries(initial));
  const key = (taskId: string, purpose: string) => `${taskId}:${purpose}`;
  return {
    record: vi.fn((input: { taskId: string; purpose: string }) => {
      const k = key(input.taskId, input.purpose);
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return next;
    }),
    getCount: vi.fn((taskId: string, purpose: string) => counts.get(key(taskId, purpose)) ?? 0),
    getCounts: vi.fn(() => ({})),
    getTotal: vi.fn((taskId: string) => {
      let total = 0;
      for (const [k, v] of counts) {
        if (k.startsWith(`${taskId}:`)) total += v;
      }
      return total;
    }),
    reset: vi.fn(),
  } as unknown as GuardrailRepository & { record: any; getCount: any; getTotal: any; reset: any };
}

const settings = (overrides: Partial<GuardrailSettings> = {}): GuardrailSettings => ({
  ...DEFAULT_DASHBOARD_SETTINGS.guardrails,
  ...overrides,
  jobs: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs, ...overrides.jobs },
});

describe("GuardrailService.evaluate", () => {
  it("allows invocations below the cap and blocks at the cap", () => {
    const repo = makeRepo({ "t1:ci_fix": 2 });
    const service = new GuardrailService(repo, () => settings({
      jobs: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs, ci_fix: { cap: 3, onLimit: "BLOCK_AND_ESCALATE" } },
    }));

    const under = service.evaluate(scope, "t1", "ci_fix");
    expect(under.allowed).toBe(true);
    expect(under.count).toBe(2);
    expect(under.cap).toBe(3);

    (repo.getCount as any).mockReturnValueOnce(3);
    const at = service.evaluate(scope, "t1", "ci_fix");
    expect(at.allowed).toBe(false);
    expect(at.action).toBe("BLOCK_AND_ESCALATE");
  });

  it("treats cap 0 as unlimited", () => {
    const repo = makeRepo({ "t1:ci_fix": 99 });
    const service = new GuardrailService(repo, () => settings({
      jobs: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs, ci_fix: { cap: 0, onLimit: "BLOCK_AND_ESCALATE" } },
    }));
    expect(service.evaluate(scope, "t1", "ci_fix").allowed).toBe(true);
  });

  it("always allows when guardrails are disabled", () => {
    const repo = makeRepo({ "t1:ci_fix": 99 });
    const service = new GuardrailService(repo, () => settings({ enabled: false }));
    expect(service.evaluate(scope, "t1", "ci_fix").allowed).toBe(true);
  });

  it("enforces the per-task total ceiling across job types", () => {
    const repo = makeRepo({ "t1:task_coding": 4, "t1:ci_fix": 1 });
    const service = new GuardrailService(repo, () => settings({
      perTaskTotalCeiling: 5,
      jobs: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs, ci_fix: { cap: 100, onLimit: "BLOCK_AND_ESCALATE" } },
    }));
    const result = service.evaluate(scope, "t1", "ci_fix");
    expect(result.allowed).toBe(false);
    expect(result.blockedByTotalCeiling).toBe(true);
  });

  it("falls back to allowed when settings resolution throws", () => {
    const repo = makeRepo({ "t1:ci_fix": 99 });
    const service = new GuardrailService(repo, () => { throw new Error("boom"); });
    expect(service.evaluate(scope, "t1", "ci_fix").allowed).toBe(true);
  });
});

describe("GuardrailService.record / reset", () => {
  it("delegates record and reset to the repository", () => {
    const repo = makeRepo();
    const service = new GuardrailService(repo, () => settings());
    expect(service.record(scope, "t1", "task_coding")).toBe(1);
    expect(repo.record).toHaveBeenCalledWith({ projectId: "proj-1", taskId: "t1", purpose: "task_coding" });
    service.reset("t1");
    expect(repo.reset).toHaveBeenCalledWith("t1");
  });
});
