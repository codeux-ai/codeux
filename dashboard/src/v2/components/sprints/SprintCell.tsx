import type { FunctionComponent } from "preact";
import { useRef, useState } from "preact/hooks";
import { Link } from "@tanstack/react-router";
import gsap from "gsap";
import {
  CalendarDays,
  Check,
  IdCard,
  Loader2,
  Maximize2,
  MoreVertical,
  Play,
  RotateCcw,
  Square,
} from "lucide-preact";
import type { ExecutionHumanInterventionSummary, Sprint, SprintStatus } from "../../types.js";
import { BorderTrace } from "../ui/BorderTrace.js";
import { WorkflowStatusBadge } from "../ui/WorkflowStatusBadge.js";
import type { CiStatusPresentation } from "../../lib/ci-status-presentation.js";
import { SprintActionMenu } from "./SprintActionMenu.js";
import {
  resolveSprintAttentionIndicatorState,
  SprintAttentionIndicator,
} from "./SprintAttentionIndicator.js";
import { DropdownMenu } from "../ui/DropdownMenu.js";
import { getSprintStatusPresentation } from "../../lib/sprint-status-presentation.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { computeSprintActionMenuPosition } from "../../lib/sprint-menu-positioning.js";
import { ORGANIC_CELL_SHADOW_CLASS } from "../ui/organic-cell-styles.js";
import { formatSprintCompletion } from "../../lib/sprint-progress-display.js";
import { SprintAmbientWaves } from "./SprintAmbientWaves.js";

const CARD_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});
const ACTIVE_WAVE_ACCENT_HEX = "#071521";

const statusMap: Record<SprintStatus, {
  ring: string;
  accentHex: string;
}> = {
  running: { ring: "border-status-green/45 shadow-[0_0_34px_rgba(0,171,132,0.28)]", accentHex: "#00AB84" },
  paused: { ring: "border-status-amber/45 shadow-[0_0_34px_rgba(245,158,11,0.24)]", accentHex: "#F59E0B" },
  completed: { ring: "border-slate-300/50 shadow-[0_0_24px_rgba(148,163,184,0.18)]", accentHex: "#94A3B8" },
  failed: { ring: "", accentHex: "#E3000F" },
  cancelled: { ring: "border-slate-300/35 shadow-[0_0_24px_rgba(148,163,184,0.16)]", accentHex: "#94A3B8" },
  idle: { ring: "", accentHex: "#00E0A0" },
};

const ATTENTION_ACCENT_MAP: Partial<Record<string, string>> = {
  merge_required: "#A855F7",
  merge_conflict: "#E3000F",
  ci_fix_required: "#3B82F6",
};

interface SprintCellProps {
  sprint: Sprint;
  isEven: boolean;
  accentColor: string;
  sprintKeyPrefix?: string;
  primaryBusy?: boolean;
  showcaseBusy?: boolean;
  markCompletedBusy?: boolean;
  markQaPassedBusy?: boolean;
  updateBranchBusy?: boolean;
  isPaused?: boolean;
  pauseResumeBusy?: boolean;
  humanIntervention?: ExecutionHumanInterventionSummary | null;
  ciStatus?: CiStatusPresentation | null;
  onPrimaryAction?: () => void;
  onPauseResume?: () => void;
  onAddTasks?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onOverrides?: () => void;
  onUpdateBranch?: () => void;
  onToggleShowcase?: () => void;
  onMarkCompleted?: () => void;
  onMarkQaPassed?: () => void;
  onRollback?: () => void;
}

const formatSprintKey = (sprint: Sprint, prefix: string = "SPR"): string => (
  sprint.number ? `${prefix}-${sprint.number}` : sprint.slug.toUpperCase()
);

const formatCardDate = (value: string): string => CARD_DATE_FORMATTER.format(new Date(value));
const BUBBLE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const formatBubbleTime = (value: string): string => BUBBLE_TIME_FORMATTER.format(new Date(value));

export const SprintCell: FunctionComponent<SprintCellProps> = ({
  sprint,
  isEven,
  accentColor,
  sprintKeyPrefix = "SPR",
  primaryBusy = false,
  showcaseBusy = false,
  markCompletedBusy = false,
  markQaPassedBusy = false,
  updateBranchBusy = false,
  isPaused = false,
  pauseResumeBusy = false,
  humanIntervention = null,
  ciStatus = null,
  onPrimaryAction,
  onPauseResume,
  onAddTasks,
  onEdit,
  onDelete,
  onExport,
  onOverrides,
  onUpdateBranch,
  onToggleShowcase,
  onMarkCompleted,
  onMarkQaPassed,
  onRollback,
}) => {
  const interactionTokens = useInteractionTokens();
  const gsapTokens = useGsapInteractionTokens();

  const bubbleRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const state = statusMap[sprint.status];
  const isRollback = sprint.kind === "rollback";
  const statusPresentation = getSprintStatusPresentation({
    state: sprint.status,
    humanInterventionTitle: humanIntervention?.title ?? null,
    humanInterventionReason: humanIntervention?.reason ?? null,
    humanInterventionInstructions: humanIntervention?.instructions ?? null,
    humanInterventionOwnerType: humanIntervention?.ownerType ?? null,
    attentionType: humanIntervention?.attentionType ?? null,
    completion: sprint.completion,
    latestReviewStatus: sprint.latestReview?.status ?? null,
  });

  const attentionOverride = (sprint.status === "running" || sprint.status === "paused")
    && humanIntervention?.attentionType
    && !(ciStatus && humanIntervention.attentionType === "ci_fix_required")
    ? ATTENTION_ACCENT_MAP[humanIntervention.attentionType]
    : undefined;

  let effectiveAccentHex = isRollback ? "#F97316" : state.accentHex;

  if (statusPresentation.statusLabel === "QA") {
    effectiveAccentHex = "#F59E0B";
  } else if (statusPresentation.statusLabel === "Merge") {
    effectiveAccentHex = "#A855F7";
  } else if (statusPresentation.statusLabel === "Merge Conflict") {
    effectiveAccentHex = "#E3000F";
  } else if (attentionOverride) {
    effectiveAccentHex = attentionOverride;
  }
  const visualAccentHex = sprint.status === "running"
    ? ACTIVE_WAVE_ACCENT_HEX
    : effectiveAccentHex;

  const isCompleted = sprint.status === "completed";
  const isRunning = sprint.status === "running";
  const completionLabel = formatSprintCompletion(sprint.completion);
  const attentionIndicatorState = resolveSprintAttentionIndicatorState({
    sprintStatus: sprint.status,
    statusPresentation,
    humanIntervention,
  });
  const galleryAttentionIndicatorState = attentionIndicatorState?.kind === "human"
    ? attentionIndicatorState
    : null;
  const animationClass = isCompleted ? "" : isEven ? "animate-organic" : "animate-organic-reverse";
  const controlFeedbackStyle = {
    transitionDuration: interactionTokens.controlFeedback.duration,
    transitionTimingFunction: interactionTokens.controlFeedback.ease,
  };
  const asyncFeedbackStyle = {
    transitionDuration: interactionTokens.asyncFeedback.duration,
    transitionTimingFunction: interactionTokens.asyncFeedback.ease,
  };
  const listReorderStyle = {
    transitionDuration: interactionTokens.listReorder.duration,
    transitionTimingFunction: interactionTokens.listReorder.ease,
  };
  const handleHoverEnter = () => {
    if (!bubbleRef.current || isCompleted) {
      return;
    }
    gsap.to(bubbleRef.current, {
      scale: 1.018,
      y: -4,
      rotation: 0,
      duration: gsapTokens.controlFeedback.duration,
      ease: gsapTokens.controlFeedback.ease,
      overwrite: "auto",
    });
  };

  const handleHoverLeave = () => {
    if (!bubbleRef.current || isCompleted) {
      return;
    }
    gsap.to(bubbleRef.current, {
      scale: 1,
      y: 0,
      rotation: 0,
      duration: gsapTokens.controlFeedback.duration,
      ease: gsapTokens.controlFeedback.ease,
      overwrite: "auto",
    });
  };

  const primaryActionLabel = isRunning ? "Stop" : "Start";
  const primaryAriaLabel = primaryBusy
    ? `${primaryActionLabel} sprint ${sprint.name} is pending`
    : `${primaryActionLabel} sprint ${sprint.name}`;
  const routeSearch = { projectId: sprint.projectId, sprintId: sprint.id } as any;
  const tasksHref = `/tasks?${new URLSearchParams(routeSearch).toString()}`;

  return (
    <div
      ref={bubbleRef}
      data-sprint-attention={galleryAttentionIndicatorState?.kind}
      data-sprint-kind={sprint.kind}
      onMouseEnter={handleHoverEnter}
      onMouseLeave={handleHoverLeave}
      className="group relative flex h-72 w-72 shrink-0 cursor-pointer items-center justify-center perspective-1000 transition-transform duration-150 will-change-transform motion-reduce:transition-none motion-reduce:will-change-auto lg:h-80 lg:w-80"
    >
      <div data-organic-cell-shadow className={`pointer-events-none absolute inset-0 ${ORGANIC_CELL_SHADOW_CLASS} transition-all ${animationClass}`} style={listReorderStyle} />

      <div
        className={`absolute inset-0 rounded-[1.75rem] transition-opacity transform-gpu ${animationClass} ${isCompleted ? "opacity-80" : ""}`}
        style={listReorderStyle}
      >
        <div
          className={`absolute inset-0 overflow-hidden rounded-[inherit] border backdrop-blur-md transition-colors ${isRollback ? "border-orange-400/35 bg-orange-50/78 dark:border-orange-400/25 dark:bg-orange-950/24" : `border-white/70 dark:border-white/[0.06] ${isRunning ? "bg-white/72 dark:bg-void-800/82" : "bg-white/55 dark:bg-void-800/65"}`}`}
          style={{
            ...listReorderStyle,
            WebkitMaskImage: "-webkit-radial-gradient(white, black)",
            backfaceVisibility: "hidden",
          }}
        >
          <div className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]" />
          <div className="pointer-events-none absolute inset-x-12 top-0 h-px bg-gradient-to-r from-transparent via-white/55 to-transparent opacity-60 dark:via-white/10" />
          <SprintAmbientWaves active={isRunning} />
          <BorderTrace accentHex={visualAccentHex} />
        </div>
      </div>

      {state.ring && !isCompleted && (
        <div
          data-sprint-status-ring={sprint.status}
          className={`absolute inset-0 pointer-events-none mix-blend-screen scale-[1.012] ${animationClass}`}
          style={{
            zIndex: 10,
          }}
        >
          {/* High-fidelity outer accent border */}
          <div
            className="absolute inset-0 rounded-[inherit] border border-status-green/50 dark:mix-blend-screen"
            style={{
              borderColor: `${visualAccentHex}70`,
            }}
          />
          {/* Quiet static depth around the current sprint. */}
          <div
            className="absolute inset-0 rounded-[inherit]"
            style={{
              boxShadow: `0 0 18px ${visualAccentHex}32, inset 0 0 9px ${visualAccentHex}18`,
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
        {isRollback && (
          <div className="absolute left-1/2 top-5 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-orange-500/25 bg-orange-500/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-orange-700 dark:text-orange-300">
            <RotateCcw className="h-3 w-3" strokeWidth={2.2} />
            Rollback
          </div>
        )}
        {galleryAttentionIndicatorState && (
          <SprintAttentionIndicator
            state={galleryAttentionIndicatorState}
            className="absolute bottom-full left-1/2 z-[80] mb-[10px] -translate-x-1/2"
          />
        )}

        <div className={`absolute left-6 top-6 inline-flex flex-col gap-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${accentColor}`}>
          <div className="flex items-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5" strokeWidth={2.1} />
            {formatCardDate(sprint.createdAt)}
          </div>
          <div className="pl-5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:opacity-100" style={controlFeedbackStyle}>
            {formatBubbleTime(sprint.createdAt)}
          </div>
        </div>
        <div className="absolute right-5 top-5 z-[60] flex max-w-[11rem] items-center justify-end lg:max-w-[13rem]">
          <WorkflowStatusBadge
            scope="sprint"
            status={sprint.status}
            review={sprint.latestReview}
            ciPresentation={ciStatus}
            humanIntervention={humanIntervention}
            compact
            align="right"
          />
        </div>

        <div
          data-sprint-key
          className="inline-flex items-center gap-2 font-mono text-[12px] font-bold tracking-[0.12em] text-blue-600 transition-transform group-hover:-translate-y-3 group-focus-within:-translate-y-3 motion-reduce:transform-none dark:text-blue-300"
          style={controlFeedbackStyle}
        >
          <IdCard className="h-4 w-4" strokeWidth={2.15} aria-hidden="true" />
          {formatSprintKey(sprint, sprintKeyPrefix)}
        </div>

        <div className="mt-4 flex w-full flex-col items-center justify-center gap-3 px-4 transition-transform group-hover:-translate-y-3 group-focus-within:-translate-y-3 motion-reduce:transform-none" style={controlFeedbackStyle}>
          <h3 className="max-w-[13rem] text-balance font-display text-[1.35rem] font-semibold leading-[1.15] tracking-[-0.025em] text-[var(--text-primary)]">
            {sprint.name}
          </h3>
        </div>

        <div data-sprint-metrics className="mt-6 flex items-center justify-center gap-7 text-center transition-transform group-hover:-translate-y-3 group-focus-within:-translate-y-3 motion-reduce:transform-none" style={controlFeedbackStyle}>
          <div className="flex flex-col items-center">
            <div className="font-mono text-2xl font-semibold text-[var(--text-primary)]">{sprint.tasksCount}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Tasks</div>
          </div>
          <div className="h-10 w-px bg-black/[0.08] dark:bg-white/[0.08]" />
          <div className="flex flex-col items-center">
            <div className="font-mono text-2xl font-semibold text-[var(--text-primary)]">{completionLabel}</div>
            <div className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">Done</div>
          </div>
        </div>

        <div className={`absolute bottom-5 flex w-full items-center justify-center gap-3 transition-all motion-reduce:translate-y-0 motion-reduce:opacity-100 ${
          menuOpen
            ? "translate-y-0 opacity-100"
            : "translate-y-2 opacity-0 pointer-events-none group-hover:translate-y-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:translate-y-0 group-focus-within:opacity-100 group-focus-within:pointer-events-auto"
        }`} style={controlFeedbackStyle}>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (primaryBusy) {
                return;
              }
              onPrimaryAction?.();
            }}
            aria-label={primaryAriaLabel}
            aria-busy={primaryBusy ? "true" : undefined}
            disabled={!onPrimaryAction || primaryBusy}
            className={`touch-target flex h-9 w-9 items-center justify-center rounded-full text-slate-800 transition-all dark:text-white focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2 ${
              isRunning
                ? "bg-status-red/[0.12] shadow-[0_0_18px_rgba(227,0,15,0.16)] hover:bg-status-red/[0.18]"
                : "bg-signal-500/[0.12] shadow-[0_0_18px_rgba(0,224,160,0.16)] hover:bg-signal-500/[0.18]"
            } disabled:cursor-not-allowed disabled:opacity-60`}
            style={primaryBusy ? asyncFeedbackStyle : controlFeedbackStyle}
            title={primaryBusy ? `${primaryActionLabel} pending` : primaryActionLabel}
          >
            {primaryBusy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" strokeWidth={2.2} />
              : isRunning
                ? <Square className="h-3.5 w-3.5" fill="currentColor" />
                : <Play className="h-3.5 w-3.5" fill="currentColor" />}
          </button>
          <Link
            to="/tasks"
            search={routeSearch}
            onClick={(event: MouseEvent) => event.stopPropagation()}
            aria-label={`Open tasks for sprint ${sprint.name}`}
            className="touch-target inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-900 px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_4px_12px_rgba(0,0,0,0.15)] transition-all hover:opacity-85 dark:bg-white dark:text-void-900 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
            style={controlFeedbackStyle}
          >
            Tasks
            <Maximize2 className="h-2.5 w-2.5" />
          </Link>
          <Link
            to="/live"
            search={routeSearch}
            onClick={(event: MouseEvent) => event.stopPropagation()}
            aria-label={`Open live session for sprint ${sprint.name}`}
            className="touch-target inline-flex h-9 items-center gap-1.5 rounded-full border border-signal-500/25 bg-signal-500/[0.12] px-4 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 shadow-[0_4px_12px_rgba(0,224,160,0.12)] transition-all hover:bg-signal-500/[0.18] dark:text-signal-300 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
            style={controlFeedbackStyle}
          >
            Live
            <Maximize2 className="h-2.5 w-2.5" />
          </Link>
          <DropdownMenu
            isOpen={menuOpen}
            onOpenChange={setMenuOpen}
            position="top"
            align="end"
            className="min-w-[10rem]"
            computePosition={({ triggerRect, menuRect, viewport }) => computeSprintActionMenuPosition(
              triggerRect,
              viewport,
              { width: menuRect.width, height: menuRect.height },
            )}
            content={
              <SprintActionMenu
                sprint={sprint}
                isCompleted={isCompleted}
                showcaseBusy={showcaseBusy}
                markCompletedDisabled={markCompletedBusy}
                markQaPassedDisabled={markQaPassedBusy || sprint.latestReview?.status === "running"}
                isRunning={isRunning}
                isPaused={isPaused}
                primaryBusy={primaryBusy}
                pauseResumeBusy={pauseResumeBusy}
                onPrimaryAction={onPrimaryAction}
                onPauseResume={onPauseResume}
                onAddTasks={onAddTasks}
                viewTasksHref={tasksHref}
                onEdit={onEdit}
                onExport={onExport}
                onToggleShowcase={onToggleShowcase}
                onOverrides={onOverrides}
                onUpdateBranch={onUpdateBranch}
                updateBranchBusy={updateBranchBusy}
                onMarkCompleted={onMarkCompleted}
                onMarkQaPassed={onMarkQaPassed}
                onRollback={onRollback}
                onDelete={onDelete}
                onClose={() => setMenuOpen(false)}
                markCompletedIcon="circle"
                role="menuitem"
                buttonClassName="flex w-full items-center gap-2 rounded-[1rem] px-3 py-2 text-left text-xs font-medium text-slate-600 transition-colors hover:bg-black/[0.04] hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:hover:text-white focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
              />
            }
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label={`Open actions menu for sprint ${sprint.name}`}
              className="touch-target flex h-9 w-9 items-center justify-center rounded-full bg-black/[0.06] text-slate-800 transition-colors hover:bg-black/10 dark:bg-white/[0.07] dark:text-white dark:hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-signal-500/30 focus-visible:ring-offset-2"
              style={controlFeedbackStyle}
              title="Settings"
            >
              <MoreVertical className="h-3.5 w-3.5" />
            </button>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
};
