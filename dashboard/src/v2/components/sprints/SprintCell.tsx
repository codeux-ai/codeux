import type { FunctionComponent } from "preact";
import { useRef, useState, useEffect } from "preact/hooks";
import gsap from "gsap";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  Heart,
  Maximize2,
  MoreVertical,
  Pencil,
  Play,
  Sparkles,
  Square,
  XCircle,
} from "lucide-preact";
import type { ExecutionHumanInterventionSummary, Sprint, SprintStatus } from "../../types.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { HumanInterventionBadge } from "../ui/HumanInterventionBadge.js";
import { SprintReviewBadge } from "./SprintReviewBadge.js";
import { SprintActionMenu } from "./SprintActionMenu.js";
import { useProjectEffectiveSettings } from "../../hooks/use-project-effective-settings.js";
import { getSprintStatusPresentation } from "../../lib/sprint-status-presentation.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MOTION_TOKENS } from "../../lib/motion/tokens.js";

const CARD_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

const statusMap: Record<SprintStatus, {
  ring: string;
  text: string;
  icon: typeof Activity;
  label: string;
  accentHex: string;
}> = {
  running: { ring: "border-status-green/45 shadow-[0_0_34px_rgba(0,171,132,0.28)]", text: "text-status-green", icon: Activity, label: "Running", accentHex: "#00AB84" },
  paused: { ring: "border-status-amber/45 shadow-[0_0_34px_rgba(245,158,11,0.24)]", text: "text-status-amber", icon: Clock3, label: "Paused", accentHex: "#F59E0B" },
  completed: { ring: "border-slate-300/50 shadow-[0_0_24px_rgba(148,163,184,0.18)]", text: "text-slate-500 dark:text-slate-400", icon: CheckCircle2, label: "Completed", accentHex: "#94A3B8" },
  failed: { ring: "border-status-red/55 shadow-[0_0_34px_rgba(227,0,15,0.3)]", text: "text-status-red", icon: XCircle, label: "Failed", accentHex: "#E3000F" },
  cancelled: { ring: "border-slate-300/35 shadow-[0_0_24px_rgba(148,163,184,0.16)]", text: "text-slate-400 dark:text-slate-500", icon: XCircle, label: "Cancelled", accentHex: "#94A3B8" },
  idle: { ring: "", text: "text-signal-600 dark:text-signal-300", icon: Clock3, label: "Draft", accentHex: "#00E0A0" },
};

interface SprintCellProps {
  sprint: Sprint;
  isEven: boolean;
  accentColor: string;
  primaryBusy?: boolean;
  showcaseBusy?: boolean;
  humanIntervention?: ExecutionHumanInterventionSummary | null;
  onPrimaryAction?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onOverrides?: () => void;
  onToggleShowcase?: () => void;
  onMarkCompleted?: () => void;
}

const formatSprintKey = (sprint: Sprint, prefix: string = "SPR"): string => (
  sprint.number ? `${prefix}-${sprint.number}` : sprint.slug.toUpperCase()
);

const formatCardDate = (value: string): string => CARD_DATE_FORMATTER.format(new Date(value));

export const SprintCell: FunctionComponent<SprintCellProps> = ({
  sprint,
  isEven,
  accentColor,
  primaryBusy = false,
  showcaseBusy = false,
  humanIntervention = null,
  onPrimaryAction,
  onEdit,
  onDelete,
  onExport,
  onOverrides,
  onToggleShowcase,
  onMarkCompleted,
}) => {
  const settings = useProjectEffectiveSettings(sprint.projectId);
  const reducedMotion = useReducedMotion();
  const sprintKeyPrefix = settings.data?.settings?.git?.sprintKeyPrefix || "SPR";

  const bubbleRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
      }
    };

    if (menuOpen) {
      document.addEventListener("mousedown", handleOutsideClick);
      document.addEventListener("keydown", handleKeyDown);
    }

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (menuRef.current) {
        gsap.killTweensOf(menuRef.current);
    }
  }, [menuOpen]);
  const state = statusMap[sprint.status];
  const StatusIcon = state.icon;
  const isCompleted = sprint.status === "completed";
  const isRunning = sprint.status === "running";
  const statusPresentation = getSprintStatusPresentation({
    state: sprint.status,
    humanInterventionTitle: humanIntervention?.title ?? null,
    humanInterventionReason: humanIntervention?.reason ?? null,
    humanInterventionInstructions: humanIntervention?.instructions ?? null,
    humanInterventionOwnerType: humanIntervention?.ownerType ?? null,
  });
  const showInterventionBadge = Boolean(humanIntervention) && statusPresentation.showHumanInterventionBadge;
  const animationClass = isCompleted ? "" : isEven ? "animate-organic" : "animate-organic-reverse";
  const interventionPulseStyle = reducedMotion
    ? undefined
    : {
      animationDuration: `calc(${MOTION_TOKENS.timing.slow} * 12)`,
      animationTimingFunction: MOTION_TOKENS.easing.standard,
    };

  const handleHoverEnter = () => {
    if (!bubbleRef.current || isCompleted) {
      return;
    }
    gsap.to(bubbleRef.current, {
      scale: 1.05,
      rotation: (Math.random() - 0.5) * 4,
      duration: 0.8,
      ease: "elastic.out(1, 0.5)",
      overwrite: "auto",
    });
  };

  const handleHoverLeave = () => {
    if (!bubbleRef.current || isCompleted) {
      return;
    }
    gsap.to(bubbleRef.current, {
      scale: 1,
      rotation: 0,
      duration: 0.95,
      ease: "elastic.out(1, 0.5)",
      overwrite: "auto",
    });
  };

  return (
    <div
      ref={bubbleRef}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      className={`group relative flex h-72 w-72 shrink-0 cursor-pointer items-center justify-center perspective-1000 lg:h-80 lg:w-80`}
    >
      <div
        className={`pointer-events-none absolute inset-0 rounded-[1.75rem] shadow-[0_24px_48px_rgba(0,0,0,0.07)] transition-all duration-700 dark:shadow-[0_24px_48px_rgba(0,0,0,0.5)] ${animationClass} ${isCompleted ? "opacity-80" : ""}`}

      />

      <div
        className={`absolute inset-0 rounded-[1.75rem] overflow-hidden border border-white/70 backdrop-blur-md transition-all duration-700 transform-gpu dark:border-white/[0.06] ${animationClass} ${isCompleted ? "opacity-80" : ""} ${isRunning ? "bg-white/72 dark:bg-void-800/82" : "bg-white/55 dark:bg-void-800/65"}`}
        style={{

          WebkitMaskImage: "-webkit-radial-gradient(white, black)",
          backfaceVisibility: "hidden",
        }}
      >
        <div className={`absolute inset-0 pointer-events-none shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] ${animationClass}`} />
        <WaveFluid accentHex={state.accentHex} />
        <BorderTrace accentHex={state.accentHex} />
      </div>

      {state.ring && !isCompleted && (
        <div
          className={`absolute inset-0 pointer-events-none mix-blend-screen scale-[1.012] ${animationClass}`}
          style={{
            zIndex: 10,
          }}
        >
          {/* High-fidelity outer accent border */}
          <div
            className="absolute inset-0 rounded-[inherit] border border-status-green/50 dark:mix-blend-screen"
            style={{
              borderColor: `${state.accentHex}70`,
            }}
          />
          {/* Breathtaking ambient breathing glow */}
          <div
            className="absolute inset-0 rounded-[inherit] animate-[pulse_3.5s_ease-in-out_infinite]"
            style={{
              boxShadow: `0 0 20px ${state.accentHex}40, inset 0 0 10px ${state.accentHex}20`,
            }}
          />
        </div>
      )}

      {sprint.latestReview?.status === 'running' && (
        <div
          className={`absolute inset-0 pointer-events-none ${animationClass}`}
          style={{
            zIndex: 10,
          }}
        >
          <div
            className="absolute inset-0 rounded-[inherit] border-2 border-blue-400/55"
          />
        </div>
      )}

      {isCompleted && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Check className="h-40 w-40 text-slate-900/[0.06] dark:text-white/[0.05]" strokeWidth={1.2} />
        </div>
      )}

      <div className="relative z-20 flex h-full w-full flex-col items-center justify-center p-8 text-center">
        <div className={`absolute top-5 flex items-center gap-1.5 opacity-0 transition-opacity duration-300 group-hover:opacity-100 ${state.text}`}>
          <StatusIcon className={`h-3.5 w-3.5 ${isRunning ? "animate-pulse" : ""}`} strokeWidth={2.5} />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em]">{state.label}</span>
        </div>

        <div className={`absolute left-7 top-7 inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${accentColor}`}>
          <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.1} />
          {formatCardDate(sprint.createdAt)}
        </div>

{(showInterventionBadge || sprint.latestReview) && (
          <div className="absolute right-4 top-4 z-[60] flex items-center gap-2 lg:right-5 lg:top-5">
            {sprint.latestReview && (
              <SprintReviewBadge summary={sprint.latestReview} compact align="right" />
            )}
            {showInterventionBadge && humanIntervention && (
              <div className={reducedMotion ? "" : "animate-pulse"} style={interventionPulseStyle}>
                <HumanInterventionBadge summary={humanIntervention} label="Needs you" compact align="right" />
              </div>
            )}
          </div>
        )}

        <div className={`inline-flex items-center gap-1.5 rounded-full border border-black/[0.06] bg-black/[0.03] px-3 py-1.5 font-mono text-[11px] font-bold tracking-[0.14em] transition-transform duration-300 group-hover:-translate-y-3 dark:border-white/[0.06] dark:bg-white/[0.03] ${accentColor}`}>
          <Sparkles className="h-3.5 w-3.5" strokeWidth={2.2} />
          {formatSprintKey(sprint, sprintKeyPrefix)}
        </div>

        <div className="mt-4 flex w-full flex-col items-center justify-center gap-3 px-4 transition-transform duration-300 group-hover:-translate-y-3">
          <h3 className="font-display text-2xl font-black leading-tight tracking-tight text-slate-900 dark:text-white">
            {sprint.name}
          </h3>
        </div>

        <div className="mt-6 flex items-center justify-center gap-7 text-center transition-transform duration-300 group-hover:-translate-y-3">
          <div className="flex flex-col items-center">
            <div className="font-mono text-[2rem] font-black text-slate-900 dark:text-white">{sprint.tasksCount}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Tasks</div>
          </div>
          <div className="h-10 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="flex flex-col items-center">
            <div className="font-mono text-[2rem] font-black text-slate-900 dark:text-white">{sprint.completion}%</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Done</div>
          </div>
        </div>

        <div className="absolute bottom-5 flex w-full translate-y-2 items-center justify-center gap-3 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onPrimaryAction?.();
            }}
            disabled={!onPrimaryAction || primaryBusy}
            className={`touch-target flex h-9 w-9 items-center justify-center rounded-full text-slate-800 transition-all duration-300 dark:text-white focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
              isRunning
                ? "bg-status-red/[0.12] shadow-[0_0_18px_rgba(227,0,15,0.16)] hover:bg-status-red/[0.18]"
                : "bg-signal-500/[0.12] shadow-[0_0_18px_rgba(0,224,160,0.16)] hover:bg-signal-500/[0.18]"
            } disabled:cursor-not-allowed disabled:opacity-60`}
            title={isRunning ? "Stop" : "Start"}
          >
            {isRunning
              ? <Square className={`h-3.5 w-3.5 ${primaryBusy ? "animate-pulse" : ""}`} fill="currentColor" />
              : <Play className={`h-3.5 w-3.5 ${primaryBusy ? "animate-pulse" : ""}`} fill="currentColor" />}
          </button>
          <a
            href={`/tasks?sprint=${encodeURIComponent(sprint.id)}`}
            onClick={(event: MouseEvent) => event.stopPropagation()}
            className="touch-target inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all hover:opacity-85 dark:bg-white dark:text-void-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
          >
            View Tasks
            <Maximize2 className="h-2.5 w-2.5" />
          </a>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="touch-target flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.06] text-slate-800 transition-colors hover:bg-black/10 dark:bg-white/[0.07] dark:text-white dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
            title="Settings"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>

          <div
            role="menu"
            ref={menuRef}
            className={`absolute bottom-12 right-6 z-30 min-w-[10rem] origin-bottom-right rounded-[1.75rem] border border-black/[0.08] bg-white/92 p-2 shadow-[0_16px_36px_rgba(15,23,42,0.14)] backdrop-blur-xl transition-all duration-300 dark:border-white/[0.08] dark:bg-void-800/92 ${menuOpen ? "pointer-events-auto translate-y-0 scale-100 opacity-100" : "pointer-events-none translate-y-3 scale-95 opacity-0"}`}
          >
            <SprintActionMenu
              sprint={sprint}
              isCompleted={isCompleted}
              showcaseBusy={showcaseBusy}
              onEdit={onEdit}
              onExport={onExport}
              onToggleShowcase={onToggleShowcase}
              onOverrides={onOverrides}
              onMarkCompleted={onMarkCompleted}
              onDelete={onDelete}
              onClose={() => setMenuOpen(false)}
              markCompletedIcon="circle"
              role="menuitem"
              buttonClassName="flex w-full items-center gap-2 rounded-[1rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
