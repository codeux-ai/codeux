import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useState } from "preact/hooks";
import {
  Eye,
  GitPullRequest,
  Maximize2,
  MoreHorizontal,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-preact";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { getSafeUrl } from "../../lib/safe-url.js";
import type {
  TaskCardActionDescriptor,
  TaskCardViewModel,
} from "../../lib/tasks/task-card-view-model.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";
import { DropdownMenu, DropdownMenuItem } from "../ui/DropdownMenu.js";

const actionIconByKind: Record<TaskCardActionDescriptor["kind"], typeof RotateCcw> = {
  rerun: RotateCcw,
  preview: Eye,
  pull_request: GitPullRequest,
  live_runtime: Maximize2,
};

const menuItemClassName = "kanban-card__menu-item flex w-full min-w-0 items-start gap-2.5 rounded-xl px-2.5 py-2 text-left text-xs font-semibold text-slate-600 outline-none dark:text-slate-300";

export const TaskCardActionMenu: FunctionComponent<{
  viewModel: TaskCardViewModel;
  onEdit: (task: TaskCardViewModel["task"]) => void;
  onDelete: (task: TaskCardViewModel["task"]) => void;
}> = memo(({ viewModel, onEdit, onDelete }) => {
  const { task } = viewModel;
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const confirm = useConfirmDialog();
  const actions = viewModel.actions ?? [];
  const editReasonId = `task-card-edit-reason-${task.recordId}`;
  const deleteReasonId = `task-card-delete-reason-${task.recordId}`;
  const optimisticEditReason = `Saving task ${task.id}; edit is temporarily unavailable.`;
  const optimisticDeleteReason = `Saving task ${task.id}; delete is temporarily unavailable.`;

  const restoreTriggerFocus = (): void => {
    confirm.triggerRef.current?.focus({ preventScroll: true });
  };

  const requestDelete = async (): Promise<void> => {
    setIsMenuOpen(false);
    const confirmed = await confirm.requestConfirm({
      title: "Delete Task",
      body: `Delete "${task.title}"? This removes the task card and cannot be undone.`,
      confirmLabel: "Delete Task",
      cancelLabel: "Cancel",
      destructive: true,
    });

    if (confirmed) {
      onDelete(task);
      return;
    }

    restoreTriggerFocus();
  };

  return (
    <>
      <DropdownMenu
        isOpen={isMenuOpen}
        onOpenChange={setIsMenuOpen}
        triggerRef={confirm.triggerRef}
        position="bottom"
        align="end"
        gap={6}
        menuAriaLabel={`Actions for task ${task.id}: ${task.title}`}
        className="kanban-card__action-menu min-w-[17rem] max-w-[calc(100vw-1rem)]"
        content={(
          <div className="flex min-w-0 flex-col gap-1">
            {actions.length > 0 && (
              <div role="group" aria-label="Execution and navigation actions" className="flex min-w-0 flex-col gap-0.5">
                <div role="presentation" className="kanban-card__menu-heading">Execution &amp; navigation</div>
                {actions.map((action) => {
                  const ActionIcon = actionIconByKind[action.kind];
                  const safeHref = action.href ? getSafeUrl(action.href) : undefined;
                  const disabledReason = task.isOptimistic
                    ? `Saving task ${task.id}; ${action.label} is temporarily unavailable.`
                    : action.disabledReason ?? (action.href && !safeHref
                      ? `The ${action.label} link is unavailable for task ${task.id}.`
                      : undefined);
                  const reasonId = `task-card-action-reason-${task.recordId}-${action.kind}`;

                  if (safeHref && !disabledReason) {
                    return (
                      <a
                        key={action.kind}
                        role="menuitem"
                        data-dropdown-item="true"
                        href={safeHref}
                        target={action.external ? "_blank" : undefined}
                        rel={action.external ? "noopener noreferrer" : undefined}
                        className={menuItemClassName}
                        title={`${action.title} Task ${task.id}.`}
                        aria-label={action.ariaLabel}
                        draggable={false}
                        onDragStart={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          setIsMenuOpen(false);
                        }}
                      >
                        <ActionIcon aria-hidden="true" className="kanban-card__menu-icon" />
                        <span className="min-w-0 flex-1 break-words">{action.label}</span>
                      </a>
                    );
                  }

                  return (
                    <DropdownMenuItem
                      key={action.kind}
                      aria-disabled="true"
                      aria-busy={task.isOptimistic ? "true" : undefined}
                      aria-describedby={reasonId}
                      aria-label={action.ariaLabel}
                      title={`${action.title} ${disabledReason ?? "Unavailable"}`.trim()}
                      className={menuItemClassName}
                    >
                      <ActionIcon aria-hidden="true" className="kanban-card__menu-icon" />
                      <span className="min-w-0 flex-1">
                        <span className="block break-words">{action.label}</span>
                        <span id={reasonId} className="kanban-card__menu-reason">{disabledReason ?? "Unavailable"}</span>
                      </span>
                    </DropdownMenuItem>
                  );
                })}
              </div>
            )}

            <div role="separator" className="kanban-card__menu-separator" />

            <div role="group" aria-label="Task management actions" className="flex min-w-0 flex-col gap-0.5">
              <div role="presentation" className="kanban-card__menu-heading">Task management</div>
              <DropdownMenuItem
                aria-disabled={task.isOptimistic ? "true" : undefined}
                aria-busy={task.isOptimistic ? "true" : undefined}
                aria-describedby={task.isOptimistic ? editReasonId : undefined}
                aria-label={`Edit task ${task.id}: ${task.title}`}
                title={task.isOptimistic ? `Edit unavailable while task ${task.id} is saving` : `Edit task ${task.id}`}
                className={menuItemClassName}
                onClick={() => {
                  setIsMenuOpen(false);
                  onEdit(task);
                }}
              >
                <Settings aria-hidden="true" className="kanban-card__menu-icon" />
                <span className="min-w-0 flex-1">
                  <span className="block">Edit</span>
                  {task.isOptimistic && <span id={editReasonId} className="kanban-card__menu-reason">{optimisticEditReason}</span>}
                </span>
              </DropdownMenuItem>
            </div>

            <div role="separator" className="kanban-card__menu-separator" />

            <div role="group" aria-label="Destructive task actions" className="flex min-w-0 flex-col gap-0.5">
              <div role="presentation" className="kanban-card__menu-heading">Danger zone</div>
              <DropdownMenuItem
                aria-disabled={task.isOptimistic ? "true" : undefined}
                aria-busy={task.isOptimistic ? "true" : undefined}
                aria-describedby={task.isOptimistic ? deleteReasonId : undefined}
                aria-label={`Delete task ${task.id}: ${task.title}`}
                title={task.isOptimistic ? `Delete unavailable while task ${task.id} is saving` : `Delete task ${task.id}`}
                className={`${menuItemClassName} kanban-card__menu-item--destructive`}
                onClick={() => {
                  void requestDelete();
                }}
              >
                <Trash2 aria-hidden="true" className="kanban-card__menu-icon" />
                <span className="min-w-0 flex-1">
                  <span className="block">Delete</span>
                  {task.isOptimistic && <span id={deleteReasonId} className="kanban-card__menu-reason">{optimisticDeleteReason}</span>}
                </span>
              </DropdownMenuItem>
            </div>
          </div>
        )}
      >
        <button
          ref={(node) => {
            confirm.triggerRef.current = node;
          }}
          type="button"
          className="kanban-card__action-trigger"
          aria-label={`Open task actions for task ${task.id}: ${task.title}`}
          title={`Open task actions for task ${task.id}`}
          aria-busy={task.isOptimistic ? "true" : undefined}
          draggable={false}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onDragStart={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
          <span>Actions</span>
        </button>
      </DropdownMenu>

      <ConfirmDialog
        isOpen={confirm.isOpen}
        options={confirm.options}
        onConfirm={confirm.handleConfirm}
        onCancel={confirm.handleCancel}
        restoreFocus={false}
      />
    </>
  );
});
