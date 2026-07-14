import type { FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import type { ChatProviderChannelBindingRecord, ChatProviderKind, CreateChatProviderChannelBindingInput, UpdateChatProviderChannelBindingInput } from "../../../../types.js";
import { ActionButton, NoticePanel } from "../SettingsSurface.js";
import { SelectInput, TextInput, Toggle } from "../SettingsFormFields.js";
import { buildRoutingHints, createBindingDraft, createNewBindingDraft, getExternalChannelLabel, getLongContentGuidance } from "./chat-connector-models.js";

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
  const [draft, setDraft] = useState(() => binding ? createBindingDraft(binding) : createNewBindingDraft(projectOptions[0]?.value ?? ""));
  const [validationError, setValidationError] = useState<string | null>(null);
  const identifierLabel = getExternalChannelLabel(providerKind);
  const save = async (): Promise<void> => {
    if (!draft.externalChannelId.trim() || !draft.projectId.trim()) {
      setValidationError(`${identifierLabel} and project are required.`);
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
    <section aria-label={binding ? `${binding.externalChannelId} channel binding` : `${connectionName} new channel binding`} className="min-w-0 rounded-[1.2rem] border border-[color:var(--border-hairline)] bg-[var(--surface-glass)] p-4">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0"><h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">{binding ? binding.externalChannelName || binding.externalChannelId : "Add channel binding"}</h4><p className="mt-1 break-words text-xs text-slate-500">{getLongContentGuidance(providerKind)}</p></div>
        <div className="flex flex-wrap gap-2"><ActionButton label={binding ? "Save binding" : "Create binding"} tone="primary" onClick={() => void save()} busy={busy} disabled={projectOptions.length === 0} disabledReason={projectOptions.length === 0 ? "Create or select a project first." : undefined} />{binding && onDelete ? <ActionButton label="Delete binding" tone="danger" onClick={onDelete} disabled={busy} /> : null}</div>
      </div>
      {validationError ? <div role="alert" aria-live="assertive" className="mt-3 rounded-xl border border-status-red/20 bg-status-red/[0.06] p-3 text-xs font-semibold text-status-red">{validationError}</div> : null}
      <div className="mt-4 grid min-w-0 gap-3 md:grid-cols-2">
        {!binding ? <label className="min-w-0 text-xs font-bold text-slate-500">{identifierLabel}<TextInput value={draft.externalChannelId} onChange={(value) => setDraft({ ...draft, externalChannelId: value })} mono aria-label={`${connectionName} new binding channel id`} /></label> : null}
        <label className="min-w-0 text-xs font-bold text-slate-500">Mobile label: Channel name<TextInput value={draft.externalChannelName} onChange={(value) => setDraft({ ...draft, externalChannelName: value })} aria-label={`${channelLabel} channel name`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">Project<SelectInput value={draft.projectId} onChange={(value) => setDraft({ ...draft, projectId: value })} options={projectOptions} aria-label={`${channelLabel} bound project`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">Agent preset<SelectInput value={draft.agentPresetId} onChange={(value) => setDraft({ ...draft, agentPresetId: value })} options={agentPresetOptions} aria-label={`${channelLabel} project-manager preset`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">Project selector prefix<TextInput value={draft.projectSelectorPrefix} onChange={(value) => setDraft({ ...draft, projectSelectorPrefix: value })} placeholder="/project" mono aria-label={`${channelLabel} project selector prefix`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">Routing hint<TextInput value={draft.projectSelector} onChange={(value) => setDraft({ ...draft, projectSelector: value })} aria-label={`${channelLabel} routing hint`} /></label>
        <label className="min-w-0 text-xs font-bold text-slate-500">Thread identifier<TextInput value={draft.conversationThreadId} onChange={(value) => setDraft({ ...draft, conversationThreadId: value })} mono aria-label={`${channelLabel} thread identifier`} /></label>
      </div>
      <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-4">{([['enabled','Enabled'],['inboundEnabled','Inbound'],['outboundEnabled','Outbound replies'],['suppressRichWidgets','Suppress rich widgets']] as const).map(([key, label]) => <div key={key} className="flex min-w-0 items-center justify-between gap-2 rounded-xl bg-[var(--fill-muted)] p-3"><span className="break-words text-xs font-semibold">{label}</span><Toggle aria-label={`${channelLabel} ${label}`} value={draft[key]} onChange={() => setDraft({ ...draft, [key]: !draft[key] })} /></div>)}</div>
      <NoticePanel title="Ambiguous routing">When more than one project matches a channel, the selector prefix and routing hint must resolve one binding; otherwise Code UX asks for clarification instead of guessing.</NoticePanel>
    </section>
  );
};
