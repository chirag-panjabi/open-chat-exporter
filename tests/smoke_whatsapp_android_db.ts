import { Database } from 'bun:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import chain from 'stream-chain';
import parser from 'stream-json/parser.js';
import pick from 'stream-json/filters/pick.js';
import streamArray from 'stream-json/streamers/stream-array.js';
import streamValues from 'stream-json/streamers/stream-values.js';
import { iterUint8 } from '../src/utils/streams';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

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

type StreamValuesChunk = {
    key: number;
    value: unknown;
};

type StreamArrayChunk = {
    key: number;
    value: unknown;
};

async function readPickedValue(filePath: string, filter: string): Promise<unknown> {
    const file = Bun.file(filePath);
    const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

    const valueStream = chain([inputTextStream, parser(), pick({ filter, once: true }), streamValues()]);

    for await (const chunk of valueStream as AsyncIterable<StreamValuesChunk>) {
        return chunk.value;
    }

    throw new Error(`Expected to find JSON value at path: ${filter}`);
}

async function readMessages(filePath: string): Promise<Record<string, unknown>[]> {
    const file = Bun.file(filePath);
    const inputTextStream = Readable.from(iterTextFromWebStream(file.stream()));

    const messagesArrayStream = chain([inputTextStream, parser(), pick({ filter: 'messages' }), streamArray()]);

    const messages: Record<string, unknown>[] = [];
    for await (const chunk of messagesArrayStream as AsyncIterable<StreamArrayChunk>) {
        if (isRecord(chunk.value)) messages.push(chunk.value);
    }

    return messages;
}

function createSyntheticAndroidMsgstoreSqlite(dbPath: string): void {
    const db = new Database(dbPath);

    try {
        db.exec(`
      PRAGMA journal_mode=WAL;

      DROP TABLE IF EXISTS messages;

      CREATE TABLE messages (
        _id INTEGER PRIMARY KEY,
        key_remote_jid TEXT,
        key_from_me INTEGER,
        timestamp INTEGER,
        data TEXT,
        remote_resource TEXT,
        push_name TEXT,
        media_wa_type INTEGER,
        quoted_row_id INTEGER
      );
    `);

        const chatJid = 'alice@s.whatsapp.net';

        // Message 1: incoming.
        db.query(
            `
      INSERT INTO messages (
        _id, key_remote_jid, key_from_me, timestamp, data, remote_resource, push_name, media_wa_type, quoted_row_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `.trim()
        ).run(10, chatJid, 0, 1_700_000_000_000, 'Hello from Alice', null, 'Alice', 0, null);

        // Message 2: outgoing reply to message 1.
        db.query(
            `
      INSERT INTO messages (
        _id, key_remote_jid, key_from_me, timestamp, data, remote_resource, push_name, media_wa_type, quoted_row_id
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
    `.trim()
        ).run(11, chatJid, 1, 1_700_000_000_050, 'Reply to Alice', null, null, 0, 10);
    } finally {
        db.close();
    }
}

async function main(): Promise<void> {
    const dbPath = join(tmpdir(), `open-chat-exporter.whatsapp-android.${Date.now()}.msgstore.db`);
    const outputPath = join(tmpdir(), `open-chat-exporter.whatsapp-android.${Date.now()}.json`);

    createSyntheticAndroidMsgstoreSqlite(dbPath);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            dbPath,
            '--platform',
            'WHATSAPP',
            '--output',
            outputPath,
            '--wa-chat-jid',
            'alice@s.whatsapp.net',
            '--chat-name',
            'WhatsApp Android DB fixture',
            '--chat-type',
            'DIRECT',
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'WHATSAPP', 'chat_info.platform should be WHATSAPP');
    assert(chatInfo.chat_name === 'WhatsApp Android DB fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);

    const msg10 = messages.find((m) => m.message_id === 'whatsapp-android:10');
    assert(msg10, 'Expected message_id whatsapp-android:10');

    const msg11 = messages.find((m) => m.message_id === 'whatsapp-android:11');
    assert(msg11 && isRecord(msg11.context), 'Expected message_id whatsapp-android:11 with context');
    assert(
        msg11.context.reply_to_message_id === 'whatsapp-android:10',
        `Expected reply_to_message_id to resolve to whatsapp-android:10, got ${String(msg11.context.reply_to_message_id)}`
    );

    // Best-effort cleanup (ignore errors)
    try {
        await Bun.file(outputPath).delete();
    } catch {
        // ignore
    }

    try {
        await Bun.file(dbPath).delete();
    } catch {
        // ignore
    }
}

main().catch((err) => {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
});
