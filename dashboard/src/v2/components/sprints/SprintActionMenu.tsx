import type { FunctionComponent } from "preact";
import {
  CheckCircle2,
  CheckSquare,
  Download,
  Heart,
  Pencil,
  Sparkles,
  XCircle,
  Play,
  Square,
} from "lucide-preact";
import type { Sprint } from "../../types.js";

export interface SprintActionMenuProps {
  sprint: Sprint;
  isCompleted?: boolean;
  showcaseBusy?: boolean;
  markCompletedDisabled?: boolean;
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
  onRunQaReview?: () => void;
  onStopQaReview?: () => void;
}

export const SprintActionMenu: FunctionComponent<SprintActionMenuProps> = ({
  sprint,
  isCompleted = false,
  showcaseBusy = false,
  markCompletedDisabled = false,
  onEdit,
  onExport,
  onToggleShowcase,
  onOverrides,
  onMarkCompleted,
  onDelete,
  onClose,
  markCompletedIcon = "circle",
  role,
  buttonClassName = "flex w-full items-center gap-2 rounded-[1rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2",
  onRunQaReview,
  onStopQaReview,
}) => {
  const handleDeleteClassName = buttonClassName.replace(
    /text-slate-600.*hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white\/\[0\.05\] dark:hover:text-white/,
    "text-status-red hover:bg-status-red/10"
  );

  return (
    <>
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
      {!isCompleted && (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onMarkCompleted?.();
          }}
          disabled={markCompletedDisabled}
          className={`${buttonClassName} disabled:cursor-not-allowed disabled:opacity-40`}
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
          onToggleShowcase?.();
        }}
        disabled={showcaseBusy}
        className={`${buttonClassName} disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
        {sprint.showcasePinned ? "Remove" : "Add"}
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
      {sprint.latestReview?.status === "running" ? (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onStopQaReview?.();
          }}
          className={buttonClassName}
        >
          <Square className="h-3.5 w-3.5 text-status-red" fill="currentColor" strokeWidth={2.1} />
          Stop QA Review
        </button>
      ) : (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onRunQaReview?.();
          }}
          className={buttonClassName}
        >
          <Play className="h-3.5 w-3.5 text-status-green" fill="currentColor" strokeWidth={2.1} />
          Run QA Review
        </button>
      )}
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onDelete?.();
        }}
        className={handleDeleteClassName}
      >
        <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
        Delete
      </button>
    </>
  );
};
