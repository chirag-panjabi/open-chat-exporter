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

function getRecord(obj: Record<string, unknown>, keys: string[]): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (isRecord(value)) return value;
  }
  return undefined;
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeTimestampUtc(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();

  if (typeof value === 'string') {
    const trimmed = value.trim();

    if (/^\d{10,13}$/.test(trimmed)) {
      const ms = Number(trimmed.length === 10 ? `${trimmed}000` : trimmed);
      return new Date(ms).toISOString();
    }

    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  throw new Error('Invalid timestamp in MS Teams message');
}

function hasAnyAttachment(message: Record<string, unknown>): boolean {
  const keys = ['attachments', 'files', 'images', 'mentions', 'hostedContents'];
  for (const key of keys) {
    const value = message[key];
    if (Array.isArray(value) && value.length > 0) return true;
  }
  return false;
}

function getSenderName(message: Record<string, unknown>): string {
  const from = getRecord(message, ['from', 'sender', 'author']);
  if (from) {
    const user = getRecord(from, ['user']);
    if (user) {
      const displayName = getString(user, ['displayName', 'name']);
      if (displayName) return displayName;
    }

    const displayName = getString(from, ['displayName', 'name']);
    if (displayName) return displayName;
  }

  return getString(message, ['from_name', 'sender_name']) ?? 'Unknown';
}

function mapTeamsMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const senderName = getSenderName(message);
  const senderId = sha256Hex(`ms_teams|sender|${senderName}`);

  const timestampRaw =
    message.createdDateTime ??
    message.timestamp ??
    message.timestamp_ms ??
    getString(message, ['createdDateTime', 'created_at', 'timestamp']);
  const timestampUtc = normalizeTimestampUtc(timestampRaw);

  const content = getString(message, ['body', 'content', 'text', 'message']) ?? '';

  const messageType = getString(message, ['messageType', 'type', 'eventType']);
  const isSystem = senderName.toLowerCase() === 'system' || Boolean(messageType && messageType !== 'message');

  const hasAttachment = hasAnyAttachment(message);

  const messageId = sha256Hex(`ms_teams|${timestampUtc}|${senderName}|${content}`);

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

export class MicrosoftTeamsJsonAdapter extends BaseAdapter {
  readonly platform = Platform.MS_TEAMS;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);

    const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

    const messagesArrayStream =
      rootType === 'object'
        ? chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()])
        : chain([inputTextStream, parser(), streamArray()]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;
      yield mapTeamsMessageToUnified(chunk.value);
    }
  }
}
