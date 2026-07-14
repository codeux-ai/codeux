import type { FunctionComponent } from "preact";
import { Link2, Unlink } from "lucide-preact";
import type {
  AgentPreset,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
  NodeDefinitionManifest,
  NodeFlowRequiredCredential,
} from "../../types.js";
import {
  applyWidgetDefaults,
  buildValidationMessagesByField,
} from "../../lib/node-flow-view-models.js";
import { NodeWidgetField } from "./NodeWidgetField.js";
import { translateNodesStatus, useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodeFlowInspectorProps {
  selectedNode: NodeFlowNode | null;
  validation: NodeFlowValidationResponse | null;
  agents: AgentPreset[];
  attachments: NodeFlowSkillAttachment[];
  attachAgentId: string;
  attaching?: boolean;
  attachmentsLoading?: boolean;
  attachmentError?: string | null;
  onAttachAgentIdChange: (agentPresetId: string) => void;
  onAttachAgent: () => void;
  onDetachAgent: (agentPresetId: string) => void;
  onRetryAttachments?: () => void;
  onNodeChange: (nodeId: string, update: Partial<NodeFlowNode>) => void;
  definition?: NodeDefinitionManifest | null;
  requiredCredentials?: NodeFlowRequiredCredential[];
  onRequestCredential?: (nodeId: string, slot: string) => void;
}

const inputClass = "w-full rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100";

export const NodeFlowInspector: FunctionComponent<NodeFlowInspectorProps> = ({
  selectedNode,
  validation,
  agents,
  attachments,
  attachAgentId,
  attaching = false,
  attachmentsLoading = false,
  attachmentError = null,
  onAttachAgentIdChange,
  onAttachAgent,
  onDetachAgent,
  onRetryAttachments,
  onNodeChange,
  definition = null,
  requiredCredentials = [],
  onRequestCredential,
}) => {
  const { locale, t, tp } = useNodesI18n();
  const messagesByField = buildValidationMessagesByField(validation);

  if (!selectedNode) {
    return (
      <aside className="rounded-[1.6rem] border border-dashed border-black/[0.08] bg-white/45 p-6 text-sm text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 xl:w-[360px] xl:shrink-0">
        {t("selectNodeToEdit")}
      </aside>
    );
  }

  const widgetSchema = definition?.ui?.widgetSchema ?? selectedNode.widgetSchema;
  const data = applyWidgetDefaults(widgetSchema, selectedNode.data);

  const updateDataField = (fieldId: string, value: NodeFlowJsonValue): void => {
    onNodeChange(selectedNode.id, {
      data: {
        ...data,
        [fieldId]: value,
      },
    });
  };

  return (
    <aside className="flex flex-col gap-4 rounded-[1.6rem] border border-black/[0.08] bg-white/90 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] dark:border-white/[0.08] dark:bg-void-800/90 xl:w-[380px] xl:shrink-0">
      <section className="flex flex-col gap-3" aria-labelledby="node-inspector-heading">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("inspector")}</p>
          <h2 id="node-inspector-heading" className="mt-1 truncate font-display text-lg font-bold text-slate-900 dark:text-white">
            {selectedNode.title}
          </h2>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {t("title")}
          <input
            className={inputClass}
            value={selectedNode.title}
            onInput={(event) => onNodeChange(selectedNode.id, { title: event.currentTarget.value })}
          />
        </label>
        <div className="rounded-xl border border-black/[0.06] bg-white/55 p-3 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <p className="font-bold text-slate-800 dark:text-slate-100">{definition?.ui?.label ?? selectedNode.type} · v{definition?.version ?? selectedNode.definition?.version ?? 1}</p>
          <p className="mt-1">{tp("typedPortCount", definition?.ports.length ?? selectedNode.ports?.length ?? 0)} · {t("sideEffects", { value: definition?.sideEffect ?? selectedNode.sideEffect ?? "none" })}</p>
          {(definition?.capabilities ?? selectedNode.capabilities ?? []).length ? <p className="mt-1 break-words">{t("capabilities", { values: (definition?.capabilities ?? selectedNode.capabilities ?? []).join(", ") })}</p> : null}
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {t("description")}
          <textarea
            className={`${inputClass} min-h-20 resize-y normal-case tracking-normal`}
            value={selectedNode.description ?? ""}
            onInput={(event) => onNodeChange(selectedNode.id, { description: event.currentTarget.value })}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-widgets-heading">
        <h3 id="node-widgets-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("widgets")}</h3>
        {(widgetSchema?.fields.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">
            {t("noWidgets")}
          </p>
        ) : (
          widgetSchema!.fields.map((field) => (
            <NodeWidgetField
              key={field.id}
              field={field}
              value={data[field.id]}
              validationMessages={messagesByField.get(`nodes.${selectedNode.id}.${field.id}`) ?? messagesByField.get(field.id)}
              onChange={updateDataField}
            />
          ))
        )}
      </section>

      <section className="flex flex-col gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-credentials-heading">
        <h3 id="node-credentials-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("credentialBindings")}</h3>
        {requiredCredentials.length === 0 ? <p className="text-xs text-slate-500">{t("noCredentialRequest")}</p> : requiredCredentials.map((credential) => (
          <div key={credential.slot} className="rounded-xl border border-black/[0.06] bg-white/60 p-3 dark:border-white/[0.06] dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-3"><span className="text-sm font-bold text-slate-800 dark:text-slate-100">{credential.slot}</span><span className={`text-[10px] font-bold uppercase ${credential.status === "bound" ? "text-status-green" : "text-status-red"}`}>{translateNodesStatus(locale, credential.status)}</span></div>
            <p className="mt-1 text-xs text-slate-500">{credential.allowedKinds.join(", ")} · {t("secretNeverDisplayed")}</p>
            {credential.status !== "bound" && onRequestCredential ? <button type="button" className="mt-2 rounded-lg border border-signal-500/30 px-2.5 py-1.5 text-xs font-bold text-signal-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40" onClick={() => onRequestCredential(selectedNode.id, credential.slot)}>{t("requestBinding")}</button> : null}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-agent-attachments-heading" aria-busy={attachmentsLoading || attaching}>
        <h3 id="node-agent-attachments-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("agentAttachments")}</h3>
        <div className="flex gap-2">
          <select
            aria-label={t("agentPreset")}
            className={inputClass}
            value={attachAgentId}
            disabled={attachmentsLoading || attaching}
            onChange={(event) => onAttachAgentIdChange(event.currentTarget.value)}
          >
            <option value="">{t("selectAgent")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <button
            type="button"
            aria-label={t("attachFlowToAgent")}
            disabled={!attachAgentId || attachmentsLoading || attaching}
            onClick={onAttachAgent}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-500 text-white transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-void-900"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {attachmentsLoading ? <p role="status" className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("loadingAgentAttachments")}</p> : null}
        {attachmentError ? (
          <div role="alert" className="rounded-xl border border-status-red/20 bg-status-red/[0.06] p-3 text-xs text-status-red">
            <p>{attachmentError}</p>
            {onRetryAttachments ? <button type="button" className="mt-2 font-bold underline focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40" onClick={onRetryAttachments}>{t("retryAttachments")}</button> : null}
          </div>
        ) : null}
        {!attachmentsLoading && !attachmentError && attachments.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">{t("noAgentsAttached")}</p>
        ) : !attachmentsLoading && !attachmentError ? (
          <div className="flex flex-col gap-2">
            {attachments.map((attachment) => {
              const agent = agents.find((entry) => entry.id === attachment.agentPresetId);
              return (
                <div key={attachment.agentPresetId} className="flex items-center justify-between gap-3 rounded-xl border border-black/[0.06] bg-white/60 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-800 dark:text-slate-100">{agent?.name ?? attachment.agentPresetId}</p>
                    <p className="truncate text-xs text-slate-500 dark:text-slate-400">{attachment.skillName}</p>
                  </div>
                  <button
                    type="button"
                    aria-label={t("detachAgent", { name: agent?.name ?? attachment.agentPresetId })}
                    disabled={attaching}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-status-red/[0.08] hover:text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
                    onClick={() => onDetachAgent(attachment.agentPresetId)}
                  >
                    <Unlink className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>
    </aside>
  );
};
