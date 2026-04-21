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

type StreamArrayChunk = {
  key: number;
  value: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

function getStringFromAny(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = getString(obj, key);
    if (value != null) return value;
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

  throw new Error('Invalid timestamp in X/Twitter DM message');
}

function hasAnyAttachment(messageCreate: Record<string, unknown>): boolean {
  const mediaUrls = messageCreate.mediaUrls;
  if (Array.isArray(mediaUrls) && mediaUrls.length > 0) return true;

  const attachment = messageCreate.attachment;
  if (isRecord(attachment) && Object.keys(attachment).length > 0) return true;

  const card = messageCreate.card;
  if (isRecord(card) && Object.keys(card).length > 0) return true;

  return false;
}

function mapMessageCreateToUnified(messageCreate: Record<string, unknown>): IUnifiedMessage {
  const senderId = getStringFromAny(messageCreate, ['senderId', 'sender_id', 'fromId']) ?? 'unknown_sender';
  const senderName = getStringFromAny(messageCreate, ['senderScreenName', 'senderName']) ?? `user:${senderId}`;

  const nativeMessageId = getStringFromAny(messageCreate, ['id', 'messageId']);

  const timestampRaw = messageCreate.createdAt ?? messageCreate.timestamp ?? getStringFromAny(messageCreate, ['createdAt']);
  const timestampUtc = normalizeTimestampUtc(timestampRaw);

  const content =
    getStringFromAny(messageCreate, ['text', 'message', 'body']) ??
    getStringFromAny(messageCreate, ['fullText', 'full_text']) ??
    '';

  const hasAttachment = hasAnyAttachment(messageCreate);

  const messageId = nativeMessageId ?? sha256Hex(`x_twitter|${timestampUtc}|${senderId}|${content}`);

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
      is_system: false,
    },
  };
}

function mapSystemEventToUnified(eventType: string, payload: Record<string, unknown>): IUnifiedMessage | null {
  const timestampRaw = payload.createdAt ?? payload.timestamp ?? getStringFromAny(payload, ['createdAt', 'timestamp']);
  if (timestampRaw == null) return null;

  const timestampUtc = normalizeTimestampUtc(timestampRaw);
  const content = getStringFromAny(payload, ['text', 'message']) ?? `System event: ${eventType}`;

  const messageId = sha256Hex(`x_twitter|system|${timestampUtc}|${eventType}|${content}`);

  return {
    message_id: messageId,
    timestamp_utc: timestampUtc,
    sender: {
      id: sha256Hex('x_twitter|system'),
      original_name: 'System',
    },
    content,
    context: {
      reply_to_message_id: null,
    },
    metadata: {
      has_attachment: false,
      is_edited: false,
      is_deleted: false,
      is_system: true,
    },
  };
}

async function* iterJsonTextFromPossiblyJsWrappedStream(
  stream: ReadableStream<Uint8Array>,
  encoding = 'utf-8'
): AsyncGenerator<string> {
  const decoder = new TextDecoder(encoding);

  let started = false;
  let depth = 0;
  let inString = false;
  let escape = false;

  for await (const chunk of iterUint8(stream)) {
    const text = decoder.decode(chunk, { stream: true });

    let out = '';

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (!started) {
        if (ch === '{' || ch === '[') {
          started = true;
          depth = 1;
          out += ch;
        }
        continue;
      }

      out += ch;

      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === '\\') {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
          continue;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === '{' || ch === '[') {
        depth++;
        continue;
      }

      if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) {
          if (out) yield out;
          return;
        }
      }
    }

    if (out) yield out;
  }

  const tail = decoder.decode();
  if (tail) yield tail;
}

export class XTwitterDirectMessagesJsAdapter extends BaseAdapter {
  readonly platform = Platform.X_TWITTER;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const jsonTextStream = Readable.from(iterJsonTextFromPossiblyJsWrappedStream(input.file.stream()));

    const messagesArrayStream = chain([
      jsonTextStream,
      parser(),
      pick({ filter: /dmConversation\.messages$/ }),
      streamArray(),
    ]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;

      const value = chunk.value;

      const messageCreate = value.messageCreate;
      if (isRecord(messageCreate)) {
        yield mapMessageCreateToUnified(messageCreate);
        continue;
      }

      const keys = Object.keys(value);
      if (keys.length === 1) {
        const eventType = keys[0];
        const payload = value[eventType];
        if (isRecord(payload)) {
          const system = mapSystemEventToUnified(eventType, payload);
          if (system) yield system;
        }
      }
    }
  }
}
