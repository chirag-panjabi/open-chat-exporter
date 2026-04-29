import { createWriteStream, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Writable } from 'node:stream';
import type { IChatInfo, IExportMeta, IUnifiedMessage } from '../types';
import { buildChunkFilename, computeChunkKey, type ChunkBy } from './chunking';
import { formatMessageContentForText, formatMessageDisplayName } from './scrubMessages';

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

export async function writeUnifiedExportMarkdownChunked(params: {
    exportMeta: IExportMeta;
    chatInfo: IChatInfo;
    messages: AsyncIterable<IUnifiedMessage>;
    outputDir: string;
    chunkBy: ChunkBy;
    overwrite?: boolean;
}): Promise<void> {
    let currentChunkKey: string | null = null;
    let stream: Writable | null = null;

    const openChunk = async (chunkKey: string): Promise<void> => {
        const filename = buildChunkFilename({ chatInfo: params.chatInfo, chunkKey, ext: 'md' });
        const path = join(params.outputDir, filename);

        if (!params.overwrite && existsSync(path)) {
            throw new Error(`Refusing to overwrite existing chunk file: ${path}`);
        }

        stream = createWriteStream(path, { encoding: 'utf-8', flags: 'w' });

        await writeWithBackpressure(stream, `# ${params.chatInfo.chat_name}\n`);
        await writeWithBackpressure(stream, `\n- Platform: ${String(params.chatInfo.platform)}\n`);
        await writeWithBackpressure(stream, `- Exported at (UTC): ${params.exportMeta.exported_at}\n\n`);

        // Optional: include the chunk key in-file later if desired; for now the filename carries it.
        void chunkKey;
    };

    const closeChunk = async (): Promise<void> => {
        if (!stream) return;
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

            const name = formatMessageDisplayName(message);
            const content = formatMessageContentForText(message);
            const ts = message.timestamp_utc;

            await writeWithBackpressure(stream!, `- **${name} (${ts})**: ${content}\n`);
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
