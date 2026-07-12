/** @vitest-environment happy-dom */
/** @jsx h */
import { h } from "preact";
// @ts-ignore
globalThis.React = { createElement: h };
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
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
  source: "built_in",
  license: { id: "mit-v1", name: "MIT", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
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
    expect(card).toHaveClass("min-h-[8.75rem]");
    expect(card).toHaveClass("rounded-lg");
    expect(card).toHaveClass("p-3");
    expect(card?.className).not.toContain("min-h-[17rem]");

    const button = screen.getByRole("button", { name: "Download" });
    expect(button).toHaveClass("min-h-8");
    expect(button).toHaveClass("rounded-md");
    expect(button).toHaveClass("px-2.5");
    expect(button.querySelector("span")).toHaveClass("min-w-0", "text-center", "leading-4");
  });

  it("shows download progress while a model is downloading", () => {
    render(<ModelCard model={model({ downloading: true, downloadProgress: 0.42 })}
      {...handlers()}
      reembedding={false}
      staleCount={0} />);

    expect(screen.getAllByText("Downloading")).toHaveLength(1);
    expect(screen.getByText("42%")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "BGE Small EN download progress" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.queryByRole("button", { name: "Download" })).not.toBeInTheDocument();
  });

  it("suppresses duplicate download activation while the first action is pending", async () => {
    let resolveDownload: () => void = () => {};
    const props = {
      ...handlers(),
      onDownload: vi.fn(() => new Promise<void>((resolve) => {
        resolveDownload = resolve;
      })),
    };
    render(<ModelCard model={model()}
      {...props}
      reembedding={false}
      staleCount={0} />);

    const button = screen.getByRole("button", { name: "Download" });

    await userEvent.click(button);
    await userEvent.click(button);

    expect(props.onDownload).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Starting" })).toHaveAttribute("aria-busy", "true");

    resolveDownload();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
    });
  });

  it("surfaces stale re-embed state with an Ember action", async () => {
    const props = handlers();
    render(<ModelCard model={model({ downloaded: true, active: true })}
      {...props}
      reembedding={false}
      staleCount={3} />);

    expect(screen.getByText("3 stale memories need re-embedding.")).toBeInTheDocument();
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

  it("renders a safe Hugging Face source link for custom models", () => {
    render(<ModelCard model={model({
      id: "hf-custom",
      displayName: "Custom MiniLM",
      source: "custom",
      huggingFaceRepo: "acme/custom-minilm",
      onnxModelFile: "onnx/model.onnx",
    })}
      {...handlers()}
      reembedding={false}
      staleCount={0} />);

    const link = screen.getByRole("link", { name: /acme\/custom-minilm/i });
    expect(link).toHaveAttribute("href", "https://huggingface.co/acme/custom-minilm");
    expect(link).toHaveAttribute("rel", "noreferrer");
    expect(screen.getByRole("link", { name: "MIT · operator asserted" })).toBeInTheDocument();
    expect(screen.queryByText("MIT · commercial use")).not.toBeInTheDocument();
  });
});
