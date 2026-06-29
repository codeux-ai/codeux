/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect, test, describe, vi, afterEach } from "vitest";
import { AddMemoryModal } from "../AddMemoryModal.js";
import { act } from "preact/test-utils";

expect.extend(matchers);

describe("AddMemoryModal Accessibility and Validation", () => {
    afterEach(() => {
        document.body.innerHTML = "";
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
    });
});
