import { createWriteStream } from 'node:fs';
import type { Writable } from 'node:stream';
import type { IChatInfo, IExportMeta, IUnifiedMessage } from '../types';

async function writeWithBackpressure(stream: Writable, chunk: string): Promise<void> {
    const ok = stream.write(chunk);
    if (ok) return;
    await new Promise<void>((resolve, reject) => {
        stream.once('drain', resolve);
        stream.once('error', reject);
    });
}

function csvEscape(value: unknown): string {
    if (value == null) return '';
    const s = String(value);
    if (/[\r\n",]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export async function writeUnifiedExportCsv(params: {
    exportMeta: IExportMeta;
    chatInfo: IChatInfo;
    messages: AsyncIterable<IUnifiedMessage>;
    outputPath?: string;
}): Promise<void> {
    const stream: Writable = params.outputPath
        ? createWriteStream(params.outputPath, { encoding: 'utf-8' })
        : (process.stdout as unknown as Writable);

    // Minimal, stable schema focused on analysis.
    const header = [
        'message_id',
        'timestamp_utc',
        'sender_id',
        'sender_original_name',
        'sender_resolved_name',
        'content',
        'reply_to_message_id',
        'has_attachment',
        'is_edited',
        'is_deleted',
        'is_system',
    ].join(',');

    await writeWithBackpressure(stream, `${header}\n`);

    for await (const m of params.messages) {
        const row = [
            m.message_id,
            m.timestamp_utc,
            m.sender.id,
            m.sender.original_name,
            m.sender.resolved_name ?? '',
            m.content,
            m.context.reply_to_message_id ?? '',
            m.metadata.has_attachment,
            m.metadata.is_edited,
            m.metadata.is_deleted,
            m.metadata.is_system,
        ]
            .map(csvEscape)
            .join(',');

        await writeWithBackpressure(stream, `${row}\n`);
    }

    if (params.outputPath) {
        await new Promise<void>((resolve, reject) => {
            stream.once('finish', resolve);
            stream.once('error', reject);
            stream.end();
        });
    }

    // Params are currently unused but kept for parity with JSON/MD writers.
    void params.exportMeta;
    void params.chatInfo;
}
