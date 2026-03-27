import type { FunctionComponent } from "preact";
import { WaveFluid } from "./WaveFluid.js";
import { BorderTrace } from "./BorderTrace.js";
import { renderMarkdown } from "../../../lib/markdown.js";

export const IntelPanel: FunctionComponent<{
    title: string;
    icon: any;
    accentHex: string;
    content?: string;
    fallback: string;
}> = ({ title, icon: Icon, accentHex, content, fallback }) => (
    <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-xl p-7 shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
        <WaveFluid accentHex={accentHex} />
        <BorderTrace accentHex={accentHex} />

        <div className="relative z-10">
            <div className="flex items-center gap-2.5 mb-5">
                <span style={{ color: accentHex }}><Icon className="w-4 h-4" strokeWidth={1.5} /></span>
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-400">{title}</span>
            </div>
            <div
                className="prose prose-sm max-w-none text-slate-600 dark:text-slate-400
                           prose-headings:text-slate-800 dark:prose-headings:text-slate-200
                           prose-code:text-signal-600 dark:prose-code:text-signal-400
                           prose-code:bg-signal-500/[0.06] prose-code:px-1 prose-code:rounded-md
                           font-mono text-[12px] leading-relaxed max-h-64 overflow-y-auto dashboard-scrollbar"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(content) || `<p class="text-slate-400 dark:text-slate-600 italic">${fallback}</p>` }}
            />
        </div>
    </div>
);
