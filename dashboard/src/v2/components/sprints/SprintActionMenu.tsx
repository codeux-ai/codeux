import type { FunctionComponent } from "preact";
import {
  CheckCircle2,
  CheckSquare,
  Download,
  Heart,
  Loader2,
  ListTodo,
  Maximize2,
  Pause,
  Pencil,
  Play,
  Sparkles,
  Square,
  XCircle,
} from "lucide-preact";
import type { Sprint } from "../../types.js";

export interface SprintActionMenuProps {
  sprint: Sprint;
  isCompleted?: boolean;
  showcaseBusy?: boolean;
  markCompletedDisabled?: boolean;
  deleteBusy?: boolean;
  // Run controls (rendered only when the matching handler is provided)
  isRunning?: boolean;
  isPaused?: boolean;
  primaryBusy?: boolean;
  pauseResumeBusy?: boolean;
  onPrimaryAction?: () => void;
  onPauseResume?: () => void;
  onAddTasks?: () => void;
  viewTasksHref?: string;
  onEdit?: () => void;
  onExport?: () => void;
  onToggleShowcase?: () => void;
  onOverrides?: () => void;
  onMarkCompleted?: () => void;
  onDelete?: () => void;
  onClose?: () => void;
  markCompletedIcon?: "square" | "circle";
  role?: preact.JSX.AriaRole;
  buttonClassName?: string;
}

const SectionSeparator: FunctionComponent = () => (
  <div role="separator" className="my-1 h-px bg-black/[0.06] dark:bg-white/[0.07]" />
);

export const SprintActionMenu: FunctionComponent<SprintActionMenuProps> = ({
  sprint,
  isCompleted = false,
  showcaseBusy = false,
  markCompletedDisabled = false,
  deleteBusy = false,
  isRunning = false,
  isPaused = false,
  primaryBusy = false,
  pauseResumeBusy = false,
  onPrimaryAction,
  onPauseResume,
  onAddTasks,
  viewTasksHref,
  onEdit,
  onExport,
  onToggleShowcase,
  onOverrides,
  onMarkCompleted,
  onDelete,
  onClose,
  markCompletedIcon = "circle",
  role,
  buttonClassName = "flex w-full items-center gap-2 rounded-[1rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2",
}) => {
  const handleDeleteClassName = buttonClassName.replace(
    /text-slate-600 transition-colors hover:bg-black\/\[0\.04\] hover:text-slate-900/,
    "text-status-red hover:bg-status-red/10"
  ).replace(
    /dark:text-slate-300 dark:hover:bg-white\/\[0\.05\] dark:hover:text-white/,
    ""
  ).replace(
    /focus-visible:ring-signal-500\/30/,
    "focus-visible:ring-status-red/30"
  );
  const disabledClassName = `${buttonClassName} disabled:cursor-not-allowed disabled:opacity-40`;

  const canPauseResume = Boolean(onPauseResume) && (isRunning || isPaused);
  const hasRunControls = Boolean(onPrimaryAction) || canPauseResume || Boolean(viewTasksHref) || Boolean(onAddTasks);

  return (
    <>
      {hasRunControls && (
        <>
          {onPrimaryAction && (
            <button
              type="button"
              role={role}
              onClick={() => {
                onClose?.();
                onPrimaryAction();
              }}
              disabled={primaryBusy}
              className={disabledClassName}
            >
              {primaryBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} />
              ) : isRunning ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              ) : (
                <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              )}
              {isRunning ? "Stop Sprint" : "Start Sprint"}
            </button>
          )}
          {canPauseResume && (
            <button
              type="button"
              role={role}
              onClick={() => {
                onClose?.();
                onPauseResume?.();
              }}
              disabled={pauseResumeBusy}
              className={disabledClassName}
            >
              {pauseResumeBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} />
              ) : isPaused ? (
                <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              ) : (
                <Pause className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              )}
              {isPaused ? "Resume" : "Pause"}
            </button>
          )}
          {viewTasksHref && (
            <a
              href={viewTasksHref}
              role={role}
              onClick={() => onClose?.()}
              className={buttonClassName}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.1} />
              View Tasks
            </a>
          )}
          {onAddTasks && (
            <button
              type="button"
              role={role}
              onClick={() => {
                onClose?.();
                onAddTasks();
              }}
              className={buttonClassName}
            >
              <ListTodo className="h-3.5 w-3.5" strokeWidth={2.1} />
              Add Tasks
            </button>
          )}
          <SectionSeparator />
        </>
      )}

      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onEdit?.();
        }}
        className={buttonClassName}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2.1} />
        Edit
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onExport?.();
        }}
        className={buttonClassName}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.1} />
        Export
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onOverrides?.();
        }}
        className={buttonClassName}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.1} />
        Overrides
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onToggleShowcase?.();
        }}
        disabled={showcaseBusy}
        className={disabledClassName}
      >
        <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
        {sprint.showcasePinned ? "Remove" : "Add"}
      </button>

      <SectionSeparator />

      {!isCompleted && (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onMarkCompleted?.();
          }}
          disabled={markCompletedDisabled}
          className={disabledClassName}
        >
          {markCompletedIcon === "square" ? (
            <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.1} />
          )}
          Mark Completed
        </button>
      )}
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onDelete?.();
        }}
        disabled={deleteBusy}
        className={deleteBusy ? `${handleDeleteClassName} disabled:cursor-not-allowed disabled:opacity-40` : handleDeleteClassName}
      >
        {deleteBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.1} />
        ) : (
          <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
        )}
        {deleteBusy ? "Deleting..." : "Delete"}
      </button>
    </>
  );
};
