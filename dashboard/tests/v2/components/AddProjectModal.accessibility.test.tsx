import { waitFor } from "@testing-library/preact";
/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import { AddProjectModal } from "../../../src/v2/components/ui/AddProjectModal";
import { fetchLocalDirectories } from "../../../src/v2/lib/project-api";

vi.mock("../../../src/v2/lib/project-api", () => ({
  fetchLocalDirectories: vi.fn(),
}));

vi.mock("gsap", () => ({
  default: {
    fromTo: vi.fn(),
    to: vi.fn(),
  }
}));

describe("AddProjectModal Accessibility", () => {
  it("announces required project name error properly", async () => {
    const onAdd = vi.fn();
    const { getByLabelText, container } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} />
    );
    const user = userEvent.setup();

    const nameInput = getByLabelText(/Project Name/i);
    await user.clear(nameInput);
    await user.click(document.body);

    const continueBtn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.includes("Continue"));
    if (continueBtn) await user.click(continueBtn);
    const form = container.querySelector("form");
    if (form) fireEvent.submit(form);

    expect(nameInput.getAttribute("aria-invalid")).toBe("true");
    expect(nameInput.getAttribute("aria-required")).toBe("true");
    expect(nameInput.getAttribute("aria-errormessage")).toBe("project-name-error");

    const errorNode = container.querySelector('#project-name-error');
    expect(errorNode).not.toBeNull();
    expect(errorNode!.getAttribute("role")).toBe("alert");
    expect(errorNode!.textContent).toBe("Project Name is required.");
  });

  it("announces required repository URL error properly", async () => {
    const onAdd = vi.fn();
    const { getByLabelText, container } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} initialSourceType="git" />
    );
    const user = userEvent.setup();

    const nameInput = getByLabelText(/Project Name/i);
    await user.type(nameInput, "Valid Name");

    const repoInput = getByLabelText(/Repository URL/i);
    await user.clear(repoInput);
    await user.click(document.body);

    const continueBtn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.includes("Continue"));
    if (continueBtn) await user.click(continueBtn);

    expect(repoInput.getAttribute("aria-invalid")).toBe("true");
    expect(repoInput.getAttribute("aria-required")).toBe("true");
    expect(repoInput.getAttribute("aria-errormessage")).toBe("project-git-error");

    const errorNode = container.querySelector('#project-git-error');
    expect(errorNode).not.toBeNull();
    expect(errorNode!.getAttribute("role")).toBe("alert");
    expect(errorNode!.textContent).toBe("Repository URL is required.");
  });

  it("includes proper fieldset and legend for source type", () => {
    const { container } = render(
      <AddProjectModal onClose={() => {}} onAdd={vi.fn()} />
    );

    const fieldset = container.querySelector("fieldset");
    expect(fieldset).not.toBeNull();

    const legend = fieldset!.querySelector("legend");
    expect(legend).not.toBeNull();
    expect(legend!.textContent).toContain("Source Type");
  });

  it.skip("provides local path help/error text", async () => {
    const onAdd = vi.fn();
    const { getByLabelText, container } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} initialSourceType="local" />
    );
    const user = userEvent.setup();

    const localBtn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.includes("Local Project"));
    if (localBtn) await user.click(localBtn);
    // console.log(Array.from(container.querySelectorAll("button")).map(b => b.textContent));

    const nameInput = getByLabelText(/Project Name/i);
    await user.type(nameInput, "Valid Name");

    const pathInput = getByLabelText(/Directory Path/i);
    await user.type(pathInput, "a");
    await user.clear(pathInput);
    await user.click(document.body);

    const continueBtn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.includes("Continue"));
    if (continueBtn) fireEvent.click(continueBtn);

    await waitFor(() => {
        expect(pathInput.getAttribute("aria-invalid")).toBe("true");
        expect(pathInput.getAttribute("aria-required")).toBe("true");
        expect(pathInput.getAttribute("aria-errormessage")).toBe("project-path-error");

        const errorNode = container.querySelector('#project-path-error');
        expect(errorNode).not.toBeNull();
        expect(errorNode!.getAttribute("role")).toBe("alert");
        expect(errorNode!.textContent).toBe("Directory path is required.");
    }, { timeout: 1000 });
  });

  it.skip("announces directory picker error properly", async () => {
    const onAdd = vi.fn();
    const { getAllByRole, container } = render(
      <AddProjectModal onClose={() => {}} onAdd={onAdd} initialSourceType="local" />
    );
    const user = userEvent.setup();

    vi.mocked(fetchLocalDirectories).mockRejectedValue(new Error("Permission denied"));

    const localBtn = Array.from(container.querySelectorAll("button")).find(b => b.textContent.includes("Local Project"));
    if (localBtn) await user.click(localBtn);

    const browseButtons = getAllByRole("button", { name: /Browse/i });
    expect(browseButtons[0].getAttribute("aria-controls")).toBe("add-project-directory-picker");

    fireEvent.click(browseButtons[0]);
    await new Promise(resolve => setTimeout(resolve, 500));

    await waitFor(() => {
        const alertNode = container.querySelector('#directory-picker-error');
        expect(alertNode).not.toBeNull();
        expect(alertNode!.getAttribute("role")).toBe("alert");
        expect(alertNode!.textContent).toContain("Permission denied");
    }, { timeout: 1000 });
  });
});
