import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';

type TableInfoRow = {
    name?: string;
};

type ChatRow = {
    jid?: string | null;
};

type MessageRow = {
    row_id?: number | bigint | string | null;
    chat_jid?: string | null;
    key_from_me?: number | bigint | boolean | string | null;
    timestamp?: number | bigint | string | null;
    data?: string | null;
    remote_resource?: string | null;
    push_name?: string | null;
    media_wa_type?: number | bigint | string | null;
    quoted_row_id?: number | bigint | string | null;
};

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function toNumber(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        const asNum = Number(trimmed);
        return Number.isFinite(asNum) ? asNum : null;
    }
    return null;
}

function toBigInt(value: unknown): bigint | null {
    if (typeof value === 'bigint') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
    if (typeof value === 'boolean') return value ? 1n : 0n;
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return null;
        if (/^-?\d+$/.test(trimmed)) return BigInt(trimmed);
        const asNum = Number(trimmed);
        if (Number.isFinite(asNum)) return BigInt(Math.trunc(asNum));
    }
    return null;
}

function truthyInt(value: unknown): boolean {
    if (typeof value === 'boolean') return value;
    const asBig = toBigInt(value);
    return asBig != null ? asBig !== 0n : false;
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

function hasTable(db: Database, table: string): boolean {
    const row = db
        .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?1 LIMIT 1")
        .get(table) as { name?: string } | null;
    return Boolean(row?.name);
}

function unixTimeToUtcIso(raw: unknown): string {
    const n = toNumber(raw);
    if (n == null) throw new Error('Missing WhatsApp Android timestamp');

    const abs = Math.abs(n);
    const unixMs = abs >= 10_000_000_000 ? n : n * 1000;

    const date = new Date(unixMs);
    if (Number.isNaN(date.getTime())) throw new Error('Unable to normalize WhatsApp Android timestamp');
    return date.toISOString();
}

function pickSingleChatJid(params: { jids: string[]; chatJid?: string }): string {
    const { jids, chatJid } = params;

    if (jids.length === 0) {
        throw new Error('WhatsApp Android DB: No chats found (messages table has no key_remote_jid values)');
    }

    if (chatJid && chatJid.trim()) {
        const wanted = chatJid.trim();
        const match = jids.find((j) => j.trim() === wanted);
        if (!match) {
            const examples = jids.slice(0, 8).map((j) => `- jid=${j}`).join('\n');
            throw new Error(`WhatsApp Android DB: No chat found for --wa-chat-jid ${wanted}\n${examples}`);
        }
        return match;
    }

    if (jids.length === 1) return jids[0];

    const examples = jids.slice(0, 8).map((j) => `- jid=${j}`).join('\n');
    throw new Error(
        'WhatsApp Android DB: multiple chats found; specify one via --wa-chat-jid.\n' +
        examples
    );
}

function messageIdFromRowId(rowId: bigint): string {
    return `whatsapp-android:${rowId.toString()}`;
}

function analyzeDeletedFlag(content: string): boolean {
    const cleaned = content.trim();
    return /^(this message was deleted|you deleted this message)$/i.test(cleaned);
}

export class WhatsAppAndroidMsgstoreDbAdapter extends BaseAdapter {
    readonly platform = Platform.WHATSAPP;

    private readonly chatJid?: string;
    private readonly myName: string;

    constructor(params: { chatJid?: string; myName?: string } = {}) {
        super();
        this.chatJid = params.chatJid;
        this.myName = params.myName?.trim() ? params.myName.trim() : 'Me';
    }

    async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
        const db = new Database(input.inputPath, { readonly: true });

        try {
            if (!hasTable(db, 'messages')) {
                throw new Error("WhatsApp Android DB: expected table 'messages'");
            }

            const messageCols = getColumnNames(db, 'messages');
            if (!messageCols.has('_id') || !messageCols.has('key_remote_jid') || !messageCols.has('timestamp')) {
                throw new Error(
                    "WhatsApp Android DB: missing required columns on messages (need _id, key_remote_jid, timestamp)"
                );
            }

            const hasKeyFromMe = messageCols.has('key_from_me');
            const hasData = messageCols.has('data');
            const hasRemoteResource = messageCols.has('remote_resource');
            const hasPushName = messageCols.has('push_name');
            const hasMediaType = messageCols.has('media_wa_type');

            const quotedCol =
                messageCols.has('quoted_row_id')
                    ? 'quoted_row_id'
                    : messageCols.has('quoted_message_row_id')
                        ? 'quoted_message_row_id'
                        : null;

            const chatRows = db
                .query(
                    `
SELECT DISTINCT
  key_remote_jid as jid
FROM messages
WHERE key_remote_jid IS NOT NULL
ORDER BY key_remote_jid;
`.trim()
                )
                .all() as ChatRow[];

            const jids = chatRows
                .map((r) => (typeof r.jid === 'string' ? r.jid.trim() : ''))
                .filter((j) => j.length > 0);

            const selectedChatJid = pickSingleChatJid({ jids, chatJid: this.chatJid });

            const selectParts: string[] = [
                '_id as row_id',
                'key_remote_jid as chat_jid',
                (hasKeyFromMe ? 'key_from_me as key_from_me' : '0 as key_from_me'),
                'timestamp as timestamp',
                (hasData ? 'data as data' : "'' as data"),
                (hasRemoteResource ? 'remote_resource as remote_resource' : 'NULL as remote_resource'),
                (hasPushName ? 'push_name as push_name' : 'NULL as push_name'),
                (hasMediaType ? 'media_wa_type as media_wa_type' : 'NULL as media_wa_type'),
                (quotedCol ? `${quotedCol} as quoted_row_id` : 'NULL as quoted_row_id'),
            ];

            const sql = `
SELECT
  ${selectParts.join(',\n  ')}
FROM messages
WHERE key_remote_jid = ?1
ORDER BY timestamp, _id;
`;

            const stmt = db.query(sql);

            for (const row of stmt.iterate(selectedChatJid) as Iterable<MessageRow>) {
                const rowId = toBigInt(row.row_id);
                if (rowId == null) continue;

                const timestampUtc = unixTimeToUtcIso(row.timestamp);

                const isFromMe = truthyInt(row.key_from_me);

                const content = typeof row.data === 'string' ? row.data : '';

                const senderJid = isFromMe
                    ? null
                    : (typeof row.remote_resource === 'string' && row.remote_resource.trim())
                        ? row.remote_resource.trim()
                        : (row.chat_jid ?? selectedChatJid);

                const senderName = isFromMe
                    ? this.myName
                    : (typeof row.push_name === 'string' && row.push_name.trim())
                        ? row.push_name.trim()
                        : (senderJid ?? 'Unknown');

                const senderId = isFromMe
                    ? 'me'
                    : senderJid ?? sha256Hex(`whatsapp-android|sender|${senderName}`);

                const mediaType = toBigInt(row.media_wa_type);
                const hasAttachment = mediaType != null && mediaType !== 0n;

                const isDeleted = analyzeDeletedFlag(content);

                let replyTo: string | null = null;
                const quotedRowId = toBigInt(row.quoted_row_id);
                if (quotedRowId != null && quotedRowId !== 0n) {
                    replyTo = messageIdFromRowId(quotedRowId);
                }

                yield {
                    message_id: messageIdFromRowId(rowId),
                    timestamp_utc: timestampUtc,
                    sender: {
                        id: senderId,
                        original_name: senderName,
                    },
                    content,
                    context: {
                        reply_to_message_id: replyTo,
                    },
                    interactions: undefined,
                    metadata: {
                        has_attachment: hasAttachment,
                        is_edited: false,
                        is_deleted: isDeleted,
                        is_system: false,
                    },
                };
            }
        } finally {
            try {
                db.close();
            } catch {
                // ignore
            }
        }
    }
}
