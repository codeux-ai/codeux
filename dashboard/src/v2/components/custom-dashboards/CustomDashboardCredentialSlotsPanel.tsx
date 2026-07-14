import type { FunctionComponent } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CheckCircle2, KeyRound, RefreshCw, Settings, ShieldAlert, Unlink } from "lucide-preact";
import type {
  AutomationCredentialMetadata,
  CredentialBackendHealth,
} from "../../../../../src/contracts/automation-credential-types.js";
import type {
  CustomDashboardCredentialBindingReview,
  CustomDashboardCredentialSlotReview,
} from "../../lib/custom-dashboard-api.js";
import { writeSettingsNavigationState } from "../../lib/settings-navigation-state.js";
import { AvantgardeSelect } from "../ui/AvantgardeSelect.js";
import { useDashboardI18n } from "../../i18n/context.js";
import { customDashboardMessages } from "../../i18n/messages/custom-dashboards.js";

interface CustomDashboardCredentialSlotsPanelProps {
  projectId: string;
  dashboardId: string;
  review: CustomDashboardCredentialBindingReview | null;
  credentials: AutomationCredentialMetadata[];
  health: CredentialBackendHealth | null;
  loading: boolean;
  loadError: string | null;
  savingSlotId: string | null;
  slotErrors: Record<string, string>;
  slotAnnouncements: Record<string, string>;
  onBind: (slotId: string, credentialId: string) => Promise<void>;
  onUnbind: (slotId: string) => Promise<void>;
  onRefresh: () => void;
}

const backendReady = (health: CredentialBackendHealth | null): boolean => Boolean(
  health?.available
  && health.secure
  && health.keyId
  && health.keyVersion !== null,
);

const projectCanUse = (credential: AutomationCredentialMetadata, projectId: string): boolean => (
  credential.scope === "project"
    ? credential.projectId === projectId
    : credential.allowedProjectIds.includes(projectId)
);

const eligibleCredentials = (
  projectId: string,
  credentials: AutomationCredentialMetadata[],
  slotReview: CustomDashboardCredentialSlotReview,
  health: CredentialBackendHealth | null,
): AutomationCredentialMetadata[] => {
  if (!backendReady(health)) return [];
  const compatibleIds = new Set(
    (slotReview.candidates ?? [])
      .filter((candidate) => candidate.compatible)
      .map((candidate) => candidate.credentialId),
  );
  return credentials.filter((credential) => (
    compatibleIds.has(credential.id)
    && credential.status === "active"
    && credential.configured
    && projectCanUse(credential, projectId)
    && slotReview.slot.allowedKinds.includes(credential.kind)
    && slotReview.slot.requiredCapabilities.every((capability) => credential.capabilities.includes(capability))
  ));
};

const MetadataPill: FunctionComponent<{ children: string }> = ({ children }) => (
  <span className="max-w-full break-all rounded-full border border-black/[0.07] bg-white/70 px-2 py-1 text-[11px] font-bold text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.05] dark:text-slate-300">
    {children}
  </span>
);

export const CustomDashboardCredentialSlotsPanel: FunctionComponent<CustomDashboardCredentialSlotsPanelProps> = ({
  projectId,
  dashboardId,
  review,
  credentials,
  health,
  loading,
  loadError,
  savingSlotId,
  slotErrors,
  slotAnnouncements,
  onBind,
  onUnbind,
  onRefresh,
}) => {
  const { translate } = useDashboardI18n();
  const [selectedCredentialBySlot, setSelectedCredentialBySlot] = useState<Record<string, string>>({});
  const actionRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const selectRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setSelectedCredentialBySlot({});
  }, [projectId, dashboardId]);

  const reviewedSlots = review?.slots ?? [];
  const optionsBySlot = useMemo(() => Object.fromEntries(
    reviewedSlots.map((slotReview) => [
      slotReview.slot.slotId,
      eligibleCredentials(projectId, credentials, slotReview, health),
    ]),
  ), [credentials, health, projectId, reviewedSlots]);

  const restoreActionFocus = (slotId: string): void => {
    window.requestAnimationFrame(() => {
      const action = actionRefs.current[slotId];
      const target = action && !action.disabled ? action : selectRefs.current[slotId];
      target?.focus({ preventScroll: true });
    });
  };

  const bind = async (slotId: string): Promise<void> => {
    const credentialId = selectedCredentialBySlot[slotId];
    if (!credentialId) return;
    try {
      await onBind(slotId, credentialId);
    } finally {
      restoreActionFocus(slotId);
    }
  };

  const unbind = async (slotId: string): Promise<void> => {
    try {
      await onUnbind(slotId);
    } finally {
      restoreActionFocus(slotId);
    }
  };

  const renderSettingsLink = () => (
    <a
      href="/config"
      className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-1 font-bold text-signal-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 dark:text-signal-300"
      onClick={() => writeSettingsNavigationState({ activeCategory: "integrations", activeInvocationRoute: "task_coding", focusedSections: {} })}
    >
      <Settings className="h-3.5 w-3.5" aria-hidden="true" />{translate(customDashboardMessages, "manageCredentialsInSettings")}
    </a>
  );

  return (
    <section aria-label={translate(customDashboardMessages, "dashboardCredentialSlots")} className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-signal-600" aria-hidden="true" />
            <h2 className="font-display text-sm font-bold text-slate-900 dark:text-white">{translate(customDashboardMessages, "declaredCredentialSlots")}</h2>
          </div>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500 dark:text-slate-400">
            {translate(customDashboardMessages, "credentialSlotsDescription")}
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-black/[0.08] px-2.5 text-xs font-bold text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 disabled:opacity-50 dark:border-white/[0.08] dark:text-slate-300"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
          {translate(customDashboardMessages, "refresh")}
        </button>
      </div>

      <div className="mt-4" aria-live="polite" aria-atomic="true">
        {loading ? <p role="status" className="rounded-xl bg-black/[0.03] p-3 text-xs text-slate-500 dark:bg-white/[0.04]">{translate(customDashboardMessages, "loadingCredentialMetadata")}</p> : null}
        {!loading && health && !backendReady(health) ? (
          <div role="alert" className="rounded-xl border border-status-amber/25 bg-status-amber/[0.07] p-3 text-xs leading-relaxed text-status-amber">
            <div className="flex gap-2">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-bold">{translate(customDashboardMessages, "secureCredentialCustodyUnavailable")}</p>
                <p className="mt-1">{health.reason ?? translate(customDashboardMessages, "restoreCredentialBackend")}</p>
                {renderSettingsLink()}
              </div>
            </div>
          </div>
        ) : null}
        {!loading && loadError ? (
          <div role="alert" className="rounded-xl border border-status-red/25 bg-status-red/[0.06] p-3 text-xs leading-relaxed text-status-red">
            <p>{loadError}</p>
            {renderSettingsLink()}
          </div>
        ) : null}
        {!loading && review ? (
          <div className={`rounded-xl border px-3 py-2 text-xs font-bold ${
            review.valid
              ? "border-status-green/25 bg-status-green/[0.07] text-status-green"
              : "border-status-amber/25 bg-status-amber/[0.07] text-status-amber"
          }`}>
            {review.valid
              ? translate(customDashboardMessages, "credentialDeclarationsReady")
              : translate(customDashboardMessages, "credentialDeclarationsNeedAttention")}
          </div>
        ) : null}
      </div>

      <div className="mt-3 grid min-w-0 gap-3">
        {reviewedSlots.map((slotReview) => {
          const slot = slotReview.slot;
          const options = optionsBySlot[slot.slotId] ?? [];
          const current = slotReview.metadata;
          const selectedCredentialId = selectedCredentialBySlot[slot.slotId] ?? "";
          const saving = savingSlotId === slot.slotId;
          const hasReplacement = options.some((credential) => credential.id !== slotReview.binding?.credentialId);
          const issueMessages = slotReview.issues.map((issue) => issue.message);
          const error = slotErrors[slot.slotId];
          const announcement = slotAnnouncements[slot.slotId];
          return (
            <article key={slot.slotId} className="min-w-0 overflow-hidden rounded-[1rem] border border-black/[0.08] bg-white/60 p-3 dark:border-white/[0.08] dark:bg-white/[0.035]">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="break-words text-sm font-bold text-slate-900 dark:text-white">{slot.label}</h3>
                  <p className="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">{translate(customDashboardMessages, "slotId", { id: slot.slotId })}</p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <MetadataPill>{translate(customDashboardMessages, slot.phase === "build" ? "buildPhase" : "runtimePhase")}</MetadataPill>
                  <MetadataPill>{translate(customDashboardMessages, slot.required ? "required" : "optional")}</MetadataPill>
                </div>
              </div>

              <dl className="mt-3 grid min-w-0 gap-2 text-xs sm:grid-cols-2">
                <div className="min-w-0"><dt className="font-bold text-slate-500">{translate(customDashboardMessages, "allowedKinds")}</dt><dd className="mt-1 break-words text-slate-700 dark:text-slate-200">{slot.allowedKinds.join(", ")}</dd></div>
                <div className="min-w-0"><dt className="font-bold text-slate-500">{translate(customDashboardMessages, "requiredCapabilities")}</dt><dd className="mt-1 break-words text-slate-700 dark:text-slate-200">{slot.requiredCapabilities.join(", ") || translate(customDashboardMessages, "none")}</dd></div>
              </dl>

              <div className="mt-3 rounded-xl border border-black/[0.06] bg-black/[0.025] p-3 dark:border-white/[0.06] dark:bg-white/[0.025]">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">{translate(customDashboardMessages, "currentCredentialMetadata")}</p>
                {current ? (
                  <div className="mt-2 min-w-0">
                    <p className="break-words text-sm font-bold text-slate-800 dark:text-slate-100">{current.name}</p>
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">
                      {current.kind} · {current.status} · {translate(customDashboardMessages, current.configured ? "configured" : "notConfigured")}
                    </p>
                    <p className="mt-1 break-words text-xs text-slate-500 dark:text-slate-400">{translate(customDashboardMessages, "capabilitiesPrefix")} {current.capabilities.join(", ") || translate(customDashboardMessages, "noneLower")}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{translate(customDashboardMessages, "noCredentialBound")}</p>
                )}
              </div>

              {issueMessages.length > 0 ? (
                <div role="alert" className="mt-3 rounded-xl border border-status-amber/25 bg-status-amber/[0.07] p-3 text-xs leading-relaxed text-status-amber">
                  {issueMessages.join(" ")}
                </div>
              ) : null}
              {error ? <div role="alert" className="mt-3 rounded-xl border border-status-red/25 bg-status-red/[0.06] p-3 text-xs leading-relaxed text-status-red">{error}</div> : null}
              <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{saving ? translate(customDashboardMessages, "savingSlotBinding", { slot: slot.label }) : announcement ?? ""}</p>

              <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <label className="min-w-0 text-xs font-bold text-slate-600 dark:text-slate-300">
                  {translate(customDashboardMessages, "compatibleCredential")}
                  <AvantgardeSelect
                    triggerRef={(element) => { selectRefs.current[slot.slotId] = element; }}
                    aria-label={translate(customDashboardMessages, "compatibleCredentialFor", { slot: slot.label })}
                    value={selectedCredentialId}
                    disabled={saving || options.length === 0 || !backendReady(health)}
                    onChange={(value) => setSelectedCredentialBySlot((currentSelections) => ({
                      ...currentSelections,
                      [slot.slotId]: value,
                    }))}
                    className="mt-1 w-full min-w-0"
                    placeholder={translate(customDashboardMessages, "chooseCompatibleMetadata")}
                    options={[
                      { value: "", label: translate(customDashboardMessages, "chooseCompatibleMetadata") },
                      ...options.map((credential) => ({ value: credential.id, label: `${credential.name} · ${credential.kind}` })),
                    ]}
                  />
                </label>
                <button
                  ref={(element) => { actionRefs.current[slot.slotId] = element; }}
                  type="button"
                  aria-label={translate(customDashboardMessages, slotReview.binding ? "replaceBindingFor" : "bindCredentialFor", { slot: slot.label })}
                  disabled={saving || !selectedCredentialId || selectedCredentialId === slotReview.binding?.credentialId}
                  onClick={() => void bind(slot.slotId)}
                  className="self-end inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-signal-500 px-3 text-xs font-bold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 focus-visible:ring-offset-2 disabled:opacity-50 dark:text-void-900"
                >
                  <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
                  {translate(customDashboardMessages, saving ? "saving" : slotReview.binding ? "replaceBinding" : "bindCredential")}
                </button>
              </div>

              {!loading && !hasReplacement ? (
                <div className="mt-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                  <p>{translate(customDashboardMessages, slotReview.binding ? "noOtherCredentialMatches" : "noCredentialMatches")}</p>
                  {renderSettingsLink()}
                </div>
              ) : null}

              {slotReview.binding ? (
                <button
                  type="button"
                  aria-label={translate(customDashboardMessages, "unbindCredentialFor", { slot: slot.label })}
                  disabled={saving}
                  onClick={() => void unbind(slot.slotId)}
                  className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-status-red/25 px-2.5 text-xs font-bold text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-status-red/40 disabled:opacity-50"
                >
                  <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
                  {translate(customDashboardMessages, "unbindCredential")}
                </button>
              ) : null}
              {slotReview.binding && slot.required ? (
                <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-status-amber">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  {translate(customDashboardMessages, "unbindRequiredWarning")}
                </p>
              ) : null}
              {slotReview.compatible && slotReview.binding ? (
                <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-status-green">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />{translate(customDashboardMessages, "compatibleBinding")}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
};
