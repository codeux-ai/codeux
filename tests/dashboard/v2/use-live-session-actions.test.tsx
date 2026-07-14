/** @vitest-environment happy-dom */
import { h, type ComponentChildren } from "preact";
import { act, renderHook } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLiveSessionActions } from "../../../dashboard/src/v2/hooks/use-live-session-actions.js";
import { DashboardI18nProvider } from "../../../dashboard/src/v2/i18n/context.js";

const apiMocks = vi.hoisted(() => ({
  cancelSprintRun: vi.fn(),
  cancelTaskDispatch: vi.fn(),
  claimAttentionItem: vi.fn(),
  forceCancelSprintRun: vi.fn(),
  forceCancelTaskDispatch: vi.fn(),
  orchestrateSprint: vi.fn(),
  pauseSprintRun: vi.fn(),
  resolveAttentionItem: vi.fn(),
  rerunTask: vi.fn(),
  retryTaskDispatch: vi.fn(),
}));
const addToast = vi.hoisted(() => vi.fn());

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => apiMocks);
vi.mock("../../../dashboard/src/v2/components/feedback/ToastProvider.js", () => ({
  useToast: () => ({ addToast }),
}));

const GermanWrapper = ({ children }: { children: ComponentChildren }) => (
  <DashboardI18nProvider initialLocale="de" storage={null}>
    {children}
  </DashboardI18nProvider>
);

describe("useLiveSessionActions German presentation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const renderActions = (requestConfirm = vi.fn().mockResolvedValue(true)) => {
    const refreshRuntimeStatus = vi.fn().mockResolvedValue(undefined);
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined);
    const hook = renderHook(
      () => useLiveSessionActions(refreshRuntimeStatus, refreshGitStatus, requestConfirm),
      { wrapper: GermanWrapper },
    );
    return { ...hook, refreshRuntimeStatus, refreshGitStatus, requestConfirm };
  };

  it("localizes rerun fallback failures and retry controls", async () => {
    apiMocks.rerunTask.mockRejectedValueOnce("non-error rejection");
    const { result } = renderActions();

    await act(async () => {
      await result.current.handleRerun("task-1");
    });

    expect(apiMocks.rerunTask).toHaveBeenCalledWith("task-1", undefined);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      type: "error",
      message: "Aufgabe konnte nicht erneut ausgeführt werden.",
      action: expect.objectContaining({ label: "Erneut versuchen" }),
    }));
  });

  it("localizes claim and resolve confirmations while preserving API failures verbatim", async () => {
    apiMocks.claimAttentionItem.mockRejectedValueOnce(new Error("claim API trace-17"));
    apiMocks.resolveAttentionItem.mockRejectedValueOnce(new Error("resolve API trace-23"));
    const { result, requestConfirm } = renderActions();

    await act(async () => {
      await result.current.handleClaimAttentionItem("project-1", "attention-1");
      await result.current.handleResolveAttentionItem("project-1", "attention-2");
    });

    expect(requestConfirm).toHaveBeenNthCalledWith(1, expect.objectContaining({
      title: "Aufmerksamkeitseintrag übernehmen",
      confirmLabel: "Übernehmen",
    }));
    expect(requestConfirm).toHaveBeenNthCalledWith(2, expect.objectContaining({
      title: "Aufmerksamkeitseintrag lösen",
      confirmLabel: "Lösen",
    }));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "claim API trace-17",
      action: expect.objectContaining({ label: "Erneut versuchen" }),
    }));
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "resolve API trace-23",
      action: expect.objectContaining({ label: "Erneut versuchen" }),
    }));
  });

  it("localizes cancellation confirmation, preserves its API error, and suppresses duplicate endpoint calls", async () => {
    apiMocks.cancelSprintRun.mockRejectedValue(new Error("cancel API trace-31"));
    const { result, requestConfirm } = renderActions();

    await act(async () => {
      await Promise.all([
        result.current.handleCancelSprintRun("run-1", "KEEP sprint name verbatim"),
        result.current.handleCancelSprintRun("run-1", "KEEP sprint name verbatim"),
      ]);
    });

    expect(requestConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: "Sprint-Lauf abbrechen",
      body: expect.stringContaining("KEEP sprint name verbatim"),
      confirmLabel: "Lauf abbrechen",
    }));
    expect(apiMocks.cancelSprintRun).toHaveBeenCalledTimes(1);
    expect(addToast).toHaveBeenCalledWith(expect.objectContaining({
      message: "cancel API trace-31",
      action: expect.objectContaining({ label: "Erneut versuchen" }),
    }));
  });
});
