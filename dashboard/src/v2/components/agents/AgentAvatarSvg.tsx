/**
 * AgentAvatarSvg — Logo-faithful 2D robot avatar.
 *
 * This is a literal SVG translation of the Code UX brand mark: black rounded
 * tile, white face shell with side ear caps, dark inset face containing
 * smile-arc eyes, jade antenna stem with two diagonal tilt lines, and a
 * forehead jewel. All of the base paths below are copied verbatim from the
 * production logo so the silhouette is pixel-identical to the brand.
 *
 * Variants overlay or transform those paths instead of replacing them, so
 * every variation still reads as the same brand mark:
 *   • CHASSIS — silhouette tweaks (corner radius, aspect)
 *   • EYES    — swap the smile arcs for visor / single lens / pixel
 *   • ANTENNA — swap the pill+lines for bunny ears / beacon / none
 *   • ACCENT  — recolor jade elements (eyes, jewel, antenna)
 *   • AURA    — optional ambient flourish behind the tile
 *
 * Expressions morph the eye arcs (smile / frown / squint / wide) and the
 * forehead jewel intensity so the bot's mood reads at a glance.
 */
import { h } from "preact";
import { useMemo } from "preact/hooks";
import type { AgentAvatarConfig } from "../../types.js";
import {
  BRAND_COLORS,
  getAccentHex,
  getInsetHex,
  getShellHex,
  isLightBase,
  type AgentAvatarExpression,
} from "../../lib/agent-avatar.js";

interface AgentAvatarSvgProps {
  config?: AgentAvatarConfig;
  expression?: AgentAvatarExpression;
  className?: string;
  size?: number;
  /** Disable the floating + breathing micro-animations (for high-density UIs). */
  static?: boolean;
}

let agentAvatarSvgInstanceCounter = 0;

/* ════════════════════════════════════════════════════════════════════════
 *  Logo path bank — verbatim from the production brand mark.
 *  viewBox is 0 0 1254 1254. Anchor centers (used by expression overlays):
 *
 *  EYE_L    (510, 690)   — left smile-eye center
 *  EYE_R    (750, 690)   — right smile-eye center
 *  JEWEL    (628, 400)   — forehead jewel center
 *  ANTENNA  (628, 280)   — top of the antenna pill
 *  FACE_CTR (628, 695)   — center of the dark inset face
 * ════════════════════════════════════════════════════════════════════════ */
const PATH_OUTER_TILE = "M817 1255C544.667 1255 272.833 1255 1 1255C1 837 1 419 1 1C419 1 837 1 1255 1C1255 419 1255 837 1255 1255C1109.167 1255 963.333 1255 817 1255M822.578 883.039C859.251 865.239 886.895 837.821 907.229 802.856C946.722 734.944 948.514 629.974 884.722 558.045C858.516 528.496 826.539 508.1 788.109 498.099C766.585 492.498 744.666 491.961 722.628 492.144C701.633 492.318 680.636 492.241 659.641 492.158C650.133 492.12 644.092 485.917 644.058 476.465C644.034 469.966 644.351 463.45 643.968 456.975C643.73 452.939 645.096 451.31 648.878 449.904C672.334 441.182 686.785 412.884 680.405 388.788C673.244 361.742 647.998 344.279 621.877 348.303C597.057 352.127 579.161 370.065 575.986 394.3C572.85 418.236 585.672 440.251 608.81 450.287C611.441 451.428 612.093 452.845 612.025 455.495C611.854 462.155 611.996 468.824 611.996 475.489C611.994 486.404 606.362 492.129 595.437 492.151C571.609 492.199 547.779 492.314 523.952 492.147C505.677 492.019 487.722 494.015 470.098 498.906C408.425 516.022 364.953 554.383 338.191 612.123C323.337 644.172 318.998 678.113 320.705 713.062C323.267 765.483 343.809 809.633 381.853 845.693C386.547 850.142 387.34 853.645 384.395 859.405C376.678 874.497 368.94 889.578 361.147 904.631C358.977 908.822 357.321 913.018 360.952 917.129C364.546 921.197 368.766 920.327 373.294 918.53C395.719 909.632 418.253 901.007 440.646 892.028C446.214 889.796 451.37 889.515 457.097 891.35C474.31 896.866 491.987 900.165 510.096 900.189C590.413 900.296 670.731 900.378 751.048 900.175C775.876 900.113 799.496 894.089 822.578 883.039M285.848 785.679C292.41 786.93 298.972 788.181 306.682 789.651C305.348 785.234 304.586 782.561 303.736 779.918C298.34 763.137 295.604 745.96 295.702 728.311C295.801 710.488 295.816 692.662 295.681 674.839C295.558 658.72 297.816 642.973 302.329 627.524C303.618 623.111 304.887 618.692 306.404 613.453C301.921 613.821 298.08 613.752 294.405 614.5C263.757 620.735 242.113 647.361 242.043 678.738C242.011 693.064 242.562 707.415 241.911 721.711C240.644 749.543 258.606 776.127 285.848 785.679M1005.189 646.31C992.589 625.178 965.308 609.527 949.667 614.602C950.117 616.167 950.509 617.765 951.032 619.32C957.302 637.961 960.166 657.096 959.911 676.772C959.678 694.751 960.122 712.741 959.709 730.713C959.492 740.16 958.647 749.677 957.049 758.985C955.375 768.74 952.46 778.283 949.916 788.613C951.874 788.613 953.806 788.72 955.724 788.597C983.87 786.792 1010.685 761.454 1012.784 733.378C1014.06 716.318 1013.423 699.117 1013.705 681.98C1013.908 669.612 1011.602 657.847 1005.189 646.31M640.821 279.5C640.809 272.683 640.844 265.865 640.773 259.049C640.683 250.348 635.372 244.457 627.786 244.53C619.934 244.605 614.917 250.184 614.885 259.077C614.829 274.374 614.828 289.672 614.873 304.969C614.898 313.454 620.058 318.899 627.805 318.8C635.657 318.699 640.829 313.259 640.865 304.942C640.901 296.795 640.842 288.647 640.821 279.5M755.056 301.361C748.167 296.322 741.764 296.511 735.787 302.363C726.156 311.793 716.668 321.369 707.198 330.961C701.353 336.882 701.055 344.803 706.295 350.114C712.048 355.947 720.095 355.921 726.27 349.863C735.773 340.542 745.226 331.168 754.6 321.717C761.169 315.093 761.377 309.16 755.056 301.361M522.663 303.812C522.315 303.455 521.974 303.09 521.616 302.743C515.296 296.622 506.511 296.292 501.2 301.973C495.616 307.946 496.348 315.789 502.915 322.228C512.171 331.306 521.314 340.498 530.541 349.606C536.809 355.792 544.695 356.002 550.413 350.212C555.909 344.647 555.68 336.934 549.608 330.766C540.862 321.883 531.988 313.127 522.663 303.812Z";

const PATH_FACE_SHELL = "M822.226 883.169C799.496 894.089 775.876 900.113 751.048 900.175C670.731 900.378 590.413 900.296 510.096 900.189C491.987 900.165 474.31 896.866 457.097 891.35C451.37 889.515 446.214 889.796 440.646 892.028C418.253 901.007 395.719 909.632 373.294 918.53C368.766 920.327 364.546 921.197 360.952 917.129C357.321 913.018 358.977 908.822 361.147 904.631C368.94 889.578 376.678 874.497 384.395 859.405C387.34 853.645 386.547 850.142 381.853 845.693C343.809 809.633 323.267 765.483 320.705 713.062C318.998 678.113 323.337 644.172 338.191 612.123C364.953 554.383 408.425 516.022 470.098 498.906C487.722 494.015 505.677 492.019 523.952 492.147C547.779 492.314 571.609 492.199 595.437 492.151C606.362 492.129 611.994 486.404 611.996 475.489C611.996 468.824 611.854 462.155 612.025 455.495C612.093 452.845 611.441 451.428 608.81 450.287C585.672 440.251 572.85 418.236 575.986 394.3C579.161 370.065 597.057 352.127 621.877 348.303C647.998 344.279 673.244 361.742 680.405 388.788C686.785 412.884 672.334 441.182 648.878 449.904C645.096 451.31 643.73 452.939 643.968 456.975C644.351 463.45 644.034 469.966 644.058 476.465C644.092 485.917 650.133 492.12 659.641 492.158C680.636 492.241 701.633 492.318 722.628 492.144C744.666 491.961 766.585 492.498 788.109 498.099C826.539 508.1 858.516 528.496 884.722 558.045C948.514 629.974 946.722 734.944 907.229 802.856C886.895 837.821 859.251 865.239 822.226 883.169Z";

const PATH_EAR_LEFT = "M285.489 785.522C258.606 776.127 240.644 749.543 241.911 721.711C242.562 707.415 242.011 693.064 242.043 678.738C242.113 647.361 263.757 620.735 294.405 614.5C298.08 613.752 301.921 613.821 306.404 613.453C304.887 618.692 303.618 623.111 302.329 627.524C297.816 642.973 295.558 658.72 295.681 674.839C295.816 692.662 295.801 710.488 295.702 728.311C295.604 745.96 298.34 763.137 303.736 779.918C304.586 782.561 305.348 785.234 306.682 789.651C298.972 788.181 292.41 786.93 285.489 785.522Z";

const PATH_EAR_RIGHT = "M1005.39 646.62C1011.602 657.847 1013.908 669.612 1013.705 681.98C1013.423 699.117 1014.06 716.318 1012.784 733.378C1010.685 761.454 983.87 786.792 955.724 788.597C953.806 788.72 951.874 788.613 949.916 788.613C952.46 778.283 955.375 768.74 957.049 758.985C958.647 749.677 959.492 740.16 959.709 730.713C960.122 712.741 959.678 694.751 959.911 676.772C960.166 657.096 957.302 637.961 951.032 619.32C950.509 617.765 950.117 616.167 949.667 614.602C965.308 609.527 992.589 625.178 1005.39 646.62Z";

const PATH_ANTENNA_PILL = "M640.823 280C640.842 288.647 640.901 296.795 640.865 304.942C640.829 313.259 635.657 318.699 627.805 318.8C620.058 318.899 614.898 313.454 614.873 304.969C614.828 289.672 614.829 274.374 614.885 259.077C614.917 250.184 619.934 244.605 627.786 244.53C635.372 244.457 640.683 250.348 640.773 259.049C640.844 265.865 640.809 272.683 640.823 280Z";

const PATH_ANTENNA_TILT_RIGHT = "M755.315 301.629C761.377 309.16 761.169 315.093 754.6 321.717C745.226 331.168 735.773 340.542 726.27 349.863C720.095 355.921 712.048 355.947 706.295 350.114C701.055 344.803 701.353 336.882 707.198 330.961C716.668 321.369 726.156 311.793 735.787 302.363C741.764 296.511 748.167 296.322 755.315 301.629Z";

const PATH_ANTENNA_TILT_LEFT = "M522.916 304.064C531.988 313.127 540.862 321.883 549.608 330.766C555.68 336.934 555.909 344.647 550.413 350.212C544.695 356.002 536.809 355.792 530.541 349.606C521.314 340.498 512.171 331.306 502.915 322.228C496.348 315.789 495.616 307.946 501.2 301.973C506.511 296.292 515.296 296.622 521.616 302.743C521.974 303.09 522.315 303.455 522.916 304.064Z";

const PATH_INSET_FACE = "M737.238 539.907C763.445 539.452 787.836 546.29 809.88 560.074C867.204 595.918 892.392 648.475 888.456 715.38C884.547 781.841 834.894 838.559 767.307 850.362C757.839 852.015 748.093 852.727 738.473 852.753C665.822 852.952 593.142 854.134 520.528 852.493C457.598 851.07 409.282 822.226 381.12 764.979C361.113 724.31 361.95 681.699 378.902 640.018C400.041 588.043 438.119 554.943 493.233 542.464C501.134 540.675 509.411 540.547 517.649 540.121C519.668 541.064 521.551 541.946 523.436 541.948C593.15 542.018 662.865 542.006 732.58 542C734.075 542 735.577 541.981 737.057 541.808C737.189 541.792 737.181 540.57 737.238 539.907Z";

/* Forehead jewel was removed at user request — the brand smile-arc bot now
   has no forehead dot. The path is intentionally not exported. */

const PATH_BEZEL_SLIVER = "M736.958 539.833C737.181 540.57 737.189 541.792 737.057 541.808C735.577 541.981 734.075 542 732.58 542C662.865 542.006 593.15 542.018 523.436 541.948C521.551 541.946 519.668 541.064 518.125 540.246C522.617 539.771 526.767 539.534 530.917 539.533C598.01 539.522 665.102 539.539 732.195 539.561C733.689 539.562 735.184 539.69 736.958 539.833Z";

const PATH_EYE_LEFT_SMILE = "M478.761 660.729C516.002 639.795 561.684 660.246 569.452 700.996C571.626 712.406 563.155 720.513 552.522 717.22C547.187 715.568 545.298 711.49 544.225 706.42C540.3 687.867 523.091 676.104 504.427 679.002C489.634 681.299 478.695 691.785 475.767 706.476C474.132 714.68 467.978 719.217 460.424 717.788C452.948 716.373 448.755 709.694 450.36 701.522C453.815 683.918 463.128 670.332 478.761 660.729Z";

const PATH_EYE_RIGHT_SMILE = "M804.095 712.988C800.066 717.639 795.349 718.882 789.879 717.215C784.715 715.641 782.065 711.913 781.043 706.751C777.612 689.423 764.423 678.608 746.78 678.585C730.124 678.563 715.53 690.535 712.169 706.98C710.236 716.438 701.606 720.707 693.257 716.334C687.989 713.576 685.691 707.909 687.257 700.813C690.615 685.597 698.291 673.175 710.999 663.875C747.076 637.471 798.925 657.966 806.066 701.701C806.633 705.17 804.942 709.007 804.095 712.988Z";

/* Anchor centers used by expression overlays */
const EYE_L = { x: 510, y: 690 };
const EYE_R = { x: 750, y: 690 };
/* ════════════════════════════════════════════════════════════════════════
 *  Chassis variants — tweak the outer-tile path or scale the inner bot to
 *  give each variant a distinct silhouette while preserving the logo DNA.
 *
 *  We do this by drawing the outer tile as a *separate* rounded-rect (so
 *  variants can adjust corner radius / aspect) and the inner bot at fixed
 *  proportions so the antenna/face geometry never deforms.
 * ════════════════════════════════════════════════════════════════════════ */
type ChassisSpec = {
  cornerRadius: number;
  scaleX: number;
  scaleY: number;
};
const CHASSIS_SPECS: Record<string, ChassisSpec> = {
  classic: { cornerRadius: 200, scaleX: 1.0,  scaleY: 1.0 },
  square:  { cornerRadius: 90,  scaleX: 1.0,  scaleY: 1.0 },
  tall:    { cornerRadius: 200, scaleX: 0.88, scaleY: 1.0 },
  pebble:  { cornerRadius: 320, scaleX: 1.0,  scaleY: 0.92 },
  soft:    { cornerRadius: 460, scaleX: 1.0,  scaleY: 1.0 },  // squircle / extra-soft
};
function getChassisSpec(id: string | undefined): ChassisSpec {
  return CHASSIS_SPECS[id ?? "classic"] ?? CHASSIS_SPECS.classic;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Eye renderers — the canonical smile and three brand-aligned variants.
 *  All renderers position relative to EYE_L/EYE_R anchor centers so the
 *  swap is drop-in regardless of expression.
 * ════════════════════════════════════════════════════════════════════════ */
function renderEyes(
  eyesId: string | undefined,
  expression: AgentAvatarExpression,
  accent: string,
  jadeBright: string,
): h.JSX.Element {
  const wide = expression === "hyped";
  const squint = expression === "sleepy" || expression === "bored";
  const sad = expression === "sad";
  const angry = expression === "angry";

  /* ── Visor (eye style): an award-winning HUD-style band ──
       Layered composition:
         1. Outer recess shadow — gives the visor depth in the dark inset
         2. Main body — solid accent slab, rounded
         3. Cylindrical highlight — lighter top half suggests glass curvature
         4. Inner recessed channel — darker band where the "display" lives
         5. Glass top shine — narrow white strip simulating reflection
         6. Two pulsing pupil cores at the eye centers
         7. HUD tick marks at the edges (sci-fi accent)
         8. Animated scan-line sweep moving left↔right
         9. Mini EQ bars below the visor (suggests live data feed)
       Squint/sad/angry expressions hide the busy elements so the mood
       still reads at a glance. ── */
  if (eyesId === "visor") {
    const yCenter = (EYE_L.y + EYE_R.y) / 2;
    const halfH = squint ? 16 : wide ? 36 : sad ? 22 : 28;
    const visorW = EYE_R.x - EYE_L.x + 220;
    const visorX = EYE_L.x - 110;
    const visorY = yCenter - halfH;
    const accentLight = lighten(accent, 0.45);
    const accentDeep = darken(accent, 0.42);
    const showDetails = !squint;
    const showDataBars = !squint && !sad && !angry;

    return (
      <g>
        {/* 1. Outer recess shadow — depth below the visor */}
        <rect
          x={visorX - 10}
          y={visorY - 6}
          width={visorW + 20}
          height={halfH * 2 + 18}
          rx={halfH * 0.95}
          ry={halfH * 0.95}
          fill="#000000"
          opacity="0.55"
        />

        {/* 2. Main visor body — solid accent slab */}
        <rect
          x={visorX}
          y={visorY}
          width={visorW}
          height={halfH * 2}
          rx={halfH * 0.85}
          ry={halfH * 0.85}
          fill={accent}
        >
          <animate attributeName="opacity" values="1;0.92;1" dur="2.6s" repeatCount="indefinite" />
        </rect>

        {/* 3. Cylindrical top-half highlight — gives the bar 3D feel */}
        <rect
          x={visorX + 4}
          y={visorY + 4}
          width={visorW - 8}
          height={halfH * 0.95}
          rx={halfH * 0.7}
          ry={halfH * 0.7}
          fill={accentLight}
          opacity="0.55"
        />

        {/* 4. Inner recessed channel — darker band */}
        <rect
          x={visorX + 22}
          y={visorY + 14}
          width={visorW - 44}
          height={halfH * 2 - 28}
          rx={Math.max(4, (halfH - 7) * 0.85)}
          ry={Math.max(4, (halfH - 7) * 0.85)}
          fill={accentDeep}
          opacity="0.9"
        />

        {/* 5. Glass top shine — thin reflective strip */}
        {showDetails && (
          <rect
            x={visorX + 28}
            y={visorY + 9}
            width={visorW - 56}
            height={Math.max(4, halfH * 0.45)}
            rx={halfH * 0.3}
            ry={halfH * 0.3}
            fill="#FFFFFF"
            opacity="0.34"
          />
        )}

        {/* 6. Two pulsing pupil cores at the eye anchors */}
        {showDetails && (
          <g>
            <circle cx={EYE_L.x} cy={yCenter + 2} r={wide ? 10 : 7.5} fill={accentLight}>
              <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="r" values={`${wide ? 10 : 7.5};${wide ? 12 : 9};${wide ? 10 : 7.5}`} dur="1.6s" repeatCount="indefinite" />
            </circle>
            <circle cx={EYE_R.x} cy={yCenter + 2} r={wide ? 10 : 7.5} fill={accentLight}>
              <animate attributeName="opacity" values="1;0.5;1" dur="1.6s" repeatCount="indefinite" begin="0.5s" />
              <animate attributeName="r" values={`${wide ? 10 : 7.5};${wide ? 12 : 9};${wide ? 10 : 7.5}`} dur="1.6s" repeatCount="indefinite" begin="0.5s" />
            </circle>
            {/* Bright white cores */}
            <circle cx={EYE_L.x} cy={yCenter} r="2.5" fill="#FFFFFF" opacity="0.95" />
            <circle cx={EYE_R.x} cy={yCenter} r="2.5" fill="#FFFFFF" opacity="0.95" />
          </g>
        )}

        {/* 7. HUD tick marks at the edges */}
        {showDetails && (
          <g>
            <rect x={visorX + 10} y={yCenter - 8} width="3.5" height="16" rx="1.5" fill={accentLight} opacity="0.95" />
            <rect x={visorX + 18} y={yCenter - 5} width="2.5" height="10" rx="1.2" fill={accentLight} opacity="0.65" />
            <rect x={visorX + visorW - 14} y={yCenter - 8} width="3.5" height="16" rx="1.5" fill={accentLight} opacity="0.95" />
            <rect x={visorX + visorW - 21} y={yCenter - 5} width="2.5" height="10" rx="1.2" fill={accentLight} opacity="0.65" />
          </g>
        )}

        {/* 8. Animated scan-line sweep */}
        <rect
          x={visorX - 60}
          y={visorY + 4}
          width="60"
          height={halfH * 2 - 8}
          fill="#FFFFFF"
          opacity="0"
          rx="10"
        >
          <animate attributeName="x" values={`${visorX - 60};${visorX + visorW};${visorX - 60}`} dur="4.5s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0;0.4;0;0" dur="4.5s" repeatCount="indefinite" />
        </rect>

        {/* 9. Mini EQ data bars below the visor — suggests live data feed */}
        {showDataBars && (
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const x = visorX + visorW / 2 - 48 + i * 16;
              const peakHeight = [10, 18, 26, 14, 22, 12, 16][i];
              const dur = 0.7 + (i % 3) * 0.18;
              return (
                <rect
                  key={i}
                  x={x}
                  y={visorY + halfH * 2 + 14}
                  width="6"
                  height="4"
                  rx="2.5"
                  fill={accent}
                  opacity="0.8"
                >
                  <animate
                    attributeName="height"
                    values={`4;${peakHeight};4`}
                    dur={`${dur}s`}
                    repeatCount="indefinite"
                  />
                </rect>
              );
            })}
          </g>
        )}
      </g>
    );
  }

  /* ── Heart: cute heart-shaped eyes ── */
  if (eyesId === "heart") {
    const s = squint ? 0.5 : wide ? 1.35 : 1.0;
    const heartPath = (cx: number, cy: number) => {
      const w = 38 * s;
      const h = 36 * s;
      return `M ${cx} ${cy + h * 0.5}
              C ${cx - w} ${cy} ${cx - w} ${cy - h * 0.6} ${cx - w * 0.4} ${cy - h * 0.6}
              C ${cx - w * 0.15} ${cy - h * 0.6} ${cx} ${cy - h * 0.3} ${cx} ${cy - h * 0.05}
              C ${cx} ${cy - h * 0.3} ${cx + w * 0.15} ${cy - h * 0.6} ${cx + w * 0.4} ${cy - h * 0.6}
              C ${cx + w} ${cy - h * 0.6} ${cx + w} ${cy} ${cx} ${cy + h * 0.5} Z`;
    };
    return (
      <g>
        <path d={heartPath(EYE_L.x, EYE_L.y)} fill={accent}>
          <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1.8s" repeatCount="indefinite" />
        </path>
        <path d={heartPath(EYE_R.x, EYE_R.y)} fill={accent}>
          <animateTransform attributeName="transform" type="scale" values="1;1.08;1" dur="1.8s" repeatCount="indefinite" begin="0.4s" />
        </path>
        {!squint && (
          <>
            <circle cx={EYE_L.x - 8} cy={EYE_L.y - 12} r="6" fill={jadeBright} opacity="0.9" />
            <circle cx={EYE_R.x - 8} cy={EYE_R.y - 12} r="6" fill={jadeBright} opacity="0.9" />
          </>
        )}
      </g>
    );
  }

  /* ── Single Lens: cyclops circle centered between the two eye anchors ── */
  if (eyesId === "single") {
    const cx = (EYE_L.x + EYE_R.x) / 2;
    const cy = (EYE_L.y + EYE_R.y) / 2;
    const r = squint ? 26 : wide ? 78 : 56;
    return (
      <g>
        <circle cx={cx} cy={cy} r={r + 18} fill="none" stroke={accent} strokeWidth="6" opacity="0.4">
          <animate attributeName="r" values={`${r + 18};${r + 30};${r + 18}`} dur="2.4s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0.15;0.4" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={cx} cy={cy} r={r} fill={accent} />
        <circle cx={cx - r * 0.32} cy={cy - r * 0.32} r={r * 0.3} fill={jadeBright} opacity="0.9" />
      </g>
    );
  }

  /* ── Pixel: chunky square eyes (Famicom-style) ── */
  if (eyesId === "pixel") {
    const s = squint ? 24 : wide ? 78 : 52;
    return (
      <g>
        <rect x={EYE_L.x - s / 2} y={EYE_L.y - s / 2} width={s} height={s} rx="8" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" />
        </rect>
        <rect x={EYE_R.x - s / 2} y={EYE_R.y - s / 2} width={s} height={s} rx="8" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="2.4s" repeatCount="indefinite" begin="0.5s" />
        </rect>
      </g>
    );
  }

  /* ── Default: smile arcs — the logo's signature eyes ──
       For happy/default we render the EXACT logo paths. For other
       expressions we render alternate eye shapes at the same centers,
       all in the same jade green, preserving the brand language. */

  if (expression === "happy" || expression === "hyped" || expression === "nod" || expression === "shake_head") {
    // The big smile-arc eyes of the logo, optionally scaled for "hyped"
    const transform = wide ? `translate(${EYE_L.x} ${EYE_L.y}) scale(1.18) translate(${-EYE_L.x} ${-EYE_L.y})` : undefined;
    return (
      <g transform={transform}>
        <path d={PATH_EYE_LEFT_SMILE} fill={accent}>
          <animate attributeName="opacity" values="1;0.9;1" dur="3.4s" repeatCount="indefinite" />
        </path>
        <path d={PATH_EYE_RIGHT_SMILE} fill={accent}>
          <animate attributeName="opacity" values="1;0.9;1" dur="3.4s" repeatCount="indefinite" begin="0.6s" />
        </path>
      </g>
    );
  }

  if (sad) {
    // Frown — flip the smile arcs vertically around the eye centers
    return (
      <g>
        <g transform={`translate(${EYE_L.x} ${EYE_L.y}) scale(1 -1) translate(${-EYE_L.x} ${-EYE_L.y})`}>
          <path d={PATH_EYE_LEFT_SMILE} fill={accent} opacity="0.8" />
        </g>
        <g transform={`translate(${EYE_R.x} ${EYE_R.y}) scale(1 -1) translate(${-EYE_R.x} ${-EYE_R.y})`}>
          <path d={PATH_EYE_RIGHT_SMILE} fill={accent} opacity="0.8" />
        </g>
      </g>
    );
  }

  if (angry) {
    // Thick angled brow-bars
    return (
      <g>
        <rect
          x={EYE_L.x - 56}
          y={EYE_L.y - 14}
          width="112"
          height="22"
          rx="11"
          fill={accent}
          transform={`rotate(-12 ${EYE_L.x} ${EYE_L.y})`}
        />
        <rect
          x={EYE_R.x - 56}
          y={EYE_R.y - 14}
          width="112"
          height="22"
          rx="11"
          fill={accent}
          transform={`rotate(12 ${EYE_R.x} ${EYE_R.y})`}
        />
      </g>
    );
  }

  if (squint) {
    // Long thin sleepy lines
    return (
      <g>
        <rect x={EYE_L.x - 50} y={EYE_L.y - 5} width="100" height="10" rx="5" fill={accent} opacity="0.85" />
        <rect x={EYE_R.x - 50} y={EYE_R.y - 5} width="100" height="10" rx="5" fill={accent} opacity="0.85" />
      </g>
    );
  }

  // Fallback — use the logo eyes
  return (
    <g>
      <path d={PATH_EYE_LEFT_SMILE} fill={accent} />
      <path d={PATH_EYE_RIGHT_SMILE} fill={accent} />
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Antenna renderers — the logo's pill + tilt lines + alternatives.
 * ════════════════════════════════════════════════════════════════════════ */
function renderAntenna(
  antennaId: string | undefined,
  accent: string,
  jadeBright: string,
  expression: AgentAvatarExpression,
): h.JSX.Element | null {
  const swayAnim = (
    <animateTransform
      attributeName="transform"
      type="rotate"
      values={`${expression === "hyped" ? -6 : -2} 628 410; ${expression === "hyped" ? 6 : 2} 628 410; ${expression === "hyped" ? -6 : -2} 628 410`}
      dur={expression === "hyped" ? "1.4s" : "3.2s"}
      repeatCount="indefinite"
    />
  );

  if (antennaId === "none") return null;

  if (antennaId === "bunny") {
    // Two diagonal jade pills as bunny ears + small jewels at the tips
    return (
      <g>
        {swayAnim}
        <rect x="500" y="240" width="36" height="120" rx="18" fill={accent} transform="rotate(-22 518 300)" />
        <rect x="720" y="240" width="36" height="120" rx="18" fill={accent} transform="rotate(22 738 300)" />
        <circle cx="478" cy="208" r="22" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx="778" cy="208" r="22" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" begin="0.6s" />
        </circle>
        <circle cx="473" cy="201" r="7" fill={jadeBright} opacity="0.9" />
        <circle cx="773" cy="201" r="7" fill={jadeBright} opacity="0.9" />
      </g>
    );
  }

  if (antennaId === "beam") {
    // Tall thin stem with a glowing jewel ball + halo pulse
    return (
      <g>
        {swayAnim}
        <rect x="618" y="170" width="20" height="160" rx="10" fill={accent} />
        <circle cx="628" cy="160" r="28" fill={accent}>
          <animate attributeName="opacity" values="1;0.55;1" dur="1.6s" repeatCount="indefinite" />
        </circle>
        <circle cx="620" cy="153" r="9" fill={jadeBright} opacity="0.9" />
        <circle cx="628" cy="160" r="48" fill="none" stroke={accent} strokeWidth="6" opacity="0.4">
          <animate attributeName="r" values="48;72;48" dur="1.8s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.4;0;0.4" dur="1.8s" repeatCount="indefinite" />
        </circle>
      </g>
    );
  }

  if (antennaId === "wifi") {
    // Three concentric signal arcs emanating from a small antenna dot.
    // Each arc fades in then out in sequence, like a transmitting wifi mark.
    const arc = (rx: number, ry: number, dur: string, begin: string) => (
      <path
        d={`M ${628 - rx} 320 A ${rx} ${ry} 0 0 1 ${628 + rx} 320`}
        fill="none"
        stroke={accent}
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0"
      >
        <animate attributeName="opacity" values="0;0.95;0" dur={dur} repeatCount="indefinite" begin={begin} />
      </path>
    );
    return (
      <g>
        {swayAnim}
        {/* Small antenna stem + base dot */}
        <rect x="622" y="270" width="12" height="60" rx="6" fill={accent} />
        <circle cx="628" cy="332" r="12" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="1.4s" repeatCount="indefinite" />
        </circle>
        {/* Concentric signal arcs */}
        {arc(60, 36, "1.6s", "0s")}
        {arc(110, 64, "1.6s", "0.35s")}
        {arc(170, 100, "1.6s", "0.7s")}
      </g>
    );
  }

  // Default: jewel — the canonical logo antenna (pill stem + 2 diagonal lines)
  return (
    <g>
      {swayAnim}
      <path d={PATH_ANTENNA_PILL} fill={accent}>
        <animate attributeName="opacity" values="1;0.78;1" dur="2.4s" repeatCount="indefinite" />
      </path>
      <path d={PATH_ANTENNA_TILT_LEFT} fill={accent} />
      <path d={PATH_ANTENNA_TILT_RIGHT} fill={accent} />
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Aura — ambient flourish behind the tile
 * ════════════════════════════════════════════════════════════════════════ */
function renderAura(wingsId: string | undefined, accent: string, jadeBright: string, orbitPathId: string): h.JSX.Element | null {
  if (!wingsId || wingsId === "none") return null;

  /* ── Halo: stacked tilted ellipses — a celestial-feeling crown ── */
  if (wingsId === "halo") {
    return (
      <g>
        {/* Outer broad halo */}
        <ellipse cx="628" cy="200" rx="520" ry="80" fill="none" stroke={accent} strokeWidth="10" opacity="0.55">
          <animate attributeName="opacity" values="0.55;0.25;0.55" dur="3.6s" repeatCount="indefinite" />
        </ellipse>
        {/* Inner crisp halo */}
        <ellipse cx="628" cy="190" rx="420" ry="56" fill="none" stroke={jadeBright} strokeWidth="6" opacity="0.7">
          <animate attributeName="opacity" values="0.7;0.4;0.7" dur="3.6s" repeatCount="indefinite" begin="0.4s" />
        </ellipse>
        {/* Slow rotation suggested by 3 tiny floating accent dots on the ring */}
        <g>
          <animateTransform attributeName="transform" type="rotate" from="0 628 200" to="360 628 200" dur="14s" repeatCount="indefinite" />
          <circle cx="1148" cy="200" r="12" fill={jadeBright} />
          <circle cx="108"  cy="200" r="10" fill={accent} />
          <circle cx="628"  cy="120" r="8"  fill={jadeBright} opacity="0.85" />
        </g>
      </g>
    );
  }

  /* ── Pulse: angular shock-wave with offset secondaries — avantgarde ── */
  if (wingsId === "pulse") {
    /* Concentric, slightly rotated rounded-squares pulsing outward with
       phase offsets — feels like a graphic-design shock wave rather than a
       generic radio pulse. */
    const shockwave = (delay: string, scaleFrom: number, scaleTo: number, opa: number, sw: number, rot: number) => (
      <rect
        x="200"
        y="200"
        width="854"
        height="854"
        rx="220"
        fill="none"
        stroke={accent}
        strokeWidth={sw}
        opacity="0"
        transform={`rotate(${rot} 627 627)`}
      >
        <animateTransform
          attributeName="transform"
          type="rotate"
          values={`${rot} 627 627`}
          additive="sum"
          dur="6s"
          repeatCount="indefinite"
        />
        <animate
          attributeName="opacity"
          values={`0;${opa};0`}
          dur="2.6s"
          repeatCount="indefinite"
          begin={delay}
        />
        <animateTransform
          attributeName="transform"
          type="scale"
          additive="sum"
          values={`${scaleFrom};${scaleTo};${scaleFrom}`}
          dur="2.6s"
          repeatCount="indefinite"
          begin={delay}
        />
      </rect>
    );
    return (
      <g style="transform-origin: 627px 627px;">
        {shockwave("0s",   1.0, 1.25, 0.7,  18, 0)}
        {shockwave("0.5s", 1.0, 1.35, 0.5,  10, 6)}
        {shockwave("1.0s", 1.0, 1.45, 0.35, 6,  -6)}
        {/* Crisp focal dot in the lower center to anchor the wave */}
        <circle cx="627" cy="1180" r="14" fill={accent}>
          <animate attributeName="opacity" values="1;0.4;1" dur="2.6s" repeatCount="indefinite" />
        </circle>
      </g>
    );
  }

  /* ── Orbit: 3 jade satellites circling on a tilted elliptical path ── */
  if (wingsId === "orbit") {
    const orbitPathProps = {
      d: "M 627 200 a 540 180 0 1 0 0.001 0",
      fill: "none",
      stroke: accent,
      strokeOpacity: "0.18",
      strokeWidth: "3",
      strokeDasharray: "6 8",
    };
    const orbitPath = (
      <path
        id={orbitPathId}
        {...orbitPathProps}
      />
    );
    const satellite = (delay: string, r: number, fill: string, opacity: number) => (
      <circle r={r} fill={fill} opacity={opacity}>
        <animateMotion dur="6s" repeatCount="indefinite" begin={delay} rotate="auto">
          <mpath href={`#${orbitPathId}`} />
        </animateMotion>
        <animate attributeName="opacity" values={`${opacity};${opacity * 0.4};${opacity}`} dur="6s" repeatCount="indefinite" begin={delay} />
      </circle>
    );
    return (
      <g>
        <defs>{orbitPath}</defs>
        <path {...orbitPathProps} />
        {satellite("0s",   18, accent, 0.95)}
        {satellite("-2s",  14, jadeBright, 0.85)}
        {satellite("-4s",  10, accent, 0.75)}
      </g>
    );
  }

  /* ── Dust (kept as-is — user requested) ── */
  return (
    <g>
      {Array.from({ length: 8 }, (_, i) => {
        const angle = (i * 45 + 22) * (Math.PI / 180);
        const cx = 628 + Math.cos(angle) * 560;
        const cy = 700 + Math.sin(angle) * 520;
        return (
          <circle key={i} cx={cx} cy={cy} r="16" fill={accent} opacity="0.55">
            <animate attributeName="cy" values={`${cy};${cy - 60};${cy}`} dur="3.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
            <animate attributeName="opacity" values="0.55;0;0.55" dur="3.4s" repeatCount="indefinite" begin={`${i * 0.3}s`} />
          </circle>
        );
      })}
    </g>
  );
}

/* ════════════════════════════════════════════════════════════════════════
 *  Headphones — five styles, layered over the white ear-cap area.
 *
 *  Anchor centers for the side decorations:
 *    LEFT_EAR   ≈ (272, 700)
 *    RIGHT_EAR  ≈ (980, 700)
 * ════════════════════════════════════════════════════════════════════════ */
const EAR_L = { x: 272, y: 700 };
const EAR_R = { x: 980, y: 700 };

function renderHeadphones(
  headphonesId: string | undefined,
  accent: string,
  jadeBright: string,
  shellHex: string,
): h.JSX.Element | null {
  if (!headphonesId || headphonesId === "bumper") return null;

  /* ── Studio: over-ear cups with jade pad center + connecting band overhead ── */
  if (headphonesId === "studio") {
    return (
      <g>
        {/* Connecting band arcing over the head */}
        <path
          d={`M ${EAR_L.x + 20} 560 Q 627 360 ${EAR_R.x - 20} 560`}
          fill="none"
          stroke={shellHex}
          strokeWidth="22"
          strokeLinecap="round"
        />
        <path
          d={`M ${EAR_L.x + 20} 560 Q 627 360 ${EAR_R.x - 20} 560`}
          fill="none"
          stroke="rgba(0,0,0,0.15)"
          strokeWidth="6"
          strokeLinecap="round"
          opacity="0.5"
        />
        {/* Left cup */}
        <circle cx={EAR_L.x} cy={EAR_L.y} r="98" fill="#1a1a22" />
        <circle cx={EAR_L.x} cy={EAR_L.y} r="98" fill="none" stroke={shellHex} strokeWidth="6" opacity="0.6" />
        <circle cx={EAR_L.x} cy={EAR_L.y} r="58" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <circle cx={EAR_L.x - 16} cy={EAR_L.y - 16} r="14" fill={jadeBright} opacity="0.85" />
        {/* Right cup */}
        <circle cx={EAR_R.x} cy={EAR_R.y} r="98" fill="#1a1a22" />
        <circle cx={EAR_R.x} cy={EAR_R.y} r="98" fill="none" stroke={shellHex} strokeWidth="6" opacity="0.6" />
        <circle cx={EAR_R.x} cy={EAR_R.y} r="58" fill={accent}>
          <animate attributeName="opacity" values="1;0.6;1" dur="2.4s" repeatCount="indefinite" begin="0.4s" />
        </circle>
        <circle cx={EAR_R.x - 16} cy={EAR_R.y - 16} r="14" fill={jadeBright} opacity="0.85" />
      </g>
    );
  }

  /* ── Earbuds: small jade orbs clipping onto the ear caps ── */
  if (headphonesId === "earbuds") {
    return (
      <g>
        <circle cx={EAR_L.x - 30} cy={EAR_L.y} r="34" fill={accent}>
          <animate attributeName="opacity" values="1;0.65;1" dur="2.8s" repeatCount="indefinite" />
        </circle>
        <circle cx={EAR_L.x - 30 - 8} cy={EAR_L.y - 8} r="10" fill={jadeBright} opacity="0.85" />
        {/* Tiny audio cable hint */}
        <path d={`M ${EAR_L.x - 30} ${EAR_L.y + 30} Q ${EAR_L.x - 60} ${EAR_L.y + 120} ${EAR_L.x - 30} ${EAR_L.y + 200}`} fill="none" stroke={accent} strokeWidth="6" opacity="0.55" />

        <circle cx={EAR_R.x + 30} cy={EAR_R.y} r="34" fill={accent}>
          <animate attributeName="opacity" values="1;0.65;1" dur="2.8s" repeatCount="indefinite" begin="0.5s" />
        </circle>
        <circle cx={EAR_R.x + 30 - 8} cy={EAR_R.y - 8} r="10" fill={jadeBright} opacity="0.85" />
        <path d={`M ${EAR_R.x + 30} ${EAR_R.y + 30} Q ${EAR_R.x + 60} ${EAR_R.y + 120} ${EAR_R.x + 30} ${EAR_R.y + 200}`} fill="none" stroke={accent} strokeWidth="6" opacity="0.55" />
      </g>
    );
  }

  /* ── Halo Loop: bold jade rings framing the side caps ── */
  if (headphonesId === "loop") {
    return (
      <g>
        <ellipse cx={EAR_L.x} cy={EAR_L.y} rx="60" ry="86" fill="none" stroke={accent} strokeWidth="14" />
        <ellipse cx={EAR_L.x} cy={EAR_L.y} rx="36" ry="56" fill={accent} opacity="0.35">
          <animate attributeName="opacity" values="0.35;0.7;0.35" dur="2.4s" repeatCount="indefinite" />
        </ellipse>
        <ellipse cx={EAR_R.x} cy={EAR_R.y} rx="60" ry="86" fill="none" stroke={accent} strokeWidth="14" />
        <ellipse cx={EAR_R.x} cy={EAR_R.y} rx="36" ry="56" fill={accent} opacity="0.35">
          <animate attributeName="opacity" values="0.35;0.7;0.35" dur="2.4s" repeatCount="indefinite" begin="0.6s" />
        </ellipse>
      </g>
    );
  }

  /* ── Wing Fins: angular jade fins slicing back ── */
  if (headphonesId === "fins") {
    const finL = `M ${EAR_L.x + 20} ${EAR_L.y - 80}
                  L ${EAR_L.x - 130} ${EAR_L.y - 30}
                  L ${EAR_L.x - 150} ${EAR_L.y + 30}
                  L ${EAR_L.x - 60} ${EAR_L.y + 50}
                  L ${EAR_L.x + 20} ${EAR_L.y + 70} Z`;
    const finR = `M ${EAR_R.x - 20} ${EAR_R.y - 80}
                  L ${EAR_R.x + 130} ${EAR_R.y - 30}
                  L ${EAR_R.x + 150} ${EAR_R.y + 30}
                  L ${EAR_R.x + 60} ${EAR_R.y + 50}
                  L ${EAR_R.x - 20} ${EAR_R.y + 70} Z`;
    return (
      <g>
        <path d={finL} fill={accent} />
        <path d={finL} fill="none" stroke={jadeBright} strokeWidth="4" opacity="0.6" />
        <path d={finR} fill={accent} />
        <path d={finR} fill="none" stroke={jadeBright} strokeWidth="4" opacity="0.6" />
      </g>
    );
  }

  return null;
}

/* ════════════════════════════════════════════════════════════════════════
 *  Main component
 * ════════════════════════════════════════════════════════════════════════ */
export function AgentAvatarSvg({
  config,
  expression = "happy",
  className = "",
  size,
  static: isStatic = false,
}: AgentAvatarSvgProps) {
  const accent = getAccentHex(config?.accent);
  const chassisSpec = getChassisSpec(config?.chassis);
  const eyesId = config?.eyes ?? "smile";
  const antennaId = config?.antenna ?? "jewel";
  const wingsId = config?.wings ?? "none";
  const headphonesId = config?.headphones ?? "bumper";
  // Base color → chassis (shell) directly. Pearl chassis on a default bot,
  // onyx chassis when the user picks the dark base, etc.
  const shellHex = getShellHex(config?.baseColor);
  const light = isLightBase(config?.baseColor);
  // The "visor" is the screen plate around the eyes (the inset face).
  // When the user picks a Visor Color, it overrides the auto contrast.
  const insetHex = getInsetHex(config?.baseColor, config?.visorColor);
  // Bezel: a slightly darker line on light chassis, slightly lighter on dark.
  const bezelHex = light ? darken(shellHex, 0.55) : lighten(shellHex, 0.45);
  const jadeBright = BRAND_COLORS.jadeBright;

  const innerScale = `translate(627 627) scale(${chassisSpec.scaleX} ${chassisSpec.scaleY}) translate(-627 -627)`;
  const svgId = useMemo(() => {
    agentAvatarSvgInstanceCounter += 1;
    return `cux-agent-avatar-${agentAvatarSvgInstanceCounter}`;
  }, []);
  const shellGradientId = `${svgId}-shell-grad`;
  const insetGradientId = `${svgId}-inset-grad`;
  const auraGlowId = `${svgId}-aura-glow`;
  const botShadowId = `${svgId}-bot-shadow`;
  const orbitPathId = `${svgId}-orbit-path`;

  return (
    <svg
      viewBox="0 0 1254 1254"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      width={size}
      height={size}
      data-testid="agent-avatar-svg"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={shellGradientId} cx="50%" cy="32%" r="75%">
          <stop offset="0%" stopColor={lighten(shellHex, 0.06)} />
          <stop offset="55%" stopColor={shellHex} />
          <stop offset="100%" stopColor={darken(shellHex, 0.08)} />
        </radialGradient>
        <radialGradient id={insetGradientId} cx="50%" cy="30%" r="75%">
          <stop offset="0%" stopColor={lighten(insetHex, 0.12)} />
          <stop offset="100%" stopColor={insetHex} />
        </radialGradient>
        <radialGradient id={auraGlowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={accent} stopOpacity="0.55" />
          <stop offset="100%" stopColor={accent} stopOpacity="0" />
        </radialGradient>
        <filter id={botShadowId} x="-12%" y="-12%" width="124%" height="124%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="18" />
          <feOffset dy="14" result="off" />
          <feComponentTransfer><feFuncA type="linear" slope={light ? "0.18" : "0.42"} /></feComponentTransfer>
          <feMerge><feMergeNode /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {/* Ambient aura — sits behind the tile */}
      {renderAura(wingsId, accent, jadeBright, orbitPathId)}

      {/* Big soft jade glow behind the tile */}
      <ellipse cx="627" cy="700" rx="600" ry="560" fill={`url(#${auraGlowId})`} opacity="0.55" />

      {/* Float wrap — bot only (no surrounding tile). The drop-shadow
          filter wraps every layer so the floating bot casts a soft shadow
          on whatever background the host provides. */}
      <g filter={`url(#${botShadowId})`}>
        {!isStatic && (
          <animateTransform
            attributeName="transform"
            type="translate"
            values="0,0; 0,-14; 0,0"
            dur="4.2s"
            repeatCount="indefinite"
          />
        )}

        {/* Antenna sits above the bot */}
        <g transform={innerScale}>{renderAntenna(antennaId, accent, jadeBright, expression)}</g>

        <g transform={innerScale}>
          {/* White face shell + ear caps — the bot's body */}
          <path d={PATH_FACE_SHELL} fill={`url(#${shellGradientId})`} />
          <path d={PATH_EAR_LEFT} fill={`url(#${shellGradientId})`} />
          <path d={PATH_EAR_RIGHT} fill={`url(#${shellGradientId})`} />

          {/* Subtle inner edge highlight on top of the shell */}
          <path
            d={PATH_FACE_SHELL}
            fill="none"
            stroke={light ? "rgba(0,0,0,0.18)" : "rgba(255,255,255,0.25)"}
            strokeWidth="3"
            opacity="0.7"
          />

          {/* Headphones — layered over the ear-cap area (skipped for "bumper") */}
          {renderHeadphones(headphonesId, accent, jadeBright, shellHex)}

          {/* Dark inset face — the screen */}
          <path d={PATH_INSET_FACE} fill={`url(#${insetGradientId})`} />

          {/* Bezel sliver — the dark line above the inset */}
          <path d={PATH_BEZEL_SLIVER} fill={bezelHex} />

          {/* Eyes inside the dark inset */}
          {renderEyes(eyesId, expression, accent, jadeBright)}

          {/* Inner glow inside the inset face — pulses subtly */}
          <ellipse cx={627} cy={700} rx="220" ry="120" fill={`url(#${auraGlowId})`} opacity="0.18" pointerEvents="none">
            <animate attributeName="opacity" values="0.18;0.08;0.18" dur="3s" repeatCount="indefinite" />
          </ellipse>
        </g>
      </g>
    </svg>
  );
}

/* ── tiny color helpers ── */
function lighten(hex: string, factor: number): string {
  const m = hex.match(/^#?([\da-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.min(255, ((n >> 16) & 0xff) + Math.round(factor * 90));
  const g = Math.min(255, ((n >> 8) & 0xff) + Math.round(factor * 90));
  const b = Math.min(255, (n & 0xff) + Math.round(factor * 90));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function darken(hex: string, factor: number): string {
  const m = hex.match(/^#?([\da-f]{6})$/i);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 0xff) * (1 - factor)));
  const g = Math.max(0, Math.round(((n >> 8) & 0xff) * (1 - factor)));
  const b = Math.max(0, Math.round((n & 0xff) * (1 - factor)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
