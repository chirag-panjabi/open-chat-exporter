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

function discordSnowflakeToUtcIso(snowflake: string): string {
  // Discord snowflake: (timestampMs - DISCORD_EPOCH) << 22
  const id = BigInt(snowflake);
  const timestampMs = (id >> 22n) + 1420070400000n;
  return new Date(Number(timestampMs)).toISOString();
}

function normalizeTimestampUtc(raw: unknown, fallbackSnowflake?: string): string {
  if (typeof raw === 'string') {
    const date = new Date(raw);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  if (fallbackSnowflake) return discordSnowflakeToUtcIso(fallbackSnowflake);

  throw new Error('Unable to normalize timestamp to ISO 8601 UTC');
}

function normalizeDiscordSenderName(author: Record<string, unknown>): string {
  const name = getString(author, ['name', 'username', 'displayName', 'original_name']) ?? 'Unknown';
  const discriminator = getString(author, ['discriminator']);

  if (!discriminator || discriminator === '0' || discriminator === '0000') return name;
  return `${name}#${discriminator}`;
}

function parseDiscordChatExporterReactions(message: Record<string, unknown>): IReaction[] {
  const reactionsRaw = getArray(message, ['reactions', 'Reactions']);
  if (!reactionsRaw) return [];

  const reactions: IReaction[] = [];
  for (const item of reactionsRaw) {
    if (!isRecord(item)) continue;

    const count = getNumber(item, ['count', 'Count']) ?? 0;
    if (count <= 0) continue;

    const emojiObj = getRecord(item, ['emoji', 'Emoji']);
    const emoji =
      (emojiObj ? getString(emojiObj, ['code', 'name', 'id']) : undefined) ??
      getString(item, ['emoji', 'Emoji']);

    if (!emoji) continue;
    reactions.push({ emoji, count });
  }

  return reactions;
}

function parseReplyToMessageId(message: Record<string, unknown>): string | null {
  const reference = getRecord(message, ['reference', 'Reference']);
  if (reference) {
    return getString(reference, ['messageId', 'message_id', 'id']) ?? null;
  }

  return (
    getString(message, ['replyToMessageId', 'reply_to_message_id', 'replyToId', 'replyId']) ?? null
  );
}

function normalizeMessageContent(message: Record<string, unknown>): string {
  const content = getString(message, ['content', 'Contents', 'text', 'Text']);
  if (typeof content === 'string') return content;

  const contentArray = getArray(message, ['content', 'Contents', 'text', 'Text']);
  if (contentArray) {
    return contentArray
      .map((part) => {
        if (typeof part === 'string') return part;
        if (isRecord(part)) {
          const text = getString(part, ['text', 'Text']);
          if (text) return text;
        }
        return '';
      })
      .join('');
  }

  return '';
}

function mapDiscordMessageToUnified(message: Record<string, unknown>): IUnifiedMessage {
  const messageId = getString(message, ['id', 'message_id', 'messageId', 'Id']);

  const author =
    getRecord(message, ['author', 'Author', 'user', 'User']) ?? ({} as Record<string, unknown>);

  const senderId = getString(author, ['id', 'Id', 'userId', 'user_id']) ?? 'unknown';
  const senderName = normalizeDiscordSenderName(author);

  const content = normalizeMessageContent(message);

  const timestampRaw =
    getString(message, ['timestamp', 'Timestamp', 'created_at', 'createdAt']) ??
    getNumber(message, ['timestamp', 'Timestamp', 'created_at', 'createdAt']);

  const fallbackIdForTimestamp = messageId ?? getString(message, ['snowflake', 'Snowflake']);

  const timestampUtc = normalizeTimestampUtc(timestampRaw, fallbackIdForTimestamp);

  const replyToMessageId = parseReplyToMessageId(message);

  const reactions = parseDiscordChatExporterReactions(message);

  const attachments = getArray(message, ['attachments', 'Attachments']);
  const hasAttachment = (attachments?.length ?? 0) > 0;

  const editedTimestamp =
    getString(message, ['timestampEdited', 'editedTimestamp', 'edited_at']) ??
    getNumber(message, ['timestampEdited', 'editedTimestamp', 'edited_at']);

  const isEdited = Boolean(editedTimestamp);

  const explicitIsDeleted =
    getBoolean(message, ['isDeleted', 'is_deleted', 'deleted']) ??
    getBoolean(message, ['isUnsented', 'is_unsent']);

  const isDeleted = explicitIsDeleted ?? false;

  const type = getString(message, ['type', 'Type']);
  const typeNumber = getNumber(message, ['type', 'Type']);
  const explicitIsSystem = getBoolean(message, ['isSystem', 'is_system', 'isSystemNotification']);

  const systemTypeNames = new Set([
    'RecipientAdd',
    'RecipientRemove',
    'Call',
    'ChannelNameChange',
    'ChannelIconChange',
    'ChannelPinnedMessage',
    'GuildMemberJoin',
    'ThreadCreated',
  ]);

  const nonSystemTypeNames = new Set(['Default', 'Reply']);

  const systemTypeNumbers = new Set([1, 2, 3, 4, 5, 6, 7, 18]);
  const nonSystemTypeNumbers = new Set([0, 19]);

  const isSystem =
    explicitIsSystem ??
    (typeof type === 'string'
      ? systemTypeNames.has(type)
        ? true
        : nonSystemTypeNames.has(type)
          ? false
          : undefined
      : undefined) ??
    (typeof typeNumber === 'number'
      ? systemTypeNumbers.has(typeNumber)
        ? true
        : nonSystemTypeNumbers.has(typeNumber)
          ? false
          : undefined
      : undefined) ??
    false;

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
    interactions: reactions.length > 0 ? { reactions } : undefined,
    metadata: {
      has_attachment: hasAttachment,
      is_edited: isEdited,
      is_deleted: isDeleted,
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

export class DiscordJsonAdapter extends BaseAdapter {
  readonly platform = Platform.DISCORD;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const rootType = await sniffJsonRootFromFile(input.file);

    const inputTextStream = Readable.from(iterTextFromWebStream(input.file.stream()));

    const messagesArrayStream =
      rootType === 'object'
        ? chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()])
        : chain([inputTextStream, parser(), streamArray()]);

    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
      if (!chunk || !isRecord(chunk.value)) continue;
      yield mapDiscordMessageToUnified(chunk.value);
    }
  }
}
