import type { FunctionComponent } from "preact";
import { useId, useRef, useState } from "preact/hooks";
import { CheckCircle2, ChevronDown, Clock3, Loader2, XCircle } from "lucide-preact";
import type { LucideIcon } from "lucide-preact";
import type {
  CiStatusPresentation,
  CiWorkflowState,
} from "../../lib/ci-status-presentation.js";
import { localizeCiStatusPresentation } from "../../lib/ci-status-presentation.js";
import { useOptionalDashboardI18n } from "../../i18n/context.js";
import { shellMessages } from "../../i18n/messages/shell.js";

export interface CiStatusBadgeProps {
  presentation: CiStatusPresentation | null;
  compact?: boolean;
  className?: string;
}

const STATE_PRESENTATION = {
  pending: {
    icon: Clock3,
    messageKey: "ciPending",
    tone: "border-slate-300/70 bg-slate-100/80 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300",
  },
  in_progress: {
    icon: Loader2,
    messageKey: "ciInProgress",
    tone: "border-signal-500/25 bg-signal-500/10 text-signal-600 dark:text-signal-400",
  },
  successful: {
    icon: CheckCircle2,
    messageKey: "ciSuccessful",
    tone: "border-status-green/25 bg-status-green/10 text-status-green",
  },
  failed: {
    icon: XCircle,
    messageKey: "ciFailed",
    tone: "border-status-red/30 bg-status-red/10 text-status-red shadow-[0_8px_22px_rgba(227,0,15,0.10)]",
  },
} satisfies Record<CiWorkflowState, {
  icon: LucideIcon;
  messageKey: "ciPending" | "ciInProgress" | "ciSuccessful" | "ciFailed";
  tone: string;
}>;

export const CiStatusBadge: FunctionComponent<CiStatusBadgeProps> = ({
  presentation,
  compact = false,
  className = "",
}) => {
  const { locale, translate } = useOptionalDashboardI18n();
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);

  if (!presentation) return null;

  const localizedPresentation = localizeCiStatusPresentation(presentation, locale);
  const meta = STATE_PRESENTATION[localizedPresentation.state];
  const StatusIcon = meta.icon;
  const toggleDetails = (): void => setOpen((current) => !current);
  const closeDetails = (): void => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  return (
    <span className={`relative inline-flex max-w-full flex-col items-start ${className}`} data-ci-state={localizedPresentation.state}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={detailsId}
        aria-label={translate(shellMessages, "ciStatusDetails", { label: localizedPresentation.accessibleLabel, action: translate(shellMessages, open ? "hideWorkflow" : "showWorkflow") })}
        onClick={toggleDetails}
        onKeyDown={(event) => {
          if (event.key === "Escape" && open) {
            event.preventDefault();
            closeDetails();
          }
        }}
        className={`inline-flex max-w-full items-center rounded-full border font-bold uppercase tracking-[0.12em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-void-800 ${meta.tone} ${
          compact
            ? "gap-1 px-2 py-1 text-[9px] sm:text-[10px]"
            : "gap-1.5 px-2.5 py-1 text-[10px] sm:px-3 sm:py-1.5 sm:text-xs"
        }`}
      >
        <StatusIcon
          aria-hidden={true}
          data-ci-icon={localizedPresentation.state === "failed" ? "failure" : localizedPresentation.state}
          className={`${compact ? "h-3 w-3" : "h-3.5 w-3.5 sm:h-4 sm:w-4"} shrink-0 ${
            localizedPresentation.state === "in_progress"
              ? "motion-safe:animate-spin motion-reduce:animate-none motion-reduce:ring-1 motion-reduce:ring-signal-500/30"
              : ""
          } ${localizedPresentation.state === "failed" ? "text-status-red" : ""}`}
          strokeWidth={2.2}
        />
        <span className="min-w-0 truncate">{localizedPresentation.label}</span>
        <ChevronDown
          aria-hidden={true}
          className={`h-3 w-3 shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
          strokeWidth={2.2}
        />
      </button>

      {open && (
        <span
          id={detailsId}
          role="region"
          aria-label={translate(shellMessages, "ciWorkflowDetails")}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              closeDetails();
            }
          }}
          className="absolute left-0 top-full z-50 mt-2 block w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-3 shadow-[var(--elevation-floating)] backdrop-blur-xl"
        >
          <span className="mb-2 block text-[9px] font-bold uppercase tracking-[0.16em] text-slate-400">
            {translate(shellMessages, "ciWorkflowDetailsTitle")}
          </span>
          <span className="grid gap-1.5">
            {localizedPresentation.steps.map((step) => {
              const stepMeta = STATE_PRESENTATION[step.state];
              const StepIcon = stepMeta.icon;
              return (
                <span
                  key={step.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-black/[0.025] px-2.5 py-2 dark:bg-white/[0.035]"
                  data-ci-step={step.id}
                  data-ci-step-state={step.state}
                >
                  <StepIcon
                    aria-hidden={true}
                    className={`h-3.5 w-3.5 shrink-0 ${step.state === "in_progress" ? "motion-safe:animate-spin motion-reduce:animate-none" : ""} ${
                      step.state === "failed" ? "text-status-red" : step.state === "successful" ? "text-status-green" : step.state === "in_progress" ? "text-signal-500" : "text-slate-400"
                    }`}
                    strokeWidth={2.1}
                  />
                  <span className="min-w-0 text-left text-xs font-semibold text-slate-700 dark:text-slate-200">{step.label}</span>
                  <span className={`text-right text-[10px] font-medium ${step.state === "failed" ? "text-status-red" : "text-slate-500 dark:text-slate-400"}`}>
                    {step.statusLabel}
                    <span className="sr-only"> ({translate(shellMessages, stepMeta.messageKey)})</span>
                  </span>
                </span>
              );
            })}
          </span>
        </span>
      )}
    </span>
  );
};
