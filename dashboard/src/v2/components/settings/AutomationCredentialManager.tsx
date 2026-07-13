import type { FunctionComponent } from "preact";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-preact";
import type {
  AutomationCredentialCapability,
  AutomationCredentialMetadata,
  AutomationCredentialScope,
  CredentialBackendHealth,
} from "../../../../../src/contracts/automation-credential-types.js";
import {
  createAutomationCredential,
  fetchAutomationCredentials,
  fetchCredentialHealth,
  promoteAutomationCredential,
  replaceAutomationCredential,
  restrictAutomationCredential,
  revokeAutomationCredential,
  rotateAutomationCredential,
  testAutomationCredential,
  toAutomationCredentialApiError,
  updateAutomationCredential,
} from "../../lib/automation-credential-api.js";
import { useConfirmDialog } from "../../hooks/use-confirm-dialog.js";
import { ConfirmDialog } from "../ui/ConfirmDialog.js";

interface ProjectOption {
  id: string;
  name: string;
}

interface AutomationCredentialManagerProps {
  projectId: string;
  projects?: ProjectOption[];
}

type Feedback = { tone: "success" | "error"; message: string };

const CAPABILITIES: ReadonlyArray<{ value: AutomationCredentialCapability; label: string; description: string }> = [
  { value: "read", label: "Read", description: "Allow consumers to read from the connected service." },
  { value: "write", label: "Write", description: "Allow consumers to create or change remote data." },
  { value: "admin", label: "Admin", description: "Allow explicitly approved administrative operations." },
];

const inputClassName = "mt-1.5 w-full min-w-0 rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-void-900 dark:text-slate-100";
const buttonClassName = "inline-flex min-h-9 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-black/20 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-45 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200 dark:hover:bg-white/[0.09]";

const isBackendReady = (health: CredentialBackendHealth | null): boolean => Boolean(
  health?.available
  && health.secure
  && typeof health.keyId === "string"
  && health.keyId.length > 0
  && health.keyVersion !== null,
);

const toggleValue = (values: string[], value: string): string[] => (
  values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value]
);

const FeedbackMessage: FunctionComponent<{ feedback?: Feedback }> = ({ feedback }) => feedback ? (
  <p
    role={feedback.tone === "error" ? "alert" : "status"}
    aria-live="polite"
    className={`mt-3 text-xs font-semibold ${feedback.tone === "error" ? "text-status-red" : "text-status-green"}`}
  >
    {feedback.message}
  </p>
) : null;

const CapabilityPicker: FunctionComponent<{
  legend: string;
  values: string[];
  available?: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}> = ({ legend, values, available, disabled, onChange }) => {
  const options = available
    ? CAPABILITIES.filter((option) => available.includes(option.value))
    : CAPABILITIES;
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-xs font-bold text-slate-700 dark:text-slate-200">{legend}</legend>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.value} className="flex min-w-0 cursor-pointer gap-2 rounded-xl border border-black/[0.07] bg-white/65 p-3 text-xs focus-within:ring-2 focus-within:ring-signal-500/40 dark:border-white/[0.08] dark:bg-white/[0.035]">
            <input
              type="checkbox"
              value={option.value}
              checked={values.includes(option.value)}
              onChange={() => onChange(toggleValue(values, option.value))}
              className="mt-0.5 h-4 w-4 shrink-0 accent-signal-600"
            />
            <span className="min-w-0">
              <span className="block font-bold text-slate-700 dark:text-slate-200">{option.label}</span>
              <span className="mt-0.5 block leading-relaxed text-slate-500 dark:text-slate-400">{option.description}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
};

const ProjectPicker: FunctionComponent<{
  legend: string;
  projects: ProjectOption[];
  values: string[];
  requiredProjectId: string;
  availableProjectIds?: string[];
  disabled?: boolean;
  onChange: (values: string[]) => void;
}> = ({ legend, projects, values, requiredProjectId, availableProjectIds, disabled, onChange }) => (
  <fieldset disabled={disabled} className="min-w-0">
    <legend className="text-xs font-bold text-slate-700 dark:text-slate-200">{legend}</legend>
    <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">The managing project is always retained. Select every additional project that may use this credential.</p>
    <div className="mt-2 grid max-h-44 gap-2 overflow-y-auto rounded-xl border border-black/[0.07] bg-white/55 p-2 sm:grid-cols-2 dark:border-white/[0.08] dark:bg-white/[0.025]">
      {projects.filter((project) => !availableProjectIds || availableProjectIds.includes(project.id)).map((project) => {
        const required = project.id === requiredProjectId;
        return (
          <label key={project.id} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs focus-within:ring-2 focus-within:ring-signal-500/40">
            <input
              type="checkbox"
              checked={required || values.includes(project.id)}
              disabled={disabled || required}
              onChange={() => onChange(toggleValue(values, project.id))}
              className="mt-0.5 h-4 w-4 shrink-0 accent-signal-600"
            />
            <span className="min-w-0 break-words font-semibold text-slate-700 dark:text-slate-200">
              {project.name || project.id}{required ? " (managing project)" : ""}
            </span>
          </label>
        );
      })}
    </div>
  </fieldset>
);

export const AutomationCredentialManager: FunctionComponent<AutomationCredentialManagerProps> = ({ projectId, projects = [] }) => {
  const [credentials, setCredentials] = useState<AutomationCredentialMetadata[]>([]);
  const [health, setHealth] = useState<CredentialBackendHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [createFeedback, setCreateFeedback] = useState<Feedback | undefined>();
  const [name, setName] = useState("");
  const [kind, setKind] = useState("");
  const [scope, setScope] = useState<AutomationCredentialScope>("project");
  const [value, setValue] = useState("");
  const [createCapabilities, setCreateCapabilities] = useState<string[]>([]);
  const [createAllowedProjects, setCreateAllowedProjects] = useState<string[]>([projectId]);
  const [nameDrafts, setNameDrafts] = useState<Record<string, string>>({});
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [restrictionCapabilities, setRestrictionCapabilities] = useState<Record<string, string[]>>({});
  const [restrictionProjects, setRestrictionProjects] = useState<Record<string, string[]>>({});
  const [promotionProjects, setPromotionProjects] = useState<Record<string, string[]>>({});
  const secretContainerRef = useRef<HTMLDivElement>(null);
  const confirm = useConfirmDialog();

  const projectOptions = useMemo<ProjectOption[]>(() => {
    const byId = new Map(projects.map((project) => [project.id, project]));
    if (!byId.has(projectId)) byId.set(projectId, { id: projectId, name: "Selected project" });
    for (const credential of credentials) {
      for (const allowedProjectId of credential.allowedProjectIds) {
        if (!byId.has(allowedProjectId)) byId.set(allowedProjectId, { id: allowedProjectId, name: allowedProjectId });
      }
    }
    return [...byId.values()];
  }, [credentials, projectId, projects]);

  const clearSecretFields = useCallback((): void => {
    setValue("");
    setSecretDrafts({});
    secretContainerRef.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
      input.value = "";
    });
  }, []);

  const applyCredentials = useCallback((nextCredentials: AutomationCredentialMetadata[]): void => {
    setCredentials(nextCredentials);
    setNameDrafts(Object.fromEntries(nextCredentials.map((credential) => [credential.id, credential.name])));
    setRestrictionCapabilities(Object.fromEntries(nextCredentials.map((credential) => [credential.id, [...credential.capabilities]])));
    setRestrictionProjects(Object.fromEntries(nextCredentials.map((credential) => [credential.id, [...credential.allowedProjectIds]])));
    setPromotionProjects(Object.fromEntries(nextCredentials.map((credential) => [credential.id, [projectId]])));
  }, [projectId]);

  const load = useCallback(async (announce = false): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextCredentials, nextHealth] = await Promise.all([
        fetchAutomationCredentials(projectId),
        fetchCredentialHealth(),
      ]);
      applyCredentials(nextCredentials);
      setHealth(nextHealth);
      if (announce) setCreateFeedback({ tone: "success", message: "Credential metadata refreshed." });
    } catch (error) {
      setLoadError(toAutomationCredentialApiError(error).message);
    } finally {
      setLoading(false);
    }
  }, [applyCredentials, projectId]);

  useEffect(() => {
    clearSecretFields();
    setCreateAllowedProjects([projectId]);
    setFeedback({});
    setCreateFeedback(undefined);
    void load();
    return () => {
      secretContainerRef.current?.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
        input.value = "";
      });
    };
  }, [clearSecretFields, load, projectId]);

  const setCredentialFeedback = (credentialId: string, next: Feedback): void => {
    setFeedback((current) => ({ ...current, [credentialId]: next }));
  };

  const runMutation = async (
    credential: AutomationCredentialMetadata,
    action: string,
    successMessage: string,
    operation: () => Promise<AutomationCredentialMetadata>,
  ): Promise<void> => {
    setBusyAction(`${credential.id}:${action}`);
    setFeedback((current) => {
      const next = { ...current };
      delete next[credential.id];
      return next;
    });
    try {
      const updated = await operation();
      applyCredentials(credentials.map((entry) => entry.id === updated.id ? updated : entry));
      setCredentialFeedback(credential.id, { tone: "success", message: successMessage });
    } catch (error) {
      const apiError = toAutomationCredentialApiError(error);
      if (apiError.code === "stale_version") await load();
      setCredentialFeedback(credential.id, { tone: "error", message: apiError.message });
    } finally {
      setBusyAction(null);
    }
  };

  const submitCreate = async (): Promise<void> => {
    setCreateFeedback(undefined);
    try {
      if (!name.trim()) {
        setCreateFeedback({ tone: "error", message: "Enter a clear credential name." });
        return;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(kind.trim())) {
        setCreateFeedback({ tone: "error", message: "Enter a kind using letters, numbers, dots, underscores, colons, or hyphens." });
        return;
      }
      if (!value) {
        setCreateFeedback({ tone: "error", message: "Enter the write-only secret value." });
        return;
      }
      if (createCapabilities.length === 0) {
        setCreateFeedback({ tone: "error", message: "Select at least one capability deliberately." });
        return;
      }
      if (scope === "global") {
        const confirmed = await confirm.requestConfirm({
          title: "Create a globally accessible credential?",
          body: "Every selected project will be able to use this credential. The selected project remains the only management owner.",
          confirmLabel: "Create global credential",
          tone: "warning",
        });
        if (!confirmed) return;
      }
      setBusyAction("create");
      await createAutomationCredential(projectId, {
        name: name.trim(),
        kind: kind.trim(),
        value,
        scope,
        allowedProjectIds: scope === "global" ? [...new Set([projectId, ...createAllowedProjects])] : [],
        capabilities: createCapabilities,
      });
      setName("");
      setKind("");
      setScope("project");
      setCreateCapabilities([]);
      setCreateAllowedProjects([projectId]);
      setCreateFeedback({ tone: "success", message: "Credential stored. Its secret value is no longer present in this page." });
      await load();
    } catch (error) {
      const apiError = toAutomationCredentialApiError(error);
      setCreateFeedback({ tone: "error", message: apiError.message });
    } finally {
      clearSecretFields();
      setBusyAction(null);
    }
  };

  const confirmMutation = async (options: Parameters<typeof confirm.requestConfirm>[0], operation: () => Promise<void>): Promise<void> => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const restoreFocus = (): void => {
      const triggerDisabled = trigger instanceof HTMLButtonElement && trigger.disabled;
      const target = !triggerDisabled
        ? trigger
        : trigger?.closest("li")?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)') ?? null;
      target?.focus({ preventScroll: true });
    };
    try {
      if (await confirm.requestConfirm(options)) await operation();
    } finally {
      window.setTimeout(restoreFocus, 0);
      // ConfirmDialog completes its exit animation after the promise resolves.
      // Re-apply focus after that cleanup so a re-rendered lifecycle control wins over the portal fallback.
      window.setTimeout(restoreFocus, 400);
    }
  };

  const backendReady = isBackendReady(health);
  const configuredCount = credentials.filter((credential) => credential.configured && credential.status === "active").length;

  return (
    <div ref={secretContainerRef} className="space-y-5" aria-busy={loading ? "true" : undefined}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id="credential-manager-title" className="text-base font-bold text-slate-900 dark:text-slate-100">Automation credential management</h3>
            {!loading && backendReady ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-status-green/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-status-green"><ShieldCheck className="h-3 w-3" />Secure storage ready</span>
            ) : null}
          </div>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">Create project-owned or explicitly allowlisted credentials. Secret values are write-only; this page retains only non-secret metadata.</p>
        </div>
        <button type="button" className={buttonClassName} disabled={loading} onClick={() => void load(true)} aria-label="Refresh automation credentials">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
        </button>
      </div>

      {loading && credentials.length === 0 ? (
        <div role="status" className="flex items-center gap-2 rounded-xl border border-black/[0.07] bg-black/[0.02] p-4 text-sm text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03]"><Loader2 className="h-4 w-4 animate-spin" />Loading credential health and project-visible metadata…</div>
      ) : null}
      {loadError ? (
        <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.07] p-4 text-sm font-semibold text-status-red">{loadError}</div>
      ) : null}
      {!loading && health && !backendReady ? (
        <div role="alert" className="flex items-start gap-3 rounded-xl border border-status-amber/25 bg-status-amber/[0.08] p-4 text-sm text-amber-900 dark:text-amber-100">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div><div className="font-bold">Secure credential storage is unavailable</div><p className="mt-1 text-xs leading-relaxed">{health.reason || "Restore the configured secure key provider and refresh this page. Existing metadata remains visible, but secret-bearing changes and tests are disabled."}</p></div>
        </div>
      ) : null}
      {!loading && backendReady && credentials.length === 0 ? (
        <div role="status" className="rounded-xl border border-signal-500/20 bg-signal-500/[0.06] p-4 text-sm text-slate-700 dark:text-slate-200"><strong>Ready, not configured.</strong> Store the first credential below and grant only the capabilities its automation consumer requires.</div>
      ) : null}
      {!loading && backendReady && configuredCount > 0 ? (
        <div role="status" className="rounded-xl border border-status-green/20 bg-status-green/[0.06] p-4 text-sm text-slate-700 dark:text-slate-200"><strong>Configured.</strong> {configuredCount} active credential{configuredCount === 1 ? " is" : "s are"} ready for compatible project automation.</div>
      ) : null}

      <section aria-labelledby="create-credential-title" className="rounded-[1.25rem] border border-black/[0.07] bg-black/[0.02] p-4 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.025]">
        <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-signal-600" /><h4 id="create-credential-title" className="text-sm font-bold text-slate-800 dark:text-slate-100">Store a credential</h4></div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <label className="min-w-0 text-xs font-bold text-slate-700 dark:text-slate-200">Name<input aria-label="Credential name" value={name} onInput={(event) => setName(event.currentTarget.value)} maxLength={128} disabled={!backendReady || busyAction !== null} className={inputClassName} /></label>
          <label className="min-w-0 text-xs font-bold text-slate-700 dark:text-slate-200">Kind<input aria-label="Credential kind" value={kind} onInput={(event) => setKind(event.currentTarget.value)} placeholder="api-token" maxLength={128} disabled={!backendReady || busyAction !== null} className={inputClassName} /></label>
          <label className="min-w-0 text-xs font-bold text-slate-700 dark:text-slate-200">Scope<select aria-label="Credential scope" value={scope} onChange={(event) => setScope(event.currentTarget.value as AutomationCredentialScope)} disabled={!backendReady || busyAction !== null} className={inputClassName}><option value="project">Project-owned</option><option value="global">Global with allowlist</option></select></label>
          <label className="min-w-0 text-xs font-bold text-slate-700 dark:text-slate-200 lg:col-span-3">Secret value<span className="ml-1 font-medium text-slate-400">write-only</span><input aria-label="Secret value" type="password" autoComplete="new-password" value={value} onInput={(event) => setValue(event.currentTarget.value)} disabled={!backendReady || busyAction !== null} className={inputClassName} /></label>
        </div>
        <div className="mt-4"><CapabilityPicker legend="Capabilities" values={createCapabilities} onChange={setCreateCapabilities} disabled={!backendReady || busyAction !== null} /></div>
        {scope === "global" ? <div className="mt-4"><ProjectPicker legend="Allowed projects" projects={projectOptions} values={createAllowedProjects} requiredProjectId={projectId} onChange={setCreateAllowedProjects} disabled={!backendReady || busyAction !== null} /></div> : null}
        <button type="button" disabled={!backendReady || busyAction !== null} onClick={() => void submitCreate()} className={`${buttonClassName} mt-4 border-signal-500/30 bg-signal-600 text-white hover:bg-signal-700 dark:bg-signal-500 dark:text-void-950`}><Plus className="h-4 w-4" />{busyAction === "create" ? "Storing…" : "Store credential"}</button>
        <FeedbackMessage feedback={createFeedback} />
      </section>

      <section aria-labelledby="visible-credentials-title">
        <h4 id="visible-credentials-title" className="text-sm font-bold text-slate-800 dark:text-slate-100">Visible to this project</h4>
        {credentials.length === 0 && !loading ? <p className="mt-2 text-xs text-slate-500">No credential metadata is visible to this project.</p> : null}
        <ul className="mt-3 space-y-4">
          {credentials.map((credential) => {
            const canManage = credential.managementProjectId === projectId;
            const disabled = busyAction !== null || !canManage;
            const secret = secretDrafts[credential.id] || "";
            const statusTone = credential.status === "active" && credential.configured ? "text-status-green" : "text-status-amber";
            return (
              <li key={credential.id} className="min-w-0 overflow-hidden rounded-[1.25rem] border border-black/[0.07] bg-white/75 p-4 sm:p-5 dark:border-white/[0.08] dark:bg-white/[0.025]">
                <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><KeyRound className="h-4 w-4 shrink-0 text-signal-600" /><h5 className="min-w-0 break-words text-sm font-bold text-slate-900 dark:text-slate-100">{credential.name}</h5><span className={`text-[10px] font-bold uppercase tracking-wide ${statusTone}`}>{credential.status}</span></div>
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{credential.kind} · {credential.scope === "project" ? "Project-owned" : "Globally accessible"} · metadata version {credential.version}</p>
                  </div>
                  <span className={`w-fit rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wide ${canManage ? "bg-signal-500/10 text-signal-700 dark:text-signal-300" : "bg-slate-500/10 text-slate-500"}`}>{canManage ? "Managed here" : "Use only"}</span>
                </div>
                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div className="min-w-0 rounded-xl bg-black/[0.025] p-3 dark:bg-white/[0.035]"><strong className="block text-slate-700 dark:text-slate-200">Capabilities</strong><span className="mt-1 block break-words text-slate-500">{credential.capabilities.length ? credential.capabilities.join(", ") : "None"}</span></div>
                  <div className="min-w-0 rounded-xl bg-black/[0.025] p-3 dark:bg-white/[0.035]"><strong className="block text-slate-700 dark:text-slate-200">Project access</strong><span className="mt-1 block break-words text-slate-500">{credential.scope === "project" ? "Owning project only" : credential.allowedProjectIds.join(", ") || "No projects"}</span></div>
                </div>
                {!canManage ? <p className="mt-3 rounded-xl border border-status-amber/20 bg-status-amber/[0.06] p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-100">This globally accessible credential is managed by another project. You may use it where compatible, but management actions are disabled here.</p> : null}

                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="min-w-0 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.07]">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-200">Display name<input aria-label={`Rename ${credential.name}`} value={nameDrafts[credential.id] ?? credential.name} onInput={(event) => setNameDrafts((current) => ({ ...current, [credential.id]: event.currentTarget.value }))} disabled={disabled} className={inputClassName} /></label>
                    <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={buttonClassName} disabled={disabled || !(nameDrafts[credential.id] || "").trim()} onClick={() => void runMutation(credential, "rename", "Credential name updated.", () => updateAutomationCredential(projectId, credential.id, { name: nameDrafts[credential.id].trim(), expectedVersion: credential.version }))}><Pencil className="h-3.5 w-3.5" />Save name</button><button type="button" className={buttonClassName} disabled={disabled || !backendReady || credential.status !== "active"} onClick={() => void runMutation(credential, "test", "Credential test passed.", () => testAutomationCredential(projectId, credential.id, { expectedVersion: credential.version }))}><CheckCircle2 className="h-3.5 w-3.5" />Test</button></div>
                  </div>

                  <div className="min-w-0 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.07]">
                    <label className="text-xs font-bold text-slate-700 dark:text-slate-200">New secret value<span className="ml-1 font-medium text-slate-400">write-only</span><input aria-label={`New secret for ${credential.name}`} type="password" autoComplete="new-password" value={secret} onInput={(event) => setSecretDrafts((current) => ({ ...current, [credential.id]: event.currentTarget.value }))} disabled={disabled || !backendReady || credential.status === "revoked"} className={inputClassName} /></label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className={buttonClassName} disabled={disabled || !backendReady || !secret || credential.status !== "active"} onClick={() => void confirmMutation({ title: `Rotate ${credential.name}?`, body: "The current value will stop working immediately after the new write-only value is stored.", confirmLabel: "Rotate value", tone: "warning" }, async () => { try { await runMutation(credential, "rotate", "Credential value rotated and cleared from this page.", () => rotateAutomationCredential(projectId, credential.id, { value: secret, expectedVersion: credential.version })); } finally { clearSecretFields(); } })}><RotateCw className="h-3.5 w-3.5" />Rotate</button>
                      <button type="button" className={buttonClassName} disabled={disabled || !backendReady || !secret || credential.status === "revoked"} onClick={() => void confirmMutation({ title: `Replace ${credential.name}?`, body: "Use replacement to recover invalid encrypted state. The previous value will stop working immediately.", confirmLabel: "Replace value", tone: "warning" }, async () => { try { await runMutation(credential, "replace", "Credential value replaced and cleared from this page.", () => replaceAutomationCredential(projectId, credential.id, { value: secret, expectedVersion: credential.version })); } finally { clearSecretFields(); } })}>Replace</button>
                    </div>
                  </div>
                </div>

                {canManage && credential.status !== "revoked" ? (
                  <div className="mt-4 rounded-xl border border-black/[0.06] p-3 dark:border-white/[0.07]">
                    <CapabilityPicker legend="Restrict capabilities" values={restrictionCapabilities[credential.id] || []} available={credential.capabilities} onChange={(values) => setRestrictionCapabilities((current) => ({ ...current, [credential.id]: values }))} disabled={busyAction !== null} />
                    {credential.scope === "global" ? <div className="mt-4"><ProjectPicker legend="Restrict allowed projects" projects={projectOptions} values={restrictionProjects[credential.id] || []} requiredProjectId={projectId} availableProjectIds={credential.allowedProjectIds} onChange={(values) => setRestrictionProjects((current) => ({ ...current, [credential.id]: values }))} disabled={busyAction !== null} /></div> : null}
                    <button
                      type="button"
                      className={`${buttonClassName} mt-3`}
                      disabled={busyAction !== null}
                      onClick={() => void confirmMutation(
                        {
                          title: `Restrict ${credential.name}?`,
                          body: "Removed capabilities and project access cannot be restored by restriction. Create or promote a credential for broader access.",
                          confirmLabel: "Apply restriction",
                          tone: "warning",
                        },
                        () => runMutation(
                          credential,
                          "restrict",
                          "Credential access was restricted.",
                          () => restrictAutomationCredential(projectId, credential.id, {
                            expectedVersion: credential.version,
                            capabilities: restrictionCapabilities[credential.id] || [],
                            allowedProjectIds: credential.scope === "global" ? restrictionProjects[credential.id] || [projectId] : [],
                          }),
                        ),
                      )}
                    >Apply restriction</button>
                  </div>
                ) : null}

                {canManage && credential.scope === "project" && credential.status === "active" ? (
                  <div className="mt-4 rounded-xl border border-signal-500/15 bg-signal-500/[0.035] p-3">
                    <ProjectPicker legend="Promote to global access" projects={projectOptions} values={promotionProjects[credential.id] || [projectId]} requiredProjectId={projectId} onChange={(values) => setPromotionProjects((current) => ({ ...current, [credential.id]: values }))} disabled={busyAction !== null || !backendReady} />
                    <button
                      type="button"
                      className={`${buttonClassName} mt-3`}
                      disabled={busyAction !== null || !backendReady}
                      onClick={() => void confirmMutation(
                        {
                          title: `Promote ${credential.name} to global access?`,
                          body: "Every selected project will gain access. This project remains the only management owner.",
                          confirmLabel: "Promote credential",
                          tone: "warning",
                        },
                        () => runMutation(
                          credential,
                          "promote",
                          "Credential promoted with the confirmed project allowlist.",
                          () => promoteAutomationCredential(projectId, credential.id, {
                            expectedVersion: credential.version,
                            allowedProjectIds: [...new Set([projectId, ...(promotionProjects[credential.id] || [])])],
                            confirmScopeExpansion: true,
                          }),
                        ),
                      )}
                    >Promote credential</button>
                  </div>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-black/[0.06] pt-4 dark:border-white/[0.07]">
                  <button type="button" className={`${buttonClassName} border-status-red/25 text-status-red`} disabled={disabled || credential.status === "revoked"} onClick={() => void confirmMutation({ title: `Revoke ${credential.name}?`, body: "Automation consumers will permanently lose access. Revoked credentials cannot be reactivated.", confirmLabel: "Revoke credential", destructive: true, requiredConfirmationText: "REVOKE" }, () => runMutation(credential, "revoke", "Credential revoked.", () => revokeAutomationCredential(projectId, credential.id, { expectedVersion: credential.version })))}><Trash2 className="h-3.5 w-3.5" />Revoke</button>
                  {busyAction?.startsWith(`${credential.id}:`) ? <span role="status" className="inline-flex items-center gap-1 text-xs text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" />Applying credential change…</span> : null}
                </div>
                <FeedbackMessage feedback={feedback[credential.id]} />
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog isOpen={confirm.isOpen} options={confirm.options} onConfirm={confirm.handleConfirm} onCancel={confirm.handleCancel} />
    </div>
  );
};
