import type { IUnifiedMessage, Platform } from '../types';

export interface AdapterInput {
  inputPath: string;
  file: ReturnType<typeof Bun.file>;
  stream: ReadableStream<Uint8Array>;
}

export abstract class BaseAdapter {
  abstract readonly platform: Platform;

  /**
   * Streaming parser.
   *
   * MUST NOT load the full export into memory.
   * Implementations should yield one message at a time.
   */
  abstract parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage>;
}
