import * as fs from "fs";
import * as path from "path";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { EMBEDDING_MODEL_CATALOG } from "./embedding-model-catalog.js";
import { EmbeddingTokenizer } from "./embedding-tokenizer.js";
import type { EmbeddingModelId, ExternalEmbeddingSettings, InAppEmbeddingModelId } from "../contracts/memory-types.js";
import type { InferenceSession } from "onnxruntime-node";

const MODELS_DIR = getHomeCodeUxPath("models");

interface TypedInferenceSession extends Omit<InferenceSession, "inputMetadata"> {
  inputMetadata: Record<string, {
    dims?: (number | string)[];
    type?: string;
  }>;
}

/**
 * Loads ONNX models and runs embedding inference on CPU.
 * Uses dynamic import for onnxruntime-node to avoid hard dependency at startup.
 */
export class EmbeddingService {
  private session: TypedInferenceSession | null = null;
  private tokenizer: EmbeddingTokenizer | null = null;
  private currentModelId: EmbeddingModelId | null = null;
  private externalSettings: ExternalEmbeddingSettings | null = null;
  private externalDimension: number | null = null;

  configureExternal(settings: ExternalEmbeddingSettings): void {
    const baseUrl = settings.baseUrl.trim();
    const model = settings.model.trim();
    const apiKey = settings.apiKey.trim();
    if (!baseUrl || !model || !apiKey) {
      this.externalSettings = null;
      this.externalDimension = null;
      return;
    }

    if (this.session) {
      this.session.release().catch(() => {});
    }
    this.session = null;
    this.tokenizer = null;
    this.externalSettings = {
      baseUrl,
      model,
      apiKey,
      dimensions: settings.dimensions && settings.dimensions > 0 ? settings.dimensions : null,
    };
    this.externalDimension = this.externalSettings.dimensions;
    this.currentModelId = model;
  }

  useInAppEmbeddings(): void {
    this.externalSettings = null;
    this.externalDimension = null;
  }

  async loadModel(modelId: InAppEmbeddingModelId): Promise<void> {
    if (this.currentModelId === modelId && this.session) {
      return;
    }

    this.useInAppEmbeddings();
    await this.unloadModel();

    const modelPath = this.getModelFilePath(modelId, "model.onnx");
    const tokenizerPath = this.getModelFilePath(modelId, "tokenizer.json");

    if (!fs.existsSync(modelPath) || !fs.existsSync(tokenizerPath)) {
      throw new Error(`Model files not found for ${modelId}. Download the model first.`);
    }

    const ort = await import("onnxruntime-node");
    this.session = (await ort.InferenceSession.create(modelPath, {
      executionProviders: ["cpu"],
      graphOptimizationLevel: "all",
    })) as unknown as TypedInferenceSession;

    this.tokenizer = new EmbeddingTokenizer(tokenizerPath);
    this.currentModelId = modelId;
  }

  async unloadModel(): Promise<void> {
    if (this.session) {
      try {
        await this.session.release();
      } catch { /* ignore release errors */ }
    }
    this.session = null;
    this.tokenizer = null;
    this.currentModelId = null;
  }

  isLoaded(): boolean {
    return (this.session !== null && this.currentModelId !== null) || this.externalSettings !== null;
  }

  getLoadedModelId(): EmbeddingModelId | null {
    return this.currentModelId;
  }

  getDimension(): number | null {
    if (!this.currentModelId) return null;
    if (this.externalSettings) {
      return this.externalDimension;
    }
    return EMBEDDING_MODEL_CATALOG[this.currentModelId as InAppEmbeddingModelId]?.dimension ?? null;
  }

  async embed(text: string): Promise<Float32Array> {
    if (this.externalSettings) {
      return await this.embedExternal(text);
    }

    if (!this.session || !this.tokenizer || !this.currentModelId) {
      throw new Error("No model loaded. Call loadModel() first.");
    }

    const { inputIds, attentionMask, tokenTypeIds } = this.tokenizer.encode(text);
    const ort = await import("onnxruntime-node");

    const seqLength = inputIds.length;
    const feeds: Record<string, any> = {
      input_ids: new ort.Tensor("int64", inputIds, [1, seqLength]),
      attention_mask: new ort.Tensor("int64", attentionMask, [1, seqLength]),
    };

    // Provide additional inputs based on what the model expects
    const inputNames = this.session.inputNames as string[];
    if (inputNames.includes("token_type_ids")) {
      feeds.token_type_ids = new ort.Tensor("int64", tokenTypeIds, [1, seqLength]);
    }
    if (inputNames.includes("position_ids")) {
      const positionIds = new BigInt64Array(seqLength);
      for (let i = 0; i < seqLength; i++) positionIds[i] = BigInt(i);
      feeds.position_ids = new ort.Tensor("int64", positionIds, [1, seqLength]);
    }

    // Decoder models may require empty past_key_values for initial pass.
    // Shape: [batch=1, num_kv_heads, past_seq_len=0, head_dim] — inferred from session metadata.
    for (const name of inputNames) {
      if (!name.startsWith("past_key_values") || feeds[name]) continue;
      const meta = this.session.inputMetadata?.[name];
      const dims = meta?.dims;
      // Replace dynamic axes with 0 (empty past), fix batch=1
      const shape = dims?.map((d: number | string) => typeof d === "number" ? d : 0) ?? [1, 1, 0, 1];
      if (shape.length > 0) shape[0] = 1;
      const size = shape.reduce((a: number, b: number) => a * b, 1);
      const dtype = meta?.type === "tensor(float16)" ? "float16" : "float32";
      const data = dtype === "float16" ? new Uint16Array(size) : new Float32Array(size);
      feeds[name] = new ort.Tensor(dtype, data, shape);
    }

    const results = await this.session.run(feeds);

    // Extract the embedding — models may output different tensor names
    const outputKey = this.session.outputNames[0] as string;
    const output = results[outputKey];
    const data = output.data as Float32Array;

    // Mean pooling over sequence dimension
    const dimension = EMBEDDING_MODEL_CATALOG[this.currentModelId as InAppEmbeddingModelId].dimension;
    const embedding = this.meanPool(data, seqLength, dimension, attentionMask);

    // L2 normalize
    return this.l2Normalize(embedding);
  }

  async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const results: Float32Array[] = [];
    for (const text of texts) {
      results.push(await this.embed(text));
    }
    return results;
  }

  isModelDownloaded(modelId: InAppEmbeddingModelId): boolean {
    const modelPath = this.getModelFilePath(modelId, "model.onnx");
    const tokenizerPath = this.getModelFilePath(modelId, "tokenizer.json");
    return fs.existsSync(modelPath) && fs.existsSync(tokenizerPath);
  }

  getModelPath(modelId: InAppEmbeddingModelId): string {
    return path.join(MODELS_DIR, modelId);
  }

  getModelFilePath(modelId: InAppEmbeddingModelId, fileName: string): string {
    return path.join(MODELS_DIR, modelId, fileName);
  }

  deleteModelFiles(modelId: InAppEmbeddingModelId): void {
    const modelDir = this.getModelPath(modelId);
    if (fs.existsSync(modelDir)) {
      fs.rmSync(modelDir, { recursive: true, force: true });
    }
  }

  private meanPool(
    data: Float32Array,
    seqLength: number,
    dimension: number,
    attentionMask: BigInt64Array,
  ): Float32Array {
    const pooled = new Float32Array(dimension);
    let validTokens = 0;

    for (let t = 0; t < seqLength; t++) {
      if (attentionMask[t] === 0n) continue;
      validTokens++;
      for (let d = 0; d < dimension; d++) {
        pooled[d] += data[t * dimension + d];
      }
    }

    if (validTokens > 0) {
      for (let d = 0; d < dimension; d++) {
        pooled[d] /= validTokens;
      }
    }

    return pooled;
  }

  private l2Normalize(vec: Float32Array): Float32Array {
    let norm = 0;
    for (let i = 0; i < vec.length; i++) {
      norm += vec[i] * vec[i];
    }
    norm = Math.sqrt(norm);

    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }

    return vec;
  }

  private async embedExternal(text: string): Promise<Float32Array> {
    if (!this.externalSettings) {
      throw new Error("External embedding provider is not configured.");
    }

    const body: Record<string, unknown> = {
      model: this.externalSettings.model,
      input: text,
    };
    if (this.externalSettings.dimensions) {
      body.dimensions = this.externalSettings.dimensions;
    }

    const response = await fetch(this.externalSettings.baseUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.externalSettings.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`External embedding request failed (${response.status}): ${detail.slice(0, 500)}`);
    }

    const payload = await response.json() as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = payload.data?.[0]?.embedding;
    if (!Array.isArray(vector) || vector.length === 0) {
      throw new Error("External embedding response did not include data[0].embedding.");
    }

    const embedding = new Float32Array(vector);
    this.externalDimension = embedding.length;
    this.currentModelId = this.externalSettings.model;
    return this.l2Normalize(embedding);
  }
}
