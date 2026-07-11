import type { ComponentChildren, FunctionComponent } from "preact";
import {
  AlertTriangle,
  Brain,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Circle,
  GitBranch,
  GitPullRequest,
  Loader2,
  Minus,
  Rocket,
  Sparkles,
  XCircle,
} from "lucide-preact";
import type { AgentResponseEffect } from "../../../../../../src/contracts/connection-chat-types.js";
import { parseAgentResponseEffectJson } from "../../../lib/agent-response-effects.js";

/* ════════════════════════════════════════════════════════════════════════
 *  Stage widgets — the rich vocabulary agents embed in ordinary markdown.
 *
 *  An agent (or the runtime) emits a fenced block anywhere in a reply:
 *
 *      ```codeux:tasks
 *      { "title": "Sprint SPR-12", "items": [
 *        { "title": "Wire auth flow", "status": "done" },
 *        { "title": "Checkout page", "status": "active", "meta": "worker-2" }
 *      ]}
 *      ```
 *
 *  parseBubbleSegments() splits a reply into markdown + widget segments; the
 *  speech bubble renders each in place. Malformed JSON or unknown types fall
 *  back to the original fenced block, so nothing is ever silently dropped.
 *
 *  Design rules (dataviz method): status is never color-alone — every state
 *  pairs an icon + label; values and labels wear text tokens, the accent
 *  color only marks identity; progress bars are thin, rounded, single-hue.
 * ════════════════════════════════════════════════════════════════════════ */

export type StageWidgetType = "status" | "tasks" | "sprint" | "metrics" | "memory" | "actions";

export interface StageWidget {
  type: StageWidgetType;
  data: Record<string, unknown>;
}

export type BubbleSegment =
  | { kind: "markdown"; markdown: string }
  | { kind: "widget"; widget: StageWidget }
  | { kind: "agent"; effect: AgentResponseEffect };

const WIDGET_FENCE = /```codeux:([a-z]+)[ \t]*\n([\s\S]*?)```/g;
const WIDGET_TYPES: StageWidgetType[] = ["status", "tasks", "sprint", "metrics", "memory", "actions"];

/** Split reply markdown into ordinary markdown and codeux widget segments. */
export function parseBubbleSegments(markdown: string): BubbleSegment[] {
  const segments: BubbleSegment[] = [];
  let cursor = 0;
  WIDGET_FENCE.lastIndex = 0;
  for (let match = WIDGET_FENCE.exec(markdown); match; match = WIDGET_FENCE.exec(markdown)) {
    const [raw, type, body] = match;
    let widget: StageWidget | null = null;
    const agentEffect = type === "agent" ? parseAgentResponseEffectJson(body) : undefined;
    if ((WIDGET_TYPES as string[]).includes(type)) {
      try {
        const data = JSON.parse(body);
        if (data && typeof data === "object" && !Array.isArray(data)) {
          widget = { type: type as StageWidgetType, data: data as Record<string, unknown> };
        }
      } catch {
        widget = null;
      }
    }
    if (!widget && !agentEffect) {
      if (type !== "agent") continue; // leave unknown/malformed widget fences untouched
      if (match.index > cursor) {
        segments.push({ kind: "markdown", markdown: markdown.slice(cursor, match.index) });
      }
      segments.push({ kind: "markdown", markdown: raw.replace(/^```codeux:agent[^\n]*/, "```json") });
      cursor = match.index + raw.length;
      continue;
    }
    if (match.index > cursor) {
      segments.push({ kind: "markdown", markdown: markdown.slice(cursor, match.index) });
    }
    if (agentEffect) {
      segments.push({ kind: "agent", effect: agentEffect });
    } else if (widget) {
      segments.push({ kind: "widget", widget });
    }
    cursor = match.index + raw.length;
  }
  if (cursor < markdown.length) {
    segments.push({ kind: "markdown", markdown: markdown.slice(cursor) });
  }
  if (segments.length === 0) {
    segments.push({ kind: "markdown", markdown });
  }
  return segments;
}

/* ── Shared bits ── */

type StateId = "ok" | "warn" | "error" | "running" | "todo";

const STATE_META: Record<StateId, { icon: typeof Check; label: string; text: string; chip: string }> = {
  ok: { icon: Check, label: "OK", text: "text-signal-600 dark:text-signal-400", chip: "border-signal-500/25 bg-signal-500/10" },
  running: { icon: Loader2, label: "Running", text: "text-signal-600 dark:text-signal-400", chip: "border-signal-500/25 bg-signal-500/10" },
  warn: { icon: AlertTriangle, label: "Warning", text: "text-status-amber", chip: "border-status-amber/25 bg-status-amber/10" },
  error: { icon: XCircle, label: "Failed", text: "text-status-red", chip: "border-status-red/25 bg-status-red/10" },
  todo: { icon: Circle, label: "Pending", text: "text-slate-500 dark:text-slate-400", chip: "border-black/[0.08] bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.04]" },
};

const toState = (value: unknown): StateId => {
  const v = String(value ?? "").toLowerCase();
  if (v === "ok" || v === "success" || v === "done" || v === "passed" || v === "good" || v === "stored" || v === "remembered") return "ok";
  if (v === "running" || v === "active" || v === "executing" || v === "in_progress") return "running";
  if (v === "warn" || v === "warning" || v === "blocked" || v === "degraded") return "warn";
  if (v === "error" || v === "failed" || v === "critical") return "error";
  return "todo";
};

const str = (value: unknown): string => (typeof value === "string" ? value : typeof value === "number" ? String(value) : "");
const arr = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];

const StateBadge: FunctionComponent<{ state: StateId; label?: string }> = ({ state, label }) => {
  const meta = STATE_META[state];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] ${meta.chip} ${meta.text}`}>
      <Icon className={`h-3 w-3 ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
      {label || meta.label}
    </span>
  );
};

const ProgressBar: FunctionComponent<{ done: number; total: number }> = ({ done, total }) => {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div className="flex items-center gap-3">
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.08]"
      >
        <div className="h-full rounded-full bg-signal-500 transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      <span className="font-mono text-[11px] font-semibold tabular-nums text-slate-600 dark:text-slate-300">
        {done}/{total} · {pct}%
      </span>
    </div>
  );
};

const WidgetShell: FunctionComponent<{ children: ComponentChildren }> = ({ children }) => (
  <div className="my-3 rounded-2xl border border-black/[0.07] bg-white/70 p-4 shadow-[0_2px_12px_rgba(0,0,0,0.04)] backdrop-blur-sm dark:border-white/[0.08] dark:bg-white/[0.03]">
    {children}
  </div>
);

const WidgetTitle: FunctionComponent<{ icon: typeof Check; title: string; trailing?: ComponentChildren }> = ({ icon: Icon, title, trailing }) => (
  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
    <span className="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
      <Icon className="h-3.5 w-3.5 text-signal-500" aria-hidden="true" />
      {title}
    </span>
    {trailing}
  </div>
);

/* ── codeux:status — service/pipeline health card ── */
const StatusWidget: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => {
  const items = arr(data.items);
  return (
    <WidgetShell>
      <WidgetTitle icon={CircleDot} title={str(data.title) || "Status"} trailing={<StateBadge state={toState(data.state)} />} />
      {items.length > 0 && (
        <div className="grid gap-1.5 sm:grid-cols-2">
          {items.map((item, index) => {
            const state = toState(item.state);
            const meta = STATE_META[state];
            const Icon = meta.icon;
            return (
              <div key={index} className="flex items-center justify-between gap-2 rounded-xl border border-black/[0.05] bg-black/[0.02] px-3 py-2 dark:border-white/[0.06] dark:bg-white/[0.02]">
                <span className="truncate text-[13px] font-medium text-slate-700 dark:text-slate-200">{str(item.label)}</span>
                <span className={`inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold ${meta.text}`}>
                  <Icon className={`h-3.5 w-3.5 ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                  {str(item.value) || meta.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {str(data.note) && <p className="mt-2.5 text-[12px] leading-5 text-slate-500 dark:text-slate-400">{str(data.note)}</p>}
    </WidgetShell>
  );
};

/* ── codeux:tasks — checklist with live progress ── */
const TasksWidget: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => {
  const items = arr(data.items);
  const done = items.filter((item) => toState(item.status) === "ok").length;
  return (
    <WidgetShell>
      <WidgetTitle icon={Check} title={str(data.title) || "Tasks"} />
      <ProgressBar done={done} total={items.length} />
      <ul className="mt-3 space-y-1">
        {items.map((item, index) => {
          const state = toState(item.status);
          const meta = STATE_META[state];
          const Icon = meta.icon;
          return (
            <li key={index} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5">
              <Icon className={`h-4 w-4 shrink-0 ${meta.text} ${state === "running" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
              <span className={`min-w-0 flex-1 truncate text-[13.5px] ${state === "ok" ? "text-slate-400 line-through dark:text-slate-500" : "text-slate-800 dark:text-slate-100"}`}>
                {str(item.title)}
              </span>
              <span className="sr-only">{meta.label}</span>
              {str(item.meta) && (
                <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">{str(item.meta)}</span>
              )}
            </li>
          );
        })}
      </ul>
    </WidgetShell>
  );
};

/* ── codeux:sprint — sprint hero card ── */
const SprintWidget: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => {
  const done = Number(data.done) || 0;
  const total = Number(data.total) || 0;
  return (
    <WidgetShell>
      <WidgetTitle
        icon={Rocket}
        title={str(data.key) || "Sprint"}
        trailing={<StateBadge state={toState(data.status)} label={str(data.status) || undefined} />}
      />
      <div className="font-display text-xl font-black tracking-tight text-slate-900 dark:text-white">
        {str(data.name) || "Untitled sprint"}
      </div>
      {total > 0 && <div className="mt-3"><ProgressBar done={done} total={total} /></div>}
      {(str(data.branch) || str(data.pr)) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {str(data.branch) && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
              <GitBranch className="h-3 w-3" aria-hidden="true" />
              {str(data.branch)}
            </span>
          )}
          {str(data.pr) && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-black/[0.08] bg-black/[0.03] px-2.5 py-1 font-mono text-[11px] text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
              <GitPullRequest className="h-3 w-3" aria-hidden="true" />
              {str(data.pr)}
            </span>
          )}
        </div>
      )}
    </WidgetShell>
  );
};

/* ── codeux:metrics — stat tile row ── */
const MetricsWidget: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => {
  const items = arr(data.items);
  return (
    <WidgetShell>
      {str(data.title) && <WidgetTitle icon={Sparkles} title={str(data.title)} />}
      <div className="flex flex-wrap items-stretch divide-x divide-black/[0.06] overflow-hidden rounded-xl border border-black/[0.06] bg-black/[0.02] dark:divide-white/[0.06] dark:border-white/[0.06] dark:bg-white/[0.02]">
        {items.map((item, index) => {
          const tone = String(item.tone ?? "flat");
          const DeltaIcon = tone === "up" ? ArrowUpRight : tone === "down" ? ArrowDownRight : Minus;
          const deltaText = tone === "up" ? "text-signal-600 dark:text-signal-400" : tone === "down" ? "text-status-red" : "text-slate-400";
          return (
            <div key={index} className="flex min-w-[110px] flex-1 flex-col gap-0.5 px-3.5 py-2.5">
              <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">{str(item.label)}</span>
              <span className="font-mono text-[15px] font-semibold tabular-nums text-slate-800 dark:text-slate-100">{str(item.value)}</span>
              {str(item.delta) && (
                <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${deltaText}`}>
                  <DeltaIcon className="h-3 w-3" aria-hidden="true" />
                  {str(item.delta)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </WidgetShell>
  );
};

/* ── codeux:memory — durable-learning confirmation ── */
const MemoryWidget: FunctionComponent<{ data: Record<string, unknown> }> = ({ data }) => (
  <WidgetShell>
    <WidgetTitle
      icon={Brain}
      title={str(data.title) || "Long-term memory"}
      trailing={<StateBadge state={toState(data.status || "ok")} label="Remembered" />}
    />
    <blockquote className="rounded-xl border border-signal-500/15 bg-signal-500/[0.05] px-3.5 py-3 text-[13.5px] leading-6 text-slate-800 dark:text-slate-100">
      {str(data.memory) || "Durable project knowledge stored."}
    </blockquote>
    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">
      {str(data.category) && <span>{str(data.category)}</span>}
      {str(data.claimId) && <span className="font-mono normal-case tracking-normal">Claim {str(data.claimId).slice(0, 8)}</span>}
    </div>
  </WidgetShell>
);

/* ── codeux:actions — suggested next steps that dispatch immediately ── */
const ActionsWidget: FunctionComponent<{ data: Record<string, unknown>; onAction?: (prompt: string) => void }> = ({ data, onAction }) => {
  const items = arr(data.items);
  return (
    <div className="my-3 flex flex-wrap gap-2">
      {items.map((item, index) => (
        <button
          key={index}
          type="button"
          onClick={() => onAction?.(str(item.prompt) || str(item.label))}
          className="inline-flex items-center gap-2 rounded-full border border-signal-500/25 bg-signal-500/[0.08] px-4 py-2 text-[12px] font-semibold text-signal-700 transition hover:border-signal-500/45 hover:bg-signal-500/15 dark:text-signal-400"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          {str(item.label)}
        </button>
      ))}
    </div>
  );
};

export const StageWidgetRenderer: FunctionComponent<{ widget: StageWidget; onAction?: (prompt: string) => void }> = ({ widget, onAction }) => {
  switch (widget.type) {
    case "status":
      return <StatusWidget data={widget.data} />;
    case "tasks":
      return <TasksWidget data={widget.data} />;
    case "sprint":
      return <SprintWidget data={widget.data} />;
    case "metrics":
      return <MetricsWidget data={widget.data} />;
    case "memory":
      return <MemoryWidget data={widget.data} />;
    case "actions":
      return <ActionsWidget data={widget.data} onAction={onAction} />;
    default:
      return null;
  }
};
