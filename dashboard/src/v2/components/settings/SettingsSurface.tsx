import type { ComponentChildren, FunctionComponent } from "preact";
import { RefreshCw, CheckCircle, AlertTriangle, XCircle, Loader2 } from "lucide-preact";
import { SHARED_INTERACTION_CLASSES } from "../ui/Button.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";
import gsap from "gsap";
import { useLayoutEffect, useRef } from "preact/hooks";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapDurations } from "../../lib/motion/constants.js";

export const NoticePanel: FunctionComponent<{
  tone?: "neutral" | "warning" | "success" | "error" | "pending";
  title: string;
  children: ComponentChildren;
}> = ({ tone = "neutral", title, children }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const durations = useGsapDurations();

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const ctx = gsap.context(() => {
        gsap.fromTo(
          containerRef.current,
          { y: reducedMotion ? 0 : MODAL_MOTION.feedback.yStart, opacity: 0, scale: reducedMotion ? 1 : MODAL_MOTION.feedback.scaleStart },
          { y: MODAL_MOTION.feedback.yEnd, opacity: 1, scale: MODAL_MOTION.feedback.scaleEnd, duration: reducedMotion ? 0 : MODAL_MOTION.feedback.duration, ease: MODAL_MOTION.feedback.ease }
        );
    });
    return () => ctx.revert();
  }, [reducedMotion]);

  let toneClass = "border-black/[0.06] bg-black/[0.03] text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300";
  let Icon = null;

  if (tone === "warning") {
    toneClass = "bg-status-amber/10 text-status-amber border-status-amber/20";
    Icon = AlertTriangle;
  } else if (tone === "success") {
    toneClass = "bg-status-green/10 text-status-green border-status-green/20";
    Icon = CheckCircle;
  } else if (tone === "error") {
    toneClass = "bg-status-red/10 text-status-red border-status-red/20";
    Icon = XCircle;
  } else if (tone === "pending") {
    toneClass = "bg-signal-500/10 text-signal-700 border-signal-500/20 dark:text-signal-400";
    Icon = Loader2;
  }

  return (
    <div
      ref={containerRef}
      className={`rounded-[1.35rem] border px-5 py-4 ${toneClass}`}
      role={tone === "error" || tone === "warning" ? "alert" : "status"}
      aria-live={tone === "error" || tone === "warning" ? "assertive" : "polite"}
    >
      <div className="flex items-center gap-2">
        {Icon ? <Icon className={`h-4 w-4 shrink-0 ${tone === "pending" ? "animate-spin" : ""} motion-safe:animate-[icon-pop_0.18s_ease-out]`} /> : null}
        <div className="text-[11px] font-bold uppercase tracking-[0.16em]">{title}</div>
      </div>
      <div className="mt-2 text-sm font-medium leading-relaxed">{children}</div>
    </div>
  );
};

export const ActionButton: FunctionComponent<{
  label: string;
  onClick: () => void;
  tone?: "primary" | "secondary" | "danger" | "success" | "warning";
  busy?: boolean;
  disabled?: boolean;
}> = ({ label, onClick, tone = "secondary", busy = false, disabled = false }) => {
  let toneClass = "border border-black/[0.06] bg-white/72 text-slate-600 hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300 dark:hover:text-white";

  if (tone === "primary") {
    toneClass = "bg-slate-900 text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] hover:bg-slate-700 dark:bg-white dark:text-void-900 dark:hover:bg-slate-100";
  } else if (tone === "danger") {
    toneClass = "border border-status-red/30 bg-status-red/[0.06] text-status-red hover:bg-status-red/[0.12]";
  } else if (tone === "success") {
    toneClass = "bg-status-green text-white shadow-[0_4px_20px_rgba(0,171,132,0.3)]";
  } else if (tone === "warning") {
    toneClass = "bg-status-amber text-void-900 shadow-[0_4px_20px_rgba(245,158,11,0.3)] hover:bg-status-amber/80";
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        if (busy) {
          e?.preventDefault();
          return;
        }
        onClick();
      }}
      disabled={disabled}
      aria-disabled={disabled || busy}
      aria-busy={busy}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold relative overflow-hidden ${SHARED_INTERACTION_CLASSES} ${toneClass}`}
    >
      <div className={`flex items-center justify-center gap-2 transition-opacity duration-200 ${busy ? "opacity-0" : "opacity-100"}`}>
        {label}
      </div>
      {busy && (
        <div className="absolute inset-0 flex items-center justify-center">
          <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2.2} />
        </div>
      )}
    </button>
  );
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const SettingsHeader: FunctionComponent<{
  icon: FunctionComponent<any>;
  eyebrow: string;
  title: string;
  description: string;
  actions?: ComponentChildren;
}> = ({ icon: Icon, eyebrow, title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-5 border-b border-black/[0.05] px-7 py-6 dark:border-white/[0.04]">
    <div>
      <div className="flex items-center gap-2.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-signal-500">
        <Icon className="h-3.5 w-3.5" strokeWidth={2.3} />
        {eyebrow}
      </div>
      <h2 className="mt-3 font-display text-4xl font-black tracking-tight text-slate-900 dark:text-white">
        {title}
      </h2>
      <p className="mt-2 max-w-3xl text-sm font-medium leading-relaxed text-slate-500 dark:text-slate-400">
        {description}
      </p>
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

export const SettingsBody: FunctionComponent<{
  error?: string | null;
  message?: string | null;
  loading?: boolean;
  loadingLabel?: string;
  children: ComponentChildren;
}> = ({ error, message, loading, loadingLabel = "Loading\u2026", children }) => (
  <div className="px-7 py-6">
    {error ? (
      <div className="mb-5">
        <NoticePanel title="Error" tone="error">{error}</NoticePanel>
      </div>
    ) : null}

    {message ? (
      <div className="mb-5">
        <NoticePanel title="Success" tone="success">{message}</NoticePanel>
      </div>
    ) : null}

    {loading ? (
      <NoticePanel title="Loading" tone="pending">{loadingLabel}</NoticePanel>
    ) : (
      children
    )}
  </div>
);
