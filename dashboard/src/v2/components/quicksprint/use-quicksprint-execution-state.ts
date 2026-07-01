import { useState, useRef, useMemo, useCallback } from "preact/hooks";
import type { PlanningRouteOption } from "../../lib/sprint-composer-state.js";
import { getProviderModelOptions } from "../../lib/settings-view-models.js";
import { useExecutionTimeline } from "../../../hooks/ExecutionTimelineContext.js";
import type { ProviderId, AgentPreset } from "../../types.js";
import { getCombinedPrompt } from "../../lib/quicksprint-panel-state.js";
import type { QuicksprintTemplateRecord } from "../../../../../src/contracts/quicksprint-types.js";

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
}

export function useQuicksprintExecutionState({
  onExecute,
  virtualProviders,
  routeOverride,
  modelOverride,
  selectedTemplate,
  additionalPrompt,
  taskCount,
  agentPresets,
  onClose,
}: {
  onExecute: (templateId: string, taskCount: number, submitMode: "plan_only" | "plan_and_start", additionalPrompt?: string, routeOverride?: PlanningRouteOption | null, modelOverride?: string | null, signal?: AbortSignal, options?: QuicksprintExecutionOptions) => Promise<void>;
  virtualProviders: VirtualProviderOption[];
  routeOverride: PlanningRouteOption | null;
  modelOverride: string | null;
  selectedTemplate: QuicksprintTemplateRecord | null;
  additionalPrompt: string;
  taskCount: number;
  agentPresets: AgentPreset[];
  onClose: () => void;
}) {
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
    for (const vp of virtualProviders) {
      opts.push({
        type: "virtual",
        id: vp.providerConfigId || vp.id || vp.provider || "",
        label: vp.displayLabel || vp.label || vp.providerConfigId || vp.id || vp.provider || "Provider",
        provider: vp.providerConfigId || vp.id || vp.provider,
        iconProviderId: vp.iconProviderId || (vp.provider as ProviderId | undefined) || (vp.id as ProviderId | undefined),
        effectiveModel: vp.effectiveModel,
      });
    }
    return opts;
  }, [connections, virtualProviders]);

  const showModelOverride = routeOverride?.type === "virtual";
  const modelProviderId = routeOverride?.iconProviderId;
  const modelOptions = useMemo(
    () => (showModelOverride && modelProviderId ? getProviderModelOptions(modelProviderId) : []),
    [showModelOverride, modelProviderId],
  );

  const combinedPrompt = useMemo(
    () => getCombinedPrompt(selectedTemplate, agentPresets, additionalPrompt, taskCount),
    [selectedTemplate, agentPresets, additionalPrompt, taskCount]
  );

  const handleExecute = useCallback(
    async (mode: "plan_only" | "plan_and_start") => {
      if (!selectedTemplate) return;

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
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("Quicksprint execute failed:", err);
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
    [onExecute, selectedTemplate, taskCount, additionalPrompt, routeOverride, modelOverride, onClose],
  );

  const handleNewQuicksprint = useCallback(() => {
    if (activeRequestRef.current) {
      activeRequestRef.current.detached = true;
    }
    activeRequestRef.current = null;
    abortControllerRef.current = null;
    setExecutingMode(null);
    setIsOverlayDismissed(true);
  }, []);

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
    handleExecute, handleCancelExecute, handleNewQuicksprint,
    routeOptions, modelOptions, combinedPrompt,
    abortControllerRef, activeRequestRef, requestCounterRef
  };
}
