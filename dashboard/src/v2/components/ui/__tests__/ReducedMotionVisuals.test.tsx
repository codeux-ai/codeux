// @vitest-environment jsdom
import { render } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sparkline } from "../Sparkline.js";
import { WaveFluid } from "../WaveFluid.js";
import { BorderTrace } from "../BorderTrace.js";
import { ContainerShip } from "../PlanningShip.js";
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: vi.fn().mockReturnValue(true),
    useResolvedMotionDuration: vi.fn((duration: string | number) => typeof duration === "number" ? 0 : "0ms")
}));

import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

describe("Reduced Motion Visuals", () => {
    beforeEach(() => {
        vi.mocked(useReducedMotion).mockReturnValue(true);
    });

    it("WaveFluid disables inline animation", () => {
        const { container } = render(<WaveFluid accentHex="#000" isActive />);
        const svg = container.querySelector("svg");
        expect(svg).toHaveStyle({ animation: "none" });
        expect(container.firstElementChild).toHaveAttribute("data-active", "true");
        expect(container.firstElementChild).toHaveClass("opacity-[0.65]");
    });

    it("BorderTrace uses tokenized transition classes", () => {
        const { container } = render(<BorderTrace accentHex="#000" />);
        const trace = container.querySelector(".origin-center");
        expect(trace).toHaveClass("motion-safe:transition-transform");
        expect(trace).toHaveStyle({
            transition: "transform var(--interaction-control-feedback-duration) var(--interaction-control-feedback-ease)"
        });
    });

    it("Sparkline renders static path with stronger opacity", () => {
        const { container } = render(<Sparkline points={[1, 2, 3]} color="#000" />);
        const svg = container.querySelector("svg");
        const path = container.querySelector("path[d]");
        expect(svg).toHaveStyle({ opacity: "0.32" });
        expect(path).toBeInTheDocument();
    });

    it("PlanningShip does not render animate when reduced motion", () => {
        const { container } = render(<ContainerShip accentColor="#000" isMoving={true} isDark={false} />);
        const animate = container.querySelector("animate");
        expect(animate).toBeNull();
    });
});
