import type { FunctionComponent } from "preact";
import { useEffect, useState } from "preact/hooks";
import type {
  ChatProviderChannelBindingRecord,
  ChatProviderPublicDeliveryRecord,
  ChatProviderVerificationOutcome,
  CreateChatProviderChannelBindingInput,
  UpdateChatProviderChannelBindingInput,
  UpdateChatProviderConnectionInput,
} from "../../../../types.js";
import type { DashboardChatProviderConnectionRecord, DashboardChatProviderSetupDefinition } from "../../../lib/chat-provider-api.js";
import { createDefaultSetupForBridge, findBridgeSchema, getBridgeModeLabel } from "../../../lib/chat-provider-view-models.js";
import { ConfirmDialog } from "../../ui/ConfirmDialog.js";
import { useConfirmDialog } from "../../../hooks/use-confirm-dialog.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { PillChoiceGroup, SecretInput, SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { ChatConnectorLogo } from "./ChatConnectorLogo.js";
import { ChatConnectorVerificationResult } from "./ChatConnectorVerificationResult.js";
import { ChatConnectorBindingEditor } from "./ChatConnectorBindingEditor.js";
import { ChatConnectorDeliveryHistory } from "./ChatConnectorDeliveryHistory.js";
import {
  buildSecretUpdate,
  createConnectionDraft,
  hasMaterialConnectionEdits,
  requiresConnectionChangeConfirmation,
  validateConnectionDraft,
} from "./chat-connector-models.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../../i18n/messages/settings-integrations.js";

export interface ChatConnectorConnectionEditorProps {
  connection: DashboardChatProviderConnectionRecord;
  definition: DashboardChatProviderSetupDefinition;
  bindings: ChatProviderChannelBindingRecord[];
  deliveries: ChatProviderPublicDeliveryRecord[];
  deliveryError?: string;
  verificationOutcome?: ChatProviderVerificationOutcome;
  projectOptions: Array<{ value: string; label: string }>;
  agentPresetOptions: Array<{ value: string; label: string }>;
  pendingAction?: string;
  pendingDeliveries: Record<string, string>;
  onUpdate: (connectionId: string, input: UpdateChatProviderConnectionInput) => Promise<DashboardChatProviderConnectionRecord | null>;
  onDelete: (connectionId: string) => Promise<boolean>;
  onVerify: (connectionId: string) => Promise<ChatProviderVerificationOutcome | null>;
  onCreateBinding: (input: CreateChatProviderChannelBindingInput) => Promise<ChatProviderChannelBindingRecord | null>;
  onUpdateBinding: (bindingId: string, input: UpdateChatProviderChannelBindingInput) => Promise<ChatProviderChannelBindingRecord | null>;
  onDeleteBinding: (bindingId: string) => Promise<boolean>;
  onInspectDelivery: (deliveryId: string) => Promise<ChatProviderPublicDeliveryRecord | null>;
  onRetryDelivery: (deliveryId: string) => Promise<ChatProviderPublicDeliveryRecord | null>;
  onCancelDelivery: (deliveryId: string) => Promise<ChatProviderPublicDeliveryRecord | null>;
}

export const ChatConnectorConnectionEditor: FunctionComponent<ChatConnectorConnectionEditorProps> = (props) => {
  const { translate } = useDashboardI18n();
  const { connection, definition } = props;
  const [draft, setDraft] = useState(() => createConnectionDraft(connection, definition));
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const confirm = useConfirmDialog();
  useEffect(() => {
    setDraft((current) => hasMaterialConnectionEdits(connection, current)
      ? current
      : createConnectionDraft(connection, definition));
  }, [connection.updatedAt, connection.secretVersion, connection.verificationStatus, definition]);
  const bridge = findBridgeSchema(definition, draft.bridgeMode);
  const materialEdits = hasMaterialConnectionEdits(connection, draft);
  const configurationErrors = validateConnectionDraft(connection, definition, { ...draft, status: "draft" });
  const verifyDisabledReason = materialEdits
    ? translate(settingsIntegrationsMessages, "saveChangesBeforeTesting")
    : configurationErrors[0];

  const save = async (): Promise<void> => {
    const issues = validateConnectionDraft(connection, definition, draft);
    if (issues.length > 0) { setValidationErrors(issues); return; }
    const sensitiveChange = requiresConnectionChangeConfirmation(connection, definition, draft);
    if (sensitiveChange.required) {
      const approved = await confirm.requestConfirm({
        title: translate(settingsIntegrationsMessages, "confirmTransportChange", { connection: connection.displayName }),
        body: translate(settingsIntegrationsMessages, "transportChangeBody", { reasons: sensitiveChange.reasons.join(` ${translate(settingsIntegrationsMessages, "and")} `) }),
        confirmLabel: translate(settingsIntegrationsMessages, "saveConnectionChanges"),
        tone: "warning",
      });
      if (!approved) return;
    }
    const secrets = buildSecretUpdate(draft, definition);
    const updated = await props.onUpdate(connection.id, {
      displayName: draft.displayName.trim(),
      bridgeMode: draft.bridgeMode,
      status: materialEdits ? "draft" : draft.status,
      enabled: draft.enabled,
      setup: draft.setup,
      ...(secrets ? { secrets } : {}),
    });
    if (updated) {
      setDraft(createConnectionDraft(updated, definition));
      setValidationErrors([]);
    }
  };

  const deleteConnection = async (): Promise<void> => {
    const approved = await confirm.requestConfirm({ title: translate(settingsIntegrationsMessages, "deleteConnectionTitle", { connection: connection.displayName }), body: translate(settingsIntegrationsMessages, "deleteConnectionBody"), confirmLabel: translate(settingsIntegrationsMessages, "deleteConnection"), destructive: true });
    if (approved) await props.onDelete(connection.id);
  };

  const confirmDeliveryAction = async (delivery: ChatProviderPublicDeliveryRecord, action: "retry" | "cancel"): Promise<void> => {
    const approved = await confirm.requestConfirm({
      title: translate(settingsIntegrationsMessages, action === "retry" ? "retryDeliveryTitle" : "cancelDeliveryTitle"),
      body: translate(settingsIntegrationsMessages, action === "retry" ? "retryDeliveryBody" : "cancelDeliveryBody"),
      confirmLabel: translate(settingsIntegrationsMessages, action === "retry" ? "retryDelivery" : "cancelDelivery"),
      tone: "warning",
    });
    if (approved) await (action === "retry" ? props.onRetryDelivery(delivery.id) : props.onCancelDelivery(delivery.id));
  };

  const getText = (key: string): string => typeof draft.setup[key] === "string" ? draft.setup[key] as string : "";
  return (
    <section aria-label={translate(settingsIntegrationsMessages, "connectionEditorFor", { connection: connection.displayName })} className="min-w-0 overflow-hidden rounded-[1.45rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4 shadow-[var(--elevation-base)] sm:p-5">
      <ConfirmDialog isOpen={confirm.isOpen} options={confirm.options} onConfirm={confirm.handleConfirm} onCancel={confirm.handleCancel} />
      <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3"><ChatConnectorLogo providerKind={connection.providerKind} disabled={!connection.enabled} /><div className="min-w-0"><h3 className="break-words text-sm font-semibold">{connection.displayName}</h3><p className="mt-1 break-words text-xs text-slate-500">{bridge.label}. {translate(settingsIntegrationsMessages, "storedCredentialsWriteOnly")}</p></div></div>
        <div className="flex min-w-0 flex-wrap gap-2"><ActionButton label={translate(settingsIntegrationsMessages, "saveConnection")} tone="primary" onClick={() => void save()} busy={props.pendingAction === "save"} disabled={Boolean(props.pendingAction)} /><ActionButton label={translate(settingsIntegrationsMessages, "testConnection")} tone="success" onClick={() => void props.onVerify(connection.id)} busy={props.pendingAction === "verify"} disabled={Boolean(props.pendingAction) || Boolean(verifyDisabledReason)} disabledReason={verifyDisabledReason} /><ActionButton label={translate(settingsIntegrationsMessages, "deleteConnection")} tone="danger" onClick={() => void deleteConnection()} disabled={Boolean(props.pendingAction)} /></div>
      </div>
      {(definition.officialDocumentation.length > 0 || definition.limitations.length > 0) ? (
        <div className="mt-4 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500 dark:text-slate-400">
          {definition.officialDocumentation.map((document) => (
            <a key={document.url} href={document.url} target="_blank" rel="noreferrer" className="font-semibold text-signal-700 underline-offset-2 hover:underline dark:text-signal-300">{document.label}</a>
          ))}
          {definition.limitations.map((limitation) => <span key={limitation}>{limitation}</span>)}
        </div>
      ) : null}
      {validationErrors.length > 0 ? <div role="alert" aria-live="assertive" className="mt-4 rounded-xl border border-status-red/20 bg-status-red/[0.06] p-3 text-sm font-semibold text-status-red"><ul className="list-disc pl-5">{validationErrors.map((issue) => <li key={issue}>{issue}</li>)}</ul></div> : null}
      <div className="mt-5 grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <div className="grid min-w-0 gap-3 md:grid-cols-2"><label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "displayName")}<TextInput value={draft.displayName} onChange={(displayName) => setDraft({ ...draft, displayName })} aria-label={`${connection.displayName} ${translate(settingsIntegrationsMessages, "displayName")}`} /></label><label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "connectionStatus")}<SelectInput value={draft.status} onChange={(status) => setDraft({ ...draft, status: status as typeof draft.status })} options={["draft","active","disabled","error"].map((value) => ({ value, label: value }))} aria-label={`${connection.displayName} ${translate(settingsIntegrationsMessages, "connectionStatus")}`} /></label></div>
          <div><div className="mb-2 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "connectionMode")}</div><PillChoiceGroup value={draft.bridgeMode} onChange={(mode) => setDraft({ ...draft, bridgeMode: mode as typeof draft.bridgeMode, setup: createDefaultSetupForBridge(definition, mode as typeof draft.bridgeMode), secrets: {} })} options={definition.bridgeModes.map((mode) => ({ value: mode.mode, label: getBridgeModeLabel(mode.mode), hint: mode.label }))} aria-label={`${connection.displayName} ${translate(settingsIntegrationsMessages, "connectionMode")}`} /></div>
          <div className="flex items-center justify-between rounded-xl bg-[var(--fill-muted)] p-3"><span className="text-xs font-semibold">{translate(settingsIntegrationsMessages, "runtimeEnabled")}</span><Toggle value={draft.enabled} onChange={() => setDraft({ ...draft, enabled: !draft.enabled })} aria-label={`${connection.displayName} ${translate(settingsIntegrationsMessages, "enabled")}`} /></div>
          <label className="block min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "ingressUrl")}<TextInput value={connection.ingressUrl} onChange={() => undefined} disabled mono aria-label={`${connection.displayName} ${translate(settingsIntegrationsMessages, "ingressUrl")}`} /></label>
          <fieldset className="min-w-0 rounded-xl border border-[color:var(--border-hairline)] p-4"><legend className="px-1 text-xs font-bold uppercase tracking-[0.14em]">{translate(settingsIntegrationsMessages, "setup")}</legend><div className="grid min-w-0 gap-3 md:grid-cols-2">{bridge.setupFields.map((field) => <label key={field.key} className="min-w-0 text-xs font-bold text-slate-500">{field.label}{field.required ? " *" : ""}{field.type === "boolean" ? <Toggle value={draft.setup[field.key] === true} onChange={() => setDraft({ ...draft, setup: { ...draft.setup, [field.key]: draft.setup[field.key] !== true } })} aria-label={`${connection.displayName} ${field.label}`} /> : field.type === "select" ? <SelectInput value={getText(field.key)} onChange={(value) => setDraft({ ...draft, setup: { ...draft.setup, [field.key]: value } })} options={(field.options ?? []).map((value) => ({ value, label: value }))} aria-label={`${connection.displayName} ${field.label}`} /> : <TextInput value={getText(field.key)} onChange={(value) => setDraft({ ...draft, setup: { ...draft.setup, [field.key]: value } })} mono={field.type === "url" || field.type === "command"} aria-label={`${connection.displayName} ${field.label}`} />}</label>)}</div></fieldset>
          <fieldset className="min-w-0 rounded-xl border border-[color:var(--border-hairline)] p-4"><legend className="px-1 text-xs font-bold uppercase tracking-[0.14em]">{translate(settingsIntegrationsMessages, "writeOnlyCredentials")}</legend><div className="grid min-w-0 gap-3 md:grid-cols-2">{bridge.secretFields.map((field) => { const credential = connection.credentials.find((entry) => entry.key === field.key); return <label key={field.key} className="min-w-0 text-xs font-bold text-slate-500">{field.label}{field.required ? " *" : ""}<SecretInput value={draft.secrets[field.key] ?? ""} onChange={(value) => setDraft({ ...draft, secrets: { ...draft.secrets, [field.key]: value } })} placeholder={translate(settingsIntegrationsMessages, credential?.configured ? "storedSecretUnchanged" : "pasteSecret")} helperText={translate(settingsIntegrationsMessages, credential?.configured ? "configuredReplaceSecret" : "savedValueNeverReturned")} mono aria-label={`${connection.displayName} ${field.label}`} /></label>; })}</div></fieldset>
        </div>
        <ChatConnectorVerificationResult connectionName={connection.displayName} status={connection.verificationStatus} verifiedAt={connection.verifiedAt} outcome={props.verificationOutcome} stale={materialEdits} pending={props.pendingAction === "verify"} />
      </div>
      <div className="mt-6 space-y-4">
        <ChatConnectorDeliveryHistory connectionName={connection.displayName} deliveries={props.deliveries} error={props.deliveryError} pendingDeliveries={props.pendingDeliveries} onInspect={(id) => void props.onInspectDelivery(id)} onRetry={(delivery) => void confirmDeliveryAction(delivery, "retry")} onCancel={(delivery) => void confirmDeliveryAction(delivery, "cancel")} />
        <NoticePanel title={translate(settingsIntegrationsMessages, "channelProjectThreadRouting")}>{translate(settingsIntegrationsMessages, "channelProjectThreadRoutingDescription")}</NoticePanel>
        <ChatConnectorBindingEditor providerKind={connection.providerKind} connectionId={connection.id} connectionName={connection.displayName} projectOptions={props.projectOptions} agentPresetOptions={props.agentPresetOptions} busy={Boolean(props.pendingAction)} onSave={async (input) => Boolean(await props.onCreateBinding(input as CreateChatProviderChannelBindingInput))} />
        {props.bindings.map((binding) => <ChatConnectorBindingEditor key={binding.id} providerKind={connection.providerKind} connectionId={connection.id} connectionName={connection.displayName} binding={binding} projectOptions={props.projectOptions} agentPresetOptions={props.agentPresetOptions} onSave={async (input) => Boolean(await props.onUpdateBinding(binding.id, input as UpdateChatProviderChannelBindingInput))} onDelete={() => void (async () => { const approved = await confirm.requestConfirm({ title: translate(settingsIntegrationsMessages, "deleteBindingTitle", { binding: binding.externalChannelName || binding.externalChannelId }), body: translate(settingsIntegrationsMessages, "deleteBindingBody"), confirmLabel: translate(settingsIntegrationsMessages, "deleteBinding"), destructive: true }); if (approved) await props.onDeleteBinding(binding.id); })()} />)}
      </div>
    </section>
  );
};
