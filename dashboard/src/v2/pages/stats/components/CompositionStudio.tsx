import type { ComponentType, FunctionComponent } from "preact";
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Database,
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
  DonutCard,
  PANEL_CLASS,
  PurposeRibbon,
  SUBPANEL_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";

const StudioMetricTile: FunctionComponent<{
  label: string;
  value: string;
  detail: string;
  toneClass?: string;
  icon?: ComponentType<any>;
}> = ({ label, value, detail, toneClass = "text-slate-500 dark:text-slate-400", icon: Icon }) => (
  <div className={`${SUBPANEL_CLASS} p-4`}>
    <div className="flex items-center justify-between gap-3">
      <div className={`text-[10px] font-bold uppercase tracking-[0.18em] ${toneClass}`}>{label}</div>
      {Icon ? <Icon className={`h-3.5 w-3.5 ${toneClass}`} strokeWidth={2.2} aria-hidden="true" /> : null}
    </div>
    <div className="mt-2 text-xl font-black text-slate-900 dark:text-white">{value}</div>
    <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{detail}</div>
  </div>
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
  const topProviderShare = stats.usage.totalTokens > 0 && topProvider
    ? (topProvider.usage.totalTokens / stats.usage.totalTokens) * 100
    : null;
  const topPurposeShare = stats.usage.totalTokens > 0 && topPurpose
    ? (topPurpose.usage.totalTokens / stats.usage.totalTokens) * 100
    : null;

  return (
    <section className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StudioMetricTile
          label="Provider Share"
          value={topProvider ? topProvider.label : "No providers"}
          detail={topProvider && topProviderShare !== null ? `${formatPercent(topProviderShare)} of token volume` : "Nothing reported yet"}
          toneClass="text-signal-500 dark:text-signal-400"
        />
        <StudioMetricTile
          label="Purpose Distribution"
          value={topPurpose ? topPurpose.label.replace(/_/g, " ") : "No purposes"}
          detail={topPurpose && topPurposeShare !== null ? `${formatPercent(topPurposeShare)} of token volume` : "No purpose data"}
          toneClass="text-amber-600 dark:text-amber-400"
        />
        <StudioMetricTile
          label="Cache Efficiency"
          value={cacheRate !== null ? `${cacheRate.toFixed(1)}%` : "—"}
          detail={cacheRate !== null ? `~${formatTokens(stats.usage.cachedInputTokens)} tokens saved` : "No cacheable input yet"}
          toneClass="text-cyan-600 dark:text-cyan-400"
          icon={Database}
        />
        <StudioMetricTile
          label="Active vs Wall Time"
          value={activeVsWallRate !== null ? `${formatPercent(activeVsWallRate * 100)} active` : "No wall time"}
          detail={activeVsWallRate !== null ? `${formatStatsDuration(stats.usage.activeTimeMs)} active / ${formatStatsDuration(stats.usage.wallTimeMs)} wall` : "Wall time was not recorded"}
          toneClass="text-rose-600 dark:text-rose-400"
          icon={TimerReset}
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
        <div className="space-y-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Purpose Distribution</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Token volume and active time by invocation purpose over the selected window.
            </div>
          </div>
          <PurposeRibbon purposes={stats.purposes} />
        </div>
        <div className={`${PANEL_CLASS} p-6`}>
          <div className="flex items-center gap-3">
            <TimerReset className="h-4 w-4 text-amber-500" strokeWidth={2} />
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Token Flight</div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <StudioMetricTile
              label="Input"
              value={formatTokens(stats.usage.inputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.inputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-signal-600 dark:text-signal-400"
              icon={ArrowDownRight}
            />
            <StudioMetricTile
              label="Cached"
              value={formatTokens(stats.usage.cachedInputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.cachedInputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-cyan-600 dark:text-cyan-400"
              icon={Database}
            />
            <StudioMetricTile
              label="Output"
              value={formatTokens(stats.usage.outputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.outputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-amber-600 dark:text-amber-400"
              icon={ArrowUpRight}
            />
            <StudioMetricTile
              label="Reasoning"
              value={formatTokens(stats.usage.reasoningOutputTokens)}
              detail={stats.usage.totalTokens > 0 ? `${Math.round((stats.usage.reasoningOutputTokens / stats.usage.totalTokens) * 100)}% of total` : "No total volume"}
              toneClass="text-rose-600 dark:text-rose-400"
              icon={Brain}
            />
            <div className="col-span-2 rounded-2xl border border-slate-500/16 bg-slate-500/10 p-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Active Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatStatsDuration(stats.usage.activeTimeMs)}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-600 dark:text-slate-300">Wall Time</div>
                  <div className="mt-2 text-lg font-black text-slate-900 dark:text-white">{formatStatsDuration(stats.usage.wallTimeMs ?? 0)}</div>
                </div>
              </div>
              <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                {activeVsWallRate !== null ? `${formatPercent(activeVsWallRate * 100)} active utilization` : "Wall time not tracked"}
              </div>
            </div>
          </div>
          <div className={`${SUBPANEL_CLASS} mt-4 p-5`}>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Cache Efficiency</div>
            <div className="mt-2 text-3xl font-black text-slate-900 dark:text-white">{cacheRate !== null ? cacheRate.toFixed(1) : "—"}%</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.16em] text-signal-500">
              {stats.usage.cachedInputTokens > 0 ? `~${formatTokens(stats.usage.cachedInputTokens)} tokens saved` : "No cache savings recorded"}
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
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">Provider Activity</div>
            <div className="mt-2 text-sm leading-relaxed text-slate-500 dark:text-slate-400">
              Token output, invocations, active time, and wall-time efficiency per provider over the selected window.
            </div>
          </div>
          <div className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 ${CHIP_CLASS}`}>
            {providers.length} providers
          </div>
        </div>
        {providers.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-black/[0.08] px-4 py-8 text-center text-sm text-slate-400 dark:border-white/[0.08]">
            No provider data for this window.
          </div>
        ) : (
          <div className="space-y-4">
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
                        <div className="break-words text-base font-black text-slate-900 dark:text-white" title={provider.label}>{provider.label}</div>
                        <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">{provider.secondaryLabel ?? "No secondary label"}</div>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"}
                        </span>
                        <span className="text-slate-400">cost</span>
                      </div>
                      <div className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] ${CHIP_CLASS}`}>
                        <span className="text-base font-black normal-case tracking-tight text-slate-900 dark:text-white">
                          {formatTokens(provider.usage.totalTokens)}
                        </span>
                        <span className="text-slate-400">tokens</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <StudioMetricTile
                      label="Invocations"
                      value={provider.usage.invocationCount.toLocaleString()}
                      detail={provider.usage.invocationCount > 0 ? `${providerModelsCount} linked models` : "No calls yet"}
                      toneClass="text-slate-500 dark:text-slate-400"
                    />
                    <StudioMetricTile
                      label="Active Time"
                      value={formatStatsDuration(provider.usage.activeTimeMs)}
                      detail={provider.usage.wallTimeMs > 0 ? `${formatPercent((provider.usage.activeTimeMs / provider.usage.wallTimeMs) * 100)} active` : "Wall time not tracked"}
                      toneClass="text-amber-600 dark:text-amber-400"
                      icon={TimerReset}
                    />
                    <StudioMetricTile
                      label="Cache Hit Rate"
                      value={providerCacheRate !== null ? `${providerCacheRate}%` : "—"}
                      detail={providerCacheRate !== null ? `${formatTokens(provider.usage.cachedInputTokens)} cached` : "No cache signal"}
                      toneClass="text-cyan-600 dark:text-cyan-400"
                      icon={Database}
                    />
                    <StudioMetricTile
                      label="Tokens / Call"
                      value={providerTokensPerCall !== null ? formatTokens(providerTokensPerCall) : "—"}
                      detail={provider.usage.invocationCount > 0 ? "Average per invocation" : "No calls yet"}
                      toneClass="text-rose-600 dark:text-rose-400"
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

                  <div className="mt-4 flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
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
