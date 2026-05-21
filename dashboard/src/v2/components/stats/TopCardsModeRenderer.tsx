import type { FunctionComponent } from "preact";
import type {
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../types.js";
import { formatTokens, formatDuration, createSeries } from "../../pages/stats/stats-utils.js";
import { StatsMetricCard } from "./StatsMetricCard.js";
import { STATS_COLORS } from "../../lib/stats/color-tokens.js";
import type { StatsVisualMode } from "../../pages/stats/components/stats-ui-primitives.js";
import { buildMetricSeries, extractProviderSeries } from "../../lib/stats/series-builders.js";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

export interface TopCardsModeRendererProps {
  mode: StatsVisualMode;
  stats: ProjectExecutionStatsSnapshot | null;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
  sourceSegments: SegmentDefinition[];
}

export const TopCardsModeRenderer: FunctionComponent<TopCardsModeRendererProps> = ({
  mode,
  stats,
  providerSegments,
  tokenSegments,
  sourceSegments,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const prevMode = useRef(mode);

  useLayoutEffect(() => {
    if (!containerRef.current || reducedMotion || prevMode.current === mode) return;

    gsap.killTweensOf(containerRef.current.children);
    gsap.fromTo(
      containerRef.current.children,
      { opacity: 0, y: 10 },
      { opacity: 1, y: 0, duration: 0.4, stagger: 0.05, ease: "power2.out", clearProps: "all" }
    );
    prevMode.current = mode;
  }, [mode, reducedMotion]);

  if (!stats) return null;

  const metricSeries = buildMetricSeries(stats);

  const renderTrendMode = () => {
    const taskCodingTokens = stats.purposes.find((p) => p.id === "task_coding")?.usage.totalTokens || 0;
    const ciFixTokens = stats.purposes.find((p) => p.id === "ci_fix")?.usage.totalTokens || 0;
    const qaReviewTokens = stats.purposes.find((p) => p.id === "qa_review")?.usage.totalTokens || 0;
    const planningTokens = stats.purposes.find((p) => p.id === "planning")?.usage.totalTokens || 0;
    const wallRuntime = stats.usage.wallTimeMs;

    return (
      <>
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
          value={formatDuration(wallRuntime)}
          detail="Task-run wall time in the same window, including completed sprint work."
          accentHex={STATS_COLORS.wallRuntime}
          sparkline={metricSeries.wallRuntime}
          signalLabel="Task Scope"
        />
      </>
    );
  };

  const renderCompositionMode = () => {
    const providerCount = providerSegments.length;
    const topProvider = providerSegments.length > 0 ? providerSegments[0] : null;

    return (
      <>
        <StatsMetricCard
          label="Active Providers"
          value={String(providerCount)}
          detail="Total number of unique model providers utilized in this window"
          accentHex="#10B981"
          sparkline={[]}
          signalLabel="Composition"
        />
        <StatsMetricCard
          label="Top Provider"
          value={topProvider ? topProvider.label : "None"}
          detail={topProvider ? `Leading provider by token volume: ${formatTokens(topProvider.value)}` : "No provider data"}
          accentHex="#0EA5E9"
          sparkline={[]}
          signalLabel="Composition"
        />
        <StatsMetricCard
          label="Input Tokens"
          value={formatTokens(stats.usage.inputTokens || 0)}
          detail="Total number of input tokens processed"
          accentHex="#00E0A0"
          sparkline={metricSeries.coreInputTokens}
          signalLabel="Composition"
        />
        <StatsMetricCard
          label="Output Tokens"
          value={formatTokens(stats.usage.outputTokens || 0)}
          detail="Total number of output tokens generated"
          accentHex="#FFB800"
          sparkline={metricSeries.coreOutputTokens}
          signalLabel="Composition"
        />
        <StatsMetricCard
          label="Merge Conflict"
          value={String(stats.git?.totals?.mergeConflictCount || 0)}
          detail="Total number of merge conflicts detected in this window"
          accentHex="#EF4444"
          sparkline={[]}
          signalLabel="Composition"
        />
      </>
    );
  };

  const renderReliabilityMode = () => {
    const topProviders = stats.providers?.slice(0, 4) || [];

    return (
      <>
        {topProviders.map((provider, index) => {
          const colors = ["#10B981", "#0EA5E9", "#F59E0B", "#8B5CF6"];
          return (
            <StatsMetricCard
              key={provider.id}
              label={provider.label || provider.id}
              value={formatTokens(provider.usage?.totalTokens || 0)}
              detail={`Total tokens processed by ${provider.label || provider.id}`}
              accentHex={colors[index % colors.length]!}
              sparkline={extractProviderSeries(stats, provider.id)}
              signalLabel="Providers"
            />
          );
        })}
      </>
    );
  };

  const renderLedgersMode = () => {
    return (
      <>
        <StatsMetricCard
          label="Insertions"
          value={formatTokens(stats.git?.totals?.insertions || 0)}
          detail="Lines added across repositories"
          accentHex="#10B981"
          sparkline={metricSeries.gitInsertions}
          signalLabel="Git Activity"
        />
        <StatsMetricCard
          label="Deletions"
          value={formatTokens(stats.git?.totals?.deletions || 0)}
          detail="Lines removed across repositories"
          accentHex="#EF4444"
          sparkline={metricSeries.gitDeletions}
          signalLabel="Git Activity"
        />
        <StatsMetricCard
          label="Pull Requests"
          value={formatTokens(stats.git?.totals?.prCount || 0)}
          detail="Total PRs opened"
          accentHex="#0EA5E9"
          sparkline={metricSeries.gitPrs}
          signalLabel="Git Activity"
        />
        <StatsMetricCard
          label="Merged Commits"
          value={formatTokens(stats.git?.totals?.mergedCount || 0)}
          detail="Total commits merged to main"
          accentHex="#8B5CF6"
          sparkline={metricSeries.gitMerges}
          signalLabel="Git Activity"
        />
        {/* Added Files Changed as the 5th metric because it naturally complements Insertions, Deletions, Pull Requests, and Merged Commits as a measure of Git activity scope. */}
        <StatsMetricCard
          label="Files Changed"
          value={formatTokens(stats.git?.totals?.filesChanged || 0)}
          detail="Files modified across repositories"
          accentHex="#3B82F6"
          sparkline={metricSeries.gitFilesChanged}
          signalLabel="Git Activity"
        />
      </>
    );
  };

  let cardsContent = null;
  if (mode === "trend") {
    cardsContent = renderTrendMode();
  } else if (mode === "composition") {
    cardsContent = renderCompositionMode();
  } else if (mode === "reliability") {
    cardsContent = renderReliabilityMode();
  } else if (mode === "ledgers") {
    cardsContent = renderLedgersMode();
  }

  return (
    <section
      ref={containerRef}
      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-5 w-full"
      data-testid="top-cards-renderer"
    >
      {cardsContent}
    </section>
  );
};
