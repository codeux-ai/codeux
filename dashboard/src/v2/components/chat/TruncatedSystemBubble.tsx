import { useState, useMemo, type FunctionComponent } from "preact/compat";
import { ChevronDown } from "lucide-preact";
import { ChatAvatar } from "./ChatAvatar.js";
import { renderMarkdown } from "../../../lib/markdown.js";

export interface TruncatedSystemBubbleProps {
  content: string;
}

export const TruncatedSystemBubble: FunctionComponent<TruncatedSystemBubbleProps> = ({ content }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Memoize rendered HTML to prevent expensive re-parsing on expand/collapse toggles
  const renderedContent = useMemo(() => {
    return { __html: renderMarkdown(content) };
  }, [content]);

  return (
    <div className="flex justify-start">
      <div className="flex max-w-[760px] items-start w-full gap-3 flex-row">
        <div className="mt-1 shrink-0 w-8 h-8 flex items-center justify-center">
          <ChatAvatar role="system" />
        </div>

        <div className="flex flex-col w-full max-w-[calc(100%-3rem)] rounded-2xl rounded-tl-sm border bg-slate-100/50 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700 p-4 pb-2 shadow-[0_2px_16px_rgba(0,0,0,0.04)]">

          <div className="flex items-center gap-3 mb-2 text-[11px] font-mono text-slate-400 justify-start">
            <span className="font-semibold text-slate-300 capitalize flex items-center gap-1.5">
              system
            </span>
          </div>

          <div className="relative">
            {/*
              We use a max-height transition.
              Collapsed max-h-[4.5rem] allows about 3 lines of text.
              Expanded max-h-[5000px] ensures it's large enough for any prompt.
            */}
            <div
              className={`prose prose-sm max-w-none text-sm leading-6 text-slate-400 prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit break-words overflow-hidden transition-[max-height] duration-300 ease-in-out ${
                isExpanded ? "max-h-[5000px]" : "max-h-[4.5rem]"
              }`}
              dangerouslySetInnerHTML={renderedContent}
            />

            {/* Gradient overlay when collapsed to indicate more text below */}
            {!isExpanded && (
              <div className="absolute bottom-0 inset-x-0 h-8 bg-gradient-to-t from-slate-900/80 to-transparent pointer-events-none" />
            )}
          </div>

          {/* Expand/Collapse Toggle Button */}
          <div className="mt-2 flex justify-center border-t border-slate-700/50 pt-2">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs text-slate-500 hover:text-slate-300 transition-colors rounded-full hover:bg-slate-800"
              aria-expanded={isExpanded}
            >
              <span>{isExpanded ? "Show less" : "Show full message"}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
              />
            </button>
          </div>

        </div>
      </div>
    </div>
  );
};
