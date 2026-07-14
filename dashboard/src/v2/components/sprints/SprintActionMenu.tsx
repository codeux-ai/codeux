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
  RotateCcw,
  Sparkles,
  Square,
  XCircle,
} from "lucide-preact";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import type { Sprint } from "../../types.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { useDashboardI18n } from "../../i18n/index.js";
import { sprintsMessages } from "../../i18n/messages/sprints.js";

export interface SprintActionMenuProps {
  sprint: Sprint;
  isCompleted?: boolean;
  showcaseBusy?: boolean;
  markCompletedDisabled?: boolean;
  markQaPassedDisabled?: boolean;
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
  onMarkQaPassed?: () => void;
  onRollback?: () => void;
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
  markQaPassedDisabled = false,
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
  onMarkQaPassed,
  onRollback,
  onDelete,
  onClose,
  markCompletedIcon = "circle",
  role,
  buttonClassName = "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs font-medium leading-snug text-slate-600 no-underline decoration-transparent transition-colors hover:bg-black/[0.04] hover:text-slate-900 hover:no-underline focus:no-underline dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 [&>span]:min-w-0 [&>span]:break-words",
}) => {
  const { translate } = useDashboardI18n();
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
  const reviewOutcome = sprint.latestReview?.outcome?.toLowerCase();
  const isQaPassed = (sprint.latestReview?.status === "completed" || sprint.latestReview?.status === "reviewed")
    && (reviewOutcome === "pass" || reviewOutcome === "passed" || reviewOutcome === "approved");

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
                    title: translate(sprintsMessages, "stopSprint"),
                    body: translate(sprintsMessages, "stopSprintBody", { name: sprint.name }),
                    confirmLabel: translate(sprintsMessages, "stopSprint"),
                    destructive: true,
                  }, onPrimaryAction);
                  return;
                }
                onClose?.();
                onPrimaryAction();
              }}
              disabled={primaryBusy}
              title={primaryBusy ? translate(sprintsMessages, "sprintActionProgress") : undefined}
              aria-busy={primaryBusy}
              aria-disabled={primaryBusy}
              className={disabledClassName}
            >
              {primaryBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
              ) : isRunning ? (
                <Square className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              ) : (
                <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              )}
              {translate(sprintsMessages, isRunning ? "stopSprint" : "startSprint")}
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
                  title: translate(sprintsMessages, "pauseSprint"),
                  body: translate(sprintsMessages, "pauseSprintBody", { name: sprint.name }),
                  confirmLabel: translate(sprintsMessages, "pause"),
                  tone: "warning",
                }, onPauseResume);
              }}
              disabled={pauseResumeBusy}
              title={pauseResumeBusy ? translate(sprintsMessages, "sprintPauseResumeProgress") : undefined}
              aria-busy={pauseResumeBusy}
              aria-disabled={pauseResumeBusy}
              className={disabledClassName}
            >
              {pauseResumeBusy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
              ) : isPaused ? (
                <Play className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              ) : (
                <Pause className="h-3.5 w-3.5" fill="currentColor" strokeWidth={2.1} />
              )}
              {translate(sprintsMessages, isPaused ? "resume" : "pause")}
            </button>
          )}
          {viewTasksHref && (
            <a
              href={viewTasksHref}
              role={role}
              onClick={() => onClose?.()}
              aria-label={translate(sprintsMessages, "viewTasksFor", { name: sprint.name })}
              className={buttonClassName}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2.1} />
              {translate(sprintsMessages, "viewTasks")}
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
              {translate(sprintsMessages, "addTasks")}
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
        aria-label={translate(sprintsMessages, "editSprint", { name: sprint.name })}
        className={buttonClassName}
      >
        <Pencil className="h-3.5 w-3.5" strokeWidth={2.1} />
        {translate(sprintsMessages, "edit")}
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onExport?.();
        }}
        aria-label={translate(sprintsMessages, "exportSprint", { name: sprint.name })}
        className={buttonClassName}
      >
        <Download className="h-3.5 w-3.5" strokeWidth={2.1} />
        {translate(sprintsMessages, "export")}
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onOverrides?.();
        }}
        aria-label={translate(sprintsMessages, "configureOverrides", { name: sprint.name })}
        className={buttonClassName}
      >
        <Sparkles className="h-3.5 w-3.5" strokeWidth={2.1} />
        {translate(sprintsMessages, "overrides")}
      </button>
      <button
        type="button"
        role={role}
        onClick={() => {
          onClose?.();
          onToggleShowcase?.();
        }}
        disabled={showcaseBusy}
        title={showcaseBusy ? translate(sprintsMessages, "showcaseUpdateProgress") : undefined}
        aria-busy={showcaseBusy}
        aria-disabled={showcaseBusy}
        className={disabledClassName}
      >
        {showcaseBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
        ) : (
          <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
        )}
        {translate(sprintsMessages, showcaseBusy ? "updating" : sprint.showcasePinned ? "remove" : "add")}
      </button>

      <SectionSeparator />

      {!isCompleted && onMarkCompleted && (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onMarkCompleted?.();
          }}
          disabled={markCompletedDisabled}
          title={markCompletedDisabled ? translate(sprintsMessages, "markCompleteDisabled") : undefined}
          aria-label={translate(sprintsMessages, "markCompletedAria", { name: sprint.name })}
          aria-disabled={markCompletedDisabled}
          className={disabledClassName}
        >
          {markCompletedIcon === "square" ? (
            <CheckSquare className="h-3.5 w-3.5" strokeWidth={2.1} />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.1} />
          )}
          {translate(sprintsMessages, "markCompleted")}
        </button>
      )}
      {onMarkQaPassed && !isQaPassed && (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onMarkQaPassed();
          }}
          disabled={markQaPassedDisabled}
          title={markQaPassedDisabled ? translate(sprintsMessages, "markQaDisabled") : undefined}
          aria-label={translate(sprintsMessages, "markQaPassAria", { name: sprint.name })}
          aria-disabled={markQaPassedDisabled}
          className={disabledClassName}
        >
          <CheckCircle2 className="h-3.5 w-3.5 text-signal-600 dark:text-signal-300" strokeWidth={2.1} />
          {translate(sprintsMessages, "markQaPass")}
        </button>
      )}
      {isCompleted && sprint.kind !== "rollback" && onRollback && (
        <button
          type="button"
          role={role}
          onClick={() => {
            onClose?.();
            onRollback();
          }}
          className={`${buttonClassName} text-orange-600 hover:bg-orange-500/10 dark:text-orange-300`}
        >
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.1} />
          {translate(sprintsMessages, "rollbackSprint")}
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
        aria-busy={deleteBusy}
        aria-disabled={deleteBusy}
        aria-label={translate(sprintsMessages, deleteBusy ? "deletingSprint" : "deleteSprintNamed", { name: sprint.name })}
        title={deleteBusy ? translate(sprintsMessages, "deleteProgress") : undefined}
        className={deleteBusy ? `${handleDeleteClassName} disabled:cursor-not-allowed disabled:opacity-40` : handleDeleteClassName}
      >
        {deleteBusy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.1} />
        ) : (
          <XCircle className="h-3.5 w-3.5" strokeWidth={2.1} />
        )}
        {translate(sprintsMessages, deleteBusy ? "deleting" : "delete")}
      </button>
    </>
  );
};
