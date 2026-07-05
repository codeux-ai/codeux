/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent, within } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { MemoryCard } from "../MemoryCard.js";
import { activeMemoryIdSignal, lobotomizeModeSignal, memoryMutationsSignal, selectedMemoryIdsSignal } from "../memoryState.js";

expect.extend(matchers);

describe("MemoryCard", () => {
    const mockRemoveMemory = vi.fn();
    memoryMutationsSignal.value = {
        removeMemory: mockRemoveMemory,
        removeMemories: vi.fn().mockResolvedValue([]),
        addMemory: vi.fn(),
        feedback: { status: "idle", message: null },
        clearFeedback: vi.fn(),
        clearError: vi.fn()
    };
    afterEach(() => {
        vi.clearAllMocks();
        lobotomizeModeSignal.value = false;
        activeMemoryIdSignal.value = null;
        selectedMemoryIdsSignal.value = [];
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

    test("shows danger warning and requires arming before deleting", async () => {
        lobotomizeModeSignal.value = true;

        const { getByRole, getByText } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );

        expect(getByText("Danger delete mode is on. Arm this card before deleting it.")).toBeInTheDocument();
        const armButton = getByRole("button", { name: /Arm delete for Context memory: test-content/i });
        expect(armButton).toHaveAttribute("aria-pressed", "false");

        fireEvent.click(armButton);

        expect(mockRemoveMemory).not.toHaveBeenCalled();
        expect(getByText("Delete is armed for this memory. Confirm delete now or cancel.")).toBeInTheDocument();

        const confirmButton = getByRole("button", { name: /Confirm delete Context memory: test-content/i });
        expect(confirmButton).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(confirmButton);

        expect(mockRemoveMemory).toHaveBeenCalledWith("test-id");
    });

    test("armed delete click does not also select the card", () => {
        lobotomizeModeSignal.value = true;
        const onClick = vi.fn();

        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={onClick}
            />
        );

        fireEvent.click(getByRole("button", { name: /Arm delete for Context memory: test-content/i }));
        fireEvent.click(getByRole("button", { name: /Confirm delete Context memory: test-content/i }));

        expect(mockRemoveMemory).toHaveBeenCalledWith("test-id");
        expect(onClick).not.toHaveBeenCalled();
    });

    test("cancel clears armed danger delete state", () => {
        lobotomizeModeSignal.value = true;

        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );

        fireEvent.click(getByRole("button", { name: /Arm delete for Context memory: test-content/i }));
        fireEvent.click(getByRole("button", { name: "Cancel delete for Context memory" }));

        expect(mockRemoveMemory).not.toHaveBeenCalled();
        expect(getByRole("button", { name: /Arm delete for Context memory: test-content/i })).toHaveAttribute("aria-pressed", "false");
    });

    test("open details action selects the card once", () => {
        const onClick = vi.fn();

        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="test-content"
                category="context"
                strength={0.8}
                onClick={onClick}
            />
        );

        fireEvent.click(getByRole("button", { name: "Open Context memory details" }));

        expect(onClick).toHaveBeenCalledTimes(1);
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

        expect(queryByRole("button", { name: /Arm delete for Context memory: test-content/i })).not.toBeInTheDocument();
    });

    test("exposes a batch selection toggle with an accessible name", () => {
        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="toggle-test-content"
                category="context"
                strength={0.8}
                onClick={vi.fn()}
            />
        );

        const toggle = getByRole("button", { name: "Select Context memory" });
        expect(toggle).toHaveAttribute("aria-pressed", "false");

        fireEvent.click(toggle);

        expect(selectedMemoryIdsSignal.value).toContain("test-id");
        expect(getByRole("button", { name: "Deselect Context memory" })).toHaveAttribute("aria-pressed", "true");
    });

    test("batch selection keyboard event does not also open the card", () => {
        const onClick = vi.fn();
        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="toggle-test-content"
                category="context"
                strength={0.8}
                onClick={onClick}
            />
        );

        fireEvent.keyDown(getByRole("button", { name: "Select Context memory" }), { key: "Enter" });

        expect(onClick).not.toHaveBeenCalled();
    });

    test("has correct accessibility attributes", () => {
        const { getByRole } = render(
            <MemoryCard
                id="test-id"
                content="accessible-test-content"
                category="architecture"
                strength={0.75}
                scope="project"
                onClick={vi.fn()}
            />
        );

        const card = getByRole("option", { name: "Architecture memory, scope project, strength 75%. Not selected. accessible-test-content" });
        expect(card).toBeInTheDocument();
        expect(card).toHaveAttribute("aria-selected", "false");
    });

    test("sets aria-selected when activeMemoryIdSignal matches id", () => {
        activeMemoryIdSignal.value = "test-id";
        const { getByRole, getAllByText } = render(
            <MemoryCard
                id="test-id"
                content="accessible-test-content"
                category="architecture"
                strength={0.75}
                scope="project"
                onClick={vi.fn()}
            />
        );

        const card = getByRole("option", { name: "Architecture memory, scope project, strength 75%. Currently open in inspector. accessible-test-content" });
        expect(card).toHaveAttribute("aria-selected", "true");
        expect(getAllByText("Open").length).toBeGreaterThan(0);
        activeMemoryIdSignal.value = null; // cleanup
    });

    test("keeps static selected cues for reduced-motion users", () => {
        activeMemoryIdSignal.value = "test-id";
        const { getByRole, getByText } = render(
            <MemoryCard
                id="test-id"
                content="static-selected-content"
                category="architecture"
                strength={0.75}
                scope="project"
                onClick={vi.fn()}
            />
        );

        const card = getByRole("option", { name: /Currently open in inspector/ });
        expect(card.className).toContain("border-signal-500");
        expect(card.className).toContain("ring-1");
        expect(within(card).getAllByText("Open").length).toBeGreaterThan(0);
    });
});
