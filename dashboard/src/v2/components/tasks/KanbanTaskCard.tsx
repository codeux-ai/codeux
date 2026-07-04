import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useRef } from "preact/hooks";
import type { TargetedEvent } from "preact/compat";
import gsap from "gsap";
import { Clock, FolderGit2, GitPullRequest, Settings, Trash2 } from "lucide-preact";
import { BorderTrace } from "../ui/BorderTrace.js";
import type { Task } from "../../types.js";
import { PRIORITY_CFG, STATUS_CFG } from "../../lib/tasks-constants.js";
import { useTaskCardMotion, useTaskCardDragMotion } from "../../lib/motion/task-card-motion.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { type TaskCardViewModel, formatTimeAgo } from "../../lib/tasks/task-card-view-model.js";
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
  const isReducedMotion = useReducedMotion();
  const StatusIcon = STATUS_CFG[task.status].icon;
  const shouldTraceStatus = task.status === "in_progress" || task.status === "coding_completed" || task.status === "QA_REVIEW_FAILED";
  const { isOpen: isConfirmOpen, options: confirmOptions, requestConfirm, handleConfirm, handleCancel, triggerRef } = useConfirmDialog();

  const [flashTriggerCount, setFlashTriggerCount] = useState(0);
  const prevStatusRef = useRef(task.status);
  const prevRunningTimeRef = useRef(liveRunningTime);

  useEffect(() => {
    let shouldFlash = false;

    // Trigger flash if the task status changes
    if (prevStatusRef.current !== task.status) {
      shouldFlash = true;

      if (!isReducedMotion && cardRef.current) {
        let flashColor = '';
        const rawStatus = task.status as string;
        if (rawStatus === 'done' || rawStatus === 'completed') flashColor = 'rgba(0,224,160,0.2)';
        else if (rawStatus === 'in_progress' || rawStatus === 'active') flashColor = 'rgba(59,130,246,0.2)';
        else if (rawStatus === 'blocked' || rawStatus === 'failed' || rawStatus === 'QA_REVIEW_FAILED') flashColor = 'rgba(245,158,11,0.2)';

        if (flashColor) {
          cardRef.current.style.setProperty('--status-flash', flashColor);
          const tl = gsap.timeline();
          tl.to(cardRef.current, { backgroundColor: 'var(--status-flash)', duration: 0.15 })
            .to(cardRef.current, { backgroundColor: '', duration: 0.3, ease: 'power1.out', onComplete: () => {
              if (cardRef.current) gsap.set(cardRef.current, { clearProps: 'backgroundColor' });
            }});
        }
      }
    }

    // Trigger flash on initial data load (transition from null to value)
    if (prevRunningTimeRef.current === null && liveRunningTime !== null) {
      shouldFlash = true;
    }

    if (shouldFlash) {
      setFlashTriggerCount((c) => c + 1);
    }

    prevStatusRef.current = task.status;
    prevRunningTimeRef.current = liveRunningTime;
  }, [task.status, liveRunningTime, isReducedMotion]);

  useTaskCardMotion(cardRef, task.status, isReducedMotion, index);
  useTaskCardDragMotion(cardRef, isDragging, isReducedMotion);

  return (
    <div
      ref={cardRef}
      tabIndex={0}
      draggable={!isReducedMotion}
      onDragStart={!isReducedMotion ? (onDragStart as any) : undefined}
      onDragEnd={!isReducedMotion ? (onDragEnd as any) : undefined}
      aria-roledescription={!isReducedMotion ? "sortable" : undefined}
      aria-describedby={`task-card-kbd-${task.recordId}`}
      onKeyDown={(e) => {
        // Placeholder for accessible reordering
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          // Optional: Toggle accessible drag mode if implemented
        }
      }}
      className={`kanban-card group relative flex min-w-0 flex-col overflow-hidden rounded-[1.35rem] bg-white/[0.86] p-5 shadow-[0_2px_18px_rgba(15,23,42,0.05)] backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 dark:bg-void-800/[0.78] dark:shadow-[0_4px_22px_rgba(0,0,0,0.22)] sm:p-6 ${task.isOptimistic ? "border-dashed border-2 border-slate-300 opacity-60 pointer-events-none dark:border-slate-600" : "border border-black/[0.06] dark:border-white/[0.06]"} ${isReducedMotion ? 'kanban-card-reduced-motion' : ''} ${isDragging ? 'kanban-card--dragging ring-2 ring-signal-500' : ''}`}
      style={{ transformStyle: "preserve-3d", willChange: "transform" }}
    >
      <span id={`task-card-kbd-${task.recordId}`} className="sr-only">
        {isReducedMotion ? "Draggable reordering is disabled in reduced motion mode." : (!onDragStart ? "Keyboard reordering is not supported. Use drag and drop to reorder." : "Draggable task. Drag and drop is pointer-only. Keyboard reordering is not supported.")}
      </span>
      <div className="absolute inset-0 pointer-events-none transition-colors duration-300 group-hover:bg-signal-500/[0.02] dark:group-hover:bg-signal-500/[0.02]" />
      <div className="kanban-card__status-rail" style={{ backgroundColor: STATUS_CFG[task.status].hex }} aria-hidden="true" />
      {shouldTraceStatus && !isReducedMotion && <BorderTrace accentHex={STATUS_CFG[task.status].hex} />}

      <div className="relative z-10 mb-3 flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="min-w-0 break-all font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 dark:text-slate-500">
            {task.id.toUpperCase()}
          </span>
          <div className={`inline-flex max-w-full items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-2 py-1 text-[9px] font-bold uppercase tracking-[0.12em] dark:border-white/[0.08] dark:bg-white/[0.03] ${STATUS_CFG[task.status].color}`}>
            <span className="sr-only">, Status: </span><span aria-live="polite" className="sr-only">Task {task.id} status is now {task.status.replace('_', ' ')}</span>
            <StatusIcon className="w-3 h-3" aria-hidden="true" style={{ color: STATUS_CFG[task.status].hex }} />
            <span className="truncate">{STATUS_CFG[task.status].label}</span>
          </div>
        </div>
        <div className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em] ${pri.bg} ${pri.color}`}>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${pri.dot}`} aria-hidden="true" />
          <span className="sr-only">Priority: </span>{pri.label}
        </div>
      </div>

      <h4 className={`relative z-10 mb-4 break-words text-[15px] font-bold leading-snug tracking-tight transition-transform duration-300 group-hover:translate-x-0.5 ${
        task.status === "completed" ? "text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-700" : "text-slate-900 dark:text-white"
      }`}>
        {task.title}
      </h4>

      <div className="relative z-10 mb-4 grid min-w-0 gap-2 rounded-[1.1rem] border border-black/[0.04] bg-black/[0.018] p-3 dark:border-white/[0.05] dark:bg-white/[0.02] sm:grid-cols-2">
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Executor</div>
          <div className="mt-1 min-w-0 break-words text-xs font-semibold text-slate-700 dark:text-slate-200">
            {viewModel.executorLabel}
          </div>
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Agent</div>
          {agentPresetName ? (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <AgentSelectAvatarIcon avatarConfig={agentPresetAvatarConfig} seed={agentPresetName} />
              <span className="sr-only">Agent: </span>
              <span className="min-w-0 break-words">{agentPresetName}</span>
            </div>
          ) : (
            <div className="mt-1 text-xs font-semibold text-slate-500 dark:text-slate-400">Default</div>
          )}
        </div>
        {(sessionState || sessionId) && (
          <div className="min-w-0 sm:col-span-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400 dark:text-slate-500">Session</div>
            <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-500 dark:text-slate-400">
              {sessionState && <span className="min-w-0 break-words"><span className="sr-only">Session State: </span>{sessionState}</span>}
              {sessionId && <span className="min-w-0 break-all font-mono"><span className="sr-only">Session ID: </span>{sessionId}</span>}
            </div>
          </div>
        )}
      </div>

      <div className="relative z-10 mt-auto grid min-w-0 gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <div className="flex min-w-0 items-start gap-1.5 font-semibold">
          <FolderGit2 className="w-3 h-3 text-slate-300 dark:text-slate-600 group-hover:text-signal-500 transition-colors shrink-0" strokeWidth={2} />
          <span className="font-mono min-w-0 break-all">{task.source}</span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center bg-black/[0.03] dark:bg-white/[0.03] shrink-0">
            <span className="text-[9px] font-black font-display text-slate-500 dark:text-slate-400" aria-hidden="true">
              {task.assignee[0]}
            </span>
          </div>
          <span className="sr-only">Assignee: </span><span className="min-w-0 break-words font-medium">{task.assignee}</span>
        </div>
      </div>

      <DependencyStatusIndicators indicators={dependencyIndicators} />

      <div className="relative z-10 mt-3 flex flex-col items-start justify-between gap-3 border-t border-black/[0.04] pt-3 dark:border-white/[0.04] sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-slate-300 dark:text-slate-600">
            <Clock className="w-3 h-3 shrink-0" strokeWidth={2} aria-hidden="true" />
            <span className="sr-only">Duration: </span>
            <LiveDurationBadge
              durationText={liveRunningTime ?? task.time ?? "Not started"}
              flashTriggerCount={flashTriggerCount}
            />
          </div>
          {prUrl && (
            <a
              href={getSafeUrl(prUrl)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-w-0 items-center gap-1 break-all text-[9px] font-mono text-signal-500 transition-colors hover:text-signal-400"
              onClick={(e) => e.stopPropagation()}
            >
              <GitPullRequest className="w-3 h-3" strokeWidth={2} />
              <span aria-hidden="true">PR</span><span className="sr-only">Pull request link</span>
            </a>
          )}
        </div>
        <span className="break-words text-[9px] font-mono text-slate-300 dark:text-slate-700">{liveStartedAt ? formatTimeAgo(liveStartedAt) : humanizedCreatedAt}</span>
      </div>

      <div className="kanban-card__actions absolute right-3 top-3 z-20 flex items-center gap-1 rounded-full border border-black/[0.05] bg-white/90 p-1 shadow-[0_2px_12px_rgba(0,0,0,0.06)] backdrop-blur-md transition-all duration-200 ease-out [@media(any-pointer:coarse)]:pointer-events-auto [@media(any-pointer:coarse)]:translate-y-0 [@media(any-pointer:coarse)]:opacity-100 group-hover:pointer-events-auto group-hover:translate-y-0 group-hover:opacity-100 group-focus:pointer-events-auto group-focus:translate-y-0 group-focus:opacity-100 group-focus-visible:pointer-events-auto group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-focus-within:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 focus-within:pointer-events-auto focus-within:translate-y-0 focus-within:opacity-100 dark:border-white/[0.08] dark:bg-void-700/95 dark:shadow-[0_2px_12px_rgba(0,0,0,0.4)]">
        <button
          type="button"
          className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-signal-600 dark:hover:text-signal-400 rounded-full transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30"
          title={`Edit task ${task.id}`} aria-label={`Edit task ${task.id}: ${task.title}`}
          onClick={() => onEdit(task)}
        >
          <Settings className="w-3 h-3" />
        </button>
        <button
          type="button"
          ref={triggerRef as any}
          className="p-1.5 text-slate-500 dark:text-slate-400 hover:text-status-red rounded-full transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30"
          title={`Delete task ${task.id}`} aria-label={`Delete task ${task.id}: ${task.title}`}
          onClick={async (e) => {
            e.stopPropagation();
            const confirmed = await requestConfirm({
              title: "Delete Task",
              body: `Are you sure you want to delete "${task.title}"?`,
              confirmLabel: "Delete Task",
              cancelLabel: "Cancel",
              destructive: true
            });
            if (confirmed) {
              onDelete(task);
            }
          }}
        >
          <Trash2 className="w-3 h-3" />
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
         prevTask.title === nextTask.title;

  const depsEqual = prev.viewModel.dependencyIndicators.length === next.viewModel.dependencyIndicators.length &&
         prev.viewModel.dependencyIndicators.every((dep, i) =>
           dep.status === next.viewModel.dependencyIndicators[i].status &&
           dep.recordId === next.viewModel.dependencyIndicators[i].recordId
         );

  return tasksEqual && depsEqual &&
         prev.viewModel.prUrl === next.viewModel.prUrl &&
         prev.viewModel.sessionId === next.viewModel.sessionId &&
         prev.viewModel.liveRunningTime === next.viewModel.liveRunningTime &&
         prev.agentPresetName === next.agentPresetName &&
         prev.onEdit === next.onEdit &&
         prev.onDelete === next.onDelete &&
         prev.isDragging === next.isDragging;
});
