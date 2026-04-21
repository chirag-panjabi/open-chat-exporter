import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IReaction, IUnifiedMessage } from '../../types';
import { Platform } from '../../types';
import { iterUint8 } from '../../utils/streams';

type RootJsonType = 'array' | 'object';

type StreamArrayChunk = {
    key: number;
    value: unknown;
};

async function* iterTextFromWebStream(
    stream: ReadableStream<Uint8Array>,
    encoding = 'utf-8'
): AsyncGenerator<string> {
    const decoder = new TextDecoder(encoding);

    for await (const chunk of iterUint8(stream)) {
        yield decoder.decode(chunk, { stream: true });
    }

    const tail = decoder.decode();
    if (tail) yield tail;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getString(obj: Record<string, unknown>, keys: string[]): string | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'string') return value;
    }
    return undefined;
}

function getNumber(obj: Record<string, unknown>, keys: string[]): number | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (typeof value === 'number' && Number.isFinite(value)) return value;
        if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
    return undefined;
}

function getRecord(
    obj: Record<string, unknown>,
    keys: string[]
): Record<string, unknown> | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (isRecord(value)) return value;
    }
    return undefined;
}

function getArray(obj: Record<string, unknown>, keys: string[]): unknown[] | undefined {
    for (const key of keys) {
        const value = obj[key];
        if (Array.isArray(value)) return value;
    }
    return undefined;
}

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function slackTsToUtcIso(raw: unknown): string | undefined {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        const ms = raw < 1e12 ? raw * 1000 : raw;
        const date = new Date(ms);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }

    if (typeof raw !== 'string') return undefined;

    const trimmed = raw.trim();
    if (!trimmed) return undefined;

    // Common numeric representations (seconds or milliseconds)
    if (/^\d{10,13}$/.test(trimmed)) {
        const asNumber = Number(trimmed);
        if (!Number.isFinite(asNumber)) return undefined;
        const ms = trimmed.length === 10 ? asNumber * 1000 : asNumber;
        const date = new Date(ms);
        if (!Number.isNaN(date.getTime())) return date.toISOString();
    }

    // Slack message ts like "1713142929.000200" (seconds + microseconds)
    if (/^\d+\.\d+$/.test(trimmed)) {
        const [secPart, fracPartRaw] = trimmed.split('.', 2);
        try {
            const seconds = BigInt(secPart);
            const microsPadded = (fracPartRaw + '000000').slice(0, 6);
            const micros = BigInt(microsPadded);
            const ms = seconds * 1000n + micros / 1000n;
            const date = new Date(Number(ms));
            if (!Number.isNaN(date.getTime())) return date.toISOString();
        } catch {
            return undefined;
        }
    }

    // Fallback: try ISO or RFC strings
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.toISOString();

    return undefined;
}

function normalizeTimestampUtc(message: Record<string, unknown>): string {
    const tsRaw =
        getString(message, ['ts', 'timestamp', 'Timestamp']) ??
        getNumber(message, ['ts', 'timestamp', 'Timestamp']);

    const timestampUtc = slackTsToUtcIso(tsRaw);
    if (timestampUtc) return timestampUtc;

    throw new Error('Unable to normalize Slack timestamp to ISO 8601 UTC');
}

function parseSlackReactions(message: Record<string, unknown>): IReaction[] {
    const reactionsRaw = getArray(message, ['reactions']);
    if (!reactionsRaw) return [];

    const reactions: IReaction[] = [];

    for (const item of reactionsRaw) {
        if (!isRecord(item)) continue;

        const name = getString(item, ['name', 'emoji']);
        const count = getNumber(item, ['count']) ?? 0;
        if (!name || count <= 0) continue;

        const usersRaw = getArray(item, ['users']);
        const participants = usersRaw?.filter((u): u is string => typeof u === 'string');

        const normalized = name.startsWith(':') ? name : `:${name}:`;

        reactions.push({
            emoji: normalized,
            count,
            participants: participants && participants.length > 0 ? participants : undefined,
        });
    }

    return reactions;
}

function hasSlackAttachment(message: Record<string, unknown>): boolean {
    const files = getArray(message, ['files']);
    const attachments = getArray(message, ['attachments']);
    return (files?.length ?? 0) > 0 || (attachments?.length ?? 0) > 0;
}

function isSlackDeleted(message: Record<string, unknown>, subtype?: string, content?: string): boolean {
    if (subtype === 'tombstone' || subtype === 'message_deleted') return true;
    if ('deleted_ts' in message && message.deleted_ts != null) return true;
    if (typeof content === 'string' && /^this message was deleted\.?$/i.test(content.trim())) return true;
    return false;
}

function isSlackSystem(subtype?: string, type?: string): boolean {
    if (type && type !== 'message') return true;
    if (!subtype) return false;

    const systemSubtypes = new Set([
        'channel_join',
        'channel_leave',
        'channel_name',
        'channel_purpose',
        'channel_topic',
        'channel_archive',
        'channel_unarchive',
        'group_join',
        'group_leave',
        'group_name',
        'group_purpose',
        'group_topic',
        'group_archive',
        'group_unarchive',
        'tombstone',
        'message_deleted',
    ]);

    return systemSubtypes.has(subtype);
}

function mapSlackMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
    const type = getString(message, ['type']);
    const subtype = getString(message, ['subtype']);

    const ts = getString(message, ['ts']) ?? getString(message, ['timestamp']);
    const timestampUtc = normalizeTimestampUtc(message);

    const userId = getString(message, ['user', 'user_id', 'userId']);
    const botId = getString(message, ['bot_id', 'botId']);

    const userProfile = getRecord(message, ['user_profile', 'userProfile']);
    const profileName =
        (userProfile ? getString(userProfile, ['display_name', 'real_name', 'name']) : undefined) ??
        undefined;

    const username = getString(message, ['username']);

    const isSystem = isSlackSystem(subtype, type);

    const senderName = profileName ?? username ?? userId ?? botId ?? (isSystem ? 'Slack System' : 'Unknown');
    const senderId = userId ?? botId ?? (isSystem ? 'system' : sha256Hex(`slack|sender|${senderName}`));

    const content = getString(message, ['text']) ?? '';

    const threadId = getString(message, ['thread_ts', 'threadTs']);
    const replyToMessageId = threadId && ts && threadId !== ts ? threadId : null;

    const reactions = parseSlackReactions(message);
    const hasAttachment = hasSlackAttachment(message);

    const editedObj = getRecord(message, ['edited']);
    const isEdited = Boolean(editedObj) || subtype === 'message_changed';

    const isDeleted = isSlackDeleted(message, subtype, content);

    const messageId = ts ?? getString(message, ['client_msg_id', 'clientMsgId', 'id']);

    return {
        message_id: messageId ?? sha256Hex(`${timestampUtc}|${senderId}|${senderName}|${content}`),
        timestamp_utc: timestampUtc,
        sender: {
            id: senderId,
            original_name: senderName,
        },
        content,
        context: {
            reply_to_message_id: replyToMessageId,
            ...(threadId ? { thread_id: threadId } : {}),
        },
        interactions: reactions.length > 0 ? { reactions } : undefined,
        metadata: {
            has_attachment: hasAttachment,
            is_edited: isEdited,
            is_deleted: isDeleted,
            is_system: isSystem,
        },
    };
}

async function sniffJsonRootFromFile(file: ReturnType<typeof Bun.file>): Promise<RootJsonType> {
    const stream = file.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');

    try {
        let buffer = '';

        while (buffer.length < 8192) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value) buffer += decoder.decode(value, { stream: true });

            const trimmed = buffer.trimStart();
            if (trimmed.length === 0) continue;

            const first = trimmed[0];
            if (first === '[') return 'array';
            if (first === '{') return 'object';

            break;
        }

        throw new Error('Unsupported JSON root (expected { or [)');
    } finally {
        await reader.cancel();
    }
}

export class SlackJsonAdapter extends BaseAdapter {
    readonly platform = Platform.SLACK;

    async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
        const rootType = await sniffJsonRootFromFile(input.file);

        const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

        const messagesArrayStream =
            rootType === 'object'
                ? chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()])
                : chain([inputTextStream, parser(), streamArray()]);

        for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
            if (!chunk || !isRecord(chunk.value)) continue;
            yield mapSlackMessageToUnified(chunk.value);
        }
    }
}
