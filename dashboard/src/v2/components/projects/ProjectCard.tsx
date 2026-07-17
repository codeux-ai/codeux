import type { FunctionComponent, JSX } from "preact";
import { useMemo } from "preact/hooks";
import {
  Bot,
  Check,
  Clock3,
  ExternalLink,
  GitBranch,
  Link,
  Loader2,
  MapPin,
  Settings,
  Trash2,
} from "lucide-preact";
import type { Source, SourceStatus } from "../../types.js";
import type { ProjectCardDisplayValue } from "../../types.js";
import { buildProjectCardViewModel } from "../../lib/project-card-view-model.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { projectMessages } from "../../i18n/messages/projects.js";
import { StatusDot } from "../ui/StatusDot.js";

export interface ProjectCardProps {
  source: Source;
  isSelected: boolean;
  isSettingUp: boolean;
  setupInvocationId?: string | null;
  setupFeedback?: { tone: "success" | "error"; message: string };
  isDeleting?: boolean;
  deleteError?: string;
  onSelect: () => void;
  onDelete: () => void;
  onSetup: () => void;
  onRetrySetup?: () => void;
  onRetryDelete?: () => void;
  onOpenInvocation: () => void;
  onSettings: () => void;
}

const STATUS_MESSAGE_KEYS: Record<SourceStatus, "statusRunning" | "statusFailed" | "statusNeedsReview" | "statusIdle"> = {
  running: "statusRunning",
  failed: "statusFailed",
  intervention: "statusNeedsReview",
  idle: "statusIdle",
};

const STATUS_TEXT_CLASSES: Record<SourceStatus, string> = {
  running: "text-status-green",
  failed: "text-status-red",
  intervention: "text-ember-700 dark:text-ember-300",
  idle: "text-slate-500 dark:text-slate-400",
};

interface DetailRowProps {
  icon: JSX.Element;
  label: string;
  value: ProjectCardDisplayValue;
  fallback: string;
  mono?: boolean;
  testId?: string;
}

const DetailRow: FunctionComponent<DetailRowProps> = ({ icon, label, value, fallback, mono = false, testId }) => {
  const displayedValue = value.isEmpty ? fallback : value.value;

  return (
    <span className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-left">
      <span className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
        {icon}
        {label}
      </span>
      <span
        data-testid={testId}
        title={value.isEmpty ? undefined : value.value}
        className={`min-w-0 truncate text-right text-xs ${mono ? "font-mono" : "font-medium"} ${
          value.isEmpty ? "text-slate-400 dark:text-slate-500" : "text-slate-700 dark:text-slate-200"
        }`}
      >
        {displayedValue}
      </span>
    </span>
  );
};

interface ActionButtonProps {
  label: string;
  icon: JSX.Element;
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  danger?: boolean;
}

const ActionButton: FunctionComponent<ActionButtonProps> = ({
  label,
  icon,
  onClick,
  disabled = false,
  busy = false,
  danger = false,
}) => (
  <button
    type="button"
    aria-label={label}
    aria-busy={busy || undefined}
    title={label}
    disabled={disabled}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => {
      event.stopPropagation();
      if (disabled) return;
      onClick();
    }}
    className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 ${
      danger
        ? "border-status-red/20 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]"
        : "border-black/[0.08] bg-white/55 text-slate-500 hover:border-signal-500/30 hover:text-signal-700 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-signal-300"
    } disabled:cursor-not-allowed disabled:opacity-50`}
  >
    {busy ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : icon}
  </button>
);

export const ProjectCard: FunctionComponent<ProjectCardProps> = ({
  source,
  isSelected,
  isSettingUp,
  setupInvocationId,
  setupFeedback,
  isDeleting = false,
  deleteError,
  onSelect,
  onDelete,
  onSetup,
  onRetrySetup,
  onRetryDelete,
  onOpenInvocation,
  onSettings,
}) => {
  const { locale, formatNumber, translate } = useDashboardI18n();
  const viewModel = useMemo(() => buildProjectCardViewModel(source, locale), [locale, source]);
  const location = viewModel.gitUrl.isEmpty ? viewModel.localDirectory : viewModel.gitUrl;
  const locationLabel = translate(projectMessages, viewModel.gitUrl.isEmpty ? "path" : "repository");
  const lastRunStatus = viewModel.lastRunStatus.isEmpty
    ? translate(projectMessages, "noRunsYet")
    : viewModel.lastRunStatus.value;
  const completion = viewModel.taskCompletion.percentage ?? 0;
  const selectionLabel = translate(
    projectMessages,
    isSelected ? "selectedProject" : "selectProject",
    { name: source.name },
  );
  const statusLabel = translate(projectMessages, STATUS_MESSAGE_KEYS[source.status]);

  return (
    <article
      aria-label={translate(projectMessages, "projectArticle", { name: source.name })}
      data-selected={isSelected ? "true" : "false"}
      data-running={source.status === "running" ? "true" : "false"}
      data-pending={isSettingUp || isDeleting ? "true" : "false"}
      data-outcome={setupFeedback?.tone}
      className={`flex h-full min-h-[390px] min-w-0 flex-col overflow-hidden rounded-[1.5rem] border bg-white/70 p-5 shadow-sm backdrop-blur-xl dark:bg-void-800/65 ${
        isSelected
          ? "border-signal-500/55 ring-1 ring-signal-500/20"
          : source.status === "running"
            ? "border-status-green/35"
            : "border-black/[0.07] dark:border-white/[0.08]"
      }`}
    >
      <button
        type="button"
        data-project-focus-id={source.id}
        aria-pressed={isSelected}
        aria-label={selectionLabel}
        onClick={onSelect}
        className="group/select min-w-0 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800"
      >
        <span className="flex min-w-0 items-start justify-between gap-3">
          <span className="min-w-0 flex-1">
            <span
              title={source.name}
              data-testid="project-name"
              className="block truncate font-display text-lg font-semibold tracking-tight text-slate-900 dark:text-white"
            >
              {source.name}
            </span>
            <span className="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400" title={viewModel.sourceBadge.description}>
              {viewModel.sourceTypeLabel}
            </span>
          </span>
          {isSelected ? (
            <span
              role="status"
              aria-label={translate(projectMessages, "projectIsSelected", { name: source.name })}
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-signal-500/[0.12] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-signal-700 dark:text-signal-300"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {translate(projectMessages, "selected")}
            </span>
          ) : null}
        </span>

        <span className="mt-4 flex items-center justify-between gap-3 border-y border-black/[0.06] py-3 dark:border-white/[0.07]">
          <span className={`inline-flex items-center gap-2 text-xs font-semibold ${STATUS_TEXT_CLASSES[source.status]}`}>
            <span aria-hidden="true"><StatusDot status={source.status} /></span>
            <span aria-label={translate(projectMessages, "statusLabel", { status: statusLabel })}>{statusLabel}</span>
          </span>
          <span className="max-w-[50%] truncate rounded-full border border-black/[0.07] bg-black/[0.025] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300">
            {viewModel.sourceBadge.label}
          </span>
        </span>

        <span className="mt-4 flex min-w-0 flex-col gap-2.5">
          <DetailRow
            icon={viewModel.gitUrl.isEmpty ? <MapPin className="h-3 w-3" aria-hidden="true" /> : <Link className="h-3 w-3" aria-hidden="true" />}
            label={locationLabel}
            value={location}
            fallback={translate(projectMessages, "notSet")}
            mono
            testId="project-location"
          />
          <DetailRow icon={<GitBranch className="h-3 w-3" aria-hidden="true" />} label={translate(projectMessages, "branch")} value={viewModel.branch} fallback={translate(projectMessages, "notSet")} mono testId="project-branch" />
          <DetailRow icon={<Clock3 className="h-3 w-3" aria-hidden="true" />} label={translate(projectMessages, "lastRun")} value={viewModel.lastRunAt} fallback={translate(projectMessages, "noRunsYet")} testId="project-last-run" />
          <span className="block truncate text-right text-[11px] text-slate-400 dark:text-slate-500" title={lastRunStatus}>
            {lastRunStatus}
          </span>
        </span>
      </button>

      {isSettingUp ? (
        <button
          type="button"
          disabled={!setupInvocationId}
          aria-label={translate(projectMessages, setupInvocationId ? "openSetupInvocation" : "setupInvocationStarting")}
          aria-busy="true"
          onClick={(event) => {
            event.stopPropagation();
            if (setupInvocationId) onOpenInvocation();
          }}
          className="mt-4 flex min-w-0 items-center justify-between gap-2 rounded-xl border border-status-green/25 bg-status-green/[0.06] px-3 py-2 text-left text-status-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:cursor-wait"
        >
          <span className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold">
            <Loader2 className="h-3.5 w-3.5 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
            <span className="truncate">{translate(projectMessages, "projectSetupRunning")}</span>
          </span>
          {setupInvocationId ? <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : null}
        </button>
      ) : null}

      {!isSettingUp && setupFeedback ? (
        <div
          role={setupFeedback.tone === "error" ? "alert" : "status"}
          className={`mt-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
            setupFeedback.tone === "error"
              ? "border-status-red/25 bg-status-red/[0.07] text-status-red"
              : "border-status-green/25 bg-status-green/[0.07] text-status-green"
          }`}
        >
          <span className="min-w-0 flex-1 break-words">{setupFeedback.message}</span>
          <span className="inline-flex items-center gap-1">
            {setupInvocationId ? (
              <button
                type="button"
                onClick={onOpenInvocation}
                className="rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                {translate(projectMessages, "openInvocation")}
              </button>
            ) : null}
            {setupFeedback.tone === "error" && onRetrySetup ? (
              <button
                type="button"
                onClick={onRetrySetup}
                className="rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
              >
                {translate(projectMessages, "retry")}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}

      {deleteError ? (
        <div role="alert" className="mt-4 flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-status-red/25 bg-status-red/[0.07] px-3 py-2 text-xs font-semibold text-status-red">
          <span className="min-w-0 flex-1 break-words">{deleteError}</span>
          {onRetryDelete ? (
            <button
              type="button"
              onClick={onRetryDelete}
              disabled={isDeleting}
              className="rounded-lg px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
            >
              {translate(projectMessages, "retry")}
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        <div className="grid grid-cols-3 divide-x divide-black/[0.06] rounded-xl bg-black/[0.025] py-2 dark:divide-white/[0.07] dark:bg-white/[0.035]">
          <Stat label={translate(projectMessages, "sprints")} value={formatNumber(source.sprintsCount)} />
          <Stat label={translate(projectMessages, "open")} value={formatNumber(viewModel.taskCompletion.openTasks)} />
          <Stat label={translate(projectMessages, "done")} value={formatNumber(viewModel.taskCompletion.completedTasks)} />
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">
          <span>{translate(projectMessages, "completion")}</span>
          <span className="font-mono text-slate-600 dark:text-slate-300">{viewModel.taskCompletion.value}</span>
        </div>
        <div
          role="progressbar"
          aria-label={translate(projectMessages, "taskCompletion", { name: source.name })}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={completion}
          className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.08]"
        >
          <div className="h-full rounded-full bg-signal-500 motion-safe:transition-[width] motion-safe:duration-300" style={{ width: `${completion}%` }} />
        </div>

        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.07]">
          <button
            type="button"
            aria-pressed={isSelected}
            aria-label={isSelected
              ? translate(projectMessages, "projectIsSelected", { name: source.name })
              : translate(projectMessages, "selectNamedProject", { name: source.name })}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect();
            }}
            className={`min-h-10 min-w-0 flex-1 rounded-xl px-3 text-xs font-semibold motion-safe:transition-colors motion-safe:duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 ${
              isSelected
                ? "bg-signal-500 text-white hover:bg-signal-600"
                : "border border-black/[0.09] bg-white/55 text-slate-700 hover:border-signal-500/35 hover:text-signal-700 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-slate-200 dark:hover:text-signal-300"
            }`}
          >
            {translate(projectMessages, isSelected ? "selected" : "selectProjectAction")}
          </button>
          <ActionButton label={translate(projectMessages, isSettingUp ? "setupAlreadyRunning" : "setupProject")} icon={<Bot className="h-4 w-4" aria-hidden="true" />} onClick={onSetup} disabled={isSettingUp || isDeleting} busy={isSettingUp} />
          <ActionButton label={translate(projectMessages, "projectSettings")} icon={<Settings className="h-4 w-4" aria-hidden="true" />} onClick={onSettings} />
          <ActionButton label={translate(projectMessages, isDeleting ? "deletingProject" : "deleteProject")} icon={<Trash2 className="h-4 w-4" aria-hidden="true" />} onClick={onDelete} disabled={isDeleting} busy={isDeleting} danger />
        </div>
      </div>
    </article>
  );
};

const Stat: FunctionComponent<{ label: string; value: string }> = ({ label, value }) => (
  <span className="flex min-w-0 flex-col items-center gap-1">
    <span className="font-display text-base font-semibold tabular-nums text-slate-800 dark:text-slate-100">{value}</span>
    <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{label}</span>
  </span>
);
