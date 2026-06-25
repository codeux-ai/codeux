import { describe, expect, it, vi } from "vitest";
import { planVirtualWorkerCycle } from "../../../../src/domain/workers/virtual-worker-cycle-plan.js";
import type { DashboardSettings, ProviderId } from "../../../../src/contracts/app-types.js";
import type { ProjectAttentionItemRecord } from "../../../../src/contracts/project-attention-types.js";
import type { WorkerTaskDispatchClaim } from "../../../../src/contracts/execution-types.js";

describe("planVirtualWorkerCycle", () => {
  const mockResolveSettings = vi.fn().mockReturnValue({
    workers: {
      virtualWorkerProvider: "codex-config",
      maxConcurrency: 2,
    },
    aiProvider: {
      providers: {
        "codex-config": {
          provider: "codex" as ProviderId,
        },
      },
    },
  } as unknown as DashboardSettings);

  const mockIsProviderConcurrencyAvailable = vi.fn().mockResolvedValue(true);

  it("returns NO_WORKER_NEEDED when no attention item and no dispatch claim", async () => {
    const action = await planVirtualWorkerCycle({
      projectId: "p1",
      attentionItem: null,
      dispatchClaim: null,
      isProviderConcurrencyAvailable: mockIsProviderConcurrencyAvailable,
      resolveSettings: mockResolveSettings,
    });
    expect(action.type).toBe("NO_WORKER_NEEDED");
  });

  it("returns ORCHESTRATOR_HANDLED_CLARIFICATION when attention item is orchestrator handled", async () => {
    const action = await planVirtualWorkerCycle({
      projectId: "p1",
      attentionItem: { summaryMarkdown: "Clarification cooldown active" } as ProjectAttentionItemRecord,
      dispatchClaim: null,
      isProviderConcurrencyAvailable: mockIsProviderConcurrencyAvailable,
      resolveSettings: mockResolveSettings,
    });
    expect(action.type).toBe("ORCHESTRATOR_HANDLED_CLARIFICATION");
  });

  it("returns PROVIDER_CONCURRENCY_UNAVAILABLE when concurrency is not available", async () => {
    mockIsProviderConcurrencyAvailable.mockResolvedValueOnce(false);
    const action = await planVirtualWorkerCycle({
      projectId: "p1",
      attentionItem: { summaryMarkdown: "Standard task", sprintId: "s1" } as ProjectAttentionItemRecord,
      dispatchClaim: null,
      isProviderConcurrencyAvailable: mockIsProviderConcurrencyAvailable,
      resolveSettings: mockResolveSettings,
    });
    expect(action.type).toBe("PROVIDER_CONCURRENCY_UNAVAILABLE");
    expect(mockIsProviderConcurrencyAvailable).toHaveBeenCalledWith("codex", 2);
  });

  it("returns DISPATCH_READY when dispatch claim is present", async () => {
    mockIsProviderConcurrencyAvailable.mockResolvedValueOnce(true);
    const dispatchClaim = { sprint: { id: "s1" } } as WorkerTaskDispatchClaim;
    const action = await planVirtualWorkerCycle({
      projectId: "p1",
      attentionItem: { summaryMarkdown: "Standard task", sprintId: "s1" } as ProjectAttentionItemRecord,
      dispatchClaim,
      isProviderConcurrencyAvailable: mockIsProviderConcurrencyAvailable,
      resolveSettings: mockResolveSettings,
    });
    expect(action.type).toBe("DISPATCH_READY");
    if (action.type === "DISPATCH_READY") {
      expect(action.dispatchClaim).toBe(dispatchClaim);
      expect(action.cycleProviderType).toBe("codex");
    }
  });

  it("returns HANDLE_ATTENTION when attention is present and no dispatch", async () => {
    mockIsProviderConcurrencyAvailable.mockResolvedValueOnce(true);
    const attentionItem = { summaryMarkdown: "Standard task", sprintId: "s1" } as ProjectAttentionItemRecord;
    const action = await planVirtualWorkerCycle({
      projectId: "p1",
      attentionItem,
      dispatchClaim: null,
      isProviderConcurrencyAvailable: mockIsProviderConcurrencyAvailable,
      resolveSettings: mockResolveSettings,
    });
    expect(action.type).toBe("HANDLE_ATTENTION");
    if (action.type === "HANDLE_ATTENTION") {
      expect(action.attentionItem).toBe(attentionItem);
      expect(action.cycleProviderType).toBe("codex");
    }
  });
});
