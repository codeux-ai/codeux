import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { FunctionComponent, ComponentChildren } from "preact";
import type { ExecutionDashboardSnapshot } from "../types.js";

interface ExecutionTimelineContextValue {
  execution: ExecutionDashboardSnapshot | null;
  snapshotSurface?: ExecutionSnapshotSurfaceState;
  onOrchestrateSprint: (projectId: string, sprintId: string) => void;
  onPauseSprintRun: (sprintRunId: string) => void;
  onCancelSprintRun: (sprintRunId: string) => void;
  onForceCancelSprintRun: (sprintRunId: string) => void;
  onCancelTaskDispatch: (dispatchId: string) => void;
  onForceCancelTaskDispatch: (dispatchId: string) => void;
  onRetryTaskDispatch: (dispatchId: string) => void;
  onClaimAttentionItem: (projectId: string, attentionItemId: string) => void;
  onResolveAttentionItem: (projectId: string, attentionItemId: string) => void;
  onDismissAttentionItem: (projectId: string, attentionItemId: string) => void;
  pendingActionIds: Set<string>;
}

export type ExecutionSnapshotSurfaceKind = "live" | "reconnecting" | "recovering" | "stale";

export interface ExecutionSnapshotSurfaceState {
  kind: ExecutionSnapshotSurfaceKind;
  label: string;
  description: string;
  isBusy: boolean;
}

export const LIVE_EXECUTION_SNAPSHOT_SURFACE: ExecutionSnapshotSurfaceState = {
  kind: "live",
  label: "Live",
  description: "Runtime data is current.",
  isBusy: false,
};

const ExecutionTimelineContext = createContext<ExecutionTimelineContextValue | undefined>(undefined);

export const ExecutionTimelineProvider: FunctionComponent<{
  execution: ExecutionDashboardSnapshot | null;
  snapshotSurface?: ExecutionSnapshotSurfaceState;
  onOrchestrateSprint?: (projectId: string, sprintId: string) => void;
  onPauseSprintRun?: (sprintRunId: string) => void;
  onCancelSprintRun?: (sprintRunId: string) => void;
  onForceCancelSprintRun?: (sprintRunId: string) => void;
  onCancelTaskDispatch?: (dispatchId: string) => void;
  onForceCancelTaskDispatch?: (dispatchId: string) => void;
  onRetryTaskDispatch?: (dispatchId: string) => void;
  onClaimAttentionItem?: (projectId: string, attentionItemId: string) => void;
  onResolveAttentionItem?: (projectId: string, attentionItemId: string) => void;
  onDismissAttentionItem?: (projectId: string, attentionItemId: string) => void;
  pendingActionIds?: Set<string>;
  children: ComponentChildren;
}> = ({
  execution,
  snapshotSurface = LIVE_EXECUTION_SNAPSHOT_SURFACE,
  onOrchestrateSprint = () => {},
  onPauseSprintRun = () => {},
  onCancelSprintRun = () => {},
  onForceCancelSprintRun = () => {},
  onCancelTaskDispatch = () => {},
  onForceCancelTaskDispatch = () => {},
  onRetryTaskDispatch = () => {},
  onClaimAttentionItem = () => {},
  onResolveAttentionItem = () => {},
  onDismissAttentionItem = () => {},
  pendingActionIds = new Set(),
  children
}) => {
  return (
    <ExecutionTimelineContext.Provider value={{
      execution,
      snapshotSurface,
      onOrchestrateSprint,
      onPauseSprintRun,
      onCancelSprintRun,
      onForceCancelSprintRun,
      onCancelTaskDispatch,
      onForceCancelTaskDispatch,
      onRetryTaskDispatch,
      onClaimAttentionItem,
      onResolveAttentionItem,
      onDismissAttentionItem,
      pendingActionIds,
    }}>
      {children}
    </ExecutionTimelineContext.Provider>
  );
};

export const useExecutionTimeline = (): ExecutionTimelineContextValue => {
  const context = useContext(ExecutionTimelineContext);
  if (context === undefined) {
    throw new Error("useExecutionTimeline must be used within an ExecutionTimelineProvider");
  }
  return context;
};
