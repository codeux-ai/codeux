import type { FunctionComponent } from "preact";
import type { ChatProviderKind } from "../../../../types.js";

export const ChatConnectorLogo: FunctionComponent<{ providerKind: ChatProviderKind; disabled?: boolean }> = ({ providerKind, disabled = false }) => (
  <span
    aria-hidden="true"
    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[1rem] border text-[11px] font-black uppercase tracking-[0.08em] ${disabled
      ? "border-black/[0.06] bg-black/[0.035] text-slate-400 dark:border-white/[0.06] dark:bg-white/[0.04] dark:text-slate-500"
      : "border-signal-500/20 bg-signal-500/[0.1] text-signal-700 dark:border-signal-400/20 dark:bg-signal-400/[0.12] dark:text-signal-200"}`}
  >
    {providerKind === "microsoft-teams" ? "MT" : providerKind === "whatsapp" ? "WA" : providerKind === "imessage" ? "IM" : providerKind.slice(0, 2)}
  </span>
);
