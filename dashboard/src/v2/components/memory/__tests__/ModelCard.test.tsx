/** @vitest-environment jsdom */
import { h } from "preact";
import { render, fireEvent } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ModelCard } from "../ModelCard.js";
import type { EmbeddingModelWithStatus } from "../../../lib/memory-api.js";

expect.extend(matchers);

const model = (overrides: Partial<EmbeddingModelWithStatus> = {}): EmbeddingModelWithStatus => ({
  id: "model-a",
  displayName: "Local Embedder",
  description: "Compact embedding model for local semantic memory.",
  dimension: 384,
  sizeBytes: 42_000_000,
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

describe("ModelCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  test("renders available model metadata and download action", async () => {
    const onDownload = vi.fn();
    const { getByText, getByRole } = render(
      <ModelCard
        model={model()}
        onDownload={onDownload}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onReembed={vi.fn()}
        reembedding={false}
        staleCount={0}
      />
    );

    expect(getByText("Available")).toBeInTheDocument();
    expect(getByText("384d")).toBeInTheDocument();
    expect(getByText("42 MB")).toBeInTheDocument();

    await fireEvent.click(getByRole("button", { name: "Download" }));
    expect(onDownload).toHaveBeenCalledWith("model-a");
  });

  test("shows download progress state", () => {
    const { getByText } = render(
      <ModelCard
        model={model({ downloading: true, downloadProgress: 0.37 })}
        onDownload={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onReembed={vi.fn()}
        reembedding={false}
        staleCount={0}
      />
    );

    expect(getByText("Downloading")).toBeInTheDocument();
    expect(getByText("Downloading model files 37%")).toBeInTheDocument();
  });

  test("renders active model re-embedding state and disables delete", () => {
    const { getByText, getByRole } = render(
      <ModelCard
        model={model({ downloaded: true, active: true })}
        onDownload={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onReembed={vi.fn()}
        reembedding={true}
        staleCount={4}
      />
    );

    expect(getByText("Active")).toBeInTheDocument();
    expect(getByText("Re-embedding…")).toBeInTheDocument();
    expect(getByRole("button", { name: "Delete Local Embedder" })).toBeDisabled();
  });

  test("shows model error as status text", () => {
    const { getByRole } = render(
      <ModelCard
        model={model({ downloaded: true, error: "Download failed" })}
        onDownload={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onReembed={vi.fn()}
        reembedding={false}
        staleCount={0}
      />
    );

    expect(getByRole("status")).toHaveTextContent("Download failed");
  });
});
