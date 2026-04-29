import { createHash } from 'node:crypto';
import type { IChatInfo } from '../types';

export type ChunkBy = 'day' | 'month';

export function computeChatId(chatInfo: IChatInfo): string {
    const platform = String(chatInfo.platform);
    const chatType = String(chatInfo.chat_type);
    const chatName = chatInfo.chat_name;

    const stable = `${platform}\n${chatType}\n${chatName}`;
    return createHash('sha256').update(stable, 'utf8').digest('hex').slice(0, 8);
}

export function computeChunkKey(timestampUtc: string, chunkBy: ChunkBy): string {
    // We assume ISO 8601 UTC strings per schema contract.
    // Derive keys via string slicing for deterministic, locale-free chunk boundaries.
    if (chunkBy === 'month') {
        if (!/^\d{4}-\d{2}-\d{2}T/.test(timestampUtc)) {
            throw new Error(`Invalid timestamp_utc for month chunking: ${timestampUtc}`);
        }
        return timestampUtc.slice(0, 7);
    }

    if (!/^\d{4}-\d{2}-\d{2}T/.test(timestampUtc)) {
        throw new Error(`Invalid timestamp_utc for day chunking: ${timestampUtc}`);
    }
    return timestampUtc.slice(0, 10);
}

export function buildChunkFilename(params: {
    chatInfo: IChatInfo;
    chunkKey: string;
    ext: 'json' | 'md';
}): string {
    const platform = String(params.chatInfo.platform);
    const chatId = computeChatId(params.chatInfo);
    return `${platform}.${chatId}.chunk.${params.chunkKey}.${params.ext}`;
}
