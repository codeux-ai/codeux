import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useState } from "preact/hooks";
import { KeyRound, Plus, RefreshCw, ShieldAlert } from "lucide-preact";
import type { AutomationCredentialMetadata, CredentialBackendHealth } from "../../../../../src/contracts/automation-credential-types.js";
import { createAutomationCredential, fetchAutomationCredentials, fetchCredentialHealth, revokeAutomationCredential, testAutomationCredential } from "../../lib/automation-credential-api.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../i18n/messages/settings-integrations.js";

export const AutomationCredentialManager: FunctionComponent<{ projectId: string }> = ({ projectId }) => {
  const { translate: t } = useDashboardI18n();
  const [credentials, setCredentials] = useState<AutomationCredentialMetadata[]>([]);
  const [health, setHealth] = useState<CredentialBackendHealth | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setError(null);
    try {
      const [nextCredentials, nextHealth] = await Promise.all([
        fetchAutomationCredentials(projectId),
        fetchCredentialHealth(),
      ]);
      setCredentials(nextCredentials);
      setHealth(nextHealth);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await createAutomationCredential(projectId, { name, kind, value, scope: "project", capabilities: ["read"] });
      setName("");
      setKind("");
      setValue("");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  const runCredentialAction = async (action: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="credential-manager-title" className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.02] p-5 dark:border-white/[0.06] dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="credential-manager-title" className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
            <KeyRound aria-hidden="true" className="h-4 w-4" />
            {t(settingsIntegrationsMessages, "automationCredentials")}
          </h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t(settingsIntegrationsMessages, "automationCredentialsDescription")}</p>
        </div>
        <button type="button" aria-label={t(settingsIntegrationsMessages, "refreshCredentials")} disabled={busy} onClick={() => void load()} className="rounded-lg p-2 text-slate-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 disabled:opacity-40">
          <RefreshCw aria-hidden="true" className={`h-4 w-4 ${busy ? "motion-safe:animate-spin" : ""}`} />
        </button>
      </div>
      {health && !health.available ? (
        <div role="alert" className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
          <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0" />
          {health.reason ?? t(settingsIntegrationsMessages, "secureStorageUnavailable")}
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-3 text-xs font-semibold text-red-600 dark:text-red-300">{error}</div> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {t(settingsIntegrationsMessages, "name")}
          <input aria-label={t(settingsIntegrationsMessages, "name")} value={name} onInput={(event) => setName(event.currentTarget.value)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-void-900" />
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {t(settingsIntegrationsMessages, "kind")}
          <input aria-label={t(settingsIntegrationsMessages, "kind")} value={kind} onInput={(event) => setKind(event.currentTarget.value)} placeholder="api-token" className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-void-900" />
        </label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">
          {t(settingsIntegrationsMessages, "secretValue")}
          <input aria-label={t(settingsIntegrationsMessages, "secretValue")} type="password" autoComplete="new-password" value={value} onInput={(event) => setValue(event.currentTarget.value)} className="mt-1 w-full rounded-xl border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-void-900" />
        </label>
      </div>
      <button type="button" disabled={busy || !health?.available || !name || !kind || !value} onClick={() => void create()} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-signal-600 px-4 py-2 text-xs font-bold text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500">
        <Plus aria-hidden="true" className="h-4 w-4" />
        {t(settingsIntegrationsMessages, "storeCredential")}
      </button>
      <ul className="mt-5 space-y-2">
        {credentials.map((credential) => (
          <li key={credential.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-void-900/50">
            <div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{credential.name}</div>
              <div className="text-[11px] text-slate-500">{credential.kind} · {credential.scope} · {credential.status} · v{credential.version}</div>
            </div>
            <div className="flex gap-2">
              <button type="button" disabled={busy} onClick={() => void runCredentialAction(() => testAutomationCredential(projectId, credential.id))} className="rounded-lg border border-black/10 px-3 py-1.5 text-xs font-bold disabled:opacity-40 dark:border-white/10">{t(settingsIntegrationsMessages, "test")}</button>
              <button type="button" disabled={busy || credential.status === "revoked"} onClick={() => void runCredentialAction(() => revokeAutomationCredential(projectId, credential.id))} className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs font-bold text-red-600 disabled:opacity-40">{t(settingsIntegrationsMessages, "revoke")}</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
};
