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

function createSyntheticChatStorageSqlite(dbPath: string): void {
    const db = new Database(dbPath);

    try {
        db.exec(`
      PRAGMA journal_mode=WAL;

      DROP TABLE IF EXISTS ZWACHATSESSION;
      DROP TABLE IF EXISTS ZWAMESSAGE;
      DROP TABLE IF EXISTS ZWAMESSAGEINFO;

      CREATE TABLE ZWACHATSESSION (
        Z_PK INTEGER PRIMARY KEY,
        ZCONTACTJID TEXT,
        ZPARTNERNAME TEXT,
        ZSESSIONTYPE INTEGER
      );

      CREATE TABLE ZWAMESSAGEINFO (
        Z_PK INTEGER PRIMARY KEY,
        ZQUOTEDMESSAGE INTEGER
      );

      CREATE TABLE ZWAMESSAGE (
        Z_PK INTEGER PRIMARY KEY,
        ZCHATSESSION INTEGER,
        ZISFROMME INTEGER,
        ZMESSAGEDATE REAL,
        ZFROMJID TEXT,
        ZTOJID TEXT,
        ZPUSHNAME TEXT,
        ZTEXT TEXT,
        ZMESSAGETYPE INTEGER,
        ZMEDIAITEM INTEGER,
        ZSORT INTEGER,
        ZSTANZAID TEXT,
        ZMESSAGEINFO INTEGER
      );
    `);

        // One chat session.
        db.query(
            'INSERT INTO ZWACHATSESSION (Z_PK, ZCONTACTJID, ZPARTNERNAME, ZSESSIONTYPE) VALUES (?1, ?2, ?3, ?4)'
        ).run(1, 'alice@s.whatsapp.net', 'Alice', 0);

        // Message 100: incoming.
        // Cocoa time seconds since 2001-01-01.
        db.query(
            `
      INSERT INTO ZWAMESSAGE (
        Z_PK, ZCHATSESSION, ZISFROMME, ZMESSAGEDATE, ZFROMJID, ZTOJID, ZPUSHNAME, ZTEXT, ZMESSAGETYPE, ZMEDIAITEM, ZSORT, ZSTANZAID, ZMESSAGEINFO
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `.trim()
        ).run(
            100,
            1,
            0,
            800_000_000,
            'alice@s.whatsapp.net',
            'me@s.whatsapp.net',
            'Alice',
            'Hello from Alice',
            0,
            null,
            1,
            'stanza-100',
            null
        );

        // Message 101: outgoing, replies to 100 via ZWAMESSAGEINFO.ZQUOTEDMESSAGE.
        db.query('INSERT INTO ZWAMESSAGEINFO (Z_PK, ZQUOTEDMESSAGE) VALUES (?1, ?2)').run(200, 100);

        db.query(
            `
      INSERT INTO ZWAMESSAGE (
        Z_PK, ZCHATSESSION, ZISFROMME, ZMESSAGEDATE, ZFROMJID, ZTOJID, ZPUSHNAME, ZTEXT, ZMESSAGETYPE, ZMEDIAITEM, ZSORT, ZSTANZAID, ZMESSAGEINFO
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
    `.trim()
        ).run(
            101,
            1,
            1,
            800_000_050,
            null,
            'alice@s.whatsapp.net',
            null,
            'Reply to Alice',
            0,
            null,
            2,
            'stanza-101',
            200
        );
    } finally {
        db.close();
    }
}

async function main(): Promise<void> {
    const dbPath = join(tmpdir(), `unified-chat-exporter.whatsapp-ios.${Date.now()}.ChatStorage.sqlite`);
    const outputPath = join(tmpdir(), `unified-chat-exporter.whatsapp-ios.${Date.now()}.json`);

    createSyntheticChatStorageSqlite(dbPath);

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
            'WhatsApp iOS DB fixture',
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
    assert(chatInfo.chat_name === 'WhatsApp iOS DB fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 2, `Expected 2 messages, got ${messages.length}`);

    const msg100 = messages.find((m) => m.message_id === 'whatsapp-ios:100');
    assert(msg100, 'Expected message_id whatsapp-ios:100');

    const msg101 = messages.find((m) => m.message_id === 'whatsapp-ios:101');
    assert(msg101 && isRecord(msg101.context), 'Expected message_id whatsapp-ios:101 with context');
    assert(
        msg101.context.reply_to_message_id === 'whatsapp-ios:100',
        `Expected reply_to_message_id to resolve to whatsapp-ios:100, got ${String(msg101.context.reply_to_message_id)}`
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
