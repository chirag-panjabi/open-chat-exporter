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
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
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

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeTimestampUtc(message: Record<string, unknown>): string {
  const dateString = getString(message, ['date', 'Date', 'timestamp']);
  if (dateString) {
    const date = new Date(dateString);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const unix = getNumber(message, ['date_unixtime', 'dateUnixTime', 'unix_time', 'unixTime']);
  if (typeof unix === 'number' && Number.isFinite(unix)) {
    const ms = unix < 1e12 ? unix * 1000 : unix;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  throw new Error('Unable to normalize Telegram timestamp to ISO 8601 UTC');
}

function wrapInline(type: string, text: string): string {
  switch (type) {
    case 'bold':
      return `**${text}**`;
    case 'italic':
      return `_${text}_`;
    case 'underline':
      return `__${text}__`;
    case 'strikethrough':
      return `~~${text}~~`;
    case 'code':
      return `\`${text}\``;
    case 'pre':
      return `\n\n\
\`\`\`\n${text}\n\`\`\`\n`;
    default:
      return text;
  }
}

function flattenTelegramText(textRaw: unknown): string {
  if (typeof textRaw === 'string') return textRaw;
  if (!Array.isArray(textRaw)) return '';

  let out = '';
  for (const part of textRaw) {
    if (typeof part === 'string') {
      out += part;
      continue;
    }

    if (!isRecord(part)) continue;

    const type = getString(part, ['type', 'Type']) ?? '';
    const text = getString(part, ['text', 'Text']) ?? '';
    const href = getString(part, ['href', 'url', 'Url']);

    if (type === 'link' && href) {
      const label = text || href;
      out += `[${label}](${href})`;
      continue;
    }

    out += wrapInline(type, text);
  }

  return out;
}

function hasTelegramAttachment(message: Record<string, unknown>): boolean {
  const keys = [
    'photo',
    'file',
    'thumbnail',
    'media_type',
    'mime_type',
    'sticker_emoji',
    'sticker',
    'audio_file',
    'video_file',
    'voice_message',
    'location_information',
    'contact_information',
    'poll',
  ];

  return keys.some((k) => k in message && message[k] != null);
}

function mapTelegramMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const messageIdRaw = getNumber(message, ['id', 'message_id', 'messageId']);
  const messageId = typeof messageIdRaw === 'number' ? String(messageIdRaw) : undefined;

  const from = getString(message, ['from', 'From', 'sender', 'Sender']);
  const fromId = getString(message, ['from_id', 'fromId', 'sender_id', 'senderId']);

  const action = getString(message, ['action', 'Action']);
  const type = getString(message, ['type', 'Type']);

  const isSystem = Boolean(action) || (typeof type === 'string' && type !== 'message');

  const senderName = from ?? (isSystem ? 'Telegram System' : 'Unknown');
  const senderId = fromId ?? (isSystem ? 'system' : sha256Hex(`telegram|sender|${senderName}`));

  const timestampUtc = normalizeTimestampUtc(message);

  const textRaw = message.text ?? message.Text;
  const content = flattenTelegramText(textRaw);

  const replyToIdRaw = getNumber(message, ['reply_to_message_id', 'replyToMessageId']);
  const replyToMessageId = typeof replyToIdRaw === 'number' ? String(replyToIdRaw) : null;

  const edited =
    getString(message, ['edited', 'edited_at', 'editedAt']) ??
    getNumber(message, ['edited', 'edited_at', 'editedAt']);
  const isEdited = Boolean(edited);

  const explicitDeleted = getBoolean(message, ['is_deleted', 'isDeleted', 'deleted']);
  const isDeleted =
    explicitDeleted ??
    /^(this message was deleted|you deleted this message)$/i.test(content.trim());

  const hasAttachment = hasTelegramAttachment(message);

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
    },
    interactions: undefined,
    metadata: {
      has_attachment: hasAttachment,
      is_edited: isEdited,
      is_deleted: Boolean(isDeleted),
      is_system: Boolean(isSystem),
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

export class TelegramJsonAdapter extends BaseAdapter {
  readonly platform = Platform.TELEGRAM;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);

    const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

    const messagesArrayStream =
      rootType === 'object'
        ? chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()])
        : chain([inputTextStream, parser(), streamArray()]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;
      yield mapTelegramMessageToUnified(chunk.value);
    }
  }
}
