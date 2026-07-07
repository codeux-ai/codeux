/** @vitest-environment happy-dom */
import { h } from "preact";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, renderHook, screen } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { useInteractionTokens, INTERACTION_TOKENS, INTERACTION_CONTRACT_NAMES, INTERACTION_CSS_VARIABLES, buildInteractionTransition } from "../../motion/tokens.js";
import { useGsapInteractionTokens, GSAP_INTERACTION_TOKENS } from "../../motion/constants.js";

expect.extend(matchers);

// Mock the hook to test both true and false states
const mockUseReducedMotion = vi.fn();
// We need to ensure useResolvedMotionDuration inside useReducedMotionSafe re-runs properly when state changes in tests.
// Let's ensure mockUseReducedMotion is properly affecting the return of useResolvedMotionDuration.
vi.mock("../../../hooks/use-reduced-motion.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../hooks/use-reduced-motion.js")>();
  return {
    ...actual,
  useReducedMotion: () => mockUseReducedMotion(),
    useResolvedMotionDuration: (duration: string | number) => {
      const isReduced = mockUseReducedMotion();
      if (isReduced) {
        return typeof duration === "number" ? 0 : "0ms";
      }
      return duration;
    }
  };
});

describe("Interaction Tokens", () => {
  beforeEach(() => {
    mockUseReducedMotion.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("exports every named CSS and GSAP interaction contract", () => {
    expect(INTERACTION_CONTRACT_NAMES).toEqual([
      "controlFeedback",
      "enterExit",
      "expansionCollapse",
      "selectionMovement",
      "listReveal",
      "listReorder",
      "inlineValidation",
      "asyncFeedback"
    ]);

    for (const contract of INTERACTION_CONTRACT_NAMES) {
      expect(INTERACTION_TOKENS[contract].duration).toBeTruthy();
      expect(INTERACTION_TOKENS[contract].ease).toBeTruthy();
      expect(GSAP_INTERACTION_TOKENS[contract].duration).toBeTypeOf("number");
      expect(GSAP_INTERACTION_TOKENS[contract].ease).toBeTruthy();
      expect(INTERACTION_CSS_VARIABLES[contract].duration).toContain("var(--interaction-");
    }
  });

  it("builds transition strings from CSS interaction variables", () => {
    expect(buildInteractionTransition("controlFeedback", "opacity")).toBe("opacity var(--interaction-control-feedback-duration) var(--interaction-control-feedback-ease)");
  });

  it("maps explicit app reduced-motion settings to zero-duration tokens and static animation utilities", () => {
    const tokensCss = readFileSync(resolve(process.cwd(), "dashboard/src/v2/styles/tokens.css"), "utf8");
    const stylesCss = readFileSync(resolve(process.cwd(), "dashboard/src/styles.css"), "utf8");

    expect(tokensCss).toMatch(/:root\[data-reduced-motion="true"\]/);
    expect(tokensCss).toMatch(/:root\[data-reduced-motion="REDUCE"\]/);
    expect(tokensCss).toMatch(/--interaction-async-feedback-duration: var\(--motion-slow\)/);
    expect(stylesCss).toMatch(/:root\[data-reduced-motion="true"\][\s\S]*animation-duration: 0\.01ms !important/);
    expect(stylesCss).toMatch(/:root\[data-reduced-motion="REDUCE"\][\s\S]*\.animate-spin/);
    expect(stylesCss).toMatch(/\.live-duration-badge[\s\S]*var\(--status-static-running-ring\)/);
  });

  describe("useInteractionTokens", () => {
    it("returns standard tokens when reduced motion is false", () => {
      mockUseReducedMotion.mockReturnValue(false);
      const { result } = renderHook(() => useInteractionTokens());

      expect(result.current.listReveal.duration).toBe(INTERACTION_TOKENS.listReveal.duration);
      expect(result.current.listReveal.ease).toBe(INTERACTION_TOKENS.listReveal.ease);
      expect(result.current.inlineValidation.duration).toBe(INTERACTION_TOKENS.inlineValidation.duration);
    });

    it("returns 0ms durations when reduced motion is true", () => {
      mockUseReducedMotion.mockReturnValue(true);
      const { result } = renderHook(() => useInteractionTokens());

      expect(result.current.listReveal.duration).toBe("0ms");
      expect(result.current.listReorder.duration).toBe("0ms");
      expect(result.current.inlineValidation.duration).toBe("0ms");
      // Ease should remain the same
      expect(result.current.listReveal.ease).toBe(INTERACTION_TOKENS.listReveal.ease);
    });

    it("keeps semantic async status mounted when reduced motion snaps duration to zero", () => {
      function AsyncTokenStatus() {
        const tokens = useInteractionTokens();

        return (
          <div
            role="status"
            aria-live="polite"
            aria-busy="true"
            style={{
              transitionDuration: tokens.asyncFeedback.duration,
              transitionTimingFunction: tokens.asyncFeedback.ease,
            }}
          >
            Refreshing project cards.
            <button type="button">Cancel refresh</button>
          </div>
        );
      }

      mockUseReducedMotion.mockReturnValue(true);
      render(<AsyncTokenStatus />);

      const status = screen.getByRole("status");
      expect(status).toHaveAttribute("aria-busy", "true");
      expect(status).toHaveTextContent("Refreshing project cards.");
      expect(status).toHaveStyle({
        transitionDuration: "0ms",
        transitionTimingFunction: INTERACTION_TOKENS.asyncFeedback.ease,
      });
      expect(screen.getByRole("button", { name: "Cancel refresh" })).toBeInTheDocument();
    });
  });

  describe("useGsapInteractionTokens", () => {
    it("returns standard GSAP tokens when reduced motion is false", () => {
      mockUseReducedMotion.mockReturnValue(false);
      const { result } = renderHook(() => useGsapInteractionTokens());

      expect(result.current.listReveal.duration).toBe(GSAP_INTERACTION_TOKENS.listReveal.duration);
      expect(result.current.listReveal.ease).toBe(GSAP_INTERACTION_TOKENS.listReveal.ease);
      expect(result.current.inlineValidation.duration).toBe(GSAP_INTERACTION_TOKENS.inlineValidation.duration);
    });

    it("returns 0 durations when reduced motion is true", () => {
      mockUseReducedMotion.mockReturnValue(true);
      const { result } = renderHook(() => useGsapInteractionTokens());

      expect(result.current.listReveal.duration).toBe(0);
      expect(result.current.listReorder.duration).toBe(0);
      expect(result.current.inlineValidation.duration).toBe(0);
      // Ease should remain the same
      expect(result.current.listReveal.ease).toBe(GSAP_INTERACTION_TOKENS.listReveal.ease);
    });
  });
});
