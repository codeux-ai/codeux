import type { FunctionComponent } from "preact";
import { X } from "lucide-preact";
import { useRef, useLayoutEffect, useEffect } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { ContainerShip, WoodenShip } from "./PlanningShip.js";
import { type PlanningActionType, type PlanningFeedback, PLANNING_ACTION_LABELS } from "../../lib/sprint-planning-feedback.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface PlanningProgressOverlayProps {
  isBusy: boolean;
  isDismissed?: boolean;
  feedback: PlanningFeedback | null;
  planningEta: number;
  elapsedMs: number;
  isDark: boolean;
  actionType: PlanningActionType | "quicksprint";
  themeAccent?: "signal" | "ember";
  onCancel?: () => void;
  onDismiss: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}

export const PlanningProgressOverlay: FunctionComponent<PlanningProgressOverlayProps> = ({
  isBusy,
  isDismissed = false,
  feedback,
  planningEta,
  elapsedMs,
  isDark,
  actionType,
  themeAccent = "signal",
  onCancel,
  onDismiss,
  secondaryActionLabel,
  onSecondaryAction,
}) => {
  const textContainerRef = useRef<HTMLDivElement>(null);
  const prevTextRef = useRef(feedback?.text);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!isBusy || isDismissed) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isBusy, isDismissed, onDismiss]);

  useLayoutEffect(() => {
    if (!feedback || !textContainerRef.current) return;
    if (prevTextRef.current !== feedback.text) {
      const ctx = gsap.context(() => {
        gsap.killTweensOf(textContainerRef.current);
        gsap.fromTo(
          textContainerRef.current,
          { opacity: 0, y: reducedMotion ? 0 : 10 },
          { opacity: 1, y: 0, duration: reducedMotion ? 0 : MODAL_MOTION.overlay.entry, ease: MODAL_MOTION.overlay.entryEase }
        );
      });
      prevTextRef.current = feedback.text;
      return () => ctx.revert();
    }
  }, [feedback?.text, reducedMotion]);
  if (!isBusy || isDismissed || !feedback) return null;

  const accentColors = {
    signal: {
      shipContainer: "#00E0A0",
      shipWooden: "#FFB800",
      badgeBorder: "border-signal-500/20",
      badgeBg: "bg-signal-500/[0.08]",
      badgeText: "text-signal-600 dark:text-signal-300",
      pingBg1: "bg-signal-400",
      pingBg2: "bg-signal-500",
    },
    ember: {
      shipContainer: "#FF6B00",
      shipWooden: "#FFB800",
      badgeBorder: "border-ember-500/20",
      badgeBg: "bg-ember-500/[0.08]",
      badgeText: "text-ember-600 dark:text-ember-400",
      pingBg1: "bg-ember-400",
      pingBg2: "bg-ember-500",
    },
  };

  const theme = accentColors[themeAccent];
  const shipVisual = reducedMotion
    ? {
        trackXPercent: 50,
        opacity: 1,
        visible: true,
        phase: "crossing" as const,
      }
    : feedback.shipVisual;
  const displayedProgress = Math.round(Math.min(0.99, Math.max(0, feedback.progress)) * 100);

  const getBadgeText = () => {
    if (actionType === "quicksprint") return "Quicksprint in motion";
    return PLANNING_ACTION_LABELS[actionType] || "Planning in motion";
  };

  const getCancelLabel = () => {
    if (actionType === "quicksprint") return "Cancel Quicksprint Request";
    return "Cancel Active Request";
  };

  const getDescriptionText = () => {
    switch (actionType) {
      case "improve":
        return "The Planning agent is researching your codebase to produce a more precise technical definition.";
      case "replan":
        return "The Planning agent is analyzing existing tasks and researching the codebase to generate an updated plan.";
      case "plan_only":
        return "The Planning agent is researching the codebase to decompose your sprint into grounded, atomic subtasks. Execution will wait for your review.";
      case "plan_and_start":
        return "The Planning agent is researching the codebase to decompose your sprint into grounded, atomic subtasks and will begin execution immediately.";
      case "draft":
        return "Saving your sprint definition without generating subtasks.";
      case "append_tasks":
        return "Adding new tasks to your existing sprint.";
      default:
        return "The Planning agent is researching the codebase to decompose your sprint into grounded, atomic subtasks.";
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex cursor-pointer items-center justify-center bg-void-900/50 backdrop-blur-sm p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
      role="dialog"
      aria-modal="true"
      aria-label={getBadgeText()}
    >
      <div className="flex flex-col items-center justify-center bg-white dark:bg-void-800 rounded-2xl shadow-2xl border border-black/[0.08] dark:border-white/[0.08] max-w-2xl w-full p-6 sm:p-8 relative cursor-default max-h-[calc(100dvh-2rem)] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-6 right-6 inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white z-10"
        aria-label="Minimize overlay"
      >
        <X className="h-4 w-4" />
      </button>

      <div
        className="relative mb-12 h-36 w-full max-w-md overflow-hidden rounded-[1.5rem] border border-black/[0.06] bg-[linear-gradient(180deg,rgba(248,250,252,0.9),rgba(226,232,240,0.68)_52%,rgba(203,213,225,0.55))] shadow-[inset_0_1px_0_rgba(255,255,255,0.75),0_18px_44px_rgba(15,23,42,0.08)] pointer-events-none dark:border-white/[0.08] dark:bg-[linear-gradient(180deg,rgba(24,20,17,0.92),rgba(15,29,51,0.72)_48%,rgba(8,16,28,0.82))] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_48px_rgba(0,0,0,0.3)]"
        role="progressbar"
        aria-live="polite"
        aria-valuenow={displayedProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={feedback.text}
        data-testid="planning-ship-course"
        data-reduced-motion={reducedMotion ? "true" : "false"}
      >
        <div className="absolute inset-x-0 top-0 h-1/2 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.9),transparent_18%),radial-gradient(circle_at_82%_8%,rgba(0,224,160,0.14),transparent_24%)] dark:bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.12),transparent_18%),radial-gradient(circle_at_82%_8%,rgba(0,224,160,0.18),transparent_24%)]" />
        <div className="absolute inset-x-5 bottom-10 h-12 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.78),rgba(125,211,252,0.2)_42%,transparent_72%)] blur-xl dark:bg-[radial-gradient(ellipse_at_center,rgba(128,255,214,0.16),rgba(59,130,246,0.12)_44%,transparent_72%)]" />
        <div className="absolute inset-x-8 bottom-[2.25rem] h-px bg-gradient-to-r from-transparent via-slate-500/28 to-transparent dark:via-white/18" />
        <div className="absolute left-7 bottom-5 h-12 w-10 rounded-t-[1rem] border border-black/[0.08] bg-white/65 shadow-[8px_10px_22px_rgba(15,23,42,0.08)] dark:border-white/[0.08] dark:bg-white/[0.06]" />
        <div className="absolute right-7 bottom-5 h-12 w-10 rounded-t-[1rem] border border-black/[0.08] bg-white/65 shadow-[-8px_10px_22px_rgba(15,23,42,0.08)] dark:border-white/[0.08] dark:bg-white/[0.06]" />
        <div className="absolute inset-x-12 bottom-[3.05rem] flex items-center justify-between" aria-hidden="true">
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400/55 shadow-[0_0_12px_rgba(100,116,139,0.35)] dark:bg-signal-300/45 dark:shadow-[0_0_14px_rgba(128,255,214,0.3)]" />
          <span className="h-1.5 w-1.5 rounded-full bg-slate-400/35 shadow-[0_0_12px_rgba(100,116,139,0.25)] dark:bg-white/25 dark:shadow-[0_0_14px_rgba(255,255,255,0.18)]" />
        </div>
        <svg
          aria-hidden="true"
          className="absolute inset-x-8 bottom-8 h-10 w-[calc(100%-4rem)] overflow-visible text-slate-300/70 dark:text-white/[0.12]"
          viewBox="0 0 360 42"
          preserveAspectRatio="none"
        >
          <path d="M2 26 C62 6 98 40 154 22 S250 8 358 23" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="2 10" />
          <path d="M8 34 C70 20 105 46 164 31 S258 18 350 32" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
        </svg>
        <div
          className="absolute inset-y-8 left-0 w-full transform-gpu transition-[transform,opacity,visibility] ease-linear motion-reduce:transition-none"
          data-testid="planning-ship-traveler"
          data-ship-phase={shipVisual.phase}
          data-ship-visible={shipVisual.visible ? "true" : "false"}
          style={{
            opacity: shipVisual.opacity,
            visibility: shipVisual.visible ? "visible" : "hidden",
            transform: `translate3d(${shipVisual.trackXPercent}%, 0, 0)`,
            transitionDuration: `${MODAL_MOTION.overlay.exit}s`,
          }}
        >
          <div className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <div className="absolute left-[-74px] top-[30px] h-3 w-24 rounded-full bg-gradient-to-l from-transparent via-white/55 to-transparent blur-[2px] motion-safe:animate-pulse motion-reduce:animate-none dark:via-signal-300/22" />
            <svg width="132" height="72" viewBox="-66 -38 132 72" className="drop-shadow-[0_12px_16px_rgba(15,23,42,0.18)] dark:drop-shadow-[0_14px_18px_rgba(0,0,0,0.45)]">
            {feedback.shipType === "container" ? (
              <ContainerShip accentColor={theme.shipContainer} isMoving={!reducedMotion} isDark={isDark} />
            ) : (
              <WoodenShip accentColor={theme.shipWooden} isMoving={!reducedMotion} isDark={isDark} />
            )}
            </svg>
          </div>
        </div>
      </div>

      <div className="cursor-default space-y-4 text-center">
        <div className={`inline-flex items-center gap-3 rounded-full border px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] ${theme.badgeBorder} ${theme.badgeBg} ${theme.badgeText}`}>
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full opacity-75 ${theme.pingBg1}`}></span>
            <span className={`relative inline-flex h-2 w-2 rounded-full ${theme.pingBg2}`}></span>
          </span>
          {getBadgeText()}
        </div>
        <div className="flex items-center justify-center gap-6">
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">ETA</div>
            <div className="font-mono text-xl font-medium tracking-tight text-slate-900 dark:text-white">
              {String(Math.floor(Math.max(0, planningEta - elapsedMs) / 60000)).padStart(2, "0")}:{String(Math.floor((Math.max(0, planningEta - elapsedMs) % 60000) / 1000)).padStart(2, "0")}
            </div>
          </div>
          <div className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Elapsed</div>
            <div className="font-mono text-xl font-medium tracking-tight text-slate-500">
              {String(Math.floor(elapsedMs / 60000)).padStart(2, "0")}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center overflow-hidden h-10 w-full">
          <div className="flex items-center gap-3" ref={textContainerRef}>
            <span className="relative flex h-3 w-3">
              <span className={`motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${theme.pingBg1}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${theme.pingBg2}`}></span>
            </span>
            <h3
              className="font-display text-xl font-semibold tracking-tight text-slate-900 dark:text-white"
              aria-live="polite"
            >
              {feedback.text}
            </h3>
          </div>
        </div>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {getDescriptionText()}
        </p>
        <p className="mx-auto max-w-sm text-xs leading-relaxed text-slate-400 dark:text-slate-500">
          You can minimize this panel and keep the request running, or cancel it from here.
        </p>
        <div className="mt-4 flex flex-row items-center justify-center gap-3">
          <button
            type="button"
            onClick={onDismiss}
            className="inline-flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/66 px-4 py-2 text-xs font-semibold text-slate-500 transition-colors hover:border-black/[0.15] hover:text-slate-900 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400 dark:hover:border-white/[0.15] dark:hover:text-white"
          >
            Minimize
          </button>
          {secondaryActionLabel && onSecondaryAction && (
            <button
              type="button"
              onClick={onSecondaryAction}
              className="inline-flex items-center gap-2 rounded-full border border-slate-900 bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 dark:border-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
            >
              {secondaryActionLabel}
            </button>
          )}
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-2 rounded-full border border-status-red/20 bg-status-red/[0.06] px-4 py-2 text-xs font-semibold text-status-red transition-colors hover:bg-status-red/[0.12] dark:border-status-red/20 dark:bg-status-red/[0.08] dark:text-status-red dark:hover:bg-status-red/[0.16]"
            >
              <X className="h-3.5 w-3.5" />
              {getCancelLabel()}
            </button>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};
