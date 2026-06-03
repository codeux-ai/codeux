import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { AttentionLedger } from "../AttentionLedger.js";

export const AttentionQueuePanel: FunctionComponent = memo(() => {
    return <AttentionLedger collapsible defaultOpen />;
});
