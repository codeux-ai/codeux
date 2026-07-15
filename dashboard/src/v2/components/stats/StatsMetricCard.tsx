import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { StatsCard, type StatsCardAccent } from "../../pages/stats/components/StatsCard.js";
import { Sparkline } from "../../components/ui/Sparkline.js";
import { CHIP_CLASS } from "../../pages/stats/components/stats-ui-primitives.js";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";
import { useGsapInteractionTokens } from "../../lib/motion/constants.js";
import { useStatsI18n } from "../../pages/stats/stats-i18n.js";

export interface StatsMetricCardProps {
  label: string;
  value: string;
  detail: string;
  secondaryDetail?: string;
  qualityHint?: string;
  accentHex: string;
  sparkline?: number[];
  signalLabel: string;
}

function resolveAccent(accentHex: string): StatsCardAccent {
  if (accentHex === STATS_COLORS.signal || accentHex === STATS_COLORS.planning) return "signal";
  if (accentHex === STATS_COLORS.amber || accentHex === STATS_COLORS.ember || accentHex === STATS_COLORS.ciFix) return "amber";
  if (accentHex === STATS_COLORS.cyanMuted || accentHex === STATS_COLORS.taskCoding) return "cyan";
  if (accentHex === STATS_COLORS.rose) return "rose";
  if (accentHex === STATS_COLORS.moss || accentHex === STATS_COLORS.qaReview) return "emerald";
  return "default";
}

export const StatsMetricCard: FunctionComponent<StatsMetricCardProps> = ({
  label,
  value,
  detail,
  secondaryDetail,
  qualityHint,
  accentHex,
  sparkline = [],
  signalLabel,
}) => {
  const { locale, text, formatNumber } = useStatsI18n();
  const contentRef = useRef<HTMLDivElement>(null);
  const previousStateKey = useRef(`${label}:${value}:${detail}:${sparkline.join(",")}`);
  const reducedMotion = useReducedMotion();
  const motionTokens = useGsapInteractionTokens();
  const accent = resolveAccent(accentHex);
  const hasSparkline = sparkline.some((point) => point > 0);
  const sparklineSummary = hasSparkline
    ? text("pointsHighLow", {
        label,
        signal: locale === "de" ? signalLabel : signalLabel.toLowerCase(),
        points: formatNumber(sparkline.length),
        high: formatNumber(Math.max(...sparkline)),
        low: formatNumber(Math.min(...sparkline)),
      })
    : text("noSparklineSummary", { label, signal: locale === "de" ? signalLabel : signalLabel.toLowerCase() });

  useLayoutEffect(() => {
    const stateKey = `${label}:${value}:${detail}:${sparkline.join(",")}`;
    if (!contentRef.current || previousStateKey.current === stateKey) {
      previousStateKey.current = stateKey;
      return;
    }

    gsap.killTweensOf(contentRef.current);
    if (!reducedMotion) {
      gsap.fromTo(
        contentRef.current,
        { opacity: 0.72, y: 4 },
        {
          opacity: 1,
          y: 0,
          duration: motionTokens.selectionMovement.duration,
          ease: motionTokens.selectionMovement.ease,
          clearProps: "opacity,transform",
        },
      );
    }
    previousStateKey.current = stateKey;

    return () => {
      if (contentRef.current) {
        gsap.killTweensOf(contentRef.current);
      }
    };
  }, [detail, label, motionTokens.selectionMovement.duration, motionTokens.selectionMovement.ease, reducedMotion, sparkline, value]);

  return (
    <StatsCard
      title={label}
      value={value}
      trend={
        <div className={`max-w-full whitespace-normal break-words px-2.5 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.12em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {signalLabel}
        </div>
      }
      description={detail}
      accent={accent}
      density="compact"
      tone="warm"
      className="min-h-[10.5rem] min-w-0"
    >
      <div ref={contentRef} className="relative z-10">
        <div className="relative mt-2.5 h-12 min-h-12 rounded-[var(--stats-control-radius)]">
          {hasSparkline ? (
            <Sparkline
              points={sparkline}
              color={accentHex}
              className="absolute inset-0 h-full w-full pointer-events-none"
              ariaLabel={sparklineSummary}
            />
          ) : (
            <div
              className="pointer-events-none grid h-10 place-items-center rounded-[var(--stats-control-radius)] border border-dashed border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-subpanel)] px-3 text-center text-[10px] font-bold uppercase tracking-[0.12em] text-[color:var(--stats-detail-color)]"
              role="img"
              aria-label={sparklineSummary}
            >
              {text("noSparklineData")}
            </div>
          )}
        </div>
        <div className="mt-2.5 grid min-h-[2rem] min-w-0 content-end gap-2 border-t border-[color:var(--stats-card-border)] pt-2.5">
          {(secondaryDetail || qualityHint) && (
            <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-medium leading-snug text-[color:var(--stats-detail-color)]">
              {secondaryDetail && <span className="min-w-0 max-w-full flex-1 basis-32 break-words">{secondaryDetail}</span>}
              {qualityHint && (
                <span className={`min-w-0 max-w-full px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-[0.1em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
                  {qualityHint}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </StatsCard>
  );
};
