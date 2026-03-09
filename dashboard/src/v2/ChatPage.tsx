import type { FunctionComponent } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import gsap from "gsap";
import {
    MessageCircle, Sparkles, ArrowUp, Paperclip, Plus,
    RotateCcw, Copy, ThumbsUp, ThumbsDown, Cpu, ChevronDown,
} from "lucide-preact";

/* ─── Types ─────────────────────────────────────────────────────────────── */

type Role = 'assistant' | 'user';

interface Message {
    id: string;
    role: Role;
    content: string;
    time: string;
    tokens?: number;
}

/* ─── Mock data ──────────────────────────────────────────────────────────── */

const INITIAL_MESSAGES: Message[] = [
    {
        id: 'm1',
        role: 'assistant',
        content: "Hello. I'm Jules — your AI engineering partner with full context over your active projects, sprint history, and task backlog.\n\nWhat would you like to work on today?",
        time: '09:41',
    },
    {
        id: 'm2',
        role: 'user',
        content: "Give me a quick status summary of auth-service.",
        time: '09:42',
    },
    {
        id: 'm3',
        role: 'assistant',
        content: "**auth-service** is live and running.\n\n- **Open tasks:** 5 — 3 in progress, 2 queued\n- **Completed:** 12 tasks across 2 active sprints\n- **Last activity:** 5 minutes ago\n- **Velocity:** On track — 85% sprint completion rate\n\nThe most recent task is *\"OAuth2 token refresh flow\"* — currently in progress. Want me to draft the next sprint, assign a task, or dive deeper into a specific issue?",
        time: '09:42',
        tokens: 312,
    },
    {
        id: 'm4',
        role: 'user',
        content: "Draft a new sprint focusing on the payment-gateway stability issues.",
        time: '09:44',
    },
    {
        id: 'm5',
        role: 'assistant',
        content: "Here's a draft sprint for **payment-gateway** stability:\n\n**Sprint: Gateway Hardening — Dec 11 – Dec 25**\n\n1. Retry logic for failed Stripe webhook deliveries\n2. Idempotency key enforcement on charge endpoints\n3. Circuit breaker implementation for downstream timeout cascades\n4. Add p95 latency alerting via Datadog\n5. Comprehensive integration test suite for edge-case flows\n\nEstimated scope: 18–22 tasks. Should I create this sprint, adjust the scope, or add it to the backlog for review?",
        time: '09:44',
        tokens: 487,
    },
];

const SUGGESTIONS = [
    "Summarize open tasks across all projects",
    "What sprints are running right now?",
    "Draft a retrospective for the last sprint",
    "Show me the highest-priority blockers",
];

/* ─── Helpers ────────────────────────────────────────────────────────────── */

/** Renders content with basic **bold** and \n→<br> support */
const RichText: FunctionComponent<{ text: string }> = ({ text }) => {
    const lines = text.split('\n');
    return (
        <div className="flex flex-col gap-1.5">
            {lines.map((line, i) => {
                const parts = line.split(/\*\*(.*?)\*\*/g);
                return (
                    <p key={i} className={line.startsWith('-') || line.startsWith('•') ? 'flex gap-2' : ''}>
                        {parts.map((part, j) =>
                            j % 2 === 1
                                ? <strong key={j} className="font-semibold text-slate-900 dark:text-white">{part}</strong>
                                : <span key={j}>{part}</span>
                        )}
                    </p>
                );
            })}
        </div>
    );
};

/* ─── Typing Indicator ───────────────────────────────────────────────────── */

const TypingIndicator: FunctionComponent = () => (
    <div className="flex items-start gap-4">
        <div className="w-8 h-8 rounded-[0.875rem] bg-signal-500/[0.1] dark:bg-signal-500/[0.12]
                        border border-signal-500/20 flex items-center justify-center shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-signal-500 animate-pulse" strokeWidth={1.5} />
        </div>
        <div className="bg-white/70 dark:bg-void-800/60 backdrop-blur-xl
                        border border-black/[0.06] dark:border-white/[0.06]
                        rounded-[1.5rem] rounded-tl-sm px-5 py-4
                        shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.2)]
                        flex items-center gap-2">
            {[0, 1, 2].map(i => (
                <div
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-slate-400 dark:bg-slate-500"
                    style={{ animation: 'typing-dot 1.4s ease-in-out infinite', animationDelay: `${i * 0.18}s` }}
                />
            ))}
        </div>
    </div>
);

/* ─── Message Bubble ─────────────────────────────────────────────────────── */

const AssistantBubble: FunctionComponent<{ msg: Message }> = ({ msg }) => (
    <div className="flex items-start gap-4 group/msg">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-[0.875rem] bg-signal-500/[0.1] dark:bg-signal-500/[0.12]
                        border border-signal-500/20 dark:border-signal-500/25
                        flex items-center justify-center shrink-0 mt-0.5
                        shadow-[0_0_16px_rgba(0,224,160,0.08)]">
            <Sparkles className="w-3.5 h-3.5 text-signal-500" strokeWidth={1.5} />
        </div>

        <div className="flex-1 max-w-[720px] min-w-0">
            {/* Bubble */}
            <div className="relative overflow-hidden
                            bg-white/70 dark:bg-void-800/60 backdrop-blur-xl
                            border border-black/[0.06] dark:border-white/[0.06]
                            rounded-[1.5rem] rounded-tl-sm
                            px-6 pt-5 pb-4
                            shadow-[0_2px_16px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.18)]">
                {/* Signal accent line */}
                <div className="absolute left-0 top-5 bottom-5 w-[2px]
                                bg-gradient-to-b from-signal-500/0 via-signal-500/35 to-signal-500/0
                                rounded-full pointer-events-none" />
                <div className="pl-2 text-[14.5px] text-slate-600 dark:text-slate-300 leading-[1.7] font-sans">
                    <RichText text={msg.content} />
                </div>
            </div>

            {/* Meta + actions */}
            <div className="flex items-center gap-4 mt-2 pl-2">
                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">{msg.time}</span>
                {msg.tokens && (
                    <span className="text-[9px] font-mono text-slate-300 dark:text-slate-700">
                        {msg.tokens} tokens
                    </span>
                )}
                {/* Hover actions */}
                <div className="flex items-center gap-0.5 opacity-0 group-hover/msg:opacity-100 transition-opacity duration-200">
                    {[
                        { icon: Copy,      label: 'Copy'       },
                        { icon: ThumbsUp,  label: 'Good'       },
                        { icon: ThumbsDown,label: 'Bad'        },
                        { icon: RotateCcw, label: 'Regenerate' },
                    ].map(({ icon: Icon, label }) => (
                        <button
                            key={label}
                            title={label}
                            className="w-6 h-6 flex items-center justify-center rounded-lg
                                       text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                                       hover:bg-black/[0.05] dark:hover:bg-white/[0.05]
                                       transition-colors duration-150"
                        >
                            <Icon className="w-3 h-3" strokeWidth={1.75} />
                        </button>
                    ))}
                </div>
            </div>
        </div>
    </div>
);

const UserBubble: FunctionComponent<{ msg: Message }> = ({ msg }) => (
    <div className="flex items-start gap-4 flex-row-reverse group/msg">
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-white dark:bg-void-700 border border-black/[0.06] dark:border-white/[0.06]
                        flex items-center justify-center shrink-0 mt-0.5 overflow-hidden">
            <img
                src="https://api.dicebear.com/7.x/notionists/svg?seed=Felix&backgroundColor=transparent"
                alt="You"
                className="w-full h-full object-cover"
            />
        </div>

        <div className="flex flex-col items-end max-w-[680px] min-w-0">
            {/* Bubble */}
            <div className="bg-signal-500/[0.08] dark:bg-signal-500/[0.1]
                            border border-signal-500/[0.15] dark:border-signal-500/[0.18]
                            rounded-[1.5rem] rounded-tr-sm
                            px-6 pt-5 pb-4
                            backdrop-blur-md">
                <p className="text-[14.5px] text-slate-900 dark:text-white leading-[1.7] font-sans">
                    {msg.content}
                </p>
            </div>
            <div className="flex items-center gap-3 mt-2 pr-1">
                <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">{msg.time}</span>
            </div>
        </div>
    </div>
);

/* ─── Chat Page ──────────────────────────────────────────────────────────── */

export const ChatPage: FunctionComponent = () => {
    const headerRef   = useRef<HTMLDivElement>(null);
    const messagesRef = useRef<HTMLDivElement>(null);
    const inputRef    = useRef<HTMLTextAreaElement>(null);

    const [messages, setMessages]   = useState<Message[]>(INITIAL_MESSAGES);
    const [input, setInput]         = useState('');
    const [isTyping, setIsTyping]   = useState(false);
    const [showModel, setShowModel] = useState(false);

    /* Entrance animation */
    useLayoutEffect(() => {
        const targets = [headerRef.current, messagesRef.current].filter(Boolean);
        gsap.fromTo(targets,
            { opacity: 0, y: 30 },
            { opacity: 1, y: 0, stagger: 0.1, duration: 0.9, ease: "power4.out", delay: 0.05 },
        );
        if (messagesRef.current) {
            gsap.fromTo(
                Array.from(messagesRef.current.children),
                { opacity: 0, y: 20 },
                { opacity: 1, y: 0, stagger: 0.07, duration: 0.7, ease: "power3.out", delay: 0.2 },
            );
        }
    }, []);

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;

        const userMsg: Message = {
            id: `m${Date.now()}`,
            role: 'user',
            content: text,
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
        };
        setMessages(prev => [...prev, userMsg]);
        setInput('');
        if (inputRef.current) { inputRef.current.style.height = 'auto'; }

        // Simulate AI response
        setIsTyping(true);
        setTimeout(() => {
            const aiMsg: Message = {
                id: `m${Date.now() + 1}`,
                role: 'assistant',
                content: "I'm processing your request with full project context. This is a prototype — in production I'd respond with live data from your connected repositories and sprint backlog.",
                time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }),
                tokens: Math.floor(Math.random() * 300) + 100,
            };
            setIsTyping(false);
            setMessages(prev => [...prev, aiMsg]);
        }, 1800);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="flex flex-col min-h-[calc(100vh-60px)] relative">

            {/* ── Ambient glows ─────────────────────────────────────── */}
            <div aria-hidden className="fixed inset-0 pointer-events-none -z-10">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_-5%_20%,rgba(0,224,160,0.05)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_60%_50%_at_-5%_20%,rgba(0,224,160,0.07)_0%,transparent_60%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_110%_80%,rgba(255,184,0,0.03)_0%,transparent_60%)]
                               dark:bg-[radial-gradient(ellipse_50%_40%_at_110%_80%,rgba(255,184,0,0.04)_0%,transparent_60%)]" />
            </div>

            {/* ── Header ────────────────────────────────────────────── */}
            <div ref={headerRef} className="px-8 md:px-20 pt-14 pb-0 z-10">
                <div className="max-w-[900px] mx-auto w-full">
                    <div className="relative overflow-hidden">
                        {/* Ghost watermark */}
                        <h2
                            aria-hidden
                            className="absolute -top-8 -left-3 text-[7rem] font-black tracking-tighter
                                       text-black/[0.04] dark:text-white/[0.03]
                                       pointer-events-none select-none font-display leading-none"
                        >
                            CHAT
                        </h2>

                        <div className="flex items-end justify-between gap-6 relative z-10">
                            <div>
                                {/* Eyebrow */}
                                <div className="flex items-center gap-2 text-signal-500 font-mono text-[10px] font-bold uppercase tracking-[0.2em] mb-4">
                                    <MessageCircle className="w-3.5 h-3.5" strokeWidth={2.5} />
                                    AI Assistant
                                </div>
                                <h1 className="text-4xl md:text-5xl font-black tracking-tighter text-slate-900 dark:text-white font-display leading-[0.92]">
                                    Jules <span className="text-signal-500">Chat.</span>
                                </h1>
                            </div>

                            {/* Chips */}
                            <div className="flex items-center gap-2.5 shrink-0 mb-1">
                                {/* Model selector */}
                                <div className="relative">
                                    <button
                                        onClick={() => setShowModel(!showModel)}
                                        className="flex items-center gap-2 px-3.5 py-1.5 rounded-full
                                                   bg-black/[0.04] dark:bg-white/[0.04]
                                                   border border-black/[0.06] dark:border-white/[0.06]
                                                   text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400
                                                   hover:border-black/[0.1] dark:hover:border-white/[0.1]
                                                   transition-colors duration-200 group"
                                    >
                                        <Cpu className="w-3 h-3" strokeWidth={1.75} />
                                        claude-sonnet-4-6
                                        <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${showModel ? 'rotate-180' : ''}`} />
                                    </button>
                                    {showModel && (
                                        <div className="absolute right-0 top-full mt-2 w-52
                                                        bg-white/95 dark:bg-void-800/95 backdrop-blur-2xl
                                                        border border-black/[0.06] dark:border-white/[0.08]
                                                        rounded-2xl
                                                        shadow-[0_20px_40px_rgba(0,0,0,0.12)] dark:shadow-[0_20px_40px_rgba(0,0,0,0.4)]
                                                        overflow-hidden z-50 p-1.5">
                                            {[
                                                { id: 'claude-opus-4-6',    label: 'Claude Opus 4.6',    note: 'Most capable' },
                                                { id: 'claude-sonnet-4-6',  label: 'Claude Sonnet 4.6',  note: 'Balanced ·  active' },
                                                { id: 'claude-haiku-4-5',   label: 'Claude Haiku 4.5',   note: 'Fastest' },
                                            ].map(m => (
                                                <button
                                                    key={m.id}
                                                    onClick={() => setShowModel(false)}
                                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-left transition-colors duration-150
                                                        ${m.id === 'claude-sonnet-4-6'
                                                            ? 'bg-signal-500/[0.07] text-signal-600 dark:text-signal-400'
                                                            : 'text-slate-700 dark:text-slate-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.04]'
                                                        }`}
                                                >
                                                    <span className="text-xs font-semibold font-mono">{m.label}</span>
                                                    <span className="text-[9px] font-mono text-slate-400">{m.note}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Context chip */}
                                <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full
                                               bg-signal-500/[0.08] dark:bg-signal-500/[0.1]
                                               border border-signal-500/20 dark:border-signal-500/25
                                               text-[10px] font-mono font-bold text-signal-600 dark:text-signal-400
                                               shadow-[0_0_16px_rgba(0,224,160,0.08)]">
                                    <span className="w-1.5 h-1.5 rounded-full bg-signal-500 animate-pulse" />
                                    jules-cli
                                </div>

                                {/* New thread */}
                                <button
                                    onClick={() => setMessages(INITIAL_MESSAGES)}
                                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full
                                               bg-black/[0.04] dark:bg-white/[0.04]
                                               border border-black/[0.06] dark:border-white/[0.06]
                                               text-[10px] font-mono font-bold text-slate-500 dark:text-slate-400
                                               hover:text-slate-900 dark:hover:text-white
                                               hover:border-black/[0.1] dark:hover:border-white/[0.1]
                                               transition-colors duration-200"
                                >
                                    <Plus className="w-3 h-3" strokeWidth={2.5} />
                                    New thread
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="w-full flex items-center mt-8 mb-0 overflow-hidden">
                        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-black/[0.06] dark:via-white/[0.06] to-transparent" />
                    </div>
                </div>
            </div>

            {/* ── Messages ──────────────────────────────────────────── */}
            {/* pb accounts for fixed input bar height (~80px) + dock clearance (~128px) */}
            <div className="flex-1 px-8 md:px-20 py-8 pb-[220px] z-10">
                <div
                    ref={messagesRef}
                    className="max-w-[900px] mx-auto w-full flex flex-col gap-7"
                >
                    {messages.map(msg =>
                        msg.role === 'assistant'
                            ? <AssistantBubble key={msg.id} msg={msg} />
                            : <UserBubble key={msg.id} msg={msg} />
                    )}
                    {isTyping && <TypingIndicator />}
                </div>
            </div>

            {/* ── Fixed Input Bar — sits right above the KineticDock ── */}
            {/* Dock: fixed bottom-7 (28px), pill ~70px tall → clears at ~100px.  */}
            {/* We sit at bottom-[108px] to give a tight 8px gap above the dock.  */}
            <div className="fixed bottom-[108px] left-0 right-0 z-30 px-8 md:px-20">
                <div className="max-w-[900px] mx-auto w-full">

                    {/* Suggestions — only when no user messages */}
                    {messages.filter(m => m.role === 'user').length === 0 && (
                        <div className="flex flex-wrap gap-2 mb-4">
                            {SUGGESTIONS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => setInput(s)}
                                    className="px-4 py-2 rounded-full
                                               bg-white/60 dark:bg-void-800/60 backdrop-blur-md
                                               border border-black/[0.06] dark:border-white/[0.06]
                                               text-xs font-medium text-slate-600 dark:text-slate-400
                                               hover:border-signal-500/30 hover:text-signal-600 dark:hover:text-signal-400
                                               transition-colors duration-200"
                                >
                                    {s}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* Input card */}
                    <div className="relative flex items-end gap-3
                                    bg-white/75 dark:bg-void-800/65 backdrop-blur-2xl
                                    border border-black/[0.06] dark:border-white/[0.07]
                                    rounded-[1.5rem] p-3 pl-5
                                    shadow-[0_4px_24px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.28)]
                                    focus-within:border-signal-500/30 dark:focus-within:border-signal-500/25
                                    focus-within:shadow-[0_4px_32px_rgba(0,224,160,0.07)] dark:focus-within:shadow-[0_8px_40px_rgba(0,224,160,0.1)]
                                    transition-[border-color,box-shadow] duration-300">
                        <textarea
                            ref={inputRef}
                            value={input}
                            placeholder="Ask Jules anything about your projects…"
                            className="flex-1 bg-transparent text-[15px] text-slate-900 dark:text-white
                                       placeholder-slate-400 dark:placeholder-slate-600
                                       resize-none outline-none min-h-[28px] max-h-[180px]
                                       leading-relaxed py-2 font-sans"
                            rows={1}
                            onInput={(e) => {
                                const el = e.currentTarget;
                                el.style.height = 'auto';
                                el.style.height = `${el.scrollHeight}px`;
                                setInput(el.value);
                            }}
                            onKeyDown={handleKeyDown}
                        />
                        <div className="flex items-center gap-1.5 shrink-0 pb-0.5">
                            <button
                                title="Attach file"
                                className="w-9 h-9 flex items-center justify-center rounded-xl
                                           text-slate-400 hover:text-slate-700 dark:hover:text-slate-200
                                           hover:bg-black/[0.05] dark:hover:bg-white/[0.05]
                                           transition-colors duration-200"
                            >
                                <Paperclip className="w-4 h-4" strokeWidth={1.5} />
                            </button>
                            <button
                                onClick={handleSend}
                                disabled={!input.trim()}
                                className="w-10 h-10 flex items-center justify-center rounded-[0.875rem]
                                           bg-signal-500 hover:bg-signal-400
                                           disabled:bg-black/[0.06] dark:disabled:bg-white/[0.06]
                                           disabled:cursor-not-allowed
                                           text-void-900 disabled:text-slate-400
                                           shadow-[0_0_20px_rgba(0,224,160,0.3)] hover:shadow-[0_0_28px_rgba(0,224,160,0.5)]
                                           disabled:shadow-none
                                           transition-[background-color,box-shadow] duration-200
                                           group"
                            >
                                <ArrowUp
                                    className="w-4 h-4 group-hover:-translate-y-0.5 group-disabled:translate-y-0 transition-transform duration-200"
                                    strokeWidth={2.5}
                                />
                            </button>
                        </div>
                    </div>

                    {/* Bottom hint */}
                    <div className="flex items-center justify-between mt-2.5 px-1">
                        <span className="text-[9px] font-mono text-slate-400 dark:text-slate-600">
                            claude-sonnet-4-6 · jules-cli context active
                        </span>
                        <span className="text-[9px] font-mono text-slate-300 dark:text-slate-700">
                            ⌘ + Enter to send
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
};
