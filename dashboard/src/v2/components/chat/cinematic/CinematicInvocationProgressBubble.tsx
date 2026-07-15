import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { RefreshCw, Wrench } from "lucide-preact";
import { renderMarkdown } from "../../../../lib/markdown.js";
import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";
import { useDashboardI18n } from "../../../i18n/context.js";
import { chatMessages } from "../../../i18n/messages/chat.js";

export interface CinematicInvocationProgressBubbleProps {
  invocationId: string;
  message: string | null;
  toolCount: number;
}

const PROGRESS_MARKDOWN_CLASSES = [
  "prose prose-sm max-w-none break-words text-[14px] leading-7 text-slate-700 dark:text-slate-200",
  "lg:text-[15px] lg:leading-8 xl:text-base xl:leading-8 2xl:text-[17px] 2xl:leading-9",
  "prose-headings:text-inherit prose-p:text-inherit prose-strong:text-inherit prose-code:text-inherit prose-pre:overflow-x-auto",
  "[&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
  "[&_th]:whitespace-nowrap [&_th]:border-b [&_th]:border-black/10 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-[10px] [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-[0.12em] [&_th]:text-slate-500",
  "[&_td]:border-b [&_td]:border-black/[0.05] [&_td]:px-3 [&_td]:py-2 [&_td]:text-[13px]",
  "dark:[&_th]:border-white/10 dark:[&_th]:text-slate-400 dark:[&_td]:border-white/[0.06]",
].join(" ");

/** Ephemeral projection of the selected Project Manager invocation transcript. */
export const CinematicInvocationProgressBubble: FunctionComponent<CinematicInvocationProgressBubbleProps> = ({
  invocationId,
  message,
  toolCount,
}) => {
  const bubbleRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const { formatNumber, translate, translatePlural } = useDashboardI18n();
  const toolLabel = translatePlural(chatMessages, "toolsUsed", toolCount, { count: formatNumber(toolCount) });

  useLayoutEffect(() => {
    if (!bubbleRef.current || reducedMotion) return;
    gsap.fromTo(
      bubbleRef.current,
      { opacity: 0, y: 10, scale: 0.985 },
      { opacity: 1, y: 0, scale: 1, duration: 0.42, ease: "power3.out" },
    );
  }, [invocationId, message, reducedMotion]);

  return (
    <div
      ref={bubbleRef}
      data-testid="cinematic-invocation-progress"
      data-invocation-id={invocationId}
      className="relative flex min-h-[104px] shrink-0 justify-start md:min-h-[112px]"
    >
      <span
        aria-hidden="true"
        className="absolute -left-1.5 top-7 hidden h-3.5 w-3.5 rotate-45 border-b border-l border-signal-500/30 bg-signal-50/95 dark:bg-void-800/95 md:block"
      />
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy="true"
        className="flex max-h-[min(30vh,280px)] min-h-0 w-full max-w-[720px] flex-col rounded-3xl rounded-tl-lg border border-signal-500/30 bg-signal-50/95 p-4 shadow-[0_12px_48px_rgba(0,224,160,0.12),0_4px_24px_rgba(0,0,0,0.06)] backdrop-blur-md dark:bg-void-800/95 md:max-h-[160px] lg:max-w-[680px] lg:p-5 xl:max-h-[170px] xl:max-w-[780px] 2xl:max-h-[220px] 2xl:max-w-[880px]"
      >
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-signal-500/15 pb-2.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-signal-700 dark:text-signal-300">
            <RefreshCw className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            {translate(chatMessages, "progressInProgress")}
          </span>
          <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-slate-500 dark:text-slate-400">
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            {toolLabel}
          </span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 pr-1">
          {message ? (
            <div
              className={PROGRESS_MARKDOWN_CLASSES}
              dangerouslySetInnerHTML={{ __html: renderMarkdown(message) }}
            />
          ) : (
            <p className="text-[13px] leading-6 text-slate-500 dark:text-slate-400 lg:text-[14px] lg:leading-7">
              {translate(chatMessages, "preparingProgressUpdate")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
