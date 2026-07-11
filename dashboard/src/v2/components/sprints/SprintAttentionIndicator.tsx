import type { FunctionComponent } from "preact";
import { CircleAlert, UserRound } from "lucide-preact";
import type {
  ExecutionHumanInterventionSummary,
  SprintStatus,
} from "../../types.js";
import type { SprintStatusPresentation } from "../../types/sprint.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { MOTION_TOKENS } from "../../lib/motion/tokens.js";

export type SprintAttentionIndicatorState =
  | { kind: "failure"; accessibleText: "Sprint execution failed" }
  | { kind: "human"; accessibleText: "Sprint waiting for human intervention" };

interface ResolveSprintAttentionIndicatorStateInput {
  sprintStatus: SprintStatus;
  statusPresentation: SprintStatusPresentation;
  humanIntervention: ExecutionHumanInterventionSummary | null;
}

export function resolveSprintAttentionIndicatorState({
  sprintStatus,
  statusPresentation,
  humanIntervention,
}: ResolveSprintAttentionIndicatorStateInput): SprintAttentionIndicatorState | null {
  if (sprintStatus === "failed") {
    return { kind: "failure", accessibleText: "Sprint execution failed" };
  }

  if (humanIntervention && statusPresentation.showHumanInterventionBadge) {
    return { kind: "human", accessibleText: "Sprint waiting for human intervention" };
  }

  return null;
}

interface SprintAttentionIndicatorProps {
  state: SprintAttentionIndicatorState;
  compact?: boolean;
  className?: string;
}

export const SprintAttentionIndicator: FunctionComponent<SprintAttentionIndicatorProps> = ({
  state,
  compact = false,
  className = "",
}) => {
  const reducedMotion = useReducedMotion();
  const isFailure = state.kind === "failure";
  const motionStyle = reducedMotion
    ? undefined
    : {
      animationDuration: isFailure
        ? `calc(${MOTION_TOKENS.timing.slow} * 3)`
        : `calc(${MOTION_TOKENS.timing.slow} * 4)`,
      animationTimingFunction: MOTION_TOKENS.easing.standard,
    };

  return (
    <span
      role="status"
      aria-label={state.accessibleText}
      title={state.accessibleText}
      data-sprint-attention-indicator={state.kind}
      data-compact={compact ? "true" : "false"}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      className={`inline-flex shrink-0 items-center justify-center border border-status-red/45 bg-status-red/[0.12] font-bold text-status-red shadow-[0_0_18px_rgba(227,0,15,0.18)] motion-reduce:shadow-none ${
        compact
          ? "h-7 min-w-7 gap-0.5 rounded-lg px-1.5"
          : "min-h-9 gap-2 rounded-full px-3 py-1.5"
      } ${className}`}
    >
      {isFailure ? (
        <>
          <CircleAlert
            aria-hidden="true"
            className={`${compact ? "h-4 w-4" : "h-5 w-5"} motion-safe:animate-pulse motion-reduce:animate-none`}
            style={motionStyle}
            strokeWidth={2.8}
          />
          <span aria-hidden="true" className={compact ? "sr-only" : "text-[10px] uppercase tracking-[0.12em]"}>
            Execution failed
          </span>
        </>
      ) : (
        <>
          <UserRound aria-hidden="true" className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={2.6} />
          <span
            aria-hidden="true"
            className={`${compact ? "text-[8px]" : "text-[10px]"} font-black tracking-[-0.05em] motion-safe:animate-bounce motion-reduce:animate-none`}
            style={motionStyle}
          >
            zZZ
          </span>
          <span aria-hidden="true" className={compact ? "sr-only" : "text-[10px] uppercase tracking-[0.12em]"}>
            Waiting for you
          </span>
        </>
      )}
    </span>
  );
};
