import type { FunctionComponent } from 'preact';
import type { ExecutionUsageBucketSummary } from '../../../types.js';
import { formatCost, formatStatsDuration, formatTokens } from '../stats-utils.js';
import { DASHED_EMPTY_CLASS, SUBPANEL_CLASS } from './stats-ui-primitives.js';
import { useStatsI18n } from '../stats-i18n.js';

export type UsageGraphInspectionState = 'idle' | 'focused' | 'pinned';

interface UsageGraphTooltipProps {
  visible: boolean;
  left: number;
  label: string;
  bucketStart: string;
  bucket?: ExecutionUsageBucketSummary | null;
  inspectionState?: UsageGraphInspectionState;
  activeSeries: Array<{
    id: string;
    label: string;
    accentHex: string;
    value: string | number;
  }>;
}

export const UsageGraphTooltip: FunctionComponent<UsageGraphTooltipProps> = ({
  visible,
  left,
  label,
  bucketStart,
  bucket,
  inspectionState,
  activeSeries,
}) => {
  const { locale, formatNumber } = useStatsI18n();
  const state = inspectionState ?? (visible ? 'focused' : 'idle');
  const date = new Date(bucketStart);
  let formattedDate = bucketStart;
  if (!Number.isNaN(date.getTime())) {
    const isHourlyOrDaily = date.getMinutes() === 0 && date.getSeconds() === 0;
    formattedDate = isHourlyOrDaily
      ? new Intl.DateTimeFormat(locale, { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date)
      : new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' }).format(date);
  }
  const usage = bucket?.usage;
  const detailRows = usage ? [
    { label: locale === 'de' ? 'Kosten' : 'Cost', value: formatCost(usage.totalCostUsd || 0, locale) },
    { label: 'Tokens', value: formatTokens(usage.totalTokens || 0, locale) },
    { label: locale === 'de' ? 'Aktive Zeit' : 'Active time', value: formatStatsDuration(usage.activeTimeMs || 0, locale) },
    { label: locale === 'de' ? 'Aufrufe' : 'Invocations', value: formatNumber(usage.invocationCount || 0) },
  ] : [];
  const stateCopy = state === 'pinned'
    ? (locale === 'de' ? 'Fixiertes Intervall' : 'Pinned bucket')
    : state === 'focused'
      ? (locale === 'de' ? 'Fokussiertes Intervall' : 'Focused bucket')
      : (locale === 'de' ? 'Inaktiv' : 'Idle');
  const dateCopy = visible ? formattedDate : locale === 'de' ? 'Kein Intervall ausgewählt' : 'No bucket selected';
  const helperCopy = state === 'pinned'
    ? (locale === 'de' ? 'Über Tastatur oder Zeitraumsteuerung fixiert. Exakte Werte bleiben bis zum Fokuswechsel sichtbar.' : 'Pinned from keyboard or range control. Exact values stay visible until focus changes.')
    : state === 'focused'
      ? (locale === 'de' ? 'Über Zeiger oder Tastatur fokussiert. Exakte Intervallwerte werden unten angezeigt.' : 'Focused from pointer or keyboard inspection. Exact bucket values are shown below.')
      : (locale === 'de' ? 'Zeigen Sie auf ein Intervall, fokussieren Sie das Diagramm oder verschieben Sie den Zeitraumregler, um exakte Werte zu prüfen.' : 'Hover a bucket, tab into the chart, or move the range slider to inspect exact values.');
  const markerLeft = Math.min(92, Math.max(8, left));

  return (
    <div
      role="tooltip"
      id="usage-chart-tooltip"
      aria-live="polite"
      aria-atomic="true"
      className={`${SUBPANEL_CLASS} mt-4 w-full max-w-[calc(100vw-2rem)] p-4 text-wrap break-words`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">{label || stateCopy}</div>
          <div className="mt-1 text-sm font-semibold text-[var(--stats-value-color)]">{dateCopy}</div>
          <div className="mt-1 text-xs leading-relaxed text-[var(--stats-detail-color)]">{helperCopy}</div>
        </div>
        <div className="shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--stats-detail-color)] sm:text-right">
          {visible ? stateCopy : locale === 'de' ? 'Inaktiv' : 'Idle'}
        </div>
      </div>
      <div
        className="mt-3 h-1 rounded-full bg-[color:var(--stats-quiet-track)]"
        role="img"
        aria-label={visible ? (locale === 'de' ? `${stateCopy}-Markierung bei ${formatNumber(Math.round(markerLeft))} Prozent des sichtbaren Diagrammzeitraums.` : `${stateCopy} marker at ${formatNumber(Math.round(markerLeft))} percent of the visible chart window.`) : locale === 'de' ? 'Inaktive Markierung wartet auf Diagrammfokus.' : 'Idle marker waiting for chart focus.'}
      >
        <span
          className="block h-full w-3 rounded-full bg-[color:var(--stats-signal-text)]"
          style={{ marginLeft: `${markerLeft}%`, transform: 'translateX(-50%)' }}
        />
      </div>
      {visible && detailRows.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-2">
          {detailRows.map((row) => (
            <div key={row.label} className={`${SUBPANEL_CLASS} min-w-0 p-3`}>
              <dt className="text-[9px] font-bold uppercase tracking-[0.12em] text-[var(--stats-label-color)]">{row.label}</dt>
              <dd className="mt-1 break-words text-sm font-semibold text-[var(--stats-value-color)]">{row.value}</dd>
            </div>
          ))}
        </dl>
      ) : visible ? (
          <div className={`${DASHED_EMPTY_CLASS} mt-3 text-sm leading-relaxed text-[var(--stats-detail-color)]`}>
          {locale === 'de' ? 'Für dieses Intervall sind keine Nutzungssummen für die aktive Reihe verfügbar.' : 'This bucket has no usage totals available for the active series.'}
        </div>
      ) : null}
      <div className="mt-3 grid gap-2">
        {visible && activeSeries.length > 0 ? activeSeries.map((series) => (
          <div key={`tooltip-${series.id}`} className={`${SUBPANEL_CLASS} grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 p-3 text-sm`}>
            <div className="inline-flex min-w-0 items-center gap-2.5 text-[var(--stats-detail-color)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-[color:var(--stats-surface-subpanel)]" style={{ backgroundColor: series.accentHex }} />
              <span className="min-w-0 break-words font-medium">{series.label}</span>
            </div>
            <div className="text-right font-semibold text-[var(--stats-value-color)]">{series.value}</div>
          </div>
        )) : (
          <div className={`${DASHED_EMPTY_CLASS} text-sm leading-relaxed text-[var(--stats-detail-color)]`}>
            {locale === 'de' ? 'Bewegen Sie den Zeiger, fokussieren Sie ein Intervall oder verwenden Sie den Zeitraumregler, um hier exakte Werte zu fixieren.' : 'Move the pointer, focus a bucket, or use the range slider to pin exact values here.'}
          </div>
        )}
      </div>
    </div>
  );
};
