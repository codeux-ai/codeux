import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import {
  AlertTriangle,
  CheckSquare,
  Heart,
  Maximize2,
  MoreVertical,
  Play,
  Square,
} from "lucide-preact";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import type { Sprint, SprintStatus } from "../../types.js";
import type { ExecutionHumanInterventionSummary } from "../../../../../src/contracts/app-types.js";
import { formatSprintKey, STATUS_LABELS } from "../../lib/sprint-ledger-state.js";

// Polished badge tones: increased contrast for backgrounds and borders where appropriate
const STATUS_BADGE_TONES: Record<SprintStatus, string> = {
  running: "border-status-green/30 bg-status-green/15 text-status-green",
  paused: "border-ember-500/30 bg-ember-500/15 text-ember-500",
  completed: "border-black/[0.1] bg-black/[0.06] text-slate-500 dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-slate-300",
  failed: "border-status-red/30 bg-status-red/15 text-status-red",
  cancelled: "border-slate-300/60 bg-slate-200/60 text-slate-500 dark:border-white/[0.1] dark:bg-white/[0.06] dark:text-slate-400",
  idle: "border-signal-500/30 bg-signal-500/15 text-signal-700 dark:text-signal-300",
};

const TABLE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});
const TABLE_META_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const shortenId = (value: string): string => value.slice(0, 8);
const formatTableDate = (value: string): string => TABLE_DATE_FORMATTER.format(new Date(value));
const formatMetaDate = (value: string): string => TABLE_META_DATE_FORMATTER.format(new Date(value));

export interface SprintLedgerRowProps {
  sprint: Sprint;
  isSelected: boolean;
  isEven: boolean;
  activeRun: { id: string; status: string } | undefined;
  humanIntervention: ExecutionHumanInterventionSummary | null;
  pendingActionIds: Set<string>;
  onToggleRow: (id: string) => void;
  onToggleShowcase: (sprint: Sprint) => void;
  onSprintToggle: (sprintId: string) => void;
  onOpenRowMenu: (event: MouseEvent, sprintId: string) => void;
}

const SprintLedgerRowComponent: FunctionComponent<SprintLedgerRowProps> = ({
  sprint,
  isSelected,
  isEven,
  activeRun,
  humanIntervention,
  pendingActionIds,
  onToggleRow,
  onToggleShowcase,
  onSprintToggle,
  onOpenRowMenu,
}) => {
  const pendingActionId = activeRun ? `sprint-stop:${activeRun.id}` : `sprint-start:${sprint.id}`;
  const pinActionId = `sprint-showcase:${sprint.id}`;
  const isCompleted = sprint.status === "completed";

  // Polished stripe depth
  const rowBg = isSelected
    ? "bg-signal-500/[0.06] dark:bg-signal-500/[0.08]"
    : isEven
      ? "bg-white/80 dark:bg-slate-900/40"
      : "bg-slate-50/80 dark:bg-slate-800/40";

  return (
    <tr
      className={`group border-b border-black/[0.04] transition-colors hover:bg-signal-500/[0.04] dark:border-white/[0.04] dark:hover:bg-signal-500/[0.06] ${rowBg} ${isCompleted ? "text-slate-500 dark:text-slate-400" : ""}`}
    >
      <td className="px-4 py-3 pl-6 align-top">
        <button
          type="button"
          onClick={() => onToggleRow(sprint.id)}
          className="inline-flex items-center justify-center text-slate-400 transition-colors hover:text-signal-500"
        >
          {isSelected
            ? <CheckSquare className="h-4 w-4 text-signal-500" strokeWidth={2.2} />
            : <Square className="h-4 w-4" strokeWidth={2.2} />}
        </button>
      </td>
      <td className="px-4 py-3 align-top">
        <button
          type="button"
          onClick={() => onToggleShowcase(sprint)}
          disabled={pendingActionIds.has(pinActionId)}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
            sprint.showcasePinned
              ? "border-status-red/20 bg-status-red/10 text-status-red"
              : "border-black/[0.06] bg-black/[0.03] text-slate-400 hover:text-status-red dark:border-white/[0.06] dark:bg-white/[0.03]"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <Heart className="h-3.5 w-3.5" fill={sprint.showcasePinned ? "currentColor" : "none"} strokeWidth={2.1} />
        </button>
      </td>
      <td className="px-4 py-3 min-w-[8rem] align-top">
        <div className="font-mono text-sm font-bold text-slate-700 dark:text-white truncate">{formatSprintKey(sprint)}</div>
        <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400 truncate">
          {shortenId(sprint.id)}
        </div>
      </td>
      <td className="px-4 py-3 min-w-0 max-w-full align-top">
        <div className={`font-display text-lg font-black tracking-tight break-words ${isCompleted ? "text-slate-700 dark:text-slate-300" : "text-slate-900 dark:text-white"}`}>{sprint.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-mono text-slate-400">
          <span>Updated {formatMetaDate(sprint.updatedAt)}</span>
          <span>·</span>
          <span>{formatTableDate(sprint.createdAt)}</span>
        </div>
        {humanIntervention && (
          <div className="mt-3">
            <HumanInterventionBadge summary={humanIntervention} label="Needs you" compact align="left" />
          </div>
        )}
        {sprint.goal ? (
          <p className={`mt-2 max-w-xl text-sm leading-relaxed ${isCompleted ? "text-slate-400 dark:text-slate-500" : "text-slate-500 dark:text-slate-400"}`}>
            {sprint.goal}
          </p>
        ) : null}
      </td>
      <td className="px-4 py-3 align-top">
        <div className="flex flex-col items-start gap-2">
          <span className={`inline-flex rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] ${STATUS_BADGE_TONES[sprint.status]}`}>
            {STATUS_LABELS[sprint.status]}
          </span>
          {humanIntervention && (
            <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-status-amber">
              <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2.2} />
              Intervention
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-mono text-lg font-bold text-slate-700 dark:text-white">{sprint.tasksCount}</div>
        <div className="text-[10px] uppercase tracking-[0.14em] text-slate-400">planned tasks</div>
      </td>
      <td className="px-4 py-3 min-w-[11rem] align-top">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-black/10 dark:bg-white/[0.08]">
            <div
              className="h-full rounded-full bg-signal-500 transition-[width]"
              style={{ width: `${sprint.completion}%` }}
            />
          </div>
          <span className="font-mono text-sm font-bold text-slate-700 dark:text-white">{sprint.completion}%</span>
        </div>
      </td>
      <td className="px-4 py-3 align-top">
        <div className="font-medium text-slate-700 dark:text-slate-200">{formatTableDate(sprint.createdAt)}</div>
        <div className="mt-1 text-[10px] uppercase tracking-[0.14em] text-slate-400">created</div>
      </td>
      <td className="px-4 py-3 pr-6 align-top">
        <div className="flex items-center justify-end gap-2 whitespace-nowrap">
          <button
            type="button"
            onClick={() => onSprintToggle(sprint.id)}
            disabled={pendingActionIds.has(pendingActionId)}
            className={`inline-flex h-10 min-w-[5.5rem] items-center justify-center gap-2 rounded-full border px-4 text-[10px] font-bold uppercase tracking-[0.12em] transition-colors ${
              activeRun
                ? "border-status-red/20 bg-status-red/[0.1] text-status-red hover:bg-status-red/[0.14]"
                : "border-signal-500/20 bg-signal-500/[0.08] text-signal-600 hover:bg-signal-500/[0.12] dark:text-signal-300"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {activeRun ? <Square className="h-3.5 w-3.5" fill="currentColor" /> : <Play className="h-3.5 w-3.5" fill="currentColor" />}
            {activeRun ? "Stop" : "Start"}
          </button>
          <a
            href={`/tasks?sprint=${encodeURIComponent(sprint.id)}`}
            className="inline-flex h-10 min-w-[4.8rem] items-center justify-center gap-2 rounded-full border border-black/[0.06] bg-white/80 px-4 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/50 focus-visible:outline-none"
          >
            Open
            <Maximize2 className="h-3.5 w-3.5" />
          </a>
          <button
            type="button"
            onClick={(event) => onOpenRowMenu(event, sprint.id)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-black/[0.06] bg-white/80 text-slate-600 transition-colors hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </div>
      </td>
    </tr>
  );
};

export const SprintLedgerRow = memo(SprintLedgerRowComponent);
