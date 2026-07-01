/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryList } from "../MemoryList.js";
import { searchQuerySignal } from "../memoryState.js";

expect.extend(matchers);

vi.mock("../../../hooks/use-reduced-motion.js", () => ({
    useReducedMotion: () => false
}));

describe("MemoryList", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    test("renders empty state polite announcement", () => {
        searchQuerySignal.value = "nonexistent query";
        const { getByText } = render(
            <MemoryList nodes={[]} onSelectNode={vi.fn()} />
        );
        const announcement = getByText("No memories exist");
        expect(announcement).toBeInTheDocument();
        expect(announcement).toHaveClass("sr-only");
    });
});
