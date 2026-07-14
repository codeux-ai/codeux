import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { Check, KeyRound, Settings, ShieldAlert, Unlink } from "lucide-preact";
import type { AutomationCredentialCompatibilityIssue } from "../../../../../src/contracts/automation-credential-types.js";
import type { NodeDefinitionCredentialRequirement } from "../../../../../src/contracts/node-definition-types.js";
import {
  assessAutomationCredentialCompatibility,
  fetchAutomationCredentials,
  fetchCredentialHealth,
} from "../../lib/automation-credential-api.js";
import { writeSettingsNavigationState } from "../../lib/settings-navigation-state.js";
import { DropdownMenu, DropdownMenuItem } from "../ui/DropdownMenu.js";
import { translateNodesMessage, useNodesI18n } from "../../i18n/messages/nodes.js";
import type { DashboardLocale } from "../../i18n/locales.js";

export type CredentialSelectionResult = "saved" | "conflict" | "policy-denied" | "error" | "stale";

interface CredentialOption {
  id: string;
  name: string;
  kind: string;
  compatible: boolean;
  reasons: string[];
}

interface NodeCredentialPickerProps {
  projectId: string;
  identity: string;
  requirement: NodeDefinitionCredentialRequirement;
  boundCredentialId: string | null;
  disabled?: boolean;
  onSelect: (credentialId: string | null) => Promise<CredentialSelectionResult>;
}

const issueText = (
  issue: AutomationCredentialCompatibilityIssue,
  missingCapabilities: string[],
  allowedKinds: string[],
  locale: DashboardLocale,
): string => {
  switch (issue) {
    case "backend_unavailable": return translateNodesMessage(locale, "credentialStorageUnavailable");
    case "backend_insecure": return translateNodesMessage(locale, "credentialStorageNotReady");
    case "not_configured": return translateNodesMessage(locale, "credentialSetupIncomplete");
    case "not_active": return translateNodesMessage(locale, "credentialNotActive");
    case "project_access_denied": return translateNodesMessage(locale, "credentialProjectDenied");
    case "kind_not_allowed": return translateNodesMessage(locale, "credentialKindsRequired", { kinds: allowedKinds.join(", ") });
    case "capability_missing": return missingCapabilities.length > 0
      ? translateNodesMessage(locale, "credentialAccessMissing", { capabilities: missingCapabilities.join(", ") })
      : translateNodesMessage(locale, "credentialAccessNotGranted");
  }
};

export const NodeCredentialPicker: FunctionComponent<NodeCredentialPickerProps> = ({
  projectId,
  identity,
  requirement,
  boundCredentialId,
  disabled = false,
  onSelect,
}) => {
  const { locale, t } = useNodesI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [options, setOptions] = useState<CredentialOption[]>([]);
  const [backendReady, setBackendReady] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const requestRef = useRef(0);
  const triggerRef = useRef<HTMLElement>(null);

  const setPickerOpen = useCallback((nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen && typeof window !== "undefined") {
      window.setTimeout(() => triggerRef.current?.focus({ preventScroll: true }), 50);
    }
  }, []);

  const load = useCallback(async (): Promise<void> => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setLoadError(null);
    setOptions([]);
    try {
      const [credentials, health] = await Promise.all([
        fetchAutomationCredentials(projectId),
        fetchCredentialHealth(),
      ]);
      const ready = health.available
        && health.secure
        && typeof health.keyId === "string"
        && health.keyId.length > 0
        && health.keyVersion !== null;
      const assessments = await Promise.all(credentials.map(async (credential) => ({
        id: credential.id,
        name: credential.name,
        kind: credential.kind,
        assessment: await assessAutomationCredentialCompatibility(projectId, credential.id, {
          allowedKinds: requirement.allowedKinds,
          requiredCapabilities: requirement.requiredCapabilities,
        }),
      })));
      if (requestRef.current !== requestId) return;
      setBackendReady(ready);
      setOptions(assessments.map(({ id, name, kind, assessment }) => ({
        id,
        name,
        kind,
        compatible: ready && assessment.compatible,
        reasons: assessment.issues.map((issue) => issueText(
          issue,
          assessment.missingCapabilities,
          requirement.allowedKinds,
          locale,
        )),
      })));
    } catch {
      if (requestRef.current !== requestId) return;
      setBackendReady(false);
      setLoadError(t("credentialMetadataLoadFailed"));
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [locale, projectId, requirement.allowedKinds, requirement.requiredCapabilities, t]);

  useEffect(() => {
    requestRef.current += 1;
    setOpen(false);
    setOptions([]);
    setBackendReady(null);
    setLoadError(null);
    setSelectingId(null);
  }, [identity]);

  useEffect(() => {
    if (!open) return;
    void load();
    return () => { requestRef.current += 1; };
  }, [open, load]);

  const choose = async (credentialId: string | null): Promise<void> => {
    const pendingId = credentialId ?? "__unbind__";
    if (selectingId || disabled) return;
    setSelectingId(pendingId);
    const result = await onSelect(credentialId);
    setSelectingId(null);
    if (result === "saved") setPickerOpen(false);
  };

  const compatibleOptions = options.filter((option) => option.compatible);
  const unavailableOptions = options.filter((option) => !option.compatible);
  const hasCompatibleChoice = compatibleOptions.some((option) => option.id !== boundCredentialId);
  const currentOption = options.find((option) => option.id === boundCredentialId);

  return (
    <DropdownMenu
      isOpen={open}
      onOpenChange={setPickerOpen}
      triggerRef={triggerRef}
      position="bottom"
      align="end"
      className="w-[min(24rem,calc(100vw-1rem))] p-3"
      menuAriaLabel={t("credentialPickerFor", { label: requirement.label })}
      content={(
        <div className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
          <div className="px-1">
            <p className="text-sm font-bold text-slate-900 dark:text-white">{requirement.label}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t("chooseProjectCredential", { capabilities: requirement.requiredCapabilities.join(", ") || t("declaredAccess") })}
            </p>
          </div>
          {loading ? <p role="status" className="rounded-xl bg-black/[0.03] p-3 text-xs text-slate-500 dark:bg-white/[0.04]">{t("checkingCredentialCompatibility")}</p> : null}
          {loadError ? <div role="alert" className="rounded-xl border border-status-red/20 bg-status-red/[0.06] p-3 text-xs text-status-red">{loadError}</div> : null}
          {!loading && backendReady === false ? (
            <div role="alert" className="flex gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.08] p-3 text-xs leading-relaxed text-amber-800 dark:text-amber-200">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {t("credentialStorageUnavailableBindingsUnchanged")}
            </div>
          ) : null}
          {!loading && compatibleOptions.length > 0 ? (
            <div className="flex flex-col gap-1" aria-label={t("compatibleCredentials")}>
              <p className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("compatible")}</p>
              {compatibleOptions.map((option) => (
                <DropdownMenuItem
                  key={option.id}
                  disabled={Boolean(selectingId) || disabled}
                  aria-current={option.id === boundCredentialId ? "true" : undefined}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-signal-500/[0.08] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-slate-200"
                  onClick={() => void choose(option.id)}
                >
                  <span className="min-w-0"><span className="block truncate font-bold">{option.name}</span><span className="block truncate text-xs text-slate-500">{option.kind}</span></span>
                  {option.id === boundCredentialId ? <Check className="h-4 w-4 shrink-0 text-status-green" aria-label={t("currentlyBound")} /> : null}
                </DropdownMenuItem>
              ))}
            </div>
          ) : null}
          {!loading && unavailableOptions.length > 0 ? (
            <div className="flex flex-col gap-1" aria-label={t("unavailableCredentials")}>
              <p className="px-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{t("unavailableForSlot")}</p>
              {unavailableOptions.map((option) => (
                <div key={option.id} className="rounded-xl border border-black/[0.05] px-3 py-2 opacity-75 dark:border-white/[0.06]">
                  <p className="text-sm font-bold text-slate-600 dark:text-slate-300">{option.name} <span className="font-normal text-slate-400">· {option.kind}</span></p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{option.reasons.join(" ") || t("credentialSlotPolicyIncompatible")}</p>
                </div>
              ))}
            </div>
          ) : null}
          {!loading && !loadError && !hasCompatibleChoice ? (
            <div className="rounded-xl border border-black/[0.06] bg-black/[0.025] p-3 text-xs leading-relaxed text-slate-600 dark:border-white/[0.06] dark:bg-white/[0.03] dark:text-slate-300">
              <p>{t("noOtherCompatibleCredential")}</p>
              <a
                role="menuitem"
                href="/config"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg font-bold text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-signal-400"
                onClick={() => writeSettingsNavigationState({ activeCategory: "integrations", activeInvocationRoute: "task_coding", focusedSections: {} })}
              >
                <Settings className="h-3.5 w-3.5" aria-hidden="true" />{t("openCredentialSettings")}
              </a>
            </div>
          ) : null}
          {boundCredentialId ? (
            <DropdownMenuItem
              disabled={Boolean(selectingId) || disabled}
              className="flex w-full items-center gap-2 rounded-xl border border-status-red/20 px-3 py-2 text-left text-xs font-bold text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/30 disabled:opacity-50"
              onClick={() => void choose(null)}
            >
              <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
              {selectingId === "__unbind__" ? t("removingBinding") : t("removeCredentialBinding", { credential: currentOption?.name ?? t("credential") })}
            </DropdownMenuItem>
          ) : null}
        </div>
      )}
    >
      <button
        type="button"
        disabled={disabled}
        aria-label={t("chooseCredentialFor", { label: requirement.label })}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-signal-500/30 px-2.5 py-1.5 text-xs font-bold text-signal-600 transition hover:bg-signal-500/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-signal-400"
      >
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />{t(boundCredentialId ? "replaceOrRemove" : "bindCredential")}
      </button>
    </DropdownMenu>
  );
};
