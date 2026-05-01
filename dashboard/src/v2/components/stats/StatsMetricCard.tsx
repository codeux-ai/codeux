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

export const StatsMetricCard: FunctionComponent<StatsMetricCardProps> = ({
  label,
  value,
  detail,
  accentHex,
  sparkline,
  signalLabel,
}) => {
  let accent: StatsCardAccent = "default";
  if (accentHex === STATS_COLORS.taskCoding) accent = "cyan";
  else if (accentHex === STATS_COLORS.ciFix) accent = "amber";
  else if (accentHex === STATS_COLORS.qaReview) accent = "emerald";
  else if (accentHex === STATS_COLORS.planning) accent = "signal";
  else if (accentHex === STATS_COLORS.wallRuntime) accent = "default";

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
    >
      <Sparkline points={sparkline} color={accentHex} />
      <div className="mt-4 flex flex-col gap-1 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
          {detail}
        </div>
      </div>
    </StatsCard>
  );
};
