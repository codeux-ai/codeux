import type { FunctionComponent } from 'preact';
import { ActionFeedbackRegion } from '../../../components/ui/ActionFeedbackRegion.js';
import { SUBPANEL_CLASS } from './stats-ui-primitives.js';
import { useStatsI18n } from '../stats-i18n.js';

const FLAT_FEEDBACK_CLASS = `${SUBPANEL_CLASS} shadow-none dark:shadow-none bg-[color:var(--stats-surface-subpanel)] dark:bg-[color:var(--stats-surface-subpanel)]`;

export const UsageGraphLoading: FunctionComponent = () => {
  const { locale } = useStatsI18n();
  return (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="pending"
        message={locale === 'de' ? 'Telemetrie-Trenddaten werden geladen …' : 'Loading telemetry trend data...'}
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
  );
};

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => {
  const { locale } = useStatsI18n();
  return (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="warning"
        message={locale === 'de' ? 'Für diesen Zeitraum sind noch keine Telemetrieintervalle verfügbar. Setzen Sie den Zoom zurück oder ändern Sie den Statistikzeitraum.' : 'No telemetry buckets are available for this window yet. Reset the zoom or adjust the Stats time range to restore the plot.'}
        retryAction={onReset}
        retryLabel={onReset ? (locale === 'de' ? 'Zeitraum zurücksetzen' : 'Reset window') : undefined}
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
  );
};

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => {
  const { locale } = useStatsI18n();
  return (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="error"
        message={message || (locale === 'de' ? 'Die Trendtelemetrie konnte nicht abgerufen werden. Der bestehende Diagrammrahmen bleibt erhalten, damit Sie es ohne Kontextverlust erneut versuchen können.' : 'Trend telemetry could not be retrieved. The existing chart frame is preserved so you can retry without losing context.')}
        retryAction={onRetry}
        retryLabel={locale === 'de' ? 'Erneut versuchen' : 'Retry'}
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
  );
};
