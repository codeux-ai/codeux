import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import type { FunctionComponent } from "preact";
import { StatsCard, type StatsCardAccent } from "../../pages/stats/components/StatsCard.js";
import { Sparkline } from "../../components/ui/Sparkline.js";
import { CHIP_CLASS } from "../../pages/stats/components/stats-ui-primitives.js";

export interface StatsMetricCardProps {
  label: string;
  value: string;
  detail: string;
  accentHex: string;
  sparkline: number[];
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
  accentHex,
  sparkline,
  signalLabel,
}) => {
  const accent = resolveAccent(accentHex);
  const hasSparkline = sparkline.length > 0;

  return (
    <StatsCard
      title={label}
      value={value}
      trend={
        <div className={`px-3 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400 ${CHIP_CLASS}`}>
          {signalLabel}
        </div>
      }
      accent={accent}
      density="compact"
      tone="muted"
      className="min-w-0 min-h-[10.75rem]"
    >
      {hasSparkline ? (
        <Sparkline points={sparkline} color={accentHex} />
      ) : (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-slate-500/[0.04] to-transparent" aria-hidden="true" />
      )}
      <div className="sr-only">
        {hasSparkline
          ? `${label} metric sparkline showing activity across the selected window.`
          : `${label} metric has no sparkline data for the selected window.`}
      </div>
      <div className="relative z-10 mt-4 flex min-h-[3.25rem] flex-col justify-end gap-1 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
        <div className="text-[11px] font-medium leading-relaxed text-slate-500 dark:text-slate-400">
          {detail}
        </div>
      </div>
    </StatsCard>
  );
};
