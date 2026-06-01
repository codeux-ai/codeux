import type { FunctionComponent } from "preact";
import { memo } from "preact/compat";
import { AttentionLedger } from "../AttentionLedger.js";
import { WaveFluid } from "../ui/WaveFluid.js";
import { BorderTrace } from "../ui/BorderTrace.js";

export const AttentionQueuePanel: FunctionComponent = memo(() => {
    return (
        <div className="group relative overflow-hidden bg-white/70 dark:bg-void-800/60 backdrop-blur-2xl border border-black/[0.06] dark:border-white/[0.06] rounded-[1.75rem] shadow-[0_2px_20px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_24px_rgba(0,0,0,0.2)]">
            <WaveFluid accentHex="#F59E0B" />
            <BorderTrace accentHex="#F59E0B" />
            <div className="relative z-10 px-7 pb-7 pt-7">
                <AttentionLedger />
            </div>
        </div>
    );
});
