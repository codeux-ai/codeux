import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { useMemo } from "preact/hooks";
import { AlertTriangle } from "lucide-preact";
import { CollapsiblePanel } from "./ui/CollapsiblePanel.js";
import { MARKDOWN_PROSE_CLASS } from "./ui/MarkdownEditorField.js";
import { renderMarkdown } from "../../lib/markdown.js";
export interface SprintProtocolProps {
    hasSprintContext: boolean;
    instructions?: string;
}

export const SprintProtocol: FunctionComponent<SprintProtocolProps> = memo(({
    hasSprintContext,
    instructions,
}) => {

    const protocolMarkup = useMemo(() => (
        renderMarkdown(hasSprintContext ? instructions : undefined)
        || '<p class="text-slate-400 dark:text-slate-600 italic">No active sprint protocol.</p>'
    ), [hasSprintContext, instructions]);

    return (
        <CollapsiblePanel
            title="Protocol"
            icon={AlertTriangle}
            accentHex="#FFB800"
            defaultOpen={false}
        >
            <div
                className={`${MARKDOWN_PROSE_CLASS} font-mono text-[12px] leading-relaxed max-h-64 overflow-y-auto dashboard-scrollbar`}
                dangerouslySetInnerHTML={{ __html: protocolMarkup }}
            />
        </CollapsiblePanel>
    );
});
