/**
 * Shared helpers for working with embedding vectors stored as SQLite BLOBs.
 * Used by both the memory system and the knowledge-base system.
 */

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function bufferToFloat32(buf: Buffer | Uint8Array, dimension: number): Float32Array {
  // node:sqlite returns BLOBs as Uint8Array, not Buffer
  const bytes = buf instanceof Buffer ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  const arr = new Float32Array(dimension);
  for (let i = 0; i < dimension; i++) {
    arr[i] = bytes.readFloatLE(i * 4);
  }
  return arr;
}

export function float32ToBuffer(arr: Float32Array): Buffer {
  const buf = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buf.writeFloatLE(arr[i], i * 4);
  }
  return buf;
}

/**
 * Rough token estimate (~4 chars/token) used for chunk sizing and manifest budgeting.
 * The embedding model truncates at its own max sequence length, so this only needs to be
 * close enough to keep chunks within a sensible range.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
