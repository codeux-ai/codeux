import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import type { ExecutionDashboardSnapshot, ExecutionInvocationRecord, GitTrackingStatus } from "../../../types.js";
import { ExecutionTimelineProvider } from "../../../hooks/ExecutionTimelineContext.js";
import type { ExecutionSnapshotSurfaceState } from "../../../hooks/ExecutionTimelineContext.js";
import { ExecutionTimeline } from "../ExecutionTimeline.js";
import { AttentionLedger } from "../AttentionLedger.js";
import { GitCIStatusPanel } from "../GitCIStatusPanel.js";
import { InvocationFeedPanel } from "./InvocationFeedPanel.js";
import { ExecutionRuntimePanel } from "./ExecutionRuntimePanel.js";

export const LiveSessionRuntimeSidebar: FunctionComponent<{
  execution: ExecutionDashboardSnapshot;
  snapshotSurface: ExecutionSnapshotSurfaceState;
  hasSprintContext: boolean;
  invocations: ExecutionInvocationRecord[];
  sprintKeyPrefix: string;
  gitStatus: GitTrackingStatus | null;
  gitStatusError: string | null;
  pendingActionIds: Set<string>;
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
}> = memo(({
  execution,
  snapshotSurface,
  hasSprintContext,
  invocations,
  sprintKeyPrefix,
  gitStatus,
  gitStatusError,
  pendingActionIds,
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
}) => (
  <ExecutionTimelineProvider
    execution={execution}
    snapshotSurface={snapshotSurface}
    onOrchestrateSprint={onOrchestrateSprint}
    onPauseSprintRun={onPauseSprintRun}
    onCancelSprintRun={onCancelSprintRun}
    onForceCancelSprintRun={onForceCancelSprintRun}
    onCancelTaskDispatch={onCancelTaskDispatch}
    onForceCancelTaskDispatch={onForceCancelTaskDispatch}
    onRetryTaskDispatch={onRetryTaskDispatch}
    onClaimAttentionItem={onClaimAttentionItem}
    onResolveAttentionItem={onResolveAttentionItem}
    onDismissAttentionItem={onDismissAttentionItem}
    pendingActionIds={pendingActionIds}
  >
    <InvocationFeedPanel
      collapsible
      defaultOpen={hasSprintContext}
      invocations={invocations}
      sprintKeyPrefix={sprintKeyPrefix}
    />
    <ExecutionTimeline collapsible defaultOpen={hasSprintContext} />
    <GitCIStatusPanel status={gitStatus} error={gitStatusError} />
    <AttentionLedger collapsible defaultOpen={hasSprintContext} />
    <ExecutionRuntimePanel collapsible defaultOpen={hasSprintContext} />
  </ExecutionTimelineProvider>
));
