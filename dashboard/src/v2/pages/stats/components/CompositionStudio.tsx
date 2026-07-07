import type { ComponentType, FunctionComponent } from "preact";
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Database,
  DollarSign,
  PieChart,
  TimerReset,
} from "lucide-preact";
import type {
  ProjectExecutionStatsSnapshot,
  SegmentDefinition,
} from "../../../types.js";
import {
  formatCost,
  formatPercent,
  formatStatsDuration,
  formatTokens,
} from "../stats-utils.js";
import {
  CHIP_CLASS,
  DASHED_EMPTY_CLASS,
  DonutCard,
  PANEL_CLASS,
  PurposeRibbon,
  STATUS_TONE_CLASS,
  SUBPANEL_CLASS,
  TEXT_DETAIL_CLASS,
  TEXT_LABEL_CLASS,
  TEXT_VALUE_CLASS,
  TokenChip,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";

const FLAT_BADGE_CLASS = `inline-flex items-center gap-2 rounded-[var(--stats-chip-radius)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)] ${CHIP_CLASS}`;
const SECTION_TITLE_CLASS = "text-[10px] font-bold uppercase tracking-[0.2em] text-[color:var(--stats-label-color)]";
const SECTION_COPY_CLASS = "mt-2 text-sm leading-relaxed text-[color:var(--stats-detail-color)]";

const StudioMetricTile: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  toneClass?: string;
  icon?: ComponentType<any>;
}> = ({ label, value, detail, toneClass = TEXT_DETAIL_CLASS, icon: Icon }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${toneClass}`}>{label}</div>
      {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={2.2} aria-hidden="true" /> : null}
    </div>
    <div className={`mt-2 text-lg font-semibold ${TEXT_VALUE_CLASS}`}>{value}</div>
    <div className={`mt-1 text-[10px] font-bold uppercase tracking-[0.14em] ${TEXT_LABEL_CLASS}`}>{detail}</div>
  </div>
);

const getPercent = (value: number, total: number): number | null => (
  total > 0 ? (value / total) * 100 : null
);

const formatPercentOrFallback = (value: number | null, fallback = "No token volume"): string => (
  value === null ? fallback : formatPercent(value)
);

export const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments, tokenSegments }) => {
  const providers = [...stats.providers].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const cacheRate = cacheDenominator > 0 ? (stats.usage.cachedInputTokens / cacheDenominator) * 100 : null;
  const activeVsWallRate = stats.usage.wallTimeMs > 0 ? stats.usage.activeTimeMs / stats.usage.wallTimeMs : null;
  const topProvider = providers[0] || null;
  const topPurpose = [...stats.purposes].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  })[0] || null;
  const topProviderShare = topProvider ? getPercent(topProvider.usage.totalTokens, stats.usage.totalTokens) : null;
  const inputShare = getPercent(stats.usage.inputTokens + stats.usage.cachedInputTokens, stats.usage.totalTokens);
  const outputShare = getPercent(stats.usage.outputTokens, stats.usage.totalTokens);
  const reasoningShare = getPercent(stats.usage.reasoningOutputTokens, stats.usage.totalTokens);
  const hasCost = Number.isFinite(stats.usage.totalCostUsd) && stats.usage.totalCostUsd > 0;

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StudioMetricTile
          label="Provider Share"
          value={topProvider ? topProvider.label : "No providers"}
          detail={topProvider && topProviderShare !== null ? `${formatPercent(topProviderShare)} of token volume` : "Nothing reported yet"}
        />
        <StudioMetricTile
          label="Token Mix"
          value={formatTokens(stats.usage.totalTokens)}
          detail={inputShare !== null ? `${formatPercent(inputShare)} input footprint` : "No token volume"}
          icon={PieChart}
        />
        <StudioMetricTile
          label="Cache Rate"
          value={cacheRate !== null ? `${cacheRate.toFixed(1)}%` : "—"}
          detail={cacheRate !== null ? `~${formatTokens(stats.usage.cachedInputTokens)} tokens saved` : "No cacheable input yet"}
          icon={Database}
        />
        <StudioMetricTile
          label="Output Ratio"
          value={formatPercentOrFallback(outputShare, "—")}
          detail={stats.usage.totalTokens > 0 ? `${formatTokens(stats.usage.outputTokens)} generated` : "No output tokens"}
          icon={ArrowUpRight}
        />
        <StudioMetricTile
          label="Reasoning Share"
          value={formatPercentOrFallback(reasoningShare, "—")}
          detail={stats.usage.reasoningOutputTokens > 0 ? `${formatTokens(stats.usage.reasoningOutputTokens)} reasoning` : "No reasoning tokens"}
          icon={Brain}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[1.02fr_0.98fr]">
        <DonutCard
          title="Provider Share"
          eyebrow="Composition"
          description="Provider token split grouped into visible lanes for faster reading at high volume."
          centerValue={String(stats.providers.length)}
          centerLabel={stats.providers.length === 1 ? "provider" : "providers"}
          segments={providerSegments}
        />
        <DonutCard
          title="Token Anatomy"
          eyebrow="Flow Mix"
          description="Input, cached, output, and reasoning balance across the selected telemetry window."
          centerValue={formatTokens(stats.usage.totalTokens)}
          centerLabel="token mix"
          segments={tokenSegments}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <TimerReset className="h-4 w-4 text-[color:var(--stats-detail-color)]" strokeWidth={2} />
            <div className={SECTION_TITLE_CLASS}>Token Flight</div>
          </div>
          <div className={SECTION_COPY_CLASS}>
            End-to-end token movement across input, cached input, output, reasoning, and cost signals from the selected snapshot.
          </div>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <StudioMetricTile
              label="Input"
              value={formatTokens(stats.usage.inputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${formatPercent((stats.usage.inputTokens / stats.usage.totalTokens) * 100)} of total` : "No total volume"}
              icon={ArrowDownRight}
            />
            <StudioMetricTile
              label="Cached Input"
              value={formatTokens(stats.usage.cachedInputTokens)}
              detail={cacheRate !== null ? `${cacheRate.toFixed(1)}% cache-hit rate` : "No cache signal"}
              icon={Database}
            />
            <StudioMetricTile
              label="Output"
              value={formatTokens(stats.usage.outputTokens)}
              detail={outputShare !== null ? `${formatPercent(outputShare)} output ratio` : "No total volume"}
              icon={ArrowUpRight}
            />
            <StudioMetricTile
              label="Reasoning"
              value={formatTokens(stats.usage.reasoningOutputTokens)}
              detail={reasoningShare !== null ? `${formatPercent(reasoningShare)} of total` : "No total volume"}
              icon={Brain}
            />
            {hasCost ? (
              <StudioMetricTile
                label="Total Cost"
                value={formatCost(stats.usage.totalCostUsd)}
                detail="Snapshot cost rollup"
                icon={DollarSign}
              />
            ) : null}
            <div className={`${SUBPANEL_CLASS} sm:col-span-2 p-4`}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">Active Time</div>
                  <div className="mt-2 text-base font-semibold text-[color:var(--stats-value-color)]">{formatStatsDuration(stats.usage.activeTimeMs)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-detail-color)]">Wall Time</div>
                  <div className="mt-2 text-base font-semibold text-[color:var(--stats-value-color)]">{formatStatsDuration(stats.usage.wallTimeMs ?? 0)}</div>
                </div>
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
                {activeVsWallRate !== null ? `${formatPercent(activeVsWallRate * 100)} active utilization` : "Wall time not tracked"}
              </div>
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} mt-4 p-5`}>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className={SECTION_TITLE_CLASS}>Cache Efficiency</div>
                <div className="mt-2 text-xl font-semibold text-[color:var(--stats-value-color)]">{cacheRate !== null ? cacheRate.toFixed(1) : "—"}%</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
                  {stats.usage.cachedInputTokens > 0 ? `~${formatTokens(stats.usage.cachedInputTokens)} cached input` : "No cache savings recorded"}
                </div>
              </div>
              {hasCost ? (
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">Cost</div>
                  <div className="mt-2 text-base font-semibold text-[color:var(--stats-value-color)]">{formatCost(stats.usage.totalCostUsd)}</div>
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <TokenChip icon={ArrowDownRight} label="Input" value={stats.usage.inputTokens} tone={STATUS_TONE_CLASS.signal} />
              <TokenChip icon={Database} label="Cached" value={stats.usage.cachedInputTokens} tone={STATUS_TONE_CLASS.cyan} />
              <TokenChip icon={ArrowUpRight} label="Output" value={stats.usage.outputTokens} tone={STATUS_TONE_CLASS.warning} />
              <TokenChip icon={Brain} label="Reasoning" value={stats.usage.reasoningOutputTokens} tone={STATUS_TONE_CLASS.negative} />
              {hasCost ? (
                <TokenChip icon={DollarSign} label="Cost" value={formatCost(stats.usage.totalCostUsd)} tone={STATUS_TONE_CLASS.positive} />
              ) : null}
            </div>
            <div className="mt-4">
              <TokenFlowBar
                input={stats.usage.inputTokens}
                cached={stats.usage.cachedInputTokens}
                output={stats.usage.outputTokens}
                reasoning={stats.usage.reasoningOutputTokens}
                total={stats.usage.totalTokens}
              />
            </div>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <div className={SECTION_TITLE_CLASS}>Purpose Lanes</div>
            <div className={SECTION_COPY_CLASS}>
              Invocation count, active time, and token share by purpose over the selected window.
            </div>
          </div>
          <PurposeRibbon
            purposes={stats.purposes}
            totalTokens={stats.usage.totalTokens}
            dominantPurposeId={topPurpose?.id ?? null}
          />
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className={SECTION_TITLE_CLASS}>Provider Activity</div>
            <div className={SECTION_COPY_CLASS}>
              Token output, invocations, active time, and wall-time efficiency per provider over the selected window.
            </div>
          </div>
          <div className={FLAT_BADGE_CLASS}>
            {providers.length} providers
          </div>
        </div>
        {providers.length === 0 ? (
          <div className={DASHED_EMPTY_CLASS}>
            No provider data for this window.
          </div>
        ) : (
          <div className="space-y-4" data-testid="composition-provider-activity">
            {providers.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerCacheDenominator = provider.usage.inputTokens + provider.usage.cachedInputTokens;
              const providerCacheRate = providerCacheDenominator > 0
                ? Math.round((provider.usage.cachedInputTokens / providerCacheDenominator) * 100)
                : null;
              const providerTokensPerCall = provider.usage.invocationCount > 0
                ? Math.round(provider.usage.totalTokens / provider.usage.invocationCount)
                : null;
              const providerModelsCount = (stats.models || []).filter((m) => m.provider === provider.id).length;
              const providerActiveVsWall = provider.usage.wallTimeMs > 0 ? provider.usage.activeTimeMs / provider.usage.wallTimeMs : null;

              return (
                <div key={provider.id} className={`${PANEL_CLASS} p-5`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="flex min-w-0 items-start gap-4">
                      <div className={`rounded-xl p-2 ${bg} ${text}`}>
                        <Icon className="h-4 w-4" strokeWidth={2.1} />
                      </div>
                      <div className="min-w-0">
                        <div className="break-words text-base font-semibold text-[color:var(--stats-value-color)]" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-[color:var(--stats-detail-color)]">{provider.secondaryLabel ?? "No secondary label"}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={FLAT_BADGE_CLASS}>
                        <span className="text-base font-semibold normal-case tracking-tight text-[color:var(--stats-value-color)]">
                          {provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"}
                        </span>
                        <span className="text-[color:var(--stats-label-color)]">cost</span>
                      </div>
                      <div className={FLAT_BADGE_CLASS}>
                        <span className="text-base font-semibold normal-case tracking-tight text-[color:var(--stats-value-color)]">
                          {formatTokens(provider.usage.totalTokens)}
                        </span>
                        <span className="text-[color:var(--stats-label-color)]">tokens</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StudioMetricTile
                      label="Invocations"
                      value={provider.usage.invocationCount.toLocaleString()}
                      detail={provider.usage.invocationCount > 0 ? `${providerModelsCount} linked models` : "No calls yet"}
                      toneClass="text-[color:var(--stats-detail-color)]"
                    />
                    <StudioMetricTile
                      label="Active Time"
                      value={formatStatsDuration(provider.usage.activeTimeMs)}
                      detail={provider.usage.wallTimeMs > 0 ? `${formatPercent((provider.usage.activeTimeMs / provider.usage.wallTimeMs) * 100)} active` : "Wall time not tracked"}
                      icon={TimerReset}
                    />
                    <StudioMetricTile
                      label="Cache Hit Rate"
                      value={providerCacheRate !== null ? `${providerCacheRate}%` : "—"}
                      detail={providerCacheRate !== null ? `${formatTokens(provider.usage.cachedInputTokens)} cached` : "No cache signal"}
                      icon={Database}
                    />
                    <StudioMetricTile
                      label="Tokens / Call"
                      value={providerTokensPerCall !== null ? formatTokens(providerTokensPerCall) : "—"}
                      detail={provider.usage.invocationCount > 0 ? "Average per invocation" : "No calls yet"}
                    />
                  </div>

                  <div className="mt-4">
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[color:var(--stats-label-color)]">
                    <span>{provider.usage.activeTimeMs > 0 ? formatStatsDuration(provider.usage.activeTimeMs) : "0s"} active</span>
                    <span>•</span>
                    <span>{provider.usage.wallTimeMs > 0 ? formatStatsDuration(provider.usage.wallTimeMs) : "No wall time"}</span>
                    {providerActiveVsWall !== null ? (
                      <>
                        <span>•</span>
                        <span>{formatPercent(providerActiveVsWall * 100)} utilization</span>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
};
