import { h } from 'https://esm.sh/preact';
import htm from 'https://esm.sh/htm';

export const html = htm.bind(h);

export const renderMarkdown = (text) => {
    if (!text) return '';
    return marked.parse(text);
};

export const getStatusColor = (s) => {
    switch(s) {
        case 'RUNNING': return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
        case 'COMPLETED': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
        case 'FAILED': return 'bg-red-500/10 text-red-400 border-red-500/20';
        case 'BLOCKED': return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
        default: return 'bg-slate-800/50 text-slate-400 border-slate-700';
    }
};
