/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryCard } from "../MemoryCard.js";
import { lobotomizeModeSignal, memoriesSignal } from "../memoryState.js";
import * as MemoryApi from "../../../lib/memory-api.js";

expect.extend(matchers);

vi.mock("../../../lib/memory-api.js", () => ({
    deleteMemory: vi.fn(),
}));

describe("MemoryCard", () => {
    afterEach(() => {
        vi.clearAllMocks();
        lobotomizeModeSignal.value = false;
        memoriesSignal.value = [];
        document.body.innerHTML = "";
    });

    test("renders correctly", () => {
        const { getByText } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );
        expect(getByText("test-content")).toBeInTheDocument();
    });

    test("shows X button when lobotomizeModeSignal is true and deletes on click", async () => {
        lobotomizeModeSignal.value = true;
        memoriesSignal.value = [{ id: "test-id" }];

        const { container, getByRole, queryByText } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );

        const deleteButton = getByRole("button", { name: "Delete memory" });
        expect(deleteButton).toBeInTheDocument();

        await fireEvent.click(deleteButton);

        expect(MemoryApi.deleteMemory).toHaveBeenCalledWith("test-id");
        expect(memoriesSignal.value).toEqual([]);
        expect(queryByText("test-content")).not.toBeInTheDocument();
    });

    test("does not show X button when lobotomizeModeSignal is false", () => {
        lobotomizeModeSignal.value = false;

        const { queryByRole } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );

        expect(queryByRole("button", { name: "Delete memory" })).not.toBeInTheDocument();
    });
});
