import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../hooks/use-reduced-motion.js";
import { Terminal } from "lucide-preact";
import type { ExecutionRuntimeEventSummary } from "../../types.js";
import { getOriginatorCfg, getExecutionEventText } from "../lib/live-session-config.js";
import { formatTime } from "../../lib/time.js";

const RuntimeEventFeed: FunctionComponent<{ events?: ExecutionRuntimeEventSummary[] }> = memo(({ events }) => {
    const feedRef = useRef<HTMLDivElement>(null);
    const prevCountRef = useRef<number>(0);
    const reducedMotion = useReducedMotion();

    useLayoutEffect(() => {
        if (!feedRef.current || reducedMotion || !events) {
            prevCountRef.current = events?.length || 0;
            return;
        }

        const currentCount = events.length;
        if (currentCount > prevCountRef.current) {
            const newElements = Array.from(feedRef.current.children).filter(el => !el.hasAttribute('data-entered'));

            if (newElements.length > 0) {
                gsap.fromTo(newElements,
                    { opacity: 0, x: 10, scale: 0.98, filter: 'blur(2px)' },
                    { opacity: 1, x: 0, scale: 1, filter: 'blur(0px)', duration: 0.4, stagger: 0.05, ease: "power3.out" }
                );
                newElements.forEach(el => el.setAttribute('data-entered', 'true'));
            }
        }
        prevCountRef.current = currentCount;
    }, [events?.length, reducedMotion]);

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
            <div className="flex items-center justify-center py-12 text-slate-400 dark:text-slate-600">
                <div className="text-center">
                    <Terminal className="w-6 h-6 mx-auto mb-3 opacity-40" strokeWidth={1} />
                    <p className="text-xs font-mono">Awaiting runtime events...</p>
                </div>
            </div>
        );
    }

    return (
        <div ref={feedRef} className="max-h-64 overflow-y-auto pr-2 dashboard-scrollbar space-y-1" aria-live="polite">
            {events.map((event) => {
                const cfg = getOriginatorCfg(event.originator || "system");
                return (
                    <div key={event.id} className={`flex gap-3 border-l-2 ${cfg.border} pl-3 py-2 group/entry hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded-r-lg transition-colors duration-200`}>
                        <div className="flex-grow min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                                <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${cfg.text}`}>
                                    {cfg.label}
                                </span>
                                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-slate-400">
                                    {event.eventType.replace(/_/g, " ")}
                                </span>
                                <span className="text-[9px] text-slate-400 dark:text-slate-600 font-mono">
                                    {formatTime(event.createdAt)}
                                </span>
                            </div>
                            <div className="text-[12px] text-slate-600 dark:text-slate-400 leading-relaxed font-mono line-clamp-2 group-hover/entry:line-clamp-none transition-all cursor-default">
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
