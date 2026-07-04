import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion, useResolvedMotionDuration } from "../hooks/use-reduced-motion.js";
import { INTERACTION_TOKENS } from "../../v2/lib/motion/tokens.js";
import { Terminal, Activity } from "lucide-preact";
import type { ExecutionRuntimeEventSummary } from "../../types.js";
import { getOriginatorCfg, getExecutionEventText } from "../lib/live-session-config.js";
import { formatTime } from "../../lib/time.js";

const RuntimeEventFeed: FunctionComponent<{ events?: ExecutionRuntimeEventSummary[] }> = memo(({ events }) => {
    const feedRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const isReducedMotion = useReducedMotion();
    const durationStr = INTERACTION_TOKENS?.enterExit?.duration || "300ms";
    const duration = useResolvedMotionDuration(parseFloat(durationStr) / 1000);

    useLayoutEffect(() => {
        if (!feedRef.current || isReducedMotion || !events) {
            prevCountRef.current = events?.length || 0;
            return;
        }

        const currentCount = events.length;
        if (currentCount > prevCountRef.current) {
            const newElements = Array.from(feedRef.current.children).filter(el => !el.hasAttribute('data-entered'));

            if (newElements.length > 0) {
                gsap.fromTo(newElements,
                    { opacity: 0, x: 10, backgroundColor: 'rgba(0,224,160,0.1)' },
                    { opacity: 1, x: 0, backgroundColor: 'transparent', duration: duration, stagger: 0.05, ease: INTERACTION_TOKENS?.enterExit?.ease || "power3.out" }
                );
                newElements.forEach(el => el.setAttribute('data-entered', 'true'));
            }
        }
        prevCountRef.current = currentCount;
    }, [events?.length, isReducedMotion, duration]);

    useEffect(() => {
        const el = feedRef.current;
        if (!el) return;
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distanceFromBottom < 120) {
            el.scrollTop = el.scrollHeight;
        }
    }, [events]);

    if (!events || events.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center rounded-xl border border-black/[0.04] bg-black/[0.015] py-12 text-slate-400 dark:border-white/[0.04] dark:bg-white/[0.015] dark:text-slate-600">
                <Activity className="w-8 h-8 mb-3 opacity-40 text-signal-500" strokeWidth={1.5} />
                <p className="text-sm font-bold tracking-tight text-slate-600 dark:text-slate-400">No runtime events yet</p>
                <p className="text-xs mt-1 font-mono opacity-80">Listening for execution activity...</p>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="max-h-[50dvh] space-y-2 overflow-y-auto pr-1 dashboard-scrollbar sm:max-h-64" aria-live="polite" role="log" aria-label="Runtime feed">
            {events.map((event) => {
                const cfg = getOriginatorCfg(event.originator || "system");
                const isError = event.eventType.toLowerCase().includes("error") || event.eventType.toLowerCase().includes("fail");
                return (
                    <div key={event.id} className={`group/entry rounded-r-xl rounded-l-sm border border-l-2 border-black/[0.04] bg-black/[0.015] p-3 pl-3 transition-colors hover:border-signal-500/25 hover:bg-signal-500/[0.035] dark:border-white/[0.04] dark:bg-white/[0.015] ${isError ? 'border-l-status-red bg-status-red/[0.04]' : cfg.border}`}>
                        <div className="flex-grow min-w-0">
                            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${isError ? 'text-status-red' : cfg.text}`}>
                                    {cfg.label}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                    {event.eventType.replace(/_/g, " ")}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono">
                                    {formatTime(event.createdAt)}
                                </span>
                            </div>
                            <div className="line-clamp-2 cursor-default break-words font-mono text-[12px] leading-relaxed text-slate-600 transition-all group-hover/entry:line-clamp-none dark:text-slate-400">
                                {getExecutionEventText(event)}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
});

export { RuntimeEventFeed };
