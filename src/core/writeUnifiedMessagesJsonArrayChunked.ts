import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { IChatInfo, IUnifiedMessage } from '../types';
import { buildChunkFilename, computeChunkKey, type ChunkBy } from './chunking';

async function writeWithBackpressure(stream: Writable, chunk: string): Promise<void> {
  const ok = stream.write(chunk);
  if (ok) return;
  await new Promise<void>((resolve, reject) => {
    stream.once('drain', resolve);
    stream.once('error', reject);
  });
}

async function endStream(stream: Writable): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('finish', resolve);
    stream.once('error', reject);
    stream.end();
  });
}

export async function writeUnifiedMessagesJsonArrayChunked(params: {
  chatInfo: IChatInfo;
  messages: AsyncIterable<IUnifiedMessage>;
  outputDir: string;
  chunkBy: ChunkBy;
  overwrite?: boolean;
}): Promise<void> {
  let currentChunkKey: string | null = null;
  let stream: Writable | null = null;
  let firstInChunk = true;

  const openChunk = async (chunkKey: string): Promise<void> => {
    const filename = buildChunkFilename({ chatInfo: params.chatInfo, chunkKey, ext: 'json' });
    const path = join(params.outputDir, filename);

    if (!params.overwrite && existsSync(path)) {
      throw new Error(`Refusing to overwrite existing chunk file: ${path}`);
    }

    stream = createWriteStream(path, { encoding: 'utf-8', flags: 'w' });
    firstInChunk = true;
    await writeWithBackpressure(stream, `[`);
  };

  const closeChunk = async (): Promise<void> => {
    if (!stream) return;
    const suffix = firstInChunk ? `\n` : `\n`;
    await writeWithBackpressure(stream, `${suffix}]\n`);
    await endStream(stream);
    stream = null;
  };

  try {
    for await (const message of params.messages) {
      const chunkKey = computeChunkKey(message.timestamp_utc, params.chunkBy);

      if (currentChunkKey !== chunkKey) {
        await closeChunk();
        currentChunkKey = chunkKey;
        await openChunk(chunkKey);
      }

      const messageJson = JSON.stringify(message);
      const prefix = firstInChunk ? '\n' : ',\n';
      firstInChunk = false;
      await writeWithBackpressure(stream!, `${prefix}${messageJson}`);
    }

    await closeChunk();
  } catch (err) {
    try {
      await closeChunk();
    } catch {
      // ignore
    }
    throw err;
  }
}
