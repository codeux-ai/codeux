import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import { Clock, Eye, FolderGit2, GitPullRequest, Maximize2, RotateCcw, Settings, Trash2 } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import type { Task } from "../../types.js";
import { PRIORITY_CFG, STATUS_CFG } from "../../lib/tasks-constants.js";
import { useTaskCardMotion, useTaskCardDragMotion } from "../../lib/motion/task-card-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { type TaskCardActionDescriptor, type TaskCardViewModel, formatTimeAgo } from "../../lib/tasks/task-card-view-model.js";
import { useState, useEffect } from "preact/hooks";
import { DependencyStatusIndicators } from "./DependencyStatusIndicators.js";
import { LiveDurationBadge } from "../ui/LiveDurationBadge.js";
import { AgentSelectAvatarIcon } from "../agents/AgentSelectAvatarIcon.js";
import type { AgentAvatarConfig } from "../../types.js";
import './kanban-task-card.css';
import { getSafeUrl } from "../../lib/safe-url.js";

export const KanbanTaskCard: FunctionComponent<{
  viewModel: TaskCardViewModel;
  index?: number;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  agentPresetName?: string | null;
  agentPresetAvatarConfig?: AgentAvatarConfig;
  isDragging?: boolean;
  onDragStart?: (e: DragEvent) => void;
  onDragEnd?: (e: DragEvent) => void;
}> = memo(({ viewModel, index = 0, onEdit, onDelete, agentPresetName, agentPresetAvatarConfig, isDragging = false, onDragStart, onDragEnd }) => {
  const { task, humanizedCreatedAt, dependencyIndicators, sessionId, sessionState, prUrl, liveRunningTime, liveStartedAt } = viewModel;
  const cardRef = useRef<HTMLDivElement>(null);
  const pri = PRIORITY_CFG[task.priority];
  const statusLabel = STATUS_CFG[task.status].label;
  const interactionTokens = useInteractionTokens();
  const blockerCount = dependencyIndicators.filter((dep) => dep.isBlocking ?? dep.status !== "completed").length;
  const dependencyActionLabel = viewModel.dependencyActionLabel ?? (blockerCount > 0 ? `${blockerCount} dependency ${blockerCount === 1 ? "blocker" : "blockers"}` : "Dependencies clear");
  const qaReviewLabel = viewModel.qaReviewLabel ?? (task.latestReview ? `QA ${task.latestReview.status}` : "QA not reviewed");
  const dragStateLabel = viewModel.dragStateLabel ?? "Pointer drag only; keyboard reordering is not supported";
  const shouldShowExecutorLabel = viewModel.executorLabel !== "Auto";
  const cardActions = viewModel.actions ?? [];
  const hasPullRequestMetadata = viewModel.hasPullRequestMetadata ?? true;
  const dependencySummary = dependencyIndicators.length === 0
    ? "No dependency blockers."
    : `${dependencyIndicators.length} ${dependencyIndicators.length === 1 ? "dependency" : "dependencies"}; ${blockerCount === 0 ? "no blockers" : `${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}`}: ${dependencyIndicators.map((dep) => `${dep.id} ${dep.stateLabel ?? dep.status.replace(/_/g, " ")}`).join(", ")}.`;
  const reviewSummary = task.latestReview
    ? `QA review ${task.latestReview.status}${task.latestReview.outcome ? `, outcome ${task.latestReview.outcome}` : ""}.`
    : "No QA review recorded.";
  const runtimeSummary = liveRunningTime
    ? `Live runtime ${liveRunningTime}${sessionState ? `, session ${sessionState}` : ""}.`
    : sessionState
      ? `Runtime session ${sessionState}.`
      : "Runtime not started.";
  const prSummary = prUrl ? "Pull request available." : hasPullRequestMetadata ? "No pull request available yet." : "Pull request creation disabled.";
  const isReducedMotion = useReducedMotion();
  const isDragDisabled = isReducedMotion || !!task.isOptimistic;
  const StatusIcon = STATUS_CFG[task.status].icon;
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();
  const actionIconByKind: Record<TaskCardActionDescriptor["kind"], typeof RotateCcw> = {
    rerun: RotateCcw,
    preview: Eye,
    pull_request: GitPullRequest,
    live_runtime: Maximize2,
  };

  const [flashTriggerCount, setFlashTriggerCount] = useState(0);
  const prevRunningTimeRef = useRef(liveRunningTime);

  useEffect(() => {
    const shouldFlash = prevRunningTimeRef.current == null && liveRunningTime != null;

    if (shouldFlash) {
      setFlashTriggerCount((c) => c + 1);
    }

    prevRunningTimeRef.current = liveRunningTime;
  }, [liveRunningTime]);

  useTaskCardMotion(cardRef, task.status, isReducedMotion, index);
  useTaskCardDragMotion(cardRef, isDragging, isReducedMotion);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      draggable={!isDragDisabled}
      onDragStart={!isDragDisabled ? (onDragStart as any) : undefined}
      onDragEnd={!isDragDisabled ? (onDragEnd as any) : undefined}
      aria-describedby={`task-card-kbd-${task.recordId}`}
      aria-label={`Task ${task.id}: ${task.title}. Status ${statusLabel}. Priority ${pri.label}. ${dependencySummary} ${reviewSummary} ${runtimeSummary} ${prSummary} ${dragStateLabel}.`}
      data-optimistic={task.isOptimistic ? "true" : undefined}
      data-blocked={blockerCount > 0 ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      aria-busy={task.isOptimistic ? "true" : undefined}
      className={`kanban-card group relative flex flex-col bg-white/80 dark:bg-void-800/75 backdrop-blur-sm rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${task.isOptimistic ? "border-dashed border-2 border-slate-300 dark:border-slate-600 opacity-70" : "border border-black/[0.06] dark:border-white/[0.06]"} ${isReducedMotion ? 'kanban-card-reduced-motion' : ''} ${isDragging ? 'kanban-card--dragging ring-2 ring-signal-500' : ''}`}
      style={{
        transformStyle: "preserve-3d",
        willChange: "transform",
        "--kanban-card-control-duration": interactionTokens.controlFeedback.duration,
        "--kanban-card-control-ease": interactionTokens.controlFeedback.ease,
        "--kanban-card-list-duration": interactionTokens.listReorder.duration,
        "--kanban-card-list-ease": interactionTokens.listReorder.ease,
        "--kanban-card-selection-duration": interactionTokens.selectionMovement.duration,
        "--kanban-card-selection-ease": interactionTokens.selectionMovement.ease,
      }}
    >
      <span id={`task-card-kbd-${task.recordId}`} className="sr-only">
        {isReducedMotion
          ? "Draggable reordering is disabled in reduced motion mode."
          : task.isOptimistic
            ? "Draggable reordering is disabled while task changes are saving."
            : "Draggable task. Drag and drop is pointer-only. Keyboard reordering is not supported."}
      </span>
      <div className="absolute inset-0 pointer-events-none transition-colors duration-300 group-hover:bg-signal-500/[0.02] dark:group-hover:bg-signal-500/[0.02]" />
      <WaveFluid accentHex={STATUS_CFG[task.status].hex} />
      <BorderTrace accentHex={STATUS_CFG[task.status].hex} />

      <div className="flex items-center justify-between mb-3 relative z-10">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-[0.1em]">
            {task.id.toUpperCase()}
          </span>
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
            <span className="sr-only">, Status: </span><span aria-live="polite" aria-atomic="true" className="sr-only">Task {task.id} status is now {statusLabel}</span>
            <StatusIcon className="w-3 h-3" aria-hidden="true" style={{ color: STATUS_CFG[task.status].hex }} />
            <span className="rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-0.5 text-[9px] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300">
              {statusLabel}
            </span>
          </div>
        </div>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.14em] ${pri.bg} ${pri.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pri.dot}`} aria-hidden="true" />
          <span className="sr-only">Priority: </span>{pri.label}
        </div>
      </div>

      <h4 className={`text-[15px] font-bold tracking-tight leading-snug mb-4 relative z-10 group-hover:translate-x-0.5 transition-transform duration-300 pr-12 break-words whitespace-normal ${
        task.status === "completed" ? "text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-700" : "text-slate-900 dark:text-white"
      }`}>
        {task.title}
      </h4>

      <div className="relative z-10 mb-4 flex flex-wrap items-center gap-2 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
        {shouldShowExecutorLabel && (
          <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1 min-w-0 truncate max-w-full">
            {viewModel.executorLabel}
          </span>
        )}
        {agentPresetName && (
          <span className="inline-flex items-center gap-1 rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2 py-0.5 min-w-0 max-w-full">
            <AgentSelectAvatarIcon avatarConfig={agentPresetAvatarConfig} seed={agentPresetName} />
            <span className="sr-only">Agent: </span><span className="truncate min-w-0">{agentPresetName}</span>
          </span>
        )}
        {sessionState && (
          <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1 min-w-0 break-all max-w-full"><span className="sr-only">Session state: </span>{sessionState}
          </span>
        )}
        {sessionId && (
          <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1 font-mono min-w-0 break-all max-w-full"><span className="sr-only">Session ID: </span>{sessionId}
          </span>
        )}
        {task.latestReview && (
          <span className="rounded-full border border-status-amber/20 bg-status-amber/[0.08] px-2.5 py-1 text-status-amber min-w-0 max-w-full truncate">
            QA {task.latestReview.status}{task.latestReview.outcome ? `: ${task.latestReview.outcome}` : ""}
            <span className="sr-only">
              . QA review state: {task.latestReview.status}{task.latestReview.outcome ? `, outcome ${task.latestReview.outcome}` : ""}{task.latestReview.summary ? `. ${task.latestReview.summary}` : ""}.
            </span>
          </span>
        )}
        {dependencyIndicators.length > 0 && (
          <span className={`rounded-full border px-2.5 py-1 ${blockerCount > 0 ? "border-status-amber/25 bg-status-amber/[0.08] text-status-amber" : "border-status-green/20 bg-status-green/[0.08] text-status-green"}`}>
            {dependencyActionLabel}
          </span>
        )}
        <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1">
          {qaReviewLabel}
        </span>
        {task.isOptimistic && (
          <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-signal-600 dark:text-signal-400">
            {viewModel.optimisticSavingLabel ?? "Saving"}
          </span>
        )}
      </div>

      <div className="flex items-center gap-3 mt-auto relative z-10 min-w-0">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 dark:text-slate-500 min-w-0">
          <FolderGit2 className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors shrink-0" strokeWidth={2} />
          <span className="font-mono truncate min-w-0">{task.source}</span>
        </div>

        <span className="text-slate-200 dark:text-slate-700 text-[9px] shrink-0">·</span>

        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500 min-w-0">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-black/[0.03] dark:bg-white/[0.03] shrink-0">
            <span className="text-[9px] font-black font-display text-slate-500 dark:text-slate-400" aria-hidden="true">
              {task.assignee[0]}
            </span>
          </div>
          <span className="sr-only">Assignee: </span><span className="font-medium truncate min-w-0">{task.assignee}</span>
        </div>
      </div>

      <DependencyStatusIndicators indicators={dependencyIndicators} />

      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0 mt-3 pt-3 border-t border-black/[0.04] dark:border-white/[0.04] relative z-10">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-slate-300 dark:text-slate-600">
            <Clock className="w-3 h-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">{liveRunningTime ? "Live runtime: " : "Duration: "}</span>
            {liveRunningTime && <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 dark:text-signal-400">Live</span>}
            <span aria-live={liveRunningTime ? "polite" : undefined} aria-atomic="true">
              <LiveDurationBadge
                durationText={liveRunningTime ?? task.time ?? "Not started"}
                flashTriggerCount={flashTriggerCount}
              />
            </span>
          </div>
          {prUrl && (
            <a
              href={getSafeUrl(prUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-7 items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:text-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-signal-400 dark:hover:text-signal-300"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Open pull request for task ${task.id}`}
            >
              <GitPullRequest className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
              <span>PR ready</span>
            </a>
          )}
          {!prUrl && hasPullRequestMetadata && (
            <span className="flex min-h-7 items-center rounded-full border border-black/[0.06] bg-black/[0.03] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500">
              PR pending
            </span>
          )}
        </div>
        <span className="text-[9px] font-mono text-slate-300 dark:text-slate-700">{liveStartedAt ? `· ${formatTimeAgo(liveStartedAt)}` : humanizedCreatedAt}</span>
      </div>

      <div className="kanban-card__actions absolute top-3 right-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-end gap-1 p-1 bg-white/90 dark:bg-void-700/95 backdrop-blur-md rounded-2xl shadow-[0_2px_12px_rgba(0,0,0,0.06)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)] border border-black/[0.05] dark:border-white/[0.08] z-20" aria-label={`Actions for task ${task.id}`}>
        {cardActions.map((action) => {
          const ActionIcon = actionIconByKind[action.kind];
          const actionClassName = `inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
            action.disabledReason
              ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
              : "text-slate-500 hover:text-signal-600 dark:text-slate-400 dark:hover:text-signal-400"
          }`;

          if (action.href && !action.disabledReason) {
            return (
              <a
                key={action.kind}
                href={getSafeUrl(action.href)}
                target={action.external ? "_blank" : undefined}
                rel={action.external ? "noopener noreferrer" : undefined}
                className={actionClassName}
                title={action.title}
                aria-label={action.ariaLabel}
                onClick={(event) => event.stopPropagation()}
              >
                <ActionIcon className="w-3 h-3" aria-hidden="true" />
                <span>{action.label}</span>
              </a>
            );
          }

          return (
            <button
              key={action.kind}
              type="button"
              aria-disabled="true"
              aria-describedby={`task-card-action-reason-${task.recordId}-${action.kind}`}
              className={actionClassName}
              title={`${action.title} ${action.disabledReason ?? ""}`.trim()}
              aria-label={`${action.ariaLabel}. ${action.disabledReason ?? "Unavailable"}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <ActionIcon className="w-3 h-3" aria-hidden="true" />
              <span>{action.label}</span>
              <span id={`task-card-action-reason-${task.recordId}-${action.kind}`} className="sr-only">
                {action.disabledReason ?? "Unavailable"}
              </span>
            </button>
          );
        })}
        <button
          type="button"
          aria-disabled={task.isOptimistic ? "true" : undefined}
          aria-busy={task.isOptimistic ? "true" : undefined}
          aria-describedby={task.isOptimistic ? `task-card-edit-reason-${task.recordId}` : undefined}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors active:scale-95 hover:text-signal-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-slate-400 dark:hover:text-signal-400"
          title={task.isOptimistic ? `Edit unavailable while task ${task.id} is saving` : `Edit task ${task.id}`} aria-label={task.isOptimistic ? `Edit task ${task.id}: ${task.title}. Saving in progress` : `Edit task ${task.id}: ${task.title}`}
          onClick={(event) => {
            event.stopPropagation();
            if (!task.isOptimistic) {
              onEdit(task);
            }
          }}
        >
          <Settings className="w-3 h-3" aria-hidden="true" />
          <span>Edit</span>
          {task.isOptimistic && (
            <span id={`task-card-edit-reason-${task.recordId}`} className="sr-only">Saving in progress; edit is temporarily unavailable.</span>
          )}
        </button>
        <button
          type="button"
          ref={triggerRef as any}
          aria-disabled={task.isOptimistic ? "true" : undefined}
          aria-busy={task.isOptimistic ? "true" : undefined}
          aria-describedby={task.isOptimistic ? `task-card-delete-reason-${task.recordId}` : undefined}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors active:scale-95 hover:text-status-red disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30 dark:text-slate-400"
          title={task.isOptimistic ? `Delete unavailable while task ${task.id} is saving` : `Delete task ${task.id}`} aria-label={task.isOptimistic ? `Delete task ${task.id}: ${task.title}. Saving in progress` : `Delete task ${task.id}: ${task.title}`}
          onClick={async (e) => {
            e.stopPropagation();
            if (task.isOptimistic) {
              return;
            }
            const confirmed = await requestConfirm({
              title: "Delete Task",
              body: `Delete "${task.title}"? This removes the task card and cannot be undone.`,
              confirmLabel: "Delete Task",
              cancelLabel: "Cancel",
              destructive: true
            });
            if (confirmed) {
              onDelete(task);
            } else {
              triggerRef.current?.focus({ preventScroll: true });
            }
          }}
        >
          <Trash2 className="w-3 h-3" aria-hidden="true" />
          <span>Delete</span>
          {task.isOptimistic && (
            <span id={`task-card-delete-reason-${task.recordId}`} className="sr-only">Saving in progress; delete is temporarily unavailable.</span>
          )}
        </button>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        options={confirmOptions}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    </div>
  );
}, (prev, next) => {
  const prevTask = prev.viewModel.task;
  const nextTask = next.viewModel.task;

  const tasksEqual = prevTask.recordId === nextTask.recordId &&
         prevTask.status === nextTask.status &&
         prevTask.priority === nextTask.priority &&
         prevTask.title === nextTask.title &&
         prevTask.isOptimistic === nextTask.isOptimistic &&
         prevTask.latestReview?.status === nextTask.latestReview?.status &&
         prevTask.latestReview?.outcome === nextTask.latestReview?.outcome &&
         prevTask.latestReview?.summary === nextTask.latestReview?.summary;

  const depsEqual = prev.viewModel.dependencyIndicators.length === next.viewModel.dependencyIndicators.length &&
         prev.viewModel.dependencyIndicators.every((dep, i) =>
           dep.status === next.viewModel.dependencyIndicators[i].status &&
           dep.recordId === next.viewModel.dependencyIndicators[i].recordId
         );

  return tasksEqual && depsEqual &&
         prev.viewModel.prUrl === next.viewModel.prUrl &&
         prev.viewModel.hasPullRequestMetadata === next.viewModel.hasPullRequestMetadata &&
         prev.viewModel.sessionId === next.viewModel.sessionId &&
         prev.viewModel.sessionState === next.viewModel.sessionState &&
         prev.viewModel.liveRunningTime === next.viewModel.liveRunningTime &&
         prev.viewModel.liveStartedAt === next.viewModel.liveStartedAt &&
         prev.viewModel.executorLabel === next.viewModel.executorLabel &&
         prev.agentPresetName === next.agentPresetName &&
         prev.agentPresetAvatarConfig === next.agentPresetAvatarConfig &&
         prev.onEdit === next.onEdit &&
         prev.onDelete === next.onDelete &&
         prev.isDragging === next.isDragging;
});
