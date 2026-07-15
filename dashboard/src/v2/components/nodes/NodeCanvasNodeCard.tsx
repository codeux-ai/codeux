import type { FunctionComponent, JSX } from "preact";
import type {
  NodeCanvasNode,
  NodeCanvasPortDirection,
  NodeCanvasValidationIssue,
} from "../../lib/nodes-canvas-state.js";
import { useNodesI18n } from "../../i18n/messages/nodes.js";

export const NODE_CANVAS_NODE_WIDTH = 248;
export const NODE_CANVAS_NODE_HEIGHT = 156;

const KIND_STYLES: Record<NodeCanvasNode["kind"], string> = {
  trigger: "border-emerald-400/40 bg-emerald-500/[0.08] text-emerald-700 dark:text-emerald-300",
  agent: "border-signal-400/45 bg-signal-500/[0.10] text-signal-700 dark:text-signal-300",
  task: "border-sky-400/45 bg-sky-500/[0.09] text-sky-700 dark:text-sky-300",
  condition: "border-amber-400/50 bg-amber-500/[0.10] text-amber-700 dark:text-amber-300",
  output: "border-fuchsia-400/40 bg-fuchsia-500/[0.09] text-fuchsia-700 dark:text-fuchsia-300",
};

export const getNodeCanvasPortOffsetY = (
  direction: NodeCanvasPortDirection,
  index: number,
  total: number,
): number => {
  if (total <= 1) {
    return NODE_CANVAS_NODE_HEIGHT / 2;
  }
  const top = direction === "input" ? 58 : 48;
  const bottom = NODE_CANVAS_NODE_HEIGHT - (direction === "input" ? 42 : 34);
  const step = (bottom - top) / Math.max(1, total - 1);
  return top + step * index;
};

export interface NodeCanvasNodeCardProps {
  node: NodeCanvasNode;
  selected: boolean;
  focused: boolean;
  validationIssues: readonly NodeCanvasValidationIssue[];
  onSelect: (event: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: JSX.TargetedPointerEvent<HTMLButtonElement>) => void;
  setNodeRef?: (nodeId: string, element: HTMLButtonElement | null) => void;
}

export const NodeCanvasNodeCard: FunctionComponent<NodeCanvasNodeCardProps> = ({
  node,
  selected,
  focused,
  validationIssues,
  onSelect,
  onPointerDown,
  setNodeRef,
}) => {
  const { t, tp } = useNodesI18n();
  const hasIssues = validationIssues.length > 0;
  const configCount = node.config.length;
  const portCount = node.inputPorts.length + node.outputPorts.length;

  return (
    <button
      ref={(element) => setNodeRef?.(node.id, element)}
      type="button"
      data-node-canvas-interactive="true"
      data-node-id={node.id}
      aria-label={hasIssues
        ? t("canvasNodeLabelWithIssues", { label: node.label, kind: node.kind, count: validationIssues.length })
        : t("canvasNodeLabel", { label: node.label, kind: node.kind })}
      aria-pressed={selected}
      className={`absolute group/node flex flex-col rounded-[1rem] border p-3 text-left shadow-[0_18px_42px_rgba(15,23,42,0.12)] transition-[border-color,box-shadow,transform,background-color] motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/60 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-void-900 ${
        selected
          ? "border-signal-500/75 bg-white shadow-[0_0_0_1px_rgba(0,224,160,0.32),0_24px_60px_rgba(0,224,160,0.18)] dark:bg-void-800"
          : "border-black/[0.08] bg-white/90 hover:border-signal-500/40 dark:border-white/[0.10] dark:bg-void-800/92"
      } ${focused && !selected ? "ring-2 ring-signal-500/35" : ""}`}
      style={{
        width: `${NODE_CANVAS_NODE_WIDTH}px`,
        height: `${NODE_CANVAS_NODE_HEIGHT}px`,
        transform: `translate(${node.position.x}px, ${node.position.y}px)`,
      }}
      onClick={onSelect}
      onPointerDown={onPointerDown}
    >
      <span className="pointer-events-none absolute -left-2 top-0 h-full w-4" aria-hidden="true">
        {node.inputPorts.map((port, index) => (
          <span
            key={port.id}
            aria-label={t("targetHandle", { label: node.label, port: port.label })}
            className="absolute left-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-slate-500 shadow-[0_0_0_1px_rgba(15,23,42,0.25)] dark:border-void-800 dark:bg-slate-300"
            style={{ top: `${getNodeCanvasPortOffsetY("input", index, node.inputPorts.length) - 7}px` }}
          />
        ))}
      </span>

      <span className="pointer-events-none absolute -right-2 top-0 h-full w-4" aria-hidden="true">
        {node.outputPorts.map((port, index) => (
          <span
            key={port.id}
            aria-label={t("sourceHandle", { label: node.label, port: port.label })}
            className="absolute right-0 h-3.5 w-3.5 rounded-full border-2 border-white bg-signal-500 shadow-[0_0_0_1px_rgba(0,224,160,0.34)] dark:border-void-800"
            style={{ top: `${getNodeCanvasPortOffsetY("output", index, node.outputPorts.length) - 7}px` }}
          />
        ))}
      </span>

      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className={`min-w-0 max-w-[9.25rem] truncate rounded-full border px-2 py-1 text-[10px] font-bold uppercase leading-none ${KIND_STYLES[node.kind]}`}>
          {node.kind}
        </span>
        <span
          className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold uppercase leading-none ${
            hasIssues
              ? "bg-status-red/10 text-status-red ring-1 ring-status-red/25"
              : "bg-status-green/10 text-status-green ring-1 ring-status-green/25"
          }`}
        >
          {hasIssues ? t("issue") : t("valid")}
        </span>
      </span>

      <span className="mt-3 block min-w-0 max-w-full text-[15px] font-bold leading-tight text-slate-950 dark:text-white">
        <span className="line-clamp-2 overflow-hidden break-words">{node.label}</span>
      </span>

      <span className="mt-2 line-clamp-2 min-h-[2.25rem] max-w-full overflow-hidden text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        {node.description}
      </span>

      <span className="mt-auto flex min-w-0 items-center justify-between gap-2 pt-3 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <span className="truncate">{tp("handleCount", portCount)}</span>
        <span className="truncate">{tp("fieldCount", configCount)}</span>
      </span>
    </button>
  );
};
