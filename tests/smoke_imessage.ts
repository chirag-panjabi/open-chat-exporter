import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Database } from 'bun:sqlite';
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

function createSyntheticChatDb(dbPath: string): void {
    const db = new Database(dbPath);
    try {
        db.exec(`
CREATE TABLE chat (
  guid TEXT
);

CREATE TABLE handle (
  id TEXT
);

CREATE TABLE message (
  guid TEXT,
  text TEXT,
  date INTEGER,
  is_from_me INTEGER,
  handle_id INTEGER,
  thread_originator_guid TEXT,
  date_edited INTEGER,
  is_system_message INTEGER,
  associated_message_guid TEXT
);

CREATE TABLE chat_message_join (
  chat_id INTEGER,
  message_id INTEGER
);

CREATE TABLE message_attachment_join (
  message_id INTEGER,
  attachment_id INTEGER
);
`);

        const chatGuid = 'chat123';
        const bobHandle = 'bob@example.invalid';

        const m1Guid = '11111111-1111-1111-1111-111111111111';
        const m2Guid = '22222222-2222-2222-2222-222222222222';
        const m3Guid = '33333333-3333-3333-3333-333333333333';

        db.exec(
            `INSERT INTO chat (rowid, guid) VALUES (1, '${chatGuid}');\n` +
            `INSERT INTO handle (rowid, id) VALUES (1, '${bobHandle}');\n` +
            `INSERT INTO message (rowid, guid, text, date, is_from_me, handle_id, thread_originator_guid, date_edited, is_system_message, associated_message_guid) VALUES\n` +
            `  (1, '${m1Guid}', 'Hello from iMessage fixture.', 0, 0, 1, NULL, 0, 0, NULL),\n` +
            `  (2, '${m2Guid}', 'Reply with attachment.', 60, 1, NULL, NULL, 0, 0, NULL),\n` +
            `  (3, '${m3Guid}', 'This is a reply.', 90, 1, NULL, '${m1Guid}', 120, 0, NULL);\n` +
            `INSERT INTO chat_message_join (chat_id, message_id) VALUES (1, 1), (1, 2), (1, 3);\n` +
            `INSERT INTO message_attachment_join (message_id, attachment_id) VALUES (2, 1);\n`
        );
    } finally {
        db.close();
    }
}

async function main(): Promise<void> {
    const dbPath = join(tmpdir(), `unified-chat-exporter.imessage.${Date.now()}.chat.db`);
    const outputPath = join(tmpdir(), `unified-chat-exporter.imessage.${Date.now()}.json`);

    createSyntheticChatDb(dbPath);

    const proc = Bun.spawn(
        [
            'bun',
            'run',
            'src/cli/index.ts',
            'convert',
            '--input',
            dbPath,
            '--platform',
            'IMESSAGE',
            '--output',
            outputPath,
            '--chat-guid',
            'chat123',
            '--my-name',
            'Me Fixture',
            '--chat-name',
            'iMessage fixture',
            '--chat-type',
            'DIRECT',
        ],
        { stdout: 'inherit', stderr: 'inherit' }
    );

    const exitCode = await proc.exited;
    assert(exitCode === 0, `CLI failed with exit code: ${exitCode}`);

    const chatInfo = await readPickedValue(outputPath, 'chat_info');
    assert(isRecord(chatInfo), 'chat_info should be an object');
    assert(chatInfo.platform === 'IMESSAGE', 'chat_info.platform should be IMESSAGE');
    assert(chatInfo.chat_name === 'iMessage fixture', 'chat_info.chat_name should match override');

    const messages = await readMessages(outputPath);
    assert(messages.length === 3, `Expected 3 messages, got ${messages.length}`);

    const m1 = messages.find((m) => m.message_id === '11111111-1111-1111-1111-111111111111');
    assert(m1, 'Expected message 1 to exist');
    assert(m1.timestamp_utc === '2001-01-01T00:00:00.000Z', 'Message 1 timestamp mismatch');
    assert(isRecord(m1.sender), 'Message 1 sender should be an object');
    assert(m1.sender.original_name === 'bob@example.invalid', 'Message 1 sender name mismatch');

    const m2 = messages.find((m) => m.message_id === '22222222-2222-2222-2222-222222222222');
    assert(m2, 'Expected message 2 to exist');
    assert(isRecord(m2.sender), 'Message 2 sender should be an object');
    assert(m2.sender.id === 'me', 'Message 2 sender.id should be me');
    assert(m2.sender.original_name === 'Me Fixture', 'Message 2 sender name should come from --my-name');
    assert(isRecord(m2.metadata), 'Message 2 metadata should be an object');
    assert(m2.metadata.has_attachment === true, 'Message 2 should have has_attachment true');

    const m3 = messages.find((m) => m.message_id === '33333333-3333-3333-3333-333333333333');
    assert(m3, 'Expected message 3 to exist');
    assert(isRecord(m3.context), 'Message 3 context should be an object');
    assert(m3.context.reply_to_message_id === '11111111-1111-1111-1111-111111111111', 'Message 3 reply mismatch');
    assert(isRecord(m3.metadata), 'Message 3 metadata should be an object');
    assert(m3.metadata.is_edited === true, 'Message 3 should have is_edited true');

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
