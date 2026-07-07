import type { FunctionComponent } from "preact";
import { Link2, Unlink } from "lucide-preact";
import type {
  AgentPreset,
  NodeFlowJsonObject,
  NodeFlowJsonValue,
  NodeFlowNode,
  NodeFlowSkillAttachment,
  NodeFlowValidationResponse,
} from "../../types.js";
import {
  applyWidgetDefaults,
  buildValidationMessagesByField,
} from "../../lib/node-flow-view-models.js";
import { NodeWidgetField } from "./NodeWidgetField.js";

interface NodeFlowInspectorProps {
  selectedNode: NodeFlowNode | null;
  validation: NodeFlowValidationResponse | null;
  agents: AgentPreset[];
  attachments: NodeFlowSkillAttachment[];
  attachAgentId: string;
  attaching?: boolean;
  onAttachAgentIdChange: (agentPresetId: string) => void;
  onAttachAgent: () => void;
  onDetachAgent: (agentPresetId: string) => void;
  onNodeChange: (nodeId: string, update: Partial<NodeFlowNode>) => void;
}

const inputClass = "w-full rounded-xl border border-black/[0.08] bg-white/75 px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-signal-500/50 focus:ring-2 focus:ring-signal-500/20 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-100";

export const NodeFlowInspector: FunctionComponent<NodeFlowInspectorProps> = ({
  selectedNode,
  validation,
  agents,
  attachments,
  attachAgentId,
  attaching = false,
  onAttachAgentIdChange,
  onAttachAgent,
  onDetachAgent,
  onNodeChange,
}) => {
  const messagesByField = buildValidationMessagesByField(validation);

  if (!selectedNode) {
    return (
      <aside className="rounded-[1.6rem] border border-dashed border-black/[0.08] bg-white/45 p-6 text-sm text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 xl:w-[360px] xl:shrink-0">
        Select a node to edit its widget values.
      </aside>
    );
  }

  const data = applyWidgetDefaults(selectedNode.widgetSchema, selectedNode.data);

  const updateDataField = (fieldId: string, value: NodeFlowJsonValue): void => {
    onNodeChange(selectedNode.id, {
      data: {
        ...data,
        [fieldId]: value,
      },
    });
  };

  return (
    <aside className="flex flex-col gap-4 rounded-[1.6rem] border border-black/[0.08] bg-white/65 p-4 shadow-[0_18px_52px_rgba(15,23,42,0.06)] backdrop-blur-xl dark:border-white/[0.08] dark:bg-white/[0.04] xl:w-[380px] xl:shrink-0">
      <section className="flex flex-col gap-3" aria-labelledby="node-inspector-heading">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">Inspector</p>
          <h2 id="node-inspector-heading" className="mt-1 truncate font-display text-lg font-bold text-slate-900 dark:text-white">
            {selectedNode.title}
          </h2>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Title
          <input
            className={inputClass}
            value={selectedNode.title}
            onInput={(event) => onNodeChange(selectedNode.id, { title: event.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Type
          <input
            className={inputClass}
            value={selectedNode.type}
            onInput={(event) => onNodeChange(selectedNode.id, { type: event.currentTarget.value })}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          Description
          <textarea
            className={`${inputClass} min-h-20 resize-y normal-case tracking-normal`}
            value={selectedNode.description ?? ""}
            onInput={(event) => onNodeChange(selectedNode.id, { description: event.currentTarget.value })}
          />
        </label>
      </section>

      <section className="flex flex-col gap-4 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-widgets-heading">
        <h3 id="node-widgets-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Widgets</h3>
        {(selectedNode.widgetSchema?.fields.length ?? 0) === 0 ? (
          <p className="rounded-xl border border-black/[0.06] bg-white/55 px-3 py-3 text-sm text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.03]">
            No widgets configured for this node.
          </p>
        ) : (
          selectedNode.widgetSchema!.fields.map((field) => (
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

      <section className="flex flex-col gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-agent-attachments-heading">
        <h3 id="node-agent-attachments-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">Agent Attachments</h3>
        <div className="flex gap-2">
          <select
            aria-label="Agent preset"
            className={inputClass}
            value={attachAgentId}
            onChange={(event) => onAttachAgentIdChange(event.currentTarget.value)}
          >
            <option value="">Select agent</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>{agent.name}</option>
            ))}
          </select>
          <button
            type="button"
            aria-label="Attach node flow to agent"
            disabled={!attachAgentId || attaching}
            onClick={onAttachAgent}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-signal-500 text-white transition hover:bg-signal-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 disabled:opacity-50 dark:text-void-900"
          >
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {attachments.length === 0 ? (
          <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">No agents attached.</p>
        ) : (
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
                    aria-label={`Detach ${agent?.name ?? attachment.agentPresetId}`}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-status-red/[0.08] hover:text-status-red focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40"
                    onClick={() => onDetachAgent(attachment.agentPresetId)}
                  >
                    <Unlink className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </aside>
  );
};
