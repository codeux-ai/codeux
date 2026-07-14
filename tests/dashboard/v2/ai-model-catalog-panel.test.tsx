/** @vitest-environment jsdom */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/preact";
import { renderWithDashboardI18n as render } from "../helpers/dashboard-i18n-test-utils.js";
import * as matchers from "@testing-library/jest-dom/matchers";
import userEvent from "@testing-library/user-event";
import { useState } from "preact/hooks";
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
      id: "onnx-community/whisper-base.en",
      kind: "transcription",
      adapter: "whisper",
      displayName: "Whisper Base English ONNX",
      description: "Higher-accuracy local transcription.",
      repository: "onnx-community/whisper-base.en",
      sourceUrl: "https://huggingface.co/onnx-community/whisper-base.en",
      files: [],
      sizeBytes: 80_000_000,
      language: "English",
      sampleRateHz: 16_000,
      voices: [],
      defaultVoice: null,
      license: { id: "mit-v1", name: "MIT", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
      downloaded: true,
      downloading: false,
      downloadProgress: 0,
      error: null,
    }, {
      id: "onnx-community/whisper-tiny.en",
      kind: "transcription",
      adapter: "whisper",
      displayName: "Whisper Tiny English ONNX",
      description: "Downloadable Whisper bundle.",
      repository: "onnx-community/whisper-tiny.en",
      sourceUrl: "https://huggingface.co/onnx-community/whisper-tiny.en",
      files: [],
      sizeBytes: 180_000_000,
      language: "English",
      sampleRateHz: 16_000,
      voices: [],
      defaultVoice: null,
      license: { id: "mit-v1", name: "MIT", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
      downloaded: true,
      downloading: false,
      downloadProgress: 0,
      error: null,
    }, {
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
      languages: [{ code: "en-US", label: "English (US)" }],
      supportsAutomaticLanguageDetection: false,
      sampleRateHz: 24_000,
      voices: [{ id: "af_heart", label: "Heart", language: "English (US)", languageCode: "en-US" }],
      defaultVoice: "af_heart",
      recommendedForLanguages: ["en-US"],
      license: { id: "apache-v1", name: "Apache-2.0", url: "https://example.test/license", commercialUseAllowed: true, notice: "Test model." },
      downloaded: true,
      downloading: false,
      downloadProgress: 0,
      error: null,
    }, {
      id: "piper-de-de-mls-medium",
      kind: "synthesis",
      adapter: "piper",
      displayName: "Piper German MLS Medium",
      description: "Natural local German speech.",
      repository: "rhasspy/piper-voices",
      sourceUrl: "https://example.test/german",
      files: [],
      sizeBytes: 77_000_000,
      language: "German",
      languages: [{ code: "de-DE", label: "German (Germany)" }],
      supportsAutomaticLanguageDetection: false,
      sampleRateHz: 22_050,
      voices: [{ id: "mls-2422", label: "MLS 2422", language: "German (Germany)", languageCode: "de-DE" }],
      defaultVoice: "mls-2422",
      recommendedForLanguages: ["de-DE"],
      license: { id: "german-license", name: "MIT + CC-BY-4.0", url: "https://example.test/german-license", commercialUseAllowed: true, notice: "German test model." },
      downloaded: false,
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

    expect(screen.getByText("Local AI Runtime")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Speech to text provider" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    expect(screen.getByRole("button", { name: "Speech to text provider" })).toHaveTextContent("Local");
    expect(screen.getByRole("button", { name: "Text to speech provider" })).toHaveTextContent("Local");
    expect(screen.queryByLabelText("Speech to text API endpoint")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Text to speech API endpoint")).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto \(local, then API\)/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to overview" }));
    const manageModels = screen.getByRole("button", { name: "Manage local models" });
    await userEvent.click(manageModels);
    const activate = await screen.findByRole("button", { name: "Use for 3D Chat" });
    expect(screen.getAllByRole("button", { name: "Use for input" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Local runtime pending" })).not.toBeInTheDocument();
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

    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    expect(await screen.findByLabelText("Speech to text API endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech to text language")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech to text API model")).toBeInTheDocument();
    expect(screen.getByLabelText("Speech to text API key")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API endpoint")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API model")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API voice")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API format")).toBeInTheDocument();
    expect(screen.getByLabelText("Text to speech API key")).toBeInTheDocument();
    expect(screen.queryByLabelText("Local text to speech voice")).not.toBeInTheDocument();
  });

  it("requires the displayed speech-model license acceptance before download", async () => {
    const catalog = await speechApi.listSpeechModels();
    speechApi.listSpeechModels.mockResolvedValue(catalog.map((model: any) => model.id === "kokoro-82m-v1.0-q8"
      ? { ...model, downloaded: false }
      : model));
    speechApi.downloadSpeechModel.mockResolvedValue(undefined);

    render(<AIModelCatalogPanel state={{
      editableSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS,
        speech: {
          ...DEFAULT_DASHBOARD_SETTINGS.speech,
          synthesis: { ...DEFAULT_DASHBOARD_SETTINGS.speech.synthesis, enabled: true },
        },
      },
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />);

    const manageModels = screen.getByRole("button", { name: "Manage local models" });
    await userEvent.click(manageModels);
    expect(await screen.findByText("Repair required")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Download Kokoro 82M v1.0 Q8" }));
    expect(screen.getByRole("dialog", { name: "Download Kokoro 82M v1.0 Q8" })).toHaveTextContent("Apache-2.0");
    expect(screen.getByRole("region", { name: "Model catalog" })).toBeInTheDocument();
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Accept & Download" }));
    await waitFor(() => expect(speechApi.downloadSpeechModel).toHaveBeenCalledWith("kokoro-82m-v1.0-q8", "apache-v1"));
    await waitFor(() => expect(screen.getByRole("region", { name: "Model catalog" })).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Back to AI Models overview" }));
    await waitFor(() => expect(manageModels).toHaveFocus());
  });

  it("searches speech models inside the focused catalog without bloating the settings page", async () => {
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />);

    expect(screen.queryByText("Whisper Tiny English ONNX")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Manage local models" }));
    await userEvent.click(screen.getByRole("button", { name: "Speech input" }));
    const search = screen.getByRole("searchbox", { name: "Search speech models" });
    fireEvent.input(search, { target: { value: "tiny" } });

    const catalog = screen.getByRole("region", { name: "Model catalog" });
    expect(within(catalog).getByText("Whisper Tiny English ONNX")).toBeInTheDocument();
    await waitFor(() => expect(within(catalog).queryByText("Whisper Base English ONNX")).not.toBeInTheDocument());
    expect(within(catalog).queryByRole("region", { name: "Text to speech models" })).not.toBeInTheDocument();
    await userEvent.click(within(catalog).getByRole("button", { name: "All" }));
    expect(within(catalog).getByText("Whisper Base English ONNX")).toBeInTheDocument();
    expect(within(catalog).getByText("Kokoro 82M v1.0 Q8")).toBeInTheDocument();
    expect(within(catalog).queryByRole("searchbox", { name: "Search speech models" })).not.toBeInTheDocument();
  });

  it("stores an external transcription language hint in the settings draft", async () => {
    const updateEditableSettings = vi.fn();
    render(<AIModelCatalogPanel state={{
      editableSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS,
        speech: { ...DEFAULT_DASHBOARD_SETTINGS.speech, providerMode: "external_api" },
      },
      selectedProject: null,
      updateEditableSettings,
    } as any} />);

    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    await userEvent.click(screen.getByRole("button", { name: "Speech to text language" }));
    await userEvent.click(screen.getByRole("option", { name: "German" }));

    const updater = updateEditableSettings.mock.calls.at(-1)?.[0] as (settings: typeof DEFAULT_DASHBOARD_SETTINGS) => typeof DEFAULT_DASHBOARD_SETTINGS;
    expect(updater(DEFAULT_DASHBOARD_SETTINGS).speech.externalTranscription.language).toBe("de");
  });

  it("stores a local Whisper language without changing the external API hint", async () => {
    const models = await speechApi.listSpeechModels();
    speechApi.listSpeechModels.mockResolvedValue([...models, {
      ...models[0],
      id: "onnx-community/whisper-base",
      displayName: "Whisper Base Multilingual ONNX",
      repository: "onnx-community/whisper-base",
      sourceUrl: "https://huggingface.co/onnx-community/whisper-base",
      language: "Multilingual",
      languages: [{ code: "en", label: "English" }, { code: "de", label: "German" }],
      supportsAutomaticLanguageDetection: true,
    }]);
    const updateEditableSettings = vi.fn();
    render(<AIModelCatalogPanel state={{
      editableSettings: {
        ...DEFAULT_DASHBOARD_SETTINGS,
        speech: {
          ...DEFAULT_DASHBOARD_SETTINGS.speech,
          localModelId: "onnx-community/whisper-base",
          localLanguage: null,
          externalTranscription: {
            ...DEFAULT_DASHBOARD_SETTINGS.speech.externalTranscription,
            language: "es",
          },
        },
      },
      selectedProject: null,
      updateEditableSettings,
    } as any} />);

    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    await userEvent.click(screen.getByRole("button", { name: "Speech to text language" }));
    await userEvent.click(screen.getByRole("option", { name: "German" }));

    const updater = updateEditableSettings.mock.calls.at(-1)?.[0] as (settings: typeof DEFAULT_DASHBOARD_SETTINGS) => typeof DEFAULT_DASHBOARD_SETTINGS;
    const updated = updater({
      ...DEFAULT_DASHBOARD_SETTINGS,
      speech: {
        ...DEFAULT_DASHBOARD_SETTINGS.speech,
        localModelId: "onnx-community/whisper-base",
        localLanguage: null,
        externalTranscription: {
          ...DEFAULT_DASHBOARD_SETTINGS.speech.externalTranscription,
          language: "es",
        },
      },
    });
    expect(updated.speech.localLanguage).toBe("de");
    expect(updated.speech.externalTranscription.language).toBe("es");
  });

  it("starts multilingual Whisper in automatic detection when replacing an English-only model", async () => {
    const models = await speechApi.listSpeechModels();
    speechApi.listSpeechModels.mockResolvedValue([...models, {
      ...models[0],
      id: "onnx-community/whisper-base",
      displayName: "Whisper Base Multilingual ONNX",
      repository: "onnx-community/whisper-base",
      sourceUrl: "https://huggingface.co/onnx-community/whisper-base",
      language: "Multilingual",
      languages: [{ code: "en", label: "English" }, { code: "de", label: "German" }],
      supportsAutomaticLanguageDetection: true,
    }]);
    const updateEditableSettings = vi.fn();
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings,
    } as any} />);

    await userEvent.click(screen.getByRole("button", { name: "Manage local models" }));
    const card = (await screen.findByText("Whisper Base Multilingual ONNX")).closest("article");
    expect(card).not.toBeNull();
    await userEvent.click(within(card as HTMLElement).getByRole("button", { name: "Use for input" }));

    const updater = updateEditableSettings.mock.calls.at(-1)?.[0] as (settings: typeof DEFAULT_DASHBOARD_SETTINGS) => typeof DEFAULT_DASHBOARD_SETTINGS;
    const updated = updater(DEFAULT_DASHBOARD_SETTINGS);
    expect(updated.speech.localModelId).toBe("onnx-community/whisper-base");
    expect(updated.speech.localLanguage).toBeNull();
  });

  it("keeps the speech workspace open when Escape dismisses its provider listbox", async () => {
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />);

    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    await userEvent.click(screen.getByRole("button", { name: "Speech to text provider" }));
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(screen.getByRole("region", { name: "Speech runtime" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
  });

  it("preselects the preferred language model but downloads only after explicit license acceptance", async () => {
    speechApi.downloadSpeechModel.mockResolvedValue(undefined);
    const Harness = () => {
      const [settings, setSettings] = useState(DEFAULT_DASHBOARD_SETTINGS);
      return <AIModelCatalogPanel state={{
        editableSettings: settings,
        selectedProject: null,
        updateEditableSettings: (recipe: (current: typeof settings) => typeof settings) => setSettings((current) => recipe(current)),
      } as any} />;
    };
    render(<Harness />);

    await userEvent.click(screen.getByRole("button", { name: "Configure speech" }));
    await userEvent.click(screen.getByRole("button", { name: "Text to speech language" }));
    await userEvent.click(screen.getByRole("option", { name: "German (Germany)" }));

    expect(screen.getAllByText("Piper German MLS Medium")).toHaveLength(2);
    expect(screen.getAllByText("Download required").length).toBeGreaterThan(0);
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText("Output off")).toBeInTheDocument();
    expect(screen.getByText(/Nothing downloads until you approve/i)).toBeInTheDocument();
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();

    const downloadName = "Download recommended Piper German MLS Medium for German (Germany)";
    await userEvent.click(screen.getByRole("button", { name: downloadName }));
    expect(screen.getByRole("region", { name: "Speech runtime" })).toBeInTheDocument();
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: downloadName }));
    await userEvent.click(screen.getByRole("button", { name: "Accept & Download" }));
    await waitFor(() => expect(speechApi.downloadSpeechModel).toHaveBeenCalledWith("piper-de-de-mls-medium", "german-license"));
  });
  it("filters the German catalog while keeping API language metadata and download states distinct", async () => {
    const Harness = () => {
      const [settings, setSettings] = useState(DEFAULT_DASHBOARD_SETTINGS);
      return <AIModelCatalogPanel state={{
        editableSettings: settings,
        selectedProject: null,
        updateEditableSettings: (recipe: (current: typeof settings) => typeof settings) => setSettings((current) => recipe(current)),
      } as any} />;
    };
    render(<Harness />, "de");

    await userEvent.click(screen.getByRole("button", { name: "Sprache konfigurieren" }));
    await userEvent.click(screen.getByRole("button", { name: "Sprache für Text zu Sprache" }));
    await userEvent.click(screen.getByRole("option", { name: "German (Germany)" }));

    expect(screen.getByText("Ausgewählt")).toBeInTheDocument();
    expect(screen.getAllByText("Download erforderlich").length).toBeGreaterThan(0);
    expect(screen.getByText("Ausgabe aus")).toBeInTheDocument();
    expect(screen.getAllByText("German (Germany)").length).toBeGreaterThan(0);
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Kompatible Modelle vergleichen" }));
    const catalog = screen.getByRole("region", { name: "Modellkatalog" });
    expect(within(catalog).getByRole("combobox", { name: "Sprachmodelle nach Sprache filtern" })).toHaveValue("de-DE");
    expect(within(catalog).getByText("Piper German MLS Medium")).toBeInTheDocument();
    expect(within(catalog).queryByText("Kokoro 82M v1.0 Q8")).not.toBeInTheDocument();
    expect(within(catalog).getByRole("option", { name: "German (Germany)" })).toHaveValue("de-DE");
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();
  });

  it("preserves provider diagnostics when the catalog request fails", async () => {
    speechApi.listSpeechModels.mockRejectedValueOnce(new Error("Provider network unavailable"));
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />, "de");

    expect(await screen.findByRole("alert")).toHaveTextContent("Provider network unavailable");
  });

  it("blocks downloads whose API license metadata fails validation", async () => {
    const models = await speechApi.listSpeechModels();
    speechApi.listSpeechModels.mockResolvedValue(models.map((model: any) => model.id === "piper-de-de-mls-medium"
      ? { ...model, license: { ...model.license, commercialUseAllowed: false } }
      : model));
    render(<AIModelCatalogPanel state={{
      editableSettings: DEFAULT_DASHBOARD_SETTINGS,
      selectedProject: null,
      updateEditableSettings: vi.fn(),
    } as any} />);

    await userEvent.click(screen.getByRole("button", { name: "Manage local models" }));
    const card = (await screen.findByText("Piper German MLS Medium")).closest("article");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByRole("button", { name: "Download Piper German MLS Medium" })).toBeDisabled();
    expect(speechApi.downloadSpeechModel).not.toHaveBeenCalled();
  });

});
