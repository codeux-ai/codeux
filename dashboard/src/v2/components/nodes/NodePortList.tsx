import type { FunctionComponent } from "preact";
import { Cable, CircleDot, LogIn, LogOut } from "lucide-preact";
import type {
  NodeCanvasNode,
  NodeCanvasPort,
  NodeCanvasPortDirection,
  NodeCanvasPortType,
} from "../../lib/nodes-canvas-state.js";

interface NodePortListProps {
  node: NodeCanvasNode;
  className?: string;
}

const PORT_TYPE_HINTS: Record<NodeCanvasPortType, string> = {
  control: "control-flow handoff",
  agent: "agent routing context",
  task: "task draft context",
  condition: "gate result branch",
  result: "final result payload",
  data: "structured data payload",
};

const compatibleHint = (port: NodeCanvasPort): string => {
  const readableType = PORT_TYPE_HINTS[port.type];
  if (port.direction === "input") {
    return `Requires an upstream output that provides ${readableType}.`;
  }
  return `Can wire into downstream inputs that accept ${readableType}.`;
};

const directionLabel = (direction: NodeCanvasPortDirection): string => (
  direction === "input" ? "Inputs" : "Outputs"
);

const PortSection: FunctionComponent<{
  direction: NodeCanvasPortDirection;
  ports: readonly NodeCanvasPort[];
}> = ({ direction, ports }) => {
  const Icon = direction === "input" ? LogIn : LogOut;
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`node-port-list-${direction}`}>
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-ui)] bg-slate-900 text-white dark:bg-white dark:text-void-900">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <h4 id={`node-port-list-${direction}`} className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
          {directionLabel(direction)}
        </h4>
      </div>
      {ports.length === 0 ? (
        <p className="rounded-[var(--radius-ui)] border border-dashed border-black/[0.08] bg-white/45 px-3 py-2 text-xs text-slate-500 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-slate-400">
          No {direction} ports.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ports.map((port) => (
            <li
              key={`${direction}-${port.id}`}
              className="rounded-[var(--radius-ui)] border border-black/[0.06] bg-white/65 px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.035]"
            >
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                    <CircleDot className="h-3.5 w-3.5 shrink-0 text-signal-500" aria-hidden="true" />
                    <span className="truncate">{port.label}</span>
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {compatibleHint(port)}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="rounded-full bg-slate-900/[0.06] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-600 dark:bg-white/[0.08] dark:text-slate-300">
                    {port.type}
                  </span>
                  {port.required ? (
                    <span className="rounded-full bg-status-red/[0.08] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-status-red">
                      Required
                    </span>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export const NodePortList: FunctionComponent<NodePortListProps> = ({ node, className = "" }) => (
  <section className={`flex flex-col gap-3 ${className}`} aria-labelledby="node-port-list-heading">
    <div className="flex items-center gap-2">
      <Cable className="h-4 w-4 text-signal-500" aria-hidden="true" />
      <h3 id="node-port-list-heading" className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
        Wiring
      </h3>
    </div>
    <PortSection direction="input" ports={node.inputPorts} />
    <PortSection direction="output" ports={node.outputPorts} />
  </section>
);
