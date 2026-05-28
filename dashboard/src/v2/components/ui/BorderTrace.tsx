import type { FunctionComponent } from "preact";

/**
 * Elegant border trace on card hover.
 * Bottom expands from center (700ms), sides grow upward from corner (500ms, 200ms delay).
 */
export const BorderTrace: FunctionComponent<{ accentHex: string }> = ({ accentHex }) => (
    <>
        {/* Bottom — expands from center */}
        <div className="absolute bottom-0 left-0 right-0 h-[1px] overflow-hidden">
            <div
                className="h-full w-full origin-center scale-x-0 group-hover:scale-x-100 group-focus-visible:scale-x-100 transition-transform duration-700 ease-[cubic-bezier(0.4,0,0.2,1)] transform-gpu"
                style={{ background: `linear-gradient(90deg, transparent, ${accentHex}80, ${accentHex}CC, ${accentHex}80, transparent)` }}
            />
        </div>
        {/* Left — grows upward from corner, 200ms delay */}
        <div className="absolute left-0 top-0 bottom-0 w-[1px] overflow-hidden">
            <div
                className="w-full h-full origin-bottom scale-y-0 group-hover:scale-y-[0.7] group-focus-visible:scale-y-[0.7] transition-transform duration-500 ease-out delay-200 transform-gpu"
                style={{ background: `linear-gradient(0deg, ${accentHex}70, transparent)` }}
            />
        </div>
        {/* Right — grows upward from corner, 200ms delay */}
        <div className="absolute right-0 top-0 bottom-0 w-[1px] overflow-hidden">
            <div
                className="w-full h-full origin-bottom scale-y-0 group-hover:scale-y-[0.7] group-focus-visible:scale-y-[0.7] transition-transform duration-500 ease-out delay-200 transform-gpu"
                style={{ background: `linear-gradient(0deg, ${accentHex}70, transparent)` }}
            />
        </div>
    </>
);
