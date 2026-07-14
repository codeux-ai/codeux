/** @vitest-environment jsdom */
import { h } from "preact";
import { fireEvent, waitFor } from "@testing-library/preact";
import { renderWithDashboardI18n as render } from "../../../../../../tests/dashboard/helpers/dashboard-i18n-test-utils.js";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { AddMemoryModal } from "../AddMemoryModal.js";
import { act } from "preact/test-utils";
import { createMemory } from "../../../lib/memory-api.js";

expect.extend(matchers);

vi.mock("../../../lib/memory-api.js", () => ({
    createMemory: vi.fn(),
}));

describe("AddMemoryModal Accessibility and Validation", () => {
    afterEach(() => {
        document.body.innerHTML = "";
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    test("renders FieldWrapper labels correctly", () => {
        const { getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={vi.fn()} onCreated={vi.fn()} />
        );

        expect(getByText("Memory Content")).toBeInTheDocument();
        expect(getByText("Category")).toBeInTheDocument();
        expect(getByText("Strength")).toBeInTheDocument();
    });

    test("shows validation error when submitting empty content", async () => {
        const { getByRole, getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={vi.fn()} onCreated={vi.fn()} />
        );

        const addButton = getByRole("button", { name: "Add Memory" });

        await act(async () => {
            fireEvent.click(addButton);
        });

        await waitFor(() => {
             expect(getByText("Content is required")).toBeInTheDocument();
        });
        expect(getByRole("textbox", { name: /Memory Content/i })).toHaveFocus();
        expect(getByText("Add a memory description before submitting.")).toHaveAttribute("role", "alert");
    });

    test("shows pending feedback while submit is saving", async () => {
        let resolveCreate: (value: unknown) => void = () => {};
        vi.mocked(createMemory).mockReturnValue(new Promise((resolve) => {
            resolveCreate = resolve;
        }) as any);

        const { getByRole, getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={vi.fn()} onCreated={vi.fn()} />
        );

        fireEvent.input(getByRole("textbox", { name: /Memory Content/i }), { target: { value: "Remember this architecture decision" } });

        await act(async () => {
            fireEvent.click(getByRole("button", { name: "Add Memory" }));
        });

        expect(getByRole("dialog", { name: "Add Memory" })).toHaveAttribute("aria-busy", "true");
        expect(getByText("Saving memory...")).toBeInTheDocument();
        expect(getByRole("button", { name: "Saving…" })).toBeDisabled();

        await act(async () => {
            resolveCreate({
                id: "memory-1",
                projectId: "test-proj",
                scope: "project",
                content: "Remember this architecture decision",
                category: "context",
                strength: 0.7,
            });
        });
    });

    test("shows success feedback and restores focus on close", async () => {
        vi.useFakeTimers();
        vi.mocked(createMemory).mockResolvedValue({
            id: "memory-1",
            projectId: "test-proj",
            scope: "project",
            content: "Remember this architecture decision",
            category: "context",
            strength: 0.7,
        } as any);
        const onClose = vi.fn();
        const onCreated = vi.fn();
        const trigger = document.createElement("button");
        trigger.textContent = "Open add memory";
        document.body.appendChild(trigger);
        trigger.focus();

        const { getByRole, getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={onClose} onCreated={onCreated} />
        );

        fireEvent.input(getByRole("textbox", { name: /Memory Content/i }), { target: { value: "Remember this architecture decision" } });

        await act(async () => {
            fireEvent.click(getByRole("button", { name: "Add Memory" }));
        });

        await waitFor(() => {
            expect(getByText("Memory added. Refreshing the workspace.")).toBeInTheDocument();
        });
        expect(onCreated).toHaveBeenCalledTimes(1);

        act(() => {
            vi.advanceTimersByTime(450);
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(document.activeElement).toBe(trigger);
    });

    test("shows submit errors without closing the modal", async () => {
        vi.mocked(createMemory).mockRejectedValue(new Error("Embedding runtime unavailable"));
        const onClose = vi.fn();
        const { getByRole, getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={onClose} onCreated={vi.fn()} />
        );

        fireEvent.input(getByRole("textbox", { name: /Memory Content/i }), { target: { value: "Remember this failure mode" } });

        await act(async () => {
            fireEvent.click(getByRole("button", { name: "Add Memory" }));
        });

        await waitFor(() => {
            expect(getByText("Embedding runtime unavailable")).toBeInTheDocument();
        });
        expect(getByRole("dialog", { name: "Add Memory" })).toBeInTheDocument();
        expect(onClose).not.toHaveBeenCalled();
    });

    test("localizes German validation but keeps API diagnostics verbatim", async () => {
        vi.mocked(createMemory).mockRejectedValue(new Error("Embedding runtime unavailable: model API-v2"));
        const { getByRole, getByText } = render(
            <AddMemoryModal open={true} scope="project" projectId="test-proj" onClose={vi.fn()} onCreated={vi.fn()} />,
            "de",
        );

        fireEvent.click(getByRole("button", { name: "Erinnerung hinzufügen" }));
        expect(await waitFor(() => getByText("Inhalt ist erforderlich"))).toBeInTheDocument();

        fireEvent.input(getByRole("textbox", { name: /Erinnerungsinhalt/i }), { target: { value: "Persisted English memory content" } });
        await act(async () => {
            fireEvent.click(getByRole("button", { name: "Erinnerung hinzufügen" }));
        });
        expect(await waitFor(() => getByText("Embedding runtime unavailable: model API-v2"))).toBeInTheDocument();
    });
});
