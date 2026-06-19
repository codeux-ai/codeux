/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/preact";
import { WaveFluid } from "../../../../../dashboard/src/v2/components/ui/WaveFluid";
import gsap from "gsap";

vi.mock("../../../../../dashboard/src/v2/hooks/use-reduced-motion.js", () => ({
  useResolvedMotionDuration: (d: any) => d,
  useReducedMotion: vi.fn(() => false),
}));

vi.mock("gsap", () => ({
  default: {
    context: vi.fn((cb) => {
      cb();
      return { revert: vi.fn() };
    }),
    to: vi.fn(),
    killTweensOf: vi.fn(),
  },
}));

describe("WaveFluid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("animates opacity when isActive is true", () => {
    render(<WaveFluid accentHex="#000000" isActive={true} />);

    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        opacity: 0.8,
        yoyo: true,
        repeat: -1,
      })
    );
  });

  it("clears animation when isActive is false", () => {
    render(<WaveFluid accentHex="#000000" isActive={false} />);

    expect(gsap.killTweensOf).toHaveBeenCalledWith(expect.any(HTMLDivElement));
    expect(gsap.to).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({
        clearProps: "opacity",
      })
    );
  });
});
