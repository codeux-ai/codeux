/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/preact";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
import { RerunTaskModal } from "../RerunTaskModal.js";
import { DashboardI18nProvider } from "../../../i18n/context.js";

expect.extend(matchers);

vi.mock("../../../lib/settings-api.js", () => ({
  fetchSystemSettings: vi.fn(() => new Promise(() => {})),
}));

describe("RerunTaskModal", () => {
  const task = {
    id: "TASK-1",
    title: "Implement task flow",
    depends_on: [],
    status: "COMPLETED",
    is_merged: true,
    merge_indicator: "MERGED",
  };
  const downstreamTask = {
    id: "TASK-2",
    title: "Follow-up validation",
    depends_on: ["TASK-1"],
    status: "COMPLETED",
    is_merged: false,
    merge_indicator: "",
  };

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  test("announces provider loading and exposes destructive choices as reachable checkboxes", () => {
    render(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        currentProvider="auto"
        onClose={() => {}}
        onConfirm={() => {}}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Loading providers/i);
    expect(screen.getByRole("dialog", { name: /Rerun Task/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/Provider/i)).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /Reset downstream tasks/i })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /Undo the Git merge/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Clear worktree/i })).toBeInTheDocument();
  });

  test("does not call rerun confirmation when canceled, closed, escaped, or backdrop-dismissed", async () => {
    const onClose = vi.fn();
    const onConfirm = vi.fn();
    const { rerender } = render(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
    expect(onConfirm).not.toHaveBeenCalled();

    rerender(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: /Rerun Task/i });
    const backdrop = dialog.parentElement?.firstElementChild as HTMLElement | undefined;
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(4));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  test("keeps the modal open on rerun failure and routes retry through feedback", async () => {
    const onClose = vi.fn();
    const onConfirm = vi
      .fn()
      .mockRejectedValueOnce(new Error("Rerun failed"))
      .mockResolvedValueOnce(undefined);

    render(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={onClose}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rerun Task/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Rerun failed/i);
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    await waitFor(() => {
      expect(screen.getAllByRole("status").some((element) => /Task rerun started/i.test(element.textContent ?? ""))).toBe(true);
    });
    expect(onConfirm).toHaveBeenCalledTimes(2);
  });

  test("disables destructive choices while submitting", async () => {
    const pendingSubmit = new Promise<void>(() => {});

    render(
      <RerunTaskModal
        task={task as any}
        allTasks={[task, downstreamTask] as any}
        onClose={() => {}}
        onConfirm={() => pendingSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Rerun Task/i }));

    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /Reset downstream tasks/i })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /Undo the Git merge/i })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /Clear worktree/i })).toBeDisabled();
    });
  });

  test("supports German rerun modes while preserving task and provider names", async () => {
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    render(
      <DashboardI18nProvider initialLocale="de" storage={null}>
        <RerunTaskModal
          task={task as any}
          allTasks={[task, downstreamTask] as any}
          currentProvider="provider-instance-alpha"
          onClose={() => {}}
          onConfirm={onConfirm}
        />
      </DashboardI18nProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Aufgabe erneut ausführen" })).toHaveTextContent("Implement task flow");
    expect(screen.getByText(/provider-instance-alpha/)).toBeInTheDocument();
    const reset = screen.getByRole("checkbox", { name: /Nachgelagerte Aufgaben zurücksetzen/i });
    const undo = screen.getByRole("checkbox", { name: /Git-Merge rückgängig machen/i });
    const clear = screen.getByRole("checkbox", { name: /Worktree leeren/i });
    fireEvent.click(reset);
    fireEvent.click(clear);
    expect(undo).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "Aufgabe erneut ausführen" }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ resetDependents: true, clearWorktree: true, undoMerge: true })));
  });
});
