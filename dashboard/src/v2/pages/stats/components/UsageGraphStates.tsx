import type { FunctionComponent } from 'preact';
import { ActionFeedbackRegion } from '../../../components/ui/ActionFeedbackRegion.js';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex min-h-[22rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg">
      <ActionFeedbackRegion
        status="pending"
        message="Loading telemetry trend data..."
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
        message="No telemetry buckets are available for this window yet."
        retryAction={onReset}
        retryLabel={onReset ? "Reset window" : undefined}
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
        message={message || "Trend telemetry could not be retrieved. Please try again."}
        retryAction={onRetry}
        retryLabel="Retry"
        autoDismiss={false}
      />
    </div>
  </div>
);
