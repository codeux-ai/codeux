/** @vitest-environment jsdom */
import { h } from "preact";
import { render } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, afterEach } from "vitest";
import { MemorySearch } from "../MemorySearch.js";
import { searchQuerySignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemorySearch Accessibility", () => {
    afterEach(() => {
        document.body.innerHTML = "";
    });

    test("input has accessible label", () => {
        searchQuerySignal.value = "";
        const { getByRole } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memory" });
        expect(input).toBeInTheDocument();
    });

    test("clear button has accessible label", () => {
        searchQuerySignal.value = "test search";
        const { getByRole } = render(<MemorySearch />);
        const clearButton = getByRole("button", { name: "Clear search" });
        expect(clearButton).toBeInTheDocument();
    });
});
