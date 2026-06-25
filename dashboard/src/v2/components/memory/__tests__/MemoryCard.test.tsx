/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryCard } from "../MemoryCard.js";
import { lobotomizeModeSignal, memoriesSignal } from "../memoryState.js";
import { memoryMutationsSignal } from "../memoryState.js";

expect.extend(matchers);



vi.mock("../../../hooks/use-confirm-dialog.js", () => ({
    useConfirmDialog: () => ({
        isOpen: false,
        options: null,
        requestConfirm: vi.fn().mockResolvedValue(true),
        handleConfirm: vi.fn(),
        handleCancel: vi.fn(),
        triggerRef: { current: null }
    })
}));

describe("MemoryCard", () => {
    const mockRemoveMemory = vi.fn();
    memoryMutationsSignal.value = { removeMemory: mockRemoveMemory, addMemory: vi.fn(), feedback: null, clearFeedback: vi.fn() };
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

    test("shows Danger button when lobotomizeModeSignal is true and deletes on click", async () => {
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

        const deleteButton = getByRole("button", { name: /Delete Context memory: test-content/i });
        expect(deleteButton).toBeInTheDocument();

        await fireEvent.click(deleteButton);

        expect(mockRemoveMemory).toHaveBeenCalledWith("test-id");
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

        expect(queryByRole("button", { name: /Delete Context memory: test-content/i })).not.toBeInTheDocument();
    });

    test("has correct accessibility attributes", () => {
        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="accessible-test-content"
                category="architecture"
                strength={0.75}
                onClick={vi.fn()}
            />
        );

        const card = getByRole("option", { name: "Architecture memory, strength 75%. accessible-test-content" });
        expect(card).toBeInTheDocument();
        expect(card).toHaveAttribute("aria-selected", "false");
    });
});
