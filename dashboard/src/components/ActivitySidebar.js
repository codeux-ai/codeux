import { html, renderMarkdown } from '../utils.js';

export function ActivitySidebar({ reportText, instructions }) {
    return html`
        <div class="space-y-8">
            <section>
                <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2">
                    Activity
                    <div class="h-px flex-grow bg-slate-800"></div>
                </h2>
                <div class="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-4 opacity-5">
                        <svg class="w-12 h-12 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    </div>
                    <h4 class="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Latest Logs</h4>
                    <div class="prose prose-xs prose-invert max-w-none text-slate-300 font-mono"
                         dangerouslySetInnerHTML=${{ __html: renderMarkdown(reportText) || 'Waiting for activity...' }}>
                    </div>
                </div>
            </section>

            <section>
                <h2 class="text-xl font-bold text-white mb-6 flex items-center gap-2 text-amber-400">
                    Protocol
                    <div class="h-px flex-grow bg-slate-800"></div>
                </h2>
                <div class="bg-slate-900/50 backdrop-blur-md border border-amber-500/20 rounded-2xl p-6">
                    <h4 class="text-[10px] font-bold text-amber-500/60 uppercase tracking-[0.2em] mb-4">Action Required</h4>
                    <div class="prose prose-xs prose-invert max-w-none text-amber-100/70 font-mono"
                         dangerouslySetInnerHTML=${{ __html: renderMarkdown(instructions) || 'Orchestration optimal. No manual intervention needed.' }}>
                    </div>
                </div>
            </section>

            <footer class="pt-10">
                <p class="text-[10px] text-slate-600 font-medium tracking-wide">
                    JULES SUBAGENTS MCP V1.2.0 • PROTOCOL 4444
                </p>
            </footer>
        </div>
    `;
}
