import type { FunctionComponent } from "preact";
import { AlarmClock, Bot, CheckCircle2, Clock3, Loader2 } from "lucide-preact";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages, type ChatTextMessageKey } from "../../../i18n/messages/chat.js";
import type { DashboardLocale } from "../../../i18n/locales.js";

type WakeupStatus = "pending" | "delivered" | "processed" | "failed";

const WAKEUP_STATUS: Record<WakeupStatus, { label: ChatTextMessageKey; icon: typeof Clock3; className: string }> = {
  pending: {
    label: "queuedContinuation",
    icon: Clock3,
    className: "border-status-amber/25 bg-status-amber/10 text-status-amber",
  },
  delivered: {
    label: "startingContinuation",
    icon: Loader2,
    className: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-400",
  },
  processed: {
    label: "continuationCompleted",
    icon: CheckCircle2,
    className: "border-signal-500/25 bg-signal-500/10 text-signal-700 dark:text-signal-400",
  },
  failed: {
    label: "continuationFailed",
    icon: Clock3,
    className: "border-status-red/25 bg-status-red/10 text-status-red",
  },
};

export function isAgentScheduledWakeup(metadata: Record<string, unknown> | null | undefined): boolean {
  return metadata?.source === "agent_scheduler" || metadata?.origin === "agent_scheduler";
}

export interface ScheduledWakeupWidgetProps {
  instruction: string;
  status: WakeupStatus;
  scheduledFor?: string | null;
  compact?: boolean;
}

function formatScheduledTime(value: string | null | undefined, locale: DashboardLocale): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

export const ScheduledWakeupWidget: FunctionComponent<ScheduledWakeupWidgetProps> = ({
  instruction,
  status,
  scheduledFor,
  compact = false,
}) => {
  const { locale, translate } = useDashboardI18n();
  const statusMeta = WAKEUP_STATUS[status];
  const StatusIcon = statusMeta.icon;
  const scheduledLabel = formatScheduledTime(scheduledFor, locale);

  return (
    <section
      aria-label={translate(chatMessages, "scheduledContinuation")}
      className={`overflow-hidden rounded-2xl border border-violet-500/25 bg-violet-500/[0.05] shadow-[0_8px_28px_rgba(124,58,237,0.08)] dark:bg-violet-400/[0.06] ${compact ? "p-3.5" : "p-4"}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300">
            <Bot className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300">{translate(chatMessages, "continuationTitle")}</p>
            <p className="mt-0.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300">{translate(chatMessages, "continuationNotice")}</p>
          </div>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.1em] ${statusMeta.className}`}>
          <StatusIcon className={`h-3 w-3 ${status === "delivered" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          {translate(chatMessages, statusMeta.label)}
        </span>
      </div>

      <div className="mt-3 rounded-xl border border-violet-500/15 bg-white/65 px-3.5 py-3 dark:bg-black/15">
        <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-slate-400 dark:text-slate-500">
          <AlarmClock className="h-3 w-3 text-violet-500" aria-hidden="true" />
          {translate(chatMessages, "nextStepInstruction")}
          {scheduledLabel && <span className="ml-auto normal-case tracking-normal">{translate(chatMessages, "scheduledAt", { time: scheduledLabel })}</span>}
        </div>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-slate-800 dark:text-slate-100">{instruction}</p>
      </div>
    </section>
  );
};
