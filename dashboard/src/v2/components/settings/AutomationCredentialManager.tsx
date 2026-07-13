import type { FunctionComponent } from "preact";
import { useEffect, useId, useState } from "preact/hooks";
import { KeyRound, Plus, RefreshCw, ShieldAlert } from "lucide-preact";
import type {
  AutomationCredentialCapability,
  AutomationCredentialMetadata,
  AutomationCredentialScope,
  CredentialBackendHealth,
} from "../../../../../src/contracts/automation-credential-types.js";
import type { SettingsCredentialReference } from "../../../../../src/contracts/app-types.js";
import {
  bindAutomationCredential,
  createAutomationCredential,
  fetchAutomationCredentials,
  fetchCredentialHealth,
  replaceAutomationCredential,
  revokeAutomationCredential,
  rotateAutomationCredential,
  testAutomationCredential,
} from "../../lib/automation-credential-api.js";
import { getUsableCredentialOptions } from "../../lib/settings-view-models.js";
import { ActionFeedbackRegion } from "../ui/ActionFeedbackRegion.js";
import { Button } from "../ui/Button.js";
import { Dialog } from "../ui/Dialog.js";
import { SecretInput, SelectInput, TextInput } from "./SettingsFormFields.js";

const messageFrom = (caught: unknown): string => caught instanceof Error ? caught.message : String(caught);
const EMPTY_HEALTH: CredentialBackendHealth = {
  available: false,
  secure: false,
  provider: "unavailable",
  keyId: null,
  keyVersion: null,
  reason: "Secure credential storage has not been checked yet.",
};

export const CredentialReferenceSelector: FunctionComponent<{
  projectId?: string | null;
  value?: SettingsCredentialReference | null;
  bindingKey: string;
  label: string;
  onChange: (value: SettingsCredentialReference | null) => void;
  legacyValuePresent?: boolean;
  disabled?: boolean;
}> = ({ projectId, value, bindingKey, label, onChange, legacyValuePresent = false, disabled = false }) => {
  const [credentials, setCredentials] = useState<AutomationCredentialMetadata[]>([]);
  const [health, setHealth] = useState<CredentialBackendHealth>(EMPTY_HEALTH);
  const [selectedId, setSelectedId] = useState(value?.credentialId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSelectedId(value?.credentialId ?? ""), [value?.credentialId]);
  useEffect(() => {
    if (!projectId) return;
    let active = true;
    void Promise.all([fetchAutomationCredentials(projectId), fetchCredentialHealth()]).then(([nextCredentials, nextHealth]) => {
      if (!active) return;
      setCredentials(nextCredentials);
      setHealth(nextHealth);
    }).catch((caught) => active && setError(messageFrom(caught)));
    return () => { active = false; };
  }, [projectId]);

  const usableOptions = getUsableCredentialOptions(credentials, "read");
  const boundCredential = value
    ? credentials.find((credential) => credential.id === value.credentialId) ?? null
    : null;
  const options = boundCredential && !usableOptions.some((credential) => credential.id === boundCredential.id)
    ? [boundCredential, ...usableOptions]
    : usableOptions;
  const selectedCredential = credentials.find((credential) => credential.id === selectedId) ?? null;
  const selectedCredentialIsUsable = Boolean(selectedCredential
    && selectedCredential.configured
    && selectedCredential.status === "active"
    && selectedCredential.capabilities.includes("read"));
  const bind = async (): Promise<void> => {
    if (!projectId || !selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await bindAutomationCredential(projectId, selectedId, { bindingKey, capabilities: ["read"] });
      onChange({ credentialId: selectedId, capability: "read" });
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const disabledReason = !projectId
    ? "Select a project to manage encrypted credentials."
    : !health.available
      ? health.reason || "Secure credential storage is unavailable."
      : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <SelectInput
          value={selectedId}
          onChange={setSelectedId}
          disabled={disabled || Boolean(disabledReason) || busy}
          aria-label={`${label} credential`}
          options={[
            { value: "", label: "Select a stored credential" },
            ...options.map((credential) => ({
              value: credential.id,
              label: `${credential.name} · ${credential.kind} · ${credential.scope} · ${credential.status} · v${credential.version}`,
            })),
          ]}
        />
        <div className="flex gap-2">
          <Button size="sm" variant="signal" disabled={disabled || Boolean(disabledReason) || busy || !selectedCredentialIsUsable || selectedId === value?.credentialId} onClick={() => { void bind(); }}>
            {busy ? "Binding" : "Bind"}
          </Button>
          <Button size="sm" disabled={disabled || busy || !value} onClick={() => { setSelectedId(""); onChange(null); }}>
            Unbind
          </Button>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Capability: read. {value ? "The settings draft contains only this credential ID." : "No credential is bound."}
      </p>
      {boundCredential ? (
        <p role="status" className="text-xs text-slate-500 dark:text-slate-400">
          Bound metadata: {boundCredential.name} · {boundCredential.kind} · {boundCredential.scope} · {boundCredential.status} · version {boundCredential.version}.
        </p>
      ) : value ? (
        <p role="status" className="text-xs font-semibold text-amber-700 dark:text-amber-300">
          The bound credential is unavailable to this project. Unbind it or select an active credential.
        </p>
      ) : null}
      {disabledReason ? <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">{disabledReason}</p> : null}
      {legacyValuePresent ? (
        <p role="alert" className="text-xs font-semibold text-amber-700 dark:text-amber-300">
          A legacy secret value was detected. Bind a stored credential; saving will remove the legacy value from ordinary settings.
        </p>
      ) : null}
      {error ? <p role="alert" className="text-xs font-semibold text-status-red">{error}</p> : null}
    </div>
  );
};

interface PendingCredentialAction {
  credential: AutomationCredentialMetadata;
  action: "replace" | "revoke";
}

export const AutomationCredentialManager: FunctionComponent<{ projectId: string }> = ({ projectId }) => {
  const [credentials, setCredentials] = useState<AutomationCredentialMetadata[]>([]);
  const [health, setHealth] = useState<CredentialBackendHealth | null>(null);
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<AutomationCredentialScope>("project");
  const [capabilities, setCapabilities] = useState<AutomationCredentialCapability[]>(["read"]);
  const [replacementValues, setReplacementValues] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<PendingCredentialAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const capabilityErrorId = `${useId()}-capability-error`;

  const load = async (): Promise<void> => {
    setError(null);
    try {
      const [nextCredentials, nextHealth] = await Promise.all([
        fetchAutomationCredentials(projectId),
        fetchCredentialHealth(),
      ]);
      setCredentials(nextCredentials);
      setHealth(nextHealth);
    } catch (caught) {
      setError(messageFrom(caught));
    }
  };
  useEffect(() => { void load(); }, [projectId]);

  const toggleCapability = (capability: AutomationCredentialCapability): void => {
    setCapabilities((current) => current.includes(capability)
      ? current.filter((entry) => entry !== capability)
      : [...current, capability]);
  };

  const create = async (): Promise<void> => {
    if (capabilities.length === 0) {
      setError("Select at least one capability.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAutomationCredential(projectId, {
        name,
        kind,
        value,
        scope,
        allowedProjectIds: scope === "global" ? [projectId] : undefined,
        capabilities,
      });
      setName("");
      setKind("");
      setValue("");
      await load();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const mutateValue = async (credential: AutomationCredentialMetadata, action: "rotate" | "replace"): Promise<void> => {
    const nextValue = replacementValues[credential.id] ?? "";
    if (!nextValue) return;
    setBusy(true);
    setError(null);
    try {
      if (action === "rotate") await rotateAutomationCredential(projectId, credential.id, nextValue);
      else await replaceAutomationCredential(projectId, credential.id, nextValue);
      setReplacementValues((current) => ({ ...current, [credential.id]: "" }));
      setPendingAction(null);
      await load();
    } catch (caught) {
      setError(messageFrom(caught));
    } finally {
      setBusy(false);
    }
  };

  const confirmPendingAction = async (): Promise<void> => {
    if (!pendingAction) return;
    if (pendingAction.action === "revoke") {
      setBusy(true);
      try {
        await revokeAutomationCredential(projectId, pendingAction.credential.id);
        setPendingAction(null);
        await load();
      } catch (caught) {
        setError(messageFrom(caught));
      } finally {
        setBusy(false);
      }
      return;
    }
    await mutateValue(pendingAction.credential, "replace");
  };

  const writesDisabled = busy || !health?.available;
  return (
    <section aria-labelledby="credential-manager-title" className="rounded-[1.25rem] border border-black/[0.06] bg-black/[0.02] p-5 dark:border-white/[0.06] dark:bg-white/[0.03]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 id="credential-manager-title" className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100"><KeyRound className="h-4 w-4" />Automation credentials</h3>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Create, rotate, and replace values through write-only broker requests. Stored values are never returned.</p>
        </div>
        <Button type="button" size="sm" variant="ghost" aria-label="Refresh credentials" onClick={() => { void load(); }} icon={RefreshCw}>Refresh</Button>
      </div>
      {health ? (
        <div role="status" className={`mt-4 flex gap-2 rounded-xl border p-3 text-xs ${health.available && health.secure ? "border-signal-500/25 bg-signal-500/10 text-signal-800 dark:text-signal-200" : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"}`}>
          {!health.available ? <ShieldAlert className="h-4 w-4 shrink-0" /> : null}
          {health.available && health.secure ? `Secure backend ready: ${health.provider}, key version ${health.keyVersion ?? "unknown"}.` : health.reason ?? "Secure key storage is unavailable. Credential writes are disabled."}
        </div>
      ) : null}
      {error ? <div role="alert" className="mt-3 text-xs font-semibold text-status-red">{error}</div> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Name<TextInput value={name} onChange={setName} aria-label="Credential name" /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Kind<TextInput value={kind} onChange={setKind} placeholder="api-token" aria-label="Credential kind" /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Scope<SelectInput value={scope} onChange={(next) => setScope(next as AutomationCredentialScope)} aria-label="Credential scope" options={[{ value: "project", label: "Project" }, { value: "global", label: "Global (allow this project)" }]} /></label>
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Secret value<SecretInput value={value} onChange={setValue} disabled={writesDisabled} aria-label="Credential secret value" mono /></label>
      </div>
      <fieldset className="mt-3" aria-describedby={capabilities.length === 0 ? capabilityErrorId : undefined}>
        <legend className="text-xs font-semibold text-slate-600 dark:text-slate-300">Capabilities</legend>
        <div className="mt-2 flex flex-wrap gap-4">{["read", "write", "admin"].map((capability) => <label key={capability} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={capabilities.includes(capability)} onChange={() => toggleCapability(capability)} />{capability}</label>)}</div>
        {capabilities.length === 0 ? <p id={capabilityErrorId} role="alert" className="mt-1 text-xs text-status-red">Select at least one capability.</p> : null}
      </fieldset>
      <Button type="button" className="mt-3" size="sm" variant="signal" disabled={writesDisabled || !name.trim() || !kind.trim() || !value || capabilities.length === 0} onClick={() => { void create(); }} icon={Plus}>Store credential</Button>

      <ul className="mt-5 space-y-3">{credentials.map((credential) => (
        <li key={credential.id} className="rounded-xl border border-black/[0.06] bg-white/70 p-3 dark:border-white/[0.06] dark:bg-void-900/50">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-bold text-slate-700 dark:text-slate-200">{credential.name}</div>
              <div className="text-[11px] text-slate-500">{credential.kind} · {credential.scope} · {credential.status} · v{credential.version}</div>
              <div className="mt-1 text-[11px] text-slate-500">Validation: {credential.validationStatus}{credential.lastValidatedAt ? ` at ${credential.lastValidatedAt}` : ""}</div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || credential.status !== "active"} onClick={() => { void testAutomationCredential(projectId, credential.id).then(load).catch((caught) => setError(messageFrom(caught))); }}>Test</Button>
              <Button size="sm" variant="danger" disabled={busy || credential.status === "revoked"} onClick={() => setPendingAction({ credential, action: "revoke" })}>Revoke</Button>
            </div>
          </div>
          {credential.status === "active" ? <div className="mt-3 flex flex-col gap-2 sm:flex-row"><div className="min-w-0 flex-1"><SecretInput value={replacementValues[credential.id] ?? ""} onChange={(next) => setReplacementValues((current) => ({ ...current, [credential.id]: next }))} disabled={writesDisabled} placeholder="New write-only value" aria-label={`${credential.name} new secret value`} mono /></div><Button size="sm" disabled={writesDisabled || !replacementValues[credential.id]} onClick={() => { void mutateValue(credential, "rotate"); }}>Rotate</Button><Button size="sm" variant="danger" disabled={writesDisabled || !replacementValues[credential.id]} onClick={() => setPendingAction({ credential, action: "replace" })}>Replace</Button></div> : null}
        </li>
      ))}</ul>

      <Dialog isOpen={Boolean(pendingAction)} onClose={() => !busy && setPendingAction(null)} ariaLabel={pendingAction ? `${pendingAction.action} ${pendingAction.credential.name}` : "Confirm credential action"}>
        <div className="space-y-4 p-6">
          <h3 className="text-lg font-bold">Confirm credential {pendingAction?.action}</h3>
          <p className="text-sm text-slate-600 dark:text-slate-300">{pendingAction?.action === "revoke" ? "Revocation immediately prevents future resolution and cannot be undone." : "Replacement overwrites the encrypted value and advances its version."}</p>
          <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setPendingAction(null)}>Cancel</Button><Button variant="danger" disabled={busy} onClick={() => { void confirmPendingAction(); }}>Confirm {pendingAction?.action}</Button></div>
        </div>
      </Dialog>
      {busy ? <ActionFeedbackRegion status="pending" message="Updating credential metadata securely." autoDismiss={false} /> : null}
    </section>
  );
};
