import type { FunctionComponent } from "preact";
import { AlertTriangle, CheckCircle2, LocateFixed, MousePointer2 } from "lucide-preact";
import type {
  NodeCanvasEdge,
  NodeCanvasGraph,
  NodeCanvasNode,
  NodeCanvasValidationIssue,
} from "../../lib/nodes-canvas-state.js";
import { validateNodeCanvasGraph } from "../../lib/nodes-canvas-state.js";
import { Button } from "../ui/Button.js";
import type { DashboardLocale } from "../../i18n/locales.js";
import { translateNodesMessage, useNodesI18n } from "../../i18n/messages/nodes.js";

interface NodeValidationPanelProps {
  graph: NodeCanvasGraph;
  onFocusEdge?: (edgeId: string) => void;
  onFocusNode?: (nodeId: string) => void;
  onSelectEdge?: (edgeId: string) => void;
  onSelectNode?: (nodeId: string) => void;
}

type ValidationEntityType = "node" | "edge" | "graph";

interface ValidationGroup {
  id: string;
  entityType: ValidationEntityType;
  title: string;
  issues: NodeCanvasValidationIssue[];
}

const issueSeverityLabel = (_issue: NodeCanvasValidationIssue, locale: DashboardLocale): string => translateNodesMessage(locale, "error");

const groupValidationIssues = (
  issues: readonly NodeCanvasValidationIssue[],
  nodesById: ReadonlyMap<string, NodeCanvasNode>,
  edgesById: ReadonlyMap<string, NodeCanvasEdge>,
  locale: DashboardLocale,
): ValidationGroup[] => {
  const groups = new Map<string, ValidationGroup>();

  for (const issue of issues) {
    const node = nodesById.get(issue.entityId);
    const edge = edgesById.get(issue.entityId);
    const entityType: ValidationEntityType = node ? "node" : edge ? "edge" : "graph";
    const key = `${entityType}:${issue.entityId}`;
    const title = node
      ? translateNodesMessage(locale, "validationNode", { label: node.label || node.id })
      : edge
        ? translateNodesMessage(locale, "validationEdge", { label: edge.label || edge.id })
        : translateNodesMessage(locale, "validationGraph", { id: issue.entityId });
    const current = groups.get(key) ?? { id: issue.entityId, entityType, title, issues: [] };
    current.issues.push(issue);
    groups.set(key, current);
  }

  return [...groups.values()].sort((left, right) => {
    const entityCompare = left.entityType.localeCompare(right.entityType);
    if (entityCompare !== 0) {
      return entityCompare;
    }
    return left.title.localeCompare(right.title);
  });
};

export const NodeValidationPanel: FunctionComponent<NodeValidationPanelProps> = ({
  graph,
  onFocusEdge,
  onFocusNode,
  onSelectEdge,
  onSelectNode,
}) => {
  const { locale, t, tp } = useNodesI18n();
  const issues = validateNodeCanvasGraph(graph, locale);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  const groups = groupValidationIssues(issues, nodesById, edgesById, locale);

  return (
    <aside
      className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035]"
      aria-labelledby="node-validation-heading"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{t("validation")}</p>
          <h2 id="node-validation-heading" className="text-base font-bold text-slate-900 dark:text-white">
            {issues.length === 0 ? t("readyToWire") : tp("issueCount", issues.length)}
          </h2>
        </div>
        {issues.length === 0 ? (
          <CheckCircle2 className="h-5 w-5 text-status-green" aria-hidden="true" />
        ) : (
          <AlertTriangle className="h-5 w-5 text-status-red" aria-hidden="true" />
        )}
      </div>
      {issues.length === 0 ? (
        <p role="status" className="rounded-[var(--radius-ui)] border border-status-green/20 bg-status-green/[0.06] px-3 py-2 text-sm text-slate-600 dark:text-slate-300">
          {t("noStructuralIssues")}
        </p>
      ) : (
        <div className="flex flex-col gap-3" role="list" aria-label={t("validationIssuesLabel")}>
          {groups.map((group) => (
            <section
              key={`${group.entityType}-${group.id}`}
              className="rounded-[var(--radius-ui)] border border-black/[0.06] bg-white/65 p-3 dark:border-white/[0.06] dark:bg-white/[0.035]"
              aria-labelledby={`validation-group-${group.entityType}-${group.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <h3 id={`validation-group-${group.entityType}-${group.id}`} className="text-sm font-bold text-slate-900 dark:text-white">
                  {group.title}
                </h3>
                <span className="rounded-full bg-status-red/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red">
                  {issueSeverityLabel(group.issues[0]!, locale)}
                </span>
              </div>
              <ul className="mt-2 flex flex-col gap-2">
                {group.issues.map((issue) => (
                  <li key={`${issue.code}-${issue.field}`} className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                    <span className="font-bold text-slate-800 dark:text-slate-100">{issue.field}:</span> {issue.message}
                  </li>
                ))}
              </ul>
              {group.entityType !== "graph" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={MousePointer2}
                    onClick={() => group.entityType === "node" ? onSelectNode?.(group.id) : onSelectEdge?.(group.id)}
                    disabled={group.entityType === "node" ? !onSelectNode : !onSelectEdge}
                  >
                    {t("select")}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    icon={LocateFixed}
                    onClick={() => group.entityType === "node" ? onFocusNode?.(group.id) : onFocusEdge?.(group.id)}
                    disabled={group.entityType === "node" ? !onFocusNode : !onFocusEdge}
                  >
                    {t("focus")}
                  </Button>
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </aside>
  );
};
