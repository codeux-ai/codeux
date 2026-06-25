/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
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

    test("clear button has accessible label and displays Esc shortcut text", () => {
        searchQuerySignal.value = "test search";
        const { getByRole, getByText } = render(<MemorySearch />);
        const clearButton = getByRole("button", { name: "Clear search" });
        expect(clearButton).toBeInTheDocument();
        expect(getByText("Esc")).toBeInTheDocument();
    });

    test("ESC key clears search and blurs input", async () => {
        searchQuerySignal.value = "test search";
        const { getByRole } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memory" });
        input.focus();
        expect(document.activeElement).toBe(input);

        await fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

        expect(searchQuerySignal.value).toBe("");
        expect(document.activeElement).not.toBe(input);
    });

});
