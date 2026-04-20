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
  }
  return undefined;
}

function getBoolean(obj: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'boolean') return value;
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

function normalizeTimestampUtcFromMs(timestampMs: number): string {
  const date = new Date(timestampMs);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid timestamp_ms in Messenger export');
  return date.toISOString();
}

function hasAnyAttachment(message: Record<string, unknown>): boolean {
  const keys = ['photos', 'videos', 'gifs', 'audio_files', 'files', 'sticker', 'share'];
  for (const key of keys) {
    const value = message[key];
    if (Array.isArray(value) && value.length > 0) return true;
    if (!Array.isArray(value) && value != null) return true;
  }
  return false;
}

function parseReactions(message: Record<string, unknown>): IReaction[] {
  const reactionsRaw = getArray(message, ['reactions']);
  if (!reactionsRaw) return [];

  const counts = new Map<string, { count: number; participants: Set<string> }>();

  for (const item of reactionsRaw) {
    if (!isRecord(item)) continue;

    const emoji = getString(item, ['reaction', 'emoji']);
    if (!emoji) continue;

    const actor = getString(item, ['actor']);

    const existing = counts.get(emoji) ?? { count: 0, participants: new Set<string>() };
    existing.count += 1;
    if (actor) existing.participants.add(actor);
    counts.set(emoji, existing);
  }

  const reactions: IReaction[] = [];
  for (const [emoji, info] of counts.entries()) {
    const participants = info.participants.size ? Array.from(info.participants) : undefined;
    reactions.push({ emoji, count: info.count, participants });
  }

  return reactions;
}

function mapMessengerMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const senderName = getString(message, ['sender_name']) ?? 'Unknown';
  const senderId = sha256Hex(`fb_messenger|sender|${senderName}`);

  const timestampMs = getNumber(message, ['timestamp_ms']);
  if (typeof timestampMs !== 'number') {
    throw new Error('Missing timestamp_ms in Messenger message');
  }

  const timestampUtc = normalizeTimestampUtcFromMs(timestampMs);

  const content = getString(message, ['content']) ?? '';

  const isUnsent = getBoolean(message, ['is_unsent']) ?? false;

  const type = getString(message, ['type']);
  const isSystem = Boolean(type && type !== 'Generic');

  const hasAttachment = hasAnyAttachment(message);

  const reactions = parseReactions(message);

  const messageId = sha256Hex(`${timestampUtc}|${senderName}|${content}`);

  return {
    message_id: messageId,
    timestamp_utc: timestampUtc,
    sender: {
      id: senderId,
      original_name: senderName,
    },
    content,
    context: {
      reply_to_message_id: null,
    },
    interactions: reactions.length ? { reactions } : undefined,
    metadata: {
      has_attachment: hasAttachment,
      is_edited: false,
      is_deleted: isUnsent,
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

export class FacebookMessengerJsonAdapter extends BaseAdapter {
  readonly platform = Platform.FB_MESSENGER;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);

    const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

    const messagesArrayStream =
      rootType === 'object'
        ? chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()])
        : chain([inputTextStream, parser(), streamArray()]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;
      yield mapMessengerMessageToUnified(chunk.value);
    }
  }
}
