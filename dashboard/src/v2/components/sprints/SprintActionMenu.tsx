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
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import type { Sprint } from "../../types.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

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
  buttonClassName = "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium leading-snug text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 [&>span]:min-w-0 [&>span]:break-words",
}) => {
  const actionConfirm = useConfirmDialog();
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

  const confirmMenuAction = async (
    options: {
      title: string;
      body: string;
      confirmLabel: string;
      destructive?: boolean;
      tone?: "default" | "success" | "warning" | "danger" | "neutral";
    },
    action?: () => void,
  ): Promise<void> => {
    if (!action) {
      onClose?.();
      return;
    }
    const confirmed = await actionConfirm.requestConfirm(options);
    onClose?.();
    if (confirmed) {
      action();
    }
  };

  return (
    <>
      <ConfirmDialog
        isOpen={actionConfirm.isOpen}
        options={actionConfirm.options}
        onConfirm={actionConfirm.handleConfirm}
        onCancel={actionConfirm.handleCancel}
      />
      {hasRunControls && (
        <>
          {onPrimaryAction && (
            <button
              type="button"
              role={role}
              onClick={() => {
                if (isRunning) {
                  void confirmMenuAction({
                    title: "Stop Sprint",
                    body: `Stop sprint "${sprint.name}"? Active task dispatches may be interrupted.`,
                    confirmLabel: "Stop Sprint",
                    destructive: true,
                  }, onPrimaryAction);
                  return;
                }
                onClose?.();
                onPrimaryAction();
              }}
              disabled={primaryBusy}
              title={primaryBusy ? "Sprint action in progress" : undefined}
              aria-busy={primaryBusy}
              className={disabledClassName}
            >
              {primaryBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
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
                if (isPaused) {
                  onClose?.();
                  onPauseResume?.();
                  return;
                }
                void confirmMenuAction({
                  title: "Pause Sprint",
                  body: `Pause sprint "${sprint.name}"? Running work will stop accepting new sprint actions until it is resumed.`,
                  confirmLabel: "Pause",
                  tone: "warning",
                }, onPauseResume);
              }}
              disabled={pauseResumeBusy}
              title={pauseResumeBusy ? "Sprint pause or resume action in progress" : undefined}
              aria-busy={pauseResumeBusy}
              className={disabledClassName}
            >
              {pauseResumeBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
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
              aria-label={`View tasks for sprint ${sprint.name}`}
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
        aria-label={`Edit sprint ${sprint.name}`}
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
        aria-label={`Export sprint ${sprint.name}`}
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
        aria-label={`Configure overrides for sprint ${sprint.name}`}
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
        title={showcaseBusy ? "Showcase update in progress" : undefined}
        aria-busy={showcaseBusy}
        className={disabledClassName}
      >
        {showcaseBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
        ) : (
          <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
        )}
        {showcaseBusy ? "Updating" : sprint.showcasePinned ? "Remove" : "Add"}
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
          title={markCompletedDisabled ? "Mark complete is disabled while another sprint action is in progress" : undefined}
          aria-label={`Mark sprint ${sprint.name} as completed`}
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
          void confirmMenuAction({
            title: "Delete Sprint",
            body: `Delete sprint "${sprint.name}" and its tasks? This action cannot be undone.`,
            confirmLabel: "Delete",
            destructive: true,
          }, onDelete);
        }}
        disabled={deleteBusy}
        aria-busy={deleteBusy}
        aria-label={deleteBusy ? `Deleting sprint ${sprint.name}` : `Delete sprint ${sprint.name}`}
        title={deleteBusy ? "Delete action in progress" : undefined}
        className={deleteBusy ? `${handleDeleteClassName} disabled:cursor-not-allowed disabled:opacity-40` : handleDeleteClassName}
      >
        {deleteBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
        ) : (
          <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
        )}
        {deleteBusy ? "Deleting..." : "Delete"}
      </button>
    </>
  );
};
