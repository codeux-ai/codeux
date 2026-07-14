import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ExecutionInvocationRecord } from "../types.js";
import { fetchInvocationMessages } from "../lib/invocation-api.js";
import {
  projectCinematicInvocationFeedback,
  selectCinematicFeedbackInvocation,
} from "../lib/cinematic-invocation-feedback.js";

export interface UseCinematicInvocationFeedbackOptions {
  invocations: readonly ExecutionInvocationRecord[];
  projectId: string | null | undefined;
  projectManagerAgentPresetId: string | null | undefined;
}

export interface UseCinematicInvocationFeedbackResult {
  activeInvocation: ExecutionInvocationRecord | null;
  message: string | null;
  toolCount: number;
  loading: boolean;
  error: string | null;
}

interface FeedbackSnapshot {
  error: string | null;
  invocationId: string | null;
  loading: boolean;
  message: string | null;
  projectId: string | null;
  toolCount: number;
}

const EMPTY_FEEDBACK: FeedbackSnapshot = {
  error: null,
  invocationId: null,
  loading: false,
  message: null,
  projectId: null,
  toolCount: 0,
};

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : String(error)
);

export const useCinematicInvocationFeedback = (
  options: UseCinematicInvocationFeedbackOptions,
): UseCinematicInvocationFeedbackResult => {
  const { invocations, projectId, projectManagerAgentPresetId } = options;
  const requestGenerationRef = useRef(0);
  const [snapshot, setSnapshot] = useState<FeedbackSnapshot>(EMPTY_FEEDBACK);

  const activeInvocation = useMemo(() => {
    if (!projectId) return null;
    return selectCinematicFeedbackInvocation(
      invocations.filter((invocation) => invocation.projectId === projectId),
      projectManagerAgentPresetId,
    );
  }, [invocations, projectId, projectManagerAgentPresetId]);

  const activeInvocationId = activeInvocation?.id ?? null;
  const activeMessageCount = activeInvocation?.messageCount ?? null;
  const activeLastMessageAt = activeInvocation?.lastMessageAt ?? null;
  const activeUpdatedAt = activeInvocation?.updatedAt ?? null;

  useEffect(() => {
    const requestGeneration = requestGenerationRef.current + 1;
    requestGenerationRef.current = requestGeneration;
    const abortController = new AbortController();

    if (!projectId || !activeInvocationId) {
      setSnapshot((current) => (
        current.invocationId === null
          && current.projectId === null
          && !current.loading
          && current.message === null
          && current.toolCount === 0
          && current.error === null
          ? current
          : EMPTY_FEEDBACK
      ));
      return () => {
        abortController.abort();
        if (requestGenerationRef.current === requestGeneration) {
          requestGenerationRef.current += 1;
        }
      };
    }

    setSnapshot((current) => {
      const sameInvocation = current.projectId === projectId
        && current.invocationId === activeInvocationId;
      return {
        error: null,
        invocationId: activeInvocationId,
        loading: true,
        message: sameInvocation ? current.message : null,
        projectId,
        toolCount: sameInvocation ? current.toolCount : 0,
      };
    });

    void fetchInvocationMessages(activeInvocationId, { signal: abortController.signal })
      .then((messages) => {
        if (
          abortController.signal.aborted
          || requestGenerationRef.current !== requestGeneration
        ) {
          return;
        }

        const feedback = projectCinematicInvocationFeedback(messages);
        setSnapshot({
          error: null,
          invocationId: activeInvocationId,
          loading: false,
          message: feedback.message,
          projectId,
          toolCount: feedback.toolCount,
        });
      })
      .catch((error: unknown) => {
        if (
          abortController.signal.aborted
          || requestGenerationRef.current !== requestGeneration
        ) {
          return;
        }

        setSnapshot((current) => {
          if (
            current.projectId !== projectId
            || current.invocationId !== activeInvocationId
          ) {
            return current;
          }
          return {
            ...current,
            error: errorMessage(error),
            loading: false,
          };
        });
      });

    return () => {
      abortController.abort();
      if (requestGenerationRef.current === requestGeneration) {
        requestGenerationRef.current += 1;
      }
    };
  }, [
    activeInvocationId,
    activeLastMessageAt,
    activeMessageCount,
    activeUpdatedAt,
    projectId,
  ]);

  const snapshotMatchesActiveInvocation = Boolean(
    projectId
    && activeInvocationId
    && snapshot.projectId === projectId
    && snapshot.invocationId === activeInvocationId,
  );

  return {
    activeInvocation,
    message: snapshotMatchesActiveInvocation ? snapshot.message : null,
    toolCount: snapshotMatchesActiveInvocation ? snapshot.toolCount : 0,
    loading: snapshotMatchesActiveInvocation ? snapshot.loading : Boolean(activeInvocation),
    error: snapshotMatchesActiveInvocation ? snapshot.error : null,
  };
};
