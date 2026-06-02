import type { FunctionComponent } from "preact";
import { X } from "lucide-preact";
import { useRef, useLayoutEffect } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { ContainerShip, WoodenShip } from "./PlanningShip.js";
import { type PlanningActionType, PLANNING_ACTION_LABELS } from "../../lib/sprint-planning-feedback.js";
import { MODAL_MOTION } from "../../lib/motion/modal-motion.js";

interface PlanningProgressOverlayProps {
  isBusy: boolean;
  isDismissed?: boolean;
  feedback: { shipType: "container" | "wooden"; shipProgress: number; text: string } | null;
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

  const getBadgeText = () => {
    if (actionType === "quicksprint") return "Quicksprint in motion";
    return PLANNING_ACTION_LABELS[actionType] || "Planning in motion";
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
      default:
        return "The Planning agent is researching the codebase to decompose your sprint into grounded, atomic subtasks.";
    }
  };

  return (
    <div
      className="absolute inset-0 z-50 flex cursor-pointer flex-col items-center justify-center bg-white/80 p-8 backdrop-blur-xl dark:bg-void-900/80"
      onClick={(e) => {
        if (e.target === e.currentTarget) onDismiss();
      }}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-6 right-6 inline-flex h-10 w-10 items-center justify-center rounded-full border border-black/[0.06] bg-white/78 text-slate-400 transition-colors hover:text-slate-900 dark:border-white/[0.06] dark:bg-white/[0.03] dark:hover:text-white z-10"
        aria-label="Minimize overlay"
      >
        <X className="h-4 w-4" />
      </button>

      <div 
        className="relative mb-12 flex h-32 w-full max-w-md items-center justify-center overflow-hidden pointer-events-none"
        role="progressbar"
        aria-live="polite"
        aria-valuenow={Math.round(feedback.shipProgress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={feedback.text}
      >
        <div className="absolute inset-x-0 bottom-8 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent dark:via-white/10" />
        <div
          className="absolute transition-[left] duration-200 ease-linear"
          style={{ left: `${feedback.shipProgress * 100}%`, transform: "translateX(-50%)" }}
        >
          <svg width="120" height="60" viewBox="-60 -30 120 60">
            {feedback.shipType === "container" ? (
              <ContainerShip accentColor={theme.shipContainer} isMoving={true} isDark={isDark} />
            ) : (
              <WoodenShip accentColor={theme.shipWooden} isMoving={true} isDark={isDark} />
            )}
          </svg>
        </div>
      </div>

      <div className="cursor-default space-y-4 text-center">
        <div className={`inline-flex items-center gap-3 rounded-full border px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] ${theme.badgeBorder} ${theme.badgeBg} ${theme.badgeText}`}>
          <span className="relative flex h-2 w-2">
            <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${theme.pingBg1}`}></span>
            <span className={`relative inline-flex h-2 w-2 rounded-full ${theme.pingBg2}`}></span>
          </span>
          {getBadgeText()}
        </div>
        <div className="flex items-center justify-center gap-6">
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">ETA</div>
            <div className="font-mono text-xl font-medium tracking-tight text-slate-900 dark:text-white">
              {Math.floor(Math.max(0, planningEta - elapsedMs) / 60000)}:{String(Math.floor((Math.max(0, planningEta - elapsedMs) % 60000) / 1000)).padStart(2, "0")}
            </div>
          </div>
          <div className="h-8 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="flex flex-col items-center">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Elapsed</div>
            <div className="font-mono text-xl font-medium tracking-tight text-slate-500">
              {Math.floor(elapsedMs / 60000)}:{String(Math.floor((elapsedMs % 60000) / 1000)).padStart(2, "0")}
            </div>
          </div>
        </div>
        <div className="flex flex-col items-center overflow-hidden h-10 w-full">
          <div className="flex items-center gap-3" ref={textContainerRef}>
            <span className="relative flex h-3 w-3">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${theme.pingBg1}`}></span>
              <span className={`relative inline-flex rounded-full h-3 w-3 ${theme.pingBg2}`}></span>
            </span>
            <h3
              className="font-display text-2xl font-black tracking-tight text-slate-900 dark:text-white"
              aria-live="polite"
            >
              {feedback.text}
            </h3>
          </div>
        </div>
        <p className="mx-auto max-w-xs text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {getDescriptionText()}
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
              Cancel Active Request
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
