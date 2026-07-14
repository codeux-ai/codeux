import type { FunctionComponent } from "preact";
import { KeyRound } from "lucide-preact";
import type { ProviderId, OnboardingProviderCredentialStatus, SystemSettings } from "../../../types.js";
import { ProviderBrandIcon } from "../providers/ProviderBrandIcon.js";
import { getSystemProvidersByType } from "../../lib/onboarding-settings-draft.js";
import { useInteractionTokens } from "../../lib/motion/tokens.js";
import { useOnboardingMessages } from "../../i18n/messages/onboarding.js";

const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
  "mockup-cli": "Mockup CLI",
};

const PROVIDER_TYPES: ProviderId[] = ["jules", "gemini", "antigravity", "codex", "claude-code", "qwen-code", "opencode"];

export interface OnboardingProvidersStepProps {
  selectedProviders: ProviderId[];
  toggleProvider: (providerId: ProviderId) => void;
  readinessByProvider: Partial<Record<ProviderId, OnboardingProviderCredentialStatus>>;
  settings: SystemSettings | null;
}

export const OnboardingProvidersStep: FunctionComponent<OnboardingProvidersStepProps> = ({
  selectedProviders,
  toggleProvider,
  readinessByProvider,
  settings,
}) => {
  const tokens = useInteractionTokens();
  const { t, tp } = useOnboardingMessages();

  return (
    <div className="space-y-4">
      <div data-onboarding-card className="rounded-3xl border border-black/[0.06] bg-white/70 p-5 shadow-[0_16px_42px_rgba(15,23,42,0.04)] dark:border-white/[0.06] dark:bg-white/[0.04]">
        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-5 w-5 shrink-0 text-signal-600 dark:text-signal-300" />
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{t("providerTools")}</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {t("providerToolsBody")}
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {PROVIDER_TYPES.map((providerId) => {
          const selected = selectedProviders.includes(providerId);
          const provider = readinessByProvider[providerId];
          const instanceCount = settings ? getSystemProvidersByType(settings, providerId).length : 0;
          return (
            <button
              data-onboarding-card
              key={providerId}
              type="button"
              aria-pressed={selected}
              aria-label={t(selected ? "deselectProvider" : "selectProvider", { provider: providerLabels[providerId] })}
              onClick={() => toggleProvider(providerId)}
              className={`group relative overflow-hidden rounded-3xl border p-4 text-left shadow-[0_14px_34px_rgba(15,23,42,0.04)] transition-[border-color,background-color,transform,box-shadow] hover:-translate-y-1 ${selected ? "border-signal-500/30 bg-signal-500/10 shadow-[0_18px_46px_rgba(0,224,160,0.08)]" : "border-black/[0.06] bg-white/75 hover:border-black/[0.12] dark:border-white/[0.06] dark:bg-white/[0.04]"}`}
              style={{ transitionDuration: tokens.selectionMovement.duration, transitionTimingFunction: tokens.selectionMovement.ease }}
            >
              <div aria-hidden className={`absolute left-0 top-4 bottom-4 w-1 rounded-r-full transition-opacity ${selected ? "bg-signal-500 opacity-100" : "bg-slate-300 opacity-0 group-hover:opacity-100 dark:bg-slate-600"}`} />
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <ProviderBrandIcon id={providerId} />
                  <div>
                    <div className="font-black text-slate-900 dark:text-white">{providerLabels[providerId]}</div>
                    <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{tp("instanceCount", instanceCount || 1)}</div>
                  </div>
                </div>
                <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-[0.14em] ${provider?.available ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : selected ? "bg-ember-500/10 text-ember-600 dark:text-ember-400" : "bg-slate-500/10 text-slate-500"}`}>
                  {providerId === "jules" ? t("apiKey") : provider?.available ? t("detected") : selected ? t("configure") : t("optional")}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
