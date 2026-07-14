import type { FunctionComponent } from "preact";
import type { ChatProviderPublicDeliveryRecord } from "../../../../types.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { buildChatProviderDeliveryViewModel } from "../../../lib/chat-provider-view-models.js";

export const ChatConnectorDeliveryHistory: FunctionComponent<{
  connectionName: string;
  deliveries: ChatProviderPublicDeliveryRecord[];
  loading?: boolean;
  error?: string;
  pendingDeliveries: Record<string, string>;
  onInspect: (deliveryId: string) => void;
  onRetry: (delivery: ChatProviderPublicDeliveryRecord) => void;
  onCancel: (delivery: ChatProviderPublicDeliveryRecord) => void;
}> = ({ connectionName, deliveries, loading = false, error, pendingDeliveries, onInspect, onRetry, onCancel }) => (
  <section aria-label={`${connectionName} delivery history`} className="min-w-0 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Delivery history</h4>
      <span className="text-[11px] font-semibold text-slate-400">Outbound status only; payload bodies are never shown</span>
    </div>
    {loading ? <NoticePanel tone="pending" title="Loading deliveries">Refreshing redacted delivery state.</NoticePanel> : null}
    {error ? <NoticePanel tone="error" title="Delivery history unavailable">{error} Existing delivery records remain visible.</NoticePanel> : null}
    {!loading && deliveries.length === 0 ? <NoticePanel title="No outbound deliveries">Delivery attempts will appear here after a bound channel sends a reply.</NoticePanel> : null}
    <div className="space-y-2">
      {deliveries.map((delivery) => {
        const view = buildChatProviderDeliveryViewModel(delivery);
        const pendingAction = pendingDeliveries[delivery.id];
        return (
          <article key={delivery.id} className="min-w-0 rounded-xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-3">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-300">
                  <span>{view.statusLabel}</span><span>{view.retryLabel}</span><span>{view.attemptLabel}</span>
                </div>
                <p className="mt-1 break-words font-mono text-[11px] text-slate-500">Channel {view.channelLabel}</p>
                <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{view.nextRetryLabel}</p>
                {delivery.lastError ? <p className="mt-2 break-words text-xs font-medium text-status-red">{view.redactedError}</p> : null}
              </div>
              <div className="flex min-w-0 flex-wrap gap-2">
                <ActionButton label="Inspect" onClick={() => onInspect(delivery.id)} busy={pendingAction === "inspect"} disabled={Boolean(pendingAction)} />
                {view.isRetryable ? <ActionButton label="Retry" tone="warning" onClick={() => onRetry(delivery)} busy={pendingAction === "retry"} disabled={Boolean(pendingAction)} /> : null}
                {view.isCancellable ? <ActionButton label="Cancel" tone="danger" onClick={() => onCancel(delivery)} busy={pendingAction === "cancel"} disabled={Boolean(pendingAction)} /> : null}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  </section>
);
