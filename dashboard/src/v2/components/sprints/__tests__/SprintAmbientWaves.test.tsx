// @vitest-environment jsdom
/// <reference types="@testing-library/jest-dom" />
import { cleanup, render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import gsap from "gsap";
import { SprintAmbientWaves } from "../SprintAmbientWaves.js";

expect.extend(matchers);

const revert = vi.fn();

vi.mock("gsap", () => ({
  default: {
    context: vi.fn((callback: () => void) => {
      callback();
      return { revert };
    }),
    to: vi.fn(),
  },
}));

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
  useReducedMotion: () => false,
}));

describe("SprintAmbientWaves", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("runs three independent low-amplitude ambient wave cycles", () => {
    const { container, unmount } = render(<SprintAmbientWaves active />);

    expect(container.querySelector("[data-sprint-ambient-waves]")).toHaveAttribute("data-motion", "ambient");
    expect(gsap.to).toHaveBeenCalledTimes(3);
    expect(gsap.to).toHaveBeenCalledWith(expect.any(SVGGElement), expect.objectContaining({
      duration: 24,
      repeat: -1,
      yoyo: true,
    }));
    expect(gsap.to).toHaveBeenCalledWith(expect.any(SVGGElement), expect.objectContaining({
      duration: 31,
      repeat: -1,
      yoyo: true,
    }));
    expect(gsap.to).toHaveBeenCalledWith(expect.any(SVGGElement), expect.objectContaining({
      duration: 28,
      repeat: -1,
      yoyo: true,
    }));

    unmount();
    expect(revert).toHaveBeenCalledOnce();
  });

  it("does not mount an ambient surface for an inactive sprint", () => {
    const { container } = render(<SprintAmbientWaves active={false} />);

    expect(container.querySelector("[data-sprint-ambient-waves]")).not.toBeInTheDocument();
    expect(gsap.to).not.toHaveBeenCalled();
  });
});
