import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ChatProviderChannelBindingRecord, ChatProviderKind, CreateChatProviderChannelBindingInput, UpdateChatProviderChannelBindingInput } from "../../../../types.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { buildRoutingHints, createBindingDraft, createNewBindingDraft } from "./chat-connector-models.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { settingsIntegrationsMessages } from "../../../i18n/messages/settings-integrations.js";

export const ChatConnectorBindingEditor: FunctionComponent<{
  providerKind: ChatProviderKind;
  connectionId: string;
  connectionName: string;
  binding?: ChatProviderChannelBindingRecord;
  projectOptions: Array<{ value: string; label: string }>;
  agentPresetOptions: Array<{ value: string; label: string }>;
  busy?: boolean;
  onSave: (input: CreateChatProviderChannelBindingInput | UpdateChatProviderChannelBindingInput) => Promise<boolean>;
  onDelete?: () => void;
}> = ({ providerKind, connectionId, connectionName, binding, projectOptions, agentPresetOptions, busy = false, onSave, onDelete }) => {
  const { translate } = useDashboardI18n();
  const [draft, setDraft] = useState(() => binding ? createBindingDraft(binding) : createNewBindingDraft(projectOptions[0]?.value ?? ""));
  const [validationError, setValidationError] = useState<string | null>(null);
  const identifierLabel = translate(settingsIntegrationsMessages, providerKind === "discord" ? "discordChannelId" : providerKind === "whatsapp" ? "whatsappConversationId" : providerKind === "imessage" ? "imessageChatGuid" : providerKind === "telegram" ? "telegramChatId" : providerKind === "slack" ? "slackChannelId" : "teamsConversationId");
  const save = async (): Promise<void> => {
    if (!draft.externalChannelId.trim() || !draft.projectId.trim()) {
      setValidationError(translate(settingsIntegrationsMessages, "channelAndProjectRequired", { channel: identifierLabel }));
      return;
    }
    setValidationError(null);
    const common = {
      externalChannelName: draft.externalChannelName.trim() || draft.externalChannelId.trim(),
      projectId: draft.projectId,
      agentPresetId: draft.agentPresetId || null,
      routingHints: buildRoutingHints(draft),
      enabled: draft.enabled,
      inboundEnabled: draft.inboundEnabled,
      outboundEnabled: draft.outboundEnabled,
      suppressRichWidgets: draft.suppressRichWidgets,
    };
    const saved = await onSave(binding ? common : {
      ...common,
      providerConnectionId: connectionId,
      externalChannelId: draft.externalChannelId.trim(),
    });
    if (saved && !binding) setDraft(createNewBindingDraft(projectOptions[0]?.value ?? ""));
  };
  const channelLabel = binding?.externalChannelId ?? connectionName;
  return (
    <section aria-label={translate(settingsIntegrationsMessages, binding ? "channelBindingLabel" : "newChannelBindingLabel", { channel: binding?.externalChannelId ?? connectionName })} className="min-w-0 rounded-[1.2rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{binding ? binding.externalChannelName || binding.externalChannelId : translate(settingsIntegrationsMessages, "addChannelBinding")}</h4><p className="mt-1 break-words text-xs text-slate-500">{translate(settingsIntegrationsMessages, providerKind === "discord" ? "discordLongReplyGuidance" : providerKind === "whatsapp" ? "whatsappLongReplyGuidance" : providerKind === "imessage" ? "imessageLongReplyGuidance" : providerKind === "telegram" ? "telegramLongReplyGuidance" : providerKind === "slack" ? "slackLongReplyGuidance" : "teamsLongReplyGuidance")}</p></div>
        <div className="flex flex-wrap gap-2"><ActionButton label={translate(settingsIntegrationsMessages, binding ? "saveBinding" : "createBinding")} tone="primary" onClick={() => void save()} busy={busy} disabled={projectOptions.length === 0} disabledReason={projectOptions.length === 0 ? translate(settingsIntegrationsMessages, "createOrSelectProject") : undefined} />{binding && onDelete ? <ActionButton label={translate(settingsIntegrationsMessages, "deleteBinding")} tone="danger" onClick={onDelete} disabled={busy} /> : null}</div>
      </div>
      {validationError ? <div role="alert" aria-live="assertive" className="mt-3 rounded-xl border border-status-red/20 bg-status-red/[0.06] p-3 text-xs font-semibold text-status-red">{validationError}</div> : null}
      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
        {!binding ? <label className="min-w-0 text-xs font-bold text-slate-500">{identifierLabel}<TextInput value={draft.externalChannelId} onChange={(value) => setDraft({ ...draft, externalChannelId: value })} mono aria-label={`${connectionName} new binding channel id`} /></label> : null}
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "channelName")}<TextInput value={draft.externalChannelName} onChange={(value) => setDraft({ ...draft, externalChannelName: value })} aria-label={translate(settingsIntegrationsMessages, "channelNameFor", { channel: channelLabel })} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "project")}<SelectInput value={draft.projectId} onChange={(value) => setDraft({ ...draft, projectId: value })} options={projectOptions} aria-label={translate(settingsIntegrationsMessages, "boundProjectFor", { channel: channelLabel })} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "agentPreset")}<SelectInput value={draft.agentPresetId} onChange={(value) => setDraft({ ...draft, agentPresetId: value })} options={agentPresetOptions} aria-label={translate(settingsIntegrationsMessages, "agentPresetFor", { channel: channelLabel })} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "projectSelectorPrefix")}<TextInput value={draft.projectSelectorPrefix} onChange={(value) => setDraft({ ...draft, projectSelectorPrefix: value })} placeholder="/project" mono aria-label={translate(settingsIntegrationsMessages, "projectSelectorFor", { channel: channelLabel })} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "routingHint")}<TextInput value={draft.projectSelector} onChange={(value) => setDraft({ ...draft, projectSelector: value })} aria-label={translate(settingsIntegrationsMessages, "routingHintFor", { channel: channelLabel })} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">{translate(settingsIntegrationsMessages, "threadIdentifier")}<TextInput value={draft.conversationThreadId} onChange={(value) => setDraft({ ...draft, conversationThreadId: value })} mono aria-label={translate(settingsIntegrationsMessages, "threadIdentifierFor", { channel: channelLabel })} /></label>
      </div>
      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">{([['enabled','enabled'],['inboundEnabled','inbound'],['outboundEnabled','outboundReplies'],['suppressRichWidgets','suppressRichWidgets']] as const).map(([key, labelKey]) => { const label = translate(settingsIntegrationsMessages, labelKey); return <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-[var(--fill-muted)] p-3"><span className="break-words text-xs font-semibold">{label}</span><Toggle aria-label={`${channelLabel} ${label}`} value={draft[key]} onChange={() => setDraft({ ...draft, [key]: !draft[key] })} /></div>; })}</div>
      <NoticePanel title={translate(settingsIntegrationsMessages, "ambiguousRouting")}>{translate(settingsIntegrationsMessages, "ambiguousRoutingDescription")}</NoticePanel>
    </section>
  );
};
