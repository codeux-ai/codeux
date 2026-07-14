import type { FunctionComponent } from "preact";
import { AlertTriangle, Loader2, Sparkles } from "lucide-preact";
import type { BaseAgentUpdateNotice as BaseAgentUpdateNoticeRecord } from "../../../../../src/contracts/agent-preset-types.js";

type BaseAgentUpdateNoticeProps = {
  notice: BaseAgentUpdateNoticeRecord;
  pending: boolean;
  disabled?: boolean;
  onUpdate: (notice: BaseAgentUpdateNoticeRecord) => void;
};

const ROLE_LABELS: Record<BaseAgentUpdateNoticeRecord["role"], string> = {
  planning_agent: "Planning agent",
  project_manager: "Project manager",
};

export const BaseAgentUpdateNotice: FunctionComponent<BaseAgentUpdateNoticeProps> = ({
  notice,
  pending,
  disabled = false,
  onUpdate,
}) => {
  const roleLabel = ROLE_LABELS[notice.role];
  const titleId = `base-agent-update-${notice.role}-title`;
  const reason = notice.reason === "alternate_route"
    ? `${notice.selectedAgentName} is assigned to the ${roleLabel} route and must be updated.`
    : `${notice.selectedAgentName} has customized ${roleLabel} instructions and must be updated.`;

  return (
    <section
      role="alert"
      aria-labelledby={titleId}
      className="rounded-[1.5rem] border border-amber-500/25 bg-amber-500/[0.08] px-5 py-5 text-amber-950 shadow-[0_10px_30px_rgba(245,158,11,0.08)] backdrop-blur-md dark:text-amber-100"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-4.5 w-4.5" aria-hidden="true" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-base font-semibold tracking-tight">
              {roleLabel} base update available
            </h2>
            <p className="mt-1 text-sm leading-relaxed text-amber-900/80 dark:text-amber-100/75">
              {reason}
            </p>
            <p className="mt-2 max-w-4xl text-[13px] leading-relaxed text-slate-600 dark:text-slate-300">
              Updating invokes an agent to compare both base files and apply only important system-compatibility
              instructions. Your main prompt, custom instructions, and behavior are preserved.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => onUpdate(notice)}
          disabled={disabled || pending}
          aria-label={`Update ${notice.selectedAgentName} with AI`}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-full bg-amber-500 px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.13em] text-amber-950 shadow-[0_8px_20px_rgba(245,158,11,0.2)] transition-all hover:bg-amber-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-60 dark:focus-visible:ring-offset-void-900 sm:w-auto"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" strokeWidth={2.3} />
          ) : (
            <Sparkles className="h-4 w-4" aria-hidden="true" strokeWidth={2.3} />
          )}
          {pending ? "Updating..." : "Update with AI"}
        </button>
      </div>
    </section>
  );
};
