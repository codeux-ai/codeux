import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import { Clock, FolderGit2, GitPullRequest } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import type { Task } from "../../types.js";
import { PRIORITY_CFG, STATUS_CFG } from "../../lib/tasks-constants.js";
import { useTaskCardMotion, useTaskCardDragMotion } from "../../lib/motion/task-card-motion.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { type TaskCardViewModel, formatTimeAgo } from "../../lib/tasks/task-card-view-model.js";
import { useState, useEffect } from "preact/hooks";
import { DependencyStatusIndicators } from "./DependencyStatusIndicators.js";
import { LiveDurationBadge } from "../ui/LiveDurationBadge.js";
import { AgentSelectAvatarIcon } from "../agents/AgentSelectAvatarIcon.js";
import type { AgentAvatarConfig } from "../../types.js";
import './kanban-task-card.css';
import { getSafeUrl } from "../../lib/safe-url.js";
import { SelfReflectionRatingBadge } from "./SelfReflectionRatingBadge.js";
import { WorkflowStatusBadge } from "../ui/WorkflowStatusBadge.js";
import { TaskCardActionMenu } from "./TaskCardActionMenu.js";

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
  const { task, humanizedCreatedAt, dependencyIndicators, selfReflectionRating, ciStatusPresentation, sessionId, sessionState, prUrl, liveRunningTime, liveStartedAt } = viewModel;
  const cardRef = useRef<HTMLDivElement>(null);
  const pri = PRIORITY_CFG[task.priority];
  const statusLabel = STATUS_CFG[task.status].label;
  const interactionTokens = useInteractionTokens();
  const blockerCount = dependencyIndicators.filter((dep) => dep.isBlocking ?? dep.status !== "completed").length;
  const dependencyActionLabel = viewModel.dependencyActionLabel ?? (blockerCount > 0 ? `${blockerCount} dependency ${blockerCount === 1 ? "blocker" : "blockers"}` : "Dependencies clear");
  const dragStateLabel = viewModel.dragStateLabel ?? "Pointer drag only; keyboard reordering is not supported";
  const shouldShowExecutorLabel = viewModel.executorLabel !== "Auto";
  const hasPullRequestMetadata = viewModel.hasPullRequestMetadata ?? true;
  const dependencySummary = dependencyIndicators.length === 0
    ? "No dependency blockers."
    : `${dependencyIndicators.length} ${dependencyIndicators.length === 1 ? "dependency" : "dependencies"}; ${blockerCount === 0 ? "no blockers" : `${blockerCount} ${blockerCount === 1 ? "blocker" : "blockers"}`}: ${dependencyIndicators.map((dep) => `${dep.id} ${dep.stateLabel ?? dep.status.replace(/_/g, " ")}`).join(", ")}.`;
  const reviewDetails = task.latestReview?.summary?.trim();
  const reviewSummary = task.latestReview
    ? reviewDetails
      ? `QA review details available: ${reviewDetails}${/[.!?]$/.test(reviewDetails) ? "" : "."}`
      : "QA review details available."
    : "No QA review recorded.";
  const ciSummary = ciStatusPresentation?.accessibleLabel ?? "No CI workflow evidence.";
  const runtimeSummary = liveRunningTime
    ? `Live runtime ${liveRunningTime}${sessionState ? `, session ${sessionState}` : ""}.`
    : sessionState
      ? `Runtime session ${sessionState}.`
      : "Runtime not started.";
  const prSummary = prUrl ? "Pull request available." : hasPullRequestMetadata ? "No pull request available yet." : "Pull request creation disabled.";
  const isReducedMotion = useReducedMotion();
  const isDragDisabled = isReducedMotion || !!task.isOptimistic;
  const effectiveIsDragging = isDragging && !isDragDisabled;
  const savingDescriptionId = task.isOptimistic ? `task-card-saving-${task.recordId}` : undefined;
  const cardStateAnnouncement = [
    `Task ${task.id} status is now ${statusLabel}.`,
    dependencyIndicators.length > 0
      ? blockerCount === 0
        ? `Dependency blockers resolved for task ${task.id}.`
        : `${dependencyActionLabel} for task ${task.id}.`
      : `No dependency blockers for task ${task.id}.`,
    reviewSummary,
    ciSummary,
    prSummary,
    runtimeSummary,
    task.isOptimistic ? `Saving task ${task.id}; actions that would change this task are temporarily unavailable.` : null,
  ].filter(Boolean).join(" ");
  const StatusIcon = STATUS_CFG[task.status].icon;
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
  useTaskCardDragMotion(cardRef, effectiveIsDragging, isReducedMotion);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      draggable={!isDragDisabled}
      onDragStart={!isDragDisabled ? (onDragStart as any) : undefined}
      onDragEnd={!isDragDisabled ? (onDragEnd as any) : undefined}
      aria-describedby={savingDescriptionId ? `task-card-kbd-${task.recordId} ${savingDescriptionId}` : `task-card-kbd-${task.recordId}`}
      aria-label={`Task ${task.id}: ${task.title}. Status ${statusLabel}. Priority ${pri.label}. ${dependencySummary} ${reviewSummary} ${ciSummary} ${runtimeSummary} ${prSummary} ${dragStateLabel}.`}
      data-optimistic={task.isOptimistic ? "true" : undefined}
      data-blocked={blockerCount > 0 ? "true" : undefined}
      data-dragging={effectiveIsDragging ? "true" : undefined}
      data-drag-disabled={isDragDisabled ? "true" : undefined}
      aria-busy={task.isOptimistic ? "true" : "false"}
      className={`kanban-card group relative flex flex-col bg-white/80 dark:bg-void-800/75 backdrop-blur-sm rounded-[1.75rem] p-5 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${task.isOptimistic ? "border-dashed border-2 border-slate-300 dark:border-slate-600 opacity-70" : "border border-black/[0.06] dark:border-white/[0.06]"} ${isReducedMotion ? 'kanban-card-reduced-motion' : ''} ${effectiveIsDragging ? 'kanban-card--dragging ring-2 ring-signal-500' : ''}`}
      style={{
        transformStyle: "preserve-3d",
        willChange: "transform",
        "--kanban-card-control-duration": interactionTokens.controlFeedback.duration,
        "--kanban-card-control-ease": interactionTokens.controlFeedback.ease,
        "--kanban-card-list-reveal-duration": interactionTokens.listReveal.duration,
        "--kanban-card-list-reveal-ease": interactionTokens.listReveal.ease,
        "--kanban-card-list-duration": interactionTokens.listReorder.duration,
        "--kanban-card-list-ease": interactionTokens.listReorder.ease,
        "--kanban-card-selection-duration": interactionTokens.selectionMovement.duration,
        "--kanban-card-selection-ease": interactionTokens.selectionMovement.ease,
      }}
      data-motion-control="controlFeedback"
      data-motion-selection="selectionMovement"
      data-motion-list-reveal="listReveal"
      data-motion-list-reorder="listReorder"
    >
      <span id={`task-card-kbd-${task.recordId}`} className="sr-only">
        {isReducedMotion
          ? "Draggable reordering is disabled in reduced motion mode."
          : task.isOptimistic
            ? "Draggable reordering is disabled while task changes are saving."
            : "Draggable task. Drag and drop is pointer-only. Keyboard reordering is not supported."}
      </span>
      {savingDescriptionId && (
        <span id={savingDescriptionId} className="sr-only">
          Saving task {task.id}; edit, delete, and drag actions are temporarily unavailable.
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {cardStateAnnouncement}
      </span>
      <div className="absolute inset-0 pointer-events-none transition-colors duration-[var(--kanban-card-control-duration)] ease-[var(--kanban-card-control-ease)] group-hover:bg-signal-500/[0.02] dark:group-hover:bg-signal-500/[0.02]" />
      <WaveFluid accentHex={STATUS_CFG[task.status].hex} />
      <BorderTrace accentHex={STATUS_CFG[task.status].hex} />

      <div className="relative z-10 mb-2.5 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
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
          {selfReflectionRating && (
            <SelfReflectionRatingBadge
              rating={selfReflectionRating}
              position="bottom"
              align="start"
            />
          )}
        </div>
        <div className={`flex shrink-0 items-center gap-1.5 px-2.5 py-1 rounded-full border text-[9px] font-bold uppercase tracking-[0.14em] ${pri.bg} ${pri.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pri.dot}`} aria-hidden="true" />
          <span className="sr-only">Priority: </span>{pri.label}
        </div>
      </div>

      <h4 className={`relative z-10 mb-3 text-[15px] font-bold leading-snug tracking-tight group-hover:translate-x-0.5 transition-transform duration-[var(--kanban-card-control-duration)] ease-[var(--kanban-card-control-ease)] break-words whitespace-normal ${
        task.status === "completed" ? "text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-700" : "text-slate-900 dark:text-white"
      }`}>
        {task.title}
      </h4>

      <div className="relative z-10 mb-3 flex flex-wrap items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
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
        <WorkflowStatusBadge
          scope="task"
          status={task.status}
          review={task.latestReview}
          ciPresentation={ciStatusPresentation ?? null}
          compact
          align="right"
          className="min-w-0 max-w-full"
        />
        {dependencyIndicators.length > 0 && (
          <span
            className={`rounded-full border px-2.5 py-1 ${blockerCount > 0 ? "border-status-amber/25 bg-status-amber/[0.08] text-status-amber" : "border-status-green/20 bg-status-green/[0.08] text-status-green"}`}
            aria-label={blockerCount > 0 ? `${dependencyActionLabel}. Dependencies blocked.` : `${dependencyActionLabel}. No dependency blockers.`}
          >
            {dependencyActionLabel}
          </span>
        )}
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

      <div className="relative z-10 mt-3 border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <div className="kanban-card__footer flex flex-wrap items-center justify-between gap-2">
          <div className="kanban-card__meta-slots flex min-w-0 flex-wrap items-center gap-2" aria-busy={task.isOptimistic ? "true" : "false"} aria-live="polite" aria-atomic="false">
            <div
              className="kanban-card__meta-slot kanban-card__meta-slot--duration flex min-h-7 min-w-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2 text-[10px] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500"
              aria-label={liveRunningTime ? `Live runtime: ${liveRunningTime}` : `Duration: ${task.time ?? "Not started"}`}
            >
              <Clock className="w-3 h-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{liveRunningTime ? "Live runtime: " : "Duration: "}</span>
              <span className={`kanban-card__meta-state text-[9px] font-bold uppercase tracking-[0.12em] ${liveRunningTime ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"}`}>
                {liveRunningTime ? "Live" : "Idle"}
              </span>
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
                className="kanban-card__meta-slot kanban-card__meta-slot--pr flex min-h-7 items-center gap-1 rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-signal-600 transition-colors hover:text-signal-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-signal-400 dark:hover:text-signal-300"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Open pull request for task ${task.id}`}
                title={`Open pull request for task ${task.id}`}
              >
                <GitPullRequest className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                <span>PR ready</span>
              </a>
            )}
            {!prUrl && hasPullRequestMetadata && (
              <span
                className="kanban-card__meta-slot kanban-card__meta-slot--pr flex min-h-7 items-center rounded-full border border-black/[0.06] bg-black/[0.03] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500"
                aria-label={`Pull request pending for task ${task.id}`}
              >
                PR pending
              </span>
            )}
          </div>
          <div className="kanban-card__footer-controls ml-auto flex shrink-0 items-center gap-2">
            <span
              className="kanban-card__meta-slot kanban-card__meta-slot--timestamp text-[9px] font-mono text-slate-300 dark:text-slate-700"
              aria-label={liveStartedAt ? `Live started ${formatTimeAgo(liveStartedAt)}` : `Created ${humanizedCreatedAt}`}
            >
              {liveStartedAt ? `· ${formatTimeAgo(liveStartedAt)}` : humanizedCreatedAt}
            </span>
            <TaskCardActionMenu viewModel={viewModel} onEdit={onEdit} onDelete={onDelete} />
          </div>
        </div>
      </div>
    </div>
  );
}, (prev, next) => (
  prev.viewModel === next.viewModel &&
  prev.index === next.index &&
  prev.agentPresetName === next.agentPresetName &&
  prev.agentPresetAvatarConfig === next.agentPresetAvatarConfig &&
  prev.onEdit === next.onEdit &&
  prev.onDelete === next.onDelete &&
  prev.isDragging === next.isDragging &&
  prev.onDragStart === next.onDragStart &&
  prev.onDragEnd === next.onDragEnd
));
