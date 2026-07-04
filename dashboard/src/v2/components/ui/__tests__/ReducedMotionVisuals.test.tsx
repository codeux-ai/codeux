// @vitest-environment jsdom
import { render } from "@testing-library/preact";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sparkline } from "../Sparkline.js";
import { WaveFluid } from "../WaveFluid.js";
import { BorderTrace } from "../BorderTrace.js";
import { ContainerShip } from "../PlanningShip.js";
import { Card } from "../Card.js";
import { EmptyState } from "../EmptyState.js";
import * as matchers from '@testing-library/jest-dom/matchers';

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: vi.fn().mockReturnValue(true)
}));

import { useReducedMotion } from "../../../hooks/use-reduced-motion.js";

describe("Reduced Motion Visuals", () => {
    beforeEach(() => {
        vi.mocked(useReducedMotion).mockReturnValue(true);
    });

    it("WaveFluid disables inline animation", () => {
        const { container } = render(<WaveFluid accentHex="#000" />);
        const svg = container.querySelector("svg");
        expect(svg).toHaveStyle({ animation: "none" });
    });

    it("BorderTrace has motion-safe classes", () => {
        const { container } = render(<BorderTrace accentHex="#000" />);
        const trace = container.querySelector(".origin-center");
        expect(trace).toHaveClass("motion-safe:transition-transform");
    });

    it("Sparkline renders path", () => {
        const { container } = render(<Sparkline points={[1, 2, 3]} color="#000" />);
        const path = container.querySelector("path[d]");
        expect(path).toBeInTheDocument();
    });

    it("PlanningShip does not render animate when reduced motion", () => {
        const { container } = render(<ContainerShip accentColor="#000" isMoving={true} isDark={false} />);
        const animate = container.querySelector("animate");
        expect(animate).toBeNull();
    });

    it("Card exposes a static reduced-motion primitive surface", () => {
        const { container } = render(<Card>Surface</Card>);
        const card = container.firstChild as HTMLElement;

        expect(card).toHaveClass("bg-[var(--surface-glass)]");
        expect(card).toHaveClass("border-[color:var(--border-hairline)]");
        expect(card).toHaveClass("shadow-[var(--elevation-base)]");
        expect(card).toHaveClass("motion-reduce:transition-none");
    });

    it("EmptyState uses shared static surface and metadata classes", () => {
        const { container, getByText } = render(
            <EmptyState
                icon={<span aria-hidden="true">I</span>}
                title="Nothing queued"
                description="Create a sprint to begin."
            />
        );
        const emptyState = container.firstChild as HTMLElement;
        const description = getByText("Create a sprint to begin.");

        expect(emptyState).toHaveClass("bg-[var(--surface-glass)]");
        expect(emptyState).toHaveClass("border-[color:var(--border-hairline)]");
        expect(emptyState).toHaveClass("motion-reduce:transition-none");
        expect(description).toHaveClass("text-[color:var(--text-metadata)]");
    });
});
