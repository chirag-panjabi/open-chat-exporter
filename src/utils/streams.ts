export async function* iterUint8(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* iterLines(
  stream: ReadableStream<Uint8Array>,
  options?: {
    encoding?: string;
    /**
     * If true, yields empty lines. Defaults to true.
     */
    yieldEmpty?: boolean;
  }
): AsyncGenerator<string> {
  const decoder = new TextDecoder(options?.encoding ?? 'utf-8');
  const yieldEmpty = options?.yieldEmpty ?? true;

  let buffer = '';

  for await (const chunk of iterUint8(stream)) {
    buffer += decoder.decode(chunk, { stream: true });

    while (true) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) break;

      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (yieldEmpty || line.length > 0) yield line;
    }
  }

  buffer += decoder.decode();
  if (buffer.endsWith('\r')) buffer = buffer.slice(0, -1);
  if (yieldEmpty || buffer.length > 0) yield buffer;
}
