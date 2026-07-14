import { useState, useRef, useMemo, useCallback } from "preact/hooks";
import { toVirtualPlanningRouteOption, type PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import type { ProviderId, AgentPreset } from "../../types.js";
import { getCombinedPrompt } from "../../lib/quicksprint-panel-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { sprintAuthoringMessages } from "../../i18n/messages/sprint-authoring.js";

interface VirtualProviderOption {
  id?: string;
  providerConfigId?: string;
  provider?: string;
  label?: string;
  displayLabel?: string;
  iconProviderId?: ProviderId;
  effectiveModel?: string;
}

interface QuicksprintExecutionOptions {
  shouldHandleResult?: () => boolean;
  noTaskLimit?: boolean;
}

export function useQuicksprintExecutionState({
  onExecute,
  virtualProviders,
  routeOverride,
  modelOverride,
  selectedTemplate,
  additionalPrompt,
  taskCount,
  noTaskLimit,
  agentPresets,
  onClose,
  onError,
  onStatus,
}: {
  onExecute: (templateId: string, taskCount: number, submitMode: "plan_only" | "plan_and_start", additionalPrompt?: string, routeOverride?: PlanningRouteOption | null, modelOverride?: string | null, signal?: AbortSignal, options?: QuicksprintExecutionOptions) => Promise<void>;
  virtualProviders: VirtualProviderOption[];
  routeOverride: PlanningRouteOption | null;
  modelOverride: string | null;
  selectedTemplate: QuicksprintTemplateRecord | null;
  additionalPrompt: string;
  taskCount: number;
  noTaskLimit: boolean;
  agentPresets: AgentPreset[];
  onClose: () => void;
  onError?: (message: string) => void;
  onStatus?: (message: string) => void;
}) {
  const { translate } = useDashboardI18n();
  const [executingMode, setExecutingMode] = useState<"plan_only" | "plan_and_start" | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isOverlayDismissed, setIsOverlayDismissed] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRequestRef = useRef<{ id: number; detached: boolean; cancelled: boolean } | null>(null);
  const requestCounterRef = useRef(0);

  const { execution } = useExecutionTimeline();
  const connections = execution?.connections || [];

  const routeOptions = useMemo<PlanningRouteOption[]>(() => {
    const opts: PlanningRouteOption[] = [];
    for (const conn of connections) {
      if (conn.status === "connected" || conn.status === "listening" || conn.status === "idle") {
        opts.push({ type: "connected", id: conn.id, label: conn.displayName || conn.connectionKey });
      }
    }
    opts.push(...virtualProviders.map(toVirtualPlanningRouteOption));
    return opts;
  }, [connections, virtualProviders]);

  const showModelOverride = routeOverride?.type === "virtual";
  const modelProviderId = routeOverride?.iconProviderId;
  const modelOptions = useMemo(
    () => (showModelOverride && modelProviderId ? getProviderModelOptions(modelProviderId) : []),
    [showModelOverride, modelProviderId],
  );

  const combinedPrompt = useMemo(
    () => getCombinedPrompt(selectedTemplate, agentPresets, additionalPrompt, taskCount, noTaskLimit),
    [selectedTemplate, agentPresets, additionalPrompt, taskCount, noTaskLimit]
  );

  const handleExecute = useCallback(
    async (mode: "plan_only" | "plan_and_start") => {
      if (!selectedTemplate) return;
      if (executingMode || activeRequestRef.current) {
        onStatus?.(translate(sprintAuthoringMessages, "duplicatePlanningShort"));
        return;
      }

      const reqId = ++requestCounterRef.current;
      activeRequestRef.current = { id: reqId, detached: false, cancelled: false };

      const ac = new AbortController();
      abortControllerRef.current = ac;

      setExecutingMode(mode);
      setElapsedMs(0);
      setIsOverlayDismissed(false);

      const timer = setInterval(() => {
        setElapsedMs((prev) => prev + 100);
      }, 100);

      try {
        await onExecute(
          selectedTemplate.id,
          taskCount,
          mode,
          additionalPrompt.trim() || undefined,
          routeOverride,
          modelOverride,
          ac.signal,
          {
            noTaskLimit,
            shouldHandleResult: () => {
              if (activeRequestRef.current?.id !== reqId) return false;
              if (activeRequestRef.current?.detached || activeRequestRef.current?.cancelled) return false;
              return true;
            },
          },
        );
        if (activeRequestRef.current?.id === reqId && !activeRequestRef.current.detached && !activeRequestRef.current.cancelled) {
          onClose();
        }
      } catch (err: unknown) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          console.error("Quicksprint execute failed:", err);
          const templateName = selectedTemplate.name;
          const message = err instanceof Error ? err.message : String(err);
          onError?.(translate(sprintAuthoringMessages, "planningFailedNamed", { name: templateName, message }));
        }
      } finally {
        clearInterval(timer);
        const activeRequest = activeRequestRef.current;
        if (activeRequest?.id === reqId) {
          activeRequestRef.current = null;
        }
        if (abortControllerRef.current === ac) {
          abortControllerRef.current = null;
        }
        if (!activeRequest || activeRequest.id === reqId) {
          setExecutingMode(null);
        }
      }
    },
    [onExecute, selectedTemplate, executingMode, taskCount, noTaskLimit, additionalPrompt, routeOverride, modelOverride, onClose, onError, onStatus, translate],
  );

  const detachCurrentRequest = useCallback(() => {
    if (activeRequestRef.current) {
      activeRequestRef.current.detached = true;
    }
    activeRequestRef.current = null;
    abortControllerRef.current = null;
    setExecutingMode(null);
    setIsOverlayDismissed(true);
  }, []);

  const handleNewQuicksprint = useCallback(() => {
    detachCurrentRequest();
  }, [detachCurrentRequest]);

  const handleCancelExecute = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    if (activeRequestRef.current) {
      activeRequestRef.current.cancelled = true;
    }
    setExecutingMode(null);
  }, []);

  return {
    executingMode, setExecutingMode,
    elapsedMs, setElapsedMs,
    isOverlayDismissed, setIsOverlayDismissed,
    handleExecute, handleCancelExecute, handleNewQuicksprint, detachCurrentRequest,
    routeOptions, modelOptions, combinedPrompt,
    abortControllerRef, activeRequestRef, requestCounterRef
  };
}
