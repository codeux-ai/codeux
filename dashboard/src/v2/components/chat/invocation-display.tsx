import type { ComponentChildren, FunctionComponent } from "preact";
import { Layers, ListChecks } from "lucide-preact";
import type { ExecutionInvocationRecord } from "../../types.js";

/** Human-friendly titles for the invocation purpose, falling back to a title-cased type. */
const PURPOSE_LABELS: Record<string, string> = {
  planning: "Planning",
  cli_task_coding: "Task Coding",
  cli_task_review: "Task Review",
  cli_qa: "QA Review",
  dashboard_reply: "Chat Reply",
  worker_dispatch: "Worker Dispatch",
};

export const formatInvocationPurpose = (type: string | null | undefined): string => {
  if (!type) return "No Invocation Selected";
  return PURPOSE_LABELS[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

/** Compact elapsed/total duration between two ISO timestamps (end defaults to now). */
export const formatInvocationDuration = (startIso: string | null, endIso: string | null): string | null => {
  if (!startIso) return null;
  const start = Date.parse(startIso);
  const end = endIso ? Date.parse(endIso) : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const totalSeconds = Math.round((end - start) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  return remMinutes ? `${hours}h ${remMinutes}m` : `${hours}h`;
};

export interface InvocationLinks {
  sprintKey: string | null;
  sprintHref: string | null;
  taskHref: string | null;
}

/** Derives the sprint key + deep links for an invocation's sprint/task pages. */
export const buildInvocationLinks = (
  invocation: Pick<ExecutionInvocationRecord, "sprintId" | "sprintNumber" | "taskId">,
  sprintKeyPrefix: string,
): InvocationLinks => {
  const sprintKey = invocation.sprintNumber != null ? `${sprintKeyPrefix}-${invocation.sprintNumber}` : null;
  return {
    sprintKey,
    sprintHref: sprintKey ? `/sprints?sprintKey=${encodeURIComponent(sprintKey)}` : null,
    taskHref: invocation.taskId
      ? `/tasks?${invocation.sprintId ? `sprintId=${encodeURIComponent(invocation.sprintId)}&` : ""}taskId=${encodeURIComponent(invocation.taskId)}`
      : null,
  };
};

/** Small linked pill used for the sprint key / task number chips. */
export const ContextChip: FunctionComponent<{ href: string; title?: string; icon: ComponentChildren; label: string }> = ({ href, title, icon, label }) => (
  <a
    href={href}
    title={title}
    onClick={(event) => event.stopPropagation()}
    className="inline-flex items-center gap-1 rounded-md border border-black/[0.07] bg-black/[0.03] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-500 transition-colors hover:border-signal-500/40 hover:bg-signal-500/[0.08] hover:text-signal-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-signal-400"
  >
    {icon}
    {label}
  </a>
);

/** Renders the sprint-key + task-number chips (when present) for an invocation. */
export const InvocationContextChips: FunctionComponent<{
  invocation: Pick<ExecutionInvocationRecord, "sprintId" | "sprintNumber" | "sprintName" | "taskId" | "taskKey" | "taskTitle">;
  sprintKeyPrefix: string;
}> = ({ invocation, sprintKeyPrefix }) => {
  const { sprintKey, sprintHref, taskHref } = buildInvocationLinks(invocation, sprintKeyPrefix);
  if (!sprintHref && !taskHref) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {sprintHref && sprintKey && (
        <ContextChip
          href={sprintHref}
          title={invocation.sprintName || undefined}
          icon={<Layers className="h-2.5 w-2.5" />}
          label={sprintKey}
        />
      )}
      {taskHref && invocation.taskKey && (
        <ContextChip
          href={taskHref}
          title={invocation.taskTitle || undefined}
          icon={<ListChecks className="h-2.5 w-2.5" />}
          label={invocation.taskKey}
        />
      )}
    </div>
  );
};
