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

  throw new Error('Invalid timestamp in Skype message');
}

function hasAnyAttachment(message: Record<string, unknown>): boolean {
  const attachments = message.attachments;
  if (Array.isArray(attachments) && attachments.length > 0) return true;

  const files = message.files;
  if (Array.isArray(files) && files.length > 0) return true;

  const content = getString(message, ['content', 'text', 'body']);
  if (content && content.includes('URIObject')) return true;

  return false;
}

function isSystemMessage(message: Record<string, unknown>): boolean {
  const messageType = getString(message, ['messagetype', 'messageType', 'type']);
  if (!messageType) return false;

  const normalized = messageType.toLowerCase();
  return normalized !== 'text' && normalized !== 'message';
}

function mapSkypeMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const senderName = getString(message, ['from', 'sender', 'author', 'from_name']) ?? 'Unknown';
  const senderId = sha256Hex(`skype|sender|${senderName}`);

  const nativeMessageId = getString(message, ['id', 'clientmessageid', 'messageId']);

  const timestampRaw =
    message.originalarrivaltime ??
    message.composetime ??
    message.timestamp ??
    getString(message, ['originalarrivaltime', 'composetime', 'created_at', 'timestamp']);
  const timestampUtc = normalizeTimestampUtc(timestampRaw);

  const content = getString(message, ['content', 'text', 'body']) ?? '';

  const editedTime = message.edittime ?? message.editTime;
  const isEdited = Boolean(editedTime && (typeof editedTime === 'number' || typeof editedTime === 'string'));

  const deletedFlag = message.isDeleted ?? message.deleted;
  const isDeleted = Boolean(deletedFlag) || content.toLowerCase().includes('message has been removed');

  const system = isSystemMessage(message) || senderName.toLowerCase() === 'system';
  const hasAttachment = hasAnyAttachment(message);

  const messageId = nativeMessageId ?? sha256Hex(`skype|${timestampUtc}|${senderName}|${content}`);

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
      is_edited: isEdited,
      is_deleted: isDeleted,
      is_system: system,
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

export class SkypeMessagesJsonAdapter extends BaseAdapter {
  readonly platform = Platform.SKYPE;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);
    const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

    const messagesArrayStream =
      rootType === 'array'
        ? chain([inputTextStream, parser(), streamArray()])
        : chain([
            inputTextStream,
            parser(),
            pick({ filter: /(^|\.)messages$|(^|\.)MessageList$/ }),
            streamArray(),
          ]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;
      yield mapSkypeMessageToUnified(chunk.value);
    }
  }
}
