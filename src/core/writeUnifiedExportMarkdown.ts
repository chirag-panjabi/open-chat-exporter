import { createWriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
import type { IChatInfo, IExportMeta, IUnifiedMessage } from '../types';
import { formatMessageContentForText, formatMessageDisplayName } from './scrubMessages';

async function writeWithBackpressure(stream: Writable, chunk: string): Promise<void> {
    const ok = stream.write(chunk);
    if (ok) return;
    await new Promise<void>((resolve, reject) => {
        stream.once('drain', resolve);
        stream.once('error', reject);
    });
}

export async function writeUnifiedExportMarkdown(params: {
    exportMeta: IExportMeta;
    chatInfo: IChatInfo;
    messages: AsyncIterable<IUnifiedMessage>;
    outputPath?: string;
}): Promise<void> {
    const stream: Writable = params.outputPath
        ? createWriteStream(params.outputPath, { encoding: 'utf-8' })
        : (process.stdout as unknown as Writable);

    await writeWithBackpressure(stream, `# ${params.chatInfo.chat_name}\n`);
    await writeWithBackpressure(stream, `\n- Platform: ${String(params.chatInfo.platform)}\n`);
    await writeWithBackpressure(stream, `- Exported at (UTC): ${params.exportMeta.exported_at}\n\n`);

    for await (const message of params.messages) {
        const name = formatMessageDisplayName(message);
        const content = formatMessageContentForText(message);
        const ts = message.timestamp_utc;

        await writeWithBackpressure(stream, `- **${name} (${ts})**: ${content}\n`);
    }

    if (params.outputPath) {
        await new Promise<void>((resolve, reject) => {
            stream.once('finish', resolve);
            stream.once('error', reject);
            stream.end();
        });
    }
}
