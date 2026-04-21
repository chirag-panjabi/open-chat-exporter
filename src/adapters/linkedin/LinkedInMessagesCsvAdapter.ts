import { createHash } from 'node:crypto';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';
import { iterLines } from '../../utils/streams';

type CsvRow = string[];

type CsvTable = {
  headers: string[];
  rows: AsyncGenerator<CsvRow>;
};

type HeaderIndex = Map<string, number>;

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizeHeaderKey(header: string): string {
  return header
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function buildHeaderIndex(headers: string[]): HeaderIndex {
  const index = new Map<string, number>();
  for (let i = 0; i < headers.length; i++) {
    index.set(normalizeHeaderKey(headers[i]), i);
  }
  return index;
}

function parseCsvRow(record: string): string[] {
  const fields: string[] = [];
  let field = '';
  let i = 0;
  let inQuotes = false;

  while (i < record.length) {
    const ch = record[i];

    if (inQuotes) {
      if (ch === '"') {
        const next = record[i + 1];
        if (next === '"') {
          field += '"';
          i += 2;
          continue;
        }

        inQuotes = false;
        i += 1;
        continue;
      }

      field += ch;
      i += 1;
      continue;
    }

    if (ch === ',') {
      fields.push(field);
      field = '';
      i += 1;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }

    field += ch;
    i += 1;
  }

  fields.push(field);
  return fields;
}

function updateInQuotesState(line: string, startingInQuotes: boolean): boolean {
  let inQuotes = startingInQuotes;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch !== '"') continue;

    if (inQuotes) {
      const next = line[i + 1];
      if (next === '"') {
        i += 1;
        continue;
      }

      inQuotes = false;
      continue;
    }

    inQuotes = true;
  }

  return inQuotes;
}

async function* iterCsvRecords(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<string> {
  let buffer = '';
  let inQuotes = false;

  for await (const line of iterLines(stream, { yieldEmpty: true })) {
    // Preserve newlines inside quoted fields.
    if (buffer.length > 0) buffer += '\n';
    buffer += line;

    inQuotes = updateInQuotesState(line, inQuotes);

    if (!inQuotes) {
      yield buffer;
      buffer = '';
    }
  }

  if (buffer.trim().length > 0) {
    // Best-effort: tolerate a final record even if malformed.
    yield buffer;
  }
}

async function readCsvTable(stream: ReadableStream<Uint8Array>): Promise<CsvTable> {
  const recordIter = iterCsvRecords(stream);

  const first = await recordIter.next();
  if (first.done || typeof first.value !== 'string') {
    throw new Error('LinkedIn CSV is empty (missing header row)');
  }

  const headerRow = parseCsvRow(first.value);
  const headers = headerRow.map((h) => h.replace(/^\uFEFF/, '').trim());

  async function* rows(): AsyncGenerator<CsvRow> {
    for await (const record of recordIter) {
      if (!record || !record.trim()) continue;
      yield parseCsvRow(record);
    }
  }

  return { headers, rows: rows() };
}

function getCellByIndex(index: HeaderIndex, row: string[], keys: string[]): string | undefined {
  for (const key of keys) {
    const idx = index.get(normalizeHeaderKey(key));
    if (idx == null) continue;
    const value = row[idx];
    if (typeof value === 'string') return value;
  }

  return undefined;
}

function normalizeTimestampUtc(raw: string): string {
  const value = raw.trim();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString();

  // Some exports may store epoch milliseconds as a string.
  if (/^\d{10,13}$/.test(value)) {
    const ms = Number(value.length === 10 ? `${value}000` : value);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }

  throw new Error(`Invalid timestamp in LinkedIn CSV: ${raw}`);
}

function isTruthyText(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v !== '0' && v !== 'false' && v !== 'no' && v !== 'none' && v !== 'null';
}

function looksLikeAttachment(mediaType: string | undefined, attachmentCell: string | undefined): boolean {
  if (isTruthyText(attachmentCell)) return true;
  if (!mediaType) return false;

  const t = mediaType.trim().toLowerCase();
  if (!t) return false;

  // Treat explicit non-text media types as attachments.
  return t !== 'text' && t !== 'message' && t !== 'chat' && t !== 'none';
}

function isSystemMessage(from: string, type: string | undefined): boolean {
  const f = from.trim().toLowerCase();
  if (f === 'system' || f === 'linkedin') return true;

  if (!type) return false;
  const t = type.trim().toLowerCase();
  return t === 'system' || t === 'event' || t === 'notification';
}

function mapLinkedInRowToUnified(index: HeaderIndex, row: string[]): IUnifiedMessage {
  const from =
    getCellByIndex(index, row, ['From', 'Sender', 'From Name', 'from', 'sender'])?.trim() ?? 'Unknown';
  const to = getCellByIndex(index, row, ['To', 'Recipient', 'To Name', 'to', 'recipient'])?.trim();

  const rawDate = getCellByIndex(index, row, ['Date', 'Timestamp', 'Created At', 'created_at', 'date']) ?? '';
  const timestampUtc = normalizeTimestampUtc(rawDate);

  const content = getCellByIndex(index, row, ['Content', 'Message', 'Text', 'Body', 'content']) ?? '';

  const mediaType = getCellByIndex(index, row, ['Media Type', 'media type', 'MediaType', 'media_type']);
  const attachmentCell = getCellByIndex(index, row, ['Attachments', 'Attachment', 'Media', 'Has Attachment']);
  const hasAttachment = looksLikeAttachment(mediaType, attachmentCell);

  const type = getCellByIndex(index, row, ['Type', 'Event', 'Message Type']);
  const isSystem = isSystemMessage(from, type);

  const senderId = sha256Hex(`linkedin|sender|${from}`);
  const messageId = sha256Hex(`linkedin|${timestampUtc}|${from}|${to ?? ''}|${content}`);

  return {
    message_id: messageId,
    timestamp_utc: timestampUtc,
    sender: {
      id: senderId,
      original_name: from,
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

export class LinkedInMessagesCsvAdapter extends BaseAdapter {
  readonly platform = Platform.LINKEDIN;

  async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
    const table = await readCsvTable(input.stream);
    const index = buildHeaderIndex(table.headers);

    for await (const row of table.rows) {
      yield mapLinkedInRowToUnified(index, row);
    }
  }
}
