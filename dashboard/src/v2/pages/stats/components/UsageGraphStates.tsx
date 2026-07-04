import type { FunctionComponent } from 'preact';
import { ActionFeedbackRegion } from '../../../components/ui/ActionFeedbackRegion.js';

export const UsageGraphLoading: FunctionComponent = () => (
  <div className="flex h-[24rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg rounded-[var(--stats-subpanel-radius)] border border-[var(--stats-card-border)] bg-[var(--stats-subpanel-bg)] p-4 shadow-[var(--stats-card-shadow)]">
      <ActionFeedbackRegion
        status="pending"
        message="Loading chart data..."
        autoDismiss={false}
      />
    </div>
  </div>
);

export const UsageGraphEmpty: FunctionComponent<{ onReset?: () => void }> = ({ onReset }) => (
  <div className="flex h-[24rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg rounded-[var(--stats-subpanel-radius)] border border-[var(--stats-card-border)] bg-[var(--stats-subpanel-bg)] p-4 shadow-[var(--stats-card-shadow)]">
      <ActionFeedbackRegion
        status="warning"
        message="No data for this window. Telemetry will appear once the project starts executing tasks."
        retryAction={onReset}
        retryLabel={onReset ? "Reset Filters" : undefined}
        autoDismiss={false}
      />
    </div>
  </div>
);

export const UsageGraphError: FunctionComponent<{ message?: string; onRetry?: () => void }> = ({ message, onRetry }) => (
  <div className="flex h-[24rem] w-full items-center justify-center px-6">
    <div className="w-full max-w-lg rounded-[var(--stats-subpanel-radius)] border border-[var(--stats-card-border)] bg-[var(--stats-subpanel-bg)] p-4 shadow-[var(--stats-card-shadow)]">
      <ActionFeedbackRegion
        status="error"
        message={message || "An unexpected error occurred while retrieving graph data. Please try refreshing the page."}
        retryAction={onRetry}
        retryLabel="Retry"
        autoDismiss={false}
      />
    </div>
  </div>
);
