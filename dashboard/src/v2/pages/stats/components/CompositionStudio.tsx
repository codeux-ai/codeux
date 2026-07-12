import type { FunctionComponent } from "preact";
import {
  ArrowDownRight,
  ArrowUpRight,
  Brain,
  Database,
  DollarSign,
  Gauge,
  GitMerge,
  TimerReset,
  type LucideIcon,
} from "lucide-preact";
import type {
  ExecutionStatsEntitySummary,
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
  DASHED_EMPTY_CLASS,
  PANEL_CLASS,
  TokenFlowBar,
  getProviderIcon,
} from "./stats-ui-primitives.js";
import styles from "./CompositionStudio.module.css";

interface SectionHeadingProps {
  id?: string;
  eyebrow: string;
  title: string;
  description: string;
  meta?: string;
}

const SectionHeading: FunctionComponent<SectionHeadingProps> = ({ id, eyebrow, title, description, meta }) => (
  <div className={styles.sectionHeading}>
    <div className={styles.sectionHeadingCopy}>
      <div className={styles.eyebrow}>{eyebrow}</div>
      <h2 id={id} className={styles.sectionTitle}>{title}</h2>
      <p className={styles.sectionDescription}>{description}</p>
    </div>
    {meta ? <div className={styles.sectionMeta}>{meta}</div> : null}
  </div>
);

interface TokenLaneProps {
  icon: LucideIcon;
  label: string;
  value: number;
  total: number;
  tone: "input" | "cached" | "output" | "reasoning";
}

const TokenLane: FunctionComponent<TokenLaneProps> = ({ icon: Icon, label, value, total, tone }) => {
  const share = total > 0 ? (value / total) * 100 : null;

  return (
    <div className={styles.tokenLane}>
      <div className={`${styles.tokenLaneIcon} ${styles[`tokenLaneIcon_${tone}`]}`} aria-hidden="true">
        <Icon strokeWidth={2} />
      </div>
      <div className={styles.tokenLaneCopy}>
        <div className={styles.tokenLaneLabel}>{label}</div>
        <div className={styles.tokenLaneShare}>{share === null ? "No volume" : `${formatPercent(share)} of total`}</div>
      </div>
      <div className={styles.tokenLaneValue}>{formatTokens(value)}</div>
    </div>
  );
};

interface EfficiencyDatumProps {
  icon: LucideIcon;
  label: string;
  value: string;
  detail: string;
}

const EfficiencyDatum: FunctionComponent<EfficiencyDatumProps> = ({ icon: Icon, label, value, detail }) => (
  <div className={styles.efficiencyDatum}>
    <Icon className={styles.efficiencyIcon} strokeWidth={1.8} aria-hidden="true" />
    <div>
      <div className={styles.dataLabel}>{label}</div>
      <div className={styles.efficiencyValue}>{value}</div>
      <div className={styles.dataDetail}>{detail}</div>
    </div>
  </div>
);

const getShare = (value: number, total: number): number | null => (
  total > 0 ? (value / total) * 100 : null
);

const PurposeRow: FunctionComponent<{
  purpose: ExecutionStatsEntitySummary;
  totalTokens: number;
  rank: number;
}> = ({ purpose, totalTokens, rank }) => {
  const share = getShare(purpose.usage.totalTokens, totalTokens);

  return (
    <div className={styles.purposeRow}>
      <div className={styles.rank}>{String(rank).padStart(2, "0")}</div>
      <div className={styles.purposeCopy}>
        <div className={styles.purposeTitle}>{purpose.label.replace(/_/g, " ")}</div>
        <div className={styles.dataDetail}>
          {purpose.usage.invocationCount.toLocaleString()} calls · {formatStatsDuration(purpose.usage.activeTimeMs)} active
        </div>
      </div>
      <div className={styles.purposeValue}>
        <strong>{formatTokens(purpose.usage.totalTokens)}</strong>
        <span>{share === null ? "No share" : `${formatPercent(share)} share`}</span>
      </div>
    </div>
  );
};

export const CompositionStudio: FunctionComponent<{
  stats: ProjectExecutionStatsSnapshot;
  providerSegments: SegmentDefinition[];
  tokenSegments: SegmentDefinition[];
}> = ({ stats, providerSegments }) => {
  const providers = [...stats.providers].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  const purposes = [...stats.purposes].sort((left, right) => {
    const delta = right.usage.totalTokens - left.usage.totalTokens;
    return delta !== 0 ? delta : left.label.localeCompare(right.label);
  });
  const segments = [...providerSegments].sort((left, right) => right.value - left.value);
  const cacheDenominator = stats.usage.inputTokens + stats.usage.cachedInputTokens;
  const cacheRate = cacheDenominator > 0 ? (stats.usage.cachedInputTokens / cacheDenominator) * 100 : null;
  const activeUtilization = stats.usage.wallTimeMs > 0
    ? (stats.usage.activeTimeMs / stats.usage.wallTimeMs) * 100
    : null;
  const hasCost = Number.isFinite(stats.usage.totalCostUsd) && stats.usage.totalCostUsd > 0;
  const gitTotals = stats.git?.totals;

  return (
    <section className={styles.studio} aria-label="Composition breakdown">
      <div className={styles.primaryGrid}>
        <article className={`${PANEL_CLASS} ${styles.tokenPanel}`} aria-labelledby="composition-token-title">
          <SectionHeading
            id="composition-token-title"
            eyebrow="Token anatomy"
            title="How the window was consumed"
            description="A direct read of prompt, cache, generation, and reasoning volume."
            meta={`${formatTokens(stats.usage.totalTokens)} total`}
          />

          <div className={styles.flowOverview}>
            <div>
              <div className={styles.dataLabel}>Total token volume</div>
              <div className={styles.heroValue}>{formatTokens(stats.usage.totalTokens)}</div>
            </div>
            <div className={styles.flowCaption}>Input → cache → output → reasoning</div>
          </div>
          <TokenFlowBar
            input={stats.usage.inputTokens}
            cached={stats.usage.cachedInputTokens}
            output={stats.usage.outputTokens}
            reasoning={stats.usage.reasoningOutputTokens}
            total={stats.usage.totalTokens}
          />

          <div className={styles.tokenLanes}>
            <TokenLane icon={ArrowDownRight} label="Input" value={stats.usage.inputTokens} total={stats.usage.totalTokens} tone="input" />
            <TokenLane icon={Database} label="Cached input" value={stats.usage.cachedInputTokens} total={stats.usage.totalTokens} tone="cached" />
            <TokenLane icon={ArrowUpRight} label="Output" value={stats.usage.outputTokens} total={stats.usage.totalTokens} tone="output" />
            <TokenLane icon={Brain} label="Reasoning" value={stats.usage.reasoningOutputTokens} total={stats.usage.totalTokens} tone="reasoning" />
          </div>

          <div className={styles.cacheCallout}>
            <div>
              <div className={styles.dataLabel}>Cache efficiency</div>
              <div className={styles.cacheValue}>{cacheRate === null ? "—" : `${cacheRate.toFixed(1)}%`}</div>
            </div>
            <p>
              {cacheRate === null
                ? "No cacheable input was recorded in this window."
                : `${formatTokens(stats.usage.cachedInputTokens)} tokens were served from cache.`}
            </p>
          </div>
        </article>

        <article className={`${PANEL_CLASS} ${styles.providerMixPanel}`} aria-labelledby="composition-provider-share-title">
          <SectionHeading
            id="composition-provider-share-title"
            eyebrow="Provider share"
            title="Where usage landed"
            description="Providers ranked by their contribution to total token volume."
            meta={`${segments.length} ${segments.length === 1 ? "provider" : "providers"}`}
          />

          {segments.length === 0 ? (
            <div className={DASHED_EMPTY_CLASS}>No provider data for this window.</div>
          ) : (
            <>
              <div
                className={styles.providerStack}
                role="img"
                aria-label={segments.map((segment) => `${segment.label}: ${formatTokens(segment.value)}`).join("; ")}
              >
                {segments.map((segment) => {
                  const share = getShare(segment.value, stats.usage.totalTokens) ?? 0;
                  return (
                    <span
                      key={segment.label}
                      aria-hidden="true"
                      className={styles.providerStackSegment}
                      style={{ width: `${share}%`, backgroundColor: segment.color }}
                    />
                  );
                })}
              </div>
              <div className={styles.providerMixRows}>
                {segments.map((segment, index) => {
                  const share = getShare(segment.value, stats.usage.totalTokens);
                  return (
                    <div key={segment.label} className={styles.providerMixRow}>
                      <span className={styles.providerDot} style={{ backgroundColor: segment.color }} aria-hidden="true" />
                      <span className={styles.providerMixRank}>{String(index + 1).padStart(2, "0")}</span>
                      <span className={styles.providerMixName}>{segment.label}</span>
                      <span className={styles.providerMixValue}>{formatTokens(segment.value)}</span>
                      <span className={styles.providerMixShare}>{share === null ? "—" : formatPercent(share)}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </article>
      </div>

      <div className={styles.secondaryGrid}>
        <article className={`${PANEL_CLASS} ${styles.purposePanel}`} aria-labelledby="composition-purpose-title">
          <SectionHeading
            id="composition-purpose-title"
            eyebrow="Purpose lanes"
            title="Why tokens were spent"
            description="Intent ranked by token volume, with invocation and active-time context."
            meta={purposes.length > 0 ? `${purposes.length} tracked` : undefined}
          />
          {purposes.length === 0 ? (
            <div className={DASHED_EMPTY_CLASS}>No purpose data for this window.</div>
          ) : (
            <div className={styles.purposeRows}>
              {purposes.slice(0, 6).map((purpose, index) => (
                <PurposeRow key={purpose.id} purpose={purpose} totalTokens={stats.usage.totalTokens} rank={index + 1} />
              ))}
            </div>
          )}
        </article>

        <article className={`${PANEL_CLASS} ${styles.efficiencyPanel}`} aria-labelledby="composition-efficiency-title">
          <SectionHeading
            id="composition-efficiency-title"
            eyebrow="Runtime context"
            title="Efficiency at a glance"
            description="Time and spend signals that explain the composition above."
          />
          <div className={styles.efficiencyGrid}>
            <EfficiencyDatum
              icon={TimerReset}
              label="Active time"
              value={formatStatsDuration(stats.usage.activeTimeMs)}
              detail="Provider execution"
            />
            <EfficiencyDatum
              icon={Gauge}
              label="Wall time"
              value={formatStatsDuration(stats.usage.wallTimeMs ?? 0)}
              detail={activeUtilization === null ? "Not tracked" : `${formatPercent(activeUtilization)} utilized`}
            />
            {hasCost ? (
              <EfficiencyDatum
                icon={DollarSign}
                label="Total cost"
                value={formatCost(stats.usage.totalCostUsd)}
                detail="Priced snapshot"
              />
            ) : null}
            {gitTotals ? (
              <EfficiencyDatum
                icon={GitMerge}
                label="Merge Conflicts"
                value={(stats.mergeConflictCount || gitTotals.mergeConflictCount || 0).toLocaleString()}
                detail={`${gitTotals.prCount.toLocaleString()} PRs · ${gitTotals.mergedCount.toLocaleString()} merged`}
              />
            ) : null}
          </div>
        </article>
      </div>

      <section className={styles.providerActivity} aria-labelledby="composition-provider-activity-title">
        <SectionHeading
          id="composition-provider-activity-title"
          eyebrow="Provider activity"
          title="Provider detail"
          description="Token volume, calls, cache behavior, and runtime efficiency without leaving the composition lens."
          meta={`${providers.length} ${providers.length === 1 ? "row" : "rows"}`}
        />

        {providers.length === 0 ? (
          <div className={DASHED_EMPTY_CLASS}>No provider data for this window.</div>
        ) : (
          <div className={styles.providerLedger} data-testid="composition-provider-activity">
            <div className={styles.providerLedgerHeader} aria-hidden="true">
              <span>Provider</span>
              <span>Token distribution</span>
              <span>Calls</span>
              <span>Cache</span>
              <span>Tokens / call</span>
              <span>Active</span>
              <span>Cost</span>
            </div>
            {providers.map((provider) => {
              const { icon: Icon, bg, text } = getProviderIcon(provider.provider);
              const providerCacheDenominator = provider.usage.inputTokens + provider.usage.cachedInputTokens;
              const providerCacheRate = providerCacheDenominator > 0
                ? (provider.usage.cachedInputTokens / providerCacheDenominator) * 100
                : null;
              const providerTokensPerCall = provider.usage.invocationCount > 0
                ? provider.usage.totalTokens / provider.usage.invocationCount
                : null;
              const providerShare = getShare(provider.usage.totalTokens, stats.usage.totalTokens);

              return (
                <article key={provider.id} className={styles.providerRow}>
                  <div className={styles.providerIdentity}>
                    <div className={`${styles.providerIcon} ${bg} ${text}`} aria-hidden="true">
                      <Icon strokeWidth={2} />
                    </div>
                    <div className={styles.providerNameBlock}>
                      <h3 title={provider.label}>{provider.label}</h3>
                      <p>{provider.secondaryLabel ?? "Provider telemetry"}</p>
                    </div>
                  </div>

                  <div className={styles.providerVolume}>
                    <div className={styles.providerVolumeHeader}>
                      <span>{formatTokens(provider.usage.totalTokens)} tokens</span>
                      <span>{providerShare === null ? "—" : `${formatPercent(providerShare)} share`}</span>
                    </div>
                    <TokenFlowBar
                      input={provider.usage.inputTokens}
                      cached={provider.usage.cachedInputTokens}
                      output={provider.usage.outputTokens}
                      reasoning={provider.usage.reasoningOutputTokens}
                      total={provider.usage.totalTokens}
                    />
                  </div>

                  <dl className={styles.providerFacts}>
                    <div><dt>Calls</dt><dd>{provider.usage.invocationCount.toLocaleString()}</dd></div>
                    <div><dt>Cache</dt><dd>{providerCacheRate === null ? "—" : `${providerCacheRate.toFixed(0)}%`}</dd></div>
                    <div><dt>Tokens / call</dt><dd>{providerTokensPerCall === null ? "—" : formatTokens(providerTokensPerCall)}</dd></div>
                    <div><dt>Active</dt><dd>{formatStatsDuration(provider.usage.activeTimeMs)}</dd></div>
                    <div><dt>Cost</dt><dd>{provider.usage.totalCostUsd > 0 ? formatCost(provider.usage.totalCostUsd) : "—"}</dd></div>
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
};
