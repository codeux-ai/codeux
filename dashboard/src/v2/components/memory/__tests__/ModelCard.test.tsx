/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { cleanup, render, screen } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelCard } from "../ModelCard.js";
import type { EmbeddingModelWithStatus } from "../../../lib/memory-api.js";

expect.extend(matchers);

afterEach(() => {
  cleanup();
});

const model = (overrides: Partial<EmbeddingModelWithStatus> = {}): EmbeddingModelWithStatus => ({
  id: "bge-small-en-v1.5",
  displayName: "BGE Small EN",
  description: "Fast local English embeddings for responsive memory search.",
  dimension: 384,
  sizeBytes: 133_000_000,
  language: "English",
  files: ["model.onnx"],
  downloaded: false,
  downloading: false,
  downloadProgress: 0,
  localPath: null,
  error: null,
  active: false,
  ...overrides,
});

const handlers = () => ({
  onDownload: vi.fn(),
  onSelect: vi.fn(),
  onDelete: vi.fn(),
  onReembed: vi.fn(),
});

describe("ModelCard", () => {
  it("shows the active downloaded model and disables destructive deletion", () => {
    const props = handlers();
    render(<ModelCard model={model({ downloaded: true, active: true, localPath: "/models/bge" })}
      {...props}
      reembedding={false}
      staleCount={0} />);

    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-embed All" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Delete BGE Small EN disabled while active" })).toBeDisabled();
  });

  it("uses a Signal Jade download action for downloadable models", async () => {
    const props = handlers();
    render(<ModelCard model={model()}
      {...props}
      reembedding={false}
      staleCount={0} />);

    const button = screen.getByRole("button", { name: "Download" });
    expect(button.className).toContain("bg-signal-500");
    expect(button.className).not.toContain("violet");

    await userEvent.click(button);

    expect(props.onDownload).toHaveBeenCalledWith("bge-small-en-v1.5");
  });

  it("uses compact Warm Void sizing and wrapped action labels", () => {
    render(<ModelCard model={model()}
      {...handlers()}
      reembedding={false}
      staleCount={0} />);

    const card = screen.getByText("BGE Small EN").closest("article");
    expect(card).toHaveClass("min-h-[17rem]");
    expect(card).toHaveClass("rounded-[1.25rem]");
    expect(card).toHaveClass("p-4");
    expect(card?.className).not.toContain("min-h-[21rem]");

    const button = screen.getByRole("button", { name: "Download" });
    expect(button).toHaveClass("min-h-9");
    expect(button).toHaveClass("rounded-lg");
    expect(button).toHaveClass("px-3");
    expect(button.querySelector("span")).toHaveClass("min-w-0", "text-center", "leading-4");
  });

  it("shows download progress while a model is downloading", () => {
    render(<ModelCard model={model({ downloading: true, downloadProgress: 0.42 })}
      {...handlers()}
      reembedding={false}
      staleCount={0} />);

    expect(screen.getAllByText("Downloading")).toHaveLength(2);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "BGE Small EN download progress" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("surfaces stale re-embed state with an Ember action", async () => {
    const props = handlers();
    render(<ModelCard model={model({ downloaded: true, active: true })}
      {...props}
      reembedding={false}
      staleCount={3} />);

    expect(screen.getByText("3 stale memories")).toBeInTheDocument();
    const button = screen.getByRole("button", { name: "Re-embed 3" });
    expect(button.className).toContain("ember");

    await userEvent.click(button);

    expect(props.onReembed).toHaveBeenCalledTimes(1);
  });

  it("allows deleting a downloaded inactive model through an accessible icon button", async () => {
    const props = handlers();
    render(<ModelCard model={model({ downloaded: true, localPath: "/models/bge" })}
      {...props}
      reembedding={false}
      staleCount={0} />);

    const deleteButton = screen.getByRole("button", { name: "Delete BGE Small EN" });
    expect(deleteButton).toBeEnabled();

    await userEvent.click(deleteButton);

    expect(props.onDelete).toHaveBeenCalledWith("bge-small-en-v1.5");
  });
});
