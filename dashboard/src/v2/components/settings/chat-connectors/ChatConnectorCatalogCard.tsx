import type { FunctionComponent } from "preact";
import { Settings2 } from "lucide-preact";
import type { ChatProviderCardViewModel } from "../../../lib/chat-provider-view-models.js";
import type { ChatProviderKind } from "../../../../types.js";
import { ChatConnectorLogo } from "./ChatConnectorLogo.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../../i18n/messages/settings-integrations.js";

const Pill: FunctionComponent<{ children: string; active?: boolean }> = ({ children, active = false }) => (
  <span className={`inline-flex min-h-6 items-center rounded-full border px-2.5 text-[9px] font-bold uppercase tracking-[0.12em] ${active
    ? "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:text-signal-200"
    : "border-black/[0.08] bg-black/[0.035] text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.045] dark:text-slate-400"}`}>{children}</span>
);

export const ChatConnectorCatalogCard: FunctionComponent<{
  providerKind: ChatProviderKind;
  label: string;
  description: string;
  viewModel?: ChatProviderCardViewModel;
  prominent?: boolean;
  onManage: () => void;
}> = ({ providerKind, label, description, viewModel, prominent = false, onManage }) => {
  const { translate } = useDashboardI18n();
  const active = (viewModel?.activeConnectionCount ?? 0) > 0;
  return (
    <article aria-label={translate(settingsIntegrationsMessages, "chatConnectorLabel", { label })} className={`group relative min-w-0 overflow-hidden rounded-[1.35rem] border p-5 shadow-[0_12px_30px_rgba(15,23,42,0.035)] transition-[border-color,background-color,transform,box-shadow] motion-reduce:transition-none ${prominent ? "xl:col-span-2" : ""} ${active
      ? "border-signal-500/24 bg-white/90 dark:border-signal-400/24 dark:bg-void-800/82"
      : "border-black/[0.06] bg-white/88 dark:border-white/[0.08] dark:bg-void-800/78"}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <ChatConnectorLogo providerKind={providerKind} disabled={!active} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{label}</h3>
            {prominent ? <Pill active>{translate(settingsIntegrationsMessages, "recommendedStartingPoint")}</Pill> : null}
            {active ? <Pill active>{translate(settingsIntegrationsMessages, "verifiedActive")}</Pill> : null}
          </div>
          <p className="mt-1 break-words text-xs leading-relaxed text-slate-500 dark:text-slate-400">{viewModel?.description ?? description}</p>
        </div>
      </div>
      <div className="mt-5 flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:pl-14">
        <div className="flex min-w-0 flex-wrap gap-2">
          <Pill>{`${viewModel?.connectionCount ?? 0} ${translate(settingsIntegrationsMessages, "connections")}`}</Pill>
          <Pill>{`${viewModel?.configuredChannelCount ?? 0} ${translate(settingsIntegrationsMessages, "channels")}`}</Pill>
          <Pill active={viewModel?.outboundRepliesEnabled}>{translate(settingsIntegrationsMessages, viewModel?.outboundRepliesEnabled ? "repliesOn" : "repliesOff")}</Pill>
          {(viewModel?.failedOutboundCount ?? 0) > 0 ? <Pill>{`${viewModel?.failedOutboundCount} ${translate(settingsIntegrationsMessages, "failed")}`}</Pill> : null}
        </div>
        <button type="button" onClick={onManage} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] px-3 text-xs font-bold text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] dark:text-slate-200">
          <Settings2 className="h-4 w-4" aria-hidden="true" /> {translate(settingsIntegrationsMessages, "manageConnector", { label })}
        </button>
      </div>
    </article>
  );
};
