import { type FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import {
  Terminal,
  FilePen,
  FileText,
  Search,
  Globe,
  Wrench,
  ChevronRight,
  Hash,
  CheckCircle2,
  AlertCircle,
  Loader2,
} from "lucide-preact";
import { formatTokenCount, shortenIdentifier } from "../../../lib/chat-widget-view-models.js";
import type { ParsedTurnTokens } from "../../../lib/chat-widget-view-models.js";

export interface ToolCallWidgetProps {
  toolName?: string | null;
  status?: string | null;
  args?: string | null;
  output?: string | null;
  tokens?: ParsedTurnTokens | null;
  callId?: string | null;
}

const OUTPUT_LINE_LIMIT = 16;
const OUTPUT_CHAR_LIMIT = 1600;

type ToolKind = "exec" | "edit" | "read" | "search" | "web" | "generic";

const classifyTool = (name: string): ToolKind => {
  const normalized = name.toLowerCase();
  if (/(exec|bash|shell|command|run|terminal)/.test(normalized)) return "exec";
  if (/(apply_patch|patch|edit|write|str_replace|create|update_file)/.test(normalized)) return "edit";
  if (/(read|cat|view|open|file)/.test(normalized)) return "read";
  if (/(grep|search|rg|glob|find|list)/.test(normalized)) return "search";
  if (/(web|fetch|browser|http|url)/.test(normalized)) return "web";
  return "generic";
};

const ICONS: Record<ToolKind, typeof Terminal> = {
  exec: Terminal,
  edit: FilePen,
  read: FileText,
  search: Search,
  web: Globe,
  generic: Wrench,
};

const summarize = (toolName: string, args?: string | null): string => {
  if (!args) return "";

  const patchMatch = args.match(/\*\*\*\s+(?:Update|Add|Delete) File:\s*(.+)/);
  if (patchMatch) {
    return patchMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const command = parsed.cmd ?? parsed.command ?? parsed.script;
    if (Array.isArray(command)) return command.join(" ");
    if (typeof command === "string") return command;
    const file = parsed.path ?? parsed.file_path ?? parsed.filePath ?? parsed.filename;
    if (typeof file === "string") return file;
    const query = parsed.query ?? parsed.pattern ?? parsed.url;
    if (typeof query === "string") return query;
    const first = Object.values(parsed).find((value) => typeof value === "string") as string | undefined;
    if (first) return first;
  } catch {
    // Leave the raw text preview untouched when the payload is not JSON.
  }

  return args.replace(/\s+/g, " ").trim();
};

const truncateOutput = (output: string): { text: string; truncated: boolean } => {
  const lines = output.split("\n");
  let clipped = output;
  let truncated = false;

  if (lines.length > OUTPUT_LINE_LIMIT) {
    clipped = lines.slice(0, OUTPUT_LINE_LIMIT).join("\n");
    truncated = true;
  }

  if (clipped.length > OUTPUT_CHAR_LIMIT) {
    clipped = clipped.slice(0, OUTPUT_CHAR_LIMIT);
    truncated = true;
  }

  return { text: clipped, truncated };
};

const StatusBadge: FunctionComponent<{ status?: string | null }> = ({ status }) => {
  const normalized = (status || "").toLowerCase();

  if (normalized === "failed" || normalized === "error") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-status-red/10 px-2 py-0.5 text-[10px] font-medium text-status-red">
        <AlertCircle size={11} /> failed
      </span>
    );
  }

  if (normalized === "running" || normalized === "in_progress" || normalized === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-signal-500/10 px-2 py-0.5 text-[10px] font-medium text-signal-500">
        <Loader2 size={11} className="motion-safe:animate-spin" /> running
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-status-green/10 px-2 py-0.5 text-[10px] font-medium text-status-green">
      <CheckCircle2 size={11} /> done
    </span>
  );
};

export const ToolCallWidget: FunctionComponent<ToolCallWidgetProps> = ({
  toolName,
  status,
  args,
  output,
  tokens,
  callId,
}) => {
  const [expanded, setExpanded] = useState(false);
  const name = toolName || "tool";
  const kind = classifyTool(name);
  const Icon = ICONS[kind];
  const summary = summarize(name, args);
  const totalTokens = tokens?.total ?? ((tokens?.input ?? 0) + (tokens?.output ?? 0));
  const hasDetails = Boolean((args && args.trim()) || (output && output.trim()));
  const { text: clippedOutput, truncated } = output ? truncateOutput(output) : { text: "", truncated: false };
  const isEdit = kind === "edit";

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.02] dark:border-white/[0.06] dark:bg-white/[0.02]">
      <button
        type="button"
        disabled={!hasDetails}
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors ${
          hasDetails ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" : "cursor-default"
        }`}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-signal-500/[0.1]">
          <Icon size={15} className="text-signal-600 dark:text-signal-400" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-2">
            <span className="font-mono text-[12px] font-semibold text-slate-700 dark:text-slate-200">{name}</span>
            <StatusBadge status={status} />
          </span>
          {summary && (
            <span className="truncate font-mono text-[11px] text-slate-500 dark:text-slate-400">{summary}</span>
          )}
        </span>
        {totalTokens > 0 && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-black/[0.04] px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/[0.05] dark:text-slate-400">
            <Hash size={10} /> {formatTokenCount(totalTokens)}
          </span>
        )}
        {callId && (
          <span className="hidden shrink-0 font-mono text-[10px] text-slate-400 dark:text-slate-600 sm:inline">
            {shortenIdentifier(callId)}
          </span>
        )}
        {hasDetails && (
          <ChevronRight
            size={15}
            className={`shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>

      {expanded && hasDetails && (
        <div className="space-y-3 border-t border-black/[0.04] px-3 py-3 dark:border-white/[0.04]">
          {args && args.trim() && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Input</div>
              <pre className="max-h-72 overflow-auto rounded-lg bg-black/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-black/30 dark:text-slate-300">
                {args}
              </pre>
            </div>
          )}
          {output && output.trim() && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Output</div>
              <pre className="max-h-80 overflow-auto rounded-lg bg-black/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-slate-600 dark:bg-black/30 dark:text-slate-300">
                {isEdit
                  ? clippedOutput.split("\n").map((line, idx) => (
                      <div
                        key={idx}
                        className={
                          line.startsWith("+") && !line.startsWith("+++")
                            ? "text-status-green"
                            : line.startsWith("-") && !line.startsWith("---")
                              ? "text-status-red"
                              : ""
                        }
                      >
                        {line || " "}
                      </div>
                    ))
                  : clippedOutput}
                        {truncated && <div className="mt-1 text-slate-400">... output truncated</div>}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
