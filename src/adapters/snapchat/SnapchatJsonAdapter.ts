import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeTimestampUtc(raw: string): string {
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid timestamp in Snapchat export: ${raw}`);
  return date.toISOString();
}

function hasAnyAttachment(message: Record<string, unknown>): boolean {
  const mediaType = getString(message, ['Media Type', 'media_type', 'mediaType', 'media']);
  if (mediaType && mediaType.trim().toUpperCase() !== 'TEXT') return true;

  const keys = ['Media', 'media', 'Attachment', 'attachment', 'attachments', 'snap', 'snap_id'];
  for (const key of keys) {
    const value = message[key];
    if (Array.isArray(value) && value.length > 0) return true;
    if (!Array.isArray(value) && value != null) return true;
  }

  return false;
}

function mapSnapchatMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const senderName =
    getString(message, ['From', 'from', 'Sender', 'sender', 'sender_name']) ?? 'Unknown';
  const senderId = sha256Hex(`snapchat|sender|${senderName}`);

  const timestampMs = getNumber(message, ['timestamp_ms']);
  const created = getString(message, ['Created', 'created', 'Date', 'date', 'Timestamp', 'timestamp']);

  const timestampUtc =
    typeof timestampMs === 'number'
      ? new Date(timestampMs).toISOString()
      : created
        ? normalizeTimestampUtc(created)
        : (() => {
            throw new Error('Missing timestamp in Snapchat message');
          })();

  const content = getString(message, ['Text', 'text', 'Content', 'content', 'Message', 'message']) ?? '';

  const type = getString(message, ['Type', 'type']);
  const isSystem = senderName.toLowerCase() === 'system' || Boolean(type && type.toUpperCase() === 'SYSTEM');

  const hasAttachment = hasAnyAttachment(message);

  const messageId = sha256Hex(`snapchat|${timestampUtc}|${senderName}|${content}`);

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
    metadata: {
      has_attachment: hasAttachment,
      is_edited: false,
      is_deleted: false,
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

async function* iterMessagesFromObjectKey(
  file: ReturnType<typeof Bun.file>,
  key: string
): AsyncGenerator<Record<string, unknown>> {
  const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

  const arrayStream = chain([inputTextStream, parser(), pick({ filter: key }), streamArray()]);

  for await (const chunk of arrayStream as AsyncIterable<StreamArrayChunk>) {
    if (!chunk || !isRecord(chunk.value)) continue;
    yield chunk.value;
  }
}

export class SnapchatJsonAdapter extends BaseAdapter {
  readonly platform = Platform.SNAPCHAT;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);

    if (rootType === 'array') {
      const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));
      const arrayStream = chain([inputTextStream, parser(), streamArray()]);

      for await (const chunk of arrayStream as AsyncIterable<StreamArrayChunk>) {
        if (!chunk || !isRecord(chunk.value)) continue;
        yield mapSnapchatMessageToUnified(chunk.value);
      }

      return;
    }

    // Snapchat "My Data" exports often have a top-level object; commonly the message array is under
    // keys like "Chat History". We keep this adapter tolerant by trying several plausible keys.
    const candidateKeys = ['messages', 'Chat History', 'chat_history', 'chatHistory', 'Chats', 'chats'];

    for (const key of candidateKeys) {
      let yielded = false;

      for await (const msg of iterMessagesFromObjectKey(input.file, key)) {
        yielded = true;
        yield mapSnapchatMessageToUnified(msg);
      }

      if (yielded) return;
    }

    throw new Error('Could not locate a messages array in Snapchat export');
  }
}
