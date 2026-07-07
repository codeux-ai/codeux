import { type FunctionComponent } from "preact";
import { CheckCircle2, Circle, Loader2, Sparkles, XCircle } from "lucide-preact";
import { ChatWidgetFrame } from "./ChatWidgetFrame.js";
import { ChatRuntimeBadge } from "../ChatRuntimeBadge.js";
import type {
  AppCreationProgressStageState,
  AppCreationProgressWidgetState,
} from "../../../lib/chat-widget-view-models.js";

export interface AppCreationProgressWidgetProps {
  progress: AppCreationProgressWidgetState;
}

const stageTone: Record<AppCreationProgressStageState["status"], string> = {
  pending: "border-slate-300/60 bg-slate-200/45 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400",
  running: "border-signal-500/30 bg-signal-500/10 text-signal-700 dark:text-signal-300",
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  failed: "border-status-red/30 bg-status-red/10 text-status-red",
};

const StageIcon: FunctionComponent<{ stage: AppCreationProgressStageState }> = ({ stage }) => {
  if (stage.isCompleted) {
    return <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (stage.isFailed) {
    return <XCircle className="h-3.5 w-3.5" aria-hidden="true" />;
  }
  if (stage.isActive) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />;
  }
  return <Circle className="h-3.5 w-3.5" aria-hidden="true" />;
};

export const AppCreationProgressWidget: FunctionComponent<AppCreationProgressWidgetProps> = ({ progress }) => (
  <ChatWidgetFrame
    status={progress.status}
    header={
      <div class="flex min-w-0 items-center gap-2">
        <ChatRuntimeBadge status={progress.status} label={`${progress.appKindLabel} sprint`} />
        <span class="truncate">{progress.appKindLabel} sprint</span>
      </div>
    }
  >
    <div class="min-w-0 space-y-4">
      <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div class="min-w-0">
          <div class="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-signal-600 dark:text-signal-400">
            <Sparkles className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>{progress.statusLabel}</span>
          </div>
          <div class="mt-1 truncate text-[15px] font-semibold text-slate-900 dark:text-white">
            {progress.sprintLabel}
          </div>
        </div>
        <span class="w-fit shrink-0 rounded-lg border border-black/[0.06] bg-white/70 px-2.5 py-1 font-mono text-[11px] font-bold uppercase text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200">
          {progress.status}
        </span>
      </div>

      <div class="grid gap-1.5 sm:grid-cols-2">
        {progress.stackSummary.fields.length > 0 ? progress.stackSummary.fields.map((field) => (
          <div
            key={field.key}
            class="min-w-0 rounded-lg border border-black/[0.05] bg-white/60 px-2.5 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]"
          >
            <div class="text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400">{field.label}</div>
            <div class="mt-0.5 truncate text-[12px] font-semibold text-slate-800 dark:text-slate-200">{field.value}</div>
          </div>
        )) : (
          <div class="rounded-lg border border-dashed border-black/[0.08] px-2.5 py-2 text-[12px] font-medium text-slate-500 dark:border-white/[0.08] dark:text-slate-400 sm:col-span-2">
            {progress.stackSummary.emptyLabel}
          </div>
        )}
      </div>

      <ol class="space-y-1.5" aria-label={`${progress.appKindLabel} sprint stages`}>
        {progress.stages.map((stage, index) => (
          <li
            key={`${stage.id}-${index}`}
            class={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-2 ${stageTone[stage.status]} ${stage.isActive ? "motion-safe:animate-pulse" : ""}`}
            aria-current={stage.isActive ? "step" : undefined}
          >
            <StageIcon stage={stage} />
            <div class="min-w-0 flex-1">
              <div class="truncate text-[12px] font-semibold">{stage.label}</div>
              <div class="text-[10px] font-medium opacity-80">{stage.statusLabel}</div>
            </div>
          </li>
        ))}
      </ol>

      {progress.suggestionTags.length > 0 && (
        <div class="flex flex-wrap items-center gap-1.5" aria-label="Suggested follow-up directions">
          {progress.suggestionTags.map((tag) => (
            <span
              key={tag}
              class="max-w-full rounded-full border border-signal-500/20 bg-signal-500/[0.08] px-2 py-1 text-[11px] font-semibold text-signal-700 dark:text-signal-300"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  </ChatWidgetFrame>
);
