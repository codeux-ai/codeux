/** @vitest-environment happy-dom */
import { h } from "preact";
import { cleanup, render, screen, waitFor, within } from "@testing-library/preact";
import userEvent from "@testing-library/user-event";
import * as matchers from "@testing-library/jest-dom/matchers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModelBrowser } from "../ModelBrowser.js";
import type { EmbeddingModelWithStatus, MemoryStats, ReembedProgress } from "../../../lib/memory-api.js";

const memoryApiMock = vi.hoisted(() => ({
  createCustomEmbeddingModel: vi.fn(),
  listEmbeddingModels: vi.fn(),
}));

vi.mock("../../../lib/memory-api.js", async () => {
  const actual = await vi.importActual<typeof import("../../../lib/memory-api.js")>("../../../lib/memory-api.js");
  return {
    ...actual,
    createCustomEmbeddingModel: memoryApiMock.createCustomEmbeddingModel,
    listEmbeddingModels: memoryApiMock.listEmbeddingModels,
  };
});

expect.extend(matchers);

const stats: MemoryStats = {
  sprint: 2,
  agent: 0,
  project: 4,
  activeModel: "bge-small-en-v1.5",
  staleEmbeddings: 3,
};

const reembed: ReembedProgress | null = null;

const model = (overrides: Partial<EmbeddingModelWithStatus> = {}): EmbeddingModelWithStatus => ({
  id: "bge-small-en-v1.5",
  displayName: "BGE Small EN",
  description: "Fast local English embeddings for responsive memory search.",
  dimension: 384,
  sizeBytes: 133_000_000,
  language: "English",
  files: ["model.onnx", "tokenizer.json"],
  source: "built_in",
  downloaded: false,
  downloading: false,
  downloadProgress: 0,
  localPath: null,
  error: null,
  active: false,
  license: { id: "mit-v1", name: "MIT", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
  ...overrides,
});

const renderBrowser = (overrides: Partial<Parameters<typeof ModelBrowser>[0]> = {}) => {
  const props = {
    models: [
      model({ downloaded: false }),
      model({
        id: "hf-acme-custom-12345678",
        displayName: "Acme Custom Embed",
        description: "Custom Hugging Face embedding model from acme/custom-embed.",
        source: "custom" as const,
        huggingFaceRepo: "acme/custom-embed",
        onnxModelFile: "onnx/model.onnx",
        downloaded: true,
        language: "French",
        license: { id: "apache-v1", name: "Apache-2.0", url: "https://example.test/apache-license", commercialUseAllowed: true, notice: "Operator-provided test model." },
      }),
    ],
    stats,
    reembed,
    onModelsChanged: vi.fn(),
    onDownload: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onReembed: vi.fn(),
    ...overrides,
  };

  render(<ModelBrowser {...props} />);
  return props;
};

beforeEach(() => {
  memoryApiMock.createCustomEmbeddingModel.mockReset();
  memoryApiMock.listEmbeddingModels.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ModelBrowser", () => {
  it("keeps the embedding catalog focused after speech models move to AI Models settings", () => {
    renderBrowser();

    const embeddingSection = screen.getByRole("region", { name: "Embedding Models" });
    expect(within(embeddingSection).getByText("BGE Small EN")).toBeInTheDocument();
    expect(within(embeddingSection).getByText("Acme Custom Embed")).toBeInTheDocument();
    expect(within(embeddingSection).getByRole("link", { name: /acme\/custom-embed/i })).toHaveAttribute("href", "https://huggingface.co/acme/custom-embed");

    expect(screen.queryByRole("region", { name: /Speech-Adjacent|Speech to text|Text to speech/i })).not.toBeInTheDocument();
  });

  it.each([
    ["Acme Custom", "Acme Custom Embed"],
    ["hf-acme-custom", "Acme Custom Embed"],
    ["custom hugging face", "Acme Custom Embed"],
    ["English", "BGE Small EN"],
    ["MIT", "BGE Small EN"],
  ])("searches catalog metadata for %s", async (query, expectedModel) => {
    const user = userEvent.setup();
    renderBrowser();

    await user.type(screen.getByLabelText("Search models"), query);

    expect(screen.getByText(expectedModel)).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Model catalog results" })).toHaveTextContent("Showing 1 of 2 models");
  });

  it("filters by install state, language, and source with a clear recovery action", async () => {
    const user = userEvent.setup();
    renderBrowser({
      models: [
        model({ downloaded: false, language: "English" }),
        model({
          id: "hf-acme-custom-12345678",
          displayName: "Acme Custom Embed",
          source: "custom",
          language: "French",
          downloaded: true,
        }),
      ],
    });

    await user.selectOptions(screen.getByLabelText("Install state"), "downloaded");
    expect(screen.queryByText("BGE Small EN")).not.toBeInTheDocument();
    expect(screen.getByText("Acme Custom Embed")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText("Language"), "French");
    await user.selectOptions(screen.getByLabelText("Source"), "built_in");
    expect(screen.getByText("No embedding models match this view.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show all models" }));
    expect(screen.getByText("BGE Small EN")).toBeInTheDocument();
    expect(screen.getByText("Acme Custom Embed")).toBeInTheDocument();
    expect(screen.getByLabelText("Install state")).toHaveValue("all");
    expect(screen.getByLabelText("Language")).toHaveValue("all");
    expect(screen.getByLabelText("Source")).toHaveValue("all");
  });

  it("keeps custom model controls unmounted until the accessible disclosure opens", async () => {
    const user = userEvent.setup();
    renderBrowser();

    const toggle = screen.getByRole("button", { name: "Add custom model" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole("button", { name: "Close custom form" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Display name")).toBeInTheDocument();
    expect(screen.getByText(/Code UX does not review or approve custom model terms/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close custom form" }));
    expect(screen.queryByLabelText("Display name")).not.toBeInTheDocument();
  });

  it("keeps embedding actions available from compact model rows", async () => {
    const user = userEvent.setup();
    const onConfirmationOpenChange = vi.fn();
    const props = renderBrowser({
      onConfirmationOpenChange,
      models: [
        model({ downloaded: false }),
        model({
          id: "bge-base-en-v1.5",
          displayName: "BGE Base EN",
          downloaded: true,
          localPath: "/models/bge-base",
        }),
      ],
    });

    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("MIT");
    expect(onConfirmationOpenChange).toHaveBeenLastCalledWith(true);
    await user.click(screen.getByRole("button", { name: "Accept & Download" }));
    expect(props.onDownload).toHaveBeenCalledWith("bge-small-en-v1.5");

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Download" })).toBeEnabled();
      expect(onConfirmationOpenChange).toHaveBeenLastCalledWith(false);
    });

    await user.click(screen.getByRole("button", { name: "Activate" }));
    expect(props.onSelect).toHaveBeenCalledWith("bge-base-en-v1.5");
  });

  it("validates custom Hugging Face model source before submission", async () => {
    const user = userEvent.setup();
    renderBrowser();

    await user.click(screen.getByRole("button", { name: "Add custom model" }));
    await user.type(screen.getByLabelText("Display name"), "Custom Embed");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Hugging Face repo or URL is required.");
    expect(memoryApiMock.createCustomEmbeddingModel).not.toHaveBeenCalled();
  });

  it("submits a custom Hugging Face model and refreshes the model list", async () => {
    const user = userEvent.setup();
    const created = {
      id: "hf-acme-custom-12345678",
      displayName: "Acme Custom Embed",
      description: "Custom Hugging Face embedding model from acme/custom-embed.",
      dimension: 384,
      sizeBytes: 120_000_000,
      language: "English",
      files: ["model.onnx", "tokenizer.json", "tokenizer_config.json"],
      source: "custom" as const,
      huggingFaceRepo: "acme/custom-embed",
      onnxModelFile: "onnx/model.onnx",
      validationStatus: "valid" as const,
      license: { id: "mit-v1", name: "MIT", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
    };
    const refreshed = [model(), model({ ...created, downloaded: false, downloading: false, downloadProgress: 0, localPath: null, error: null, active: false })];
    memoryApiMock.createCustomEmbeddingModel.mockResolvedValue(created);
    memoryApiMock.listEmbeddingModels.mockResolvedValue(refreshed);
    const props = renderBrowser({ models: [model()] });

    await user.click(screen.getByRole("button", { name: "Add custom model" }));
    await user.type(screen.getByLabelText("Display name"), "Acme Custom Embed");
    await user.type(screen.getByLabelText("Repo or URL"), "https://huggingface.co/acme/custom-embed/blob/main/onnx/model.onnx");
    await user.clear(screen.getByLabelText("Dimension"));
    await user.type(screen.getByLabelText("Dimension"), "384");
    await user.clear(screen.getByLabelText("Size bytes"));
    await user.type(screen.getByLabelText("Size bytes"), "120000000");
    await user.type(screen.getByLabelText("Upstream license"), "MIT");
    await user.type(screen.getByLabelText("License URL"), "https://example.test/license");
    await user.click(screen.getByLabelText("I verified the upstream terms myself and confirm that they permit commercial use."));
    await user.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => {
      expect(memoryApiMock.createCustomEmbeddingModel).toHaveBeenCalledWith({
        displayName: "Acme Custom Embed",
        huggingFaceRepoOrUrl: "https://huggingface.co/acme/custom-embed/blob/main/onnx/model.onnx",
        onnxModelFile: "onnx/model.onnx",
        tokenizerFiles: ["tokenizer.json", "tokenizer_config.json"],
        dimension: 384,
        approximateSizeBytes: 120_000_000,
        language: "English",
        licenseName: "MIT",
        licenseUrl: "https://example.test/license",
        commercialUseAllowed: true,
      });
    });
    expect(memoryApiMock.listEmbeddingModels).toHaveBeenCalledTimes(1);
    expect(props.onModelsChanged).toHaveBeenCalledWith(refreshed);
    expect(await screen.findByRole("status", { name: "Custom model status" })).toHaveTextContent("Acme Custom Embed added to embedding models.");
  });
});
