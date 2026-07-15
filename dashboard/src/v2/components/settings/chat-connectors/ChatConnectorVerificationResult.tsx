import type { FunctionComponent } from "preact";
import { CheckCircle2, Clock3, ShieldAlert } from "lucide-preact";
import type { ChatProviderVerificationOutcome, ChatProviderVerificationStatus } from "../../../../types.js";
import { redactChatProviderError } from "../../../lib/chat-provider-view-models.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../../i18n/messages/settings-integrations.js";

export const ChatConnectorVerificationResult: FunctionComponent<{
  connectionName: string;
  status: ChatProviderVerificationStatus;
  verifiedAt: string | null;
  outcome?: ChatProviderVerificationOutcome;
  stale: boolean;
  pending: boolean;
}> = ({ connectionName, status, verifiedAt, outcome, stale, pending }) => {
  const { translate } = useDashboardI18n();
  const effectiveStatus = pending ? "pending" : stale ? "unverified" : status;
  const success = effectiveStatus === "verified";
  const Icon = success ? CheckCircle2 : effectiveStatus === "pending" ? Clock3 : ShieldAlert;
  const issues = outcome?.issues.map((issue) => redactChatProviderError(issue)) ?? [];
  return (
    <section aria-label={translate(settingsIntegrationsMessages, "verificationResultFor", { connection: connectionName })} className={`min-w-0 rounded-[1.2rem] border p-4 ${success
      ? "border-status-green/20 bg-status-green/[0.06] text-status-green"
      : "border-status-amber/20 bg-status-amber/[0.06] text-status-amber"}`}
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">
        <Icon className={`h-4 w-4 ${pending ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        {translate(settingsIntegrationsMessages, pending ? "testingConnection" : stale ? "verificationStale" : effectiveStatus === "verified" ? "verified" : effectiveStatus === "failed" ? "verificationFailed" : "notVerified")}
      </div>
      <p className="mt-2 break-words text-xs font-medium leading-relaxed">
        {stale
          ? translate(settingsIntegrationsMessages, "verificationStaleDescription")
          : success
            ? translate(settingsIntegrationsMessages, "lastVerified", { verifiedAt: verifiedAt ?? translate(settingsIntegrationsMessages, "recently"), checked: outcome?.capabilities.length ? translate(settingsIntegrationsMessages, "checkedCapabilities", { capabilities: outcome.capabilities.join(", ") }) : "" })
            : issues[0] ?? translate(settingsIntegrationsMessages, "useTestConnection")}
      </p>
      {outcome?.providerErrorCode ? <p className="mt-2 font-mono text-[11px]">{translate(settingsIntegrationsMessages, "diagnosticCode")} {redactChatProviderError(outcome.providerErrorCode)}</p> : null}
      {outcome?.retryable ? <p className="mt-1 text-[11px] font-semibold">{translate(settingsIntegrationsMessages, "backendMarkedRetryable")}</p> : null}
    </section>
  );
};
