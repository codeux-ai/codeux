import type { FunctionComponent } from "preact";
import { SignalMetricCard } from "../../pages/stats/components/StatsShared.js";
import type { AggregatedProviderSummary } from "../../lib/stats/provider-aggregation.js";
import { formatTokens, formatDuration } from "../../pages/stats/stats-utils.js";

export interface ProviderUsageCardProps {
  provider: AggregatedProviderSummary;
}

export const ProviderUsageCard: FunctionComponent<ProviderUsageCardProps> = ({ provider }) => {
  return (
    <SignalMetricCard
      label={provider.name}
      value={formatTokens(provider.totalUsage)}
      detail={`${provider.invocationCount} invocations · ${formatDuration(provider.activeTimeMs)} active time`}
      accentHex="#00E0A0"
      hoverTint="group-hover:bg-signal-500/[0.025]"
      sparkline={provider.dailySeries}
      signalLabel="Usage"
    />
  );
};
