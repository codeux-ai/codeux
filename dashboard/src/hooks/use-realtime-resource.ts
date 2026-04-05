import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DashboardRealtimeServerMessage } from "../types.js";
import { subscribeToDashboardRealtime, type TransportState } from "../lib/realtime/dashboard-realtime-client.js";

export interface RealtimeResourceOptions<T> {
  /** The initial, empty state for the resource */
  initialData: T;
  /**
   * The function to fetch the resource over REST.
   * Will be called with an AbortSignal.
   */
  fetchResource: (signal?: AbortSignal) => Promise<T>;
  /**
   * Defines whether two snapshots are semantically equal.
   * If they are equal, state will not update.
   */
  isEqual: (prev: T, next: T) => boolean;
  /**
   * Defines how to stabilize the snapshot before checking equality.
   * This is useful for preserving stable references for unchanging nested properties.
   */
  stabilizeNext?: (prev: T, next: T) => T;

  /**
   * Configuration for websocket fallback and realtime push updates.
   */
  realtime?: {
    /** The websocket scopes to subscribe to (e.g. `project:p1`, `overview`) */
    scopes: string[];
    /** The event type to listen to for direct realtime updates (e.g. `project.execution.updated`) */
    eventType?: string;
    /** If `true`, a matching websocket event will replace the resource directly. Otherwise, it triggers a silent refetch. */
    updateDirectlyFromEvent?: boolean;
    /** A callback invoked whenever the underlying connection changes state. */
    onTransportState?: (state: TransportState) => void;
  };

  /**
   * Defines if the resource should poll in the background, and how often.
   */
  pollIntervalMs?: number;

  /**
   * If true, foreground loading state (and skeleton flash) is suppressed entirely.
   */
  isAlreadyLoaded?: boolean;
}

export interface RealtimeResourceResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
  initialLoadComplete: boolean;
  transportState: TransportState;
  isRecovering: boolean;
  refetch: (options?: { silent?: boolean }) => Promise<void>;
  updateDataLocally: (updater: (current: T) => T) => void;
}

/**
 * A generalized custom hook that manages the lifecycle of a resource backed by both REST and WebSocket subscriptions.
 * It encapsulates foreground-versus-silent fetches, abortable refreshes, optional polling,
 * and standard equality/stabilization checks to prevent UI thrashing.
 */
export function useRealtimeResource<T>(options: RealtimeResourceOptions<T>): RealtimeResourceResult<T> {
  const {
    initialData,
    fetchResource,
    isEqual,
    stabilizeNext = (_prev, next) => next,
    realtime,
    pollIntervalMs = 0,
    isAlreadyLoaded = false,
  } = options;

  const [dataState, setDataState] = useState<T>(initialData);
  const prevInitialDataRef = useRef<T>(initialData);

  let data = dataState;
  if (initialData !== prevInitialDataRef.current) {
    data = initialData;
  }
  const [loading, setLoading] = useState(!isAlreadyLoaded);
  const [error, setError] = useState<string | null>(null);
  const [transportState, setTransportState] = useState<TransportState>("disconnected");
  const [isRecovering, setIsRecovering] = useState(!isAlreadyLoaded);

  const hasLoadedRef = useRef(isAlreadyLoaded);
  const isRecoveringRef = useRef(!isAlreadyLoaded);

  // Keep track of what we used to initialize the state.
  // If `initialData` changes (e.g. from cached resources because the project changed),
  // we want to synchronously update `data` to avoid flashing old state while fetching.
  useEffect(() => {
    if (initialData !== prevInitialDataRef.current) {
      prevInitialDataRef.current = initialData;
      setDataState(initialData);
    }
  }, [initialData]);

  const setData = useCallback((updater: T | ((curr: T) => T)) => {
    setDataState((prev) => {
      const base = optionsRef.current.initialData !== prevInitialDataRef.current ? optionsRef.current.initialData : prev;
      return typeof updater === "function" ? (updater as any)(base) : updater;
    });
  }, []);

  // We keep a ref to options to avoid stale closures in effects without triggering re-runs
  // if consumers don't memoize them well.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef<number>(0);

  const refreshInternal = useCallback(async (refreshOptions?: { silent?: boolean; signal?: AbortSignal }): Promise<void> => {
    // Determine if we show a foreground loading spinner.
    // Only show on the very first fetch if not suppressed.
    // Subsequent polls/realtime refreshes update data silently.
    const isForeground = !refreshOptions?.silent && !hasLoadedRef.current;

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Compose the external signal if provided
    if (refreshOptions?.signal) {
      const externalSignal = refreshOptions.signal;
      if (externalSignal.aborted) {
        abortController.abort(externalSignal.reason);
      } else {
        externalSignal.addEventListener("abort", () => {
          abortController.abort(externalSignal.reason);
        }, { once: true });
      }
    }

    fetchIdRef.current += 1;
    const currentFetchId = fetchIdRef.current;

    if (isForeground) {
      setLoading((prev) => (prev !== true ? true : prev));
    }

    if (!isRecoveringRef.current && refreshOptions?.silent !== true) {
      setIsRecovering((prev) => (prev !== true ? true : prev));
      isRecoveringRef.current = true;
    }

    try {
      // If the caller provided a signal, respect its abort state alongside our internal one
      // Since fetchResource takes only one signal, we'll pass our internal one,
      // but we will also check the caller's signal for abort conditions.
      const nextData = await optionsRef.current.fetchResource(abortController.signal);

      if (!abortController.signal.aborted && fetchIdRef.current === currentFetchId) {
        setData((prev) => {
          const stabilized = optionsRef.current.stabilizeNext ? optionsRef.current.stabilizeNext(prev, nextData) : nextData;
          return optionsRef.current.isEqual(prev, stabilized) ? prev : stabilized;
        });
        hasLoadedRef.current = true;
        setError(null);
      }
    } catch (fetchError: any) {
      if (fetchError.name === "AbortError" || abortController.signal.aborted) return;
      if (fetchIdRef.current !== currentFetchId) return;
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      if (!abortController.signal.aborted && fetchIdRef.current === currentFetchId) {
        if (isForeground) {
          setLoading((prev) => (prev !== false ? false : prev));
        }
        setIsRecovering((prev) => (prev !== false ? false : prev));
        isRecoveringRef.current = false;
      }
    }
  }, []);

  // 1. Initial Load & Abortable Fetch Effect
  useEffect(() => {
    // If the hook receives a new `fetchResource` (e.g. project ID changed),
    // we reset our `hasLoaded` flags so it can foreground-load again if needed,
    // UNLESS it was injected as already loaded.
    if (!options.isAlreadyLoaded) {
      hasLoadedRef.current = false;
      isRecoveringRef.current = true;
      setIsRecovering((prev) => (prev !== true ? true : prev));
      setLoading((prev) => (prev !== true ? true : prev));
    } else {
      hasLoadedRef.current = true;
    }

    void refreshInternal();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [options.fetchResource, options.isAlreadyLoaded, refreshInternal]);

  // 2. Realtime WebSocket Subscription Effect

  // We extract scopes as a joined string to avoid referential equality triggers
  // when consumers pass inline arrays (e.g. scopes: ["project:1"]).
  const scopesKey = realtime?.scopes?.join(",") || "";

  useEffect(() => {
    if (!options.realtime || !scopesKey) {
      return;
    }

    const cleanupSubscription = subscribeToDashboardRealtime(
      options.realtime.scopes,
      (message: DashboardRealtimeServerMessage) => {
        const { eventType, updateDirectlyFromEvent } = optionsRef.current.realtime || {};

        if (eventType && message.type === "event" && message.event.eventType === eventType) {
          if (updateDirectlyFromEvent) {
            const nextPayload = message.event.payload as T;
            setData((prev) => {
              const stabilized = optionsRef.current.stabilizeNext ? optionsRef.current.stabilizeNext(prev, nextPayload) : nextPayload;
              return optionsRef.current.isEqual(prev, stabilized) ? prev : stabilized;
            });
            setError(null);
            // Instead of directly depending on the reactive `loading` state here,
            // we use the functional update pattern or just accept we might trigger a
            // reactive render by setting `setLoading((prev) => (prev !== false ? false : prev))` unconditionally
            // but preact will batch it if it's identical.
            setLoading((prev) => (prev !== false ? false : prev));
          } else {
            // Received event but configured to refetch instead of direct update
            void refreshInternal({ silent: true });
          }
          return;
        }

        // Always fallback to silent REST refetch on `snapshot_required`.
        // We only fallback for `event` types if it's explicitly our matching eventType AND we are not updating directly.
        if (message.type === "snapshot_required") {
          void refreshInternal({ silent: true });
        }
      },
      (newTransportState) => {
        setTransportState(newTransportState);
        optionsRef.current.realtime?.onTransportState?.(newTransportState);
      }
    );

    return cleanupSubscription;
  }, [scopesKey, options.realtime?.eventType, options.realtime?.updateDirectlyFromEvent, options.realtime?.onTransportState, refreshInternal]);

  // 3. Fallback Polling Effect
  useEffect(() => {
    if (!pollIntervalMs || pollIntervalMs <= 0) {
      return;
    }
    const intervalId = window.setInterval(() => {
      void refreshInternal({ silent: true });
    }, pollIntervalMs);

    return () => window.clearInterval(intervalId);
  }, [pollIntervalMs, refreshInternal]);

  const updateDataLocally = useCallback((updater: (current: T) => T) => {
    setData(updater);
  }, []);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      initialLoadComplete: hasLoadedRef.current,
      transportState,
      isRecovering,
      refetch: (opts) => refreshInternal(opts),
      updateDataLocally,
    }),
    [data, loading, error, transportState, isRecovering, refreshInternal, updateDataLocally]
  );
}
