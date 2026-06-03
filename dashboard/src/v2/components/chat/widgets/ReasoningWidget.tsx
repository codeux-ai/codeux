import { type FunctionComponent } from "preact";
import { useState } from "preact/hooks";
import { Brain, ChevronRight } from "lucide-preact";

export interface ReasoningWidgetProps {
  text: string;
}

const PREVIEW_CHARS = 180;

export const ReasoningWidget: FunctionComponent<ReasoningWidgetProps> = ({ text }) => {
  const [expanded, setExpanded] = useState(false);
  const trimmed = (text || "").trim();
  const isLong = trimmed.length > PREVIEW_CHARS;
  const preview = isLong ? `${trimmed.slice(0, PREVIEW_CHARS).trimEnd()}...` : trimmed;

  return (
    <div className="overflow-hidden rounded-xl border border-dashed border-black/[0.07] bg-black/[0.015] dark:border-white/[0.08] dark:bg-white/[0.015]">
      <button
        type="button"
        disabled={!isLong}
        onClick={() => setExpanded((v) => !v)}
        className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
          isLong ? "hover:bg-black/[0.03] dark:hover:bg-white/[0.03]" : "cursor-default"
        }`}
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-violet-500/[0.1]">
          <Brain size={13} className="text-violet-500 dark:text-violet-400" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Reasoning</span>
        {isLong && (
          <ChevronRight
            size={14}
            className={`ml-auto shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
          />
        )}
      </button>
      <div className="px-3 pb-3 pt-0">
        <p className="whitespace-pre-wrap text-[12.5px] italic leading-relaxed text-slate-500 dark:text-slate-400">
          {expanded || !isLong ? trimmed : preview}
        </p>
      </div>
    </div>
  );
};
