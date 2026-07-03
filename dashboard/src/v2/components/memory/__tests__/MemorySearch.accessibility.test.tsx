/** @vitest-environment jsdom */
import { h } from "preact";
import { act, render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, afterEach } from "vitest";
import { vi } from "vitest";
import { MemorySearch } from "../MemorySearch.js";
import { searchQuerySignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemorySearch Accessibility", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        searchQuerySignal.value = "";
        vi.clearAllTimers();
        vi.useRealTimers();
    });

    test("input has accessible label", () => {
        searchQuerySignal.value = "";
        const { getByRole } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memories" });
        expect(input).toBeInTheDocument();
        expect(input).toHaveAttribute("placeholder", "Search memories by name or category...");
    });

    test("clear button has accessible label and displays Esc shortcut text", () => {
        searchQuerySignal.value = "test search";
        const { getByRole, getByText } = render(<MemorySearch />);
        const clearButton = getByRole("button", { name: "Clear search" });
        expect(clearButton).toBeInTheDocument();
        expect(getByText("Esc")).toBeInTheDocument();
    });

    test("ESC key clears search and keeps input focused", async () => {
        searchQuerySignal.value = "test search";
        const { getByRole } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memories" });
        input.focus();
        expect(document.activeElement).toBe(input);

        await fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

        expect(searchQuerySignal.value).toBe("");
        expect(document.activeElement).toBe(input);
    });

    test("ESC key clears search and makes polite announcement", async () => {
        searchQuerySignal.value = "test search";
        const { getByRole, getByText } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memories" });
        input.focus();

        await fireEvent.keyDown(input, { key: "Escape", code: "Escape" });

        expect(getByText("Search cleared")).toBeInTheDocument();
    });

    test("typing in search makes active-query polite announcement", async () => {
        searchQuerySignal.value = "";
        const { getByRole, getByText } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memories" });

        await fireEvent.input(input, { target: { value: "test query" } });

        expect(getByText("Searching...")).toBeInTheDocument();
    });

    test("typing debounces search signal updates", async () => {
        vi.useFakeTimers();
        searchQuerySignal.value = "";
        const { getByRole } = render(<MemorySearch />);
        const input = getByRole("textbox", { name: "Search memories" });

        await fireEvent.input(input, { target: { value: "architecture" } });

        expect(input).toHaveValue("architecture");
        expect(searchQuerySignal.value).toBe("");

        await act(async () => {
            vi.advanceTimersByTime(179);
        });
        expect(searchQuerySignal.value).toBe("");

        await act(async () => {
            vi.advanceTimersByTime(1);
        });
        expect(searchQuerySignal.value).toBe("architecture");
    });
});
