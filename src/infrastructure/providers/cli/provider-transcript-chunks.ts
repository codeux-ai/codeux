export interface ProviderTranscriptCursor {
  sourceId: string | null;
  offset: number;
}

export interface ProviderTranscriptChunk {
  sourceId: string;
  startOffset: number;
  nextOffset: number;
  totalBytes: number;
  contentBase64: string;
  reset: boolean;
}

export interface DecodedProviderTranscriptChunk {
  sourceId: string;
  cursor: ProviderTranscriptCursor;
  text: string;
  reset: boolean;
  complete: boolean;
}

/**
 * Decodes byte-range transcript chunks without corrupting a multi-byte UTF-8
 * code point split across reads. A source change/truncation resets both the
 * cursor and TextDecoder stream.
 */
export class ProviderTranscriptChunkDecoder {
  private decoder = new TextDecoder();
  private cursorValue: ProviderTranscriptCursor = { sourceId: null, offset: 0 };

  get cursor(): ProviderTranscriptCursor {
    return this.cursorValue;
  }

  consume(chunk: ProviderTranscriptChunk): DecodedProviderTranscriptChunk {
    const sourceChanged = this.cursorValue.sourceId !== null
      && this.cursorValue.sourceId !== chunk.sourceId;
    const reset = chunk.reset || sourceChanged || chunk.startOffset !== this.cursorValue.offset;
    if (reset) {
      this.decoder = new TextDecoder();
    }
    const complete = chunk.nextOffset >= chunk.totalBytes;
    const text = this.decoder.decode(Buffer.from(chunk.contentBase64, "base64"), {
      stream: !complete,
    });
    this.cursorValue = { sourceId: chunk.sourceId, offset: chunk.nextOffset };
    return {
      sourceId: chunk.sourceId,
      cursor: this.cursorValue,
      text,
      reset,
      complete,
    };
  }

  reset(): void {
    this.decoder = new TextDecoder();
    this.cursorValue = { sourceId: null, offset: 0 };
  }
}
