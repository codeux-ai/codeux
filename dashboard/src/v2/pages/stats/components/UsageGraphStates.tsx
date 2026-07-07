import type { FunctionComponent } from 'preact';
import { ActionFeedbackRegion } from '../../../components/ui/ActionFeedbackRegion.js';
import { SUBPANEL_CLASS } from './stats-ui-primitives.js';

const FLAT_FEEDBACK_CLASS = `${SUBPANEL_CLASS} shadow-none dark:shadow-none bg-[color:var(--stats-surface-subpanel)] dark:bg-[color:var(--stats-surface-subpanel)]`;

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="pending"
        message="Loading telemetry trend data..."
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="warning"
        message="No telemetry buckets are available for this window yet. Reset the zoom or adjust the Stats time range to restore the plot."
        retryAction={onReset}
        retryLabel={onReset ? "Reset window" : undefined}
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="error"
        message={message || "Trend telemetry could not be retrieved. The existing chart frame is preserved so you can retry without losing context."}
        retryAction={onRetry}
        retryLabel="Retry"
        className={FLAT_FEEDBACK_CLASS}
        autoDismiss={false}
      />
    </div>
  </div>
);
