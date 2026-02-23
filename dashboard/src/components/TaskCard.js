import { html, getStatusColor, renderMarkdown } from '../utils.js';

export function TaskCard({ task }) {
    return html`
        <div class="bg-slate-900/50 backdrop-blur-md border border-slate-800 p-5 rounded-2xl hover:bg-slate-900/80 transition-all duration-300 group shadow-[0_0_15px_rgba(56,189,248,0)] hover:shadow-[0_0_15px_rgba(56,189,248,0.1)]">
            <div class="flex items-start justify-between gap-4">
                <div class="flex-grow max-w-full overflow-hidden">
                    <div class="flex items-center gap-3 mb-4">
                        <span class="font-mono text-[10px] font-bold px-2 py-0.5 bg-slate-800 rounded text-slate-400 group-hover:text-slate-200 transition-colors">#${task.id}</span>
                        <h3 class="font-semibold text-white group-hover:text-blue-400 transition-colors">${task.title}</h3>
                    </div>
                    
                    <div class="prose prose-sm prose-invert max-w-none mb-6 text-slate-400 prose-headings:text-slate-200 prose-a:text-blue-400 prose-code:text-sky-300 prose-code:bg-slate-800/50 prose-code:px-1 prose-code:rounded prose-strong:text-slate-200" 
                         dangerouslySetInnerHTML=${{ __html: renderMarkdown(task.prompt) }}>
                    </div>
                    
                    <div class="flex flex-wrap items-center gap-4 pt-4 border-t border-slate-800/50">
                        ${task.depends_on.length > 0 && html`
                            <div class="flex items-center gap-2 text-[10px] text-slate-500">
                                <span class="uppercase font-bold tracking-tighter">Blocking:</span>
                                <div class="flex gap-1">
                                    ${task.depends_on.map(dep => html`<span class="px-1.5 py-0.5 bg-slate-800/50 rounded border border-slate-700/50 text-slate-400">${dep}</span>`)}
                                </div>
                            </div>
                        `}
                        ${task.is_merged && html`
                            <div class="flex items-center gap-1.5 text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                                <span class="w-1 h-1 rounded-full bg-emerald-500"></span>
                                Code Merged
                            </div>
                        `}
                    </div>
                </div>
                <div class="flex flex-col items-end gap-3">
                    <span class="px-3 py-1 rounded-full text-[10px] font-bold border transition-all duration-500 ${getStatusColor(task.status)}">
                        ${task.status}
                    </span>
                    ${task.session_id && html`
                        <div class="text-[9px] font-mono text-slate-600 group-hover:text-slate-400 transition-colors">
                            ${task.session_id.substring(0, 12)}...
                        </div>
                    `}
                </div>
            </div>
        </div>
    `;
}
