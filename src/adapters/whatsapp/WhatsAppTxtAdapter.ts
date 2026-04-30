import { createHash } from 'node:crypto';
import type { AdapterInput } from '../../core/BaseAdapter';
import { BaseAdapter } from '../../core/BaseAdapter';
import type { IUnifiedMessage } from '../../types';
import { Platform } from '../../types';
import { iterLines } from '../../utils/streams';

type DateOrder = 'DMY' | 'MDY';

type ParsedHeader = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    rest: string;
};

const UNBRACKETED_HEADER_RE =
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\s+-\s+(.*)$/i;

const BRACKETED_HEADER_RE =
    /^\[(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}),\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?\]\s+(.*)$/i;

function sha256Hex(input: string): string {
    return createHash('sha256').update(input).digest('hex');
}

function coerceYear(year: number): number {
    if (year >= 100) return year;
    // POSIX-style pivot
    return year <= 68 ? 2000 + year : 1900 + year;
}

function stripBidiAndBom(input: string): string {
    // WhatsApp exports sometimes include LRM/RTL marks.
    return input.replace(/^\uFEFF/, '').replace(/\u200E|\u200F|\u202A|\u202B|\u202C/g, '');
}

function toUtcIsoFromLocalWallClock(parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}): string {
    if (parts.month < 1 || parts.month > 12) throw new Error('Invalid date/time in WhatsApp TXT export');
    if (parts.day < 1 || parts.day > 31) throw new Error('Invalid date/time in WhatsApp TXT export');
    if (parts.hour < 0 || parts.hour > 23) throw new Error('Invalid date/time in WhatsApp TXT export');
    if (parts.minute < 0 || parts.minute > 59) throw new Error('Invalid date/time in WhatsApp TXT export');
    if (parts.second < 0 || parts.second > 59) throw new Error('Invalid date/time in WhatsApp TXT export');

    // Stronger day-of-month validation (avoid JS Date rollover for invalid days like Feb 31).
    const maxDay = new Date(parts.year, parts.month, 0).getDate();
    if (parts.day > maxDay) throw new Error('Invalid date/time in WhatsApp TXT export');

    const date = new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    if (Number.isNaN(date.getTime())) throw new Error('Invalid date/time in WhatsApp TXT export');
    return date.toISOString();
}

function warn(input: AdapterInput, warning: { code: string; message: string }): void {
    try {
        input.onWarning?.(warning);
    } catch {
        // ignore
    }
}

function parseHeaderLine(line: string, dateOrder: DateOrder): ParsedHeader | null {
    const cleaned = stripBidiAndBom(line);

    const m = cleaned.match(UNBRACKETED_HEADER_RE) ?? cleaned.match(BRACKETED_HEADER_RE);
    if (!m) return null;

    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = coerceYear(Number(m[3]));

    let day: number;
    let month: number;
    if (dateOrder === 'DMY') {
        day = a;
        month = b;
    } else {
        month = a;
        day = b;
    }

    const hourRaw = Number(m[4]);
    const minute = Number(m[5]);
    const second = m[6] ? Number(m[6]) : 0;
    const ampm = m[7]?.toUpperCase();

    let hour = hourRaw;
    if (ampm === 'AM' || ampm === 'PM') {
        const h = hourRaw % 12;
        hour = ampm === 'PM' ? h + 12 : h;
    }

    const rest = String(m[8] ?? '').trimEnd();

    if (
        !Number.isFinite(day) ||
        !Number.isFinite(month) ||
        !Number.isFinite(y) ||
        !Number.isFinite(hour) ||
        !Number.isFinite(minute) ||
        !Number.isFinite(second)
    ) {
        return null;
    }

    return { year: y, month, day, hour, minute, second, rest };
}

function detectDateOrderFromHeaderMatch(m: RegExpMatchArray): DateOrder | null {
    const a = Number(m[1]);
    const b = Number(m[2]);

    // Unambiguous signal: one side cannot be a month.
    if (a > 12 && b <= 12) return 'DMY';
    if (b > 12 && a <= 12) return 'MDY';

    return null;
}

async function detectWhatsAppDateOrder(file: ReturnType<typeof Bun.file>): Promise<DateOrder> {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase();
    const defaultOrder: DateOrder = locale.startsWith('en-us') ? 'MDY' : 'DMY';

    let scanned = 0;
    for await (const line of iterLines(file.stream(), { yieldEmpty: false })) {
        scanned++;
        const cleaned = stripBidiAndBom(line);

        const m = cleaned.match(UNBRACKETED_HEADER_RE) ?? cleaned.match(BRACKETED_HEADER_RE);
        if (m) {
            const inferred = detectDateOrderFromHeaderMatch(m);
            if (inferred) return inferred;
        }

        if (scanned >= 400) break;
    }

    return defaultOrder;
}

function parseSenderAndContent(rest: string):
    | { senderName: string; content: string; isSystem: false }
    | { senderName: string; content: string; isSystem: true } {
    const cleaned = stripBidiAndBom(rest).trim();

    const sepIndex = cleaned.indexOf(': ');
    if (sepIndex === -1) {
        return { senderName: 'WhatsApp System', content: cleaned, isSystem: true };
    }

    const senderName = cleaned.slice(0, sepIndex).trim();
    const content = cleaned.slice(sepIndex + 2);

    if (!senderName) {
        return { senderName: 'WhatsApp System', content: cleaned, isSystem: true };
    }

    return { senderName, content, isSystem: false };
}

function analyzeContentFlags(content: string): {
    content: string;
    hasAttachment: boolean;
    isDeleted: boolean;
} {
    const cleaned = stripBidiAndBom(content).trim();

    const isDeleted = /^(this message was deleted|you deleted this message)$/i.test(cleaned);

    const attachmentMarker =
        /<media omitted>|\b(image|video|gif|audio|sticker) omitted\b/i.test(cleaned);

    // If the message is *only* a media placeholder, strip it.
    const contentOut = attachmentMarker && cleaned.length <= 40 ? '' : content;

    return {
        content: contentOut,
        hasAttachment: attachmentMarker,
        isDeleted,
    };
}

function toUnifiedMessage(params: {
    timestampUtc: string;
    senderName: string;
    content: string;
    isSystem: boolean;
    hasAttachment: boolean;
    isDeleted: boolean;
}): IUnifiedMessage {
    const senderId = params.isSystem ? 'system' : sha256Hex(`whatsapp|sender|${params.senderName}`);

    const messageId = sha256Hex(
        `${params.timestampUtc}|${params.senderName}|${params.content}`
    );

    return {
        message_id: messageId,
        timestamp_utc: params.timestampUtc,
        sender: {
            id: senderId,
            original_name: params.senderName,
        },
        content: params.content,
        context: {
            reply_to_message_id: null,
        },
        interactions: undefined,
        metadata: {
            has_attachment: params.hasAttachment,
            is_edited: false,
            is_deleted: params.isDeleted,
            is_system: params.isSystem,
        },
    };
}

export class WhatsAppTxtAdapter extends BaseAdapter {
    readonly platform = Platform.WHATSAPP;

    async *parseMessages(input: AdapterInput): AsyncGenerator<IUnifiedMessage> {
        const dateOrder = await detectWhatsAppDateOrder(input.file);

        let current:
            | {
                timestampUtc: string;
                senderName: string;
                content: string;
                isSystem: boolean;
                hasAttachment: boolean;
                isDeleted: boolean;
            }
            | undefined;

        for await (const lineRaw of iterLines(input.stream, { yieldEmpty: true })) {
            const line = stripBidiAndBom(lineRaw);

            const header = parseHeaderLine(line, dateOrder);
            if (header) {
                let timestampUtc: string;
                try {
                    timestampUtc = toUtcIsoFromLocalWallClock(header);
                } catch {
                    if (input.lenient) {
                        warn(input, {
                            code: 'WA_TXT_INVALID_HEADER_DATETIME',
                            message: 'Invalid WhatsApp TXT timestamp header; treating line as continuation',
                        });

                        if (current) {
                            current.content = current.content.length ? `${current.content}\n${line}` : line;
                        }

                        continue;
                    }
                    throw new Error('Invalid date/time in WhatsApp TXT export');
                }

                if (current) {
                    yield toUnifiedMessage(current);
                }

                const { senderName, content, isSystem } = parseSenderAndContent(header.rest);
                const flags = analyzeContentFlags(content);

                current = {
                    timestampUtc,
                    senderName,
                    content: flags.content,
                    isSystem,
                    hasAttachment: flags.hasAttachment,
                    isDeleted: flags.isDeleted,
                };

                continue;
            }

            if (!current) continue;

            // Multiline continuation.
            current.content = current.content.length ? `${current.content}\n${line}` : line;
        }

        if (current) {
            yield toUnifiedMessage(current);
        }
    }
}
