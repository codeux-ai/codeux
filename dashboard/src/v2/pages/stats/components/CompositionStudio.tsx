import type { FunctionComponent } from "preact";
import {
  AlertTriangle,
  Database,
  GitBranch,
  ShieldCheck,
} from "lucide-preact";
import type { ProjectExecutionStatsSnapshot, SegmentDefinition } from "../../../types.js";
import { formatCost, formatPercent, formatStatsDuration, formatTokens } from "../stats-utils.js";
import {
  CHIP_CLASS,
  DASHED_EMPTY_CLASS,
  DonutCard,
  PurposeRibbon,
  TEXT_DETAIL_CLASS,
  TEXT_LABEL_CLASS,
  TEXT_VALUE_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";

const SECTION_TITLE_CLASS = `text-[10px] font-bold uppercase tracking-[0.2em] ${TEXT_LABEL_CLASS}`;
const SECTION_COPY_CLASS = `mt-2 max-w-3xl text-sm leading-relaxed ${TEXT_DETAIL_CLASS}`;

const Metric: FunctionComponent<{ label: string; value: string; detail: string }> = ({ label, value, detail }) => (
  <div className="min-w-0 py-2">
    <dt className={`text-[10px] font-bold uppercase tracking-[0.16em] ${TEXT_LABEL_CLASS}`}>{label}</dt>
    <dd className={`mt-1 break-words text-base font-semibold ${TEXT_VALUE_CLASS}`}>{value}</dd>
    <dd className={`mt-1 break-words text-xs leading-relaxed ${TEXT_DETAIL_CLASS}`}>{detail}</dd>
  </div>
);

export const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, tokenSegments }) => {
  const providers = [...(stats.providers || [])].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  const purposes = stats.purposes || [];
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const cacheRate = cacheDenominator > 0 ? (stats.usage.cachedInputTokens / cacheDenominator) * 100 : null;
  const activeVsWallRate = stats.usage.wallTimeMs > 0 ? stats.usage.activeTimeMs / stats.usage.wallTimeMs : null;
  const topPurpose = [...purposes].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  })[0] || null;
  const sourceCounts = {
    reported: stats.usage.reportedInvocationCount || 0,
    estimated: stats.usage.estimatedInvocationCount || 0,
    unavailable: stats.usage.unavailableInvocationCount || 0,
    unsupported: stats.usage.unsupportedInvocationCount || 0,
  };
  const knownSourceCount = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0);
  const unknownSourceCount = Math.max(0, stats.usage.invocationCount - knownSourceCount);
  const fallbackCount = sourceCounts.estimated + unknownSourceCount;
  const sourceRiskCount = sourceCounts.unavailable + sourceCounts.unsupported;
  const sourceConfidence = knownSourceCount + unknownSourceCount === 0
    ? "No source signal"
    : sourceCounts.reported === knownSourceCount + unknownSourceCount
      ? "Provider reported"
      : sourceRiskCount > 0 ? "Mixed confidence" : "Reported + fallback";
  const git = stats.git?.totals;
  const conflictCount = git?.mergeConflictCount ?? stats.mergeConflictCount ?? 0;
  const hasGitSignal = Boolean(git && (git.insertions || git.deletions || git.filesChanged || git.prCount || git.mergedCount || conflictCount));
  const hasCost = Number.isFinite(stats.usage.totalCostUsd) && stats.usage.totalCostUsd > 0;

  return (
    <section className="min-w-0 space-y-7" aria-labelledby="composition-studio-title">
      <div className="min-w-0 border-y border-[color:var(--stats-border-hairline)] py-4">
        <div className={SECTION_TITLE_CLASS}>Composition</div>
        <h2 id="composition-studio-title" className={`mt-1 break-words text-xl font-semibold tracking-tight ${TEXT_VALUE_CLASS}`}>Usage composition</h2>
        <p className={SECTION_COPY_CLASS}>Provider share, token flow, source confidence, purpose activity, cache efficiency, and Git context for the selected window.</p>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-5 2xl:grid-cols-2">
        <DonutCard
          title="Provider Share"
          eyebrow="Token volume"
          description="Provider token split ranked by visible volume."
          centerValue={String(providers.length)}
          centerLabel={providers.length === 1 ? "provider" : "providers"}
          segments={providerSegments}
        />
        <DonutCard
          title="Token Anatomy"
          eyebrow="Token flow"
          description="Input, cached input, output, and reasoning balance."
          centerValue={formatTokens(stats.usage.totalTokens)}
          centerLabel="total tokens"
          segments={tokenSegments}
        />
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-6 xl:grid-cols-3">
        <section className="min-w-0 border-t border-[color:var(--stats-border-hairline)] pt-4" aria-labelledby="composition-source-title">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[color:var(--stats-detail-color)]" aria-hidden="true" />
            <h3 id="composition-source-title" className={SECTION_TITLE_CLASS}>Source Confidence</h3>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4">
            <Metric label="Confidence" value={sourceConfidence} detail={`${sourceCounts.reported.toLocaleString()} provider-reported calls`} />
            <Metric label="Fallback" value={fallbackCount.toLocaleString()} detail={`${sourceCounts.estimated.toLocaleString()} estimated · ${unknownSourceCount.toLocaleString()} unknown`} />
            <Metric label="Unavailable" value={sourceRiskCount.toLocaleString()} detail={`${sourceCounts.unavailable.toLocaleString()} unavailable · ${sourceCounts.unsupported.toLocaleString()} unsupported`} />
          </dl>
        </section>

        <section className="min-w-0 border-t border-[color:var(--stats-border-hairline)] pt-4" aria-labelledby="composition-cache-title">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4 text-[color:var(--stats-accent-cyan)]" aria-hidden="true" />
            <h3 id="composition-cache-title" className={SECTION_TITLE_CLASS}>Cache Efficiency</h3>
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-x-4">
            <Metric label="Cache rate" value={cacheRate === null ? "—" : `${cacheRate.toFixed(1)}%`} detail={cacheRate === null ? "No cacheable input yet" : `${formatTokens(stats.usage.cachedInputTokens)} cached input`} />
            <Metric label="Active time" value={formatStatsDuration(stats.usage.activeTimeMs)} detail={activeVsWallRate === null ? "Wall time not tracked" : `${formatPercent(activeVsWallRate * 100)} of wall time`} />
            <Metric label="Cost" value={hasCost ? formatCost(stats.usage.totalCostUsd) : "—"} detail={hasCost ? "Configured snapshot pricing" : "No pricing signal"} />
          </dl>
        </section>

        <section className="min-w-0 border-t border-[color:var(--stats-border-hairline)] pt-4" aria-labelledby="composition-git-title">
          <div className="flex items-center gap-2">
            {conflictCount > 0 ? <AlertTriangle className="h-4 w-4 text-[color:var(--stats-warning-text)]" aria-hidden="true" /> : <GitBranch className="h-4 w-4 text-[color:var(--stats-detail-color)]" aria-hidden="true" />}
            <h3 id="composition-git-title" className={SECTION_TITLE_CLASS}>Git Context</h3>
          </div>
          {hasGitSignal ? (
            <dl className="mt-2 grid grid-cols-2 gap-x-4">
              <Metric label="Changed files" value={(git?.filesChanged ?? 0).toLocaleString()} detail={`${(git?.insertions ?? 0).toLocaleString()} additions · ${(git?.deletions ?? 0).toLocaleString()} deletions`} />
              <Metric label="Pull requests" value={(git?.prCount ?? 0).toLocaleString()} detail={`${(git?.mergedCount ?? 0).toLocaleString()} merged`} />
              <Metric label="Merge blockers" value={conflictCount.toLocaleString()} detail={conflictCount > 0 ? "Conflicts need review" : "No conflicts recorded"} />
            </dl>
          ) : <div role="status" className={`${DASHED_EMPTY_CLASS} mt-3 py-5`}>No Git activity was recorded in this window.</div>}
        </section>
      </div>

      <section className="min-w-0" aria-labelledby="composition-purpose-title">
        <h3 id="composition-purpose-title" className={SECTION_TITLE_CLASS}>Purpose Activity</h3>
        <p className={SECTION_COPY_CLASS}>Invocation count, active time, and token share by purpose.</p>
        <div className="mt-4">
          <PurposeRibbon purposes={purposes} totalTokens={stats.usage.totalTokens} dominantPurposeId={topPurpose?.id ?? null} />
        </div>
      </section>

      <section className="min-w-0" aria-labelledby="composition-provider-title">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 id="composition-provider-title" className={SECTION_TITLE_CLASS}>Provider Activity</h3>
            <p className={SECTION_COPY_CLASS}>Usage, cache behavior, time, pricing, and token flow ranked by token volume.</p>
          </div>
          <span className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] ${CHIP_CLASS}`}>{providers.length} providers</span>
        </div>
        {providers.length === 0 ? (
          <div role="status" className={`${DASHED_EMPTY_CLASS} mt-4`}>No provider data for this window.</div>
        ) : (
          <div className="mt-4 divide-y divide-[color:var(--stats-border-hairline)] border-y border-[color:var(--stats-border-hairline)]" data-testid="composition-provider-activity">
            {providers.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const denominator = provider.usage.inputTokens + provider.usage.cachedInputTokens;
              const providerCacheRate = denominator > 0 ? (provider.usage.cachedInputTokens / denominator) * 100 : null;
              const tokensPerCall = provider.usage.invocationCount > 0 ? provider.usage.totalTokens / provider.usage.invocationCount : null;
              const linkedModels = (stats.models || []).filter((model) => model.provider === provider.id).length;
              const utilization = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;
              return (
                <article key={provider.id} className="min-w-0 py-5" aria-label={`${provider.label} provider activity`}>
                  <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(12rem,1.2fr)_minmax(0,2fr)] xl:items-start">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className={`shrink-0 rounded-[var(--stats-chip-radius)] p-2 ${bg} ${text}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
                      <div className="min-w-0">
                        <h4 className={`break-words text-base font-semibold ${TEXT_VALUE_CLASS}`} title={provider.label}>{provider.label}</h4>
                        <p className={`mt-1 break-words text-sm ${TEXT_DETAIL_CLASS}`}>{provider.secondaryLabel ?? "No secondary label"}</p>
                      </div>
                    </div>
                    <div className="min-w-0">
                      <dl className="grid grid-cols-2 gap-x-4 md:grid-cols-3 xl:grid-cols-6">
                        <Metric label="Token share" value={formatTokens(provider.usage.totalTokens)} detail={stats.usage.totalTokens > 0 ? `${formatPercent((provider.usage.totalTokens / stats.usage.totalTokens) * 100)} of total` : "No total volume"} />
                        <Metric label="Invocations" value={provider.usage.invocationCount.toLocaleString()} detail={`${linkedModels} linked models`} />
                        <Metric label="Cache rate" value={providerCacheRate === null ? "—" : formatPercent(providerCacheRate)} detail={`${formatTokens(provider.usage.cachedInputTokens)} cached`} />
                        <Metric label="Tokens / call" value={tokensPerCall === null ? "—" : formatTokens(Math.round(tokensPerCall))} detail={tokensPerCall === null ? "No calls yet" : "Average volume"} />
                        <Metric label="Active time" value={formatStatsDuration(provider.usage.activeTimeMs)} detail={utilization === null ? "Wall time not tracked" : `${formatStatsDuration(provider.usage.wallTimeMs)} wall · ${formatPercent(utilization * 100)} utilization`} />
                        <Metric label="Cost" value={provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"} detail={provider.usage.totalCostUsd > 0 ? "Configured pricing" : "No pricing signal"} />
                      </dl>
                      <TokenFlowBar input={provider.usage.inputTokens} cached={provider.usage.cachedInputTokens} output={provider.usage.outputTokens} reasoning={provider.usage.reasoningOutputTokens} total={provider.usage.totalTokens} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
};
