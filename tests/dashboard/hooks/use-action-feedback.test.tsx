// @vitest-environment happy-dom
import { renderHook, act } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useActionFeedback } from "../../../dashboard/src/v2/hooks/use-action-feedback.js";

describe("useActionFeedback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("initializes with idle status", () => {
    const { result } = renderHook(() => useActionFeedback());
    expect(result.current.feedback).toEqual({ status: "idle", message: null });
  });

  it("sets success status and auto-dismisses", () => {
    const { result } = renderHook(() => useActionFeedback(1000));

    act(() => {
      result.current.setSuccess("Done!");
    });

    expect(result.current.feedback).toEqual({ status: "success", message: "Done!" });

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.feedback).toEqual({ status: "idle", message: null });
  });

  it("does not auto-dismiss error status if options dictate otherwise or just checking default behavior", () => {
    const { result } = renderHook(() => useActionFeedback(1000));

    act(() => {
      result.current.setError("Failed!", { retryAction: () => {} });
    });

    expect(result.current.feedback.status).toBe("error");
    expect(result.current.feedback.message).toBe("Failed!");
    expect(result.current.feedback.retryAction).toBeDefined();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.feedback.status).toBe("error");
  });
});
