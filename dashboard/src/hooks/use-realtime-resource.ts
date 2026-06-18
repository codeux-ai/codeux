export class RealtimeResourceController<T> {
  private pendingDirectPayload: { value: T } | null = null;
  private directUpdateFrame: number | null = null;
  private directUpdateTimeout: number | null = null;
  private refreshTimeout: number | null = null;

  public stabilizeNext: ((prev: T, next: T) => T) | undefined;
  public isEqual: ((a: T, b: T) => boolean) | undefined;
  public refreshInternal: (opts?: { silent?: boolean }) => Promise<void>;

  constructor(
    private readonly setData: (updater: (prev: T) => T) => void,
    private readonly setError: (error: string | null) => void,
    private readonly setLoading: (updater: (prev: boolean) => boolean) => void,
    private readonly isDeepEqual: (a: T, b: T) => boolean,
    refreshInternal: (opts?: { silent?: boolean }) => Promise<void>,
    stabilizeNext?: ((prev: T, next: T) => T) | undefined,
    isEqual?: ((a: T, b: T) => boolean) | undefined
  ) {
    this.refreshInternal = refreshInternal;
    this.stabilizeNext = stabilizeNext;
    this.isEqual = isEqual;
  }

  flushDirectUpdate = () => {
    if (typeof window !== "undefined") {
      if (this.directUpdateFrame !== null) {
        window.cancelAnimationFrame(this.directUpdateFrame);
      }
      if (this.directUpdateTimeout !== null) {
        window.clearTimeout(this.directUpdateTimeout);
      }
    }
    this.directUpdateFrame = null;
    this.directUpdateTimeout = null;
    const pending = this.pendingDirectPayload;
    if (!pending) {
      return;
    }
    this.pendingDirectPayload = null;
    const nextPayload = pending.value;

    this.setData((prev: T) => {
      const stabilized = this.stabilizeNext ? this.stabilizeNext(prev, nextPayload) : nextPayload;
      if (prev === stabilized) return prev;
      const checkEqual = this.isEqual ?? this.isDeepEqual;
      return checkEqual(prev, stabilized) ? prev : stabilized;
    });
    this.setError(null);
    this.setLoading((prev: boolean) => (prev !== false ? false : prev));
  };

  scheduleDirectUpdate = (payload: T) => {
    this.pendingDirectPayload = { value: payload };
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
      this.flushDirectUpdate();
      return;
    }
    if (this.directUpdateFrame === null) {
      this.directUpdateFrame = window.requestAnimationFrame(() => this.flushDirectUpdate());
    }
    if (this.directUpdateTimeout === null) {
      this.directUpdateTimeout = window.setTimeout(() => this.flushDirectUpdate(), 250);
    }
  };

  scheduleSilentRefresh = () => {
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
    }
    this.refreshTimeout = window.setTimeout(() => {
      this.refreshTimeout = null;
      void this.refreshInternal({ silent: true });
    }, 150);
  };

  cleanup = () => {
    if (typeof window === "undefined") return;
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.directUpdateFrame !== null) {
      window.cancelAnimationFrame(this.directUpdateFrame);
      this.directUpdateFrame = null;
    }
    if (this.directUpdateTimeout !== null) {
      window.clearTimeout(this.directUpdateTimeout);
      this.directUpdateTimeout = null;
    }
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { DashboardRealtimeServerMessage } from "../types.js";
import { subscribeToDashboardRealtime, type TransportState } from "../lib/realtime/dashboard-realtime-client.js";
import { isDeepEqual } from "../v2/lib/resource-equality.js";

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
   * Defaults to deep equality.
   */
  isEqual?: (prev: T, next: T) => boolean;
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
    /** Custom filter function to determine if a message should trigger a silent refetch. Overrides eventType behavior. */
    shouldRefetch?: (message: DashboardRealtimeServerMessage) => boolean;
  };

  /**
   * Defines if the resource should poll in the background, and how often.
   */
  pollIntervalMs?: number;

  /**
   * If true, foreground loading state (and skeleton flash) is suppressed entirely.
   */
  isAlreadyLoaded?: boolean;

  /**
   * If false, a resource that starts from already-loaded data will not immediately
   * refetch on mount. Uncached resources still fetch on mount.
   */
  refreshOnMount?: boolean;
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
    isEqual = isDeepEqual,
    stabilizeNext = (_prev, next) => next,
    realtime,
    pollIntervalMs = 0,
    isAlreadyLoaded = false,
    refreshOnMount = true,
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
      return typeof updater === "function" ? (updater as (curr: T) => T)(base) : updater;
    });
  }, []);

  // We keep a ref to options to avoid stale closures in effects without triggering re-runs
  // if consumers don't memoize them well.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const abortControllerRef = useRef<AbortController | null>(null);
  const fetchIdRef = useRef<number>(0);
  const activeSilentFetchPromiseRef = useRef<Promise<void> | null>(null);

  const refreshInternal = useCallback((refreshOptions?: { silent?: boolean; signal?: AbortSignal }): Promise<void> => {
    // Determine if we show a foreground loading spinner.
    // Only show on the very first fetch if not suppressed.
    // Subsequent polls/realtime refreshes update data silently.
    const isForeground = !refreshOptions?.silent && !hasLoadedRef.current;
    const shouldDedupeSilentFetch = refreshOptions?.silent && !refreshOptions?.signal;

    // Dedupe silent fetches. Any non-deduped fetch supersedes an older silent
    // request, so clear the old promise up front; otherwise a later silent
    // invalidation can get stuck returning an already-aborted request forever.
    if (shouldDedupeSilentFetch && activeSilentFetchPromiseRef.current) {
      return activeSilentFetchPromiseRef.current;
    }
    if (!shouldDedupeSilentFetch) {
      activeSilentFetchPromiseRef.current = null;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    // Compose the external signal if provided
    let abortListener: (() => void) | undefined;
    if (refreshOptions?.signal) {
      const externalSignal = refreshOptions.signal;
      if (externalSignal.aborted) {
        abortController.abort(externalSignal.reason);
      } else {
        abortListener = () => {
          abortController.abort(externalSignal.reason);
        };
        externalSignal.addEventListener("abort", abortListener, { once: true });
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

    const fetchPromise = (async () => {
      try {
        // If the caller provided a signal, respect its abort state alongside our internal one
        // Since fetchResource takes only one signal, we'll pass our internal one,
        // but we will also check the caller's signal for abort conditions.
        const nextData = await optionsRef.current.fetchResource(abortController.signal);

        if (!abortController.signal.aborted && fetchIdRef.current === currentFetchId) {
          setData((prev) => {
            const stabilized = optionsRef.current.stabilizeNext ? optionsRef.current.stabilizeNext(prev, nextData) : nextData;
            if (prev === stabilized) return prev;
            const checkEqual = optionsRef.current.isEqual ?? isDeepEqual;
            return checkEqual(prev, stabilized) ? prev : stabilized;
          });
          hasLoadedRef.current = true;
          setError(null);
        }
      } catch (fetchError: unknown) {
        if (fetchError instanceof Error && fetchError.name === "AbortError" || abortController.signal.aborted) return;
        if (fetchIdRef.current !== currentFetchId) return;
        setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      } finally {
        if (!abortController.signal.aborted && fetchIdRef.current === currentFetchId) {
          setLoading((prev) => (prev !== false ? false : prev));
          setIsRecovering((prev) => (prev !== false ? false : prev));
          isRecoveringRef.current = false;
        }
        if (fetchIdRef.current === currentFetchId) {
          activeSilentFetchPromiseRef.current = null;
        }
        if (abortListener && refreshOptions?.signal) {
          refreshOptions.signal.removeEventListener("abort", abortListener);
        }
      }
    })();

    // Ensure we do not cache a promise that gets aborted, preventing subsequent
    // silent refresh deduplications from getting an already-aborted promise.
    const onAbort = () => {
      if (activeSilentFetchPromiseRef.current === fetchPromise) {
        activeSilentFetchPromiseRef.current = null;
      }
    };
    abortController.signal.addEventListener("abort", onAbort, { once: true });

    if (shouldDedupeSilentFetch) {
      activeSilentFetchPromiseRef.current = fetchPromise;
    }

    return fetchPromise;
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

    if (!options.isAlreadyLoaded || options.refreshOnMount !== false) {
      void refreshInternal();
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [options.fetchResource, options.isAlreadyLoaded, options.refreshOnMount, refreshInternal]);

  const controllerRef = useRef<RealtimeResourceController<T> | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new RealtimeResourceController<T>(
      setData,
      setError,
      setLoading,
      isDeepEqual,
      refreshInternal,
      optionsRef.current.stabilizeNext,
      optionsRef.current.isEqual
    );
  } else {
    // Update captured closures so callbacks aren't stale
    controllerRef.current.refreshInternal = refreshInternal;
    controllerRef.current.stabilizeNext = optionsRef.current.stabilizeNext;
    controllerRef.current.isEqual = optionsRef.current.isEqual;
  }

  useEffect(() => {
    return () => {
      if (controllerRef.current) {
        controllerRef.current.cleanup();
      }
    };
  }, []);

  const scheduleSilentRefresh = useCallback(() => controllerRef.current?.scheduleSilentRefresh(), []);
  const scheduleDirectUpdate = useCallback((payload: T) => controllerRef.current?.scheduleDirectUpdate(payload), []);


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
        const { eventType, updateDirectlyFromEvent, shouldRefetch } = optionsRef.current.realtime || {};

        if (shouldRefetch) {
          if (shouldRefetch(message)) {
            scheduleSilentRefresh();
          }
          return;
        }

        if (eventType && message.type === "event" && message.event.eventType === eventType) {
          if (updateDirectlyFromEvent) {
            // Coalesce to one render per animation frame (see scheduleDirectUpdate) so a burst
            // of large snapshots cannot saturate the main thread and freeze the tab.
            scheduleDirectUpdate(message.event.payload as T);
          } else {
            // Received event but configured to refetch instead of direct update
            scheduleSilentRefresh();
          }
          return;
        }

        // Always fallback to silent REST refetch on `snapshot_required`.
        // We only fallback for `event` types if it's explicitly our matching eventType AND we are not updating directly.
        if (message.type === "snapshot_required") {
          scheduleSilentRefresh();
        }
      },
      (newTransportState) => {
        setTransportState(newTransportState);
        optionsRef.current.realtime?.onTransportState?.(newTransportState);
      }
    );

    return cleanupSubscription;
  }, [scopesKey, options.realtime?.eventType, options.realtime?.updateDirectlyFromEvent, options.realtime?.onTransportState, scheduleSilentRefresh, scheduleDirectUpdate]);

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

  const refetch = useCallback((opts?: { silent?: boolean }) => refreshInternal(opts), [refreshInternal]);

  return useMemo(
    () => ({
      data,
      loading,
      error,
      initialLoadComplete: hasLoadedRef.current,
      transportState,
      isRecovering,
      refetch,
      updateDataLocally,
    }),
    [data, loading, error, transportState, isRecovering, refetch, updateDataLocally]
  );
}
