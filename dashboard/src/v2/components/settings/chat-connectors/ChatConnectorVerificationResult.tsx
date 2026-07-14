import type { FunctionComponent } from "preact";
import { CheckCircle2, Clock3, ShieldAlert } from "lucide-preact";
import type { ChatProviderVerificationOutcome, ChatProviderVerificationStatus } from "../../../../types.js";
import { redactChatProviderError } from "../../../lib/chat-provider-view-models.js";

export const ChatConnectorVerificationResult: FunctionComponent<{
  connectionName: string;
  status: ChatProviderVerificationStatus;
  verifiedAt: string | null;
  outcome?: ChatProviderVerificationOutcome;
  stale: boolean;
  pending: boolean;
}> = ({ connectionName, status, verifiedAt, outcome, stale, pending }) => {
  const effectiveStatus = pending ? "pending" : stale ? "unverified" : status;
  const success = effectiveStatus === "verified";
  const Icon = success ? CheckCircle2 : effectiveStatus === "pending" ? Clock3 : ShieldAlert;
  const issues = outcome?.issues.map((issue) => redactChatProviderError(issue)) ?? [];
  return (
    <section aria-label={`${connectionName} verification result`} className={`min-w-0 rounded-[1.2rem] border p-4 ${success
      ? "border-status-green/20 bg-status-green/[0.06] text-status-green"
      : "border-status-amber/20 bg-status-amber/[0.06] text-status-amber"}`}
    >
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em]">
        <Icon className={`h-4 w-4 ${pending ? "motion-safe:animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
        {pending ? "Testing connection" : stale ? "Verification stale" : effectiveStatus === "verified" ? "Verified" : effectiveStatus === "failed" ? "Verification failed" : "Not verified"}
      </div>
      <p className="mt-2 break-words text-xs font-medium leading-relaxed">
        {stale
          ? "Material setup or credential edits must be saved and tested again before this connection can be healthy."
          : success
            ? `Last verified ${verifiedAt ?? "recently"}. ${outcome?.capabilities.length ? `Checked: ${outcome.capabilities.join(", ")}.` : ""}`
            : issues[0] ?? "Use Test connection after required setup and credential fields are saved."}
      </p>
      {outcome?.providerErrorCode ? <p className="mt-2 font-mono text-[11px]">Diagnostic code: {redactChatProviderError(outcome.providerErrorCode)}</p> : null}
      {outcome?.retryable ? <p className="mt-1 text-[11px] font-semibold">The backend marked this failure retryable.</p> : null}
    </section>
  );
};
