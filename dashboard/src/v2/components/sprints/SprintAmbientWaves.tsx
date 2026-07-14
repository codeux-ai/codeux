import type { FunctionComponent } from "preact";
import { useId, useLayoutEffect, useRef } from "preact/hooks";
import gsap from "gsap";
import { useReducedMotion } from "../../hooks/use-reduced-motion.js";

interface SprintAmbientWavesProps {
  active: boolean;
}

/**
 * A quiet, full-cell spectral wave treatment for active sprints.
 *
 * The broad, softly blurred shapes borrow from Material-style ambient color
 * fields rather than simulating literal water. Motion is deliberately slow so
 * the surface reads as depth and energy without competing with card content.
 */
export const SprintAmbientWaves: FunctionComponent<SprintAmbientWavesProps> = ({ active }) => {
  const primaryWaveRef = useRef<SVGGElement>(null);
  const secondaryWaveRef = useRef<SVGGElement>(null);
  const haloRef = useRef<SVGGElement>(null);
  const reducedMotion = useReducedMotion();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  useLayoutEffect(() => {
    if (!active || reducedMotion) {
      return;
    }

    const context = gsap.context(() => {
      gsap.to(primaryWaveRef.current, {
        x: 12,
        y: -5,
        scaleX: 1.035,
        scaleY: 0.985,
        duration: 24,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        transformOrigin: "50% 62%",
      });
      gsap.to(secondaryWaveRef.current, {
        x: -10,
        y: 6,
        scaleX: 1.025,
        duration: 31,
        delay: -8,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        transformOrigin: "48% 58%",
      });
      gsap.to(haloRef.current, {
        x: 14,
        y: 8,
        scale: 1.06,
        duration: 28,
        delay: -12,
        ease: "sine.inOut",
        repeat: -1,
        yoyo: true,
        transformOrigin: "50% 50%",
      });
    });

    return () => context.revert();
  }, [active, reducedMotion]);

  if (!active) {
    return null;
  }

  const primaryGradientId = `sprint-wave-primary-${id}`;
  const secondaryGradientId = `sprint-wave-secondary-${id}`;
  const haloGradientId = `sprint-wave-halo-${id}`;
  const softBlurId = `sprint-wave-blur-${id}`;

  return (
    <div
      data-sprint-ambient-waves
      data-motion={reducedMotion ? "static" : "ambient"}
      className="pointer-events-none absolute inset-0 overflow-hidden opacity-80 dark:opacity-95"
      aria-hidden="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_12%,rgba(66,133,244,0.08),transparent_38%),linear-gradient(145deg,transparent_18%,rgba(9,30,52,0.12)_100%)] dark:bg-[radial-gradient(circle_at_18%_12%,rgba(66,133,244,0.12),transparent_42%),linear-gradient(145deg,rgba(2,8,15,0.12),rgba(6,20,34,0.5))]" />
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 320 320"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <linearGradient id={primaryGradientId} x1="0%" y1="18%" x2="100%" y2="82%">
            <stop offset="0%" stopColor="#071521" />
            <stop offset="28%" stopColor="#174A78" />
            <stop offset="58%" stopColor="#4285F4" />
            <stop offset="82%" stopColor="#5B55A5" />
            <stop offset="100%" stopColor="#0A1B2C" />
          </linearGradient>
          <linearGradient id={secondaryGradientId} x1="8%" y1="88%" x2="92%" y2="12%">
            <stop offset="0%" stopColor="#071521" />
            <stop offset="38%" stopColor="#0B6380" />
            <stop offset="68%" stopColor="#8AB4F8" />
            <stop offset="100%" stopColor="#26356E" />
          </linearGradient>
          <radialGradient id={haloGradientId} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#7EA8F8" stopOpacity="0.34" />
            <stop offset="52%" stopColor="#405DB1" stopOpacity="0.14" />
            <stop offset="100%" stopColor="#071521" stopOpacity="0" />
          </radialGradient>
          <filter id={softBlurId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="12" />
          </filter>
        </defs>

        <g ref={haloRef} filter={`url(#${softBlurId})`}>
          <ellipse cx="238" cy="84" rx="108" ry="82" fill={`url(#${haloGradientId})`} />
        </g>

        <g ref={primaryWaveRef} filter={`url(#${softBlurId})`}>
          <path
            d="M-58 214 C16 136 78 150 131 188 C184 226 223 116 378 146 L378 354 L-58 354 Z"
            fill={`url(#${primaryGradientId})`}
            fillOpacity="0.42"
          />
        </g>

        <g ref={secondaryWaveRef}>
          <path
            d="M-70 252 C22 158 94 247 166 184 C229 129 286 174 390 112 L390 350 L-70 350 Z"
            fill={`url(#${secondaryGradientId})`}
            fillOpacity="0.20"
          />
          <path
            d="M-48 231 C29 164 92 230 165 177 C227 132 285 165 369 126"
            fill="none"
            stroke={`url(#${secondaryGradientId})`}
            strokeOpacity="0.20"
            strokeWidth="1.25"
          />
        </g>
      </svg>
      <div className="absolute inset-x-[18%] bottom-0 h-px bg-gradient-to-r from-transparent via-blue-300/20 to-transparent" />
    </div>
  );
};
