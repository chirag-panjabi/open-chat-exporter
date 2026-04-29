import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';

type TableInfoRow = {
  name?: string;
};

type ChatSessionRow = {
  chat_pk?: number | bigint | string | null;
  contact_jid?: string | null;
  partner_name?: string | null;
  session_type?: number | bigint | string | null;
};

type MessageRow = {
  pk?: number | bigint | string | null;
  message_date?: number | bigint | string | null;
  is_from_me?: number | bigint | boolean | string | null;
  from_jid?: string | null;
  to_jid?: string | null;
  push_name?: string | null;
  text?: string | null;
  message_type?: number | bigint | string | null;
  media_item?: number | bigint | string | null;
  sort_index?: number | bigint | string | null;
  stanza_id?: string | null;
  quoted_message_pk?: number | bigint | string | null;
  quoted_stanza_id?: string | null;
};

const APPLE_EPOCH_OFFSET_MS = 978_307_200_000;

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

function cocoaDateToUtcIso(raw: unknown): string {
  const n = toNumber(raw);
  if (n == null) throw new Error('Missing WhatsApp iOS timestamp');

  // WhatsApp iOS uses Apple Cocoa/CoreData time: seconds since 2001-01-01 00:00:00 UTC.
  // Some tools represent it as a float; we preserve sub-second precision only at ms granularity.
  const abs = Math.abs(n);

  // Heuristic: if the value is already in milliseconds since 2001 (unlikely), don't multiply.
  const msSince2001 = abs >= 10_000_000_000 ? n : n * 1000;
  const unixMs = msSince2001 + APPLE_EPOCH_OFFSET_MS;

  const date = new Date(unixMs);
  if (Number.isNaN(date.getTime())) throw new Error('Unable to normalize WhatsApp iOS timestamp');
  return date.toISOString();
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

function pickSingleChatSession(params: {
  sessions: ChatSessionRow[];
  chatPk?: bigint;
  chatJid?: string;
}): ChatSessionRow {
  const { sessions, chatPk, chatJid } = params;

  if (sessions.length === 0) {
    throw new Error('WhatsApp iOS DB: No chat sessions found (ZWACHATSESSION is empty)');
  }

  if (chatPk != null) {
    const match = sessions.find((s) => toBigInt(s.chat_pk) === chatPk);
    if (!match) {
      throw new Error(`WhatsApp iOS DB: No chat session found for --wa-chat-pk ${chatPk}`);
    }
    return match;
  }

  if (chatJid && chatJid.trim()) {
    const wanted = chatJid.trim();
    const match = sessions.find((s) => (s.contact_jid ?? '').trim() === wanted);
    if (!match) {
      throw new Error(`WhatsApp iOS DB: No chat session found for --wa-chat-jid ${wanted}`);
    }
    return match;
  }

  if (sessions.length === 1) return sessions[0];

  const examples = sessions
    .slice(0, 8)
    .map((s) => `- pk=${String(s.chat_pk ?? '')} jid=${String(s.contact_jid ?? '')} name=${String(s.partner_name ?? '')}`)
    .join('\n');

  throw new Error(
    'WhatsApp iOS DB: multiple chat sessions found; specify one via --wa-chat-jid or --wa-chat-pk.\n' +
      examples
  );
}

function messageIdFromPk(pk: bigint): string {
  // Stable ID scheme so reply pointers can be computed without needing a second-pass lookup.
  return `whatsapp-ios:${pk.toString()}`;
}

export class WhatsAppIosChatStorageDbAdapter extends BaseAdapter {
  readonly platform = Platform.WHATSAPP;

  private readonly chatJid?: string;
  private readonly chatPk?: bigint;
  private readonly myName: string;

  constructor(params: { chatJid?: string; chatPk?: string; myName?: string } = {}) {
    super();
    this.chatJid = params.chatJid;
    this.chatPk = params.chatPk ? toBigInt(params.chatPk) ?? undefined : undefined;
    this.myName = params.myName?.trim() ? params.myName.trim() : 'Me';
  }

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const db = new Database(input.inputPath, { readonly: true });

    // Optional, streaming-safe: build an on-disk stanza-id index if we need stanza-based reply lookups.
    let indexDb: Database | undefined;
    let indexPath: string | undefined;

    try {
      if (!hasTable(db, 'ZWAMESSAGE') || !hasTable(db, 'ZWACHATSESSION')) {
        throw new Error('WhatsApp iOS DB: expected tables ZWAMESSAGE and ZWACHATSESSION');
      }

      const messageCols = getColumnNames(db, 'ZWAMESSAGE');
      const hasMessageInfo = messageCols.has('ZMESSAGEINFO') && hasTable(db, 'ZWAMESSAGEINFO');
      const messageInfoCols = hasMessageInfo ? getColumnNames(db, 'ZWAMESSAGEINFO') : new Set<string>();

      if (!messageCols.has('Z_PK') || !messageCols.has('ZCHATSESSION') || !messageCols.has('ZMESSAGEDATE')) {
        throw new Error('WhatsApp iOS DB: missing required columns on ZWAMESSAGE (need Z_PK, ZCHATSESSION, ZMESSAGEDATE)');
      }

      // Identify chat session.
      const sessions = db
        .query(
          `
SELECT
  Z_PK as chat_pk,
  ZCONTACTJID as contact_jid,
  ZPARTNERNAME as partner_name,
  ZSESSIONTYPE as session_type
FROM ZWACHATSESSION
ORDER BY Z_PK;
`.trim()
        )
        .all() as ChatSessionRow[];

      const session = pickSingleChatSession({ sessions, chatPk: this.chatPk, chatJid: this.chatJid });
      const selectedChatPk = toBigInt(session.chat_pk);
      if (selectedChatPk == null) {
        throw new Error('WhatsApp iOS DB: unable to determine selected chat session primary key');
      }

      const quotedPkExpr =
        messageCols.has('ZQUOTEDMESSAGE')
          ? 'm.ZQUOTEDMESSAGE as quoted_message_pk'
          : hasMessageInfo && messageInfoCols.has('ZQUOTEDMESSAGE')
            ? 'mi.ZQUOTEDMESSAGE as quoted_message_pk'
            : 'NULL as quoted_message_pk';

      const quotedStanzaExpr =
        messageCols.has('ZQUOTEDMESSAGESTANZAID')
          ? 'm.ZQUOTEDMESSAGESTANZAID as quoted_stanza_id'
          : hasMessageInfo && messageInfoCols.has('ZQUOTEDMESSAGESTANZAID')
            ? 'mi.ZQUOTEDMESSAGESTANZAID as quoted_stanza_id'
            : 'NULL as quoted_stanza_id';

      const needsStanzaIndex =
        messageCols.has('ZSTANZAID') &&
        (quotedStanzaExpr.startsWith('m.') || quotedStanzaExpr.startsWith('mi.'));

      if (needsStanzaIndex) {
        indexPath = join(tmpdir(), `unified-chat-exporter.whatsapp-ios-stanza-index.${Date.now()}.${Math.random().toString(16).slice(2)}.sqlite`);
        indexDb = new Database(indexPath);
        indexDb.exec('PRAGMA journal_mode=WAL;');
        indexDb.exec('CREATE TABLE IF NOT EXISTS stanza_to_pk (stanza_id TEXT PRIMARY KEY, pk TEXT NOT NULL);');

        const indexStmt = indexDb.prepare('INSERT OR REPLACE INTO stanza_to_pk (stanza_id, pk) VALUES (?1, ?2)');

        const stanzaStmt = db.query(
          `
SELECT
  m.ZSTANZAID as stanza_id,
  m.Z_PK as pk
FROM ZWAMESSAGE m
WHERE m.ZCHATSESSION = ?1 AND m.ZSTANZAID IS NOT NULL
ORDER BY m.Z_PK;
`.trim()
        );

        for (const row of stanzaStmt.iterate(selectedChatPk) as Iterable<{ stanza_id?: string | null; pk?: unknown }>) {
          const stanzaId = typeof row.stanza_id === 'string' ? row.stanza_id.trim() : '';
          const pk = toBigInt(row.pk);
          if (!stanzaId || pk == null) continue;
          indexStmt.run(stanzaId, pk.toString());
        }
      }

      const selectParts: string[] = [
        'm.Z_PK as pk',
        'm.ZMESSAGEDATE as message_date',
        (messageCols.has('ZISFROMME') ? 'm.ZISFROMME as is_from_me' : '0 as is_from_me'),
        (messageCols.has('ZFROMJID') ? 'm.ZFROMJID as from_jid' : 'NULL as from_jid'),
        (messageCols.has('ZTOJID') ? 'm.ZTOJID as to_jid' : 'NULL as to_jid'),
        (messageCols.has('ZPUSHNAME') ? 'm.ZPUSHNAME as push_name' : 'NULL as push_name'),
        (messageCols.has('ZTEXT') ? 'm.ZTEXT as text' : 'NULL as text'),
        (messageCols.has('ZMESSAGETYPE') ? 'm.ZMESSAGETYPE as message_type' : '0 as message_type'),
        (messageCols.has('ZMEDIAITEM') ? 'm.ZMEDIAITEM as media_item' : 'NULL as media_item'),
        (messageCols.has('ZSORT') ? 'm.ZSORT as sort_index' : 'NULL as sort_index'),
        (messageCols.has('ZSTANZAID') ? 'm.ZSTANZAID as stanza_id' : 'NULL as stanza_id'),
        quotedPkExpr,
        quotedStanzaExpr,
      ];

      const joinParts: string[] = [];
      if (hasMessageInfo) {
        joinParts.push('LEFT JOIN ZWAMESSAGEINFO mi ON mi.Z_PK = m.ZMESSAGEINFO');
      }

      const orderBy = messageCols.has('ZSORT') ? 'm.ZSORT' : 'm.ZMESSAGEDATE';

      const sql = `
SELECT
  ${selectParts.join(',\n  ')}
FROM ZWAMESSAGE m
${joinParts.join('\n')}
WHERE m.ZCHATSESSION = ?1
ORDER BY ${orderBy};
`;

      const stmt = db.query(sql);

      const stanzaLookup = indexDb
        ? indexDb.query('SELECT pk FROM stanza_to_pk WHERE stanza_id = ?1 LIMIT 1')
        : null;

      const iterable = stmt.iterate(selectedChatPk) as Iterable<MessageRow>;

      for (const row of iterable) {
        const pk = toBigInt(row.pk);
        if (pk == null) continue;

        const timestampUtc = cocoaDateToUtcIso(row.message_date);

        const isFromMe = truthyInt(row.is_from_me);

        const senderId = isFromMe ? 'me' : (row.from_jid ?? sha256Hex(`whatsapp-ios|sender|${row.push_name ?? row.from_jid ?? 'Unknown'}`));
        const senderName = isFromMe ? this.myName : (row.push_name ?? row.from_jid ?? 'Unknown');

        const content = typeof row.text === 'string' ? row.text : '';

        const messageType = toBigInt(row.message_type) ?? 0n;
        const isSystem = messageType === 10n;

        const mediaItem = toBigInt(row.media_item);
        const hasAttachment = mediaItem != null && mediaItem !== 0n;

        let replyTo: string | null = null;

        const quotedPk = toBigInt(row.quoted_message_pk);
        if (quotedPk != null && quotedPk !== 0n) {
          replyTo = messageIdFromPk(quotedPk);
        } else if (stanzaLookup) {
          const quotedStanzaId = typeof row.quoted_stanza_id === 'string' ? row.quoted_stanza_id.trim() : '';
          if (quotedStanzaId) {
            const hit = stanzaLookup.get(quotedStanzaId) as { pk?: string } | null;
            const hitPk = hit?.pk ? toBigInt(hit.pk) : null;
            if (hitPk != null) replyTo = messageIdFromPk(hitPk);
          }
        }

        yield {
          message_id: messageIdFromPk(pk),
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
            is_deleted: false,
            is_system: isSystem,
          },
        };
      }
    } finally {
      try {
        db.close();
      } catch {
        // ignore
      }

      if (indexDb) {
        try {
          indexDb.close();
        } catch {
          // ignore
        }
      }

      if (indexPath) {
        // Best-effort cleanup.
        const candidates = [indexPath, `${indexPath}-wal`, `${indexPath}-shm`];
        for (const p of candidates) {
          try {
            await Bun.file(p).delete();
          } catch {
            // ignore
          }
        }
      }
    }
  }
}
