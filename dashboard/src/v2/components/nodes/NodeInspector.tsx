import type { FunctionComponent, JSX } from "preact";
import { Cable, MousePointer2, SlidersHorizontal } from "lucide-preact";
import type {
  NodeCanvasConfigField,
  NodeCanvasConfigValue,
  NodeCanvasEdge,
  NodeCanvasGraph,
  NodeCanvasNode,
  NodeCanvasNodeMetadata,
  NodeCanvasValidationIssue,
} from "../../lib/nodes-canvas-state.js";
import { Input } from "../ui/Input.js";
import { Select } from "../ui/Select.js";
import { Toggle } from "../ui/Toggle.js";
import { Button } from "../ui/Button.js";
import { NodePortList } from "./NodePortList.js";
import { useNodesI18n } from "../../i18n/messages/nodes.js";

export interface NodeInspectorProps {
  graph: NodeCanvasGraph;
  selectedEdge?: NodeCanvasEdge | null;
  selectedNode?: NodeCanvasNode | null;
  selectedNodeEnabled?: boolean;
  validationIssues?: readonly NodeCanvasValidationIssue[];
  onNodeChange: (nodeId: string, patch: Partial<Pick<NodeCanvasNode, "description" | "label" | "metadata">>) => void;
  onNodeConfigChange: (nodeId: string, fieldId: string, value: NodeCanvasConfigValue) => void;
  onNodeEnabledChange?: (nodeId: string, enabled: boolean) => void;
  onSelectEdge?: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

const TEXTAREA_CLASS = "min-h-24 w-full rounded-[var(--radius-ui)] border border-[color:var(--border-hairline)] bg-[var(--fill-muted)] px-3.5 py-2.5 text-sm text-slate-700 outline-none transition hover:bg-[var(--fill-muted-hover)] focus-visible:ring-2 focus-visible:ring-[var(--accent-focus-ring)] dark:text-slate-200 aria-[invalid=true]:border-status-red aria-[invalid=true]:bg-status-red/[0.04]";
const FIELD_LABEL_CLASS = "text-sm font-medium text-slate-700 dark:text-slate-300";

const AGENT_INTENTS = ["plan", "implement", "review", "qa"] as const;
const TASK_INTENTS = ["feature", "refactor", "test", "docs", "ops"] as const;

const fieldIssue = (
  issues: readonly NodeCanvasValidationIssue[],
  nodeId: string,
  field: string,
): NodeCanvasValidationIssue | undefined => (
  issues.find((issue) => issue.entityId === nodeId && issue.field === field)
);

const configFieldIssue = (
  issues: readonly NodeCanvasValidationIssue[],
  nodeId: string,
  fieldId: string,
): NodeCanvasValidationIssue | undefined => (
  fieldIssue(issues, nodeId, `config.${fieldId}`)
);

const configValueAsString = (value: NodeCanvasConfigValue): string => (
  value === null ? "" : String(value)
);

const parseConfigValue = (field: NodeCanvasConfigField, rawValue: string): NodeCanvasConfigValue => {
  if (field.type === "number") {
    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return rawValue;
};

const readPortLabel = (graph: NodeCanvasGraph, nodeId: string, portId: string): string => {
  const node = graph.nodes.find((entry) => entry.id === nodeId);
  const port = node ? [...node.inputPorts, ...node.outputPorts].find((entry) => entry.id === portId) : undefined;
  return port ? `${node?.label ?? nodeId} / ${port.label}` : `${nodeId} / ${portId}`;
};

const ConfigFieldControl: FunctionComponent<{
  field: NodeCanvasConfigField;
  issue?: NodeCanvasValidationIssue;
  nodeId: string;
  onNodeConfigChange: NodeInspectorProps["onNodeConfigChange"];
}> = ({ field, issue, nodeId, onNodeConfigChange }) => {
  const inputId = `node-config-${nodeId}-${field.id}`;
  const commonLabel = (
    <label className={FIELD_LABEL_CLASS} htmlFor={inputId}>
      {field.label}
      {field.required ? <span className="text-status-red" aria-hidden="true"> *</span> : null}
    </label>
  );

  if (field.type === "boolean") {
    const labelId = `${inputId}-label`;
    return (
      <div className="flex items-center justify-between gap-3">
        <span id={labelId} className={FIELD_LABEL_CLASS}>{field.label}</span>
        <Toggle
          aria-labelledby={labelId}
          value={field.value === true}
          onChange={(value) => onNodeConfigChange(nodeId, field.id, value)}
        />
      </div>
    );
  }

  if (field.type === "select") {
    return (
      <div className="flex flex-col gap-1.5">
        {commonLabel}
        <Select
          id={inputId}
          value={configValueAsString(field.value)}
          errorText={issue?.message}
          aria-invalid={issue ? "true" : undefined}
          aria-required={field.required ? "true" : undefined}
          onChange={(event) => onNodeConfigChange(nodeId, field.id, event.currentTarget.value)}
        >
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </Select>
      </div>
    );
  }

  if (field.type === "textarea") {
    const errorId = issue ? `${inputId}-error` : undefined;
    return (
      <div className="flex flex-col gap-1.5">
        {commonLabel}
        <textarea
          id={inputId}
          className={TEXTAREA_CLASS}
          value={configValueAsString(field.value)}
          aria-invalid={issue ? "true" : undefined}
          aria-errormessage={errorId}
          aria-required={field.required ? "true" : undefined}
          onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => onNodeConfigChange(nodeId, field.id, event.currentTarget.value)}
        />
        {issue ? <p id={errorId} role="alert" className="text-xs text-status-red">{issue.message}</p> : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {commonLabel}
      <Input
        id={inputId}
        type={field.type === "number" ? "number" : "text"}
        value={configValueAsString(field.value)}
        errorText={issue?.message}
        forceValidation={!!issue}
        aria-invalid={issue ? "true" : undefined}
        aria-required={field.required ? "true" : undefined}
        onInput={(event) => onNodeConfigChange(nodeId, field.id, parseConfigValue(field, event.currentTarget.value))}
      />
    </div>
  );
};

const EdgeDetails: FunctionComponent<{
  edge: NodeCanvasEdge;
  graph: NodeCanvasGraph;
  onSelectEdge?: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}> = ({ edge, graph, onSelectEdge, onSelectNode }) => {
  const { t } = useNodesI18n();
  return <aside
    className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035] xl:w-[360px] xl:shrink-0"
    aria-labelledby="node-edge-inspector-heading"
  >
    <div>
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("inspector")}</p>
      <h2 id="node-edge-inspector-heading" className="mt-1 text-base font-bold text-slate-900 dark:text-white">{t("selectedEdge")}</h2>
    </div>
    <dl className="grid gap-3 text-sm">
      <div>
        <dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("edgeId")}</dt>
        <dd className="mt-1 break-all text-slate-800 dark:text-slate-100">{edge.id}</dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("source")}</dt>
        <dd className="mt-1 text-slate-800 dark:text-slate-100">{readPortLabel(graph, edge.source.nodeId, edge.source.portId)}</dd>
      </div>
      <div>
        <dt className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">{t("target")}</dt>
        <dd className="mt-1 text-slate-800 dark:text-slate-100">{readPortLabel(graph, edge.target.nodeId, edge.target.portId)}</dd>
      </div>
    </dl>
    <div className="flex flex-wrap gap-2 border-t border-black/[0.06] pt-3 dark:border-white/[0.06]">
      <Button type="button" size="sm" variant="ghost" icon={Cable} onClick={() => onSelectEdge?.(edge.id)} disabled={!onSelectEdge}>
        {t("selectEdgeAction")}
      </Button>
      <Button type="button" size="sm" variant="ghost" icon={MousePointer2} onClick={() => onSelectNode?.(edge.source.nodeId)} disabled={!onSelectNode}>
        {t("sourceNode")}
      </Button>
      <Button type="button" size="sm" variant="ghost" icon={MousePointer2} onClick={() => onSelectNode?.(edge.target.nodeId)} disabled={!onSelectNode}>
        {t("targetNode")}
      </Button>
    </div>
  </aside>;
};

export const NodeInspector: FunctionComponent<NodeInspectorProps> = ({
  graph,
  selectedEdge = null,
  selectedNode = null,
  selectedNodeEnabled = true,
  validationIssues = [],
  onNodeChange,
  onNodeConfigChange,
  onNodeEnabledChange,
  onSelectEdge,
  onSelectNode,
}) => {
  const { t } = useNodesI18n();
  if (!selectedNode && selectedEdge) {
    return <EdgeDetails edge={selectedEdge} graph={graph} onSelectEdge={onSelectEdge} onSelectNode={onSelectNode} />;
  }

  if (!selectedNode) {
    return (
      <aside
        className="flex min-h-56 min-w-0 flex-col justify-center rounded-[var(--radius-panel)] border border-dashed border-black/[0.08] bg-white/45 p-6 text-sm text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400 xl:w-[360px] xl:shrink-0"
        aria-labelledby="node-inspector-empty-heading"
      >
        <h2 id="node-inspector-empty-heading" className="text-base font-bold text-slate-900 dark:text-white">{t("nothingSelected")}</h2>
        <p className="mt-2 leading-relaxed">{t("nothingSelectedDescription")}</p>
      </aside>
    );
  }

  const labelIssue = fieldIssue(validationIssues, selectedNode.id, "label");
  const agentIntentIssue = fieldIssue(validationIssues, selectedNode.id, "metadata.agentIntent");
  const taskIntentIssue = fieldIssue(validationIssues, selectedNode.id, "metadata.taskIntent");
  const descriptionId = `node-description-${selectedNode.id}`;
  const enabledLabelId = `node-enabled-${selectedNode.id}`;

  const updateMetadata = (metadata: NodeCanvasNodeMetadata): void => {
    onNodeChange(selectedNode.id, { metadata: { ...selectedNode.metadata, ...metadata } });
  };

  return (
    <aside
      className="flex min-w-0 flex-col gap-4 rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035] xl:w-[380px] xl:shrink-0"
      aria-labelledby="node-inspector-heading"
    >
      <section className="flex flex-col gap-3" aria-labelledby="node-inspector-heading">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">{t("inspector")}</p>
            <h2 id="node-inspector-heading" className="mt-1 truncate text-base font-bold text-slate-900 dark:text-white">
              {selectedNode.label || selectedNode.id}
            </h2>
          </div>
          <span className="rounded-full bg-slate-900/[0.06] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:bg-white/[0.08] dark:text-slate-300">
            {selectedNode.kind}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-[var(--radius-ui)] border border-black/[0.06] bg-white/55 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.03]">
          <span id={enabledLabelId} className={FIELD_LABEL_CLASS}>{t("enabled")}</span>
          <Toggle
            aria-labelledby={enabledLabelId}
            disabled={!onNodeEnabledChange}
            value={selectedNodeEnabled}
            onChange={(enabled) => onNodeEnabledChange?.(selectedNode.id, enabled)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor={`node-label-${selectedNode.id}`}>{t("label")}</label>
          <Input
            id={`node-label-${selectedNode.id}`}
            value={selectedNode.label}
            errorText={labelIssue?.message}
            forceValidation={!!labelIssue}
            aria-invalid={labelIssue ? "true" : undefined}
            onInput={(event) => onNodeChange(selectedNode.id, { label: event.currentTarget.value })}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={FIELD_LABEL_CLASS} htmlFor={descriptionId}>{t("description")}</label>
          <textarea
            id={descriptionId}
            className={TEXTAREA_CLASS}
            value={selectedNode.description}
            onInput={(event: JSX.TargetedEvent<HTMLTextAreaElement, Event>) => onNodeChange(selectedNode.id, { description: event.currentTarget.value })}
          />
        </div>
        {selectedNode.kind === "agent" || selectedNode.metadata.agentIntent !== undefined ? (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLASS} htmlFor={`node-agent-intent-${selectedNode.id}`}>{t("agentIntent")}</label>
            <Select
              id={`node-agent-intent-${selectedNode.id}`}
              value={selectedNode.metadata.agentIntent ?? "implement"}
              errorText={agentIntentIssue?.message}
              aria-invalid={agentIntentIssue ? "true" : undefined}
              onChange={(event) => updateMetadata({ agentIntent: event.currentTarget.value as NodeCanvasNodeMetadata["agentIntent"] })}
            >
              {AGENT_INTENTS.map((intent) => (
                <option key={intent} value={intent}>{intent}</option>
              ))}
            </Select>
          </div>
        ) : null}
        {selectedNode.kind === "task" || selectedNode.metadata.taskIntent !== undefined ? (
          <div className="flex flex-col gap-1.5">
            <label className={FIELD_LABEL_CLASS} htmlFor={`node-task-intent-${selectedNode.id}`}>{t("taskIntent")}</label>
            <Select
              id={`node-task-intent-${selectedNode.id}`}
              value={selectedNode.metadata.taskIntent ?? "feature"}
              errorText={taskIntentIssue?.message}
              aria-invalid={taskIntentIssue ? "true" : undefined}
              onChange={(event) => updateMetadata({ taskIntent: event.currentTarget.value as NodeCanvasNodeMetadata["taskIntent"] })}
            >
              {TASK_INTENTS.map((intent) => (
                <option key={intent} value={intent}>{intent}</option>
              ))}
            </Select>
          </div>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" aria-labelledby="node-config-heading">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-signal-500" aria-hidden="true" />
          <h3 id="node-config-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">{t("configuration")}</h3>
        </div>
        {selectedNode.config.length === 0 ? (
          <p className="rounded-[var(--radius-ui)] border border-dashed border-black/[0.08] bg-white/45 px-3 py-2 text-sm text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
            {t("noConfiguration")}
          </p>
        ) : (
          selectedNode.config.map((field) => (
            <ConfigFieldControl
              key={field.id}
              field={field}
              issue={configFieldIssue(validationIssues, selectedNode.id, field.id)}
              nodeId={selectedNode.id}
              onNodeConfigChange={onNodeConfigChange}
            />
          ))
        )}
      </section>

      <NodePortList node={selectedNode} className="border-t border-black/[0.06] pt-4 dark:border-white/[0.06]" />
    </aside>
  );
};
