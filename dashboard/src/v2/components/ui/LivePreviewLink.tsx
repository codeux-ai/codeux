import { type FunctionComponent } from "preact";
import { ExternalLink, Play } from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";
import { getSafeUrl } from "../../lib/safe-url.js";

interface LivePreviewLinkProps {
    session: SprintPreviewSession | null;
}

export const LivePreviewLink: FunctionComponent<LivePreviewLinkProps> = ({ session }) => {
    if (!session || session.status !== "running" || !session.hostPort) {
        return null;
    }

    const previewUrl = buildPreviewUrl(session.id, session.lastKnownPath);

    return (
        <a
            href={getSafeUrl(previewUrl)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl border border-signal-500/25 bg-signal-500/10 px-3 py-1.5 text-xs font-bold text-signal-700 shadow-sm transition-colors duration-200 hover:bg-signal-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal-500/40 dark:text-signal-300"
        >
            <Play className="w-3.5 h-3.5" fill="currentColor" />
            Live Preview
            <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" strokeWidth={2.5} />
        </a>
    );
};
