import type { FunctionComponent } from "preact";
import { renderMarkdown } from "../lib/markdown.js";

interface ActivitySidebarProps {
  reportText?: string;
  instructions?: string;
}

export const ActivitySidebar: FunctionComponent<ActivitySidebarProps> = ({ reportText, instructions }) => {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-2">
          Activity
          <div className="h-px flex-grow bg-slate-800" />
        </h2>
        <div className="bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-2xl p-6 relative overflow-hidden">
          <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-[0.2em] mb-4">Latest Logs</h4>
          <div
            className="prose prose-xs prose-invert max-w-none text-slate-300 font-mono"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(reportText) || "Waiting for activity..." }}
          />
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-amber-400 mb-6 flex items-center gap-2">
          Protocol
          <div className="h-px flex-grow bg-slate-800" />
        </h2>
        <div className="bg-slate-900/50 backdrop-blur-md border border-amber-500/20 rounded-2xl p-6">
          <h4 className="text-[10px] font-bold text-amber-500/70 uppercase tracking-[0.2em] mb-4">Action Required</h4>
          <div
            className="prose prose-xs prose-invert max-w-none text-amber-100/70 font-mono"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(instructions) || "Orchestration optimal. No manual intervention needed." }}
          />
        </div>
      </section>
    </div>
  );
};
