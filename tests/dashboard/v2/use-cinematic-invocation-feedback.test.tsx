/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCinematicInvocationFeedback } from "../../../dashboard/src/v2/hooks/use-cinematic-invocation-feedback.js";
import { fetchInvocationMessages } from "../../../dashboard/src/v2/lib/invocation-api.js";
import type {
  ExecutionInvocationMessageRecord,
  ExecutionInvocationRecord,
} from "../../../dashboard/src/v2/types.js";

vi.mock("../../../dashboard/src/v2/lib/invocation-api.js", () => ({
  fetchInvocationMessages: vi.fn(),
}));

const invocation = (
  overrides: Partial<ExecutionInvocationRecord> = {},
): ExecutionInvocationRecord => ({
  id: "invocation-1",
  projectId: "project-1",
  sprintId: null,
  taskId: null,
  sprintRunId: null,
  dispatchId: null,
  taskRunId: null,
  attentionItemId: null,
  providerInvocationId: "provider-1",
  type: "dashboard_reply",
  status: "running",
  provider: "codex",
  model: "test-model",
  systemPrompt: null,
  startedAt: "2026-07-13T10:00:00.000Z",
  finishedAt: null,
  errorMessage: null,
  lastErrorCategory: null,
  lastErrorMessage: null,
  lastRetryAfterIso: null,
  messageCount: 1,
  lastMessageAt: "2026-07-13T10:00:00.000Z",
  invocationSource: "internal",
  agentPresetId: "pm-agent",
  createdAt: "2026-07-13T10:00:00.000Z",
  updatedAt: "2026-07-13T10:00:00.000Z",
  ...overrides,
});

const message = (
  overrides: Partial<ExecutionInvocationMessageRecord> = {},
): ExecutionInvocationMessageRecord => ({
  id: "message-1",
  invocationId: "invocation-1",
  role: "assistant",
  contentMarkdown: "Working on it.",
  toolCallsJson: null,
  metadata: null,
  createdAt: "2026-07-13T10:00:00.000Z",
  ...overrides,
});

interface Deferred<T> {
  promise: Promise<T>;
  reject: (error: unknown) => void;
  resolve: (value: T) => void;
}

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

interface HookProps {
  invocations: ExecutionInvocationRecord[];
  projectId: string | null;
  projectManagerAgentPresetId: string | null;
}

const initialProps = (
  overrides: Partial<HookProps> = {},
): HookProps => ({
  invocations: [invocation()],
  projectId: "project-1",
  projectManagerAgentPresetId: "pm-agent",
  ...overrides,
});

describe("useCinematicInvocationFeedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads feedback and preserves it while all invocation refresh signals update", async () => {
    const refresh = deferred<ExecutionInvocationMessageRecord[]>();
    vi.mocked(fetchInvocationMessages)
      .mockResolvedValueOnce([
        message({ contentMarkdown: "First safe update" }),
        message({ id: "call", role: "tool", metadata: { kind: "tool_call", toolCallId: "call-1" } }),
        message({ id: "result", role: "tool", metadata: { kind: "tool_result", toolCallId: "call-1" } }),
      ])
      .mockImplementationOnce(() => refresh.promise)
      .mockResolvedValue([]);

    const view = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps() },
    );

    await waitFor(() => expect(view.result.current).toMatchObject({
      message: "First safe update",
      toolCount: 1,
      loading: false,
      error: null,
    }));
    expect(fetchInvocationMessages).toHaveBeenCalledWith(
      "invocation-1",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    view.rerender(initialProps({
      invocations: [invocation({ messageCount: 3 })],
    }));

    expect(view.result.current).toMatchObject({
      message: "First safe update",
      toolCount: 1,
      loading: true,
    });

    await act(async () => {
      refresh.resolve([
        message({ id: "latest", contentMarkdown: "Fresh safe update", createdAt: "2026-07-13T10:01:00.000Z" }),
        message({ id: "call", role: "tool", metadata: { kind: "tool_call", toolCallId: "call-1" } }),
        message({ id: "call-2", role: "tool", metadata: { kind: "tool_call", toolCallId: "call-2" } }),
      ]);
      await refresh.promise;
    });
    await waitFor(() => expect(view.result.current).toMatchObject({
      message: "Fresh safe update",
      toolCount: 2,
      loading: false,
    }));

    view.rerender(initialProps({
      invocations: [invocation({
        messageCount: 3,
        lastMessageAt: "2026-07-13T10:01:00.000Z",
      })],
    }));
    await waitFor(() => expect(fetchInvocationMessages).toHaveBeenCalledTimes(3));

    view.rerender(initialProps({
      invocations: [invocation({
        messageCount: 3,
        lastMessageAt: "2026-07-13T10:01:00.000Z",
        updatedAt: "2026-07-13T10:02:00.000Z",
      })],
    }));
    await waitFor(() => expect(fetchInvocationMessages).toHaveBeenCalledTimes(4));
  });

  it("keeps same-invocation content when a refresh fails and reports a non-fatal error", async () => {
    vi.mocked(fetchInvocationMessages)
      .mockResolvedValueOnce([message({ contentMarkdown: "Still valid" })])
      .mockRejectedValueOnce(new Error("Transcript temporarily unavailable"));

    const view = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps() },
    );
    await waitFor(() => expect(view.result.current.message).toBe("Still valid"));

    view.rerender(initialProps({
      invocations: [invocation({ updatedAt: "2026-07-13T10:01:00.000Z" })],
    }));

    await waitFor(() => expect(view.result.current).toMatchObject({
      message: "Still valid",
      toolCount: 0,
      loading: false,
      error: "Transcript temporarily unavailable",
    }));
  });

  it("discards stale out-of-order responses after invocation and project changes", async () => {
    const oldRequest = deferred<ExecutionInvocationMessageRecord[]>();
    const newRequest = deferred<ExecutionInvocationMessageRecord[]>();
    vi.mocked(fetchInvocationMessages)
      .mockImplementationOnce(() => oldRequest.promise)
      .mockImplementationOnce(() => newRequest.promise);

    const view = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps() },
    );
    const newInvocation = invocation({
      id: "invocation-2",
      projectId: "project-2",
      startedAt: "2026-07-13T11:00:00.000Z",
    });

    view.rerender(initialProps({
      invocations: [newInvocation],
      projectId: "project-2",
    }));
    expect(view.result.current.message).toBeNull();

    await act(async () => {
      newRequest.resolve([message({
        id: "new-message",
        invocationId: "invocation-2",
        contentMarkdown: "New project update",
      })]);
      await newRequest.promise;
    });
    await waitFor(() => expect(view.result.current.message).toBe("New project update"));

    await act(async () => {
      oldRequest.resolve([message({ contentMarkdown: "Stale project update" })]);
      await oldRequest.promise;
    });
    expect(view.result.current).toMatchObject({
      activeInvocation: newInvocation,
      message: "New project update",
      error: null,
    });
  });

  it("clears feedback when the active invocation becomes terminal or disappears", async () => {
    vi.mocked(fetchInvocationMessages).mockResolvedValue([message()]);
    const view = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps() },
    );
    await waitFor(() => expect(view.result.current.message).toBe("Working on it."));

    view.rerender(initialProps({
      invocations: [invocation({ status: "completed" })],
    }));
    expect(view.result.current).toEqual({
      activeInvocation: null,
      message: null,
      toolCount: 0,
      loading: false,
      error: null,
    });

    view.rerender(initialProps({ invocations: [] }));
    expect(view.result.current.activeInvocation).toBeNull();
    expect(fetchInvocationMessages).toHaveBeenCalledTimes(1);
  });

  it("does not fetch unrelated activity and aborts an active request on unmount", async () => {
    const request = deferred<ExecutionInvocationMessageRecord[]>();
    vi.mocked(fetchInvocationMessages).mockImplementation(() => request.promise);
    const unrelated = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps({
        invocations: [invocation({ agentPresetId: "worker-agent" })],
      }) },
    );
    expect(unrelated.result.current.activeInvocation).toBeNull();
    expect(fetchInvocationMessages).not.toHaveBeenCalled();
    unrelated.unmount();

    const active = renderHook(
      (props: HookProps) => useCinematicInvocationFeedback(props),
      { initialProps: initialProps() },
    );
    await waitFor(() => expect(fetchInvocationMessages).toHaveBeenCalledTimes(1));
    const requestInit = vi.mocked(fetchInvocationMessages).mock.calls[0]?.[1];
    expect(requestInit?.signal?.aborted).toBe(false);

    active.unmount();
    expect(requestInit?.signal?.aborted).toBe(true);

    await act(async () => {
      request.resolve([message({ contentMarkdown: "Too late" })]);
      await request.promise;
    });
  });
});
