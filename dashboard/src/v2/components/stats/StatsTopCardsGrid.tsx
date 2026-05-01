import type { FunctionComponent } from "preact";
import type { ProjectExecutionStatsSnapshot, ExecutionUsageTotals } from "../../types.js";
import { SignalMetricCard } from "../../pages/stats/components/StatsShared.js";
import { formatTokens, formatDuration, createSeries } from "../../pages/stats/stats-utils.js";
import type { StatsVisualMode } from "../../pages/stats/components/StatsShared.js";
import { useGitMetricsMapper } from "../../lib/stats/ledger-metrics.js";
import { StatsMetricCard } from "./StatsMetricCard.js";
import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import { buildMetricSeries } from "../../lib/stats/series-builders.js";

interface StatsTopCardsGridProps {
  stats: ProjectExecutionStatsSnapshot;
  usage: ExecutionUsageTotals;
  tokenSeries: number[];
  activeTimeSeries: number[];
  wallTimeSeries: number[];
  completionConfidence: string;
  visualMode: StatsVisualMode;
}

export const StatsTopCardsGrid: FunctionComponent<StatsTopCardsGridProps> = ({
  stats,
  usage,
  tokenSeries,
  activeTimeSeries,
  wallTimeSeries,
  completionConfidence,
  visualMode,
}) => {
  const gitMetrics = useGitMetricsMapper(stats.git);
  const metricSeries = buildMetricSeries(stats);

  if (visualMode === "ledgers" && stats.git) {
    return (
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
        <SignalMetricCard
          label="Insertions"
          value={gitMetrics.insertions.value}
          detail="Total lines of code added across all commits in the window"
          accentHex="#10B981"
          hoverTint="group-hover:bg-emerald-500/[0.03]"
          sparkline={gitMetrics.insertions.series}
          signalLabel="Added"
        />
        <SignalMetricCard
          label="Deletions"
          value={gitMetrics.deletions.value}
          detail="Total lines of code removed across all commits in the window"
          accentHex="#F43F5E"
          hoverTint="group-hover:bg-rose-500/[0.03]"
          sparkline={gitMetrics.deletions.series}
          signalLabel="Removed"
        />
        <SignalMetricCard
          label="Pull Requests"
          value={gitMetrics.prCount.value}
          detail="Total pull requests opened in the window"
          accentHex="#F59E0B"
          hoverTint="group-hover:bg-amber-500/[0.03]"
          sparkline={gitMetrics.prCount.series}
          signalLabel="Opened"
        />
        <SignalMetricCard
          label="Merges"
          value={gitMetrics.mergedCount.value}
          detail="Total pull requests merged in the window"
          accentHex="#6366F1"
          hoverTint="group-hover:bg-indigo-500/[0.03]"
          sparkline={gitMetrics.mergedCount.series}
          signalLabel="Merged"
        />
      </section>
    );
  }

  if (visualMode === "composition") {
    const taskCodingTokens = stats.purposes.find((p) => p.id === "task_coding")?.usage.totalTokens || 0;
    const ciFixTokens = stats.purposes.find((p) => p.id === "ci_fix")?.usage.totalTokens || 0;
    const qaReviewTokens = stats.purposes.find((p) => p.id === "qa_review")?.usage.totalTokens || 0;
    const planningTokens = stats.purposes.find((p) => p.id === "planning")?.usage.totalTokens || 0;

    return (
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-5 w-full">
        <StatsMetricCard
          label="Task Coding"
          value={formatTokens(taskCodingTokens)}
          detail="Total tokens utilized for core code generation tasks"
          accentHex={STATS_COLORS.taskCoding}
          sparkline={metricSeries.taskCodingTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="CI Fix"
          value={formatTokens(ciFixTokens)}
          detail="Total tokens consumed by CI/CD remediation workflows"
          accentHex={STATS_COLORS.ciFix}
          sparkline={metricSeries.ciFixTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="QA Review"
          value={formatTokens(qaReviewTokens)}
          detail="Total tokens used during code review and quality audits"
          accentHex={STATS_COLORS.qaReview}
          sparkline={metricSeries.qaReviewTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="Planning"
          value={formatTokens(planningTokens)}
          detail="Total tokens allocated to project and sprint planning"
          accentHex={STATS_COLORS.planning}
          sparkline={metricSeries.planningTokens}
          signalLabel="Tokens"
        />
        <StatsMetricCard
          label="Wall Runtime"
          value={formatDuration(usage.wallTimeMs)}
          detail="Task-run wall time in the same window, including completed sprint work."
          accentHex={STATS_COLORS.wallRuntime}
          sparkline={metricSeries.wallRuntime}
          signalLabel="Task Scope"
        />
      </section>
    );
  }

  return (
    <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 w-full">
      <SignalMetricCard
        label="Total Tokens"
        value={formatTokens(usage.totalTokens)}
        detail={`${usage.reportedInvocationCount} reported · ${usage.estimatedInvocationCount} estimated provider calls`}
        accentHex="#00E0A0"
        hoverTint="group-hover:bg-signal-500/[0.025]"
        sparkline={tokenSeries}
        signalLabel="Throughput"
      />
      <SignalMetricCard
        label="Active AI Time"
        value={formatDuration(usage.activeTimeMs)}
        detail={`${usage.invocationCount} tracked CLI invocations across the selected window`}
        accentHex="#FFB800"
        hoverTint="group-hover:bg-amber-500/[0.03]"
        sparkline={activeTimeSeries}
        signalLabel="Latency"
      />
      <SignalMetricCard
        label="Wall Runtime"
        value={formatDuration(usage.wallTimeMs)}
        detail="Task-run wall time in the same window, including completed sprint work."
        accentHex="#0EA5E9"
        hoverTint="group-hover:bg-cyan-500/[0.03]"
        sparkline={wallTimeSeries}
        signalLabel="Task Scope"
      />
      <SignalMetricCard
        label="Telemetry Confidence"
        value={completionConfidence}
        detail={`${usage.unavailableInvocationCount + usage.unsupportedInvocationCount} invocations could not expose authoritative counts`}
        accentHex="#10B981"
        hoverTint="group-hover:bg-emerald-500/[0.03]"
        sparkline={createSeries(stats.buckets, (bucket) => bucket.usage.reportedInvocationCount)}
        signalLabel="Audit"
      />
    </section>
  );
};
