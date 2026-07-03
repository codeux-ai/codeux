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
        <div className={`max-w-full whitespace-normal break-words px-3 py-1 text-center text-[10px] font-bold uppercase leading-tight tracking-[0.14em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`}>
          {signalLabel}
        </div>
      }
      description={detail}
      accent={accent}
      density="compact"
      tone="warm"
      className="min-h-[11.5rem] min-w-0"
    >
      <div
        className="relative z-10 mt-3 h-14 min-h-14 rounded-[var(--stats-control-radius)]"
        role="img"
        aria-label={
          hasSparkline
            ? `${label} ${signalLabel.toLowerCase()} sparkline across the selected window.`
            : `${label} has no ${signalLabel.toLowerCase()} sparkline data for the selected window.`
        }
      >
        {hasSparkline ? (
          <Sparkline points={sparkline} color={accentHex} className="absolute inset-0 h-full w-full pointer-events-none" />
        ) : (
          <div
            className="pointer-events-none h-10 rounded-[var(--stats-control-radius)] border border-dashed border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-subpanel)]"
            aria-hidden="true"
          />
        )}
      </div>
      <div className="relative z-10 mt-3 grid min-h-[2.25rem] min-w-0 content-end gap-2 border-t border-[color:var(--stats-card-border)] pt-2.5">
        {(secondaryDetail || qualityHint) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] font-medium leading-snug text-[color:var(--stats-detail-color)]">
            {secondaryDetail && <span className="min-w-0 max-w-full flex-1 basis-32 break-words">{secondaryDetail}</span>}
            {qualityHint && (
              <span className="min-w-0 max-w-full rounded-full border border-[color:var(--stats-card-border)] bg-[color:var(--stats-surface-chip)] px-2 py-0.5 text-[9px] font-bold uppercase leading-tight tracking-[0.1em] text-[color:var(--stats-detail-color)]">
                {qualityHint}
              </span>
            )}
          </div>
        )}
      </div>
    </StatsCard>
  );
};
