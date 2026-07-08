import type { FunctionComponent } from "preact";
import { GitBranch, Play, Plus, Route, Send, Split } from "lucide-preact";
import type {
  NodeCanvasNodeKind,
  NodeCanvasNodeMetadata,
  NodesCanvasAction,
} from "../../lib/nodes-canvas-state.js";
import { Button } from "../ui/Button.js";
import { Tooltip } from "../ui/Tooltip.js";

export type NodePaletteCreateNodeInput = Extract<NodesCanvasAction, { type: "add_node" }>;

interface NodePaletteTemplate {
  kind: NodeCanvasNodeKind;
  label: string;
  description: string;
  metadata?: NodeCanvasNodeMetadata;
  Icon: typeof Play;
}

interface NodePaletteProps {
  disabled?: boolean;
  onCreateNode: (input: NodePaletteCreateNodeInput) => void;
}

const NODE_TEMPLATES: readonly NodePaletteTemplate[] = [
  {
    kind: "trigger",
    label: "Trigger",
    description: "Start a graph from a manual or scheduled event.",
    Icon: Play,
  },
  {
    kind: "agent",
    label: "Agent",
    description: "Route work to a planning, implementation, review, or QA agent.",
    metadata: { agentIntent: "implement" },
    Icon: Route,
  },
  {
    kind: "task",
    label: "Task",
    description: "Draft the concrete work item an agent should execute.",
    metadata: { taskIntent: "feature" },
    Icon: GitBranch,
  },
  {
    kind: "condition",
    label: "Condition",
    description: "Branch the workflow based on checks or review state.",
    Icon: Split,
  },
  {
    kind: "output",
    label: "Output",
    description: "Collect the final workflow result for runs and agents.",
    Icon: Send,
  },
];

export const NodePalette: FunctionComponent<NodePaletteProps> = ({ disabled = false, onCreateNode }) => (
  <aside
    className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border border-black/[0.06] bg-white/70 p-4 shadow-[var(--elevation-soft)] dark:border-white/[0.06] dark:bg-white/[0.035] xl:w-[300px] xl:shrink-0"
    aria-labelledby="node-palette-heading"
  >
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-signal-600 dark:text-signal-400">Palette</p>
        <h2 id="node-palette-heading" className="text-base font-bold text-slate-900 dark:text-white">Add nodes</h2>
      </div>
      <Plus className="h-4 w-4 text-slate-400" aria-hidden="true" />
    </div>
    <div className="grid gap-2" aria-label="Node templates">
      {NODE_TEMPLATES.map(({ kind, label, description, metadata, Icon }) => (
        <Tooltip key={kind} content={description} position="right">
          <Button
            type="button"
            aria-label={`Add ${label} node`}
            variant="secondary"
            size="md"
            icon={Icon}
            disabled={disabled}
            className="w-full justify-start text-left"
            onClick={() => onCreateNode({
              type: "add_node",
              kind,
              label: `${label} Node`,
              ...(metadata ? { metadata } : {}),
            })}
          >
            <span className="flex min-w-0 flex-col items-start">
              <span className="truncate text-sm">{label}</span>
              <span className="line-clamp-2 text-xs font-medium text-slate-500 dark:text-slate-400">{description}</span>
            </span>
          </Button>
        </Tooltip>
      ))}
    </div>
  </aside>
);
