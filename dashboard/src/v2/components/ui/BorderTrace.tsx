import type { FunctionComponent } from "preact";
import { buildInteractionTransition } from "../../lib/motion/tokens.js";

const borderTraceTransition = buildInteractionTransition("controlFeedback", "transform");

/**
 * Elegant border trace on card hover.
 * Bottom expands from center; sides grow upward from corner using shared motion contracts.
 */
export const BorderTrace: FunctionComponent<{ accentHex: string }> = ({ accentHex }) => (
    <>
        {/* Bottom — expands from center */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden">
            <div
                className="h-full w-full origin-center scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100 motion-safe:transition-transform motion-reduce:transition-none transform-gpu"
                style={{ background: `linear-gradient(90deg, transparent, ${accentHex}80, ${accentHex}CC, ${accentHex}80, transparent)`, transition: borderTraceTransition }}
            />
        </div>
        {/* Left — grows upward from corner */}
        <div className="absolute left-0 top-0 bottom-0 w-[1px] overflow-hidden">
            <div
                className="w-full h-full origin-bottom scale-y-0 group-hover:scale-y-[0.7] group-focus-visible:scale-y-[0.7] motion-safe:transition-transform motion-reduce:transition-none transform-gpu"
                style={{ background: `linear-gradient(0deg, ${accentHex}70, transparent)`, transition: borderTraceTransition }}
            />
        </div>
        {/* Right — grows upward from corner */}
        <div className="absolute right-0 top-0 bottom-0 w-[1px] overflow-hidden">
            <div
                className="w-full h-full origin-bottom scale-y-0 group-hover:scale-y-[0.7] group-focus-visible:scale-y-[0.7] motion-safe:transition-transform motion-reduce:transition-none transform-gpu"
                style={{ background: `linear-gradient(0deg, ${accentHex}70, transparent)`, transition: borderTraceTransition }}
            />
        </div>
    </>
);
