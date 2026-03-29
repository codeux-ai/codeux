import { type FunctionComponent } from "preact";
import { ExternalLink, Play } from "lucide-preact";
import type { SprintPreviewSession } from "../../../types.js";
import { buildPreviewUrl } from "../../lib/preview-origin.js";

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
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-xs font-bold text-white bg-signal-500 hover:bg-signal-600 shadow-sm transition-colors duration-200"
        >
            <Play className="w-3.5 h-3.5" fill="currentColor" />
            Live Preview
            <ExternalLink className="w-3.5 h-3.5 ml-0.5 opacity-80" strokeWidth={2.5} />
        </a>
    );
};
