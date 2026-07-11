/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/preact";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../dashboard/src/lib/settings.js";
import { AIModelCatalogPanel } from "../../../dashboard/src/v2/components/settings/panels/AIModelCatalogPanel.js";

expect.extend(matchers);

const speechApi = vi.hoisted(() => ({
  listSpeechModels: vi.fn(),
  downloadSpeechModel: vi.fn(),
  deleteSpeechModel: vi.fn(),
}));
const memoryApi = vi.hoisted(() => ({
  listEmbeddingModels: vi.fn(),
  getMemoryStats: vi.fn(),
  getReembedProgress: vi.fn(),
  deleteEmbeddingModel: vi.fn(),
  downloadEmbeddingModel: vi.fn(),
  selectEmbeddingModel: vi.fn(),
  startReembed: vi.fn(),
}));

vi.mock("../../../dashboard/src/v2/lib/speech-api.js", () => speechApi);
vi.mock("../../../dashboard/src/v2/lib/memory-api.js", () => memoryApi);
vi.mock("../../../dashboard/src/v2/components/memory/ModelBrowser.js", () => ({
  ModelBrowser: () => <div data-testid="embedding-model-browser">Embedding catalog</div>,
}));

describe("AIModelCatalogPanel", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    memoryApi.listEmbeddingModels.mockResolvedValue([]);
    memoryApi.getMemoryStats.mockResolvedValue({ sprint: 0, agent: 0, project: 0, activeModel: null, staleEmbeddings: 0 });
    speechApi.listSpeechModels.mockResolvedValue([{
      id: "kokoro-82m-v1.0-q8",
      kind: "synthesis",
      adapter: "kokoro",
      displayName: "Kokoro 82M v1.0 Q8",
      description: "Natural local speech.",
      repository: "onnx-community/Kokoro-82M-v1.0-ONNX",
      sourceUrl: "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX",
      files: [],
      sizeBytes: 95_000_000,
      language: "English",
      sampleRateHz: 24_000,
      voices: [{ id: "af_heart", label: "Heart", language: "English (US)" }],
      defaultVoice: "af_heart",
      downloaded: true,
      downloading: false,
      downloadProgress: 0,
      error: null,
    }]);
  });

  it("activates an installed TTS model and enables 3D Chat voice in the current draft", async () => {
    const updateEditableSettings = vi.fn();
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings,
    } as any} />);

    expect(screen.getByRole("button", { name: "Speech to text provider" })).toHaveTextContent("Local");
    expect(screen.getByRole("button", { name: "Text to speech provider" })).toHaveTextContent("Local");
    expect(screen.queryByLabelText("Speech to text API endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Text to speech API endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto \(local, then API\)/i)).not.toBeInTheDocument();

    const activate = await screen.findByRole("button", { name: "Use for 3D Chat" });
    await userEvent.click(activate);

    expect(updateEditableSettings).toHaveBeenCalledTimes(1);
    const updater = updateEditableSettings.mock.calls[0]?.[0] as (settings: typeof DEFAULT_DASHBOARD_SETTINGS) => typeof DEFAULT_DASHBOARD_SETTINGS;
    const updated = updater({
      ...DEFAULT_DASHBOARD_SETTINGS,
      speech: {
        ...DEFAULT_DASHBOARD_SETTINGS.speech,
        synthesis: { ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis, enabled: false },
      },
    });
    expect(updated.speech.synthesis).toEqual(expect.objectContaining({
      enabled: true,
      providerMode: "local_onnx",
      localModelId: "kokoro-82m-v1.0-q8",
      voice: "af_heart",
    }));
    await waitFor(() => expect(screen.getByTestId("embedding-model-browser")).not.toBeNull());
  });

  it("shows API fields only for speech directions configured to use the API", async () => {
    render(<AIModelCatalogPanel state={{
      editableSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS,
        speech: {
          ...DEFAULT_DASHBOARD_SETTINGS.speech,
          providerMode: "external_api",
          synthesis: {
            ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis,
            providerMode: "external_api",
          },
        },
      },
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />);

    expect(await screen.findByLabelText("Speech to text API endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech to text API model")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech to text API key")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API model")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API voice")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API format")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Local text to speech voice")).not.toBeInTheDocument();
  });
});
