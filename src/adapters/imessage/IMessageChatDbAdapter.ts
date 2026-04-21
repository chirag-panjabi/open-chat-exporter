import { createHash } from 'node:crypto';
import { Database } from 'bun:sqlite';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';

type MessageRow = {
  rowid?: number | bigint;
  guid?: string | null;
  text?: string | null;
  date?: number | bigint | string | null;
  is_from_me?: number | bigint | boolean | null;
  handle?: string | null;
  thread_originator_guid?: string | null;
  date_edited?: number | bigint | string | null;
  is_system_message?: number | bigint | boolean | null;
  num_attachments?: number | bigint | string | null;
  associated_message_guid?: string | null;
};

type TableInfoRow = {
  name?: string;
};

const APPLE_EPOCH_OFFSET_MS = 978_307_200_000n;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // NOTE: This loses precision if the number exceeds 2^53-1.
    // In practice, bun:sqlite tends to return bigint/string for large ints.
    return BigInt(Math.trunc(value));
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);

    // Occasionally timestamps can be serialized as floats; truncate toward zero.
    if (/^-?\d+\.\d+$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      if (!Number.isFinite(asNumber)) return null;
      return BigInt(Math.trunc(asNumber));
    }
  }

  if (typeof value === 'boolean') return value ? 1n : 0n;

  return null;
}

function bigintToSafeNumber(value: bigint): number {
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  const min = BigInt(Number.MIN_SAFE_INTEGER);
  if (value > max || value < min) {
    throw new Error('Timestamp out of safe JS number range');
  }
  return Number(value);
}

function appleDateToUtcIso(raw: unknown): string {
  const value = toBigInt(raw);
  if (value == null) throw new Error('Missing iMessage timestamp');

  const abs = value < 0n ? -value : value;

  // iMessage `message.date` is stored relative to Apple epoch (2001-01-01), but the unit can vary.
  // Heuristic based on magnitude:
  // - nanoseconds: ~1e17-1e18 for modern dates
  // - microseconds: ~1e14-1e15
  // - milliseconds: ~1e11-1e12
  // - seconds: ~1e8-1e9
  let msSince2001: bigint;

  if (abs >= 1_000_000_000_000_000n) {
    // nanoseconds -> ms
    msSince2001 = value / 1_000_000n;
  } else if (abs >= 1_000_000_000_000n) {
    // microseconds -> ms
    msSince2001 = value / 1_000n;
  } else if (abs >= 10_000_000_000n) {
    // milliseconds
    msSince2001 = value;
  } else {
    // seconds
    msSince2001 = value * 1000n;
  }

  const unixMs = msSince2001 + APPLE_EPOCH_OFFSET_MS;
  const date = new Date(bigintToSafeNumber(unixMs));
  if (Number.isNaN(date.getTime())) throw new Error('Unable to normalize iMessage timestamp');
  return date.toISOString();
}

function truthyInt(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  const asBig = toBigInt(value);
  return asBig != null ? asBig !== 0n : false;
}

function intFrom(value: unknown): bigint {
  return toBigInt(value) ?? 0n;
}

function getColumnNames(db: Database, table: string): Set<string> {
  const out = new Set<string>();
  const rows = db.query(`PRAGMA table_info(${table})`).all() as unknown[];
  for (const row of rows) {
    const r = row as TableInfoRow;
    const name = typeof r.name === 'string' ? r.name : undefined;
    if (name) out.add(name);
  }
  return out;
}

export class IMessageChatDbAdapter extends BaseAdapter {
  readonly platform = Platform.IMESSAGE;

  private readonly chatGuid: string;
  private readonly myName: string;

  constructor(params: { chatGuid: string; myName?: string }) {
    super();
    this.chatGuid = params.chatGuid;
    this.myName = params.myName?.trim() ? params.myName.trim() : 'Me';
  }

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    // bun:sqlite is synchronous; we still expose an async generator to match BaseAdapter.
    const db = new Database(input.inputPath, { readonly: true });

    try {
      const messageColumns = getColumnNames(db, 'message');

      const hasThreadOriginatorGuid = messageColumns.has('thread_originator_guid');
      const hasDateEdited = messageColumns.has('date_edited');
      const hasIsSystemMessage = messageColumns.has('is_system_message');
      const hasAssociatedMessageGuid = messageColumns.has('associated_message_guid');

      const selectParts: string[] = [
        'm.ROWID as rowid',
        'm.guid as guid',
        'm.text as text',
        'm.date as date',
        'm.is_from_me as is_from_me',
        'h.id as handle',
        '(SELECT COUNT(*) FROM message_attachment_join a WHERE m.ROWID = a.message_id) as num_attachments',
        hasThreadOriginatorGuid ? 'm.thread_originator_guid as thread_originator_guid' : 'NULL as thread_originator_guid',
        hasDateEdited ? 'm.date_edited as date_edited' : '0 as date_edited',
        hasIsSystemMessage ? 'm.is_system_message as is_system_message' : '0 as is_system_message',
        hasAssociatedMessageGuid ? 'm.associated_message_guid as associated_message_guid' : 'NULL as associated_message_guid',
      ];

      const whereParts: string[] = ['c.guid = ?1'];

      // Tapbacks / edits / announcements can be represented as rows associated to other messages.
      // Baseline exporter skips these rows to avoid duplicating reaction/edit events as standalone messages.
      if (hasAssociatedMessageGuid) whereParts.push('m.associated_message_guid IS NULL');

      const sql = `
SELECT
  ${selectParts.join(',\n  ')}
FROM chat c
JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
JOIN message m ON m.ROWID = cmj.message_id
LEFT JOIN handle h ON h.ROWID = m.handle_id
WHERE ${whereParts.join(' AND ')}
ORDER BY m.date;
`;

      const stmt = db.query(sql);

      const iterable = stmt.iterate(this.chatGuid) as Iterable<MessageRow>;

      for (const row of iterable) {
        const timestampUtc = appleDateToUtcIso(row.date);

        const isFromMe = truthyInt(row.is_from_me);
        const senderName = isFromMe ? this.myName : (row.handle ?? 'Unknown');
        const senderId = isFromMe ? 'me' : (row.handle ?? sha256Hex(`imessage|sender|${senderName}`));

        const content = typeof row.text === 'string' ? row.text : '';

        const messageId = typeof row.guid === 'string' && row.guid.trim() ? row.guid : undefined;

        const replyToMessageId =
          typeof row.thread_originator_guid === 'string' && row.thread_originator_guid.trim()
            ? row.thread_originator_guid.trim()
            : null;

        const numAttachments = intFrom(row.num_attachments);
        const hasAttachment = numAttachments > 0n;

        const isEdited = intFrom(row.date_edited) > 0n;
        const isSystem = truthyInt(row.is_system_message);

        yield {
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
            is_deleted: false,
            is_system: Boolean(isSystem),
          },
        };
      }
    } finally {
      db.close();
    }
  }
}
