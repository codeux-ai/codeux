import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import type { FunctionComponent } from "preact";
import { StatsCard, type StatsCardAccent } from "../../pages/stats/components/StatsCard.js";
import { Sparkline } from "../../components/ui/Sparkline.js";
import { CHIP_CLASS } from "../../pages/stats/components/stats-ui-primitives.js";

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
  const accent = resolveAccent(accentHex);
  const hasSparkline = sparkline.some((point) => point > 0);

  return (
    <StatsCard
      title={label}
      value={value}
      trend={
        <div className={`max-w-full whitespace-normal break-words px-3 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
          {signalLabel}
        </div>
      }
      description={detail}
      accent={accent}
      density="compact"
      tone="muted"
      className="min-h-[11.5rem] min-w-0"
    >
      <div
        className="relative z-10 mt-3 min-h-[2.75rem] overflow-hidden rounded-[var(--stats-control-radius)]"
        role="img"
        aria-label={
          hasSparkline
            ? `${label} ${signalLabel.toLowerCase()} sparkline across the selected window.`
            : `${label} has no ${signalLabel.toLowerCase()} sparkline data for the selected window.`
        }
      >
        {hasSparkline ? (
          <Sparkline points={sparkline} color={accentHex} />
        ) : (
          <div
            className="pointer-events-none h-10 rounded-[var(--stats-control-radius)] border border-dashed border-black/[0.06] bg-slate-500/[0.035] dark:border-white/[0.07] dark:bg-white/[0.025]"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="relative z-10 mt-3 grid min-h-[2.25rem] min-w-0 content-end gap-2 border-t border-black/[0.06] pt-2.5 dark:border-white/[0.06]">
        {(secondaryDetail || qualityHint) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-medium leading-snug text-slate-500 dark:text-slate-400">
            {secondaryDetail && <span className="min-w-0 max-w-full flex-1 basis-32 break-words">{secondaryDetail}</span>}
            {qualityHint && (
              <span className="min-w-0 max-w-full rounded-full border border-black/[0.06] bg-white/[0.42] px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-[0.1em] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-400">
                {qualityHint}
              </span>
            )}
          </div>
        )}
      </div>
    </StatsCard>
  );
};
