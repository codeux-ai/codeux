import { Fragment, type FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import { Clock, Eye, FolderGit2, GitPullRequest, Maximize2, RotateCcw, Settings, Trash2 } from "lucide-preact";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import type { Task } from "../../types.js";
import { PRIORITY_CFG, STATUS_CFG, getTaskPriorityLabel, getTaskStatusLabel } from "../../lib/tasks-constants.js";
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
import { SelfReflectionRatingBadge } from "./SelfReflectionRatingBadge.js";
import { SprintReviewBadge } from "../sprints/SprintReviewBadge.js";
import { CiStatusBadge } from "../ui/CiStatusBadge.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { taskMessages } from "../../i18n/messages/tasks.js";

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
  const { locale, translate, translatePlural, formatList, formatNumber } = useOptionalDashboardI18n();
  const statusLabel = getTaskStatusLabel(task.status, locale);
  const priorityLabel = getTaskPriorityLabel(task.priority, locale);
  const interactionTokens = useInteractionTokens();
  const blockerCount = dependencyIndicators.filter((dep) => dep.isBlocking ?? dep.status !== "completed").length;
  const dependencyActionLabel = viewModel.dependencyActionLabel ?? (blockerCount > 0 ? translatePlural(taskMessages, "dependencyBlockers", blockerCount) : translate(taskMessages, "dependenciesClear"));
  const qaNoReviewLabel = viewModel.qaReviewLabel ?? translate(taskMessages, "qaNoReview");
  const dragStateLabel = viewModel.dragStateLabel ?? translate(taskMessages, "dragPointerOnly");
  const shouldShowExecutorLabel = viewModel.executorLabel !== "Auto";
  const cardActions = viewModel.actions ?? [];
  const hasPullRequestMetadata = viewModel.hasPullRequestMetadata ?? true;
  const dependencySummary = dependencyIndicators.length === 0
    ? translate(taskMessages, "noDependencyBlockers")
    : translate(taskMessages, "dependencySummary", {
      dependencies: `${formatNumber(dependencyIndicators.length)} ${locale === "de" ? (dependencyIndicators.length === 1 ? "Abhängigkeit" : "Abhängigkeiten") : (dependencyIndicators.length === 1 ? "dependency" : "dependencies")}`,
      blockers: blockerCount === 0 ? translate(taskMessages, "noBlockers") : translatePlural(taskMessages, "dependencyBlockers", blockerCount),
      details: formatList(dependencyIndicators.map((dep) => `${dep.id} ${dep.stateLabel ?? getTaskStatusLabel(dep.status, locale)}`)),
    });
  const reviewDetails = task.latestReview?.summary?.trim();
  const reviewSummary = task.latestReview
    ? reviewDetails
      ? translate(taskMessages, "qaReviewAvailableDetails", { details: `${reviewDetails}${/[.!?]$/.test(reviewDetails) ? "" : "."}` })
      : translate(taskMessages, "qaReviewAvailable")
    : translate(taskMessages, "noQaReview");
  const ciSummary = ciStatusPresentation?.accessibleLabel ?? translate(taskMessages, "noCiEvidence");
  const runtimeSummary = liveRunningTime
    ? translate(taskMessages, "liveRuntimeSummary", { duration: liveRunningTime, session: sessionState ? translate(taskMessages, "sessionSummary", { session: sessionState }) : "" })
    : sessionState
      ? translate(taskMessages, "runtimeSession", { session: sessionState })
      : translate(taskMessages, "runtimeNotStarted");
  const prSummary = translate(taskMessages, prUrl ? "prAvailable" : hasPullRequestMetadata ? "prUnavailable" : "prDisabled");
  const isReducedMotion = useReducedMotion();
  const isDragDisabled = isReducedMotion || !!task.isOptimistic;
  const effectiveIsDragging = isDragging && !isDragDisabled;
  const savingDescriptionId = task.isOptimistic ? `task-card-saving-${task.recordId}` : undefined;
  const cardStateAnnouncement = [
    translate(taskMessages, "taskStatusNow", { id: task.id, status: statusLabel }),
    dependencyIndicators.length > 0
      ? blockerCount === 0
        ? translate(taskMessages, "blockersResolvedForTask", { id: task.id })
        : translate(taskMessages, "blockersForTask", { blockers: dependencyActionLabel, id: task.id })
      : translate(taskMessages, "noBlockersForTask", { id: task.id }),
    reviewSummary,
    ciSummary,
    prSummary,
    runtimeSummary,
    task.isOptimistic ? translate(taskMessages, "savingTaskActions", { id: task.id }) : null,
  ].filter(Boolean).join(" ");
  const StatusIcon = STATUS_CFG[task.status].icon;
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();
  const actionIconByKind: Record<TaskCardActionDescriptor["kind"], typeof RotateCcw> = {
    rerun: RotateCcw,
    preview: Eye,
    pull_request: GitPullRequest,
    live_runtime: Maximize2,
  };
  const unavailableActionSummary = task.isOptimistic
    ? translate(taskMessages, "savingTaskPaused", { id: task.id })
    : cardActions
      .filter((action) => action.disabledReason)
      .map((action) => action.label)
      .join(", ");
  const unavailableActionSummaryText = unavailableActionSummary && !task.isOptimistic
    ? translate(taskMessages, "unavailableActions", { actions: unavailableActionSummary })
    : unavailableActionSummary;

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
      aria-label={translate(taskMessages, "taskCardLabel", { id: task.id, title: task.title, status: statusLabel, priority: priorityLabel, dependencies: dependencySummary, review: reviewSummary, ci: ciSummary, runtime: runtimeSummary, pr: prSummary, drag: dragStateLabel })}
      data-optimistic={task.isOptimistic ? "true" : undefined}
      data-blocked={blockerCount > 0 ? "true" : undefined}
      data-dragging={effectiveIsDragging ? "true" : undefined}
      data-drag-disabled={isDragDisabled ? "true" : undefined}
      aria-busy={task.isOptimistic ? "true" : "false"}
      className={`kanban-card group relative flex flex-col bg-white/80 dark:bg-void-800/75 backdrop-blur-sm rounded-[1.75rem] p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${task.isOptimistic ? "border-dashed border-2 border-slate-300 dark:border-slate-600 opacity-70" : "border border-black/[0.06] dark:border-white/[0.06]"} ${isReducedMotion ? 'kanban-card-reduced-motion' : ''} ${effectiveIsDragging ? 'kanban-card--dragging ring-2 ring-signal-500' : ''}`}
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
          ? translate(taskMessages, "reducedMotionDragDisabled")
          : task.isOptimistic
            ? translate(taskMessages, "savingDragDisabled")
            : translate(taskMessages, "draggablePointerOnly")}
      </span>
      {savingDescriptionId && (
        <span id={savingDescriptionId} className="sr-only">
          {translate(taskMessages, "savingEditDeleteDrag", { id: task.id })}
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {cardStateAnnouncement}
      </span>
      <div className="absolute inset-0 pointer-events-none transition-colors duration-[var(--kanban-card-control-duration)] ease-[var(--kanban-card-control-ease)] group-hover:bg-signal-500/[0.02] dark:group-hover:bg-signal-500/[0.02]" />
      <WaveFluid accentHex={STATUS_CFG[task.status].hex} />
      <BorderTrace accentHex={STATUS_CFG[task.status].hex} />

      <div className="flex flex-wrap items-start justify-between gap-2 mb-3 relative z-10">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-slate-300 dark:text-slate-600 uppercase tracking-[0.1em]">
            {task.id.toUpperCase()}
          </span>
          <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-[0.1em] text-slate-400">
            <span className="sr-only">, {translate(taskMessages, "status")}: </span><span aria-live="polite" aria-atomic="true" className="sr-only">{translate(taskMessages, "taskStatusNowInline", { id: task.id, status: statusLabel })}</span>
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
          <span className="sr-only">{translate(taskMessages, "priority")}: </span>{priorityLabel}
        </div>
      </div>

      <h4 className={`text-[15px] font-bold tracking-tight leading-snug mb-4 relative z-10 group-hover:translate-x-0.5 transition-transform duration-[var(--kanban-card-control-duration)] ease-[var(--kanban-card-control-ease)] break-words whitespace-normal ${
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
            <span className="sr-only">{translate(taskMessages, "agent")}: </span><span className="truncate min-w-0">{agentPresetName}</span>
          </span>
        )}
        {sessionState && (
          <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1 min-w-0 break-all max-w-full"><span className="sr-only">{translate(taskMessages, "sessionState")}: </span>{sessionState}
          </span>
        )}
        {sessionId && (
          <span className="rounded-full border border-black/[0.06] dark:border-white/[0.08] bg-black/[0.03] dark:bg-white/[0.03] px-2.5 py-1 font-mono min-w-0 break-all max-w-full"><span className="sr-only">{translate(taskMessages, "sessionId")}: </span>{sessionId}
          </span>
        )}
        {task.latestReview ? (
          <SprintReviewBadge summary={task.latestReview} compact showCompactLabel align="right" />
        ) : (
          <span
            className="min-w-0 max-w-full truncate rounded-full border border-slate-400/20 bg-slate-400/[0.08] px-2.5 py-1 text-slate-500 dark:text-slate-300"
            aria-label={translate(taskMessages, "qaReviewNoReviewAria")}
          >
            {qaNoReviewLabel}
          </span>
        )}
        <CiStatusBadge
          presentation={ciStatusPresentation ?? null}
          compact
          className="min-w-0 max-w-full"
        />
        {dependencyIndicators.length > 0 && (
          <span
            className={`rounded-full border px-2.5 py-1 ${blockerCount > 0 ? "border-status-amber/25 bg-status-amber/[0.08] text-status-amber" : "border-status-green/20 bg-status-green/[0.08] text-status-green"}`}
            aria-label={translate(taskMessages, blockerCount > 0 ? "dependenciesBlockedAria" : "dependenciesClearAria", { label: dependencyActionLabel })}
          >
            {dependencyActionLabel}
          </span>
        )}
        {task.isOptimistic && (
          <span className="rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2.5 py-1 text-signal-600 dark:text-signal-400">
            {viewModel.optimisticSavingLabel ?? translate(taskMessages, "saving")}
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
          <span className="sr-only">{translate(taskMessages, "assignee")}: </span><span className="font-medium truncate min-w-0">{task.assignee}</span>
        </div>
      </div>

      <DependencyStatusIndicators indicators={dependencyIndicators} />

      <div className="relative z-10 mt-3 border-t border-black/[0.04] pt-3 dark:border-white/[0.04]">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center sm:gap-0">
          <div className="kanban-card__meta-slots flex min-w-0 flex-wrap items-center gap-2" aria-busy={task.isOptimistic ? "true" : "false"} aria-live="polite" aria-atomic="false">
            <div
              className="kanban-card__meta-slot kanban-card__meta-slot--duration flex min-h-7 min-w-0 items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2 text-[10px] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500"
              aria-label={`${translate(taskMessages, liveRunningTime ? "liveRuntime" : "duration")}: ${liveRunningTime ?? task.time ?? translate(taskMessages, "notStarted")}`}
            >
              <Clock className="w-3 h-3 shrink-0" strokeWidth={2} aria-hidden="true" />
              <span className="sr-only">{translate(taskMessages, liveRunningTime ? "liveRuntime" : "duration")}: </span>
              <span className={`kanban-card__meta-state text-[9px] font-bold uppercase tracking-[0.12em] ${liveRunningTime ? "text-signal-600 dark:text-signal-400" : "text-slate-400 dark:text-slate-500"}`}>
                {translate(taskMessages, liveRunningTime ? "live" : "idle")}
              </span>
              <span aria-live={liveRunningTime ? "polite" : undefined} aria-atomic="true">
                <LiveDurationBadge
                  durationText={liveRunningTime ?? task.time ?? translate(taskMessages, "notStarted")}
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
                aria-label={translate(taskMessages, "openPrForTask", { id: task.id })}
              >
                <GitPullRequest className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                <span>{translate(taskMessages, "prReady")}</span>
              </a>
            )}
            {!prUrl && hasPullRequestMetadata && (
              <span
                className="kanban-card__meta-slot kanban-card__meta-slot--pr flex min-h-7 items-center rounded-full border border-black/[0.06] bg-black/[0.03] px-2 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-500"
                aria-label={translate(taskMessages, "prPendingForTask", { id: task.id })}
              >
                {translate(taskMessages, "prPending")}
              </span>
            )}
          </div>
          <span
            className="kanban-card__meta-slot kanban-card__meta-slot--timestamp text-[9px] font-mono text-slate-300 dark:text-slate-700"
            aria-label={translate(taskMessages, liveStartedAt ? "liveStarted" : "created", { time: liveStartedAt ? formatTimeAgo(liveStartedAt, Date.now(), locale) : humanizedCreatedAt })}
          >
            {liveStartedAt ? `· ${formatTimeAgo(liveStartedAt, Date.now(), locale)}` : humanizedCreatedAt}
          </span>
        </div>

        <div className="kanban-card__actions mt-3 flex w-full max-w-full flex-wrap items-center justify-end gap-1 rounded-2xl border border-black/[0.05] bg-white/90 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur-md dark:border-white/[0.08] dark:bg-void-700/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]" aria-label={translate(taskMessages, "actionsForTask", { id: task.id })} data-motion-contract="controlFeedback">
          {unavailableActionSummaryText && (
            <span className="kanban-card__action-reason-summary" aria-hidden="true">
              {unavailableActionSummaryText}
            </span>
          )}
          {cardActions.map((action) => {
            const ActionIcon = actionIconByKind[action.kind];
            const disabledReason = task.isOptimistic
              ? translate(taskMessages, "temporarilyUnavailable", { id: task.id, action: action.label })
              : action.disabledReason;
            const actionClassName = `kanban-card__action inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 ${
              disabledReason
                ? "text-slate-400 dark:text-slate-500 cursor-not-allowed"
                : "text-slate-500 hover:text-signal-600 dark:text-slate-400 dark:hover:text-signal-400"
            }`;

            if (action.href && !disabledReason) {
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
                  <span className="kanban-card__action-icon"><ActionIcon className="w-3 h-3" aria-hidden="true" /></span>
                  <span className="kanban-card__action-label">{action.label}</span>
                </a>
              );
            }

            const reasonId = `task-card-action-reason-${task.recordId}-${action.kind}`;

            return (
              <Fragment key={action.kind}>
                <button
                  type="button"
                  aria-disabled="true"
                  aria-busy={task.isOptimistic ? "true" : undefined}
                  aria-describedby={reasonId}
                  className={actionClassName}
                  title={`${action.title} ${disabledReason ?? ""}`.trim()}
                  aria-label={action.ariaLabel}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <span className="kanban-card__action-icon"><ActionIcon className="w-3 h-3" aria-hidden="true" /></span>
                  <span className="kanban-card__action-label">{action.label}</span>
                </button>
                <span id={reasonId} className="sr-only">
                  {disabledReason ?? translate(taskMessages, "unavailable")}
                </span>
              </Fragment>
            );
          })}
          <button
            type="button"
            aria-disabled={task.isOptimistic ? "true" : undefined}
            aria-busy={task.isOptimistic ? "true" : undefined}
            aria-describedby={task.isOptimistic ? `task-card-edit-reason-${task.recordId}` : undefined}
            className="kanban-card__action inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors active:scale-95 hover:text-signal-600 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 dark:text-slate-400 dark:hover:text-signal-400"
            title={translate(taskMessages, task.isOptimistic ? "editUnavailable" : "editTask", { id: task.id })} aria-label={translate(taskMessages, "editTaskTarget", { id: task.id, title: task.title })}
            onClick={(event) => {
              event.stopPropagation();
              if (!task.isOptimistic) {
                onEdit(task);
              }
            }}
          >
            <span className="kanban-card__action-icon"><Settings className="w-3 h-3" aria-hidden="true" /></span>
            <span className="kanban-card__action-label">{translate(taskMessages, "edit")}</span>
          </button>
          {task.isOptimistic && (
            <span id={`task-card-edit-reason-${task.recordId}`} className="sr-only">
              {translate(taskMessages, "editSaving", { id: task.id })}
            </span>
          )}
          <button
            type="button"
            ref={triggerRef as any}
            aria-disabled={task.isOptimistic ? "true" : undefined}
            aria-busy={task.isOptimistic ? "true" : undefined}
            aria-describedby={task.isOptimistic ? `task-card-delete-reason-${task.recordId}` : undefined}
            className="kanban-card__action inline-flex min-h-8 items-center gap-1.5 rounded-full px-2 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-500 transition-colors active:scale-95 hover:text-status-red disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30 dark:text-slate-400"
            title={translate(taskMessages, task.isOptimistic ? "deleteUnavailable" : "deleteTaskTarget", { id: task.id, title: task.title })} aria-label={translate(taskMessages, "deleteTaskTarget", { id: task.id, title: task.title })}
            onClick={async (e) => {
              e.stopPropagation();
              if (task.isOptimistic) {
                return;
              }
              const confirmed = await requestConfirm({
                title: translate(taskMessages, "deleteTask"),
                body: translate(taskMessages, "deleteConfirm", { title: task.title }),
                confirmLabel: translate(taskMessages, "deleteTask"),
                cancelLabel: translate(taskMessages, "cancel"),
                destructive: true
              });
              if (confirmed) {
                onDelete(task);
              } else {
                triggerRef.current?.focus({ preventScroll: true });
              }
            }}
          >
            <span className="kanban-card__action-icon"><Trash2 className="w-3 h-3" aria-hidden="true" /></span>
            <span className="kanban-card__action-label">{translate(taskMessages, "delete")}</span>
          </button>
          {task.isOptimistic && (
            <span id={`task-card-delete-reason-${task.recordId}`} className="sr-only">
              {translate(taskMessages, "deleteSaving", { id: task.id })}
            </span>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={isConfirmOpen}
        options={confirmOptions}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
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
